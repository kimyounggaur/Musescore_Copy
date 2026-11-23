// P4-2·P4-3 실제 브라우저 확인.
//  - P4-2: 악보를 갈아 끼우면(실제 앱 흐름) 새 악보에 없는 악기·믹서 버스가 정리되는지 본다.
//  - P4-3: 설정 창의 '피아노 음질'(기본/고음질)이 이 기기에 저장되고 새로고침 뒤에도 이어지는지 본다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/playback-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

test('악보를 새로 열면 이전 악보의 파트용 샘플 악기와 믹서 버스가 정리된다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 } }));
    const page = await context.newPage();
    await preparePage(page);
    await context.route(/gleitz\.github\.io|smpldsnds\.github\.io|goldst\.dev/, route => route.abort()); // 음원 서버는 쓰지 않는다
    page.setDefaultTimeout(8000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());

    // 옛 악보의 파트 하나가 샘플 악기와 버스를 갖게 한다(음원은 막혀 있어 로딩은 실패하지만 인스턴스와 버스는 생긴다)
    await page.evaluate(() => SF.playback.ensureSampleInstrument('strings', 'ghost-part'));
    const before = await page.evaluate(() => ({ stats: SF.playback.debugStats(), ghostBus: SF.playback.partBuses.has('ghost-part') }));
    assert.ok(before.ghostBus);
    assert.ok(before.stats.instances >= 1);

    // 실제 앱 흐름(파일 메뉴 → 데모)으로 악보를 갈아 끼운다
    await page.click('#btn-file');
    await page.click('#file-menu [data-act="demo-star"]');
    await page.waitForFunction(() => !SF.playback.partBuses.has('ghost-part'));
    const after = await page.evaluate(() => ({ stats: SF.playback.debugStats(), ghostBus: SF.playback.partBuses.has('ghost-part'), parts: SF.core.state.score.parts.map(p => p.id) }));
    assert.equal(after.ghostBus, false);
    assert.ok(after.stats.instances < before.stats.instances, '옛 파트의 인스턴스가 빠졌다');
    assert.ok(after.stats.buses <= after.parts.length + 1, '버스는 현재 악보의 파트(+미리 듣기)만 남는다');
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

const QUALITY_KEY = 'scoreforge.audio.pianoQuality';

test('설정 창의 피아노 음질: 기본은 "기본", 바꾸면 이 기기에 저장되고 새로고침 뒤에도 이어진다(악보에는 들어가지 않는다)', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 } }));
    const page = await context.newPage();
    await preparePage(page);
    await context.route(/gleitz\.github\.io|smpldsnds\.github\.io|goldst\.dev/, route => route.abort()); // 음원 서버는 쓰지 않는다
    page.setDefaultTimeout(8000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.evaluate(key => localStorage.removeItem(key), QUALITY_KEY);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');

    // 처음에는 기본 음질이고, 설정 창을 열어 보기만 해서는 아무것도 저장하지 않는다
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings[open]');
    assert.equal(await page.inputValue('#set-piano-quality'), 'basic');
    const placed = await page.evaluate(() => {
      const select = document.querySelector('#set-piano-quality');
      return { tab: select.closest('#settings-basic') !== null, label: select.labels[0]?.textContent, options: [...select.options].map(o => [o.value, o.textContent]) };
    });
    assert.equal(placed.tab, true, "'기본' 탭 안에 있다");
    assert.equal(placed.label, '피아노 음질');
    assert.deepEqual(placed.options, [['basic', '기본'], ['hq', '고음질(약 19MB)']]);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), QUALITY_KEY), null);
    assert.equal(await page.evaluate(() => SF.playback.getPianoQuality()), 'basic');

    // 고음질로 바꾸면 바로 저장되고(적용 버튼과 무관), 알림이 뜬다
    await page.selectOption('#set-piano-quality', 'hq');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), QUALITY_KEY), 'hq');
    assert.equal(await page.evaluate(() => SF.playback.getPianoQuality()), 'hq');
    assert.match(await page.textContent('#toast'), /고음질 피아노/);
    assert.equal(await page.evaluate(() => JSON.stringify(SF.core.state.score).includes('pianoQuality')), false, '악보에는 들어가지 않는다');
    await page.evaluate(() => document.querySelector('#dlg-settings').close());

    // 새로고침해도 이어지고, 설정 창에도 그대로 보인다
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    assert.equal(await page.evaluate(() => SF.playback.getPianoQuality()), 'hq');
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings[open]');
    assert.equal(await page.inputValue('#set-piano-quality'), 'hq');

    // 다시 기본으로
    await page.selectOption('#set-piano-quality', 'basic');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), QUALITY_KEY), 'basic');
    assert.equal(await page.evaluate(() => SF.playback.getPianoQuality()), 'basic');
    assert.match(await page.textContent('#toast'), /기본 피아노/);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('영어 화면에서도 피아노 음질 라벨·선택지·안내·알림이 영어로 보인다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ locale: 'en-US', viewport: { width: 1440, height: 1000 } }));
    const page = await context.newPage();
    await preparePage(page);
    await context.route(/gleitz\.github\.io|smpldsnds\.github\.io|goldst\.dev/, route => route.abort());
    page.setDefaultTimeout(8000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('scoreforge.welcomed', '1'); });
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings[open]');
    const shown = await page.evaluate(() => {
      const select = document.querySelector('#set-piano-quality');
      return { lang: document.documentElement.lang, label: select.labels[0]?.textContent, title: select.title, options: [...select.options].map(o => o.textContent) };
    });
    assert.equal(shown.lang, 'en');
    assert.equal(shown.label, 'Piano sound quality');
    assert.equal(shown.title, 'Saved on this device only, not in the score. Applies from the next playback.');
    assert.deepEqual(shown.options, ['Basic', 'High quality (about 19 MB)']);
    await page.selectOption('#set-piano-quality', 'hq');
    assert.match(await page.textContent('#toast'), /^Switched to the high-quality piano/);
    await page.selectOption('#set-piano-quality', 'basic');
    assert.match(await page.textContent('#toast'), /^Switched to the standard piano/);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
