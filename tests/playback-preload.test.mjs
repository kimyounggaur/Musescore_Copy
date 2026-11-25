// P9-4: 재생 미리 로딩과 "음원 준비 중" 선택 안내.
// 재생 모듈은 가짜 AudioContext·smplr와 함께 vm에 올려 실제 코드 경로를 그대로 실행한다(tests/playback-harness.mjs).
// 악기마다 준비 시점을 시험이 쥐고(gate) 있어서 "하나씩 받는다", "준비되기 전에는 시작하지 않는다" 같은 순서를 정확히 본다.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SF } from './shim.mjs';
import { loadPlayback, fakeSmplr, PRELOAD_KEY } from './playback-harness.mjs';

const C = SF.core;
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
// 멈춰 버린 시험이 변이 검사·CI를 오래 붙잡지 않도록 시험마다 시간 제한을 둔다(정상 시험은 모두 1~2초 안에 끝난다).
const test = (name, fn, timeout = 8000) => baseTest(name, { timeout }, fn);
// 끝나야 할 일이 영영 안 끝나면(대기 중인 약속이 안 풀리면) 시간 제한까지 매달리지 않고 곧바로 timeout 결과로 실패하게 한다.
const settle = (promise, ms = 400) => Promise.race([promise, tick(ms).then(() => ({ status: 'timeout' }))]);
// P.play처럼 "끝나야 하는" 약속이 시간 안에 끝났는지만 본다(결과값은 보지 않는다).
const finishes = (promise, ms = 600) => Promise.race([promise.then(() => true, () => true), tick(ms).then(() => false)]);
const json = value => JSON.stringify(value);
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const pianoScore = count => C.createScore({ measureCount: 1, parts: Array(count).fill('piano') });
const stringScore = () => C.createScore({ measureCount: 1, parts: ['violin', 'viola', 'cello', 'drumkit'] }); // 연주 파트 3개 + 드럼(샘플 악기 없음)

// 악기 i번의 준비를 시험이 정한다: ok(i)는 준비 완료, fail(i)는 실패
function gates() {
  const list = [];
  const at = index => (list[index] ||= (() => {
    let ok, fail;
    const promise = new Promise((resolve, reject) => { ok = resolve; fail = reject; });
    promise.catch(() => {}); // 만든 악기가 아직 기다리지 않는 사이의 실패가 처리 안 된 거부로 남지 않게
    return { promise, ok, fail };
  })());
  return { makeReady: index => at(index).promise, ok: index => at(index).ok(), fail: index => at(index).fail(new Error('load failed')) };
}

// instant: 악기가 만들어지자마자 준비된다. 아니면 gate로 하나씩 푼다.
function boot({ instant = false, hq = false, ...options } = {}) {
  const gate = gates();
  const smplr = fakeSmplr(instant ? {} : { makeReady: gate.makeReady });
  const loaded = loadPlayback({ sampleModule: smplr.mod, hq, hook: true, idle: true, ...options });
  return { ...smplr, ...loaded, P: loaded.playback, gate };
}

function watchPrompt(P) {
  const log = [];
  P.setSamplePromptHandler(state => log.push(JSON.parse(JSON.stringify(state))));
  return { log, last: () => log.at(-1), opened: () => log.some(state => state.open), opens: () => log.filter(state => state.open).length };
}

/* ---------------- 설정 ---------------- */

test('미리 받기 설정: 기본은 켜짐이고, 읽기만 해서는 아무것도 저장하지 않는다', () => {
  const { P, data } = boot();
  assert.equal(P.getPreloadSetting(), 'on');
  assert.equal(data.has(PRELOAD_KEY), false);
});

test('미리 받기 설정: 바꾸면 이 기기에 저장되고 새로 열어도 이어지며, 알 수 없는 값은 켜짐으로 본다', () => {
  const first = boot();
  assert.equal(first.P.setPreloadSetting('off'), 'off');
  assert.equal(first.data.get(PRELOAD_KEY), 'off');
  assert.equal(boot({ store: { [PRELOAD_KEY]: 'off' } }).P.getPreloadSetting(), 'off');
  assert.equal(boot({ store: { [PRELOAD_KEY]: 'maybe' } }).P.getPreloadSetting(), 'on');
  assert.equal(first.P.setPreloadSetting('maybe'), 'on');
  assert.equal(first.data.get(PRELOAD_KEY), 'on');
});

test('미리 받기 설정: 저장소가 막혀 있어도 오류 없이 이번 접속 동안은 적용된다', () => {
  const { P } = boot({ blockedStorage: true });
  assert.equal(P.getPreloadSetting(), 'on');
  assert.equal(P.setPreloadSetting('off'), 'off');
  assert.equal(P.getPreloadSetting(), 'off');
  assert.equal(P.preloadBlockReason(), 'setting');
});

/* ---------------- 조건 ---------------- */

test('미리 받기 조건: 첫 조작 전에는 하지 않고, 조작 뒤에는 한다', () => {
  const { P } = boot();
  assert.equal(P.preloadBlockReason(), 'gesture');
  P.noteUserGesture();
  assert.equal(P.preloadBlockReason(), null);
});

test('미리 받기 조건: 설정 꺼짐이 가장 먼저이고, 오프라인·데이터 절약·느린 망(2G)이면 하지 않는다', () => {
  const navigator = { onLine: true, connection: { saveData: false, effectiveType: '4g' } };
  const { P } = boot({ navigator });
  P.noteUserGesture();
  assert.equal(P.preloadBlockReason(), null);
  navigator.onLine = false;
  assert.equal(P.preloadBlockReason(), 'offline');
  navigator.onLine = true;
  navigator.connection.saveData = true;
  assert.equal(P.preloadBlockReason(), 'save-data');
  navigator.connection.saveData = false;
  for (const type of ['slow-2g', '2g']) { navigator.connection.effectiveType = type; assert.equal(P.preloadBlockReason(), 'slow', type); }
  for (const type of ['3g', '4g', undefined]) { navigator.connection.effectiveType = type; assert.equal(P.preloadBlockReason(), null, String(type)); }
  P.setPreloadSetting('off');
  navigator.onLine = false;
  assert.equal(P.preloadBlockReason(), 'setting', '설정이 꺼져 있으면 이유는 설정이다');
});

test('미리 받기 조건: navigator나 connection이 없는 환경에서도 동작한다', () => {
  const none = boot();
  none.P.noteUserGesture();
  assert.equal(none.P.preloadBlockReason(), null);
  const bare = boot({ navigator: {} });
  bare.P.noteUserGesture();
  assert.equal(bare.P.preloadBlockReason(), null);
});

/* ---------------- 미리 받기 ---------------- */

test('requestPreload: 첫 조작 전에는 예약도 하지 않고, 조작하면 쉬는 시간에 시작한다', async () => {
  C.setScore(stringScore());
  const { P, made, runIdle, idleCount } = boot({ instant: true });
  const done = P.requestPreload();
  assert.equal(idleCount(), 0, '조작 전에는 쉬는 시간 작업도 만들지 않는다');
  await tick();
  assert.equal(made.length, 0);
  P.noteUserGesture();
  assert.equal(idleCount(), 1, '조작하면 쉬는 시간에 하도록 예약한다');
  await tick();
  assert.equal(made.length, 0, '쉬는 시간이 오기 전에는 시작하지 않는다');
  runIdle();
  assert.equal((await settle(done)).status, 'done');
  assert.equal(made.length, 3);
  assert.equal(P.debugStats().instances, 3);
});

test('requestPreload: 지금 악보의 연주 악기만(드럼 제외) 파트 순서대로 하나씩 받는다', async () => {
  const score = stringScore();
  C.setScore(score);
  const { P, made, gate, runIdle } = boot();
  P.noteUserGesture();
  const done = P.requestPreload();
  runIdle();
  await tick();
  assert.equal(made.length, 1, '첫 악기만 시작한다');
  gate.ok(0); await tick();
  assert.equal(made.length, 2, '앞 악기가 준비된 뒤에 다음을 시작한다');
  gate.ok(1); await tick();
  assert.equal(made.length, 3);
  gate.ok(2);
  const result = await settle(done);
  assert.equal(result.status, 'done');
  assert.equal(result.started, 3, '드럼은 시작한 악기 수에도 세지 않는다');
  assert.equal(made.length, 3, '드럼 파트는 샘플 악기를 만들지 않는다');
  const order = score.parts.filter(part => part.instrument !== 'drums').map(part => P.partBuses.get(part.id).input);
  assert.equal(made.every((inst, i) => inst.opts.destination === order[i]), true, '악기는 파트 순서대로 만들어진다');
});

test('requestPreload: 이미 준비된 악기는 다시 만들지 않는다', async () => {
  C.setScore(pianoScore(2));
  const { P, made, runIdle } = boot({ instant: true });
  P.noteUserGesture();
  for (let round = 0; round < 3; round++) {
    const done = P.requestPreload();
    runIdle();
    assert.equal((await settle(done)).status, 'done');
  }
  assert.equal(made.length, 2);
});

test('requestPreload: 실행하는 순간의 악보를 기준으로 한다(그 사이 악보가 바뀌어도 새 악보의 악기)', async () => {
  C.setScore(stringScore());
  const { P, made, runIdle } = boot({ instant: true });
  P.noteUserGesture();
  const done = P.requestPreload();
  C.setScore(pianoScore(1));
  runIdle();
  assert.equal((await settle(done)).status, 'done');
  assert.equal(made.length, 1);
  assert.equal(made[0].opts.instrument, 'acoustic_grand_piano');
});

test('requestPreload: 새 요청이 오면 이전 요청의 남은 악기는 시작하지 않는다', async () => {
  C.setScore(stringScore());
  const { P, made, gate, runIdle } = boot();
  P.noteUserGesture();
  const first = P.requestPreload();
  runIdle(); await tick();
  assert.equal(made.length, 1);
  const second = P.requestPreload();
  assert.equal((await settle(first)).status, 'cancelled');
  gate.ok(0); await tick();
  assert.equal(made.length, 1, '이전 요청은 다음 악기를 시작하지 않는다');
  runIdle(); await tick();
  assert.equal(made.length, 2, '새 요청이 이어서 받는다(첫 악기는 이미 준비돼 있다)');
  gate.ok(1); gate.ok(2);
  assert.equal((await settle(second)).status, 'done');
});

test('requestPreload: 재생을 시작하면 미리 받기는 물러나고(재생 준비가 로딩을 맡는다), 멈추면 안내도 남지 않는다', async () => {
  C.setScore(stringScore());
  const { P, made, gate, runIdle } = boot();
  P.noteUserGesture();
  const pre = P.requestPreload();
  runIdle(); await tick();
  assert.equal(made.length, 1);
  const playing = P.play(0, { sampleTimeoutMs: 0 });
  assert.equal((await settle(pre)).status, 'cancelled');
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  P.stop(false);
  gate.ok(0); gate.ok(1); gate.ok(2); await tick();
});

test('requestPreload: 재생 중에 요청이 와도 시작하지 않는다(재생 도중에 설정을 켠 경우 포함)', async () => {
  C.setScore(stringScore());
  const { P, made, gate, runIdle, idleCount } = boot({ store: { [PRELOAD_KEY]: 'off' } });
  P.noteUserGesture();
  await P.play(0, { sampleTimeoutMs: 0 }); // 악기는 받는 중이라 신스로 시작한다
  assert.equal(P.player.playing, true);
  const before = made.length;
  P.setPreloadSetting('on');
  assert.equal(idleCount(), 1, '설정을 켜면 쉬는 시간에 하도록 예약은 한다');
  assert.equal(runIdle(), 1);
  await tick();
  assert.equal(made.length, before, '재생 중에는 악기를 새로 시작하지 않는다');
  const again = P.requestPreload();
  runIdle();
  assert.equal((await settle(again)).status, 'cancelled', '재생 중이면 곧바로 물러난다');
  P.stop(false);
  gate.ok(0); gate.ok(1); gate.ok(2); await tick();
});

test('requestPreload: 설정을 끄면 예약한 쉬는 시간 작업도, 진행 중이던 요청의 남은 악기도 그만둔다', async () => {
  C.setScore(stringScore());
  const queued = boot();
  queued.P.noteUserGesture();
  const waiting = queued.P.requestPreload();
  assert.equal(queued.idleCount(), 1);
  queued.P.setPreloadSetting('off');
  assert.equal(queued.idleCount(), 0, '예약한 쉬는 시간 작업을 취소한다');
  assert.equal((await settle(waiting)).status, 'cancelled');
  queued.runIdle(); await tick();
  assert.equal(queued.made.length, 0);

  const running = boot();
  running.P.noteUserGesture();
  const inFlight = running.P.requestPreload();
  running.runIdle(); await tick();
  assert.equal(running.made.length, 1);
  running.P.setPreloadSetting('off');
  assert.equal((await settle(inFlight)).status, 'cancelled');
  running.gate.ok(0); await tick();
  assert.equal(running.made.length, 1, '끈 뒤에는 다음 악기를 시작하지 않는다');
});

test('requestPreload: 설정을 다시 켜면(이미 조작한 뒤라서) 지금 악보를 바로 예약한다', async () => {
  C.setScore(pianoScore(1));
  const { P, made, runIdle, idleCount } = boot({ instant: true, store: { [PRELOAD_KEY]: 'off' } });
  P.noteUserGesture();
  const blocked = await P.requestPreload();
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'setting');
  assert.equal(idleCount(), 0);
  P.setPreloadSetting('on');
  assert.equal(idleCount(), 1);
  runIdle(); await tick();
  assert.equal(made.length, 1);
});

/* ---------------- 쉬는 시간 예약 ---------------- */

test('쉬는 시간 예약: requestIdleCallback이 없으면 setTimeout으로 대신한다', async () => {
  C.setScore(pianoScore(1));
  const { P, made } = boot({ instant: true, idle: false });
  P.noteUserGesture();
  const done = P.requestPreload({ delayMs: 5 });
  assert.equal(made.length, 0, '바로 시작하지 않고 한 박자 쉰다');
  assert.equal((await settle(done)).status, 'done');
  assert.equal(made.length, 1);
});

test('쉬는 시간 예약: setTimeout으로 대신할 때는 정한 시간(delayMs)만큼 기다린 뒤에 시작한다', async () => {
  C.setScore(pianoScore(1));
  const { P, made } = boot({ instant: true, idle: false });
  P.noteUserGesture();
  const t0 = Date.now();
  const done = P.requestPreload({ delayMs: 150 });
  await tick(50);
  assert.equal(made.length, 0, '정한 시간이 지나기 전에는 시작하지 않는다');
  assert.equal((await settle(done)).status, 'done');
  assert.ok(Date.now() - t0 >= 120, '정한 시간만큼 기다렸다');
  assert.equal(made.length, 1);
});

test('쉬는 시간 예약: 실행 직전에 조건을 다시 본다(그 사이 오프라인이 되면 하지 않는다)', async () => {
  C.setScore(pianoScore(1));
  const navigator = { onLine: true };
  const { P, made, runIdle } = boot({ instant: true, navigator });
  P.noteUserGesture();
  const done = P.requestPreload();
  navigator.onLine = false;
  runIdle();
  const result = await settle(done);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'offline');
  assert.equal(made.length, 0);
});

test('쉬는 시간 예약: 조건이 안 맞는 요청은 예약 없이 바로 blocked로 끝난다', async () => {
  C.setScore(pianoScore(1));
  for (const [label, options, expected] of [
    ['설정 꺼짐', { store: { [PRELOAD_KEY]: 'off' } }, 'setting'],
    ['오프라인', { navigator: { onLine: false } }, 'offline'],
    ['데이터 절약', { navigator: { connection: { saveData: true } } }, 'save-data'],
  ]) {
    const { P, made, idleCount } = boot({ instant: true, ...options });
    P.noteUserGesture();
    const result = await P.requestPreload();
    assert.equal(result.status, 'blocked', label);
    assert.equal(result.reason, expected, label);
    assert.equal(idleCount(), 0, label);
    assert.equal(made.length, 0, label);
  }
});

/* ---------------- 재생: 준비 중이면 묻는다 ---------------- */

test('묻기: 안내 상태 알림은 등록하면 닫힌 상태로 한 번 온다', () => {
  const { P } = boot();
  const prompt = watchPrompt(P);
  assert.equal(prompt.log.length, 1);
  assert.equal(prompt.last().open, false);
  assert.equal(P.resolveSamplePrompt('synth'), false, '떠 있는 안내가 없으면 아무 일도 없다');
});

test('묻기: 미리 받기가 끝난 뒤의 첫 재생은 안내 없이 바로 시작하고 모든 샘플을 쓴다', async () => {
  C.setScore(stringScore());
  const { P, runIdle } = boot({ instant: true });
  const prompt = watchPrompt(P);
  P.noteUserGesture();
  const pre = P.requestPreload();
  runIdle();
  await pre;
  assert.equal(await finishes(P.play(0, { samples: 'ask' })), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 3, '첫 재생부터 샘플');
  assert.equal(prompt.opened(), false);
  assert.notEqual(P.getSampleStatus().state, 'fallback');
  P.stop(false);
});

test('묻기: 준비가 안 됐으면 재생을 시작하지 않고 안내를 띄우며, 옛 대기 시간(2.2초)이 지나도 몰래 신스로 넘어가지 않는다', async () => {
  C.setScore(stringScore());
  const { P } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  assert.equal(P.player.loading, true);
  assert.equal(P.player.playing, false);
  assert.equal(json({ open: prompt.last().open, mode: prompt.last().mode, total: prompt.last().total, ready: prompt.last().ready, pending: prompt.last().pending }),
    json({ open: true, mode: 'ask', total: 3, ready: 0, pending: 3 }));
  await tick(2400);
  assert.equal(P.player.playing, false, '2.2초가 지나도 시작하지 않는다');
  assert.equal(prompt.last().open, true);
  P.stop();
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
}, 12000);

test('묻기: "지금은 신스로 재생"을 고르면 곧바로 시작하고, 준비 안 된 악기는 이번 재생에서 쓰지 않는다', async () => {
  C.setScore(stringScore());
  const { P, gate } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  gate.ok(0); await tick();
  assert.equal(P.player.playing, false);
  assert.equal(prompt.last().ready, 1, '준비된 악기 수가 안내에 반영된다');
  assert.equal(prompt.last().pending, 2);
  assert.equal(P.resolveSamplePrompt('synth'), true);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 1, '준비된 악기만 이번 재생에 쓴다');
  assert.equal(prompt.last().open, false);
  assert.equal(P.getSampleStatus().state, 'fallback');
  gate.ok(1); gate.ok(2); await tick();
  assert.equal(P.player.sessionSamples.size, 1, '나중에 준비된 악기는 다음 재생부터(곡 도중에 바꾸지 않는다)');
  P.stop(false);
});

test('묻기: "준비되면 자동 재생"을 고르면 안내가 기다리는 중으로 바뀌고, 모두 준비되면 시작한다', async () => {
  C.setScore(stringScore());
  const { P, gate } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  assert.equal(P.resolveSamplePrompt('wait'), true);
  assert.equal(prompt.last().open, true);
  assert.equal(prompt.last().mode, 'wait');
  gate.ok(0); gate.ok(1); await tick();
  assert.equal(P.player.playing, false, '하나가 남아 있는 동안은 기다린다');
  assert.equal(prompt.last().ready, 2);
  gate.ok(2);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 3);
  assert.equal(prompt.last().open, false);
  P.stop(false);
});

test('묻기: 기다리는 중에도 "지금은 신스로 재생"으로 바꿀 수 있다', async () => {
  C.setScore(stringScore());
  const { P } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  P.resolveSamplePrompt('wait');
  assert.equal(P.resolveSamplePrompt('synth'), true);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 0);
  assert.equal(prompt.last().open, false);
  P.stop(false);
});

test('묻기: 아무것도 고르지 않아도 모두 준비되면 시작한다', async () => {
  C.setScore(stringScore());
  const { P, gate } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  gate.ok(0); gate.ok(1); gate.ok(2);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 3);
  assert.equal(prompt.last().open, false);
  P.stop(false);
});

test('묻기: 모두 실패하면 안내를 닫고 신스로 시작한다', async () => {
  C.setScore(stringScore());
  const { P, gate, logs } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  gate.fail(0); gate.fail(1); gate.fail(2);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 0);
  assert.equal(prompt.last().open, false);
  assert.equal(P.getSampleStatus().state, 'fallback');
  assert.ok(logs.length >= 1, '실패는 콘솔에 남긴다');
  P.stop(false);
});

test('묻기: 안내가 떠 있을 때 멈추면 안내가 닫히고, 나중에 준비돼도 재생은 시작하지 않는다', async () => {
  C.setScore(stringScore());
  const { P, gate } = boot();
  const prompt = watchPrompt(P);
  const playing = P.play(0, { samples: 'ask' });
  await tick();
  assert.equal(prompt.last().open, true);
  P.stop();
  assert.equal(prompt.last().open, false);
  assert.equal(P.player.loading, false);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  gate.ok(0); gate.ok(1); gate.ok(2); await tick();
  assert.equal(P.player.playing, false);
  assert.equal(P.player.loading, false);
});

test('묻기: 안내 중에 다시 재생을 시작하면 이전 시도는 취소되고 새 안내가 뜬다', async () => {
  C.setScore(stringScore());
  const { P, gate } = boot();
  const prompt = watchPrompt(P);
  const first = P.play(0, { samples: 'ask' });
  await tick();
  const second = P.play(0, { samples: 'ask' });
  await tick();
  assert.equal(await finishes(first), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, false);
  assert.equal(prompt.last().open, true, '새 시도의 안내가 떠 있다');
  gate.ok(0); gate.ok(1); gate.ok(2);
  assert.equal(await finishes(second), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true);
  assert.equal(P.player.sessionSamples.size, 3);
  P.stop(false);
});

test('묻기: 지난번에 실패한 악기만 남았으면 묻지 않고 신스로 시작하고, 뒤에서 다시 받아 본다', async () => {
  C.setScore(stringScore());
  const { P, gate, made } = boot();
  const prompt = watchPrompt(P);
  const first = P.play(0, { samples: 'ask' });
  await tick();
  gate.fail(0); gate.fail(1); gate.fail(2);
  assert.equal(await finishes(first), true, '재생 시작 처리가 끝나야 한다');
  P.stop(false);
  const before = prompt.opens();
  assert.equal(await finishes(P.play(0, { samples: 'ask' })), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.playing, true, '곧바로 시작');
  assert.equal(prompt.opens(), before, '안내가 새로 뜨지 않았다');
  await tick();
  assert.ok(made.length > 3, '실패한 악기를 새로 만들어 뒤에서 다시 받아 본다');
  P.stop(false);
});

test('묻기: 일부만 준비돼 있으면 묻고, 안내에는 준비된 수가 나온다', async () => {
  C.setScore(stringScore());
  const { P, gate, runIdle } = boot();
  const prompt = watchPrompt(P);
  P.noteUserGesture();
  const pre = P.requestPreload();
  runIdle(); await tick();
  gate.ok(0); await tick(); // 첫 악기만 준비되고, 미리 받기는 둘째 악기를 기다리는 중
  const playing = P.play(0, { samples: 'ask' });
  assert.equal((await settle(pre)).status, 'cancelled');
  await tick();
  assert.equal(prompt.last().open, true);
  assert.equal(json({ total: prompt.last().total, ready: prompt.last().ready, pending: prompt.last().pending }), json({ total: 3, ready: 1, pending: 2 }));
  gate.ok(1); gate.ok(2);
  assert.equal(await finishes(playing), true, '재생 시작 처리가 끝나야 한다');
  assert.equal(P.player.sessionSamples.size, 3);
  P.stop(false);
});

test('옛 방식(samples 없음)은 그대로: 안내 없이 sampleTimeoutMs만큼 기다렸다가 준비된 것만으로 시작한다', async () => {
  C.setScore(stringScore());
  const { P } = boot();
  const prompt = watchPrompt(P);
  const t0 = Date.now();
  await P.play(0, { sampleTimeoutMs: 60 });
  assert.ok(Date.now() - t0 >= 50, '정해 준 시간만큼 기다린다');
  assert.equal(P.player.playing, true);
  assert.equal(prompt.opened(), false);
  P.stop(false);
});

/* ---------------- 연결(정적 확인) ---------------- */

test('연결: index.html에 선택 안내 띠와 설정 선택 상자가 있고, 라벨과 짝을 이룬다', () => {
  const html = read('index.html');
  assert.match(html, /<div id="sample-wait" class="sample-wait" role="status" hidden>/);
  assert.match(html, /<button type="button" class="sample-wait-btn" data-choice="synth">지금은 신스로 재생<\/button>/);
  assert.match(html, /<button type="button" class="sample-wait-btn" data-choice="wait">준비되면 자동 재생<\/button>/);
  assert.match(html, /<label for="set-sample-preload">음원 미리 받기<\/label>\s*<select id="set-sample-preload"/);
  const select = html.match(/<select id="set-sample-preload"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select);
  assert.equal(json([...select[1].matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)].map(m => [m[1], m[2]])),
    json([['on', '켜기(쉴 때 미리 받아 두기)'], ['off', '끄기(재생할 때만 받기)']]));
});

test('연결: app.js — 재생은 samples:"ask"로, 악보 교체 뒤 미리 받기 요청, 첫 조작 신호, 안내 버튼 연결', () => {
  const app = read('js/app.js');
  const start = app.slice(app.indexOf('function startPlayback'), app.indexOf('function playFromSelection'));
  assert.match(start, /samples: "ask"/);
  const install = app.slice(app.indexOf('function installScore'), app.indexOf('\n  }\n', app.indexOf('function installScore')));
  assert.match(install, /P\.releaseUnused\(C\.state\.score\);[^\n]*\n\s*P\.requestPreload\(\);/, '해제 바로 뒤에 미리 받기를 요청한다');
  assert.match(app, /P\.noteUserGesture\(\)/);
  assert.match(app, /P\.setSamplePromptHandler\(/);
  assert.match(app, /P\.resolveSamplePrompt\(/);
  const panels = read('js/panels.js');
  assert.match(panels, /\$\("#set-sample-preload"\)\.value = P\.getPreloadSetting\(\);/);
  assert.match(panels, /\$\("#set-sample-preload"\)\.addEventListener\("change"/);
});

test('연결: playback.js와 app.js 밖에서는 재생을 직접 시작하지 않는다(안내 방식은 startPlayback 한 곳)', () => {
  const dir = new URL('../js/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js') && name !== 'playback.js' && name !== 'app.js')) {
    assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), /\bP\.play\(|playback\.play\(/, file);
  }
});

test('연결: 개인정보 안내와 제3자 고지(THIRD_PARTY_NOTICES.md·licenses.html)에 "쉬는 시간에 미리 받기"와 끄는 곳이 적혀 있다', () => {
  for (const name of ['privacy.html', 'THIRD_PARTY_NOTICES.md', 'licenses.html']) {
    const text = read(name);
    assert.ok(text.includes('쉬는 시간에 그 악보의 악기를 미리'), name + ': 쉬는 시간에 미리 받는다는 설명');
    assert.ok(text.includes('‘음원 미리 받기’에서 끌 수'), name + ': 끄는 곳(설정 이름)');
  }
  assert.ok(read('privacy.html').includes('데이터 절약 모드나 오프라인에서는 미리 불러오지 않음'), 'privacy.html: 미리 받지 않는 경우');
});

test('연결: 새 문구는 한국어·영어가 모두 있다', () => {
  const source = read('js/i18n.js');
  for (const key of ['sampleWait.asking', 'sampleWait.waiting', 'sampleWait.synth', 'sampleWait.wait', 'settings.samplePreload', 'settings.samplePreloadOn', 'settings.samplePreloadOff', 'settings.samplePreloadHint', 'toast.preloadOn', 'toast.preloadOff']) {
    const [prefix, name] = key.split('.');
    assert.ok(new RegExp(`group\\("${prefix}"[\\s\\S]*?\\n\\s+${name} \\| [^|\\n]+ \\| [^|\\n]+\\n`).test(source), key + ': js/i18n.js에 한국어·영어 문구 한 줄이 있어야 한다');
  }
});
