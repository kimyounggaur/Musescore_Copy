// 골든(특성) 테스트 도우미 — *.test.mjs가 아니므로 npm test가 직접 실행하지 않는다.
import { createHash } from 'node:crypto';

const isId = x => typeof x === 'string' && /^e\d+$/.test(x);
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/** 이벤트 ID(e123)를 등장 순서대로 id0, id1…로 바꾸고 키를 정렬한다.
 *  키를 정렬한 순서로 훑어야 객체 키 삽입 순서(예: 최상위 measures 위치)에 흔들리지 않는다. */
export function canonicalIds(value) {
  const map = new Map();
  const name = x => (map.has(x) || map.set(x, 'id' + map.size), map.get(x));
  const scan = v => {
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v).sort(byKey)) {
      if (isId(k)) name(k);
      if (isId(x)) name(x); else scan(x);
    }
  };
  scan(value);
  const out = v => Array.isArray(v) ? v.map(out)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [isId(k) ? map.get(k) : k, isId(x) ? map.get(x) : out(x)]).sort(byKey))
      : v;
  return out(value);
}

export const hashJSON = value => createHash('sha256').update(JSON.stringify(canonicalIds(value))).digest('hex').slice(0, 16);

/** 고정 시드 SMF type 0: 600개 사건, 길이 6종(마디 넘김 포함)·화음 30%·쉼표 15% */
export function seededMidi(seed = 20261123, count = 600) {
  const ppq = 480, vlq = n => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const ev = []; let t = 0;
  for (let i = 0; i < count; i++) {
    const len = [ppq / 4, ppq / 2, ppq, ppq * 1.5, ppq * 3, ppq * 5][Math.floor(rnd() * 6)];
    const chord = rnd() < 0.3 ? [0, 4, 7] : [0], root = 48 + Math.floor(rnd() * 24);
    if (rnd() < 0.15) { t += ppq / 2; continue; }
    for (const d of chord) ev.push([t, 0x90, root + d, 70 + Math.floor(rnd() * 40)], [t + len - 5, 0x80, root + d, 0]);
    t += len;
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tr = []; let last = 0;
  for (const [tt, s, a, b] of ev) { tr.push(...vlq(tt - last), s, a, b); last = tt; }
  tr.push(0, 0xff, 0x2f, 0);
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255,
    0x4d, 0x54, 0x72, 0x6b, ...u32(tr.length), ...tr]);
}

/** 8분음표 N개(C4~B5 순환), 템포 120, SMF type 0 — 복잡도·성능 측정용(bench-midi.mjs도 이것을 쓴다) */
export function eighthNotesMidi(N) {
  const ppq = 480, vlq = n => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
  const ev = [];
  for (let i = 0; i < N; i++) { const t = i * ppq / 2, m = 60 + (i % 24); ev.push([t, 0x90, m, 80], [t + ppq / 2 - 10, 0x80, m, 0]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tr = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; let last = 0;
  for (const [t, s, a, b] of ev) { tr.push(...vlq(t - last), s, a, b); last = t; }
  tr.push(0x00, 0xff, 0x2f, 0x00);
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255,
    0x4d, 0x54, 0x72, 0x6b, ...u32(tr.length), ...tr]);
}

// ---- 골든 행렬용 입력(고정 시드·고정 모양) ----
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const vlq = n => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
/** events: [tick, status, data1, data2] 목록 → 트랙 1개짜리 SMF type 0 */
export function smf(events, ppq = 480) {
  events = [...events].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tr = []; let last = 0;
  for (const [t, s, a, b] of events) { tr.push(...vlq(t - last), s, a, b); last = t; }
  tr.push(0, 0xff, 0x2f, 0);
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255, 0x4d, 0x54, 0x72, 0x6b, ...u32(tr.length), ...tr]);
}
/** 셋잇단 8분음표 묶음과 일반 4분음표가 번갈아 나오는 12마디 */
export function tripletsMidi() {
  const ppq = 480, ev = []; let t = 0;
  for (let bar = 0; bar < 12; bar++) for (let beat = 0; beat < 4; beat++) {
    if ((bar + beat) % 2) for (let k = 0; k < 3; k++) { const s = t + k * ppq / 3; ev.push([Math.round(s), 0x90, 60 + k * 2 + beat, 90], [Math.round(s + ppq / 3 - 4), 0x80, 60 + k * 2 + beat, 0]); }
    else ev.push([t, 0x90, 64 + beat, 80], [t + ppq - 5, 0x80, 64 + beat, 0]);
    t += ppq;
  }
  return smf(ev, ppq);
}
/** 채널 10(0x99) 드럼 64타 + 선율 채널 하나. 표기가 정해지지 않은 드럼 번호(39·75)도 섞는다 */
export function drumsMidi() {
  const ppq = 480, ev = [], kit = [36, 38, 42, 46, 49, 41, 39, 75, 37]; let t = 0;
  for (let i = 0; i < 64; i++) {
    const n = kit[(i * 3) % kit.length];
    ev.push([t, 0x99, n, 70 + (i % 5) * 10], [t + ppq / 4, 0x89, n, 0]);
    if (i % 4 === 0) ev.push([t, 0x91, 62 + (i % 12), 85], [t + ppq / 2, 0x81, 62 + (i % 12), 0]);
    t += ppq / 2;
  }
  return smf(ev, ppq);
}
