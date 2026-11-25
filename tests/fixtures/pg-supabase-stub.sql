-- LOCAL THROWAWAY ONLY — 일회용 PostgreSQL에서 supabase/*.sql을 시험하려고 Supabase가 이미 갖춘 최소한을 흉내 낸다.
-- 절대 Supabase 프로젝트(운영·스테이징)에서 실행하지 않는다. 이 파일은 tests/supabase-sql.test.mjs만 쓴다.
-- Supabase 프로젝트에는 auth 스키마가 항상 있으므로, 있으면 첫 문장에서 멈춘다(안전장치).
begin;

do $stub_guard$
begin
  if to_regnamespace('auth') is not null then
    raise exception 'auth schema already exists: this stub is for a local throwaway Postgres only. Do NOT run it on a Supabase project.';
  end if;
end;
$stub_guard$;

-- 역할은 클러스터 전체에 하나씩. (Supabase의 anon/authenticated와 같은 이름 — NOLOGIN, 슈퍼유저·RLS 우회 없음)
do $stub_roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end;
$stub_roles$;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);
-- Supabase의 auth.uid()와 같은 규칙: JWT 클레임의 sub. (시험은 set_config('request.jwt.claim.sub', …)로 로그인을 흉내 낸다)
create function auth.uid() returns uuid language sql stable as $stub_uid$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$stub_uid$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- 2026년 4월 이전에 만든 Supabase 프로젝트는 public 스키마의 새 표·함수를 anon/authenticated에 자동으로 열어 주었다.
-- scoreforge_scores.sql은 그래도 안전해야 하므로(첫 줄에서 revoke all) 일부러 그 넓은 기본 권한을 흉내 낸다.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

commit;
