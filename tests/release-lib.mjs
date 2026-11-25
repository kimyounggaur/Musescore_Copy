// 릴리스 파일(js/version.js · precache-manifest.json · sw.js의 CACHE_VERSION)을 만드는 데 쓰는 공용 함수.
// prepare-release.mjs와 tests/release.test.mjs가 같은 함수를 쓴다. (설계서 Step 3-5)
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const TOP_LEVEL = ['index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/Bravura.woff2'];
const SHELL_DIRS = ['js', 'css', 'vendor', 'manual'];
const SHELL_FILE = /\.(js|mjs|css|html|svg|png|jpe?g|woff2)$/;
/** 문자열로 읽어 줄바꿈을 LF로 맞춘 뒤 해시하는 확장자. 그 밖(png·woff2 등)은 바이트 그대로. */
const TEXT_FILE = /\.(js|mjs|css|html|svg|json|webmanifest)$/;

/** 앱 셸(서비스 워커가 미리 담아 두는) 파일 목록 — 정렬·중복 제거. root는 저장소 폴더. */
export async function listShellFiles(root = '.') {
  const files = [...TOP_LEVEL];
  async function walk(dir) {
    for (const item of await readdir(`${root}/${dir}`, { withFileTypes: true })) {
      const file = `${dir}/${item.name}`;
      if (item.isDirectory()) await walk(file);
      else if (SHELL_FILE.test(file)) files.push(file);
    }
  }
  for (const dir of SHELL_DIRS) await walk(dir);
  return [...new Set(files)].sort();
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
