// P9-3 내보내기 개선 — 실제 브라우저(Chromium)에서 확인하는 부분.
//  ① MusicXML 부제·작사가·저작권 왕복과 가져오기 모양(실제 DOMParser) ② 파일 메뉴 순서·영어·키보드 ③ 여러 쪽 SVG·PNG가 ZIP 하나로 내려오는지(실제 내려받기)
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/export-p93-browser.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
import { crcBitwise, parseZip } from './zip-parse.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE && 'PLAYWRIGHT_MODULE이 없다';
const app = {};

before(async () => {
  if (skip) return;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  app.browser = await chromium.launch(launchOptions());
  const context = await app.browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }));
  app.page = await context.newPage();
  await preparePage(app.page);
  app.page.setDefaultTimeout(20000);
  app.errors = [];
  app.page.on('pageerror', e => app.errors.push(e.message));
  await app.page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await app.page.goto(URL_, { waitUntil: 'networkidle' });
  await app.page.waitForSelector('#svg-host .ev');
  await app.page.waitForFunction(() => SF.engrave.isFontReady());
  // 내려받기 기록기. 이 환경의 Playwright는 한글 파일 이름의 suggestedFilename()을 'download'로 돌려주므로(앱 문제가 아님),
  // 앱이 <a download>에 준 이름과 Blob(내용·형식)을 직접 붙잡는다. 실제 내려받기도 그대로 일어나고 파일 내용은 아래에서 맞춰 본다.
  await app.page.evaluate(() => {
    window.__downloads = [];
    const blobs = new Map(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { const url = create(blob); blobs.set(url, blob); return url; };
    URL.revokeObjectURL = url => { revoke(url); setTimeout(() => blobs.delete(url), 2000); };
    HTMLAnchorElement.prototype.click = function () {
      const blob = blobs.get(this.href);
      if (this.download && blob) {
        const record = { name: this.download, type: blob.type };
        record.done = blob.arrayBuffer().then(buffer => { record.bytes = new Uint8Array(buffer); });
        window.__downloads.push(record);
      }
      return click.call(this);
    };
  });
});
after(async () => { await app.browser?.close(); });

// ---------------------------------------------------------------- ① MusicXML
const BODY = '<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><rest measure="yes"/><duration>4</duration></note></measure></part>';
const xmlWith = head => `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n${head}\n${BODY}\n</score-partwise>`;
const importMeta = xmls => app.page.evaluate(list => list.map(xml => ({ ...SF.io.parseMusicXML(xml).score.meta })), xmls);
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test('P9-3 MusicXML 왕복: 부제·작사가·저작권이 내보내기 → 가져오기에서 같은 값으로 돌아온다(특수 문자·이모지·공백·한도)', { skip, timeout: 120000 }, async () => {
  const cases = [
    { title: '나비야', composer: '작곡가', subtitle: '부제', lyricist: '작사가', copyright: '© 2026 홍길동' },
    { title: 'T & <T> "q"', composer: "C 'c' &amp;", subtitle: 'S & <b>"s"</b> 🎼', lyricist: "L'l' <l>", copyright: '© <2026> & "co" 한글 🎼' },
    { title: 'T', composer: '', lyricist: '작사가만' },
    { title: 'T', composer: '', copyright: '저작권만' },
    { title: 'T', composer: '', subtitle: '부제만' },
    { title: 'T', composer: 'C' },
    { title: 'T', composer: 'C', subtitle: '', lyricist: '', copyright: '' },
    { title: 'T', composer: 'C', subtitle: '  부 제  ', lyricist: '\t작사가\n', copyright: ' 저작권 ' },
    { title: 'T', composer: 'C', subtitle: 'x'.repeat(200), lyricist: 'y'.repeat(200), copyright: 'z'.repeat(200) },
  ];
  const wants = [
    cases[0], cases[1],
    { title: 'T', composer: '', lyricist: '작사가만' }, { title: 'T', composer: '', copyright: '저작권만' }, { title: 'T', composer: '', subtitle: '부제만' },
    { title: 'T', composer: 'C' }, { title: 'T', composer: 'C' },
    { title: 'T', composer: 'C', subtitle: '부 제', lyricist: '작사가', copyright: '저작권' }, cases[8],
  ];
  const out = await app.page.evaluate(list => list.map(meta => {
    const score = SF.core.createScore({ title: 'x', measureCount: 1 });
    Object.assign(score.meta, meta);
    const xml = SF.io.exportMusicXML(score);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return { wellFormed: !doc.querySelector('parsererror'), meta: { ...SF.io.parseMusicXML(xml).score.meta } };
  }), cases);
  out.forEach((result, i) => {
    assert.equal(result.wellFormed, true, `${i}: 올바른 XML`);
    assert.deepEqual(result.meta, wants[i], `${i}번째 왕복`);
  });
  // 한도: 201자는 가져올 때 200자로(내보내기는 자르지 않는다)
  const long = await app.page.evaluate(() => {
    const score = SF.core.createScore({ title: 'x', measureCount: 1 });
    Object.assign(score.meta, { subtitle: 's'.repeat(201), lyricist: 'l'.repeat(300), copyright: 'c'.repeat(1000) });
    const xml = SF.io.exportMusicXML(score);
    return { kept: xml.includes('s'.repeat(201)), meta: { ...SF.io.parseMusicXML(xml).score.meta } };
  });
  assert.equal(long.kept, true, '내보내기는 글을 자르지 않는다');
  assert.deepEqual([long.meta.subtitle.length, long.meta.lyricist.length, long.meta.copyright.length], [200, 200, 200]);
  assert.deepEqual(app.errors, []);
});

test('P9-3 MusicXML 가져오기: 제어 문자가 든 글도 올바른 XML로 나가 다시 읽힌다(제어 문자만 빠진다)', { skip, timeout: 60000 }, async () => {
  const out = await app.page.evaluate(() => {
    const score = SF.core.createScore({ title: 'x', measureCount: 1 });
    Object.assign(score.meta, { title: 'a\u0001b', composer: 'c\u0002d', subtitle: 's\u0003t', lyricist: 'l\u0008m', copyright: 'r\u001fq' });
    const xml = SF.io.exportMusicXML(score);
    return { wellFormed: !new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'), meta: { ...SF.io.parseMusicXML(xml).score.meta } };
  });
  assert.equal(out.wellFormed, true);
  assert.deepEqual(out.meta, { title: 'ab', composer: 'cd', subtitle: 'st', lyricist: 'lm', copyright: 'rq' });
});

test('P9-3 MusicXML 가져오기: 여러 프로그램이 쓰는 모양(creator poet·여러 rights·credit-type 대소문자·여러 credit-words·MuseScore식 파일)을 읽는다', { skip, timeout: 60000 }, async () => {
  const credit = (type, words, attrs = ' page="1"') => `<credit${attrs}><credit-type>${type}</credit-type>${[].concat(words).map(w => `<credit-words>${w}</credit-words>`).join('')}</credit>`;
  const work = (title = 'T') => `<work><work-title>${title}</work-title></work>`;
  const idn = inner => `<identification>${inner}</identification>`;
  const cases = [
    ['MuseScore식 — work·movement·identification·credit이 함께 있다', [work('Moon'), '<movement-title>Moon</movement-title>',
      idn('<creator type="composer">Beethoven</creator><creator type="lyricist">Words Person</creator><rights>© Public domain</rights><encoding><software>MuseScore</software></encoding>'),
      credit('title', 'Moon'), credit('subtitle', 'Sonata No. 14'), credit('composer', 'Beethoven'), credit('lyricist', 'Words Person')].join('\n'),
      { title: 'Moon', composer: 'Beethoven', subtitle: 'Sonata No. 14', lyricist: 'Words Person', copyright: '© Public domain' }],
    ['creator poet은 작사가로 읽는다', work() + idn('<creator type="poet">시인</creator>'), { title: 'T', composer: '', lyricist: '시인' }],
    ['lyricist가 poet보다 우선(순서와 무관)', work() + idn('<creator type="poet">P</creator><creator type="lyricist">L</creator>'), { title: 'T', composer: '', lyricist: 'L' }],
    ['lyricist가 여럿이면 비어 있지 않은 첫 번째', work() + idn('<creator type="lyricist"> </creator><creator type="lyricist">L2</creator><creator type="lyricist">L3</creator>'), { title: 'T', composer: '', lyricist: 'L2' }],
    ['lyricist 앞뒤 공백·줄바꿈', work() + idn('<creator type="lyricist">\n   L   \n</creator>'), { title: 'T', composer: '', lyricist: 'L' }],
    ['creator type의 대소문자·앞뒤 공백', work() + idn('<creator type=" Lyricist ">L5</creator>'), { title: 'T', composer: '', lyricist: 'L5' }],
    ['creator type이 poet이어도 대소문자·공백을 가리지 않는다', work() + idn('<creator type=" POET ">P5</creator>'), { title: 'T', composer: '', lyricist: 'P5' }],
    ['composer·arranger는 작사가가 아니다', work() + idn('<creator type="composer">C</creator><creator type="arranger">A</creator><creator>N</creator>'), { title: 'T', composer: 'C' }],
    ['rights가 여럿이면 " / "로 잇고 빈 것은 건너뛴다', work() + idn('<rights>A</rights><rights> </rights><rights>B &amp; C</rights>'), { title: 'T', composer: '', copyright: 'A / B & C' }],
    ['rights 글자 풀이(개체 참조·이모지)', work() + idn('<rights>© &lt;2026&gt; &amp; &quot;co&quot; 🎼</rights>'), { title: 'T', composer: '', copyright: '© <2026> & "co" 🎼' }],
    ['credit-type 대소문자·공백, page 속성 없음', work() + '<credit><credit-type> SubTitle </credit-type><credit-words> S1 </credit-words></credit>', { title: 'T', composer: '', subtitle: 'S1' }],
    ['credit-type이 여럿인 credit(page number + subtitle)', work() + credit('page number', 'S2').replace('</credit-type>', '</credit-type><credit-type>subtitle</credit-type>'), { title: 'T', composer: '', subtitle: 'S2' }],
    ['credit-words가 여럿이면 공백으로 잇는다', work() + credit('subtitle', ['A', 'B']), { title: 'T', composer: '', subtitle: 'A B' }],
    ['credit-words 사이의 빈 것은 건너뛴다', work() + credit('subtitle', ['A', '', ' ', 'B']), { title: 'T', composer: '', subtitle: 'A B' }],
    ['subtitle credit이 여럿이면 글이 있는 첫 번째', work() + credit('subtitle', '') + credit('subtitle', 'S3') + credit('subtitle', 'S4'), { title: 'T', composer: '', subtitle: 'S3' }],
    ['subtitle이 아닌 credit은 무시한다(title·composer·lyricist·rights·page number·종류 없음)', work('Real') + credit('title', 'Other') + credit('composer', 'X') + credit('lyricist', 'Y') + credit('rights', 'Z') + credit('page number', '2')
      + '<credit page="1"><credit-words>No type</credit-words></credit>', { title: 'Real', composer: '' }],
    ['movement-title은 부제로 읽지 않는다(work-title이 있어도)', work('W') + '<movement-title>M</movement-title>', { title: 'W', composer: '' }],
    ['movement-title만 있으면 제목(기존 동작)', '<movement-title>M</movement-title>', { title: 'M', composer: '' }],
    ['빈 요소는 필드를 만들지 않는다', work() + idn('<creator type="lyricist"/><rights/>') + '<credit page="1"><credit-type>subtitle</credit-type><credit-words/></credit>', { title: 'T', composer: '' }],
    ['아무 머리말이 없으면 기본 제목', '', { title: '가져온 악보', composer: '' }],
  ];
  const metas = await importMeta(cases.map(([, head]) => xmlWith(head)));
  cases.forEach(([label, , want], i) => assert.deepEqual(metas[i], want, label));
  // 한도·서로게이트: 200글자(코드 포인트)로 자르되 이모지를 쪼개지 않는다
  const long = await importMeta([
    xmlWith(work() + idn(`<rights>${'r'.repeat(250)}</rights>`)),
    xmlWith(work() + credit('subtitle', 'a'.repeat(199) + '🎼z')),
    xmlWith(work() + credit('subtitle', 'a'.repeat(200) + '🎼')),
    xmlWith(work() + idn(`<creator type="lyricist">${'🎼'.repeat(150)}</creator>`)),
  ]);
  assert.equal(long[0].copyright, 'r'.repeat(200));
  assert.equal(long[1].subtitle, 'a'.repeat(199) + '🎼', '코드 포인트 200개 = a 199 + 이모지');
  assert.equal(long[2].subtitle, 'a'.repeat(200));
  assert.equal([...long[3].lyricist].length, 150, '한도 안이면 그대로(UTF-16 길이가 200을 넘어도)');
  for (const meta of long) for (const value of Object.values(meta)) assert.doesNotMatch(value, LONE, '서로게이트가 쪼개지지 않았다');
  assert.deepEqual(app.errors, []);
});

test('P9-3 MusicXML 가져오기: schema.js 없이 로드돼도(옛 시험 환경 tests/browser.html) 읽히고, 이때는 글자 수를 자르지 않는다', { skip, timeout: 60000 }, async () => {
  const head = `<work><work-title>T</work-title></work><identification><creator type="lyricist">L</creator><rights>${'r'.repeat(250)}</rights></identification>`
    + `<credit page="1"><credit-type>subtitle</credit-type><credit-words>${'s'.repeat(250)}</credit-words></credit>`;
  const xml = xmlWith(head);
  const out = await app.page.evaluate(xml => {
    const original = SF.schema, results = {};
    try {
      for (const [label, value] of [['없음', undefined], ['LIMITS 없음', {}], ['title 한도 없음', { LIMITS: {} }], ['title 한도가 숫자가 아님', { LIMITS: { title: null } }], ['있음', original]]) {
        SF.schema = value;
        try { results[label] = { ...SF.io.parseMusicXML(xml).score.meta }; } catch (error) { results[label] = { error: String(error && error.message) }; }
      }
    } finally { SF.schema = original; }
    return results;
  }, xml);
  for (const label of ['없음', 'LIMITS 없음', 'title 한도 없음', 'title 한도가 숫자가 아님']) {
    assert.equal(out[label].error, undefined, `${label}: 오류 없이 읽힌다`);
    assert.equal(out[label].title, 'T');
    assert.equal(out[label].lyricist, 'L');
    assert.equal(out[label].subtitle, 's'.repeat(250), `${label}: 한도를 모르면 자르지 않는다`);
    assert.equal(out[label].copyright, 'r'.repeat(250), `${label}: 한도를 모르면 자르지 않는다`);
  }
  assert.equal(out['있음'].subtitle, 's'.repeat(200), 'schema.js가 있으면 200글자로 자른다');
  assert.equal(out['있음'].copyright, 'r'.repeat(200));
  assert.equal(await app.page.evaluate(() => typeof SF.schema?.LIMITS?.title), 'number', '시험 뒤 SF.schema가 원래대로 돌아와 있다');
  assert.deepEqual(app.errors, []);
});

// ---------------------------------------------------------------- ② 메뉴
const MENU_SHAPE = () => [...document.querySelector('#file-menu').children].map(el => {
  if (el.tagName === 'HR') return 'hr';
  if (el.id === 'cloud-menu') return 'group:cloud-menu';
  if (el.classList.contains('mtitle')) return 'title:' + el.textContent.trim();
  const item = el.matches('[role^="menuitem"]') ? el : el.querySelector('[role^="menuitem"]');
  return item ? 'act:' + (item.dataset.act || item.dataset.action || item.textContent.trim()) : 'other:' + el.tagName;
});
const ORDER = ['act:new', 'act:open', 'act:recent', 'act:save', 'act:save-legacy', 'hr', 'title:내보내기', 'act:musicxml', 'act:midi', 'act:svg', 'act:png', 'act:print', 'hr',
  'title:설명서', 'act:manual-quick', 'act:manual-user', 'hr', 'title:데모 악보 열기', 'act:demo-butterfly', 'act:demo-star', 'act:demo-airplane', 'act:demo-rhythm'];

test('P9-3 파일 메뉴 순서: 새로·열기·최근·저장 / 내보내기(MusicXML·MIDI·SVG·PNG·인쇄) / 설명서 / 데모, 클라우드 묶음은 맨 끝', { skip, timeout: 60000 }, async () => {
  const { page } = app;
  const shape = await page.evaluate(MENU_SHAPE);
  assert.deepEqual(shape, [...ORDER, 'group:cloud-menu'], '고정 항목 뒤에 클라우드 묶음이 맨 끝에 하나');
  const cloud = await page.evaluate(() => { const group = document.querySelector('#cloud-menu'); return { first: group.firstElementChild.tagName, items: group.querySelectorAll('[role^="menuitem"]').length }; });
  assert.deepEqual(cloud, { first: 'HR', items: 5 }, '클라우드 묶음은 구분선으로 시작하고 항목 5개(저장·내 악보·공유·자동 저장·사본)');
  assert.equal(shape.filter(s => s === 'act:svg').length, 1); assert.equal(shape.filter(s => s === 'act:png').length, 1);
  // role=menuitem 합계는 그대로(고정 14 + SVG·PNG 2 + 클라우드 4 = 20), 모든 항목이 .mi
  const counts = await page.evaluate(() => ({ items: document.querySelectorAll('#file-menu [role="menuitem"]').length, plain: [...document.querySelectorAll('#file-menu [role="menuitem"]')].filter(el => !el.classList.contains('mi')).length }));
  assert.deepEqual(counts, { items: 20, plain: 0 });
  // 새로 끼운 SVG·PNG 항목은 다른 항목과 같은 모양(버튼·역할·이름)
  const tags = await page.evaluate(() => ['svg', 'png'].map(act => { const b = document.querySelector(`#file-menu [data-act="${act}"]`); return [b.tagName, b.type, b.getAttribute('role'), b.className, b.textContent]; }));
  assert.deepEqual(tags, [['BUTTON', 'button', 'menuitem', 'mi', 'SVG 내보내기 (글꼴 포함)'], ['BUTTON', 'button', 'menuitem', 'mi', 'PNG 내보내기 (300dpi)']]);
});

test('P9-3 파일 메뉴: ↑↓ 키가 새 순서(MIDI → SVG → PNG → 인쇄 → 설명서)를 따라가고, 영어로 바꾸면 구역 제목이 Export다', { skip, timeout: 60000 }, async () => {
  const { page } = app;
  await openFileMenu();
  await page.focus('#file-menu [data-act="midi"]');
  const walk = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); walk.push(await page.evaluate(() => document.activeElement.dataset.act)); }
  const back = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowUp'); back.push(await page.evaluate(() => document.activeElement.dataset.act)); }
  await page.keyboard.press('Escape');   // 값을 확인하기 전에 메뉴를 닫아 두어, 실패해도 다음 시험에 열린 채 남지 않게 한다
  await page.waitForFunction(() => !document.querySelector('#file-menu').matches(':popover-open'));
  assert.deepEqual(walk, ['svg', 'png', 'print', 'manual-quick']);
  assert.deepEqual(back, ['print', 'png', 'svg']);
  await page.evaluate(() => SF.i18n.setLanguage('en'));
  try {
    await page.waitForFunction(() => document.querySelector('#file-menu .mtitle').textContent.trim() === 'Export');
    const titles = await page.evaluate(() => [...document.querySelectorAll('#file-menu .mtitle')].map(el => el.textContent.trim()));
    assert.deepEqual(titles, ['Export', 'Manuals', 'Open a demo score']);
    const labels = await page.evaluate(() => ['svg', 'png', 'print'].map(act => document.querySelector(`#file-menu [data-act="${act}"]`).textContent.trim()));
    assert.deepEqual(labels, ['Export SVG (with font)', 'Export PNG (300 dpi)', '🖨️ Print / Save PDF']);
  } finally {
    await page.evaluate(() => SF.i18n.setLanguage('ko'));
    await page.waitForFunction(() => document.querySelector('#file-menu .mtitle').textContent.trim() === '내보내기');
  }
  assert.deepEqual(app.errors, []);
});

// ---------------------------------------------------------------- ③ 내려받기
const pyCheck = file => {
  const code = 'import sys, json, zipfile, hashlib\nz = zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad": z.testzip(), "entries": [[i.filename, i.file_size, i.compress_type, i.flag_bits & 0x800, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]}, ensure_ascii=False))';
  const r = spawnSync('python3', ['-I', '-c', code, file], { encoding: 'utf8' });
  return r.error ? null : r;
};
const sha = data => createHash('sha256').update(data).digest('hex');

const menuOpen = () => app.page.evaluate(() => document.querySelector('#file-menu').matches(':popover-open'));
async function openFileMenu() {   // 앞 시험이 메뉴를 연 채 끝났어도(실패 포함) 같은 상태에서 시작한다
  const { page } = app;
  if (!await menuOpen()) await page.click('#btn-file');
  await page.waitForFunction(() => document.querySelector('#file-menu').matches(':popover-open'));
}
const forgetDownloads = () => app.page.evaluate(() => { window.__downloads = []; });
const recordedDownloads = () => app.page.evaluate(async () => {
  await Promise.all(window.__downloads.map(record => record.done));
  const toBase64 = u8 => { let text = ''; for (let i = 0; i < u8.length; i += 0x8000) text += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(text); };
  return window.__downloads.map(record => ({ name: record.name, type: record.type, base64: toBase64(record.bytes) }));
});
async function exportVia(format) {
  const { page } = app;
  await openFileMenu();
  await forgetDownloads();
  const wait = page.waitForEvent('download', { timeout: 60000 });
  await page.click(`#file-menu [data-act="${format}"]`);
  const download = await wait;
  const recorded = await recordedDownloads();
  assert.equal(recorded.length, 1, '내려받기는 정확히 한 번(여러 쪽도 파일 하나)');
  const bytes = Buffer.from(recorded[0].base64, 'base64');
  assert.ok(bytes.equals(await readFile(await download.path())), '실제로 내려받아진 파일이 앱이 만든 바이트와 같다');
  return { download, name: recorded[0].name, type: recorded[0].type, bytes };
}
const toastText = () => app.page.evaluate(() => document.querySelector('#toast').textContent);
// 쪽이 2장 이상 나오는 악보로 바꾼다(필요한 마디 수는 조판 결과로 찾는다). 제목은 한글·& 포함.
async function multiPageScore(title) {
  return app.page.evaluate(async t => {
    for (const n of [30, 50, 80, 120, 200, 300]) {
      const score = SF.core.createScore({ title: t, measureCount: n });
      score.meta.title = t;
      SF.core.setScore(score); SF.app.update({ immediate: true });
      const result = await SF.exportUI.exportPages();
      if (result.pages.length >= 2) return { measures: n, pages: result.pages.length };
    }
    throw new Error('쪽이 2장 이상 나오지 않았다');
  }, title);
}
async function captureZip() {   // SF.zip.create가 받은 항목을 붙잡아 둔다(내려받은 ZIP과 같은지 비교하려고)
  await app.page.evaluate(() => {
    if (!window.__zipOriginal) window.__zipOriginal = SF.zip.create;
    window.__zipCalls = [];
    SF.zip.create = (entries, options) => { window.__zipCalls.push(entries); return window.__zipOriginal(entries, options); };
  });
}
async function releaseZip() { await app.page.evaluate(() => { if (window.__zipOriginal) { SF.zip.create = window.__zipOriginal; delete window.__zipOriginal; } }); }
const capturedHashes = () => app.page.evaluate(async () => Promise.all(window.__zipCalls.flat().map(async entry => {
  const data = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data instanceof ArrayBuffer ? new Uint8Array(entry.data) : new Uint8Array(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return { name: entry.name, kind: typeof entry.data === 'string' ? 'string' : 'bytes', sha: [...digest].map(b => b.toString(16).padStart(2, '0')).join('') };
})));

test('P9-3 여러 쪽 SVG 내보내기: 파일 메뉴의 항목 하나로 ZIP 하나가 내려오고, 안에는 쪽마다 SVG가 있다', { skip, timeout: 180000 }, async () => {
  const title = '나비야 & 친구들';
  const { pages } = await multiPageScore(title);
  assert.ok(pages >= 2);
  await captureZip();
  try {
    const got = await exportVia('svg');
    assert.equal(got.name, `${title}-svg.zip`, 'ZIP 파일 이름');
    assert.equal(got.type, 'application/zip');
    const parsed = parseZip(new Uint8Array(got.bytes));
    assert.equal(parsed.count, pages, '쪽마다 하나');
    const width = String(pages).length;
    assert.deepEqual(parsed.entries.map(e => e.name), Array.from({ length: pages }, (_, i) => `${title}-${String(i + 1).padStart(width, '0')}.svg`));
    for (const entry of parsed.entries) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data);
      assert.match(text, /^<svg\b/, `${entry.name}: SVG로 시작`);
      assert.match(text, /<\/svg>\s*$/, `${entry.name}: SVG로 끝남`);
      assert.ok(text.includes('BravuraSF'), `${entry.name}: 글꼴이 들어 있다`);
      assert.equal(text.includes('note-hit'), false, `${entry.name}: 클릭 영역이 섞이지 않았다`);
    }
    // ZIP에 넣으라고 넘긴 항목과 내려받은 ZIP의 내용이 같다
    const captured = await capturedHashes();
    assert.deepEqual(captured.map(c => c.name), parsed.entries.map(e => e.name));
    assert.deepEqual(captured.map(c => c.sha), parsed.entries.map(e => sha(e.data)));
    // 독립 도구로도 열린다
    const py = pyCheck(await got.download.path());
    if (py) {
      assert.equal(py.status, 0, py.stderr);
      const out = JSON.parse(py.stdout);
      assert.equal(out.bad, null);
      assert.deepEqual(out.entries.map(e => [e[0], e[2], e[3]]), parsed.entries.map(e => [e.name, 0, 0x800]));
      assert.deepEqual(out.entries.map(e => e[4]), parsed.entries.map(e => sha(e.data)));
    }
    const unzip = spawnSync('unzip', ['-t', await got.download.path()], { encoding: 'utf8' });
    if (!unzip.error) { assert.equal(unzip.status, 0, unzip.stdout); assert.match(unzip.stdout, /No errors detected/); }
    assert.equal(await toastText(), '글꼴을 포함한 SVG를 ZIP 파일 하나로 묶어 내보냈어요.');
  } finally { await releaseZip(); }
  assert.deepEqual(app.errors, []);
});

test('P9-3 여러 쪽 PNG 내보내기: ZIP 하나, 안의 PNG는 300dpi 크기·pHYs·모든 덩어리의 CRC가 맞다', { skip, timeout: 240000 }, async () => {
  const title = 'PNG 시험';
  const { pages } = await multiPageScore(title);
  await captureZip();
  try {
    const got = await exportVia('png');
    assert.equal(got.name, `${title}-png.zip`);
    assert.equal(got.type, 'application/zip');
    const parsed = parseZip(new Uint8Array(got.bytes));
    assert.equal(parsed.count, pages);
    const width = String(pages).length;
    assert.deepEqual(parsed.entries.map(e => e.name), Array.from({ length: pages }, (_, i) => `${title}-${String(i + 1).padStart(width, '0')}.png`));
    for (const entry of parsed.entries) {
      const data = Buffer.from(entry.data);
      assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${entry.name}: PNG 서명`);
      const chunks = []; let offset = 8;
      while (offset < data.length) {
        const length = data.readUInt32BE(offset), type = data.toString('latin1', offset + 4, offset + 8), body = data.subarray(offset + 8, offset + 8 + length);
        assert.equal(data.readUInt32BE(offset + 8 + length), crcBitwise(data.subarray(offset + 4, offset + 8 + length)), `${entry.name}: ${type} 덩어리 CRC`);
        chunks.push({ type, body }); offset += 12 + length;
      }
      assert.equal(offset, data.length, `${entry.name}: 덩어리가 파일 끝에서 정확히 끝난다`);
      assert.equal(chunks[0].type, 'IHDR'); assert.equal(chunks.at(-1).type, 'IEND');
      assert.equal(chunks.filter(c => c.type === 'pHYs').length, 1, 'pHYs 하나');
      assert.deepEqual([chunks[0].body.readUInt32BE(0), chunks[0].body.readUInt32BE(4)], [2480, 3508], `${entry.name}: A4 세로 300dpi`);
      const phys = chunks.find(c => c.type === 'pHYs').body;
      assert.deepEqual([phys.readUInt32BE(0), phys.readUInt32BE(4), phys[8]], [11811, 11811, 1], '300dpi = 11811픽셀/미터');
    }
    const captured = await capturedHashes();
    assert.deepEqual(captured.map(c => c.sha), parsed.entries.map(e => sha(e.data)), 'ZIP에 넣으라고 넘긴 바이트와 같다');
    assert.ok(captured.every(c => c.kind === 'bytes'));
    const py = pyCheck(await got.download.path());
    if (py) { assert.equal(py.status, 0, py.stderr); assert.equal(JSON.parse(py.stdout).bad, null); }
    assert.equal(await toastText(), '300dpi PNG를 ZIP 파일 하나로 묶어 내보냈어요.');
  } finally { await releaseZip(); }
  assert.deepEqual(app.errors, []);
});

test('P9-3 한 쪽짜리 악보: ZIP 없이 지금처럼 파일 하나(SVG·PNG)이고 알림도 그대로다', { skip, timeout: 120000 }, async () => {
  const { page } = app;
  await page.evaluate(() => { const s = SF.core.createScore({ title: '한 쪽', measureCount: 4 }); SF.core.setScore(s); SF.app.update({ immediate: true }); });
  assert.equal(await page.evaluate(async () => (await SF.exportUI.exportPages()).pages.length), 1, '전제: 한 쪽');
  await captureZip();
  try {
    const svg = await exportVia('svg');
    assert.equal(svg.name, '한 쪽.svg');
    assert.equal(svg.type, 'image/svg+xml');
    assert.match(svg.bytes.toString('utf8'), /^<svg\b/);
    assert.equal(await toastText(), '글꼴을 포함한 SVG를 내보냈어요.');
    const png = await exportVia('png');
    assert.equal(png.name, '한 쪽.png');
    assert.equal(png.type, 'image/png');
    assert.deepEqual([...png.bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(await toastText(), '300dpi PNG를 내보냈어요.');
    assert.equal(await page.evaluate(() => window.__zipCalls.length), 0, 'ZIP 작성기를 부르지 않았다');
  } finally { await releaseZip(); }
  assert.deepEqual(app.errors, []);
});

test('P9-3 내보내기 이름: 제목의 경로 글자·제어 문자는 밑줄이 되어 ZIP·파일 이름이 된다', { skip, timeout: 180000 }, async () => {
  const title = 'a\nb/c:d';
  const { pages } = await multiPageScore(title);
  const got = await exportVia('svg');
  assert.equal(got.name, 'a_b_c_d-svg.zip');
  const parsed = parseZip(new Uint8Array(got.bytes));
  assert.equal(parsed.count, pages);
  assert.ok(parsed.entries.every(e => e.name.startsWith('a_b_c_d-') && e.name.endsWith('.svg')));
  await app.page.evaluate(() => { const s = SF.core.createScore({ title: 'x', measureCount: 2 }); s.meta.title = 'x\ny/z'; SF.core.setScore(s); SF.app.update({ immediate: true }); });
  const single = await exportVia('svg');
  assert.equal(single.name, 'x_y_z.svg');
  assert.deepEqual(app.errors, []);
});

test('P9-3 ZIP을 만들다 실패하면(너무 큼 등) 내려받기 없이 알림만 나온다', { skip, timeout: 180000 }, async () => {
  const { page } = app;
  await multiPageScore('실패 시험');
  await page.evaluate(() => { window.__zipOriginal = SF.zip.create; SF.zip.create = () => { throw new RangeError('내보낼 파일이 너무 커서 ZIP으로 묶을 수 없어요.'); }; });
  try {
    await openFileMenu();
    await forgetDownloads();
    const downloads = []; const onDownload = d => downloads.push(d); page.on('download', onDownload);
    await page.click('#file-menu [data-act="svg"]');
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('너무 커서'));
    await page.waitForTimeout(1200);
    page.off('download', onDownload);
    assert.equal(downloads.length, 0, '내려받기가 없다');
    assert.deepEqual(await recordedDownloads(), [], '앵커 내려받기도 시도하지 않았다');
    assert.equal(await toastText(), '내보낼 파일이 너무 커서 ZIP으로 묶을 수 없어요.');
  } finally { await releaseZip(); }
  // 실패 뒤에도 다음 내보내기는 정상
  const ok = await exportVia('svg');
  assert.match(ok.name, /-svg\.zip$/);
  assert.deepEqual(app.errors, []);
});
