// P5-B1·B2: 음표머리마다 클릭 영역(.note-hit 타원)이 하나씩, 알맞은 자리에 붙어 있는지 실제 화면에서 확인한다.
//  - 음표 하나·화음(2도 간격으로 어긋난 머리 포함)·2성부·여러 보표·쪽 나누기 보기 모두에서
//    layout의 noteheads(머리 하나당 x·y·너비·높이)와 화면의 .note-hit이 1:1로 맞아야 한다.
//  - 이 검사는 클릭 영역을 앱이 붙이든(5-B1) 조판기가 직접 그리든(5-B2) 같은 결과를 요구한다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/hit-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

// 페이지 안에서 실행: layout의 음표머리와 화면의 .note-hit을 맞춰 본다.
function compareHits() {
  const L = SF.app.actions.getLayoutCache();
  const host = document.querySelector('#svg-host');
  const all = [...host.querySelectorAll('.note-hit')];
  let expected = 0; const problems = [];
  for (const le of L.eventsById.values()) {
    const ev = host.querySelector(`[data-ref="${CSS.escape(le.id)}"]`);
    for (const head of le.noteheads || []) {
      const group = ev?.querySelector(`[data-note="${head.index}"]`);
      if (!group) continue;
      expected++;
      const mine = group.querySelectorAll(':scope > .note-hit');
      if (mine.length !== 1) { problems.push(`${le.id}#${head.index}: .note-hit ${mine.length}개`); continue; }
      const want = { cx: head.x, cy: head.y, rx: Math.max(6, head.width / 2), ry: Math.max(5, head.height / 2) };
      for (const [key, value] of Object.entries(want)) {
        const got = +mine[0].getAttribute(key);
        if (!(Math.abs(got - value) < 0.01)) problems.push(`${le.id}#${head.index}: ${key} ${got} ≠ ${value}`);
      }
    }
  }
  return { total: all.length, expected, problems: problems.slice(0, 8), noteheads: [...L.eventsById.values()].reduce((n, le) => n + (le.noteheads?.length || 0), 0) };
}

test('음표머리마다 .note-hit이 하나씩, layout의 머리 좌표·크기대로 붙는다(데모·화음·2성부·여러 보표·쪽 나누기)', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 } }));
    const page = await context.newPage();
    await preparePage(page);
    page.setDefaultTimeout(8000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const show = async (label, setup, arg) => {
      await page.evaluate(setup, arg);
      await page.evaluate(() => { SF.app.update({ immediate: true }); });
      await settle();
      const r = await page.evaluate(compareHits);
      assert.ok(r.expected > 0, `${label}: 음표머리가 있다`);
      assert.deepEqual(r.problems, [], `${label}: 좌표·개수 불일치`);
      assert.equal(r.total, r.expected, `${label}: 클릭 영역 수(${r.total}) = 음표머리 수(${r.expected})`);
      return r;
    };

    for (const name of ['butterfly', 'star', 'airplane', 'rhythm']) {
      await show(`데모 ${name}`, n => { SF.core.setScore(SF.io.DEMOS[n]()); }, name);
    }
    // 화음(2도 간격이라 머리가 좌우로 어긋남)·2성부·피아노 두 보표
    const mixed = await show('화음·2성부·두 보표', () => {
      const C = SF.core, F = SF.F, q = { n: 1, d: 4, dots: 0 };
      C.setScore(C.createScore({ ensemble: 'piano', measureCount: 2 }));
      C.mutate('fill', score => {
        C.inputAt(score, 0, F(0), q, [{ step: 0, alter: 0, oct: 4 }, { step: 1, alter: 0, oct: 4 }, { step: 4, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 });
        C.inputAt(score, 0, F(0), q, [{ step: 2, alter: 0, oct: 3 }], { partIdx: 0, staffIdx: 0, voice: 2 });
        C.inputAt(score, 0, F(0), q, [{ step: 0, alter: 0, oct: 2 }, { step: 4, alter: 0, oct: 2 }], { partIdx: 0, staffIdx: 1, voice: 1 });
        C.inputAt(score, 1, F(0), q, [{ step: 5, alter: 0, oct: 5 }], { partIdx: 0, staffIdx: 0, voice: 1 });
      });
    });
    assert.equal(mixed.expected, 7, '화음 3 + 2성부 1 + 왼손 화음 2 + 둘째 마디 1 = 음표머리 7개');
    // 쪽 나누기 보기(여러 쪽의 좌표계): 마디마다 음표가 하나인 100마디 악보는 여러 쪽에 걸친다
    await page.evaluate(() => { SF.app.ui.pageMode = 'pages'; });
    const paged = await show('쪽 나누기 보기', () => {
      const C = SF.core, F = SF.F, q = { n: 1, d: 4, dots: 0 };
      C.setScore(C.createScore({ measureCount: 100 }));
      C.mutate('fill', score => { for (let m = 0; m < 100; m++) C.inputAt(score, m, F(0), q, [{ step: m % 7, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 }); });
    });
    assert.equal(paged.expected, 100);
    assert.ok(await page.evaluate(() => document.querySelectorAll('#svg-host svg.page').length) >= 2, '여러 쪽으로 나뉜다');
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
