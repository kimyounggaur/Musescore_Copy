/* ScoreForge 보기 수준(P9-1): "기본" 보기는 자주 쓰는 조작만, "고급" 보기는 전부 보여 준다.
 *
 * 화면의 조작 요소를 기본·고급·드묾으로 나눈 표(TIERS)가 이 파일에 한 곳으로 모여 있다. init()·tag()가 표대로 요소에
 * data-tier="advanced|rare"를 붙이고, css/style.css의 규칙 한 줄이 기본 보기(<html data-view="basic">)에서 그것들을 뺀다.
 *  - 표에 없는 요소는 "기본"이다(새로 만든 조작이 먼저 보이도록 한 안전한 기본값). 그래서 표에는 advanced·rare만 적는다.
 *  - 선택자는 id·data-* 걸이에만 기댄다. title·aria-label 글자는 영어 번역 때문에 바뀌므로 쓰지 않는다.
 *  - 한 항목에는 선택자 하나(쉼표로 묶지 않는다). docs/UI_INVENTORY.md는 이 표를 화면에서 읽어 만든다
 *    (node tests/tools/gen-ui-inventory.mjs).
 *  - 기본값은 "고급"이다: 지금 쓰는 사람의 화면은 그대로이고, 새로 오는 사람에게 기본 보기를 먼저 보여 줄지는 DEFAULT 한 줄이다(🧑 결정).
 *  - 보기를 바꿔도 기능이 없어지지는 않는다: 숨긴 버튼은 명령 팔레트(Ctrl+Shift+P)에서 누를 수 있고 단축키는 그대로 동작한다.
 * 이 파일은 악보 데이터를 읽거나 바꾸지 않고, 다른 모듈이 없어도(테스트 환경) 던지지 않는다. */
"use strict";
(function (SF) {
  const KEY = "sf.viewLevel";
  const LEVELS = Object.freeze(["basic", "advanced"]);
  const DEFAULT = "advanced";
  const EVENT = "sf:view-level";
  const TITLE_ON = "기본 보기 — 자주 쓰는 조작만 보여 줘요(켜짐)";
  const TITLE_OFF = "기본 보기 — 자주 쓰는 조작만 보여 줘요(꺼짐)";
  const HIDDEN = '[data-tier="advanced"],[data-tier="rare"]';

  // [선택자, 분류, 이유]. 이유는 docs/UI_INVENTORY.md 분류표에 그대로 실린다.
  const ROWS = [
    // 위쪽 줄
    [".theme-control", "advanced", "화면 색 테마는 한 번 고르면 거의 바꾸지 않는다"],
    ["#btn-loop", "advanced", "선택 범위 반복은 Ctrl+L로도 켠다"],
    ["#swing-select", "advanced", "스윙 재생은 재즈·팝 곡에서만 쓴다"],
    ["#btn-mixer", "advanced", "파트별 음량·좌우는 여러 보표 악보에서만 쓴다"],
    ["#view-select", "advanced", "총보/파트 보기는 여러 파트 악보에서만 쓴다"],
    ["#page-mode", "advanced", "연속/페이지 보기는 인쇄 전에만 바꾼다"],
    [".multi-rest", "advanced", "여러 마디 쉼표 묶기는 조판 세부 설정이다"],
    ["#btn-hide-empty", "advanced", "빈 보표 숨기기는 여러 파트 총보에서만 쓴다"],
    ["#btn-navigator", "advanced", "긴 악보에서 이동할 때만 쓴다(Alt+Shift+N)"],
    ["#btn-timeline", "advanced", "긴 악보에서 이동할 때만 쓴다(Alt+Shift+T)"],
    ["#btn-midi", "advanced", "MIDI 건반이 있을 때만 쓴다"],
    ["#midi-select", "advanced", "MIDI 장치 선택은 MIDI 입력을 켠 사람만 쓴다"],
    ["#btn-shortcuts", "rare", "도움말 단추가 같은 단축키 안내를 연다"],
    ["#btn-admin-page", "rare", "관리자에게만 보이는 단추"],
    ["#btn-delete-account", "rare", "회원 탈퇴는 거의 쓰지 않고 실수로 누르면 안 된다"],
    // 파일 메뉴
    ['#file-menu [data-act="save-legacy"]', "advanced", "옛 버전 앱에서 열 파일이 필요한 사람만 쓴다"],
    // 입력 팔레트
    ["#btn-speedy", "advanced", "스피디 입력은 숙련자용 빠른 입력이다(Q 키로도 켠다)"],
    ["#voice-buttons", "advanced", "성부 2~4는 여러 성부 악보에서만 쓴다(Alt+1~4)"],
    ['#dur-buttons [data-i="0"]', "rare", "겹온음표는 거의 쓰지 않는다(8 키)"],
    ['#dur-buttons [data-i="6"]', "advanced", "32분음표(2 키)"],
    ['#dur-buttons [data-i="7"]', "rare", "64분음표는 거의 쓰지 않는다(1 키)"],
    ["#btn-grace", "advanced", "꾸밈음은 고급 표기다(/ 키)"],
    ["#btn-gliss", "advanced", "글리산도는 고급 표기다"],
    ["#btn-arpeggio", "advanced", "아르페지오는 고급 표기다"],
    ["#btn-tremolo", "advanced", "트레몰로는 고급 표기다"],
    ["#btn-trill", "advanced", "트릴은 고급 표기다"],
    ["#btn-mordent", "advanced", "모르덴트는 고급 표기다"],
    ["#btn-turn", "advanced", "턴은 고급 표기다"],
    ["#btn-ottava-up", "advanced", "옥타브 선은 범위를 고른 뒤 쓰는 고급 표기다"],
    ["#btn-ottava-down", "advanced", "옥타브 선은 범위를 고른 뒤 쓰는 고급 표기다"],
    ['[data-artic="marcato"]', "advanced", "마르카토는 스타카토·악센트보다 드물다"],
    ["#btn-rehearsal", "advanced", "연습 기호는 긴 악보에서만 쓴다(R 키)"],
    ["#btn-staff-text", "advanced", "보표 문구는 지시어가 필요할 때만 쓴다(Shift+L)"],
    ["#btn-repeat-count", "advanced", "반복 횟수 표시는 반복 세부 설정이다"],
    ["#btn-break-system", "advanced", "줄 바꿈은 자동 배치를 고칠 때만 쓴다"],
    ["#btn-break-page", "advanced", "쪽 나눔은 인쇄 배치를 고칠 때만 쓴다"],
    ["#btn-break-section", "rare", "구역 나눔은 거의 쓰지 않는다"],
    ["#btn-measure-options", "advanced", "마디 설정 대화상자는 세부 설정이다"],
    // 속성 패널 — 음표·마디 공통(panels.js)
    ["#prop-offsetX", "advanced", "가로 위치 미세 조정"],
    ['label[for="prop-offsetX"]', "advanced", "가로 이동 이름표"],
    ["#prop-offsetY", "advanced", "세로 위치 미세 조정"],
    ['label[for="prop-offsetY"]', "advanced", "세로 이동 이름표"],
    ['[data-prop-action="reset-offset"]', "advanced", "위치 미세 조정을 쓰는 사람만 필요하다"],
    ["#prop-break", "advanced", "마디 나눔 종류는 인쇄 배치를 고칠 때만 쓴다"],
    ['label[for="prop-break"]', "advanced", "마디 나눔 이름표"],
    ['[data-prop-section="shape"]', "advanced", "음표 모양(기둥·머리·세기·꾸밈 칩)은 세부 조정이다"],
    ["#prop-rehearsal", "advanced", "연습 기호 입력칸"],
    ['label[for="prop-rehearsal"]', "advanced", "연습 기호 이름표"],
    ["#prop-staffText", "advanced", "보표 문구 입력칸"],
    ['label[for="prop-staffText"]', "advanced", "보표 문구 이름표"],
    // 속성 패널 — 마디·음표 세부(ui-v3.js)
    ["#measure-jump", "advanced", "D.C.·D.S. 같은 되돌아가기는 고급 표기다"],
    ['label[for="measure-jump"]', "advanced", "되돌아가기 이름표"],
    ["#jump-repeats", "advanced", "되돌아간 뒤 반복 여부"],
    ['label[for="jump-repeats"]', "advanced", "되돌아간 뒤 반복 이름표"],
    ["#measure-marker", "advanced", "코다·피네 같은 이동 표지는 고급 표기다"],
    ['label[for="measure-marker"]', "advanced", "이동 표지 이름표"],
    ["#measure-range", "advanced", "범위 삭제는 마디 설정 대화상자에서도 된다"],
    ["#measure-split", "advanced", "마디 나누기는 고급 편집이다"],
    ["#measure-join", "advanced", "마디 합치기는 고급 편집이다"],
    ["#measure-pickup", "advanced", "못갖춘마디 설정은 고급 편집이다"],
    ["#measure-unpickup", "advanced", "못갖춘마디 해제는 고급 편집이다"],
    ["#note-v3", "advanced", "화음 음 고르기·꾸밈 기호·트릴 연장선·옥타브 선은 고급 표기다"]
  ];
  const TIERS = Object.freeze(ROWS.map(([sel, tier, why]) => Object.freeze({ sel, tier, why })));

  const isLevel = value => typeof value === "string" && LEVELS.includes(value);
  let level = null;
  let wired = false;
  const watched = new WeakSet();

  function readStored() {
    try {
      const value = localStorage.getItem(KEY);
      return isLevel(value) ? value : DEFAULT;
    } catch (err) { return DEFAULT; }   // 저장소가 막힌 브라우저
  }
  function get() { if (level === null) level = readStored(); return level; }

  function syncButton() {
    const button = document.getElementById("btn-view-level");
    if (!button) return;
    const basic = get() === "basic";
    button.setAttribute("aria-pressed", String(basic));
    button.classList.toggle("on", basic);      // ui-v3.js가 .on을 보고 aria-pressed를 다시 쓰므로 같은 값으로 맞추고, 켜진 단추 모양도 얻는다
    button.title = basic ? TITLE_ON : TITLE_OFF;
  }
  /** 숨겨질 요소에 초점이 있었다면 전환 단추로 옮긴다(초점이 사라져 키보드 사용자가 길을 잃지 않게). */
  function keepFocus(before) {
    if (get() !== "basic" || !before || before === document.body || typeof before.closest !== "function") return;
    if (!before.closest(HIDDEN)) return;
    document.getElementById("btn-view-level")?.focus?.();
  }
  function apply(changed) {
    const before = changed ? document.activeElement : null;
    document.documentElement.dataset.view = get();
    syncButton();
    if (!changed) return;
    keepFocus(before);
    document.dispatchEvent(new CustomEvent(EVENT, { detail: { level: get() } }));
  }
  function set(value) {
    if (!isLevel(value)) return false;
    level = value;
    try { localStorage.setItem(KEY, value); } catch (err) { /* 저장소가 막혀도 이번 방문에서는 바뀐다 */ }
    apply(true);
    return true;
  }
  function toggle() { set(get() === "basic" ? "advanced" : "basic"); return get(); }

  /** root(기본은 문서 전체) 안의 요소에 분류를 붙인다. 붙인 요소 수를 돌려준다. */
  function tag(root) {
    const scope = root || document;
    if (!scope || typeof scope.querySelectorAll !== "function") return 0;
    let count = 0;
    for (const row of TIERS) {
      let found;
      try { found = [...scope.querySelectorAll(row.sel)]; } catch (err) { continue; }
      if (scope.nodeType === 1 && scope.matches?.(row.sel)) found.push(scope);
      for (const el of found) { if (el.dataset.tier !== row.tier) el.dataset.tier = row.tier; count++; }
    }
    return count;
  }

  // 다시 그려지는 곳(속성 패널·위쪽 줄·팔레트·아래 막대)에 새로 생긴 요소도 같은 표로 분류한다. 파일 메뉴는 위쪽 줄 안에 있어 따로 감시하지 않는다.
  // 그리는 쪽 코드를 고치지 않아도 되고, 변경 알림은 그림이 그려지기 전에 처리되어 깜박이지 않는다.
  const HOSTS = ["#properties-body", ".topbar", ".palette-bar", ".statusbar"];
  function watch() {
    if (typeof MutationObserver !== "function") return;
    for (const selector of HOSTS) {
      const host = document.querySelector(selector);
      if (!host || watched.has(host)) continue;
      watched.add(host);
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) tag(node);
      }).observe(host, { childList: true, subtree: true });
    }
  }

  /** 숨긴 위쪽 줄 단추도 명령 팔레트에서 누를 수 있게 한다(팔레트 단추·키맵 명령은 이미 있다). */
  const HAS_COMMAND = new Set(["btn-navigator", "btn-timeline"]);   // 키맵에 명령이 따로 있다
  function registerCommands() {
    const register = SF.keymap?.registerCommand;
    if (typeof register !== "function") return;
    register({ id: "view-level", label: "기본 보기 켜기/끄기", run: toggle });
    const inPalette = new Set();
    for (const group of SF.palette?.PALETTE || []) for (const item of group.items) if (item.id) inPalette.add(item.id);
    for (const row of TIERS) {
      const match = /^#(btn-[\w-]+)$/.exec(row.sel);
      if (!match || HAS_COMMAND.has(match[1]) || inPalette.has(match[1])) continue;
      const el = document.getElementById(match[1]);
      if (!el || el.tagName !== "BUTTON" || el.closest(".authbar")) continue;   // 회원 단추는 명령으로 만들지 않는다(탈퇴는 기능 스위치 뒤)
      const label = (el.title || el.textContent || "").trim();
      if (label) register({ id: `view-${match[1]}`, label, run: () => el.click() });
    }
  }

  function init() {
    apply(false);
    tag(document);
    watch();
    SF.palette?.refreshView?.();
    if (!wired) {
      wired = true;
      document.getElementById("btn-view-level")?.addEventListener("click", () => { toggle(); });
      registerCommands();
    }
    return get();
  }

  SF.viewLevel = { KEY, LEVELS, DEFAULT, EVENT, TIERS, get, set, toggle, tag, init };
  // 스크립트가 실행되는 순간(첫 그림 전) 저장된 수준과 정적 마크업의 분류를 바로 적용한다. 나머지는 app.js가 init()으로 마무리한다.
  apply(false);
  tag(document);
})(window.SF);
