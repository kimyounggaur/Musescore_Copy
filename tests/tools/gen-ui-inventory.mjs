// docs/UI_INVENTORY.md 생성기(P9-1). 앱이 떠 있어야 한다:
//   SF_HEADERS=1 npm run serve            (다른 터미널)
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node tests/tools/gen-ui-inventory.mjs
//   --check 를 붙이면 파일을 쓰지 않고 현재 문서가 화면과 같은지만 확인한다(다르면 종료 코드 1).
// 주소는 SF_URL(기본 http://127.0.0.1:8000).
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from '../browser-launch.mjs';
import { collectInventory, openForInventory, renderInventory } from '../ui-inventory-lib.mjs';

const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_MODULE) { console.error('PLAYWRIGHT_MODULE이 필요하다(예: "$PWD/node_modules/playwright")'); process.exit(2); }
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const target = new URL('../../docs/UI_INVENTORY.md', import.meta.url);
const browser = await chromium.launch(launchOptions());
try {
  const page = await (await browser.newContext(pageOptions())).newPage();
  await preparePage(page);
  await openForInventory(page, process.env.SF_URL || 'http://127.0.0.1:8000');
  const text = renderInventory(await collectInventory(page)) + '\n';
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== text) { console.error('docs/UI_INVENTORY.md가 화면과 다르다. node tests/tools/gen-ui-inventory.mjs 로 다시 만든다.'); process.exitCode = 1; }
    else console.log('docs/UI_INVENTORY.md는 화면과 같다');
  } else {
    await writeFile(target, text);
    console.log(`docs/UI_INVENTORY.md를 만들었다 (${text.split('\n').length}줄)`);
  }
} finally { await browser.close(); }
