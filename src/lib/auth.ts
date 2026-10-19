import type { User } from '@supabase/supabase-js';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { supabase } from './supabase';

export const DESKTOP_AUTH_CALLBACK = 'aegames://auth/callback';

export type PresenceStatus = 'online' | 'busy' | 'invisible';

export type ProfileTheme = {
  mode: 'solid' | 'gradient';
  background: string;
  backgroundSecondary: string;
  accent: string;
  angle: number;
  surfaceOpacity: number;
};

export type ProfileShowcaseKey = 'universes' | 'activity' | 'achievements' | 'statistics' | 'favorite';
export type ProfileGameKey = 'laliferp' | 'hype';
export type ProfileAchievementKey = string;
export type ProfileStatisticKey = 'playtime' | 'achievements' | 'friends' | 'latency' | 'library' | 'active-session';

export type ProfileShowcase = {
  type: ProfileShowcaseKey;
  gameIds?: ProfileGameKey[];
  achievementIds?: ProfileAchievementKey[];
  statisticIds?: ProfileStatisticKey[];
  favoriteGameId?: ProfileGameKey;
};

export type ProfileShelf = {
  id: string;
  layout: 1 | 2 | 3;
  slots: ProfileShowcase[];
};

export const defaultProfileShelves: ProfileShelf[] = [
  { id: 'universes', layout: 2, slots: [{ type: 'universes', gameIds: ['laliferp', 'hype'] }, { type: 'activity' }] },
];

const showcaseKeys: ProfileShowcaseKey[] = ['universes', 'activity', 'achievements', 'statistics', 'favorite'];
const gameKeys: ProfileGameKey[] = ['laliferp', 'hype'];
const statisticKeys: ProfileStatisticKey[] = ['playtime', 'achievements', 'friends', 'latency', 'library', 'active-session'];

export function defaultProfileShowcase(type: ProfileShowcaseKey): ProfileShowcase {
  if (type === 'universes') return { type, gameIds: [...gameKeys] };
  if (type === 'achievements') return { type, achievementIds: [] };
  if (type === 'statistics') return { type, statisticIds: ['playtime', 'achievements', 'friends'] };
  if (type === 'favorite') return { type, favoriteGameId: 'hype' };
  return { type };
}

function normalizeShowcase(value: unknown, fallback: ProfileShowcaseKey): ProfileShowcase {
  const legacyType = typeof value === 'string' ? value : undefined;
  const source = value && typeof value === 'object' ? value as Partial<ProfileShowcase> : {};
  const requestedType = legacyType ?? source.type;
  const type = showcaseKeys.includes(requestedType as ProfileShowcaseKey)
    ? requestedType as ProfileShowcaseKey
    : fallback;
  const normalized = defaultProfileShowcase(type);
  if (type === 'universes' && Array.isArray(source.gameIds)) normalized.gameIds = source.gameIds.filter((key): key is ProfileGameKey => gameKeys.includes(key as ProfileGameKey));
  if (type === 'achievements' && Array.isArray(source.achievementIds)) normalized.achievementIds = source.achievementIds.filter((key): key is ProfileAchievementKey => typeof key === 'string' && /^[a-z0-9-]{1,80}$/.test(key));
  if (type === 'statistics' && Array.isArray(source.statisticIds)) normalized.statisticIds = source.statisticIds.filter((key): key is ProfileStatisticKey => statisticKeys.includes(key as ProfileStatisticKey));
  if (type === 'favorite' && gameKeys.includes(source.favoriteGameId as ProfileGameKey)) normalized.favoriteGameId = source.favoriteGameId as ProfileGameKey;
  return normalized;
}

export function normalizeProfileShelves(value: unknown): ProfileShelf[] {
  if (!Array.isArray(value)) return defaultProfileShelves.map((shelf) => ({ ...shelf, slots: [...shelf.slots] }));
  return value.slice(0, 8).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<ProfileShelf>;
    const layout = candidate.layout === 1 || candidate.layout === 3 ? candidate.layout : 2;
    const slots = Array.isArray(candidate.slots)
      ? candidate.slots.slice(0, layout).map((slot, slotIndex) => normalizeShowcase(slot, showcaseKeys[(index + slotIndex) % showcaseKeys.length]))
      : [];
    while (slots.length < layout) {
      const fallback = showcaseKeys[(index + slots.length) % showcaseKeys.length];
      slots.push(defaultProfileShowcase(fallback));
    }
    return [{ id: typeof candidate.id === 'string' && candidate.id ? candidate.id.slice(0, 80) : `shelf-${index + 1}`, layout, slots }];
  });
}

export const defaultProfileTheme: ProfileTheme = {
  mode: 'gradient',
  background: '#10111b',
  backgroundSecondary: '#242052',
  accent: '#8f87ff',
  angle: 135,
  surfaceOpacity: 76,
};

function colorValue(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function normalizeProfileTheme(value: unknown): ProfileTheme {
  const theme = value && typeof value === 'object' ? value as Partial<ProfileTheme> : {};
  return {
    mode: theme.mode === 'solid' ? 'solid' : 'gradient',
    background: colorValue(theme.background, defaultProfileTheme.background),
    backgroundSecondary: colorValue(theme.backgroundSecondary, defaultProfileTheme.backgroundSecondary),
    accent: colorValue(theme.accent, defaultProfileTheme.accent),
    angle: Math.min(360, Math.max(0, Number(theme.angle) || defaultProfileTheme.angle)),
    surfaceOpacity: Math.min(94, Math.max(42, Number(theme.surfaceOpacity) || defaultProfileTheme.surfaceOpacity)),
  };
}

export type ProfileData = {
  name: string;
  username: string;
  bio: string;
  avatarDataUrl?: string;
  bannerDataUrl?: string;
  status: PresenceStatus;
  theme: ProfileTheme;
  shelves: ProfileShelf[];
};

const handledCodes = new Set<string>();

function userMetadata(user: User) {
  return user.user_metadata as Record<string, unknown>;
}

function textValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

export function normalizeUsername(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]+/g, '_')
    .replace(/[._]{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 24)
    .replace(/[._]+$/g, '');
}

export function validateUsername(username: string) {
  if (username.length < 2) return 'Le pseudo doit contenir au moins 2 caractères.';
  if (username.length > 24) return 'Le pseudo ne peut pas dépasser 24 caractères.';
  if (!/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(username)) return 'Utilisez uniquement des lettres, chiffres, points et underscores.';
  return '';
}

export function discordIdFromUser(user: User) {
  const metadata = userMetadata(user);
  const identityData = user.identities?.find((identity) => identity.provider === 'discord')?.identity_data;
  return textValue(metadata.provider_id, metadata.sub, identityData?.id, identityData?.sub);
}

export function profileFromUser(user: User): ProfileData {
  const metadata = userMetadata(user);
  const identityData = user.identities?.find((identity) => identity.provider === 'discord')?.identity_data;
  const discordUsername = textValue(
    metadata.preferred_username,
    metadata.user_name,
    metadata.username,
    metadata.full_name,
    identityData?.preferred_username,
    identityData?.user_name,
    identityData?.username,
    identityData?.full_name,
    identityData?.name,
  ) ?? 'joueur';
  const username = normalizeUsername(discordUsername) || 'joueur';
  return {
    name: textValue(metadata.full_name, metadata.name, metadata.global_name, identityData?.global_name, username) ?? 'Joueur',
    username,
    bio: '',
    avatarDataUrl: textValue(metadata.avatar_url, identityData?.avatar_url),
    status: 'online',
    theme: defaultProfileTheme,
    shelves: defaultProfileShelves,
  };
}

export async function loadProfile(user: User): Promise<ProfileData> {
  const fallback = profileFromUser(user);
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, username, bio, avatar_url, banner_data_url, presence_status, profile_theme, profile_shelves')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return fallback;

  return {
    name: data.display_name || fallback.name,
    username: data.username || fallback.username,
    bio: data.bio || '',
    avatarDataUrl: data.avatar_url || fallback.avatarDataUrl,
    bannerDataUrl: data.banner_data_url || undefined,
    status: data.presence_status === 'busy' || data.presence_status === 'invisible' ? data.presence_status : 'online',
    theme: normalizeProfileTheme(data.profile_theme),
    shelves: normalizeProfileShelves(data.profile_shelves),
  };
}

export async function saveProfile(user: User, profile: ProfileData) {
  const username = normalizeUsername(profile.username);
  const validationError = validateUsername(username);
  if (validationError) throw new Error(validationError);
  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    discord_id: discordIdFromUser(user),
    display_name: profile.name.trim(),
    username,
    bio: profile.bio.trim(),
    avatar_url: profile.avatarDataUrl ?? null,
    banner_data_url: profile.bannerDataUrl ?? null,
    presence_status: profile.status,
    profile_theme: normalizeProfileTheme(profile.theme),
    profile_shelves: normalizeProfileShelves(profile.shelves),
  });
  if (error?.code === '23505') throw new Error('Ce pseudo est déjà utilisé.');
  if (error) throw error;
}

export type ProfileCustomization = {
  displayName: string;
  username: string;
  bio: string;
  avatarDataUrl?: string;
  bannerDataUrl?: string;
  status: PresenceStatus;
  theme: ProfileTheme;
  shelves: ProfileShelf[];
};

export async function saveProfileCustomization(userId: string, customization: ProfileCustomization) {
  const username = normalizeUsername(customization.username);
  const validationError = validateUsername(username);
  if (validationError) throw new Error(validationError);
  if (!customization.displayName.trim()) throw new Error('Le nom d’affichage est requis.');
  if (customization.bio.length > 3000) throw new Error('La bio ne peut pas dépasser 3 000 caractères.');

  const { data, error } = await supabase
    .from('profiles')
    .update({
      display_name: customization.displayName.trim().slice(0, 60),
      username,
      bio: customization.bio.trim(),
      avatar_url: customization.avatarDataUrl ?? null,
      banner_data_url: customization.bannerDataUrl ?? null,
      presence_status: customization.status,
      profile_theme: normalizeProfileTheme(customization.theme),
      profile_shelves: normalizeProfileShelves(customization.shelves),
    })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error?.code === '23505') throw new Error('Ce pseudo est déjà utilisé.');
  if (error) throw error;
  if (!data) throw new Error('Le profil n’a pas pu être enregistré.');
}

export async function saveProfileMedia(user: User, kind: 'avatarDataUrl' | 'bannerDataUrl', dataUrl: string) {
  const column = kind === 'avatarDataUrl' ? 'avatar_url' : 'banner_data_url';
  const { data, error } = await supabase
    .from('profiles')
    .update({ [column]: dataUrl })
    .eq('id', user.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La nouvelle image n’a pas été enregistrée par Supabase.');
}

export async function savePresenceStatus(userId: string, status: PresenceStatus) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ presence_status: status })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Le statut n’a pas pu être enregistré.');
}

export async function saveProfileTheme(userId: string, theme: ProfileTheme) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ profile_theme: normalizeProfileTheme(theme) })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La signature visuelle n’a pas pu être enregistrée.');
}

export async function isUsernameAvailable(username: string) {
  const normalized = normalizeUsername(username);
  if (validateUsername(normalized)) return false;
  const { data, error } = await supabase.rpc('is_launcher_username_available', { candidate: normalized });
  if (error) throw error;
  return data === true;
}

export async function signInWithDiscord() {
  const desktop = isTauri();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: desktop ? DESKTOP_AUTH_CALLBACK : `${window.location.origin}/`,
      scopes: 'identify email',
      skipBrowserRedirect: desktop,
    },
  });

  if (error) throw error;
  if (desktop && data.url) await openUrl(data.url);
}

async function consumeAuthCallback(url: string) {
  const callback = new URL(url);
  if (callback.protocol !== 'aegames:' || callback.hostname !== 'auth' || callback.pathname !== '/callback') return;

  const authError = callback.searchParams.get('error_description') ?? callback.searchParams.get('error');
  if (authError) throw new Error(authError);

  const code = callback.searchParams.get('code');
  if (!code || handledCodes.has(code)) return;
  handledCodes.add(code);

  const flowId = callback.searchParams.get('sb_flow_id');
  const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error) {
    handledCodes.delete(code);
    throw error;
  }

  const appWindow = getCurrentWindow();
  await appWindow.show();
  await appWindow.setFocus();
}

export async function listenForAuthCallbacks(onError: (message: string) => void) {
  if (!isTauri()) return () => undefined;

  const handleUrls = (urls: string[]) => {
    for (const url of urls) {
      void consumeAuthCallback(url).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : 'Le retour de Discord n’a pas pu être traité.');
      });
    }
  };

  const unlisten = await onOpenUrl(handleUrls);
  const currentUrls = await getCurrent();
  if (currentUrls) handleUrls(currentUrls);
  return unlisten;
}
