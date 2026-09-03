import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
await page.goto(process.env.SF_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
await page.evaluate(() => SF.engrave.loadFont(() => {}));
await page.evaluate(() => document.fonts.ready);
const dir = 'tests/baseline';
await mkdir(dir, { recursive: true });
const timings = [];
for (const name of ['butterfly', 'star', 'airplane', 'rhythm', 'quartet64']) {
  const data = await page.evaluate(name => {
    const s = name === 'quartet64' ? SF.core.createScore({ ensemble: 'string-quartet', measureCount: 64 }) : SF.io.DEMOS[name]();
    SF.core.setScore(s); SF.app.update({ noSave: true });
    const begin = performance.now();
    for (let i = 0; i < 20; i++) SF.engrave.render(s);
    return { json: SF.core.toJSON(s), xml: SF.io.exportMusicXML(s), midi: Array.from(SF.playback.exportMidi(s)), ms: performance.now() - begin };
  }, name);
  await writeFile(`${dir}/${name}.scoreforge.json`, JSON.stringify(data.json, null, 2));
  if (name !== 'quartet64') {
    await writeFile(`${dir}/${name}.musicxml`, data.xml);
    await writeFile(`${dir}/${name}.mid`, new Uint8Array(data.midi));
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
  timings.push(`| ${name} | ${data.ms.toFixed(1)} |`);
}
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
await page.goto('http://127.0.0.1:8000/tests/browser.html');
await page.waitForFunction(() => window.__TEST_RESULT);
console.log(await page.evaluate(() => ({ ...window.__TEST_RESULT, text: document.querySelector('#results').textContent })));
console.log(timings.join('\n'));
await browser.close();
