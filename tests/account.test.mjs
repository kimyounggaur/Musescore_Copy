// P8-4: 계정 기능·노출 정리 — 노드 시험(브라우저 없이 되는 것: 마크업 불변식, 순수 함수, Edge Function 핸들러, i18n).
// 브라우저 동작(대화상자·복구 링크 흐름)은 tests/account-browser.test.mjs가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { deleteAccountPolicy, inspectShipState } from './project-switch-lib.mjs';

const read = path => readFileSync(path, 'utf8');
const html = read('index.html');
const section = (text, openTag) => {
  const start = text.indexOf(openTag);
  assert.ok(start >= 0, `${openTag} 가 있어야 한다`);
  const name = openTag.match(/^<(\w+)/)[1];
  let depth = 0;
  for (const m of text.slice(start).matchAll(new RegExp(`<${name}\\b|</${name}>`, 'g'))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return text.slice(start, start + m.index + m[0].length);
  }
  throw new Error(`${openTag} 의 닫는 태그를 못 찾음`);
};
function loadAuth(extra = {}) {
  const context = { window: { SF: { core: {} } }, atob, URLSearchParams, URL, ...extra };
  vm.runInNewContext(read('js/safe-html.js'), context);
  vm.runInNewContext(read('js/auth.js'), context);
  return context.window.SF.auth;
}

// ───────── a. 연결 설정 숨김 ─────────
test('P8-4a 마크업: Supabase 연결 칸(#auth-config)은 hidden으로 시작하고, URL·키 입력은 그 안에만 있다', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  const config = section(dialog, '<section id="auth-config"');
  assert.match(config.match(/^<section[^>]*>/)[0], /\bhidden\b/, '처음에는 숨김(개발 모드에서만 js가 연다)');
  for (const id of ['supabase-url', 'supabase-key', 'btn-save-supabase-config', 'btn-clear-supabase-config']) {
    assert.ok(config.includes(`id="${id}"`), `${id} 는 연결 칸 안에 있다`);
    assert.equal(dialog.split(`id="${id}"`).length - 1, 1, `${id} 는 한 번만 나온다`);
  }
});

test('P8-4a 마크업: "사용자 지정 연결 사용 중 · [기본값으로]" 띠는 hidden으로 시작하고 연결 칸 밖에 있다', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  const banner = section(dialog, '<div id="auth-custom-banner"');
  assert.match(banner.match(/^<div[^>]*>/)[0], /\bhidden\b/);
  assert.match(banner.match(/^<div[^>]*>/)[0], /role="status"/);
  assert.match(banner, /사용자 지정 연결 사용 중/);
  assert.match(banner, /<button id="btn-reset-default-connection" type="button"[^>]*>기본값으로<\/button>/);
  assert.equal(section(dialog, '<section id="auth-config"').includes('auth-custom-banner'), false, '개발 모드가 아니어도 보여야 하므로 연결 칸 밖');
});

test('P8-4a 개발 모드 판정: ?dev=1 또는 localStorage scoreforge.dev = "1"/"true"일 때만 켜진다', () => {
  const { devModeFrom } = loadAuth();
  assert.equal(devModeFrom('?dev=1', null), true);
  assert.equal(devModeFrom('?x=2&dev=1', ''), true);
  assert.equal(devModeFrom('', '1'), true);
  assert.equal(devModeFrom('', 'true'), true);
  assert.equal(devModeFrom('', 'TRUE'), true);
  for (const search of ['', '?dev', '?dev=', '?dev=0', '?dev=true', '?dev=11', '?xdev=1', '?x=dev%3D1', '?dev%3D1']) assert.equal(devModeFrom(search, null), false, `search ${JSON.stringify(search)}`);
  for (const stored of [null, undefined, '', '0', 'false', 'yes', '2', ' ', '10', '11', '1 ', 'untrue', 'true1']) assert.equal(devModeFrom('', stored), false, `stored ${JSON.stringify(stored)}`);
  assert.equal(devModeFrom(undefined, undefined), false);
  assert.equal(devModeFrom(null, null), false);
});

test('P8-4a 개발 모드 판정은 URLSearchParams가 없는 환경에서도 던지지 않는다', () => {
  const auth = loadAuth({ URLSearchParams: undefined });
  assert.equal(auth.devModeFrom('?dev=1', null), false);
  assert.equal(auth.devModeFrom('?dev=1', '1'), true, '저장값 경로는 그대로 동작');
});

test('P8-4a 사용자 지정 연결 판정: 실제로 쓰는 연결이 기본 설정(js/config.js)과 다를 때만 참', () => {
  const { customConnectionFrom } = loadAuth();
  const base = { url: 'https://a.supabase.co', publishableKey: 'sb_publishable_a' };
  assert.equal(customConnectionFrom({ ...base }, base), false);
  assert.equal(customConnectionFrom({ ...base, url: 'https://b.supabase.co' }, base), true);
  assert.equal(customConnectionFrom({ ...base, publishableKey: 'sb_publishable_b' }, base), true);
  assert.equal(customConnectionFrom({ url: '', publishableKey: '' }, { url: '', publishableKey: '' }), false, '기본값도 없고 저장값도 없으면 사용자 지정이 아니다');
  assert.equal(customConnectionFrom(base, { url: '', publishableKey: '' }), true, '기본값이 없는 포크에서 저장값을 쓰면 사용자 지정');
});

// ───────── b. 관리자 버튼 ─────────
test('P8-4b 마크업: "관리자 로그인" 버튼은 없고, "관리자 페이지" 버튼은 hidden으로 시작한다', () => {
  assert.equal(html.includes('btn-admin-login'), false, '관리자도 일반 로그인을 쓴다');
  assert.equal(/>\s*관리자 로그인\s*</.test(html), false);
  const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
  const authbar = section(header, '<div class="authbar"');
  const page = authbar.match(/<button id="btn-admin-page"[^>]*>/)[0];
  assert.match(page, /\bhidden\b/, '관리자일 때만 js가 보인다');
  assert.ok(authbar.indexOf('id="btn-member-login"') < authbar.indexOf('id="btn-admin-page"'), '순서: 회원 로그인 → 관리자 페이지');
});

test('P8-4b auth.js: 관리자 로그인 모드와 버튼 연결이 남아 있지 않다', () => {
  const source = read('js/auth.js');
  assert.equal(/btn-admin-login/.test(source), false);
  assert.equal(/^\s*admin:\s*\{/m.test(source), false, 'AUTH_MODES.admin 없음');
  assert.equal(/mode === "admin"/.test(source), false, '관리자 로그인 뒤 권한 확인·로그아웃 가지 없음');
  assert.match(source, /adminPage\.hidden = !\(signedIn && admin\)/, '"관리자 페이지"는 로그인한 관리자에게만');
});

test('P8-4b i18n: 관리자 로그인 전용 문구는 쓰는 곳이 없어 지웠고, 관리자 페이지 문구는 남아 있다', () => {
  const i18n = read('js/i18n.js');
  for (const key of ['adminLogin', 'adminHelp', 'noAdmin', 'adminDone', 'checkRls']) assert.equal(new RegExp(`^\\s+${key} \\|`, 'm').test(i18n), false, `auth.${key}`);
  for (const key of ['adminPage', 'adminRequired', 'adminStatus', 'adminAuth']) assert.equal(new RegExp(`^\\s+${key} \\|`, 'm').test(i18n), true, `auth.${key}`);
});

// ───────── c. 비밀번호 재설정 ─────────
test('P8-4c 마크업: 로그인 창에 "비밀번호를 잊으셨나요?" 버튼이 있다(type=button, 폼 제출과 무관)', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  assert.match(dialog, /<button id="btn-forgot-password" type="button" class="auth-link">비밀번호를 잊으셨나요\?<\/button>/);
  assert.ok(dialog.indexOf('id="auth-password"') < dialog.indexOf('id="btn-forgot-password"'), '비밀번호 칸 다음');
});

test('P8-4c 재설정 메일 주소: http·https에서만 <origin>/?auth=recovery, 그 밖(file 등)에서는 지정하지 않는다', () => {
  const { recoveryRedirectFrom } = loadAuth();
  assert.equal(recoveryRedirectFrom({ protocol: 'https:', origin: 'https://musescore-copy.vercel.app' }), 'https://musescore-copy.vercel.app/?auth=recovery');
  assert.equal(recoveryRedirectFrom({ protocol: 'http:', origin: 'http://127.0.0.1:8000' }), 'http://127.0.0.1:8000/?auth=recovery');
  assert.equal(recoveryRedirectFrom({ protocol: 'file:', origin: 'null' }), '');
  assert.equal(recoveryRedirectFrom({ protocol: 'https:', origin: '' }), '');
  assert.equal(recoveryRedirectFrom(null), '');
  assert.equal(recoveryRedirectFrom(undefined), '');
});

test('P8-4c 복구 링크로 돌아온 주소 해석: 성공 토큰·실패(만료)·아무것도 없음·관계없는 주소', () => {
  const { recoveryReturnFrom } = loadAuth();
  const base = 'https://app.example/';
  const ok = recoveryReturnFrom(base + '?auth=recovery#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
  assert.deepEqual({ ...ok }, { recovery: true, failed: false, hasTokens: true });
  const expired = recoveryReturnFrom(base + '?auth=recovery#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.deepEqual({ ...expired }, { recovery: true, failed: true, hasTokens: false });
  assert.deepEqual({ ...recoveryReturnFrom(base + '?auth=recovery') }, { recovery: true, failed: false, hasTokens: false });
  assert.deepEqual({ ...recoveryReturnFrom(base + '?auth=recovery&code=abc') }, { recovery: true, failed: false, hasTokens: true }, '코드 방식(PKCE)도 토큰으로 본다');
  for (const [fragment, why] of [['error_code=otp_expired', 'error_code만 있어도 실패'], ['error_description=Link+expired', 'error_description만 있어도 실패'], ['error=access_denied', 'error만 있어도 실패']]) {
    assert.deepEqual({ ...recoveryReturnFrom(`${base}?auth=recovery#${fragment}`) }, { recovery: true, failed: true, hasTokens: false }, why);
  }
  assert.deepEqual({ ...recoveryReturnFrom(base + '?auth=recovery&code=abc#error=access_denied') }, { recovery: true, failed: true, hasTokens: false }, '실패 표시가 함께 오면 토큰이 있어도 성공으로 보지 않는다');
  for (const other of [base, base + '?share=abc', base + '?auth=other#access_token=x', base + '#access_token=x', 'not a url', '', null, undefined]) {
    assert.deepEqual({ ...recoveryReturnFrom(other) }, { recovery: false, failed: false, hasTokens: false }, String(other));
  }
});

test('P8-4c 오류 문구 변환: 로그인 실패·요청 과다·같은 비밀번호·약한 비밀번호·세션 없음·네트워크', () => {
  const { errorMessage } = loadAuth();
  assert.equal(errorMessage({ message: 'Invalid login credentials' }), '이메일 또는 비밀번호가 올바르지 않습니다.');
  assert.equal(errorMessage({ message: 'Email not confirmed' }), '이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인하세요.');
  assert.equal(errorMessage({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' }), '요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.');
  assert.equal(errorMessage({ message: 'For security purposes, you can only request this after 49 seconds.' }), '요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.');
  assert.equal(errorMessage({ message: 'New password should be different from the old password.' }), '이전과 다른 비밀번호를 입력하세요.');
  assert.equal(errorMessage({ message: 'Password should be at least 6 characters.', code: 'weak_password' }), '비밀번호가 너무 짧아요. 더 길게 만들어 주세요.', '코드가 weak_password여도 길이 문제는 길이로 안내');
  assert.equal(errorMessage({ message: 'Password should be at least 12 characters.' }), '비밀번호가 너무 짧아요. 더 길게 만들어 주세요.', '서버가 정한 길이가 6이 아니어도 틀린 숫자를 말하지 않는다');
  assert.equal(errorMessage({ message: 'Password is known to be weak and easy to guess, please choose a different one.' }), '너무 흔한 비밀번호예요. 다른 비밀번호를 고르세요.');
  assert.equal(errorMessage({ message: 'Auth session missing!' }), '로그인 상태가 풀렸어요. 다시 로그인하거나 재설정 메일을 다시 받으세요.');
  assert.match(errorMessage(new TypeError('Failed to fetch')), /Supabase에 연결할 수 없습니다/);
  assert.equal(errorMessage({ message: '뜻밖의 오류' }), '뜻밖의 오류', '모르는 오류는 그대로');
  assert.equal(errorMessage(null), '알 수 없는 오류');
});

test('P8-4c promptDialog는 autocomplete 옵션을 입력칸에 넘긴다(새 비밀번호 칸에 new-password)', () => {
  assert.match(read('js/ui-dialog.js'), /\["min", "max", "step", "maxLength", "placeholder", "autocomplete"\]/);
});

// ───────── d. 탈퇴(기능 플래그가 꺼진 채로 출하) ─────────
// 레슨 앱과 Supabase 프로젝트를 나누기 전(D1)에는 사용자를 지우면 레슨 앱 데이터까지 지워질 수 있다. 그래서 js/config.js의 플래그가 true가 되기 전에는
// 버튼도 숨기고 deleteAccount()도 아무 요청 없이 돌아온다. 아래 시험은 "꺼져 있음"과 "켜졌을 때의 절차"를 모두 고정한다.
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
function loadConfig(preset) {
  const window = preset ? { SF_FEATURES: preset } : {};
  vm.runInNewContext(read('js/config.js'), { window });
  return window;
}
// 가짜 Supabase 클라이언트로 auth.js를 통째로 돌린다. 실제 네트워크·DOM 없음.
const NO_FEATURES = Symbol('SF_FEATURES 자체가 없음');
const plain = value => JSON.parse(JSON.stringify(value));   // vm 안에서 만든 객체는 프로토타입이 달라 strict 비교가 안 된다
function appHarness({ features = { deleteAccount: true }, user = { id: USER_ID, email: 'member@example.com' }, answers = [], signIn, invoke, signOut, location, storage } = {}) {
  const log = { prompts: [], toasts: [], calls: [], purged: [], authEvents: 0 };
  const session = (id = USER_ID) => ({ access_token: `token-for-${id}`, user: { id, email: 'member@example.com' } });
  const client = {
    auth: {
      onAuthStateChange: callback => { log.authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async args => { log.calls.push(['signInWithPassword', args]); return signIn ? signIn(args, session) : { data: { session: session(), user: session().user }, error: null }; },
      signOut: async options => { log.calls.push(['signOut', options]); if (signOut) return signOut(options); return { error: null }; },
    },
    functions: { invoke: async (name, options) => { log.calls.push(['invoke', name, options]); return invoke ? invoke(name, options) : { data: '', error: null }; } },
  };
  const window = {
    SF: {
      core: {},
      app: { toast: (message, options) => log.toasts.push(options ? [message, options] : message) },
      ui: { promptDialog: async options => { log.prompts.push(options); return answers.length ? answers.shift() : null; } },
      cloud: { state: { initialized: false }, purgeOwner: id => { log.calls.push(['purgeOwner', id]); log.purged.push(id); return 1; } },
    },
    SF_SUPABASE_CONFIG: { url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_testKeyForNodeTests1' },
    supabase: { createClient: () => client },
    dispatchEvent: () => { log.authEvents += 1; },
  };
  if (features !== NO_FEATURES) window.SF_FEATURES = features;
  const context = {
    window, atob, URLSearchParams, URL, document: { querySelector: () => null }, setTimeout: (fn, ms) => setTimeout(fn, ms),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    localStorage: storage || { getItem: () => null, setItem() {}, removeItem() {} },
    location: location || { search: '', href: 'https://app.example/', origin: 'https://app.example', protocol: 'https:' },
  };
  vm.runInNewContext(read('js/safe-html.js'), context);
  vm.runInNewContext(read('js/auth.js'), context);
  const auth = window.SF.auth;
  auth.getClient();
  auth.state.session = user ? { user } : null;
  auth.state.profile = user ? { id: user.id, role: 'member' } : null;
  return { auth, log, client, window, session };
}
const names = log => log.calls.map(call => call[0]);

test('P8-4c PASSWORD_RECOVERY 이벤트가 와도 인증 콜백 안에서는 새 비밀번호 창을 열지 않고, 콜백이 끝난 뒤(다음 틱)에 연다', async () => {
  const h = appHarness({ answers: [null] });
  assert.equal(typeof h.log.authCallback, 'function', 'getClient가 인증 상태 콜백을 등록한다');
  h.log.authCallback('PASSWORD_RECOVERY', { user: { id: USER_ID, email: 'member@example.com' } });
  assert.equal(h.log.prompts.length, 0, '콜백 안에서 곧바로 열면 라이브러리 안에서 Supabase를 부르는 교착 위험이 있다');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.log.prompts.length, 1, '다음 틱에 새 비밀번호 창');
  assert.equal(h.log.prompts[0].title, '새 비밀번호 설정');
});
const texts = log => log.toasts.map(toast => (Array.isArray(toast) ? toast[0] : toast));   // 오래 보이는 알림은 [문구, { duration }]로 기록된다

// D1 규칙(tests/project-switch-lib.mjs의 deleteAccountPolicy): 꺼져 있으면 언제나 괜찮고, 켜져 있으면 vercel.json CSP가 전환 도구로 새 프로젝트 하나로 좁혀진 뒤에만 괜찮다.
// 8-5에서 사람이 새 프로젝트로 전환하면서 플래그를 켜도(--enable-delete-account) 이 시험들이 같이 통과하도록, "항상 false"가 아니라 이 규칙을 고정한다.
const shipState = () => inspectShipState({ configText: read('js/config.js'), vercelText: read('vercel.json') });

test('P8-4d 기능 플래그: js/config.js의 SF_FEATURES.deleteAccount는 D1(분리) 전에는 false(출하 값)이고, 미리 정해 둔 값은 덮어쓰지 않는다', () => {
  const state = shipState();
  const policy = deleteAccountPolicy(state);
  assert.ok(policy.ok, policy.message);
  assert.deepEqual({ ...loadConfig().SF_FEATURES }, { deleteAccount: state.deleteAccount }, '파일에 적힌 값이 그대로 읽힌다');
  assert.deepEqual({ ...loadConfig({ deleteAccount: true }).SF_FEATURES }, { deleteAccount: true }, '시험·배포가 먼저 정해 둔 값이 이긴다');
  assert.deepEqual({ ...loadConfig({ deleteAccount: false }).SF_FEATURES }, { deleteAccount: false }, '꺼 둔 값도 마찬가지');
  const config = read('js/config.js');
  assert.match(config, /D1/, '왜 꺼져 있는지(D1 프로젝트 분리 전)를 주석으로 남긴다');
  assert.match(config, /8-5/, '언제 켜는지(8-5의 분리 커밋)를 주석으로 남긴다');
});

test('P8-4d 저장소의 어떤 코드·설정도 탈퇴 플래그를 켜지 않는다(켜는 것은 D1 분리 뒤 — js/config.js의 한 줄만 전환 도구로 켠다)', () => {
  const enables = file => read(file).match(/deleteAccount\s*[:=]\s*(true|1|"true")/g) || [];
  for (const file of ['index.html', 'vercel.json', 'sw.js', 'manifest.webmanifest', ...readdirSync('js').filter(name => name.endsWith('.js') && name !== 'config.js').map(name => `js/${name}`)]) {
    assert.deepEqual(enables(file), [], `${file} 이(가) 탈퇴 플래그를 켠다`);
  }
  // js/config.js만 켤 수 있고, 켜는 것은 플래그 줄 하나뿐이며, 켜졌다면 D1 규칙(위 시험)을 지킨다
  assert.equal(enables('js/config.js').length, shipState().deleteAccount ? 1 : 0, 'config.js에서 켜는 곳은 플래그 줄 하나뿐이다');
});

test('P8-4d 마크업: #btn-delete-account는 hidden으로 시작하고, 로그아웃 다음에 한 번만 있다', () => {
  const authbar = section(html, '<div class="authbar"');
  assert.equal(html.split('id="btn-delete-account"').length - 1, 1);
  const button = authbar.match(/<button id="btn-delete-account"[^>]*>[^<]*<\/button>/)[0];
  assert.match(button, /\bhidden\b/);
  assert.match(button, /type="button"|class="tbtn auth-btn"/);
  assert.match(button, />회원 탈퇴<\/button>/);
  assert.ok(authbar.indexOf('id="btn-logout"') < authbar.indexOf('id="btn-delete-account"'), '로그아웃 다음');
});

test('P8-4d 플래그가 꺼져 있으면(없음·false·true가 아닌 값) deleteAccount()는 아무것도 하지 않는다', async () => {
  for (const features of [NO_FEATURES, {}, { deleteAccount: false }, { deleteAccount: 'true' }, { deleteAccount: 1 }, { deleteAccount: 'yes' }, { deleteAccount: null }, null, 'on']) {
    const h = appHarness({ features, answers: ['secret123', '탈퇴'] });
    const result = await h.auth.deleteAccount();
    assert.deepEqual({ ...result }, { ok: false, reason: 'disabled' }, String(features) + JSON.stringify(features));
    assert.deepEqual(h.log.prompts, [], '대화상자도 열지 않는다');
    assert.deepEqual(h.log.calls, [], '재인증·함수 호출·로그아웃 어느 것도 없다');
    assert.deepEqual(h.log.toasts, []);
    assert.ok(h.auth.state.session, '로그인 상태는 그대로');
  }
});

test('P8-4d 주소(?deleteAccount=1 등)나 localStorage로는 켜지 않는다', async () => {
  const storage = { getItem: () => '1', setItem() {}, removeItem() {} };
  const location = { search: '?deleteAccount=1&features=deleteAccount&dev=1', href: 'https://app.example/?deleteAccount=1', origin: 'https://app.example', protocol: 'https:' };
  const h = appHarness({ features: { deleteAccount: false }, answers: ['secret123', '탈퇴'], storage, location });
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'disabled' });
  assert.deepEqual(h.log.calls, []);
  assert.equal(h.auth.deleteEnabled(), false);
});

test('P8-4d 켜져 있어도 로그인하지 않았으면 안내만 하고 대화상자·요청은 없다', async () => {
  const h = appHarness({ user: null, answers: ['secret123', '탈퇴'] });
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'signed-out' });
  assert.deepEqual(h.log.prompts, []);
  assert.deepEqual(h.log.calls, []);
  assert.deepEqual(h.log.toasts, ['로그인한 뒤에 탈퇴할 수 있어요.']);
});

test('P8-4d 절차: 비밀번호 재입력 → "탈퇴" 입력 → 함수 호출(재인증으로 얻은 토큰에 고정) → 이 기기 로그아웃 → 이 계정의 대기열만 비움', async () => {
  const h = appHarness({ answers: ['secret123', '탈퇴'] });
  const result = await h.auth.deleteAccount();
  assert.deepEqual({ ...result }, { ok: true });
  assert.deepEqual(names(h.log), ['signInWithPassword', 'invoke', 'signOut', 'purgeOwner']);
  assert.deepEqual({ ...h.log.calls[0][1] }, { email: 'member@example.com', password: 'secret123' }, '비밀번호는 지금 로그인한 이메일로만 확인한다');
  const [, name, options] = h.log.calls[1];
  assert.equal(name, 'delete-account');
  assert.equal(options.method, 'POST');
  assert.equal(options.body, undefined, '지울 계정을 요청 내용으로 지정하지 않는다(서버는 토큰의 사용자만 지운다)');
  assert.deepEqual({ ...options.headers }, { Authorization: `Bearer token-for-${USER_ID}` }, '재인증으로 확인한 계정의 토큰에 고정 — 그 사이 다른 탭이 로그인을 바꿔도 다른 계정을 지우지 않는다');
  assert.deepEqual({ ...h.log.calls[2][1] }, { scope: 'local' }, '다른 기기의 로그인은 끊지 않는다 — 서버 쪽 사용자는 이미 지워졌다');
  assert.deepEqual(h.log.purged, [USER_ID]);
  assert.equal(h.auth.state.session, null);
  assert.equal(h.auth.state.profile, null);
  assert.ok(h.log.authEvents >= 1, '화면(버튼·상태)을 다시 그린다');
  assert.equal(h.log.toasts.length, 1);
  assert.deepEqual(plain(h.log.toasts[0]), ['탈퇴가 끝났어요. 이 기기의 로컬 악보는 그대로 남아 있어요.', { duration: 6000 }]);
});

test('P8-4d 대화상자 옵션: 비밀번호 칸은 password·current-password·danger, 확인 칸은 "탈퇴"(또는 영어 UI용 DELETE)만 통과', async () => {
  const h = appHarness({ answers: ['secret123', '탈퇴'] });
  await h.auth.deleteAccount();
  const [first, second] = h.log.prompts;
  assert.equal(first.type, 'password');
  assert.equal(first.autocomplete, 'current-password');
  assert.equal(first.danger, true);
  assert.equal(first.validate(''), '비밀번호를 입력하세요.');
  assert.equal(first.validate('x'), '');
  assert.equal(second.danger, true);
  assert.equal(second.type === undefined || second.type === 'text', true);
  for (const ok of ['탈퇴', ' 탈퇴 ', 'delete', 'DELETE', ' Delete ']) assert.equal(second.validate(ok), '', JSON.stringify(ok));
  for (const bad of ['', '탈퇴하기', '탈 퇴', 'del', 'deleted', '네', 'yes', '취소']) assert.notEqual(second.validate(bad), '', JSON.stringify(bad));
});

test('P8-4d 비밀번호가 틀리면 다시 묻고(최대 3번), 3번 다 틀리면 함수를 부르지 않고 끝낸다', async () => {
  const wrong = { data: { session: null, user: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } };
  const h = appHarness({ answers: ['a1', 'a2', 'a3', 'a4'], signIn: () => wrong });
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'password' });
  assert.equal(h.log.prompts.length, 3, '비밀번호 질문은 3번까지');
  assert.equal(h.log.prompts[0].message === h.log.prompts[1].message, false, '두 번째부터는 틀렸다는 안내가 메시지에 들어간다');
  assert.match(h.log.prompts[1].message, /비밀번호가 맞지 않아요/);
  assert.deepEqual(names(h.log), ['signInWithPassword', 'signInWithPassword', 'signInWithPassword']);
  assert.deepEqual(h.log.purged, []);
  assert.ok(h.auth.state.session, '로그인 상태 그대로');
  assert.deepEqual(texts(h.log), ['비밀번호가 맞지 않아 탈퇴를 진행하지 못했어요.']);
  // 두 번째에 맞으면 이어 간다
  let tries = 0;
  const h2 = appHarness({ answers: ['bad', 'good', '탈퇴'], signIn: (args, session) => (++tries === 1 ? wrong : { data: { session: session(), user: session().user }, error: null }) });
  assert.deepEqual({ ...await h2.auth.deleteAccount() }, { ok: true });
});

test('P8-4d 재확인 중 비밀번호 문제가 아닌 오류(요청 과다·네트워크)는 다시 묻지 않고 바로 알린다', async () => {
  const h = appHarness({ answers: ['secret123', 'secret123'], signIn: () => ({ data: { session: null, user: null }, error: { message: 'email rate limit exceeded', code: 'over_request_rate_limit', status: 429 } }) });
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'error' });
  assert.equal(h.log.prompts.length, 1);
  assert.deepEqual(texts(h.log), ['요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.']);
  assert.ok(!names(h.log).includes('invoke'));
});

test('P8-4d 취소: 비밀번호 칸·확인 칸 어디서 취소해도 함수 호출·로그아웃·대기열 삭제가 없다', async () => {
  const first = appHarness({ answers: [null] });
  assert.deepEqual({ ...await first.auth.deleteAccount() }, { ok: false, reason: 'cancelled' });
  assert.deepEqual(first.log.calls, []);
  assert.deepEqual(first.log.toasts, ['탈퇴를 취소했어요.']);
  const second = appHarness({ answers: ['secret123', null] });
  assert.deepEqual({ ...await second.auth.deleteAccount() }, { ok: false, reason: 'cancelled' });
  assert.deepEqual(names(second.log), ['signInWithPassword'], '비밀번호 확인까지만 했다');
  assert.deepEqual(second.log.purged, []);
  assert.ok(second.auth.state.session);
});

test('P8-4d 재인증으로 확인된 계정이 지금 계정과 다르면(다른 탭에서 바뀜) 아무것도 지우지 않는다', async () => {
  const h = appHarness({ answers: ['secret123', '탈퇴'], signIn: (args, session) => ({ data: { session: session(OTHER_ID), user: session(OTHER_ID).user }, error: null }) });
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'account-changed' });
  assert.ok(!names(h.log).includes('invoke'));
  assert.deepEqual(h.log.purged, []);
  assert.match(String(h.log.toasts[0]), /계정이 바뀌었어요/);
});

test('P8-4d 함수 호출이 실패하면 로그인·대기열을 그대로 두고 원인별 문구를 보인다(서버가 준 문장은 그대로 보이지 않는다)', async () => {
  const http = status => ({ name: 'FunctionsHttpError', message: `상세 ${status}`, context: { status } });
  for (const [error, expected] of [
    [http(401), '로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.'],
    [http(500), '탈퇴를 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'],
    [{ name: 'FunctionsFetchError', message: 'Failed to send a request' }, '네트워크에 연결하지 못했어요. 탈퇴가 처리됐는지 확인하지 못했어요. 잠시 뒤 다시 로그인해 확인해 주세요.'],
  ]) {
    const h = appHarness({ answers: ['secret123', '탈퇴'], invoke: () => ({ data: null, error }) });
    assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'error' });
    assert.deepEqual(names(h.log), ['signInWithPassword', 'invoke'], '로그아웃·대기열 삭제 없음');
    assert.ok(h.auth.state.session, '로그인 상태 그대로');
    assert.deepEqual(plain(h.log.toasts[0]), [expected, { duration: 6000 }]);
    assert.doesNotMatch(String(h.log.toasts[0]), /상세/);
  }
  // 호출이 던져도(예상 밖) 같은 처리
  const thrown = appHarness({ answers: ['secret123', '탈퇴'], invoke: () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual({ ...await thrown.auth.deleteAccount() }, { ok: false, reason: 'error' });
  assert.deepEqual(thrown.log.purged, []);
});

test('P8-4d 성공한 뒤 로그아웃 요청이 실패해도 이 기기의 로그인 상태·대기열은 정리한다(서버에서는 이미 지워졌다)', async () => {
  const h = appHarness({ answers: ['secret123', '탈퇴'], signOut: () => { throw new Error('logout failed'); } });
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: true });
  assert.deepEqual(h.log.purged, [USER_ID]);
  assert.equal(h.auth.state.session, null);
  const h2 = appHarness({ answers: ['secret123', '탈퇴'], signOut: () => ({ error: { message: 'Auth session missing!', status: 401 } }) });
  assert.deepEqual({ ...await h2.auth.deleteAccount() }, { ok: true });
  assert.equal(h2.auth.state.session, null);
});

test('P8-4d 이미 진행 중이면 두 번째 호출은 함수를 다시 부르지 않는다', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = appHarness({ answers: ['secret123', '탈퇴'], invoke: async () => { await gate; return { data: '', error: null }; } });
  const first = h.auth.deleteAccount();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual({ ...await h.auth.deleteAccount() }, { ok: false, reason: 'busy' });
  release();
  assert.deepEqual({ ...await first }, { ok: true });
  assert.equal(names(h.log).filter(name => name === 'invoke').length, 1);
});

test('P8-4d 오류 문구 변환(deleteErrorMessage): 상태별로 정해진 한국어 문구만, 모르는 오류도 서버 문장을 보이지 않는다', () => {
  const { deleteErrorMessage } = loadAuth();
  const http = status => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status } });
  const generic = '탈퇴를 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  assert.equal(deleteErrorMessage(http(401)), '로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.');
  assert.equal(deleteErrorMessage(http(403)), '이 주소에서는 탈퇴를 처리할 수 없어요.');
  assert.equal(deleteErrorMessage(http(404)), '탈퇴 기능을 아직 쓸 수 없어요.');
  assert.equal(deleteErrorMessage(http(429)), '요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.');
  for (const status of [400, 405, 500, 502, 503]) assert.equal(deleteErrorMessage(http(status)), generic, String(status));
  assert.equal(deleteErrorMessage({ name: 'FunctionsRelayError', message: 'Relay Error invoking the Edge Function' }), generic);
  const network = '네트워크에 연결하지 못했어요. 탈퇴가 처리됐는지 확인하지 못했어요. 잠시 뒤 다시 로그인해 확인해 주세요.';
  assert.equal(deleteErrorMessage({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }), network);
  assert.equal(deleteErrorMessage(new TypeError('Failed to fetch')), network);
  for (const odd of [null, undefined, {}, { message: 'internal detail: SELECT * FROM auth.users' }, 'boom', 42]) assert.equal(deleteErrorMessage(odd), generic, String(odd));
});

// ───────── e. 개인정보 고지·가입 동의 ─────────
// privacy.html의 문구는 법률 검토 전 초안이다. 시험은 "있어야 할 절이 있고, 모르는 값은 지어내지 않고 표시돼 있으며, 앱이 기록하는 동의 버전과 일치한다"를 고정한다.
const privacy = existsSync('privacy.html') ? read('privacy.html') : '';
const privacyVersion = () => loadAuth().privacyVersion;

test('P8-4e 동의 버전: SF.auth.privacyVersion은 날짜 모양(YYYY-MM-DD)이고, privacy.html의 메타·본문 버전과 같다', () => {
  const version = privacyVersion();
  assert.match(version, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(privacy, new RegExp(`<meta name="privacy-version" content="${version}">`), 'privacy.html <meta name="privacy-version">');
  assert.match(privacy, new RegExp(`id="privacy-version">${version}<`), '본문에 보이는 버전도 같다');
  assert.match(read('js/auth.js'), /privacy\.html/, 'auth.js 주석에 두 값을 같이 바꾸라고 적어 둔다');
});

test('P8-4e privacy.html: 한국어·영어 두 구역에 수집 항목·이용 목적·보관과 파기·처리 위탁과 국외 이전·이용자의 권리·문의처가 있다', () => {
  assert.ok(privacy, 'privacy.html 이 있어야 한다');
  assert.match(privacy, /<html lang="ko">/);
  const ko = section(privacy, '<section id="ko" lang="ko">');
  const en = section(privacy, '<section id="en" lang="en">');
  for (const heading of ['수집하는 항목', '이용 목적', '보관과 파기', '처리 위탁과 국외 이전', '이용자의 권리', '문의처']) assert.match(ko, new RegExp(`<h2[^>]*>[^<]*${heading}`), `ko: ${heading}`);
  for (const heading of ['What we collect', 'Why we use it', 'Retention and deletion', 'Processors and overseas transfer', 'Your rights', 'Contact']) assert.match(en, new RegExp(`<h2[^>]*>[^<]*${heading}`), `en: ${heading}`);
  for (const part of [ko, en]) {
    for (const vendor of ['Supabase', 'Vercel']) assert.match(part, new RegExp(vendor), `${vendor} 이(가) 처리 위탁·국외 이전에 적혀 있다`);
  }
  for (const word of ['이메일', '비밀번호', '표시 이름', '악보', '동의 기록']) assert.match(ko, new RegExp(word), `ko: ${word}`);
  for (const word of ['email', 'password', 'display name', 'scores', 'consent']) assert.match(en, new RegExp(word, 'i'), `en: ${word}`);
  assert.match(ko, /탈퇴/, '삭제·탈퇴 방법을 적는다');
});

test('P8-4e privacy.html: 앱이 접속하는 외부 음원 서버(서비스 워커의 SAMPLE_HOSTS)를 모두 적는다', () => {
  const hosts = [...read('sw.js').match(/SAMPLE_HOSTS = new Set\(\[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.ok(hosts.length >= 3, `음원 서버 ${hosts}`);
  for (const host of hosts) assert.ok(privacy.includes(host), `${host} 이(가) privacy.html에 없다 — 새 외부 서버를 쓰면 고지도 고친다`);
});

test('P8-4e privacy.html: 모르는 값(문의처·서버 지역·시행일 등)은 지어내지 않고 "[확정 필요…]"로 표시하며, 끝에 "법률 검토 필요" 주석이 있다', () => {
  const todos = [...privacy.matchAll(/<span class="todo">([^<]*)<\/span>/g)].map(m => m[1]);
  assert.ok(todos.length >= 4, `표시된 자리 ${todos.length}개`);
  for (const todo of todos) assert.match(todo, /^\[확정 필요[:\]]/, todo);
  assert.doesNotMatch(privacy.replace(/<span class="todo">[^<]*<\/span>/g, ''), /@[a-z0-9-]+\.[a-z]{2,}/i, '확정되지 않은 이메일 주소를 본문에 적지 않는다');
  const tail = privacy.slice(privacy.lastIndexOf('</section>'));
  assert.match(tail, /<!--[^>]*법률 검토 필요[^>]*-->/, '문서 끝에 "법률 검토 필요" 주석');
  assert.ok(privacy.lastIndexOf('법률 검토 필요') > privacy.lastIndexOf('</section>'), '마지막 절 뒤에 있다');
});

test('P8-4e privacy.html: 스크립트·인라인 이벤트·외부 자원이 없고 CSP(default-src self) 아래에서도 그대로 열린다', () => {
  assert.doesNotMatch(privacy, /<script\b/i);
  assert.doesNotMatch(privacy, /\son[a-z]+\s*=/i, '인라인 이벤트 속성 없음');
  assert.doesNotMatch(privacy, /\b(?:src|href)="https?:\/\//i, '외부 주소를 불러오거나 링크하지 않는다');
  assert.match(privacy, /<link rel="stylesheet" href="css\/privacy\.css">/);
  assert.match(privacy, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(privacy, /<a href="\.\/">/, '앱으로 돌아가는 링크');
  assert.ok(existsSync('css/privacy.css'));
});

test('P8-4e 마크업: 가입 창의 필수 동의 체크(#auth-consent)는 hidden으로 시작하고, 개인정보 링크는 새 탭으로 열린다', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  const row = section(dialog, '<label id="auth-consent-row"');
  assert.match(row.match(/^<label[^>]*>/)[0], /\bhidden\b/);
  assert.match(row, /<input id="auth-consent" type="checkbox">/);
  assert.doesNotMatch(row.match(/<input[^>]*>/)[0], /\bchecked\b/, '처음에는 체크돼 있지 않다');
  assert.match(row, /\(필수\)/);
  assert.equal(dialog.split('id="auth-consent"').length - 1, 1);
  assert.match(dialog, /<a id="link-privacy" class="auth-link" href="privacy\.html" target="_blank" rel="noopener">개인정보 처리 안내<\/a>/);
});

test('P8-4e 서비스 워커 사전 캐시에 privacy.html·css/privacy.css가 들어 있다(오프라인에서도 열린다)', () => {
  const files = JSON.parse(read('precache-manifest.json'));
  assert.ok(files.includes('privacy.html'), 'precache-manifest.json 에 privacy.html');
  assert.ok(files.includes('css/privacy.css'), 'precache-manifest.json 에 css/privacy.css');
  assert.match(read('tests/release-lib.mjs'), /TOP_LEVEL = \[[^\]]*'privacy\.html'/);
});

// ───────── i18n: 회원 창·메뉴의 한국어 문구가 모두 영어로 번역된다 ─────────
function englishTranslator() {
  const context = vm.createContext({ console: { warn() {} }, navigator: { language: 'ko-KR' }, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(read('js/i18n.js'), context);
  context.SF.i18n.setLanguage('en', { persist: false });
  return text => context.SF.i18n.translate(text);
}
const hangul = /[가-힣]/;

test('P8-4 i18n: 회원 창(#dlg-auth)·회원 메뉴·관리자 창 마크업의 한국어 문구는 모두 영어로 번역된다', () => {
  const en = englishTranslator();
  for (const open of ['<dialog id="dlg-auth">', '<div class="authbar"', '<dialog id="dlg-admin">']) {
    const part = section(html, open);
    const texts = new Set();
    for (const m of part.matchAll(/>([^<>]*[가-힣][^<>]*)</g)) texts.add(m[1].trim());
    for (const m of part.matchAll(/\b(?:title|placeholder|aria-label)="([^"]*[가-힣][^"]*)"/g)) texts.add(m[1].trim());
    assert.ok(texts.size >= 5, `${open}: 문구를 찾지 못함`);
    for (const text of texts) assert.equal(hangul.test(en(text)), false, `${open}: "${text}" 의 영어 문구가 없다 — js/i18n.js의 auth 그룹에 같은 한국어로 추가`);
  }
});

test('P8-4 i18n: js/auth.js가 화면에 내는 한국어 문구(토스트·안내·대화상자)는 모두 영어로 번역된다', () => {
  const en = englishTranslator();
  const source = read('js/auth.js');
  const literals = new Set();
  for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) if (hangul.test(m[1]) && !m[1].includes('${')) literals.add(m[1].replace(/\\"/g, '"'));
  for (const m of source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) if (hangul.test(m[1]) && !m[1].includes('${')) literals.add(m[1].replace(/\\'/g, "'"));
  for (const m of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) if (hangul.test(m[1]) && !m[1].includes('${')) literals.add(m[1]);
  // 화면 문구가 아닌 조각: 주석 속 인용, 상태 글자의 앞부분(" · 관리자" 등은 패턴으로 번역), 관리자 목록 마크업(DOM 번역 대상)
  // '탈퇴'는 탈퇴 확인 칸에 사용자가 직접 치는 낱말(DELETE_WORDS)이지 화면 문구가 아니다.
  const notUi = new Set(['사용자 지정 연결', ' · 관리자', ' · 회원', '탈퇴']);
  const missing = [...literals].filter(text => !notUi.has(text) && !/^<div class="admin-empty">/.test(text) && hangul.test(en(text)));
  assert.deepEqual(missing, [], '영어 문구가 없는 한국어 문구 — js/i18n.js의 auth 그룹에 추가(화면 문구가 아니면 이 시험의 notUi에)');
  assert.ok(literals.size >= 50, `문구 ${literals.size}개`);
  for (const sentence of ['요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.', '기본 연결로 돌아왔어요.', '새 비밀번호 설정', '비밀번호를 바꿨어요']) {
    assert.ok(literals.has(sentence), `${sentence} 는 auth.js에 있어야 한다`);
  }
});
