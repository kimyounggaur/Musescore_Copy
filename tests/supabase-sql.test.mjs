// supabase/*.sql을 "진짜 PostgreSQL"에서 실행해 보는 시험 (P8-5).
//
// 일회용 PostgreSQL 클러스터를 임시 폴더에 만들고(소켓 전용·네트워크 포트 없음, 끝나면 삭제) Supabase가 이미 갖춘
// 최소한(역할 anon·authenticated, auth.users, auth.uid())을 tests/fixtures/pg-supabase-stub.sql로 흉내 낸 뒤
// 저장소의 SQL을 순서대로 실행한다: scoreforge_auth → profile_compat → scoreforge_scores(v3) → scoreforge_v4.
// 운영 DB·Supabase에는 접속하지 않는다.
//
// 실행하려면 PostgreSQL 16의 bin 폴더를 SF_PG_BIN으로 준다(없으면 건너뜀 — PLAYWRIGHT_MODULE과 같은 방식):
//   SF_PG_BIN=/usr/lib/postgresql/16/bin node --test tests/supabase-sql.test.mjs
// 한계: PostgREST·Auth·Advisor가 없는 순수 PostgreSQL이다. Supabase 위의 검증(docs/SUPABASE_V4_VERIFICATION.md)을 대신하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = relative => path.join(ROOT, relative);
const read = relative => readFileSync(file(relative), 'utf8');
const SQL = {
  stub: file('tests/fixtures/pg-supabase-stub.sql'),
  auth: file('supabase/scoreforge_auth.sql'),
  compat: file('supabase/scoreforge_profile_compat.sql'),
  scores: file('supabase/scoreforge_scores.sql'),
  v4: file('supabase/scoreforge_v4.sql'),
  rollback: file('supabase/scoreforge_v4_rollback.sql'),
  rls: file('supabase/tests/scores_rls.sql'),
  fingerprint: file('supabase/tests/scoreforge_fingerprint.sql'),
  otherApps: file('supabase/tests/other_apps_fingerprint.sql'),
};

// ── 파일만 보는 검사(PostgreSQL 없이도 실행) ─────────────────────────────────────────────────────────
test('P8-5 SQL 파일: 한도 오류 코드가 SQL·cloud.js·시험에서 같고, 비밀 키 문자열이 없다', () => {
  const v4 = read('supabase/scoreforge_v4.sql'), rollback = read('supabase/scoreforge_v4_rollback.sql');
  const cloud = read('js/cloud.js'), rls = read('supabase/tests/scores_rls.sql');
  for (const code of ['SCOREFORGE_QUOTA_COUNT', 'SCOREFORGE_QUOTA_BYTES']) {
    assert.ok(v4.includes(`raise exception '${code}'`), `v4.sql이 ${code}를 던진다`);
    assert.ok(cloud.includes(code), `cloud.js가 ${code}를 알아본다`);
    assert.ok(rls.includes(`'${code}'`), `scores_rls.sql이 ${code}를 확인한다`);
  }
  for (const [name, text] of [['v4', v4], ['rollback', rollback], ['scores_rls', rls]]) {
    assert.ok(!/service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/.test(text), `${name}: 서비스 키 같은 문자열이 없다`);
    assert.match(text, /^begin;$/m, `${name}: 트랜잭션으로 시작`);
  }
  for (const [name, text] of [['v4', v4], ['rollback', rollback]]) assert.match(text.trimEnd(), /commit;$/, `${name}: commit으로 끝남`);
  assert.match(rls.trimEnd(), /select 'PASS:(?:[^']|'')*' as result;$/, 'scores_rls.sql은 PASS 한 줄로 끝난다');
  assert.ok(/rollback;\nselect 'PASS/.test(rls), '시험은 ROLLBACK 뒤에 결과를 낸다(남는 데이터 없음)');
});

test('P8-5 v4.sql 멱등 표지: 객체를 만드는 문장은 모두 create or replace / drop … if exists 짝이 있다', () => {
  const v4 = read('supabase/scoreforge_v4.sql');
  assert.ok(!/^create (function|procedure)/mi.test(v4), 'create or replace 없이 만드는 함수가 없다');
  assert.ok(/drop policy if exists scoreforge_scores_select on public\.scores;\ncreate policy scoreforge_scores_select/.test(v4));
  assert.ok(/drop trigger if exists scoreforge_scores_quota on public\.scores;\ncreate trigger scoreforge_scores_quota/.test(v4));
  assert.ok(!/public\.scores'?\s+is\s+'ScoreForge scores/.test(v4) && !/comment on table/i.test(v4), 'v3가 소유 표시로 쓰는 표 comment는 건드리지 않는다');
  const select = /create policy scoreforge_scores_select[^;]*;/.exec(v4);
  assert.ok(select && /\(select auth\.uid\(\)\) = owner/.test(select[0]) && !/is_admin/.test(select[0]), '선택 정책은 소유자만(관리자 조건 없음)');
});

// ── 일회용 PostgreSQL 위에서 실제로 실행 ─────────────────────────────────────────────────────────────
const BIN = process.env.SF_PG_BIN || '';
const REQUIRED = ['initdb', 'pg_ctl', 'psql', 'postgres'];
const skip = process.platform === 'win32' ? 'Windows는 유닉스 소켓이 없어 건너뜀'
  : !BIN ? 'SF_PG_BIN(PostgreSQL bin 폴더)을 주면 실행'
  : REQUIRED.some(name => !existsSync(path.join(BIN, name))) ? `SF_PG_BIN에 ${REQUIRED.join('·')}이(가) 없음` : false;

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;   // postgres·initdb는 루트로 못 돈다
let dir = '', port = 0, dataDir = '';
function server(cmd, args) {
  const exe = path.join(BIN, cmd);
  const r = asRoot ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} 실패\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function startCluster() {
  dir = mkdtempSync(path.join(tmpdir(), 'sf-pg-'));
  if (asRoot) assert.equal(spawnSync('chown', ['postgres:postgres', dir]).status, 0);
  dataDir = path.join(dir, 'data'); port = 20000 + Math.floor(Math.random() * 30000);
  server('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale']);
  server('pg_ctl', ['-D', dataDir, '-l', path.join(dir, 'log'), '-w', '-o',
    `-c listen_addresses= -c unix_socket_directories=${dir} -c port=${port} -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, 'start']);
}
function stopCluster() {
  if (dataDir && existsSync(dataDir)) { try { server('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop']); } catch {} }
  if (dir) rmSync(dir, { recursive: true, force: true });
}
const baseArgs = db => ['-X', '-q', '-h', dir, '-p', String(port), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-t', '-A'];
function psql(db, { file: sqlFile, sql }) {
  const args = [...baseArgs(db), ...(sqlFile ? ['-f', sqlFile] : ['-c', sql])];
  const r = spawnSync(path.join(BIN, 'psql'), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function ok(result, what) { assert.equal(result.status, 0, `${what}\n${result.err}`); return result.out; }
const apply = (db, sqlFile, what = path.basename(sqlFile)) => ok(psql(db, { file: sqlFile }), `${what} 실행`);
const sql = (db, text) => ok(psql(db, { sql: text }), text);
const clone = (name, from) => sql('postgres', `create database ${name} template ${from}`);
function fingerprint(db, queryFile) {
  const out = ok(psql(db, { file: queryFile }), `${path.basename(queryFile)} 실행`).trim();
  const cut = out.indexOf('|');
  return { md5: out.slice(0, cut), detail: out.slice(cut + 1) };
}
const scoreforge = db => fingerprint(db, SQL.fingerprint), otherApps = db => fingerprint(db, SQL.otherApps);
const sameDetail = (a, b, what) => assert.equal(a.detail, b.detail, `${what}\n앞: ${a.md5}  뒤: ${b.md5}`);
const lastLine = text => text.trim().split('\n').pop();

// 레슨 앱 같은 "다른 앱" 객체 — v4가 건드리면 지문이 달라져야 한다(private.is_admin()을 쓰는 정책 포함).
const LESSON_APP = `
create table public.lesson_notes (id uuid primary key default gen_random_uuid(), owner uuid references auth.users(id) on delete cascade, body text);
alter table public.lesson_notes enable row level security;
create policy lesson_notes_own on public.lesson_notes for all to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy lesson_notes_admin on public.lesson_notes for select to authenticated using ((select private.is_admin()));
grant select, insert, update, delete on public.lesson_notes to authenticated;
create function public.lesson_hello() returns text language sql stable as $f$ select 'hi' $f$;
create function public.lesson_touch() returns trigger language plpgsql as $f$ begin return new; end $f$;
create trigger lesson_notes_touch before update on public.lesson_notes for each row execute function public.lesson_touch();`;

test('P8-5 SQL을 일회용 PostgreSQL에서 실행한다 (v3 기준선 → v4 → 멱등 → 롤백 → 동시 삽입)', { skip, timeout: 240000 }, async t => {
  startCluster();
  try {
    // 1) 기준선: 새 프로젝트에 README 순서(auth → compat → scores)로 적용한 v3 상태
    sql('postgres', 'create database v3');
    for (const name of ['stub', 'auth', 'compat', 'scores']) apply('v3', SQL[name]);
    sql('v3', LESSON_APP);
    const v3 = scoreforge('v3'), v3Other = otherApps('v3');
    assert.ok(v3Other.detail.includes('lesson_notes') && v3Other.detail.includes('lesson_hello'), '다른 앱 객체가 지문에 들어 있다');

    await t.test('대조군: 새 시험은 v3에서는 "관리자가 남의 악보를 읽음"으로 실패한다(시험이 정책 차이에 반응함)', () => {
      const r = psql('v3', { file: SQL.rls });
      assert.notEqual(r.status, 0);
      assert.match(r.err, /Administrator can read other members' scores/);
    });

    clone('v4', 'v3');
    await t.test('v4 적용 → scores_rls.sql 통과(관리자 열람 불가·집계·200개·50MiB 경계)', () => {
      apply('v4', SQL.v4);
      assert.match(lastLine(apply('v4', SQL.rls)), /^PASS:/);
    });
    const v4 = scoreforge('v4');

    await t.test('v4는 v3와 다른 상태이고, 레슨 앱 쪽 객체 지문은 그대로다', () => {
      assert.notEqual(v4.md5, v3.md5);
      assert.deepEqual(otherApps('v4'), v3Other, 'v4가 다른 앱 객체를 바꿨다');
    });

    await t.test('v4를 한 번 더 적용해도 같은 상태(멱등)이고 시험도 다시 통과한다', () => {
      clone('v4b', 'v4');
      apply('v4b', SQL.v4);
      sameDetail(scoreforge('v4b'), v4, '두 번째 적용이 상태를 바꿨다');
      assert.match(lastLine(apply('v4b', SQL.rls)), /^PASS:/);
    });

    await t.test('롤백 → v3와 같은 상태(정책·함수·트리거·권한), 관리자 열람 복귀, 레슨 앱 쪽 그대로', () => {
      clone('rb', 'v4');
      apply('rb', SQL.rollback);
      sameDetail(scoreforge('rb'), v3, '롤백이 v3와 다르게 복원했다');
      assert.deepEqual(otherApps('rb'), v3Other);
      assert.match(psql('rb', { file: SQL.rls }).err, /Administrator can read other members' scores/, '롤백 뒤에는 v3처럼 관리자가 읽는다');
      apply('rb', SQL.rollback);
      sameDetail(scoreforge('rb'), v3, '롤백을 두 번 해도 같다');
    });

    await t.test('롤백 뒤 v4를 다시 적용하면 처음 v4와 같다(왕복)', () => {
      apply('rb', SQL.v4);
      sameDetail(scoreforge('rb'), v4, '롤백 뒤 재적용이 다르다');
      assert.match(lastLine(apply('rb', SQL.rls)), /^PASS:/);
    });

    await t.test('낯선 정책이 있으면 v4·롤백은 아무것도 바꾸지 않고 멈춘다', () => {
      clone('strange', 'v3');
      sql('strange', 'create policy foreign_open on public.scores for select to authenticated using (true)');
      const before = scoreforge('strange');
      for (const name of ['v4', 'rollback']) {
        const r = psql('strange', { file: SQL[name] });
        assert.notEqual(r.status, 0, name);
        assert.match(r.err, /unrecognized policies/, name);
      }
      sameDetail(scoreforge('strange'), before, '멈춘 뒤 상태가 달라졌다');
    });

    await t.test('v3가 없거나 다른 앱의 scores 표면 v4는 안내하고 멈춘다', () => {
      sql('postgres', 'create database authonly');
      apply('authonly', SQL.stub); apply('authonly', SQL.auth);
      assert.match(psql('authonly', { file: SQL.v4 }).err, /Apply scoreforge_scores\.sql first/);
      clone('stranger', 'authonly');
      sql('stranger', 'create table public.scores (id int primary key)');
      assert.match(psql('stranger', { file: SQL.v4 }).err, /Apply scoreforge_scores\.sql first/);
      assert.equal(sql('stranger', "select count(*) from pg_policies where tablename = 'scores'").trim(), '0');
      sql('postgres', 'create database empty');
      assert.match(psql('empty', { file: SQL.v4 }).err, /private\.is_admin\(\) is required/);
    });

    await t.test('같은 회원이 199개일 때 동시에 두 건을 넣으면 정확히 한 건만 들어간다(어드바이저리 잠금)', async () => {
      clone('conc', 'v4');
      const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      sql('conc', `insert into auth.users(id,email) values ('${uid}','c@example.invalid')`);
      sql('conc', `insert into public.scores(owner,title,data) select '${uid}','s'||g,'{}' from generate_series(1,199) g`);
      const first = spawn(path.join(BIN, 'psql'), [...baseArgs('conc'), '-c',
        `begin; insert into public.scores(owner,title,data) values ('${uid}','A','{}'); select pg_sleep(1.5); commit;`], { stdio: ['ignore', 'pipe', 'pipe'] });
      const finished = new Promise(resolve => first.on('close', code => resolve(code)));
      await new Promise(resolve => setTimeout(resolve, 500));
      const started = Date.now();
      const second = psql('conc', { sql: `insert into public.scores(owner,title,data) values ('${uid}','B','{}')` });
      const waited = Date.now() - started;
      assert.equal(await finished, 0, '먼저 시작한 쪽은 성공');
      assert.notEqual(second.status, 0, '나중 쪽은 거절');
      assert.match(second.err, /SCOREFORGE_QUOTA_COUNT/);
      assert.ok(waited >= 600, `나중 쪽은 먼저 쪽이 끝나기를 기다렸다(${waited}ms)`);
      assert.equal(sql('conc', `select count(*) from public.scores where owner = '${uid}'`).trim(), '200');
    });

    await t.test('한도 검사는 회원마다 따로 센다(다른 회원의 악보는 합산하지 않음)', () => {
      clone('perowner', 'v4');
      const [a, b] = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
      for (const id of [a, b]) sql('perowner', `insert into auth.users(id,email) values ('${id}','${id}@example.invalid')`);
      sql('perowner', `insert into public.scores(owner,title,data) select '${a}','s'||g,'{}' from generate_series(1,200) g`);
      sql('perowner', `insert into public.scores(owner,title,data) values ('${b}','first','{}')`);
      assert.match(psql('perowner', { sql: `insert into public.scores(owner,title,data) values ('${a}','x','{}')` }).err, /SCOREFORGE_QUOTA_COUNT/);
      assert.equal(sql('perowner', `select count(*) from public.scores where owner = '${b}'`).trim(), '1');
    });
  } finally {
    stopCluster();
  }
});
