// P4-2 실제 브라우저 확인 — 악보를 갈아 끼우면(실제 앱 흐름) 새 악보에 없는 악기·믹서 버스가 정리되는지 본다.
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
