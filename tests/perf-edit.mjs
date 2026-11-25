// 부록 D-1: 피아노 2단 100마디(8분음표 1,600개)에서 음표 입력 1회의 지연(입력 + 즉시 갱신)
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage(pageOptions({ viewport: { width: 1440, height: 1080 } }));
await preparePage(page);
await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
await page.goto(process.env.SF_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
const result = await page.evaluate(async () => {
  const C = SF.core, settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  C.setScore(C.createScore({ ensemble: 'piano', measureCount: 100 }));
  C.mutate('perf fill', score => {
    for (const ref of C.staffRefs(score)) for (let m = 0; m < 100; m++) for (let i = 0; i < 8; i++)
      C.inputAt(score, m, SF.F(i, 8), { n: 1, d: 8, dots: 0 }, [{ step: i % 7, alter: 0, oct: ref.staffIdx ? 3 : 4 }],
        { partIdx: ref.partIdx, staffIdx: ref.staffIdx, voice: 1 });
  });
  SF.app.update({ immediate: true }); await settle();
  const times = [];
  for (let k = 0; k < 10; k++) {
    const t0 = performance.now();
    SF.app.actions.doInput(40 + k, SF.F(0), [{ step: k % 7, alter: 0, oct: 5 }]);
    SF.app.update({ immediate: true });
    times.push(performance.now() - t0);
    await settle();
  }
  times.sort((a, b) => a - b);
  return { notes: 1600, medianMs: Math.round((times[4] + times[5]) / 2), maxMs: Math.round(times[9]) };
});
console.log(JSON.stringify(result));
await browser.close();
