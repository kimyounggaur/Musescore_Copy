/* ScoreForge editing: isolated UI responsibilities; no model ownership. */
"use strict";
(function (SF) {
  SF.editing = { create(api) {
  const { C, E, P, IO, ui, $, $$, Fraction } = api;
  const update = (...args) => api.update(...args);
  const activeRef = (...args) => api.activeRef(...args);
  const nearestOctave = (...args) => api.nearestOctave(...args);
  const clonePlain = (...args) => api.clonePlain(...args);
  const selectedEvent = (...args) => api.selectedEvent(...args);
  const selectedIds = (...args) => api.selectedIds(...args);
  const rangeNoteEnds = (...args) => api.rangeNoteEnds(...args);
  const targetEvent = (...args) => api.targetEvent(...args);
  const editChordSymbol = (...args) => api.editChordSymbol(...args);
  const stopPlayback = (...args) => api.stopPlayback(...args);
  const refreshToolbar = (...args) => api.refreshToolbar(...args);
  const toast = (...args) => api.toast(...args);
  const flashHint = (...args) => api.flashHint(...args);
  const start = (...args) => api.start(...args);
  /* ---------------- 편집 동작 ---------------- */
  function setDuration(dur) {
    ui.curDur = { ...dur, dots: Math.min(ui.curDur.dots || 0, C.maxDots(dur)) };
    const found = selectedEvent();
    if (found && !ui.inputMode) {
      if (C.durEq(found.ev.dur, ui.curDur) && !found.ev.full) { update(); return; }
      let inserted;
      C.mutate("음길이 변경", score => { inserted = C.reinputWithDur(score, found, ui.curDur); });
      ui.selection = inserted; ui.selAnchor = inserted; ui.selectedNoteIdx = null;
    }
    update();
  }
  function canDot(dur) { return C.maxDots(dur) > 0; }
  function toggleDot() {
    const found = selectedEvent();
    const dur = found && !ui.inputMode ? found.ev.dur : ui.curDur;
    if (found?.ev.full && !ui.inputMode) return;
    const newDur = { ...dur, dots: ((dur.dots || 0) + 1) % (C.maxDots(dur) + 1) };
    if (found && !ui.inputMode) {
      let id;
      C.mutate("점음표", score => { id = C.reinputWithDur(score, found, newDur); });
      ui.selection = id; ui.selAnchor = id;
    }
    ui.curDur = newDur; update();
  }

  function applyAccidental(alter) {
    const found = targetEvent();
    if (!found || found.ev.type !== "note") { flashHint("먼저 음표를 선택하세요"); return; }
    C.mutate("임시표", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      if (ui.selectedNoteIdx !== null) C.setNoteAccidental(score, f.ev.id, ui.selectedNoteIdx, alter);
      else for (const n of f.ev.notes) n.alter = alter;
      C.normalizeTies(score);
    });
    const f2 = C.findEvent(C.state.score, found.ev.id);
    if (f2) P.previewNote(f2.ev.notes.map(C.midiOf), 0.3);
    update();
  }

  function transposeSelection(semis) {
    const ids = selectedIds() || new Set(targetEvent() ? [targetEvent().ev.id] : []);
    if (!ids.size) return;
    C.mutate("음높이 변경", score => {
      for (const id of ids) {
        const f = C.findEvent(score, id);
        if (!f || f.ev.type !== "note") continue;
        if (ids.size === 1 && ui.selectedNoteIdx !== null) ui.selectedNoteIdx = C.transposeNote(score, id, ui.selectedNoteIdx, semis);
        else f.ev.notes = f.ev.notes.map(n => ({ ...C.transposePitch(n, semis, C.keySigAt(score, f.m)), tie: n.tie }));
      }
      C.normalizeTies(score);
    }, { coalesce: "transpose:" + [...ids].join(",") + ":" + ui.selectedNoteIdx });
    const f = targetEvent(); if (f?.ev.type === "note") P.previewNote(f.ev.notes.map(C.midiOf), 0.3);
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
    if (ui.selectedNoteIdx !== null && found.ev.type === "note") {
      const idx = ui.selectedNoteIdx;
      const tick = C.eventStartTick(found.measures[found.m], found.e, found);
      C.mutate("화음의 음 삭제", score => C.removeNoteFromChord(score, found.ev.id, idx));
      const current = C.findEvent(C.state.score, found.ev.id);
      ui.selectedNoteIdx = current?.ev.type === "note" ? Math.min(idx, current.ev.notes.length - 1) : null;
      if (!current) { ui.selection = api.findEventAtTick(C.state.score, found.m, tick, found); ui.selAnchor = ui.selection; }
      update(); return;
    }
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
    const oct = nearestOctave(step, found.ev.notes[ui.selectedNoteIdx ?? 0]);
    const pitch = { step, oct, alter: C.keyAlterFor(step, C.keySigAt(C.state.score, found.m)) };
    C.mutate("음높이 재지정", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      if (ui.selectedNoteIdx !== null) f.ev.notes[ui.selectedNoteIdx] = { ...pitch, tie: false };
      else f.ev.notes = [{ ...pitch, tie: false }];
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
    if (ui.selectedNoteIdx !== null) {
      C.mutate("개별 음 타이", score => C.toggleNoteTie(score, found.ev.id, ui.selectedNoteIdx));
      update(); return;
    }
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

  async function applyRepeatCount() {
    const range = selectedMeasureRange();
    if (!range) { flashHint("끝 반복 마디를 먼저 선택하세요"); return; }
    const mm = C.ensureMeasureMeta(C.state.score.measures[range.to] || {});
    const raw = await SF.ui.promptDialog({ title: "반복 횟수", value: mm.repeatCount || 2, type: "number", min: 2, max: 8, step: 1, validate: v => Number.isInteger(+v) && +v >= 2 && +v <= 8 ? "" : "2~8 사이 정수를 입력하세요." });
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

  async function applyTempoMark() {
    const found = markerTarget();
    if (!found) { flashHint("템포를 붙일 위치를 먼저 선택하세요"); return; }
    const cur = found.ev.tempo || C.state.score.tempo || 100;
    const raw = await SF.ui.promptDialog({ title: "템포 표시 ♩ =", value: cur, type: "number", min: 30, max: 280, validate: v => Number.isInteger(+v) && +v >= 30 && +v <= 280 ? "" : "30~280 사이 정수를 입력하세요." });
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

  async function applyRehearsalMark() {
    const found = markerTarget();
    if (!found) { flashHint("리허설 마크를 붙일 위치를 먼저 선택하세요"); return; }
    const raw = await SF.ui.promptDialog({ title: "리허설 마크", value: found.ev.rehearsal || nextRehearsalMark(), maxLength: 12 });
    if (raw === null) return;
    const text = raw.trim().slice(0, 12);
    C.mutate("리허설 마크", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f) return;
      if (text) f.ev.rehearsal = text; else delete f.ev.rehearsal;
    });
    update(); toast(text ? `리허설 ${text}` : "리허설 마크를 지웠어요");
  }

  async function applyStaffText() {
    const found = markerTarget();
    if (!found) { flashHint("텍스트를 붙일 위치를 먼저 선택하세요"); return; }
    const raw = await SF.ui.promptDialog({ title: "스태프 텍스트", value: found.ev.staffText || "", maxLength: 48, multiline: true });
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


  return { setDuration, canDot, toggleDot, applyAccidental, transposeSelection, deleteSelection, repitchSelection, toggleTie, applyArticulation, applyDynamic, toggleSlur, toggleHairpin, applyTuplet, applyGraceBefore, toggleNotation, markerTarget, selectedMeasureRange, applyStartRepeat, applyEndRepeat, applyRepeatCount, applyVolta, applyChordSymbol, applyTempoMark, nextRehearsalMark, applyRehearsalMark, applyStaffText };
  } };
})(window.SF);
