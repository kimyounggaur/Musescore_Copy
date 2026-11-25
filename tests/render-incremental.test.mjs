// P9-8: 증분 조판 — 바뀐 시스템(줄)만 다시 그린 결과가 "캐시 없이 처음부터 그린 결과"와 글자까지 같아야 한다.
//  - 동일성: 고정 시드 편집 50개(입력·쉼표·붙임줄·임시표·조표·박자·마디 추가/삭제·셈여림·가사·제목·선택 바꾸기)를 차례로 적용하며
//    매번 render(score, {cache:true}).svg === 깊은 복제본을 캐시 없이 그린 svg 인지 본다.
//  - 실제로 증분이 일어났는지(재사용한 시스템 수 > 0)도 함께 단언한다 — 항상 전체로 돌아가면 동일성은 공짜로 통과하기 때문이다.
//  - 증분이 허용되는 것은 mutate(…, {local:true})로 표시한 입력 편집뿐이다. 그 밖의 편집·되돌리기·스타일 변경은 전체 렌더로 돌아간다.
//  - dirty 기록(core.dirtySince)의 계약: 모르면 null, 현재 rev면 빈 집합, 입력한 마디가 들어 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  context.window = context;
  context.document = { getElementById: () => null, querySelectorAll: () => [] };
  for (const name of ['safe-html', 'core', 'engrave']) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context, { filename: `${name}.js` });
  // 조판기는 `instanceof Set`으로 선택 집합을 알아본다 — vm 영역이 다르면 시험 쪽 Set은 알아보지 못하므로 같은 영역에서 만든다.
  context.SF.__set = vm.runInContext('(list) => new Set(list)', context);
  return context.SF;
}

function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const EIGHTH = { n: 1, d: 8, dots: 0 };
const clone = score => JSON.parse(JSON.stringify(score));
const revOf = score => score.__cache?.rev;

// sharpFirst: 마디의 첫 음마다 올림표를 붙인다(임시표 자리가 있어서, 거기에 쉼표가 들어와도 마디 폭이 달라지지 않는다)
function freshScore(SF, measureCount = 16, { sharpFirst = false } = {}) {
  const { core: C } = SF;
  C.setScore(C.createScore({ ensemble: 'piano', measureCount }));
  C.mutate('fill', score => {
    for (const ref of C.staffRefs(score)) for (let m = 0; m < measureCount; m++) for (let i = 0; i < 8; i++)
      C.inputAt(score, m, SF.F(i, 8), EIGHTH, [{ step: (i + m) % 7, alter: sharpFirst && i === 0 ? 1 : 0, oct: ref.staffIdx ? 3 : 4 }], { partIdx: ref.partIdx, staffIdx: ref.staffIdx, voice: 1 });
  });
  return C.state.score;
}
const fullSvg = (SF, score, opts = {}) => SF.engrave.render(clone(score), { fallback: true, ...opts, cache: false, preserveLayout: true }).svg;

const RENDER = { cache: true, fallback: true };
// 그리면서 레이아웃 이벤트에 남는 값(음표머리 상자·실제 기둥 방향)도 같아야 한다 — 클릭·커서·고스트·타이가 이것을 읽는다.
function assertSameLayoutEffects(inc, full, label) {
  assert.equal(inc.layout.eventsById.size, full.layout.eventsById.size, `${label} 이벤트 수`);
  for (const [id, le] of full.layout.eventsById) {
    const mine = inc.layout.eventsById.get(id);
    assert.ok(mine, `${label} ${id} 이벤트`);
    assert.equal(mine.stemDir, le.stemDir, `${label} ${id} stemDir`);
    assert.deepEqual(JSON.parse(JSON.stringify(mine.noteheads)), JSON.parse(JSON.stringify(le.noteheads)), `${label} ${id} noteheads`);
  }
}
function pair(SF, score, opts) {
  const { engrave: E } = SF;
  const inc = E.render(score, { ...RENDER, ...opts });
  const full = E.render(clone(score), { fallback: true, ...opts, cache: false, preserveLayout: true });
  return { inc, full };
}

// 한 스텝 = { kind, local, apply(score) }. local은 doInput과 같은 성격(replaceRange만 쓰는 입력)
function makeSteps(SF, rnd) {
  const { core: C } = SF;
  const pick = n => Math.floor(rnd() * n);
  const input = (rest = false, chord = false, dur = EIGHTH) => ({
    kind: rest ? 'rest' : chord ? 'chord' : 'note', local: true,
    apply(score) {
      const staffIdx = pick(2), m = pick(C.staffRefs(score)[0].measures.length);
      const tick = SF.F(pick(8), 8);
      const one = () => ({ step: pick(7), alter: pick(3) - 1, oct: staffIdx ? 3 : 4 });
      const pitches = rest ? null : chord ? [one(), { ...one(), step: pick(7) }, one()] : [one()];
      C.setActiveStaff(score, 0, staffIdx);
      C.inputAt(score, m, tick, dur, pitches, { partIdx: 0, staffIdx, voice: 1 });
    },
  });
  // 마디 끝에서 다음 마디로 넘어가는 긴 음(붙임줄로 갈라진다) — 이웃 마디까지 영향
  const crossing = () => ({
    kind: 'cross-barline', local: true,
    apply(score) {
      const staffIdx = pick(2), m = pick(C.staffRefs(score)[0].measures.length - 1);
      C.inputAt(score, m, SF.F(6, 8), { n: 1, d: 2, dots: 0 }, [{ step: pick(7), alter: 0, oct: staffIdx ? 3 : 4 }], { partIdx: 0, staffIdx, voice: 1 });
    },
  });
  // 같은 높이로 이웃 마디의 끝·처음을 맞춰 붙임줄 판정이 뒤집히게 한다
  const tiePair = () => ({
    kind: 'tie-pair', local: true,
    apply(score) {
      const staffIdx = 0, m = pick(C.staffRefs(score)[0].measures.length - 1), p = { step: pick(7), alter: pick(2), oct: 4 };
      C.inputAt(score, m, SF.F(7, 8), EIGHTH, [{ ...p }], { partIdx: 0, staffIdx, voice: 1 });
      C.inputAt(score, m + 1, SF.F(0, 8), EIGHTH, [{ ...p }], { partIdx: 0, staffIdx, voice: 1 });
      const ev = C.staffRefs(score)[0].measures[m].voices[0].slice(-1)[0];
      if (ev?.notes?.[0]) ev.notes[0].tie = true; // 직접 고치지만 같은 mutate 안의 정리(normalizeTies)가 판정한다
      C.normalizeTies(score);
    },
  });
  const count = score => C.staffRefs(score)[0].measures.length;
  const plain = (kind, apply) => ({ kind, local: false, apply });
  const events = score => C.staffRefs(score)[0].measures.flatMap(mm => mm.voices[0]).filter(ev => ev.type === 'note');
  return [
    () => input(), () => input(), () => input(), () => input(), () => input(),
    () => input(true), () => input(false, true), () => input(false, false, { n: 1, d: 4, dots: 0 }),
    () => crossing(), () => tiePair(),
    () => plain('key-sig', score => C.setMeasureKeySig(score, pick(count(score)), pick(5) - 2)),
    () => plain('time-sig', score => C.setMeasureTimeSig(score, pick(count(score)), { num: 3 + pick(2), den: 4 })),
    () => plain('insert-measure', score => C.insertMeasures(score, pick(count(score)), 1)),
    () => plain('delete-measure', score => { if (count(score) > 8) { const at = pick(count(score)); C.deleteMeasures(score, at, at); } }),
    () => plain('dynamic', score => { const list = events(score); if (list.length) list[pick(list.length)].dynamic = ['p', 'f', 'mf'][pick(3)]; }),
    () => plain('lyric', score => { const list = events(score); if (list.length) C.setLyric(list[pick(list.length)], 1, 'la'); }),
    () => plain('title', score => { score.meta.title = `제목 ${pick(1000)}`; }),
    () => plain('accidental', score => { const list = events(score); if (list.length) C.setNoteAccidental(score, list[pick(list.length)].id, 0, pick(3) - 1); }),
    () => plain('tie-toggle', score => { const list = events(score); if (list.length) C.toggleNoteTie(score, list[pick(list.length)].id, 0); }),
  ];
}

function runIdentity(pageMode, count, seed) {
  const SF = load(), { core: C, engrave: E } = SF;
  const rnd = prng(seed), makers = makeSteps(SF, rnd);
  let score = freshScore(SF), selection = null, reusedTotal = 0, localIncremental = 0, localSteps = 0;
  const opts = () => ({ pageMode, selection });
  { // 첫 그리기: 재사용 0, 결과는 전체와 같다
    const { inc, full } = pair(SF, score, opts());
    assert.equal(inc.svg, full.svg, '첫 그리기');
  }
  for (let step = 1; step <= count; step++) {
    // 가끔 선택만 바꾼다(편집 없음)
    if (rnd() < 0.2) {
      const list = C.staffRefs(score)[0].measures.flatMap(mm => mm.voices[0]).filter(ev => ev.type === 'note');
      selection = list.length && rnd() < 0.8 ? SF.__set([list[Math.floor(rnd() * list.length)].id]) : null;
    }
    const spec = makers[Math.floor(rnd() * makers.length)]();
    const before = E.__stats.systemsReused;
    try {
      C.mutate(`step ${step} ${spec.kind}`, s => spec.apply(s), spec.local ? { local: true } : undefined);
    } catch (error) { /* 규칙을 어기는 편집은 mutate가 되돌린다 — 그래도 그 뒤의 렌더는 같아야 한다 */ }
    score = C.state.score;
    const { inc, full } = pair(SF, score, opts());
    assert.equal(inc.svg, full.svg, `step ${step} (${spec.kind}, ${pageMode}) 증분 svg가 전체 렌더와 다르다`);
    assert.equal(inc.layout.systems.length, full.layout.systems.length, `step ${step} 시스템 수`);
    assertSameLayoutEffects(inc, full, `step ${step}`);
    if (pageMode !== 'pages') {
      assert.ok(inc.parts, `step ${step} parts가 있어야 한다(연속 보기)`);
      assert.equal(inc.parts.open + inc.parts.rest + inc.parts.segments.map(seg => seg.svg).join('') + inc.parts.foot, inc.svg, `step ${step} parts를 이으면 svg`);
      assert.equal(inc.parts.segments.filter(seg => seg.type === 'system').length, inc.layout.systems.length, `step ${step} 시스템 조각 개수`);
    } else assert.equal(inc.parts, null, '페이지 보기에는 parts가 없다');
    const reused = E.__stats.systemsReused - before;
    reusedTotal += reused;
    if (spec.local) { localSteps++; if (reused > 0) localIncremental++; }
    else assert.equal(reused, 0, `step ${step} (${spec.kind}) local이 아닌 편집 뒤에는 한 줄도 재사용하면 안 된다`);
  }
  return { reusedTotal, localSteps, localIncremental };
}

test('P9-8 동일성: 편집 50스텝(연속 보기)마다 증분 렌더 svg === 캐시 없는 전체 렌더 svg', () => {
  const r = runIdentity('continuous', 50, 20260125);
  assert.ok(r.reusedTotal > 0, '증분이 실제로 일어나야 한다(재사용한 시스템 수 > 0)');
  assert.ok(r.localSteps >= 10, `입력 편집 스텝이 충분해야 한다(${r.localSteps})`);
  assert.ok(r.localIncremental >= Math.floor(r.localSteps * 0.5), `입력 편집의 절반 이상은 증분이어야 한다(${r.localIncremental}/${r.localSteps})`);
});

test('P9-8 동일성: 다른 시드·페이지 보기에서도 같다', () => {
  // P98_EXTRA_SEEDS=N: 변이 시험에서 "이 변이는 정말 결과가 같은가"를 실험으로 확인할 때만 쓰는 추가 시드(기본 0)
  const extra = Array.from({ length: +process.env.P98_EXTRA_SEEDS || 0 }, (_, i) => ['continuous', 1000 + i, 50]);
  for (const [mode, seed, count] of [['continuous', 7, 50], ['pages', 99, 30], ...extra]) {
    const r = runIdentity(mode, count, seed);
    assert.ok(r.reusedTotal > 0, `${mode} 시드 ${seed}: 증분이 일어나야 한다`);
  }
});

test('P9-8 입력 한 번은 이웃 시스템을 재사용하고, 바뀐 마디가 있는 시스템은 다시 그린다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 24);
  const first = E.render(score, { ...RENDER });
  const total = first.layout.systems.length;
  assert.ok(total >= 4, `시스템이 여럿이어야 한다(${total})`);
  const before = { ...E.__stats };
  C.mutate('입력', s => C.inputAt(s, 12, SF.F(2, 8), EIGHTH, [{ step: 2, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  const second = E.render(C.state.score, { ...RENDER });
  const reused = E.__stats.systemsReused - before.systemsReused, built = E.__stats.systemsBuilt - before.systemsBuilt;
  assert.equal(reused + built, total, '모든 시스템은 재사용이거나 새로 그린 것 중 하나');
  assert.ok(built >= 1 && built <= 3, `새로 그린 시스템은 소수여야 한다(${built}/${total})`);
  assert.ok(reused >= total - 3, `나머지는 재사용(${reused}/${total})`);
  const fullSecond = E.render(clone(C.state.score), { fallback: true, cache: false, preserveLayout: true });
  assert.equal(second.svg, fullSecond.svg);
  assertSameLayoutEffects(second, fullSecond, '입력 한 번');
  const systemsOf = out => out.parts.segments.filter(seg => seg.type === 'system').map(seg => seg.svg);
  const changed = systemsOf(second).map((svg, i) => svg !== systemsOf(first)[i]).filter(Boolean).length;
  assert.ok(changed >= 1 && changed <= built, `문자열이 달라진 시스템은 새로 그린 것 안에 든다(${changed} ≤ ${built})`);
});

test('P9-8 dirtySince 계약: 현재 rev는 빈 집합, 입력한 마디는 들어 있고, 모르면 null', () => {
  const SF = load(), { core: C } = SF;
  const score = freshScore(SF, 8);
  const r0 = revOf(score);
  assert.ok(Number.isInteger(r0));
  assert.equal(C.dirtySince(score, r0).size, 0, '아무 일도 없었으면 빈 집합');
  C.mutate('입력', s => C.inputAt(s, 3, SF.F(1, 8), EIGHTH, [{ step: 2, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  const r1 = revOf(C.state.score), d1 = C.dirtySince(C.state.score, r0);
  assert.equal(Object.prototype.toString.call(d1), '[object Set]'); // vm 영역이 달라 instanceof는 쓰지 않는다
  assert.ok(d1.has(3), `입력한 마디(3)가 들어 있다: ${[...d1]}`);
  assert.equal(C.dirtySince(C.state.score, r1).size, 0);
  C.mutate('조표', s => C.setMeasureKeySig(s, 2, 1));
  assert.equal(C.dirtySince(C.state.score, r1), null, 'local이 아닌 mutate는 모른다(null)');
  assert.equal(C.dirtySince(C.state.score, r0), null, 'null이 한 번 끼면 그 앞에서부터도 null');
  assert.equal(C.dirtySince(C.state.score, -12345), null, '기록에 없는 rev는 null');
  assert.equal(C.dirtySince(C.state.score, undefined), null);
  assert.equal(C.dirtySince({}, 1), null, '캐시가 없는 악보도 null');
});

test('P9-8 local이 아닌 편집·되돌리기·스타일 변경 뒤에는 전부 새로 그린다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 16);
  E.render(score, { ...RENDER });
  const reusedAfter = (label, run) => {
    const before = E.__stats.systemsReused;
    run();
    const out = E.render(C.state.score, { ...RENDER });
    assert.equal(E.__stats.systemsReused - before, 0, `${label}: 재사용 0`);
    assert.equal(out.svg, E.render(clone(C.state.score), { fallback: true, cache: false, preserveLayout: true }).svg, `${label}: 전체와 같다`);
  };
  reusedAfter('일반 mutate(직접 수정)', () => C.mutate('셈여림', s => { C.staffRefs(s)[0].measures[5].voices[0][0].dynamic = 'ff'; }));
  E.render(C.state.score, { ...RENDER });
  reusedAfter('되돌리기', () => C.undo());
  E.render(C.state.score, { ...RENDER });
  reusedAfter('스타일 변경', () => { C.state.score.style.staffLineWidth += 0.1; C.invalidate(C.state.score); });
  E.render(C.state.score, { ...RENDER });
  reusedAfter('마디 삽입', () => C.mutate('마디', s => C.insertMeasures(s, 4, 1)));
});

test('P9-8 선택이 바뀌면 그 선택이 걸친 시스템만 다시 그리고, 결과는 전체와 같다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 24);
  const ids = C.staffRefs(score)[0].measures.map(mm => mm.voices[0][0].id);
  const a = E.render(score, { ...RENDER, selection: SF.__set([ids[1]]) });
  const total = a.layout.systems.length;
  const before = { ...E.__stats };
  const b = E.render(score, { ...RENDER, selection: SF.__set([ids[20]]) });
  const built = E.__stats.systemsBuilt - before.systemsBuilt, reused = E.__stats.systemsReused - before.systemsReused;
  assert.equal(built + reused, total);
  assert.ok(built >= 1 && built <= 2 * 1 + 1, `선택이 빠진 시스템·들어온 시스템만 새로 그린다(${built})`);
  assert.equal(b.svg, E.render(clone(score), { fallback: true, cache: false, selection: SF.__set([ids[20]]), preserveLayout: true }).svg);
});

test('P9-8 내보내기(export)와 캐시 없는 render는 증분 기록을 건드리지 않는다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 12);
  E.render(score, { ...RENDER });
  const before = { ...E.__stats };
  E.render(score, { fallback: true, export: true, preserveLayout: true });
  E.render(score, { fallback: true, cache: false });
  assert.equal(E.__stats.systemsReused, before.systemsReused);
  C.mutate('입력', s => C.inputAt(s, 2, SF.F(0, 8), EIGHTH, [{ step: 0, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  E.render(C.state.score, { fallback: true, export: true, preserveLayout: true });
  const out = E.render(C.state.score, { ...RENDER });
  assert.equal(out.svg, E.render(clone(C.state.score), { fallback: true, cache: false, preserveLayout: true }).svg, '내보내기를 사이에 끼워도 그다음 화면 렌더는 전체와 같다');
});

test('P9-8 내보내기가 cache:true로 불려도 재사용하지 않고, 화면용 증분 기록을 덮어쓰지도 않는다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 24);
  E.render(score, { ...RENDER });                                      // 화면용 기록을 만든다
  C.mutate('입력', s => C.inputAt(s, 6, SF.F(2, 8), EIGHTH, [{ step: 5, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  const reusedBefore = E.__stats.systemsReused;
  const exported = E.render(C.state.score, { ...RENDER, export: true, preserveLayout: true });
  assert.equal(E.__stats.systemsReused, reusedBefore, '내보내기는 줄 그림을 재사용하지 않는다');
  assert.equal(exported.svg, fullSvg(SF, C.state.score, { export: true }), '내보낸 svg는 캐시 없는 내보내기와 같다');
  assert.equal(exported.parts?.segments?.some(seg => seg.svg.includes('note-hit')), false, '내보내기 그림에는 클릭 영역이 없다');
  // 내보내기를 사이에 끼웠어도 화면용 기록(지난 화면 그림)은 그대로여서, 그다음 화면 렌더는 이웃 줄을 재사용한다
  const before = E.__stats.systemsReused;
  const out = E.render(C.state.score, { ...RENDER });
  assert.ok(E.__stats.systemsReused - before >= out.layout.systems.length - 3, `내보내기 뒤에도 화면 렌더는 줄을 재사용한다(${E.__stats.systemsReused - before}/${out.layout.systems.length})`);
  assert.equal(out.svg, fullSvg(SF, C.state.score));
});

test('P9-8 전역 키: 악보 설정·그리기 옵션이 바뀌면(invalidate 없이도) 한 줄도 재사용하지 않는다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 12);
  E.render(score, { ...RENDER });
  const check = (label, change, opts = {}) => {
    const before = E.__stats.systemsReused;
    change();
    const out = E.render(score, { ...RENDER, ...opts });
    assert.equal(E.__stats.systemsReused - before, 0, `${label}: 재사용 0`);
    assert.equal(out.svg, E.render(clone(score), { fallback: true, cache: false, preserveLayout: true, ...opts }).svg, `${label}: 전체와 같다`);
  };
  check('스타일 직접 수정', () => { score.style.staffLineWidth += 0.2; });
  check('제목 직접 수정', () => { score.meta.title = '다른 제목'; });
  check('성부 옵션', () => {}, { activeVoice: 2 });
  check('빈 보표 숨기기 옵션', () => {}, { hideEmptyStaves: true });
  // 키가 너무 빡빡해서 항상 새로 그리는 것이 아님을 확인: 선택만 바꾸면 선택이 걸친 줄 말고는 재사용한다
  const ids = C.staffRefs(score)[0].measures.map(mm => mm.voices[0][0].id);
  const total = E.render(score, { ...RENDER, selection: SF.__set([ids[0]]) }).layout.systems.length;
  const before = E.__stats.systemsReused;
  E.render(score, { ...RENDER, selection: SF.__set([ids[11]]) });
  assert.ok(E.__stats.systemsReused - before >= total - 2, `선택만 바뀌면 대부분 재사용한다(${E.__stats.systemsReused - before}/${total})`);
});

test('P9-8 이웃 마디 의존: 줄 끝 마디를 고치면 붙임줄이 끊겨 다음 줄 첫 음의 임시표가 다시 나타난다(다른 줄이어도 다시 그린다)', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 24);
  const sys = out => out.layout.systems.map(S => S.measures.map(M => M.idx));
  const first = E.render(score, { ...RENDER });
  const lines = sys(first);
  const edge = lines.findIndex(list => list.length >= 1 && list[list.length - 1] + 1 === (lines[lines.indexOf(list) + 1] || [])[0]);
  assert.ok(edge >= 0, '줄 끝과 다음 줄 처음이 이어진 마디 쌍이 있다');
  const m = lines[edge][lines[edge].length - 1];                     // 줄의 마지막 마디
  assert.notEqual(lines.findIndex(l => l.includes(m)), lines.findIndex(l => l.includes(m + 1)), '두 마디는 서로 다른 줄');
  const cs = { step: 0, alter: 1, oct: 4 };                           // C♯4
  C.mutate('붙임줄 만들기', s => {
    C.inputAt(s, m, SF.F(7, 8), EIGHTH, [{ ...cs }], { partIdx: 0, staffIdx: 0, voice: 1 });
    C.inputAt(s, m + 1, SF.F(0, 8), EIGHTH, [{ ...cs }], { partIdx: 0, staffIdx: 0, voice: 1 });
    C.staffRefs(s)[0].measures[m].voices[0].slice(-1)[0].notes[0].tie = true;
    C.normalizeTies(s);
  });
  const tied = E.render(C.state.score, { ...RENDER });
  assert.equal(tied.svg, E.render(clone(C.state.score), { fallback: true, cache: false, preserveLayout: true }).svg);
  const accidentalsIn = (out, index) => (out.parts.segments.filter(seg => seg.type === 'system')[index].svg.match(/class="acc/g) || []).length;
  const nextLine = lines.findIndex(l => l.includes(m + 1));
  const before = accidentalsIn(tied, nextLine);
  // 줄 끝 마디의 마지막 음을 다른 높이로 바꾼다 → 붙임줄이 사라지고 다음 줄 첫 음에 임시표가 붙는다
  C.mutate('입력', s => C.inputAt(s, m, SF.F(7, 8), EIGHTH, [{ step: 1, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  const after = E.render(C.state.score, { ...RENDER });
  assert.equal(after.svg, E.render(clone(C.state.score), { fallback: true, cache: false, preserveLayout: true }).svg, '이웃 줄도 전체와 같게 다시 그린다');
  assert.ok(accidentalsIn(after, nextLine) > before, `다음 줄의 임시표가 늘어난다(${before} → ${accidentalsIn(after, nextLine)})`);
});


test('P9-8 dirtySince: 처음 만든 캐시의 rev도 기록에 있고, 기록이 밀려난 rev는 (남은 것만 합치지 않고) null이다', () => {
  const SF = load(), { core: C } = SF;
  // 아직 아무 편집도 없는 새 악보: 첫 캐시 rev에서 시작한 입력도 "이 마디만 바뀜"으로 알려야 한다
  C.setScore(C.createScore({ ensemble: 'piano', measureCount: 16 }));
  const score = C.state.score;
  SF.engrave.render(score, { ...RENDER });
  const r0 = revOf(score);
  assert.ok(Number.isInteger(r0));
  C.mutate('입력', s => C.inputAt(s, 8, SF.F(2, 8), EIGHTH, [{ step: 2, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  const d0 = C.dirtySince(C.state.score, r0);
  assert.ok(d0 && d0.has(8), `처음 rev(${r0})에서 시작해도 입력한 마디(8)를 알려 준다: ${d0 && [...d0]}`);
  // 기록은 최근 64개만 남는다 — 밀려난 rev에서 시작하면 남은 기록만 합친 값이 아니라 "모름(null)"이어야 한다
  const r1 = revOf(C.state.score);
  for (let i = 0; i < 70; i++) C.mutate(`입력 ${i}`, s => C.inputAt(s, 3 + (i % 3), SF.F(i % 8, 8), EIGHTH, [{ step: i % 7, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  assert.equal(C.dirtySince(C.state.score, r1), null, '기록에서 밀려난 rev는 null');
  assert.equal(C.dirtySince(C.state.score, r0), null);
  const recent = revOf(C.state.score);
  C.mutate('입력', s => C.inputAt(s, 10, SF.F(1, 8), EIGHTH, [{ step: 4, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
  assert.deepEqual([...C.dirtySince(C.state.score, recent)], [10], '최근 rev에서는 그 뒤 바뀐 마디만');
});

test('P9-8 이웃 경계: 입력한 마디의 앞·뒤 마디가 다른 줄이면 그 줄도 다시 그린다(줄 폭이 그대로여도)', () => {
  // 붙임줄 정리(normalizeTies)는 이웃 마디 끝 음의 tie를 고치고, 붙임줄로 이어 온 음은 임시표를 다시 안 붙인다 —
  // 지금은 그 영향이 줄 좌표(키)에 거의 늘 드러나지만, 그림 문자열이 좌표 없이 이웃에 기대게 되는 날을 대비한 보험이다. 폭을 안 바꾸는 입력으로 보험 자체를 확인한다.
  const SF = load(), { core: C, engrave: E } = SF;
  const lineOf = (out, m) => out.layout.systems.findIndex(S => S.measures.some(M => m >= M.idx && m < M.idx + (M.span || 1)));
  for (const m of [1, 2, 5]) {
    const score = freshScore(SF, 24);
    const first = E.render(score, { ...RENDER });
    const lines = new Set([m - 1, m, m + 1].map(k => lineOf(first, k)).filter(k => k >= 0));
    if (m === 1 || m === 2) assert.equal(lines.size, 2, `마디 ${m}의 앞뒤는 두 줄에 걸친다`);
    const before = { ...E.__stats };
    // 같은 길이·같은 자리표 안의 흰 건반으로 바꾼다(8분음표 하나의 높이만 변경) → 줄 폭·높이는 그대로
    C.mutate('입력', s => C.inputAt(s, m, SF.F(2, 8), EIGHTH, [{ step: (2 + m + 2) % 7, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
    const out = E.render(C.state.score, { ...RENDER });
    const built = E.__stats.systemsBuilt - before.systemsBuilt, reused = E.__stats.systemsReused - before.systemsReused;
    assert.equal(built, lines.size, `마디 ${m}: 앞뒤 마디가 걸친 줄 ${[...lines]}만 다시 그린다(그린 ${built})`);
    assert.equal(reused, out.layout.systems.length - lines.size, `마디 ${m}: 나머지는 재사용`);
    assert.equal(out.svg, fullSvg(SF, C.state.score), `마디 ${m}: 전체 렌더와 같다`);
  }
});

test('P9-8 줄 바꿈이 달라지면 건드리지 않은 줄도 새 좌표로 다시 그린다(마디가 다음 줄로 밀림)', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const QUARTER = { n: 1, d: 4, dots: 0 }, SIXTEENTH = { n: 1, d: 16, dots: 0 }, count = 30;
  C.setScore(C.createScore({ ensemble: 'piano', measureCount: count }));
  C.mutate('fill', score => {
    for (const ref of C.staffRefs(score)) for (let m = 0; m < count; m++) for (let i = 0; i < 4; i++)
      C.inputAt(score, m, SF.F(i, 4), QUARTER, [{ step: (i + m) % 7, alter: 0, oct: ref.staffIdx ? 3 : 4 }], { partIdx: ref.partIdx, staffIdx: ref.staffIdx, voice: 1 });
  });
  const partition = out => JSON.stringify(out.layout.systems.map(S => S.measures.map(M => M.idx)));
  const first = E.render(C.state.score, { ...RENDER });
  const before = { ...E.__stats };
  // 5번 마디에 16분음표 16개(같은 음역) → 5번 마디가 넓어져 줄 나눔이 바뀌고, 그 뒤 줄들의 마디 구성이 줄줄이 달라진다
  C.mutate('촘촘한 입력', s => { for (let i = 0; i < 16; i++) C.inputAt(s, 5, SF.F(i, 16), SIXTEENTH, [{ step: (i * 2) % 7, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }); }, { local: true });
  const out = E.render(C.state.score, { ...RENDER });
  assert.notEqual(partition(out), partition(first), '줄 나눔이 달라졌다(이 시험의 전제)');
  const reused = E.__stats.systemsReused - before.systemsReused;
  assert.ok(reused >= 1, `고친 줄 앞의 줄은 재사용한다(${reused})`);
  assert.equal(out.svg, fullSvg(SF, C.state.score), '밀려난 마디가 있는 줄도 전체 렌더와 같다');
  assertSameLayoutEffects(out, E.render(clone(C.state.score), { fallback: true, cache: false, preserveLayout: true }), '줄 바꿈');
});

test('P9-8 멀티레스트(묶음 쉼표) 안쪽 마디에 입력해도 증분 결과는 전체 렌더와 같다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const opts = { ...RENDER, multiRest: true };
  for (const m of [12, 9, 4, 19]) {
    C.setScore(C.createScore({ ensemble: 'piano', measureCount: 24 }));
    C.mutate('fill', score => { for (const mm of [0, 1, 2, 3, 20, 21, 22, 23]) for (let i = 0; i < 8; i++)
      C.inputAt(score, mm, SF.F(i, 8), EIGHTH, [{ step: (i + mm) % 7, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }); });
    const first = E.render(C.state.score, opts);
    assert.ok(first.layout.multiRest && first.layout.systems.some(S => S.measures.some(M => M.collapsed && M.span >= 8)), '가운데 빈 마디들이 하나로 묶여 있다(이 시험의 전제)');
    C.mutate('입력', s => C.inputAt(s, m, SF.F(2, 8), EIGHTH, [{ step: 2, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }), { local: true });
    const out = E.render(C.state.score, opts);
    assert.equal(out.svg, fullSvg(SF, C.state.score, { multiRest: true }), `마디 ${m}: 전체와 같다`);
    assertSameLayoutEffects(out, E.render(clone(C.state.score), { fallback: true, cache: false, multiRest: true, preserveLayout: true }), `멀티레스트 ${m}`);
  }
});

test('P9-8 전역 키: 옵션이 줄 좌표는 그대로 두고 그림만 바꿔도(성부 선택) 한 줄도 재사용하지 않는다', () => {
  const SF = load(), { core: C, engrave: E } = SF;
  const score = freshScore(SF, 12, { sharpFirst: true });
  const first = E.render(score, { ...RENDER });
  const geometry = out => JSON.stringify(out.layout.systems.map(S => S.measures.map(M => [M.x0, M.x1, M.scale])));
  const before = E.__stats.systemsReused;
  const voice2 = E.render(score, { ...RENDER, activeVoice: 2 });          // 비어 있는 2성부의 쉼표가 그려지지만 첫 음의 임시표 자리 안에 들어간다
  const reused = E.__stats.systemsReused - before;
  assert.equal(geometry(voice2), geometry(first), '줄·마디 좌표는 같다(이 시험의 전제)');
  assert.notEqual(voice2.svg, first.svg, '그림은 다르다(이 시험의 전제)');
  assert.equal(reused, 0, '옵션이 바뀌면 재사용 0');
  assert.equal(voice2.svg, fullSvg(SF, score, { activeVoice: 2 }), '전체 렌더와 같다');
});
