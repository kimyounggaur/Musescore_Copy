// P9-2 조판 세부 4건(백로그 #16)의 좌표 시험.
// 항목마다 재현 악보를 코드로 만들고 SVG·배치 좌표를 단언한다.
//  ① 빔 묶음: 최소 기둥 길이, 기울기 제한, 덧줄 쪽 묶음이 중앙줄까지 닿기
//  ② 간격: 점음표가 더 긴 음표보다 넓지 않기, 다른 단·성부의 긴 음 때문에 짧은 음 사이가 넓어지지 않기
//  ③ 2도 화음: 임시표 열 쌓기(종류별 높이), 어긋난 머리와 점이 겹치지 않기
//  ④ 파트 이름: 묶음 괄호와 겹치지 않기, 이름이 길면 이름 칸이 늘어나기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ console, setTimeout, clearTimeout });
context.window = context;
context.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const name of ['safe-html', 'core', 'engrave']) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context, { filename: `${name}.js` });
const { core: C, engrave: E } = context.SF;

const SP = 10;
/** C4를 0으로 한 온음계 번호 → 음높이(C4=0, D4=1 … 한 옥타브는 7). */
const P = (a, alter = 0) => ({ step: ((a % 7) + 7) % 7, alter, oct: 4 + Math.floor(a / 7) });
const note = (id, notes, d = 4, extra = {}) => ({ id, type: 'note', notes, dur: { n: 1, d, dots: 0 }, voice: 1, ...extra });
const rest = (id, d = 4, extra = {}) => ({ id, type: 'rest', dur: { n: 1, d, dots: 0 }, voice: 1, ...extra });
function put(score, m, events, voice = 1, ref = C.staffRefs(score)[0]) {
  ref.measures[m].voices[voice - 1] = events;
  if (voice === 1) ref.measures[m].events = events;
  if (C.invalidate) C.invalidate(score, { keepNormalized: true });
}
const render = (s, opts = {}) => E.render(s, { fallback: true, ...opts });
/** 무작위 시험이 매번 같도록 쓰는 간단한 난수(선형 합동). */
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

/* ============ ① 빔 묶음 ============ */
/** 한 마디에 같은 길이의 음들을 놓아 빔으로 묶이게 한다. steps 원소가 배열이면 화음. */
function beamScore(steps, d = 8) {
  const s = C.createScore({ measureCount: 1 });
  put(s, 0, steps.map((st, i) => note('b' + i, (Array.isArray(st) ? st : [st]).map(a => P(a)), d)));
  return s;
}
/** 빔 묶음 하나의 좌표: 기둥 끝(tip)과 시작, 주 빔 바깥 가장자리, 중앙줄, 기둥 방향. */
function beamInfo(s) {
  const r = render(s);
  assert.match(r.svg, /class="beam-group"/, '빔으로 묶여야 한다');
  const stems = [...r.svg.matchAll(/class="stem" x1="([-.\d]+)" y1="([-.\d]+)" x2="[-.\d]+" y2="([-.\d]+)"/g)].map(m => ({ x: +m[1], from: +m[2], tip: +m[3], len: Math.abs(+m[3] - +m[2]) }));
  const poly = r.svg.match(/class="beam" points="([-.\d]+),([-.\d]+) ([-.\d]+),([-.\d]+)/);
  const first = [...r.layout.eventsById.values()][0];
  const heads = [...r.layout.eventsById.values()].flatMap(le => le.noteheads.map(h => h.y));
  const dir = first.stemDir;
  const edge = [+poly[2], +poly[4]];
  return { r, stems, mid: first.staff.middleY, dir, heads, slope: Math.abs(edge[1] - edge[0]), near: dir === 'up' ? Math.min(...edge) : Math.max(...edge) };
}
const minStem = d => 2.6 * SP + Math.max(0, Math.log2(d) - 3 - 1) * 4 - 1; // 시작점이 머리에서 1px 떨어져 있다

test('① 덧줄 아래 8분 빔 묶음(위 기둥)은 빔이 중앙줄까지 올라온다', () => {
  for (const steps of [[-7, -6, -7, -6], [-5, -4, -3, -2], [-8, -2], [-1, 0, -1, 0]]) {
    const g = beamInfo(beamScore(steps));
    assert.equal(g.dir, 'up', JSON.stringify(steps));
    assert.ok(g.near <= g.mid + 0.01, `${JSON.stringify(steps)}: 빔 끝 ${g.near} 이(가) 중앙줄 ${g.mid} 보다 아래`);
  }
});
test('① 덧줄 위 묶음(아래 기둥)은 빔이 중앙줄까지 내려온다', () => {
  for (const steps of [[13, 14, 13, 14], [15, 16, 15, 16], [12, 18], [11, 13, 12, 13]]) {
    const g = beamInfo(beamScore(steps));
    assert.equal(g.dir, 'down', JSON.stringify(steps));
    assert.ok(g.near >= g.mid - 0.01, `${JSON.stringify(steps)}: 빔 끝 ${g.near} 이(가) 중앙줄 ${g.mid} 보다 위`);
  }
});
test('① 16분·32분 묶음과 2음 화음 묶음도 중앙줄에 닿고 기울기는 1칸을 넘지 않는다', () => {
  for (const [steps, d] of [[[-7, -6, -7, -6], 16], [[-7, -6, -7, -6, -5, -6, -7, -6], 32], [[[-7, -5], [-6, -4], [-7, -5]], 8], [[[15, 17], [16, 18]], 16]]) {
    const g = beamInfo(beamScore(steps, d));
    if (g.dir === 'up') assert.ok(g.near <= g.mid + 0.01, `${d}분 ${JSON.stringify(steps)} 위 기둥 빔 끝 ${g.near} > 중앙 ${g.mid}`);
    else assert.ok(g.near >= g.mid - 0.01, `${d}분 ${JSON.stringify(steps)} 아래 기둥 빔 끝 ${g.near} < 중앙 ${g.mid}`);
    assert.ok(g.slope <= SP + 0.01, `기울기 ${g.slope}`);
    for (const st of g.stems) assert.ok(st.len >= minStem(d) - 0.01, `${d}분 기둥 길이 ${st.len} < ${minStem(d)}`);
  }
});
test('① 보표 안 묶음의 기둥 길이는 그대로다(오름 음계 4개)', () => {
  const g = beamInfo(beamScore([0, 1, 2, 3]));
  assert.deepEqual(g.stems.map(s => +s.len.toFixed(1)), [32, 30.3, 28.7, 27]);
});
test('① 중앙줄로 옮겨도 기울기는 그대로이고 기둥은 줄어들지 않는다', () => {
  const near = beamInfo(beamScore([-2, -1, 0, 1]));            // 보표 가까이(옮길 필요 없음)
  const far = beamInfo(beamScore([-9, -8, -7, -6]));           // 같은 모양, 훨씬 아래
  assert.ok(Math.abs(near.slope - far.slope) < 0.01, `기울기 ${near.slope} → ${far.slope}`);
  assert.ok(far.stems.every(s => s.len >= near.stems.at(-1).len - 0.01));
});
test('① 무작위 빔 묶음 200개: 기둥 ≥ 최소 길이, 기울기 ≤ 1칸, 먼 묶음은 중앙줄 도달', () => {
  const rand = rng(777);
  let far = 0;
  for (let t = 0; t < 200; t++) {
    const d = [8, 16, 32][Math.floor(rand() * 3)];
    const count = 2 + Math.floor(rand() * 3);
    const lo = [-8, 0, 6, 12][Math.floor(rand() * 4)];
    const span = [3, 8, 14][Math.floor(rand() * 3)];
    const steps = Array.from({ length: count }, () => lo + Math.floor(rand() * span));
    const g = beamInfo(beamScore(steps, d));
    assert.ok(g.slope <= SP + 0.01, `기울기 ${g.slope} ${JSON.stringify(steps)}`);
    for (const st of g.stems) assert.ok(st.len >= minStem(d) - 0.01, `${d}분 ${JSON.stringify(steps)} 기둥 ${st.len}`);
    const nearHead = g.dir === 'up' ? Math.min(...g.heads) : Math.max(...g.heads);
    const isFar = g.dir === 'up' ? nearHead > g.mid + 3 * SP : nearHead < g.mid - 3 * SP;
    if (isFar) {
      far++;
      if (g.dir === 'up') assert.ok(g.near <= g.mid + 0.01, `위 기둥 ${JSON.stringify(steps)}: ${g.near} > ${g.mid}`);
      else assert.ok(g.near >= g.mid - 0.01, `아래 기둥 ${JSON.stringify(steps)}: ${g.near} < ${g.mid}`);
    }
  }
  assert.ok(far >= 30, `먼 묶음이 충분히 나와야 시험이 의미 있다(${far})`);
});
