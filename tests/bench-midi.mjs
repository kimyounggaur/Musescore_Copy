// 부록 D-2: MIDI 가져오기 시간. 사용법: node tests/bench-midi.mjs [음 개수…]   (기본 1000 2000 4000)
import { SF } from './shim.mjs';
import { eighthNotesMidi } from './golden-utils.mjs';
const IO = SF.io;
const counts = process.argv.slice(2).map(Number).filter(n => n > 0);
for (const N of counts.length ? counts : [1000, 2000, 4000]) {
  const bytes = eighthNotesMidi(N);
  const t0 = performance.now(), parsed = IO.parseMidi(bytes);
  const builds0 = SF.core.__stats?.indexBuilds ?? 0;
  const t1 = performance.now(), result = IO.midiToScore(parsed, { grid: 1 / 16 });
  const t2 = performance.now();
  console.log(JSON.stringify({ notes: N, parseMs: Math.round(t1 - t0), convertMs: Math.round(t2 - t1),
    indexBuilds: (SF.core.__stats?.indexBuilds ?? 0) - builds0, placed: result.placed, measures: result.score.measures.length }));
}
