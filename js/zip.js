/* =========================================================================
 * ScoreForge zip — 의존성 없는 무압축(stored) ZIP 작성기
 *  여러 쪽 SVG·PNG 내보내기를 파일 하나로 묶는 데 쓴다. 압축은 하지 않는다(SVG는 글꼴이 base64로 들어 있어 거의 줄지 않고 PNG는 이미 압축돼 있다).
 *  읽기(.mxl)는 io.js의 readMxl이 맡는다. 여기는 쓰기만 한다.
 *  문서·DOM·저장소·네트워크를 쓰지 않는 순수 함수라 Node 시험이 그대로 돌린다.
 *  ZIP64는 만들지 않는다 — 항목 65,534개·전체 4GB 미만까지만 받고 넘으면 RangeError로 거절한다.
 * ========================================================================= */
"use strict";
(function (SF) {
  /** 기본 한도. 65,535·0xffffffff는 ZIP64 표시값이라 하나씩 모자란 값을 쓴다. options.limits로는 낮출 수만 있다. */
  const LIMITS = Object.freeze({ entries: 0xfffe, bytes: 0xfffffffe });

  /* ---------------- CRC-32 (IEEE 802.3, 반사형 0xedb88320) ---------------- */
  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }

  const encoder = new TextEncoder();
  // ArrayBuffer인지는 내부 슬롯으로 확인한다: 다른 Realm(iframe 등)의 것도 받고, toStringTag를 흉내 낸 객체는 거절한다.
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
  function isArrayBuffer(value) {
    try { bufferLength.call(value); return true; } catch (error) { return false; }
  }

  /** 문자열(UTF-8)·ArrayBuffer·ArrayBuffer 보기(Uint8Array 등)를 바이트 보기로 바꾼다. 복사하지 않는다(문자열은 새로 만든다). */
  function bytesOf(data) {
    if (typeof data === "string") return encoder.encode(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (isArrayBuffer(data)) return new Uint8Array(data);
    throw new TypeError("ZIP에 넣을 자료 형식이 올바르지 않아요.");
  }

  /** CRC-32를 부호 없는 32비트 정수로. seed에 앞부분의 결과를 주면 이어서 계산한다. */
  function crc32(data, seed = 0) {
    const bytes = bytesOf(data);
    let crc = ~seed >>> 0;
    for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return ~crc >>> 0;
  }

  /* ---------------- 검사 ---------------- */
  const tooBig = () => new RangeError("내보낼 파일이 너무 커서 ZIP으로 묶을 수 없어요.");

  /** 이름: 비어 있지 않은 "/" 구분 경로. 빈 구간·"."·".."·절대 경로·역슬래시·드라이브 글자·제어 문자는 풀 때 다른 곳에 쓰이거나 덮어쓸 수 있어 거절한다. */
  function checkName(name) {
    const shown = typeof name === "string" ? name.slice(0, 40) : typeof name;
    const bad = () => new TypeError(`ZIP 파일 이름이 올바르지 않아요: ${shown}`);
    if (typeof name !== "string") throw bad();
    if (/[\u0000-\u001f\u007f\\]/.test(name) || /^[A-Za-z]:/.test(name)) throw bad();
    for (const part of name.split("/")) if (part === "" || part === "." || part === "..") throw bad();
    const bytes = encoder.encode(name);
    if (bytes.length > 0xffff) throw new TypeError(`ZIP 파일 이름이 너무 길어요: ${shown}…`);
    return bytes;
  }

  function limitOf(given, max) {
    if (given === undefined) return max;
    if (typeof given !== "number" || !(given >= 0)) throw new TypeError("ZIP 한도 값이 올바르지 않아요.");
    return Math.min(given, max);
  }

  /** DOS 시각(2초 단위, 지역 시각). 1980-01-01 00:00:00 ~ 2107-12-31 23:59:58 밖은 가까운 쪽 끝으로 맞춘다. */
  function dosStamp(when) {
    if (Object.prototype.toString.call(when) !== "[object Date]" || !Number.isFinite(when.getTime())) throw new TypeError("ZIP 시각이 올바르지 않아요.");
    const year = when.getFullYear();
    if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
    if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
    return {
      time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    };
  }

  /* ---------------- 쓰기 ---------------- */
  /**
   * entries: [{ name, data }] — name은 ZIP 안의 경로("/" 구분, UTF-8), data는 문자열·ArrayBuffer·보기.
   * options: { date: Date(기본 지금), limits: { entries, bytes } } — 한도는 기본값보다 낮게만 줄 수 있다.
   * 돌려주는 값: 새 Uint8Array(입력과 독립). 잘못된 입력은 TypeError, 한도를 넘으면 RangeError(같은 입력이면 같은 바이트).
   */
  function create(entries, options = {}) {
    if (!Array.isArray(entries)) throw new TypeError("ZIP에 넣을 파일 목록이 올바르지 않아요.");
    const given = options.limits === undefined ? {} : options.limits;
    const limits = { entries: limitOf(given.entries, LIMITS.entries), bytes: limitOf(given.bytes, LIMITS.bytes) };
    const stamp = dosStamp(options.date === undefined ? new Date() : options.date);
    if (entries.length > limits.entries) throw tooBig();

    const seen = new Set();
    const files = entries.map(entry => {
      if (entry === null || typeof entry !== "object") throw new TypeError("ZIP에 넣을 파일 정보가 올바르지 않아요.");
      const nameBytes = checkName(entry.name);
      const key = entry.name.toLowerCase();       // 대소문자를 가리지 않는 파일 시스템에서는 한 파일로 덮이므로 같은 이름으로 본다
      if (seen.has(key)) throw new TypeError(`ZIP 파일 이름이 겹쳐요: ${entry.name.slice(0, 40)}`);
      seen.add(key);
      const data = bytesOf(entry.data);
      return { nameBytes, data, crc: crc32(data) };
    });

    let total = 22;                                // 끝 기록
    for (const file of files) total += 30 + 46 + 2 * file.nameBytes.length + file.data.length;
    if (total > limits.bytes) throw tooBig();

    const out = new Uint8Array(total), view = new DataView(out.buffer);
    let pos = 0;
    const u16 = value => { view.setUint16(pos, value, true); pos += 2; };
    const u32 = value => { view.setUint32(pos, value, true); pos += 4; };
    const raw = bytes => { out.set(bytes, pos); pos += bytes.length; };

    const offsets = [];
    for (const file of files) {                    // 로컬 헤더 + 자료
      offsets.push(pos);
      u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.date);
      u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.nameBytes.length); u16(0);
      raw(file.nameBytes); raw(file.data);
    }
    const directory = pos;
    files.forEach((file, i) => {                   // 중앙 디렉터리
      u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.date);
      u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.nameBytes.length);
      u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
      raw(file.nameBytes);
    });
    const size = pos - directory;
    u32(0x06054b50); u16(0); u16(0); u16(files.length); u16(files.length); u32(size); u32(directory); u16(0);   // 끝 기록
    return out;
  }

  SF.zip = { create, crc32, LIMITS };
})(window.SF);
