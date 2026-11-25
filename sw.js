"use strict";
const CACHE_VERSION = "3.6.0+8bf20afa";
const SHELL_CACHE = "scoreforge-shell-" + CACHE_VERSION;
const SAMPLE_CACHE = "scoreforge-samples-v1";
const SAMPLE_META = "scoreforge-sample-meta-v1";
const SAMPLE_LIMIT = 60 * 1024 * 1024;
const SAMPLE_HOSTS = new Set(["gleitz.github.io", "smpldsnds.github.io", "goldst.dev"]);
let sampleQueue = Promise.resolve();
const local = path => new URL(path, self.registration.scope).href;
// 설명서 그림(manual/assets/)은 설치에 담지 않는다 — 처음 볼 때 한 번 받아 이 버전의 셸 캐시에 담아 두면 그 뒤로는 오프라인에서도 보인다. (P9-7)
const LAZY_ASSET = /^manual\/assets\/[^/]+\.(webp|png|jpe?g|svg)$/;
// 범위(scope) 기준 상대 경로로 판단한다 — 앱이 하위 경로(…/scoreforge/)에 배포돼도 같다. (부르는 쪽에서 이미 범위 안의 같은 출처 주소만 넘긴다)
const isLazyAsset = url => LAZY_ASSET.test(url.pathname.slice(new URL(self.registration.scope).pathname.length));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const response = await fetch(local("precache-manifest.json"), { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load shell manifest");
    const files = await response.json();
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(files.map(file => new Request(local(file), { cache: "reload" })));
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith("scoreforge-shell-") && key !== SHELL_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
  if (event.data?.type === "SAMPLE_CACHE_STATS" && event.ports[0]) {
    event.waitUntil(sampleStats().then(stats => event.ports[0].postMessage(stats)));
  }
});

async function sampleStats() {
  const meta = await caches.open(SAMPLE_META);
  const rows = await Promise.all((await meta.keys()).map(async request => ({ request, ...(await (await meta.match(request)).json()) })));
  return { bytes: rows.reduce((sum, row) => sum + row.size, 0), count: rows.length, limit: SAMPLE_LIMIT };
}
function touchSample(request, response) {
  sampleQueue = sampleQueue.catch(() => {}).then(async () => {
    const cache = await caches.open(SAMPLE_CACHE);
    const meta = await caches.open(SAMPLE_META);
    const previous = await meta.match(request);
    let size = previous ? (await previous.json()).size : 0;
    if (response) {
      size = (await response.clone().arrayBuffer()).byteLength;
      if (size > SAMPLE_LIMIT) return;
      await cache.put(request, response);
    }
    if (!size) return;
    await meta.put(request, new Response(JSON.stringify({ size, at: Date.now() })));
    const rows = await Promise.all((await meta.keys()).map(async key => ({ key, ...(await (await meta.match(key)).json()) })));
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows.sort((a, b) => a.at - b.at)) {
      if (total <= SAMPLE_LIMIT) break;
      await cache.delete(row.key); await meta.delete(row.key); total -= row.size;
    }
  });
  return sampleQueue;
}
async function sampleResponse(event) {
  const cached = await (await caches.open(SAMPLE_CACHE)).match(event.request);
  if (cached) { event.waitUntil(touchSample(event.request)); return cached; }
  const response = await fetch(event.request);
  if (response.ok && response.type !== "opaque") event.waitUntil(touchSample(event.request, response.clone()).catch(() => {}));
  return response;
}
async function shellResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return navigationResponse(request, cached);
  if (request.mode === "navigate") {
    const url = new URL(request.url);
    if (url.pathname === new URL(self.registration.scope).pathname || url.pathname.endsWith("/index.html")) {
      const entry = await cache.match(local("index.html"));
      if (entry) return navigationResponse(request, entry);
    }
  }
  const response = await fetch(request);
  // 성공한 같은 출처 응답만 담는다(404·불투명 응답은 그대로 돌려주기만). 담기 실패(저장 공간 부족 등)는 그림을 보는 데 영향이 없다.
  if (isLazyAsset(new URL(request.url)) && response.ok && response.type === "basic") await cache.put(request, response.clone()).catch(() => {});
  return response;
}
function navigationResponse(request, response) {
  // cleanUrls may cache a followed index.html redirect. Navigations use manual
  // redirect mode, so return a fresh same-origin response without redirect history.
  if (request.mode !== "navigate" || !response.redirected) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname.endsWith(".supabase.co")) return;
  if (SAMPLE_HOSTS.has(url.hostname)) { event.respondWith(sampleResponse(event)); return; }
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (/\/(sw\.js|precache-manifest\.json)$/.test(url.pathname)) return;
  event.respondWith(shellResponse(request));
});
