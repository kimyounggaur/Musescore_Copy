import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
const { core: C, F, Fraction } = SF;
const pitch = { step: 0, alter: 0, oct: 4 };
function invariant(s) {
  for (const r of C.staffRefs(s)) for (const [m, mm] of r.measures.entries()) {
    for (let v = 1; v <= 4; v++) {
      const sum = C.getVoiceEvents(mm, v, s).reduce((a, e) => a.add(C.durValue(e.dur)), F(0, 1));
      assert.ok(sum.eq(C.measureLenAt ? C.measureLenAt(s, m) : C.measureLen(s)), `${m}:${v} ${sum}`);
    }
  }
}
test('Fraction arithmetic stays exact', () => {
  assert.equal(F(2, 4).toString(), '1/2');
  assert.ok(F(1, 3).add(F(1, 6)).eq(F(1, 2)));
  assert.ok(F(3, 4).sub(F(1, 4)).mul(F(2, 1)).div(F(4, 1)).eq(F(1, 4)));
  assert.throws(() => F(1, 0));
  assert.throws(() => F(1, 2).div(F(0, 1)));
});
test('decompose preserves duration and dotted notation', () => {
  assert.deepEqual(C.decompose(F(0, 1), F(3, 8)), [{ n: 1, d: 4, dots: 1 }]);
  const ds = C.decompose(F(1, 8), F(1, 2));
  assert.ok(ds.reduce((a, d) => a.add(C.durValue(d)), Fraction.ZERO).eq(F(1, 2)));
});
test('input fills a measure and crossing barlines creates ties', () => {
  const s = C.createScore({ measureCount: 2 });
  for (let i = 0; i < 4; i++) C.inputAt(s, 0, F(i, 4), { n: 1, d: 4 }, [pitch]);
  const id = C.inputAt(s, 0, F(3, 4), { n: 1, d: 2 }, [pitch]);
  assert.equal(C.findEvent(s, id).ev.notes[0].tie, true);
  invariant(s);
});
test('delete consolidates a full measure rest', () => {
  const s = C.createScore({ measureCount: 1 });
  const id = C.inputAt(s, 0, F(0, 1), { n: 1, d: 4 }, [pitch]);
  const f = C.findEvent(s, id);
  C.deleteEvent(s, f.m, f.e, f);
  C.consolidateRests(s, 0);
  assert.equal(s.measures[0].events.length, 1);
  invariant(s);
});
test('JSON legacy migration and undo/redo preserve notes', () => {
  const s = C.createScore({ measureCount: 2 });
  const old = C.toJSON(s); delete old.parts;
  assert.equal(C.fromJSON(old).parts.length, 1);
  C.setScore(s);
  C.mutate('input', sc => C.inputAt(sc, 0, F(0, 1), { n: 1, d: 4 }, [pitch]));
  const after = C.toJSON(C.state.score);
  assert.ok(C.undo()); assert.ok(C.redo());
  assert.deepEqual(C.toJSON(C.state.score), after);
});
test('spellMidi respects requested flat spelling', () => {
  assert.equal(C.spellMidi(61, 0, 'flat').step, 1);
  assert.equal(C.spellMidi(61, 1).step, 0);
});
test('all demo scores retain voice length invariants', () => {
  for (const demo of Object.values(SF.io.DEMOS)) invariant(demo());
});
