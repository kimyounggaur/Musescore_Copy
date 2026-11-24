// P8-4: 계정 기능·노출 정리 — 실제 브라우저에서 확인한다.
//  a. 연결 설정 숨김(개발 모드·사용자 지정 연결 띠)   b. 관리자 버튼   c. 비밀번호 재설정   d. 탈퇴(꺼짐)   e. 개인정보 고지·가입 동의
// Supabase 요청은 모두 page.route로 가로채 실제 서버에는 접속하지 않는다(요청 내용만 기록한다).
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/account-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;

const DEFAULT_URL = 'https://cgoafcjvnbzozxbbyfle.supabase.co';
const CUSTOM = { url: 'https://example-custom.supabase.co', key: 'sb_publishable_customKeyForTests123' };

// page.route 핸들러가 부르는 기본 응답. 시험이 handler를 주면 그것이 먼저 받는다(true를 돌려주면 처리한 것).
async function withPage(fn, { path = '/', size = { width: 1200, height: 800 }, init, initArg, handler, timeout } = {}) {
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
  }, { init: c => { localStorage.setItem('scoreforge.supabase.url', c.url); localStorage.setItem('scoreforge.supabase.publishableKey', c.key); }, initArg: CUSTOM });
});

test('P8-4a 저장된 값이 기본 연결과 같으면 사용자 지정이 아니다(띠 없음)', { skip, timeout: 90000 }, async () => {
  await withPage(async page => {
    const key = await page.evaluate(() => window.SF_SUPABASE_CONFIG.publishableKey);
    await page.evaluate(k => { localStorage.setItem('scoreforge.supabase.url', 'https://cgoafcjvnbzozxbbyfle.supabase.co/'); localStorage.setItem('scoreforge.supabase.publishableKey', k); }, key);
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
  }, { path: '/?dev=1' });
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
  }, { init: seed, initArg: { custom: CUSTOM } });
});
