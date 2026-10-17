create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  discord_id text unique,
  display_name text not null,
  username text not null,
  bio text not null default '',
  avatar_url text,
  banner_data_url text,
  presence_status text not null default 'online'
    check (presence_status in ('online', 'busy', 'invisible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by their owner" on public.profiles;
create policy "Profiles are readable by their owner"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Profiles are insertable by their owner" on public.profiles;
create policy "Profiles are insertable by their owner"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Profiles are editable by their owner" on public.profiles;
create policy "Profiles are editable by their owner"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function public.set_launcher_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_launcher_profile_updated_at on public.profiles;
create trigger set_launcher_profile_updated_at
before update on public.profiles
for each row execute function public.set_launcher_profile_updated_at();

create or replace function public.handle_launcher_user_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  metadata jsonb := new.raw_user_meta_data;
  discord_identity jsonb;
begin
  select identity_data into discord_identity
  from auth.identities
  where user_id = new.id and provider = 'discord'
  order by created_at asc
  limit 1;

  insert into public.profiles (
    id,
    discord_id,
    display_name,
    username,
    avatar_url
  ) values (
    new.id,
    coalesce(metadata ->> 'provider_id', metadata ->> 'sub', discord_identity ->> 'id', discord_identity ->> 'sub'),
    coalesce(metadata ->> 'full_name', metadata ->> 'name', metadata ->> 'global_name', discord_identity ->> 'global_name', metadata ->> 'preferred_username', 'Joueur'),
    coalesce(metadata ->> 'preferred_username', metadata ->> 'user_name', discord_identity ->> 'username', 'joueur'),
    coalesce(metadata ->> 'avatar_url', discord_identity ->> 'avatar_url')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_launcher_user_created on auth.users;
create trigger on_launcher_user_created
after insert on auth.users
for each row execute function public.handle_launcher_user_created();

insert into public.profiles (id, discord_id, display_name, username, avatar_url)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'provider_id', users.raw_user_meta_data ->> 'sub'),
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', users.raw_user_meta_data ->> 'global_name', users.raw_user_meta_data ->> 'preferred_username', 'Joueur'),
  coalesce(users.raw_user_meta_data ->> 'preferred_username', users.raw_user_meta_data ->> 'user_name', 'joueur'),
  users.raw_user_meta_data ->> 'avatar_url'
from auth.users as users
on conflict (id) do nothing;
