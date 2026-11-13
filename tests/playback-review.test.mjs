import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SF } from './shim.mjs';

function harness() {
  const starts = [], oscillatorStarts = [], options = [];
  const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: parameter(), pan: parameter(), frequency: parameter(), Q: parameter(), detune: parameter(), connect(other) { return other; }, disconnect() {}, start() { oscillatorStarts.push(1); }, stop() {} });
  class AudioContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = node(); }
    createGain() { return node(); } createStereoPanner() { return node(); } createBiquadFilter() { return node(); } createOscillator() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
  }
  let resolve;
  const ready = new Promise(done => { resolve = done; });
  const factory = (_ctx, opts) => { options.push(opts); return { ready, start(event) { starts.push(event); }, stop() {} }; };
  const context = vm.createContext({ SF: { core: SF.core, Fraction: SF.Fraction }, AudioContext, console, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, __sampleModule: async () => ({ Soundfont: factory, SplendidGrandPiano: factory }) });
  context.window = context;
  const source = readFileSync(new URL('../js/playback.js', import.meta.url), 'utf8').replace('import("../vendor/smplr/index.mjs")', 'window.__sampleModule()');
  vm.runInContext(source, context);
  const score = SF.core.createScore({ measureCount: 1 });
  SF.core.inputAt(score, 0, SF.F(0), { n: 1, d: 4 }, [SF.core.spellMidi(60, 0)]);
  SF.core.setScore(score);
  return { playback: context.SF.playback, resolve, starts, oscillatorStarts, options };
}

test('first playback waits for local standard piano readiness before scheduling sampled notes', async () => {
  const h = harness();
  try {
    const pending = h.playback.play();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(h.playback.player.loading);
    assert.equal(h.starts.length, 0); assert.equal(h.oscillatorStarts.length, 0);
    assert.equal(h.options[0].instrumentUrl, 'vendor/audio/fluidr3-piano-mp3.js');
    h.resolve(); await pending;
    assert.ok(h.starts.length > 0); assert.equal(h.oscillatorStarts.length, 0);
  } finally { h.playback.stop(); }
});

test('preparation can be bypassed immediately and late readiness stays clearly labelled', async () => {
  const h = harness();
  try {
    const pending = h.playback.play();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(h.playback.useBasicSound(), true); await pending;
    assert.ok(h.oscillatorStarts.length > 0); assert.equal(h.starts.length, 0);
    h.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(h.playback.getSampleStatus().state, 'fallback');
    assert.equal(h.playback.player.sessionSamples.size, 0);
  } finally { h.playback.stop(); }
});

test('same soundfont is decoded once for independent part instruments', async () => {
  const { Soundfont } = await import('../vendor/smplr/index.mjs');
  const node = () => ({ gain: { value: 0 }, pan: { value: 0 }, connect(other) { return other; }, disconnect() {} });
  let fetched = 0, decoded = 0;
  const context = { currentTime: 0, destination: node(), createGain: node, createStereoPanner: node, decodeAudioData: async () => { decoded++; return { duration: 1 }; } };
  const source = 'MIDI.Soundfont.acoustic_grand_piano = {"C4":"data:audio/mp3;base64,AAAA",};';
  const storage = { fetch: async () => { fetched++; return { text: async () => source }; } };
  const oldCreateElement = document.createElement;
  document.createElement = () => ({ canPlayType: () => 'probably' });
  try {
    const first = Soundfont(context, { instrumentUrl: 'test-piano', storage });
    const second = Soundfont(context, { instrumentUrl: 'test-piano', storage });
    await Promise.all([first.ready, second.ready]);
    assert.equal(fetched, 1); assert.equal(decoded, 1);
    assert.notEqual(first.output, second.output);
  } finally { document.createElement = oldCreateElement; }
});
