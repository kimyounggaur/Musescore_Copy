// P6-1: 파일 메뉴를 브라우저의 Popover 기능으로 바꾼다 — 순수 계산(위치)과 마크업·연결 구조를 확인한다.
//  - 위치 계산은 CSS anchor positioning에 기대지 않고 버튼 아래에 놓되 화면 밖으로 나가지 않게 한다.
//  - 메뉴 항목은 키보드로 닿는 <button role="menuitem">이고, 열기·닫기는 app.js가 손으로 하지 않고 SF.menus가 한다.
// 실제 화면에서의 동작(열림·잘림·키보드·바깥 클릭)은 tests/menus-browser.test.mjs가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const context = vm.createContext({ console });
context.window = context;
context.SF = {};
vm.runInContext(read('js/menus.js'), context, { filename: 'menus.js' });
const { menus } = context.SF;

// vm 안에서 만든 객체는 realm이 달라 deepEqual이 엄격하게 구분하므로 JSON으로 맞춘다
const plain = value => JSON.parse(JSON.stringify(value));

test('P6-1 위치: 버튼 바로 아래(4px), 왼쪽을 버튼에 맞춘다', () => {
  assert.deepEqual(plain(menus.placement({ left: 100, bottom: 40 }, { width: 230 }, { width: 1200, height: 800 })), { left: 100, top: 44, maxHeight: 748 });
});

test('P6-1 위치: 오른쪽 끝을 넘으면 화면 안(가장자리 8px)으로 당겨 온다', () => {
  const p = plain(menus.placement({ left: 1100, bottom: 40 }, { width: 230 }, { width: 1200, height: 800 }));
  assert.equal(p.left, 1200 - 230 - 8);
});

test('P6-1 위치: 왼쪽으로 나가거나 메뉴가 화면보다 넓어도 왼쪽 가장자리(8px)를 지킨다', () => {
  assert.equal(menus.placement({ left: -5, bottom: 40 }, { width: 230 }, { width: 1200, height: 800 }).left, 8);
  assert.equal(menus.placement({ left: 40, bottom: 40 }, { width: 400 }, { width: 360, height: 640 }).left, 8);
});

test('P6-1 위치: 최대 높이는 버튼 아래 남은 화면 높이(아래 8px 남김)이고, 너무 작아져도 120px은 준다', () => {
  assert.equal(menus.placement({ left: 10, bottom: 100.4 }, { width: 200 }, { width: 375, height: 667 }).maxHeight, 667 - 104 - 8);
  assert.equal(menus.placement({ left: 10, bottom: 100 }, { width: 200 }, { width: 375, height: 150 }).maxHeight, 120);
});

test('P6-1 위치: 소수 좌표는 정수 픽셀로 맞춘다', () => {
  const p = plain(menus.placement({ left: 10.6, bottom: 31.7 }, { width: 200 }, { width: 800, height: 600 }));
  assert.deepEqual(p, { left: 11, top: 36, maxHeight: 556 });
});

test('P6-1 supported(): Popover를 모르는 환경(Node)에서는 false', () => {
  assert.equal(menus.supported(), false);
});

// ───────── 마크업 ─────────
const html = read('index.html');
const fileMenu = html.match(/<div id="file-menu"[^>]*>([\s\S]*?)\n    <\/div>\n  <\/div>/);

test('P6-1 마크업: 버튼은 popovertarget·aria-haspopup, 메뉴는 popover·role="menu"', () => {
  const button = html.match(/<button id="btn-file"[^>]*>/)[0];
  assert.match(button, /popovertarget="file-menu"/);
  assert.match(button, /aria-haspopup="menu"/);
  const menu = html.match(/<div id="file-menu"[^>]*>/)[0];
  assert.match(menu, /\spopover[\s>=]/);
  assert.match(menu, /role="menu"/);
});

test('P6-1 마크업: 파일 메뉴 항목은 모두 <button type="button" role="menuitem" class="mi" data-act>이고 div.mi가 남아 있지 않다', () => {
  assert.ok(fileMenu, '파일 메뉴 블록을 찾았다');
  const body = fileMenu[1];
  assert.equal(/<div class="mi"/.test(body), false, 'div.mi 없음');
  const items = [...body.matchAll(/<button\b[^>]*class="mi"[^>]*>/g)].map(m => m[0]);
  assert.equal(items.length, 13, `파일 메뉴 고정 항목 ${items.length}개 (클라우드·내보내기 항목은 실행 중에 더해진다)`);
  for (const tag of items) {
    assert.match(tag, /type="button"/, tag);
    assert.match(tag, /role="menuitem"/, tag);
    assert.match(tag, /data-act="[a-z-]+"/, tag);
  }
  // data-act 이름은 그대로 — app.js·테스트가 이 값을 쓴다
  const acts = items.map(tag => tag.match(/data-act="([^"]+)"/)[1]);
  for (const act of ['new', 'open', 'recent', 'save', 'musicxml', 'midi', 'print', 'manual-quick', 'manual-user', 'demo-butterfly', 'demo-star', 'demo-airplane', 'demo-rhythm']) assert.ok(acts.includes(act), act);
});

test('P6-1 마크업: menus.js는 app.js보다 먼저 불러온다', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.includes('js/menus.js'));
  assert.ok(scripts.indexOf('js/menus.js') < scripts.indexOf('js/app.js'));
});

// ───────── 연결 ─────────
test('P6-1 연결: app.js는 파일 메뉴를 손으로 여닫지 않고 SF.menus에 맡긴다', () => {
  const app = read('js/app.js');
  assert.equal(/classList\.toggle\("open"\)/.test(app), false, '수동 토글 삭제');
  assert.match(app, /SF\.menus\.setup\(/);
});

test('P6-1 연결: cloud.js가 메뉴에 넣는 항목도 role="menuitem" 버튼이다', () => {
  const cloud = read('js/cloud.js');
  assert.match(cloud, /role.{0,6}menuitem/);
});

// ───────── P6-2 계정 메뉴 ─────────
test('P6-2 API: SF.menus는 open·dock도 내놓는다', () => {
  assert.equal(typeof menus.open, 'function');
  assert.equal(typeof menus.dock, 'function');
});

test('P6-2 마크업: 계정 버튼(#btn-account)은 aria-label·popovertarget을 갖고, #account-menu는 popover이며 처음에는 비어 있다', () => {
  const button = html.match(/<button id="btn-account"[^>]*>/)[0];
  assert.match(button, /aria-label="계정 메뉴"/);
  assert.match(button, /popovertarget="account-menu"/);
  const menu = html.match(/<div id="account-menu"[^>]*>/)[0];
  assert.match(menu, /\spopover[\s>=]/);
  assert.match(menu, /class="menu"/);
  assert.match(html, /<div id="account-menu"[^>]*>\s*<\/div>/, '.authbar는 좁은 화면일 때만 menus.js가 옮겨 넣는다 — 마크업에서는 비어 있다');
});

test('P6-2 마크업: .authbar는 상단바 직계로 계정 버튼 앞에 있고(넓은 화면 배치 유지) role="group"이다', () => {
  const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
  const authbar = header.indexOf('<div class="authbar"'), account = header.indexOf('id="btn-account"'), file = header.indexOf('id="btn-file"');
  assert.ok(authbar > 0 && authbar < account && account < file, '언어 선택 → .authbar → 계정 버튼 → 파일 메뉴 순서');
  assert.match(header.match(/<div class="authbar"[^>]*>/)[0], /role="group"/);
  for (const id of ['auth-status', 'btn-signup', 'btn-member-login', 'btn-admin-login', 'btn-admin-page', 'btn-logout']) assert.match(header, new RegExp(`id="${id}"`), id);
});

test('P6-2 연결: app.js가 .authbar를 500px 이하에서 계정 메뉴로 옮긴다', () => {
  const app = read('js/app.js');
  assert.match(app, /SF\.menus\.setup\(\{ button: "#btn-account"/);
  assert.match(app, /SF\.menus\.dock\(\{[^}]*"\(max-width:\s*500px\)"/);
});

test('P6-2 CSS: 500px 이하에서 .authbar를 통째로 숨기던 규칙이 없고, 계정 버튼은 넓은 화면에서 숨긴다', () => {
  const css = read('css/style.css');
  assert.equal(/\.topbar\s+\.authbar\s*\{[^}]*display:\s*none/.test(css), false, '로그인 버튼이 사라지던 규칙(F-모바일)');
  assert.match(css, /\.account-wrap\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*500px\)[^{]*\{[^]*\.account-wrap\s*\{\s*display:\s*block/);
});

// ───────── P6-3 상단바 정리 ─────────
const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
const groups = [...header.matchAll(/<div class="more-group"[^>]*>([\s\S]*?)<!-- \/more-group -->/g)].map(m => m[1]);
const idsIn = text => [...text.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

test('P6-3 마크업: 더보기 버튼(#btn-more)은 aria-label·popovertarget을 갖고, #more-menu는 popover이며 처음에는 비어 있다', () => {
  const button = html.match(/<button id="btn-more"[^>]*>/)[0];
  assert.match(button, /aria-label="더보기"/);
  assert.match(button, /popovertarget="more-menu"/);
  const menu = html.match(/<div id="more-menu"[^>]*>/)[0];
  assert.match(menu, /\spopover[\s>=]/);
  assert.match(menu, /class="menu"/);
  assert.match(html, /<div id="more-menu"[^>]*>\s*<\/div>/, '묶음은 좁은 화면일 때만 menus.js가 옮겨 넣는다 — 마크업에서는 비어 있다');
});

test('P6-3 마크업: 자주 안 쓰는 컨트롤은 .more-group 3묶음 안에, 핵심 컨트롤은 상단바에 그대로 있다', () => {
  assert.equal(groups.length, 3, '.more-group은 3묶음(테마·언어 / 빠르기~타임라인 / 악기~도움말)');
  const moved = groups.flatMap(idsIn);
  for (const id of ['theme-select', 'language-select', 'tempo-input', 'swing-select', 'btn-mixer', 'staff-select', 'view-select', 'btn-hide-empty',
    'btn-navigator', 'btn-timeline', 'instrument-select', 'btn-piano', 'btn-midi', 'midi-select', 'btn-shortcuts', 'btn-help']) {
    assert.ok(moved.includes(id), `${id}는 .more-group 안`);
  }
  // 핵심 컨트롤: 눌러서 바로 써야 하거나(재생·되돌리기·파일·계정) 기존 브라우저 테스트가 좁은 화면에서 바로 누르는 것(#btn-props)
  for (const id of ['btn-account', 'btn-file', 'btn-settings', 'btn-more', 'btn-undo', 'btn-redo', 'btn-rewind', 'btn-play', 'btn-stop', 'btn-metronome', 'btn-props']) {
    assert.ok(!moved.includes(id), `${id}는 상단바에 남는다`);
    assert.match(header, new RegExp(`id="${id}"`), id);
  }
});

test('P6-3 마크업: 더보기 버튼은 설정 버튼 바로 뒤(첫 줄)에 있고, 묶음은 넓은 화면의 원래 순서를 지킨다', () => {
  const at = text => header.indexOf(text);
  assert.ok(at('id="btn-settings"') < at('id="btn-more"') && at('id="btn-more"') < at('id="btn-undo"'));
  // 원래 순서: 테마·언어 → 계정 → 파일 → … → 빠르기 → 보기 → 속성 → 악기 → 건반 → 도움말
  const order = ['theme-select', 'language-select', 'btn-account', 'btn-file', 'btn-settings', 'btn-undo', 'btn-play', 'tempo-input', 'swing-select', 'btn-mixer',
    'staff-select', 'view-select', 'btn-hide-empty', 'btn-navigator', 'btn-timeline', 'btn-props', 'instrument-select', 'btn-piano', 'btn-midi', 'midi-select', 'btn-shortcuts', 'btn-help'];
  const positions = order.map(id => at(`id="${id}"`));
  assert.ok(positions.every(p => p > 0), '모두 있다');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), '넓은 화면의 배치 순서가 바뀌지 않았다');
});

test('P6-3 연결: app.js가 더보기 메뉴를 만들고 .more-group을 500px 이하에서 옮긴다(선택 컨트롤을 눌러도 닫히지 않게 button만 닫는다)', () => {
  const app = read('js/app.js');
  assert.match(app, /SF\.menus\.setup\(\{ button: "#btn-more", menu: "#more-menu"[^}]*closeOn: "button"/);
  assert.match(app, /SF\.menus\.dock\(\{[^}]*\.more-group[^}]*"\(max-width:\s*500px\)"/);
});

test('P6-3 CSS: .topbar에는 max-height·overflow가 없고(스크롤 상자 아님), 묶음은 넓은 화면에서 display:contents, 더보기 버튼은 500px 이하에서만 보인다', () => {
  const css = read('css/style.css');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }));
  const topbarRules = rules.filter(rule => rule.selector.split(',').some(part => /\.topbar$/.test(part.trim())));
  assert.ok(topbarRules.length > 0);
  for (const rule of topbarRules) {
    assert.equal(/max-height|overflow/.test(rule.body), false, `${rule.selector}: ${rule.body.trim()}`);
  }
  assert.match(css, /\.more-group\s*\{\s*display:\s*contents/);
  assert.match(css, /\.more-wrap\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*500px\)[^{]*\{[^]*\.more-wrap\s*\{\s*display:\s*block/);
  assert.match(css, /@media \(max-width:\s*500px\)[^{]*\{[^]*\.topbar > \.more-group\s*\{\s*display:\s*none/, '스크립트가 옮기기 전 첫 그리기에서 깜박이지 않게');
});

test('P6-3 번역: 더보기·계정 메뉴 문구에 영어가 있다', () => {
  const i18n = read('js/i18n.js');
  assert.match(i18n, /more \| 더보기 \| More/);
  assert.match(i18n, /accountMenu \| 계정 메뉴 \| Account menu/);
});
