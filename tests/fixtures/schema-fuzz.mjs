// P8-2 schema.validate 시험 도구 — 시드 난수 · 코어가 직접 만든 임의의 악보 · 손상 생성기 · "앱이 실제로 쓰는 길"로 통과시키기.
// tests/schema.test.mjs가 쓴다(이 파일은 시험이 아니라 도구라 *.test.mjs가 아니다).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SF } from '../shim.mjs';

const C = SF.core, E = SF.engrave, P = SF.playback, IO = SF.io;
const BASELINE_DIR = fileURLToPath(new URL('../baseline/', import.meta.url));
export const clone = value => JSON.parse(JSON.stringify(value));
export function mulberry32(seed) {
  let a = seed | 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const F = (n, d = 1) => new SF.Fraction(n, d);

/* ---------------- 코어가 만든 임의의 악보(정상이어야 하는 쪽) ---------------- */
const DURS = [{ n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 4 }, { n: 1, d: 8 }, { n: 1, d: 16 }, { n: 1, d: 4, dots: 1 }, { n: 1, d: 2, dots: 1 }, { n: 1, d: 8, dots: 1 }];
const SIGS = [{ num: 3, den: 4 }, { num: 6, den: 8 }, { num: 5, den: 8 }, { num: 4, den: 4 }, { num: 2, den: 2 }, { num: 7, den: 16 }];
/** 코어의 편집 함수(음 입력·잇단음표·박자 바꿈·못갖춘마디·마디 나누기/합치기/끼우기·드럼)를 무작위로 불러 만든 악보. 같은 시드는 같은 악보. */
export function randomScore(seed) {
  const rnd = mulberry32(seed), pick = list => list[Math.floor(rnd() * list.length)];
  const kind = pick([undefined, undefined, 'piano', 'guitar-tab', 'drumkit']);
  let score;
  try {
    score = kind === 'guitar-tab' || kind === 'drumkit'
      ? C.createScore({ measureCount: 4 + Math.floor(rnd() * 4), parts: [{ kind }] })
      : C.createScore({ measureCount: 4 + Math.floor(rnd() * 5), ensemble: kind });
  } catch { score = C.createScore({ measureCount: 6 }); }
  const pitch = () => ({ step: Math.floor(rnd() * 7), alter: pick([0, 0, 0, 1, -1]), oct: 3 + Math.floor(rnd() * 3) });
  const ops = 10 + Math.floor(rnd() * 25);
  for (let i = 0; i < ops; i++) {
    const count = score.parts[0].staves[0].measures.length, m = Math.floor(rnd() * count), op = Math.floor(rnd() * 14);
    try {
      const L = C.measureLenAt(score, m), tick = F(Math.floor(rnd() * L.n * 4 / L.d), 4), dur = { ...pick(DURS) };
      const voice = 1 + Math.floor(rnd() * 3), staffIdx = score.parts[0].staves.length > 1 ? Math.floor(rnd() * score.parts[0].staves.length) : 0;
      if (op <= 4) C.inputAt(score, m, tick, dur, [pitch()], { voice, staffIdx });
      else if (op === 5) C.inputAt(score, m, tick, dur, [pitch(), pitch()], { voice });
      else if (op === 6) C.inputAt(score, m, tick, dur, null, { voice });
      else if (op === 7) { const events = C.getVoiceEvents(score.parts[0].staves[0].measures[m], 1, score); C.makeTupletAt(score, m, Math.floor(rnd() * events.length), pick([3, 5, 6, 7]), { voice: 1 }); }
      else if (op === 8) C.setMeasureTimeSig(score, m, pick(SIGS));
      else if (op === 9) C.setPickup(score, pick([null, F(1, 4), F(3, 8)]));
      else if (op === 10) C.splitMeasureAt(score, m, F(Math.floor(rnd() * 3) + 1, pick([4, 8, 12, 6])));
      else if (op === 11 && m + 1 < count) C.joinMeasures(score, m);
      else if (op === 12) C.insertMeasures(score, m, 1);
      else if (op === 13 && kind === 'drumkit') C.addDrumNote(score, m, tick, pick(['kick', 'snare', 'closed-hihat']), dur);
    } catch { /* 코어가 거부한 편집은 건너뛴다 */ }
  }
  return score;
}

/* ---------------- 손상시킬 바탕 악보 ---------------- */
/** 마디를 앞 count개로 줄인다 — 퍼징이 빠르도록. */
export function truncate(data, count) {
  const copy = clone(data);
  for (const part of copy.parts) for (const staff of part.staves) staff.measures = staff.measures.slice(0, count);
  delete copy.measures;
  return copy;
}

/** 장식·가사·코드·코드 다이어그램·이음줄·옥타브·반복·엔딩·그레이스를 골고루 담은 악보 JSON(TAB 보표). */
export function kitchenSink() {
  const score = C.createScore({ measureCount: 4, parts: [{ kind: 'guitar-tab' }] });
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push(C.inputAt(score, Math.floor(i / 2), F((i % 2) * 2, 4), { n: 1, d: 2 }, [{ step: i % 7, alter: 0, oct: 4 }, ...(i % 3 === 0 ? [{ step: (i + 2) % 7, alter: 1, oct: 4 }] : [])]));
  const ev = id => C.findEvent(score, id).ev;
  Object.assign(ev(ids[0]), { chordSymbol: C.parseChordSymbol('Am7/G'), fretboard: C.getDefaultFretboard('Am7') || { strings: 6, frets: 4, positions: ['x', 0, 2, 0, 1, 0] }, dynamic: 'mf', artics: ['staccato', 'accent'], tempo: 96.5, rehearsal: 'A', staffText: 'dolce', soundFlag: 'pizzicato', color: '#cc0000', offsetX: 3, offsetY: -2, velocityOffset: 5 });
  Object.assign(ev(ids[1]), { lyrics: [{ verse: 1, text: '가', syllabic: 'begin', extend: false }, { verse: 2, text: '나', syllabic: 'single', extend: false }], lyric: '가', ornament: 'trill', trillLine: true, tremolo: { strokes: 2, type: 'single' }, glissando: { type: 'start', lineType: 'solid' }, arpeggiate: true, hidden: false, small: true, stemDirection: 'up', notehead: 'normal' });
  C.addGraceBefore(score, ids[2], { step: 3, alter: 0, oct: 5 }, 'acciaccatura');
  score.spanners.push({ id: C.newId(), type: 'slur', startId: ids[2], endId: ids[3] });
  try { C.addOttava(score, ids[4], ids[5], 12); } catch { /* 일부 환경에서는 거부 */ }
  try { C.toggleStartRepeat(score, 0); C.toggleEndRepeat(score, 1); C.setRepeatCount(score, 1, 3); C.setEnding(score, 2, 2, 2); C.setMeasureJump(score, 3, 'DC'); C.setMeasureMarker(score, 0, 'segno'); } catch { /* 위와 같다 */ }
  score.meta.title = '종합 시험'; score.meta.composer = '시험'; score.tempo = 110;
  return C.toJSON(score);
}
export function kitchenDrums() {
  const score = C.createScore({ measureCount: 3, parts: [{ kind: 'drumkit' }] });
  for (let m = 0; m < 3; m++) for (let i = 0; i < 4; i++) C.addDrumNote(score, m, F(i, 4), ['kick', 'snare', 'closed-hihat', 'open-hihat'][i], { n: 1, d: 4 });
  return C.toJSON(score);
}
/** [이름, 악보 JSON] 목록 — 기준 5곡·데모 4곡(v2·v1)·코어 임의 악보·종합 시험(8배 가중)·드럼(4배 가중). */
export function bases() {
  const list = [];
  for (const name of readdirSync(BASELINE_DIR).filter(n => n.endsWith('.scoreforge.json')).sort()) list.push([name, truncate(JSON.parse(readFileSync(BASELINE_DIR + name, 'utf8')), 6)]);
  for (const key of Object.keys(IO.DEMOS)) {
    list.push([`demo:${key}`, truncate(C.toJSON(IO.DEMOS[key]()), 6)]);
    list.push([`demo1:${key}`, truncate(C.toJSON(IO.DEMOS[key](), { format: 1 }), 6)]);
  }
  for (const seed of [3, 7, 11, 19, 23, 29, 31, 37, 41, 43, 47, 53]) list.push([`core${seed}`, truncate(C.toJSON(randomScore(seed)), 6)]);
  const sink = kitchenSink(), drums = kitchenDrums();
  for (let i = 0; i < 8; i++) list.push([`kitchen${i}`, sink]);
  for (let i = 0; i < 4; i++) list.push([`drums${i}`, drums]);
  return list;
}

/* ---------------- 손상 생성기 ---------------- */
const VALUES = ['x', '', ' ', '7', 7, -3, 0, 0.5, 1e308, [], [1, 2], ['a'], {}, { n: 1 }, null, true, false, 'e1', 'undefined', '__proto__', { __proto__: null }, [[]], [{}]];
const NUMS = [NaN, Infinity, -Infinity, -1, 0, 1, 1e308, 2 ** 53, 0.5, -0, 4097, 100000, 8, 65];
const HUGE_NODES = 300000;   // 거대 배열 손상이 만드는 값의 총 개수(공유 참조로 그래프가 폭발하지 않게 복제해서 넣는다)

const keysOf = node => (Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node));
function leaves(root, predicate) {
  const out = [], stack = [[root, null, null]];
  while (stack.length) {
    const [node, parent, key] = stack.pop();
    if (node !== null && typeof node === 'object') for (const k of keysOf(node)) stack.push([node[k], node, k]);
    else if (parent && predicate(node)) out.push([parent, key]);
  }
  return out;
}
function walk(root, rnd) {
  let node = root, parent = null, key = null;
  const trail = [], steps = 1 + Math.floor(rnd() * 14);
  for (let i = 0; i < steps; i++) {
    if (node === null || typeof node !== 'object') break;
    const keys = keysOf(node);
    if (!keys.length) break;
    key = keys[Math.floor(rnd() * keys.length)]; parent = node; node = node[key]; trail.push(key);
    if (rnd() < 0.12) break;
  }
  return { parent, key, node, path: trail.join('.') };
}
/** 키 이름을 고르게 뽑아(드문 필드도 같은 확률) 그 이름의 자리 하나를 돌려준다. */
function walkByKey(root, rnd) {
  const byName = new Map(), stack = [[root, '']];
  while (stack.length) {
    const [node, path] = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    for (const k of keysOf(node)) {
      if (!Array.isArray(node)) (byName.get(k) || byName.set(k, []).get(k)).push([node, k, `${path}.${k}`]);
      stack.push([node[k], `${path}.${k}`]);
    }
  }
  const names = [...byName.keys()];
  if (!names.length) return { parent: null };
  const spots = byName.get(names[Math.floor(rnd() * names.length)]);
  const [parent, key, path] = spots[Math.floor(rnd() * spots.length)];
  return { parent, key, node: parent[key], path };
}
function anySubtree(root, rnd) {
  const all = [], stack = [root];
  while (stack.length && all.length < 20000) { const n = stack.pop(); if (n !== null && typeof n === 'object') { all.push(n); for (const k of Object.keys(n)) stack.push(n[k]); } }
  return all.length ? all[Math.floor(rnd() * all.length)] : null;
}
function nodeCount(value) {
  let n = 0; const stack = [value];
  while (stack.length) { const v = stack.pop(); n++; if (v !== null && typeof v === 'object') for (const k of Object.keys(v)) stack.push(v[k]); }
  return n;
}
const nest = (levels, rnd) => { let v = rnd() < 0.5 ? [] : {}; for (let i = 0; i < levels; i++) v = rnd() < 0.5 ? [v] : { x: v }; return v; };
const plain = value => (typeof value === 'object' && value !== null ? clone(value) : value);

/** base를 1~3군데 망가뜨린 사본과 무엇을 했는지(notes). 종류: 옮겨 심기 · 같은 키 이름 망가뜨리기 · 필드 삭제 · 자료형 바꾸기 · 거대 배열 · NaN·음수 숫자 · 깊은 중첩. */
export function corrupt(base, rnd) {
  const data = clone(base), notes = [];
  const count = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const kind = Math.floor(rnd() * 7);
    const spot = () => (rnd() < 0.6 ? walkByKey(data, rnd) : walk(data, rnd));
    if (kind === 5) {                                  // 다른 곳의 조각을 옮겨 심기(모양은 그럴듯하지만 자리가 틀린다)
      const { parent, key } = spot(); if (!parent) continue;
      const piece = anySubtree(data, rnd); if (piece === null) continue;
      parent[key] = clone(piece); notes.push(`transplant ${key}`);
    } else if (kind === 6) {                           // 같은 키 이름 자리를 망가뜨리기
      const { parent, key, path } = walkByKey(data, rnd); if (!parent) continue;
      const value = VALUES[Math.floor(rnd() * VALUES.length)];
      parent[key] = plain(value); notes.push(`bykey ${path}=${JSON.stringify(value)}`);
    } else if (kind === 0) {                           // 필드 삭제
      const { parent, key } = spot(); if (!parent) continue;
      if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key];
      notes.push(`delete ${key}`);
    } else if (kind === 1) {                           // 자료형 바꾸기
      const { parent, key } = spot(); if (!parent) continue;
      const value = VALUES[Math.floor(rnd() * VALUES.length)];
      parent[key] = plain(value); notes.push(`retype ${key}=${JSON.stringify(value)}`);
    } else if (kind === 2) {                           // 거대 배열
      let target = null;
      for (let tries = 0; tries < 20 && !target; tries++) { const w = walk(data, rnd); if (Array.isArray(w.node)) target = w; }
      if (!target) continue;
      const proto = target.node.length ? target.node[Math.floor(rnd() * target.node.length)] : 1, size = nodeCount(proto);
      const n = Math.max(10, Math.min([1000, 20000, 100000, 250000][Math.floor(rnd() * 4)], Math.floor(HUGE_NODES / size)));
      for (let j = 0; j < n; j++) target.node.push(plain(proto));
      notes.push(`huge ${n}x${size}@${target.path}`);
    } else if (kind === 3) {                           // NaN·음수 같은 숫자
      const list = leaves(data, v => typeof v === 'number'); if (!list.length) continue;
      const [parent, key] = list[Math.floor(rnd() * list.length)], value = NUMS[Math.floor(rnd() * NUMS.length)];
      parent[key] = value; notes.push(`num ${key}=${value}`);
    } else {                                           // 깊은 중첩
      const { parent, key } = walk(data, rnd); if (!parent) continue;
      parent[key] = nest(20 + Math.floor(rnd() * 40), rnd); notes.push(`deep ${key}`);
    }
  }
  return { data, notes };
}

/** 받아들인 악보를 앱이 실제로 쓰는 길로 통과시킨다(core 읽기 → 그리기 → 재생 계획 → MIDI → MusicXML → 다시 저장). 하나라도 던지면 그 예외가 곧 허점이다. */
export function exercise(scoreJSON) {
  const model = C.fromJSON(scoreJSON);
  E.render(model, { fallback: true });
  P.compile(model);
  P.exportMidi(model);
  IO.exportMusicXML(model);
  C.toJSON(model);
  return model;
}
