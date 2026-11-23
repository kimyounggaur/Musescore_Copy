/* js/lock-ui.js — 다른 탭이 편집 중인 악보 안내 띠(P2-D).
 * session.js의 잠금 상태(SF.session.onLock)를 보고 #lock-banner를 보여 준다.
 *   편집 중(locked)  : "다른 탭에서 편집 중인 악보예요" + [사본으로 편집]
 *   풀림(available)  : "이제 편집할 수 있어요" + [편집 시작] [사본으로 편집]
 * [편집 시작]은 보관된 최신 내용을 다시 읽어 와서 연다(오래된 화면으로 편집하지 않는다). 글은 모두 textContent로만 넣는다. */
"use strict";
(function (SF) {
  const tr = text => SF.i18n?.translate?.(text) ?? text;
  const toast = (...args) => SF.app?.toast?.(...args);
  const $ = id => document.getElementById(id);

  const TEXT = {
    locked: "다른 탭에서 편집 중인 악보예요",
    available: "이제 편집할 수 있어요",
    stillLocked: "아직 다른 탭에서 편집 중이에요",
    resumeFailed: "최신 내용을 불러오지 못했어요. 사본으로 편집해 보세요",
    copyFailed: "사본을 만들지 못했어요",
    resumed: "이 탭에서 편집을 시작했어요",
  };

  let busy = false;      // [편집 시작]·[사본으로 편집]이 처리되는 동안 중복 클릭을 막는다
  let notice = "";       // 직전 시도의 결과 안내(예: 아직 다른 탭에서 편집 중이에요)
  let shown = { docId: "", available: false };

  function render() {
    const banner = $("lock-banner");
    if (!banner) return;
    const state = SF.session?.lockState?.() || { locked: false };
    const locked = Boolean(state.locked);
    banner.hidden = !locked;
    document.body.classList.toggle("tab-locked", locked);
    if (!locked) { notice = ""; return; }
    const available = Boolean(state.available);
    banner.dataset.state = available ? "available" : "locked";
    $("lock-text").textContent = tr(notice || (available ? TEXT.available : TEXT.locked));
    $("lock-resume").hidden = !available;
    $("lock-resume").disabled = busy;
    $("lock-copy").disabled = busy;
  }

  async function resume() {
    if (busy) return;
    busy = true; render();
    let outcome = "error";
    try { outcome = await SF.session.resume(); } catch { /* 아래에서 안내 */ }
    busy = false;
    notice = outcome === "locked" ? TEXT.stillLocked : outcome === "resumed" || outcome === "canceled" ? "" : TEXT.resumeFailed;
    if (outcome === "resumed") toast(tr(TEXT.resumed));
    render();
  }

  async function copy() {
    if (busy) return;
    busy = true; render();
    let made = false;
    try { made = await SF.session.copyForEditing(); } catch { /* 아래에서 안내 */ }
    busy = false;
    notice = made ? "" : TEXT.copyFailed;
    render();
  }

  function init() {
    $("lock-resume")?.addEventListener("click", resume);
    $("lock-copy")?.addEventListener("click", copy);
    SF.session?.onLock?.(state => {
      // 문서가 바뀌었거나 풀림 여부가 달라지면 이전 시도의 안내는 낡은 것이다.
      if (state.docId !== shown.docId || Boolean(state.available) !== shown.available) notice = "";
      shown = { docId: state.docId, available: Boolean(state.available) };
      render();
    });
    window.addEventListener("scoreforge:language", render);
    render();
  }

  SF.lockUI = { init, render, resume, copy };
  init();
})(window.SF = window.SF || {});
