import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);

/* P9-6: 토스트·입력창 문구는 번역 키(SF.t)로 바로 나온다.
 * 영어로 바꾼 뒤 "나중에 번역해 주는 장치"(관찰자·translate)를 꺼도 한국어가 새지 않아야 하고,
 * 한국어에서는 예전과 똑같은 문구가 나와야 한다. */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

test('toasts and dialogs come out in the chosen language without post-hoc translation', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage(pageOptions({ viewport: { width: 1440, height: 900 } }));
  await preparePage(page);
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('scoreforge.welcomed', '1'); } catch (e) { /* 저장소를 못 쓰면 환영 창이 뜰 뿐 */ } });
  await page.goto(process.env.SF_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());

  const toastAfter = async fn => {
    await page.$eval('#toast', el => { el.textContent = ''; });
    await page.evaluate(fn);
    await page.waitForTimeout(60);
    return page.$eval('#toast', el => el.textContent);
  };
  const dialogTexts = async open => {
    await page.evaluate(open);
    await page.waitForSelector('dialog[open]');
    const texts = await page.$$eval('dialog[open] h2, dialog[open] label, dialog[open] button', els => els.map(e => e.textContent.trim()).filter(Boolean));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    return texts;
  };
  const useLanguage = async language => {
    await page.evaluate(language => {
      SF.i18n.setLanguage(language, { persist: false });
      if (language === 'en') { SF.i18n.disconnect(); SF.i18n.translate = value => value; }
    }, language);
  };
  const cases = [
    ['copy', () => { SF.app.actions.copySelection(); }],
    ['paste', () => { SF.app.actions.pasteClipboard(); }],
    ['grace note', () => { SF.app.actions.applyGraceBefore(); }],
    ['slur', () => { SF.app.actions.toggleSlur(); }],
    ['theme light', () => { SF.app.actions.applyTheme('light'); }],
    ['theme dark', () => { SF.app.actions.applyTheme('dark'); }],
  ];
  const dialogs = [
    ['tempo', () => { window.__dialog = SF.app.actions.applyTempoMark(); }],
    ['rehearsal mark', () => { window.__dialog = SF.app.actions.applyRehearsalMark(); }],
    ['staff text', () => { window.__dialog = SF.app.actions.applyStaffText(); }],
    ['repeat count', () => { window.__dialog = SF.app.actions.applyRepeatCount(); }],
    ['bare prompt defaults', () => { window.__dialog = SF.ui.promptDialog({}); }],
    ['bare confirm defaults', () => { window.__dialog = SF.ui.confirmDialog({}); }],
  ];
  try {
    await page.click('#svg-host .ev .nh');
    const korean = {};
    await t.test('Korean: every message is what it always was', async () => {
      for (const [name, fn] of cases) korean[name] = await toastAfter(fn);
      assert.equal(korean.copy, '1개를 복사했어요');
      assert.equal(korean.paste, '1개를 붙여넣었어요');
      assert.equal(korean['grace note'], '꾸밈음을 추가했어요');
      assert.equal(korean.slur, '이음줄을 걸었어요 (다시 S = 삭제)');
      assert.equal(korean['theme light'], '밝은 UI로 전환했어요');
      assert.equal(korean['theme dark'], '어두운 UI로 전환했어요');
      const tempo = await dialogTexts(dialogs[0][1]);
      assert.deepEqual([tempo[0], tempo.at(-2), tempo.at(-1)], ['템포 표시 ♩ =', '취소', '확인']);
      assert.deepEqual(await dialogTexts(dialogs[4][1]), ['입력', '내용', '취소', '확인']);
      assert.deepEqual((await dialogTexts(dialogs[5][1])).slice(-2), ['취소', '확인']);
    });
    await t.test('English: no Korean text leaks once post-hoc translation is off', async () => {
      await useLanguage('en');
      for (const [name, fn] of cases) {
        const text = await toastAfter(fn);
        assert.ok(text.length > 0, `${name}: toast is empty`);
        assert.equal(HANGUL.test(text), false, `${name}: Korean left in English toast → ${JSON.stringify(text)}`);
        assert.notEqual(text, korean[name], `${name}: not translated`);
      }
      for (const [name, open] of dialogs) {
        const texts = await dialogTexts(open);
        assert.ok(texts.length >= 3, `${name}: dialog has no text`);
        for (const text of texts) assert.equal(HANGUL.test(text), false, `${name}: Korean left in English dialog → ${JSON.stringify(text)}`);
      }
      const bare = await dialogTexts(dialogs[4][1]);
      assert.deepEqual(bare, ['Input', 'Content', 'Cancel', 'OK']);
    });
    await t.test('choice dialogs fall back to a translated default title', async () => {
      await useLanguage('en');
      await page.evaluate(() => { window.__choice = SF.ui.choiceDialog({ choices: [{ id: 'a', label: 'A', primary: true }] }); });
      await page.waitForSelector('#dlg-choice[open]');
      assert.equal(await page.$eval('#dlg-choice h2', el => el.textContent), 'Choose');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await useLanguage('ko');
      await page.evaluate(() => { window.__choice = SF.ui.choiceDialog({ choices: [{ id: 'a', label: 'A', primary: true }] }); });
      await page.waitForSelector('#dlg-choice[open]');
      assert.equal(await page.$eval('#dlg-choice h2', el => el.textContent), '선택');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
