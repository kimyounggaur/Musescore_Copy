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
