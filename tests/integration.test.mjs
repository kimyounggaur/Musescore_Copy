import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
const C = SF.core, E = SF.engrave;

test('read-only documents reject all history mutations in the core', () => {
  C.setScore(C.createScore());
  C.mutate('Title', s => { s.meta.title = 'Changed'; });
  const before = JSON.stringify(C.toJSON(C.state.score)), revision = C.state.revision;
  C.state.readOnly = true;
  try {
    assert.equal(C.mutate('Forbidden', s => { s.meta.title = 'No'; }), false);
    assert.equal(C.undo(), false);
    assert.equal(C.redo(), false);
    assert.equal(C.state.revision, revision);
    assert.equal(JSON.stringify(C.toJSON(C.state.score)), before);
  } finally { C.state.readOnly = false; }
  assert.equal(C.undo(), true);
});

test('opt-in render cache follows musical revisions, style, selection and export isolation', () => {
  C.setScore(C.createScore({ measureCount: 4 }));
  const s = C.state.score, a = E.render(s, { cache: true });
  assert.equal(E.render(s, { cache: true }), a);
  C.mutate('Edit', score => C.inputAt(score, 0, SF.F(0), { n: 1, d: 4 }, [{ step: 0, oct: 4, alter: 0 }]));
  const b = E.render(s, { cache: true });
  assert.notEqual(b, a);
  s.style.staffLineWidth += .1;
  const c = E.render(s, { cache: true });
  assert.notEqual(c, b);
  const selected = E.render(s, { cache: true, selection: new Set([s.measures[0].events[0].id]) });
  assert.notEqual(selected, c);
  E.render(s, { cache: true, export: true, preserveLayout: true });
  assert.equal(E.getLayout(), selected.layout);
});
