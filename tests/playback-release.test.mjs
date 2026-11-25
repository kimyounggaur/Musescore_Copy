// Phase 4-2: 쓰지 않는 샘플 악기·loader·믹서 버스를 메모리에서 내리는 releaseUnused와 debugStats.
// (악보 3번 전환 뒤 인스턴스 수 = 현재 파트 수 같은 전체 시나리오는 P4-4의 playback-lifecycle.test.mjs가 맡는다.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SF } from './shim.mjs';
import { loadPlayback, fakeSmplr } from './playback-harness.mjs';

const C = SF.core;
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.stringify(value);
const scoreOf = (...parts) => ({ parts: parts.map(([id, instrument]) => ({ id, instrument })) });
// 피아노 loader(Splendid) 수명을 검사하는 테스트가 많아 기본을 고음질 피아노로 시작한다. hq: false면 기본 음질(Soundfont 피아노).
function boot({ hq = true, ...options } = {}) {
  const smplr = fakeSmplr(options);
  const loaded = loadPlayback({ sampleModule: smplr.mod, hq });
  const ensure = (instrument, partId) => loaded.playback.ensureSampleInstrument(instrument, partId);
  // 파트의 버스로 그 파트의 악기 인스턴스를 찾는다(만들어진 순서는 종류마다 다를 수 있다)
  const instrumentOf = partId => smplr.made.find(inst => inst.opts.destination === loaded.playback.partBuses.get(partId)?.input);
  return { ...smplr, ...loaded, P: loaded.playback, ensure, instrumentOf };
}

test('debugStats: 인스턴스·loader·버스 수를 돌려준다', async () => {
  const { P, ensure } = boot();
  assert.equal(json(P.debugStats()), json({ instances: 0, loaders: 0, buses: 0 }));
  await Promise.all([ensure('piano', 'a'), ensure('piano', 'b'), ensure('strings', 'c')]);
  assert.equal(json(P.debugStats()), json({ instances: 3, loaders: 1, buses: 3 }), '피아노 둘은 loader 하나를 나눠 쓴다');
});

test('악보에서 빠진 파트는 악기를 dispose하고 버스를 지운다', async () => {
  const { P, ensure, instrumentOf } = boot();
  await Promise.all([ensure('piano', 'a'), ensure('piano', 'b'), ensure('strings', 'c')]);
  const inst = { a: instrumentOf('a'), b: instrumentOf('b'), c: instrumentOf('c') };
  let disconnected = 0;
  const busB = P.partBuses.get('b');
  busB.input.disconnect = () => { disconnected++; };
  assert.equal(P.releaseUnused(scoreOf(['a', 'piano'], ['c', 'strings'])), true);
  assert.equal(json([inst.a.disposed, inst.b.disposed, inst.c.disposed]), json([false, true, false]));
  assert.equal(disconnected, 1, '빠진 파트의 버스는 연결을 끊는다');
  assert.equal(P.partBuses.has('b'), false);
  assert.equal(json(P.debugStats()), json({ instances: 2, loaders: 1, buses: 2 }), '피아노가 남아 있는 동안 loader도 남는다');
  assert.equal(P.releaseUnused(scoreOf(['c', 'strings'])), true);
  assert.equal(json(P.debugStats()), json({ instances: 1, loaders: 0, buses: 1 }), '피아노를 쓰는 파트가 없어지면 loader도 버린다');
  assert.equal(inst.a.disposed, true);
  assert.equal(inst.c.disposed, false);
});

test('같은 파트의 악기를 바꾸면 이전 악기만 내리고 파트 버스는 남긴다', async () => {
  const { P, ensure, instrumentOf } = boot();
  await ensure('piano', 'a');
  const piano = instrumentOf('a');
  P.releaseUnused(scoreOf(['a', 'strings']));
  assert.equal(piano.disposed, true);
  assert.equal(json(P.debugStats()), json({ instances: 0, loaders: 0, buses: 1 }), '버스는 신스도 쓰므로 파트가 있는 동안 남는다');
});

test('건반 미리 듣기(preview) 악기와 버스는 지우지 않는다', async () => {
  const { P, ensure, instrumentOf } = boot();
  await Promise.all([ensure('piano', 'preview'), ensure('strings', 'a')]);
  const preview = instrumentOf('preview'), strings = instrumentOf('a');
  P.releaseUnused(scoreOf());
  assert.equal(preview.disposed, false);
  assert.equal(strings.disposed, true);
  assert.equal(json(P.debugStats()), json({ instances: 1, loaders: 1, buses: 1 }));
});

test('재생·재생 준비 중에는 하지 않고, 멈출 때 미뤄 둔 정리를 한다', async () => {
  C.setScore(C.createScore({ measureCount: 1 })); // 멈출 때 정리의 기준이 되는 지금 악보(파트 'a'는 없다)
  const { P, ensure, instrumentOf } = boot();
  await ensure('piano', 'a');
  const inst = instrumentOf('a');
  for (const flag of ['playing', 'loading']) {
    P.player[flag] = true;
    assert.equal(P.releaseUnused(scoreOf()), false, `${flag}: 미룸`);
    assert.equal(inst.disposed, false, `${flag}: 쓰는 중인 악기는 그대로`);
    assert.equal(P.debugStats().instances, 1);
    P.player[flag] = false;
  }
  P.stop(false); // 멈추면 미뤄 둔 정리를 한다
  assert.equal(inst.disposed, true);
  assert.equal(P.debugStats().instances, 0);
});

test('로딩 중에 악보에서 빠지면 악기를 dispose하고, 뒤늦게 끝나도 준비 표시·버스를 만들지 않는다', async () => {
  const gates = [];
  const { P, made, ensure } = boot({ makeReady: () => new Promise(resolve => gates.push(resolve)) });
  const pending = ensure('piano', 'x');
  await tick(2);
  assert.equal(made.length, 1);
  P.releaseUnused(scoreOf());
  assert.equal(made[0].disposed, true);
  assert.equal(json(P.debugStats()), json({ instances: 0, loaders: 0, buses: 0 }));
  gates[0]();
  const rec = await pending;
  assert.equal(rec.ready, false);
  assert.equal(rec.released, true);
  assert.notEqual(P.getSampleStatus().state, 'ready', '해제된 악기가 "샘플 준비"를 알리지 않는다');
});

test('로딩 중에 해제된 악기가 뒤늦게 실패해도 신스 전환을 알리지 않는다', async () => {
  const rejects = [];
  const { P, ensure, logs } = boot({ makeReady: () => new Promise((_, reject) => rejects.push(reject)) });
  const pending = ensure('piano', 'x');
  await tick(2);
  P.releaseUnused(scoreOf());
  rejects[0](new Error('disposed'));
  const rec = await pending;
  assert.equal(rec.released, true);
  assert.notEqual(P.getSampleStatus().state, 'fallback', '의도한 해제를 "샘플을 불러오지 못했다"로 알리지 않는다');
  assert.equal(logs.length, 0);
});

test('모듈을 기다리는 사이 악보에서 빠지면 악기도 버스도 만들지 않는다', async () => {
  const { P, made, ensure } = boot();
  const pending = ensure('piano', 'y');
  P.releaseUnused(scoreOf()); // 같은 틱 — 아직 아무것도 만들어지기 전
  const rec = await pending;
  assert.equal(made.length, 0);
  assert.equal(P.partBuses.has('y'), false);
  assert.equal(rec.released, true);
  assert.equal(json(P.debugStats()), json({ instances: 0, loaders: 0, buses: 0 }));
});

test('같은 종류의 차례를 기다리던 파트가 빠지면 건너뛰고 다음 파트가 이어서 로딩한다', async () => {
  const gates = [];
  const { P, made, ensure } = boot({ makeReady: () => new Promise(resolve => gates.push(resolve)) });
  const first = ensure('piano', 'a'), skipped = ensure('piano', 'b'), last = ensure('piano', 'c');
  await tick(2);
  assert.equal(made.length, 1, '앞 피아노가 끝나기 전에는 하나만 만든다');
  P.releaseUnused(scoreOf(['a', 'piano'], ['c', 'piano'])); // b가 악보에서 빠짐
  gates[0]();
  await first; await skipped; await tick(2);
  assert.equal(made.length, 2, 'b는 만들지 않고 c를 만든다');
  assert.equal(made[1].opts.destination, P.partBuses.get('c').input);
  gates[1]();
  assert.ok((await last).ready);
  assert.equal(P.partBuses.has('b'), false);
});

test('로딩에 실패한 기록을 다시 만들 때 이전 악기를 정리한다', async () => {
  const { P, made, ensure } = boot({ makeReady: index => index === 0 ? Promise.reject(new Error('boom')) : Promise.resolve() });
  const failed = await ensure('piano', 'a');
  assert.ok(failed.failed);
  const retried = await ensure('piano', 'a');
  assert.ok(retried.ready);
  assert.equal(made[0].disposed, true, '실패한 시도가 남긴 악기를 내렸다');
  assert.equal(P.debugStats().instances, 1);
});

test('재생 준비의 맨 앞에서 악보와 맞지 않는 악기를 정리한다', async () => {
  C.setScore(C.createScore({ measureCount: 1 }));
  const { P, made, ensure } = boot();
  await ensure('piano', 'stale-part');
  const stale = made[0];
  await P.play(0, { sampleTimeoutMs: 0 });
  await tick(20);
  P.stop(false);
  assert.equal(stale.disposed, true);
  const parts = C.state.score.parts.filter(part => part.instrument !== 'drums').length;
  assert.equal(P.debugStats().instances, parts, '지금 악보의 파트만 남는다');
  assert.equal(P.partBuses.has('stale-part'), false);
});

test('악보를 갈아 끼우는 통로(installScore) 한 곳에서만 해제를 부른다', () => {
  const dir = new URL('../js/', import.meta.url);
  const callers = [];
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js') && name !== 'playback.js')) {
    const count = (readFileSync(new URL(file, dir), 'utf8').match(/releaseUnused\(/g) || []).length;
    for (let i = 0; i < count; i++) callers.push(file);
  }
  assert.equal(callers.join(), 'app.js', '다른 곳에서 중복 호출하지 않는다');
  const app = readFileSync(new URL('app.js', dir), 'utf8');
  const start = app.indexOf('function installScore'), body = app.slice(start, app.indexOf('\n  }\n', start));
  assert.match(body, /stopPlayback\(\);\s*P\.releaseUnused\(C\.state\.score\);/, '재생을 멈춘 바로 뒤에 부른다');
});
