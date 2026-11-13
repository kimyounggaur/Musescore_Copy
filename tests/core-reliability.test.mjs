import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
const { core: C, F } = SF;
const quarter = { n: 1, d: 4 };
const pitch = { step: 2, alter: 0, oct: 3 };
const json = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const score = C.createScore({ measureCount: 1 });
  C.inputAt(score, 0, F(0), quarter, [pitch]);
  return json(C.toJSON(score));
}
const first = score => score.parts[0].staves[0].measures[0].voices[0][0];

test('untrusted imports reject invalid pitches, durations, meters, tempos and short measures', () => {
  for (const corrupt of [
    s => { first(s).dur.n = -1; },
    s => { s.timeSig = { num: 0, den: 4 }; },
    s => { s.timeSig = { num: 4, den: 0 }; },
    s => { first(s).notes = []; },
    s => { first(s).notes[0].oct = 15; },
    s => { first(s).notes[0].alter = 0.5; },
    s => { first(s).tempo = '<img src=x onerror=alert(1)>'; },
    s => { s.tempo = '100'; },
    s => { s.parts[0].staves[0].measures[0].voices[0].pop(); },
    s => { first(s).type = 'script'; },
    s => { s.parts[0].staves[0].measures[0].voices[0][1].id = first(s).id; },
  ]) {
    const score = fixture(); corrupt(score);
    assert.throws(() => C.fromJSON(score), /악보를 열 수 없습니다/);
  }
  assert.equal(C.fromJSON(fixture()).measures.length, 1);
});

test('compact saves have one canonical staff copy, no empty voices or render fields', () => {
  const score = C.createScore({ measureCount: 32, ensemble: 'string-quartet' });
  for (const ref of C.staffRefs(score)) for (let m = 0; m < 32; m++) for (let e = 0; e < 8; e++) {
    C.inputAt(score, m, F(e, 8), { n: 1, d: 8 }, [pitch], ref);
  }
  score.measures[0].events[0].__acc = ['#'];
  const compact = json(C.toJSON(score));
  assert.equal(compact.format, 'scoreforge-2');
  assert.equal(compact.measures, undefined);
  assert.equal(compact.parts[0].staves[0].measures[0].events, undefined);
  assert.equal(compact.parts[0].staves[0].measures[0].voices.length, 1);
  assert.equal(first(compact).__acc, undefined);
  const restored = C.fromJSON(compact);
  assert.equal(C.staffRefs(restored).length, 4);
  assert.equal(restored.measures[0].voices.length, 4);
  assert.deepEqual(json(C.toJSON(restored)), compact);
});

test('legacy files still open and exported compact files retain lyrics and local signatures', () => {
  const legacy = { timeSig: { num: 3, den: 4 }, measures: [{ events: [
    { id: 'legacy-note', type: 'note', dur: { n: 1, d: 4 }, notes: [pitch], lyric: '나' },
    { id: 'legacy-rest', type: 'rest', dur: { n: 1, d: 2 }, notes: [] },
  ] }] };
  const restored = C.fromJSON(json(C.toJSON(C.fromJSON(legacy))));
  assert.equal(restored.measures[0].events[0].lyric, '나');
  assert.equal(C.timeSigAt(restored, 0).num, 3);
});

test('transposition moves chord roots and slash bass, preserves interval spelling, and refreshes diagrams', () => {
  const score = C.createScore({ measureCount: 1 });
  const id = C.inputAt(score, 0, F(0), quarter, [{ step: 1, alter: 1, oct: 4 }]);
  const ev = C.findEvent(score, id).ev;
  ev.chordSymbol = C.parseChordSymbol('C/E'); ev.fretboard = C.getDefaultFretboard('C');
  C.transposeScore(score, 2);
  assert.equal(ev.chordSymbol.normalized, 'D/F#');
  assert.deepEqual(ev.notes[0], { step: 2, alter: 1, oct: 4, tie: false });
  assert.deepEqual(ev.fretboard.positions, C.getDefaultFretboard('D').positions);
  C.transposeScore(score, -2);
  assert.equal(ev.chordSymbol.normalized, 'C/E');
  assert.equal(C.midiOf(ev.notes[0]), 63);
  assert.notDeepEqual(C.getDefaultFretboard('F#').positions, C.getDefaultFretboard('F').positions);
  assert.equal(C.getDefaultFretboard('F#unknown'), null);
});

test('linked TAB derives pitch and deletion from standard staff, follows TAB edits and saves only its source', () => {
  C.setScore(C.createScore({ ensemble: 'guitar-tab', measureCount: 1 }));
  let id;
  C.mutate('input', score => { id = C.inputAt(score, 0, F(0), quarter, [pitch]); });
  let score = C.state.score, source = score.parts[0].staves[0], tab = score.parts[0].staves[1];
  let tabEv = tab.measures[0].events[0];
  assert.equal(C.midiOf(tabEv.notes[0]), C.midiOf(source.measures[0].events[0].notes[0]));
  C.mutate('source pitch', score => C.transposeNote(score, id, 0, 3));
  tab = C.state.score.parts[0].staves[1]; tabEv = tab.measures[0].events[0];
  assert.equal(C.midiOf(tabEv.notes[0]), 55);
  C.mutate('TAB pitch', score => C.transposeNote(score, tabEv.id, 0, 2));
  assert.equal(C.midiOf(C.state.score.measures[0].events[0].notes[0]), 57);
  const payload = json(C.toJSON(C.state.score));
  assert.equal(payload.parts[0].staves[1].measures, undefined);
  assert.equal(payload.parts[0].staves[1].derivedFrom, source.id);
  C.setScore(payload);
  C.mutate('delete', score => C.deleteEvents(score, [score.measures[0].events[0].id]));
  assert.ok(C.state.score.parts[0].staves.every(st => st.measures[0].events.every(ev => ev.type === 'rest')));
  assert.ok(C.undo());
  assert.equal(C.midiOf(C.state.score.parts[0].staves[1].measures[0].events[0].notes[0]), 57);
});

test('bulk deletion consolidates each touched voice and undo restores every onset', () => {
  C.setScore(C.createScore({ measureCount: 8, ensemble: 'piano' }));
  C.mutate('populate', score => { for (const ref of C.staffRefs(score)) for (let m = 0; m < 8; m++) for (let e = 0; e < 4; e++) C.inputAt(score, m, F(e, 4), quarter, [pitch], ref); });
  const before = json(C.toJSON(C.state.score)), ids = [];
  C.forEachEvent(C.state.score, ev => { if (ev.type === 'note') ids.push(ev.id); });
  C.mutate('delete selection', score => assert.equal(C.deleteEvents(score, ids), 64));
  assert.ok(C.staffRefs(C.state.score).every(ref => ref.measures.every(mm => mm.events.length === 1 && mm.events[0].type === 'rest')));
  C.undo(); assert.deepEqual(json(C.toJSON(C.state.score)), before);
});


test('history caps retained snapshot memory as score size grows and keeps undo/redo reversible', () => {
  const score = C.createScore({ measureCount: 1 });
  // A long staff-text score exercises the same byte budget with fewer events.
  for (const ev of score.measures[0].voices[0]) ev.staffText = '가'.repeat(4000);
  score.meta.notes = Array.from({ length: 25 }, () => 'x'.repeat(19000));
  C.setScore(score);
  for (let i = 0; i < 20; i++) C.mutate('title ' + i, s => { s.meta.title = 'Title ' + i; });
  const info = C.historyInfo();
  assert.ok(info.undo < 20 && info.undo > 1);
  assert.ok(info.bytes <= info.budget);
  assert.equal(C.state.score.meta.title, 'Title 19');
  C.undo(); assert.equal(C.state.score.meta.title, 'Title 18');
  C.redo(); assert.equal(C.state.score.meta.title, 'Title 19');
});
