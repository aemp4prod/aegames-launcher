import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Session, User } from '@supabase/supabase-js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { launcherAdapter, type HypeInstallReport } from './launcher/adapter';
import { GamePageHero } from './components/GamePage';
import { isUsernameAvailable, listenForAuthCallbacks, loadProfile, normalizeUsername, profileFromUser, saveProfile as saveProfileRecord, signInWithDiscord, validateUsername, type PresenceStatus, type ProfileData } from './lib/auth';
import { loadRelationships, removeFriend, respondToFriendRequest, searchProfiles, sendFriendRequest, type FriendProfile } from './lib/friends';
import { supabase } from './lib/supabase';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  Edit3,
  FolderOpen,
  Gamepad2,
  Gauge,
  Globe2,
  GripVertical,
  HardDrive,
  Heart,
  Home,
  Library,
  LayoutGrid,
  Lock,
  Maximize2,
  MessageCircle,
  Minus,
  Monitor,
  MoreHorizontal,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  Wifi,
  Wrench,
  Zap,
  X,
} from 'lucide-react';

type Page = 'accueil' | 'bibliotheque' | 'telechargements' | 'reglages' | 'laliferp' | 'hype';
type InstallState = 'available' | 'downloading' | 'installed';

const friends = [
  { name: 'Milo', game: 'Sur L.A LifeRP', initials: 'MI', color: '#8956ff', avatar: '/assets/avatar-milo.svg' },
  { name: 'Nox', game: 'Joue à Hype', initials: 'NX', color: '#ef5da8', avatar: '/assets/avatar-nox.svg' },
  { name: 'Luna', game: 'En ligne', initials: 'LU', color: '#4eaac8', avatar: '/assets/avatar-luna.svg' },
];

const hypeLogoWhite = new URL('../hype-branding/logo/hype-logo-blanc.svg', import.meta.url).href;
const hypeIcon = new URL('../hype-branding/icone/hype-icone.svg', import.meta.url).href;
const hypeAvatar = new URL('../hype-branding/icone/hype-avatar.svg', import.meta.url).href;

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

function loadLauncherSettings(): LauncherSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('ae-launcher-settings') || '{}') as Partial<LauncherSettings>;
    const legacyScale = Number(localStorage.getItem('ae-ui-scale'));
    return { ...defaultLauncherSettings, ...saved, ...(legacyScale >= .8 && legacyScale <= 1.5 ? { scaleMode: 'custom' as const, uiScale: Math.round(legacyScale * 100) } : {}) };
  } catch { return defaultLauncherSettings; }
}

function optimizeImage(file: File, maxWidth: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture impossible'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Image invalide'));
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return reject(new Error('Conversion impossible'));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', quality));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <img src="/assets/ae-mark.png" alt="" />
      {!compact && (
        <div>
          <strong>Æ GAMES</strong>
          <span>LAUNCHER</span>
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

function Sidebar({ page, setPage, installState, progress, hypeRunning, user, onSignOut }: { page: Page; setPage: (page: Page) => void; installState: InstallState; progress: number; hypeRunning: boolean; user: User; onSignOut: () => void }) {
  const profileAreaRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<ProfileData>(() => profileFromUser(user));
  const [draft, setDraft] = useState(profile);
  const [status, setStatus] = useState<PresenceStatus>(profile.status);
  const [mediaError, setMediaError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error'>('idle');
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
      const dataUrl = await optimizeImage(file, kind === 'avatarDataUrl' ? 320 : 1400, kind === 'avatarDataUrl' ? .84 : .78);
      setDraft((current) => ({ ...current, [kind]: dataUrl }));
    } catch { setMediaError('Cette image n’a pas pu être préparée.'); }
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
      await saveProfileRecord(user, nextProfile);
    } catch {
      setStatus(previousStatus);
      setProfile({ ...profile, status: previousStatus });
      setMediaError('Le statut n’a pas pu être mis à jour.');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><BrandMark /><span className="signal-status"><i /> LIVE</span></div>
      <nav className="main-nav" aria-label="Navigation principale">
        <button className={page === 'accueil' ? 'active' : ''} onClick={() => setPage('accueil')}><Home size={18} /> Accueil</button>
        <button className={page === 'bibliotheque' ? 'active' : ''} onClick={() => setPage('bibliotheque')}><Library size={18} /> Bibliothèque <span className="count">2</span></button>
      </nav>
      <div className="game-groups game-rail">
        <p className="rail-label">VOS MONDES</p>
        <div className="group-title"><span>FIVEM</span><ChevronDown size={14} /></div>
        <button className={`game-link ${page === 'laliferp' ? 'active' : ''}`} onClick={() => setPage('laliferp')}>
          <img src="/assets/laliferp-cover.png" alt="" /><span><b>L.A LifeRP</b><small><i className="online-dot" /> 312 en ligne</small></span><i className="rail-signal" />
        </button>
        <div className="group-title"><span>Æ ORIGINALS</span><ChevronDown size={14} /></div>
        <button className={`game-link ${page === 'hype' ? 'active' : ''}`} onClick={() => setPage('hype')}>
          <img src={hypeIcon} alt="" /><span><b>Hype</b><small className={hypeRunning ? 'game-running-label' : ''}>{hypeRunning && <i className="online-dot" />}{hypeRunning ? 'En jeu' : installState === 'downloading' ? `${progress} %` : installState === 'installed' ? 'Prêt à jouer' : 'Non installé'}</small></span><i className="rail-signal" />
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
            <div className={`profile-banner ${editing ? 'editable-media' : ''}`} style={(editing ? draft.bannerDataUrl : profile.bannerDataUrl) ? { backgroundImage: `linear-gradient(90deg, rgba(11,12,15,.2), rgba(78,170,200,.12)), url('${editing ? draft.bannerDataUrl : profile.bannerDataUrl}')` } : undefined}>
              {editing && <label className="profile-media-trigger banner-trigger"><Edit3 size={13} /><span>Modifier la bannière</span><input type="file" accept="image/*" aria-label="Modifier la bannière" onChange={(event) => updateProfileMedia(event.target.files?.[0], 'bannerDataUrl')} /></label>}
            </div>
            <div className="profile-summary">
              <span className={`profile-avatar ${(editing ? draft.avatarDataUrl : profile.avatarDataUrl) ? 'has-image' : ''} ${editing ? 'editable-media' : ''}`} style={(editing ? draft.avatarDataUrl : profile.avatarDataUrl) ? { backgroundImage: `url('${editing ? draft.avatarDataUrl : profile.avatarDataUrl}')` } : undefined}>
                {!(editing ? draft.avatarDataUrl : profile.avatarDataUrl) && profileInitials}<i className={`status-${status}`} />
                {editing && <label className="profile-media-trigger avatar-trigger" aria-label="Modifier la photo de profil"><Edit3 size={14} /><input type="file" accept="image/*" aria-label="Modifier la photo de profil" onChange={(event) => updateProfileMedia(event.target.files?.[0], 'avatarDataUrl')} /></label>}
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
                <><div className="profile-identity"><h3>{profile.name}</h3><span>@{profile.username}</span><p>{profile.bio || 'Aucune bio pour le moment.'}</p></div><button className="edit-profile" onClick={() => { setDraft(profile); setEditing(true); }}><Edit3 size={14} /> Modifier le profil</button></>
              )}
            </div>
            {!editing && <><div className="status-picker"><span>Statut</span><div><button className={status === 'online' ? 'active' : ''} onClick={() => void changeStatus('online')}><i className="status-online" />En ligne</button><button className={status === 'busy' ? 'active' : ''} onClick={() => void changeStatus('busy')}><i className="status-busy" />Occupé</button><button className={status === 'invisible' ? 'active' : ''} onClick={() => void changeStatus('invisible')}><i className="status-invisible" />Invisible</button></div></div><button className="profile-signout" onClick={onSignOut}>Se déconnecter</button></>}
          </section>
        )}
        <button className={`profile-mini ${profileOpen ? 'active' : ''}`} aria-expanded={profileOpen} onClick={() => { if (!profileOpen) window.dispatchEvent(new Event('close-topbar-menus')); setProfileOpen((open) => !open); setEditing(false); }}>
          <span className={`avatar ${profile.avatarDataUrl ? 'has-image' : ''}`} style={profile.avatarDataUrl ? { backgroundImage: `url('${profile.avatarDataUrl}')` } : undefined}>{!profile.avatarDataUrl && profileInitials}</span>
          <span><b>{profile.name}</b><small><i className={`status-${status}`} /> {statusLabel}</small></span>
          <MoreHorizontal size={18} />
        </button>
      </div>
    </aside>
  );
}

function Topbar({ title, setPage }: { title: string; setPage: (page: Page) => void }) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openPanel, setOpenPanel] = useState<'friends' | 'notifications' | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const [friendDialog, setFriendDialog] = useState<'search' | 'list' | null>(null);
  const [relationships, setRelationships] = useState<FriendProfile[]>([]);
  const [friendQuery, setFriendQuery] = useState('');
  const [friendResults, setFriendResults] = useState<FriendProfile[]>([]);
  const [friendLoading, setFriendLoading] = useState(false);
  const [friendBusyId, setFriendBusyId] = useState<string | null>(null);
  const [friendError, setFriendError] = useState('');
  const [friendMenuId, setFriendMenuId] = useState<string | null>(null);
  const acceptedFriends = relationships.filter((friend) => friend.relationshipStatus === 'accepted');
  const incomingRequests = relationships.filter((friend) => friend.relationshipStatus === 'pending' && friend.direction === 'incoming');
  const onlineFriends = acceptedFriends.filter((friend) => friend.presenceStatus !== 'invisible');
  const searchItems: Array<{ label: string; detail: string; page?: Page; type: string; art?: string }> = [
    { label: 'L.A LifeRP', detail: 'Jeu FiveM', page: 'laliferp', type: 'Jeu', art: '/assets/laliferp-cover.png' },
    { label: 'Hype', detail: 'Æ Originals', page: 'hype', type: 'Jeu', art: hypeIcon },
    { label: 'Bibliothèque', detail: 'Vos jeux', page: 'bibliotheque', type: 'Page' },
    { label: 'Téléchargements', detail: 'Installations et mises à jour', page: 'telechargements', type: 'Page' },
    ...acceptedFriends.map((friend) => ({ label: friend.displayName, detail: `@${friend.username}`, type: 'Ami', art: friend.avatarUrl })),
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
      if (!topbarRef.current?.contains(event.target as Node)) closeMenus();
    };
    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('close-topbar-menus', closeMenus);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => { window.removeEventListener('keydown', handleShortcut); window.removeEventListener('close-topbar-menus', closeMenus); document.removeEventListener('pointerdown', closeOnOutsideClick); };
  }, []);

  const refreshRelationships = async () => {
    try {
      setFriendError('');
      setRelationships(await loadRelationships());
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Les amis n’ont pas pu être chargés.');
    }
  };

  useEffect(() => { void refreshRelationships(); }, []);

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
        if (active) setFriendResults(profiles);
      }).catch((error: unknown) => {
        if (active) setFriendError(error instanceof Error ? error.message : 'La recherche est indisponible.');
      }).finally(() => {
        if (active) setFriendLoading(false);
      });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [friendDialog, friendQuery]);

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

  const selectResult = (item: (typeof searchItems)[number]) => {
    if (item.page) setPage(item.page);
    else setOpenPanel('friends');
    setQuery('');
    setSearchOpen(false);
  };

  return (
    <>
    <header className="topbar" ref={topbarRef}>
      <div className="topbar-context"><span className="topbar-title">{title}</span></div>
      <div className="search-shell">
        <label className={`search ${searchOpen ? 'active' : ''}`}><Search size={17} /><input aria-label="Rechercher" placeholder="Rechercher un jeu, un ami…" value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => { window.dispatchEvent(new Event('close-profile-menu')); setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) selectResult(results[0]); if (event.key === 'Escape') setSearchOpen(false); }} /><kbd>⌘ K</kbd></label>
        {searchOpen && query && <div className="search-results">{results.length ? results.map((item) => <button key={`${item.type}-${item.label}`} onClick={() => selectResult(item)}><span className={`search-result-icon ${item.art ? 'has-art' : ''}`}>{item.art ? <img src={item.art} alt="" /> : <Library size={16} />}</span><span><b>{item.label}</b><small>{item.detail}</small></span><em>{item.type}</em></button>) : <p>Aucun résultat pour « {query} »</p>}</div>}
      </div>
      <div className="topbar-menu-wrap">
        <button className={`party-peek ${openPanel === 'friends' ? 'active' : ''}`} aria-label="Voir les amis en ligne" aria-expanded={openPanel === 'friends'} onClick={() => { window.dispatchEvent(new Event('close-profile-menu')); setOpenPanel(openPanel === 'friends' ? null : 'friends'); setSearchOpen(false); if (openPanel !== 'friends') void refreshRelationships(); }}>
          <span className="party-avatars">{onlineFriends.slice(0, 3).map((friend) => <i key={friend.userId} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 1).toUpperCase()}</i>)}</span>
          <span><b>{onlineFriends.length} ami{onlineFriends.length === 1 ? '' : 's'}</b><small>en ligne</small></span>
        </button>
        {openPanel === 'friends' && <div className="topbar-drawer friends-drawer"><div className="drawer-heading"><div><h3>Amis en ligne</h3><span>{onlineFriends.length} sur {acceptedFriends.length}</span></div><button aria-label="Ajouter un ami" onClick={() => openFriendDialog('search')}>+</button></div>{onlineFriends.length ? onlineFriends.slice(0, 5).map((friend) => <div className="drawer-friend" key={friend.userId}><span className={`friend-avatar ${friend.avatarUrl ? 'has-photo' : ''}`} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 2).toUpperCase()}<i /></span><span><b>{friend.displayName}</b><small>@{friend.username}</small></span></div>) : <p className="drawer-empty">Aucun ami en ligne pour le moment.</p>}{incomingRequests.length > 0 && <button className="drawer-requests" onClick={() => openFriendDialog('list')}>{incomingRequests.length} demande{incomingRequests.length > 1 ? 's' : ''} en attente</button>}{friendError && <p className="drawer-feedback">{friendError}</p>}<button className="drawer-footer" onClick={() => openFriendDialog('list')}>Voir mes amis <ChevronRight size={14} /></button></div>}
      </div>
      <div className="topbar-menu-wrap">
        <button className={`icon-button ${openPanel === 'notifications' ? 'active' : ''}`} aria-label="Notifications" aria-expanded={openPanel === 'notifications'} onClick={() => { window.dispatchEvent(new Event('close-profile-menu')); setOpenPanel(openPanel === 'notifications' ? null : 'notifications'); setSearchOpen(false); }}><Bell size={18} />{hasUnread && <i />}</button>
        {openPanel === 'notifications' && <div className="topbar-drawer notifications-drawer"><div className="drawer-heading"><div><h3>Notifications</h3><span>{hasUnread ? '3 nouvelles' : 'À jour'}</span></div>{hasUnread && <button onClick={() => setHasUnread(false)}>Tout lire</button>}</div><button className="notification-item"><span className="notification-symbol achievement"><Trophy size={16} /></span><span><b>Succès déverrouillé</b><small>« Première nuit » · L.A LifeRP</small></span><em>2 h</em></button><button className="notification-item"><span className="notification-symbol update"><Download size={16} /></span><span><b>Hype est disponible</b><small>Version 1.0.0 · 8,4 Go</small></span><em>4 h</em></button><button className="notification-item"><span className="notification-symbol social"><Users size={16} /></span><span><b>Nox vous invite</b><small>Rejoindre sa partie de Hype</small></span><em>5 h</em></button></div>}
      </div>
      <div className="window-buttons" aria-hidden="true"><button><Minus size={15} /></button><button><Maximize2 size={13} /></button><button><X size={15} /></button></div>
    </header>
    {friendDialog && createPortal(<div className="friend-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFriendDialog(null); }}><section className={`friend-dialog ${friendDialog === 'list' ? 'friend-dialog-large' : ''}`} role="dialog" aria-modal="true" aria-label={friendDialog === 'search' ? 'Ajouter un ami' : 'Mes amis'} onClick={() => setFriendMenuId(null)}><header><div><span>RÉSEAU Æ GAMES</span><h2>{friendDialog === 'search' ? 'Ajouter un ami' : 'Mes amis'}</h2></div><button aria-label="Fermer" onClick={() => setFriendDialog(null)}><X size={18} /></button></header>{friendDialog === 'search' ? <div className="friend-search-content"><label><Search size={17} /><input autoFocus value={friendQuery} onChange={(event) => setFriendQuery(event.target.value)} placeholder="Nom d’affichage ou @pseudo" /></label><p className="friend-search-hint">Saisissez au moins deux caractères.</p><div className="friend-search-results">{friendLoading && <p className="friend-dialog-empty">Recherche en cours…</p>}{!friendLoading && friendQuery.trim().length >= 2 && !friendResults.length && !friendError && <p className="friend-dialog-empty">Aucun joueur trouvé.</p>}{friendResults.map((friend) => <article key={friend.userId}><span className={`friend-list-avatar ${friend.avatarUrl ? 'has-photo' : ''}`} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 2).toUpperCase()}</span><div><b>{friend.displayName}</b><small>@{friend.username}</small></div>{friend.relationshipStatus === 'accepted' ? <button disabled><Check size={14} /> Ami</button> : friend.direction === 'outgoing' ? <button disabled>Demande envoyée</button> : <button disabled={friendBusyId === friend.userId} onClick={() => void requestFriend(friend)}><UserPlus size={14} />{friend.direction === 'incoming' ? 'Accepter' : 'Ajouter'}</button>}</article>)}</div>{friendError && <p className="friend-dialog-error">{friendError}</p>}</div> : <div className="friend-list-content">{incomingRequests.length > 0 && <section className="friend-request-section"><div className="friend-section-title"><h3>Demandes reçues</h3><span>{incomingRequests.length}</span></div>{incomingRequests.map((friend) => <article key={friend.userId}><span className={`friend-list-avatar ${friend.avatarUrl ? 'has-photo' : ''}`} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 2).toUpperCase()}</span><div><b>{friend.displayName}</b><small>@{friend.username}</small></div><div className="friend-request-actions"><button disabled={friendBusyId === friend.userId} onClick={() => void respondToRequest(friend, false)}>Refuser</button><button className="accept" disabled={friendBusyId === friend.userId} onClick={() => void respondToRequest(friend, true)}>Accepter</button></div></article>)}</section>}<section><div className="friend-section-title"><h3>Liste d’amis</h3><span>{acceptedFriends.length}</span></div>{acceptedFriends.length ? acceptedFriends.map((friend) => <article key={friend.userId}><span className={`friend-list-avatar ${friend.avatarUrl ? 'has-photo' : ''}`} style={friend.avatarUrl ? { backgroundImage: `url('${friend.avatarUrl}')` } : undefined}>{!friend.avatarUrl && friend.displayName.slice(0, 2).toUpperCase()}<i className={`status-${friend.presenceStatus}`} /></span><div><b>{friend.displayName}</b><small>@{friend.username} · {friend.presenceStatus === 'online' ? 'En ligne' : friend.presenceStatus === 'busy' ? 'Occupé' : 'Hors ligne'}</small></div><div className="friend-row-menu"><button aria-label={`Actions pour ${friend.displayName}`} onClick={(event) => { event.stopPropagation(); setFriendMenuId(friendMenuId === friend.userId ? null : friend.userId); }}><MoreHorizontal size={18} /></button>{friendMenuId === friend.userId && <div onClick={(event) => event.stopPropagation()}><button disabled={friendBusyId === friend.userId} onClick={() => void deleteFriend(friend)}><Trash2 size={14} /> Supprimer des amis</button></div>}</div></article>) : <p className="friend-dialog-empty">Votre liste d’amis est encore vide.</p>}</section>{friendError && <p className="friend-dialog-error">{friendError}</p>}</div>}</section></div>, document.body)}
    </>
  );
}

function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="stat-card"><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></div>;
}

function HomePage({ setPage }: { setPage: (page: Page) => void }) {
  return (
    <div className="page-with-friends">
      <main className="page-content home-page">
        <section className="welcome-row"><div><h1>Bonsoir, Alex.</h1><p>On reprend là où vous vous êtes arrêté ?</p></div><div className="level-card"><span>NIV. 18</span><div><b>Explorateur</b><small>2 840 / 3 200 XP</small><i><em /></i></div><Trophy size={21} /></div></section>
        <section className="continue-card" onClick={() => setPage('laliferp')}>
          <img src="/assets/laliferp-hero.jpg" alt="Univers synthwave de L.A LifeRP" />
          <div className="continue-shade" />
          <div className="continue-copy"><span className="resume-label"><Play size={12} fill="currentColor" /> REPRENDRE</span><h2>L.A LifeRP</h2><p>Votre personnage vous attend à Los Angeles.</p><div className="server-summary"><span><i className="online-dot" /> Serveur en ligne</span><span><Users size={14} /> 312 / 512</span><span><Clock3 size={14} /> 18 h 42 cette semaine</span></div></div>
          <button className="primary-play"><Play size={19} fill="currentColor" /> Jouer</button>
        </section>
        <section className="stats-grid">
          <Stat icon={<Clock3 />} label="TEMPS DE JEU" value="127 h" detail="Tous les jeux" />
          <Stat icon={<Trophy />} label="SUCCÈS" value="24 / 58" detail="41 % terminés" />
          <Stat icon={<Users />} label="AMIS EN LIGNE" value="3" detail="sur 18 amis" />
          <Stat icon={<Gauge />} label="LATENCE" value="18 ms" detail="Excellente" />
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
  return <div className={`hype-key-art ${compact ? 'compact' : ''}`}><div className="hype-key-orbit" /><img src={hypeLogoWhite} alt="Hype" /><div className="hype-key-post post-one"><span className="generated-avatar avatar-pink">M</span><i><b>Maya</b><small>ta photo est incroyable ✨</small></i></div><div className="hype-key-post post-two"><Heart size={13} fill="currentColor" /><i><b>+248</b><small>réactions</small></i></div><span className="hype-key-dot" /></div>;
}

type GamePanel = 'achievements' | 'friends' | 'options' | 'news';

function GameDock({ label, icon, onPrimary, onPanel, showNews = false, friendCount = 3, primaryDanger = false }: { label: string; icon: React.ReactNode; onPrimary: () => void; onPanel?: (panel: GamePanel) => void; showNews?: boolean; friendCount?: number; primaryDanger?: boolean }) {
  return (
    <nav className="game-dock" aria-label="Actions du jeu">
      <button className={`dock-primary ${primaryDanger ? 'stop-game' : ''}`} onClick={onPrimary}>{icon}<span>{label}</span></button>
      <span className="dock-divider" />
      <button onClick={() => onPanel?.('achievements')}><Trophy size={18} /><small>Succès</small></button>
      <button onClick={() => onPanel?.('friends')}><Users size={18} /><small>Amis</small><i className="dock-notice">{friendCount}</i></button>
      {showNews && <button onClick={() => onPanel?.('news')}><Newspaper size={18} /><small>Actualités</small><i className="dock-notice news-notice">2</i></button>}
      <button onClick={() => onPanel?.('options')}><Settings size={18} /><small>Options</small></button>
    </nav>
  );
}

type AchievementFilter = 'all' | 'unlocked' | 'progress' | 'locked';
type NewsItem = { id: number; date: string; category: string; title: string; excerpt: string; body: string[]; featured?: boolean };

const lifeAchievements = [
  { title: 'Première nuit', description: 'Passer une nuit complète en ville', state: 'unlocked', rarity: '12,4 %', progress: 100, icon: <Sparkles size={18} /> },
  { title: 'Citoyen modèle', description: 'Atteindre le niveau 20 sans condamnation', state: 'unlocked', rarity: '8,1 %', progress: 100, icon: <ShieldCheck size={18} /> },
  { title: 'Premier salaire', description: 'Gagner vos premiers 10 000 $', state: 'progress', rarity: '44,8 %', progress: 74.5, progressLabel: '7 450 / 10 000 $', icon: <Activity size={18} /> },
  { title: 'As du volant', description: 'Remporter 50 courses urbaines', state: 'progress', rarity: '5,6 %', progress: 64, progressLabel: '32 / 50 courses', icon: <Gauge size={18} /> },
  { title: 'Pilier de la ville', description: 'Cumuler 100 heures sur le serveur', state: 'progress', rarity: '18,2 %', progress: 86.4, progressLabel: '86,4 / 100 h', icon: <Clock3 size={18} /> },
  { title: 'Le rêve américain', description: 'Posséder trois entreprises', state: 'locked', rarity: '2,9 %', progress: 0, icon: <Trophy size={18} /> },
];

const lifeNews: NewsItem[] = [
  { id: 1, date: '15 OCTOBRE', category: 'MISE À JOUR 2.8.4', title: 'La ville ne dort jamais', excerpt: 'Nouvelles activités nocturnes, économie rééquilibrée et amélioration de la circulation en centre-ville.', body: ['Cette mise à jour ouvre un nouveau chapitre nocturne pour Los Angeles. Plusieurs lieux prennent désormais vie après le coucher du soleil, avec de nouvelles activités et opportunités pour les citoyens.', 'L’économie des entreprises a été rééquilibrée, tandis que la circulation et les temps de chargement en centre-ville ont reçu une série d’améliorations.'], featured: true },
  { id: 2, date: '14 OCTOBRE', category: 'VILLE', title: 'Un nouvel horizon pour Vespucci', excerpt: 'Découvrez les nouveaux commerces disponibles sur la côte.', body: ['Vespucci accueille trois nouvelles enseignes et une promenade entièrement revisitée.', 'Les propriétaires peuvent dès maintenant déposer leur dossier auprès de la mairie.'] },
  { id: 3, date: '12 OCTOBRE', category: 'COMMUNAUTÉ', title: 'Notes de communauté', excerpt: 'Les événements et créations qui ont marqué la semaine.', body: ['Courses improvisées, rencontres citoyennes et créations originales : retrouvez notre sélection de la semaine.', 'Merci à tous les joueurs qui font vivre la ville chaque jour.'] },
  { id: 4, date: '09 OCTOBRE', category: 'ÉVÉNEMENT', title: 'Rendez-vous au Vinewood Bowl', excerpt: 'Une soirée en plein air organisée par la ville.', body: ['La ville vous donne rendez-vous vendredi soir au Vinewood Bowl pour un concert et plusieurs animations.', 'Les portes ouvriront à 20 h et un service de navettes sera disponible.'] },
  { id: 5, date: '05 OCTOBRE', category: 'PATCH', title: 'Correctifs de stabilité', excerpt: 'Améliorations réseau et correctifs de véhicules.', body: ['Ce correctif améliore la stabilité des longues sessions et réduit les désynchronisations de véhicules.', 'Plusieurs anomalies signalées par la communauté ont également été corrigées.'] },
];

function LifeRpModal({ panel, onClose }: { panel: GamePanel; onClose: () => void }) {
  const [achievementFilter, setAchievementFilter] = useState<AchievementFilter>('all');
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [fiveMPath, setFiveMPath] = useState('');
  const [cacheOpen, setCacheOpen] = useState(false);
  const [cacheSelection, setCacheSelection] = useState<string[]>(['cache', 'server-cache']);
  const [cacheFeedback, setCacheFeedback] = useState('');
  const [installedPacks, setInstalledPacks] = useState<string[]>([]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const title = panel === 'achievements' ? 'Succès' : panel === 'friends' ? 'Amis en jeu' : panel === 'news' ? 'Actualités' : 'Options du jeu';
  const visibleAchievements = lifeAchievements.filter((achievement) => achievementFilter === 'all' || achievement.state === achievementFilter);
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
        {panel === 'achievements' && <div className="modal-content achievements-modal"><div className="achievement-dashboard"><article><span><Trophy size={17} /></span><div><small>Tous les succès</small><strong>32</strong></div></article><article><span><Check size={17} /></span><div><small>Débloqués</small><strong>16</strong></div></article><article><span><Activity size={17} /></span><div><small>En cours</small><strong>5</strong></div></article><article><span><Gauge size={17} /></span><div><small>Progression</small><strong>50 %</strong></div></article></div><div className="achievement-filter">{([['all', 'Tous'], ['unlocked', 'Débloqués'], ['progress', 'En cours'], ['locked', 'Verrouillés']] as [AchievementFilter, string][]).map(([filter, label]) => <button key={filter} className={achievementFilter === filter ? 'active' : ''} onClick={() => setAchievementFilter(filter)}>{label}</button>)}</div><div className="achievement-catalog">{visibleAchievements.map((achievement) => <article className={`achievement-entry ${achievement.state}`} key={achievement.title}><span>{achievement.icon}</span><div className="achievement-copy"><b>{achievement.title}</b><small>{achievement.description}</small>{achievement.state === 'progress' && <div className="achievement-item-progress"><i><em style={{ width: `${achievement.progress}%` }} /></i><strong>{achievement.progressLabel}</strong></div>}</div><em>{achievement.rarity}</em>{achievement.state === 'unlocked' ? <Check size={17} /> : achievement.state === 'locked' ? <span className="achievement-lock">?</span> : <span className="achievement-percent">{Math.round(achievement.progress)} %</span>}</article>)}</div></div>}
        {panel === 'friends' && <div className="modal-content friends-modal"><p className="modal-intro">Seuls les amis actuellement présents sur L.A LifeRP apparaissent ici.</p>{friends.filter((friend) => friend.game === 'Sur L.A LifeRP').map((friend) => <article key={friend.name}><img src={friend.avatar} alt="" /><div><b>{friend.name}</b><small>Centre-ville · Session publique</small></div><span className="friend-playing"><i /> En jeu</span></article>)}</div>}
        {panel === 'news' && <div className="modal-content news-modal">{selectedNews ? <article className="news-reader"><button className="news-back" onClick={() => setSelectedNews(null)}><ArrowLeft size={15} /> Retour aux actualités</button><div className="news-reader-hero"><span>{selectedNews.category}</span><h3>{selectedNews.title}</h3><small>{selectedNews.date}</small></div><div className="news-reader-body"><p className="lead">{selectedNews.excerpt}</p>{selectedNews.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></article> : <div className="news-feed"><button className="featured-news" onClick={() => setSelectedNews(lifeNews[0])}><div><span>{lifeNews[0].category}</span><h3>{lifeNews[0].title}</h3><p>{lifeNews[0].excerpt}</p><em>Lire l’article <ChevronRight size={15} /></em></div></button><div className="news-grid">{lifeNews.slice(1).map((item) => <button key={item.id} onClick={() => setSelectedNews(item)}><small>{item.date} · {item.category}</small><b>{item.title}</b><p>{item.excerpt}</p><em>Ouvrir <ChevronRight size={12} /></em></button>)}</div></div>}</div>}
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

function LifeRpPage() {
  const [launched, setLaunched] = useState(false);
  const [openPanel, setOpenPanel] = useState<GamePanel | null>(null);
  const launch = () => {
    setLaunched(true);
    window.setTimeout(() => setLaunched(false), 1900);
  };
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
            <GameMetric icon={<Clock3 />} value="86,4 h" label="Temps de jeu" />
            <GameMetric icon={<Activity />} value="18 h 42" label="Cette semaine" />
            <GameMetric icon={<Trophy />} value="16 / 32" label="Succès" />
            <GameMetric icon={<Users />} value="8" label="Amis jouent" />
          </div>
          <div className="section-heading"><div><h2>Dernière session</h2></div><span className="muted">Hier · 2 h 16</span></div>
          <article className="session-card"><div className="session-map"><img src="/assets/laliferp-sun.png" alt="" /></div><div><h3>Alex Morgan</h3><p>Entrepreneur · Niveau 24</p><div className="character-stats"><span><b>$ 48 250</b><small>En banque</small></span><span><b>Vespucci</b><small>Dernière position</small></span><span><b>Citoyen</b><small>Statut</small></span></div></div></article>
        </div>
        <aside className="game-side-column">
          <div className="info-card"><h3>À propos</h3><p>Une expérience roleplay exigeante au cœur d'un Los Angeles vivant, façonné par ses citoyens.</p><div><span>Développeur</span><b>L.A LifeRP</b></div><div><span>Genre</span><b>Roleplay</b></div><div><span>Version</span><b>2.8.4</b></div></div>
        </aside>
      </section>
      <GameDock label={launched ? 'Connexion…' : 'Jouer'} icon={<Play size={19} fill="currentColor" />} onPrimary={launch} onPanel={setOpenPanel} showNews friendCount={1} />
      {launched && <LaunchSequence game="L.A LifeRP" artwork="/assets/laliferp-hero.jpg" />}
      {openPanel && <LifeRpModal panel={openPanel} onClose={() => setOpenPanel(null)} />}
    </main>
  );
}

type DownloadControls = {
  installState: InstallState;
  installReport: HypeInstallReport | null;
  progress: number;
  paused: boolean;
  hypeRunning: boolean;
  installHype: () => void;
  launchHype: () => Promise<boolean>;
  stopHype: () => Promise<boolean>;
  togglePause: () => void;
  cancelDownload: () => void;
};

function HypeInstallModal({ report, busy, error, onChoose, onClose }: {
  report: HypeInstallReport | null;
  busy: boolean;
  error: string;
  onChoose: () => void;
  onClose: () => void;
}) {
  const healthy = Boolean(report?.kind === 'existing' && report.executableFound && report.missingFiles.length === 0 && report.invalidFiles.length === 0);
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
          {!report && <div className="installer-intro"><span className="installer-icon"><FolderOpen size={28} /></span><h3>Où se trouve Hype ?</h3><p>Choisissez directement votre installation existante, ou son dossier parent. Le launcher recherchera <code>manifest.json</code> puis vérifiera les fichiers avant de l’ajouter.</p><button className="modal-save" disabled={busy} onClick={onChoose}><FolderOpen size={17} /> {busy ? 'Analyse en cours…' : 'Choisir un dossier'}</button>{launcherAdapter.environment === 'browser' && <small className="installer-note">Aperçu web : l’analyse est disponible dans les navigateurs compatibles, mais la création du dossier et le lancement de Hype.exe nécessitent l’application desktop.</small>}</div>}
          {report && <div className={`installer-result ${healthy ? 'healthy' : report.kind}`}>
            <span className="installer-icon">{healthy ? <Check size={28} /> : report.kind === 'prepared' ? <FolderOpen size={28} /> : <ShieldCheck size={28} />}</span>
            <h3>{healthy ? 'Hype est prêt à jouer' : report.kind === 'prepared' ? 'Destination préparée' : 'Installation à réparer'}</h3>
            <p>{report.message}</p>
            <div className="installer-path"><small>EMPLACEMENT</small><b>{report.path}</b></div>
            <div className="installer-summary"><span><small>VERSION</small><b>{report.version || 'À télécharger'}</b></span><span><small>FICHIERS VÉRIFIÉS</small><b>{report.verifiedFiles} / {report.totalFiles}</b></span><span><small>EXÉCUTABLE</small><b>{report.executableFound ? 'Hype.exe trouvé' : 'Hype.exe absent'}</b></span></div>
            {(report.missingFiles.length > 0 || report.invalidFiles.length > 0) && <p className="installer-warning">{report.missingFiles.length} fichier(s) manquant(s) · {report.invalidFiles.length} fichier(s) invalide(s)</p>}
            <div className="installer-actions"><button className="modal-save" onClick={healthy ? onClose : onChoose}>{healthy ? 'Terminer' : 'Choisir un autre dossier'}</button><button className="installer-secondary" onClick={onClose}>Fermer</button></div>
          </div>}
          {error && <div className="installer-error"><ShieldCheck size={16} /><span>{error}</span></div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function LibraryPage({ setPage, installState, progress, hypeRunning, installHype, launchHype, stopHype }: { setPage: (page: Page) => void; installState: InstallState; progress: number; hypeRunning: boolean; installHype: () => void; launchHype: () => Promise<boolean>; stopHype: () => Promise<boolean> }) {
  const [selected, setSelected] = useState<'laliferp' | 'hype'>('laliferp');
  const [launchingGame, setLaunchingGame] = useState<'laliferp' | 'hype' | null>(null);
  const isLife = selected === 'laliferp';
  const actionLabel = isLife ? 'Jouer maintenant' : hypeRunning ? 'Fermer' : installState === 'installed' ? 'Jouer' : installState === 'downloading' ? `${progress} % téléchargé` : 'Installer';
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
        <div className="library-summary"><span><b>2</b><small>jeux</small></span><i /><span><b>127 h</b><small>au total</small></span></div>
      </header>

      <section className="library-spotlight">
        <div className={`spotlight-scene spotlight-${selected}`} key={selected}>
          {isLife ? <img src="/assets/laliferp-hero.jpg" alt="" /> : <HypeArtwork />}
          <div className="spotlight-shade" />
          <div className="spotlight-copy">
            <img className={`spotlight-logo ${isLife ? 'life' : 'hype'}`} src={isLife ? '/assets/laliferp-wordmark.png' : hypeLogoWhite} alt={isLife ? 'L.A LifeRP' : 'Hype'} />
            <p>{isLife ? 'Reprenez votre histoire au cœur d’un Los Angeles façonné par ses joueurs.' : 'Créez votre personnage, publiez et laissez un monde peuplé d’IA réagir à votre histoire.'}</p>
            <div className="spotlight-meta">
              <span><Clock3 size={15} /> {isLife ? '86,4 h jouées' : installState === 'installed' ? 'Prêt à jouer' : '8,4 Go requis'}</span>
              <span><Trophy size={15} /> {isLife ? '16 / 32 succès' : '24 succès'}</span>
              <span><Users size={15} /> {isLife ? '8 amis jouent' : '1 ami joue'}</span>
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
        <div className="collection-tabs"><button className="active">Tous <span>2</span></button><button>Installés <span>{installState === 'installed' ? 2 : 1}</span></button><button>À mettre à jour</button><button>Favoris</button></div>
        <div className="view-tools"><button aria-label="Vue en grille"><LayoutGrid size={17} /></button><button>Trier : récents <ChevronDown size={14} /></button></div>
      </section>

      <section className="collection-grid">
        <button data-game="laliferp" className={`collection-game ${selected === 'laliferp' ? 'selected' : ''}`} onClick={() => setSelected('laliferp')} onDoubleClick={() => setPage('laliferp')}>
          <span className="collection-cover logo-cover life-logo-cover"><img src="/assets/laliferp-cover.png" alt="" /><i className="online-dot" /></span>
          <span className="collection-game-copy"><small>FIVEM</small><b>L.A LifeRP</b><em>Prêt à jouer</em></span>
          <Play className="collection-quick-action" size={18} fill="currentColor" />
        </button>
        <button data-game="hype" className={`collection-game ${selected === 'hype' ? 'selected' : ''}`} onClick={() => setSelected('hype')} onDoubleClick={() => setPage('hype')}>
          <span className="collection-cover logo-cover hype-logo-cover"><img src={hypeIcon} alt="" />{installState === 'downloading' && <i className="cover-progress" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties} />}</span>
          <span className="collection-game-copy"><small>Æ ORIGINALS</small><b>Hype</b><em>{hypeRunning ? 'En jeu' : installState === 'installed' ? 'Prêt à jouer' : installState === 'downloading' ? `${progress} % · 42 Mo/s` : 'Disponible'}</em></span>
          {hypeRunning ? <X className="collection-quick-action" size={18} /> : installState === 'installed' ? <Play className="collection-quick-action" size={18} fill="currentColor" /> : <Download className="collection-quick-action" size={18} />}
        </button>
      </section>
      {launchingGame && <LaunchSequence game={launchingGame === 'laliferp' ? 'L.A LifeRP' : 'Hype'} artwork={launchingGame === 'laliferp' ? '/assets/laliferp-hero.jpg' : hypeAvatar} />}
    </main>
  );
}

function DownloadsPage({ installState, installReport, progress, paused, hypeRunning, installHype, launchHype, stopHype, togglePause, cancelDownload }: DownloadControls) {
  const [queue, setQueue] = useState<{ id: string; name: string; detail: string; art: string }[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const phase = progress > 88 ? 'Vérification' : progress > 72 ? 'Installation' : 'Téléchargement';
  const remaining = Math.max(1, Math.ceil((100 - progress) * 0.18));
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

      {installState === 'downloading' && <section className="active-transfer state-downloading">
        <div className="transfer-art"><img src={hypeIcon} alt="Hype" /></div>
        <div className="transfer-main">
          <div className="transfer-heading"><div><h2>Hype</h2><p>{phase} · Version {installReport?.version || '0.16'}</p></div><strong>{paused ? 'En pause' : `${remaining} min restantes`}</strong></div>
          <div className="transfer-track"><i style={{ width: `${progress}%` }} /></div>
          <div className="transfer-details"><span>{`${(8.4 * progress / 100).toFixed(1)} Go sur 8,4 Go`}</span><b>{progress} %</b></div>
          <div className="transfer-performance">
            <div><Wifi size={15} /><span><small>RÉSEAU</small><b>{!paused ? '42,0 Mo/s' : '0 Mo/s'}</b></span></div>
            <div><Gauge size={15} /><span><small>PIC</small><b>48,6 Mo/s</b></span></div>
            <div><HardDrive size={15} /><span><small>DISQUE</small><b>{!paused ? '58,4 Mo/s' : '0 Mo/s'}</b></span></div>
            <div><span><small>ESPACE DISPONIBLE</small><b>286 Go</b></span></div>
            <div className={`inline-speed-graph ${paused ? 'idle' : ''}`}>{[38,52,44,68,61,78,70,87,74,91,82,88,76,94,84,90].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
          </div>
        </div>
        <div className="transfer-controls">
          <button className="transfer-primary" onClick={togglePause}>{paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} />}{paused ? 'Reprendre' : 'Pause'}</button>
          <button className="transfer-secondary" onClick={cancelDownload}>Annuler</button>
        </div>
      </section>}

      {installState === 'available' && <section className="download-status-card available">
        <HypeArtwork compact />
        <div><span>INSTALLATION DISPONIBLE</span><h2>Hype n’est pas encore installé</h2><p>Ajoutez votre installation existante ou choisissez l’emplacement qui accueillera le jeu.</p></div>
        <button className="transfer-primary" onClick={installHype}><FolderOpen size={18} /> Installer Hype</button>
      </section>}

      {installState === 'installed' && <section className="download-status-card installed">
        <span className="download-ready-art"><img src={hypeIcon} alt="" /><Check size={18} /></span>
        <div><span>TOUT EST À JOUR</span><h2>Hype est prêt à jouer</h2><p>{installReport?.verifiedFiles ?? 0} fichier(s) vérifié(s) · Version {installReport?.version || '0.16'}</p><code title={installReport?.path}>{installReport?.path || 'Installation locale'}</code></div>
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
        {installState === 'installed' && <div className="download-history"><Check size={16} /><span><b>Installation de Hype vérifiée</b><small>{installReport?.version ? `Version ${installReport.version}` : 'Version 0.16'} · {installReport?.verifiedFiles ?? 0} fichier(s)</small></span><em>AUJOURD’HUI</em></div>}
      </section>
    </main>
  );
}

type HypeInstallationActions = {
  installState: InstallState;
  installReport: HypeInstallReport | null;
  hypeRunning: boolean;
  onInstall: () => void;
  onVerify: () => Promise<HypeInstallReport>;
  onReveal: () => Promise<void>;
  onForget: () => Promise<void>;
  onUninstall: () => Promise<void>;
};

function formatInstallSize(bytes: number) {
  if (!bytes) return 'Taille inconnue';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1).replace('.', ',')} Go`;
  return `${Math.max(1, Math.round(bytes / 1_048_576))} Mo`;
}

function HypeInstallationPanel({ installState, installReport, hypeRunning, onInstall, onVerify, onReveal, onForget, onUninstall }: HypeInstallationActions) {
  const [busy, setBusy] = useState<'verify' | 'update' | 'uninstall' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'forget' | 'uninstall' | null>(null);
  const installed = installState === 'installed' && Boolean(installReport);
  const healthy = Boolean(installReport?.executableFound && installReport.missingFiles.length === 0 && installReport.invalidFiles.length === 0);

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
    window.setTimeout(() => {
      setFeedback('Le service GitHub n’est pas encore connecté. Votre version locale reste inchangée.');
      setBusy(null);
    }, 650);
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
          <button disabled={busy !== null} onClick={() => void checkUpdate()}><RefreshCw className={busy === 'update' ? 'spinning' : ''} size={19} /><span><b>{busy === 'update' ? 'Recherche…' : 'Rechercher une mise à jour'}</b><small>Compare la version installée au manifeste GitHub.</small></span></button>
          <button disabled={healthy || busy !== null || hypeRunning}><Wrench size={19} /><span><b>Réparer l’installation</b><small>{healthy ? 'Aucune réparation nécessaire.' : 'Retélécharge les fichiers invalides.'}</small></span></button>
        </div>
        {hypeRunning && <p className="installation-feedback warning"><AlertTriangle size={14} /> Fermez Hype pour vérifier, réparer ou désinstaller ses fichiers.</p>}
        {feedback && <p className="installation-feedback"><Check size={14} /> {feedback}</p>}
      </section>

      <section className="installation-management">
        <div><span>GESTION DE L’INSTALLATION</span><p>Ces actions modifient uniquement le lien avec cette installation ou ses fichiers locaux.</p></div>
        <div className="installation-manage-menu">
          <button className="manage-installation-button" aria-expanded={manageOpen} onClick={() => setManageOpen(!manageOpen)}>Gérer l’installation <ChevronDown size={15} /></button>
          {manageOpen && <div className="manage-installation-dropdown">
            <button className="danger" disabled={hypeRunning} onClick={() => { setConfirmation('uninstall'); setManageOpen(false); }}><Trash2 size={16} /><span><b>Désinstaller</b><small>Supprimera le jeu du disque.</small></span></button>
            <button onClick={() => { setConfirmation('forget'); setManageOpen(false); }}><X size={16} /><span><b>Oublier</b><small>Délie l’installation sans supprimer ses fichiers.</small></span></button>
          </div>}
        </div>
      </section>

      {confirmation && <div className="installation-confirmation"><div><span className={confirmation === 'uninstall' ? 'danger' : ''}>{confirmation === 'uninstall' ? <Trash2 size={22} /> : <X size={22} />}</span><h3>{confirmation === 'uninstall' ? 'Désinstaller Hype ?' : 'Oublier cette installation ?'}</h3><p>{confirmation === 'uninstall' ? `Tous les fichiers contenus dans « ${installReport?.path} » seront définitivement supprimés du disque.` : 'Le jeu restera intact sur le disque. Vous pourrez le relier à nouveau plus tard en sélectionnant son dossier.'}</p><div><button onClick={() => setConfirmation(null)}>Annuler</button><button className={confirmation === 'uninstall' ? 'danger' : 'confirm'} disabled={busy === 'uninstall'} onClick={() => void confirmManagement()}>{busy === 'uninstall' ? 'Désinstallation…' : confirmation === 'uninstall' ? 'Désinstaller' : 'Oublier'}</button></div></div></div>}
    </div>
  );
}

function HypeModal({ panel, onClose, ...installationActions }: { panel: GamePanel; onClose: () => void } & HypeInstallationActions) {
  const [settings, setSettings] = useState({ notifications: true, animations: true, matureTopics: false });
  const [optionsSection, setOptionsSection] = useState<'general' | 'installation'>('installation');
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const title = panel === 'achievements' ? 'Succès' : panel === 'friends' ? 'Amis sur Hype' : panel === 'news' ? 'Actualités' : 'Options du jeu';
  return createPortal(
    <div className="game-modal-backdrop hype-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`game-modal hype-game-modal game-modal-${panel}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><img src={hypeLogoWhite} alt="Hype" /><h2>{title}</h2></div><button aria-label="Fermer" onClick={onClose}><X size={18} /></button></header>
        {panel === 'achievements' && <div className="modal-content achievements-modal"><div className="achievement-dashboard"><article><span><Trophy size={17} /></span><div><small>Tous</small><strong>18</strong></div></article><article><span><Check size={17} /></span><div><small>Débloqués</small><strong>6</strong></div></article><article><span><Activity size={17} /></span><div><small>En cours</small><strong>4</strong></div></article><article><span><Gauge size={17} /></span><div><small>Progression</small><strong>33 %</strong></div></article></div><div className="achievement-catalog"><article className="achievement-entry unlocked"><span><Heart size={18} /></span><div className="achievement-copy"><b>Premier crush</b><small>Créer votre première vraie connexion</small></div><em>68,2 %</em><Check size={17} /></article><article className="achievement-entry progress"><span><UserPlus size={18} /></span><div className="achievement-copy"><b>Ça commence à prendre</b><small>Atteindre 1 000 abonnés</small><div className="achievement-item-progress"><i><em style={{ width: '62%' }} /></i><strong>620 / 1 000</strong></div></div><em>24,1 %</em><span className="achievement-percent">62 %</span></article><article className="achievement-entry locked"><span><Globe2 size={18} /></span><div className="achievement-copy"><b>Tout le monde en parle</b><small>Lancer une tendance mondiale</small></div><em>1,7 %</em><span className="achievement-lock">?</span></article></div></div>}
        {panel === 'friends' && <div className="modal-content friends-modal"><p className="modal-intro">Les amis qui façonnent actuellement leur histoire dans Hype.</p>{friends.filter((friend) => friend.game === 'Joue à Hype').map((friend) => <article key={friend.name}><img src={friend.avatar} alt="" /><div><b>{friend.name}</b><small>En ligne · Monde « Après minuit »</small></div><span className="friend-playing"><i /> En jeu</span></article>)}</div>}
        {panel === 'news' && <div className="modal-content hype-news-modal"><article><span>VERSION 0.16</span><h3>Une identité à nous</h3><p>Hype adopte sa nouvelle identité visuelle et affine la façon dont vos relations évoluent dans chaque monde.</p><small>15 OCTOBRE</small></article><article><span>JOURNAL DE DÉVELOPPEMENT</span><h3>Des personnages qui se souviennent</h3><p>Les conversations, les rencontres et vos publications laissent désormais une trace plus naturelle dans votre histoire.</p><small>08 OCTOBRE</small></article></div>}
        {panel === 'options' && <div className="hype-options-layout"><nav><button className={optionsSection === 'general' ? 'active' : ''} onClick={() => setOptionsSection('general')}><Settings size={16} /><span><b>Général</b><small>Expérience de jeu</small></span></button><button className={optionsSection === 'installation' ? 'active' : ''} onClick={() => setOptionsSection('installation')}><HardDrive size={16} /><span><b>Installation</b><small>Version et fichiers</small></span></button></nav><div className="hype-options-content">{optionsSection === 'general' ? <div className="modal-content options-modal"><div className="option-block"><span><b>Notifications sociales</b><small>Afficher les nouveaux messages, réactions et abonnements.</small></span><button aria-label="Notifications sociales" aria-pressed={settings.notifications} className={settings.notifications ? 'toggle active' : 'toggle'} onClick={() => setSettings({ ...settings, notifications: !settings.notifications })}><i /></button></div><div className="option-block"><span><b>Animations de l’interface</b><small>Conserver les transitions et réactions du fil.</small></span><button aria-label="Animations de l’interface" aria-pressed={settings.animations} className={settings.animations ? 'toggle active' : 'toggle'} onClick={() => setSettings({ ...settings, animations: !settings.animations })}><i /></button></div><div className="option-block"><span><b>Thèmes sensibles</b><small>Autoriser les personnages à aborder des sujets plus matures.</small></span><button aria-label="Thèmes sensibles" aria-pressed={settings.matureTopics} className={settings.matureTopics ? 'toggle active' : 'toggle'} onClick={() => setSettings({ ...settings, matureTopics: !settings.matureTopics })}><i /></button></div><button className="modal-save" onClick={onClose}>Enregistrer les options</button></div> : <HypeInstallationPanel {...installationActions} />}</div></div>}
      </section>
    </div>,
    document.body,
  );
}

function HypePage({ installState, installReport, progress, hypeRunning, installHype, launchHype, stopHype, onVerify, onReveal, onForget, onUninstall }: Pick<DownloadControls, 'installState' | 'installReport' | 'progress' | 'hypeRunning' | 'installHype' | 'launchHype' | 'stopHype'> & Pick<HypeInstallationActions, 'onVerify' | 'onReveal' | 'onForget' | 'onUninstall'>) {
  const [launching, setLaunching] = useState(false);
  const [openPanel, setOpenPanel] = useState<GamePanel | null>(null);
  const needsRepair = installState === 'installed' && Boolean(installReport && (!installReport.executableFound || installReport.missingFiles.length || installReport.invalidFiles.length));

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
            <div className="hype-version"><span>VERSION ACTUELLE</span><b>0.16</b></div>
          </div>
          {installState === 'downloading' && <div className="download-progress hype-download-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{progress} % · Téléchargement en cours</small></div>}
        </>}
        showcase={<div className="hype-feed-preview" aria-label="Aperçu du réseau social Hype">
          <div className="hype-feed-top"><img src={hypeAvatar} alt="" /><span><b>ton monde</b><small>pour toi</small></span><i>h.</i></div>
          <article className="hype-post main-post"><div><span className="generated-avatar avatar-pink">M</span><p><b>Maya</b><small>@maya · 2 min</small></p></div><strong>ok mais ta dernière photo ??? on en parle ou pas</strong><footer><span><Heart size={13} fill="currentColor" /> 248</span><span><MessageCircle size={13} /> 34</span></footer></article>
          <article className="hype-post reply-post"><div><span className="generated-avatar avatar-yellow">T</span><p><b>Théo</b><small>@theo · maintenant</small></p></div><strong>franchement, t’abuses 😭</strong></article>
          <div className="hype-feed-alert"><UserPlus size={14} /><span><b>+3 nouveaux abonnés</b><small>depuis ton dernier post</small></span></div>
        </div>}
      />
      <section className="game-body hype-game-body">
        <div className="game-main-column">
          <div className="game-metrics hype-metrics">
            <GameMetric icon={<Gamepad2 />} value="Solo" label="Ton histoire" />
            <GameMetric icon={<Sparkles />} value="100 % IA" label="Personnages" />
            <GameMetric icon={<Globe2 />} value="Multiples" label="Mondes" />
            <GameMetric icon={<ShieldCheck />} value="0.16" label="Version actuelle" />
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
          <div className="info-card"><h3>À propos</h3><p>Un petit jeu fun de simulation de réseau social, peuplé de personnages gérés par IA. Faites des rencontres, créez du contenu et voyez jusqu’où votre histoire peut aller.</p><div><span>Développeur</span><b>Æ Games</b></div><div><span>Genre</span><b>Simulation sociale</b></div><div><span>Expérience</span><b>Solo · IA générative</b></div><div><span>Version</span><b>0.16</b></div></div>
        </aside>
      </section>
      <GameDock label={installLabel} icon={hypeRunning ? <X size={19} /> : needsRepair ? <Wrench size={19} /> : installState === 'installed' ? <Play size={19} fill="currentColor" /> : <Download size={19} />} onPrimary={handlePrimaryAction} onPanel={setOpenPanel} showNews friendCount={1} primaryDanger={hypeRunning} />
      {launching && <LaunchSequence game="Hype" artwork={hypeAvatar} />}
      {openPanel && <HypeModal panel={openPanel} onClose={() => setOpenPanel(null)} installState={installState} installReport={installReport} hypeRunning={hypeRunning} onInstall={installHype} onVerify={onVerify} onReveal={onReveal} onForget={onForget} onUninstall={onUninstall} />}
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
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'current' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState('');
  const toggle = (key: keyof LauncherSettings, label: string) => <SettingsToggle label={label} checked={Boolean(settings[key])} onChange={(value) => updateSettings({ [key]: value })} />;

  useEffect(() => {
    launcherAdapter.getLauncherVersion().then(setLauncherVersion).catch(() => setLauncherVersion('Inconnue'));
  }, []);

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
      setUpdateState('available');
      setUpdateMessage(update.notes?.trim() || 'Une nouvelle version du launcher est prête à être installée.');
    } catch (error) {
      setUpdateState('error');
      setUpdateMessage(error instanceof Error ? error.message : 'La vérification de la mise à jour a échoué.');
    }
  };
  const installLauncherUpdate = async () => {
    setUpdateState('downloading');
    setUpdateMessage('Téléchargement de la mise à jour…');
    try {
      await launcherAdapter.installLauncherUpdate(setUpdateProgress);
    } catch (error) {
      setUpdateState('error');
      setUpdateMessage(error instanceof Error ? error.message : 'L’installation de la mise à jour a échoué.');
    }
  };

  return (
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
              <div><span>APERÇU EN DIRECT</span><strong>{Math.round(effectiveScale * 100)} %</strong><small>{settings.scaleMode === 'auto' ? 'Adapté automatiquement à cette fenêtre' : 'Échelle personnalisée'}</small></div>
            </div>
            <div className="settings-group"><h3>Taille de l’interface</h3><SettingsRow title="Échelle automatique" description="Ajuster la taille selon la résolution et la fenêtre."><SettingsToggle label="Échelle automatique" checked={settings.scaleMode === 'auto'} onChange={(checked) => updateSettings({ scaleMode: checked ? 'auto' : 'custom' })} /></SettingsRow><div className={`scale-control ${settings.scaleMode === 'auto' ? 'disabled' : ''}`}><div><span>Échelle personnalisée</span><b>{settings.uiScale} %</b></div><input type="range" min="80" max="150" step="5" value={settings.uiScale} disabled={settings.scaleMode === 'auto'} onChange={(event) => updateSettings({ uiScale: Number(event.target.value), scaleMode: 'custom' })} /><div className="scale-marks"><span>80 %</span><span>100 %</span><span>125 %</span><span>150 %</span></div></div></div>
            <div className="settings-group"><h3>Confort visuel</h3><SettingsRow title="Interface compacte" description="Réduire l’espacement tout en conservant la taille du texte.">{toggle('compactMode', 'Interface compacte')}</SettingsRow><SettingsRow title="Réduire les animations" description="Limiter les transitions et effets de mouvement.">{toggle('reducedMotion', 'Réduire les animations')}</SettingsRow><SettingsRow title="Contraste renforcé" description="Accentuer les textes secondaires et les séparations.">{toggle('highContrast', 'Contraste renforcé')}</SettingsRow></div>
          </>}

          {section === 'downloads' && <>
            <div className="settings-section-title"><span><Download size={19} /></span><div><h2>Téléchargements</h2><p>Contrôlez où, quand et à quelle vitesse vos jeux sont installés.</p></div></div>
            <div className="settings-group"><h3>Installation</h3><div className="settings-path"><span><small>DOSSIER D’INSTALLATION PAR DÉFAUT</small><b>{settings.defaultInstallPath || 'Choisi lors de chaque nouvelle installation'}</b></span><button onClick={() => void onChooseInstall()}><FolderOpen size={15} /> Modifier</button></div><SettingsRow title="Mises à jour automatiques" description="Maintenir les jeux installés à jour en arrière-plan.">{toggle('autoUpdates', 'Mises à jour automatiques')}</SettingsRow></div>
            <div className="settings-group"><h3>Réseau</h3><div className="bandwidth-control"><div><span>Limite de téléchargement</span><b>{settings.bandwidthLimit === 0 ? 'Illimitée' : `${settings.bandwidthLimit} Mo/s`}</b></div><input type="range" min="0" max="100" step="5" value={settings.bandwidthLimit} onChange={(event) => updateSettings({ bandwidthLimit: Number(event.target.value) })} /></div><SettingsRow title="Téléchargements simultanés" description="Nombre maximal de transferts actifs."><select value={settings.concurrentDownloads} onChange={(event) => updateSettings({ concurrentDownloads: Number(event.target.value) })}><option value="1">1 transfert</option><option value="2">2 transferts</option><option value="3">3 transferts</option></select></SettingsRow><SettingsRow title="Planifier les téléchargements" description="Limiter les téléchargements à une plage horaire.">{toggle('scheduledDownloads', 'Planifier les téléchargements')}</SettingsRow>{settings.scheduledDownloads && <div className="schedule-row"><label>De <input type="time" value={settings.scheduleStart} onChange={(event) => updateSettings({ scheduleStart: event.target.value })} /></label><span>à</span><label><input type="time" value={settings.scheduleEnd} onChange={(event) => updateSettings({ scheduleEnd: event.target.value })} /></label></div>}</div>
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
            <div className="settings-group"><h3>Mises à jour du launcher</h3><SettingsRow title="Canal de publication" description="Les versions publiées et signées par Æ Games."><select value={settings.releaseChannel} onChange={(event) => updateSettings({ releaseChannel: event.target.value as LauncherSettings['releaseChannel'] })}><option value="stable">Stable</option></select></SettingsRow><div className={`launcher-update-card state-${updateState}`}><div className="launcher-update-summary"><span><small>VERSION INSTALLÉE</small><b>{launcherVersion}</b></span>{updateVersion && <span><small>VERSION DISPONIBLE</small><b>{updateVersion}</b></span>}<button className="settings-action" disabled={updateState === 'checking' || updateState === 'downloading'} onClick={() => void checkLauncherUpdate()}><RefreshCw className={updateState === 'checking' ? 'spinning' : ''} size={15} />{updateState === 'checking' ? 'Recherche…' : 'Rechercher'}</button></div>{updateMessage && <div className="launcher-update-feedback">{updateState === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}<p>{updateMessage}</p></div>}{updateState === 'available' && <button className="launcher-update-install" onClick={() => void installLauncherUpdate()}><Download size={16} /> Télécharger et installer la version {updateVersion}</button>}{updateState === 'downloading' && <div className="launcher-update-progress"><div><span>Téléchargement et vérification</span><b>{updateProgress > 0 ? `${updateProgress} %` : 'Préparation…'}</b></div><i><span style={{ width: `${updateProgress}%` }} /></i><small>Le launcher redémarrera automatiquement après l’installation.</small></div>}</div></div>
            <div className="settings-group"><h3>Diagnostic</h3><SettingsRow title="Vérifier l’installation du launcher" description="Contrôler l’exécutable et les ressources locales de Æ Games."><button className="settings-action" disabled={checking} onClick={() => void runVerification()}><ShieldCheck size={15} />{checking ? 'Vérification…' : 'Vérifier'}</button></SettingsRow>{diagnostic && <div className="diagnostic-result"><Check size={15} />{diagnostic}</div>}<SettingsRow title="Réinitialiser les réglages" description="Restaurer les préférences par défaut sans toucher aux jeux."><button className="settings-action danger" onClick={onReset}>Réinitialiser</button></SettingsRow></div>
          </>}
        </section>
      </div>
    </main>
  );
}

function Launcher({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>('accueil');
  const [installState, setInstallState] = useState<InstallState>('available');
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [installerOpen, setInstallerOpen] = useState(false);
  const [installerBusy, setInstallerBusy] = useState(false);
  const [installerError, setInstallerError] = useState('');
  const [installReport, setInstallReport] = useState<HypeInstallReport | null>(null);
  const [hypePath, setHypePath] = useState(() => localStorage.getItem('ae-hype-install-path') || '');
  const [hypeRunning, setHypeRunning] = useState(false);
  const [settings, setSettings] = useState<LauncherSettings>(loadLauncherSettings);
  const [automaticScale, setAutomaticScale] = useState(() => window.innerWidth >= 3000 ? 1.28 : window.innerWidth >= 2200 ? 1.16 : 1);
  const effectiveScale = settings.scaleMode === 'auto' ? automaticScale : settings.uiScale / 100;

  useEffect(() => {
    document.documentElement.style.setProperty('--launcher-ui-scale', String(effectiveScale));
    return () => {
      document.documentElement.style.removeProperty('--launcher-ui-scale');
    };
  }, [effectiveScale]);

  useEffect(() => {
    if (installState !== 'downloading' || paused) return;
    const timer = window.setInterval(() => setProgress((current) => {
      if (current >= 100) {
        window.clearInterval(timer);
        setInstallState('installed');
        return 100;
      }
      return Math.min(100, current + 1);
    }), 180);
    return () => window.clearInterval(timer);
  }, [installState, paused]);

  useEffect(() => {
    if (!hypePath || launcherAdapter.environment !== 'desktop') return;
    launcherAdapter.verifyHypeInstallation(hypePath).then((report) => {
      setInstallReport(report);
      if (report.kind === 'existing') {
        setInstallState('installed');
        setProgress(100);
      }
    }).catch(() => {
      localStorage.removeItem('ae-hype-install-path');
      setHypePath('');
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
    const updateAutomaticScale = () => setAutomaticScale(window.innerWidth >= 3000 ? 1.28 : window.innerWidth >= 2200 ? 1.16 : 1);
    window.addEventListener('resize', updateAutomaticScale);
    return () => window.removeEventListener('resize', updateAutomaticScale);
  }, []);

  useEffect(() => {
    localStorage.setItem('ae-launcher-settings', JSON.stringify(settings));
    localStorage.removeItem('ae-ui-scale');
  }, [settings]);

  const updateSettings = (patch: Partial<LauncherSettings>) => setSettings((current) => ({ ...current, ...patch }));

  const openInstaller = () => {
    setInstallReport(null);
    setInstallerError('');
    setInstallerOpen(true);
  };
  const chooseInstallation = async () => {
    setInstallerBusy(true);
    setInstallerError('');
    try {
      const report = await launcherAdapter.selectHypeInstallation(settings.defaultInstallPath);
      if (!report) return;
      setInstallReport(report);
      if (report.kind === 'existing') {
        setHypePath(report.path);
        localStorage.setItem('ae-hype-install-path', report.path);
        setInstallState('installed');
        setProgress(100);
      } else {
        setInstallState('available');
        setProgress(0);
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
    try {
      await launcherAdapter.launchHype(hypePath);
      setHypeRunning(true);
      return true;
    } catch (error) {
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
  const revealHype = async () => {
    if (!hypePath) throw new Error('Aucune installation de Hype n’est liée au launcher.');
    await launcherAdapter.revealHypeInstallation(hypePath);
  };
  const forgetHype = async () => {
    localStorage.removeItem('ae-hype-install-path');
    setHypePath('');
    setInstallReport(null);
    setInstallState('available');
    setProgress(0);
    setPaused(false);
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
  const cancelDownload = () => {
    setInstallState('available');
    setProgress(0);
    setPaused(false);
  };
  const pageTitle = page === 'accueil' ? 'Accueil' : page === 'bibliotheque' ? 'Bibliothèque' : page === 'telechargements' ? 'Téléchargements' : page === 'reglages' ? 'Réglages' : page === 'laliferp' ? 'L.A LifeRP' : 'Hype';
  return (
    <div className={`launcher-shell theme-${page} ${settings.compactMode ? 'ui-compact' : ''} ${settings.reducedMotion ? 'ui-reduced-motion' : ''} ${settings.highContrast ? 'ui-high-contrast' : ''}`} style={{ '--ui-scale': effectiveScale } as React.CSSProperties}>
      <Sidebar page={page} setPage={setPage} installState={installState} progress={progress} hypeRunning={hypeRunning} user={user} onSignOut={onSignOut} />
      <section className="workspace">
        <Topbar title={pageTitle} setPage={setPage} />
        <div className="workspace-scroll" key={page}>
          {page === 'accueil' && <HomePage setPage={setPage} />}
          {page === 'bibliotheque' && <LibraryPage setPage={setPage} installState={installState} progress={progress} hypeRunning={hypeRunning} installHype={openInstaller} launchHype={launchHype} stopHype={stopHype} />}
          {page === 'telechargements' && <DownloadsPage installState={installState} installReport={installReport} progress={progress} paused={paused} hypeRunning={hypeRunning} installHype={openInstaller} launchHype={launchHype} stopHype={stopHype} togglePause={() => setPaused((value) => !value)} cancelDownload={cancelDownload} />}
          {page === 'reglages' && <SettingsPage settings={settings} updateSettings={updateSettings} effectiveScale={effectiveScale} onChooseInstall={chooseDefaultInstallDirectory} onVerifyLauncher={verifyLauncher} onReset={() => setSettings(defaultLauncherSettings)} />}
          {page === 'laliferp' && <LifeRpPage />}
          {page === 'hype' && <HypePage installState={installState} installReport={installReport} progress={progress} hypeRunning={hypeRunning} installHype={openInstaller} launchHype={launchHype} stopHype={stopHype} onVerify={verifyHype} onReveal={revealHype} onForget={forgetHype} onUninstall={uninstallHype} />}
        </div>
        {installState === 'downloading' && page !== 'telechargements' && <button className="download-capsule" onClick={() => setPage('telechargements')}><span className="capsule-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><Download size={14} /></span><span><b>Hype · {progress} %</b><small>{paused ? 'Téléchargement en pause' : '42 Mo/s · Voir le transfert'}</small></span><ChevronRight size={16} /></button>}
      </section>
      {installerOpen && <HypeInstallModal report={installReport} busy={installerBusy} error={installerError} onChoose={() => void chooseInstallation()} onClose={() => setInstallerOpen(false)} />}
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
    ? <Launcher user={session.user} onSignOut={() => void logout()} />
    : <Login onLogin={() => void login()} busy={authBusy} initializing={session === undefined} error={authError} />;
}
