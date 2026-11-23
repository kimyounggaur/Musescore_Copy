// P2-E 저장소 기록의 구조 검사(js/schema.js) — 기준 악보는 통과하고, 그리다 멈추게 만드는 모양은 ScoreFormatError로 거른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SF } from './shim.mjs';

const { checkShape, ScoreFormatError } = SF.schema;
const C = SF.core;
const baselines = readdirSync('tests/baseline').filter(name => name.endsWith('.scoreforge.json')).sort();
const baseline = name => JSON.parse(readFileSync(`tests/baseline/${name}`, 'utf8'));
const demo = () => C.toJSON(SF.io.DEMOS.butterfly());
const rejects = (data, code, path) => assert.throws(() => checkShape(data), error => {
  assert.ok(error instanceof ScoreFormatError && error instanceof Error, '예외 종류');
  assert.equal(error.name, 'ScoreFormatError');
  assert.equal(error.code, code);
  if (path) assert.equal(error.path, path);
  return true;
});
const firstMeasure = data => data.parts[0].staves[0].measures[0];

test('기준 악보 5곡이 그대로 통과하고, 다시 정규화한 결과도 통과한다', () => {
  assert.equal(baselines.length, 5);
  for (const name of baselines) {
    const raw = baseline(name);
    assert.equal(checkShape(raw), raw, `${name} — 받은 data를 그대로 돌려준다`);
    assert.doesNotThrow(() => checkShape(C.toJSON(C.fromJSON(raw))), `${name} 정규화 뒤`);
  }
});

test('앱의 데모·새 악보·여러 악기 편성은 모두 통과한다', () => {
  for (const key of Object.keys(SF.io.DEMOS)) assert.doesNotThrow(() => checkShape(C.toJSON(SF.io.DEMOS[key]())), key);
  assert.doesNotThrow(() => checkShape(C.toJSON(C.createScore({}))));
  assert.doesNotThrow(() => checkShape(C.toJSON(C.createScore({ measureCount: 3, ensemble: 'piano' }))));
});

test('dur { n: 0, d: 0 } · 음수 · 소수 · 숫자가 아님 · dur 없음 → BAD_DURATION (위치까지 알려 준다)', () => {
  const bad = dur => { const data = demo(); const events = firstMeasure(data).voices[0]; events[1].dur = dur; return data; };
  for (const dur of [{ n: 0, d: 0, dots: 0 }, { n: 1, d: 0 }, { n: 0, d: 4 }, { n: -1, d: 4 }, { n: 1.5, d: 4 }, { n: '1', d: 4 }, { n: NaN, d: 4 }, { n: 1, d: Infinity }, null, 7, 'x'])
    rejects(bad(dur), 'BAD_DURATION', 'parts[0].staves[0].measures[0].voices[0][1].dur');
  const missing = demo(); delete firstMeasure(missing).voices[0][0].dur;
  rejects(missing, 'BAD_DURATION', 'parts[0].staves[0].measures[0].voices[0][0].dur');
  const deep = demo(); deep.parts[0].staves[0].measures[2].voices[1] = [{ id: 'e1', type: 'rest', dur: { n: 0, d: 0 }, notes: [] }];
  rejects(deep, 'BAD_DURATION', 'parts[0].staves[0].measures[2].voices[1][0].dur');
});

test('voices 누락·목록이 아님 → VOICES_MISSING / VOICES_NOT_ARRAY / VOICE_NOT_ARRAY', () => {
  const missing = demo(); delete firstMeasure(missing).voices;
  rejects(missing, 'VOICES_MISSING', 'parts[0].staves[0].measures[0].voices');
  for (const value of ['x', {}, 3, null]) { const data = demo(); firstMeasure(data).voices = value; rejects(data, 'VOICES_NOT_ARRAY'); }
  const voice = demo(); firstMeasure(voice).voices[0] = 'x';
  rejects(voice, 'VOICE_NOT_ARRAY', 'parts[0].staves[0].measures[0].voices[0]');
  const event = demo(); firstMeasure(event).voices[0][0] = null;
  rejects(event, 'EVENT_NOT_OBJECT', 'parts[0].staves[0].measures[0].voices[0][0]');
});

test('parts·staves·measures가 목록이 아니면 거른다(parts가 문자열이던 예전 손상 포함)', () => {
  rejects({ parts: 'x' }, 'PARTS_NOT_ARRAY', 'parts');
  rejects({ parts: {} }, 'PARTS_NOT_ARRAY');
  rejects({ meta: {} }, 'PARTS_MISSING', 'parts');
  const staves = demo(); staves.parts[0].staves = 'x'; rejects(staves, 'STAVES_NOT_ARRAY', 'parts[0].staves');
  const measures = demo(); measures.parts[0].staves[0].measures = { 0: {} }; rejects(measures, 'MEASURES_NOT_ARRAY', 'parts[0].staves[0].measures');
  const top = demo(); top.measures = 'x'; rejects(top, 'MEASURES_NOT_ARRAY', 'measures');
  const part = demo(); part.parts[0] = null; rejects(part, 'PART_NOT_OBJECT', 'parts[0]');
  const staff = demo(); staff.parts[0].staves[0] = 5; rejects(staff, 'STAFF_NOT_OBJECT', 'parts[0].staves[0]');
  const measure = demo(); measure.parts[0].staves[0].measures[1] = 'x'; rejects(measure, 'MEASURE_NOT_OBJECT', 'parts[0].staves[0].measures[1]');
});

test('객체가 아닌 값(null·배열·문자열·숫자·undefined)은 NOT_OBJECT', () => {
  for (const value of [null, [], 'x', 3, undefined, true]) rejects(value, 'NOT_OBJECT', 'score');
});

test('내용(음높이·가사·메타)은 보지 않는다 — 모양만 맞으면 통과', () => {
  const data = demo();
  data.meta = null; data.keySig = 'x'; data.style = 'x';
  firstMeasure(data).voices[0][0].notes = 'x';
  assert.doesNotThrow(() => checkShape(data));
});

test('오류 메시지에 코드의 이유와 위치가 함께 나온다', () => {
  try { checkShape({ parts: 'x' }); assert.fail('던져야 한다'); }
  catch (error) { assert.match(error.message, /악기\(parts\)가 목록이 아니에요/); assert.match(error.message, /parts$/); }
});

test('구조 고정: schema.js는 core·DOM에 기대지 않고, 스크립트 순서·테스트 shim에 올라 있다', () => {
  const source = readFileSync('js/schema.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(source, /SF\.(core|app|session|store|io|ui|i18n)\b|document\.|innerHTML|localStorage|indexedDB/);
  const html = readFileSync('index.html', 'utf8'), at = name => html.indexOf(`src="js/${name}.js"`);
  assert.ok(at('core') > 0 && at('core') < at('schema') && at('schema') < at('session'), 'core.js 다음에 로드');
  assert.match(readFileSync('tests/shim.mjs', 'utf8'), /'schema'/);
  assert.match(readFileSync('precache-manifest.json', 'utf8'), /js\/schema\.js/);
});
