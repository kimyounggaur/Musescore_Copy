// P8-4d: 회원 탈퇴 Edge Function(supabase/functions/delete-account) — Deno 없이 Node에서 핸들러만 시험한다.
// handler.ts는 외부 패키지를 직접 가져오지 않고 createClient를 주입받으므로, 가짜 클라이언트로 모든 경로를 확인할 수 있다.
// (Node 22.18+의 타입 지우기로 .ts를 그대로 읽는다. 타입 표기만 쓰고 enum·namespace 같은 실행되는 TS 문법은 쓰지 않는다.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

assert.ok(process.features.typescript, 'Node 22.18 이상(타입 지우기)이 필요하다 — CI는 node-version 22');
const { createHandler } = await import('../supabase/functions/delete-account/handler.ts');

const ANON = 'sb_publishable_anonKeyForTest';
const SERVICE = 'SERVICE-ROLE-KEY-SHOULD-NEVER-LEAK-0123456789';
const URL_ = 'https://project-ref.supabase.co';
const ORIGIN = 'https://app.example';
const baseEnv = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, ALLOWED_ORIGINS: `${ORIGIN}, http://127.0.0.1:8000` };

function setup({ env = baseEnv, user = { id: 'user-1' }, getUserError = null, deleteError = null, createThrows = false } = {}) {
  const created = [], logs = [], deleted = [], getUserArgs = [];
  const createClient = (url, key, options) => {
    if (createThrows) throw new Error(`boom with ${key}`);
    created.push({ url, key, options });
    return {
      auth: {
        getUser: async (...args) => { getUserArgs.push(args); return { data: { user: getUserError ? null : user }, error: getUserError }; },
        admin: { deleteUser: async id => { deleted.push(id); return { error: deleteError }; } },
      },
    };
  };
  const handler = createHandler({ env: name => env[name], createClient, log: message => logs.push(String(message)) });
  return { handler, created, logs, deleted, getUserArgs };
}
const request = (method, { origin = ORIGIN, authorization, body, path = '' } = {}) => new Request(`${URL_}/functions/v1/delete-account${path}`, {
  method,
  headers: { ...(origin === null ? {} : { Origin: origin }), ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const bodyText = async response => await response.text();

test('P8-4d OPTIONS(사전 요청): 허용된 출처에는 204와 CORS 헤더, 클라이언트는 만들지 않는다', async () => {
  const { handler, created } = setup();
  const response = await handler(request('OPTIONS'));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN, '요청한 출처를 그대로 돌려준다(* 아님)');
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /OPTIONS/);
  for (const name of ['authorization', 'apikey', 'x-client-info', 'content-type']) assert.match(response.headers.get('Access-Control-Allow-Headers'), new RegExp(name));
  assert.match(response.headers.get('Vary'), /Origin/);
  assert.equal(await bodyText(response), '');
  assert.equal(created.length, 0);
});

test('P8-4d 허용 목록에 없는 출처는 OPTIONS도 POST도 403이고 CORS 허용 헤더가 없다', async () => {
  const { handler, created, deleted } = setup();
  for (const method of ['OPTIONS', 'POST', 'GET']) {
    const response = await handler(request(method, { origin: 'https://evil.example', authorization: 'Bearer token-1' }));
    assert.equal(response.status, 403, method);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null, method);
  }
  assert.equal(created.length, 0);
  assert.deepEqual(deleted, []);
});

test('P8-4d ALLOWED_ORIGINS가 없으면 브라우저 요청은 모두 거절한다(닫힌 채로 시작), 출처 헤더가 없는 서버 호출은 인증을 거쳐 처리한다', async () => {
  const noOrigins = { ...baseEnv }; delete noOrigins.ALLOWED_ORIGINS;
  const closed = setup({ env: noOrigins });
  assert.equal((await closed.handler(request('OPTIONS'))).status, 403);
  assert.equal((await closed.handler(request('POST', { authorization: 'Bearer token-1' }))).status, 403);
  assert.deepEqual(closed.deleted, []);
  const server = setup({ env: noOrigins });
  assert.equal((await server.handler(request('POST', { origin: null, authorization: 'Bearer token-1' }))).status, 204, '브라우저가 아닌 호출(출처 헤더 없음)은 JWT로만 판단');
  assert.deepEqual(server.deleted, ['user-1']);
});

test('P8-4d POST가 아닌 요청은 405(Allow 헤더 포함)이고 아무것도 지우지 않는다', async () => {
  const { handler, deleted } = setup();
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const response = await handler(request(method, { authorization: 'Bearer token-1' }));
    assert.equal(response.status, 405, method);
    assert.match(response.headers.get('Allow'), /POST/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN, '오류도 브라우저가 읽을 수 있게');
  }
  assert.deepEqual(deleted, []);
});

test('P8-4d 인증 헤더가 없거나 Bearer가 아니면 401이고 서비스 키로 만든 클라이언트는 없다', async () => {
  for (const authorization of [undefined, '', 'Basic abc', 'Bearer', 'Bearer   ', 'token-only']) {
    const { handler, created, deleted } = setup();
    const response = await handler(request('POST', { authorization }));
    assert.equal(response.status, 401, String(authorization));
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
    assert.equal(created.some(c => c.key === SERVICE), false, '서비스 키 클라이언트 없음');
    assert.deepEqual(deleted, []);
  }
});

test('P8-4d JWT가 유효하지 않거나 사용자가 없으면 401이고 아무것도 지우지 않는다', async () => {
  for (const options of [{ getUserError: { message: 'invalid JWT' } }, { user: null }]) {
    const { handler, created, deleted } = setup(options);
    const response = await handler(request('POST', { authorization: 'Bearer bad-token' }));
    assert.equal(response.status, 401);
    assert.deepEqual(deleted, []);
    assert.equal(created.some(c => c.key === SERVICE), false);
  }
});

test('P8-4d 성공: 요청자 JWT로 확인한 사용자만 지운다 — 본문·주소에 다른 id를 실어도 무시하고, 204와 CORS 헤더를 돌려준다', async () => {
  const { handler, created, deleted, getUserArgs } = setup({ user: { id: 'user-42' } });
  const response = await handler(request('POST', { authorization: 'Bearer token-42', body: { id: 'someone-else', user_id: 'victim' }, path: '?id=victim&user_id=victim' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(await bodyText(response), '');
  assert.equal(response.headers.get('Content-Type'), null, '본문이 없는 204에 content-type이 있으면 supabase-js가 빈 본문을 JSON으로 읽다 실패한다');
  assert.deepEqual(deleted, ['user-42']);
  assert.deepEqual(getUserArgs, [['token-42']], '토큰을 명시해서 사용자를 확인');
  const asUser = created.find(c => c.key === ANON), admin = created.find(c => c.key === SERVICE);
  assert.ok(asUser && admin);
  assert.equal(asUser.url, URL_);
  assert.equal(asUser.options.global.headers.Authorization, 'Bearer token-42');
  assert.equal(asUser.options.auth.persistSession, false);
  assert.equal(admin.options.auth.persistSession, false);
  assert.equal(admin.options.auth.autoRefreshToken, false);
  assert.equal(JSON.stringify(admin.options).includes('token-42'), false, '서비스 클라이언트에는 사용자 토큰을 싣지 않는다');
});

test('P8-4d 환경 값이 빠져 있으면 500(server_not_configured)이고 로그에는 빠진 이름만 남는다', async () => {
  for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const env = { ...baseEnv }; delete env[name];
    const { handler, created, deleted, logs } = setup({ env });
    const response = await handler(request('POST', { authorization: 'Bearer token-1' }));
    assert.equal(response.status, 500, name);
    assert.deepEqual(await response.json(), { error: 'server_not_configured' });
    assert.ok(logs.some(line => line.includes(name)), `${name} 이름이 로그에`);
    assert.equal(logs.join('\n').includes(SERVICE) || logs.join('\n').includes(ANON), false, '값은 로그에 남기지 않는다');
    assert.deepEqual(deleted, []);
    assert.equal(created.length, 0);
  }
});

test('P8-4d 삭제가 실패하면 500(delete_failed)이고 내부 오류 문구는 응답에 싣지 않는다(서버 로그에만)', async () => {
  const { handler, logs } = setup({ deleteError: { message: 'duplicate key value violates constraint lesson_plans_owner_fkey' } });
  const response = await handler(request('POST', { authorization: 'Bearer token-1' }));
  assert.equal(response.status, 500);
  const text = await bodyText(response);
  assert.deepEqual(JSON.parse(text), { error: 'delete_failed' });
  assert.equal(text.includes('lesson_plans'), false);
  assert.ok(logs.some(line => line.includes('lesson_plans_owner_fkey')), '원인은 서버 로그에 남는다');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('P8-4d 예상 못 한 예외도 500(internal)이고 서비스 키·토큰이 응답과 로그에 나오지 않는다', async () => {
  const { handler, logs } = setup({ createThrows: true });
  const response = await handler(request('POST', { authorization: 'Bearer token-secret-1' }));
  assert.equal(response.status, 500);
  const text = await bodyText(response);
  assert.deepEqual(JSON.parse(text), { error: 'internal' });
  for (const secret of [SERVICE, ANON, 'token-secret-1']) {
    assert.equal(text.includes(secret), false, `응답에 ${secret.slice(0, 8)}… 없음`);
    assert.equal(logs.join('\n').includes(secret), false, `로그에 ${secret.slice(0, 8)}… 없음`);
  }
});

test('P8-4d 어떤 응답에도 서비스 키가 실리지 않는다(헤더 포함)', async () => {
  const cases = [
    () => setup().handler(request('OPTIONS')),
    () => setup().handler(request('GET', { authorization: 'Bearer t' })),
    () => setup().handler(request('POST')),
    () => setup().handler(request('POST', { authorization: 'Bearer t' })),
    () => setup({ deleteError: { message: SERVICE } }).handler(request('POST', { authorization: 'Bearer t' })),
    () => setup({ getUserError: { message: SERVICE } }).handler(request('POST', { authorization: 'Bearer t' })),
  ];
  for (const run of cases) {
    const response = await run();
    const dump = JSON.stringify([...response.headers.entries()]) + await response.text();
    assert.equal(dump.includes(SERVICE), false);
  }
});

test('P8-4d 저장소의 어떤 파일에도 서비스 키로 보이는 값이 없고, 함수는 키를 환경에서만 읽는다', () => {
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.git' || name === 'output') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  const patterns = [/sb_secret_[A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/];
  for (const file of walk('.')) {
    if (/\.(png|jpg|jpeg|woff2|gz|zip)$/.test(file) || file.startsWith('vendor') || file.startsWith(join('docs', 'scoreforge-refactor-design')) || file.startsWith('tests/baseline')) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      // 시험 파일이 일부러 만든 가짜 값(role이 anon인 가짜 JWT 등)은 여기서 걸리지 않도록 service_role 표시가 있는 것만 본다
      for (const match of text.matchAll(new RegExp(pattern, 'g'))) {
        if (pattern === patterns[1]) {
          try {
            const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString());
            assert.notEqual(payload.role, 'service_role', `${file}: service_role JWT처럼 보이는 값`);
          } catch (error) { if (error instanceof assert.AssertionError) throw error; }
        } else assert.fail(`${file}: 비밀 키처럼 보이는 값 ${match[0].slice(0, 14)}…`);
      }
    }
  }
  const handler = readFileSync('supabase/functions/delete-account/handler.ts', 'utf8');
  assert.match(handler, /env\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.equal(/SERVICE_ROLE_KEY['"]?\s*[:=]\s*["'`][^"'`\s]{8,}/.test(handler), false, '키 값을 코드에 적지 않는다');
  const index = readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
  assert.match(index, /Deno\.serve\(createHandler\(\{[^}]*env: name => Deno\.env\.get\(name\)/);
  assert.match(index, /import \{ createClient \} from "jsr:@supabase\/supabase-js@2"/);
});
