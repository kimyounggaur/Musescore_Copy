// Phase 1 보안 테스트 — 이스케이프 모듈·패널 정적 검사·입력 정규화·CSP
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const htmlCtx = vm.createContext({ console });
htmlCtx.window = htmlCtx;
vm.runInContext(readFileSync('js/safe-html.js', 'utf8'), htmlCtx, { filename: 'safe-html.js' });
const SF = htmlCtx.SF;

test('SF.html.esc는 다섯 문자를 모두 바꾼다', () => {
  assert.equal(SF.html.esc(`"><img src=x onerror='a'>&`), '&quot;&gt;&lt;img src=x onerror=&#39;a&#39;&gt;&amp;');
  assert.equal(SF.html.esc(undefined), '');
  assert.equal(SF.html.esc(null), '');
});
test('SF.html.num은 숫자가 아니면 빈 문자열', () => {
  assert.equal(SF.html.num('"><b>'), '');
  assert.equal(SF.html.num('120.4', { min: 30, max: 280 }), '120');
  assert.equal(SF.html.num(5, { min: 30, max: 280 }), '30');
  assert.equal(SF.html.num(undefined, { fallback: '-' }), '-');
});
