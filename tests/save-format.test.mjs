// P7-B1: 저장 형식 v2 — 같은 음표를 최대 4번 저장하던 중복(마디 events 별칭·최상위 measures·빈 2~4성부의 온쉼표)을 없앤다.
// core.js만 로드한다. 읽기는 v1·v2 모두, 쓰기는 기본 v2({ format: 1 }은 구버전 호환 출력).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { canonicalIds } from './golden-utils.mjs';

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../js/core.js', import.meta.url), 'utf8'), { filename: 'core.js' });
const SF = globalThis.SF, C = SF.core, F = SF.F;
const BASE = new URL('./baseline/', import.meta.url);
const fixtures = readdirSync(BASE).filter(f => f.endsWith('.scoreforge.json')).sort();
const loadRaw = file => JSON.parse(readFileSync(new URL(file, BASE), 'utf8'));
const asScore = raw => C.fromJSON(raw.score || raw);
const roundTrip = (score, opts) => C.fromJSON(JSON.parse(JSON.stringify(C.toJSON(score, opts))));
// 빈 성부 쉼표 ID는 읽을 때 새로 만들어지므로 ID를 순서로 바꾸고 키를 정렬해 비교한다. schema는 파일 머리 정보라 뺀다.
const view = score => { const j = C.toJSON(score, { format: 1 }); delete j.schema; return canonicalIds(j); };
const quarter = { n: 1, d: 4, dots: 0 }, pitch = { step: 0, alter: 0, oct: 4 };
const measuresOf = json => json.parts[0].staves[0].measures;
const eachMeasure = (json, fn) => { for (const part of json.parts) for (const staff of part.staves) for (const mm of staff.measures) fn(mm); };
const restOf = (len, voice) => ({ id: C.newId(), type: 'rest', dur: { ...len, dots: 0 }, notes: [], voice });
/** 2·3성부의 쉼표를 시작·끝점으로 삼는 헤어핀이 든 2마디 악보(2성부는 그냥 온쉼표, 3성부는 2분쉼표 둘). */
function silentVoiceHairpin() {
  const s = C.createScore({ measureCount: 2, ensemble: 'piano' });
  C.ensureParts(s);
  const [m0, m1] = s.parts[0].staves[0].measures;
  const a = C.getVoiceEvents(m0, 2, s)[0], b = C.getVoiceEvents(m1, 2, s)[0];
  m0.voices[2] = [restOf({ n: 1, d: 2 }, 3), restOf({ n: 1, d: 2 }, 3)];
  C.invalidate(s);
  const [c, d] = m0.voices[2];
  s.spanners.push({ id: C.newId(), type: 'cresc', startId: a.id, endId: b.id }, { id: C.newId(), type: 'dim', startId: c.id, endId: d.id });
  C.normalizeSpanners(s);
  assert.equal(s.spanners.length, 2, '준비한 두 헤어핀이 모델에서 유효하다');
  return { s, a, b, c, d };
}

for (const file of fixtures) test(`저장 형식 v2 왕복 = v1 왕복: ${file}`, () => {
  const base = asScore(loadRaw(file));
  assert.deepEqual(view(roundTrip(base)), view(roundTrip(base, { format: 1 })));
});

for (const file of fixtures) test(`v2로 저장 → 읽기 → 다시 v2로 저장하면 글자까지 같다(기록과 화면 내용 비교가 쓰는 성질): ${file}`, () => {
  const once = JSON.stringify(C.toJSON(asScore(loadRaw(file))));
  assert.equal(JSON.stringify(C.toJSON(C.fromJSON(JSON.parse(once)))), once);
});

test('quartet64 저장 크기 60% 이상 감소', () => {
  const base = asScore(loadRaw('quartet64.scoreforge.json'));
  const v1 = JSON.stringify(C.toJSON(base, { format: 1 })).length, v2 = JSON.stringify(C.toJSON(base)).length;
  assert.ok(v2 <= v1 * 0.4, `v1 ${v1} → v2 ${v2}`);
});

test('기준 악보 5개 모두 v2가 v1보다 60% 이상 작다', () => {
  assert.equal(fixtures.length, 5);
  for (const file of fixtures) {
    const base = asScore(loadRaw(file));
    const v1 = JSON.stringify(C.toJSON(base, { format: 1 })).length, v2 = JSON.stringify(C.toJSON(base)).length;
    assert.ok(v2 <= v1 * 0.4, `${file}: v1 ${v1} → v2 ${v2}`);
  }
});

test('v2 모양: 마디 events·최상위 measures가 없고 schema가 2, 1성부는 늘 남고 끝의 빈 성부는 없다', () => {
  for (const file of fixtures) {
    const json = C.toJSON(asScore(loadRaw(file)));
    assert.equal(json.schema, 2, file);
    assert.equal('measures' in json, false, `${file}: 최상위 measures`);
    assert.equal(JSON.stringify(json).includes('"events"'), false, `${file}: events`);
    eachMeasure(json, mm => {
      assert.ok(mm.voices.length >= 1 && mm.voices.length <= 4, file);
      assert.ok(mm.voices[0].length >= 1, `${file}: 1성부는 비지 않는다`);
      assert.ok(mm.voices.length === 1 || mm.voices.at(-1).length > 0, `${file}: 끝의 빈 성부는 잘라 낸다`);
    });
  }
});

test("{ format: 1 }은 예전 출력(마디 events 별칭 + 최상위 measures)과 같고 schema가 없다", () => {
  const s = asScore(loadRaw('star.scoreforge.json'));
  const old = JSON.parse(JSON.stringify(s));                       // 예전 toJSON: 복사 + 마디마다 events = voices[0] + 최상위 measures
  for (const part of old.parts) for (const staff of part.staves) for (const mm of staff.measures) mm.events = mm.voices[0];
  old.measures = old.parts[0].staves[0].measures;
  const now = C.toJSON(s, { format: 1 });
  assert.deepEqual(now, old);
  assert.equal('schema' in now, false);
  assert.equal(JSON.stringify(now), JSON.stringify(old), '키 순서까지 같다');
});

test('옵션 없이 부르면 v2, { format: 2 }·알 수 없는 format도 v2(예전 출력은 format: 1을 명시해야만 나온다)', () => {
  const s = C.createScore({ measureCount: 1 });
  assert.equal(C.toJSON(s).schema, 2);
  assert.equal(C.toJSON(s, {}).schema, 2);
  assert.equal(C.toJSON(s, { format: 2 }).schema, 2);
  assert.equal('schema' in C.toJSON(s, { format: 1 }), false);
});

test('빈 성부의 쉼표를 시작·끝점으로 하는 헤어핀은 v2 왕복 뒤에도 남는다(pinned 보존)', () => {
  const { s, a, b, c, d } = silentVoiceHairpin();
  const json = C.toJSON(s);
  assert.equal(json.schema, 2, 'v2로 저장했다');
  const [j0, j1] = measuresOf(json);
  // 스패너가 가리키지 않는 빈 성부(4성부)는 정말로 잘렸다 — 모든 성부를 그냥 남긴 것이 아니다
  assert.equal(j0.voices.length, 3, '0마디: 1·2·3성부만 남고 4성부는 잘림');
  assert.equal(j1.voices.length, 2, '1마디: 1·2성부만 남음');
  assert.deepEqual(j0.voices[1].map(e => e.id), [a.id]);
  assert.deepEqual(j0.voices[2].map(e => e.id), [c.id, d.id], '성부 안의 쉼표 하나만 가리켜도 그 성부는 통째로 남는다');
  const back = C.fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(back.spanners.length, 2, '헤어핀 2개가 그대로');
  const byType = Object.fromEntries(back.spanners.map(sp => [sp.type, sp]));
  assert.deepEqual([byType.cresc.startId, byType.cresc.endId], [a.id, b.id]);
  assert.deepEqual([byType.dim.startId, byType.dim.endId], [c.id, d.id]);
  for (const id of [a.id, b.id, c.id, d.id]) assert.equal(C.findEvent(back, id)?.ev.type, 'rest', id);
});

test('스패너가 가리키지 않는 빈 성부는 잘리고, 읽을 때 온쉼표로 다시 채워진다(헤어핀 시험의 대조군)', () => {
  const { s } = silentVoiceHairpin();
  s.spanners.length = 0;                                           // 가리키는 스패너가 없으면 빈 성부는 잘리고, 새 ID로 다시 채워진다
  const json = C.toJSON(s);
  assert.equal(measuresOf(json)[0].voices.length, 1);
  const back = C.fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(C.getVoiceEvents(back.parts[0].staves[0].measures[0], 2, back).length, 1, '2성부는 온쉼표로 채워짐');
});

test('표시(셈여림·문자·연습 기호·아티큘레이션)가 붙은 쉼표가 든 성부는 "빈 성부"가 아니라 그대로 남는다 — 표시 없는 성부만 잘린다', () => {
  const s = C.createScore({ measureCount: 2, ensemble: 'piano' });
  C.ensureParts(s);
  const [m0, m1] = s.parts[0].staves[0].measures;
  const marks = [[m0, 1, { dynamic: 'mf' }], [m0, 2, { staffText: '천천히' }], [m0, 3, { rehearsal: 'A' }], [m1, 1, { artics: ['fermata'] }], [m1, 2, { dynamic: 'p' }]];
  const marked = marks.map(([measure, voice, mark]) => {
    const rest = measure.voices[voice][0];
    assert.equal(rest.type, 'rest', `준비: ${voice + 1}성부는 쉼표로 시작한다`);
    Object.assign(rest, mark);
    return { id: rest.id, mark };
  });
  const json = C.toJSON(s);
  const [j0, j1] = measuresOf(json);
  assert.equal(j0.voices.length, 4, '0마디: 2·3·4성부에 모두 표시가 있어 하나도 안 잘린다');
  assert.equal(j1.voices.length, 3, '1마디: 4성부는 표시가 없어 잘린다');
  const back = C.fromJSON(JSON.parse(JSON.stringify(json)));
  for (const { id, mark } of marked) {
    const found = C.findEvent(back, id);
    assert.ok(found, `${id} 쉼표가 같은 ID로 돌아온다`);
    for (const [key, value] of Object.entries(mark)) assert.deepEqual(found.ev[key], value, `${id}.${key}`);
  }
});

test('박자를 바꾼·못갖춘마디·여러 성부·왼손 보표가 섞인 악보도 v2 왕복 = v1 왕복, 채운 쉼표 길이는 마디 길이와 같다', () => {
  const s = C.createScore({ measureCount: 6, ensemble: 'piano' });
  C.setMeasureTimeSig(s, 2, { num: 3, den: 4 });
  C.setMeasureTimeSig(s, 4, { num: 5, den: 8 });
  C.setPickup(s, F(1, 4));
  C.inputAt(s, 1, F(0, 1), quarter, [pitch], { voice: 2 });
  C.inputAt(s, 3, F(0, 1), quarter, [pitch], { partIdx: 0, staffIdx: 1, voice: 3 });
  C.inputAt(s, 5, F(0, 1), quarter, [pitch]);
  assert.deepEqual(view(roundTrip(s)), view(roundTrip(s, { format: 1 })));
  const back = roundTrip(s);
  for (const ref of C.staffRefs(back)) for (const [m, mm] of ref.measures.entries()) for (let v = 1; v <= 4; v++) {
    const sum = C.getVoiceEvents(mm, v, back).reduce((acc, e) => acc.add(C.durValue(e.dur)), F(0, 1));
    assert.ok(sum.eq(C.measureLenAt(back, m)), `${m}마디 ${v}성부 길이 ${sum}`);
  }
});

test('measures만 있는 옛 파일(parts 없음)도 음표를 잃지 않고 읽힌다', () => {
  const s = C.createScore({ measureCount: 2 });
  C.inputAt(s, 0, F(0, 1), quarter, [pitch]);
  const old = C.toJSON(s, { format: 1 }); delete old.parts;         // 옛 파일: 최상위 measures(+events)만
  assert.ok(Array.isArray(old.measures) && old.measures.length === 2);
  const back = C.fromJSON(old);
  assert.equal(back.parts.length, 1);
  const first = back.parts[0].staves[0].measures[0].voices[0][0];
  assert.equal(first.type, 'note');
  assert.equal(C.midiOf(first.notes[0]), 60);
});

test('v1 데이터와 v2 데이터를 모두 읽고, 읽은 결과는 같다(기준 악보 원본 v1 ↔ 다시 쓴 v2)', () => {
  for (const file of fixtures) {
    const raw = loadRaw(file);
    const fromV1 = asScore(raw);
    const fromV2 = C.fromJSON(JSON.parse(JSON.stringify(C.toJSON(fromV1))));
    assert.deepEqual(view(fromV2), view(fromV1), file);
  }
});

test('keepSilentVoices: 빈 성부를 남기되 중복 필드는 뺀다 — 쉼표 ID가 그대로 돌아온다(7-B2 실행 취소용)', () => {
  const s = asScore(loadRaw('star.scoreforge.json'));
  const idsOf = score => { const ids = []; C.forEachEvent(score, ev => ids.push(ev.id), { includeSilent: true }); return ids.sort(); };
  const kept = C.toJSON(s, { keepSilentVoices: true });
  assert.equal(kept.schema, 2);
  assert.equal('measures' in kept, false);
  eachMeasure(kept, mm => { assert.equal('events' in mm, false); assert.equal(mm.voices.length, 4); });
  assert.deepEqual(idsOf(C.fromJSON(JSON.parse(JSON.stringify(kept)))), idsOf(s));
  const slim = C.toJSON(s);
  assert.ok(JSON.stringify(slim).length < JSON.stringify(kept).length, '기본 v2가 더 작다');
});

test('읽은 악보의 모델에는 schema가 남지 않는다(가져오기가 안에서 fromJSON(toJSON())을 하므로) — 입력 객체는 그대로', () => {
  const v2 = JSON.parse(JSON.stringify(C.toJSON(asScore(loadRaw('star.scoreforge.json')))));
  assert.equal(v2.schema, 2);
  const back = C.fromJSON(v2);
  assert.equal('schema' in back, false);
  assert.equal(v2.schema, 2, '입력은 건드리지 않는다');
  assert.equal('schema' in C.toJSON(back, { format: 1 }), false);
  assert.equal('schema' in C.fromJSON(C.toJSON(back)), false, '안쪽 왕복을 거친 모델도');
});

test('v2 JSON을 setScore로 곧장 넣어도 편집·되돌리기·다시 저장이 된다', () => {
  const s = asScore(loadRaw('star.scoreforge.json'));
  const v2 = JSON.parse(JSON.stringify(C.toJSON(s)));
  C.setScore(v2);
  assert.equal('schema' in C.state.score, false);
  const before = JSON.stringify(C.toJSON(C.state.score));
  C.mutate('편집', sc => C.inputAt(sc, 0, F(0, 1), quarter, [pitch]));
  assert.notEqual(JSON.stringify(C.toJSON(C.state.score)), before);
  assert.ok(C.undo());
  assert.equal(JSON.stringify(C.toJSON(C.state.score)), before);
});

test('옛 앱(3.0.1)이 v2 파일을 열었다가 다시 저장한 모양(schema 2 + 최상위 measures + 마디 events + 성부 전부 채움)도 같은 악보로 읽힌다', () => {
  for (const file of fixtures) {
    const s = asScore(loadRaw(file));
    const mixed = C.toJSON(s, { format: 1 });                       // 옛 앱의 출력 모양: events 별칭 + 최상위 measures + 4성부 모두 채움
    mixed.schema = 2;                                               // 옛 앱은 모르는 칸을 지우지 않고 그대로 들고 있다
    const back = C.fromJSON(JSON.parse(JSON.stringify(mixed)));
    assert.equal('schema' in back, false, `${file}: 모델에 schema가 남지 않는다`);
    assert.deepEqual(view(back), view(s), `${file}: 같은 악보`);
  }
});
