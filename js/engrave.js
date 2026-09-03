/* =========================================================================
 * ScoreForge engrave — 레이아웃(좌표 계산)과 SVG 렌더
 * 단위: 1sp(보표 줄 간격) = 10px. 레이아웃 결과는 순수 데이터.
 * 글리프: SMuFL Bravura 폰트(1em = 4sp) 우선, 실패 시 내장 패스 폴백.
 * ========================================================================= */
"use strict";
(function (SF) {
  const { F, Fraction } = SF;
  const C = SF.core;

  const SP = 10;                 // px per staff space
  const PAGE_W = 1000;           // 종이 논리 폭(px)
  const MARGIN = 52;
  const STAFF_H = 4 * SP;

  // All sizes are logical SVG pixels. Core may supply these optional tokens.
  const STYLE = Object.freeze({ staffLineWidth: 1.1, stemWidth: 1.5, beamThickness: 5,
    ledgerLength: 20, noteheadScale: 1, lyricFontSize: 14, lyricLineHeight: 17,
    chordFontSize: 15, systemFirstMeasurePadding: 12, measureMinWidth: 64,
    spaceBase: 21, spaceK: 0.52, slurThickness: 2.2, tieHeightFactor: 0.06 });
  function styleOf(score) {
    const raw = (C.ensureStyle ? C.ensureStyle(score) : score.style) || {};
    const out = { ...STYLE };
    for (const k of Object.keys(STYLE)) if (Number.isFinite(+raw[k]) && +raw[k] > 0) out[k] = +raw[k];
    if (raw.lyricLineHeight == null && raw.lyricLineGap > 0) out.lyricLineHeight = +raw.lyricLineGap;
    if (raw.tieHeightFactor == null && raw.tieHeight > 0) out.tieHeightFactor = STYLE.tieHeightFactor * raw.tieHeight;
    return out;
  }
  function inherited(measures, m, key, fallback) {
    for (let i = m; i >= 0; i--) if (measures?.[i]?.[key] != null) return measures[i][key];
    return fallback;
  }
  const keyAt = (score, m) => C.keySigAt ? C.keySigAt(score, m) : inherited(score.measures, m, "keySig", score.keySig);
  const timeAt = (score, m) => C.timeSigAt ? C.timeSigAt(score, m) : inherited(score.measures, m, "timeSig", score.timeSig);
  const clefAt = (ref, m) => C.clefAt ? C.clefAt(ref, m) : inherited(ref.measures || ref.staff?.measures, m, "clef", ref.staff?.clef || ref.clef || "treble");
  const lengthAt = (score, m) => C.measureLenAt ? C.measureLenAt(score, m) : score.measures[m]?.pickup ? Fraction.from(score.measures[m].pickup) : F(timeAt(score, m).num, timeAt(score, m).den);
  function clefInfo(name) {
    const fallback = { alto: { bottomStep: 24, middle: { step: 0, oct: 4 } }, tenor: { bottomStep: 22, middle: { step: 5, oct: 3 } } };
    return C.CLEFS[name] || fallback[name] || C.CLEFS[name === "bass8vb" ? "bass" : "treble"];
  }
  const headKind = dur => dur.d === 1 ? (dur.n >= 2 ? "breve" : "whole") : dur.d === 2 ? "half" : "black";
  const flagName = (dur, dir) => `flag${Math.min(64, Math.max(8, dur.d))}${dir === "down" ? "Down" : "Up"}`;
  const restName = dur => dur.d === 1 ? (dur.n >= 2 ? "restDoubleWhole" : "restWhole") : dur.d === 2 ? "restHalf" : dur.d === 4 ? "restQuarter" : `rest${Math.min(64, dur.d)}`;

  function pageMetrics(score) {
    const layout = C.ensureLayout(score);
    return {
      width: layout.width || PAGE_W,
      height: layout.height || 1414,
      marginTop: layout.marginTop || MARGIN,
      marginRight: layout.marginRight || MARGIN,
      marginBottom: layout.marginBottom || MARGIN,
      marginLeft: layout.marginLeft || MARGIN,
      systemGap: layout.systemGap || 1,
      staffGap: layout.staffGap || 1,
      noteSpacing: layout.noteSpacing || 1,
      beamThickness: layout.beamThickness || 1,
    };
  }
  function pageWidth(score) {
    return pageMetrics(score || C.state.score).width;
  }

  /* ---------------- 글리프 ---------------- */
  const GLYPHS = {
    gClef:      "", fClef: "", cClef: "\uE05C",
    headBreve: "\uE0A0", restDoubleWhole: "\uE4E2",
    headBlack:  "", headHalf: "", headWhole: "",
    sharp:      "", flat: "", natural: "",
    restWhole:  "", restHalf: "", restQuarter: "",
    rest8:      "", rest16: "",
    flag8Up:    "", flag8Down: "", flag16Up: "", flag16Down: "",
    flag32Up: "\uE244", flag32Down: "\uE245", flag64Up: "\uE246", flag64Down: "\uE247",
    rest32: "\uE4E8", rest64: "\uE4E9",
    ornamentTrill: "\uE566", ornamentMordent: "\uE56D", ornamentShortTrill: "\uE56C",
    ornamentTurn: "\uE567", ornamentTurnInverted: "\uE568", segno: "\uE047", coda: "\uE048",
  };
  const TIMESIG_DIGITS = "";

  // 아티큘레이션·셈여림 글리프 (SMuFL 코드포인트)
  Object.assign(GLYPHS, {
    staccatoAbove: "", staccatoBelow: "",
    tenutoAbove: "", tenutoBelow: "",
    accentAbove: "", accentBelow: "",
    marcatoAbove: "", marcatoBelow: "",
    fermata: "",
    dynPP: "", dynP: "", dynMP: "",
    dynMF: "", dynF: "", dynFF: "",
  });

  let fontReady = false;
  function loadFont(onReady) {
    if (!document.fonts || !document.fonts.load) return;
    document.fonts.load("40px BravuraSF", "").then(() => {
      if (document.fonts.check("40px BravuraSF", "")) {
        fontReady = true;
        onReady && onReady();
      }
    }).catch(() => {});
    setTimeout(() => { // 일부 브라우저는 늦게 로드됨
      if (!fontReady && document.fonts.check("40px BravuraSF", "")) {
        fontReady = true; onReady && onReady();
      }
    }, 2500);
  }

  /* ---- 폴백 패스(오프라인용 근사 글리프, 원점 = 글리프 기준점) ---- */
  const FB = {
    gClef: { stroke: 1.9, d: "M 2.6 15 C 1 6 -1 -6 -2.2 -14 C -3.4 -22.6 -1 -27.4 1.8 -29.4 C 4.4 -31 6 -28.6 5.6 -25.8 C 5.2 -22.6 2.6 -19.6 -0.6 -16.8 C -5 -13 -7.6 -9.4 -7.2 -4.6 C -6.8 0.6 -2.6 4.4 2 4.2 C 6.6 4 9 0.6 8.6 -3 C 8.2 -6.6 5.2 -8.8 2.2 -8.4 C -0.8 -8 -2.6 -5.2 -2 -2.4 C -1.6 -0.4 0 1 1.8 1.4 M 2.6 15 C 2.9 17.5 0.8 19.6 -1.8 19.2 C -4.2 18.8 -5.4 16.2 -4 14.4",
        extra: '<circle cx="-2.2" cy="16.4" r="2.1"/>' },
    fClef: { stroke: 1.8, d: "M -5.2 -1.4 C -4.6 -5.4 -1.2 -7.2 1.6 -6.6 C 4.8 -5.9 6.4 -3.4 6.4 -0.2 C 6.4 5 2 9.8 -5.4 13.2",
        extra: '<circle cx="-2.9" cy="-2.6" r="2.6"/><circle cx="9.6" cy="-2.6" r="1.25"/><circle cx="9.6" cy="2.6" r="1.25"/>' },
    sharp: { d: "M -2.7 -6.1 h 1.15 v 12.9 h -1.15 Z M 1.55 -7 h 1.15 v 12.9 h -1.15 Z M -3.7 -1 L 3.8 -2.7 v 2.2 L -3.7 1.2 Z M -3.7 3.6 L 3.8 1.9 v 2.2 L -3.7 5.8 Z" },
    flat: { d: "M -2.3 -9.5 h 1.1 v 10 q 2.7 -2.1 4.2 -0.4 q 1.4 1.6 -0.7 3.7 q -1.7 1.7 -4.6 3.3 Z M -1.2 2.9 q 2.4 -2 1.6 -3.1 q -0.75 -1 -1.6 0.2 Z", evenodd: true },
    natural: { d: "M -2 -6.6 h 1.05 V -2 L 2 -2.9 v -3.3 h 1.05 v 12.8 H 2 V 2 l -2.95 0.9 v 3.7 H -2 Z M -0.95 0.8 L 2 -0.1 v -1.7 l -2.95 0.9 Z", evenodd: true },
    restQuarter: { d: "M -1.7 -7.2 C 0.9 -4.4 2 -3.2 0.4 -1 C -0.9 0.8 -0.7 1.5 1.8 3.9 C -1.5 3.1 -2.7 4.3 -0.8 7.4 C -4.2 4.8 -3.1 2.5 -0.7 1.8 C -3.4 -0.9 -3.2 -2.1 -1.7 -7.2 Z" },
    rest8: { d: "M 2.9 -4.7 L -0.7 6 h -1.15 L 1.3 -2.2 q -1.9 1.3 -3.5 0.3 a 1.85 1.85 0 1 1 0.4 -1.4 q 1.6 0.9 3.3 -1.6 Z" },
    rest16: { d: "M 3.4 -7.2 L -1.3 8.5 h -1.15 L -0.2 3 q -1.8 1.2 -3.4 0.25 a 1.8 1.8 0 1 1 0.4 -1.4 q 1.7 0.9 3.4 -1.7 L 1.3 -2.3 q -1.85 1.25 -3.45 0.3 a 1.8 1.8 0 1 1 0.4 -1.4 q 1.7 0.95 3.4 -1.7 Z" },
    flag8Up: { d: "M 0 0 C 0.9 2.6 3.6 3.9 3.8 7.4 C 3.95 9.9 2.8 11.9 1.3 13.2 C 2.6 10 1.7 7.2 0 6 Z" },
    flag8Down: { d: "M 0 0 C 0.9 -2.6 3.6 -3.9 3.8 -7.4 C 3.95 -9.9 2.8 -11.9 1.3 -13.2 C 2.6 -10 1.7 -7.2 0 -6 Z" },
    flag16Up: { d: "M 0 0 C 0.9 2.2 3.4 3.3 3.7 6.3 C 3.85 8.1 3.2 9.5 2.2 10.5 C 3 8 2 5.9 0 4.9 Z M 0 4.6 C 0.9 6.8 3.4 7.9 3.7 10.9 C 3.85 12.7 3.2 14.1 2.2 15.1 C 3 12.6 2 10.5 0 9.5 Z" },
    flag16Down: { d: "M 0 0 C 0.9 -2.2 3.4 -3.3 3.7 -6.3 C 3.85 -8.1 3.2 -9.5 2.2 -10.5 C 3 -8 2 -5.9 0 -4.9 Z M 0 -4.6 C 0.9 -6.8 3.4 -7.9 3.7 -10.9 C 3.85 -12.7 3.2 -14.1 2.2 -15.1 C 3 -12.6 2 -10.5 0 -9.5 Z" },
  };

  // 아티큘레이션 폴백 패스 (중앙 정렬 좌표계)
  Object.assign(FB, {
    cClef: { stroke: 1.8, d: "M -8 -19 V 19 M -4 -19 V 19 M 0 -19 C 15 -23 16 -3 1 0 C 16 3 15 23 0 19 M -3 0 H 5", extra: '<path d="M -2 0 L 3 -7 L 3 7 Z"/>' },
    restWhole: { d: "M 0 0 h 13 v 5.2 h -13 Z" },
    restHalf: { d: "M 0 -5.2 h 13 v 5.2 h -13 Z" },
    restDoubleWhole: { d: "M -5 -10 h 10 v 10 h -10 Z" },
    ornamentTrill: { stroke: 1.6, d: "M -8 -8 V 4 Q -7 8 -3 3 M -11 -4 H -4 M 0 -4 V 5 M 0 0 Q 5 -9 8 -2" },
    ornamentShortTrill: { stroke: 1.8, d: "M -10 3 L -6 -3 L -2 3 L 2 -3 L 6 3 L 10 -3" },
    ornamentMordent: { stroke: 1.8, d: "M -10 3 L -6 -3 L -2 3 L 2 -3 L 6 3 L 10 -3 M 0 -7 V 7" },
    ornamentTurn: { stroke: 1.8, d: "M -7 3 C -16 -6 -2 -8 0 0 C 2 8 16 6 7 -3" },
    ornamentTurnInverted: { stroke: 1.8, d: "M -7 -3 C -16 6 -2 8 0 0 C 2 -8 16 -6 7 3" },
    segno: { stroke: 1.8, d: "M -7 10 L 7 -10 M 4 -8 C -9 -16 -12 1 0 0 C 12 -1 9 16 -4 8", extra: '<circle cx="-7" cy="-2" r="1.8"/><circle cx="7" cy="2" r="1.8"/>' },
    coda: { stroke: 1.8, d: "M -8 0 A 8 8 0 1 0 8 0 A 8 8 0 1 0 -8 0 M -13 0 H 13 M 0 -13 V 13" },
    staccatoAbove: { d: "M -1.6 0 a 1.6 1.6 0 1 0 3.2 0 a 1.6 1.6 0 1 0 -3.2 0 Z" },
    staccatoBelow: { d: "M -1.6 0 a 1.6 1.6 0 1 0 3.2 0 a 1.6 1.6 0 1 0 -3.2 0 Z" },
    tenutoAbove: { d: "M -3.6 -0.8 h 7.2 v 1.6 h -7.2 Z" },
    tenutoBelow: { d: "M -3.6 -0.8 h 7.2 v 1.6 h -7.2 Z" },
    accentAbove: { stroke: 1.7, d: "M -3.9 -2.7 L 3.9 0 L -3.9 2.7" },
    accentBelow: { stroke: 1.7, d: "M -3.9 -2.7 L 3.9 0 L -3.9 2.7" },
    marcatoAbove: { stroke: 1.7, d: "M -3.3 2.7 L 0 -3.2 L 3.3 2.7" },
    marcatoBelow: { stroke: 1.7, d: "M -3.3 -2.7 L 0 3.2 L 3.3 -2.7" },
    fermata: { stroke: 1.6, d: "M -7 2.2 A 7.2 7.2 0 0 1 7 2.2", extra: '<circle cx="0" cy="0.6" r="1.55"/>' },
  });

  for (const [den, count] of [[32, 3], [64, 4]]) {
    for (const dir of ["Up", "Down"]) {
      const sign = dir === "Up" ? 1 : -1;
      let d = "";
      for (let i = 0; i < count; i++) {
        const y = i * 4.6 * sign;
        d += `M 0 ${y} c .9 ${2.2 * sign} 3.4 ${3.3 * sign} 3.7 ${6.3 * sign} c .15 ${1.8 * sign} -.5 ${3.2 * sign} -1.5 ${4.2 * sign} c .8 ${-2.5 * sign} -.2 ${-4.6 * sign} -2.2 ${-5.6 * sign} Z `;
      }
      FB[`flag${den}${dir}`] = { d };
    }
    let d = `M 4 -10 L -3 ${5 * count - 4} h -1.2 L 2.8 -10 Z `;
    for (let i = 0; i < count; i++) d += `M ${2 - i * 1.5} ${-7 + i * 5} q -2 3 -5 1 a 1.9 1.9 0 1 1 .5 -1.5 q 2 1 4.5 -1 Z `;
    FB[`rest${den}`] = { d };
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/>/g, "&gt;"); }
  function safeColor(s) {
    const v = String(s || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "";
  }

  /* 글리프 1개를 SVG 문자열로 (x,y = 기준점) */
  function glyph(name, x, y, opts = {}) {
    const cls = opts.cls ? ` class="${opts.cls}"` : "";
    const scale = opts.scale || 1;
    if (fontReady && GLYPHS[name]) {
      const anchor = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
      return `<text${cls}${anchor} x="${r2(x)}" y="${r2(y)}" font-family="BravuraSF" font-size="${40 * scale}px" pointer-events="none">${GLYPHS[name]}</text>`;
    }
    const fb = FB[name];
    if (!fb) return "";
    const fill = fb.stroke ? 'fill="none"' : 'fill="currentColor"';
    const stroke = fb.stroke ? `stroke="currentColor" stroke-width="${fb.stroke}" stroke-linecap="round" stroke-linejoin="round"` : "";
    const fr = fb.evenodd ? 'fill-rule="evenodd"' : "";
    return `<g${cls} transform="translate(${r2(x)},${r2(y)}) scale(${scale})">` +
      `<path d="${fb.d}" ${fill} ${stroke} ${fr}/>` + (fb.extra || "") + `</g>`;
  }

  /* 폴백용 음표머리 (타원) */
  function headShape(x, y, kind, cls) {
    const cc = cls ? ` class="${cls}"` : "";
    if (fontReady) {
      const name = kind === "breve" ? "headBreve" : kind === "whole" ? "headWhole" : kind === "half" ? "headHalf" : "headBlack";
      const w = kind === "breve" ? 23 : kind === "whole" ? 17.3 : 11.8;
      return `<text${cc} x="${r2(x - w / 2)}" y="${r2(y)}" font-family="BravuraSF" font-size="40px">${GLYPHS[name]}</text>`;
    }
    if (kind === "breve") return `<g${cc}>${headShape(x, y, "whole")}<path d="M ${r2(x - 11)} ${r2(y - 7)} v 14 M ${r2(x + 11)} ${r2(y - 7)} v 14" stroke="currentColor" stroke-width="1.8"/></g>`;
    if (kind === "whole") {
      return `<g${cc}><ellipse cx="${r2(x)}" cy="${r2(y)}" rx="8.4" ry="4.7" fill="currentColor"/>` +
        `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="4.4" ry="3.1" fill="var(--paper,#fff)" transform="rotate(-52 ${r2(x)} ${r2(y)})"/></g>`;
    }
    if (kind === "half") {
      return `<g${cc}><ellipse cx="${r2(x)}" cy="${r2(y)}" rx="5.9" ry="4.45" fill="currentColor" transform="rotate(-21 ${r2(x)} ${r2(y)})"/>` +
        `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="5.1" ry="2.5" fill="var(--paper,#fff)" transform="rotate(-28 ${r2(x)} ${r2(y)})"/></g>`;
    }
    return `<ellipse${cc} cx="${r2(x)}" cy="${r2(y)}" rx="5.9" ry="4.45" fill="currentColor" transform="rotate(-21 ${r2(x)} ${r2(y)})"/>`;
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  /* ---------------- 레이아웃 ---------------- */
  function spaceFor(v, st = STYLE) { return Math.max(22, st.spaceBase * (1 + st.spaceK * Math.log2(v / (1 / 16)))); }

  const accidentalColumns = new WeakMap();
  let nextById = new Map();
  function staggerAccidentals(ev) {
    const columns = [];
    const offsets = new Map();
    for (const n of ev.notes.slice().sort((a, b) => C.absStep(b) - C.absStep(a))) {
      if (!n.__acc) continue;
      const as = C.absStep(n);
      let col = columns.findIndex(list => list.every(p => Math.abs(p - as) >= 6));
      if (col < 0) { col = columns.length; columns.push([]); }
      columns[col].push(as);
      offsets.set(n, col);
    }
    const data = { offsets, count: columns.length, width: columns.length * 11 };
    accidentalColumns.set(ev, data);
    return data;
  }

  /* 마디 내 임시표 표시 계산: note.__acc = 'sharp'|'flat'|'natural'|null */
  function computeAccidentals(score) {
    nextById = new Map();
    for (const ref of C.staffRefs(score)) {
      const previous = new Map(); // one predecessor per voice, including rests
      for (let m = 0; m < ref.measures.length; m++) {
        const eff = new Map(); // "step:oct" → alter
        for (const entry of C.measureEntries(ref.measures[m], { score, includeSilent: true })) {
          const ev = entry.ev;
          const prev = previous.get(entry.voice);
          if (prev) nextById.set(prev.id, ev.id);
          previous.set(entry.voice, ev);
          if (ev.type !== "note" || ev.drumId) continue;
          for (const note of ev.notes) {
            const k = note.step + ":" + note.oct;
            const cur = eff.has(k) ? eff.get(k) : C.keyAlterFor(note.step, keyAt(score, m));
            if (prev?.type === "note" && prev.notes.some(n => n.tie && n.step === note.step && n.oct === note.oct && n.alter === note.alter)) {
              note.__acc = null;            // 타이로 이어진 음은 임시표 생략
              eff.set(k, note.alter);
            } else if (note.alter !== cur) {
              note.__acc = note.alter === 1 ? "sharp" : note.alter === -1 ? "flat" : "natural";
              eff.set(k, note.alter);
            } else {
              note.__acc = null;
            }
          }
          staggerAccidentals(ev);
        }
      }
    }
  }

  function eventWidth(ev, score) {
    const st = score ? styleOf(score) : STYLE;
    const v = C.durValue(ev.dur).value;
    let w = ev.full ? 58 : Math.max(26, spaceFor(v, st));
    if (ev.type === "note") {
      w += Math.max(0, st.noteheadScale - 1) * 12;
      if (ev.graceBefore && ev.graceBefore.length) w += ev.graceBefore.length * 14;
      w += accidentalColumns.get(ev)?.width || 0;
      if (hasSecond(ev)) w += 7 * st.noteheadScale;
      if (ev.dur.dots) w += 7 * ev.dur.dots;
      if (ev.dur.d === 1) w += ev.dur.n >= 2 ? 14 : 6;
    } else if (ev.dur.dots) w += 7 * ev.dur.dots;
    for (const lyric of C.lyricsOf(ev)) w = Math.max(w, Array.from(lyric.text).length * st.lyricFontSize * .8 + 16);
    if (ev.chordSymbol) w = Math.max(w, Array.from(C.displayChordSymbol(ev.chordSymbol)).length * st.chordFontSize * .6 + 14);
    return w;
  }
  function hasSecond(ev) {
    const steps = ev.notes.map(C.absStep).sort((a, b) => a - b);
    for (let i = 0; i + 1 < steps.length; i++) if (steps[i + 1] - steps[i] === 1) return true;
    return false;
  }

  function headerWidth(score, firstSystem, m = 0) {
    const k = Math.abs(keyAt(score, m));
    const ts = timeAt(score, m);
    const showTime = firstSystem || !!score.measures[m]?.timeSig;
    const cancel = m ? cancellationSteps(keyAt(score, m - 1), keyAt(score, m)).length : 0;
    return 14 + 28 + ((k + cancel) ? (k + cancel) * 9.5 + 7 : 0) + (showTime ? Math.max(30, String(ts.num).length * 16 + 8) : 0) + 10;
  }
  function measureCount(score, refs) {
    return Math.max(1, ...refs.map(r => r.measures.length));
  }
  function measureNaturalWidth(refs, mIdx, score, activeVoice) {
    const seg = new Map();
    for (const ref of refs) {
      const mm = ref.measures[mIdx];
      if (!mm) continue;
      const entries = C.measureEntries(mm, { score, activeVoice });
      if (entries.length === 1 && entries[0].ev.full) {
        seg.set("0/1", Math.max(seg.get("0/1") || 0, eventWidth(entries[0].ev, score)));
        continue;
      }
      for (const { ev, tick } of entries) {
        const key = tick.toString();
        seg.set(key, Math.max(seg.get(key) || 0, eventWidth(ev, score) + (ev.voice > 1 ? 8 : 0)));
      }
    }
    return Math.max(styleOf(score).measureMinWidth, 16 + [...seg.values()].reduce((a, w) => a + w, 0));
  }
  function segmentMapFor(refs, mIdx, scale, score, activeVoice) {
    const seg = new Map();
    for (const ref of refs) {
      const mm = ref.measures[mIdx];
      if (!mm) continue;
      for (const { ev, tick } of C.measureEntries(mm, { score, activeVoice })) {
        const key = tick.toString();
        seg.set(key, Math.max(seg.get(key) || 0, eventWidth(ev, score) + (ev.voice > 1 ? 8 : 0)));
      }
    }
    return [...seg.entries()]
      .map(([key, w]) => ({ key, width: w * scale }))
      .sort((a, b) => Fraction.from(a.key.split("/").map(Number)).cmp(Fraction.from(b.key.split("/").map(Number))));
  }

  function cancellationSteps(before, after) {
    if (!before || before === after) return [];
    const order = before > 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
    return order.slice(Math.sign(before) === Math.sign(after) ? Math.abs(after) : 0, Math.abs(before));
  }
  function changeWidth(score, refs, m) {
    if (!m) return 0;
    const before = keyAt(score, m - 1), after = keyAt(score, m);
    const key = before === after ? 0 : (Math.abs(after) + cancellationSteps(before, after).length) * 9.5 + 8;
    const time = JSON.stringify(timeAt(score, m - 1)) === JSON.stringify(timeAt(score, m)) ? 0 : Math.max(30, String(timeAt(score, m).num).length * 16 + 8);
    const clef = refs.some(ref => clefAt(ref, m - 1) !== clefAt(ref, m)) ? 30 : 0;
    return key + time + clef;
  }
  function multirestGroups(score, refs, opts, count) {
    const enabled = opts.multiRest ?? opts.viewMode?.type === "part";
    const expanded = new Set(opts.expandedMeasures || []);
    const endpoints = new Set((score.spanners || []).flatMap(sp => [sp.startId, sp.endId]));
    const clean = m => {
      if (!enabled || expanded.has(m)) return false;
      const meta = score.measures[m] || {};
      if (["keySig", "timeSig", "pickup", "length", "measureLen"].some(k => meta[k] != null) || ["startRepeat", "endRepeat", "endingStart", "endingStop", "breakType", "sectionName", "jump", "marker"].some(k => meta[k])) return false;
      return refs.every(ref => {
        const mm = ref.measures[m];
        if (!mm || mm.clef) return false;
        return C.measureEntries(mm, { score, includeSilent: true }).every(({ ev }) =>
          ev.type === "rest" && ev.full && !endpoints.has(ev.id) && !C.lyricsOf(ev).length &&
          !(ev.artics?.length || ev.graceBefore?.length) && !["tempo", "rehearsal", "staffText", "chordSymbol", "fretboard", "dynamic", "ornament", "hidden", "soundFlag", "color", "offsetX", "offsetY"].some(k => ev[k]));
      });
    };
    const groups = [];
    for (let i = 0; i < count;) {
      let end = i + 1;
      if (clean(i)) while (end < count && clean(end)) end++;
      groups.push({ idx: i, span: end - i, collapsed: end - i >= 2 });
      i = end;
    }
    return groups;
  }
  function ottavaMap(score, refs) {
    const positions = new Map(), result = new Map();
    for (const ref of refs) for (let m = 0; m < ref.measures.length; m++)
      for (const en of C.measureEntries(ref.measures[m], { score, includeSilent: true })) positions.set(en.ev.id, { ref, m, tick: en.tick, voice: en.voice });
    for (const sp of score.spanners || []) {
      if (sp.type !== "ottava") continue;
      const a = positions.get(sp.startId), b = positions.get(sp.endId);
      if (!a || !b || a.ref.globalIdx !== b.ref.globalIdx || a.voice !== b.voice || ![12, -12].includes(sp.shift)) continue;
      for (const [id, p] of positions) if (p.ref === a.ref && p.voice === a.voice &&
        (p.m > a.m || p.m === a.m && p.tick.gte(a.tick)) && (p.m < b.m || p.m === b.m && p.tick.lte(b.tick)))
        result.set(id, (result.get(id) || 0) + (sp.shift < 0 ? -7 : 7));
    }
    return result;
  }
  function staffLanes(score, ref, idxs, st, shifts) {
    const events = idxs.flatMap(m => C.measureEntries(ref.measures[m] || { events: [] }, { score }).map(en => ({ ...en, m })));
    const has = field => events.some(en => en.ev[field]);
    let top = 38, bottom = ref.staffType === "tab" ? 5 * SP + 14 : STAFF_H + 14;
    for (const { ev, m } of events) if (ev.type === "note" && !ev.drumId && ref.staffType !== "tab") {
      const base = clefInfo(clefAt(ref, m)).bottomStep + (shifts.get(ev.id) || 0);
      const ys = ev.notes.map(n => STAFF_H - (C.absStep(n) - base) * SP / 2);
      const extra = (ev.artics?.length || 0) * SP + (ev.dur.d >= 16 ? Math.log2(ev.dur.d / 8) * 4 : 0);
      top = Math.max(top, -Math.min(...ys) + 40 + extra);
      bottom = Math.max(bottom, Math.max(...ys) + (ev.voice % 2 === 0 ? 40 : 14) + extra);
    }
    const laneY = { lyric: {} };
    const above = (name, used, height) => { laneY[name] = -top; if (used) top += height; };
    above("ornament", has("ornament"), 22);
    above("tuplet", events.some(en => en.ev.dur.tuplet), 22);
    above("chord", has("chordSymbol"), st.chordFontSize + 7);
    above("rehearsal", has("rehearsal"), 28);
    above("tempo", has("tempo"), 22);
    above("text", has("staffText"), 20);
    const ids = new Set(events.map(en => en.ev.id));
    const ottava = (score.spanners || []).some(sp => sp.type === "ottava" && (ids.has(sp.startId) || ids.has(sp.endId) || events.some(en => shifts.has(en.ev.id))));
    above("ottava", ottava, 24);
    above("volta", idxs.some(m => score.measures[m]?.endingStart) || score.measures.some(mm => mm.endingStart), 26);
    above("marker", idxs.some(m => score.measures[m]?.marker || score.measures[m]?.jump), 26);
    laneY.dyn = bottom + 14;
    const hairpin = (score.spanners || []).some(sp => sp.type === "cresc" || sp.type === "dim");
    if (has("dynamic") || hairpin) bottom += 36;
    const verses = [...new Set(events.flatMap(en => C.lyricsOf(en.ev).map(l => l.verse)))].sort((a, b) => a - b);
    for (const verse of verses) { bottom += Math.max(st.lyricLineHeight, st.lyricFontSize + 3); laneY.lyric[verse] = bottom; }
    laneY.fretboard = bottom + 14;
    if (has("fretboard")) bottom += 76;
    if (ottava) bottom += 24;
    laneY.ottavaBelow = bottom;
    return { laneY, above: top + 12, below: bottom + 12 };
  }
  function titleHeight(score, opts) {
    if (opts.showTitle === false) return 0;
    const meta = score.meta || {};
    return (meta.title ? 42 : 0) + (meta.subtitle ? 26 : 0) + (meta.composer || meta.lyricist ? 30 : 0);
  }

  /* 핵심: 악보 → 시스템/이벤트 좌표 */
  function layout(score, opts = {}) {
    C.ensureParts(score);
    computeAccidentals(score);
    const metrics = pageMetrics(score);
    const st = styleOf(score);
    const refs = C.visibleStaffRefs ? C.visibleStaffRefs(score, opts.viewMode, { hideEmptyStaves: opts.hideEmptyStaves }) : C.staffRefs(score);
    const count = measureCount(score, refs);
    const lyricVerses = new Set();
    refs.forEach(ref => ref.measures.forEach(mm => C.measureEntries(mm, { score, activeVoice: opts.activeVoice }).forEach(({ ev }) => C.lyricsOf(ev).forEach(l => lyricVerses.add(l.verse)))));
    const hasLyrics = lyricVerses.size > 0;
    const hasDyn = refs.some(ref => ref.measures.some(mm => C.measureEntries(mm, { score, activeVoice: opts.activeVoice }).some(({ ev }) => ev.dynamic))) ||
      (score.spanners || []).some(sp => sp.type === "cresc" || sp.type === "dim");
    const PITCH = 150;
    const lyricOff = STAFF_H + (hasDyn ? 52 : 34);

    // 마디 자연 폭
    const changes = Array.from({ length: count }, (_, m) => changeWidth(score, refs, m));
    const natural = Array.from({ length: count }, (_, mIdx) => measureNaturalWidth(refs, mIdx, score, opts.activeVoice) * metrics.noteSpacing);
    const groups = multirestGroups(score, refs, opts, count);
    const groupByIndex = new Map(groups.map(g => [g.idx, g]));
    const shifts = ottavaMap(score, refs);

    // 그리디 줄바꿈
    const systems = [];
    let i = 0;
    while (i < groups.length) {
      const first = systems.length === 0;
      const nameW = refs.length > 1 ? (first ? 96 : 54) : 0;
      const hw = headerWidth(score, first, groups[i].idx);
      const usable = metrics.width - metrics.marginLeft - metrics.marginRight - nameW;
      const perSystem = score.layout?.measuresPerSystem | 0;
      let sum = 0; const idxs = [];
      let breakAfter = null;
      while (i < groups.length) {
        const group = groups[i], m = group.idx;
        const w = (group.collapsed ? 72 : natural[m]) + (idxs.length ? changes[m] : 0);
        if (perSystem > 0 && idxs.length >= perSystem) break;
        if (idxs.length && hw + sum + w > usable) break;
        idxs.push(m); sum += w;
        const mm = C.ensureMeasureMeta(score.measures[m + group.span - 1] || {});
        breakAfter = mm.breakType || null;
        i++;
        if (breakAfter && i < groups.length) break;
      }
      const lanes = refs.map(ref => staffLanes(score, ref, idxs, st, shifts));
      let groupH = 0;
      const relY = lanes.map((lane, ri) => {
        if (ri === 0) groupH = lane.above;
        else groupH += (refs[ri].partIdx === refs[ri - 1].partIdx ? 18 : 30) * metrics.staffGap + lane.above;
        const y = groupH; groupH += lane.below; return y;
      });
      systems.push({ idxs, hw, sum, nameW, usable, breakAfter, lanes, relY, groupH });
    }

    // 시스템별 좌표 채우기
    const out = { systems: [], pages: [], measuresByIndex: new Map(), eventsById: new Map(), pitch: PITCH, hasLyrics, refs, pageW: metrics.width, metrics, style: st,
      pageMode: opts.pageMode === "pages" ? "pages" : "continuous", nextById: new Map(nextById), multiRest: groups.some(g => g.collapsed) };
    let page = null, yCursor = 0;
    const newPage = () => {
      const index = out.pages.length;
      const offsetY = out.pageMode === "pages" ? index * metrics.height : index ? yCursor + 36 : 0;
      page = { index, systems: [], yTop: offsetY, offsetY, width: metrics.width, height: metrics.height, overflow: false };
      out.pages.push(page);
      yCursor = offsetY + metrics.marginTop + (index === 0 ? titleHeight(score, opts) : 0);
    };
    newPage();
    systems.forEach((sys, si) => {
      if (page.systems.length && (systems[si - 1]?.breakAfter === "page" || yCursor - page.offsetY + sys.groupH > metrics.height - metrics.marginBottom)) newPage();
      const contentTop = yCursor;
      const yTop = contentTop + sys.relY[0];
      const isLast = si === systems.length - 1;
      let scale = (sys.usable - sys.hw) / sys.sum;
      if (isLast && scale > 1 / 0.7) scale = 1;
      scale = Math.max(scale, 0.05);

      const staffX0 = metrics.marginLeft + sys.nameW;
      const S = {
        yTop, pageX0: metrics.marginLeft, nameW: sys.nameW,
        x0: staffX0, x1: isLast && scale === 1 ? staffX0 + sys.hw + sys.sum : metrics.width - metrics.marginRight,
        headerW: sys.hw, measures: [],
        staffLayouts: [],
        middleY: yTop + STAFF_H / 2,
        first: si === 0,
        lyricOff,
        breakAfter: sys.breakAfter,
        pageW: metrics.width,
        index: si, page: page.index, pageY: yTop - page.offsetY,
        contentTop, contentBottom: contentTop + sys.groupH,
        height: sys.groupH, style: st,
      };
      for (const [ri, ref] of refs.entries()) {
        const sy = contentTop + sys.relY[ri];
        const laneY = Object.fromEntries(Object.entries(sys.lanes[ri].laneY).map(([k, v]) => [k, k === "lyric" ? Object.fromEntries(Object.entries(v).map(([verse, off]) => [verse, sy + off])) : sy + v]));
        const SL = { ...ref, clef: clefAt(ref, sys.idxs[0]), mIdx: sys.idxs[0], sys: S, page: page.index, yTop: sy, x0: S.x0, x1: S.x1, headerW: S.headerW, middleY: sy + STAFF_H / 2, lyricOff, laneY, style: st };
        S.staffLayouts.push(SL);
      }
      S.laneY = S.staffLayouts[0].laneY;
      let x = S.x0 + sys.hw;
      for (const mIdx of sys.idxs) {
        const group = groupByIndex.get(mIdx);
        const prefixW = mIdx === sys.idxs[0] ? 0 : changes[mIdx];
        const mW = ((group.collapsed ? 72 : natural[mIdx]) + prefixW) * scale;
        const M = { ...group, x0: x, x1: x + mW, events: [], staffMeasures: [], page: page.index, prefixW: prefixW * scale, scale, length: lengthAt(score, mIdx) };
        const segs = segmentMapFor(refs, mIdx, scale * metrics.noteSpacing, score, opts.activeVoice);
        const segX = new Map();
        let ex = x + (prefixW + st.systemFirstMeasurePadding) * scale;
        for (const seg of segs) {
          segX.set(seg.key, ex);
          ex += seg.width;
        }
        for (const SL of S.staffLayouts) {
          const mm = SL.measures[mIdx] || { events: [C.fullRest(score, mIdx)] };
          const MS = { ...SL, clef: clefAt(SL, mIdx), mIdx };
          const SM = { ...group, idx: mIdx, x0: x, x1: x + mW, events: [], staff: MS, prefixW: M.prefixW, scale };
          const entries = C.measureEntries(mm, { score, activeVoice: opts.activeVoice });
          if (group.collapsed || entries.length === 1 && entries[0].ev.full) {
            const ent = entries[0];
            SM.events.push(mkEv(ent.ev, mIdx, ent.e, x + M.prefixW + (mW - M.prefixW) / 2, S, MS, score, Fraction.ZERO, ent.voice, shifts));
          } else {
            entries.forEach((ent) => {
              const ev = ent.ev;
              const tick = ent.tick;
              const key = tick.toString();
              const baseX = segX.get(key) ?? (x + 12 * scale);
              const accW = accidentalColumns.get(ev)?.width || 0;
              const voiceOffset = ent.voice > 1 ? (ent.voice % 2 === 0 ? 7 : -7) : 0;
              const cx = baseX + accW + 6.5 + (ev.dur.d === 1 ? 3 : 0) + voiceOffset;
              SM.events.push(mkEv(ev, mIdx, ent.e, cx, S, MS, score, tick, ent.voice, shifts));
            });
          }
          for (const le of SM.events) {
            out.eventsById.set(le.id, le);
            M.events.push(le);
          }
          M.staffMeasures.push(SM);
        }
        S.measures.push(M);
        for (let m = mIdx; m < mIdx + group.span; m++) out.measuresByIndex.set(m, M);
        x += mW;
      }
      out.systems.push(S);
      page.systems.push(S);
      if (S.contentBottom - page.offsetY > metrics.height - metrics.marginBottom) page.overflow = true;
      yCursor = S.contentBottom + 30 * metrics.systemGap + (sys.breakAfter === "section" ? 38 : 0);
    });
    out.height = out.pageMode === "pages" ? out.pages.length * metrics.height : Math.max(metrics.height, yCursor + metrics.marginBottom);
    out.score = score;
    lastLayout = out;
    return out;
  }

  function mkEv(ev, mIdx, eIdx, cx, S, SL, score, tick, voice = 1, shifts = new Map()) {
    const staff = { ...SL, ottavaSteps: shifts.get(ev.id) || 0 };
    return {
      id: ev.id, ev, mIdx, eIdx, voice, x: cx, sys: S, staff, clef: staff.clef,
      page: S.page, ottavaSteps: staff.ottavaSteps, noteheads: [],
      partIdx: SL.partIdx, staffIdx: SL.staffIdx, globalIdx: SL.globalIdx, tick,
      startTime: null, // playback에서 채움
    };
  }

  /* absStep → y 좌표 (시스템 기준) */
  function bottomFor(S, score, mIdx) {
    if (S.staffLayouts?.length) S = S.staffLayouts[0];
    return clefInfo(mIdx == null ? S.clef || score.clef : clefAt(S, mIdx)).bottomStep + (S.ottavaSteps || 0);
  }
  function yForStep(S, score, as, mIdx) {
    const bottom = bottomFor(S, score, mIdx);
    const bottomY = S.yTop + STAFF_H;
    return bottomY - (as - bottom) * (SP / 2);
  }
  function stepForY(S, score, y, mIdx) {
    const bottom = bottomFor(S, score, mIdx);
    const bottomY = S.yTop + STAFF_H;
    return Math.round((bottomY - y) / (SP / 2)) + bottom;
  }

  /* ---------------- 렌더 ---------------- */
  let lastLayout = null;
  const renderCache = new WeakMap();

  function render(score, opts = {}) {
    const savedLayout = lastLayout, savedFont = fontReady;
    if (opts.fallback) fontReady = false;
    try {
    C.ensureParts(score);
    // Structural edits invalidate the core revision. Small presentation fields
    // are included because callers may change view settings without a mutation.
    const cacheKey = JSON.stringify([score.__cache?.rev, fontReady, score.meta, score.layout, score.style,
      score.activeStaff, opts], (_key, value) => value instanceof Set ? [...value] : value);
    const cached = renderCache.get(score);
    if (opts.cache === true && cached?.key === cacheKey) {
      lastLayout = cached.result.layout;
      return cached.result;
    }
    const L = layout(score, opts);
    let sel = opts.selection || null;
    if (sel && typeof sel === "object" && !(sel instanceof Set) && sel.id) sel = sel.noteIdx == null ? sel.id : `${sel.id}#${sel.noteIdx}`;
    if (sel && !(sel instanceof Set)) sel = new Set([sel]);
    if (sel && Number.isInteger(opts.selectedNoteIdx)) sel = new Set([...sel].map(id => `${id}#${opts.selectedNoteIdx}`));
    const contents = new Map(L.pages.map(p => [p.index, ""]));

    for (const S of L.systems) {
      let svg = staffLines(S);
      svg += clefAndKey(S, score);
      if (S.first || score.measures[S.measures[0].idx]?.timeSig) svg += timeSig(S, score);
      svg += barlines(S, score);
      svg += measureNumbers(S, score);
      svg += renderVoltas(S, score);
      if (!opts.export) svg += renderBreakMarks(S, score);
      svg += renderMeasureMarks(S, score);
      for (const M of S.measures) {
        for (const SM of M.staffMeasures) {
          svg += renderMeasureChanges(score, S, SM);
          if (SM.collapsed) { svg += renderMultiRest(SM, sel); continue; }
          const beams = computeBeams(score, SM, SM.staff);
          svg += renderMeasure(score, SM, SM.staff, beams, sel);
        }
      }
      contents.set(S.page, contents.get(S.page) + `<g class="system" data-system="${S.index}" data-page="${S.page}">${svg}</g>`);
    }
    for (const page of L.pages) contents.set(page.index, contents.get(page.index) + renderTies(score, L, page.index) + renderSpanners(score, L, sel, page.index));
    const pagesMode = L.pageMode === "pages";
    const build = (page, body) => {
      const index = page?.index ?? 0;
      const height = pagesMode ? page.height : L.height;
      const offset = pagesMode ? page.offsetY : 0;
      const attrs = pagesMode ? `class="page" data-page="${index}" id="score-svg-page-${index}"` : 'id="score-svg"';
      const overlays = opts.export ? "" : ["ghost", "cursor", "speedy"].map(name => `<g ${pagesMode ? `class="overlay-${name}" data-page="${index}"` : `id="overlay-${name}" class="overlay-${name}"`} pointer-events="none"></g>`).join("") +
        `<line ${pagesMode ? 'class="play-cursor"' : 'id="play-cursor" class="play-cursor"'} x1="0" x2="0" y1="0" y2="0" stroke="var(--accent,#e8590c)" stroke-width="2" opacity="0" pointer-events="none"/>`;
      return `<svg ${attrs} viewBox="0 0 ${L.pageW} ${height}" width="${L.pageW}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(score.meta?.title || "Score")}, ${countMeasures(L)} measures, page ${index + 1}" font-family="Arial,sans-serif" style="color:var(--ink,#161a20);background:var(--paper,#fff)" preserveAspectRatio="xMidYMin meet">` +
        `<style>${svgStyles(L.style, opts.export)}</style>${renderPageText(score, L, page, opts)}` +
        `<g ${pagesMode ? 'class="page-content"' : 'id="score-main"'} transform="translate(0,${-offset})">${body}${overlays}</g></svg>`;
    };
    const pageSVGs = pagesMode ? L.pages.map(p => build(p, contents.get(p.index))) : [build(null, [...contents.values()].join(""))];
    const result = { svg: pageSVGs.join(""), pages: pageSVGs, pageSVGs, layout: L };
    if (opts.cache === true) renderCache.set(score, { key: cacheKey, result });
    return result;
    } finally {
      fontReady = savedFont;
      if (opts.preserveLayout || opts.export) lastLayout = savedLayout;
    }
  }

  function countMeasures(L) { return Math.max(0, ...L.refs.map(ref => ref.measures.length)); }
  function svgStyles(st, exporting) {
    return `.staff line{stroke:currentColor;stroke-width:${st.staffLineWidth}}.barline line{stroke:currentColor;stroke-width:1.5}.barline rect,.repeat-dot{fill:currentColor}.brace{fill:none;stroke:currentColor;stroke-width:1.8}.ev{fill:currentColor;color:inherit}.ev .stem,.stem{stroke:currentColor;stroke-width:${st.stemWidth};stroke-linecap:round}.ledger{stroke:currentColor;stroke-width:1.2}.beam,.tie,.slur{fill:currentColor}.hairpin line,.ottava line,.glissando-mark,.lyric-extend{stroke:currentColor;stroke-width:1.2}.tuplet path,.volta path,.arpeggio-mark{fill:none;stroke:currentColor;stroke-width:1.1}.tuplet text,.volta text,.mnum{font:13px Georgia,serif;fill:currentColor}.lyric,.lyric-hyphen{font:${st.lyricFontSize}px Arial,sans-serif;fill:currentColor}.chord-symbol{font:bold ${st.chordFontSize}px Arial,sans-serif}.dyn-fb{font:italic bold 16.5px Georgia,serif}.part-name,.staff-text,.tempo-mark,.rehearsal-mark text,.measure-mark{font:13px Arial,sans-serif}.rehearsal-mark rect,.tab-fret-bg{fill:var(--paper,#fff);stroke:currentColor;stroke-width:1}.fretboard line{stroke:currentColor;stroke-width:1}.fretboard .nut{stroke-width:3}.fretboard text{font:9px Arial,sans-serif}.fretboard circle{fill:currentColor}.tremolo-mark{stroke:currentColor;stroke-width:3}.grace-head{transform-box:fill-box;transform-origin:center;transform:scale(.68)}.grace-stem,.grace-slash{stroke:currentColor;stroke-width:1.2}.tab-clef,.tab-fret{font:bold 14px Arial,sans-serif}.hidden-event{opacity:.28}.small-event .nh{transform-box:fill-box;transform-origin:center;transform:scale(.75)}.ev .hit{pointer-events:all}.nh{pointer-events:all}.nh.sel-note{color:var(--select,#2874c8);fill:var(--select,#2874c8)}.score-title{font:bold 30px Georgia,serif}.score-subtitle{font:18px Georgia,serif}.score-credit,.score-copyright,.page-number{font:13px Arial,sans-serif}` +
      (exporting ? `svg{--paper:#fff;--ink:#000;--select:#000;color:#000!important;background:#fff!important}.hidden-event,.break-mark,.hit{display:none}.ev.sel,.ev.playing,.nh.sel-note{color:#000;fill:#000}` : "");
  }
  function renderPageText(score, L, page, opts) {
    const index = page?.index || 0, meta = score.meta || {}, metrics = L.metrics;
    let s = "", y = metrics.marginTop;
    if (!index && opts.showTitle !== false) {
      if (meta.title) { y += 30; s += `<text class="score-title" data-meta="title" x="${L.pageW / 2}" y="${y}" text-anchor="middle">${esc(meta.title)}</text>`; y += 12; }
      if (meta.subtitle) { y += 18; s += `<text class="score-subtitle" data-meta="subtitle" x="${L.pageW / 2}" y="${y}" text-anchor="middle">${esc(meta.subtitle)}</text>`; y += 8; }
      if (meta.composer || meta.lyricist) {
        y += 18;
        s += `<text class="score-credit" data-meta="composer" x="${L.pageW - metrics.marginRight}" y="${y}" text-anchor="end">${esc(meta.composer || "")}</text>`;
        s += `<text class="score-credit" data-meta="lyricist" x="${metrics.marginLeft}" y="${y}">${esc(meta.lyricist || "")}</text>`;
      }
    }
    const footerY = (page ? page.height : L.height) - Math.max(18, metrics.marginBottom / 2);
    if (!index && meta.copyright) s += `<text class="score-copyright" data-meta="copyright" x="${L.pageW / 2}" y="${footerY}" text-anchor="middle">${esc(meta.copyright)}</text>`;
    if (index > 0 || opts.numberFirstPage) s += `<text class="page-number" x="${L.pageW / 2}" y="${footerY}" text-anchor="middle">${index + 1}</text>`;
    return s;
  }
  // Standalone SVG uses only vector music glyphs and its own CSS. It never
  // replaces the interactive layout, even if rendering throws.
  async function renderForExport(score, opts = {}) {
    return render(score, { ...opts, pageMode: opts.pageMode || "pages", export: true, fallback: true, preserveLayout: true, selection: null });
  }

  function staffLines(S) {
    let s = `<g class="staff">`;
    for (const SL of S.staffLayouts) {
      const lines = SL.staffType === "tab" ? 6 : 5;
      for (let i = 0; i < lines; i++) {
        const y = SL.yTop + i * (SL.staffType === "tab" ? SP : SP);
        s += `<line x1="${SL.x0}" y1="${y}" x2="${SL.x1}" y2="${y}"/>`;
      }
      const label = S.first ? SL.name : SL.shortName;
      if (S.nameW && SL.staffIdx === 0) {
        s += `<text class="part-name" x="${S.x0 - 12}" y="${SL.middleY + 4}" text-anchor="end">${esc(label)}</text>`;
      }
    }
    for (const partIdx of [...new Set(S.staffLayouts.map(st => st.partIdx))]) {
      const list = S.staffLayouts.filter(st => st.partIdx === partIdx);
      if (list.length < 2) continue;
      const x = S.x0 - 20, y1 = list[0].yTop - 2, y2 = list[list.length - 1].yTop + STAFF_H + 2;
      s += `<path class="brace" d="M ${r2(x + 9)} ${r2(y1)} C ${r2(x - 9)} ${r2(y1 + 18)}, ${r2(x - 9)} ${r2((y1 + y2) / 2 - 14)}, ${r2(x + 4)} ${r2((y1 + y2) / 2)} C ${r2(x - 9)} ${r2((y1 + y2) / 2 + 14)}, ${r2(x - 9)} ${r2(y2 - 18)}, ${r2(x + 9)} ${r2(y2)}"/>`;
    }
    return s + "</g>";
  }

  function clefAndKey(S, score) {
    let s = "";
    for (const SL of S.staffLayouts) {
      s += drawClef(SL, score, SL.x0 + 14);
      const m = S.measures[0].idx;
      s += drawKey(SL, score, SL.x0 + 46, keyAt(score, m), m ? keyAt(score, m - 1) : 0);
    }
    return s;
  }
  function drawClef(SL, score, cx, scale = 1) {
      let s = "";
      if (SL.staffType === "tab") {
        s += `<text class="tab-clef" x="${r2(cx - 10)}" y="${r2(SL.yTop + 2.8 * SP)}" font-weight="800" font-size="16">TAB</text>`;
      } else if (SL.clef === "percussion" || SL.instrumentType === "percussion") {
        const y = SL.yTop + SP * 1.1;
        s += `<g class="perc-clef" transform="translate(${r2(cx - 4)},${r2(y)})"><rect x="-4" y="-9" width="3.2" height="28" rx="1.4"/><rect x="4" y="-9" width="3.2" height="28" rx="1.4"/></g>`;
      } else if (SL.clef === "alto" || SL.clef === "tenor") {
        s += glyph("cClef", cx, SL.yTop + (SL.clef === "alto" ? 2 : 1) * SP, { scale });
      } else if (SL.clef === "treble" || SL.clef === "treble8vb") {
        s += glyph("gClef", cx, SL.yTop + 3 * SP, { scale });
      } else {
        s += glyph("fClef", cx, SL.yTop + SP, { scale });
      }
      if (SL.clef.endsWith("8vb")) s += `<text class="clef-octave" x="${r2(cx)}" y="${r2(SL.yTop + (SL.clef === "treble8vb" ? 64 : 37))}" font-family="Georgia,serif" font-size="12" text-anchor="middle">8</text>`;
      return s;
  }
  function keySteps(k, clef) {
    const info = clefInfo(clef), bottom = info.bottomStep;
    const order = k > 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
    return order.slice(0, Math.abs(k)).map(step => {
      let as = Math.floor(bottom / 7) * 7 + step;
      while (as < bottom + (k > 0 ? 3 : 2)) as += 7;
      while (as > bottom + (k > 0 ? 9 : 8)) as -= 7;
      return as;
    });
  }
  function drawKey(SL, score, x, k, previous = 0) {
    if (SL.staffType === "tab" || SL.clef === "percussion" || SL.instrumentType === "percussion") return "";
    let s = "", i = 0;
    const canceled = new Set(cancellationSteps(previous, k));
    for (const as of keySteps(previous, SL.clef)) if (canceled.has((as % 7 + 7) % 7)) s += glyph("natural", x + i++ * 9.5, yForStep(SL, score, as), { cls: "key-cancel" });
    for (const as of keySteps(k, SL.clef)) s += glyph(k > 0 ? "sharp" : "flat", x + i++ * 9.5, yForStep(SL, score, as), { cls: "key-signature" });
    return s;
  }
  function renderMeasureChanges(score, S, M) {
    if (!M.prefixW) return "";
    const m = M.idx, SL = M.staff;
    let x = M.x0 + 12, s = "";
    if (clefAt(SL, m - 1) !== SL.clef) { s += drawClef(SL, score, x, .8); x += 30; }
    if (keyAt(score, m - 1) !== keyAt(score, m)) {
      s += drawKey(SL, score, x, keyAt(score, m), keyAt(score, m - 1));
      x += (Math.abs(keyAt(score, m)) + cancellationSteps(keyAt(score, m - 1), keyAt(score, m)).length) * 9.5 + 8;
    }
    if (JSON.stringify(timeAt(score, m - 1)) !== JSON.stringify(timeAt(score, m))) s += drawTime(SL, timeAt(score, m), x + 10);
    return `<g class="measure-change" data-measure="${m}">${s}</g>`;
  }

  function timeSig(S, score) {
    const x = S.x0 + S.headerW - 24;
    return S.staffLayouts.map(SL => drawTime(SL, timeAt(score, S.measures[0].idx), x)).join("");
  }
  function drawTime(SL, ts, x) {
    const draw = (n, y) => {
      const str = String(n);
      if (fontReady) {
        const g = str.split("").map(ch => TIMESIG_DIGITS[+ch]).join("");
        return `<text x="${x}" y="${y}" font-family="BravuraSF" font-size="40px" text-anchor="middle">${g}</text>`;
      }
      return `<text x="${x}" y="${y + 7}" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="23px" text-anchor="middle">${str}</text>`;
    };
    return `<g class="time-signature">${draw(ts.num, SL.yTop + SP)}${draw(ts.den, SL.yTop + 3 * SP)}</g>`;
  }

  function barlines(S, score) {
    let s = `<g class="barline">`;
    const partIdxs = [...new Set(S.staffLayouts.map(st => st.partIdx))];
    const count = Math.max(...C.staffRefs(score).map(r => r.measures.length));
    for (const partIdx of partIdxs) {
      const list = S.staffLayouts.filter(st => st.partIdx === partIdx);
      const yT = list[0].yTop, yB = list[list.length - 1].yTop + STAFF_H;
      s += `<line x1="${S.x0}" y1="${yT}" x2="${S.x0}" y2="${yB}"/>`;
      S.measures.forEach((M) => {
        const mm = C.ensureMeasureMeta(score.measures[M.idx] || {});
        if (mm.startRepeat) s += repeatStart(M.x0, list);
        const isScoreEnd = M.idx + (M.span || 1) === count;
        if (mm.endRepeat) {
          s += repeatEnd(M.x1, list);
        } else if (isScoreEnd) {
          s += `<line x1="${r2(M.x1 - 7)}" y1="${yT}" x2="${r2(M.x1 - 7)}" y2="${yB}"/>`;
          s += `<rect x="${r2(M.x1 - 4)}" y="${yT}" width="4" height="${yB - yT}" class="thick"/>`;
        } else {
          s += `<line x1="${r2(M.x1)}" y1="${yT}" x2="${r2(M.x1)}" y2="${yB}"/>`;
        }
      });
    }
    return s + "</g>";
  }
  function repeatStart(x, staffLayouts) {
    let s = "";
    const yT = staffLayouts[0].yTop, yB = staffLayouts[staffLayouts.length - 1].yTop + STAFF_H;
    s += `<rect x="${r2(x + 1)}" y="${yT}" width="4" height="${yB - yT}" class="thick"/>`;
    s += `<line x1="${r2(x + 8)}" y1="${yT}" x2="${r2(x + 8)}" y2="${yB}"/>`;
    for (const st of staffLayouts) s += repeatDots(x + 13, st);
    return s;
  }
  function repeatEnd(x, staffLayouts) {
    let s = "";
    const yT = staffLayouts[0].yTop, yB = staffLayouts[staffLayouts.length - 1].yTop + STAFF_H;
    s += `<line x1="${r2(x - 9)}" y1="${yT}" x2="${r2(x - 9)}" y2="${yB}"/>`;
    s += `<rect x="${r2(x - 5)}" y="${yT}" width="4" height="${yB - yT}" class="thick"/>`;
    for (const st of staffLayouts) s += repeatDots(x - 14, st);
    return s;
  }
  function repeatDots(x, st) {
    return `<circle class="repeat-dot" cx="${r2(x)}" cy="${r2(st.yTop + SP * 1.5)}" r="2.2"/>` +
      `<circle class="repeat-dot" cx="${r2(x)}" cy="${r2(st.yTop + SP * 2.5)}" r="2.2"/>`;
  }

  function renderVoltas(S, score) {
    const ranges = [];
    for (let i = 0; i < score.measures.length; i++) {
      const mm = C.ensureMeasureMeta(score.measures[i] || {});
      if (!mm.endingStart) continue;
      let j = i;
      while (j + 1 < score.measures.length && !C.ensureMeasureMeta(score.measures[j] || {}).endingStop) j++;
      ranges.push({ from: i, to: j, label: mm.endingStart });
    }
    if (!ranges.length) return "";
    let s = `<g class="volta">`;
    for (const r of ranges) {
      const visible = S.measures.filter(M => M.idx >= r.from && M.idx <= r.to);
      if (!visible.length) continue;
      const first = visible[0], last = visible[visible.length - 1];
      const startsHere = first.idx === r.from;
      const endsHere = last.idx === r.to;
      const x1 = startsHere ? first.x0 + 4 : S.x0 + S.headerW;
      const x2 = endsHere ? last.x1 - 4 : S.x1 - 3;
      const y = S.laneY.volta;
      s += `<path d="M ${r2(x1)} ${r2(y + 16)} L ${r2(x1)} ${r2(y)} L ${r2(x2)} ${r2(y)}${endsHere ? ` L ${r2(x2)} ${r2(y + 16)}` : ""}"/>`;
      if (startsHere) s += `<text x="${r2(x1 + 7)}" y="${r2(y + 12)}">${esc(r.label)}.</text>`;
    }
    return s + "</g>";
  }

  function measureNumbers(S, score) {
    if (S.first && S.measures.length && S.measures[0].idx === 0) return "";
    if (!S.measures.length) return "";
    return `<text class="mnum" x="${S.x0 + 2}" y="${S.yTop - 14}">${S.measures[0].idx + (score.measures[0]?.pickup ? 0 : 1)}</text>`;
  }

  function renderMultiRest(M, sel) {
    const S = M.staff, x1 = M.x0 + 20, x2 = M.x1 - 20, y = S.middleY;
    const id = M.events[0]?.id || "";
    return `<g class="ev multirest${sel?.has(id) ? " sel" : ""}" data-ref="${esc(id)}" data-measure="${M.idx}" data-span="${M.span}"><path d="M ${r2(x1)} ${r2(y)} H ${r2(x2)}" stroke="currentColor" stroke-width="7"/><path d="M ${r2(x1)} ${r2(y - 8)} v 16 M ${r2(x2)} ${r2(y - 8)} v 16" stroke="currentColor" stroke-width="1.5"/><text x="${r2((x1 + x2) / 2)}" y="${r2(S.yTop - 8)}" font-family="Georgia,serif" font-weight="bold" font-size="17" text-anchor="middle">${M.span}</text><rect class="hit" x="${M.x0}" y="${S.yTop - 20}" width="${M.x1 - M.x0}" height="70" fill="transparent"/></g>`;
  }
  function renderMeasureMarks(S, score) {
    const jumps = { DC: "D.C.", DS: "D.S.", DCalFine: "D.C. al Fine", DSalFine: "D.S. al Fine", DCalCoda: "D.C. al Coda", DSalCoda: "D.S. al Coda" };
    let s = "";
    for (const M of S.measures) {
      const mm = score.measures[M.idx] || {}, y = S.laneY.marker;
      if (mm.marker) {
        const x = M.x0 + M.prefixW + 14;
        s += mm.marker === "segno" || mm.marker === "coda" ? glyph(mm.marker, x, y, { cls: "measure-marker" }) : `<text class="measure-mark" x="${r2(x)}" y="${r2(y)}">${mm.marker === "toCoda" ? "To Coda" : "Fine"}</text>`;
      }
      if (mm.jump) s += `<text class="measure-mark jump" x="${r2(M.x1 - 8)}" y="${r2(y - (mm.marker ? 22 : 0))}" text-anchor="end">${esc(jumps[mm.jump.type] || mm.jump.type || "")}</text>`;
    }
    return s;
  }

  function renderBreakMarks(S, score) {
    let s = "";
    for (const M of S.measures) {
      const mm = C.ensureMeasureMeta(score.measures[M.idx] || {});
      if (!mm.breakType) continue;
      const label = mm.breakType === "page" ? "Page" : mm.breakType === "section" ? (mm.sectionName || "Section") : "System";
      const y = Math.max(...S.staffLayouts.map(st => st.yTop + (st.staffType === "tab" ? 5 * SP : STAFF_H))) + 26;
      s += `<g class="break-mark" data-break="${esc(mm.breakType)}">` +
        `<line x1="${r2(M.x1)}" y1="${r2(S.yTop - 20)}" x2="${r2(M.x1)}" y2="${r2(y - 9)}"/>` +
        `<text x="${r2(M.x1 - 4)}" y="${r2(y)}" text-anchor="end">${esc(label)}</text>` +
        `</g>`;
    }
    return s;
  }

  /* ---- 빔 계산 ----
   * 기본은 박(beat) 단위 그룹. 단, x/4 박자에서 순수 8분음표 런은
   * 관례대로 2박 단위(박 1+2, 3+4)로 병합한다. 16분음표가 끼면 박 단위 유지.
   */
  function computeBeams(score, M, S) {
    const ts = timeAt(score, M.idx);
    const beat = C.beatLen(ts);
    const L = lengthAt(score, M.idx);
    const bounds = [];
    let acc = beat;
    while (acc.lte(L)) { bounds.push(acc); acc = acc.add(beat); }
    const groupOf = (t) => { for (let i = 0; i < bounds.length; i++) if (t.lt(bounds[i])) return i; return bounds.length - 1; };

    const runs = [];
    for (let voice = 1; voice <= C.VOICE_COUNT; voice++) {
      let cur = null;
      M.events.filter(le => (le.voice || 1) === voice).forEach((le) => {
        const ev = le.ev;
        const beamable = ev.type === "note" && ev.dur.d >= 8 && !ev.full;
        const gi = groupOf(le.tick);
        if (beamable && cur && cur.gi === gi) {
          cur.items.push(le);
          cur.endTick = le.tick.add(C.durValue(ev.dur));
          cur.all8 = cur.all8 && ev.dur.d === 8;
        } else if (beamable) {
          cur = {
            gi, voice, items: [le],
            startTick: le.tick,
            endTick: le.tick.add(C.durValue(ev.dur)),
            all8: ev.dur.d === 8,
          };
          runs.push(cur);
        } else {
          cur = null;
        }
      });
    }
    if (ts.den === 4 && ts.num % 2 === 0) {
      for (let i = 0; i + 1 < runs.length; i++) {
        const a = runs[i], b = runs[i + 1];
        if (a.voice === b.voice && a.all8 && b.all8 && b.gi === a.gi + 1 && a.gi % 2 === 0 && a.endTick.eq(b.startTick)) {
          a.items.push(...b.items);
          a.endTick = b.endTick;
          runs.splice(i + 1, 1);
          i--;
        }
      }
    }
    return runs.filter(rn => rn.items.length >= 2);
  }

  /* ---- 마디 렌더 ---- */
  function renderMeasure(score, M, S, beams, sel) {
    let s = "";
    const beamedIds = new Set();
    for (const rn of beams) for (const le of rn.items) beamedIds.add(le.id);

    // 빔 먼저 계산해 각 이벤트의 stem 정보 보관
    const stemInfo = new Map(); // id → {dir, tipY, x}
    for (const rn of beams) s += renderBeamRun(score, S, rn, stemInfo);

    for (const le of M.events) {
      const ev = le.ev;
      const isSel = sel && sel.has(ev.id);
      const cls = `ev${isSel ? " sel" : ""}${ev.hidden ? " hidden-event" : ""}${ev.small ? " small-event" : ""}`;
      const dx = +ev.offsetX || 0, dy = +ev.offsetY || 0;
      const transform = dx || dy ? ` transform="translate(${r2(dx)},${r2(dy)})"` : "";
      const color = safeColor(ev.color);
      const style = color ? ` style="color:${color}"` : "";
      let body = "";
      if (ev.type === "rest") body = renderRest(score, S, M, le);
      else body = renderNote(score, le.staff, le, beamedIds.has(le.id), stemInfo.get(le.id), sel);
      for (const lyr of C.lyricsOf(ev)) {
        body += `<text class="lyric" x="${r2(le.x)}" y="${S.laneY.lyric[lyr.verse] ?? S.yTop + S.lyricOff}" text-anchor="middle">${esc(lyr.text)}</text>`;
      }
      if (ev.dynamic) body += renderDynamic(ev.dynamic, le.x, S.laneY.dyn);
      body += renderEventText(ev, le, S);
      body += renderAdvancedNotation(score, M, le.staff, le);
      body += renderOrnament(score, M, le);
      // 히트 영역
      const hitX = le.x - 16, hitW = 32;
      // The event hit rectangle goes behind noteheads so data-note remains clickable.
      body = `<rect class="hit" x="${r2(hitX)}" y="${S.yTop - 62}" width="${hitW}" height="${STAFF_H + 100}" fill="transparent"/>` + body;
      s += `<g class="${cls}" data-ref="${esc(ev.id)}" data-page="${le.page}"${transform}${style}>${body}</g>`;
    }
    s += renderLyricSpans(M, S);
    s += renderTuplets(score, M, S);
    return s;
  }

  function renderOrnament(score, M, le) {
    const names = { trill: "ornamentTrill", mordent: "ornamentMordent", invMordent: "ornamentShortTrill", turn: "ornamentTurn", invTurn: "ornamentTurnInverted" };
    const name = names[le.ev.ornament];
    if (!name) return "";
    const y = le.staff.laneY.ornament;
    let s = glyph(name, le.x, y, { cls: "ornament", anchor: "middle" });
    if (le.ev.ornament === "trill" && le.ev.trillLine) {
      const next = M.events.find(other => other.voice === le.voice && other.x > le.x);
      const end = (next?.x ?? M.x1) - 9;
      let d = `M ${r2(le.x + 15)} ${r2(y)}`;
      for (let x = le.x + 15; x + 8 <= end; x += 8) d += " q 2 -4 4 0 q 2 4 4 0";
      s += `<path class="trill-line" d="${d}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    }
    return s;
  }

  function renderAdvancedNotation(score, M, S, le) {
    const ev = le.ev;
    if (ev.type !== "note") return "";
    let s = "";
    if (ev.tremolo) {
      const y = S.staffType === "tab" ? S.yTop + 2 * SP : Math.min(...ev.notes.map(n => yForStep(S, score, C.absStep(n)))) - 9;
      const strokes = Math.max(1, Math.min(3, ev.tremolo.strokes || 2));
      for (let i = 0; i < strokes; i++) {
        const yy = y + i * 5;
        s += `<line class="tremolo-mark" x1="${r2(le.x - 8)}" y1="${r2(yy)}" x2="${r2(le.x + 8)}" y2="${r2(yy - 5)}"/>`;
      }
    }
    if (ev.arpeggiate) {
      const top = S.yTop - 4, bottom = S.yTop + STAFF_H + 4;
      const x = le.x - 17;
      s += `<path class="arpeggio-mark" d="M ${r2(x)} ${r2(top)} C ${r2(x - 5)} ${r2(top + 6)}, ${r2(x + 5)} ${r2(top + 10)}, ${r2(x)} ${r2(top + 16)} C ${r2(x - 5)} ${r2(top + 22)}, ${r2(x + 5)} ${r2(top + 26)}, ${r2(x)} ${r2(Math.min(bottom, top + 34))}"/>`;
    }
    if (ev.glissando) {
      const idx = M.events.indexOf(le);
      const nx = M.events.slice(idx + 1).find(c => c.staff.globalIdx === le.staff.globalIdx && c.ev.type === "note");
      if (nx) {
        const y1 = ev.drumId ? drumY(S, ev) : S.staffType === "tab" ? tabY(S, ev.tab) : yForStep(S, score, C.absStep(ev.notes[0]));
        const y2 = nx.ev.drumId ? drumY(S, nx.ev) : S.staffType === "tab" ? tabY(S, nx.ev.tab) : yForStep(S, score, C.absStep(nx.ev.notes[0]));
        s += `<line class="glissando-mark" x1="${r2(le.x + 12)}" y1="${r2(y1)}" x2="${r2(nx.x - 12)}" y2="${r2(y2)}"/>`;
      }
    }
    return s;
  }

  function renderLyricSpans(M, S) {
    let s = "";
    const nextLyric = (idx, verse) => {
      for (let j = idx + 1; j < M.events.length; j++) {
        const lyr = C.lyricsOf(M.events[j].ev).find(l => l.verse === verse);
        if (lyr) return { le: M.events[j], lyric: lyr };
      }
      return null;
    };
    M.events.forEach((le, idx) => {
      for (const lyr of C.lyricsOf(le.ev)) {
        const nx = nextLyric(idx, lyr.verse);
        if (!nx) continue;
        const y = S.laneY.lyric[lyr.verse] ?? S.yTop + S.lyricOff;
        const x1 = le.x + 12, x2 = nx.le.x - 12;
        if (x2 <= x1) continue;
        if (lyr.syllabic === "begin" || lyr.syllabic === "middle") {
          s += `<text class="lyric-hyphen" x="${r2((x1 + x2) / 2)}" y="${r2(y)}" text-anchor="middle">-</text>`;
        }
        if (lyr.extend) {
          s += `<line class="lyric-extend" x1="${r2(x1)}" y1="${r2(y + 4)}" x2="${r2(x2)}" y2="${r2(y + 4)}"/>`;
        }
      }
    });
    return s;
  }

  function renderEventText(ev, le, S) {
    let s = "";
    if (ev.rehearsal) {
      const text = esc(ev.rehearsal);
      const w = Math.max(22, Array.from(ev.rehearsal).length * 9 + 13), x = ev.tempo ? (le.sys.measures.find(m => m.idx === le.mIdx)?.x0 ?? le.x) + 4 : le.x - w / 2, y = S.laneY.rehearsal - 15;
      s += `<g class="rehearsal-mark"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="20" rx="3"/><text x="${r2(x + w / 2)}" y="${r2(y + 15)}" text-anchor="middle">${text}</text></g>`;
    }
    if (ev.tempo) {
      s += `<text class="tempo-mark" x="${r2(le.x + (ev.rehearsal ? 8 : 0))}" y="${r2(S.laneY.tempo)}" text-anchor="middle">♩ = ${esc(String(ev.tempo))}</text>`;
    }
    if (ev.staffText) {
      const y = S.laneY.text;
      s += `<text class="staff-text" x="${r2(le.x)}" y="${r2(y)}" text-anchor="middle">${esc(ev.staffText)}</text>`;
    }
    if (ev.chordSymbol) {
      const y = S.laneY.chord;
      s += `<text class="chord-symbol" x="${r2(le.x)}" y="${r2(y)}" text-anchor="middle">${esc(C.displayChordSymbol(ev.chordSymbol))}</text>`;
    }
    if (ev.fretboard) s += renderFretboard(ev.fretboard, le.x, S.laneY.fretboard);
    return s;
  }

  function renderFretboard(fb, x, y) {
    const strings = fb.strings || 6;
    const frets = fb.frets || 4;
    const w = 34, h = 42;
    const sx = w / (strings - 1);
    const fy = h / frets;
    const left = x - w / 2;
    let s = `<g class="fretboard" transform="translate(${r2(left)},${r2(y)})">`;
    for (let i = 0; i < strings; i++) s += `<line x1="${r2(i * sx)}" y1="8" x2="${r2(i * sx)}" y2="${r2(h)}"/>`;
    for (let f = 0; f <= frets; f++) s += `<line x1="0" y1="${r2(8 + f * fy)}" x2="${r2(w)}" y2="${r2(8 + f * fy)}" class="${f === 0 && (fb.firstFret || 1) === 1 ? "nut" : ""}"/>`;
    const pos = fb.positions || [];
    for (let i = 0; i < strings; i++) {
      const val = pos[i];
      const px = i * sx;
      if (val === "x") s += `<text x="${r2(px)}" y="5" text-anchor="middle">x</text>`;
      else if (val === 0) s += `<text x="${r2(px)}" y="5" text-anchor="middle">o</text>`;
      else if (typeof val === "number") {
        const fret = Math.max(1, val - (fb.firstFret || 1) + 1);
        s += `<circle cx="${r2(px)}" cy="${r2(8 + (fret - 0.5) * fy)}" r="3.2"/>`;
      }
    }
    if ((fb.firstFret || 1) > 1) s += `<text class="fret-num" x="${r2(w + 4)}" y="${r2(8 + fy)}">${fb.firstFret}</text>`;
    return s + `</g>`;
  }

  function renderTuplets(score, M, S) {
    let s = "";
    const groups = new Map();
    M.events.forEach((le, idx) => {
      const tp = le.ev.dur.tuplet;
      if (!tp) return;
      const g = groups.get(tp.id) || { actual: tp.actual, items: [], firstIdx: idx, lastIdx: idx };
      g.items.push(le); g.lastIdx = idx; groups.set(tp.id, g);
    });
    for (const g of groups.values()) {
      if (g.items.length < 2) continue;
      const first = g.items[0], last = g.items[g.items.length - 1];
      const x1 = first.x - 12, x2 = last.x + 12;
      let y = S.laneY.tuplet;
      for (const le of g.items) {
        if (le.ev.type === "note") {
          const top = Math.min(...le.ev.notes.map(n => yForStep(le.staff, score, C.absStep(n))));
          y = Math.min(y, top - 42 - (le.ev.artics?.length || 0) * 10);
        }
      }
      const mid = (x1 + x2) / 2;
      s += `<g class="tuplet">` +
        `<path d="M ${r2(x1)} ${r2(y + 7)} L ${r2(x1)} ${r2(y)} L ${r2(mid - 8)} ${r2(y)} M ${r2(mid + 8)} ${r2(y)} L ${r2(x2)} ${r2(y)} L ${r2(x2)} ${r2(y + 7)}"/>` +
        `<text x="${r2(mid)}" y="${r2(y + 4)}" text-anchor="middle">${g.actual}</text>` +
        `</g>`;
    }
    return s;
  }

  /* ---- 셈여림 ---- */
  const DYN_GLYPH = { pp: "dynPP", p: "dynP", mp: "dynMP", mf: "dynMF", f: "dynF", ff: "dynFF" };
  function renderDynamic(mark, x, y) {
    if (fontReady && DYN_GLYPH[mark]) {
      return glyph(DYN_GLYPH[mark], x, y, { anchor: "middle", cls: "dyn" });
    }
    return `<text class="dyn dyn-fb" x="${r2(x)}" y="${r2(y)}" text-anchor="middle">${esc(mark)}</text>`;
  }

  function stemDirFor(score, notes) {
    const mid = C.absStep(clefInfo(score.clef).middle);
    const avg = notes.reduce((a, n) => a + C.absStep(n), 0) / notes.length;
    return avg < mid ? "up" : "down";
  }
  function stemDirForStaff(score, notes, S) {
    const clef = S.clef || score.clef;
    const mid = C.absStep(clefInfo(clef).middle) + (S.ottavaSteps || 0);
    const avg = notes.reduce((a, n) => a + C.absStep(n), 0) / notes.length;
    return avg < mid ? "up" : "down";
  }
  function stemDirForVoice(score, notes, S, voice) {
    voice = C.normalizeVoice(voice || 1);
    if (voice === 1 || voice === 3) return "up";
    if (voice === 2 || voice === 4) return "down";
    return stemDirForStaff(score, notes, S);
  }
  function drumY(S, ev) {
    const spec = C.drumSpec(ev.drumId);
    const line = ev.staffLine ?? spec.staffLine ?? 4;
    return S.yTop + STAFF_H - line * (SP / 2);
  }
  function tabY(S, tab) {
    const stringNo = Math.max(1, Math.min(6, tab?.string || 1));
    return S.yTop + (stringNo - 1) * SP;
  }
  function drumHeadShape(x, y, notehead) {
    if (notehead === "x" || notehead === "circle-x") {
      const circle = notehead === "circle-x" ? `<circle cx="${r2(x)}" cy="${r2(y)}" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/>` : "";
      return `<g class="drum-head">${circle}<path d="M ${r2(x - 5.5)} ${r2(y - 4.5)} L ${r2(x + 5.5)} ${r2(y + 4.5)} M ${r2(x + 5.5)} ${r2(y - 4.5)} L ${r2(x - 5.5)} ${r2(y + 4.5)}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>`;
    }
    if (notehead === "diamond") {
      return `<path class="drum-head" d="M ${r2(x)} ${r2(y - 6)} L ${r2(x + 6)} ${r2(y)} L ${r2(x)} ${r2(y + 6)} L ${r2(x - 6)} ${r2(y)} Z" fill="currentColor"/>`;
    }
    return headShape(x, y, "black");
  }
  function noteHeadShape(x, y, kind, notehead) {
    if (notehead === "x") {
      return `<path class="custom-head" d="M ${r2(x - 5.5)} ${r2(y - 4.5)} L ${r2(x + 5.5)} ${r2(y + 4.5)} M ${r2(x + 5.5)} ${r2(y - 4.5)} L ${r2(x - 5.5)} ${r2(y + 4.5)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    if (notehead === "diamond") {
      return `<path class="custom-head" d="M ${r2(x)} ${r2(y - 6)} L ${r2(x + 6)} ${r2(y)} L ${r2(x)} ${r2(y + 6)} L ${r2(x - 6)} ${r2(y)} Z" fill="currentColor"/>`;
    }
    return headShape(x, y, kind);
  }

  function renderNote(score, S, le, beamed, stem, sel) {
    const ev = le.ev;
    if (S.staffType === "tab") return renderTabNote(score, S, le, beamed, stem, sel);
    if (ev.drumId) return renderDrumNote(score, S, le, beamed, stem, sel);
    let s = renderGraceBefore(score, S, le);
    const kind = headKind(ev.dur);
    const manualStem = ev.stemDirection && ev.stemDirection !== "auto" ? ev.stemDirection : null;
    const dir = stem ? stem.dir : (manualStem || stemDirForVoice(score, ev.notes, S, le.voice || ev.voice || 1));
    const sorted = ev.notes.slice().sort((a, b) => C.absStep(a) - C.absStep(b)); // 낮은 음부터
    const headScale = S.style?.noteheadScale || 1;
    const stemX = stem?.x ?? le.x + (dir === "up" ? 4.8 : -4.8) * headScale;

    // 2도 간격 음 좌우 비껴 배치
    const offs = new Map();
    let prevAs = null, flip = false;
    for (const n of (dir === "up" ? sorted : sorted.slice().reverse())) {
      const as = C.absStep(n);
      if (prevAs !== null && Math.abs(as - prevAs) === 1 && !flip) flip = true;
      else flip = false;
      offs.set(n, flip ? (dir === "up" ? 9.6 : -9.6) * headScale : 0);
      prevAs = as;
    }

    // 덧줄
    const bottom = bottomFor(S, score);
    let minOff = Infinity, maxOff = -Infinity;
    for (const n of sorted) {
      const off = C.absStep(n) - bottom; // 보표 스텝 오프셋(0=맨아래줄, 8=맨위줄)
      minOff = Math.min(minOff, off); maxOff = Math.max(maxOff, off);
    }
    const lw = (S.style?.ledgerLength || STYLE.ledgerLength) / 2 + (ev.dur.d === 1 ? 3 : 0);
    for (let k = -2; k >= (minOff % 2 === 0 ? minOff : minOff + 1); k -= 2)
      s += `<line class="ledger" x1="${r2(le.x - lw)}" y1="${r2(yForStep(S, score, bottom + k))}" x2="${r2(le.x + lw)}" y2="${r2(yForStep(S, score, bottom + k))}"/>`;
    for (let k = 10; k <= (maxOff % 2 === 0 ? maxOff : maxOff - 1); k += 2)
      s += `<line class="ledger" x1="${r2(le.x - lw)}" y1="${r2(yForStep(S, score, bottom + k))}" x2="${r2(le.x + lw)}" y2="${r2(yForStep(S, score, bottom + k))}"/>`;

    // 임시표
    const accX = le.x - 10 - 6.5 * headScale + Math.min(0, ...offs.values());
    const acc = accidentalColumns.get(ev) || staggerAccidentals(ev);
    for (const n of sorted.slice().reverse()) {
      if (n.__acc) {
        s += glyph(n.__acc, accX - (acc.offsets.get(n) || 0) * 11, yForStep(S, score, C.absStep(n)), { cls: "accidental" });
      }
    }

    // 음표머리 + 점
    for (const n of sorted) {
      const y = yForStep(S, score, C.absStep(n));
      const ox = offs.get(n) || 0;
      const ni = ev.notes.indexOf(n), headX = le.x + ox, scale = S.style?.noteheadScale || 1;
      le.noteheads.push({ index: ni, x: headX, y, width: (ev.dur.d === 1 ? 24 : 12) * scale, height: 10 * scale });
      const head = noteHeadShape(headX, y, kind, ev.notehead);
      s += `<g class="nh${sel?.has(`${ev.id}#${ni}`) ? " sel-note" : ""}" data-note="${ni}">${scale === 1 ? head : `<g transform="translate(${headX},${y}) scale(${scale}) translate(${-headX},${-y})">${head}</g>`}</g>`;
      if (ev.dur.dots) {
        const off = C.absStep(n) - bottom;
        const dotY = off % 2 === 0 ? y - SP / 2 : y; // 줄 위 음표는 점을 위 칸으로
        for (let d = 0; d < ev.dur.dots; d++)
          s += `<circle class="dot" cx="${r2(le.x + 9.5 * headScale + ox + d * 6 + (ev.dur.d === 1 ? 4 : 0))}" cy="${r2(dotY)}" r="2.1" fill="currentColor"/>`;
      }
    }

    // 스템 + 기(flag)
    let tipOut = null;
    if (kind !== "whole" && kind !== "breve") {
      const lowY = yForStep(S, score, C.absStep(sorted[0]));
      const highY = yForStep(S, score, C.absStep(sorted[sorted.length - 1]));
      let tipY;
      if (stem) {
        tipY = stem.tipY;
      } else {
        const baseY = dir === "up" ? highY : lowY;
        tipY = dir === "up" ? baseY - 3.5 * SP : baseY + 3.5 * SP;
        // 보표 밖 멀리 있는 음은 중앙줄까지 연장
        const midY = S.middleY;
        if (dir === "up" && tipY > midY && baseY > midY + 3 * SP) tipY = midY;
        if (dir === "down" && tipY < midY && baseY < midY - 3 * SP) tipY = midY;
        if (ev.dur.d >= 16) tipY += (dir === "up" ? -4 : 4) * Math.log2(ev.dur.d / 8);
      }
      tipOut = tipY;
      const fromY = dir === "up" ? lowY : highY;
      s += `<line class="stem" x1="${r2(stemX)}" y1="${r2(fromY + (dir === "up" ? -1 : 1))}" x2="${r2(stemX)}" y2="${r2(tipY)}"/>`;
      if (!beamed && ev.dur.d >= 8) {
        const fname = flagName(ev.dur, dir);
        s += glyph(fname, stemX, tipY);
      }
    }

    // 아티큘레이션: 머리 쪽(스템 반대편), 줄 위면 칸으로, 여러 개면 세로로 쌓기
    const artics = ev.artics || [];
    if (artics.length) {
      const ART_ORDER = ["staccato", "tenuto", "accent", "marcato"];
      const list = ART_ORDER.filter(a => artics.includes(a));
      const above = dir === "down"; // 스템 반대쪽
      const sgnA = above ? 1 : -1;  // step 오프셋 좌표(위=+)
      const headExt = above ? sorted[sorted.length - 1] : sorted[0];
      let off = (C.absStep(headExt) - bottom) + sgnA * 2;
      for (const a of list) {
        if (off >= 0 && off <= 8 && off % 2 === 0) off += sgnA; // 보표 줄과 겹치면 칸으로
        const ay = yForStep(S, score, bottom + off);
        s += glyph(a + (above ? "Above" : "Below"), le.x, ay, { anchor: "middle", cls: "artic" });
        off += sgnA * 2;
      }
      if (artics.includes("fermata")) {
        let topY = yForStep(S, score, C.absStep(sorted[sorted.length - 1])) - 6;
        if (tipOut !== null && dir === "up") topY = Math.min(topY, tipOut - 3);
        if (above && list.length) topY = Math.min(topY, yForStep(S, score, bottom + 8) - list.length * SP - 8);
        const fy = Math.min(S.yTop - 7, topY - 6);
        s += glyph("fermata", le.x, fy, { anchor: "middle", cls: "artic" });
      }
    }
    return s;
  }

  function renderTabNote(score, S, le, beamed, stem, sel) {
    const ev = le.ev;
    if (ev.type === "rest") return renderRest(score, S, null, le);
    const tab = ev.tab || (ev.notes && ev.notes[0] ? C.midiToStringFret(C.midiOf(ev.notes[0]), le.staff.part?.tuning || C.GUITAR_STANDARD_TUNING) : null) || { string: 1, fret: 0 };
    const y = tabY(S, tab);
    const text = tab.fret === "x" ? "x" : String(tab.fret);
    const w = Math.max(12, text.length * 7 + 5);
    le.noteheads.push({ index: 0, x: le.x, y, width: w, height: 14 });
    let s = `<g class="nh${sel?.has(`${ev.id}#0`) ? " sel-note" : ""}" data-note="0"><rect class="tab-fret-bg" x="${r2(le.x - w / 2)}" y="${r2(y - 7)}" width="${r2(w)}" height="13" rx="2"/>` +
      `<text class="tab-fret" x="${r2(le.x)}" y="${r2(y + 4)}" text-anchor="middle">${esc(text)}</text></g>`;
    for (let d = 0; d < (ev.dur.dots || 0); d++) s += `<circle class="dot" cx="${r2(le.x + w / 2 + 4 + d * 6)}" cy="${r2(y - 4)}" r="2.1"/>`;
    if (ev.dur.d !== 1) {
      const dir = stem ? stem.dir : "up";
      const stemX = stem?.x ?? le.x + 7;
      const tipY = stem ? stem.tipY : y - 3 * SP - Math.max(0, Math.log2(ev.dur.d / 8)) * 4;
      s += `<line class="stem tab-stem" x1="${r2(stemX)}" y1="${r2(y)}" x2="${r2(stemX)}" y2="${r2(tipY)}"/>`;
      if (!beamed && ev.dur.d >= 8) s += glyph(flagName(ev.dur, dir), stemX, tipY);
    }
    return s;
  }

  function renderDrumNote(score, S, le, beamed, stem, sel) {
    const ev = le.ev;
    const y = drumY(S, ev);
    const manualStem = ev.stemDirection && ev.stemDirection !== "auto" ? ev.stemDirection : null;
    const dir = stem ? stem.dir : (manualStem || stemDirForVoice(score, ev.notes && ev.notes.length ? ev.notes : [C.spellMidi(ev.midi || C.drumSpec(ev.drumId).midi, 0)], S, le.voice || ev.voice || 1));
    const stemX = dir === "up" ? le.x + 4.8 : le.x - 4.8;
    le.noteheads.push({ index: 0, x: le.x, y, width: 12, height: 10 });
    let s = `<g class="nh${sel?.has(`${ev.id}#0`) ? " sel-note" : ""}" data-note="0">${drumHeadShape(le.x, y, ev.notehead || C.drumSpec(ev.drumId).notehead)}</g>`;
    if (ev.dur.dots) {
      for (let d = 0; d < ev.dur.dots; d++) s += `<circle class="dot" cx="${r2(le.x + 10 + d * 6)}" cy="${r2(y - SP / 2)}" r="2.1" fill="currentColor"/>`;
    }
    if (ev.dur.d !== 1) {
      const tipY = stem ? stem.tipY : y + (dir === "up" ? -1 : 1) * (3.5 * SP + Math.max(0, Math.log2(ev.dur.d / 8)) * 4);
      s += `<line class="stem" x1="${r2(stemX)}" y1="${r2(y + (dir === "up" ? -1 : 1))}" x2="${r2(stemX)}" y2="${r2(tipY)}"/>`;
      if (!beamed && ev.dur.d >= 8) {
        const fname = flagName(ev.dur, dir);
        s += glyph(fname, stemX, tipY);
      }
    }
    return s;
  }

  function renderGraceBefore(score, S, le) {
    const list = le.ev.graceBefore || [];
    if (!list.length) return "";
    let s = `<g class="grace-notes">`;
    list.forEach((g, i) => {
      const x = le.x - (list.length - i) * 15 - 8;
      const notes = (g.notes || []).length ? g.notes : le.ev.notes.slice(0, 1);
      const sorted = notes.slice().sort((a, b) => C.absStep(a) - C.absStep(b));
      const dir = stemDirForStaff(score, sorted, S);
      const ext = dir === "up" ? sorted[sorted.length - 1] : sorted[0];
      const y = yForStep(S, score, C.absStep(ext));
      const stemX = dir === "up" ? x + 3.6 : x - 3.6;
      const tipY = y + (dir === "up" ? -24 : 24);
      for (const n of sorted) {
        s += headShape(x, yForStep(S, score, C.absStep(n)), "black", "grace-head");
      }
      s += `<line class="stem grace-stem" x1="${r2(stemX)}" y1="${r2(y)}" x2="${r2(stemX)}" y2="${r2(tipY)}"/>`;
      if ((g.kind || "acciaccatura") === "acciaccatura") {
        s += `<line class="grace-slash" x1="${r2(stemX - 4)}" y1="${r2((y + tipY) / 2 + 5)}" x2="${r2(stemX + 5)}" y2="${r2((y + tipY) / 2 - 5)}"/>`;
      }
    });
    return s + `</g>`;
  }

  function renderRest(score, S, M, le) {
    const ev = le.ev;
    let s = "";
    const voice = C.normalizeVoice(le.voice || ev.voice || 1);
    const restShift = voice === 2 || voice === 4 ? SP * 1.2 : voice === 3 ? -SP * 1.2 : 0;
    const midY = S.middleY + restShift;
    if (!ev.full && ev.dur.d === 1 && ev.dur.n >= 2) {
      s += glyph("restDoubleWhole", le.x, S.yTop + SP * 2 + restShift);
    } else if (ev.full || ev.dur.d === 1) {
      const y = S.yTop + SP + restShift; // 2번째 줄에 매달림
      s += fontReady ? glyph("restWhole", le.x - 6, y)
        : `<rect x="${r2(le.x - 6.5)}" y="${r2(y)}" width="13" height="5.2" fill="currentColor"/>`;
    } else if (ev.dur.d === 2) {
      const y = midY; // 3번째 줄 위에 얹힘
      s += fontReady ? glyph("restHalf", le.x - 6, y)
        : `<rect x="${r2(le.x - 6.5)}" y="${r2(y - 5.2)}" width="13" height="5.2" fill="currentColor"/>`;
    } else if (ev.dur.d === 4) {
      s += glyph("restQuarter", le.x, midY);
    } else if (ev.dur.d === 8) {
      s += glyph("rest8", le.x, midY);
    } else {
      s += glyph(restName(ev.dur), le.x, midY + (fontReady ? 0 : 5));
    }
    if (ev.dur.dots && !ev.full) {
      for (let d = 0; d < ev.dur.dots; d++)
        s += `<circle cx="${r2(le.x + 10 + d * 6)}" cy="${r2(midY - SP / 2)}" r="2.1" fill="currentColor"/>`;
    }
    return s;
  }

  /* ---- 빔 런 렌더 ---- */
  function renderBeamRun(score, S, rn, stemInfo) {
    const items = rn.items;
    // 방향: 전체 음의 평균
    const all = [];
    for (const le of items) for (const n of le.ev.notes) all.push(n);
    const dir = rn.voice ? stemDirForVoice(score, all, S, rn.voice) : stemDirForStaff(score, all, S);

    const xs = items.map(le => le.x + (dir === "up" ? 1 : -1) * (S.staffType === "tab" ? 7 : le.ev.drumId ? 4.8 : 4.8 * (S.style?.noteheadScale || 1)));
    // 각 이벤트의 극단 머리 y(스템 방향 쪽)
    const headYs = items.map(le => {
      if (S.staffType === "tab") return tabY(S, le.ev.tab);
      if (le.ev.drumId) return drumY(S, le.ev);
      const steps = le.ev.notes.map(C.absStep);
      const ext = dir === "up" ? Math.max(...steps) : Math.min(...steps);
      return yForStep(le.staff, score, ext);
    });
    const sgn = dir === "up" ? -1 : 1;
    const maxLevel = Math.max(...items.map(le => Math.log2(le.ev.dur.d) - 3));
    const beamStemLength = 3.3 * SP + Math.max(0, maxLevel - 1) * 4;
    let y1 = headYs[0] + sgn * beamStemLength;
    let y2 = headYs[headYs.length - 1] + sgn * beamStemLength;
    let dy = y2 - y1;
    if (Math.abs(dy) > SP) dy = Math.sign(dy) * SP; // 기울기 제한
    y2 = y1 + dy;
    const x1 = xs[0], x2 = xs[xs.length - 1];
    const lineY = (x) => y1 + (x2 === x1 ? 0 : (x - x1) / (x2 - x1) * (y2 - y1));

    // 모든 스템 최소 길이 보장
    let shift = 0;
    items.forEach((le, i) => {
      const need = sgn * (lineY(xs[i]) - headYs[i]); // 양수=정상 방향 길이
      const minimum = 2.6 * SP + Math.max(0, maxLevel - 1) * 4;
      if (need < minimum) shift = Math.max(shift, minimum - need);
    });
    y1 += sgn * shift; y2 += sgn * shift;

    let s = `<g class="beam-group">`;
    // 주 빔(8분)
    s += beamPoly(x1, lineY2(x1), x2, lineY2(x2), 0);
    // 16분 보조 빔
    function lineY2(x) { return y1 + (x2 === x1 ? 0 : (x - x1) / (x2 - x1) * (y2 - y1)); }
    for (let level = 1; level <= maxLevel; level++) for (let i = 0; i < items.length; i++) {
      const den = 8 * 2 ** level;
      if (items[i].ev.dur.d < den) continue;
      const next16 = i + 1 < items.length && items[i + 1].ev.dur.d >= den;
      const prev16 = i - 1 >= 0 && items[i - 1].ev.dur.d >= den;
      if (next16) {
        s += beamPoly(xs[i], lineY2(xs[i]), xs[i + 1], lineY2(xs[i + 1]), -sgn * 7.5 * level);
      } else if (!prev16) {
        // 부분 빔(갈고리)
        const toLeft = i > 0;
        const hx = toLeft ? xs[i] - 9 : xs[i] + 9;
        s += beamPoly(Math.min(xs[i], hx), lineY2(Math.min(xs[i], hx)), Math.max(xs[i], hx), lineY2(Math.max(xs[i], hx)), -sgn * 7.5 * level);
      }
    }
    s += "</g>";

    items.forEach((le, i) => {
      stemInfo.set(le.id, { dir, tipY: lineY2(xs[i]), x: xs[i] });
    });
    return s;

    function beamPoly(bx1, by1, bx2, by2, off) {
      const t = (S.style?.beamThickness || 5) * (score.layout?.beamThickness || 1);
      const o = off || 0;
      const top1 = by1 + o, top2 = by2 + o;
      const inner = sgn === -1 ? t : -t; // 빔은 팁에서 안쪽으로
      return `<polygon class="beam" points="${r2(bx1)},${r2(top1)} ${r2(bx2)},${r2(top2)} ${r2(bx2)},${r2(top2 + inner)} ${r2(bx1)},${r2(top1 + inner)}"/>`;
    }
  }

  /* ---- 타이 ---- */
  function renderTies(score, L, pageIndex) {
    let s = "";
    for (const ref of C.staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        for (const entry of C.measureEntries(ref.measures[m], { score, includeSilent: true })) {
          const ev = entry.ev;
          if (ev.type !== "note") continue;
          const tied = ev.notes.filter(n => n.tie);
          if (!tied.length) continue;
          const le1 = L.eventsById.get(ev.id);
          const le2 = L.eventsById.get(L.nextById.get(ev.id));
          if (!le1 || !le2) continue;
          for (const n of tied) {
            const target = le2.ev.notes?.find(nn => nn.step === n.step && nn.oct === n.oct && nn.alter === n.alter);
            if (!target) continue;
            const dir = stemDirForVoice(score, ev.notes, le1.staff, entry.voice); // 타이는 스템 반대쪽
            const curveDown = dir === "up";
            if (le1.sys === le2.sys) {
              if (pageIndex == null || le1.page === pageIndex) s += tiePath(le1.x + 7, le2.x - 7, yForStep(le1.staff, score, C.absStep(n)), curveDown, L.style, yForStep(le2.staff, score, C.absStep(target)));
            } else {
              if (pageIndex == null || le1.page === pageIndex) s += tiePath(le1.x + 7, le1.sys.x1 - 2, yForStep(le1.staff, score, C.absStep(n)), curveDown, L.style);
              if (pageIndex == null || le2.page === pageIndex) s += tiePath(le2.sys.x0 + le2.sys.headerW - 6, le2.x - 7, yForStep(le2.staff, score, C.absStep(target)), curveDown, L.style);
            }
          }
        }
      }
    }
    return s;
  }
  function tiePath(x1, x2, y, down, st = STYLE, endY = y) {
    if (x2 - x1 < 8) { x1 -= 3; x2 += 3; }
    const w = x2 - x1;
    const h = Math.min(11, 5 + w * st.tieHeightFactor) * (down ? 1 : -1);
    const yOff = (down ? 6 : -6);
    const y0 = y + yOff;
    const yEnd = endY + yOff;
    return `<path class="tie" d="M ${r2(x1)} ${r2(y0)} C ${r2(x1 + w * 0.3)} ${r2(y0 + h)}, ${r2(x2 - w * 0.3)} ${r2(yEnd + h)}, ${r2(x2)} ${r2(yEnd)} ` +
      `C ${r2(x2 - w * 0.3)} ${r2(yEnd + h + (down ? 1.7 : -1.7))}, ${r2(x1 + w * 0.3)} ${r2(y0 + h + (down ? 1.7 : -1.7))}, ${r2(x1)} ${r2(y0)} Z"/>`;
  }

  /* ---- 스패너(슬러/헤어핀): 시스템 경계 분할 공통 처리 ---- */
  function spannerSegments(le1, le2, L) {
    const staffIn = (S, le) => S.staffLayouts.find(st => st.globalIdx === le.globalIdx) || S.staffLayouts[0];
    if (le1.sys === le2.sys) return [{ S: le1.sys, staff: le1.staff, x1: le1.x, x2: le2.x, openL: false, openR: false }];
    const list = L.systems;
    const i1 = list.indexOf(le1.sys), i2 = list.indexOf(le2.sys);
    if (i1 < 0 || i2 < 0 || i2 < i1) return [];
    const segs = [{ S: le1.sys, staff: le1.staff, x1: le1.x, x2: le1.sys.x1 - 3, openL: false, openR: true }];
    for (let i = i1 + 1; i < i2; i++)
      segs.push({ S: list[i], staff: staffIn(list[i], le1), x1: list[i].x0 + list[i].headerW, x2: list[i].x1 - 3, openL: true, openR: true });
    segs.push({ S: le2.sys, staff: le2.staff, x1: le2.sys.x0 + le2.sys.headerW - 2, x2: le2.x, openL: true, openR: false });
    return segs;
  }

  function renderSpanners(score, L, sel, pageIndex) {
    let s = "";
    for (const sp of score.spanners || []) {
      const le1 = L.eventsById.get(sp.startId), le2 = L.eventsById.get(sp.endId);
      if (!le1 || !le2) continue;
      if (sp.type === "slur") s += renderSlur(score, L, le1, le2, pageIndex);
      else if (sp.type === "cresc" || sp.type === "dim") s += renderHairpin(score, L, le1, le2, sp.type, pageIndex);
      else if (sp.type === "ottava") s += renderOttava(L, le1, le2, sp, pageIndex);
    }
    return s;
  }

  /* 슬러: 스템 반대쪽(혼합이면 위), 3차 베지어 + 사이 음표 회피 */
  function renderSlur(score, L, le1, le2, pageIndex) {
    const d1 = stemDirForVoice(score, le1.ev.notes, le1.staff, le1.voice), d2 = stemDirForVoice(score, le2.ev.notes, le2.staff, le2.voice);
    const polyphonic = le1.sys.measures.some(m => m.events.some(le => le.globalIdx === le1.globalIdx && le.voice !== le1.voice && le.ev.type === "note"));
    const above = polyphonic ? d1 === "up" : !(d1 === "up" && d2 === "up");
    const segs = spannerSegments(le1, le2, L);
    let s = "";
    for (const seg of segs) {
      if (pageIndex != null && seg.S.page !== pageIndex) continue;
      const edgeY = seg.staff.yTop + (above ? -7 : STAFF_H + 7);
      const y1 = seg.openL ? edgeY : slurAnchorY(score, seg.staff, le1, above);
      const y2 = seg.openR ? edgeY : slurAnchorY(score, seg.staff, le2, above);
      s += slurPath(seg.x1, y1, seg.x2, y2, above, slurClearance(score, seg, above, y1, y2), L.style);
    }
    return s;
  }
  function slurAnchorY(score, S, le, above) {
    const steps = le.ev.notes.map(C.absStep);
    const ext = above ? Math.max(...steps) : Math.min(...steps);
    return yForStep(le.staff, score, ext) + (above ? -7 : 7);
  }
  function slurClearance(score, seg, above, y1, y2) {
    const w = Math.max(10, seg.x2 - seg.x1);
    let h = Math.min(24, 7 + w * 0.09);
    for (const M of seg.S.measures) {
      for (const le of M.events) {
        if (le.globalIdx !== seg.staff.globalIdx) continue;
        if (le.x <= seg.x1 + 3 || le.x >= seg.x2 - 3 || le.ev.type !== "note") continue;
        const steps = le.ev.notes.map(C.absStep);
        const ext = above ? Math.max(...steps) : Math.min(...steps);
        let headY = yForStep(le.staff, score, ext);
        const sd = stemDirForVoice(score, le.ev.notes, le.staff || seg.staff, le.voice);
        if (above && sd === "up") headY -= 3.2 * SP;       // 스템 끝까지 회피
        if (!above && sd === "down") headY += 3.2 * SP;
        headY += (above ? -1 : 1) * (le.ev.artics?.length || 0) * SP;
        if (above && le.ev.dur.tuplet) headY = Math.min(headY, le.staff.laneY.tuplet - 8);
        const t = Math.max(0.15, Math.min(0.85, (le.x - seg.x1) / w));
        const lineY = y1 + (y2 - y1) * ((le.x - seg.x1) / w);
        const need = above ? (lineY - (headY - 5)) : ((headY + 5) - lineY);
        if (need > 0) {
          const bulge = 0.75 * (4 * t * (1 - t)); // 베지어 근사 부풀음 비율
          h = Math.max(h, (need + 5) / Math.max(0.35, bulge));
        }
      }
    }
    return Math.min(h, 96);
  }
  function slurPath(x1, y1, x2, y2, above, h, st = STYLE) {
    const w = Math.max(8, x2 - x1);
    const sgn = above ? -1 : 1;
    const c1x = x1 + w * 0.28, c2x = x2 - w * 0.28;
    const c1y = y1 + sgn * h, c2y = y2 + sgn * h;
    const th = st.slurThickness * sgn;
    return `<path class="slur" d="M ${r2(x1)} ${r2(y1)} C ${r2(c1x)} ${r2(c1y)}, ${r2(c2x)} ${r2(c2y)}, ${r2(x2)} ${r2(y2)} ` +
      `C ${r2(c2x)} ${r2(c2y + th)}, ${r2(c1x)} ${r2(c1y + th)}, ${r2(x1)} ${r2(y1)} Z"/>`;
  }

  /* 헤어핀(crescendo/diminuendo 쐐기) */
  function renderHairpin(score, L, le1, le2, type, pageIndex) {
    const segs = spannerSegments(le1, le2, L);
    if (!segs.length) return "";
    segs[0].x1 += le1.ev.dynamic ? Math.max(12, le1.ev.dynamic.length * 5 + 8) : -6;
    segs[segs.length - 1].x2 += le2.ev.dynamic ? -Math.max(12, le2.ev.dynamic.length * 5 + 8) : 9;
    const total = segs.reduce((a, g) => a + Math.max(1, g.x2 - g.x1), 0);
    let cum = 0, s = "";
    const H = 5.5;
    for (const seg of segs) {
      const w = Math.max(1, seg.x2 - seg.x1);
      const f1 = cum / total, f2 = (cum + w) / total;
      cum += w;
      if (pageIndex != null && seg.S.page !== pageIndex) continue;
      if (seg.x2 <= seg.x1) continue;
      const y = seg.staff.laneY.dyn - 4;
      const h1 = (type === "cresc" ? f1 : 1 - f1) * H;
      const h2 = (type === "cresc" ? f2 : 1 - f2) * H;
      s += `<g class="hairpin">` +
        `<line x1="${r2(seg.x1)}" y1="${r2(y - h1)}" x2="${r2(seg.x2)}" y2="${r2(y - h2)}"/>` +
        `<line x1="${r2(seg.x1)}" y1="${r2(y + h1)}" x2="${r2(seg.x2)}" y2="${r2(y + h2)}"/>` +
        `</g>`;
    }
    return s;
  }

  function renderOttava(L, le1, le2, sp, pageIndex) {
    let s = "";
    for (const seg of spannerSegments(le1, le2, L)) {
      if (pageIndex != null && seg.S.page !== pageIndex) continue;
      const below = sp.shift < 0, y = below ? seg.staff.laneY.ottavaBelow : seg.staff.laneY.ottava;
      const label = below ? "8vb" : "8va";
      const x2 = Math.max(seg.x1 + 38, seg.x2 + (seg.openR ? 0 : 10));
      s += `<g class="ottava" data-spanner="${esc(sp.id || "")}"><text x="${r2(seg.x1)}" y="${r2(y)}" font-family="Georgia,serif" font-style="italic" font-size="14">${seg.openL ? `(${label})` : label}</text><line x1="${r2(seg.x1 + (seg.openL ? 33 : 26))}" y1="${r2(y - 4)}" x2="${r2(x2)}" y2="${r2(y - 4)}" stroke-dasharray="5 4"/>`;
      if (!seg.openR) s += `<line x1="${r2(x2)}" y1="${r2(y - 4)}" x2="${r2(x2)}" y2="${r2(y + (below ? -12 : 4))}"/>`;
      s += "</g>";
    }
    return s;
  }

  /* ---------------- 히트 테스트 ---------------- */
  // Legacy hitTest(x, globalY); page form hitTest(pageIndex, x, pageY).
  function hitTest(x, y, pageY) {
    const L = lastLayout;
    if (!L) return null;
    let pageIndex = null;
    if (pageY != null) { pageIndex = x; x = y; y = pageY + (L.pages[pageIndex]?.offsetY || 0); }
    // 가장 가까운 보표
    let S = null, ST = null, best = Infinity;
    for (const sys of L.systems) {
      if (pageIndex != null && sys.page !== pageIndex) continue;
      for (const st of sys.staffLayouts) {
        const cy = st.yTop + STAFF_H / 2;
        const d = Math.abs(y - cy);
        if (d < best) { best = d; S = sys; ST = st; }
      }
    }
    if (!S || !ST || best > 76) return null;
    // 마디
    let M = null;
    for (const mm of S.measures) if (x >= mm.x0 && x <= mm.x1) M = mm;
    if (!M) {
      if (x < S.x0 + S.headerW && S.measures.length) M = S.measures[0];
      else return null;
    }
    const SM = M.staffMeasures.find(sm => sm.staff.globalIdx === ST.globalIdx) || M.staffMeasures[0];
    // 가장 가까운 이벤트(세그먼트)
    let le = null, dx = Infinity;
    for (const cand of SM.events) {
      const d = Math.abs(x - cand.x);
      if (d < dx) { dx = d; le = cand; }
    }
    ST = le?.staff || SM.staff;
    let noteIdx = null, bestNote = Infinity;
    for (const cand of SM.events) for (const head of cand.noteheads || []) {
      const dx = x - head.x - (+cand.ev.offsetX || 0), dy = y - head.y - (+cand.ev.offsetY || 0);
      if (Math.abs(dx) <= head.width / 2 + 3 && Math.abs(dy) <= head.height / 2 + 3 && dx * dx + dy * dy < bestNote) { noteIdx = head.index; le = cand; bestNote = dx * dx + dy * dy; }
    }
    ST = le?.staff || ST;
    const step = stepForY(ST, L.score, y);
    return { sys: S, staff: ST, M, staffMeasure: SM, le, step, x, y, noteIdx, page: S.page,
      collapsed: !!M.collapsed, measureIndex: M.idx, measureSpan: M.span || 1 };
  }

  function pageToGlobal(page, x, y, L = lastLayout) { return { x, y: y + (L?.pages[page]?.offsetY || 0), page }; }
  function globalToPage(page, x, y, L = lastLayout) { return { x, y: y - (L?.pages[page]?.offsetY || 0), page }; }
  function positionForMeasure(mIdx, progress = 0, globalIdx, L = lastLayout) {
    const M = L?.measuresByIndex.get(mIdx);
    if (!M) return null;
    const SM = M.staffMeasures.find(sm => sm.staff.globalIdx === globalIdx) || M.staffMeasures[0];
    const staff = SM.staff;
    const fraction = (mIdx - M.idx + Math.max(0, Math.min(1, progress))) / (M.span || 1);
    return { x: M.x0 + M.prefixW + (M.x1 - M.x0 - M.prefixW) * fraction,
      yTop: staff.yTop, yBottom: staff.yTop + (staff.staffType === "tab" ? 5 * SP : STAFF_H),
      page: M.page, sys: staff.sys, staff, M, collapsed: !!M.collapsed };
  }
  // Overlays live inside each translated page-content group: write global coordinates.
  function overlayFor(name, page) {
    if (typeof document === "undefined") return null;
    if (lastLayout?.pageMode !== "pages") return document.getElementById(`overlay-${name}`);
    const groups = document.querySelectorAll?.(`svg.page .overlay-${name}`) || [];
    let target = null;
    for (const g of groups) { g.innerHTML = ""; if (+g.getAttribute("data-page") === page) target = g; }
    return target;
  }

  /* ---------------- 오버레이(고스트/입력 커서) ---------------- */
  function drawGhost(hit, dur, isRest) {
    const g = overlayFor("ghost", hit?.le?.page);
    if (!g) return;
    if (!hit || !hit.le) { g.innerHTML = ""; return; }
    const { staff: S, le } = hit;
    const score = lastLayout.score;
    const bottom = bottomFor(S, score);
    const as = Math.max(bottom - 11, Math.min(bottom + 19, hit.step));
    const y = yForStep(S, score, as);
    let s = "";
    if (isRest) {
      s += `<g class="ghost">${glyph(restName(dur), le.x, S.middleY)}</g>`;
    } else {
      const kind = headKind(dur);
      let inner = headShape(le.x, y, kind);
      if (kind !== "whole" && kind !== "breve") {
        const dir = as < bottom + 4 ? "up" : "down";
        const sx = dir === "up" ? le.x + 4.8 : le.x - 4.8;
        const tip = y + (dir === "up" ? -1 : 1) * (35 + Math.max(0, Math.log2(dur.d / 8)) * 4);
        inner += `<line class="stem" x1="${r2(sx)}" y1="${r2(y)}" x2="${r2(sx)}" y2="${r2(tip)}"/>`;
        if (dur.d >= 8) inner += glyph(flagName(dur, dir), sx, tip);
      }
      for (let d = 0; d < (dur.dots || 0); d++) inner += `<circle cx="${r2(le.x + 10 + d * 6)}" cy="${r2(y - (as % 2 === bottom % 2 ? 5 : 0))}" r="2.1" fill="currentColor"/>`;
      // 덧줄 프리뷰
      const off = as - bottom;
      const lines = [];
      for (let k = -2; k >= (off % 2 === 0 ? off : off + 1); k -= 2) lines.push(k);
      for (let k = 10; k <= (off % 2 === 0 ? off : off - 1); k += 2) lines.push(k);
      for (const k of lines)
        inner += `<line class="ledger" x1="${r2(le.x - 10)}" y1="${r2(yForStep(S, score, bottom + k))}" x2="${r2(le.x + 10)}" y2="${r2(yForStep(S, score, bottom + k))}"/>`;
      s = `<g class="ghost">${inner}</g>`;
    }
    g.innerHTML = s;
  }

  function drawInputCursor(ref) {
    const g = overlayFor("cursor", lastLayout?.eventsById.get(ref)?.page);
    if (!g) return;
    if (!ref || !lastLayout) { g.innerHTML = ""; return; }
    const le = lastLayout.eventsById.get(ref);
    if (!le) { g.innerHTML = ""; return; }
    const S = le.sys;
    const ST = le.staff || S;
    const x = le.x - 13;
    g.innerHTML =
      `<line class="input-caret" x1="${r2(x)}" y1="${ST.yTop - 16}" x2="${r2(x)}" y2="${ST.yTop + STAFF_H + 16}"/>` +
      `<path class="input-caret-arrow" d="M ${r2(x - 4.5)} ${ST.yTop - 16} h 9 l -4.5 6 Z" />`;
  }

  function drawSpeedy(info) {
    const g = overlayFor("speedy", lastLayout?.eventsById.get(info?.cursorId)?.page);
    if (!g) return;
    if (!info || !info.cursorId || !lastLayout) { g.innerHTML = ""; return; }
    const le = lastLayout.eventsById.get(info.cursorId);
    if (!le) { g.innerHTML = ""; return; }
    const S = le.sys;
    const ST = le.staff;
    const M = S.measures.find(m => m.idx === le.mIdx);
    if (!M) { g.innerHTML = ""; return; }
    const score = lastLayout.score;
    const bottom = bottomFor(ST, score);
    const as = info.step ?? bottom + 4;
    const y = yForStep(ST, score, as);
    const frameX = M.x0 + 1;
    const frameY = ST.yTop - 30;
    const frameW = Math.max(8, M.x1 - M.x0 - 2);
    let s =
      `<rect class="speedy-frame" x="${r2(frameX)}" y="${r2(frameY)}" width="${r2(frameW)}" height="${STAFF_H + 60}" rx="6"/>` +
      `<line class="speedy-crosshair" x1="${r2(M.x0 + 4)}" y1="${r2(y)}" x2="${r2(M.x1 - 4)}" y2="${r2(y)}"/>` +
      `<ellipse class="speedy-aim" cx="${r2(le.x)}" cy="${r2(y)}" rx="6.5" ry="4.6"/>`;

    const off = as - bottom;
    const lines = [];
    for (let k = -2; k >= (off % 2 === 0 ? off : off + 1); k -= 2) lines.push(k);
    for (let k = 10; k <= (off % 2 === 0 ? off : off - 1); k += 2) lines.push(k);
    for (const k of lines) {
      const ly = yForStep(ST, score, bottom + k);
      s += `<line class="speedy-ledger" x1="${r2(le.x - 10)}" y1="${r2(ly)}" x2="${r2(le.x + 10)}" y2="${r2(ly)}"/>`;
    }

    const x = le.x - 13;
    s += `<line class="speedy-caret" x1="${r2(x)}" y1="${r2(ST.yTop - 24)}" x2="${r2(x)}" y2="${r2(ST.yTop + STAFF_H + 24)}"/>`;
    g.innerHTML = s;
  }

  function clearOverlays() {
    drawGhost(null); drawInputCursor(null); drawSpeedy(null);
  }

  /* ---------------- 툴바 아이콘 (미니 음표 SVG) ---------------- */
  function iconNote(base, dots) {
    // 24x24 뷰박스 안에 4분/8분/2분 등 미니 음표
    const cx = base.d === 1 ? 11 : 9, cy = 17;
    let inner = "";
    const hollow = base.d <= 2;
    if (base.d === 1) {
      inner += `<ellipse cx="${cx}" cy="${cy - 3}" rx="6" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>`;
      if (base.n >= 2) inner += `<path d="M 3 8 v 12 M 19 8 v 12" stroke="currentColor" stroke-width="1.5"/>`;
    } else {
      inner += hollow
        ? `<ellipse cx="${cx}" cy="${cy}" rx="4.6" ry="3.4" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(-21 ${cx} ${cy})"/>`
        : `<ellipse cx="${cx}" cy="${cy}" rx="4.6" ry="3.4" fill="currentColor" transform="rotate(-21 ${cx} ${cy})"/>`;
      inner += `<line x1="${cx + 4.1}" y1="${cy - 1}" x2="${cx + 4.1}" y2="4" stroke="currentColor" stroke-width="1.8"/>`;
      if (base.d === 8) inner += `<path d="M ${cx + 4.1} 4 C ${cx + 7} 6 ${cx + 9.5} 8 ${cx + 9} 12 C ${cx + 8.5} 9 ${cx + 6.5} 8 ${cx + 4.1} 7.4 Z" fill="currentColor"/>`;
      if (base.d >= 16) for (let i = 0; i < Math.min(4, Math.log2(base.d) - 2); i++) {
        const y = 3 + i * 3.2;
        inner += `<path class="icon-flag" d="M ${cx + 4.1} ${y} c 3 1.6 5.4 3 4.9 6.4 c -.5 -2.4 -2.5 -3.4 -4.9 -3.8 Z" fill="currentColor"/>`;
      }
    }
    for (let d = 0; d < Math.min(2, +(dots ?? base.dots) || 0); d++) inner += `<circle class="icon-dot" cx="${cx + 9 + d * 4}" cy="${cy}" r="1.5" fill="currentColor"/>`;
    return `<svg viewBox="0 0 ${dots > 1 ? 28 : 24} 24" width="22" height="22" aria-hidden="true">${inner}</svg>`;
  }
  function iconRest() {
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g transform="translate(12,12) scale(1.15)"><path d="${FB.restQuarter.d}" fill="currentColor"/></g></svg>`;
  }
  function iconAcc(kind) {
    const fb = FB[kind];
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g transform="translate(12,12) scale(1.1)"><path d="${fb.d}" fill="currentColor" ${fb.evenodd ? 'fill-rule="evenodd"' : ""}/></g></svg>`;
  }

  SF.engrave = {
    SP, PAGE_W, MARGIN, STAFF_H,
    pageMetrics, pageWidth,
    loadFont, isFontReady: () => fontReady,
    STYLE, styleOf, layout, render, renderForExport, hitTest, yForStep, stepForY,
    pageToGlobal, globalToPage, positionForMeasure,
    drawGhost, drawInputCursor, drawSpeedy, clearOverlays,
    iconNote, iconRest, iconAcc,
    getLayout: () => lastLayout,
  };
})(window.SF);
