import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Session, User } from '@supabase/supabase-js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { launcherAdapter, type HypeAchievementLaunchConfig, type HypeDownloadProgress, type HypeInstallReport, type HypeReleaseNews } from './launcher/adapter';
import { GamePageHero } from './components/GamePage';
import { CustomSelect } from './components/CustomSelect';
import { GameStatisticsModal } from './components/GameStatisticsModal';
import { defaultProfileShowcase, defaultProfileShelves, defaultProfileTheme, isUsernameAvailable, listenForAuthCallbacks, loadProfile, normalizeProfileShelves, normalizeProfileTheme, normalizeUsername, profileFromUser, savePresenceStatus, saveProfile as saveProfileRecord, saveProfileCustomization, saveProfileMedia, saveProfileTheme, signInWithDiscord, validateUsername, type PresenceStatus, type ProfileAchievementKey, type ProfileCustomization, type ProfileData, type ProfileGameKey, type ProfileShowcase, type ProfileShowcaseKey, type ProfileStatisticKey, type ProfileTheme } from './lib/auth';
import { blockProfile, loadProfileFriends, loadPublicProfile, removeFriend, respondToFriendRequest, searchProfiles, sendFriendRequest, unblockProfile, type FriendProfile, type PublicProfile } from './lib/friends';
import { supabase, supabasePublicConfig } from './lib/supabase';
import { SocialProvider, useSocial } from './lib/social';
import { createHypeAchievementSession, loadMyHypeAchievements, loadProfileHypeAchievements, revokeHypeAchievementSessions, type HypeAchievement, type PublicHypeAchievement } from './lib/achievements';
import { loadReadNewsKeys, markNewsKeyRead } from './lib/news';
import { beginGameSession, finishGameSession, heartbeatGameSession, loadGameStatisticsSummary, type GameId, type GameStatisticsSummary } from './lib/gameStats';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Ban,
  Bell,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CalendarDays,
  Download,
  Edit3,
  Eye,
  Flame,
  FolderOpen,
  Gamepad2,
  Gauge,
  Globe2,
  GripVertical,
  Heading2,
  Heading3,
  HardDrive,
  Heart,
  Home,
  Italic,
  Library,
  LayoutGrid,
  Link2,
  Lock,
  List,
  ListOrdered,
  Maximize2,
  MessageCircle,
  Minus,
  Monitor,
  MoreHorizontal,
  MoveRight,
  Newspaper,
  Play,
  Palette,
  Quote,
  RefreshCw,
  Search,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Volume2,
  Wifi,
  Wrench,
  Zap,
  X,
} from 'lucide-react';

type Page = 'accueil' | 'bibliotheque' | 'telechargements' | 'reglages' | 'laliferp' | 'hype' | 'profil';
type InstallState = 'available' | 'downloading' | 'installed';

const hypeLogoWhite = '/assets/hype-logo-white.svg';
const hypeIcon = '/assets/hype-icon.svg';
const hypeAvatar = '/assets/hype-avatar.svg';

type LauncherSettings = {
  scaleMode: 'auto' | 'custom';
  uiScale: number;
  compactMode: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  launchAtStartup: boolean;
  startMinimized: boolean;
  minimizeOnGameLaunch: boolean;
  restoreAfterGame: boolean;
  closeToTray: boolean;
  defaultInstallPath: string;
  bandwidthLimit: number;
  concurrentDownloads: number;
  autoUpdates: boolean;
  scheduledDownloads: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  friendNotifications: boolean;
  inviteNotifications: boolean;
  achievementNotifications: boolean;
  downloadNotifications: boolean;
  newsNotifications: boolean;
  notificationSounds: boolean;
  shareGameActivity: boolean;
  discordPresence: boolean;
  shareOnlineStatus: boolean;
  crashReports: boolean;
  releaseChannel: 'stable' | 'beta';
};

const defaultLauncherSettings: LauncherSettings = {
  scaleMode: 'auto', uiScale: 100, compactMode: false, reducedMotion: false, highContrast: false,
  launchAtStartup: false, startMinimized: false, minimizeOnGameLaunch: true, restoreAfterGame: true, closeToTray: true,
  defaultInstallPath: '', bandwidthLimit: 0, concurrentDownloads: 2, autoUpdates: true, scheduledDownloads: false, scheduleStart: '01:00', scheduleEnd: '07:00',
  friendNotifications: true, inviteNotifications: true, achievementNotifications: true, downloadNotifications: true, newsNotifications: true, notificationSounds: true,
  shareGameActivity: true, discordPresence: true, shareOnlineStatus: true, crashReports: false, releaseChannel: 'stable',
};

const MIN_INTERFACE_WIDTH = 1180;
const MIN_INTERFACE_HEIGHT = 700;

function hexToRgbChannels(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '143,135,255';
  const value = Number.parseInt(match[1], 16);
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}

function getAutomaticInterfaceScale() {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const physicalWidth = window.screen.width * devicePixelRatio;
  const physicalHeight = window.screen.height * devicePixelRatio;

  if (physicalWidth >= 3800 && physicalHeight >= 2100) return 1.5;
  if (physicalWidth >= 3000) return 1.28;
  if (physicalWidth >= 2200) return 1.16;
  return 1;
}

function loadLauncherSettings(): LauncherSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('ae-launcher-settings') || '{}') as Partial<LauncherSettings>;
    const legacyScale = Number(localStorage.getItem('ae-ui-scale'));
    const settings = { ...defaultLauncherSettings, ...saved };
    const migratedScale = legacyScale >= .8 && legacyScale <= 2 ? Math.round(legacyScale * 100) : settings.uiScale;
    return { ...settings, uiScale: Math.min(200, Math.max(80, Number(migratedScale) || 100)), ...(legacyScale >= .8 && legacyScale <= 2 ? { scaleMode: 'custom' as const } : {}) };
  } catch { return defaultLauncherSettings; }
}

type CropTarget = { source: string; kind: 'avatarDataUrl' | 'bannerDataUrl' };

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture impossible'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function renderCroppedImage(source: string, kind: CropTarget['kind'], x: number, y: number, zoom: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Image invalide'));
    image.onload = () => {
      const aspect = kind === 'avatarDataUrl' ? 1 : 3.5;
      let sourceWidth = image.width;
      let sourceHeight = image.width / aspect;
      if (sourceHeight > image.height) {
        sourceHeight = image.height;
        sourceWidth = image.height * aspect;
      }
      sourceWidth /= zoom;
      sourceHeight /= zoom;
      const sourceX = (image.width - sourceWidth) * (x / 100);
      const sourceY = (image.height - sourceHeight) * (y / 100);
      const canvas = document.createElement('canvas');
      canvas.width = kind === 'avatarDataUrl' ? 420 : 1400;
      canvas.height = kind === 'avatarDataUrl' ? 420 : 400;
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Conversion impossible'));
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/webp', kind === 'avatarDataUrl' ? .86 : .8));
    };
    image.src = source;
  });
}

function ImageCropDialog({ target, onCancel, onConfirm }: { target: CropTarget; onCancel: () => void; onConfirm: (dataUrl: string, kind: CropTarget['kind']) => void | Promise<void> }) {
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(await renderCroppedImage(target.source, target.kind, x, y, zoom), target.kind); }
    catch { /* Le parent affiche l’erreur et conserve le dialogue ouvert. */ }
    finally { setBusy(false); }
  };
  return createPortal(<div className="crop-dialog-backdrop"><section className="crop-dialog" role="dialog" aria-modal="true" aria-label="Recadrer l’image"><header><div><span>APERÇU</span><h2>Choisir le meilleur cadrage</h2></div><button aria-label="Fermer" onClick={onCancel}><X size={18} /></button></header><div className={`crop-preview ${target.kind === 'avatarDataUrl' ? 'avatar-crop' : 'banner-crop'}`}><img src={target.source} alt="Aperçu du recadrage" style={{ objectPosition: `${x}% ${y}%`, transform: `scale(${zoom})` }} /></div><div className="crop-controls"><label>Horizontal<input type="range" min="0" max="100" value={x} onChange={(event) => setX(Number(event.target.value))} /></label><label>Vertical<input type="range" min="0" max="100" value={y} onChange={(event) => setY(Number(event.target.value))} /></label><label>Zoom<input type="range" min="1" max="2.5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label></div><footer><button onClick={onCancel}>Annuler</button><button className="crop-confirm" disabled={busy} onClick={() => void confirm()}>{busy ? 'Préparation…' : 'Utiliser ce cadrage'}</button></footer></section></div>, document.body);
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <img src="/assets/ae-mark.png" alt="" />
      {!compact && (
        <div>
          <strong>Æ Games</strong>
          <span>Créateurs d’expériences</span>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin, busy, initializing, error }: { onLogin: () => void; busy: boolean; initializing: boolean; error: string }) {
  return (
    <main className="login-page">
      <div className="login-grain" />
      <section className="login-panel">
        <div className="auth-card">
          <div className="auth-logo"><BrandMark compact /></div>
          <h2>Æ Games</h2>
          <p>Connectez-vous avec Discord pour accéder à votre bibliothèque.</p>
          <button className="discord-button" disabled={busy || initializing} onClick={onLogin}>
            <FontAwesomeIcon className="discord-logo" icon={faDiscord} />
            {initializing ? 'Restauration de la session…' : busy ? 'Ouverture de Discord…' : 'Continuer avec Discord'}
          </button>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <small>Connexion sécurisée par Discord et Supabase.</small>
        </div>
      </section>
    </main>
  );
}

function Sidebar({ page, setPage, installState, progress, hypeRunning, user, onSignOut, onOpenProfile }: { page: Page; setPage: (page: Page) => void; installState: InstallState; progress: number; hypeRunning: boolean; user: User; onSignOut: () => void; onOpenProfile: (userId: string) => void }) {
  const profileAreaRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<ProfileData>(() => profileFromUser(user));
  const [draft, setDraft] = useState(profile);
  const [status, setStatus] = useState<PresenceStatus>(profile.status);
  const [mediaError, setMediaError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error'>('idle');
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const statusLabel = status === 'online' ? 'En ligne' : status === 'busy' ? 'Occupé' : 'Invisible';
  const profileInitials = profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'Æ';

  useEffect(() => {
    let active = true;
    loadProfile(user).then((loaded) => {
      if (!active) return;
      setProfile(loaded);
      setDraft(loaded);
      setStatus(loaded.status);
    }).catch(() => {
      if (active) setMediaError('Le profil distant est indisponible. Exécutez la migration Supabase si nécessaire.');
    });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    const applyProfileUpdate = (event: Event) => {
      const updated = (event as CustomEvent<ProfileData>).detail;
      setProfile(updated);
      setDraft(updated);
      setStatus(updated.status);
    };
    window.addEventListener('ae-profile-updated', applyProfileUpdate);
    return () => window.removeEventListener('ae-profile-updated', applyProfileUpdate);
  }, []);

  useEffect(() => {
    if (!editing) {
      setUsernameAvailability('idle');
      return;
    }

    const username = normalizeUsername(draft.username);
    if (validateUsername(username)) {
      setUsernameAvailability('invalid');
      return;
    }
    if (username === profile.username) {
      setUsernameAvailability('available');
      return;
    }

    let active = true;
    setUsernameAvailability('checking');
    const timer = window.setTimeout(() => {
      void isUsernameAvailable(username).then((available) => {
        if (active) setUsernameAvailability(available ? 'available' : 'taken');
      }).catch(() => {
        if (active) setUsernameAvailability('error');
      });
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft.username, editing, profile.username]);

  useEffect(() => {
    const closeProfile = () => setProfileOpen(false);
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (profileOpen && !profileAreaRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    window.addEventListener('close-profile-menu', closeProfile);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => { window.removeEventListener('close-profile-menu', closeProfile); document.removeEventListener('pointerdown', closeOnOutsideClick); };
  }, [profileOpen]);

  const updateProfileMedia = async (file: File | undefined, kind: 'avatarDataUrl' | 'bannerDataUrl') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMediaError('Choisissez une image valide.'); return; }
    try {
      setMediaError('');
      setCropTarget({ source: await readImageFile(file), kind });
    } catch { setMediaError('Cette image n’a pas pu être préparée.'); }
  };

  const applyCroppedMedia = async (dataUrl: string, kind: CropTarget['kind']) => {
    const previousValue = profile[kind];
    setDraft((current) => ({ ...current, [kind]: dataUrl }));
    setProfile((current) => ({ ...current, [kind]: dataUrl }));
    try {
      await saveProfileMedia(user, kind, dataUrl);
      const nextProfile = { ...profile, [kind]: dataUrl, status };
      window.dispatchEvent(new CustomEvent<ProfileData>('ae-profile-updated', { detail: nextProfile }));
      setMediaError('');
    } catch (error) {
      setDraft((current) => ({ ...current, [kind]: previousValue }));
      setProfile((current) => ({ ...current, [kind]: previousValue }));
      setMediaError(error instanceof Error ? error.message : 'Cette image n’a pas pu être enregistrée.');
      throw error;
    }
  };

  const saveProfileChanges = async () => {
    const username = normalizeUsername(draft.username);
    const usernameError = validateUsername(username);
    if (usernameError) {
      setUsernameAvailability('invalid');
      setMediaError(usernameError);
      return;
    }
    setSavingProfile(true);
    try {
      setUsernameAvailability('checking');
      if (!(await isUsernameAvailable(username))) {
        setUsernameAvailability('taken');
        setMediaError('Ce pseudo est déjà utilisé.');
        return;
      }
      const nextProfile = { ...draft, username, status };
      await saveProfileRecord(user, nextProfile);
      setProfile(nextProfile);
      setDraft(nextProfile);
      window.dispatchEvent(new CustomEvent<ProfileData>('ae-profile-updated', { detail: nextProfile }));
      setEditing(false);
      setMediaError('');
    } catch (error) {
      setUsernameAvailability('error');
      setMediaError(error instanceof Error ? error.message : 'Le profil n’a pas pu être enregistré.');
    } finally {
      setSavingProfile(false);
    }
  };

  const changeStatus = async (nextStatus: PresenceStatus) => {
    const previousStatus = status;
    const nextProfile = { ...profile, status: nextStatus };
    setStatus(nextStatus);
    setProfile(nextProfile);
    try {
      await savePresenceStatus(user.id, nextStatus);
      setDraft((current) => ({ ...current, status: nextStatus }));
      window.dispatchEvent(new CustomEvent<ProfileData>('ae-profile-updated', { detail: nextProfile }));
      setMediaError('');
    } catch (reason) {
      setStatus(previousStatus);
      setProfile({ ...profile, status: previousStatus });
      setMediaError(reason instanceof Error ? reason.message : 'Le statut n’a pas pu être mis à jour.');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><BrandMark /></div>
      <nav className="main-nav" aria-label="Navigation principale">
        <button className={page === 'accueil' ? 'active' : ''} onClick={() => setPage('accueil')}><Home size={18} /> Accueil</button>
        <button className={page === 'bibliotheque' ? 'active' : ''} onClick={() => setPage('bibliotheque')}><Library size={18} /> Bibliothèque <span className="count">2</span></button>
      </nav>
      <div className="game-groups game-rail">
        <div className="group-title"><span>Æ ORIGINALS</span><ChevronDown size={14} /></div>
        <button className={`game-link ${page === 'hype' ? 'active' : ''}`} onClick={() => setPage('hype')}>
          <img src={hypeIcon} alt="" /><span><b>Hype</b><small className={hypeRunning ? 'game-running-label' : ''}>{hypeRunning && <i className="online-dot" />}{hypeRunning ? 'En jeu' : installState === 'downloading' ? `${progress} %` : installState === 'installed' ? 'Prêt à jouer' : 'Non installé'}</small></span><i className="rail-signal" />
        </button>
        <div className="group-title"><span>FIVEM</span><ChevronDown size={14} /></div>
        <button className={`game-link ${page === 'laliferp' ? 'active' : ''}`} onClick={() => setPage('laliferp')}>
          <img src="/assets/laliferp-cover.png" alt="" /><span><b>L.A LifeRP</b><small><i className="online-dot" /> 312 en ligne</small></span><i className="rail-signal" />
        </button>
      </div>
      <div className="sidebar-spacer" />
      <nav className="utility-nav">
        <button className={page === 'telechargements' ? 'active' : ''} onClick={() => setPage('telechargements')}><Download size={18} /> Téléchargements {installState === 'downloading' && <span className="status-pill">{progress}</span>}</button>
        <button className={page === 'reglages' ? 'active' : ''} onClick={() => setPage('reglages')}><Settings size={18} /> Réglages</button>
      </nav>
      <div className="profile-area" ref={profileAreaRef}>
        {profileOpen && (
          <section className="profile-popover">
            <div className={`profile-banner ${editing ? 'editable-media' : ''}`}>
              {(editing ? draft.bannerDataUrl : profile.bannerDataUrl) && <img className="profile-banner-image" src={editing ? draft.bannerDataUrl : profile.bannerDataUrl} alt="" />}
              <span className="profile-banner-shade" />
              {editing && <label className="profile-media-trigger banner-trigger"><Edit3 size={13} /><span>Modifier la bannière</span><input type="file" accept="image/*" aria-label="Modifier la bannière" onChange={(event) => { const input = event.currentTarget; void updateProfileMedia(input.files?.[0], 'bannerDataUrl').finally(() => { input.value = ''; }); }} /></label>}
            </div>
            <div className="profile-summary">
              <span className={`profile-avatar ${(editing ? draft.avatarDataUrl : profile.avatarDataUrl) ? 'has-image' : ''} ${editing ? 'editable-media' : ''}`} style={(editing ? draft.avatarDataUrl : profile.avatarDataUrl) ? { backgroundImage: `url('${editing ? draft.avatarDataUrl : profile.avatarDataUrl}')` } : undefined}>
                {!(editing ? draft.avatarDataUrl : profile.avatarDataUrl) && profileInitials}<i className={`status-${status}`} />
                {editing && <label className="profile-media-trigger avatar-trigger" aria-label="Modifier la photo de profil"><Edit3 size={14} /><input type="file" accept="image/*" aria-label="Modifier la photo de profil" onChange={(event) => { const input = event.currentTarget; void updateProfileMedia(input.files?.[0], 'avatarDataUrl').finally(() => { input.value = ''; }); }} /></label>}
              </span>
              {editing ? (
                <div className="profile-editor">
                  <label>Nom<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                  <label>Pseudo<div className="username-field"><span>@</span><input value={draft.username} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => { setMediaError(''); setDraft({ ...draft, username: normalizeUsername(event.target.value) }); }} /></div><small className={`username-feedback ${usernameAvailability}`}>{usernameAvailability === 'checking' ? 'Vérification…' : usernameAvailability === 'available' ? 'Pseudo disponible' : usernameAvailability === 'taken' ? 'Ce pseudo est déjà utilisé' : usernameAvailability === 'invalid' ? '2 à 24 caractères : lettres, chiffres, . et _' : usernameAvailability === 'error' ? 'Disponibilité momentanément impossible à vérifier' : '2 à 24 caractères'}</small></label>
                  <label>Bio<textarea value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
                  {mediaError && <p className="media-error">{mediaError}</p>}
                  <div><button onClick={() => setEditing(false)}>Annuler</button><button className="save-profile" disabled={savingProfile || usernameAvailability === 'checking' || usernameAvailability === 'taken' || usernameAvailability === 'invalid'} onClick={() => void saveProfileChanges()}>{savingProfile ? 'Enregistrement…' : 'Enregistrer'}</button></div>
                </div>
              ) : (
                <div className="profile-identity"><h3>{profile.name}</h3><span>@{profile.username}</span><p>{profile.bio || 'Aucune bio pour le moment.'}</p></div>
              )}
            </div>
            {!editing && <><div className="status-picker"><span>Statut</span><div><button className={status === 'online' ? 'active' : ''} onClick={() => void changeStatus('online')}><i className="status-online" />En ligne</button><button className={status === 'busy' ? 'active' : ''} onClick={() => void changeStatus('busy')}><i className="status-busy" />Occupé</button><button className={status === 'invisible' ? 'active' : ''} onClick={() => void changeStatus('invisible')}><i className="status-invisible" />Invisible</button></div></div><button className="profile-view" onClick={() => { setProfileOpen(false); onOpenProfile(user.id); }}><UserRound size={13} /> Voir le profil</button><button className="profile-signout" onClick={onSignOut}>Se déconnecter</button></>}
          </section>
        )}
        <button className={`profile-mini ${profileOpen ? 'active' : ''}`} aria-expanded={profileOpen} onClick={() => { if (!profileOpen) window.dispatchEvent(new Event('close-topbar-menus')); setProfileOpen((open) => !open); setEditing(false); }}>
          <span className={`avatar ${profile.avatarDataUrl ? 'has-image' : ''}`} style={profile.avatarDataUrl ? { backgroundImage: `url('${profile.avatarDataUrl}')` } : undefined}>{!profile.avatarDataUrl && profileInitials}</span>
          <span><b>{profile.name}</b><small><i className={`status-${status}`} /> {statusLabel}</small></span>
          <MoreHorizontal size={18} />
        </button>
      </div>
      {cropTarget && <ImageCropDialog target={cropTarget} onCancel={() => setCropTarget(null)} onConfirm={async (dataUrl, kind) => { await applyCroppedMedia(dataUrl, kind); setCropTarget(null); }} />}
    </aside>
  );
}

function friendCategory(friend: FriendProfile): 'playing' | 'online' | 'offline' {
  if (friend.currentGame) return 'playing';
  if (friend.presenceStatus !== 'invisible') return 'online';
  return 'offline';
}

function FriendAvatar({ friend, compact = false }: { friend: FriendProfile; compact?: boolean }) {
  const offline = friendCategory(friend) === 'offline';
  return <span className={`${compact ? 'friend-avatar' : 'friend-list-avatar'} ${friend.avatarUrl ? 'has-photo' : ''} ${offline ? 'is-offline' : ''}`} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 2).toUpperCase()}<i className={friend.currentGame ? 'status-playing' : `status-${friend.presenceStatus}`} /></span>;
}

function FriendActions({ friend, open, busy, onToggle, onProfile, onDelete, onBlock, triggerLabel, showProfile = true }: { friend: FriendProfile; open: boolean; busy: boolean; onToggle: (event: React.MouseEvent) => void; onProfile: () => void; onDelete: () => void; onBlock: () => void; triggerLabel?: string; showProfile?: boolean }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = 116;
      setPosition({
        top: rect.bottom + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 5) : rect.bottom + 5,
        left: Math.max(8, Math.min(window.innerWidth - 184, rect.right - 176)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  return <div className={`friend-row-menu ${triggerLabel ? 'labelled' : ''}`}><button ref={buttonRef} aria-label={`Actions pour ${friend.displayName}`} onClick={onToggle}>{triggerLabel ? <><Settings size={14} /> {triggerLabel}</> : <MoreHorizontal size={18} />}</button>{open && createPortal(<div className="friend-context-menu" style={{ ...position, visibility: position.left ? 'visible' : 'hidden' }} onClick={(event) => event.stopPropagation()}>{showProfile && <button onClick={onProfile}><UserRound size={14} /> Ouvrir le profil</button>}<button className="danger" disabled={busy} onClick={onDelete}><Trash2 size={14} /> Supprimer</button><button className="danger" disabled={busy} onClick={onBlock}><Ban size={14} /> Bloquer</button></div>, document.body)}</div>;
}

function SocialFriendSections({ friends: friendList, compact = false, menuId, busyId, onMenu, onProfile, onDelete, onBlock }: { friends: FriendProfile[]; compact?: boolean; menuId: string | null; busyId: string | null; onMenu: (id: string | null) => void; onProfile: (friend: FriendProfile) => void; onDelete: (friend: FriendProfile) => void; onBlock: (friend: FriendProfile) => void }) {
  const groups = [
    { id: 'playing', label: 'En jeu', items: friendList.filter((friend) => friendCategory(friend) === 'playing') },
    { id: 'online', label: 'En ligne', items: friendList.filter((friend) => friendCategory(friend) === 'online') },
    { id: 'offline', label: 'Hors ligne', items: friendList.filter((friend) => friendCategory(friend) === 'offline') },
  ];
  if (!friendList.length) return <p className={compact ? 'drawer-empty' : 'friend-dialog-empty'}>Votre liste d’amis est encore vide.</p>;
  return <div className={`social-friend-sections ${compact ? 'compact' : ''}`}>{groups.map((group) => group.items.length > 0 && <section key={group.id} className={`social-friend-group ${group.id}`}><div className="friend-section-title"><h3>{group.label}</h3><span>{group.items.length}</span></div>{group.items.map((friend) => <article className="social-friend-row" key={friend.userId} onClick={() => onProfile(friend)}><FriendAvatar friend={friend} compact={compact} /><span className="social-friend-copy"><b>{friend.displayName}</b><small>{friend.currentGame || (friend.presenceStatus === 'busy' ? 'Occupé' : group.id === 'online' ? 'Disponible' : `@${friend.username}`)}</small></span><FriendActions friend={friend} open={menuId === friend.userId} busy={busyId === friend.userId} onToggle={(event) => { event.stopPropagation(); onMenu(menuId === friend.userId ? null : friend.userId); }} onProfile={() => onProfile(friend)} onDelete={() => onDelete(friend)} onBlock={() => onBlock(friend)} /></article>)}</section>)}</div>;
}

type LauncherNotification = {
  id: string;
  title: string;
  detail: string;
  createdAt: number;
  read: boolean;
};

function Topbar({ setPage, onOpenProfile, notifications, onMarkNotificationsRead }: { setPage: (page: Page) => void; onOpenProfile: (userId: string) => void; notifications: LauncherNotification[]; onMarkNotificationsRead: () => void }) {
  const topbarRef = useRef<HTMLElement>(null);
  const { relationships, blockedProfiles, refresh: refreshRelationships, applyPresence, error: socialError } = useSocial();
  const [openPanel, setOpenPanel] = useState<'friends' | 'notifications' | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [friendDialog, setFriendDialog] = useState<'search' | 'list' | null>(null);
  const [friendQuery, setFriendQuery] = useState('');
  const [friendResults, setFriendResults] = useState<FriendProfile[]>([]);
  const [friendLoading, setFriendLoading] = useState(false);
  const [friendBusyId, setFriendBusyId] = useState<string | null>(null);
  const [friendError, setFriendError] = useState('');
  const [friendMenuId, setFriendMenuId] = useState<string | null>(null);
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const acceptedFriends = relationships.filter((friend) => friend.relationshipStatus === 'accepted');
  const incomingRequests = relationships.filter((friend) => friend.relationshipStatus === 'pending' && friend.direction === 'incoming');
  const onlineFriends = acceptedFriends.filter((friend) => friend.presenceStatus !== 'invisible');
  const categoryOrder = { playing: 0, online: 1, offline: 2 };
  const sortedFriends = [...acceptedFriends].sort((a, b) => categoryOrder[friendCategory(a)] - categoryOrder[friendCategory(b)] || a.displayName.localeCompare(b.displayName));
  const searchItems: Array<{ label: string; detail: string; page?: Page; userId?: string; type: string; art?: string }> = [
    { label: 'L.A LifeRP', detail: 'Jeu FiveM', page: 'laliferp', type: 'Jeu', art: '/assets/laliferp-cover.png' },
    { label: 'Hype', detail: 'Æ Originals', page: 'hype', type: 'Jeu', art: hypeIcon },
    { label: 'Bibliothèque', detail: 'Vos jeux', page: 'bibliotheque', type: 'Page' },
    { label: 'Téléchargements', detail: 'Installations et mises à jour', page: 'telechargements', type: 'Page' },
    ...acceptedFriends.map((friend) => ({ label: friend.displayName, detail: `@${friend.username}`, userId: friend.userId, type: 'Ami', art: friend.avatarUrl })),
  ];
  const results = query.trim() ? searchItems.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase())) : [];

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search input')?.focus();
        setSearchOpen(true);
      }
    };
    const closeMenus = () => { setOpenPanel(null); setSearchOpen(false); };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('.friend-context-menu')) return;
      if (!topbarRef.current?.contains(event.target as Node)) closeMenus();
    };
    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('close-topbar-menus', closeMenus);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => { window.removeEventListener('keydown', handleShortcut); window.removeEventListener('close-topbar-menus', closeMenus); document.removeEventListener('pointerdown', closeOnOutsideClick); };
  }, []);

  useEffect(() => {
    if (friendDialog !== 'search' || friendQuery.trim().length < 2) {
      setFriendResults([]);
      setFriendLoading(false);
      return;
    }
    let active = true;
    setFriendLoading(true);
    setFriendError('');
    const timer = window.setTimeout(() => {
      void searchProfiles(friendQuery).then((profiles) => {
        if (active) setFriendResults(profiles.map(applyPresence));
      }).catch((error: unknown) => {
        if (active) setFriendError(error instanceof Error ? error.message : 'La recherche est indisponible.');
      }).finally(() => {
        if (active) setFriendLoading(false);
      });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [applyPresence, friendDialog, friendQuery]);

  const openFriendDialog = (dialog: 'search' | 'list') => {
    setOpenPanel(null);
    setFriendError('');
    setFriendMenuId(null);
    setFriendDialog(dialog);
    void refreshRelationships();
  };

  const requestFriend = async (friend: FriendProfile) => {
    setFriendBusyId(friend.userId);
    setFriendError('');
    try {
      await sendFriendRequest(friend.userId);
      await refreshRelationships();
      setFriendResults((current) => current.map((item) => item.userId === friend.userId ? { ...item, relationshipStatus: friend.direction === 'incoming' ? 'accepted' : 'pending', direction: friend.direction === 'incoming' ? null : 'outgoing' } : item));
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'La demande n’a pas pu être envoyée.');
    } finally {
      setFriendBusyId(null);
    }
  };

  const respondToRequest = async (friend: FriendProfile, accept: boolean) => {
    if (!friend.friendshipId) return;
    setFriendBusyId(friend.userId);
    try {
      await respondToFriendRequest(friend.friendshipId, accept);
      await refreshRelationships();
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'La demande n’a pas pu être traitée.');
    } finally {
      setFriendBusyId(null);
    }
  };

  const deleteFriend = async (friend: FriendProfile) => {
    setFriendBusyId(friend.userId);
    try {
      await removeFriend(friend.userId);
      setFriendMenuId(null);
      await refreshRelationships();
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Cet ami n’a pas pu être supprimé.');
    } finally {
      setFriendBusyId(null);
    }
  };

  const blockFriend = async (friend: FriendProfile) => {
    setFriendBusyId(friend.userId);
    try {
      await blockProfile(friend.userId);
      setFriendMenuId(null);
      await refreshRelationships();
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Ce profil n’a pas pu être bloqué.');
    } finally {
      setFriendBusyId(null);
    }
  };

  const unblockFriend = async (friend: FriendProfile) => {
    setFriendBusyId(friend.userId);
    try {
      await unblockProfile(friend.userId);
      await refreshRelationships();
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Ce profil n’a pas pu être débloqué.');
    } finally {
      setFriendBusyId(null);
    }
  };

  const openProfile = (friend: FriendProfile) => {
    setFriendMenuId(null);
    setFriendDialog(null);
    setOpenPanel(null);
    onOpenProfile(friend.userId);
  };

  const selectResult = (item: (typeof searchItems)[number]) => {
    if (item.page) setPage(item.page);
    else if (item.userId) onOpenProfile(item.userId);
    setQuery('');
    setSearchOpen(false);
  };
  const minimizeWindow = () => { if (launcherAdapter.environment === 'desktop') void getCurrentWindow().minimize(); };
  const toggleMaximizeWindow = () => { if (launcherAdapter.environment === 'desktop') void getCurrentWindow().toggleMaximize(); };
  const closeWindow = () => { if (launcherAdapter.environment === 'desktop') void getCurrentWindow().close(); };

  return (
    <>
    <header className="topbar" ref={topbarRef} data-tauri-drag-region>
      <div className="search-shell">
        <label className={`search ${searchOpen ? 'active' : ''}`}><Search size={17} /><input aria-label="Rechercher" placeholder="Rechercher un jeu, un ami…" value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => { window.dispatchEvent(new Event('close-profile-menu')); setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) selectResult(results[0]); if (event.key === 'Escape') setSearchOpen(false); }} /><kbd>⌘ K</kbd></label>
        {searchOpen && query && <div className="search-results">{results.length ? results.map((item) => <button key={`${item.type}-${item.label}`} onClick={() => selectResult(item)}><span className={`search-result-icon ${item.art ? 'has-art' : ''}`}>{item.art ? <img src={item.art} alt="" /> : <Library size={16} />}</span><span><b>{item.label}</b><small>{item.detail}</small></span><em>{item.type}</em></button>) : <p>Aucun résultat pour « {query} »</p>}</div>}
      </div>
      <div className="topbar-menu-wrap">
        <button className={`party-peek ${openPanel === 'friends' ? 'active' : ''}`} aria-label="Voir mes amis" aria-expanded={openPanel === 'friends'} onClick={() => { window.dispatchEvent(new Event('close-profile-menu')); setOpenPanel(openPanel === 'friends' ? null : 'friends'); setSearchOpen(false); }}>
          {sortedFriends.length > 0 && <span className="party-avatars">{sortedFriends.slice(0, 3).map((friend) => <i className={friendCategory(friend) === 'offline' ? 'is-offline' : ''} key={friend.userId} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 1).toUpperCase()}</i>)}</span>}
          <span><b>{acceptedFriends.length} ami{acceptedFriends.length === 1 ? '' : 's'}</b><small>{onlineFriends.length} en ligne</small></span>
        </button>
        {openPanel === 'friends' && <div className="topbar-drawer friends-drawer" onClick={() => setFriendMenuId(null)}><div className="drawer-heading"><div><h3>Mes amis</h3><span>{onlineFriends.length} en ligne · {acceptedFriends.length} au total</span></div><button className="drawer-add-friend" aria-label="Ajouter un ami" onClick={() => openFriendDialog('search')}>+</button></div><SocialFriendSections friends={sortedFriends} compact menuId={friendMenuId} busyId={friendBusyId} onMenu={setFriendMenuId} onProfile={openProfile} onDelete={(friend) => void deleteFriend(friend)} onBlock={(friend) => void blockFriend(friend)} />{incomingRequests.length > 0 && <button className="drawer-requests" onClick={() => openFriendDialog('list')}>{incomingRequests.length} demande{incomingRequests.length > 1 ? 's' : ''} en attente</button>}{blockedProfiles.length > 0 && <button className="drawer-requests blocked" onClick={() => openFriendDialog('list')}><Ban size={12} /> {blockedProfiles.length} profil{blockedProfiles.length > 1 ? 's' : ''} bloqué{blockedProfiles.length > 1 ? 's' : ''}</button>}{friendError && <p className="drawer-feedback">{friendError}</p>}<button className="drawer-footer" onClick={() => openFriendDialog('list')}>Voir mes amis <ChevronRight size={14} /></button></div>}
      </div>
      <div className="topbar-menu-wrap">
        <button className={`icon-button ${openPanel === 'notifications' ? 'active' : ''}`} aria-label="Notifications" aria-expanded={openPanel === 'notifications'} onClick={() => { window.dispatchEvent(new Event('close-profile-menu')); setOpenPanel(openPanel === 'notifications' ? null : 'notifications'); setSearchOpen(false); }}><Bell size={18} />{unreadCount > 0 && <i />}</button>
        {openPanel === 'notifications' && <div className="topbar-drawer notifications-drawer"><div className="drawer-heading"><div><h3>Notifications</h3><span>{unreadCount > 0 ? `${unreadCount} nouvelle${unreadCount > 1 ? 's' : ''}` : 'À jour'}</span></div>{unreadCount > 0 && <button onClick={onMarkNotificationsRead}>Tout lire</button>}</div>{notifications.length === 0 ? <p className="drawer-empty">Aucune notification pour le moment.</p> : notifications.map((notification) => <button className="notification-item" key={notification.id}><span className="notification-symbol achievement"><Trophy size={16} /></span><span><b>{notification.title}</b><small>{notification.detail}</small></span><em>{Date.now() - notification.createdAt < 60_000 ? 'maintenant' : `${Math.max(1, Math.floor((Date.now() - notification.createdAt) / 60_000))} min`}</em></button>)}</div>}
      </div>
      <div className="window-buttons"><button aria-label="Réduire" onClick={minimizeWindow}><Minus size={15} /></button><button aria-label="Agrandir ou restaurer" onClick={toggleMaximizeWindow}><Maximize2 size={13} /></button><button aria-label="Fermer" onClick={closeWindow}><X size={15} /></button></div>
    </header>
    {friendDialog && createPortal(<div className="friend-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFriendDialog(null); }}><section className={`friend-dialog ${friendDialog === 'list' ? 'friend-dialog-large' : ''}`} role="dialog" aria-modal="true" aria-label={friendDialog === 'search' ? 'Ajouter un ami' : 'Mes amis'} onClick={() => setFriendMenuId(null)}><header><div><span>RÉSEAU Æ GAMES</span><h2>{friendDialog === 'search' ? 'Ajouter un ami' : 'Mes amis'}</h2></div><button aria-label="Fermer" onClick={() => setFriendDialog(null)}><X size={18} /></button></header>{friendDialog === 'search' ? <div className="friend-search-content"><label><Search size={17} /><input autoFocus value={friendQuery} onChange={(event) => setFriendQuery(event.target.value)} placeholder="Nom d’affichage ou @pseudo" /></label><p className="friend-search-hint">Saisissez au moins deux caractères.</p><div className="friend-search-results">{friendLoading && <p className="friend-dialog-empty">Recherche en cours…</p>}{!friendLoading && friendQuery.trim().length >= 2 && !friendResults.length && !friendError && <p className="friend-dialog-empty">Aucun joueur trouvé.</p>}{friendResults.map((friend) => <article key={friend.userId} onClick={() => openProfile(friend)}><FriendAvatar friend={friend} /><div><b>{friend.displayName}</b><small>@{friend.username}</small></div>{friend.relationshipStatus === 'accepted' ? <button disabled><Check size={14} /> Ami</button> : friend.direction === 'outgoing' ? <button disabled>Demande envoyée</button> : <button disabled={friendBusyId === friend.userId} onClick={(event) => { event.stopPropagation(); void requestFriend(friend); }}><UserPlus size={14} />{friend.direction === 'incoming' ? 'Accepter' : 'Ajouter'}</button>}</article>)}</div>{friendError && <p className="friend-dialog-error">{friendError}</p>}</div> : <div className="friend-list-content">{incomingRequests.length > 0 && <section className="friend-request-section"><div className="friend-section-title"><h3>Demandes reçues</h3><span>{incomingRequests.length}</span></div>{incomingRequests.map((friend) => <article key={friend.userId}><FriendAvatar friend={friend} /><div><b>{friend.displayName}</b><small>@{friend.username}</small></div><div className="friend-request-actions"><button disabled={friendBusyId === friend.userId} onClick={() => void respondToRequest(friend, false)}>Refuser</button><button className="accept" disabled={friendBusyId === friend.userId} onClick={() => void respondToRequest(friend, true)}>Accepter</button></div></article>)}</section>}<SocialFriendSections friends={sortedFriends} menuId={friendMenuId} busyId={friendBusyId} onMenu={setFriendMenuId} onProfile={openProfile} onDelete={(friend) => void deleteFriend(friend)} onBlock={(friend) => void blockFriend(friend)} />{blockedProfiles.length > 0 && <section className="blocked-profiles-section"><div className="friend-section-title"><h3>Profils bloqués</h3><span>{blockedProfiles.length}</span></div><p>Ces joueurs restent masqués de votre réseau jusqu’à leur déblocage.</p>{blockedProfiles.map((friend) => <article key={friend.userId}><FriendAvatar friend={friend} /><div><b>{friend.displayName}</b><small>@{friend.username}</small></div><button disabled={friendBusyId === friend.userId} onClick={() => void unblockFriend(friend)}>Débloquer</button></article>)}</section>}{friendError && <p className="friend-dialog-error">{friendError}</p>}</div>}</section></div>, document.body)}
    </>
  );
}

function ProfileMarkdown({ children }: { children: string }) {
  return (
    <div className="profile-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

const profileThemePresets: { name: string; theme: ProfileTheme; game?: ProfileGameKey; image?: string }[] = [
  { name: 'L.A LifeRP', game: 'laliferp', image: '/assets/laliferp-hero-cover.jpg', theme: { mode: 'gradient', background: '#070b12', backgroundSecondary: '#102a46', accent: '#007ffe', angle: 145, surfaceOpacity: 76 } },
  { name: 'Hype', game: 'hype', image: hypeAvatar, theme: { mode: 'gradient', background: '#110c0f', backgroundSecondary: '#381322', accent: '#ff4fa0', angle: 135, surfaceOpacity: 76 } },
];

function MarkdownBioEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const format = (prefix: string, suffix = '', placeholder = 'texte') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + prefix + selection + suffix + value.slice(end);
    onChange(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selection.length);
    });
  };
  const prefixLines = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = value.slice(start, end) || 'Nouvel élément';
    const transformed = selection.split('\n').map((line, index) => prefix === '1. ' ? String(index + 1) + '. ' + line : prefix + line).join('\n');
    onChange(value.slice(0, start) + transformed + value.slice(end));
    window.requestAnimationFrame(() => textarea.focus());
  };
  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar">
        <button type="button" aria-label="Gras" title="Gras" onClick={() => format('**', '**')}><Bold size={15} /></button>
        <button type="button" aria-label="Italique" title="Italique" onClick={() => format('*', '*')}><Italic size={15} /></button>
        <span />
        <button type="button" aria-label="Grand titre" title="Grand titre" onClick={() => prefixLines('## ')}><Heading2 size={15} /></button>
        <button type="button" aria-label="Petit titre" title="Petit titre" onClick={() => prefixLines('### ')}><Heading3 size={15} /></button>
        <span />
        <button type="button" aria-label="Liste" title="Liste" onClick={() => prefixLines('- ')}><List size={15} /></button>
        <button type="button" aria-label="Liste numérotée" title="Liste numérotée" onClick={() => prefixLines('1. ')}><ListOrdered size={15} /></button>
        <button type="button" aria-label="Citation" title="Citation" onClick={() => prefixLines('> ')}><Quote size={15} /></button>
        <button type="button" aria-label="Lien" title="Lien" onClick={() => format('[', '](https://)', 'libellé')}><Link2 size={15} /></button>
        <button type="button" className={preview ? 'active preview-toggle' : 'preview-toggle'} onClick={() => setPreview((current) => !current)}><Eye size={15} /> {preview ? 'Éditer' : 'Aperçu'}</button>
      </div>
      {preview
        ? <div className="markdown-preview"><ProfileMarkdown>{value || '*Votre bio apparaîtra ici.*'}</ProfileMarkdown></div>
        : <textarea ref={textareaRef} value={value} maxLength={3000} spellCheck onChange={(event) => onChange(event.target.value)} placeholder="Racontez votre histoire avec Markdown…" />}
      <small>{value.length} / 3 000 caractères</small>
    </div>
  );
}

function ProfileCustomizer({
  draft,
  setDraft,
  originalUsername,
  usernameAvailability,
  busy,
  error,
  onClose,
  onSave,
  onChooseMedia,
}: {
  draft: ProfileCustomization;
  setDraft: React.Dispatch<React.SetStateAction<ProfileCustomization>>;
  originalUsername: string;
  usernameAvailability: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
  onChooseMedia: (file: File | undefined, kind: CropTarget['kind']) => void;
}) {
  const [section, setSection] = useState<'content' | 'theme'>('content');
  const usernameChanged = normalizeUsername(draft.username) !== originalUsername;
  return createPortal(
    <div className="profile-customizer-backdrop" style={{ '--profile-accent': draft.theme.accent } as React.CSSProperties} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="profile-customizer" role="dialog" aria-modal="true" aria-label="Personnaliser le profil">
        <header>
          <div><span>STUDIO DE PROFIL</span><h2>Personnaliser votre espace</h2><p>Les changements de thème sont visibles en direct derrière cet éditeur.</p></div>
          <button aria-label="Fermer" onClick={onClose}><X size={18} /></button>
        </header>
        <nav>
          <button className={section === 'content' ? 'active' : ''} onClick={() => setSection('content')}><Edit3 size={15} /> Contenu</button>
          <button className={section === 'theme' ? 'active' : ''} onClick={() => setSection('theme')}><Palette size={15} /> Apparence</button>
        </nav>
        <div className="profile-customizer-content">
          {section === 'content' ? <>
            <div className="profile-editor-grid">
              <label>Nom d’affichage<input value={draft.displayName} maxLength={60} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
              <label>Pseudo<div className="username-field"><span>@</span><input value={draft.username} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setDraft((current) => ({ ...current, username: normalizeUsername(event.target.value) }))} /></div><small className={'username-feedback ' + usernameAvailability}>{!usernameChanged ? 'Votre pseudo actuel' : usernameAvailability === 'checking' ? 'Vérification…' : usernameAvailability === 'available' ? 'Pseudo disponible' : usernameAvailability === 'taken' ? 'Ce pseudo est déjà utilisé' : usernameAvailability === 'invalid' ? '2 à 24 caractères : lettres, chiffres, . et _' : usernameAvailability === 'error' ? 'Vérification indisponible' : ''}</small></label>
            </div>
            <div className="profile-media-editor">
              <div className="profile-media-sample banner" style={draft.bannerDataUrl ? { backgroundImage: 'url("' + draft.bannerDataUrl + '")' } : undefined}><span>Bannière</span><label><Edit3 size={14} /> Recadrer ou remplacer<input type="file" accept="image/*" onChange={(event) => { const input = event.currentTarget; onChooseMedia(input.files?.[0], 'bannerDataUrl'); input.value = ''; }} /></label></div>
              <div className="profile-media-sample avatar" style={draft.avatarDataUrl ? { backgroundImage: 'url("' + draft.avatarDataUrl + '")' } : undefined}><span>Photo</span><label><Edit3 size={14} /> Modifier<input type="file" accept="image/*" onChange={(event) => { const input = event.currentTarget; onChooseMedia(input.files?.[0], 'avatarDataUrl'); input.value = ''; }} /></label></div>
            </div>
            <label className="bio-editor-label"><span>Bio Markdown</span><MarkdownBioEditor value={draft.bio} onChange={(bio) => setDraft((current) => ({ ...current, bio }))} /></label>
          </> : <>
            <div className="theme-presets">
              <span>Ambiances</span>
              <div>{profileThemePresets.map((preset) => <button key={preset.name} className={JSON.stringify(draft.theme) === JSON.stringify(preset.theme) ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, theme: { ...preset.theme } }))}><i style={{ background: 'linear-gradient(135deg, ' + preset.theme.background + ', ' + preset.theme.backgroundSecondary + ')' }} /><b>{preset.name}</b></button>)}</div>
            </div>
            <div className="theme-controls">
              <label>Type de fond<CustomSelect value={draft.theme.mode} options={[{ value: 'gradient', label: 'Dégradé' }, { value: 'solid', label: 'Couleur unie' }]} onChange={(mode) => setDraft((current) => ({ ...current, theme: { ...current.theme, mode } }))} ariaLabel="Type de fond" /></label>
              <label>Couleur principale<span><input type="color" value={draft.theme.background} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, background: event.target.value } }))} /><code>{draft.theme.background}</code></span></label>
              <label className={draft.theme.mode === 'solid' ? 'disabled' : ''}>Deuxième couleur<span><input type="color" disabled={draft.theme.mode === 'solid'} value={draft.theme.backgroundSecondary} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, backgroundSecondary: event.target.value } }))} /><code>{draft.theme.backgroundSecondary}</code></span></label>
              <label>Couleur d’accent<span><input type="color" value={draft.theme.accent} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, accent: event.target.value } }))} /><code>{draft.theme.accent}</code></span></label>
              <label className={draft.theme.mode === 'solid' ? 'disabled range-control' : 'range-control'}>Direction du dégradé<span><input type="range" min="0" max="360" disabled={draft.theme.mode === 'solid'} value={draft.theme.angle} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, angle: Number(event.target.value) } }))} /><code>{draft.theme.angle}°</code></span></label>
              <label className="range-control">Opacité des cartes<span><input type="range" min="42" max="94" value={draft.theme.surfaceOpacity} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, surfaceOpacity: Number(event.target.value) } }))} /><code>{draft.theme.surfaceOpacity} %</code></span></label>
            </div>
          </>}
        </div>
        <footer>{error && <p>{error}</p>}<button onClick={onClose}>Annuler</button><button className="save-customization" disabled={busy || usernameAvailability === 'checking' || usernameAvailability === 'taken' || usernameAvailability === 'invalid'} onClick={onSave}><Save size={15} /> {busy ? 'Enregistrement…' : 'Enregistrer le profil'}</button></footer>
      </section>
    </div>,
    document.body,
  );
}

const profileShowcases: { key: ProfileShowcaseKey; label: string; description: string }[] = [
  { key: 'universes', label: 'Univers favoris', description: 'Les jeux qui définissent votre profil' },
  { key: 'activity', label: 'Activité récente', description: 'Votre session et votre disponibilité' },
  { key: 'achievements', label: 'Succès rares', description: 'Vos accomplissements les plus précieux' },
  { key: 'statistics', label: 'Statistiques', description: 'Temps de jeu et progression globale' },
  { key: 'favorite', label: 'Coup de cœur', description: 'Votre recommandation du moment' },
];

const profileGames: { key: ProfileGameKey; name: string; category: string; image: string }[] = [
  { key: 'laliferp', name: 'L.A LifeRP', category: 'FIVEM · ROLEPLAY', image: '/assets/laliferp-hero-cover.jpg' },
  { key: 'hype', name: 'Hype', category: 'Æ ORIGINALS', image: hypeAvatar },
];
function compactTrackedDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60}` : ''}` : `${minutes} min`;
}

function formatLastGameLaunch(summary: GameStatisticsSummary) {
  return summary.lastSession
    ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(summary.lastSession.startedAt))
    : 'Jamais';
}

function completedAchievements(achievements: HypeAchievement[]) {
  const completed = achievements.filter((achievement) => achievement.unlockedAt).length;
  const total = achievements.length;
  return { completed, total, percent: total ? Math.round(completed * 100 / total) : 0 };
}

type ProfileStatisticsContext = { games: GameStatisticsSummary[]; achievements: PublicHypeAchievement[] };

const profileStatistics: { key: ProfileStatisticKey; label: string; value: (profile: PublicProfile, context: ProfileStatisticsContext) => string }[] = [
  { key: 'playtime', label: 'Temps de jeu', value: (_profile, context) => compactTrackedDuration(context.games.reduce((sum, game) => sum + game.totalMs, 0)) },
  { key: 'sessions', label: 'Sessions', value: (_profile, context) => String(context.games.reduce((sum, game) => sum + game.sessionCount, 0)) },
  { key: 'average-session', label: 'Session moyenne', value: (_profile, context) => { const sessions = context.games.reduce((sum, game) => sum + game.sessionCount, 0); return compactTrackedDuration(sessions ? context.games.reduce((sum, game) => sum + game.totalMs, 0) / sessions : 0); } },
  { key: 'longest-session', label: 'Plus longue session', value: (_profile, context) => compactTrackedDuration(Math.max(0, ...context.games.map((game) => game.longestMs))) },
  { key: 'active-days', label: 'Jours actifs', value: (_profile, context) => String(context.games.reduce((sum, game) => sum + game.activeDays, 0)) },
  { key: 'streak', label: 'Meilleure série', value: (_profile, context) => `${Math.max(0, ...context.games.map((game) => game.bestStreak))} j` },
  { key: 'achievements', label: 'Succès Hype', value: (_profile, context) => `${context.achievements.filter((achievement) => achievement.unlockedAt).length} / ${context.achievements.length}` },
  { key: 'friends', label: 'Amis', value: (profile) => String(profile.friendCount) },
  { key: 'latency', label: 'Latence', value: () => '18 ms' },
  { key: 'library', label: 'Bibliothèque', value: () => '2 jeux' },
  { key: 'active-session', label: 'Session active', value: (profile) => profile.currentGame ? 'Oui' : 'Non' },
];

function toggleShowcaseSelection<T extends string>(values: T[] | undefined, key: T) {
  const current = values ?? [];
  return current.includes(key) ? current.filter((value) => value !== key) : [...current, key];
}

function captureProfileRects(selector: string, dataKey: keyof DOMStringMap) {
  const rects = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const key = element.dataset[dataKey];
    if (key) rects.set(key, element.getBoundingClientRect());
  });
  return rects;
}

const activeProfileReorderAnimations = new Set<Animation>();

function stopProfileReorderAnimations() {
  activeProfileReorderAnimations.forEach((animation) => animation.cancel());
  activeProfileReorderAnimations.clear();
}

function playProfileReorderAnimation(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  const animation = element.animate(keyframes, options);
  activeProfileReorderAnimations.add(animation);
  animation.addEventListener('finish', () => activeProfileReorderAnimations.delete(animation), { once: true });
  animation.addEventListener('cancel', () => activeProfileReorderAnimations.delete(animation), { once: true });
}

function animateProfileRects(selector: string, dataKey: keyof DOMStringMap, previous: Map<string, DOMRect>, skippedKey?: string) {
  if (document.querySelector('.launcher-shell.ui-reduced-motion')) return;
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const key = element.dataset[dataKey];
    if (key === skippedKey) return;
    const before = key ? previous.get(key) : undefined;
    if (!before) return;
    const after = element.getBoundingClientRect();
    const x = before.left - after.left;
    const y = before.top - after.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
    playProfileReorderAnimation(element, [
      { transform: `translate3d(${x}px, ${y}px, 0)`, zIndex: 6 },
      { transform: 'translate3d(0, 0, 0)', zIndex: 6 },
    ], { duration: 260, easing: 'cubic-bezier(.2,.85,.2,1)' });
  });
}

function animateShowcaseInsertion(previous: DOMRect[], sourceIndex: number, targetIndex: number) {
  if (document.querySelector('.launcher-shell.ui-reduced-motion')) return;
  document.querySelectorAll<HTMLElement>('.profile-shelf-slot[data-profile-showcase-key]').forEach((element, newIndex) => {
    // The dragged showcase is represented by a pointer-following ghost. Animating
    // its destination as well creates a duplicate card and competing transforms.
    if (newIndex === targetIndex) return;
    let oldIndex = newIndex;
    if (sourceIndex > targetIndex && newIndex > targetIndex && newIndex <= sourceIndex) oldIndex = newIndex - 1;
    else if (sourceIndex < targetIndex && newIndex >= sourceIndex && newIndex < targetIndex) oldIndex = newIndex + 1;
    const before = previous[oldIndex];
    if (!before) return;
    const after = element.getBoundingClientRect();
    const x = before.left - after.left;
    const y = before.top - after.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
    playProfileReorderAnimation(element, [
      { transform: `translate3d(${x}px, ${y}px, 0)`, opacity: .72, zIndex: 7 },
      { transform: 'translate3d(0, 0, 0)', opacity: 1, zIndex: 7 },
    ], { duration: 260, easing: 'cubic-bezier(.2,.85,.2,1)' });
  });
}

type ProfileDragItem = { kind: 'shelf'; shelfId: string } | { kind: 'showcase'; shelfId: string; slotIndex: number };
type ProfileDragZone = { key: string; rect: DOMRect };

function ProfileShowcaseSlot({ showcase, profile, displayName, achievements, gameStatistics }: { showcase: ProfileShowcase; profile: PublicProfile; displayName: string; achievements: PublicHypeAchievement[]; gameStatistics: GameStatisticsSummary[] }) {
  const option = profileShowcases.find((item) => item.key === showcase.type) ?? profileShowcases[0];
  if (showcase.type === 'universes') {
    const games = profileGames.filter((game) => (showcase.gameIds ?? []).includes(game.key));
    return <div className="showcase-slot showcase-universes"><header><LayoutGrid size={15} /><span><b>{option.label}</b><small>{option.description}</small></span></header><div>{games.map((game) => <span key={game.key}><img src={game.image} alt="" /><b>{game.name}</b></span>)}{!games.length && <p>Aucun univers sélectionné.</p>}</div></div>;
  }
  if (showcase.type === 'activity') return <div className="showcase-slot"><header><Activity size={15} /><span><b>{option.label}</b><small>{option.description}</small></span></header><strong>{profile.currentGame ? `En jeu sur ${profile.currentGame}` : 'Entre deux aventures'}</strong><p>{profile.currentGame ? 'Session partagée en temps réel.' : 'Aucune session active pour le moment.'}</p></div>;
  if (showcase.type === 'achievements') {
    const selectedAchievements = achievements.filter((achievement) => achievement.rarityPercent < 10 && (showcase.achievementIds ?? []).includes(achievement.achievementKey));
    return <div className="showcase-slot showcase-achievements"><header><Trophy size={15} /><span><b>{option.label}</b><small>{option.description}</small></span></header><div>{selectedAchievements.map((achievement) => <span key={achievement.achievementKey}><HypeAchievementIcon iconKey={achievement.iconKey} /><b>{achievement.title}</b><small>{achievement.rarityPercent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</small></span>)}{!selectedAchievements.length && <p>Aucun succès sélectionné.</p>}</div></div>;
  }
  if (showcase.type === 'statistics') {
    const statistics = profileStatistics.filter((statistic) => (showcase.statisticIds ?? []).includes(statistic.key));
    return <div className="showcase-slot"><header><Gauge size={15} /><span><b>{option.label}</b><small>{option.description}</small></span></header><div className="showcase-metrics">{statistics.map((statistic) => <span key={statistic.key}><b>{statistic.value(profile, { games: gameStatistics, achievements })}</b><small>{statistic.label}</small></span>)}{!statistics.length && <p>Aucune statistique sélectionnée.</p>}</div></div>;
  }
  const favorite = profileGames.find((game) => game.key === showcase.favoriteGameId) ?? profileGames[1];
  return <div className={`showcase-slot showcase-favorite favorite-${favorite.key}`}>{favorite.key === 'hype' ? <HypeArtwork /> : <img src={favorite.image} alt="" />}<span className="card-overlay" /><div><small>{favorite.category}</small><strong>{favorite.name}</strong><p>Le coup de cœur de {displayName}.</p></div><Heart size={18} fill="currentColor" /></div>;
}

function PublicProfilePage({ userId, viewerId, onBack, onOpenProfile, onThemeChange }: { userId: string; viewerId: string; onBack: () => void; onOpenProfile: (userId: string) => void; onThemeChange: (theme: ProfileTheme | null) => void }) {
  const { relationships, applyPresence } = useSocial();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileFriends, setProfileFriends] = useState<FriendProfile[]>([]);
  const [profileAchievements, setProfileAchievements] = useState<PublicHypeAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [customizationError, setCustomizationError] = useState('');
  const [usernameAvailability, setUsernameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error'>('idle');
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<PublicProfile | null>(null);
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [, setStatisticsRevision] = useState(0);
  const [draggedProfileItem, setDraggedProfileItem] = useState<ProfileDragItem | null>(null);
  const [profileDropTarget, setProfileDropTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileCustomization>({ displayName: '', username: '', bio: '', status: 'online', theme: defaultProfileTheme, shelves: defaultProfileShelves });
  const draggedProfileItemRef = useRef<ProfileDragItem | null>(null);
  const profileDragTargetRef = useRef<string | null>(null);
  const profileDragOriginRef = useRef<ProfileCustomization['shelves'] | null>(null);
  const profileDragPointerIdRef = useRef<number | null>(null);
  const profileDragZonesRef = useRef<ProfileDragZone[]>([]);
  const profileDragGhostRef = useRef<HTMLElement | null>(null);
  const profileDragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const profileDragReleaseCleanupRef = useRef<(() => void) | null>(null);

  const load = async () => {
    try {
      setError('');
      const loadedProfile = await loadPublicProfile(userId);
      setProfile(applyPresence(loadedProfile));
      void Promise.all([
        (userId === viewerId
          ? Promise.resolve(relationships.filter((friend) => friend.relationshipStatus === 'accepted'))
          : loadProfileFriends(userId).then((items) => items.map(applyPresence)))
          .then(setProfileFriends)
          .catch(() => setProfileFriends([])),
        loadProfileHypeAchievements(userId).then(setProfileAchievements).catch(() => setProfileAchievements([])),
      ]);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Le profil n’a pas pu être chargé.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    setLoading(true);
    setProfileFriends([]);
    setProfileAchievements([]);
    void load();
    const channel = supabase.channel('public-profile-' + userId).on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'user_achievement_progress', filter: 'user_id=eq.' + userId }, () => void load()).subscribe();
    const handleProfileChange = (event: Event) => { if ((event as CustomEvent).detail?.userId === userId) void load(); };
    window.addEventListener('ae-social-profile-changed', handleProfileChange);
    return () => { window.removeEventListener('ae-social-profile-changed', handleProfileChange); void supabase.removeChannel(channel); };
  }, [userId]);
  useEffect(() => {
    setProfile((current) => current ? applyPresence(current) : current);
    setProfileFriends((current) => current.map(applyPresence));
  }, [applyPresence]);
  useEffect(() => {
    if (userId === viewerId) setProfileFriends(relationships.filter((friend) => friend.relationshipStatus === 'accepted'));
  }, [relationships, userId, viewerId]);
  useEffect(() => {
    if (!manageOpen) return;
    const closeManageMenu = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.friend-context-menu') && !target?.closest('.friend-row-menu')) setManageOpen(false);
    };
    document.addEventListener('pointerdown', closeManageMenu);
    return () => document.removeEventListener('pointerdown', closeManageMenu);
  }, [manageOpen]);
  useEffect(() => {
    if (!customizing || !profile) return;
    const username = normalizeUsername(draft.username);
    if (username === profile.username) { setUsernameAvailability('available'); return; }
    if (validateUsername(username)) { setUsernameAvailability('invalid'); return; }
    let active = true;
    setUsernameAvailability('checking');
    const timer = window.setTimeout(() => void isUsernameAvailable(username).then((available) => {
      if (active) setUsernameAvailability(available ? 'available' : 'taken');
    }).catch(() => { if (active) setUsernameAvailability('error'); }), 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [customizing, draft.username, profile]);
  useEffect(() => {
    if (!profile) return;
    onThemeChange(normalizeProfileTheme(customizing ? draft.theme : profile.theme));
  }, [customizing, draft.theme, onThemeChange, profile]);
  useEffect(() => () => onThemeChange(null), [onThemeChange]);
  useEffect(() => {
    const refresh = () => setStatisticsRevision((revision) => revision + 1);
    window.addEventListener('ae-game-stats-change', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('ae-game-stats-change', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Cette action n’a pas pu être effectuée.'); }
    finally { setBusy(false); }
  };
  const beginCustomization = () => {
    if (!profile) return;
    setDraft({
      displayName: profile.displayName,
      username: profile.username,
      bio: profile.bio,
      avatarDataUrl: profile.avatarUrl,
      bannerDataUrl: profile.bannerUrl,
      status: profile.presenceStatus,
      theme: normalizeProfileTheme(profile.theme),
      shelves: normalizeProfileShelves(profile.shelves),
    });
    setCustomizationError('');
    setCustomizing(true);
  };
  const chooseMedia = async (file: File | undefined, kind: CropTarget['kind']) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setCustomizationError('Choisissez une image valide.'); return; }
    try { setCropTarget({ source: await readImageFile(file), kind }); }
    catch { setCustomizationError('Cette image n’a pas pu être préparée.'); }
  };
  const saveCustomization = async () => {
    if (!profile) return;
    setBusy(true);
    setCustomizationError('');
    try {
      await saveProfileCustomization(userId, draft);
      const updatedProfile: ProfileData = {
        name: draft.displayName.trim(),
        username: normalizeUsername(draft.username),
        bio: draft.bio.trim(),
        avatarDataUrl: draft.avatarDataUrl,
        bannerDataUrl: draft.bannerDataUrl,
        status: draft.status,
        theme: normalizeProfileTheme(draft.theme),
        shelves: normalizeProfileShelves(draft.shelves),
      };
      window.dispatchEvent(new CustomEvent<ProfileData>('ae-profile-updated', { detail: updatedProfile }));
      setCustomizing(false);
      await load();
    } catch (reason) {
      setCustomizationError(reason instanceof Error ? reason.message : 'Le profil n’a pas pu être enregistré.');
    } finally {
      setBusy(false);
    }
  };
  const cancelCustomization = () => {
    setCustomizing(false);
    setCustomizationError('');
  };
  const addShelf = (index: number) => {
    setDraft((current) => ({
      ...current,
      shelves: [...current.shelves.slice(0, index), {
        id: `shelf-${Date.now()}-${current.shelves.length}`,
        layout: 1,
        slots: [defaultProfileShowcase('favorite')],
      }, ...current.shelves.slice(index)],
    }));
  };
  const setShelfLayout = (shelfId: string, layout: 1 | 2 | 3) => {
    setDraft((current) => ({ ...current, shelves: current.shelves.map((shelf) => {
      if (shelf.id !== shelfId) return shelf;
      const slots = shelf.slots.slice(0, layout);
      while (slots.length < layout) slots.push(defaultProfileShowcase(profileShowcases[(current.shelves.indexOf(shelf) + slots.length) % profileShowcases.length].key));
      return { ...shelf, layout, slots };
    }) }));
  };
  const setShelfSlot = (shelfId: string, slotIndex: number, value: ProfileShowcaseKey) => {
    setDraft((current) => ({ ...current, shelves: current.shelves.map((shelf) => shelf.id === shelfId
      ? { ...shelf, slots: shelf.slots.map((slot, index) => index === slotIndex ? defaultProfileShowcase(value) : slot) }
      : shelf) }));
  };
  const updateShelfShowcase = (shelfId: string, slotIndex: number, update: (showcase: ProfileShowcase) => ProfileShowcase) => {
    setDraft((current) => ({ ...current, shelves: current.shelves.map((shelf) => shelf.id === shelfId
      ? { ...shelf, slots: shelf.slots.map((slot, index) => index === slotIndex ? update(slot) : slot) }
      : shelf) }));
  };
  const removeShelf = (shelfId: string) => setDraft((current) => ({ ...current, shelves: current.shelves.filter((shelf) => shelf.id !== shelfId) }));
  const captureProfileDragZones = (kind: ProfileDragItem['kind']) => {
    const selector = kind === 'shelf' ? '.profile-shelf-wrap[data-profile-shelf-index]' : '.profile-shelf-slot[data-profile-showcase-key]';
    profileDragZonesRef.current = Array.from(document.querySelectorAll<HTMLElement>(selector), (element) => ({
      key: kind === 'shelf'
        ? `shelf:${element.dataset.profileShelfIndex}`
        : `showcase:${element.dataset.profileShelfId}:${element.dataset.profileSlotIndex}`,
      rect: element.getBoundingClientRect(),
    }));
  };
  const beginProfileDrag = (event: React.PointerEvent<HTMLButtonElement>, item: ProfileDragItem) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopProfileReorderAnimations();
    document.body.setPointerCapture(event.pointerId);
    draggedProfileItemRef.current = item;
    profileDragTargetRef.current = null;
    profileDragOriginRef.current = draft.shelves.map((shelf) => ({ ...shelf, slots: [...shelf.slots] }));
    profileDragPointerIdRef.current = event.pointerId;
    profileDragStartPointRef.current = { x: event.clientX, y: event.clientY };
    captureProfileDragZones(item.kind);
    profileDragReleaseCleanupRef.current?.();
    const pointerId = event.pointerId;
    const handleImmediatePointerUp = (releaseEvent: PointerEvent) => {
      if (releaseEvent.pointerId === pointerId) finishProfileDrag();
    };
    const handleImmediatePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) cancelProfileDrag();
    };
    const handleImmediateMouseUp = () => finishProfileDrag();
    const handleImmediateBlur = () => finishProfileDrag();
    document.addEventListener('pointerup', handleImmediatePointerUp, true);
    document.addEventListener('pointercancel', handleImmediatePointerCancel, true);
    window.addEventListener('mouseup', handleImmediateMouseUp, true);
    window.addEventListener('blur', handleImmediateBlur, true);
    profileDragReleaseCleanupRef.current = () => {
      document.removeEventListener('pointerup', handleImmediatePointerUp, true);
      document.removeEventListener('pointercancel', handleImmediatePointerCancel, true);
      window.removeEventListener('mouseup', handleImmediateMouseUp, true);
      window.removeEventListener('blur', handleImmediateBlur, true);
    };
    const source = event.currentTarget.closest<HTMLElement>(item.kind === 'shelf' ? '.profile-shelf-wrap' : '.profile-shelf-slot');
    if (source) {
      const rect = source.getBoundingClientRect();
      const ghost = source.cloneNode(true) as HTMLElement;
      ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      ghost.classList.remove('is-dragging', 'drop-target');
      ghost.classList.add('profile-drag-ghost', `profile-drag-ghost-${item.kind}`);
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      profileDragGhostRef.current = ghost;
    }
    setDraggedProfileItem(item);
    document.body.classList.add('profile-pointer-dragging');
  };
  const finishProfileDrag = () => {
    // The live FLIP preview only belongs to the held state. Once released, snap
    // every card to its committed slot so no stale transform can overlap it.
    stopProfileReorderAnimations();
    profileDragReleaseCleanupRef.current?.();
    profileDragReleaseCleanupRef.current = null;
    const pointerId = profileDragPointerIdRef.current;
    if (pointerId !== null && document.body.hasPointerCapture(pointerId)) document.body.releasePointerCapture(pointerId);
    document.body.classList.remove('profile-pointer-dragging');
    draggedProfileItemRef.current = null;
    profileDragTargetRef.current = null;
    profileDragOriginRef.current = null;
    profileDragPointerIdRef.current = null;
    profileDragZonesRef.current = [];
    profileDragGhostRef.current?.remove();
    profileDragGhostRef.current = null;
    profileDragStartPointRef.current = null;
    setDraggedProfileItem(null);
    setProfileDropTarget(null);
  };
  const moveShelf = (sourceId: string, targetIndex: number) => {
    stopProfileReorderAnimations();
    const previousRects = captureProfileRects('.profile-shelf-wrap[data-profile-shelf-id]', 'profileShelfId');
    flushSync(() => setDraft((current) => {
      const sourceIndex = current.shelves.findIndex((shelf) => shelf.id === sourceId);
      if (sourceIndex < 0 || sourceIndex === targetIndex) return current;
      const shelves = [...current.shelves];
      const [moved] = shelves.splice(sourceIndex, 1);
      shelves.splice(targetIndex, 0, moved);
      return { ...current, shelves };
    }));
    captureProfileDragZones('shelf');
    animateProfileRects('.profile-shelf-wrap[data-profile-shelf-id]', 'profileShelfId', previousRects, sourceId);
  };
  const moveShowcase = (source: Extract<ProfileDragItem, { kind: 'showcase' }>, targetShelfId: string, targetSlotIndex: number) => {
    if (source.shelfId === targetShelfId && source.slotIndex === targetSlotIndex) return;
    stopProfileReorderAnimations();
    const previousRects = Array.from(document.querySelectorAll<HTMLElement>('.profile-shelf-slot[data-profile-showcase-key]'), (element) => element.getBoundingClientRect());
    let sourceFlatIndex = -1;
    let targetFlatIndex = -1;
    flushSync(() => setDraft((current) => {
      let cursor = 0;
      for (const shelf of current.shelves) {
        if (shelf.id === source.shelfId) sourceFlatIndex = cursor + source.slotIndex;
        if (shelf.id === targetShelfId) targetFlatIndex = cursor + targetSlotIndex;
        cursor += shelf.slots.length;
      }
      if (sourceFlatIndex < 0 || targetFlatIndex < 0 || sourceFlatIndex === targetFlatIndex) return current;
      const slots = current.shelves.flatMap((shelf) => shelf.slots);
      const [moved] = slots.splice(sourceFlatIndex, 1);
      slots.splice(targetFlatIndex, 0, moved);
      cursor = 0;
      const shelves = current.shelves.map((shelf) => {
        const nextShelf = { ...shelf, slots: slots.slice(cursor, cursor + shelf.slots.length) };
        cursor += shelf.slots.length;
        return nextShelf;
      });
      return { ...current, shelves };
    }));
    captureProfileDragZones('showcase');
    if (sourceFlatIndex >= 0 && targetFlatIndex >= 0) animateShowcaseInsertion(previousRects, sourceFlatIndex, targetFlatIndex);
  };
  const trackProfileDrag = (clientX: number, clientY: number) => {
    const item = draggedProfileItemRef.current;
    if (!item) return;
    const start = profileDragStartPointRef.current;
    if (start && profileDragGhostRef.current) {
      profileDragGhostRef.current.style.transform = `translate3d(${clientX - start.x}px, ${clientY - start.y}px, 0) scale(.99)`;
    }
    const zone = profileDragZonesRef.current.find(({ rect }) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
    if (item.kind === 'shelf') {
      const targetKey = zone?.key.startsWith('shelf:') ? zone.key : null;
      const targetIndex = Number(targetKey?.slice('shelf:'.length));
      setProfileDropTarget(targetKey);
      if (targetKey && profileDragTargetRef.current !== targetKey) {
        profileDragTargetRef.current = targetKey;
        moveShelf(item.shelfId, targetIndex);
      }
      return;
    }
    const targetKey = zone?.key.startsWith('showcase:') ? zone.key : null;
    const targetParts = targetKey?.split(':');
    const targetShelfId = targetParts?.[1];
    const targetSlotIndex = Number(targetParts?.[2]);
    setProfileDropTarget(targetKey);
    if (targetKey && profileDragTargetRef.current !== targetKey) {
      profileDragTargetRef.current = targetKey;
      moveShowcase(item, targetShelfId!, targetSlotIndex);
      const nextItem: ProfileDragItem = { kind: 'showcase', shelfId: targetShelfId!, slotIndex: targetSlotIndex };
      draggedProfileItemRef.current = nextItem;
      setDraggedProfileItem(nextItem);
    }
  };
  const cancelProfileDrag = () => {
    stopProfileReorderAnimations();
    const origin = profileDragOriginRef.current;
    if (origin) setDraft((current) => ({ ...current, shelves: origin }));
    finishProfileDrag();
  };
  const profileDragActive = draggedProfileItem !== null;
  useLayoutEffect(() => {
    if (!profileDragActive) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== profileDragPointerIdRef.current) return;
      if (event.pointerType === 'mouse' && event.buttons === 0) { finishProfileDrag(); return; }
      event.preventDefault();
      trackProfileDrag(event.clientX, event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === profileDragPointerIdRef.current) finishProfileDrag();
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === profileDragPointerIdRef.current) cancelProfileDrag();
    };
    const handleWindowBlur = () => finishProfileDrag();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelProfileDrag(); };
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('profile-pointer-dragging');
      profileDragGhostRef.current?.remove();
      profileDragGhostRef.current = null;
      profileDragStartPointRef.current = null;
      profileDragReleaseCleanupRef.current?.();
      profileDragReleaseCleanupRef.current = null;
      const pointerId = profileDragPointerIdRef.current;
      if (pointerId !== null && document.body.hasPointerCapture(pointerId)) document.body.releasePointerCapture(pointerId);
    };
  }, [profileDragActive]);
  const openSignatureCopy = async () => {
    setSignatureBusy(true);
    setSignatureError('');
    try { setSignaturePreview(await loadPublicProfile(viewerId)); }
    catch (reason) { setSignatureError(reason instanceof Error ? reason.message : 'Votre profil n’a pas pu être prévisualisé.'); }
    finally { setSignatureBusy(false); }
  };
  const applyCopiedSignature = async (theme: ProfileTheme) => {
    if (!signaturePreview) return;
    setSignatureBusy(true);
    setSignatureError('');
    try {
      await saveProfileTheme(viewerId, theme);
      const updatedProfile: ProfileData = {
        name: signaturePreview.displayName,
        username: signaturePreview.username,
        bio: signaturePreview.bio,
        avatarDataUrl: signaturePreview.avatarUrl,
        bannerDataUrl: signaturePreview.bannerUrl,
        status: signaturePreview.presenceStatus,
        theme: normalizeProfileTheme(theme),
        shelves: normalizeProfileShelves(signaturePreview.shelves),
      };
      window.dispatchEvent(new CustomEvent<ProfileData>('ae-profile-updated', { detail: updatedProfile }));
      setSignaturePreview(null);
    } catch (reason) { setSignatureError(reason instanceof Error ? reason.message : 'La signature visuelle n’a pas pu être modifiée.'); }
    finally { setSignatureBusy(false); }
  };

  if (loading) return <main className="public-profile-page profile-state"><RefreshCw className="spinning" size={22} /> Chargement du profil…</main>;
  if (!profile) return <main className="public-profile-page profile-state"><AlertTriangle size={22} /><b>Profil indisponible</b><p>{error}</p><button onClick={onBack}>Retour</button></main>;

  const ownProfile = userId === viewerId;
  const displayedStatus = customizing ? draft.status : profile.presenceStatus;
  const presence = profile.currentGame ? 'En jeu · ' + profile.currentGame : displayedStatus === 'online' ? 'En ligne' : displayedStatus === 'busy' ? 'Occupé' : 'Hors ligne';
  const memberSince = profile.createdAt ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(profile.createdAt)) : 'récemment';
  const displayedTheme = normalizeProfileTheme(customizing ? draft.theme : profile.theme);
  const secondColor = displayedTheme.mode === 'solid' ? displayedTheme.background : displayedTheme.backgroundSecondary;
  const profileStyle = {
    '--profile-accent': displayedTheme.accent,
    '--profile-surface-opacity': displayedTheme.surfaceOpacity / 100,
    background: 'linear-gradient(' + displayedTheme.angle + 'deg, ' + displayedTheme.background + ', ' + secondColor + ')',
  } as React.CSSProperties;
  const displayedBanner = customizing ? draft.bannerDataUrl : profile.bannerUrl;
  const displayedAvatar = customizing ? draft.avatarDataUrl : profile.avatarUrl;
  const displayedName = customizing ? draft.displayName : profile.displayName;
  const displayedUsername = customizing ? draft.username : profile.username;
  const displayedBio = customizing ? draft.bio : profile.bio;
  const displayedShelves = normalizeProfileShelves(customizing ? draft.shelves : profile.shelves);
  const themedProfile = { ...profile, avatarUrl: displayedAvatar };
  const gameStatistics = [loadGameStatisticsSummary(userId, 'laliferp'), loadGameStatisticsSummary(userId, 'hype')];

  return (
    <main className={`public-profile-page profile-theme-canvas ${customizing ? 'profile-edit-mode' : ''}`} style={profileStyle}>
      <div className="profile-page-toolbar">
        <button className="profile-back" onClick={onBack}><ArrowLeft size={15} /> Retour</button>
        <div className="public-profile-actions">
          {ownProfile && !customizing && <button className="profile-customize-action" onClick={beginCustomization}><Edit3 size={15} /> Modifier le profil</button>}
          {ownProfile && customizing && <><button onClick={cancelCustomization}>Annuler</button><button className="profile-customize-action" disabled={busy || usernameAvailability === 'checking' || usernameAvailability === 'taken' || usernameAvailability === 'invalid'} onClick={() => void saveCustomization()}><Save size={15} /> {busy ? 'Enregistrement…' : 'Enregistrer'}</button></>}
          {!ownProfile && (profile.relationshipStatus === 'accepted'
            ? <FriendActions friend={profile} open={manageOpen} busy={busy} triggerLabel="Gérer" showProfile={false} onToggle={(event) => { event.stopPropagation(); setManageOpen((open) => !open); }} onProfile={() => undefined} onDelete={() => { setManageOpen(false); void run(() => removeFriend(profile.userId)); }} onBlock={() => { setManageOpen(false); void run(async () => { await blockProfile(profile.userId); onBack(); }); }} />
            : profile.direction === 'outgoing'
              ? <button disabled>Demande envoyée</button>
              : <button className="primary" disabled={busy} onClick={() => void run(() => sendFriendRequest(profile.userId))}><UserPlus size={15} />{profile.direction === 'incoming' ? 'Accepter la demande' : 'Ajouter en ami'}</button>)}
        </div>
      </div>

      <section className="profile-overview-grid">
        <article className="profile-combined-card">
          <div className="profile-banner-card">
            <div className="public-profile-banner">{displayedBanner && <img src={displayedBanner} alt="" />}{customizing && <label><Edit3 size={16} /><b>Modifier la bannière</b><input type="file" accept="image/*" onChange={(event) => { const input = event.currentTarget; void chooseMedia(input.files?.[0], 'bannerDataUrl'); input.value = ''; }} /></label>}</div>
          </div>
          <div className="profile-combined-head">
            <div className="profile-editable-avatar">
              <FriendAvatar friend={themedProfile} />
              {customizing && <label aria-label="Modifier la photo de profil"><Edit3 size={16} /><input type="file" accept="image/*" onChange={(event) => { const input = event.currentTarget; void chooseMedia(input.files?.[0], 'avatarDataUrl'); input.value = ''; }} /></label>}
            </div>
            <div className="profile-identity-copy">
              <span className="profile-presence"><i className={profile.currentGame ? 'status-playing' : 'status-' + displayedStatus} />{presence}</span>
              {customizing
                ? <><input className="profile-name-input" value={draft.displayName} maxLength={60} aria-label="Nom d’affichage" onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /><div className="profile-username-input"><span>@</span><input value={draft.username} maxLength={24} aria-label="Nom d’utilisateur" onChange={(event) => setDraft((current) => ({ ...current, username: normalizeUsername(event.target.value) }))} /></div><small className={'username-feedback ' + usernameAvailability}>{usernameAvailability === 'checking' ? 'Vérification…' : usernameAvailability === 'available' ? 'Pseudo disponible' : usernameAvailability === 'taken' ? 'Pseudo déjà utilisé' : usernameAvailability === 'invalid' ? 'Pseudo invalide' : usernameAvailability === 'error' ? 'Vérification indisponible' : ''}</small><label className="profile-status-select"><span>Statut</span><CustomSelect value={draft.status} options={[{ value: 'online', label: 'En ligne' }, { value: 'busy', label: 'Occupé' }, { value: 'invisible', label: 'Invisible' }]} onChange={(status) => setDraft((current) => ({ ...current, status }))} ariaLabel="Statut" /></label></>
                : <><h1>{displayedName}</h1><p>@{displayedUsername}</p></>}
            </div>
          </div>
        </article>

        <article className="profile-general-card">
          <header><span>INFOS GÉNÉRALES</span><h2>En quelques repères</h2></header>
          <div className="profile-general-stats"><p><CalendarDays size={16} /><span><small>Membre depuis</small><b>{memberSince}</b></span></p><p><Users size={16} /><span><small>Liste d’amis</small><b>{profile.friendCount} ami{profile.friendCount === 1 ? '' : 's'}</b></span></p></div>
          <div className="profile-friends-preview"><div><span>LISTE D’AMIS</span><small>{profileFriends.length}{profile.friendCount > profileFriends.length ? ` sur ${profile.friendCount}` : ''}</small></div><section>{profileFriends.map((friend) => <button key={friend.userId} onClick={() => onOpenProfile(friend.userId)}><FriendAvatar friend={friend} compact /><span><b>{friend.displayName}</b><small>{friend.currentGame ? `Joue à ${friend.currentGame}` : friend.presenceStatus === 'invisible' ? 'Hors ligne' : friend.presenceStatus === 'busy' ? 'Occupé' : 'En ligne'}</small></span></button>)}{!profileFriends.length && <p>Aucun ami visible pour le moment.</p>}</section></div>
          <div className="profile-signature-inline"><span><small>SIGNATURE VISUELLE</small><b>{customizing ? 'Choisissez votre ambiance' : 'Ambiance personnalisée'}</b></span><div><i style={{ background: displayedTheme.background }} /><i style={{ background: secondColor }} /><i style={{ background: displayedTheme.accent }} /></div>{!ownProfile && <button disabled={signatureBusy} onClick={() => void openSignatureCopy()}><Palette size={13} /> Copier</button>}</div>
          {customizing && <div className="profile-theme-inline"><div className="theme-preset-cards">{profileThemePresets.map((preset) => <button key={preset.name} title={preset.name} className={JSON.stringify(draft.theme) === JSON.stringify(preset.theme) ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, theme: { ...preset.theme } }))}>{preset.game === 'hype' ? <HypeArtwork compact /> : preset.image ? <img src={preset.image} alt="" /> : <i style={{ background: `linear-gradient(135deg, ${preset.theme.background}, ${preset.theme.backgroundSecondary})` }} />}<span>{preset.name}</span></button>)}</div><div className="profile-color-controls"><label>Fond <input type="color" value={draft.theme.background} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, background: event.target.value } }))} /></label><label>Secondaire <input type="color" value={draft.theme.backgroundSecondary} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, backgroundSecondary: event.target.value } }))} /></label><label>Accent <input type="color" value={draft.theme.accent} onChange={(event) => setDraft((current) => ({ ...current, theme: { ...current.theme, accent: event.target.value } }))} /></label></div></div>}
        </article>
      </section>

      <section className="profile-content-stack">
        <article className="profile-about">
          <header><div><span>BIO COMPLÈTE</span><h2>L’histoire de {displayedName || 'ce joueur'}</h2></div><i style={{ background: displayedTheme.accent }} /></header>
          {customizing ? <MarkdownBioEditor value={draft.bio} onChange={(bio) => setDraft((current) => ({ ...current, bio }))} /> : <ProfileMarkdown>{displayedBio || '*' + displayedName + ' n’a pas encore ajouté de bio.*'}</ProfileMarkdown>}
        </article>

        <section className="profile-shelves" aria-label="Étagères du profil">
          {customizing && <button className="profile-add-shelf" disabled={draft.shelves.length >= 8} onClick={() => addShelf(0)}><LayoutGrid size={13} /> Ajouter une étagère</button>}
          {displayedShelves.map((shelf, shelfIndex) => <div className={`profile-shelf-wrap ${draggedProfileItem?.kind === 'shelf' && draggedProfileItem.shelfId === shelf.id ? 'is-dragging' : ''} ${profileDropTarget === `shelf:${shelfIndex}` ? 'drop-target' : ''}`} key={shelf.id} data-profile-shelf-index={shelfIndex} data-profile-shelf-id={shelf.id}><article className="profile-shelf">
            {customizing && <header><span className="shelf-title"><button className="profile-drag-handle" aria-label={`Déplacer l’étagère ${shelfIndex + 1}`} onPointerDown={(event) => beginProfileDrag(event, { kind: 'shelf', shelfId: shelf.id })}><GripVertical size={14} /></button>ÉTAGÈRE {shelfIndex + 1}</span><div><small>Nombre de slots</small>{([1, 2, 3] as const).map((layout) => <button key={layout} className={shelf.layout === layout ? 'active' : ''} onClick={() => setShelfLayout(shelf.id, layout)}>{layout}</button>)}<button className="remove" aria-label="Supprimer l’étagère" onClick={() => removeShelf(shelf.id)}><Trash2 size={14} /></button></div></header>}
            <div className={`profile-shelf-slots layout-${shelf.layout}`}>{shelf.slots.map((showcase, slotIndex) => {
              const dragItem = { kind: 'showcase' as const, shelfId: shelf.id, slotIndex };
              return <div
                className={`profile-shelf-slot ${draggedProfileItem?.kind === 'showcase' && draggedProfileItem.shelfId === shelf.id && draggedProfileItem.slotIndex === slotIndex ? 'is-dragging' : ''} ${profileDropTarget === `showcase:${shelf.id}:${slotIndex}` ? 'drop-target' : ''}`}
                key={`${shelf.id}-${slotIndex}`}
                data-profile-showcase-target
                data-profile-showcase-key={`${shelf.id}:${slotIndex}`}
                data-profile-shelf-id={shelf.id}
                data-profile-slot-index={slotIndex}
              >
                {customizing && <div className="showcase-editor"><label><button className="profile-drag-handle" aria-label={`Déplacer la vitrine ${slotIndex + 1}`} onPointerDown={(event) => beginProfileDrag(event, dragItem)}><GripVertical size={13} /></button><span>Vitrine {slotIndex + 1}</span><CustomSelect value={showcase.type} options={profileShowcases.map((option) => ({ value: option.key, label: option.label }))} onChange={(type) => setShelfSlot(shelf.id, slotIndex, type)} ariaLabel={`Type de la vitrine ${slotIndex + 1}`} /></label>{showcase.type === 'universes' && <div className="showcase-option-list"><small>Jeux affichés</small>{profileGames.map((game) => <button key={game.key} className={(showcase.gameIds ?? []).includes(game.key) ? 'active' : ''} onClick={() => updateShelfShowcase(shelf.id, slotIndex, (current) => ({ ...current, gameIds: toggleShowcaseSelection(current.gameIds, game.key) }))}><img src={game.image} alt="" />{game.name}<Check size={12} /></button>)}</div>}{showcase.type === 'achievements' && <div className="showcase-option-list compact"><small>Succès Hype rares débloqués · moins de 10 %</small>{profileAchievements.filter((achievement) => achievement.rarityPercent < 10).map((achievement) => <button key={achievement.achievementKey} className={(showcase.achievementIds ?? []).includes(achievement.achievementKey) ? 'active' : ''} onClick={() => updateShelfShowcase(shelf.id, slotIndex, (current) => ({ ...current, achievementIds: toggleShowcaseSelection(current.achievementIds, achievement.achievementKey as ProfileAchievementKey) }))}>{achievement.title}<Check size={12} /></button>)}{profileAchievements.filter((achievement) => achievement.rarityPercent < 10).length === 0 && <p>Aucun succès rare débloqué.</p>}</div>}{showcase.type === 'statistics' && <div className="showcase-option-list compact"><small>Statistiques affichées · sans limite</small>{profileStatistics.map((statistic) => <button key={statistic.key} className={(showcase.statisticIds ?? []).includes(statistic.key) ? 'active' : ''} onClick={() => updateShelfShowcase(shelf.id, slotIndex, (current) => ({ ...current, statisticIds: toggleShowcaseSelection(current.statisticIds, statistic.key) }))}>{statistic.label}<Check size={12} /></button>)}</div>}{showcase.type === 'favorite' && <label className="showcase-game-select"><span>Jeu coup de cœur</span><CustomSelect value={showcase.favoriteGameId ?? 'hype'} options={profileGames.map((game) => ({ value: game.key, label: game.name }))} onChange={(favoriteGameId) => updateShelfShowcase(shelf.id, slotIndex, (current) => ({ ...current, favoriteGameId }))} ariaLabel="Jeu coup de cœur" /></label>}</div>}
                <ProfileShowcaseSlot showcase={showcase} profile={profile} displayName={displayedName} achievements={profileAchievements} gameStatistics={gameStatistics} />
              </div>;
            })}</div>
          </article>{customizing && <button className="profile-add-shelf" disabled={draft.shelves.length >= 8} onClick={() => addShelf(shelfIndex + 1)}><LayoutGrid size={13} /> Ajouter une étagère</button>}</div>)}
          {!displayedShelves.length && !customizing && <div className="profile-empty-shelves"><LayoutGrid size={20} /><p>{displayedName} n’a pas encore installé de vitrine.</p></div>}
        </section>
      </section>

      {!ownProfile && profile.relationshipStatus !== 'accepted' && <button className="profile-block-action" disabled={busy} onClick={() => void run(async () => { await blockProfile(profile.userId); onBack(); })}><Ban size={14} /> Bloquer ce profil</button>}
      {(error || customizationError || signatureError) && <p className="public-profile-error">{customizationError || signatureError || error}</p>}
      {cropTarget && <ImageCropDialog target={cropTarget} onCancel={() => setCropTarget(null)} onConfirm={async (dataUrl, kind) => { setDraft((current) => ({ ...current, [kind]: dataUrl })); setCropTarget(null); }} />}
      {signaturePreview && createPortal(<div className="profile-customizer-backdrop signature-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !signatureBusy) setSignaturePreview(null); }}><section className="signature-preview-modal" style={{ '--profile-accent': profile.theme.accent } as React.CSSProperties}><header><div><span>COPIER LA SIGNATURE</span><h2>Aperçu sur votre profil</h2><p>Le contenu reste le vôtre, seule l’ambiance visuelle est copiée.</p></div><button aria-label="Fermer" onClick={() => setSignaturePreview(null)}><X size={17} /></button></header><div className="signature-preview-canvas" style={{ background: `linear-gradient(${profile.theme.angle}deg, ${profile.theme.background}, ${profile.theme.mode === 'solid' ? profile.theme.background : profile.theme.backgroundSecondary})` }}><div className="signature-preview-banner">{signaturePreview.bannerUrl && <img src={signaturePreview.bannerUrl} alt="" />}</div><div><FriendAvatar friend={signaturePreview} /><span><small><i className={'status-' + signaturePreview.presenceStatus} /> Votre profil</small><b>{signaturePreview.displayName}</b><em>@{signaturePreview.username}</em></span></div></div>{signatureError && <p className="signature-preview-error">{signatureError}</p>}<footer><button className="remove-signature" disabled={signatureBusy} onClick={() => void applyCopiedSignature(defaultProfileTheme)}><Trash2 size={14} /> Supprimer</button><span /><button disabled={signatureBusy} onClick={() => setSignaturePreview(null)}>Annuler</button><button className="confirm-signature" disabled={signatureBusy} onClick={() => void applyCopiedSignature(profile.theme)}><Check size={14} /> {signatureBusy ? 'Application…' : 'Valider'}</button></footer></section></div>, document.body)}
    </main>
  );
}

function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="stat-card"><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></div>;
}

function HomePage({ setPage, user, hypeAchievements, hypeVersion }: { setPage: (page: Page) => void; user: User; hypeAchievements: HypeAchievement[]; hypeVersion: string }) {
  const [displayName, setDisplayName] = useState(() => profileFromUser(user).name);
  const [gameOverview, setGameOverview] = useState(() => {
    const laliferp = loadGameStatisticsSummary(user.id, 'laliferp');
    const hype = loadGameStatisticsSummary(user.id, 'hype');
    return { laliferp, hype };
  });
  useEffect(() => {
    let active = true;
    const handleProfileUpdate = (event: Event) => setDisplayName((event as CustomEvent<ProfileData>).detail.name);
    const refreshGameOverview = () => setGameOverview({ laliferp: loadGameStatisticsSummary(user.id, 'laliferp'), hype: loadGameStatisticsSummary(user.id, 'hype') });
    window.addEventListener('ae-profile-updated', handleProfileUpdate);
    window.addEventListener('focus', refreshGameOverview);
    window.addEventListener('ae-game-stats-change', refreshGameOverview);
    void loadProfile(user).then((profile) => { if (active) setDisplayName(profile.name); }).catch(() => undefined);
    return () => { active = false; window.removeEventListener('ae-profile-updated', handleProfileUpdate); window.removeEventListener('focus', refreshGameOverview); window.removeEventListener('ae-game-stats-change', refreshGameOverview); };
  }, [user]);
  const lastPlayedId: GameId = (gameOverview.hype.lastSession && (!gameOverview.laliferp.lastSession || new Date(gameOverview.hype.lastSession.startedAt) > new Date(gameOverview.laliferp.lastSession.startedAt))) ? 'hype' : 'laliferp';
  const lastGame = lastPlayedId === 'hype'
    ? { page: 'hype' as Page, name: 'Hype', image: hypeAvatar, description: 'Reprenez votre histoire là où vous l’avez laissée.', stats: gameOverview.hype }
    : { page: 'laliferp' as Page, name: 'L.A LifeRP', image: '/assets/laliferp-hero.jpg', description: 'Votre personnage vous attend à Los Angeles.', stats: gameOverview.laliferp };
  const hypeCompletion = completedAchievements(hypeAchievements);
  const currentVersion = lastPlayedId === 'hype' ? hypeVersion : '2.8.4';
  return (
    <div className="page-with-friends">
      <main className="page-content home-page">
        <section className="welcome-row"><div><h1>Heureux de vous revoir {displayName}</h1><p>On reprend là où vous vous êtes arrêté ?</p></div><div className="level-card"><span>NIV. 18</span><div><b>Explorateur</b><small>2 840 / 3 200 XP</small><i><em /></i></div><Trophy size={21} /></div></section>
        <section className={`continue-card continue-${lastPlayedId}`} onClick={() => setPage(lastGame.page)}>
          <img src={lastGame.image} alt={lastGame.name} />
          <div className="continue-shade" />
          <div className="continue-copy"><span className="resume-label"><Play size={12} fill="currentColor" /> DERNIER JEU JOUÉ</span><h2>{lastGame.name}</h2><p>{lastGame.description}</p><div className="server-summary"><span><Clock3 size={14} /> {compactTrackedDuration(lastGame.stats.totalMs)} au total</span><span><Activity size={14} /> {lastGame.stats.sessionCount} session{lastGame.stats.sessionCount === 1 ? '' : 's'}</span><span><CalendarDays size={14} /> {compactTrackedDuration(lastGame.stats.weekMs)} cette semaine</span><span><Flame size={14} /> Série {lastGame.stats.currentStreak} j</span></div></div>
          <button className="primary-play"><Play size={19} fill="currentColor" /> Jouer</button>
        </section>
        <section className={`stats-grid game-summary-stats game-summary-${lastPlayedId}`}>
          <Stat icon={<Clock3 />} label="TEMPS DE JEU" value={compactTrackedDuration(lastGame.stats.totalMs)} detail="" />
          {lastPlayedId === 'hype'
            ? <Stat icon={<Trophy />} label="SUCCÈS COMPLÉTÉS" value={`${hypeCompletion.completed} / ${hypeCompletion.total} (${hypeCompletion.percent} %)`} detail="" />
            : <Stat icon={<Activity />} label="SESSIONS" value={String(lastGame.stats.sessionCount)} detail="" />}
          <Stat icon={<CalendarDays />} label="DERNIER LANCEMENT" value={formatLastGameLaunch(lastGame.stats)} detail="" />
          <Stat icon={<ShieldCheck />} label="VERSION ACTUELLE" value={currentVersion} detail="" />
        </section>
        <div className="section-heading"><div><h2>Bibliothèque</h2></div><button onClick={() => setPage('bibliotheque')}>Tout afficher <ChevronRight size={15} /></button></div>
        <section className="library-grid">
          <button className="library-card" onClick={() => setPage('laliferp')}><img src="/assets/laliferp-hero-cover.jpg" alt="" /><span className="card-overlay" /><span className="library-info"><small>FIVEM</small><b>L.A LifeRP</b><em><i className="online-dot" /> Prêt à jouer</em></span><span className="round-play"><Play size={17} fill="currentColor" /></span></button>
          <button className="library-card hype-library-card" onClick={() => setPage('hype')}><HypeArtwork compact /><span className="card-overlay" /><span className="library-info"><small>Æ ORIGINALS</small><b>Hype</b><em><Download size={13} /> Disponible</em></span><span className="round-play"><Download size={17} /></span></button>
        </section>
      </main>
    </div>
  );
}

function GameMetric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return <div className="game-metric"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function HypeArtwork({ compact = false }: { compact?: boolean }) {
  return <div className={`hype-banner-art ${compact ? 'compact' : ''}`} aria-label="Aperçu du réseau social Hype"><div className="hype-feed-preview"><div className="hype-feed-top"><img src={hypeAvatar} alt="" /><span><b>ton monde</b><small>pour toi</small></span><i>h.</i></div><article className="hype-post main-post"><div><span className="generated-avatar avatar-pink">M</span><p><b>Maya</b><small>@maya · 2 min</small></p></div><strong>ok mais ta dernière photo ??? on en parle ou pas</strong><footer><span><Heart size={13} fill="currentColor" /> 248</span><span><MessageCircle size={13} /> 34</span></footer></article><article className="hype-post reply-post"><div><span className="generated-avatar avatar-yellow">T</span><p><b>Théo</b><small>@theo · maintenant</small></p></div><strong>franchement, t’abuses 😭</strong></article><div className="hype-feed-alert"><UserPlus size={14} /><span><b>+3 nouveaux abonnés</b><small>depuis ton dernier post</small></span></div></div></div>;
}

type GamePanel = 'achievements' | 'friends' | 'options' | 'news' | 'statistics';
type NewsReadProps = { readNewsKeys: Set<string>; onMarkNewsRead: (newsKey: string) => void };

function GameDock({ label, icon, onPrimary, onPanel, showAchievements = true, showNews = false, friendCount = 0, unreadNewsCount = 0, primaryDanger = false }: { label: string; icon: React.ReactNode; onPrimary: () => void; onPanel?: (panel: GamePanel) => void; showAchievements?: boolean; showNews?: boolean; friendCount?: number; unreadNewsCount?: number; primaryDanger?: boolean }) {
  return (
    <nav className="game-dock" aria-label="Actions du jeu">
      <button className={`dock-primary ${primaryDanger ? 'stop-game' : ''}`} onClick={onPrimary}>{icon}<span>{label}</span></button>
      <span className="dock-divider" />
      {showAchievements && <button onClick={() => onPanel?.('achievements')}><Trophy size={18} /><small>Succès</small></button>}
      <button onClick={() => onPanel?.('statistics')}><Activity size={18} /><small>Statistiques</small></button>
      <button onClick={() => onPanel?.('friends')}><Users size={18} /><small>Amis</small>{friendCount > 0 && <i className="dock-notice">{friendCount}</i>}</button>
      {showNews && <button onClick={() => onPanel?.('news')}><Newspaper size={18} /><small>Actualités</small>{unreadNewsCount > 0 && <i className="dock-notice news-notice">{unreadNewsCount}</i>}</button>}
      <button onClick={() => onPanel?.('options')}><Settings size={18} /><small>Options</small></button>
    </nav>
  );
}

type AchievementFilter = 'all' | 'unlocked' | 'progress' | 'locked';
type NewsItem = { id: number; date: string; category: string; title: string; excerpt: string; body: string[]; featured?: boolean };

const lifeNews: NewsItem[] = [
  { id: 1, date: '15 OCTOBRE', category: 'MISE À JOUR 2.8.4', title: 'La ville ne dort jamais', excerpt: 'Nouvelles activités nocturnes, économie rééquilibrée et amélioration de la circulation en centre-ville.', body: ['Cette mise à jour ouvre un nouveau chapitre nocturne pour Los Angeles. Plusieurs lieux prennent désormais vie après le coucher du soleil, avec de nouvelles activités et opportunités pour les citoyens.', 'L’économie des entreprises a été rééquilibrée, tandis que la circulation et les temps de chargement en centre-ville ont reçu une série d’améliorations.'], featured: true },
  { id: 2, date: '14 OCTOBRE', category: 'VILLE', title: 'Un nouvel horizon pour Vespucci', excerpt: 'Découvrez les nouveaux commerces disponibles sur la côte.', body: ['Vespucci accueille trois nouvelles enseignes et une promenade entièrement revisitée.', 'Les propriétaires peuvent dès maintenant déposer leur dossier auprès de la mairie.'] },
  { id: 3, date: '12 OCTOBRE', category: 'COMMUNAUTÉ', title: 'Notes de communauté', excerpt: 'Les événements et créations qui ont marqué la semaine.', body: ['Courses improvisées, rencontres citoyennes et créations originales : retrouvez notre sélection de la semaine.', 'Merci à tous les joueurs qui font vivre la ville chaque jour.'] },
  { id: 4, date: '09 OCTOBRE', category: 'ÉVÉNEMENT', title: 'Rendez-vous au Vinewood Bowl', excerpt: 'Une soirée en plein air organisée par la ville.', body: ['La ville vous donne rendez-vous vendredi soir au Vinewood Bowl pour un concert et plusieurs animations.', 'Les portes ouvriront à 20 h et un service de navettes sera disponible.'] },
  { id: 5, date: '05 OCTOBRE', category: 'PATCH', title: 'Correctifs de stabilité', excerpt: 'Améliorations réseau et correctifs de véhicules.', body: ['Ce correctif améliore la stabilité des longues sessions et réduit les désynchronisations de véhicules.', 'Plusieurs anomalies signalées par la communauté ont également été corrigées.'] },
];

function useGameFriendCount(game: string) {
  const { relationships } = useSocial();
  return relationships.filter((friend) => friend.relationshipStatus === 'accepted' && friend.currentGame === game).length;
}

function GameFriendsPanel({ game, onOpenProfile }: { game: string; onOpenProfile: (userId: string) => void }) {
  const { relationships, loading } = useSocial();
  const items = relationships.filter((friend) => friend.relationshipStatus === 'accepted' && friend.currentGame === game);
  return <div className="modal-content friends-modal"><p className="modal-intro">Les amis actuellement présents sur {game} apparaissent ici en temps réel.</p>{loading ? <p className="friend-dialog-empty">Synchronisation…</p> : items.length ? items.map((friend) => <article key={friend.userId} onClick={() => onOpenProfile(friend.userId)}><FriendAvatar friend={friend} /><div><b>{friend.displayName}</b><small>@{friend.username} · Session active</small></div><button>Voir le profil</button></article>) : <p className="friend-dialog-empty">Aucun ami ne joue à {game} pour le moment.</p>}</div>;
}

function LifeRpModal({ panel, onClose, onOpenProfile, readNewsKeys, onMarkNewsRead }: { panel: GamePanel; onClose: () => void; onOpenProfile: (userId: string) => void } & NewsReadProps) {
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [fiveMPath, setFiveMPath] = useState('');
  const [cacheOpen, setCacheOpen] = useState(false);
  const [cacheSelection, setCacheSelection] = useState<string[]>(['cache', 'server-cache']);
  const [cacheFeedback, setCacheFeedback] = useState('');
  const [installedPacks, setInstalledPacks] = useState<string[]>([]);
  useEffect(() => {
    if (selectedNews) onMarkNewsRead(`laliferp:${selectedNews.id}`);
  }, [onMarkNewsRead, selectedNews]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const title = panel === 'achievements' ? 'Succès' : panel === 'friends' ? 'Amis en jeu' : panel === 'news' ? 'Actualités' : 'Options du jeu';
  const cacheFolders = [
    { id: 'cache', label: 'cache', size: '1,8 Go' },
    { id: 'game-storage', label: 'game-storage', size: '642 Mo' },
    { id: 'nui-storage', label: 'nui-storage', size: '184 Mo' },
    { id: 'server-cache', label: 'server-cache', size: '3,2 Go' },
    { id: 'server-cache-priv', label: 'server-cache priv', size: '96 Mo' },
  ];
  const packs = [
    { id: 'nve', title: 'Natural Vision Evolved', size: '7,8 Go', description: 'Révision visuelle complète : lumière, météo et environnements.', image: '/assets/laliferp-hero-cover.jpg' },
    { id: 'editor', title: 'Rockstar Editor Plus', size: '1,2 Go', description: 'Outils étendus pour capturer et monter vos scènes en jeu.', image: '/assets/laliferp-sun.png' },
    { id: 'misc', title: 'Modifications Diverses L.A LifeRP', size: '860 Mo', description: 'Le pack recommandé d’optimisations et d’éléments communautaires.', image: '/assets/laliferp-cover.png' },
  ];
  const pickFiveMFolder = async () => {
    try {
      const picker = (window as Window & { showDirectoryPicker?: () => Promise<{ name: string }> }).showDirectoryPicker;
      if (picker) {
        const directory = await picker.call(window);
        setFiveMPath(`…\\${directory.name}`);
      } else setFiveMPath('C:\\Users\\Alex\\AppData\\Local\\FiveM\\FiveM.app');
    } catch { /* Le sélecteur a été annulé. */ }
  };
  const toggleCacheFolder = (id: string) => setCacheSelection((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const togglePack = (id: string) => setInstalledPacks((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return createPortal(
    <div className="game-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`game-modal game-modal-${panel}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><span>L.A LIFERP</span><h2>{title}</h2></div><button aria-label="Fermer" onClick={onClose}><X size={18} /></button></header>
        {panel === 'friends' && <GameFriendsPanel game="L.A LifeRP" onOpenProfile={onOpenProfile} />}
        {panel === 'news' && <div className="modal-content news-modal">{selectedNews ? <article className="news-reader"><button className="news-back" onClick={() => setSelectedNews(null)}><ArrowLeft size={15} /> Retour aux actualités</button><div className="news-reader-hero"><span>{selectedNews.category}</span><h3>{selectedNews.title}</h3><small>{selectedNews.date}</small></div><div className="news-reader-body"><p className="lead">{selectedNews.excerpt}</p>{selectedNews.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></article> : <div className="news-feed"><button className="featured-news" onClick={() => setSelectedNews(lifeNews[0])}><div><span>{lifeNews[0].category}</span><h3>{lifeNews[0].title}{!readNewsKeys.has(`laliferp:${lifeNews[0].id}`) && <i className="new-note-badge">✦ NOUVEAU</i>}</h3><p>{lifeNews[0].excerpt}</p><em>Lire l’article <ChevronRight size={15} /></em></div></button><div className="news-grid">{lifeNews.slice(1).map((item) => <button key={item.id} onClick={() => setSelectedNews(item)}><small>{item.date} · {item.category}</small><b>{item.title}{!readNewsKeys.has(`laliferp:${item.id}`) && <i className="new-note-badge">✦ NOUVEAU</i>}</b><p>{item.excerpt}</p><em>Ouvrir <ChevronRight size={12} /></em></button>)}</div></div>}</div>}
        {panel === 'options' && <div className="modal-content options-modal"><section className="option-section"><div className="option-section-heading"><span><FolderOpen size={18} /></span><div><h3>Installation FiveM</h3><p>Sélectionnez le dossier <b>FiveM.app</b> pour activer les outils du launcher.</p></div></div><div className={`option-path ${fiveMPath ? 'configured' : ''}`}><span>Chemin d’accès</span><input aria-label="Chemin FiveM.app" value={fiveMPath} placeholder="Aucun dossier configuré" onChange={(event) => setFiveMPath(event.target.value)} /><button onClick={pickFiveMFolder}>Parcourir</button></div><div className="cache-action"><div><b>Maintenance locale</b><small>{fiveMPath ? 'Libérez de l’espace sans toucher à vos données de jeu.' : 'Configurez FiveM.app pour accéder à la maintenance.'}</small></div><button disabled={!fiveMPath} onClick={() => { setCacheFeedback(''); setCacheOpen(true); }}><Trash2 size={14} /> Vider le cache</button></div></section><section className={`option-section packs-section ${!fiveMPath ? 'section-disabled' : ''}`}><div className="option-section-heading"><span><Download size={18} /></span><div><h3>Gestion des packs</h3><p>Installez ou retirez les améliorations compatibles avec le serveur.</p></div></div><div className="pack-grid">{packs.map((pack) => { const installed = installedPacks.includes(pack.id); return <article className="pack-card" key={pack.id}><div className="pack-card-head"><img src={pack.image} alt="" /><span>{pack.size}</span></div><h4>{pack.title}</h4><p>{pack.description}</p><button disabled={!fiveMPath} className={installed ? 'remove-pack' : ''} onClick={() => togglePack(pack.id)}>{installed ? <><Trash2 size={13} /> Supprimer</> : <><Download size={13} /> Télécharger</>}</button></article>; })}</div></section>{cacheOpen && <div className="cache-modal-layer"><section className="cache-modal" role="dialog" aria-modal="true" aria-label="Vider le cache"><header><div><span>MAINTENANCE</span><h3>Vider le cache</h3></div><button aria-label="Fermer" onClick={() => setCacheOpen(false)}><X size={16} /></button></header><p>Sélectionnez les données temporaires à supprimer. Les fichiers essentiels du jeu seront conservés.</p><button className="select-all" onClick={() => setCacheSelection(cacheSelection.length === cacheFolders.length ? [] : cacheFolders.map((folder) => folder.id))}>{cacheSelection.length === cacheFolders.length ? 'Tout désélectionner' : 'Tout sélectionner'}</button><div className="cache-list">{cacheFolders.map((folder) => <label key={folder.id}><input type="checkbox" checked={cacheSelection.includes(folder.id)} onChange={() => toggleCacheFolder(folder.id)} /><span><b>{folder.label}</b><small>{folder.size}</small></span></label>)}</div>{cacheFeedback ? <p className="cache-feedback"><Check size={14} /> {cacheFeedback}</p> : <button className="clear-cache" disabled={!cacheSelection.length} onClick={() => setCacheFeedback(`${cacheSelection.length} dossier${cacheSelection.length > 1 ? 's' : ''} sélectionné${cacheSelection.length > 1 ? 's' : ''} pour suppression`)}><Trash2 size={14} /> Supprimer la sélection</button>}</section></div>}</div>}
      </section>
    </div>,
    document.body,
  );
}

function LaunchSequence({ game, artwork }: { game: string; artwork: string }) {
  return createPortal(
    <div className="launch-sequence" role="status" aria-live="assertive">
      <div className="launch-backdrop" style={{ backgroundImage: `url('${artwork}')` }} />
      <div className="launch-signal"><span /><span /><span /></div>
      <div className="launch-content">
        <img src="/assets/ae-mark.png" alt="" />
        <p>INITIALISATION DU SIGNAL</p>
        <h2>{game}</h2>
        <div className="launch-track"><i /></div>
        <div className="launch-stages"><span>Vérification</span><span>Synchronisation</span><span>Lancement</span></div>
      </div>
    </div>,
    document.body,
  );
}

function LifeRpPage({ userId, onGameLaunch, onOpenProfile, readNewsKeys, onMarkNewsRead }: { userId: string; onGameLaunch: (game: string) => void; onOpenProfile: (userId: string) => void } & NewsReadProps) {
  const [launched, setLaunched] = useState(false);
  const [openPanel, setOpenPanel] = useState<GamePanel | null>(null);
  const [, setStatisticsRevision] = useState(0);
  const launch = () => {
    setLaunched(true);
    onGameLaunch('L.A LifeRP');
    window.setTimeout(() => setLaunched(false), 1900);
  };
  const gameFriendCount = useGameFriendCount('L.A LifeRP');
  const unreadNewsCount = lifeNews.filter((item) => !readNewsKeys.has(`laliferp:${item.id}`)).length;
  const statistics = loadGameStatisticsSummary(userId, 'laliferp');
  useEffect(() => {
    const refresh = (event: Event) => { if (!(event instanceof CustomEvent) || event.detail?.gameId === 'laliferp') setStatisticsRevision((revision) => revision + 1); };
    window.addEventListener('ae-game-stats-change', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('ae-game-stats-change', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  return (
    <main className="game-page">
      <GamePageHero
        className="laliferp-game-hero"
        background={<img src="/assets/laliferp-hero.jpg" alt="L.A LifeRP" />}
        content={<>
          <img className="lalife-logo" src="/assets/laliferp-wordmark.png" alt="L.A LifeRP" />
          <p className="game-tagline">Écrivez votre histoire. Vivez votre Los Angeles.</p>
          <div className="game-actions">
            <button className="primary-play large" onClick={launch}><Play size={19} fill="currentColor" /> {launched ? 'Connexion…' : 'Jouer maintenant'}</button>
            <div className="server-inline"><i className="online-dot" /><span><b>Serveur en ligne</b><small>312 / 512 · 18 ms</small></span></div>
          </div>
        </>}
      />
      <section className="game-body">
        <div className="game-main-column">
          <div className="game-metrics">
            <GameMetric icon={<Clock3 />} value={compactTrackedDuration(statistics.totalMs)} label="Temps de jeu" />
            <GameMetric icon={<Activity />} value={String(statistics.sessionCount)} label="Nombre de sessions" />
            <GameMetric icon={<CalendarDays />} value={formatLastGameLaunch(statistics)} label="Dernier lancement" />
            <GameMetric icon={<ShieldCheck />} value="2.8.4" label="Version actuelle" />
          </div>
          <div className="section-heading"><div><h2>Dernière session</h2></div><span className="muted">Hier · 2 h 16</span></div>
          <article className="session-card"><div className="session-map"><img src="/assets/laliferp-sun.png" alt="" /></div><div><h3>Alex Morgan</h3><p>Entrepreneur · Niveau 24</p><div className="character-stats"><span><b>$ 48 250</b><small>En banque</small></span><span><b>Vespucci</b><small>Dernière position</small></span><span><b>Citoyen</b><small>Statut</small></span></div></div></article>
        </div>
        <aside className="game-side-column">
          <div className="info-card"><h3>À propos</h3><p>Une expérience roleplay exigeante au cœur d'un Los Angeles vivant, façonné par ses citoyens.</p><div><span>Développeur</span><b>L.A LifeRP</b></div><div><span>Genre</span><b>Roleplay</b></div><div><span>Version</span><b>2.8.4</b></div></div>
        </aside>
      </section>
      <GameDock label={launched ? 'Connexion…' : 'Jouer'} icon={<Play size={19} fill="currentColor" />} onPrimary={launch} onPanel={setOpenPanel} showAchievements={false} showNews friendCount={gameFriendCount} unreadNewsCount={unreadNewsCount} />
      {launched && <LaunchSequence game="L.A LifeRP" artwork="/assets/laliferp-hero.jpg" />}
      {openPanel === 'statistics' && <GameStatisticsModal userId={userId} gameId="laliferp" gameName="L.A LifeRP" onClose={() => setOpenPanel(null)} />}
      {openPanel && openPanel !== 'statistics' && <LifeRpModal panel={openPanel} onClose={() => setOpenPanel(null)} onOpenProfile={(profileId) => { setOpenPanel(null); onOpenProfile(profileId); }} readNewsKeys={readNewsKeys} onMarkNewsRead={onMarkNewsRead} />}
    </main>
  );
}

type DownloadControls = {
  installState: InstallState;
  installReport: HypeInstallReport | null;
  progress: number;
  downloadInfo: HypeDownloadProgress | null;
  hypeRunning: boolean;
  installHype: () => void;
  launchHype: () => Promise<boolean>;
  stopHype: () => Promise<boolean>;
  cancelDownload: () => void;
};

function HypeInstallModal({ report, busy, error, onChoose, onClose }: {
  report: HypeInstallReport | null;
  busy: boolean;
  error: string;
  onChoose: (version?: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<HypeReleaseNews[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const healthy = Boolean(report?.kind === 'existing' && report.executableFound && report.missingFiles.length === 0 && report.invalidFiles.length === 0);
  useEffect(() => {
    let active = true;
    void launcherAdapter.getHypeReleases().then((items) => {
      if (!active) return;
      setVersions(items);
      setSelectedVersion((current) => current || items[0]?.tagName || '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);
  return createPortal(
    <div className="game-modal-backdrop hype-modal-backdrop installer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="game-modal installer-modal" role="dialog" aria-modal="true" aria-label="Installer Hype">
        <header><div><img src={hypeLogoWhite} alt="Hype" /><h2>Installation de Hype</h2></div><button aria-label="Fermer" disabled={busy} onClick={onClose}><X size={18} /></button></header>
        <div className="installer-content">
          {!report && <div className="installer-intro"><span className="installer-icon"><FolderOpen size={28} /></span><h3>Où se trouve Hype ?</h3><p>Choisissez directement votre installation existante, ou son dossier parent. Le launcher recherchera <code>manifest.json</code> puis vérifiera les fichiers avant de l’ajouter.</p>{versions.length > 0 && <label className="installer-version-select"><span>VERSION À INSTALLER</span><CustomSelect value={selectedVersion} options={versions.map((release, index) => ({ value: release.tagName, label: `${release.tagName}${release.prerelease ? ' · préversion' : index === 0 ? ' · dernière version' : ''}` }))} onChange={setSelectedVersion} ariaLabel="Version à installer" /></label>}<button className="modal-save" disabled={busy} onClick={() => onChoose(selectedVersion || undefined)}><FolderOpen size={17} /> {busy ? 'Analyse en cours…' : 'Choisir un dossier'}</button>{launcherAdapter.environment === 'browser' && <small className="installer-note">Aperçu web : l’analyse est disponible dans les navigateurs compatibles, mais la création du dossier et le lancement de Hype.exe nécessitent l’application desktop.</small>}</div>}
          {report && <div className={`installer-result ${healthy ? 'healthy' : report.kind}`}>
            <span className="installer-icon">{healthy ? <Check size={28} /> : report.kind === 'prepared' ? <FolderOpen size={28} /> : <ShieldCheck size={28} />}</span>
            <h3>{healthy ? 'Hype est prêt à jouer' : report.kind === 'prepared' ? 'Destination préparée' : 'Installation à réparer'}</h3>
            <p>{report.message}</p>
            <div className="installer-path"><small>EMPLACEMENT</small><b>{report.path}</b></div>
            <div className="installer-summary"><span><small>VERSION</small><b>{report.version || 'À télécharger'}</b></span><span><small>FICHIERS VÉRIFIÉS</small><b>{report.verifiedFiles} / {report.totalFiles}</b></span><span><small>EXÉCUTABLE</small><b>{report.executableFound ? 'Hype.exe trouvé' : 'Hype.exe absent'}</b></span></div>
            {(report.missingFiles.length > 0 || report.invalidFiles.length > 0) && <p className="installer-warning">{report.missingFiles.length} fichier(s) manquant(s) · {report.invalidFiles.length} fichier(s) invalide(s)</p>}
            <div className="installer-actions"><button className="modal-save" onClick={healthy ? onClose : () => onChoose(selectedVersion || undefined)}>{healthy ? 'Terminer' : 'Choisir un autre dossier'}</button><button className="installer-secondary" onClick={onClose}>Fermer</button></div>
          </div>}
          {error && <div className="installer-error"><ShieldCheck size={16} /><span>{error}</span></div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

type LibraryFilter = 'all' | 'installed' | 'updates';
type LibraryView = 'list' | 'covers';
type LibrarySort = 'recent' | 'name' | 'playtime';

function LibraryPage({ setPage, userId, hypeAchievements, installState, installReport, hypePath, progress, hypeRunning, installHype, launchHype, stopHype }: { setPage: (page: Page) => void; userId: string; hypeAchievements: HypeAchievement[]; installState: InstallState; installReport: HypeInstallReport | null; hypePath: string; progress: number; hypeRunning: boolean; installHype: () => void; launchHype: () => Promise<boolean>; stopHype: () => Promise<boolean> }) {
  const [selected, setSelected] = useState<'laliferp' | 'hype'>('laliferp');
  const [launchingGame, setLaunchingGame] = useState<'laliferp' | 'hype' | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [view, setView] = useState<LibraryView>('list');
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [hypeUpdateAvailable, setHypeUpdateAvailable] = useState(false);
  const [, setStatisticsRevision] = useState(0);
  const isLife = selected === 'laliferp';
  const hypeNeedsAttention = Boolean(installReport && (installReport.missingFiles.length || installReport.invalidFiles.length));
  const hypeNeedsUpdate = hypeUpdateAvailable || hypeNeedsAttention;
  const showLife = filter !== 'updates';
  const showHype = filter === 'all' || (filter === 'installed' && installState === 'installed') || (filter === 'updates' && hypeNeedsUpdate);
  const installedCount = installState === 'installed' ? 2 : 1;
  const updatesCount = hypeNeedsUpdate ? 1 : 0;
  const actionLabel = isLife ? 'Jouer maintenant' : hypeRunning ? 'Fermer' : installState === 'installed' ? 'Jouer' : installState === 'downloading' ? `${progress} % téléchargé` : 'Installer';
  const gameStatistics = {
    laliferp: loadGameStatisticsSummary(userId, 'laliferp'),
    hype: loadGameStatisticsSummary(userId, 'hype'),
  };
  const selectedStatistics = gameStatistics[selected];
  const hypeCompletion = completedAchievements(hypeAchievements);
  const selectedVersion = isLife ? '2.8.4' : installReport?.version || '0.26.0';
  const sortLabels: Record<LibrarySort, string> = { recent: 'récents', name: 'nom du jeu', playtime: 'temps de jeu' };
  const orderedGames = ([
    { id: 'laliferp' as const, name: 'L.A LifeRP', visible: showLife, statistics: gameStatistics.laliferp },
    { id: 'hype' as const, name: 'Hype', visible: showHype, statistics: gameStatistics.hype },
  ]).filter((game) => game.visible).sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name, 'fr');
    if (sort === 'playtime') return right.statistics.totalMs - left.statistics.totalMs;
    const leftDate = left.statistics.lastSession ? new Date(left.statistics.lastSession.startedAt).getTime() : 0;
    const rightDate = right.statistics.lastSession ? new Date(right.statistics.lastSession.startedAt).getTime() : 0;
    return rightDate - leftDate || left.name.localeCompare(right.name, 'fr');
  });

  useEffect(() => {
    if (installState !== 'installed' || !hypePath || launcherAdapter.environment !== 'desktop') {
      setHypeUpdateAvailable(false);
      return;
    }
    let active = true;
    void launcherAdapter.checkHypeUpdate(hypePath).then((release) => { if (active) setHypeUpdateAvailable(release.updateAvailable); }).catch(() => undefined);
    return () => { active = false; };
  }, [hypePath, installState]);

  useEffect(() => {
    const refresh = () => setStatisticsRevision((revision) => revision + 1);
    window.addEventListener('ae-game-stats-change', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('ae-game-stats-change', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    if (selected === 'laliferp' && !showLife && showHype) setSelected('hype');
    if (selected === 'hype' && !showHype && showLife) setSelected('laliferp');
  }, [selected, showHype, showLife]);
  const runAction = async () => {
    if (isLife) {
      setLaunchingGame(selected);
      window.setTimeout(() => setLaunchingGame(null), 1900);
    } else if (hypeRunning) {
      await stopHype();
    } else if (installState === 'installed') {
      if (await launchHype()) {
        setLaunchingGame('hype');
        window.setTimeout(() => setLaunchingGame(null), 1900);
      }
    } else if (installState === 'downloading') {
      setPage('telechargements');
    } else installHype();
  };

  return (
    <main className={`library-page library-focus-${selected}`}>
      <div className="library-ambient" aria-hidden="true"><span className="ambient-life" /><span className="ambient-hype" /></div>
      <header className="collection-header">
        <div><h1>Bibliothèque</h1><p>Deux mondes, une seule porte d’entrée.</p></div>
        <div className="library-summary"><span><b>2</b><small>jeux</small></span><i /><span><b>{compactTrackedDuration(gameStatistics.laliferp.totalMs + gameStatistics.hype.totalMs)}</b><small>au total</small></span></div>
      </header>

      <section className="library-spotlight">
        <div className={`spotlight-scene spotlight-${selected}`} key={selected}>
          {isLife ? <img src="/assets/laliferp-hero.jpg" alt="" /> : <HypeArtwork />}
          <div className="spotlight-shade" />
          <div className="spotlight-copy">
            <img className={`spotlight-logo ${isLife ? 'life' : 'hype'}`} src={isLife ? '/assets/laliferp-wordmark.png' : hypeLogoWhite} alt={isLife ? 'L.A LifeRP' : 'Hype'} />
            <p>{isLife ? 'Reprenez votre histoire au cœur d’un Los Angeles façonné par ses joueurs.' : 'Créez votre personnage, publiez et laissez un monde peuplé d’IA réagir à votre histoire.'}</p>
            <div className="spotlight-meta">
              <span><Clock3 size={15} /> {compactTrackedDuration(selectedStatistics.totalMs)} jouées</span>
              {isLife
                ? <span><Activity size={15} /> {selectedStatistics.sessionCount} session{selectedStatistics.sessionCount === 1 ? '' : 's'}</span>
                : <span><Trophy size={15} /> {hypeCompletion.completed} / {hypeCompletion.total} ({hypeCompletion.percent} %)</span>}
              <span><CalendarDays size={15} /> {formatLastGameLaunch(selectedStatistics)}</span>
              <span><ShieldCheck size={15} /> Version {selectedVersion}</span>
            </div>
          </div>
        </div>
        <div className="spotlight-actions">
          <button className={`spotlight-primary ${hypeRunning && !isLife ? 'stop-game' : ''}`} onClick={runAction}>{hypeRunning && !isLife ? <X size={18} /> : !isLife && installState !== 'installed' ? <Download size={18} /> : <Play size={18} fill="currentColor" />}{actionLabel}</button>
          <button onClick={() => setPage(selected)}>Voir la fiche <ChevronRight size={16} /></button>
        </div>
        {!isLife && installState === 'downloading' && <div className="spotlight-progress"><i style={{ width: `${progress}%` }} /></div>}
      </section>

      <section className="collection-toolbar">
        <div className="collection-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tous <span>2</span></button><button className={filter === 'installed' ? 'active' : ''} onClick={() => setFilter('installed')}>Installés <span>{installedCount}</span></button><button className={filter === 'updates' ? 'active' : ''} onClick={() => setFilter('updates')}>À mettre à jour <span>{updatesCount}</span></button></div>
        <div className="view-tools"><div className="view-switch" aria-label="Mode d’affichage"><button className={view === 'list' ? 'active' : ''} aria-label="Petites cartes" onClick={() => setView('list')}><List size={17} /></button><button className={view === 'covers' ? 'active' : ''} aria-label="Pochettes" onClick={() => setView('covers')}><LayoutGrid size={17} /></button></div><div className="sort-menu"><button aria-expanded={sortOpen} onClick={() => setSortOpen((open) => !open)}><ArrowUpDown size={15} /> Trier : {sortLabels[sort]} <ChevronDown size={14} /></button>{sortOpen && <div className="sort-dropdown">{(['recent', 'name', 'playtime'] as LibrarySort[]).map((option) => <button key={option} className={sort === option ? 'active' : ''} onClick={() => { setSort(option); setSortOpen(false); }}>{option === 'recent' ? 'Récents' : option === 'name' ? 'Nom du jeu' : 'Temps de jeu'}{sort === option && <Check size={13} />}</button>)}</div>}</div></div>
      </section>

      <section className={`collection-grid ${view === 'covers' ? 'cover-view' : 'list-view'}`}>
        {orderedGames.map((game) => game.id === 'laliferp' ? <button key={game.id} data-game="laliferp" className={`collection-game ${selected === 'laliferp' ? 'selected' : ''}`} onMouseEnter={() => setSelected('laliferp')} onFocus={() => setSelected('laliferp')} onClick={() => setSelected('laliferp')} onDoubleClick={() => setPage('laliferp')}>
          <span className="collection-cover logo-cover life-logo-cover"><img src={view === 'covers' ? '/assets/laliferp-hero-cover.jpg' : '/assets/laliferp-cover.png'} alt="" /><i className="online-dot" /></span>
          <span className="collection-game-copy"><small>FIVEM</small><b>L.A LifeRP</b><em>Prêt à jouer</em></span>
          <Play className="collection-quick-action" size={18} fill="currentColor" />
        </button> : <button key={game.id} data-game="hype" className={`collection-game ${selected === 'hype' ? 'selected' : ''}`} onMouseEnter={() => setSelected('hype')} onFocus={() => setSelected('hype')} onClick={() => setSelected('hype')} onDoubleClick={() => setPage('hype')}>
          <span className="collection-cover logo-cover hype-logo-cover">{view === 'covers' ? <HypeArtwork compact /> : <img src={hypeIcon} alt="" />}{installState === 'downloading' && <i className="cover-progress" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties} />}</span>
          <span className="collection-game-copy"><small>Æ ORIGINALS</small><b>Hype</b><em>{hypeNeedsUpdate ? 'Mise à jour disponible' : hypeRunning ? 'En jeu' : installState === 'installed' ? 'Prêt à jouer' : installState === 'downloading' ? `${progress} % · Téléchargement GitHub` : 'Disponible'}</em></span>
          {hypeRunning ? <X className="collection-quick-action" size={18} /> : installState === 'installed' ? <Play className="collection-quick-action" size={18} fill="currentColor" /> : <Download className="collection-quick-action" size={18} />}
        </button>)}
        {!showLife && !showHype && <div className="collection-empty"><Check size={20} /><div><b>Aucun jeu dans cette vue</b><small>Vos jeux à mettre à jour apparaîtront automatiquement ici.</small></div></div>}
      </section>
      {launchingGame && <LaunchSequence game={launchingGame === 'laliferp' ? 'L.A LifeRP' : 'Hype'} artwork={launchingGame === 'laliferp' ? '/assets/laliferp-hero.jpg' : hypeAvatar} />}
    </main>
  );
}

function DownloadsPage({ installState, installReport, progress, downloadInfo, hypeRunning, installHype, launchHype, stopHype, cancelDownload }: DownloadControls) {
  const [queue, setQueue] = useState<{ id: string; name: string; detail: string; art: string }[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const phase = downloadInfo?.phase === 'extract' ? 'Installation' : downloadInfo?.phase === 'verify' ? 'Vérification' : 'Téléchargement';
  const reorderQueue = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setQueue((items) => {
      const sourceIndex = items.findIndex((item) => item.id === draggedId);
      const targetIndex = items.findIndex((item) => item.id === targetId);
      const next = [...items];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedId(null);
  };
  return (
    <main className="downloads-page">
      <header className="downloads-header">
        <div><h1>Téléchargements</h1><p>Gérez vos installations, mises à jour et contenus additionnels.</p></div>
      </header>

      {installState === 'downloading' && <section className="active-transfer hype-transfer state-downloading">
        <HypeArtwork compact />
        <div className="transfer-main">
          <div className="transfer-heading"><div><h2>Hype</h2><p>{phase} · Version {installReport?.version || '0.26.0'}</p></div><strong>GitHub Release</strong></div>
          <div className="transfer-track"><i style={{ width: `${progress}%` }} /></div>
          <div className="transfer-details"><span>{downloadInfo?.total ? `${formatInstallSize(downloadInfo.downloaded)} sur ${formatInstallSize(downloadInfo.total)}` : 'Préparation du téléchargement…'}</span><b>{progress} %</b></div>
          <div className="transfer-performance">
            <div><Wifi size={15} /><span><small>SOURCE</small><b>GitHub</b></span></div>
            <div><Gauge size={15} /><span><small>PROGRESSION</small><b>{progress} %</b></span></div>
            <div><HardDrive size={15} /><span><small>ÉTAPE</small><b>{phase}</b></span></div>
          </div>
        </div>
        <div className="transfer-controls">
          <button className="transfer-secondary" onClick={cancelDownload}>Annuler</button>
        </div>
      </section>}

      {installState === 'available' && <section className="download-status-card hype-transfer available">
        <HypeArtwork compact />
        <div><span>INSTALLATION DISPONIBLE</span><h2>Hype n’est pas encore installé</h2><p>Ajoutez votre installation existante ou choisissez l’emplacement qui accueillera le jeu.</p></div>
        <button className="transfer-primary" onClick={installHype}><FolderOpen size={18} /> Installer Hype</button>
      </section>}

      {installState === 'installed' && <section className="download-status-card hype-transfer installed">
        <div className="download-ready-art"><HypeArtwork compact /><Check size={18} /></div>
        <div><span>TOUT EST À JOUR</span><h2>Hype est prêt à jouer</h2><p>{installReport?.verifiedFiles ?? 0} fichier(s) vérifié(s) · Version {installReport?.version || '0.26.0'}</p><code title={installReport?.path}>{installReport?.path || 'Installation locale'}</code></div>
        <button className={`transfer-primary ${hypeRunning ? 'stop-game' : ''}`} onClick={() => void (hypeRunning ? stopHype() : launchHype())}>{hypeRunning ? <X size={18} /> : <Play size={18} fill="currentColor" />} {hypeRunning ? 'Fermer' : 'Jouer'}</button>
      </section>}

      <section className="queue-panel">
        <div className="download-section-title"><h2>File d’attente</h2><span>Faites glisser pour réorganiser</span></div>
        <div className="queue-list">
          {queue.length === 0 && <div className="queue-empty"><Check size={17} /><span><b>La file d’attente est vide</b><small>Les prochains téléchargements apparaîtront ici.</small></span></div>}
          {queue.map((item, index) => (
            <article
              className={`queue-item ${draggedId === item.id ? 'dragging' : ''}`}
              draggable
              key={item.id}
              onDragStart={() => setDraggedId(item.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => reorderQueue(item.id)}
            >
              <GripVertical className="drag-handle" size={19} />
              <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
              <img src={item.art} alt="" />
              <div><b>{item.name}</b><small>{item.detail}</small></div>
              <span className="scheduled">En attente</span>
              <MoreHorizontal size={18} />
            </article>
          ))}
        </div>
        {installState === 'installed' && <div className="download-history"><Check size={16} /><span><b>Installation de Hype vérifiée</b><small>{installReport?.version ? `Version ${installReport.version}` : 'Version 0.26.0'} · {installReport?.verifiedFiles ?? 0} fichier(s)</small></span><em>AUJOURD’HUI</em></div>}
      </section>
    </main>
  );
}

type HypeInstallationActions = {
  installState: InstallState;
  installReport: HypeInstallReport | null;
  installationResolved: boolean;
  hypeRunning: boolean;
  onInstall: () => void;
  onVerify: () => Promise<HypeInstallReport>;
  onUpdate: (version?: string) => Promise<string>;
  onRepair: () => Promise<string>;
  onReveal: () => Promise<void>;
  onMove: () => Promise<HypeInstallReport | null>;
  onForget: () => Promise<void>;
  onUninstall: () => Promise<void>;
};

function formatInstallSize(bytes: number) {
  if (!bytes) return 'Taille inconnue';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1).replace('.', ',')} Go`;
  return `${Math.max(1, Math.round(bytes / 1_048_576))} Mo`;
}

function normalizeHypeVersion(version: string | undefined) {
  return (version || '').trim().replace(/^hype-v/i, '').replace(/^v/i, '');
}

function HypeInstallationPanel({ installState, installReport, installationResolved, hypeRunning, onInstall, onVerify, onUpdate, onRepair, onReveal, onMove, onForget, onUninstall }: HypeInstallationActions) {
  const [busy, setBusy] = useState<'verify' | 'update' | 'repair' | 'move' | 'uninstall' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'forget' | 'uninstall' | null>(null);
  const [versions, setVersions] = useState<HypeReleaseNews[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const installed = installState === 'installed' && Boolean(installReport);
  const healthy = Boolean(installReport?.executableFound && installReport.missingFiles.length === 0 && installReport.invalidFiles.length === 0);
  useEffect(() => {
    let active = true;
    void launcherAdapter.getHypeReleases().then((items) => {
      if (!active) return;
      setVersions(items);
      setSelectedVersion((current) => current || items[0]?.tagName || '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const verify = async () => {
    setBusy('verify');
    setFeedback('');
    try {
      const report = await onVerify();
      setFeedback(report.missingFiles.length || report.invalidFiles.length ? `${report.missingFiles.length} fichier(s) manquant(s) · ${report.invalidFiles.length} invalide(s)` : `${report.verifiedFiles} fichier(s) vérifié(s), aucun problème détecté.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const checkUpdate = async () => {
    setBusy('update');
    setFeedback('');
    try { setFeedback(await onUpdate(selectedVersion || undefined)); }
    catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const repair = async () => {
    setBusy('move');
    setFeedback('');
    try { setFeedback(await onRepair()); }
    catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const moveInstallation = async () => {
    setBusy('repair');
    setFeedback('');
    setManageOpen(false);
    try {
      const report = await onMove();
      if (report) setFeedback(`Installation déplacée vers ${report.path}`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const confirmManagement = async () => {
    if (!confirmation) return;
    const action = confirmation;
    setBusy(action === 'uninstall' ? 'uninstall' : null);
    setFeedback('');
    try {
      if (action === 'uninstall') await onUninstall();
      else await onForget();
      setConfirmation(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
      setConfirmation(null);
    } finally { setBusy(null); }
  };

  if (!installationResolved || (installState === 'installed' && !installReport)) return (
    <div className="hype-installation-panel installation-empty">
      <RefreshCw className="spinning" size={24} />
      <div><span>INSTALLATION</span><h3>Vérification de Hype…</h3><p>Le launcher restaure automatiquement l’emplacement mémorisé.</p></div>
    </div>
  );

  if (!installed) return (
    <div className="hype-installation-panel installation-empty">
      <div className="installation-empty-art"><img src={hypeIcon} alt="" /></div>
      <div><span>INSTALLATION</span><h3>Hype n’est pas lié à ce launcher</h3><p>Choisissez votre installation existante ou préparez un nouvel emplacement pour retrouver les informations de version et les outils de maintenance.</p></div>
      <button className="modal-save" onClick={onInstall}><FolderOpen size={16} /> Choisir une installation</button>
    </div>
  );

  return (
    <div className="hype-installation-panel">
      <section className="installation-overview">
        <div className="installation-game-mark"><img src={hypeIcon} alt="" /><i className={healthy ? 'healthy' : 'warning'}>{healthy ? <Check size={13} /> : <AlertTriangle size={13} />}</i></div>
        <div className="installation-identity"><span>INSTALLATION ACTUELLE</span><h3>Hype <em>{installReport?.version || 'Locale'}</em></h3><p className={healthy ? 'healthy' : 'warning'}>{healthy ? 'Prêt à jouer · fichiers locaux valides' : 'Cette installation demande votre attention'}</p></div>
        <div className="installation-facts">
          <span><small>VERSION</small><b>{installReport?.version || 'Locale'}</b></span>
          <span><small>CANAL</small><b>Stable</b></span>
          <span><small>TAILLE SUIVIE</small><b>{formatInstallSize(installReport?.installedSize || 0)}</b></span>
          <span><small>FICHIERS</small><b>{installReport?.verifiedFiles || 0} / {installReport?.totalFiles || 0}</b></span>
        </div>
        <div className="installation-location"><FolderOpen size={15} /><span><small>EMPLACEMENT</small><code title={installReport?.path}>{installReport?.path}</code></span><button onClick={() => void onReveal()}>Ouvrir le dossier</button></div>
      </section>

      <section className="installation-maintenance">
        <div className="installation-section-heading"><div><span>MAINTENANCE</span><h3>Garder le jeu en bon état</h3></div><small>Dernière vérification · à l’ouverture du launcher</small></div>
        <div className="maintenance-actions">
          <button disabled={busy !== null || hypeRunning} onClick={() => void verify()}><ShieldCheck size={19} /><span><b>{busy === 'verify' ? 'Vérification…' : 'Vérifier les fichiers'}</b><small>Contrôle les fichiers à partir du manifeste local.</small></span></button>
          <button disabled={busy !== null || hypeRunning} onClick={() => void checkUpdate()}><Download className={busy === 'update' ? 'spinning' : ''} size={19} /><span><b>{busy === 'update' ? 'Installation…' : 'Installer la version choisie'}</b><small>Télécharge la release sélectionnée ci-dessous.</small></span></button>
          <button disabled={healthy || busy !== null || hypeRunning} onClick={() => void repair()}><Wrench className={busy === 'repair' ? 'spinning' : ''} size={19} /><span><b>{busy === 'repair' ? 'Réparation…' : 'Réparer l’installation'}</b><small>{healthy ? 'Aucune réparation nécessaire.' : 'Retélécharge les fichiers invalides.'}</small></span></button>
        </div>
        {versions.length > 0 && <div className="hype-version-picker"><label><span>Version à télécharger</span><CustomSelect value={selectedVersion} disabled={busy !== null || hypeRunning} options={versions.map((release, index) => ({ value: release.tagName, label: `${release.tagName}${release.prerelease ? ' · préversion' : index === 0 ? ' · dernière version' : ''}` }))} onChange={setSelectedVersion} ariaLabel="Version à télécharger" /></label><small>Permet aussi de revenir à une version antérieure publiée.</small></div>}
        {hypeRunning && <p className="installation-feedback warning"><AlertTriangle size={14} /> Fermez Hype pour vérifier, réparer ou désinstaller ses fichiers.</p>}
        {feedback && <p className="installation-feedback"><Check size={14} /> {feedback}</p>}
      </section>

      <section className="installation-management">
        <div><span>GESTION DE L’INSTALLATION</span><p>Ces actions modifient uniquement le lien avec cette installation ou ses fichiers locaux.</p></div>
        <div className="installation-manage-menu">
          <button className="manage-installation-button" aria-expanded={manageOpen} onClick={() => setManageOpen(!manageOpen)}>Gérer l’installation <ChevronDown size={15} /></button>
          {manageOpen && <div className="manage-installation-dropdown">
            <button disabled={hypeRunning || busy !== null} onClick={() => void moveInstallation()}><MoveRight size={16} /><span><b>Déplacer</b><small>Transfère le jeu vers un autre dossier.</small></span></button>
            <button className="danger" disabled={hypeRunning} onClick={() => { setConfirmation('uninstall'); setManageOpen(false); }}><Trash2 size={16} /><span><b>Désinstaller</b><small>Supprimera le jeu du disque.</small></span></button>
            <button onClick={() => { setConfirmation('forget'); setManageOpen(false); }}><X size={16} /><span><b>Oublier</b><small>Délie l’installation sans supprimer ses fichiers.</small></span></button>
          </div>}
        </div>
      </section>

      {confirmation && <div className="installation-confirmation"><div><span className={confirmation === 'uninstall' ? 'danger' : ''}>{confirmation === 'uninstall' ? <Trash2 size={22} /> : <X size={22} />}</span><h3>{confirmation === 'uninstall' ? 'Désinstaller Hype ?' : 'Oublier cette installation ?'}</h3><p>{confirmation === 'uninstall' ? `Tous les fichiers contenus dans « ${installReport?.path} » seront définitivement supprimés du disque.` : 'Le jeu restera intact sur le disque. Vous pourrez le relier à nouveau plus tard en sélectionnant son dossier.'}</p><div><button onClick={() => setConfirmation(null)}>Annuler</button><button className={confirmation === 'uninstall' ? 'danger' : 'confirm'} disabled={busy === 'uninstall'} onClick={() => void confirmManagement()}>{busy === 'uninstall' ? 'Désinstallation…' : confirmation === 'uninstall' ? 'Désinstaller' : 'Oublier'}</button></div></div></div>}
    </div>
  );
}

function formatReleaseDate(date: string) {
  if (!date) return 'DATE INCONNUE';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date)).toUpperCase();
}

function releaseParagraphs(body: string) {
  return body.replace(/\r/g, '').split(/\n{2,}/).map((paragraph) => paragraph
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()).filter(Boolean);
}

function releaseExcerpt(release: HypeReleaseNews) {
  const paragraph = releaseParagraphs(release.body)[0] || `Découvrez les changements publiés avec ${release.tagName}.`;
  return paragraph.length > 180 ? `${paragraph.slice(0, 177).trim()}…` : paragraph;
}

function ReleaseMarkdown({ body }: { body: string }) {
  return <div className="release-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{body || '*Aucune note de version détaillée.*'}</ReactMarkdown></div>;
}

function HypeAchievementIcon({ iconKey }: { iconKey: string }) {
  if (iconKey === 'heart') return <Heart size={18} />;
  if (iconKey === 'user-plus') return <UserPlus size={18} />;
  if (iconKey === 'globe') return <Globe2 size={18} />;
  if (iconKey === 'lock') return <Lock size={18} />;
  return <Trophy size={18} />;
}

type HypeAchievementProps = {
  achievements: HypeAchievement[];
  achievementLoading: boolean;
  achievementError: string;
  onRefreshAchievements: () => void;
};

function HypeModal({ panel, onClose, onOpenProfile, readNewsKeys, onMarkNewsRead, achievements, achievementLoading, achievementError, onRefreshAchievements, ...installationActions }: { panel: GamePanel; onClose: () => void; onOpenProfile: (userId: string) => void } & HypeInstallationActions & NewsReadProps & HypeAchievementProps) {
  const [settings, setSettings] = useState({ notifications: true, animations: true, matureTopics: false });
  const [optionsSection, setOptionsSection] = useState<'general' | 'installation'>('installation');
  const [achievementFilter, setAchievementFilter] = useState<AchievementFilter>('all');
  const [achievementQuery, setAchievementQuery] = useState('');
  const [releases, setReleases] = useState<HypeReleaseNews[]>([]);
  const [releaseQuery, setReleaseQuery] = useState('');
  const [selectedRelease, setSelectedRelease] = useState<HypeReleaseNews | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState('');
  useEffect(() => {
    if (selectedRelease) onMarkNewsRead(`hype:${selectedRelease.id}`);
  }, [onMarkNewsRead, selectedRelease]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    if (panel !== 'news') return;
    let active = true;
    setReleaseLoading(true);
    setReleaseError('');
    void launcherAdapter.getHypeReleases().then((items) => {
      if (active) setReleases(items);
    }).catch((error: unknown) => {
      if (active) setReleaseError(error instanceof Error ? error.message : 'Les Releases GitHub sont indisponibles.');
    }).finally(() => {
      if (active) setReleaseLoading(false);
    });
    return () => { active = false; };
  }, [panel]);
  useEffect(() => {
    if (panel === 'achievements') onRefreshAchievements();
  }, [onRefreshAchievements, panel]);
  const unlockedAchievements = achievements.filter((achievement) => achievement.unlockedAt);
  const activeAchievements = achievements.filter((achievement) => !achievement.unlockedAt && achievement.progress > 0);
  const achievementProgress = achievements.length
    ? Math.round((unlockedAchievements.length / achievements.length) * 100)
    : 0;
  const visibleAchievements = [...achievements]
    .sort((left, right) => Number(Boolean(right.unlockedAt)) - Number(Boolean(left.unlockedAt)) || right.progressPercent - left.progressPercent || left.title.localeCompare(right.title, 'fr'))
    .filter((achievement) => {
      const state: AchievementFilter = achievement.unlockedAt ? 'unlocked' : achievement.progress > 0 ? 'progress' : 'locked';
      const matchesFilter = achievementFilter === 'all' || achievementFilter === state;
      const query = achievementQuery.trim().toLocaleLowerCase('fr');
      return matchesFilter && (!query || `${achievement.title} ${achievement.description}`.toLocaleLowerCase('fr').includes(query));
    });
  const visibleReleases = releases.filter((release) => {
    const query = releaseQuery.trim().toLocaleLowerCase('fr');
    return !query || `${release.name} ${release.tagName} ${release.body}`.toLocaleLowerCase('fr').includes(query);
  });
  const title = panel === 'achievements' ? 'Succès' : panel === 'friends' ? 'Amis sur Hype' : panel === 'news' ? 'Actualités' : 'Options du jeu';
  return createPortal(
    <div className="game-modal-backdrop hype-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`game-modal hype-game-modal game-modal-${panel}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><img src={hypeLogoWhite} alt="Hype" /><h2>{title}</h2></div><button aria-label="Fermer" onClick={onClose}><X size={18} /></button></header>
        {panel === 'achievements' && <div className="modal-content achievements-modal"><div className="achievement-dashboard"><article><span><Trophy size={17} /></span><div><small>Tous les succès</small><strong>{achievements.length}</strong></div></article><article><span><Check size={17} /></span><div><small>Débloqués</small><strong>{unlockedAchievements.length}</strong></div></article><article><span><Activity size={17} /></span><div><small>En cours</small><strong>{activeAchievements.length}</strong></div></article><article><span><Gauge size={17} /></span><div><small>Complétion</small><strong>{achievementProgress} %</strong></div></article></div><div className="achievement-toolbar"><div className="achievement-filter">{([['all', 'Tous'], ['unlocked', 'Débloqués'], ['progress', 'En cours'], ['locked', 'Verrouillés']] as [AchievementFilter, string][]).map(([filter, label]) => <button key={filter} className={achievementFilter === filter ? 'active' : ''} onClick={() => setAchievementFilter(filter)}>{label}</button>)}</div><label className="achievement-search"><Search size={14} /><input value={achievementQuery} onChange={(event) => setAchievementQuery(event.target.value)} placeholder="Rechercher un succès…" /></label></div>{achievementLoading && achievements.length === 0 && <div className="achievement-state"><RefreshCw className="spinning" size={18} /><span>Synchronisation des succès Hype…</span></div>}{achievementError && <div className="achievement-state error"><AlertTriangle size={18} /><span>{achievementError}</span><button onClick={onRefreshAchievements}>Réessayer</button></div>}{!achievementLoading && !achievementError && achievements.length === 0 && <div className="achievement-state"><Trophy size={18} /><span>Aucun succès Hype n’est disponible.</span></div>}{achievements.length > 0 && visibleAchievements.length === 0 && <div className="achievement-state"><Search size={18} /><span>Aucun succès ne correspond à cette recherche.</span></div>}<div className="achievement-catalog">{visibleAchievements.map((achievement) => { const unlocked = Boolean(achievement.unlockedAt); const inProgress = !unlocked && achievement.progress > 0; return <article className={`achievement-entry ${unlocked ? 'unlocked' : inProgress ? 'progress' : 'locked'}`} key={achievement.achievementKey}><span><HypeAchievementIcon iconKey={achievement.iconKey} /></span><div className="achievement-copy"><b>{achievement.title}</b><small>{achievement.description}</small>{inProgress && <div className="achievement-item-progress"><i><em style={{ width: `${achievement.progressPercent}%` }} /></i><strong>{new Intl.NumberFormat('fr-FR').format(achievement.progress)} / {new Intl.NumberFormat('fr-FR').format(achievement.goal)}</strong></div>}</div><em>{achievement.rarityPercent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</em>{unlocked ? <Check size={17} /> : inProgress ? <span className="achievement-percent">{Math.round(achievement.progressPercent)} %</span> : <span className="achievement-lock">?</span>}</article>; })}</div></div>}
        {panel === 'friends' && <GameFriendsPanel game="Hype" onOpenProfile={onOpenProfile} />}
        {panel === 'news' && <div className="modal-content hype-news-modal">{!selectedRelease && <label className="release-search"><Search size={15} /><input value={releaseQuery} onChange={(event) => setReleaseQuery(event.target.value)} placeholder="Rechercher une version ou dans les notes…" /><span>{visibleReleases.length} résultat{visibleReleases.length > 1 ? 's' : ''}</span></label>}{releaseLoading && <div className="hype-release-state"><RefreshCw className="spinning" size={19} /><span><b>Chargement des Releases GitHub</b><small>Récupération du fil officiel de Hype…</small></span></div>}{releaseError && <div className="hype-release-state error"><AlertTriangle size={19} /><span><b>Actualités indisponibles</b><small>{releaseError}</small></span></div>}{!releaseLoading && !releaseError && selectedRelease && <article className="news-reader"><button className="news-back" onClick={() => setSelectedRelease(null)}><ArrowLeft size={15} /> Retour aux actualités</button><div className="news-reader-hero hype-release-hero"><HypeArtwork compact /><div className="release-hero-copy"><span>{selectedRelease.prerelease ? 'PRÉVERSION' : selectedRelease.tagName}</span><h3>{selectedRelease.name}</h3><small>{formatReleaseDate(selectedRelease.publishedAt)}</small></div></div><div className="news-reader-body"><ReleaseMarkdown body={selectedRelease.body} /></div></article>}{!releaseLoading && !releaseError && !selectedRelease && visibleReleases.length > 0 && <div className="news-feed hype-release-feed"><button className="featured-news hype-featured-release" onClick={() => setSelectedRelease(visibleReleases[0])}><HypeArtwork compact /><div className="release-card-copy"><span>{visibleReleases[0].tagName}</span><h3>{visibleReleases[0].name}{!readNewsKeys.has(`hype:${visibleReleases[0].id}`) && <i className="new-note-badge">✦ NOUVEAU</i>}</h3><p>{releaseExcerpt(visibleReleases[0])}</p><em>Lire les notes <ChevronRight size={15} /></em></div></button><div className="news-grid">{visibleReleases.slice(1).map((release) => <button key={release.id} onClick={() => setSelectedRelease(release)}><small>{formatReleaseDate(release.publishedAt)}{release.prerelease ? ' · PRÉVERSION' : ''}</small><b>{release.name}{!readNewsKeys.has(`hype:${release.id}`) && <i className="new-note-badge">✦ NOUVEAU</i>}</b><p>{releaseExcerpt(release)}</p><em>Ouvrir <ChevronRight size={12} /></em></button>)}</div></div>}{!releaseLoading && !releaseError && releases.length > 0 && visibleReleases.length === 0 && <div className="hype-release-state"><Search size={19} /><span><b>Aucune actualité trouvée</b><small>Essayez une autre version ou un autre mot-clé.</small></span></div>}{!releaseLoading && !releaseError && releases.length === 0 && <div className="hype-release-state"><Newspaper size={19} /><span><b>Aucune actualité publiée</b><small>Les futures versions de Hype apparaîtront ici.</small></span></div>}</div>}
        {panel === 'options' && <div className="hype-options-layout"><nav><button className={optionsSection === 'general' ? 'active' : ''} onClick={() => setOptionsSection('general')}><Settings size={16} /><span><b>Général</b><small>Expérience de jeu</small></span></button><button className={optionsSection === 'installation' ? 'active' : ''} onClick={() => setOptionsSection('installation')}><HardDrive size={16} /><span><b>Installation</b><small>Version et fichiers</small></span></button></nav><div className="hype-options-content">{optionsSection === 'general' ? <div className="modal-content options-modal"><div className="option-block"><span><b>Notifications sociales</b><small>Afficher les nouveaux messages, réactions et abonnements.</small></span><button aria-label="Notifications sociales" aria-pressed={settings.notifications} className={settings.notifications ? 'toggle active' : 'toggle'} onClick={() => setSettings({ ...settings, notifications: !settings.notifications })}><i /></button></div><div className="option-block"><span><b>Animations de l’interface</b><small>Conserver les transitions et réactions du fil.</small></span><button aria-label="Animations de l’interface" aria-pressed={settings.animations} className={settings.animations ? 'toggle active' : 'toggle'} onClick={() => setSettings({ ...settings, animations: !settings.animations })}><i /></button></div><div className="option-block"><span><b>Thèmes sensibles</b><small>Autoriser les personnages à aborder des sujets plus matures.</small></span><button aria-label="Thèmes sensibles" aria-pressed={settings.matureTopics} className={settings.matureTopics ? 'toggle active' : 'toggle'} onClick={() => setSettings({ ...settings, matureTopics: !settings.matureTopics })}><i /></button></div><button className="modal-save" onClick={onClose}>Enregistrer les options</button></div> : <HypeInstallationPanel {...installationActions} />}</div></div>}
      </section>
    </div>,
    document.body,
  );
}

function HypePage({ userId, installState, installReport, installationResolved, progress, hypeRunning, installHype, launchHype, stopHype, onVerify, onUpdate, onRepair, onReveal, onMove, onForget, onUninstall, onOpenProfile, readNewsKeys, onMarkNewsRead, achievements, achievementLoading, achievementError, onRefreshAchievements }: Pick<DownloadControls, 'installState' | 'installReport' | 'progress' | 'hypeRunning' | 'installHype' | 'launchHype' | 'stopHype'> & Pick<HypeInstallationActions, 'installationResolved' | 'onVerify' | 'onUpdate' | 'onRepair' | 'onReveal' | 'onMove' | 'onForget' | 'onUninstall'> & { userId: string; onOpenProfile: (userId: string) => void } & NewsReadProps & HypeAchievementProps) {
  const [launching, setLaunching] = useState(false);
  const [openPanel, setOpenPanel] = useState<GamePanel | null>(null);
  const [releaseIds, setReleaseIds] = useState<number[]>([]);
  const [, setStatisticsRevision] = useState(0);
  const needsRepair = installState === 'installed' && Boolean(installReport && (!installReport.executableFound || installReport.missingFiles.length || installReport.invalidFiles.length));
  const gameFriendCount = useGameFriendCount('Hype');
  const unreadNewsCount = releaseIds.filter((id) => !readNewsKeys.has(`hype:${id}`)).length;

  useEffect(() => {
    let active = true;
    void launcherAdapter.getHypeReleases()
      .then((items) => { if (active) setReleaseIds(items.map((release) => release.id)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refresh = (event: Event) => { if (!(event instanceof CustomEvent) || event.detail?.gameId === 'hype') setStatisticsRevision((revision) => revision + 1); };
    window.addEventListener('ae-game-stats-change', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('ae-game-stats-change', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  const hypeStatistics = loadGameStatisticsSummary(userId, 'hype');
  const hypeCompletion = completedAchievements(achievements);

  const installLabel = useMemo(() => {
    if (installState === 'downloading') return `Téléchargement · ${progress} %`;
    if (hypeRunning) return 'Fermer';
    if (needsRepair) return 'Réparer';
    if (installState === 'installed') return 'Jouer';
    return 'Installer';
  }, [hypeRunning, installState, needsRepair, progress]);

  const handlePrimaryAction = async () => {
    if (installState === 'available') installHype();
    if (hypeRunning) {
      await stopHype();
      setLaunching(false);
    } else if (needsRepair) {
      setOpenPanel('options');
    } else if (installState === 'installed') {
      if (await launchHype()) {
        setLaunching(true);
        window.setTimeout(() => setLaunching(false), 1900);
      }
    }
  };

  return (
    <main className="game-page hype-page hype-brand-page">
      <GamePageHero
        className="hype-game-hero"
        background={<div className="hype-hero-pattern" aria-hidden="true"><span /><span /><span /></div>}
        content={<>
          <img className="hype-wordmark" src={hypeLogoWhite} alt="Hype" />
          <h1>Ta vie en ligne,<br />version jeu.</h1>
          <p>Crée ton perso, choisis un monde et poste. Tout le monde est une IA sauf toi : on te répond, on s’abonne, on s’attache… ou on te cancel.</p>
          <div className="game-actions">
            <button className={`primary-play large ${hypeRunning ? 'stop-game' : ''}`} onClick={handlePrimaryAction}>{hypeRunning ? <X size={19} /> : needsRepair ? <Wrench size={19} /> : installState === 'installed' ? <Play size={19} fill="currentColor" /> : <Download size={19} />}{installLabel}</button>
            <div className="hype-version"><span>VERSION ACTUELLE</span><b>{installReport?.version || '0.26.0'}</b></div>
          </div>
          {installState === 'downloading' && <div className="download-progress hype-download-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{progress} % · Téléchargement en cours</small></div>}
        </>}
        showcase={<HypeArtwork />}
      />
      <section className="game-body hype-game-body">
        <div className="game-main-column">
          <div className="game-metrics hype-metrics">
            <GameMetric icon={<Clock3 />} value={compactTrackedDuration(hypeStatistics.totalMs)} label="Temps de jeu" />
            <GameMetric icon={<Trophy />} value={`${hypeCompletion.completed} / ${hypeCompletion.total} (${hypeCompletion.percent} %)`} label="Succès complétés" />
            <GameMetric icon={<CalendarDays />} value={formatLastGameLaunch(hypeStatistics)} label="Dernier lancement" />
            <GameMetric icon={<ShieldCheck />} value={installReport?.version || '0.26.0'} label="Version actuelle" />
          </div>
          <div className="section-heading"><div><h2>À toi de créer le buzz.</h2></div><span className="muted">Chaque monde réagit à tes choix</span></div>
          <section className="hype-loop-grid">
            <article><span>01</span><div><UserPlus size={20} /><h3>Crée ton perso</h3><p>Choisis qui tu veux être, ton style et la première impression que tu laisseras.</p></div></article>
            <article><span>02</span><div><Globe2 size={20} /><h3>Choisis un monde</h3><p>Entre dans un réseau avec ses codes, ses tendances et ses personnalités.</p></div></article>
            <article><span>03</span><div><Heart size={20} /><h3>Poste. Rencontre. Existe.</h3><p>Crée du contenu, noue des relations et découvre ce que le réseau retient de toi.</p></div></article>
          </section>
          <section className="hype-pulse-card"><div><span>TON HISTOIRE ÉVOLUE</span><h3>Ils se souviennent de ce que tu fais.</h3><p>Les personnages IA réagissent à tes publications, construisent leur propre opinion et font évoluer tes relations au fil des conversations.</p><div><i><Heart size={14} /> Attachement</i><i><MessageCircle size={14} /> Conversations</i><i><Activity size={14} /> Réputation</i></div></div><img src={hypeIcon} alt="" /></section>
        </div>
        <aside className="game-side-column hype-side-column">
          <div className="hype-profile-card"><img src={hypeAvatar} alt="Icône Hype" /><span><b>Ton prochain toi.</b><small>Un profil. Une histoire. Aucun script.</small></span><div><strong>12 480</strong><small>abonnés potentiels</small></div></div>
          <div className="info-card"><h3>À propos</h3><p>Un petit jeu fun de simulation de réseau social, peuplé de personnages gérés par IA. Faites des rencontres, créez du contenu et voyez jusqu’où votre histoire peut aller.</p><div><span>Développeur</span><b>Æ Games</b></div><div><span>Genre</span><b>Simulation sociale</b></div><div><span>Expérience</span><b>Solo · IA générative</b></div><div><span>Version</span><b>{installReport?.version || '0.26.0'}</b></div></div>
        </aside>
      </section>
      <GameDock label={installLabel} icon={hypeRunning ? <X size={19} /> : needsRepair ? <Wrench size={19} /> : installState === 'installed' ? <Play size={19} fill="currentColor" /> : <Download size={19} />} onPrimary={handlePrimaryAction} onPanel={setOpenPanel} showNews friendCount={gameFriendCount} unreadNewsCount={unreadNewsCount} primaryDanger={hypeRunning} />
      {launching && <LaunchSequence game="Hype" artwork={hypeAvatar} />}
      {openPanel === 'statistics' && <GameStatisticsModal userId={userId} gameId="hype" gameName="Hype" onClose={() => setOpenPanel(null)} />}
      {openPanel && openPanel !== 'statistics' && <HypeModal panel={openPanel} onClose={() => setOpenPanel(null)} onOpenProfile={(profileId) => { setOpenPanel(null); onOpenProfile(profileId); }} installState={installState} installReport={installReport} installationResolved={installationResolved} hypeRunning={hypeRunning} onInstall={installHype} onVerify={onVerify} onUpdate={onUpdate} onRepair={onRepair} onReveal={onReveal} onMove={onMove} onForget={onForget} onUninstall={onUninstall} readNewsKeys={readNewsKeys} onMarkNewsRead={onMarkNewsRead} achievements={achievements} achievementLoading={achievementLoading} achievementError={achievementError} onRefreshAchievements={onRefreshAchievements} />}
    </main>
  );
}

type SettingsSection = 'general' | 'interface' | 'downloads' | 'notifications' | 'privacy' | 'advanced';

const settingsSections: { id: SettingsSection; label: string; detail: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'Général', detail: 'Comportement du launcher', icon: <Settings size={17} /> },
  { id: 'interface', label: 'Interface', detail: 'Échelle et animations', icon: <Monitor size={17} /> },
  { id: 'downloads', label: 'Téléchargements', detail: 'Réseau et installations', icon: <Download size={17} /> },
  { id: 'notifications', label: 'Notifications', detail: 'Alertes et sons', icon: <Bell size={17} /> },
  { id: 'privacy', label: 'Confidentialité', detail: 'Présence et données', icon: <Lock size={17} /> },
  { id: 'advanced', label: 'Avancé', detail: 'Canal et diagnostic', icon: <SlidersHorizontal size={17} /> },
];

function SettingsToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button className={`settings-toggle ${checked ? 'active' : ''}`} aria-label={label} aria-pressed={checked} onClick={() => onChange(!checked)}><i /></button>;
}

function SettingsRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="settings-row"><span><b>{title}</b><small>{description}</small></span><div className="settings-control">{children}</div></div>;
}

function LauncherUpdateModal({ currentVersion, version, notes, state, progress, error, onDownload, onRestart, onClose }: { currentVersion: string; version: string; notes: string; state: 'available' | 'downloading' | 'ready' | 'installing' | 'error'; progress: number; error: string; onDownload: () => void; onRestart: () => void; onClose: () => void }) {
  const busy = state === 'downloading' || state === 'installing';
  return createPortal(<div className="game-modal-backdrop launcher-update-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="launcher-update-modal" role="dialog" aria-modal="true" aria-label="Mise à jour du launcher"><header><div><span>Æ GAMES LAUNCHER</span><h2>Mise à jour {version}</h2><p>Votre version {currentVersion} va être remplacée par la nouvelle version stable.</p></div><button disabled={busy} aria-label="Fermer" onClick={onClose}><X size={18} /></button></header><div className="launcher-update-modal-body"><section className="launcher-update-notes"><h3>Notes de version</h3><ReleaseMarkdown body={notes || '*Aucune note détaillée pour cette version.*'} /></section><section className={`launcher-update-download state-${state}`}><div><span>{state === 'available' ? 'Prêt à télécharger' : state === 'downloading' ? 'Téléchargement et vérification' : state === 'ready' ? 'Téléchargement terminé' : state === 'installing' ? 'Installation en cours' : 'Mise à jour interrompue'}</span><b>{state === 'ready' ? '100 %' : `${progress} %`}</b></div><i><span style={{ width: `${state === 'ready' ? 100 : progress}%` }} /></i>{state === 'ready' ? <p>La mise à jour est prête. Voulez-vous redémarrer le launcher maintenant pour terminer l’installation ?</p> : state === 'error' ? <p className="error">{error}</p> : <p>Vous pouvez continuer à utiliser le launcher pendant le téléchargement.</p>}</section><footer>{state === 'available' && <button className="primary" onClick={onDownload}><Download size={16} /> Télécharger la mise à jour</button>}{state === 'downloading' && <button disabled><RefreshCw className="spinning" size={16} /> Téléchargement…</button>}{state === 'ready' && <><button onClick={onClose}>Plus tard</button><button className="primary" onClick={onRestart}><RefreshCw size={16} /> Redémarrer et installer</button></>}{state === 'installing' && <button disabled><RefreshCw className="spinning" size={16} /> Redémarrage…</button>}{state === 'error' && <><button onClick={onClose}>Fermer</button><button className="primary" onClick={onDownload}>Réessayer</button></>}</footer></div></section></div>, document.body);
}

function SettingsPage({ settings, updateSettings, effectiveScale, onChooseInstall, onVerifyLauncher, onReset }: {
  settings: LauncherSettings;
  updateSettings: (patch: Partial<LauncherSettings>) => void;
  effectiveScale: number;
  onChooseInstall: () => Promise<void>;
  onVerifyLauncher: () => Promise<string>;
  onReset: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('general');
  const [diagnostic, setDiagnostic] = useState('');
  const [checking, setChecking] = useState(false);
  const [launcherVersion, setLauncherVersion] = useState('…');
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'current' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateNotes, setUpdateNotes] = useState('');
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [scaleDraft, setScaleDraft] = useState(settings.uiScale);
  const toggle = (key: keyof LauncherSettings, label: string) => <SettingsToggle label={label} checked={Boolean(settings[key])} onChange={(value) => updateSettings({ [key]: value })} />;

  useEffect(() => {
    launcherAdapter.getLauncherVersion().then(setLauncherVersion).catch(() => setLauncherVersion('Inconnue'));
  }, []);

  useEffect(() => setScaleDraft(settings.uiScale), [settings.uiScale]);
  const applyScaleDraft = () => {
    if (settings.scaleMode !== 'custom' || scaleDraft !== settings.uiScale) updateSettings({ uiScale: scaleDraft, scaleMode: 'custom' });
  };

  const runVerification = async () => {
    setChecking(true);
    setDiagnostic('');
    try { setDiagnostic(await onVerifyLauncher()); }
    finally { setChecking(false); }
  };
  const checkLauncherUpdate = async () => {
    setUpdateState('checking');
    setUpdateMessage('');
    setUpdateProgress(0);
    try {
      const update = await launcherAdapter.checkLauncherUpdate();
      if (!update) {
        setUpdateState('current');
        setUpdateMessage('Vous utilisez déjà la dernière version disponible.');
        return;
      }
      setUpdateVersion(update.version);
      setUpdateNotes(update.notes?.trim() || 'Aucune note détaillée pour cette version.');
      setUpdateState('available');
      setUpdateMessage(`La version ${update.version} est prête à être téléchargée.`);
    } catch (error) {
      setUpdateState('error');
      setUpdateMessage(error instanceof Error ? error.message : 'La vérification de la mise à jour a échoué.');
    }
  };
  const downloadLauncherUpdate = async () => {
    setUpdateModalOpen(true);
    setUpdateState('downloading');
    setUpdateMessage('Téléchargement de la mise à jour…');
    try {
      await launcherAdapter.downloadLauncherUpdate(setUpdateProgress);
      setUpdateProgress(100);
      setUpdateState('ready');
      setUpdateMessage('Téléchargement terminé. Le redémarrage reste à confirmer.');
    } catch (error) {
      setUpdateState('error');
      setUpdateMessage(error instanceof Error ? error.message : 'L’installation de la mise à jour a échoué.');
    }
  };
  const restartForLauncherUpdate = async () => {
    setUpdateState('installing');
    try {
      await launcherAdapter.installLauncherUpdate();
    } catch (error) {
      setUpdateState('error');
      setUpdateMessage(error instanceof Error ? error.message : 'Le redémarrage pour installer la mise à jour a échoué.');
    }
  };

  return (<>
    <main className="settings-page">
      <header className="settings-heading">
        <div><h1>Réglages</h1><p>Adaptez le launcher à votre façon de jouer.</p></div>
        <div className="settings-health"><span><i /> Æ Launcher</span><b>Tout est opérationnel</b></div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Catégories des réglages">
          {settingsSections.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span>{item.icon}</span><div><b>{item.label}</b><small>{item.detail}</small></div><ChevronRight size={15} /></button>)}
        </nav>
        <section className="settings-canvas">
          {section === 'general' && <>
            <div className="settings-section-title"><span><Settings size={19} /></span><div><h2>Général</h2><p>Le comportement du launcher avant, pendant et après vos sessions.</p></div></div>
            <div className="settings-group"><h3>Démarrage</h3><SettingsRow title="Lancer avec Windows" description="Ouvrir automatiquement Æ Games à votre connexion.">{toggle('launchAtStartup', 'Lancer avec Windows')}</SettingsRow><SettingsRow title="Démarrer minimisé" description="Garder le launcher discret dans la zone de notification.">{toggle('startMinimized', 'Démarrer minimisé')}</SettingsRow></div>
            <div className="settings-group"><h3>Pendant le jeu</h3><SettingsRow title="Réduire au lancement d’un jeu" description="Libérer l’écran dès que le jeu démarre.">{toggle('minimizeOnGameLaunch', 'Réduire au lancement')}</SettingsRow><SettingsRow title="Restaurer après la session" description="Réafficher le launcher lorsque le jeu se ferme.">{toggle('restoreAfterGame', 'Restaurer après le jeu')}</SettingsRow><SettingsRow title="Fermer dans la barre système" description="Le bouton fermer conserve le launcher en arrière-plan.">{toggle('closeToTray', 'Fermer dans la barre système')}</SettingsRow></div>
          </>}

          {section === 'interface' && <>
            <div className="settings-section-title"><span><Monitor size={19} /></span><div><h2>Interface</h2><p>Une lecture confortable, quelle que soit la taille de votre écran.</p></div></div>
            <div className="scale-stage">
              <div className="scale-preview"><span className="preview-rail"><i /><i /><i /></span><span className="preview-content"><b /><i /><i /></span></div>
              <div><span>APERÇU EN DIRECT</span><strong>{settings.scaleMode === 'auto' ? Math.round(effectiveScale * 100) : scaleDraft} %</strong><small>{settings.scaleMode === 'auto' ? 'Adapté automatiquement à cette fenêtre' : 'Appliquée au relâchement du curseur'}</small></div>
            </div>
            <div className="settings-group"><h3>Taille de l’interface</h3><SettingsRow title="Échelle automatique" description="Ajuster la taille selon la résolution et la fenêtre, avec 150 % recommandé en 4K."><SettingsToggle label="Échelle automatique" checked={settings.scaleMode === 'auto'} onChange={(checked) => updateSettings({ scaleMode: checked ? 'auto' : 'custom' })} /></SettingsRow><div className={`scale-control ${settings.scaleMode === 'auto' ? 'disabled' : ''}`}><div><span>Échelle personnalisée</span><b>{scaleDraft} %</b></div><input type="range" min="80" max="200" step="5" value={scaleDraft} disabled={settings.scaleMode === 'auto'} onChange={(event) => setScaleDraft(Number(event.target.value))} onPointerUp={applyScaleDraft} onPointerCancel={applyScaleDraft} onKeyUp={applyScaleDraft} onBlur={applyScaleDraft} /><div className="scale-marks"><span>80 %</span><span>100 %</span><span>125 %</span><span>150 %</span><span>200 %</span></div></div></div>
            <div className="settings-group"><h3>Confort visuel</h3><SettingsRow title="Interface compacte" description="Réduire l’espacement tout en conservant la taille du texte.">{toggle('compactMode', 'Interface compacte')}</SettingsRow><SettingsRow title="Réduire les animations" description="Limiter les transitions et effets de mouvement.">{toggle('reducedMotion', 'Réduire les animations')}</SettingsRow><SettingsRow title="Contraste renforcé" description="Accentuer les textes secondaires et les séparations.">{toggle('highContrast', 'Contraste renforcé')}</SettingsRow></div>
          </>}

          {section === 'downloads' && <>
            <div className="settings-section-title"><span><Download size={19} /></span><div><h2>Téléchargements</h2><p>Contrôlez où, quand et à quelle vitesse vos jeux sont installés.</p></div></div>
            <div className="settings-group"><h3>Installation</h3><div className="settings-path"><span><small>DOSSIER D’INSTALLATION PAR DÉFAUT</small><b>{settings.defaultInstallPath || 'Choisi lors de chaque nouvelle installation'}</b></span><button onClick={() => void onChooseInstall()}><FolderOpen size={15} /> Modifier</button></div><SettingsRow title="Mises à jour automatiques" description="Maintenir les jeux installés à jour en arrière-plan.">{toggle('autoUpdates', 'Mises à jour automatiques')}</SettingsRow></div>
            <div className="settings-group"><h3>Réseau</h3><div className="bandwidth-control"><div><span>Limite de téléchargement</span><b>{settings.bandwidthLimit === 0 ? 'Illimitée' : `${settings.bandwidthLimit} Mo/s`}</b></div><input type="range" min="0" max="100" step="5" value={settings.bandwidthLimit} onChange={(event) => updateSettings({ bandwidthLimit: Number(event.target.value) })} /></div><SettingsRow title="Téléchargements simultanés" description="Nombre maximal de transferts actifs."><CustomSelect value={String(settings.concurrentDownloads)} options={[{ value: '1', label: '1 transfert' }, { value: '2', label: '2 transferts' }, { value: '3', label: '3 transferts' }]} onChange={(value) => updateSettings({ concurrentDownloads: Number(value) })} ariaLabel="Téléchargements simultanés" /></SettingsRow><SettingsRow title="Planifier les téléchargements" description="Limiter les téléchargements à une plage horaire.">{toggle('scheduledDownloads', 'Planifier les téléchargements')}</SettingsRow>{settings.scheduledDownloads && <div className="schedule-row"><label>De <input type="time" value={settings.scheduleStart} onChange={(event) => updateSettings({ scheduleStart: event.target.value })} /></label><span>à</span><label><input type="time" value={settings.scheduleEnd} onChange={(event) => updateSettings({ scheduleEnd: event.target.value })} /></label></div>}</div>
          </>}

          {section === 'notifications' && <>
            <div className="settings-section-title"><span><Bell size={19} /></span><div><h2>Notifications</h2><p>Choisissez les moments où le launcher doit attirer votre attention.</p></div></div>
            <div className="settings-group"><h3>Activité</h3><SettingsRow title="Amis en ligne" description="Lorsqu’un ami se connecte ou lance un jeu.">{toggle('friendNotifications', 'Notifications des amis')}</SettingsRow><SettingsRow title="Invitations" description="Demandes d’amis et invitations de groupe.">{toggle('inviteNotifications', 'Notifications des invitations')}</SettingsRow><SettingsRow title="Succès" description="Afficher les succès débloqués pendant une session.">{toggle('achievementNotifications', 'Notifications des succès')}</SettingsRow></div>
            <div className="settings-group"><h3>Launcher</h3><SettingsRow title="Téléchargements terminés" description="Prévenir lorsqu’un jeu est prêt.">{toggle('downloadNotifications', 'Notifications des téléchargements')}</SettingsRow><SettingsRow title="Actualités et mises à jour" description="Nouveautés importantes de vos jeux.">{toggle('newsNotifications', 'Notifications des actualités')}</SettingsRow><SettingsRow title="Sons des notifications" description="Jouer un son discret avec les alertes."><div className="inline-setting"><Volume2 size={16} />{toggle('notificationSounds', 'Sons des notifications')}</div></SettingsRow></div>
          </>}

          {section === 'privacy' && <>
            <div className="settings-section-title"><span><Lock size={19} /></span><div><h2>Confidentialité</h2><p>Décidez quelles informations sont visibles par votre entourage.</p></div></div>
            <div className="privacy-callout"><ShieldCheck size={21} /><div><b>Vos installations restent locales.</b><p>Les chemins de jeux et vérifications de fichiers ne quittent pas cet ordinateur.</p></div></div>
            <div className="settings-group"><h3>Présence</h3><SettingsRow title="Partager le jeu en cours" description="Afficher votre activité aux amis Æ Games.">{toggle('shareGameActivity', 'Partager le jeu en cours')}</SettingsRow><SettingsRow title="Présence Discord" description="Afficher le jeu et la durée de session sur Discord.">{toggle('discordPresence', 'Présence Discord')}</SettingsRow><SettingsRow title="Statut en ligne" description="Autoriser vos amis à voir votre disponibilité.">{toggle('shareOnlineStatus', 'Partager le statut')}</SettingsRow></div>
            <div className="settings-group"><h3>Données techniques</h3><SettingsRow title="Rapports de crash" description="Envoyer des diagnostics anonymisés en cas d’erreur.">{toggle('crashReports', 'Rapports de crash')}</SettingsRow></div>
          </>}

          {section === 'advanced' && <>
            <div className="settings-section-title"><span><SlidersHorizontal size={19} /></span><div><h2>Avancé</h2><p>Diagnostic, versions expérimentales et remise à zéro.</p></div></div>
            <div className="settings-group"><h3>Mises à jour du launcher</h3><SettingsRow title="Canal de publication" description="Les versions publiées et signées par Æ Games."><CustomSelect value={settings.releaseChannel} options={[{ value: 'stable', label: 'Stable' }]} onChange={(releaseChannel) => updateSettings({ releaseChannel })} ariaLabel="Canal de publication" /></SettingsRow><div className={`launcher-update-card state-${updateState}`}><div className="launcher-update-summary"><span><small>VERSION INSTALLÉE</small><b>{launcherVersion}</b></span>{updateVersion && <span><small>VERSION DISPONIBLE</small><b>{updateVersion}</b></span>}<button className="settings-action" disabled={updateState === 'checking' || updateState === 'downloading' || updateState === 'installing'} onClick={() => void checkLauncherUpdate()}><RefreshCw className={updateState === 'checking' ? 'spinning' : ''} size={15} />{updateState === 'checking' ? 'Recherche…' : 'Rechercher'}</button></div>{updateMessage && <div className="launcher-update-feedback">{updateState === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}<p>{updateMessage}</p></div>}{updateState === 'available' && <button className="launcher-update-install" onClick={() => setUpdateModalOpen(true)}><Download size={16} /> Voir et télécharger la version {updateVersion}</button>}{updateState === 'ready' && <button className="launcher-update-install" onClick={() => setUpdateModalOpen(true)}><RefreshCw size={16} /> Terminer l’installation</button>}{updateState === 'downloading' && <div className="launcher-update-progress"><div><span>Téléchargement et vérification</span><b>{updateProgress > 0 ? `${updateProgress} %` : 'Préparation…'}</b></div><i><span style={{ width: `${updateProgress}%` }} /></i><small>Le launcher vous demandera avant de redémarrer.</small></div>}</div></div>
            <div className="settings-group"><h3>Diagnostic</h3><SettingsRow title="Vérifier l’installation du launcher" description="Contrôler l’exécutable et les ressources locales de Æ Games."><button className="settings-action" disabled={checking} onClick={() => void runVerification()}><ShieldCheck size={15} />{checking ? 'Vérification…' : 'Vérifier'}</button></SettingsRow>{diagnostic && <div className="diagnostic-result"><Check size={15} />{diagnostic}</div>}<SettingsRow title="Réinitialiser les réglages" description="Restaurer les préférences par défaut sans toucher aux jeux."><button className="settings-action danger" onClick={onReset}>Réinitialiser</button></SettingsRow></div>
          </>}
        </section>
      </div>
    </main>
    {updateModalOpen && updateVersion && <LauncherUpdateModal currentVersion={launcherVersion} version={updateVersion} notes={updateNotes} state={updateState === 'available' || updateState === 'downloading' || updateState === 'ready' || updateState === 'installing' || updateState === 'error' ? updateState : 'available'} progress={updateProgress} error={updateMessage} onDownload={() => void downloadLauncherUpdate()} onRestart={() => void restartForLauncherUpdate()} onClose={() => setUpdateModalOpen(false)} />}
  </>);
}

function Launcher({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const { setPresenceGame } = useSocial();
  const [page, setPage] = useState<Page>('accueil');
  const [selectedProfileId, setSelectedProfileId] = useState(user.id);
  const [profileReturnPage, setProfileReturnPage] = useState<Page>('accueil');
  const [installState, setInstallState] = useState<InstallState>(() => localStorage.getItem('ae-hype-install-path') ? 'installed' : 'available');
  const [progress, setProgress] = useState(0);
  const [downloadInfo, setDownloadInfo] = useState<HypeDownloadProgress | null>(null);
  const [installerOpen, setInstallerOpen] = useState(false);
  const [installerBusy, setInstallerBusy] = useState(false);
  const [installerError, setInstallerError] = useState('');
  const [installReport, setInstallReport] = useState<HypeInstallReport | null>(null);
  const [hypePath, setHypePath] = useState(() => localStorage.getItem('ae-hype-install-path') || '');
  const [installationResolved, setInstallationResolved] = useState(() => launcherAdapter.environment !== 'desktop' || Boolean(localStorage.getItem('ae-hype-install-path')));
  const [hypeRunning, setHypeRunning] = useState(false);
  const [hypeAchievements, setHypeAchievements] = useState<HypeAchievement[]>([]);
  const [achievementLoading, setAchievementLoading] = useState(true);
  const [achievementError, setAchievementError] = useState('');
  const [notifications, setNotifications] = useState<LauncherNotification[]>([]);
  const [achievementToast, setAchievementToast] = useState<HypeAchievement | null>(null);
  const [readNewsKeys, setReadNewsKeys] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<LauncherSettings>(loadLauncherSettings);
  const [automaticScale, setAutomaticScale] = useState(getAutomaticInterfaceScale);
  const [profileShellTheme, setProfileShellTheme] = useState<ProfileTheme | null>(null);
  const effectiveScale = settings.scaleMode === 'auto' ? automaticScale : settings.uiScale / 100;
  const hypeWasRunning = useRef(false);
  const achievementSessionActive = useRef(false);
  const achievementSnapshotReady = useRef(false);
  const unlockedAchievementKeys = useRef<Set<string>>(new Set());
  const activeGameRef = useRef<string | null>(null);
  const trackedGameRef = useRef<GameId | null>(null);

  useEffect(() => {
    if (launcherAdapter.environment !== 'desktop') return;
    let active = true;
    void (async () => {
      let nativePath: string | null = null;
      try {
        try { nativePath = await launcherAdapter.loadHypeInstallPath(); }
        catch { /* Fall back to the WebView value and migrate it again below. */ }
        if (!active) return;
        const localPath = localStorage.getItem('ae-hype-install-path') || '';
        const resolvedPath = nativePath || localPath;
        if (!resolvedPath) return;
        localStorage.setItem('ae-hype-install-path', resolvedPath);
        setHypePath(resolvedPath);
        setInstallState('installed');
        setProgress(100);
        if (!nativePath) await launcherAdapter.saveHypeInstallPath(resolvedPath);
      } finally {
        if (active) setInstallationResolved(true);
      }
    })().catch(() => undefined);
    return () => { active = false; };
  }, []);

  const refreshHypeAchievements = useCallback(() => {
    setAchievementLoading(true);
    setAchievementError('');
    void loadMyHypeAchievements().then((items) => {
      const unlocked = new Set(items.filter((item) => item.unlockedAt).map((item) => item.achievementKey));
      if (achievementSnapshotReady.current) {
        const newlyUnlocked = items.filter((item) => item.unlockedAt && !unlockedAchievementKeys.current.has(item.achievementKey));
        if (newlyUnlocked.length > 0 && settings.achievementNotifications) {
          const now = Date.now();
          setNotifications((current) => [
            ...newlyUnlocked.map((item, index) => ({ id: `${item.achievementKey}-${now}-${index}`, title: 'Succès déverrouillé', detail: `« ${item.title} » · Hype`, createdAt: now, read: false })),
            ...current,
          ].slice(0, 30));
          setAchievementToast(newlyUnlocked.at(-1) ?? null);
        }
      }
      unlockedAchievementKeys.current = unlocked;
      achievementSnapshotReady.current = true;
      setHypeAchievements(items);
    }).catch((error: unknown) => {
      setAchievementError(error instanceof Error ? error.message : 'Les succès Hype sont indisponibles.');
    }).finally(() => setAchievementLoading(false));
  }, [settings.achievementNotifications]);

  useEffect(() => {
    refreshHypeAchievements();
    let timer = 0;
    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshHypeAchievements, 120);
    };
    const channel = supabase
      .channel(`hype-achievements-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_achievement_progress', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .subscribe();
    window.addEventListener('focus', scheduleRefresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', scheduleRefresh);
      void supabase.removeChannel(channel);
    };
  }, [refreshHypeAchievements, user.id]);

  useEffect(() => {
    if (!achievementToast) return;
    const timer = window.setTimeout(() => setAchievementToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [achievementToast]);

  const refreshReadNews = useCallback(() => {
    void loadReadNewsKeys(user.id).then(setReadNewsKeys).catch(() => undefined);
  }, [user.id]);

  const markNewsRead = useCallback((newsKey: string) => {
    setReadNewsKeys((current) => current.has(newsKey) ? current : new Set([...current, newsKey]));
    void markNewsKeyRead(user.id, newsKey).then(refreshReadNews).catch(() => undefined);
  }, [refreshReadNews, user.id]);

  useEffect(() => {
    refreshReadNews();
    const channel = supabase
      .channel(`launcher-news-reads-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_news_reads', filter: `user_id=eq.${user.id}` }, refreshReadNews)
      .subscribe();
    const refreshOnFocus = () => refreshReadNews();
    const refreshOnStorage = (event: StorageEvent) => { if (event.key === `ae-read-news:${user.id}`) refreshReadNews(); };
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('storage', refreshOnStorage);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('storage', refreshOnStorage);
      void supabase.removeChannel(channel);
    };
  }, [refreshReadNews, user.id]);

  const openProfile = (profileId: string) => {
    if (page !== 'profil') setProfileReturnPage(page);
    setSelectedProfileId(profileId);
    setPage('profil');
  };

  const trackGameStart = useCallback((gameId: GameId) => {
    if (trackedGameRef.current && trackedGameRef.current !== gameId) finishGameSession(user.id, trackedGameRef.current);
    trackedGameRef.current = gameId;
    beginGameSession(user.id, gameId);
  }, [user.id]);

  const trackGameEnd = useCallback((gameId: GameId) => {
    finishGameSession(user.id, gameId);
    if (trackedGameRef.current === gameId) trackedGameRef.current = null;
  }, [user.id]);

  const publishCurrentGame = (game: string) => {
    activeGameRef.current = game;
    trackGameStart(game === 'Hype' ? 'hype' : 'laliferp');
    setPresenceGame(game);
  };

  useEffect(() => {
    let disposed = false;
    let closing = false;
    let unlistenClose: (() => void) | undefined;
    const sessionTimer = window.setInterval(() => {
      if (trackedGameRef.current) heartbeatGameSession(user.id, trackedGameRef.current);
    }, 25000);
    const handleBeforeUnload = () => {
      activeGameRef.current = null;
      if (trackedGameRef.current) finishGameSession(user.id, trackedGameRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    if (launcherAdapter.environment === 'desktop') {
      void getCurrentWindow().onCloseRequested(async (event) => {
        if (closing) return;
        closing = true;
        event.preventDefault();
        if (trackedGameRef.current) finishGameSession(user.id, trackedGameRef.current);
        await getCurrentWindow().destroy();
      }).then((unlisten) => {
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      window.clearInterval(sessionTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unlistenClose?.();
      if (trackedGameRef.current) finishGameSession(user.id, trackedGameRef.current);
    };
  }, [user.id]);

  useEffect(() => {
    document.documentElement.style.setProperty('--launcher-ui-scale', String(effectiveScale));
    if (launcherAdapter.environment === 'desktop') {
      const minimumWidth = Math.ceil(MIN_INTERFACE_WIDTH * effectiveScale);
      const minimumHeight = Math.ceil(MIN_INTERFACE_HEIGHT * effectiveScale);
      const targetWidth = Math.max(minimumWidth, window.innerWidth);
      const targetHeight = Math.max(minimumHeight, window.innerHeight);
      const launcherWindow = getCurrentWindow();
      const previousScale = Number(sessionStorage.getItem('ae-window-interface-scale'));
      const mustResizeWindow = !Number.isFinite(previousScale) || Math.abs(previousScale - effectiveScale) > .001;
      sessionStorage.setItem('ae-window-interface-scale', String(effectiveScale));
      void Promise.all([launcherWindow.isMaximized(), launcherWindow.isFullscreen()]).then(async ([maximized, fullscreen]) => {
        // Updating window bounds during a Ctrl+R reload makes a maximized,
        // borderless Windows window briefly restore and jump on screen.
        if (maximized || fullscreen) return;
        await launcherWindow.setMinSize(new LogicalSize(minimumWidth, minimumHeight));
        if (mustResizeWindow && (Math.abs(window.innerWidth - targetWidth) > 1 || Math.abs(window.innerHeight - targetHeight) > 1)) {
          await launcherWindow.setSize(new LogicalSize(targetWidth, targetHeight));
        }
      }).catch(() => undefined);
    }
    return () => {
      document.documentElement.style.removeProperty('--launcher-ui-scale');
    };
  }, [effectiveScale]);

  useEffect(() => {
    if (!hypePath || launcherAdapter.environment !== 'desktop') return;
    launcherAdapter.verifyHypeInstallation(hypePath).then((report) => {
      setInstallReport(report);
      if (report.kind === 'existing') {
        setInstallState('installed');
        setProgress(100);
      }
    }).catch(() => {
      // A verification may run while an in-place update is swapping folders, or
      // after a transient disk error. Keep the user's explicit location linked;
      // only the dedicated "Oublier" and uninstall actions may erase it.
      setInstallState('installed');
      setProgress(100);
    });
  }, [hypePath]);

  useEffect(() => {
    if (launcherAdapter.environment !== 'desktop') return;
    let active = true;
    const refresh = () => launcherAdapter.isHypeRunning().then((running) => {
      if (active) setHypeRunning(running);
    }).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (hypeRunning) {
      trackGameStart('hype');
      activeGameRef.current = 'Hype';
      setPresenceGame('Hype');
    } else if (hypeWasRunning.current) {
      trackGameEnd('hype');
      activeGameRef.current = null;
      setPresenceGame(null);
      if (achievementSessionActive.current) {
        achievementSessionActive.current = false;
        void revokeHypeAchievementSessions().catch(() => undefined);
      }
    }
    hypeWasRunning.current = hypeRunning;
  }, [hypeRunning, setPresenceGame, trackGameEnd, trackGameStart]);

  useEffect(() => {
    const updateAutomaticScale = () => setAutomaticScale(getAutomaticInterfaceScale());
    window.addEventListener('resize', updateAutomaticScale);
    return () => window.removeEventListener('resize', updateAutomaticScale);
  }, []);

  useEffect(() => {
    localStorage.setItem('ae-launcher-settings', JSON.stringify(settings));
    localStorage.removeItem('ae-ui-scale');
  }, [settings]);

  const updateSettings = (patch: Partial<LauncherSettings>) => setSettings((current) => ({ ...current, ...patch }));

  const openInstaller = async () => {
    setInstallerError('');
    let linkedPath = hypePath || localStorage.getItem('ae-hype-install-path') || '';
    if (!linkedPath && launcherAdapter.environment === 'desktop') {
      try { linkedPath = await launcherAdapter.loadHypeInstallPath() || ''; }
      catch { /* The folder picker remains available as the fallback. */ }
    }
    if (linkedPath) {
      localStorage.setItem('ae-hype-install-path', linkedPath);
      setHypePath(linkedPath);
      setInstallState('installed');
      setProgress(100);
      try {
        const report = await launcherAdapter.verifyHypeInstallation(linkedPath);
        setInstallReport(report);
        return;
      } catch {
        // The path remains authoritative even if an interrupted update left the
        // files incomplete. Repair in place instead of asking for a folder again.
        await downloadHype(linkedPath);
        return;
      }
    }
    setInstallReport(null);
    setInstallerOpen(true);
  };
  const downloadHype = async (path: string, version?: string) => {
    const storedPath = hypePath || localStorage.getItem('ae-hype-install-path') || '';
    const hadLinkedInstallation = Boolean(storedPath);
    const previouslyLinkedPath = storedPath || path;
    const previousReport = installReport;
    // Persist the destination before the update starts so a restart or failed
    // folder swap cannot make the launcher forget an existing installation.
    await launcherAdapter.saveHypeInstallPath(path);
    setHypePath(path);
    setInstallerOpen(false);
    setInstallState('downloading');
    setProgress(0);
    setDownloadInfo(null);
    try {
      const report = await launcherAdapter.installHype(path, (info) => {
        setDownloadInfo(info);
        setProgress(info.percentage);
      }, version);
      setInstallReport(report);
      setHypePath(report.path);
      await launcherAdapter.saveHypeInstallPath(report.path);
      setInstallState('installed');
      setProgress(100);
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await launcherAdapter.saveHypeInstallPath(previouslyLinkedPath);
      setHypePath(previouslyLinkedPath);
      setInstallState('installed');
      setProgress(100);
      setDownloadInfo(null);
      setInstallReport(previousReport);
      if (!hadLinkedInstallation && !message.toLowerCase().includes('annul')) {
        setInstallerError(message);
        setInstallReport(null);
        setInstallerOpen(true);
      }
      throw error;
    }
  };
  const chooseInstallation = async (version?: string) => {
    setInstallerBusy(true);
    setInstallerError('');
    try {
      let linkedPath = hypePath || localStorage.getItem('ae-hype-install-path') || '';
      if (!linkedPath && launcherAdapter.environment === 'desktop') {
        linkedPath = await launcherAdapter.loadHypeInstallPath() || '';
      }
      if (linkedPath) {
        await downloadHype(linkedPath, version);
        return;
      }
      const report = await launcherAdapter.selectHypeInstallation(settings.defaultInstallPath);
      if (!report) return;
      setInstallReport(report);
      if (report.kind === 'existing') {
        setHypePath(report.path);
        await launcherAdapter.saveHypeInstallPath(report.path);
        setInstallState('installed');
        setProgress(100);
      } else {
        await downloadHype(report.path, version);
      }
    } catch (error) {
      setInstallerError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstallerBusy(false);
    }
  };
  const launchHype = async () => {
    if (!hypePath) {
      openInstaller();
      return false;
    }
    let achievementConfig: HypeAchievementLaunchConfig | undefined;
    try {
      try {
        const session = await createHypeAchievementSession();
        achievementConfig = {
          supabaseUrl: supabasePublicConfig.url,
          publishableKey: supabasePublicConfig.publishableKey,
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt,
        };
        achievementSessionActive.current = true;
        setAchievementError('');
      } catch (error) {
        setAchievementError(`${error instanceof Error ? error.message : 'La session de succès est indisponible.'} Hype peut être lancé, mais les succès ne seront pas synchronisés pendant cette partie.`);
      }
      await launcherAdapter.launchHype(hypePath, achievementConfig);
      setHypeRunning(true);
      return true;
    } catch (error) {
      if (achievementSessionActive.current) {
        achievementSessionActive.current = false;
        void revokeHypeAchievementSessions().catch(() => undefined);
      }
      setInstallerError(error instanceof Error ? error.message : String(error));
      setInstallReport(null);
      setInstallerOpen(true);
      return false;
    }
  };
  const stopHype = async () => {
    try {
      await launcherAdapter.stopHype();
      setHypeRunning(false);
      if (achievementSessionActive.current) {
        achievementSessionActive.current = false;
        void revokeHypeAchievementSessions().catch(() => undefined);
      }
      return true;
    } catch (error) {
      setInstallerError(error instanceof Error ? error.message : String(error));
      setInstallerOpen(true);
      return false;
    }
  };
  const verifyHype = async () => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    const report = await launcherAdapter.verifyHypeInstallation(hypePath);
    setInstallReport(report);
    setInstallState('installed');
    setProgress(100);
    return report;
  };
  const updateHype = async (version?: string) => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    if (hypeRunning) throw new Error('Fermez Hype avant de rechercher ou installer une mise à jour.');
    if (version) {
      if (normalizeHypeVersion(installReport?.version) === normalizeHypeVersion(version)) return `Hype ${normalizeHypeVersion(version)} est déjà installé.`;
      await downloadHype(hypePath, version);
      return `Hype ${version} a été installé avec succès.`;
    }
    const release = await launcherAdapter.checkHypeUpdate(hypePath);
    if (!release.updateAvailable) return `Hype ${release.version} est déjà à jour.`;
    await downloadHype(hypePath);
    return `Hype ${release.version} a été installé avec succès.`;
  };
  const repairHype = async () => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    if (hypeRunning) throw new Error('Fermez Hype avant de réparer son installation.');
    const report = await downloadHype(hypePath);
    return `Hype${report.version ? ` ${report.version}` : ''} a été réparé et vérifié.`;
  };
  const revealHype = async () => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    await launcherAdapter.revealHypeInstallation(hypePath);
  };
  const moveHype = async () => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    if (hypeRunning) throw new Error('Fermez Hype avant de déplacer son installation.');
    const report = await launcherAdapter.moveHypeInstallation(hypePath);
    if (!report) return null;
    setInstallReport(report);
    setHypePath(report.path);
    await launcherAdapter.saveHypeInstallPath(report.path);
    return report;
  };
  const forgetHype = async () => {
    await launcherAdapter.clearHypeInstallPath();
    setHypePath('');
    setInstallReport(null);
    setInstallState('available');
    setProgress(0);
    setDownloadInfo(null);
  };
  const uninstallHype = async () => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    if (hypeRunning) throw new Error('Fermez Hype avant de le désinstaller.');
    await launcherAdapter.uninstallHype(hypePath);
    await forgetHype();
  };
  const chooseDefaultInstallDirectory = async () => {
    try {
      const path = await launcherAdapter.selectInstallDirectory();
      if (path) updateSettings({ defaultInstallPath: path });
    } catch (error) {
      setInstallerError(error instanceof Error ? error.message : String(error));
      setInstallerOpen(true);
    }
  };
  const verifyLauncher = () => launcherAdapter.verifyLauncherInstallation();
  const cancelDownload = () => { void launcherAdapter.cancelHypeDownload(); };
  const updateProfileShellTheme = useCallback((theme: ProfileTheme | null) => setProfileShellTheme(theme), []);
  const shellStyle = {
    '--ui-scale': effectiveScale,
    ...(page === 'profil' && profileShellTheme ? {
      '--profile-shell-background': `linear-gradient(${profileShellTheme.angle}deg, ${profileShellTheme.background}, ${profileShellTheme.mode === 'solid' ? profileShellTheme.background : profileShellTheme.backgroundSecondary})`,
      '--shell-base': profileShellTheme.background,
      '--shell-deep': profileShellTheme.mode === 'solid' ? profileShellTheme.background : profileShellTheme.backgroundSecondary,
      '--shell-wash': hexToRgbChannels(profileShellTheme.accent),
      '--game-accent': profileShellTheme.accent,
      '--game-accent-rgb': hexToRgbChannels(profileShellTheme.accent),
    } : {}),
  } as React.CSSProperties;
  return (
    <div className={`launcher-shell theme-${page} ${page === 'telechargements' ? 'theme-hype' : ''} ${settings.compactMode ? 'ui-compact' : ''} ${settings.reducedMotion ? 'ui-reduced-motion' : ''} ${settings.highContrast ? 'ui-high-contrast' : ''}`} style={shellStyle}>
      <Sidebar page={page} setPage={setPage} installState={installState} progress={progress} hypeRunning={hypeRunning} user={user} onSignOut={onSignOut} onOpenProfile={openProfile} />
      <section className="workspace">
        <Topbar setPage={setPage} onOpenProfile={openProfile} notifications={notifications} onMarkNotificationsRead={() => setNotifications((current) => current.map((notification) => ({ ...notification, read: true })))} />
        <div className="workspace-scroll" key={page}>
          {page === 'accueil' && <HomePage setPage={setPage} user={user} hypeAchievements={hypeAchievements} hypeVersion={installReport?.version || '0.26.0'} />}
          {page === 'bibliotheque' && <LibraryPage setPage={setPage} userId={user.id} hypeAchievements={hypeAchievements} installState={installState} installReport={installReport} hypePath={hypePath} progress={progress} hypeRunning={hypeRunning} installHype={openInstaller} launchHype={launchHype} stopHype={stopHype} />}
          {page === 'telechargements' && <DownloadsPage installState={installState} installReport={installReport} progress={progress} downloadInfo={downloadInfo} hypeRunning={hypeRunning} installHype={openInstaller} launchHype={launchHype} stopHype={stopHype} cancelDownload={cancelDownload} />}
          {page === 'reglages' && <SettingsPage settings={settings} updateSettings={updateSettings} effectiveScale={effectiveScale} onChooseInstall={chooseDefaultInstallDirectory} onVerifyLauncher={verifyLauncher} onReset={() => setSettings(defaultLauncherSettings)} />}
          {page === 'laliferp' && <LifeRpPage userId={user.id} onGameLaunch={publishCurrentGame} onOpenProfile={openProfile} readNewsKeys={readNewsKeys} onMarkNewsRead={markNewsRead} />}
          {page === 'hype' && <HypePage userId={user.id} installState={installState} installReport={installReport} installationResolved={installationResolved} progress={progress} hypeRunning={hypeRunning} installHype={openInstaller} launchHype={launchHype} stopHype={stopHype} onVerify={verifyHype} onUpdate={updateHype} onRepair={repairHype} onReveal={revealHype} onMove={moveHype} onForget={forgetHype} onUninstall={uninstallHype} onOpenProfile={openProfile} readNewsKeys={readNewsKeys} onMarkNewsRead={markNewsRead} achievements={hypeAchievements} achievementLoading={achievementLoading} achievementError={achievementError} onRefreshAchievements={refreshHypeAchievements} />}
          {page === 'profil' && <PublicProfilePage userId={selectedProfileId} viewerId={user.id} onBack={() => setPage(profileReturnPage === 'profil' ? 'accueil' : profileReturnPage)} onOpenProfile={openProfile} onThemeChange={updateProfileShellTheme} />}
        </div>
        {installState === 'downloading' && page !== 'telechargements' && <button className="download-capsule" onClick={() => setPage('telechargements')}><span className="capsule-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><Download size={14} /></span><span><b>Hype · {progress} %</b><small>Installation depuis GitHub · Voir le transfert</small></span><ChevronRight size={16} /></button>}
        {achievementToast && <button className="achievement-toast" onClick={() => { setAchievementToast(null); setPage('hype'); }}><span><Trophy size={18} /></span><div><small>SUCCÈS HYPE DÉVERROUILLÉ</small><b>{achievementToast.title}</b><em>{achievementToast.points} points</em></div><X size={14} onClick={(event) => { event.stopPropagation(); setAchievementToast(null); }} /></button>}
      </section>
      {installerOpen && <HypeInstallModal report={installReport} busy={installerBusy} error={installerError} onChoose={(version) => void chooseInstallation(version)} onClose={() => setInstallerOpen(false)} />}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>();
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let disposed = false;
    let stopDeepLinkListener: (() => void) | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!disposed) {
        setSession(nextSession);
        setAuthBusy(false);
      }
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (disposed) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
    });

    void listenForAuthCallbacks(setAuthError).then((unlisten) => {
      if (disposed) unlisten();
      else stopDeepLinkListener = unlisten;
    }).catch((error: unknown) => {
      if (!disposed) setAuthError(error instanceof Error ? error.message : 'Le retour OAuth n’a pas pu être initialisé.');
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
      stopDeepLinkListener?.();
    };
  }, []);

  const login = async () => {
    setAuthBusy(true);
    setAuthError('');
    try {
      await signInWithDiscord();
      setAuthBusy(false);
    } catch (error) {
      setAuthBusy(false);
      setAuthError(error instanceof Error ? error.message : 'Discord n’a pas pu être ouvert.');
    }
  };

  const logout = async () => {
    setAuthError('');
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
  };

  return session
    ? <SocialProvider user={session.user}><Launcher user={session.user} onSignOut={() => void logout()} /></SocialProvider>
    : <Login onLogin={() => void login()} busy={authBusy} initializing={session === undefined} error={authError} />;
}
