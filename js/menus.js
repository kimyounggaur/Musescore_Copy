/* js/menus.js — 파일·계정·더보기 같은 팝업 메뉴의 열기·닫기·위치·키보드를 한 곳에서 맡는다(P6-1).
 * 런타임 의존: 없음(순수 DOM). index.html에서 app.js보다 먼저 불러온다.
 *
 * 왜 따로 두나: 좁은 화면에서 상단바(.topbar)는 스크롤 상자(overflow)가 되는데, 그 안에 absolute로 띄운 메뉴는
 * 상자 모양대로 잘려서 아래쪽 항목에 닿을 수 없었다. 브라우저의 Popover API는 메뉴를 "최상위 레이어"에 올려서
 * 부모의 overflow에 잘리지 않는다. Popover를 모르는 브라우저는 같은 위치 계산에 position:fixed + .open 클래스를 쓰고,
 * 바깥 클릭·Esc·포커스 이동은 이 파일이 직접 닫는다(fixed 요소도 부모의 overflow에 잘리지 않는다).
 * 위치는 CSS anchor positioning에 기대지 않고 placement()로 계산한다 — 지원 범위가 아직 고르지 않다.
 *
 * 메뉴 마크업 규칙: 버튼은 popovertarget·aria-haspopup, 메뉴는 popover·role="menu",
 * 항목은 <button type="button" role="menuitem">. (Popover를 모르는 브라우저에서는 setup이 popover·popovertarget을 걷어 낸다.)
 * role="menu"가 아닌 꾸러미(계정·더보기 메뉴처럼 상태 글자·버튼·선택 칸이 섞인 것)는 items 선택자로 키보드 이동 대상을,
 * closeOn 선택자로 "이걸 누르면 메뉴를 닫는다"를 알려 준다(기본: 버튼·링크·label·data-act).
 *
 * dock(P6-2·P6-3): 좁은 화면에서 어떤 노드(회원 메뉴 .authbar, 더보기로 모이는 .more-group들)를 메뉴 안으로 옮겼다가
 * 넓어지면 제자리로 되돌린다. */
"use strict";
(function (SF) {
  const MARGIN = 8;        // 화면 가장자리에서 띄우는 간격(px)
  const GAP = 4;           // 버튼과 메뉴 사이(px)
  const MIN_HEIGHT = 120;  // 남은 높이가 아무리 작아도 이만큼은 보여 준다(px)
  const ITEM = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
  const CLOSE_ON = "button,a,label,[data-act]";
  const OWN_KEYS = "select,textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])"; // 방향키를 스스로 쓰는 컨트롤
  const controllers = new Map(); // 메뉴 요소 → 제어 객체

  // 이 브라우저가 Popover를 "쓸 수 있는가" — JS 쪽 API와 CSS 쪽 :popover-open이 같이 있을 때만 켠다.
  function supported() {
    return typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function" &&
      Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover") &&
      typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("selector(:popover-open)");
  }

  // 메뉴를 놓을 자리. anchor는 버튼의 {left,bottom}, size는 메뉴의 {width}, view는 화면의 {width,height}(모두 px).
  // 버튼 바로 아래(GAP)에 왼쪽을 맞추되, 화면 밖으로 나가면 가장자리(MARGIN)까지만 당겨 온다.
  function placement(anchor, size, view) {
    const top = Math.round(anchor.bottom) + GAP;
    const left = Math.max(MARGIN, Math.min(Math.round(anchor.left), view.width - size.width - MARGIN));
    return { left, top, maxHeight: Math.max(MIN_HEIGHT, view.height - top - MARGIN) };
  }

  const resolve = target => typeof target === "string" ? document.querySelector(target) : target;

  // options: { button, menu, items?, closeOn? } — 요소 또는 선택자. items는 ↑↓로 오갈 항목의 선택자(기본: role이 menuitem인 것),
  // closeOn은 누르면 메뉴가 닫히는 항목의 선택자(기본: 버튼·링크·label·data-act. 선택 칸이 든 꾸러미는 "button"만 두어 값을 고르는 동안 열어 둔다).
  // 제어 객체 { open, close, isOpen, place }를 돌려준다.
  function setup(options) {
    const button = resolve(options.button), menu = resolve(options.menu);
    if (!button || !menu) return null;
    if (controllers.has(menu)) return controllers.get(menu);
    const native = supported();
    let attached = false, pendingFocus = "first", frame = 0;

    if (native) {
      if (!menu.hasAttribute("popover")) menu.setAttribute("popover", "auto");
      if (menu.id && !button.hasAttribute("popovertarget")) button.setAttribute("popovertarget", menu.id);
    } else {
      // 마크업의 popover 속성을 걷어 내야 일반 요소로 다뤄져 .open 규칙이 먹고, 브라우저가 따로 숨기지 않는다.
      menu.removeAttribute("popover");
      button.removeAttribute("popovertarget");
    }
    if (menu.getAttribute("role") === "menu") button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    if (menu.id) button.setAttribute("aria-controls", menu.id);

    const isOpen = () => native ? menu.matches(":popover-open") : menu.classList.contains("open");
    const setExpanded = open => button.setAttribute("aria-expanded", String(open));
    const itemSelector = options.items || ITEM;
    const items = () => [...menu.querySelectorAll(itemSelector)].filter(el => !el.disabled && el.getClientRects().length > 0);

    // 메뉴가 원래 차지하는 너비(내용의 폭, max-width까지)를 잰다. 닫혀 있어도 잴 수 있게 잠깐 보이지 않게 펼치고,
    // left를 0으로 둔다 — 그래야 지금 놓인 자리 오른쪽의 남은 폭에 눌린 너비가 아니라 본래 너비가 나온다(화면에는 그려지지 않는다).
    function measure() {
      const keys = ["display", "visibility", "left", "top"], keep = keys.map(key => menu.style[key]);
      menu.style.visibility = "hidden"; menu.style.display = "block"; menu.style.left = "0px"; menu.style.top = "0px";
      const width = menu.offsetWidth;
      keys.forEach((key, i) => { menu.style[key] = keep[i]; });
      return width;
    }
    // 버튼이 화면에서 사라졌으면(폭이 바뀌어 다른 곳으로 옮겨 간 경우 등) false — 열거나 위치를 잡을 수 없다.
    function place() {
      if (!button.getClientRects().length) return false;
      const p = placement(button.getBoundingClientRect(), { width: measure() },
        { width: document.documentElement.clientWidth, height: window.innerHeight });
      menu.style.left = p.left + "px"; menu.style.top = p.top + "px"; menu.style.maxHeight = p.maxHeight + "px";
      return true;
    }

    function onOutside(e) { if (!menu.contains(e.target) && !button.contains(e.target)) close({ restoreFocus: false }); }
    // 메뉴가 열려 있는 동안 Esc는 메뉴만 닫는다 — 전역 단축키(재생 정지·선택 해제)까지 번지지 않게 막는다.
    function onDocKey(e) {
      if (e.key !== "Escape" || e.isComposing || !isOpen()) return;
      e.preventDefault(); e.stopPropagation();
      close();
    }
    function schedule() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; if (isOpen() && !place()) close({ restoreFocus: false }); });
    }
    function attach() {
      if (attached) return;
      attached = true;
      document.addEventListener("keydown", onDocKey, true);
      window.addEventListener("resize", schedule);
      if (!native) document.addEventListener("pointerdown", onOutside, true); // 네이티브는 브라우저가 바깥 누름으로 닫는다
    }
    function detach() {
      if (!attached) return;
      attached = false;
      document.removeEventListener("keydown", onDocKey, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("pointerdown", onOutside, true);
    }
    function onOpened() {
      attach();
      const list = items(), target = pendingFocus === "last" ? list[list.length - 1] : list[0];
      const preventScroll = pendingFocus !== "last";
      pendingFocus = "first";
      if (target) target.focus({ preventScroll });
    }

    function open(opts) {
      pendingFocus = opts && opts.focus === "last" ? "last" : "first";
      if (isOpen()) return;
      closeOthers(menu);
      if (native) {
        try { menu.showPopover(); } catch (err) { /* 문서에서 떨어진 요소 등 — 열지 않는다 */ }
      } else if (place()) {
        menu.classList.add("open"); setExpanded(true); onOpened();
      }
    }
    // opts.restoreFocus === false면 포커스를 버튼으로 돌려놓지 않는다(바깥을 눌러 닫을 때).
    // 메뉴 안에 포커스가 있었을 때만 버튼으로 돌린다 — 항목 동작이 이미 대화상자로 포커스를 옮겼다면 건드리지 않는다.
    function close(opts) {
      const inside = menu.contains(document.activeElement);
      if (native) {
        try { if (menu.matches(":popover-open")) menu.hidePopover(); } catch (err) { /* 이미 닫힘 */ }
      } else if (menu.classList.contains("open")) {
        menu.classList.remove("open"); setExpanded(false); detach();
      }
      if (inside && !(opts && opts.restoreFocus === false)) button.focus({ preventScroll: true });
    }

    if (native) {
      menu.addEventListener("beforetoggle", e => {
        if (e.newState === "open") {
          if (!place()) { e.preventDefault(); return; }
          setExpanded(true);
        } else { setExpanded(false); detach(); } // toggle 이벤트는 한 박자 늦게 오므로, 닫는 순간 바로 떼어 다음 Esc를 가로채지 않게 한다
      });
      menu.addEventListener("toggle", e => { if (e.newState === "open") onOpened(); else detach(); });
    } else {
      button.addEventListener("click", () => { if (isOpen()) close(); else open(); });
    }

    // 버튼에서 ↓/↑로 열기(첫·마지막 항목으로 포커스)
    button.addEventListener("keydown", e => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      e.preventDefault(); e.stopPropagation();
      open({ focus: e.key === "ArrowUp" ? "last" : "first" });
    });
    // 항목 사이 이동. 메뉴에 포커스가 있는 동안의 글자 키는 전역 단축키(음표 입력 등)로 새어 나가지 않게 막는다.
    // 선택 칸·입력 칸은 ↑↓·Home·End를 스스로 쓰므로(값 바꾸기·커서 옮기기) 메뉴 이동으로 가로채지 않는다.
    menu.addEventListener("keydown", e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const own = !!(e.target.closest && e.target.closest(OWN_KEYS));
      const list = items(), index = list.indexOf(document.activeElement);
      if (own && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!list.length) return;
        e.preventDefault(); e.stopPropagation();
        const step = e.key === "ArrowDown" ? 1 : -1;
        list[(index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length)].focus();
      } else if (e.key === "Home" || e.key === "End") {
        if (!list.length) return;
        e.preventDefault(); e.stopPropagation();
        list[e.key === "Home" ? 0 : list.length - 1].focus();
      } else if (e.key.length === 1 || e.key === "Delete" || e.key === "Backspace") {
        e.stopPropagation();
      }
    });
    // 항목을 누르면 메뉴를 먼저 닫고(포커스는 버튼으로), 그다음 항목의 동작이 이어서 실행된다.
    const closeOn = options.closeOn || CLOSE_ON;
    menu.addEventListener("click", e => {
      const target = e.target.closest && e.target.closest(closeOn);
      if (!target || !menu.contains(target) || target.disabled) return;
      close();
    });
    // Tab으로 메뉴 밖으로 나가면 닫는다. relatedTarget이 없는 경우(창 전환, 빈 곳 누름)는 건드리지 않는다.
    menu.addEventListener("focusout", e => {
      const next = e.relatedTarget;
      if (next && !menu.contains(next) && next !== button) close({ restoreFocus: false });
    });

    const controller = { open, close, isOpen, place };
    controllers.set(menu, controller);
    return controller;
  }

  function closeOthers(except) {
    for (const [menu, controller] of controllers) if (menu !== except && controller.isOpen()) controller.close({ restoreFocus: false });
  }
  function open(target, opts) { const controller = controllers.get(resolve(target)); if (controller) controller.open(opts); }
  function close(target, opts) { const controller = controllers.get(resolve(target)); if (controller) controller.close(opts); }
  function closeAll(opts) { for (const controller of controllers.values()) controller.close(opts); }
  function isOpen(target) { const controller = controllers.get(resolve(target)); return !!controller && controller.isOpen(); }

  // options: { node, target, media } — node는 요소·선택자 또는 그 배열. media(CSS 미디어 쿼리)가 맞는 동안 node들을 target 안으로 옮기고,
  // 아니면 각자 원래 자리로 되돌린다. 원래 자리는 노드 앞에 주석 노드를 남겨 표시한다. 노드를 옮길 뿐이라 id와 이벤트 연결이 그대로다
  // (auth.js처럼 id로 찾아 붙인 코드도, 노드 안에 나중에 붙는 항목도 계속 동작). 되돌릴 때 target이 열려 있으면 먼저 닫는다(내용이 빠지므로).
  function dock(options) {
    const target = resolve(options.target);
    const nodes = (Array.isArray(options.node) ? options.node : [options.node]).map(resolve).filter(node => node && node.parentNode);
    if (!nodes.length || !target || typeof window.matchMedia !== "function") return null;
    const homes = nodes.map(node => {
      const marker = document.createComment("dock home: " + (node.id || node.className));
      node.parentNode.insertBefore(marker, node);
      return { node, marker };
    });
    const query = window.matchMedia(options.media);
    function apply() {
      if (query.matches) {
        for (const { node } of homes) if (node.parentNode !== target) target.append(node); // 좁아질 때 target은 비어 있고 닫혀 있다
      } else if (homes.some(({ node, marker }) => marker.nextSibling !== node)) {
        close(target, { restoreFocus: false }); // 열린 채로 넓어지면 내용이 빠지기 전에 먼저 닫는다
        for (const { node, marker } of homes) if (marker.nextSibling !== node) marker.parentNode.insertBefore(node, marker.nextSibling);
      }
    }
    if (query.addEventListener) query.addEventListener("change", apply); else query.addListener(apply); // 구형 Safari
    apply();
    return { apply, query, markers: homes.map(home => home.marker) };
  }

  SF.menus = { supported, placement, setup, open, close, closeAll, isOpen, dock };
})(window.SF = window.SF || {});
