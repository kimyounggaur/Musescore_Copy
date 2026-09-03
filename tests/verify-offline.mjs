import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [], csp = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (/violat|Content Security Policy/i.test(m.text())) csp.push(m.text()); });
const base = process.env.SF_URL || 'http://127.0.0.1:8001';
try {
  const response = await page.goto(base, { waitUntil: 'networkidle' });
  assert.ok(response.headers()['content-security-policy']);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.evaluate(() => {
    SF.core.setScore(SF.io.DEMOS.star());
    SF.core.mutate('Offline draft', s => { s.meta.title = 'Offline verification'; });
  });
  await page.waitForFunction(() => SF.core.isAutosaved());
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('scoreforge-shell-' + SF.VERSION);
    return (await cache.keys()).map(r => r.url);
  });
  assert.ok(cached.some(url => url.endsWith('/vendor/supabase.js')));
  assert.ok(cached.some(url => url.endsWith('/js/cloud.js')));
  assert.equal(cached.some(url => url.includes('.supabase.co')), false);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => SF.core.state.score.meta.title === 'Offline verification');
  assert.ok(await page.locator('#svg-host svg').count());
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => SF.playback.player.playing);
  await page.evaluate(() => SF.playback.stop());
  const result = { offlineReload: true, savedScoreRestored: true, localVendorLoaded: await page.evaluate(() => !!window.supabase), playbackStarted: true, cachedFiles: cached.length, csp, errors };
  await mkdir('output/playwright/v3', { recursive: true });
  await page.screenshot({ path: 'output/playwright/v3/offline.png' });
  await writeFile('output/playwright/v3/offline.json', JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(csp, []);
  console.log(result);
} finally { await browser.close(); }
