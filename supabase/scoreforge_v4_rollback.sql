-- ScoreForge v4 rollback (Phase 8-5): restores exactly what scoreforge_scores.sql (v3) created.
-- Run as the database owner (normally postgres). Safe to run more than once.
--
-- Undoes:
--   * the per-member quota trigger and its function (existing scores are never touched);
--   * the owner-only select policy  -> administrators can read every member's scores again (v3 behaviour);
--   * the private-definer count function -> public.count_scoreforge_scores_by_owner() is the v3 invoker query again.
-- Note: rolling back re-opens administrator read access to score content. Do it only if v4 breaks something,
-- and re-apply scoreforge_v4.sql as soon as it is fixed.
begin;

do $scoreforge_v4_rollback_prerequisite$
begin
  if to_regprocedure('private.is_admin()') is null then
    raise exception 'private.is_admin() is required (scoreforge_auth.sql)';
  end if;
  if to_regclass('public.scores') is null or
     obj_description(to_regclass('public.scores'), 'pg_class') is distinct from
       'ScoreForge scores: owner CRUD, administrator read; no anonymous table access.' then
    raise exception 'The ScoreForge public.scores table was not found; nothing to roll back';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'scores'
      and policyname not in ('scoreforge_scores_select', 'scoreforge_scores_insert',
                             'scoreforge_scores_update', 'scoreforge_scores_delete')
  ) then
    raise exception 'public.scores has unrecognized policies; review the table before changing ScoreForge SQL';
  end if;
end;
$scoreforge_v4_rollback_prerequisite$;

-- 1. Quota
drop trigger if exists scoreforge_scores_quota on public.scores;
drop function if exists private.scoreforge_enforce_quota();

-- 2. Administrator read policy (same expression as scoreforge_scores.sql)
drop policy if exists scoreforge_scores_select on public.scores;
create policy scoreforge_scores_select on public.scores for select to authenticated
using ((select auth.uid()) = owner or (select private.is_admin()));

-- 3. v3 count function (RLS decides which rows enter the aggregate: owner sees self, admin sees all)
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
comment on function public.count_scoreforge_scores_by_owner(uuid[]) is null;
drop function if exists private.scoreforge_count_by_owner(uuid[]);

notify pgrst, 'reload schema';
commit;
