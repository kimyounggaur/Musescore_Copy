// P9-4 실제 브라우저 확인: 음원 미리 받기와 "음원 준비 중" 선택 안내.
//  a. 설정 창의 "음원 미리 받기"        b. 첫 조작 전에는 음원 서버에 요청하지 않고, 조작한 뒤 그 악보의 악기를 요청
//  c. 설정을 끄거나 데이터 절약이면 요청 없음  d. 음원이 느릴 때의 안내 띠(고르기·취소·자동 시작)
//  e. 미리 받기가 끝난 뒤 첫 재생은 안내 없이 샘플로    f. 좁은 화면(375px)·4개 테마의 안내 띠    g. 영어
// 음원 서버 요청은 시험이 직접 가로채 세고(hits), 느린 서버는 붙잡아 두는(hold) 방식으로 흉내 낸다 — 실제 네트워크는 쓰지 않는다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/playback-preload-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;
const KEY = 'scoreforge.audio.preload';
const SAMPLE_HOSTS = /gleitz\.github\.io|smpldsnds\.github\.io|goldst\.dev/;
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 10000, label = '') {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error('시간 초과: ' + label);
    await tick(40);
  }
}

// harness: true면 다른 브라우저 시험과 같이 미리 받기를 꺼 둔 채 시작한다(tests/browser-launch.mjs). false면 앱의 실제 기본값으로 시작한다.
// hold: true면 음원 요청을 붙잡아 둔다(느린 서버). 끝나면 모두 취소해 정리한다.
async function withApp(fn, { size = { width: 1440, height: 1000 }, hold = false, harness = true, init, locale } = {}) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: size, ...(locale ? { locale } : {}) }));
    const page = await context.newPage();
    if (harness) await preparePage(page);
    const hits = [], held = [];
    await context.route(SAMPLE_HOSTS, route => { hits.push(route.request().url()); if (hold) held.push(route); else route.abort(); });
    page.setDefaultTimeout(10000);
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    if (init) await page.addInitScript(init);
    try { await fn({ page, context, hits, held, problems }); }
    finally { for (const route of held.splice(0)) await route.abort().catch(() => {}); }
  } finally { await browser.close(); }
}

async function boot(page) {
  await page.goto(URL_ + '/', { waitUntil: 'load' });
  // 시작 절차(start())가 악보 준비·글꼴 준비까지 끝난 뒤
  await page.waitForFunction(() => window.SF && SF.core && SF.core.state && SF.core.state.score && SF.engrave && SF.engrave.isFontReady());
}
const stored = page => page.evaluate(key => localStorage.getItem(key), KEY);
const playerState = page => page.evaluate(() => ({ playing: SF.playback.player.playing, loading: SF.playback.player.loading, samples: SF.playback.player.sessionSamples.size }));
const banner = page => page.evaluate(() => {
  // 사용자 눈에 보이는지는 속성이 아니라 실제로 그려지는지(display:none이면 getClientRects가 비어 있다)로 본다
  const bar = document.querySelector('#sample-wait'), visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  return { open: visible(bar), text: document.querySelector('#sample-wait-msg').textContent, synth: visible(bar.querySelector('[data-choice="synth"]')), wait: visible(bar.querySelector('[data-choice="wait"]')) };
});

test('P9-4a 설정 창 "음원 미리 받기": 기본은 켜기, 열기만 해서는 저장하지 않고, 바꾸면 이 기기에 저장되며 새로고침 뒤에도 이어진다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page, problems }) => {
    await boot(page);
    assert.equal(await stored(page), null);
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings[open]');
    assert.equal(await page.inputValue('#set-sample-preload'), 'on', '앱의 기본값은 켜기');
    const placed = await page.evaluate(() => {
      const select = document.querySelector('#set-sample-preload');
      return { tab: select.closest('#settings-basic') !== null, label: select.labels[0]?.textContent, options: [...select.options].map(o => [o.value, o.textContent]), hint: select.title };
    });
    assert.equal(placed.tab, true, "'기본' 탭 안에 있다");
    assert.equal(placed.label, '음원 미리 받기');
    assert.deepEqual(placed.options, [['on', '켜기(쉴 때 미리 받아 두기)'], ['off', '끄기(재생할 때만 받기)']]);
    assert.match(placed.hint, /이 기기에만 저장/);
    assert.equal(await stored(page), null, '열기만 해서는 아무것도 저장하지 않는다');

    await page.selectOption('#set-sample-preload', 'off');
    assert.equal(await stored(page), 'off');
    assert.equal(await page.evaluate(() => SF.playback.getPreloadSetting()), 'off');
    assert.match(await page.locator('#toast').innerText(), /재생할 때만 받을게요/);
    assert.equal((await page.evaluate(() => JSON.stringify(SF.core.state.score))).includes('preload'), false, '악보에는 들어가지 않는다');

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SF && SF.engrave && SF.engrave.isFontReady());
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings[open]');
    assert.equal(await page.inputValue('#set-sample-preload'), 'off', '새로고침 뒤에도 이어진다');
    await page.selectOption('#set-sample-preload', 'on');
    assert.equal(await stored(page), 'on');
    assert.match(await page.locator('#toast').innerText(), /미리 받아 둘게요/);
    assert.deepEqual(problems, []);
  }, { harness: false });
});

test('P9-4b 첫 조작 전에는 음원 서버에 요청하지 않고, 조작한 뒤 쉬는 시간에 그 악보의 악기를 요청한다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page, hits, problems }) => {
    await boot(page);
    await tick(1500);
    assert.deepEqual(hits, [], '조작 전에는 요청이 없다');
    assert.equal(await page.evaluate(() => SF.playback.debugStats().instances), 0);
    await page.keyboard.press('Shift'); // 첫 조작
    await until(() => hits.length > 0, 10000, '조작 뒤 음원 요청');
    assert.ok(hits.every(url => /^https:\/\/gleitz\.github\.io\/midi-js-soundfonts\//.test(url)), hits.join('\n'));
    const parts = await page.evaluate(() => SF.core.state.score.parts.filter(part => part.instrument !== 'drums').length);
    await until(async () => (await page.evaluate(() => SF.playback.debugStats().instances)) === parts, 10000, '그 악보의 악기 수만큼 만들어짐');
    assert.deepEqual(problems, []);
  }, { harness: false });
});

test('P9-4c 설정을 끄면, 데이터 절약 모드이면, 조작해도 음원 서버에 요청하지 않는다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page, hits }) => {
    await boot(page);
    await page.keyboard.press('Shift');
    await tick(1800);
    assert.deepEqual(hits, [], '설정이 꺼져 있다');
    assert.equal(await page.evaluate(() => SF.playback.preloadBlockReason()), 'setting');
  }, { init: () => localStorage.setItem('scoreforge.audio.preload', 'off'), harness: false });
  await withApp(async ({ page, hits }) => {
    await boot(page);
    await page.keyboard.press('Shift');
    await tick(1800);
    assert.deepEqual(hits, [], '데이터 절약 모드');
    assert.equal(await page.evaluate(() => SF.playback.preloadBlockReason()), 'save-data');
  }, { init: () => Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }), harness: false });
});

test('P9-4d 음원이 느릴 때: 재생을 누르면 안내 띠가 뜨고, 기다리기·신스로 재생·멈춤이 되며, 준비가 확정되면 저절로 시작한다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page, held, hits, problems }) => {
    await boot(page);
    // 느린 서버에서 첫 재생: 안내가 뜨고 재생은 시작하지 않는다
    await page.click('#btn-play');
    await page.waitForSelector('#sample-wait:not([hidden])');
    let bar = await banner(page);
    assert.match(bar.text, /^음원 준비 중이에요 \(0\/\d+\)$/);
    assert.equal(bar.synth && bar.wait, true, '버튼 두 개');
    assert.deepEqual(await playerState(page), { playing: false, loading: true, samples: 0 });
    assert.equal(await page.evaluate(() => document.querySelector('#btn-play').classList.contains('on')), true, '재생 버튼은 누른 상태(다시 누르면 취소)');
    await until(() => hits.length >= 1, 10000, '재생이 그 악보의 악기를 요청');

    // "준비되면 자동 재생": 문구가 기다리는 중으로 바뀌고 이 버튼은 사라진다
    await page.focus('#sample-wait [data-choice="wait"]');
    await page.keyboard.press('Enter'); // 키보드로도 고를 수 있다
    bar = await banner(page);
    assert.match(bar.text, /^음원을 받는 중이에요 \(0\/\d+\)\. 준비되면 자동으로 재생해요$/);
    assert.equal(bar.wait, false);
    assert.equal(bar.synth, true);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.choice), 'synth', '누른 버튼이 사라져도 키보드 포커스가 안내 띠 안에 남는다');

    // 재생 버튼을 다시 누르면 취소: 안내가 닫히고 시작하지 않는다
    await page.click('#btn-play');
    await page.waitForSelector('#sample-wait', { state: 'hidden' });
    assert.deepEqual(await playerState(page), { playing: false, loading: false, samples: 0 });

    // "지금은 신스로 재생": 곧바로 시작하고 안내가 닫힌다
    await page.click('#btn-play');
    await page.waitForSelector('#sample-wait:not([hidden])');
    await page.click('#sample-wait [data-choice="synth"]');
    await page.waitForSelector('#sample-wait', { state: 'hidden' });
    await until(async () => (await playerState(page)).playing, 5000, '신스로 재생 시작');
    assert.equal((await playerState(page)).samples, 0, '준비 안 된 음원은 쓰지 않는다');
    await page.click('#btn-play');
    await until(async () => !(await playerState(page)).playing, 5000, '정지');

    // 아무것도 고르지 않아도 준비가 확정(여기서는 서버가 끊김 → 실패)되면 저절로 시작하고 안내가 닫힌다
    await page.click('#btn-play');
    await page.waitForSelector('#sample-wait:not([hidden])');
    for (const route of held.splice(0)) await route.abort();
    await until(async () => (await playerState(page)).playing, 8000, '실패가 확정되면 신스로 시작');
    assert.equal((await banner(page)).open, false);
    await page.click('#btn-play');
    assert.deepEqual(problems, []);
  }, { hold: true });
});

test('P9-4e 미리 받기가 끝난 뒤의 첫 재생은 안내 없이 바로 시작하고 모든 샘플을 쓴다(가짜 음원 모듈, 네트워크 없음)', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page, hits, problems }) => {
    await boot(page);
    // 앱의 실제 로딩 경로(미리 받기·재생)는 그대로 두고 smplr 모듈만 가짜로 바꿔 끼운다
    await page.evaluate(() => {
      window.__made = [];
      const make = (kind, opts) => { const inst = { kind, opts, ready: Promise.resolve(), start() {}, stop() {}, dispose() {} }; window.__made.push(inst); return inst; };
      SF.playback.__setSmplrModuleForTest({ Soundfont: (ctx, opts) => make('soundfont', opts), SplendidGrandPiano: (ctx, opts) => make('splendid', opts) });
    });
    assert.equal(await page.evaluate(() => window.__made.length), 0, '조작 전에는 만들지 않는다');
    await page.keyboard.press('Shift');
    const parts = await page.evaluate(() => SF.core.state.score.parts.filter(part => part.instrument !== 'drums').length);
    await until(async () => (await page.evaluate(() => window.__made.length)) === parts, 10000, '쉬는 시간에 미리 받기');
    await until(async () => (await page.evaluate(() => SF.playback.getSampleStatus().state)) === 'ready', 5000, '샘플 준비 표시');
    assert.equal(await page.locator('#sample-status').innerText(), '샘플 준비');
    await page.click('#btn-play');
    await until(async () => (await playerState(page)).playing, 5000, '재생 시작');
    const state = await playerState(page);
    assert.equal(state.samples, parts, '첫 재생부터 모든 파트가 샘플');
    assert.equal((await banner(page)).open, false, '안내가 한 번도 뜨지 않았다');
    assert.equal(await page.evaluate(() => SF.playback.getSampleStatus().state), 'ready');
    await page.click('#btn-play');
    assert.deepEqual(hits, [], '가짜 모듈이라 음원 서버 요청이 없다');
    assert.deepEqual(problems, []);
  }, { init: () => localStorage.setItem('scoreforge.audio.preload', 'on') });
});

test('P9-4f 좁은 화면(375px)에서 안내 띠가 화면 안에 들어오고 버튼을 누를 수 있으며, 4개 테마에서 글자 대비가 4.5:1 이상이다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page }) => {
    await boot(page);
    await page.evaluate(() => SF.app.actions.startPlayback(0));
    await page.waitForSelector('#sample-wait:not([hidden])');
    const themes = await page.evaluate(() => [...document.querySelectorAll('#theme-select option')].map(option => option.value));
    assert.ok(themes.length >= 4, themes.join());
    for (const theme of themes) {
      await page.evaluate(name => SF.app.actions.applyTheme(name, { silent: true }), theme);
      const row = await page.evaluate(() => {
        const numbers = text => (text.match(/[\d.]+/g) || []).map(Number);
        const luminance = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const backgroundOf = element => { for (let node = element; node; node = node.parentElement) { const [r, g, b, a = 1] = numbers(getComputedStyle(node).backgroundColor); if (a > 0.5) return [r, g, b]; } return [255, 255, 255]; };
        const ratio = element => { const [high, low] = [luminance(numbers(getComputedStyle(element).color).slice(0, 3)), luminance(backgroundOf(element))].sort((a, b) => b - a); return (high + 0.05) / (low + 0.05); };
        const bar = document.querySelector('#sample-wait'), rect = bar.getBoundingClientRect();
        const buttons = [...bar.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { label: button.textContent, w: r.width, h: r.height, ratio: ratio(button) }; });
        return { rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, inner: { w: innerWidth, h: innerHeight }, msgRatio: ratio(document.querySelector('#sample-wait-msg')), buttons };
      });
      assert.ok(row.rect.left >= 0 && row.rect.right <= row.inner.w + 0.5, `${theme}: 가로로 화면 밖으로 나간다 ${JSON.stringify(row.rect)}`);
      assert.ok(row.rect.top >= 0 && row.rect.bottom <= row.inner.h, `${theme}: 세로로 화면 밖으로 나간다 ${JSON.stringify(row.rect)}`);
      assert.ok(row.msgRatio >= 4.5, `${theme}: 안내 문구 대비 ${row.msgRatio.toFixed(2)}:1`);
      assert.equal(row.buttons.length, 2);
      for (const button of row.buttons) {
        assert.ok(button.ratio >= 4.5, `${theme}: '${button.label}' 버튼 글자 대비 ${button.ratio.toFixed(2)}:1`);
        assert.ok(button.h >= 40 && button.w >= 40, `${theme}: '${button.label}' 버튼이 너무 작다 ${button.w}x${button.h}`);
      }
    }
    // 좁은 화면에서 버튼이 실제로 눌린다(다른 것에 가려지지 않는다)
    await page.locator('#sample-wait [data-choice="synth"]').click();
    await until(async () => (await playerState(page)).playing, 5000, '좁은 화면에서도 신스로 재생 시작');
    await page.evaluate(() => SF.playback.stop());
  }, { hold: true, size: { width: 375, height: 760 } });
});

test('P9-4g 영어로 바꾸면 안내 띠·설정 문구가 영어로 나온다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => SF.i18n && SF.i18n.lang === 'en');
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings[open]');
    assert.equal(await page.locator('label[for="set-sample-preload"]').innerText(), 'Preload instrument sounds');
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('#set-sample-preload').options].map(o => o.textContent)), ['On (download ahead while idle)', 'Off (download only when playing)']);
    await page.evaluate(() => document.querySelector('#dlg-settings').close());
    await page.evaluate(() => SF.app.actions.startPlayback(0));
    await page.waitForSelector('#sample-wait:not([hidden])');
    assert.match((await banner(page)).text, /^Instrument sounds are getting ready \(0\/\d+\)$/);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#sample-wait button')].map(b => b.textContent)), ['Play with the built-in synth now', 'Play automatically when ready']);
    await page.click('#sample-wait [data-choice="wait"]');
    assert.match((await banner(page)).text, /^Getting the instrument sounds \(0\/\d+\)\. Playback starts automatically when ready$/);
    await page.evaluate(() => SF.playback.stop());
  }, { hold: true, locale: 'en-US' });
});

test('P9-4h 시험 도우미(preparePage)로 연 페이지는 미리 받기가 꺼져 있고(다른 브라우저 시험이 음원 요청에 흔들리지 않게), 시험이 미리 정한 값은 덮어쓰지 않는다', { skip, timeout: 120000 }, async () => {
  await withApp(async ({ page, hits }) => {
    await boot(page);
    assert.equal(await stored(page), 'off');
    assert.equal(await page.evaluate(() => SF.playback.getPreloadSetting()), 'off');
    await page.keyboard.press('Shift');
    await tick(1500);
    assert.deepEqual(hits, [], '조작해도 음원 요청이 없다');
    assert.equal((await banner(page)).open, false, '안내 띠는 평소에 그려지지 않는다');
  });
  await withApp(async ({ page }) => {
    await boot(page);
    assert.equal(await stored(page), 'on', '시험이 정해 둔 값을 도우미가 덮어쓰지 않는다');
  }, { init: () => localStorage.setItem('scoreforge.audio.preload', 'on') });
});

test('P9-4i 첫 조작은 클릭·키 입력·터치 어느 쪽이든 센다(마우스를 움직이거나 스크롤하는 것만으로는 세지 않는다)', { skip, timeout: 120000 }, async () => {
  const gestures = [
    ['클릭', page => page.mouse.click(720, 560)],
    ['키 입력', page => page.keyboard.press('Shift')],
    ['터치', page => page.evaluate(() => document.dispatchEvent(new Event('touchstart', { bubbles: true })))],
  ];
  for (const [label, act] of gestures) {
    await withApp(async ({ page, hits }) => {
      await boot(page);
      await page.mouse.move(300, 300);
      await page.mouse.wheel(0, 60);
      await tick(1200);
      assert.deepEqual(hits, [], `${label}: 마우스를 움직이거나 스크롤하기만 해서는 요청이 없다`);
      assert.equal(await page.evaluate(() => SF.playback.preloadBlockReason()), 'gesture', `${label}: 아직 첫 조작 전이다`);
      await act(page);
      await until(() => hits.length > 0, 10000, `${label} 뒤 음원 요청`);
      assert.equal(await page.evaluate(() => SF.playback.preloadBlockReason()), null, `${label}: 조작 뒤에는 미리 받을 수 있다`);
    }, { harness: false });
  }
});
