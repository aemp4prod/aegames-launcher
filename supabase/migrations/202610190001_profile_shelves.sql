alter table public.profiles
  add column if not exists profile_shelves jsonb not null default '[{"id":"universes","layout":2,"slots":["universes","activity"]}]'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_profile_shelves_shape;
alter table public.profiles
  add constraint profiles_profile_shelves_shape check (
    jsonb_typeof(profile_shelves) = 'array'
    and jsonb_array_length(profile_shelves) <= 8
  );

grant select (profile_shelves) on public.profiles to authenticated;

drop function if exists public.get_launcher_public_profile(uuid);
create function public.get_launcher_public_profile(target_user_id uuid)
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text,
  friend_count bigint, profile_theme jsonb, profile_shelves jsonb
)
language sql stable security definer set search_path = '' as $$
  select f.id, p.id, p.display_name, p.username, p.avatar_url, p.banner_data_url, p.bio,
    case when p.presence_status = 'invisible' or p.last_seen_at < now() - interval '70 seconds' then 'invisible' else p.presence_status end,
    case when p.last_seen_at >= now() - interval '70 seconds' then p.current_game else null end,
    p.created_at, f.status,
    case when f.status = 'pending' and f.requested_by = auth.uid() then 'outgoing'
         when f.status = 'pending' then 'incoming' else null end,
    (select count(*) from public.friendships fc where fc.status = 'accepted'
      and (fc.user_a = p.id or fc.user_b = p.id)),
    p.profile_theme,
    p.profile_shelves
  from public.profiles p
  left join public.friendships f on
    (f.user_a = auth.uid() and f.user_b = p.id) or (f.user_b = auth.uid() and f.user_a = p.id)
  where auth.uid() is not null and p.id = target_user_id
    and not exists (select 1 from public.profile_blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = p.id) or
      (b.blocker_id = p.id and b.blocked_id = auth.uid()));
$$;

revoke all on function public.get_launcher_public_profile(uuid) from public;
grant execute on function public.get_launcher_public_profile(uuid) to authenticated;
