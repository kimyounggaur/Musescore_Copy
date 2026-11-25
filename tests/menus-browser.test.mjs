// P6-1: 파일 메뉴(Popover)를 실제 브라우저에서 확인한다.
//  - 어떤 화면 폭(1200·900·375·360)에서도 메뉴가 화면 안에 놓이고, 맨 아래 항목까지 스크롤해서 누를 수 있다.
//    (예전에는 좁은 화면에서 상단바의 overflow에 메뉴가 잘려 아래쪽 항목에 닿지 못했다 — F-모바일)
//  - 항목을 누르면 동작하고 메뉴가 닫힌다. Esc·바깥 누름으로 닫히고, 키보드(↑↓·Home·End)로 오간다.
//  - Popover를 모르는 브라우저(popover 속성을 지워서 흉내 낸다)에서도 같은 일이 된다(.open 경로).
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/menus-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;

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
    // Popover를 모르는 브라우저 흉내 — 앱 스크립트가 돌기 전에 API를 지운다
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

const isOpen = page => page.evaluate(() => {
  const menu = document.querySelector('#file-menu');
  return menu.hasAttribute('popover') ? menu.matches(':popover-open') : menu.classList.contains('open');
});
const geometry = page => page.evaluate(() => {
  const menu = document.querySelector('#file-menu'), button = document.querySelector('#btn-file');
  const m = menu.getBoundingClientRect(), b = button.getBoundingClientRect();
  return {
    menu: { left: m.left, top: m.top, right: m.right, bottom: m.bottom }, button: { left: b.left, bottom: b.bottom },
    view: { width: document.documentElement.clientWidth, height: innerHeight },
    scrollable: menu.scrollHeight > menu.clientHeight, expanded: button.getAttribute('aria-expanded'),
    items: menu.querySelectorAll('[role="menuitem"]').length,
    checkboxes: menu.querySelectorAll('input[type="checkbox"][role="menuitemcheckbox"]').length,
    withoutMiClass: [...menu.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]')].filter(el => !(el.closest('.mi') || el).classList.contains('mi')).length,
    minItemHeight: Math.min(...[...menu.querySelectorAll('.mi')].map(el => el.getBoundingClientRect().height)),
  };
});
// 메뉴를 맨 아래로 스크롤한 뒤, 마지막 항목 한가운데를 실제로 누를 수 있는지(그 자리의 최상위 요소가 항목인지) 본다.
// scrollIntoView는 조상의 스크롤 상자(상단바)까지 움직여서 잘림을 가려 버리므로 쓰지 않고, 메뉴 자신만 스크롤한다.
const lastItemReachable = page => page.evaluate(() => {
  const menu = document.querySelector('#file-menu'), items = [...menu.querySelectorAll('[role="menuitem"]')], last = items.at(-1);
  menu.scrollTop = menu.scrollHeight;
  const r = last.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { act: last.dataset.act || last.dataset.action, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, hit: hit === last || last.contains(hit) };
});
const within = (g, label) => {
  assert.ok(g.menu.left >= 7.5, `${label}: 왼쪽 가장자리 안 ${g.menu.left}`);
  assert.ok(g.menu.right <= g.view.width - 7.5, `${label}: 오른쪽 가장자리 안 ${g.menu.right} ≤ ${g.view.width - 8}`);
  assert.ok(g.menu.top >= g.button.bottom, `${label}: 버튼 아래에서 시작`);
  assert.ok(g.menu.bottom <= g.view.height - 7.5, `${label}: 아래 가장자리 안 ${g.menu.bottom} ≤ ${g.view.height - 8}`);
};

for (const [width, height] of [[1200, 800], [900, 800], [375, 667], [360, 640]]) {
  test(`P6-1 ${width}×${height}: 메뉴가 화면 안에 열리고 맨 아래 항목까지 누를 수 있으며, 항목을 누르면 동작하고 닫힌다`, { skip, timeout: 120000 }, async () => {
    await withPage({ width, height }, async page => {
      assert.equal(await isOpen(page), false, '처음에는 닫혀 있다');
      assert.equal((await geometry(page)).expanded, 'false');

      await page.click('#btn-file');
      await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
      let g = await geometry(page);
      assert.equal(g.expanded, 'true');
      assert.equal(g.items, 19, `role="menuitem" 항목: 고정 13 + 내보내기 2(SVG·PNG) + 클라우드 4(저장·내 악보·공유·사본) = 19 (${g.items})`);
      assert.equal(g.checkboxes, 1, '자동 클라우드 저장 체크박스는 menuitemcheckbox');
      assert.equal(g.withoutMiClass, 0, '모든 항목이 .mi 스타일을 쓴다(내보내기·클라우드 항목 포함)');
      if (width <= 900) assert.ok(g.minItemHeight >= 40, `좁은 화면에서는 항목 높이가 40px 이상이어야 손가락으로 누르기 쉽다 (${g.minItemHeight})`);
      within(g, `${width}px`);
      assert.ok(Math.abs(g.menu.top - (g.button.bottom + 4)) <= 1, `버튼 바로 아래(4px): ${g.menu.top} vs ${g.button.bottom + 4}`);

      const last = await lastItemReachable(page);
      assert.equal(last.act, 'cloud-copy', '맨 아래 항목은 클라우드 ▸ 사본 만들기');
      assert.ok(last.inView, '맨 아래 항목이 화면 안에 있다');
      assert.ok(last.hit, '맨 아래 항목 한가운데의 최상위 요소가 그 항목이다(잘리거나 가려지지 않았다)');
      within(await geometry(page), `${width}px 스크롤 뒤`);

      // 항목을 누르면 동작하고 닫힌다
      const expected = await page.evaluate(() => SF.io.DEMOS.star().meta.title);
      await page.click('#file-menu [data-act="demo-star"]');
      await page.waitForFunction(title => SF.core.state.score.meta.title === title, expected);
      assert.equal(await isOpen(page), false, '항목을 누르면 닫힌다');
      assert.equal((await geometry(page)).expanded, 'false');
    });
  });
}

test('P6-1 키보드: Enter·↓로 열고, ↑↓·Home·End로 오가고, Esc로 닫으면 포커스가 버튼으로 돌아온다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 1200, height: 800 }, async page => {
    const active = () => page.evaluate(() => document.activeElement && (document.activeElement.dataset.act || document.activeElement.dataset.action || document.activeElement.id));
    await page.focus('#btn-file');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.waitForFunction(() => document.activeElement?.dataset.act === 'new');
    assert.equal(await active(), 'new', '열면 첫 항목에 포커스');

    await page.keyboard.press('ArrowDown'); assert.equal(await active(), 'open');
    await page.keyboard.press('ArrowUp'); assert.equal(await active(), 'new');
    await page.keyboard.press('ArrowUp'); assert.equal(await active(), 'cloud-copy', '첫 항목에서 ↑는 맨 아래로 돈다');
    await page.keyboard.press('ArrowDown'); assert.equal(await active(), 'new', '맨 아래에서 ↓는 맨 위로 돈다');
    await page.keyboard.press('End'); assert.equal(await active(), 'cloud-copy');
    await page.keyboard.press('Home'); assert.equal(await active(), 'new');

    // 메뉴에 포커스가 있는 동안 글자 키는 전역 단축키(N = 입력 모드)로 새어 나가지 않는다
    await page.keyboard.press('n');
    assert.equal(await page.evaluate(() => SF.app.ui.inputMode), false, '입력 모드가 켜지지 않았다');
    assert.equal(await isOpen(page), true);

    await page.keyboard.press('Escape');
    assert.equal(await isOpen(page), false, 'Esc로 닫힌다');
    assert.equal(await active(), 'btn-file', '포커스가 파일 버튼으로 돌아온다');
    assert.equal((await geometry(page)).expanded, 'false');

    // 버튼에서 ↓로 열기, ↑로 열면 마지막 항목
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.waitForFunction(() => document.activeElement?.dataset.act === 'new');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.activeElement?.dataset.action === 'cloud-copy');
    assert.equal(await isOpen(page), true);

    // 맨 아래 항목에서 Tab으로 메뉴 밖으로 나가면 닫힌다
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !document.querySelector('#file-menu').matches(':popover-open'));
    assert.equal(await isOpen(page), false, 'Tab으로 나가면 닫힌다');
  });
});

test('P6-1 Esc: 메뉴가 열려 있을 때 Esc는 메뉴만 닫고 전역 단축키(입력 모드 끄기)로 새지 않는다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 1200, height: 800 }, async page => {
    const inputOn = () => page.evaluate(() => SF.app.ui.inputMode); // 화면 표시(.on)는 한 박자 늦게 바뀌므로 상태값을 직접 본다
    // defaultPrevented를 확인하지 않는 문서 전역 리스너가 Esc를 몇 번 받는지 센다(전역 단축키 처리기는 prevent 여부를 보고 물러나지만, 그렇지 않은 처리기도 새로 생길 수 있다)
    await page.evaluate(() => { window.__escSeen = 0; document.addEventListener('keydown', e => { if (e.key === 'Escape') window.__escSeen++; }); });
    const escSeen = () => page.evaluate(() => window.__escSeen);
    await page.keyboard.press('n');
    assert.equal(await inputOn(), true, '(전제) N으로 입력 모드가 켜졌다');
    await page.click('#btn-file');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(page), false, '메뉴는 닫혔다');
    assert.equal(await inputOn(), true, '입력 모드는 그대로 켜져 있다 — 이 Esc는 메뉴를 닫는 데만 쓰였다');
    assert.equal(await escSeen(), 0, '메뉴를 닫는 Esc는 문서 전역 리스너까지 전달되지 않는다');
    await page.keyboard.press('Escape');
    assert.equal(await inputOn(), false, '메뉴가 닫힌 뒤의 Esc는 원래대로 입력 모드를 끈다');
    assert.equal(await escSeen(), 1, '메뉴가 닫힌 뒤의 Esc는 평소처럼 전달된다');
  });
});

test('P6-1 바깥 누름·화면 크기 변경: 바깥을 누르면 닫히고, 열린 채 폭이 줄면 화면 안으로 다시 놓인다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 1200, height: 800 }, async page => {
    await page.click('#btn-file');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.click('.topbar .brand');
    assert.equal(await isOpen(page), false, '바깥(.brand)을 누르면 닫힌다');
    assert.equal((await geometry(page)).expanded, 'false');

    // 파일 버튼을 다시 눌러 닫는다(열기→닫기 토글)
    await page.click('#btn-file');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.click('#btn-file');
    assert.equal(await isOpen(page), false, '열린 상태에서 버튼을 다시 누르면 닫힌다');

    // 연 채로 창을 좁히면 메뉴가 화면 안으로 다시 놓인다
    await page.click('#btn-file');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForFunction(() => {
      const r = document.querySelector('#file-menu').getBoundingClientRect(), b = document.querySelector('#btn-file').getBoundingClientRect();
      return r.right <= document.documentElement.clientWidth - 7.5 && r.bottom <= innerHeight - 7.5 && Math.abs(r.top - (b.bottom + 4)) <= 1;
    });
    assert.equal(await isOpen(page), true, '다시 놓였을 뿐 닫히지는 않는다');
    within(await geometry(page), '375px로 줄인 뒤');
  });
});

// P6-1b: 메뉴가 "열리는 순간"부터 Esc·창 크기 변화를 처리한다.
// 네이티브 Popover는 showPopover() 직후 beforetoggle(동기)을 지나 메뉴가 열리지만 toggle 이벤트는 한 박자(약 10~20ms) 늦게 온다.
// 처리기(Esc 가로채기·resize 다시 놓기)를 toggle에서 붙이던 때는 그 틈에 들어온 Esc를 아무도 닫지 못했고(브라우저 기본 동작도 닫지 않았다)
// 틈에 온 resize는 다시 놓이지 않았다 — 사람은 닿을 수 없는 틈이지만 자동 시험이 열자마자 Esc를 누르면 간헐 실패가 났다.
// 틈을 우연에 맡기지 않으려고 같은 작업 안에서 열고 바로 이벤트를 보낸다(그동안 toggle 이벤트는 올 수 없다).
for (const [menuId, buttonId] of [['file-menu', 'btn-file'], ['account-menu', 'btn-account'], ['more-menu', 'btn-more']]) {
  test(`P6-1b 열리자마자 Esc: #${menuId} — toggle 이벤트가 오기 전에 들어온 Esc도 메뉴만 닫는다`, { skip, timeout: 120000 }, async () => {
    await withPage({ width: 375, height: 667 }, async page => {
      const r = await page.evaluate(([menuId, buttonId]) => {
        const menu = document.getElementById(menuId), button = document.getElementById(buttonId);
        SF.menus.open(menu); // showPopover() — beforetoggle까지 동기로 지나갔고, toggle 이벤트는 이 함수가 끝나야 올 수 있다
        const opened = menu.matches(':popover-open');
        const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        button.dispatchEvent(esc);
        return { opened, stillOpen: menu.matches(':popover-open'), prevented: esc.defaultPrevented, expanded: button.getAttribute('aria-expanded') };
      }, [menuId, buttonId]);
      assert.equal(r.opened, true, '(전제) 열었고, 아직 toggle 이벤트는 오지 않았다');
      assert.equal(r.stillOpen, false, '그 틈의 Esc가 메뉴를 닫는다');
      assert.equal(r.prevented, true, '이 Esc는 메뉴를 닫는 데 쓰였으니 전역 단축키(재생 정지·선택 해제)로 번지지 않게 막는다');
      assert.equal(r.expanded, 'false', '닫히면 aria-expanded도 false');
    });
  });
}

test('P6-1b 열리자마자 창 크기 변화: toggle 이벤트가 오기 전에 온 resize도 메뉴를 버튼 아래로 다시 놓는다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 1200, height: 800 }, async page => {
    const r = await page.evaluate(async () => {
      const menu = document.getElementById('file-menu');
      SF.menus.open(menu);
      const placed = menu.style.top;
      menu.style.top = '321px'; // 일부러 엉뚱한 자리에 옮겨 두고
      window.dispatchEvent(new Event('resize')); // toggle 이벤트가 오기 전에 창 크기가 바뀌었다고 치면
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); // resize 처리기는 다음 프레임에 위치를 다시 잡는다
      return { placed, after: menu.style.top, open: menu.matches(':popover-open') };
    });
    assert.notEqual(r.placed, '', '(전제) 열 때 위치가 잡혔다');
    assert.equal(r.after, r.placed, '틈에 온 resize도 위치를 다시 잡는다(버튼은 그대로이니 처음 자리로 돌아온다)');
    assert.equal(r.open, true, '다시 놓였을 뿐 닫히지는 않는다');
  });
});

for (const [width, height] of [[1200, 800], [375, 667]]) {
  test(`P6-1 Popover 미지원 흉내 ${width}×${height}: popover 속성을 걷어 내고 .open 경로로 같은 일을 한다`, { skip, timeout: 120000 }, async () => {
    await withPage({ width, height }, async page => {
      assert.equal(await page.evaluate(() => SF.menus.supported()), false, '지원하지 않는 것으로 판단');
      assert.equal(await page.evaluate(() => document.querySelector('#file-menu').hasAttribute('popover')), false, 'popover 속성이 걷혔다');
      assert.equal(await page.evaluate(() => document.querySelector('#btn-file').hasAttribute('popovertarget')), false, 'popovertarget도 걷혔다');
      assert.equal(await isOpen(page), false);

      await page.click('#btn-file');
      await page.waitForSelector('#file-menu.open');
      const g = await geometry(page);
      assert.equal(g.expanded, 'true');
      within(g, `미지원 ${width}px`);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'new', '열면 첫 항목에 포커스');
      const last = await lastItemReachable(page);
      assert.ok(last.inView && last.hit, '미지원 경로에서도 맨 아래 항목에 닿는다 — position:fixed라 상단바 overflow에 잘리지 않는다');

      // Esc로 닫으면 포커스가 버튼으로 돌아온다
      await page.keyboard.press('Escape');
      assert.equal(await isOpen(page), false, 'Esc로 닫힌다');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-file');

      // 바깥 누름으로 닫는다
      await page.click('#btn-file');
      await page.waitForSelector('#file-menu.open');
      await page.click('.topbar .brand');
      assert.equal(await isOpen(page), false, '바깥을 누르면 닫힌다');

      // 항목을 누르면 동작하고 닫힌다
      const expected = await page.evaluate(() => SF.io.DEMOS.star().meta.title);
      await page.click('#btn-file');
      await page.waitForSelector('#file-menu.open');
      await page.click('#file-menu [data-act="demo-star"]');
      await page.waitForFunction(title => SF.core.state.score.meta.title === title, expected);
      assert.equal(await isOpen(page), false, '항목을 누르면 닫힌다');
      assert.equal((await geometry(page)).expanded, 'false');
    }, { fallback: true });
  });
}
