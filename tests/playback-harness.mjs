// 재생 모듈(js/playback.js)을 가짜 AudioContext·fetch·smplr 모듈과 함께 새 vm 컨텍스트에 올리는 테스트 도구.
// 모듈 전달 경로(import)만 바꿔 끼우고, 악기 준비·라우팅·로더 공유·요청 제한 같은 실제 코드는 그대로 실행한다.
// (tests/audioio-v3.test.mjs의 방식과 같다. 테스트 파일이 아니므로 npm test가 직접 실행하지 않는다.)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SF } from './shim.mjs';

const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
const node = () => ({ gain: parameter(), pan: parameter(), frequency: parameter(), Q: parameter(), detune: parameter(), connect(other) { return other; }, disconnect() {}, start() {}, stop() {} });

// hq: 피아노 음질 설정을 '고음질'로 시작한다(기본은 가벼운 Soundfont 피아노). store: localStorage 초기값. blockedStorage: 저장소가 막힌 브라우저.
export const PIANO_QUALITY_KEY = 'scoreforge.audio.pianoQuality';
export function loadPlayback({ sampleModule, fetch, hq = false, store = {}, blockedStorage = false } = {}) {
  const stats = { decodes: 0, contexts: 0 }, logs = [];
  const data = new Map(Object.entries({ ...(hq ? { [PIANO_QUALITY_KEY]: 'hq' } : {}), ...store }));
  const blocked = () => { throw new Error('storage blocked'); };
  const localStorage = blockedStorage
    ? { getItem: blocked, setItem: blocked, removeItem: blocked }
    : { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)); }, removeItem: key => { data.delete(key); } };
  class AudioContext {
    constructor() { stats.contexts++; this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000; this.destination = node(); }
    createGain() { return node(); } createStereoPanner() { return node(); } createBiquadFilter() { return node(); }
    createBufferSource() { return node(); } createOscillator() { return node(); } createConstantSource() { return node(); }
    createDelay() { return node(); } createChannelMerger() { return node(); } createChannelSplitter() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
    async decodeAudioData() { stats.decodes++; return { duration: 1, length: 48000, numberOfChannels: 2, sampleRate: 48000 }; }
  }
  const context = vm.createContext({
    SF: { core: SF.core, Fraction: SF.Fraction }, AudioContext, console: { ...console, warn: (...args) => logs.push(args) }, setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fetch, localStorage, TextEncoder, __sampleModule: async () => sampleModule,
  });
  context.window = context;
  const original = readFileSync(new URL('../js/playback.js', import.meta.url), 'utf8');
  const source = original.replace('import("../vendor/smplr/index.mjs")', 'window.__sampleModule()');
  if (source === original) throw new Error('smplr import 바꿔치기 실패 — playback.js의 import 문을 확인');
  vm.runInContext(source, context);
  return { playback: context.SF.playback, context, stats, logs, data };
}

// 가짜 smplr 모듈: 만들어진 악기와 로더를 기록한다. makeReady(만든 순서, kind)로 악기별 ready Promise를 바꿀 수 있다.
export function fakeSmplr({ makeReady = () => Promise.resolve(), withLoader = true } = {}) {
  const made = [], loaders = [];
  const instrument = (kind, opts, extra = {}) => {
    const inst = { kind, opts, disposed: false, ready: makeReady(made.length, kind), start() {}, stop() {}, dispose() { this.disposed = true; }, ...extra };
    made.push(inst);
    return inst;
  };
  const mod = {
    SplendidGrandPiano: (_ctx, opts) => instrument('splendid', opts),
    Soundfont: (_ctx, opts) => instrument('soundfont', opts),
  };
  if (withLoader) mod.SampleLoader = (_ctx, opts) => { const loader = { opts, load: async () => new Map() }; loaders.push(loader); return loader; };
  return { mod, made, loaders };
}
