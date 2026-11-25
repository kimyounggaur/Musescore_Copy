// P2-D 탭 간 편집 충돌 방지 — 실제 브라우저에서 같은 출처의 탭(페이지) 여러 개로 잠금·읽기 전용·안내 띠·풀림·사본을 확인한다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/lock-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const TAB_KEY = 'scoreforge.activeDocId';

/** 같은 출처의 탭들이 IndexedDB·Web Locks·BroadcastChannel을 나눠 쓰도록 브라우저 컨텍스트 하나를 만든다. */
async function newWorld(browser, { locale = 'ko-KR', noLocks = false } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1280, height: 900 }, locale, acceptDownloads: true }));
  await context.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  if (noLocks) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  return context;
}
/** sessionStorage: 탭 복제를 흉내 낼 때 이 탭의 문서 ID를 미리 넣어 둔다. */
async function openPage(context, { sessionDoc } = {}) {
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(8000);
  page.pageErrors = [];
  page.on('pageerror', error => page.pageErrors.push(error.message));
  if (sessionDoc) await page.addInitScript(([key, id]) => sessionStorage.setItem(key, id), [TAB_KEY, sessionDoc]);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return page;
}
const edit = (page, title) => page.evaluate(t => SF.core.mutate('테스트 편집', s => { s.meta.title = t; }), title);
const settled = page => page.waitForFunction(() => SF.core.isAutosaved());
const docId = page => page.evaluate(() => SF.session.activeId());
const title = page => page.evaluate(() => SF.core.state.score.meta.title);
const lockState = page => page.evaluate(() => SF.session.lockState());
const readOnly = page => page.evaluate(() => SF.core.state.readOnly);
const bannerVisible = page => page.locator('#lock-banner').isVisible();
const bannerText = page => page.locator('#lock-text').textContent();
const fileMenu = async (page, act) => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
async function openRecent(page) {
  await fileMenu(page, 'recent');
  await page.waitForSelector('#dlg-recent[open]');
  await page.waitForFunction(() => !document.querySelector('#rc-list').hasAttribute('aria-busy'));
}
const row = (page, text) => page.locator('#rc-list .rc-row', { has: page.locator('.rc-title', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const titles = page => page.locator('#rc-list .rc-title').allTextContents();

test('탭 간 편집 잠금', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 420000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const world = await newWorld(browser);
    const pages = [];
    const A = await openPage(world); pages.push(A);
    await edit(A, 'Lock One'); await settled(A);
    const doc1 = await docId(A);
    let B, C, D;

    await t.test('첫 탭은 문서를 쥐고, 두 번째 탭은 그 문서를 건너뛰고 자기 문서로 시작한다', async () => {
      assert.deepEqual(await lockState(A), { docId: doc1, locked: false, available: false });
      assert.equal(await A.evaluate(() => navigator.locks.query().then(q => q.held.some(l => l.name === 'scoreforge-doc:' + SF.session.activeId()))), true);
      B = await openPage(world); pages.push(B);
      const second = await docId(B);
      assert.notEqual(second, doc1);
      assert.equal(await readOnly(B), false); assert.equal(await bannerVisible(B), false);
      assert.equal(await B.evaluate(() => document.body.classList.contains('tab-locked')), false);
    });

    await t.test('최근 작업에서 다른 탭이 편집 중인 악보를 열면 읽기 전용 + 안내 띠, 첫 탭에는 영향 없음', async () => {
      await openRecent(B);
      const r = row(B, 'Lock One');
      assert.match(await r.locator('.rc-badge.rc-lock').textContent(), /다른 탭에서 편집 중/);
      assert.equal(await r.locator('.rc-delete').isDisabled(), true);              // 쓰는 중인 악보는 지울 수 없다
      await r.locator('.rc-open').click();
      await B.waitForFunction(() => SF.core.state.readOnly === true);
      assert.equal(await docId(B), doc1);
      assert.deepEqual(await lockState(B), { docId: doc1, locked: true, available: false });
      assert.equal(await bannerVisible(B), true);
      assert.equal(await bannerText(B), '다른 탭에서 편집 중인 악보예요');
      assert.equal(await B.locator('#lock-copy').isVisible(), true); assert.equal(await B.locator('#lock-resume').isVisible(), false);
      assert.equal(await B.evaluate(() => document.body.classList.contains('read-only') && document.body.classList.contains('tab-locked')), true);
      assert.equal(await B.locator('#cloud-copy-banner').isVisible(), false);       // 공유 악보용 안내와 겹치지 않는다
      assert.equal(await B.locator('#lock-banner').getAttribute('role'), 'status');
      // 편집을 시도하면 막히고 안내가 뜬다
      await B.evaluate(() => SF.core.mutate('몰래 편집', s => { s.meta.title = 'HACK'; }));
      assert.equal(await title(B), 'Lock One');
      assert.match(await B.textContent('#toast'), /읽기 전용 악보예요/);
      // 첫 탭은 그대로 편집 중
      assert.equal(await readOnly(A), false); assert.equal(await bannerVisible(A), false);
    });

    await t.test('첫 탭이 사라지면 "이제 편집할 수 있어요" → [편집 시작]이 보관된 최신 내용을 열고 이어서 편집·새로고침해도 유지', async () => {
      await edit(A, 'Lock One v2'); await settled(A);                              // B 화면은 이제 낡았다
      assert.equal(await title(B), 'Lock One');
      await A.close();
      await B.waitForFunction(() => SF.session.lockState().available === true, null, { timeout: 8000 });
      await B.waitForSelector('#lock-resume', { state: 'visible' });
      assert.equal(await bannerText(B), '이제 편집할 수 있어요');
      assert.equal(await title(B), 'Lock One');                                      // 저절로 바뀌지 않는다
      assert.equal(await readOnly(B), true);
      await B.click('#lock-resume');
      await B.waitForFunction(() => SF.core.state.readOnly === false);
      assert.equal(await title(B), 'Lock One v2');                                   // 최신 내용
      assert.equal(await bannerVisible(B), false);
      assert.equal(await B.evaluate(() => document.body.classList.contains('tab-locked') || document.body.classList.contains('read-only')), false);
      assert.deepEqual(await lockState(B), { docId: doc1, locked: false, available: false });
      await edit(B, 'Lock One v3'); await settled(B);
      await B.reload({ waitUntil: 'networkidle' });
      await B.waitForSelector('#svg-host .ev');
      assert.equal(await docId(B), doc1); assert.equal(await title(B), 'Lock One v3');
      assert.equal(await readOnly(B), false); assert.equal(await bannerVisible(B), false);   // 새로고침 직후에도 자기 잠금에 막히지 않는다
    });

    await t.test('서로 다른 문서는 두 탭이 동시에 편집하고, 둘 다 새로고침해도 각자 자기 문서를 되찾는다', async () => {
      C = await openPage(world); pages.push(C);
      const doc2 = await docId(C);
      assert.notEqual(doc2, doc1);
      await edit(C, 'Lock Two'); await settled(C);
      await B.reload({ waitUntil: 'networkidle' }); await B.waitForSelector('#svg-host .ev');
      await C.reload({ waitUntil: 'networkidle' }); await C.waitForSelector('#svg-host .ev');
      assert.equal(await docId(B), doc1); assert.equal(await title(B), 'Lock One v3');
      assert.equal(await docId(C), doc2); assert.equal(await title(C), 'Lock Two');
      for (const page of [B, C]) { assert.equal(await readOnly(page), false); assert.equal(await bannerVisible(page), false); }
    });

    await t.test('탭을 복제한 것처럼 같은 문서 ID로 시작하면 읽기 전용이고, 새로고침해도 문서를 잃지 않는다', async () => {
      D = await openPage(world, { sessionDoc: doc1 }); pages.push(D);
      assert.equal(await docId(D), doc1);
      assert.deepEqual(await lockState(D), { docId: doc1, locked: true, available: false });
      assert.equal(await readOnly(D), true); assert.equal(await bannerVisible(D), true);
      assert.equal(await title(D), 'Lock One v3');
      await D.reload({ waitUntil: 'networkidle' }); await D.waitForSelector('#svg-host .ev');
      assert.equal(await docId(D), doc1); assert.equal(await readOnly(D), true);       // B가 아직 쥐고 있으니 계속 읽기 전용
      assert.equal(await readOnly(B), false);
    });

    await t.test('[사본으로 편집]: 최신 내용에서 새 문서를 만들어 편집하고, 원본과 첫 탭은 그대로', async () => {
      await edit(B, 'Lock One v4'); await settled(B);                              // D 화면은 낡았다
      await D.click('#lock-copy');
      await D.waitForFunction(() => SF.core.state.readOnly === false);
      const copyId = await docId(D);
      assert.notEqual(copyId, doc1);
      assert.equal(await title(D), 'Lock One v4 사본');
      assert.equal(await bannerVisible(D), false);
      assert.match(await D.textContent('#toast'), /사본을 만들었어요\. 이제 편집할 수 있어요\./);
      await settled(D);                                                            // 사본은 바로 보관된다
      assert.equal(await B.evaluate(() => SF.session.activeId()), doc1);
      assert.equal(await title(B), 'Lock One v4'); assert.equal(await readOnly(B), false);
      await openRecent(D);
      assert.deepEqual((await titles(D)).sort(), ['Lock One v4', 'Lock One v4 사본', 'Lock Two']);
      assert.match(await row(D, 'Lock One v4').locator('.rc-badge.rc-lock').textContent(), /다른 탭에서 편집 중/);
      assert.equal(await row(D, 'Lock One v4 사본').locator('.rc-badge.rc-lock').count(), 0);
      await D.keyboard.press('Escape');
    });

    await t.test('최근 작업 창을 열어 둔 탭은 다른 탭의 저장·편집 시작을 따라 목록이 저절로 바뀐다', async () => {
      await openRecent(B);
      assert.equal(await titles(B).then(list => list.includes('Lock Two v2')), false);
      await edit(C, 'Lock Two v2'); await settled(C);
      await B.waitForFunction(() => [...document.querySelectorAll('#rc-list .rc-title')].some(n => n.textContent === 'Lock Two v2'), null, { timeout: 6000 });
      // 편집 중이던 탭이 사라지면 "다른 탭에서 편집 중" 배지도 사라진다
      assert.match(await row(B, 'Lock Two v2').locator('.rc-badge.rc-lock').textContent(), /다른 탭에서 편집 중/);
      await C.close();
      await B.waitForFunction(() => ![...document.querySelectorAll('#rc-list .rc-row')].some(r => r.querySelector('.rc-title')?.textContent === 'Lock Two v2' && r.querySelector('.rc-lock')), null, { timeout: 6000 });
      await B.keyboard.press('Escape');
    });

    await t.test('콘솔 오류 없음', async () => {
      for (const page of pages) assert.deepEqual(page.pageErrors, []);
    });
    await world.close();
  } finally { await browser.close(); }
});

test('Web Locks가 없는 브라우저(대체 경로)에서도 같은 악보 동시 편집을 막고 풀림을 알린다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const world = await newWorld(browser, { noLocks: true });
    const A = await openPage(world);
    assert.equal(await A.evaluate(() => navigator.locks), undefined);
    assert.deepEqual(await A.evaluate(() => SF.lock.support()), { locks: false, channel: true });
    await edit(A, 'Fallback One'); await settled(A);
    const id = await docId(A);
    const B = await openPage(world);
    assert.notEqual(await docId(B), id);                                           // 새 탭은 쓰는 중인 문서를 건너뛴다
    await B.evaluate(docId => SF.session.openDoc(docId), id);
    await B.waitForFunction(() => SF.core.state.readOnly === true);
    assert.equal(await bannerVisible(B), true);
    await t.test('A가 사라지면 B에 풀림 안내가 뜨고 [편집 시작]으로 이어서 편집', async () => {
      await A.close();
      await B.waitForFunction(() => SF.session.lockState().available === true, null, { timeout: 8000 });
      await B.click('#lock-resume');
      await B.waitForFunction(() => SF.core.state.readOnly === false);
      assert.equal(await title(B), 'Fallback One');
      assert.equal(await bannerVisible(B), false);
    });
    assert.deepEqual(A.pageErrors, []); assert.deepEqual(B.pageErrors, []);
    await world.close();
  } finally { await browser.close(); }
});

test('영어 화면에서는 안내 띠와 사본 이름이 영어로 나온다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const world = await newWorld(browser, { locale: 'en-US' });
    const A = await openPage(world);
    await edit(A, 'English One'); await settled(A);
    const id = await docId(A);
    const B = await openPage(world);
    await B.evaluate(docId => SF.session.openDoc(docId), id);
    await B.waitForFunction(() => SF.core.state.readOnly === true);
    assert.equal(await bannerText(B), 'This score is being edited in another tab');
    assert.equal((await B.textContent('#lock-copy')).trim(), 'Edit a copy');
    await B.click('#lock-copy');
    await B.waitForFunction(() => SF.core.state.readOnly === false);
    assert.equal(await title(B), 'English One (copy)');
    assert.match(await B.textContent('#toast'), /Copy created\. You can edit it now\./);
    assert.deepEqual(A.pageErrors, []); assert.deepEqual(B.pageErrors, []);
    await world.close();
  } finally { await browser.close(); }
});
