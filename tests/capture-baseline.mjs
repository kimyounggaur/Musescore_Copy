import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// --png-only: 화면 그림(PNG 4장)만 다시 만든다. 기준 JSON·MusicXML·MIDI와 ARCHITECTURE_NOTES·PERF·CONSOLE 메모는 쓰지 않는다.
//   (기둥 방향처럼 그림만 달라지는 변경 뒤에, 다른 기준 파일이 덮어써지지 않게 하려는 것. 옵션이 없으면 예전과 똑같이 전부 만든다.)
const pngOnly = process.argv.includes('--png-only');
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage(pageOptions({ viewport: { width: 1440, height: 1080 } }));
await preparePage(page);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
const baseUrl = process.env.SF_URL || 'http://127.0.0.1:8000';
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
await page.evaluate(() => SF.engrave.loadFont(() => {}));
await page.evaluate(() => document.fonts.ready);
const dir = 'tests/baseline';
await mkdir(dir, { recursive: true });
const timings = [];
for (const name of ['butterfly', 'star', 'airplane', 'rhythm', 'quartet64']) {
  if (pngOnly && name === 'quartet64') continue; // 그림이 없는 항목
  const data = await page.evaluate(name => {
    const s = name === 'quartet64' ? SF.core.createScore({ ensemble: 'string-quartet', measureCount: 64 }) : SF.io.DEMOS[name]();
    SF.core.setScore(s); SF.app.update({ noSave: true });
    const begin = performance.now();
    for (let i = 0; i < 20; i++) SF.engrave.render(s);
    return { json: SF.core.toJSON(s, { format: 1 }), xml: SF.io.exportMusicXML(s), midi: Array.from(SF.playback.exportMidi(s)), ms: performance.now() - begin };
  }, name);
  if (!pngOnly) await writeFile(`${dir}/${name}.scoreforge.json`, JSON.stringify(data.json, null, 2));
  if (name !== 'quartet64') {
    if (!pngOnly) {
      await writeFile(`${dir}/${name}.musicxml`, data.xml);
      await writeFile(`${dir}/${name}.mid`, new Uint8Array(data.midi));
    }
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
  timings.push(`| ${name} | ${data.ms.toFixed(1)} |`);
}
if (!pngOnly) {
const exports = await page.evaluate(() => Object.fromEntries(['core', 'engrave', 'playback', 'io', 'app'].map(k => [k, Object.keys(SF[k])])));
let notes = '# Baseline Architecture\n\nCommit: 20a188a\n\nStatic IIFEs: app -> engrave / playback / io -> core.\n\n';
for (const [k, keys] of Object.entries(exports)) notes += `## SF.${k}\n\n${keys.join(', ')}\n\n`;
const app = await readFile('js/app.js', 'utf8');
let func = '';
notes += '## Mutation / update callers\n\n';
for (const [i, line] of app.split('\n').entries()) {
  const m = line.match(/^  (?:async )?function (\w+)/); if (m) func = m[1];
  if (/C\.mutate\(|\bupdate\(/.test(line)) notes += `- app.js:${i + 1} ${func}: ${line.trim()}\n`;
}
notes += '\n## Data model fixture\n\nAll serialized fields are recorded in the five JSON fixtures. Optional decoration inventory is in the supplied design document and tested in core-v3.test.mjs.\n';
await writeFile(`${dir}/ARCHITECTURE_NOTES.md`, notes);
await writeFile(`${dir}/PERF.md`, '# Render Baseline\n\n20 renders, Edge headless, 1440x1080.\n\n| Score | Baseline ms |\n| --- | ---: |\n' + timings.join('\n') + '\n');
await writeFile(`${dir}/CONSOLE.md`, '# Browser Console\n\n' + (errors.length ? errors.join('\n') : 'No warnings or errors.') + '\n');
}
await page.goto(`${baseUrl}/tests/browser.html`);
await page.waitForFunction(() => window.__TEST_RESULT);
console.log(await page.evaluate(() => ({ ...window.__TEST_RESULT, text: document.querySelector('#results').textContent })));
console.log(timings.join('\n'));
await browser.close();
