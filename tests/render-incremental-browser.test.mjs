// P9-8: 실제 앱에서 증분 조판 + 시스템 단위 DOM 교체가 "전체를 새로 그린 화면"과 같은지 확인한다.
//  - 편집 50스텝(입력·쉼표·붙임줄·조표·마디 추가/삭제·셈여림·제목·되돌리기/다시하기)을 앱 경로(doInput·mutate·undo)로 적용하고,
//    매 스텝 화면(#svg-host)의 DOM이 "같은 악보를 캐시 없이 처음 그려 파싱한 DOM"과 같은지 비교한다(선택·재생 표시용 클래스·덮개는 제외).
//  - 입력 편집은 줄 대부분을 그대로 두어야 한다(DOM 노드가 교체되지 않음) — 항상 통째로 갈아끼우면 위 비교는 공짜로 통과하기 때문이다.
//  - 덮개(ghost·cursor·speedy)와 재생선은 부분 교체에서 건드리지 않는다.
//  - 바깥에서 DOM을 망가뜨려도(외부 코드가 #svg-host를 비움) 다음 그리기가 전체로 복구한다. 쪽 나누기 보기는 예전처럼 통째로 그린다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/render-incremental-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

async function openApp(browser) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 } }));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  return { page, pageErrors };
}

// 페이지 안에서 쓰는 도구를 한 번 심는다.
const INSTALL = () => {
  const C = SF.core, E = SF.engrave, F = SF.F;
  const original = E.render;
  const tool = { lastOpts: null, original };
  E.render = (score, opts) => {
    const res = original(score, opts);
    if (opts && opts.cache === true && !opts.export) { tool.lastOpts = opts; tool.lastParts = res.parts; }
    return res;
  };
  // 조각 구성(시스템 s / 꼬리 t의 순서) — 줄이 쪽 경계를 넘으면 길이는 같아도 구성이 달라진다
  tool.shape = () => (tool.lastParts ? tool.lastParts.segments.map(seg => seg.type[0]).join('') : '');
  tool.settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  tool.fill = (count) => {
    C.setScore(C.createScore({ ensemble: 'piano', measureCount: count }));
    C.mutate('fill', score => {
      for (const ref of C.staffRefs(score)) for (let m = 0; m < count; m++) for (let i = 0; i < 8; i++)
        C.inputAt(score, m, F(i, 8), { n: 1, d: 8, dots: 0 }, [{ step: (i + m) % 7, alter: 0, oct: ref.staffIdx ? 3 : 4 }], { partIdx: ref.partIdx, staffIdx: ref.staffIdx, voice: 1 });
    });
    SF.app.update({ immediate: true, force: true });
  };
  // 화면 DOM을 비교용으로 정리한다: 덮개·재생선·선택/재생 표시 클래스·루트의 접근성 속성은 뺀다.
  const clean = root => {
    root.querySelectorAll('[id^="overlay-"],[class*="overlay-"],.play-cursor,#play-cursor').forEach(el => el.remove());
    root.querySelectorAll('.sel,.sel-note,.playing').forEach(el => el.classList.remove('sel', 'sel-note', 'playing'));
    root.querySelectorAll('[class=""]').forEach(el => el.removeAttribute('class'));
    root.querySelectorAll('svg').forEach(svg => { svg.removeAttribute('aria-label'); svg.removeAttribute('role'); });
    return root;
  };
  tool.liveHtml = () => clean(document.querySelector('#svg-host').cloneNode(true)).innerHTML;
  tool.freshHtml = () => {
    const score = JSON.parse(JSON.stringify(C.state.score));
    const out = original(score, { ...tool.lastOpts, cache: false, preserveLayout: true });
    const box = document.createElement('div');
    box.innerHTML = out.svg;
    return clean(box).innerHTML;
  };
  tool.firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return { at: i, live: a.slice(Math.max(0, i - 90), i + 120), fresh: b.slice(Math.max(0, i - 90), i + 120) }; };
  tool.tag = tag => { document.querySelectorAll('#svg-host g.system').forEach(el => { el.__tag = tag; }); const o = document.getElementById('overlay-ghost'); if (o) o.__tag = tag; };
  tool.kept = tag => ({
    systems: [...document.querySelectorAll('#svg-host g.system')].filter(el => el.__tag === tag).length,
    total: document.querySelectorAll('#svg-host g.system').length,
    overlay: document.getElementById('overlay-ghost')?.__tag === tag,
  });
  window.__inc = tool;
};

test('P9-8 앱에서 편집 50스텝마다 부분 교체된 화면 === 전체를 새로 그린 화면, 입력은 대부분의 줄을 그대로 둔다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 240000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    await page.evaluate(INSTALL);
    await page.evaluate(() => __inc.fill(40));
    await page.evaluate(() => __inc.settle());
    const report = await page.evaluate(async seed => {
      const C = SF.core, F = SF.F, T = __inc;
      let a = seed >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const pick = n => Math.floor(rnd() * n);
      const count = () => C.staffRefs(C.state.score)[0].measures.length;
      const eighth = { n: 1, d: 8, dots: 0 };
      const steps = [
        ['input', () => { SF.app.ui.curDur = { ...eighth }; SF.app.actions.doInput(pick(count()), F(pick(8), 8), [{ step: 2 + pick(5), alter: pick(3) - 1, oct: 4 }]); }, true],
        ['input', () => { SF.app.ui.curDur = { ...eighth }; SF.app.actions.doInput(pick(count()), F(pick(8), 8), [{ step: pick(4), alter: 0, oct: 5 }]); }, true],
        ['input', () => { SF.app.ui.curDur = { ...eighth }; SF.app.actions.doInput(pick(count()), F(pick(8), 8), [{ step: 2 + pick(5), alter: 0, oct: 4 }, { step: 4, alter: 0, oct: 5 }]); }, true],
        ['rest', () => { SF.app.ui.curDur = { ...eighth }; SF.app.actions.doInput(pick(count()), F(pick(8), 8), null); }, true],
        ['cross', () => { SF.app.ui.curDur = { n: 1, d: 2, dots: 0 }; SF.app.actions.doInput(pick(count() - 1), F(6, 8), [{ step: 3, alter: 0, oct: 4 }]); SF.app.ui.curDur = { ...eighth }; }, true],
        ['key', () => C.mutate('조표', s => C.setMeasureKeySig(s, pick(count()), pick(5) - 2)), false],
        ['insert', () => C.mutate('마디 삽입', s => C.insertMeasures(s, pick(count()), 1)), false],
        ['delete', () => { if (count() > 30) C.mutate('마디 삭제', s => { const at = pick(count()); C.deleteMeasures(s, at, at); }); }, false],
        ['dynamic', () => C.mutate('셈여림', s => { const list = C.staffRefs(s)[0].measures.flatMap(mm => mm.voices[0]).filter(ev => ev.type === 'note'); list[pick(list.length)].dynamic = ['p', 'f'][pick(2)]; }), false],
        ['title', () => C.mutate('제목', s => { s.meta.title = `제목 ${pick(100)}`; }), false],
        ['undo', () => { C.undo(); }, false],
        ['redo', () => { C.redo(); }, false],
      ];
      const out = [];
      for (let step = 1; step <= 50; step++) {
        const [kind, run, isInput] = steps[step <= 22 ? pick(5) : pick(steps.length)]; // 앞 22스텝은 입력 위주, 뒤는 전체 섞기
        T.tag(step);
        const before = { ...SF.engrave.__stats };
        try { run(); } catch (error) { out.push({ step, kind, error: String(error.message || error) }); continue; }
        SF.app.update({ immediate: true });
        await T.settle();
        const live = T.liveHtml(), fresh = T.freshHtml();
        const kept = T.kept(step);
        out.push({ step, kind, isInput, equal: live === fresh, diff: live === fresh ? null : T.firstDiff(live, fresh), kept, reused: SF.engrave.__stats.systemsReused - before.systemsReused });
      }
      return out;
    }, 20260125);
    const errors = report.filter(r => r.error);
    assert.deepEqual(errors, [], '편집이 예외 없이 끝나야 한다');
    const bad = report.filter(r => !r.equal);
    assert.deepEqual(bad.map(r => ({ step: r.step, kind: r.kind, diff: r.diff })), [], '모든 스텝에서 부분 교체된 화면이 전체 렌더와 같아야 한다');
    const inputs = report.filter(r => r.isInput);
    assert.ok(inputs.length >= 15, `입력 스텝이 충분해야 한다(${inputs.length})`);
    const mostlyKept = inputs.filter(r => r.kept.systems >= r.kept.total - 5);
    assert.ok(mostlyKept.length >= Math.floor(inputs.length * 0.6), `입력 편집의 60% 이상은 줄 대부분을 그대로 둔다(${mostlyKept.length}/${inputs.length}): ${JSON.stringify(inputs.map(r => [r.kept.systems, r.kept.total]))}`);
    // 입력 편집(doInput)이 {local:true}로 mutate를 불러야 조판기가 이전 줄 그림을 재사용한다(DOM 노드 보존과는 별개의 증거)
    const reusedSteps = inputs.filter(r => r.reused > 0);
    assert.ok(reusedSteps.length >= Math.floor(inputs.length * 0.6), `입력 편집의 60% 이상은 조판기가 줄 그림을 재사용한다(${reusedSteps.length}/${inputs.length}): ${JSON.stringify(inputs.map(r => r.reused))}`);
    const overlayKept = inputs.filter(r => r.kept.overlay);
    assert.ok(overlayKept.length >= Math.floor(inputs.length * 0.8), `입력 편집에서 덮개 노드는 교체되지 않는다(${overlayKept.length}/${inputs.length})`);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('P9-8 바깥에서 #svg-host를 비워도 다음 그리기가 전체로 복구하고, 쪽 나누기 보기는 통째로 그린다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    await page.evaluate(INSTALL);
    await page.evaluate(() => __inc.fill(24));
    await page.evaluate(() => __inc.settle());
    const result = await page.evaluate(async () => {
      const T = __inc, F = SF.F, out = {};
      const edit = m => { SF.app.ui.curDur = { n: 1, d: 8, dots: 0 }; SF.app.actions.doInput(m, F(1, 8), [{ step: 3, alter: 0, oct: 4 }]); SF.app.update({ immediate: true }); };
      // 1) 외부 코드가 비움
      document.querySelector('#svg-host').innerHTML = '';
      edit(5); await T.settle();
      out.afterWipe = { equal: T.liveHtml() === T.freshHtml(), svgs: document.querySelectorAll('#svg-host > svg').length };
      // 2) 외부 코드가 시스템 노드 하나를 지움
      document.querySelector('#svg-host g.system[data-system="1"]').remove();
      edit(9); await T.settle();
      out.afterRemove = { equal: T.liveHtml() === T.freshHtml(), systems: document.querySelectorAll('#svg-host g.system').length };
      // 3) 쪽 나누기 보기
      SF.app.ui.pageMode = 'pages'; SF.app.update({ immediate: true, force: true }); await T.settle();
      edit(3); await T.settle();
      out.pages = { equal: T.liveHtml() === T.freshHtml(), pageSvgs: document.querySelectorAll('#svg-host > svg.page').length };
      // 4) 연속 보기로 돌아옴
      SF.app.ui.pageMode = 'continuous'; SF.app.update({ immediate: true, force: true }); await T.settle();
      T.tag('back'); edit(7); await T.settle();
      out.back = { equal: T.liveHtml() === T.freshHtml(), kept: T.kept('back') };
      return out;
    });
    assert.equal(result.afterWipe.equal, true, '비운 뒤 복구');
    assert.equal(result.afterWipe.svgs, 1);
    assert.equal(result.afterRemove.equal, true, '시스템 노드가 사라진 뒤 복구');
    assert.equal(result.pages.equal, true, '쪽 나누기 보기');
    assert.ok(result.pages.pageSvgs >= 1);
    assert.equal(result.back.equal, true, '연속 보기로 돌아온 뒤');
    assert.ok(result.back.kept.systems >= result.back.kept.total - 5, `돌아온 뒤 첫 편집부터 부분 교체: ${JSON.stringify(result.back.kept)}`);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('P9-8 접근성 이름 보정(ui-v3 refresh)은 이름 없는 아이콘 버튼·입력에만 aria-label을 붙인다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    const got = await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<button id="zz-icon" title="아이콘 제목"></button><button id="zz-text" title="무시">글자 있음</button>' +
        '<button id="zz-aria" aria-label="이미 있음" title="다른 제목"></button><input id="zz-labeled" placeholder="자리표시"><label for="zz-labeled">라벨</label>' +
        '<input id="zz-ph" placeholder="자리 표시자"><button id="zz-lb" aria-labelledby="zz-text" title="x"></button><select id="zz-sel"></select>';
      document.body.append(box);
      SF.uiV3.refresh();
      const read = id => document.getElementById(id).getAttribute('aria-label');
      return Object.fromEntries(['zz-icon', 'zz-text', 'zz-aria', 'zz-labeled', 'zz-ph', 'zz-lb', 'zz-sel'].map(id => [id, read(id)]));
    });
    assert.deepEqual(got, { 'zz-icon': '아이콘 제목', 'zz-text': null, 'zz-aria': '이미 있음', 'zz-labeled': null, 'zz-ph': '자리 표시자', 'zz-lb': null, 'zz-sel': 'zz-sel' });
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});


test('P9-8 줄이 다음 쪽으로 넘어가 조각 구성(시스템·꼬리 순서)이 달라져도 화면은 전체 렌더와 같다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    await page.evaluate(INSTALL);
    await page.evaluate(() => __inc.fill(22));      // 연속 보기에서 쪽 4·4·3줄
    // 모든 마디 맨 앞의 두 8분음표를 같은 음으로 만들어 붙임줄을 건다 → 쪽마다 꼬리(붙임줄 그림)가 비어 있지 않아, 꼬리가 엉뚱한 자리에 남으면 화면이 달라진다
    await page.evaluate(() => {
      const C = SF.core, F = SF.F, eighth = { n: 1, d: 8, dots: 0 };
      C.mutate('붙임줄', s => {
        for (let m = 0; m < 22; m++) {
          for (const tick of [0, 1]) C.inputAt(s, m, F(tick, 8), eighth, [{ step: 2, alter: 0, oct: 4 }], { partIdx: 0, staffIdx: 0, voice: 1 });
          C.staffRefs(s)[0].measures[m].voices[0][0].notes[0].tie = true;
        }
        C.normalizeTies(s);
      });
      SF.app.update({ immediate: true, force: true });
    });
    await page.evaluate(() => __inc.settle());
    const result = await page.evaluate(async () => {
      const C = SF.core, F = SF.F, T = __inc, eighth = { n: 1, d: 8, dots: 0 };
      const tails = T.lastParts.segments.filter(seg => seg.type === 'tail' && seg.svg.length > 0).length;
      const before = T.shape();
      T.tag('shift');
      // 2번 마디의 윗보표에 아주 높은 음, 아랫보표에 아주 낮은 음 → 그 줄이 커져 쪽 끝 줄이 다음 쪽으로 밀리고, 마지막 쪽은 줄 수가 하나 는다(쪽 수는 그대로)
      C.mutate('높낮이 입력', s => {
        C.inputAt(s, 2, F(3, 8), eighth, [{ step: 3, alter: 0, oct: 7 }], { partIdx: 0, staffIdx: 0, voice: 1 });
        C.inputAt(s, 2, F(5, 8), eighth, [{ step: 0, alter: 0, oct: 0 }], { partIdx: 0, staffIdx: 1, voice: 1 });
      }, { local: true });
      SF.app.update({ immediate: true });
      await T.settle();
      return { tails, before, after: T.shape(), equal: T.liveHtml() === T.freshHtml(), diff: T.liveHtml() === T.freshHtml() ? null : T.firstDiff(T.liveHtml(), T.freshHtml()), kept: T.kept('shift') };
    });
    assert.ok(result.tails >= 3, `쪽마다 꼬리에 붙임줄 그림이 있다(이 시험의 전제): ${result.tails}`);
    assert.equal(result.before.length, result.after.length, `조각 수는 그대로(${result.before} → ${result.after})`);
    assert.notEqual(result.before, result.after, `조각 구성이 달라졌다(이 시험의 전제): ${result.before} → ${result.after}`);
    assert.equal(result.equal, true, JSON.stringify(result.diff));
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('P9-8 부분 교체 도중 예외가 나면 통째로 다시 그려 복구한다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);
    await page.evaluate(INSTALL);
    await page.evaluate(() => __inc.fill(24));
    await page.evaluate(() => __inc.settle());
    const result = await page.evaluate(async () => {
      const T = __inc, F = SF.F, original = Element.prototype.replaceWith;
      let thrown = 0;
      // 시스템 노드를 바꾸는 순간 한 번 실패하게 한다(바깥 코드나 브라우저가 DOM 조작을 막는 경우의 모사)
      Element.prototype.replaceWith = function (...nodes) {
        if (thrown === 0 && this.matches && this.matches('g.system')) { thrown++; throw new Error('주입한 실패'); }
        return original.apply(this, nodes);
      };
      try {
        SF.app.ui.curDur = { n: 1, d: 8, dots: 0 };
        SF.app.actions.doInput(5, F(1, 8), [{ step: 3, alter: 0, oct: 4 }]);
        SF.app.update({ immediate: true });
        await T.settle();
      } finally { Element.prototype.replaceWith = original; }
      const first = { thrown, equal: T.liveHtml() === T.freshHtml(), svgs: document.querySelectorAll('#svg-host > svg').length };
      // 실패한 뒤에도 다음 편집은 정상으로 부분 교체한다
      T.tag('after-fail');
      SF.app.actions.doInput(9, F(2, 8), [{ step: 4, alter: 0, oct: 4 }]);
      SF.app.update({ immediate: true });
      await T.settle();
      return { first, second: { equal: T.liveHtml() === T.freshHtml(), kept: T.kept('after-fail') } };
    });
    assert.equal(result.first.thrown, 1, '실패 주입이 실제로 일어났다(이 시험의 전제)');
    assert.equal(result.first.equal, true, '도중에 실패해도 화면은 전체 렌더와 같다');
    assert.equal(result.first.svgs, 1);
    assert.equal(result.second.equal, true);
    assert.ok(result.second.kept.systems >= result.second.kept.total - 5, `실패한 뒤 다음 편집은 다시 부분 교체: ${JSON.stringify(result.second.kept)}`);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
