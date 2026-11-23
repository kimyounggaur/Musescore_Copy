// P2-B 악보별 저장소(SF.store) — 메모리 백엔드로 동작을, 가짜 IndexedDB로 실제 백엔드 코드를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
globalThis.SF = globalThis.SF || {};
vm.runInThisContext(readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), { filename: 'store.js' });
const { createStore, memoryBackend, indexedDbBackend } = globalThis.SF.storeTesting;

const doc = (id, updatedAt, extra = {}) => ({ id, title: `악보 ${id}`, createdAt: 1, updatedAt, revision: 3, origin: 'new', cloudId: null, measures: 4, bytes: 100, schema: 1, data: { parts: [], measures: [{ events: [] }] }, ...extra });
const opened = async (options) => { const store = createStore(memoryBackend(options)); await store.open(); return store; };

test('saveDoc·loadDoc·deleteDoc: 저장한 것을 그대로 읽고, 지우면 사라진다', async () => {
  const store = await opened();
  assert.equal(store.backend, 'memory'); assert.equal(store.usable, true);
  assert.equal(await store.loadDoc('없는 문서'), null);
  await store.saveDoc(doc('a', 10));
  assert.deepEqual(await store.loadDoc('a'), doc('a', 10));
  await store.saveDoc(doc('a', 20, { title: '바뀐 제목' }));                       // 같은 id는 덮어쓴다
  assert.equal((await store.loadDoc('a')).title, '바뀐 제목');
  await store.deleteDoc('a');
  assert.equal(await store.loadDoc('a'), null);
});

test('읽어 온 값을 고쳐도 저장된 기록은 그대로(복사본을 돌려준다)', async () => {
  const store = await opened();
  await store.saveDoc(doc('a', 10));
  const first = await store.loadDoc('a'); first.data.measures.push({ events: ['끼어듦'] }); first.title = '몰래 바꿈';
  const second = await store.loadDoc('a');
  assert.equal(second.title, '악보 a'); assert.equal(second.data.measures.length, 1);
});

test('listDocs: data를 빼고 updatedAt 내림차순', async () => {
  const store = await opened();
  await store.saveDoc(doc('old', 10)); await store.saveDoc(doc('new', 30)); await store.saveDoc(doc('mid', 20));
  const list = await store.listDocs();
  assert.deepEqual(list.map(row => row.id), ['new', 'mid', 'old']);
  for (const row of list) { assert.equal('data' in row, false); assert.equal(row.measures, 4); assert.equal(row.schema, 1); }
});

test('kv: 없으면 null, 쓰면 읽힌다(문서 목록과 섞이지 않는다)', async () => {
  const store = await opened();
  assert.equal(await store.kvGet('lastDocId'), null);
  await store.kvSet('lastDocId', 'a'); await store.kvSet('migrated.v1', { at: 5 });
  assert.equal(await store.kvGet('lastDocId'), 'a'); assert.deepEqual(await store.kvGet('migrated.v1'), { at: 5 });
  assert.deepEqual(await store.listDocs(), []);
});

test('따로 열지 않아도 첫 호출이 연다', async () => {
  const store = createStore(memoryBackend());
  assert.equal(store.backend, 'none');
  await store.saveDoc(doc('a', 1));
  assert.equal(store.backend, 'memory'); assert.equal((await store.loadDoc('a')).id, 'a');
});

test('열기는 한 번만 한다', async () => {
  let opens = 0;
  const backend = memoryBackend(); const open = backend.open; backend.open = async () => { opens++; return open(); };
  const store = createStore(backend);
  assert.equal(store.backend, 'none'); assert.equal(store.usable, false);
  await Promise.all([store.open(), store.open(), store.open()]); await store.open();
  assert.equal(opens, 1);
});

test('열기에 실패하면 backend는 localStorage(예전 방식)이고 문서 기능은 쓸 수 없다', async () => {
  const store = await opened({ failOpen: true });
  assert.equal(store.backend, 'localStorage'); assert.equal(store.usable, false);
  for (const call of [() => store.saveDoc(doc('a', 1)), () => store.loadDoc('a'), () => store.listDocs(), () => store.kvGet('x'), () => store.kvSet('x', 1), () => store.deleteDoc('a')])
    await assert.rejects(call(), error => error.code === 'STORE_UNAVAILABLE');
});

test('열기가 끝나지 않아도(다른 탭이 막음) 시간이 지나면 localStorage 방식으로 간다', async () => {
  const hang = { name: 'hang', open: () => new Promise(() => {}) };
  const store = createStore(hang, { openTimeout: 20 });
  assert.equal(await store.open(), 'localStorage'); assert.equal(store.usable, false);
});

test('저장 공간 부족(QuotaExceededError)은 그대로 위로 올라간다', async () => {
  const store = await opened({ failPut: true });
  await assert.rejects(store.saveDoc(doc('a', 1)), error => error.name === 'QuotaExceededError');
  assert.deepEqual(await store.listDocs(), []);
});

// ---- 실제 IndexedDB 백엔드 코드: 가짜 indexedDB(구조만 흉내) ----
function fakeIndexedDB({ invalidOnce = false } = {}) {
  const databases = new Map(); let invalid = invalidOnce, opens = 0;
  return {
    get opens() { return opens; },
    open(name) {
      opens++; const request = {};
      queueMicrotask(() => {
        let data = databases.get(name); const fresh = !data;
        if (fresh) { data = { stores: {} }; databases.set(name, data); }
        const db = {
          close() { this.closed = true; },
          createObjectStore(storeName, options) { data.stores[storeName] = { keyPath: options?.keyPath, rows: new Map() }; return { createIndex() {} }; },
          transaction(storeName) {
            if (invalid) { invalid = false; throw Object.assign(new Error('연결이 닫혔어요'), { name: 'InvalidStateError' }); }
            const store = data.stores[storeName], tx = {};
            const op = fn => { const req = {}; queueMicrotask(() => { req.result = fn(); req.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return req; };
            const objectStore = {
              get: key => op(() => store.rows.get(key)),
              put: (value, key) => op(() => { const k = store.keyPath ? value[store.keyPath] : key; store.rows.set(k, structuredClone(value)); return k; }),
              delete: key => op(() => { store.rows.delete(key); }),
              getAll: () => op(() => [...store.rows.values()].map(value => structuredClone(value))),
            };
            tx.objectStore = () => objectStore; return tx;
          },
        };
        request.result = db;
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test('IndexedDB 백엔드: 문서·kv를 읽고 쓰고, 목록은 data를 뺀다', async () => {
  const store = createStore(indexedDbBackend(() => fakeIndexedDB()));
  assert.equal(await store.open(), 'indexeddb');
  await store.saveDoc(doc('a', 10)); await store.saveDoc(doc('b', 20)); await store.kvSet('lastDocId', 'b');
  assert.equal((await store.loadDoc('a')).title, '악보 a');
  assert.deepEqual((await store.listDocs()).map(row => row.id), ['b', 'a']);
  assert.equal(await store.kvGet('lastDocId'), 'b');
  await store.deleteDoc('a');
  assert.equal(await store.loadDoc('a'), null);
});

test('IndexedDB 백엔드: 연결이 닫혀 있으면(InvalidStateError) 한 번 다시 열고 이어간다', async () => {
  const idb2 = fakeIndexedDB({ invalidOnce: true });                     // 다음 transaction()이 한 번 실패하는 환경
  const store2 = createStore(indexedDbBackend(() => idb2)); await store2.open();
  await store2.saveDoc(doc('a', 10));                                   // 첫 시도 실패 → 다시 열고 재시도 → 성공
  assert.equal(idb2.opens, 2);
  assert.equal((await store2.loadDoc('a')).title, '악보 a');
});

test('IndexedDB가 아예 없으면 localStorage 방식', async () => {
  const store = createStore(indexedDbBackend(() => undefined));
  assert.equal(await store.open(), 'localStorage'); assert.equal(store.usable, false);
});

test('구조 고정: store.js는 localStorage 원본을 지우지 않는다', () => {
  const source = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8') + readFileSync(new URL('../js/session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage\??\.removeItem|removeItem\(\s*LEGACY/);
  assert.doesNotMatch(source, /\.clear\(\)/);
});
