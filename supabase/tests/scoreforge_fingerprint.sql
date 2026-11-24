-- Read-only catalog fingerprint of the ScoreForge scores objects (policies, triggers, functions, privileges,
-- comments). Run it on staging and production after applying a SQL file and compare the md5: identical md5 means
-- identical definitions. It only reads system catalogs; it changes nothing and is safe to run anywhere.
with
fn as (
  select p.oid, n.nspname, p.proname, p.proowner, p.proacl, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and ((n.nspname = 'private' and p.proname like 'scoreforge\_%' escape '\')
      or (n.nspname = 'public' and p.proname in ('get_shared_score', 'count_scoreforge_scores_by_owner')))
),
tbl as (select c.oid, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity from pg_catalog.pg_class as c where c.oid = to_regclass('public.scores')),
lines as (
  select 'fn ' || nspname || '.' || proname || '(' || args || ') def=' || md5(pg_catalog.pg_get_functiondef(oid))
         || ' comment=' || coalesce(obj_description(oid, 'pg_proc'), '-') as line from fn
  union all
  select 'fnacl ' || f.nspname || '.' || f.proname || '(' || f.args || ') ' ||
         coalesce((select string_agg(coalesce(r.rolname, 'public') || ':' || a.privilege_type, ',' order by coalesce(r.rolname, 'public'), a.privilege_type)
                     from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) as a
                     left join pg_catalog.pg_roles as r on r.oid = a.grantee), '-')
    from fn as f
  union all
  select 'policy ' || pol.polname || ' cmd=' || pol.polcmd::text || ' roles=' ||
         coalesce((select string_agg(coalesce(r.rolname, 'public'), ',' order by coalesce(r.rolname, 'public'))
                     from unnest(pol.polroles) as pr(oid) left join pg_catalog.pg_roles as r on r.oid = pr.oid), '-') ||
         ' using=' || coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '-') ||
         ' check=' || coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '-') ||
         ' comment=' || coalesce(obj_description(pol.oid, 'pg_policy'), '-')
    from pg_catalog.pg_policy as pol where pol.polrelid = to_regclass('public.scores')
  union all
  select 'trigger ' || t.tgname || ' enabled=' || t.tgenabled::text || ' ' || pg_catalog.pg_get_triggerdef(t.oid)
    from pg_catalog.pg_trigger as t where t.tgrelid = to_regclass('public.scores') and not t.tgisinternal
  union all
  select 'table rls=' || relrowsecurity || ' force=' || relforcerowsecurity || ' comment=' || coalesce(obj_description(oid, 'pg_class'), '-') from tbl
  union all
  select 'tableacl ' || coalesce((select string_agg(coalesce(r.rolname, 'public') || ':' || a.privilege_type, ',' order by coalesce(r.rolname, 'public'), a.privilege_type)
                                    from aclexplode(coalesce(tbl.relacl, acldefault('r', tbl.relowner))) as a
                                    left join pg_catalog.pg_roles as r on r.oid = a.grantee), '-') from tbl
  union all
  select 'colacl ' || att.attname || ' ' ||
         (select string_agg(coalesce(r.rolname, 'public') || ':' || a.privilege_type, ',' order by coalesce(r.rolname, 'public'), a.privilege_type)
            from aclexplode(att.attacl) as a left join pg_catalog.pg_roles as r on r.oid = a.grantee)
    from pg_catalog.pg_attribute as att
   where att.attrelid = to_regclass('public.scores') and att.attnum > 0 and not att.attisdropped and att.attacl is not null
)
select md5(string_agg(line, E'\n' order by line)) as fingerprint, string_agg(line, E'\n' order by line) as detail from lines;
