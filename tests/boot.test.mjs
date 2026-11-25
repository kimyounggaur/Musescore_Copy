// P2-E 부팅 안전 모드 — session.js의 복원·격리·"여는 중" 표시(boot.pending)·안전 모드 선택지를 메모리 저장소로 확인한다.
// 화면(대화상자·토스트·렌더)은 tests/boot-browser.test.mjs가 실제 브라우저로 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const TAB_KEY = 'scoreforge.activeDocId';
const same = (actual, expected, message) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);   // 다른 vm 컨텍스트의 객체 비교
function webStorage() {
  const map = new Map();
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, removeItem: key => { map.delete(key); } };
}

/** options: backend(여러 탭이 나눠 쓸 메모리 백엔드), locked(다른 탭이 쥔 문서 ID 집합), noSchema(schema.js 없이 로드) */
function boot(options = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, structuredClone, TextEncoder, crypto: globalThis.crypto });
  context.window = context;
  context.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  context.localStorage = webStorage();
  context.sessionStorage = options.sessionStorage || webStorage();
  const files = ['safe-html', 'core', ...(options.noSchema ? [] : ['schema']), 'engrave', 'playback', 'io', 'store'];
  for (const name of files) vm.runInContext(readFileSync(`js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
  const SF = context.SF, C = SF.core;
  const backend = options.backend || SF.storeTesting.memoryBackend();
  SF.store = SF.storeTesting.createStore(backend);
  const held = new Set(), downloads = [];
  SF.lock = {                                   // 편집 잠금 흉내: locked에 든 문서는 다른 탭이 쥐고 있다
    acquire: async id => { if (options.locked?.has(id)) return null; held.add(id); return { release: () => { held.delete(id); } }; },
    watch: () => () => {}, notify() {}, heldElsewhere: async () => [], onMessage: () => () => {},
  };
  SF.io.download = (name, text, type) => { downloads.push({ name, text, type }); };
  SF.app = { installScore: score => { C.setScore(score); }, toast() {} };
  SF.ui = { choiceDialog: async () => 'cancel' };
  vm.runInContext(readFileSync('js/session.js', 'utf8'), context, { filename: 'session.js' });
  const titled = title => { const score = C.createScore({ measureCount: 1 }); score.meta.title = title; return score; };
  const record = (id, title, updatedAt, data, extra = {}) => ({
    id, title, createdAt: 1, updatedAt, revision: 1, origin: 'new', cloudId: null, measures: 1, bytes: 1, schema: 1, fileSavedAt: 0,
    data: data ?? C.toJSON(titled(title)), ...extra,
  });
  const plant = (id, title, updatedAt, data, extra) => SF.store.saveDoc(record(id, title, updatedAt, data, extra));
  const badDur = title => { const data = C.toJSON(titled(title)); data.parts[0].staves[0].measures[0].voices[0][0].dur = { n: 0, d: 0, dots: 0 }; return data; };
  return {
    SF, C, backend, held, downloads, plant, badDur, tab: context.sessionStorage, session: SF.session,
    load: id => SF.store.loadDoc(id), list: () => SF.store.listDocs(), pending: () => SF.store.kvGet('boot.pending'),
    edit: title => C.mutate('편집', score => { score.meta.title = title; }), flush: () => SF.io.flushAutosave(),
  };
}

test('P2-E ① 구조가 틀린 기록(dur 0/0)은 격리하고 다음 정상 문서를 연다 — 원본 data·정렬 위치는 그대로, 다음 부팅은 조용', async () => {
  const h = boot();
  await h.plant('good', '정상', 10);
  const broken = h.badDur('깨짐'); await h.plant('bad', '깨짐', 20, broken);       // 더 최근이고 이 탭이 보던 문서
  h.tab.setItem(TAB_KEY, 'bad'); await h.SF.store.kvSet('lastDocId', 'bad');
  const score = await h.session.restoreOnBoot();
  assert.equal(score.meta.title, '정상'); assert.equal(h.tab.getItem(TAB_KEY), 'good');
  same(h.session.bootInfo().quarantined, [{ id: 'bad', title: '깨짐', code: 'BAD_DURATION' }]);
  const record = await h.load('bad');
  assert.equal(record.quarantined, true);
  assert.equal(record.quarantineError.code, 'BAD_DURATION'); assert.match(record.quarantineError.message, /dur/); assert.ok(record.quarantineError.at > 0);
  assert.equal(JSON.stringify(record.data), JSON.stringify(broken), '원본 data 그대로');
  assert.equal(record.updatedAt, 20); assert.equal(record.title, '깨짐'); assert.equal(record.revision, 1);
  assert.equal((await h.list()).find(doc => doc.id === 'bad').quarantined, true, '목록 요약에도 보인다');
  // 다음 부팅: 같은 문서를 가리켜도 조용히 건너뛴다(토스트 반복 없음)
  h.tab.setItem(TAB_KEY, 'bad');
  assert.equal((await h.session.restoreOnBoot()).meta.title, '정상');
  assert.equal(h.session.bootInfo().quarantined.length, 0);
});

test('P2-E ② 기록이 손상된 것뿐이면 null(데모는 호출한 쪽) + 격리 1건, 다음 부팅은 조용히 null', async () => {
  const h = boot();
  await h.plant('only', '하나뿐', 5, h.badDur('하나뿐')); h.tab.setItem(TAB_KEY, 'only'); await h.SF.store.kvSet('lastDocId', 'only');
  assert.equal(await h.session.restoreOnBoot(), null);
  assert.equal(h.session.bootInfo().quarantined.length, 1);
  assert.equal(await h.session.restoreOnBoot(), null);
  assert.equal(h.session.bootInfo().quarantined.length, 0);
  assert.equal(h.held.size, 0, '잠금을 잡지 않았다');
});

test('P2-E ③ checkShape는 통과해도 fromJSON이 던지는 기록·parts가 문자열인 기록도 격리한다(코드는 오류 이름)', async () => {
  const h = boot();
  const odd = h.SF.core.toJSON(h.SF.core.createScore({ measureCount: 1 })); odd.spanners = 'x';   // 모양 검사는 통과, fromJSON에서 예외
  await h.plant('odd', '이상', 30, odd); await h.plant('str', '문자열', 20, { parts: 'x' }); await h.plant('fine', '멀쩡', 10);
  const score = await h.session.restoreOnBoot();
  assert.equal(score.meta.title, '멀쩡');
  const found = Object.fromEntries(h.session.bootInfo().quarantined.map(q => [q.id, q.code]));
  same(found, { odd: 'TypeError', str: 'PARTS_NOT_ARRAY' });
  assert.equal((await h.load('odd')).quarantined, true); assert.equal((await h.load('str')).quarantined, true);
  assert.equal((await h.load('fine')).quarantined, undefined);
});

test('P2-E ④ schema.js 없이 로드돼도(옛 테스트 환경) 복원은 그대로 동작하고 fromJSON 실패만 격리한다', async () => {
  const h = boot({ noSchema: true });
  await h.plant('d', '깨짐', 40, { parts: 'x' }); await h.plant('c', 'C', 30); h.tab.setItem(TAB_KEY, 'd');
  assert.equal((await h.session.restoreOnBoot()).meta.title, 'C');
  assert.equal((await h.load('d')).quarantined, true);
});

test('P2-E ⑤ 격리된 기록은 이 탭의 문서·마지막 문서·가장 최근 문서 어느 쪽으로도 자동으로 열리지 않고, 격리가 8건을 넘어도 정상 문서를 찾는다', async () => {
  const h = boot();
  await h.plant('ok', '정상', 1);
  for (let i = 0; i < 9; i++) await h.plant(`q${i}`, `격리${i}`, 100 + i, undefined, { quarantined: true, quarantineError: { at: 1, code: 'X', message: 'x' } });
  h.tab.setItem(TAB_KEY, 'q3'); await h.SF.store.kvSet('lastDocId', 'q4');
  assert.equal((await h.session.restoreOnBoot()).meta.title, '정상');
  assert.equal(h.session.bootInfo().quarantined.length, 0, '이미 격리된 것은 새로 알리지 않는다');
});

test('P2-E ⑥ 지난 부팅이 끝나지 못한 문서(boot.pending)가 시작 문서면 열지도 잠그지도 않고 알려 준다', async () => {
  const h = boot();
  await h.plant('a', 'A', 10); await h.plant('b', 'B', 20);
  await h.SF.store.kvSet('boot.pending', { b: 123 });
  assert.equal(await h.session.restoreOnBoot(), null);                          // 가장 최근 문서 b가 시작 문서
  same(h.session.bootInfo().pending, { id: 'b', title: 'B' });
  assert.equal(h.tab.getItem(TAB_KEY), null, '이 탭의 현재 문서로 올리지 않았다');
  same(h.session.lockState(), { docId: '', locked: false, available: false });
  assert.equal(h.held.size, 0, '잠그려고 잡았던 것도 놓았다');
  same(await h.pending(), { b: 123 }, '표시는 사용자가 정할 때까지 그대로');
  assert.equal(await h.session.bootBegin(), false, '연 문서가 없으니 표시를 적지 않는다');
});

test('P2-E ⑦ 표시가 옛 모양(문자열 ID 하나)이어도 같은 동작, 다른 문서의 표시는 시작 문서를 막지 않는다', async () => {
  const h = boot();
  await h.plant('a', 'A', 10); await h.plant('b', 'B', 20);
  await h.SF.store.kvSet('boot.pending', 'b');
  assert.equal(await h.session.restoreOnBoot(), null); assert.equal(h.session.bootInfo().pending.id, 'b');
  await h.SF.store.kvSet('boot.pending', { a: 5 });
  const score = await h.session.restoreOnBoot();                                // 시작 문서는 b — a의 표시는 상관없다
  assert.equal(score.meta.title, 'B'); assert.equal(h.session.bootInfo().pending, null);
});

test('P2-E ⑧ 손상된 문서의 표시는 안전 모드 질문이 아니라 격리가 먼저, 다른 탭이 쥔 문서의 표시는 묻지 않고 건너뜀', async () => {
  const h = boot({ locked: new Set(['c']) });
  await h.plant('a', 'A', 10); await h.plant('b', 'B', 20, h.badDur('B')); await h.plant('c', 'C', 30);
  await h.SF.store.kvSet('boot.pending', { b: 1, c: 1 });
  const score = await h.session.restoreOnBoot();                                // c는 남이 편집 중, b는 손상 → a
  assert.equal(score.meta.title, 'A'); assert.equal(h.session.bootInfo().pending, null);
  assert.equal((await h.load('b')).quarantined, true);
});

test('P2-E ⑨ bootBegin은 쓰기가 끝난 뒤에 돌아오고, bootDone은 자기 표시만 지운다(다른 탭·다른 문서의 표시는 남긴다)', async () => {
  const h = boot();
  await h.plant('a', 'A', 10); await h.plant('b', 'B', 20);
  await h.SF.store.kvSet('boot.pending', { other: 99 });
  h.tab.setItem(TAB_KEY, 'a');
  assert.equal((await h.session.restoreOnBoot()).meta.title, 'A');
  assert.equal(await h.session.bootBegin(), true);
  const marks = await h.pending();
  assert.deepEqual(Object.keys(marks).sort(), ['a', 'other']); assert.ok(marks.a > 0); assert.equal(marks.other, 99);
  await h.session.bootDone();
  same(await h.pending(), { other: 99 });
  await h.session.bootDone();                                                   // 두 번 불러도 안전
  same(await h.pending(), { other: 99 });
  // 마지막 표시가 지워지면 null
  await h.SF.store.kvSet('boot.pending', null);
  await h.session.restoreOnBoot(); await h.session.bootBegin(); await h.session.bootDone();
  assert.equal(await h.pending(), null);
});

test('P2-E ⑩ 여러 탭이 동시에 부팅해도 서로의 표시를 지우지 않는다(브라우저 세션 복원)', async () => {
  const first = boot(), backend = first.backend;
  const second = boot({ backend });
  await first.plant('a', 'A', 10); await first.plant('b', 'B', 20);
  first.tab.setItem(TAB_KEY, 'a'); second.tab.setItem(TAB_KEY, 'b');
  await Promise.all([first.session.restoreOnBoot(), second.session.restoreOnBoot()]);
  await Promise.all([first.session.bootBegin(), second.session.bootBegin()]);
  assert.deepEqual(Object.keys(await first.pending()).sort(), ['a', 'b']);
  await first.session.bootDone();
  assert.deepEqual(Object.keys(await second.pending()), ['b'], '첫 탭이 끝나도 둘째 탭의 표시는 남는다');
  await second.session.bootDone();
  assert.equal(await first.pending(), null);
});

test('P2-E ⑪ 지워지지 않고 남는 표시는 20개까지만 — 방금 적은 표시는 항상 남는다', async () => {
  const h = boot();
  for (let i = 0; i < 25; i++) { await h.plant(`d${i}`, `D${i}`, 100 + i); h.tab.setItem(TAB_KEY, `d${i}`); await h.session.restoreOnBoot(); await h.session.bootBegin(); }
  const marks = Object.keys(await h.pending());
  assert.equal(marks.length, 20); assert.ok(marks.includes('d24'));
});

test('P2-E ⑫ bootFailed: 연 문서를 격리하고 표시를 지우고 잠금을 놓는다 — 원본 data는 그대로', async () => {
  const h = boot();
  const original = h.C.toJSON(h.C.createScore({ measureCount: 2 })); await h.plant('a', 'A', 10, original);
  assert.ok(await h.session.restoreOnBoot()); await h.session.bootBegin();
  assert.deepEqual([...h.held], ['a']); assert.equal(h.session.lockState().docId, 'a');
  assert.equal(await h.session.bootFailed(new TypeError('그리다 실패')), true);
  const record = await h.load('a');
  assert.equal(record.quarantined, true); assert.equal(record.quarantineError.code, 'TypeError'); assert.equal(record.quarantineError.message, '그리다 실패');
  assert.equal(JSON.stringify(record.data), JSON.stringify(original));
  assert.equal(await h.pending(), null); assert.equal(h.held.size, 0);
  same(h.session.lockState(), { docId: '', locked: false, available: false });
  same(h.session.bootInfo().quarantined, [{ id: 'a', title: 'A', code: 'TypeError' }]);
  assert.equal(await h.session.bootFailed(new Error('두 번째')), false, '열어 둔 문서가 없으면 아무 일도 하지 않는다');
});

test('P2-E ⑬ bootFailed: 그사이 다른 탭이 같은 문서를 새로 저장했다면 격리하지 않는다(새 내용을 덮어쓰지 않음)', async () => {
  const h = boot();
  await h.plant('a', 'A', 10);
  await h.session.restoreOnBoot(); await h.session.bootBegin();
  await h.plant('a', 'A 새 저장', 50, undefined, { revision: 9 });               // 다른 탭의 자동 저장
  assert.equal(await h.session.bootFailed(new Error('x')), false);
  const record = await h.load('a');
  assert.equal(record.quarantined, undefined); assert.equal(record.title, 'A 새 저장'); assert.equal(record.updatedAt, 50);
  assert.equal(await h.pending(), null); assert.equal(h.held.size, 0);
});

test('P2-E ⑭ 안전 모드 [그래도 열기]: 표시가 남아 있어도 연다 — 표시는 첫 렌더가 끝날 때(bootDone) 지운다', async () => {
  const h = boot();
  await h.plant('a', 'A', 10); await h.plant('b', 'B', 20);
  await h.SF.store.kvSet('boot.pending', { b: 7 });
  assert.equal(await h.session.restoreOnBoot(), null);
  const score = await h.session.bootOpenPending();
  assert.equal(score.meta.title, 'B'); assert.equal(h.tab.getItem(TAB_KEY), 'b'); assert.equal(h.session.lockState().docId, 'b');
  assert.equal(h.session.bootInfo().pending, null);
  assert.ok((await h.pending()).b >= 7, '아직 지우지 않았다');
  await h.session.bootBegin(); await h.session.bootDone();
  assert.equal(await h.pending(), null);
  assert.equal(await h.session.bootOpenPending(), null, '묻는 문서가 없으면 null');
});

test('P2-E ⑮ [그래도 열기]인데 그사이 기록이 손상됐다면 격리하고 null(앱은 데모 + 안내)', async () => {
  const h = boot();
  await h.plant('b', 'B', 20); await h.SF.store.kvSet('boot.pending', { b: 7 });
  assert.equal(await h.session.restoreOnBoot(), null);
  await h.plant('b', 'B', 21, h.badDur('B'));
  assert.equal(await h.session.bootOpenPending(), null);
  assert.equal((await h.load('b')).quarantined, true); assert.equal(h.session.bootInfo().quarantined.length, 1);
  assert.equal(h.held.size, 0);
});

test('P2-E ⑯ 안전 모드 [새 악보로 시작]: BOOT_INTERRUPTED로 격리하고 표시를 지운다 — 알림 없이, 다음 부팅은 다른 문서를 연다', async () => {
  const h = boot();
  await h.plant('a', 'A', 10); const data = h.C.toJSON(h.C.createScore({ measureCount: 1 })); await h.plant('b', 'B', 20, data);
  await h.SF.store.kvSet('boot.pending', { b: 7 });
  assert.equal(await h.session.restoreOnBoot(), null);
  assert.equal(await h.session.bootSkipPending(), true);
  const record = await h.load('b');
  assert.equal(record.quarantined, true); assert.equal(record.quarantineError.code, 'BOOT_INTERRUPTED'); assert.equal(JSON.stringify(record.data), JSON.stringify(data));
  assert.equal(await h.pending(), null); assert.equal(h.session.bootInfo().quarantined.length, 0); assert.equal(h.session.bootInfo().pending, null);
  assert.equal((await h.session.restoreOnBoot()).meta.title, 'A');
  assert.equal(h.session.bootInfo().pending, null);
  assert.equal(await h.session.bootSkipPending(), false);
});

test('P2-E ⑰ 안전 모드 [파일로 내려받기]: 열어 보지 않고 보관된 기록 그대로 파일로 받는다', async () => {
  const h = boot();
  const data = h.C.toJSON(h.C.createScore({ measureCount: 1 })); await h.plant('b', '제목/이름?', 20, data);
  await h.SF.store.kvSet('boot.pending', { b: 7 });
  await h.session.restoreOnBoot();
  assert.equal(await h.session.bootDownloadPending(), true);
  assert.equal(h.downloads.length, 1);
  assert.match(h.downloads[0].name, /\.scoreforge\.json$/); assert.equal(h.downloads[0].type, 'application/json');
  assert.equal(h.downloads[0].text, h.SF.io.jsonFileText(data));
  assert.equal(h.session.bootInfo().pending.id, 'b', '내려받은 뒤에도 질문은 그대로(다른 선택지를 고를 수 있다)');
  await h.SF.store.deleteDoc('b');
  assert.equal(await h.session.bootDownloadPending(), false, '기록이 사라졌으면 false');
  assert.equal(h.downloads.length, 1);
});

test('P2-E ⑱ 최근 작업에서 여는 openDoc도 구조 검사를 통과해야 열린다 — 통과 못 하면 unreadable, 격리 표시만 있는 건강한 기록은 열리고 다시 저장되면 표시가 사라진다', async () => {
  const h = boot();
  await h.plant('bad', '깨짐', 10, h.badDur('깨짐'));
  assert.equal(await h.session.openDoc('bad', { confirmed: true }), 'unreadable');
  assert.equal(h.session.activeId(), '');
  await h.plant('held', '멈췄던 문서', 20, undefined, { quarantined: true, quarantineError: { at: 1, code: 'BOOT_INTERRUPTED', message: 'x' } });
  assert.equal(await h.session.openDoc('held', { confirmed: true }), 'opened');
  assert.equal(h.session.activeId(), 'held');
  h.edit('고친 제목'); assert.equal(await h.flush(), true);
  const record = await h.load('held');
  assert.equal(record.title, '고친 제목'); assert.equal(record.quarantined, undefined); assert.equal(record.quarantineError, undefined);
});

test('P2-E ⑲ 저장소 갱신 도구: updateDoc·updateKv는 읽고 고쳐 쓰고, undefined를 돌려주면 그대로 둔다', async () => {
  const h = boot(), s = h.SF.store;
  assert.equal(await s.updateDoc('없음', old => { assert.equal(old, undefined); return undefined; }), false);
  assert.equal(await s.updateDoc('없음', () => ({ id: '없음', title: '새로' })), true, '없던 기록도 만들 수 있다');
  assert.equal((await s.loadDoc('없음')).title, '새로');
  assert.equal(await s.updateDoc('없음', old => ({ ...old, title: '고침' })), true); assert.equal((await s.loadDoc('없음')).title, '고침');
  assert.equal(await s.updateDoc('없음', () => undefined), false); assert.equal((await s.loadDoc('없음')).title, '고침');
  assert.equal(await s.updateKv('k', old => { assert.equal(old, undefined); return { n: 1 }; }), true);
  assert.equal(await s.updateKv('k', old => ({ n: old.n + 1 })), true); same(await s.kvGet('k'), { n: 2 });
  assert.equal(await s.updateKv('k', () => null), true); assert.equal(await s.kvGet('k'), null, 'null도 값으로 쓸 수 있다');
  // 동시에 여러 번 고쳐도 하나도 잃지 않는다
  await Promise.all(Array.from({ length: 10 }, () => s.updateKv('count', old => (old ?? 0) + 1)));
  assert.equal(await s.kvGet('count'), 10);
});

test('P2-E ⑳ 저장소를 못 쓰는 환경(옛 localStorage 방식)에서도 부팅 복원은 예외 없이 동작한다', async () => {
  const h = boot();
  h.SF.store = h.SF.storeTesting.createStore(h.SF.storeTesting.memoryBackend({ failOpen: true }));
  assert.equal(await h.session.restoreOnBoot(), null);
  assert.equal(h.session.bootInfo().pending, null);
  assert.equal(await h.session.bootBegin(), false); await h.session.bootDone(); assert.equal(await h.session.bootFailed(new Error('x')), false);
});

test('구조 고정: 부팅 안전 모드 호출은 session.js·app.js에 한 벌씩 — schema는 선택 호출, 부팅의 직접 setScore는 없다', () => {
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const session = strip(readFileSync('js/session.js', 'utf8')), app = strip(readFileSync('js/app.js', 'utf8'));
  assert.equal((session.match(/SF\.schema\?\.checkShape\(/g) || []).length, 2, 'tryRecord·openDoc에서만 부른다');
  assert.doesNotMatch(session, /SF\.schema\.checkShape\(/, 'schema.js 없이 로드되는 테스트를 보호하려면 ?.로만 부른다');
  for (const call of ['bootBegin', 'bootDone', 'bootFailed', 'bootOpenPending', 'bootSkipPending', 'bootDownloadPending', 'bootInfo'])
    assert.ok(app.includes(`SF.session.${call}(`), `app.js가 ${call}을 부른다`);
  assert.equal((app.match(/\bC\.setScore\(/g) || []).length, 1, 'installScore 한 곳');
  assert.match(app, /async function settleBoot\(/); assert.match(app, /update\(\{ immediate: true \}\);\s*if \(restored\) await framesSettled\(\)/);
  for (const text of ['문제가 생겼어요. 최근 작업에서 확인해 주세요.']) assert.ok(readFileSync('js/errors.js', 'utf8').includes(text));
  assert.doesNotMatch(readFileSync('js/errors.js', 'utf8'), /마지막 자동 저장본/);
});
