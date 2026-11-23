// Phase 1 보안 테스트 — 이스케이프 모듈·패널 정적 검사·입력 정규화·CSP
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';

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


// ---- Step 1-3: fromJSON 입력 정규화 ----
const coreCtx = vm.createContext({ console }); coreCtx.window = coreCtx;
vm.runInContext(readFileSync('js/core.js', 'utf8'), coreCtx, { filename: 'core.js' });
const C = coreCtx.SF.core;
function loadWith(fields) {                     // 첫 이벤트에 필드를 심은 파일을 fromJSON으로 읽는다
  const json = JSON.parse(JSON.stringify(C.toJSON(C.createScore({ measureCount: 1 }))));
  Object.assign(json.parts[0].staves[0].measures[0].voices[0][0], fields);
  return C.fromJSON(json).parts[0].staves[0].measures[0].voices[0][0];
}
test('fromJSON 템포: 숫자 문자열은 숫자로, 소수 보존, 범위 밖은 clamp, 숫자가 아니면 삭제', () => {
  assert.equal(loadWith({ tempo: '120' }).tempo, 120);
  assert.equal(loadWith({ tempo: 123.456 }).tempo, 123.456);
  assert.equal(loadWith({ tempo: 5 }).tempo, 10);
  assert.equal(loadWith({ tempo: 5000 }).tempo, 999);
  for (const bad of ['"><img src=x>', '', null, true, {}, 'NaN']) assert.equal('tempo' in loadWith({ tempo: bad }), false, String(bad));
});
test('fromJSON 텍스트·색·오프셋 정리', () => {
  assert.equal(loadWith({ rehearsal: 'ABCDEFGHIJKLMN' }).rehearsal, 'ABCDEFGHIJKL');
  assert.equal(loadWith({ staffText: 'x'.repeat(60) }).staffText.length, 48);
  assert.equal('rehearsal' in loadWith({ rehearsal: '' }), false);
  assert.equal(loadWith({ color: '#12ab9F' }).color, '#12ab9F');
  for (const bad of ['red', '#fff', '"><b>']) assert.equal('color' in loadWith({ color: bad }), false, bad);
  assert.equal(loadWith({ offsetX: '3' }).offsetX, 3);
  assert.equal('offsetY' in loadWith({ offsetY: 'x' }), false);
});
test('기준 악보 5개는 fromJSON 정규화로 값이 바뀌지 않는다', () => {
  const files = readdirSync('tests/baseline').filter(f => f.endsWith('.scoreforge.json'));
  assert.ok(files.length >= 5, '기준 악보 개수: ' + files.length);
  const FIELDS = ['tempo', 'rehearsal', 'staffText', 'color', 'offsetX', 'offsetY', 'velocityOffset'];
  const collect = obj => {
    const out = new Map();
    for (const part of obj.parts) for (const staff of part.staves) for (const mm of staff.measures)
      for (const voice of [...(mm.voices || []), mm.events || []]) for (const ev of voice)
        out.set(ev.id, FIELDS.map(k => JSON.stringify(ev[k])));
    return out;
  };
  for (const f of files) {
    const raw = JSON.parse(readFileSync('tests/baseline/' + f, 'utf8'));
    const before = collect(raw), after = collect(C.fromJSON(raw));
    assert.ok(before.size > 0, f);
    for (const [id, fields] of before) assert.deepEqual(after.get(id), fields, f + ' ' + id);
  }
});
