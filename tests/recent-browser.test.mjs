// P2-C 최근 작업 창 — 실제 브라우저(IndexedDB 사용)에서 목록·열기·되돌리기·내려받기·삭제·공간 부족 안내를 확인한다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/recent-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

async function openApp(browser, { locale } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, ...(locale ? { locale } : {}), acceptDownloads: true }));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return { context, page, pageErrors };
}
const fileMenu = async (page, act) => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
const edit = (page, title) => page.evaluate(t => SF.core.mutate('테스트 편집', s => { s.meta.title = t; }), title);
const settled = page => page.waitForFunction(() => SF.core.isAutosaved());
const activeId = page => page.evaluate(() => SF.session.activeId());
const titles = page => page.locator('#rc-list .rc-title').allTextContents();
const row = (page, title) => page.locator('#rc-list .rc-row', { has: page.locator('.rc-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
async function openRecent(page) {
  await fileMenu(page, 'recent');
  await page.waitForSelector('#dlg-recent[open]');
  await page.waitForFunction(() => !document.querySelector('#rc-list').hasAttribute('aria-busy'));
}
const closeRecent = async page => { await page.click('#dlg-recent .dlg-actions button'); await page.waitForFunction(() => !document.querySelector('#dlg-recent').open); };
/** 새 악보를 만들고(설정 창은 닫는다) 제목을 고쳐 보관까지 마친다. */
async function newDoc(page, title) {
  await fileMenu(page, 'new');
  await page.waitForSelector('#dlg-settings[open]');
  await page.evaluate(() => document.querySelector('#dlg-settings').close());
  await edit(page, title);
  await settled(page);
}

test('최근 작업 창', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 240000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser, { locale: 'ko-KR' });

    await t.test('메뉴 항목이 있고, 보관된 악보가 없으면 빈 안내와 저장 공간 사용량이 보인다', async () => {
      assert.equal(await page.locator('#file-menu [data-act="recent"]').count(), 1);
      assert.match(await page.textContent('#file-menu [data-act="recent"]'), /최근 작업/);
      await openRecent(page);
      assert.equal(await page.locator('#rc-empty').isVisible(), true);
      assert.equal(await page.locator('#rc-list').isVisible(), false);
      assert.equal(await page.locator('#rc-unavailable').isVisible(), false);
      assert.equal(await page.locator('#rc-warn').isVisible(), false);
      await page.waitForFunction(() => !document.querySelector('#rc-usage').hidden);
      assert.match(await page.textContent('#rc-usage'), /^사용 중 .+ \/ 약 .+$/);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#dlg-recent').open);
    });

    await t.test('문서 두 개를 만들면 두 건이 보이고 지금 문서에 표시가 붙으며, 지금 문서는 열기·삭제가 막혀 있다', async () => {
      await edit(page, 'Doc One'); await settled(page);
      await newDoc(page, 'Doc Two');
      await openRecent(page);
      assert.deepEqual((await titles(page)).sort(), ['Doc One', 'Doc Two']);
      const current = row(page, 'Doc Two'), other = row(page, 'Doc One');
      assert.equal(await current.getAttribute('aria-current'), 'true');
      assert.equal(await other.getAttribute('aria-current'), null);
      assert.match(await current.locator('.rc-badge').textContent(), /지금 열려 있어요/);
      assert.equal(await other.locator('.rc-badge').count(), 0);
      assert.equal(await current.locator('.rc-open').isDisabled(), true);
      assert.equal(await current.locator('.rc-delete').isDisabled(), true);
      assert.equal(await other.locator('.rc-open').isDisabled(), false);
      assert.equal(await other.locator('.rc-delete').isDisabled(), false);
      assert.equal(await other.locator('.rc-download').isDisabled(), false);
      assert.match(await other.locator('.rc-meta .rc-measures').textContent(), /^\d+마디$/);
      assert.ok((await other.locator('.rc-meta .rc-time').textContent()).trim().length > 0);
      assert.match(await other.locator('.rc-open').getAttribute('aria-label'), /^열기 — Doc One$/);
      await closeRecent(page);
    });

    await t.test('다른 문서를 열면 이전 악보는 묻지 않고 보관되고, 토스트의 [되돌리기]로 원래 문서가 돌아온다', async () => {
      const twoId = await activeId(page);
      const twoJson = await page.evaluate(() => JSON.stringify(SF.core.toJSON(SF.core.state.score)));
      await openRecent(page);
      await row(page, 'Doc One').locator('.rc-open').click();
      await page.waitForFunction(() => SF.core.state.score.meta.title === 'Doc One');
      assert.equal(await page.locator('#dlg-recent').evaluate(d => d.open), false);
      assert.equal(await page.locator('#dlg-choice[open]').count(), 0);
      assert.notEqual(await activeId(page), twoId);
      await page.waitForSelector('#toast.show.has-action');
      assert.match(await page.textContent('#toast'), /이전 악보는 최근 작업에 보관했어요/);
      assert.equal(await page.locator('#toast .toast-action').textContent(), '되돌리기');
      await page.click('#toast .toast-action');
      await page.waitForFunction(() => SF.core.state.score.meta.title === 'Doc Two');
      assert.equal(await activeId(page), twoId);
      assert.equal(await page.evaluate(() => JSON.stringify(SF.core.toJSON(SF.core.state.score))), twoJson, '되돌린 악보의 내용이 처음과 같아야 한다');
      assert.equal(await page.locator('#toast').evaluate(el => el.classList.contains('show') && el.querySelector('.toast-action')?.textContent === '되돌리기'), false, '누르면 토스트가 사라지거나 새 안내로 바뀐다');
    });

    await t.test('제목이 마크업이어도 글자로만 보인다(img 0개, 스크립트 실행 없음)', async () => {
      const evil = '<img src=x onerror="window.__xss=1"><b>굵게</b>';
      await newDoc(page, evil);
      await openRecent(page);
      assert.ok((await titles(page)).includes(evil), '제목이 글자 그대로 보여야 한다');
      assert.equal(await page.locator('#dlg-recent img').count(), 0);
      assert.equal(await page.locator('#dlg-recent .rc-title b').count(), 0);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.match(await page.locator('#rc-list .rc-row').first().locator('.rc-open').getAttribute('aria-label'), /^열기 — /);
      await closeRecent(page);
    });

    await t.test('제목이 비어 있어도 목록에서 알아볼 수 있다', async () => {
      await newDoc(page, 'tmp'); await edit(page, ''); await settled(page);
      await openRecent(page);
      assert.ok((await titles(page)).includes('제목 없음'));
      await closeRecent(page);
    });

    await t.test('파일로 내려받기: 다른 문서는 보관된 기록 그대로, 지금 악보는 바뀌지 않는다', async () => {
      await newDoc(page, 'Doc Three'); await settled(page);
      const before = await page.evaluate(() => ({ id: SF.session.activeId(), title: SF.core.state.score.meta.title, revision: SF.core.state.revision }));
      await openRecent(page);
      const [download] = await Promise.all([page.waitForEvent('download'), row(page, 'Doc One').locator('.rc-download').click()]);
      assert.equal(download.suggestedFilename(), 'Doc One.scoreforge.json');
      const body = JSON.parse(readFileSync(await download.path(), 'utf8'));
      // P7-B1: 이 기록은 새 저장 형식(schema 2)으로 보관돼 있으니 내려받은 파일의 머리 version도 2다.
      assert.equal(body.app, 'scoreforge'); assert.equal(body.version, 2); assert.equal(body.score.schema, 2); assert.equal(body.score.meta.title, 'Doc One');
      assert.ok(Array.isArray(body.score.measures) || body.score.parts, '악보 본문이 들어 있어야 한다');
      assert.deepEqual(await page.evaluate(() => ({ id: SF.session.activeId(), title: SF.core.state.score.meta.title, revision: SF.core.state.revision })), before);
      await closeRecent(page);
    });

    await t.test('삭제: 확인을 거치고, 취소하면 그대로이며, 지우면 목록과 저장소에서 사라진다', async () => {
      await openRecent(page);
      const count = (await titles(page)).length;
      assert.ok(count >= 4);
      await row(page, 'Doc One').locator('.rc-delete').click();
      await page.waitForSelector('#dlg-prompt[open]');
      assert.match(await page.textContent('#dlg-prompt h2'), /이 악보 기록을 지울까요/);
      assert.match(await page.textContent('#dlg-prompt p'), /‘Doc One’ 기록을 이 브라우저에서 지워요/);
      await page.click('#dlg-prompt button:has-text("취소")');
      await page.waitForFunction(() => !document.querySelector('#dlg-prompt'));
      assert.equal((await titles(page)).length, count);
      await row(page, 'Doc One').locator('.rc-delete').click();
      await page.waitForSelector('#dlg-prompt[open]');
      await page.click('#dlg-prompt button[type="submit"]');
      await page.waitForFunction(n => document.querySelectorAll('#rc-list .rc-row').length === n, count - 1);
      assert.equal((await titles(page)).includes('Doc One'), false);
      assert.equal(await page.evaluate(async () => (await SF.store.listDocs()).some(doc => doc.title === 'Doc One')), false);
      assert.equal(await page.locator('#dlg-recent').evaluate(d => d.open), true, '지운 뒤에도 창은 열려 있다');
      await closeRecent(page);
    });

    await t.test('다른 탭이 편집 중이라는 표시는 아직 없다(2-D) — 목록에 잠금 표시가 없다', async () => {
      await openRecent(page);
      assert.equal(await page.locator('#rc-list .rc-lock').count(), 0);
      await closeRecent(page);
    });

    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('최근 작업 창: 영어 화면', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser, { locale: 'en-US' });
    await edit(page, 'First'); await settled(page);
    await newDoc(page, 'Second');
    await page.waitForSelector('#toast.has-action');
    assert.equal(await page.textContent('#toast'), 'Your previous score is kept in Recent workUndo');
    assert.equal(await page.locator('#toast .toast-action').textContent(), 'Undo');
    await openRecent(page);
    const text = await page.locator('#dlg-recent').innerText();
    assert.doesNotMatch(text.replace(/First|Second/g, ''), /[가-힣]/, `영어 화면에 한글이 남았다: ${text}`);
    assert.match(await page.textContent('#dlg-recent h2'), /Recent work/);
    assert.deepEqual(await row(page, 'First').locator('button').allTextContents(), ['Open', 'Download as file', 'Delete']);
    assert.match(await row(page, 'First').locator('.rc-measures').textContent(), /^\d+ measures?$/);
    await page.waitForFunction(() => !document.querySelector('#rc-usage').hidden);
    assert.match(await page.textContent('#rc-usage'), /^Using .+ of about .+$/);
    assert.match(await row(page, 'Second').locator('.rc-badge').textContent(), /Open now/);
    assert.equal(await row(page, 'First').locator('.rc-open').getAttribute('aria-label'), 'Open — First');
    await row(page, 'First').locator('.rc-delete').click();
    await page.waitForSelector('#dlg-prompt[open]');
    assert.match(await page.textContent('#dlg-prompt h2'), /Delete this saved score\?/);
    assert.match(await page.textContent('#dlg-prompt p'), /“First” will be deleted from this browser/);
    await page.click('#dlg-prompt button:has-text("Cancel")');
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('최근 작업 창: 자동 저장 공간이 부족하면 처음 한 번 창이 열리고, 그 뒤에는 토스트 버튼으로 안내한다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser, { locale: 'ko-KR' });
    await edit(page, '저장된 악보'); await settled(page);
    await page.evaluate(() => { SF.store.saveDoc = async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }; });
    await edit(page, '저장 못 하는 악보');
    await page.waitForSelector('#dlg-recent[open]');
    await page.waitForFunction(() => !document.querySelector('#rc-list').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#rc-warn').isVisible(), true);
    assert.match(await page.textContent('#rc-warn'), /자동 저장 공간이 부족해요/);
    assert.deepEqual(await titles(page), ['저장된 악보']);
    await page.waitForFunction(() => !document.querySelector('#rc-usage').hidden);
    await closeRecent(page);
    // 두 번째 실패부터는 창을 다시 열지 않고 토스트에 [최근 작업] 버튼을 단다
    await edit(page, '또 저장 못 함');
    await page.waitForSelector('#toast.show.has-action');
    assert.match(await page.textContent('#toast'), /자동 저장 공간이 부족해요/);
    assert.equal(await page.locator('#dlg-recent').evaluate(d => d.open), false);
    await page.click('#toast .toast-action');
    await page.waitForSelector('#dlg-recent[open]');
    assert.equal(await page.locator('#rc-warn').isVisible(), true);
    await closeRecent(page);
    // 일반 저장 실패(공간 부족이 아님)는 예전처럼 토스트만
    await page.evaluate(() => { SF.store.saveDoc = async () => { throw new Error('boom'); }; });
    await edit(page, '다른 오류');
    await page.waitForFunction(() => /자동 저장에 실패했어요/.test(document.querySelector('#toast').textContent));
    assert.equal(await page.locator('#toast .toast-action').count(), 0);
    assert.equal(await page.locator('#dlg-recent').evaluate(d => d.open), false);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('토스트: 버튼이 없는 기존 토스트는 그대로 동작한다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser, { locale: 'ko-KR' });
    await page.evaluate(() => SF.app.toast('기존 토스트'));
    assert.equal(await page.textContent('#toast'), '기존 토스트');
    assert.equal(await page.locator('#toast .toast-action').count(), 0);
    assert.equal(await page.locator('#toast').evaluate(el => el.classList.contains('has-action')), false);
    // 버튼 토스트 뒤에 일반 토스트가 오면 버튼이 남지 않는다
    await page.evaluate(() => SF.app.toast('버튼 토스트', { action: { label: '실행', run: () => { window.__ran = (window.__ran || 0) + 1; } } }));
    assert.equal(await page.locator('#toast .toast-action').count(), 1);
    await page.evaluate(() => SF.app.toast('일반 토스트'));
    assert.equal(await page.locator('#toast .toast-action').count(), 0);
    assert.equal(await page.locator('#toast').evaluate(el => el.classList.contains('has-action')), false);
    // 버튼을 누르면 run 1회 + 토스트 숨김
    await page.evaluate(() => SF.app.toast('버튼 토스트', { action: { label: '실행', run: () => { window.__ran = (window.__ran || 0) + 1; } } }));
    await page.click('#toast .toast-action');
    await page.waitForFunction(() => window.__ran === 1);
    assert.equal(await page.locator('#toast').evaluate(el => el.classList.contains('show')), false);
    // 일반 토스트는 약 2.2초 뒤, 버튼 토스트는 더 오래 보인다
    const lifetimes = await page.evaluate(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)), el = document.querySelector('#toast');
      SF.app.toast('짧게'); await wait(1900); const plainAt19 = el.classList.contains('show'); await wait(500); const plainAt24 = el.classList.contains('show');
      SF.app.toast('길게', { action: { label: '실행', run() {} } }); await wait(2600); const actionAt26 = el.classList.contains('show');
      return { plainAt19, plainAt24, actionAt26 };
    });
    assert.deepEqual(lifetimes, { plainAt19: true, plainAt24: false, actionAt26: true });
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
