"use strict";
(function(SF) {
  let lastReported = 0;
  const errors = [];
  function report(error) {
    errors.push({ at: Date.now(), message: String(error?.message || error) });
    if (errors.length > 30) errors.shift();
    console.error("ScoreForge:", error);
    if (Date.now() - lastReported < 2000) return;
    lastReported = Date.now();
    try {
      SF.app?.toast("문제가 생겼어요. 마지막 자동 저장본을 확인해 주세요.");
    } catch { /* Error reporting must not cause another application error. */ }
  }
  window.addEventListener("error", event => { if (event.error) report(event.error); });
  window.addEventListener("unhandledrejection", event => report(event.reason));
  SF.errors = { recent: () => errors.slice() };
})(window.SF);
