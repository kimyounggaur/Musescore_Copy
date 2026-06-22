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
    const m = head.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!m) return { raw: original, root: null, rootAlter: 0, quality: "", bass: null, bassAlter: 0, normalized: original };
    const root = m[1].toUpperCase();
    const rootAlter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
    const qualityRaw = m[3] || "";
    const quality = CHORD_QUALITY_ALIASES[qualityRaw] ?? CHORD_QUALITY_ALIASES[qualityRaw.toLowerCase()] ?? qualityRaw;
    let bass = null, bassAlter = 0;
    if (bassText) {
      const bm = bassText.match(/^([A-Ga-g])([#b]?)$/);
      if (bm) {
        bass = bm[1].toUpperCase();
        bassAlter = bm[2] === "#" ? 1 : bm[2] === "b" ? -1 : 0;
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
    percussion: { bottomStep: absStep({ step: 2, oct: 4 }), middle: { step: 6, alter: 0, oct: 4 } },
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
    const positions = FRETBOARD_LIBRARY[key] || FRETBOARD_LIBRARY[parsed.root + (parsed.quality || "")] || null;
    if (!positions) return null;
    return { strings: 6, frets: 4, firstFret: 1, positions: [...positions], fingers: [] };
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
    measuresPerSystem: 0,
  };
  function ensureLayout(score) {
    score.layout = { ...DEFAULT_LAYOUT, ...(score.layout || {}) };
    score.layout.measuresPerSystem = Math.max(0, Math.min(16, score.layout.measuresPerSystem | 0 || 0));
    return score.layout;
  }

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
    drumkit: { name: "드럼 키트", shortName: "Dr.", group: "percussion", instrument: "drums", staves: [{ clef: "percussion", instrumentType: "percussion", staffType: "percussion" }] },
    guitar: { name: "기타", shortName: "Gtr.", group: "strings", instrument: "guitar", tuning: GUITAR_STANDARD_TUNING, staves: [{ clef: "treble" }] },
    "guitar-tab": { name: "기타 + TAB", shortName: "Gtr.", group: "strings", instrument: "guitar", tuning: GUITAR_STANDARD_TUNING, brace: "brace", staves: [{ clef: "treble", staffType: "standard", name: "Staff" }, { clef: "treble", staffType: "tab", name: "TAB" }] },
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
      (ev.graceBefore && ev.graceBefore.length)
    ));
  }
  function voiceIsEmpty(evs) {
    return !evs || !evs.length || evs.every(ev => ev.type === "rest" && !hasVisibleContent(ev));
  }
  function ensureMeasureVoices(mm, score) {
    if (!mm) return [];
    ensureMeasureMeta(mm);
    const fallbackScore = score || { timeSig: { num: 4, den: 4 } };
    const base = Array.isArray(mm.events) && mm.events.length ? mm.events : [fullRest(fallbackScore)];
    if (!Array.isArray(mm.voices)) {
      mm.voices = Array.from({ length: VOICE_COUNT }, (_, i) => i === 0 ? base : []);
    }
    while (mm.voices.length < VOICE_COUNT) mm.voices.push([]);
    for (let v = 0; v < VOICE_COUNT; v++) {
      if (!Array.isArray(mm.voices[v])) mm.voices[v] = [];
      if (!mm.voices[v].length) mm.voices[v] = [fullRest(fallbackScore)];
      mm.voices[v].forEach(ev => markEventVoice(ev, v + 1));
    }
    mm.events = mm.voices[0];
    return mm.voices;
  }
  function getVoiceEvents(measure, voice = 1, score) {
    return ensureMeasureVoices(measure, score)[normalizeVoice(voice) - 1];
  }
  function syncMeasureEvents(measure) {
    if (measure && Array.isArray(measure.voices)) measure.events = measure.voices[0] || measure.events || [];
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
  function emptyMeasures(score, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push({ events: [fullRest(score)] });
    return out;
  }
  function ensureMeasureMeta(mm) {
    if (!mm) return mm;
    if (mm.startRepeat === undefined) mm.startRepeat = false;
    if (mm.endRepeat === undefined) mm.endRepeat = false;
    if (mm.repeatCount === undefined) mm.repeatCount = 2;
    if (mm.endingStart === undefined) mm.endingStart = null;
    if (mm.endingStop === undefined) mm.endingStop = false;
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
    const part = {
      id: newId(),
      kind,
      name: lib.name,
      shortName: lib.shortName,
      group: lib.group,
      instrument: lib.instrument,
      tuning: lib.tuning ? [...lib.tuning] : undefined,
      brace: lib.brace || null,
      staves: lib.staves.map((st, i) => ({
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
          if (!staff.staffType) staff.staffType = "standard";
          if (!staff.instrumentType) staff.instrumentType = part.group === "percussion" || part.instrument === "drums" ? "percussion" : "pitched";
          if (!staff.measures || !staff.measures.length) staff.measures = emptyMeasures(score, count);
          while (staff.measures.length < count) staff.measures.push({ events: [fullRest(score)] });
          for (const mm of staff.measures) {
            ensureMeasureMeta(mm);
            if (!mm.events || !mm.events.length) mm.events = [fullRest(score)];
            ensureMeasureVoices(mm, score);
          }
        }
      }
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
    return syncLegacyFields(score);
  }
  function forEachMeasureAt(score, mIdx, fn) {
    ensureParts(score);
    for (const ref of staffRefs(score)) {
      const mm = ref.measures[mIdx];
      if (mm) fn(ensureMeasureMeta(mm), ref);
    }
    if (score.measures[mIdx]) fn(ensureMeasureMeta(score.measures[mIdx]), null);
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
  function staffRefs(score) {
    ensureParts(score);
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
    return refs;
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
  function activeClef(score) { return activeRef(score).clef || "treble"; }
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
    return syncLegacyFields(score);
  }

  /* ---------------- 순회/조회 ---------------- */
  function eventStartTick(measure, eIdx, ctx) {
    const evs = getVoiceEvents(measure, ctx?.voice || 1);
    let t = Fraction.ZERO;
    for (let i = 0; i < eIdx; i++) t = t.add(durValue(evs[i].dur));
    return t;
  }
  function findEvent(score, id) {
    for (const ref of staffRefs(score)) {
      for (let m = 0; m < ref.measures.length; m++) {
        const voices = ensureMeasureVoices(ref.measures[m], score);
        for (let v = 0; v < voices.length; v++) {
          const evs = voices[v];
          for (let e = 0; e < evs.length; e++) {
            if (evs[e].id === id) return { ...ref, m, e, voice: v + 1, ev: evs[e] };
          }
        }
      }
    }
    return null;
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
    const voice = voiceFromCtx(ctx);
    const evs = getVoiceEvents(measure, voice, score);
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
        if (!inserted) { out.push(...makeEvents().map(ev2 => markEventVoice(ev2, voice))); inserted = true; }
        if (evEnd.gt(end)) {
          for (const d of decompose(end, evEnd.sub(end)))
            out.push(markEventVoice({ id: newId(), type: "rest", dur: d, notes: [] }, voice));
        }
      }
      pos = evEnd;
    }
    if (!inserted) out.push(...makeEvents().map(ev2 => markEventVoice(ev2, voice))); // 빈 마디 안전망
    measure.voices[voice - 1] = out;
    syncMeasureEvents(measure);
  }

  /* 음표/쉼표 입력. 마디를 넘으면 다음 마디로 타이 분할. 입력된 첫 이벤트 ref 반환 */
  function inputAt(score, mIdx, tick, dur, pitches /* null=쉼표 */, ctx) {
    const ref = staffRef(score, ctx);
    const voice = voiceFromCtx(ctx);
    const L = measureLen(score);
    let want = durValue(dur);
    const room = L.sub(tick);
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
      if (i === 0) {
        if (ev.graceBefore) next.graceBefore = cloneGraceList(ev.graceBefore);
        if (ev.lyric) next.lyric = ev.lyric;
        if (lyricsOf(ev).length) next.lyrics = cloneLyrics(ev);
        if (ev.dynamic) next.dynamic = ev.dynamic;
        if (ev.artics) next.artics = [...ev.artics];
        if (ev.tempo) next.tempo = ev.tempo;
        if (ev.rehearsal) next.rehearsal = ev.rehearsal;
        if (ev.staffText) next.staffText = ev.staffText;
        if (ev.soundFlag) next.soundFlag = ev.soundFlag;
        if (ev.chordSymbol) next.chordSymbol = cloneChordSymbol(ev.chordSymbol);
        if (ev.fretboard) next.fretboard = JSON.parse(JSON.stringify(ev.fretboard));
      }
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
    if (evs.every(e => e.type === "rest" && !hasVisibleContent(e))) {
      measure.voices[voice - 1] = [markEventVoice(fullRest(score), voice)];
      syncMeasureEvents(measure);
      return;
    }
    const out = [];
    let pos = Fraction.ZERO, runStart = null, runLen = Fraction.ZERO;
    const flush = () => {
      if (runStart !== null) {
        for (const d of decompose(runStart, runLen))
          out.push(markEventVoice({ id: newId(), type: "rest", dur: d, notes: [] }, voice));
        runStart = null; runLen = Fraction.ZERO;
      }
    };
    for (const ev of evs) {
      const len = durValue(ev.dur);
      if (ev.type === "rest") {
        if (runStart === null) runStart = pos;
        runLen = runLen.add(len);
      } else { flush(); out.push(ev); }
      pos = pos.add(len);
    }
    flush();
    measure.voices[voice - 1] = out.map(ev => markEventVoice(ev, voice));
    syncMeasureEvents(measure);
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
    const map = new Map();
    let i = 0;
    for (const ref of staffRefs(score))
      for (const measure of ref.measures)
        for (const { ev } of measureEntries(measure, { score, includeSilent: true })) map.set(ev.id, i++);
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
    const lanes = [];
    for (const ref of staffRefs(score)) {
      for (let voice = 1; voice <= VOICE_COUNT; voice++) {
        const items = [];
        const consumed = new Set();
        let anyContent = voice === 1;
        for (let m = 0; m < ref.measures.length; m++) {
          const evs = getVoiceEvents(ref.measures[m], voice, score);
          if (!voiceIsEmpty(evs)) anyContent = true;
          for (let e = 0; e < evs.length; e++) {
            const ev = evs[e];
            if (consumed.has(ev.id)) continue;
            let len = durValue(ev.dur);
            if (ev.type === "note") {
              let cur = { ...ref, m, e, voice, ev };
              while (cur.ev.notes.length && cur.ev.notes.every(n => n.tie)) {
                const nx = nextEvent(score, cur.m, cur.e, { ...ref, voice });
                if (!nx || nx.ev.type !== "note") break;
                consumed.add(nx.ev.id);
                len = len.add(durValue(nx.ev.dur));
                cur = nx;
              }
              items.push({
                type: "note", len, voice,
                pitches: ev.notes.map(n => ({ step: n.step, alter: n.alter, oct: n.oct })),
                graceBefore: cloneGraceList(ev.graceBefore),
                lyric: ev.lyric,
                lyrics: cloneLyrics(ev),
                dynamic: ev.dynamic,
                artics: ev.artics ? [...ev.artics] : null,
                tempo: ev.tempo,
                rehearsal: ev.rehearsal,
                staffText: ev.staffText,
                chordSymbol: cloneChordSymbol(ev.chordSymbol),
              });
            } else {
              items.push({ type: "rest", len, voice, fromFull: !!ev.full, chordSymbol: cloneChordSymbol(ev.chordSymbol) });
            }
          }
        }
        if (anyContent) lanes.push({ ref, voice, items, total: items.reduce((a, it) => a.add(it.len), Fraction.ZERO) });
      }
    }

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
      const ctx = { partIdx: lane.ref.partIdx, staffIdx: lane.ref.staffIdx, voice: lane.voice };
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
                id: newId(), type: "note", voice: lane.voice, dur: d,
                notes: it.pitches.map(p => ({ ...p, tie: !isLastPiece })),
              };
              if (first && it.graceBefore && it.graceBefore.length) ev.graceBefore = cloneGraceList(it.graceBefore);
              if (first && it.lyric) ev.lyric = it.lyric;
              if (first && it.lyrics && it.lyrics.length) {
                ev.lyrics = cloneLyrics(it.lyrics);
                normalizeEventLyrics(ev);
              }
              if (first && it.dynamic) ev.dynamic = it.dynamic;
              if (first && it.artics) ev.artics = [...it.artics];
              if (first && it.tempo) ev.tempo = it.tempo;
              if (first && it.rehearsal) ev.rehearsal = it.rehearsal;
              if (first && it.staffText) ev.staffText = it.staffText;
              if (first && it.chordSymbol) ev.chordSymbol = cloneChordSymbol(it.chordSymbol);
              replaceRange(score, m, t, durValue(d), () => [ev], ctx);
            } else {
              const ev = { id: newId(), type: "rest", voice: lane.voice, dur: d, notes: [] };
              if (first && it.chordSymbol) ev.chordSymbol = cloneChordSymbol(it.chordSymbol);
              replaceRange(score, m, t, durValue(d), () => [ev], ctx);
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
      for (const { ev } of measureEntries(measure, { score, includeSilent: true }))
        if (ev.type === "note")
          ev.notes = ev.notes.map(n => {
            const p = spellMidi(midiOf(n) + semitones, f, semitones > 0 ? "sharp" : "flat");
            return { ...p, tie: n.tie };
          });
  }

  /* ---------------- 직렬화 ---------------- */
  function toJSON(score) {
    ensureParts(score);
    for (const ref of staffRefs(score))
      for (const mm of ref.measures) {
        ensureMeasureVoices(mm, score);
        syncMeasureEvents(mm);
      }
    return JSON.parse(JSON.stringify(score));
  }
  function fromJSON(obj) {
    const score = JSON.parse(JSON.stringify(obj));
    ensureParts(score);
    // id 카운터 복구 + 구버전 파일 마이그레이션
    let maxId = 0;
    for (const ref of staffRefs(score))
      for (const m of ref.measures) {
        ensureMeasureVoices(m, score);
        for (const { ev } of measureEntries(m, { score, includeSilent: true })) {
          const n = parseInt(String(ev.id).replace(/\D/g, ""), 10);
          if (!isNaN(n)) maxId = Math.max(maxId, n);
          if (!ev.notes) ev.notes = [];
          normalizeEventChordSymbol(ev);
          normalizeEventLyrics(ev);
          if (ev.graceBefore) ev.graceBefore = cloneGraceList(ev.graceBefore);
          for (const g of ev.graceBefore || []) {
            const gn = parseInt(String(g.id).replace(/\D/g, ""), 10);
            if (!isNaN(gn)) maxId = Math.max(maxId, gn);
          }
        }
        syncMeasureEvents(m);
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
    currentVoice: 1,
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
    parseChordSymbol, normalizeChordSymbol, displayChordSymbol, cloneChordSymbol,
    lyricsOf, cloneLyrics, setLyric, normalizeEventLyrics,
    STEP_EN, STEP_KO, STEP_SEMIS, KEY_NAMES, CLEFS, DRUM_MAP, drumSpec, GUITAR_STANDARD_TUNING, midiToStringFret, stringFretToMidi, applyTabToEvent, FRETBOARD_LIBRARY, getDefaultFretboard, SOUND_FLAGS, detectSoundFlag, keySigSteps, beamGroups, beatLen,
    PART_LIBRARY, ENSEMBLES,
    createScore, measureLen, fullRest, newId, DEFAULT_LAYOUT, ensureLayout,
    VOICE_COUNT, normalizeVoice, ensureMeasureVoices, getVoiceEvents, measureEntries, forEachEvent, voiceIsEmpty, hasVisibleContent,
    ensureParts, ensureMeasureMeta, staffRefs, visibleStaffRefs, isStaffEmpty, staffRef, staffMeasures, activeRef, activeClef, isPercussionRef, setActiveStaff, ensembleKey, applyEnsemble,
    toggleStartRepeat, toggleEndRepeat, setRepeatCount, setEnding, clearEndings,
    eventStartTick, findEvent, nextEvent, prevEvent,
    replaceRange, inputAt, addDrumNote, deleteEvent, makeTupletAt, consolidateRests, normalizeTies, isTiedFrom,
    addGraceBefore, findGrace, cloneGraceList,
    eventOrderMap, normalizeSpanners, slurCoverMap,
    rebar, transposeScore, toJSON, fromJSON,
    state, mutate, undo, redo, canUndo, canRedo, resetHistory, setScore, onChange,
  };
})(window.SF);
