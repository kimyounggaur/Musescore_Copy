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
  const saved = C.toJSON(score, { format: 1 });   // 구버전 호환 출력(P7-B1): legacy 별칭은 { format: 1 }에서만 나온다
  assert.deepEqual(saved.measures[0].events, saved.measures[0].voices[0]);
  assert.equal(JSON.stringify(saved).includes('__cache'), false);
  const v2 = C.toJSON(score);                     // 기본은 v2: 별칭·최상위 measures 없음
  assert.equal('measures' in v2, false);
  assert.equal(v2.schema, 2);
  assert.equal('events' in v2.parts[0].staves[0].measures[0], false);
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

// P7-B2: 실행 취소 기록은 악보를 압축 JSON 글자로 담는다(예산 48MB·개수 200). 빈 성부 쉼표 ID까지 정확히 돌아와야 한다.
const exact = () => JSON.stringify(C.toJSON(C.state.score, { keepSilentVoices: true }));   // 빈 성부 쉼표 ID까지 본다

test('실행 취소 기록(글자): 편집 3회 → 실행 취소 3회면 처음과 똑같고, 다시 실행하면 편집한 상태로 돌아온다', () => {
  C.__setHistoryBudget();
  C.setScore(C.createScore({ measureCount: 2 }));
  const states = [exact()], defaults = [JSON.stringify(C.toJSON(C.state.score))];
  const steps = [
    ['음 입력', s => C.inputAt(s, 0, F(0, 1), quarter, [pitch(0)])],
    ['템포', s => { s.tempo = 77; }],
    ['2성부 음', s => C.inputAt(s, 1, F(0, 1), quarter, [pitch(2)], { voice: 2 })],
  ];
  for (const [label, fn] of steps) { C.mutate(label, fn); states.push(exact()); defaults.push(JSON.stringify(C.toJSON(C.state.score))); }
  assert.equal(C.__history().undo, 3);
  for (let i = 2; i >= 0; i--) {
    assert.ok(C.undo(), `실행 취소 ${3 - i}번째`);
    assert.equal(exact(), states[i], `실행 취소 뒤 = ${i}번째 상태(쉼표 ID까지)`);
    assert.equal(JSON.stringify(C.toJSON(C.state.score)), defaults[i], `실행 취소 뒤 toJSON = ${i}번째 상태`);
  }
  assert.equal(C.canUndo(), false); assert.equal(C.state.dirty, false);
  for (let i = 1; i <= 3; i++) { assert.ok(C.redo(), `다시 실행 ${i}번째`); assert.equal(exact(), states[i], `다시 실행 뒤 = ${i}번째 상태`); }
  assert.equal(C.canRedo(), false); assert.equal(C.state.dirty, true);
});

test('실행 취소 기록(글자): 예산을 넘으면 오래된 것부터 버리고, 남은 것은 정확히 복원한다', () => {
  C.__setHistoryBudget();
  C.setScore(C.createScore({ measureCount: 2 }));
  const states = [exact()];
  for (let i = 1; i <= 6; i++) { C.mutate(`템포 ${i}`, s => { s.tempo = 100 + i; }); states.push(exact()); }
  assert.equal(C.__history().undo, 6);
  const each = C.__history().bytes / 6;
  C.__setHistoryBudget(Math.floor(each * 3.5));                     // 3개쯤 들어가는 예산
  const stats = C.__history();
  assert.equal(stats.undo, 3, '가장 오래된 3개가 버려졌다');
  assert.ok(stats.bytes <= stats.maxBytes, '예산 이내');
  for (let i = 5; i >= 3; i--) { assert.ok(C.undo()); assert.equal(exact(), states[i], `남은 것: ${i}번째 상태가 정확히 돌아온다`); }
  assert.equal(C.canUndo(), false, '더 오래된 것은 버려졌다');
  assert.equal(C.state.dirty, true, '저장한 처음 상태는 이제 돌아갈 수 없으니 계속 바뀐 상태다');
  C.__setHistoryBudget();
});

test('실행 취소 기록(글자): 빈 성부 쉼표에 커서를 두고 편집 → 실행 취소해도 커서가 가리키던 쉼표 ID가 그대로다', () => {
  C.__setHistoryBudget();
  C.setScore(C.createScore({ measureCount: 2 }));
  const rest = C.getVoiceEvents(C.state.score.parts[0].staves[0].measures[0], 2, C.state.score)[0];
  assert.equal(rest.type, 'rest');
  const id = rest.id;                                               // 입력 커서·선택이 가리키는 값
  C.mutate('1성부 음', s => C.inputAt(s, 0, F(0, 1), quarter, [pitch(0)]));
  assert.equal(C.findEvent(C.state.score, id)?.ev.id, id, '편집 뒤에도 그대로');
  C.mutate('템포', s => { s.tempo = 90; });
  assert.ok(C.undo()); assert.ok(C.undo());
  const found = C.findEvent(C.state.score, id);
  assert.ok(found, '실행 취소 뒤에도 같은 ID의 쉼표가 있다');
  assert.equal(found.ev.type, 'rest'); assert.equal(found.voice, 2); assert.equal(found.m, 0);
  assert.ok(C.redo()); assert.ok(C.redo());
  assert.equal(C.findEvent(C.state.score, id)?.ev.id, id, '다시 실행 뒤에도 그대로');
});

/* ---------------- P8-1: 조옮김할 때 코드 기호도 함께 ---------------- */
const whole = { n: 1, d: 1, dots: 0 };
/** 마디마다 온음표 하나를 놓고 거기에 코드 기호를 붙인다. */
function chordScore(chords, { keySig = 0, ensemble } = {}) {
  const s = C.createScore({ measureCount: Math.max(2, chords.length), keySig, ...(ensemble ? { ensemble } : {}) });
  const ids = chords.map((text, m) => {
    const id = C.inputAt(s, m, F(0), whole, [pitch(0, 4)]);
    C.findEvent(s, id).ev.chordSymbol = C.cloneChordSymbol(text);
    return id;
  });
  return { s, ids };
}
const chordOf = (s, id) => C.findEvent(s, id).ev.chordSymbol;

test('코드 기호 조옮김: C +2 → D · F#m7(D장조) +2 → G#m7(E장조) · Bb/D −3 → G/B · N.C.는 그대로', () => {
  const cases = [
    { key: 0, semis: 2, from: 'C', to: 'D' },
    { key: 2, semis: 2, from: 'F#m7', to: 'G#m7', newKey: 4 },
    { key: 0, semis: -3, from: 'Bb/D', to: 'G/B', newKey: 3 },
    { key: 0, semis: 5, from: 'N.C.', to: 'N.C.' },
    { key: 0, semis: 1, from: 'C', to: 'Db', newKey: -5 },          // 새 조(내림 5개) 안의 철자
    { key: 0, semis: -1, from: 'C', to: 'B', newKey: 5 },
    { key: 1, semis: 12, from: 'Em7', to: 'Em7', newKey: 1 },       // 옥타브: 이름은 그대로
    { key: 0, semis: 2, from: 'Cmaj7/E', to: 'Dmaj7/F#' },          // 베이스까지, 질(maj7)은 그대로
  ];
  for (const { key, semis, from, to, newKey } of cases) {
    const { s, ids } = chordScore([from], { keySig: key });
    C.transposeScore(s, semis);
    const chord = chordOf(s, ids[0]);
    assert.equal(chord.normalized, to, `${from} ${semis > 0 ? '+' : ''}${semis} → ${to}`);
    assert.equal(chord.raw, to, `raw도 함께 바뀐다(${from} → ${to})`);
    if (newKey !== undefined) assert.equal(s.keySig, newKey);
  }
});

test('코드 기호 조옮김: 저장했다 다시 읽어도 조옮긴 코드가 유지된다(읽을 때 raw를 다시 해석하므로 raw까지 바뀌어야 한다)', () => {
  const { s, ids } = chordScore(['F#m7', 'Bb/D', 'N.C.'], { keySig: 2 });
  C.transposeScore(s, 2);
  const back = C.fromJSON(JSON.parse(JSON.stringify(C.toJSON(s))));
  assert.deepEqual(ids.map(id => chordOf(back, id).normalized), ['G#m7', 'C/E', 'N.C.']);
  assert.deepEqual(ids.map(id => chordOf(back, id).raw), ['G#m7', 'C/E', 'N.C.']);
  const v1 = C.fromJSON(JSON.parse(JSON.stringify(C.toJSON(s, { format: 1 }))));
  assert.deepEqual(ids.map(id => chordOf(v1, id).normalized), ['G#m7', 'C/E', 'N.C.']);
});

test('코드 기호 조옮김: 자동 코드 다이어그램은 새 코드로 다시 만들고 직접 만든 것은 그대로 두며, 직접 만든 개수를 돌려준다', () => {
  const { s, ids } = chordScore(['C', 'Am', 'F#m7', 'G']);
  const ev = id => C.findEvent(s, id).ev;
  const handmade = { strings: 6, frets: 4, firstFret: 1, positions: ['x', 0, 2, 2, 1, 0], fingers: [1, 2, 3], manual: true };
  ev(ids[0]).fretboard = C.getDefaultFretboard('C');               // 자동 → D의 기본 다이어그램으로 바뀐다
  ev(ids[1]).fretboard = clone(handmade);                           // 직접 만든 것 → 그대로
  ev(ids[2]).fretboard = C.getDefaultFretboard('Am');               // 자동인데 새 코드(G#m7)는 기본 목록에 없다 → 지워진다
  const result = C.transposeScore(s, 2);                            // ids[3]은 다이어그램이 없다 → 새로 만들지 않는다
  assert.deepEqual(result, { manualFretboards: 1 });
  assert.deepEqual(ids.map(id => chordOf(s, id).normalized), ['D', 'Bm', 'G#m7', 'A']);
  assert.deepEqual(ev(ids[0]).fretboard.positions, C.getDefaultFretboard('D').positions);
  assert.deepEqual(ev(ids[1]).fretboard, handmade);
  assert.equal(ev(ids[2]).fretboard, undefined);
  assert.equal('fretboard' in ev(ids[3]), false);
});

test('코드 기호 조옮김: 쉼표 위의 코드도 옮기고, 타악기 보표는 건드리지 않는다', () => {
  const s = C.createScore({ measureCount: 2 });
  C.ensureParts(s);
  const rest = C.getVoiceEvents(s.parts[0].staves[0].measures[0], 1, s)[0];
  assert.equal(rest.type, 'rest');
  rest.chordSymbol = C.cloneChordSymbol('Dm7');
  C.transposeScore(s, 3);
  assert.equal(C.getVoiceEvents(s.parts[0].staves[0].measures[0], 1, s)[0].chordSymbol.normalized, 'Fm7');

  const d = C.createScore({ measureCount: 2, ensemble: 'drumkit' });
  C.ensureParts(d);
  const drumRest = C.getVoiceEvents(d.parts[0].staves[0].measures[0], 1, d)[0];
  assert.ok(C.isPercussionRef(C.staffRefs(d)[0]), '드럼 키트 보표는 타악기');
  drumRest.chordSymbol = C.cloneChordSymbol('C');
  C.transposeScore(d, 2);
  assert.equal(C.getVoiceEvents(d.parts[0].staves[0].measures[0], 1, d)[0].chordSymbol.normalized, 'C', '타악기 보표의 코드 기호는 그대로');
});

test('코드 기호 조옮김: { chords: false }면 음만 옮기고, 0반음이면 아무것도 하지 않는다', () => {
  const { s, ids } = chordScore(['C']);
  assert.deepEqual(C.transposeScore(s, 2, { chords: false }), { manualFretboards: 0 });
  assert.equal(chordOf(s, ids[0]).normalized, 'C', '코드 기호는 그대로');
  assert.equal(C.midiOf(C.findEvent(s, ids[0]).ev.notes[0]), 62, '음은 온음 올라갔다(C4 → D4)');
  const t = chordScore(['Am7']);
  assert.deepEqual(C.transposeScore(t.s, 0), { manualFretboards: 0 });
  assert.equal(chordOf(t.s, t.ids[0]).normalized, 'Am7');
  assert.equal(t.s.keySig, 0);
});

test('코드 기호 조옮김: 실행 취소 한 번으로 코드 기호와 다이어그램이 함께 돌아온다', () => {
  C.__setHistoryBudget();
  const { s, ids } = chordScore(['C']);
  C.findEvent(s, ids[0]).ev.fretboard = C.getDefaultFretboard('C');
  C.setScore(s);
  const before = JSON.stringify(C.toJSON(C.state.score, { keepSilentVoices: true }));
  C.mutate('조옮김', x => C.transposeScore(x, 2));
  assert.equal(chordOf(C.state.score, ids[0]).normalized, 'D');
  assert.deepEqual(C.findEvent(C.state.score, ids[0]).ev.fretboard.positions, C.getDefaultFretboard('D').positions);
  assert.ok(C.undo());
  assert.equal(JSON.stringify(C.toJSON(C.state.score, { keepSilentVoices: true })), before);
  assert.equal(chordOf(C.state.score, ids[0]).normalized, 'C');
});

test('코드 기호 조옮김: 개별 음 높낮이 이동(방향키가 쓰는 transposeNote·transposePitch)은 코드 기호를 바꾸지 않는다(현행 유지)', () => {
  const { s, ids } = chordScore(['C']);
  C.transposeNote(s, ids[0], 0, 2);
  assert.equal(C.midiOf(C.findEvent(s, ids[0]).ev.notes[0]), 62, '음은 옮겨졌다');
  assert.equal(chordOf(s, ids[0]).normalized, 'C', '코드 기호는 그대로');
});

test('코드 기호 조옮김: 중간에 조표가 바뀌는 악보는 마디마다 그 마디의 새 조로 철자한다(keySigAt(score, m))', () => {
  const { s, ids } = chordScore(['C', 'C', 'C']);                       // 모두 C장조(0)에서 출발
  C.setMeasureKeySig(s, 1, -2);                                          // 2마디부터 B♭장조 — 3마디도 이어받는다
  C.transposeScore(s, 1);                                                // 반음 위로: 앞 조는 D♭장조(♭5), 뒤 조는 B장조(♯5)
  assert.equal(s.keySig, -5); assert.equal(C.keySigAt(s, 1), 5); assert.equal(C.keySigAt(s, 2), 5);
  assert.deepEqual(ids.map(id => chordOf(s, id).normalized), ['Db', 'C#', 'C#'], '♭ 조의 마디는 Db, ♯ 조의 마디는 C#');
});

test('코드 기호 조옮김: 0반음은 악보를 한 글자도 바꾸지 않는다(임시표 철자도 그대로) · transposeChordSymbol도 0반음·근음 없음·없는 코드는 그대로', () => {
  const { s, ids } = chordScore(['C#m7']);
  C.findEvent(s, ids[0]).ev.notes[0].alter = 1;                          // C#4 — 0반음인데 음이름을 다시 쓰면(Db) 철자가 바뀐다
  const before = JSON.stringify(C.toJSON(s, { keepSilentVoices: true }));
  assert.deepEqual(C.transposeScore(s, 0), { manualFretboards: 0 });
  assert.equal(JSON.stringify(C.toJSON(s, { keepSilentVoices: true })), before);
  for (const key of [-5, -3, 0, 2, 5]) {                                  // 직접 부르는 함수도 마찬가지: 0반음이면 철자까지 그대로
    for (const text of ['C#m7', 'Db', 'F#/A#', 'Bbmaj7/D']) {
      const chord = C.cloneChordSymbol(text);
      assert.equal(C.transposeChordSymbol(chord, 0, key).normalized, chord.normalized, `${text} ±0 (조 ${key})`);
    }
  }
  assert.equal(C.transposeChordSymbol(C.cloneChordSymbol('N.C.'), 5, 0).normalized, 'N.C.');
  assert.equal(C.transposeChordSymbol(null, 2, 0), null);
});

test('코드 기호 조옮김: 근음·베이스 12음 × 임시표 × 질 × 조 15개 × 반음 14가지 — 항상 해석되고, 음높이 계이름이 정확히 그만큼 움직이며, raw가 곧 이름이다', () => {
  const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pc = n => ((n % 12) + 12) % 12;
  let total = 0;
  for (const letter of Object.keys(BASE)) for (const [mark, alter] of [['', 0], ['#', 1], ['b', -1]])
    for (const quality of ['', 'm', '7', 'maj7', 'm7', 'dim', 'sus4', 'add9', 'm7b5', '6', '9']) for (const withBass of [false, true])
      for (const semis of [-12, -11, -7, -5, -3, -2, -1, 1, 2, 3, 5, 7, 11, 12]) for (let key = -7; key <= 7; key++) {
        const text = letter + mark + quality + (withBass ? '/Eb' : '');
        const moved = C.transposeChordSymbol(C.cloneChordSymbol(text), semis, key);
        const where = `${text} ${semis > 0 ? '+' : ''}${semis} (조 ${key})`;
        assert.ok(moved, `${where}: 해석되어야 한다`);
        assert.equal(pc(BASE[moved.root] + moved.rootAlter), pc(BASE[letter] + alter + semis), `${where}: 근음`);
        if (withBass) assert.equal(pc(BASE[moved.bass] + moved.bassAlter), pc(BASE.E - 1 + semis), `${where}: 베이스`);
        else assert.equal(moved.bass || '', '', `${where}: 베이스가 생기지 않는다`);
        assert.equal(moved.raw, moved.normalized, `${where}: raw = 이름`);
        total++;
      }
  assert.equal(total, 3 * 7 * 11 * 2 * 14 * 15);
});
