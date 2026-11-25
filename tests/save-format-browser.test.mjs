// P7-B1 저장 형식 v2 — 실제 브라우저에서: 파일 저장(v2)·"구버전 호환으로 저장"(v1)·두 파일 다시 열기·자동 저장 기록·최근 작업의 마디 수.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/save-format-browser.test.mjs
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
const menu = async (page, act) => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
async function download(page, act) {
  const pending = page.waitForEvent('download');
  await menu(page, act);
  const file = await pending;
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
}
async function openFile(page, name, text) {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'open');
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
// 비교에서 뺄 것: 문서 ID(meta.docId — 열 때마다 정해질 수 있다)와 "__"로 시작하는 그리기용 임시 값(임시표 표시 계산 __acc 등 —
// 그릴 때마다 모델에 적히므로 그리기 전에 뜬 글과 그린 뒤 저장한 파일이 다를 수 있다). 악보 내용만 본다.
const content = page => page.evaluate(() => JSON.stringify(SF.core.toJSON(SF.core.state.score), (key, value) => key === 'docId' || key.startsWith('__') ? undefined : value));
// 두 악보 글이 어디서 처음 달라지는지 — 실패했을 때 어느 값이 다른지 바로 보이게 한다.
function firstDiff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  return null;
}
function assertSameScore(actual, expected, label) {
  assert.equal(firstDiff(JSON.parse(actual), JSON.parse(expected)), null, `${label}: 값이 다르다`);
  assert.equal(actual, expected, `${label}: 값은 같지만 글자(키 순서)가 다르다`);
}

test('저장 형식 v2: 파일 저장·구버전 호환 저장·다시 열기·자동 저장 기록·최근 작업의 마디 수', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    await page.evaluate(() => SF.core.mutate('시험 편집', s => { s.meta.title = 'save format test'; SF.core.inputAt(s, 1, SF.F(0, 1), { n: 1, d: 4, dots: 0 }, [{ step: 0, alter: 0, oct: 4 }], { voice: 2 }); }));
    const measureCount = await page.evaluate(() => SF.core.state.score.parts[0].staves[0].measures.length);
    assert.ok(measureCount >= 2);
    const original = await content(page);

    await t.test('파일 메뉴 "저장 (.json)" 바로 아래에 "구버전 호환으로 저장" 항목이 있다', async () => {
      await page.click('#btn-file');
      const acts = await page.$$eval('#file-menu [role="menuitem"]', items => items.map(i => i.dataset.act).slice(0, 5));
      assert.deepEqual(acts, ['new', 'open', 'recent', 'save', 'save-legacy']);
      assert.match(await page.textContent('#file-menu [data-act="save-legacy"]'), /구버전 호환으로 저장/);
      await page.keyboard.press('Escape');
    });

    let v2, v1;
    await t.test('저장은 v2 파일: 머리 version 2, schema 2, 최상위 measures·마디 events 없음', async () => {
      v2 = await download(page, 'save');
      assert.equal(v2.name, 'save format test.scoreforge.json');
      const file = JSON.parse(v2.text);
      assert.equal(file.app, 'scoreforge'); assert.equal(file.version, 2); assert.equal(file.score.schema, 2);
      assert.equal('measures' in file.score, false);
      assert.equal(v2.text.includes('"events"'), false);
      assert.match(await page.textContent('#toast'), /악보 파일을 내려받았어요/);
      assert.equal(await page.evaluate(() => SF.core.state.dirty), false);
    });

    await t.test('구버전 호환으로 저장은 v1 파일: 머리 version 1, 최상위 measures·마디 events가 있고 schema는 없다', async () => {
      v1 = await download(page, 'save-legacy');
      const file = JSON.parse(v1.text);
      assert.equal(file.version, 1); assert.equal('schema' in file.score, false);
      assert.equal(file.score.measures.length, measureCount);
      assert.ok(Array.isArray(file.score.parts[0].staves[0].measures[0].events));
      assert.match(await page.textContent('#toast'), /구버전 호환 형식으로 악보 파일을 내려받았어요/);
      assert.ok(v1.text.length > v2.text.length * 2, `v1 ${v1.text.length}B vs v2 ${v2.text.length}B`);
    });

    await t.test('두 파일을 열면 같은 악보가 되고(저장 전과 글자까지 같음), 같은 문서라 묻지도 않는다', async () => {
      for (const [label, file] of [['v2', v2], ['v1', v1]]) {
        await menu(page, 'demo-star');                                           // 다른 악보로 갔다가
        await page.waitForFunction(() => SF.core.state.score.meta.title !== 'save format test');
        await openFile(page, file.name, file.text);                              // 저장한 파일을 연다
        await page.waitForFunction(title => SF.core.state.score.meta.title === title, 'save format test');
        assert.equal(await page.evaluate(() => !!document.querySelector('#dlg-choice[open]')), false, `${label}: 같은 문서라 "자동 저장본이 있어요" 대화상자가 뜨지 않는다`);
        assertSameScore(await content(page), original, `${label} 파일로 연 악보`);
        assert.equal(await page.evaluate(() => 'schema' in SF.core.state.score), false, `${label}: 모델에 schema가 남지 않는다`);
      }
    });

    await t.test('자동 저장 기록은 schema 2, 최상위 measures 없음, 마디 수가 정확하다', async () => {
      await page.evaluate(() => SF.core.mutate('기록 만들기', s => { s.meta.title = '기록 시험'; }));
      assert.equal(await page.evaluate(() => SF.io.flushAutosave()), true);
      const rec = await page.evaluate(async () => { const doc = await SF.store.loadDoc(SF.core.state.score.meta.docId); return { schema: doc.schema, measures: doc.measures, hasTop: 'measures' in doc.data, dataSchema: doc.data.schema, events: JSON.stringify(doc.data).includes('"events"'), count: doc.data.parts[0].staves[0].measures.length }; });
      assert.equal(rec.schema, 2); assert.equal(rec.dataSchema, 2);
      assert.equal(rec.hasTop, false); assert.equal(rec.events, false);
      assert.equal(rec.measures, measureCount); assert.equal(rec.count, measureCount);
    });

    await t.test('최근 작업 창의 "N마디"가 0이 아니라 실제 마디 수다', async () => {
      await page.evaluate(() => SF.recent.open());
      await page.waitForSelector('.rc-measures');
      const labels = await page.$$eval('.rc-measures', els => els.map(e => e.textContent.trim()));
      assert.ok(labels.includes(`${measureCount}마디`), `표시: ${labels.join(', ')}`);
      assert.equal(labels.includes('0마디'), false);
    });

    await t.test('영어 화면에서도 새 항목이 번역된다', async () => {
      await page.evaluate(() => { document.querySelector('#recent-dialog, .recent-dialog')?.close?.(); });
      await page.evaluate(() => SF.i18n.setLanguage('en', { persist: false }));
      await page.waitForFunction(() => /Save for older versions/.test(document.querySelector('#file-menu [data-act="save-legacy"]').textContent));
      assert.match(await page.textContent('#file-menu [data-act="save-legacy"]'), /For opening in older app versions/);
      await page.evaluate(() => SF.i18n.setLanguage('ko', { persist: false }));
    });

    assert.deepEqual(pageErrors, []);
    await page.context().close();
  } finally { await browser.close(); }
});
