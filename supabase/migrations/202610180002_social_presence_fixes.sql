-- Follow-up for installations where 202610180001_social_update.sql was already applied.

create or replace function public.search_launcher_profiles(search_text text)
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text
)
language sql stable security definer set search_path = '' as $$
  select friendships.id, profiles.id, profiles.display_name, profiles.username,
    profiles.avatar_url, profiles.banner_data_url, profiles.bio,
    case when profiles.presence_status = 'invisible' or profiles.last_seen_at < now() - interval '70 seconds' then 'invisible' else profiles.presence_status end,
    case when profiles.last_seen_at >= now() - interval '70 seconds' then profiles.current_game else null end,
    profiles.created_at, friendships.status,
    case when friendships.status = 'pending' and friendships.requested_by = auth.uid() then 'outgoing'
         when friendships.status = 'pending' then 'incoming' else null end
  from public.profiles as profiles
  left join public.friendships as friendships
    on (friendships.user_a = auth.uid() and friendships.user_b = profiles.id)
    or (friendships.user_b = auth.uid() and friendships.user_a = profiles.id)
  where auth.uid() is not null and profiles.id <> auth.uid() and length(trim(search_text)) >= 2
    and not exists (select 1 from public.profile_blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = profiles.id) or
      (b.blocker_id = profiles.id and b.blocked_id = auth.uid()))
    and (position(lower(trim(search_text)) in lower(profiles.display_name)) > 0
      or position(lower(trim(leading '@' from search_text)) in lower(profiles.username)) > 0)
  order by case when lower(profiles.username) = lower(trim(leading '@' from search_text)) then 0 else 1 end,
    profiles.display_name limit 20;
$$;

create or replace function public.get_launcher_relationships()
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text
)
language sql stable security definer set search_path = '' as $$
  select friendships.id, profiles.id, profiles.display_name, profiles.username,
    profiles.avatar_url, profiles.banner_data_url, profiles.bio,
    case when profiles.presence_status = 'invisible' or profiles.last_seen_at < now() - interval '70 seconds' then 'invisible' else profiles.presence_status end,
    case when profiles.last_seen_at >= now() - interval '70 seconds' then profiles.current_game else null end,
    profiles.created_at, friendships.status,
    case when friendships.status = 'pending' and friendships.requested_by = auth.uid() then 'outgoing'
         when friendships.status = 'pending' then 'incoming' else null end
  from public.friendships as friendships
  join public.profiles as profiles
    on profiles.id = case when friendships.user_a = auth.uid() then friendships.user_b else friendships.user_a end
  where auth.uid() is not null
    and (friendships.user_a = auth.uid() or friendships.user_b = auth.uid())
    and not exists (select 1 from public.profile_blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = profiles.id) or
      (b.blocker_id = profiles.id and b.blocked_id = auth.uid()))
  order by friendships.status, profiles.display_name;
$$;

create or replace function public.get_launcher_public_profile(target_user_id uuid)
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text,
  friend_count bigint
)
language sql stable security definer set search_path = '' as $$
  select f.id, p.id, p.display_name, p.username, p.avatar_url, p.banner_data_url, p.bio,
    case when p.presence_status = 'invisible' or p.last_seen_at < now() - interval '70 seconds' then 'invisible' else p.presence_status end,
    case when p.last_seen_at >= now() - interval '70 seconds' then p.current_game else null end,
    p.created_at, f.status,
    case when f.status = 'pending' and f.requested_by = auth.uid() then 'outgoing'
         when f.status = 'pending' then 'incoming' else null end,
    (select count(*) from public.friendships fc where fc.status = 'accepted'
      and (fc.user_a = p.id or fc.user_b = p.id))
  from public.profiles p
  left join public.friendships f on
    (f.user_a = auth.uid() and f.user_b = p.id) or (f.user_b = auth.uid() and f.user_a = p.id)
  where auth.uid() is not null and p.id = target_user_id
    and not exists (select 1 from public.profile_blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = p.id) or
      (b.blocker_id = p.id and b.blocked_id = auth.uid()));
$$;

create or replace function public.unblock_launcher_profile(target_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.profile_blocks
  where blocker_id = auth.uid() and blocked_id = target_user_id;
$$;

create or replace function public.get_launcher_blocked_profiles()
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text
)
language sql stable security definer set search_path = '' as $$
  select null::uuid, p.id, p.display_name, p.username, p.avatar_url, p.banner_data_url, p.bio,
    case when p.presence_status = 'invisible' or p.last_seen_at < now() - interval '70 seconds' then 'invisible' else p.presence_status end,
    case when p.last_seen_at >= now() - interval '70 seconds' then p.current_game else null end,
    p.created_at, 'none'::text, null::text
  from public.profile_blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

create or replace function public.touch_launcher_presence()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

create or replace function public.disconnect_launcher_presence()
returns void language sql security definer set search_path = '' as $$
  update public.profiles
  set current_game = null, last_seen_at = now() - interval '2 minutes'
  where id = auth.uid();
$$;

revoke all on function public.unblock_launcher_profile(uuid) from public;
revoke all on function public.get_launcher_blocked_profiles() from public;
revoke all on function public.touch_launcher_presence() from public;
revoke all on function public.disconnect_launcher_presence() from public;
grant execute on function public.unblock_launcher_profile(uuid) to authenticated;
grant execute on function public.get_launcher_blocked_profiles() to authenticated;
grant execute on function public.touch_launcher_presence() to authenticated;
grant execute on function public.disconnect_launcher_presence() to authenticated;
grant execute on function public.search_launcher_profiles(text) to authenticated;
grant execute on function public.get_launcher_relationships() to authenticated;
grant execute on function public.get_launcher_public_profile(uuid) to authenticated;
