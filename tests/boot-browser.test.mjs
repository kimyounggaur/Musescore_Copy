// P2-E 부팅 안전 모드 — 실제 브라우저에서 손상된 저장본·렌더 중 예외·지난 부팅이 끝나지 못한 표시를 심고 새로고침해 확인한다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/boot-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const TAB_KEY = 'scoreforge.activeDocId';
const PROBLEM = '저장된 악보를 여는 중 문제가 생겨 안전하게 시작했어요. 최근 작업에서 원본을 내려받을 수 있어요.';
const RESTORED = '이전 작업을 자동으로 불러왔어요';

async function newContext(browser, { locale = 'ko-KR' } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1280, height: 900 }, locale, acceptDownloads: true }));
  await context.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  return context;
}
/** 앱을 연다. expect: 'score'(그려진 악보를 기다림) | 'dialog'(안전 모드 대화상자를 기다림) */
async function openPage(context, { expect = 'score', init } = {}) {
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(10000);
  page.pageErrors = []; page.consoleErrors = [];
  page.on('pageerror', error => page.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') page.consoleErrors.push(message.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await waitReady(page, expect);
  return page;
}
async function waitReady(page, expect = 'score') {
  if (expect === 'dialog') { await page.waitForSelector('#dlg-choice[open]'); return; }
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
}
async function reload(page, expect = 'score') {
  await page.reload({ waitUntil: 'networkidle' });
  await waitReady(page, expect);
}
/** 저장소에 문서를 심는다. fault: 'dur'(dur 0/0 — 모양 검사에 걸림) · 'render'(모양은 맞지만 그릴 때 예외). */
const plant = (page, specs) => page.evaluate(async specs => {
  await SF.store.open();
  for (const spec of specs) {
    const score = SF.io.DEMOS.butterfly(); score.meta.title = spec.title;
    const data = SF.core.toJSON(score);
    const first = data.parts[0].staves[0].measures[0].voices[0];
    if (spec.fault === 'dur') first[0].dur = { n: 0, d: 0, dots: 0 };
    if (spec.fault === 'render') first.find(event => event.type === 'note').notes = [null];
    await SF.store.saveDoc({ id: spec.id, title: spec.title, createdAt: 1, updatedAt: spec.at, revision: 1, origin: 'new', cloudId: null, measures: data.measures.length, bytes: 1, schema: 1, fileSavedAt: 0, data, ...(spec.extra || {}) });
  }
}, specs);
/** 이 탭이 보던 문서·마지막 문서를 id로 맞춘다(새로고침하면 그 문서가 시작 문서가 된다). */
const point = (page, id) => page.evaluate(async ([key, id]) => { sessionStorage.setItem(key, id); await SF.store.kvSet('lastDocId', id); }, [TAB_KEY, id]);
const markPending = (page, id) => page.evaluate(async id => { await SF.store.kvSet('boot.pending', { [id]: Date.now() }); }, id);
const record = (page, id) => page.evaluate(id => SF.store.loadDoc(id), id);
const pending = page => page.evaluate(() => SF.store.kvGet('boot.pending'));
const titleOf = page => page.evaluate(() => SF.core.state.score.meta.title);
const docId = page => page.evaluate(() => SF.session.activeId());
const toastText = page => page.evaluate(() => (document.querySelector('#toast')?.classList.contains('show') ? document.querySelector('#toast').textContent : ''));
const demoTitle = page => page.evaluate(() => SF.io.DEMOS.butterfly().meta.title);
const heldLocks = page => page.evaluate(() => navigator.locks.query().then(q => q.held.map(lock => lock.name)));
const fileMenu = async (page, act) => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
async function openRecent(page) {
  await fileMenu(page, 'recent');
  await page.waitForSelector('#dlg-recent[open]');
  await page.waitForFunction(() => !document.querySelector('#rc-list').hasAttribute('aria-busy'));
}
const row = (page, text) => page.locator('#rc-list .rc-row', { has: page.locator('.rc-title', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const quiet = page => assert.deepEqual([page.pageErrors, page.consoleErrors], [[], []], '페이지 오류·콘솔 오류 없음');
async function downloaded(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(file.app, 'scoreforge');                                                // 악보 파일 본문 모양({app, version, score})
  return file.score;
}

test('부팅 안전 모드', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 420000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    await t.test('손상된 저장본(dur 0/0)만 있으면 → 데모 + 안내 토스트, 원본은 격리·보관, 다시 새로고침하면 조용히 정상', async () => {
      const context = await newContext(browser);
      const page = await openPage(context);
      await plant(page, [{ id: 'corrupt-1', title: '깨진 악보', at: 20, fault: 'dur' }]);
      await point(page, 'corrupt-1');
      const planted = (await record(page, 'corrupt-1')).data;
      await reload(page);
      assert.equal(await toastText(page), PROBLEM);
      assert.equal(await titleOf(page), await demoTitle(page));
      assert.notEqual(await docId(page), 'corrupt-1');
      assert.equal(await page.evaluate(() => SF.core.state.readOnly), false);
      assert.equal(await page.locator('#lock-banner').isVisible(), false);
      const flagged = await record(page, 'corrupt-1');
      assert.equal(flagged.quarantined, true); assert.equal(flagged.quarantineError.code, 'BAD_DURATION');
      assert.deepEqual(flagged.data, planted, '원본 data가 그대로');
      assert.equal(await pending(page), null);
      assert.deepEqual((await heldLocks(page)).filter(name => name.endsWith('corrupt-1')), []);
      quiet(page);

      await openRecent(page);                                                          // 최근 작업: ⚠️ 표시 + 내려받기가 먼저 + 맨 위
      const r = row(page, '깨진 악보');
      assert.equal(await page.locator('#rc-list .rc-row').first().getAttribute('data-id'), 'corrupt-1');
      assert.match(await r.locator('.rc-badge.rc-problem').textContent(), /열 때 문제가 있었어요/);
      assert.match(await r.locator('.rc-why').textContent(), /원본은 그대로 보관돼 있어요/);
      assert.deepEqual(await r.locator('.rc-actions button').evaluateAll(buttons => buttons.map(b => b.className.split(' ').find(c => /^rc-(open|download|delete)$/.test(c)))), ['rc-download', 'rc-open', 'rc-delete']);
      assert.equal(await r.locator('.rc-download').evaluate(b => b.classList.contains('primary')), true);
      const file = await downloaded(page, () => r.locator('.rc-download').click());       // 격리된 원본을 그대로 내려받는다
      assert.deepEqual(file.parts[0].staves[0].measures[0].voices[0][0].dur, { n: 0, d: 0, dots: 0 });
      await r.locator('.rc-open').click();                                                // 열 수 없다고 알려 주고 현재 악보는 그대로
      await page.waitForFunction(() => /이 기록을 열 수 없어요/.test(document.querySelector('#toast')?.textContent || ''));
      assert.equal(await titleOf(page), await demoTitle(page));

      await reload(page);                                                               // 다시 새로고침: 같은 안내 반복 없음
      assert.equal(await toastText(page), '');
      assert.equal(await titleOf(page), await demoTitle(page));
      assert.equal((await record(page, 'corrupt-1')).quarantined, true);
      quiet(page);
      await context.close();
    });

    await t.test('정상 문서가 있으면 손상된 문서는 건너뛰고 그 문서를 연다(안내 토스트) — 이어서 편집·자동 저장도 정상', async () => {
      const context = await newContext(browser);
      const page = await openPage(context);
      await plant(page, [{ id: 'good-1', title: '정상 악보', at: 10 }, { id: 'bad-1', title: '깨진 악보', at: 5, fault: 'dur' }]);   // 깨진 쪽이 더 오래됐다
      await point(page, 'bad-1');
      await reload(page);
      assert.equal(await toastText(page), PROBLEM);
      assert.equal(await titleOf(page), '정상 악보'); assert.equal(await docId(page), 'good-1');
      assert.equal((await record(page, 'bad-1')).quarantined, true); assert.equal((await record(page, 'good-1')).quarantined, undefined);
      await page.evaluate(() => SF.core.mutate('편집', s => { s.meta.title = '정상 악보 고침'; }));
      await page.waitForFunction(() => SF.core.isAutosaved());
      assert.equal((await record(page, 'good-1')).title, '정상 악보 고침');
      assert.equal(await pending(page), null);
      quiet(page);
      await openRecent(page);                                                          // 더 새로운 정상 문서가 있어도 격리된 기록이 맨 위(⚠️)
      assert.deepEqual(await page.locator('#rc-list .rc-row').evaluateAll(rows => rows.map(r => r.dataset.id)), ['bad-1', 'good-1']);
      assert.equal(await page.locator('#rc-list .rc-row.rc-quarantined').count(), 1);
      await page.keyboard.press('Escape');
      await context.close();
    });

    await t.test('모양 검사는 통과해도 그리다 예외가 나면 → 격리 + 데모 + 안내, 표시·잠금도 정리된다', async () => {
      const context = await newContext(browser);
      const page = await openPage(context);
      await plant(page, [{ id: 'render-1', title: '그리다 죽는 악보', at: 20, fault: 'render' }]);
      await point(page, 'render-1');
      await reload(page);
      assert.equal(await toastText(page), PROBLEM);
      assert.equal(await titleOf(page), await demoTitle(page));
      assert.notEqual(await docId(page), 'render-1');
      const flagged = await record(page, 'render-1');
      assert.equal(flagged.quarantined, true); assert.equal(flagged.quarantineError.code, 'TypeError');
      assert.equal(await pending(page), null);
      assert.deepEqual((await heldLocks(page)).filter(name => name.endsWith('render-1')), [], '실패한 문서의 잠금을 놓았다');
      assert.equal(await page.locator('#svg-host .ev').count() > 0, true, '데모가 그려져 있다');
      assert.deepEqual(page.pageErrors, [], '잡힌 예외는 페이지 오류로 새지 않는다');
      await reload(page);                                                               // 다시 새로고침하면 조용히 정상
      assert.equal(await toastText(page), ''); assert.equal(await titleOf(page), await demoTitle(page));
      assert.deepEqual(page.pageErrors, []);
      await context.close();
    });

    await t.test('"여는 중" 표시: 첫 렌더 전에 쓰고(기다림), 첫 렌더 뒤에 지운다 — 정상 부팅은 표시를 남기지 않는다', async () => {
      const context = await newContext(browser);
      const first = await openPage(context);
      await plant(first, [{ id: 'norm-1', title: '정상 문서', at: 20 }]);
      await point(first, 'norm-1');
      const log = '__bootLog';
      const page = await openPage(context, {
        init: () => {
          window.__bootLog = [];
          document.addEventListener('DOMContentLoaded', () => {
            const store = SF.store, updateKv = store.updateKv.bind(store);
            store.updateKv = async (key, fn) => { const result = await updateKv(key, fn); window.__bootLog.push('kv:' + JSON.stringify(await store.kvGet(key))); return result; };
            const render = SF.engrave.render;
            SF.engrave.render = (...args) => { if (!window.__bootLog.includes('render')) window.__bootLog.push('render'); return render.apply(SF.engrave, args); };
          }, { capture: true });
        },
      });
      await page.evaluate(([key, id]) => sessionStorage.setItem(key, id), [TAB_KEY, 'norm-1']);
      await page.reload({ waitUntil: 'networkidle' }); await waitReady(page);
      await page.waitForFunction(() => window.__bootLog.filter(entry => entry.startsWith('kv:')).length >= 2);
      const entries = await page.evaluate(() => window.__bootLog);
      const marks = entries.filter(entry => entry.startsWith('kv:'));
      assert.match(marks[0], /^kv:\{"norm-1":\d+\}$/, '먼저 "여는 중"을 적고');
      assert.equal(marks.at(-1), 'kv:null', '렌더가 끝난 뒤 지운다');
      assert.ok(entries.indexOf(marks[0]) < entries.indexOf('render'), '표시를 적는 일이 첫 렌더보다 먼저');
      assert.ok(entries.indexOf('render') < entries.lastIndexOf('kv:null'), '표시를 지우는 일은 첫 렌더 뒤');
      assert.equal(await pending(page), null); assert.equal(await toastText(page), RESTORED);
      assert.equal(await titleOf(page), '정상 문서');
      assert.deepEqual(page.pageErrors, []);
      void log;
      await context.close();
    });

    await t.test('지난 부팅이 끝나지 못한 표시가 남아 있으면 → 자동으로 열지 않고 안전 모드 대화상자(세 선택지, 내려받기가 기본)', async () => {
      const context = await newContext(browser);
      const page = await openPage(context);
      await plant(page, [{ id: 'stuck-1', title: '멈췄던 악보', at: 20 }, { id: 'other-1', title: '다른 악보', at: 10 }]);
      await point(page, 'stuck-1'); await markPending(page, 'stuck-1');
      await reload(page, 'dialog');
      assert.equal(await page.locator('#dlg-choice h2').textContent(), '지난번에 여는 중 문제가 있었어요');
      assert.equal(await page.locator('#dlg-choice p').textContent(), '지난번에 ‘멈췄던 악보’을(를) 여는 중 문제가 있었어요. 어떻게 할까요?');
      assert.deepEqual(await page.locator('#dlg-choice .dlg-actions button').allTextContents(), ['그래도 열기', '파일로 내려받기', '새 악보로 시작']);
      assert.equal(await page.locator('#dlg-choice button[data-choice="download"]').evaluate(b => b.classList.contains('primary')), true);
      assert.equal(await page.locator('#svg-host .ev').count(), 0, '아직 악보를 열지 않았다');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('scoreforge.activeDocId')), 'stuck-1', '이 탭의 기록은 건드리지 않았다');

      // [파일로 내려받기]: 열어 보지 않은 원본을 받고, 대화상자는 다시 묻는다
      const file = await downloaded(page, () => page.click('#dlg-choice button[data-choice="download"]'));
      assert.equal(file.meta.title, '멈췄던 악보');
      await page.waitForSelector('#dlg-choice[open]');
      assert.match(await toastText(page), /악보 파일을 내려받았어요/);
      assert.deepEqual(await pending(page), (await pending(page)), '표시는 그대로');
      assert.equal(Object.keys(await pending(page)).join(), 'stuck-1');

      // [그래도 열기]: 그 문서를 열고, 첫 렌더 뒤 표시를 지운다
      await page.click('#dlg-choice button[data-choice="open"]');
      await page.waitForSelector('#svg-host .ev');
      assert.equal(await titleOf(page), '멈췄던 악보'); assert.equal(await docId(page), 'stuck-1');
      await page.waitForFunction(() => SF.store.kvGet('boot.pending').then(value => value === null));
      assert.equal((await record(page, 'stuck-1')).quarantined, undefined);
      assert.equal(await toastText(page), RESTORED);
      quiet(page);
      await reload(page);                                                               // 이제 정상: 대화상자 없이 같은 문서
      assert.equal(await titleOf(page), '멈췄던 악보'); assert.equal(await pending(page), null);
      await context.close();
    });

    await t.test('안전 모드 [새 악보로 시작]: 그 문서를 격리하고(알림 없이) 빈 악보로 시작 — 다음부터 대화상자 없음, 최근 작업 맨 위에 ⚠️', async () => {
      const context = await newContext(browser);
      const page = await openPage(context);
      await plant(page, [{ id: 'stuck-2', title: '또 멈춘 악보', at: 20 }]);
      await point(page, 'stuck-2'); await markPending(page, 'stuck-2');
      await reload(page, 'dialog');
      await page.click('#dlg-choice button[data-choice="fresh"]');
      await page.waitForSelector('#svg-host');
      await page.waitForFunction(() => SF.session.activeId() && SF.store.kvGet('boot.pending').then(value => value === null));
      assert.notEqual(await docId(page), 'stuck-2');
      assert.equal(await page.evaluate(() => SF.core.state.score.meta.title), '새 악보', '빈 악보');
      assert.equal(await toastText(page), '', '직접 고른 일이라 문제 안내 토스트는 없다');
      const flagged = await record(page, 'stuck-2');
      assert.equal(flagged.quarantined, true); assert.equal(flagged.quarantineError.code, 'BOOT_INTERRUPTED');
      assert.equal(await pending(page), null);
      quiet(page);
      await openRecent(page);
      assert.equal(await page.locator('#rc-list .rc-row').first().getAttribute('data-id'), 'stuck-2');
      await page.keyboard.press('Escape');
      await reload(page);                                                               // 대화상자 없이 시작
      assert.equal(await page.locator('#dlg-choice[open]').count(), 0);
      assert.notEqual(await docId(page), 'stuck-2');
      await context.close();
    });

    await t.test('안전 모드 대화상자를 닫으면(Esc) 이번에는 데모로 시작하되 표시는 그대로 → 다음 부팅에 다시 묻는다', async () => {
      const context = await newContext(browser);
      const page = await openPage(context);
      await plant(page, [{ id: 'stuck-3', title: '미뤄 둔 악보', at: 20 }]);
      await point(page, 'stuck-3'); await markPending(page, 'stuck-3');
      await reload(page, 'dialog');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#svg-host .ev');
      assert.equal(await titleOf(page), await demoTitle(page));
      assert.equal(Object.keys(await pending(page)).join(), 'stuck-3');
      assert.equal((await record(page, 'stuck-3')).quarantined, undefined, '아직 아무 일도 하지 않았다');
      await page.evaluate(([key, id]) => sessionStorage.setItem(key, id), [TAB_KEY, 'stuck-3']);
      await reload(page, 'dialog');                                                      // 다시 묻는다
      assert.match(await page.locator('#dlg-choice p').textContent(), /미뤄 둔 악보/);
      await page.click('#dlg-choice button[data-choice="open"]');
      await page.waitForSelector('#svg-host .ev');
      assert.equal(await titleOf(page), '미뤄 둔 악보');
      await context.close();
    });

    await t.test('영어 화면: 안내 토스트·안전 모드 대화상자·최근 작업 표시가 영어로 나온다(제목은 그대로)', async () => {
      const context = await newContext(browser, { locale: 'en-US' });
      const page = await openPage(context);
      await plant(page, [{ id: 'en-bad', title: 'Broken score', at: 30, fault: 'dur' }, { id: 'en-stuck', title: 'Stuck score', at: 20 }]);
      await point(page, 'en-bad');
      await reload(page);
      assert.equal(await toastText(page), 'We hit a problem opening the saved score, so we started safely. You can download the original from Recent work.');
      await openRecent(page);
      assert.match(await row(page, 'Broken score').locator('.rc-badge.rc-problem').textContent(), /Had a problem opening/);
      assert.match(await row(page, 'Broken score').locator('.rc-why').textContent(), /The original is kept as it was/);
      await page.keyboard.press('Escape');
      await point(page, 'en-stuck'); await markPending(page, 'en-stuck');
      await reload(page, 'dialog');
      assert.equal(await page.locator('#dlg-choice h2').textContent(), 'There was a problem opening a score last time');
      assert.equal(await page.locator('#dlg-choice p').textContent(), 'There was a problem opening “Stuck score” last time. What would you like to do?');
      assert.deepEqual(await page.locator('#dlg-choice .dlg-actions button').allTextContents(), ['Open anyway', 'Download as file', 'Start a new score']);
      await context.close();
    });
  } finally { await browser.close(); }
});
