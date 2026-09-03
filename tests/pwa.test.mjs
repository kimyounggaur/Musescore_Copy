import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
function serviceWorker() {
  const stores = new Map(), listeners = new Map();
  class Cache {
    rows = new Map();
    key(request) { return typeof request === 'string' ? request : request.url; }
    async match(request) { return this.rows.get(this.key(request))?.clone(); }
    async put(request, response) { this.rows.set(this.key(request), response.clone()); }
    async delete(request) { return this.rows.delete(this.key(request)); }
    async keys() { return [...this.rows.keys()].map(url => new Request(url)); }
  }
  const context = vm.createContext({
    self: { registration: { scope: 'https://scoreforge.test/' }, location: { origin: 'https://scoreforge.test' }, addEventListener: (name, fn) => listeners.set(name, fn) },
    caches: { open: async key => { if (!stores.has(key)) stores.set(key, new Cache()); return stores.get(key); }, keys: async () => [...stores.keys()], delete: async key => stores.delete(key) },
    URL, Request, Response, Set, Promise, Date, console, fetch: async () => new Response('network')
  });
  vm.runInContext(readFileSync('sw.js', 'utf8'), context);
  return { context, stores, listeners };
}
test('Supabase and non-GET requests never enter the cache', () => {
  const { listeners } = serviceWorker();
  let handled = false;
  const respondWith = () => { handled = true; };
  listeners.get('fetch')({ request: new Request('https://project.supabase.co/rest/v1/scores'), respondWith });
  listeners.get('fetch')({ request: new Request('https://scoreforge.test/api', {method:'POST'}), respondWith });
  assert.equal(handled, false);
});
test('sample cache obeys the 60MB cap and evicts least recently used entries', async () => {
  const { context, stores } = serviceWorker();
  context.requestA = new Request('https://smpldsnds.github.io/a.wav');
  context.requestB = new Request('https://smpldsnds.github.io/b.wav');
  context.sample = { clone() { return this; }, arrayBuffer: async () => ({ byteLength: 35 * 1024 * 1024 }) };
  await vm.runInContext('touchSample(requestA, sample)', context);
  await vm.runInContext('touchSample(requestB, sample)', context);
  const stats = await vm.runInContext('sampleStats()', context);
  assert.equal(stats.count, 1);
  assert.ok(stats.bytes <= stats.limit);
  const cache = stores.get('scoreforge-samples-v1');
  assert.equal(await cache.match(context.requestA), undefined);
  assert.ok(await cache.match(context.requestB));
});
test('release manifest references local files and matching version', () => {
  const files = JSON.parse(readFileSync('precache-manifest.json', 'utf8'));
  for (const file of files) assert.ok(existsSync(file), file);
  assert.ok(files.includes('vendor/smplr/index.mjs'));
  assert.ok(files.includes('vendor/supabase.js'));
  assert.equal(JSON.parse(readFileSync('manifest.webmanifest', 'utf8')).display, 'standalone');
  const version = readFileSync('js/version.js', 'utf8').match(/SF\.VERSION = "([^"]+)"/)[1];
  assert.ok(readFileSync('sw.js', 'utf8').includes('CACHE_VERSION = "' + version + '"'));
});
test('cleanUrls redirected HTML can be returned to an offline navigation', async () => {
  const { context } = serviceWorker();
  context.nav = { mode: 'navigate' };
  context.cachedRedirect = { redirected: true, body: '<h1>Offline</h1>', status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'" } };
  const result = vm.runInContext('navigationResponse(nav, cachedRedirect)', context);
  assert.equal(result.redirected, false);
  assert.equal(result.headers.get('Content-Security-Policy'), "default-src 'self'");
  assert.equal(await result.text(), '<h1>Offline</h1>');
});
