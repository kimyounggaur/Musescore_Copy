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
    selection: null,      // 이벤트 id (포커스)
    selAnchor: null,      // 범위 선택의 기준점 (Shift+클릭/화살표)
    cursorId: null,       // 입력 커서가 가리키는 이벤트 id
    lastInsertedId: null,
    lastPitch: null,      // 옥타브 추론 기준
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
  let clip = null; // 내부 악보 클립보드
  let midiAccess = null;
  let midiInput = null;
  let midiBuffer = [];
  let midiTimer = null;
  const THEME_KEY = "scoreforge-ui-theme";
  const THEMES = new Set(["dark", "light", "pretty", "cute"]);
  const SUPABASE_URL_KEY = "scoreforge.supabase.url";
  const SUPABASE_KEY_KEY = "scoreforge.supabase.publishableKey";
  const AUTH_MODES = {
    signup: {
      title: "회원가입",
      submit: "회원가입",
      message: "이메일과 비밀번호로 새 계정을 만들어요. 이메일 확인이 켜져 있으면 인증 메일 확인 뒤 로그인됩니다.",
      showName: true,
    },
    member: {
      title: "회원 로그인",
      submit: "회원 로그인",
      message: "가입한 회원 계정으로 로그인합니다.",
      showName: false,
    },
    admin: {
      title: "관리자 로그인",
      submit: "관리자 로그인",
      message: "관리자 페이지는 profiles.role 값이 admin인 계정만 열 수 있어요.",
      showName: false,
    },
  };
  const authState = {
    client: null,
    configSig: "",
    mode: "member",
    session: null,
    profile: null,
    authSub: null,
  };

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
    document.documentElement.style.colorScheme = next === "dark" ? "dark" : "light";
    const picker = $("#theme-select");
    if (picker) picker.value = next;
    if (!opts.silent) toast(`${themeLabel(next)}로 전환했어요`);
  }

  /* ---------------- 렌더 ---------------- */
  let layoutCache = null;
  function update(opts = {}) {
    const score = C.state.score;
    const res = E.render(score, { selection: selectedIds(), viewMode: ui.viewMode, hideEmptyStaves: ui.hideEmptyStaves, activeVoice: ui.currentVoice });
    layoutCache = res.layout;
    $("#svg-host").innerHTML = res.svg;
    $("#t-title").textContent = score.meta.title || "제목 없음";
    $("#t-composer").textContent = score.meta.composer || "";
    $("#t-composer").style.display = score.meta.composer ? "" : "none";
    applyZoom();
    refreshToolbar();
    refreshCursor();
    updateStatus();
    renderPropertiesPanel();
    refreshOpenOverlays();
    if (!opts.noSave) IO.autosave(score);
  }

  function refreshCursor() {
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
    const svg = $("#score-svg");
    const h = svg ? svg.viewBox.baseVal.height : 600;
    const headH = $("#paper-head").offsetHeight;
    wrap.querySelector(".paper-sizer").style.height = (h + headH + 70) * s + "px";
    wrap.querySelector(".paper-sizer").style.width = pageW * s + "px";
    $("#zoom-label").textContent = Math.round(ui.zoom * 100) + "%";
  }

  /* ---------------- 좌표 변환 ---------------- */
  function svgPoint(evt) {
    const svg = $("#score-svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return null;
    return {
      x: (evt.clientX - r.left) / r.width * (E.pageWidth ? E.pageWidth(C.state.score) : E.PAGE_W),
      y: (evt.clientY - r.top) / r.height * svg.viewBox.baseVal.height,
    };
  }

  /* ---------------- 입력 도우미 ---------------- */
  function activeRef() { return C.activeRef(C.state.score); }
  function activeCtx() { return { ...activeRef(), voice: ui.currentVoice }; }
  function firstEventIdForVoice(ref, voice = ui.currentVoice) {
    const evs = C.getVoiceEvents(ref.measures[0], voice, C.state.score);
    return evs[0]?.id || ref.measures[0]?.events?.[0]?.id || null;
  }
  function setCurrentVoice(voice, opts = {}) {
    ui.currentVoice = C.normalizeVoice(voice);
    C.state.currentVoice = ui.currentVoice;
    if (!opts.keepCursor) {
      const found = ui.cursorId && C.findEvent(C.state.score, ui.cursorId);
      const ref = found || activeRef();
      const measure = ref.measures?.[found?.m || 0] || activeRef().measures[0];
      ui.cursorId = C.getVoiceEvents(measure, ui.currentVoice, C.state.score)[0]?.id || firstEventIdForVoice(activeRef(), ui.currentVoice);
      ui.selection = null; ui.selAnchor = null;
    }
    update();
  }
  function setActiveStaff(partIdx, staffIdx, opts = {}) {
    C.setActiveStaff(C.state.score, partIdx, staffIdx);
    if (!opts.keepCursor) {
      const ref = C.activeRef(C.state.score);
      ui.cursorId = firstEventIdForVoice(ref, ui.currentVoice);
    }
    refreshToolbar();
    updateStatus();
  }
  function effectiveAlter(score, mIdx, beforeId, step, oct, ctx) {
    let alter = C.keyAlterFor(step, score.keySig);
    const evs = C.getVoiceEvents(C.staffMeasures(score, ctx)[mIdx], ctx?.voice || ui.currentVoice, score);
    for (const ev of evs) {
      if (ev.id === beforeId) break;
      if (ev.type !== "note") continue;
      for (const n of ev.notes) if (n.step === step && n.oct === oct) alter = n.alter;
    }
    return alter;
  }

  function pitchFromStep(score, mIdx, beforeId, as, ctx) {
    const step = ((as % 7) + 7) % 7;
    const oct = Math.floor(as / 7);
    return { step, oct, alter: effectiveAlter(score, mIdx, beforeId, step, oct, ctx) };
  }

  function nearestOctave(step, refPitch) {
    if (!refPitch) {
      const mid = C.CLEFS[C.activeClef(C.state.score)].middle;
      refPitch = { step: mid.step, oct: mid.oct };
    }
    const refAs = C.absStep(refPitch);
    let best = null, bestD = Infinity;
    for (let oct = refPitch.oct - 1; oct <= refPitch.oct + 1; oct++) {
      const d = Math.abs(oct * 7 + step - refAs);
      if (d < bestD) { bestD = d; best = oct; }
    }
    return best;
  }

  function findEventAtTick(score, mIdx, tick, ctx) {
    const L = C.measureLen(score);
    while (tick.gte(L)) {
      tick = tick.sub(L); mIdx++;
      if (mIdx >= C.staffMeasures(score, ctx).length) return null;
    }
    const evs = C.getVoiceEvents(C.staffMeasures(score, ctx)[mIdx], ctx?.voice || ui.currentVoice, score);
    let t = Fraction.ZERO;
    for (const ev of evs) {
      const end = t.add(C.durValue(ev.dur));
      if (tick.gte(t) && tick.lt(end)) return ev.id;
      t = end;
    }
    return null;
  }

  function advancePos(score, mIdx, tick, len) {
    const L = C.measureLen(score);
    let t = tick.add(len), m = mIdx;
    while (t.gte(L)) { t = t.sub(L); m++; }
    return { mIdx: m, tick: t };
  }

  function measureCountForEnd(score, endPos) {
    return endPos.tick.isZero() ? endPos.mIdx : endPos.mIdx + 1;
  }

  function ensureMeasureCount(score, count) {
    if (count <= 0) return;
    C.ensureParts(score);
    for (const ref of C.staffRefs(score)) {
      while (ref.measures.length < count) ref.measures.push({ events: [C.fullRest(score)] });
    }
    score.measures = C.staffRefs(score)[0]?.measures || score.measures;
  }

  function clonePlain(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function cloneDurForPaste(dur, tupletIds) {
    const out = clonePlain(dur);
    if (out.tuplet && out.tuplet.id) {
      if (!tupletIds.has(out.tuplet.id)) tupletIds.set(out.tuplet.id, C.newId());
      out.tuplet.id = tupletIds.get(out.tuplet.id);
    }
    return out;
  }

  function selectionItems() {
    const ids = selectedIds();
    if (!ids || !ids.size) return null;
    const found = [...ids].map(id => C.findEvent(C.state.score, id)).filter(Boolean);
    if (!found.length) return null;
    const first = found[0];
    if (found.some(f => f.partIdx !== first.partIdx || f.staffIdx !== first.staffIdx)) return { mixed: true };
    found.sort((a, b) => a.m - b.m || a.voice - b.voice || a.e - b.e);
    return {
      partIdx: first.partIdx,
      staffIdx: first.staffIdx,
      name: first.name,
      items: found.map(f => {
        const ev = clonePlain(f.ev);
        delete ev.id;
        delete ev.full;
        return ev;
      }),
    };
  }

  function copySelection(opts = {}) {
    const pack = selectionItems();
    if (!pack) { flashHint("복사할 음표나 쉼표를 먼저 선택하세요"); return false; }
    if (pack.mixed) { flashHint("복사는 한 보표 안의 범위에서만 할 수 있어요"); return false; }
    clip = {
      items: pack.items,
      total: pack.items.reduce((a, ev) => a.add(C.durValue(ev.dur)), Fraction.ZERO),
      label: pack.name,
    };
    if (!opts.quiet) toast(`${clip.items.length}개를 복사했어요`);
    return true;
  }

  function decoratePastedEvent(score, id, src) {
    const f = id && C.findEvent(score, id);
    if (!f) return;
    if (src.graceBefore && src.graceBefore.length) f.ev.graceBefore = C.cloneGraceList(src.graceBefore); else delete f.ev.graceBefore;
    if (src.lyric) f.ev.lyric = src.lyric; else delete f.ev.lyric;
    if (src.lyrics && src.lyrics.length) {
      f.ev.lyrics = C.cloneLyrics(src.lyrics);
      C.normalizeEventLyrics(f.ev);
    } else delete f.ev.lyrics;
    if (src.dynamic) f.ev.dynamic = src.dynamic; else delete f.ev.dynamic;
    if (src.artics && src.artics.length) f.ev.artics = [...src.artics]; else delete f.ev.artics;
    if (src.tempo) f.ev.tempo = src.tempo; else delete f.ev.tempo;
    if (src.rehearsal) f.ev.rehearsal = src.rehearsal; else delete f.ev.rehearsal;
    if (src.staffText) f.ev.staffText = src.staffText; else delete f.ev.staffText;
    if (src.soundFlag) f.ev.soundFlag = src.soundFlag; else delete f.ev.soundFlag;
    if (src.chordSymbol) f.ev.chordSymbol = C.cloneChordSymbol(src.chordSymbol); else delete f.ev.chordSymbol;
    if (src.fretboard) f.ev.fretboard = clonePlain(src.fretboard); else delete f.ev.fretboard;
    if (src.type === "note" && f.ev.type === "note") {
      for (let i = 0; i < f.ev.notes.length; i++) {
        f.ev.notes[i].tie = !!(f.ev.notes[i].tie || src.notes?.[i]?.tie);
      }
    }
  }

  function pasteClipboard() {
    if (!clip || !clip.items.length) { flashHint("붙여넣을 악보 조각이 없어요"); return; }
    const score = C.state.score;
    let target = null;
    if (ui.inputMode) target = cursorPos().found;
    else target = selectedEvent() || targetEvent();
    if (!target) {
      const ref = activeRef();
      const ev = C.getVoiceEvents(ref.measures[0], ui.currentVoice, score)[0] || ref.measures[0].events[0];
      target = { ...ref, voice: ui.currentVoice, m: 0, e: 0, ev };
    }
    const startTick = C.eventStartTick(target.measures[target.m], target.e, target);
    const ctx = { partIdx: target.partIdx, staffIdx: target.staffIdx, voice: target.voice || ui.currentVoice };
    const endPos = advancePos(score, target.m, startTick, clip.total);
    const needed = measureCountForEnd(score, endPos);
    const pastedIds = [];

    C.mutate("붙여넣기", (s2) => {
      ensureMeasureCount(s2, needed);
      C.setActiveStaff(s2, ctx.partIdx, ctx.staffIdx);
      const tupletIds = new Map();
      let pos = { mIdx: target.m, tick: startTick };
      const touched = new Set();
      for (const src of clip.items) {
        const dur = cloneDurForPaste(src.dur, tupletIds);
        const pitches = src.type === "note" ? src.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })) : null;
        const firstId = C.inputAt(s2, pos.mIdx, pos.tick, dur, pitches, { ...ctx, voice: src.voice || ctx.voice });
        if (firstId) {
          pastedIds.push(firstId);
          decoratePastedEvent(s2, firstId, src);
        }
        touched.add(pos.mIdx);
        pos = advancePos(s2, pos.mIdx, pos.tick, C.durValue(dur));
        touched.add(Math.max(0, pos.mIdx - (pos.tick.isZero() ? 1 : 0)));
      }
      for (const m of touched) if (m >= 0 && m < C.staffMeasures(s2, ctx).length) C.consolidateRests(s2, m, ctx);
      C.normalizeTies(s2);
    });
    if (pastedIds.length) {
      ui.selection = pastedIds[0];
      ui.selAnchor = pastedIds[pastedIds.length - 1] || pastedIds[0];
      ui.cursorId = pastedIds[pastedIds.length - 1] || pastedIds[0];
      ui.lastInsertedId = ui.cursorId;
    }
    update();
    toast(`${clip.items.length}개를 붙여넣었어요`);
  }

  /* 입력 실행 (커서/세그먼트 위치에) */
  function doInput(mIdx, tick, pitches, ctx = activeCtx()) {
    const dur = { ...ui.curDur };
    let inserted = null;
    C.mutate(pitches ? "음표 입력" : "쉼표 입력", (score) => {
      C.setActiveStaff(score, ctx.partIdx, ctx.staffIdx);
      inserted = C.inputAt(score, mIdx, tick, dur, pitches, { ...ctx, voice: ui.currentVoice });
      if (inserted && pitches && pitches.length) mirrorLinkedTab(score, ctx, mIdx, tick, dur, pitches, inserted);
    });
    ui.lastInsertedId = inserted;
    if (pitches && pitches.length) {
      ui.lastPitch = pitches[pitches.length - 1];
      P.previewNote(pitches.map(C.midiOf), 0.35);
    }
    // 커서 전진
    const nextTick = tick.add(C.durValue(dur));
    const nid = findEventAtTick(C.state.score, mIdx, nextTick, ctx);
    ui.cursorId = nid || inserted;
    ui.selection = null;
    update();
    flashHint(pitches ? null : "쉼표를 입력했어요");
  }

  function mirrorLinkedTab(score, ctx, mIdx, tick, dur, pitches, insertedId) {
    const ref = C.staffRef(score, ctx);
    if (ref.part.instrument !== "guitar" || !ref.staff.linkedStaffId) return;
    const allRefs = C.staffRefs(score);
    const linked = allRefs.find(r => r.staff.id === ref.staff.linkedStaffId);
    const primary = insertedId && C.findEvent(score, insertedId);
    if (primary) C.applyTabToEvent(primary.ev, ref.part);
    if (!linked) return;
    const linkedId = C.inputAt(score, mIdx, tick, dur, pitches, { partIdx: linked.partIdx, staffIdx: linked.staffIdx, voice: ui.currentVoice });
    const linkedFound = linkedId && C.findEvent(score, linkedId);
    if (linkedFound) C.applyTabToEvent(linkedFound.ev, linked.part);
  }

  function inputDrum(drumId) {
    const ref = activeRef();
    if (!C.isPercussionRef(ref)) {
      flashHint("드럼 키트 보표를 선택하면 드럼 패드를 사용할 수 있어요");
      return false;
    }
    if (!ui.inputMode) setInputMode(true);
    const pos = cursorPos();
    let inserted = null;
    C.mutate("드럼 입력", (score) => {
      C.setActiveStaff(score, ref.partIdx, ref.staffIdx);
      inserted = C.addDrumNote(score, pos.mIdx, pos.tick, drumId, { ...ui.curDur }, { ...ref, voice: ui.currentVoice });
    });
    const spec = C.drumSpec(drumId);
    ui.lastInsertedId = inserted;
    ui.cursorId = findEventAtTick(C.state.score, pos.mIdx, pos.tick.add(C.durValue(ui.curDur)), { ...ref, voice: ui.currentVoice }) || inserted;
    ui.selection = null;
    P.previewNote([spec.midi], 0.22);
    update();
    return true;
  }

  function inputMidiPitches(midis) {
    if (!ui.inputMode) setInputMode(true);
    const pitches = [...new Set(midis)].sort((a, b) => a - b).map(m => C.spellMidi(m, C.state.score.keySig));
    if (!pitches.length) return;
    const pos = cursorPos();
    doInput(pos.mIdx, pos.tick, pitches, activeCtx());
  }

  async function initMidi() {
    const btn = $("#btn-midi"), sel = $("#midi-select");
    if (!navigator.requestMIDIAccess) {
      btn.disabled = true;
      sel.innerHTML = `<option>Web MIDI 없음</option>`;
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      refreshMidiDevices();
      midiAccess.onstatechange = refreshMidiDevices;
    } catch (err) {
      btn.disabled = true;
      sel.innerHTML = `<option>MIDI 권한 필요</option>`;
    }
  }
  function refreshMidiDevices() {
    const sel = $("#midi-select");
    if (!sel || !midiAccess) return;
    const inputs = [...midiAccess.inputs.values()];
    sel.innerHTML = inputs.length ? inputs.map(input => `<option value="${input.id}">${input.name || "MIDI Input"}</option>`).join("") : `<option value="">장치 없음</option>`;
    if (inputs.length && !midiInput) connectMidiInput(inputs[0].id);
  }
  function connectMidiInput(id) {
    if (midiInput) midiInput.onmidimessage = null;
    midiInput = midiAccess ? midiAccess.inputs.get(id) : null;
    if (midiInput) midiInput.onmidimessage = onMidiMessage;
  }
  function onMidiMessage(e) {
    if (!ui.midiEnabled) return;
    const [status, note, velocity] = e.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && velocity > 0) {
      midiBuffer.push(note);
      clearTimeout(midiTimer);
      midiTimer = setTimeout(() => {
        const notes = midiBuffer.slice();
        midiBuffer = [];
        inputMidiPitches(notes);
      }, 80);
    }
  }

  function cursorPos() {
    const score = C.state.score;
    let found = ui.cursorId && C.findEvent(score, ui.cursorId);
    const active = activeRef();
    if (found && (found.partIdx !== active.partIdx || found.staffIdx !== active.staffIdx || found.voice !== ui.currentVoice)) found = null;
    if (!found) {
      ui.cursorId = firstEventIdForVoice(active, ui.currentVoice);
      found = C.findEvent(score, ui.cursorId);
    }
    const tick = C.eventStartTick(found.measures[found.m], found.e, found);
    return { mIdx: found.m, tick, found };
  }

  /* ---------------- 선택 ---------------- */
  function select(id, opts = {}) {
    ui.selection = id;
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
    if (!ui.selection) return null;
    if (!ui.selAnchor || ui.selAnchor === ui.selection) return new Set([ui.selection]);
    const order = C.eventOrderMap(C.state.score);
    const a = order.get(ui.selAnchor), b = order.get(ui.selection);
    if (a === undefined || b === undefined) return new Set([ui.selection]);
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
    if (ui.inputMode && ui.lastInsertedId) return C.findEvent(C.state.score, ui.lastInsertedId);
    return null;
  }

  /* ---------------- 편집 동작 ---------------- */
  function setDuration(dur) {
    ui.curDur = { ...dur, dots: ui.curDur.dots && canDot(dur) ? ui.curDur.dots : 0 };
    const found = selectedEvent();
    if (found && !ui.inputMode) {
      const tick = C.eventStartTick(found.measures[found.m], found.e, found);
      const pitches = found.ev.type === "note" ? found.ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })) : null;
      const lyric = found.ev.lyric;
      const lyrics = C.cloneLyrics(found.ev);
      const chordSymbol = C.cloneChordSymbol(found.ev.chordSymbol);
      const fretboard = found.ev.fretboard ? clonePlain(found.ev.fretboard) : null;
      const soundFlag = found.ev.soundFlag || null;
      const graceBefore = C.cloneGraceList(found.ev.graceBefore);
      let inserted = null;
      C.mutate("음길이 변경", (score) => {
        inserted = C.inputAt(score, found.m, tick, { ...dur, dots: ui.curDur.dots }, pitches, found);
        if (lyric && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) f2.ev.lyric = lyric;
        }
        if (lyrics.length && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) { f2.ev.lyrics = C.cloneLyrics(lyrics); C.normalizeEventLyrics(f2.ev); }
        }
        if (chordSymbol && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) f2.ev.chordSymbol = C.cloneChordSymbol(chordSymbol);
        }
        if (fretboard && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) f2.ev.fretboard = clonePlain(fretboard);
        }
        if (soundFlag && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) f2.ev.soundFlag = soundFlag;
        }
        if (graceBefore.length && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) f2.ev.graceBefore = C.cloneGraceList(graceBefore);
        }
      });
      ui.selection = inserted;
    }
    update();
  }
  function canDot(dur) { return dur.d < 16; }

  function toggleDot() {
    const found = selectedEvent();
    if (found && !ui.inputMode) {
      const ev = found.ev;
      if (ev.full) return;
      const newDur = { n: ev.dur.n, d: ev.dur.d, dots: ev.dur.dots ? 0 : 1 };
      if (!canDot(newDur) && newDur.dots) return;
      const tick = C.eventStartTick(found.measures[found.m], found.e, found);
      const pitches = ev.type === "note" ? ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })) : null;
      const lyric = ev.lyric;
      const lyrics = C.cloneLyrics(ev);
      const chordSymbol = C.cloneChordSymbol(ev.chordSymbol);
      const fretboard = ev.fretboard ? clonePlain(ev.fretboard) : null;
      const soundFlag = ev.soundFlag || null;
      const graceBefore = C.cloneGraceList(ev.graceBefore);
      let inserted = null;
      C.mutate("점음표", (score) => {
        inserted = C.inputAt(score, found.m, tick, newDur, pitches, found);
        const f2 = inserted && C.findEvent(score, inserted);
        if (f2) {
          if (lyric) f2.ev.lyric = lyric;
          if (lyrics.length) { f2.ev.lyrics = C.cloneLyrics(lyrics); C.normalizeEventLyrics(f2.ev); }
          if (chordSymbol) f2.ev.chordSymbol = C.cloneChordSymbol(chordSymbol);
          if (fretboard) f2.ev.fretboard = clonePlain(fretboard);
          if (soundFlag) f2.ev.soundFlag = soundFlag;
          if (graceBefore.length) f2.ev.graceBefore = C.cloneGraceList(graceBefore);
        }
      });
      ui.selection = inserted;
      update();
    } else {
      if (!canDot(ui.curDur)) return;
      ui.curDur.dots = ui.curDur.dots ? 0 : 1;
      refreshToolbar();
    }
  }

  function applyAccidental(alter) {
    const found = targetEvent();
    if (!found || found.ev.type !== "note") { flashHint("먼저 음표를 선택하세요"); return; }
    C.mutate("임시표", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      for (const n of f.ev.notes) n.alter = alter;
      C.normalizeTies(score);
    });
    const f2 = C.findEvent(C.state.score, found.ev.id);
    if (f2) P.previewNote(f2.ev.notes.map(C.midiOf), 0.3);
    update();
  }

  function transposeSelection(semis) {
    const found = targetEvent();
    if (!found || found.ev.type !== "note") return;
    C.mutate("음높이 변경", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      f.ev.notes = f.ev.notes.map(n => {
        const p = C.transposePitch(n, semis, score.keySig);
        return { ...p, tie: n.tie };
      });
      C.normalizeTies(score);
    });
    const f2 = C.findEvent(C.state.score, found.ev.id);
    if (f2) {
      P.previewNote(f2.ev.notes.map(C.midiOf), 0.3);
      if (f2.ev.notes.length) ui.lastPitch = f2.ev.notes[0];
    }
    update();
  }

  function deleteSelection() {
    const ids = selectedIds();
    if (ids && ids.size > 1) {
      C.mutate("범위 삭제", (score) => {
        for (const id of ids) {
          const f = C.findEvent(score, id);
          if (f) C.deleteEvent(score, f.m, f.e, f);
        }
      });
      ui.selection = null; ui.selAnchor = null;
      update();
      return;
    }
    const found = selectedEvent() || targetEvent();
    if (!found) return;
    C.mutate("삭제", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (f) C.deleteEvent(score, f.m, f.e, f);
    });
    ui.selection = null; ui.selAnchor = null;
    update();
  }

  function repitchSelection(step) {
    const found = selectedEvent();
    if (!found || found.ev.type !== "note") return false;
    const oct = nearestOctave(step, found.ev.notes[0]);
    const pitch = { step, oct, alter: C.keyAlterFor(step, C.state.score.keySig) };
    C.mutate("음높이 재지정", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      f.ev.notes = [{ ...pitch, tie: false }];
      C.normalizeTies(score);
    });
    ui.lastPitch = pitch;
    P.previewNote([C.midiOf(pitch)], 0.3);
    update();
    return true;
  }

  function toggleTie() {
    const found = targetEvent();
    if (!found || found.ev.type !== "note") { flashHint("타이를 걸 음표를 선택하세요"); return; }
    const score = C.state.score;
    const f = C.findEvent(score, found.ev.id);
    const nx = C.nextEvent(score, f.m, f.e, f);
    if (!nx) return;
    if (nx.ev.type === "note" && f.ev.notes.every(n => nx.ev.notes.some(n2 => C.pitchEq(n, n2)))) {
      C.mutate("타이", (s2) => {
        const ff = C.findEvent(s2, found.ev.id);
        const on = !ff.ev.notes.every(n => n.tie);
        ff.ev.notes.forEach(n => n.tie = on);
        C.normalizeTies(s2);
      });
    } else if (nx.ev.type === "rest") {
      // 다음이 쉼표면 같은 음을 만들어 연결 (MuseScore 동작)
      const tick = C.eventStartTick(nx.measures[nx.m], nx.e, nx);
      const pitches = f.ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct }));
      C.mutate("타이", (s2) => {
        C.inputAt(s2, nx.m, tick, { ...f.ev.dur }, pitches, nx);
        const ff = C.findEvent(s2, found.ev.id);
        if (ff) ff.ev.notes.forEach(n => n.tie = true);
        C.normalizeTies(s2);
      });
    } else {
      flashHint("다음 음이 같은 높이일 때만 타이를 걸 수 있어요");
      return;
    }
    update();
  }

  /* ---------------- 표현 기호 (Phase 4) ---------------- */
  /* 아티큘레이션: 범위 내 모든 음표에 토글(전부 있으면 제거, 아니면 추가) */
  function applyArticulation(name) {
    let ids = selectedIds();
    if (!ids && targetEvent()) ids = new Set([targetEvent().ev.id]);
    if (!ids) { flashHint("기호를 붙일 음표를 먼저 선택하세요"); return; }
    const noteIds = [...ids].filter(id => {
      const f = C.findEvent(C.state.score, id);
      return f && f.ev.type === "note";
    });
    if (!noteIds.length) { flashHint("음표를 선택하세요"); return; }
    const allHave = noteIds.every(id => (C.findEvent(C.state.score, id).ev.artics || []).includes(name));
    C.mutate("아티큘레이션", (score) => {
      for (const id of noteIds) {
        const f = C.findEvent(score, id);
        if (!f) continue;
        let ar = f.ev.artics || [];
        ar = allHave ? ar.filter(a => a !== name) : (ar.includes(name) ? ar : [...ar, name]);
        if (ar.length) f.ev.artics = ar; else delete f.ev.artics;
      }
    });
    update();
  }

  /* 셈여림: 범위의 첫 이벤트에 토글 */
  function applyDynamic(mark) {
    let id = null;
    const ids = selectedIds();
    if (ids) {
      const order = C.eventOrderMap(C.state.score);
      id = [...ids].sort((x, y) => order.get(x) - order.get(y))[0];
    } else if (targetEvent()) {
      id = targetEvent().ev.id;
    }
    if (!id) { flashHint("셈여림을 붙일 음표를 먼저 선택하세요"); return; }
    C.mutate("셈여림", (score) => {
      const f = C.findEvent(score, id);
      if (!f) return;
      if (f.ev.dynamic === mark) delete f.ev.dynamic;
      else f.ev.dynamic = mark;
    });
    update();
  }

  /* 이음줄(슬러): 범위 양 끝 음표 사이. 단일 선택이면 다음 음표까지(MuseScore S) */
  function toggleSlur() {
    const score = C.state.score;
    let ends = rangeNoteEnds();
    if (!ends && targetEvent() && targetEvent().ev.type === "note") {
      ends = { firstId: targetEvent().ev.id, lastId: targetEvent().ev.id, count: 1 };
    }
    if (!ends) { flashHint("이음줄을 걸 음표를 먼저 선택하세요"); return; }
    if (ends.count === 1 || ends.firstId === ends.lastId) {
      const f = C.findEvent(score, ends.firstId);
      let nx = C.nextEvent(score, f.m, f.e, f);
      while (nx && nx.ev.type !== "note") nx = C.nextEvent(score, nx.m, nx.e, nx);
      if (!nx) { flashHint("이음줄을 이을 다음 음표가 없어요"); return; }
      ends = { firstId: ends.firstId, lastId: nx.ev.id };
    }
    let removed = false;
    C.mutate("이음줄", (s2) => {
      s2.spanners = s2.spanners || [];
      const i = s2.spanners.findIndex(sp => sp.type === "slur" && sp.startId === ends.firstId && sp.endId === ends.lastId);
      if (i >= 0) { s2.spanners.splice(i, 1); removed = true; }
      else s2.spanners.push({ id: C.newId(), type: "slur", startId: ends.firstId, endId: ends.lastId });
    });
    update();
    toast(removed ? "이음줄을 지웠어요" : "이음줄을 걸었어요 (다시 S = 삭제)");
  }

  /* 헤어핀(crescendo/diminuendo): 범위 양 끝 이벤트 사이 */
  function toggleHairpin(type) {
    const ids = selectedIds();
    if (!ids) { flashHint("범위를 선택한 뒤 누르면 쐐기가 걸려요 (Shift+클릭으로 범위)"); return; }
    const order = C.eventOrderMap(C.state.score);
    const sorted = [...ids].sort((x, y) => order.get(x) - order.get(y));
    const firstId = sorted[0], lastId = sorted[sorted.length - 1];
    let removed = false;
    C.mutate(type === "cresc" ? "크레셴도" : "디미누엔도", (s2) => {
      s2.spanners = s2.spanners || [];
      const i = s2.spanners.findIndex(sp => sp.type === type && sp.startId === firstId && sp.endId === lastId);
      if (i >= 0) { s2.spanners.splice(i, 1); removed = true; }
      else s2.spanners.push({ id: C.newId(), type, startId: firstId, endId: lastId });
    });
    update();
    toast(removed ? "쐐기를 지웠어요" : (type === "cresc" ? "크레셴도(점점 세게)를 걸었어요" : "디미누엔도(점점 여리게)를 걸었어요"));
  }

  function applyTuplet(actual) {
    const found = selectedEvent() || targetEvent();
    if (!found) { flashHint("잇단음표로 바꿀 음표나 쉼표를 선택하세요"); return; }
    if (found.ev.full) { flashHint("온마디 쉼표는 먼저 음길이를 바꾼 뒤 잇단음표로 만들 수 있어요"); return; }
    if (found.ev.dur.tuplet) { flashHint("이미 잇단음표 안에 있어요"); return; }
    let ids = null;
    C.mutate(`${actual}잇단음표`, (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      ids = C.makeTupletAt(score, f.m, f.e, actual, f);
    });
    if (ids && ids.length) {
      ui.selection = ids[0];
      ui.selAnchor = ids[0];
      ui.cursorId = ids[0];
      ui.lastInsertedId = ids[0];
      const f = C.findEvent(C.state.score, ids[0]);
      if (f && f.ev.type === "note") P.previewNote(f.ev.notes.map(C.midiOf), 0.25);
      update();
      toast(`${actual}잇단음표로 나눴어요`);
    } else {
      update();
    }
  }

  function applyGraceBefore() {
    const found = selectedEvent() || targetEvent();
    if (!found || found.ev.type !== "note" || !found.ev.notes.length) {
      flashHint("꾸밈음을 붙일 음표를 먼저 선택하세요");
      return;
    }
    const pitch = found.ev.notes[0];
    C.mutate("꾸밈음", (score) => {
      C.addGraceBefore(score, found.ev.id, pitch, "acciaccatura");
    });
    ui.selection = found.ev.id;
    update();
    P.previewNote([C.midiOf(pitch)], 0.18);
    toast("꾸밈음을 추가했어요");
  }

  function toggleNotation(kind) {
    const found = selectedEvent() || targetEvent();
    if (!found || found.ev.type !== "note") { flashHint("기보를 붙일 음표를 먼저 선택하세요"); return; }
    C.mutate("고급 기보", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      if (kind === "glissando") f.ev.glissando = f.ev.glissando ? null : { type: "start", lineType: "solid" };
      if (kind === "arpeggiate") f.ev.arpeggiate = !f.ev.arpeggiate;
      if (kind === "tremolo") f.ev.tremolo = f.ev.tremolo ? null : { strokes: 2, type: "single" };
      if (!f.ev.glissando) delete f.ev.glissando;
      if (!f.ev.tremolo) delete f.ev.tremolo;
    });
    update();
  }

  function markerTarget() {
    const found = selectedEvent() || targetEvent();
    if (found) return found;
    const ref = activeRef();
    const ev = C.getVoiceEvents(ref.measures[0], ui.currentVoice, C.state.score)[0] || ref.measures[0]?.events[0];
    return ev ? { ...ref, voice: ui.currentVoice, m: 0, e: 0, ev } : null;
  }

  function selectedMeasureRange() {
    const ids = selectedIds();
    const found = ids ? [...ids].map(id => C.findEvent(C.state.score, id)).filter(Boolean) : [];
    if (found.length) {
      const ms = found.map(f => f.m);
      return { from: Math.min(...ms), to: Math.max(...ms) };
    }
    const target = markerTarget();
    return target ? { from: target.m, to: target.m } : null;
  }

  function applyStartRepeat() {
    const range = selectedMeasureRange();
    if (!range) { flashHint("반복 기호를 붙일 마디를 먼저 선택하세요"); return; }
    C.mutate("시작 반복", score => C.toggleStartRepeat(score, range.from));
    update();
  }

  function applyEndRepeat() {
    const range = selectedMeasureRange();
    if (!range) { flashHint("반복 기호를 붙일 마디를 먼저 선택하세요"); return; }
    C.mutate("끝 반복", score => C.toggleEndRepeat(score, range.to));
    update();
  }

  function applyRepeatCount() {
    const range = selectedMeasureRange();
    if (!range) { flashHint("끝 반복 마디를 먼저 선택하세요"); return; }
    const mm = C.ensureMeasureMeta(C.state.score.measures[range.to] || {});
    const raw = prompt("반복 횟수 (2~8)", String(mm.repeatCount || 2));
    if (raw === null) return;
    const count = Math.max(2, Math.min(8, Math.round(+raw || 2)));
    C.mutate("반복 횟수", score => C.setRepeatCount(score, range.to, count));
    update(); toast(`${count}번 반복으로 설정했어요`);
  }

  function applyVolta(label) {
    const range = selectedMeasureRange();
    if (!range) { flashHint("볼타를 붙일 마디 범위를 선택하세요"); return; }
    C.mutate(`${label}번 엔딩`, score => C.setEnding(score, range.from, range.to, label));
    update(); toast(`${label}번 엔딩을 표시했어요`);
  }

  function applyChordSymbol() {
    const found = markerTarget();
    if (!found) { flashHint("코드 기호를 붙일 위치를 먼저 선택하세요"); return; }
    ui.selection = found.ev.id;
    update();
    editChordSymbol(found.ev.id);
  }

  function applyTempoMark() {
    const found = markerTarget();
    if (!found) { flashHint("템포를 붙일 위치를 먼저 선택하세요"); return; }
    const cur = found.ev.tempo || C.state.score.tempo || 100;
    const raw = prompt("템포 표시 ♩ =", String(cur));
    if (raw === null) return;
    const v = Math.max(30, Math.min(280, Math.round(+raw || cur)));
    C.mutate("템포 표시", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      f.ev.tempo = v;
      if (f.m === 0 && C.eventStartTick(f.measures[f.m], f.e, f).isZero()) score.tempo = v;
    });
    stopPlayback(); update(); toast(`템포 ♩=${v}`);
  }

  function nextRehearsalMark() {
    const used = [];
    for (const ref of C.staffRefs(C.state.score)) {
      for (const mm of ref.measures) for (const { ev } of C.measureEntries(mm, { score: C.state.score })) if (ev.rehearsal) used.push(String(ev.rehearsal));
    }
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const ch of letters) if (!used.includes(ch)) return ch;
    return String(used.length + 1);
  }

  function applyRehearsalMark() {
    const found = markerTarget();
    if (!found) { flashHint("리허설 마크를 붙일 위치를 먼저 선택하세요"); return; }
    const raw = prompt("리허설 마크", found.ev.rehearsal || nextRehearsalMark());
    if (raw === null) return;
    const text = raw.trim().slice(0, 12);
    C.mutate("리허설 마크", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      if (text) f.ev.rehearsal = text; else delete f.ev.rehearsal;
    });
    update(); toast(text ? `리허설 ${text}` : "리허설 마크를 지웠어요");
  }

  function applyStaffText() {
    const found = markerTarget();
    if (!found) { flashHint("텍스트를 붙일 위치를 먼저 선택하세요"); return; }
    const raw = prompt("스태프 텍스트", found.ev.staffText || "");
    if (raw === null) return;
    const text = raw.trim().slice(0, 48);
    C.mutate("스태프 텍스트", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      if (text) {
        f.ev.staffText = text;
        const flag = C.detectSoundFlag(text);
        if (flag) f.ev.soundFlag = flag; else delete f.ev.soundFlag;
      } else {
        delete f.ev.staffText;
        delete f.ev.soundFlag;
      }
    });
    update(); toast(text ? "스태프 텍스트를 붙였어요" : "스태프 텍스트를 지웠어요");
  }

  /* ---------------- 입력 모드 ---------------- */
  function setInputMode(on) {
    ui.inputMode = on;
    if (on) {
      if (ui.selection) {
        ui.cursorId = ui.selection;
        ui.selection = null;
        ui.selAnchor = null;
      }
      cursorPos(); // cursorId 보정
      $("#canvas").classList.add("input-mode");
    } else {
      $("#canvas").classList.remove("input-mode");
      E.drawGhost(null);
      ui.restMode = false;
    }
    update();
  }

  function inputLetter(letter, shift) {
    const score = C.state.score;
    const step = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }[letter];
    if (step === undefined) return;
    if (ui.inputMode) {
      if (shift && ui.lastInsertedId) {
        // 화음에 음 추가
        const found = C.findEvent(score, ui.lastInsertedId);
        if (found && found.ev.type === "note") {
          const oct = nearestOctave(step, found.ev.notes[found.ev.notes.length - 1]);
          const pitch = { step, oct, alter: C.keyAlterFor(step, score.keySig) };
          C.mutate("화음에 음 추가", (s2) => {
            const f = C.findEvent(s2, ui.lastInsertedId);
            if (f && !f.ev.notes.some(n => C.pitchEq(n, { ...pitch }))) {
              f.ev.notes.push({ ...pitch, tie: false });
              f.ev.notes.sort((a, b) => C.absStep(a) - C.absStep(b));
            }
          });
          P.previewNote([C.midiOf(pitch)], 0.3);
          update();
        }
        return;
      }
      const pos = cursorPos();
      const oct = nearestOctave(step, ui.lastPitch);
      const pitch = { step, oct, alter: C.keyAlterFor(step, score.keySig) };
      doInput(pos.mIdx, pos.tick, [pitch]);
    } else {
      repitchSelection(step);
    }
  }

  /* ---------------- 마우스 ---------------- */
  function onCanvasMove(evt) {
    if (ui.dragging) return;
    if (!ui.inputMode) return;
    const pt = svgPoint(evt);
    if (!pt) return;
    const hit = E.hitTest(pt.x, pt.y);
    E.drawGhost(hit, ui.curDur, ui.restMode);
  }

  function onCanvasClick(evt) {
    const pt = svgPoint(evt);
    if (!pt) return;
    const refEl = evt.target.closest && evt.target.closest("[data-ref]");
    if (ui.inputMode) {
      const hit = E.hitTest(pt.x, pt.y);
      if (!hit || !hit.le) return;
      C.setActiveStaff(C.state.score, hit.le.partIdx, hit.le.staffIdx);
      if (ui.restMode) {
        doInput(hit.le.mIdx, hit.le.tick, null, hit.le);
      } else {
        const pitch = pitchFromStep(C.state.score, hit.le.mIdx, hit.le.ev.id, clampStep(hit.step, hit.le), hit.le);
        if (evt.shiftKey) {
          // Shift+클릭: 해당 위치 화음에 음 추가
          const id = hit.le.ev.id;
          if (hit.le.ev.type === "note") {
            C.mutate("화음에 음 추가", (s2) => {
              const f = C.findEvent(s2, id);
              if (f && !f.ev.notes.some(n => C.pitchEq(n, pitch))) {
                f.ev.notes.push({ ...pitch, tie: false });
                f.ev.notes.sort((a, b) => C.absStep(a) - C.absStep(b));
              }
            });
            P.previewNote([C.midiOf(pitch)], 0.3);
            ui.lastInsertedId = id;
            update();
            return;
          }
        }
        doInput(hit.le.mIdx, hit.le.tick, [pitch], hit.le);
      }
    } else {
      if (refEl) {
        select(refEl.getAttribute("data-ref"), { extend: evt.shiftKey && !!ui.selection });
        if (P.player.playing) { /* 재생 중 클릭은 선택만 */ }
      } else {
        if (ui.selection) { ui.selection = null; ui.selAnchor = null; update(); }
      }
    }
  }

  function clampStep(as, ctx) {
    const ref = ctx ? C.staffRef(C.state.score, ctx) : activeRef();
    const bottom = C.CLEFS[ref.clef].bottomStep;
    return Math.max(bottom - 11, Math.min(bottom + 19, as));
  }

  /* 드래그로 음높이 변경 */
  function onPointerDown(evt) {
    if (ui.inputMode) return;
    const refEl = evt.target.closest && evt.target.closest("[data-ref]");
    if (!refEl) return;
    const id = refEl.getAttribute("data-ref");
    const found = C.findEvent(C.state.score, id);
    if (!found || found.ev.type !== "note") return;
    C.setActiveStaff(C.state.score, found.partIdx, found.staffIdx);
    const pt = svgPoint(evt);
    ui.dragging = { id, startY: evt.clientY, startPt: pt, moved: false, lastDelta: 0 };
  }
  function onPointerMove(evt) {
    const d = ui.dragging;
    if (!d) return;
    const dy = evt.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 5) return;
    d.moved = true;
    const pt = svgPoint(evt);
    if (!pt) return;
    const layout = E.getLayout();
    const le = layout && layout.eventsById.get(d.id);
    if (!le) return;
    const score = C.state.score;
    const baseAs = C.absStep(C.findEvent(score, d.id).ev.notes[0]);
    const targetAs = E.stepForY(le.staff, score, pt.y);
    d.lastDelta = clampStep(targetAs, le) - baseAs;
    // 고스트 미리보기
    E.drawGhost({ sys: le.sys, staff: le.staff, le, step: clampStep(targetAs, le) }, C.findEvent(score, d.id).ev.dur, false);
  }
  function onPointerUp(evt) {
    const d = ui.dragging;
    ui.dragging = null;
    if (!d || !d.moved) return;
    E.drawGhost(null);
    if (!d.lastDelta) return;
    C.mutate("음높이 드래그", (score) => {
      const f = C.findEvent(score, d.id);
      if (!f) return;
      f.ev.notes = f.ev.notes.map(n => {
        const as = C.absStep(n) + d.lastDelta;
        const step = ((as % 7) + 7) % 7;
        const oct = Math.floor(as / 7);
        return { step, oct, alter: C.keyAlterFor(step, score.keySig), tie: n.tie };
      });
      C.normalizeTies(score);
    });
    const f2 = C.findEvent(C.state.score, d.id);
    if (f2) P.previewNote(f2.ev.notes.map(C.midiOf), 0.35);
    update();
  }

  /* ---------------- 가사 ---------------- */
  function editLyric(id) {
    const found = C.findEvent(C.state.score, id);
    if (!found || found.ev.type !== "note") return;
    const layout = E.getLayout();
    const le = layout.eventsById.get(id);
    if (!le) return;
    const wrap = $("#paper");
    const box = $("#lyric-editor");
    const svg = $("#score-svg");
    const headH = $("#paper-head").offsetHeight;
    const yPx = le.staff.yTop + (le.staff.lyricOff || E.STAFF_H + 34) - 10;
    box.style.display = "block";
    box.style.left = (le.x - 44) + "px";
    box.style.top = (headH + yPx) + "px";
    const input = box.querySelector("input");
    const tip = box.querySelector(".tip");
    const verse = ui.lyricVerse || 1;
    const curLyric = C.lyricsOf(found.ev).find(l => l.verse === verse);
    input.placeholder = `${verse}절 가사`;
    input.value = curLyric?.text || "";
    if (tip) tip.textContent = "Space=다음 · -=하이픈 · _=멜리스마";
    input.focus(); input.select();

    const close = () => {
      box.style.display = "none";
      input.placeholder = "가사";
      if (tip) tip.textContent = "Space=다음 · Esc=닫기";
    };
    const commit = (advance, opt = {}) => {
      const text = input.value.trim();
      const cur = C.findEvent(C.state.score, id);
      const old = cur ? C.lyricsOf(cur.ev).find(l => l.verse === verse) : null;
      const oldText = old?.text || "";
      const syllabic = opt.syllabic || old?.syllabic || "single";
      const extend = opt.extend !== undefined ? opt.extend : !!old?.extend;
      if (cur && (oldText !== text || (old && (old.syllabic !== syllabic || !!old.extend !== extend)))) {
        C.mutate("가사", (score) => {
          const f = C.findEvent(score, id);
          if (f) C.setLyric(f.ev, verse, text, { syllabic, extend });
        });
      }
      close();
      update();
      if (advance) {
        const f = C.findEvent(C.state.score, id);
        let nx = f && C.nextEvent(C.state.score, f.m, f.e, f);
        while (nx && nx.ev.type !== "note") nx = C.nextEvent(C.state.score, nx.m, nx.e, nx);
        if (nx) { select(nx.ev.id, { silent: true }); editLyric(nx.ev.id); }
      }
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === " " && input.value.trim()) {
        if (e.key === " ") e.preventDefault();
        commit(e.key === " " || e.key === "Enter");
      } else if (e.key === "-") {
        e.preventDefault();
        commit(true, { syllabic: "begin", extend: false });
      } else if (e.key === "_") {
        e.preventDefault();
        commit(true, { syllabic: "single", extend: true });
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "Tab") {
        e.preventDefault(); commit(true);
      }
    };
    input.onblur = () => { if (box.style.display !== "none") commit(false); };
  }

  /* ---------------- 코드 기호 ---------------- */
  function editChordSymbol(id) {
    const found = C.findEvent(C.state.score, id);
    if (!found) return;
    const layout = E.getLayout();
    const le = layout.eventsById.get(id);
    if (!le) return;
    const box = $("#lyric-editor");
    const headH = $("#paper-head").offsetHeight;
    box.dataset.mode = "chord";
    box.style.display = "block";
    box.style.left = (le.x - 44) + "px";
    box.style.top = (headH + le.staff.yTop - 52) + "px";
    const input = box.querySelector("input");
    const tip = box.querySelector(".tip");
    input.placeholder = "C7";
    input.value = found.ev.chordSymbol ? (found.ev.chordSymbol.normalized || found.ev.chordSymbol.raw || "") : "";
    if (tip) tip.textContent = "Space=다음 · Shift+Space=이전 · Esc=닫기";
    input.focus(); input.select();

    const close = () => {
      box.style.display = "none";
      delete box.dataset.mode;
      input.placeholder = "가사";
      if (tip) tip.textContent = "Space=다음 · Esc=닫기";
    };
    const moveAfter = (dir) => {
      const f = C.findEvent(C.state.score, id);
      if (!f) return;
      const nx = dir > 0 ? C.nextEvent(C.state.score, f.m, f.e, f) : C.prevEvent(C.state.score, f.m, f.e, f);
      if (nx) { select(nx.ev.id, { silent: true }); editChordSymbol(nx.ev.id); }
    };
    const commit = (dir) => {
      const text = input.value.trim();
      const parsed = C.parseChordSymbol(text);
      const cur = C.findEvent(C.state.score, id);
      const oldText = cur?.ev.chordSymbol ? (cur.ev.chordSymbol.normalized || cur.ev.chordSymbol.raw || "") : "";
      if (cur && oldText !== (parsed ? parsed.normalized : "")) {
        C.mutate("코드 기호", (score) => {
          const f = C.findEvent(score, id);
          if (!f) return;
          if (parsed) {
            f.ev.chordSymbol = C.cloneChordSymbol(parsed);
            if (!f.ev.fretboard || !f.ev.fretboard.manual) {
              const fb = C.getDefaultFretboard(parsed);
              if (fb) f.ev.fretboard = fb; else delete f.ev.fretboard;
            }
          } else {
            delete f.ev.chordSymbol;
            delete f.ev.fretboard;
          }
        });
      }
      close();
      update();
      if (dir) moveAfter(dir);
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault(); commit(1);
      } else if (e.key === " ") {
        e.preventDefault(); commit(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "Tab") {
        e.preventDefault(); commit(e.shiftKey ? -1 : 1);
      }
    };
    input.onblur = () => { if (box.style.display !== "none") commit(0); };
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
    P.play(fromSec, { viewMode: ui.viewMode });
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
    const cursor = $("#play-cursor");
    if (cursor && timeline && timeline.length) {
      let i = 0;
      while (i + 1 < timeline.length && timeline[i + 1].t <= sec) i++;
      const a = timeline[i], b = timeline[i + 1];
      let x = a.x, sys = a.sys;
      if (b && b.sys === a.sys && b.t > a.t) {
        x = a.x + (b.x - a.x) * (sec - a.t) / (b.t - a.t);
      }
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
      const cursor = $("#play-cursor");
      if (cursor) cursor.setAttribute("opacity", "0");
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
      canvas.scrollTo({ top: Math.max(0, yTop - 90), behavior: "smooth" });
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

  /* ---------------- 피아노 ---------------- */
  const PC_BLACK = [1, 3, 6, 8, 10];
  function buildPiano() {
    const host = $("#piano-keys");
    let html = "";
    const LOW = 48, HIGH = 84; // C3~C6
    let whiteIdx = 0;
    const W = 30;
    for (let m = LOW; m <= HIGH; m++) {
      const pc = m % 12;
      if (!PC_BLACK.includes(pc)) {
        const oct = Math.floor(m / 12) - 1;
        const solfa = ["도", null, "레", null, "미", "파", null, "솔", null, "라", null, "시"][pc];
        const label = pc === 0 ? `${solfa}<small>C${oct}</small>` : `${solfa}`;
        html += `<div class="key white" data-midi="${m}" style="left:${whiteIdx * W}px"><span>${label}</span></div>`;
        whiteIdx++;
      }
    }
    let wi = 0;
    for (let m = LOW; m <= HIGH; m++) {
      const pc = m % 12;
      if (!PC_BLACK.includes(pc)) { wi++; continue; }
      html += `<div class="key black" data-midi="${m}" style="left:${wi * W - 9}px"></div>`;
    }
    host.style.width = whiteIdx * W + "px";
    host.innerHTML = html;

    host.addEventListener("pointerdown", (e) => {
      const key = e.target.closest(".key");
      if (!key) return;
      e.preventDefault();
      const midi = +key.dataset.midi;
      key.classList.add("pressed");
      setTimeout(() => key.classList.remove("pressed"), 220);
      if (ui.inputMode) {
        const score = C.state.score;
        const pitch = C.spellMidi(midi, score.keySig);
        if (e.shiftKey && ui.lastInsertedId) {
          C.mutate("화음에 음 추가", (s2) => {
            const f = C.findEvent(s2, ui.lastInsertedId);
            if (f && f.ev.type === "note" && !f.ev.notes.some(n => C.pitchEq(n, pitch))) {
              f.ev.notes.push({ ...pitch, tie: false });
              f.ev.notes.sort((a, b) => C.absStep(a) - C.absStep(b));
            }
          });
          P.previewNote([midi], 0.3);
          update();
        } else {
          const pos = cursorPos();
          doInput(pos.mIdx, pos.tick, [pitch]);
        }
      } else {
        P.previewNote([midi], 0.5);
      }
    });
  }

  /* ---------------- 툴바 ---------------- */
  const DURS = [
    { n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 4 }, { n: 1, d: 8 }, { n: 1, d: 16 },
  ];
  function buildToolbar() {
    const host = $("#dur-buttons");
    host.innerHTML = DURS.map((b, i) =>
      `<button class="tbtn dur" data-i="${i}" title="${C.durName({ ...b, dots: 0 })} (${[7, 6, 5, 4, 3][i]})">${E.iconNote(b, 0)}</button>`
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
    $("#btn-dot").classList.toggle("on", !!(found && !ui.inputMode ? found.ev.dur.dots : ui.curDur.dots));
    $$("#voice-buttons .voice-btn").forEach(b => b.classList.toggle("on", +b.dataset.voice === ui.currentVoice));

    // 임시표 상태
    let alter = null;
    const tgt = found || (ui.inputMode && ui.lastInsertedId ? C.findEvent(score, ui.lastInsertedId) : null);
    if (tgt && tgt.ev.type === "note" && tgt.ev.notes.length) alter = tgt.ev.notes[0].alter;
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
    $("#tempo-input").value = score.tempo;
    $("#swing-select").value = score.playbackSettings?.swing || "off";
    const staffSel = $("#staff-select");
    const staffValue = `${active.partIdx}:${active.staffIdx}`;
    const staffOptions = refs.map(ref => {
      const suffix = ref.part.staves.length > 1 ? ` ${ref.staffIdx + 1}` : "";
      return `<option value="${ref.partIdx}:${ref.staffIdx}">${ref.name}${suffix}</option>`;
    }).join("");
    if (staffSel.innerHTML !== staffOptions) staffSel.innerHTML = staffOptions;
    staffSel.value = staffValue;
    const viewSel = $("#view-select");
    const viewOptions = [`<option value="full">총보</option>`]
      .concat(score.parts.map((part, idx) => `<option value="${idx}">${part.name || "파트 " + (idx + 1)}</option>`))
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
    if (ids && ids.size > 1) {
      text = `${ids.size}개 선택 — Ctrl+C/V=복사/붙여넣기 · S=이음줄 · < >=쐐기`;
    } else if (found) {
      const ev = found.ev;
      if (ev.type === "note") {
        const names = ev.notes.map(n => `${C.pitchName(n, "ko")}(${C.pitchName(n)})`).join("·");
        const marks = [ev.chordSymbol ? `코드 ${C.displayChordSymbol(ev.chordSymbol)}` : "", ev.dynamic, ev.tempo ? `♩=${ev.tempo}` : "", ev.rehearsal ? `리허설 ${ev.rehearsal}` : "", ev.staffText || "", ev.soundFlag ? `sound:${ev.soundFlag}` : ""].filter(Boolean);
        const extra = (ev.artics && ev.artics.length ? " · " + ev.artics.join(",") : "") + (marks.length ? " · " + marks.join(" · ") : "");
        text = `${found.name}${found.part.staves.length > 1 ? " " + (found.staffIdx + 1) : ""} · V${found.voice || 1} · 마디 ${found.m + 1} · ${durName2(ev)} · ${names}${extra}`;
      } else {
        const marks = [ev.chordSymbol ? `코드 ${C.displayChordSymbol(ev.chordSymbol)}` : "", ev.tempo ? `♩=${ev.tempo}` : "", ev.rehearsal ? `리허설 ${ev.rehearsal}` : "", ev.staffText || "", ev.soundFlag ? `sound:${ev.soundFlag}` : ""].filter(Boolean);
        text = `${found.name}${found.part.staves.length > 1 ? " " + (found.staffIdx + 1) : ""} · V${found.voice || 1} · 마디 ${found.m + 1} · ${ev.full ? "온마디 쉼표" : durName2(ev) + " 쉼표"}${marks.length ? " · " + marks.join(" · ") : ""}`;
      }
    } else if (ui.inputMode && ui.cursorId) {
      const f = C.findEvent(score, ui.cursorId);
      if (f) text = `입력 위치: ${activeName} · V${ui.currentVoice} · 마디 ${f.m + 1} · ${C.durName(ui.curDur)}로 입력`;
    } else {
      text = `${score.measures.length}마디 · ${C.staffRefs(score).length}보표 · ${C.KEY_NAMES[String(score.keySig)] || ""} · ${score.timeSig.num}/${score.timeSig.den}`;
    }
    el.textContent = text;
    $("#aria-live").textContent = text;

    $("#status-hint").textContent = ui.inputMode
      ? (ui.restMode ? "보표를 클릭하면 쉼표가 들어가요 · 쉼표 버튼으로 해제" : "보표 클릭 또는 A~G·피아노 건반으로 입력 · 0=쉼표 · ↑↓=반음 · Esc=종료")
      : "N 또는 ✏️=입력 모드 · 음표 클릭=선택 · 드래그=음높이 · 스페이스=재생";
  }
  function durName2(ev) { return C.durName(ev.dur); }

  /* ---------------- 속성 패널 ---------------- */
  function htmlEsc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  function checked(v) { return v ? "checked" : ""; }
  function selectedPropIds() {
    const ids = selectedIds();
    if (ids && ids.size) return [...ids];
    const found = targetEvent();
    return found ? [found.ev.id] : [];
  }
  function firstSelectedRef() {
    const ids = selectedPropIds();
    return ids.length ? C.findEvent(C.state.score, ids[0]) : null;
  }
  function renderPropertiesPanel() {
    const host = $("#properties-body");
    if (!host) return;
    const score = C.state.score;
    const ids = selectedPropIds();
    const found = firstSelectedRef();
    const range = selectedMeasureRange();
    const layout = C.ensureLayout(score);
    let html = `<section class="prop-sec"><h3>악보</h3><div class="prop-grid">
      <label>마디</label><span>${score.measures.length}</span>
      <label>보표</label><span>${C.staffRefs(score).length}</span>
      <label>용지</label><span>${htmlEsc(layout.pageSize)} ${layout.orientation === "landscape" ? "가로" : "세로"}</span>
      <label>마디/줄</label><span>${layout.measuresPerSystem || "자동"}</span>
    </div></section>`;
    if (!found) {
      host.innerHTML = html + `<section class="prop-sec"><div class="prop-empty">음표나 쉼표를 선택하면 이곳에서 보임, 색상, 오프셋, 기호, 브레이크를 바로 조정할 수 있어요.</div></section>`;
      return;
    }
    const ev = found.ev;
    const mm = C.ensureMeasureMeta(score.measures[range?.to ?? found.m] || {});
    const dynOptions = ["", "pp", "p", "mp", "mf", "f", "ff"].map(d => `<option value="${d}" ${ev.dynamic === d ? "selected" : ""}>${d || "없음"}</option>`).join("");
    const stemOptions = ["auto", "up", "down"].map(v => `<option value="${v}" ${(ev.stemDirection || "auto") === v ? "selected" : ""}>${v === "auto" ? "자동" : v === "up" ? "위" : "아래"}</option>`).join("");
    const headOptions = ["normal", "x", "diamond"].map(v => `<option value="${v}" ${(ev.notehead || "normal") === v ? "selected" : ""}>${v === "normal" ? "일반" : v === "x" ? "X" : "다이아"}</option>`).join("");
    const breakOptions = ["", "system", "page", "section"].map(v => {
      const label = v === "" ? "없음" : v === "system" ? "시스템" : v === "page" ? "페이지" : "섹션";
      return `<option value="${v}" ${(mm.breakType || "") === v ? "selected" : ""}>${label}</option>`;
    }).join("");
    html += `<section class="prop-sec"><h3>${ids.length > 1 ? `${ids.length}개 선택` : ev.type === "note" ? "음표" : "쉼표"}</h3><div class="prop-grid">
      <label>위치</label><span>${found.name} · V${found.voice || 1} · 마디 ${found.m + 1}</span>
      <label>보임</label><input type="checkbox" data-prop="visible" ${checked(!ev.hidden)}>
      <label>색상</label><input type="color" data-prop="color" value="${htmlEsc(ev.color || "#14171c")}">
      <label>X</label><input type="number" data-prop="offsetX" step="1" value="${+ev.offsetX || 0}">
      <label>Y</label><input type="number" data-prop="offsetY" step="1" value="${+ev.offsetY || 0}">
      <label>마디 브레이크</label><select data-measure-break>${breakOptions}</select>
    </div><div class="prop-actions">
      <button class="chip" data-prop-action="reset-offset">오프셋 초기화</button>
      <button class="chip" data-prop-action="clear-color">색상 초기화</button>
    </div></section>`;
    if (ev.type === "note") {
      const arts = ["staccato", "tenuto", "accent", "marcato", "fermata"];
      html += `<section class="prop-sec"><h3>음표 모양</h3><div class="prop-grid">
        <label>스템</label><select data-prop="stemDirection">${stemOptions}</select>
        <label>머리</label><select data-prop="notehead">${headOptions}</select>
        <label>작게</label><input type="checkbox" data-prop="small" ${checked(ev.small)}>
        <label>Velocity</label><input type="number" data-prop="velocityOffset" min="-64" max="64" step="1" value="${+ev.velocityOffset || 0}">
      </div><div class="prop-actions">` +
        arts.map(a => `<button class="chip" data-artic-prop="${a}">${a}</button>`).join("") +
        `</div></section>`;
    }
    html += `<section class="prop-sec"><h3>기호/텍스트</h3><div class="prop-grid">
      <label>셈여림</label><select data-prop="dynamic">${dynOptions}</select>
      <label>템포</label><input type="number" data-prop="tempo" min="30" max="280" value="${ev.tempo || ""}" placeholder="없음">
      <label>리허설</label><input type="text" data-prop="rehearsal" value="${htmlEsc(ev.rehearsal || "")}" maxlength="12">
      <label>스태프 텍스트</label><input type="text" data-prop="staffText" value="${htmlEsc(ev.staffText || "")}" maxlength="48">
      <label>코드</label><input type="text" data-prop="chordSymbol" value="${htmlEsc(ev.chordSymbol ? (ev.chordSymbol.normalized || ev.chordSymbol.raw || "") : "")}" maxlength="24">
    </div></section>`;
    host.innerHTML = html;
  }
  function mutateSelectedEvents(label, fn) {
    const ids = selectedPropIds();
    if (!ids.length) return;
    C.mutate(label, (score) => {
      for (const id of ids) {
        const f = C.findEvent(score, id);
        if (f) fn(f.ev, f, score);
      }
    });
    update();
  }
  function applyPropertyInput(input) {
    const prop = input.dataset.prop;
    mutateSelectedEvents("속성 변경", (ev) => {
      if (prop === "visible") ev.hidden = !input.checked;
      else if (prop === "color") {
        const v = input.value;
        if (/^#[0-9a-fA-F]{6}$/.test(v)) ev.color = v;
      } else if (prop === "offsetX" || prop === "offsetY" || prop === "velocityOffset") {
        const v = Math.round(+input.value || 0);
        if (v) ev[prop] = v; else delete ev[prop];
      } else if (prop === "stemDirection") {
        if (input.value === "auto") delete ev.stemDirection; else ev.stemDirection = input.value;
      } else if (prop === "notehead") {
        if (input.value === "normal") delete ev.notehead; else ev.notehead = input.value;
      } else if (prop === "small") {
        ev.small = !!input.checked;
        if (!ev.small) delete ev.small;
      } else if (prop === "dynamic") {
        if (input.value) ev.dynamic = input.value; else delete ev.dynamic;
      } else if (prop === "tempo") {
        if (!String(input.value || "").trim()) delete ev.tempo;
        else ev.tempo = Math.max(30, Math.min(280, Math.round(+input.value || 0)));
      } else if (prop === "rehearsal") {
        const text = input.value.trim().slice(0, 12);
        if (text) ev.rehearsal = text; else delete ev.rehearsal;
      } else if (prop === "staffText") {
        const text = input.value.trim().slice(0, 48);
        if (text) {
          ev.staffText = text;
          const flag = C.detectSoundFlag(text);
          if (flag) ev.soundFlag = flag; else delete ev.soundFlag;
        } else {
          delete ev.staffText; delete ev.soundFlag;
        }
      } else if (prop === "chordSymbol") {
        const parsed = C.parseChordSymbol(input.value);
        if (parsed) {
          ev.chordSymbol = C.cloneChordSymbol(parsed);
          if (!ev.fretboard || !ev.fretboard.manual) {
            const fb = C.getDefaultFretboard(parsed);
            if (fb) ev.fretboard = fb; else delete ev.fretboard;
          }
        } else {
          delete ev.chordSymbol; delete ev.fretboard;
        }
      }
    });
  }
  function applyMeasureBreak(type, fromPanel) {
    const range = selectedMeasureRange();
    if (!range) { flashHint("브레이크를 붙일 마디를 먼저 선택하세요"); return; }
    let sectionName = "";
    if (type === "section") {
      sectionName = prompt("섹션 이름", C.ensureMeasureMeta(C.state.score.measures[range.to] || {}).sectionName || "Section") || "";
      if (!sectionName.trim()) type = null;
    }
    C.mutate("마디 브레이크", (score) => C.setMeasureBreak(score, range.to, type || null, sectionName));
    update();
    if (!fromPanel) toast(type ? "브레이크를 표시했어요" : "브레이크를 지웠어요");
  }
  function bindProperties() {
    $("#btn-props").addEventListener("click", () => {
      $("#properties-panel").classList.toggle("collapsed");
      $("#btn-props").classList.toggle("on", !$("#properties-panel").classList.contains("collapsed"));
      applyZoom();
    });
    $("#btn-props-close").addEventListener("click", () => {
      $("#properties-panel").classList.add("collapsed");
      $("#btn-props").classList.remove("on");
      applyZoom();
    });
    $("#properties-panel").addEventListener("change", (e) => {
      const input = e.target.closest("[data-prop]");
      if (input) { applyPropertyInput(input); return; }
      const br = e.target.closest("[data-measure-break]");
      if (br) applyMeasureBreak(br.value || null, true);
    });
    $("#properties-panel").addEventListener("click", (e) => {
      const art = e.target.closest("[data-artic-prop]");
      if (art) { applyArticulation(art.dataset.articProp); return; }
      const action = e.target.closest("[data-prop-action]");
      if (!action) return;
      mutateSelectedEvents("속성 초기화", (ev) => {
        if (action.dataset.propAction === "reset-offset") { delete ev.offsetX; delete ev.offsetY; }
        if (action.dataset.propAction === "clear-color") delete ev.color;
      });
    });
  }

  /* ---------------- 내비게이터/타임라인/이동 ---------------- */
  function refreshOpenOverlays() {
    if ($("#dlg-navigator")?.open) renderNavigator();
    if ($("#dlg-timeline")?.open) renderTimelinePanel();
  }
  function scrollToMeasure(mIdx) {
    const layout = layoutCache || E.getLayout();
    if (!layout) return;
    const sys = layout.systems.find(S => S.measures.some(M => M.idx === mIdx));
    if (!sys) return;
    const M = sys.measures.find(x => x.idx === mIdx);
    const ref = C.activeRef(C.state.score);
    const ev = C.getVoiceEvents(ref.measures[mIdx] || ref.measures[0], ui.currentVoice, C.state.score)[0];
    if (ev) { ui.selection = ev.id; ui.selAnchor = ev.id; ui.cursorId = ev.id; }
    update();
    setTimeout(() => {
      const canvas = $("#canvas");
      const headH = $("#paper-head").offsetHeight;
      const s = ui.fitScale * ui.zoom;
      canvas.scrollTo({ top: Math.max(0, (sys.yTop + headH - 80) * s), left: Math.max(0, (M.x0 - 80) * s), behavior: "smooth" });
    }, 0);
  }
  function renderNavigator() {
    const host = $("#navigator-view");
    const layout = layoutCache || E.getLayout();
    if (!host || !layout) return;
    const w = 300;
    const scale = w / (layout.pageW || E.PAGE_W);
    const h = Math.max(220, layout.height * scale);
    let svg = `<svg class="navigator-map" viewBox="0 0 ${r1(w)} ${r1(h)}" width="${r1(w)}" height="${r1(Math.min(540, h))}">`;
    svg += `<rect x="0" y="0" width="${r1(w)}" height="${r1(h)}" fill="#fff"/>`;
    for (const S of layout.systems) {
      const y1 = Math.min(...S.staffLayouts.map(st => st.yTop)) * scale;
      const y2 = Math.max(...S.staffLayouts.map(st => st.yTop + (st.staffType === "tab" ? 5 * E.SP : E.STAFF_H))) * scale;
      svg += `<line x1="${r1(S.x0 * scale)}" y1="${r1(y1)}" x2="${r1(S.x1 * scale)}" y2="${r1(y1)}" stroke="#98a2b3" stroke-width="1"/>`;
      svg += `<line x1="${r1(S.x0 * scale)}" y1="${r1(y2)}" x2="${r1(S.x1 * scale)}" y2="${r1(y2)}" stroke="#98a2b3" stroke-width="1"/>`;
      for (const M of S.measures) {
        svg += `<rect class="nav-measure" data-midx="${M.idx}" x="${r1(M.x0 * scale)}" y="${r1(y1 - 8)}" width="${r1(Math.max(5, (M.x1 - M.x0) * scale))}" height="${r1(y2 - y1 + 16)}" rx="2"/>`;
      }
    }
    svg += `</svg>`;
    host.innerHTML = svg;
  }
  function measureDensity(score, mIdx) {
    let notes = 0, markers = [];
    for (const ref of C.staffRefs(score)) {
      const mm = ref.measures[mIdx];
      if (!mm) continue;
      for (const { ev } of C.measureEntries(mm, { score })) {
        if (ev.type === "note") notes += Math.max(1, ev.notes.length);
        if (ev.rehearsal) markers.push("R:" + ev.rehearsal);
        if (ev.tempo) markers.push("♩=" + ev.tempo);
        if (ev.staffText) markers.push(ev.staffText);
      }
    }
    return { notes, markers };
  }
  function renderTimelinePanel() {
    const host = $("#timeline-view");
    if (!host) return;
    const score = C.state.score;
    const maxNotes = Math.max(1, ...score.measures.map((_, i) => measureDensity(score, i).notes));
    host.innerHTML = `<div class="timeline-grid">` + score.measures.map((_, i) => {
      const d = measureDensity(score, i);
      const width = Math.max(8, Math.round(d.notes / maxNotes * 100));
      const marker = d.markers.slice(0, 2).join(" · ");
      return `<button class="timeline-cell" data-midx="${i}"><b>${i + 1}</b><span>${htmlEsc(marker || `${d.notes} notes`)}</span><i class="timeline-density" style="width:${width}%"></i></button>`;
    }).join("") + `</div>`;
  }
  function openNavigator() {
    renderNavigator();
    const dlg = $("#dlg-navigator");
    if (!dlg.open) dlg.showModal();
  }
  function openTimelinePanel() {
    renderTimelinePanel();
    const dlg = $("#dlg-timeline");
    if (!dlg.open) dlg.showModal();
  }
  function gotoQuery() {
    const raw = prompt("이동: 마디 번호, r:A", "");
    if (raw === null) return;
    const q = raw.trim();
    if (!q) return;
    let mIdx = null;
    const rm = q.match(/^r\s*:\s*(.+)$/i);
    if (rm) {
      const target = rm[1].trim().toLowerCase();
      for (let m = 0; m < C.state.score.measures.length; m++) {
        let hit = false;
        for (const ref of C.staffRefs(C.state.score)) {
          for (const { ev } of C.measureEntries(ref.measures[m], { score: C.state.score })) {
            if (String(ev.rehearsal || "").toLowerCase() === target) hit = true;
          }
        }
        if (hit) { mIdx = m; break; }
      }
    } else {
      const n = parseInt(q.replace(/^m\s*/i, ""), 10);
      if (!isNaN(n)) mIdx = n - 1;
    }
    if (mIdx === null || mIdx < 0 || mIdx >= C.state.score.measures.length) {
      flashHint("이동할 위치를 찾지 못했어요");
      return;
    }
    scrollToMeasure(mIdx);
  }
  function bindNavigationPanels() {
    $("#btn-navigator").addEventListener("click", openNavigator);
    $("#btn-timeline").addEventListener("click", openTimelinePanel);
    $("#navigator-view").addEventListener("click", (e) => {
      const item = e.target.closest("[data-midx]");
      if (item) scrollToMeasure(+item.dataset.midx);
    });
    $("#timeline-view").addEventListener("click", (e) => {
      const item = e.target.closest("[data-midx]");
      if (item) scrollToMeasure(+item.dataset.midx);
    });
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* ---------------- 토스트/힌트 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function flashHint(msg) { if (msg) toast(msg); }

  /* ---------------- Supabase 인증 ---------------- */
  function readSupabaseConfig() {
    const embedded = window.SF_SUPABASE_CONFIG || {};
    let url = "";
    let publishableKey = "";
    try {
      url = localStorage.getItem(SUPABASE_URL_KEY) || "";
      publishableKey = localStorage.getItem(SUPABASE_KEY_KEY) || "";
    } catch {}
    url = url || embedded.url || embedded.supabaseUrl || "";
    publishableKey = publishableKey || embedded.publishableKey || embedded.anonKey || embedded.key || "";
    return {
      url: String(url || "").trim().replace(/\/+$/, ""),
      publishableKey: String(publishableKey || "").trim(),
    };
  }

  function fillSupabaseConfigFields() {
    const cfg = readSupabaseConfig();
    const urlEl = $("#supabase-url");
    const keyEl = $("#supabase-key");
    if (urlEl) urlEl.value = cfg.url;
    if (keyEl) keyEl.value = cfg.publishableKey;
  }

  function isSupabaseConfigured() {
    const cfg = readSupabaseConfig();
    return Boolean(cfg.url && cfg.publishableKey);
  }

  function getSupabaseClient(opts = {}) {
    const cfg = readSupabaseConfig();
    if (!cfg.url || !cfg.publishableKey) {
      if (opts.requireConfig === false) return null;
      throw new Error("Supabase Project URL과 publishable key를 먼저 저장하세요.");
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      if (opts.requireConfig === false) return null;
      throw new Error("Supabase JS 라이브러리를 불러오지 못했어요. 네트워크 연결을 확인하세요.");
    }
    const sig = `${cfg.url}|${cfg.publishableKey}`;
    if (!authState.client || authState.configSig !== sig) {
      if (authState.authSub && typeof authState.authSub.unsubscribe === "function") {
        authState.authSub.unsubscribe();
      }
      authState.client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      authState.configSig = sig;
      const { data } = authState.client.auth.onAuthStateChange((_event, session) => {
        authState.session = session || null;
        if (!session || !session.user) {
          authState.profile = null;
          updateAuthChrome();
          return;
        }
        const userId = session.user.id;
        loadAuthProfile(session.user).then((profile) => {
          if (!authState.session || !authState.session.user || authState.session.user.id !== userId) return;
          authState.profile = profile;
          updateAuthChrome();
        });
      });
      authState.authSub = data && data.subscription;
    }
    return authState.client;
  }

  function authErrorMessage(err) {
    const raw = String((err && (err.message || err.error_description)) || err || "알 수 없는 오류");
    if (/invalid login credentials/i.test(raw)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (/email not confirmed/i.test(raw)) return "이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인하세요.";
    if (/failed to fetch|network/i.test(raw)) return "Supabase에 연결할 수 없습니다. URL, publishable key, 네트워크 상태를 확인하세요.";
    return raw;
  }

  function setAuthMessage(msg, type = "") {
    const el = $("#auth-message");
    if (!el) return;
    el.textContent = msg || "";
    el.className = `auth-message${type ? " " + type : ""}`;
  }

  function setAuthBusy(isBusy) {
    const btn = $("#auth-submit");
    if (!btn) return;
    btn.disabled = isBusy;
    btn.textContent = isBusy ? "처리 중..." : (AUTH_MODES[authState.mode] || AUTH_MODES.member).submit;
  }

  async function saveSupabaseConfigFromDialog() {
    const url = ($("#supabase-url").value || "").trim().replace(/\/+$/, "");
    const publishableKey = ($("#supabase-key").value || "").trim();
    if (!url || !publishableKey) {
      setAuthMessage("Project URL과 publishable key를 모두 입력하세요.", "error");
      return false;
    }
    if (!/^https?:\/\//i.test(url)) {
      setAuthMessage("Project URL은 https:// 로 시작해야 합니다.", "error");
      return false;
    }
    if (/service_role/i.test(publishableKey)) {
      setAuthMessage("service_role key는 브라우저에 저장하면 안 됩니다. publishable key를 입력하세요.", "error");
      return false;
    }
    try {
      localStorage.setItem(SUPABASE_URL_KEY, url);
      localStorage.setItem(SUPABASE_KEY_KEY, publishableKey);
    } catch {
      setAuthMessage("브라우저 저장소에 Supabase 설정을 저장하지 못했어요.", "error");
      return false;
    }
    authState.client = null;
    authState.configSig = "";
    await initSupabaseAuth({ quiet: true });
    setAuthMessage("Supabase 연결 정보를 저장했어요.", "ok");
    updateAuthChrome();
    return true;
  }

  async function clearSupabaseConfig() {
    const client = getSupabaseClient({ requireConfig: false });
    try {
      if (client) await client.auth.signOut();
      localStorage.removeItem(SUPABASE_URL_KEY);
      localStorage.removeItem(SUPABASE_KEY_KEY);
    } catch {}
    authState.client = null;
    authState.configSig = "";
    authState.session = null;
    authState.profile = null;
    fillSupabaseConfigFields();
    updateAuthChrome();
    setAuthMessage("Supabase 연결 설정을 초기화했어요.", "ok");
  }

  async function initSupabaseAuth(opts = {}) {
    fillSupabaseConfigFields();
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) {
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      authState.session = data.session || null;
      authState.profile = data.session && data.session.user
        ? await loadAuthProfile(data.session.user, { silent: true })
        : null;
      updateAuthChrome();
    } catch (err) {
      if (!opts.quiet) console.warn("Supabase auth init failed", err);
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
    }
  }

  async function loadAuthProfile(user, opts = {}) {
    const fallback = {
      id: user.id,
      email: user.email || "",
      display_name: (user.user_metadata && user.user_metadata.display_name) || "",
      role: "member",
    };
    const client = getSupabaseClient({ requireConfig: false });
    if (!client || !user) return fallback;
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id,email,display_name,role,created_at,updated_at")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data || fallback;
    } catch (err) {
      if (!opts.silent) console.warn("Profile load failed", err);
      return { ...fallback, profileError: authErrorMessage(err) };
    }
  }

  async function ensureOwnProfile(user, displayName = "") {
    if (!user) return;
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) return;
    const row = {
      id: user.id,
      email: user.email || "",
      display_name: displayName || (user.user_metadata && user.user_metadata.display_name) || "",
      role: "member",
    };
    try {
      const { error } = await client.from("profiles").insert(row);
      if (error && error.code !== "23505" && !/duplicate/i.test(error.message || "")) {
        console.warn("Profile insert skipped", error);
      }
    } catch (err) {
      console.warn("Profile insert skipped", err);
    }
  }

  function isAdminProfile(profile) {
    return Boolean(profile && profile.role === "admin" && !profile.profileError);
  }

  function updateAuthChrome() {
    const configured = isSupabaseConfigured();
    const signedIn = Boolean(authState.session && authState.session.user);
    const profile = authState.profile || {};
    const email = (authState.session && authState.session.user && authState.session.user.email) || profile.email || "";
    const admin = isAdminProfile(profile);
    const status = $("#auth-status");
    if (status) {
      status.className = `auth-status${signedIn ? " signed-in" : ""}${admin ? " admin" : ""}`;
      status.textContent = !configured
        ? "Supabase 미설정"
        : signedIn
          ? `${email}${admin ? " · 관리자" : " · 회원"}`
          : "로그인 전";
      status.title = status.textContent;
    }
    const signup = $("#btn-signup");
    const memberLogin = $("#btn-member-login");
    const adminLogin = $("#btn-admin-login");
    const adminPage = $("#btn-admin-page");
    const logout = $("#btn-logout");
    if (signup) signup.hidden = signedIn;
    if (memberLogin) memberLogin.hidden = signedIn;
    if (adminLogin) adminLogin.hidden = signedIn && admin;
    if (adminPage) adminPage.classList.toggle("on", admin);
    if (logout) logout.hidden = !signedIn;
  }

  function openAuthDialog(mode = "member") {
    authState.mode = AUTH_MODES[mode] ? mode : "member";
    const meta = AUTH_MODES[authState.mode];
    fillSupabaseConfigFields();
    $("#auth-title").textContent = meta.title;
    $("#auth-submit").textContent = meta.submit;
    $("#auth-display-name-row").style.display = meta.showName ? "grid" : "none";
    $("#auth-password").autocomplete = meta.showName ? "new-password" : "current-password";
    setAuthMessage(isSupabaseConfigured() ? meta.message : `${meta.message} 먼저 Supabase 연결 정보를 저장하세요.`);
    const dlg = $("#dlg-auth");
    if (!dlg.open) dlg.showModal();
    setTimeout(() => {
      const target = isSupabaseConfigured() ? $("#auth-email") : $("#supabase-url");
      target && target.focus();
    }, 0);
  }

  async function handleAuthSubmit() {
    const mode = authState.mode;
    const meta = AUTH_MODES[mode] || AUTH_MODES.member;
    if (!isSupabaseConfigured()) {
      const saved = await saveSupabaseConfigFromDialog();
      if (!saved) return;
    }
    const email = ($("#auth-email").value || "").trim();
    const password = $("#auth-password").value || "";
    const displayName = ($("#auth-display-name").value || "").trim();
    if (!email || !password) {
      setAuthMessage("이메일과 비밀번호를 입력하세요.", "error");
      return;
    }
    if (password.length < 6) {
      setAuthMessage("비밀번호는 6자 이상이어야 합니다.", "error");
      return;
    }
    setAuthBusy(true);
    try {
      const client = getSupabaseClient();
      if (mode === "signup") {
        const options = { data: { display_name: displayName } };
        if (location.protocol === "http:" || location.protocol === "https:") {
          options.emailRedirectTo = location.href.split("#")[0];
        }
        const { data, error } = await client.auth.signUp({ email, password, options });
        if (error) throw error;
        if (data.session && data.user) {
          await ensureOwnProfile(data.user, displayName);
          authState.session = data.session;
          authState.profile = await loadAuthProfile(data.user);
          updateAuthChrome();
          $("#dlg-auth").close();
          toast("회원가입 완료. 로그인했어요");
        } else {
          setAuthMessage("회원가입 요청이 완료됐어요. 이메일 인증이 켜져 있다면 받은 편지함에서 확인 링크를 눌러주세요.", "ok");
        }
        return;
      }

      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) await ensureOwnProfile(data.user);
      authState.session = data.session || null;
      authState.profile = data.user ? await loadAuthProfile(data.user) : null;

      if (mode === "admin" && !isAdminProfile(authState.profile)) {
        const profileError = authState.profile && authState.profile.profileError;
        await client.auth.signOut();
        authState.session = null;
        authState.profile = null;
        updateAuthChrome();
        const msg = profileError
          ? "profiles 테이블 또는 RLS 설정을 확인해야 합니다."
          : "관리자 권한이 없습니다. Supabase SQL Editor에서 해당 계정의 role을 admin으로 승격하세요.";
        setAuthMessage(msg, "error");
        return;
      }

      updateAuthChrome();
      $("#dlg-auth").close();
      toast(mode === "admin" ? "관리자로 로그인했어요" : "회원 로그인 완료");
      if (mode === "admin") openAdminPage();
    } catch (err) {
      setAuthMessage(authErrorMessage(err), "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutAuth() {
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) return;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
      toast("로그아웃했어요");
    } catch (err) {
      toast(authErrorMessage(err));
    }
  }

  function formatAdminDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(value);
    }
  }

  async function openAdminPage() {
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) {
      openAuthDialog("admin");
      setAuthMessage("Supabase 연결 정보를 먼저 저장하세요.", "error");
      return;
    }
    if (!authState.session || !authState.session.user) {
      openAuthDialog("admin");
      return;
    }
    authState.profile = await loadAuthProfile(authState.session.user);
    updateAuthChrome();
    if (!isAdminProfile(authState.profile)) {
      openAuthDialog("admin");
      setAuthMessage("관리자 권한이 필요합니다. 관리자 계정으로 다시 로그인하세요.", "error");
      return;
    }
    const dlg = $("#dlg-admin");
    if (!dlg.open) dlg.showModal();
    renderAdminPage();
  }

  async function renderAdminPage() {
    const profile = authState.profile || {};
    const user = authState.session && authState.session.user;
    const score = C.state.score;
    $("#admin-summary").innerHTML = [
      ["계정", user && user.email ? user.email : profile.email || "-"],
      ["권한", profile.role || "member"],
      ["현재 악보", `${score.meta.title || "제목 없음"} · ${score.measures.length}마디`],
    ].map(([label, value]) => `<div class="admin-stat"><span>${htmlEsc(label)}</span><b>${htmlEsc(value)}</b></div>`).join("");

    const usersHost = $("#admin-users");
    usersHost.innerHTML = `<div class="admin-empty">회원 목록을 불러오는 중입니다.</div>`;
    const client = getSupabaseClient({ requireConfig: false });
    if (!client || !isAdminProfile(profile)) {
      usersHost.innerHTML = `<div class="admin-empty">관리자 권한이 확인되지 않았습니다.</div>`;
      return;
    }
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id,email,display_name,role,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!data || !data.length) {
        usersHost.innerHTML = `<div class="admin-empty">표시할 회원 프로필이 없습니다.</div>`;
        return;
      }
      usersHost.innerHTML = `<table>
        <thead><tr><th>이메일</th><th>이름</th><th>권한</th><th>가입일</th></tr></thead>
        <tbody>
          ${data.map((row) => `<tr>
            <td>${htmlEsc(row.email || "-")}</td>
            <td>${htmlEsc(row.display_name || "-")}</td>
            <td><span class="admin-badge ${row.role === "admin" ? "role-admin" : ""}">${htmlEsc(row.role || "member")}</span></td>
            <td>${htmlEsc(formatAdminDate(row.created_at) || "-")}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    } catch (err) {
      usersHost.innerHTML = `<div class="admin-empty">회원 목록을 불러오지 못했어요. ${htmlEsc(authErrorMessage(err))}</div>`;
    }
  }

  function bindAuth() {
    $("#btn-signup").addEventListener("click", () => openAuthDialog("signup"));
    $("#btn-member-login").addEventListener("click", () => openAuthDialog("member"));
    $("#btn-admin-login").addEventListener("click", () => openAuthDialog("admin"));
    $("#btn-admin-page").addEventListener("click", openAdminPage);
    $("#btn-logout").addEventListener("click", signOutAuth);
    $("#btn-save-supabase-config").addEventListener("click", saveSupabaseConfigFromDialog);
    $("#btn-clear-supabase-config").addEventListener("click", clearSupabaseConfig);
    $("#auth-submit").addEventListener("click", handleAuthSubmit);
    $("#btn-admin-refresh").addEventListener("click", renderAdminPage);
    ["#auth-display-name", "#auth-email", "#auth-password", "#supabase-url", "#supabase-key"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAuthSubmit();
        }
      });
    });
    $("#dlg-auth").addEventListener("close", () => {
      $("#auth-password").value = "";
      setAuthBusy(false);
    });
    initSupabaseAuth({ quiet: true });
  }

  /* ---------------- 파일 열기 공통 처리 (메뉴·드래그&드롭) ---------------- */
  function handleLoadedScore(loaded, name, err, report) {
    if (!loaded) {
      toast(`열 수 없어요: ${name}${err && err.message ? " — " + err.message : ""}`);
      return;
    }
    C.setScore(loaded);
    ui.selection = null; ui.selAnchor = null; ui.cursorId = null; ui.lastPitch = null;
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
      if (!/\.(json|musicxml|xml|mxl)$/i.test(file.name)) {
        toast("악보 파일(.json/.musicxml/.xml/.mxl)을 끌어다 놓아주세요");
        return;
      }
      IO.loadScoreFile(file, handleLoadedScore);
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
    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-act]");
      if (!item) return;
      menu.classList.remove("open");
      const act = item.dataset.act;
      const score = C.state.score;
      if (act === "new") {
        if (!confirm("새 악보를 만들까요? (현재 악보는 자동 저장에서 사라져요. 필요하면 먼저 저장하세요)")) return;
        C.setScore(C.createScore({}));
        ui.selection = null; ui.cursorId = null; ui.lastPitch = null;
        stopPlayback(); update();
        openSettings();
      } else if (act === "open") {
        IO.openScoreDialog(handleLoadedScore);
      } else if (act === "save") {
        IO.saveJSON(score); toast("악보 파일(.json)을 내려받았어요");
      } else if (act === "musicxml") {
        IO.download(IO.safeName(score.meta.title) + ".musicxml", IO.exportMusicXML(score), "application/vnd.recordare.musicxml+xml");
        toast("MusicXML로 내보냈어요 — MuseScore에서 열 수 있어요");
      } else if (act === "midi") {
        IO.download(IO.safeName(score.meta.title) + ".mid", P.exportMidi(score), "audio/midi");
        toast("MIDI 파일을 내려받았어요");
      } else if (act === "print") {
        window.print();
      } else if (act === "manual-quick") {
        window.open("manual/scoreforge_quick_start_user_manual.html", "_blank", "noopener");
        toast("퀵스타트 설명서를 새 탭으로 열었어요");
      } else if (act === "manual-user") {
        window.open("manual/scoreforge_user_manual.html", "_blank", "noopener");
        toast("유저 매뉴얼을 새 탭으로 열었어요");
      } else if (act.startsWith("demo-")) {
        const key = act.slice(5);
        if (IO.DEMOS[key]) {
          C.setScore(IO.DEMOS[key]());
          ui.selection = null; ui.cursorId = null;
          stopPlayback(); update();
          toast("데모 악보를 불러왔어요 — 스페이스로 재생해 보세요");
        }
      }
    });
  }

  function mixerRecord(score, part) {
    C.ensureParts(score);
    const rec = score.playbackSettings.mixer[part.id] || { mute: false, solo: false, volume: 1, pan: 0 };
    return {
      mute: !!rec.mute,
      solo: !!rec.solo,
      volume: rec.volume === undefined ? 1 : +rec.volume,
      pan: +rec.pan || 0,
    };
  }

  function renderMixerRows() {
    const score = C.state.score;
    C.ensureParts(score);
    $("#mixer-rows").innerHTML = score.parts.map((part, idx) => {
      const mx = mixerRecord(score, part);
      return `<div class="mixer-row" data-part="${part.id}">
        <b>${part.name || "파트 " + (idx + 1)}</b>
        <label><input type="checkbox" data-mix="mute" ${mx.mute ? "checked" : ""}> M</label>
        <label><input type="checkbox" data-mix="solo" ${mx.solo ? "checked" : ""}> S</label>
        <label>Vol <input type="range" min="0" max="150" value="${Math.round(mx.volume * 100)}" data-mix="volume"></label>
        <label>Pan <input type="range" min="-100" max="100" value="${Math.round(mx.pan * 100)}" data-mix="pan"></label>
      </div>`;
    }).join("");
  }

  function updateMixerValue(partId, key, value) {
    C.mutate("믹서", (score) => {
      C.ensureParts(score);
      const rec = score.playbackSettings.mixer[partId] || { mute: false, solo: false, volume: 1, pan: 0 };
      if (key === "mute" || key === "solo") rec[key] = !!value;
      if (key === "volume") rec.volume = Math.max(0, Math.min(1.5, +value / 100));
      if (key === "pan") rec.pan = Math.max(-1, Math.min(1, +value / 100));
      score.playbackSettings.mixer[partId] = rec;
    });
    stopPlayback();
    update();
  }

  function bindMixer() {
    $("#btn-mixer").addEventListener("click", () => {
      renderMixerRows();
      $("#dlg-mixer").showModal();
    });
    $("#mixer-rows").addEventListener("change", (e) => {
      const input = e.target.closest("[data-mix]");
      const row = e.target.closest(".mixer-row");
      if (!input || !row) return;
      const key = input.dataset.mix;
      updateMixerValue(row.dataset.part, key, input.type === "checkbox" ? input.checked : input.value);
      renderMixerRows();
    });
  }

  function commandItems() {
    return [
      { id: "input", label: "입력 모드 전환", run: () => setInputMode(!ui.inputMode) },
      { id: "chord", label: "코드 기호 입력", run: applyChordSymbol },
      { id: "lyric", label: "가사 입력", run: () => $("#btn-lyric").click() },
      { id: "rehearsal", label: "리허설 마크", run: applyRehearsalMark },
      { id: "staff-text", label: "스태프 텍스트", run: applyStaffText },
      { id: "repeat-start", label: "시작 반복", run: applyStartRepeat },
      { id: "repeat-end", label: "끝 반복", run: applyEndRepeat },
      { id: "break-system", label: "시스템 줄바꿈", run: () => applyMeasureBreak("system") },
      { id: "break-page", label: "페이지 나눔", run: () => applyMeasureBreak("page") },
      { id: "break-section", label: "섹션 브레이크", run: () => applyMeasureBreak("section") },
      { id: "navigator", label: "내비게이터 열기", run: openNavigator },
      { id: "timeline", label: "타임라인 열기", run: openTimelinePanel },
      { id: "goto", label: "마디/리허설 이동", run: gotoQuery },
      { id: "musicxml", label: "MusicXML 내보내기", run: () => IO.download(IO.safeName(C.state.score.meta.title) + ".musicxml", IO.exportMusicXML(C.state.score), "application/vnd.recordare.musicxml+xml") },
      { id: "midi", label: "MIDI 내보내기", run: () => IO.download(IO.safeName(C.state.score.meta.title) + ".mid", P.exportMidi(C.state.score), "audio/midi") },
      { id: "settings", label: "악보 설정", run: openSettings },
      { id: "mixer", label: "믹서 열기", run: () => $("#btn-mixer").click() },
    ];
  }
  function openCommandPalette() {
    const dlg = $("#dlg-command");
    const input = $("#cmd-input");
    dlg.showModal();
    input.value = "";
    renderCommands("");
    setTimeout(() => input.focus(), 0);
  }
  function renderCommands(q) {
    const clean = String(q || "").trim().toLowerCase();
    const items = commandItems().filter(c => !clean || c.label.toLowerCase().includes(clean) || c.id.includes(clean)).slice(0, 12);
    $("#cmd-list").innerHTML = items.map((c, i) => `<button class="cmd-item ${i === 0 ? "active" : ""}" data-cmd="${c.id}">${c.label}</button>`).join("");
  }
  function runCommand(id) {
    const cmd = commandItems().find(c => c.id === id);
    if (!cmd) return;
    $("#dlg-command").close();
    cmd.run();
  }
  function bindCommandPalette() {
    $("#cmd-input").addEventListener("input", (e) => renderCommands(e.target.value));
    $("#cmd-input").addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const first = $("#cmd-list .cmd-item.active") || $("#cmd-list .cmd-item");
        if (first) runCommand(first.dataset.cmd);
      }
      if (e.key === "Escape") $("#dlg-command").close();
    });
    $("#cmd-list").addEventListener("click", (e) => {
      const item = e.target.closest(".cmd-item");
      if (item) runCommand(item.dataset.cmd);
    });
  }

  function openSettings() {
    const score = C.state.score;
    const active = C.activeRef(score);
    $("#set-title").value = score.meta.title || "";
    $("#set-composer").value = score.meta.composer || "";
    $("#set-ensemble").value = C.ensembleKey(score) === "custom" ? "solo" : C.ensembleKey(score);
    $("#set-clef").value = active.clef;
    $("#set-key").innerHTML = Object.keys(C.KEY_NAMES)
      .sort((a, b) => +a - +b)
      .map(k => `<option value="${k}">${C.KEY_NAMES[k]}</option>`).join("");
    $("#set-key").value = String(score.keySig);
    $("#set-time").value = score.timeSig.num + "/" + score.timeSig.den;
    $("#set-tempo").value = score.tempo;
    const layout = C.ensureLayout(score);
    $("#set-measures-system").value = layout.measuresPerSystem || "";
    $("#set-page-size").value = layout.pageSize || "A4";
    $("#set-orientation").value = layout.orientation || "portrait";
    $("#set-margin").value = layout.marginLeft || 52;
    $("#set-note-spacing").value = layout.noteSpacing || 1;
    $("#set-system-gap").value = layout.systemGap || 1;
    $("#set-staff-gap").value = layout.staffGap || 1;
    $("#set-beam-thickness").value = layout.beamThickness || 1;
    $("#dlg-settings").showModal();
  }

  function bindSettings() {
    $("#btn-settings").addEventListener("click", openSettings);
    $("#set-apply").addEventListener("click", (e) => {
      e.preventDefault();
      const score = C.state.score;
      const [num, den] = $("#set-time").value.split("/").map(Number);
      const newKey = +$("#set-key").value;
      const newClef = $("#set-clef").value;
      const newEnsemble = $("#set-ensemble").value;
      const newTempo = Math.max(30, Math.min(280, +$("#set-tempo").value || 100));
      const measuresPerSystem = Math.max(0, Math.min(16, +$("#set-measures-system").value || 0));
      const pageSize = $("#set-page-size").value;
      const orientation = $("#set-orientation").value;
      const page = C.pageSizeDefaults(pageSize, orientation);
      const margin = Math.max(20, Math.min(180, +$("#set-margin").value || 52));
      const noteSpacing = Math.max(0.75, Math.min(1.55, +$("#set-note-spacing").value || 1));
      const systemGap = Math.max(0.75, Math.min(1.8, +$("#set-system-gap").value || 1));
      const staffGap = Math.max(0.75, Math.min(1.8, +$("#set-staff-gap").value || 1));
      const beamThickness = Math.max(0.7, Math.min(1.8, +$("#set-beam-thickness").value || 1));
      C.mutate("악보 설정", (s2) => {
        s2.meta.title = $("#set-title").value.trim() || "제목 없음";
        s2.meta.composer = $("#set-composer").value.trim();
        const ensembleChanged = C.ensembleKey(s2) !== newEnsemble;
        if (ensembleChanged) C.applyEnsemble(s2, newEnsemble);
        else {
          const active = C.activeRef(s2);
          active.staff.clef = newClef;
          if (active.partIdx === 0 && active.staffIdx === 0) s2.clef = newClef;
        }
        s2.keySig = newKey;
        s2.tempo = newTempo;
        Object.assign(C.ensureLayout(s2), {
          pageSize, orientation,
          width: page.width, height: page.height,
          marginTop: margin, marginRight: margin, marginBottom: margin, marginLeft: margin,
          measuresPerSystem, noteSpacing, systemGap, staffGap, beamThickness,
        });
        if (s2.timeSig.num !== num || s2.timeSig.den !== den) C.rebar(s2, { num, den });
      });
      stopPlayback();
      $("#dlg-settings").close();
      update();
    });
    $("#set-add-measures").addEventListener("click", (e) => {
      e.preventDefault();
      C.mutate("마디 추가", (s2) => {
        for (const ref of C.staffRefs(s2))
          for (let i = 0; i < 4; i++) ref.measures.push({ events: [C.fullRest(s2)] });
        C.ensureParts(s2);
      });
      update(); toast("마디 4개를 추가했어요");
    });
    $("#set-del-measure").addEventListener("click", (e) => {
      e.preventDefault();
      C.mutate("마디 삭제", (s2) => {
        for (const ref of C.staffRefs(s2))
          if (ref.measures.length > 1) ref.measures.pop();
        C.ensureParts(s2);
      });
      ui.selection = null; ui.cursorId = null;
      update(); toast("마지막 마디를 삭제했어요");
    });
    $$("#dlg-settings [data-transpose]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const semis = +btn.dataset.transpose;
        C.mutate("조옮김", (s2) => C.transposeScore(s2, semis));
        update();
        toast(semis > 0 ? `${semis}반음 올렸어요` : `${-semis}반음 내렸어요`);
        $("#set-key").value = String(C.state.score.keySig);
      });
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
  const DUR_KEYS = { "7": 0, "6": 1, "5": 2, "4": 3, "3": 4 };
  function bindKeys() {
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
      if ($("#dlg-settings").open || $("#dlg-welcome").open || $("#dlg-help").open || $("#dlg-auth").open || $("#dlg-admin").open) return;
      const k = e.key;
      const K = k.toUpperCase();

      if (e.altKey && /^[1-4]$/.test(k)) {
        e.preventDefault();
        setCurrentVoice(+k);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (K === "Z") { e.preventDefault(); e.shiftKey ? C.redo() : C.undo(); afterHistory(); return; }
        if (K === "Y") { e.preventDefault(); C.redo(); afterHistory(); return; }
        if (K === "S") { e.preventDefault(); IO.saveJSON(C.state.score); toast("악보 파일을 내려받았어요"); return; }
        if (K === "C") { e.preventDefault(); copySelection(); return; }
        if (K === "V") { e.preventDefault(); pasteClipboard(); return; }
        if (K === "X") { e.preventDefault(); if (copySelection({ quiet: true })) { deleteSelection(); toast("잘라냈어요"); } return; }
        if ((K === "P" && e.shiftKey) || K === "K") { e.preventDefault(); openCommandPalette(); return; }
        if (K === "F" || K === "G") { e.preventDefault(); gotoQuery(); return; }
        if (/^[2-9]$/.test(k)) { e.preventDefault(); applyTuplet(+k); return; }
        if (K === "ARROWUP" || k === "ArrowUp") { e.preventDefault(); transposeSelection(12); return; }
        if (k === "ArrowDown") { e.preventDefault(); transposeSelection(-12); return; }
        return;
      }

      if (k === "F11") { e.preventDefault(); openTimelinePanel(); return; }
      if (k === "F12") { e.preventDefault(); openNavigator(); return; }
      if (k === " ") { e.preventDefault(); togglePlay(); return; }
      if (k === "Escape") {
        if (P.player.playing) { stopPlayback(); return; }
        if (ui.inputMode) { setInputMode(false); return; }
        if (ui.selection) { ui.selection = null; ui.selAnchor = null; update(); return; }
        return;
      }
      // 표현 기호 (MuseScore 관례: Shift+S/V/N/O, S=이음줄, <>=쐐기)
      if (k === "<") { toggleHairpin("cresc"); return; }
      if (k === ">") { toggleHairpin("dim"); return; }
      if (e.shiftKey) {
        if (K === "S") { applyArticulation("staccato"); return; }
        if (K === "T") { applyTempoMark(); return; }
        if (K === "L") { applyStaffText(); return; }
        if (K === "V") { applyArticulation("accent"); return; }
        if (K === "N") { applyArticulation("tenuto"); return; }
        if (K === "O") { applyArticulation("marcato"); return; }
      }
      if (K === "S") { toggleSlur(); return; }
      if (K === "R") { applyRehearsalMark(); return; }
      if (K === "N" && !e.repeat) { setInputMode(!ui.inputMode); return; }
      if (k in DUR_KEYS) { setDuration({ ...DURS[DUR_KEYS[k]], dots: ui.curDur.dots }); return; }
      if (k === ".") { toggleDot(); return; }
      if (k === "/") { e.preventDefault(); applyGraceBefore(); return; }
      if (k === "0") {
        if (ui.inputMode) { const pos = cursorPos(); doInput(pos.mIdx, pos.tick, null); }
        else deleteSelection();
        return;
      }
      if (ui.inputMode && C.isPercussionRef(activeRef())) {
        const drumKey = { K: "kick", S: "snare", H: "closed-hihat", O: "open-hihat", C: "crash" }[K];
        if (drumKey) { e.preventDefault(); inputDrum(drumKey); return; }
      }
      if (K >= "A" && K <= "G" && K.length === 1) {
        inputLetter(K, e.shiftKey);
        return;
      }
      if (K === "T") { toggleTie(); return; }
      if (K === "L") {
        const found = selectedEvent() || targetEvent();
        if (found && found.ev.type === "note") { ui.selection = found.ev.id; update(); editLyric(found.ev.id); }
        return;
      }
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSelection(); return; }

      if (k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault();
        transposeSelection(k === "ArrowUp" ? 1 : -1);
        return;
      }
      if (k === "ArrowLeft" || k === "ArrowRight") {
        e.preventDefault();
        moveSelection(k === "ArrowRight" ? 1 : -1, e.shiftKey);
        return;
      }
    });
  }

  function moveSelection(dir, extend) {
    const score = C.state.score;
    if (ui.inputMode) {
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
      C.mutate("빠르기", (s2) => { s2.tempo = v; });
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
    canvas.addEventListener("mousemove", onCanvasMove);
    canvas.addEventListener("mouseleave", () => E.drawGhost(null));
    canvas.addEventListener("click", (e) => {
      if (ui.dragging && ui.dragging.moved) return;
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
        if (el.isContentEditable) return;
        el.contentEditable = "plaintext-only";
        el.focus();
        document.execCommand && document.execCommand("selectAll", false, null);
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
    buildToolbar();
    buildPiano();
    bindThemePicker();
    bindButtons();
    bindAuth();
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
    C.onChange(() => { /* mutate 이후 update()는 호출부가 수행 */ });
    update({ noSave: !saved });
    maybeShowWelcome();

    E.loadFont(() => update({ noSave: true })); // Bravura 로드되면 다시 그림
  }

  document.addEventListener("DOMContentLoaded", start);
  SF.app = { ui, update, toast, auth: authState };
})(window.SF);
