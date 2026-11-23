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

test('panels.js의 data-prop 입력 value는 모두 이스케이프 또는 숫자 변환을 거친다', () => {
  const src = readFileSync('js/panels.js', 'utf8');
  const values = [...src.matchAll(/data-prop="[^"]+"[^>]*value="\$\{(.*?)\}"/g)].map(m => m[1]);
  assert.ok(values.length >= 8, '입력이 8개 이상이어야 한다: ' + values.length);   // 016ad44 기준 8개 입력
  for (const v of values) assert.match(v, /^\s*(htmlEsc\(|SF\.html\.(esc|num)\(|\+ev\.)/, `unsafe value: ${v}`);
});
