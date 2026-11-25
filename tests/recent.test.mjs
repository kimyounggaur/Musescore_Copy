// P2-C 최근 작업 창 — 구조·번역·작은 도우미 검사(화면 동작은 tests/recent-browser.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(file, 'utf8');
const strip = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

test('P2-C 구조: recent.js는 HTML 문자열을 넣는 방법을 쓰지 않는다(제목은 사용자 글) — 주석에도 없다', () => {
  const source = read('js/recent.js');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment', 'DOMParser', 'SF.safeHtml', 'setHTML'])
    assert.equal(source.includes(sink), false, sink);
  assert.ok(source.includes('createElement') && source.includes('textContent'));   // 그리기는 DOM API만
});

test('P2-C 구조: 스크립트 순서(session → recent → app), 메뉴 항목·대화상자·메뉴 분기가 있다', () => {
  const html = read('index.html'), app = read('js/app.js');
  const at = name => html.indexOf(`src="js/${name}.js"`);
  assert.ok(at('store') > 0 && at('store') < at('session') && at('session') < at('recent') && at('recent') < at('app'));
  assert.equal((html.match(/data-act="recent"/g) || []).length, 1);
  assert.equal((html.match(/<dialog id="dlg-recent"/g) || []).length, 1);
  for (const id of ['rc-list', 'rc-empty', 'rc-unavailable', 'rc-usage', 'rc-warn']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  assert.match(app, /act === "recent"\) \{\s*SF\.recent\?\.open\(\)/);
  const dialog = html.slice(html.indexOf('<dialog id="dlg-recent"'), html.indexOf('</dialog>', html.indexOf('<dialog id="dlg-recent"')));
  assert.doesNotMatch(dialog, /\son[a-z]+\s*=/i);   // 인라인 이벤트 처리기 없음(CSP)
});

test('P2-C 구조: 토스트의 새 [버튼] 인자를 쓰는 곳은 정해진 두 곳뿐(기존 호출은 그대로)', () => {
  const users = [];
  for (const file of readdirSync('js').filter(f => f.endsWith('.js'))) {
    const count = (strip(read(`js/${file}`)).match(/\baction\s*:\s*\{/g) || []).length;
    if (count) users.push(`${file}:${count}`);
  }
  assert.equal(users.sort().join(), 'app.js:1,session.js:1');   // app.js=공간 부족 안내, session.js=보관 토스트의 되돌리기
  const app = strip(read('js/app.js'));
  assert.match(app, /function toast\(msg, options\)/);
});

function i18n(language) {
  const context = vm.createContext({ console, navigator: { language } });
  context.window = context;
  vm.runInContext(read('js/i18n.js'), context, { filename: 'i18n.js' });
  return context.SF.i18n;
}

test('P2-C i18n: 최근 작업 창·토스트·확인 창의 모든 문구가 영어로 번역되고 한글이 남지 않는다', () => {
  const t = i18n('en-US');
  const literals = [
    '🕘 최근 작업', '자동 보관된 악보', '최근 작업', '되돌리기', '열기', '삭제', '닫기', '취소', '파일로 내려받기', '제목 없음', '지금 열려 있어요', '다른 탭에서 편집 중',
    '지금 열려 있는 악보예요', '지금 열려 있는 악보는 지울 수 없어요', '다른 탭에서 편집 중이라 지울 수 없어요',
    '자동 저장 공간이 부족해요. 쓰지 않는 악보를 지우거나 파일로 내려받아 두세요.', '자동 저장은 이 브라우저에만 남아요. 중요한 악보는 파일로 저장해 두세요.',
    '보관된 악보가 아직 없어요. 악보를 고치면 자동으로 여기에 쌓여요.', '이 브라우저에서는 악보별 자동 보관을 쓸 수 없어요. 파일로 저장해 두세요.',
    '이 기록을 찾지 못했어요 — 이미 지워졌을 수 있어요', '이 기록을 열 수 없어요 — 파일로 내려받아 확인해 보세요', '기록을 지우지 못했어요',
    '이전 악보를 열 수 없어요 — 파일 메뉴의 최근 작업에서 확인해 주세요', '이 악보 기록을 지울까요?', '악보 파일을 내려받았어요',
    '1마디', '12마디', '사용 중 4.4 MB / 약 2.0 GB', '‘나비야’ 기록을 이 브라우저에서 지워요. 파일로 저장해 둔 적이 없다면 되돌릴 수 없어요.',
    '최근 작업 열기 전에 현재 악보를 어떻게 할까요?', '이전 악보로 되돌리기 전에 현재 악보를 어떻게 할까요?',
  ];
  for (const ko of literals) {
    const en = t.translate(ko);
    assert.notEqual(en, ko, `번역이 없다: ${ko}`);
    assert.doesNotMatch(en.replace('나비야', ''), /[가-힣]/, `${ko} → ${en}`);
  }
  assert.equal(t.translate('1마디'), '1 measure');
  assert.equal(t.translate('12마디'), '12 measures');
  assert.equal(t.translate('사용 중 4.4 MB / 약 2.0 GB'), 'Using 4.4 MB of about 2.0 GB');
  assert.equal(t.translate('‘나비야’ 기록을 이 브라우저에서 지워요. 파일로 저장해 둔 적이 없다면 되돌릴 수 없어요.'), '“나비야” will be deleted from this browser. If you never saved it to a file, this can\'t be undone.');
  assert.equal(t.translate('최근 작업 열기 전에 현재 악보를 어떻게 할까요?'), 'What should happen to the current score before you continue? (Open from Recent work)');
  const ko = i18n('ko-KR');
  assert.equal(ko.translate('12마디'), '12마디');   // 한국어 화면은 그대로
});

test('P2-C 도우미: 용량 표시는 B/KB/MB/GB로 읽기 쉽게, 잘못된 값은 빈 문자열', () => {
  const context = vm.createContext({ console, navigator: { language: 'ko-KR' } });
  context.window = context; context.SF = {};
  vm.runInContext(read('js/recent.js'), context, { filename: 'recent.js' });
  const f = context.SF.recent.formatBytes;
  assert.equal(f(0), '0 B'); assert.equal(f(1023), '1023 B'); assert.equal(f(1536), '2 KB');
  assert.equal(f(4.4 * 1024 ** 2), '4.4 MB'); assert.equal(f(2 * 1024 ** 3), '2.0 GB');
  assert.equal(f(-1), ''); assert.equal(f(NaN), ''); assert.equal(f(undefined), '');
  assert.equal(typeof context.SF.recent.open, 'function'); assert.equal(typeof context.SF.recent.onQuota, 'function');
});
