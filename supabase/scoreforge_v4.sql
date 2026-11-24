-- ScoreForge v4 (Phase 8-5). Review, then apply AFTER scoreforge_auth.sql and scoreforge_scores.sql.
-- Run as the database owner (normally postgres). Apply to a staging project first and run
-- supabase/tests/scores_rls.sql there; keep supabase/scoreforge_v4_rollback.sql ready.
--
-- What this changes (and nothing else; other applications' objects are not touched):
--   1. Per-member quota: at most 200 scores and 50 MiB of score JSON per owner.
--      Errors raised: SCOREFORGE_QUOTA_COUNT / SCOREFORGE_QUOTA_BYTES (the web app shows a friendly message).
--   2. Decision D4b = administrators may NOT read other members' score content:
--      the select policy becomes owner-only. Administrators can still see per-member COUNTS through
--      count_scoreforge_scores_by_owner(), which now uses the same "private definer + public invoker wrapper"
--      pattern as get_shared_score() (removing the admin read policy alone would break that aggregate).
--
-- Re-running this script is safe. Do NOT re-run scoreforge_scores.sql after this script without re-running
-- this script too: scoreforge_scores.sql re-creates the administrator read policy.
-- The public.scores table comment is intentionally left unchanged: scoreforge_scores.sql uses it as its
-- ownership marker. The objects created here carry their own "ScoreForge v4" comments instead.
begin;

-- Fail before changing anything if v3 is missing or the table looks like someone else's.
do $scoreforge_v4_prerequisite$
begin
  if to_regprocedure('private.is_admin()') is null then
    raise exception 'Apply scoreforge_auth.sql first: private.is_admin() is required';
  end if;
  if to_regclass('public.scores') is null or
     obj_description(to_regclass('public.scores'), 'pg_class') is distinct from
       'ScoreForge scores: owner CRUD, administrator read; no anonymous table access.' then
    raise exception 'Apply scoreforge_scores.sql first: the ScoreForge public.scores table was not found';
  end if;
  if to_regprocedure('public.count_scoreforge_scores_by_owner(uuid[])') is null or
     to_regprocedure('private.scoreforge_scores_touch_updated_at()') is null then
    raise exception 'Apply scoreforge_scores.sql first: ScoreForge scores functions are missing';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'scores'
      and policyname not in ('scoreforge_scores_select', 'scoreforge_scores_insert',
                             'scoreforge_scores_update', 'scoreforge_scores_delete')
  ) then
    raise exception 'public.scores has unrecognized policies; review the table before applying ScoreForge SQL';
  end if;
end;
$scoreforge_v4_prerequisite$;

-- 1. Per-member quota ---------------------------------------------------------------------------------
-- SECURITY DEFINER so the totals cover every row of the owner whatever the caller's RLS view is.
-- The advisory lock serializes one member's writes: without it two simultaneous inserts could both
-- see 199 rows and both pass. The two-key form keeps our keys apart from other apps' advisory locks.
-- Only inserts are counted against the 200-score limit; the 50 MiB limit uses the same measure as the
-- table's own size constraint (octet_length of the JSON text) over this owner's OTHER rows plus the new data.
-- Only "update of data" fires this trigger, so renaming or toggling sharing never hits the quota.
create or replace function private.scoreforge_enforce_quota()
returns trigger
language plpgsql security definer set search_path = ''
as $scoreforge_quota$
declare
  n bigint;
  bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtext('scoreforge.quota'), hashtext(new.owner::text));
  select count(*), coalesce(sum(octet_length(s.data::text)), 0) into n, bytes
    from public.scores as s
   where s.owner = new.owner and s.id <> new.id;
  if tg_op = 'INSERT' and n >= 200 then
    raise exception 'SCOREFORGE_QUOTA_COUNT';
  end if;
  if bytes + octet_length(new.data::text) > 50 * 1024 * 1024 then
    raise exception 'SCOREFORGE_QUOTA_BYTES';
  end if;
  return new;
end;
$scoreforge_quota$;
revoke all on function private.scoreforge_enforce_quota() from public, anon, authenticated;
comment on function private.scoreforge_enforce_quota() is
  'ScoreForge v4: per-member quota (200 scores, 50 MiB of score JSON). Errors SCOREFORGE_QUOTA_COUNT / SCOREFORGE_QUOTA_BYTES.';

drop trigger if exists scoreforge_scores_quota on public.scores;
create trigger scoreforge_scores_quota before insert or update of data on public.scores
for each row execute function private.scoreforge_enforce_quota();

-- 2. Administrators cannot read other members' scores (D4b = deny) -------------------------------------
drop policy if exists scoreforge_scores_select on public.scores;
create policy scoreforge_scores_select on public.scores for select to authenticated
using ((select auth.uid()) = owner);
comment on policy scoreforge_scores_select on public.scores is
  'ScoreForge v4: owner only. Administrators cannot read score content; they get per-member counts via count_scoreforge_scores_by_owner().';

-- Counts: an administrator may count any owner; everyone else only themselves. Never returns score content.
create or replace function private.scoreforge_count_by_owner(owner_ids uuid[])
returns table(owner uuid, score_count bigint)
language sql stable security definer set search_path = ''
as $scoreforge_count$
  select s.owner, count(*)
  from public.scores as s
  where cardinality(owner_ids) <= 100
    and s.owner = any(owner_ids)
    and ((select private.is_admin()) or s.owner = (select auth.uid()))
  group by s.owner;
$scoreforge_count$;

-- SECURITY INVOKER wrapper (same shape as get_shared_score): the caller still needs USAGE on schema
-- private (granted by scoreforge_scores.sql) and EXECUTE on the private function (granted below).
create or replace function public.count_scoreforge_scores_by_owner(owner_ids uuid[])
returns table(owner uuid, score_count bigint)
language sql stable security invoker set search_path = ''
as $scoreforge_counts$
  select counted.owner, counted.score_count from private.scoreforge_count_by_owner(owner_ids) as counted;
$scoreforge_counts$;

revoke all on function private.scoreforge_count_by_owner(uuid[]) from public, anon, authenticated;
revoke all on function public.count_scoreforge_scores_by_owner(uuid[]) from public, anon, authenticated;
grant execute on function private.scoreforge_count_by_owner(uuid[]) to authenticated;
grant execute on function public.count_scoreforge_scores_by_owner(uuid[]) to authenticated;
comment on function private.scoreforge_count_by_owner(uuid[]) is
  'ScoreForge v4: per-owner score counts. Administrators may count any owner (max 100 ids); members only themselves.';
comment on function public.count_scoreforge_scores_by_owner(uuid[]) is
  'ScoreForge v4: per-owner score counts (invoker wrapper around private.scoreforge_count_by_owner).';

notify pgrst, 'reload schema';
commit;
