// 악성 악보 파일 E2E — 실제 브라우저에서 위험한 값이 든 파일을 열고 모든 패널을 연다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/security-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
import { PAYLOAD } from './fixtures/make-xss-fixture.mjs';
const require = createRequire(import.meta.url);

test('악성 악보 파일: 어떤 패널에서도 HTML이 끼어들지 않는다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 150000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage(pageOptions({ viewport: { width: 1440, height: 1080 } }));
    await preparePage(page);
    page.setDefaultTimeout(8000);
    let dialogs = 0;
    const pageErrors = [];
    page.on('dialog', d => { dialogs++; d.dismiss().catch(() => {}); });
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('scoreforge.welcomed', '1');
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    await page.goto(process.env.SF_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const closeDialogs = () => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

    // 새 요소가 끼어들지 않았는지 — 상태 전체를 한 번에 검사
    const assertClean = async label => {
      const state = await page.evaluate(() => ({
        elements: document.querySelectorAll('img, iframe, [onerror], [onload]').length,
        xss: window.__xss ?? null,
        csp: window.__csp.slice(),
      }));
      assert.equal(state.elements, 0, `${label}: img/iframe/핸들러 요소가 생겼다`);
      assert.equal(state.xss, null, `${label}: 스크립트가 실행됐다`);
      assert.deepEqual(state.csp, [], `${label}: CSP 위반`);
      assert.equal(dialogs, 0, `${label}: 경고창이 떴다`);
      assert.deepEqual(pageErrors, [], `${label}: 페이지 오류`);
    };
    const openAllPanels = async label => {
      for (const button of ['#btn-mixer', '#btn-navigator', '#btn-timeline', '#btn-settings']) {
        await closeDialogs();
        await page.evaluate(selector => document.querySelector(selector).click(), button);
        await settle();
        await assertClean(`${label} ${button}`);
      }
      await closeDialogs();
    };
    const firstNoteId = () => page.evaluate(() => {
      for (const ref of SF.core.staffRefs(SF.core.state.score))
        for (const mm of ref.measures)
          for (const { ev } of SF.core.measureEntries(mm, { score: SF.core.state.score }))
            if (ev.type === 'note') return ev.id;
      return null;
    });
    const selectAndOpen = async (id, label) => {
      await page.evaluate(noteId => SF.app.actions.select(noteId, { silent: true }), id);
      await page.evaluate(() => SF.app.update({ immediate: true }));
      await settle();
      await assertClean(label + ' 속성 패널');
      await openAllPanels(label);
    };

    await t.test('시나리오 1: 악성 파일을 열고 음표를 선택해 모든 패널을 연다', async () => {
      const fixture = await readFile(new URL('./fixtures/xss.scoreforge.json', import.meta.url), 'utf8');
      await page.evaluate(async text => {
        const file = new File([text], 'xss.scoreforge.json', { type: 'application/json' });
        await new Promise(resolve => SF.io.loadScoreFile(file, (...args) => { SF.app.handleLoadedScore(...args); resolve(); }));
      }, fixture);
      await settle();
      await assertClean('파일 열기 직후');
      const id = await firstNoteId();
      assert.ok(id, '첫 음표를 찾지 못했다');
      await selectAndOpen(id, '시나리오 1');
      // 제목 등 화면의 텍스트는 글자 그대로 보일 뿐이다
      assert.equal(await page.evaluate(() => SF.core.state.score.meta.title), PAYLOAD);
    });

    await t.test('시나리오 2: 정규화를 거치지 않고 템포 등에 직접 넣어도 패널이 막는다', async () => {
      const id = await firstNoteId();
      await page.evaluate(({ noteId, payload }) => {
        SF.core.mutate('payload', score => {
          const found = SF.core.findEvent(score, noteId);
          Object.assign(found.ev, { tempo: payload, rehearsal: payload, staffText: payload, color: payload });
        });
      }, { noteId: id, payload: PAYLOAD });
      await page.evaluate(() => SF.app.update({ immediate: true }));
      await settle();
      await selectAndOpen(id, '시나리오 2');
      assert.equal(await page.inputValue('#properties-body input[data-prop="tempo"]'), '', '숫자가 아닌 템포는 빈 칸이어야 한다');
    });
  } finally {
    await browser.close();
  }
});
