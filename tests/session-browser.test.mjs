// P2-A 악보 교체 보호 — 실제 브라우저에서 경로마다 저장 확인이 뜨고, 취소하면 아무것도 바뀌지 않는지 본다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/session-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

async function openApp(browser, { welcomed = true, locale } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, ...(locale ? { locale } : {}), acceptDownloads: true }));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  if (welcomed) await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return { context, page, pageErrors };
}
const snapshot = page => page.evaluate(() => ({ title: SF.core.state.score.meta.title, revision: SF.core.state.revision, canUndo: SF.core.canUndo(), readOnly: SF.core.state.readOnly, dirty: SF.core.state.dirty }));
const makeDirty = (page, title = '지키려는 작업') => page.evaluate(t => SF.core.mutate('테스트 편집', s => { s.meta.title = t; }), title);
const fileText = (page, key) => page.evaluate(k => JSON.stringify({ app: 'scoreforge', version: 1, score: SF.core.toJSON(SF.io.DEMOS[k]()) }), key);
const choiceOpen = page => page.locator('#dlg-choice[open]');

test('악보 교체 보호: 경로마다 확인이 뜨고 취소하면 그대로, 깨끗하면 그냥 교체', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    const star = await fileText(page, 'star');

    // 경로를 실행하는 함수들(각각 확인 대화상자가 떠야 한다)
    const menu = async act => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
    const paths = {
      '새 악보': () => menu('new'),
      '데모(메뉴)': () => menu('demo-star'),
      '파일 열기': async () => {
        const chooser = page.waitForEvent('filechooser');
        await menu('open');
        await (await chooser).setFiles({ name: 'star.scoreforge.json', mimeType: 'application/json', buffer: Buffer.from(star) });
      },
      '끌어다 놓기': () => page.evaluate(text => {
        const data = new DataTransfer(); data.items.add(new File([text], 'drop.scoreforge.json', { type: 'application/json' }));
        document.querySelector('#canvas').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      }, star),
      '앱 파일 실행': () => page.evaluate(text => SF.io.loadScoreFile(new File([text], 'launch.scoreforge.json', { type: 'application/json' }), SF.app.handleLoadedScore), star),
    };

    for (const [name, run] of Object.entries(paths)) {
      await t.test(`${name}: 변경이 있으면 묻고, 취소하면 악보·실행 취소 기록이 그대로`, async () => {
        await makeDirty(page);
        const before = await snapshot(page);
        assert.equal(before.dirty, true);
        await run();
        await choiceOpen(page).waitFor();
        assert.match(await page.textContent('#dlg-choice h2'), /저장하지 않은 변경 사항/);
        assert.deepEqual(await page.locator('#dlg-choice .dlg-actions button').allTextContents(), ['파일로 저장하고 계속', '저장하지 않고 계속', '취소']);
        await page.click('#dlg-choice button[data-choice="cancel"]');
        await choiceOpen(page).waitFor({ state: 'detached' }).catch(() => {});
        await page.waitForFunction(() => !document.querySelector('#dlg-choice').open);
        assert.deepEqual(await snapshot(page), before, `${name}: 취소했는데 악보가 바뀌었다`);
      });
    }

    await t.test('Esc로 닫으면 취소와 같다', async () => {
      await makeDirty(page);
      const before = await snapshot(page);
      await paths['데모(메뉴)']();
      await choiceOpen(page).waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#dlg-choice').open);
      assert.deepEqual(await snapshot(page), before);
    });

    await t.test('바깥을 눌러도 취소와 같다', async () => {
      await makeDirty(page);
      const before = await snapshot(page);
      await paths['새 악보']();
      await choiceOpen(page).waitFor();
      await page.mouse.click(5, 5);
      await page.waitForFunction(() => !document.querySelector('#dlg-choice').open);
      assert.deepEqual(await snapshot(page), before);
    });

    await t.test('저장하지 않고 계속: 교체되고 토스트가 나온다', async () => {
      await makeDirty(page);
      await paths['데모(메뉴)']();
      await choiceOpen(page).waitFor();
      await page.click('#dlg-choice button[data-choice="discard"]');
      await page.waitForFunction(() => SF.core.state.score.meta.title !== '지키려는 작업');
      assert.equal((await snapshot(page)).dirty, false);
      assert.match(await page.textContent('#toast'), /데모 악보를 불러왔어요/);
    });

    await t.test('파일로 저장하고 계속: 파일이 내려받아지고 교체된다', async () => {
      await makeDirty(page, 'keep-me');            // 한글 제목은 헤드리스 Chrome이 내려받기 이름을 'download'로 보고하므로 영문 제목 사용
      await paths['새 악보']();
      await choiceOpen(page).waitFor();
      const download = page.waitForEvent('download');
      await page.click('#dlg-choice button[data-choice="save"]');
      assert.equal((await download).suggestedFilename(), 'keep-me.scoreforge.json');
      await page.waitForFunction(() => SF.core.state.score.meta.title !== 'keep-me');
      await page.waitForSelector('#dlg-settings[open]');   // 새 악보를 만든 뒤 설정 창이 열린다
      await page.evaluate(() => document.querySelector('#dlg-settings').close());
    });

    await t.test('변경이 없으면 대화상자 없이 바로 교체', async () => {
      await page.evaluate(() => SF.core.setScore(SF.io.DEMOS.butterfly()));
      assert.equal((await snapshot(page)).dirty, false);
      await paths['데모(메뉴)']();
      await page.waitForFunction(() => SF.core.state.score.meta.title !== SF.io.DEMOS.butterfly().meta.title);
      assert.equal(await choiceOpen(page).count(), 0);
    });

    await t.test('읽기 전용이면 묻지 않고 열어 편집 가능 상태가 된다(F6)', async () => {
      await makeDirty(page);
      await page.evaluate(() => SF.app.setReadOnly(true));
      assert.equal((await snapshot(page)).readOnly, true);
      await paths['파일 열기']();
      await page.waitForFunction(() => !SF.core.state.readOnly);
      assert.equal(await choiceOpen(page).count(), 0);
      assert.equal((await snapshot(page)).readOnly, false);
    });

    await t.test('읽기 전용을 풀지 않은 채 취소 흐름이 없다 — 파일 열기 경로가 setReadOnly를 먼저 부르지 않는다', async () => {
      // 변경이 있는 편집 상태에서 취소해도 읽기 전용 상태가 바뀌지 않아야 한다(확인 전에 풀던 옛 버그의 반대편 확인)
      await page.evaluate(() => SF.core.setScore(SF.io.DEMOS.butterfly()));
      await makeDirty(page);
      await paths['끌어다 놓기']();
      await choiceOpen(page).waitFor();
      assert.equal((await snapshot(page)).readOnly, false);
      await page.click('#dlg-choice button[data-choice="cancel"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-choice').open);
    });

    assert.deepEqual(pageErrors, [], '페이지 오류가 있었다');
  } finally { await browser.close(); }
});

test('시작 화면의 빈 악보·데모도 보호된다(처음 화면에서 변경이 생긴 경우)', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    for (const [label, start] of [['빈 악보', 'blank'], ['데모', 'star']]) {
      await t.test(`시작 화면 ${label}`, async () => {
        const { context, page, pageErrors } = await openApp(browser, { welcomed: false });
        await page.waitForSelector('#dlg-welcome[open]');
        await makeDirty(page);                       // 시작 화면이 떠 있는 동안 악보가 바뀐 상황
        const before = await snapshot(page);
        await page.click(`#dlg-welcome [data-start="${start}"]`);
        await choiceOpen(page).waitFor();
        await page.click('#dlg-choice button[data-choice="cancel"]');
        await page.waitForFunction(() => !document.querySelector('#dlg-choice').open);
        assert.deepEqual(await snapshot(page), before);
        assert.equal(await page.locator('#dlg-welcome[open]').count(), 1, '취소했는데 시작 화면이 닫혔다');
        // 이번에는 저장하지 않고 계속 → 교체되고 시작 화면이 닫힌다
        await page.click(`#dlg-welcome [data-start="${start}"]`);
        await choiceOpen(page).waitFor();
        await page.click('#dlg-choice button[data-choice="discard"]');
        await page.waitForFunction(() => !document.querySelector('#dlg-welcome').open);
        assert.notEqual((await snapshot(page)).title, '지키려는 작업');
        assert.deepEqual(pageErrors, []);
        await context.close();
      });
    }
    await t.test('변경이 없으면 시작 화면에서 바로 시작', async () => {
      const { context, page } = await openApp(browser, { welcomed: false });
      await page.waitForSelector('#dlg-welcome[open]');
      await page.click('#dlg-welcome [data-start="star"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-welcome').open);
      assert.equal(await choiceOpen(page).count(), 0);
      await context.close();
    });
  } finally { await browser.close(); }
});

test('영어 화면에서는 확인 문구가 영어로 나온다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { context, page } = await openApp(browser, { locale: 'en-US' });
    await makeDirty(page);
    await page.click('#btn-file'); await page.click('#file-menu [data-act="new"]');
    await choiceOpen(page).waitFor();
    assert.equal(await page.textContent('#dlg-choice h2'), 'Unsaved changes');
    assert.match(await page.textContent('#dlg-choice p'), /^What should happen to the current score before you continue\? \(Create new score\)$/);
    assert.deepEqual(await page.locator('#dlg-choice .dlg-actions button').allTextContents(), ['Save to a file and continue', 'Continue without saving', 'Cancel']);
    await context.close();
  } finally { await browser.close(); }
});
