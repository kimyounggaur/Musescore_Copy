import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Intentionally load only the owned domain module. No DOM shim or concurrent
// renderer/importer edits are necessary to exercise these regressions.
globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../js/core.js', import.meta.url), 'utf8'), { filename: 'core.js' });
const { core: C, F, Fraction } = globalThis.SF;
const pitch = (step = 0, oct = 4, alter = 0) => ({ step, oct, alter });
const quarter = { n: 1, d: 4, dots: 0 };
const clone = value => JSON.parse(JSON.stringify(value));
function invariant(score) {
  for (const ref of C.staffRefs(score)) for (const [m, mm] of ref.measures.entries()) {
    assert.equal(mm.events, mm.voices[0]);
    for (let voice = 1; voice <= 4; voice++) {
      const events = C.getVoiceEvents(mm, voice, score);
      assert.ok(events.every(ev => C.durValue(ev.dur).n > 0), `positive durations ${m}:${voice}`);
      assert.ok(events.reduce((sum, ev) => sum.add(C.durValue(ev.dur)), F(0)).eq(C.measureLenAt(score, m)), `voice length ${ref.globalIdx}:${m}:${voice}`);
    }
  }
}
function sequence(score, ctx = {}) {
  const ref = C.staffRef(score, ctx), voice = ctx.voice || 1;
  return ref.measures.flatMap((mm, m) => {
    let pos = C.measureStarts(score)[m];
    return C.getVoiceEvents(mm, voice, score).flatMap(ev => {
      const start = pos; pos = pos.add(C.durValue(ev.dur));
      return ev.type === 'note' ? [{ id: ev.id, start: start.toString(), duration: C.durValue(ev.dur).toString(), notes: clone(ev.notes) }] : [];
    });
  });
}

test('extended durations, dot limits and arbitrary rationals stay exact', () => {
  assert.deepEqual(C.BASES.map(b => `${b.n}/${b.d}`), ['2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64']);
  assert.ok(C.durValue({ ...quarter, dots: 2 }).eq(F(7, 16)));
  assert.deepEqual(C.decompose(F(0), F(7, 32)), [{ n: 1, d: 8, dots: 1 }, { n: 1, d: 32, dots: 0 }]);
  assert.deepEqual([64, 32, 16, 4].map(d => C.maxDots({ n: 1, d })), [0, 1, 2, 2]);
  assert.ok(C.decompose(F(0), F(3, 128)).every(dur => (dur.dots || 0) <= C.maxDots(dur)));
  for (const [start, len] of [[F(1, 15), F(1, 120)], [F(0), F(1, 7)], [F(1, 3), F(5, 21)], [F(0), F(1025)], [F(0), F(1, 128)]]) {
    const ds = C.decompose(start, len);
    assert.ok(ds.reduce((s, d) => s.add(C.durValue(d)), F(0)).eq(len));
    assert.ok(ds.every(d => C.durValue(d).lte(len)));
  }
  assert.throws(() => F(NaN));
  assert.ok(Fraction.from({ n: 3, d: 8 }).eq(Fraction.from([3, 8])));
});

test('events getter/setter and serialized legacy aliases remain compatible', () => {
  const score = C.createScore({ measureCount: 1 });
  const mm = score.measures[0], desc = Object.getOwnPropertyDescriptor(mm, 'events');
  assert.equal(desc.enumerable, false);
  const oldId = mm.events[0].id;
  C.findEvent(score, oldId);
  const rest = C.fullRest(score);
  mm.events = [rest];
  assert.equal(mm.voices[0][0], rest);
  assert.equal(C.findEvent(score, oldId), null);
  assert.equal(C.findEvent(score, rest.id).ev, rest);
  mm.voices[0] = [{ ...rest, id: C.newId() }]; C.invalidate(score);
  assert.equal(mm.events, mm.voices[0]);
  assert.equal(JSON.stringify(mm).includes('"events"'), false);
  const saved = C.toJSON(score);
  assert.deepEqual(saved.measures[0].events, saved.measures[0].voices[0]);
  assert.equal(JSON.stringify(saved).includes('__cache'), false);
  const legacy = { timeSig: { num: 3, den: 4 }, keySig: 0, measures: [{ events: [{ id: 'e900000', type: 'rest', dur: { n: 3, d: 4 }, notes: [] }] }] };
  const loaded = C.fromJSON(legacy);
  assert.equal(C.findEvent(loaded, 'e900000').voice, 1);
  assert.equal(new Set(C.eventOrderMap(loaded).keys()).size, 4);
  invariant(loaded);
});

test('cached references/index/order are reused and edits invalidate inside mutate', () => {
  C.setScore(C.createScore({ measureCount: 2, ensemble: 'piano' }));
  let id;
  C.mutate('two edits', score => {
    const refs = C.staffRefs(score), order = C.eventOrderMap(score), index = C.eventIndex(score);
    assert.equal(C.staffRefs(score), refs);
    assert.equal(C.eventOrderMap(score), order);
    assert.equal(C.eventIndex(score), index);
    id = C.inputAt(score, 0, F(0), quarter, [pitch()]);
    assert.ok(C.findEvent(score, id));
    assert.notEqual(C.eventOrderMap(score), order);
    C.insertMeasures(score, 0, 1);
    assert.equal(C.findEvent(score, id).m, 1);
    C.deleteMeasures(score, 0, 0);
    assert.equal(C.findEvent(score, id).m, 0);
    C.reinputWithDur(score, id, { n: 1, d: 8 });
    assert.equal(C.findEvent(score, id), null);
  });
  assert.ok(C.undo()); assert.equal(C.findEvent(C.state.score, id), null);
  assert.ok(C.redo()); invariant(C.state.score);
});

test('saved content, revision tokens, autosave and labeled coalescing are separate', () => {
  C.setScore(C.createScore({ measureCount: 1 }));
  const initialRev = C.state.revision;
  for (const tempo of [110, 120, 130]) C.mutate(`tempo ${tempo}`, s => { s.tempo = tempo; }, { coalesce: 'tempo' });
  assert.equal(C.state.revision, initialRev + 3);
  assert.equal(C.undoLabel(), 'tempo 130');
  assert.equal(C.state.dirty, true);
  assert.equal(C.markAutosaved(initialRev), false);
  assert.equal(C.markAutosaved(), true);
  assert.equal(C.isAutosaved(), true); assert.equal(C.state.dirty, true);
  assert.equal(C.markSaved(initialRev), false);
  assert.ok(C.undo()); assert.equal(C.state.score.tempo, 100); assert.equal(C.state.dirty, false);
  assert.equal(C.isAutosaved(), false); assert.equal(C.redoLabel(), 'tempo 130');
  assert.ok(C.redo()); assert.equal(C.state.score.tempo, 130);
  assert.equal(C.markSaved(), true); assert.equal(C.state.dirty, false);
  C.mutate('tempo 140', s => { s.tempo = 140; }, { coalesce: 'tempo' });
  assert.ok(C.undo()); assert.equal(C.state.score.tempo, 130); assert.equal(C.state.dirty, false);
  assert.ok(C.redo()); assert.equal(C.state.score.tempo, 140); assert.equal(C.state.dirty, true);
  assert.equal(C.state.rev, C.state.revision);
});

test('failed mutations roll back without poisoning history or revisions', () => {
  C.setScore(C.createScore({ measureCount: 1 }));
  const before = C.toJSON(C.state.score), rev = C.state.revision;
  assert.throws(() => C.mutate('bad edit', s => { s.tempo = 250; C.appendMeasures(s); throw new Error('cancel'); }));
  assert.deepEqual(C.toJSON(C.state.score), before);
  assert.equal(C.state.revision, rev); assert.equal(C.canUndo(), false); assert.equal(C.state.dirty, false);
});

const decor = {
  lyric: 'la', lyrics: [{ verse: 1, text: 'la' }], dynamic: 'p', artics: ['tenuto'], tempo: 112,
  rehearsal: 'A', staffText: 'pizz.', soundFlag: 'pizzicato', chordSymbol: { raw: 'Cm7' },
  fretboard: { positions: [0, 2, 2, 0] }, graceBefore: [{ id: 'grace', notes: [pitch(1)] }],
  tab: { string: 2, fret: 3 }, glissando: true, arpeggiate: true, tremolo: 2, hidden: true, color: '#123456',
  offsetX: 0, offsetY: -4, stemDirection: 'down', notehead: 'x', small: true, velocityOffset: 0,
  drumId: 'snare', midi: 38, staffLine: 4, displayStep: 'C', displayOctave: 5, ornament: 'trill', trillLine: true,
};
test('decor copying is deep, supports deletion/skip, and stripping leaves its source alone', () => {
  assert.deepEqual([...C.EVENT_DECOR_KEYS].sort(), Object.keys(decor).sort());
  const source = { id: 'source', type: 'note', dur: quarter, notes: [pitch()], ...clone(decor) };
  const dest = { dynamic: 'ff', color: 'red' };
  C.copyDecor(source, dest, { skip: ['color'] });
  assert.equal(dest.color, 'red'); dest.fretboard.positions[0] = 9;
  assert.equal(source.fretboard.positions[0], 0);
  C.copyDecor({}, dest, { skip: ['color'] }); assert.deepEqual(dest, { color: 'red' });
  const stripped = C.stripDecor(source);
  assert.equal(stripped.id, 'source'); assert.equal(stripped.ornament, undefined);
  assert.equal(source.ornament, 'trill'); stripped.notes[0].step = 6; assert.equal(source.notes[0].step, 0);
});

test('reinput and tuplets preserve all onset decor plus continuation instrument fields', () => {
  const s = C.createScore({ measureCount: 2 });
  const id = C.inputAt(s, 0, F(3, 4), quarter, [pitch()]);
  Object.assign(C.findEvent(s, id).ev, clone(decor));
  const end = C.inputAt(s, 1, F(1, 2), quarter, [pitch(2)]);
  s.spanners.push({ id: 'sl', type: 'slur', startId: id, endId: end });
  const replaced = C.reinputWithDur(s, C.findEvent(s, id), { n: 1, d: 2 });
  assert.deepEqual(C.pickDecor(C.findEvent(s, replaced).ev), decor);
  const continuation = s.measures[1].events[0];
  assert.equal(continuation.drumId, 'snare'); assert.equal(continuation.ornament, undefined);
  assert.equal(s.spanners[0].startId, replaced);
  const tuplets = C.makeTupletAt(s, 0, C.findEvent(s, replaced).e, 3);
  assert.deepEqual(C.pickDecor(C.findEvent(s, tuplets[0]).ev), decor);
  assert.equal(C.findEvent(s, tuplets[1]).ev.notehead, 'x');
  invariant(s);
});

test('duration reinput at the final bar extends all staves instead of truncating', () => {
  const s = C.createScore({ measureCount: 1, ensemble: 'piano' });
  const id = C.inputAt(s, 0, F(3, 4), quarter, [pitch()]);
  const next = C.reinputWithDur(s, id, { n: 2, d: 1, dots: 0 });
  assert.ok(C.staffRefs(s).every(ref => ref.measures.length === 3));
  const notes = sequence(s);
  assert.equal(notes[0].id, next);
  assert.ok(notes.reduce((sum, ev) => sum.add(F(...ev.duration.split('/').map(Number))), F(0)).eq(F(2)));
  invariant(s);
});

test('decorated rests survive consolidation and rebar', () => {
  const s = C.createScore({ measureCount: 2 });
  s.measures[0].events[0].staffText = 'start'; s.measures[0].events[0].ornament = 'turn';
  C.consolidateRests(s, 0);
  assert.equal(s.measures[0].events[0].staffText, 'start');
  C.rebar(s, { num: 3, den: 4 });
  assert.equal(s.measures[0].events[0].staffText, 'start');
  assert.equal(s.measures[0].events[0].ornament, 'turn'); invariant(s);
});

test('note edits preserve unrelated chord tones and normalize incoming/outgoing ties', () => {
  const s = C.createScore({ measureCount: 1 });
  const id = C.inputAt(s, 0, F(0), quarter, [pitch(), pitch(2), pitch(4)]);
  const second = C.inputAt(s, 0, F(1, 4), quarter, [pitch(), pitch(4)]);
  assert.equal(C.toggleNoteTie(s, id, 0), true);
  assert.equal(C.removeNoteFromChord(s, id, 1), true);
  assert.deepEqual(C.findEvent(s, id).ev.notes.map(n => n.step), [0, 4]);
  assert.equal(C.transposeNote(s, second, 0, 12), 1);
  assert.equal(C.findEvent(s, id).ev.notes[0].tie, false);
  assert.equal(C.setNoteAccidental(s, id, 1, -1), true);
  C.removeNoteFromChord(s, second, 1); C.removeNoteFromChord(s, second, 0);
  assert.equal(C.findEvent(s, second), null); invariant(s);
});

test('per-measure key/clef inheritance, resets and transpose follow local signatures', () => {
  const s = C.createScore({ measureCount: 4, ensemble: 'piano' });
  C.setMeasureKeySig(s, 2, 1); C.setMeasureKeySig(s, 3, 0);
  C.setMeasureClef(s, 2, 'alto', { partIdx: 0, staffIdx: 0 });
  assert.deepEqual([0, 1, 2, 3].map(m => C.keySigAt(s, m)), [0, 0, 1, 0]);
  const refs = C.staffRefs(s);
  assert.equal(C.clefAt(refs[0], 3), 'alto'); assert.equal(C.clefAt(refs[1], 3), 'bass');
  C.setMeasureClef(s, 2, null, refs[0]); assert.equal(C.clefAt(C.staffRefs(s)[0], 3), 'treble');
  const id = C.inputAt(s, 2, F(0), quarter, [pitch(3, 4, 1)]);
  C.transposeScore(s, 2);
  assert.equal(C.keySigAt(s, 0), 2); assert.equal(C.keySigAt(s, 2), 3);
  assert.equal(C.midiOf(C.findEvent(s, id).ev.notes[0]), 68);
  assert.throws(() => C.setMeasureKeySig(s, 0, 8)); invariant(s);
});

test('mixed meters, exact starts, inherited full rests and boundary input', () => {
  const s = C.createScore({ measureCount: 4, ensemble: 'piano' });
  C.setMeasureTimeSig(s, 2, { num: 3, den: 4 });
  assert.deepEqual(C.timeSigAt(s, 1), { num: 4, den: 4 });
  assert.deepEqual(C.timeSigAt(s, 2), { num: 3, den: 4 });
  assert.ok(C.measureLen(s, 2).eq(F(3, 4)));
  assert.ok(C.durValue(C.fullRest(s, 2).dur).eq(F(3, 4)));
  assert.deepEqual(C.measureStarts(s).map(String), ['0/1', '1/1', '2/1', '11/4', '7/2', '17/4']);
  C.inputAt(s, 1, F(3, 4), { n: 1, d: 1 }, [pitch()], { staffIdx: 1 });
  assert.ok(s.parts[0].staves[1].measures[1].events.at(-1).notes[0].tie);
  invariant(s);
});

test('rebar fromM preserves prefix, note onsets, partial-chord ties and every decoration', () => {
  const s = C.createScore({ measureCount: 4, ensemble: 'piano' });
  const id = C.inputAt(s, 2, F(0), { n: 1, d: 1 }, [pitch(), pitch(2)]);
  Object.assign(C.findEvent(s, id).ev, clone(decor));
  C.inputAt(s, 3, F(0), quarter, [pitch()]);
  C.findEvent(s, id).ev.notes[0].tie = true;
  const prefix = clone(s.measures.slice(0, 2));
  C.rebar(s, { num: 3, den: 4 }, 2);
  assert.deepEqual(clone(s.measures.slice(0, 2)), prefix);
  assert.equal(sequence(s).find(ev => ev.id === id).start, '2/1');
  assert.deepEqual(C.pickDecor(C.findEvent(s, id).ev), decor);
  assert.ok(C.findEvent(s, id).ev.notes.every(n => n.tie));
  const tail = s.measures[3].events[0];
  assert.deepEqual(tail.notes.map(n => n.tie), [true, false]);
  C.rebar(s, { num: 4, den: 4 }, 2);
  assert.deepEqual(C.pickDecor(C.findEvent(s, id).ev), decor); invariant(s);
});

test('later signatures and annotated boundaries retain exact absolute times through rebar', () => {
  const s = C.createScore({ measureCount: 5 });
  C.setMeasureKeySig(s, 3, -2); C.setMeasureClef(s, 3, 'bass');
  C.setMeasureTimeSig(s, 4, { num: 5, den: 8 });
  C.setMeasureJump(s, 2, 'DCalFine'); C.setMeasureMarker(s, 1, 'fine');
  const id = C.inputAt(s, 3, F(0), quarter, [pitch(2)]);
  C.rebar(s, { num: 3, den: 4 }, 1);
  assert.equal(sequence(s).find(e => e.id === id).start, '3/1');
  const starts = C.measureStarts(s), keyM = s.measures.findIndex(mm => mm.keySig === -2), meterM = s.measures.findIndex(mm => mm.timeSig?.num === 5);
  assert.equal(starts[keyM].toString(), '3/1'); assert.equal(starts[meterM].toString(), '4/1');
  const jumpM = s.measures.findIndex(mm => mm.jump);
  assert.equal(starts[jumpM + 1].toString(), '3/1');
  const fineM = s.measures.findIndex(mm => mm.marker === 'fine');
  assert.equal(starts[fineM + 1].toString(), '2/1');
  assert.equal(C.clefAt(C.staffRefs(s)[0], keyM), 'bass'); invariant(s);
});

test('insert/delete preserve all staff counts, anchors and surviving signature context', () => {
  const s = C.createScore({ measureCount: 8, ensemble: 'piano' });
  const a = C.inputAt(s, 0, F(0), quarter, [pitch()]), b = C.inputAt(s, 7, F(0), quarter, [pitch(2)]);
  s.spanners.push({ id: 'sl', type: 'slur', startId: a, endId: b });
  C.insertMeasures(s, 2, 2);
  assert.ok(C.staffRefs(s).every(ref => ref.measures.length === 10));
  assert.equal(C.findEvent(s, b).m, 9); assert.equal(s.spanners.length, 1);
  C.deleteMeasures(s, 1, 3);
  assert.ok(C.staffRefs(s).every(ref => ref.measures.length === 7));
  assert.equal(C.findEvent(s, b).m, 6); assert.equal(s.spanners.length, 1);
  C.setMeasureKeySig(s, 2, 3); C.setMeasureClef(s, 2, 'tenor', { staffIdx: 1 });
  C.deleteMeasures(s, 2, 2);
  assert.equal(C.keySigAt(s, 2), 3); assert.equal(C.clefAt(C.staffRefs(s)[1], 2), 'tenor');
  C.deleteMeasures(s, 0, 0); assert.equal(s.spanners.length, 0);
  C.deleteMeasures(s, 0, 999); assert.equal(s.measures.length, 1);
  assert.equal(C.removeLastMeasure(s), 0); invariant(s);
});

test('split/join use exact local lengths and preserve all voices and spanning notes', () => {
  const s = C.createScore({ measureCount: 2, ensemble: 'piano' });
  const id = C.inputAt(s, 0, F(0), { n: 1, d: 1 }, [pitch()]);
  const second = C.inputAt(s, 1, F(0), quarter, [pitch(1)]);
  C.inputAt(s, 0, F(0), { n: 1, d: 1 }, [pitch(4)], { staffIdx: 1, voice: 3 });
  s.spanners.push({ id: 'hairpin', type: 'cresc', startId: id, endId: second });
  C.splitMeasureAt(s, 0, F(1, 3));
  assert.deepEqual(C.measureStarts(s).map(String), ['0/1', '1/3', '1/1', '2/1']);
  assert.equal(C.findEvent(s, id).ev.notes[0].tie, true);
  assert.equal(C.findEvent(s, second).m, 2); invariant(s);
  C.joinMeasures(s, 0);
  assert.deepEqual(C.measureStarts(s).map(String), ['0/1', '1/1', '2/1']);
  assert.equal(C.findEvent(s, second).m, 1); invariant(s);
  C.setMeasureKeySig(s, 1, 1);
  const before = C.toJSON(s); assert.throws(() => C.joinMeasures(s, 0)); assert.deepEqual(C.toJSON(s), before);
});

test('rest spanner anchors survive splitting and consolidation', () => {
  const s = C.createScore({ measureCount: 2 });
  const first = s.measures[0].events[0].id, last = s.measures[1].events[0].id;
  s.spanners.push({ id: 'rest-hairpin', type: 'cresc', startId: first, endId: last });
  C.splitMeasureAt(s, 1, F(1, 3));
  assert.equal(s.spanners.length, 1);
  assert.ok(C.findEvent(s, s.spanners[0].startId)); assert.equal(C.findEvent(s, s.spanners[0].endId).m, 2);
  invariant(s);
});

test('pickup reflows without data loss and survives JSON, undo and subsequent edits', () => {
  const s = C.createScore({ measureCount: 2 });
  const a = C.inputAt(s, 0, F(0), quarter, [pitch()]), b = C.inputAt(s, 1, F(0), quarter, [pitch(2)]);
  C.setPickup(s, F(1, 4));
  assert.ok(C.measureLenAt(s, 0).eq(F(1, 4)));
  assert.equal(sequence(s).find(e => e.id === b).start, '1/1');
  assert.ok(C.findEvent(s, a)); invariant(s);
  const loaded = C.fromJSON(C.toJSON(s)); invariant(loaded);
  C.setScore(loaded); C.mutate('pickup', score => C.setPickup(score, F(1, 8)));
  assert.ok(C.undo()); assert.ok(C.measureLenAt(C.state.score, 0).eq(F(1, 4)));
  C.setPickup(s, null); assert.ok(C.measureLenAt(s, 0).eq(F(1))); invariant(s);
});

test('custom imported lengths seed every silent voice correctly', () => {
  const legacy = { keySig: 0, timeSig: { num: 4, den: 4 }, measures: [
    { pickup: [1, 4], events: [{ id: 'n1', type: 'note', dur: quarter, notes: [pitch()] }] },
    { timeSig: { num: 5, den: 8 }, events: [{ id: 'r1', type: 'rest', full: true, dur: { n: 5, d: 8 }, notes: [] }] },
    { length: { n: 1, d: 3 }, events: [{ id: 'r2', type: 'rest', full: true, dur: { n: 1, d: 3 }, notes: [] }] },
  ] };
  const s = C.fromJSON(legacy);
  assert.deepEqual(C.measureStarts(s).map(String), ['0/1', '1/4', '7/8', '29/24']); invariant(s);
});

test('ottava metadata is inclusive and confined to its staff/voice', () => {
  const s = C.createScore({ measureCount: 1, ensemble: 'piano' });
  const a = C.inputAt(s, 0, F(0), quarter, [pitch()]), b = C.inputAt(s, 0, F(1, 4), quarter, [pitch(2)]);
  const other = C.inputAt(s, 0, F(0), quarter, [pitch()], { staffIdx: 1 });
  assert.ok(C.addOttava(s, b, a, -12));
  assert.equal(C.ottavaShiftAt(s, a), -12); assert.equal(C.ottavaShiftAt(s, b), -12);
  assert.equal(C.ottavaShiftAt(s, other), 0); assert.equal(C.addOttava(s, a, other), null);
  assert.equal(C.CLEFS.alto.bottomStep, 24); assert.equal(C.CLEFS.tenor.bottomStep, 22);
  assert.equal(C.CLEFS.treble8vb.octaveShift, -12);
  assert.equal(C.midiOf(C.findEvent(s, a).ev.notes[0]), 60);
  C.setOrnament(s, a, 'turn'); assert.equal(C.findEvent(s, a).ev.ornament, 'turn');
  const loaded = C.fromJSON(C.toJSON(s)); assert.equal(C.ottavaShiftAt(loaded, b), -12);
});

test('style tokens, GM inference, and custom multistaff templates are compatible', () => {
  const s = C.createScore({ measureCount: 1, parts: [{ kind: 'solo', name: 'Custom', instrument: 'strings', transpose: { chromatic: -2, diatonic: -1 }, staves: [{ clef: 'alto' }, { clef: 'tenor' }, { clef: 'bass' }] }] });
  assert.equal(C.staffRefs(s).length, 3); assert.equal(s.parts[0].transpose.chromatic, -2);
  s.style = { stemWidth: 2, spaceBase: NaN, chordFontSize: -1, futureToken: 'kept' };
  const st = C.ensureStyle(s);
  assert.equal(st.stemWidth, 2); assert.equal(st.spaceBase, 21); assert.equal(st.chordFontSize, 15); assert.equal(st.futureToken, 'kept');
  st.lyricLineGap = 24; st.tieHeight = 2;
  assert.equal(C.ensureStyle(s).lyricLineHeight, 24); assert.equal(st.tieHeightFactor, 0.12);
  assert.deepEqual([0, 4, 10, 19, 24, 48, 73, 80].map(gm => C.instrumentForGm(gm)), ['piano', 'epiano', 'musicbox', 'organ', 'guitar', 'strings', 'flute', 'chiptune']);
  assert.equal(C.instrumentForGm(48, { channel: 10 }), 'drums'); assert.equal(C.instrumentForGm(NaN), 'piano');
  invariant(s);
});
