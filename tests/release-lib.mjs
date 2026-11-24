// 릴리스 파일(js/version.js · precache-manifest.json · sw.js의 CACHE_VERSION)을 만드는 데 쓰는 공용 함수.
// prepare-release.mjs와 tests/release.test.mjs가 같은 함수를 쓴다. (설계서 Step 3-5)
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const TOP_LEVEL = ['index.html', 'privacy.html', 'licenses.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/Bravura.woff2'];
const SHELL_DIRS = ['js', 'css', 'vendor', 'manual'];
/** 설치(사전 캐시)에는 담지 않고 처음 볼 때 서비스 워커가 담는 폴더(설명서 그림). 그래도 해시에는 넣는다 — 그림만 바뀌어도 새 버전으로 알리고 옛 캐시를 버리기 위해서다. (P9-7) */
const LAZY_DIRS = ['manual/assets'];
const LAZY_FILE = /\.(webp|png|jpe?g|svg)$/;
const SHELL_FILE = /\.(js|mjs|css|html|svg|png|jpe?g|webp|woff2)$/;
/** 문자열로 읽어 줄바꿈을 LF로 맞춘 뒤 해시하는 확장자. 그 밖(png·woff2 등)은 바이트 그대로. */
const TEXT_FILE = /\.(js|mjs|css|html|svg|json|webmanifest)$/;

/** 앱 셸(서비스 워커가 미리 담아 두는) 파일 목록 — 정렬·중복 제거. LAZY_DIRS 아래는 뺀다. root는 저장소 폴더. */
export async function listShellFiles(root = '.') {
  const files = [...TOP_LEVEL];
  async function walk(dir) {
    for (const item of await readdir(`${root}/${dir}`, { withFileTypes: true })) {
      const file = `${dir}/${item.name}`;
      if (item.isDirectory()) { if (!LAZY_DIRS.includes(file)) await walk(file); }
      else if (SHELL_FILE.test(file)) files.push(file);
    }
  }
  for (const dir of SHELL_DIRS) await walk(dir);
  return [...new Set(files)].sort();
}

/** 설치에는 안 담지만 해시에는 넣는 파일(설명서 그림) — manual/assets 바로 아래의 그림 파일, 정렬. 폴더가 없어도 오류 없이 빈 목록. */
export async function listLazyFiles(root = '.') {
  const files = [];
  for (const dir of LAZY_DIRS) {
    let items;
    try { items = await readdir(`${root}/${dir}`, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const item of items) if (item.isFile() && LAZY_FILE.test(item.name)) files.push(`${dir}/${item.name}`);
  }
  return files.sort();
}

/** sw.js의 CACHE_VERSION 해시에 넣는 파일 = 앱 셸 파일 다음에 지연 파일. */
export async function listHashFiles(root = '.') {
  return [...await listShellFiles(root), ...await listLazyFiles(root)];
}

/** 해시에 넣는 내용: 텍스트 파일은 CRLF → LF(Windows autocrlf 체크아웃과 CI가 같은 해시를 내도록), 이진 파일은 그대로. */
export function normalizeForHash(file, buffer) {
  return TEXT_FILE.test(file) ? Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buffer;
}

/** sha256(파일마다 경로 + "\n" + 내용 + "\n") 앞 8자리. 목록 순서를 그대로 쓴다. */
export async function shellHash(files, root = '.') {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file}\n`);
    hash.update(normalizeForHash(file, await readFile(`${root}/${file}`)));
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 8);
}

export const versionFileText = version => `"use strict";\nwindow.SF = window.SF || {};\nwindow.SF.VERSION = "${version}";\n`;
export const cacheVersionLine = (version, hash) => `const CACHE_VERSION = "${version}+${hash}";`;
export const SW_VERSION_LINE = /^const CACHE_VERSION = ".*";$/m;
