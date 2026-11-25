// P8-4: 계정 기능·노출 정리 — 실제 브라우저에서 확인한다.
//  a. 연결 설정 숨김(개발 모드·사용자 지정 연결 띠)   b. 관리자 버튼   c. 비밀번호 재설정   d. 탈퇴(꺼짐)   e. 개인정보 고지·가입 동의
// Supabase 요청은 모두 page.route로 가로채 실제 서버에는 접속하지 않는다(요청 내용만 기록한다).
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/account-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
import { inspectShipState } from './project-switch-lib.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;

// 기본 연결(주소·세션 키 이름)은 js/config.js에서 읽는다 — Supabase 프로젝트를 분리(D1)해 config.js가 바뀌어도 이 시험이 그대로 통과하도록.
const DEFAULT_URL = /^\s*url:\s*"(https:\/\/[^"\s]+)"/m.exec(readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'))[1];
const DEFAULT_REF = new URL(DEFAULT_URL).hostname.split('.')[0];
const CUSTOM = { url: 'https://example-custom.supabase.co', key: 'sb_publishable_customKeyForTests123' };
// 탈퇴 플래그의 출하 값. D1(분리) 전에는 꺼져 있다. 사람이 새 프로젝트로 전환하며 켠 뒤에는 "꺼진 상태" 시험이 값을 직접 꺼 두고(off) 돌려서 같은 동작을 본다.
// (켜진 상태의 동작은 아래 flag: true 시험들이 값을 직접 켜서 본다. 출하 값이 D1 규칙을 지키는지는 tests/account.test.mjs가 본다.)
const SHIPPED_DELETE_ON = inspectShipState({ configText: readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), vercelText: readFileSync(new URL('../vercel.json', import.meta.url), 'utf8') }).deleteAccount === true;

// page.route 핸들러가 부르는 기본 응답. 시험이 handler를 주면 그것이 먼저 받는다(true를 돌려주면 처리한 것).
// allowConnect: 문서의 CSP connect-src에 더할 주소. 배포 CSP(vercel.json)는 Supabase 프로젝트 분리(D1) 뒤 한 프로젝트로 좁혀지는데,
// 개발 모드의 "사용자 지정 연결"을 확인하는 시험은 다른 주소(CUSTOM)로 요청을 보내야 하므로 그 시험에서만 그 주소를 연다(서버·앱 코드는 그대로).
async function withPage(fn, { path = '/', size = { width: 1200, height: 800 }, init, initArg, handler, timeout, allowConnect } = {}) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: size }));
    const page = await context.newPage();
    await preparePage(page);
    page.setDefaultTimeout(timeout || 10000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const calls = [];
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    if (init) await page.addInitScript(init, initArg);
    if (allowConnect) {
      await page.route(url => url.origin === new URL(URL_).origin && /^\/(index\.html)?$/.test(url.pathname), async route => {
        if (!route.request().isNavigationRequest()) return route.fallback();
        const response = await route.fetch();
        const headers = response.headers();
        if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace('connect-src ', `connect-src ${allowConnect} `);
        return route.fulfill({ response, headers });
      });
    }
    await page.route(/^https:\/\/[^/]*\.supabase\.co\//, async route => {
      const request = route.request();
      let body = null;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      const call = { method: request.method(), url: request.url(), body, headers: request.headers() };
      calls.push(call);
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (handler && await handler(route, call, calls)) return;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    });
    await page.goto(URL_ + path, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());
    await fn(page, calls);
    assert.deepEqual(pageErrors, [], '페이지 오류 없음');
  } finally {
    await browser.close();
  }
}

// ───────── 공용: Supabase 가짜 응답(로그인·프로필·사용자 정보) ─────────
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_KEY = `sb-${DEFAULT_REF}-auth-token`;   // supabase-js가 기본 프로젝트 세션을 두는 localStorage 키
function authMock(options = {}) {
  const state = { role: 'member', email: 'member@example.com', profileFails: false, ...options };
  const user = () => ({ id: USER_ID, aud: 'authenticated', role: 'authenticated', email: state.email, app_metadata: {}, user_metadata: { display_name: '테스터' }, created_at: '2026-01-01T00:00:00Z' });
  const session = (accessToken = 'aaa.bbb.ccc') => ({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-1', user: user() });
  const cors = { 'access-control-allow-origin': '*' };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  const handler = async (route, call) => {
    const url = new URL(call.url);
    const path = url.pathname;
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      // state.password가 정해져 있으면(탈퇴 시험의 재인증) 그 값만 통과시킨다. 정해지지 않았으면 예전처럼 모두 통과.
      if (state.password !== undefined && !(call.body && call.body.password === state.password)) { await json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); return true; }
      await json(route, 200, session(state.reauthToken)); return true;
    }
    if (path === '/auth/v1/user') { await json(route, 200, user()); return true; }
    if (path === '/auth/v1/signup') { await json(route, 200, user()); return true; }   // 이메일 확인이 켜져 있는 것처럼 세션 없이 사용자만
    if (path === '/auth/v1/logout') { await route.fulfill({ status: 204, headers: cors }); return true; }
    if (path === '/rest/v1/profiles') {
      if (call.method === 'POST') { await route.fulfill({ status: 201, headers: cors, body: '' }); return true; }
      if (state.profileFails) { await json(route, 500, { message: 'profiles unavailable' }); return true; }
      const row = { id: USER_ID, email: state.email, display_name: '테스터', role: state.role, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
      // 내 프로필(id=eq.…, maybeSingle)은 한 줄, 회원 목록(관리자 페이지)은 여러 줄
      const own = (url.searchParams.get('id') || '').startsWith('eq.');
      await json(route, 200, own ? [row] : [row, { id: '33333333-3333-4333-8333-333333333333', email: 'other@example.com', display_name: '다른 회원', role: 'member', created_at: '2026-02-01T00:00:00Z' }]);
      return true;
    }
    return false;
  };
  return { state, handler, session, user };
}
// 이미 로그인돼 있던 것처럼 기본 프로젝트 세션을 심는다
const seedSession = ({ key, session }) => localStorage.setItem(key, JSON.stringify(session));
const signIn = async (page, email = 'member@example.com', password = 'secret123') => {
  await openLogin(page);
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.click('#auth-submit');
  await page.waitForFunction(() => !document.querySelector('#dlg-auth').open);
};

const openLogin = async page => { await page.click('#btn-member-login'); await page.waitForFunction(() => document.querySelector('#dlg-auth').open); };
const visible = (page, selector) => page.isVisible(selector);

// ───────── a. 연결 설정 숨김 ─────────
test('P8-4a 처음 열면 Supabase 연결 칸과 사용자 지정 연결 띠가 보이지 않는다(일반 사용자 화면)', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    assert.equal(await page.evaluate(() => SF.auth.isDevMode()), false);
    await openLogin(page);
    for (const sel of ['#auth-config', '#supabase-url', '#supabase-key', '#btn-save-supabase-config', '#btn-clear-supabase-config', '#auth-custom-banner']) assert.equal(await visible(page, sel), false, `${sel} 숨김`);
    assert.equal(await visible(page, '#auth-email'), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'auth-email', '포커스는 이메일 칸');
    assert.doesNotMatch(await page.textContent('#auth-message'), /연결 정보/, '일반 사용자에게 연결 정보를 저장하라고 하지 않는다');
  });
});

test('P8-4a ?dev=1 로 열면 연결 칸이 보이고 기본 연결 주소가 채워져 있다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    assert.equal(await page.evaluate(() => SF.auth.isDevMode()), true);
    await openLogin(page);
    assert.equal(await visible(page, '#auth-config'), true);
    assert.equal(await page.inputValue('#supabase-url'), DEFAULT_URL);
    assert.equal(await page.getAttribute('#supabase-key', 'type'), 'password', '키 칸은 가려 둔다');
    assert.equal(await visible(page, '#auth-custom-banner'), false, '기본 연결이면 띠가 없다');
  }, { path: '/?dev=1' });
});

test('P8-4a localStorage scoreforge.dev 가 "1"이면 개발 모드, "0"이면 아니다', { skip, timeout: 90000 }, async () => {
  for (const [value, expected] of [['1', true], ['true', true], ['0', false], ['', false]]) {
    await withPage(async page => {
      assert.equal(await page.evaluate(() => SF.auth.isDevMode()), expected, `scoreforge.dev=${JSON.stringify(value)}`);
      await openLogin(page);
      assert.equal(await visible(page, '#auth-config'), expected);
    }, { init: v => localStorage.setItem('scoreforge.dev', v), initArg: value });
  }
});

test('P8-4a 저장된 사용자 지정 연결이 있으면 개발 모드가 아니어도 띠가 보이고, [기본값으로]가 기본 연결로 되돌린다', { skip, timeout: 90000 }, async () => {
  await withPage(async (page, calls) => {
    await openLogin(page);
    assert.equal(await visible(page, '#auth-config'), false, '연결 칸은 여전히 숨김');
    assert.equal(await visible(page, '#auth-custom-banner'), true);
    assert.match(await page.textContent('#auth-custom-banner'), /사용자 지정 연결 사용 중\s*·\s*기본값으로/);
    assert.equal(await page.evaluate(() => SF.auth.state.configSig.split('|')[0]), CUSTOM.url, '지금은 사용자 지정 연결을 쓰는 중');

    await page.click('#btn-reset-default-connection');
    await page.waitForFunction(() => !localStorage.getItem('scoreforge.supabase.url'));
    assert.equal(await page.evaluate(() => localStorage.getItem('scoreforge.supabase.publishableKey')), null);
    await page.waitForFunction(() => document.querySelector('#auth-custom-banner').hidden);
    assert.equal(await visible(page, '#auth-custom-banner'), false);
    assert.match(await page.textContent('#auth-message'), /기본 연결로 돌아왔어요/);
    assert.equal(await page.evaluate(() => SF.auth.state.configSig.split('|')[0]), DEFAULT_URL, '기본 연결의 클라이언트로 바뀌었다');
    assert.equal(calls.some(c => c.method === 'POST' && /\/logout/.test(c.url) && /scope=global/.test(c.url)), false, '다른 기기의 로그인까지 끊지 않는다');
  }, { init: c => { localStorage.setItem('scoreforge.supabase.url', c.url); localStorage.setItem('scoreforge.supabase.publishableKey', c.key); }, initArg: CUSTOM, allowConnect: CUSTOM.url });
});

test('P8-4a 저장된 값이 기본 연결과 같으면 사용자 지정이 아니다(띠 없음)', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    const key = await page.evaluate(() => window.SF_SUPABASE_CONFIG.publishableKey);
    await page.evaluate(([u, k]) => { localStorage.setItem('scoreforge.supabase.url', u); localStorage.setItem('scoreforge.supabase.publishableKey', k); }, [`${DEFAULT_URL}/`, key]);
    await openLogin(page);
    assert.equal(await page.evaluate(() => SF.auth.hasCustomConnection()), false, '끝의 /는 무시하고 비교');
    assert.equal(await visible(page, '#auth-custom-banner'), false);
  });
});

test('P8-4a 개발 모드에서 연결을 저장하면 띠가 나타나고, 개발 모드의 [초기화]는 띠를 지운다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    await openLogin(page);
    await page.fill('#supabase-url', CUSTOM.url);
    await page.fill('#supabase-key', CUSTOM.key);
    await page.click('#btn-save-supabase-config');
    await page.waitForFunction(() => !document.querySelector('#auth-custom-banner').hidden);
    assert.equal(await page.evaluate(() => localStorage.getItem('scoreforge.supabase.url')), CUSTOM.url);
    await page.click('#btn-clear-supabase-config');
    await page.waitForFunction(() => document.querySelector('#auth-custom-banner').hidden);
    assert.equal(await page.evaluate(() => localStorage.getItem('scoreforge.supabase.url')), null);
    assert.equal(await page.inputValue('#supabase-url'), DEFAULT_URL, '칸에는 기본 연결이 다시 채워진다');
    assert.match(await page.textContent('#auth-message'), /연결 설정을 초기화했어요/);
  }, { path: '/?dev=1', allowConnect: CUSTOM.url });
});

test('P8-4a 연결이 아예 설정되지 않은 배포(포크)에서는 일반 사용자에게 안내만 하고 저장·요청을 하지 않는다', { skip, timeout: 90000 }, async () => {
  await withPage(async (page, calls) => {
    await openLogin(page);
    assert.match(await page.textContent('#auth-message'), /이 주소에서는 회원 기능을 쓸 수 없어요/);
    await page.fill('#auth-email', 'a@example.com');
    await page.fill('#auth-password', 'secret1');
    await page.click('#auth-submit');
    assert.match(await page.textContent('#auth-message'), /이 주소에서는 회원 기능을 쓸 수 없어요/);
    assert.equal(await page.evaluate(() => localStorage.getItem('scoreforge.supabase.url')), null, '아무것도 저장하지 않는다');
    assert.deepEqual(calls.filter(c => c.method !== 'OPTIONS'), [], 'Supabase로 요청을 보내지 않는다');
  }, { init: () => { window.SF_SUPABASE_CONFIG = { url: '', publishableKey: '' }; } });
});

test('P8-4a 사용자 지정 연결에 로그인돼 있어도 [기본값으로]는 이 기기에서만 로그아웃한다(scope=local)', { skip, timeout: 90000 }, async () => {
  const seed = ({ custom }) => {
    localStorage.setItem('scoreforge.supabase.url', custom.url);
    localStorage.setItem('scoreforge.supabase.publishableKey', custom.key);
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('sb-example-custom-auth-token', JSON.stringify({
      access_token: 'aaa.bbb.ccc', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', email: 'custom@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  };
  await withPage(async (page, calls) => {
    await page.waitForFunction(() => SF.auth.state.session?.user?.email === 'custom@example.com');
    assert.equal(await visible(page, '#btn-member-login'), false, '로그인돼 있어서 로그인 버튼은 숨김 — 대화상자는 코드로 연다');
    await page.evaluate(() => SF.auth.openDialog('member'));
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    await page.click('#btn-reset-default-connection');
    await page.waitForFunction(() => !localStorage.getItem('scoreforge.supabase.url'));
    const logouts = calls.filter(c => /\/auth\/v1\/logout/.test(c.url));
    assert.equal(logouts.length, 1, `로그아웃 요청 1건: ${JSON.stringify(logouts.map(c => c.url))}`);
    assert.match(logouts[0].url, /scope=local/);
    assert.equal(logouts[0].url.startsWith(CUSTOM.url), true, '로그아웃은 사용자 지정 연결(지금 쓰던 곳)에 보낸다');
    assert.equal(await page.evaluate(() => SF.auth.state.session), null);
  }, { init: seed, initArg: { custom: CUSTOM }, allowConnect: CUSTOM.url });
});

test('P8-4a [기본값으로] 뒤에는 기본 연결로 다시 시작해, 기본 연결에 남아 있던 로그인을 읽어 온다', { skip, timeout: 90000 }, async () => {
  const seed = ({ custom, defaultKey }) => {
    localStorage.setItem('scoreforge.supabase.url', custom.url);
    localStorage.setItem('scoreforge.supabase.publishableKey', custom.key);
    const now = Math.floor(Date.now() / 1000);
    const session = email => ({ access_token: 'aaa.bbb.ccc', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
    localStorage.setItem('sb-example-custom-auth-token', JSON.stringify(session('custom@example.com')));
    localStorage.setItem(defaultKey, JSON.stringify(session('default@example.com')));
  };
  await withPage(async page => {
    await page.waitForFunction(() => SF.auth.state.session?.user?.email === 'custom@example.com');
    assert.equal(await page.evaluate(() => SF.auth.hasCustomConnection()), true);
    await page.evaluate(() => SF.auth.openDialog('member'));
    await page.click('#btn-reset-default-connection');
    // 화면 글자는 프로필을 읽은 뒤에야 바뀐다 — 세션만 보고 바로 읽지 말고 화면이 바뀔 때까지 기다린다.
    await page.waitForFunction(() => /default@example\.com/.test(document.querySelector('#auth-status').textContent) && /기본 연결로 돌아왔어요/.test(document.querySelector('#auth-message').textContent));
    assert.equal(await page.evaluate(() => SF.auth.state.session?.user?.email), 'default@example.com');
    assert.equal(await page.evaluate(() => SF.auth.hasCustomConnection()), false);
  }, { init: seed, initArg: { custom: CUSTOM, defaultKey: SESSION_KEY }, allowConnect: CUSTOM.url });
});

// ───────── b. 관리자 버튼 ─────────
test('P8-4b 로그인 전에는 "관리자 로그인"이 없고 "관리자 페이지"도 보이지 않는다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    assert.equal(await page.locator('#btn-admin-login').count(), 0);
    assert.equal(await page.getByText('관리자 로그인').count(), 0);
    assert.equal(await visible(page, '#btn-admin-page'), false);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.authbar button')].filter(b => !b.hidden).map(b => b.id)), ['btn-signup', 'btn-member-login']);
  });
});

test('P8-4b 일반 회원이 로그인해도 "관리자 페이지"는 보이지 않는다', { skip, timeout: 90000 }, async () => {
  const mock = authMock({ role: 'member' });
  await withPage(async page => {
    await signIn(page);
    await page.waitForFunction(() => SF.auth.state.profile?.role === 'member' && !SF.auth.state.profile.profileError);
    assert.match(await page.textContent('#auth-status'), /member@example\.com · 회원/);
    assert.equal(await visible(page, '#btn-logout'), true);
    assert.equal(await visible(page, '#btn-admin-page'), false);
  }, { handler: mock.handler });
});

test('P8-4b 관리자도 일반 로그인으로 들어가고, 그러면 "관리자 페이지"가 나타나며 저절로 열리지는 않는다', { skip, timeout: 90000 }, async () => {
  const mock = authMock({ role: 'admin', email: 'admin@example.com' });
  await withPage(async page => {
    await signIn(page, 'admin@example.com');
    await page.waitForFunction(() => !document.querySelector('#btn-admin-page').hidden);
    assert.match(await page.textContent('#auth-status'), /admin@example\.com · 관리자/);
    assert.match(await page.textContent('#toast'), /회원 로그인 완료/);
    assert.equal(await page.evaluate(() => document.querySelector('#dlg-admin').open), false, '관리자 페이지는 누를 때만 열린다');
    await page.click('#btn-admin-page');
    await page.waitForFunction(() => document.querySelector('#dlg-admin').open);
    await page.waitForSelector('#admin-users table');
    assert.match(await page.textContent('#admin-summary'), /admin@example\.com/);
    assert.match(await page.textContent('#admin-users'), /other@example\.com/);
    await page.keyboard.press('Escape');
    await page.click('#btn-logout');
    await page.waitForFunction(() => document.querySelector('#btn-admin-page').hidden);
    assert.equal(await visible(page, '#btn-admin-page'), false, '로그아웃하면 다시 숨는다');
  }, { handler: mock.handler });
});

test('P8-4b 이미 로그인돼 있던 관리자는 열자마자 "관리자 페이지"가 보인다(부팅 복원)', { skip, timeout: 90000 }, async () => {
  const mock = authMock({ role: 'admin', email: 'admin@example.com' });
  await withPage(async page => {
    await page.waitForFunction(() => !document.querySelector('#btn-admin-page').hidden);
    assert.equal(await visible(page, '#btn-admin-page'), true);
    assert.equal(await visible(page, '#btn-member-login'), false);
  }, { handler: mock.handler, init: seedSession, initArg: { key: SESSION_KEY, session: mock.session() } });
});

test('P8-4b 프로필을 읽지 못하면(오류) 관리자로 보지 않는다', { skip, timeout: 90000 }, async () => {
  const mock = authMock({ role: 'admin', email: 'admin@example.com', profileFails: true });
  await withPage(async page => {
    await page.waitForFunction(() => SF.auth.state.session?.user && SF.auth.state.profile?.profileError);
    assert.equal(await visible(page, '#btn-admin-page'), false);
    assert.doesNotMatch(await page.textContent('#auth-status'), /관리자/);
  }, { handler: mock.handler, init: seedSession, initArg: { key: SESSION_KEY, session: mock.session() } });
});

test('P8-4b 권한 없이 관리자 페이지가 불리면 일반 로그인 창을 열고 안내한다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    await page.evaluate(() => document.querySelector('#btn-admin-page').click());   // 숨겨진 버튼도 코드로는 누를 수 있다
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.equal(await page.textContent('#auth-title'), '회원 로그인', '관리자 전용 로그인 창은 없다');
    assert.match(await page.textContent('#auth-message'), /관리자 권한이 필요합니다/);
    assert.equal(await page.evaluate(() => document.querySelector('#dlg-admin').open), false);
    await page.evaluate(() => { document.querySelector('#dlg-auth').close(); SF.auth.openDialog('admin'); });
    assert.equal(await page.textContent('#auth-title'), '회원 로그인', '알 수 없는 모드는 일반 로그인으로');
  });
});

// ───────── c. 비밀번호 재설정 ─────────
const putUser = calls => calls.filter(c => c.method === 'PUT' && /\/auth\/v1\/user/.test(c.url));
// 노드 쪽 기록(calls)이 원하는 모양이 될 때까지 기다린다(대화상자가 닫힌 직후에는 요청이 아직 가는 중일 수 있다)
const until = async (check, message, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail(message);
};
const promptOpen = page => page.evaluate(() => Boolean(document.querySelector('#dlg-prompt')?.open));
const RECOVERY_HASH = '#access_token=aaa.bbb.ccc&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery';
const toastText = page => page.evaluate(() => document.querySelector('#toast').textContent);

test('P8-4c "비밀번호를 잊으셨나요?"는 로그인 창에만 있고 가입 창에서는 숨는다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    await openLogin(page);
    assert.equal(await visible(page, '#btn-forgot-password'), true);
    await page.keyboard.press('Escape');
    await page.click('#btn-signup');
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.equal(await visible(page, '#btn-forgot-password'), false);
  });
});

test('P8-4c 재설정 메일 요청: 이메일을 확인한 뒤 recover 요청을 보내고, 돌아올 주소는 <origin>/?auth=recovery', { skip, timeout: 90000 }, async () => {
  await withPage(async (page, calls) => {
    await openLogin(page);
    await page.click('#btn-forgot-password');
    assert.match(await page.textContent('#auth-message'), /이메일을 입력하세요/);
    await page.fill('#auth-email', '잘못된주소');
    await page.click('#btn-forgot-password');
    assert.match(await page.textContent('#auth-message'), /이메일 형식이 올바르지 않아요/);
    assert.equal(calls.filter(c => /\/auth\/v1\/recover/.test(c.url)).length, 0, '확인을 통과하기 전에는 요청하지 않는다');

    await page.fill('#auth-email', 'someone@example.com');
    await page.click('#btn-forgot-password');
    await page.waitForFunction(() => /메일이 곧 도착해요/.test(document.querySelector('#auth-message').textContent));
    const recover = calls.filter(c => c.method === 'POST' && /\/auth\/v1\/recover/.test(c.url));
    assert.equal(recover.length, 1);
    assert.equal(recover[0].body.email, 'someone@example.com');
    assert.equal(new URL(recover[0].url).searchParams.get('redirect_to'), `${URL_}/?auth=recovery`);
    assert.equal(await page.evaluate(() => document.querySelector('#auth-message').classList.contains('ok')), true);
    assert.equal(await page.isEnabled('#btn-forgot-password'), true, '요청이 끝나면 버튼이 다시 켜진다');
    assert.equal(await page.evaluate(() => document.querySelector('#dlg-auth').open), true, '창은 그대로 둔다');
  });
});

test('P8-4c 재설정 메일 요청이 너무 잦으면(429) 한국어로 안내하고, 서버 오류 문구를 그대로 보이지 않는다', { skip, timeout: 90000 }, async () => {
  const handler = async (route, call) => {
    if (!/\/auth\/v1\/recover/.test(call.url)) return false;
    await route.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }) });
    return true;
  };
  await withPage(async page => {
    await openLogin(page);
    await page.fill('#auth-email', 'someone@example.com');
    await page.click('#btn-forgot-password');
    await page.waitForFunction(() => /너무 잦아요/.test(document.querySelector('#auth-message').textContent));
    assert.equal(await page.evaluate(() => document.querySelector('#auth-message').classList.contains('error')), true);
    assert.doesNotMatch(await page.textContent('#auth-message'), /rate limit/);
  }, { handler });
});

test('P8-4c 복구 링크로 돌아오면 새 비밀번호 창이 열리고, 짧은 비밀번호는 거절하며, 바꾸면 PUT /user 로 보낸다', { skip, timeout: 90000 }, async () => {
  const mock = authMock({ email: 'member@example.com' });
  await withPage(async (page, calls) => {
    await page.waitForFunction(() => document.querySelector('#dlg-prompt')?.open);
    assert.equal(await page.textContent('#dlg-prompt h2'), '새 비밀번호 설정');
    assert.equal(await page.getAttribute('#prompt-value', 'type'), 'password');
    assert.equal(await page.getAttribute('#prompt-value', 'autocomplete'), 'new-password');
    const here = new URL(page.url());
    assert.equal(here.searchParams.has('auth'), false, '주소의 auth 값은 지워졌다');
    assert.equal(here.hash, '', '주소에 토큰 조각이 남지 않는다');
    assert.equal(await page.evaluate(() => SF.auth.state.session?.user?.email), 'member@example.com', '복구 링크가 만든 세션으로 로그인된 상태');

    await page.fill('#prompt-value', '123');
    await page.click('#dlg-prompt button[type=submit]');
    assert.match(await page.textContent('#prompt-error'), /6자 이상/);
    assert.equal(putUser(calls).length, 0, '짧은 비밀번호는 보내지 않는다');

    await page.fill('#prompt-value', 'newpass1');
    await page.click('#dlg-prompt button[type=submit]');
    await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
    await until(() => putUser(calls).length === 1, 'PUT /user 요청이 가야 한다');
    assert.equal(putUser(calls)[0].body.password, 'newpass1', '새 비밀번호가 요청 본문에 실린다(라이브러리가 덧붙이는 code_challenge는 비교하지 않는다)');
    assert.equal(putUser(calls)[0].headers.authorization, 'Bearer aaa.bbb.ccc', '복구 세션의 토큰으로 요청');
    await page.waitForFunction(() => /비밀번호를 바꿨어요/.test(document.querySelector('#toast').textContent));
  }, { path: '/?auth=recovery' + RECOVERY_HASH, handler: mock.handler });
});

test('P8-4c 새 비밀번호 창에서 취소하면 비밀번호는 그대로이고 요청도 없다', { skip, timeout: 90000 }, async () => {
  const mock = authMock();
  await withPage(async (page, calls) => {
    await page.waitForFunction(() => document.querySelector('#dlg-prompt')?.open);
    await page.click('#dlg-prompt .dlg-actions button[type=button]');
    await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
    assert.match(await toastText(page), /비밀번호는 바꾸지 않았어요/);
    assert.equal(putUser(calls).length, 0);
    assert.equal(await page.evaluate(() => SF.auth.state.session?.user?.email), 'member@example.com');
  }, { path: '/?auth=recovery' + RECOVERY_HASH, handler: mock.handler });
});

test('P8-4c 서버가 새 비밀번호를 거절하면(이전과 같음) 이유를 보여 주고 다시 묻는다', { skip, timeout: 90000 }, async () => {
  const mock = authMock();
  let first = true;
  const handler = async (route, call, calls) => {
    if (call.method === 'PUT' && /\/auth\/v1\/user/.test(call.url) && first) {
      first = false;
      await route.fulfill({ status: 422, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }) });
      return true;
    }
    return mock.handler(route, call, calls);
  };
  await withPage(async (page, calls) => {
    await page.waitForFunction(() => document.querySelector('#dlg-prompt')?.open);
    await page.fill('#prompt-value', 'oldpass1');
    await page.click('#dlg-prompt button[type=submit]');
    await page.waitForFunction(() => /이전과 다른 비밀번호를 입력하세요/.test(document.querySelector('#dlg-prompt p')?.textContent || ''));
    assert.equal(await promptOpen(page), true, '창이 다시 열려 있다');
    await page.fill('#prompt-value', 'brandnew1');
    await page.click('#dlg-prompt button[type=submit]');
    await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
    await until(() => putUser(calls).length === 2, '두 번째 PUT /user 요청이 가야 한다');
    assert.deepEqual(putUser(calls).map(c => c.body.password), ['oldpass1', 'brandnew1']);
    await page.waitForFunction(() => /비밀번호를 바꿨어요/.test(document.querySelector('#toast').textContent));
  }, { path: '/?auth=recovery' + RECOVERY_HASH, handler });
});

test('P8-4c 만료됐거나 이미 쓴 링크(#error=…)로 돌아오면 로그인 창에서 안내하고 주소를 정리한다', { skip, timeout: 90000 }, async () => {
  await withPage(async (page, calls) => {
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.match(await page.textContent('#auth-message'), /재설정 링크가 만료됐거나 이미 사용됐어요/);
    assert.equal(await page.evaluate(() => document.querySelector('#auth-message').classList.contains('error')), true);
    assert.equal(await promptOpen(page), false, '새 비밀번호 창은 열지 않는다');
    assert.equal(await visible(page, '#btn-forgot-password'), true, '바로 메일을 다시 받을 수 있다');
    const here = new URL(page.url());
    assert.equal(here.searchParams.has('auth'), false);
    assert.equal(here.searchParams.has('code'), false, '쓸 수 없게 된 인증 코드도 주소에서 지운다');
    assert.equal(here.hash, '');
    assert.equal(putUser(calls).length, 0);
  }, { path: '/?auth=recovery&code=stale-code#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
});

test('P8-4c ?auth=recovery만 있고 토큰이 없으면 조용히 주소만 정리하고, 다른 주소 값은 지키며 창은 열지 않는다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('auth'));
    assert.equal(new URL(page.url()).searchParams.get('keep'), '1', '관계없는 주소 값은 남긴다');
    assert.equal(await page.evaluate(() => document.querySelector('#dlg-auth').open), false);
    assert.equal(await promptOpen(page), false);
  }, { path: '/?auth=recovery&keep=1' });
});

// ───────── d. 탈퇴(플래그가 꺼진 채로 출하, 시험에서만 켠다) ─────────
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const QUEUE_KEY = 'scoreforge.cloud.queue.v1';
const PASSWORD = 'right-pass-1';
// 페이지가 열리기 전에 실행: 세션 심기 · (선택) 플래그 켜기 · (선택) 오프라인으로 보이게 해 저장 대기 작업이 서버로 나가지 않게 하기
function deleteInit({ key, session, flag, off, offline }) {
  if (session) localStorage.setItem(key, JSON.stringify(session));
  if (flag) window.SF_FEATURES = { deleteAccount: true };
  if (off) window.SF_FEATURES = { deleteAccount: false };
  if (offline) Object.defineProperty(navigator, 'onLine', { get: () => false });
}
const fnCalls = calls => calls.filter(c => /\/functions\/v1\/delete-account/.test(c.url) && c.method === 'POST');
const reauthCalls = calls => calls.filter(c => c.method === 'POST' && /\/auth\/v1\/token/.test(c.url) && /grant_type=password/.test(c.url));
const logoutCalls = calls => calls.filter(c => /\/auth\/v1\/logout/.test(c.url));
// authMock + Edge Function 가짜(functionStatus: 응답 코드, 'network'는 연결 실패)
function deleteMock({ functionStatus = 204, functionBody = '', ...options } = {}) {
  const mock = authMock({ password: PASSWORD, ...options });
  const handler = async (route, call, calls) => {
    if (new URL(call.url).pathname === '/functions/v1/delete-account') {
      if (functionStatus === 'network') { await route.abort('failed'); return true; }
      // 실제 함수의 성공 응답처럼 본문이 없으면 content-type도 없다(있으면 supabase-js가 빈 본문을 JSON으로 읽다 실패한다)
      await route.fulfill({ status: functionStatus, headers: { 'access-control-allow-origin': '*', ...(functionBody ? { 'content-type': 'application/json' } : {}) }, body: functionBody });
      return true;
    }
    return mock.handler(route, call, calls);
  };
  return { ...mock, handler };
}
const flagInit = (mock, extra = {}) => ({ init: deleteInit, initArg: { key: SESSION_KEY, session: mock.session(), flag: true, ...extra }, handler: mock.handler });
const signedInAs = page => page.waitForFunction(id => SF.auth.state.session?.user?.id === id, USER_ID);
const promptTitle = page => page.evaluate(() => document.querySelector('#dlg-prompt h2')?.textContent || '');
const promptNote = page => page.evaluate(() => document.querySelector('#dlg-prompt p')?.textContent || '');
const answerPrompt = async (page, value) => {
  await page.waitForFunction(() => document.querySelector('#dlg-prompt')?.open);
  await page.fill('#prompt-value', value);
  await page.click('#dlg-prompt button[type=submit]');
};
const waitPromptTitle = (page, title) => page.waitForFunction(t => document.querySelector('#dlg-prompt h2')?.textContent === t, title);
const startDelete = async page => { await page.click('#btn-delete-account'); await waitPromptTitle(page, '회원 탈퇴'); };
const appReady = async page => {
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
};
// 저장 대기 작업을 하나 만들고(편집), 다른 계정의 것도 하나 끼워 넣은 뒤 다시 읽는다. 이 계정의 것만 지워지는지 보기 위한 준비.
async function queueTwoOwners(page) {
  await signedInAs(page);
  await page.evaluate(() => SF.core.mutate('시험 편집', score => { score.meta.title = '탈퇴 시험 악보'; }));
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').length === 1, QUEUE_KEY);
  await page.evaluate(([key, other]) => {
    const jobs = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify([...jobs, { ...jobs[0], key: crypto.randomUUID(), insertId: crypto.randomUUID(), owner: other }]));
  }, [QUEUE_KEY, OTHER_ID]);
  await page.reload({ waitUntil: 'networkidle' });
  await appReady(page);
  await signedInAs(page);
  assert.deepEqual(await queueOwners(page), [USER_ID, OTHER_ID], '두 계정의 대기 작업이 준비됐다');
}
const queueOwners = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]').map(job => job.owner), QUEUE_KEY);

test('P8-4d 플래그가 꺼져 있으면(D1 전의 출하 값): 로그인해도 탈퇴 버튼이 안 보이고, 코드로 불러도 요청이 한 건도 가지 않는다', { skip, timeout: 90000 }, async () => {
  const mock = deleteMock();
  await withPage(async (page, calls) => {
    await signedInAs(page);
    assert.equal(await page.evaluate(() => window.SF_FEATURES.deleteAccount), false, SHIPPED_DELETE_ON ? '시험이 꺼 둔 값' : '출하 값');
    assert.equal(await visible(page, '#btn-logout'), true, '로그인 상태');
    assert.equal(await visible(page, '#btn-delete-account'), false);
    const before = calls.length;
    assert.deepEqual(await page.evaluate(() => SF.auth.deleteAccount()), { ok: false, reason: 'disabled' });
    await page.evaluate(() => document.querySelector('#btn-delete-account').click());   // 숨겨진 버튼도 코드로는 누를 수 있다
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await promptOpen(page), false, '대화상자가 열리지 않는다');
    assert.equal(calls.length, before, '요청이 한 건도 없다');
    assert.equal(fnCalls(calls).length, 0);
    assert.equal(reauthCalls(calls).length, 0);
  }, { init: deleteInit, initArg: { key: SESSION_KEY, session: mock.session(), off: SHIPPED_DELETE_ON }, handler: mock.handler });
});

test('P8-4d 주소(?deleteAccount=1…)나 localStorage 값으로는 켜지지 않는다', { skip, timeout: 90000 }, async () => {
  const mock = deleteMock();
  await withPage(async (page, calls) => {
    await signedInAs(page);
    assert.equal(await page.evaluate(() => SF.auth.deleteEnabled()), false);
    assert.equal(await visible(page, '#btn-delete-account'), false);
    assert.deepEqual(await page.evaluate(() => SF.auth.deleteAccount()), { ok: false, reason: 'disabled' });
    assert.equal(fnCalls(calls).length + reauthCalls(calls).length, 0);
  }, { path: '/?deleteAccount=1&features=deleteAccount&dev=1',
    init: ({ key, session, off }) => {
      localStorage.setItem(key, JSON.stringify(session));
      if (off) window.SF_FEATURES = { deleteAccount: false };
      for (const name of ['scoreforge.deleteAccount', 'scoreforge.features', 'scoreforge.features.deleteAccount', 'SF_FEATURES']) localStorage.setItem(name, '1');
    }, initArg: { key: SESSION_KEY, session: mock.session(), off: SHIPPED_DELETE_ON }, handler: mock.handler });
});

test('P8-4d (플래그를 켠 시험) 로그인했을 때만 버튼이 보이고, 누르면 비밀번호 창이 열리며, 어느 단계에서 취소해도 아무것도 지우지 않는다', { skip, timeout: 90000 }, async () => {
  const mock = deleteMock();
  await withPage(async (page, calls) => {
    assert.equal(await visible(page, '#btn-delete-account'), false, '로그인 전에는 숨김');
    await signIn(page, 'member@example.com', PASSWORD);
    await page.waitForFunction(() => !document.querySelector('#btn-delete-account').hidden);
    assert.equal(await visible(page, '#btn-delete-account'), true);
    assert.equal(await page.textContent('#btn-delete-account'), '회원 탈퇴');
    const base = reauthCalls(calls).length;

    await startDelete(page);                                  // 1) 비밀번호 창
    assert.equal(await page.getAttribute('#prompt-value', 'type'), 'password');
    assert.equal(await page.getAttribute('#prompt-value', 'autocomplete'), 'current-password');
    assert.match(await promptNote(page), /되돌릴 수 없어요/);
    await page.click('#dlg-prompt button[type=submit]');      // 빈 칸은 통과하지 못한다
    assert.match(await page.textContent('#prompt-error'), /비밀번호를 입력하세요/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
    await page.waitForFunction(() => /탈퇴를 취소했어요/.test(document.querySelector('#toast').textContent));
    assert.equal(reauthCalls(calls).length, base, '비밀번호 창에서 취소하면 재인증 요청도 없다');

    await startDelete(page);                                  // 2) 확인 문구 창에서 취소
    await answerPrompt(page, PASSWORD);
    await waitPromptTitle(page, '정말 탈퇴할까요?');
    assert.equal(reauthCalls(calls).length, base + 1, '비밀번호 확인은 한 번');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
    assert.equal(fnCalls(calls).length, 0, '함수를 부르지 않았다');
    assert.equal(logoutCalls(calls).length, 0, '로그아웃도 하지 않았다');
    assert.ok(await page.evaluate(() => SF.auth.state.session), '로그인 상태 그대로');
    assert.equal(await visible(page, '#btn-delete-account'), true);
  }, { init: deleteInit, initArg: { flag: true }, handler: mock.handler });
});

test('P8-4d (플래그를 켠 시험) 비밀번호를 3번 틀리면 안내와 함께 끝나고 함수는 부르지 않는다', { skip, timeout: 90000 }, async () => {
  const mock = deleteMock();
  await withPage(async (page, calls) => {
    await signedInAs(page);
    await page.waitForFunction(() => !document.querySelector('#btn-delete-account').hidden);
    await startDelete(page);
    await answerPrompt(page, 'wrong-1');
    await page.waitForFunction(() => /비밀번호가 맞지 않아요/.test(document.querySelector('#dlg-prompt p')?.textContent || ''));
    assert.equal(await promptTitle(page), '회원 탈퇴', '같은 창을 다시 보여 준다');
    await answerPrompt(page, 'wrong-2');
    await until(() => reauthCalls(calls).length === 2, '재인증 요청 2건');
    await page.waitForFunction(() => /비밀번호가 맞지 않아요/.test(document.querySelector('#dlg-prompt p')?.textContent || ''));
    await answerPrompt(page, 'wrong-3');
    await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
    await page.waitForFunction(() => /비밀번호가 맞지 않아 탈퇴를 진행하지 못했어요/.test(document.querySelector('#toast').textContent));
    assert.equal(reauthCalls(calls).length, 3);
    assert.equal(fnCalls(calls).length, 0);
    assert.ok(await page.evaluate(() => SF.auth.state.session), '로그인 상태 그대로');
  }, flagInit(mock));
});

test('P8-4d (플래그를 켠 시험) 성공하면: 확인 문구 검사 → 재인증한 토큰으로 함수 호출 → 이 기기 로그아웃 → 이 계정의 대기 작업만 삭제', { skip, timeout: 120000 }, async () => {
  const mock = deleteMock({ reauthToken: 'reauth.token.value' });
  await withPage(async (page, calls) => {
    await queueTwoOwners(page);
    await page.waitForFunction(() => !document.querySelector('#btn-delete-account').hidden);
    const scoreBefore = await page.evaluate(() => JSON.stringify(SF.core.toJSON(SF.core.state.score)));
    await startDelete(page);
    await answerPrompt(page, PASSWORD);
    await waitPromptTitle(page, '정말 탈퇴할까요?');
    assert.match(await promptNote(page), /"탈퇴"/);
    await answerPrompt(page, '탈퇴하기');                      // 정확히 "탈퇴"가 아니면 막힌다
    await page.waitForFunction(() => /탈퇴/.test(document.querySelector('#prompt-error')?.textContent || ''));
    assert.equal(await promptOpen(page), true);
    assert.equal(fnCalls(calls).length, 0, '틀린 확인 문구로는 함수를 부르지 않는다');
    await answerPrompt(page, '탈퇴');

    await until(() => fnCalls(calls).length === 1, '함수 호출 1건');
    await until(() => logoutCalls(calls).length === 1, '로그아웃 요청 1건');
    await page.waitForFunction(() => SF.auth.state.session === null);
    const fn = fnCalls(calls)[0];
    assert.equal(fn.headers.authorization, 'Bearer reauth.token.value', '방금 비밀번호로 확인한 계정의 토큰');
    assert.equal(fn.body === null || fn.body === '' || fn.body === undefined, true, `지울 대상을 본문으로 지정하지 않는다: ${JSON.stringify(fn.body)}`);
    assert.equal(new URL(fn.url).search, '', '쿼리로도 지정하지 않는다');
    assert.match(logoutCalls(calls)[0].url, /scope=local/, '다른 기기를 끊는 global이 아니다');
    const sequence = calls.filter(c => reauthCalls([c]).length || fnCalls([c]).length || logoutCalls([c]).length).map(c => (reauthCalls([c]).length ? 'reauth' : fnCalls([c]).length ? 'function' : 'logout'));
    assert.deepEqual(sequence, ['reauth', 'function', 'logout'], '순서: 비밀번호 확인 → 탈퇴 요청 → 이 기기 로그아웃');
    assert.deepEqual(await queueOwners(page), [OTHER_ID], '이 계정의 대기 작업만 사라지고 다른 계정의 것은 남는다');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SESSION_KEY), null, '이 기기의 로그인 정보가 지워졌다');
    assert.equal(await visible(page, '#btn-delete-account'), false);
    assert.equal(await visible(page, '#btn-member-login'), true, '로그인 전 화면으로 돌아왔다');
    assert.match(await page.textContent('#auth-status'), /로그인 전/);
    await page.waitForFunction(() => /탈퇴가 끝났어요/.test(document.querySelector('#toast').textContent));
    assert.match(await toastText(page), /로컬 악보는 그대로/);
    assert.equal(await page.evaluate(() => JSON.stringify(SF.core.toJSON(SF.core.state.score))), scoreBefore, '열려 있던 악보 내용은 그대로');
  }, flagInit(mock, { offline: true }));
});

test('P8-4d (플래그를 켠 시험) 함수 호출이 실패하면(401·서버 오류·연결 실패) 로그인과 대기 작업을 그대로 두고 알맞은 문구를 보인다', { skip, timeout: 180000 }, async () => {
  for (const [functionStatus, functionBody, expected] of [
    [401, '{"error":"unauthorized"}', /로그인이 만료됐어요/],
    [500, '{"error":"delete_failed","detail":"SECRET-INTERNAL-DETAIL"}', /탈퇴를 처리하지 못했어요/],
    ['network', '', /네트워크에 연결하지 못했어요/],
  ]) {
    const mock = deleteMock({ functionStatus, functionBody });
    await withPage(async (page, calls) => {
      await queueTwoOwners(page);
      await page.waitForFunction(() => !document.querySelector('#btn-delete-account').hidden);
      await startDelete(page);
      await answerPrompt(page, PASSWORD);
      await waitPromptTitle(page, '정말 탈퇴할까요?');
      await answerPrompt(page, '탈퇴');
      await page.waitForFunction(re => new RegExp(re).test(document.querySelector('#toast').textContent), expected.source);
      assert.doesNotMatch(await toastText(page), /SECRET-INTERNAL-DETAIL|delete_failed/, '서버가 준 상세는 보이지 않는다');
      assert.equal(logoutCalls(calls).length, 0, `${functionStatus}: 로그아웃하지 않았다`);
      assert.ok(await page.evaluate(() => SF.auth.state.session), `${functionStatus}: 로그인 상태 그대로`);
      assert.deepEqual(await queueOwners(page), [USER_ID, OTHER_ID], `${functionStatus}: 대기 작업 그대로`);
      assert.equal(await visible(page, '#btn-delete-account'), true, '다시 시도할 수 있다');
    }, flagInit(mock, { offline: true }));
  }
});

// ───────── e. 개인정보 고지·가입 동의 ─────────
const signupCalls = calls => calls.filter(c => c.method === 'POST' && /\/auth\/v1\/signup/.test(c.url));
const openSignup = async page => { await page.click('#btn-signup'); await page.waitForFunction(() => document.querySelector('#dlg-auth').open); };

test('P8-4e 필수 동의 체크는 가입 창에만 있고 열 때마다 해제돼 있으며, 개인정보 링크는 로그인·가입 창 모두에 새 탭 링크로 있다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    await openLogin(page);
    assert.equal(await visible(page, '#auth-consent-row'), false, '로그인 창에는 동의 체크가 없다');
    assert.equal(await visible(page, '#link-privacy'), true);
    assert.equal(await page.getAttribute('#link-privacy', 'target'), '_blank');
    assert.match(await page.getAttribute('#link-privacy', 'rel'), /noopener/);
    assert.equal(await page.getAttribute('#link-privacy', 'href'), 'privacy.html');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-auth').open);

    await openSignup(page);
    assert.equal(await visible(page, '#auth-consent-row'), true);
    assert.equal(await page.isChecked('#auth-consent'), false, '처음에는 해제');
    assert.match(await page.textContent('#auth-consent-row'), /\(필수\)/);
    assert.equal(await visible(page, '#link-privacy'), true, '가입 창에도 링크');
    assert.equal(await visible(page, '#btn-forgot-password'), false, '(c) 가입 창에는 비밀번호 재설정이 없다');
    await page.check('#auth-consent');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-auth').open);
    await openSignup(page);
    assert.equal(await page.isChecked('#auth-consent'), false, '다시 열면 해제 — 동의는 열 때마다 직접 한다');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-auth').open);
    await openLogin(page);
    assert.equal(await visible(page, '#auth-consent-row'), false);
  });
});

test('P8-4e 동의하지 않으면 가입 요청을 보내지 않고 안내하며, 동의하면 동의 버전·시각이 가입 정보에 실려 간다', { skip, timeout: 90000 }, async () => {
  const mock = authMock();
  await withPage(async (page, calls) => {
    const version = await page.evaluate(() => SF.auth.privacyVersion);
    await openSignup(page);
    await page.fill('#auth-display-name', '김가입');
    await page.fill('#auth-email', 'new@example.com');
    await page.fill('#auth-password', 'secret123');
    await page.click('#auth-submit');
    assert.match(await page.textContent('#auth-message'), /개인정보 처리 안내에 동의해 주세요/);
    assert.equal(await page.evaluate(() => document.querySelector('#auth-message').classList.contains('error')), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'auth-consent', '체크 칸으로 포커스');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(calls.length, 0, '동의 전에는 Supabase 요청이 한 건도 없다');
    assert.equal(await page.isDisabled('#auth-submit'), false, '버튼이 멈춰 있지 않다(다시 누를 수 있다)');

    await page.check('#auth-consent');
    await page.click('#auth-submit');
    await until(() => signupCalls(calls).length === 1, '가입 요청 1건');
    const body = signupCalls(calls)[0].body;
    assert.equal(body.email, 'new@example.com');
    assert.equal(body.password, 'secret123');
    assert.equal(body.data.display_name, '김가입');
    assert.equal(body.data.privacy_consent_version, version, '동의한 안내의 버전');
    assert.match(body.data.privacy_consent_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, '동의 시각(UTC ISO)');
    assert.ok(Math.abs(Date.parse(body.data.privacy_consent_at) - Date.now()) < 60000, '방금 시각');
    await page.waitForFunction(() => /회원가입 요청이 완료됐어요/.test(document.querySelector('#auth-message').textContent));
  }, { handler: mock.handler });
});

test('P8-4e 로그인에는 동의 체크가 필요 없다(체크 칸 없이 그대로 로그인된다)', { skip, timeout: 90000 }, async () => {
  const mock = authMock();
  await withPage(async page => {
    await signIn(page);
    await page.waitForFunction(() => SF.auth.state.session?.user?.email === 'member@example.com');
  }, { handler: mock.handler });
});

test('P8-4e 개인정보 처리 안내 링크 → 새 탭에서 안내 페이지가 열리고, 앱이 기록하는 동의 버전과 같은 버전이 적혀 있다', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    const version = await page.evaluate(() => SF.auth.privacyVersion);
    await openSignup(page);
    const [popup] = await Promise.all([page.context().waitForEvent('page'), page.click('#link-privacy')]);
    const problems = [];
    popup.on('pageerror', error => problems.push(`pageerror ${error.message}`));
    popup.on('console', message => { if (message.type() === 'error') problems.push(`console ${message.text()}`); });
    popup.on('requestfailed', request => problems.push(`failed ${request.url()}`));
    await popup.waitForLoadState('load');
    assert.match(popup.url(), /\/privacy(\.html)?$/);
    assert.equal(await popup.locator('h1').count(), 1);
    assert.equal(await popup.locator('section#ko').isVisible(), true);
    assert.equal(await popup.locator('section#en').isVisible(), true);
    assert.equal(await popup.textContent('#privacy-version'), version, '앱이 기록하는 버전과 같다');
    assert.ok(await popup.locator('.todo').count() >= 4, '확정 전 자리가 눈에 띄게 표시돼 있다');
    assert.notEqual(await popup.evaluate(() => getComputedStyle(document.querySelector('.todo')).backgroundColor), 'rgba(0, 0, 0, 0)', 'css/privacy.css가 적용됐다');
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, '가로로 넘치지 않는다');
    await popup.setViewportSize({ width: 360, height: 700 });
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, '좁은 화면에서도 가로로 넘치지 않는다');
    assert.deepEqual(problems, [], '오류·차단된 요청 없음(CSP 포함)');
    await popup.close();
    assert.equal(await page.evaluate(() => document.querySelector('#dlg-auth').open), true, '앱의 가입 창은 그대로 열려 있다');
  });
});
