/* js/safe-html.js — innerHTML에 들어가는 모든 동적 값은 여기를 거친다. */
"use strict";
(function (SF) {
  const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => MAP[c]);
  /** 숫자 속성값: 유한수면 범위 안으로 반올림, 아니면 fallback(기본 빈 문자열) */
  function num(value, { min = -Infinity, max = Infinity, fallback = "" } = {}) {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.min(max, Math.max(min, Math.round(n)))) : fallback;
  }
  SF.html = { esc, num };
})(window.SF = window.SF || {});
