/* ScoreForge cloud — runtime dependencies: SF.core, SF.auth, SF.app, SF.ui. */
"use strict";
(function (SF) {
  const C = SF.core;
  const TABLE = "scores";
  const COLUMNS = "id,owner,title,measures,is_public,share_slug,created_at,updated_at";
  const SLUG = /^[A-Za-z0-9_-]{12}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const AUTO_KEY = "scoreforge.cloud.auto.v1";
  const QUEUE_KEY = "scoreforge.cloud.queue.v1";
  const META_KEYS = ["cloudId", "cloudUpdatedAt", "cloudOwner", "cloudProject"];
  const state = { initialized: false, autoSave: true, dirty: false, status: "", saving: false };
  const queue = new Map();
  const locale = () => SF.i18n?.getLanguage() === "en" ? "en-US" : "ko-KR";
  const rows = new Map();
  let active = null, timer = null, serial = Promise.resolve(), suppressChange = false;
  let statusEl, copyButton, autoInput, listDialog, listHost, searchInput, shareDialog, shareInput;
  let loadSequence = 0, listSequence = 0;

  function error(code, message) { return Object.assign(new Error(message), { code }); }
  function toast(message) { if (SF.app && SF.app.toast) SF.app.toast(message); }
  function status(message) { state.status = message; if (statusEl) statusEl.textContent = message; }
  function online() { return !window.navigator || window.navigator.onLine !== false; }
  function sessionOwner() { return SF.auth.state.session && SF.auth.state.session.user && SF.auth.state.session.user.id; }
  function client() { return SF.auth.getClient({ requireConfig: false }); }
  function project(db) { return String(db && db.supabaseUrl || "").replace(/\/+$/, ""); }
  function validateId(id) { if (typeof id !== "string" || !UUID.test(id)) throw error("INVALID_ID", "악보 ID가 올바르지 않아요."); return id; }
  function validateSlug(slug) { if (typeof slug !== "string" || slug.length !== 12 || !SLUG.test(slug)) throw error("INVALID_SLUG", "공유 링크가 올바르지 않아요."); return slug; }
  function titleOf(value) { return Array.from(String(value || "").trim()).slice(0, 200).join("") || "제목 없음"; }
  function randomSlug() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, n => alphabet[n & 63]).join(""); // 12 independent 6-bit symbols = 72 bits.
  }
  function randomId() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, n => n.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function snapshot(score) {
    const data = C.toJSON(score);
    data.meta = { ...data.meta };
    for (const key of META_KEYS) delete data.meta[key];
    const json = JSON.stringify(data);
    if (new TextEncoder().encode(json).length >= 2000000) throw error("TOO_LARGE", "악보 데이터는 2MB 미만이어야 해요. 로컬 파일로 저장해 주세요.");
    return data;
  }
  function fingerprint(score) { return JSON.stringify(snapshot(score)); }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  function isReadOnly() { return Boolean(SF.app && SF.app.ui.readOnly); }
  function writable() { if (isReadOnly()) throw error("READ_ONLY", "공유 악보는 사본을 만든 뒤 편집해 주세요."); }
  function enqueue(fn) {
    const next = serial.then(fn, fn);
    serial = next.catch(() => {});
    return next;
  }
  function assertActor(actor) {
    if (client() !== actor.db || sessionOwner() !== actor.session) throw error("SESSION_CHANGED", "계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요.");
  }
  async function requireUser(expectedOwner, expectedProject) {
    const db = client(), session = sessionOwner();
    if (!db) throw error("AUTH_REQUIRED", "클라우드를 사용하려면 먼저 로그인해 주세요.");
    const { data, error: authError } = await db.auth.getUser();
    const actor = { db, session, owner: data && data.user && data.user.id };
    assertActor(actor);
    if (authError) throw authError;
    if (!actor.owner || data.user.is_anonymous) throw error("AUTH_REQUIRED", "회원 로그인이 필요해요.");
    if ((session && session !== actor.owner) || (expectedOwner && expectedOwner !== actor.owner) ||
        (expectedProject !== undefined && expectedProject !== project(db))) {
      throw error("SESSION_CHANGED", "이 저장 요청을 만든 계정으로 로그인해 주세요.");
    }
    return actor;
  }
  async function result(query, actor) {
    const response = await query;
    if (actor) assertActor(actor);
    if (response.error) throw response.error;
    return response.data;
  }
  function storeQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(Array.from(queue.values()))); }
    catch { status("클라우드 대기 중 · 브라우저 저장 공간이 부족해요. 로컬 파일도 저장해 주세요."); }
  }
  function writeMetadata(meta) {
    // This is transport bookkeeping, never a musical edit or an undo entry.
    if (typeof C.setCloudMetadata === "function") C.setCloudMetadata(meta);
    else {
      const target = C.state.score.meta || (C.state.score.meta = {});
      for (const key of META_KEYS) { if (meta[key] == null) delete target[key]; else target[key] = meta[key]; }
    }
    if (SF.io && SF.io.autosave && !isReadOnly()) SF.io.autosave(C.state.score);
  }
  function metadata(row, scope) {
    return { cloudId: row.id, cloudUpdatedAt: row.updated_at, cloudOwner: row.owner, cloudProject: scope };
  }
  function remember(row) { rows.set(row.id, row); return row; }
  function attach(row, job) {
    remember(row);
    const latest = queue.get(job.key);
    if (latest) {
      latest.id = row.id; latest.version = row.updated_at;
      if (latest.revision === job.revision) queue.delete(job.key);
    }
    if (active && active.key === job.key) {
      active.id = row.id; active.version = row.updated_at; active.owner = row.owner; active.project = job.project;
      writeMetadata(metadata(row, job.project));
      const unchanged = fingerprint(C.state.score) === JSON.stringify(job.data);
      state.dirty = !unchanged;
      if (unchanged) status(`클라우드 저장됨 ${new Date(row.updated_at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`);
      else status("변경 사항 저장 대기 중");
    }
    storeQueue();
  }
  function notifyError(err, quiet = false) {
    const code = err && err.code;
    status(code === "CONFLICT" ? "다른 기기에서 수정됨 · 눌러서 해결" : `클라우드 저장 대기 · ${err.message || "연결을 확인해 주세요."}`);
    if (!quiet) {
      if (code === "AUTH_REQUIRED" || code === "SESSION_CHANGED" || code === "session_not_found" || /session missing/i.test(err.message || "")) SF.auth.openDialog("member");
      else toast(err.message || "클라우드 작업을 마치지 못했어요.");
    }
  }
  function uiMethod(name) {
    if (!SF.ui || typeof SF.ui[name] !== "function") throw error("UI_UNAVAILABLE", "앱 다이얼로그를 사용할 수 없어요.");
    return SF.ui[name].bind(SF.ui);
  }
  async function confirm(message, options = {}) {
    return uiMethod("confirmDialog")({ ...options, message, confirmText: options.confirmLabel, cancelText: options.cancelLabel });
  }
  async function prompt(message, initial) {
    return uiMethod("promptDialog")({ message, value: initial, title: "클라우드 악보", maxLength: 200 });
  }

  function makeJob(id, score, owner, scope) {
    const current = score === C.state.score;
    const key = current && active ? active.key : randomId();
    const previous = queue.get(key), meta = score.meta || {};
    if (id) validateId(id);
    if (id && meta.cloudOwner && meta.cloudOwner !== owner) throw error("SESSION_CHANGED", "다른 계정의 악보예요. 사본으로 저장해 주세요.");
    if (id && meta.cloudProject && meta.cloudProject !== scope) throw error("SESSION_CHANGED", "다른 Supabase 프로젝트의 악보예요. 사본으로 저장해 주세요.");
    const version = current && active && active.id === id ? active.version : meta.cloudUpdatedAt;
    return { key, id, insertId: previous && previous.insertId || randomId(), version: version || null,
      owner, project: scope, data: snapshot(score), revision: current && active ? active.revision : 0,
      blocked: false };
  }
  async function send(job, actor, force = false) {
    const fields = { title: titleOf(job.data.meta.title), data: job.data, measures: (job.data.measures || []).length };
    if (!job.id) {
      try {
        return await result(actor.db.from(TABLE).insert({ ...fields, id: job.insertId, owner: actor.owner }).select(COLUMNS).single(), actor);
      } catch (err) {
        // A lost INSERT response may already have committed. Reuse its UUID and
        // acknowledge only the exact payload; this SELECT never precedes UPDATE.
        if (err.code !== "23505") throw err;
        const existing = await result(actor.db.from(TABLE).select(`${COLUMNS},data`).eq("id", job.insertId).eq("owner", actor.owner).maybeSingle(), actor);
        if (existing && JSON.stringify(canonical(existing.data)) === JSON.stringify(canonical(job.data))) return existing;
        throw error("CONFLICT", "저장 결과를 확인할 수 없어요. 사본으로 저장해 주세요.");
      }
    }
    if (!job.version && !force) throw error("CONFLICT", "마지막 저장 시각이 없어 덮어쓸 수 없어요.");
    let query = actor.db.from(TABLE).update(fields).eq("id", job.id).eq("owner", actor.owner);
    if (!force) query = query.eq("updated_at", job.version);
    const row = await result(query.select(COLUMNS).maybeSingle(), actor);
    if (!row) throw error("CONFLICT", "다른 기기에서 수정되었거나 삭제된 악보예요.");
    return row;
  }
  async function resolveConflict(job, actor) {
    const overwrite = await confirm("다른 기기에서 수정되었거나 삭제된 악보예요. 현재 내용으로 덮어쓸까요? 취소하면 다른 이름으로 저장할 수 있어요.",
      { title: "클라우드 저장 충돌", confirmLabel: "덮어쓰기", cancelLabel: "다른 이름으로 저장" });
    assertActor(actor);
    if (active && active.key === job.key) {
      job.data = snapshot(C.state.score); job.revision = active.revision;
    }
    if (overwrite && job.id) return send(job, await requireUser(job.owner, job.project), true);
    const name = await prompt("사본 이름을 입력해 주세요. 취소하면 현재 악보를 그대로 유지해요.", `${titleOf(job.data.meta.title)} 사본`);
    assertActor(actor);
    if (name === null || name === undefined) throw error("CANCELLED", "저장을 취소했어요. 현재 악보는 그대로 있어요.");
    if (active && active.key === job.key) {
      C.mutate("클라우드 사본 이름", score => { score.meta.title = titleOf(name); });
      job.data = snapshot(C.state.score); job.revision = active.revision;
      if (SF.app.update) SF.app.update();
    } else job.data.meta.title = titleOf(name);
    job.id = null; job.version = null; job.insertId = randomId();
    queue.set(job.key, job); storeQueue();
    return send(job, await requireUser(job.owner, job.project));
  }
  async function flushKey(key, interactive) {
    const pending = queue.get(key);
    if (!pending || (!interactive && pending.blocked)) return null;
    if (!online()) { status("오프라인 · 최신 악보 저장 대기 중"); return { queued: true }; }
    const job = JSON.parse(JSON.stringify(pending));
    const actor = await requireUser(job.owner, job.project);
    state.saving = true;
    if (active && active.key === key) status("클라우드에 저장 중…");
    try {
      let row;
      try { row = await send(job, actor); }
      catch (err) {
        if (err.code !== "CONFLICT") throw err;
        if (!interactive) throw err;
        row = await resolveConflict(job, actor);
      }
      assertActor(actor);
      attach(row, job);
      return row;
    } catch (err) {
      const latest = queue.get(key);
      if (latest && (err.code === "CONFLICT" || err.code === "CANCELLED")) latest.blocked = true;
      storeQueue();
      throw err;
    } finally { state.saving = false; }
  }
  async function save(id = null, score = C.state.score, options = {}) {
    writable();
    if (!active) onScoreLoaded(C.state.score);
    const db = client(), owner = sessionOwner();
    // Queuing is local only. Every network write still verifies this identity
    // with getUser(), including a retry after coming back online.
    if (!db || !owner) throw error("AUTH_REQUIRED", "클라우드를 사용하려면 먼저 로그인해 주세요.");
    const job = makeJob(id, score, owner, project(db));
    queue.set(job.key, job); storeQueue();
    if (score === C.state.score) state.dirty = true;
    return enqueue(() => flushKey(job.key, options.interactive !== false));
  }
  async function saveCurrent(options = {}) { return save(active && active.id || C.state.score.meta.cloudId || null, C.state.score, options); }
  async function drain() {
    if (!online()) return;
    const owner = sessionOwner(), scope = project(client());
    if (!owner) return;
    for (const [key, job] of queue) {
      if (job.owner !== owner || job.project !== scope || job.blocked) continue;
      try { await enqueue(() => flushKey(key, false)); }
      catch (err) { notifyError(err, true); }
    }
  }
  function onChange() {
    if (suppressChange || isReadOnly()) return;
    if (!active) onScoreLoaded(C.state.score);
    active.revision++; state.dirty = true;
    clearTimeout(timer);
    if (!state.autoSave || !sessionOwner()) { status("클라우드에 저장하지 않은 변경 사항"); return; }
    try {
      const job = makeJob(active.id, C.state.score, sessionOwner(), project(client()));
      const previous = queue.get(job.key);
      job.blocked = Boolean(previous && previous.blocked);
      queue.set(job.key, job); storeQueue();
      status(online() ? "변경 사항 저장 대기 중" : "오프라인 · 최신 악보 저장 대기 중");
      timer = setTimeout(() => { if (!job.blocked) drain(); }, 10000);
    } catch (err) { notifyError(err, true); }
  }
  function onScoreLoaded(score = C.state.score) {
    clearTimeout(timer);
    const meta = score.meta || {}, scope = project(client());
    const matching = !isReadOnly() && Array.from(queue.values()).find(job => job.owner === sessionOwner() && job.project === scope &&
      (meta.cloudId ? job.id === meta.cloudId : !job.id) && JSON.stringify(job.data) === fingerprint(score));
    active = { key: matching ? matching.key : randomId(), id: meta.cloudId || null, version: matching ? matching.version : meta.cloudUpdatedAt || null,
      owner: meta.cloudOwner || null, project: meta.cloudProject || scope, revision: matching ? matching.revision : 0 };
    state.dirty = Boolean(matching);
    if (copyButton) copyButton.hidden = false;
    const banner = document.querySelector("#cloud-copy-banner");
    if (banner) banner.hidden = !isReadOnly();
    status(isReadOnly() ? "공유 악보 · 읽기 전용" : matching ? "클라우드 저장 대기 중" : "클라우드 저장 준비");
  }
  function setAutoSave(on) {
    state.autoSave = Boolean(on);
    if (autoInput) autoInput.checked = state.autoSave;
    try { localStorage.setItem(AUTO_KEY, String(state.autoSave)); } catch {}
    clearTimeout(timer);
    if (state.autoSave && state.dirty) onChange();
  }

  async function list() {
    const actor = await requireUser();
    const all = [];
    for (let offset = 0; ; offset += 100) {
      const page = await result(actor.db.from(TABLE).select(COLUMNS).eq("owner", actor.owner)
        .order("updated_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 99), actor);
      for (const row of page || []) { remember(row); all.push(row); }
      if (!page || page.length < 100) return all;
    }
  }
  function decode(data, title) {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        (!Array.isArray(data.parts) && !Array.isArray(data.measures))) throw error("INVALID_SCORE", "악보 데이터 형식이 올바르지 않아요.");
    const clean = JSON.parse(JSON.stringify(data));
    clean.meta = { ...clean.meta, title: titleOf(title) };
    for (const key of META_KEYS) delete clean.meta[key];
    snapshot(clean); // Enforce the client-side limit before normalizing.
    return C.fromJSON(clean);
  }
  async function load(id) {
    validateId(id);
    const actor = await requireUser();
    const row = await result(actor.db.from(TABLE).select(`${COLUMNS},data`).eq("id", id).eq("owner", actor.owner).maybeSingle(), actor);
    if (!row) throw error("NOT_FOUND", "악보가 없거나 열 권한이 없어요.");
    const score = decode(row.data, row.title);
    Object.assign(score.meta, metadata(row, project(actor.db)));
    remember(row);
    return score;
  }
  async function loadShared(slug) {
    validateSlug(slug);
    const db = client();
    if (!db) throw error("CONFIG_REQUIRED", "공유 악보를 열려면 Supabase 연결 설정이 필요해요.");
    const data = await result(db.rpc("get_shared_score", { slug }));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw error("NOT_FOUND", "공유가 중지되었거나 삭제된 악보예요.");
    return decode(row.data, row.title);
  }
  async function installScore(score, readOnly) {
    if (!SF.app.setReadOnly || !SF.app.handleLoadedScore) throw error("INTEGRATION_REQUIRED", "악보 열기 연결이 준비되지 않았어요.");
    suppressChange = true;
    try {
      SF.app.setReadOnly(readOnly);
      SF.app.handleLoadedScore(score, score.meta.title, null, []);
      SF.app.setReadOnly(readOnly);
      onScoreLoaded(C.state.score);
    } finally { suppressChange = false; }
  }
  async function openScore(id, shared = false) {
    const sequence = ++loadSequence, before = fingerprint(C.state.score);
    const score = shared ? await loadShared(id) : await load(id);
    if (sequence !== loadSequence) return null;
    if (!isReadOnly() && (state.dirty || fingerprint(C.state.score) !== before)) {
      if (!await confirm("현재 악보의 변경 사항을 남겨 두려면 먼저 저장해 주세요. 선택한 악보를 열까요?", { title: "악보 열기", confirmLabel: "열기" })) return null;
    }
    if (sequence !== loadSequence) return null;
    if (!shared) await requireUser(score.meta.cloudOwner, score.meta.cloudProject);
    if (sequence !== loadSequence) return null;
    await installScore(score, shared);
    if (!shared) clearShareURL();
    return score;
  }
  function clearShareURL() {
    try { const url = new URL(window.location.href); url.searchParams.delete("share"); window.history.replaceState(null, "", url.href); } catch {}
  }
  async function makeLocalCopy() {
    const score = decode(snapshot(C.state.score), `${titleOf(C.state.score.meta.title)} 사본`);
    await installScore(score, false);
    clearShareURL();
    if (SF.io && SF.io.autosave) SF.io.autosave(C.state.score);
    toast("로컬 사본을 만들었어요. 이제 편집할 수 있어요.");
    return score;
  }
  function versionFor(id, supplied) {
    return supplied || (active && active.id === id ? active.version : rows.get(id) && rows.get(id).updated_at);
  }
  async function changeRow(id, values, expectedVersion) {
    validateId(id);
    const actor = await requireUser();
    const version = versionFor(id, expectedVersion);
    if (!version) throw error("CONFLICT", "악보 목록을 새로 불러온 뒤 다시 시도해 주세요.");
    const row = await result(actor.db.from(TABLE).update(values).eq("id", id).eq("owner", actor.owner)
      .eq("updated_at", version).select(COLUMNS).maybeSingle(), actor);
    if (!row) throw error("CONFLICT", "다른 기기에서 수정되었어요. 목록을 새로 불러와 주세요.");
    remember(row);
    if (active && active.id === id && active.version === version && (!active.owner || active.owner === actor.owner)) {
      active.version = row.updated_at;
      writeMetadata(metadata(row, project(actor.db)));
      const pending = queue.get(active.key);
      if (pending) { pending.version = row.updated_at; storeQueue(); }
    }
    return row;
  }
  function rename(id, title, expectedVersion) {
    return enqueue(async () => {
      const name = titleOf(title);
      const row = await changeRow(id, { title: name }, expectedVersion);
      if (active && active.id === id && !isReadOnly()) {
        C.mutate("클라우드 악보 이름", score => { score.meta.title = name; });
        if (SF.app.update) SF.app.update();
      }
      return row;
    });
  }
  function shareURL(slug) {
    validateSlug(slug);
    const url = new URL(window.location.href);
    // Auth callbacks and unrelated query parameters must never travel in a share link.
    url.search = ""; url.hash = ""; url.searchParams.set("share", slug);
    return url.href;
  }
  function setPublic(id, on, expectedVersion) {
    return enqueue(async () => {
      // Each enable rotates the capability; disabling removes it immediately.
      const slug = on ? randomSlug() : null;
      await changeRow(id, { is_public: Boolean(on), share_slug: slug }, expectedVersion);
      return on ? shareURL(slug) : null;
    });
  }
  function remove(id, expectedVersion) {
    return enqueue(async () => {
      validateId(id);
      const actor = await requireUser();
      const version = versionFor(id, expectedVersion);
      if (!version) throw error("CONFLICT", "악보 목록을 새로 불러온 뒤 다시 시도해 주세요.");
      const row = await result(actor.db.from(TABLE).delete().eq("id", id).eq("owner", actor.owner)
        .eq("updated_at", version).select("id").maybeSingle(), actor);
      if (!row) throw error("CONFLICT", "다른 기기에서 수정되었거나 이미 삭제된 악보예요.");
      rows.delete(id);
      for (const [key, job] of queue) if (job.id === id && job.owner === actor.owner && job.project === project(actor.db)) queue.delete(key);
      if (active && active.id === id) { active.id = null; active.version = null; writeMetadata({}); status("클라우드에서 삭제됨 · 로컬 악보는 유지했어요"); }
      storeQueue(); return true;
    });
  }
  async function countByOwner(ownerIds) {
    const ids = Array.from(new Set(ownerIds || [])).map(validateId);
    if (ids.length > 100) throw error("TOO_MANY", "한 번에 회원 100명까지 조회할 수 있어요.");
    const actor = await requireUser();
    const data = await result(actor.db.rpc("count_scoreforge_scores_by_owner", { owner_ids: ids }), actor);
    const counts = Object.fromEntries(ids.map(id => [id, 0]));
    for (const row of data || []) if (ids.includes(row.owner)) counts[row.owner] = Number(row.score_count);
    return counts;
  }

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(text, action, className = "tbtn") {
    const el = element("button", text, className); el.type = "button";
    el.addEventListener("click", () => runUI(action, el)); return el;
  }
  async function runUI(action, el) {
    if (el) el.disabled = true;
    try { return await action(); }
    catch (err) { notifyError(err); return null; }
    finally { if (el) el.disabled = false; }
  }
  function dialog(id, title) {
    const dlg = element("dialog"); dlg.id = id; dlg.setAttribute("aria-label", title);
    dlg.style.width = "min(720px, calc(100vw - 32px))";
    const header = element("div", undefined, "dlg-head");
    header.append(element("h2", title), button("닫기", () => dlg.close()));
    dlg.append(header); document.body.append(dlg); return dlg;
  }
  function showLink(url) {
    if (!shareDialog) {
      shareDialog = dialog("dlg-cloud-share", "공유 링크");
      shareDialog.append(element("p", "링크를 가진 사람은 로그인 없이 악보를 볼 수 있어요. 공유를 끄면 링크가 중지돼요."));
      shareInput = element("input"); shareInput.type = "url"; shareInput.readOnly = true;
      shareInput.setAttribute("aria-label", "공유 링크"); shareInput.style.width = "100%";
      shareDialog.append(shareInput, button("링크 복사", async () => {
        try { await window.navigator.clipboard.writeText(shareInput.value); toast("공유 링크를 복사했어요."); }
        catch { shareInput.focus(); shareInput.select(); toast("링크를 선택했어요. 복사해 주세요."); }
      }));
    }
    shareInput.value = url;
    if (!shareDialog.open) shareDialog.showModal();
    shareInput.focus(); shareInput.select();
  }
  async function shareCurrent() {
    const row = await saveCurrent();
    if (!row || row.queued) { toast("온라인에서 저장을 마친 뒤 공유할 수 있어요."); return; }
    if (!await confirm("링크를 가진 누구나 이 악보를 볼 수 있도록 공유할까요?", { title: "공유 링크 만들기", confirmLabel: "공유" })) return;
    showLink(await setPublic(row.id, true, row.updated_at));
  }
  async function refreshList() {
    const sequence = ++listSequence;
    listHost.textContent = "악보를 불러오는 중…";
    const data = await list();
    if (sequence !== listSequence) return;
    function render() {
      listHost.replaceChildren();
      const term = searchInput.value.trim().toLocaleLowerCase();
      const filtered = data.filter(row => row.title.toLocaleLowerCase().includes(term));
      if (!filtered.length) { listHost.append(element("p", "표시할 악보가 없어요.")); return; }
      for (const row of filtered) {
        const item = element("article", undefined, "cloud-score-row");
        item.style.borderBottom = "1px solid var(--border, #8885)"; item.style.padding = "12px 0";
        item.append(element("strong", row.title), element("p", `${row.measures}마디 · ${new Date(row.updated_at).toLocaleString(locale())} · ${row.is_public ? "공유 중" : "비공개"}`));
        const controls = element("div"); controls.style.display = "flex"; controls.style.flexWrap = "wrap"; controls.style.gap = "8px";
        controls.append(button("열기", async () => { if (await openScore(row.id)) listDialog.close(); }),
          button("이름 바꾸기", async () => { const name = await prompt("악보 이름을 입력해 주세요.", row.title); if (name == null) return; await rename(row.id, name, row.updated_at); await refreshList(); }),
          button(row.is_public ? "공유 끄기" : "공유 켜기", async () => {
            if (!await confirm(row.is_public ? "기존 공유 링크를 중지할까요?" : "링크를 가진 누구나 악보를 볼 수 있도록 공유할까요?", { title: "악보 공유" })) return;
            const url = await setPublic(row.id, !row.is_public, row.updated_at); await refreshList(); if (url) showLink(url);
          }), button("삭제", async () => {
            if (!await confirm(`“${row.title}” 악보를 클라우드에서 삭제할까요?`, { title: "악보 삭제", confirmLabel: "삭제" })) return;
            await remove(row.id, row.updated_at); await refreshList();
          }));
        if (row.is_public && SLUG.test(row.share_slug)) controls.append(button("공유 링크", () => showLink(shareURL(row.share_slug))));
        item.append(controls); listHost.append(item);
      }
    }
    searchInput.oninput = render;
    render();
  }
  async function openList() {
    await requireUser();
    if (!listDialog) {
      listDialog = dialog("dlg-cloud-scores", "내 악보");
      searchInput = element("input"); searchInput.type = "search"; searchInput.placeholder = "악보 제목 검색";
      searchInput.setAttribute("aria-label", "악보 제목 검색");
      listHost = element("div"); listHost.setAttribute("aria-live", "polite");
      listDialog.append(searchInput, button("새로고침", refreshList), listHost);
    }
    if (!listDialog.open) listDialog.showModal();
    await refreshList(); searchInput.focus();
  }
  function onAuthChanged() {
    clearTimeout(timer);
    // Called after auth state has been updated; never call Supabase from inside
    // an onAuthStateChange callback (the SDK may still hold its auth lock).
    setTimeout(() => drain(), 0);
  }
  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    window.addEventListener("scoreforge:language", () => { if (listDialog?.open) searchInput?.oninput?.(); });
    try {
      state.autoSave = localStorage.getItem(AUTO_KEY) !== "false";
      const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      if (Array.isArray(saved)) for (const job of saved) {
        if (!job || !UUID.test(job.key) || !UUID.test(job.owner) || !UUID.test(job.insertId) || (job.id && !UUID.test(job.id)) ||
          typeof job.project !== "string" || !Number.isSafeInteger(job.revision) || !job.data) continue;
        job.data = snapshot(job.data); queue.set(job.key, job);
      }
    } catch { status("저장 대기 목록을 읽지 못했어요. 로컬 악보를 확인해 주세요."); }
    const menu = document.querySelector("#file-menu .menu-panel") || document.querySelector("#file-menu") || document.querySelector(".menu-panel");
    if (menu) {
      const group = element("div"); group.id = "cloud-menu";
      group.append(element("hr"));
      for (const [label, action, fn] of [
        ["클라우드에 저장 (Ctrl+Shift+S)", "cloud-save", saveCurrent],
        ["내 악보…", "cloud-list", openList],
        ["공유 링크 만들기", "cloud-share", shareCurrent]
      ]) {
        const btn = button(label, () => { menu.classList.remove("open"); return fn(); }, "mi");
        btn.dataset.action = action; btn.style.width = "100%"; btn.style.textAlign = "left";
        group.append(btn);
      }
      const label = element("label", "자동 클라우드 저장 ", "mi");
      autoInput = element("input"); autoInput.type = "checkbox"; autoInput.checked = state.autoSave;
      autoInput.addEventListener("change", () => setAutoSave(autoInput.checked)); label.append(autoInput); group.append(label);
      copyButton = button("사본 만들기", makeLocalCopy, "mi"); copyButton.dataset.action = "cloud-copy"; group.append(copyButton);
      menu.append(group);
    }
    statusEl = button("클라우드 저장 준비", () => state.dirty ? saveCurrent() : openList());
    statusEl.id = "status-cloud"; statusEl.setAttribute("aria-live", "polite");
    const footer = document.querySelector(".statusbar"); if (footer) footer.append(statusEl);
    const copy = button("공유 악보 · 사본 만들기", makeLocalCopy); copy.id = "cloud-copy-banner";
    copy.hidden = true; if (footer) footer.append(copy);
    // Visibility is also refreshed by setReadOnly()/onScoreLoaded integration.
    C.onChange((score, detail) => {
      if (suppressChange) return;
      if (detail && detail.type === "setScore") { onScoreLoaded(score); return; }
      if (detail && !["change", "mutate", "undo", "redo"].includes(detail.type)) return;
      if (active && active.id && !isReadOnly()) writeMetadata({ cloudId: active.id, cloudUpdatedAt: active.version,
        cloudOwner: active.owner, cloudProject: active.project });
      onChange(); copy.hidden = !isReadOnly();
    });
    window.addEventListener("online", () => drain());
    window.addEventListener("offline", () => { if (state.dirty) status("오프라인 · 최신 악보 저장 대기 중"); });
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopImmediatePropagation(); runUI(saveCurrent);
      }
    }, true);
    onScoreLoaded(C.state.score);
    const slug = new URL(window.location.href).searchParams.get("share");
    if (slug !== null) await runUI(async () => { await openScore(slug, true); copy.hidden = !isReadOnly(); });
    await drain();
  }
  SF.cloud = { state, init, list, save, saveCurrent, load, remove, rename, setPublic, loadShared,
    open: id => openScore(id), openShared: slug => openScore(slug, true), openList, shareCurrent,
    makeLocalCopy, setAutoSave, onScoreLoaded, onAuthChanged, drain, countByOwner };
})(window.SF);
