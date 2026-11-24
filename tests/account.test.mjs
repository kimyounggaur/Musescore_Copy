// P8-4: 계정 기능·노출 정리 — 노드 시험(브라우저 없이 되는 것: 마크업 불변식, 순수 함수, Edge Function 핸들러, i18n).
// 브라우저 동작(대화상자·복구 링크 흐름)은 tests/account-browser.test.mjs가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

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
  const context = { window: { SF: { core: {} } }, atob, URLSearchParams, ...extra };
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
  for (const stored of [null, undefined, '', '0', 'false', 'yes', '2', ' ']) assert.equal(devModeFrom('', stored), false, `stored ${JSON.stringify(stored)}`);
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
