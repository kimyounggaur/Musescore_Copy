// P6-2: 좁은 화면(≤500px)에서 로그인 버튼이 사라지지 않게 한다 — 항상 보이는 👤 계정 메뉴를 실제 브라우저에서 확인한다.
//  - 500px 이하: 회원 메뉴(.authbar)가 #account-menu 안으로 옮겨져 있고, 👤을 누르면 로그인 버튼을 누를 수 있다(대화상자가 열린다).
//  - 501px 이상: .authbar는 원래 자리(상단바, 언어 선택 바로 다음)에 있고 👤은 보이지 않는다.
//  - 창 크기를 바꿔 오가도 auth.js의 이벤트 연결이 그대로다(노드를 옮길 뿐).
//  - 파일 메뉴와 계정 메뉴는 동시에 열리지 않는다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/account-menu-browser.test.mjs
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

const where = page => page.evaluate(() => {
  const bar = document.querySelector('.authbar');
  // 언어 선택은 P6-3부터 .more-group 묶음 안에 있으므로, "언어 선택 바로 다음"은 그 묶음 바로 다음을 뜻한다
  return { parent: bar.parentElement.id || bar.parentElement.className, afterLanguage: document.querySelector('#language-select').closest('.more-group').nextElementSibling === bar };
});
const accountOpen = page => page.evaluate(() => {
  const menu = document.querySelector('#account-menu');
  return menu.hasAttribute('popover') ? menu.matches(':popover-open') : menu.classList.contains('open');
});
const fileOpen = page => page.evaluate(() => {
  const menu = document.querySelector('#file-menu');
  return menu.hasAttribute('popover') ? menu.matches(':popover-open') : menu.classList.contains('open');
});
// 로그인 버튼 한가운데를 실제로 누를 수 있는가(그 자리의 최상위 요소가 그 버튼인가)
const clickable = (page, selector) => page.evaluate(sel => {
  const b = document.querySelector(sel), r = b.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit === b || b.contains(hit);
}, selector);
const authDialogOpen = page => page.evaluate(() => document.querySelector('#dlg-auth').open);
const closeAuthDialog = async page => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#dlg-auth').open); };

test('P6-2 375px: 회원 메뉴가 👤 계정 메뉴 안에 있고, 열면 로그인 버튼을 눌러 로그인 창이 열린다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    assert.deepEqual(await where(page), { parent: 'account-menu', afterLanguage: false }, '.authbar가 #account-menu 안으로 옮겨졌다');
    assert.equal(await page.isVisible('#btn-account'), true, '👤 버튼은 보인다');
    assert.equal(await page.getAttribute('#btn-account', 'aria-label'), '계정 메뉴');
    assert.equal(await page.getAttribute('#btn-account', 'aria-haspopup'), null, '계정 메뉴는 role=menu가 아니라 버튼 꾸러미(disclosure)라서 aria-haspopup을 붙이지 않는다');
    assert.equal(await page.isVisible('#btn-member-login'), false, '닫혀 있는 동안 로그인 버튼은 보이지 않는다');

    await page.click('#btn-account');
    await page.waitForFunction(() => document.querySelector('#account-menu').matches(':popover-open'));
    assert.equal(await page.getAttribute('#btn-account', 'aria-expanded'), 'true');
    const box = await page.evaluate(() => { const r = document.querySelector('#account-menu').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, w: document.documentElement.clientWidth, h: innerHeight }; });
    assert.ok(box.left >= 7.5 && box.right <= box.w - 7.5 && box.bottom <= box.h - 7.5, `계정 메뉴가 화면 안: ${JSON.stringify(box)}`);
    for (const id of ['#btn-signup', '#btn-member-login', '#btn-admin-login']) assert.equal(await clickable(page, id), true, `${id} 한가운데를 누를 수 있다`);
    assert.equal(await page.isVisible('#auth-status'), true, '로그인 상태 글자도 보인다');
    assert.equal(await page.isVisible('#btn-logout'), false, '로그아웃은 로그인했을 때만(hidden 유지)');

    await page.click('#btn-member-login');
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.match(await page.textContent('#auth-title'), /로그인/, '로그인 창이 열렸다');
    assert.equal(await accountOpen(page), false, '버튼을 누르면 계정 메뉴는 닫힌다');
  });
});

test('P6-2 오가기: 1200 → 375 → 1200으로 바꿔도 .authbar가 제자리로 돌아오고 버튼 연결이 유지된다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 1200, height: 800 }, async page => {
    assert.deepEqual(await where(page), { parent: 'topbar', afterLanguage: true }, '넓은 화면: 원래 자리(언어 선택 바로 다음)');
    assert.equal(await page.isVisible('#btn-account'), false, '넓은 화면에서 👤은 보이지 않는다');
    assert.equal(await clickable(page, '#btn-member-login'), true);
    await page.click('#btn-member-login');
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    await closeAuthDialog(page);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForFunction(() => document.querySelector('.authbar').parentElement.id === 'account-menu');
    await page.click('#btn-account');
    await page.waitForFunction(() => document.querySelector('#account-menu').matches(':popover-open'));
    await page.click('#btn-member-login');
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.equal(await authDialogOpen(page), true, '옮겨진 뒤에도 로그인 버튼의 이벤트 연결이 유지된다');
    await closeAuthDialog(page);

    // 계정 메뉴를 연 채로 넓히면 메뉴를 닫고 제자리로 돌려놓는다
    await page.click('#btn-account');
    await page.waitForFunction(() => document.querySelector('#account-menu').matches(':popover-open'));
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForFunction(() => document.querySelector('.authbar').parentElement.classList.contains('topbar'));
    assert.deepEqual(await where(page), { parent: 'topbar', afterLanguage: true }, '넓힌 뒤: 원래 자리');
    assert.equal(await accountOpen(page), false, '열려 있던 계정 메뉴는 닫혔다');
    assert.equal(await page.isVisible('#btn-account'), false);
    assert.equal(await clickable(page, '#btn-member-login'), true);
    await page.click('#btn-member-login');
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.equal(await authDialogOpen(page), true, '되돌아온 뒤에도 연결이 유지된다');
  });
});

test('P6-2 경계: 500px는 계정 메뉴, 501px는 상단바', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 501, height: 800 }, async page => {
    assert.deepEqual(await where(page), { parent: 'topbar', afterLanguage: true }, '501px');
    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForFunction(() => document.querySelector('.authbar').parentElement.id === 'account-menu');
    assert.equal(await page.isVisible('#btn-account'), true, '500px');
    await page.setViewportSize({ width: 501, height: 800 });
    await page.waitForFunction(() => document.querySelector('.authbar').parentElement.classList.contains('topbar'));
    assert.equal(await page.isVisible('#btn-account'), false, '501px');
  });
});

test('P6-2 파일 메뉴와 계정 메뉴는 동시에 열리지 않는다(클릭으로, 그리고 SF.menus.open으로)', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    await page.click('#btn-file');
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    await page.click('#btn-account');
    await page.waitForFunction(() => document.querySelector('#account-menu').matches(':popover-open'));
    assert.equal(await fileOpen(page), false, '계정 메뉴를 열면 파일 메뉴는 닫힌다');

    await page.evaluate(() => { SF.menus.open('#file-menu'); });
    await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
    assert.equal(await accountOpen(page), false, '파일 메뉴를 열면 계정 메뉴는 닫힌다');
  });
});

test('P6-2 Popover 미지원 흉내 375px: 같은 일이 .open 경로로 된다(로그인 버튼 클릭·동시에 하나만·Esc)', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    assert.equal(await page.evaluate(() => SF.menus.supported()), false);
    assert.equal(await page.evaluate(() => document.querySelector('#account-menu').hasAttribute('popover')), false, 'popover 속성이 걷혔다');
    assert.deepEqual(await where(page), { parent: 'account-menu', afterLanguage: false });
    await page.click('#btn-account');
    await page.waitForSelector('#account-menu.open');
    assert.equal(await clickable(page, '#btn-member-login'), true, '로그인 버튼 한가운데를 누를 수 있다');
    // 프로그램으로 다른 메뉴를 열면 먼저 열려 있던 메뉴는 닫힌다(미지원 경로에서는 closeOthers가 맡는다)
    await page.evaluate(() => { SF.menus.open('#file-menu'); });
    await page.waitForSelector('#file-menu.open');
    assert.equal(await accountOpen(page), false, '파일 메뉴를 열면 계정 메뉴는 닫힌다');
    await page.keyboard.press('Escape');
    assert.equal(await fileOpen(page), false, 'Esc로 닫힌다');

    await page.click('#btn-account');
    await page.waitForSelector('#account-menu.open');
    await page.click('#btn-member-login');
    await page.waitForFunction(() => document.querySelector('#dlg-auth').open);
    assert.equal(await accountOpen(page), false, '버튼을 누르면 닫힌다');
  }, { fallback: true });
});

test('P6-2 키보드: 👤을 Enter로 열면 첫 버튼(회원가입)에 포커스가 가고 ↓로 다음 버튼으로 이동하며 Esc로 닫힌다', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 375, height: 667 }, async page => {
    const active = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.focus('#btn-account');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#account-menu').matches(':popover-open'));
    await page.waitForFunction(() => document.activeElement?.id === 'btn-signup');
    assert.equal(await active(), 'btn-signup', '열면 첫 버튼에 포커스(로그인 전이라 보이는 버튼은 회원가입부터)');
    await page.keyboard.press('ArrowDown'); assert.equal(await active(), 'btn-member-login');
    await page.keyboard.press('End'); assert.equal(await active(), 'btn-admin-page', '숨겨진 로그아웃은 건너뛴다');
    await page.keyboard.press('Escape');
    assert.equal(await accountOpen(page), false);
    assert.equal(await active(), 'btn-account', '포커스가 👤으로 돌아온다');
  });
});

test('P6-2 첫 그리기 전(스크립트가 돌기 전): ≤500px에서는 .authbar가 상단바 줄을 채우지 않고, 넓은 화면에서는 보인다', { skip, timeout: 60000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    for (const [width, expected] of [[375, 'none'], [500, 'none'], [501, 'flex'], [1200, 'flex']]) {
      const context = await browser.newContext(pageOptions({ viewport: { width, height: 800 } }));
      const page = await context.newPage();
      // 스크립트를 모두 막고 연다 — js/menus.js가 .authbar를 계정 메뉴로 옮기기 전의 CSS 상태(첫 그리기 때 깜박이지 않는지)를 본다
      await page.route('**/*.js', route => route.abort());
      await page.goto(URL_, { waitUntil: 'domcontentloaded' });
      const display = await page.evaluate(() => getComputedStyle(document.querySelector('.authbar')).display);
      assert.equal(display, expected, `${width}px, 스크립트 전: .authbar display`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
