create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_distinct_users check (user_a <> user_b),
  constraint friendships_canonical_order check (user_a < user_b),
  constraint friendships_requester_is_member check (requested_by = user_a or requested_by = user_b),
  constraint friendships_unique_pair unique (user_a, user_b)
);

create index if not exists friendships_user_a_idx on public.friendships(user_a);
create index if not exists friendships_user_b_idx on public.friendships(user_b);

alter table public.friendships enable row level security;

drop policy if exists "Friendships are readable by their members" on public.friendships;
create policy "Friendships are readable by their members"
on public.friendships for select
to authenticated
using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);

revoke insert, update, delete on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

drop trigger if exists set_launcher_friendship_updated_at on public.friendships;
create trigger set_launcher_friendship_updated_at
before update on public.friendships
for each row execute function public.set_launcher_profile_updated_at();

create or replace function public.search_launcher_profiles(search_text text)
returns table (
  friendship_id uuid,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  presence_status text,
  relationship_status text,
  direction text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    friendships.id,
    profiles.id,
    profiles.display_name,
    profiles.username,
    profiles.avatar_url,
    profiles.presence_status,
    friendships.status,
    case
      when friendships.status = 'pending' and friendships.requested_by = auth.uid() then 'outgoing'
      when friendships.status = 'pending' then 'incoming'
      else null
    end
  from public.profiles as profiles
  left join public.friendships as friendships
    on (friendships.user_a = auth.uid() and friendships.user_b = profiles.id)
    or (friendships.user_b = auth.uid() and friendships.user_a = profiles.id)
  where auth.uid() is not null
    and profiles.id <> auth.uid()
    and length(trim(search_text)) >= 2
    and (
      position(lower(trim(search_text)) in lower(profiles.display_name)) > 0
      or position(lower(trim(leading '@' from search_text)) in lower(profiles.username)) > 0
    )
  order by
    case when lower(profiles.username) = lower(trim(leading '@' from search_text)) then 0 else 1 end,
    profiles.display_name
  limit 20;
$$;

create or replace function public.get_launcher_relationships()
returns table (
  friendship_id uuid,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  presence_status text,
  relationship_status text,
  direction text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    friendships.id,
    profiles.id,
    profiles.display_name,
    profiles.username,
    profiles.avatar_url,
    profiles.presence_status,
    friendships.status,
    case
      when friendships.status = 'pending' and friendships.requested_by = auth.uid() then 'outgoing'
      when friendships.status = 'pending' then 'incoming'
      else null
    end
  from public.friendships as friendships
  join public.profiles as profiles
    on profiles.id = case when friendships.user_a = auth.uid() then friendships.user_b else friendships.user_a end
  where auth.uid() is not null
    and (friendships.user_a = auth.uid() or friendships.user_b = auth.uid())
  order by friendships.status, profiles.display_name;
$$;

create or replace function public.send_launcher_friend_request(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  existing_request public.friendships;
begin
  if current_user_id is null then raise exception 'Authentification requise.'; end if;
  if target_user_id is null or target_user_id = current_user_id then raise exception 'Destinataire invalide.'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then raise exception 'Ce profil est introuvable.'; end if;

  first_user := least(current_user_id, target_user_id);
  second_user := greatest(current_user_id, target_user_id);

  select * into existing_request
  from public.friendships
  where user_a = first_user and user_b = second_user
  for update;

  if not found then
    insert into public.friendships (user_a, user_b, requested_by)
    values (first_user, second_user, current_user_id);
  elsif existing_request.status = 'pending' and existing_request.requested_by <> current_user_id then
    update public.friendships set status = 'accepted' where id = existing_request.id;
  end if;
end;
$$;

create or replace function public.respond_launcher_friend_request(friendship_id uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  pending_request public.friendships;
begin
  select * into pending_request
  from public.friendships
  where id = friendship_id
    and status = 'pending'
    and (user_a = current_user_id or user_b = current_user_id)
    and requested_by <> current_user_id
  for update;

  if not found then raise exception 'Cette demande n’est plus disponible.'; end if;
  if accept_request then
    update public.friendships set status = 'accepted' where id = friendship_id;
  else
    delete from public.friendships where id = friendship_id;
  end if;
end;
$$;

create or replace function public.remove_launcher_friend(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where (user_a = auth.uid() and user_b = target_user_id)
     or (user_b = auth.uid() and user_a = target_user_id);
end;
$$;

revoke all on function public.search_launcher_profiles(text) from public;
revoke all on function public.get_launcher_relationships() from public;
revoke all on function public.send_launcher_friend_request(uuid) from public;
revoke all on function public.respond_launcher_friend_request(uuid, boolean) from public;
revoke all on function public.remove_launcher_friend(uuid) from public;

grant execute on function public.search_launcher_profiles(text) to authenticated;
grant execute on function public.get_launcher_relationships() to authenticated;
grant execute on function public.send_launcher_friend_request(uuid) to authenticated;
grant execute on function public.respond_launcher_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_launcher_friend(uuid) to authenticated;
