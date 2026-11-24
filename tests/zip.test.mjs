// P9-3: js/zip.js — 의존성 없는 무압축(stored) ZIP 작성기.
//  - 독립 파서(tests/zip-parse.mjs, 비트 단위 CRC32 포함)로 작성기와 같은 코드를 다시 쓰지 않고 바이트를 직접 검증한다.
//  - 거기에 python3 zipfile·unzip(있을 때)과 앱의 .mxl 읽기(SF.io.readMxl)로 교차 검사한다.
//  - 사람 확인(운영체제 기본 압축 해제로 열림)은 docs/REFACTOR_LOG.md의 "사람이 해야 할 일"에 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { SF } from './shim.mjs';
import { crcBitwise, dosToParts, parseZip } from './zip-parse.mjs';

vm.runInThisContext(readFileSync(new URL('../js/zip.js', import.meta.url), 'utf8'), { filename: 'zip.js' });
const Z = SF.zip;
const enc = new TextEncoder();
const bytes = text => enc.encode(text);

// ---- 1. CRC32 ----
test('P9-3 CRC32: 표준 시험 값(123456789 = cbf43926)과 이어 계산', () => {
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
  assert.equal(Z.crc32(bytes('123456789')), 0xcbf43926, '계산기 표준 값');
  assert.equal(Z.crc32(bytes('a')), 0xe8b7be43);
  assert.equal(Z.crc32(bytes('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  assert.equal(Z.crc32(new Uint8Array(1_000_000).fill(0x61)), 0xdc25bfbc, "'a' 100만 개");
  assert.equal(Z.crc32(new Uint8Array([0, 0, 0, 0])), 0x2144df1c, '0 네 바이트(초기값·마지막 XOR 확인)');
  assert.equal(Z.crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff])), 0xffffffff, '0xff 네 바이트');
  // 이어 계산: 앞부분의 결과를 seed로 넘기면 이어붙인 것과 같다
  const a = bytes('1234'), b = bytes('56789');
  assert.equal(Z.crc32(b, Z.crc32(a)), 0xcbf43926);
  assert.equal(Z.crc32(bytes('6789'), Z.crc32(bytes('12345'))), 0xcbf43926, '다른 자리에서 갈라도 같다');
  // 문자열은 UTF-8 바이트로 계산, 다른 자료형도 같은 값
  assert.equal(Z.crc32('한글🎼'), crcBitwise(bytes('한글🎼')));
  assert.equal(Z.crc32(new Uint8Array(bytes('123456789')).buffer), 0xcbf43926, 'ArrayBuffer');
  // 부호 없는 32비트 정수
  for (const text of ['', 'a', '123456789', 'zzzz', '\u0000\u0001']) {
    const value = Z.crc32(bytes(text));
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `${text}: ${value}`);
  }
  // 임의 자료는 독립 구현과 같다
  let seed = 12345;
  const random = new Uint8Array(5000).map(() => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255);
  assert.equal(Z.crc32(random), crcBitwise(random));
});

// ---- 2. 구조 ----
test('P9-3 ZIP: 항목이 없어도 올바른 끝 기록 하나(22바이트)', () => {
  const out = Z.create([]);
  assert.equal(out.length, 22);
  const parsed = parseZip(out);
  assert.equal(parsed.count, 0);
  assert.equal(parsed.cdSize, 0);
  assert.equal(parsed.cdOffset, 0);
});

test('P9-3 ZIP: 로컬 헤더·중앙 디렉터리·끝 기록·CRC가 독립 파서와 맞다(한글·이모지 이름, 0바이트, 모든 바이트 값, 1MB)', () => {
  const all = new Uint8Array(256).map((_, i) => i);
  let seed = 7;
  const big = new Uint8Array(1 << 20).map(() => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255);
  const files = [
    { name: '나비야-1.svg', data: '<svg>한글 🎼 가사</svg>' },
    { name: 'plain.txt', data: bytes('hello') },
    { name: '빈 파일.bin', data: new Uint8Array(0) },
    { name: 'all-bytes.bin', data: all },
    { name: 'folder/sub/🎼.png', data: big },
    { name: 'a..b', data: 'dots in the middle are fine' },
  ];
  const date = new Date(2026, 10, 25, 13, 45, 58);
  const out = Z.create(files, { date });
  const parsed = parseZip(out);
  assert.deepEqual(parsed.entries.map(e => e.name), files.map(f => f.name), '이름과 순서');
  parsed.entries.forEach((entry, i) => {
    const expected = typeof files[i].data === 'string' ? bytes(files[i].data) : files[i].data;
    assert.ok(Buffer.from(entry.data).equals(Buffer.from(expected)), `${entry.name}: 자료`);
    assert.equal(entry.size, expected.length);
    assert.deepEqual(dosToParts(entry.time, entry.date), { year: 2026, month: 11, day: 25, hour: 13, minute: 45, second: 58 }, `${entry.name}: 시각`);
  });
  assert.equal(parsed.entries[2].crc, 0, '0바이트 파일의 CRC는 0');
  assert.equal(parsed.entries[0].nameLength, bytes('나비야-1.svg').length, '이름 길이는 글자 수가 아니라 UTF-8 바이트 수');
  assert.notEqual(parsed.entries[0].nameLength, '나비야-1.svg'.length);
  // 전체 길이 = 로컬(30+이름+자료) 합 + 중앙(46+이름) 합 + 22
  const local = parsed.entries.reduce((n, e) => n + 30 + e.nameLength + e.size, 0);
  const central = parsed.entries.reduce((n, e) => n + 46 + e.nameLength, 0);
  assert.equal(out.length, local + central + 22);
  assert.equal(parsed.cdOffset, local);
  assert.equal(parsed.cdSize, central);
  assert.equal(parsed.count, files.length);
});

test('P9-3 ZIP: 문자열·ArrayBuffer·부분 보기·다른 Realm의 Uint8Array도 받는다', () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
  const foreign = vm.runInNewContext('new Uint8Array([7, 8, 9, 10])');
  assert.equal(foreign instanceof Uint8Array, false, '전제: 다른 Realm이라 instanceof가 거짓');
  const foreignBuffer = vm.runInNewContext('new Uint8Array([11, 12]).buffer');
  assert.equal(foreignBuffer instanceof ArrayBuffer, false, '전제: 다른 Realm의 ArrayBuffer도 instanceof가 거짓');
  const words = new Uint16Array([0x0201, 0x0403]);
  const out = Z.create([
    { name: 'text.txt', data: '한글' },
    { name: 'buffer.bin', data: new Uint8Array([5, 6]).buffer },
    { name: 'view.bin', data: backing.subarray(2, 5) },
    { name: 'foreign.bin', data: foreign },
    { name: 'foreign-buffer.bin', data: foreignBuffer },
    { name: 'words.bin', data: words },
  ], { date: new Date(2020, 0, 2, 3, 4, 6) });
  const got = Object.fromEntries(parseZip(out).entries.map(e => [e.name, Array.from(e.data)]));
  assert.deepEqual(got['text.txt'], Array.from(bytes('한글')));
  assert.deepEqual(got['buffer.bin'], [5, 6]);
  assert.deepEqual(got['view.bin'], [1, 2, 3], '부분 보기는 보이는 바이트만');
  assert.deepEqual(got['foreign.bin'], [7, 8, 9, 10]);
  assert.deepEqual(got['foreign-buffer.bin'], [11, 12], '다른 Realm의 ArrayBuffer');
  assert.deepEqual(got['words.bin'], [1, 2, 3, 4], '보기의 바이트(리틀엔디언)');
});

test('P9-3 ZIP: 입력을 바꾸지 않고, 만든 결과는 입력과 독립이며, 같은 입력이면 같은 바이트다', () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const files = [{ name: 'a.bin', data }];
  const date = new Date(2024, 5, 6, 7, 8, 10);
  const first = Z.create(files, { date });
  assert.deepEqual(Array.from(data), [1, 2, 3, 4], '입력 그대로');
  assert.deepEqual(files, [{ name: 'a.bin', data }], '입력 목록 그대로');
  data[0] = 99;                                   // 만든 뒤 입력을 바꿔도
  assert.deepEqual(Array.from(parseZip(first).entries[0].data), [1, 2, 3, 4], '결과는 영향을 받지 않는다');
  const second = Z.create([{ name: 'a.bin', data: new Uint8Array([1, 2, 3, 4]) }], { date });
  assert.ok(Buffer.from(first).equals(Buffer.from(second)), '결정적');
  first[0] ^= 1;                                  // 결과를 바꿔도 입력은 그대로
  assert.equal(data[0], 99);
});

// ---- 3. 시각 ----
test('P9-3 ZIP: DOS 시각(2초 단위·지역 시각)과 1980~2107 범위 맞춤, 시각을 안 주면 지금', () => {
  const stamp = (date, name = 'a') => { const [e] = parseZip(Z.create([{ name, data: 'x' }], { date })).entries; return { time: e.time, date: e.date, parts: dosToParts(e.time, e.date) }; };
  assert.deepEqual(stamp(new Date(2026, 10, 25, 13, 45, 58)).parts, { year: 2026, month: 11, day: 25, hour: 13, minute: 45, second: 58 });
  assert.equal(stamp(new Date(2026, 10, 25, 13, 45, 59)).parts.second, 58, '홀수 초는 내림');
  assert.equal(stamp(new Date(2026, 10, 25, 0, 0, 0)).time, 0);
  assert.deepEqual(stamp(new Date(2000, 1, 29, 23, 59, 58)).parts, { year: 2000, month: 2, day: 29, hour: 23, minute: 59, second: 58 });
  const low = stamp(new Date(1979, 11, 31, 23, 59, 59));
  assert.deepEqual(low.parts, { year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, '1980 이전은 1980-01-01 00:00:00');
  assert.equal(low.date, 33); assert.equal(low.time, 0);
  assert.deepEqual(stamp(new Date(1980, 0, 1, 0, 0, 0)).parts, { year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, '1980-01-01은 그대로');
  const high = stamp(new Date(2108, 0, 1, 0, 0, 0));
  assert.deepEqual(high.parts, { year: 2107, month: 12, day: 31, hour: 23, minute: 59, second: 58 }, '2107 이후는 2107-12-31 23:59:58');
  assert.deepEqual(stamp(new Date(2107, 11, 31, 23, 59, 58)).parts, { year: 2107, month: 12, day: 31, hour: 23, minute: 59, second: 58 }, '2107-12-31은 그대로');
  for (const bad of [new Date(NaN), '2020-01-01', 1700000000000, {}]) assert.throws(() => Z.create([], { date: bad }), TypeError, String(bad));
  const before = Date.now() - 4000, [e] = parseZip(Z.create([{ name: 'a', data: 'x' }])).entries, after = Date.now() + 4000;
  const parts = dosToParts(e.time, e.date), when = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second).getTime();
  assert.ok(when >= before && when <= after, `기본값은 지금: ${new Date(when).toISOString()}`);
});

// ---- 4. 검사 ----
test('P9-3 ZIP: 올바르지 않은 이름은 거절한다(경로 탈출·절대 경로·제어 문자·중복 …)', () => {
  const reject = (name, label = JSON.stringify(name)) => assert.throws(() => Z.create([{ name, data: 'x' }]), TypeError, `거절: ${label}`);
  reject('', '빈 이름');
  reject('/abs.svg', '절대 경로');
  reject('../escape.svg', '위 폴더');
  reject('a/../b.svg', '가운데 ..');
  reject('a/..', '끝 ..');
  reject('..', '..만');
  reject('./a.svg', '앞 .');
  reject('a/./b.svg', '가운데 .');
  reject('.', '.만');
  reject('a//b.svg', '빈 구간');
  reject('dir/', '끝 /(폴더 항목)');
  reject('a\\b.svg', '역슬래시');
  reject('C:/a.svg', '드라이브 글자');
  reject('c:a.svg', '드라이브 글자(슬래시 없음)');
  reject('a\u0000b.svg', 'NUL');
  reject('a\nb.svg', '줄바꿈');
  reject('a\tb.svg', '탭');
  reject('a\u001fb.svg', '제어 문자 0x1f');
  reject('a\u007fb.svg', 'DEL');
  reject('a'.repeat(65532) + '.svg', 'UTF-8 65,536바이트');
  reject('한'.repeat(21846), '한글 21,846자 = 65,538바이트(글자 수는 한도 안)');
  for (const bad of [null, undefined, 5, {}, ['a']]) reject(bad, `문자열 아님 ${String(bad)}`);
  assert.throws(() => Z.create([{ name: 'a.svg', data: 'x' }, { name: 'a.svg', data: 'y' }]), TypeError, '중복');
  assert.throws(() => Z.create([{ name: 'A.svg', data: 'x' }, { name: 'a.SVG', data: 'y' }]), TypeError, '대소문자만 다른 중복(대소문자를 가리지 않는 파일 시스템에서 덮어씀)');
  assert.throws(() => Z.create([{ name: 'ok.svg', data: 'x' }, { name: '../bad.svg', data: 'y' }]), TypeError, '뒤의 항목이 나빠도 거절');
});

test('P9-3 ZIP: 바로 옆 모양의 이름은 받는다(검사가 지나치게 넓지 않다)', () => {
  const names = ['a.svg', '한글.svg', 'dir/sub/a.svg', 'a..b.svg', '..a', 'a..', '...', '.hidden', 'a b.svg', 'ab:c.svg', 'a-1.svg', 'x'.repeat(65531) + '.svg',
    '한'.repeat(21845), '🎼'.repeat(16383), 'dir.with.dots/file', '1:a'];
  for (const name of names) {
    const out = Z.create([{ name, data: 'x' }]);
    assert.equal(parseZip(out).entries[0].name, name, name.length > 40 ? `${name.slice(0, 12)}…(${name.length}자)` : name);
  }
  // 다른 이름은 이어서 여러 개 가능
  assert.equal(parseZip(Z.create([{ name: 'a.svg', data: 'x' }, { name: 'b.svg', data: 'x' }, { name: 'a.svg.bak', data: 'x' }])).count, 3);
});

test('P9-3 ZIP: 자료나 목록이 올바르지 않으면 거절한다', () => {
  const spoof = { [Symbol.toStringTag]: 'ArrayBuffer', byteLength: 3 };
  for (const data of [undefined, null, 5, true, {}, [1, 2], new Blob(['x']), { length: 1 }, spoof, { [Symbol.toStringTag]: 'Uint8Array', length: 3 }, new SharedArrayBuffer(4)]) {
    assert.throws(() => Z.create([{ name: 'a', data }]), TypeError, `자료 ${Object.prototype.toString.call(data)}`);
  }
  assert.throws(() => Z.create(null), TypeError);
  assert.throws(() => Z.create({}), TypeError);
  assert.throws(() => Z.create('a'), TypeError);
  assert.throws(() => Z.create([null]), TypeError);
  assert.throws(() => Z.create([undefined]), TypeError);
  assert.throws(() => Z.create([{ name: 'a' }]), TypeError, '자료 없음');
  assert.throws(() => Z.crc32(null), TypeError);
  assert.throws(() => Z.crc32(5), TypeError);
});

test('P9-3 ZIP: 한도 — 항목 수 65,534개(65,535는 ZIP64 표시값이라 쓰지 않는다)와 크기는 한도를 넘으면 RangeError', () => {
  assert.equal(Z.LIMITS.entries, 65534);
  assert.equal(Z.LIMITS.bytes, 0xfffffffe);
  const many = n => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, data: '' }));
  const ok = Z.create(many(65534));
  const eocd = new DataView(ok.buffer, ok.byteOffset + ok.length - 22, 22);   // 5만 개를 항목마다 검사하면 느려서 끝 기록과 전체 길이만 본다
  assert.equal(eocd.getUint32(0, true), 0x06054b50);
  assert.equal(eocd.getUint16(8, true), 65534);
  assert.equal(eocd.getUint16(10, true), 65534, '0xffff(ZIP64 표시값)가 아니다');
  const expectedLength = many(65534).reduce((n, f) => n + 30 + f.name.length + 46 + f.name.length, 22);
  assert.equal(ok.length, expectedLength);
  assert.equal(eocd.getUint32(16, true) + eocd.getUint32(12, true) + 22, ok.length);
  assert.throws(() => Z.create(many(65535)), RangeError, '65,535개');
  assert.throws(() => Z.create(many(65536)), RangeError, '65,536개');
  // 시험용 한도로 경계를 확인한다(실제 4GB 배열은 만들 수 없다)
  const files = [{ name: 'a', data: 'x'.repeat(10) }];
  const size = Z.create(files).length;                      // 30+1+10 + 46+1 + 22
  assert.equal(size, 30 + 1 + 10 + 46 + 1 + 22);
  assert.equal(Z.create(files, { limits: { bytes: size } }).length, size, '한도와 같으면 허용');
  assert.throws(() => Z.create(files, { limits: { bytes: size - 1 } }), RangeError, '한도보다 1바이트 크면 거절');
  assert.equal(Z.create(many(3), { limits: { entries: 3 } }).length > 0, true, '개수 한도와 같으면 허용');
  assert.throws(() => Z.create(many(3), { limits: { entries: 2 } }), RangeError, '개수 한도보다 1개 많으면 거절');
  assert.throws(() => Z.create(many(1), { limits: { entries: 0 } }), RangeError);
  // 한도 값을 기본보다 크게 줘도 기본 한도(ZIP32)는 넘지 못한다
  assert.throws(() => Z.create(many(65535), { limits: { entries: 1e9 } }), RangeError);
  assert.match(String(assertThrowsMessage(() => Z.create(many(3), { limits: { entries: 2 } }))), /너무 커/);
});
test('P9-3 ZIP: 한도 값이 올바르지 않으면 TypeError, 무한대는 기본 한도로 맞춘다', () => {
  for (const limits of [{ entries: '3' }, { entries: -1 }, { entries: NaN }, { entries: null }, { bytes: '9' }, { bytes: -1 }, { bytes: NaN }, { bytes: null }, { bytes: {} }]) {
    assert.throws(() => Z.create([], { limits }), TypeError, JSON.stringify(limits));
  }
  assert.throws(() => Z.create([], { limits: null }), TypeError, 'limits가 null');
  assert.equal(Z.create([], { limits: {} }).length, 22, '빈 한도 객체는 기본값');
  assert.equal(Z.create([{ name: 'a', data: 'x' }], { limits: { entries: Infinity, bytes: Infinity } }).length > 0, true);
  assert.equal(Z.create([], { limits: { bytes: 22 } }).length, 22, '끝 기록만 있는 ZIP은 22바이트 한도에서 허용');
  assert.throws(() => Z.create([], { limits: { bytes: 21 } }), RangeError);
  assert.equal(Z.create([], { limits: { entries: 0 } }).length, 22, '항목 0개 한도에서 항목 없는 ZIP은 허용');
});
function assertThrowsMessage(fn) { try { fn(); } catch (error) { return error.message; } return ''; }

// ---- 5. 교차 검사 ----
function tool(name, args = []) { const r = spawnSync(name, args, { encoding: 'buffer' }); return r.error ? null : r; }
const HAVE_PY = !!tool('python3', ['-I', '-c', 'import zipfile']);
const HAVE_UNZIP = !!tool('unzip', ['-v']);

test('P9-3 ZIP: python3 zipfile이 열고(testzip·이름·시각·내용 해시) 한글 이름이 맞다', { skip: !HAVE_PY && 'python3를 쓸 수 없다' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-zip-'));
  try {
    const big = new Uint8Array(300000).map((_, i) => (i * 31 + (i >> 8)) & 255);
    const files = [{ name: '나비야-1.svg', data: '<svg>한글</svg>' }, { name: '빈.bin', data: new Uint8Array(0) }, { name: 'dir/🎼.png', data: big }];
    const file = join(dir, 'a.zip');
    writeFileSync(file, Z.create(files, { date: new Date(2026, 10, 25, 13, 45, 58) }));
    const code = 'import sys, json, zipfile, hashlib\nz = zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad": z.testzip(), "entries": [{"name": i.filename, "size": i.file_size, "csize": i.compress_size, "type": i.compress_type, "flag": i.flag_bits, "crc": i.CRC, "dt": list(i.date_time), "sha": hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]}, ensure_ascii=False))';
    const r = spawnSync('python3', ['-I', '-c', code, file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.bad, null, 'testzip: 손상된 항목 없음');
    assert.deepEqual(out.entries.map(e => e.name), files.map(f => f.name));
    out.entries.forEach((e, i) => {
      const data = typeof files[i].data === 'string' ? bytes(files[i].data) : files[i].data;
      assert.equal(e.size, data.length); assert.equal(e.csize, data.length); assert.equal(e.type, 0, '무압축');
      assert.equal(e.flag & 0x800, 0x800, 'UTF-8 이름 플래그');
      assert.deepEqual(e.dt, [2026, 11, 25, 13, 45, 58]);
      assert.equal(e.sha, createHash('sha256').update(data).digest('hex'), `${e.name}: 내용`);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P9-3 ZIP: unzip -t가 오류 없음으로 읽고 unzip -p가 같은 내용을 꺼낸다(ASCII 이름)', { skip: !HAVE_UNZIP && 'unzip을 쓸 수 없다' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-zip-'));
  try {
    const png = new Uint8Array(70000).map((_, i) => (i * 7 + 3) & 255);
    const file = join(dir, 'a.zip');
    writeFileSync(file, Z.create([{ name: 'page-1.svg', data: '<svg>x</svg>' }, { name: 'sub/page-2.png', data: png }, { name: 'empty.txt', data: '' }]));
    const t = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /No errors detected/);
    assert.match(t.stdout, /testing: page-1\.svg\s+OK/);
    assert.match(t.stdout, /testing: sub\/page-2\.png\s+OK/);
    const svg = spawnSync('unzip', ['-p', file, 'page-1.svg'], { encoding: 'buffer' });
    assert.equal(svg.stdout.toString('utf8'), '<svg>x</svg>');
    const image = spawnSync('unzip', ['-p', file, 'sub/page-2.png'], { encoding: 'buffer' });
    assert.ok(Buffer.from(png).equals(image.stdout), 'PNG 바이트가 같다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P9-3 ZIP: 앱의 .mxl 읽기(SF.io.readMxl)가 우리가 만든 ZIP에서 컨테이너·악보 XML을 읽는다', async () => {
  const xml = SF.io.exportMusicXML(SF.io.DEMOS.rhythm());
  const out = Z.create([
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/main.musicxml"/></rootfiles></container>' },
    { name: 'score/main.musicxml', data: xml },
  ]);
  const text = await SF.io.readMxl(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
  assert.equal(text, xml, '무압축 항목의 글이 그대로 나온다');
});
