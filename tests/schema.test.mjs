// P2-E 저장소 기록의 구조 검사(js/schema.js) — 기준 악보는 통과하고, 그리다 멈추게 만드는 모양은 ScoreFormatError로 거른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SF } from './shim.mjs';
import { clone, mulberry32, randomScore, bases, corrupt, exercise } from './fixtures/schema-fuzz.mjs';

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

/* =====================================================================================================
 * P8-2 validate — 파일·클라우드·최근 작업·옛 저장소에서 막 읽은 악보 JSON을 core에 넣기 전에 한 번 거른다.
 * 정상 악보는 한 건도 고치지 않고, 값만 틀린 곳은 고쳐서 열며(무엇을 고쳤는지 알려 준다), 고칠 수 없으면 ScoreFormatError로 거절한다.
 * 위쪽 시험(checkShape)은 그대로다.
 * ===================================================================================================== */
const { validate, fixLines, LIMITS, RULES, REASONS } = SF.schema;
const strip = value => JSON.stringify(value, (key, v) => (key.startsWith('__') ? undefined : v));   // core가 붙이는 내부 표식(__…)은 비교에서 뺀다
const normalized = data => strip(C.toJSON(C.fromJSON(data)));
const fresh = (count = 4) => C.toJSON(C.createScore({ measureCount: count }));
const counts = res => Object.fromEntries(res.summary.map(item => [item.rule, item.count]));
const checked = data => { const res = validate(data); assert.equal(res.fatal, null, res.fatal?.message); return res; };
const refuses = (data, code, path) => {
  const res = validate(data);
  assert.ok(res.fatal instanceof ScoreFormatError, `${code}로 거절해야 한다`);
  assert.equal(res.fatal.code, code, res.fatal.message);
  if (path) assert.equal(res.fatal.path, path);
  assert.equal(res.score, null);
  assert.ok(REASONS[code], `${code}의 이유 문구가 있다`);
  return res;
};
const rest = (id, n, d, extra = {}) => ({ id, type: 'rest', dur: { n, d, dots: 0 }, notes: [], voice: 1, ...extra });
const note = (id, n, d, extra = {}) => ({ id, type: 'note', dur: { n, d, dots: 0 }, notes: [{ step: 0, alter: 0, oct: 4, tie: false }], voice: 1, ...extra });
const gcdBig = (a, b) => { while (b) [a, b] = [b, a % b]; return a || 1n; };
/** 이벤트 길이 합(기약 [분자, 분모], BigInt) — schema.js와 따로 짠 계산이다. */
function lengthOf(events) {
  let n = 0n, d = 1n;
  for (const ev of events) {
    const dots = BigInt(ev.dur.dots || 0);
    let en = BigInt(ev.dur.n) * ((1n << (dots + 1n)) - 1n), ed = BigInt(ev.dur.d) * (1n << dots);
    if (ev.dur.tuplet) { en *= BigInt(ev.dur.tuplet.normal || 2); ed *= BigInt(ev.dur.tuplet.actual || 3); }
    n = n * ed + en * d; d *= ed;
    const g = gcdBig(n, d); n /= g; d /= g;
  }
  return [n, d];
}
const sumIs = (events, num, den) => { const g = gcdBig(BigInt(num), BigInt(den)); assert.deepEqual(lengthOf(events), [BigInt(num) / g, BigInt(den) / g]); };
/** 결과의 모든 마디·성부(빈 성부 제외)가 4/4 한 마디 길이인지. */
const allFull = (score, num = 1, den = 1) => score.parts[0].staves[0].measures.forEach(mm => mm.voices.forEach(voice => { if (voice.length) sumIs(voice, num, den); }));
const usable = res => { exercise(res.score); return res.score; };
const measureOf = (data, m = 0) => data.parts[0].staves[0].measures[m];

test('P8-2 validate: 정상 악보는 한 건도 고치지 않는다 — 기준 5곡·데모(v1·v2)·새 악보·편성: 내용 그대로, 원본은 건드리지 않고, 사본을 돌려준다', () => {
  const inputs = [
    ...baselines.map(name => [name, baseline(name)]),
    ...Object.keys(SF.io.DEMOS).flatMap(key => [[`demo:${key}`, C.toJSON(SF.io.DEMOS[key]())], [`demo1:${key}`, C.toJSON(SF.io.DEMOS[key](), { format: 1 })]]),
    ['new', C.toJSON(C.createScore({}))], ['piano', C.toJSON(C.createScore({ measureCount: 3, ensemble: 'piano' }))],
  ];
  assert.equal(inputs.length, 5 + 2 * Object.keys(SF.io.DEMOS).length + 2);
  for (const [name, raw] of inputs) {
    const before = JSON.stringify(raw), res = validate(raw);
    assert.equal(res.fatal, null, `${name}: ${res.fatal?.message}`);
    assert.deepEqual(res.summary, [], `${name}: 고친 것이 없다`);
    assert.equal(res.fixes.length, 0, name);
    assert.equal(JSON.stringify(raw), before, `${name}: 원본을 건드리지 않는다`);
    assert.notEqual(res.score, raw, `${name}: 사본`);
    assert.equal(normalized(res.score), normalized(raw), `${name}: 열린 결과가 같다`);
  }
});

test('P8-2 validate: 코어가 직접 만든 악보(음 입력·잇단음표·박자 바꿈·못갖춘마디·마디 나누기/합치기·여러 성부·TAB·드럼)도 한 건도 고치지 않는다 — 마디 길이 계산이 코어와 같다', () => {
  const seen = { tuplet: 0, timeSig: 0, custom: 0, voices: 0, tab: 0, drum: 0 };
  for (let seed = 1; seed <= 200; seed++) {
    const score = randomScore(seed);
    for (const options of [{}, { format: 1 }]) {
      const raw = C.toJSON(score, options), res = validate(raw);
      const label = `seed ${seed} ${options.format ? 'v1' : 'v2'}`;
      assert.equal(res.fatal, null, `${label}: ${res.fatal?.message}`);
      assert.deepEqual(res.summary, [], `${label}: ${JSON.stringify(res.summary.map(item => [item.rule, item.example]))}`);
      assert.equal(normalized(res.score), normalized(raw), `${label}: 열린 결과가 같다`);
    }
    const text = JSON.stringify(C.toJSON(score));
    if (text.includes('"tuplet"')) seen.tuplet++;
    if (/"measures":\[.*"timeSig":/.test(text)) seen.timeSig++;
    if (text.includes('"length":') || text.includes('"pickup":')) seen.custom++;
    if (/"voices":\[\[.*\],\[.*\]/.test(text)) seen.voices++;
    if (text.includes('"staffType":"tab"')) seen.tab++;
    if (text.includes('"drumId"')) seen.drum++;
  }
  for (const [kind, n] of Object.entries(seen)) assert.ok(n >= 5, `임의 악보가 ${kind}을(를) 충분히 만든다(${n}개)`);   // 생성기가 쉬운 악보만 만들고 있지 않은지
});

test('P8-2 validate: 13개 구조 코드는 checkShape와 같은 코드·같은 위치로 거절한다(던지지 않고 돌려준다)', () => {
  const at = path => path.split('.').reduce((node, key) => node[key], undefined);   // (미사용 방지용 자리 — 아래 표가 직접 만든다)
  void at;
  const cases = [
    ['NOT_OBJECT', 5], ['NOT_OBJECT', null], ['NOT_OBJECT', []], ['NOT_OBJECT', 'x'],
    ['PARTS_MISSING', { meta: {} }],
    ['PARTS_NOT_ARRAY', { parts: 'x' }], ['PARTS_NOT_ARRAY', { parts: {} }],
    ['PART_NOT_OBJECT', { parts: [null] }], ['PART_NOT_OBJECT', { parts: [5] }],
    ['STAVES_NOT_ARRAY', { parts: [{}] }], ['STAVES_NOT_ARRAY', { parts: [{ staves: 'x' }] }],
    ['STAFF_NOT_OBJECT', { parts: [{ staves: [5] }] }],
    ['MEASURES_NOT_ARRAY', { parts: [{ staves: [{}] }] }], ['MEASURES_NOT_ARRAY', { parts: [{ staves: [{ measures: { 0: {} } }] }] }],
    ['MEASURES_NOT_ARRAY', { measures: 'x', parts: [{ staves: [{ measures: [] }] }] }],
    ['MEASURE_NOT_OBJECT', { parts: [{ staves: [{ measures: [{ voices: [[]] }, 'x'] }] }] }],
    ['VOICES_MISSING', { parts: [{ staves: [{ measures: [{}] }] }] }],
    ['VOICES_NOT_ARRAY', { parts: [{ staves: [{ measures: [{ voices: 'x' }] }] }] }], ['VOICES_NOT_ARRAY', { parts: [{ staves: [{ measures: [{ voices: null }] }] }] }],
    ['VOICE_NOT_ARRAY', { parts: [{ staves: [{ measures: [{ voices: ['x'] }] }] }] }],
    ['EVENT_NOT_OBJECT', { parts: [{ staves: [{ measures: [{ voices: [[null]] }] }] }] }],
    ['BAD_DURATION', { parts: [{ staves: [{ measures: [{ voices: [[{ id: 'e1' }]] }] }] }] }],
    ['BAD_DURATION', { parts: [{ staves: [{ measures: [{ voices: [[{ id: 'e1', dur: { n: 0, d: 0 } }]] }] }] }] }],
    ['BAD_DURATION', { parts: [{ staves: [{ measures: [{ voices: [[{ id: 'e1', dur: { n: 1.5, d: 4 } }]] }] }] }] }],
  ];
  assert.equal(new Set(cases.map(([code]) => code)).size, 13, '13개 코드를 모두 본다');
  for (const [code, data] of cases) {
    let thrown = null;
    try { checkShape(data); } catch (error) { thrown = error; }
    assert.ok(thrown, `${code}: checkShape가 던진다`);
    const res = refuses(data, code, thrown.path);
    assert.equal(res.fatal.message, thrown.message, `${code}: 메시지도 같다`);
  }
  // 실제 악보에서 만든 경우
  const bad = demo(); measureOf(bad).voices[0][1].dur = { n: 0, d: 0, dots: 0 };
  refuses(bad, 'BAD_DURATION', 'parts[0].staves[0].measures[0].voices[0][1].dur');
});

test('P8-2 validate: 던지지 않는다 — 이상한 값·getter·toJSON·BigInt·함수도 거절(NOT_OBJECT·INTERNAL …)로 돌려준다', () => {
  for (const value of [undefined, null, 5, 'x', true, [], () => {}, Symbol('s'), 10n]) refuses(value, 'NOT_OBJECT', 'score');
  const hostile = [
    { get parts() { throw new Error('getter'); } },
    { toJSON() { throw new Error('toJSON'); } },
    { parts: [], big: 10n },
  ];
  for (const data of hostile) assert.doesNotThrow(() => validate(data));
  assert.equal(validate(hostile[1]).fatal.code, 'INTERNAL');
  assert.match(validate(hostile[1]).fatal.message, new RegExp(REASONS.INTERNAL));
  const objectLike = validate(new Map());
  assert.ok(objectLike.fatal, 'Map은 악보가 아니다');
});

/* ---------- 규칙별: 고친다 ---------- */
test('P8-2 규칙 meta: 곡 정보가 없거나 모양이 틀리면 고친다 — 제목·작곡가는 200자(코드 포인트)까지, 문자열이 아니면 지운다', () => {
  const none = fresh(); delete none.meta;
  let res = checked(none);
  assert.deepEqual(counts(res), { meta: 1 });
  assert.deepEqual(clone(res.score.meta), { title: '', composer: '' });
  usable(res);
  for (const bad of [null, 'x', 5, []]) { const data = fresh(); data.meta = bad; assert.deepEqual(counts(checked(data)), { meta: 1 }, JSON.stringify(bad)); }
  const long = fresh(); long.meta.title = '가'.repeat(300); long.meta.composer = 7; long.meta.subtitle = '😀'.repeat(300);
  res = checked(long);
  assert.deepEqual(counts(res), { meta: 3 });
  assert.equal(res.score.meta.title.length, 200);
  assert.equal(res.score.meta.composer, undefined);
  assert.equal(Array.from(res.score.meta.subtitle).length, 200);
  assert.doesNotMatch(res.score.meta.subtitle, /[\uD800-\uDBFF]$/, '짝 글자를 반으로 자르지 않는다');
  usable(res);
  const exact = fresh(); exact.meta.title = '가'.repeat(200);
  assert.deepEqual(checked(exact).summary, [], '200자는 그대로');
});

test('P8-2 규칙 text: 리허설·스태프 텍스트·코드 기호가 한도(12·48·24자)를 넘으면 자르고, 한도 이하는 건드리지 않는다', () => {
  const data = fresh(), ev = measureOf(data).voices[0][0];
  ev.rehearsal = 'R'.repeat(40); ev.staffText = 's'.repeat(100); ev.chordSymbol = { raw: 'C'.repeat(60), normalized: 'C'.repeat(60) };
  const res = checked(data), out = measureOf(res.score).voices[0][0];
  assert.deepEqual(counts(res), { text: 4 });
  assert.equal(out.rehearsal.length, LIMITS.rehearsal); assert.equal(out.staffText.length, LIMITS.staffText);
  assert.equal(out.chordSymbol.raw.length, LIMITS.chord); assert.equal(out.chordSymbol.normalized.length, LIMITS.chord);
  usable(res);
  assert.deepEqual([LIMITS.rehearsal, LIMITS.staffText, LIMITS.chord, LIMITS.title], [12, 48, 24, 200]);
  const ok = fresh(), e = measureOf(ok).voices[0][0];
  e.rehearsal = 'R'.repeat(12); e.staffText = 's'.repeat(48); e.chordSymbol = 'C'.repeat(24);
  assert.deepEqual(checked(ok).summary, [], '한도 이하는 그대로');
  const str = fresh(); measureOf(str).voices[0][0].chordSymbol = 'C'.repeat(30);
  assert.equal(measureOf(checked(str).score).voices[0][0].chordSymbol.length, 24);
});

test('P8-2 규칙 tempo: 곡·이벤트 템포를 10~999로 맞추고, 숫자가 아니면 기본값(곡 100)·지움(이벤트)', () => {
  const cases = [[5000, 999], [1, 10], [9.9, 10], ['120', 120], ['abc', 100], [NaN, 100], [Infinity, 100], [{}, 100]];
  for (const [input, expected] of cases) {
    const data = fresh(); data.tempo = input;
    const res = checked(data);
    assert.equal(res.score.tempo, expected, String(input)); assert.deepEqual(counts(res), { tempo: 1 }, String(input));
  }
  for (const ok of [10, 999, 100.5]) { const data = fresh(); data.tempo = ok; assert.deepEqual(checked(data).summary, [], String(ok)); }
  for (const [input, expected] of [[3, 10], [2000, 999], ['x', undefined], [NaN, undefined], ['90', 90]]) {
    const data = fresh(); measureOf(data).voices[0][0].tempo = input;
    const res = checked(data);
    assert.equal(measureOf(res.score).voices[0][0].tempo, expected, String(input)); assert.deepEqual(counts(res), { tempo: 1 });
  }
});

test('P8-2 규칙 signature: 올바르지 않은 조표·박자·마디 길이·못갖춘마디는 기본값으로 바꾸거나 지운다', () => {
  const data = fresh(6);
  data.keySig = 9; data.timeSig = { num: 0, den: 3 };
  measureOf(data, 1).timeSig = { num: 3, den: 5 }; measureOf(data, 2).keySig = 'x';
  measureOf(data, 3).length = { n: -1, d: 4 }; measureOf(data, 4).length = 'x'; measureOf(data, 0).pickup = { n: 9999, d: 1 };
  const res = checked(data), out = res.score;
  assert.deepEqual(counts(res), { signature: 7 });
  assert.equal(out.keySig, 0); assert.deepEqual(clone(out.timeSig), { num: 4, den: 4 });
  assert.equal(measureOf(out, 1).timeSig, undefined); assert.equal(measureOf(out, 2).keySig, undefined);
  for (const [m, key] of [[3, 'length'], [4, 'length'], [0, 'pickup']]) assert.equal(measureOf(out, m)[key], undefined, `${m}.${key}`);
  usable(res);
  for (const ok of [{ keySig: -7 }, { keySig: 7 }, { timeSig: { num: 32, den: 64 } }, { timeSig: { num: 1, den: 1 } }]) assert.equal(counts(checked({ ...fresh(), ...ok })).signature, undefined, JSON.stringify(ok));   // (박자가 바뀌면 성부 길이는 따로 맞춘다)
  for (const bad of [{ keySig: 8 }, { keySig: 0.5 }, { timeSig: { num: 33, den: 4 } }, { timeSig: { num: 4, den: 3 } }, { timeSig: { num: 4, den: 128 } }]) assert.deepEqual(counts(checked({ ...fresh(), ...bad })), { signature: 1 }, JSON.stringify(bad));
});

test('P8-2 규칙 voices: 마디당 성부는 4개까지 — 5번째부터는 뺀다', () => {
  const data = fresh(), mm = measureOf(data);
  mm.voices = [mm.voices[0], [], [], [], [rest('e900', 1, 1)], []];
  const res = checked(data);
  assert.deepEqual(counts(res), { voices: 1 });
  assert.equal(measureOf(res.score).voices.length, 4);
  usable(res);
  const four = fresh(); measureOf(four).voices = [measureOf(four).voices[0], [], [], []];
  assert.deepEqual(checked(four).summary, [], '4개는 그대로');
});

test('P8-2 규칙 duration: 점은 0~2로, 잇단음표 정보(actual 2~9 · normal 1~16)가 틀리면 지운다', () => {
  const data = fresh(), voice = measureOf(data).voices[0];
  voice.splice(0, 1, note('e901', 1, 8), note('e902', 1, 8), note('e903', 1, 8), note('e904', 1, 8), note('e905', 1, 8), note('e906', 1, 8), rest('e907', 1, 4));
  voice[0].dur.dots = 5; voice[1].dur.dots = 1.5; voice[2].dur.dots = -1;
  voice[3].dur.tuplet = { actual: 1, normal: 2 }; voice[4].dur.tuplet = { actual: 3, normal: 99 }; voice[5].dur.tuplet = 'x';
  const res = checked(data), out = measureOf(res.score).voices[0];
  assert.equal(counts(res).duration, 6);
  assert.equal(out[0].dur.dots, 2); assert.equal(out[1].dur.dots, 0); assert.equal(out[2].dur.dots, 0);
  for (const ev of out.slice(3, 6)) assert.equal(ev.dur.tuplet, undefined);
  usable(res); allFull(res.score);
  const ok = fresh(); measureOf(ok).voices[0] = [note('e1', 1, 4, { dur: { n: 1, d: 4, dots: 0, tuplet: { actual: 3, normal: 2 } } }), note('e2', 1, 4, { dur: { n: 1, d: 4, dots: 0, tuplet: { actual: 3, normal: 2 } } }), note('e3', 1, 4, { dur: { n: 1, d: 4, dots: 0, tuplet: { actual: 3, normal: 2 } } }), rest('e4', 1, 2, { full: false })];
  assert.deepEqual(checked(ok).summary, [], '정상 잇단음표');
});

test('P8-2 규칙 hugeDuration: 너무 큰 길이(n·d > 4096 · 기본 길이 n/d > 32)의 음표·쉼표는 지우고 쉼표로 메운다', () => {
  const data = fresh();
  measureOf(data).voices[0] = [note('e901', 1, 4), note('e902', 5000, 4), note('e903', 1, 8192), note('e904', 40, 1), rest('e905', 1, 4)];
  const res = checked(data), out = measureOf(res.score).voices[0];
  assert.equal(counts(res).hugeDuration, 3);
  assert.deepEqual(out.slice(0, 2).map(ev => ev.id), ['e901', 'e905'], '살아남은 것은 제자리');
  allFull(res.score); usable(res);
  const edge = fresh(); measureOf(edge).voices[0] = [note('e1', 4096, 4096), rest('e2', 1, 4)];   // 정확히 한도 — 그대로(기약하면 1/1)
  assert.equal(counts(checked(edge)).hugeDuration, undefined);
  const big = fresh(); measureOf(big).voices[0] = [note('e1', 32, 1)];   // 온음표 32개(한도)
  assert.equal(counts(checked(big)).hugeDuration, undefined, '기본 길이 n/d = 32는 허용');
  const over = fresh(); measureOf(over).voices[0] = [note('e1', 33, 1)];
  assert.equal(counts(checked(over)).hugeDuration, 1);
});

test('P8-2 규칙 eventType·emptyNote: 종류가 틀리면 바로잡고, 음이 하나도 없는 음표는 쉼표로 바꾼다', () => {
  const data = fresh();
  measureOf(data).voices[0] = [note('e1', 1, 4, { type: 'chord' }), rest('e2', 1, 4, { type: 'x' }), note('e3', 1, 4, { notes: [] }), note('e4', 1, 4, { type: undefined })];
  const res = checked(data), out = measureOf(res.score).voices[0];
  assert.deepEqual(counts(res), { eventType: 3, emptyNote: 1 });
  assert.deepEqual(out.map(ev => ev.type), ['note', 'rest', 'rest', 'note']);
  assert.deepEqual(out[2].notes, []);
  allFull(res.score); usable(res);
});

test('P8-2 규칙 pitch: step 0~6 · alter −2~2 · MIDI 0~127을 벗어난 음은 지우고, alter가 빠진 음은 0으로 채운다 — 음이 모두 없어지면 쉼표', () => {
  const p = (step, alter, oct) => ({ step, alter, oct, tie: false });
  const data = fresh(), good = p(0, 0, 4);
  measureOf(data).voices[0] = [
    note('e1', 1, 4, { notes: [good, p(9, 0, 4), p(0, 3, 4), p(0, 0, 'x'), p(0, 0, 12), p(0, 0, -2), p(0, 0.5, 4), null, 'x'] }),
    note('e2', 1, 4, { notes: [{ step: 2, oct: 4, tie: false }] }),
    note('e3', 1, 4, { notes: [p(5, 0, 9)] }),
    note('e4', 1, 4, { notes: [p(4, 0, 9), p(0, 0, -1)] }),
  ];
  const res = checked(data), out = measureOf(res.score).voices[0];
  assert.deepEqual(counts(res), { pitch: 3, emptyNote: 1 });
  assert.deepEqual(out[0].notes.map(n => [n.step, n.alter, n.oct]), [[0, 0, 4]], '쓸 수 있는 음만 남는다');
  assert.deepEqual(out[1].notes.map(n => [n.step, n.alter, n.oct]), [[2, 0, 4]], 'alter 빠짐 → 0');
  assert.equal(out[2].type, 'rest', 'A9(MIDI 129)만 있던 음표는 쉼표'); assert.deepEqual(out[2].notes, []);
  assert.deepEqual(out[3].notes.map(n => [n.step, n.alter, n.oct]), [[4, 0, 9], [0, 0, -1]], 'G9=127 · C-1=0은 한도 안');
  allFull(res.score); usable(res);
  for (const [name, bad] of [['alter −3', p(0, -3, 4)], ['C♭-1', p(0, -2, -1)], ['step 소수', p(0.5, 0, 4)], ['oct 없음', { step: 0, alter: 0 }]]) {
    const one = fresh(); measureOf(one).voices[0] = [note('e1', 1, 4, { notes: [bad] }), rest('e2', 3, 4)];
    assert.equal(counts(checked(one)).pitch, 1, name);
  }
});

const fieldCases = [
  ['spanners가 목록이 아님', d => { d.spanners = 'x'; }, 1, out => assert.deepEqual(out.spanners, [])],
  ['spanners 항목이 올바르지 않음', d => { d.spanners = [5, { startId: 'e1' }, { type: 'slur', startId: 'e1', endId: 'e2' }]; }, 2, out => assert.equal(out.spanners.length, 1)],
  ['layout이 객체가 아님', d => { d.layout = 'x'; }, 1, out => assert.equal(out.layout, undefined)],
  ['layout 값이 숫자가 아님', d => { d.layout.width = 'wide'; }, 1, out => assert.equal(out.layout.width, undefined)],
  ['playbackSettings가 객체가 아님', d => { d.playbackSettings = 5; }, 1, out => assert.equal(out.playbackSettings, undefined)],
  ['mixer 항목이 객체가 아님', d => { for (const id of Object.keys(d.playbackSettings.mixer)) d.playbackSettings.mixer[id] = 5; }, 1, out => assert.deepEqual(out.playbackSettings.mixer, {})],
  ['mixer 값이 틀림', d => { for (const id of Object.keys(d.playbackSettings.mixer)) d.playbackSettings.mixer[id].volume = 'loud'; }, 1, out => assert.ok(Object.values(out.playbackSettings.mixer).every(rec => rec.volume === undefined))],
  ['style이 객체가 아님', d => { d.style = []; }, 1, out => assert.equal(out.style, undefined)],
  ['activePartIdx가 범위 밖', d => { d.activePartIdx = -1; d.activeStaffIdx = 1.5; }, 2, out => assert.deepEqual([out.activePartIdx, out.activeStaffIdx], [0, 0])],
  ['악기 이름이 문자열이 아님', d => { d.parts[0].name = 5; d.parts[0].tuning = [1, 'x']; }, 2, out => assert.equal(out.parts[0].name, undefined)],
  ['보표 clef가 모르는 값', d => { d.parts[0].staves[0].clef = 'zzz'; d.parts[0].staves[0].staffType = 5; }, 2, out => assert.equal(out.parts[0].staves[0].clef, undefined)],
  ['마디 반복 표시가 불리언이 아님', d => { measureOf(d).startRepeat = 'x'; measureOf(d).endingStart = {}; }, 2, out => assert.equal(measureOf(out).startRepeat, undefined)],
  ['artics가 목록이 아님', d => { measureOf(d).voices[0][0].artics = 'staccato'; }, 1, out => assert.equal(measureOf(out).voices[0][0].artics, undefined)],
  ['artics에 문자열이 아닌 항목', d => { measureOf(d).voices[0][0].artics = ['accent', 5, null]; }, 1, out => assert.deepEqual(measureOf(out).voices[0][0].artics, ['accent'])],
  ['lyrics가 목록이 아님', d => { measureOf(d).voices[0][0].lyrics = {}; }, 1, out => assert.equal(measureOf(out).voices[0][0].lyrics, undefined)],
  ['notes가 목록이 아님', d => { measureOf(d).voices[0][0].notes = 'x'; }, 1, out => assert.deepEqual(measureOf(out).voices[0][0].notes, [])],
  ['dynamic이 문자열이 아님', d => { measureOf(d).voices[0][0].dynamic = 5; }, 1, out => assert.equal(measureOf(out).voices[0][0].dynamic, undefined)],
  ['hidden이 불리언이 아님', d => { measureOf(d).voices[0][0].hidden = 'yes'; }, 1, out => assert.equal(measureOf(out).voices[0][0].hidden, undefined)],
  ['tab 줄 번호가 범위 밖', d => { measureOf(d).voices[0][0].tab = { string: 99, fret: 3 }; }, 1, out => assert.equal(measureOf(out).voices[0][0].tab, undefined)],
  ['tab 프렛이 범위 밖', d => { measureOf(d).voices[0][0].tab = { string: 2, fret: 41 }; }, 1, out => assert.equal(measureOf(out).voices[0][0].tab, undefined)],
  ['graceBefore가 목록이 아님', d => { measureOf(d).voices[0][0].graceBefore = 'x'; }, 1, out => assert.equal(measureOf(out).voices[0][0].graceBefore, undefined)],
  ['graceBefore 항목이 올바르지 않음', d => { measureOf(d).voices[0][0].graceBefore = [5, { notes: [] }, { notes: [{ step: 0, alter: 0, oct: 5 }], dur: { n: 1, d: 8 } }]; }, 1, out => assert.equal(measureOf(out).voices[0][0].graceBefore.length, 1)],
  ['fretboard가 객체가 아님', d => { measureOf(d).voices[0][0].fretboard = 'x'; }, 1, out => assert.equal(measureOf(out).voices[0][0].fretboard, undefined)],
  ['fretboard 줄·프렛 수가 터무니없음', d => { measureOf(d).voices[0][0].fretboard = { strings: 6, frets: 100000, positions: [] }; }, 1, out => assert.equal(measureOf(out).voices[0][0].fretboard, undefined)],
  ['fretboard 위치가 12개를 넘음', d => { measureOf(d).voices[0][0].fretboard = { strings: 6, frets: 4, positions: new Array(13).fill(0) }; }, 1, out => assert.equal(measureOf(out).voices[0][0].fretboard, undefined)],
  // 경계 바로 바깥(변이 검사에서 한도를 넓힌 변이를 잡는다 — 끝값 자체는 아래 '경계값' 시험이 그대로 통과함을 본다)
  ['fretboard 줄이 13개', d => { measureOf(d).voices[0][0].fretboard = { strings: 13, frets: 4, positions: [] }; }, 1, out => assert.equal(measureOf(out).voices[0][0].fretboard, undefined)],
  ['fretboard 프렛이 25개', d => { measureOf(d).voices[0][0].fretboard = { strings: 6, frets: 25, positions: [] }; }, 1, out => assert.equal(measureOf(out).voices[0][0].fretboard, undefined)],
  ['fretboard 시작 프렛이 41', d => { measureOf(d).voices[0][0].fretboard = { strings: 6, frets: 4, firstFret: 41, positions: [] }; }, 1, out => assert.equal(measureOf(out).voices[0][0].fretboard, undefined)],
  ['mixer pan이 숫자가 아님', d => { for (const id of Object.keys(d.playbackSettings.mixer)) d.playbackSettings.mixer[id].pan = 'left'; }, 1, out => assert.ok(Object.values(out.playbackSettings.mixer).every(rec => rec.pan === undefined))],
  ['swing이 문자열이 아님', d => { d.playbackSettings.swing = 3; }, 1, out => assert.equal(out.playbackSettings.swing, undefined)],
  ['layout staffScale이 숫자가 아님', d => { d.layout.staffScale = 'big'; }, 1, out => assert.equal(out.layout.staffScale, undefined)],
  ['곡 clef가 모르는 값', d => { d.clef = 'zzz'; }, 1, out => assert.equal(out.clef, undefined)],
  ['악기 tuning이 13개', d => { d.parts[0].tuning = new Array(13).fill(0); }, 1, out => assert.equal(out.parts[0].tuning, undefined)],
  ['악기 transpose가 객체가 아님', d => { d.parts[0].transpose = 'x'; }, 1, out => assert.equal(out.parts[0].transpose, undefined)],
  ['보표 linkedStaffId가 문자열이 아님', d => { d.parts[0].staves[0].linkedStaffId = 5; }, 1, out => assert.equal(out.parts[0].staves[0].linkedStaffId, undefined)],
  ['마디 repeatCount가 숫자가 아님', d => { measureOf(d).repeatCount = 'twice'; }, 1, out => assert.equal(measureOf(out).repeatCount, undefined)],
  ['staffLine이 숫자가 아님', d => { measureOf(d).voices[0][0].staffLine = 'x'; }, 1, out => assert.equal(measureOf(out).voices[0][0].staffLine, undefined)],
  ['장식음 음 목록이 목록이 아님', d => { measureOf(d).voices[0][0].graceBefore = [{ notes: 'x', dur: { n: 1, d: 8 } }]; }, 1, out => assert.deepEqual(measureOf(out).voices[0][0].graceBefore, [])],
  ['장식음 길이가 온음표보다 김', d => { measureOf(d).voices[0][0].graceBefore = [{ notes: [{ step: 0, alter: 0, oct: 5 }], dur: { n: 2, d: 1 } }]; }, 1, out => assert.deepEqual(measureOf(out).voices[0][0].graceBefore, [])],
  ['장식음 id가 문자열이 아님', d => { measureOf(d).voices[0][0].graceBefore = [{ id: 5, notes: [{ step: 0, alter: 0, oct: 5 }], dur: { n: 1, d: 8 } }]; }, 1, out => assert.deepEqual(measureOf(out).voices[0][0].graceBefore, [])],
  ['장식음 kind가 문자열이 아님', d => { measureOf(d).voices[0][0].graceBefore = [{ kind: 5, notes: [{ step: 0, alter: 0, oct: 5 }], dur: { n: 1, d: 8 } }]; }, 1, out => assert.deepEqual(measureOf(out).voices[0][0].graceBefore, [])],
];
test('P8-2 규칙 field: 모양이 틀린 항목(구간 요소·배치·재생 설정·악기·보표·마디·장식·가사·TAB·코드 다이어그램)은 그 항목만 지운다', () => {
  for (const [name, mutate, expected, verify] of fieldCases) {
    const data = fresh(); mutate(data);
    const res = checked(data);
    assert.equal(counts(res).field, expected, `${name}: ${JSON.stringify(res.summary.map(item => [item.rule, item.count, item.example]))}`);
    verify(res.score);
    usable(res);
  }
  const ok = fresh(), ev = measureOf(ok).voices[0][0];
  ev.fretboard = { strings: 6, frets: 4, firstFret: 1, positions: ['x', 0, 2, 0, 1, 0] }; ev.tab = { string: 6, fret: 0 }; ev.artics = ['accent']; ev.lyrics = [];
  assert.deepEqual(checked(ok).summary, [], '올바른 모양은 그대로');
});

test('P8-2 규칙 field: 같은 구간 요소를 여러 번 적은 것은 하나만 남긴다(파일 크기 폭탄 방지)', () => {
  const data = demo(), ids = [];
  for (const ev of measureOf(data).voices[0]) ids.push(ev.id);
  data.spanners = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, type: 'slur', startId: ids[0], endId: ids[1] }));
  data.spanners.push({ id: 'other', type: 'slur', startId: ids[1], endId: ids[2] }, { id: 'oct', type: 'ottava', startId: ids[0], endId: ids[1], shift: 12 });
  const res = checked(data);
  assert.equal(res.score.spanners.length, 3, '다른 것(끝점·종류·shift가 다름)은 모두 남는다');
  assert.equal(counts(res).field, 999);
  usable(res);
});

test('P8-2 규칙 id: 빠졌거나 문자열이 아닌 id는 겹치지 않는 새 id를 붙인다', () => {
  const data = demo(), voice = measureOf(data).voices[0];
  const idsBefore = JSON.stringify(data).match(/"id":"e(\d+)"/g).map(text => Number(text.match(/\d+/)[0]));
  delete voice[0].id; voice[1].id = 5; voice[2].id = null;
  const res = checked(data);
  assert.deepEqual(counts(res), { id: 3 });
  const out = measureOf(res.score).voices[0], max = Math.max(...idsBefore);
  const fresh3 = out.slice(0, 3).map(ev => ev.id);
  for (const id of fresh3) assert.match(id, /^e\d+$/);
  assert.equal(new Set(fresh3).size, 3, '서로 다르다');
  assert.ok(fresh3.every(id => Number(id.slice(1)) > max), '기존 id보다 크다');
  usable(res);
});

test('P8-2 규칙 voiceLength: 성부 길이가 마디 길이와 다르면 짧은 쪽은 쉼표로 채우고 긴 쪽은 넘는 곳부터 자른다(독립 계산으로 확인)', () => {
  const run = (voice, mutate = () => {}) => { const data = fresh(); measureOf(data).voices[0] = voice; mutate(data); const res = checked(data); usable(res); return res; };
  // 짧다: 3/4 → 뒤에 4분쉼표
  let res = run([note('e1', 1, 2), note('e2', 1, 4)]);
  let out = measureOf(res.score).voices[0];
  assert.deepEqual(out.map(ev => [ev.type, ev.dur.n, ev.dur.d]), [['note', 1, 2], ['note', 1, 4], ['rest', 1, 4]]); assert.deepEqual(counts(res), { voiceLength: 1 });
  // 한참 짧다: 1/16 → 쉼표 여러 개(8분·4분·2분 …)로 메운다
  res = run([note('e1', 1, 16)]); out = measureOf(res.score).voices[0]; sumIs(out, 1, 1); assert.ok(out.length > 2);
  // 길다: 5/4 → 마지막 걸치는 이벤트부터 자르고 메운다
  res = run([note('e1', 1, 2), note('e2', 3, 4, { dur: { n: 1, d: 2, dots: 1 } })]);
  out = measureOf(res.score).voices[0]; sumIs(out, 1, 1); assert.equal(out[0].id, 'e1'); assert.equal(out[1].type, 'rest'); assert.equal(out[1].dur.d, 2);
  // 아주 길다: 온음표 4개 → 첫 하나만 남는다
  res = run([note('e1', 1, 1), note('e2', 1, 1), note('e3', 1, 1), note('e4', 1, 1)]); out = measureOf(res.score).voices[0]; assert.deepEqual(out.map(ev => ev.id), ['e1']);
  // 점·잇단음표가 섞여도 정확하다: 점4분(3/8) + 3잇단 8분 3개(1/4) + 4분(1/4) = 7/8 → 8분쉼표 하나
  const triplet = id => note(id, 1, 8, { dur: { n: 1, d: 8, dots: 0, tuplet: { actual: 3, normal: 2 } } });
  res = run([note('e1', 1, 4, { dur: { n: 1, d: 4, dots: 1 } }), triplet('e2'), triplet('e3'), triplet('e4'), note('e5', 1, 4)]);
  out = measureOf(res.score).voices[0]; sumIs(out, 1, 1); assert.deepEqual(counts(res), { voiceLength: 1 }); assert.equal(out.at(-1).dur.d, 8);
  // 메울 수 없는 길이(분모가 2의 거듭제곱이 아님: 1/6 합) → 성부를 비워 core가 온마디쉼표로 다시 채운다
  res = run([triplet('e1'), triplet('e2')]);
  assert.deepEqual(measureOf(res.score).voices[0], []); assert.deepEqual(counts(res), { voiceLength: 1 });
  const reopened = C.fromJSON(res.score); assert.equal(C.getVoiceEvents(reopened.parts[0].staves[0].measures[0], 1, reopened)[0].full, true);
  // 이미 맞으면 건드리지 않는다 · 빈 성부([])와 쉼표만 있는 성부는 그대로
  res = run([note('e1', 1, 4), note('e2', 1, 4), note('e3', 1, 2)], d => { measureOf(d).voices[1] = []; measureOf(d).voices[2] = [rest('e8', 1, 1, { full: true, voice: 3 })]; });
  assert.deepEqual(res.summary, []); assert.deepEqual(measureOf(res.score).voices[1], []);
  // 모든 성부가 따로 맞춰진다
  res = run([note('e1', 1, 4)], d => { measureOf(d).voices[1] = [note('e7', 1, 2, { voice: 2 })]; });
  assert.deepEqual(counts(res), { voiceLength: 2 }); for (const voice of measureOf(res.score).voices) sumIs(voice, 1, 1);
});

test('P8-2 규칙 voiceLength: 박자 바꿈·못갖춘마디·마디별 길이(length)를 반영한다(코어 measureLenAt과 같은 기준)', () => {
  const make = () => { const d = fresh(5); d.parts[0].staves[0].measures.forEach((mm, i) => { mm.voices[0] = [note(`e${i * 10 + 1}`, 1, 2), note(`e${i * 10 + 2}`, 1, 2)]; }); return d; };   // 마디마다 2분음표 둘(4/4)
  // 못갖춘마디: 첫 마디 길이 1/4
  let data = make(); measureOf(data, 0).pickup = { n: 1, d: 4 }; measureOf(data, 0).voices[0] = [note('p1', 1, 4)];
  let res = checked(data); assert.deepEqual(res.summary, [], '길이가 맞으면 그대로');
  measureOf(data, 0).voices[0] = [note('p1', 1, 8), note('p2', 1, 2)];
  res = checked(data); const first = measureOf(res.score, 0).voices[0];
  sumIs(first, 1, 4); assert.deepEqual(first.map(ev => [ev.id === 'p1', ev.type, ev.dur.n, ev.dur.d]), [[true, 'note', 1, 8], [false, 'rest', 1, 8]]); assert.deepEqual(counts(res), { voiceLength: 1 });
  measureOf(data, 0).voices[0] = [note('p1', 1, 1)];
  res = checked(data); assert.deepEqual(measureOf(res.score, 0).voices[0], [], '첫 이벤트부터 넘치면 비워서 core가 마디 길이의 온마디쉼표로 채우게 한다');
  const reopened = C.fromJSON(res.score), L = C.measureLenAt(reopened, 0); assert.deepEqual([L.n, L.d], [1, 4]);
  // 박자 바꿈: 3번째 마디부터 3/4 — 뒤 마디가 이어받는다
  data = make(); measureOf(data, 2).timeSig = { num: 3, den: 4 };
  res = checked(data); assert.deepEqual(counts(res), { voiceLength: 3 });
  [4, 4, 3, 3, 3].forEach((quarters, m) => sumIs(measureOf(res.score, m).voices[0], quarters, 4));
  // 마디별 length(3/4 한 마디) — 다음 마디로 이어지지 않는다
  data = make(); measureOf(data, 1).length = { n: 3, d: 4 };
  res = checked(data); sumIs(measureOf(res.score, 1).voices[0], 3, 4); sumIs(measureOf(res.score, 2).voices[0], 1, 1); assert.deepEqual(counts(res), { voiceLength: 1 });
  // 곡 전체 박자 6/8
  data = make(); data.timeSig = { num: 6, den: 8 };
  res = checked(data); res.score.parts[0].staves[0].measures.forEach(mm => sumIs(mm.voices[0], 3, 4)); assert.deepEqual(counts(res), { voiceLength: 5 });
  // 어느 경우든 코어가 읽은 마디 길이와 같다
  for (let m = 0; m < 5; m++) { const score = C.fromJSON(res.score), len = C.measureLenAt(score, m); sumIs(measureOf(res.score, m).voices[0], len.n, len.d); }
});

test('P8-2 고친 항목 목록: 개수는 전부 세고 목록은 200개까지만 담고, 안내 문구는 "규칙 (N건)" 모양이다', () => {
  const data = fresh();
  measureOf(data).voices[0] = Array.from({ length: 1000 }, (_, i) => rest(`e${1000 + i}`, 1, 1000 > 0 ? 1000 : 1, { artics: 'x' }));
  const res = checked(data);
  assert.equal(counts(res).field, 1000);
  assert.equal(res.fixes.length, 200, '자세한 목록은 200개까지');
  assert.deepEqual(Object.keys(res.fixes[0]).sort(), ['action', 'path', 'rule']);
  assert.equal(res.fixes[0].rule, 'field'); assert.equal(res.fixes[0].action, RULES.field.action);
  const lines = fixLines(res.summary);
  assert.ok(lines.length >= 1 && lines.every(line => /^.+ \(\d+건\)$/.test(line)), lines.join('\n'));
  assert.ok(lines.includes(`${RULES.field.label} (1000건)`));
  assert.deepEqual(fixLines([]), []); assert.deepEqual(fixLines(undefined), []);
  assert.equal(Object.keys(RULES).length, 13);
  for (const [rule, info] of Object.entries(RULES)) { assert.ok(info.label && info.action, rule); assert.ok(Object.isFrozen(RULES)); }
});

/* ---------- 구버전 모양 · 한도 · 폭탄 · 퍼징 ---------- */
test('P8-2 구버전 모양(마디에 events만 있음 · parts 없이 measures만 · v1의 measures 사본)은 거절하지 않고 그대로 열린다', () => {
  const source = demo(), staffMeasures = source.parts[0].staves[0].measures;
  // v1: 최상위 measures 사본 + 마디마다 events 별칭 — 정상 파일이라 고친 것이 없고, 사본은 버린다
  const v1 = C.toJSON(SF.io.DEMOS.butterfly(), { format: 1 });
  assert.ok(Array.isArray(v1.measures));
  const r1 = checked(v1);
  assert.deepEqual(r1.summary, []); assert.equal(r1.score.measures, undefined); assert.equal(strip(C.toJSON(C.fromJSON(r1.score))), strip(C.toJSON(C.fromJSON(v1))));
  // 마디에 events만(voices 없음) — parts는 있다
  const eventsOnly = clone(source);
  for (const mm of eventsOnly.parts[0].staves[0].measures) { mm.events = mm.voices[0]; delete mm.voices; }
  const r2 = checked(eventsOnly);
  assert.deepEqual(r2.summary, []);
  assert.deepEqual(clone(measureOf(r2.score, 2).voices[0]), clone(staffMeasures[2].voices[0]));
  assert.equal(measureOf(r2.score, 2).events, undefined);
  // parts 없이 measures만
  const flat = { meta: source.meta, keySig: source.keySig, timeSig: source.timeSig, tempo: source.tempo, measures: staffMeasures.map(mm => ({ events: clone(mm.voices[0]) })) };
  const r3 = checked(flat), opened = C.fromJSON(r3.score);
  assert.deepEqual(r3.summary, []);
  assert.equal(opened.parts[0].staves[0].measures.length, staffMeasures.length);
  usable(r3);
  // 마디가 있는 보표가 없고 최상위 measures만 있으면 그것이 첫 보표 — 길이 규칙도 적용된다
  const short = { ...flat, measures: [{ events: [note('e1', 1, 4)] }] };
  const r4 = checked(short); assert.deepEqual(counts(r4), { voiceLength: 1 }); allFull(C.toJSON(C.fromJSON(r4.score)));
});

test('P8-2 한도: 마디 2,000개 · 보표(악기당 32 · 전체 128) · 이벤트 20만 · (보표 × 마디) 칸 20만 · 배열 길이 · 글자 길이 — 넘으면 열지 않고, 한도 안은 연다', () => {
  const manyMeasures = count => { const d = fresh(1); const m = measureOf(d); d.parts[0].staves[0].measures = Array.from({ length: count }, () => clone(m)); return d; };
  refuses(manyMeasures(2001), 'TOO_MANY_MEASURES', 'parts[0].staves[0].measures');
  const edge = checked(manyMeasures(2000)); assert.equal(edge.score.parts[0].staves[0].measures.length, 2000); assert.deepEqual(edge.summary, []); C.fromJSON(edge.score);
  const staves = count => { const d = fresh(2); const staff = d.parts[0].staves[0]; d.parts[0].staves = Array.from({ length: count }, () => clone(staff)); return d; };
  refuses(staves(33), 'TOO_MANY_STAVES', 'parts[0].staves'); checked(staves(32));
  const parts = count => { const d = fresh(1); d.parts = Array.from({ length: count }, () => clone(d.parts[0])); return d; };
  refuses(parts(129), 'TOO_MANY_STAVES', 'parts'); checked(parts(128));
  const wide = fresh(1); wide.parts = Array.from({ length: 5 }, () => ({ ...clone(wide.parts[0]), staves: Array.from({ length: 26 }, () => clone(wide.parts[0].staves[0])) }));
  assert.match(refuses(wide, 'TOO_MANY_STAVES').fatal.path, /^parts\[4\]\.staves\[\d+\]$/, '전체 128개를 넘는 보표');
  // 이벤트 20만: 한 성부 길이(20만)는 넘지 않게 여러 성부로 나눈다
  const crowd = fresh(1); measureOf(crowd).voices = Array.from({ length: 4 }, () => Array.from({ length: 50001 }, (_, i) => rest(`e${i}`, 1, 64)));
  assert.match(refuses(crowd, 'TOO_MANY_EVENTS').fatal.path, /^parts\[0\]\.staves\[0\]\.measures\[0\]\.voices\[3\]$/);
  // (보표 × 가장 긴 보표의 마디) 칸 20만: 보표 128개 × 1,563마디
  const cells = fresh(1); const staffBase = cells.parts[0].staves[0];
  cells.parts = Array.from({ length: 4 }, (_, p) => ({ ...clone(cells.parts[0]), id: `p${p}`, staves: Array.from({ length: 32 }, () => ({ ...clone(staffBase), measures: [] })) }));
  const m1 = { voices: [[]] };
  cells.parts[0].staves[0].measures = Array.from({ length: 1563 }, () => clone(m1));
  refuses(cells, 'TOO_LARGE', 'score');
  cells.parts[0].staves[0].measures.length = 1562; assert.equal(128 * 1562, 199936); assert.equal(validate(cells).fatal, null, '한도 안(199,936칸)은 연다');
  // 배열 길이 · 글자 길이
  const array = fresh(); array.meta.list = new Array(LIMITS.array + 1).fill(0); refuses(array, 'TOO_LARGE', 'score');
  const text = fresh(); text.meta.title = 'x'.repeat(LIMITS.string + 1); refuses(text, 'TOO_LARGE', 'score');
  const okText = fresh(); okText.meta.title = 'x'.repeat(LIMITS.string); assert.equal(checked(okText).score.meta.title.length, 200, '긴 제목은 자르고 연다(한도 이내 글자)');
  assert.deepEqual([LIMITS.measures, LIMITS.staves, LIMITS.staffTotal, LIMITS.events, LIMITS.cells, LIMITS.array, LIMITS.depth, LIMITS.voices], [2000, 32, 128, 200000, 200000, 200000, 32, 4]);
});

test('P8-2 깊이·순환·공유 참조: 32단계를 넘는 중첩과 순환 참조, 값이 폭발하는 공유 구조도 오래 걸리지 않고 거절한다', () => {
  const nest = levels => { let value = []; for (let i = 0; i < levels; i++) value = [value]; return value; };
  const deep = fresh(); deep.meta.x = nest(40); refuses(deep, 'TOO_DEEP', 'score');
  const shallow = fresh(); shallow.meta.x = nest(12); checked(shallow);
  const object = fresh(); let chain = {}; for (let i = 0; i < 100; i++) chain = { x: chain }; object.style = chain; refuses(object, 'TOO_DEEP');
  const circular = fresh(); circular.meta.self = circular; refuses(circular, 'TOO_DEEP');
  const started = Date.now();
  let shared = []; for (let i = 0; i < 28; i++) shared = [shared, shared];   // 깊이 28, 값 2^28개로 불어나는 구조
  const bomb = fresh(); bomb.meta.bomb = shared;
  refuses(bomb, 'TOO_LARGE', 'score');
  assert.ok(Date.now() - started < 8000, `폭탄 검사가 ${Date.now() - started}ms 걸렸다`);
  // 정상 악보의 깊이는 한도의 절반 이하 — 한도가 정상 파일을 막지 않는다
  let deepest = 0;
  const probe = (value, depth) => { deepest = Math.max(deepest, depth); if (value && typeof value === 'object') for (const key of Object.keys(value)) probe(value[key], depth + 1); };
  for (const name of baselines) probe(baseline(name), 1);
  probe(kitchenSinkSample(), 1);
  assert.ok(deepest <= LIMITS.depth / 2, `정상 악보의 가장 깊은 중첩 ${deepest}단계`);
});
function kitchenSinkSample() { return bases().find(([name]) => name === 'kitchen0')[1]; }

test('P8-2 퍼징 500건(시드 20261123): validate는 던지지 않고 입력을 바꾸지 않으며, 받아들인 악보는 core·그리기·재생·MIDI·MusicXML을 예외 없이 통과한다', { timeout: 150000 }, () => {
  const rnd = mulberry32(20261123), list = bases();
  const stats = { accepted: 0, fixed: 0, fatal: 0, codes: {}, kinds: {} };
  const started = Date.now();
  for (let i = 0; i < 500; i++) {
    const [name, base] = list[Math.floor(rnd() * list.length)];
    const { data, notes } = corrupt(base, rnd);
    for (const note of notes) { const kind = note.split(/[ =]/)[0]; stats.kinds[kind] = (stats.kinds[kind] || 0) + 1; }
    const big = notes.some(note => note.startsWith('huge') || note.startsWith('deep'));
    const before = big ? null : JSON.stringify(data);                     // 큰 것은 문자열로 만드는 데만도 오래 걸려 건너뛴다
    const label = `#${i} ${name} [${notes.join(' | ').slice(0, 200)}]`;
    let res;
    try { res = validate(data); } catch (error) { assert.fail(`${label} validate가 던졌다: ${error.stack}`); }
    if (before !== null) assert.equal(JSON.stringify(data), before, `${label}: 입력이 바뀌었다`);
    if (res.fatal) {
      assert.ok(res.fatal instanceof ScoreFormatError, label);
      assert.notEqual(res.fatal.code, 'INTERNAL', `${label}: ${res.fatal.message}`);
      assert.ok(REASONS[res.fatal.code], `${label}: 이유 문구가 없는 코드 ${res.fatal.code}`);
      assert.equal(res.score, null);
      stats.fatal++; stats.codes[res.fatal.code] = (stats.codes[res.fatal.code] || 0) + 1;
      continue;
    }
    stats.accepted++; if (res.summary.length) stats.fixed++;
    try { exercise(res.score); } catch (error) { assert.fail(`${label}: 받아들인 악보가 앱 경로에서 던졌다 — ${error.stack}`); }
  }
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 30000, `퍼징 500건이 ${elapsed}ms 걸렸다(30초 이내여야 한다)`);
  // 퍼징이 실제로 다양한 손상을 만들고, 고친 것·거절한 것·그대로인 것이 모두 있는지
  for (const kind of ['transplant', 'bykey', 'delete', 'retype', 'huge', 'num', 'deep']) assert.ok(stats.kinds[kind] >= 20, `${kind} 손상이 ${stats.kinds[kind]}건뿐이다: ${JSON.stringify(stats.kinds)}`);
  assert.ok(stats.accepted >= 200 && stats.fixed >= 60 && stats.fatal >= 60, JSON.stringify(stats));
  assert.ok(Object.keys(stats.codes).length >= 5, `여러 거절 코드가 나온다: ${JSON.stringify(stats.codes)}`);
  assert.ok(stats.codes.TOO_DEEP > 0, 'TOO_DEEP');
});

/* =====================================================================================================
 * P8-2 보강 — 변이 검사(코드를 일부러 망가뜨려 시험이 잡아내는지 보는 것)에서 살아남은 곳을 막는 시험.
 * 한도의 "바로 안쪽은 그대로, 바로 바깥은 고친다"를 값마다 확인하고, 장식음·마디 길이 분모 한도·마지막 박자를 고정한다.
 * ===================================================================================================== */
const pitch = (step, alter = 0, oct = 4) => ({ step, alter, oct, tie: false });

test('P8-2 경계값 voices·duration: 성부 4개와 점 2개·잇단음표 2~9 / 1~16은 그대로, 바로 바깥(5개·점 3개·10·0·17)은 고친다', () => {
  const five = fresh(); measureOf(five).voices = [measureOf(five).voices[0], [], [], [], []];
  const fiveRes = checked(five);
  assert.deepEqual(counts(fiveRes), { voices: 1 }, '5개째는 뺀다');
  assert.equal(measureOf(fiveRes.score).voices.length, 4);

  const withDur = extra => { const data = fresh(); measureOf(data).voices[0] = [note('e1', 1, 4, { dur: { n: 1, d: 4, dots: 0, ...extra } }), rest('e2', 1, 4)]; return checked(data); };
  assert.equal(counts(withDur({ dots: 2 })).duration, undefined, '점 2개는 그대로');
  const dots3 = withDur({ dots: 3 });
  assert.equal(counts(dots3).duration, 1); assert.equal(measureOf(dots3.score).voices[0][0].dur.dots, 2, '3개는 2개로 줄인다');
  for (const ok of [{ actual: 2, normal: 1 }, { actual: 9, normal: 16 }, { actual: 2, normal: 16 }, { actual: 9, normal: 1 }])
    assert.equal(counts(withDur({ tuplet: ok })).duration, undefined, `정상 잇단음표 ${JSON.stringify(ok)}`);
  for (const bad of [{ actual: 1, normal: 2 }, { actual: 10, normal: 2 }, { actual: 3, normal: 0 }, { actual: 3, normal: 17 }]) {
    const res = withDur({ tuplet: bad });
    assert.equal(counts(res).duration, 1, `틀린 잇단음표 ${JSON.stringify(bad)}`);
    assert.equal(measureOf(res.score).voices[0][0].dur.tuplet, undefined);
  }
});

test('P8-2 경계값 pitch: step 0~6만 쓸 수 있다 — 7과 −1은 지우고(음이 없어지면 쉼표), 6은 그대로', () => {
  const withStep = step => { const data = fresh(); measureOf(data).voices[0] = [note('e1', 1, 4, { notes: [pitch(step)] }), rest('e2', 1, 4), rest('e3', 1, 4), rest('e4', 1, 4)]; return checked(data); };
  assert.deepEqual(counts(withStep(0)), {}); assert.deepEqual(counts(withStep(6)), {}, 'step 6은 시(B)다');
  for (const step of [7, -1]) {
    const res = withStep(step);
    assert.deepEqual(counts(res), { pitch: 1, emptyNote: 1 }, `step ${step}`);
    assert.equal(measureOf(res.score).voices[0][0].type, 'rest');
  }
});

test('P8-2 경계값 마디 길이: 0 이하·한도 밖 분수는 지우고(signature), 한도 안쪽은 그대로 — length와 pickup 모두', () => {
  const lengthFix = (key, value, m = 1) => { const data = fresh(3); measureOf(data, m)[key] = value; return checked(data); };
  for (const zero of [0, [0, 4], { n: 0, d: 4 }, [-1, 4]]) {
    const res = lengthFix('length', zero);
    assert.deepEqual(counts(res), { signature: 1 }, `length ${JSON.stringify(zero)}`);
    assert.equal(measureOf(res.score, 1).length, undefined);
  }
  const zeroPickup = lengthFix('pickup', 0, 0);
  assert.deepEqual(counts(zeroPickup), { signature: 1 }); assert.equal(measureOf(zeroPickup.score, 0).pickup, undefined);
  for (const over of [[4099, 4101], [3, 4099], [129, 4]]) {
    const res = lengthFix('length', over);
    assert.equal(counts(res).signature, 1, `length ${JSON.stringify(over)}는 한도 밖`);
    assert.equal(measureOf(res.score, 1).length, undefined);
  }
  for (const inside of [[4093, 4096], [1, 4096], [128, 4]]) {
    const res = lengthFix('length', inside);
    assert.equal(counts(res).signature, undefined, `length ${JSON.stringify(inside)}는 한도 안쪽`);
    assert.deepEqual([...measureOf(res.score, 1).length], inside);
  }
});

test('P8-2 경계값 fretboard: 줄 12 · 프렛 24 · 시작 프렛 40까지는 그대로 둔다(바로 바깥은 위 표에서 지운다)', () => {
  const data = fresh();
  measureOf(data).voices[0][0].fretboard = { strings: 12, frets: 24, firstFret: 40, positions: new Array(12).fill(0) };
  const res = checked(data);
  assert.deepEqual(counts(res), {});
  assert.equal(measureOf(res.score).voices[0][0].fretboard.strings, 12);
});

test('P8-2 규칙 field(장식음): 모양이 틀린 장식음은 그 장식음만 지우고, 음높이가 틀린 음은 걸러 내며 "pitch"로도 알린다', () => {
  const grace = (extra = {}) => ({ notes: [pitch(0, 0, 5)], dur: { n: 1, d: 8 }, ...extra });
  const withGrace = list => { const data = fresh(); measureOf(data).voices[0][0].graceBefore = list; return checked(data); };
  const graceOf = res => measureOf(res.score).voices[0][0].graceBefore;

  // 정상 — 한 건도 고치지 않는다(id·kind는 문자열, dur는 n ≤ d)
  const fine = withGrace([grace({ id: 'g1', kind: 'acciaccatura' }), grace({ dur: { n: 1, d: 1 } })]);
  assert.deepEqual(counts(fine), {}); assert.equal(graceOf(fine).length, 2);

  // 모양이 틀린 것은 그것만 지운다 — 나머지(정상 장식음)는 제자리
  const badOnes = [
    ['notes가 목록이 아님', { notes: 'x' }],
    ['dur가 온음표보다 김', { dur: { n: 2, d: 1 } }],
    ['dur가 객체가 아님', { dur: 5 }],
    ['id가 문자열이 아님', { id: 5 }],
    ['kind가 문자열이 아님', { kind: 5 }],
    ['음이 하나도 없음', { notes: [] }],
  ];
  for (const [name, extra] of badOnes) {
    const res = withGrace([grace({ id: 'keep' }), grace(extra)]);
    assert.deepEqual(counts(res), { field: 1 }, name);
    assert.deepEqual(graceOf(res).map(g => g.id), ['keep'], name);
  }
  const notObject = withGrace([grace({ id: 'keep' }), 7]);
  assert.deepEqual(counts(notObject), { field: 1 }); assert.equal(graceOf(notObject).length, 1);

  // 음높이가 틀린 음은 걸러 내고 장식음은 남긴다 — 고쳤다는 사실도 pitch로 센다
  const mixed = withGrace([grace({ notes: [pitch(0, 0, 5), pitch(9, 0, 5), { step: 2, oct: 4, tie: false }] })]);
  assert.deepEqual(counts(mixed), { pitch: 1 });
  assert.equal(graceOf(mixed).length, 1); assert.equal(graceOf(mixed)[0].notes.length, 2, '틀린 음 1개만 빠졌고 alter가 빠진 음은 0으로 채웠다');
  assert.equal(graceOf(mixed)[0].notes[1].alter, 0);
  // 음이 모두 틀리면 장식음을 지운다(pitch + field)
  const none = withGrace([grace({ id: 'keep' }), grace({ notes: [pitch(9, 0, 5)] })]);
  assert.deepEqual(counts(none), { pitch: 1, field: 1 }); assert.deepEqual(graceOf(none).map(g => g.id), ['keep']);
  // 장식음 목록이 목록이 아니면 통째로 지운다
  const notArray = withGrace('x');
  assert.deepEqual(counts(notArray), { field: 1 }); assert.equal(measureOf(notArray.score).voices[0][0].graceBefore, undefined);
  usable(mixed); usable(none);
});

test('P8-2 규칙 voiceLength(분모 한도): 합은 맞아도 중간 합의 분모가 1,048,576을 넘으면 그 성부를 비운다 — core의 정수 계산을 벗어나지 않게', () => {
  const data = fresh(), mm = measureOf(data);
  mm.length = [2, 1];
  mm.voices[0] = [rest('e1', 1, 4093), rest('e2', 1, 4091), rest('e3', 4092, 4093), rest('e4', 4090, 4091)];   // 모두 더하면 정확히 2/1이다
  sumIs(mm.voices[0], 2, 1);
  const res = checked(data);
  assert.deepEqual(counts(res), { voiceLength: 1 });
  assert.deepEqual([...measureOf(res.score).voices[0]], [], '성부를 비워 두면 core가 온마디쉼표로 채운다');
  usable(res);
  // 같은 합이라도 분모가 작게 유지되는 순서·값이면 그대로 둔다
  const small = fresh(); measureOf(small).length = [2, 1];
  measureOf(small).voices[0] = [rest('e1', 1, 3), rest('e2', 2, 3), rest('e3', 1, 1)];
  assert.deepEqual(counts(checked(small)), {}, '분모 3은 작다');
});

test('P8-2 규칙 signature(마디 길이 분모 한도): 마디 길이를 이어 붙인 합의 분모가 한도를 넘으면 그 마디의 length만 지운다 — 앞의 마디는 그대로', () => {
  const data = fresh(3);
  measureOf(data, 0).length = [1, 4093]; measureOf(data, 1).length = [1, 4091]; measureOf(data, 2).length = [1, 4079];
  const res = checked(data);
  assert.equal(counts(res).signature, 2, '둘째·셋째만 걸린다');
  assert.deepEqual([...measureOf(res.score, 0).length], [1, 4093], '첫 마디는 합의 분모가 작아 그대로');
  assert.equal(measureOf(res.score, 1).length, undefined); assert.equal(measureOf(res.score, 2).length, undefined);
  usable(res);
  // 분모가 서로 맞물려 작게 유지되면 길이를 그대로 둔다
  const small = fresh(3);
  measureOf(small, 0).length = [1, 3]; measureOf(small, 1).length = [1, 6]; measureOf(small, 2).length = [1, 2];
  assert.equal(counts(checked(small)).signature, undefined);
});

test('P8-2 규칙 voiceLength(끝 박자): 첫 보표보다 마디가 더 긴 보표의 남는 마디는 곡의 마지막 박자를 따른다(4/4로 가정하지 않는다)', () => {
  const data = C.toJSON(C.createScore({ measureCount: 2, ensemble: 'piano' }));
  data.timeSig = { num: 3, den: 4 };
  const [top, bottom] = data.parts[0].staves.map(staff => staff.measures);
  const threeQuarters = tag => [note(`${tag}a`, 1, 4), note(`${tag}b`, 1, 4), note(`${tag}c`, 1, 4)];
  top.forEach((mm, m) => { mm.voices = [threeQuarters(`t${m}`)]; });
  bottom.forEach((mm, m) => { mm.voices = [threeQuarters(`b${m}`)]; });
  bottom.push({ ...clone(bottom[0]), voices: [threeQuarters('extra')] });       // 아래 보표에만 있는 셋째 마디
  assert.equal(top.length, 2); assert.equal(bottom.length, 3);
  const res = checked(data);
  assert.deepEqual(counts(res), {}, '3/4 길이로 맞는 마디는 하나도 고치지 않는다');
  assert.equal(res.score.parts[0].staves[1].measures[2].voices[0].length, 3);
  usable(res);
});
