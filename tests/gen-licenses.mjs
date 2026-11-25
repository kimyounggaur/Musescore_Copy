// THIRD_PARTY_NOTICES.md + 라이선스 전문 → licenses.html (생성물). licenses.html은 손으로 고치지 않는다.
// 사용: node tests/gen-licenses.mjs           licenses.html을 쓴다
//       node tests/gen-licenses.mjs --check   저장소의 licenses.html이 최신인지만 확인한다(다르면 종료 코드 1)
// 왜 HTML로 만드나: `.md`는 브라우저·배포 서버에 따라 화면에 안 보이고 내려받기가 되기도 하고, 앱이 오프라인에서도
// 열 수 있어야 한다(사전 캐시). 그래서 같은 내용을 css/privacy.css를 쓰는 정적 페이지로 만든다. 글꼴·MIT 전문도 한 쪽에 싣는다.
// 지원하는 마크다운은 THIRD_PARTY_NOTICES.md가 쓰는 만큼뿐이다: # ## ### 제목, 문단, "- " 목록, "1. " 목록, 표, `코드`, **굵게**, [링크](주소).
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SOURCE = 'THIRD_PARTY_NOTICES.md';
export const OUTPUT = 'licenses.html';
// 라이선스 전문: 표의 "라이선스 전문" 칸 링크가 같은 쪽의 이 절로 이어진다(오프라인에서도 보이도록 파일 링크 대신 싣는다).
export const TEXTS = [
  { id: 'lic-ofl', file: 'fonts/OFL.txt', title: 'Bravura — SIL Open Font License 1.1' },
  { id: 'lic-supabase', file: 'vendor/supabase-LICENSE', title: 'supabase-js — MIT License' },
  { id: 'lic-smplr', file: 'vendor/smplr/LICENSE', title: 'smplr — MIT License' },
];

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function link(label, href, anchors) {
  if (anchors.has(href)) return `<a href="#${anchors.get(href)}">${esc(label)}</a>`;
  if (/^https:\/\//.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  throw new Error(`지원하지 않는 링크: ${href} — https 주소이거나 라이선스 전문 파일(${TEXTS.map(t => t.file).join(', ')})이어야 한다`);
}

function inline(text, anchors) {
  const out = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    out.push(esc(text.slice(last, match.index)));
    if (match[1] !== undefined) out.push(`<code>${esc(match[1])}</code>`);
    else if (match[2] !== undefined) out.push(`<strong>${inline(match[2], anchors)}</strong>`);
    else out.push(link(match[3], match[4], anchors));
    last = pattern.lastIndex;
  }
  out.push(esc(text.slice(last)));
  return out.join('');
}

function table(rows, anchors) {
  const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  const [head, rule, ...body] = rows.map(cells);
  if (!rule || !rule.every(cell => /^:?-{3,}:?$/.test(cell))) throw new Error('표의 둘째 줄은 |---|---| 모양이어야 한다');
  for (const row of body) if (row.length !== head.length) throw new Error(`표의 칸 수가 머리글과 다르다: ${row.join(' | ')}`);
  const th = head.map(cell => `<th>${inline(cell, anchors)}</th>`).join('');
  const tr = body.map(row => `<tr>${row.map((cell, i) => `<td data-label="${esc(head[i])}">${inline(cell, anchors)}</td>`).join('')}</tr>`).join('\n          ');
  return `<div class="table-wrap">\n      <table>\n        <thead><tr>${th}</tr></thead>\n        <tbody>\n          ${tr}\n        </tbody>\n      </table>\n    </div>`;
}

function render(markdown, anchors) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let title = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let match = /^(#{1,3}) (.+)$/.exec(line);
    if (match) {
      i++;
      if (match[1] === '#') { title = match[2]; continue; }
      const level = match[1].length, number = /^(\d+)\./.exec(match[2]);
      html.push(`<h${level}${number ? ` id="s${number[1]}"` : ''}>${inline(match[2], anchors)}</h${level}>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      html.push(table(rows, anchors));
      continue;
    }
    match = /^(- |\d+\. )/.exec(line);
    if (match) {
      const ordered = match[1] !== '- ', items = [];
      while (i < lines.length && (ordered ? /^\d+\. / : /^- /).test(lines[i])) items.push(lines[i++].replace(ordered ? /^\d+\. / : /^- /, ''));
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>\n${items.map(item => `      <li>${inline(item, anchors)}</li>`).join('\n')}\n    </${tag}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||- |\d+\. )/.test(lines[i])) paragraph.push(lines[i++].trim());
    html.push(`<p>${inline(paragraph.join(' '), anchors)}</p>`);
  }
  return { title, body: html };
}

export async function build(root = new URL('../', import.meta.url)) {
  const read = async path => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n?/g, '\n');
  const anchors = new Map(TEXTS.map(text => [text.file, text.id]));
  const { title, body } = render(await read(SOURCE), anchors);
  const match = /^(.*?) \((.+)\)$/.exec(title);
  if (!match) throw new Error(`${SOURCE} 첫 줄은 "# 한국어 제목 (English title)" 모양이어야 한다`);
  const texts = [];
  for (const text of TEXTS) texts.push(`<h3 id="${text.id}">${esc(text.title)} <span class="file">(<code>${esc(text.file)}</code>)</span></h3>\n    <pre>${esc((await read(text.file)).replace(/\n+$/, ''))}</pre>`);
  return `<!doctype html>
<!-- 이 파일은 tests/gen-licenses.mjs가 ${SOURCE}와 라이선스 전문 파일(${TEXTS.map(t => t.file).join(', ')})에서 만듭니다. 손으로 고치지 마세요(고치면 시험이 실패합니다). -->
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>라이선스 고지 · Licenses and credits — ScoreForge</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎼</text></svg>">
  <link rel="stylesheet" href="css/privacy.css">
</head>
<body class="wide">
<main>
  <header>
    <p class="back"><a href="./">← ScoreForge</a></p>
    <h1>${esc(match[1])} <span class="sub">${esc(match[2])}</span></h1>
    <p class="meta"><a href="privacy.html">개인정보 처리 안내 · Privacy notice</a></p>
  </header>

  <section id="notices">
    ${body.join('\n    ')}
  </section>

  <section id="texts">
    <h2>라이선스 전문 (License texts)</h2>
    ${texts.join('\n    ')}
  </section>
</main>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = new URL(`../${OUTPUT}`, import.meta.url);
  const html = await build();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = (await readFile(output, 'utf8')).replace(/\r\n?/g, '\n'); } catch {}
    if (current !== html) { console.error(`${OUTPUT}이 ${SOURCE}와 맞지 않는다. node tests/gen-licenses.mjs 로 다시 만든다.`); process.exit(1); }
    console.log(`${OUTPUT} is up to date`);
  } else {
    await writeFile(output, html);
    console.log(`Generated ${OUTPUT}: ${html.length} chars`);
  }
}
