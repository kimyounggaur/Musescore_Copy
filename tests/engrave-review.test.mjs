import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ console, setTimeout, clearTimeout });
context.window = context;
context.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const name of ['core', 'engrave']) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context);
const { core: C, engrave: E } = context.SF;
const pitch = (step = 0, oct = 4, alter = 0) => ({ step, oct, alter });
const note = (id, n, d = 4, voice = 1) => ({ id, type: 'note', notes: [n], dur: { n: 1, d, dots: 0 }, voice });
function put(score, ref, voice, events) {
  C.ensureMeasureVoices(ref.measures[0], score, 0)[voice - 1] = events;
  C.invalidate(score, { keepNormalized: true });
}
function stem(svg, id) {
  const event = svg.slice(svg.indexOf(`data-ref="${id}"`));
  const match = event.match(/class="stem" x1="[^"]+" y1="([\d.-]+)" x2="[^"]+" y2="([\d.-]+)"/);
  assert.ok(match, `stem for ${id}`);
  return Math.sign(+match[2] - +match[1]); // +1 points down
}

test('single voice stems follow the middle staff line for treble and bass; polyphony keeps voice sides', () => {
  for (const [clef, low, middle] of [['treble', pitch(0), pitch(6)], ['bass', pitch(0, 3), pitch(1, 3)]]) {
    const s = C.createScore({ measureCount: 1, clef });
    const ref = C.staffRefs(s)[0];
    put(s, ref, 1, [note('low', low), note('middle', middle)]);
    let rendered = E.render(s, { fallback: true });
    assert.equal(stem(rendered.svg, 'low'), -1);
    assert.equal(stem(rendered.svg, 'middle'), 1);
    put(s, ref, 2, [note('second-voice', low, 2, 2)]);
    rendered = E.render(s, { fallback: true });
    assert.equal(stem(rendered.svg, 'middle'), -1);
    assert.equal(stem(rendered.svg, 'second-voice'), 1);
  }
});

test('double accidentals render their own symbols and computed accidentals never serialize', async () => {
  const s = C.createScore({ measureCount: 1 });
  const notes = [note('double-up', pitch(0, 4, 2)), note('double-down', pitch(1, 4, -2))];
  put(s, C.staffRefs(s)[0], 1, notes);
  E.render(s, { fallback: true });
  assert.deepEqual(notes.map(ev => ev.notes[0].__acc), ['doubleSharp', 'doubleFlat']);
  assert.doesNotMatch(JSON.stringify(s), /__acc/);
  const output = await E.renderForExport(s);
  assert.match(output.svg, /href="#sf-bv-0-57955"/); // SMuFL accidentalDoubleSharp E263
  assert.match(output.svg, /href="#sf-bv-0-57956"/); // SMuFL accidentalDoubleFlat E264
});

test('shared rhythmic spacing keeps eight equal notes evenly spaced over two half notes', () => {
  const s = C.createScore({ measureCount: 1, ensemble: 'piano' });
  const refs = C.staffRefs(s);
  put(s, refs[0], 1, Array.from({ length: 8 }, (_, i) => note(`eighth-${i}`, pitch(), 8)));
  put(s, refs[1], 1, [note('bass-a', pitch(0, 3), 2), note('bass-b', pitch(0, 3), 2)]);
  const rendered = E.render(s, { fallback: true });
  const xs = Array.from({ length: 8 }, (_, i) => rendered.layout.eventsById.get(`eighth-${i}`).x);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1e-8, gaps.join(', '));
  assert.equal(rendered.layout.eventsById.get('bass-a').x, xs[0]);
  assert.equal(rendered.layout.eventsById.get('bass-b').x, xs[4]);
});

test('export outlines are exact Bravura symbols, deduplicated and self-contained on each page', async () => {
  const s = C.createScore({ measureCount: 2 });
  for (let m = 0; m < 2; m++) {
    const ref = C.staffRefs(s)[0];
    const events = [note(`page-${m}-a`, pitch()), note(`page-${m}-b`, pitch(2))];
    events[0].dynamic = 'mf';
    C.ensureMeasureVoices(ref.measures[m], s, m)[0] = events;
  }
  s.measures[0].breakType = 'page';
  const output = await E.renderForExport(s);
  assert.equal(output.pages.length, 2);
  for (const [page, svg] of output.pages.entries()) {
    assert.doesNotMatch(svg, /data:font|@font-face|font-family="BravuraSF"|[\uE000-\uF8FF]/);
    assert.ok(svg.length < 50000, `simple export is ${svg.length} bytes`);
    const ids = [...svg.matchAll(/<path id="(sf-bv-[^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size);
    assert.ok(ids.includes(`sf-bv-${page}-57424`)); // G clef E050
    assert.ok(ids.includes(`sf-bv-${page}-57476`)); // timeSig4 E084
    for (const match of svg.matchAll(/href="#(sf-bv-[^"]+)"/g)) assert.ok(ids.includes(match[1]), `${match[1]} has an outline`);
    assert.match(svg, /<path id="sf-bv-\d+-57424" d="M/);
  }
});

test('render emits one small note pointer target for each ordinary, chord, drum and TAB notehead', () => {
  for (const ensemble of ['solo', 'drums', 'guitar-tab']) {
    const s = C.createScore({ measureCount: 1, ensemble });
    const ref = C.staffRefs(s)[0];
    put(s, ref, 1, [note('target', pitch())]);
    const rendered = E.render(s, { fallback: true });
    const expected = [...rendered.layout.eventsById.values()].reduce((n, le) => n + le.noteheads.length, 0);
    assert.equal((rendered.svg.match(/class="note-hit"/g) || []).length, expected);
  }
});

test('cached rendering reuses unaffected systems while keeping notehead hit geometry and exports correct', async () => {
  const s = C.createScore({ measureCount: 8 });
  s.layout.measuresPerSystem = 2;
  const ref = C.staffRefs(s)[0];
  for (let m = 0; m < 8; m++) C.ensureMeasureVoices(ref.measures[m], s, m)[0] =
    [note(`s-${m}-a`, pitch(0), 2), note(`s-${m}-b`, pitch(2), 2)];
  C.invalidate(s, { keepNormalized: true });
  const first = E.render(s, { fallback: true, cache: true });
  assert.equal(first.stats.systemsReused, 0);
  ref.measures[2].voices[0][0].notes[0].step = 1;
  C.invalidate(s, { keepNormalized: true });
  const changed = E.render(s, { fallback: true, cache: true });
  assert.ok(changed.stats.systemsReused > 0);
  assert.equal(changed.stats.systemsRendered, 1);
  for (const le of changed.layout.eventsById.values()) {
    assert.equal(le.noteheads.length, 1);
    const head = le.noteheads[0];
    assert.equal(E.hitTest(head.x, head.y).le.id, le.id);
  }
  const fresh = E.render(s, { fallback: true });
  assert.equal(changed.svg, fresh.svg);
  const exported = await E.renderForExport(s);
  assert.match(exported.svg, /<defs>/);
  assert.equal(E.getLayout(), fresh.layout);
  s.style.stemWidth = 2;
  const restyled = E.render(s, { fallback: true, cache: true });
  assert.equal(restyled.stats.systemsReused, 0);
});

test('measure tick calculations are bounded per staff/measure rather than multiplied by page count', () => {
  const s = C.createScore({ measureCount: 12, ensemble: 'string-quartet' });
  s.layout.measuresPerSystem = 1;
  for (const ref of C.staffRefs(s)) for (let m = 0; m < 12; m++) {
    C.ensureMeasureVoices(ref.measures[m], s, m)[0] = [note(`ticks-${ref.globalIdx}-${m}`, pitch(), 1)];
    if (m) s.measures[m].breakType = 'page';
  }
  C.invalidate(s, { keepNormalized: true });
  const original = C.measureEntries;
  let calls = 0;
  C.measureEntries = (...args) => { calls++; return original(...args); };
  try {
    const rendered = E.render(s, { fallback: true });
    assert.equal(rendered.pages.length, 1); // continuous SVG still carries 12 logical pages
    assert.ok(rendered.layout.pages.length >= 10);
    assert.ok(calls <= 2 * 12 * 4, `measured ${calls} tick calculations`);
  } finally { C.measureEntries = original; }
});
