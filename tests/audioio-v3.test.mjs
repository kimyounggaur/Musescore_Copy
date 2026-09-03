import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const C = SF.core, P = SF.playback, IO = SF.io, F = SF.F;
const pitch = (midi = 60) => C.spellMidi(midi, 0);
const add = (s, m, tick = F(0), dur = { n: 1, d: 4 }, midi = 60, ctx) => C.inputAt(s, m, tick, dur, [pitch(midi)], ctx);
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('variable meters use cumulative rational positions and per-measure clicks', () => {
  const s = C.createScore({ measureCount: 3, tempo: 120 });
  for (const ref of C.staffRefs(s)) ref.measures[1].timeSig = { num: 3, den: 4 };
  C.invalidate(s);
  add(s, 0); add(s, 1); add(s, 2);
  const comp = P.compile(s);
  assert.deepEqual(comp.playbackPlan.map(m => m.abs.toString()), ['0/1', '1/1', '7/4']);
  assert.deepEqual(comp.measureTimes, [0, 2, 3.5, 5]);
  assert.equal(comp.beatTimes.length, 10);
  assert.deepEqual(comp.events.map(ev => ev.absVal.toString()), ['0/1', '1/1', '7/4']);
});

test('fermata holds shift all later music, clicks and MIDI in the same timeline', () => {
  const s = C.createScore({ measureCount: 1, tempo: 120 });
  const id = add(s, 0); add(s, 0, F(1, 4), undefined, 62);
  C.findEvent(s, id).ev.artics = ['fermata'];
  const comp = P.compile(s);
  approximately(comp.events[0].midis[0].durSec, 0.8);
  approximately(comp.events[1].t, 0.8);
  approximately(comp.totalSec, 2.3);
  approximately(comp.beatTimes[1].t, 0.8);
  const parsed = IO.parseMidi(P.exportMidi(s));
  const notes = parsed.tracks[1].notes;
  approximately(notes[1].start / parsed.ppq, 1.6);
});

test('ties follow actual consecutive playback measures and never swallow the next repeat', () => {
  const s = C.createScore({ measureCount: 2 });
  add(s, 0, F(3, 4), { n: 1, d: 2 });
  s.measures[0].startRepeat = true; s.measures[1].endRepeat = true;
  const comp = P.compile(s);
  assert.equal(comp.events.length, 2);
  assert.deepEqual(comp.events.map(ev => ev.midis[0].durVal.toString()), ['1/2', '1/2']);
});

test('bounded repeat/volta/DC/DS/Coda/Fine plans choose valid targets', () => {
  const s = C.createScore({ measureCount: 4 });
  s.measures[0].startRepeat = true;
  Object.assign(s.measures[1], { endingStart: '1', endingStop: true, endRepeat: true });
  Object.assign(s.measures[2], { endingStart: '2', endingStop: true });
  assert.deepEqual(P.buildPlaybackPlan(s).map(p => p.m), [0, 1, 0, 2, 3]);
  const dc = C.createScore({ measureCount: 4 });
  dc.measures[1].marker = 'fine'; dc.measures[3].jump = { type: 'DCalFine' };
  assert.deepEqual(P.buildPlaybackPlan(dc).map(p => p.m), [0, 1, 2, 3, 0, 1]);
  dc.measures[0].marker = 'segno'; dc.measures[1].marker = 'toCoda'; dc.measures[2].marker = 'coda'; dc.measures[3].jump = { type: 'DSalCoda' };
  assert.deepEqual(P.buildPlaybackPlan(dc).map(p => p.m), [0, 1, 2, 3, 0, 1, 2, 3]);
  dc.measures[0].marker = null;
  assert.ok(P.buildPlaybackPlan(dc).warnings.length);
});

test('ornaments and tremolo produce real musical subevents using the local key', () => {
  const s = C.createScore({ measureCount: 1, keySig: 1 });
  const id = add(s, 0, F(0), { n: 1, d: 4 }, 64);
  C.findEvent(s, id).ev.ornament = 'trill';
  const comp = P.compile(s);
  assert.equal(comp.events.length, 8);
  assert.deepEqual(comp.events.map(e => e.midis[0].midi), [64, 66, 64, 66, 64, 66, 64, 66]);
  assert.equal(comp.events.reduce((sum, ev) => sum.add(ev.durVal), F(0)).toString(), '1/4');
  delete C.findEvent(s, id).ev.ornament; C.findEvent(s, id).ev.tremolo = 3;
  assert.equal(P.compile(s).events.length, 8);
});

test('written transposition and ottava affect sound; octave clefs do not', () => {
  const s = C.createScore({ measureCount: 1, clef: 'treble8vb' });
  const first = add(s, 0), second = add(s, 0, F(1, 4));
  s.parts[0].transpose = { chromatic: -2, diatonic: -1 };
  s.spanners.push({ id: C.newId(), type: 'ottava', shift: 12, startId: first, endId: second });
  assert.deepEqual(P.compile(s).events.map(e => e.midis[0].midi), [70, 70]);
});

test('muted parts stay compiled and channel 10 is reserved for drums', () => {
  const s = C.createScore({ measureCount: 1, parts: ['flute', 'drumkit', 'piano'] });
  add(s, 0, F(0), undefined, 72, { partIdx: 0, staffIdx: 0 });
  const drum = add(s, 0, F(0), undefined, 36, { partIdx: 1, staffIdx: 0 });
  Object.assign(C.findEvent(s, drum).ev, { drumId: 'kick', midi: 36 });
  add(s, 0, F(0), undefined, 60, { partIdx: 2, staffIdx: 0 });
  s.playbackSettings.mixer[s.parts[0].id] = { mute: true, volume: 0, pan: -1 };
  assert.equal(P.compile(s).events.length, 3);
  const parsed = IO.parseMidi(P.exportMidi(s));
  assert.equal(parsed.format, 1); assert.equal(parsed.tracks.length, 4);
  assert.equal(parsed.tracks[2].notes[0].channel, 9);
  assert.equal(parsed.tracks[2].programs[0].channel, 9);
  assert.ok(parsed.tracks.filter((_, i) => i !== 2).every(t => t.notes.every(n => n.channel !== 9)));
});

test('MIDI repeated tempo changes use expanded positions and survive the parser', () => {
  const s = C.createScore({ measureCount: 2, tempo: 100 });
  add(s, 0); const id = add(s, 1); C.findEvent(s, id).ev.tempo = 150;
  s.measures[0].startRepeat = true; s.measures[1].endRepeat = true;
  const parsed = IO.parseMidi(P.exportMidi(s));
  assert.deepEqual(parsed.tempoMap.map(t => Math.round(t.tempo)), [100, 150, 100, 150]);
  assert.deepEqual(parsed.tempoMap.map(t => t.tick / parsed.ppq), [0, 4, 8, 12]);
});

test('MIDI parser handles running status and velocity-zero note-offs with safe truncation errors', () => {
  const track = [0, 0x90, 60, 90, 0x83, 0x60, 60, 0, 0, 0xff, 0x2f, 0];
  const bytes = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
  const parsed = IO.parseMidi(bytes);
  assert.equal(parsed.tracks[0].notes[0].duration, 480);
  assert.throws(() => IO.parseMidi(bytes.slice(0, -2)), /잘린/);
  const result = IO.midiToScore(parsed, { grid: 1 / 16 });
  assert.equal(P.compile(result.score).events[0].midis[0].midi, 60);
});

test('MIDI quantization imports all demo pitch sequences with one track per part', () => {
  for (const demo of Object.values(IO.DEMOS)) {
    const s = demo();
    for (const ref of C.staffRefs(s)) for (const mm of ref.measures) for (const { ev } of C.measureEntries(mm, { score: s })) ev.artics = (ev.artics || []).filter(a => a !== 'fermata');
    const expected = P.compile(s).events.flatMap(e => e.midis.map(n => n.midi));
    const imported = IO.midiToScore(IO.parseMidi(P.exportMidi(s)), { grid: 1 / 16 });
    assert.deepEqual(P.compile(imported.score).events.flatMap(e => e.midis.map(n => n.midi)), expected);
  }
});

test('MIDI triplet detection retains exact thirds and duration groups', () => {
  const parsed = { format: 0, ppq: 480, keySig: 0, timeSig: { num: 4, den: 4 }, tempoMap: [{ tick: 0, tempo: 120 }], tracks: [{ index: 0, name: 'triplet', programs: [], notes: [0, 160, 320].map((start, i) => ({ start, end: start + 160, duration: 160, midi: 60 + i * 2, velocity: 82, channel: 0 })) }] };
  const r = IO.midiToScore(parsed, { detectTriplets: true });
  const evs = C.measureEntries(r.score.measures[0], { score: r.score }).filter(e => e.ev.type === 'note');
  assert.deepEqual(evs.map(e => e.tick.toString()), ['0/1', '1/12', '1/6']);
  assert.ok(evs.every(e => C.durValue(e.ev.dur).eq(F(1, 12))));
  assert.ok(evs.every(e => e.ev.dur.tuplet?.actual === 3));
});

test('MusicXML export declares every instrument, proper clefs and exact small/tuplet divisions', () => {
  const s = C.createScore({ measureCount: 1, parts: ['drumkit', 'guitar-tab'] });
  const id = add(s, 0, F(0), { n: 1, d: 64 }, 36, { partIdx: 0 }); C.findEvent(s, id).ev.drumId = 'kick';
  const xml = IO.exportMusicXML(s);
  assert.ok(xml.includes('<sign>percussion</sign>')); assert.ok(xml.includes('<sign>TAB</sign>'));
  assert.ok(xml.includes('<score-instrument id="P1-kick">')); assert.ok(xml.includes('<midi-unpitched>37</midi-unpitched>'));
  assert.ok(xml.includes('<type>64th</type>'));
  assert.ok(!xml.includes('<duration>0</duration>'));
});

test('autosave revision only advances after current document successfully reaches storage', async () => {
  const oldStorage = globalThis.localStorage; let saved;
  globalThis.localStorage = { setItem: (_key, value) => { saved = JSON.parse(value); }, getItem: () => null, removeItem: () => {} };
  try {
    C.setScore(C.createScore({ measureCount: 1 })); C.mutate('edit', s => { s.meta.title = 'saved revision'; });
    IO.autosave(C.state.score, { delay: 0 }); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(saved.revision, C.state.revision); assert.equal(IO.getAutosaveStatus().revision, C.state.revision); assert.ok(C.isAutosaved());
    C.mutate('newer edit', s => { s.meta.title = 'newer'; });
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    IO.autosave(C.state.score, { delay: 0 }); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(IO.getAutosaveStatus().error.message, 'quota'); assert.ok(!C.isAutosaved()); assert.ok(C.state.dirty);
  } finally { IO.clearAutosave(); globalThis.localStorage = oldStorage; }
});

test('scheduler locks late samples per session and both engines share live gain/pan buses', async () => {
  const sampleStarts = [], destinations = [], oscillatorStarts = [], timers = new Map(); let timerId = 0, ready;
  const sampleReady = new Promise(resolve => { ready = resolve; });
  const parameter = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} });
  const node = () => ({ gain: parameter(), pan: parameter(), frequency: parameter(), Q: parameter(), detune: parameter(), connect(other) { this.destination = other; return other; }, start(time) { oscillatorStarts.push(time); }, stop() {}, disconnect() {} });
  class AudioContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = node(); this.sampleRate = 48000; }
    createGain() { return node(); } createStereoPanner() { return node(); } createBiquadFilter() { return node(); }
    createOscillator() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
  }
  const factory = (_ctx, opts) => { destinations.push(opts.destination); return { ready: sampleReady, start(event) { sampleStarts.push(event); }, stop() {} }; };
  const context = vm.createContext({ SF: { core: C, Fraction: SF.Fraction }, AudioContext, console, setTimeout, clearTimeout,
    setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    __sampleModule: async () => ({ SplendidGrandPiano: factory, Soundfont: factory }) });
  context.window = context;
  // Substitute only the module transport. Instrument readiness, routing,
  // session choice and scheduler code remain the production implementations.
  const source = readFileSync(new URL('../js/playback.js', import.meta.url), 'utf8').replace('import("../vendor/smplr/index.mjs").catch(() => import(SMPLR_URL))', 'window.__sampleModule()');
  vm.runInContext(source, context);
  const playback = context.SF.playback;
  const s = C.createScore({ measureCount: 1, tempo: 120 });
  add(s, 0); add(s, 0, F(1, 4), undefined, 62); C.setScore(s);
  try {
    await playback.play(0, { sampleTimeoutMs: 0 });
    assert.equal(playback.player.sessionSamples.size, 0); assert.ok(oscillatorStarts.length > 0);
    ready(); await new Promise(resolve => setTimeout(resolve, 0));
    playback.audio().currentTime = 0.4; for (const pump of timers.values()) pump();
    assert.equal(sampleStarts.length, 0, 'late samples cannot change the active session');
    playback.stop();
    await playback.play(0, { sampleTimeoutMs: 0, rate: 2 });
    assert.ok(sampleStarts.length > 0, 'next playback can use loaded samples');
    approximately(sampleStarts[0].duration, 0.2375);
    const partId = C.state.score.parts[0].id, bus = playback.partBuses.get(partId);
    assert.equal(destinations[0], bus.input); assert.equal(bus.input.destination, bus.pan);
    C.state.score.playbackSettings.mixer[partId] = { pan: 0.8, volume: 0.25 };
    playback.updateMixer(); approximately(bus.pan.pan.value, 0.8); approximately(bus.input.gain.value, 0.25);
    C.state.score.playbackSettings.mixer[partId].mute = true; playback.updateMixer(); assert.equal(bus.input.gain.value, 0);
    playback.setLoop({ startSec: 0, endSec: 0.5 });
    playback.audio().currentTime = playback.player.startCtxTime + 0.24;
    for (const pump of timers.values()) pump();
    assert.ok(playback.player.cycle >= 1, 'next loop is scheduled before the boundary');
    playback.stop(); playback.player.metronome = true;
    await playback.play(0, { countIn: true, rate: 2, loop: null, sampleTimeoutMs: 0 });
    approximately(playback.player.startCtxTime - playback.audio().currentTime, 1.08);
    assert.equal(playback.pausePos(), 0);
    const tempo = C.state.score.tempo; playback.setRate(0.5); assert.equal(C.state.score.tempo, tempo);
  } finally { playback.stop(); }
});
