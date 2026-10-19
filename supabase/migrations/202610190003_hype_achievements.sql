create extension if not exists pgcrypto with schema extensions;

create table if not exists public.achievement_definitions (
  id uuid primary key default gen_random_uuid(),
  game_key text not null,
  achievement_key text not null,
  title text not null,
  description text not null,
  icon_key text not null default 'trophy',
  progress_kind text not null default 'binary'
    check (progress_kind in ('binary', 'counter', 'high_watermark')),
  goal numeric(20, 4) not null default 1 check (goal > 0),
  max_increment numeric(20, 4) check (max_increment is null or max_increment > 0),
  points integer not null default 0 check (points >= 0),
  is_hidden boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_key, achievement_key),
  constraint achievement_definitions_game_key_format
    check (game_key ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  constraint achievement_definitions_key_format
    check (achievement_key ~ '^[a-z0-9][a-z0-9._-]{1,63}$')
);

create table if not exists public.game_players (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_key text not null,
  first_played_at timestamptz not null default now(),
  last_played_at timestamptz not null default now(),
  primary key (user_id, game_key)
);

create table if not exists public.achievement_game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_key text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint achievement_game_sessions_expiration check (expires_at > created_at)
);

create table if not exists public.user_achievement_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievement_definitions(id) on delete cascade,
  progress numeric(20, 4) not null default 0 check (progress >= 0),
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table if not exists public.achievement_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  session_id uuid not null references public.achievement_game_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_key text not null,
  achievement_id uuid not null references public.achievement_definitions(id) on delete cascade,
  operation text not null check (operation in ('unlock', 'increment', 'set')),
  event_value numeric(20, 4),
  progress_before numeric(20, 4),
  progress_after numeric(20, 4),
  newly_unlocked boolean not null default false,
  client_occurred_at timestamptz,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (game_key, user_id, event_id),
  constraint achievement_events_id_format
    check (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint achievement_events_metadata_object
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096)
);

create index if not exists achievement_definitions_game_order_idx
  on public.achievement_definitions (game_key, is_active, sort_order);
create index if not exists achievement_game_sessions_user_idx
  on public.achievement_game_sessions (user_id, game_key, expires_at desc);
create unique index if not exists achievement_game_sessions_one_active_idx
  on public.achievement_game_sessions (user_id, game_key)
  where revoked_at is null;
create index if not exists achievement_game_sessions_active_token_idx
  on public.achievement_game_sessions (token_hash)
  where revoked_at is null;
create index if not exists achievement_events_session_received_idx
  on public.achievement_events (session_id, received_at desc);
create index if not exists achievement_progress_unlocked_idx
  on public.user_achievement_progress (achievement_id, unlocked_at)
  where unlocked_at is not null;

alter table public.achievement_definitions enable row level security;
alter table public.game_players enable row level security;
alter table public.achievement_game_sessions enable row level security;
alter table public.user_achievement_progress enable row level security;
alter table public.achievement_events enable row level security;

drop policy if exists "Players can read their game records" on public.game_players;
create policy "Players can read their game records"
on public.game_players for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Players can read their achievement progress" on public.user_achievement_progress;
create policy "Players can read their achievement progress"
on public.user_achievement_progress for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.achievement_definitions from anon, authenticated;
revoke all on public.game_players from anon, authenticated;
revoke all on public.achievement_game_sessions from anon, authenticated;
revoke all on public.user_achievement_progress from anon, authenticated;
revoke all on public.achievement_events from anon, authenticated;
grant select on public.game_players to authenticated;
grant select on public.user_achievement_progress to authenticated;

drop trigger if exists set_achievement_definitions_updated_at on public.achievement_definitions;
create trigger set_achievement_definitions_updated_at
before update on public.achievement_definitions
for each row execute function public.set_launcher_profile_updated_at();

insert into public.achievement_definitions (
  game_key, achievement_key, title, description, icon_key,
  progress_kind, goal, max_increment, points, is_hidden, sort_order
) values
  ('hype', 'first-crush', 'Premier crush', 'Créer votre première vraie connexion', 'heart', 'binary', 1, null, 10, false, 10),
  ('hype', 'gaining-traction', 'Ça commence à prendre', 'Atteindre 1 000 abonnés', 'user-plus', 'high_watermark', 1000, null, 25, false, 20),
  ('hype', 'worldwide-trend', 'Tout le monde en parle', 'Lancer une tendance mondiale', 'globe', 'binary', 1, null, 100, true, 30)
on conflict (game_key, achievement_key) do update set
  title = excluded.title,
  description = excluded.description,
  icon_key = excluded.icon_key,
  progress_kind = excluded.progress_kind,
  goal = excluded.goal,
  max_increment = excluded.max_increment,
  points = excluded.points,
  is_hidden = excluded.is_hidden,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.create_hype_achievement_session(p_ttl_seconds integer default 21600)
returns table (session_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_token text;
  v_expires_at timestamptz;
  v_ttl_seconds integer;
begin
  if v_user_id is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  v_ttl_seconds := least(greatest(coalesce(p_ttl_seconds, 21600), 300), 28800);
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + make_interval(secs => v_ttl_seconds);

  update public.achievement_game_sessions
  set revoked_at = now()
  where user_id = v_user_id
    and game_key = 'hype'
    and revoked_at is null;

  insert into public.game_players (user_id, game_key, first_played_at, last_played_at)
  values (v_user_id, 'hype', now(), now())
  on conflict (user_id, game_key) do update
  set last_played_at = excluded.last_played_at;

  insert into public.achievement_game_sessions (
    user_id, game_key, token_hash, expires_at
  ) values (
    v_user_id,
    'hype',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expires_at
  );

  return query select v_token, v_expires_at;
end;
$$;

create or replace function public.revoke_hype_achievement_sessions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  update public.achievement_game_sessions
  set revoked_at = coalesce(revoked_at, now())
  where user_id = auth.uid()
    and game_key = 'hype'
    and revoked_at is null;
end;
$$;

create or replace function public.record_hype_achievement_event(
  p_session_token text,
  p_event_id text,
  p_achievement_key text,
  p_operation text,
  p_value numeric default null,
  p_client_occurred_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  achievement_key text,
  title text,
  progress numeric,
  goal numeric,
  unlocked_at timestamptz,
  newly_unlocked boolean,
  idempotent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.achievement_game_sessions%rowtype;
  v_definition public.achievement_definitions%rowtype;
  v_existing public.achievement_events%rowtype;
  v_progress public.user_achievement_progress%rowtype;
  v_event_db_id uuid;
  v_before numeric(20, 4);
  v_after numeric(20, 4);
  v_unlocked_at timestamptz;
  v_newly_unlocked boolean := false;
begin
  if p_session_token is null or p_session_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Session Hype invalide.' using errcode = '22023';
  end if;
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception 'event_id invalide.' using errcode = '22023';
  end if;
  if p_achievement_key is null or p_achievement_key !~ '^[a-z0-9][a-z0-9._-]{1,63}$' then
    raise exception 'achievement_key invalide.' using errcode = '22023';
  end if;
  if p_operation not in ('unlock', 'increment', 'set') then
    raise exception 'Opération de succès invalide.' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 4096 then
    raise exception 'metadata doit être un objet JSON de 4 Ko maximum.' using errcode = '22023';
  end if;

  select sessions.* into v_session
  from public.achievement_game_sessions as sessions
  where sessions.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and sessions.game_key = 'hype'
    and sessions.revoked_at is null
    and sessions.expires_at > now()
  for update;

  if not found then
    raise exception 'Session Hype expirée ou révoquée.' using errcode = '28000';
  end if;

  select definitions.* into v_definition
  from public.achievement_definitions as definitions
  where definitions.game_key = 'hype'
    and definitions.achievement_key = p_achievement_key
    and definitions.is_active;

  if not found then
    raise exception 'Succès Hype inconnu ou désactivé.' using errcode = '22023';
  end if;

  select events.* into v_existing
  from public.achievement_events as events
  where events.game_key = 'hype'
    and events.user_id = v_session.user_id
    and events.event_id = p_event_id;

  if found then
    if v_existing.achievement_id <> v_definition.id
      or v_existing.operation <> p_operation
      or v_existing.event_value is distinct from p_value then
      raise exception 'event_id déjà utilisé avec un contenu différent.' using errcode = '23505';
    end if;

    return query select
      v_definition.achievement_key,
      v_definition.title,
      v_existing.progress_after,
      v_definition.goal,
      case when v_existing.progress_after >= v_definition.goal
        then (select user_progress.unlocked_at from public.user_achievement_progress as user_progress
              where user_progress.user_id = v_session.user_id
                and user_progress.achievement_id = v_definition.id)
        else null end,
      false,
      true;
    return;
  end if;

  if (select count(*) from public.achievement_events as recent_events
      where recent_events.session_id = v_session.id
        and recent_events.received_at >= now() - interval '1 minute') >= 120 then
    raise exception 'Trop d’événements de succès. Réessayez dans une minute.' using errcode = 'P0001';
  end if;

  if p_operation = 'unlock' then
    if p_value is not null then
      raise exception 'unlock ne prend pas de valeur.' using errcode = '22023';
    end if;
  elsif p_value is null or p_value < 0 then
    raise exception 'Une valeur positive ou nulle est requise.' using errcode = '22023';
  elsif p_operation = 'increment' and p_value = 0 then
    raise exception 'increment requiert une valeur strictement positive.' using errcode = '22023';
  elsif p_operation = 'increment'
    and v_definition.max_increment is not null
    and p_value > v_definition.max_increment then
    raise exception 'Incrément supérieur à la limite du succès.' using errcode = '22023';
  elsif v_definition.progress_kind = 'binary' then
    raise exception 'Ce succès binaire accepte uniquement unlock.' using errcode = '22023';
  end if;

  insert into public.achievement_events (
    event_id, session_id, user_id, game_key, achievement_id,
    operation, event_value, client_occurred_at, metadata
  ) values (
    p_event_id, v_session.id, v_session.user_id, 'hype', v_definition.id,
    p_operation, p_value, p_client_occurred_at, p_metadata
  )
  on conflict (game_key, user_id, event_id) do nothing
  returning id into v_event_db_id;

  if v_event_db_id is null then
    select events.* into v_existing
    from public.achievement_events as events
    where events.game_key = 'hype'
      and events.user_id = v_session.user_id
      and events.event_id = p_event_id;

    if v_existing.achievement_id <> v_definition.id
      or v_existing.operation <> p_operation
      or v_existing.event_value is distinct from p_value then
      raise exception 'event_id déjà utilisé avec un contenu différent.' using errcode = '23505';
    end if;

    return query select
      v_definition.achievement_key,
      v_definition.title,
      v_existing.progress_after,
      v_definition.goal,
      case when v_existing.progress_after >= v_definition.goal
        then (select user_progress.unlocked_at from public.user_achievement_progress as user_progress
              where user_progress.user_id = v_session.user_id
                and user_progress.achievement_id = v_definition.id)
        else null end,
      false,
      true;
    return;
  end if;

  insert into public.user_achievement_progress (user_id, achievement_id)
  values (v_session.user_id, v_definition.id)
  on conflict (user_id, achievement_id) do nothing;

  select user_progress.* into v_progress
  from public.user_achievement_progress as user_progress
  where user_progress.user_id = v_session.user_id
    and user_progress.achievement_id = v_definition.id
  for update;

  v_before := v_progress.progress;
  v_after := case p_operation
    when 'unlock' then v_definition.goal
    when 'increment' then least(v_definition.goal, v_before + p_value)
    when 'set' then least(v_definition.goal, greatest(v_before, p_value))
  end;
  v_newly_unlocked := v_progress.unlocked_at is null and v_after >= v_definition.goal;
  v_unlocked_at := case when v_newly_unlocked then now() else v_progress.unlocked_at end;

  update public.user_achievement_progress as user_progress
  set progress = v_after,
      unlocked_at = v_unlocked_at,
      updated_at = now()
  where user_progress.user_id = v_session.user_id
    and user_progress.achievement_id = v_definition.id;

  update public.achievement_events as events
  set progress_before = v_before,
      progress_after = v_after,
      newly_unlocked = v_newly_unlocked
  where events.id = v_event_db_id;

  update public.achievement_game_sessions as sessions
  set last_used_at = now()
  where sessions.id = v_session.id;

  update public.game_players as players
  set last_played_at = now()
  where players.user_id = v_session.user_id
    and players.game_key = 'hype';

  return query select
    v_definition.achievement_key,
    v_definition.title,
    v_after,
    v_definition.goal,
    v_unlocked_at,
    v_newly_unlocked,
    false;
end;
$$;

create or replace function public.get_my_hype_achievements()
returns table (
  achievement_key text,
  title text,
  description text,
  icon_key text,
  progress_kind text,
  progress numeric,
  goal numeric,
  progress_percent numeric,
  points integer,
  is_hidden boolean,
  unlocked_at timestamptz,
  rarity_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with totals as (
    select count(*)::numeric as player_count
    from public.game_players
    where game_key = 'hype'
  ), unlock_counts as (
    select progress.achievement_id, count(*)::numeric as unlock_count
    from public.user_achievement_progress as progress
    where progress.unlocked_at is not null
    group by progress.achievement_id
  )
  select
    definitions.achievement_key,
    case when definitions.is_hidden and progress.unlocked_at is null then 'Succès secret' else definitions.title end,
    case when definitions.is_hidden and progress.unlocked_at is null then 'Continuez à jouer pour révéler ce succès.' else definitions.description end,
    case when definitions.is_hidden and progress.unlocked_at is null then 'lock' else definitions.icon_key end,
    definitions.progress_kind,
    coalesce(progress.progress, 0),
    definitions.goal,
    round(least(100, coalesce(progress.progress, 0) * 100 / definitions.goal), 1),
    definitions.points,
    definitions.is_hidden,
    progress.unlocked_at,
    round(coalesce(unlock_counts.unlock_count * 100 / nullif(totals.player_count, 0), 0), 1)
  from public.achievement_definitions as definitions
  cross join totals
  left join public.user_achievement_progress as progress
    on progress.achievement_id = definitions.id
    and progress.user_id = auth.uid()
  left join unlock_counts on unlock_counts.achievement_id = definitions.id
  where auth.uid() is not null
    and definitions.game_key = 'hype'
    and definitions.is_active
  order by definitions.sort_order, definitions.created_at;
$$;

create or replace function public.get_profile_hype_achievements(p_target_user_id uuid)
returns table (
  achievement_key text,
  title text,
  description text,
  icon_key text,
  points integer,
  unlocked_at timestamptz,
  rarity_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with totals as (
    select count(*)::numeric as player_count
    from public.game_players
    where game_key = 'hype'
  ), unlock_counts as (
    select achievement_id, count(*)::numeric as unlock_count
    from public.user_achievement_progress
    where unlocked_at is not null
    group by achievement_id
  )
  select definitions.achievement_key, definitions.title, definitions.description,
    definitions.icon_key, definitions.points, progress.unlocked_at,
    round(coalesce(unlock_counts.unlock_count * 100 / nullif(totals.player_count, 0), 0), 1)
  from public.user_achievement_progress as progress
  join public.achievement_definitions as definitions on definitions.id = progress.achievement_id
  cross join totals
  left join unlock_counts on unlock_counts.achievement_id = definitions.id
  where auth.uid() is not null
    and progress.user_id = p_target_user_id
    and progress.unlocked_at is not null
    and definitions.game_key = 'hype'
    and definitions.is_active
    and not exists (
      select 1 from public.profile_blocks as blocks
      where (blocks.blocker_id = auth.uid() and blocks.blocked_id = p_target_user_id)
         or (blocks.blocker_id = p_target_user_id and blocks.blocked_id = auth.uid())
    )
  order by progress.unlocked_at desc;
$$;

revoke all on function public.create_hype_achievement_session(integer) from public;
revoke all on function public.revoke_hype_achievement_sessions() from public;
revoke all on function public.record_hype_achievement_event(text, text, text, text, numeric, timestamptz, jsonb) from public;
revoke all on function public.get_my_hype_achievements() from public;
revoke all on function public.get_profile_hype_achievements(uuid) from public;

grant execute on function public.create_hype_achievement_session(integer) to authenticated;
grant execute on function public.revoke_hype_achievement_sessions() to authenticated;
grant execute on function public.record_hype_achievement_event(text, text, text, text, numeric, timestamptz, jsonb) to anon, authenticated;
grant execute on function public.get_my_hype_achievements() to authenticated;
grant execute on function public.get_profile_hype_achievements(uuid) to authenticated;

alter table public.user_achievement_progress replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_achievement_progress'
  ) then
    alter publication supabase_realtime add table public.user_achievement_progress;
  end if;
end;
$$;
