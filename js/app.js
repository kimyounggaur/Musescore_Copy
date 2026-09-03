/* =========================================================================
 * ScoreForge app — UI 배선: 툴바, 단축키, 마우스 입력, 피아노, 재생, 다이얼로그
 * ========================================================================= */
"use strict";
(function (SF) {
  const C = SF.core;
  const E = SF.engrave;
  const P = SF.playback;
  const IO = SF.io;
  const { Fraction } = SF;

  /* ---------------- UI 상태 ---------------- */
  const ui = {
    inputMode: false,
    restMode: false,
    curDur: { n: 1, d: 4, dots: 0 },
    selectedNoteIdx: null,
    pageMode: "continuous", multiRest: true, playbackRate: 1, countIn: false, loop: null,
    selection: null,      // 이벤트 id (포커스)
    selAnchor: null,      // 범위 선택의 기준점 (Shift+클릭/화살표)
    cursorId: null,       // 입력 커서가 가리키는 이벤트 id
    lastInsertedId: null,
    lastPitch: null,      // 옥타브 추론 기준
    speedy: false,
    speedyStep: null,     // 스피디 크로스헤어 absStep
    speedyHeld: new Set(),
    zoom: 1,
    fitScale: 1,
    pianoVisible: true,
    lyricVerse: 1,
    currentVoice: 1,
    viewMode: { type: "full", partIdx: null },
    hideEmptyStaves: false,
    midiEnabled: false,
    dragging: null,
    theme: "dark",
  };
  const THEME_KEY = "scoreforge-ui-theme";
  const THEMES = new Set(["dark", "light", "pretty", "cute"]);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------------- UI 테마 ---------------- */
  function loadTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEMES.has(saved) ? saved : "dark";
    } catch {
      return "dark";
    }
  }

  function saveTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }

  function themeLabel(theme) {
    if (theme === "light") return "Light UI";
    if (theme === "pretty") return "Pretty UI";
    if (theme === "cute") return "Cute UI";
    return "Dark UI";
  }

  function applyTheme(theme, opts = {}) {
    const next = THEMES.has(theme) ? theme : "dark";
    ui.theme = next;
    document.body.dataset.theme = next;
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next === "dark" ? "dark" : "light";
    const picker = $("#theme-select");
    if (picker) picker.value = next;
    if (!opts.silent) toast(`${themeLabel(next)}로 전환했어요`);
  }

  /* ---------------- 렌더 ---------------- */
  let layoutCache = null;
  let changeRevision = 0, renderedRevision = -1, renderedScore = null, renderKey = "", frame = null;
  let saveTimer = null, savedRevision = 0;
  let propertiesScore = null, propertiesKey = "", propertiesRevision = -1;
  function relayout() {
    const score = C.state.score;
    const res = E.render(score, { cache: true, selection: selectedIds(), selectedNoteIdx: ui.selectedNoteIdx,
      viewMode: ui.viewMode, pageMode: ui.pageMode, multiRest: ui.viewMode.type === "part" && ui.multiRest && !ui.inputMode && !ui.speedy,
      hideEmptyStaves: ui.hideEmptyStaves, activeVoice: ui.currentVoice });
    layoutCache = res.layout;
    $("#svg-host").innerHTML = res.svg;
    // Font glyph bounding boxes overlap adjacent chord heads. Give each visible
    // head its own small pointer target, in the renderer's global coordinates.
    for (const le of layoutCache.eventsById.values()) {
      const event = $("#svg-host").querySelector(`[data-ref="${CSS.escape(le.id)}"]`);
      for (const head of le.noteheads || []) {
        const group = event?.querySelector(`[data-note="${head.index}"]`);
        if (!group) continue;
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        for (const [key, value] of Object.entries({ class: "note-hit", cx: head.x, cy: head.y, rx: Math.max(6, head.width / 2), ry: Math.max(5, head.height / 2) })) hit.setAttribute(key, value);
        group.append(hit);
      }
    }
    renderedScore = score; renderedRevision = changeRevision;
    const svg = $("#score-svg");
    if (svg) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `악보: ${score.meta.title || "제목 없음"}, ${score.measures.length}마디`); }
    applyZoom();
    if (P.player.playing) timeline = buildTimeline();
  }
  function repaint() {
    const score = C.state.score;
    $$("#svg-host > svg").forEach(svg => svg.setAttribute("aria-label", SF.t ? SF.t("a11y.score", { title: score.meta.title || "제목 없음", measures: score.measures.length }) : `악보: ${score.meta.title}, ${score.measures.length}마디`));
    const ids = selectedIds() || new Set();
    $$("#svg-host [data-ref]").forEach(el => {
      const on = ids.has(el.getAttribute("data-ref"));
      el.classList.toggle("sel", on && (ids.size > 1 || ui.selectedNoteIdx === null));
      el.querySelectorAll("[data-note]").forEach(head => head.classList.toggle("sel-note", on && ids.size === 1 && ui.selectedNoteIdx !== null && +head.dataset.note === ui.selectedNoteIdx));
    });
    refreshCursor();
    SF.uiV3?.drawLoop();
  }
  function refreshChrome() {
    const score = C.state.score;
    for (const [id, key] of [["#t-title", "title"], ["#t-composer", "composer"]]) {
      const el = $(id);
      if (!el.isContentEditable) el.textContent = score.meta[key] || (key === "title" ? "제목 없음" : "");
    }
    $("#t-composer").style.display = score.meta.composer ? "" : "none";
    refreshToolbar(); updateStatus();
    const focused = document.activeElement;
    const key = JSON.stringify([ui.selection, ui.selAnchor, ui.selectedNoteIdx, ui.currentVoice]);
    const editingProperty = focused?.closest("#properties-panel") && focused.matches("input:not([type=checkbox]):not([type=color]),textarea");
    const propertiesChanged = propertiesScore !== score || propertiesKey !== key || propertiesRevision !== C.state.revision;
    if (propertiesChanged && (!editingProperty || propertiesScore !== score || propertiesKey !== key)) {
      const restoreId = focused?.closest("#properties-panel") ? focused.id : null;
      renderPropertiesPanel(); propertiesScore = score; propertiesKey = key; propertiesRevision = C.state.revision;
      if (restoreId) requestAnimationFrame(() => document.getElementById(restoreId)?.focus({ preventScroll: true }));
    }
    refreshOpenOverlays();
    SF.uiV3?.refresh();
  }
  function update(opts = {}) {
    if (opts.force) renderedRevision = -1;
    const run = () => {
      frame = null;
      const key = JSON.stringify([ui.viewMode, ui.hideEmptyStaves, ui.pageMode, ui.multiRest, ui.currentVoice, ui.inputMode, ui.speedy]);
      if (!layoutCache || renderedScore !== C.state.score || renderedRevision !== changeRevision || key !== renderKey) {
        renderKey = key; relayout();
      }
      repaint(); refreshChrome();
    };
    if (opts.immediate) { if (frame) cancelAnimationFrame(frame); run(); }
    else if (!frame) frame = requestAnimationFrame(run);
  }
  function scheduleAutosave() {
    if (C.state.readOnly) return;
    IO.autosave(C.state.score, { onComplete(status) {
      if (status.error) toast("자동 저장 공간이 부족해요. 파일 메뉴에서 악보를 저장해 주세요.");
      else { savedRevision = status.revision; $("#status-hint").textContent = "이 기기에 자동 저장했어요"; }
    } });
  }

  function saveScore() {
    IO.saveJSON(C.state.score);
    savedRevision = C.state.revision;
    toast("악보 파일을 내려받았어요");
  }
  function setReadOnly(value) {
    C.state.readOnly = !!value; ui.readOnly = !!value;
    document.body.classList.toggle("read-only", !!value);
    if (value) { setInputMode(false); toggleSpeedy(false); clearTimeout(saveTimer); }
    update();
  }

  function refreshCursor() {
    if (ui.speedy) {
      const pos = cursorPos();
      if (ui.speedyStep === null) {
        const seed = ui.lastPitch || C.CLEFS[C.activeClef(C.state.score)].middle;
        ui.speedyStep = clampStep(C.absStep(seed), pos.found);
      }
      E.drawInputCursor(null);
      E.drawSpeedy({ cursorId: ui.cursorId, step: ui.speedyStep });
      return;
    }
    E.drawSpeedy(null);
    if (ui.inputMode && ui.cursorId) E.drawInputCursor(ui.cursorId);
    else E.drawInputCursor(null);
  }

  function applyZoom() {
    const host = $("#paper");
    const wrap = $("#canvas");
    const pageW = E.pageWidth ? E.pageWidth(C.state.score) : E.PAGE_W;
    const avail = wrap.clientWidth - 28;
    ui.fitScale = Math.min(1, avail / pageW);
    const s = ui.fitScale * ui.zoom;
    host.style.width = pageW + "px";
    host.style.transform = `scale(${s})`;
    host.style.transformOrigin = "top left";
    const h = layoutCache?.height || 600;
    const headH = $("#paper-head").offsetHeight;
    wrap.querySelector(".paper-sizer").style.height = (h + headH + 70) * s + "px";
    wrap.querySelector(".paper-sizer").style.width = pageW * s + "px";
    $("#zoom-label").textContent = Math.round(ui.zoom * 100) + "%";
  }

  /* ---------------- 좌표 변환 ---------------- */
  function svgPoint(evt) {
    let svg = evt.target?.closest?.("#svg-host > svg");
    if (!svg) svg = $$("#svg-host > svg").find(el => { const r = el.getBoundingClientRect(); return evt.clientY >= r.top && evt.clientY <= r.bottom; });
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(matrix.inverse());
    const page = +(svg.dataset.page || 0);
    return ui.pageMode === "pages" ? E.pageToGlobal(page, point.x, point.y, layoutCache) : { x: point.x, y: point.y, page: 0 };
  }

  /* ---------------- 입력 도우미 ---------------- */
  /* ---------------- 선택 ---------------- */
  function select(id, opts = {}) {
    ui.selectAll = false;
    ui.selection = id;
    ui.selectedNoteIdx = opts.noteIdx ?? null;
    if (!opts.extend || !ui.selAnchor) ui.selAnchor = id;
    const found = id && C.findEvent(C.state.score, id);
    if (found) C.setActiveStaff(C.state.score, found.partIdx, found.staffIdx);
    update();
    if (id && !opts.silent) {
      if (found && found.ev.type === "note") {
        P.previewNote(found.ev.notes.map(C.midiOf), 0.3);
      }
    }
  }
  function selectedEvent() {
    if (!ui.selection) return null;
    return C.findEvent(C.state.score, ui.selection);
  }

  /* 범위 선택: anchor~focus 사이 모든 이벤트 id (단일이면 1개) */
  function selectedIds() {
    if (ui.selectAll) return new Set(C.eventOrderMap(C.state.score).keys());
    if (!ui.selection) return null;
    if (!ui.selAnchor || ui.selAnchor === ui.selection) return new Set([ui.selection]);
    const order = C.eventOrderMap(C.state.score);
    const a = order.get(ui.selAnchor), b = order.get(ui.selection);
    if (a === undefined || b === undefined) return new Set([ui.selection]);
    const first = C.findEvent(C.state.score, ui.selAnchor), last = C.findEvent(C.state.score, ui.selection);
    if (first && last && first.globalIdx !== last.globalIdx) {
      const set = new Set(), loStaff = Math.min(first.globalIdx, last.globalIdx), hiStaff = Math.max(first.globalIdx, last.globalIdx);
      for (const ref of C.staffRefs(C.state.score)) if (ref.globalIdx >= loStaff && ref.globalIdx <= hiStaff)
        for (let m = Math.min(first.m, last.m); m <= Math.max(first.m, last.m); m++)
          for (const { ev } of C.measureEntries(ref.measures[m], { score: C.state.score })) set.add(ev.id);
      return set;
    }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const set = new Set();
    for (const [id, idx] of order) if (idx >= lo && idx <= hi) set.add(id);
    return set;
  }

  /* 범위 내 음표 이벤트의 양 끝 id */
  function rangeNoteEnds() {
    const ids = selectedIds();
    if (!ids) return null;
    const order = C.eventOrderMap(C.state.score);
    const notes = [...ids]
      .filter(id => { const f = C.findEvent(C.state.score, id); return f && f.ev.type === "note"; })
      .sort((x, y) => order.get(x) - order.get(y));
    if (!notes.length) return null;
    return { firstId: notes[0], lastId: notes[notes.length - 1], count: notes.length };
  }

  /* 대상 이벤트: 선택 우선, 입력 모드면 마지막 입력 */
  function targetEvent() {
    if (ui.selection) return C.findEvent(C.state.score, ui.selection);
    if ((ui.inputMode || ui.speedy) && ui.lastInsertedId) return C.findEvent(C.state.score, ui.lastInsertedId);
    return null;
  }

  /* ---------------- 재생 ---------------- */
  function buildTimeline() {
    // 모든 이벤트(쉼표 포함)의 시각 → 레이아웃 x와 결합
    const score = C.state.score;
    const comp = P.compile(score, { viewMode: ui.viewMode });
    const pts = [];
    const layout = layoutCache || E.getLayout();
    for (const tev of comp.timelineEvents || []) {
      const le = layout.eventsById.get(tev.id);
      if (le) pts.push({ t: tev.t, x: le.x, sys: le.sys, staff: le.staff, id: tev.id });
      else {
        const f = C.findEvent(score, tev.id);
        if (!f) continue;
        const progress = C.eventStartTick(f.measures[f.m], f.e, f).div(C.measureLenAt(score, f.m)).value;
        const pos = E.positionForMeasure(f.m, progress, f.globalIdx, layout);
        if (pos) pts.push({ t: tev.t, x: pos.x, sys: pos.sys, staff: pos.staff, id: tev.id });
      }
    }
    for (let m = 0; m < score.measures.length; m++) {
      // 마디 끝점
      const sysM = layout.systems.find(S => S.measures.some(M => M.idx === m));
      if (sysM) {
        const M = sysM.measures.find(M2 => M2.idx === m);
        pts.push({ t: comp.measureTimes?.[m + 1] ?? comp.totalSec, x: M.x1, sys: sysM, id: null });
      }
    }
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }

  let timeline = null;
  let lastHl = new Set();
  let scrollLock = 0;

  function startPlayback(fromSec) {
    timeline = buildTimeline();
    P.play(fromSec, { viewMode: ui.viewMode, rate: ui.playbackRate, loop: ui.loop, countIn: ui.countIn && P.player.metronome });
  }

  function playFromSelection() {
    const score = C.state.score;
    let fromSec = 0;
    const found = selectedEvent();
    if (found) {
      const comp = P.compile(score, { viewMode: ui.viewMode });
      const tev = (comp.timelineEvents || []).find(ev => ev.id === found.ev.id);
      fromSec = tev ? tev.t : 0;
    }
    startPlayback(fromSec);
  }

  P.player.onTick = (sec, comp) => {
    // 커서 위치
    if (timeline && timeline.length) {
      let i = 0;
      while (i + 1 < timeline.length && timeline[i + 1].t <= sec) i++;
      const a = timeline[i], b = timeline[i + 1];
      let x = a.x, sys = a.sys;
      if (b && b.sys === a.sys && b.t > a.t) {
        x = a.x + (b.x - a.x) * (sec - a.t) / (b.t - a.t);
      }
      const page = sys.page || 0;
      $$(".play-cursor").forEach(el => el.setAttribute("opacity", "0"));
      const cursor = ui.pageMode === "pages" ? $(`#score-svg-page-${page} .play-cursor`) : $("#play-cursor");
      if (!cursor) return;
      cursor.setAttribute("x1", x); cursor.setAttribute("x2", x);
      const y1 = Math.min(...sys.staffLayouts.map(st => st.yTop)) - 14;
      const y2 = Math.max(...sys.staffLayouts.map(st => st.yTop + E.STAFF_H)) + 14;
      cursor.setAttribute("y1", y1); cursor.setAttribute("y2", y2);
      cursor.setAttribute("opacity", "0.85");
      autoScroll(sys);
    }
    // 음표/건반 하이라이트
    const now = new Set();
    const activeMidis = new Set();
    for (const ev of comp.events) {
      if (ev.t <= sec && sec < ev.t + Math.max(...ev.midis.map(n => n.durSec), ev.durSec)) {
        now.add(ev.id);
        for (const n of ev.midis) if (sec < ev.t + n.durSec) activeMidis.add(n.midi);
      }
      if (ev.t > sec) break;
    }
    for (const id of lastHl) if (!now.has(id)) {
      const el = document.querySelector(`[data-ref="${id}"]`);
      if (el) el.classList.remove("playing");
    }
    for (const id of now) if (!lastHl.has(id)) {
      const el = document.querySelector(`[data-ref="${id}"]`);
      if (el) el.classList.add("playing");
    }
    lastHl = now;
    $$("#piano-keys .key.active").forEach(k => { if (!activeMidis.has(+k.dataset.midi)) k.classList.remove("active"); });
    for (const m of activeMidis) {
      const k = document.querySelector(`#piano-keys .key[data-midi="${m}"]`);
      if (k) k.classList.add("active");
    }
  };
  P.player.onState = (playing) => {
    $("#btn-play").classList.toggle("on", playing);
    $("#btn-play .ic-play").style.display = playing ? "none" : "";
    $("#btn-play .ic-pause").style.display = playing ? "" : "none";
    if (!playing) {
      $$(".play-cursor").forEach(cursor => cursor.setAttribute("opacity", "0"));
      for (const id of lastHl) {
        const el = document.querySelector(`[data-ref="${id}"]`);
        if (el) el.classList.remove("playing");
      }
      lastHl = new Set();
      $$("#piano-keys .key.active").forEach(k => k.classList.remove("active"));
    }
  };
  P.player.onEnd = () => { pausedAt = 0; };

  function autoScroll(sys) {
    const now = Date.now();
    if (now - scrollLock < 400) return;
    const canvas = $("#canvas");
    const headH = $("#paper-head").offsetHeight;
    const s = ui.fitScale * ui.zoom;
    const yTopRaw = Math.min(...sys.staffLayouts.map(st => st.yTop));
    const yBotRaw = Math.max(...sys.staffLayouts.map(st => st.yTop + E.STAFF_H));
    const yTop = (yTopRaw + headH) * s;
    const yBot = (yBotRaw + headH) * s;
    const vTop = canvas.scrollTop, vBot = vTop + canvas.clientHeight;
    if (yTop < vTop + 20 || yBot > vBot - 60) {
      scrollLock = now;
      canvas.scrollTo({ top: Math.max(0, yTop - 90), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }

  let pausedAt = 0;
  function togglePlay() {
    if (P.player.playing || P.player.loading) {
      pausedAt = P.pausePos();
      P.stop();
    } else {
      if (pausedAt > 0.01) startPlayback(pausedAt);
      else playFromSelection();
    }
  }
  function stopPlayback() {
    pausedAt = 0;
    P.stop();
  }

  /* ---------------- 툴바 ---------------- */
  const DURS = [
    { n: 2, d: 1 }, { n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 4 }, { n: 1, d: 8 }, { n: 1, d: 16 }, { n: 1, d: 32 }, { n: 1, d: 64 },
  ];
  function buildToolbar() {
    const host = $("#dur-buttons");
    host.innerHTML = DURS.map((b, i) =>
      `<button class="tbtn dur" data-i="${i}" title="${C.durName({ ...b, dots: 0 })} (${8 - i})">${E.iconNote(b, 0)}</button>`
    ).join("");
    host.addEventListener("click", (e) => {
      const btn = e.target.closest(".dur");
      if (!btn) return;
      setDuration({ ...DURS[+btn.dataset.i], dots: ui.curDur.dots });
    });
    $("#btn-sharp").innerHTML = E.iconAcc("sharp");
    $("#btn-flat").innerHTML = E.iconAcc("flat");
    $("#btn-natural").innerHTML = E.iconAcc("natural");
    $("#btn-rest").innerHTML = E.iconRest() + "<span>쉼표</span>";

    // 악기 select
    const sel = $("#instrument-select");
    sel.innerHTML = Object.entries(P.INSTRUMENTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    $("#staff-select").addEventListener("change", () => {
      const [p, s] = $("#staff-select").value.split(":").map(Number);
      setActiveStaff(p, s);
      update();
    });
    $("#view-select").addEventListener("change", () => {
      const val = $("#view-select").value;
      ui.viewMode = val === "full" ? { type: "full", partIdx: null } : { type: "part", partIdx: +val };
      const visible = C.visibleStaffRefs(C.state.score, ui.viewMode, { hideEmptyStaves: ui.hideEmptyStaves });
      const active = C.activeRef(C.state.score);
      if (!visible.some(r => r.partIdx === active.partIdx && r.staffIdx === active.staffIdx) && visible[0]) {
        C.setActiveStaff(C.state.score, visible[0].partIdx, visible[0].staffIdx);
        ui.cursorId = firstEventIdForVoice(visible[0], ui.currentVoice);
        ui.selection = null; ui.selAnchor = null;
      }
      stopPlayback(); update();
    });
    $("#btn-hide-empty").addEventListener("click", () => {
      ui.hideEmptyStaves = !ui.hideEmptyStaves;
      stopPlayback(); update();
    });
    $("#lyric-verse").addEventListener("change", () => {
      ui.lyricVerse = Math.max(1, Math.min(4, +$("#lyric-verse").value || 1));
      updateStatus();
    });
    if (P.setSampleStatusHandler) {
      P.setSampleStatusHandler((st) => {
        const el = $("#sample-status");
        if (!el) return;
        el.className = `sample-status ${st.state || "idle"}`;
        el.textContent = st.text || "샘플";
        el.title = st.detail || "실제 악기 샘플 음원";
      });
    }
  }

  function refreshToolbar() {
    const score = C.state.score;
    const refs = C.staffRefs(score);
    const active = C.activeRef(score);
    $("#btn-input").classList.toggle("on", ui.inputMode);
    $("#btn-speedy").classList.toggle("on", ui.speedy);
    $("#btn-rest").classList.toggle("on", ui.restMode);
    $("#btn-metronome").classList.toggle("on", P.player.metronome);
    $("#btn-piano").classList.toggle("on", ui.pianoVisible);
    $("#btn-midi").classList.toggle("on", ui.midiEnabled);

    // 선택/커서 기준 활성 음길이
    let activeDur = ui.curDur;
    const found = selectedEvent();
    if (found && !ui.inputMode && !found.ev.full) activeDur = found.ev.dur;
    $$("#dur-buttons .dur").forEach((b, i) => {
      const d = DURS[i];
      b.classList.toggle("on", d.n === activeDur.n && d.d === activeDur.d);
    });
    const dots = found && !ui.inputMode ? found.ev.dur.dots : ui.curDur.dots;
    $("#btn-dot").classList.toggle("on", !!dots);
    $("#btn-dot").textContent = dots === 2 ? "··" : "·";
    $$("#voice-buttons .voice-btn").forEach(b => b.classList.toggle("on", +b.dataset.voice === ui.currentVoice));

    // 임시표 상태
    let alter = null;
    const tgt = found || ((ui.inputMode || ui.speedy) && ui.lastInsertedId ? C.findEvent(score, ui.lastInsertedId) : null);
    if (tgt && tgt.ev.type === "note" && tgt.ev.notes.length) alter = tgt.ev.notes[ui.selectedNoteIdx ?? 0]?.alter;
    $("#btn-sharp").classList.toggle("on", alter === 1);
    $("#btn-flat").classList.toggle("on", alter === -1);
    $("#btn-natural").classList.toggle("on", alter === 0 && tgt && tgt.ev.notes.some(n => n.__acc === "natural"));

    // 아티큘레이션·셈여림 상태
    const ar = tgt && tgt.ev.type === "note" ? (tgt.ev.artics || []) : [];
    $$(".artic-btn").forEach(b => b.classList.toggle("on", ar.includes(b.dataset.artic)));
    $("#btn-grace").classList.toggle("on", !!(tgt && tgt.ev.graceBefore && tgt.ev.graceBefore.length));
    $("#btn-gliss").classList.toggle("on", !!(tgt && tgt.ev.glissando));
    $("#btn-arpeggio").classList.toggle("on", !!(tgt && tgt.ev.arpeggiate));
    $("#btn-tremolo").classList.toggle("on", !!(tgt && tgt.ev.tremolo));
    const dyn = tgt ? tgt.ev.dynamic : null;
    $$(".dynbtn").forEach(b => b.classList.toggle("on", dyn === b.dataset.dyn));
    const mr = selectedMeasureRange();
    const mm = mr ? C.ensureMeasureMeta(score.measures[mr.to] || {}) : null;
    $("#btn-repeat-start").classList.toggle("on", !!(mr && C.ensureMeasureMeta(score.measures[mr.from] || {}).startRepeat));
    $("#btn-repeat-end").classList.toggle("on", !!(mm && mm.endRepeat));
    $("#btn-repeat-count").textContent = `×${mm?.repeatCount || 2}`;
    $("#btn-volta-1").classList.toggle("on", !!(mr && C.ensureMeasureMeta(score.measures[mr.from] || {}).endingStart === "1"));
    $("#btn-volta-2").classList.toggle("on", !!(mr && C.ensureMeasureMeta(score.measures[mr.from] || {}).endingStart === "2"));
    $("#btn-break-system").classList.toggle("on", !!(mm && mm.breakType === "system"));
    $("#btn-break-page").classList.toggle("on", !!(mm && mm.breakType === "page"));
    $("#btn-break-section").classList.toggle("on", !!(mm && mm.breakType === "section"));

    $("#btn-undo").disabled = !C.canUndo();
    $("#btn-redo").disabled = !C.canRedo();
    $("#btn-undo").title = "실행 취소" + (C.undoLabel?.() ? ": " + C.undoLabel() : "");
    $("#btn-redo").title = "다시 실행" + (C.redoLabel?.() ? ": " + C.redoLabel() : "");
    $("#btn-undo").setAttribute("aria-label", $("#btn-undo").title);
    $("#btn-redo").setAttribute("aria-label", $("#btn-redo").title);
    $("#tempo-input").value = score.tempo;
    $("#swing-select").value = score.playbackSettings?.swing || "off";
    const staffSel = $("#staff-select");
    const staffValue = `${active.partIdx}:${active.staffIdx}`;
    const staffOptions = refs.map(ref => {
      const suffix = ref.part.staves.length > 1 ? ` ${ref.staffIdx + 1}` : "";
      return `<option value="${ref.partIdx}:${ref.staffIdx}">${htmlEsc(ref.name)}${suffix}</option>`;
    }).join("");
    if (staffSel.innerHTML !== staffOptions) staffSel.innerHTML = staffOptions;
    staffSel.value = staffValue;
    const viewSel = $("#view-select");
    const viewOptions = [`<option value="full">총보</option>`]
      .concat(score.parts.map((part, idx) => `<option value="${idx}">${htmlEsc(part.name || "파트 " + (idx + 1))}</option>`))
      .join("");
    if (viewSel.innerHTML !== viewOptions) viewSel.innerHTML = viewOptions;
    viewSel.value = ui.viewMode.type === "part" ? String(ui.viewMode.partIdx) : "full";
    $("#btn-hide-empty").classList.toggle("on", ui.hideEmptyStaves);
    $("#btn-hide-empty").disabled = ui.viewMode.type === "part";
    $("#instrument-select").value = active.instrument;
    $("#lyric-verse").value = String(ui.lyricVerse || 1);
    $("#piano-bar").style.display = ui.pianoVisible ? "" : "none";
    $("#drum-pad").classList.toggle("show", C.isPercussionRef(active));
  }

  /* ---------------- 상태바 ---------------- */
  function updateStatus() {
    const score = C.state.score;
    const el = $("#status-sel");
    const active = C.activeRef(score);
    const activeName = active ? `${active.name}${active.part.staves.length > 1 ? " " + (active.staffIdx + 1) : ""}` : "";
    let text = "";
    const found = selectedEvent();
    const ids = selectedIds();
    if (ui.speedy && ui.cursorId) {
      const f = C.findEvent(score, ui.cursorId);
      if (f) text = `스피디: ${f.name}${f.part.staves.length > 1 ? " " + (f.staffIdx + 1) : ""} · 마디 ${f.m + 1} · 크로스헤어 ${pitchForStepLabel(ui.speedyStep)}`;
    } else if (ids && ids.size > 1) {
      text = `${ids.size}개 선택 — Ctrl+C/V=복사/붙여넣기 · S=이음줄 · < >=쐐기`;
    } else if (found) {
      const ev = found.ev;
      if (ev.type === "note") {
        const names = ev.notes.map(n => `${C.pitchName(n, "ko")}(${C.pitchName(n)})`).join("·");
        const marks = [ev.chordSymbol ? (SF.t ? SF.t("status.chord", { symbol: C.displayChordSymbol(ev.chordSymbol) }) : `코드 ${C.displayChordSymbol(ev.chordSymbol)}`) : "", ev.dynamic, ev.tempo ? `♩=${ev.tempo}` : "", ev.rehearsal ? (SF.t ? SF.t("toast.rehearsal", { text: ev.rehearsal }) : `리허설 ${ev.rehearsal}`) : "", ev.staffText || "", ev.soundFlag ? `sound:${ev.soundFlag}` : ""].filter(Boolean);
        const extra = (ev.artics && ev.artics.length ? " · " + ev.artics.join(",") : "") + (marks.length ? " · " + marks.join(" · ") : "");
        text = `${found.name}${found.part.staves.length > 1 ? " " + (found.staffIdx + 1) : ""} · V${found.voice || 1} · 마디 ${found.m + 1} · ${durName2(ev)} · ${names}${extra}`;
      } else {
        const marks = [ev.chordSymbol ? (SF.t ? SF.t("status.chord", { symbol: C.displayChordSymbol(ev.chordSymbol) }) : `코드 ${C.displayChordSymbol(ev.chordSymbol)}`) : "", ev.tempo ? `♩=${ev.tempo}` : "", ev.rehearsal ? (SF.t ? SF.t("toast.rehearsal", { text: ev.rehearsal }) : `리허설 ${ev.rehearsal}`) : "", ev.staffText || "", ev.soundFlag ? `sound:${ev.soundFlag}` : ""].filter(Boolean);
        text = `${found.name}${found.part.staves.length > 1 ? " " + (found.staffIdx + 1) : ""} · V${found.voice || 1} · 마디 ${found.m + 1} · ${ev.full ? "온마디 쉼표" : durName2(ev) + " 쉼표"}${marks.length ? " · " + marks.join(" · ") : ""}`;
      }
    } else if (ui.inputMode && ui.cursorId) {
      const f = C.findEvent(score, ui.cursorId);
      if (f) text = `입력 위치: ${activeName} · V${ui.currentVoice} · 마디 ${f.m + 1} · ${C.durName(ui.curDur)}로 입력`;
    } else {
      text = `${score.measures.length}마디 · ${C.staffRefs(score).length}보표 · ${C.KEY_NAMES[String(score.keySig)] || ""} · ${score.timeSig.num}/${score.timeSig.den}`;
    }
    if (ui.selectedNoteIdx !== null && found?.ev.type === "note") text += ` · 화음 ${ui.selectedNoteIdx + 1}번째 음`;
    text = SF.i18n?.translate(text) ?? text;
    el.textContent = text;
    $("#aria-live").textContent = text;

    $("#status-hint").textContent = ui.speedy
      ? (ui.speedyHeld.size
        ? `건반 ${ui.speedyHeld.size}개 누름 — 숫자로 입력 · 1~8=입력 · 0=쉼표 · Esc=종료`
        : "↑↓=음높이 조준 · ←→=이동 · 1~8=입력 · 0=쉼표 · Esc=종료")
      : (ui.inputMode
        ? (ui.restMode ? "보표를 클릭하면 쉼표가 들어가요 · 쉼표 버튼으로 해제" : "보표 클릭 또는 A~G·피아노 건반으로 입력 · 0=쉼표 · ↑↓=반음 · Esc=종료")
        : "N 또는 ✏️=입력 모드 · 음표 클릭=선택 · 드래그=음높이 · 스페이스=재생");
  }
  function durName2(ev) { return C.durName(ev.dur); }

  /* ---------------- 토스트/힌트 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = SF.i18n?.translate(msg) ?? msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function flashHint(msg) { if (msg) toast(msg); }

  /* ---------------- Supabase 인증 ---------------- */

  /* ---------------- 파일 열기 공통 처리 (메뉴·드래그&드롭) ---------------- */
  function handleLoadedScore(loaded, name, err, report) {
    if (!loaded) {
      toast(`열 수 없어요: ${name}${err && err.message ? " — " + err.message : ""}`);
      return;
    }
    C.setScore(loaded);
    ui.selection = null; ui.selAnchor = null; ui.cursorId = null; ui.lastPitch = null;
    ui.speedy = false; ui.speedyStep = null; clearSpeedyHeld();
    stopPlayback();
    update();
    if (report && report.length) {
      showImportReport(name, loaded, report);
    } else {
      toast(`"${loaded.meta.title || name}" 불러왔어요`);
    }
  }

  function showImportReport(name, score, report) {
    $("#imp-summary").textContent =
      `"${score.meta.title || name}" — ${score.measures.length}마디를 가져왔어요. ` +
      `아래 항목은 이 앱이 지원하는 범위로 줄이면서 바뀌거나 무시됐어요.`;
    $("#imp-list").innerHTML = report.map(r => `<li>${r.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("");
    $("#dlg-import").showModal();
  }

  /* 드래그&드롭으로 열기 */
  function bindDragDrop() {
    const canvas = $("#canvas");
    let depth = 0;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    canvas.addEventListener("dragenter", (e) => { stop(e); depth++; canvas.classList.add("droppable"); });
    canvas.addEventListener("dragover", stop);
    canvas.addEventListener("dragleave", (e) => { stop(e); if (--depth <= 0) { depth = 0; canvas.classList.remove("droppable"); } });
    canvas.addEventListener("drop", (e) => {
      stop(e);
      depth = 0;
      canvas.classList.remove("droppable");
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.(json|musicxml|xml|mxl|mid|midi)$/i.test(file.name)) {
        toast("악보 파일(.json/.musicxml/.mxl/.mid)을 끌어다 놓아주세요");
        return;
      }
      IO.loadScoreFile(file, (...args) => { if (args[0]) setReadOnly(false); handleLoadedScore(...args); });
    });
  }

  /* ---------------- 메뉴/다이얼로그 ---------------- */
  function bindMenu() {
    const menu = $("#file-menu");
    $("#btn-file").addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    document.addEventListener("click", () => menu.classList.remove("open"));
    menu.addEventListener("click", async (e) => {
      const item = e.target.closest("[data-act]");
      if (!item) return;
      menu.classList.remove("open");
      const act = item.dataset.act;
      const score = C.state.score;
      if (act === "new") {
        if (!await SF.ui.confirmDialog({ title: "새 악보", message: "새 악보를 만들까요? 현재 작업을 보관하려면 파일로 저장해 주세요.", confirmText: "새 악보 만들기", danger: true })) return;
        setReadOnly(false);
        C.setScore(C.createScore({}));
        ui.selection = null; ui.cursorId = null; ui.lastPitch = null;
        ui.speedy = false; ui.speedyStep = null; clearSpeedyHeld();
        stopPlayback(); update();
        openSettings();
      } else if (act === "open") {
        IO.openScoreDialog((...args) => { if (args[0]) setReadOnly(false); handleLoadedScore(...args); });
      } else if (act === "save") {
        saveScore();
      } else if (act === "musicxml") {
        IO.download(IO.safeName(score.meta.title) + ".musicxml", IO.exportMusicXML(score), "application/vnd.recordare.musicxml+xml");
        toast("MusicXML로 내보냈어요 — MuseScore에서 열 수 있어요");
      } else if (act === "midi") {
        IO.download(IO.safeName(score.meta.title) + ".mid", P.exportMidi(score), "audio/midi");
        toast("MIDI 파일을 내려받았어요");
      } else if (act === "print") {
        SF.exportUI.print();
      } else if (act === "svg" || act === "png") {
        SF.exportUI.download(act);
      } else if (act === "manual-quick") {
        window.open("manual/scoreforge_quick_start_user_manual.html", "_blank", "noopener");
        toast("퀵스타트 설명서를 새 탭으로 열었어요");
      } else if (act === "manual-user") {
        window.open("manual/scoreforge_user_manual.html", "_blank", "noopener");
        toast("유저 매뉴얼을 새 탭으로 열었어요");
      } else if (act.startsWith("demo-")) {
        const key = act.slice(5);
        if (IO.DEMOS[key]) {
          setReadOnly(false);
          C.setScore(IO.DEMOS[key]());
          ui.selection = null; ui.cursorId = null;
          ui.speedy = false; ui.speedyStep = null; clearSpeedyHeld();
          stopPlayback(); update();
          toast("데모 악보를 불러왔어요 — 스페이스로 재생해 보세요");
        }
      }
    });
  }

  function maybeShowWelcome() {
    const seen = localStorage.getItem("scoreforge.welcomed");
    if (!seen) {
      $("#dlg-welcome").showModal();
    }
  }
  function bindWelcome() {
    $("#dlg-welcome").addEventListener("close", () => {
      localStorage.setItem("scoreforge.welcomed", "1");
    });
    $$("#dlg-welcome [data-start]").forEach(btn => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.start;
        if (k === "blank") {
          C.setScore(C.createScore({}));
          $("#dlg-welcome").close();
          openSettings();
        } else if (IO.DEMOS[k]) {
          C.setScore(IO.DEMOS[k]());
          $("#dlg-welcome").close();
          update();
          toast("스페이스 키로 재생해 보세요!");
        }
        ui.selection = null; ui.cursorId = null;
        update();
      });
    });
  }

  /* ---------------- 단축키 ---------------- */
  function moveSelection(dir, extend) {
    const score = C.state.score;
    if (ui.inputMode || ui.speedy) {
      // 입력 커서 이동
      const pos = cursorPos();
      const f = pos.found;
      const nx = dir > 0 ? C.nextEvent(score, f.m, f.e, f) : C.prevEvent(score, f.m, f.e, f);
      if (nx) { ui.cursorId = nx.ev.id; refreshCursor(); updateStatus(); }
      return;
    }
    let found = selectedEvent();
    if (!found) {
      const ref = C.activeRef(score);
      select(firstEventIdForVoice(ref, ui.currentVoice));
      return;
    }
    const nx = dir > 0 ? C.nextEvent(score, found.m, found.e, found) : C.prevEvent(score, found.m, found.e, found);
    if (nx) select(nx.ev.id, { extend });
  }

  function afterHistory() {
    if (ui.selection && !C.findEvent(C.state.score, ui.selection)) { ui.selection = null; ui.selAnchor = null; }
    if (ui.selAnchor && !C.findEvent(C.state.score, ui.selAnchor)) ui.selAnchor = ui.selection;
    if (ui.cursorId && !C.findEvent(C.state.score, ui.cursorId)) ui.cursorId = null;
    update();
  }

  /* ---------------- 버튼 바인딩 ---------------- */
  function bindThemePicker() {
    const picker = $("#theme-select");
    if (!picker) return;
    picker.addEventListener("change", () => {
      const next = picker.value;
      applyTheme(next);
      saveTheme(next);
    });
  }

  function bindButtons() {
    $("#btn-input").addEventListener("click", () => setInputMode(!ui.inputMode));
    $("#btn-speedy").addEventListener("click", () => toggleSpeedy(!ui.speedy));
    $("#btn-undo").addEventListener("click", () => { C.undo(); afterHistory(); });
    $("#btn-redo").addEventListener("click", () => { C.redo(); afterHistory(); });
    $("#btn-play").addEventListener("click", togglePlay);
    $("#btn-stop").addEventListener("click", stopPlayback);
    $("#btn-rewind").addEventListener("click", () => { pausedAt = 0; ui.selection = null; if (P.player.playing) startPlayback(0); else update(); });
    $("#btn-metronome").addEventListener("click", () => {
      P.player.metronome = !P.player.metronome;
      refreshToolbar();
      toast(P.player.metronome ? "메트로놈 켜짐" : "메트로놈 꺼짐");
    });
    $("#btn-dot").addEventListener("click", toggleDot);
    $("#btn-rest").addEventListener("click", () => {
      if (!ui.inputMode) setInputMode(true);
      ui.restMode = !ui.restMode;
      refreshToolbar(); updateStatus();
    });
    $("#btn-sharp").addEventListener("click", () => applyAccidental(1));
    $("#btn-flat").addEventListener("click", () => applyAccidental(-1));
    $("#btn-natural").addEventListener("click", () => applyAccidental(0));
    $$("#voice-buttons .voice-btn").forEach(btn => btn.addEventListener("click", () => setCurrentVoice(+btn.dataset.voice)));
    $$("#drum-pad .drum-btn").forEach(btn => btn.addEventListener("click", () => inputDrum(btn.dataset.drum)));
    $("#btn-tie").addEventListener("click", toggleTie);
    $("#btn-grace").addEventListener("click", applyGraceBefore);
    $("#btn-slur").addEventListener("click", toggleSlur);
    $$(".artic-btn").forEach(b => b.addEventListener("click", () => applyArticulation(b.dataset.artic)));
    $$(".dynbtn").forEach(b => b.addEventListener("click", () => applyDynamic(b.dataset.dyn)));
    $("#btn-cresc").addEventListener("click", () => toggleHairpin("cresc"));
    $("#btn-dim").addEventListener("click", () => toggleHairpin("dim"));
    $("#btn-lyric").addEventListener("click", () => {
      const found = selectedEvent() || targetEvent();
      if (found && found.ev.type === "note") { ui.selection = found.ev.id; update(); editLyric(found.ev.id); }
      else flashHint("가사를 붙일 음표를 먼저 선택하세요");
    });
    $("#btn-chord-symbol").addEventListener("click", applyChordSymbol);
    $("#btn-tempo-mark").addEventListener("click", applyTempoMark);
    $("#btn-rehearsal").addEventListener("click", applyRehearsalMark);
    $("#btn-staff-text").addEventListener("click", applyStaffText);
    $("#btn-gliss").addEventListener("click", () => toggleNotation("glissando"));
    $("#btn-arpeggio").addEventListener("click", () => toggleNotation("arpeggiate"));
    $("#btn-tremolo").addEventListener("click", () => toggleNotation("tremolo"));
    $("#btn-repeat-start").addEventListener("click", applyStartRepeat);
    $("#btn-repeat-end").addEventListener("click", applyEndRepeat);
    $("#btn-repeat-count").addEventListener("click", applyRepeatCount);
    $("#btn-volta-1").addEventListener("click", () => applyVolta("1"));
    $("#btn-volta-2").addEventListener("click", () => applyVolta("2"));
    $("#btn-break-system").addEventListener("click", () => applyMeasureBreak("system"));
    $("#btn-break-page").addEventListener("click", () => applyMeasureBreak("page"));
    $("#btn-break-section").addEventListener("click", () => applyMeasureBreak("section"));
    $("#btn-delete").addEventListener("click", deleteSelection);
    $("#btn-piano").addEventListener("click", () => {
      ui.pianoVisible = !ui.pianoVisible;
      refreshToolbar(); applyZoom();
    });
    $("#btn-midi").addEventListener("click", () => {
      ui.midiEnabled = !ui.midiEnabled;
      refreshToolbar();
      toast(ui.midiEnabled ? "MIDI 입력 켜짐" : "MIDI 입력 꺼짐");
    });
    $("#midi-select").addEventListener("change", () => connectMidiInput($("#midi-select").value));
    $("#btn-help").addEventListener("click", () => $("#dlg-help").showModal());
    $("#btn-zoom-in").addEventListener("click", () => { ui.zoom = Math.min(2.4, ui.zoom + 0.15); applyZoom(); });
    $("#btn-zoom-out").addEventListener("click", () => { ui.zoom = Math.max(0.5, ui.zoom - 0.15); applyZoom(); });

    $("#tempo-input").addEventListener("change", () => {
      const v = Math.max(30, Math.min(280, +$("#tempo-input").value || 100));
      if (v === C.state.score.tempo) return;
      C.mutate("빠르기", (s2) => { s2.tempo = v; }, { coalesce: "tempo" });
      stopPlayback(); update();
    });
    $("#swing-select").addEventListener("change", () => {
      const val = $("#swing-select").value;
      C.mutate("스윙", (s2) => {
        C.ensureParts(s2);
        s2.playbackSettings.swing = val;
      });
      stopPlayback(); update();
    });
    $("#instrument-select").addEventListener("change", () => {
      const ref = C.activeRef(C.state.score);
      C.mutate("악기", (s2) => {
        const r = C.staffRef(s2, ref);
        r.part.instrument = $("#instrument-select").value;
        if (r.partIdx === 0) s2.instrument = r.part.instrument;
      });
      if (P.ensureSampleInstrument) P.ensureSampleInstrument($("#instrument-select").value);
      P.previewNote([60, 64, 67], 0.5);
      update();
    });

    // 캔버스 이벤트(위임)
    const canvas = $("#canvas");
    canvas.addEventListener("pointermove", onCanvasMove);
    canvas.addEventListener("pointerleave", () => E.drawGhost(null));
    canvas.addEventListener("click", (e) => {
      if ((ui.dragging && ui.dragging.moved) || performance.now() < (ui.suppressClickUntil || 0)) return;
      if (e.target.closest("#lyric-editor")) return;
      onCanvasClick(e);
    });
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("dblclick", (e) => {
      const refEl = e.target.closest && e.target.closest("[data-ref]");
      if (refEl && !ui.inputMode) {
        const id = refEl.getAttribute("data-ref");
        const found = C.findEvent(C.state.score, id);
        if (e.target.closest(".chord-symbol")) {
          ui.selection = id; update(); editChordSymbol(id); return;
        }
        if (found && found.ev.type === "note") { ui.selection = id; update(); editLyric(id); }
      }
    });
    canvas.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      ui.zoom = Math.max(0.5, Math.min(2.4, ui.zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
      applyZoom();
    }, { passive: false });

    // 제목/작곡가 인라인 편집
    for (const [sel, key] of [["#t-title", "title"], ["#t-composer", "composer"]]) {
      const el = $(sel);
      el.addEventListener("click", () => {
        if (C.state.readOnly || el.isContentEditable) return;
        el.contentEditable = "plaintext-only";
        el.focus();
        const range = document.createRange(); range.selectNodeContents(el);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      });
      el.addEventListener("blur", () => {
        if (!el.isContentEditable) return;
        el.contentEditable = "false";
        const v = el.textContent.trim();
        if (v !== (C.state.score.meta[key] || "")) {
          C.mutate("제목/작곡가", (s2) => { s2.meta[key] = v; });
          update();
        }
      });
      el.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); el.blur(); }
        if (e.key === "Escape") { el.textContent = C.state.score.meta[key] || ""; el.blur(); }
      });
    }
    // 작곡가 영역이 비어 숨겨질 때를 위한 더블클릭 영역
    $("#paper-head").addEventListener("dblclick", (e) => {
      if (e.target.id === "paper-head") openSettings();
    });

    window.addEventListener("resize", applyZoom);
  }

  /* ---------------- 시작 ---------------- */
  function start() {
    applyTheme(loadTheme(), { silent: true });
    SF.palette.init();
    SF.ui.init();
    buildToolbar();
    SF.palette.quickAccess();
    buildPiano();
    bindThemePicker();
    bindButtons();
    SF.auth?.bindAuth();
    bindShortcutOverlay();
    bindMenu();
    bindSettings();
    bindWelcome();
    bindKeys();
    bindDragDrop();
    bindMixer();
    bindCommandPalette();
    bindProperties();
    bindNavigationPanels();
    initMidi();

    const saved = IO.loadAutosave();
    if (saved) {
      C.setScore(saved);
      toast("이전 작업을 자동으로 불러왔어요");
    } else {
      C.setScore(IO.DEMOS.butterfly());
    }
    C.onChange((score, event) => {
      if (["saved", "autosaved"].includes(event?.type)) { refreshToolbar(); return; }
      changeRevision = C.state.revision; update();
      if (["mutate", "undo", "redo"].includes(event?.type)) scheduleAutosave();
      if (event?.type === "setScore") { clearTimeout(saveTimer); SF.cloud?.onScoreLoaded(score); }
    });
    changeRevision = C.state.revision;
    C.state.dirty = false;
    SF.uiV3.init(api);
    SF.exportUI.init(api);
    window.addEventListener("scoreforge:language", () => update());
    Promise.resolve(SF.auth?.init()).then(() => SF.cloud?.init()); SF.pwa?.init(); SF.i18n?.init();
    window.addEventListener("beforeunload", e => { if (C.state.dirty && !C.isAutosaved()) { e.preventDefault(); e.returnValue = ""; } });
    if (matchMedia("(max-width: 900px)").matches) $("#properties-panel").classList.add("collapsed");
    SF.cloud?.onScoreLoaded(C.state.score);
    update({ immediate: true });
    maybeShowWelcome();

    E.loadFont(() => update({ force: true })); // Bravura 로드되면 다시 그림
  }

  const api = { C, E, P, IO, Fraction, ui, $, $$, getLayoutCache: () => layoutCache, loadTheme, saveTheme, themeLabel, applyTheme, relayout, repaint, refreshChrome, update, scheduleAutosave, saveScore, setReadOnly, refreshCursor, applyZoom, svgPoint, select, selectedEvent, selectedIds, rangeNoteEnds, targetEvent, buildTimeline, startPlayback, playFromSelection, autoScroll, togglePlay, stopPlayback, buildToolbar, refreshToolbar, updateStatus, durName2, toast, flashHint, handleLoadedScore, showImportReport, bindDragDrop, bindMenu, maybeShowWelcome, bindWelcome, moveSelection, afterHistory, bindThemePicker, bindButtons, start };
  for (const module of [SF.input, SF.editing, SF.panels, SF.keymap]) Object.assign(api, module.create(api));
  const { activeRef, activeCtx, firstEventIdForVoice, setCurrentVoice, setActiveStaff, effectiveAlter, pitchFromStep, nearestOctave, findEventAtTick, advancePos, measureCountForEnd, ensureMeasureCount, clonePlain, cloneDurForPaste, selectionItems, copySelection, decoratePastedEvent, pasteClipboard, doInput, mirrorLinkedTab, inputDrum, inputMidiPitches, initMidi, refreshMidiDevices, connectMidiInput, onMidiMessage, pitchForStepLabel, previewSpeedyStep, doSpeedyInput, toggleSpeedyDot, addSpeedyChordTone, speedyDeleteAt, clearSpeedyHeld, setSpeedyHeld, cursorPos, initSpeedyMidi, toggleSpeedy, setInputMode, inputLetter, onCanvasMove, onCanvasClick, clampStep, onPointerDown, onPointerMove, onPointerUp, editLyric, editChordSymbol, buildPiano, setDuration, canDot, toggleDot, applyAccidental, transposeSelection, deleteSelection, repitchSelection, toggleTie, applyArticulation, applyDynamic, toggleSlur, toggleHairpin, applyTuplet, applyGraceBefore, toggleNotation, markerTarget, selectedMeasureRange, applyStartRepeat, applyEndRepeat, applyRepeatCount, applyVolta, applyChordSymbol, applyTempoMark, nextRehearsalMark, applyRehearsalMark, applyStaffText, htmlEsc, checked, selectedPropIds, firstSelectedRef, renderPropertiesPanel, mutateSelectedEvents, applyPropertyInput, applyMeasureBreak, bindProperties, refreshOpenOverlays, scrollToMeasure, renderNavigator, measureDensity, renderTimelinePanel, openNavigator, openTimelinePanel, gotoQuery, bindNavigationPanels, r1, mixerRecord, renderMixerRows, updateMixerValue, bindMixer, openSettings, bindSettings, bindKeys, bindShortcutOverlay, bindCommandPalette, openCommandPalette, closeShortcutOverlay, isShortcutOverlayOpen } = api;
  for (const method of ["undo", "redo"]) {
    const historyAction = C[method];
    C[method] = (...args) => C.state.readOnly ? false : historyAction(...args);
  }
  const coreMutate = C.mutate;
  C.mutate = (label, fn, opts) => {
    if (C.state.readOnly) { toast("읽기 전용 악보예요. 사본을 만들어 편집하세요."); return; }
    return coreMutate(label, fn, opts);
  };
  SF.app = { ui, update, relayout, repaint, refreshChrome, toast, handleLoadedScore, setReadOnly,
    actions: api, registerCommand: command => SF.keymap.registerCommand(command), auth: SF.auth?.state };
  document.addEventListener("DOMContentLoaded", start);
})(window.SF);
