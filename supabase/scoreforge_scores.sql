-- ScoreForge F-1. Review/apply after scoreforge_auth.sql; no other app objects changed.
-- Run as the database owner (normally postgres) so the private lookup can read scores.
begin;

-- Fail before changing anything if the existing auth integration is absent.
do $scoreforge_prerequisite$
begin
  if to_regprocedure('private.is_admin()') is null then
    raise exception 'Apply/review scoreforge_auth.sql first: private.is_admin() is required';
  end if;
  if to_regclass('public.scores') is not null and
     obj_description(to_regclass('public.scores'), 'pg_class') is distinct from
       'ScoreForge scores: owner CRUD, administrator read; no anonymous table access.' then
    raise exception 'An unrecognized public.scores table already exists; review ownership/schema before applying ScoreForge SQL';
  end if;
end;
$scoreforge_prerequisite$;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '제목 없음',
  data jsonb not null,
  measures integer not null default 0,
  is_public boolean not null default false,
  share_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scoreforge_scores_title_length check (char_length(title) between 1 and 200),
  constraint scoreforge_scores_data_object check (jsonb_typeof(data) = 'object'),
  constraint scoreforge_scores_data_size check (
    pg_column_size(data) < 2000000 and octet_length(data::text) < 2000000
  ),
  constraint scoreforge_scores_measures_nonnegative check (measures >= 0),
  constraint scoreforge_scores_share_slug_format check (
    share_slug is null or (octet_length(share_slug) = 12 and share_slug ~ '^[A-Za-z0-9_-]{12}$')
  ),
  constraint scoreforge_scores_public_has_slug check (not is_public or share_slug is not null)
);

create unique index if not exists scoreforge_scores_share_slug_key on public.scores(share_slug);
create index if not exists scoreforge_scores_owner_updated_idx on public.scores(owner, updated_at desc, id);

alter table public.scores enable row level security;

-- Object-scoped grants work with Supabase's 2026 explicit Data API exposure.
-- Do not broaden default privileges or touch profiles/lesson application grants.
revoke all on table public.scores from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, delete on table public.scores to authenticated;
grant insert (id, owner, title, data, measures, is_public, share_slug) on public.scores to authenticated;
grant update (title, data, measures, is_public, share_slug) on public.scores to authenticated;

-- Fail closed if an unrelated/older policy exists: permissive policies OR together.
-- Do not silently drop another application's policy on a colliding table name.
do $scoreforge_policy_scope$
begin
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'scores'
      and policyname not in ('scoreforge_scores_select', 'scoreforge_scores_insert',
                             'scoreforge_scores_update', 'scoreforge_scores_delete')
  ) then
    raise exception 'public.scores has unrecognized policies; review the table before applying ScoreForge SQL';
  end if;
end;
$scoreforge_policy_scope$;

drop policy if exists scoreforge_scores_select on public.scores;
create policy scoreforge_scores_select on public.scores for select to authenticated
using ((select auth.uid()) = owner or (select private.is_admin()));

drop policy if exists scoreforge_scores_insert on public.scores;
create policy scoreforge_scores_insert on public.scores for insert to authenticated
with check ((select auth.uid()) = owner);

drop policy if exists scoreforge_scores_update on public.scores;
create policy scoreforge_scores_update on public.scores for update to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

drop policy if exists scoreforge_scores_delete on public.scores;
create policy scoreforge_scores_delete on public.scores for delete to authenticated
using ((select auth.uid()) = owner);

create or replace function private.scoreforge_scores_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $scoreforge_touch$
begin
  -- Monotonic even for two updates in the same transaction/microsecond.
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$scoreforge_touch$;
revoke all on function private.scoreforge_scores_touch_updated_at() from public, anon, authenticated;

drop trigger if exists scoreforge_scores_updated_at on public.scores;
create trigger scoreforge_scores_updated_at before update on public.scores
for each row execute function private.scoreforge_scores_touch_updated_at();

-- A public view would expose all shared rows. Instead, this capability lookup
-- accepts ONE exact 12-character cryptorandom base64url slug, not a search filter.
-- Intentionally does not require auth.uid(): anonymous sharing is the feature.
-- Keep private OUT of the PostgREST exposed schemas. No dynamic SQL/search_path.
create or replace function private.scoreforge_lookup_shared_score(slug text)
returns table(title text, data jsonb)
language plpgsql stable security definer set search_path = ''
as $scoreforge_shared$
begin
  if slug is null or octet_length(slug) <> 12 or slug !~ '^[A-Za-z0-9_-]{12}$' then
    return;
  end if;
  return query
    select s.title, s.data
    from public.scores as s
    where s.is_public and s.share_slug = slug
    limit 1;
end;
$scoreforge_shared$;

-- SECURITY INVOKER keeps privilege escalation confined to the reviewed private
-- function. PostgreSQL still needs USAGE + EXECUTE for the invoker to call it.
create or replace function public.get_shared_score(slug text)
returns table(title text, data jsonb)
language sql stable security invoker set search_path = ''
as $scoreforge_public_shared$
  select shared.title, shared.data from private.scoreforge_lookup_shared_score(slug) as shared;
$scoreforge_public_shared$;

revoke all on function private.scoreforge_lookup_shared_score(text) from public, anon, authenticated;
revoke all on function public.get_shared_score(text) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.scoreforge_lookup_shared_score(text) to anon, authenticated;
grant execute on function public.get_shared_score(text) to anon, authenticated;

-- RLS controls rows entering the aggregate: owner sees self, admin sees all.
-- Exact server-side counts avoid the Data API's normal row-return limit.
create or replace function public.count_scoreforge_scores_by_owner(owner_ids uuid[])
returns table(owner uuid, score_count bigint)
language sql stable security invoker set search_path = ''
as $scoreforge_counts$
  select s.owner, count(*) from public.scores as s
  where cardinality(owner_ids) <= 100 and s.owner = any(owner_ids)
  group by s.owner;
$scoreforge_counts$;
revoke all on function public.count_scoreforge_scores_by_owner(uuid[]) from public, anon, authenticated;
grant execute on function public.count_scoreforge_scores_by_owner(uuid[]) to authenticated;

comment on function public.get_shared_score(text) is
  'ScoreForge public capability reader: exact 12-character random slug, shared rows only, returns title/data only.';
comment on table public.scores is 'ScoreForge scores: owner CRUD, administrator read; no anonymous table access.';

notify pgrst, 'reload schema';
commit;
