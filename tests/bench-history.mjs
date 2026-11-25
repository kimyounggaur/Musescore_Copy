// P7-B2: 실행 취소 기록의 크기·시간 측정. 악보를 200번 편집한 뒤의 기록 크기를 옛 방식과 새 방식으로 잰다.
//   node --expose-gc tests/bench-history.mjs          (--expose-gc가 없으면 메모리(힙) 값은 건너뛴다)
// 옛 방식 = 편집마다 악보를 객체째 복사(structuredClone)해 200개 보관(상한 없음), 새 방식 = 압축 JSON 글자 + 예산 48MB.
// 악보: quartet64(64마디 4중주 — PERF.md의 기준 악보), 피아노 100마디 1,600음(tests/perf-edit.mjs와 같은 악보).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../js/core.js', import.meta.url), 'utf8'), { filename: 'core.js' });
const SF = globalThis.SF, C = SF.core;
const gc = globalThis.gc;
const heapMB = () => { gc?.(); gc?.(); return process.memoryUsage().heapUsed / 1048576; };
const EDITS = 200;

const scores = {
  'quartet64': () => JSON.parse(readFileSync(new URL('./baseline/quartet64.scoreforge.json', import.meta.url), 'utf8')),
  '피아노 100마디(1,600음)': () => {
    const score = C.createScore({ ensemble: 'piano', measureCount: 100 });
    for (const ref of C.staffRefs(score)) for (let m = 0; m < 100; m++) for (let i = 0; i < 8; i++)
      C.inputAt(score, m, SF.F(i, 8), { n: 1, d: 8, dots: 0 }, [{ step: i % 7, alter: 0, oct: ref.staffIdx ? 3 : 4 }], { partIdx: ref.partIdx, staffIdx: ref.staffIdx, voice: 1 });
    return C.toJSON(score);
  },
};

const out = {};
for (const [name, make] of Object.entries(scores)) {
  const raw = make();
  const row = out[name] = {};

  // 옛 방식: 편집마다 structuredClone으로 악보 전체를 복사해 200개 쌓는다(예산 없음)
  C.setScore(raw);
  C.ensureParts(C.state.score);
  const base1 = gc ? heapMB() : 0;
  let t0 = performance.now();
  const oldStack = [];
  for (let i = 1; i <= EDITS; i++) oldStack.push(structuredClone(C.state.score));
  row['옛 방식(복사 200개)'] = { '복사 1회 ms': +((performance.now() - t0) / EDITS).toFixed(2) };
  if (gc) row['옛 방식(복사 200개)']['힙 증가 MB'] = +(heapMB() - base1).toFixed(1);
  oldStack.length = 0;

  // 새 방식: C.mutate가 글자 기록을 쌓는다
  C.__setHistoryBudget();
  C.setScore(raw);
  const base2 = gc ? heapMB() : 0;
  t0 = performance.now();
  for (let i = 1; i <= EDITS; i++) C.mutate(`편집 ${i}`, s => { s.tempo = 60 + (i % 100); });
  const perEdit = (performance.now() - t0) / EDITS;
  const stats = C.__history();
  row['새 방식(글자 기록)'] = {
    '편집당 ms(mutate 전체)': +perEdit.toFixed(2),
    '기록 개수': stats.undo,
    '글자 총길이': stats.chars,
    '항목당 글자': Math.round(stats.chars / stats.undo),
    '추정 MB': +(stats.bytes / 1048576).toFixed(1),
    '예산 MB': stats.maxBytes / 1048576,
  };
  if (gc) row['새 방식(글자 기록)']['힙 증가 MB'] = +(heapMB() - base2).toFixed(1);
}
console.log(JSON.stringify(out, null, 1));
