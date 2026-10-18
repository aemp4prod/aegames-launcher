create table if not exists public.launcher_news_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  news_key text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, news_key),
  constraint launcher_news_reads_key_length check (char_length(news_key) between 1 and 180)
);

alter table public.launcher_news_reads enable row level security;

drop policy if exists "Players can read their news history" on public.launcher_news_reads;
create policy "Players can read their news history" on public.launcher_news_reads
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players can mark their news as read" on public.launcher_news_reads;
create policy "Players can mark their news as read" on public.launcher_news_reads
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Players can refresh their news history" on public.launcher_news_reads;
create policy "Players can refresh their news history" on public.launcher_news_reads
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on public.launcher_news_reads from anon;
grant select, insert, update on public.launcher_news_reads to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'launcher_news_reads'
  ) then
    alter publication supabase_realtime add table public.launcher_news_reads;
  end if;
end $$;
