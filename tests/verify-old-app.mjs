// P7-B1: 옛 앱(3.0.1 기준)이 새 저장 형식(v2) 파일을 여는지 확인한다. npm test에는 들어가지 않는다(앱 두 개가 떠 있어야 한다).
//
// 준비(터미널 두 곳):
//   지금 앱:  SF_HEADERS=1 npm run serve                                     # 8000
//   옛 앱:    git worktree add --detach /tmp/sf-301 v3.0.1-baseline && (cd /tmp/sf-301 && PORT=8002 node tests/serve.mjs)
// 실행:
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node tests/verify-old-app.mjs
// 끝나면: git worktree remove --force /tmp/sf-301
//
// 하는 일: 지금 앱에서 악보 7종을 만들어 "저장(.json)"으로 내려받고(= v2 파일), 그 파일을 옛 앱에서 열어
// 악보 내용(보표·성부·음표·스패너)이 같은지, 그려진 음표 수가 같은지, 오류가 없는지 본다.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const NEW_URL = process.env.SF_URL || 'http://127.0.0.1:8000';
const OLD_URL = process.env.SF_OLD_URL || 'http://127.0.0.1:8002';
const quartet64 = readFileSync(new URL('./baseline/quartet64.scoreforge.json', import.meta.url), 'utf8');

for (const url of [NEW_URL, OLD_URL]) {
  try { await fetch(url); } catch { console.error(`${url} 에 연결할 수 없어요. 파일 위쪽의 "준비"를 먼저 하세요.`); process.exit(2); }
}

/** 두 앱이 같은 악보를 열었는지 비교하려고 값을 맞춘다: 그리기 임시값(__*)·v1 별칭(events)을 빼고, ID는 처음 나온 순서의 번호로 바꾼다. */
function normalize(json) {
  const ids = new Map();
  const idOf = value => { if (!ids.has(value)) ids.set(value, `i${ids.size}`); return ids.get(value); };
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) { if (k.startsWith('__') || k === 'events') continue; out[k] = walk(value[k], k); }
      return out;
    }
    return (key === 'id' || key === 'startId' || key === 'endId') && typeof value === 'string' ? idOf(value) : value;
  };
  const picked = {};
  for (const k of ['clef', 'keySig', 'timeSig', 'tempo', 'instrument', 'parts', 'spanners']) if (json[k] !== undefined) picked[k] = walk(json[k], k);
  return JSON.stringify(picked);
}

const browser = await chromium.launch(launchOptions());
const errors = { 지금: [], 옛: [] };
async function openApp(url, label) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors[label].push(e.message));
  await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return page;
}
const menu = async (page, act) => { await page.click('#btn-file'); await page.click(`#file-menu [data-act="${act}"]`); };
async function openFile(page, name, text) {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'open');
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
const settle = page => page.waitForTimeout(700);

const cases = [
  ['star', p => menu(p, 'demo-star')],
  ['airplane', p => menu(p, 'demo-airplane')],
  ['butterfly', p => menu(p, 'demo-butterfly')],
  ['rhythm', p => menu(p, 'demo-rhythm')],
  ['quartet64 (4보표)', p => openFile(p, 'quartet64.scoreforge.json', quartet64)],
  ['2성부 편집', async p => {
    await menu(p, 'demo-star'); await settle(p);
    await p.evaluate(() => SF.core.mutate('시험 편집', s => { s.meta.title = 'edited voice2'; SF.core.inputAt(s, 1, SF.F(0, 1), { n: 1, d: 4, dots: 0 }, [{ step: 0, alter: 0, oct: 4 }], { voice: 2 }); }));
  }],
  ['빈 성부 쉼표에 걸린 헤어핀', p => p.evaluate(() => {
    const C = SF.core;
    const s = C.createScore({ measureCount: 2, ensemble: 'piano' });
    C.ensureParts(s);
    const [m0, m1] = s.parts[0].staves[0].measures;
    const a = C.getVoiceEvents(m0, 2, s)[0], b = C.getVoiceEvents(m1, 2, s)[0];
    const rest = len => ({ id: C.newId(), type: 'rest', dur: { ...len, dots: 0 }, notes: [], voice: 3 });
    m0.voices[2] = [rest({ n: 1, d: 2 }), rest({ n: 1, d: 2 })];
    C.invalidate(s);
    const [c, d] = m0.voices[2];
    s.spanners.push({ id: C.newId(), type: 'cresc', startId: a.id, endId: b.id }, { id: C.newId(), type: 'dim', startId: c.id, endId: d.id });
    C.normalizeSpanners(s);
    s.meta.title = 'hairpin silent';
    C.setScore(s);
  })],
];

const rows = [];
let failed = false;
try {
  const now = await openApp(NEW_URL, '지금');
  for (const [name, setup] of cases) {
    await setup(now); await settle(now);
    const mine = await now.evaluate(() => ({ title: SF.core.state.score.meta.title, v1: SF.core.toJSON(SF.core.state.score, { format: 1 }), ev: document.querySelectorAll('#svg-host .ev').length }));
    const pending = now.waitForEvent('download');
    await menu(now, 'save');
    const text = readFileSync(await (await pending).path(), 'utf8');
    const file = JSON.parse(text);
    assert.equal(file.version, 2, `${name}: 저장 파일은 v2`);

    const old = await openApp(OLD_URL, '옛');
    if (await old.evaluate(() => SF.core.state.score.meta.title) === mine.title) { await menu(old, 'demo-rhythm'); await settle(old); }   // 제목이 달라야 "열렸다"를 알 수 있다
    await openFile(old, 'v2.scoreforge.json', text);
    await old.waitForFunction(title => SF.core.state.score.meta.title === title, mine.title);
    await settle(old);
    const theirs = await old.evaluate(() => ({ version: SF.VERSION, json: SF.core.toJSON(SF.core.state.score), ev: document.querySelectorAll('#svg-host .ev').length }));
    const same = normalize(mine.v1) === normalize(theirs.json);
    rows.push({ 악보: name, 파일: `${text.length}자`, 옛앱: theirs.version, 같은내용: same, 그려진음표: `${mine.ev}/${theirs.ev}` });
    if (!same || mine.ev !== theirs.ev) failed = true;
    await old.context().close();
  }
} finally { await browser.close(); }

console.table(rows);
for (const [label, list] of Object.entries(errors)) if (list.length) { failed = true; console.error(`${label} 앱의 페이지 오류:`, list); }
if (failed) { console.error('옛 앱이 v2 파일을 같게 열지 못했어요.'); process.exit(1); }
console.log('옛 앱(3.0.1)이 v2 파일을 모두 같은 내용으로 열었어요.');
