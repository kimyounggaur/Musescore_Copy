-- Read-only fingerprint of everything in schemas public/private that ScoreForge v4 does NOT own: other tables
-- (including profiles), their policies and privileges, every other function, and triggers on other tables
-- (including the auth.users sign-up trigger). Run it on the shared project BEFORE and AFTER applying
-- scoreforge_v4.sql (and after a rollback): the md5 must be identical, which shows the lesson app is untouched.
-- It only reads system catalogs; it changes nothing and is safe to run on production.
with
tbl as (
  select c.oid, c.relname, n.nspname, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity, c.relkind
  from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and c.oid <> coalesce(to_regclass('public.scores'), 0::oid)
),
fn as (
  select p.oid, n.nspname, p.proname, p.proowner, p.proacl, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p') and n.nspname in ('public', 'private')
    and not (n.nspname = 'private' and p.proname in ('scoreforge_enforce_quota', 'scoreforge_count_by_owner'))
    and not (n.nspname = 'public' and p.proname = 'count_scoreforge_scores_by_owner')
),
lines as (
  select 'table ' || nspname || '.' || relname || ' kind=' || relkind::text || ' rls=' || relrowsecurity || ' force=' || relforcerowsecurity ||
         ' cols=' || coalesce((select md5(string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum))
                                 from pg_catalog.pg_attribute as a where a.attrelid = tbl.oid and a.attnum > 0 and not a.attisdropped), '-') ||
         ' acl=' || coalesce((select string_agg(coalesce(r.rolname, 'public') || ':' || x.privilege_type, ',' order by coalesce(r.rolname, 'public'), x.privilege_type)
                                from aclexplode(coalesce(tbl.relacl, acldefault('r', tbl.relowner))) as x
                                left join pg_catalog.pg_roles as r on r.oid = x.grantee), '-') as line
    from tbl
  union all
  select 'policy ' || pol.polrelid::regclass::text || '.' || pol.polname || ' cmd=' || pol.polcmd::text ||
         ' using=' || coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '-') ||
         ' check=' || coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '-')
    from pg_catalog.pg_policy as pol join tbl on tbl.oid = pol.polrelid
  union all
  select 'fn ' || nspname || '.' || proname || '(' || args || ') def=' || md5(pg_catalog.pg_get_functiondef(oid)) ||
         ' acl=' || coalesce((select string_agg(coalesce(r.rolname, 'public') || ':' || x.privilege_type, ',' order by coalesce(r.rolname, 'public'), x.privilege_type)
                                from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) as x
                                left join pg_catalog.pg_roles as r on r.oid = x.grantee), '-')
    from fn
  union all
  select 'trigger ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' enabled=' || t.tgenabled::text || ' fn=' || t.tgfoid::regproc::text
    from pg_catalog.pg_trigger as t
   where not t.tgisinternal and t.tgrelid <> coalesce(to_regclass('public.scores'), 0::oid)
     and (t.tgrelid in (select oid from tbl) or t.tgrelid = coalesce(to_regclass('auth.users'), 0::oid))
)
select md5(coalesce(string_agg(line, E'\n' order by line), '')) as fingerprint, string_agg(line, E'\n' order by line) as detail from lines;
