// P9-3 시험 도구: ZIP 독립 파서. js/zip.js와 같은 코드를 다시 쓰지 않고 바이트를 엄격하게 읽는다(비트 단위 CRC32 포함).
//  tests/zip.test.mjs(작성기 단위 시험)와 tests/export-p93-browser.test.mjs(실제 내려받은 파일)가 함께 쓴다.
import assert from 'node:assert/strict';

const dec = new TextDecoder('utf-8', { fatal: true });

// 표 없이 비트 단위로 계산하는 CRC32(작성기의 표 방식과 구현이 다르다)
export function crcBitwise(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 무압축 ZIP을 엄격하게 읽는다. 어긋나면 바로 실패시킨다.
export function dosToParts(time, date) {
  return { year: 1980 + (date >> 9), month: (date >> 5) & 15, day: date & 31, hour: time >> 11, minute: (time >> 5) & 63, second: (time & 31) * 2 };
}
export function parseZip(u8) {
  assert.ok(u8 instanceof Uint8Array, 'Uint8Array를 돌려준다');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  assert.ok(u8.length >= 22, '끝 기록(22바이트)보다 짧다');
  const eocd = u8.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, '파일 끝에 끝 기록(주석 없음)');
  assert.equal(dv.getUint16(eocd + 4, true), 0, '이 디스크 번호');
  assert.equal(dv.getUint16(eocd + 6, true), 0, '중앙 디렉터리가 시작하는 디스크');
  const countHere = dv.getUint16(eocd + 8, true), count = dv.getUint16(eocd + 10, true);
  assert.equal(countHere, count, '이 디스크의 항목 수 = 전체 항목 수');
  const cdSize = dv.getUint32(eocd + 12, true), cdOffset = dv.getUint32(eocd + 16, true);
  assert.equal(dv.getUint16(eocd + 20, true), 0, '주석 길이 0');
  assert.equal(cdOffset + cdSize + 22, u8.length, '중앙 디렉터리 바로 뒤가 끝 기록, 그 뒤는 없다');
  const entries = [];
  let central = cdOffset, local = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(central, true), 0x02014b50, `중앙 디렉터리 ${i} 서명`);
    const e = {
      madeBy: dv.getUint16(central + 4, true), needed: dv.getUint16(central + 6, true), flags: dv.getUint16(central + 8, true),
      method: dv.getUint16(central + 10, true), time: dv.getUint16(central + 12, true), date: dv.getUint16(central + 14, true),
      crc: dv.getUint32(central + 16, true), csize: dv.getUint32(central + 20, true), size: dv.getUint32(central + 24, true),
      nameLength: dv.getUint16(central + 28, true), extraLength: dv.getUint16(central + 30, true), commentLength: dv.getUint16(central + 32, true),
      disk: dv.getUint16(central + 34, true), internal: dv.getUint16(central + 36, true), external: dv.getUint32(central + 38, true),
      offset: dv.getUint32(central + 42, true),
    };
    e.name = dec.decode(u8.subarray(central + 46, central + 46 + e.nameLength));
    assert.equal(e.extraLength, 0, `${e.name}: 추가 필드 없음`);
    assert.equal(e.commentLength, 0, `${e.name}: 주석 없음`);
    assert.equal(e.disk, 0); assert.equal(e.internal, 0); assert.equal(e.external, 0);
    assert.equal(e.method, 0, `${e.name}: 무압축`);
    assert.equal(e.flags, 0x0800, `${e.name}: UTF-8 이름 플래그만`);
    assert.equal(e.needed, 20, `${e.name}: 필요한 버전 2.0`);
    assert.ok((e.madeBy & 255) >= 20, `${e.name}: 만든 버전`);
    assert.equal(e.csize, e.size, `${e.name}: 무압축이라 두 크기가 같다`);
    // 로컬 헤더는 앞에서부터 빈틈 없이 이어진다
    assert.equal(e.offset, local, `${e.name}: 로컬 헤더 위치`);
    assert.equal(dv.getUint32(local, true), 0x04034b50, `${e.name}: 로컬 헤더 서명`);
    assert.equal(dv.getUint16(local + 4, true), e.needed, `${e.name}: 로컬 필요 버전`);
    assert.equal(dv.getUint16(local + 6, true), e.flags, `${e.name}: 로컬 플래그`);
    assert.equal(dv.getUint16(local + 8, true), e.method, `${e.name}: 로컬 방식`);
    assert.equal(dv.getUint16(local + 10, true), e.time, `${e.name}: 로컬 시각`);
    assert.equal(dv.getUint16(local + 12, true), e.date, `${e.name}: 로컬 날짜`);
    assert.equal(dv.getUint32(local + 14, true), e.crc, `${e.name}: 로컬 CRC`);
    assert.equal(dv.getUint32(local + 18, true), e.csize, `${e.name}: 로컬 압축 크기`);
    assert.equal(dv.getUint32(local + 22, true), e.size, `${e.name}: 로컬 원래 크기`);
    assert.equal(dv.getUint16(local + 26, true), e.nameLength, `${e.name}: 로컬 이름 길이`);
    assert.equal(dv.getUint16(local + 28, true), 0, `${e.name}: 로컬 추가 필드 없음`);
    assert.equal(dec.decode(u8.subarray(local + 30, local + 30 + e.nameLength)), e.name, `${e.name}: 로컬 이름`);
    e.data = u8.slice(local + 30 + e.nameLength, local + 30 + e.nameLength + e.size);
    assert.equal(e.data.length, e.size, `${e.name}: 자료가 잘리지 않음`);
    assert.equal(crcBitwise(e.data), e.crc, `${e.name}: CRC32가 자료와 맞다`);
    local += 30 + e.nameLength + e.size;
    central += 46 + e.nameLength;
    entries.push(e);
  }
  assert.equal(local, cdOffset, '마지막 자료 바로 뒤에 중앙 디렉터리가 시작한다');
  assert.equal(central, cdOffset + cdSize, '중앙 디렉터리 크기가 항목 합과 같다');
  return { entries, cdOffset, cdSize, count };
}
