// P5 R-1: "내보낸 악보에는 클릭 영역(.note-hit)이 하나도 없다"를 실제 브라우저의 내보내기 경로로 확인한다.
//  - 화면의 악보(#svg-host)에는 음표머리마다 .note-hit이 있지만,
//  - SVG 내보내기(SF.exportUI.download('svg')가 내려받는 파일)·쪽 목록(exportPages, PNG도 이 쪽을 그림으로 바꾼다)·인쇄 미리보기 영역(#print-pages)에는 0개여야 한다.
//    (내보낸 SVG에는 앱의 CSS가 따라가지 않으므로 .note-hit이 들어가면 검은 타원이 악보에 찍힌다 — F15)
//  - 내보낸 뒤에도 화면의 악보는 그대로이고, 다음 편집의 화면용 그리기는 다시 클릭 영역을 그린다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/export-hits-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

test('내보내기(SVG 파일·쪽 목록·인쇄 영역)에는 .note-hit이 0개이고, 화면 악보의 클릭 영역은 그대로다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }));
    const page = await context.newPage();
    await preparePage(page);
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const screenState = () => page.evaluate(() => ({
      hits: document.querySelectorAll('#svg-host .note-hit').length,
      noteheads: [...SF.app.actions.getLayoutCache().eventsById.values()].reduce((n, le) => n + (le.noteheads?.length || 0), 0),
      html: document.querySelector('#svg-host').innerHTML.length,
    }));

    // 화음·2성부·두 보표가 섞인 짧은 악보 — 클릭 영역이 여러 종류로 생기는 경우
    await page.evaluate(() => {
      const C = SF.core, F = SF.F, q = { n: 1, d: 4, dots: 0 };
      C.setScore(C.createScore({ ensemble: 'piano', measureCount: 2 }));
      C.mutate('fill', score => {
        C.inputAt(score, 0, F(0), q, [{ step: 0, alter: 0, oct: 4 }, { step: 1, alter: 0, oct: 4 }, { step: 4, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 });
        C.inputAt(score, 0, F(0), q, [{ step: 2, alter: 0, oct: 3 }], { partIdx: 0, staffIdx: 0, voice: 2 });
        C.inputAt(score, 0, F(0), q, [{ step: 0, alter: 0, oct: 2 }, { step: 4, alter: 0, oct: 2 }], { partIdx: 0, staffIdx: 1, voice: 1 });
        C.inputAt(score, 1, F(0), q, [{ step: 5, alter: 0, oct: 5 }], { partIdx: 0, staffIdx: 0, voice: 1 });
      });
      SF.app.update({ immediate: true });
    });
    await settle();
    const before = await screenState();
    assert.equal(before.noteheads, 7, '화음 3 + 2성부 1 + 왼손 화음 2 + 둘째 마디 1');
    assert.equal(before.hits, before.noteheads, '화면 악보에는 음표머리마다 클릭 영역이 있다(전제)');

    // ① 쪽 목록(exportPages) — SVG 내보내기와 PNG 내보내기가 모두 이 결과를 쓴다
    const pages = await page.evaluate(async () => (await SF.exportUI.exportPages()).pages);
    assert.ok(pages.length >= 1);
    assert.ok(pages.every(svg => svg.includes('data-note=')), '내보낸 쪽에도 음표머리 그룹은 그대로 있다');
    assert.equal(pages.join('').includes('note-hit'), false, 'exportPages 결과에 note-hit 없음');
    assert.deepEqual(await screenState(), before, '내보내기를 만든 뒤에도 화면 악보는 그대로');

    // ② SVG 내보내기: 실제로 내려받아지는 파일의 내용
    const pending = page.waitForEvent('download');
    await page.evaluate(() => SF.exportUI.download('svg'));
    const download = await pending;
    const file = await readFile(await download.path(), 'utf8');
    assert.ok(file.startsWith('<svg') || file.includes('<svg'), '내려받은 파일은 SVG');
    assert.ok(file.includes('data-note='), '내려받은 SVG에도 음표머리 그룹이 있다');
    assert.equal(file.includes('note-hit'), false, '내려받은 SVG에 note-hit 없음');
    assert.equal(/<ellipse[^>]*class="note-hit"/.test(file), false);

    // ③ 인쇄 미리보기 영역: beforeprint가 #print-pages를 만든다
    const printed = await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
      const host = document.getElementById('print-pages');
      const out = {
        exists: !!host,
        hits: host ? host.querySelectorAll('.note-hit').length : -1,
        groups: host ? host.querySelectorAll('[data-note]').length : -1,
        screenHits: document.querySelectorAll('#svg-host .note-hit').length,
      };
      window.dispatchEvent(new Event('afterprint'));
      out.removed = !document.getElementById('print-pages');
      return out;
    });
    assert.equal(printed.exists, true);
    assert.equal(printed.hits, 0, '인쇄 영역에 .note-hit 없음');
    assert.equal(printed.groups, 7, '인쇄 영역에는 음표머리 그룹 7개가 그대로');
    assert.equal(printed.screenHits, 7, '인쇄 영역을 만드는 동안에도 화면의 클릭 영역은 그대로');
    assert.equal(printed.removed, true);

    // ④ 내보낸 뒤의 다음 편집: 화면용 그리기가 다시 클릭 영역을 그린다(내보내기용 상태가 남지 않는다)
    await page.evaluate(() => {
      SF.app.actions.doInput(1, SF.F(1, 4), [{ step: 3, alter: 0, oct: 4 }]);
      SF.app.update({ immediate: true });
    });
    await settle();
    const after = await screenState();
    assert.equal(after.noteheads, 8);
    assert.equal(after.hits, after.noteheads, '편집 뒤 화면 악보에도 음표머리마다 클릭 영역');
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
