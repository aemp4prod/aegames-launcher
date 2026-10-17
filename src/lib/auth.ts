import type { User } from '@supabase/supabase-js';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { supabase } from './supabase';

export const DESKTOP_AUTH_CALLBACK = 'aegames://auth/callback';

export type PresenceStatus = 'online' | 'busy' | 'invisible';

export type ProfileData = {
  name: string;
  username: string;
  bio: string;
  avatarDataUrl?: string;
  bannerDataUrl?: string;
  status: PresenceStatus;
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
  };
}

export async function loadProfile(user: User): Promise<ProfileData> {
  const fallback = profileFromUser(user);
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, username, bio, avatar_url, banner_data_url, presence_status')
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
  });
  if (error?.code === '23505') throw new Error('Ce pseudo est déjà utilisé.');
  if (error) throw error;
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
