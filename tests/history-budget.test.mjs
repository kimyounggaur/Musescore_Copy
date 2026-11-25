// P7-B2: 실행 취소 기록 — 압축 JSON 글자, 메모리 예산(48MB)·개수(200)·1초 병합·dirty 계산·실패 복구.
// core.js만 로드한다. 핵심 시험 3개(처음으로 복원·예산·쉼표 ID)는 core-v3.test.mjs에 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../js/core.js', import.meta.url), 'utf8'), { filename: 'core.js' });
const SF = globalThis.SF, C = SF.core, F = SF.F;
const quarter = { n: 1, d: 4, dots: 0 };
const DEFAULT_BUDGET = 48 * 1024 * 1024;
const exact = () => JSON.stringify(C.toJSON(C.state.score, { keepSilentVoices: true }));   // 빈 성부 쉼표 ID까지 본다
const fresh = (measureCount = 2) => { C.__setHistoryBudget(); C.setScore(C.createScore({ measureCount })); };
const tempoEdits = n => { for (let i = 1; i <= n; i++) C.mutate(`템포 ${i}`, s => { s.tempo = 60 + (i % 100); }); };

test('기본 예산은 48MB이고 개수 상한은 200이다', () => {
  fresh();
  assert.deepEqual(C.__history(), { undo: 0, redo: 0, chars: 0, bytes: 0, maxBytes: DEFAULT_BUDGET, max: 200 });
});

test('개수 상한 200은 그대로다 — 205번 편집하면 가장 오래된 5개가 버려진다', () => {
  fresh();
  const first = exact();
  tempoEdits(205);
  assert.equal(C.__history().undo, 200);
  let count = 0;
  while (C.undo()) count++;
  assert.equal(count, 200);
  assert.notEqual(exact(), first, '처음 5개는 버려져서 맨 처음 상태까지는 돌아갈 수 없다');
});

test('예산이 아주 작아도 한 번은 늘 되돌리고 다시 실행할 수 있다(가장 가까운 항목은 남긴다)', () => {
  fresh();
  C.__setHistoryBudget(1);
  const states = [exact()];
  for (let i = 1; i <= 4; i++) { C.mutate(`템포 ${i}`, s => { s.tempo = 100 + i; }); states.push(exact()); }
  assert.equal(C.__history().undo, 1, '가장 가까운 1개만 남는다');
  assert.ok(C.undo()); assert.equal(exact(), states[3]);
  assert.equal(C.canUndo(), false);
  assert.equal(C.__history().redo, 1);
  assert.ok(C.redo()); assert.equal(exact(), states[4]);
  assert.equal(C.canRedo(), false);
  C.__setHistoryBudget();
});

test('기록 바이트는 항목 글자 수 × 2의 합이고, 실행 취소·다시 실행으로 옮겨 다녀도 개수의 합은 그대로다', () => {
  fresh(); tempoEdits(5);
  let stats = C.__history();
  assert.equal(stats.bytes, stats.chars * 2); assert.equal(stats.undo + stats.redo, 5); assert.ok(stats.chars > 0);
  C.undo(); C.undo();
  stats = C.__history();
  assert.equal(stats.undo, 3); assert.equal(stats.redo, 2); assert.equal(stats.bytes, stats.chars * 2);
  C.redo();
  stats = C.__history();
  assert.equal(stats.undo + stats.redo, 5);
  C.mutate('새 편집', s => { s.tempo = 150; });
  stats = C.__history();
  assert.equal(stats.redo, 0, '새 편집은 다시 실행 기록을 지운다'); assert.equal(stats.bytes, stats.chars * 2);
});

test('__setHistoryBudget은 바로 적용되고, 값이 없거나 잘못되면 기본값(48MB)으로 돌아간다', () => {
  fresh(); tempoEdits(10);
  const before = C.__history();
  const half = before.bytes / 2;
  assert.equal(C.__setHistoryBudget(half), half);
  const after = C.__history();
  assert.ok(after.bytes <= half, '줄인 예산 이내'); assert.ok(after.undo < 10 && after.undo >= 1);
  assert.equal(C.__setHistoryBudget(), DEFAULT_BUDGET);
  assert.equal(C.__setHistoryBudget(NaN), DEFAULT_BUDGET);
  assert.equal(C.__setHistoryBudget(-5), DEFAULT_BUDGET);
  assert.equal(C.__setHistoryBudget('큼'), DEFAULT_BUDGET);
  assert.equal(C.__history().undo, after.undo, '예산을 되돌려도 이미 버린 것은 돌아오지 않는다');
});

test('dirty 계산은 기록 형식과 무관하다 — 저장 뒤 편집·실행 취소·다시 실행', () => {
  fresh(); tempoEdits(2);
  assert.equal(C.state.dirty, true);
  C.markSaved(); assert.equal(C.state.dirty, false);
  C.mutate('편집', s => { s.tempo = 99; }); assert.equal(C.state.dirty, true);
  assert.ok(C.undo()); assert.equal(C.state.dirty, false, '저장한 상태로 돌아왔다');
  assert.ok(C.undo()); assert.equal(C.state.dirty, true);
  assert.ok(C.redo()); assert.equal(C.state.dirty, false);
  assert.ok(C.redo()); assert.equal(C.state.dirty, true);
  assert.ok(C.undo()); assert.equal(C.state.dirty, false, '다시 실행한 뒤 또 되돌려도 저장한 상태로 돌아온다');
});

test('저장한 시점의 기록이 예산에 밀려 버려지면, 남은 어느 상태로 돌아가도 "바뀐 상태"다', () => {
  fresh();                                   // setScore = 저장된 상태
  C.__setHistoryBudget(1);                   // 가장 가까운 1개만 남긴다
  tempoEdits(3);
  assert.equal(C.state.dirty, true);
  assert.ok(C.undo());
  assert.equal(C.state.dirty, true, '저장한 상태는 버려져서 돌아갈 수 없다');
  assert.equal(C.canUndo(), false);
  C.__setHistoryBudget();
});

test('1초 병합은 그대로다 — 같은 이름의 연속 편집은 기록 1개, 실행 취소 한 번에 처음으로', () => {
  fresh();
  const first = exact();
  for (const tempo of [110, 120, 130]) C.mutate(`템포 ${tempo}`, s => { s.tempo = tempo; }, { coalesce: 'tempo' });
  assert.equal(C.__history().undo, 1);
  assert.equal(C.undoLabel(), '템포 130');
  assert.ok(C.undo()); assert.equal(exact(), first); assert.equal(C.canUndo(), false);
});

test('실패한 편집은 쉼표 ID까지 되돌리고 기록에 아무것도 남기지 않는다', () => {
  fresh();
  const before = exact(), revision = C.state.revision;
  assert.throws(() => C.mutate('실패', s => {
    C.inputAt(s, 0, F(0, 1), quarter, [{ step: 0, alter: 0, oct: 4 }], { voice: 2 });
    s.tempo = 250;
    throw new Error('취소');
  }));
  assert.equal(exact(), before);
  assert.equal(C.__history().undo, 0); assert.equal(C.state.revision, revision); assert.equal(C.state.dirty, false);
});

test('quartet64에서 200번 편집해도 기록은 예산 이내이고, 가장 최근 편집은 정확히 되돌아온다', () => {
  C.__setHistoryBudget();
  C.setScore(JSON.parse(readFileSync(new URL('./baseline/quartet64.scoreforge.json', import.meta.url), 'utf8')));
  let beforeLast = '';
  for (let i = 1; i <= 200; i++) {
    if (i === 200) beforeLast = exact();
    C.mutate(`템포 ${i}`, s => { s.tempo = 60 + (i % 100); });
  }
  const stats = C.__history();
  assert.ok(stats.bytes <= stats.maxBytes, `예산 이내: ${stats.bytes} ≤ ${stats.maxBytes}`);
  assert.ok(stats.undo <= 200 && stats.undo >= 150, `개수 ${stats.undo}`);
  assert.ok(stats.chars > 150 * 100000, '악보가 실제로 글자로 담겼다');
  assert.ok(C.undo()); assert.equal(exact(), beforeLast);
});

test('큰 상태가 반대쪽 더미로 넘어가면 예산을 다시 맞춘다 — 실행 취소 쪽', () => {
  fresh();
  const unit = exact().length * 2;                       // 작은 상태 하나의 기록 크기
  C.__setHistoryBudget(Math.floor(unit * 3.5));          // 작은 기록 3개는 들어가고, 큰 기록이 끼면 넘친다
  tempoEdits(2);
  const beforeGrow = exact();
  C.mutate('마디 120개 추가', s => C.appendMeasures(s, 120));
  const grown = exact();
  assert.ok(grown.length > unit * 3, '늘어난 상태는 작은 기록 몇 개보다 훨씬 크다');
  let stats = C.__history();
  assert.equal(stats.undo, 3); assert.ok(stats.bytes <= stats.maxBytes, '편집 직후에는 예산 이내');
  assert.ok(C.undo());                                   // 큰 상태가 다시 실행 쪽으로 넘어간다
  assert.equal(exact(), beforeGrow);
  stats = C.__history();
  assert.deepEqual([stats.undo, stats.redo], [1, 1], '넘친 만큼 되돌리기 쪽의 가장 오래된 것이 밀려난다');
  assert.ok(C.redo()); assert.equal(exact(), grown);     // 큰 상태도 정확히 되살아난다
  C.__setHistoryBudget();
});

test('큰 상태가 반대쪽 더미로 넘어가면 예산을 다시 맞춘다 — 다시 실행 쪽', () => {
  fresh();
  const unit = exact().length * 2;
  C.mutate('마디 120개 추가', s => C.appendMeasures(s, 120));
  const grown = exact();
  C.mutate('마디 120개 삭제', s => C.deleteMeasures(s, 2, 121));
  assert.ok(grown.length > unit * 3);
  assert.ok(C.undo()); assert.equal(exact(), grown);     // 큰 상태에 서 있다: 되돌리기 [처음], 다시 실행 [삭제한 뒤]
  assert.deepEqual([C.__history().undo, C.__history().redo], [1, 1]);
  C.__setHistoryBudget(Math.floor(unit * 2.5));          // 작은 기록 2개는 들어간다 → 아직 아무것도 안 버려진다
  assert.deepEqual([C.__history().undo, C.__history().redo], [1, 1]);
  assert.ok(C.redo());                                   // 큰 상태가 되돌리기 쪽으로 넘어가며 예산을 넘는다
  const stats = C.__history();
  assert.deepEqual([stats.undo, stats.redo], [1, 0], '가장 오래된 처음 상태가 밀려나고 큰 상태 1개만 남는다');
  assert.ok(C.undo()); assert.equal(exact(), grown);
  assert.equal(C.canUndo(), false);
  C.__setHistoryBudget();
});

test('예산 경계·0·버리는 순서 — 딱 맞으면 유지, 1바이트라도 넘으면 가장 오래된 것부터', () => {
  fresh(); tempoEdits(6);
  const total = C.__history().bytes;
  C.__setHistoryBudget(total);
  assert.equal(C.__history().undo, 6, '예산과 딱 맞으면 하나도 버리지 않는다');
  C.__setHistoryBudget(total - 1);
  assert.equal(C.__history().undo, 5, '1바이트라도 넘으면 가장 오래된 1개가 밀려난다');
  assert.equal(C.__setHistoryBudget(0), 0, '0도 올바른 예산이다(기본값으로 바뀌지 않는다)');
  assert.deepEqual([C.__history().undo, C.__history().redo], [1, 0], '0이면 가장 가까운 1개만 남는다');

  fresh();
  const states = [exact()];
  for (let i = 1; i <= 6; i++) { C.mutate(`템포 ${i}`, s => { s.tempo = 60 + i; }); states.push(exact()); }
  assert.ok(C.undo()); assert.ok(C.undo());              // 되돌리기 4개 + 다시 실행 2개
  assert.deepEqual([C.__history().undo, C.__history().redo], [4, 2]);
  C.__setHistoryBudget(Math.floor(C.__history().bytes / 6 * 4.5));   // 6개 중 2개를 버려야 한다
  const stats = C.__history();
  assert.deepEqual([stats.undo, stats.redo], [2, 2], '되돌리기 쪽의 오래된 것부터 버리고 다시 실행 쪽은 건드리지 않는다');
  assert.ok(C.undo()); assert.ok(C.undo()); assert.equal(exact(), states[2]); assert.equal(C.canUndo(), false);
  for (let i = 0; i < 4; i++) assert.ok(C.redo());
  assert.equal(exact(), states[6], '다시 실행 4번이면 맨 마지막 상태');
  C.__setHistoryBudget();
});
