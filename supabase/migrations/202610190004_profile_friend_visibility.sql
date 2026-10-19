create or replace function public.get_launcher_profile_friends(target_user_id uuid)
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text,
  profile_theme jsonb, profile_shelves jsonb
)
language sql stable security definer set search_path = '' as $$
  select viewer_friendship.id, friend_profile.id, friend_profile.display_name, friend_profile.username,
    friend_profile.avatar_url, friend_profile.banner_data_url, friend_profile.bio,
    case when friend_profile.presence_status = 'invisible' or friend_profile.last_seen_at < now() - interval '70 seconds'
      then 'invisible' else friend_profile.presence_status end,
    case when friend_profile.last_seen_at >= now() - interval '70 seconds' then friend_profile.current_game else null end,
    friend_profile.created_at, coalesce(viewer_friendship.status, 'none')::text,
    case when viewer_friendship.status = 'pending' and viewer_friendship.requested_by = auth.uid() then 'outgoing'
         when viewer_friendship.status = 'pending' then 'incoming' else null end,
    friend_profile.profile_theme, friend_profile.profile_shelves
  from public.friendships profile_friendship
  join public.profiles friend_profile on friend_profile.id = case
    when profile_friendship.user_a = target_user_id then profile_friendship.user_b
    else profile_friendship.user_a end
  left join public.friendships viewer_friendship on
    (viewer_friendship.user_a = auth.uid() and viewer_friendship.user_b = friend_profile.id)
    or (viewer_friendship.user_b = auth.uid() and viewer_friendship.user_a = friend_profile.id)
  where auth.uid() is not null
    and profile_friendship.status = 'accepted'
    and (profile_friendship.user_a = target_user_id or profile_friendship.user_b = target_user_id)
    and not exists (select 1 from public.profile_blocks blocked where
      (blocked.blocker_id = auth.uid() and blocked.blocked_id = friend_profile.id)
      or (blocked.blocker_id = friend_profile.id and blocked.blocked_id = auth.uid()))
    and not exists (select 1 from public.profile_blocks target_block where
      (target_block.blocker_id = auth.uid() and target_block.blocked_id = target_user_id)
      or (target_block.blocker_id = target_user_id and target_block.blocked_id = auth.uid()))
  order by case when friend_profile.last_seen_at >= now() - interval '70 seconds' and friend_profile.presence_status <> 'invisible' then 0 else 1 end,
    friend_profile.display_name;
$$;

revoke all on function public.get_launcher_profile_friends(uuid) from public;
grant execute on function public.get_launcher_profile_friends(uuid) to authenticated;
