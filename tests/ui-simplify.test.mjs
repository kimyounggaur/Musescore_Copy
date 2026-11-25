// P9-1 화면 복잡도 정리 — Node에서 확인하는 부분(브라우저 없이).
//  ① 단축키: 타임라인·내비게이터는 Alt+Shift+T·Alt+Shift+N이 기본, F11·F12는 보조(키 중복 없음, 한글 입력 상태에서도 같은 문자열)
//  ② SF.viewLevel 논리: 저장값 읽기·쓰기(막혀도 던지지 않음), 잘못된 값 거절, 분류표 모양
//  ③ 소스 규칙: 숨기는 CSS 한 규칙, 스크립트 순서, app.js 줄 수, 영문 약어 라벨이 소스에 남지 않음
//  ④ i18n: 새 한글 라벨마다 영어 줄이 있고, 영어에는 한글이 섞이지 않음
// 브라우저에서 실제로 숨겨지는지·키보드로 들어갈 수 있는지는 tests/ui-simplify-browser.test.mjs가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => { try { return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
const SRC = { keymap: read('js/keymap.js'), view: read('js/view-level.js'), i18n: read('js/i18n.js') };

// ------------------------------------------------------------------ ① 단축키
function loadKeymap() {
  const context = { window: { SF: {} } };
  vm.runInNewContext(SRC.keymap, context);
  return context.window.SF.keymap;
}
const KEY = (key, code, extra = {}) => ({ key, code, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });

test('P9-1 단축키: 타임라인·내비게이터는 Alt+Shift+T·Alt+Shift+N이 첫 키이고 F11·F12는 보조로 남는다', () => {
  const { KEYMAP } = loadKeymap();
  const timeline = KEYMAP.find(x => x.id === 'timeline'), navigator = KEYMAP.find(x => x.id === 'navigator');
  assert.deepEqual([...timeline.keys], ['Alt+Shift+T', 'F11']);   // vm 안에서 만든 배열이라 펼쳐서 비교
  assert.deepEqual([...navigator.keys], ['Alt+Shift+N', 'F12']);
  assert.equal(timeline.action, 'openTimelinePanel');
  assert.equal(navigator.action, 'openNavigator');
  // 명령 팔레트·README·단축키 창은 첫 키를 보여 주므로 브라우저가 가로채는 F키가 아니라 새 키가 나온다
  assert.equal(timeline.keys[0], 'Alt+Shift+T');
  assert.equal(navigator.keys[0], 'Alt+Shift+N');
});

test('P9-1 단축키: 같은 모드 안에서 키가 겹치지 않는다(ui-v3 시험과 같은 검사를 새 키 포함해 다시)', () => {
  const { KEYMAP } = loadKeymap();
  for (const mode of ['normal', 'speedy']) {
    const keys = KEYMAP.filter(x => x.mode === 'all' || x.mode === mode).flatMap(x => x.keys);
    assert.deepEqual([...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))], [], `${mode}: 중복 키`);
  }
  // 새 키는 다른 행이 쓰지 않는다
  for (const key of ['Alt+Shift+T', 'Alt+Shift+N']) assert.equal(KEYMAP.filter(x => x.keys.includes(key)).length, 1, key);
});

test('P9-1 단축키: combo()가 영문·한글 입력·맥 Option 글자에서도 Alt+Shift+T·N을 만든다', () => {
  const { combo } = loadKeymap();
  const flags = { altKey: true, shiftKey: true };
  assert.equal(combo(KEY('T', 'KeyT', flags)), 'Alt+Shift+T');
  assert.equal(combo(KEY('N', 'KeyN', flags)), 'Alt+Shift+N');
  assert.equal(combo(KEY('t', 'KeyT', flags)), 'Alt+Shift+T');          // Caps Lock·다른 상태
  assert.equal(combo(KEY('ㅅ', 'KeyT', flags)), 'Alt+Shift+T');          // 한글 두벌식 T 자리
  assert.equal(combo(KEY('ㅜ', 'KeyN', flags)), 'Alt+Shift+N');
  assert.equal(combo(KEY('Process', 'KeyT', flags)), 'Alt+Shift+T');     // 입력기가 글자를 가린 경우
  assert.equal(combo(KEY('ˇ', 'KeyT', flags)), 'Alt+Shift+T');           // macOS Option+Shift 글자
  assert.equal(combo(KEY('F11', 'F11')), 'F11');                         // F키는 그대로
  assert.equal(combo(KEY('F12', 'F12')), 'F12');
  // Shift나 Alt가 하나라도 빠지면 다른 조합이다(Alt+T, Shift+T는 다른 명령)
  assert.equal(combo(KEY('T', 'KeyT', { shiftKey: true })), 'Shift+T');
  assert.equal(combo(KEY('t', 'KeyT', { altKey: true })), 'Alt+T');
  assert.equal(combo(KEY('N', 'KeyN', { ctrlKey: true, altKey: true, shiftKey: true })), 'Ctrl+Alt+Shift+N');
});

test('P9-1 단축키: 실제로 F11·F12·새 키 어느 쪽이든 같은 명령을 찾는다(디스패치 식과 같은 조회)', () => {
  const { KEYMAP, combo } = loadKeymap();
  const find = e => KEYMAP.find(x => x.keys.includes(combo(e)) && (x.mode === 'all' || x.mode === 'normal'));
  assert.equal(find(KEY('T', 'KeyT', { altKey: true, shiftKey: true })).action, 'openTimelinePanel');
  assert.equal(find(KEY('F11', 'F11')).action, 'openTimelinePanel');
  assert.equal(find(KEY('N', 'KeyN', { altKey: true, shiftKey: true })).action, 'openNavigator');
  assert.equal(find(KEY('F12', 'F12')).action, 'openNavigator');
  // 기존 Shift+T·Shift+N 명령은 그대로(새 키가 가로채지 않는다)
  assert.notEqual(find(KEY('T', 'KeyT', { shiftKey: true }))?.action, 'openTimelinePanel');
  assert.notEqual(find(KEY('N', 'KeyN', { shiftKey: true }))?.action, 'openNavigator');
});

// ------------------------------------------------------------------ ② SF.viewLevel 논리
function loadView({ storage = {}, failRead = false, failWrite = false, noStorage = false } = {}) {
  const data = new Map(Object.entries(storage));
  const localStorage = {
    getItem: k => { if (failRead) throw new Error('blocked'); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { if (failWrite) throw new Error('quota'); data.set(k, String(v)); },
    removeItem: k => { data.delete(k); }
  };
  const events = [], attrs = {};
  const root = { dataset: {}, setAttribute: (k, v) => { attrs[k] = v; } };
  const document = {
    documentElement: root, activeElement: null,
    querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
    addEventListener() {}, dispatchEvent: e => { events.push(e); return true; }
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const window = { SF: {}, document, CustomEvent };
  if (!noStorage) window.localStorage = localStorage;
  const context = { window, document, CustomEvent, ...(noStorage ? {} : { localStorage }) };
  assert.ok(SRC.view, 'js/view-level.js가 없다');
  vm.runInNewContext(SRC.view, context);
  assert.ok(window.SF.viewLevel, 'SF.viewLevel이 만들어지지 않았다');
  return { VL: window.SF.viewLevel, data, root, events };
}

test('P9-1 보기 수준: 기본값은 고급이고 저장 키·수준 이름이 고정이다', () => {
  const { VL } = loadView();
  assert.deepEqual([...VL.LEVELS], ['basic', 'advanced']);
  assert.equal(VL.DEFAULT, 'advanced');
  assert.equal(VL.KEY, 'sf.viewLevel');
  assert.equal(VL.get(), 'advanced');
});

test('P9-1 보기 수준: 저장값 읽기 — 정상값만 받고 없음·깨짐·다른 값·대소문자 다름은 기본값', () => {
  assert.equal(loadView({ storage: { 'sf.viewLevel': 'basic' } }).VL.get(), 'basic');
  assert.equal(loadView({ storage: { 'sf.viewLevel': 'advanced' } }).VL.get(), 'advanced');
  for (const bad of ['', 'BASIC', 'Basic', ' basic', 'rare', 'null', 'undefined', '0', '{"level":"basic"}', 'basic\n', 'x'.repeat(10000)]) {
    assert.equal(loadView({ storage: { 'sf.viewLevel': bad } }).VL.get(), 'advanced', JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(loadView({ failRead: true }).VL.get(), 'advanced', '저장소 읽기가 막혀도 기본값');
  assert.equal(loadView({ noStorage: true }).VL.get(), 'advanced', '저장소가 아예 없어도 기본값');
});

test('P9-1 보기 수준: set() — 정상 수준만 받고, 저장하고, <html data-view>와 이벤트를 갱신한다', () => {
  const { VL, data, root, events } = loadView();
  assert.equal(VL.set('basic'), true);
  assert.equal(VL.get(), 'basic');
  assert.equal(data.get('sf.viewLevel'), 'basic');
  assert.equal(root.dataset.view, 'basic');
  assert.equal(events.at(-1).type, 'sf:view-level');
  assert.equal(events.at(-1).detail.level, 'basic');
  assert.equal(VL.set('advanced'), true);
  assert.equal(root.dataset.view, 'advanced');
  assert.equal(data.get('sf.viewLevel'), 'advanced');
  assert.equal(events.at(-1).detail.level, 'advanced', '이벤트 값은 바뀐 수준을 따라간다(늘 같은 값이 아니다)');
  const before = events.length;
  for (const bad of ['', 'rare', 'Basic', null, undefined, 1, {}, ['basic']]) {
    assert.equal(VL.set(bad), false, String(bad));
    assert.equal(VL.get(), 'advanced');
  }
  assert.equal(events.length, before, '거절된 값은 이벤트도 내지 않는다');
  assert.equal(data.get('sf.viewLevel'), 'advanced', '거절된 값은 저장하지 않는다');
});

test('P9-1 보기 수준: 저장이 막혀도(쓰기 실패) 던지지 않고 이번 방문에서는 바뀐다', () => {
  const { VL, root } = loadView({ failWrite: true });
  assert.doesNotThrow(() => VL.set('basic'));
  assert.equal(VL.get(), 'basic');
  assert.equal(root.dataset.view, 'basic');
  assert.doesNotThrow(() => VL.toggle());
  assert.equal(VL.get(), 'advanced');
  const none = loadView({ noStorage: true });
  assert.doesNotThrow(() => none.VL.set('basic'));
  assert.equal(none.VL.get(), 'basic');
});

test('P9-1 보기 수준: toggle()은 기본 ↔ 고급을 오가고 새 수준을 돌려준다', () => {
  const { VL } = loadView();
  assert.equal(VL.toggle(), 'basic');
  assert.equal(VL.toggle(), 'advanced');
  assert.equal(VL.toggle(), 'basic');
  const { VL: stored } = loadView({ storage: { 'sf.viewLevel': 'basic' } });
  assert.equal(stored.toggle(), 'advanced');
});

test('P9-1 보기 수준: init()은 저장된 수준을 <html data-view>에 적용하고 DOM이 비어 있어도 던지지 않는다', () => {
  const basic = loadView({ storage: { 'sf.viewLevel': 'basic' } });
  assert.doesNotThrow(() => basic.VL.init());
  assert.equal(basic.root.dataset.view, 'basic');
  const fresh = loadView();
  fresh.VL.init();
  assert.equal(fresh.root.dataset.view, 'advanced', '저장값이 없으면 기본값을 적용');
  assert.doesNotThrow(() => fresh.VL.init(), '두 번 불러도 안전');
  // init()은 <html data-view>가 어긋나 있어도 저장된 수준으로 다시 맞춘다(스크립트가 일찍 실행된 환경 대비)
  basic.root.dataset.view = 'stale';
  basic.VL.init();
  assert.equal(basic.root.dataset.view, 'basic', 'init()이 data-view를 다시 맞춘다');
});

test('P9-1 분류표: 모양 — tier는 advanced·rare뿐, 선택자는 중복·title 의존 없이 이유가 있다', () => {
  const { VL } = loadView();
  assert.ok(Array.isArray(VL.TIERS) && VL.TIERS.length >= 20, `분류 항목 ${VL.TIERS?.length}개`);
  const seen = new Set();
  for (const row of VL.TIERS) {
    assert.ok(['advanced', 'rare'].includes(row.tier), `${row.sel}: tier=${row.tier}`);
    assert.equal(typeof row.sel, 'string');
    assert.ok(row.sel.trim() && row.sel === row.sel.trim(), `선택자가 비어 있거나 공백 붙음: ${row.sel}`);
    assert.ok(!seen.has(row.sel), `선택자 중복: ${row.sel}`);
    seen.add(row.sel);
    assert.ok(typeof row.why === 'string' && row.why.trim().length >= 4, `${row.sel}: 이유 칸이 비었다`);
    // 영어 번역이 title·aria-label 글자를 바꾸므로 글자에 기대는 선택자는 쓰지 않는다
    assert.doesNotMatch(row.sel, /\[(title|aria-label|placeholder|alt)\b/, `${row.sel}: 글자 속성에 기댄 선택자`);
    assert.doesNotMatch(row.sel, /:(contains|has-text)\(/, `${row.sel}: 글자 일치 선택자`);
    assert.doesNotMatch(row.sel, /,/, `${row.sel}: 한 항목에 선택자 하나(쉼표로 묶지 않는다 — 표·문서에서 한 줄이 한 요소)`);
  }
});

test('P9-1 분류표: 반드시 기본에 남아야 하는 핵심 조작은 표에 없다(실수로 숨기지 않는다)', () => {
  const { VL } = loadView();
  const essential = ['#btn-file', '#btn-undo', '#btn-redo', '#btn-play', '#btn-stop', '#btn-rewind', '#btn-metronome', '#tempo-input',
    '#btn-input', '#btn-delete', '#btn-dot', '#btn-rest', '#btn-sharp', '#btn-flat', '#btn-natural', '#btn-tie', '#btn-slur',
    '#btn-lyric', '#btn-chord-symbol', '#btn-props', '#btn-settings', '#btn-zoom-in', '#btn-zoom-out', '#btn-help',
    '#language-select', '#btn-view-level', '#btn-cresc', '#btn-dim', '#btn-measure-insert', '#btn-measure-delete'];
  const listed = new Set(VL.TIERS.map(r => r.sel));
  for (const sel of essential) assert.ok(!listed.has(sel), `${sel}은 기본 보기에 남아야 한다`);
  // 전환 단추 자신은 어떤 분류 선택자에도 걸리지 않는다(숨기면 되돌릴 수 없다)
  for (const row of VL.TIERS) {
    assert.doesNotMatch(row.sel, /btn-view-level|\.more-group|\.topbar|#palette-bar|\.palette-bar|^body|^html/, `${row.sel}: 전환 단추·큰 틀을 숨길 수 있다`);
  }
});

// ------------------------------------------------------------------ ③ 소스 규칙
test('P9-1 CSS: 숨기는 규칙은 기본 보기에서 advanced·rare만 display:none 한다(한 곳)', () => {
  const css = read('css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/html\[data-view=["']basic["']\]\s*\[data-tier=["']advanced["']\][^{]*\{[^}]*\}/);
  assert.ok(rule, 'html[data-view="basic"] [data-tier="advanced"] 규칙이 없다');
  assert.match(rule[0], /\[data-tier=["']rare["']\]/, '같은 규칙에 rare도 들어 있어야 한다');
  assert.match(rule[0], /display:\s*none\s*!important/, '아이디 선택자의 display 규칙에 지지 않도록 !important');
  // 고급 보기에서는 아무것도 숨기지 않는다 — data-view="advanced"를 겨냥하는 숨김 규칙이 없다
  assert.doesNotMatch(css, /data-view=["']advanced["']\][^{]*\{[^}]*display:\s*none/);
  // 기본 요소(data-tier="basic")를 숨기는 규칙은 없다
  assert.doesNotMatch(css, /data-tier=["']basic["']\][^{]*\{[^}]*display:\s*none/);
});

test('P9-1 소스: view-level.js는 safe-html.js 뒤·app.js 앞에서 불리고, 전환 단추는 위쪽 줄에 있다', () => {
  const html = read('index.html');
  const at = name => html.indexOf(`<script src="js/${name}"></script>`);
  assert.ok(at('safe-html.js') >= 0 && at('view-level.js') > at('safe-html.js'), 'safe-html.js 바로 뒤');
  assert.ok(at('view-level.js') < at('app.js'), 'app.js보다 앞');
  assert.ok(at('view-level.js') < at('palette.js'), 'palette.js가 이벤트를 듣기 전에 불려도 된다');
  assert.doesNotMatch(html, /<script\s*>/, '인라인 스크립트 금지(CSP)');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /<button[^>]*id="btn-view-level"[^>]*aria-pressed="false"/, '전환 단추는 aria-pressed를 가진다');
  assert.ok(header.indexOf('btn-view-level') > header.lastIndexOf('<div class="more-group">'), '마지막 .more-group 안(좁은 화면에서 더보기로 들어간다)');
  const app = read('js/app.js');
  assert.ok(app.split('\n').length <= 1600, `app.js ${app.split('\n').length}줄`);
  assert.match(app, /SF\.viewLevel\??\.init\(/, 'app.js가 init을 부른다');
});

test('P9-1 소스: 영문 약어 라벨이 화면 소스에 남지 않는다(음악 용어는 제외)', () => {
  const palette = read('js/palette.js'), panels = read('js/panels.js'), html = read('index.html'), app = read('js/app.js');
  const forbid = [
    [palette, />\s*(Gliss\.|Arp\.|Trem\.|C7|R|Txt|Pg|Sec)\s*</, '팔레트 약어 라벨'],
    [palette, />\s*V[1-4]\s*</, '성부 V1~V4'],
    [palette, /title=\\"Voice [1-4]/, '성부 영어 title'],
    [html, />\s*(Nav|Time)\s*</, '위쪽 줄 Nav·Time'],
    [html, /<span>UI<\/span>/, '테마 라벨 UI'],
    [html, /<option value="(dark|light|pretty|cute)">(Dark|Light|Pretty|Cute)<\/option>/, '테마 이름'],
    [html, />\s*(Kick|Snare|Closed HH|Open HH|Crash|Ride|Low Tom|Mid Tom|High Tom)\s*</, '드럼 패드 영어 이름'],
    [html, /aria-label="tempo-input"|id="tempo-input"[^>]*aria-label="tempo-input"/, 'id가 그대로 새어 나온 aria-label'],
    [panels, /<label>(X|Y|Velocity)<\/label>/, '속성 패널 X·Y·Velocity'],
    [panels, /\$\{a\}<\/button>/, '꾸밈 칩이 영어 키 그대로 보임'],
    [panels, /Vol<|>Pan</, '믹서 Vol·Pan'],
    [app, /["'`](Dark|Light|Pretty|Cute) UI["'`]/, '테마 이름 "Dark UI"']
  ];
  for (const [text, pattern, what] of forbid) assert.doesNotMatch(text, pattern, what);
});

test('P9-1 문서: README·SHORTCUTS 표와 설명서·구조 설명이 새 단축키와 보기 전환을 적는다', () => {
  for (const file of ['README.md', 'docs/SHORTCUTS.md']) {
    const text = read(file);
    assert.match(text, /\| Alt\+Shift\+N \/ F12 \| 내비게이터 \| 공통 \|/, `${file}: 내비게이터 행`);
    assert.match(text, /\| Alt\+Shift\+T \/ F11 \| 타임라인 \| 공통 \|/, `${file}: 타임라인 행`);
  }
  const readme = read('README.md');
  assert.match(readme, /내비게이터\(Alt\+Shift\+N\)/);
  assert.match(readme, /타임라인\(Alt\+Shift\+T\)/);
  assert.doesNotMatch(readme, /내비게이터\(F12\)|타임라인\(F11\)/, '기능 설명에서 F키만 적은 곳이 없다');
  assert.match(readme, /js\/view-level\.js\s+\S/, '구조 절에 js/view-level.js 설명');
  assert.match(readme, /기본 보기/, '기본/고급 보기 설명');
  const manual = read('manual/scoreforge_user_manual.html');
  // 설명서는 키를 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>처럼 한 글쇠씩 나눠 적는다(기존 표기 방식)
  assert.match(manual, /<kbd>Alt<\/kbd>\+<kbd>Shift<\/kbd>\+<kbd>N<\/kbd> 또는 <kbd>F12<\/kbd>/);
  assert.match(manual, /<kbd>Alt<\/kbd>\+<kbd>Shift<\/kbd>\+<kbd>T<\/kbd> 또는 <kbd>F11<\/kbd>/);
  assert.match(manual, /<kbd>F12<\/kbd>/, 'F키는 보조로 남긴다');
  assert.match(manual, /기본 보기/, '설명서에 기본/고급 보기 안내');
  const doc = read('docs/UI_INVENTORY.md');
  assert.match(doc, /^# ScoreForge 화면 조작 요소 분류표/);
  assert.match(doc, /\*\*기본 보기에서 보이는 것\*\*/);
});

test('P9-1 소스: 속성 패널 옛 템플릿은 라벨마다 id·for를 직접 달아 둔다(ui-v3가 나중에 달아 주기를 기다리지 않는다)', () => {
  // 분류표는 `label[for="prop-…"]`로 라벨을 고르므로, 그려지는 순간 for가 있어야 감시자가 라벨을 놓치지 않는다.
  // ui-v3.js가 같은 틱 안에 for를 달아 주는 현재는 눈에 보이는 차이가 없어서(변이 실험으로 확인) 소스 모양으로 못 박는다.
  const panels = read('js/panels.js');
  for (const id of ['prop-offsetX', 'prop-offsetY', 'prop-break', 'prop-rehearsal', 'prop-staffText']) {
    assert.match(panels, new RegExp(`<label for="${id}">`), `${id} 라벨의 for`);
    assert.match(panels, new RegExp(`id="${id}"`), `${id} 입력의 id`);
  }
  const view = SRC.view;
  for (const id of ['prop-offsetX', 'prop-offsetY', 'prop-break', 'prop-rehearsal', 'prop-staffText']) assert.ok(view.includes(`label[for="${id}"]`), `분류표에 ${id} 라벨`);
});

// ------------------------------------------------------------------ ④ i18n
function loadI18n() {
  const context = vm.createContext({ console: { warn() {} }, navigator: { language: 'ko-KR' }, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(SRC.i18n, context, { filename: 'i18n.js' });
  context.SF.i18n.setLanguage('en');
  return context.SF.i18n;
}
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
// 새 한글 라벨(화면에 보이는 글자) → 영어는 따로 정한 것만 고정하고, 나머지는 "비어 있지 않고 한글이 없다"만 본다.
const NEW_LABELS = {
  '글리산도': 'Glissando', '아르페지오': 'Arpeggio', '트레몰로': 'Tremolo', '코드': 'Chord', '리허설': 'Rehearsal', '스태프 텍스트': 'Staff text',
  '쪽나눔': 'Page break', '구역나눔': 'Section break',
  '성부 1': 'Voice 1', '성부 2': 'Voice 2', '성부 3': 'Voice 3', '성부 4': 'Voice 4',
  '내비': 'Nav', '타임': 'Time', '테마': 'Theme',
  '어두운': 'Dark', '밝은': 'Light', '예쁜': 'Pretty', '귀여운': 'Cute',
  '가로 이동': 'X offset', '세로 이동': 'Y offset', '세기': 'Velocity', '음량': 'Volume', '좌우': 'Pan',
  '스타카토': 'Staccato', '테누토': 'Tenuto', '악센트': 'Accent', '마르카토': 'Marcato', '페르마타': 'Fermata',
  '킥': 'Kick', '스네어': 'Snare', '닫힌 하이햇': 'Closed HH', '열린 하이햇': 'Open HH', '크래시': 'Crash', '라이드': 'Ride',
  '낮은 탐': 'Low Tom', '중간 탐': 'Mid Tom', '높은 탐': 'High Tom',
  '기본 보기': 'Basic view'
};
test('P9-1 i18n: 새 한글 라벨은 영어 줄이 있고 영어 화면에는 한글이 섞이지 않는다', () => {
  const i18n = loadI18n();
  for (const [ko, en] of Object.entries(NEW_LABELS)) {
    const got = i18n.translate(ko);
    assert.equal(got, en, `${ko} → ${got}`);
    assert.ok(!HANGUL.test(got), `${ko}: 영어에 한글`);
  }
});

test('P9-1 i18n: 새 설명 문구(제목·상태·안내)도 영어 줄이 있다', () => {
  const i18n = loadI18n();
  const pairs = {
    '내비게이터 (Alt+Shift+N)': 'Navigator (Alt+Shift+N)',
    '타임라인 (Alt+Shift+T)': 'Timeline (Alt+Shift+T)',
    '성부 1 (Alt+1)': 'Voice 1 (Alt+1)', '성부 2 (Alt+2)': 'Voice 2 (Alt+2)', '성부 3 (Alt+3)': 'Voice 3 (Alt+3)', '성부 4 (Alt+4)': 'Voice 4 (Alt+4)',
    '킥 (K)': 'Kick (K)', '스네어 (S)': 'Snare (S)', '닫힌 하이햇 (H)': 'Closed hihat (H)', '열린 하이햇 (O)': 'Open hihat (O)', '크래시 (C)': 'Crash (C)'
  };
  for (const [ko, en] of Object.entries(pairs)) assert.equal(i18n.translate(ko), en, ko);
  // 보기 전환 단추의 안내는 눌린 상태·눌리지 않은 상태 둘 다 영어가 있다
  const hints = Object.entries({ on: i18n.translate('기본 보기 — 자주 쓰는 조작만 보여 줘요(켜짐)'), off: i18n.translate('기본 보기 — 자주 쓰는 조작만 보여 줘요(꺼짐)') });
  for (const [state, text] of hints) assert.ok(text && !HANGUL.test(text), `보기 전환 안내(${state}): ${text}`);
});
