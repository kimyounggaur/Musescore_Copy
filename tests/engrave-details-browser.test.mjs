// P9-2 조판 세부 — 실제 글꼴(Bravura)이 올라온 브라우저에서 getBBox로 겹침을 확인한다.
//  ① 덧줄 쪽 빔 묶음의 가까운 끝이 중앙줄에 닿는다 ② 2도 화음·임시표·점이 서로 겹치지 않는다
//  ③ 피아노·오르간 파트 이름이 묶음 괄호와 겹치지 않고 쪽 왼쪽 여백 안에 있다 ④ 오른손 4분 + 왼손 온음표의 간격이 같다
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/engrave-details-browser.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE && 'PLAYWRIGHT_MODULE이 없다';
let browser;

before(async () => {
  if (skip) return;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch(launchOptions());
});
after(async () => { await browser?.close(); });

async function open(t) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 900 } }));
  t.after(() => context.close());
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('scoreforge.welcomed', '1'); } catch (e) { /* 저장소가 막힌 경우 */ } });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return { page, errors };
}
const overlaps = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.6 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.6;

const CHORDS = [
  [[2, 1], [3, 1]], [[2, 1], [3, 1], [4, 1]], [[12, 1], [13, 1]], [[12, -1], [13, -1], [14, -1]], [[8, 1], [2, -1]], [[7, -1], [2, 1]],
  [[2, 1], [4, -1], [6, 0], [8, 1]], [[2, 0], [3, 1], [5, -1]], [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1]], [[1, -1], [2, -1], [3, 0], [8, 1]],
];
test('2도 화음·임시표·점: 실제 글꼴에서 임시표끼리·임시표와 머리·점과 머리가 겹치지 않는다', { skip }, async t => {
  const { page, errors } = await open(t);
  for (const dots of [0, 1]) {
    await page.evaluate(({ chords, dots }) => {
      const C = SF.core;
      const P = (a, alter = 0) => ({ step: ((a % 7) + 7) % 7, alter, oct: 4 + Math.floor(a / 7) });
      const score = C.createScore({ measureCount: chords.length });
      const ref = C.staffRefs(score)[0];
      chords.forEach((arr, i) => {
        const ev = { id: 'c' + i, type: 'note', notes: arr.map(([a, al]) => P(a, al)), dur: { n: 1, d: 4, dots }, voice: 1 };
        ref.measures[i].voices[0] = [ev]; ref.measures[i].events = [ev];
      });
      C.invalidate(score, { keepNormalized: true });
      C.setScore(score);
    }, { chords: CHORDS, dots });
    await page.waitForFunction(() => SF.engrave.isFontReady());
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const result = await page.evaluate(() => {
      // <text> 글자의 getBBox는 글꼴 줄 높이 전체라서, 캔버스 measureText의 실제 먹물 범위(ink)로 잰다.
      const ctx = document.createElement('canvas').getContext('2d');
      const ink = el => {
        const size = parseFloat(el.getAttribute('font-size')) || 40;
        ctx.font = `${size}px BravuraSF`;
        const m = ctx.measureText(el.textContent), x = +el.getAttribute('x'), y = +el.getAttribute('y');
        return { x: x - m.actualBoundingBoxLeft, y: y - m.actualBoundingBoxAscent, width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
      };
      const circle = el => ({ x: +el.getAttribute('cx') - 2.1, y: +el.getAttribute('cy') - 2.1, width: 4.2, height: 4.2 });
      const out = [];
      document.querySelectorAll('#svg-host [data-ref^="c"]').forEach(g => {
        out.push({
          id: g.getAttribute('data-ref'),
          acc: [...g.querySelectorAll('text.accidental, .accidental text')].map(ink),
          head: [...g.querySelectorAll('.nh text')].map(ink),
          dot: [...g.querySelectorAll('.dot')].map(circle),
        });
      });
      return out;
    });
    assert.equal(result.length, CHORDS.length, '화음이 모두 그려져야 한다');
    assert.ok(result.reduce((n, ev) => n + ev.acc.length, 0) >= 20, '임시표가 충분히 그려져야 시험이 의미 있다');
    assert.ok(result.every((ev, i) => ev.head.length === CHORDS[i].length && ev.dot.length === (dots ? CHORDS[i].length : 0)), '머리·점 개수');
    assert.ok(result.every(ev => [...ev.acc, ...ev.head].every(b => b.width > 1 && b.height > 1)), '글자 먹물 범위를 잘 쟀는지');
    for (const ev of result) {
      const items = [...ev.acc.map((b, i) => ({ k: 'acc' + i, b })), ...ev.head.map((b, i) => ({ k: 'head' + i, b })), ...ev.dot.map((b, i) => ({ k: 'dot' + i, b }))];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.k.startsWith('head') && b.k.startsWith('head')) continue;   // 2도 머리끼리는 붙어 있는 것이 정상
        assert.ok(!overlaps(a.b, b.b), `점 ${dots}개 ${ev.id}: ${a.k} × ${b.k} 겹침 ${JSON.stringify(a.b)} ${JSON.stringify(b.b)}`);
      }
    }
  }
  assert.deepEqual(errors, []);
});

test('피아노·오르간 파트 이름: 묶음 괄호와 겹치지 않고 쪽 왼쪽 여백 안에 있다', { skip }, async t => {
  const { page, errors } = await open(t);
  for (const ensemble of ['piano', 'flute-piano']) {
    await page.evaluate(ens => { SF.core.setScore(SF.core.createScore({ ensemble: ens, measureCount: 24 })); }, ensemble);
    await page.waitForFunction(() => SF.engrave.isFontReady());
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const geo = await page.evaluate(() => {
      const host = document.querySelector('#svg-host svg');
      const to = el => { const b = el.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      const names = [...host.querySelectorAll('.part-name')].map(el => ({ text: el.textContent, ...to(el) }));
      const braces = [...host.querySelectorAll('.brace')].map(to);
      return { names, braces, margin: SF.engrave.lastLayout ? SF.engrave.lastLayout().metrics.marginLeft : 52 };
    });
    assert.ok(geo.names.length >= 2, '이름이 둘 이상(줄마다)');
    for (const n of geo.names) {
      assert.ok(n.x >= geo.margin - 0.5, `${ensemble}: 이름 "${n.text}" 왼쪽 ${n.x} 이(가) 쪽 여백 ${geo.margin} 밖`);
      for (const b of geo.braces) if (Math.abs((b.y + b.height / 2) - (n.y + n.height / 2)) < b.height / 2 + 20 && n.y < b.y + b.height && n.y + n.height > b.y)
        assert.ok(n.x + n.width <= b.x + 0.5 || !overlaps(n, b), `${ensemble}: 이름 "${n.text}"(${JSON.stringify(n)}) 이(가) 괄호(${JSON.stringify(b)})와 겹침`);
    }
  }
  assert.deepEqual(errors, []);
});

test('덧줄 쪽 빔 묶음: 실제 화면에서 빔의 가까운 끝이 중앙줄에 닿는다', { skip }, async t => {
  const { page, errors } = await open(t);
  await page.evaluate(() => {
    const C = SF.core;
    const P = a => ({ step: ((a % 7) + 7) % 7, alter: 0, oct: 4 + Math.floor(a / 7) });
    const score = C.createScore({ measureCount: 2 });
    const ref = C.staffRefs(score)[0];
    const mk = (prefix, steps) => steps.map((a, i) => ({ id: prefix + i, type: 'note', notes: [P(a)], dur: { n: 1, d: 8, dots: 0 }, voice: 1 }));
    ref.measures[0].voices[0] = mk('lo', [-7, -6, -7, -6, -5, -6, -7, -6]); ref.measures[0].events = ref.measures[0].voices[0];
    ref.measures[1].voices[0] = mk('hi', [14, 15, 14, 15, 16, 15, 14, 15]); ref.measures[1].events = ref.measures[1].voices[0];
    C.invalidate(score, { keepNormalized: true });
    C.setScore(score);
  });
  await page.waitForFunction(() => SF.engrave.isFontReady());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const geo = await page.evaluate(() => {
    const host = document.querySelector('#svg-host svg');
    const lines = [...host.querySelectorAll('.staff line')].map(l => +l.getAttribute('y1'));
    const mid = lines.sort((a, b) => a - b)[2];
    const groups = [...host.querySelectorAll('.beam-group')].map(g => {
      const ys = [...g.querySelectorAll('.beam')].flatMap(p => p.getAttribute('points').split(' ').map(pt => +pt.split(',')[1]));
      return { top: Math.min(...ys), bottom: Math.max(...ys) };
    });
    return { mid, groups };
  });
  assert.ok(geo.groups.length >= 2, `빔 묶음 ${geo.groups.length}`);
  const [low, high] = geo.groups;
  assert.ok(low.top <= geo.mid + 0.5, `덧줄 아래 묶음 빔 위쪽 ${low.top} > 중앙줄 ${geo.mid}`);
  assert.ok(high.bottom >= geo.mid - 0.5, `덧줄 위 묶음 빔 아래쪽 ${high.bottom} < 중앙줄 ${geo.mid}`);
  assert.deepEqual(errors, []);
});

test('오른손 4분음표 + 왼손 온음표: 실제 화면에서도 오른손 간격이 모두 같다', { skip }, async t => {
  const { page, errors } = await open(t);
  await page.evaluate(() => {
    const C = SF.core;
    const P = a => ({ step: ((a % 7) + 7) % 7, alter: 0, oct: 4 + Math.floor(a / 7) });
    const score = C.createScore({ ensemble: 'piano', measureCount: 1 });
    const [rh, lh] = C.staffRefs(score);
    rh.measures[0].voices[0] = [0, 2, 4, 2].map((a, i) => ({ id: 'r' + i, type: 'note', notes: [P(a + 7)], dur: { n: 1, d: 4, dots: 0 }, voice: 1 }));
    rh.measures[0].events = rh.measures[0].voices[0];
    lh.measures[0].voices[0] = [{ id: 'lh', type: 'note', notes: [P(-7)], dur: { n: 1, d: 1, dots: 0 }, voice: 1 }];
    lh.measures[0].events = lh.measures[0].voices[0];
    C.invalidate(score, { keepNormalized: true });
    C.setScore(score);
  });
  await page.waitForFunction(() => SF.engrave.isFontReady());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const xs = await page.evaluate(() => [0, 1, 2, 3].map(i => { const b = document.querySelector(`#svg-host [data-ref="r${i}"] .nh`).getBBox(); return b.x + b.width / 2; }));
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.6, `간격 ${JSON.stringify(gaps)}`);
  assert.deepEqual(errors, []);
});
