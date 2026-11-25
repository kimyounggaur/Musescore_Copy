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
test('① 중앙줄까지 닿게 하는 규칙은 첫 덧줄 밖에서만 적용한다(경계 사례는 그대로)', () => {
  // 가장 가까운 머리가 첫 덧줄(중앙줄에서 3칸)에 있으면 "먼 묶음"이 아니다 → 빔 끝은 옮기지 않는다.
  const up = beamInfo(beamScore([-7, 0]));          // 위 기둥: 가장 위 머리가 첫 덧줄 아래 C4
  assert.equal(up.dir, 'up');
  assert.ok(Math.abs(up.near - (up.mid + 4)) < 0.01, `위 기둥 경계 묶음 빔 끝 ${up.near - up.mid} (그대로 +4)`);
  const down = beamInfo(beamScore([19, 12]));       // 아래 기둥: 가장 아래 머리가 첫 덧줄 위
  assert.equal(down.dir, 'down');
  assert.ok(Math.abs(down.near - (down.mid - 4)) < 0.01, `아래 기둥 경계 묶음 빔 끝 ${down.near - down.mid} (그대로 -4)`);
  // 한 칸 더 바깥으로 나가면 규칙이 적용되어 정확히 중앙줄에 닿는다.
  const upFar = beamInfo(beamScore([-7, -1]));
  assert.ok(Math.abs(upFar.near - upFar.mid) < 0.01, `위 기둥 먼 묶음 빔 끝 ${upFar.near - upFar.mid}`);
  const downFar = beamInfo(beamScore([19, 13]));
  assert.ok(Math.abs(downFar.near - downFar.mid) < 0.01, `아래 기둥 먼 묶음 빔 끝 ${downFar.near - downFar.mid}`);
});
test('① 먼 묶음의 빔 끝은 중앙줄에 정확히 닿는다(부족하면 딱 그만큼만 평행 이동)', () => {
  for (const steps of [[-7, -6, -7, -6], [-1, -2, -3], [-9, -8, -7, -6], [-8, -2]]) {
    const g = beamInfo(beamScore(steps));
    assert.equal(g.dir, 'up');
    assert.ok(Math.abs(g.near - g.mid) < 0.01, `${JSON.stringify(steps)}: 빔 끝 ${g.near - g.mid} (정확히 0이어야 한다)`);
  }
  for (const steps of [[13, 14, 15], [19, 18, 19, 18], [13, 14, 13, 14], [14, 20]]) {
    const g = beamInfo(beamScore(steps));
    assert.equal(g.dir, 'down');
    assert.ok(Math.abs(g.near - g.mid) < 0.01, `${JSON.stringify(steps)}: 빔 끝 ${g.near - g.mid} (정확히 0이어야 한다)`);
  }
});
test('① 이미 중앙줄을 넘어 올라온 먼 묶음은 줄이지 않는다(32분 묶음의 긴 기둥)', () => {
  const up = beamInfo(beamScore([-1, -1], 32));
  assert.equal(up.dir, 'up');
  assert.ok(Math.abs(up.near - (up.mid - 2)) < 0.01, `위 기둥 ${up.near - up.mid} (그대로 -2)`);
  const down = beamInfo(beamScore([13, 13], 32));
  assert.equal(down.dir, 'down');
  assert.ok(Math.abs(down.near - (down.mid + 2)) < 0.01, `아래 기둥 ${down.near - down.mid} (그대로 +2)`);
});
test('① 드럼·TAB 빔 묶음은 중앙줄 규칙을 받지 않는다(예전 좌표 그대로)', () => {
  // 드럼: 보표 한참 위/아래 줄에 놓인 8분음표 둘. 성부 규칙대로 기둥은 위, 빔 끝은 머리 위 3.3칸(=33px).
  const d = C.createScore({ measureCount: 1, parts: ['drumkit'] });
  const dref = C.staffRefs(d)[0];
  const drum = (id, line) => ({ id, type: 'note', notes: [], drumId: 'crash', midi: 49, staffLine: line, voice: 1, dur: { n: 1, d: 8, dots: 0 } });
  dref.measures[0].voices[0] = [drum('d0', -4), drum('d1', -4)];
  dref.measures[0].events = dref.measures[0].voices[0];
  C.invalidate(d, { keepNormalized: true });
  const rd = render(d);
  const polyD = rd.svg.match(/class="beam" points="([-.\d]+),([-.\d]+) ([-.\d]+),([-.\d]+)/);
  assert.ok(polyD, '드럼 빔이 그려져야 한다');
  const headD = [...rd.layout.eventsById.values()][0];
  const headYd = headD.noteheads?.[0]?.y;
  const stemD = rd.svg.match(/class="stem" x1="[-.\d]+" y1="([-.\d]+)" x2="[-.\d]+" y2="([-.\d]+)"/);
  assert.ok(stemD, '드럼 기둥');
  // 빔 끝은 기둥 끝과 같은 높이이고, 기둥은 위·아래 어느 쪽이든 (중앙줄이 아니라) 머리 기준 길이를 쓴다.
  assert.ok(Math.abs(+polyD[2] - +stemD[2]) < 0.01, `드럼 빔(${polyD[2]})과 기둥 끝(${stemD[2]})이 이어져야 한다`);
  const lenD = Math.abs(+stemD[2] - +stemD[1]);
  assert.ok(lenD >= 25 && lenD <= 34, `드럼 기둥 길이 ${lenD} 는 머리 기준 길이여야 한다`);
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

/* ============ ② 간격 ============ */
/** 같은 마디·같은 보표·같은 성부의 이벤트 x 좌표(왼쪽부터). */
const xsOf = (r, staff = 0, voice = 1, m = 0) => [...r.layout.eventsById.values()].filter(le => le.mIdx === m && le.globalIdx === staff && le.voice === voice).sort((a, b) => a.x - b.x).map(le => le.x);
const gapsOf = xs => xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(2));
const allEqual = (gaps, msg) => assert.ok(gaps.length > 0 && Math.max(...gaps) - Math.min(...gaps) < 0.011, `${msg}: ${JSON.stringify(gaps)}`);
const piano = measureCount => C.createScore({ measureCount, ensemble: 'piano' });
/** 뒤에 4분음표 하나가 오는 음 하나의 폭(= 두 머리 사이 거리). */
function noteGap(d, dots = 0) {
  const s = C.createScore({ measureCount: 1, timeSig: { num: 12, den: 4 } });
  const ev = note('a', [P(2)], d); ev.dur.dots = dots;
  put(s, 0, [ev, note('b', [P(2)], 4)]);
  const r = render(s);
  return r.layout.eventsById.get('b').x - r.layout.eventsById.get('a').x;
}

test('② 점음표는 더 긴 보통 음표보다 넓지 않다(점 0·1·2개, 16분~온음표)', () => {
  const rows = [];
  for (const d of [16, 8, 4, 2, 1]) for (const dots of [0, 1, 2]) rows.push({ d, dots, value: C.durValue({ n: 1, d, dots }).value, width: noteGap(d, dots) });
  rows.sort((a, b) => a.value - b.value);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].width >= rows[i - 1].width - 0.011,
    `${rows[i - 1].d}${'.'.repeat(rows[i - 1].dots)}(${rows[i - 1].width.toFixed(1)}) 보다 더 긴 ${rows[i].d}${'.'.repeat(rows[i].dots)}(${rows[i].width.toFixed(1)}) 가 더 좁다`);
});
test('② 점이 셋 이상이면 점 자리를 따로 보장한다(22 + 6×(점 수−1))', () => {
  for (const dots of [3, 4]) assert.ok(noteGap(16, dots) >= 22 + 6 * (dots - 1) - 0.01, `16분 점 ${dots}개 폭 ${noteGap(16, dots)}`);
  assert.ok(noteGap(16, 2) < 22 + 6 * 2 + 6, '점 둘까지는 보장 규칙이 아니라 길이 기준 폭');
});
test('② 점 자리 보장의 정확한 값: 점 셋 34, 점 넷 40, 점 둘까지는 기본 폭(32분·64분 26)', () => {
  const near = (got, want, msg) => assert.ok(Math.abs(got - want) < 0.01, `${msg}: ${got} ≠ ${want}`);
  near(noteGap(16, 3), 34, '16분 점 셋');
  near(noteGap(16, 4), 40, '16분 점 넷');
  near(noteGap(32, 3), 34, '32분 점 셋');
  near(noteGap(64, 4), 40, '64분 점 넷');
  for (const d of [32, 64]) for (const dots of [0, 1, 2]) near(noteGap(d, dots), 26, `${d}분 점 ${dots}개(보장 규칙이 아닌 기본 최소 폭)`);
  near(noteGap(16, 1), 27.39, '16분 점 하나');
  near(noteGap(16, 2), 29.82, '16분 점 둘');
});
test('② 한 성부·점 없는 악보의 폭은 그대로다(16분 26 · 8분 31.9 · 4분 42.8 · 2분 53.8)', () => {
  for (const [d, w] of [[16, 26], [8, 31.9], [4, 42.8], [2, 53.8]]) assert.ok(Math.abs(noteGap(d) - w) < 0.06, `${d}분 ${noteGap(d)}`);
});
test('② 오른손 4분음표 4개 + 왼손 온음표: 오른손 간격이 모두 같다', () => {
  const s = piano(1), refs = C.staffRefs(s);
  put(s, 0, [0, 2, 4, 2].map((a, i) => note('rh' + i, [P(a + 7)], 4)), 1, refs[0]);
  put(s, 0, [note('lh', [P(-7)], 1)], 1, refs[1]);
  const gaps = gapsOf(xsOf(render(s), 0));
  allEqual(gaps, '오른손 간격');
  assert.ok(Math.abs(gaps[0] - 42.8) < 0.06, `4분 간격 ${gaps[0]}`);
});
test('② 오른손 8분음표 8개 + 왼손 2분음표 2개: 오른손 간격이 모두 같다', () => {
  const s = piano(1), refs = C.staffRefs(s);
  put(s, 0, Array.from({ length: 8 }, (_, i) => note('e' + i, [P(7 + (i % 4))], 8)), 1, refs[0]);
  put(s, 0, [note('h1', [P(-7)], 2), note('h2', [P(-5)], 2)], 1, refs[1]);
  allEqual(gapsOf(xsOf(render(s), 0)), '오른손 8분 간격');
});
test('② 같은 보표 두 성부: 1성부 2분음표 때문에 2성부 8분음표 사이가 넓어지지 않는다', () => {
  const s = C.createScore({ measureCount: 1 }), ref = C.staffRefs(s)[0];
  put(s, 0, [note('v1a', [P(9)], 2), note('v1b', [P(9)], 2)], 1, ref);
  put(s, 0, Array.from({ length: 8 }, (_, i) => note('v2e' + i, [P(2 + (i % 3))], 8, { voice: 2 })), 2, ref);
  const gaps = gapsOf(xsOf(render(s), 0, 2));
  allEqual(gaps, '2성부 8분 간격');
  assert.ok(Math.abs(gaps[0] - (31.9 + 8)) < 0.06, `2성부 8분은 8분 간격 31.9에 성부 여백 8을 더한 값이어야 한다(${gaps[0]})`);
});
test('② 마지막 시각의 음은 다음 시각이 없으므로 자기 길이대로 폭을 갖는다', () => {
  const s = piano(1), refs = C.staffRefs(s);
  put(s, 0, [note('r0', [P(9)], 4), note('r1', [P(9)], 4), note('r2', [P(9)], 2)], 1, refs[0]);
  put(s, 0, [note('l0', [P(-7)], 2), note('l1', [P(-7)], 2)], 1, refs[1]);
  const r = render(s), measureRight = r.layout.systems[0].measures[0].x1;
  const w = [...r.layout.eventsById.values()].filter(le => le.globalIdx === 0).sort((a, b) => a.x - b.x);
  assert.ok(Math.abs((w[1].x - w[0].x) - 42.8) < 0.06 && Math.abs((w[2].x - w[1].x) - 42.8) < 0.06, '4분 간격');
  assert.ok(measureRight - w[2].x > 40, `마지막 2분음표 뒤 공간 ${measureRight - w[2].x}`);
});
test('② 오른손 4분음표 + 왼손 온마디 쉼표: 오른손 간격이 모두 같다', () => {
  const s = piano(1), refs = C.staffRefs(s);
  put(s, 0, [0, 2, 4, 2].map((a, i) => note('rh' + i, [P(a + 7)], 4)), 1, refs[0]);   // 왼손은 기본 온마디 쉼표
  allEqual(gapsOf(xsOf(render(s), 0)), '오른손 간격');
});
test('② 온마디 쉼표만 있는 마디의 폭은 그대로다(74)', () => {
  for (const s of [C.createScore({ measureCount: 3 }), piano(2)]) {
    const r = render(s);
    assert.deepEqual(r.layout.systems.flatMap(sy => sy.measures.map(m => +(m.x1 - m.x0).toFixed(2))), s.measures.map(() => 74));
  }
});
test('② 줄 맞춤으로 늘어난 줄에서도 간격이 마디 폭에 비례해 늘고, 마지막 줄은 그대로다', () => {
  const s = C.createScore({ measureCount: 10 });
  for (let m = 0; m < 10; m++) put(s, m, [0, 2, 4, 2].map((a, i) => note(`m${m}n${i}`, [P(a + 7)], 4)));
  const r = render(s);
  assert.equal(r.layout.systems.length, 3, '네 마디씩 두 줄 + 마지막 짧은 줄');
  const gapOfMeasure = m => gapsOf(xsOf(r, 0, 1, m));
  let m = 0;
  const perSystem = r.layout.systems.map(sy => {
    const widths = sy.measures.map(mm => mm.x1 - mm.x0);
    const gaps = sy.measures.map((_, i) => { const g = gapOfMeasure(m + i); allEqual(g, `마디 ${m + i + 1} 간격`); return g[0]; });
    m += sy.measures.length;
    return { widths, gaps };
  });
  const natural = 42.84;
  for (const i of [0, 1]) for (const g of perSystem[i].gaps) assert.ok(g > natural + 3, `줄 ${i + 1} 간격 ${g} 이(가) 줄 맞춤으로 늘어나지 않았다`);
  for (const g of perSystem[2].gaps) assert.ok(Math.abs(g - natural) < 0.06, `마지막 줄은 자연 간격 ${natural} 그대로(${g})`);
  // 더 넓게 늘어난 줄(마디 폭이 큰 줄)일수록 간격도 크다.
  assert.ok(perSystem[1].widths[0] > perSystem[0].widths[0] && perSystem[1].gaps[0] > perSystem[0].gaps[0], '마디가 더 넓은 줄의 간격이 더 넓어야 한다');
});
/** 16분 단위 길이 → 음표 길이 표기. */
const SIXTEENTHS = { 12: [2, 1], 8: [2, 0], 6: [4, 1], 4: [4, 0], 3: [8, 1], 2: [8, 0], 1: [16, 0] };
function randomBar(rand) {
  const out = []; let left = 16;
  while (left > 0) { const options = Object.keys(SIXTEENTHS).map(Number).filter(v => v <= left); const v = options[Math.floor(rand() * options.length)]; out.push(v); left -= v; }
  return out;
}
function barEvents(prefix, bar, rand, pitchBase) {
  return bar.map((v, i) => {
    const [d, dots] = SIXTEENTHS[v];
    const ev = rand() < 0.2 ? rest(prefix + i, d) : note(prefix + i, [P(pitchBase + Math.floor(rand() * 5))], d);
    ev.dur.dots = dots; return ev;
  });
}
test('② 무작위 두 단 리듬 100개: 같은 "다음 시각까지 거리"면 같은 간격, 더 멀면 좁지 않다', () => {
  const rand = rng(4242);
  for (let t = 0; t < 100; t++) {
    const s = piano(1), refs = C.staffRefs(s);
    const top = randomBar(rand), bottom = randomBar(rand);
    put(s, 0, barEvents('t', top, rand, 7), 1, refs[0]);
    put(s, 0, barEvents('u', bottom, rand, -7), 1, refs[1]);
    const r = render(s);
    const ticks = new Map();
    for (const le of r.layout.eventsById.values()) ticks.set(le.tick.toString(), { value: le.tick.value, x: le.x });
    const list = [...ticks.values()].sort((a, b) => a.value - b.value);
    const rows = list.slice(1).map((c, i) => ({ span: +(c.value - list[i].value).toFixed(6), gap: c.x - list[i].x }));
    for (const a of rows) for (const b of rows) {
      if (Math.abs(a.span - b.span) < 1e-9) assert.ok(Math.abs(a.gap - b.gap) < 0.02, `같은 거리 ${a.span} 인데 간격 ${a.gap.toFixed(2)} ≠ ${b.gap.toFixed(2)} (${top}/${bottom})`);
      else if (a.span < b.span) assert.ok(a.gap <= b.gap + 0.02, `거리 ${a.span} 의 간격 ${a.gap.toFixed(2)} > 거리 ${b.span} 의 간격 ${b.gap.toFixed(2)} (${top}/${bottom})`);
    }
  }
});
test('② 점 오른쪽 끝과 다음 음의 임시표 사이가 비어 있다(점 1·2개, 16·32분)', () => {
  for (const d of [16, 32]) for (const dots of [1, 2]) {
    const s = C.createScore({ measureCount: 1, timeSig: { num: 12, den: 4 } });
    const a = note('a', [P(2)], d); a.dur.dots = dots;
    put(s, 0, [a, note('b', [P(2, 1), P(4, 1), P(6, 1)], 4)]);
    const r = render(s);
    const dotsRight = Math.max(...[...r.svg.matchAll(/class="dot" cx="([-.\d]+)"/g)].map(m => +m[1])) + 2.1;
    const accLeft = Math.min(...[...r.svg.matchAll(/<g class="accidental" transform="translate\(([-.\d]+),/g)].map(m => +m[1]));
    assert.ok(accLeft - dotsRight >= 1, `${d}분 점${dots}: 점 끝 ${dotsRight} ~ 임시표 ${accLeft}`);
  }
});

/* ============ ③ 2도 화음·임시표 ============ */
// 임시표 글자가 음 위치를 중심으로 위·아래로 차지하는 높이(px). 샤프·제자리표 ±14, 플랫 위 17.5·아래 7, 폭 11 안팎.
const ACC_BOX = { sharp: { w: 11, up: 14, down: 14 }, natural: { w: 8.5, up: 14, down: 14 }, flat: { w: 9, up: 17.5, down: 7 } };
/** [[온음계 번호, 변화표]...] 화음 하나를 그리고 임시표·머리·점 좌표를 돌려준다. */
function chordGeometry(arr, { dots = 0, d = 4 } = {}) {
  const s = C.createScore({ measureCount: 1 });
  const ev = note('c', arr.map(([a, al]) => P(a, al)), d); ev.dur.dots = dots;
  put(s, 0, [ev]);
  const r = render(s);
  const le = r.layout.eventsById.get('c');
  const accNotes = ev.notes.filter(n => n.__acc).sort((a, b) => C.absStep(b) - C.absStep(a)); // 높은 음부터(SVG 순서)
  const accs = [...r.svg.matchAll(/<g class="accidental" transform="translate\(([-.\d]+),([-.\d]+)\)/g)].map((m, i) => {
    const box = ACC_BOX[accNotes[i].__acc];
    return { name: accNotes[i].__acc, step: C.absStep(accNotes[i]), x: +m[1], y: +m[2], x0: +m[1], x1: +m[1] + box.w, y0: +m[2] - box.up, y1: +m[2] + box.down };
  });
  const heads = le.noteheads.map(h => ({ x: h.x, y: h.y, x0: h.x - 6, x1: h.x + 6, y0: h.y - 5, y1: h.y + 5 }));
  const dotList = [...r.svg.matchAll(/class="dot" cx="([-.\d]+)" cy="([-.\d]+)"/g)].map(m => ({ x: +m[1], y: +m[2] }));
  return { r, le, accs, heads, dots: dotList, staff: le.staff, dir: le.stemDir };
}
const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;

test('③ 플랫이 샤프 아래 6스텝이면 다른 열, 샤프끼리 6스텝이면 같은 열', () => {
  const flatBelow = chordGeometry([[8, 1], [2, -1]]);
  assert.notEqual(flatBelow.accs[0].x, flatBelow.accs[1].x, '샤프(위) 6스텝 아래 플랫: 플랫 윗부분이 샤프 아래와 겹치므로 다른 열');
  const sharps = chordGeometry([[8, 1], [2, 1]]);
  assert.equal(sharps.accs[0].x, sharps.accs[1].x, '샤프끼리 6스텝은 같은 열');
});
test('③ 샤프가 플랫 아래 6스텝, 플랫이 샤프 위 5스텝이면 위아래가 겹치지 않아 같은 열에 둔다', () => {
  const flatAbove = chordGeometry([[7, -1], [2, 1]]);            // 플랫 위, 샤프 5스텝 아래
  assert.equal(flatAbove.accs[0].x, flatAbove.accs[1].x);
  const sharpAbove = chordGeometry([[8, 1], [1, -1]]);           // 샤프 위, 플랫 7스텝 아래
  assert.equal(sharpAbove.accs[0].x, sharpAbove.accs[1].x);
});
test('③ 표준 쌓기: 가장 높은 음 → 가장 낮은 음 → 가운데 순서로 가까운 열에 둔다(2도 샤프 3개)', () => {
  const g = chordGeometry([[4, 1], [3, 1], [2, 1]]);             // 높음·가운데·낮음
  const [hi, mid, lo] = g.accs;
  assert.equal(hi.x - lo.x, 11, '가장 낮은 음은 둘째 열');
  assert.equal(hi.x - mid.x, 22, '가운데 음은 셋째 열');
});
test('③ 3도 간격 샤프 4개는 3열(위·아래 음이 같은 열)', () => {
  const g = chordGeometry([[8, 1], [6, 1], [4, 1], [2, 1]]);
  assert.equal(new Set(g.accs.map(a => a.x)).size, 3);
  assert.equal(g.accs[0].x, g.accs[3].x, '가장 높은 음과 가장 낮은 음은 첫 열을 나눠 쓴다');
});
test('③ 무작위 화음 600개: 임시표끼리·임시표와 머리가 겹치지 않는다', () => {
  const rand = rng(12345);
  let withAcc = 0;
  for (let t = 0; t < 600; t++) {
    const count = 2 + Math.floor(rand() * 4);
    const set = new Set(); while (set.size < count) set.add(Math.floor(rand() * 12));
    const arr = [...set].map(a => [a, [1, -1, 0, 1, -1][Math.floor(rand() * 5)]]);
    const g = chordGeometry(arr);
    if (g.accs.length > 1) withAcc++;
    for (let i = 0; i < g.accs.length; i++) {
      for (let j = i + 1; j < g.accs.length; j++) assert.ok(!overlap(g.accs[i], g.accs[j]), `임시표끼리 겹침 ${JSON.stringify(arr)}`);
      for (const h of g.heads) assert.ok(!overlap(g.accs[i], h), `임시표와 머리 겹침 ${JSON.stringify(arr)}`);
    }
    const columns = new Set(g.accs.map(a => a.x)).size;
    assert.ok(columns <= g.accs.length, `열 ${columns} > 임시표 ${g.accs.length}`);
  }
  assert.ok(withAcc > 300, `임시표가 둘 이상인 화음이 충분해야 한다(${withAcc})`);
});
test('③ 2도 화음의 점: 어긋난 머리 오른쪽에 모이고 서로 겹치지 않는다(위·아래 기둥)', () => {
  for (const base of [2, 12]) {                                   // 보표 아래쪽(기둥 위)·위쪽(기둥 아래)
    for (const arr of [[[base, 0], [base + 1, 0]], [[base, 0], [base + 1, 0], [base + 2, 0]], [[base, 0], [base + 1, 0], [base + 3, 0], [base + 4, 0]]]) {
      const g = chordGeometry(arr, { dots: 1 });
      const rightEdge = Math.max(...g.heads.map(h => h.x1));
      for (const dot of g.dots) assert.ok(dot.x - 2.1 >= rightEdge, `점 ${dot.x} 이(가) 머리 오른쪽 끝 ${rightEdge} 안쪽 ${JSON.stringify(arr)}`);
      assert.equal(new Set(g.dots.map(d => `${d.x}/${d.y}`)).size, g.dots.length, `점이 같은 자리에 겹침 ${JSON.stringify(arr)}`);
      for (const dot of g.dots) assert.equal(((dot.y - g.staff.yTop) % SP + SP) % SP, SP / 2, `점이 칸(줄 사이) 안에 있어야 한다 ${dot.y}`);
      assert.equal(g.dots.length, arr.length);
    }
  }
});
/** 앞 화음의 샤프를 걷어 내는 제자리표 두 개의 열(x) — 같은 마디에서 [a, b] 음을 샤프로 낸 뒤 제자리로 낸다. */
function naturalColumns(a, b) {
  const s = C.createScore({ measureCount: 1 });
  put(s, 0, [note('s', [P(a, 1), P(b, 1)], 4), note('n', [P(a), P(b)], 4)]);
  const r = render(s);
  const xs = [...r.svg.matchAll(/<g class="accidental" transform="translate\(([-.\d]+),([-.\d]+)\)/g)].map(m => +m[1]);
  assert.equal(xs.length, 4, '샤프 둘 + 제자리표 둘');
  return xs.slice(-2);
}
test('③ 제자리표 높이: 5스텝 떨어진 둘은 다른 열, 6스텝 떨어진 둘은 같은 열', () => {
  for (const base of [1, 2, 3]) {
    const near = naturalColumns(base, base + 5);
    assert.notEqual(near[0], near[1], `제자리표 5스텝 간격(${base}, ${base + 5})은 글자가 겹치므로 다른 열`);
    const far = naturalColumns(base, base + 6);
    assert.equal(far[0], far[1], `제자리표 6스텝 간격(${base}, ${base + 6})은 같은 열`);
  }
});
test('③ 2도 화음의 점은 위 음부터 차례로 칸을 잡아 자기 머리에서 멀리 밀려나지 않는다', () => {
  for (const base of [2, 3, 12, 13]) {
    for (const arr of [[[base, 0], [base + 1, 0]], [[base, 0], [base + 1, 0], [base + 2, 0]], [[base, 0], [base + 1, 0], [base + 3, 0], [base + 4, 0]]]) {
      const g = chordGeometry(arr, { dots: 1 });
      const headYs = g.heads.map(h => h.y).sort((a, b) => a - b), dotYs = g.dots.map(d => d.y).sort((a, b) => a - b);
      assert.equal(dotYs.length, headYs.length);
      // 서로 맞닿은 머리가 셋이면 점 하나가 한 칸 밀려나는 것까지는 불가피하다(칸마다 점 하나). 둘이면 반 칸 안.
      const limit = arr.length === 2 ? SP / 2 : SP;
      dotYs.forEach((y, i) => assert.ok(Math.abs(y - headYs[i]) <= limit + 0.01, `${JSON.stringify(arr)}: ${i + 1}째 점 ${y} 이(가) 자기 머리 ${headYs[i]} 에서 ${limit} 보다 멀다`));
    }
  }
});
test('③ 2도가 없는 화음·낱음표와 점 2개의 위치는 그대로다', () => {
  const single = chordGeometry([[2, 0]], { dots: 2 });
  assert.deepEqual(single.dots.map(d => d.x), [single.le.x + 9.5, single.le.x + 15.5]);
  const third = chordGeometry([[2, 0], [4, 0]], { dots: 1 });
  assert.deepEqual(third.dots.map(d => d.x), [third.le.x + 9.5, third.le.x + 9.5]);
});

/* ============ ④ 파트 이름과 묶음 괄호 ============ */
function nameGeometry(score, opts = {}) {
  const r = render(score, opts);
  const names = [...r.svg.matchAll(/<text class="part-name" x="([-.\d]+)" y="([-.\d]+)" text-anchor="end">([^<]*)<\/text>/g)].map(m => ({ x: +m[1], y: +m[2], text: m[3] }));
  const braces = [...r.svg.matchAll(/<path class="brace" d="M ([-.\d]+) ([-.\d]+) C ([-.\d]+) ([-.\d]+)/g)].map(m => ({ left: +m[3], y: +m[2] }));
  return { r, names, braces, systems: r.layout.systems, margin: r.layout.metrics.marginLeft };
}
const cjkWidth = text => Array.from(text).reduce((w, ch) => w + (ch === ' ' ? 4 : 13), 0); // 한글 13px, 공백 4px

test('④ 피아노(묶음 괄호 있음): 이름 오른쪽 끝이 괄호 왼쪽 끝보다 4 이상 왼쪽이다', () => {
  const g = nameGeometry(C.createScore({ measureCount: 4, ensemble: 'piano' }));
  assert.equal(g.names.length, 1);
  assert.equal(g.braces.length, 1);
  assert.ok(g.names[0].x <= g.braces[0].left - 4 + 0.01, `이름 끝 ${g.names[0].x} > 괄호 왼쪽 ${g.braces[0].left} − 4`);
});
test('④ 괄호 없는 파트의 이름 위치는 그대로다(현악 4중주: x0−12)', () => {
  const g = nameGeometry(C.createScore({ measureCount: 4, ensemble: 'string-quartet' }));
  assert.equal(g.braces.length, 0);
  assert.equal(g.names.length, 4);
  for (const n of g.names) assert.equal(n.x, g.systems[0].x0 - 12);
});
test('④ 플루트 + 피아노: 플루트 이름은 그대로, 피아노 이름만 괄호 왼쪽으로 비킨다', () => {
  const g = nameGeometry(C.createScore({ measureCount: 4, ensemble: 'flute-piano' }));
  const [flute, pno] = g.names, x0 = g.systems[0].x0;
  assert.equal(flute.x, x0 - 12);
  assert.ok(pno.x <= g.braces[0].left - 4 + 0.01);
  assert.ok(pno.x < flute.x);
});
test('④ 이어지는 줄(짧은 이름)에도 같은 규칙이 적용된다', () => {
  const s = C.createScore({ measureCount: 24, ensemble: 'piano' });
  const g = nameGeometry(s);
  assert.ok(g.systems.length >= 2, '줄이 둘 이상이어야 한다');
  const later = [...g.r.svg.matchAll(/<text class="part-name" x="([-.\d]+)"[^>]*>([^<]*)<\/text>/g)].map(m => ({ x: +m[1], text: m[2] }));
  assert.equal(later.length, g.systems.length);
  const braceLefts = [...g.r.svg.matchAll(/<path class="brace" d="M [-.\d]+ [-.\d]+ C ([-.\d]+)/g)].map(m => +m[1]);
  later.forEach((n, i) => assert.ok(n.x <= braceLefts[i] - 4 + 0.01, `${i + 1}째 줄 이름 끝 ${n.x} > 괄호 ${braceLefts[i]}`));
  assert.ok(later.some(n => n.text === 'Pno.'), '둘째 줄부터는 짧은 이름');
  // 이어지는 줄의 이름 칸: 짧은 이름 "Pno."(추정 27) + 괄호 쪽 여백 33 + 왼쪽 여백 4 = 64
  assert.equal(g.systems[1].nameW, 64);
  assert.equal(g.systems[1].x0, g.margin + 64);
});
test('④ 이름이 길면 이름 칸이 늘어나 이름이 쪽 왼쪽 여백 밖으로 나가지 않는다', () => {
  for (const [ens, longName] of [['piano', '아주 긴 건반 악기 이름'], ['string-quartet', '아주 긴 현악기 이름입니다']]) {
    const s = C.createScore({ measureCount: 4, ensemble: ens });
    s.parts[0].name = longName;
    if (C.invalidate) C.invalidate(s);
    const g = nameGeometry(s);
    const n = g.names.find(item => item.text === longName);
    assert.ok(n, `긴 이름이 그려져야 한다(${ens})`);
    assert.ok(n.x - cjkWidth(longName) >= g.margin + 3.99, `${ens}: 이름 왼쪽 끝 ${n.x - cjkWidth(longName)} < 쪽 여백 ${g.margin}`);
    assert.equal(g.systems[0].x0, g.margin + g.systems[0].nameW);
    assert.ok(g.systems[0].nameW > 96, `${ens}: 이름 칸이 늘어나야 한다(${g.systems[0].nameW})`);
    // 이름 칸 = 오른쪽 여백(괄호 있으면 33, 없으면 12) + 이름 폭 + 왼쪽 여백 4
    const right = ens === 'piano' ? 33 : 12;
    assert.equal(g.systems[0].nameW, Math.ceil(right + cjkWidth(longName) + 4), `${ens}: 이름 칸 폭`);
  }
});
test('④ 이어지는 줄의 이름 칸은 짧은 이름이어도 54 아래로 줄지 않는다(첫 줄은 96)', () => {
  const s = C.createScore({ measureCount: 24, ensemble: 'string-quartet' });
  s.parts.forEach((p, i) => { p.name = String.fromCharCode(65 + i); p.shortName = String.fromCharCode(97 + i); });
  if (C.invalidate) C.invalidate(s);
  const g = nameGeometry(s);
  assert.ok(g.systems.length >= 2, '줄이 둘 이상이어야 한다');
  assert.equal(g.systems[0].nameW, 96);
  for (const sy of g.systems.slice(1)) {
    assert.equal(sy.nameW, 54, '이어지는 줄 이름 칸');
    assert.equal(sy.x0, g.margin + 54);
  }
});
test('④ 기본 이름은 첫 줄 이름 칸 폭(96)을 그대로 쓰고, 한 보표 악보는 이름 칸이 0이다', () => {
  for (const ens of ['piano', 'flute-piano', 'string-quartet']) assert.equal(nameGeometry(C.createScore({ measureCount: 4, ensemble: ens })).systems[0].nameW, 96, ens);
  const single = nameGeometry(C.createScore({ measureCount: 4 }));
  assert.equal(single.names.length, 0);
  assert.equal(single.systems[0].nameW, 0);
});
