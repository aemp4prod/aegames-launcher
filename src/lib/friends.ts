import { supabase } from './supabase';

export type RelationshipStatus = 'none' | 'pending' | 'accepted';
export type RelationshipDirection = 'incoming' | 'outgoing' | null;

export type FriendProfile = {
  friendshipId: string | null;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  presenceStatus: 'online' | 'busy' | 'invisible';
  relationshipStatus: RelationshipStatus;
  direction: RelationshipDirection;
};

type FriendRow = {
  friendship_id: string | null;
  user_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  presence_status: 'online' | 'busy' | 'invisible';
  relationship_status: RelationshipStatus | null;
  direction: RelationshipDirection;
};

function mapProfile(row: FriendRow): FriendProfile {
  return {
    friendshipId: row.friendship_id,
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url || undefined,
    presenceStatus: row.presence_status,
    relationshipStatus: row.relationship_status ?? 'none',
    direction: row.direction,
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
