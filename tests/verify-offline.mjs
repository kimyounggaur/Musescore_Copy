import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext(pageOptions());
const page = await context.newPage();
await preparePage(page);
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
    const key = (await caches.keys()).find(name => name.startsWith('scoreforge-shell-'));   // 이름은 버전+해시라서 접두로 찾는다
    const cache = await caches.open(key);
    return (await cache.keys()).map(r => r.url);
  });
  assert.ok(cached.some(url => url.endsWith('/vendor/supabase.js')));
  assert.ok(cached.some(url => url.endsWith('/js/cloud.js')));
  assert.ok(cached.some(url => url.endsWith('/privacy.html')) && cached.some(url => url.endsWith('/css/privacy.css')), '개인정보 처리 안내도 사전 캐시에 있다');
  assert.ok(cached.some(url => url.endsWith('/licenses.html')), '라이선스 고지도 사전 캐시에 있다');
  assert.equal(cached.some(url => url.includes('.supabase.co')), false);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => SF.core.state.score.meta.title === 'Offline verification');
  assert.ok(await page.locator('#svg-host svg').count());
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => SF.playback.player.playing);
  await page.evaluate(() => SF.playback.stop());
  // 오프라인에서도 개인정보 처리 안내가 열리고, 앱이 동의 때 기록하는 버전과 같은 버전이 적혀 있다
  const privacy = await context.newPage();
  await privacy.goto(`${base}/privacy.html`, { waitUntil: 'load' });
  assert.match(await privacy.locator('h1').innerText(), /개인정보 처리 안내/);
  assert.equal(await privacy.locator('#privacy-version').innerText(), await page.evaluate(() => SF.auth.privacyVersion));
  await privacy.close();
  // 라이선스 고지(P9-5)도 오프라인에서 열리고 글꼴 라이선스(OFL) 전문이 들어 있다
  const licenses = await context.newPage();
  await licenses.goto(`${base}/licenses.html`, { waitUntil: 'load' });
  assert.match(await licenses.locator('h1').innerText(), /제3자 구성 요소 고지/);
  assert.match(await licenses.locator('#lic-ofl + pre').innerText(), /SIL OPEN FONT LICENSE Version 1\.1/);
  await licenses.close();
  const result = { origin: base, version: await page.evaluate(() => SF.VERSION), offlineReload: true, privacyOffline: true, licensesOffline: true, savedScoreRestored: true, localVendorLoaded: await page.evaluate(() => !!window.supabase), playbackStarted: true, cachedFiles: cached.length, csp, errors };
  await mkdir('output/playwright/v3', { recursive: true });
  await page.screenshot({ path: 'output/playwright/v3/offline.png' });
  await writeFile('output/playwright/v3/offline.json', JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(csp, []);
  console.log(result);
} finally { await browser.close(); }
