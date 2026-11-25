/* js/schema.js — 불러오는 악보 JSON의 모양과 값을 확인한다(P2-E 모양 검사 → P8-2 값 검사·자동 고침).
 * checkShape(data): 저장소 기록(core.toJSON이 정규화한 모양)의 모양이 틀리면 ScoreFormatError를 던진다 — 화면을 그리다 멈추는 기록만 거른다(P2-E, 그대로).
 * validate(raw): 파일·클라우드·최근 작업·옛 저장소에서 막 읽은 악보 JSON을 core.fromJSON에 넣기 전에 한 번 거른다(P8-2).
 *   → { score, fixes, summary, fatal } — 던지지 않는다. 모양이 틀리거나 너무 크면 fatal(ScoreFormatError)로 거부하고,
 *   값만 틀린 곳(길이·음높이·글자 수·성부 길이 …)은 고친 사본(score)과 무엇을 고쳤는지(fixes·summary)를 돌려준다. 정상 악보는 한 건도 고치지 않는다.
 *   검사는 반복문으로 한다(재귀 없음) — 깊이·길이·크기 한도를 먼저 재서 폭주하는 입력을 막는다.
 * 다른 모듈은 SF.schema?.checkShape / SF.schema?.validate로 부른다(이 파일 없이 로드되는 테스트가 있다). 이 모듈은 core·DOM에 기대지 않는다. */
"use strict";
(function (SF) {
  const REASONS = {
    NOT_OBJECT: "악보 데이터의 모양이 올바르지 않아요",
    PARTS_MISSING: "악기(parts)가 없어요",
    PARTS_NOT_ARRAY: "악기(parts)가 목록이 아니에요",
    PART_NOT_OBJECT: "악기 항목의 모양이 올바르지 않아요",
    STAVES_NOT_ARRAY: "보표(staves)가 목록이 아니에요",
    STAFF_NOT_OBJECT: "보표 항목의 모양이 올바르지 않아요",
    MEASURES_NOT_ARRAY: "마디(measures)가 목록이 아니에요",
    MEASURE_NOT_OBJECT: "마디 항목의 모양이 올바르지 않아요",
    VOICES_MISSING: "마디에 성부(voices)가 없어요",
    VOICES_NOT_ARRAY: "성부(voices)가 목록이 아니에요",
    VOICE_NOT_ARRAY: "성부 항목이 목록이 아니에요",
    EVENT_NOT_OBJECT: "음표·쉼표 항목의 모양이 올바르지 않아요",
    BAD_DURATION: "음표 길이(dur)의 n·d가 양의 정수가 아니에요",
    TOO_MANY_MEASURES: "마디가 너무 많아요(2,000마디 초과)",
    TOO_MANY_STAVES: "보표가 너무 많아요(악기 하나에 32개 · 전체 128개 초과)",
    TOO_MANY_EVENTS: "음표·쉼표가 너무 많아요(20만 개 초과)",
    TOO_LARGE: "악보 데이터가 너무 커서 열 수 없어요",
    TOO_DEEP: "악보 데이터가 너무 깊게 겹쳐 있어요",
    INTERNAL: "악보를 검사하다 알 수 없는 문제가 생겼어요",
  };

  /** 악보 JSON의 모양이 틀렸다. code는 REASONS의 키, path는 어디가 틀렸는지(예: parts[0].staves[0].measures[3]). */
  class ScoreFormatError extends Error {
    constructor(code, path) {
      super(`${REASONS[code] || code} — ${path || "score"}`);
      this.name = "ScoreFormatError";
      this.code = code;
      this.path = path || "score";
    }
  }

  const fail = (code, path) => { throw new ScoreFormatError(code, path); };
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const positiveInteger = value => Number.isInteger(value) && value > 0;

  function checkMeasure(measure, path) {
    if (!isObject(measure)) fail("MEASURE_NOT_OBJECT", path);
    if (!Array.isArray(measure.voices)) fail(measure.voices === undefined ? "VOICES_MISSING" : "VOICES_NOT_ARRAY", `${path}.voices`);
    measure.voices.forEach((voice, v) => {
      if (!Array.isArray(voice)) fail("VOICE_NOT_ARRAY", `${path}.voices[${v}]`);
      voice.forEach((event, e) => {
        const at = `${path}.voices[${v}][${e}]`;
        if (!isObject(event)) fail("EVENT_NOT_OBJECT", at);
        const dur = event.dur;
        if (!isObject(dur) || !positiveInteger(dur.n) || !positiveInteger(dur.d)) fail("BAD_DURATION", `${at}.dur`);
      });
    });
  }

  /** 모양이 맞으면 data를 그대로 돌려주고, 틀리면 ScoreFormatError(code)를 던진다. */
  function checkShape(data) {
    if (!isObject(data)) fail("NOT_OBJECT", "score");
    if (data.measures !== undefined && !Array.isArray(data.measures)) fail("MEASURES_NOT_ARRAY", "measures");
    if (!Array.isArray(data.parts)) fail(data.parts === undefined ? "PARTS_MISSING" : "PARTS_NOT_ARRAY", "parts");
    data.parts.forEach((part, p) => {
      const partPath = `parts[${p}]`;
      if (!isObject(part)) fail("PART_NOT_OBJECT", partPath);
      if (!Array.isArray(part.staves)) fail("STAVES_NOT_ARRAY", `${partPath}.staves`);
      part.staves.forEach((staff, s) => {
        const staffPath = `${partPath}.staves[${s}]`;
        if (!isObject(staff)) fail("STAFF_NOT_OBJECT", staffPath);
        if (!Array.isArray(staff.measures)) fail("MEASURES_NOT_ARRAY", `${staffPath}.measures`);
        staff.measures.forEach((measure, m) => checkMeasure(measure, `${staffPath}.measures[${m}]`));
      });
    });
    return data;
  }

  /* ======================= P8-2: validate ======================= */

  /** 한도. 넘으면 열지 않는다(잘라서 열면 뒷부분을 모르는 사이에 잃는다). */
  const LIMITS = Object.freeze({
    measures: 2000,        // 보표 하나의 마디 수 (MIDI 가져오기의 상한과 같다)
    staves: 32,            // 악기(part) 하나의 보표 수
    staffTotal: 128,       // 악기·보표 전체 수 (core는 보표가 없는 악기에도 보표를 하나 만든다)
    events: 200000,        // 음표·쉼표 전체
    cells: 200000,         // 보표 수 × 가장 긴 보표의 마디 수 (core가 짧은 보표를 길이에 맞춰 채운다)
    array: 200000,         // 어떤 배열이든 길이
    nodes: 8000000,        // 값(객체·배열·글자·숫자) 전체 개수
    depth: 32,             // 중첩 단계
    string: 1000000,       // 글자 하나의 길이
    voices: 4,             // 마디당 성부 (core VOICE_COUNT)
    title: 200,            // 제목·작곡가 등 곡 정보 글자 (cloud.js·scores SQL과 같다)
    rehearsal: 12, staffText: 48, chord: 24,   // 패널 입력 한도와 같다
    tempoMin: 10, tempoMax: 999,
    durPart: 4096,         // dur의 n·d 최대 — core Fraction이 안전한 정수 안에서 계산하도록
    durBase: 32,           // 기본 길이 n/d 최대(온음표 32개)
    lengthDen: 1 << 20,    // 마디 길이를 이어 붙인 합·성부 길이 합의 분모 상한
  });

  /** 고친 곳의 분류. label은 가져오기 결과 창에 "label (N건)"으로 보인다(i18n 그룹 import의 fix* 행과 같은 글자 — 건수 꼬리는 가져오기 보고서와 같은 import.counted 패턴). */
  const RULES = Object.freeze({
    meta: { label: "곡 정보(제목·작곡가 등)의 모양이나 글자 수를 바로잡았어요", action: "곡 정보를 바로잡음" },
    text: { label: "너무 긴 글(리허설·스태프 텍스트·코드)을 잘랐어요", action: "글자를 자름" },
    tempo: { label: "템포를 10~999 범위로 맞췄어요", action: "템포를 범위로 맞춤" },
    signature: { label: "올바르지 않은 조표·박자·마디 길이를 기본값으로 바꾸거나 지웠어요", action: "조표·박자·마디 길이를 바로잡음" },
    voices: { label: "마디당 성부는 4개까지라서 5번째 이후 성부를 뺐어요", action: "5번째 이후 성부를 뺌" },
    duration: { label: "음표 길이의 점·잇단음표 값을 바로잡았어요", action: "점·잇단음표 값을 바로잡음" },
    hugeDuration: { label: "너무 큰 길이를 가진 음표·쉼표를 지웠어요", action: "그 음표·쉼표를 지움" },
    eventType: { label: "음표·쉼표 종류가 올바르지 않아 바로잡았어요", action: "종류를 바로잡음" },
    pitch: { label: "올바르지 않은 음높이를 바로잡거나 그 음을 지웠어요", action: "음높이를 바로잡거나 그 음을 지움" },
    emptyNote: { label: "음이 하나도 없는 음표를 쉼표로 바꿨어요", action: "쉼표로 바꿈" },
    voiceLength: { label: "마디 길이와 맞지 않는 성부를 쉼표로 채우거나 잘랐어요", action: "쉼표로 채우거나 자름" },
    field: { label: "모양이 올바르지 않은 항목(장식·가사·보표 설정 등)을 지웠어요", action: "그 항목을 지움" },
    id: { label: "빠졌거나 올바르지 않은 번호(id)를 새로 붙였어요", action: "번호를 새로 붙임" },
  });

  const CLEF_NAMES = ["treble", "bass", "alto", "tenor", "treble8vb", "bass8vb", "percussion"];
  const STAFF_TYPES = ["standard", "tab", "percussion"];
  const INSTRUMENT_TYPES = ["pitched", "percussion"];
  const TIME_DENS = [1, 2, 4, 8, 16, 32, 64];
  const STEP_SEMIS = [0, 2, 4, 5, 7, 9, 11];
  const MAX_FIXES_KEPT = 200;           // fixes 목록에 자세히 남기는 개수(개수 집계는 전부 센다)

  const isString = v => typeof v === "string";
  const isBool = v => typeof v === "boolean";
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const isNameIn = list => v => typeof v === "string" && list.includes(v);
  const isIntArray = max => v => Array.isArray(v) && v.length <= max && v.every(Number.isInteger);
  const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const orNull = pred => v => v === null || pred(v);
  const clip = (text, max) => {
    if (text.length <= max) return text;              // 코드 단위 길이가 한도 이내면 코드 포인트도 한도 이내
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max).join("");
  };

  /** 값·깊이·길이를 반복문으로 훑어 한도를 넘는지 본다(재귀 없음). 넘으면 { code, path }, 아니면 null. */
  function scan(root) {
    const values = [root], depths = [1];
    let nodes = 1;
    while (values.length) {
      const value = values.pop(), depth = depths.pop();
      if (depth > LIMITS.depth) return { code: "TOO_DEEP", path: "score" };
      let children;
      if (Array.isArray(value)) {
        if (value.length > LIMITS.array) return { code: "TOO_LARGE", path: "score" };
        children = value;
        nodes += value.length;
      } else {
        children = Object.keys(value).map(key => value[key]);
        nodes += children.length;
      }
      if (nodes > LIMITS.nodes) return { code: "TOO_LARGE", path: "score" };
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child !== null && typeof child === "object") { values.push(child); depths.push(depth + 1); }
        else if (typeof child === "string" && child.length > LIMITS.string) return { code: "TOO_LARGE", path: "score" };
      }
    }
    return null;
  }

  /** 가장 큰 "e<번호>" id — 새 id를 붙일 때 겹치지 않게(처음 필요할 때 한 번만 센다). */
  function maxIdOf(root) {
    let max = 0;
    const stack = [root];
    while (stack.length) {
      const value = stack.pop();
      if (Array.isArray(value)) { for (const child of value) if (child !== null && typeof child === "object") stack.push(child); continue; }
      for (const key of Object.keys(value)) {
        const child = value[key];
        if (child !== null && typeof child === "object") stack.push(child);
        else if (key === "id" && typeof child === "string") { const m = /^e(\d+)$/.exec(child); if (m) max = Math.max(max, Number(m[1])); }
      }
    }
    return max;
  }

  /* ---- 조표·박자·마디 길이 ---- */
  const validKeySig = v => inRange(v, -7, 7);
  const validTimeSig = v => isObject(v) && inRange(v.num, 1, 32) && TIME_DENS.includes(v.den);
  const gcdN = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a || 1; };
  /** core Fraction.from과 같은 모양(배열 [n,d] · {n,d} · 정수)을 받아, 쓸 수 있으면 기약 [n,d], 아니면 null. */
  function lengthOf(value) {
    let n, d;
    if (Array.isArray(value)) { n = value[0]; d = value.length > 1 ? value[1] : 1; }
    else if (isObject(value)) { n = value.n; d = value.d === undefined ? 1 : value.d; }
    else if (typeof value === "number") { n = value; d = 1; }
    else return null;
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) return null;
    if (d < 0) { n = -n; d = -d; }
    if (n <= 0) return null;
    const g = gcdN(n, d);
    n /= g; d /= g;
    if (n > LIMITS.durPart || d > LIMITS.durPart || n > LIMITS.durBase * d) return null;
    return [n, d];
  }

  /* ---- BigInt 분수([n, d], d > 0, 기약) — 성부 길이 합을 정확히 센다 ---- */
  const gcdB = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
  const reduceB = (n, d) => { const g = gcdB(n < 0n ? -n : n, d); return g > 1n ? [n / g, d / g] : [n, d]; };
  const addB = (a, b) => a[1] === b[1] ? reduceB(a[0] + b[0], a[1]) : reduceB(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
  const cmpB = (a, b) => { const x = a[0] * b[1], y = b[0] * a[1]; return x < y ? -1 : x > y ? 1 : 0; };
  function durRat(dur) {
    const dots = BigInt(dur.dots || 0);
    let n = BigInt(dur.n) * ((1n << (dots + 1n)) - 1n), d = BigInt(dur.d) * (1n << dots);
    if (dur.tuplet) { n *= BigInt(dur.tuplet.normal || 2); d *= BigInt(dur.tuplet.actual || 3); }
    return reduceB(n, d);
  }
  /** 같은 길이를 정수로 빨리 셀 수 있는 보통 길이(잇단음표 없음·분모가 2의 거듭제곱)면 1/16384 단위 합, 아니면 -1. */
  function quickUnits(voice) {
    let sum = 0;
    for (const ev of voice) {
      const dur = ev.dur, d = dur.d;
      if (dur.tuplet || (d & (d - 1)) !== 0) return -1;
      const dots = dur.dots || 0;
      sum += dur.n * ((2 ** (dots + 1)) - 1) * (16384 / (d * 2 ** dots));
    }
    return sum;
  }
  const REST_BASES = [[2, 1, 128], [1, 1, 64], [1, 2, 32], [1, 4, 16], [1, 8, 8], [1, 16, 4], [1, 32, 2], [1, 64, 1]];   // n, d, 1/64 단위

  /* ---- 항목별 값 표(알려진 필드가 이 모양이 아니면 그 필드를 지운다 — 렌더·재생이 믿는 모양) ---- */
  const SCORE_FIELDS = {
    format: isString, clef: isNameIn(CLEF_NAMES), instrument: isString,
  };
  const PART_FIELDS = {
    id: isString, kind: isString, name: isString, shortName: isString, group: isString, instrument: isString,
    brace: orNull(isString), tuning: isIntArray(12), transpose: isObject,
  };
  const STAFF_FIELDS = {
    id: isString, name: isString, clef: isNameIn(CLEF_NAMES), staffType: isNameIn(STAFF_TYPES),
    instrumentType: isNameIn(INSTRUMENT_TYPES), staffIdx: isNum, linkedStaffId: isString,
  };
  const MEASURE_FIELDS = {
    startRepeat: isBool, endRepeat: isBool, repeatCount: isNum, endingStop: isBool, sectionName: isString,
    endingStart: v => v === null || isString(v) || isNum(v), breakType: orNull(isString), marker: orNull(isString),
    clef: isNameIn(CLEF_NAMES),
  };
  const EVENT_FIELDS = {
    dynamic: isString, soundFlag: isString, stemDirection: isString, notehead: isString, drumId: isString, ornament: isString,
    displayStep: isString, staffLine: isNum, displayOctave: isNum, midi: isNum,
    hidden: isBool, small: isBool, trillLine: isBool, full: isBool,
    tab: v => isObject(v) && (v.string === undefined || inRange(v.string, 1, 12)) && (v.fret === undefined || inRange(v.fret, 0, 40)),
    fretboard: v => isObject(v) && (v.strings === undefined || inRange(v.strings, 1, 12)) && (v.frets === undefined || inRange(v.frets, 1, 24)) &&
      (v.firstFret === undefined || inRange(v.firstFret, 1, 40)) && (v.positions === undefined || (Array.isArray(v.positions) && v.positions.length <= 12)),
  };

  function makeContext(raw) {
    const counts = new Map(), examples = new Map(), fixes = [];
    let idNext = null;
    return {
      root: null,
      raw,
      fixes, counts, examples,
      fix(rule, path) {
        counts.set(rule, (counts.get(rule) || 0) + 1);
        if (!examples.has(rule)) examples.set(rule, path);
        if (fixes.length < MAX_FIXES_KEPT) fixes.push({ path, rule, action: RULES[rule].action });
      },
      newId(root) {
        if (idNext === null) idNext = maxIdOf(root || this.root) + 1;
        return "e" + (idNext++);
      },
      /** 표(table)에 있는 필드가 올바른 모양이 아니면 지운다. */
      prune(obj, table, path, rule = "field") {
        for (const key of Object.keys(table)) {
          if (obj[key] !== undefined && !table[key](obj[key])) { delete obj[key]; this.fix(rule, `${path}.${key}`); }
        }
      },
    };
  }

  function summarize(ctx) {
    return [...ctx.counts].map(([rule, count]) => ({ rule, count, label: RULES[rule].label, example: ctx.examples.get(rule) }));
  }
  /** summary → 가져오기 결과 창에 보일 줄들("고친 내용 (N건)"). */
  function fixLines(summary) {
    return (summary || []).map(item => `${item.label} (${item.count}건)`);
  }

  /** 1차: 모양과 한도. 틀리면 ScoreFormatError를 던진다. 고칠 수 있는 곳(구버전 events·5번째 이후 성부)은 여기서 맞춘다. 돌려주는 값: 보표 목록. */
  function checkStructure(s, ctx) {
    if (!isObject(s)) fail("NOT_OBJECT", "score");
    if (s.measures !== undefined && !Array.isArray(s.measures)) fail("MEASURES_NOT_ARRAY", "measures");
    const staves = [];          // { staff, measuresPath, canonical }
    let totalEvents = 0;
    const checkMeasures = (measures, path) => {
      if (measures.length > LIMITS.measures) fail("TOO_MANY_MEASURES", path);
      measures.forEach((mm, m) => {
        const at = `${path}[${m}]`;
        if (!isObject(mm)) fail("MEASURE_NOT_OBJECT", at);
        if (!Array.isArray(mm.voices)) {
          if (mm.voices === undefined && Array.isArray(mm.events)) mm.voices = [mm.events];       // 구버전: 성부 없이 events만
          else fail(mm.voices === undefined ? "VOICES_MISSING" : "VOICES_NOT_ARRAY", `${at}.voices`);
        }
        delete mm.events;                                                                       // 옛 별칭(core가 접근자로 다시 만든다)
        if (mm.voices.length > LIMITS.voices) { mm.voices.length = LIMITS.voices; ctx.fix("voices", `${at}.voices`); }
        mm.voices.forEach((voice, v) => {
          if (!Array.isArray(voice)) fail("VOICE_NOT_ARRAY", `${at}.voices[${v}]`);
          totalEvents += voice.length;
          if (totalEvents > LIMITS.events) fail("TOO_MANY_EVENTS", `${at}.voices[${v}]`);
          voice.forEach((event, e) => {
            const where = `${at}.voices[${v}][${e}]`;
            if (!isObject(event)) fail("EVENT_NOT_OBJECT", where);
            const dur = event.dur;
            if (!isObject(dur) || !positiveInteger(dur.n) || !positiveInteger(dur.d)) fail("BAD_DURATION", `${where}.dur`);
          });
        });
      });
    };
    if (Array.isArray(s.parts)) {
      if (s.parts.length > LIMITS.staffTotal) fail("TOO_MANY_STAVES", "parts");
      s.parts.forEach((part, p) => {
        const partPath = `parts[${p}]`;
        if (!isObject(part)) fail("PART_NOT_OBJECT", partPath);
        if (!Array.isArray(part.staves)) fail("STAVES_NOT_ARRAY", `${partPath}.staves`);
        if (part.staves.length > LIMITS.staves) fail("TOO_MANY_STAVES", `${partPath}.staves`);
        part.staves.forEach((staff, i) => {
          const staffPath = `${partPath}.staves[${i}]`;
          if (!isObject(staff)) fail("STAFF_NOT_OBJECT", staffPath);
          if (!Array.isArray(staff.measures)) fail("MEASURES_NOT_ARRAY", `${staffPath}.measures`);
          checkMeasures(staff.measures, `${staffPath}.measures`);
          staves.push({ staff, measuresPath: `${staffPath}.measures`, canonical: p === 0 && i === 0 });
          if (staves.length > LIMITS.staffTotal) fail("TOO_MANY_STAVES", staffPath);
        });
      });
      // 최상위 measures는 v1 파일이 같은 마디를 한 번 더 적어 둔 사본이다 — 첫 보표에 마디가 있으면 core가 무시하니 버린다.
      if (Array.isArray(s.parts[0]?.staves?.[0]?.measures)) delete s.measures;
      else if (Array.isArray(s.measures)) {
        checkMeasures(s.measures, "measures");
        staves.push({ staff: { measures: s.measures }, measuresPath: "measures", canonical: !s.parts[0]?.staves?.[0] });
      }
    } else if (s.parts === undefined && Array.isArray(s.measures)) {
      checkMeasures(s.measures, "measures");                                                    // 구버전: parts 없이 measures만
      staves.push({ staff: { measures: s.measures }, measuresPath: "measures", canonical: true });
    } else fail(s.parts === undefined ? "PARTS_MISSING" : "PARTS_NOT_ARRAY", "parts");
    let longest = 0;
    for (const { staff } of staves) longest = Math.max(longest, staff.measures.length);
    if (staves.length * longest > LIMITS.cells) fail("TOO_LARGE", "score");
    return staves;
  }

  /** 곡 전체 값(곡 정보·조표·박자·템포·재생·배치·구간 요소). */
  function fixScore(s, ctx) {
    if (!isObject(s.meta)) { s.meta = { title: "", composer: "" }; ctx.fix("meta", "meta"); }   // 곡 정보가 없으면 제목·저작자 자리가 없어 내보내기·창 제목에서 멈춘다
    {
      for (const key of Object.keys(s.meta)) {
        const value = s.meta[key];
        if (value === undefined || value === null) continue;
        if (key === "title" || key === "composer" || key === "subtitle" || key === "lyricist" || key === "copyright") {
          if (typeof value !== "string") { delete s.meta[key]; ctx.fix("meta", `meta.${key}`); }
          else if (value.length > LIMITS.title) { const cut = clip(value, LIMITS.title); if (cut !== value) { s.meta[key] = cut; ctx.fix("meta", `meta.${key}`); } }
        }
      }
    }
    ctx.prune(s, SCORE_FIELDS, "score");
    if (s.keySig !== undefined && !validKeySig(s.keySig)) { s.keySig = 0; ctx.fix("signature", "keySig"); }
    if (s.timeSig !== undefined && !validTimeSig(s.timeSig)) { s.timeSig = { num: 4, den: 4 }; ctx.fix("signature", "timeSig"); }
    if (s.tempo !== undefined) {
      const t = typeof s.tempo === "number" ? s.tempo : (typeof s.tempo === "string" && s.tempo.trim() !== "" ? Number(s.tempo) : NaN);
      if (!Number.isFinite(t)) { s.tempo = 100; ctx.fix("tempo", "tempo"); }
      else if (t !== s.tempo || t < LIMITS.tempoMin || t > LIMITS.tempoMax) { s.tempo = Math.min(LIMITS.tempoMax, Math.max(LIMITS.tempoMin, t)); ctx.fix("tempo", "tempo"); }
    }
    for (const key of ["activePartIdx", "activeStaffIdx"]) {
      if (s[key] !== undefined && !inRange(s[key], 0, 1000000)) { s[key] = 0; ctx.fix("field", key); }
    }
    // 재생 설정
    if (s.playbackSettings !== undefined) {
      const ps = s.playbackSettings;
      if (!isObject(ps)) { delete s.playbackSettings; ctx.fix("field", "playbackSettings"); }
      else {
        if (ps.swing !== undefined && !isString(ps.swing)) { delete ps.swing; ctx.fix("field", "playbackSettings.swing"); }
        if (ps.mixer !== undefined) {
          if (!isObject(ps.mixer)) { delete ps.mixer; ctx.fix("field", "playbackSettings.mixer"); }
          else for (const id of Object.keys(ps.mixer)) {
            const rec = ps.mixer[id], at = `playbackSettings.mixer.${id}`;
            if (!isObject(rec)) { delete ps.mixer[id]; ctx.fix("field", at); continue; }
            ctx.prune(rec, { mute: isBool, solo: isBool, volume: isNum, pan: isNum }, at);
          }
        }
      }
    }
    // 배치·스타일
    if (s.layout !== undefined) {
      if (!isObject(s.layout)) { delete s.layout; ctx.fix("field", "layout"); }
      else ctx.prune(s.layout, {
        pageSize: isString, orientation: isString, width: isNum, height: isNum, marginTop: isNum, marginRight: isNum, marginBottom: isNum,
        marginLeft: isNum, staffScale: isNum, systemGap: isNum, staffGap: isNum, noteSpacing: isNum, beamThickness: isNum, measuresPerSystem: isNum,
      }, "layout");
    }
    if (s.style !== undefined && !isObject(s.style)) { delete s.style; ctx.fix("field", "style"); }
    // 이음줄·옥타브 같은 구간 요소(id가 가리키는 이벤트가 없으면 core가 걸러 낸다)
    if (s.spanners !== undefined) {
      if (!Array.isArray(s.spanners)) { s.spanners = []; ctx.fix("field", "spanners"); }
      else {
        const seen = new Set();
        const kept = s.spanners.filter((sp, i) => {
          let ok = isObject(sp) && isString(sp.startId) && isString(sp.endId);
          if (ok) {                                                  // 같은 구간 요소를 여러 번 적은 것(의미가 같다)은 하나만 둔다
            const key = `${sp.type}|${sp.startId}|${sp.endId}|${sp.shift}`;
            if (seen.has(key)) ok = false; else seen.add(key);
          }
          if (!ok) ctx.fix("field", `spanners[${i}]`);
          return ok;
        });
        if (kept.length !== s.spanners.length) s.spanners = kept;
      }
    }
  }

  /** 악기·보표의 알려진 필드. */
  function fixParts(s, ctx) {
    if (!Array.isArray(s.parts)) return;
    s.parts.forEach((part, p) => {
      ctx.prune(part, PART_FIELDS, `parts[${p}]`);
      part.staves.forEach((staff, i) => ctx.prune(staff, STAFF_FIELDS, `parts[${p}].staves[${i}]`));
    });
  }

  /** 마디의 조표·박자·길이·알려진 필드. */
  function fixMeasureMeta(mm, path, ctx) {
    ctx.prune(mm, MEASURE_FIELDS, path);
    if (mm.keySig !== undefined && mm.keySig !== null && !validKeySig(mm.keySig)) { delete mm.keySig; ctx.fix("signature", `${path}.keySig`); }
    if (mm.timeSig !== undefined && mm.timeSig !== null && !validTimeSig(mm.timeSig)) { delete mm.timeSig; ctx.fix("signature", `${path}.timeSig`); }
    for (const key of ["length", "pickup"]) {
      if (mm[key] !== undefined && mm[key] !== null && !lengthOf(mm[key])) { delete mm[key]; ctx.fix("signature", `${path}.${key}`); }
    }
  }

  /** 첫 보표의 마디별 길이 [n, d] — core timingOf와 같은 규칙(박자표는 이어받고, 첫 마디의 pickup·마디 length가 우선). 합의 분모가 너무 커지면 그 마디의 length를 지운다. */
  function measureLengths(s, canonical, ctx, path) {
    let ts = validTimeSig(s.timeSig) ? s.timeSig : { num: 4, den: 4 };
    const lens = [];
    let start = [0n, 1n];
    canonical.forEach((mm, m) => {
      if (mm.timeSig != null) ts = mm.timeSig;
      const pick = (key) => (mm[key] != null ? lengthOf(mm[key]) : null);
      let len = (m === 0 && mm.pickup != null ? pick("pickup") : pick("length")) || [ts.num, ts.den];
      let end = addB(start, [BigInt(len[0]), BigInt(len[1])]);
      if (end[1] > BigInt(LIMITS.lengthDen)) {                       // 마디 길이를 이어 붙인 합이 core의 정수 계산을 벗어난다
        delete mm.length; if (m === 0) delete mm.pickup;
        ctx.fix("signature", `${path}[${m}].length`);
        len = [ts.num, ts.den];
        end = addB(start, [BigInt(len[0]), BigInt(len[1])]);
      }
      lens.push(len); start = end;
    });
    const tail = [ts.num, ts.den];                                  // 마디 목록이 끝난 뒤(다른 보표가 더 긴 경우)에 core가 쓰는 길이
    const g = gcdN(tail[0], tail[1]);
    return { lens, tail: [tail[0] / g, tail[1] / g] };
  }

  /** 음높이 하나가 쓸 만한가. 고칠 수 있는 것(alter 빠짐)은 고쳐서 true. */
  function fixPitch(note) {
    if (!isObject(note)) return false;
    if (note.alter === undefined || note.alter === null) note.alter = 0;
    if (!inRange(note.step, 0, 6) || !inRange(note.alter, -2, 2) || !Number.isInteger(note.oct)) return false;
    const midi = (note.oct + 1) * 12 + STEP_SEMIS[note.step] + note.alter;
    return midi >= 0 && midi <= 127;
  }

  /** 음 목록에서 쓸 수 있는 음만 남긴다(alter가 빠진 음은 0으로 채워 남김). 돌려주는 값: { kept, changed } — changed는 지웠거나 채웠는지. */
  function fixNotes(notes) {
    let changed = false;
    const kept = notes.filter(note => {
      const hadAlter = isObject(note) && note.alter !== undefined && note.alter !== null;
      const ok = fixPitch(note);
      if (!ok || !hadAlter) changed = true;
      return ok;
    });
    return { kept, changed };
  }

  /** 이벤트 하나. 지워야 하면 false(둘레 성부 길이 규칙이 쉼표로 메운다). */
  function fixEvent(ev, path, ctx) {
    const dur = ev.dur;
    if (dur.n > LIMITS.durPart || dur.d > LIMITS.durPart || dur.n > LIMITS.durBase * dur.d) { ctx.fix("hugeDuration", `${path}.dur`); return false; }
    if (dur.dots !== undefined && !inRange(dur.dots, 0, 2)) {
      dur.dots = Number.isInteger(dur.dots) ? Math.max(0, Math.min(2, dur.dots)) : 0;
      ctx.fix("duration", `${path}.dur.dots`);
    }
    if (dur.tuplet !== undefined) {
      const t = dur.tuplet;
      if (!isObject(t) || (t.actual !== undefined && !inRange(t.actual, 2, 9)) || (t.normal !== undefined && !inRange(t.normal, 1, 16))) {
        delete dur.tuplet; ctx.fix("duration", `${path}.dur.tuplet`);
      }
    }
    if (ev.id === undefined || typeof ev.id !== "string") { ev.id = ctx.newId(); ctx.fix("id", `${path}.id`); }
    // 음
    if (ev.notes !== undefined && !Array.isArray(ev.notes)) { ev.notes = []; ctx.fix("field", `${path}.notes`); }
    if (Array.isArray(ev.notes)) {
      const { kept, changed } = fixNotes(ev.notes);
      if (changed) { ev.notes = kept; ctx.fix("pitch", `${path}.notes`); }
    }
    if (ev.type !== "note" && ev.type !== "rest") {
      ev.type = Array.isArray(ev.notes) && ev.notes.length ? "note" : "rest";
      ctx.fix("eventType", `${path}.type`);
    }
    if (ev.type === "note" && !(Array.isArray(ev.notes) && ev.notes.length)) { ev.type = "rest"; ev.notes = []; ctx.fix("emptyNote", path); }
    // 장식·글자·숫자
    ctx.prune(ev, EVENT_FIELDS, path);
    for (const [key, max] of [["rehearsal", LIMITS.rehearsal], ["staffText", LIMITS.staffText]]) {
      if (typeof ev[key] === "string" && ev[key].length > max) { const cut = clip(ev[key], max); if (cut !== ev[key]) { ev[key] = cut; ctx.fix("text", `${path}.${key}`); } }
    }
    if (ev.chordSymbol !== undefined) {
      const c = ev.chordSymbol;
      if (typeof c === "string") { const cut = clip(c, LIMITS.chord); if (cut !== c) { ev.chordSymbol = cut; ctx.fix("text", `${path}.chordSymbol`); } }
      else if (isObject(c)) {
        for (const key of ["raw", "normalized"]) if (typeof c[key] === "string") { const cut = clip(c[key], LIMITS.chord); if (cut !== c[key]) { c[key] = cut; ctx.fix("text", `${path}.chordSymbol.${key}`); } }
      }
    }
    if (ev.tempo !== undefined) {
      const t = typeof ev.tempo === "number" ? ev.tempo : (typeof ev.tempo === "string" && ev.tempo.trim() !== "" ? Number(ev.tempo) : NaN);
      if (!Number.isFinite(t)) { delete ev.tempo; ctx.fix("tempo", `${path}.tempo`); }
      else if (t !== ev.tempo || t < LIMITS.tempoMin || t > LIMITS.tempoMax) { ev.tempo = Math.min(LIMITS.tempoMax, Math.max(LIMITS.tempoMin, t)); ctx.fix("tempo", `${path}.tempo`); }
    }
    if (ev.artics !== undefined) {
      if (!Array.isArray(ev.artics)) { delete ev.artics; ctx.fix("field", `${path}.artics`); }
      else if (!ev.artics.every(isString)) { ev.artics = ev.artics.filter(isString); ctx.fix("field", `${path}.artics`); }
    }
    if (ev.lyrics !== undefined && !Array.isArray(ev.lyrics)) { delete ev.lyrics; ctx.fix("field", `${path}.lyrics`); }
    if (ev.graceBefore !== undefined) {
      if (!Array.isArray(ev.graceBefore)) { delete ev.graceBefore; ctx.fix("field", `${path}.graceBefore`); }
      else {
        let pitchChanged = false;
        const kept = ev.graceBefore.filter(g => {
          if (!isObject(g)) return false;
          if (g.notes !== undefined && !Array.isArray(g.notes)) return false;
          const d = g.dur;
          if (d !== undefined && !(isObject(d) && positiveInteger(d.n) && positiveInteger(d.d) && d.n <= LIMITS.durPart && d.d <= LIMITS.durPart && d.n <= d.d)) return false;
          if (g.id !== undefined && !isString(g.id)) return false;
          if (g.kind !== undefined && !isString(g.kind)) return false;
          if (Array.isArray(g.notes)) {
            const fixed = fixNotes(g.notes);
            if (fixed.changed) { g.notes = fixed.kept; pitchChanged = true; }      // 장식음의 음높이를 고치거나 지운 것도 목록에 남긴다
            if (!g.notes.length) return false;
          }
          return true;
        });
        if (pitchChanged) ctx.fix("pitch", `${path}.graceBefore`);
        if (kept.length !== ev.graceBefore.length) { ev.graceBefore = kept; ctx.fix("field", `${path}.graceBefore`); }
      }
    }
    return true;
  }

  /** 성부의 이벤트 길이 합이 마디 길이와 같도록 맞춘다. 같으면 같은 배열, 맞출 수 없으면 [] (core가 온마디쉼표로 다시 채운다). */
  function fitVoice(voice, L, ctx) {
    const exact = (L[1] & (L[1] - 1)) === 0 && L[1] <= 16384 ? L[0] * (16384 / L[1]) : -1;
    if (exact >= 0) { const sum = quickUnits(voice); if (sum === exact) return voice; }
    const Lb = [BigInt(L[0]), BigInt(L[1])], maxDen = BigInt(LIMITS.lengthDen);
    let cum = [0n, 1n], count = 0, broke = false;
    for (; count < voice.length; count++) {
      const next = addB(cum, durRat(voice[count].dur));
      if (next[1] > maxDen) return [];                    // 합의 분모가 core 계산 범위를 벗어난다
      if (cmpB(next, Lb) > 0) { broke = true; break; }
      cum = next;
    }
    if (!broke && cmpB(cum, Lb) === 0) return voice;
    if (count === 0) return [];
    const kept = voice.slice(0, count);
    const gap = reduceB(Lb[0] * cum[1] - cum[0] * Lb[1], Lb[1] * cum[1]);          // L - cum > 0
    if (64n % gap[1] !== 0n) return [];                                              // 쉼표(2의 거듭제곱 분모)로 메울 수 없는 길이
    let units = Number(gap[0] * (64n / gap[1]));
    for (const [n, d, size] of REST_BASES) {
      while (units >= size) { kept.push({ id: ctx.newId(), type: "rest", dur: { n, d, dots: 0 }, notes: [] }); units -= size; }
    }
    return kept;
  }

  /** 모양과 값을 검사해 고친 사본을 돌려준다. 던지지 않는다. */
  function validate(raw) {
    const ctx = makeContext(raw);
    try {
      if (!isObject(raw)) fail("NOT_OBJECT", "score");
      const bad = scan(raw);
      if (bad) fail(bad.code, bad.path);
      const score = JSON.parse(JSON.stringify(raw));                 // 깊이·크기를 이미 쟀으니 안전하다. 원본은 건드리지 않는다.
      ctx.root = score;
      const staves = checkStructure(score, ctx);
      fixScore(score, ctx);
      fixParts(score, ctx);
      for (const { staff, measuresPath } of staves) staff.measures.forEach((mm, m) => fixMeasureMeta(mm, `${measuresPath}[${m}]`, ctx));
      const canonical = staves.find(entry => entry.canonical);
      const timing = measureLengths(score, canonical ? canonical.staff.measures : [], ctx, canonical ? canonical.measuresPath : "measures");
      for (const { staff, measuresPath: base } of staves) {
        staff.measures.forEach((mm, m) => {
          const L = timing.lens[m] || timing.tail;
          mm.voices.forEach((voice, v) => {
            const at = `${base}[${m}].voices[${v}]`;
            let alive = voice;
            const survivors = [];
            for (let e = 0; e < voice.length; e++) if (fixEvent(voice[e], `${at}[${e}]`, ctx)) survivors.push(voice[e]);
            if (survivors.length !== voice.length) alive = survivors;
            if (alive.length) {
              const fitted = fitVoice(alive, L, ctx);
              if (fitted !== alive) { alive = fitted; ctx.fix("voiceLength", at); }
            }
            if (alive !== voice) mm.voices[v] = alive;
          });
        });
      }
      return { score, fixes: ctx.fixes, summary: summarize(ctx), fatal: null };
    } catch (error) {
      const fatal = error instanceof ScoreFormatError ? error : new ScoreFormatError("INTERNAL", String(error && error.message || error).slice(0, 120));
      return { score: null, fixes: ctx.fixes, summary: summarize(ctx), fatal };
    }
  }

  SF.schema = { checkShape, ScoreFormatError, validate, fixLines, LIMITS, RULES, REASONS };
})(window.SF);
