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
    dragging: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------------- 렌더 ---------------- */
  let layoutCache = null;
  function update(opts = {}) {
    const score = C.state.score;
    const res = E.render(score, { selection: selectedIds() });
    layoutCache = res.layout;
    $("#svg-host").innerHTML = res.svg;
    $("#t-title").textContent = score.meta.title || "제목 없음";
    $("#t-composer").textContent = score.meta.composer || "";
    $("#t-composer").style.display = score.meta.composer ? "" : "none";
    applyZoom();
    refreshToolbar();
    refreshCursor();
    updateStatus();
    if (!opts.noSave) IO.autosave(score);
  }

  function refreshCursor() {
    if (ui.inputMode && ui.cursorId) E.drawInputCursor(ui.cursorId);
    else E.drawInputCursor(null);
  }

  function applyZoom() {
    const host = $("#paper");
    const wrap = $("#canvas");
    const avail = wrap.clientWidth - 28;
    ui.fitScale = Math.min(1, avail / E.PAGE_W);
    const s = ui.fitScale * ui.zoom;
    host.style.width = E.PAGE_W + "px";
    host.style.transform = `scale(${s})`;
    host.style.transformOrigin = "top left";
    const svg = $("#score-svg");
    const h = svg ? svg.viewBox.baseVal.height : 600;
    const headH = $("#paper-head").offsetHeight;
    wrap.querySelector(".paper-sizer").style.height = (h + headH + 70) * s + "px";
    wrap.querySelector(".paper-sizer").style.width = E.PAGE_W * s + "px";
    $("#zoom-label").textContent = Math.round(ui.zoom * 100) + "%";
  }

  /* ---------------- 좌표 변환 ---------------- */
  function svgPoint(evt) {
    const svg = $("#score-svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return null;
    return {
      x: (evt.clientX - r.left) / r.width * E.PAGE_W,
      y: (evt.clientY - r.top) / r.height * svg.viewBox.baseVal.height,
    };
  }

  /* ---------------- 입력 도우미 ---------------- */
  function activeRef() { return C.activeRef(C.state.score); }
  function setActiveStaff(partIdx, staffIdx, opts = {}) {
    C.setActiveStaff(C.state.score, partIdx, staffIdx);
    if (!opts.keepCursor) {
      const ref = C.activeRef(C.state.score);
      ui.cursorId = ref.measures[0]?.events[0]?.id || null;
    }
    refreshToolbar();
    updateStatus();
  }
  function effectiveAlter(score, mIdx, beforeId, step, oct, ctx) {
    let alter = C.keyAlterFor(step, score.keySig);
    const evs = C.staffMeasures(score, ctx)[mIdx].events;
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
    const evs = C.staffMeasures(score, ctx)[mIdx].events;
    let t = Fraction.ZERO;
    for (const ev of evs) {
      const end = t.add(C.durValue(ev.dur));
      if (tick.gte(t) && tick.lt(end)) return ev.id;
      t = end;
    }
    return null;
  }

  /* 입력 실행 (커서/세그먼트 위치에) */
  function doInput(mIdx, tick, pitches, ctx = activeRef()) {
    const dur = { ...ui.curDur };
    let inserted = null;
    C.mutate(pitches ? "음표 입력" : "쉼표 입력", (score) => {
      C.setActiveStaff(score, ctx.partIdx, ctx.staffIdx);
      inserted = C.inputAt(score, mIdx, tick, dur, pitches, ctx);
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

  function cursorPos() {
    const score = C.state.score;
    let found = ui.cursorId && C.findEvent(score, ui.cursorId);
    const active = activeRef();
    if (found && (found.partIdx !== active.partIdx || found.staffIdx !== active.staffIdx)) found = null;
    if (!found) {
      ui.cursorId = active.measures[0].events[0].id;
      found = C.findEvent(score, ui.cursorId);
    }
    const tick = C.eventStartTick(found.measures[found.m], found.e);
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
      const tick = C.eventStartTick(found.measures[found.m], found.e);
      const pitches = found.ev.type === "note" ? found.ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })) : null;
      const lyric = found.ev.lyric;
      let inserted = null;
      C.mutate("음길이 변경", (score) => {
        inserted = C.inputAt(score, found.m, tick, { ...dur, dots: ui.curDur.dots }, pitches, found);
        if (lyric && inserted) {
          const f2 = C.findEvent(score, inserted);
          if (f2) f2.ev.lyric = lyric;
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
      const tick = C.eventStartTick(found.measures[found.m], found.e);
      const pitches = ev.type === "note" ? ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })) : null;
      let inserted = null;
      C.mutate("점음표", (score) => { inserted = C.inputAt(score, found.m, tick, newDur, pitches, found); });
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
      const tick = C.eventStartTick(nx.measures[nx.m], nx.e);
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
    input.value = found.ev.lyric || "";
    input.focus(); input.select();

    const commit = (advance) => {
      const text = input.value.trim();
      const cur = C.findEvent(C.state.score, id);
      if (cur && (cur.ev.lyric || "") !== text) {
        C.mutate("가사", (score) => {
          const f = C.findEvent(score, id);
          if (f) f.ev.lyric = text || undefined;
        });
      }
      box.style.display = "none";
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
      } else if (e.key === "Escape") {
        box.style.display = "none";
      } else if (e.key === "Tab") {
        e.preventDefault(); commit(true);
      }
    };
    input.onblur = () => { if (box.style.display !== "none") commit(false); };
  }

  /* ---------------- 재생 ---------------- */
  function buildTimeline() {
    // 모든 이벤트(쉼표 포함)의 시각 → 레이아웃 x와 결합
    const score = C.state.score;
    const spw = 4 * 60 / score.tempo;
    const L = C.measureLen(score);
    const mLenSec = L.value * spw;
    const pts = [];
    const layout = layoutCache || E.getLayout();
    for (const ref of C.staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        let tick = Fraction.ZERO;
        for (const ev of ref.measures[m].events) {
          const le = layout.eventsById.get(ev.id);
          if (le) pts.push({ t: m * mLenSec + tick.value * spw, x: le.x, sys: le.sys, staff: le.staff, id: ev.id });
          tick = tick.add(C.durValue(ev.dur));
        }
      }
    }
    for (let m = 0; m < score.measures.length; m++) {
      // 마디 끝점
      const sysM = layout.systems.find(S => S.measures.some(M => M.idx === m));
      if (sysM) {
        const M = sysM.measures.find(M2 => M2.idx === m);
        pts.push({ t: (m + 1) * mLenSec, x: M.x1, sys: sysM, id: null });
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
    P.play(fromSec);
  }

  function playFromSelection() {
    const score = C.state.score;
    let fromSec = 0;
    const found = selectedEvent();
    if (found) {
      const spw = 4 * 60 / score.tempo;
      const L = C.measureLen(score).value * spw;
      fromSec = found.m * L + C.eventStartTick(found.measures[found.m], found.e).value * spw;
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

    // 선택/커서 기준 활성 음길이
    let activeDur = ui.curDur;
    const found = selectedEvent();
    if (found && !ui.inputMode && !found.ev.full) activeDur = found.ev.dur;
    $$("#dur-buttons .dur").forEach((b, i) => {
      const d = DURS[i];
      b.classList.toggle("on", d.n === activeDur.n && d.d === activeDur.d);
    });
    $("#btn-dot").classList.toggle("on", !!(found && !ui.inputMode ? found.ev.dur.dots : ui.curDur.dots));

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
    const dyn = tgt ? tgt.ev.dynamic : null;
    $$(".dynbtn").forEach(b => b.classList.toggle("on", dyn === b.dataset.dyn));

    $("#btn-undo").disabled = !C.canUndo();
    $("#btn-redo").disabled = !C.canRedo();
    $("#tempo-input").value = score.tempo;
    const staffSel = $("#staff-select");
    const staffValue = `${active.partIdx}:${active.staffIdx}`;
    const staffOptions = refs.map(ref => {
      const suffix = ref.part.staves.length > 1 ? ` ${ref.staffIdx + 1}` : "";
      return `<option value="${ref.partIdx}:${ref.staffIdx}">${ref.name}${suffix}</option>`;
    }).join("");
    if (staffSel.innerHTML !== staffOptions) staffSel.innerHTML = staffOptions;
    staffSel.value = staffValue;
    $("#instrument-select").value = active.instrument;
    $("#piano-bar").style.display = ui.pianoVisible ? "" : "none";
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
      text = `${ids.size}개 선택 — S=이음줄 · < >=쐐기 · 기호 버튼=일괄 적용`;
    } else if (found) {
      const ev = found.ev;
      if (ev.type === "note") {
        const names = ev.notes.map(n => `${C.pitchName(n, "ko")}(${C.pitchName(n)})`).join("·");
        const extra = (ev.artics && ev.artics.length ? " · " + ev.artics.join(",") : "") + (ev.dynamic ? " · " + ev.dynamic : "");
        text = `${found.name}${found.part.staves.length > 1 ? " " + (found.staffIdx + 1) : ""} · 마디 ${found.m + 1} · ${durName2(ev)} · ${names}${extra}`;
      } else {
        text = `${found.name}${found.part.staves.length > 1 ? " " + (found.staffIdx + 1) : ""} · 마디 ${found.m + 1} · ${ev.full ? "온마디 쉼표" : durName2(ev) + " 쉼표"}`;
      }
    } else if (ui.inputMode && ui.cursorId) {
      const f = C.findEvent(score, ui.cursorId);
      if (f) text = `입력 위치: ${activeName} · 마디 ${f.m + 1} · ${C.durName(ui.curDur)}로 입력`;
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
      if ($("#dlg-settings").open || $("#dlg-welcome").open || $("#dlg-help").open) return;
      const k = e.key;
      const K = k.toUpperCase();

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (K === "Z") { e.preventDefault(); e.shiftKey ? C.redo() : C.undo(); afterHistory(); return; }
        if (K === "Y") { e.preventDefault(); C.redo(); afterHistory(); return; }
        if (K === "S") { e.preventDefault(); IO.saveJSON(C.state.score); toast("악보 파일을 내려받았어요"); return; }
        if (/^[2-9]$/.test(k)) { e.preventDefault(); applyTuplet(+k); return; }
        if (K === "ARROWUP" || k === "ArrowUp") { e.preventDefault(); transposeSelection(12); return; }
        if (k === "ArrowDown") { e.preventDefault(); transposeSelection(-12); return; }
        return;
      }

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
        if (K === "V") { applyArticulation("accent"); return; }
        if (K === "N") { applyArticulation("tenuto"); return; }
        if (K === "O") { applyArticulation("marcato"); return; }
      }
      if (K === "S") { toggleSlur(); return; }
      if (K === "N" && !e.repeat) { setInputMode(!ui.inputMode); return; }
      if (k in DUR_KEYS) { setDuration({ ...DURS[DUR_KEYS[k]], dots: ui.curDur.dots }); return; }
      if (k === ".") { toggleDot(); return; }
      if (k === "0") {
        if (ui.inputMode) { const pos = cursorPos(); doInput(pos.mIdx, pos.tick, null); }
        else deleteSelection();
        return;
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
      select(ref.measures[0].events[0].id);
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
    $("#btn-tie").addEventListener("click", toggleTie);
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
    $("#btn-delete").addEventListener("click", deleteSelection);
    $("#btn-piano").addEventListener("click", () => {
      ui.pianoVisible = !ui.pianoVisible;
      refreshToolbar(); applyZoom();
    });
    $("#btn-help").addEventListener("click", () => $("#dlg-help").showModal());
    $("#btn-zoom-in").addEventListener("click", () => { ui.zoom = Math.min(2.4, ui.zoom + 0.15); applyZoom(); });
    $("#btn-zoom-out").addEventListener("click", () => { ui.zoom = Math.max(0.5, ui.zoom - 0.15); applyZoom(); });

    $("#tempo-input").addEventListener("change", () => {
      const v = Math.max(30, Math.min(280, +$("#tempo-input").value || 100));
      C.mutate("빠르기", (s2) => { s2.tempo = v; });
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
    buildToolbar();
    buildPiano();
    bindButtons();
    bindMenu();
    bindSettings();
    bindWelcome();
    bindKeys();
    bindDragDrop();

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
  SF.app = { ui, update, toast };
})(window.SF);
