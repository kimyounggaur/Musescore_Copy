// P8-5 D1(Supabase 프로젝트 분리) 전환 도구 시험.
// 새 프로젝트의 주소·공개 키는 사람이 프로젝트를 만들어야 생기므로, 저장소에는 "바꿔 주는 도구"만 두고 실제 전환은 사람이 한다.
// 도구가 다루는 것은 공개해도 되는 값(프로젝트 주소·publishable/anon 키)뿐이다 — 비밀 키는 거절하고 어떤 출력에도 키 값을 싣지 않는다.
// 이 시험은 저장소의 실제 js/config.js·vercel.json 모양을 쓰되, 값은 "전환 전" 기준(가짜 프로젝트·와일드카드 CSP·탈퇴 플래그 꺼짐)으로 되돌려서 돌린다.
// 사람이 전환을 마친 저장소(새 프로젝트·플래그 켬)에서도 이 시험이 그대로 통과하도록 하기 위해서다. 저장소 파일은 건드리지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SwitchError, checkPublicKey, parseProjectUrl, switchProject, findStaleReferences, inspectShipState, deleteAccountPolicy } from './project-switch-lib.mjs';

const read = file => readFileSync(file, 'utf8');
const REF_A = 'abcdefghijklmnopqrst', REF_B = 'zyxwvutsrqponmlkjihg';
const URL_A = `https://${REF_A}.supabase.co`, URL_B = `https://${REF_B}.supabase.co`;
const KEY_A = 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAA_bbbb-CCCC', KEY_B = 'sb_publishable_ZZZZZZZZZZZZZZZZZZZZZZ_yyyy-XXXX';
// 저장소 전체에서 "비밀 키 모양 글자"를 찾는 검사(delete-account.test)에 이 시험 파일이 걸리지 않도록, 가짜 비밀 키는 실행할 때 조립한다.
const SECRET = ['sb', 'secret', 'TOPSECRETVALUE0123456789abcdef'].join('_');
const jwt = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`;
// 저장소의 실제 파일(지금 어느 프로젝트로 전환돼 있든 상관없다)과, 그 모양에서 값만 "전환 전" 기준으로 되돌린 시험용 기준 파일.
const live = { config: read('js/config.js'), vercel: read('vercel.json') };
const liveRef = /https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(live.config)[1];
const BASE_REF = '0123456789abcdefghij', BASE_KEY = 'sb_publishable_BASEBASEBASEBASEBASEBA_base-BASE';
const configText = live.config
  .replace(/^(\s*url:\s*")https:\/\/[^"\s]+(")/m, `$1https://${BASE_REF}.supabase.co$2`)
  .replace(/^(\s*publishableKey:\s*")[^"\s]+(")/m, `$1${BASE_KEY}$2`)
  .replace(/(deleteAccount:\s*)true/, '$1false');
const vercelText = live.vercel.replace(/\b(https|wss):\/\/(?:\*|[a-z0-9]{20})\.supabase\.co(?=[\s;]|$)/g, '$1://*.supabase.co');
const currentRef = BASE_REF;
const cspOf = text => JSON.parse(text).headers.flatMap(group => group.headers).find(item => item.key === 'Content-Security-Policy').value;
const directive = (csp, name) => csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `));
const messageOf = fn => { try { fn(); } catch (err) { assert.ok(err instanceof SwitchError, `SwitchError여야 한다: ${err && err.stack}`); return err.message; } assert.fail('던져야 한다'); };

// ───────── 주소 ─────────
test('P8-5 전환 도구 주소: https://<ref 20자>.supabase.co만 받고(끝의 /·대문자는 정리), 그 밖의 모양은 이유와 함께 거절한다', () => {
  assert.deepEqual({ ...parseProjectUrl(URL_A) }, { ref: REF_A, url: URL_A });
  assert.deepEqual({ ...parseProjectUrl(`  ${URL_A}/  `) }, { ref: REF_A, url: URL_A }, '앞뒤 공백·끝의 /');
  assert.deepEqual({ ...parseProjectUrl(`https://${REF_A.toUpperCase()}.SUPABASE.CO`) }, { ref: REF_A, url: URL_A }, '대문자는 소문자로');
  assert.deepEqual({ ...parseProjectUrl('https://a1b2c3d4e5f6g7h8i9j0.supabase.co') }, { ref: 'a1b2c3d4e5f6g7h8i9j0', url: 'https://a1b2c3d4e5f6g7h8i9j0.supabase.co' }, '숫자 허용');
  const bad = [
    undefined, null, '', '   ', 42, {}, 'abcdefghijklmnopqrst.supabase.co', 'not a url',
    `http://${REF_A}.supabase.co`, `ftp://${REF_A}.supabase.co`,
    `https://${REF_A.slice(1)}.supabase.co`, `https://${REF_A}x.supabase.co`,           // 19자·21자
    `https://${REF_A.slice(0, 19)}-.supabase.co`, `https://${REF_A.slice(0, 19)}_.supabase.co`,
    'https://*.supabase.co', 'https://supabase.co', `https://sub.${REF_A}.supabase.co`,
    `https://${REF_A}.supabase.co.evil.example`, `https://${REF_A}.supabase.com`, `https://${REF_A}supabase.co`, `https://evil.example/${REF_A}.supabase.co`,
    `https://${REF_A}.supabase.co@evil.example`, `https://user:pw@${REF_A}.supabase.co`,
    `https://${REF_A}.supabase.co:8443`, `https://${REF_A}.supabase.co/rest/v1`, `https://${REF_A}.supabase.co/?a=1`, `https://${REF_A}.supabase.co/#x`,
    `https://${REF_A}.supabase.co https://evil.example`, `https://${REF_A}.supabase.co;`,
  ];
  for (const value of bad) {
    const message = messageOf(() => parseProjectUrl(value));
    assert.match(message, /supabase\.co/, `이유에 올바른 모양이 보인다: ${JSON.stringify(value)}`);
  }
});

// ───────── 키 ─────────
const appIsPublicKey = (() => {
  const context = { window: { SF: { core: {} } }, atob };
  vm.runInNewContext(read('js/safe-html.js'), context);
  vm.runInNewContext(read('js/auth.js'), context);
  return context.window.SF.auth.isPublicKey;
})();

test('P8-5 전환 도구 키: publishable 키와 anon JWT만 받는다 — 앱이 받는 키(SF.auth.isPublicKey)와 판정이 같다', () => {
  const samples = [
    KEY_A, 'sb_publishable_example', 'sb_publishable_', 'sb_publishable_ bad', 'sb_publishable_한글', 'SB_PUBLISHABLE_abc',
    jwt({ role: 'anon' }), jwt({ role: 'anon', ref: REF_A, iss: 'supabase' }), jwt({ role: 'service_role' }), jwt({ role: 'authenticated' }), jwt({}), jwt({ role: 'ANON' }),
    SECRET, 'sb_secret_example', 'broken', 'a.b.c', 'a.b', '', ' ', 'e30..sig', 'e30.@@@.sig', `${jwt({ role: 'anon' })}.extra`,
  ];
  for (const sample of samples) {
    let accepted = true;
    try { checkPublicKey(sample); } catch (err) { assert.ok(err instanceof SwitchError); accepted = false; }
    assert.equal(accepted, Boolean(appIsPublicKey(sample.trim())), `앱과 같은 판정이어야 한다: ${JSON.stringify(sample)}`);
  }
  assert.deepEqual({ ...checkPublicKey(`  ${KEY_A}\n`) }, { key: KEY_A, kind: 'publishable' }, '앞뒤 공백·줄바꿈은 정리');
  assert.deepEqual({ ...checkPublicKey(jwt({ role: 'anon' })) }, { key: jwt({ role: 'anon' }), kind: 'anon' });
});

test('P8-5 전환 도구 키: 비밀 키(sb_secret_·service_role)는 거절하고, 어떤 오류 문구에도 키 값을 싣지 않는다', () => {
  const secrets = [SECRET, SECRET.toUpperCase(), jwt({ role: 'service_role', ref: REF_A }), jwt({ role: 'service_role' }), jwt({ role: 'authenticated' }), 'sb_unknown_ABCDEF0123456789', 'postgres://user:hunter2pass@db.example.com/postgres'];
  for (const value of secrets) {
    const message = messageOf(() => checkPublicKey(value, { ref: REF_A }));
    assert.ok(!message.includes(value) && !message.includes(value.slice(-12)), `오류 문구에 키가 들어 있다: ${message}`);
  }
  assert.match(messageOf(() => checkPublicKey(SECRET)), /비밀 키/, 'sb_secret_는 비밀 키라고 알려 준다');
  assert.match(messageOf(() => checkPublicKey(jwt({ role: 'service_role' }))), /service_role/, 'service_role 키라고 알려 준다');
});

test('P8-5 전환 도구 키: anon JWT 안의 프로젝트 ref가 주소와 다르면 다른 프로젝트의 키이므로 거절한다', () => {
  assert.equal(checkPublicKey(jwt({ role: 'anon', ref: REF_A }), { ref: REF_A }).kind, 'anon');
  assert.equal(checkPublicKey(jwt({ role: 'anon' }), { ref: REF_A }).kind, 'anon', 'ref가 없는 키는 확인할 수 없으니 통과');
  assert.match(messageOf(() => checkPublicKey(jwt({ role: 'anon', ref: REF_B }), { ref: REF_A })), /다른 프로젝트/);
  assert.equal(checkPublicKey(KEY_A, { ref: REF_B }).kind, 'publishable', 'publishable 키에는 ref가 없다');
});

// ───────── 파일 바꾸기 ─────────
test('P8-5 전환 도구: js/config.js는 주소·공개 키 두 값만, vercel.json은 CSP의 supabase 주소 토큰만 바뀌고 나머지는 한 글자도 안 바뀐다', () => {
  const out = switchProject({ configText, vercelText, url: URL_A, key: KEY_A });
  assert.ok(out.config.includes(`url: "${URL_A}"`) && out.config.includes(`publishableKey: "${KEY_A}"`));
  assert.deepEqual(out.config.split('\n').filter((line, i) => line !== configText.split('\n')[i]).length, 2, 'config.js에서 바뀐 줄은 2줄');
  assert.ok(out.config.includes('deleteAccount: false'), '탈퇴 플래그는 요청하지 않으면 그대로(꺼짐)');
  assert.equal(out.config.replace(URL_A, `https://${currentRef}.supabase.co`).replace(KEY_A, /sb_publishable_[A-Za-z0-9_-]+/.exec(configText)[0]), configText, '두 값을 되돌리면 원래 파일');
  const before = cspOf(vercelText), after = cspOf(out.vercel);
  assert.ok(directive(before, 'connect-src').includes('https://*.supabase.co wss://*.supabase.co'), '시작은 와일드카드');
  assert.ok(directive(after, 'connect-src').includes(`https://${REF_A}.supabase.co wss://${REF_A}.supabase.co`), '한 프로젝트로 좁혀진다');
  assert.ok(!after.includes('*.supabase.co'));
  assert.equal(after.replaceAll(`${REF_A}.supabase.co`, '*.supabase.co'), before, 'CSP도 그 토큰만 바뀐다');
  assert.equal(out.vercel.replace(after, before), vercelText, 'CSP 밖의 vercel.json은 그대로');
  JSON.parse(out.vercel);
  assert.deepEqual({ ...out.summary }, { url: URL_A, ref: REF_A, keyKind: 'publishable', previousUrl: `https://${currentRef}.supabase.co`, previousRef: currentRef, cspTokens: 2, deleteAccount: 'unchanged', changed: true });
  assert.ok(!JSON.stringify(out.summary).includes(KEY_A), '요약에 키 값이 없다');
});

test('P8-5 전환 도구: 같은 값으로 다시 돌려도 결과가 같고(멱등), 다른 프로젝트로 다시 바꾸면 앞 프로젝트의 흔적이 남지 않는다', () => {
  const first = switchProject({ configText, vercelText, url: URL_A, key: KEY_A });
  const again = switchProject({ configText: first.config, vercelText: first.vercel, url: URL_A, key: KEY_A });
  assert.equal(again.config, first.config); assert.equal(again.vercel, first.vercel);
  assert.equal(again.summary.changed, false, '바뀐 것이 없다고 알린다');
  const other = switchProject({ configText: first.config, vercelText: first.vercel, url: URL_B, key: KEY_B });
  assert.ok(!other.config.includes(REF_A) && !other.config.includes(KEY_A) && !other.vercel.includes(REF_A), '앞 프로젝트의 주소·키·CSP가 남지 않는다');
  assert.equal(other.summary.previousRef, REF_A);
  assert.equal(directive(cspOf(other.vercel), 'connect-src').match(/\.supabase\.co/g).length, 2, 'https와 wss 한 쌍만');
  const direct = switchProject({ configText, vercelText, url: URL_B, key: KEY_B });
  assert.equal(other.config, direct.config); assert.equal(other.vercel, direct.vercel, '거쳐 가도 한 번에 바꾼 것과 같다');
});

test('P8-5 전환 도구: 탈퇴 플래그는 --enable-delete-account(enableDeleteAccount)를 줄 때만 켜고, 주지 않았다고 이미 켜진 것을 끄지도 않는다', () => {
  const on = switchProject({ configText, vercelText, url: URL_A, key: KEY_A, enableDeleteAccount: true });
  assert.ok(on.config.includes('deleteAccount: true') && !on.config.includes('deleteAccount: false'));
  assert.equal(on.summary.deleteAccount, 'enabled');
  assert.equal(on.config.replace('deleteAccount: true', 'deleteAccount: false'), switchProject({ configText, vercelText, url: URL_A, key: KEY_A }).config, '그 한 칸만 다르다');
  const keep = switchProject({ configText: on.config, vercelText: on.vercel, url: URL_A, key: KEY_A });
  assert.ok(keep.config.includes('deleteAccount: true'), '이미 켜진 값은 그대로');
  assert.equal(keep.summary.deleteAccount, 'unchanged'); assert.equal(keep.summary.changed, false);
  const again = switchProject({ configText: on.config, vercelText: on.vercel, url: URL_A, key: KEY_A, enableDeleteAccount: true });
  assert.equal(again.summary.deleteAccount, 'already-enabled'); assert.equal(again.summary.changed, false);
});

test('P8-5 전환 도구: 파일 모양이 예상과 다르면 아무것도 돌려주지 않고 던진다(반쯤 바뀐 결과가 없다)', () => {
  const cases = [
    ['config.js에 publishableKey 칸이 없음', { configText: configText.replace(/publishableKey:\s*"[^"]*"/, 'other: 1') }, /config\.js/],
    ['config.js에 url 칸이 없음', { configText: configText.replace(/url:\s*"[^"]*"/, 'other: 1') }, /config\.js/],
    ['config.js에 url 칸이 둘', { configText: configText.replace('publishableKey', 'url: "https://x.example", publishableKey') }, /config\.js/],
    ['탈퇴 플래그 줄이 없는데 켜 달라고 함', { configText: configText.replace(/window\.SF_FEATURES[^\n]*\n/, ''), enableDeleteAccount: true }, /deleteAccount|탈퇴/],
    ['vercel.json이 JSON이 아님', { vercelText: '{ not json' }, /vercel\.json/],
    ['vercel.json에 CSP가 없음', { vercelText: '{ "headers": [] }' }, /Content-Security-Policy|CSP/],
    ['CSP에 supabase 주소가 없음', { vercelText: vercelText.replaceAll('https://*.supabase.co wss://*.supabase.co', "'self'") }, /supabase/],
    // 바꿀 수 없는 모양(뒤에 / 가 붙음)의 와일드카드가 남으면, 다른 토큰은 바뀌었어도 결과를 내지 않는다
    ['바뀌지 않은 와일드카드가 CSP에 남음', { vercelText: vercelText.replace('wss://*.supabase.co', 'wss://*.supabase.co/') }, /와일드카드/],
  ];
  for (const [name, change, pattern] of cases) {
    const message = messageOf(() => switchProject({ configText, vercelText, url: URL_A, key: KEY_A, ...change }));
    assert.match(message, pattern, name);
  }
  assert.match(messageOf(() => switchProject({ configText, vercelText, url: URL_A, key: SECRET })), /비밀 키/, '키 검사는 파일을 보기 전에 한다');
  assert.match(messageOf(() => switchProject({ configText, vercelText, url: 'https://example.com', key: KEY_A })), /supabase\.co/);
});

test('P8-5 전환 도구: 옛 프로젝트 주소가 아직 남은 파일 목록을 찾아 알려 준다(내용은 싣지 않는다)', () => {
  const files = new Map([
    ['docs/old.md', `옛 프로젝트: https://${REF_A}.supabase.co 와 ${REF_A} 두 번`], ['js/clean.js', 'nothing here'],
    ['tests/x.mjs', `const ref = '${REF_A}';`], ['docs/new.md', `https://${REF_B}.supabase.co`],
  ]);
  assert.deepEqual(findStaleReferences(files, REF_A), [{ file: 'docs/old.md', count: 2 }, { file: 'tests/x.mjs', count: 1 }]);
  assert.deepEqual(findStaleReferences(files, 'nopenopenopenopenope'), []);
  assert.deepEqual(findStaleReferences(files, ''), [], 'ref가 비어 있으면 모든 곳에 맞아 버리지 않는다');
});

// ───────── 명령줄(임시 폴더에 복사해서) ─────────
const cli = fileURLToPath(new URL('./switch-supabase-project.mjs', import.meta.url));
function workspace(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sf-switch-'));
  mkdirSync(join(root, 'js')); mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'js/config.js'), configText); writeFileSync(join(root, 'vercel.json'), vercelText);
  writeFileSync(join(root, 'docs/history.md'), `예전 검증 기록: https://${currentRef}.supabase.co\n`);
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(root, name), text);
  return root;
}
function run(root, args) {
  const result = spawnSync(process.execPath, [cli, '--root', root, ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr, all: `${result.stdout}\n${result.stderr}` };
}

test('P8-5 전환 도구 명령줄: --dry-run은 무엇이 바뀔지만 보여 주고 파일은 그대로, 출력에 키 값이 없다', () => {
  const root = workspace();
  try {
    const r = run(root, ['--url', URL_A, '--key', KEY_A, '--dry-run']);
    assert.equal(r.code, 0, r.all);
    assert.equal(read(join(root, 'js/config.js')), configText); assert.equal(read(join(root, 'vercel.json')), vercelText);
    assert.match(r.out, /dry-run|미리보기/); assert.ok(r.out.includes(URL_A) && r.out.includes(`https://${currentRef}.supabase.co`), '새 주소와 옛 주소가 보인다');
    assert.ok(!r.all.includes(KEY_A), '키 값은 출력하지 않는다');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P8-5 전환 도구 명령줄: 실제 실행은 두 파일을 바꾸고, npm run release를 안내하며, 옛 주소가 남은 파일을 알려 준다(키 값은 출력 안 함)', () => {
  const root = workspace();
  try {
    const r = run(root, ['--url', URL_A, '--key', KEY_A]);
    assert.equal(r.code, 0, r.all);
    const expected = switchProject({ configText, vercelText, url: URL_A, key: KEY_A });
    assert.equal(read(join(root, 'js/config.js')), expected.config); assert.equal(read(join(root, 'vercel.json')), expected.vercel);
    assert.match(r.out, /npm run release/, '앱 파일이 바뀌었으니 릴리스 파일을 다시 만들라고 안내');
    assert.ok(r.out.includes('docs/history.md'), '옛 주소가 남은 파일 목록'); assert.ok(!r.out.includes('예전 검증 기록'), '내용은 싣지 않는다');
    assert.ok(!r.all.includes(KEY_A));
    const again = run(root, ['--url', URL_A, '--key', KEY_A]);
    assert.equal(again.code, 0, again.all); assert.match(again.out, /이미|바뀐 것이 없/);
    assert.equal(read(join(root, 'js/config.js')), expected.config, '두 번째 실행도 같은 결과');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P8-5 전환 도구 명령줄: --enable-delete-account는 탈퇴 플래그만 더 켠다', () => {
  const root = workspace();
  try {
    const r = run(root, ['--url=' + URL_A, '--key=' + KEY_A, '--enable-delete-account']);
    assert.equal(r.code, 0, r.all);
    assert.ok(read(join(root, 'js/config.js')).includes('deleteAccount: true'));
    assert.match(r.out, /delete-account|탈퇴/, '탈퇴 기능을 켰다는 것과 Edge Function 배포 순서를 알린다');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P8-5 전환 도구 명령줄: 비밀 키·잘못된 주소·빠진 값·모르는 옵션은 종료 코드 1로 멈추고 파일은 그대로, 출력에 비밀 키가 없다', () => {
  const root = workspace();
  try {
    const attempts = [
      ['--url', URL_A, '--key', SECRET], ['--url', URL_A, '--key', jwt({ role: 'service_role' })],
      ['--url', 'https://example.com', '--key', KEY_A], ['--url', URL_A], ['--key', KEY_A], [], ['--url', URL_A, '--key', KEY_A, '--no-such-option'], ['--url'],
    ];
    for (const args of attempts) {
      const r = run(root, args);
      assert.equal(r.code, 1, `${JSON.stringify(args)}\n${r.all}`);
      assert.equal(read(join(root, 'js/config.js')), configText, JSON.stringify(args)); assert.equal(read(join(root, 'vercel.json')), vercelText, JSON.stringify(args));
      assert.ok(!r.all.includes(SECRET) && !r.all.includes('TOPSECRETVALUE'), `비밀 키가 출력에 나왔다: ${JSON.stringify(args)}`);
      assert.match(r.err, /사용법|--url|비밀|주소|키/, JSON.stringify(args));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P8-5 전환 도구 명령줄: vercel.json이 망가져 있으면 config.js도 바꾸지 않는다(둘 다 바뀌거나 둘 다 그대로)', () => {
  const root = workspace({ 'vercel.json': '{ "headers": [ ] }' });
  try {
    const r = run(root, ['--url', URL_A, '--key', KEY_A]);
    assert.equal(r.code, 1, r.all);
    assert.equal(read(join(root, 'js/config.js')), configText, 'config.js는 그대로');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ───────── 탈퇴 플래그 규칙 · 저장소 파일 모양 ─────────
test('P8-5 탈퇴 플래그 규칙: 꺼져 있으면 언제나 괜찮고, 켜져 있으면 CSP가 새 프로젝트 하나로 좁혀진 뒤(D1 이후)에만 괜찮다', () => {
  const state = (config, vercel) => inspectShipState({ configText: config, vercelText: vercel });
  const before = state(configText, vercelText);
  assert.deepEqual({ ...before }, { url: `https://${BASE_REF}.supabase.co`, deleteAccount: false, wildcard: true, cspTokens: 2 }, '기준 파일: 꺼짐 + 와일드카드 CSP');
  assert.equal(deleteAccountPolicy(before).ok, true, '꺼짐 + 분리 전');
  const early = state(configText.replace('deleteAccount: false', 'deleteAccount: true'), vercelText);
  assert.equal(early.deleteAccount, true);
  const blocked = deleteAccountPolicy(early);
  assert.equal(blocked.ok, false, '켜짐 + 분리 전 = 막힌다');
  assert.match(blocked.message, /D1/); assert.match(blocked.message, /switch-supabase-project/, '무엇을 먼저 해야 하는지 알려 준다');
  const switched = switchProject({ configText, vercelText, url: URL_A, key: KEY_A });
  const after = state(switched.config, switched.vercel);
  assert.deepEqual({ ...after }, { url: URL_A, deleteAccount: false, wildcard: false, cspTokens: 2 }, '전환 도구를 거치면 CSP가 한 프로젝트로 좁혀진다');
  assert.equal(deleteAccountPolicy(after).ok, true, '꺼짐 + 분리 후');
  const enabled = switchProject({ configText, vercelText, url: URL_A, key: KEY_A, enableDeleteAccount: true });
  const on = state(enabled.config, enabled.vercel);
  assert.deepEqual({ ...on }, { url: URL_A, deleteAccount: true, wildcard: false, cspTokens: 2 });
  assert.equal(deleteAccountPolicy(on).ok, true, '켜짐 + 분리 후(전환 도구가 한 번에 만든 결과) = 괜찮다');
  assert.equal(deleteAccountPolicy(state(enabled.config, vercelText)).ok, false, '플래그만 켜고 CSP는 그대로 두면 막힌다');
  const noToken = state(enabled.config, vercelText.replaceAll('https://*.supabase.co wss://*.supabase.co', "'self'"));
  assert.deepEqual({ ...noToken }, { url: URL_A, deleteAccount: true, wildcard: false, cspTokens: 0 }, '준비: 와일드카드도 없고 supabase 주소도 하나도 없는 CSP');
  assert.equal(deleteAccountPolicy(noToken).ok, false, '켜짐 + CSP에 supabase 주소가 하나도 없음(앱이 어느 프로젝트에도 연결할 수 없음) = 막힌다');
  assert.equal(deleteAccountPolicy(state(configText.replace(/window\.SF_FEATURES[^\n]*\n/, ''), vercelText)).ok, false, '플래그 줄이 없으면 막힌다');
  assert.throws(() => state(configText, '{ not json'), SwitchError, 'vercel.json이 JSON이 아니면 던진다');
  assert.throws(() => state(configText, '{ "headers": [] }'), SwitchError, 'CSP가 없으면 던진다');
});

test('P8-5 저장소 파일 모양: 실제 js/config.js·vercel.json은 전환 도구가 읽고 바꿀 수 있는 모양이다(어느 프로젝트로 전환돼 있어도)', () => {
  const out = switchProject({ configText: live.config, vercelText: live.vercel, url: URL_A, key: KEY_A });
  assert.equal(out.summary.previousRef, liveRef, '지금 연결된 프로젝트를 정확히 읽는다');
  assert.equal(out.summary.cspTokens, 2, 'CSP에는 https와 wss 한 쌍');
  JSON.parse(out.vercel);
  assert.ok(!/\*\.supabase\.co/.test(out.vercel));
  const state = inspectShipState({ configText: live.config, vercelText: live.vercel });
  assert.equal(state.cspTokens, 2); assert.ok(state.url.includes(liveRef));
});

// ───────── 저장소 불변식 ─────────
test('P8-5 저장소 불변식: 시험 파일에 지금 프로젝트의 ref를 글자로 박아 두지 않는다(프로젝트를 바꿔도 시험이 안 깨진다)', () => {
  const offenders = readdirSync('tests').filter(name => /\.(mjs|js)$/.test(name)).filter(name => read(join('tests', name)).includes(liveRef));
  assert.deepEqual(offenders, [], '이 파일들은 js/config.js에서 읽도록 바꿔야 한다');
});

test('P8-5 저장소 불변식: 탈퇴 플래그는 D1 규칙을 지키고(꺼져 있거나, 프로젝트를 분리한 뒤에만 켜짐), 설정·도구 파일에 비밀 키 모양의 글자가 없다', () => {
  const policy = deleteAccountPolicy(inspectShipState({ configText: live.config, vercelText: live.vercel }));
  assert.ok(policy.ok, policy.message);
  for (const file of ['js/config.js', 'vercel.json', 'tests/switch-supabase-project.mjs', 'tests/project-switch-lib.mjs']) {
    assert.ok(!/sb_secret_[A-Za-z0-9]/.test(read(file)), `${file}에 sb_secret_ 키 모양이 있다`);
  }
});
