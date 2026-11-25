/* js/schema.js — 저장소 기록(악보 JSON)의 모양을 가볍게 확인한다(P2-E).
 * 화면을 그리다 멈추거나 죽게 만드는 "모양이 틀린" 기록만 걸러 낸다: 배열이어야 할 곳이 배열인지,
 * 음표 길이(dur)의 n·d가 양의 정수인지. 음높이·가사 같은 내용은 보지 않는다(본 검사는 8-2).
 * 저장소 기록은 항상 core.toJSON이 정규화한 모양(parts → staves → measures → voices)이라 그 모양을 그대로 요구한다.
 * 다른 모듈은 SF.schema?.checkShape로 부른다(이 파일 없이 로드되는 테스트가 있다). 이 모듈은 core·DOM에 기대지 않는다. */
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

  SF.schema = { checkShape, ScoreFormatError };
})(window.SF);
