-- Transactional integration test: no test accounts/scores survive rollback.
begin;
select set_config('scoreforge.test.owner', gen_random_uuid()::text, true);
select set_config('scoreforge.test.other', gen_random_uuid()::text, true);
select set_config('scoreforge.test.slug', left(replace(gen_random_uuid()::text, '-', ''), 12), true);
select set_config('scoreforge.test.admin', coalesce((select id::text from public.profiles where role='admin' limit 1), ''), true);
insert into auth.users(id,email,raw_user_meta_data) values
(current_setting('scoreforge.test.owner')::uuid,'sf-owner-' || current_setting('scoreforge.test.owner') || '@example.invalid','{"display_name":"ScoreForge transaction test"}'),
(current_setting('scoreforge.test.other')::uuid,'sf-other-' || current_setting('scoreforge.test.other') || '@example.invalid','{}');
insert into public.scores(owner,title,data,measures) values
(current_setting('scoreforge.test.other')::uuid,'other private','{"meta":{"title":"other"}}',1);

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
select set_config('request.jwt.claim.sub',current_setting('scoreforge.test.admin'),true);
set local role authenticated;
do $verify$
begin
  if current_setting('scoreforge.test.admin') <> '' and
    (select count(*) from public.scores where owner in(current_setting('scoreforge.test.owner')::uuid,current_setting('scoreforge.test.other')::uuid)) <> 2
  then raise exception 'Administrator read denied'; end if;
end;
$verify$;
reset role;
rollback;
select 'PASS: signup trigger, owner insert/read/update, cross-owner denial, anonymous capability, share revocation, administrator read; rolled back' as result;
