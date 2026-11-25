/* js/store.js — 악보별 자동 저장소.
 * IndexedDB(docs·kv)를 우선 쓰고, 열 수 없으면 backend가 "localStorage"가 되어
 * 지금까지처럼 localStorage 1칸 방식으로 동작한다(그때는 문서 목록 기능을 쓸 수 없다).
 * 테스트에서는 createStore(memoryBackend())로 같은 동작을 메모리에서 확인한다. */
"use strict";
(function (SF) {
  const request = req => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });

  /** IndexedDB 백엔드. factory는 테스트에서 가짜 indexedDB를 넣기 위한 자리. */
  function indexedDbBackend(factory = () => globalThis.indexedDB) {
    let db = null;
    function run(name, mode, fn) {
      return new Promise((ok, fail) => {
        const transaction = db.transaction(name, mode);
        const req = fn(transaction.objectStore(name));
        transaction.oncomplete = () => ok(req?.result);
        transaction.onerror = transaction.onabort = () => fail(transaction.error);
      });
    }
    const api = {
      name: "indexeddb",
      async open() {
        const idb = factory();
        if (!idb) throw new Error("IndexedDB를 쓸 수 없어요");
        const opening = idb.open("scoreforge", 1);
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore("docs", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
          opening.result.createObjectStore("kv");
        };
        db = await request(opening);
        db.onversionchange = () => db.close();   // 다른 탭이 더 새로운 형식으로 올리려 하면 길을 비켜 준다
      },
      // 연결이 닫혀 있으면(InvalidStateError) 한 번 다시 열고 재시도한다.
      async transact(name, mode, fn) {
        try { return await run(name, mode, fn); }
        catch (error) {
          if (error?.name !== "InvalidStateError") throw error;
          await api.open();
          return run(name, mode, fn);
        }
      },
      get: (name, key) => api.transact(name, "readonly", s => s.get(key)),
      put: (name, value, key) => api.transact(name, "readwrite", s => key === undefined ? s.put(value) : s.put(value, key)),
      delete: (name, key) => api.transact(name, "readwrite", s => s.delete(key)),
      getAll: name => api.transact(name, "readonly", s => s.getAll()),
      /** 한 트랜잭션 안에서 읽고(mutate) 쓴다 — 읽은 뒤 다른 탭이 값을 바꿔도 덮어쓰지 않는다. mutate가 undefined를 돌려주면 쓰지 않는다. 썼으면 true. */
      async update(name, key, mutate) {
        let changed = false;
        await api.transact(name, "readwrite", s => {
          changed = false;
          const read = s.get(key);
          read.onsuccess = () => {
            const next = mutate(read.result);
            if (next === undefined) return;
            if (name === "kv") s.put(next, key); else s.put(next);
            changed = true;
          };
          return read;
        });
        return changed;
      },
    };
    return api;
  }

  /** 메모리 백엔드(테스트용). failOpen/failPut으로 실패 상황을 흉내 낸다. 값은 복사해서 넣고 꺼낸다(IndexedDB와 같은 의미). */
  function memoryBackend(options = {}) {
    const stores = { docs: new Map(), kv: new Map() };
    const copy = value => value === undefined ? undefined : structuredClone(value);
    const api = {
      name: "memory", options,
      async open() { if (options.failOpen) throw new Error("저장소를 열 수 없어요"); },
      async get(name, key) { return copy(stores[name].get(key)); },
      async put(name, value, key) {
        if (options.failPut) throw Object.assign(new Error("저장 공간이 부족해요"), { name: "QuotaExceededError" });
        stores[name].set(key === undefined ? value.id : key, copy(value));
      },
      async delete(name, key) { stores[name].delete(key); },
      async getAll(name) { return [...stores[name].values()].map(copy); },
      async update(name, key, mutate) {
        if (options.failPut) throw Object.assign(new Error("저장 공간이 부족해요"), { name: "QuotaExceededError" });
        const next = mutate(copy(stores[name].get(key)));
        if (next === undefined) return false;
        stores[name].set(key, copy(next));
        return true;
      },
    };
    return api;
  }

  /** openTimeout(ms): 다른 탭이 막아서 열기가 끝나지 않아도 앱이 멈추지 않게, 그때는 localStorage 방식으로 간다. */
  function createStore(backend, { openTimeout = 5000 } = {}) {
    let backendName = "none", opening = null;
    function open() {
      return opening ||= (async () => {
        let timer;
        try {
          await Promise.race([
            backend.open(),
            new Promise((_, fail) => { timer = setTimeout(() => fail(new Error("저장소 열기 시간 초과")), openTimeout); }),
          ]);
          backendName = backend.name;
        } catch { backendName = "localStorage"; }
        finally { clearTimeout(timer); }
        return backendName;
      })();
    }
    // 먼저 열지 않았어도 첫 호출이 연다. 쓸 수 없으면(예전 방식으로 돌아간 경우) STORE_UNAVAILABLE.
    async function ready() {
      await open();
      if (backendName !== backend.name) throw Object.assign(new Error("문서 저장소를 쓸 수 없어요"), { code: "STORE_UNAVAILABLE" });
    }
    return {
      open,
      /** "none"(열기 전) · "indexeddb" · "memory"(테스트) · "localStorage"(열기 실패 → 1칸 방식) */
      get backend() { return backendName; },
      /** 문서 저장·목록을 쓸 수 있는가(열린 뒤에 true) */
      get usable() { return backendName === backend.name; },
      async saveDoc(doc) { await ready(); await backend.put("docs", doc); return doc; },
      async loadDoc(id) { await ready(); return (await backend.get("docs", id)) ?? null; },
      async deleteDoc(id) { await ready(); await backend.delete("docs", id); },
      /** data를 뺀 요약만, 수정 시각 내림차순 */
      async listDocs() {
        await ready();
        const rows = await backend.getAll("docs");
        return rows.map(({ data, ...summary }) => summary).sort((a, b) => b.updatedAt - a.updatedAt);
      },
      async kvGet(key) { await ready(); return (await backend.get("kv", key)) ?? null; },
      async kvSet(key, value) { await ready(); await backend.put("kv", value, key); },
      /** 기록 하나를 읽고 고쳐 쓴다(한 트랜잭션). mutate(기록 또는 undefined) → 새 기록, undefined면 그대로 둔다. 바꿨으면 true. */
      async updateDoc(id, mutate) { await ready(); return backend.update("docs", id, mutate); },
      /** kv 값 하나를 읽고 고쳐 쓴다(한 트랜잭션). mutate(옛 값 또는 undefined) → 새 값(null 가능), undefined면 그대로. */
      async updateKv(key, mutate) { await ready(); return backend.update("kv", key, mutate); },
    };
  }

  SF.store = createStore(indexedDbBackend());
  SF.storeTesting = { createStore, memoryBackend, indexedDbBackend };
})(window.SF);
