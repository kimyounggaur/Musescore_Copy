// P9-6 구조·문서 정리 시험.
//  ① 옛 호환 코드 중 지운 것(C.timeSigAt 대체 경로)이 없고, 지우지 않기로 한 것은 그대로 남아 있다
//  ② 옛 업그레이드 프롬프트 문서는 docs/archive/ 로 옮겼고 아무도 옛 경로를 가리키지 않는다
//  ③ README 코드 구조 절이 js/ 아래 모든 파일을 한 번씩 언급한다
//  ④ docs/TRUSTED_TYPES.md 의 innerHTML 사용처 개수가 목록 도구(tests/tools/list-html-sinks.mjs)와 같다
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { listHtmlSinks, summaryTable } from './tools/list-html-sinks.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const jsFiles = readdirSync(new URL('js/', root)).filter(name => name.endsWith('.js')).sort();

/* ① 호환 코드 ------------------------------------------------------------ */
test('P9-6 호환 코드: C.timeSigAt 대체 경로(io·engrave·playback)가 없다', () => {
  for (const file of ['io.js', 'engrave.js', 'playback.js']) {
    const text = read('js/' + file);
    assert.doesNotMatch(text, /C\.timeSigAt\s*\?/, `${file}: "C.timeSigAt ? … :" 대체 경로가 남아 있다`);
    assert.match(text, /const timeAt = \(score, m\) => C\.timeSigAt\(score, m\);|timeSigAt\(/, `${file}: 박자 조회는 C.timeSigAt 하나로 한다`);
  }
});
test('P9-6 호환 코드: 배포 전이라 지우지 않기로 한 것(format:1 · 구버전 저장 메뉴 · v1 자동 저장 읽기)은 그대로다', () => {
  assert.match(read('js/io.js'), /opts\.legacy \? \{ format: 1 \}/, 'saveJSON({ legacy })');
  assert.match(read('js/app.js'), /act === "save-legacy"/, '구버전 호환 저장 메뉴');
  assert.match(read('index.html'), /data-act="save-legacy"/, '파일 메뉴 항목');
  assert.match(read('js/session.js'), /scoreforge\.autosave\.v1/, 'v1 자동 저장 읽기');
  assert.match(read('js/core.js'), /format/, 'toJSON format 옵션');
});

/* ② 문서 이동 ------------------------------------------------------------ */
const ARCHIVED = 'MUSESCORE_NEXT_UPGRADE_PROMPTS.md';
test('P9-6 문서: 옛 업그레이드 프롬프트 문서는 docs/archive/ 에 있고 루트에는 없다', () => {
  assert.equal(existsSync(new URL(ARCHIVED, root)), false, '루트에 남아 있다');
  const moved = new URL('docs/archive/' + ARCHIVED, root);
  assert.ok(existsSync(moved), 'docs/archive/ 에 없다');
  assert.ok(statSync(moved).size > 20000, '내용이 비어 있거나 잘렸다');
});
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'output', 'tmp', 'vendor'].includes(entry.name)) continue;
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) walk(path, out); else if (/\.(md|mjs|js|json|html|yml|yaml|webmanifest)$/.test(entry.name)) out.push(path);
  }
  return out;
}
test('P9-6 문서: 다른 파일은 옮기기 전 경로로 그 문서를 가리키지 않는다', () => {
  const allowed = new Set(['docs/REFACTOR_LOG.md', 'docs/DECISIONS.md', 'docs/scoreforge-refactor-design.md', 'tests/structure-docs.test.mjs']);
  const bad = [];
  for (const url of walk(root)) {
    const rel = url.pathname.slice(root.pathname.length);
    if (allowed.has(rel) || rel.startsWith('docs/archive/')) continue;
    const text = readFileSync(url, 'utf8');
    for (const m of text.matchAll(new RegExp(`(.{0,12})${ARCHIVED.replace('.', '\\.')}`, 'g'))) if (!/docs\/archive\/$/.test(m[1])) bad.push(`${rel}: …${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

/* ③ README 구조 절 -------------------------------------------------------- */
test('P9-6 README: 코드 구조 절이 js/ 아래 모든 파일을 언급하고 없는 파일은 언급하지 않는다', () => {
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('## 코드 구조'), readme.indexOf('## 개발·검증'));
  assert.ok(section.length > 500, '코드 구조 절을 찾지 못했다');
  const mentioned = [...section.matchAll(/(?<![\w/])js\/([\w-]+\.js)/g)].map(m => m[1]);
  const names = new Set(mentioned);
  for (const file of jsFiles) assert.ok(names.has(file), `README 코드 구조 절에 js/${file} 이(가) 없다`);
  for (const name of names) assert.ok(jsFiles.includes(name), `README 가 없는 파일 js/${name} 을(를) 가리킨다`);
  assert.equal(mentioned.length, names.size, '같은 파일을 두 번 적었다');
  for (const word of ['safe-html', 'session', 'store', 'recent', 'schema', 'zip']) assert.ok(names.has(word + '.js'), `${word}.js`);
});

/* ④ 남은 innerHTML 사용처 보고 ------------------------------------------- */
test('P9-6 보고: docs/TRUSTED_TYPES.md 의 파일별 개수가 목록 도구의 결과와 같다', () => {
  const doc = read('docs/TRUSTED_TYPES.md');
  const rows = listHtmlSinks();
  assert.ok(rows.length >= 30, `사용처가 너무 적게 잡힌다(${rows.length})`);
  assert.ok(doc.includes(summaryTable(rows)), '문서의 표가 최신 목록과 다르다 — node tests/tools/list-html-sinks.mjs 의 표를 붙여 넣는다');
  for (const row of rows.filter(r => r.category === '값 섞임')) assert.ok(doc.includes(`js/${row.file}:${row.line}`), `문서에 빠진 사용처 js/${row.file}:${row.line}`);
});
