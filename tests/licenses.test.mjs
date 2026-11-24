// P9-5: 라이선스 고지 — fonts/OFL.txt · THIRD_PARTY_NOTICES.md · licenses.html · 도움말 창의 "정보" 구역.
//  a. OFL.txt가 글꼴 파일 안의 문구와 같다      b. 구성 요소 표가 실제 파일·버전과 맞다      c. 음원 표가 앱이 쓰는 호스트를 모두 다룬다
//  d. 확인 필요 목록·저장소 LICENSE 상태          e. licenses.html은 생성 결과와 같고 안전하다   f. 생성기 오류 처리
//  g. 정보 구역(index.html·번역)                   h. 실제 브라우저(좁은 폭 포함)
// 브라우저 시험 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/licenses.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
import { build, TEXTS } from './gen-licenses.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;
const read = path => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const notices = () => read('THIRD_PARTY_NOTICES.md');

/* ---------- WOFF2 안의 name 표 읽기(외부 도구 없이: 표 디렉터리 + brotli) ---------- */
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function woff2Tables(buffer) {
  assert.equal(buffer.toString('latin1', 0, 4), 'wOF2', 'WOFF2 파일이 아니다');
  const numTables = buffer.readUInt16BE(12), compressedSize = buffer.readUInt32BE(20);
  let at = 48;
  const base128 = () => { let value = 0; for (let i = 0; i < 5; i++) { const byte = buffer[at++]; value = value * 128 + (byte & 0x7f); if (!(byte & 0x80)) return value; } throw new Error('UIntBase128 오류'); };
  const directory = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buffer[at++], index = flags & 0x3f, version = flags >> 6;
    let tag = KNOWN_TAGS[index];
    if (index === 63) { tag = buffer.toString('latin1', at, at + 4); at += 4; }
    const original = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    directory.push({ tag, stored: transformed ? base128() : original, transformed });
  }
  const data = brotliDecompressSync(buffer.subarray(at, at + compressedSize));
  const tables = {};
  let offset = 0;
  for (const entry of directory) { tables[entry.tag] = { ...entry, bytes: data.subarray(offset, offset + entry.stored) }; offset += entry.stored; }
  return tables;
}
function fontName(buffer, nameId) {
  const { name } = woff2Tables(buffer);
  assert.ok(name && !name.transformed, 'name 표를 읽을 수 없다');
  const bytes = name.bytes, count = bytes.readUInt16BE(2), base = bytes.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const [platform, , language, id, length, offset] = [0, 2, 4, 6, 8, 10].map(delta => bytes.readUInt16BE(record + delta));
    if (platform === 3 && language === 0x409 && id === nameId) return Buffer.from(bytes.subarray(base + offset, base + offset + length)).swap16().toString('utf16le');
  }
  throw new assert.AssertionError({ message: `name ID ${nameId}이(가) 없다` });
}

/* ---------- THIRD_PARTY_NOTICES.md 표 읽기 ---------- */
function section(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}`);
  assert.ok(start >= 0, `"## ${heading}" 절이 없다`);
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next < 0 ? undefined : next);
}
function tableRows(text) {
  const lines = text.split('\n').filter(line => line.startsWith('|')).map(line => line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
  const [head, , ...body] = lines;
  return body.map(row => Object.fromEntries(head.map((name, i) => [name, row[i]])));
}
const code = cell => /`([^`]+)`/.exec(cell)?.[1];
const linkTarget = cell => /\]\(([^)]+)\)/.exec(cell)?.[1];

test('P9-5a fonts/OFL.txt는 글꼴 파일(Bravura.woff2) 안의 저작권·SIL OFL 1.1 문구와 같다', () => {
  const font = readFileSync('fonts/Bravura.woff2');
  const embedded = fontName(font, 0);
  assert.match(embedded, /Steinberg Media Technologies GmbH/);
  assert.match(embedded, /SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/);
  assert.equal(read('fonts/OFL.txt').trim(), embedded.replace(/\r\n?/g, '\n').trim(), 'OFL.txt는 글꼴 파일 안의 문구를 그대로 옮긴 것이어야 한다 — 글꼴을 바꾸면 OFL.txt와 고지도 바꾼다');
  assert.match(fontName(font, 5), /^Version \d+\.\d+$/);
});

test('P9-5b 구성 요소 표: 이름·버전·파일·전문이 실제 저장소와 맞다(글꼴 버전은 글꼴 파일, 라이브러리 버전은 vendor/manifest.json)', () => {
  const rows = tableRows(section(notices(), '1.'));
  assert.deepEqual(rows.map(row => row['구성 요소']), ['Bravura', 'supabase-js', 'smplr']);
  const manifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8'));
  const versionOf = pattern => { const hit = manifest.map(entry => pattern.exec(entry.url)).find(Boolean); assert.ok(hit, `${pattern} 가 vendor/manifest.json에 없다`); return hit[1]; };
  const expected = {
    Bravura: { version: /^Version (.+)$/.exec(fontName(readFileSync('fonts/Bravura.woff2'), 5))[1], license: /SIL Open Font License 1\.1/, text: /SIL OPEN FONT LICENSE Version 1\.1/ },
    'supabase-js': { version: versionOf(/supabase-js@([\d.]+)\//), license: /^MIT$/, text: /^MIT License[\s\S]*Copyright \(c\) 2020 Supabase/ },
    smplr: { version: versionOf(/smplr@([\d.]+)\//), license: /^MIT$/, text: /MIT License/ },
  };
  for (const row of rows) {
    const want = expected[row['구성 요소']];
    assert.equal(row['버전'], want.version, `${row['구성 요소']} 버전`);
    assert.match(row['라이선스'], want.license);
    assert.ok(existsSync(code(row['파일'])), `${row['파일']} 파일이 있어야 한다`);
    const textFile = linkTarget(row['라이선스 전문']);
    assert.ok(existsSync(textFile), `${textFile} 파일이 있어야 한다`);
    assert.match(read(textFile), want.text, `${textFile} 안의 라이선스 문구`);
    assert.ok(TEXTS.some(text => text.file === textFile), `${textFile}은 licenses.html에 전문으로 실린다`);
  }
  assert.equal(JSON.parse(readFileSync('vendor/smplr/package.json', 'utf8')).version, expected.smplr.version, '표의 smplr 버전 = vendor/smplr/package.json');
});

test('P9-5c 음원 표: 서비스 워커의 SAMPLE_HOSTS를 모두 다루고, 재배포 판단 칸이 비어 있지 않으며, 재배포가 불명인 음원의 복사본은 저장소에 없다', () => {
  const hosts = [...readFileSync('sw.js', 'utf8').match(/SAMPLE_HOSTS = new Set\(\[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.ok(hosts.length >= 3);
  const rows = tableRows(section(notices(), '2.'));
  for (const host of hosts) assert.ok(rows.some(row => row['불러오는 서버'].includes(host)), `${host} 이(가) 음원 표에 없다 — 새 음원 서버를 쓰면 고지도 고친다`);
  for (const row of rows) for (const column of ['음원', '쓰이는 곳', '불러오는 서버', '재배포·자체 호스팅']) assert.ok(row[column] && row[column].length > 1, `${row['음원']}: "${column}" 칸이 비어 있다`);
  const soundfont = rows.find(row => /Soundfont/.test(row['음원']));
  assert.match(soundfont['재배포·자체 호스팅'], /불명/, '출처가 엇갈리는 Soundfont는 재배포 불명으로 적는다');
  assert.match(soundfont['라이선스(출처 기재)'], /CC BY-SA 3\.0/);
  assert.match(rows.find(row => /Splendid/.test(row['음원']))['라이선스(출처 기재)'], /Public Domain/);
  // 표가 "저장소에 샘플 파일을 넣지 않았다"고 말하는 만큼, 실제로 음원 파일이 없어야 한다(자체 호스팅을 하게 되면 표와 이 시험을 함께 고친다)
  const found = [];
  (function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'output'].includes(item.name)) continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path); else if (/\.(mp3|ogg|m4a|wav|flac|aac|opus|sf2|sfz)$/i.test(item.name)) found.push(path);
    }
  })('.');
  assert.deepEqual(found, [], '음원 파일이 저장소에 들어 있다 — THIRD_PARTY_NOTICES.md 2절의 재배포 판단과 함께 고쳐야 한다');
});

test('P9-5d "확인 필요" 목록과 저장소 LICENSE 상태가 문서끼리 맞고, 지어낸 연락처가 없다', () => {
  const text = notices();
  const open = section(text, '3.').split('\n').filter(line => /^\d+\. /.test(line));
  assert.ok(open.length >= 4, `확인 필요 항목이 ${open.length}개 — 확인하지 못한 것은 지어내지 말고 여기에 남긴다`);
  assert.doesNotMatch(text.replace(/@supabase\/[a-z-]+/g, ''), /@[a-z0-9-]+\.[a-z]{2,}|\b0\d{1,2}-\d{3,4}-\d{4}\b/i, '이메일·전화번호를 적지 않는다');
  const decisions = read('docs/DECISIONS.md');
  assert.match(decisions, /\n\| D5 \| 저장소 LICENSE/, 'docs/DECISIONS.md에 D5 행이 있어야 한다');
  if (existsSync('LICENSE')) assert.doesNotMatch(text, /저장소에 `LICENSE`가 없습니다/, 'LICENSE가 생겼으면 이 문장을 고친다');
  else assert.match(text, /저장소에 `LICENSE`가 없습니다/, 'LICENSE가 없는 동안은 그렇다고 적는다');
});

test('P9-5e licenses.html: 생성기 출력과 같고, 스크립트·외부 자원 없이 css/privacy.css만 쓰며, 전문 3개가 그대로 들어 있다', async () => {
  const html = read('licenses.html');
  assert.equal(html, await build(), 'licenses.html이 오래됐다 — node tests/gen-licenses.mjs 로 다시 만든다');
  assert.doesNotMatch(html, /<script|\bsrc=|\bon[a-z]+=|<iframe|<img|<object|<embed/i, '스크립트·이미지·외부 삽입이 없다');
  assert.deepEqual([...html.matchAll(/<link [^>]*>/g)].map(match => match[0]).filter(tag => !/rel="icon" href="data:/.test(tag)), ['<link rel="stylesheet" href="css/privacy.css">']);
  for (const tag of html.match(/<a [^>]*href="https?:[^>]*>/g) || []) assert.match(tag, /rel="noopener noreferrer"/, tag);
  assert.equal((html.match(/<td[ >]/g) || []).length, (html.match(/<td data-label="[^"]+">/g) || []).length, '모든 표 칸에 data-label이 있어야 좁은 화면(카드 모양)에서 제목이 보인다');
  assert.match(html, /<body class="wide">/, '칸이 많은 표라 넓은 본문 폭 표시(css/privacy.css의 body.wide)가 필요하다');
  const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const { id, file } of TEXTS) {
    const hit = new RegExp(`<h3 id="${id}">[\\s\\S]*?</h3>\\s*<pre>([\\s\\S]*?)</pre>`).exec(html);
    assert.ok(hit, `${id} 절이 없다`);
    assert.equal(unescape(hit[1]), read(file).replace(/\n+$/, ''), `${file} 전문`);
  }
  for (const link of [...notices().matchAll(/\]\((fonts\/[^)]+|vendor\/[^)]+)\)/g)].map(match => match[1])) assert.ok(html.includes(`href="#${TEXTS.find(text => text.file === link).id}"`), `${link} 링크는 같은 쪽의 전문으로 이어진다`);
  assert.match(html, /<h1>제3자 구성 요소 고지 <span class="sub">Third-party notices<\/span><\/h1>/);
  assert.match(html, /<a href="privacy\.html">/, '개인정보 처리 안내로 가는 링크');
  assert.ok(JSON.parse(readFileSync('precache-manifest.json', 'utf8')).includes('licenses.html'), '오프라인에서도 열리도록 사전 캐시에 있다');
});

test('P9-5f 생성기: 모르는 링크·칸 수가 다른 표·제목 모양이 틀린 문서는 거절하고, 본문의 HTML은 이스케이프한다', async () => {
  const make = (body, title = '# 제목 (Title)') => {
    const dir = mkdtempSync(join(tmpdir(), 'licenses-'));
    writeFileSync(join(dir, 'THIRD_PARTY_NOTICES.md'), `${title}\n\n${body}\n`);
    for (const { file } of TEXTS) { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), `  ${file} <b>&</b>\n\n`); }
    return { dir, root: pathToFileURL(dir + '/') };
  };
  const cases = [
    [() => make('[나쁨](docs/secret.md)'), /지원하지 않는 링크/],
    [() => make('[나쁨](javascript:alert(1))'), /지원하지 않는 링크/],
    [() => make('| a | b |\n|---|---|\n| 1 | 2 | 3 |'), /칸 수/],
    [() => make('| a | b |\n| 1 | 2 |'), /둘째 줄/],
    [() => make('본문', '# 영어 제목만'), /첫 줄은/],
  ];
  for (const [factory, message] of cases) {
    const { dir, root } = factory();
    try { await assert.rejects(() => build(root), message); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const { dir, root } = make('<script>alert(1)</script> **굵게** `<b>` [좋음](https://example.com/a?b=1&c=2)\n\n| 열 |\n|---|\n| <img src=x onerror=alert(1)> |');
  try {
    const html = await build(root);
    assert.doesNotMatch(html, /<script>|<img src=x/, '입력의 태그는 그대로 살아남지 않는다');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; <strong>굵게<\/strong> <code>&lt;b&gt;<\/code>/);
    assert.match(html, /href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /<pre>  fonts\/OFL\.txt &lt;b&gt;&amp;&lt;\/b&gt;<\/pre>/, '전문은 앞쪽 들여쓰기를 지키고 끝의 빈 줄만 뺀다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P9-5g 도움말 창 "정보" 구역: 버전 칸과 두 링크가 있고 앱이 버전을 채우며, 영어 문구가 모두 있다', () => {
  const html = read('index.html');
  const about = /<section id="help-about"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(about, '#help-about 구역이 있어야 한다');
  assert.ok(html.indexOf('id="dlg-help"') < html.indexOf('id="help-about"') && html.indexOf('id="help-about"') < html.indexOf('id="dlg-recent"'), '도움말 창 안에 있다');
  assert.match(about, /id="about-version"/);
  assert.match(about, /aria-labelledby="about-title"/);
  assert.match(about, /<h3 id="about-title">정보<\/h3>/, '구역 제목(스크린 리더용 이름)');
  assert.match(about, /<a id="link-licenses" href="licenses\.html" target="_blank" rel="noopener">/);
  assert.match(about, /<a id="link-about-privacy" href="privacy\.html" target="_blank" rel="noopener">/);
  assert.match(read('js/app.js'), /\$\("#about-version"\)\.textContent = SF\.VERSION/);
  const context = vm.createContext({ console, navigator: { language: 'ko-KR' }, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(readFileSync('js/i18n.js', 'utf8'), context, { filename: 'i18n.js' });
  context.SF.i18n.setLanguage('en', { persist: false });
  for (const [ko, en] of [['정보', 'About'], ['ScoreForge · 버전 ', 'ScoreForge · Version '], ['라이선스 고지', 'Licenses and credits'], ['개인정보 처리 안내', 'Privacy notice']]) assert.equal(context.SF.i18n.translate(ko), en, ko);
});

/* ---------- 실제 브라우저 ---------- */
async function withPage(fn, { size = { width: 1200, height: 800 }, locale } = {}) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions({ viewport: size, ...(locale ? { locale } : {}) }));
    const page = await context.newPage();
    await preparePage(page);
    page.setDefaultTimeout(10000);
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
    await fn(page, context, problems);
  } finally { await browser.close(); }
}
async function openHelp(page) {
  await page.goto(`${URL_}/`, { waitUntil: 'load' });
  // 시작 절차(start())가 i18n 초기화까지 끝난 뒤에야 언어 전환이 화면에 적용된다 — 글꼴 준비 콜백은 그 뒤에 불린다
  await page.waitForFunction(() => window.SF && SF.core && SF.core.state && SF.core.state.score && SF.engrave && SF.engrave.isFontReady());
  await page.evaluate(() => document.querySelector('#btn-help').click());
  await page.locator('#dlg-help[open]').waitFor();
}

test('P9-5h 도움말 창의 "정보": 버전이 앱 버전과 같고, 라이선스 고지·개인정보 링크가 새 탭에서 열린다', { skip }, async () => {
  await withPage(async (page, context, problems) => {
    await openHelp(page);
    assert.equal(await page.locator('#about-version').innerText(), await page.evaluate(() => SF.VERSION));
    assert.match(await page.locator('#about-version').innerText(), /^\d+\.\d+\.\d+$/);
    const [licenses] = await Promise.all([context.waitForEvent('page'), page.locator('#link-licenses').click()]);
    await licenses.waitForLoadState('load');
    assert.match(licenses.url(), /\/licenses(\.html)?$/);
    assert.match(await licenses.locator('h1').innerText(), /제3자 구성 요소 고지/);
    await licenses.close();
    const [privacy] = await Promise.all([context.waitForEvent('page'), page.locator('#link-about-privacy').click()]);
    await privacy.waitForLoadState('load');
    assert.match(privacy.url(), /\/privacy(\.html)?$/);
    await privacy.close();
    assert.deepEqual(problems, []);
  });
});

test('P9-5i 좁은 화면(375px): 정보 구역이 도움말 창 안에 들어오고 가로로 넘치지 않는다', { skip }, async () => {
  await withPage(async page => {
    await openHelp(page);
    await page.locator('#link-licenses').scrollIntoViewIfNeeded();
    const box = await page.evaluate(() => {
      const dialog = document.querySelector('#dlg-help').getBoundingClientRect(), link = document.querySelector('#link-licenses').getBoundingClientRect(), other = document.querySelector('#link-about-privacy').getBoundingClientRect();
      const d = document.querySelector('#dlg-help');
      return { dialogLeft: dialog.left, dialogRight: dialog.right, link: [link.left, link.right], other: [other.left, other.right], width: innerWidth, scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, linkHeight: link.height };
    });
    assert.ok(box.dialogLeft >= 0 && box.dialogRight <= box.width, JSON.stringify(box));
    assert.ok(box.link[0] >= 0 && box.link[1] <= box.width && box.other[0] >= 0 && box.other[1] <= box.width, JSON.stringify(box));
    assert.ok(box.scrollWidth <= box.clientWidth + 1, `도움말 창이 가로로 넘친다 ${JSON.stringify(box)}`);
  }, { size: { width: 375, height: 700 } });
});

test('P9-5j 영어 화면: 정보 구역에 한국어가 남지 않는다', { skip }, async () => {
  await withPage(async page => {
    await openHelp(page);
    await page.evaluate(() => SF.i18n.setLanguage('en', { persist: false }));
    assert.equal(await page.locator('#about-title').innerText(), 'About');
    assert.equal(await page.locator('#link-licenses').innerText(), 'Licenses and credits');
    assert.equal(await page.locator('#link-about-privacy').innerText(), 'Privacy notice');
    assert.equal(await page.evaluate(() => /[가-힣]/.test(document.querySelector('#help-about').innerText)), false);
  });
});

test('P9-5m 정보 구역 글자 대비: 모든 테마에서 제목·문장·링크가 WCAG AA(4.5:1) 이상이고 링크는 밑줄로 구분된다', { skip }, async () => {
  await withPage(async page => {
    await openHelp(page);
    const themes = await page.evaluate(() => [...document.querySelectorAll('#theme-select option')].map(option => option.value));
    assert.ok(themes.length >= 4, themes.join());
    for (const theme of themes) {
      await page.evaluate(name => SF.app.actions.applyTheme(name), theme);
      const rows = await page.evaluate(() => {
        const numbers = text => (text.match(/[\d.]+/g) || []).map(Number);
        const luminance = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const backgroundOf = element => { for (let node = element; node; node = node.parentElement) { const [r, g, b, a = 1] = numbers(getComputedStyle(node).backgroundColor); if (a > 0.5) return [r, g, b]; } return [255, 255, 255]; };
        return ['#about-title', '#help-about p', '#link-licenses', '#link-about-privacy'].map(selector => {
          const element = document.querySelector(selector), style = getComputedStyle(element);
          const [high, low] = [luminance(numbers(style.color).slice(0, 3)), luminance(backgroundOf(element))].sort((a, b) => b - a);
          return { selector, ratio: (high + 0.05) / (low + 0.05), underline: style.textDecorationLine };
        });
      });
      for (const row of rows) assert.ok(row.ratio >= 4.5, `${theme} 테마 ${row.selector} 글자 대비 ${row.ratio.toFixed(2)}:1 (4.5:1 이상이어야 함)`);
      for (const row of rows.filter(row => row.selector.startsWith('#link'))) assert.match(row.underline, /underline/, `${theme} 테마 ${row.selector}: 색만으로 링크를 구분하지 않는다`);
    }
  });
});

test('P9-5k licenses.html: 배포 헤더(CSP)에서 오류 없이 열리고 외부 요청이 없으며, 375px에서 가로로 넘치지 않는다', { skip }, async () => {
  await withPage(async (page, context, problems) => {
    const requested = [];
    page.on('request', request => requested.push(request.url()));
    await page.goto(`${URL_}/licenses.html`, { waitUntil: 'load' });
    assert.equal(await page.locator('table').count(), 2);
    assert.match(await page.locator('#lic-ofl + pre').innerText(), /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '가로로 넘친다');
    assert.deepEqual(requested.filter(url => !url.startsWith(URL_)), [], '다른 곳으로 가는 요청이 없다');
    assert.deepEqual(problems, [], '콘솔 오류(CSP 위반 포함)가 없다');
    await page.locator('a[href="#lic-ofl"]').first().click();
    assert.ok(await page.evaluate(() => { const rect = document.querySelector('#lic-ofl').getBoundingClientRect(); return rect.top >= 0 && rect.top < innerHeight; }), '전문 링크가 같은 쪽의 전문 위치로 이동한다');
  }, { size: { width: 375, height: 700 } });
});

test('P9-5l licenses.html 넓은 화면: 본문 폭이 표에 충분하고, 표 머리글·버전 칸이 낱말 중간에서 끊기지 않는다', { skip }, async () => {
  // 한 칸의 글이 몇 줄로 보이는지(글자 상자들의 서로 다른 세로 위치 수)
  const linesOf = (page, selector) => page.evaluate(selector => [...document.querySelectorAll(selector)].map(cell => {
    const range = document.createRange(); range.selectNodeContents(cell);
    return { text: cell.textContent.trim(), lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size };
  }), selector);
  await withPage(async page => {
    await page.goto(`${URL_}/licenses.html`, { waitUntil: 'load' });
    const heads = () => linesOf(page, '#s1 + .table-wrap th');
    const versions = () => linesOf(page, 'td[data-label="버전"]');
    const paths = () => linesOf(page, 'td[data-label="파일"]');
    await page.setViewportSize({ width: 1000, height: 800 });
    assert.ok(await page.evaluate(() => document.querySelector('main').getBoundingClientRect().width >= 900), '넓은 화면에서는 본문이 900px 이상이어야 7칸 표가 들어간다');
    assert.deepEqual((await heads()).map(cell => cell.text), ['구성 요소', '버전', '쓰이는 곳', '저작권자', '라이선스', '파일', '라이선스 전문']);
    assert.deepEqual((await heads()).filter(cell => cell.lines !== 1), [], '표 머리글이 줄바꿈으로 쪼개진다');
    assert.deepEqual((await versions()).map(cell => cell.text), ['1.392', '2.114.0', '1.0.0']);
    assert.deepEqual((await paths()).filter(cell => cell.lines !== 1), [], '파일 경로가 줄 중간에서 끊긴다(1000px)');
    await page.setViewportSize({ width: 700, height: 800 });
    assert.deepEqual((await paths()).filter(cell => cell.lines !== 1), [], '파일 경로가 줄 중간에서 끊긴다(700px — 표는 자체 가로 스크롤)');
    assert.deepEqual((await versions()).filter(cell => cell.lines !== 1), [], '버전 숫자가 줄바꿈으로 쪼개진다');
    assert.deepEqual((await heads()).filter(cell => !/\s/.test(cell.text) && cell.lines !== 1), [], '낱말 하나짜리 머리글(버전·저작권자·라이선스·파일)이 중간에서 끊긴다');
    // 앞으로 "2.114.0-rc.1" 같은 버전이 들어와도 한 줄로 남는다(하이픈·공백 자리에서 줄이 바뀌지 않음)
    await page.evaluate(() => { document.querySelector('td[data-label="버전"]').textContent = '2.114.0-rc.1 (beta)'; });
    assert.deepEqual((await versions()).filter(cell => cell.lines !== 1), [], '하이픈이 든 버전이 두 줄로 나뉜다');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '700px에서 쪽 전체가 가로로 넘친다(표만 자체 스크롤)');
  });
});
