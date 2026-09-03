import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const svg = await readFile('icons/icon.svg', 'utf8');
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent('<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>' + svg);
  await page.screenshot({ path: 'icons/icon-' + size + '.png' });
  await page.close();
}
await browser.close();
