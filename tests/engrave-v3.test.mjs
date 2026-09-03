import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The renderer has no IO/playback dependency. Keep this regression suite usable
// while those independently owned modules are being edited.
const context = vm.createContext({ console, setTimeout, clearTimeout });
context.window = context;
context.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const name of ['core', 'engrave']) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context, { filename: `${name}.js` });
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
