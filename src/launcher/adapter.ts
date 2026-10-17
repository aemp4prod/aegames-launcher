import type { Update } from '@tauri-apps/plugin-updater';

export type HypeInstallKind = 'existing' | 'prepared';

export type HypeInstallReport = {
  kind: HypeInstallKind;
  path: string;
  executablePath: string;
  version?: string;
  installedSize: number;
  verifiedFiles: number;
  totalFiles: number;
  missingFiles: string[];
  invalidFiles: string[];
  executableFound: boolean;
  message: string;
};

type FileSystemDirectoryHandleLike = {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ getFile(): Promise<File> }>;
};

type ManifestFile = string | { path?: string; size?: number };
type HypeManifest = {
  id?: string;
  gameId?: string;
  game_id?: string;
  slug?: string;
  name?: string;
  version?: string;
  executable?: string;
  game?: string | { id?: string; name?: string; slug?: string };
  files?: ManifestFile[];
};

const isTauri = () => '__TAURI_INTERNALS__' in window;
let pendingLauncherUpdate: Update | null = null;

export type LauncherUpdateInfo = {
  currentVersion: string;
  version: string;
  date?: string;
  notes?: string;
};

export type HypeReleaseInfo = {
  version: string;
  downloadSize: number;
  installedSize: number;
  updateAvailable: boolean;
};

export type HypeDownloadProgress = {
  percentage: number;
  phase: 'download' | 'verify' | 'extract' | 'complete';
  downloaded: number;
  total: number;
};

function isHypeManifest(manifest: HypeManifest) {
  const game = typeof manifest.game === 'string'
    ? manifest.game
    : [manifest.game?.id, manifest.game?.name, manifest.game?.slug].filter(Boolean).join(' ');
  return [manifest.id, manifest.gameId, manifest.game_id, manifest.slug, manifest.name, game]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes('hype'));
}

async function getNestedFile(directory: FileSystemDirectoryHandleLike, relativePath: string) {
  const parts = relativePath.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) throw new Error('Chemin de fichier invalide dans le manifest.');
  let cursor = directory;
  for (const part of parts.slice(0, -1)) cursor = await cursor.getDirectoryHandle(part);
  return cursor.getFileHandle(parts.at(-1) ?? relativePath);
}

async function inspectBrowserDirectory(directory: FileSystemDirectoryHandleLike): Promise<HypeInstallReport> {
  let manifest: HypeManifest;
  try {
    const handle = await directory.getFileHandle('manifest.json');
    manifest = JSON.parse(await (await handle.getFile()).text()) as HypeManifest;
  } catch {
    try {
      const executableFile = await (await directory.getFileHandle('Hype.exe')).getFile();
      return {
        kind: 'existing',
        path: directory.name,
        executablePath: `${directory.name}/Hype.exe`,
        version: 'Locale',
        installedSize: executableFile.size,
        verifiedFiles: 1,
        totalFiles: 1,
        missingFiles: [],
        invalidFiles: [],
        executableFound: true,
        message: 'Installation locale sans manifest reconnue. L’application desktop créera son manifest lors de l’ajout.',
      };
    } catch { /* no legacy executable in this directory */ }
    return {
      kind: 'prepared',
      path: directory.name,
      executablePath: `${directory.name}/Hype/Hype.exe`,
      installedSize: 0,
      verifiedFiles: 0,
      totalFiles: 0,
      missingFiles: [],
      invalidFiles: [],
      executableFound: false,
      message: "Aucun manifest Hype n’a été trouvé. L’application desktop créera le dossier Hype à cet emplacement.",
    };
  }

  if (!isHypeManifest(manifest)) throw new Error("Le manifest trouvé ne correspond pas à Hype.");
  const executable = manifest.executable || 'Hype.exe';
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const missingFiles: string[] = [];
  const invalidFiles: string[] = [];
  let verifiedFiles = 0;
  let installedSize = 0;
  for (const entry of files) {
    const path = typeof entry === 'string' ? entry : entry.path;
    if (!path) continue;
    try {
      const file = await (await getNestedFile(directory, path)).getFile();
      installedSize += file.size;
      if (typeof entry !== 'string' && typeof entry.size === 'number' && file.size !== entry.size) invalidFiles.push(path);
      else verifiedFiles += 1;
    } catch {
      missingFiles.push(path);
    }
  }
  let executableFound = false;
  try {
    await getNestedFile(directory, executable);
    executableFound = true;
  } catch { /* reported below */ }

  return {
    kind: 'existing',
    path: directory.name,
    executablePath: `${directory.name}/${executable}`,
    version: manifest.version,
    installedSize,
    verifiedFiles,
    totalFiles: files.length,
    missingFiles,
    invalidFiles,
    executableFound,
    message: executableFound && missingFiles.length === 0 && invalidFiles.length === 0
      ? 'Installation existante vérifiée.'
      : 'Le manifest a été reconnu, mais certains éléments sont absents ou invalides.',
  };
}

async function invoke<T>(command: string, args?: Record<string, unknown>) {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export const launcherAdapter = {
  environment: isTauri() ? 'desktop' as const : 'browser' as const,

  async selectHypeInstallation(defaultPath?: string): Promise<HypeInstallReport | null> {
    if (isTauri()) return invoke<HypeInstallReport | null>('select_hype_installation', { defaultPath: defaultPath || null });
    const picker = (window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
    }).showDirectoryPicker;
    if (!picker) throw new Error("La sélection de dossier nécessite l’application desktop Æ Games.");
    try {
      return await inspectBrowserDirectory(await picker());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  },

  async verifyHypeInstallation(path: string): Promise<HypeInstallReport> {
    if (!isTauri()) throw new Error("La revérification automatique nécessite l’application desktop Æ Games.");
    return invoke<HypeInstallReport>('verify_hype_installation', { path });
  },

  async checkHypeUpdate(path?: string): Promise<HypeReleaseInfo> {
    if (!isTauri()) throw new Error("La recherche de mises à jour de Hype nécessite l’application desktop Æ Games.");
    return invoke<HypeReleaseInfo>('check_hype_update', { path: path || null });
  },

  async installHype(path: string, onProgress: (progress: HypeDownloadProgress) => void): Promise<HypeInstallReport> {
    if (!isTauri()) throw new Error("L’installation de Hype nécessite l’application desktop Æ Games.");
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<HypeDownloadProgress>('hype-download-progress', (event) => onProgress(event.payload));
    try {
      return await invoke<HypeInstallReport>('install_hype', { path });
    } finally {
      unlisten();
    }
  },

  async cancelHypeDownload(): Promise<void> {
    if (!isTauri()) return;
    await invoke('cancel_hype_download');
  },

  async launchHype(path: string): Promise<void> {
    if (!isTauri()) throw new Error("Hype.exe ne peut être lancé que depuis l’application desktop Æ Games.");
    await invoke('launch_hype', { path });
  },

  async isHypeRunning(): Promise<boolean> {
    if (!isTauri()) return false;
    return invoke<boolean>('is_hype_running');
  },

  async stopHype(): Promise<void> {
    if (!isTauri()) return;
    await invoke('stop_hype');
  },

  async revealHypeInstallation(path: string): Promise<void> {
    if (!isTauri()) throw new Error("L’ouverture du dossier nécessite l’application desktop Æ Games.");
    await invoke('reveal_hype_installation', { path });
  },

  async uninstallHype(path: string): Promise<void> {
    if (!isTauri()) throw new Error("La désinstallation nécessite l’application desktop Æ Games.");
    await invoke('uninstall_hype', { path });
  },

  async selectInstallDirectory(): Promise<string | null> {
    if (isTauri()) return invoke<string | null>('select_install_directory');
    const picker = (window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
    }).showDirectoryPicker;
    if (!picker) throw new Error("La sélection de dossier nécessite l’application desktop Æ Games.");
    try { return (await picker()).name; }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  },

  async verifyLauncherInstallation(): Promise<string> {
    if (!isTauri()) return 'Le diagnostic complet sera disponible dans l’application desktop.';
    return invoke<string>('verify_launcher_installation');
  },

  async getLauncherVersion(): Promise<string> {
    if (!isTauri()) return '0.1.0 (aperçu web)';
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  },

  async checkLauncherUpdate(): Promise<LauncherUpdateInfo | null> {
    if (!isTauri()) throw new Error('La recherche de mises à jour nécessite l’application desktop.');
    if (pendingLauncherUpdate) {
      await pendingLauncherUpdate.close();
      pendingLauncherUpdate = null;
    }
    const { check } = await import('@tauri-apps/plugin-updater');
    pendingLauncherUpdate = await check({ timeout: 15_000 });
    if (!pendingLauncherUpdate) return null;
    return {
      currentVersion: pendingLauncherUpdate.currentVersion,
      version: pendingLauncherUpdate.version,
      date: pendingLauncherUpdate.date,
      notes: pendingLauncherUpdate.body,
    };
  },

  async installLauncherUpdate(onProgress: (percentage: number) => void): Promise<void> {
    if (!pendingLauncherUpdate) throw new Error('Aucune mise à jour n’est prête à être installée.');
    let downloaded = 0;
    let total = 0;
    await pendingLauncherUpdate.download((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
        onProgress(0);
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        onProgress(total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0);
      } else {
        onProgress(100);
      }
    });
    await pendingLauncherUpdate.install({ restartAfterInstall: true });
  },
};
