// 릴리스 파일을 만든다: package.json의 version 하나에서 js/version.js · precache-manifest.json · sw.js의 CACHE_VERSION을 모두 계산한다.
// 앱 셸 파일(js·css·html·manifest·fonts·icons·vendor·manual)이 바뀌면 sw.js의 해시가 바뀌어 사용자에게 업데이트 알림이 뜬다. (설계서 Step 3-5)
// 설명서 그림(manual/assets)은 설치 목록(precache-manifest.json)에는 넣지 않지만 해시에는 넣는다 — 처음 볼 때 담기므로 바뀌면 새 버전이 되어야 한다. (P9-7)
import { readFile, writeFile } from 'node:fs/promises';
import { SW_VERSION_LINE, cacheVersionLine, listHashFiles, listShellFiles, shellHash, versionFileText } from './release-lib.mjs';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json의 version이 x.y.z 모양이 아니에요: ${version}`);

await writeFile('js/version.js', versionFileText(version));                 // 해시에 들어가므로 가장 먼저 쓴다
const files = await listShellFiles();
await writeFile('precache-manifest.json', JSON.stringify(files, null, 2) + '\n');
console.log('Precache entries:', files.length);

const hash = await shellHash(await listHashFiles());
const sw = await readFile('sw.js', 'utf8');
if (!SW_VERSION_LINE.test(sw)) throw new Error('sw.js에서 CACHE_VERSION 줄을 찾지 못했어요');
await writeFile('sw.js', sw.replace(SW_VERSION_LINE, cacheVersionLine(version, hash)));
if (!(await readFile('sw.js', 'utf8')).includes(`CACHE_VERSION = "${version}+`)) throw new Error('App/SW version mismatch');
console.log(`CACHE_VERSION = ${version}+${hash}`);
