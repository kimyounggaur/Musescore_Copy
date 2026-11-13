import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
const C = SF.core, IO = SF.io, P = SF.playback;

const midiSource = notes => ({ format: 0, ppq: 480, keySig: 0, timeSig: { num: 4, den: 4 }, tempoMap: [{ tick: 0, tempo: 120 }],
  tracks: [{ index: 0, name: 'Piano import', programs: [], endTick: 1920, notes: notes.map(n => ({ start: 0, channel: 0, velocity: 82, ...n, end: n.start + n.duration || n.duration })) }] });

test('MIDI import chooses bass clef for low notes and can split hands', () => {
  const parsed = midiSource([{ midi: 36, start: 0, duration: 480 }, { midi: 43, start: 480, duration: 480 }]);
  const result = IO.midiToScore(parsed);
  assert.equal(result.score.parts[0].staves[0].clef, 'bass');
  const split = IO.midiToScore(midiSource([{ midi: 36, start: 0, duration: 480 }, { midi: 72, start: 0, duration: 480 }]), { splitHands: true });
  assert.equal(split.score.parts[0].staves.length, 2);
  assert.equal(C.getVoiceEvents(split.score.parts[0].staves[0].measures[0], 1, split.score)[0].notes[0].oct, 5);
  assert.equal(C.getVoiceEvents(split.score.parts[0].staves[1].measures[0], 1, split.score)[0].notes[0].oct, 2);
});

test('MIDI import keeps four overlapping voices instead of dropping the third and fourth', () => {
  const parsed = midiSource([1920, 1440, 960, 480].map((duration, i) => ({ midi: 60 + i * 2, start: 0, duration })));
  const result = IO.midiToScore(parsed);
  assert.equal(result.placed, 4);
  assert.equal(P.compile(result.score).events.flatMap(e => e.midis).length, 4);
  assert.ok(!result.report.some(line => line.includes('생략')));
});

test('file save reuses handle and cancellation does not mark dirty revision saved', async () => {
  const oldPicker = window.showSaveFilePicker;
  let picks = 0, writes = [], failWrite = false;
  const handle = { createWritable: async () => ({ write: async value => { if (failWrite) throw new Error('disk full'); writes.push(JSON.parse(value)); }, close: async () => {}, abort: async () => {} }) };
  window.showSaveFilePicker = async () => { picks++; return handle; };
  IO.resetFileHandle();
  try {
    C.setScore(C.createScore({ measureCount: 1 }));
    C.mutate('title', score => { score.meta.title = 'First save'; });
    assert.equal((await IO.saveJSON(C.state.score)).method, 'file');
    C.mutate('title', score => { score.meta.title = 'Second save'; });
    await IO.saveJSON(C.state.score);
    assert.equal(picks, 1); assert.equal(writes.length, 2); assert.equal(writes[1].score.meta.title, 'Second save');
    C.mutate('title', score => { score.meta.title = 'Unsaved'; });
    failWrite = true;
    await assert.rejects(IO.saveJSON(C.state.score), /disk full/);
    assert.ok(C.state.dirty);
    IO.resetFileHandle();
    window.showSaveFilePicker = async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); };
    assert.equal(await IO.saveJSON(C.state.score), false); assert.ok(C.state.dirty);
  } finally { IO.resetFileHandle(); window.showSaveFilePicker = oldPicker; }
});
