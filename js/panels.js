/* ScoreForge panels: isolated UI responsibilities; no model ownership. */
"use strict";
(function (SF) {
  SF.panels = { create(api) {
  const { C, E, P, IO, ui, $, $$, Fraction } = api;
  const update = (...args) => api.update(...args);
  const applyZoom = (...args) => api.applyZoom(...args);
  const activeRef = (...args) => api.activeRef(...args);
  const select = (...args) => api.select(...args);
  const selectedIds = (...args) => api.selectedIds(...args);
  const targetEvent = (...args) => api.targetEvent(...args);
  const applyArticulation = (...args) => api.applyArticulation(...args);
  const selectedMeasureRange = (...args) => api.selectedMeasureRange(...args);
  const stopPlayback = (...args) => api.stopPlayback(...args);
  const toast = (...args) => api.toast(...args);
  const flashHint = (...args) => api.flashHint(...args);
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
      <label>위치</label><span>${htmlEsc(found.name)} · V${found.voice || 1} · 마디 ${found.m + 1}</span>
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
  function mutateSelectedEvents(label, fn, coalesce) {
    const ids = selectedPropIds();
    if (!ids.length) return;
    C.mutate(label, (score) => {
      for (const id of ids) {
        const f = C.findEvent(score, id);
        if (f) fn(f.ev, f, score);
      }
    }, { coalesce: coalesce ? coalesce + ":" + ids.join(",") : undefined });
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
    }, "property:" + prop);
  }
  async function applyMeasureBreak(type, fromPanel) {
    const range = selectedMeasureRange();
    if (!range) { flashHint("브레이크를 붙일 마디를 먼저 선택하세요"); return; }
    let sectionName = "";
    if (type === "section") {
      sectionName = await SF.ui.promptDialog({ title: "섹션 이름", value: C.ensureMeasureMeta(C.state.score.measures[range.to] || {}).sectionName || "Section", maxLength: 48 });
      if (sectionName === null) return;
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
    $("#properties-panel").addEventListener("focusout", () => requestAnimationFrame(() => { if (!document.activeElement.closest("#properties-panel")) update(); }));
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
    const layout = api.getLayoutCache() || E.getLayout();
    if (!layout) return;
    const ref = C.activeRef(C.state.score);
    const position = E.positionForMeasure(mIdx, 0, ref.globalIdx, layout);
    if (!position) return;
    const { sys, M } = position;
    const ev = C.getVoiceEvents(ref.measures[mIdx] || ref.measures[0], ui.currentVoice, C.state.score)[0];
    if (ev) { ui.selection = ev.id; ui.selAnchor = ev.id; ui.cursorId = ev.id; ui.selectedNoteIdx = null; }
    update();
    setTimeout(() => {
      const canvas = $("#canvas");
      const headH = $("#paper-head").offsetHeight;
      const s = ui.fitScale * ui.zoom;
      canvas.scrollTo({ top: Math.max(0, (sys.yTop + headH - 80) * s), left: Math.max(0, (M.x0 - 80) * s), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 0);
  }
  function renderNavigator() {
    const host = $("#navigator-view");
    const layout = api.getLayoutCache() || E.getLayout();
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
  async function gotoQuery() {
    const raw = await SF.ui.promptDialog({ title: "마디·리허설 이동", label: "마디 번호 또는 r:A", value: "", validate: v => /^(?:[1-9]\d*|r\s*:.+)$/i.test(v.trim()) ? "" : "마디 번호 또는 r:A 형식으로 입력하세요." });
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
      return `<div class="mixer-row" data-part="${htmlEsc(part.id)}">
        <b>${htmlEsc(part.name || "파트 " + (idx + 1))}</b>
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
    }, { coalesce: "mixer:" + partId + ":" + key });
    P.updateMixer(C.state.score);
    update();
  }

  function bindMixer() {
    $("#btn-mixer").addEventListener("click", () => {
      renderMixerRows();
      $("#dlg-mixer").showModal();
    });
    $("#mixer-rows").addEventListener("input", (e) => {
      const input = e.target.closest("[data-mix]");
      const row = e.target.closest(".mixer-row");
      if (!input || !row) return;
      const key = input.dataset.mix;
      updateMixerValue(row.dataset.part, key, input.type === "checkbox" ? input.checked : input.value);
    });
  }

  function openSettings() {
    const score = C.state.score;
    const active = C.activeRef(score);
    $("#set-title").value = score.meta.title || "";
    $("#set-composer").value = score.meta.composer || "";
    if (!$("#set-ensemble option[value=custom]")) $("#set-ensemble").add(new Option("현재 사용자 편성", "custom"));
    $("#set-ensemble").value = C.ensembleKey(score);
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
    SF.uiV3?.loadSettingsExtras();
    SF.ui.open($("#dlg-settings"));
  }

  function bindSettings() {
    $("#btn-settings").addEventListener("click", openSettings);
    $("#set-apply").addEventListener("click", (e) => {
      e.preventDefault();
      const score = C.state.score;
      const [num, den] = $("#set-time").value.split("/").map(Number);
      if (!Number.isInteger(num) || num < 1 || num > 32 || ![1,2,4,8,16,32,64].includes(den)) { toast("박자는 1~32 / 1·2·4·8·16·32·64 형식으로 입력하세요."); return; }
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
        for (const key of ["subtitle", "lyricist", "copyright"]) s2.meta[key] = $("#set-" + key)?.value.trim() || "";
        const ensembleChanged = newEnsemble !== "custom" && C.ensembleKey(s2) !== newEnsemble;
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
        C.insertMeasures(s2, s2.measures.length, 4);
      });
      update(); toast("마디 4개를 추가했어요");
    });
    $("#set-del-measure").addEventListener("click", (e) => {
      e.preventDefault();
      C.mutate("마디 삭제", (s2) => {
        if (s2.measures.length > 1) C.deleteMeasures(s2, s2.measures.length - 1);
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


  return { htmlEsc, checked, selectedPropIds, firstSelectedRef, renderPropertiesPanel, mutateSelectedEvents, applyPropertyInput, applyMeasureBreak, bindProperties, refreshOpenOverlays, scrollToMeasure, renderNavigator, measureDensity, renderTimelinePanel, openNavigator, openTimelinePanel, gotoQuery, bindNavigationPanels, r1, mixerRecord, renderMixerRows, updateMixerValue, bindMixer, openSettings, bindSettings };
  } };
})(window.SF);
