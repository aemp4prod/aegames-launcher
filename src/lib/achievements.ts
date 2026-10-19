import { supabase } from './supabase';

export type HypeAchievement = {
  achievementKey: string;
  title: string;
  description: string;
  iconKey: string;
  progressKind: string;
  progress: number;
  goal: number;
  progressPercent: number;
  points: number;
  isHidden: boolean;
  unlockedAt: string | null;
  rarityPercent: number;
};

export type HypeAchievementSession = {
  sessionToken: string;
  expiresAt: string;
};

export type PublicHypeAchievement = {
  achievementKey: string;
  title: string;
  description: string;
  iconKey: string;
  points: number;
  unlockedAt: string;
  rarityPercent: number;
};

type HypeAchievementRow = {
  achievement_key: string;
  title: string;
  description: string;
  icon_key: string;
  progress_kind: string;
  progress: number | string;
  goal: number | string;
  progress_percent: number | string;
  points: number;
  is_hidden: boolean;
  unlocked_at: string | null;
  rarity_percent: number | string;
};

function asNumber(value: number | string) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadMyHypeAchievements(): Promise<HypeAchievement[]> {
  const { data, error } = await supabase.rpc('get_my_hype_achievements');
  if (error) throw new Error(`Impossible de charger les succès Hype : ${error.message}`);
  return ((data ?? []) as HypeAchievementRow[]).map((row) => ({
    achievementKey: row.achievement_key,
    title: row.title,
    description: row.description,
    iconKey: row.icon_key,
    progressKind: row.progress_kind,
    progress: asNumber(row.progress),
    goal: asNumber(row.goal),
    progressPercent: asNumber(row.progress_percent),
    points: row.points,
    isHidden: row.is_hidden,
    unlockedAt: row.unlocked_at,
    rarityPercent: asNumber(row.rarity_percent),
  }));
}

export async function createHypeAchievementSession(ttlSeconds = 21_600): Promise<HypeAchievementSession> {
  const { data, error } = await supabase.rpc('create_hype_achievement_session', { p_ttl_seconds: ttlSeconds });
  if (error) throw new Error(`Impossible d’ouvrir la session de succès Hype : ${error.message}`);
  const row = (data as Array<{ session_token: string; expires_at: string }> | null)?.[0];
  if (!row?.session_token || !row.expires_at) throw new Error('Supabase n’a pas renvoyé de ticket de succès valide.');
  return { sessionToken: row.session_token, expiresAt: row.expires_at };
}

export async function revokeHypeAchievementSessions(): Promise<void> {
  const { error } = await supabase.rpc('revoke_hype_achievement_sessions');
  if (error) throw new Error(`Impossible de fermer la session de succès Hype : ${error.message}`);
}

export async function loadProfileHypeAchievements(userId: string): Promise<PublicHypeAchievement[]> {
  const { data, error } = await supabase.rpc('get_profile_hype_achievements', { p_target_user_id: userId });
  if (error) throw new Error(`Impossible de charger les succès de ce profil : ${error.message}`);
  return ((data ?? []) as Array<{
    achievement_key: string;
    title: string;
    description: string;
    icon_key: string;
    points: number;
    unlocked_at: string;
    rarity_percent: number | string;
  }>).map((row) => ({
    achievementKey: row.achievement_key,
    title: row.title,
    description: row.description,
    iconKey: row.icon_key,
    points: row.points,
    unlockedAt: row.unlocked_at,
    rarityPercent: asNumber(row.rarity_percent),
  }));
}
