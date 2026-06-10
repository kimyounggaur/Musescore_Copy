/* =========================================================================
 * ScoreForge core — 악보 도메인 모델 (DOM 의존 없음)
 * 시간은 전부 유리수(Fraction)로 계산한다. 부동소수점 tick 금지.
 * ========================================================================= */
"use strict";
window.SF = window.SF || {};
(function (SF) {

  /* ---------------- Fraction ---------------- */
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; }

  class Fraction {
    constructor(n, d = 1) {
      if (d === 0) throw new Error("Fraction: denominator 0");
      if (d < 0) { n = -n; d = -d; }
      const g = gcd(n, d);
      this.n = n / g; this.d = d / g;
    }
    add(o) { return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { return new Fraction(this.n * o.n, this.d * o.d); }
    div(o) { return new Fraction(this.n * o.d, this.d * o.n); }
    cmp(o) { return this.n * o.d - o.n * this.d; }
    eq(o) { return this.cmp(o) === 0; }
    lt(o) { return this.cmp(o) < 0; }
    lte(o) { return this.cmp(o) <= 0; }
    gt(o) { return this.cmp(o) > 0; }
    gte(o) { return this.cmp(o) >= 0; }
    isZero() { return this.n === 0; }
    get value() { return this.n / this.d; }
    toJSON() { return [this.n, this.d]; }
    toString() { return this.n + "/" + this.d; }
    static from(a) { return a instanceof Fraction ? a : new Fraction(a[0], a[1]); }
  }
  const F = (n, d) => new Fraction(n, d);
  Fraction.ZERO = F(0, 1);

  /* ---------------- Duration ----------------
   * dur = { n, d, dots }  (n/d = 기본 음길이, 온음표 = 1/1)
   * 실제 길이 = base * (2^(dots+1) - 1) / 2^dots
   */
  function durBase(dur) { return F(dur.n, dur.d); }
  function durValue(dur) {
    const dots = dur.dots || 0;
    let v = F(dur.n * (Math.pow(2, dots + 1) - 1), dur.d * Math.pow(2, dots));
    if (dur.tuplet) v = v.mul(F(dur.tuplet.normal || 2, dur.tuplet.actual || 3));
    return v;
  }
  function durEq(a, b) { return a.n === b.n && a.d === b.d && (a.dots || 0) === (b.dots || 0); }

  // 표기 가능한 기본 음길이 (큰 것부터)
  const BASES = [
    { n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 4 }, { n: 1, d: 8 }, { n: 1, d: 16 },
  ];
  const DUR_NAMES = { "1/1": "온음표", "1/2": "2분음표", "1/4": "4분음표", "1/8": "8분음표", "1/16": "16분음표" };
  function durName(dur) {
    const base = DUR_NAMES[dur.n + "/" + dur.d] || (dur.n + "/" + dur.d);
    const tuplet = dur.tuplet ? `${dur.tuplet.actual}잇단 ` : "";
    return tuplet + (dur.dots ? "점" : "") + base;
  }

  function tupletNormalFor(actual) {
    let n = 1;
    while (n * 2 < actual) n *= 2;
    return n;
  }
  function tupletWrittenDur(totalDur, actual) {
    const total = durValue(totalDur);
    const normal = tupletNormalFor(actual);
    const written = total.div(F(normal, 1));
    const base = BASES.find(b => F(b.n, b.d).eq(written)) || { n: written.n, d: written.d };
    return { n: base.n, d: base.d, dots: 0 };
  }
  function tupletMeta(actual, id) {
    return { id: id || newId(), actual, normal: tupletNormalFor(actual) };
  }

  /* tick(마디 내 위치) 정렬을 지키며 길이를 표기 가능한 조각들로 분해.
   * 각 조각은 자기 길이의 배수 위치에서 시작하도록(박 정렬) 큰 것부터 고른다. */
  function decompose(start, len) {
    const out = [];
    let pos = start, remain = len;
    let guard = 0;
    while (remain.n > 0 && guard++ < 256) {
      let picked = null;
      for (const b of BASES) {
        const v = F(b.n, b.d);
        if (v.gt(remain)) continue;
        // pos가 v의 배수인가? (pos / v 가 정수)
        const q = pos.div(v);
        if (q.d === 1) { picked = b; break; }
      }
      if (!picked) picked = { n: 1, d: 16 }; // 안전망: 16분 그리드
      out.push({ n: picked.n, d: picked.d, dots: 0 });
      pos = pos.add(F(picked.n, picked.d));
      remain = remain.sub(F(picked.n, picked.d));
    }
    // 인접 조각 합치기: x + x/2 → 점음표
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      if (a.dots === 0 && b.dots === 0 && F(b.n, b.d).eq(F(a.n, a.d).div(F(2, 1)))) {
        out.splice(i, 2, { n: a.n, d: a.d, dots: 1 });
      }
    }
    return out;
  }

  /* ---------------- Pitch ----------------
   * pitch = { step: 0~6 (C=0 … B=6), alter: -1|0|1, oct }
   * 같은 건반이라도 철자(F#/Gb)를 구분해 저장한다.
   */
  const STEP_SEMIS = [0, 2, 4, 5, 7, 9, 11];
  const STEP_EN = ["C", "D", "E", "F", "G", "A", "B"];
  const STEP_KO = ["도", "레", "미", "파", "솔", "라", "시"];
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];  // B E A D G C F

  function midiOf(p) { return (p.oct + 1) * 12 + STEP_SEMIS[p.step] + p.alter; }
  function absStep(p) { return p.oct * 7 + p.step; }
  function pitchEq(a, b) { return a.step === b.step && a.alter === b.alter && a.oct === b.oct; }

  function keyAlterFor(step, key) {
    if (key > 0 && SHARP_ORDER.indexOf(step) < key) return 1;
    if (key < 0 && FLAT_ORDER.indexOf(step) < -key) return -1;
    return 0;
  }

  // 반음계 철자 테이블 (step, alter) — B#/Cb/E#/Fb 없는 안전한 표준 철자
  const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const FLAT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

  /* midi 번호를 조표·방향에 맞게 합리적으로 철자한다 */
  function spellMidi(midi, key, prefer) {
    midi = Math.max(0, Math.min(127, midi));
    const pc = ((midi % 12) + 12) % 12;
    const octRef = Math.floor(midi / 12) - 1;
    // 1) 조표 음계 안의 음이면 조표 철자 사용
    for (let step = 0; step < 7; step++) {
      const alter = keyAlterFor(step, key);
      if ((STEP_SEMIS[step] + alter + 120) % 12 === pc) {
        const p = { step, alter, oct: octRef };
        return fixOct(p, midi);
      }
    }
    // 2) 방향/조표 선호 철자
    const table = (prefer === "flat" || (prefer !== "sharp" && key < 0)) ? FLAT_SPELL : SHARP_SPELL;
    const [step, alter] = table[pc];
    return fixOct({ step, alter, oct: octRef }, midi);
  }
  function fixOct(p, midi) {
    p.oct = Math.floor((midi - STEP_SEMIS[p.step] - p.alter) / 12) - 1;
    return p;
  }

  function transposePitch(p, semitones, key, prefer) {
    return spellMidi(midiOf(p) + semitones, key, prefer || (semitones >= 0 ? "sharp" : "flat"));
  }

  function pitchName(p, style) {
    const acc = p.alter === 1 ? "♯" : p.alter === -1 ? "♭" : "";
    if (style === "ko") return STEP_KO[p.step] + acc;
    return STEP_EN[p.step] + acc + p.oct;
  }

  /* ---------------- 조표/음자리표 ---------------- */
  const KEY_NAMES = {
    "0": "다장조 (C)", "1": "사장조 (G, ♯1)", "2": "라장조 (D, ♯2)", "3": "가장조 (A, ♯3)",
    "4": "마장조 (E, ♯4)", "5": "나장조 (B, ♯5)", "6": "올림바장조 (F♯, ♯6)", "7": "올림다장조 (C♯, ♯7)",
    "-1": "바장조 (F, ♭1)", "-2": "내림나장조 (B♭, ♭2)", "-3": "내림마장조 (E♭, ♭3)",
    "-4": "내림가장조 (A♭, ♭4)", "-5": "내림라장조 (D♭, ♭5)", "-6": "내림사장조 (G♭, ♭6)", "-7": "내림다장조 (C♭, ♭7)",
  };

  // 음자리표 정보: 맨 아래 줄(line 4)의 absStep 기준
  const CLEFS = {
    treble: { bottomStep: absStep({ step: 2, oct: 4 }), middle: { step: 6, alter: 0, oct: 4 } }, // 아래줄 E4, 중앙 B4
    bass: { bottomStep: absStep({ step: 4, oct: 2 }), middle: { step: 1, alter: 0, oct: 3 } },   // 아래줄 G2, 중앙 D3
  };

  /* 조표 임시표의 보표 스텝 위치(absStep) 배열 */
  function keySigSteps(key, clef) {
    // 표준 위치(높은음자리표): F5 C5 G5 D5 A4 E5 B4 / B4 E5 A4 D5 G4 C5 F4
    // 베이스 음자리표는 정확히 14스텝(2옥타브) 아래가 표준 위치와 일치한다.
    const sharpsTreble = [{ s: 3, o: 5 }, { s: 0, o: 5 }, { s: 4, o: 5 }, { s: 1, o: 5 }, { s: 5, o: 4 }, { s: 2, o: 5 }, { s: 6, o: 4 }];
    const flatsTreble = [{ s: 6, o: 4 }, { s: 2, o: 5 }, { s: 5, o: 4 }, { s: 1, o: 5 }, { s: 4, o: 4 }, { s: 0, o: 5 }, { s: 3, o: 4 }];
    const list = key > 0 ? sharpsTreble.slice(0, key) : flatsTreble.slice(0, -key);
    return list.map(x => absStep({ step: x.s, oct: x.o }) + (clef === "bass" ? -14 : 0));
  }

  /* 박자표의 빔 그룹 경계(마디 시작 기준 Fraction 배열) */
  function beamGroups(ts) {
    const groups = [];
    if (ts.den === 8 && ts.num % 3 === 0) {            // 6/8, 9/8, 12/8 → 점4분 단위
      for (let i = 0; i < ts.num / 3; i++) groups.push(F(3, 8));
    } else if (ts.num === 4 && ts.den === 4) {          // 4/4 → 2박 단위(관례)
      groups.push(F(1, 2)); groups.push(F(1, 2));
    } else {                                            // 그 외 → 박 단위
      for (let i = 0; i < ts.num; i++) groups.push(F(1, ts.den));
    }
    return groups;
  }
  function beatLen(ts) { return (ts.den === 8 && ts.num % 3 === 0) ? F(3, 8) : F(1, ts.den); }

  /* ---------------- Score 모델 ---------------- */
  let _idCounter = 1;
  const newId = () => "e" + (_idCounter++);

  function measureLen(score) { return F(score.timeSig.num, score.timeSig.den); }

  function fullRest(score) {
    const L = measureLen(score);
    return { id: newId(), type: "rest", dur: { n: L.n, d: L.d, dots: 0 }, notes: [], full: true };
  }

  const PART_LIBRARY = {
    piano: { name: "피아노", shortName: "Pno.", group: "keyboard", instrument: "piano", brace: "brace", staves: [{ clef: "treble", name: "오른손" }, { clef: "bass", name: "왼손" }] },
    flute: { name: "플루트", shortName: "Fl.", group: "woodwind", instrument: "flute", staves: [{ clef: "treble" }] },
    violin: { name: "바이올린", shortName: "Vln.", group: "strings", instrument: "strings", staves: [{ clef: "treble" }] },
    viola: { name: "비올라", shortName: "Vla.", group: "strings", instrument: "strings", staves: [{ clef: "treble" }] },
    cello: { name: "첼로", shortName: "Vc.", group: "strings", instrument: "strings", staves: [{ clef: "bass" }] },
    organ: { name: "오르간", shortName: "Org.", group: "keyboard", instrument: "organ", brace: "brace", staves: [{ clef: "treble" }, { clef: "bass" }] },
    epiano: { name: "일렉피아노", shortName: "E.Pno.", group: "keyboard", instrument: "epiano", staves: [{ clef: "treble" }] },
    musicbox: { name: "뮤직박스", shortName: "M.B.", group: "keyboard", instrument: "musicbox", staves: [{ clef: "treble" }] },
    chiptune: { name: "8비트", shortName: "8bit", group: "synth", instrument: "chiptune", staves: [{ clef: "treble" }] },
  };

  const ENSEMBLES = {
    solo: { label: "독주 1단", parts: ["solo"] },
    piano: { label: "피아노 2단", parts: ["piano"] },
    "flute-piano": { label: "플루트 + 피아노 3단", parts: ["flute", "piano"] },
    "string-quartet": { label: "현악4중주", parts: ["violin", "violin", "viola", "cello"] },
  };

  function cloneMeasure(mm) {
    return JSON.parse(JSON.stringify(mm));
  }
  function emptyMeasures(score, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push({ events: [fullRest(score)] });
    return out;
  }
  function partTemplate(kind, opt = {}) {
    const lib = kind === "solo" ? {
      name: opt.name || (PART_LIBRARY[opt.instrument || "piano"]?.name || "악기"),
      shortName: opt.shortName || (PART_LIBRARY[opt.instrument || "piano"]?.shortName || "Inst."),
      group: "solo",
      instrument: opt.instrument || "piano",
      staves: [{ clef: opt.clef || "treble" }],
    } : (PART_LIBRARY[kind] || PART_LIBRARY.piano);
    return {
      id: newId(),
      kind,
      name: lib.name,
      shortName: lib.shortName,
      group: lib.group,
      instrument: lib.instrument,
      brace: lib.brace || null,
      staves: lib.staves.map((st, i) => ({
        id: newId(),
        name: st.name || "",
        clef: st.clef || "treble",
        staffIdx: i,
        measures: [],
      })),
    };
  }
  function createPartsFor(score, partsSpec, measureCount, seedMeasures) {
    return partsSpec.map((spec, pIdx) => {
      const kind = typeof spec === "string" ? spec : (spec.kind || "solo");
      const part = partTemplate(kind, typeof spec === "object" ? spec : {});
      part.staves.forEach((staff, sIdx) => {
        if (pIdx === 0 && sIdx === 0 && seedMeasures) staff.measures = seedMeasures;
        else staff.measures = emptyMeasures(score, measureCount);
      });
      return part;
    });
  }
  function primaryStaff(score) {
    ensureParts(score);
    return score.parts[0].staves[0];
  }
  function syncLegacyFields(score) {
    if (!score.parts || !score.parts.length || !score.parts[0].staves.length) return score;
    const st = score.parts[0].staves[0], part = score.parts[0];
    score.measures = st.measures;
    score.clef = st.clef || score.clef || "treble";
    score.instrument = part.instrument || score.instrument || "piano";
    score.activePartIdx = Math.max(0, Math.min(score.activePartIdx || 0, score.parts.length - 1));
    score.activeStaffIdx = Math.max(0, Math.min(score.activeStaffIdx || 0, score.parts[score.activePartIdx].staves.length - 1));
    return score;
  }
  function ensureParts(score) {
    if (!score.measures) score.measures = [];
    const count = Math.max(1, score.measures.length || 1);
    if (!score.parts || !score.parts.length) {
      const firstMeasures = score.measures.length ? score.measures : emptyMeasures(score, count);
      score.parts = createPartsFor(score, [{
        kind: "solo",
        instrument: score.instrument || "piano",
        clef: score.clef || "treble",
      }], firstMeasures.length, firstMeasures);
    } else {
      for (const part of score.parts) {
        if (!part.id) part.id = newId();
        if (!part.instrument) part.instrument = score.instrument || "piano";
        if (!part.name) part.name = PART_LIBRARY[part.instrument]?.name || "악기";
        if (!part.shortName) part.shortName = PART_LIBRARY[part.instrument]?.shortName || part.name;
        if (!part.staves || !part.staves.length) part.staves = [{ id: newId(), clef: score.clef || "treble", measures: emptyMeasures(score, count) }];
        for (let i = 0; i < part.staves.length; i++) {
          const staff = part.staves[i];
          if (!staff.id) staff.id = newId();
          if (!staff.clef) staff.clef = i === 1 ? "bass" : (score.clef || "treble");
          if (!staff.measures || !staff.measures.length) staff.measures = emptyMeasures(score, count);
          while (staff.measures.length < count) staff.measures.push({ events: [fullRest(score)] });
          for (const mm of staff.measures) if (!mm.events || !mm.events.length) mm.events = [fullRest(score)];
        }
      }
    }
    if (!score.spanners) score.spanners = [];
    return syncLegacyFields(score);
  }
  function staffRefs(score) {
    ensureParts(score);
    const refs = [];
    score.parts.forEach((part, partIdx) => {
      part.staves.forEach((staff, staffIdx) => refs.push({
        partIdx, staffIdx, globalIdx: refs.length,
        part, staff, measures: staff.measures,
        clef: staff.clef || "treble",
        instrument: part.instrument || score.instrument || "piano",
        name: part.name || "악기",
        shortName: part.shortName || part.name || "Inst.",
        brace: part.brace || (part.staves.length > 1 ? "brace" : null),
      }));
    });
    return refs;
  }
  function activeRef(score) {
    const refs = staffRefs(score);
    const p = score.activePartIdx || 0, s = score.activeStaffIdx || 0;
    return refs.find(r => r.partIdx === p && r.staffIdx === s) || refs[0];
  }
  function staffRef(score, ctx) {
    if (!ctx) return activeRef(score);
    const refs = staffRefs(score);
    if (typeof ctx.globalIdx === "number") return refs[ctx.globalIdx] || refs[0];
    const p = ctx.partIdx ?? score.activePartIdx ?? 0;
    const s = ctx.staffIdx ?? score.activeStaffIdx ?? 0;
    return refs.find(r => r.partIdx === p && r.staffIdx === s) || refs[0];
  }
  function staffMeasures(score, ctx) { return staffRef(score, ctx).measures; }
  function setActiveStaff(score, partIdx, staffIdx) {
    ensureParts(score);
    score.activePartIdx = Math.max(0, Math.min(partIdx || 0, score.parts.length - 1));
    score.activeStaffIdx = Math.max(0, Math.min(staffIdx || 0, score.parts[score.activePartIdx].staves.length - 1));
    return activeRef(score);
  }
  function activeClef(score) { return activeRef(score).clef || "treble"; }
  function ensembleKey(score) {
    ensureParts(score);
    if (score.parts.length === 1 && score.parts[0].staves.length === 2 && score.parts[0].instrument === "piano") return "piano";
    if (score.parts.length === 2 && score.parts[0].instrument === "flute" && score.parts[1].instrument === "piano" && score.parts[1].staves.length === 2) return "flute-piano";
    if (score.parts.length === 4 && score.parts.every(p => p.group === "strings")) return "string-quartet";
    if (score.parts.length === 1 && score.parts[0].staves.length === 1) return "solo";
    return "custom";
  }
  function applyEnsemble(score, key) {
    ensureParts(score);
    const spec = ENSEMBLES[key] || ENSEMBLES.solo;
    const oldRefs = staffRefs(score);
    const oldPrimary = oldRefs[0]?.measures || score.measures;
    const count = Math.max(1, score.measures.length);
    const partsSpec = spec.parts.map((kind, i) => {
      if (kind === "solo") return { kind: "solo", instrument: score.instrument || "piano", clef: score.clef || "treble" };
      if (key === "string-quartet" && i === 1) return { kind: "violin", name: "바이올린 II", shortName: "Vln. II" };
      if (key === "string-quartet" && i === 0) return { kind: "violin", name: "바이올린 I", shortName: "Vln. I" };
      return kind;
    });
    score.parts = createPartsFor(score, partsSpec, count, oldPrimary);
    score.activePartIdx = 0;
    score.activeStaffIdx = 0;
    return syncLegacyFields(score);
  }

  function createScore(opt = {}) {
    const measureCount = opt.measureCount || 8;
    const score = {
      format: "scoreforge-1",
      meta: { title: opt.title || "새 악보", composer: opt.composer || "" },
      clef: opt.clef || "treble",
      keySig: opt.keySig ?? 0,
      timeSig: opt.timeSig || { num: 4, den: 4 },
      tempo: opt.tempo || 100,
      instrument: opt.instrument || "piano",
      measures: [],
      parts: [],
      activePartIdx: 0,
      activeStaffIdx: 0,
      spanners: [], // { id, type: 'slur'|'cresc'|'dim', startId, endId } — 구간 요소
    };
    for (let i = 0; i < measureCount; i++) score.measures.push({ events: [fullRest(score)] });
    const ensemble = opt.ensemble || null;
    const parts = opt.parts || (ensemble && ENSEMBLES[ensemble] ? ENSEMBLES[ensemble].parts : [{
      kind: "solo",
      instrument: opt.instrument || "piano",
      clef: opt.clef || "treble",
    }]);
    score.parts = createPartsFor(score, parts, measureCount, score.measures);
    return syncLegacyFields(score);
  }

  /* ---------------- 순회/조회 ---------------- */
  function eventStartTick(measure, eIdx) {
    let t = Fraction.ZERO;
    for (let i = 0; i < eIdx; i++) t = t.add(durValue(measure.events[i].dur));
    return t;
  }
  function findEvent(score, id) {
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        const evs = ref.measures[m].events;
        for (let e = 0; e < evs.length; e++) {
          if (evs[e].id === id) return { ...ref, m, e, ev: evs[e] };
        }
      }
    }
    return null;
  }
  function nextEvent(score, m, e, ctx) {
    const ref = staffRef(score, ctx);
    const measures = staffMeasures(score, ctx);
    const evs = measures[m]?.events || [];
    if (e + 1 < evs.length) return { ...ref, m, e: e + 1, ev: evs[e + 1] };
    for (let mm = m + 1; mm < measures.length; mm++)
      if (measures[mm].events.length) return { ...ref, m: mm, e: 0, ev: measures[mm].events[0] };
    return null;
  }
  function prevEvent(score, m, e, ctx) {
    const ref = staffRef(score, ctx);
    const measures = staffMeasures(score, ctx);
    if (e - 1 >= 0) return { ...ref, m, e: e - 1, ev: measures[m].events[e - 1] };
    for (let mm = m - 1; mm >= 0; mm--) {
      const evs = measures[mm].events;
      if (evs.length) return { ...ref, m: mm, e: evs.length - 1, ev: evs[evs.length - 1] };
    }
    return null;
  }

  /* ---------------- 편집 연산 (fillGap 핵심) ----------------
   * 마디 events 합은 항상 마디 길이와 같다는 불변식을 유지한다.
   */

  /* 마디 내 [start, start+len) 범위를 새 이벤트 목록으로 교체.
   * start는 항상 기존 이벤트 경계여야 한다(입력 커서가 보장). */
  function replaceRange(score, mIdx, start, len, makeEvents, ctx) {
    const measure = staffMeasures(score, ctx)[mIdx];
    const out = [];
    let pos = Fraction.ZERO;
    const end = start.add(len);
    let inserted = false;
    for (const ev of measure.events) {
      const evLen = durValue(ev.dur);
      const evEnd = pos.add(evLen);
      if (evEnd.lte(start) || pos.gte(end)) {
        out.push(ev); // 범위 밖 → 유지
      } else {
        // 범위와 겹침 → 제거. 머리/꼬리가 남으면 쉼표로 채움
        if (pos.lt(start)) {
          for (const d of decompose(pos, start.sub(pos)))
            out.push({ id: newId(), type: "rest", dur: d, notes: [] });
        }
        if (!inserted) { out.push(...makeEvents()); inserted = true; }
        if (evEnd.gt(end)) {
          for (const d of decompose(end, evEnd.sub(end)))
            out.push({ id: newId(), type: "rest", dur: d, notes: [] });
        }
      }
      pos = evEnd;
    }
    if (!inserted) out.push(...makeEvents()); // 빈 마디 안전망
    measure.events = out;
  }

  /* 음표/쉼표 입력. 마디를 넘으면 다음 마디로 타이 분할. 입력된 첫 이벤트 ref 반환 */
  function inputAt(score, mIdx, tick, dur, pitches /* null=쉼표 */, ctx) {
    const ref = staffRef(score, ctx);
    const L = measureLen(score);
    let want = durValue(dur);
    const room = L.sub(tick);
    let firstId = null;

    const place = (m, t, pieces, tieOut) => {
      const evs = pieces.map((d, i) => {
        const ev = {
          id: newId(),
          type: pitches ? "note" : "rest",
          dur: d,
          notes: pitches ? pitches.map(p => ({ step: p.step, alter: p.alter, oct: p.oct, tie: false })) : [],
        };
        if (pitches && (i < pieces.length - 1 || tieOut)) ev.notes.forEach(n => n.tie = true);
        if (!firstId) firstId = ev.id;
        return ev;
      });
      replaceRange(score, m, t, pieces.reduce((a, d) => a.add(durValue(d)), Fraction.ZERO), () => evs, ref);
    };

    if (want.lte(room)) {
      // 한 마디 안에 들어감 — 사용자가 고른 음길이 그대로
      place(mIdx, tick, [Object.assign({}, dur)], false);
    } else {
      // 마디 경계를 넘음 → 분할 + (음표면) 타이
      const over = want.sub(room);
      const hasNext = mIdx + 1 < ref.measures.length;
      place(mIdx, tick, decompose(tick, room), hasNext && !!pitches);
      if (hasNext) {
        const pieces2 = decompose(Fraction.ZERO, over.gt(L) ? L : over);
        const keepFirst = firstId;
        place(mIdx + 1, Fraction.ZERO, pieces2, false);
        firstId = keepFirst;
      }
    }
    normalizeTies(score);
    return firstId;
  }

  /* 이벤트 삭제 → 같은 길이의 쉼표 */
  function deleteEvent(score, mIdx, eIdx, ctx) {
    const measure = staffMeasures(score, ctx)[mIdx];
    const ev = measure.events[eIdx];
    if (!ev) return;
    const start = eventStartTick(measure, eIdx);
    const len = durValue(ev.dur);
    replaceRange(score, mIdx, start, len, () =>
      decompose(start, len).map(d => ({ id: newId(), type: "rest", dur: d, notes: [] })), ctx);
    consolidateRests(score, mIdx, ctx);
    normalizeTies(score);
  }

  function makeTupletAt(score, mIdx, eIdx, actual, ctx) {
    actual = Math.max(2, Math.min(9, actual | 0));
    const measure = staffMeasures(score, ctx)[mIdx];
    const ev = measure.events[eIdx];
    if (!ev || ev.full || ev.dur.tuplet) return null;
    const start = eventStartTick(measure, eIdx);
    const totalLen = durValue(ev.dur);
    const written = tupletWrittenDur(ev.dur, actual);
    const tuplet = tupletMeta(actual);
    const ids = [];
    const make = () => Array.from({ length: actual }, (_, i) => {
      const next = {
        id: newId(),
        type: ev.type,
        dur: { ...written, tuplet: { ...tuplet } },
        notes: ev.type === "note" ? ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct, tie: false })) : [],
      };
      if (i === 0) {
        if (ev.lyric) next.lyric = ev.lyric;
        if (ev.dynamic) next.dynamic = ev.dynamic;
        if (ev.artics) next.artics = [...ev.artics];
        if (ev.tempo) next.tempo = ev.tempo;
        if (ev.rehearsal) next.rehearsal = ev.rehearsal;
        if (ev.staffText) next.staffText = ev.staffText;
      }
      ids.push(next.id);
      return next;
    });
    replaceRange(score, mIdx, start, totalLen, make, ctx);
    normalizeTies(score);
    return ids;
  }

  /* 연속 쉼표 정리: 쉼표 구간을 다시 분해해 깔끔하게, 마디 전체가 쉼표면 온쉼표 1개 */
  function consolidateRests(score, mIdx, ctx) {
    const measure = staffMeasures(score, ctx)[mIdx];
    if (measure.events.every(e => e.type === "rest")) {
      measure.events = [fullRest(score)];
      return;
    }
    const out = [];
    let pos = Fraction.ZERO, runStart = null, runLen = Fraction.ZERO;
    const flush = () => {
      if (runStart !== null) {
        for (const d of decompose(runStart, runLen))
          out.push({ id: newId(), type: "rest", dur: d, notes: [] });
        runStart = null; runLen = Fraction.ZERO;
      }
    };
    for (const ev of measure.events) {
      const len = durValue(ev.dur);
      if (ev.type === "rest") {
        if (runStart === null) runStart = pos;
        runLen = runLen.add(len);
      } else { flush(); out.push(ev); }
      pos = pos.add(len);
    }
    flush();
    measure.events = out;
  }

  /* 타이 정합성: 다음 이벤트에 같은 음높이가 없으면 tie 해제 */
  function normalizeTies(score) {
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        const evs = ref.measures[m].events;
        for (let e = 0; e < evs.length; e++) {
          const ev = evs[e];
          if (ev.type !== "note") continue;
          const nx = nextEvent(score, m, e, ref);
          for (const note of ev.notes) {
            if (note.tie) {
              const ok = nx && nx.ev.type === "note" && nx.ev.notes.some(n2 => pitchEq(n2, note));
              if (!ok) note.tie = false;
            }
          }
        }
      }
    }
  }

  /* 직전 이벤트로부터 타이로 이어져 들어온 음인지 */
  function isTiedFrom(score, m, e, note, ctx) {
    const pv = prevEvent(score, m, e, ctx);
    return !!(pv && pv.ev.type === "note" && pv.ev.notes.some(n => n.tie && pitchEq(n, note)));
  }

  /* ---------------- 스패너(슬러/헤어핀) ---------------- */
  /* 모든 이벤트 id → 전체 순서 인덱스 */
  function eventOrderMap(score) {
    const map = new Map();
    let i = 0;
    for (const ref of staffRefs(score))
      for (const measure of ref.measures)
        for (const ev of measure.events) map.set(ev.id, i++);
    return map;
  }

  /* 앵커가 사라졌거나 순서가 뒤집힌 스패너 제거. 슬러는 양 끝이 음표여야 한다 */
  function normalizeSpanners(score) {
    if (!score.spanners) { score.spanners = []; return; }
    const order = eventOrderMap(score);
    score.spanners = score.spanners.filter(sp => {
      if (!order.has(sp.startId) || !order.has(sp.endId)) return false;
      if (order.get(sp.startId) > order.get(sp.endId)) return false;
      if (sp.type === "slur") {
        const a = findEvent(score, sp.startId), b = findEvent(score, sp.endId);
        if (!a || !b || a.ev.type !== "note" || b.ev.type !== "note") return false;
        if (sp.startId === sp.endId) return false;
      }
      return true;
    });
  }

  /* 특정 이벤트가 슬러 구간 안에 있는지 (레가토 재생용). 마지막 음은 제외 */
  function slurCoverMap(score) {
    const order = eventOrderMap(score);
    const cover = new Set();
    for (const sp of score.spanners || []) {
      if (sp.type !== "slur") continue;
      const a = order.get(sp.startId), b = order.get(sp.endId);
      if (a === undefined || b === undefined) continue;
      for (const [id, idx] of order) if (idx >= a && idx < b) cover.add(id);
    }
    return cover;
  }

  /* ---------------- 박자표 변경: 모든 내용을 새 마디 길이로 다시 붓기 ---------------- */
  function rebar(score, newTs) {
    ensureParts(score);
    const lanes = staffRefs(score).map(ref => {
      const items = [];
      const consumed = new Set();
      for (let m = 0; m < ref.measures.length; m++) {
        const evs = ref.measures[m].events;
        for (let e = 0; e < evs.length; e++) {
          const ev = evs[e];
          if (consumed.has(ev.id)) continue;
          let len = durValue(ev.dur);
          if (ev.type === "note") {
            let cur = { ...ref, m, e, ev };
            while (cur.ev.notes.length && cur.ev.notes.every(n => n.tie)) {
              const nx = nextEvent(score, cur.m, cur.e, ref);
              if (!nx || nx.ev.type !== "note") break;
              consumed.add(nx.ev.id);
              len = len.add(durValue(nx.ev.dur));
              cur = nx;
            }
            items.push({
              type: "note", len,
              pitches: ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })),
              lyric: ev.lyric,
              dynamic: ev.dynamic,
              artics: ev.artics ? [...ev.artics] : null,
              tempo: ev.tempo,
              rehearsal: ev.rehearsal,
              staffText: ev.staffText,
            });
          } else {
            items.push({ type: "rest", len, fromFull: !!ev.full });
          }
        }
      }
      return { ref, items, total: items.reduce((a, it) => a.add(it.len), Fraction.ZERO) };
    });

    score.timeSig = { num: newTs.num, den: newTs.den };
    const L = measureLen(score);
    let mCount = 1;
    for (const lane of lanes) {
      const q = lane.total.div(L);
      mCount = Math.max(mCount, Math.ceil(q.value - 1e-9));
    }
    mCount = Math.max(1, mCount);

    for (const lane of lanes) {
      lane.ref.staff.measures = emptyMeasures(score, mCount);
    }
    syncLegacyFields(score);

    for (const lane of lanes) {
      const ctx = { partIdx: lane.ref.partIdx, staffIdx: lane.ref.staffIdx };
      let m = 0, t = Fraction.ZERO;
      for (const it of lane.items) {
        let remain = it.len;
        let first = true;
        while (remain.n > 0 && m < staffMeasures(score, ctx).length) {
          const room = L.sub(t);
          const take = remain.lte(room) ? remain : room;
          const pieces = decompose(t, take);
          for (const [i, d] of pieces.entries()) {
            const isLastPiece = remain.eq(take) && i === pieces.length - 1;
            if (it.type === "note") {
              const ev = {
                id: newId(), type: "note", dur: d,
                notes: it.pitches.map(p => ({ ...p, tie: !isLastPiece })),
              };
              if (first && it.lyric) ev.lyric = it.lyric;
              if (first && it.dynamic) ev.dynamic = it.dynamic;
              if (first && it.artics) ev.artics = [...it.artics];
              if (first && it.tempo) ev.tempo = it.tempo;
              if (first && it.rehearsal) ev.rehearsal = it.rehearsal;
              if (first && it.staffText) ev.staffText = it.staffText;
              replaceRange(score, m, t, durValue(d), () => [ev], ctx);
            } else {
              replaceRange(score, m, t, durValue(d), () =>
                [{ id: newId(), type: "rest", dur: d, notes: [] }], ctx);
            }
            t = t.add(durValue(d));
            first = false;
          }
          remain = remain.sub(take);
          if (t.gte(L)) { m++; t = Fraction.ZERO; }
        }
      }
      for (let i = 0; i < staffMeasures(score, ctx).length; i++) consolidateRests(score, i, ctx);
    }
    syncLegacyFields(score);
    normalizeTies(score);
  }

  /* ---------------- 전체 조옮김 ---------------- */
  function transposeScore(score, semitones) {
    if (!semitones) return;
    // 새 조표: 5도권에서 7*semitones 이동 후 |fifths| 최소 후보 선택
    let f = score.keySig + 7 * semitones;
    while (f > 7) f -= 12;
    while (f < -7) f += 12;
    if (f === 7 && score.keySig <= 0) f = -5;
    if (f === -7 && score.keySig >= 0) f = 5;
    score.keySig = f;
    for (const ref of staffRefs(score))
      for (const measure of ref.measures)
      for (const ev of measure.events)
        if (ev.type === "note")
          ev.notes = ev.notes.map(n => {
            const p = spellMidi(midiOf(n) + semitones, f, semitones > 0 ? "sharp" : "flat");
            return { ...p, tie: n.tie };
          });
  }

  /* ---------------- 직렬화 ---------------- */
  function toJSON(score) {
    ensureParts(score);
    return JSON.parse(JSON.stringify(score));
  }
  function fromJSON(obj) {
    const score = JSON.parse(JSON.stringify(obj));
    ensureParts(score);
    // id 카운터 복구 + 구버전 파일 마이그레이션
    let maxId = 0;
    for (const ref of staffRefs(score))
      for (const m of ref.measures)
        for (const ev of m.events) {
          const n = parseInt(String(ev.id).replace(/\D/g, ""), 10);
          if (!isNaN(n)) maxId = Math.max(maxId, n);
          if (!ev.notes) ev.notes = [];
        }
    _idCounter = maxId + 1;
    if (!score.spanners) score.spanners = [];
    syncLegacyFields(score);
    normalizeSpanners(score);
    return score;
  }

  /* ---------------- 상태 + Undo/Redo ---------------- */
  const state = {
    score: createScore(),
    dirty: false,
    listeners: new Set(),
  };
  const history = { undo: [], redo: [], max: 200 };

  function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
  function emit() {
    ensureParts(state.score);
    normalizeSpanners(state.score); // 편집으로 앵커가 사라진 슬러/헤어핀 정리
    state.dirty = true;
    for (const fn of state.listeners) fn(state.score);
  }

  /* 모든 악보 변형은 이 함수를 거친다(스냅샷 undo) */
  function mutate(label, fn) {
    history.undo.push(toJSON(state.score));
    if (history.undo.length > history.max) history.undo.shift();
    history.redo.length = 0;
    const result = fn(state.score);
    emit();
    return result;
  }
  function undo() {
    if (!history.undo.length) return false;
    history.redo.push(toJSON(state.score));
    state.score = fromJSON(history.undo.pop());
    emit(); return true;
  }
  function redo() {
    if (!history.redo.length) return false;
    history.undo.push(toJSON(state.score));
    state.score = fromJSON(history.redo.pop());
    emit(); return true;
  }
  function canUndo() { return history.undo.length > 0; }
  function canRedo() { return history.redo.length > 0; }
  function resetHistory() { history.undo.length = 0; history.redo.length = 0; }
  function setScore(score) {
    state.score = fromJSON(score); resetHistory(); emit(); state.dirty = false;
  }

  /* ---------------- 내보내기 ---------------- */
  SF.Fraction = Fraction;
  SF.F = F;
  SF.core = {
    durBase, durValue, durEq, durName, decompose, BASES,
    tupletNormalFor, tupletWrittenDur, tupletMeta,
    midiOf, absStep, pitchEq, keyAlterFor, spellMidi, transposePitch, pitchName,
    STEP_EN, STEP_KO, STEP_SEMIS, KEY_NAMES, CLEFS, keySigSteps, beamGroups, beatLen,
    PART_LIBRARY, ENSEMBLES,
    createScore, measureLen, fullRest, newId,
    ensureParts, staffRefs, staffRef, staffMeasures, activeRef, activeClef, setActiveStaff, ensembleKey, applyEnsemble,
    eventStartTick, findEvent, nextEvent, prevEvent,
    replaceRange, inputAt, deleteEvent, makeTupletAt, consolidateRests, normalizeTies, isTiedFrom,
    eventOrderMap, normalizeSpanners, slurCoverMap,
    rebar, transposeScore, toJSON, fromJSON,
    state, mutate, undo, redo, canUndo, canRedo, resetHistory, setScore, onChange,
  };
})(window.SF);
