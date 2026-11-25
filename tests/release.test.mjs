// 릴리스 파일 만들기(Step 3-5): 버전은 package.json 하나, 서비스 워커의 CACHE_VERSION은 "버전+앱 셸 해시".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cacheVersionLine, listHashFiles, listShellFiles, normalizeForHash, shellHash, versionFileText } from './release-lib.mjs';

async function scratch(files) {
  const root = await mkdtemp(join(tmpdir(), 'sf-release-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}
const list = ['a.js', 'b.css', 'c.png'];
const base = { 'a.js': 'let a = 1;\nlet b = 2;\n', 'b.css': 'body { margin: 0; }\n', 'c.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };

test('해시는 8자리 16진수이고, 같은 내용이면 항상 같다', async () => {
  const root = await scratch(base);
  try {
    const first = await shellHash(list, root);
    assert.match(first, /^[0-9a-f]{8}$/);
    assert.equal(await shellHash(list, root), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('텍스트 파일은 CRLF여도 LF와 같은 해시 — Windows 체크아웃과 CI(Linux)가 같은 값을 낸다', async () => {
  const lf = await scratch(base), crlf = await scratch({ ...base, 'a.js': base['a.js'].replace(/\n/g, '\r\n'), 'b.css': base['b.css'].replace(/\n/g, '\r\n') });
  try { assert.equal(await shellHash(list, crlf), await shellHash(list, lf)); }
  finally { await rm(lf, { recursive: true, force: true }); await rm(crlf, { recursive: true, force: true }); }
});

test('이진 파일은 바이트 그대로 — 줄바꿈처럼 보이는 바이트도 바뀌면 해시가 달라진다', async () => {
  const same = await scratch(base), other = await scratch({ ...base, 'c.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a]) });   // 0d 0a → 0a (CRLF를 LF로 바꾼 꼴)
  try {
    assert.notEqual(await shellHash(list, other), await shellHash(list, same));
    assert.deepEqual(normalizeForHash('c.png', base['c.png']), base['c.png']);
  } finally { await rm(same, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test('셸 파일 한 글자·파일 이름·목록 순서가 바뀌면 해시가 달라진다', async () => {
  const root = await scratch(base), changed = await scratch({ ...base, 'b.css': 'body { margin: 1px; }\n' });
  try {
    const hash = await shellHash(list, root);
    assert.notEqual(await shellHash(list, changed), hash, '내용');
    assert.notEqual(await shellHash(['b.css', 'a.js', 'c.png'], root), hash, '순서');
    assert.notEqual(await shellHash(['a.js', 'b.css'], root), hash, '목록');
  } finally { await rm(root, { recursive: true, force: true }); await rm(changed, { recursive: true, force: true }); }
});

test('내용이 같아도 파일 이름이 바뀌면 해시가 달라진다(경로가 해시에 들어간다)', async () => {
  const root = await scratch(base), renamed = await scratch({ 'a2.js': base['a.js'], 'b.css': base['b.css'], 'c.png': base['c.png'] });
  try { assert.notEqual(await shellHash(['a2.js', 'b.css', 'c.png'], renamed), await shellHash(list, root)); }
  finally { await rm(root, { recursive: true, force: true }); await rm(renamed, { recursive: true, force: true }); }
});

test('목록 계산: 최상위 8개(privacy.html·licenses.html 포함)와 js·css·vendor·manual 아래 앱 파일만, 정렬·중복 제거', async () => {
  const files = await listShellFiles();
  assert.deepEqual(files, [...new Set(files)].sort());
  for (const file of ['index.html', 'privacy.html', 'licenses.html', 'manifest.webmanifest', 'fonts/Bravura.woff2', 'js/version.js', 'js/app.js', 'css/style.css', 'css/privacy.css', 'vendor/supabase.js']) assert.ok(files.includes(file), file);
  assert.ok(!files.includes('sw.js') && !files.includes('precache-manifest.json'), '자기 자신은 목록에 없다');
  assert.ok(files.every(file => !file.startsWith('tests/') && !file.startsWith('docs/')));
});

// prepare-release.mjs를 임시 폴더에서 실제로 돌려 본다: 버전은 package.json에서만 오고, 두 번 돌려도 같고, 셸 파일이 바뀔 때만 sw.js 해시가 바뀐다.
test('prepare-release 끝에서 끝까지(임시 폴더): 버전 올리기 = package.json 수정 + 실행', async () => {
  const shell = { 'index.html': '<!doctype html>\n', 'privacy.html': '<!doctype html>\n', 'licenses.html': '<!doctype html>\n', 'manifest.webmanifest': '{}\n', 'icons/icon.svg': '<svg/>\n', 'icons/icon-192.png': Buffer.from([1, 2, 3]), 'icons/icon-512.png': Buffer.from([4, 5, 6]), 'fonts/Bravura.woff2': Buffer.from([7, 8, 9]), 'js/app.js': 'let x = 1;\n', 'css/style.css': 'a { b: c; }\n', 'vendor/lib.js': 'var v;\n', 'manual/m.html': '<p>m</p>\n' };
  const root = await scratch({ ...shell, 'package.json': JSON.stringify({ name: 'x', version: '9.9.9' }), 'js/version.js': '"use strict";\nwindow.SF = window.SF || {};\nwindow.SF.VERSION = "1.0.0";\n', 'sw.js': '"use strict";\nconst CACHE_VERSION = "1.0.0";\nconst SHELL_CACHE = "scoreforge-shell-" + CACHE_VERSION;\nself.x = 1;\n' });
  const script = resolve('tests/prepare-release.mjs');
  const run = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  const read = name => readFileSync(join(root, name), 'utf8');
  const state = () => JSON.stringify(['js/version.js', 'sw.js', 'precache-manifest.json'].map(read));
  try {
    run();
    assert.equal(read('js/version.js'), versionFileText('9.9.9'), 'version.js는 package.json의 버전');
    const files = await listShellFiles(root), hash = await shellHash(await listHashFiles(root), root);
    assert.match(read('sw.js'), new RegExp(`^const CACHE_VERSION = "9\\.9\\.9\\+${hash}";$`, 'm'));
    assert.match(read('sw.js'), /const SHELL_CACHE = "scoreforge-shell-" \+ CACHE_VERSION;\nself\.x = 1;/, 'CACHE_VERSION 줄만 바뀐다');
    assert.deepEqual(JSON.parse(read('precache-manifest.json')), files);
    const first = state(); run(); assert.equal(state(), first, '두 번 돌려도 같다(멱등)');
    await writeFile(join(root, 'css/style.css'), 'a { b: d; }\n'); run();
    const changed = JSON.parse(state());
    assert.equal(changed[0], JSON.parse(first)[0]); assert.equal(changed[2], JSON.parse(first)[2]); assert.notEqual(changed[1], JSON.parse(first)[1], '셸 파일이 바뀌면 sw.js 해시만 바뀐다');
    await writeFile(join(root, 'css/style.css'), 'a { b: d; }\r\n'); run();
    assert.equal(JSON.parse(state())[1], changed[1], 'CRLF로 저장해도 같은 해시');
    // P9-7: 설치에 담지 않는 설명서 그림도 해시에는 들어간다 — 그림만 생기거나 바뀌어도 새 버전이 되고, 설치 목록(manifest)은 그대로다.
    const noImage = JSON.parse(state());
    await mkdir(join(root, 'manual/assets'), { recursive: true }); await writeFile(join(root, 'manual/assets/a.webp'), Buffer.from([1, 2, 3])); run();
    const withImage = JSON.parse(state());
    assert.notEqual(withImage[1], noImage[1], '그림이 생기면 sw.js 해시가 바뀐다'); assert.equal(withImage[2], noImage[2], '설치 목록은 그대로'); assert.equal(withImage[0], noImage[0]);
    await writeFile(join(root, 'manual/assets/a.webp'), Buffer.from([1, 2, 4])); run();
    assert.notEqual(JSON.parse(state())[1], withImage[1], '그림 내용이 바뀌어도 sw.js 해시가 바뀐다'); assert.equal(JSON.parse(state())[2], withImage[2], '설치 목록은 그대로');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '9.10.0' })); run();
    assert.match(read('sw.js'), /CACHE_VERSION = "9\.10\.0\+[0-9a-f]{8}"/); assert.equal(read('js/version.js'), versionFileText('9.10.0'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('저장소의 릴리스 파일이 지금 파일들과 맞다 — 어긋나면 npm run release를 실행해 같이 커밋한다', async () => {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(readFileSync('js/version.js', 'utf8'), versionFileText(version), 'js/version.js가 package.json과 다르다');
  const files = await listShellFiles();
  assert.deepEqual(JSON.parse(readFileSync('precache-manifest.json', 'utf8')), files, 'precache-manifest.json이 지금 파일 목록과 다르다');
  const sw = readFileSync('sw.js', 'utf8');
  assert.ok(sw.includes(cacheVersionLine(version, await shellHash(await listHashFiles()))), 'sw.js의 CACHE_VERSION이 앱 셸 파일(설명서 그림 포함)의 해시와 다르다');
  assert.match(sw, /const SHELL_CACHE = "scoreforge-shell-" \+ CACHE_VERSION;/);
});

test('릴리스 절차 고정: release 스크립트, prepare-release가 package.json 하나에서 만든다', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.release, 'node tests/gen-readme-keys.mjs && node tests/gen-licenses.mjs && node tests/prepare-release.mjs && npm run check && npm test');
  const script = await readFile('tests/prepare-release.mjs', 'utf8');
  assert.match(script, /package\.json/); assert.doesNotMatch(script, /js\/version\.js', 'utf8'\)\)\.match/, '버전을 version.js에서 읽지 않는다');
});
