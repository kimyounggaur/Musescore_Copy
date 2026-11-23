// 배포 뒤 30초 점검: SF_URL을 열어 첫 화면 오류 0 · 응답 CSP의 script-src가 'self'뿐이고 CDN 없음 · SF.VERSION이 package.json과 같음.
// 사용: SF_URL=https://… node tests/verify-deploy.mjs   (PW_CHANNEL·PLAYWRIGHT_MODULE은 다른 브라우저 스크립트와 같다)
// 모든 점검을 끝까지 하고 문제 목록을 JSON으로 출력한다. 문제가 하나라도 있으면 종료 코드 1.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
import { inspectCsp } from './deploy-lib.mjs';

const base = process.env.SF_URL;
if (!base) { console.error('SF_URL이 필요해요(예: SF_URL=https://example.vercel.app node tests/verify-deploy.mjs)'); process.exit(2); }
const watchdog = setTimeout(() => { console.error(JSON.stringify({ ok: false, problems: ['30초 안에 끝나지 않았어요'] })); process.exit(1); }, 30000);

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const problems = [], pageErrors = [], violations = [];
let version = null, status = null;
const browser = await chromium.launch(launchOptions());
try {
  const page = await (await browser.newContext(pageOptions())).newPage();
  await preparePage(page);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (/violat|Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto(base, { waitUntil: 'networkidle', timeout: 20000 });
  status = response?.status() ?? null;
  if (status !== 200) problems.push(`첫 응답이 200이 아니에요: ${status}`);
  problems.push(...inspectCsp(response?.headers()['content-security-policy']));
  try { await page.waitForSelector('#svg-host svg', { timeout: 8000 }); } catch { problems.push('첫 화면의 악보(#svg-host svg)가 8초 안에 그려지지 않았어요'); }
  version = await page.evaluate(() => window.SF?.VERSION ?? null).catch(() => null);
  if (version !== expected) problems.push(`window.SF.VERSION(${version})이 package.json의 version(${expected})과 달라요`);
  if (pageErrors.length) problems.push(`첫 화면에서 페이지 오류 ${pageErrors.length}건: ${pageErrors[0]}`);
  if (violations.length) problems.push(`CSP 위반 ${violations.length}건: ${violations[0]}`);
} catch (error) {
  problems.push(`열지 못했어요: ${error.message}`);
} finally {
  await browser.close();
  clearTimeout(watchdog);
}
const result = { ok: problems.length === 0, url: base, status, version, expected, problems };
(result.ok ? console.log : console.error)(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
