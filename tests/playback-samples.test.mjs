// Phase 4-1: 샘플 로더 공유와 동시 요청 제한.
// 재생 모듈은 가짜 AudioContext·fetch·smplr 모듈과 함께 vm에 올려 실제 코드 경로를 그대로 실행한다(tests/playback-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as realSmplr from '../vendor/smplr/index.mjs';
import { loadPlayback, fakeSmplr } from './playback-harness.mjs';

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.stringify(value); // vm 안에서 만든 객체는 다른 realm이라 deepEqual 대신 문자열로 비교한다

// 헤더는 바로 오고 본문은 늦게 오는 가짜 fetch. '진행 중'은 요청이 시작된 뒤 본문을 다 읽거나(200),
// 본문을 읽지 않을 응답이 도착하거나(200 아님), 실패할 때까지다.
function slowFetch({ bodyMs = 3, status = () => 200, failOn = () => false } = {}) {
  const log = { calls: [], inFlight: 0, max: 0, done: 0 };
  const finish = () => { log.inFlight--; log.done++; };
  const fetch = async url => {
    log.calls.push(url);
    log.inFlight++; log.max = Math.max(log.max, log.inFlight);
    await Promise.resolve(); // 헤더 도착
    if (failOn(url)) { finish(); throw new Error('network ' + url); }
    const code = status(url);
    if (code !== 200) { finish(); return { status: code, ok: false, headers: {} }; }
    const body = value => async () => { await tick(bodyMs); finish(); return value; };
    return { status: 200, ok: true, headers: {}, arrayBuffer: body(new ArrayBuffer(8)), text: body('text'), json: body({ ok: 1 }) };
  };
  return { fetch, log };
}

const { playback: U } = loadPlayback(); // limitedStorage 단위 검사용(모듈·네트워크는 쓰지 않는다)

test('limitedStorage: 응답 본문을 다 읽을 때까지 슬롯을 잡아 동시 요청이 4개를 넘지 않는다', async () => {
  const { fetch, log } = slowFetch({ bodyMs: 4 });
  const storage = U.limitedStorage(4, fetch);
  const urls = Array.from({ length: 30 }, (_, i) => 'sample/' + i);
  const out = await Promise.all(urls.map(async url => { const res = await storage.fetch(url); await res.arrayBuffer(); return url; }));
  assert.equal(json(out), json(urls));
  assert.equal(log.max, 4, '4개까지는 실제로 동시에 진행하되 넘지 않는다');
  assert.equal(json(log.calls), json(urls), '요청은 들어온 순서대로 시작한다');
  assert.equal(log.done, 30);
  assert.equal(json(storage.stats()), json({ active: 0, waiting: 0, max: 4 }), '끝나면 슬롯이 모두 돌아온다');
});

test('limitedStorage: 본문 읽기는 arrayBuffer·text·json 모두 슬롯을 돌려준다', async () => {
  const { fetch, log } = slowFetch({ bodyMs: 2 });
  const storage = U.limitedStorage(1, fetch);
  const a = await storage.fetch('a'); assert.equal(storage.stats().active, 1); await a.arrayBuffer();
  const b = await storage.fetch('b'); assert.equal(await b.text(), 'text');
  const c = await storage.fetch('c'); assert.equal(c.status, 200); assert.equal(json(await c.json()), json({ ok: 1 }));
  await tick(); // 슬롯 반환은 본문 Promise가 끝난 직후(마이크로태스크)에 일어난다
  assert.equal(storage.stats().active, 0);
  assert.equal(log.max, 1);
});

test('limitedStorage: 200이 아닌 응답과 요청 실패도 슬롯을 돌려줘 대기열이 멈추지 않는다', async () => {
  const { fetch, log } = slowFetch({ bodyMs: 2, status: url => url.endsWith('x') ? 404 : 200, failOn: url => url.endsWith('!') });
  const storage = U.limitedStorage(2, fetch);
  const jobs = [];
  for (let i = 0; i < 12; i++) {
    const url = 'u' + i + (i % 3 === 0 ? 'x' : i % 3 === 1 ? '!' : '');
    jobs.push(storage.fetch(url).then(async res => { if (res.status === 200) await res.arrayBuffer(); return res.status; }, () => 'fail'));
  }
  const out = await Promise.race([Promise.all(jobs), tick(1500).then(() => 'stalled')]);
  assert.notEqual(out, 'stalled', '슬롯이 새서 대기열이 멈췄다');
  assert.equal(json(out), json([404, 'fail', 200, 404, 'fail', 200, 404, 'fail', 200, 404, 'fail', 200]));
  assert.ok(log.max <= 2);
  assert.equal(storage.stats().active, 0);
});

test('limitedStorage: fetch가 동기로 예외를 던져도 슬롯을 돌려준다', async () => {
  const storage = U.limitedStorage(1, () => { throw new Error('sync'); });
  await assert.rejects(storage.fetch('a'), /sync/);
  await assert.rejects(storage.fetch('b'), /sync/);
  assert.equal(storage.stats().active, 0);
});

test('limitedStorage: 본문을 읽지 않고 붙잡고 있어도 holdMs 뒤에는 슬롯을 돌려준다', async () => {
  const { fetch } = slowFetch({ bodyMs: 1 });
  const storage = U.limitedStorage(1, fetch, 25);
  await storage.fetch('never-read'); // 본문을 읽지 않는다
  const started = Date.now();
  const next = await Promise.race([storage.fetch('next'), tick(1500).then(() => 'stalled')]);
  assert.notEqual(next, 'stalled', '붙잡힌 슬롯이 돌아오지 않았다');
  assert.ok(Date.now() - started >= 15, '시간 제한 전에는 기다린다');
  await next.arrayBuffer(); await tick();
  assert.equal(storage.stats().active, 0);
});

test('같은 종류(고음질 피아노) 파트 2개는 loader 하나를 나눠 쓰고, 파트별 버스는 따로 쓴다', async () => {
  const { mod, made, loaders } = fakeSmplr();
  const { playback: P } = loadPlayback({ sampleModule: mod, hq: true });
  const [a, b] = await Promise.all([P.ensureSampleInstrument('piano', 'a'), P.ensureSampleInstrument('piano', 'b')]);
  assert.ok(a.ready && b.ready);
  assert.equal(made.length, 2, '악기 인스턴스는 파트마다 만든다');
  assert.equal(loaders.length, 1, 'SampleLoader는 한 번만 만든다');
  assert.ok(made[0].opts.loader, '피아노는 공유 loader를 받는다');
  assert.equal(made[0].opts.loader, made[1].opts.loader);
  assert.equal(made[0].opts.loader.opts.storage, made[0].opts.storage, 'loader도 제한된 storage를 쓴다');
  assert.equal(made[0].opts.destination, P.partBuses.get('a').input, '파트별 볼륨·팬 경로는 그대로');
  assert.equal(made[1].opts.destination, P.partBuses.get('b').input);
  assert.notEqual(made[0].opts.destination, made[1].opts.destination);
});

test('Soundfont 악기는 loader를 받지 않지만 같은 제한된 storage를 쓴다', async () => {
  const { mod, made, loaders } = fakeSmplr();
  const { playback: P } = loadPlayback({ sampleModule: mod, hq: true });
  await Promise.all([P.ensureSampleInstrument('piano', 'p'), P.ensureSampleInstrument('strings', 's'), P.ensureSampleInstrument('flute', 'f')]);
  const fonts = made.filter(m => m.kind === 'soundfont');
  assert.equal(fonts.length, 2);
  assert.ok(fonts.every(m => m.opts.loader === undefined));
  const piano = made.find(m => m.kind === 'splendid');
  assert.ok(fonts.every(m => m.opts.storage === piano.opts.storage), '모든 악기가 하나의 storage(요청 제한)를 나눠 쓴다');
  assert.equal(loaders.length, 1, 'Soundfont는 loader를 만들지 않는다');
});

test('smplr 모듈에 SampleLoader가 없어도(구버전) 악기는 만들어진다', async () => {
  const { mod, made } = fakeSmplr({ withLoader: false });
  const { playback: P } = loadPlayback({ sampleModule: mod, hq: true });
  const rec = await P.ensureSampleInstrument('piano', 'a');
  assert.ok(rec.ready && !rec.failed);
  assert.equal(made[0].opts.loader, undefined);
  assert.ok(made[0].opts.storage);
});

test('같은 종류는 차례로 로딩한다 — 앞 악기가 준비된 뒤에 다음 악기를 만든다(다른 종류는 기다리지 않는다)', async () => {
  const gates = { splendid: [], soundfont: [] };
  const { mod, made } = fakeSmplr({ makeReady: (_index, kind) => new Promise(resolve => { gates[kind].push(resolve); }) });
  const { playback: P } = loadPlayback({ sampleModule: mod, hq: true });
  const first = P.ensureSampleInstrument('piano', 'a'), second = P.ensureSampleInstrument('piano', 'b'), other = P.ensureSampleInstrument('strings', 's');
  await tick(5);
  assert.equal(made.filter(m => m.kind === 'splendid').length, 1, '두 번째 피아노는 아직 만들지 않는다');
  assert.equal(made.filter(m => m.kind === 'soundfont').length, 1, '다른 종류는 기다리지 않고 바로 만든다');
  gates.splendid[0]();
  await first; await tick(5);
  const pianos = made.filter(m => m.kind === 'splendid');
  assert.equal(pianos.length, 2, '앞 피아노가 준비되자 다음 피아노를 만든다');
  assert.equal(pianos[1].opts.loader, pianos[0].opts.loader);
  gates.splendid[1](); gates.soundfont[0]();
  await Promise.all([second, other]);
});

test('앞 악기 로딩이 실패해도 같은 종류의 다음 악기는 이어서 로딩한다', async () => {
  const { mod } = fakeSmplr({ makeReady: index => index === 0 ? Promise.reject(new Error('boom')) : Promise.resolve() });
  const { playback: P, logs } = loadPlayback({ sampleModule: mod, hq: true });
  const [a, b] = await Promise.all([P.ensureSampleInstrument('piano', 'a'), P.ensureSampleInstrument('piano', 'b')]);
  assert.ok(a.failed && !a.ready);
  assert.ok(b.ready && !b.failed, '실패한 앞 악기가 뒤 악기를 막지 않는다');
  assert.ok(logs.length >= 1);
});

test('악기가 달라도 샘플 요청은 하나의 제한(동시에 4개)을 함께 쓴다', async () => {
  const { fetch, log } = slowFetch({ bodyMs: 4 });
  const fetchAll = (storage, tag, n) => Promise.all(Array.from({ length: n }, async (_, i) => { const res = await storage.fetch(`${tag}/${i}`); await res.arrayBuffer(); }));
  const mod = {
    SampleLoader: (_ctx, opts) => ({ opts, load: async () => new Map() }),
    SplendidGrandPiano: (_ctx, opts) => ({ ready: fetchAll(opts.storage, 'piano', 8), start() {}, stop() {}, dispose() {} }),
    Soundfont: (_ctx, opts) => ({ ready: fetchAll(opts.storage, opts.instrument, 8), start() {}, stop() {}, dispose() {} }),
  };
  const { playback: P } = loadPlayback({ sampleModule: mod, fetch, hq: true });
  await Promise.all([P.ensureSampleInstrument('piano', 'p'), P.ensureSampleInstrument('strings', 's'), P.ensureSampleInstrument('flute', 'f')]);
  assert.equal(log.done, 24);
  assert.equal(log.max, 4, '악기가 셋이어도 동시에 4개를 넘지 않는다');
});

test('실제 smplr: 같은 고음질 피아노 파트 2개를 동시에 준비해도 샘플은 한 번만 내려받고 디코딩한다', async () => {
  const fetched = [];
  const fakeFetch = async url => { fetched.push(url); return { status: 200, ok: true, headers: {}, arrayBuffer: async () => new ArrayBuffer(8) }; };
  const canPlay = globalThis.document.createElement; // 벤더가 오디오 형식을 고를 때 document.createElement('audio')를 쓴다
  globalThis.document.createElement = () => ({ canPlayType: () => 'probably' });
  try {
    const solo = loadPlayback({ sampleModule: realSmplr, fetch: fakeFetch, hq: true });
    await solo.playback.ensureSampleInstrument('piano', 'solo');
    const single = { fetched: fetched.length, decoded: solo.stats.decodes };
    assert.ok(single.decoded > 100, `피아노 샘플이 많아야 이 검사가 의미 있다(${single.decoded}개)`);
    assert.equal(single.fetched, single.decoded);

    fetched.length = 0;
    const duo = loadPlayback({ sampleModule: realSmplr, fetch: fakeFetch, hq: true });
    const [a, b] = await Promise.all([duo.playback.ensureSampleInstrument('piano', 'p1'), duo.playback.ensureSampleInstrument('piano', 'p2')]);
    assert.ok(a.ready && b.ready);
    assert.equal(fetched.length, single.fetched, '두 번째 파트가 같은 샘플을 다시 내려받지 않는다');
    assert.equal(duo.stats.decodes, single.decoded, '두 번째 파트가 같은 샘플을 다시 디코딩하지 않는다');
    assert.equal(new Set(fetched).size, fetched.length, 'URL마다 한 번씩만');
  } finally {
    if (canPlay) globalThis.document.createElement = canPlay; else delete globalThis.document.createElement;
  }
});
