use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    fs::File,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

const HYPE_MANIFEST_URL: &str =
    "https://github.com/aemp4prod/aegames-hype/releases/latest/download/manifest.json";

#[derive(Default)]
struct HypeProcess(Mutex<Option<Child>>);

#[derive(Default)]
struct HypeTransfer {
    active: AtomicBool,
    cancel: AtomicBool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeGameIdentity {
    id: String,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeArchive {
    url: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeFile {
    path: String,
    size: u64,
    sha256: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeRemoteManifest {
    schema_version: u32,
    game: HypeGameIdentity,
    version: String,
    channel: String,
    platform: String,
    executable: String,
    archive: HypeArchive,
    files: Vec<HypeFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeReleaseInfo {
    version: String,
    download_size: u64,
    installed_size: u64,
    update_available: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HypeProgress {
    percentage: u8,
    phase: String,
    downloaded: u64,
    total: u64,
}

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
    keys.iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_str))
        .collect()
}

fn is_hype_manifest(manifest: &Value) -> bool {
    let mut identities = text_at(manifest, &["id", "gameId", "game_id", "slug", "name"]);
    if let Some(game) = manifest.get("game") {
        if let Some(value) = game.as_str() {
            identities.push(value);
        }
        identities.extend(text_at(game, &["id", "name", "slug"]));
    }
    identities
        .iter()
        .any(|value| value.to_lowercase().contains("hype"))
}

fn manifest_files(manifest: &Value) -> Vec<(String, Option<u64>, Option<String>)> {
    manifest
        .get("files")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(|entry| {
                    if let Some(path) = entry.as_str() {
                        return Some((path.to_string(), None, None));
                    }
                    entry.get("path").and_then(Value::as_str).map(|path| {
                        (
                            path.to_string(),
                            entry.get("size").and_then(Value::as_u64),
                            entry
                                .get("sha256")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                        )
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Impossible de lire {} : {error}", path.display()))?;
    let mut hasher = Sha256::new();
    // Keep the large hashing buffer on the heap. A 1 MiB stack allocation can
    // overflow the Windows main thread while Tauri handles a synchronous
    // installation check during startup.
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Impossible de lire {} : {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn safe_relative(path: &str) -> bool {
    let path = Path::new(path);
    !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
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

    let executable = manifest
        .get("executable")
        .and_then(Value::as_str)
        .unwrap_or("Hype.exe");
    if !safe_relative(executable) {
        return Err("Le chemin de l’exécutable dans le manifest est invalide.".into());
    }
    let files = manifest_files(&manifest);
    let mut verified_files = 0;
    let mut installed_size = 0;
    let mut missing_files = Vec::new();
    let mut invalid_files = Vec::new();
    for (relative, expected_size, expected_hash) in &files {
        if !safe_relative(relative) {
            invalid_files.push(relative.clone());
            continue;
        }
        let path = directory.join(relative);
        match fs::metadata(&path) {
            Ok(metadata) if expected_size.is_some_and(|size| metadata.len() != size) => {
                installed_size += metadata.len();
                invalid_files.push(relative.clone());
            }
            Ok(metadata)
                if expected_hash.as_ref().is_some_and(|hash| {
                    sha256_file(&path).map_or(true, |actual| !actual.eq_ignore_ascii_case(hash))
                }) =>
            {
                installed_size += metadata.len();
                invalid_files.push(relative.clone());
            }
            Ok(metadata) => {
                installed_size += metadata.len();
                verified_files += 1;
            }
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
        version: manifest
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_owned),
        installed_size,
        verified_files,
        total_files: files.len(),
        missing_files,
        invalid_files,
        executable_found,
        message: if healthy {
            "Installation existante vérifiée."
        } else {
            "Le manifest a été reconnu, mais certains éléments sont absents ou invalides."
        }
        .into(),
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
    fs::write(
        directory.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
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
    let is_already_named_hype = selected
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("hype"));
    let directory = if is_already_named_hype {
        selected.to_path_buf()
    } else {
        selected.join("Hype")
    };
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Impossible de créer le dossier Hype : {error}"))?;
    let placeholder = json!({
        "schemaVersion": 1,
        "game": { "id": "hype", "name": "Hype" },
        "version": "pending",
        "executable": "Hype.exe",
        "files": [],
        "installation": { "state": "prepared", "source": "github" }
    });
    fs::write(
        directory.join("manifest.json"),
        serde_json::to_vec_pretty(&placeholder).map_err(|error| error.to_string())?,
    )
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

fn validate_remote_manifest(manifest: &HypeRemoteManifest) -> Result<(), String> {
    if manifest.schema_version != 1 || !manifest.game.id.eq_ignore_ascii_case("hype") {
        return Err("Le manifeste distant ne correspond pas à Hype.".into());
    }
    if manifest.platform != "windows-x86_64" {
        return Err(format!(
            "La plateforme {} n’est pas prise en charge par ce launcher.",
            manifest.platform
        ));
    }
    if manifest.version.trim().is_empty() || manifest.channel != "stable" {
        return Err("La version ou le canal du manifeste Hype est invalide.".into());
    }
    if !safe_relative(&manifest.executable)
        || manifest.files.iter().any(|file| !safe_relative(&file.path))
    {
        return Err("Le manifeste Hype contient un chemin de fichier non sécurisé.".into());
    }
    if !manifest
        .archive
        .url
        .starts_with("https://github.com/aemp4prod/aegames-hype/releases/download/")
    {
        return Err("L’archive Hype ne provient pas du dépôt GitHub autorisé.".into());
    }
    if manifest.archive.size == 0
        || manifest.archive.sha256.len() != 64
        || !manifest
            .archive
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("La taille ou le SHA-256 de l’archive Hype est invalide.".into());
    }
    Ok(())
}

async fn fetch_hype_manifest() -> Result<HypeRemoteManifest, String> {
    let response = reqwest::Client::builder()
        .user_agent("AE-Games-Launcher")
        .build()
        .map_err(|error| format!("Impossible de préparer la connexion à GitHub : {error}"))?
        .get(HYPE_MANIFEST_URL)
        .send()
        .await
        .map_err(|error| format!("Impossible de récupérer le manifeste Hype : {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub n’a pas fourni de manifeste Hype valide : {error}"))?;
    let manifest = response
        .json::<HypeRemoteManifest>()
        .await
        .map_err(|error| format!("Le manifeste Hype publié est invalide : {error}"))?;
    validate_remote_manifest(&manifest)?;
    Ok(manifest)
}

fn installed_version(path: Option<&str>) -> Option<String> {
    let path = Path::new(path?).join("manifest.json");
    let value: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn version_is_newer(remote: &str, local: Option<&str>) -> bool {
    let Some(local) = local else {
        return true;
    };
    match (
        semver::Version::parse(remote),
        semver::Version::parse(local),
    ) {
        (Ok(remote), Ok(local)) => remote > local,
        _ => remote != local,
    }
}

#[tauri::command]
async fn check_hype_update(path: Option<String>) -> Result<HypeReleaseInfo, String> {
    let manifest = fetch_hype_manifest().await?;
    let local = installed_version(path.as_deref());
    Ok(HypeReleaseInfo {
        version: manifest.version.clone(),
        download_size: manifest.archive.size,
        installed_size: manifest.files.iter().map(|file| file.size).sum(),
        update_available: version_is_newer(&manifest.version, local.as_deref()),
    })
}

fn emit_hype_progress(app: &AppHandle, percentage: u8, phase: &str, downloaded: u64, total: u64) {
    let _ = app.emit(
        "hype-download-progress",
        HypeProgress {
            percentage,
            phase: phase.to_string(),
            downloaded,
            total,
        },
    );
}

fn ensure_hype_target(destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return Ok(());
    }
    let manifest_path = destination.join("manifest.json");
    let manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).map_err(|_| {
        "Le dossier choisi existe déjà et n’est pas une installation Hype reconnue.".to_string()
    })?)
    .map_err(|_| "Le dossier choisi contient un manifeste invalide.".to_string())?;
    if !is_hype_manifest(&manifest) {
        return Err("Le dossier choisi n’est pas une installation Hype reconnue.".into());
    }
    Ok(())
}

fn extract_hype_archive(archive_path: &Path, staging: &Path) -> Result<(), String> {
    fs::create_dir_all(staging)
        .map_err(|error| format!("Impossible de préparer l’extraction : {error}"))?;
    let file = File::open(archive_path)
        .map_err(|error| format!("Impossible d’ouvrir l’archive Hype : {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("L’archive Hype est invalide : {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Impossible de lire l’archive Hype : {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "L’archive Hype contient un chemin non sécurisé.".to_string())?;
        let output = staging.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| format!("Impossible de créer {} : {error}", output.display()))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Impossible de créer {} : {error}", parent.display()))?;
        }
        let mut target = File::create(&output)
            .map_err(|error| format!("Impossible de créer {} : {error}", output.display()))?;
        std::io::copy(&mut entry, &mut target)
            .map_err(|error| format!("Impossible d’extraire {} : {error}", output.display()))?;
    }
    Ok(())
}

async fn install_hype_inner(
    app: &AppHandle,
    destination: &Path,
    archive_path: &Path,
    staging: &Path,
    backup: &Path,
    transfer: &HypeTransfer,
) -> Result<HypeInstallReport, String> {
    ensure_hype_target(destination)?;
    let manifest = fetch_hype_manifest().await?;
    emit_hype_progress(app, 0, "download", 0, manifest.archive.size);

    let response = reqwest::Client::builder()
        .user_agent("AE-Games-Launcher")
        .build()
        .map_err(|error| format!("Impossible de préparer le téléchargement : {error}"))?
        .get(&manifest.archive.url)
        .send()
        .await
        .map_err(|error| format!("Impossible de télécharger Hype : {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub n’a pas fourni l’archive Hype : {error}"))?;

    let mut output = File::create(archive_path)
        .map_err(|error| format!("Impossible de créer le fichier temporaire : {error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if transfer.cancel.load(Ordering::SeqCst) {
            return Err("Téléchargement de Hype annulé.".into());
        }
        let chunk = chunk
            .map_err(|error| format!("Le téléchargement de Hype a été interrompu : {error}"))?;
        output
            .write_all(&chunk)
            .map_err(|error| format!("Impossible d’écrire le téléchargement : {error}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let percentage =
            ((downloaded.saturating_mul(85) / manifest.archive.size.max(1)).min(85)) as u8;
        emit_hype_progress(
            app,
            percentage,
            "download",
            downloaded,
            manifest.archive.size,
        );
    }
    output
        .flush()
        .map_err(|error| format!("Impossible de finaliser le téléchargement : {error}"))?;
    drop(output);

    emit_hype_progress(app, 87, "verify", downloaded, manifest.archive.size);
    if downloaded != manifest.archive.size {
        return Err(format!(
            "La taille de l’archive Hype est incorrecte ({downloaded} octets reçus, {} attendus).",
            manifest.archive.size
        ));
    }
    let actual_hash = format!("{:x}", hasher.finalize());
    if !actual_hash.eq_ignore_ascii_case(&manifest.archive.sha256) {
        return Err("Le contrôle SHA-256 de l’archive Hype a échoué.".into());
    }
    if transfer.cancel.load(Ordering::SeqCst) {
        return Err("Installation de Hype annulée.".into());
    }

    emit_hype_progress(app, 90, "extract", downloaded, manifest.archive.size);
    extract_hype_archive(archive_path, staging)?;
    fs::write(
        staging.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Impossible d’écrire le manifeste local : {error}"))?;

    emit_hype_progress(app, 97, "verify", downloaded, manifest.archive.size);
    verify_directory(staging)?;
    if transfer.cancel.load(Ordering::SeqCst) {
        return Err("Installation de Hype annulée.".into());
    }

    if backup.exists() {
        fs::remove_dir_all(backup)
            .map_err(|error| format!("Impossible de nettoyer l’ancienne sauvegarde : {error}"))?;
    }
    if destination.exists() {
        fs::rename(destination, backup)
            .map_err(|error| format!("Impossible de préparer le remplacement de Hype : {error}"))?;
    }
    if let Err(error) = fs::rename(staging, destination) {
        if backup.exists() && !destination.exists() {
            let _ = fs::rename(backup, destination);
        }
        return Err(format!(
            "Impossible d’activer la nouvelle version de Hype : {error}"
        ));
    }
    if backup.exists() {
        let _ = fs::remove_dir_all(backup);
    }

    emit_hype_progress(app, 100, "complete", downloaded, manifest.archive.size);
    verify_directory(destination)
}

#[tauri::command]
async fn install_hype(
    app: AppHandle,
    path: String,
    transfer: State<'_, HypeTransfer>,
) -> Result<HypeInstallReport, String> {
    let destination = PathBuf::from(path);
    let parent = destination
        .parent()
        .ok_or("Le dossier d’installation de Hype est invalide.")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Impossible de préparer le dossier d’installation : {error}"))?;
    if transfer.active.swap(true, Ordering::SeqCst) {
        return Err("Une installation de Hype est déjà en cours.".into());
    }
    transfer.cancel.store(false, Ordering::SeqCst);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let archive_path = parent.join(format!(".hype-download-{nonce}.zip"));
    let staging = parent.join(format!(".hype-staging-{nonce}"));
    let backup = parent.join(format!(".hype-backup-{nonce}"));

    let result = install_hype_inner(
        &app,
        &destination,
        &archive_path,
        &staging,
        &backup,
        &transfer,
    )
    .await;
    let _ = fs::remove_file(&archive_path);
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    transfer.active.store(false, Ordering::SeqCst);
    transfer.cancel.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn cancel_hype_download(transfer: State<'_, HypeTransfer>) -> Result<(), String> {
    if transfer.active.load(Ordering::SeqCst) {
        transfer.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn select_hype_installation(
    default_path: Option<String>,
) -> Result<Option<HypeInstallReport>, String> {
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
    if !report.executable_found
        || !report.missing_files.is_empty()
        || !report.invalid_files.is_empty()
    {
        return Err(
            "L’installation de Hype est incomplète. Lancez une vérification avant de jouer.".into(),
        );
    }
    let mut current = process
        .0
        .lock()
        .map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
    if let Some(child) = current.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(());
        }
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
    let mut current = process
        .0
        .lock()
        .map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
    let Some(child) = current.as_mut() else {
        return Ok(false);
    };
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Ok(true);
    }
    *current = None;
    Ok(false)
}

#[tauri::command]
fn stop_hype(process: State<'_, HypeProcess>) -> Result<(), String> {
    let mut current = process
        .0
        .lock()
        .map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
    if let Some(child) = current.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            child
                .kill()
                .map_err(|error| format!("Impossible de fermer Hype.exe : {error}"))?;
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
    let directory = requested
        .canonicalize()
        .map_err(|error| format!("Impossible de sécuriser le chemin d’installation : {error}"))?;
    if directory.file_name().is_none() || directory.parent().is_none() {
        return Err(
            "Le dossier d’installation sélectionné ne peut pas être supprimé en sécurité.".into(),
        );
    }
    {
        let mut current = process
            .0
            .lock()
            .map_err(|_| "L’état du processus Hype est indisponible.".to_string())?;
        if let Some(child) = current.as_mut() {
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
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
    let directory = executable
        .parent()
        .ok_or("Le dossier du launcher est introuvable.")?;
    if !directory.is_dir() {
        return Err("Le dossier du launcher est inaccessible.".into());
    }
    Ok(format!(
        "Launcher vérifié · {} · {:.1} Mo",
        executable.file_name().unwrap_or_default().to_string_lossy(),
        metadata.len() as f64 / 1_048_576.0
    ))
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
        .manage(HypeTransfer::default())
        .invoke_handler(tauri::generate_handler![
            check_hype_update,
            install_hype,
            cancel_hype_download,
            select_hype_installation,
            verify_hype_installation,
            launch_hype,
            is_hype_running,
            stop_hype,
            reveal_hype_installation,
            uninstall_hype,
            select_install_directory,
            verify_launcher_installation
        ])
        .run(tauri::generate_context!())
        .expect("error while running Æ Games Launcher");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_uses_a_small_thread_stack_safely() {
        let path =
            std::env::temp_dir().join(format!("ae-games-sha-test-{}.bin", std::process::id()));
        fs::write(&path, b"abc").expect("create hash fixture");
        let test_path = path.clone();
        let hash = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || sha256_file(&test_path))
            .expect("spawn constrained stack thread")
            .join()
            .expect("hash thread must not overflow")
            .expect("hash fixture");
        let _ = fs::remove_file(path);
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
