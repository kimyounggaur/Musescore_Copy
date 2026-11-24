-- ScoreForge v4 한도 트리거의 비용 측정 — 스테이징(또는 새 프로젝트)에서만 실행하세요. 운영 DB에서는 실행하지 마세요.
--
-- 회원 한 명이 악보 200개(행당 249,000자, 합계 약 50MB = 한도 직전)를 가진 "최악의 경우"에
-- 마지막 저장(INSERT)·data 고쳐 쓰기(UPDATE)·이름만 바꾸기가 얼마나 걸리는지 잰다. 저장마다 그 회원의 모든 행 크기를 합산하기 때문이다.
--
-- 사용법: scoreforge_v4.sql을 적용한 뒤, SQL Editor에서 DB 소유자(보통 postgres)로 이 파일 전체를 한 번 실행한다(수십 초 걸릴 수 있음).
-- 읽는 법: 이 문장은 일부러 마지막에 오류(P0001)로 끝난다 — 그래서 시험용 회원·악보가 전부 되돌려지고 아무것도 남지 않는다.
--          결과는 그 오류 문구 "QUOTA COST (rolled back): …"에 들어 있다. 숫자는 밀리초(ms).
-- 판단: 마지막 INSERT/UPDATE가 1초(1000ms)를 넘으면 사람과 상의한다(대안은 행 크기 열을 추가해 합산을 없애는 것 — 스키마 변경이라 이번 단계에는 넣지 않았다).
-- 크기를 바꿔 보려면 아래 row_chars(행당 글자 수)·rows_n(악보 수, 한도는 200)만 고친다.
do $quota_cost$
declare
  row_chars integer := 249000;
  rows_n integer := 200;
  uid uuid := gen_random_uuid();
  pad text;
  t0 timestamptz;
  fill_ms numeric;
  last_insert_ms numeric;
  update_data_ms numeric;
  update_title_ms numeric;
  total_bytes bigint;
begin
  insert into auth.users(id, email) values (uid, 'sf-quota-cost-' || uid || '@example.invalid');
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  -- 거의 압축되지 않는 16진 글자(실제 악보 JSON보다 불리한 쪽)
  select left(string_agg(md5(g::text), ''), row_chars) into pad from generate_series(1, row_chars / 32 + 1) as g;
  t0 := clock_timestamp();
  for i in 1 .. rows_n - 1 loop
    insert into public.scores(owner, title, data, measures) values (uid, 'cost ' || i, jsonb_build_object('p', pad), 1);
  end loop;
  fill_ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  insert into public.scores(owner, title, data, measures) values (uid, 'cost last', jsonb_build_object('p', pad), 1);
  last_insert_ms := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  select sum(octet_length(s.data::text)) into total_bytes from public.scores as s where s.owner = uid;
  t0 := clock_timestamp();
  update public.scores set data = jsonb_build_object('p', pad, 'q', 1) where owner = uid and title = 'cost last';
  update_data_ms := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp();
  update public.scores set title = 'cost renamed' where owner = uid and title = 'cost last';
  update_title_ms := round(extract(epoch from clock_timestamp() - t0) * 1000, 2);
  raise exception using errcode = 'P0001', message = format(
    'QUOTA COST (rolled back): rows=%s row_chars=%s total_bytes=%s | fill_%s_inserts_ms=%s | last_insert_ms=%s | update_data_ms=%s | rename_only_ms=%s',
    rows_n, row_chars, total_bytes, rows_n - 1, fill_ms, last_insert_ms, update_data_ms, update_title_ms);
end
$quota_cost$;
