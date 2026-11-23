// Phase 4-3: 기본 피아노 음원(결정 D2-A) — 기본은 가벼운 Soundfont 피아노, 설정에서 고르면 큰 Splendid 피아노(고음질).
// 재생 모듈은 가짜 AudioContext·smplr 모듈과 함께 vm에 올려 실제 코드 경로를 그대로 실행한다(tests/playback-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SF } from './shim.mjs';
import { loadPlayback, fakeSmplr, PIANO_QUALITY_KEY } from './playback-harness.mjs';

const C = SF.core;
const json = value => JSON.stringify(value);
const twoPartScore = () => { const score = C.createScore({ measureCount: 1, parts: ['piano', 'violin'] }); C.setScore(score); return score; };
function boot({ smplr, ...load } = {}) {
  const fake = fakeSmplr(smplr);
  const loaded = loadPlayback({ sampleModule: fake.mod, ...load });
  const busOf = partId => loaded.playback.partBuses.get(partId)?.input;
  const instrumentOf = partId => fake.made.find(inst => inst.opts.destination === busOf(partId));
  return { ...fake, ...loaded, P: loaded.playback, instrumentOf };
}

test('기본 피아노는 가벼운 Soundfont(acoustic_grand_piano)이고 Splendid·loader는 만들지 않는다', async () => {
  const { P, made, loaders } = boot();
  assert.equal(P.getPianoQuality(), 'basic');
  await P.ensureSampleInstrument('piano', 'a');
  assert.equal(made.length, 1);
  assert.equal(made[0].kind, 'soundfont');
  assert.equal(made[0].opts.instrument, 'acoustic_grand_piano');
  assert.equal(made[0].opts.loader, undefined);
  assert.equal(loaders.length, 0, '큰 피아노용 SampleLoader는 만들지 않는다');
  assert.equal(json(P.debugStats()), json({ instances: 1, loaders: 0, buses: 1 }));
  assert.equal(made[0].opts.storage.stats().max, 4, '기본 음원도 같은 요청 제한을 쓴다');
});

test('고음질을 골라 둔 기기는 Splendid 피아노가 loader를 나눠 쓴다', async () => {
  const { P, made, loaders } = boot({ hq: true });
  assert.equal(P.getPianoQuality(), 'hq');
  await Promise.all([P.ensureSampleInstrument('piano', 'a'), P.ensureSampleInstrument('piano', 'b')]);
  assert.equal(made.length, 2);
  assert.ok(made.every(inst => inst.kind === 'splendid'));
  assert.equal(loaders.length, 1);
  assert.equal(made[0].opts.loader, made[1].opts.loader);
});

test('피아노 이외의 악기는 음질 설정과 상관없이 같은 음원을 쓴다', async () => {
  const names = async hq => {
    const { P, made } = boot({ hq });
    await Promise.all(['strings', 'flute', 'epiano', 'organ', 'guitar'].map((instrument, index) => P.ensureSampleInstrument(instrument, 'p' + index)));
    return json(made.map(inst => [inst.kind, inst.opts.instrument]));
  };
  assert.equal(await names(false), await names(true));
});

test('설정은 이 기기(localStorage)에 저장되고, 다시 열어도 이어진다', () => {
  const first = boot();
  assert.equal(first.data.size, 0, '아무것도 고르지 않았으면 아무것도 저장하지 않는다');
  assert.equal(first.P.setPianoQuality('hq'), 'hq');
  assert.equal(first.data.get(PIANO_QUALITY_KEY), 'hq');
  assert.equal(first.P.getPianoQuality(), 'hq');
  const reopened = boot({ store: Object.fromEntries(first.data) });
  assert.equal(reopened.P.getPianoQuality(), 'hq', '새로 연 앱이 고른 음질을 이어받는다');
  assert.equal(reopened.P.setPianoQuality('basic'), 'basic');
  assert.equal(reopened.data.get(PIANO_QUALITY_KEY), 'basic');
  assert.equal(boot({ store: Object.fromEntries(reopened.data) }).P.getPianoQuality(), 'basic');
});

test('알 수 없는 저장값·입력은 기본 음질로 본다', () => {
  for (const stored of ['HQ', 'high', '', '1', 'true', 'null', ' hq']) {
    assert.equal(boot({ store: { [PIANO_QUALITY_KEY]: stored } }).P.getPianoQuality(), 'basic', `저장값 ${JSON.stringify(stored)}`);
  }
  const { P } = boot({ hq: true });
  for (const bad of ['x', '', undefined, null, 1, {}]) {
    assert.equal(P.setPianoQuality('hq'), 'hq');
    assert.equal(P.setPianoQuality(bad), 'basic', `입력 ${JSON.stringify(bad)}`);
  }
});

test('저장소가 막힌 브라우저에서도 예외 없이 동작하고 이번 방문 동안은 고른 값을 쓴다', async () => {
  const { P, made } = boot({ blockedStorage: true });
  assert.equal(P.getPianoQuality(), 'basic');
  assert.equal(P.setPianoQuality('hq'), 'hq');
  assert.equal(P.getPianoQuality(), 'hq');
  await P.ensureSampleInstrument('piano', 'a');
  assert.equal(made[0].kind, 'splendid');
});

test('같은 값을 다시 고르면 아무것도 하지 않는다 — 저장도, 재생 정지도, 악기 해제도 없다', async () => {
  const { P, made, data } = boot();
  await P.ensureSampleInstrument('piano', 'a');
  P.player.playing = true;
  assert.equal(P.setPianoQuality('basic'), 'basic');
  assert.equal(P.player.playing, true, '재생을 멈추지 않는다');
  assert.equal(made[0].disposed, false);
  assert.equal(data.size, 0, '저장도 하지 않는다');
  P.player.playing = false;
});

test('음질을 바꾸면 이전 음질의 피아노만 내리고 다른 악기·파트 버스는 그대로 둔다', async () => {
  const score = twoPartScore();
  const [piano, strings] = score.parts;
  const { P, made, instrumentOf } = boot();
  await Promise.all([P.ensureSampleInstrument('piano', piano.id), P.ensureSampleInstrument('strings', strings.id)]);
  const basicPiano = instrumentOf(piano.id), stringsInst = instrumentOf(strings.id);
  assert.equal(basicPiano.kind, 'soundfont');
  assert.equal(json(P.debugStats()), json({ instances: 2, loaders: 0, buses: 2 }));

  P.setPianoQuality('hq');
  assert.equal(basicPiano.disposed, true, '쓰지 않게 된 기본 피아노는 메모리에서 내린다');
  assert.equal(stringsInst.disposed, false, '피아노가 아닌 악기는 건드리지 않는다');
  assert.equal(json(P.debugStats()), json({ instances: 1, loaders: 0, buses: 2 }), '파트 버스는 파트가 악보에 있는 동안 남는다');

  const rec = await P.ensureSampleInstrument('piano', piano.id);
  assert.ok(rec.ready);
  const hqPiano = made.find(inst => inst.kind === 'splendid');
  assert.ok(hqPiano, '새 음질의 피아노를 만들었다');
  assert.equal(hqPiano.kind, 'splendid');
  assert.ok(hqPiano.opts.loader);
  assert.equal(hqPiano.opts.destination, basicPiano.opts.destination, '같은 파트 버스를 이어서 쓴다(볼륨·팬 유지)');
  assert.equal(json(P.debugStats()), json({ instances: 2, loaders: 1, buses: 2 }));

  P.setPianoQuality('basic');
  assert.equal(hqPiano.disposed, true, '고음질 피아노도 내리고');
  assert.equal(json(P.debugStats()), json({ instances: 1, loaders: 0, buses: 2 }), 'loader(디코딩된 큰 샘플)도 함께 버린다');
  assert.equal(made.filter(inst => !inst.disposed).length, 1);
});

test('재생 중에 음질을 바꾸면 재생을 멈추고, 쓰던 피아노는 멈춘 뒤에 내린다', async () => {
  for (const flag of ['playing', 'loading']) {
    const score = twoPartScore();
    const { P, instrumentOf } = boot();
    await P.ensureSampleInstrument('piano', score.parts[0].id);
    const inst = instrumentOf(score.parts[0].id);
    let notified = null;
    P.player.onState = playing => { notified = playing; };
    P.player[flag] = true;
    P.setPianoQuality('hq');
    assert.equal(P.player[flag], false, `${flag}: 곡 도중에 음원이 바뀌지 않게 먼저 멈춘다`);
    assert.equal(notified, false, `${flag}: 화면의 재생 버튼이 멈춤 상태로 돌아온다`);
    assert.equal(inst.disposed, true, `${flag}: 멈춘 뒤에 이전 음질의 악기를 내린다`);
    assert.equal(P.getPianoQuality(), 'hq');
  }
});

test('악보에는 음질을 저장하지 않는다 — 저장·내보내기 데이터는 음질 설정과 무관하다', () => {
  const { P } = boot();
  const score = twoPartScore();
  const before = json(score), midiBefore = Buffer.from(P.exportMidi(C.state.score)).toString('hex');
  assert.ok(midiBefore.length > 0);
  P.setPianoQuality('hq');
  assert.equal(json(C.state.score), before, '음질을 바꿔도 악보 객체는 그대로');
  assert.equal(Buffer.from(P.exportMidi(C.state.score)).toString('hex'), midiBefore, 'MIDI 내보내기도 그대로');
  assert.equal(before.includes('pianoQuality'), false);
});

test('설정 화면: 선택 상자가 있고, 열 때 현재 음질을 보여 주며, 바꾸면 저장 함수를 부른다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const panels = readFileSync(new URL('../js/panels.js', import.meta.url), 'utf8');
  const select = html.match(/<select id="set-piano-quality"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, '#set-piano-quality 선택 상자');
  assert.deepEqual([...select[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m => [m[1], m[2]]), [['basic', '기본'], ['hq', '고음질(약 19MB)']]);
  assert.match(html, /<label for="set-piano-quality">피아노 음질<\/label>\s*<select id="set-piano-quality"/, '라벨과 선택 상자는 짝으로 놓는다(설정 탭 이동 규칙)');
  assert.match(panels, /\$\("#set-piano-quality"\)\.value = P\.getPianoQuality\(\);/);
  assert.match(panels, /\$\("#set-piano-quality"\)\.addEventListener\("change", \(\) => \{\s*stopPlayback\(\);\s*const quality = P\.setPianoQuality\(\$\("#set-piano-quality"\)\.value\);/);
});
