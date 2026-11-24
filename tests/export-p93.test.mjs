// P9-3 내보내기 개선 — Node에서 확인하는 부분.
//  ① 파일 이름 계획(planFiles) ② MusicXML 머리말 내보내기(부제·작사가·저작권) ③ index.html 메뉴·스크립트 순서 ④ 새 문구의 영어 번역 ⑤ 소스 규칙
//  MusicXML을 읽어 들이는 쪽(DOMParser 필요)과 실제 메뉴·내려받기는 tests/export-p93-browser.test.mjs에서 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { SF } from './shim.mjs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
vm.runInThisContext(read('js/zip.js'), { filename: 'zip.js' });
vm.runInThisContext(read('js/export-ui.js'), { filename: 'export-ui.js' });
const C = SF.core, IO = SF.io;
const ECHO = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');   // 시험이 따로 가진 이스케이프(io.js와 같은 규칙)

// ---- ① 파일 이름 계획 ----
test('P9-3 planFiles: 한 쪽이면 파일 하나(지금과 같음), 여러 쪽이면 ZIP 하나와 안의 파일 이름', () => {
  const plan = SF.exportUI.planFiles;
  assert.equal(typeof plan, 'function');
  assert.deepEqual(plan('svg', '나비야', 1), { zip: false, filename: '나비야.svg', entries: ['나비야.svg'] });
  assert.deepEqual(plan('png', '나비야', 1), { zip: false, filename: '나비야.png', entries: ['나비야.png'] });
  assert.deepEqual(plan('svg', '나비야', 0), { zip: false, filename: '나비야.svg', entries: ['나비야.svg'] }, '0쪽도 ZIP이 아니다');
  assert.deepEqual(plan('svg', '나비야', 2), { zip: true, filename: '나비야-svg.zip', entries: ['나비야-1.svg', '나비야-2.svg'] });
  assert.deepEqual(plan('png', 'My Song', 3), { zip: true, filename: 'My Song-png.zip', entries: ['My Song-1.png', 'My Song-2.png', 'My Song-3.png'] });
});

test('P9-3 planFiles: 쪽 번호는 쪽 수의 자릿수에 맞춰 0을 채운다(9쪽까지 한 자리 — 기존 이름과 같다)', () => {
  const entries = count => SF.exportUI.planFiles('svg', 'a', count).entries;
  assert.deepEqual(entries(9), Array.from({ length: 9 }, (_, i) => `a-${i + 1}.svg`));
  assert.deepEqual(entries(10).slice(0, 2), ['a-01.svg', 'a-02.svg']);
  assert.equal(entries(10).at(-1), 'a-10.svg');
  assert.equal(entries(99).at(-1), 'a-99.svg');
  assert.equal(entries(99)[0], 'a-01.svg');
  assert.equal(entries(100)[0], 'a-001.svg');
  assert.equal(entries(100).at(-1), 'a-100.svg');
  assert.equal(entries(100).length, 100);
  assert.equal(new Set(entries(250)).size, 250, '모두 다른 이름');
  assert.deepEqual([...entries(250)].sort(), entries(250), '이름순 = 쪽 순서');
});

test('P9-3 planFiles: 이름의 제어 문자는 밑줄로 바꿔 ZIP 이름 검사를 통과한다(경로 글자는 safeName이 이미 바꾼다)', () => {
  const plan = SF.exportUI.planFiles('svg', 'a\nb\tc\u0000d\u007fe', 2);
  assert.deepEqual(plan.entries, ['a_b_c_d_e-1.svg', 'a_b_c_d_e-2.svg']);
  assert.equal(plan.filename, 'a_b_c_d_e-svg.zip');
  assert.equal(SF.exportUI.planFiles('png', 'x\ry', 1).filename, 'x_y.png', '한 쪽 파일 이름도 같은 규칙');
  // 만든 이름은 실제로 ZIP에 들어간다
  assert.doesNotThrow(() => SF.zip.create(plan.entries.map(name => ({ name, data: 'x' }))));
  // safeName을 거친 이름은 어떤 모양이든(점·긴 이름·한글) ZIP 이름으로 쓸 수 있다
  for (const title of ['..', '.', '...', 'a'.repeat(100), '한글'.repeat(50), '', 'a/b\\c:d*e?f"g<h>i|j', ' ']) {
    const name = IO.safeName(title), made = SF.exportUI.planFiles('png', name, 12);
    assert.doesNotThrow(() => SF.zip.create(made.entries.map(entry => ({ name: entry, data: 'x' }))), JSON.stringify(title));
    assert.doesNotThrow(() => SF.zip.create([{ name: made.filename, data: 'x' }]), JSON.stringify(title));
  }
});

// ---- ② MusicXML 머리말 ----
const HEAD = (title, composer) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
 <work><work-title>${ECHO(title)}</work-title></work>
 <identification>
  <creator type="composer">${ECHO(composer)}</creator>
`;
const ENC = `  <encoding><software>ScoreForge</software></encoding>
 </identification>
`;
const headerOf = xml => xml.slice(0, xml.indexOf(' <part-list>'));
const credit = (type, text) => ` <credit page="1"><credit-type>${type}</credit-type><credit-words>${ECHO(text)}</credit-words></credit>\n`;
const scoreWith = meta => {
  const s = C.createScore({ title: '제목', composer: '', measureCount: 1 });
  s.meta.title = meta.title ?? '제목'; s.meta.composer = meta.composer ?? '';   // createScore는 빈 제목을 "새 악보"로 바꾸므로 만든 뒤 덮어쓴다
  for (const key of ['subtitle', 'lyricist', 'copyright']) if (key in meta) s.meta[key] = meta[key];
  return s;
};

test('P9-3 MusicXML: 부제·작사가·저작권이 없으면 머리말이 지금 출력과 바이트까지 같다(공백뿐인 값도 없는 것으로 본다)', () => {
  const baseline = HEAD('제목', '작곡가') + ENC;
  for (const extra of [{}, { subtitle: '', lyricist: '', copyright: '' }, { subtitle: '   ', lyricist: '\t', copyright: ' \n ' }, { subtitle: undefined, lyricist: null, copyright: undefined }]) {
    const xml = IO.exportMusicXML(scoreWith({ title: '제목', composer: '작곡가', ...extra }));
    assert.equal(headerOf(xml), baseline, JSON.stringify(extra));
    assert.equal(xml.includes('<credit'), false, '부제가 없으면 credit이 없다');
    assert.equal(xml.includes('lyricist'), false);
    assert.equal(xml.includes('<rights'), false);
  }
  // 작곡가가 비어도 composer 요소는 지금처럼 남는다(기존 동작 유지)
  assert.equal(headerOf(IO.exportMusicXML(scoreWith({ title: 'T', composer: '' }))), HEAD('T', '') + ENC);
  // 데모 악보 네 개 모두 같은 머리말 모양
  for (const demo of Object.values(IO.DEMOS)) {
    const s = demo(), xml = IO.exportMusicXML(s);
    assert.equal(headerOf(xml), HEAD(s.meta.title, s.meta.composer || '') + ENC);
  }
});

test('P9-3 MusicXML: 작사가는 creator, 저작권은 rights로 identification 안에 순서대로 들어간다(부제가 없으면 credit 없음)', () => {
  const xml = IO.exportMusicXML(scoreWith({ title: '제목', composer: '작곡가', lyricist: '  작사가  ', copyright: ' © 2026 홍길동 ' }));
  assert.equal(headerOf(xml), HEAD('제목', '작곡가') + `  <creator type="lyricist">작사가</creator>\n  <rights>© 2026 홍길동</rights>\n` + ENC, '값은 앞뒤 공백을 뗀다');
  const lyricistOnly = IO.exportMusicXML(scoreWith({ title: '제목', composer: '작곡가', lyricist: '작사가' }));
  assert.equal(headerOf(lyricistOnly), HEAD('제목', '작곡가') + `  <creator type="lyricist">작사가</creator>\n` + ENC);
  const rightsOnly = IO.exportMusicXML(scoreWith({ title: '제목', composer: '작곡가', copyright: 'R' }));
  assert.equal(headerOf(rightsOnly), HEAD('제목', '작곡가') + `  <rights>R</rights>\n` + ENC);
  assert.equal(xml.includes('<credit'), false);
});

test('P9-3 MusicXML: 부제가 있으면 credit 묶음(title·subtitle·composer·lyricist, 값이 있는 것만)이 identification 뒤·part-list 앞에 온다', () => {
  const full = IO.exportMusicXML(scoreWith({ title: '제목', composer: '작곡가', subtitle: '부제', lyricist: '작사가', copyright: '저작권' }));
  assert.equal(headerOf(full), HEAD('제목', '작곡가') + `  <creator type="lyricist">작사가</creator>\n  <rights>저작권</rights>\n` + ENC
    + credit('title', '제목') + credit('subtitle', '부제') + credit('composer', '작곡가') + credit('lyricist', '작사가'));
  assert.ok(full.includes(' </identification>\n <credit page="1">'), 'identification 바로 뒤');
  assert.ok(full.includes('</credit>\n <part-list>'), 'part-list 바로 앞');
  const subtitleOnly = IO.exportMusicXML(scoreWith({ title: '제목', composer: '', subtitle: '부제' }));
  assert.equal(headerOf(subtitleOnly), HEAD('제목', '') + ENC + credit('title', '제목') + credit('subtitle', '부제'), '값이 없는 composer·lyricist credit은 만들지 않는다');
  const noTitle = IO.exportMusicXML(scoreWith({ title: '', composer: '곡', subtitle: '부제' }));
  assert.equal(headerOf(noTitle), HEAD('', '곡') + ENC + credit('subtitle', '부제') + credit('composer', '곡'), '제목이 비면 title credit도 없다');
  assert.equal((full.match(/<credit /g) || []).length, 4);
  assert.equal((subtitleOnly.match(/<credit /g) || []).length, 2);
  // 제목·작곡가의 앞뒤 공백은 credit에서만 뗀다(identification은 지금과 같게 그대로)
  const spaced = IO.exportMusicXML(scoreWith({ title: ' 제목 ', composer: ' 곡 ', subtitle: ' 부 ' }));
  assert.ok(spaced.includes('<work-title> 제목 </work-title>'));
  assert.ok(spaced.includes('<creator type="composer"> 곡 </creator>'));
  assert.ok(spaced.includes(credit('title', '제목')) && spaced.includes(credit('subtitle', '부')) && spaced.includes(credit('composer', '곡')));
});

test('P9-3 MusicXML: 부제·작사가·저작권의 특수 문자는 이스케이프되고 XML에 쓸 수 없는 제어 문자는 빠진다', () => {
  const xml = IO.exportMusicXML(scoreWith({ title: 'T & <T>', composer: 'C "c"', subtitle: 'S & <b>"s"</b>', lyricist: "L'l' & <l>", copyright: '© <2026> & "co"\u0001\u0008\u000b\u001f' }));
  const head = headerOf(xml);
  assert.ok(head.includes('<credit-words>S &amp; &lt;b&gt;&quot;s&quot;&lt;/b&gt;</credit-words>'), head);
  assert.ok(head.includes("<creator type=\"lyricist\">L'l' &amp; &lt;l&gt;</creator>"));
  assert.ok(head.includes('<rights>© &lt;2026&gt; &amp; &quot;co&quot;</rights>'), '제어 문자(0x01·0x08·0x0b·0x1f)는 빠진다');
  assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), false, '내보낸 글 어디에도 XML 1.0이 금지한 문자가 없다');
  // 탭·줄바꿈은 XML에서 허용되므로 남는다
  const kept = IO.exportMusicXML(scoreWith({ title: 'a\tb', composer: '', subtitle: 'x\ny' }));
  assert.ok(kept.includes('<work-title>a\tb</work-title>') && kept.includes('<credit-words>x\ny</credit-words>'));
  // 제목·악기 이름 등 기존 글에도 같은 규칙(제어 문자 하나가 파일 전체를 못 읽게 만들지 않는다)
  const bad = scoreWith({ title: 'a\u0001b', composer: 'c\u0002d' });
  const out = IO.exportMusicXML(bad);
  assert.ok(out.includes('<work-title>ab</work-title>') && out.includes('<creator type="composer">cd</creator>'));
});

function tool(name, args) { const r = spawnSync(name, args, { encoding: 'utf8' }); return r.error ? null : r; }
const HAVE_PY = !!tool('python3', ['-I', '-c', 'import xml.etree.ElementTree']);
const HAVE_XMLLINT = !!tool('xmllint', ['--version']);
const PY_PARSE = `import sys, json
import xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.buffer.read())
tags = []
for child in root:
    if child.tag == 'part' and tags and tags[-1] == 'part': continue
    tags.append(child.tag)
ident = root.find('identification')
print(json.dumps({'root': root.tag, 'version': root.get('version'), 'children': tags,
  'work': [[c.tag, c.text] for c in root.find('work')],
  'identification': [[c.tag, c.attrib, c.text] for c in ident],
  'credits': [{'attrs': c.attrib, 'kids': [[k.tag, k.attrib, k.text] for k in c]} for c in root.findall('credit')],
  'parts': len(root.findall('part'))}, ensure_ascii=False))`;

test('P9-3 MusicXML: python ElementTree가 읽은 요소 순서·글이 MusicXML 순서(work → identification → credit → part-list → part)와 맞다', { skip: !HAVE_PY && 'python3를 쓸 수 없다' }, () => {
  const meta = { title: 'T & <T> 🎼', composer: 'C "c"', subtitle: 'S & <b>"s"</b> 한글', lyricist: "L'l'", copyright: '© <2026> & "co"' };
  const run = score => { const r = spawnSync('python3', ['-I', '-c', PY_PARSE], { input: IO.exportMusicXML(score), encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const full = run(scoreWith(meta));
  assert.equal(full.root, 'score-partwise'); assert.equal(full.version, '4.0');
  assert.deepEqual(full.children, ['work', 'identification', 'credit', 'credit', 'credit', 'credit', 'part-list', 'part']);
  assert.deepEqual(full.work, [['work-title', meta.title]]);
  assert.deepEqual(full.identification.slice(0, 3), [['creator', { type: 'composer' }, meta.composer], ['creator', { type: 'lyricist' }, meta.lyricist], ['rights', {}, meta.copyright]]);
  assert.deepEqual(full.identification.map(e => e[0]), ['creator', 'creator', 'rights', 'encoding'], 'creator → rights → encoding');
  assert.deepEqual(full.credits.map(c => [c.attrs.page, c.kids.map(k => k[0]), c.kids[0][2], c.kids[1][2]]),
    [['1', ['credit-type', 'credit-words'], 'title', meta.title], ['1', ['credit-type', 'credit-words'], 'subtitle', meta.subtitle],
      ['1', ['credit-type', 'credit-words'], 'composer', meta.composer], ['1', ['credit-type', 'credit-words'], 'lyricist', meta.lyricist]]);
  assert.equal(full.parts, 1);
  const plain = run(scoreWith({ title: 'T', composer: 'C' }));
  assert.deepEqual(plain.children, ['work', 'identification', 'part-list', 'part'], '값이 없으면 credit이 없다');
  assert.deepEqual(plain.identification.slice(0, 1), [['creator', { type: 'composer' }, 'C']]);
  assert.deepEqual(plain.identification.map(e => e[0]), ['creator', 'encoding']);
  const lyricRights = run(scoreWith({ title: 'T', composer: 'C', lyricist: 'L', copyright: 'R' }));
  assert.deepEqual(lyricRights.identification.map(e => e[0]), ['creator', 'creator', 'rights', 'encoding'], 'MusicXML의 identification 순서: creator → rights → encoding');
  assert.deepEqual(lyricRights.children, ['work', 'identification', 'part-list', 'part']);
});

test('P9-3 MusicXML: xmllint가 부제·작사가·저작권이 든 파일(데모 포함)을 올바른 XML로 읽는다', { skip: !HAVE_XMLLINT && 'xmllint를 쓸 수 없다' }, () => {
  const scores = [scoreWith({ title: 'a&b', composer: '<c>', subtitle: '부제 🎼', lyricist: '작사 "x"', copyright: "© 'y'\u0001" }), scoreWith({ title: 'T', lyricist: 'L' }), scoreWith({ title: 'T', copyright: 'R' }),
    ...Object.values(IO.DEMOS).map(demo => { const s = demo(); s.meta.subtitle = 'sub & <sub>'; s.meta.lyricist = '작사가'; s.meta.copyright = '© 2026'; return s; })];
  scores.forEach((score, i) => {
    const r = spawnSync('xmllint', ['--noout', '--nonet', '-'], { input: IO.exportMusicXML(score), encoding: 'utf8' });
    assert.equal(r.status, 0, `${i}번째: ${r.stderr}`);
  });
});

// ---- ③ index.html ----
const html = read('index.html');
const fileMenu = html.match(/<div id="file-menu"[^>]*>([\s\S]*?)\n    <\/div>\n  <\/div>/);
test('P9-3 메뉴 마크업: 첫 <hr> 뒤에 "내보내기" 구역 제목, 그 아래 MusicXML·MIDI·인쇄, 이어서 설명서·데모 구역(고정 항목 14개 그대로)', () => {
  assert.ok(fileMenu, '파일 메뉴 블록');
  const lines = fileMenu[1].split('\n').map(l => l.trim()).filter(Boolean);
  const shape = lines.map(l => l === '<hr>' ? 'hr' : l.startsWith('<div class="mtitle"') ? 'title:' + l.replace(/<[^>]+>/g, '') : 'act:' + l.match(/data-act="([^"]+)"/)[1]);
  assert.deepEqual(shape, ['act:new', 'act:open', 'act:recent', 'act:save', 'act:save-legacy', 'hr', 'title:내보내기', 'act:musicxml', 'act:midi', 'act:print', 'hr',
    'title:설명서', 'act:manual-quick', 'act:manual-user', 'hr', 'title:데모 악보 열기', 'act:demo-butterfly', 'act:demo-star', 'act:demo-airplane', 'act:demo-rhythm']);
  assert.ok(fileMenu[1].includes('<div class="mtitle" role="presentation">내보내기</div>'), '다른 구역 제목과 같은 모양(role=presentation)');
});

test('P9-3 스크립트: js/zip.js를 export-ui.js보다 먼저 불러오고 한 번만 넣는다', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(scripts.filter(src => src === 'js/zip.js').length, 1);
  assert.ok(scripts.indexOf('js/zip.js') >= 0 && scripts.indexOf('js/zip.js') < scripts.indexOf('js/export-ui.js'));
});

// ---- ④ 영어 번역 ----
const i18nSource = read('js/i18n.js');
function i18n() {
  const context = vm.createContext({ console: { warn() {} }, navigator: { language: 'ko-KR' }, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(i18nSource, context, { filename: 'i18n.js' });
  return context.SF;
}
test('P9-3 i18n: 새 알림·구역 제목·인쇄 안내가 영어로 번역되고 한글이 남지 않으며, 글자는 소스와 같다', () => {
  const exportUi = read('js/export-ui.js'), zipSource = read('js/zip.js');
  const cases = [
    ['글꼴을 포함한 SVG를 ZIP 파일 하나로 묶어 내보냈어요.', 'Exported the SVGs with the font included as one ZIP file.', exportUi],
    ['300dpi PNG를 ZIP 파일 하나로 묶어 내보냈어요.', 'Exported the 300 dpi PNGs as one ZIP file.', exportUi],
    ['내보낼 파일이 너무 커서 ZIP으로 묶을 수 없어요.', 'The files are too large to bundle into a ZIP.', zipSource],
    ['내보내기', 'Export', html],
    ["인쇄 창에서 '대상'을 'PDF로 저장'으로 고르면 PDF 파일로 보관할 수 있어요(악보가 벡터 품질로 저장돼요). 배율은 100%, 여백은 없음, 머리글·바닥글은 끄기로 설정하세요.",
      'In the print window, set the destination to "Save as PDF" to keep a vector-quality PDF. Use 100% scale, no margins, and turn off headers and footers.', exportUi],
  ];
  for (const [ko, en, source] of cases) {
    assert.ok(source.includes(ko), `소스에 있는 글과 같다: ${ko}`);
    const SFi = i18n();
    assert.equal(SFi.i18n.translate(ko), ko, '한국어 모드는 그대로');
    SFi.i18n.setLanguage('en');
    assert.equal(SFi.i18n.translate(ko), en);
    assert.doesNotMatch(SFi.i18n.translate(ko), /[가-힣]/);
  }
  // 기존 알림은 그대로(한 쪽짜리 내보내기)
  const SFi = i18n(); SFi.i18n.setLanguage('en');
  assert.equal(SFi.i18n.translate('300dpi PNG를 내보냈어요.'), 'Exported a 300 dpi PNG.');
  assert.equal(SFi.i18n.translate('글꼴을 포함한 SVG를 내보냈어요.'), 'Exported an SVG with the font included.');
  // 메뉴의 SVG·PNG 항목 이름은 기존 행 그대로
  assert.equal(SFi.i18n.translate('SVG 내보내기 (글꼴 포함)'), 'Export SVG (with font)');
  assert.equal(SFi.i18n.translate('PNG 내보내기 (300dpi)'), 'Export PNG (300 dpi)');
  assert.deepEqual([...SFi.i18n.audit().missingEnglish], [], '새 행 포함 영어가 빠진 행이 없다(기존 i18n 시험은 toast.saved를 일부러 지운 뒤 같은 검사를 한다)');
});

// ---- ⑤ 소스 규칙 ----
test('P9-3 소스 규칙: zip.js는 DOM·네트워크·저장소를 쓰지 않고, 내보내기·입출력 코드에 새 innerHTML이 없다', () => {
  const zip = read('js/zip.js'), ui = read('js/export-ui.js'), io = read('js/io.js');
  for (const word of ['document', 'fetch(', 'XMLHttpRequest', 'localStorage', 'navigator', 'innerHTML', 'eval(', 'new Function']) assert.equal(zip.includes(word), false, `zip.js에 ${word}`);
  assert.equal((zip.match(/window\.SF/g) || []).length, 1, 'window는 SF를 받을 때 한 번만');
  assert.equal((ui.match(/innerHTML/g) || []).length, 2, 'export-ui.js의 innerHTML은 기존 인쇄 영역 2곳뿐(새로 늘리지 않는다)');
  assert.equal((io.match(/innerHTML/g) || []).length, 0, 'io.js에는 innerHTML이 없다');
  assert.equal(/sb_secret_|service_role/.test(zip + ui + io), false);
});
