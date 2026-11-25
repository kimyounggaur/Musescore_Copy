#!/usr/bin/env node
// 남은 innerHTML 사용처 목록(P9-6 선택 과제). 앱 코드는 바꾸지 않고 js/*.js 를 읽어 파일별로 센다.
//   node tests/tools/list-html-sinks.mjs        → 마크다운 표를 출력한다(docs/TRUSTED_TYPES.md 에 붙인다)
// 분류: 지움(빈 문자열을 넣음) · 고정 문구(값이 섞이지 않은 글자뿐) · 값 섞임(변수·${ } 가 들어감 — safe-html 을 거쳐야 하는 곳)
import { readFileSync, readdirSync } from 'node:fs';
import { mask } from './scan-calls.mjs';

const root = new URL('../../', import.meta.url);
const SINK = /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)|(?<![\w$])insertAdjacentHTML\s*\(|(?<![\w$])document\.write(?:ln)?\s*\(/g;

/** [{ file, line, kind, category, text }] — 소스 순서. */
export function listHtmlSinks() {
  const rows = [];
  for (const file of readdirSync(new URL('js/', root)).filter(name => name.endsWith('.js')).sort()) {
    const source = readFileSync(new URL('js/' + file, root), 'utf8');
    const skeleton = mask(source);
    let m;
    SINK.lastIndex = 0;
    while ((m = SINK.exec(skeleton))) {
      const isAssign = /=$/.test(m[0]);
      let end = m.index + m[0].length, depth = 0;
      for (; end < skeleton.length; end++) {
        const c = skeleton[end];
        if (c === '(' || c === '[' || c === '{') depth++; else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; } else if ((c === ';' || c === '\n' && isAssign && depth === 0 && /[\w"'`)\]]\s*$/.test(skeleton.slice(m.index, end))) && depth === 0) break;
      }
      const rhs = skeleton.slice(m.index + m[0].length, end).trim();
      const category = /^(["'`])\1$/.test(rhs) ? '지움' : (!/\$\{/.test(rhs) && !/[A-Za-z_$][\w$]*/.test(rhs.replace(/\+/g, ' '))) ? '고정 문구' : '값 섞임';
      rows.push({ file, line: skeleton.slice(0, m.index).split('\n').length, kind: m[0].replace(/\s*\+?=$|\s*\($/, '').replace(/^\./, ''), category, text: source.slice(m.index, Math.min(end, m.index + 70)).replace(/\s+/g, ' ') });
    }
  }
  return rows;
}
const CATEGORIES = ['지움', '고정 문구', '값 섞임'];
/** 파일별 개수 표(마크다운). */
export function summaryTable(rows = listHtmlSinks()) {
  const files = [...new Set(rows.map(r => r.file))];
  const lines = ['| 파일 | 합계 | ' + CATEGORIES.join(' | ') + ' |', '|---|---:|' + CATEGORIES.map(() => '---:').join('|') + '|'];
  for (const file of files) { const mine = rows.filter(r => r.file === file); lines.push(`| js/${file} | ${mine.length} | ${CATEGORIES.map(c => mine.filter(r => r.category === c).length).join(' | ')} |`); }
  lines.push(`| **합계** | **${rows.length}** | ${CATEGORIES.map(c => `**${rows.filter(r => r.category === c).length}**`).join(' | ')} |`);
  return lines.join('\n');
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const rows = listHtmlSinks();
  console.log(summaryTable(rows));
  console.log('\n## 값 섞임 목록');
  for (const r of rows.filter(r => r.category === '값 섞임')) console.log(`- js/${r.file}:${r.line} \`${r.text}\``);
}
