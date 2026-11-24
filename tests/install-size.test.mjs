// P9-7 설치 용량: 설명서 그림은 설치(사전 캐시)에 담지 않고 처음 볼 때 담는다.
//  a 사전 캐시 목록  b 해시 대상(그림이 바뀌면 버전도 바뀐다)  c 예산  d 설명서 HTML의 그림  e sw.js의 "처음 볼 때 담기" 규칙  f manifest 파일 연결 구조
//  g~h 브라우저: 그림이 그려진다 / 서비스 워커가 처음 볼 때 담고 오프라인에서도 보여 준다
// 브라우저 시험 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/install-size.test.mjs
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { listShellFiles, listLazyFiles, listHashFiles, shellHash } from './release-lib.mjs';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';

const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const skip = !process.env.PLAYWRIGHT_MODULE;
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
// 멈춘 시험이 오래 매달리지 않도록 시험마다 시간 제한을 둔다(브라우저 시험은 따로 길게).
const test = (name, optionsOrFn, maybeFn) => typeof optionsOrFn === 'function' ? baseTest(name, { timeout: 15000 }, optionsOrFn) : baseTest(name, optionsOrFn, maybeFn);
const MANUALS = ['manual/scoreforge_user_manual.html', 'manual/scoreforge_quick_start_user_manual.html'];
const BUDGET_BYTES = 1_800_000; // 설계서의 목표는 1.5MB(1_500_000)이다. 지금은 1.73MB라 미달 — 줄이면 이 예산도 낮춘다.

async function scratch(files) {
  const root = await mkdtemp(join(tmpdir(), 'sf-lazy-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}
const imgSources = html => [...html.matchAll(/<img\b[^>]*>/g)].map(match => ({ tag: match[0], src: (match[0].match(/\bsrc="([^"]*)"/) || [])[1], alt: (match[0].match(/\balt="([^"]*)"/) || [])[1] }));

/* ---------------- a·b·c: 목록·해시·예산 ---------------- */

test('P9-7a 사전 캐시 목록에는 설명서 그림이 없고, 설명서 글(HTML)과 그림 틀(SVG)은 있다', async () => {
  const files = await listShellFiles();
  assert.deepEqual(files.filter(file => file.startsWith('manual/assets/')), []);
  for (const file of [...MANUALS, 'manual/scoreforge_quick_start_overview.svg', 'manual/scoreforge_user_manual_overview.svg']) assert.ok(files.includes(file), file);
  assert.deepEqual(files.filter(file => /\.(png|jpe?g|webp)$/.test(file) && !file.startsWith('icons/')), [], '아이콘 말고는 사진·그림 파일을 설치에 담지 않는다');
  assert.deepEqual(JSON.parse(readFileSync('precache-manifest.json', 'utf8')), files, 'precache-manifest.json과 같다');
});

test('P9-7b 해시 대상에는 설명서 그림이 들어 있다(그림만 바뀌어도 버전이 바뀌고, 설치 목록은 그대로)', async () => {
  const lazy = await listLazyFiles();
  assert.ok(lazy.length >= 8, `그림 ${lazy.length}장`);
  assert.ok(lazy.every(file => file.startsWith('manual/assets/')), lazy.join());
  assert.deepEqual(await listHashFiles(), [...await listShellFiles(), ...lazy], '셸 파일 다음에 지연 파일');

  const shell = { 'index.html': '<!doctype html>\n', 'privacy.html': '<!doctype html>\n', 'licenses.html': '<!doctype html>\n', 'manifest.webmanifest': '{}\n', 'icons/icon.svg': '<svg/>\n', 'icons/icon-192.png': Buffer.from([1, 2, 3]), 'icons/icon-512.png': Buffer.from([4, 5, 6]), 'fonts/Bravura.woff2': Buffer.from([7, 8, 9]), 'js/app.js': 'let x = 1;\n', 'css/style.css': 'a { b: c; }\n', 'vendor/lib.js': 'var v;\n', 'manual/m.html': '<p>m</p>\n' };
  const before = await scratch({ ...shell, 'manual/assets/a.webp': Buffer.from([1, 1, 1]) });
  const after = await scratch({ ...shell, 'manual/assets/a.webp': Buffer.from([2, 2, 2]) });
  const none = await scratch(shell);
  const names = ['a', 'b', 'c', 'd', 'e', 'f'].map(letter => `manual/assets/${letter}.webp`);   // 만든 순서(오름차순)와 상관없이 정렬돼 나와야 한다
  const many = await scratch({ ...shell, ...Object.fromEntries(names.map(name => [name, Buffer.from([1])])), 'manual/assets/notes.txt': 'x', 'manual/assets/.DS_Store': 'x' });
  const notFolder = await scratch({ ...shell, 'manual/assets': 'not a folder' });
  try {
    assert.deepEqual(await listShellFiles(before), await listShellFiles(after), '설치 목록은 그림이 바뀌어도 그대로');
    assert.ok(!(await listShellFiles(before)).includes('manual/assets/a.webp'));
    assert.deepEqual(await listLazyFiles(before), ['manual/assets/a.webp']);
    assert.notEqual(await shellHash(await listHashFiles(after), after), await shellHash(await listHashFiles(before), before), '그림 바이트가 바뀌면 해시가 바뀐다');
    assert.deepEqual(await listLazyFiles(none), [], '그림 폴더가 없어도 오류 없이 빈 목록');
    assert.deepEqual(await listHashFiles(none), await listShellFiles(none));
    assert.deepEqual(await listLazyFiles(many), names, '그림 파일만(메모·숨김 파일은 뺀다), 정렬해서');
    await assert.rejects(() => listLazyFiles(notFolder), /ENOTDIR/, '그림 폴더 자리에 파일이 있으면 조용히 넘어가지 않는다');
  } finally { for (const root of [before, after, none, many, notFolder]) await rm(root, { recursive: true, force: true }); }
});

test('P9-7c 설치 캐시 예산: 사전 캐시 합계가 예산을 넘지 않는다(설계서 목표 1.5MB는 아직 미달)', async () => {
  const files = await listShellFiles();
  const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(bytes <= BUDGET_BYTES, `사전 캐시 ${files.length}개 합계 ${bytes}바이트 > 예산 ${BUDGET_BYTES}`);
  assert.ok(bytes > 1_000_000, `합계가 이상하게 작다: ${bytes} — 목록이 빠졌는지 확인`);
  const images = (await listLazyFiles()).reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(images < 600_000, `설명서 그림 합계 ${images}바이트 — WebP로 줄인 크기(원래 PNG 1,110,432바이트)`);
});

/* ---------------- d: 설명서 HTML의 그림 ---------------- */

test('P9-7d 설명서 HTML의 그림: 모두 실제 파일을 가리키고, 그림은 WebP이며 설명 글자(alt)가 있고, PNG는 남아 있지 않다', () => {
  const used = new Set();
  for (const page of MANUALS) {
    const images = imgSources(readFileSync(page, 'utf8'));
    assert.ok(images.length >= 8, `${page}: 그림 ${images.length}개`);
    for (const { src, alt } of images) {
      assert.ok(src, `${page}: src 없음`);
      const file = join('manual', src);
      assert.ok(existsSync(file), `${page}: ${src} 파일이 없다`);
      assert.ok(alt && alt.trim(), `${page}: ${src}에 alt가 없다`);
      if (src.startsWith('assets/')) { assert.match(src, /^assets\/[\w-]+\.webp$/, `${page}: ${src}`); used.add(src); }
    }
  }
  const onDisk = readdirSync('manual/assets');
  assert.deepEqual(onDisk.filter(name => !name.endsWith('.webp')), [], '그림 폴더에는 WebP만 둔다(PNG 원본은 git 기록에 있다)');
  assert.deepEqual([...used].sort(), onDisk.map(name => 'assets/' + name).sort(), '쓰지 않는 그림도, 빠진 그림도 없다');
});

test('P9-7d2 설명서 WebP는 올바른 WebP 파일이고 크기가 원래 그림(1280×720)과 같다', () => {
  const webp = readdirSync('manual/assets').filter(name => name.endsWith('.webp'));
  assert.ok(webp.length >= 8);
  for (const name of webp) {
    const b = readFileSync(join('manual/assets', name));
    assert.equal(b.subarray(0, 4).toString('latin1'), 'RIFF', name);
    assert.equal(b.subarray(8, 12).toString('latin1'), 'WEBP', name);
    assert.equal(b.readUInt32LE(4) + 8, b.length, `${name}: RIFF 길이가 파일 크기와 맞아야 한다`);
    const kind = b.subarray(12, 16).toString('latin1');
    let width, height;
    if (kind === 'VP8 ') { width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8L') { const bits = b.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >> 14) & 0x3fff) + 1; }
    else if (kind === 'VP8X') { width = b.readUIntLE(24, 3) + 1; height = b.readUIntLE(27, 3) + 1; }
    else assert.fail(`${name}: 알 수 없는 WebP 종류 ${kind}`);
    assert.deepEqual([width, height], [1280, 720], name);
    assert.ok(b.length < 120_000, `${name}: ${b.length}바이트 — 줄어든 크기여야 한다`);
  }
});

/* ---------------- e: sw.js — 처음 볼 때 담기 ---------------- */

// putDelay: 담는 데 걸리는 시간(ms) · putFails: 담기가 실패(저장 공간 부족 등) · scope: 서비스 워커 범위
function serviceWorker(fetchImpl, { scope = 'https://scoreforge.test/', putDelay = 0, putFails = false } = {}) {
  const stores = new Map(), listeners = new Map(), fetched = [];
  class Cache {
    rows = new Map();
    key(request) { return typeof request === 'string' ? request : request.url; }
    async match(request) { const row = this.rows.get(this.key(request)); return row && new Response(row.body, { status: row.status }); }
    async put(request, response) {
      if (putFails) throw new Error('QuotaExceededError');
      const body = await response.arrayBuffer();   // 진짜 Cache.put처럼 넘겨받은 응답의 본문을 소비한다(복제본을 넘기지 않으면 돌려줄 응답이 못 쓰게 된다)
      if (putDelay) await tick(putDelay);
      this.rows.set(this.key(request), { body, status: response.status });
    }
    async delete(request) { return this.rows.delete(this.key(request)); }
    async keys() { return [...this.rows.keys()].map(url => new Request(url)); }
  }
  const context = vm.createContext({
    self: { registration: { scope }, location: { origin: new URL(scope).origin }, addEventListener: (name, fn) => listeners.set(name, fn) },
    caches: { open: async key => { if (!stores.has(key)) stores.set(key, new Cache()); return stores.get(key); }, keys: async () => [...stores.keys()], delete: async key => stores.delete(key) },
    URL, Request, Response, Set, Promise, Date, console,
    fetch: async request => { fetched.push(request.url); return fetchImpl(request); },
  });
  vm.runInContext(readFileSync('sw.js', 'utf8'), context);
  const shellName = () => [...stores.keys()].find(key => key.startsWith('scoreforge-shell-'));
  async function request(url, init) {
    let result;
    listeners.get('fetch')({ request: new Request(url, init), respondWith: promise => { result = promise; } });
    return result ? await result : undefined;
  }
  return { context, stores, fetched, request, shellName, cached: async () => [...(stores.get(shellName())?.rows.keys() || [])] };
}
// 실제 같은 출처 응답처럼 type이 basic이고(Response 생성자는 항상 default라 따로 지정), 실패 응답은 ok가 거짓이다.
const reply = (status = 200, type = 'basic', body = 'x') => {
  const response = new Response(status === 0 ? null : body, { status: status === 0 ? 200 : status });
  Object.defineProperty(response, 'type', { value: type });
  if (status === 0) Object.defineProperty(response, 'ok', { value: false });
  return response;
};
const IMG = 'https://scoreforge.test/manual/assets/01-main-workspace.webp';

test('P9-7e1 sw.js: 사전 캐시에 없는 설명서 그림은 처음 볼 때 네트워크로 받아 이 버전 캐시에 담고, 다음부터는 캐시에서 준다', async () => {
  const sw = serviceWorker(() => reply(200, 'basic', 'image-bytes'), { putDelay: 30 });
  const first = await sw.request(IMG);
  assert.deepEqual(await sw.cached(), [IMG], '응답을 돌려줄 때는 이미 이 버전의 셸 캐시에 담겨 있다(서비스 워커가 중간에 꺼져도 안 잃도록 담기를 마친 뒤 응답한다)');
  assert.equal(await first.text(), 'image-bytes', '받은 그림을 그대로 돌려준다(본문을 소비하지 않았다)');
  assert.deepEqual(sw.fetched, [IMG]);
  const second = await sw.request(IMG);
  assert.equal(await second.text(), 'image-bytes');
  assert.deepEqual(sw.fetched, [IMG], '두 번째부터는 네트워크로 가지 않는다');
});

test('P9-7e2 sw.js: 실패·불투명 응답은 담지 않고 그대로 돌려주며, 네트워크가 끊기면 오류를 그대로 낸다', async () => {
  for (const [label, response] of [['404', reply(404)], ['500', reply(500)], ['opaque', reply(0, 'opaque')], ['cors', reply(200, 'cors')]]) {
    const sw = serviceWorker(() => response);
    const result = await sw.request(IMG);
    assert.ok(result, label);
    assert.deepEqual(await sw.cached(), [], `${label}: 담지 않는다`);
  }
  const down = serviceWorker(() => { throw new TypeError('network down'); });
  await assert.rejects(() => down.request(IMG), /network down/);
  assert.deepEqual(await down.cached(), []);
});

test('P9-7e3 sw.js: 설명서 그림 폴더(manual/assets/) 밖의 같은 출처 파일은 담지 않는다', async () => {
  const sw = serviceWorker(() => reply(200, 'basic', 'other'));
  const others = ['https://scoreforge.test/manual/other.html', 'https://scoreforge.test/js/unknown.js', 'https://scoreforge.test/manual/assetsX/a.webp', 'https://scoreforge.test/assets/a.webp', 'https://scoreforge.test/manual/assets',
    'https://scoreforge.test/manual/assets/', 'https://scoreforge.test/other/manual/assets/a.webp', 'https://scoreforge.test/manual/assets/a.webp.bak', 'https://scoreforge.test/manual/assets/sub/a.webp', 'https://scoreforge.test/manual/assets/notes.txt'];
  for (const url of others) assert.equal(await (await sw.request(url)).text(), 'other', url);
  assert.deepEqual(await sw.cached(), [], '폴더 밖·하위 폴더·그림이 아닌 파일은 담지 않는다(해시 목록과 같은 기준)');
  assert.equal(sw.fetched.length, others.length);
});

test('P9-7e4 sw.js: 캐시에 담지 못해도(저장 공간 부족 등) 그림은 그대로 보여 준다', async () => {
  const sw = serviceWorker(() => reply(200, 'basic', 'image-bytes'), { putFails: true });
  assert.equal(await (await sw.request(IMG)).text(), 'image-bytes');
  assert.deepEqual(await sw.cached(), []);
});

test('P9-7e5 sw.js: 앱이 하위 경로(…/app/)에 배포돼도 범위 기준 경로로 판단한다', async () => {
  const sw = serviceWorker(() => reply(200, 'basic', 'img'), { scope: 'https://scoreforge.test/app/' });
  await sw.request('https://scoreforge.test/app/manual/assets/a.webp');
  await sw.request('https://scoreforge.test/app/assets/b.webp');
  await sw.request('https://scoreforge.test/app/x/manual/assets/c.webp');
  assert.deepEqual(await sw.cached(), ['https://scoreforge.test/app/manual/assets/a.webp']);
  assert.equal(await sw.request('https://scoreforge.test/manual/assets/d.webp'), undefined, '범위 밖은 건드리지 않는다');
});

test('P9-7e6 sw.js: 기존 규칙은 그대로 — 사전 캐시에 있는 파일은 캐시에서, Supabase·POST는 건드리지 않는다', async () => {
  const sw = serviceWorker(() => reply(200, 'basic', 'network'));
  const caches = await sw.context.caches.open('scoreforge-shell-' + vm.runInContext('CACHE_VERSION', sw.context));
  await caches.put(new Request('https://scoreforge.test/js/app.js'), new Response('precached'));
  assert.equal(await (await sw.request('https://scoreforge.test/js/app.js')).text(), 'precached');
  assert.deepEqual(sw.fetched, []);
  assert.equal(await sw.request('https://project.supabase.co/rest/v1/x'), undefined);
  assert.equal(await sw.request('https://scoreforge.test/manual/assets/a.webp', { method: 'POST' }), undefined);
});

/* ---------------- f: manifest 파일 연결 구조 ---------------- */

test('P9-7f manifest file_handlers: 구조가 올바르고 ScoreForge 자신의 파일 형식은 항상 남아 있다(일반 .json·.xml 정리는 사람이 Chrome에서 확인한 뒤)', () => {
  const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  const scope = new URL(manifest.scope, 'https://scoreforge.test/app/');
  const extensions = [];
  assert.ok(Array.isArray(manifest.file_handlers) && manifest.file_handlers.length >= 1);
  for (const handler of manifest.file_handlers) {
    const action = new URL(handler.action, new URL(manifest.start_url, scope));
    assert.ok(action.href.startsWith(scope.href), `action이 범위 안에 있어야 한다: ${action.href}`);
    assert.ok(handler.accept && Object.keys(handler.accept).length >= 1);
    for (const [mime, list] of Object.entries(handler.accept)) {
      assert.match(mime, /^[a-z]+\/[a-z0-9.+-]+$/, mime);
      for (const extension of [].concat(list)) { assert.match(extension, /^\.[a-z0-9]+(\.[a-z0-9]+)?$/, extension); extensions.push(extension); }
    }
  }
  assert.equal(new Set(extensions).size, extensions.length, '같은 확장자를 두 번 적지 않는다');
  for (const own of ['.scoreforge.json', '.musicxml', '.mxl', '.mid', '.midi']) assert.ok(extensions.includes(own), `${own}은 ScoreForge가 다루는 형식이라 남겨 둔다`);
});

/* ---------------- g·h: 브라우저 ---------------- */

async function withBrowser(fn) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext(pageOptions());
    const page = await context.newPage();
    await preparePage(page);
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    await fn({ page, context, problems });
  } finally { await browser.close(); }
}
const images = page => page.evaluate(() => [...document.images].map(img => ({ src: img.getAttribute('src'), done: img.complete, width: img.naturalWidth, current: img.currentSrc })));

test('P9-7g 설명서 두 페이지의 그림이 모두 그려진다(WebP)', { skip, timeout: 120000 }, async () => {
  await withBrowser(async ({ page, problems }) => {
    for (const manual of MANUALS) {
      await page.goto(`${URL_}/${manual}`, { waitUntil: 'load' });
      const list = await images(page);
      assert.ok(list.length >= 8, `${manual}: 그림 ${list.length}개`);
      for (const img of list) {
        assert.equal(img.done && img.width > 0, true, `${manual}: ${img.src}가 그려지지 않았다`);
        if (img.src.startsWith('assets/')) assert.match(img.current, /\.webp$/);
      }
    }
    assert.deepEqual(problems, []);
  });
});

test('P9-7h 서비스 워커: 설치 직후 캐시에는 설명서 그림이 없고, 설명서를 열면 담기며, 오프라인에서도 그림이 보인다(한 번도 안 본 그림은 alt만)', { skip, timeout: 180000 }, async () => {
  await withBrowser(async ({ page, context, problems }) => {
    await page.goto(URL_ + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    const shellKeys = () => page.evaluate(async () => {
      const key = (await caches.keys()).find(name => name.startsWith('scoreforge-shell-'));
      return (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname);
    });
    const installed = await shellKeys();
    assert.equal(installed.some(path => path.includes('/manual/assets/')), false, '설치 직후에는 설명서 그림이 없다');
    assert.ok(installed.some(path => path.endsWith('/manual/scoreforge_user_manual.html')), '설명서 글은 설치에 들어 있다');
    assert.ok(installed.length >= 40 && installed.length <= 48, `사전 캐시 ${installed.length}개`);

    const manual = await context.newPage();
    await manual.goto(`${URL_}/manual/scoreforge_user_manual.html`, { waitUntil: 'load' });
    assert.ok((await images(manual)).every(img => img.done && img.width > 0 || !img.src.startsWith('assets/')), '온라인에서 그림이 보인다');
    let cachedImages = [];
    for (let i = 0; i < 100 && cachedImages.length < 8; i++) { cachedImages = (await shellKeys()).filter(path => path.includes('/manual/assets/')); if (cachedImages.length < 8) await tick(100); }
    assert.equal(cachedImages.length, 8, `처음 본 그림 8장이 캐시에 담겼다: ${cachedImages.join()}`);

    // 캐시에서 한 장을 빼서 "한 번도 안 본 그림"을 만든 뒤 오프라인으로
    await page.evaluate(async () => {
      const key = (await caches.keys()).find(name => name.startsWith('scoreforge-shell-'));
      const cache = await caches.open(key);
      for (const request of await cache.keys()) if (request.url.endsWith('/05-navigator.webp')) await cache.delete(request);
    });
    await context.setOffline(true);
    await manual.reload({ waitUntil: 'load' });
    const offline = await images(manual);
    assert.ok(await manual.locator('h1').first().innerText(), '오프라인에서도 설명서 글이 열린다');
    for (const img of offline.filter(item => item.src.startsWith('assets/'))) {
      if (img.src.endsWith('05-navigator.webp')) assert.equal(img.width, 0, '한 번도 안 본 그림은 그려지지 않고 alt만 남는다');
      else assert.equal(img.done && img.width > 0, true, `오프라인에서도 ${img.src}가 보인다`);
    }
    assert.deepEqual(problems, [], '그림이 없어도 앱·설명서 오류는 없다');
  });
});
