-- Presence is now carried by a single Supabase Realtime Presence channel.
-- Keeping profile rows in the Postgres Changes publication made every legacy
-- heartbeat fan out to every connected launcher.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime drop table public.profiles;
  end if;
end $$;

-- Reduce writes from launchers that have not updated yet while keeping their
-- 70-second online timeout functional during the rollout.
create or replace function public.touch_launcher_presence()
returns void language sql security definer set search_path = '' as $$
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid()
    and last_seen_at < now() - interval '50 seconds';
$$;

revoke all on function public.touch_launcher_presence() from public;
grant execute on function public.touch_launcher_presence() to authenticated;
