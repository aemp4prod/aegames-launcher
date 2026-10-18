alter table public.profiles
  add column if not exists profile_theme jsonb not null default jsonb_build_object(
    'mode', 'gradient',
    'background', '#10111b',
    'backgroundSecondary', '#242052',
    'accent', '#8f87ff',
    'angle', 135,
    'surfaceOpacity', 76
  );

alter table public.profiles
  drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length check (char_length(bio) <= 3000);

grant select (profile_theme) on public.profiles to authenticated;

drop function if exists public.get_launcher_public_profile(uuid);
create function public.get_launcher_public_profile(target_user_id uuid)
returns table (
  friendship_id uuid, user_id uuid, display_name text, username text,
  avatar_url text, banner_data_url text, bio text, presence_status text,
  current_game text, created_at timestamptz, relationship_status text, direction text,
  friend_count bigint, profile_theme jsonb
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
    p.profile_theme
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
