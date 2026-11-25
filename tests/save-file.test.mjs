// P7-B1: 파일로 저장(io.saveJSON·jsonFileText) — 기본은 v2 파일(머리 version 2), "구버전 호환으로 저장"은 v1 파일(머리 version 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
import { canonicalIds } from './golden-utils.mjs';

const C = SF.core, IO = SF.io, F = SF.F;
const quarter = { n: 1, d: 4, dots: 0 }, pitch = { step: 0, alter: 0, oct: 4 };

// 다운로드를 흉내: io.download가 만드는 <a>와 Blob을 붙잡는다.
const downloads = [], blobs = new Map();
globalThis.document.createElement = () => ({ click() { downloads.push(this); }, remove() {} });
globalThis.document.body = { appendChild() {} };
URL.createObjectURL = blob => { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; };
URL.revokeObjectURL = () => {};
async function lastDownload() {
  const a = downloads.at(-1);
  return { name: a.download, file: JSON.parse(await blobs.get(a.href).text()) };
}
const view = score => { const j = C.toJSON(score, { format: 1 }); delete j.schema; return canonicalIds(j); };

function editedScore() {
  const s = C.createScore({ measureCount: 3, ensemble: 'piano', title: '저장 시험' });
  C.setScore(s);
  C.mutate('음 입력', sc => { C.inputAt(sc, 0, F(0, 1), quarter, [pitch]); C.inputAt(sc, 1, F(0, 1), quarter, [pitch], { voice: 2 }); });
  return C.state.score;
}

test('jsonFileText: 머리 version은 데이터의 형식을 따른다(v2 데이터 2, 구버전 호환 출력·옛 기록 1)', () => {
  const s = C.createScore({ measureCount: 2 });
  const v2 = JSON.parse(IO.jsonFileText(C.toJSON(s)));
  assert.deepEqual(Object.keys(v2), ['app', 'version', 'score']);
  assert.equal(v2.app, 'scoreforge'); assert.equal(v2.version, 2); assert.equal(v2.score.schema, 2);
  const v1 = JSON.parse(IO.jsonFileText(C.toJSON(s, { format: 1 })));
  assert.equal(v1.version, 1); assert.equal('schema' in v1.score, false);
  const record = C.toJSON(s, { format: 1 });                         // 3.4.0 이전에 보관된 기록의 모양(schema 없음)
  assert.equal(JSON.parse(IO.jsonFileText(record)).version, 1);
});

test('saveJSON 기본: v2 파일(머리 version 2, 최상위 measures·마디 events 없음)을 내려받고 저장됨으로 표시한다', async () => {
  const s = editedScore();
  assert.equal(C.state.dirty, true);
  downloads.length = 0;
  IO.saveJSON(s);
  const { name, file } = await lastDownload();
  assert.match(name, /^저장 시험\.scoreforge\.json$/);
  assert.equal(file.app, 'scoreforge'); assert.equal(file.version, 2);
  assert.equal(file.score.schema, 2);
  assert.equal('measures' in file.score, false);
  assert.equal(JSON.stringify(file).includes('"events"'), false);
  assert.equal(C.state.dirty, false, '파일로 저장했으니 저장됨');
});

test('saveJSON({ legacy: true }): 구버전 호환(v1) 파일 — 머리 version 1, 최상위 measures와 마디 events가 있고 schema는 없다', async () => {
  const s = editedScore();
  downloads.length = 0;
  IO.saveJSON(s, { legacy: true });
  const { file } = await lastDownload();
  assert.equal(file.version, 1);
  assert.equal('schema' in file.score, false);
  assert.ok(Array.isArray(file.score.measures) && file.score.measures.length === 3);
  assert.ok(Array.isArray(file.score.parts[0].staves[0].measures[0].events));
  assert.equal(C.state.dirty, false, '구버전 호환으로 저장해도 파일로 저장한 것이다');
});

test('두 파일을 다시 열면 같은 악보가 된다(v1 파일 = v2 파일), 열린 악보에는 schema가 남지 않는다', async () => {
  const s = editedScore();
  downloads.length = 0;
  IO.saveJSON(s); IO.saveJSON(s, { legacy: true });
  const [a, b] = await Promise.all(downloads.map(async d => JSON.parse(await blobs.get(d.href).text())));
  assert.equal(a.version, 2); assert.equal(b.version, 1);
  const fromV2 = C.fromJSON(a.score), fromV1 = C.fromJSON(b.score);
  assert.deepEqual(view(fromV2), view(fromV1));
  assert.deepEqual(view(fromV2), view(s));
  assert.equal('schema' in fromV2, false); assert.equal('schema' in fromV1, false);
  assert.equal(JSON.stringify(C.toJSON(fromV2)), JSON.stringify(C.toJSON(fromV1)), '다시 v2로 저장하면 글자까지 같다');
});

// 진짜 loadScoreFile로 연다(FileReader만 흉내). 머리 version은 읽는 쪽이 보지 않으므로 1·2·3 어느 것이든 같은 악보가 열린다.
globalThis.FileReader = class { readAsText(file) { file.text().then(text => { this.result = text; this.onload?.(); }, () => this.onerror?.()); } };
const openFile = text => new Promise(resolve => IO.loadScoreFile(new File([text], '시험.scoreforge.json'), (score, name, err) => resolve({ score, err })));

test('loadScoreFile은 v1·v2 파일을 같은 악보로 열고, 머리 version은 보지 않는다(읽기 호환은 영구)', async () => {
  const s = editedScore();
  downloads.length = 0;
  IO.saveJSON(s); IO.saveJSON(s, { legacy: true });
  const [v2, v1] = await Promise.all(downloads.map(async d => JSON.parse(await blobs.get(d.href).text())));
  for (const [label, body] of [['v2 파일', v2], ['v1 파일', v1]]) for (const version of [1, 2, 3]) {
    const { score, err } = await openFile(JSON.stringify({ ...body, version }));
    assert.equal(err, null, `${label}(머리 ${version})`);
    assert.deepEqual(view(score), view(s), `${label}(머리 ${version})`);
    assert.equal('schema' in score, false);
  }
  const bad = await openFile(JSON.stringify({ app: 'scoreforge', version: 2, score: { foo: 1 } }));
  assert.equal(bad.score, null); assert.match(bad.err.message, /ScoreForge 악보 파일이 아니에요/);
});
