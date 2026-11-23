/* js/recent.js — 파일 ▸ 🕘 최근 작업 창(P2-C).
 * 이 브라우저에 자동 보관된 악보(IndexedDB, 악보마다 한 기록)를 목록으로 보여 주고,
 * 다시 열기 · 파일로 내려받기 · 지우기를 한다.
 * 제목은 사용자가 쓴 글이라 모든 글자를 textContent로만 넣는다(HTML 문자열로 넣는 방법은 쓰지 않는다).
 * 현재 악보는 지울 수 없고, 다시 열기는 SF.session.openDoc → replaceScore(보관 규칙)을 거친다. */
"use strict";
(function (SF) {
  const tr = text => SF.i18n?.translate?.(text) ?? text;
  const toast = (...args) => SF.app?.toast?.(...args);
  const $ = selector => document.querySelector(selector);

  let token = 0;            // 늦게 끝난 그리기가 더 새로운 그리기를 덮어쓰지 않게 한다
  let quotaAsked = false;   // 공간 부족으로 창을 자동으로 여는 건 탭마다 한 번

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "";
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(1)} GB`;
  }

  /** 수정 시각 — 언어 설정에 맞는 날짜 형식. 올해가 아니면 연도도 붙인다. */
  function formatTime(at) {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    const locale = SF.i18n?.lang === "en" ? "en-US" : "ko-KR";
    const options = { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
    try { return new Intl.DateTimeFormat(locale, options).format(date); } catch { return date.toLocaleString(); }
  }

  /** 다른 탭이 편집 중인 문서 ID 모음(SF.lock). 잠금 목록을 못 읽는 브라우저는 보이는 문서마다 다른 탭에 물어본다. 없으면 빈 집합. */
  async function lockedElsewhere(ids) {
    try { return new Set((await SF.lock?.heldElsewhere?.(ids)) || []); } catch { return new Set(); }
  }

  function button(label, className, onClick, doc, extra = {}) {
    const node = el("button", `tbtn rc-btn ${className}`, tr(label));
    node.type = "button";
    node.setAttribute("aria-label", `${tr(label)} — ${doc.title || tr("제목 없음")}`);
    if (extra.disabled) { node.disabled = true; if (extra.why) node.title = tr(extra.why); }
    else node.addEventListener("click", onClick);
    return node;
  }

  function row(doc, current, elsewhere) {
    const isCurrent = doc.id === current;
    const quarantined = Boolean(doc.quarantined);            // 열 때 문제가 있어 자동으로 열지 않기로 한 기록(P2-E)
    const item = el("li", quarantined ? "rc-row rc-quarantined" : "rc-row");
    item.dataset.id = doc.id;
    if (isCurrent) item.setAttribute("aria-current", "true");

    const main = el("div", "rc-main");
    const title = el("span", "rc-title", doc.title || tr("제목 없음"));
    title.dataset.userContent = "";            // 번역·가공 대상이 아닌 사용자 글
    if (doc.title) title.title = doc.title;    // 줄임표로 잘린 긴 제목은 마우스를 올리면 전체가 보인다
    main.append(title);
    if (isCurrent) main.append(el("span", "rc-badge", tr("지금 열려 있어요")));
    if (elsewhere.has(doc.id)) main.append(el("span", "rc-badge rc-lock", tr("다른 탭에서 편집 중")));
    if (quarantined) main.append(el("span", "rc-badge rc-problem", tr("열 때 문제가 있었어요")));
    const meta = el("div", "rc-meta");
    meta.append(el("span", "rc-measures", tr(`${doc.measures || 0}마디`)), el("span", "rc-sep", " · "), el("span", "rc-time", formatTime(doc.updatedAt)));
    main.append(meta);
    if (quarantined) main.append(el("div", "rc-why", tr("원본은 그대로 보관돼 있어요. 파일로 내려받아 확인해 보세요.")));

    const actions = el("div", "rc-actions");
    const openButton = button("열기", "rc-open", () => openFromList(doc.id), doc, { disabled: isCurrent, why: "지금 열려 있는 악보예요" });
    const downloadButton = button("파일로 내려받기", quarantined ? "rc-download primary" : "rc-download", () => download(doc), doc);
    const deleteButton = button("삭제", "rc-delete danger", () => remove(doc), doc,
      { disabled: isCurrent || elsewhere.has(doc.id), why: isCurrent ? "지금 열려 있는 악보는 지울 수 없어요" : "다른 탭에서 편집 중이라 지울 수 없어요" });
    actions.append(...(quarantined ? [downloadButton, openButton, deleteButton] : [openButton, downloadButton, deleteButton]));   // 격리된 기록은 내려받기가 먼저
    item.append(main, actions);
    return item;
  }

  async function showUsage() {
    const out = $("#rc-usage");
    out.hidden = true;
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (!estimate || !Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota) || !estimate.quota) return;
      out.textContent = tr(`사용 중 ${formatBytes(estimate.usage)} / 약 ${formatBytes(estimate.quota)}`);
      out.hidden = false;
    } catch { /* 지원하지 않는 브라우저 */ }
  }

  async function render() {
    const mine = ++token;
    const list = $("#rc-list");
    list.setAttribute("aria-busy", "true");
    const store = SF.store;
    let docs = [], usable = false;
    try { await store?.open(); usable = Boolean(store?.usable); if (usable) docs = await store.listDocs(); } catch { usable = false; }
    const elsewhere = usable ? await lockedElsewhere(docs.map(doc => doc.id)) : new Set();
    if (mine !== token) return;
    const current = SF.session?.activeId?.() || "";
    docs.sort((a, b) => Number(Boolean(b.quarantined)) - Number(Boolean(a.quarantined)));   // 격리된 기록을 위로(그 안의 순서는 최근순 그대로)
    list.replaceChildren(...docs.map(doc => row(doc, current, elsewhere)));
    list.removeAttribute("aria-busy");
    $("#rc-unavailable").hidden = usable;
    $("#rc-empty").hidden = !usable || docs.length > 0;
    list.hidden = !usable || docs.length === 0;
    showUsage();
  }

  /* 창이 열려 있는 동안 다른 탭의 변화(저장·편집 시작·편집 끝)를 따라간다. */
  let stopLive = null, liveTimer = 0;
  function refreshSoon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      if (!$("#dlg-recent")?.open) return;
      // 새로 그려도 키보드 초점이 사라지지 않게, 초점이 있던 행의 같은 버튼으로 돌려놓는다.
      const active = document.activeElement, row = active?.closest?.("#rc-list .rc-row");
      const where = row ? { id: row.dataset.id, kind: [...active.classList].find(name => /^rc-(open|download|delete)$/.test(name)) } : null;
      await render();
      if (where?.kind) {
        const target = [...document.querySelectorAll(`#rc-list .rc-row .${where.kind}`)].find(node => node.closest(".rc-row")?.dataset.id === where.id);
        if (target && !target.disabled) target.focus();
      }
    }, 250);
  }
  function watchChanges(dialog) {
    stopLive?.();
    const offs = [SF.lock?.onMessage?.("docs-changed", refreshSoon), SF.lock?.onMessage?.("doc-closed", refreshSoon), SF.session?.onLock?.(refreshSoon)].filter(Boolean);
    stopLive = () => { for (const off of offs) off(); clearTimeout(liveTimer); stopLive = null; };
    dialog.addEventListener("close", () => stopLive?.(), { once: true });
  }

  async function open(options = {}) {
    const dialog = $("#dlg-recent");
    if (!dialog) return;
    $("#rc-warn").hidden = !options.quota;
    if (!dialog.open) SF.ui.open(dialog);
    watchChanges(dialog);
    await render();
  }

  /** 자동 저장이 공간 부족으로 실패했을 때: 탭마다 처음 한 번 창을 열어 정리할 수 있게 한다. 연 경우 true. */
  function onQuota() {
    if (quotaAsked || !$("#dlg-recent")) return false;
    quotaAsked = true;
    open({ quota: true });
    return true;
  }

  /* ---------------- 행 동작 ---------------- */
  async function openFromList(id) {
    const dialog = $("#dlg-recent");
    dialog.close();                                  // 토스트·저장 확인 창이 가려지지 않게 먼저 닫는다
    const outcome = await SF.session.openDoc(id, { reason: "최근 작업 열기" });
    if (outcome === "opened") return;
    if (outcome === "missing") toast("이 기록을 찾지 못했어요 — 이미 지워졌을 수 있어요");
    else if (outcome === "unreadable") toast("이 기록을 열 수 없어요 — 파일로 내려받아 확인해 보세요");
    open();                                          // 취소·실패면 목록으로 돌아간다
  }

  async function download(doc) {
    // 지금 열려 있는 악보는 화면의 내용 그대로(= 일반 저장), 나머지는 보관된 기록을 그대로 내려받는다. 어느 쪽도 현재 악보를 바꾸지 않는다.
    if (doc.id === (SF.session?.activeId?.() || "")) { SF.io.saveJSON(SF.core.state.score); toast("악보 파일을 내려받았어요"); return; }
    let record = null;
    try { record = await SF.store.loadDoc(doc.id); } catch { /* 아래에서 처리 */ }
    if (!record?.data) { toast("이 기록을 찾지 못했어요 — 이미 지워졌을 수 있어요"); render(); return; }
    SF.io.download(`${SF.io.safeName(record.title)}.scoreforge.json`, SF.io.jsonFileText(record.data), "application/json");
    toast("악보 파일을 내려받았어요");
  }

  async function remove(doc) {
    const sure = await SF.ui.confirmDialog({
      title: "이 악보 기록을 지울까요?",
      message: `‘${doc.title || tr("제목 없음")}’ 기록을 이 브라우저에서 지워요. 파일로 저장해 둔 적이 없다면 되돌릴 수 없어요.`,
      confirmText: "삭제", danger: true,
    });
    if (!sure) return;
    if (doc.id === (SF.session?.activeId?.() || "")) return;    // 묻는 사이 이 악보로 바뀌었다면 지우지 않는다
    try { await SF.store.deleteDoc(doc.id); SF.lock?.notify?.("docs-changed", { docId: doc.id }); } catch { toast("기록을 지우지 못했어요"); }
    await render();
    ($("#rc-list button:not([disabled])") || $("#dlg-recent .dlg-close"))?.focus();
  }

  SF.recent = { open, onQuota, render, formatBytes };
})(window.SF);
