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
