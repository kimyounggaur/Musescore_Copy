// Phase 4-4: 악기 수명 불변식 — 악보를 몇 번 바꿔도 "살아 있는 샘플 악기 수 = 지금 악보의 파트 수".
// 백로그 #3(악보를 바꿀 때마다 인스턴스가 쌓여 메모리가 불어남)을 자동으로 지키는 테스트다.
// 재생 모듈은 가짜 AudioContext·smplr와 함께 vm에 올리고, smplr는 playback.js의 테스트 훅(__setSmplrModuleForTest)으로 넣는다.
// 앱이 악보를 갈아 끼우는 순서(installScore: setScore → stopPlayback → releaseUnused)와 재생 준비(play)를 그대로 따라 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SF } from './shim.mjs';
import { loadPlayback, fakeSmplr } from './playback-harness.mjs';

const C = SF.core;
const json = value => JSON.stringify(value);
const playable = score => score.parts.filter(part => part.instrument !== 'drums');
const pianoScore = count => C.createScore({ measureCount: 1, parts: Array(count).fill('piano') });
const stringScore = () => C.createScore({ measureCount: 1, parts: ['violin', 'viola', 'cello', 'drumkit'] }); // 드럼 파트는 샘플 악기가 없다(버스만 있다)

function boot({ hq = false } = {}) {
  const smplr = fakeSmplr();
  const loaded = loadPlayback({ sampleModule: smplr.mod, hq, hook: true });
  const P = loaded.playback;
  // 재생 준비: 재생 버튼을 눌러 파트마다 악기를 불러온 뒤 멈춘다(play가 맨 앞에서 정리도 한다)
  const prepare = async () => { await P.play(0, { sampleTimeoutMs: 50 }); P.stop(false); };
  // 앱이 악보를 열 때의 순서(installScore: setScore → stopPlayback → releaseUnused) + 재생 준비
  const open = async score => { C.setScore(score); P.stop(false); P.releaseUnused(C.state.score); await prepare(); };
  return { ...smplr, ...loaded, P, prepare, open };
}

// 지금 악보의 상태가 불변식을 만족하는지 한꺼번에 본다
function assertInvariant({ P, made }, score, { hq, extraInstances = 0, extraBuses = 0 }, label) {
  const stats = P.debugStats(), parts = playable(score);
  const splendidKinds = hq && parts.some(part => part.instrument === 'piano') ? 1 : 0; // 쓰는 Splendid 종류 수(피아노 하나뿐)
  assert.equal(stats.instances, parts.length + extraInstances, `${label}: 샘플 악기 수 = 지금 악보의 연주 파트 수`);
  assert.equal(made.filter(inst => !inst.disposed).length, parts.length + extraInstances, `${label}: 레지스트리 밖에 살아 있는 악기가 없다`);
  assert.equal(stats.buses, score.parts.length + extraBuses, `${label}: 믹서 버스 수 = 지금 악보의 파트 수`);
  assert.ok(stats.loaders <= splendidKinds, `${label}: loader ${stats.loaders}개 > 쓰는 Splendid 종류 ${splendidKinds}개`);
  assert.equal(stats.loaders, splendidKinds, `${label}: 쓰지 않는 loader는 없고, 쓰는 종류의 loader는 있다`);
  const ids = new Set(score.parts.map(part => part.id));
  for (const id of P.partBuses.keys()) assert.ok(ids.has(id) || id === 'preview', `${label}: 악보에 없는 파트의 버스(${id})가 남아 있다`);
}

for (const hq of [false, true]) {
  const mode = hq ? '고음질 피아노' : '기본 피아노';

  test(`${mode}: 피아노 악보 A → 피아노 악보 B(다른 파트 ID) → 현악 악보 C를 세 바퀴 돌려도 악기·loader·버스가 쌓이지 않는다`, async () => {
    const ctx = boot({ hq });
    let created = 0;
    for (let round = 1; round <= 3; round++) {
      for (const [name, make, count] of [['A', () => pianoScore(2), 2], ['B', () => pianoScore(3), 3], ['C', stringScore, 3]]) {
        const before = ctx.made.slice();
        const score = make();
        await ctx.open(score);
        created += count;
        const label = `${round}바퀴 ${name}`;
        assertInvariant(ctx, score, { hq }, label);
        assert.equal(ctx.made.length, created, `${label}: 악기는 파트마다 한 번씩만 만든다`);
        for (const old of before) {
          assert.equal(old.disposed, true, `${label}: 지난 악보의 악기는 dispose됐다`);
          assert.equal(old.disposeCalls, 1, `${label}: 정확히 한 번씩만 dispose한다`);
        }
        for (const inst of ctx.made.filter(item => !before.includes(item))) assert.equal(inst.disposeCalls, 0, `${label}: 지금 악기는 살아 있다`);
      }
    }
    assert.equal(ctx.made.length, 3 * (2 + 3 + 3), '세 바퀴 동안 만든 악기 수는 파트 수의 합과 같다(재사용이 아니라 그때그때 만들고 내린다)');
  });

  test(`${mode}: installScore를 거치지 않고 악보만 바뀌어도 첫 재생 준비에서 정리된다`, async () => {
    const ctx = boot({ hq });
    for (const make of [() => pianoScore(2), () => pianoScore(3), stringScore, () => pianoScore(1)]) {
      const score = make();
      C.setScore(score); // 정리 호출 없이 악보만 바꾼다
      await ctx.prepare();
      assertInvariant(ctx, score, { hq }, '재생 준비만');
    }
  });

  test(`${mode}: 같은 악보를 다시 준비해도 악기를 더 만들지 않는다`, async () => {
    const ctx = boot({ hq });
    const score = pianoScore(2);
    await ctx.open(score);
    const instances = ctx.made.slice();
    await ctx.prepare(); await ctx.prepare();
    assert.equal(ctx.made.length, 2);
    assert.equal(json(instances.map(inst => inst.disposed)), json([false, false]));
    assertInvariant(ctx, score, { hq }, '재준비');
  });

  test(`${mode}: 같은 악보에서 파트의 악기만 바꾸면 이전 악기만 내리고 파트 버스와 다른 파트는 그대로 둔다`, async () => {
    const ctx = boot({ hq });
    const score = pianoScore(2);
    await ctx.open(score);
    const [keep, change] = score.parts, [keepInst, changeInst] = ctx.made.slice();
    const keepBus = ctx.P.partBuses.get(keep.id), changeBus = ctx.P.partBuses.get(change.id);
    C.mutate('악기 바꾸기', s => { s.parts[1].instrument = 'flute'; });
    await ctx.prepare();
    assert.equal(changeInst.disposed, true, '바뀐 파트의 이전 악기는 내린다');
    assert.equal(keepInst.disposed, false, '그대로인 파트의 악기는 건드리지 않는다');
    assert.equal(ctx.made.length, 3, '새 악기 하나만 만든다');
    assert.equal(ctx.P.partBuses.get(keep.id), keepBus);
    assert.equal(ctx.P.partBuses.get(change.id), changeBus, '버스는 신스도 쓰므로 파트가 있는 동안 이어서 쓴다');
    assertInvariant(ctx, C.state.score, { hq }, '악기 변경');
  });

  test(`${mode}: 건반 미리 듣기(preview) 악기와 버스는 악보를 바꿔도 하나씩만 남는다`, async () => {
    const ctx = boot({ hq });
    await ctx.P.ensureSampleInstrument('flute', 'preview');
    for (const make of [() => pianoScore(2), stringScore, () => pianoScore(1)]) {
      const score = make();
      await ctx.open(score);
      assertInvariant(ctx, score, { hq, extraInstances: 1, extraBuses: 1 }, 'preview 포함');
    }
    assert.equal(ctx.made.filter(inst => inst.disposed === false && inst.opts.destination === ctx.P.partBuses.get('preview').input).length, 1);
  });
}

test('악보를 모두 비우는 극단: 파트가 없는 악보로 바꾸면 악기·loader·버스가 모두 사라진다', async () => {
  const ctx = boot({ hq: true });
  await ctx.open(pianoScore(3));
  assert.equal(json(ctx.P.debugStats()), json({ instances: 3, loaders: 1, buses: 3 }));
  ctx.P.releaseUnused({ parts: [] });
  assert.equal(json(ctx.P.debugStats()), json({ instances: 0, loaders: 0, buses: 0 }));
  assert.equal(ctx.made.every(inst => inst.disposed && inst.disposeCalls === 1), true);
});

test('__setSmplrModuleForTest: 넣은 모듈로 악기를 만들고, 다른 모듈로 바꿔 넣을 수 있다', async () => {
  const first = fakeSmplr(), second = fakeSmplr();
  const { playback: P } = loadPlayback({ sampleModule: first.mod, hook: true });
  await P.ensureSampleInstrument('flute', 'a');
  assert.equal(first.made.length, 1);
  assert.equal(second.made.length, 0);
  P.__setSmplrModuleForTest(second.mod);
  await P.ensureSampleInstrument('flute', 'b');
  assert.equal(first.made.length, 1, '바꾼 뒤에는 이전 모듈을 쓰지 않는다');
  assert.equal(second.made.length, 1);
  // null(또는 모듈이 아닌 값)을 주면 훅을 풀고 원래 import 경로로 돌아간다. vm 안에는 동적 import가 없어 불러오기는 실패하므로 악기는 만들어지지 않는다
  for (const off of [null, 'not a module', undefined]) {
    P.__setSmplrModuleForTest(second.mod);
    P.__setSmplrModuleForTest(off);
    const rec = await P.ensureSampleInstrument('flute', 'off-' + String(off));
    assert.equal(rec.ready, false, `훅 해제(${String(off)})`);
    assert.equal(second.made.length, 1, `훅 해제(${String(off)}) 뒤에는 넣어 둔 모듈을 쓰지 않는다`);
  }
});

test('테스트 훅은 playback.js 밖에서 쓰이지 않는다 — 앱 코드는 실제 smplr만 쓴다', () => {
  const dir = new URL('../js/', import.meta.url);
  const users = readdirSync(dir).filter(name => name.endsWith('.js') && name !== 'playback.js' && readFileSync(new URL(name, dir), 'utf8').includes('__setSmplrModuleForTest'));
  assert.equal(users.join(), '');
  const source = readFileSync(new URL('playback.js', dir), 'utf8');
  assert.equal((source.match(/import\("\.\.\/vendor\/smplr\/index\.mjs"\)/g) || []).length, 1, '실제 import는 한 곳뿐');
});
