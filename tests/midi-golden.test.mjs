// P7-A1: MIDI 가져오기를 "일괄 입력 모드"로 빠르게 만들어도 결과는 1비트도 달라지지 않아야 한다 — 골든(특성) 테스트.
//  - 골든 값은 7-A1 이전 코드(016ad44 기준, 그 뒤 Phase 1~6을 거친 같은 값)에서 계산해 고정했다. 바뀌면 가져오기 결과가 달라진 것이다.
//  - 비교는 이벤트 ID를 등장 순서의 id0, id1…로 바꾸고 키를 정렬한 뒤 해시한다(tests/golden-utils.mjs). 해시는 toJSON(score, { format: 1 })로 계산해
//    7-B1(저장 형식 v2) 전후 모두 유효하다(지금은 두 번째 인자를 무시한다).
//  - 아래 두 번째 묶음은 일괄 모드 API(inputAtEvent·ctx.batch)의 약속을 따로 못 박는다: 일반 편집은 그대로이고, 일괄 모드만 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
import { readFileSync } from 'node:fs';
import { hashJSON, seededMidi, tripletsMidi, drumsMidi } from './golden-utils.mjs';
const C = SF.core, IO = SF.io, F = SF.F;

// 016ad44(7-A1 이전)에서 계산해 고정한 값. 바뀌면 가져오기 결과가 달라진 것이다.
const GOLDEN = { hash: 'cf9e4f7da2f9bc60', placed: 568 };

test('MIDI 가져오기 결과가 7-A1 전후로 같다(골든)', () => {
  const r = IO.midiToScore(IO.parseMidi(seededMidi()), { grid: 1 / 16, splitHands: true });
  assert.equal(r.placed, GOLDEN.placed);
  assert.equal(hashJSON(C.toJSON(r.score, { format: 1 })), GOLDEN.hash);
});

test('골든 입력은 도우미의 약속대로 화음·쉼표·마디 넘김 음·양손 분리를 모두 품는다(골든이 약해지지 않게)', () => {
  const r = IO.midiToScore(IO.parseMidi(seededMidi()), { grid: 1 / 16, splitHands: true });
  const events = [];
  for (const ref of C.staffRefs(r.score)) for (let m = 0; m < ref.measures.length; m++) for (const entry of C.measureEntries(ref.measures[m], { score: r.score, includeSilent: true })) events.push({ ...entry, staff: ref.staffIdx ?? 0 });
  const notes = events.filter(e => e.ev.type === 'note');
  assert.ok(notes.some(e => e.ev.notes.length >= 3), '화음(3음)이 있다');
  assert.ok(notes.some(e => e.ev.notes.some(n => n.tie)), '마디를 넘겨 이어진 음(타이)이 있다');
  assert.ok(events.some(e => e.ev.type === 'rest' && C.hasVisibleContent(e.ev)), '보이는 쉼표가 있다');
  assert.equal(C.staffRefs(r.score).length, 2, '양손 분리로 보표가 둘이다');
  assert.ok(r.score.measures.length >= 50, `마디가 충분히 많다(${r.score.measures.length})`);
});

// ---- 골든 행렬: 여러 입력 × 여러 옵션 ----
// 아래 값은 7-A1 이전 구현(phase/p6-narrow-screen = eb4ce75)에서 계산해 고정했다. 새 구현과 비교해 37가지가 모두 같음을 확인했다.
// [이름, 놓은 음표 수, 해시]. 입력은 모두 고정 시드·고정 모양이다(tests/golden-utils.mjs) — 셋잇단(detectTriplets), 드럼(채널 10), 양손 분리, 1/8·1/16·1/32 격자를 두루 거친다.
const MATRIX = [
  ["seed20261123/600 g16-split", 568, 'cf9e4f7da2f9bc60'],
  ["seed20261123/600 g8", 518, '03e6654cc168f02f'],
  ["seed20261123/600 g32-split", 568, 'cf9e4f7da2f9bc60'],
  ["seed20261123/600 g16-trip", 525, '950b6c3333abf788'],
  ["seed20261123/600 g16-split-trip", 568, 'cf9e4f7da2f9bc60'],
  ["seed7/400 g16-split", 377, 'e0161260e3199e2a'],
  ["seed7/400 g8", 338, 'd06c736e6f441afc'],
  ["seed7/400 g32-split", 377, 'e0161260e3199e2a'],
  ["seed7/400 g16-trip", 345, '5c3d5c347762f904'],
  ["seed7/400 g16-split-trip", 377, 'e0161260e3199e2a'],
  ["seed424242/400 g16-split", 357, '4696ea423197c033'],
  ["seed424242/400 g8", 329, 'a6e23d44ee38c6f8'],
  ["seed424242/400 g32-split", 357, '4696ea423197c033'],
  ["seed424242/400 g16-trip", 334, 'b90eb896e8de50b9'],
  ["seed424242/400 g16-split-trip", 357, '4696ea423197c033'],
  ["seed99/300 g16-split", 272, 'ac191c653b2ef6e5'],
  ["seed99/300 g8", 239, 'a17b547034580986'],
  ["seed99/300 g32-split", 272, 'ac191c653b2ef6e5'],
  ["seed99/300 g16-trip", 247, '49ec7ad611c04ac3'],
  ["seed99/300 g16-split-trip", 272, 'ac191c653b2ef6e5'],
  ["triplets g16", 96, 'e49967662a3ee7b3'],
  ["triplets g16-trip", 96, '448399a1cd54caf5'],
  ["triplets g32-trip", 96, '7e293b3460a286df'],
  ["drums g16", 80, 'bd7a59cc21d3288c'],
  ["drums g16-split", 80, 'e7fdb7aa3707ef06'],
  ["baseline star default", 42, '0e35244e590e34a9'],
  ["baseline star split-trip", 42, '1870704c494f781b'],
  ["baseline star g8", 42, '0e35244e590e34a9'],
  ["baseline butterfly default", 27, '86d596c15f6c62fa'],
  ["baseline butterfly split-trip", 27, '7e23efe23d01896d'],
  ["baseline butterfly g8", 27, '86d596c15f6c62fa'],
  ["baseline airplane default", 26, '7c91e0c14da67f48'],
  ["baseline airplane split-trip", 26, '55f1ee4906e08fa6'],
  ["baseline airplane g8", 26, '4a819b6fb0feaa96'],
  ["baseline rhythm default", 19, '148504e7e1eba452'],
  ["baseline rhythm split-trip", 19, 'e6bb17755676c4f0'],
  ["baseline rhythm g8", 19, '148504e7e1eba452'],
];
const OPTIONS = {
  'g16-split': { grid: 1 / 16, splitHands: true }, 'g8': { grid: 1 / 8 }, 'g32-split': { grid: 1 / 32, splitHands: true },
  'g16-trip': { grid: 1 / 16, detectTriplets: true }, 'g16-split-trip': { grid: 1 / 16, splitHands: true, detectTriplets: true },
  'g32-trip': { grid: 1 / 32, detectTriplets: true }, 'g16': { grid: 1 / 16 }, 'default': {}, 'split-trip': { splitHands: true, detectTriplets: true },
};
const baseline = name => new Uint8Array(readFileSync(new URL(`./baseline/${name}.mid`, import.meta.url)));
function inputFor(name) { // 이름 → [MIDI 바이트, 옵션 이름]
  const [kind, ...rest] = name.split(' ');
  const opt = rest.at(-1);
  if (kind.startsWith('seed')) { const [seed, count] = kind.slice(4).split('/').map(Number); return [seededMidi(seed, count), opt]; }
  if (kind === 'triplets') return [tripletsMidi(), opt];
  if (kind === 'drums') return [drumsMidi(), opt];
  if (kind === 'baseline') return [baseline(rest[0]), opt];
  throw new Error('알 수 없는 골든 입력: ' + name);
}
test(`MIDI 가져오기 골든 행렬 ${MATRIX.length}가지 — 입력·옵션이 달라도 결과가 7-A1 전후로 같다`, () => {
  const bad = [];
  for (const [name, placed, hash] of MATRIX) {
    const [bytes, opt] = inputFor(name);
    assert.ok(OPTIONS[opt], `옵션 이름 ${opt}`);
    const r = IO.midiToScore(IO.parseMidi(bytes), OPTIONS[opt]);
    const got = hashJSON(C.toJSON(r.score, { format: 1 }));
    if (r.placed !== placed || got !== hash) bad.push(`${name}: 음표 ${r.placed}(기대 ${placed}) 해시 ${got}(기대 ${hash})`);
  }
  assert.deepEqual(bad, [], '달라진 조합이 없다');
});

test('골든 행렬은 셋잇단 음과 드럼 표기 대체 경로를 실제로 거친다(행렬이 약해지지 않게)', () => {
  const trip = IO.midiToScore(IO.parseMidi(tripletsMidi()), OPTIONS['g16-trip']);
  let tuplets = 0;
  for (const ref of C.staffRefs(trip.score)) for (let m = 0; m < ref.measures.length; m++) for (const entry of C.measureEntries(ref.measures[m], { score: trip.score })) if (entry.ev.dur?.tuplet) tuplets++;
  assert.ok(tuplets >= 30, `셋잇단 음 ${tuplets}개`);
  const drums = IO.midiToScore(IO.parseMidi(drumsMidi()), OPTIONS.g16);
  assert.ok(drums.report.some(line => /드럼 \d+의 표기는 스네어로 대체/.test(line)), '표기가 정해지지 않은 드럼 번호는 스네어로 대체한다는 안내가 나온다');
  let drumEvents = 0;
  for (const ref of C.staffRefs(drums.score)) for (let m = 0; m < ref.measures.length; m++) for (const entry of C.measureEntries(ref.measures[m], { score: drums.score })) if (entry.ev.drumId) drumEvents++;
  assert.ok(drumEvents >= 60, `드럼 이벤트 ${drumEvents}개`);
});

// ---- 일괄 모드 API ----
const pitch = (midi = 60) => C.spellMidi(midi, 0);
const fresh = () => C.createScore({ measureCount: 4, tempo: 120 });

test('inputAtEvent: 기존 inputAt과 같은 ID를 주고, 악보 안에 들어 있는 바로 그 이벤트 객체를 함께 돌려준다', () => {
  const a = fresh(), b = fresh();
  const viaInputAt = C.inputAt(a, 0, F(0), { n: 1, d: 4 }, [pitch(62)]);
  const viaEvent = C.inputAtEvent(b, 0, F(0), { n: 1, d: 4 }, [pitch(62)]);
  assert.equal(typeof viaInputAt, 'string');
  assert.equal(typeof viaEvent.id, 'string');
  assert.equal(C.findEvent(b, viaEvent.id).ev, viaEvent.ev, '돌려준 객체는 악보 안의 이벤트와 같은 객체(찾을 필요가 없다)');
  assert.equal(viaEvent.ev.type, 'note');
  assert.deepEqual(JSON.parse(JSON.stringify(C.findEvent(a, viaInputAt).ev.notes)), JSON.parse(JSON.stringify(viaEvent.ev.notes)));
});

test('inputAtEvent: 마디를 넘는 음은 첫 조각을 돌려주고 타이로 이어진다(둘 다 같은 방식)', () => {
  const s = fresh();
  const r = C.inputAtEvent(s, 0, F(3, 4), { n: 1, d: 2, dots: 0 }, [pitch(64)]);
  assert.equal(C.findEvent(s, r.id).m, 0, '첫 조각은 0마디');
  assert.equal(r.ev.notes[0].tie, true, '다음 마디로 이어지는 타이');
  assert.equal(C.findEvent(s, r.id).ev, r.ev);
});

test('ctx.batch: 일괄 모드는 입력마다의 타이 정리(normalizeTies)를 건너뛰고, 일반 입력은 그대로 정리한다', () => {
  const dangling = (batch) => {
    const s = fresh();
    const first = C.inputAt(s, 0, F(0), { n: 1, d: 4 }, [pitch(60)]);
    C.findEvent(s, first).ev.notes[0].tie = true; // 다음 이벤트에 같은 음높이가 없는 떠도는 타이
    const ctx = batch ? { batch: true } : undefined;
    C.inputAtEvent(s, 1, F(0), { n: 1, d: 4 }, [pitch(67)], ctx);
    return C.findEvent(s, first).ev.notes[0].tie;
  };
  assert.equal(dangling(false), false, '일반 입력은 떠도는 타이를 지운다');
  assert.equal(dangling(true), true, '일괄 모드는 그 자리에서 정리하지 않는다(마지막에 한 번만)');
});

test('ctx.batch: 일괄 모드는 마디 길이·조표 캐시(timing)를 유지하고, 일반 입력은 예전처럼 새로 만든다', () => {
  const kept = (batch) => {
    const s = fresh();
    const before = C.measureStarts(s);
    C.inputAtEvent(s, 0, F(0), { n: 1, d: 4 }, [pitch(60)], batch ? { batch: true } : undefined);
    return C.measureStarts(s) === before;
  };
  assert.equal(kept(true), true, '일괄 모드: 같은 캐시 배열');
  assert.equal(kept(false), false, '일반 입력: 캐시를 새로 만든다(③을 일반 편집으로 넓히지 않는다)');
});

test('ctx.batch: 일괄 입력 중에도 마디 길이를 바꾼 뒤에는 묵은 캐시를 쓰지 않는다(박자 바꾸기는 스스로 캐시를 버린다)', () => {
  const s = fresh();
  C.inputAtEvent(s, 0, F(0), { n: 1, d: 4 }, [pitch(60)], { batch: true });
  const before = C.measureStarts(s);
  C.setMeasureTimeSig(s, 1, { num: 3, den: 4 });
  const after = C.measureStarts(s);
  assert.notEqual(after, before, '박자를 바꾸면 timing이 새로 계산된다');
  assert.equal(after[2].sub(after[1]).toString(), '3/4');
  C.inputAtEvent(s, 1, F(0), { n: 1, d: 4 }, [pitch(62)], { batch: true });
  assert.equal(C.measureStarts(s)[2].sub(C.measureStarts(s)[1]).toString(), '3/4', '일괄 입력 뒤에도 3/4 그대로');
});

test('가져오기 마무리: 일괄 입력 동안 미룬 타이 정리를 모든 음을 놓은 뒤 정확히 한 번 한다', () => {
  // 지금 입력들에서는 놓는 도중 떠도는 타이가 생기지 않아 이 정리가 결과를 바꾸지 않는다(방어용). 그래도 빼먹거나 순서가 바뀌면 안 되니 호출 자체를 지킨다.
  const realInput = C.inputAtEvent, realTies = C.normalizeTies;
  let placements = 0;
  const sweepsAt = [];
  C.inputAtEvent = (...args) => { placements++; return realInput(...args); };
  C.normalizeTies = (...args) => { sweepsAt.push(placements); return realTies(...args); };
  try {
    const r = IO.midiToScore(IO.parseMidi(seededMidi(7, 120)), { grid: 1 / 16 });
    assert.equal(placements, r.placed, '놓은 음마다 inputAtEvent를 한 번씩 불렀다');
    assert.ok(placements > 50, `충분히 놓았다(${placements})`);
    assert.deepEqual(sweepsAt, [placements], '타이 정리는 마지막 음을 놓은 직후 한 번만');
  } finally {
    C.inputAtEvent = realInput; C.normalizeTies = realTies;
  }
});
