/* js/session.js — 열린 악보의 "교체 통로"와 "악보별 보관".
 * ① 열기·끌어다 놓기·앱 파일 실행·새 악보·데모·클라우드·사본이 모두 replaceScore를 거친다(P2-A).
 *    변경이 있는 악보를 묻지도 않고 갈아 끼우지 않고, 연속 요청은 순서대로 처리한다.
 * ② 악보마다 문서 ID(meta.docId)를 붙여 IndexedDB에 따로 자동 저장한다(P2-B).
 *    기록은 첫 편집 때 만들고, 부팅 때 이 탭이 보던 악보를 되살린다. 옛 localStorage 자동 저장은 한 번 옮기되 원본은 지우지 않는다.
 * ③ 열려 있는 악보마다 SF.lock의 편집 잠금을 하나 쥔다(P2-D). 다른 탭이 이미 편집 중인 악보는 읽기 전용으로 열고,
 *    풀리면 알려 준다. 사용자가 [편집 시작]을 누르면 보관된 최신 내용을 다시 읽어 와서 연다(오래된 화면 내용으로 편집하지 않는다).
 * ④ 부팅 안전 모드(P2-E): 열 수 없는 기록은 격리(quarantined)하고 건너뛰며, 첫 렌더가 끝나기 전까지 kv "boot.pending"에 "여는 중"을
 *    적어 둔다. 렌더 중 멈춰서 표시가 남았다면 다음 부팅은 그 문서를 자동으로 열지 않고 앱이 사용자에게 묻는다(bootInfo). */
"use strict";
(function (SF) {
  const C = SF.core;
  let chain = Promise.resolve();

  const SCHEMA = 1;                              // 기록 data의 형식 버전(악보 JSON v1)
  const TAB_KEY = "scoreforge.activeDocId";      // sessionStorage — 이 탭이 지금 보는 문서
  const LEGACY_KEY = "scoreforge.autosave.v1";   // 예전 1칸 자동 저장(읽기만 한다 — 지우지 않는다)
  const LEGACY_ID = "legacy-v1";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SAFE_ID = /^[A-Za-z0-9:_.-]{1,120}$/;
  const ORIGINS = new Set(["new", "demo", "file", "import", "cloud", "copy", "legacy"]);
  const KEPT = "이전 악보는 최근 작업에 보관했어요";
  const COPY_MADE = "사본을 만들었어요. 이제 편집할 수 있어요.";
  const IDENTITY_KEYS = ["docId", "cloudId", "cloudUpdatedAt", "cloudOwner", "cloudProject"];   // 사본에는 붙이지 않는 식별 필드(cloud.js META_KEYS + docId)
  const PENDING_KEY = "boot.pending";            // kv — { 문서ID: 여는 중이 된 시각 }. 첫 렌더가 끝나면 지운다
  const PENDING_MAX = 20;                        // 지워지지 않고 남는 표시가 끝없이 쌓이지 않게(오래된 것부터 버린다)
  const PENDING = Symbol("pending");             // 후보가 "지난 부팅이 끝나지 못한 문서"라 열지 않았다

  const store = () => SF.store;                  // 테스트에서 바꿔 끼울 수 있게 부를 때마다 읽는다
  const validId = id => typeof id === "string" && SAFE_ID.test(id);

  function newId() {
    const api = window.crypto;
    if (api && typeof api.randomUUID === "function") return api.randomUUID();
    const bytes = new Uint8Array(16);
    if (api && api.getRandomValues) api.getRandomValues(bytes); else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /* ---------------- 이 탭의 현재 문서 ---------------- */
  function readTabId() { try { return window.sessionStorage?.getItem(TAB_KEY) || ""; } catch { return ""; } }
  function writeTabId(id) {
    try { if (id) window.sessionStorage?.setItem(TAB_KEY, id); else window.sessionStorage?.removeItem(TAB_KEY); } catch { /* 저장소를 못 쓰는 환경 */ }
  }
  /** 현재 문서의 부가 정보. 식별자의 기준은 악보의 meta.docId이고, 여기에는 기록에서 이어받을 값만 둔다.
   * createdAt이 0이면 아직 기록이 없는 문서(열기만 한 데모·새 악보), known=false면 첫 저장 때 기록을 한 번 읽어 온다. */
  let active = { id: "", origin: "new", createdAt: 0, fileSavedAt: 0, known: true };

  /** 지금 편집 중인 문서의 ID. 기록이 없는 악보라면 빈 문자열일 수 있다. */
  function activeId() { return C.state.score?.meta?.docId || ""; }

  function pickId(score, origin, explicit) {
    if (validId(explicit)) return explicit;
    if (origin === "cloud" && score.meta?.cloudId) return "cloud:" + score.meta.cloudId;
    // 파일이 가져온 ID는 UUID 모양일 때만 이어받는다(다른 문서의 ID를 흉내 낸 파일이 기록을 건드리지 못하게).
    if (origin === "file" && UUID.test(score.meta?.docId || "")) return score.meta.docId;
    return newId();
  }

  /** 악보에 문서 ID를 붙이고 이 탭의 현재 문서로 삼는다(설치 직전에 부른다. 악보 객체의 meta 식별 필드 — CLAUDE.md 2-1 예외).
   * info: origin, docId(이어서 열 때), record(이미 있는 기록 — createdAt·origin·fileSavedAt을 이어받음) */
  function claim(score, info = {}) {
    const origin = ORIGINS.has(info.origin) ? info.origin : "new";
    const id = validId(info.picked) ? info.picked : pickId(score, origin, info.docId);   // picked: 잠금을 잡느라 미리 정한 ID
    if (!score.meta) score.meta = {};
    score.meta.docId = id;
    const record = info.record || null;
    active = {
      id, origin: record?.origin || origin, createdAt: record?.createdAt || 0, fileSavedAt: record?.fileSavedAt || 0,
      known: Boolean(record) || !(origin === "cloud" || validId(info.docId)),
    };
    writeTabId(id);
    return id;
  }
  /** 기록이 없는 상태로 둔다 — 공유 보기(읽기 전용)는 저장하지 않는다. */
  function release(score) {
    if (score?.meta) delete score.meta.docId;
    active = { id: "", origin: "new", createdAt: 0, fileSavedAt: 0, known: true };
    writeTabId("");
  }

  /* ---------------- 탭 간 편집 잠금(P2-D) ---------------- */
  // docId: 이 탭이 보는 문서(공유 보기처럼 문서가 없으면 ""), handle: 이 탭이 쥔 잠금(읽기 전용이면 null),
  // locked: 다른 탭이 편집 중이라 읽기 전용으로 열었음, available: 그 탭이 놓아서 이제 편집을 시작할 수 있음.
  let lock = { docId: "", handle: null, locked: false, available: false, stopWatch: null };
  const lockListeners = new Set();
  const lockState = () => ({ docId: lock.docId, locked: lock.locked, available: lock.available });
  function onLock(fn) { lockListeners.add(fn); return () => lockListeners.delete(fn); }
  function emitLock() {
    const state = lockState();
    for (const fn of [...lockListeners]) { try { fn(state); } catch { /* 화면 쪽 오류가 열기·저장을 막지 않게 */ } }
  }
  /** 이 탭의 잠금 상태를 바꾼다. 읽기 전용(다른 탭이 편집 중)이면 풀리는 때를 지켜본다. */
  function setLock(next) {
    lock.stopWatch?.();
    lock = { docId: "", handle: null, locked: false, available: false, stopWatch: null, ...next };
    if (lock.locked && lock.docId && SF.lock?.watch) {
      lock.stopWatch = SF.lock.watch(lock.docId, () => { lock.stopWatch = null; lock.available = true; emitLock(); });
    }
    emitLock();
  }
  const drop = handle => { try { handle?.release(); } catch { /* 이미 놓았다 */ } };
  /** 문서 잠금을 잡는다. locked=true면 다른 탭이 쥐고 있다. 잠금 모듈이 없거나 오류가 나면 막지 않고 연다. */
  async function lockDoc(id, options) {
    if (!SF.lock?.acquire) return { handle: null, locked: false };
    try { const handle = await SF.lock.acquire(id, options); return { handle, locked: !handle }; } catch { return { handle: null, locked: false }; }
  }
  /** claim + 잠금. 교체 통로를 거치지 않고 악보를 여는 곳(부팅 때 데모)이 쓴다. */
  async function adopt(score, info = {}) {
    const origin = ORIGINS.has(info.origin) ? info.origin : "new";
    const id = pickId(score, origin, info.docId);
    const got = await lockDoc(id);
    claim(score, { ...info, picked: id });
    setLock({ docId: id, handle: got.handle, locked: got.locked });
    return { id, locked: got.locked };
  }

  // 보관 목록이 바뀌었음을 다른 탭에 알린다(최근 작업 창이 열려 있으면 새로 그린다). 편집 중에는 1초에 한 번만.
  let announceTimer = 0, announcedAt = 0;
  function announceDocs(docId) {
    const send = () => { announceTimer = 0; announcedAt = Date.now(); SF.lock?.notify?.("docs-changed", { docId }); };
    const wait = 1000 - (Date.now() - announcedAt);
    if (wait <= 0) send(); else if (!announceTimer) announceTimer = setTimeout(send, wait);
  }

  /* ---------------- 쓰기: io.js의 자동 저장 writer ---------------- */
  let writes = Promise.resolve();
  let persistAsked = false;
  function requestPersistence() {
    if (persistAsked) return; persistAsked = true;
    try { window.navigator?.storage?.persist?.()?.catch?.(() => {}); } catch { /* 지원하지 않는 브라우저 */ }
  }
  const sizeOf = json => typeof TextEncoder === "function" ? new TextEncoder().encode(json).length : json.length;

  /** io.autosave가 700ms 뒤 부르는 writer. 성공하면 resolve, 저장 공간 부족 등은 reject(→ 토스트).
   * 저장소를 열 수 없으면 예전 1칸 localStorage 방식으로 대신 쓴다. */
  function persist(score, revision, savedAt) {
    const s = store();
    if (!s) return SF.io.writeLegacyAutosave(score, revision, savedAt);
    if (s.backend === "none") {
      return s.open().then(() => {
        // 여는 동안 더 새로운 편집이 생겼으면 그쪽의 자동 저장이 이어서 기록한다.
        if (score !== C.state.score || revision !== C.state.revision) return undefined;
        return persist(score, revision, savedAt);
      });
    }
    if (!s.usable) return SF.io.writeLegacyAutosave(score, revision, savedAt);
    if (C.state.readOnly) return Promise.resolve();   // 공유 보기는 기록하지 않는다
    // await 전에 직렬화해서, 저장한 내용과 revision 표시가 어긋나지 않게 한다.
    if (!score.meta) score.meta = {};
    if (!validId(score.meta.docId)) score.meta.docId = newId();   // setScore로 곧장 들어온 악보
    const id = score.meta.docId;
    if (active.id !== id) active = { id, origin: "new", createdAt: 0, fileSavedAt: 0, known: false };
    const info = active;
    const data = C.toJSON(score);
    const json = JSON.stringify(data);
    const body = {
      id, title: String(score.meta.title ?? ""), updatedAt: savedAt, revision, cloudId: score.meta.cloudId ?? null,
      measures: Array.isArray(data.measures) ? data.measures.length : 0, bytes: sizeOf(json), schema: SCHEMA, data,
    };
    const run = async () => {
      // 교체 통로를 거치지 않고 들어온 악보(setScore 직접 호출)는 쓰기 전에 잠금부터 잡는다 — 다른 탭의 문서를 덮어쓰지 않게.
      let temporary = null;
      if (lock.docId !== id && SF.lock?.acquire) {
        const got = await lockDoc(id);
        if (got.locked) throw new Error("다른 탭이 편집 중인 악보라 자동 저장하지 않았어요");   // 저장 실패로 알린다(덮어쓰지 않는다)
        if (C.state.score?.meta?.docId === id) { const old = lock.handle; setLock({ docId: id, handle: got.handle, locked: false }); if (old && old !== got.handle) drop(old); }
        else temporary = got.handle;               // 그새 다른 악보로 바뀌었다 — 쓰는 동안만 쥐고 놓는다
      }
      try {
        if (!info.known) {
          const old = await s.loadDoc(id).catch(() => null);
          if (old) { info.createdAt = old.createdAt || 0; info.origin = old.origin || info.origin; info.fileSavedAt = old.fileSavedAt || 0; }
          info.known = true;
        }
        if (!info.createdAt) info.createdAt = savedAt;
        await s.saveDoc({ ...body, createdAt: info.createdAt, origin: info.origin, fileSavedAt: info.fileSavedAt || 0 });
        await s.kvSet("lastDocId", id).catch(() => {});
        if (active.id === id) writeTabId(id);
        requestPersistence();
        announceDocs(id);
      } finally { drop(temporary); }
    };
    const result = writes.then(run, run);       // 저장 순서를 요청 순서와 같게 지킨다
    writes = result.catch(() => {});
    return result;
  }

  /** 대기 중인 자동 저장을 지금 끝내고, 현재 악보가 보관돼 있으면 true.
   * 저장소가 IndexedDB(문서별 기록)가 아니면 항상 false — 1칸 localStorage는 다음 악보가 덮어써서 보관이 아니다. */
  async function flushActive() {
    const s = store();
    if (!s || typeof SF.io?.flushAutosave !== "function") return false;
    try {
      await s.open();
      if (!s.usable) return false;
      const ok = await SF.io.flushAutosave();
      return Boolean(ok) && C.isAutosaved();
    } catch { return false; }
  }

  /** 파일로 저장했음을 기록한다(상태 표시줄 "마지막 파일 저장"). 기록이 있는 문서면 기록에도 남긴다. */
  function noteFileSaved() {
    active.fileSavedAt = Date.now();
    if (active.createdAt && !C.state.readOnly) SF.io?.autosave?.(C.state.score, { delay: 0 });
  }
  function clock(at) {
    const d = new Date(at), pad = n => String(n).padStart(2, "0"), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  /** 상태 표시줄 문구. 기록이 없는 문서(열기만 한 데모·새 악보)와 공유 보기는 비워 둔다. */
  function savedLabel() {
    if (C.state.readOnly || !active.createdAt) return "";
    return active.fileSavedAt ? `마지막 파일 저장 ${clock(active.fileSavedAt)}` : "파일로 저장한 적 없어요";
  }

  /* ---------------- 부팅 복원 · 옛 자동 저장 이전 ---------------- */
  /** localStorage의 예전 자동 저장(v1)을 문서 하나로 옮긴다. kv "migrated.v1"이 있으면 다시 하지 않고, 원본은 지우지 않는다.
   * 이전에 실패하면(읽기·형식·쓰기 오류) 아무것도 바꾸지 않고 false — 다음 부팅에 다시 시도한다. */
  async function migrateLegacyAutosave() {
    const s = store();
    if (!s?.usable) return false;
    try {
      if (await s.kvGet("migrated.v1")) return false;
      let raw = null;
      try { raw = window.localStorage?.getItem(LEGACY_KEY); } catch { /* 저장소 접근 거부 */ }
      if (!raw) return false;
      if (!(await s.loadDoc(LEGACY_ID))) {
        const obj = JSON.parse(raw);
        if (!obj?.score || (!obj.score.measures && !obj.score.parts)) return false;
        const score = C.fromJSON(obj.score);
        score.meta.docId = LEGACY_ID;
        const data = C.toJSON(score), at = Number(obj.savedAt) || Date.now();
        await s.saveDoc({
          id: LEGACY_ID, title: String(score.meta.title ?? ""), createdAt: at, updatedAt: at, revision: Number(obj.revision) || 0,
          origin: "legacy", cloudId: score.meta.cloudId ?? null, measures: Array.isArray(data.measures) ? data.measures.length : 0,
          bytes: sizeOf(JSON.stringify(data)), schema: SCHEMA, fileSavedAt: 0, data,
        });
      }
      await s.kvSet("migrated.v1", { at: Date.now(), from: LEGACY_KEY });
      return true;
    } catch { return false; }
  }

  /* ---------------- 부팅 안전 모드(P2-E) ---------------- */
  // 이번 부팅에서 있었던 일. 앱이 화면을 다 만든 뒤 bootInfo()로 읽는다.
  //   pending: 지난 부팅이 끝나지 못한 문서(자동으로 열지 않았다) · quarantined: 이번에 새로 격리한 기록 ·
  //   opened: 이번 부팅이 열어 둔 문서(첫 렌더가 끝나면 bootDone이, 예외면 bootFailed가 정리한다)
  const boot = { pending: null, quarantined: [], opened: null };
  const bootInfo = () => ({ pending: boot.pending, quarantined: boot.quarantined.slice() });

  /** kv "boot.pending"을 { 문서ID: 시각 }으로 읽는다. 문자열 ID 하나인 옛 모양도 받는다. */
  function pendingMap(raw) {
    const map = Object.create(null);
    if (validId(raw)) map[raw] = 0;
    else if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [id, at] of Object.entries(raw)) if (validId(id)) map[id] = Number(at) || 0;
    return map;
  }
  /** 문서 하나의 "여는 중" 표시를 켜거나 끈다. 여러 탭이 동시에 부팅해도 서로의 표시를 지우지 않게 한 트랜잭션 안에서 고친다. */
  async function setPending(id, on) {
    const s = store();
    if (!s?.usable || !validId(id)) return false;
    try {
      await s.updateKv(PENDING_KEY, old => {
        const map = pendingMap(old);
        delete map[id];
        const rest = Object.entries(map).sort((a, b) => b[1] - a[1]);
        const entries = (on ? [[id, Date.now()], ...rest] : rest).slice(0, PENDING_MAX);   // 방금 적은 표시는 항상 남긴다
        return entries.length ? Object.fromEntries(entries) : null;
      });
      return true;
    } catch { return false; }
  }

  /** 열 수 없는 기록을 격리한다: quarantined 표시와 오류를 붙이고 data·updatedAt은 그대로 둔다(최근 작업에서 내려받을 수 있다).
   * 읽은 뒤 다른 탭이 새로 저장했거나(updatedAt·revision이 달라짐) 이미 격리돼 있으면 건드리지 않는다.
   * report=true면 이번 부팅의 "새로 격리한 기록"에 올려 앱이 토스트로 알리게 한다. */
  async function quarantine(doc, error, report = true) {
    const s = store();
    const info = { at: Date.now(), code: String(error?.code || error?.name || "Error").slice(0, 40), message: String(error?.message ?? error).slice(0, 200) };
    let changed = false, failed = false;
    try {
      changed = await s.updateDoc(doc.id, current => (current && !current.quarantined && current.updatedAt === doc.updatedAt && current.revision === doc.revision)
        ? { ...current, quarantined: true, quarantineError: info } : undefined);
    } catch { failed = true; }   // 표시를 못 써도 부팅은 계속한다 — 다음 부팅에 다시 걸러진다
    if (report && (changed || failed)) boot.quarantined.push({ id: doc.id, title: String(doc.title ?? ""), code: info.code });
    return changed;
  }

  /** 보관된 기록 하나를 부팅 후보로 열어 본다. 악보(claim·잠금까지 끝남) · PENDING(지난 부팅이 끝나지 못한 문서 — 열지 않음) · null(건너뜀).
   * mine: 이 탭이 보던 문서 — 새로고침 직후 옛 잠금이 풀리길 기다리고, 다른 탭이 쥐고 있어도 읽기 전용으로 되살린다.
   * pending: { 문서ID: 시각 } — 넘기면 표시가 남은 문서를 열지 않고 PENDING을 돌려준다(안전 모드의 [그래도 열기]는 넘기지 않는다). */
  async function tryRecord(id, { mine = false, pending = {} } = {}) {
    const s = store();
    if (!validId(id)) return null;
    const doc = await s.loadDoc(id).catch(() => null);
    if (!doc?.data || doc.quarantined) return null;                    // 이미 격리한 기록은 자동으로 열지 않는다
    let score;
    try { SF.schema?.checkShape(doc.data); score = C.fromJSON(doc.data); }
    catch (error) { await quarantine(doc, error); return null; }       // 깨진 기록은 격리하고 건너뛴다
    const got = await lockDoc(id, mine ? { retries: 4 } : undefined);
    if (got.locked && !mine) return null;
    if (pending[id] !== undefined) {                         // 지난 부팅이 이 문서에서 끝나지 못했다 — 자동으로 다시 열지 않는다
      drop(got.handle);
      boot.pending = { id, title: String(doc.title ?? "") };
      return PENDING;
    }
    claim(score, { origin: doc.origin, docId: doc.id, record: doc });
    setLock({ docId: id, handle: got.handle, locked: got.locked });
    boot.opened = { id, title: String(doc.title ?? ""), updatedAt: doc.updatedAt, revision: doc.revision };
    return score;
  }

  /** 시작 악보를 고른다: 이 탭의 문서 → 마지막으로 편집한 문서 → 가장 최근 문서 → 없으면 null(데모는 호출한 쪽이 연다).
   * 읽을 수 없는 기록은 격리하고 건너뛴다. 돌려주는 악보는 이미 이 탭의 현재 문서로 등록돼 있다.
   * 다른 탭이 편집 중인 문서는 건너뛴다 — 다만 이 탭이 보던 문서(새로고침 전)라면 읽기 전용으로 되살린다(lockState().locked로 확인).
   * 지난 부팅이 끝나지 못한 문서가 시작 문서라면 열지 않고 null — bootInfo().pending으로 앱이 사용자에게 묻는다. */
  async function restoreOnBoot() {
    boot.pending = null; boot.quarantined = []; boot.opened = null;
    const s = store();
    try { await s?.open(); } catch { /* 열기 실패는 아래에서 처리 */ }
    if (!s?.usable) {                             // 예전 방식(localStorage 1칸)으로 되돌린다
      try { return SF.io.loadAutosave(); } catch { return null; }
    }
    try {
      await migrateLegacyAutosave();
      const pending = pendingMap(await s.kvGet(PENDING_KEY).catch(() => null));
      const tried = new Set();
      const next = (id, mine) => { if (tried.has(id)) return null; tried.add(id); return tryRecord(id, { mine, pending }); };
      let found = await next(readTabId(), true);
      if (!found) found = await next(await s.kvGet("lastDocId").catch(() => null), false);
      if (!found) for (const doc of (await s.listDocs()).filter(d => !d.quarantined).slice(0, 8)) { found = await next(doc.id, false); if (found) break; }
      if (found === PENDING) return null;
      if (found) return found;
      // 이전하지 못한 예전 자동 저장이 남아 있으면 그대로 보여 준다(원본은 건드리지 않았고, 첫 편집 때 다시 문서로 옮겨 쓴다).
      if (!(await s.kvGet("migrated.v1").catch(() => null))) {
        const legacy = SF.io.loadAutosave?.();
        if (legacy) { claim(legacy, { origin: "legacy", docId: LEGACY_ID }); return legacy; }
      }
    } catch { /* 저장소 오류 — 데모로 시작 */ }
    return null;
  }

  /** 복원한 악보를 설치하기 직전에 부른다: 이 문서를 "여는 중"으로 적어 둔다(쓰기가 끝날 때까지 기다린다 — 렌더 중 멈춰도 다음 부팅이 알 수 있게).
   * 표시를 적었으면 true. 복원한 기록이 없거나(데모·옛 방식) 저장소를 못 쓰면 false. */
  async function bootBegin() {
    const opened = boot.opened;
    return opened ? setPending(opened.id, true) : false;
  }
  /** 첫 렌더가 끝났다 — "여는 중" 표시를 지운다. */
  async function bootDone() {
    const opened = boot.opened;
    boot.opened = null;
    if (opened) await setPending(opened.id, false);
  }
  /** 설치·첫 렌더 중 예외가 났다 — 그 기록을 격리하고 표시를 지우고 잠금을 놓는다(이어서 앱이 데모를 연다). 격리했으면 true. */
  async function bootFailed(error) {
    const opened = boot.opened;
    boot.opened = null;
    if (!opened) return false;
    const changed = await quarantine(opened, error);
    await setPending(opened.id, false);
    if (lock.docId === opened.id) { drop(lock.handle); setLock({}); }
    return changed;
  }
  /** 안전 모드 [그래도 열기]: 지난번에 끝나지 못한 문서를 일반 부팅처럼 연다. 열 수 있으면 악보, 아니면 null. */
  async function bootOpenPending() {
    const pending = boot.pending;
    if (!pending) return null;
    boot.pending = null;
    const found = await tryRecord(pending.id, { mine: true });   // pending 맵을 넘기지 않는다 — 표시를 확인하지 않고 연다
    return found && found !== PENDING ? found : null;
  }
  /** 안전 모드 [새 악보로 시작]: 그 기록을 BOOT_INTERRUPTED로 격리하고 표시를 지운다(같은 대화상자가 매번 반복되지 않게). */
  async function bootSkipPending() {
    const pending = boot.pending;
    if (!pending) return false;
    boot.pending = null;
    const doc = await store().loadDoc(pending.id).catch(() => null);
    if (doc) await quarantine(doc, { code: "BOOT_INTERRUPTED", message: "지난번에 여는 중 끝나지 못했어요" }, false);
    await setPending(pending.id, false);
    return true;
  }
  /** 안전 모드 [파일로 내려받기]: 보관된 기록 그대로(열어 보지 않고) 파일로 내려받는다. */
  async function bootDownloadPending() {
    const pending = boot.pending;
    if (!pending) return false;
    const doc = await store().loadDoc(pending.id).catch(() => null);
    if (!doc?.data) return false;
    SF.io.download(`${SF.io.safeName(doc.title)}.scoreforge.json`, SF.io.jsonFileText(doc.data), "application/json");
    return true;
  }

  /* ---------------- 교체 통로 ---------------- */
  /** 현재 악보를 갈아 끼워도 되는지 확인한다. 읽기 전용이거나 변경이 없으면 묻지 않는다.
   * kept=true는 묻지 않고 보관해 둔 경우(최근 작업에서 다시 열 수 있다). */
  async function check(reason = "다른 악보 열기") {
    if (C.state.readOnly || !C.state.dirty) return { ok: true, kept: false };
    if (await flushActive()) return { ok: true, kept: true };
    const choice = await SF.ui.choiceDialog({
      title: "저장하지 않은 변경 사항",
      message: `${reason} 전에 현재 악보를 어떻게 할까요?`,
      choices: [
        { id: "save", label: "파일로 저장하고 계속", primary: true },
        { id: "discard", label: "저장하지 않고 계속", danger: true },
        { id: "cancel", label: "취소" },
      ],
    });
    if (choice === "save") {
      try { SF.io.saveJSON(C.state.score); return { ok: true, kept: false }; } catch { return { ok: false, kept: false }; }
    }
    return { ok: choice === "discard", kept: false };
  }
  async function guard(reason) { return (await check(reason)).ok; }

  function sameContent(recordData, score) {
    try { return JSON.stringify(C.toJSON(C.fromJSON(recordData))) === JSON.stringify(C.toJSON(score)); } catch { return false; }
  }

  /** 들어올 악보의 문서 ID를 정한다. 파일의 ID와 같은 기록이 있고 내용이 다르면 묻는다(기존 기록을 묻지 않고 덮어쓰지 않는다).
   * null이면 취소. 공유 보기(읽기 전용)는 ID도 기록도 만들지 않는다. */
  async function plan(next, opts) {
    if (opts.readOnly) return { score: next, readOnly: true };
    const origin = ORIGINS.has(opts.origin) ? opts.origin : "new";
    const s = store();
    if (origin === "file" && !opts.docId && UUID.test(next.meta?.docId || "") && s) {
      try {
        await s.open();
        const existing = s.usable ? await s.loadDoc(next.meta.docId) : null;
        if (existing?.data) {
          if (sameContent(existing.data, next)) return { score: next, info: { origin, docId: existing.id, record: existing } };
          const choice = await SF.ui.choiceDialog({
            title: "같은 악보의 자동 저장본이 있어요",
            message: "이 파일과 같은 악보가 이 기기에 자동 저장돼 있는데 내용이 달라요. 어느 쪽을 열까요?",
            choices: [
              { id: "autosave", label: "자동 저장본 열기", primary: true },
              { id: "file", label: "파일 그대로 열기(새 문서로)" },
              { id: "cancel", label: "취소" },
            ],
          });
          if (choice === "autosave") return { score: C.fromJSON(existing.data), info: { origin, docId: existing.id, record: existing } };
          if (choice !== "file") return null;
          return { score: next, info: { origin, docId: newId() } };
        }
      } catch { /* 저장소를 읽지 못하면 충돌 확인 없이 새 문서로 연다 */ }
    }
    return { score: next, info: { origin, docId: opts.docId } };
  }

  /** 모든 교체 경로가 부른다. 교체했으면 true, 취소하거나 더 새로운 요청에 밀렸으면 false.
   * opts: reason(묻는 문구), confirmed(이미 확인함), stale(확인 뒤에도 유효한지),
   *       origin("new"|"demo"|"file"|"import"|"cloud"|"copy"), docId(이어서 열 문서), readOnly(공유 보기), 나머지는 SF.app.installScore로 전달 */
  function replaceScore(next, opts = {}) {
    const run = async () => {
      let kept = false;
      if (!opts.confirmed) { const verdict = await check(opts.reason); if (!verdict.ok) return false; kept = verdict.kept; }
      if (opts.stale?.()) return false;
      const chosen = await plan(next, opts);
      if (!chosen || opts.stale?.()) return false;
      const before = active;
      const previous = kept ? activeId() : "";    // 보관한 직전 문서 — 토스트 [되돌리기]가 다시 연다
      // 문서 ID를 먼저 정해 편집 잠금을 잡는다. 다른 탭이 편집 중이면 읽기 전용으로 연다(공유 보기는 문서가 없어 잠그지 않는다).
      let id = "", got = { handle: null, locked: false };
      if (!chosen.readOnly) {
        id = pickId(chosen.score, chosen.info.origin, chosen.info.docId);
        got = await lockDoc(id);
        if (opts.stale?.()) { if (got.handle && got.handle !== lock.handle) drop(got.handle); return false; }
      }
      if (chosen.readOnly) release(chosen.score); else claim(chosen.score, { ...chosen.info, picked: id });
      try { SF.app.installScore(chosen.score, got.locked ? { ...opts, readOnly: true } : opts); }
      catch (error) { active = before; writeTabId(before.id); if (got.handle && got.handle !== lock.handle) drop(got.handle); throw error; }
      const old = lock.handle;
      setLock({ docId: id, handle: got.handle, locked: got.locked });
      if (old && old !== got.handle) drop(old);   // 새 악보가 자리 잡은 뒤에야 이전 악보의 잠금을 놓는다
      if (kept) {
        const back = previous && previous !== activeId() ? { action: { label: "되돌리기", run: () => undo(previous) } } : undefined;
        SF.app.toast?.(KEPT, back);
      }
      return true;
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  /** 보관된 문서를 골라 연다(최근 작업 창·토스트 [되돌리기]). 지금 악보는 replaceScore의 보관 규칙(guard)을 거친다.
   * 결과: "opened" | "canceled"(취소했거나 더 새로운 요청에 밀림) | "missing"(기록 없음) | "unreadable"(읽을 수 없는 기록) */
  async function openDoc(id, opts = {}) {
    const s = store();
    if (!s || !validId(id)) return "missing";
    let doc = null;
    try { await s.open(); doc = s.usable ? await s.loadDoc(id) : null; } catch { return "missing"; }
    if (!doc) return "missing";
    let score;
    try { SF.schema?.checkShape(doc.data); score = C.fromJSON(doc.data); } catch { return "unreadable"; }
    const opened = await replaceScore(score, { reason: "최근 작업 열기", ...opts, docId: doc.id, origin: doc.origin });
    return opened ? "opened" : "canceled";
  }
  async function undo(id) {
    const outcome = await openDoc(id, { reason: "이전 악보로 되돌리기" });
    if (outcome === "missing" || outcome === "unreadable") SF.app.toast?.("이전 악보를 열 수 없어요 — 파일 메뉴의 최근 작업에서 확인해 주세요");
    return outcome;
  }

  /** 읽기 전용으로 열어 둔 악보의 편집을 시작한다. 화면에 있던 오래된 내용이 아니라 보관된 최신 내용을 다시 읽어 와서 연다.
   * 결과: "resumed"(이제 이 탭에서 편집) | "locked"(그새 다른 탭이 다시 잡았다 — 최신 내용 그대로 읽기 전용) | "none"(열린 문서 없음) |
   *       "missing" · "unreadable"(보관 기록 문제) | "canceled" */
  async function resume() {
    const id = lock.docId;
    if (!id || !lock.locked) return "none";
    const outcome = await openDoc(id, { reason: "편집 시작", toast: false });
    if (outcome !== "opened") return outcome;
    return lock.locked ? "locked" : "resumed";
  }

  /** 다른 탭이 편집 중인 악보를 새 문서(사본)로 만들어 이 탭에서 편집한다. 화면의 내용이 아니라 보관된 최신 내용에서 복사한다.
   * 사본에는 문서 ID·클라우드 연결을 붙이지 않는다. 성공하면 true. */
  async function copyForEditing() {
    const id = lock.docId, s = store();
    let source = null;
    if (id && s) {
      try { await s.open(); const doc = s.usable ? await s.loadDoc(id) : null; if (doc?.data) source = C.fromJSON(doc.data); } catch { /* 화면의 내용으로 대신한다 */ }
    }
    if (!source) { try { source = C.fromJSON(C.toJSON(C.state.score)); } catch { return false; } }
    for (const key of IDENTITY_KEYS) delete source.meta[key];
    const base = String(source.meta.title ?? "").trim() || "제목 없음";
    source.meta.title = `${base}${SF.i18n?.lang === "en" ? " (copy)" : " 사본"}`;
    const opened = await replaceScore(source, { reason: "사본으로 편집", origin: "copy", toast: false });
    if (opened && !lock.locked) {
      SF.io?.autosave?.(C.state.score);            // 사본도 곧 최근 작업에 올라가도록 바로 저장을 예약한다
      SF.app.toast?.(COPY_MADE);
    }
    return opened && !lock.locked;
  }

  SF.io?.setAutosaveWriter?.(persist);
  // 파일로 저장(io.saveJSON → markSaved)이 끝나면 어느 경로든 시각을 남긴다.
  C.onChange?.((score, event) => { if (event?.type === "saved") noteFileSaved(); });
  SF.session = {
    replaceScore, openDoc, guard, flushActive,
    activeId, claim, adopt, restoreOnBoot, bootInfo, bootBegin, bootDone, bootFailed, bootOpenPending, bootSkipPending, bootDownloadPending,
    migrateLegacyAutosave, persist, noteFileSaved, savedLabel,
    lockState, onLock, resume, copyForEditing,
  };
})(window.SF);
