import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const credentials = JSON.parse(process.env.SF_TEST_ACCOUNT);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.SF_URL || 'http://127.0.0.1:8000';
const results = [], errors = [];
let savedId;
const first = await browser.newContext({ serviceWorkers: 'block' });
const second = await browser.newContext({ serviceWorkers: 'block' });
const anonymous = await browser.newContext({ serviceWorkers: 'block' });
const boot = async context => {
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.waitForFunction(() => window.SF?.cloud?.state.initialized);
  return page;
};
const login = async page => {
  await page.locator('#btn-member-login').click();
  await page.locator('#auth-email').fill(credentials.email);
  await page.locator('#auth-password').fill(credentials.password);
  await page.locator('#auth-submit').click();
  await page.waitForFunction(id => SF.auth.state.session?.user.id === id, credentials.id);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); SF.cloud.setAutoSave(false); });
};
let page;
try {
  page = await boot(first); await login(page); results.push('Real password login through application form');
  savedId = await page.evaluate(async () => {
    SF.core.setScore(SF.io.DEMOS.butterfly());
    SF.core.mutate('Test title', s => { s.meta.title = 'ScoreForge live verification'; });
    const row = await SF.cloud.saveCurrent({ interactive: false });
    return row.id;
  });
  assert.ok(savedId); results.push('Cloud INSERT and metadata attachment');
  const other = await boot(second); await login(other);
  await other.evaluate(id => SF.cloud.open(id), savedId);
  assert.equal(await other.evaluate(() => SF.core.state.score.meta.title), 'ScoreForge live verification');
  results.push('Load same score in an independent browser context');
  await other.evaluate(async () => {
    SF.core.mutate('Remote edit', s => { s.meta.title = 'Remote browser edit'; });
    await SF.cloud.saveCurrent({ interactive: false });
  });
  const conflict = await page.evaluate(async () => {
    SF.core.mutate('Conflicting edit', s => { s.meta.title = 'Local conflicting edit'; });
    try { await SF.cloud.saveCurrent({ interactive: false }); return null; } catch(e) { return e.code; }
  });
  assert.equal(conflict, 'CONFLICT'); results.push('Concurrent update rejected by timestamp compare-and-swap');
  const shared = await other.evaluate(id => SF.cloud.setPublic(id, true), savedId);
  const slug = new URL(shared).searchParams.get('share');
  assert.match(slug, /^[A-Za-z0-9_-]{12}$/);
  const guest = await boot(anonymous);
  await guest.goto(shared, { waitUntil: 'networkidle' });
  await guest.waitForFunction(() => SF.core.state.readOnly);
  assert.equal(await guest.evaluate(() => SF.core.state.score.meta.title), 'Remote browser edit');
  assert.equal(await guest.evaluate(() => SF.core.state.readOnly), true);
  results.push('Anonymous capability link loads read-only score');
  await other.evaluate(id => SF.cloud.setPublic(id, false), savedId);
  const revoked = await guest.evaluate(async slug => {
    try { await SF.cloud.loadShared(slug); return false; } catch(e) { return true; }
  }, slug);
  assert.equal(revoked, true); results.push('Share revocation immediately denies anonymous reload');
  await other.evaluate(id => SF.cloud.remove(id), savedId); savedId = null;
  results.push('Owner DELETE'); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: results, errors }, null, 2));
} finally {
  if (savedId && page) await page.evaluate(id => SF.cloud.remove(id).catch(() => {}), savedId).catch(() => {});
  for (const context of [first, second]) for (const p of context.pages()) await p.evaluate(() => SF.auth.getClient().auth.signOut({ scope: 'local' })).catch(() => {});
  await mkdir('output/playwright/v3', { recursive: true });
  await writeFile('output/playwright/v3/cloud-live.json', JSON.stringify({ pass: results, errors }, null, 2));
  await browser.close();
}
