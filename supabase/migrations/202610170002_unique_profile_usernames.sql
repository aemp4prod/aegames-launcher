create or replace function public.normalize_launcher_username(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(both '._' from left(
    trim(both '._' from regexp_replace(
      regexp_replace(lower(coalesce(value, '')), '[^a-z0-9._]+', '_', 'g'),
      '[._]{2,}', '_', 'g'
    )), 24
  ));
$$;

update public.profiles as profiles
set username = public.normalize_launcher_username(coalesce(
  users.raw_user_meta_data ->> 'preferred_username',
  users.raw_user_meta_data ->> 'user_name',
  users.raw_user_meta_data ->> 'username',
  users.raw_user_meta_data ->> 'full_name',
  profiles.username
))
from auth.users as users
where users.id = profiles.id;

update public.profiles
set username = public.normalize_launcher_username(username);

update public.profiles
set username = 'joueur_' || left(replace(id::text, '-', ''), 6)
where length(username) < 2;

with ranked_usernames as (
  select
    id,
    row_number() over (partition by lower(username) order by created_at, id) as position
  from public.profiles
)
update public.profiles as profiles
set username = left(profiles.username, 17) || '_' || left(replace(profiles.id::text, '-', ''), 6)
from ranked_usernames
where ranked_usernames.id = profiles.id
  and ranked_usernames.position > 1;

create unique index if not exists profiles_username_lower_key
on public.profiles (lower(username));

alter table public.profiles
drop constraint if exists profiles_username_format;

alter table public.profiles
add constraint profiles_username_format
check (username ~ '^[a-z0-9][a-z0-9._]{0,22}[a-z0-9]$');

create or replace function public.is_launcher_username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and candidate = public.normalize_launcher_username(candidate)
    and length(candidate) between 2 and 24
    and candidate ~ '^[a-z0-9][a-z0-9._]{0,22}[a-z0-9]$'
    and not exists (
      select 1
      from public.profiles
      where lower(username) = lower(candidate)
        and id <> auth.uid()
    );
$$;

revoke all on function public.is_launcher_username_available(text) from public;
grant execute on function public.is_launcher_username_available(text) to authenticated;

create or replace function public.handle_launcher_user_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  metadata jsonb := new.raw_user_meta_data;
  discord_identity jsonb;
  base_username text;
  available_username text;
begin
  select identity_data into discord_identity
  from auth.identities
  where user_id = new.id and provider = 'discord'
  order by created_at asc
  limit 1;

  base_username := public.normalize_launcher_username(coalesce(
    metadata ->> 'preferred_username',
    metadata ->> 'user_name',
    metadata ->> 'username',
    metadata ->> 'full_name',
    discord_identity ->> 'preferred_username',
    discord_identity ->> 'user_name',
    discord_identity ->> 'username',
    discord_identity ->> 'full_name',
    discord_identity ->> 'name',
    'joueur'
  ));

  if length(base_username) < 2 then
    base_username := 'joueur';
  end if;

  available_username := base_username;
  if exists (select 1 from public.profiles where lower(username) = lower(available_username)) then
    available_username := left(base_username, 17) || '_' || left(replace(new.id::text, '-', ''), 6);
  end if;

  insert into public.profiles (
    id,
    discord_id,
    display_name,
    username,
    avatar_url
  ) values (
    new.id,
    coalesce(metadata ->> 'provider_id', metadata ->> 'sub', discord_identity ->> 'id', discord_identity ->> 'sub'),
    coalesce(metadata ->> 'full_name', metadata ->> 'name', metadata ->> 'global_name', discord_identity ->> 'global_name', base_username, 'Joueur'),
    available_username,
    coalesce(metadata ->> 'avatar_url', discord_identity ->> 'avatar_url')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
