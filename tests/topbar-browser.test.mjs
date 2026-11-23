// P6-3: 상단바 정리 — 좁은 화면에서 상단바가 스크롤 상자가 되거나 여러 줄로 늘어나지 않게 한다.
//  - 900px 이하: .topbar에 max-height·overflow가 없다. 줄바꿈으로 모든 컨트롤이 보인다(안쪽 스크롤 없음).
//  - 500px 이하: 자주 안 쓰는 컨트롤(테마·언어·빠르기·보기·악기·건반·MIDI·도움말 …)이 "⋯ 더보기" 메뉴 안으로 옮겨 간다.
//    노드째 옮기므로 이벤트 연결과 나중에 붙는 항목(재생 옵션·보기 옵션)이 그대로이고, 넓어지면 원래 자리로 돌아온다.
//  - 375px 상단바 높이는 화면 높이의 20% 이하, 가로 스크롤 없음.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/topbar-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;

// 좁은 화면에서도 상단바에 남는 핵심 컨트롤 / "⋯ 더보기" 안으로 옮겨 가는 컨트롤(동적으로 붙는 것 포함)
const KEEP = ['btn-account', 'btn-file', 'btn-settings', 'btn-more', 'btn-undo', 'btn-redo', 'btn-rewind', 'btn-play', 'btn-stop', 'btn-metronome', 'btn-props'];
const MOVED = ['theme-select', 'language-select', 'tempo-input', 'playback-rate', 'count-in', 'btn-loop', 'swing-select', 'btn-mixer', 'staff-select', 'view-select',
  'page-mode', 'multi-rest', 'btn-hide-empty', 'btn-navigator', 'btn-timeline', 'instrument-select', 'btn-piano', 'btn-midi', 'midi-select', 'btn-shortcuts', 'btn-help'];

async function withPage(size, fn, { fallback = false } = {}) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: size }));
    const page = await context.newPage();
    await preparePage(page);
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    if (fallback) await page.addInitScript(() => { delete HTMLElement.prototype.popover; delete HTMLElement.prototype.showPopover; });
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());
    await fn(page);
    assert.deepEqual(pageErrors, [], '페이지 오류 없음');
  } finally {
    await browser.close();
  }
}

const isOpen = (page, id) => page.evaluate(sel => {
  const menu = document.querySelector(sel);
  return menu.hasAttribute('popover') ? menu.matches(':popover-open') : menu.classList.contains('open');
}, '#' + id);
// 그 컨트롤 한가운데를 실제로 누를 수 있는가(그 자리의 최상위 요소가 그 컨트롤이거나 그 안쪽인가)
const clickable = (page, id) => page.evaluate(i => {
  const el = document.getElementById(i), r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, id);
// 더보기 메뉴를 그 컨트롤이 보이는 자리까지 스크롤(메뉴만)한 뒤 눌러 볼 수 있는지
const revealed = (page, id) => page.evaluate(i => {
  const menu = document.querySelector('#more-menu'), el = document.getElementById(i);
  const m = menu.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.bottom > m.bottom) menu.scrollTop += r.bottom - m.bottom + 4;
  else if (r.top < m.top) menu.scrollTop -= m.top - r.top + 4;
  const r2 = el.getBoundingClientRect();
  if (!r2.width || !r2.height) return false;
  const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, id);
const barInfo = page => page.evaluate(() => {
  const bar = document.querySelector('.topbar'), cs = getComputedStyle(bar), r = bar.getBoundingClientRect();
  return { height: Math.round(r.height), bottom: Math.round(r.bottom), scrollH: bar.scrollHeight, clientH: bar.clientHeight, overflowY: cs.overflowY, maxHeight: cs.maxHeight,
    docW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight };
});
// 상단바 컨트롤의 자리(id → 좌표). 넓은 화면의 배치가 오간 뒤에도 같은지 비교하는 데 쓴다.
const rects = page => page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('.topbar [id], .topbar .brand, .topbar .tspacer')) {
    const r = el.getBoundingClientRect();
    out[el.id || el.className] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  }
  return out;
});
const homes = page => page.evaluate(() => {
  const bar = document.querySelector('.topbar');
  return {
    groups: [...bar.children].filter(el => el.classList.contains('more-group')).length,
    moreMenuChildren: document.querySelector('#more-menu').children.length,
    viewOptionsAfterViewSelect: document.querySelector('#view-select').nextElementSibling === document.querySelector('.view-options'),
    transportInTempoBox: document.querySelector('#tempo-input').nextElementSibling === document.querySelector('.transport-options'),
    inBar: ['theme-select', 'btn-help', 'tempo-input', 'page-mode', 'btn-loop'].every(id => !!document.getElementById(id).closest('.topbar') && !document.getElementById(id).closest('#more-menu'))
  };
});

test('P6-3 375×667: 상단바 높이가 화면 높이의 20% 이하이고, 안쪽 스크롤도 가로 스크롤도 없다', { skip, timeout: 120000 }, async () => {
  for (const [width, height] of [[375, 667], [360, 640], [375, 812], [414, 896], [500, 740]]) {
    await withPage({ width, height }, async page => {
      const info = await barInfo(page);
      const limit = Math.floor(height * 0.2);
      assert.ok(info.height <= limit, `${width}×${height}: 상단바 높이 ${info.height}px ≤ ${limit}px(화면의 20%)`);
      assert.ok(info.scrollH <= info.clientH + 1, `${width}×${height}: 상단바 안쪽에서 스크롤할 내용이 없다(${info.scrollH} > ${info.clientH})`);
      assert.equal(info.overflowY, 'visible', 'overflow-y가 스크롤 상자가 아니다');
      assert.equal(info.maxHeight, 'none', 'max-height가 없다');
      assert.ok(info.docW <= info.innerW, `${width}×${height}: 가로 스크롤 없음(${info.docW} ≤ ${info.innerW})`);
    });
  }
});

test('P6-3 375px: 핵심 컨트롤은 상단바에서 바로 누를 수 있고, 나머지는 닫힌 ⋯ 더보기 안에 있다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    const bottom = (await barInfo(page)).bottom;
    for (const id of KEEP) {
      assert.equal(await clickable(page, id), true, `${id}: 상단바에서 바로 누를 수 있다`);
      assert.ok(await page.evaluate(i => document.getElementById(i).getBoundingClientRect().bottom, id) <= bottom + 1, `${id}: 상단바 안쪽`);
    }
    for (const id of MOVED) {
      assert.equal(await page.evaluate(i => !!document.getElementById(i).closest('#more-menu'), id), true, `${id}: 더보기 메뉴 안으로 옮겨져 있다`);
      assert.equal(await page.isVisible('#' + id), false, `${id}: 메뉴가 닫혀 있는 동안은 보이지 않는다`);
    }
    // 두 줄: 첫 줄은 앱 메뉴(로고·계정·파일·설정)와 오른쪽 끝의 ⋯, 둘째 줄은 되돌리기·재생·속성
    const box = id => page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, id);
    const [file, more, undo, props, settings] = await Promise.all(['btn-file', 'btn-more', 'btn-undo', 'btn-props', 'btn-settings'].map(box));
    assert.ok(more.right >= 375 - 12, `⋯은 첫 줄 오른쪽 끝(right=${more.right})`);
    assert.ok(Math.abs(more.top - file.top) < 4 && Math.abs(settings.top - file.top) < 4, '파일·설정·⋯은 같은 첫 줄');
    assert.ok(undo.top >= file.bottom - 1, `되돌리기는 둘째 줄(top=${undo.top} ≥ 첫 줄 아래 ${file.bottom})`);
    assert.ok(Math.abs(props.top - undo.top) < 4, '속성은 되돌리기와 같은 둘째 줄');
    assert.equal(await page.getAttribute('#btn-more', 'aria-expanded'), 'false');
    assert.equal(await page.getAttribute('#btn-more', 'aria-label'), '더보기');
    assert.equal(await page.getAttribute('#btn-more', 'aria-haspopup'), null, '더보기는 role=menu가 아니라 컨트롤 꾸러미(disclosure)다');
  });
});

test('P6-3 375px: ⋯을 누르면 메뉴가 화면 안에 열리고 모든 컨트롤을 눌러 볼 수 있다', { skip, timeout: 120000 }, async () => {
  for (const [width, height] of [[375, 667], [360, 640]]) {
    await withPage({ width, height }, async page => {
      await page.click('#btn-more');
      await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));
      assert.equal(await page.getAttribute('#btn-more', 'aria-expanded'), 'true');
      const box = await page.evaluate(() => { const r = document.querySelector('#more-menu').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
      assert.ok(box.l >= 0 && box.r <= box.w && box.t >= 0 && box.b <= box.h, `${width}×${height}: 메뉴가 화면 안(${JSON.stringify(box)})`);
      const fit = await page.evaluate(() => { const m = document.querySelector('#more-menu'); return { sw: m.scrollWidth, cw: m.clientWidth, sh: m.scrollHeight, ch: m.clientHeight }; });
      assert.ok(fit.sw <= fit.cw, `${width}×${height}: 메뉴 안에서 가로로 넘치지 않는다(${fit.sw} ≤ ${fit.cw})`);
      assert.ok(fit.sh <= fit.ch + 1, `${width}×${height}: 줄바꿈으로 한 화면에 들어온다 — 메뉴 안쪽 스크롤 없음(${fit.sh} ≤ ${fit.ch})`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#btn-piano .lbl')).display !== 'none'), true, '건반 단추의 글자가 보인다(좁은 화면의 아이콘 전용 규칙을 메뉴 안에서는 풀었다)');
      for (const id of MOVED) assert.equal(await revealed(page, id), true, `${width}×${height}: ${id}를 눌러 볼 수 있다`);
      assert.ok((await barInfo(page)).docW <= width, '메뉴를 열어도 가로 스크롤 없음');
    });
  }
});

test('P6-3 더보기 안 컨트롤이 실제로 동작한다: 테마·언어(선택해도 메뉴는 열린 채)·빠르기·도움말·믹서', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    await page.click('#btn-more');
    await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));

    await page.selectOption('#theme-select', 'light');
    assert.equal(await page.evaluate(() => document.body.dataset.theme), 'light', '테마가 바뀐다');
    assert.equal(await isOpen(page, 'more-menu'), true, '선택 컨트롤을 만져도 메뉴는 열려 있다');

    await page.selectOption('#language-select', 'en');
    await page.waitForFunction(() => SF.i18n.getLanguage() === 'en');
    assert.equal(await page.getAttribute('#btn-more', 'aria-label'), 'More', '더보기 버튼 이름도 번역된다');
    assert.equal(await isOpen(page, 'more-menu'), true);
    await page.selectOption('#language-select', 'ko');
    await page.waitForFunction(() => SF.i18n.getLanguage() === 'ko');

    await page.fill('#tempo-input', '132');
    await page.press('#tempo-input', 'Enter');
    assert.equal(await page.evaluate(() => SF.core.state.score.tempo), 132, '빠르기 입력이 악보에 들어간다');
    assert.equal(await isOpen(page, 'more-menu'), true, '숫자 칸을 만져도 메뉴는 열려 있다');

    await page.click('#count-in');
    assert.equal(await page.evaluate(() => SF.app.ui.countIn), true, '예비박 체크가 동작한다(label을 눌러도 메뉴가 닫히지 않는다)');
    assert.equal(await isOpen(page, 'more-menu'), true);

    await page.click('#btn-help');
    await page.waitForFunction(() => document.querySelector('#dlg-help').open);
    assert.equal(await isOpen(page, 'more-menu'), false, '버튼을 누르면 메뉴가 닫힌다');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-help').open);

    await page.click('#btn-more');
    await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));
    await page.click('#btn-mixer');
    await page.waitForFunction(() => document.querySelector('#dlg-mixer').open);
    assert.equal(await isOpen(page, 'more-menu'), false);
  });
});

test('P6-3 키보드: Enter로 열면 첫 컨트롤에 포커스, 선택 칸에서 ↓는 값을 바꾸고(메뉴 이동으로 가로채지 않는다), Esc로 닫으면 ⋯으로 돌아온다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    const active = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.focus('#btn-more');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));
    await page.waitForFunction(() => document.activeElement?.id === 'theme-select');
    assert.equal(await active(), 'theme-select', '열면 첫 컨트롤(테마 선택)에 포커스');
    const before = await page.evaluate(() => document.querySelector('#theme-select').value);
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), 'theme-select', '↓는 선택 칸이 가져간다 — 다른 컨트롤로 포커스가 튀지 않는다');
    assert.notEqual(await page.evaluate(() => document.querySelector('#theme-select').value), before, '선택 칸의 값이 바뀐다');
    await page.keyboard.press('End');
    assert.equal(await active(), 'theme-select', 'End도 선택 칸이 가져간다(마지막 항목으로)');
    assert.equal(await page.evaluate(() => document.querySelector('#theme-select').value), 'cute');
    await page.focus('#tempo-input');
    const tempo = await page.evaluate(() => +document.querySelector('#tempo-input').value);
    await page.keyboard.press('ArrowUp');
    assert.equal(await active(), 'tempo-input', '↑는 숫자 칸이 가져간다');
    assert.equal(await page.evaluate(() => +document.querySelector('#tempo-input').value), tempo + 1, '숫자가 1 올라간다');
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(page, 'more-menu'), false);
    assert.equal(await active(), 'btn-more', '포커스가 ⋯으로 돌아온다');
    // 버튼에서 ↑로 열면 마지막 컨트롤로 간다
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));
    await page.waitForFunction(() => document.activeElement?.id === 'btn-help');
    assert.equal(await active(), 'btn-help');
  });
});

test('P6-3 크기를 오가기: 1200 → 375 → 1200에서 컨트롤이 제자리로 돌아오고(자리까지 같다), 동적으로 붙는 항목도 따라간다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 1200, height: 800 }, async page => {
    const baseline = await rects(page);
    assert.deepEqual(await homes(page), { groups: 3, moreMenuChildren: 0, viewOptionsAfterViewSelect: true, transportInTempoBox: true, inBar: true });
    assert.equal(await page.isVisible('#btn-more'), false, '넓은 화면에서는 ⋯이 보이지 않는다');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.more-group')).display), 'contents');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForFunction(() => document.querySelector('#more-menu').children.length === 3);
    assert.equal((await homes(page)).groups, 0, '묶음 3개가 모두 더보기 메뉴로 옮겨 갔다');
    assert.equal(await page.evaluate(() => document.querySelector('#view-select').nextElementSibling === document.querySelector('.view-options')), true, '보기 옵션은 묶음 안에서 같이 간다');

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForFunction(() => document.querySelector('#more-menu').children.length === 0);
    assert.deepEqual(await homes(page), { groups: 3, moreMenuChildren: 0, viewOptionsAfterViewSelect: true, transportInTempoBox: true, inBar: true });
    assert.deepEqual(await rects(page), baseline, '넓은 화면의 배치가 오가기 전과 같다');
    // 되돌아온 컨트롤의 이벤트 연결도 살아 있다
    await page.selectOption('#theme-select', 'pretty');
    assert.equal(await page.evaluate(() => document.body.dataset.theme), 'pretty');
  });
});

test('P6-3 좁게 시작해서 넓히기: 375에서 시작해 1200으로 넓혀도 넓게 시작한 것과 배치가 같다', { skip, timeout: 120000 }, async () => {
  let reference;
  await withPage({ width: 1200, height: 800 }, async page => { reference = await rects(page); });
  await withPage({ width: 375, height: 667 }, async page => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForFunction(() => document.querySelector('#more-menu').children.length === 0);
    assert.deepEqual(await rects(page), reference);
  });
});

test('P6-3 열린 채 넓히기: 메뉴가 열린 상태에서 창이 넓어지면 메뉴가 닫히고 컨트롤은 제자리로 돌아간다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    await page.click('#btn-more');
    await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForFunction(() => document.querySelector('#more-menu').children.length === 0);
    assert.equal(await isOpen(page, 'more-menu'), false);
    assert.equal((await homes(page)).inBar, true);
  });
});

test('P6-3 501~900px: 상단바는 스크롤 상자가 아니라 줄바꿈으로 모든 컨트롤이 보인다(가로 스크롤 없음)', { skip, timeout: 180000 }, async () => {
  for (const width of [501, 640, 768, 900]) {
    await withPage({ width, height: 800 }, async page => {
      const info = await barInfo(page);
      assert.equal(info.overflowY, 'visible', `${width}px: overflow-y`);
      assert.equal(info.maxHeight, 'none', `${width}px: max-height`);
      assert.ok(info.scrollH <= info.clientH + 1, `${width}px: 안쪽 스크롤 없음(${info.scrollH} > ${info.clientH})`);
      assert.ok(info.docW <= info.innerW, `${width}px: 가로 스크롤 없음(${info.docW} ≤ ${info.innerW})`);
      assert.equal(await page.isVisible('#btn-more'), false, `${width}px: 더보기는 500px 이하에서만`);
      // 맨 끝 컨트롤(도움말)도 상단바 안에서 누를 수 있다 — 예전에는 148px 상자에 가려 스크롤해야 했다
      assert.equal(await clickable(page, 'btn-help'), true, `${width}px: 도움말 버튼을 누를 수 있다`);
      assert.ok(await page.evaluate(() => document.getElementById('btn-help').getBoundingClientRect().bottom <= document.querySelector('.topbar').getBoundingClientRect().bottom + 1), `${width}px: 도움말이 상단바 안`);
    });
  }
});

test('P6-3 메뉴는 동시에 하나만 열린다: 파일·계정·더보기', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    await page.click('#btn-file');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.click('#btn-more');
    await page.waitForFunction(() => document.querySelector('#more-menu').matches(':popover-open'));
    assert.equal(await isOpen(page, 'file-menu'), false);
    await page.click('#btn-account');
    await page.waitForFunction(() => document.querySelector('#account-menu').matches(':popover-open'));
    assert.equal(await isOpen(page, 'more-menu'), false);
    assert.equal(await isOpen(page, 'account-menu'), true);
  });
});

test('P6-3 Popover 미지원 흉내 375px: 더보기도 .open 경로로 열리고 선택·버튼·Esc가 같다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    assert.equal(await page.evaluate(() => SF.menus.supported()), false);
    assert.equal(await page.evaluate(() => document.querySelector('#more-menu').hasAttribute('popover')), false, 'popover 속성이 걷혔다');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#more-menu > .more-group').length), 3);
    await page.click('#btn-more');
    await page.waitForSelector('#more-menu.open');
    assert.equal(await revealed(page, 'btn-help'), true, '맨 끝 컨트롤도 누를 수 있다');
    await page.selectOption('#theme-select', 'light');
    assert.equal(await isOpen(page, 'more-menu'), true, '선택해도 열려 있다');
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(page, 'more-menu'), false);
    await page.click('#btn-more');
    await page.waitForSelector('#more-menu.open');
    await page.click('#btn-help');
    await page.waitForFunction(() => document.querySelector('#dlg-help').open);
    assert.equal(await isOpen(page, 'more-menu'), false, '버튼을 누르면 닫힌다');
  }, { fallback: true });
});

test('P6-3 첫 그리기 전(스크립트가 돌기 전): ≤500px에서는 묶음이 상단바 줄을 채우지 않고, 넓은 화면에서는 컨트롤이 그대로 놓인다', { skip, timeout: 60000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    for (const [width, expected] of [[375, 'none'], [500, 'none'], [501, 'contents'], [1200, 'contents']]) {
      const context = await browser.newContext(pageOptions({ viewport: { width, height: 800 } }));
      const page = await context.newPage();
      // 스크립트를 모두 막고 연다 — js/menus.js가 묶음을 더보기 메뉴로 옮기기 전의 CSS 상태(첫 그리기 때 깜박이지 않는지)를 본다
      await page.route('**/*.js', route => route.abort());
      await page.goto(URL_, { waitUntil: 'domcontentloaded' });
      const displays = await page.evaluate(() => [...document.querySelectorAll('.topbar > .more-group')].map(el => getComputedStyle(el).display));
      assert.deepEqual(displays, [expected, expected, expected], `${width}px, 스크립트 전: .more-group display`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
