-- Transactional integration test for the ScoreForge scores schema AFTER scoreforge_v4.sql:
-- owner CRUD, cross-owner denial, anonymous share capability, administrators cannot read other members' scores
-- (counts only), per-member quotas. No test account or score survives: the script ends with ROLLBACK.
-- Run it in a staging project first. The quota section inserts about 100 MB of throwaway rows inside the
-- transaction, so expect a few seconds.
begin;
select set_config('scoreforge.test.owner', gen_random_uuid()::text, true);
select set_config('scoreforge.test.other', gen_random_uuid()::text, true);
select set_config('scoreforge.test.slug', left(replace(gen_random_uuid()::text, '-', ''), 12), true);
insert into auth.users(id,email,raw_user_meta_data) values
(current_setting('scoreforge.test.owner')::uuid,'sf-owner-' || current_setting('scoreforge.test.owner') || '@example.invalid','{"display_name":"ScoreForge transaction test"}'),
(current_setting('scoreforge.test.other')::uuid,'sf-other-' || current_setting('scoreforge.test.other') || '@example.invalid','{}');
insert into public.scores(owner,title,data,measures) values
(current_setting('scoreforge.test.other')::uuid,'other private','{"meta":{"title":"other"}}',1),
(current_setting('scoreforge.test.other')::uuid,'other private 2','{"meta":{"title":"other 2"}}',1);

select set_config('request.jwt.claim.sub', current_setting('scoreforge.test.owner'), true);
set local role authenticated;
insert into public.scores(owner,title,data,measures,is_public,share_slug) values
(current_setting('scoreforge.test.owner')::uuid,'owner shared','{"meta":{"title":"owner"}}',1,true,current_setting('scoreforge.test.slug'));
do $verify$
declare affected integer;
begin
  if (select count(*) from public.scores where owner=current_setting('scoreforge.test.owner')::uuid) <> 1 then raise exception 'Owner cannot read own score'; end if;
  if exists(select 1 from public.scores where owner=current_setting('scoreforge.test.other')::uuid) then raise exception 'Other owner data visible'; end if;
  update public.scores set title='updated own' where owner=current_setting('scoreforge.test.owner')::uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner update denied'; end if;
  update public.scores set title='not permitted' where owner=current_setting('scoreforge.test.other')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Other owner update allowed'; end if;
  delete from public.scores where owner=current_setting('scoreforge.test.other')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Other owner delete allowed'; end if;
  begin
    update public.scores set owner=current_setting('scoreforge.test.other')::uuid;
    raise exception 'Owner reassignment allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.scores(owner,title,data) values(current_setting('scoreforge.test.other')::uuid,'forged','{}');
    raise exception 'Forged owner insertion allowed';
  exception when insufficient_privilege then null; end;
end;
$verify$;
reset role;
set local role anon;
do $verify$
begin
  if (select count(*) from public.get_shared_score(current_setting('scoreforge.test.slug'))) <> 1 then raise exception 'Anonymous shared lookup failed'; end if;
  if (select count(*) from public.get_shared_score('invalid!')) <> 0 then raise exception 'Invalid slug accepted'; end if;
  if (select count(*) from public.get_shared_score('____________')) <> 0 then raise exception 'Unknown slug leaked score'; end if;
  begin
    perform id from public.scores;
    raise exception 'Anonymous direct table access allowed';
  exception when insufficient_privilege then null; end;
end;
$verify$;
reset role;
update public.scores set is_public=false,share_slug=null where owner=current_setting('scoreforge.test.owner')::uuid;
set local role anon;
do $verify$
begin
  if exists(select 1 from public.get_shared_score(current_setting('scoreforge.test.slug'))) then raise exception 'Revoked share is still public'; end if;
end;
$verify$;
reset role;

-- ---- D4b: administrators cannot read other members' score content (scoreforge_v4.sql) ---------------------
-- The test administrator is created inside this transaction, so no real administrator is needed and nothing survives.
select set_config('scoreforge.test.admin', gen_random_uuid()::text, true);
insert into auth.users(id,email,raw_user_meta_data) values
(current_setting('scoreforge.test.admin')::uuid,'sf-admin-' || current_setting('scoreforge.test.admin') || '@example.invalid','{}');
update public.profiles set role='admin' where id=current_setting('scoreforge.test.admin')::uuid;
insert into public.scores(owner,title,data,measures) values
(current_setting('scoreforge.test.admin')::uuid,'admin own','{"meta":{"title":"admin"}}',1);

select set_config('request.jwt.claim.sub',current_setting('scoreforge.test.admin'),true);
set local role authenticated;
do $verify$
declare affected integer;
begin
  if not (select private.is_admin()) then raise exception 'Test administrator is not recognized'; end if;
  if exists(select 1 from public.scores where owner in(current_setting('scoreforge.test.owner')::uuid,current_setting('scoreforge.test.other')::uuid))
  then raise exception 'Administrator can read other members'' scores'; end if;
  if (select count(*) from public.scores) <> 1 then raise exception 'Administrator should see only their own score'; end if;
  update public.scores set title='admin edit' where owner=current_setting('scoreforge.test.other')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Administrator updated another member''s score'; end if;
  delete from public.scores where owner=current_setting('scoreforge.test.other')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Administrator deleted another member''s score'; end if;
  -- the aggregate still works for administrators: counts for any owner, never content
  if (select coalesce(jsonb_object_agg(c.owner::text, c.score_count), '{}'::jsonb)
        from public.count_scoreforge_scores_by_owner(array[current_setting('scoreforge.test.owner')::uuid,
          current_setting('scoreforge.test.other')::uuid, current_setting('scoreforge.test.admin')::uuid]) as c)
     <> jsonb_build_object(current_setting('scoreforge.test.owner'), 1, current_setting('scoreforge.test.other'), 2,
          current_setting('scoreforge.test.admin'), 1)
  then raise exception 'Administrator aggregate counts are wrong'; end if;
  -- 100 ids are allowed, 101 are not
  if (select count(*) from public.count_scoreforge_scores_by_owner(
        array_append(array(select gen_random_uuid() from generate_series(1,99)), current_setting('scoreforge.test.other')::uuid))) <> 1
  then raise exception 'Aggregate with 100 ids should work'; end if;
  if exists(select 1 from public.count_scoreforge_scores_by_owner(
        array_append(array(select gen_random_uuid() from generate_series(1,100)), current_setting('scoreforge.test.other')::uuid)))
  then raise exception 'Aggregate with 101 ids must return nothing'; end if;
end;
$verify$;
reset role;

-- ordinary members: the aggregate counts only their own scores
select set_config('request.jwt.claim.sub',current_setting('scoreforge.test.owner'),true);
set local role authenticated;
do $verify$
begin
  if (select coalesce(jsonb_object_agg(c.owner::text, c.score_count), '{}'::jsonb)
        from public.count_scoreforge_scores_by_owner(array[current_setting('scoreforge.test.owner')::uuid,
          current_setting('scoreforge.test.other')::uuid, current_setting('scoreforge.test.admin')::uuid]) as c)
     <> jsonb_build_object(current_setting('scoreforge.test.owner'), 1)
  then raise exception 'Member aggregate must count only their own scores'; end if;
  if exists(select 1 from public.count_scoreforge_scores_by_owner(array[current_setting('scoreforge.test.other')::uuid]))
  then raise exception 'Member counted another member'; end if;
  if exists(select 1 from private.scoreforge_count_by_owner(array[current_setting('scoreforge.test.other')::uuid]))
  then raise exception 'Member counted another member through the private function'; end if;
end;
$verify$;
reset role;

-- anonymous callers have no access to either counting function
set local role anon;
do $verify$
begin
  begin
    perform * from public.count_scoreforge_scores_by_owner(array[gen_random_uuid()]);
    raise exception 'Anonymous count allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from private.scoreforge_count_by_owner(array[gen_random_uuid()]);
    raise exception 'Anonymous private count allowed';
  exception when insufficient_privilege then null; end;
end;
$verify$;
reset role;

-- catalog expectations: privileges, definer/invoker, fixed search_path, policy shape
do $verify$
begin
  if has_function_privilege('anon','public.count_scoreforge_scores_by_owner(uuid[])','EXECUTE') then raise exception 'anon may execute the count wrapper'; end if;
  if not has_function_privilege('authenticated','public.count_scoreforge_scores_by_owner(uuid[])','EXECUTE') then raise exception 'authenticated cannot execute the count wrapper'; end if;
  if has_function_privilege('anon','private.scoreforge_count_by_owner(uuid[])','EXECUTE') then raise exception 'anon may execute the private count function'; end if;
  if not has_function_privilege('authenticated','private.scoreforge_count_by_owner(uuid[])','EXECUTE') then raise exception 'authenticated cannot execute the private count function'; end if;
  if has_function_privilege('anon','private.scoreforge_enforce_quota()','EXECUTE')
     or has_function_privilege('authenticated','private.scoreforge_enforce_quota()','EXECUTE')
  then raise exception 'The quota trigger function must not be executable by API roles'; end if;
  if not (select prosecdef from pg_catalog.pg_proc where oid = 'private.scoreforge_enforce_quota()'::regprocedure) then raise exception 'quota function must be security definer'; end if;
  if not (select prosecdef from pg_catalog.pg_proc where oid = 'private.scoreforge_count_by_owner(uuid[])'::regprocedure) then raise exception 'private count function must be security definer'; end if;
  if (select prosecdef from pg_catalog.pg_proc where oid = 'public.count_scoreforge_scores_by_owner(uuid[])'::regprocedure) then raise exception 'public count wrapper must be security invoker'; end if;
  if exists(select 1 from pg_catalog.pg_proc where oid in ('private.scoreforge_enforce_quota()'::regprocedure,
        'private.scoreforge_count_by_owner(uuid[])'::regprocedure, 'public.count_scoreforge_scores_by_owner(uuid[])'::regprocedure)
        and proconfig is distinct from array['search_path=""'])
  then raise exception 'search_path must be empty for every v4 function'; end if;
  if (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='scores') <> 4 then raise exception 'Expected exactly four ScoreForge policies'; end if;
  if exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='scores' and roles <> array['authenticated']::name[]) then raise exception 'Every policy must be TO authenticated only'; end if;
  if position('is_admin' in (select qual from pg_catalog.pg_policies where schemaname='public' and tablename='scores' and policyname='scoreforge_scores_select')) <> 0
  then raise exception 'The select policy still mentions the administrator check'; end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.scores'::regclass and tgname='scoreforge_scores_quota' and not tgisinternal) then raise exception 'Quota trigger is missing'; end if;
end;
$verify$;

-- ---- Quota 1: 200 scores per member --------------------------------------------------------------------
select set_config('scoreforge.test.quota', gen_random_uuid()::text, true);
insert into auth.users(id,email,raw_user_meta_data) values
(current_setting('scoreforge.test.quota')::uuid,'sf-quota-' || current_setting('scoreforge.test.quota') || '@example.invalid','{}');
insert into public.scores(owner,title,data,measures)
select current_setting('scoreforge.test.quota')::uuid,'quota ' || g,'{"meta":{"title":"q"}}',1 from generate_series(1,199) as g;
select set_config('request.jwt.claim.sub',current_setting('scoreforge.test.quota'),true);
set local role authenticated;
do $verify$
declare affected integer;
begin
  insert into public.scores(owner,title,data,measures) values(current_setting('scoreforge.test.quota')::uuid,'quota 200','{"meta":{"title":"q"}}',1);
  begin
    insert into public.scores(owner,title,data,measures) values(current_setting('scoreforge.test.quota')::uuid,'quota 201','{"meta":{"title":"q"}}',1);
    raise exception 'Count quota not enforced: the 201st score was accepted';
  exception when raise_exception then
    if sqlerrm <> 'SCOREFORGE_QUOTA_COUNT' then raise; end if;
  end;
  -- at the limit, editing, renaming and sharing existing scores still work
  update public.scores set data='{"meta":{"title":"edited"}}' where owner=current_setting('scoreforge.test.quota')::uuid and title='quota 1';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Editing a score at the count limit was blocked'; end if;
  update public.scores set title='renamed' where owner=current_setting('scoreforge.test.quota')::uuid and title='quota 2';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Renaming a score at the count limit was blocked'; end if;
  -- deleting one frees a slot; another member's scores never count against this member
  delete from public.scores where owner=current_setting('scoreforge.test.quota')::uuid and title='quota 200';
  insert into public.scores(owner,title,data,measures) values(current_setting('scoreforge.test.quota')::uuid,'quota again','{"meta":{"title":"q"}}',1);
end;
$verify$;
reset role;

-- ---- Quota 2: 50 MiB of score JSON per member -----------------------------------------------------------
-- Rows are built to hit the limit to the exact byte: the JSON text of {"p": "<k characters>"} is k + 9 bytes.
select set_config('scoreforge.test.bytes', gen_random_uuid()::text, true);
insert into auth.users(id,email,raw_user_meta_data) values
(current_setting('scoreforge.test.bytes')::uuid,'sf-bytes-' || current_setting('scoreforge.test.bytes') || '@example.invalid','{}');
do $setup$
declare
  uid uuid := current_setting('scoreforge.test.bytes')::uuid;
  pad integer := 1900000;
  row_bytes bigint := octet_length(jsonb_build_object('p', repeat('x', 1900000))::text);
  max_bytes bigint := 50 * 1024 * 1024;
  full_rows integer := (50 * 1024 * 1024) / octet_length(jsonb_build_object('p', repeat('x', 1900000))::text);
  rest bigint;
begin
  rest := max_bytes - full_rows * row_bytes;
  for i in 1..full_rows loop
    insert into public.scores(owner,title,data,measures) values(uid,'big ' || i,jsonb_build_object('p', repeat('x', pad)),1);
  end loop;
  insert into public.scores(owner,title,data,measures) values(uid,'exact fit',jsonb_build_object('p', repeat('x', (rest - 9)::integer)),1);
  if (select sum(octet_length(s.data::text)) from public.scores as s where s.owner = uid) <> max_bytes then
    raise exception 'Test setup: expected exactly 50 MiB of data';
  end if;
end;
$setup$;
select set_config('request.jwt.claim.sub',current_setting('scoreforge.test.bytes'),true);
set local role authenticated;
do $verify$
declare
  uid uuid := current_setting('scoreforge.test.bytes')::uuid;
  fit integer := (select octet_length(s.data::text) - 9 from public.scores as s where s.owner = uid and s.title = 'exact fit');
  affected integer;
begin
  -- exactly 50 MiB is allowed (set up above); even a 2-byte score is one step too many
  begin
    insert into public.scores(owner,title,data,measures) values(uid,'one too many','{}',1);
    raise exception 'Byte quota not enforced: a new score was accepted at exactly 50 MiB';
  exception when raise_exception then
    if sqlerrm <> 'SCOREFORGE_QUOTA_BYTES' then raise; end if;
  end;
  -- growing the last score by one byte is rejected; the same size or smaller is fine
  begin
    update public.scores set data=jsonb_build_object('p', repeat('y', fit + 1)) where owner=uid and title='exact fit';
    raise exception 'Byte quota not enforced: an update beyond 50 MiB was accepted';
  exception when raise_exception then
    if sqlerrm <> 'SCOREFORGE_QUOTA_BYTES' then raise; end if;
  end;
  update public.scores set data=jsonb_build_object('p', repeat('y', fit)) where owner=uid and title='exact fit';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Same-size update at the byte limit was blocked'; end if;
  update public.scores set data=jsonb_build_object('p', repeat('y', fit - 1000)) where owner=uid and title='exact fit';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Shrinking update at the byte limit was blocked'; end if;
  -- renaming and sharing do not touch data, so they never hit the quota
  update public.scores set title='renamed big' where owner=uid and title='big 1';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Renaming at the byte limit was blocked'; end if;
  update public.scores set is_public=true, share_slug='AbCdEfGhIjKl' where owner=uid and title='big 2';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Sharing at the byte limit was blocked'; end if;
  -- shrinking left 1000 bytes of room: a score that fits is accepted, one byte more is not
  insert into public.scores(owner,title,data,measures) values(uid,'fills the gap',jsonb_build_object('p', repeat('z', 1000 - 9)),1);
  begin
    insert into public.scores(owner,title,data,measures) values(uid,'one byte over','{}',1);
    raise exception 'Byte quota not enforced after refilling';
  exception when raise_exception then
    if sqlerrm <> 'SCOREFORGE_QUOTA_BYTES' then raise; end if;
  end;
end;
$verify$;
reset role;
rollback;
select 'PASS: signup trigger, owner insert/read/update, cross-owner denial, anonymous capability, share revocation, administrators cannot read other members'' scores (counts only), 200-score and 50 MiB quotas; rolled back' as result;
