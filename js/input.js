/* ScoreForge input: isolated UI responsibilities; no model ownership. */
"use strict";
(function (SF) {
  SF.input = { create(api) {
  const { C, E, P, IO, ui, $, $$, Fraction } = api;
  const update = (...args) => api.update(...args);
  const refreshCursor = (...args) => api.refreshCursor(...args);
  const svgPoint = (...args) => api.svgPoint(...args);
  const select = (...args) => api.select(...args);
  const selectedEvent = (...args) => api.selectedEvent(...args);
  const selectedIds = (...args) => api.selectedIds(...args);
  const targetEvent = (...args) => api.targetEvent(...args);
  const canDot = (...args) => api.canDot(...args);
  const repitchSelection = (...args) => api.repitchSelection(...args);
  const refreshToolbar = (...args) => api.refreshToolbar(...args);
  const updateStatus = (...args) => api.updateStatus(...args);
  const toast = (...args) => api.toast(...args);
  const flashHint = (...args) => api.flashHint(...args);
  let clip = null; // 내부 악보 클립보드
  let midiAccess = null;
  let midiInput = null;
  let midiBuffer = [];
  let midiTimer = null;
  let speedyMidiStarted = false;
  let speedyMidiToastShown = false;
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
    let alter = C.keyAlterFor(step, C.keySigAt(score, mIdx));
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
    while (tick.gte(C.measureLenAt(score, mIdx))) {
      tick = tick.sub(C.measureLenAt(score, mIdx)); mIdx++;
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
    let t = tick.add(len), m = mIdx;
    while (t.gte(C.measureLenAt(score, m))) { t = t.sub(C.measureLenAt(score, m)); m++; }
    return { mIdx: m, tick: t };
  }

  function measureCountForEnd(score, endPos) {
    return endPos.tick.isZero() ? endPos.mIdx : endPos.mIdx + 1;
  }

  function ensureMeasureCount(score, count) {
    if (count > score.measures.length) C.insertMeasures(score, score.measures.length, count - score.measures.length);
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
    const found = id && C.findEvent(score, id);
    if (!found) return;
    C.copyDecor(src, found.ev);
    if (src.type === "note" && found.ev.type === "note") found.ev.notes.forEach((n, i) => { n.tie = !!(n.tie || src.notes?.[i]?.tie); });
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
    const pitches = [...new Set(midis)].sort((a, b) => a - b).map(m => C.spellMidi(m, C.keySigAt(C.state.score, cursorPos().mIdx)));
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
    sel.replaceChildren();
    for (const input of inputs) sel.add(new Option(input.name || "MIDI 입력", input.id));
    if (!inputs.length) sel.add(new Option("장치 없음", ""));
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

  function pitchForStepLabel(as) {
    if (as === null || as === undefined) return "";
    const step = ((as % 7) + 7) % 7;
    const oct = Math.floor(as / 7);
    const pitch = { step, oct, alter: C.keyAlterFor(step, C.keySigAt(C.state.score, cursorPos().mIdx)) };
    return `${C.pitchName(pitch, "ko")}(${C.pitchName(pitch)})`;
  }

  function previewSpeedyStep(sec = 0.15) {
    if (ui.speedyStep === null) return;
    const score = C.state.score;
    const pos = cursorPos();
    const pitch = pitchFromStep(score, pos.mIdx, pos.found.ev.id, clampStep(ui.speedyStep, pos.found), pos.found);
    P.previewNote([C.midiOf(pitch)], sec);
  }

  function doSpeedyInput(d, opts = {}) {
    const score = C.state.score;
    const pos = cursorPos();
    const ctx = { partIdx: pos.found.partIdx, staffIdx: pos.found.staffIdx, voice: pos.found.voice || ui.currentVoice };
    const dur = typeof d === "object" ? { ...d, dots: 0 } : { n: 1, d, dots: 0 };
    let pitches = null;
    if (!opts.rest) {
      if (opts.pitches && opts.pitches.length) {
        pitches = opts.pitches.map(p => ({ step: p.step, alter: p.alter, oct: p.oct }));
      } else {
        pitches = [pitchFromStep(score, pos.mIdx, pos.found.ev.id, clampStep(ui.speedyStep, pos.found), pos.found)];
      }
    }
    const endPos = advancePos(score, pos.mIdx, pos.tick, C.durValue(dur));
    const needed = measureCountForEnd(score, endPos);
    let inserted = null;
    C.mutate(pitches ? "스피디 입력" : "스피디 쉼표", (s2) => {
      ensureMeasureCount(s2, needed);
      C.setActiveStaff(s2, ctx.partIdx, ctx.staffIdx);
      inserted = C.inputAt(s2, pos.mIdx, pos.tick, dur, pitches, ctx);
      if (inserted && pitches && pitches.length) mirrorLinkedTab(s2, ctx, pos.mIdx, pos.tick, dur, pitches, inserted);
    });
    ui.lastInsertedId = inserted;
    ui.curDur = { ...dur };
    if (pitches && pitches.length) {
      ui.lastPitch = pitches[pitches.length - 1];
      P.previewNote(pitches.map(C.midiOf), 0.35);
    } else {
      flashHint("쉼표를 입력했어요");
    }
    const nextTick = pos.tick.add(C.durValue(dur));
    ui.cursorId = findEventAtTick(C.state.score, pos.mIdx, nextTick, ctx) || inserted;
    ui.selection = null;
    ui.selAnchor = null;
    update();
  }

  function toggleSpeedyDot() {
    const found = ui.lastInsertedId && C.findEvent(C.state.score, ui.lastInsertedId);
    if (!found || found.ev.full) return;
    const dur = found.ev.dur, newDur = { ...dur, dots: ((dur.dots || 0) + 1) % (C.maxDots(dur) + 1) };
    const tick = C.eventStartTick(found.measures[found.m], found.e, found);
    let inserted;
    C.mutate("스피디 점음표", score => { inserted = C.reinputWithDur(score, found, newDur); });
    ui.lastInsertedId = inserted; ui.curDur = newDur;
    ui.cursorId = findEventAtTick(C.state.score, found.m, tick.add(C.durValue(newDur)), found) || inserted;
    update();
  }

  function addSpeedyChordTone() {
    const found = ui.lastInsertedId && C.findEvent(C.state.score, ui.lastInsertedId);
    if (!found || found.ev.type !== "note") return;
    const pitch = pitchFromStep(C.state.score, found.m, found.ev.id, clampStep(ui.speedyStep, found), found);
    C.mutate("스피디 화음 추가", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (!f || f.ev.type !== "note") return;
      if (!f.ev.notes.some(n => C.pitchEq(n, pitch))) {
        f.ev.notes.push({ ...pitch, tie: false });
        f.ev.notes.sort((a, b) => C.absStep(a) - C.absStep(b));
      }
      C.normalizeTies(score);
    });
    const f2 = C.findEvent(C.state.score, found.ev.id);
    if (f2) P.previewNote(f2.ev.notes.map(C.midiOf), 0.35);
    ui.lastPitch = pitch;
    update();
  }

  function speedyDeleteAt(found, tick) {
    if (!found) return;
    const ctx = { partIdx: found.partIdx, staffIdx: found.staffIdx, voice: found.voice || ui.currentVoice };
    C.mutate("스피디 지우기", (score) => {
      const f = C.findEvent(score, found.ev.id);
      if (f) C.deleteEvent(score, f.m, f.e, f);
    });
    ui.cursorId = findEventAtTick(C.state.score, found.m, tick, ctx);
    ui.lastInsertedId = null;
    ui.selection = null;
    ui.selAnchor = null;
    update();
  }

  function clearSpeedyHeld() {
    ui.speedyHeld.clear();
    $$("#piano-keys .key.held").forEach(k => k.classList.remove("held"));
  }

  function setSpeedyHeld(midi, held, keyEl, sec = 0.3) {
    if (held) {
      ui.speedyHeld.add(midi);
      if (keyEl) keyEl.classList.add("held");
      const pitch = C.spellMidi(midi, C.keySigAt(C.state.score, cursorPos().mIdx));
      ui.speedyStep = clampStep(C.absStep(pitch), activeRef());
      ui.lastPitch = pitch;
      P.previewNote([midi], sec);
      refreshCursor();
    } else {
      ui.speedyHeld.delete(midi);
      if (keyEl) keyEl.classList.remove("held");
    }
    updateStatus();
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

  /* ---------------- 입력 모드 ---------------- */
  function initSpeedyMidi() {
    if (speedyMidiStarted || !navigator.requestMIDIAccess) return;
    speedyMidiStarted = true;

    function wireInputs(access) {
      let count = 0;
      for (const input of access.inputs.values()) {
        count++;
        input.onmidimessage = (msg) => {
          const [status, note, vel] = msg.data;
          const cmd = status & 0xF0;
          if (ui.speedy) {
            if (cmd === 0x90 && vel > 0) setSpeedyHeld(note, true, null, 0.3);
            else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) setSpeedyHeld(note, false);
          } else if (ui.midiEnabled && input === midiInput) {
            onMidiMessage(msg);
          }
        };
      }
      if (count && !speedyMidiToastShown) {
        speedyMidiToastShown = true;
        toast("MIDI 건반 연결됨 — 건반 누른 채 숫자 키");
      }
    }

    Promise.resolve(midiAccess || navigator.requestMIDIAccess({ sysex: false })).then((access) => {
      midiAccess = access;
      wireInputs(access);
      access.onstatechange = () => wireInputs(access);
    }).catch(() => { /* 미지원/권한 거부 환경에서는 조용히 지나간다. */ });
  }

  function toggleSpeedy(on) {
    if (on && C.state.readOnly) return;
    ui.speedy = !!on;
    if (ui.speedy) {
      ui.inputMode = false;
      ui.restMode = false;
      E.drawGhost(null);
      $("#canvas").classList.remove("input-mode");
      if (ui.selection) {
        const found = C.findEvent(C.state.score, ui.selection);
        if (found) C.setActiveStaff(C.state.score, found.partIdx, found.staffIdx);
        ui.cursorId = ui.selection;
        ui.selection = null;
        ui.selAnchor = null;
      }
      const pos = cursorPos();
      const seed = ui.lastPitch || C.CLEFS[C.activeClef(C.state.score)].middle;
      ui.speedyStep = clampStep(C.absStep(seed), pos.found);
      $("#canvas").classList.add("speedy-mode");
      initSpeedyMidi();
    } else {
      ui.speedyStep = null;
      clearSpeedyHeld();
      $("#canvas").classList.remove("speedy-mode");
      if (E.drawSpeedy) E.drawSpeedy(null);
    }
    update();
  }

  function setInputMode(on) {
    if (on && C.state.readOnly) return;
    if (on && ui.speedy) toggleSpeedy(false);
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
          const pitch = { step, oct, alter: C.keyAlterFor(step, C.keySigAt(score, found.m)) };
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
      const pitch = { step, oct, alter: C.keyAlterFor(step, C.keySigAt(score, pos.mIdx)) };
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
    if (evt.target.closest("[data-meta]")) return;
    if (P.player.playing) { const hit = E.hitTest(pt.x, pt.y); if (hit?.le) { SF.uiV3.seekToEvent(hit.le.id); return; } }
    const refEl = evt.target.closest && evt.target.closest("[data-ref]");
    if (ui.speedy) {
      const hit = E.hitTest(pt.x, pt.y);
      if (!hit || !hit.le) return;
      C.setActiveStaff(C.state.score, hit.le.partIdx, hit.le.staffIdx);
      ui.cursorId = hit.le.id;
      ui.speedyStep = clampStep(hit.step, hit.le);
      ui.selection = null;
      ui.selAnchor = null;
      refreshCursor();
      updateStatus();
      return;
    }
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
        select(refEl.getAttribute("data-ref"), { extend: evt.shiftKey && !!ui.selection, noteIdx: evt.shiftKey ? null : (evt.target.closest("[data-note]") ? +evt.target.closest("[data-note]").dataset.note : null) });
        if (P.player.playing) SF.uiV3.seekToEvent(refEl.getAttribute("data-ref"));
      } else {
        if (ui.selection) { ui.selection = null; ui.selAnchor = null; update(); }
      }
    }
  }

  function clampStep(as, ctx) {
    const ref = ctx ? C.staffRef(C.state.score, ctx) : activeRef();
    const bottom = C.CLEFS[C.clefAt(ref, ctx?.m ?? ctx?.mIdx ?? 0)].bottomStep;
    return Math.max(bottom - 11, Math.min(bottom + 19, as));
  }

  /* 드래그로 음높이 변경 */
  function onPointerDown(evt) {
    if (C.state.readOnly || ui.inputMode || ui.speedy || evt.button !== 0) return;
    const refEl = evt.target.closest && evt.target.closest("[data-ref]");
    if (!refEl) return;
    const id = refEl.getAttribute("data-ref");
    const found = C.findEvent(C.state.score, id);
    if (!found || found.ev.type !== "note") return;
    C.setActiveStaff(C.state.score, found.partIdx, found.staffIdx);
    const pt = svgPoint(evt);
    ui.dragging = { id, pointerType: evt.pointerType, noteIdx: evt.target.closest("[data-note]") ? +evt.target.closest("[data-note]").dataset.note : null, startY: evt.clientY, startPt: pt, moved: false, lastDelta: 0 };
  }
  function onPointerMove(evt) {
    const d = ui.dragging;
    if (!d) return;
    const dy = evt.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < (d.pointerType === "touch" ? 8 : 5)) return;
    d.moved = true;
    const pt = svgPoint(evt);
    if (!pt) return;
    const layout = E.getLayout();
    const le = layout && layout.eventsById.get(d.id);
    if (!le) return;
    const score = C.state.score;
    const baseAs = C.absStep(C.findEvent(score, d.id).ev.notes[d.noteIdx ?? 0]);
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
    ui.suppressClickUntil = performance.now() + 300;
    if (!d.lastDelta) return;
    C.mutate("음높이 드래그", (score) => {
      const f = C.findEvent(score, d.id);
      if (!f) return;
      f.ev.notes = f.ev.notes.map((n, i) => {
        if (d.noteIdx !== null && i !== d.noteIdx) return n;
        const as = C.absStep(n) + d.lastDelta;
        const step = ((as % 7) + 7) % 7;
        const oct = Math.floor(as / 7);
        return { step, oct, alter: C.keyAlterFor(step, C.keySigAt(score, f.m)), tie: n.tie };
      });
      C.normalizeTies(score);
    });
    const f2 = C.findEvent(C.state.score, d.id);
    if (f2) P.previewNote(f2.ev.notes.map(C.midiOf), 0.35);
    update();
  }

  /* ---------------- 가사 ---------------- */
  function editLyric(id) {
    if (C.state.readOnly) return;
    const found = C.findEvent(C.state.score, id);
    if (!found || found.ev.type !== "note") return;
    const layout = E.getLayout();
    const le = layout.eventsById.get(id);
    if (!le) return;
    const wrap = $("#paper");
    const box = $("#lyric-editor");
    const svg = $("#svg-host svg");
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
      input.blur(); $("#canvas").focus({ preventScroll: true });
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
    if (C.state.readOnly) return;
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
      input.blur(); $("#canvas").focus({ preventScroll: true });
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

  /* ---------------- 피아노 ---------------- */
  const PC_BLACK = [1, 3, 6, 8, 10];
  function buildPiano() {
    const host = $("#piano-keys");
    let html = "";
    const LOW = 48, HIGH = 84; // C3~C6
    let whiteIdx = 0;
    const W = matchMedia("(pointer: coarse)").matches ? 36 : 30;
    for (let m = LOW; m <= HIGH; m++) {
      const pc = m % 12;
      if (!PC_BLACK.includes(pc)) {
        const oct = Math.floor(m / 12) - 1;
        const solfa = ["도", null, "레", null, "미", "파", null, "솔", null, "라", null, "시"][pc];
        const label = pc === 0 ? `${solfa}<small>C${oct}</small>` : `${solfa}`;
        html += `<div class="key white" role="button" tabindex="${m === LOW ? 0 : -1}" aria-label="${C.pitchName(C.spellMidi(m, 0))}" data-midi="${m}" style="left:${whiteIdx * W}px"><span>${label}</span></div>`;
        whiteIdx++;
      }
    }
    let wi = 0;
    for (let m = LOW; m <= HIGH; m++) {
      const pc = m % 12;
      if (!PC_BLACK.includes(pc)) { wi++; continue; }
      html += `<div class="key black" role="button" tabindex="-1" aria-label="${C.pitchName(C.spellMidi(m, 0))}" data-midi="${m}" style="left:${wi * W - 9}px"></div>`;
    }
    host.style.width = whiteIdx * W + "px";
    host.innerHTML = html;

    const playKey = (key, shiftKey) => {
      const midi = +key.dataset.midi;
      key.classList.add("pressed");
      setTimeout(() => key.classList.remove("pressed"), 220);
      if (ui.inputMode) {
        const score = C.state.score;
        const pitch = C.spellMidi(midi, C.keySigAt(score, cursorPos().mIdx));
        if (shiftKey && ui.lastInsertedId) {
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
    };
    const keys = [...host.querySelectorAll(".key")].sort((a, b) => +a.dataset.midi - +b.dataset.midi);
    const focusKey = key => {
      keys.forEach(item => { item.tabIndex = item === key ? 0 : -1; });
      key.focus({ preventScroll: true });
      key.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    host.addEventListener("keydown", e => {
      const key = e.target.closest(".key");
      if (!key) return;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        const index = keys.indexOf(key);
        focusKey(keys[e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, index + (e.key === "ArrowRight" ? 1 : -1)))]);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat) return;
        if (ui.speedy) setSpeedyHeld(+key.dataset.midi, true, key, 0.4);
        else playKey(key, e.shiftKey);
      }
    });
    const releaseKey = e => {
      const key = e.target.closest(".key");
      if (key && (e.type === "focusout" || e.key === " " || e.key === "Enter")) {
        setSpeedyHeld(+key.dataset.midi, false, key);
        if (e.type === "keyup") { e.preventDefault(); e.stopPropagation(); }
      }
    };
    host.addEventListener("keyup", releaseKey);
    host.addEventListener("focusout", releaseKey);
    host.addEventListener("pointerdown", (e) => {
      const key = e.target.closest(".key");
      if (!key) return;
      e.preventDefault();
      const midi = +key.dataset.midi;
      if (ui.speedy) {
        setSpeedyHeld(midi, true, key, 0.4);
        key.setPointerCapture?.(e.pointerId);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          setSpeedyHeld(midi, false, key);
          key.removeEventListener("pointerup", release);
          key.removeEventListener("pointercancel", release);
          key.removeEventListener("pointerleave", release);
        };
        key.addEventListener("pointerup", release);
        key.addEventListener("pointercancel", release);
        key.addEventListener("pointerleave", release);
        return;
      }
      playKey(key, e.shiftKey);
    });
  }


  return { activeRef, activeCtx, firstEventIdForVoice, setCurrentVoice, setActiveStaff, effectiveAlter, pitchFromStep, nearestOctave, findEventAtTick, advancePos, measureCountForEnd, ensureMeasureCount, clonePlain, cloneDurForPaste, selectionItems, copySelection, decoratePastedEvent, pasteClipboard, doInput, mirrorLinkedTab, inputDrum, inputMidiPitches, initMidi, refreshMidiDevices, connectMidiInput, onMidiMessage, pitchForStepLabel, previewSpeedyStep, doSpeedyInput, toggleSpeedyDot, addSpeedyChordTone, speedyDeleteAt, clearSpeedyHeld, setSpeedyHeld, cursorPos, initSpeedyMidi, toggleSpeedy, setInputMode, inputLetter, onCanvasMove, onCanvasClick, clampStep, onPointerDown, onPointerMove, onPointerUp, editLyric, editChordSymbol, buildPiano };
  } };
})(window.SF);
