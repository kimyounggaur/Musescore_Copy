// P6-4: 화면 폭 테스트(🔒D3) — 6가지 폭(360·375·768·900·901·1200)에서 메뉴·로그인·가로 스크롤을 한 번에 본다.
//  - 파일 메뉴: #btn-file을 누르면 #file-menu가 열리고(:popover-open), 맨 아래 항목 한가운데가 화면 안이며 그 자리의 최상위 요소가 그 항목이다.
//  - 로그인: 500px 이하는 👤 계정 메뉴를 열면 #btn-member-login을 누를 수 있고, 501px 이상은 상단바에서 바로 누를 수 있다.
//    눌러서 열린 로그인 창도 화면 안에 들어오고 제출 버튼에 손이 닿는다.
//  - 가로 스크롤 없음: documentElement.scrollWidth ≤ innerWidth(처음·메뉴를 연 상태 모두).
//  - D3(보기·재생·간단한 수정, 2026-11-23 결정): 믹서·타임라인·내비게이터 같은 고급 패널은 휴대폰 폭(500px 이하)에서 열지 않고
//    "데스크톱에서 사용할 수 있어요" 안내만 띄운다 → 위 폭 검사에서 제외하고, 안내가 뜨는지·넓은 화면에서는 그대로 열리는지만 본다.
//    D3이 "전체"로 바뀌면 이 파일의 D3 부분(아래 세 시험)을 "폭마다 열고 닫기"로 바꾼다.
// 메뉴 하나하나의 세부(키보드·Esc·미지원 경로 등)는 menus-browser·account-menu-browser·topbar-browser 시험이 본다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/responsive.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;

// 설계서 10장 6-4의 여섯 폭(높이는 그 폭의 대표 기기 비율)
const SIZES = [[360, 640], [375, 667], [768, 1024], [900, 800], [901, 800], [1200, 800]];
const PHONE = 500; // 상단바가 ⋯ 더보기·👤 계정 메뉴로 접히고, 고급 패널이 안내로 바뀌는 경계

async function withPage(size, fn) {
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
    await page.goto(URL_, { waitUntil: 'networkidle' });
    await page.waitForSelector('#svg-host .ev');
    await page.waitForFunction(() => SF.engrave.isFontReady());
    await fn(page);
    assert.deepEqual(pageErrors, [], '페이지 오류 없음');
  } finally {
    await browser.close();
  }
}

const popoverOpen = (page, id) => page.evaluate(i => document.getElementById(i).matches(':popover-open'), id);
const waitPopover = (page, id, open = true) => page.waitForFunction(([i, want]) => document.getElementById(i).matches(':popover-open') === want, [id, open]);
// 그 컨트롤 한가운데를 실제로 누를 수 있는가(그 자리의 최상위 요소가 그 컨트롤이거나 그 안쪽인가)
const clickable = (page, id) => page.evaluate(i => {
  const el = document.getElementById(i), r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, id);
// 메뉴를 맨 아래로 스크롤(메뉴만)한 뒤 마지막 항목 한가운데가 화면 안인지, 그 자리의 최상위 요소가 그 항목인지 본다.
// scrollIntoView는 조상의 스크롤 상자까지 움직여 잘림을 가려 버리므로 쓰지 않는다.
const lastItem = page => page.evaluate(() => {
  const menu = document.getElementById('file-menu'), items = [...menu.querySelectorAll('[role="menuitem"]')], last = items.at(-1);
  menu.scrollTop = menu.scrollHeight;
  const r = last.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { act: last.dataset.act || last.dataset.action, x, y, centerInView: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight, hit: hit === last || last.contains(hit), items: items.length };
});
const scrollWidths = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: innerWidth }));
const noSideScroll = async (page, label) => {
  const w = await scrollWidths(page);
  assert.ok(w.doc <= w.inner, `${label}: 가로 스크롤 없음 documentElement ${w.doc} ≤ ${w.inner}`);
  assert.ok(w.body <= w.inner, `${label}: body도 화면 폭 안 ${w.body} ≤ ${w.inner}`);
};
const toastText = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.textContent : null; });
const dialogOpen = (page, id) => page.evaluate(i => document.getElementById(i).open, id);

for (const [width, height] of SIZES) {
  test(`P6-4 ${width}×${height}: 파일 메뉴 맨 아래 항목·로그인 버튼에 손이 닿고 가로 스크롤이 없다`, { skip, timeout: 120000 }, async () => {
    await withPage({ width, height }, async page => {
      const label = `${width}×${height}`;
      await noSideScroll(page, `${label} 처음`);

      // 1) 파일 메뉴
      await page.click('#btn-file');
      await waitPopover(page, 'file-menu');
      const last = await lastItem(page);
      assert.equal(last.act, 'cloud-copy', `${label}: 맨 아래 항목은 클라우드 ▸ 사본 만들기(항목 ${last.items}개)`);
      assert.ok(last.centerInView, `${label}: 맨 아래 항목 한가운데(${Math.round(last.x)}, ${Math.round(last.y)})가 화면 안`);
      assert.ok(last.hit, `${label}: 맨 아래 항목 한가운데의 최상위 요소가 그 항목이다(잘리거나 가려지지 않았다)`);
      await noSideScroll(page, `${label} 파일 메뉴 열림`);
      await page.keyboard.press('Escape');
      await waitPopover(page, 'file-menu', false);

      // 2) 로그인 — 500px 이하는 계정 메뉴 안, 501px 이상은 상단바 안
      if (width <= PHONE) {
        assert.equal(await page.isVisible('#btn-account'), true, `${label}: 👤 계정 버튼이 보인다`);
        await page.click('#btn-account');
        await waitPopover(page, 'account-menu');
        assert.equal(await clickable(page, 'btn-member-login'), true, `${label}: 계정 메뉴 안 로그인 버튼 한가운데를 누를 수 있다`);
        await noSideScroll(page, `${label} 계정 메뉴 열림`);
      } else {
        assert.equal(await page.isVisible('#btn-account'), false, `${label}: 넓은 화면에는 👤 계정 버튼이 없다`);
        assert.equal(await clickable(page, 'btn-member-login'), true, `${label}: 상단바의 로그인 버튼 한가운데를 바로 누를 수 있다`);
      }
      await page.click('#btn-member-login');
      await page.waitForFunction(() => document.getElementById('dlg-auth').open);
      assert.match(await page.textContent('#auth-title'), /로그인/, `${label}: 로그인 창이 열렸다`);
      // 로그인 창이 화면 안에 들어오고, 맨 아래 제출 버튼에 손이 닿는다(눌러도 창이 잘려 못 누르는 일이 없다)
      const box = await page.evaluate(() => {
        const d = document.getElementById('dlg-auth'), r = d.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight, scrollW: d.scrollWidth, clientW: d.clientWidth };
      });
      assert.ok(box.left >= 0 && box.right <= box.w && box.top >= 0 && box.bottom <= box.h, `${label}: 로그인 창이 화면 안 ${JSON.stringify(box)}`);
      assert.ok(box.scrollW <= box.clientW, `${label}: 로그인 창 안쪽에 가로 스크롤이 없다(내용이 창보다 넓지 않다) ${box.scrollW} ≤ ${box.clientW}`);
      assert.equal(await clickable(page, 'auth-submit'), true, `${label}: 로그인 창의 제출 버튼 한가운데를 누를 수 있다`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('dlg-auth').open);

      // 3) 좁은 화면의 ⋯ 더보기 메뉴를 열어도 가로 스크롤은 없다
      if (width <= PHONE) {
        await page.click('#btn-more');
        await waitPopover(page, 'more-menu');
        await noSideScroll(page, `${label} 더보기 메뉴 열림`);
        await page.keyboard.press('Escape');
        await waitPopover(page, 'more-menu', false);
      }
      await noSideScroll(page, `${label} 끝`);
    });
  });
}

const PANELS = [
  { button: 'btn-mixer', dialog: 'dlg-mixer', ko: '믹서는 데스크톱에서 사용할 수 있어요', en: 'The mixer is available on desktop' },
  { button: 'btn-navigator', dialog: 'dlg-navigator', ko: '내비게이터는 데스크톱에서 사용할 수 있어요', en: 'The navigator is available on desktop', key: 'F12' },
  { button: 'btn-timeline', dialog: 'dlg-timeline', ko: '타임라인은 데스크톱에서 사용할 수 있어요', en: 'The timeline is available on desktop', key: 'F11' },
];

for (const [width, height] of [[360, 640], [375, 667]]) {
  test(`P6-4 D3 ${width}×${height}: 믹서·타임라인·내비게이터는 열리지 않고 "데스크톱에서 사용할 수 있어요" 안내만 뜬다(버튼·F11·F12)`, { skip, timeout: 120000 }, async () => {
    await withPage({ width, height }, async page => {
      for (const p of PANELS) {
        await page.click('#btn-more');
        await waitPopover(page, 'more-menu');
        await page.click('#' + p.button);
        await page.waitForFunction(text => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent === text; }, p.ko);
        assert.equal(await dialogOpen(page, p.dialog), false, `${p.button}: 창은 열리지 않는다`);
        assert.equal(await popoverOpen(page, 'more-menu'), false, `${p.button}: 버튼을 눌렀으니 더보기 메뉴는 닫힌다`);
        await noSideScroll(page, `${width}px ${p.button} 안내`);
      }
      // 키보드(블루투스 키보드를 단 폰·태블릿): F12는 내비게이터, F11은 타임라인
      for (const p of PANELS.filter(item => item.key)) {
        await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
        await page.focus('#canvas');
        await page.keyboard.press(p.key);
        await page.waitForFunction(text => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent === text; }, p.ko);
        assert.equal(await dialogOpen(page, p.dialog), false, `${p.key}: 창은 열리지 않는다`);
      }
      // 영어로 바꾸면 안내도 영어
      await page.evaluate(() => SF.i18n.setLanguage('en'));
      await page.click('#btn-more');
      await waitPopover(page, 'more-menu');
      await page.click('#btn-mixer');
      await page.waitForFunction(text => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent === text; }, PANELS[0].en);
      assert.equal(await dialogOpen(page, 'dlg-mixer'), false);
    });
  });
}

test('P6-4 D3 경계: 501px에서는 세 패널이 열리고, 500px로 좁아지면 안내로 바뀌며, 다시 넓어지면 열린다(누르는 순간의 폭을 따른다)', { skip, timeout: 120000 }, async () => {
  await withPage({ width: 501, height: 700 }, async page => {
    const openAll = async phase => {
      for (const p of PANELS) {
        await page.click('#' + p.button);
        await page.waitForFunction(id => document.getElementById(id).open, p.dialog);
        assert.equal(await toastText(page) === p.ko, false, `${phase} ${p.button}: 안내 없이 열린다`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(id => !document.getElementById(id).open, p.dialog);
      }
    };
    await openAll('501px');

    await page.setViewportSize({ width: 500, height: 700 });
    await page.waitForFunction(() => !!document.querySelector('#more-menu #btn-mixer'));
    await page.click('#btn-more');
    await waitPopover(page, 'more-menu');
    await page.click('#btn-mixer');
    await page.waitForFunction(text => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent === text; }, PANELS[0].ko);
    assert.equal(await dialogOpen(page, 'dlg-mixer'), false, '500px: 믹서는 안내만');

    await page.setViewportSize({ width: 501, height: 700 });
    await page.waitForFunction(() => !document.querySelector('#more-menu #btn-mixer'));
    await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await openAll('다시 501px');
  });
});

for (const [width, height] of [[360, 640], [375, 667]]) {
  test(`P6-4 D3 ${width}×${height}: 보기·재생·간단한 수정 — 악보가 보이고, 음표를 눌러 지우고(쉼표로) 되돌리고, 재생·정지가 된다`, { skip, timeout: 120000 }, async () => {
    await withPage({ width, height }, async page => {
      // 보기: 악보가 그려지고 화면 폭 안에서 보인다
      const view = await page.evaluate(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width, notes: document.querySelectorAll('#svg-host .ev').length }; });
      assert.ok(view.notes > 0, '악보가 그려졌다');
      assert.ok(view.left >= 0 && view.right <= width && view.w > 0, `악보 영역이 화면 안 ${JSON.stringify(view)}`);

      // 손이 닿아야 하는 핵심 컨트롤(되돌리기·다시 실행·재생·정지·처음으로·파일·입력 탭)
      for (const id of ['btn-undo', 'btn-redo', 'btn-rewind', 'btn-play', 'btn-stop', 'btn-file', 'palette-tab-input', 'palette-tab-duration']) {
        assert.equal(await clickable(page, id), true, `${id} 한가운데를 누를 수 있다`);
      }

      // 간단한 수정: 첫 음표를 눌러 고르고 → 빠른 입력 줄의 삭제(쉼표로 바꾸기) → 실행 취소 → 다시 실행 → 실행 취소
      const spot = await page.evaluate(() => {
        const score = SF.core.state.score;
        const refs = SF.core.staffRefs(score);
        for (let r = 0; r < refs.length; r++) for (let m = 0; m < refs[r].measures.length; m++) {
          const entries = [...SF.core.measureEntries(refs[r].measures[m], { score })];
          const i = entries.findIndex(({ ev }) => ev.type === 'note');
          if (i >= 0) return { r, m, i, id: entries[i].ev.id };
        }
        return null;
      });
      assert.ok(spot, '악보에 음표가 있다');
      // 삭제하면 그 자리에 새 id의 쉼표가 생기므로, id가 아니라 자리(보표·마디·순서)로 같은 칸을 본다
      const typeAt = () => page.evaluate(({ r, m, i }) => {
        const score = SF.core.state.score;
        return [...SF.core.measureEntries(SF.core.staffRefs(score)[r].measures[m], { score })][i].ev.type;
      }, spot);
      await page.locator(`[data-ref="${spot.id}"] .note-hit`).first().click();
      assert.equal(await page.evaluate(() => SF.app.actions.selectedEvent()?.ev.id), spot.id, '눌러서 그 음표가 골라진다');
      await page.locator('.palette-quick button[aria-label^="삭제"]').click();
      assert.equal(await typeAt(), 'rest', '삭제하면 쉼표로 바뀐다');
      await page.click('#btn-undo');
      assert.equal(await typeAt(), 'note', '실행 취소하면 음표로 돌아온다');
      await page.click('#btn-redo');
      assert.equal(await typeAt(), 'rest', '다시 실행하면 쉼표');
      await page.click('#btn-undo');
      assert.equal(await typeAt(), 'note');

      // 재생·정지
      await page.click('#btn-play');
      await page.waitForFunction(() => SF.playback.player.playing);
      await page.click('#btn-stop');
      await page.waitForFunction(() => !SF.playback.player.playing);
      await noSideScroll(page, `${width}px 수정·재생 뒤`);
    });
  });
}
