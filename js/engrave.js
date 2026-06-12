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

  /* ---------------- 글리프 ---------------- */
  const GLYPHS = {
    gClef:      "", fClef: "",
    headBlack:  "", headHalf: "", headWhole: "",
    sharp:      "", flat: "", natural: "",
    restWhole:  "", restHalf: "", restQuarter: "",
    rest8:      "", rest16: "",
    flag8Up:    "", flag8Down: "", flag16Up: "", flag16Down: "",
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

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* 글리프 1개를 SVG 문자열로 (x,y = 기준점) */
  function glyph(name, x, y, opts = {}) {
    const cls = opts.cls ? ` class="${opts.cls}"` : "";
    const scale = opts.scale || 1;
    if (fontReady && GLYPHS[name]) {
      const anchor = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
      return `<text${cls}${anchor} x="${r2(x)}" y="${r2(y)}" font-family="BravuraSF" font-size="${40 * scale}px">${GLYPHS[name]}</text>`;
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
      const name = kind === "whole" ? "headWhole" : kind === "half" ? "headHalf" : "headBlack";
      const w = kind === "whole" ? 17.3 : 11.8;
      return `<text${cc} x="${r2(x - w / 2)}" y="${r2(y)}" font-family="BravuraSF" font-size="40px">${GLYPHS[name]}</text>`;
    }
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
  const SPACE_BASE = 21, SPACE_K = 0.52;
  function spaceFor(v) { return SPACE_BASE * (1 + SPACE_K * Math.log2(v / (1 / 16))); }

  const ACC_W = { 1: 10.5, "-1": 9.5, 0: 8.5 };

  /* 마디 내 임시표 표시 계산: note.__acc = 'sharp'|'flat'|'natural'|null */
  function computeAccidentals(score) {
    for (const ref of C.staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        const eff = new Map(); // "step:oct" → alter
        const evs = ref.measures[m].events;
        for (let e = 0; e < evs.length; e++) {
          const ev = evs[e];
          if (ev.type !== "note") continue;
          for (const note of ev.notes) {
            const k = note.step + ":" + note.oct;
            const cur = eff.has(k) ? eff.get(k) : C.keyAlterFor(note.step, score.keySig);
            if (C.isTiedFrom(score, m, e, note, ref)) {
              note.__acc = null;            // 타이로 이어진 음은 임시표 생략
              eff.set(k, note.alter);
            } else if (note.alter !== cur) {
              note.__acc = note.alter === 1 ? "sharp" : note.alter === -1 ? "flat" : "natural";
              eff.set(k, note.alter);
            } else {
              note.__acc = null;
            }
          }
        }
      }
    }
  }

  function eventWidth(ev) {
    if (ev.full) return 58;
    const v = C.durValue(ev.dur).value;
    let w = Math.max(26, spaceFor(v));
    if (ev.type === "note") {
      if (ev.graceBefore && ev.graceBefore.length) w += ev.graceBefore.length * 14;
      if (ev.notes.some(n => n.__acc)) w += 11;
      if (hasSecond(ev)) w += 7;
      if (ev.dur.dots) w += 7;
      if (ev.dur.d === 1) w += 6; // 온음표 머리가 넓음
    } else if (ev.dur.dots) w += 7;
    return w;
  }
  function hasSecond(ev) {
    const steps = ev.notes.map(C.absStep).sort((a, b) => a - b);
    for (let i = 0; i + 1 < steps.length; i++) if (steps[i + 1] - steps[i] === 1) return true;
    return false;
  }

  function headerWidth(score, firstSystem) {
    const k = Math.abs(score.keySig);
    return 14 + 28 + (k ? k * 9.5 + 7 : 0) + (firstSystem ? 30 : 0) + 10;
  }
  function staffGroupHeight(refs) {
    if (!refs.length) return STAFF_H;
    let y = 0, lastPart = refs[0].partIdx;
    refs.forEach((ref, i) => {
      if (i > 0) y += STAFF_H + (ref.partIdx === lastPart ? 70 : 90);
      ref._relY = y;
      lastPart = ref.partIdx;
    });
    return y + STAFF_H;
  }
  function measureCount(score, refs) {
    return Math.max(1, ...refs.map(r => r.measures.length));
  }
  function measureNaturalWidth(refs, mIdx) {
    const seg = new Map();
    for (const ref of refs) {
      const mm = ref.measures[mIdx];
      if (!mm) continue;
      if (mm.events.length === 1 && mm.events[0].full) {
        seg.set("0/1", Math.max(seg.get("0/1") || 0, eventWidth(mm.events[0])));
        continue;
      }
      let tick = Fraction.ZERO;
      for (const ev of mm.events) {
        const key = tick.toString();
        seg.set(key, Math.max(seg.get(key) || 0, eventWidth(ev)));
        tick = tick.add(C.durValue(ev.dur));
      }
    }
    return Math.max(64, 16 + [...seg.values()].reduce((a, w) => a + w, 0));
  }
  function segmentMapFor(refs, mIdx, scale) {
    const seg = new Map();
    for (const ref of refs) {
      const mm = ref.measures[mIdx];
      if (!mm || (mm.events.length === 1 && mm.events[0].full)) continue;
      let tick = Fraction.ZERO;
      for (const ev of mm.events) {
        const key = tick.toString();
        seg.set(key, Math.max(seg.get(key) || 0, eventWidth(ev)));
        tick = tick.add(C.durValue(ev.dur));
      }
    }
    return [...seg.entries()]
      .map(([key, w]) => ({ key, width: w * scale }))
      .sort((a, b) => Fraction.from(a.key.split("/").map(Number)).cmp(Fraction.from(b.key.split("/").map(Number))));
  }

  /* 핵심: 악보 → 시스템/이벤트 좌표 */
  function layout(score, opts = {}) {
    C.ensureParts(score);
    computeAccidentals(score);
    const refs = C.visibleStaffRefs ? C.visibleStaffRefs(score, opts.viewMode, { hideEmptyStaves: opts.hideEmptyStaves }) : C.staffRefs(score);
    const count = measureCount(score, refs);
    const lyricVerses = new Set();
    refs.forEach(ref => ref.measures.forEach(mm => mm.events.forEach(ev => C.lyricsOf(ev).forEach(l => lyricVerses.add(l.verse)))));
    const hasLyrics = lyricVerses.size > 0;
    const lyricLineCount = Math.max(1, lyricVerses.size);
    const hasAboveText = refs.some(ref => ref.measures.some(mm => mm.events.some(ev => ev.tempo || ev.rehearsal || ev.staffText || ev.chordSymbol)));
    const hasDyn = refs.some(ref => ref.measures.some(mm => mm.events.some(ev => ev.dynamic))) ||
      (score.spanners || []).some(sp => sp.type === "cresc" || sp.type === "dim");
    const groupH = staffGroupHeight(refs);
    const PITCH = Math.max(150, groupH + 74 + (hasAboveText ? 18 : 0) + (hasLyrics ? 18 * lyricLineCount + 8 : 0) + (hasDyn ? 16 : 0));
    const lyricOff = STAFF_H + (hasDyn ? 52 : 34);

    // 마디 자연 폭
    const natural = Array.from({ length: count }, (_, mIdx) => measureNaturalWidth(refs, mIdx));

    // 그리디 줄바꿈
    const systems = [];
    let i = 0;
    while (i < count) {
      const first = systems.length === 0;
      const nameW = refs.length > 1 ? (first ? 96 : 54) : 0;
      const hw = headerWidth(score, first);
      const usable = PAGE_W - MARGIN * 2 - nameW;
      let sum = 0; const idxs = [];
      while (i < count) {
        const w = natural[i];
        if (idxs.length && hw + sum + w > usable) break;
        idxs.push(i); sum += w; i++;
      }
      systems.push({ idxs, hw, sum, nameW, usable });
    }

    // 시스템별 좌표 채우기
    const out = { systems: [], eventsById: new Map(), pitch: PITCH, hasLyrics, refs };
    systems.forEach((sys, si) => {
      const yTop = 44 + si * PITCH;
      const isLast = si === systems.length - 1;
      let scale = (sys.usable - sys.hw) / sys.sum;
      if (isLast && scale > 1 / 0.7) scale = 1;
      scale = Math.max(scale, 0.5);

      const staffX0 = MARGIN + sys.nameW;
      const S = {
        yTop, pageX0: MARGIN, nameW: sys.nameW,
        x0: staffX0, x1: isLast && scale === 1 ? staffX0 + sys.hw + sys.sum : PAGE_W - MARGIN,
        headerW: sys.hw, measures: [],
        staffLayouts: [],
        middleY: yTop + STAFF_H / 2,
        first: si === 0,
        lyricOff,
      };
      for (const ref of refs) {
        const SL = { ...ref, sys: S, yTop: yTop + ref._relY, x0: S.x0, x1: S.x1, headerW: S.headerW, middleY: yTop + ref._relY + STAFF_H / 2, lyricOff };
        S.staffLayouts.push(SL);
      }
      let x = S.x0 + sys.hw;
      for (const mIdx of sys.idxs) {
        const mW = natural[mIdx] * scale;
        const M = { idx: mIdx, x0: x, x1: x + mW, events: [], staffMeasures: [] };
        const segs = segmentMapFor(refs, mIdx, scale);
        const segX = new Map();
        let ex = x + 12 * scale;
        for (const seg of segs) {
          segX.set(seg.key, ex);
          ex += seg.width;
        }
        for (const SL of S.staffLayouts) {
          const mm = SL.measures[mIdx] || { events: [C.fullRest(score)] };
          const SM = { idx: mIdx, x0: x, x1: x + mW, events: [], staff: SL };
          if (mm.events.length === 1 && mm.events[0].full) {
            const ev = mm.events[0];
            SM.events.push(mkEv(ev, mIdx, 0, x + mW / 2, S, SL, score, Fraction.ZERO));
          } else {
            let tick = Fraction.ZERO;
            mm.events.forEach((ev, eIdx) => {
              const key = tick.toString();
              const baseX = segX.get(key) ?? (x + 12 * scale);
              const accW = (ev.type === "note" && ev.notes.some(n => n.__acc)) ? 11 : 0;
              const cx = baseX + accW + 6.5 + (ev.dur.d === 1 ? 3 : 0);
              SM.events.push(mkEv(ev, mIdx, eIdx, cx, S, SL, score, tick));
              tick = tick.add(C.durValue(ev.dur));
            });
          }
          for (const le of SM.events) {
            out.eventsById.set(le.id, le);
            M.events.push(le);
          }
          M.staffMeasures.push(SM);
        }
        S.measures.push(M);
        x += mW;
      }
      out.systems.push(S);
    });
    out.height = 44 + systems.length * PITCH + 26;
    out.score = score;
    lastLayout = out;
    return out;
  }

  function mkEv(ev, mIdx, eIdx, cx, S, SL, score, tick) {
    return {
      id: ev.id, ev, mIdx, eIdx, x: cx, sys: S, staff: SL,
      partIdx: SL.partIdx, staffIdx: SL.staffIdx, globalIdx: SL.globalIdx, tick,
      startTime: null, // playback에서 채움
    };
  }

  /* absStep → y 좌표 (시스템 기준) */
  function yForStep(S, score, as) {
    const clef = S.clef || score.clef;
    const bottom = C.CLEFS[clef].bottomStep;       // 맨 아래 줄의 absStep
    const bottomY = S.yTop + STAFF_H;
    return bottomY - (as - bottom) * (SP / 2);
  }
  function stepForY(S, score, y) {
    const clef = S.clef || score.clef;
    const bottom = C.CLEFS[clef].bottomStep;
    const bottomY = S.yTop + STAFF_H;
    return Math.round((bottomY - y) / (SP / 2)) + bottom;
  }

  /* ---------------- 렌더 ---------------- */
  let lastLayout = null;

  function render(score, opts = {}) {
    const L = layout(score, opts);
    let sel = opts.selection || null;
    if (sel && !(sel instanceof Set)) sel = new Set([sel]);
    let svg = "";

    for (const S of L.systems) {
      svg += staffLines(S);
      svg += clefAndKey(S, score);
      if (S.first) svg += timeSig(S, score);
      svg += barlines(S, score);
      svg += measureNumbers(S);
      svg += renderVoltas(S, score);
      for (const M of S.measures) {
        for (const SM of M.staffMeasures) {
          const beams = computeBeams(score, SM, SM.staff);
          svg += renderMeasure(score, SM, SM.staff, beams, sel);
        }
      }
    }
    svg += renderTies(score, L);
    svg += renderSpanners(score, L, sel);

    return {
      svg:
        `<svg id="score-svg" viewBox="0 0 ${PAGE_W} ${Math.max(L.height, 230)}" xmlns="http://www.w3.org/2000/svg" ` +
        `font-family="BravuraSF" preserveAspectRatio="xMidYMin meet">` +
        `<g id="score-main">${svg}</g>` +
        `<g id="overlay-ghost" pointer-events="none"></g>` +
        `<g id="overlay-cursor" pointer-events="none"></g>` +
        `<line id="play-cursor" x1="0" x2="0" y1="0" y2="0" stroke="var(--accent,#e8590c)" stroke-width="2" opacity="0" pointer-events="none"/>` +
        `</svg>`,
      layout: L,
    };
  }

  function staffLines(S) {
    let s = `<g class="staff">`;
    for (const SL of S.staffLayouts) {
      for (let i = 0; i < 5; i++) {
        const y = SL.yTop + i * SP;
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
      const cx = SL.x0 + 14;
      if (SL.clef === "treble") {
        const gLineY = yForStep(SL, score, C.absStep({ step: 4, oct: 4 })); // G4 줄
        s += glyph("gClef", cx, gLineY);
      } else {
        const fLineY = yForStep(SL, score, C.absStep({ step: 3, oct: 3 })); // F3 줄
        s += glyph("fClef", cx, fLineY);
      }
      const k = score.keySig;
      if (k !== 0) {
        const steps = C.keySigSteps(k, SL.clef);
        const gname = k > 0 ? "sharp" : "flat";
        steps.forEach((as, i) => {
          s += glyph(gname, SL.x0 + 46 + i * 9.5, yForStep(SL, score, as));
        });
      }
    }
    return s;
  }

  function timeSig(S, score) {
    const x = S.x0 + S.headerW - 24;
    const draw = (n, y) => {
      const str = String(n);
      if (fontReady) {
        const g = str.split("").map(ch => TIMESIG_DIGITS[+ch]).join("");
        return `<text x="${x}" y="${y}" font-family="BravuraSF" font-size="40px" text-anchor="middle">${g}</text>`;
      }
      return `<text x="${x}" y="${y + 7}" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="23px" text-anchor="middle">${str}</text>`;
    };
    let s = "";
    for (const SL of S.staffLayouts) {
      s += draw(score.timeSig.num, SL.yTop + SP);
      s += draw(score.timeSig.den, SL.yTop + 3 * SP);
    }
    return s;
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
        const isScoreEnd = M.idx === count - 1;
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
      const y = S.yTop - 40;
      s += `<path d="M ${r2(x1)} ${r2(y + 16)} L ${r2(x1)} ${r2(y)} L ${r2(x2)} ${r2(y)}${endsHere ? ` L ${r2(x2)} ${r2(y + 16)}` : ""}"/>`;
      if (startsHere) s += `<text x="${r2(x1 + 7)}" y="${r2(y + 12)}">${esc(r.label)}.</text>`;
    }
    return s + "</g>";
  }

  function measureNumbers(S) {
    if (S.first && S.measures.length && S.measures[0].idx === 0) return "";
    if (!S.measures.length) return "";
    return `<text class="mnum" x="${S.x0 + 2}" y="${S.yTop - 14}">${S.measures[0].idx + 1}</text>`;
  }

  /* ---- 빔 계산 ----
   * 기본은 박(beat) 단위 그룹. 단, x/4 박자에서 순수 8분음표 런은
   * 관례대로 2박 단위(박 1+2, 3+4)로 병합한다. 16분음표가 끼면 박 단위 유지.
   */
  function computeBeams(score, M, S) {
    const ts = score.timeSig;
    const beat = C.beatLen(ts);
    const L = C.measureLen(score);
    const bounds = [];
    let acc = beat;
    while (acc.lte(L)) { bounds.push(acc); acc = acc.add(beat); }
    const groupOf = (t) => { for (let i = 0; i < bounds.length; i++) if (t.lt(bounds[i])) return i; return bounds.length - 1; };

    const runs = [];
    let cur = null;
    M.events.forEach((le) => {
      const ev = le.ev;
      const beamable = ev.type === "note" && ev.dur.d >= 8 && !ev.full;
      const gi = groupOf(le.tick);
      if (beamable && cur && cur.gi === gi) {
        cur.items.push(le);
        cur.endTick = le.tick.add(C.durValue(ev.dur));
        cur.all8 = cur.all8 && ev.dur.d === 8;
      } else if (beamable) {
        cur = {
          gi, items: [le],
          startTick: le.tick,
          endTick: le.tick.add(C.durValue(ev.dur)),
          all8: ev.dur.d === 8,
        };
        runs.push(cur);
      } else {
        cur = null;
      }
    });
    if (ts.den === 4 && ts.num % 2 === 0) {
      for (let i = 0; i + 1 < runs.length; i++) {
        const a = runs[i], b = runs[i + 1];
        if (a.all8 && b.all8 && b.gi === a.gi + 1 && a.gi % 2 === 0 && a.endTick.eq(b.startTick)) {
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
      const cls = `ev${isSel ? " sel" : ""}`;
      let body = "";
      if (ev.type === "rest") body = renderRest(score, S, M, le);
      else body = renderNote(score, S, le, beamedIds.has(le.id), stemInfo.get(le.id));
      for (const lyr of C.lyricsOf(ev)) {
        body += `<text class="lyric" x="${r2(le.x)}" y="${S.yTop + S.lyricOff + (lyr.verse - 1) * 17}" text-anchor="middle">${esc(lyr.text)}</text>`;
      }
      if (ev.dynamic) body += renderDynamic(ev.dynamic, le.x, S.yTop + STAFF_H + 28);
      body += renderEventText(ev, le, S);
      // 히트 영역
      const hitX = le.x - 16, hitW = 32;
      body += `<rect class="hit" x="${r2(hitX)}" y="${S.yTop - 62}" width="${hitW}" height="${STAFF_H + 100}" fill="transparent"/>`;
      s += `<g class="${cls}" data-ref="${ev.id}">${body}</g>`;
    }
    s += renderLyricSpans(M, S);
    s += renderTuplets(score, M, S);
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
        const y = S.yTop + S.lyricOff + (lyr.verse - 1) * 17;
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
      const w = Math.max(22, text.length * 9 + 13), x = le.x - w / 2, y = S.yTop - 43;
      s += `<g class="rehearsal-mark"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="20" rx="3"/><text x="${r2(le.x)}" y="${r2(y + 15)}" text-anchor="middle">${text}</text></g>`;
    }
    if (ev.tempo) {
      s += `<text class="tempo-mark" x="${r2(le.x)}" y="${r2(S.yTop - 20)}" text-anchor="middle">♩ = ${esc(String(ev.tempo))}</text>`;
    }
    if (ev.staffText) {
      const y = S.yTop - (ev.tempo ? 6 : 10);
      s += `<text class="staff-text" x="${r2(le.x)}" y="${r2(y)}" text-anchor="middle">${esc(ev.staffText)}</text>`;
    }
    if (ev.chordSymbol) {
      const y = S.yTop - 2;
      s += `<text class="chord-symbol" x="${r2(le.x)}" y="${r2(y)}" text-anchor="middle">${esc(C.displayChordSymbol(ev.chordSymbol))}</text>`;
    }
    return s;
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
      let y = S.yTop - 18;
      for (const le of g.items) {
        if (le.ev.type === "note") {
          const top = Math.min(...le.ev.notes.map(n => yForStep(S, score, C.absStep(n))));
          y = Math.min(y, top - 18);
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
    return `<text class="dyn dyn-fb" x="${r2(x)}" y="${r2(y)}" text-anchor="middle">${mark}</text>`;
  }

  function stemDirFor(score, notes) {
    const mid = C.absStep(C.CLEFS[score.clef].middle);
    const avg = notes.reduce((a, n) => a + C.absStep(n), 0) / notes.length;
    return avg < mid ? "up" : "down";
  }
  function stemDirForStaff(score, notes, S) {
    const clef = S.clef || score.clef;
    const mid = C.absStep(C.CLEFS[clef].middle);
    const avg = notes.reduce((a, n) => a + C.absStep(n), 0) / notes.length;
    return avg < mid ? "up" : "down";
  }

  function renderNote(score, S, le, beamed, stem) {
    const ev = le.ev;
    let s = renderGraceBefore(score, S, le);
    const kind = ev.dur.d === 1 ? "whole" : ev.dur.d === 2 ? "half" : "black";
    const dir = stem ? stem.dir : stemDirForStaff(score, ev.notes, S);
    const sorted = ev.notes.slice().sort((a, b) => C.absStep(a) - C.absStep(b)); // 낮은 음부터
    const stemX = dir === "up" ? le.x + 4.8 : le.x - 4.8;

    // 2도 간격 음 좌우 비껴 배치
    const offs = new Map();
    let prevAs = null, flip = false;
    for (const n of (dir === "up" ? sorted : sorted.slice().reverse())) {
      const as = C.absStep(n);
      if (prevAs !== null && Math.abs(as - prevAs) === 1 && !flip) flip = true;
      else flip = false;
      offs.set(n, flip ? (dir === "up" ? 9.6 : -9.6) : 0);
      prevAs = as;
    }

    // 덧줄
    const bottom = C.CLEFS[S.clef || score.clef].bottomStep;
    let minOff = Infinity, maxOff = -Infinity;
    for (const n of sorted) {
      const off = C.absStep(n) - bottom; // 보표 스텝 오프셋(0=맨아래줄, 8=맨위줄)
      minOff = Math.min(minOff, off); maxOff = Math.max(maxOff, off);
    }
    const lw = kind === "whole" ? 13 : 10;
    for (let k = -2; k >= (minOff % 2 === 0 ? minOff : minOff + 1); k -= 2)
      s += `<line class="ledger" x1="${r2(le.x - lw)}" y1="${r2(yForStep(S, score, bottom + k))}" x2="${r2(le.x + lw)}" y2="${r2(yForStep(S, score, bottom + k))}"/>`;
    for (let k = 10; k <= (maxOff % 2 === 0 ? maxOff : maxOff - 1); k += 2)
      s += `<line class="ledger" x1="${r2(le.x - lw)}" y1="${r2(yForStep(S, score, bottom + k))}" x2="${r2(le.x + lw)}" y2="${r2(yForStep(S, score, bottom + k))}"/>`;

    // 임시표
    let accX = le.x - 6.5 - 6;
    for (const n of sorted.slice().reverse()) {
      if (n.__acc) {
        s += glyph(n.__acc, accX - 4, yForStep(S, score, C.absStep(n)));
      }
    }

    // 음표머리 + 점
    for (const n of sorted) {
      const y = yForStep(S, score, C.absStep(n));
      const ox = offs.get(n) || 0;
      s += headShape(le.x + ox, y, kind);
      if (ev.dur.dots) {
        const off = C.absStep(n) - bottom;
        const dotY = off % 2 === 0 ? y - SP / 2 : y; // 줄 위 음표는 점을 위 칸으로
        for (let d = 0; d < ev.dur.dots; d++)
          s += `<circle class="dot" cx="${r2(le.x + 9.5 + ox + d * 6 + (kind === "whole" ? 4 : 0))}" cy="${r2(dotY)}" r="2.1" fill="currentColor"/>`;
      }
    }

    // 스템 + 기(flag)
    let tipOut = null;
    if (kind !== "whole") {
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
        if (ev.dur.d >= 16) tipY += dir === "up" ? -4 : 4;
      }
      tipOut = tipY;
      const fromY = dir === "up" ? lowY : highY;
      s += `<line class="stem" x1="${r2(stemX)}" y1="${r2(fromY + (dir === "up" ? -1 : 1))}" x2="${r2(stemX)}" y2="${r2(tipY)}"/>`;
      if (!beamed && ev.dur.d >= 8) {
        const fname = ev.dur.d >= 16 ? (dir === "up" ? "flag16Up" : "flag16Down") : (dir === "up" ? "flag8Up" : "flag8Down");
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
    const midY = S.middleY;
    if (ev.full || ev.dur.d === 1) {
      const y = S.yTop + SP; // 2번째 줄에 매달림
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
      s += glyph("rest16", le.x, midY + (fontReady ? 0 : 5));
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
    const dir = stemDirForStaff(score, all, S);

    const xs = items.map(le => dir === "up" ? le.x + 4.8 : le.x - 4.8);
    // 각 이벤트의 극단 머리 y(스템 방향 쪽)
    const headYs = items.map(le => {
      const steps = le.ev.notes.map(C.absStep);
      const ext = dir === "up" ? Math.max(...steps) : Math.min(...steps);
      return yForStep(S, score, ext);
    });
    const baseYs = items.map(le => {
      const steps = le.ev.notes.map(C.absStep);
      const ext = dir === "up" ? Math.min(...steps) : Math.max(...steps);
      return yForStep(S, score, ext);
    });

    const sgn = dir === "up" ? -1 : 1;
    let y1 = headYs[0] + sgn * 3.3 * SP;
    let y2 = headYs[headYs.length - 1] + sgn * 3.3 * SP;
    let dy = y2 - y1;
    if (Math.abs(dy) > SP) dy = Math.sign(dy) * SP; // 기울기 제한
    y2 = y1 + dy;
    const x1 = xs[0], x2 = xs[xs.length - 1];
    const lineY = (x) => y1 + (x2 === x1 ? 0 : (x - x1) / (x2 - x1) * (y2 - y1));

    // 모든 스템 최소 길이 보장
    let shift = 0;
    items.forEach((le, i) => {
      const need = sgn * (lineY(xs[i]) - headYs[i]); // 양수=정상 방향 길이
      if (need < 2.6 * SP) shift = Math.max(shift, 2.6 * SP - need);
    });
    y1 += sgn * shift; y2 += sgn * shift;

    let s = `<g class="beam-group">`;
    // 주 빔(8분)
    s += beamPoly(x1, lineY2(x1), x2, lineY2(x2), 0);
    // 16분 보조 빔
    function lineY2(x) { return y1 + (x2 === x1 ? 0 : (x - x1) / (x2 - x1) * (y2 - y1)); }
    for (let i = 0; i < items.length; i++) {
      const is16 = items[i].ev.dur.d >= 16;
      if (!is16) continue;
      const next16 = i + 1 < items.length && items[i + 1].ev.dur.d >= 16;
      const prev16 = i - 1 >= 0 && items[i - 1].ev.dur.d >= 16;
      if (next16) {
        s += beamPoly(xs[i], lineY2(xs[i]), xs[i + 1], lineY2(xs[i + 1]), -sgn * 7.5);
      } else if (!prev16) {
        // 부분 빔(갈고리)
        const toLeft = i > 0;
        const hx = toLeft ? xs[i] - 9 : xs[i] + 9;
        s += beamPoly(Math.min(xs[i], hx), lineY2(Math.min(xs[i], hx)), Math.max(xs[i], hx), lineY2(Math.max(xs[i], hx)), -sgn * 7.5);
      }
    }
    s += "</g>";

    items.forEach((le, i) => {
      stemInfo.set(le.id, { dir, tipY: lineY2(xs[i]), x: xs[i] });
    });
    return s;

    function beamPoly(bx1, by1, bx2, by2, off) {
      const t = 5; // 빔 두께 0.5sp
      const o = off || 0;
      const top1 = by1 + o, top2 = by2 + o;
      const inner = sgn === -1 ? t : -t; // 빔은 팁에서 안쪽으로
      return `<polygon class="beam" points="${r2(bx1)},${r2(top1)} ${r2(bx2)},${r2(top2)} ${r2(bx2)},${r2(top2 + inner)} ${r2(bx1)},${r2(top1 + inner)}"/>`;
    }
  }

  /* ---- 타이 ---- */
  function renderTies(score, L) {
    let s = "";
    for (const ref of C.staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        const evs = ref.measures[m].events;
        for (let e = 0; e < evs.length; e++) {
          const ev = evs[e];
          if (ev.type !== "note") continue;
          const tied = ev.notes.filter(n => n.tie);
          if (!tied.length) continue;
          const nx = C.nextEvent(score, m, e, ref);
          if (!nx) continue;
          const le1 = L.eventsById.get(ev.id);
          const le2 = L.eventsById.get(nx.ev.id);
          if (!le1 || !le2) continue;
          for (const n of tied) {
            const dir = stemDirForStaff(score, ev.notes, le1.staff); // 타이는 스템 반대쪽
            const curveDown = dir === "up";
            if (le1.sys === le2.sys) {
              s += tiePath(le1.x + 7, le2.x - 7, yForStep(le1.staff, score, C.absStep(n)), curveDown);
            } else {
              s += tiePath(le1.x + 7, le1.sys.x1 - 2, yForStep(le1.staff, score, C.absStep(n)), curveDown);
              s += tiePath(le2.sys.x0 + le2.sys.headerW - 6, le2.x - 7, yForStep(le2.staff, score, C.absStep(n)), curveDown);
            }
          }
        }
      }
    }
    return s;
  }
  function tiePath(x1, x2, y, down) {
    if (x2 - x1 < 8) { x1 -= 3; x2 += 3; }
    const w = x2 - x1;
    const h = Math.min(11, 5 + w * 0.06) * (down ? 1 : -1);
    const yOff = (down ? 6 : -6);
    const y0 = y + yOff;
    return `<path class="tie" d="M ${r2(x1)} ${r2(y0)} C ${r2(x1 + w * 0.3)} ${r2(y0 + h)}, ${r2(x2 - w * 0.3)} ${r2(y0 + h)}, ${r2(x2)} ${r2(y0)} ` +
      `C ${r2(x2 - w * 0.3)} ${r2(y0 + h + (down ? 1.7 : -1.7))}, ${r2(x1 + w * 0.3)} ${r2(y0 + h + (down ? 1.7 : -1.7))}, ${r2(x1)} ${r2(y0)} Z"/>`;
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

  function renderSpanners(score, L, sel) {
    let s = "";
    for (const sp of score.spanners || []) {
      const le1 = L.eventsById.get(sp.startId), le2 = L.eventsById.get(sp.endId);
      if (!le1 || !le2) continue;
      if (sp.type === "slur") s += renderSlur(score, L, le1, le2);
      else if (sp.type === "cresc" || sp.type === "dim") s += renderHairpin(score, L, le1, le2, sp.type);
    }
    return s;
  }

  /* 슬러: 스템 반대쪽(혼합이면 위), 3차 베지어 + 사이 음표 회피 */
  function renderSlur(score, L, le1, le2) {
    const d1 = stemDirForStaff(score, le1.ev.notes, le1.staff), d2 = stemDirForStaff(score, le2.ev.notes, le2.staff);
    const above = !(d1 === "up" && d2 === "up");
    const segs = spannerSegments(le1, le2, L);
    let s = "";
    for (const seg of segs) {
      const edgeY = seg.staff.yTop + (above ? -7 : STAFF_H + 7);
      const y1 = seg.openL ? edgeY : slurAnchorY(score, seg.staff, le1, above);
      const y2 = seg.openR ? edgeY : slurAnchorY(score, seg.staff, le2, above);
      s += slurPath(seg.x1, y1, seg.x2, y2, above, slurClearance(score, seg, above, y1, y2));
    }
    return s;
  }
  function slurAnchorY(score, S, le, above) {
    const steps = le.ev.notes.map(C.absStep);
    const ext = above ? Math.max(...steps) : Math.min(...steps);
    return yForStep(S, score, ext) + (above ? -7 : 7);
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
        let headY = yForStep(seg.S, score, ext);
        const sd = stemDirForStaff(score, le.ev.notes, le.staff || seg.staff);
        if (above && sd === "up") headY -= 3.2 * SP;       // 스템 끝까지 회피
        if (!above && sd === "down") headY += 3.2 * SP;
        const t = Math.max(0.15, Math.min(0.85, (le.x - seg.x1) / w));
        const lineY = y1 + (y2 - y1) * ((le.x - seg.x1) / w);
        const need = above ? (lineY - (headY - 5)) : ((headY + 5) - lineY);
        if (need > 0) {
          const bulge = 0.75 * (4 * t * (1 - t)); // 베지어 근사 부풀음 비율
          h = Math.max(h, (need + 5) / Math.max(0.35, bulge));
        }
      }
    }
    return Math.min(h, 48);
  }
  function slurPath(x1, y1, x2, y2, above, h) {
    const w = Math.max(8, x2 - x1);
    const sgn = above ? -1 : 1;
    const c1x = x1 + w * 0.28, c2x = x2 - w * 0.28;
    const c1y = y1 + sgn * h, c2y = y2 + sgn * h;
    const th = 2.2 * sgn;
    return `<path class="slur" d="M ${r2(x1)} ${r2(y1)} C ${r2(c1x)} ${r2(c1y)}, ${r2(c2x)} ${r2(c2y)}, ${r2(x2)} ${r2(y2)} ` +
      `C ${r2(c2x)} ${r2(c2y + th)}, ${r2(c1x)} ${r2(c1y + th)}, ${r2(x1)} ${r2(y1)} Z"/>`;
  }

  /* 헤어핀(crescendo/diminuendo 쐐기) */
  function renderHairpin(score, L, le1, le2, type) {
    const segs = spannerSegments(le1, le2, L);
    if (!segs.length) return "";
    segs[0].x1 -= 6;
    segs[segs.length - 1].x2 += 9;
    const total = segs.reduce((a, g) => a + Math.max(1, g.x2 - g.x1), 0);
    let cum = 0, s = "";
    const H = 5.5;
    for (const seg of segs) {
      const w = Math.max(1, seg.x2 - seg.x1);
      const f1 = cum / total, f2 = (cum + w) / total;
      cum += w;
      const y = seg.staff.yTop + STAFF_H + 24;
      const h1 = (type === "cresc" ? f1 : 1 - f1) * H;
      const h2 = (type === "cresc" ? f2 : 1 - f2) * H;
      s += `<g class="hairpin">` +
        `<line x1="${r2(seg.x1)}" y1="${r2(y - h1)}" x2="${r2(seg.x2)}" y2="${r2(y - h2)}"/>` +
        `<line x1="${r2(seg.x1)}" y1="${r2(y + h1)}" x2="${r2(seg.x2)}" y2="${r2(y + h2)}"/>` +
        `</g>`;
    }
    return s;
  }

  /* ---------------- 히트 테스트 ---------------- */
  function hitTest(x, y) {
    const L = lastLayout;
    if (!L) return null;
    // 가장 가까운 보표
    let S = null, ST = null, best = Infinity;
    for (const sys of L.systems) {
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
    const step = stepForY(ST, L.score, y);
    return { sys: S, staff: ST, M, staffMeasure: SM, le, step, x, y };
  }

  /* ---------------- 오버레이(고스트/입력 커서) ---------------- */
  function drawGhost(hit, dur, isRest) {
    const g = document.getElementById("overlay-ghost");
    if (!g) return;
    if (!hit || !hit.le) { g.innerHTML = ""; return; }
    const { staff: S, le } = hit;
    const score = lastLayout.score;
    const bottom = C.CLEFS[S.clef || score.clef].bottomStep;
    const as = Math.max(bottom - 11, Math.min(bottom + 19, hit.step));
    const y = yForStep(S, score, as);
    let s = "";
    if (isRest) {
      s += `<g class="ghost">${glyph(dur.d === 4 ? "restQuarter" : dur.d >= 8 ? (dur.d >= 16 ? "rest16" : "rest8") : "restQuarter", le.x, S.middleY)}</g>`;
    } else {
      const kind = dur.d === 1 ? "whole" : dur.d === 2 ? "half" : "black";
      let inner = headShape(le.x, y, kind);
      if (kind !== "whole") {
        const dir = as < C.absStep(C.CLEFS[S.clef || score.clef].middle) ? "up" : "down";
        const sx = dir === "up" ? le.x + 4.8 : le.x - 4.8;
        const tip = dir === "up" ? y - 35 : y + 35;
        inner += `<line class="stem" x1="${r2(sx)}" y1="${r2(y)}" x2="${r2(sx)}" y2="${r2(tip)}"/>`;
        if (dur.d >= 8) inner += glyph(dur.d >= 16 ? (dir === "up" ? "flag16Up" : "flag16Down") : (dir === "up" ? "flag8Up" : "flag8Down"), sx, tip);
      }
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
    const g = document.getElementById("overlay-cursor");
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

  function clearOverlays() {
    drawGhost(null); drawInputCursor(null);
  }

  /* ---------------- 툴바 아이콘 (미니 음표 SVG) ---------------- */
  function iconNote(base, dots) {
    // 24x24 뷰박스 안에 4분/8분/2분 등 미니 음표
    const cx = base.d === 1 ? 11 : 9, cy = 17;
    let inner = "";
    const hollow = base.d <= 2;
    if (base.d === 1) {
      inner += `<ellipse cx="${cx}" cy="${cy - 3}" rx="6" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>`;
    } else {
      inner += hollow
        ? `<ellipse cx="${cx}" cy="${cy}" rx="4.6" ry="3.4" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(-21 ${cx} ${cy})"/>`
        : `<ellipse cx="${cx}" cy="${cy}" rx="4.6" ry="3.4" fill="currentColor" transform="rotate(-21 ${cx} ${cy})"/>`;
      inner += `<line x1="${cx + 4.1}" y1="${cy - 1}" x2="${cx + 4.1}" y2="4" stroke="currentColor" stroke-width="1.8"/>`;
      if (base.d === 8) inner += `<path d="M ${cx + 4.1} 4 C ${cx + 7} 6 ${cx + 9.5} 8 ${cx + 9} 12 C ${cx + 8.5} 9 ${cx + 6.5} 8 ${cx + 4.1} 7.4 Z" fill="currentColor"/>`;
      if (base.d === 16) {
        inner += `<path d="M ${cx + 4.1} 4 C ${cx + 7} 5.6 ${cx + 9.5} 7 ${cx + 9} 10.4 C ${cx + 8.5} 8 ${cx + 6.5} 7 ${cx + 4.1} 6.6 Z" fill="currentColor"/>`;
        inner += `<path d="M ${cx + 4.1} 8 C ${cx + 7} 9.6 ${cx + 9.5} 11 ${cx + 9} 14.4 C ${cx + 8.5} 12 ${cx + 6.5} 11 ${cx + 4.1} 10.6 Z" fill="currentColor"/>`;
      }
    }
    if (dots) inner += `<circle cx="${cx + 9}" cy="${cy}" r="1.8" fill="currentColor"/>`;
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${inner}</svg>`;
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
    loadFont, isFontReady: () => fontReady,
    layout, render, hitTest, yForStep, stepForY,
    drawGhost, drawInputCursor, clearOverlays,
    iconNote, iconRest, iconAcc,
    getLayout: () => lastLayout,
  };
})(window.SF);
