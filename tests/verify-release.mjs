import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SF_URL || 'http://127.0.0.1:8000';
const dir = 'output/playwright/v3';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => {
  try { const details = await fn(); results.push({ name, pass: true, details }); console.log('PASS', name, details || ''); }
  catch (e) { results.push({ name, pass: false, error: e.message }); console.error('FAIL', name, e.message); }
};
const settle = () => page.evaluate(async () => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.waitForFunction(() => window.SF?.app && SF.i18n);
  await settle();
  await check('Application boot', async () => {
    assert.deepEqual(errors, []);
    assert.ok(await page.locator('#svg-host svg').count());
    return await page.evaluate(() => Object.keys(SF));
  });
  await check('Four demo MusicXML round trips', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/tests/browser.html`);
    await p.waitForFunction(() => window.__TEST_RESULT);
    const result = await p.evaluate(() => window.__TEST_RESULT);
    await p.close();
    assert.equal(result.fail, 0, JSON.stringify(result));
    return result;
  });
  await check('Extended MusicXML, MXL and MIDI browser regressions', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/tests/browser.html`);
    await p.addScriptTag({ url: `${base}/tests/audioio-browser.js` });
    const result = await p.evaluate(() => window.__AUDIOIO_DONE);
    await p.close();
    const failed = result.results.filter(r => !r.pass);
    assert.deepEqual(failed, []);
    return { passed: result.pass };
  });
  await check('Selection repaints without engraving', async () => {
    await page.evaluate(() => {
      SF.app.setReadOnly(false); SF.core.setScore(SF.io.DEMOS.butterfly()); SF.app.update({ immediate: true });
      window.__renderCount = 0; window.__originalRender = SF.engrave.render;
      SF.engrave.render = (...a) => { window.__renderCount++; return window.__originalRender(...a); };
    });
    const head = page.locator('#svg-host .nh .note-hit').first();
    await head.click(); await settle();
    assert.equal(await page.evaluate(() => window.__renderCount), 0);
    assert.ok(await page.evaluate(() => SF.app.ui.selection));
    await page.evaluate(() => { SF.engrave.render = window.__originalRender; });
  });
  await check('Chord tone selection and keyboard deletion', async () => {
    await page.evaluate(() => {
      const C = SF.core, s = C.createScore({ measureCount: 4 });
      C.inputAt(s, 0, SF.F(0), { n: 1, d: 4 }, [{ step: 0, oct: 4, alter: 0 }, { step: 2, oct: 4, alter: 0 }, { step: 4, oct: 4, alter: 0 }]);
      C.setScore(s); SF.app.ui.inputMode = false; SF.app.ui.speedy = false; SF.app.update({ immediate: true });
    });
    await page.locator('#svg-host .nh[data-note="1"] .note-hit').first().click();
    await page.keyboard.press('Delete'); await settle();
    assert.equal(await page.evaluate(() => SF.core.state.score.measures[0].events[0].notes.length), 2);
    await page.keyboard.press('Control+z'); await settle();
    assert.equal(await page.evaluate(() => SF.core.state.score.measures[0].events[0].notes.length), 3);
  });
  await check('Measure signatures, ornaments and undo', async () => {
    await page.evaluate(() => { SF.app.actions.select(SF.core.state.score.measures[0].events[0].id); SF.app.actions.showMeasureProperties?.(); document.querySelector('#properties-panel').classList.remove('collapsed'); SF.app.update({ immediate: true }); });
    await page.locator('#measure-key').selectOption('2'); await settle();
    await page.locator('#measure-clef').selectOption('alto'); await settle();
    await page.locator('#ornament-select').selectOption('trill'); await settle();
    const data = await page.evaluate(() => ({ key: SF.core.keySigAt(SF.core.state.score, 0), clef: SF.core.activeClef(SF.core.state.score, 0), ornament: SF.core.state.score.measures[0].events[0].ornament }));
    assert.deepEqual(data, { key: 2, clef: 'alto', ornament: 'trill' });
    await page.locator('#measure-after').click(); await settle();
    assert.equal(await page.evaluate(() => SF.core.state.score.measures.length), 5);
  });
  await check('Pagination, global hit coordinates and SVG export', async () => {
    const result = await page.evaluate(async () => {
      const C = SF.core, E = SF.engrave, s = C.createScore({ measureCount: 64, ensemble: 'string-quartet' });
      C.setScore(s); SF.app.ui.pageMode = 'pages'; SF.app.update({ immediate: true });
      const L = E.getLayout(), e = [...L.eventsById.values()].find(e => e.page > 0);
      const local = E.globalToPage(e.page, e.x, e.staff.yTop + 20);
      const hit = E.hitTest(e.page, local.x, local.y);
      const out = await E.renderForExport(C.state.score);
      return { pages: document.querySelectorAll('#svg-host svg.page').length, exportPages: out.pages.length, hitPage: hit?.page, expectedPage: e.page, sameLayout: E.getLayout() === L, scripts: out.svg.includes('<script'), overflow: L.pages.filter(p => p.overflow).length };
    });
    assert.ok(result.pages > 1); assert.equal(result.pages, result.exportPages);
    assert.equal(result.hitPage, result.expectedPage); assert.equal(result.sameLayout, true);
    assert.equal(result.scripts, false); assert.equal(result.overflow, 0);
    await page.screenshot({ path: `${dir}/pages-desktop.png` });
    return result;
  });
  await check('Read-only guard and local copy', async () => {
    const result = await page.evaluate(async () => {
      SF.app.setReadOnly(true); const C = SF.core, revision = C.state.revision;
      C.mutate('Blocked', s => { s.meta.title = 'Blocked'; });
      const blocked = C.state.revision === revision && C.state.score.meta.title !== 'Blocked';
      await SF.cloud.makeLocalCopy();
      return { blocked, editable: !C.state.readOnly, id: C.state.score.meta.cloudId || null };
    });
    assert.deepEqual(result, { blocked: true, editable: true, id: null });
  });
  await check('Render timing', async () => {
    const result = await page.evaluate(() => {
      const s = SF.core.createScore({ ensemble: 'string-quartet', measureCount: 64 }), E = SF.engrave;
      const a = performance.now(); for (let i = 0; i < 20; i++) E.render(s); const cold = performance.now() - a;
      const b = performance.now(); for (let i = 0; i < 20; i++) E.render(s, { cache: true });
      return { uncached20Ms: +cold.toFixed(2), cached20Ms: +(performance.now() - b).toFixed(2) };
    });
    return result;
  });
  await check('Four themes and mobile widths', async () => {
    await page.evaluate(() => { SF.core.setScore(SF.io.DEMOS.butterfly()); SF.app.ui.pageMode = 'continuous'; SF.app.update({ immediate: true }); });
    const widths = [];
    for (const theme of ['dark', 'light', 'pretty', 'cute']) {
      await page.locator('#theme-select').selectOption(theme); await settle();
      for (const [width, height] of [[1440,1080], [375,812], [768,1024]]) {
        await page.setViewportSize({ width, height }); await settle();
        await page.screenshot({ path: `${dir}/${theme}-${width}.png` });
        const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(size.scroll <= size.width + 1, JSON.stringify({ theme, ...size }));
        widths.push({ theme, ...size });
      }
    }
    return widths;
  });
  await check('English and Korean switching preserves score text', async () => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const title = await page.evaluate(() => SF.core.state.score.meta.title);
    await page.locator('#language-select').selectOption('en'); await settle();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.evaluate(() => SF.core.state.score.meta.title), title);
    const audit = await page.evaluate(() => SF.i18n.audit());
    await writeFile(`${dir}/i18n-audit.json`, JSON.stringify(audit, null, 2));
    assert.deepEqual(audit.unknownKeys, []);
    assert.deepEqual(audit.missingEnglish, []);
    await page.screenshot({ path: `${dir}/english-editor.png` });
    await page.locator('#btn-settings').click(); await page.screenshot({ path: `${dir}/english-settings.png` });
    await page.keyboard.press('Escape');
    await page.locator('#language-select').selectOption('ko'); await settle();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko');
  });
  await check('Axe critical issues in four themes', async () => {
    await page.addScriptTag({ path: 'tmp/axe.min.js' });
    const scans = [];
    for (const theme of ['dark', 'light', 'pretty', 'cute']) {
      await page.locator('#theme-select').selectOption(theme); await settle();
      const scan = await page.evaluate(async () => {
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
      });
      scans.push({ theme, violations: scan });
    }
    await writeFile(`${dir}/axe.json`, JSON.stringify(scans, null, 2));
    assert.equal(scans.flatMap(s => s.violations).filter(v => v.impact === 'critical').length, 0);
    return scans.map(s => ({ theme: s.theme, violations: s.violations.map(v => `${v.impact}:${v.id}`) }));
  });
  await check('Unhandled browser errors', () => assert.deepEqual(errors, []));
} finally {
  await writeFile(`${dir}/verification.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
if (results.some(r => !r.pass)) process.exitCode = 1;
