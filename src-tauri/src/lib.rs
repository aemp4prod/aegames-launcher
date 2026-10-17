use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::{Component, Path, PathBuf}, process::{Child, Command}, sync::Mutex};
use tauri::{Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
struct HypeProcess(Mutex<Option<Child>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeInstallReport {
    kind: String,
    path: String,
    executable_path: String,
    version: Option<String>,
    installed_size: u64,
    verified_files: usize,
    total_files: usize,
    missing_files: Vec<String>,
    invalid_files: Vec<String>,
    executable_found: bool,
    message: String,
}

fn text_at<'a>(value: &'a Value, keys: &[&str]) -> Vec<&'a str> {
    keys.iter().filter_map(|key| value.get(*key).and_then(Value::as_str)).collect()
}

fn is_hype_manifest(manifest: &Value) -> bool {
    let mut identities = text_at(manifest, &["id", "gameId", "game_id", "slug", "name"]);
    if let Some(game) = manifest.get("game") {
        if let Some(value) = game.as_str() { identities.push(value); }
        identities.extend(text_at(game, &["id", "name", "slug"]));
    }
    identities.iter().any(|value| value.to_lowercase().contains("hype"))
}

fn manifest_files(manifest: &Value) -> Vec<(String, Option<u64>)> {
    manifest.get("files").and_then(Value::as_array).map(|files| {
        files.iter().filter_map(|entry| {
            if let Some(path) = entry.as_str() { return Some((path.to_string(), None)); }
            entry.get("path").and_then(Value::as_str).map(|path| {
                (path.to_string(), entry.get("size").and_then(Value::as_u64))
            })
        }).collect()
    }).unwrap_or_default()
}

fn safe_relative(path: &str) -> bool {
    let path = Path::new(path);
    !path.is_absolute() && path.components().all(|part| matches!(part, Component::Normal(_)))
}

fn verify_directory(directory: &Path) -> Result<HypeInstallReport, String> {
    let manifest_path = directory.join("manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|_| format!("Aucun manifest.json lisible dans {}.", directory.display()))?;
    let manifest: Value = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("Le manifest.json est invalide : {error}"))?;
    if !is_hype_manifest(&manifest) {
        return Err("Le manifest trouvé ne correspond pas à Hype.".into());
    }

    let executable = manifest.get("executable").and_then(Value::as_str).unwrap_or("Hype.exe");
    if !safe_relative(executable) { return Err("Le chemin de l’exécutable dans le manifest est invalide.".into()); }
    let files = manifest_files(&manifest);
    let mut verified_files = 0;
    let mut installed_size = 0;
    let mut missing_files = Vec::new();
    let mut invalid_files = Vec::new();
    for (relative, expected_size) in &files {
        if !safe_relative(relative) {
            invalid_files.push(relative.clone());
            continue;
        }
        let path = directory.join(relative);
        match fs::metadata(&path) {
            Ok(metadata) if expected_size.is_some_and(|size| metadata.len() != size) => {
                installed_size += metadata.len();
                invalid_files.push(relative.clone());
            },
            Ok(metadata) => {
                installed_size += metadata.len();
                verified_files += 1;
            },
            Err(_) => missing_files.push(relative.clone()),
        }
    }
    let executable_path = directory.join(executable);
    let executable_found = executable_path.is_file();
    let healthy = executable_found && missing_files.is_empty() && invalid_files.is_empty();

    Ok(HypeInstallReport {
        kind: "existing".into(),
        path: directory.to_string_lossy().into_owned(),
        executable_path: executable_path.to_string_lossy().into_owned(),
        version: manifest.get("version").and_then(Value::as_str).map(str::to_owned),
        installed_size,
        verified_files,
        total_files: files.len(),
        missing_files,
        invalid_files,
        executable_found,
        message: if healthy { "Installation existante vérifiée." } else { "Le manifest a été reconnu, mais certains éléments sont absents ou invalides." }.into(),
    })
}

fn adopt_legacy_installation(directory: &Path) -> Result<HypeInstallReport, String> {
    let executable = directory.join("Hype.exe");
    let size = fs::metadata(&executable)
        .map_err(|error| format!("Hype.exe est inaccessible : {error}"))?
        .len();
    let manifest = json!({
        "schemaVersion": 1,
        "game": { "id": "hype", "name": "Hype" },
        "version": "local",
        "executable": "Hype.exe",
        "files": [{ "path": "Hype.exe", "size": size }],
        "installation": { "state": "adopted", "source": "local" }
    });
    fs::write(directory.join("manifest.json"), serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Impossible de créer le manifest local : {error}"))?;
    verify_directory(directory)
}

fn find_hype_directory(selected: &Path) -> Option<PathBuf> {
    let direct_manifest = selected.join("manifest.json");
    if direct_manifest.is_file() {
        if let Ok(text) = fs::read_to_string(&direct_manifest) {
            if serde_json::from_str::<Value>(&text).is_ok_and(|value| is_hype_manifest(&value)) {
                return Some(selected.to_path_buf());
            }
        }
    }
    let child = selected.join("Hype");
    let child_manifest = child.join("manifest.json");
    if child_manifest.is_file() {
        if let Ok(text) = fs::read_to_string(child_manifest) {
            if serde_json::from_str::<Value>(&text).is_ok_and(|value| is_hype_manifest(&value)) {
                return Some(child);
            }
        }
    }
    None
}

fn prepare_hype_directory(selected: &Path) -> Result<HypeInstallReport, String> {
    let is_already_named_hype = selected.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("hype"));
    let directory = if is_already_named_hype { selected.to_path_buf() } else { selected.join("Hype") };
    fs::create_dir_all(&directory).map_err(|error| format!("Impossible de créer le dossier Hype : {error}"))?;
    let placeholder = json!({
        "schemaVersion": 1,
        "game": { "id": "hype", "name": "Hype" },
        "version": "pending",
        "executable": "Hype.exe",
        "files": [],
        "installation": { "state": "prepared", "source": "github" }
    });
    fs::write(directory.join("manifest.json"), serde_json::to_vec_pretty(&placeholder).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Impossible de préparer le manifest local : {error}"))?;
    Ok(HypeInstallReport {
        kind: "prepared".into(),
        path: directory.to_string_lossy().into_owned(),
        executable_path: directory.join("Hype.exe").to_string_lossy().into_owned(),
        version: None,
        installed_size: 0,
        verified_files: 0,
        total_files: 0,
        missing_files: Vec::new(),
        invalid_files: Vec::new(),
        executable_found: false,
        message: "Le dossier Hype est prêt. Le téléchargement depuis GitHub sera branché à cet emplacement.".into(),
    })
}

#[tauri::command]
fn select_hype_installation(default_path: Option<String>) -> Result<Option<HypeInstallReport>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choisir l’emplacement de Hype");
    if let Some(path) = default_path.filter(|path| Path::new(path).is_dir()) {
        dialog = dialog.set_directory(path);
    }
    let Some(selected) = dialog.pick_folder() else {
        return Ok(None);
    };
    if let Some(directory) = find_hype_directory(&selected) {
        verify_directory(&directory).map(Some)
    } else if selected.join("Hype.exe").is_file() {
        adopt_legacy_installation(&selected).map(Some)
    } else if selected.join("Hype").join("Hype.exe").is_file() {
        adopt_legacy_installation(&selected.join("Hype")).map(Some)
    } else {
        prepare_hype_directory(&selected).map(Some)
    }
}

#[tauri::command]
fn verify_hype_installation(path: String) -> Result<HypeInstallReport, String> {
    verify_directory(Path::new(&path))
}

#[tauri::command]
fn launch_hype(path: String, process: State<'_, HypeProcess>) -> Result<(), String> {
    let directory = PathBuf::from(path);
    let report = verify_directory(&directory)?;
    if !report.executable_found || !report.missing_files.is_empty() || !report.invalid_files.is_empty() {
        return Err("L’installation de Hype est incomplète. Lancez une vérification avant de jouer.".into());
    }
    let mut current = process.0.lock().map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
    if let Some(child) = current.as_mut() {
        if child.try_wait().map_err(|error| error.to_string())?.is_none() { return Ok(()); }
    }
    let child = Command::new(&report.executable_path)
        .current_dir(&directory)
        .spawn()
        .map_err(|error| format!("Impossible de lancer Hype.exe : {error}"))?;
    *current = Some(child);
    Ok(())
}

#[tauri::command]
fn is_hype_running(process: State<'_, HypeProcess>) -> Result<bool, String> {
    let mut current = process.0.lock().map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
    let Some(child) = current.as_mut() else { return Ok(false); };
    if child.try_wait().map_err(|error| error.to_string())?.is_none() { return Ok(true); }
    *current = None;
    Ok(false)
}

#[tauri::command]
fn stop_hype(process: State<'_, HypeProcess>) -> Result<(), String> {
    let mut current = process.0.lock().map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
    if let Some(child) = current.as_mut() {
        if child.try_wait().map_err(|error| error.to_string())?.is_none() {
            child.kill().map_err(|error| format!("Impossible de fermer Hype.exe : {error}"))?;
            let _ = child.wait();
        }
    }
    *current = None;
    Ok(())
}

#[tauri::command]
fn reveal_hype_installation(path: String) -> Result<(), String> {
    let directory = PathBuf::from(path);
    verify_directory(&directory)?;
    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("Impossible d’ouvrir le dossier de Hype : {error}"))?;
    Ok(())
}

#[tauri::command]
fn uninstall_hype(path: String, process: State<'_, HypeProcess>) -> Result<(), String> {
    let requested = PathBuf::from(path);
    verify_directory(&requested)?;
    let directory = requested.canonicalize()
        .map_err(|error| format!("Impossible de sécuriser le chemin d’installation : {error}"))?;
    if directory.file_name().is_none() || directory.parent().is_none() {
        return Err("Le dossier d’installation sélectionné ne peut pas être supprimé en sécurité.".into());
    }
    {
        let mut current = process.0.lock().map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
        if let Some(child) = current.as_mut() {
            if child.try_wait().map_err(|error| error.to_string())?.is_none() {
                return Err("Fermez Hype avant de le désinstaller.".into());
            }
        }
        *current = None;
    }
    fs::remove_dir_all(&directory)
        .map_err(|error| format!("Impossible de désinstaller Hype : {error}"))
}

#[tauri::command]
fn select_install_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Choisir le dossier d’installation par défaut")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn verify_launcher_installation() -> Result<String, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Impossible de localiser le launcher : {error}"))?;
    let metadata = fs::metadata(&executable)
        .map_err(|error| format!("L’exécutable du launcher est inaccessible : {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("L’exécutable du launcher est invalide.".into());
    }
    let directory = executable.parent().ok_or("Le dossier du launcher est introuvable.")?;
    if !directory.is_dir() { return Err("Le dossier du launcher est inaccessible.".into()); }
    Ok(format!("Launcher vérifié · {} · {:.1} Mo", executable.file_name().unwrap_or_default().to_string_lossy(), metadata.len() as f64 / 1_048_576.0))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            app.deep_link().register_all()?;
            Ok(())
        })
        .manage(HypeProcess::default())
        .invoke_handler(tauri::generate_handler![select_hype_installation, verify_hype_installation, launch_hype, is_hype_running, stop_hype, reveal_hype_installation, uninstall_hype, select_install_directory, verify_launcher_installation])
        .run(tauri::generate_context!())
        .expect("error while running Æ Games Launcher");
}
