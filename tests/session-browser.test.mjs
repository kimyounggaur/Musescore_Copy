// P2-A 악보 교체 보호 — 실제 브라우저에서 경로마다 저장 확인이 뜨고, 취소하면 아무것도 바뀌지 않는지 본다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/session-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

// idb: false(기본)면 IndexedDB를 막아 연다 — 보관할 곳이 없을 때의 3지선다 흐름(P2-A)을 확인하는 환경이다.
// idb: true면 그대로 둔다 — 이때는 변경이 있어도 최근 작업에 보관하고 묻지 않는다(P2-B).
async function openApp(browser, { welcomed = true, locale, idb = false, seed = {} } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, ...(locale ? { locale } : {}), acceptDownloads: true }));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  if (welcomed) await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  if (Object.keys(seed).length) await page.addInitScript(entries => { for (const [key, value] of entries) if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, Object.entries(seed));
  if (!idb) await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true }));
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


/* =====================================================================
 * P2-B 악보별 자동 저장 — 실제 IndexedDB로 확인한다.
 * ===================================================================== */
const waitAutosaved = page => page.waitForFunction(() => SF.core.isAutosaved());
const docList = page => page.evaluate(async () => (await SF.store.listDocs()).map(row => ({ id: row.id, title: row.title, origin: row.origin })));
const fileMenu = async (page, act) => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
const reopen = async page => { await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#svg-host .ev'); await page.waitForFunction(() => SF.engrave.isFontReady()); };

test('P2-B 보관: 변경이 있어도 묻지 않고 교체하고 이전 악보는 기록에 남는다(한국어·영어)', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    await t.test('한국어: 새 악보', async () => {
      const { context, page, pageErrors } = await openApp(browser, { idb: true });
      assert.equal(await page.evaluate(() => SF.store.backend), 'indexeddb');
      await makeDirty(page, '지켜야 할 작업');
      const oldId = await page.evaluate(() => SF.session.activeId());
      await fileMenu(page, 'new');
      await page.waitForSelector('#dlg-settings[open]');                          // 새 악보를 만든 뒤 설정 창
      assert.equal(await choiceOpen(page).count(), 0, '보관했는데 대화상자가 떴다');
      assert.equal(await page.textContent('#toast > span'), '이전 악보는 최근 작업에 보관했어요');   // P2-C: 문구 뒤에 [되돌리기] 버튼이 붙는다
      assert.equal(await page.textContent('#toast .toast-action'), '되돌리기');
      assert.ok((await docList(page)).some(row => row.id === oldId && row.title === '지켜야 할 작업'));
      const now = await page.evaluate(() => ({ id: SF.session.activeId(), tab: sessionStorage.getItem('scoreforge.activeDocId'), title: SF.core.state.score.meta.title }));
      assert.notEqual(now.id, oldId); assert.equal(now.tab, now.id);
      assert.equal((await docList(page)).length, 1, '열기만 한 새 악보는 기록이 없어야 한다');
      assert.deepEqual(pageErrors, []);
      await context.close();
    });
    await t.test('영어 화면의 보관 토스트', async () => {
      const { context, page } = await openApp(browser, { idb: true, locale: 'en-US' });
      await makeDirty(page, 'Keep this');
      await fileMenu(page, 'demo-star');
      await page.waitForFunction(() => SF.core.state.score.meta.title !== 'Keep this');
      assert.equal(await choiceOpen(page).count(), 0);
      assert.equal(await page.textContent('#toast > span'), 'Your previous score is kept in Recent work');
      assert.equal(await page.textContent('#toast .toast-action'), 'Undo');
      await context.close();
    });
    await t.test('변경이 없으면 보관 토스트도 없다', async () => {
      const { context, page } = await openApp(browser, { idb: true });
      await fileMenu(page, 'demo-star');
      await page.waitForFunction(() => SF.core.state.score.meta.title !== SF.io.DEMOS.butterfly().meta.title);
      assert.doesNotMatch(await page.textContent('#toast'), /보관했어요/);
      assert.equal((await docList(page)).length, 0);
      await context.close();
    });
  } finally { await browser.close(); }
});

test('P2-B 탭 분리: 같은 브라우저의 두 페이지가 서로의 자동 저장을 덮어쓰지 않는다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { context, page: A, pageErrors } = await openApp(browser, { idb: true });
    await makeDirty(A, '문서1'); await waitAutosaved(A);
    const B = await context.newPage(); await preparePage(B); B.setDefaultTimeout(8000);
    B.on('pageerror', e => pageErrors.push(e.message));
    await B.goto(URL_, { waitUntil: 'networkidle' }); await B.waitForSelector('#svg-host .ev');
    // B는 데모를 열어 편집한다(저장된 문서가 있어 부팅 때는 마지막 문서가 열린다 — 열려 있는 탭과의 충돌은 2-D가 다룬다)
    await B.evaluate(() => SF.session.replaceScore(SF.io.DEMOS.star(), { origin: 'demo', reason: '데모 열기', toast: false }));
    await makeDirty(B, '데모 편집'); await waitAutosaved(B);
    const docA = await A.evaluate(() => SF.session.activeId()), docB = await B.evaluate(() => SF.session.activeId());
    assert.notEqual(docA, docB);
    const rows = await docList(A);
    assert.deepEqual(rows.map(row => row.title).sort(), ['데모 편집', '문서1']);
    await reopen(A);                                                              // A 새로고침 → 자기 문서 그대로
    assert.equal(await A.evaluate(() => SF.core.state.score.meta.title), '문서1');
    assert.equal(await A.evaluate(() => SF.session.activeId()), docA);
    assert.equal(await B.evaluate(() => SF.core.state.score.meta.title), '데모 편집');
    assert.equal((await docList(A)).length, 2);
    // 편집을 이어 가도 서로의 기록은 그대로
    await makeDirty(A, '문서1 계속'); await waitAutosaved(A);
    assert.deepEqual((await docList(B)).map(row => row.title).sort(), ['데모 편집', '문서1 계속']);
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('P2-B 이전: 예전 자동 저장(localStorage v1)이 첫 부팅 때 문서가 되고 원본은 남는다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const maker = await openApp(browser, { idb: true });
    const payload = await maker.page.evaluate(() => { const s = SF.core.createScore({ measureCount: 2 }); s.meta.title = '옛 작업'; return JSON.stringify({ savedAt: 1700000000000, revision: 7, score: SF.core.toJSON(s) }); });
    await maker.context.close();
    const { context, page, pageErrors } = await openApp(browser, { idb: true, seed: { 'scoreforge.autosave.v1': payload } });
    const first = await page.evaluate(async () => ({
      title: SF.core.state.score.meta.title, id: SF.core.state.score.meta.docId, docs: await SF.store.listDocs(), record: await SF.store.loadDoc('legacy-v1'),
      original: localStorage.getItem('scoreforge.autosave.v1'), migrated: await SF.store.kvGet('migrated.v1'),
    }));
    assert.equal(first.title, '옛 작업'); assert.equal(first.id, 'legacy-v1');
    assert.equal(first.docs.length, 1); assert.equal(first.record.origin, 'legacy'); assert.equal(first.record.updatedAt, 1700000000000);
    const staffMeasures = data => data.parts[0].staves[0].measures;   // v2 데이터에는 최상위 measures가 없다(P7-B1)
    assert.ok(staffMeasures(first.record.data).length > 0);
    assert.equal(JSON.stringify(staffMeasures(first.record.data)), JSON.stringify(staffMeasures(JSON.parse(payload).score)));   // 내용 동일
    assert.equal(first.original, payload); assert.ok(first.migrated);
    assert.match(await page.textContent('#toast'), /이전 작업을 자동으로 불러왔어요/);
    await reopen(page);                                                           // 다시 부팅해도 문서는 1개
    const second = await page.evaluate(async () => ({ title: SF.core.state.score.meta.title, count: (await SF.store.listDocs()).length, original: localStorage.getItem('scoreforge.autosave.v1') }));
    assert.equal(second.title, '옛 작업'); assert.equal(second.count, 1); assert.equal(second.original, payload);
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('P2-B 상태 표시줄: 기록이 생기면 "파일로 저장한 적 없어요", 파일로 저장하면 "마지막 파일 저장 시각"', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { context, page, pageErrors } = await openApp(browser, { idb: true });
    assert.equal(await page.locator('#status-saved').isHidden(), true, '열기만 한 데모에는 표시하지 않는다');
    await makeDirty(page, 'status-check'); await waitAutosaved(page);
    await page.waitForFunction(() => document.querySelector('#status-saved').textContent === '파일로 저장한 적 없어요');
    const download = page.waitForEvent('download');
    await fileMenu(page, 'save');
    assert.equal((await download).suggestedFilename(), 'status-check.scoreforge.json');
    await page.waitForFunction(() => /^마지막 파일 저장 \d{2}:\d{2}$/.test(document.querySelector('#status-saved').textContent));
    assert.equal(await page.evaluate(async () => {                                                              // 기록에도 남는다(비동기라 잠시 기다린다)
      for (let i = 0; i < 50; i++) { if ((await SF.store.loadDoc(SF.session.activeId()))?.fileSavedAt > 0) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
      return false;
    }), true);
    await reopen(page);
    assert.match(await page.textContent('#status-saved'), /^마지막 파일 저장 \d{2}:\d{2}$/);                    // 새로고침 뒤에도
    assert.match(await page.getAttribute('#status-saved', 'title'), /이 브라우저에만 남아요/);
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('P2-B 파일 열기 충돌: 같은 문서의 자동 저장본과 내용이 다르면 묻고, 기존 기록은 덮어쓰지 않는다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { context, page, pageErrors } = await openApp(browser, { idb: true });
    await makeDirty(page, '자동 저장본의 제목'); await waitAutosaved(page);
    const id = await page.evaluate(() => SF.session.activeId());
    const recordBefore = await page.evaluate(async id => JSON.stringify(await SF.store.loadDoc(id)), id);
    const fileJson = await page.evaluate(id => { const s = SF.core.fromJSON(SF.core.toJSON(SF.core.state.score)); s.meta.title = '파일에 든 제목'; s.meta.docId = id; return JSON.stringify({ app: 'scoreforge', version: 1, score: SF.core.toJSON(s) }); }, id);
    const openFile = async () => {
      const chooser = page.waitForEvent('filechooser');
      await fileMenu(page, 'open');
      await (await chooser).setFiles({ name: 'same-doc.scoreforge.json', mimeType: 'application/json', buffer: Buffer.from(fileJson) });
    };
    await t.test('취소하면 아무것도 바뀌지 않는다', async () => {
      await openFile(); await choiceOpen(page).waitFor();
      assert.match(await page.textContent('#dlg-choice h2'), /같은 악보의 자동 저장본이 있어요/);
      assert.deepEqual(await page.locator('#dlg-choice .dlg-actions button').allTextContents(), ['자동 저장본 열기', '파일 그대로 열기(새 문서로)', '취소']);
      await page.click('#dlg-choice button[data-choice="cancel"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-choice').open);
      assert.equal(await page.evaluate(() => SF.core.state.score.meta.title), '자동 저장본의 제목');
    });
    await t.test('파일 그대로 열기(새 문서로): 새 ID, 기존 기록은 그대로', async () => {
      await openFile(); await choiceOpen(page).waitFor();
      await page.click('#dlg-choice button[data-choice="file"]');
      await page.waitForFunction(() => SF.core.state.score.meta.title === '파일에 든 제목');
      assert.notEqual(await page.evaluate(() => SF.session.activeId()), id);
      assert.equal(await page.evaluate(async id => JSON.stringify(await SF.store.loadDoc(id)), id), recordBefore);
    });
    await t.test('자동 저장본 열기: 같은 문서로 이어진다', async () => {
      await openFile(); await choiceOpen(page).waitFor();
      await page.click('#dlg-choice button[data-choice="autosave"]');
      await page.waitForFunction(() => SF.core.state.score.meta.title === '자동 저장본의 제목');
      assert.equal(await page.evaluate(() => SF.session.activeId()), id);
    });
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally { await browser.close(); }
});
