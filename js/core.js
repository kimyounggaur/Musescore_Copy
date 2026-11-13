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
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) throw new RangeError("Fraction: integer numerator/denominator required");
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
    static from(a) {
      if (a instanceof Fraction) return a;
      if (Array.isArray(a)) return new Fraction(a[0], a[1]);
      if (a && typeof a === "object") return new Fraction(a.n, a.d);
      return new Fraction(a, 1);
    }
  }
  const F = (n, d) => new Fraction(n, d);
  Fraction.ZERO = F(0, 1);

  /* Caches never enter files or history snapshots. Public invalidate() is also
   * the escape hatch after direct structural writes by importers/UI code. */
  let cacheRevision = 0;
  const measureOwners = new WeakMap();
  function cacheOf(score) {
    if (!score.__cache) Object.defineProperty(score, "__cache", {
      configurable: true, writable: true, enumerable: false,
      value: { rev: ++cacheRevision, normalized: false },
    });
    return score.__cache;
  }
  function invalidate(score, opt = {}) {
    const normalized = !!(opt.keepNormalized && score.__cache?.normalized);
    Object.defineProperty(score, "__cache", {
      configurable: true, writable: true, enumerable: false,
      value: { rev: ++cacheRevision, normalized },
    });
  }
  function edited(score) { invalidate(score, { keepNormalized: true }); }

  function cloneData(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

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
    { n: 2, d: 1 }, { n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 4 }, { n: 1, d: 8 }, { n: 1, d: 16 }, { n: 1, d: 32 }, { n: 1, d: 64 },
  ];
  const DUR_NAMES = { "2/1": "겹온음표", "1/1": "온음표", "1/2": "2분음표", "1/4": "4분음표", "1/8": "8분음표", "1/16": "16분음표", "1/32": "32분음표", "1/64": "64분음표" };
  function maxDots(dur) {
    const base = durBase(dur);
    return base.lte(F(1, 64)) ? 0 : base.lte(F(1, 32)) ? 1 : 2;
  }
  function durName(dur) {
    const base = DUR_NAMES[dur.n + "/" + dur.d] || (dur.n + "/" + dur.d);
    const tuplet = dur.tuplet ? `${dur.tuplet.actual}잇단 ` : "";
    return tuplet + (dur.dots === 2 ? "겹점" : dur.dots ? "점" : "") + base;
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
    let pos = Fraction.from(start), remain = Fraction.from(len);
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
      // Imported tuplets may have no binary grid representation. Keep the exact
      // remainder instead of rounding up to a 64th (which would overshoot).
      if (!picked) picked = { n: remain.n, d: remain.d };
      out.push({ n: picked.n, d: picked.d, dots: 0 });
      pos = pos.add(F(picked.n, picked.d));
      remain = remain.sub(F(picked.n, picked.d));
    }
    if (remain.n > 0) out.push({ n: remain.n, d: remain.d, dots: 0 });
    // 인접 조각 합치기: x + x/2 → 점음표
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      if (a.dots === 0 && b.dots === 0 && maxDots(a) > 0 && F(b.n, b.d).eq(F(a.n, a.d).div(F(2, 1)))) {
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

  /* ---------------- 코드 기호 ---------------- */
  const CHORD_QUALITY_ALIASES = {
    "": "",
    m: "m",
    min: "m",
    minor: "m",
    maj: "maj",
    major: "maj",
    maj7: "maj7",
    ma7: "maj7",
    "Δ": "maj7",
    "Δ7": "maj7",
    7: "7",
    m7: "m7",
    min7: "m7",
    dim: "dim",
    o: "dim",
    "°": "dim",
    aug: "aug",
    "+": "aug",
    sus2: "sus2",
    sus4: "sus4",
    sus: "sus4",
    add9: "add9",
    m7b5: "m7b5",
    "ø": "m7b5",
  };
  function chordAlterText(alter, pretty) {
    if (!alter) return "";
    return (pretty ? (alter > 0 ? "♯" : "♭") : (alter > 0 ? "#" : "b")).repeat(Math.abs(alter));
  }
  function parseChordSymbol(raw) {
    const original = String(raw || "").trim();
    if (!original) return null;
    const ascii = original.replace(/♯/g, "#").replace(/♭/g, "b").replace(/\s+/g, "");
    const slash = ascii.split("/");
    const head = slash[0];
    const bassText = slash.length > 1 ? slash.slice(1).join("/") : "";
    const m = head.match(/^([A-Ga-g])((?:#{1,2}|b{1,2})?)(.*)$/);
    if (!m) return { raw: original, root: null, rootAlter: 0, quality: "", bass: null, bassAlter: 0, normalized: original };
    const root = m[1].toUpperCase();
    const rootAlter = m[2].startsWith("#") ? m[2].length : -m[2].length;
    const qualityRaw = m[3] || "";
    const quality = CHORD_QUALITY_ALIASES[qualityRaw] ?? CHORD_QUALITY_ALIASES[qualityRaw.toLowerCase()] ?? qualityRaw;
    let bass = null, bassAlter = 0;
    if (bassText) {
      const bm = bassText.match(/^([A-Ga-g])((?:#{1,2}|b{1,2})?)$/);
      if (bm) {
        bass = bm[1].toUpperCase();
        bassAlter = bm[2].startsWith("#") ? bm[2].length : -bm[2].length;
      }
    }
    const normalized = root + chordAlterText(rootAlter, false) + quality + (bass ? "/" + bass + chordAlterText(bassAlter, false) : "");
    return { raw: original, root, rootAlter, quality, bass, bassAlter, normalized };
  }
  function normalizeChordSymbol(raw) {
    const parsed = parseChordSymbol(raw);
    return parsed ? parsed.normalized : "";
  }
  function displayChordSymbol(chord) {
    const parsed = typeof chord === "string" ? parseChordSymbol(chord) : chord;
    if (!parsed) return "";
    if (!parsed.root) return parsed.normalized || parsed.raw || "";
    return parsed.root + chordAlterText(parsed.rootAlter, true) + (parsed.quality || "") +
      (parsed.bass ? "/" + parsed.bass + chordAlterText(parsed.bassAlter, true) : "");
  }
  function cloneChordSymbol(chord) {
    if (!chord) return null;
    const parsed = typeof chord === "string" ? parseChordSymbol(chord) : parseChordSymbol(chord.raw || chord.normalized || "");
    return parsed ? { ...parsed } : null;
  }
  function normalizeEventChordSymbol(ev) {
    if (!ev || !ev.chordSymbol) return;
    const parsed = cloneChordSymbol(ev.chordSymbol);
    if (parsed) ev.chordSymbol = parsed;
    else delete ev.chordSymbol;
  }

  /* ---------------- 가사 ---------------- */
  function lyricsOf(ev) {
    if (!ev) return [];
    if (Array.isArray(ev.lyrics)) {
      return ev.lyrics
        .filter(l => l && String(l.text || "").trim())
        .map(l => ({
          verse: Math.max(1, Math.min(8, l.verse | 0 || 1)),
          text: String(l.text || ""),
          syllabic: l.syllabic || "single",
          extend: !!l.extend,
        }))
        .sort((a, b) => a.verse - b.verse);
    }
    if (ev.lyric) return [{ verse: 1, text: String(ev.lyric), syllabic: "single", extend: false }];
    return [];
  }
  function cloneLyrics(evOrLyrics) {
    const list = Array.isArray(evOrLyrics) ? evOrLyrics : lyricsOf(evOrLyrics);
    return list.map(l => ({ verse: l.verse, text: l.text, syllabic: l.syllabic || "single", extend: !!l.extend }));
  }

  /* ---------------- 꾸밈음 ---------------- */
  function cloneGraceList(list) {
    return (list || []).map(g => ({
      id: g.id || newId(),
      kind: g.kind || "acciaccatura",
      dur: g.dur ? { ...g.dur } : { n: 1, d: 8, dots: 0 },
      notes: (g.notes || []).map(n => ({ step: n.step, alter: n.alter, oct: n.oct, tie: false })),
    }));
  }
  function addGraceBefore(score, eventId, pitch, kind = "acciaccatura") {
    const found = findEvent(score, eventId);
    if (!found || found.ev.type !== "note") return null;
    const grace = {
      id: newId(),
      kind,
      dur: { n: 1, d: 8, dots: 0 },
      notes: [{ step: pitch.step, alter: pitch.alter || 0, oct: pitch.oct, tie: false }],
    };
    found.ev.graceBefore = found.ev.graceBefore || [];
    found.ev.graceBefore.push(grace);
    return grace.id;
  }
  function findGrace(score, id) {
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        for (const entry of measureEntries(ref.measures[m], { score, includeSilent: true })) {
          const ev = entry.ev;
          for (let g = 0; g < (ev.graceBefore || []).length; g++) {
            if (ev.graceBefore[g].id === id) return { ...ref, m, e: entry.e, voice: entry.voice, g, ev, grace: ev.graceBefore[g] };
          }
        }
      }
    }
    return null;
  }
  function setLyric(ev, verse, text, opt = {}) {
    if (!ev) return;
    verse = Math.max(1, Math.min(8, verse | 0 || 1));
    const list = cloneLyrics(ev).filter(l => l.verse !== verse);
    const clean = String(text || "").trim();
    if (clean) list.push({
      verse,
      text: clean,
      syllabic: opt.syllabic || "single",
      extend: !!opt.extend,
    });
    list.sort((a, b) => a.verse - b.verse);
    if (list.length) ev.lyrics = list; else delete ev.lyrics;
    const first = list.find(l => l.verse === 1);
    if (first) ev.lyric = first.text; else delete ev.lyric;
  }
  function normalizeEventLyrics(ev) {
    if (!ev) return;
    const list = cloneLyrics(ev);
    if (list.length) {
      ev.lyrics = list;
      const first = list.find(l => l.verse === 1);
      if (first) ev.lyric = first.text; else delete ev.lyric;
    } else {
      delete ev.lyrics;
      delete ev.lyric;
    }
  }

  /* Decorations belong to the first fragment of an event. Instrument/display
   * properties also belong to tied continuations, so drum/TAB playback survives. */
  const EVENT_DECOR_KEYS = [
    "lyric", "lyrics", "dynamic", "artics", "tempo", "rehearsal", "staffText", "soundFlag",
    "chordSymbol", "fretboard", "graceBefore", "tab", "glissando", "arpeggiate", "tremolo",
    "hidden", "color", "offsetX", "offsetY", "stemDirection", "notehead", "small", "velocityOffset",
    "drumId", "midi", "staffLine", "displayStep", "displayOctave", "ornament", "trillLine",
  ];
  const CONTINUATION_DECOR_KEYS = [
    "tab", "hidden", "color", "offsetX", "offsetY", "stemDirection", "notehead", "small", "velocityOffset",
    "drumId", "midi", "staffLine", "displayStep", "displayOctave",
  ];
  /** copyDecor(src, dst, {skip?: string[]}) mutates/returns dst; absent keys
   * are deleted, skipped keys are untouched. All copied values are independent. */
  function copyDecor(src, dst, opt = {}) {
    const skip = new Set(opt.skip || []);
    for (const key of EVENT_DECOR_KEYS) {
      if (skip.has(key)) continue;
      if (src && Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) dst[key] = cloneData(src[key]);
      else delete dst[key];
    }
    return dst;
  }
  function pickDecor(ev) { return copyDecor(ev, {}); }
  function stripDecor(ev) {
    const copy = cloneData(ev);
    for (const key of EVENT_DECOR_KEYS) delete copy[key];
    return copy;
  }
  const ORNAMENTS = ["trill", "mordent", "invMordent", "turn", "invTurn"];
  function setOrnament(score, id, ornament, trillLine = false) {
    const found = findEvent(score, id);
    if (!found || found.ev.type !== "note") return false;
    if (ornament != null && !ORNAMENTS.includes(ornament)) throw new RangeError("Unknown ornament");
    if (ornament) found.ev.ornament = ornament; else delete found.ev.ornament;
    if (ornament === "trill" && trillLine) found.ev.trillLine = true; else delete found.ev.trillLine;
    return true;
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
    treble: { bottomStep: absStep({ step: 2, oct: 4 }), middle: { step: 6, alter: 0, oct: 4 }, glyph: "gClef", octaveShift: 0, sign: "G", line: 2 },
    bass: { bottomStep: absStep({ step: 4, oct: 2 }), middle: { step: 1, alter: 0, oct: 3 }, glyph: "fClef", octaveShift: 0, sign: "F", line: 4 },
    alto: { bottomStep: absStep({ step: 3, oct: 3 }), middle: { step: 0, alter: 0, oct: 4 }, glyph: "cClef", octaveShift: 0, sign: "C", line: 3 },
    tenor: { bottomStep: absStep({ step: 1, oct: 3 }), middle: { step: 5, alter: 0, oct: 3 }, glyph: "cClef", octaveShift: 0, sign: "C", line: 4 },
    treble8vb: { bottomStep: absStep({ step: 2, oct: 4 }), middle: { step: 6, alter: 0, oct: 4 }, glyph: "gClef", octaveShift: -12, sign: "G", line: 2 },
    bass8vb: { bottomStep: absStep({ step: 4, oct: 2 }), middle: { step: 1, alter: 0, oct: 3 }, glyph: "fClef", octaveShift: -12, sign: "F", line: 4 },
    percussion: { bottomStep: absStep({ step: 2, oct: 4 }), middle: { step: 6, alter: 0, oct: 4 }, glyph: "percussionClef", octaveShift: 0, sign: "percussion", line: 2 },
  };

  const DRUM_MAP = {
    kick: { label: "Kick", midi: 36, staffLine: 1, notehead: "normal", displayStep: "F", displayOctave: 4 },
    snare: { label: "Snare", midi: 38, staffLine: 4, notehead: "normal", displayStep: "C", displayOctave: 5 },
    "closed-hihat": { label: "Closed HH", midi: 42, staffLine: 8, notehead: "x", displayStep: "G", displayOctave: 5 },
    "open-hihat": { label: "Open HH", midi: 46, staffLine: 8, notehead: "circle-x", displayStep: "G", displayOctave: 5 },
    crash: { label: "Crash", midi: 49, staffLine: 9, notehead: "x", displayStep: "A", displayOctave: 5 },
    ride: { label: "Ride", midi: 51, staffLine: 7, notehead: "x", displayStep: "F", displayOctave: 5 },
    "low-tom": { label: "Low Tom", midi: 45, staffLine: 2, notehead: "normal", displayStep: "A", displayOctave: 4 },
    "mid-tom": { label: "Mid Tom", midi: 47, staffLine: 5, notehead: "normal", displayStep: "D", displayOctave: 5 },
    "high-tom": { label: "High Tom", midi: 50, staffLine: 6, notehead: "normal", displayStep: "E", displayOctave: 5 },
  };
  function drumSpec(drumId) { return DRUM_MAP[drumId] || DRUM_MAP.snare; }
  const GUITAR_STANDARD_TUNING = [64, 59, 55, 50, 45, 40]; // string 1 high E → string 6 low E
  function midiToStringFret(midi, tuning = GUITAR_STANDARD_TUNING, preferredPosition = 0) {
    const candidates = [];
    tuning.forEach((openMidi, idx) => {
      const fret = midi - openMidi;
      if (fret >= 0 && fret <= 24) candidates.push({ string: idx + 1, fret });
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.fret - preferredPosition) - Math.abs(b.fret - preferredPosition) || a.string - b.string);
    return candidates[0];
  }
  function stringFretToMidi(string, fret, tuning = GUITAR_STANDARD_TUNING) {
    const openMidi = tuning[Math.max(1, Math.min(6, string | 0 || 1)) - 1];
    return openMidi + Math.max(0, Math.min(24, fret | 0 || 0));
  }
  function applyTabToEvent(ev, part) {
    if (!ev || ev.type !== "note" || !ev.notes?.length) return;
    const tuning = part?.tuning || GUITAR_STANDARD_TUNING;
    const first = ev.notes[0];
    const sf = midiToStringFret(midiOf(first), tuning, part?.preferredPosition || 0);
    if (sf) ev.tab = sf;
  }
  const FRETBOARD_LIBRARY = {
    C: ["x", 3, 2, 0, 1, 0],
    Cm: ["x", 3, 5, 5, 4, 3],
    C7: ["x", 3, 2, 3, 1, 0],
    D: ["x", "x", 0, 2, 3, 2],
    Dm: ["x", "x", 0, 2, 3, 1],
    E: [0, 2, 2, 1, 0, 0],
    Em: [0, 2, 2, 0, 0, 0],
    F: [1, 3, 3, 2, 1, 1],
    G: [3, 2, 0, 0, 0, 3],
    G7: [3, 2, 0, 0, 0, 1],
    A: ["x", 0, 2, 2, 2, 0],
    Am: ["x", 0, 2, 2, 1, 0],
    B7: ["x", 2, 1, 2, 0, 2],
  };
  function getDefaultFretboard(chord) {
    const parsed = typeof chord === "string" ? parseChordSymbol(chord) : chord;
    if (!parsed || !parsed.root) return null;
    const key = parsed.root + chordAlterText(parsed.rootAlter, false) + (parsed.quality || "");
    const known = FRETBOARD_LIBRARY[key];
    if (known) return { strings: 6, frets: 4, firstFret: 1, positions: [...known], fingers: [] };
    // Movable E/A shapes cover major, minor and dominant/minor sevenths.
    // Unknown qualities stay unavailable instead of showing the wrong chord.
    const shapes = {
      "": [[0, 2, 2, 1, 0, 0], ["x", 0, 2, 2, 2, 0]],
      m: [[0, 2, 2, 0, 0, 0], ["x", 0, 2, 2, 1, 0]],
      "7": [[0, 2, 0, 1, 0, 0], ["x", 0, 2, 0, 2, 0]],
      m7: [[0, 2, 0, 0, 0, 0], ["x", 0, 2, 0, 1, 0]],
      maj7: [[0, 2, 1, 1, 0, 0], ["x", 0, 2, 1, 2, 0]],
    }[parsed.quality || ""];
    if (!shapes) return null;
    const pc = (STEP_SEMIS[STEP_EN.indexOf(parsed.root)] + parsed.rootAlter + 12) % 12;
    const candidates = shapes.map((shape, i) => {
      const shift = (pc - (i ? 9 : 4) + 12) % 12;
      return { shift, positions: shape.map(fret => fret === "x" ? "x" : fret + shift) };
    }).sort((a, b) => a.shift - b.shift);
    const best = candidates[0];
    return { strings: 6, frets: 4, firstFret: Math.max(1, best.shift), positions: best.positions, fingers: [] };
  }

  const SOUND_FLAGS = {
    pizzicato: { label: "pizz.", aliases: ["pizz.", "pizzicato"] },
    arco: { label: "arco", aliases: ["arco"] },
    mute: { label: "mute", aliases: ["mute", "con sord.", "con sord"] },
    open: { label: "open", aliases: ["open", "senza sord.", "senza sord"] },
    tremolo: { label: "trem.", aliases: ["trem.", "tremolo"] },
    palmMute: { label: "P.M.", aliases: ["p.m.", "pm", "palm mute"] },
  };
  function detectSoundFlag(text) {
    const clean = String(text || "").trim().toLowerCase();
    if (!clean) return null;
    for (const [key, spec] of Object.entries(SOUND_FLAGS)) {
      if (spec.aliases.some(a => clean === a || clean.includes(a))) return key;
    }
    return null;
  }

  /* 조표 임시표의 보표 스텝 위치(absStep) 배열 */
  function keySigSteps(key, clef) {
    // 표준 위치(높은음자리표): F5 C5 G5 D5 A4 E5 B4 / B4 E5 A4 D5 G4 C5 F4
    // 베이스 음자리표는 정확히 14스텝(2옥타브) 아래가 표준 위치와 일치한다.
    const sharpsTreble = [{ s: 3, o: 5 }, { s: 0, o: 5 }, { s: 4, o: 5 }, { s: 1, o: 5 }, { s: 5, o: 4 }, { s: 2, o: 5 }, { s: 6, o: 4 }];
    const flatsTreble = [{ s: 6, o: 4 }, { s: 2, o: 5 }, { s: 5, o: 4 }, { s: 1, o: 5 }, { s: 4, o: 4 }, { s: 0, o: 5 }, { s: 3, o: 4 }];
    const list = key > 0 ? sharpsTreble.slice(0, key) : flatsTreble.slice(0, -key);
    const shift = clef === "bass" || clef === "bass8vb" ? -14 : clef === "alto" ? -7 : clef === "tenor" ? -7 : 0;
    // C-clef signatures keep each accidental within the conventional staff band.
    const bottom = (CLEFS[clef] || CLEFS.treble).bottomStep;
    return list.map(x => {
      let step = absStep({ step: x.s, oct: x.o }) + shift;
      if (clef === "alto" || clef === "tenor") {
        while (step > bottom + 9) step -= 7;
        while (step < bottom + 2) step += 7;
      }
      return step;
    });
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

  function canonicalMeasures(score) { return score.parts?.[0]?.staves?.[0]?.measures || score.measures || []; }
  function validTimeSig(value) {
    if (!value || !Number.isInteger(value.num) || value.num < 1 || value.num > 32 ||
        ![1, 2, 4, 8, 16, 32, 64].includes(value.den)) throw new RangeError("Invalid time signature");
    return { num: value.num, den: value.den };
  }
  function positiveFraction(value) {
    const f = Fraction.from(value);
    if (f.n <= 0) throw new RangeError("Duration must be positive");
    return f;
  }
  function timingOf(score) {
    const cache = cacheOf(score);
    if (cache.timing) return cache.timing;
    let key = score.keySig ?? 0, ts = score.timeSig || { num: 4, den: 4 };
    const keys = [], times = [], lengths = [], starts = [Fraction.ZERO];
    for (const [m, mm] of canonicalMeasures(score).entries()) {
      if (mm.keySig != null) key = mm.keySig;
      if (mm.timeSig != null) ts = mm.timeSig;
      keys.push(key); times.push(ts);
      const custom = m === 0 && mm.pickup != null ? mm.pickup : mm.length;
      const len = custom != null ? positiveFraction(custom) : F(ts.num, ts.den);
      lengths.push(len); starts.push(starts[m].add(len));
    }
    return (cache.timing = { keys, times, lengths, starts, key, ts });
  }
  /** Inherited signatures; measure indices are zero based. No score mutation. */
  function keySigAt(score, m = 0) { const t = timingOf(score); return t.keys[m] ?? t.key; }
  function timeSigAt(score, m = 0) { const t = timingOf(score); return t.times[m] || t.ts; }
  function measureLenAt(score, m = 0) {
    const t = timingOf(score);
    return t.lengths[m] || F(t.ts.num, t.ts.den);
  }
  function measureLen(score, m = 0) { return measureLenAt(score, m); }
  /** Cached array of N+1 exact boundaries, including the score end. Treat as read only. */
  function measureStarts(score) { return timingOf(score).starts; }
  /** Returns a clef NAME (use CLEFS[name] for glyph/octave metadata). */
  function clefAt(ref, m = 0) {
    const staff = ref.staff || ref;
    const measures = staff.measures || ref.measures || [];
    for (let i = Math.min(m, measures.length - 1); i >= 0; i--) if (measures[i].clef) return measures[i].clef;
    return staff.clef || ref.clef || "treble";
  }
  function setMeasureKeySig(score, m, value) {
    ensureParts(score);
    if (!canonicalMeasures(score)[m]) return false;
    if (value != null && (!Number.isInteger(value) || Math.abs(value) > 7)) throw new RangeError("Invalid key signature");
    forEachMeasureAt(score, m, mm => { if (value == null) delete mm.keySig; else mm.keySig = value; });
    edited(score);
    return true;
  }
  function setMeasureClef(score, m, value, ctx) {
    const ref = staffRef(score, ctx), mm = ref.measures[m];
    if (!mm) return false;
    if (value != null && !CLEFS[value]) throw new RangeError("Invalid clef");
    if (value == null) delete mm.clef; else mm.clef = value;
    edited(score);
    return true;
  }
  function setMeasureTimeSig(score, m, timeSig) { return rebar(score, timeSig, m); }
  const DEFAULT_LAYOUT = {
    pageSize: "A4",
    orientation: "portrait",
    width: 1000,
    height: 1414,
    marginTop: 52,
    marginRight: 52,
    marginBottom: 52,
    marginLeft: 52,
    staffScale: 1,
    systemGap: 1,
    staffGap: 1,
    noteSpacing: 1,
    beamThickness: 1,
    measuresPerSystem: 0,
  };
  function ensureLayout(score) {
    score.layout = { ...DEFAULT_LAYOUT, ...(score.layout || {}) };
    const pageDefaults = pageSizeDefaults(score.layout.pageSize, score.layout.orientation);
    score.layout.width = Math.max(720, Math.min(1600, +(score.layout.width || pageDefaults.width)));
    score.layout.height = Math.max(900, Math.min(2200, +(score.layout.height || pageDefaults.height)));
    score.layout.marginTop = Math.max(20, Math.min(160, +(score.layout.marginTop || DEFAULT_LAYOUT.marginTop)));
    score.layout.marginRight = Math.max(20, Math.min(180, +(score.layout.marginRight || DEFAULT_LAYOUT.marginRight)));
    score.layout.marginBottom = Math.max(20, Math.min(180, +(score.layout.marginBottom || DEFAULT_LAYOUT.marginBottom)));
    score.layout.marginLeft = Math.max(20, Math.min(180, +(score.layout.marginLeft || DEFAULT_LAYOUT.marginLeft)));
    score.layout.systemGap = Math.max(0.75, Math.min(1.8, +(score.layout.systemGap || 1)));
    score.layout.staffGap = Math.max(0.75, Math.min(1.8, +(score.layout.staffGap || 1)));
    score.layout.noteSpacing = Math.max(0.75, Math.min(1.55, +(score.layout.noteSpacing || 1)));
    score.layout.beamThickness = Math.max(0.7, Math.min(1.8, +(score.layout.beamThickness || 1)));
    score.layout.measuresPerSystem = Math.max(0, Math.min(16, score.layout.measuresPerSystem | 0 || 0));
    return score.layout;
  }
  function pageSizeDefaults(pageSize, orientation) {
    const base = pageSize === "Letter" ? { width: 1000, height: 1294 } : { width: 1000, height: 1414 };
    return orientation === "landscape" ? { width: base.height, height: base.width } : base;
  }

  const DEFAULT_STYLE = Object.freeze({
    staffLineWidth: 1.1, stemWidth: 1.5, beamThickness: 5, ledgerLength: 20,
    noteheadScale: 1, lyricFontSize: 14, lyricLineHeight: 17, chordFontSize: 15,
    systemFirstMeasurePadding: 12, measureMinWidth: 64, spaceBase: 21, spaceK: 0.52,
    slurThickness: 2.2, tieHeightFactor: 0.06,
  });
  function ensureStyle(score) {
    const style = score.style || (score.style = {});
    // Preserve the early integration names as live, nonserialized aliases.
    for (const [alias, key, factor] of [["lyricLineGap", "lyricLineHeight", 1], ["tieHeight", "tieHeightFactor", 0.06]]) {
      const property = Object.getOwnPropertyDescriptor(style, alias);
      if (property && !property.get && Number.isFinite(+property.value) && +property.value > 0) style[key] = +property.value * factor;
      if (!property?.get) Object.defineProperty(style, alias, {
        configurable: true, enumerable: false,
        get() { return this[key] / factor; },
        set(value) { this[key] = Number(value) * factor; },
      });
    }
    for (const [key, fallback] of Object.entries(DEFAULT_STYLE)) {
      const value = Number(style[key]);
      style[key] = Number.isFinite(value) && value > 0 ? Math.max(fallback / 4, Math.min(fallback * 4, value)) : fallback;
    }
    return style;
  }
  function styleOf(score) { return ensureStyle(score); }

  function fullRest(score, m = 0) {
    const L = measureLenAt(score, m);
    return { id: newId(), type: "rest", dur: { n: L.n, d: L.d, dots: 0 }, notes: [], full: true };
  }

  const PART_LIBRARY = {
    piano: { name: "피아노", shortName: "Pno.", group: "keyboard", instrument: "piano", brace: "brace", staves: [{ clef: "treble", name: "오른손" }, { clef: "bass", name: "왼손" }] },
    flute: { name: "플루트", shortName: "Fl.", group: "woodwind", instrument: "flute", staves: [{ clef: "treble" }] },
    violin: { name: "바이올린", shortName: "Vln.", group: "strings", instrument: "strings", staves: [{ clef: "treble" }] },
    viola: { name: "비올라", shortName: "Vla.", group: "strings", instrument: "strings", staves: [{ clef: "alto" }] },
    cello: { name: "첼로", shortName: "Vc.", group: "strings", instrument: "strings", staves: [{ clef: "bass" }] },
    organ: { name: "오르간", shortName: "Org.", group: "keyboard", instrument: "organ", brace: "brace", staves: [{ clef: "treble" }, { clef: "bass" }] },
    drumkit: { name: "드럼 키트", shortName: "Dr.", group: "percussion", instrument: "drums", staves: [{ clef: "percussion", instrumentType: "percussion", staffType: "percussion" }] },
    guitar: { name: "기타", shortName: "Gtr.", group: "strings", instrument: "guitar", tuning: GUITAR_STANDARD_TUNING, staves: [{ clef: "treble8vb" }] },
    "guitar-tab": { name: "기타 + TAB", shortName: "Gtr.", group: "strings", instrument: "guitar", tuning: GUITAR_STANDARD_TUNING, brace: "brace", staves: [{ clef: "treble8vb", staffType: "standard", name: "Staff" }, { clef: "treble", staffType: "tab", name: "TAB" }] },
    epiano: { name: "일렉피아노", shortName: "E.Pno.", group: "keyboard", instrument: "epiano", staves: [{ clef: "treble" }] },
    musicbox: { name: "뮤직박스", shortName: "M.B.", group: "keyboard", instrument: "musicbox", staves: [{ clef: "treble" }] },
    chiptune: { name: "8비트", shortName: "8bit", group: "synth", instrument: "chiptune", staves: [{ clef: "treble" }] },
  };

  const ENSEMBLES = {
    solo: { label: "독주 1단", parts: ["solo"] },
    piano: { label: "피아노 2단", parts: ["piano"] },
    "flute-piano": { label: "플루트 + 피아노 3단", parts: ["flute", "piano"] },
    "string-quartet": { label: "현악4중주", parts: ["violin", "violin", "viola", "cello"] },
    drumkit: { label: "드럼 키트", parts: ["drumkit"] },
    "guitar-tab": { label: "기타 + TAB", parts: ["guitar-tab"] },
  };

  /** Zero-based GM program -> supported playback instrument key. MusicXML
   * callers subtract one from midi-program; channel is one based (10 = drums). */
  function instrumentForGm(program, opt = {}) {
    if (typeof opt === "boolean") opt = { percussion: opt };
    if (typeof opt === "number") opt = { channel: opt };
    opt = opt || {};
    if (opt.channel === 10 || opt.percussion || opt.unpitched) return "drums";
    const presets = [[0, "piano"], [4, "epiano"], [10, "musicbox"], [19, "organ"], [24, "guitar"], [48, "strings"], [73, "flute"], [80, "chiptune"]];
    const gm = Number.isFinite(Number(program)) ? Math.max(0, Math.min(127, Number(program))) : 0;
    return presets.reduce((best, item) => Math.abs(item[0] - gm) < Math.abs(best[0] - gm) ? item : best)[1];
  }

  function cloneMeasure(mm) {
    return JSON.parse(JSON.stringify(mm));
  }
  const VOICE_COUNT = 4;
  function normalizeVoice(voice) {
    return Math.max(1, Math.min(VOICE_COUNT, voice | 0 || 1));
  }
  function voiceFromCtx(ctx) {
    return normalizeVoice(ctx?.voice || state?.currentVoice || 1);
  }
  function markEventVoice(ev, voice) {
    if (!ev) return ev;
    ev.voice = normalizeVoice(voice);
    if (!ev.notes) ev.notes = [];
    return ev;
  }
  function hasVisibleContent(ev) {
    return !!(ev && (
      ev.type === "note" ||
      ev.chordSymbol || ev.tempo || ev.rehearsal || ev.staffText ||
      ev.dynamic || (ev.artics && ev.artics.length) ||
      (ev.lyric || (ev.lyrics && ev.lyrics.length)) ||
      (ev.graceBefore && ev.graceBefore.length) ||
      EVENT_DECOR_KEYS.some(key => ev[key] !== undefined && ev[key] !== null && ev[key] !== false && ev[key] !== "")
    ));
  }
  function voiceIsEmpty(evs) {
    return !evs || !evs.length || evs.every(ev => ev.type === "rest" && !hasVisibleContent(ev));
  }
  function ensureMeasureVoices(mm, score, mIdx) {
    if (!mm) return [];
    const owner = measureOwners.get(mm);
    if (score && mIdx !== undefined) measureOwners.set(mm, { score, m: mIdx });
    mIdx = mIdx ?? owner?.m ?? 0;
    const fallbackScore = score || { timeSig: { num: 4, den: 4 } };
    const legacy = Object.getOwnPropertyDescriptor(mm, "events");
    const base = Array.isArray(legacy?.value) && legacy.value.length ? legacy.value : null;
    if (!Array.isArray(mm.voices)) {
      mm.voices = Array.from({ length: VOICE_COUNT }, (_, i) => i === 0 && base ? base : []);
    }
    while (mm.voices.length < VOICE_COUNT) mm.voices.push([]);
    for (let v = 0; v < VOICE_COUNT; v++) {
      if (!Array.isArray(mm.voices[v])) mm.voices[v] = [];
      if (!mm.voices[v].length) mm.voices[v] = [fullRest(fallbackScore, mIdx)];
      mm.voices[v].forEach(ev => markEventVoice(ev, v + 1));
    }
    if (!legacy?.get) Object.defineProperty(mm, "events", {
      configurable: true, enumerable: false,
      get() { return this.voices?.[0] || []; },
      set(value) {
        if (!Array.isArray(this.voices)) this.voices = [];
        this.voices[0] = Array.isArray(value) ? value : [];
        const currentOwner = measureOwners.get(this);
        if (currentOwner) edited(currentOwner.score);
      },
    });
    ensureMeasureMeta(mm);
    return mm.voices;
  }
  function getVoiceEvents(measure, voice = 1, score) {
    const list = measure?.voices?.[normalizeVoice(voice) - 1];
    if (list?.length && Object.getOwnPropertyDescriptor(measure, "events")?.get) return list;
    return ensureMeasureVoices(measure, score)[normalizeVoice(voice) - 1];
  }
  function syncMeasureEvents(measure) {
    // Compatibility shim: the nonenumerable accessor always reflects voices[0].
    return measure;
  }
  function measureEntries(measure, opt = {}) {
    const voices = ensureMeasureVoices(measure, opt.score);
    const activeVoice = opt.activeVoice ? normalizeVoice(opt.activeVoice) : null;
    const includeSilent = !!opt.includeSilent;
    const out = [];
    for (let v = 0; v < VOICE_COUNT; v++) {
      const evs = voices[v];
      const empty = voiceIsEmpty(evs);
      if (empty && !includeSilent && v > 0 && activeVoice !== v + 1) continue;
      if (empty && !includeSilent && v === 0 && activeVoice && activeVoice !== 1) {
        const anyOther = voices.some((list, i) => i > 0 && (!voiceIsEmpty(list) || activeVoice === i + 1));
        if (anyOther) continue;
      }
      let tick = Fraction.ZERO;
      for (let e = 0; e < evs.length; e++) {
        const ev = markEventVoice(evs[e], v + 1);
        out.push({ ev, e, voice: v + 1, tick });
        tick = tick.add(durValue(ev.dur));
      }
    }
    out.sort((a, b) => a.tick.cmp(b.tick) || a.voice - b.voice || a.e - b.e);
    return out;
  }
  function forEachEvent(score, fn, opt = {}) {
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        for (const entry of measureEntries(ref.measures[m], { score, includeSilent: opt.includeSilent, activeVoice: opt.activeVoice })) {
          fn(entry.ev, { ...ref, m, e: entry.e, ev: entry.ev, voice: entry.voice, tick: entry.tick });
        }
      }
    }
  }
  function emptyMeasures(score, count, fromM = 0) {
    const out = [];
    for (let i = 0; i < count; i++) out.push({ events: [fullRest(score, fromM + i)] });
    return out;
  }
  function ensureMeasureMeta(mm) {
    if (!mm) return mm;
    if (mm.startRepeat === undefined) mm.startRepeat = false;
    if (mm.endRepeat === undefined) mm.endRepeat = false;
    if (mm.repeatCount === undefined) mm.repeatCount = 2;
    if (mm.endingStart === undefined) mm.endingStart = null;
    if (mm.endingStop === undefined) mm.endingStop = false;
    if (mm.breakType === undefined) mm.breakType = null;
    if (mm.sectionName === undefined) mm.sectionName = "";
    if (mm.jump && !JUMP_TYPES.includes(mm.jump.type)) delete mm.jump;
    if (mm.jump) mm.jump.playRepeats = !!mm.jump.playRepeats;
    if (mm.marker != null && !MARKERS.includes(mm.marker)) delete mm.marker;
    syncMeasureEvents(mm);
    return mm;
  }
  function partTemplate(kind, opt = {}) {
    const lib = kind === "solo" ? {
      name: opt.name || (PART_LIBRARY[opt.instrument || "piano"]?.name || "악기"),
      shortName: opt.shortName || (PART_LIBRARY[opt.instrument || "piano"]?.shortName || "Inst."),
      group: "solo",
      instrument: opt.instrument || "piano",
      staves: [{ clef: opt.clef || "treble" }],
    } : (PART_LIBRARY[kind] || PART_LIBRARY.piano);
    const staves = opt.staves || lib.staves;
    const part = {
      id: newId(),
      kind,
      name: opt.name || lib.name,
      shortName: opt.shortName || lib.shortName,
      group: opt.group || lib.group,
      instrument: opt.instrument || lib.instrument,
      tuning: opt.tuning || lib.tuning ? [...(opt.tuning || lib.tuning)] : undefined,
      brace: opt.brace || lib.brace || null,
      ...(opt.transpose ? { transpose: cloneData(opt.transpose) } : {}),
      staves: staves.map((st, i) => ({
        id: newId(),
        name: st.name || "",
        clef: st.clef || "treble",
        staffType: st.staffType || "standard",
        instrumentType: st.instrumentType || lib.instrumentType || (lib.group === "percussion" ? "percussion" : "pitched"),
        staffIdx: i,
        measures: [],
      })),
    };
    if (part.staves.length === 2 && part.staves.some(st => st.staffType === "tab")) {
      part.staves[0].linkedStaffId = part.staves[1].id;
      part.staves[1].linkedStaffId = part.staves[0].id;
    }
    return part;
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
    const cache = cacheOf(score);
    if (cache.normalized) return score;
    delete cache.timing;
    if (!score.measures) score.measures = [];
    const count = Math.max(1, canonicalMeasures(score).length, ...(score.parts || []).flatMap(p => (p.staves || []).map(s => s.measures?.length || 0)));
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
          if (!staff.staffType) staff.staffType = "standard";
          if (!staff.instrumentType) staff.instrumentType = part.group === "percussion" || part.instrument === "drums" ? "percussion" : "pitched";
          if (!staff.measures || !staff.measures.length) staff.measures = emptyMeasures(score, count);
          while (staff.measures.length < count) staff.measures.push({ events: [fullRest(score, staff.measures.length)] });
          for (const [m, mm] of staff.measures.entries()) {
            ensureMeasureMeta(mm);
            ensureMeasureVoices(mm, score, m);
          }
        }
      }
    }
    // The legacy-only branch also needs voices and accessors immediately.
    for (const part of score.parts) for (const staff of part.staves)
      for (const [m, mm] of staff.measures.entries()) {
        measureOwners.set(mm, { score, m });
        if (!Object.getOwnPropertyDescriptor(mm, "events")?.get) ensureMeasureVoices(mm, score, m);
      }
    if (!score.spanners) score.spanners = [];
    if (!score.playbackSettings) score.playbackSettings = { swing: "off", mixer: {} };
    if (!score.playbackSettings.mixer) score.playbackSettings.mixer = {};
    if (!score.playbackSettings.swing) score.playbackSettings.swing = "off";
    for (const part of score.parts || []) {
      if (!score.playbackSettings.mixer[part.id]) {
        score.playbackSettings.mixer[part.id] = { mute: false, solo: false, volume: 1, pan: 0 };
      }
    }
    ensureLayout(score);
    ensureStyle(score);
    cache.normalized = true;
    delete cache.timing;
    return syncLegacyFields(score);
  }
  function forEachMeasureAt(score, mIdx, fn) {
    ensureParts(score);
    for (const ref of staffRefs(score)) {
      const mm = ref.measures[mIdx];
      if (mm) fn(ensureMeasureMeta(mm), ref);
    }
  }
  const JUMP_TYPES = ["DC", "DS", "DCalFine", "DSalFine", "DCalCoda", "DSalCoda"];
  const MARKERS = ["segno", "coda", "fine", "toCoda"];
  function setMeasureJump(score, m, value) {
    if (typeof value === "string") value = { type: value, playRepeats: false };
    if (value != null && !JUMP_TYPES.includes(value.type)) throw new RangeError("Invalid jump");
    forEachMeasureAt(score, m, mm => { if (value == null) delete mm.jump; else mm.jump = { type: value.type, playRepeats: !!value.playRepeats }; });
    edited(score);
  }
  function setMeasureMarker(score, m, value) {
    if (value != null && !MARKERS.includes(value)) throw new RangeError("Invalid marker");
    forEachMeasureAt(score, m, mm => { if (value == null) delete mm.marker; else mm.marker = value; });
    edited(score);
  }
  function toggleStartRepeat(score, mIdx) {
    const cur = !!ensureMeasureMeta(score.measures[mIdx] || {}).startRepeat;
    forEachMeasureAt(score, mIdx, mm => { mm.startRepeat = !cur; });
  }
  function toggleEndRepeat(score, mIdx) {
    const cur = !!ensureMeasureMeta(score.measures[mIdx] || {}).endRepeat;
    forEachMeasureAt(score, mIdx, mm => {
      mm.endRepeat = !cur;
      if (mm.endRepeat && (!mm.repeatCount || mm.repeatCount < 2)) mm.repeatCount = 2;
    });
  }
  function setRepeatCount(score, mIdx, count) {
    count = Math.max(2, Math.min(8, count | 0 || 2));
    forEachMeasureAt(score, mIdx, mm => { mm.endRepeat = true; mm.repeatCount = count; });
  }
  function clearEndings(score, fromM, toM) {
    for (let m = Math.max(0, fromM); m <= toM; m++)
      forEachMeasureAt(score, m, mm => { mm.endingStart = null; mm.endingStop = false; });
  }
  function setEnding(score, fromM, toM, label) {
    const maxM = Math.max(0, score.measures.length - 1);
    fromM = Math.max(0, Math.min(maxM, fromM | 0));
    toM = Math.max(fromM, Math.min(maxM, toM | 0));
    label = String(label || "1").trim().slice(0, 12) || "1";
    clearEndings(score, fromM, toM);
    forEachMeasureAt(score, fromM, mm => { mm.endingStart = label; });
    forEachMeasureAt(score, toM, mm => { mm.endingStop = true; });
  }
  function setMeasureBreak(score, mIdx, type, sectionName) {
    const maxM = Math.max(0, score.measures.length - 1);
    mIdx = Math.max(0, Math.min(maxM, mIdx | 0));
    const cleanType = ["system", "page", "section"].includes(type) ? type : null;
    forEachMeasureAt(score, mIdx, mm => {
      mm.breakType = cleanType;
      mm.sectionName = cleanType === "section" ? String(sectionName || mm.sectionName || "Section").trim().slice(0, 32) : "";
    });
  }
  function clearMeasureBreak(score, mIdx) {
    setMeasureBreak(score, mIdx, null, "");
  }
  function staffRefs(score) {
    ensureParts(score);
    const cache = cacheOf(score);
    if (cache.refs) return cache.refs;
    const refs = [];
    score.parts.forEach((part, partIdx) => {
      part.staves.forEach((staff, staffIdx) => refs.push({
        partIdx, staffIdx, globalIdx: refs.length,
        part, staff, measures: staff.measures,
        clef: staff.clef || "treble",
        staffType: staff.staffType || "standard",
        instrumentType: staff.instrumentType || part.instrumentType || (part.group === "percussion" ? "percussion" : "pitched"),
        instrument: part.instrument || score.instrument || "piano",
        name: part.name || "악기",
        shortName: part.shortName || part.name || "Inst.",
        brace: part.brace || (part.staves.length > 1 ? "brace" : null),
      }));
    });
    return (cache.refs = refs);
  }
  function isStaffEmpty(ref) {
    return ref.measures.every(mm => measureEntries(mm).every(({ ev }) => ev.type === "rest" && !ev.chordSymbol && !ev.tempo && !ev.rehearsal && !ev.staffText));
  }
  function visibleStaffRefs(score, viewMode, opt = {}) {
    const refs = staffRefs(score);
    let out = refs;
    if (viewMode && viewMode.type === "part" && typeof viewMode.partIdx === "number") {
      out = refs.filter(r => r.partIdx === viewMode.partIdx);
    } else if (opt.hideEmptyStaves) {
      const filtered = refs.filter(r => !isStaffEmpty(r));
      out = filtered.length ? filtered : refs.slice(0, 1);
    }
    return out.length ? out : refs.slice(0, 1);
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
  function activeClef(score, m = 0) { return clefAt(activeRef(score), m); }
  function isPercussionRef(ref) { return ref?.instrumentType === "percussion" || ref?.staff?.instrumentType === "percussion" || ref?.instrument === "drums"; }
  function ensembleKey(score) {
    ensureParts(score);
    if (score.parts.length === 1 && score.parts[0].staves.length === 2 && score.parts[0].instrument === "piano") return "piano";
    if (score.parts.length === 2 && score.parts[0].instrument === "flute" && score.parts[1].instrument === "piano" && score.parts[1].staves.length === 2) return "flute-piano";
    if (score.parts.length === 4 && score.parts.every(p => p.group === "strings")) return "string-quartet";
    if (score.parts.length === 1 && score.parts[0].instrument === "drums") return "drumkit";
    if (score.parts.length === 1 && score.parts[0].instrument === "guitar" && score.parts[0].staves.some(st => st.staffType === "tab")) return "guitar-tab";
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
    invalidate(score);
    return ensureParts(syncLegacyFields(score));
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
      playbackSettings: { swing: "off", mixer: {} },
      layout: { ...DEFAULT_LAYOUT },
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
    invalidate(score);
    return ensureParts(syncLegacyFields(score));
  }

  /* ---------------- 순회/조회 ---------------- */
  function eventStartTick(measure, eIdx, ctx) {
    const evs = getVoiceEvents(measure, ctx?.voice || 1);
    let t = Fraction.ZERO;
    for (let i = 0; i < eIdx; i++) t = t.add(durValue(evs[i].dur));
    return t;
  }
  function findEvent(score, id) {
    return eventIndex(score).get(id) || null;
  }
  function eventIndex(score) {
    ensureParts(score);
    const cache = cacheOf(score);
    if (cache.index) return cache.index;
    const index = new Map(), order = new Map();
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        for (const entry of measureEntries(ref.measures[m], { score, includeSilent: true })) {
          index.set(entry.ev.id, { ...ref, m, ...entry });
          order.set(entry.ev.id, order.size);
        }
      }
    }
    cache.index = index; cache.order = order;
    return index;
  }
  function nextEvent(score, m, e, ctx) {
    const ref = staffRef(score, ctx);
    const measures = staffMeasures(score, ctx);
    const voice = voiceFromCtx(ctx);
    const evs = measures[m] ? getVoiceEvents(measures[m], voice, score) : [];
    if (e + 1 < evs.length) return { ...ref, m, e: e + 1, voice, ev: evs[e + 1] };
    for (let mm = m + 1; mm < measures.length; mm++)
      if (getVoiceEvents(measures[mm], voice, score).length) return { ...ref, m: mm, e: 0, voice, ev: getVoiceEvents(measures[mm], voice, score)[0] };
    return null;
  }
  function prevEvent(score, m, e, ctx) {
    const ref = staffRef(score, ctx);
    const measures = staffMeasures(score, ctx);
    const voice = voiceFromCtx(ctx);
    const curEvs = measures[m] ? getVoiceEvents(measures[m], voice, score) : [];
    if (e - 1 >= 0) return { ...ref, m, e: e - 1, voice, ev: curEvs[e - 1] };
    for (let mm = m - 1; mm >= 0; mm--) {
      const evs = getVoiceEvents(measures[mm], voice, score);
      if (evs.length) return { ...ref, m: mm, e: evs.length - 1, voice, ev: evs[evs.length - 1] };
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
    if (!measure) throw new RangeError("Measure does not exist");
    start = Fraction.from(start); len = Fraction.from(len);
    if (start.n < 0 || len.n < 0 || start.add(len).gt(measureLenAt(score, mIdx))) throw new RangeError("Replacement exceeds measure");
    if (len.isZero()) return;
    const voice = voiceFromCtx(ctx);
    const evs = getVoiceEvents(measure, voice, score);
    const replacement = makeEvents().map(ev => markEventVoice(ev, voice));
    if (replacement.some(ev => durValue(ev.dur).n <= 0) ||
        !replacement.reduce((sum, ev) => sum.add(durValue(ev.dur)), Fraction.ZERO).eq(len)) throw new RangeError("Replacement duration mismatch");
    const out = [];
    let pos = Fraction.ZERO;
    const end = start.add(len);
    let inserted = false;
    for (const ev of evs) {
      const evLen = durValue(ev.dur);
      const evEnd = pos.add(evLen);
      if (evEnd.lte(start) || pos.gte(end)) {
        out.push(ev); // 범위 밖 → 유지
      } else {
        // 범위와 겹침 → 제거. 머리/꼬리가 남으면 쉼표로 채움
        if (pos.lt(start)) {
          for (const d of decompose(pos, start.sub(pos)))
            out.push(markEventVoice({ id: newId(), type: "rest", dur: d, notes: [] }, voice));
        }
        if (!inserted) { out.push(...replacement); inserted = true; }
        if (evEnd.gt(end)) {
          for (const d of decompose(end, evEnd.sub(end)))
            out.push(markEventVoice({ id: newId(), type: "rest", dur: d, notes: [] }, voice));
        }
      }
      pos = evEnd;
    }
    if (!inserted) out.push(...replacement); // 빈 마디 안전망
    measure.voices[voice - 1] = out;
    syncMeasureEvents(measure);
    edited(score);
  }

  /* 음표/쉼표 입력. 마디를 넘으면 다음 마디로 타이 분할. 입력된 첫 이벤트 ref 반환 */
  function inputAt(score, mIdx, tick, dur, pitches /* null=쉼표 */, ctx) {
    const ref = staffRef(score, ctx);
    const voice = voiceFromCtx(ctx);
    let remaining = durValue(dur);
    if (remaining.n <= 0) throw new RangeError("Duration must be positive");
    let firstId = null;

    const place = (m, t, pieces, tieOut) => {
      const evs = pieces.map((d, i) => {
        const ev = {
          id: newId(),
          type: pitches ? "note" : "rest",
          voice,
          dur: d,
          notes: pitches ? pitches.map(p => ({ step: p.step, alter: p.alter, oct: p.oct, tie: false })) : [],
        };
        if (pitches && (i < pieces.length - 1 || tieOut)) ev.notes.forEach(n => n.tie = true);
        if (!firstId) firstId = ev.id;
        return ev;
      });
      replaceRange(score, m, t, pieces.reduce((a, d) => a.add(durValue(d)), Fraction.ZERO), () => evs, { ...ref, voice });
    };

    let m = mIdx;
    let t = Fraction.from(tick);
    if (t.n < 0 || mIdx < 0) throw new RangeError("Invalid input position");
    let firstChunk = true;
    while (remaining.gt(Fraction.ZERO) && m < ref.measures.length) {
      const L = measureLenAt(score, m);
      const room = L.sub(t);
      if (room.lte(Fraction.ZERO)) { m++; t = Fraction.ZERO; continue; }
      const take = remaining.gt(room) ? room : remaining;
      const pieces = firstChunk && take.eq(remaining) ? [Object.assign({}, dur)] : decompose(t, take);
      const tieOut = !!pitches && remaining.gt(take) && m + 1 < ref.measures.length;
      const keepFirst = firstId;
      place(m, t, pieces, tieOut);
      if (keepFirst) firstId = keepFirst;
      remaining = remaining.sub(take);
      m++;
      t = Fraction.ZERO;
      firstChunk = false;
    }
    normalizeTies(score);
    return firstId;
  }

  /** Re-enter an event at its original location, preserving its decorations and
   * spanner anchors. Returns the first replacement ID, or null for a stale ref. */
  function reinputWithDur(score, found, newDur) {
    found = typeof found === "string" ? findEvent(score, found) : found && findEvent(score, found.ev?.id || found.id);
    if (!found) return null;
    const source = cloneData(found.ev), start = eventStartTick(found.measures[found.m], found.e, found);
    const boundaries = measureStarts(score), end = boundaries[found.m].add(start).add(durValue(newDur));
    if (end.gt(boundaries[boundaries.length - 1])) {
      const ts = timeSigAt(score, boundaries.length - 2);
      const extra = end.sub(boundaries[boundaries.length - 1]).div(F(ts.num, ts.den));
      appendMeasures(score, Math.floor((extra.n + extra.d - 1) / extra.d));
    }
    const id = inputAt(score, found.m, start, newDur, source.type === "note" ? source.notes : null, found);
    if (!id) return null;
    let current = findEvent(score, id), remaining = durValue(newDur), lastId = id, first = true;
    while (current && remaining.n > 0) {
      if (first) copyDecor(source, current.ev);
      else for (const key of CONTINUATION_DECOR_KEYS) if (source[key] !== undefined) current.ev[key] = cloneData(source[key]);
      remaining = remaining.sub(durValue(current.ev.dur));
      lastId = current.ev.id;
      if (remaining.n <= 0 && source.type === "note") current.ev.notes.forEach((n, i) => { n.tie = !!source.notes[i]?.tie; });
      current = remaining.n > 0 ? nextEvent(score, current.m, current.e, current) : null;
      first = false;
    }
    for (const sp of score.spanners || []) {
      if (sp.startId === source.id) sp.startId = id;
      if (sp.endId === source.id) sp.endId = lastId;
    }
    normalizeTies(score);
    return id;
  }

  function removeNoteFromChord(score, id, idx) {
    const found = findEvent(score, id);
    if (!found || found.ev.type !== "note" || !Number.isInteger(idx) || !found.ev.notes[idx]) return false;
    if (found.ev.notes.length === 1) deleteEvent(score, found.m, found.e, found);
    else { found.ev.notes.splice(idx, 1); normalizeTies(score); }
    return true;
  }
  function transposeNote(score, id, idx, semis) {
    const found = findEvent(score, id);
    if (!found || found.ev.type !== "note" || !Number.isInteger(idx) || !found.ev.notes[idx] || !Number.isInteger(semis)) return null;
    const note = found.ev.notes[idx];
    Object.assign(note, transposePitch(note, semis, keySigAt(score, found.m)));
    found.ev.notes.sort((a, b) => absStep(a) - absStep(b) || a.alter - b.alter);
    normalizeTies(score);
    return found.ev.notes.indexOf(note);
  }
  function setNoteAccidental(score, id, idx, alter) {
    const found = findEvent(score, id);
    if (!found || !found.ev.notes[idx] || !Number.isInteger(alter) || Math.abs(alter) > 2) return false;
    found.ev.notes[idx].alter = alter;
    normalizeTies(score);
    return true;
  }
  function toggleNoteTie(score, id, idx) {
    const found = findEvent(score, id), note = found?.ev.notes[idx];
    if (!note) return false;
    const nx = nextEvent(score, found.m, found.e, found);
    note.tie = !note.tie && !!nx?.ev.notes.some(n => pitchEq(n, note));
    return note.tie;
  }

  function addDrumNote(score, mIdx, tick, drumId, dur, ctx) {
    const spec = drumSpec(drumId);
    const pitch = spellMidi(spec.midi, 0);
    const firstId = inputAt(score, mIdx, tick, dur, [pitch], ctx);
    const found = firstId ? findEvent(score, firstId) : findEventAtVoiceTick(score, mIdx, tick, ctx);
    if (found && found.ev.type === "note") {
      found.ev.drumId = drumId;
      found.ev.midi = spec.midi;
      found.ev.staffLine = spec.staffLine;
      found.ev.notehead = spec.notehead;
      found.ev.displayStep = spec.displayStep;
      found.ev.displayOctave = spec.displayOctave;
      found.ev.notes = [{ ...pitch, tie: false }];
    }
    return firstId;
  }
  function findEventAtVoiceTick(score, mIdx, tick, ctx) {
    const ref = staffRef(score, ctx);
    const voice = voiceFromCtx(ctx);
    const evs = getVoiceEvents(ref.measures[mIdx], voice, score);
    let t = Fraction.ZERO;
    for (let e = 0; e < evs.length; e++) {
      const ev = evs[e];
      const end = t.add(durValue(ev.dur));
      if (tick.gte(t) && tick.lt(end)) return { ...ref, m: mIdx, e, voice, ev };
      t = end;
    }
    return null;
  }

  /* 이벤트 삭제 → 같은 길이의 쉼표 */
  function deleteEvent(score, mIdx, eIdx, ctx) {
    const measure = staffMeasures(score, ctx)[mIdx];
    const voice = voiceFromCtx(ctx);
    const evs = getVoiceEvents(measure, voice, score);
    const ev = evs[eIdx];
    if (!ev) return;
    const start = eventStartTick(measure, eIdx, { voice });
    const len = durValue(ev.dur);
    replaceRange(score, mIdx, start, len, () =>
      decompose(start, len).map(d => ({ id: newId(), type: "rest", dur: d, notes: [] })), { ...ctx, voice });
    consolidateRests(score, mIdx, ctx);
    normalizeTies(score);
  }

  function makeTupletAt(score, mIdx, eIdx, actual, ctx) {
    actual = Math.max(2, Math.min(9, actual | 0));
    const measure = staffMeasures(score, ctx)[mIdx];
    const voice = voiceFromCtx(ctx);
    const evs = getVoiceEvents(measure, voice, score);
    const ev = evs[eIdx];
    if (!ev || ev.full || ev.dur.tuplet) return null;
    const start = eventStartTick(measure, eIdx, { voice });
    const totalLen = durValue(ev.dur);
    const written = tupletWrittenDur(ev.dur, actual);
    const tuplet = tupletMeta(actual);
    const ids = [];
    const make = () => Array.from({ length: actual }, (_, i) => {
      const next = {
        id: newId(),
        type: ev.type,
        voice,
        dur: { ...written, tuplet: { ...tuplet } },
        notes: ev.type === "note" ? ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct, tie: false })) : [],
      };
      if (i === 0) copyDecor(ev, next);
      else for (const key of CONTINUATION_DECOR_KEYS) if (ev[key] !== undefined) next[key] = cloneData(ev[key]);
      ids.push(next.id);
      return next;
    });
    replaceRange(score, mIdx, start, totalLen, make, { ...ctx, voice });
    normalizeTies(score);
    return ids;
  }

  /* 연속 쉼표 정리: 쉼표 구간을 다시 분해해 깔끔하게, 마디 전체가 쉼표면 온쉼표 1개 */
  function consolidateRests(score, mIdx, ctx) {
    const measure = staffMeasures(score, ctx)[mIdx];
    const voice = voiceFromCtx(ctx);
    const evs = getVoiceEvents(measure, voice, score);
    const remapAnchors = (oldEvents, newEvents) => {
      const ids = new Set(oldEvents.map(ev => ev.id));
      for (const sp of score.spanners || []) {
        if (ids.has(sp.startId)) sp.startId = newEvents[0].id;
        if (ids.has(sp.endId)) sp.endId = newEvents[newEvents.length - 1].id;
      }
    };
    if (evs.every(e => e.type === "rest" && !hasVisibleContent(e))) {
      // Keep a pre-existing full-rest ID (spanners may use it as an anchor).
      if (evs.length === 1 && evs[0].full && durValue(evs[0].dur).eq(measureLenAt(score, mIdx))) return;
      const rest = markEventVoice(fullRest(score, mIdx), voice);
      if (evs[0]) rest.id = evs[0].id;
      measure.voices[voice - 1] = [rest];
      remapAnchors(evs, [rest]);
      syncMeasureEvents(measure);
      edited(score);
      return;
    }
    const out = [];
    let pos = Fraction.ZERO, runStart = null, runLen = Fraction.ZERO, runEvents = [];
    const flush = () => {
      if (runStart !== null) {
        const rests = decompose(runStart, runLen).map((dur, i) => markEventVoice({ id: i === 0 ? runEvents[0].id : newId(), type: "rest", dur, notes: [] }, voice));
        out.push(...rests); remapAnchors(runEvents, rests);
        runStart = null; runLen = Fraction.ZERO; runEvents = [];
      }
    };
    for (const ev of evs) {
      const len = durValue(ev.dur);
      if (ev.type === "rest" && !hasVisibleContent(ev)) {
        if (runStart === null) runStart = pos;
        runLen = runLen.add(len);
        runEvents.push(ev);
      } else { flush(); out.push(ev); }
      pos = pos.add(len);
    }
    flush();
    measure.voices[voice - 1] = out.map(ev => markEventVoice(ev, voice));
    syncMeasureEvents(measure);
    edited(score);
  }

  /* 타이 정합성: 다음 이벤트에 같은 음높이가 없으면 tie 해제 */
  function normalizeTies(score) {
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        for (let voice = 1; voice <= VOICE_COUNT; voice++) {
          const evs = getVoiceEvents(ref.measures[m], voice, score);
          for (let e = 0; e < evs.length; e++) {
            const ev = evs[e];
            if (ev.type !== "note") continue;
            const nx = nextEvent(score, m, e, { ...ref, voice });
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
  }

  /* 직전 이벤트로부터 타이로 이어져 들어온 음인지 */
  function isTiedFrom(score, m, e, note, ctx) {
    const pv = prevEvent(score, m, e, ctx);
    return !!(pv && pv.ev.type === "note" && pv.ev.notes.some(n => n.tie && pitchEq(n, note)));
  }

  /* ---------------- 스패너(슬러/헤어핀) ---------------- */
  /* 모든 이벤트 id → 전체 순서 인덱스 */
  function eventOrderMap(score) {
    eventIndex(score);
    return cacheOf(score).order;
  }

  /* 앵커가 사라졌거나 순서가 뒤집힌 스패너 제거. 슬러는 양 끝이 음표여야 한다 */
  function normalizeSpanners(score) {
    if (!score.spanners?.length) { score.spanners = []; return; }
    const order = eventOrderMap(score);
    score.spanners = score.spanners.filter(sp => {
      if (!order.has(sp.startId) || !order.has(sp.endId)) return false;
      if (order.get(sp.startId) > order.get(sp.endId)) return false;
      if (sp.type === "slur") {
        const a = findEvent(score, sp.startId), b = findEvent(score, sp.endId);
        if (!a || !b || a.ev.type !== "note" || b.ev.type !== "note") return false;
        if (sp.startId === sp.endId) return false;
      }
      if (sp.type === "ottava") {
        const a = findEvent(score, sp.startId), b = findEvent(score, sp.endId);
        if (![12, -12].includes(sp.shift) || !a || !b || a.globalIdx !== b.globalIdx || a.voice !== b.voice) return false;
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
  /** Inclusive, same-staff/voice ottava range. Stored pitches are unchanged. */
  function addOttava(score, startId, endId, shift = 12) {
    const a = findEvent(score, startId), b = findEvent(score, endId), order = eventOrderMap(score);
    if (!a || !b || a.globalIdx !== b.globalIdx || a.voice !== b.voice || ![12, -12].includes(shift)) return null;
    if (order.get(startId) > order.get(endId)) [startId, endId] = [endId, startId];
    const sp = { id: newId(), type: "ottava", startId, endId, shift };
    score.spanners.push(sp);
    return sp.id;
  }
  function ottavaShiftAt(score, id) {
    const found = findEvent(score, id);
    if (!found) return 0;
    const order = eventOrderMap(score), position = order.get(id);
    let shift = 0;
    for (const sp of score.spanners || []) {
      if (sp.type !== "ottava" || ![12, -12].includes(sp.shift)) continue;
      const a = findEvent(score, sp.startId), b = findEvent(score, sp.endId);
      if (a?.globalIdx === found.globalIdx && b?.globalIdx === found.globalIdx && a.voice === found.voice && b.voice === found.voice &&
          position >= order.get(sp.startId) && position <= order.get(sp.endId)) shift += sp.shift;
    }
    return shift;
  }

  /* ---------------- 박자표 변경: 모든 내용을 새 마디 길이로 다시 붓기 ---------------- */
  const END_MEASURE_KEYS = ["endRepeat", "repeatCount", "endingStop", "breakType", "sectionName", "jump"];
  function measureMetadata(mm, end = false) {
    const out = {};
    for (const [key, value] of Object.entries(mm)) {
      const atEnd = END_MEASURE_KEYS.includes(key) || (key === "marker" && ["fine", "toCoda"].includes(value));
      if (["events", "voices", "length", "pickup"].includes(key) || atEnd !== end) continue;
      if (value == null || value === false || value === "" || (key === "repeatCount" && !mm.endRepeat)) continue;
      out[key] = cloneData(value);
    }
    return out;
  }
  function eventFragment(source, dur, first, last, voice) {
    const ev = first ? cloneData(source) : stripDecor(source);
    ev.id = first ? source.id : newId();
    ev.dur = cloneData(dur); ev.voice = voice;
    delete ev.full;
    if (first) copyDecor(source, ev);
    else for (const key of CONTINUATION_DECOR_KEYS) if (source[key] !== undefined) ev[key] = cloneData(source[key]);
    ev.notes = (source.notes || []).map(n => ({ ...n, tie: source.type === "note" && (!last || !!n.tie) }));
    return ev;
  }
  /* Reflow a contiguous range through exact lengths, retaining each source ID
   * on its first fragment and moving spanner end anchors to its last fragment. */
  function reflowMeasures(score, fromM, count, lengths, metadataFor) {
    const refs = staffRefs(score), anchors = new Map();
    const replacements = refs.map(ref => {
      const measures = lengths.map((length, i) => ({ ...metadataFor(ref, i), voices: Array.from({ length: VOICE_COUNT }, () => []) }));
      for (let voice = 1; voice <= VOICE_COUNT; voice++) {
        const items = ref.measures.slice(fromM, fromM + count).flatMap(mm => getVoiceEvents(mm, voice, score));
        let m = 0, tick = Fraction.ZERO;
        for (const source of items) {
          let remain = durValue(source.dur), first = true;
          while (remain.n > 0) {
            if (m >= lengths.length) throw new RangeError("Reflow would discard events");
            const room = lengths[m].sub(tick), take = remain.lte(room) ? remain : room;
            const pieces = first && take.eq(remain) ? [source.dur] : decompose(tick, take);
            for (const [i, dur] of pieces.entries()) {
              const last = remain.eq(take) && i === pieces.length - 1;
              const ev = eventFragment(source, dur, first, last, voice);
              measures[m].voices[voice - 1].push(ev);
              const anchor = anchors.get(source.id) || { first: ev.id };
              anchor.last = ev.id; anchors.set(source.id, anchor);
              first = false;
              tick = tick.add(durValue(dur));
            }
            remain = remain.sub(take);
            if (tick.eq(lengths[m])) { m++; tick = Fraction.ZERO; }
          }
        }
        while (m < lengths.length) {
          const room = lengths[m].sub(tick);
          for (const dur of decompose(tick, room)) measures[m].voices[voice - 1].push({ id: newId(), type: "rest", voice, dur, notes: [] });
          m++; tick = Fraction.ZERO;
        }
      }
      return measures;
    });
    refs.forEach((ref, i) => ref.staff.measures.splice(fromM, count, ...replacements[i]));
    syncLegacyFields(score); invalidate(score); ensureParts(score);
    for (const sp of score.spanners || []) {
      if (anchors.has(sp.startId)) sp.startId = anchors.get(sp.startId).first;
      if (anchors.has(sp.endId)) sp.endId = anchors.get(sp.endId).last;
    }
    for (const ref of staffRefs(score)) for (let m = fromM; m < fromM + lengths.length; m++)
      for (let voice = 1; voice <= VOICE_COUNT; voice++) consolidateRests(score, m, { ...ref, voice });
    normalizeTies(score); normalizeSpanners(score);
    return lengths.length;
  }

  /** rebar(score, newTs, fromM=0): earlier measures are untouched. Later
   * signatures and annotated boundaries retain their absolute musical times;
   * an off-grid boundary gets an exact optional measure.length, never rounding.
   * null removes the explicit time change at fromM. Final padding is rests. */
  function rebar(score, newTs, fromM = 0, opt = {}) {
    ensureParts(score);
    const refs = staffRefs(score), original = canonicalMeasures(score);
    if (!Number.isInteger(fromM) || fromM < 0 || fromM >= original.length) return false;
    const ts = newTs == null ? (fromM ? timeSigAt(score, fromM - 1) : score.timeSig) : validTimeSig(newTs);
    const starts = measureStarts(score), origin = starts[fromM], total = starts[starts.length - 1].sub(origin);
    const startMaps = new Map(), endMaps = new Map(), boundaries = new Map(), meters = new Map(), custom = new Map();
    const addBoundary = value => { if (value.n > 0) boundaries.set(value.toString(), value); };
    for (const ref of refs) {
      const begin = new Map(), end = new Map();
      for (let m = fromM; m < original.length; m++) {
        const a = starts[m].sub(origin), b = starts[m + 1].sub(origin), mm = ref.measures[m];
        const head = measureMetadata(mm), tail = measureMetadata(mm, true);
        if (m === fromM) delete head.timeSig;
        if (Object.keys(head).length) { begin.set(a.toString(), head); addBoundary(a); }
        if (Object.keys(tail).length) { end.set(b.toString(), tail); addBoundary(b); }
      }
      startMaps.set(ref.staff, begin); endMaps.set(ref.staff, end);
    }
    for (let m = fromM; m < original.length; m++) {
      const a = starts[m].sub(origin), mm = original[m];
      if (m > fromM && mm.timeSig) { meters.set(a.toString(), mm.timeSig); addBoundary(a); }
      if (mm.length != null || (m === 0 && mm.pickup != null)) {
        custom.set(a.toString(), measureLenAt(score, m)); addBoundary(a); addBoundary(starts[m + 1].sub(origin));
      }
    }
    if (Object.prototype.hasOwnProperty.call(opt, "pickup")) {
      custom.delete("0/1");
      // The old pickup's end is no longer a required boundary unless annotated.
      if (original[0].pickup != null) boundaries.delete(starts[1].sub(origin).toString());
      if (opt.pickup != null) custom.set("0/1", positiveFraction(opt.pickup));
    }
    const sorted = [...boundaries.values()].sort((a, b) => a.cmp(b));
    const lengths = [], positions = [Fraction.ZERO];
    let pos = Fraction.ZERO, currentTs = ts, boundaryIdx = 0;
    while (pos.lt(total)) {
      if (meters.has(pos.toString())) currentTs = meters.get(pos.toString());
      let len = custom.get(pos.toString()) || F(currentTs.num, currentTs.den);
      while (boundaryIdx < sorted.length && sorted[boundaryIdx].lte(pos)) boundaryIdx++;
      const boundary = sorted[boundaryIdx];
      if (boundary && boundary.lt(pos.add(len))) len = boundary.sub(pos);
      lengths.push(len); pos = pos.add(len); positions.push(pos);
    }
    if (fromM === 0 && newTs != null) score.timeSig = { ...ts };
    let inherited = ts;
    const effective = positions.slice(0, -1).map(p => { if (meters.has(p.toString())) inherited = meters.get(p.toString()); return inherited; });
    const result = reflowMeasures(score, fromM, original.length - fromM, lengths, (ref, i) => {
      const head = cloneData(startMaps.get(ref.staff).get(positions[i].toString()) || {});
      Object.assign(head, cloneData(endMaps.get(ref.staff).get(positions[i + 1].toString()) || {}));
      if (i === 0 && fromM > 0 && newTs != null) head.timeSig = { ...ts };
      if (!lengths[i].eq(F(effective[i].num, effective[i].den))) head.length = lengths[i].toJSON();
      const pickup = Object.prototype.hasOwnProperty.call(opt, "pickup") ? opt.pickup : original[0]?.pickup;
      if (fromM === 0 && i === 0 && pickup != null) { head.pickup = lengths[0].toJSON(); delete head.length; }
      return head;
    });
    return result;
  }

  function insertMeasures(score, atIdx, count = 1) {
    ensureParts(score);
    count = Math.max(0, Math.floor(count));
    atIdx = Math.max(0, Math.min(canonicalMeasures(score).length, Math.floor(atIdx)));
    if (!Number.isFinite(count) || !Number.isFinite(atIdx) || !count) return 0;
    const ts = atIdx ? timeSigAt(score, atIdx - 1) : score.timeSig;
    const len = F(ts.num, ts.den);
    for (const ref of staffRefs(score)) {
      if (atIdx === 0 && ref.measures[0].pickup != null) { ref.measures[0].length = cloneData(ref.measures[0].pickup); delete ref.measures[0].pickup; }
      const empty = Array.from({ length: count }, () => ({ voices: Array.from({ length: VOICE_COUNT }, (_, v) => [
        { id: newId(), type: "rest", voice: v + 1, dur: { n: len.n, d: len.d, dots: 0 }, notes: [], full: true },
      ]) }));
      ref.measures.splice(atIdx, 0, ...empty);
    }
    invalidate(score); ensureParts(score); normalizeTies(score);
    return count;
  }
  function appendMeasures(score, count = 1) { ensureParts(score); return insertMeasures(score, canonicalMeasures(score).length, count); }
  function removeLastMeasure(score) { ensureParts(score); const m = canonicalMeasures(score).length - 1; return m > 0 ? deleteMeasures(score, m, m) : 0; }
  /** Inclusive deletion, retaining the effective signatures at the survivor. */
  function deleteMeasures(score, fromIdx, toIdx = fromIdx) {
    ensureParts(score);
    const refs = staffRefs(score), n = canonicalMeasures(score).length;
    if (!Number.isInteger(fromIdx) || !Number.isInteger(toIdx) || fromIdx > toIdx || toIdx < 0 || fromIdx >= n) return 0;
    const from = Math.max(0, fromIdx), to = Math.min(n - 1, toIdx), count = to - from + 1;
    const nextTs = timeSigAt(score, to + 1), nextKey = keySigAt(score, to + 1);
    const nextClefs = refs.map(ref => clefAt(ref, to + 1));
    for (const ref of refs) ref.measures.splice(from, count);
    if (count === n) for (const ref of refs) ref.measures.push({ events: [fullRest({ timeSig: score.timeSig })] });
    syncLegacyFields(score); invalidate(score); ensureParts(score);
    if (to + 1 < n) {
      if (JSON.stringify(timeSigAt(score, from)) !== JSON.stringify(nextTs)) for (const ref of refs) ref.measures[from].timeSig = { ...nextTs };
      if (keySigAt(score, from) !== nextKey) for (const ref of refs) ref.measures[from].keySig = nextKey;
      refs.forEach((ref, i) => { if (clefAt(ref, from) !== nextClefs[i]) ref.measures[from].clef = nextClefs[i]; });
    }
    edited(score); normalizeTies(score); normalizeSpanners(score);
    return count;
  }
  function splitMeasureAt(score, mIdx, tick) {
    ensureParts(score); tick = Fraction.from(tick);
    if (!canonicalMeasures(score)[mIdx]) return false;
    const len = measureLenAt(score, mIdx);
    if (tick.n <= 0 || tick.gte(len)) throw new RangeError("Split must be inside the measure");
    const lengths = [tick, len.sub(tick)], hadPickup = mIdx === 0 && canonicalMeasures(score)[0].pickup != null;
    reflowMeasures(score, mIdx, 1, lengths, (ref, i) => {
      const mm = ref.measures[mIdx], out = i === 0 ? measureMetadata(mm) : measureMetadata(mm, true);
      if (i === 0 && hadPickup) out.pickup = lengths[i].toJSON(); else out.length = lengths[i].toJSON();
      return out;
    });
    return true;
  }
  function joinMeasures(score, mIdx) {
    ensureParts(score);
    if (!canonicalMeasures(score)[mIdx + 1]) return false;
    for (const ref of staffRefs(score)) {
      if (Object.keys(measureMetadata(ref.measures[mIdx], true)).length || Object.keys(measureMetadata(ref.measures[mIdx + 1])).length)
        throw new RangeError("Cannot join across a signature, repeat, or annotated boundary");
    }
    const len = measureLenAt(score, mIdx).add(measureLenAt(score, mIdx + 1));
    const hadPickup = mIdx === 0 && canonicalMeasures(score)[0].pickup != null;
    reflowMeasures(score, mIdx, 2, [len], ref => ({
      ...measureMetadata(ref.measures[mIdx]), ...measureMetadata(ref.measures[mIdx + 1], true),
      [hadPickup ? "pickup" : "length"]: len.toJSON(),
    }));
    return true;
  }
  /** Set/remove the first measure's exact pickup length, shifting following
   * music without dropping notes. null restores a normal first measure. */
  function setPickup(score, value) {
    ensureParts(score);
    const ts = timeSigAt(score, 0);
    if (value != null && positiveFraction(value).gt(F(ts.num, ts.den))) throw new RangeError("Pickup exceeds time signature");
    return rebar(score, ts, 0, { pickup: value });
  }

  /* ---------------- 전체 조옮김 ---------------- */
  function transposeScore(score, semitones) {
    if (!Number.isInteger(semitones) || Math.abs(semitones) > 48) throw new RangeError("Invalid transposition");
    if (!semitones) return;
    const oldKey = score.keySig || 0;
    const transposeKey = key => {
      let f = key + 7 * semitones;
      while (f > 7) f -= 12;
      while (f < -7) f += 12;
      if (f === 7 && key <= 0) f = -5;
      if (f === -7 && key >= 0) f = 5;
      return f;
    };
    const newKey = transposeKey(oldKey);
    // Preserve the interval's letter distance, including E#/Cb and double
    // accidentals, instead of respelling every altered note independently.
    const tonicStep = key => ((key * 4) % 7 + 7) % 7;
    let diatonic = (tonicStep(newKey) - tonicStep(oldKey) + 7) % 7;
    if (semitones < 0 && diatonic) diatonic -= 7;
    diatonic += Math.trunc(semitones / 12) * 7;
    const transposeSpelled = pitch => {
      const midi = midiOf(pitch) + semitones;
      if (midi < 0 || midi > 127) throw new RangeError("Transposition exceeds MIDI pitch range");
      const target = absStep(pitch) + diatonic;
      const step = ((target % 7) + 7) % 7, oct = Math.floor(target / 7);
      const alter = midi - ((oct + 1) * 12 + STEP_SEMIS[step]);
      return Math.abs(alter) <= 2 ? { step, oct, alter } : spellMidi(midi, newKey, semitones > 0 ? "sharp" : "flat");
    };
    const transposeChord = chord => {
      const parsed = cloneChordSymbol(chord);
      if (!parsed?.root) return parsed;
      const move = (letter, alter) => transposeSpelled({ step: STEP_EN.indexOf(letter), alter, oct: 4 });
      const root = move(parsed.root, parsed.rootAlter);
      let text = STEP_EN[root.step] + chordAlterText(root.alter, false) + parsed.quality;
      if (parsed.bass) {
        const bass = move(parsed.bass, parsed.bassAlter);
        text += "/" + STEP_EN[bass.step] + chordAlterText(bass.alter, false);
      }
      return parseChordSymbol(text);
    };
    score.keySig = newKey;
    for (const ref of staffRefs(score)) for (const measure of ref.measures)
      if (measure.keySig != null) measure.keySig = transposeKey(measure.keySig);
    edited(score);
    for (const ref of staffRefs(score)) {
      if (ref.staffType === "tab" && ref.staff.linkedStaffId) continue;
      for (const measure of ref.measures) for (const { ev } of measureEntries(measure, { score, includeSilent: true })) {
        if (ev.type === "note" && !isPercussionRef(ref)) {
          ev.notes = ev.notes.map(n => ({ ...n, ...transposeSpelled(n) }));
          for (const grace of ev.graceBefore || []) grace.notes = grace.notes.map(n => ({ ...n, ...transposeSpelled(n) }));
          if (ev.tab) applyTabToEvent(ev, ref.part);
        }
        if (ev.chordSymbol) {
          ev.chordSymbol = transposeChord(ev.chordSymbol);
          if (ev.fretboard) {
            const diagram = getDefaultFretboard(ev.chordSymbol);
            if (diagram) ev.fretboard = diagram; else delete ev.fretboard;
          }
        }
      }
    }
    syncLinkedTab(score);
    normalizeTies(score);
  }

  // Linked TAB is a derived view. Only the standard staff is written to disk.
  // At transaction boundaries a TAB-only edit is folded back into that source.
  function linkedTabBaseline(score) {
    const baseline = new Map();
    for (const part of score.parts || []) for (const tab of part.staves || []) {
      const source = tab.staffType === "tab" && part.staves.find(st => st.id === (tab.derivedFrom || tab.linkedStaffId) && st.staffType !== "tab");
      if (source) baseline.set(tab.id, { source: JSON.stringify(source.measures), tab: JSON.stringify(tab.measures) });
    }
    return baseline;
  }
  function syncLinkedTab(score, previous) {
    ensureParts(score);
    let changed = false;
    for (const part of score.parts) for (const tab of part.staves) {
      const source = tab.staffType === "tab" && part.staves.find(st => st.id === (tab.derivedFrom || tab.linkedStaffId) && st.staffType !== "tab");
      if (!source) continue;
      const prior = previous?.get?.(tab.id);
      if (prior && prior.source === JSON.stringify(source.measures) && prior.tab !== JSON.stringify(tab.measures)) {
        source.measures = tab.measures.map(mm => {
          const out = cloneData(mm);
          out.voices = mm.voices.map(list => list.map(ev => {
            const next = cloneData(ev);
            next.id = ev.__linkedSourceId || ev.id;
            delete next.__linkedSourceId;
            if (next.type === "note" && next.tab) applyTabToEvent(next, part);
            return next;
          }));
          return out;
        });
      }
      tab.derivedFrom = source.id;
      const derived = source.measures.map((mm, m) => {
        const out = cloneData(mm);
        delete out.clef;
        out.voices = mm.voices.map(list => list.map(ev => {
          const next = cloneData(ev);
          next.id = ev.id + "-tab-" + tab.id;
          Object.defineProperty(next, "__linkedSourceId", { value: ev.id, enumerable: false });
          if (next.type === "note") applyTabToEvent(next, part);
          return next;
        }));
        ensureMeasureVoices(out, score, m);
        return out;
      });
      if (JSON.stringify(tab.measures) !== JSON.stringify(derived)) { tab.measures = derived; changed = true; }
    }
    if (changed) { invalidate(score); ensureParts(score); }
    return score;
  }

  function deleteEvents(score, ids) {
    const selected = new Set(ids), touched = [];
    if (!selected.size) return 0;
    let count = 0;
    for (const ref of staffRefs(score)) for (const [m, mm] of ref.measures.entries()) {
      for (let v = 0; v < VOICE_COUNT; v++) {
        let changed = false;
        mm.voices[v] = mm.voices[v].map(ev => {
          if (!selected.has(ev.id)) return ev;
          changed = true; count++;
          return { id: ev.id, type: "rest", dur: cloneData(ev.dur), notes: [], voice: v + 1 };
        });
        if (changed) touched.push({ ref, m, voice: v + 1 });
      }
    }
    invalidate(score);
    for (const { ref, m, voice } of touched) consolidateRests(score, m, { ...ref, voice });
    normalizeTies(score); normalizeSpanners(score);
    return count;
  }

  /* ---------------- 입력 검증과 직렬화 ---------------- */
  function validateScoreData(score) {
    const fail = message => { throw new RangeError("악보를 열 수 없습니다: " + message); };
    if (!score || typeof score !== "object" || Array.isArray(score)) fail("악보 데이터가 아닙니다");
    const number = (value, min, max, label, integer = false) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(label + " 값이 올바르지 않습니다");
    };
    // Bound depth, collections and strings before allocating model objects.
    let nodes = 0;
    const walk = (value, depth = 0) => {
      if (++nodes > 1500000 || depth > 32) fail("악보가 너무 복잡합니다");
      if (typeof value === "string" && value.length > 20000) fail("텍스트가 너무 깁니다");
      if (typeof value === "number" && !Number.isFinite(value)) fail("유한한 숫자가 필요합니다");
      if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail("허용되지 않는 데이터 속성입니다");
        walk(child, depth + 1);
      }
    };
    walk(score);
    if (score.format && !["scoreforge-1", "scoreforge-2"].includes(score.format)) fail("지원하지 않는 저장 형식입니다");
    const allowed = (value, list, label) => { if (value != null && !list.includes(value)) fail(label + " 값을 지원하지 않습니다"); };
    const text = (value, limit, label) => { if (value != null && (typeof value !== "string" || value.length > limit)) fail(label + " 텍스트가 올바르지 않거나 너무 깁니다"); };
    if (score.meta) { text(score.meta.title, 2000, "제목"); text(score.meta.composer, 2000, "작곡가"); }
    const time = (ts, label) => {
      try { validTimeSig(ts); } catch { fail(label + " 박자표가 올바르지 않습니다"); }
    };
    if (score.timeSig != null) time(score.timeSig, "기본");
    if (score.keySig != null) number(score.keySig, -7, 7, "조표", true);
    if (score.tempo != null) number(score.tempo, 20, 400, "템포");
    if (score.clef != null && !CLEFS[score.clef]) fail("음자리표를 지원하지 않습니다");
    const pitch = p => {
      if (!p || typeof p !== "object") fail("음높이가 없습니다");
      number(p.step, 0, 6, "음이름", true); number(p.alter, -2, 2, "임시표", true); number(p.oct, -1, 9, "옥타브", true);
      number(midiOf(p), 0, 127, "음높이", true);
    };
    const duration = dur => {
      if (!dur || typeof dur !== "object") fail("음길이가 없습니다");
      number(dur.n, 1, 1048576, "음길이 분자", true); number(dur.d, 1, 1048576, "음길이 분모", true);
      number(dur.dots ?? 0, 0, 2, "점음표", true);
      if (dur.tuplet) {
        number(dur.tuplet.actual, 2, 64, "잇단음표", true); number(dur.tuplet.normal, 1, 64, "잇단음표 기준", true);
      }
      try { return durValue(dur); } catch { fail("음길이 계산 범위를 넘었습니다"); }
    };
    const parts = score.parts;
    if (parts != null && (!Array.isArray(parts) || parts.length > 64)) fail("파트 목록이 올바르지 않습니다");
    const staffs = parts?.length ? parts.flatMap(part => {
      if (!part || !Array.isArray(part.staves) || !part.staves.length || part.staves.length > 16) fail("보표 목록이 올바르지 않습니다");
      return part.staves;
    }) : [{ measures: score.measures }];
    const canonical = staffs.find(st => Array.isArray(st.measures) && st.measures.length)?.measures;
    if (!canonical || canonical.length > 10000) fail("마디 목록이 없거나 너무 큽니다");
    let ts = score.timeSig || { num: 4, den: 4 };
    const lengths = canonical.map((mm, m) => {
      if (!mm || typeof mm !== "object") fail((m + 1) + "마디가 올바르지 않습니다");
      if (mm.timeSig != null) { time(mm.timeSig, (m + 1) + "마디"); ts = mm.timeSig; }
      const value = m === 0 && mm.pickup != null ? mm.pickup : mm.length;
      if (value == null) return F(ts.num, ts.den);
      try { const len = positiveFraction(value); if (len.gt(F(64))) fail("마디 길이가 너무 큽니다"); return len; } catch { fail("마디 길이가 올바르지 않습니다"); }
    });
    const ids = new Set();
    for (const staff of staffs) {
      if (!staff || typeof staff !== "object") fail("보표가 올바르지 않습니다");
      if (staff.clef != null && !CLEFS[staff.clef]) fail("음자리표를 지원하지 않습니다");
      if (staff.staffType != null && !["standard", "tab", "percussion"].includes(staff.staffType)) fail("보표 종류를 지원하지 않습니다");
      if (staff.derivedFrom && staff.measures == null) {
        const owner = parts?.find(part => part.staves.includes(staff));
        if (staff.staffType !== "tab" || !owner?.staves.some(st => st.id === staff.derivedFrom && st.staffType !== "tab")) fail("연결 TAB 원본 보표가 없습니다");
        continue;
      }
      if (!Array.isArray(staff.measures) || staff.measures.length !== canonical.length) fail("보표의 마디 수가 다릅니다");
      for (const [m, mm] of staff.measures.entries()) {
        if (!mm || typeof mm !== "object") fail("마디가 올바르지 않습니다");
        if (mm.timeSig != null) time(mm.timeSig, (m + 1) + "마디");
        if (mm.keySig != null) number(mm.keySig, -7, 7, "마디 조표", true);
        if (mm.clef != null && !CLEFS[mm.clef]) fail("마디 음자리표를 지원하지 않습니다");
        allowed(mm.breakType, ["system", "page", "section", ""], "마디 나눔");
        if (mm.jump) allowed(mm.jump.type, JUMP_TYPES, "반복 이동");
        allowed(mm.marker, MARKERS, "반복 표식");
        const voices = Array.isArray(mm.voices) ? mm.voices : [mm.events];
        if (voices.length > VOICE_COUNT || !voices.length) fail("성부 목록이 올바르지 않습니다");
        for (const events of voices) {
          if (events == null || (Array.isArray(events) && !events.length)) continue;
          if (!Array.isArray(events) || events.length > 10000) fail("음표 목록이 올바르지 않습니다");
          let sum = F(0);
          for (const ev of events) {
            if (!ev || !["note", "rest"].includes(ev.type)) fail("음표 종류를 지원하지 않습니다");
            if (typeof ev.id !== "string" || !ev.id || ev.id.length > 200 || ids.has(ev.id)) fail("음표 ID가 없거나 중복됩니다");
            ids.add(ev.id);
            sum = sum.add(duration(ev.dur));
            if (ev.tempo != null) number(ev.tempo, 20, 400, "음표 템포");
            allowed(ev.stemDirection, ["auto", "up", "down"], "기둥 방향");
            allowed(ev.notehead, ["normal", "x", "diamond", "circle-x"], "음표 머리");
            allowed(ev.ornament, ORNAMENTS, "꾸밈음");
            allowed(ev.soundFlag, Object.keys(SOUND_FLAGS), "연주 주법");
            allowed(ev.dynamic, ["", "pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "sfz", "sfp", "fp", "rfz"], "셈여림");
            if (ev.artics && (!Array.isArray(ev.artics) || ev.artics.some(art => !["staccato", "tenuto", "accent", "marcato", "fermata"].includes(art)))) fail("아티큘레이션을 지원하지 않습니다");
            text(ev.lyric, 4000, "가사"); text(ev.staffText, 4000, "보표 글자"); text(ev.rehearsal, 200, "연습 기호");
            if (ev.lyrics) {
              if (!Array.isArray(ev.lyrics) || ev.lyrics.length > 8) fail("가사 절 목록이 올바르지 않습니다");
              for (const lyric of ev.lyrics) {
                text(lyric?.text, 4000, "가사");
                number(lyric?.verse ?? 1, 1, 8, "가사 절", true);
                allowed(lyric?.syllabic, ["single", "begin", "middle", "end"], "가사 음절");
              }
            }
            if (ev.graceBefore && (!Array.isArray(ev.graceBefore) || ev.graceBefore.length > 128)) fail("꾸밈음 목록이 올바르지 않습니다");
            if (ev.type === "note" && (!Array.isArray(ev.notes) || !ev.notes.length || ev.notes.length > 128)) fail("음표의 음높이가 없습니다");
            for (const n of ev.notes || []) pitch(n);
            for (const grace of ev.graceBefore || []) {
              if (!grace || !Array.isArray(grace.notes) || !grace.notes.length) fail("꾸밈음의 음높이가 없습니다");
              if (grace.dur) duration(grace.dur);
              grace.notes.forEach(pitch);
            }
          }
          if (!sum.eq(lengths[m])) fail((m + 1) + "마디의 음길이 합이 박자와 다릅니다");
        }
      }
    }
    return score;
  }
  const COMPUTED_EVENT_KEYS = ["_accidentals", "_accs", "_acc", "_stemDir", "_layout", "_x", "_y", "_beam", "_bounds"];
  function compactEvent(ev) {
    const out = cloneData(ev);
    const stripComputed = value => {
      if (!value || typeof value !== "object") return;
      for (const key of Object.keys(value)) {
        if (key.startsWith("_") || COMPUTED_EVENT_KEYS.includes(key)) delete value[key];
        else stripComputed(value[key]);
      }
    };
    stripComputed(out);
    delete out.voice;
    if (out.lyrics?.some(l => l.verse === 1)) delete out.lyric;
    return out;
  }
  function compactMeasure(mm) {
    const out = {};
    for (const [key, value] of Object.entries(mm)) if (!["events", "voices"].includes(key) && !key.startsWith("_")) out[key] = cloneData(value);
    out.voices = mm.voices.map((list, v) => v > 0 && voiceIsEmpty(list) ? null : list.map(compactEvent));
    while (out.voices.length > 1 && out.voices.at(-1) === null) out.voices.pop();
    Object.defineProperty(out, "events", { configurable: true, enumerable: false, get() { return this.voices[0]; } });
    return out;
  }
  function toJSON(score) {
    ensureParts(score);
    syncLinkedTab(score);
    const out = {};
    for (const [key, value] of Object.entries(score)) if (!["parts", "measures", "__cache"].includes(key) && !key.startsWith("_")) out[key] = cloneData(value);
    out.format = "scoreforge-2";
    out.parts = score.parts.map(part => ({ ...cloneData({ ...part, staves: undefined }), staves: part.staves.map(staff => {
      const outStaff = cloneData({ ...staff, measures: undefined });
      const source = staff.staffType === "tab" && part.staves.find(st => st.id === staff.linkedStaffId && st.staffType !== "tab");
      if (source) outStaff.derivedFrom = source.id;
      else outStaff.measures = staff.measures.map(compactMeasure);
      return outStaff;
    }) }));
    const legacyMeasures = out.parts[0].staves[0].measures;
    Object.defineProperty(out, "measures", { configurable: true, enumerable: false, get() { return legacyMeasures; } });
    return out;
  }
  function fromJSON(obj) {
    // Preserve the legacy public aliases when a caller intentionally removes
    // parts from an in-memory toJSON result. On disk only canonical data exists.
    const input = !obj?.parts?.length && obj?.measures ? { ...obj, measures: obj.measures } : obj;
    const score = JSON.parse(JSON.stringify(input));
    delete score.__cache;
    validateScoreData(score);
    score.timeSig ||= { num: 4, den: 4 }; score.keySig ??= 0; score.tempo ??= 100;
    score.meta ||= { title: "새 악보", composer: "" };
    const reserveIds = value => {
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string" && /^e\d+$/.test(value.id)) {
        const id = Number(value.id.slice(1));
        if (Number.isSafeInteger(id) && id < Number.MAX_SAFE_INTEGER) _idCounter = Math.max(_idCounter, id + 1);
      }
      for (const child of Object.values(value)) if (child && typeof child === "object") reserveIds(child);
    };
    reserveIds(score);
    ensureParts(score);
    syncLinkedTab(score);
    for (const ref of staffRefs(score)) for (const m of ref.measures) {
      ensureMeasureVoices(m, score);
      for (const { ev } of measureEntries(m, { score, includeSilent: true })) {
        if (!ev.notes) ev.notes = [];
        normalizeEventChordSymbol(ev); normalizeEventLyrics(ev);
        if (ev.graceBefore) ev.graceBefore = cloneGraceList(ev.graceBefore);
      }
      syncMeasureEvents(m);
    }
    if (!score.spanners) score.spanners = [];
    syncLegacyFields(score);
    normalizeSpanners(score);
    return score;
  }

  /* ---------------- 상태 + Undo/Redo ---------------- */
  const state = {
    score: createScore(),
    currentVoice: 1,
    readOnly: false,
    dirty: false,
    revision: 0,
    rev: 0,
    autosavedRevision: -1,
    lastAutosaveAt: 0,
    listeners: new Set(),
  };
  const history = { undo: [], redo: [], max: 200, budget: 16 * 1024 * 1024 };
  let contentVersion = 0, nextContentVersion = 0, savedVersion = 0, mutationDepth = 0;

  function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
  function emit(type = "change", label = "", opt = {}) {
    state.dirty = contentVersion !== savedVersion;
    for (const fn of state.listeners) fn(state.score, { type, label, revision: state.revision, dirty: state.dirty, layout: opt.layout !== false });
  }
  function bumpRevision() { state.rev = ++state.revision; }
  function snapshot(score) {
    return JSON.stringify(toJSON(score));
  }
  function restoreSnapshot(value) { return fromJSON(typeof value === "string" ? JSON.parse(value) : value); }
  function trimHistory() {
    let bytes = history.undo.reduce((sum, entry) => sum + entry.snapshot.length * 2, 0);
    while (history.undo.length > 1 && (history.undo.length > history.max || bytes > history.budget)) {
      bytes -= history.undo.shift().snapshot.length * 2;
    }
  }
  function breakCoalescing() {
    const last = history.undo[history.undo.length - 1];
    if (last) last.coalesce = null;
  }
  /** markSaved(revision?) accepts only the current revision, so a stale async
   * save cannot clear newer edits. Undoing to the saved content clears dirty. */
  function markSaved(revision = state.revision) {
    if (revision !== state.revision) return false;
    savedVersion = contentVersion;
    breakCoalescing();
    emit("saved");
    return true;
  }
  /** Autosave is separate from explicit save: dirty stays true. Capture revision
   * when serialization starts, then markAutosaved(revision) only after success. */
  function markAutosaved(revision = state.revision) {
    if (revision !== state.revision) return false;
    state.autosavedRevision = revision; state.lastAutosaveAt = Date.now();
    emit("autosaved");
    return true;
  }
  function isAutosaved() { return state.autosavedRevision === state.revision; }

  /* 모든 악보 변형은 이 함수를 거친다(스냅샷 undo) */
  function mutate(label, fn, opt = {}) {
    if (state.readOnly) return false;
    if (mutationDepth) return fn(state.score);
    const before = snapshot(state.score), linkedBefore = linkedTabBaseline(state.score), previousVersion = contentVersion;
    const at = Date.now(), last = history.undo[history.undo.length - 1];
    const coalesced = opt.coalesce && last?.coalesce === opt.coalesce && !history.redo.length && at - last.at <= 1000;
    let result;
    invalidate(state.score);
    mutationDepth++;
    try {
      result = fn(state.score);
      invalidate(state.score);
      ensureParts(state.score);
      syncLinkedTab(state.score, linkedBefore);
      normalizeSpanners(state.score);
    } catch (error) {
      state.score = restoreSnapshot(before);
      throw error;
    } finally { mutationDepth--; }
    if (coalesced) { last.label = label; last.at = at; }
    else history.undo.push({ label, snapshot: before, version: previousVersion, at, coalesce: opt.coalesce || null });
    trimHistory();
    history.redo.length = 0;
    contentVersion = ++nextContentVersion;
    bumpRevision();
    emit("mutate", label, opt);
    return result;
  }
  function undo() {
    if (state.readOnly) return false;
    if (!history.undo.length) return false;
    const entry = history.undo.pop();
    history.redo.push({ label: entry.label, snapshot: snapshot(state.score), version: contentVersion, at: Date.now() });
    state.score = restoreSnapshot(entry.snapshot);
    contentVersion = entry.version;
    breakCoalescing(); bumpRevision();
    emit("undo", entry.label); return true;
  }
  function redo() {
    if (state.readOnly) return false;
    if (!history.redo.length) return false;
    const entry = history.redo.pop();
    history.undo.push({ label: entry.label, snapshot: snapshot(state.score), version: contentVersion, at: Date.now(), coalesce: null });
    state.score = restoreSnapshot(entry.snapshot);
    contentVersion = entry.version;
    trimHistory(); bumpRevision();
    emit("redo", entry.label); return true;
  }
  function canUndo() { return history.undo.length > 0; }
  function canRedo() { return history.redo.length > 0; }
  function undoLabel() { return history.undo[history.undo.length - 1]?.label || ""; }
  function redoLabel() { return history.redo[history.redo.length - 1]?.label || ""; }
  function resetHistory() { history.undo.length = 0; history.redo.length = 0; }
  function historyInfo() {
    return { undo: history.undo.length, redo: history.redo.length, budget: history.budget,
      bytes: [...history.undo, ...history.redo].reduce((sum, entry) => sum + entry.snapshot.length * 2, 0) };
  }
  function setScore(score, opt = {}) {
    state.score = fromJSON(score); resetHistory();
    contentVersion = ++nextContentVersion;
    if (!opt.dirty) savedVersion = contentVersion;
    state.autosavedRevision = -1; state.lastAutosaveAt = 0;
    bumpRevision(); emit("setScore");
  }

  /* ---------------- 내보내기 ---------------- */
  SF.Fraction = Fraction;
  SF.F = F;
  SF.core = {
    durBase, durValue, durEq, durName, decompose, BASES, DUR_NAMES, maxDots,
    tupletNormalFor, tupletWrittenDur, tupletMeta,
    midiOf, absStep, pitchEq, keyAlterFor, spellMidi, transposePitch, pitchName,
    parseChordSymbol, normalizeChordSymbol, displayChordSymbol, cloneChordSymbol,
    lyricsOf, cloneLyrics, setLyric, normalizeEventLyrics,
    EVENT_DECOR_KEYS, copyDecor, pickDecor, stripDecor, reinputWithDur, ORNAMENTS, setOrnament,
    STEP_EN, STEP_KO, STEP_SEMIS, KEY_NAMES, CLEFS, DRUM_MAP, drumSpec, GUITAR_STANDARD_TUNING, midiToStringFret, stringFretToMidi, applyTabToEvent, FRETBOARD_LIBRARY, getDefaultFretboard, SOUND_FLAGS, detectSoundFlag, keySigSteps, beamGroups, beatLen,
    PART_LIBRARY, ENSEMBLES, instrumentForGm,
    createScore, measureLen, fullRest, newId, DEFAULT_LAYOUT, ensureLayout, pageSizeDefaults,
    DEFAULT_STYLE, ensureStyle, styleOf,
    keySigAt, timeSigAt, measureLenAt, clefAt, measureStarts, setMeasureKeySig, setMeasureClef, setMeasureTimeSig,
    insertMeasures, appendMeasures, removeLastMeasure, deleteMeasures, splitMeasureAt, joinMeasures, setPickup,
    VOICE_COUNT, normalizeVoice, ensureMeasureVoices, getVoiceEvents, measureEntries, forEachEvent, voiceIsEmpty, hasVisibleContent,
    ensureParts, ensureMeasureMeta, staffRefs, visibleStaffRefs, isStaffEmpty, staffRef, staffMeasures, activeRef, activeClef, isPercussionRef, setActiveStaff, ensembleKey, applyEnsemble,
    toggleStartRepeat, toggleEndRepeat, setRepeatCount, setEnding, clearEndings, setMeasureBreak, clearMeasureBreak,
    JUMP_TYPES, MARKERS, setMeasureJump, setMeasureMarker,
    eventStartTick, findEvent, nextEvent, prevEvent,
    replaceRange, inputAt, addDrumNote, deleteEvent, makeTupletAt, consolidateRests, normalizeTies, isTiedFrom,
    removeNoteFromChord, transposeNote, setNoteAccidental, toggleNoteTie,
    addGraceBefore, findGrace, cloneGraceList,
    invalidate, eventIndex, eventOrderMap, normalizeSpanners, slurCoverMap, addOttava, ottavaShiftAt,
    rebar, transposeScore, syncLinkedTab, validateScoreData, deleteEvents, toJSON, fromJSON,
    state, mutate, undo, redo, canUndo, canRedo, undoLabel, redoLabel, resetHistory, setScore, onChange,
    markSaved, markAutosaved, isAutosaved, historyInfo,
  };
})(window.SF);
