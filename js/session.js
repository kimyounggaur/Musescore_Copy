/* js/session.js — 열린 악보의 "교체 통로"와 "악보별 보관".
 * ① 열기·끌어다 놓기·앱 파일 실행·새 악보·데모·클라우드·사본이 모두 replaceScore를 거친다(P2-A).
 *    변경이 있는 악보를 묻지도 않고 갈아 끼우지 않고, 연속 요청은 순서대로 처리한다.
 * ② 악보마다 문서 ID(meta.docId)를 붙여 IndexedDB에 따로 자동 저장한다(P2-B).
 *    기록은 첫 편집 때 만들고, 부팅 때 이 탭이 보던 악보를 되살린다. 옛 localStorage 자동 저장은 한 번 옮기되 원본은 지우지 않는다. */
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
    const id = pickId(score, origin, info.docId);
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

  /** 시작 악보를 고른다: 이 탭의 문서 → 마지막으로 편집한 문서 → 가장 최근 문서 → 없으면 null(데모는 호출한 쪽이 연다).
   * 읽을 수 없는 기록은 건너뛴다. 돌려주는 악보는 이미 이 탭의 현재 문서로 등록돼 있다. */
  async function restoreOnBoot() {
    const s = store();
    try { await s?.open(); } catch { /* 열기 실패는 아래에서 처리 */ }
    if (!s?.usable) {                             // 예전 방식(localStorage 1칸)으로 되돌린다
      try { return SF.io.loadAutosave(); } catch { return null; }
    }
    try {
      await migrateLegacyAutosave();
      const ids = [readTabId(), await s.kvGet("lastDocId").catch(() => null), ...(await s.listDocs()).slice(0, 8).map(doc => doc.id)];
      const tried = new Set();
      for (const id of ids) {
        if (!validId(id) || tried.has(id)) continue;
        tried.add(id);
        const doc = await s.loadDoc(id).catch(() => null);
        if (!doc?.data) continue;
        try {
          const score = C.fromJSON(doc.data);
          claim(score, { origin: doc.origin, docId: doc.id, record: doc });
          return score;
        } catch { /* 깨진 기록은 건너뛴다 */ }
      }
      // 이전하지 못한 예전 자동 저장이 남아 있으면 그대로 보여 준다(원본은 건드리지 않았고, 첫 편집 때 다시 문서로 옮겨 쓴다).
      if (!(await s.kvGet("migrated.v1").catch(() => null))) {
        const legacy = SF.io.loadAutosave?.();
        if (legacy) { claim(legacy, { origin: "legacy", docId: LEGACY_ID }); return legacy; }
      }
    } catch { /* 저장소 오류 — 데모로 시작 */ }
    return null;
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
      if (chosen.readOnly) release(chosen.score); else claim(chosen.score, chosen.info);
      try { SF.app.installScore(chosen.score, opts); } catch (error) { active = before; writeTabId(before.id); throw error; }
      if (kept) SF.app.toast?.(KEPT);
      return true;
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  SF.io?.setAutosaveWriter?.(persist);
  // 파일로 저장(io.saveJSON → markSaved)이 끝나면 어느 경로든 시각을 남긴다.
  C.onChange?.((score, event) => { if (event?.type === "saved") noteFileSaved(); });
  SF.session = {
    replaceScore, guard, flushActive,
    activeId, claim, restoreOnBoot, migrateLegacyAutosave, persist, noteFileSaved, savedLabel,
  };
})(window.SF);
