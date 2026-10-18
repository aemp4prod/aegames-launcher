import { supabase } from './supabase';
import { normalizeProfileTheme, type ProfileTheme } from './auth';

export type RelationshipStatus = 'none' | 'pending' | 'accepted';
export type RelationshipDirection = 'incoming' | 'outgoing' | null;

export type FriendProfile = {
  friendshipId: string | null;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio: string;
  presenceStatus: 'online' | 'busy' | 'invisible';
  currentGame?: string;
  createdAt?: string;
  relationshipStatus: RelationshipStatus;
  direction: RelationshipDirection;
  theme: ProfileTheme;
};

type FriendRow = {
  friendship_id: string | null;
  user_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  banner_data_url: string | null;
  bio: string | null;
  presence_status: 'online' | 'busy' | 'invisible';
  current_game: string | null;
  created_at: string | null;
  relationship_status: RelationshipStatus | null;
  direction: RelationshipDirection;
  profile_theme?: unknown;
};

function mapProfile(row: FriendRow): FriendProfile {
  return {
    friendshipId: row.friendship_id,
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url || undefined,
    bannerUrl: row.banner_data_url || undefined,
    bio: row.bio || '',
    presenceStatus: row.presence_status,
    currentGame: row.current_game || undefined,
    createdAt: row.created_at || undefined,
    relationshipStatus: row.relationship_status ?? 'none',
    direction: row.direction,
    theme: normalizeProfileTheme(row.profile_theme),
  };
}

export async function searchProfiles(term: string) {
  const { data, error } = await supabase.rpc('search_launcher_profiles', { search_text: term.trim() });
  if (error) throw error;
  return ((data ?? []) as FriendRow[]).map(mapProfile);
}

export async function loadRelationships() {
  const { data, error } = await supabase.rpc('get_launcher_relationships');
  if (error) throw error;
  return ((data ?? []) as FriendRow[]).map(mapProfile);
}

export async function sendFriendRequest(targetUserId: string) {
  const { error } = await supabase.rpc('send_launcher_friend_request', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function respondToFriendRequest(friendshipId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_launcher_friend_request', { friendship_id: friendshipId, accept_request: accept });
  if (error) throw error;
}

export async function removeFriend(targetUserId: string) {
  const { error } = await supabase.rpc('remove_launcher_friend', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function blockProfile(targetUserId: string) {
  const { error } = await supabase.rpc('block_launcher_profile', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function unblockProfile(targetUserId: string) {
  const { error } = await supabase.rpc('unblock_launcher_profile', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function loadBlockedProfiles() {
  const { data, error } = await supabase.rpc('get_launcher_blocked_profiles');
  if (error) throw error;
  return ((data ?? []) as FriendRow[]).map(mapProfile);
}

export async function setCurrentGame(game: string | null) {
  const { error } = await supabase.rpc('set_launcher_current_game', { game_name: game });
  if (error) throw error;
}

export async function heartbeatPresence() {
  const { error } = await supabase.rpc('touch_launcher_presence');
  if (error) throw error;
}

export async function markPresenceOffline() {
  const { error } = await supabase.rpc('disconnect_launcher_presence');
  if (error) throw error;
}

export async function loadPublicProfile(targetUserId: string) {
  const { data, error } = await supabase.rpc('get_launcher_public_profile', { target_user_id: targetUserId });
  if (error) throw error;
  const row = ((data ?? []) as (FriendRow & { friend_count: number })[])[0];
  if (!row) throw new Error('Ce profil est introuvable ou indisponible.');
  return { ...mapProfile(row), friendCount: Number(row.friend_count) || 0 };
}

export type PublicProfile = Awaited<ReturnType<typeof loadPublicProfile>>;
