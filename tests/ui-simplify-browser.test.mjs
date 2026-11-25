// P9-1 화면 복잡도 정리 — 실제 브라우저(Chromium)에서 확인하는 부분.
//  ① 기본값(고급)은 아무것도 숨기지 않는다 ② 기본 보기: 분류대로 숨고 보인다·숫자·핵심 조작은 그대로
//  ③ 저장·새로 고침·저장소가 막힌 경우·첫 화면 전에 적용 ④ 숨긴 기능은 단축키·명령 팔레트로 그대로 된다
//  ⑤ 키보드: 팔레트 한 칸 탭·메뉴 ↑↓·초점 옮김 ⑥ 속성 패널이 다시 그려져도 분류 유지 ⑦ 좁은 화면 ⑧ 한글 라벨·영어 전환
//  ⑨ docs/UI_INVENTORY.md가 화면과 같다
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/ui-simplify-browser.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
import { collectControls, collectInventory, openForInventory, renderInventory } from './ui-inventory-lib.mjs';
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

/** 시험마다 새 컨텍스트(저장소가 비어 있는 처음 방문). init 스크립트로 저장값을 미리 넣을 수 있다. */
async function open(t, { width = 1440, height = 900, init, locale } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width, height }, ...(locale ? { locale } : {}) }));
  t.after(() => context.close());
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('scoreforge.welcomed', '1'); } catch (e) { /* 저장소가 막힌 시험 */ } });
  if (init) await page.addInitScript(init);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return { page, errors };
}
const anyVisible = (page, selector) => page.evaluate(sel => [...document.querySelectorAll(sel)].some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'), selector);
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const visibleOf = (page, selector) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}, selector);
const selectFirstNote = async page => {
  await page.evaluate(() => {
    const id = SF.core.state.score.measures[0].events[0].id;
    document.querySelector(`[data-ref="${id}"] .note-hit`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('#note-v3', { state: 'attached' });
};

// 핵심 조작(기본 보기에서도 반드시 보여야 한다)과 고급으로 숨기는 조작 — 분류 초안의 일부를 못 박는다.
const ESSENTIAL = ['#btn-file', '#btn-undo', '#btn-redo', '#btn-play', '#btn-stop', '#btn-rewind', '#btn-metronome', '#tempo-input', '#btn-input', '#btn-delete',
  '#btn-dot', '#btn-rest', '#btn-sharp', '#btn-flat', '#btn-natural', '#btn-tie', '#btn-slur', '#btn-lyric', '#btn-chord-symbol', '#btn-props', '#btn-settings',
  '#btn-zoom-in', '#btn-zoom-out', '#btn-help', '#language-select', '#btn-view-level', '#btn-cresc', '#btn-dim', '#btn-measure-insert', '#btn-measure-delete',
  '#dur-buttons [data-i="1"]', '#dur-buttons [data-i="2"]', '#dur-buttons [data-i="3"]', '#dur-buttons [data-i="4"]', '#dur-buttons [data-i="5"]', '[data-dyn="pp"]', '[data-dyn="mf"]', '[data-dyn="ff"]', '[data-artic="staccato"]'];
const HIDDEN_IN_BASIC = ['#btn-gliss', '#btn-arpeggio', '#btn-tremolo', '#btn-trill', '#btn-ottava-up', '#btn-rehearsal', '#btn-staff-text', '#btn-break-page',
  '#btn-break-section', '#btn-mixer', '#btn-navigator', '#btn-timeline', '#btn-hide-empty', '#btn-shortcuts', '#swing-select', '#btn-midi', '#midi-select',
  '#btn-speedy', '#voice-buttons', '#view-select', '#page-mode', '#btn-grace'];

// ---------------------------------------------------------------- ① 기본값
test('P9-1 기본값은 "고급": 아무것도 숨기지 않아서 분류를 모르던 때의 화면과 조작 요소 수가 같다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  assert.deepEqual(await page.evaluate(() => ({ level: SF.viewLevel.get(), view: document.documentElement.dataset.view, stored: localStorage.getItem('sf.viewLevel') })),
    { level: 'advanced', view: 'advanced', stored: null }, '처음 방문: 고급이고 아직 저장하지 않는다');
  const button = await page.evaluate(() => { const b = document.getElementById('btn-view-level'); return b && { pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim(), tag: b.tagName, inMore: !!b.closest('.more-group') }; });
  assert.deepEqual(button, { pressed: 'false', text: '기본 보기', tag: 'BUTTON', inMore: true });
  const withTiers = (await collectControls(page)).filter(c => !c.inDialog).filter(c => c.visible).length;
  // 분류 표시를 전부 지우고(= P9-1 이전 화면) 다시 센다
  await page.evaluate(() => { document.documentElement.removeAttribute('data-view'); document.querySelectorAll('[data-tier]').forEach(e => e.removeAttribute('data-tier')); });
  const original = (await collectControls(page)).filter(c => !c.inDialog).filter(c => c.visible).length;
  assert.equal(withTiers, original, '고급 보기에서 보이는 조작 요소 수가 분류 이전과 같다');
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- ② 기본 보기
test('P9-1 기본 보기: 전환 단추 → 상태·저장·분류대로 숨김, 핵심 조작은 그대로, 고급으로 돌아오면 전부 복원', { skip, timeout: 180000 }, async t => {
  const { page, errors } = await open(t);
  await selectFirstNote(page);
  const advanced = await page.evaluate(() => [...document.querySelectorAll('[data-tier]')].map(e => e.dataset.tier));
  assert.ok(advanced.length >= 25, `분류 표시가 붙은 요소 ${advanced.length}개`);
  assert.ok(advanced.every(v => v === 'advanced' || v === 'rare'), `알 수 없는 tier: ${[...new Set(advanced)]}`);
  const before = (await collectControls(page)).filter(c => !c.inDialog && c.visible);
  await page.click('#btn-view-level');
  await settle(page);
  const state = await page.evaluate(() => ({
    view: document.documentElement.dataset.view, stored: localStorage.getItem('sf.viewLevel'), level: SF.viewLevel.get(),
    pressed: document.getElementById('btn-view-level').getAttribute('aria-pressed'), title: document.getElementById('btn-view-level').title
  }));
  assert.deepEqual({ ...state, title: undefined }, { view: 'basic', stored: 'basic', level: 'basic', pressed: 'true', title: undefined });
  assert.match(state.title, /켜짐/, '켜진 상태를 title에도 알린다');
  // 분류 표시가 붙은 모든 요소가 실제로 display:none
  const notHidden = await page.evaluate(() => [...document.querySelectorAll('[data-tier="advanced"],[data-tier="rare"]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id || e.className || e.tagName));
  assert.deepEqual(notHidden, [], '기본 보기에서 숨겨지지 않은 고급·드묾 요소');
  const after = (await collectControls(page)).filter(c => !c.inDialog && c.visible);
  assert.ok(after.length < before.length - 25, `조작 요소 ${before.length} → ${after.length}: 25개 넘게 줄어야 한다`);
  assert.ok(after.length >= 40, `조작 요소가 너무 많이 사라졌다: ${after.length}`);
  for (const sel of ESSENTIAL) assert.equal(await visibleOf(page, sel), true, `${sel}: 기본 보기에서도 보여야 한다`);
  for (const sel of HIDDEN_IN_BASIC) assert.equal(await visibleOf(page, sel), false, `${sel}: 기본 보기에서는 숨겨야 한다`);
  // 고급으로 돌아오면 처음과 같은 요소가 보인다
  await page.click('#btn-view-level');
  await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'advanced');
  assert.equal(await page.evaluate(() => document.getElementById('btn-view-level').getAttribute('aria-pressed')), 'false');
  const restored = (await collectControls(page)).filter(c => !c.inDialog && c.visible);
  assert.equal(restored.length, before.length, '고급으로 돌아오면 같은 수가 보인다');
  assert.deepEqual(errors, []);
});

test('P9-1 분류표대로: 기본 요소는 보기를 바꿔도 그대로, 고급·드묾은 기본 보기에서만 사라지고, 기본 보기가 새로 보이게 하는 것은 없다', { skip, timeout: 180000 }, async t => {
  const { page } = await open(t);
  await openForInventory(page, URL_);
  const { controls, counts } = await collectInventory(page);
  const outside = controls.filter(c => !c.inDialog);
  for (const c of outside) {
    const id = `${c.region} ${c.ref} "${c.label}"`;
    if (c.tier === 'basic') assert.equal(c.visibleBasic, c.visibleAdvanced, `${id}: 기본 요소는 보기를 바꿔도 같아야 한다`);
    else assert.equal(c.visibleBasic, false, `${id}: ${c.tier}는 기본 보기에서 숨는다`);
    if (!c.visibleAdvanced) assert.equal(c.visibleBasic, false, `${id}: 기본 보기가 숨은 것을 보이게 하면 안 된다`);
  }
  assert.ok(counts.tiers.advanced + counts.tiers.rare >= 25, `분류된 고급·드묾 ${counts.tiers.advanced + counts.tiers.rare}개`);
  assert.ok(counts.tiers.rare >= 1 && counts.tiers.advanced >= 20);
  assert.ok(counts.visibleBasic < counts.visibleAdvanced);
  // 대화상자 안은 보기와 상관없이 같다(닫혀 있으니 둘 다 보이지 않음)
  for (const c of controls.filter(x => x.inDialog)) assert.equal(c.tier, 'basic', `${c.ref}: 대화상자 안은 분류 대상이 아니다`);
});

// ---------------------------------------------------------------- ③ 저장·새로 고침
test('P9-1 새로 고쳐도 유지되고, 저장소가 막혀도 던지지 않고 이번 방문에서는 바뀐다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  await page.click('#btn-view-level');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  assert.deepEqual(await page.evaluate(() => ({ view: document.documentElement.dataset.view, pressed: document.getElementById('btn-view-level').getAttribute('aria-pressed') })), { view: 'basic', pressed: 'true' });
  assert.equal(await visibleOf(page, '#btn-gliss'), false);
  await page.click('#btn-view-level');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'advanced');
  assert.deepEqual(errors, []);

  const blocked = await open(t, {
    init: () => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === 'sf.viewLevel') throw new DOMException('blocked', 'SecurityError'); return get.call(this, k); };
      Storage.prototype.setItem = function (k, v) { if (k === 'sf.viewLevel') throw new DOMException('quota', 'QuotaExceededError'); return set.call(this, k, v); };
    }
  });
  assert.equal(await blocked.page.evaluate(() => document.documentElement.dataset.view), 'advanced', '읽기가 막혀도 기본값');
  await blocked.page.click('#btn-view-level');
  assert.equal(await visibleOf(blocked.page, '#btn-gliss'), false, '저장은 못 해도 이번 방문에서는 바뀐다');
  assert.deepEqual(blocked.errors, []);
});

test('P9-1 저장된 기본 보기는 첫 화면이 그려지기 전에(load 시점에) 이미 적용돼 있다', { skip, timeout: 120000 }, async t => {
  const { page } = await open(t, {
    init: () => {
      try { localStorage.setItem('sf.viewLevel', 'basic'); } catch (e) { /* 아래에서 확인 */ }
      document.addEventListener('DOMContentLoaded', () => { window.__atDcl = { view: document.documentElement.dataset.view, tagged: document.querySelectorAll('[data-tier]').length }; });
      window.addEventListener('load', () => { window.__atLoad = { view: document.documentElement.dataset.view, tagged: document.querySelectorAll('[data-tier]').length }; });
    }
  });
  const at = await page.evaluate(() => ({ dcl: window.__atDcl, load: window.__atLoad }));
  assert.equal(at.load.view, 'basic');
  assert.ok(at.load.tagged >= 25, `load 시점에 분류 표시 ${at.load.tagged}개`);
  assert.equal(at.dcl.view, 'basic', 'DOMContentLoaded 시점에도 적용(스크립트가 동기로 init한다)');
  assert.ok(at.dcl.tagged >= 10, `DOMContentLoaded 시점에 분류 표시 ${at.dcl.tagged}개`);
});

// ---------------------------------------------------------------- ④ 숨긴 기능은 그대로 쓸 수 있다
test('P9-1 숨긴 기능: 새 단축키·F11·F12·명령 팔레트로 기본 보기에서도 열린다(입력칸에서는 안 열림)', { skip, timeout: 180000 }, async t => {
  const { page, errors } = await open(t);
  await page.click('#btn-view-level');
  const isOpen = id => page.evaluate(i => document.getElementById(i).open, id);
  const press = async (keys, dialog) => {
    await page.focus('#canvas');
    await page.keyboard.press(keys);
    await page.waitForFunction(i => document.getElementById(i).open, dialog);
    await page.keyboard.press('Escape');
    await page.waitForFunction(i => !document.getElementById(i).open, dialog);
  };
  assert.equal(await visibleOf(page, '#btn-timeline'), false);
  await press('Alt+Shift+T', 'dlg-timeline');
  await press('Alt+Shift+N', 'dlg-navigator');
  await press('F11', 'dlg-timeline');
  await press('F12', 'dlg-navigator');
  // 입력칸에서는 열리지 않는다(기존 규칙)
  await settle(page);                                  // 방금 닫은 대화상자가 초점을 돌려주는 일이 끝난 뒤에 입력칸으로 옮긴다
  await page.focus('#tempo-input');
  await settle(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tempo-input', '시험 준비: 초점이 입력칸에 있어야 한다');
  await page.keyboard.press('Alt+Shift+T');
  await settle(page);
  assert.equal(await isOpen('dlg-timeline'), false, '입력칸에 초점이 있으면 단축키는 동작하지 않는다');
  // 명령 팔레트: 숨긴 팔레트 단추(글리산도)와 숨긴 위쪽 줄 단추(믹서)
  const run = async text => {
    await page.focus('#canvas');
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#dlg-command[open]');
    await page.fill('#cmd-input', text);
    // 입력 직후에는 걸러지기 전 목록이 남아 있을 수 있다 — 첫 항목이 검색어를 담을 때까지 기다린다
    await page.waitForFunction(q => document.querySelector('#cmd-list .cmd-item')?.textContent.includes(q), text);
    const labels = await page.$$eval('#cmd-list .cmd-item', els => els.map(e => e.textContent));
    await page.click('#cmd-list .cmd-item');
    return labels;
  };
  await page.evaluate(() => { window.__gliss = 0; document.getElementById('btn-gliss').addEventListener('click', () => { window.__gliss++; }); });
  const labels = await run('글리산도');
  assert.ok(labels.some(l => l.includes('글리산도')), `명령 팔레트에 글리산도: ${labels}`);
  assert.equal(await page.evaluate(() => window.__gliss), 1, '숨긴 단추가 명령으로 눌린다');
  await run('믹서');
  await page.waitForFunction(() => document.getElementById('dlg-mixer').open);
  await page.keyboard.press('Escape');
  // 명령 목록에 같은 기능이 두 번 나오지 않는다(타임라인·내비게이터는 키맵 명령이 이미 있다), 회원 단추(탈퇴·관리자)는 명령이 되지 않는다
  const count = async (text, expected) => {
    await page.focus('#canvas');
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#dlg-command[open]');
    await page.fill('#cmd-input', text);
    await page.waitForFunction(n => document.querySelectorAll('#cmd-list .cmd-item').length === n, expected);   // 걸러진 뒤의 목록을 기다린다
    const items = await page.$$eval('#cmd-list .cmd-item', els => els.map(e => e.textContent.trim()));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('dlg-command').open);
    return items;
  };
  assert.equal((await count('타임라인', 1)).length, 1, '타임라인 명령은 하나');
  assert.equal((await count('내비게이터', 1)).length, 1, '내비게이터 명령은 하나');
  assert.deepEqual(await count('탈퇴', 0), [], '회원 탈퇴는 명령으로 만들지 않는다(기능 스위치 뒤)');
  assert.deepEqual(await count('관리자', 0), [], '관리자 페이지는 명령으로 만들지 않는다');
  // 보기 전환도 명령으로 된다
  await run('기본 보기');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'advanced', '명령으로도 전환(기본 → 고급)');
  assert.deepEqual(errors, []);
});

test('P9-1 단축키 표시: 명령 팔레트·단축키 창·툴바 title은 Alt+Shift+T·N을 보여 주고 F키는 보조로 같이 적힌다', { skip, timeout: 120000 }, async t => {
  const { page } = await open(t);
  await page.focus('#canvas');
  await page.keyboard.press('Control+Shift+P');
  await page.fill('#cmd-input', '타임라인');
  const cmd = await page.$$eval('#cmd-list .cmd-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(cmd.some(x => x.includes('Alt+Shift+T') && !x.includes('F11')), `명령 팔레트: ${cmd}`);
  await page.keyboard.press('Escape');
  const rows = await page.$$eval('#help-shortcuts .shortcut-row', els => Object.fromEntries(els.map(e => [e.dataset.shortcut, e.querySelector('kbd').textContent])));
  assert.equal(rows.timeline, 'Alt+Shift+T / F11');
  assert.equal(rows.navigator, 'Alt+Shift+N / F12');
  const titles = await page.evaluate(() => ({ nav: document.getElementById('btn-navigator').title, time: document.getElementById('btn-timeline').title }));
  assert.deepEqual(titles, { nav: '내비게이터 (Alt+Shift+N)', time: '타임라인 (Alt+Shift+T)' });
  await page.evaluate(() => SF.i18n.setLanguage('en'));
  assert.deepEqual(await page.evaluate(() => ({ nav: document.getElementById('btn-navigator').title, time: document.getElementById('btn-timeline').title })),
    { nav: 'Navigator (Alt+Shift+N)', time: 'Timeline (Alt+Shift+T)' });
});

// ---------------------------------------------------------------- ⑤ 키보드
test('P9-1 팔레트 한 칸 탭: 숨긴 단추가 있어도 모음마다 탭으로 들어가는 단추가 정확히 하나이고, 화살표는 보이는 단추만 돈다', { skip, timeout: 180000 }, async t => {
  const { page, errors } = await open(t);
  const tabStops = () => page.evaluate(() => {
    const hiddenByView = b => document.documentElement.dataset.view === 'basic' && !!b.closest('[data-tier="advanced"],[data-tier="rare"]');
    return [...document.querySelectorAll('.palette-group')].map(g => {
      const shown = [...g.querySelectorAll('button')].filter(b => !hiddenByView(b));
      return { id: g.id, hidden: g.hidden, shown: shown.length, stops: shown.filter(b => b.tabIndex === 0).map(b => b.id || b.dataset.dyn || b.dataset.artic || b.className), first: shown[0] && (shown[0].id || shown[0].dataset.dyn || shown[0].dataset.artic || shown[0].className),
        hiddenStops: [...g.querySelectorAll('button')].filter(b => hiddenByView(b) && b.tabIndex === 0).length };
    });
  });
  for (const level of ['advanced', 'basic', 'advanced', 'basic']) {
    await page.evaluate(l => SF.viewLevel.set(l), level);
    await settle(page);
    for (const g of await tabStops()) {
      if (g.shown === 0) { assert.equal(g.hidden, true, `${level} ${g.id}: 보이는 단추가 없는 모음은 숨긴다`); continue; }
      assert.equal(g.hidden, false, `${level} ${g.id}`);
      assert.equal(g.stops.length, 1, `${level} ${g.id}: 탭으로 들어가는 단추 ${g.stops}`);
      assert.equal(g.stops[0], g.first, `${level} ${g.id}: 첫 번째로 보이는 단추가 탭 자리`);
      assert.equal(g.hiddenStops, 0, `${level} ${g.id}: 숨긴 단추가 탭 자리를 차지하면 안 된다`);
    }
  }
  // 화살표: 기본 보기의 기호 모음에서 보이는 단추만 돈다
  await page.evaluate(() => SF.viewLevel.set('basic'));
  await settle(page);
  const visible = await page.$$eval('#palette-symbols button', els => els.filter(b => b.getClientRects().length).map(b => b.id || b.dataset.artic));
  assert.ok(visible.length >= 3, `기호 모음에 보이는 단추 ${visible}`);
  await page.focus(`#palette-symbols [data-artic="${visible[0]}"], #palette-symbols #${visible[0]}`);
  const seen = [];
  for (let i = 0; i < visible.length; i++) {
    seen.push(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.artic));
    await page.keyboard.press('ArrowRight');
  }
  assert.deepEqual(seen, visible, '오른쪽 화살표는 보이는 단추를 차례로 돌고 숨긴 단추는 건너뛴다');
  assert.equal(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.artic), visible[0], '한 바퀴 돌아 처음으로');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.artic), visible.at(-1));
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.artic), visible[0]);
  assert.deepEqual(errors, []);
});

test('P9-1 빈 모음: 모음 안의 모든 단추가 숨겨지면 모음과 모바일 탭도 같이 숨고, 쓰던 탭이 사라지면 보이는 탭으로 옮긴다', { skip, timeout: 180000 }, async t => {
  const { page, errors } = await open(t, { width: 390, height: 800 });
  await page.evaluate(() => { document.getElementById('palette-text').dataset.tier = 'advanced'; });
  await page.click('#palette-tab-text');
  assert.equal(await page.evaluate(() => document.getElementById('palette-text').classList.contains('active')), true, '고급 보기에서는 그대로 열린다');
  await page.evaluate(() => SF.viewLevel.set('basic'));
  await settle(page);
  const state = await page.evaluate(() => ({
    tabHidden: document.getElementById('palette-tab-text').hidden, panelHidden: document.getElementById('palette-text').hidden,
    active: [...document.querySelectorAll('.palette-group.active')].map(p => p.id), selected: [...document.querySelectorAll('.palette-tab')].filter(b => b.getAttribute('aria-selected') === 'true' && !b.hidden).map(b => b.id)
  }));
  assert.equal(state.tabHidden, true);
  assert.equal(state.panelHidden, true);
  assert.equal(state.active.length, 1, `열려 있는 모음은 하나: ${state.active}`);
  assert.notEqual(state.active[0], 'palette-text');
  assert.equal(await anyVisible(page, `#${state.active[0]} button`), true, '옮겨 간 모음에는 보이는 단추가 있다');
  // 모든 보이는 탭을 눌러 보면 열린 모음마다 보이는 단추가 있다
  const tabs = await page.$$eval('.palette-tab', els => els.filter(b => b.getClientRects().length).map(b => b.id));
  assert.ok(tabs.length >= 4 && !tabs.includes('palette-tab-text'), `보이는 탭: ${tabs}`);
  for (const id of tabs) {
    await page.click(`#${id}`);
    const panel = await page.evaluate(i => document.getElementById(i).getAttribute('aria-controls'), id);
    assert.equal(await anyVisible(page, `#${panel} button`), true, `${id} → #${panel}에 보이는 단추가 있어야 한다`);
  }
  await page.evaluate(() => SF.viewLevel.set('advanced'));
  await settle(page);
  assert.equal(await page.evaluate(() => ({ tab: document.getElementById('palette-tab-text').hidden, panel: document.getElementById('palette-text').hidden })).then(x => x.tab || x.panel), false, '고급으로 돌아오면 다시 보인다');
  assert.deepEqual(errors, []);
});

test('P9-1 메뉴 ↑↓: 기본 보기의 파일 메뉴에서 숨긴 항목에는 초점이 가지 않고 모든 보이는 항목에 닿는다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  await page.click('#btn-view-level');
  await page.focus('#btn-file');
  await page.keyboard.press('ArrowDown');            // 키보드로 열면 첫 항목에 초점이 간다(메뉴 단추의 기본 동작)
  await page.waitForSelector('#file-menu:popover-open');
  await page.waitForFunction(() => document.activeElement?.closest?.('#file-menu'));   // 열린 직후 한 박자 뒤에 첫 항목으로 간다
  assert.equal(await visibleOf(page, '#file-menu [data-act="save-legacy"]'), false, '구버전 호환 저장은 기본 보기에서 숨긴다');
  // 항목 이름표: data-act가 없는 항목(예제 악보)도 있어서 글자까지 합쳐 구분한다
  // menus.js가 ↑↓로 오가는 항목과 같은 집합(menuitem·menuitemcheckbox·menuitemradio)을 이름표로 만든다
  const visible = await page.$$eval('#file-menu [role="menuitem"],#file-menu [role="menuitemcheckbox"],#file-menu [role="menuitemradio"]',
    els => els.filter(e => e.getClientRects().length).map(e => (e.dataset.act || e.id || e.tagName) + '|' + e.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(visible.some(x => x.startsWith('save|')) && visible.some(x => x.startsWith('open|')) && !visible.some(x => x.startsWith('save-legacy|')));
  assert.equal(new Set(visible).size, visible.length, '시험 준비: 이름표가 겹치지 않는다');
  const seen = [];
  for (let i = 0; i < visible.length + 2; i++) {
    const now = await page.evaluate(() => { const e = document.activeElement; return (e.dataset.act || e.id || e.tagName) + '|' + e.textContent.replace(/\s+/g, ' ').trim(); });
    seen.push(now);
    assert.ok(visible.includes(now), `초점이 숨긴 항목 ${now}에 갔다`);
    await page.keyboard.press('ArrowDown');
  }
  assert.deepEqual([...new Set(seen)].sort(), [...visible].sort(), '보이는 모든 항목에 닿는다');
  assert.deepEqual(errors, []);
});

test('P9-1 초점: 숨겨질 단추에 초점이 있으면 전환 단추로 옮기고, 그렇지 않으면 초점을 건드리지 않는다', { skip, timeout: 120000 }, async t => {
  const { page } = await open(t);
  await page.focus('#btn-gliss');
  await page.evaluate(() => SF.viewLevel.set('basic'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-view-level', '숨겨진 단추의 초점은 전환 단추로');
  await page.evaluate(() => SF.viewLevel.set('advanced'));
  await page.focus('#btn-gliss');
  await page.evaluate(() => SF.viewLevel.set('advanced'));            // 이미 고급인 채로 다시 고급 — 아무것도 숨겨지지 않으니 초점은 그대로
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-gliss', '고급 보기에서는 초점을 옮기지 않는다');
  await page.focus('#btn-zoom-in');   // 되돌리기는 처음엔 꺼져 있어 초점이 안 간다 — 늘 켜져 있는 기본 요소를 쓴다
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-zoom-in', '시험 준비: 초점이 실제로 갔는지');
  await page.evaluate(() => SF.viewLevel.set('basic'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-zoom-in', '기본 요소에 있던 초점은 그대로');
  await page.focus('#btn-view-level');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => ({ id: document.activeElement.id, view: document.documentElement.dataset.view })).then(x => x.id), 'btn-view-level', '키보드로 눌러도 초점은 단추에 남는다');
});

// ---------------------------------------------------------------- ⑥ 속성 패널
test('P9-1 속성 패널: 음표를 바꿔 고르거나 다시 그려져도 분류가 유지된다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  await page.evaluate(() => SF.viewLevel.set('basic'));
  const cases = ['[data-prop="offsetX"]', '[data-prop="offsetY"]', '[data-prop="velocityOffset"]', '[data-artic-prop="staccato"]'];
  const basicOnes = ['[data-prop="visible"]', '[data-prop="color"]', '[data-prop="dynamic"]'];
  for (const index of [0, 1, 2]) {
    await page.evaluate(i => {
      const ev = SF.core.state.score.measures[0].events[i];
      document.querySelector(`[data-ref="${ev.id}"] .note-hit`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, index);
    await page.waitForSelector('#properties-body [data-prop="visible"]');
    for (const sel of cases) assert.equal(await visibleOf(page, `#properties-body ${sel}`), false, `기본 보기 ${index}번째 음표: ${sel} 숨김`);
    for (const sel of basicOnes) assert.equal(await visibleOf(page, `#properties-body ${sel}`), true, `기본 보기 ${index}번째 음표: ${sel} 보임`);
    // 라벨만 남지 않는다: 숨긴 입력칸 바로 앞의 라벨도 숨는다
    const orphanLabels = await page.evaluate(() => [...document.querySelectorAll('#properties-body label')].filter(l => l.getClientRects().length && l.nextElementSibling && !l.nextElementSibling.getClientRects().length).map(l => l.textContent));
    assert.deepEqual(orphanLabels, [], '입력칸이 숨었는데 라벨만 남았다');
  }
  await page.evaluate(() => SF.viewLevel.set('advanced'));
  for (const sel of cases) assert.equal(await visibleOf(page, `#properties-body ${sel}`), true, `고급 보기: ${sel} 보임`);
  assert.deepEqual(errors, []);
});

test('P9-1 처음부터 기본 보기: 저장된 수준이 기본 보기이면 팔레트 탭 순서·빈 모음도 첫 화면부터 맞다(전환 없이)', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t, { width: 390, height: 800, init: () => { try { localStorage.setItem('sf.viewLevel', 'basic'); } catch (e) { /* */ } } });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'basic');
  // 모음마다 탭으로 들어가는 단추는 정확히 하나이고 숨긴 단추가 아니다
  const stops = await page.evaluate(() => [...document.querySelectorAll('.palette-group')].map(panel => {
    const stopsIn = [...panel.querySelectorAll('button')].filter(b => b.tabIndex === 0);
    return { id: panel.id, hidden: panel.hidden, stops: stopsIn.length, stopHidden: stopsIn.some(b => b.closest('[data-tier="advanced"],[data-tier="rare"]')) };   // 좁은 화면은 쓰지 않는 탭의 모음이 통째로 가려지므로 크기 대신 분류로 본다
  }));
  for (const group of stops.filter(g => !g.hidden)) { assert.equal(group.stops, 1, `${group.id}: 탭 단추 하나`); assert.equal(group.stopHidden, false, `${group.id}: 탭 단추가 숨겨져 있다`); }
  // 글리산도 같은 숨긴 단추는 탭 순서에 없다
  assert.equal(await page.evaluate(() => document.getElementById('btn-gliss').tabIndex), -1);
  assert.deepEqual(errors, []);
});

test('P9-1 init()은 여러 번 불러도 안전하다: 전환 단추가 한 번만 묶이고 data-view가 어긋나도 다시 맞춘다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  await page.evaluate(() => { SF.viewLevel.init(); SF.viewLevel.init(); SF.viewLevel.init(); });   // 앱이 한 번, 여기서 세 번 — 단추에 묶인 것이 짝수 개면 전환이 상쇄되어 못 잡으니 일부러 총 4번
  await page.click('#btn-view-level');
  assert.equal(await page.evaluate(() => SF.viewLevel.get()), 'basic', '두 번 init해도 한 번 눌러 한 번만 바뀐다');
  await page.evaluate(() => { document.documentElement.dataset.view = 'stale'; SF.viewLevel.init(); });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'basic');
  assert.deepEqual(errors, []);
});

test('P9-1 숨김 규칙은 아이디 선택자의 display 규칙에 지지 않는다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  await page.addStyleTag({ content: '#btn-gliss, #btn-rehearsal, #swing-select { display: inline-flex; }' });
  await page.evaluate(() => SF.viewLevel.set('basic'));
  for (const id of ['btn-gliss', 'btn-rehearsal', 'swing-select']) assert.equal(await visibleOf(page, `#${id}`), false, `#${id}는 더 센 선택자가 있어도 숨는다`);
  assert.deepEqual(errors, []);
});

test('P9-1 감시: 나중에 생기는 요소도 분류된다(파일 메뉴·팔레트 막대·위쪽 줄)', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  const cases = [
    ['#file-menu', '<button type="button" role="menuitem" data-act="save-legacy" id="probe-file">시험</button>'],   // 위쪽 줄 감시가 덮는다(파일 메뉴는 .topbar 안)
    ['.palette-bar', '<button type="button" data-artic="marcato" id="probe-palette">시험</button>'],
    ['.topbar', '<label class="multi-rest" id="probe-top">시험</label>']
  ];
  for (const [host, html] of cases) {
    await page.evaluate(([h, markup]) => document.querySelector(h).insertAdjacentHTML('beforeend', markup), [host, html]);
    const id = html.match(/id="([^"]+)"/)[1];
    await page.waitForFunction(i => document.getElementById(i)?.dataset.tier === 'advanced', id);
  }
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- ⑦ 좁은 화면
test('P9-1 좁은 화면(390px): 전환 단추가 "⋯ 더보기" 안에 있고 눌러진다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t, { width: 390, height: 800 });
  assert.equal(await visibleOf(page, '#btn-view-level'), false, '더보기를 열기 전에는 위쪽 줄에 보이지 않는다');
  await page.click('#btn-more');
  await page.waitForSelector('#more-menu:popover-open');
  assert.equal(await visibleOf(page, '#more-menu #btn-view-level'), true);
  await page.click('#more-menu #btn-view-level');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'basic');
  assert.equal(await page.evaluate(() => document.getElementById('btn-view-level').getAttribute('aria-pressed')), 'true');
  await page.keyboard.press('Escape');
  // 모바일 빠른 막대의 단추는 모두 기본 요소라 보기와 상관없이 같은 8개
  const quick = await page.$$eval('.palette-quick button', els => els.filter(b => b.getClientRects().length).length);
  assert.equal(quick, 8);
  // 좁은 화면에서도 Alt+Shift+T는 "데스크톱에서 사용할 수 있어요"
  await page.focus('#canvas');
  await page.keyboard.press('Alt+Shift+T');
  await page.waitForFunction(() => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent === '타임라인은 데스크톱에서 사용할 수 있어요'; });
  assert.equal(await page.evaluate(() => document.getElementById('dlg-timeline').open), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, '옆으로 밀리지 않는다');
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- ⑧ 한글 라벨·영어
const LABELS = {
  '#btn-gliss': ['글리산도', 'Glissando'], '#btn-arpeggio': ['아르페지오', 'Arpeggio'], '#btn-tremolo': ['트레몰로', 'Tremolo'],
  '#btn-chord-symbol': ['코드', 'Chord'], '#btn-rehearsal': ['리허설', 'Rehearsal'], '#btn-staff-text': ['스태프 텍스트', 'Staff text'],
  '#btn-break-page': ['쪽나눔', 'Page break'], '#btn-break-section': ['구역나눔', 'Section break'],
  '[data-voice="1"]': ['성부 1', 'Voice 1'], '[data-voice="4"]': ['성부 4', 'Voice 4'],
  '#btn-navigator': ['내비', 'Nav'], '#btn-timeline': ['타임', 'Time'], '[data-drum="kick"]': ['킥', 'Kick'], '[data-drum="closed-hihat"]': ['닫힌 하이햇', 'Closed HH'],
  '[data-drum="high-tom"]': ['높은 탐', 'High Tom'], '#theme-select option[value="dark"]': ['어두운', 'Dark'], '#btn-view-level': ['기본 보기', 'Basic view']
};
test('P9-1 한글 라벨: 한국어에서는 한글, 영어로 바꾸면 영어이고 한글이 섞이지 않는다', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  const read = () => page.evaluate(map => Object.fromEntries(Object.keys(map).map(sel => [sel, (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim()])), LABELS);
  const ko = await read();
  for (const [sel, [koText]] of Object.entries(LABELS)) assert.equal(ko[sel], koText, `ko ${sel}`);
  await page.evaluate(() => SF.i18n.setLanguage('en'));
  await settle(page);
  const en = await read();
  for (const [sel, [, enText]] of Object.entries(LABELS)) { assert.equal(en[sel], enText, `en ${sel}`); assert.doesNotMatch(en[sel], /[가-힣]/, sel); }
  await selectFirstNote(page);
  await page.waitForFunction(() => /· Voice \d+ ·/.test(document.getElementById('properties-body').textContent));   // 선택이 패널에 반영될 때까지
  // 악보 안의 글자는 번역하지 않는다: 보표 이름("피아노")은 위치 줄에서 떼고, 화음 음 목록의 한글 계이름("1. 솔")은 선택 목록에서 뺀다
  // (후자는 ui-v3.js가 언어와 상관없이 ko 이름을 쓰는 이전부터의 동작이라 이번 단계에서 건드리지 않았다 — docs/REFACTOR_LOG.md P9-1 "남은 것").
  const panel = await page.evaluate(() => {
    const body = document.getElementById('properties-body').cloneNode(true);
    body.querySelectorAll('#chord-note-select option').forEach(option => option.remove());
    body.querySelectorAll('span').forEach(span => { span.textContent = span.textContent.replace(/^.*?( · Voice)/, '$1'); });
    return body.textContent.replace(/\s+/g, ' ');
  });
  assert.match(panel, /· Voice \d+ · Measure \d+/, '위치 줄이 영어로 바뀌었는지');
  assert.doesNotMatch(panel, /[가-힣]/, `영어 속성 패널에 한글이 섞임: ${panel.match(/.{0,20}[가-힣]+.{0,10}/)?.[0]}`);
  assert.deepEqual(await page.evaluate(() => SF.i18n.audit().missingEnglish), [], '영어 줄이 없는 한글 문구');
  assert.deepEqual(errors, []);
});

// 허용 목록: 음악 용어·표준 약어·단축키·음 이름·고유 이름·개발용 문구. 이 밖의 영문만 라벨은 한글화 대상이다.
const ALLOW = [
  [/^ScoreForge$/, '제품 이름'], [/^(KO|EN|MIDI|BPM|PDF|PNG|SVG|MusicXML|A4|Letter)$/, '언어 코드·표준 약어·용지'],
  [/^(pp|p|mp|mf|f|ff|sfz|fp|tr|8va|8vb|15ma|15mb|rit\.|a tempo)$/, '셈여림·꾸밈·옥타브 기호(음악 용어)'],
  [/^(D\.C\.|D\.S\.|D\.C\. al (Fine|Coda)|D\.S\. al (Fine|Coda)|Fine|To Coda|Coda|Segno)$/, '되돌아가기 용어(음악 용어)'],
  [/^[A-G][♯♭#b]?[0-9]$/, '음 이름'], [/^\.[a-z0-9]+(·\.[a-z0-9]+)*$/, '파일 확장자'],
  [/^((Ctrl|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|Arrow(Up|Down|Left|Right)|Enter|Escape|Delete|Backspace|Space|Tab|[-=+<>?,.[\]'/])( \/ ((Ctrl|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|Arrow(Up|Down|Left|Right)|Enter|Escape|Delete|Backspace|Space|Tab|[-=+<>?,.[\]'/]))*$/, '단축키 표기'],
  [/^(Project URL|Publishable key)$/, 'Supabase 설정 용어(관리자·개발자용 대화상자)'], [/^update public\.profiles set role = 'admin'/, '관리자 SQL 예시(복사용 코드)'],
  [/^(sb_publishable_\.\.\.|you@example\.com)$/, '입력 예시(placeholder)']
];
test('P9-1 영문 약어 라벨: 한국어 화면에 허용 목록(음악 용어·단축키·음 이름·고유 이름) 밖의 영문만 라벨이 없다', { skip, timeout: 180000 }, async t => {
  const { page, errors } = await open(t);
  await selectFirstNote(page);
  const scan = async () => page.evaluate(() => {
    const found = new Map();
    const add = (kind, raw, where) => {
      const text = raw.trim().replace(/\s+/g, ' ');
      if (!text || /[가-힣]/.test(text) || !/[A-Za-z]/.test(text)) return;
      if (!found.has(text)) found.set(text, { kinds: new Set(), where });
      found.get(text).kinds.add(kind);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode, p = n.parentElement;
      if (p.closest('script,style,svg,#svg-host,kbd,template')) continue;   // kbd = 단축키 표시
      add('text', n.nodeValue, (p.closest('[id]') || {}).id || p.className || p.tagName);
    }
    for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
      if (el.closest('svg,#svg-host')) continue;
      for (const a of ['title', 'aria-label', 'placeholder']) if (el.hasAttribute(a)) add(a, el.getAttribute(a), el.id || el.className || el.tagName);
    }
    return [...found].map(([text, v]) => ({ text, kinds: [...v.kinds].join(','), where: v.where }));
  });
  const stray = [];
  for (const level of ['advanced', 'basic']) {
    await page.evaluate(l => SF.viewLevel.set(l), level);
    // 믹서(Vol·Pan)·설정 같은 대화상자 안도 본다
    await page.evaluate(() => document.getElementById('btn-mixer').click());     // 기본 보기에서는 숨겨진 단추라 마우스 대신 직접 누른다
    await page.waitForFunction(() => document.getElementById('dlg-mixer').open);
    for (const row of await scan()) if (!ALLOW.some(([re]) => re.test(row.text))) stray.push(`${level}: "${row.text}" (${row.kinds}, ${row.where})`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('dlg-mixer').open);
  }
  assert.deepEqual([...new Set(stray)], [], '영문 약어 라벨이 남아 있다');
  assert.deepEqual(errors, []);
});

test('P9-1 테마 알림: 한국어에서는 한글 이름, 영어에서는 영어 이름으로 나온다(이름만 한글로 남지 않는다)', { skip, timeout: 120000 }, async t => {
  const { page, errors } = await open(t);
  const toastText = () => page.evaluate(() => document.querySelector('#toast')?.textContent || '');
  const pick = async (value, expected) => {
    await page.selectOption('#theme-select', value);
    await page.waitForFunction(text => document.querySelector('#toast')?.textContent === text, expected);
  };
  await pick('light', '밝은 UI로 전환했어요');
  await pick('pretty', '예쁜 UI로 전환했어요');
  await page.evaluate(() => SF.i18n.setLanguage('en'));
  await settle(page);
  await pick('cute', 'Switched to Cute UI');
  await pick('dark', 'Switched to Dark UI');
  assert.doesNotMatch(await toastText(), /[가-힣]/);
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- ⑨ 문서
test('P9-1 docs/UI_INVENTORY.md는 실제 화면과 같고, 기본 보기 조작 요소 수가 문서에 적힌 숫자와 같다', { skip, timeout: 180000 }, async t => {
  const { page } = await open(t);
  await openForInventory(page, URL_);
  const inventory = await collectInventory(page);
  const doc = await readFile(new URL('../docs/UI_INVENTORY.md', import.meta.url), 'utf8');
  assert.equal(doc, renderInventory(inventory) + '\n', 'docs/UI_INVENTORY.md가 화면과 다르다 — node tests/tools/gen-ui-inventory.mjs 로 다시 만든다');
  assert.match(doc, new RegExp(`\\*\\*기본 보기에서 보이는 것\\*\\* \\| \\*\\*${inventory.counts.visibleBasic}\\*\\*`));
  assert.match(doc, new RegExp(`\\*\\*화면 조작 요소\\*\\*\\(대화상자 밖\\) \\| ${inventory.counts.outside} `));
});
