import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The renderer has no IO/playback dependency. Keep this regression suite usable
// while those independently owned modules are being edited.
const context = vm.createContext({ console, setTimeout, clearTimeout });
context.window = context;
context.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const name of ['safe-html', 'core', 'engrave']) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context, { filename: `${name}.js` });
const { core: C, engrave: E, F } = context.SF;
const pitch = (step = 0, alter = 0, oct = 4) => ({ step, alter, oct });
const note = (id, notes, d = 4, extra = {}) => ({ id, type: 'note', notes, dur: { n: 1, d, dots: 0 }, voice: 1, ...extra });
function measure(score, m, events, voice = 1, ref = C.staffRefs(score)[0]) {
  ref.measures[m].voices[voice - 1] = events;
  if (voice === 1) ref.measures[m].events = events;
  if (C.invalidate) C.invalidate(score, { keepNormalized: true });
}
const render = (s, opts = {}) => E.render(s, { fallback: true, ...opts });

test('chord accidentals occupy distinct columns and reserve horizontal room', () => {
  const s = C.createScore({ measureCount: 1 });
  const ev = note('acc-chord', [pitch(0, 1), pitch(1, 1), pitch(4, -1)]);
  measure(s, 0, [ev]);
  const a = render(s);
  const xs = [...a.svg.matchAll(/class="accidental" transform="translate\(([-.\d]+),/g)].map(m => +m[1]);
  assert.equal(xs.length, 3);
  assert.equal(new Set(xs).size, 3);
  const width = a.layout.systems[0].measures[0].x1 - a.layout.systems[0].measures[0].x0;
  ev.notes.forEach(n => n.alter = 0);
  const b = render(s);
  assert.ok(width > b.layout.systems[0].measures[0].x1 - b.layout.systems[0].measures[0].x0);
});

test('accidentals follow each voice predecessor across bars without isTiedFrom scans', () => {
  const s = C.createScore({ measureCount: 2 });
  const first = note('tie-a', [{ ...pitch(0, 1), tie: true }], 1);
  const second = note('tie-b', [pitch(0, 1)], 1);
  measure(s, 0, [first]); measure(s, 1, [second]);
  const old = C.isTiedFrom;
  C.isTiedFrom = () => { throw new Error('quadratic predecessor lookup'); };
  try { render(s); assert.equal(first.notes[0].__acc, 'sharp'); assert.equal(second.notes[0].__acc, null); }
  finally { C.isTiedFrom = old; }
});

test('second voice slurs stay on their voice side in a polyphonic staff', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('upper', [pitch(0, 0, 5)], 1)]);
  measure(s, 0, [note('lower-a', [pitch(0)], 2, { voice: 2 }), note('lower-b', [pitch(2)], 2, { voice: 2 })], 2);
  s.spanners = [{ id: 'lower-slur', type: 'slur', startId: 'lower-a', endId: 'lower-b' }];
  const r = render(s), le = r.layout.eventsById.get('lower-a');
  const path = r.svg.match(/class="slur" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/);
  assert.ok(path);
  assert.ok(+path[2] > E.yForStep(le.staff, s, C.absStep(le.ev.notes[0])));
  assert.ok(+path[4] > +path[2]);
});

test('64ths draw four beam levels; brief values and double dots have fallback icons', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, Array.from({ length: 4 }, (_, i) => note(`short-${i}`, [pitch(i)], 64)));
  const r = render(s);
  assert.equal((r.svg.match(/class="beam"/g) || []).length, 10); // primary + 3 secondary levels × 3 joins
  assert.equal((E.iconNote({ n: 1, d: 64 }, 2).match(/class="icon-flag"/g) || []).length, 4);
  assert.equal((E.iconNote({ n: 1, d: 4 }, 2).match(/class="icon-dot"/g) || []).length, 2);
  measure(s, 0, [note('breve', [pitch()], 1, { dur: { n: 2, d: 1, dots: 0 } })]);
  const breve = render(s).svg;
  assert.doesNotMatch(breve, /class="stem"/);
  assert.match(breve, /v 14 M/);
});

test('per-measure key, time and clef changes draw prefixes and govern hit-test pitch', () => {
  const s = C.createScore({ measureCount: 4 });
  C.setMeasureKeySig(s, 2, 1);
  C.setMeasureClef(s, 2, 'bass');
  if (C.setMeasureTimeSig) C.setMeasureTimeSig(s, 2, { num: 3, den: 4 });
  measure(s, 2, [note('bass-c4', [pitch(0)], 4), note('key-f', [pitch(3, 1)], 2)]);
  s.layout.measuresPerSystem = 4;
  const r = render(s), le = r.layout.eventsById.get('bass-c4');
  assert.equal(le.clef, 'bass');
  assert.equal(E.yForStep(le.staff, s, 28), le.staff.yTop - 10);
  const h = E.hitTest(le.x, le.staff.yTop - 10);
  assert.equal(h.step, 28); assert.equal(h.staff.clef, 'bass');
  assert.equal(r.layout.eventsById.get('key-f').ev.notes[0].__acc, null);
  assert.match(r.svg, /class="measure-change" data-measure="2"/);
  assert.ok(r.layout.measuresByIndex.get(2).prefixW > 50);
});

test('key cancellation works when sharps decrease or change to flats', () => {
  const s = C.createScore({ measureCount: 2, keySig: 3 });
  C.setMeasureKeySig(s, 1, 1);
  const a = render(s).svg;
  assert.equal((a.match(/class="key-cancel"/g) || []).length, 2);
  C.setMeasureKeySig(s, 1, -1);
  assert.equal((render(s).svg.match(/class="key-cancel"/g) || []).length, 3);
});

test('notehead wrappers retain source indices and can select one note', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('chord', [pitch(4), pitch(0), pitch(2)])]);
  const r = render(s, { selection: { id: 'chord', noteIdx: 2 } });
  assert.match(r.svg, /class="nh sel-note" data-note="2"/);
  const le = r.layout.eventsById.get('chord'), head = le.noteheads.find(n => n.index === 2);
  assert.equal(E.hitTest(head.x, head.y).noteIdx, 2);
  assert.ok(r.svg.indexOf('class="hit"') < r.svg.indexOf('class="nh'));
});

test('multirests collapse only clean spans, retain source measures, and expose expansion', () => {
  const s = C.createScore({ measureCount: 8 });
  const r = render(s, { multiRest: true });
  const m = r.layout.systems[0].measures[0];
  assert.equal(m.span, 8); assert.equal(m.collapsed, true);
  assert.equal(s.measures.length, 8);
  assert.equal(r.layout.eventsById.size, 1);
  assert.equal(E.hitTest((m.x0 + m.x1) / 2, m.staffMeasures[0].staff.middleY).measureSpan, 8);
  const midpoint = E.positionForMeasure(3, 1);
  assert.equal(midpoint.x, (m.x0 + m.x1) / 2);
  const expanded = render(s, { multiRest: true, expandedMeasures: [3] });
  assert.equal(expanded.layout.measuresByIndex.get(3).collapsed, false);
  s.measures[4].marker = 'segno';
  assert.equal(render(s, { multiRest: true }).layout.measuresByIndex.get(4).collapsed, false);
});

test('all additional clefs and ornaments render fallback geometry', () => {
  for (const clef of ['alto', 'tenor', 'treble8vb', 'bass8vb']) {
    const s = C.createScore({ measureCount: 1, clef });
    measure(s, 0, [note(`clef-${clef}`, [pitch()])]);
    const r = render(s), le = r.layout.eventsById.get(`clef-${clef}`);
    assert.equal(le.clef, clef);
    const y = E.yForStep(le.staff, s, 28);
    assert.equal(E.stepForY(le.staff, s, y), 28);
    if (clef.endsWith('8vb')) assert.match(r.svg, /class="clef-octave"/);
    for (const ornament of ['trill', 'mordent', 'invMordent', 'turn', 'invTurn']) {
      le.ev.ornament = ornament;
      assert.match(render(s).svg, /class="ornament" transform=/);
    }
  }
});

test('all new rests and standalone flags use visible fallback paths', () => {
  const s = C.createScore({ measureCount: 1 });
  for (const d of [32, 64]) {
    measure(s, 0, [{ id: `rest-${d}`, type: 'rest', notes: [], voice: 1, dur: { n: 1, d, dots: 0 } }]);
    const rest = render(s).svg;
    assert.match(rest, /a 1.9 1.9/);
    measure(s, 0, [note(`flag-${d}`, [pitch()], d)]);
    const flagged = render(s).svg;
    assert.equal((flagged.match(/c \.9 2.2 3.4 3.3 3.7 6.3/g) || []).length, Math.log2(d) - 2);
  }
  measure(s, 0, [{ id: 'rest-breve', type: 'rest', notes: [], voice: 1, dur: { n: 2, d: 1, dots: 0 } }]);
  assert.match(render(s).svg, /M -5 -10 h 10 v 10 h -10 Z/);
});

test('ottava preserves model pitches, shifts note coordinates and splits across pages', () => {
  const s = C.createScore({ measureCount: 2 });
  measure(s, 0, [note('oct-a', [pitch(0, 0, 6)], 1)]);
  measure(s, 1, [note('oct-b', [pitch(0, 0, 6)], 1)]);
  measure(s, 0, [note('other-voice', [pitch()], 1, { voice: 2 })], 2);
  s.measures[0].breakType = 'page';
  s.spanners = [{ id: 'oct', type: 'ottava', startId: 'oct-a', endId: 'oct-b', shift: 12 }];
  const r = render(s, { pageMode: 'pages' }), le = r.layout.eventsById.get('oct-a');
  assert.equal(le.ottavaSteps, 7);
  assert.equal(r.layout.eventsById.get('other-voice').ottavaSteps, 0);
  assert.equal(le.ev.notes[0].oct, 6);
  assert.equal(E.yForStep(le.staff, s, 42), E.yForStep({ ...le.staff, ottavaSteps: 0 }, s, 35));
  assert.equal(r.pages.length, 2);
  assert.ok(r.pages.every(p => p.includes('class="ottava"')));
  assert.match(r.pages[1], /\(8va\)/);
});

test('dense text uses separate lanes and lyrics drive minimum horizontal spacing', () => {
  const s = C.createScore({ measureCount: 1 });
  const ev = note('annotated', [pitch()], 4, { chordSymbol: 'C', rehearsal: 'A', tempo: 100, staffText: 'dolce', dynamic: 'mf', ornament: 'trill', trillLine: true, lyrics: [{ verse: 1, text: '아주긴가사음절' }, { verse: 2, text: '가사' }] });
  measure(s, 0, [ev]);
  const r = render(s), lane = r.layout.systems[0].staffLayouts[0].laneY;
  assert.equal(new Set([lane.chord, lane.rehearsal, lane.tempo, lane.text, lane.ornament]).size, 5);
  assert.ok(lane.lyric[2] > lane.lyric[1]); assert.ok(lane.lyric[1] > lane.dyn);
  assert.match(r.svg, /class="ornament"/); assert.match(r.svg, /class="trill-line"/);
  const wide = r.layout.systems[0].measures[0].x1;
  ev.lyrics = []; ev.lyric = '';
  assert.ok(render(s).layout.systems[0].measures[0].x1 < wide);
});

test('pagination contains systems, metadata, unique event IDs, and page-local hit conversion', () => {
  const data = JSON.parse(readFileSync(new URL('./baseline/quartet64.scoreforge.json', import.meta.url), 'utf8'));
  const s = C.fromJSON(data);
  s.meta.subtitle = 'Subtitle'; s.meta.lyricist = 'Lyricist'; s.meta.copyright = 'Copyright';
  const r = render(s, { pageMode: 'pages' });
  assert.ok(r.layout.pages.length >= 2);
  assert.equal(r.pages.length, r.layout.pages.length);
  for (const page of r.layout.pages) for (const sys of page.systems) assert.ok(sys.contentBottom - page.offsetY <= page.height - r.layout.metrics.marginBottom);
  assert.match(r.pages[0], /data-meta="subtitle"/); assert.match(r.pages[0], /data-meta="lyricist"/);
  assert.match(r.pages[0], /data-meta="copyright"/); assert.match(r.pages[1], /class="page-number"/);
  const ids = [...r.svg.matchAll(/data-ref="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  const le = r.layout.pages[1].systems[0].measures[0].events[0];
  const p = E.globalToPage(le.page, le.x, le.staff.middleY);
  const h = E.hitTest(le.page, p.x, p.y);
  assert.equal(h.page, le.page); assert.equal(h.M.idx, le.mIdx);
  assert.equal(E.pageToGlobal(p.page, p.x, p.y).y, le.staff.middleY);
  assert.match(render(s).svg, /<svg id="score-svg"/);
});

test('standalone export embeds styles, has no SMuFL dependency and preserves lastLayout', async () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('export', [pitch(0, 1)], 32, { ornament: 'turn' })]);
  const interactive = render(s).layout;
  s.style.stemWidth = 2.5; s.style.lyricLineHeight = 24;
  const result = await E.renderForExport(s);
  assert.equal(E.getLayout(), interactive);
  assert.match(result.svg, /<style>/);
  assert.match(result.svg, /stroke-width:2.5/);
  assert.equal(result.layout.style.lyricLineHeight, 24);
  assert.doesNotMatch(result.svg, /font-family="BravuraSF"|[\uE000-\uF8FF]|overlay-cursor|id="play-cursor"/);
  assert.equal(result.pages.length, 1);
});

test('export restores font readiness and routes cursor, ghost and speedy overlays to the correct page', async () => {
  const oldDocument = context.document, oldTimer = context.setTimeout;
  context.document = { fonts: { load: () => Promise.resolve(), check: () => true } };
  context.setTimeout = () => 0;
  await new Promise(resolve => E.loadFont(resolve));
  context.setTimeout = oldTimer;
  assert.equal(E.isFontReady(), true);
  const s = C.createScore({ measureCount: 2 });
  measure(s, 0, [note('page-one', [pitch()], 1)]); measure(s, 1, [note('page-two', [pitch()], 1)]);
  s.measures[0].breakType = 'page';
  const r = E.render(s, { pageMode: 'pages' }), le = r.layout.eventsById.get('page-two');
  const nodes = Object.fromEntries(['ghost', 'cursor', 'speedy'].map(name => [name, [0, 1].map(page => ({ innerHTML: 'old', getAttribute: () => String(page) }))]));
  context.document = { getElementById: () => { throw new Error('legacy overlay lookup in page mode'); }, querySelectorAll: selector => nodes[selector.split('overlay-')[1]] };
  try {
    E.drawInputCursor('page-two');
    E.drawSpeedy({ cursorId: 'page-two', step: 28 });
    const p = E.globalToPage(1, le.x, E.yForStep(le.staff, s, 28));
    E.drawGhost(E.hitTest(1, p.x, p.y), { n: 1, d: 64, dots: 0 }, false);
    for (const groups of Object.values(nodes)) { assert.equal(groups[0].innerHTML, ''); assert.notEqual(groups[1].innerHTML, ''); }
    const out = await E.renderForExport(s);
    assert.doesNotMatch(out.svg, /font-family="BravuraSF"|[\uE000-\uF8FF]/);
    assert.equal(E.isFontReady(), true); assert.equal(E.getLayout(), r.layout);
    E.clearOverlays();
    assert.ok(Object.values(nodes).every(groups => groups.every(g => g.innerHTML === '')));
  } finally { context.document = oldDocument; }
});

// ---- P5-A1: 한 보표·한 마디에 내용 있는 성부가 하나뿐이면 기둥 방향을 음높이로 정한다(표준 조판).
//      여러 성부가 함께 있을 때만 1·3성부 위 / 2·4성부 아래. 사람이 고른 방향(stemDirection)은 그대로 존중한다.
const restEv = (id, d = 4, voice = 1) => ({ id, type: 'rest', notes: [], voice, dur: { n: 1, d, dots: 0 } });
const stemOf = (r, id) => r.layout.eventsById.get(id).stemDir;
const beamY = svg => [...svg.matchAll(/<polygon class="beam" points="([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) /g)].map(m => [+m[2], +m[4]]);

test('P5-A1 ① 성부 하나뿐: 높은 음(C5·D5·E5)의 기둥은 아래로', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('h1', [pitch(0, 0, 5)]), note('h2', [pitch(1, 0, 5)]), note('h3', [pitch(2, 0, 5)]), restEv('h4')]);
  const r = render(s);
  assert.deepEqual(['h1', 'h2', 'h3'].map(id => stemOf(r, id)), ['down', 'down', 'down']);
  assert.equal(r.layout.eventsById.get('h1').multiVoice, false);
});

test('P5-A1 ② 성부 하나뿐: 낮은 음(C4·D4)의 기둥은 위로', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('l1', [pitch(0, 0, 4)], 2), note('l2', [pitch(1, 0, 4)], 2)]);
  const r = render(s);
  assert.deepEqual(['l1', 'l2'].map(id => stemOf(r, id)), ['up', 'up']);
});

test('P5-A1 ③ 같은 마디에 2성부가 생기면 성부 규칙(1성부 위·2성부 아래)으로 — 음높이와 상관없이', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('v1', [pitch(0, 0, 5)], 1)]);                   // 높은 음이지만 1성부 → 위
  measure(s, 0, [note('v2', [pitch(2, 0, 4)], 1, { voice: 2 })], 2);   // 낮은 음이지만 2성부 → 아래
  const r = render(s);
  assert.equal(stemOf(r, 'v1'), 'up');
  assert.equal(stemOf(r, 'v2'), 'down');
  assert.equal(r.layout.eventsById.get('v1').multiVoice, true);
  assert.equal(r.layout.eventsById.get('v2').multiVoice, true);
  // 3·4성부도 같은 규칙: 3성부 위, 4성부 아래
  measure(s, 0, [note('v3', [pitch(0, 0, 3)], 1, { voice: 3 })], 3);
  measure(s, 0, [note('v4', [pitch(0, 0, 6)], 1, { voice: 4 })], 4);
  const four = render(s);
  assert.deepEqual(['v1', 'v2', 'v3', 'v4'].map(id => stemOf(four, id)), ['up', 'down', 'up', 'down']);
});

test('P5-A1 ④ 성부 하나뿐: 높은 8분음표 빔 묶음은 빔이 음표 아래에 놓인다', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('b1', [pitch(2, 0, 5)], 8), note('b2', [pitch(3, 0, 5)], 8), note('b3', [pitch(4, 0, 5)], 8), note('b4', [pitch(3, 0, 5)], 8), note('b5', [pitch(2, 0, 5)], 2)]);
  const r = render(s);
  assert.deepEqual(['b1', 'b2', 'b3', 'b4'].map(id => stemOf(r, id)), ['down', 'down', 'down', 'down']);
  const lowestHead = Math.max(...['b1', 'b2', 'b3', 'b4'].map(id => r.layout.eventsById.get(id).noteheads[0].y));
  const beams = beamY(r.svg);
  assert.ok(beams.length >= 1);
  for (const [y1, y2] of beams) assert.ok(y1 > lowestHead && y2 > lowestHead, `빔(${y1}, ${y2})이 가장 낮은 음표 머리(${lowestHead}) 아래에 있어야 한다`);
});

test('P5-A1 ⑤ 사람이 고른 기둥 방향(위·아래)은 그대로 존중한다', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('mu', [pitch(0, 0, 5)], 2, { stemDirection: 'up' }), note('md', [pitch(0, 0, 4)], 2, { stemDirection: 'down' })]);
  const r = render(s);
  assert.equal(stemOf(r, 'mu'), 'up');
  assert.equal(stemOf(r, 'md'), 'down');
  // 자동으로 되돌리면 다시 음높이를 따른다
  delete s.parts[0].staves[0].measures[0].voices[0][0].stemDirection;
  C.invalidate(s, { keepNormalized: true });
  assert.equal(stemOf(render(s), 'mu'), 'down');
});

test('P5-A1 성부 둘 중 하나가 비어 있으면(쉼표뿐) 한 성부로 본다 — 2성부에만 음이 있어도 음높이로', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [restEv('v1rest', 1, 1)]);
  measure(s, 0, [note('only2', [pitch(2, 0, 4)], 1, { voice: 2 })], 2);
  const r = render(s);
  assert.equal(r.layout.eventsById.get('only2').multiVoice, false);
  assert.equal(stemOf(r, 'only2'), 'up', '낮은 음이라 위로(예전에는 2성부라서 항상 아래)');
});

test('P5-A1 2성부 마디의 빔은 성부 방향을 지킨다 — 1성부 빔 위, 2성부 빔 아래', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('u1', [pitch(4, 0, 5)], 8), note('u2', [pitch(5, 0, 5)], 8), note('u3', [pitch(4, 0, 5)], 8), note('u4', [pitch(2, 0, 5)], 8), note('u5', [pitch(2, 0, 5)], 2)]);
  measure(s, 0, [note('d1', [pitch(0, 0, 4)], 8, { voice: 2 }), note('d2', [pitch(1, 0, 4)], 8, { voice: 2 }), note('d3', [pitch(0, 0, 4)], 8, { voice: 2 }), note('d4', [pitch(2, 0, 4)], 8, { voice: 2 }), note('d5', [pitch(0, 0, 4)], 2, { voice: 2 })], 2);
  const r = render(s);
  assert.deepEqual(['u1', 'u2', 'u3', 'u4'].map(id => stemOf(r, id)), ['up', 'up', 'up', 'up']);
  assert.deepEqual(['d1', 'd2', 'd3', 'd4'].map(id => stemOf(r, id)), ['down', 'down', 'down', 'down']);
});

test('P5-A1 드럼 기둥은 바뀌지 않는다 — 성부 규칙 그대로(1성부 위)', () => {
  const s = C.createScore({ measureCount: 1, parts: ['drumkit'] });
  const drum = (id, drumId, staffLine) => ({ id, type: 'note', notes: [], drumId, midi: drumId === 'kick' ? 36 : 38, staffLine, voice: 1, dur: { n: 1, d: 4, dots: 0 } });
  measure(s, 0, [drum('k', 'kick', 0), drum('sn', 'snare', 4), drum('k2', 'kick', 0), drum('sn2', 'snare', 4)]);
  const r = render(s);
  const stems = [...r.svg.matchAll(/<line class="stem" x1="([\d.-]+)" y1="([\d.-]+)" x2="[\d.-]+" y2="([\d.-]+)"/g)].map(m => ({ x: +m[1], up: +m[3] < +m[2] }));
  assert.equal(stems.length, 4);
  assert.ok(stems.every(stem => stem.up), '드럼 기둥은 모두 위로');
  for (const id of ['k', 'sn', 'k2', 'sn2']) {
    const le = r.layout.eventsById.get(id);
    assert.ok(stems.some(stem => Math.abs(stem.x - (le.x + 4.8)) < 0.01), `${id}: 기둥이 머리 오른쪽(+4.8)에 붙는다`);
  }
});

test('P5-A1 성부 하나뿐인 높은 음의 슬러·타이는 음표 위쪽(기둥 반대쪽)에 그려진다', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('s1', [pitch(4, 0, 5)], 4), note('s2', [pitch(5, 0, 5)], 4), note('t1', [{ ...pitch(2, 0, 5), tie: true }], 4), note('t2', [pitch(2, 0, 5)], 4)]);
  s.spanners = [{ id: 'sl', type: 'slur', startId: 's1', endId: 's2' }];
  const r = render(s);
  const slur = r.svg.match(/class="slur" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/), tie = r.svg.match(/class="tie" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/);
  assert.ok(slur && tie);
  assert.equal(stemOf(r, 's1'), 'down');
  assert.ok(+slur[4] < +slur[2], '슬러는 음표 위(기둥이 아래이므로)');
  assert.ok(+tie[4] < +tie[2], '타이는 음표 위(기둥 반대쪽)');
});

test('P5-A1 드럼 빔 묶음의 기둥도 바뀌지 않는다 — 성부 규칙 그대로(위)', () => {
  const s = C.createScore({ measureCount: 1, parts: ['drumkit'] });
  const drum = (id, drumId, staffLine, d = 8) => ({ id, type: 'note', notes: [], drumId, midi: drumId === 'kick' ? 36 : 38, staffLine, voice: 1, dur: { n: 1, d, dots: 0 } });
  measure(s, 0, [drum('hb1', 'snare', 4), drum('hb2', 'snare', 4), drum('hb3', 'snare', 4), drum('hb4', 'snare', 4), drum('hb5', 'kick', 0, 2)]);
  const r = render(s);
  assert.match(r.svg, /class="beam"/);
  const stems = [...r.svg.matchAll(/<line class="stem" x1="[\d.-]+" y1="([\d.-]+)" x2="[\d.-]+" y2="([\d.-]+)"/g)].map(m => +m[2] < +m[1]);
  assert.equal(stems.length, 5);
  assert.ok(stems.every(Boolean), '드럼 기둥은 빔 묶음 안에서도 모두 위로');
});

test('P5-A1 TAB 빔 묶음의 기둥도 바뀌지 않는다 — 높은 음이어도 위(성부 규칙)', () => {
  const s = C.createScore({ measureCount: 1, parts: ['guitar-tab'] });
  const tabRef = C.staffRefs(s).find(ref => ref.staff?.staffType === 'tab');
  assert.ok(tabRef, 'guitar-tab 파트에는 TAB 보표가 있다');
  const tabNote = (id, p, string, fret, d = 8) => ({ id, type: 'note', notes: [p], tab: { string, fret }, voice: 1, dur: { n: 1, d, dots: 0 } });
  measure(s, 0, [tabNote('tb1', pitch(4, 0, 5), 1, 15), tabNote('tb2', pitch(5, 0, 5), 1, 17), tabNote('tb3', pitch(4, 0, 5), 1, 15), tabNote('tb4', pitch(2, 0, 5), 1, 12), tabNote('tb5', pitch(2, 0, 5), 1, 12, 2)], 1, tabRef);
  const r = render(s);
  const stems = [...r.svg.matchAll(/<line class="stem tab-stem" x1="[\d.-]+" y1="([\d.-]+)" x2="[\d.-]+" y2="([\d.-]+)"/g)].map(m => +m[2] < +m[1]);
  assert.equal(stems.length, 5);
  assert.ok(stems.every(Boolean), 'TAB 기둥은 모두 위로');
});

test('P5-A1 빔 묶음 안에서는 음마다 계산한 방향이 아니라 묶음의 방향을 따른다 — 타이·슬러도 그 반대쪽', () => {
  // G4 G4 F5 F5: 평균이 가운데 줄(B4) 위 → 묶음은 아래. 낮은 G4도 묶음을 따라 기둥이 아래로 가므로 타이·슬러는 위로 휜다.
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('g1', [{ ...pitch(4, 0, 4), tie: true }], 8), note('g2', [pitch(4, 0, 4)], 8), note('g3', [pitch(3, 0, 5)], 8), note('g4', [pitch(3, 0, 5)], 8), note('g5', [pitch(2, 0, 5)], 2)]);
  const r = render(s);
  assert.deepEqual(['g1', 'g2', 'g3', 'g4'].map(id => stemOf(r, id)), ['down', 'down', 'down', 'down']);
  const tie = r.svg.match(/class="tie" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/);
  assert.ok(tie, 'g1→g2 타이가 그려진다');
  assert.ok(+tie[4] < +tie[2], '묶음 기둥이 아래이므로 타이는 위로');
  s.spanners = [{ id: 'sl', type: 'slur', startId: 'g1', endId: 'g2' }];
  const withSlur = render(s);
  const slur = withSlur.svg.match(/class="slur" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/);
  assert.ok(slur);
  assert.ok(+slur[4] < +slur[2], '묶음 기둥이 아래이므로 슬러도 위로');
});

test('P5-A1 옥타바 구간의 빔 묶음도 화면에 보이는 높이로 방향을 정한다', () => {
  // 모델 음높이 G5·A5를 8va로 쓰면 화면에는 G4·A4(가운데 줄 아래)로 보인다 → 기둥은 위.
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('o1', [pitch(4, 0, 5)], 8), note('o2', [pitch(5, 0, 5)], 8), note('o3', [pitch(4, 0, 5)], 8), note('o4', [pitch(5, 0, 5)], 8), note('o5', [pitch(4, 0, 5)], 2)]);
  s.spanners = [{ id: 'oct', type: 'ottava', startId: 'o1', endId: 'o5', shift: 12 }];
  const r = render(s);
  assert.equal(r.layout.eventsById.get('o1').ottavaSteps, 7);
  assert.deepEqual(['o1', 'o2', 'o3', 'o4', 'o5'].map(id => stemOf(r, id)), ['up', 'up', 'up', 'up', 'up']);
});

test('P5-A1 슬러가 비켜 가는 기둥 끝도 실제로 그린 방향을 따른다 — 기둥이 반대쪽이면 기둥 길이만큼 더 띄우지 않는다', () => {
  // 가운데 음(A5)의 기둥만 위/아래로 바꿔 슬러 높이를 비교한다. 슬러는 위(양 끝 기둥이 아래이므로).
  const slurHeight = middleStem => {
    const s = C.createScore({ measureCount: 1 });
    measure(s, 0, [note('c1', [pitch(2, 0, 5)], 4, { stemDirection: 'down' }), note('c2', [pitch(5, 0, 5)], 4, { stemDirection: middleStem }),
      note('c3', [pitch(2, 0, 5)], 4, { stemDirection: 'down' }), note('c4', [pitch(2, 0, 5)], 4, { stemDirection: 'down' })]);
    s.spanners = [{ id: 'sl', type: 'slur', startId: 'c1', endId: 'c3' }];
    const m = render(s).svg.match(/class="slur" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/);
    assert.ok(m);
    assert.ok(+m[4] < +m[2], '슬러는 위');
    return +m[2] - +m[4];
  };
  const down = slurHeight('down'), up = slurHeight('up');
  assert.ok(up - down > 20, `기둥이 위로 솟은 가운데 음은 비켜 가려고 슬러가 더 높아야 한다 (down=${down.toFixed(1)}, up=${up.toFixed(1)})`);
});

test('P5-A1 성부 수는 보표마다 따로 센다 — 오른손이 2성부여도 왼손이 한 성부면 왼손은 음높이로', () => {
  const s = C.createScore({ measureCount: 1, parts: ['piano'] });
  const [right, left] = C.staffRefs(s);
  measure(s, 0, [note('r1', [pitch(0, 0, 5)], 1)], 1, right);               // 오른손 1성부(높은 음이지만 2성부가 있으니 위)
  measure(s, 0, [note('r2', [pitch(4, 0, 4)], 1, { voice: 2 })], 2, right);  // 오른손 2성부
  measure(s, 0, [note('l1', [pitch(0, 0, 4)], 1), ], 1, left);               // 왼손: 베이스 보표에서 C4는 가운데 줄(D3) 위 → 아래
  const r = render(s);
  assert.equal(stemOf(r, 'r1'), 'up');
  assert.equal(stemOf(r, 'r2'), 'down');
  assert.equal(stemOf(r, 'l1'), 'down');
  assert.equal(r.layout.eventsById.get('r1').multiVoice, true);
  assert.equal(r.layout.eventsById.get('l1').multiVoice, false);
});

test('P5-A1 TAB 보표의 타이는 예전처럼 성부 규칙(위 기둥 → 아래로 휨)을 따른다', () => {
  const s = C.createScore({ measureCount: 1, parts: ['guitar-tab'] });
  const tabRef = C.staffRefs(s).find(ref => ref.staff?.staffType === 'tab');
  const tabNote = (id, p, d = 4) => ({ id, type: 'note', notes: [p], tab: { string: 1, fret: 15 }, voice: 1, dur: { n: 1, d, dots: 0 } });
  measure(s, 0, [tabNote('tt1', { ...pitch(4, 0, 5), tie: true }), tabNote('tt2', pitch(4, 0, 5), 2), tabNote('tt3', pitch(4, 0, 5), 4)], 1, tabRef);
  const tie = render(s).svg.match(/class="tie" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+)/);
  assert.ok(tie);
  assert.ok(+tie[4] > +tie[2], 'TAB 기둥은 항상 위이므로 타이는 아래로(음높이와 무관)');
});

test('P5-A1 경계: 가운데 줄 위의 음은 아래로, 그 바로 아래 칸은 위로, 평균이 가운데 줄인 화음은 아래로', () => {
  const s = C.createScore({ measureCount: 1 });
  measure(s, 0, [note('mid', [pitch(6, 0, 4)], 4), note('below', [pitch(5, 0, 4)], 4), note('above', [pitch(0, 0, 5)], 4), note('chord', [pitch(4, 0, 4), pitch(1, 0, 5)], 4)]);
  const r = render(s);
  assert.deepEqual(['mid', 'below', 'above', 'chord'].map(id => stemOf(r, id)), ['down', 'up', 'down', 'down']);
});
