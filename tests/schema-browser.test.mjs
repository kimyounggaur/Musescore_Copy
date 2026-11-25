// P8-2 불러오기 스키마 검사 — 실제 브라우저에서 확인한다.
//  · 고칠 수 있는 파일을 열면 → 가져오기 결과 창에 "자동으로 고친 항목"과 "(N건)" 목록이 뜨고, 악보는 고친 값으로 열린다.
//  · 정상 파일은 → 결과 창 없이 평소처럼 열린다(고친 항목 제목은 숨김).
//  · 고칠 수 없는 파일은 → "열 수 없어요" 토스트로 이유를 알리고, 지금 악보는 그대로.
//  · 영어 화면에서는 같은 제목·요약·목록이 영어로 보인다.
//  · 저장소에 심어 둔 기록을 새로고침해 열 때(부팅 복원)도 같은 창이 뜬다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/schema-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const TAB_KEY = 'scoreforge.activeDocId';

async function openApp(browser, { locale = 'ko-KR' } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1280, height: 900 }, locale }));
  await context.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(10000);
  page.pageErrors = []; page.consoleErrors = [];
  page.on('pageerror', error => page.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') page.consoleErrors.push(message.text()); });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await ready(page);
  return { context, page };
}
const ready = async page => { await page.waitForSelector('#svg-host .ev'); await page.waitForFunction(() => SF.engrave.isFontReady()); };
const quiet = page => assert.deepEqual([page.pageErrors, page.consoleErrors], [[], []], '페이지 오류·콘솔 오류 없음');
const titleOf = page => page.evaluate(() => SF.core.state.score.meta.title);
const toastText = page => page.evaluate(() => (document.querySelector('#toast')?.classList.contains('show') ? document.querySelector('#toast').textContent : ''));
const dialogOpen = page => page.evaluate(() => document.querySelector('#dlg-import').open);

/** 앱 안에서 나비야 데모의 악보 파일 본문을 만들어 mutate(data)로 망가뜨린 뒤 문자열로 돌려준다(파일 저장과 같은 껍데기). */
const fileText = (page, title, mutate) => page.evaluate(([title, mutate]) => {
  const score = SF.io.DEMOS.butterfly(); score.meta.title = title;
  const data = SF.core.toJSON(score);
  if (mutate) new Function('data', mutate)(data);
  return JSON.stringify({ app: 'scoreforge', version: 2, score: data });
}, [title, mutate]);
/** 파일 열기와 같은 통로(loadScoreFile → handleLoadedScore)로 연다. 열기가 끝나면 돌려준다. */
const openText = (page, text, name = 'x.scoreforge.json') => page.evaluate(([text, name]) => new Promise(resolve => {
  SF.io.loadScoreFile(new File([text], name), async (...args) => { resolve(await SF.app.handleLoadedScore(...args)); });
}), [text, name]);

const FIXABLE = 'data.tempo = 5000; data.spanners = "x";';   // 템포 범위 밖 + 모양이 틀린 항목 → 둘 다 고쳐서 열 수 있다
const lines = page => page.locator('#imp-list li').allTextContents();

test('불러오기 스키마 검사(브라우저)', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 300000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    await t.test('고칠 수 있는 파일: 결과 창에 "자동으로 고친 항목" + (N건) 목록, 악보는 고친 값으로 열린다', async () => {
      const { context, page } = await openApp(browser);
      const opened = await openText(page, await fileText(page, '고친 악보', FIXABLE));
      assert.notEqual(opened, false);
      await page.waitForFunction(() => document.querySelector('#dlg-import').open);
      assert.equal(await page.locator('#imp-fixes-title').isVisible(), true);
      assert.equal((await page.locator('#imp-fixes-title').textContent()).trim(), '자동으로 고친 항목');
      assert.match(await page.locator('#imp-summary').textContent(), /^"고친 악보" — 8마디를 열었어요\. 올바르지 않은 값이 있어 아래처럼 자동으로 고쳤어요\.$/);
      const items = await lines(page);
      assert.ok(items.length >= 2, `목록 ${items.length}줄`);
      for (const item of items) assert.match(item, /\(\d+건\)$/, item);
      assert.ok(items.some(item => /^템포를 10~999 범위로 맞췄어요 \(1건\)$/.test(item)), '템포 줄');
      assert.ok(items.some(item => /^모양이 올바르지 않은 항목\(장식·가사·보표 설정 등\)을 지웠어요 \(1건\)$/.test(item)), '모양이 틀린 항목 줄');
      assert.equal(await titleOf(page), '고친 악보');
      assert.equal(await page.evaluate(() => SF.core.state.score.tempo), 999, '템포는 범위 끝으로');
      assert.equal(await page.evaluate(() => SF.core.state.score.measures.length), 8);
      await page.waitForSelector('#svg-host .ev');                                   // 고친 악보가 그려진다
      await page.click('#dlg-import .dlg-actions button');                           // 확인
      assert.equal(await dialogOpen(page), false);
      quiet(page);
      await context.close();
    });

    await t.test('정상 파일: 결과 창이 뜨지 않고 고친 항목 제목은 숨겨진 채 평소처럼 열린다', async () => {
      const { context, page } = await openApp(browser);
      await openText(page, await fileText(page, '정상 악보'));
      await page.waitForFunction(() => SF.core.state.score.meta.title === '정상 악보');
      assert.equal(await dialogOpen(page), false);
      assert.equal(await page.locator('#imp-fixes-title').isHidden(), true);
      assert.match(await toastText(page), /"정상 악보" 불러왔어요/);
      // 이어서 고칠 수 있는 파일을 열었다가, 다시 정상 파일을 열면 제목이 다시 숨겨진다(창 상태가 남지 않는다).
      await openText(page, await fileText(page, '고친 악보', FIXABLE));
      await page.waitForFunction(() => document.querySelector('#dlg-import').open);
      await page.click('#dlg-import .dlg-actions button');
      // 가져오기(변환 보고서)는 같은 창을 다른 문구로 쓴다: 고친 항목 제목이 남아 있으면 안 된다.
      await page.evaluate(() => SF.app.handleLoadedScore(SF.io.DEMOS.butterfly(), '가져온 곡.musicxml', null, ['어떤 항목이 바뀌었어요 (2건)']));
      assert.equal(await dialogOpen(page), true);
      assert.equal(await page.locator('#imp-fixes-title').isHidden(), true);
      assert.match(await page.locator('#imp-summary').textContent(), /가져왔어요\. 아래 항목은 이 앱이 지원하는 범위로 줄이면서 바뀌거나 무시됐어요\.$/);
      await page.click('#dlg-import .dlg-actions button');
      await openText(page, await fileText(page, '또 정상'));
      await page.waitForFunction(() => SF.core.state.score.meta.title === '또 정상');
      assert.equal(await dialogOpen(page), false);
      assert.equal(await page.locator('#imp-fixes-title').isHidden(), true);
      quiet(page);
      await context.close();
    });

    await t.test('고칠 수 없는 파일: "열 수 없어요" + 이유, 지금 악보와 결과 창은 그대로', async () => {
      const { context, page } = await openApp(browser);
      const before = await titleOf(page);
      assert.equal(await openText(page, await fileText(page, '못 여는 악보', 'data.parts = "x";')), false);
      await page.waitForFunction(() => /열 수 없어요/.test(document.querySelector('#toast')?.textContent || ''));
      assert.match(await toastText(page), /^열 수 없어요: x\.scoreforge\.json — 악기\(parts\)가 목록이 아니에요 — parts$/);
      assert.equal(await titleOf(page), before);
      assert.equal(await dialogOpen(page), false);
      // 마디가 2,000개를 넘는 파일도 거부한다(잘라서 열면 사용자가 모르게 뒷부분을 잃는다).
      assert.equal(await openText(page, await fileText(page, '너무 긴 악보', 'const staff = data.parts[0].staves[0]; const one = staff.measures[0]; staff.measures = Array.from({ length: 2001 }, () => JSON.parse(JSON.stringify(one)));')), false);
      await page.waitForFunction(() => /마디가 너무 많아요\(2,000마디 초과\)/.test(document.querySelector('#toast')?.textContent || ''));
      assert.equal(await titleOf(page), before);
      assert.equal(await dialogOpen(page), false);
      // 64MB를 넘는 .json은 읽기 전에 거절한다(문자열·파싱이 탭을 죽이지 않게).
      const huge = await page.evaluate(() => new Promise(resolve => {
        const file = new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'huge.scoreforge.json');
        SF.io.loadScoreFile(file, async (...args) => { resolve(await SF.app.handleLoadedScore(...args)); });
      }));
      assert.equal(huge, false);
      await page.waitForFunction(() => /파일이 너무 커요\(64MB 초과\)/.test(document.querySelector('#toast')?.textContent || ''));
      assert.equal(await titleOf(page), before);
      quiet(page);
      await context.close();
    });

    await t.test('영어 화면: 같은 제목·요약·목록이 영어로 보인다(곡 제목은 그대로)', async () => {
      const { context, page } = await openApp(browser, { locale: 'en-US' });
      await openText(page, await fileText(page, 'Test song', FIXABLE));
      await page.waitForFunction(() => document.querySelector('#dlg-import').open);
      assert.equal((await page.locator('#imp-fixes-title').textContent()).trim(), 'Fixed automatically');
      assert.equal(await page.locator('#imp-summary').textContent(), 'Opened 8 measures from "Test song". Some values were invalid, so they were fixed automatically as listed below.');
      const items = await lines(page);
      assert.ok(items.some(item => /^Clamped the tempo to the 10–999 range \(1 occurrences?\)$/.test(item)), items.join(' | '));
      assert.ok(items.some(item => /^Removed malformed items \(ornaments, lyrics, staff settings, …\) \(1 occurrences?\)$/.test(item)), items.join(' | '));
      for (const item of items) assert.doesNotMatch(item, /[ㄱ-ㆎ가-힣]/, `한글이 남음: ${item}`);
      quiet(page);
      await context.close();
    });

    await t.test('부팅 복원: 저장소의 기록을 열다 고친 항목이 있으면 같은 창이 뜨고, 정상 기록은 조용히 열린다', async () => {
      const { context, page } = await openApp(browser);
      const plant = (id, title, at, mutate) => page.evaluate(async ([id, title, at, mutate]) => {
        await SF.store.open();
        const score = SF.io.DEMOS.butterfly(); score.meta.title = title;
        const data = SF.core.toJSON(score);
        if (mutate) new Function('data', mutate)(data);
        await SF.store.saveDoc({ id, title, createdAt: 1, updatedAt: at, revision: 1, origin: 'new', cloudId: null, measures: 8, bytes: 1, schema: 1, fileSavedAt: 0, data });
      }, [id, title, at, mutate]);
      const point = id => page.evaluate(async ([key, id]) => { sessionStorage.setItem(key, id); await SF.store.kvSet('lastDocId', id); }, [TAB_KEY, id]);
      await plant('fixed-1', '복원될 악보', 50, FIXABLE);
      await plant('plain-1', '그냥 악보', 40);
      await point('fixed-1');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#dlg-import')?.open);
      await ready(page);
      assert.equal(await titleOf(page), '복원될 악보');
      assert.equal((await page.locator('#imp-fixes-title').textContent()).trim(), '자동으로 고친 항목');
      assert.match(await page.locator('#imp-summary').textContent(), /^"복원될 악보" — 8마디를 열었어요\./);
      const items = await lines(page);
      assert.ok(items.some(item => /^템포를 10~999 범위로 맞췄어요 \(1건\)$/.test(item)), items.join(' | '));
      assert.equal(await page.evaluate(() => SF.core.state.score.tempo), 999);
      await page.click('#dlg-import .dlg-actions button');

      // 편집하기 전에 다시 새로고침: 저장된 기록은 그대로라 같은 고침이 또 생기지만, 같은 탭에서는 알림 창을 되풀이하지 않는다.
      await page.reload({ waitUntil: 'networkidle' });
      await ready(page);
      assert.equal(await dialogOpen(page), false);
      assert.equal(await titleOf(page), '복원될 악보');
      assert.equal(await page.evaluate(() => SF.core.state.score.tempo), 999, '고친 값으로 열린다');
      assert.equal(await page.evaluate(() => SF.session.bootInfo().fixes.length > 0), true, '고침 자체는 계속 적용된다');

      await point('plain-1');                                                      // 정상 기록: 창 없이 열린다
      await page.reload({ waitUntil: 'networkidle' });
      await ready(page);
      assert.equal(await titleOf(page), '그냥 악보');
      assert.equal(await dialogOpen(page), false);
      assert.deepEqual(await page.evaluate(() => SF.session.bootInfo().fixes), []);
      quiet(page);
      await context.close();
    });
  } finally { await browser.close(); }
});
