// 부록 D-2: MIDI 가져오기 시간. 사용법: node tests/bench-midi.mjs [음 개수…]   (기본 1000 2000 4000)
import { SF } from './shim.mjs';
const IO = SF.io;
function eighthNotesMidi(N) {                       // 8분음표 N개(C4~B5 순환), 템포 120, SMF type 0
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
const counts = process.argv.slice(2).map(Number).filter(n => n > 0);
for (const N of counts.length ? counts : [1000, 2000, 4000]) {
  const bytes = eighthNotesMidi(N);
  const t0 = performance.now(), parsed = IO.parseMidi(bytes);
  const t1 = performance.now(), result = IO.midiToScore(parsed, { grid: 1 / 16 });
  const t2 = performance.now();
  console.log(JSON.stringify({ notes: N, parseMs: Math.round(t1 - t0), convertMs: Math.round(t2 - t1),
    placed: result.placed, measures: result.score.measures.length }));
}
