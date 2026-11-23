// P2-A 악보 교체 통로(SF.session) 테스트 — 대화상자·교체 호출은 스텁으로 흉내 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

function harness(answers = []) {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  context.window = context;
  context.document = { getElementById: () => null, querySelectorAll: () => [] };
  for (const name of ['safe-html', 'core']) vm.runInContext(readFileSync(`js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
  const SF = context.SF, C = SF.core;
  const dialogs = [], installs = [], saves = [];
  let open = 0, maxOpen = 0;
  SF.ui = { choiceDialog: async options => {
    dialogs.push(options); open++; maxOpen = Math.max(maxOpen, open);
    await new Promise(resolve => setTimeout(resolve, 5));   // 사용자가 읽는 시간
    open--; return answers.shift() ?? 'cancel';
  } };
  SF.io = { saveJSON: score => { saves.push(score); } };
  SF.app = { installScore: (score, opts) => { installs.push({ score, opts }); C.setScore(score); } };
  vm.runInContext(readFileSync('js/session.js', 'utf8'), context, { filename: 'session.js' });
  const dirty = () => C.mutate('edit', s => { s.meta.title = '편집한 제목 ' + C.state.revision; });
  return { SF, C, dialogs, installs, saves, dirty, maxOpen: () => maxOpen };
}
const next = (C, title = '새로 열 악보') => { const s = C.createScore({ measureCount: 1 }); s.meta.title = title; return s; };

test('① 변경이 없으면 대화상자 없이 교체', async () => {
  const h = harness();
  assert.equal(await h.SF.session.replaceScore(next(h.C), { reason: '다른 악보 열기' }), true);
  assert.equal(h.dialogs.length, 0); assert.equal(h.installs.length, 1);
  assert.equal(h.C.state.score.meta.title, '새로 열 악보');
});

test('② 변경이 있고 취소하면 악보·revision·실행 취소 기록이 그대로', async () => {
  const h = harness(['cancel']); h.dirty();
  const before = { score: h.C.state.score, revision: h.C.state.revision, title: h.C.state.score.meta.title };
  assert.equal(await h.SF.session.replaceScore(next(h.C), { reason: '새 악보 만들기' }), false);
  assert.equal(h.dialogs.length, 1); assert.equal(h.installs.length, 0);
  assert.equal(h.C.state.score, before.score); assert.equal(h.C.state.revision, before.revision);
  assert.equal(h.C.state.score.meta.title, before.title); assert.equal(h.C.canUndo(), true);
  assert.match(h.dialogs[0].message, /^새 악보 만들기 전에/);
  assert.deepEqual([...h.dialogs[0].choices.map(c => c.id)], ['save', 'discard', 'cancel']);
});

test('③ 저장하지 않고 계속하면 교체(저장 호출 없음)', async () => {
  const h = harness(['discard']); h.dirty();
  assert.equal(await h.SF.session.replaceScore(next(h.C)), true);
  assert.equal(h.saves.length, 0); assert.equal(h.installs.length, 1);
});

test('④ 파일로 저장하고 계속하면 saveJSON 1회 뒤 교체', async () => {
  const h = harness(['save']); h.dirty(); const old = h.C.state.score;
  assert.equal(await h.SF.session.replaceScore(next(h.C)), true);
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0], old); assert.equal(h.installs.length, 1);
});

test('④′ 저장 중 오류가 나면 교체하지 않는다', async () => {
  const h = harness(['save']); h.dirty();
  h.SF.io.saveJSON = () => { throw new Error('다운로드 실패'); };
  assert.equal(await h.SF.session.replaceScore(next(h.C)), false);
  assert.equal(h.installs.length, 0);
});

test('⑤ 읽기 전용이면 변경이 있어도 대화상자 없음', async () => {
  const h = harness(); h.dirty(); h.C.state.readOnly = true;
  assert.equal(await h.SF.session.replaceScore(next(h.C)), true);
  assert.equal(h.dialogs.length, 0);
});

test('⑥ confirmed: true면 대화상자 없음', async () => {
  const h = harness(); h.dirty();
  assert.equal(await h.SF.session.replaceScore(next(h.C), { confirmed: true }), true);
  assert.equal(h.dialogs.length, 0);
});

test('⑦ 동시에 두 번 요청해도 대화상자가 겹치지 않고 순서대로 처리', async () => {
  const h = harness(['discard', 'discard']); h.dirty();
  h.SF.app.installScore = (score, opts) => { h.installs.push({ score, opts }); };   // 교체해도 변경 상태가 유지되어 둘 다 묻는다
  const first = h.SF.session.replaceScore(next(h.C, '첫째'), { reason: '다른 악보 열기' });
  const second = h.SF.session.replaceScore(next(h.C, '둘째'), { reason: '데모 열기' });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.dialogs.length, 2); assert.equal(h.maxOpen(), 1);
  assert.deepEqual(h.installs.map(i => i.score.meta.title), ['첫째', '둘째']);
  assert.match(h.dialogs[0].message, /^다른 악보 열기 전에/); assert.match(h.dialogs[1].message, /^데모 열기 전에/);
});

test('⑦′ 첫 요청을 취소하면 둘째 요청이 이어서 묻는다', async () => {
  const h = harness(['cancel', 'discard']); h.dirty();
  h.SF.app.installScore = (score, opts) => { h.installs.push({ score, opts }); };
  const first = h.SF.session.replaceScore(next(h.C, '첫째'));
  const second = h.SF.session.replaceScore(next(h.C, '둘째'));
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(h.maxOpen(), 1); assert.equal(h.dialogs.length, 2);
  assert.deepEqual(h.installs.map(i => i.score.meta.title), ['둘째']);
});

test('stale이 참이면 확인 뒤에도 교체하지 않는다(더 새로운 요청에 밀림)', async () => {
  const h = harness(['discard']); h.dirty();
  let stale = false;
  const pending = h.SF.session.replaceScore(next(h.C), { stale: () => stale });
  stale = true;
  assert.equal(await pending, false); assert.equal(h.installs.length, 0);
});

test('교체 중 오류가 나도 다음 요청은 막히지 않는다', async () => {
  const h = harness();
  h.SF.app.installScore = () => { throw new Error('설치 실패'); };
  await assert.rejects(h.SF.session.replaceScore(next(h.C)), /설치 실패/);
  h.SF.app.installScore = (score, opts) => { h.installs.push({ score, opts }); };
  assert.equal(await h.SF.session.replaceScore(next(h.C, '다음')), true);
  assert.equal(h.installs.length, 1);
});

test('옵션은 installScore로 그대로 전달된다', async () => {
  const h = harness();
  await h.SF.session.replaceScore(next(h.C), { readOnly: true, name: '파일.json', toast: false });
  assert.equal(h.installs[0].opts.readOnly, true); assert.equal(h.installs[0].opts.name, '파일.json'); assert.equal(h.installs[0].opts.toast, false);
});

// 구조 고정: core.js 밖에서 악보를 직접 갈아 끼우는 곳은 app.js의 installScore 1곳과 부팅 2곳뿐
test('구조 고정: setScore 직접 호출 개수(core.js 제외)', () => {
  const counts = {};
  for (const file of readdirSync('js').filter(f => f.endsWith('.js') && f !== 'core.js')) {
    const n = (readFileSync(`js/${file}`, 'utf8').match(/\b(?:C|core|SF\.core)\.setScore\(/g) || []).length;
    if (n) counts[file] = n;
  }
  assert.deepEqual(counts, { 'app.js': 3 });   // installScore 1 + 부팅 2(2-E에서 1로 줄인다)
  const app = readFileSync('js/app.js', 'utf8');
  assert.equal((app.match(/function installScore\(/g) || []).length, 1);
});

test('구조 고정: 교체 경로는 모두 SF.session.replaceScore 또는 handleLoadedScore를 거친다', () => {
  const app = readFileSync('js/app.js', 'utf8'), cloud = readFileSync('js/cloud.js', 'utf8'), pwa = readFileSync('js/pwa.js', 'utf8'), v3 = readFileSync('js/ui-v3.js', 'utf8');
  assert.equal((app.match(/SF\.session\.replaceScore\(/g) || []).length, 5);   // 새 악보·데모(메뉴) + 시작 화면 빈 악보·데모 + handleLoadedScore 안
  assert.doesNotMatch(app, /if \(args\[0\]\) setReadOnly\(false\)/);          // 확인 전에 읽기 전용을 풀던 선호출 금지(F6)
  assert.doesNotMatch(v3, /setReadOnly\(false\);A\.IO\.loadScoreFile/);
  assert.match(pwa, /loadScoreFile\(file, SF\.app\.handleLoadedScore\)/);
  assert.doesNotMatch(cloud, /setReadOnly\(readOnly\)/);                       // 클라우드가 읽기 전용을 따로 만지지 않는다
  assert.doesNotMatch(cloud, /confirm\("현재 악보의 변경 사항/);               // 자체 확인 삭제
});

test('i18n: 저장 확인 대화상자의 모든 문구가 영어로 번역된다', () => {
  const context = vm.createContext({ console, navigator: { language: 'en-US' } });
  context.window = context;
  vm.runInContext(readFileSync('js/i18n.js', 'utf8'), context, { filename: 'i18n.js' });
  const t = text => context.SF.i18n.translate(text);
  assert.equal(t('저장하지 않은 변경 사항'), 'Unsaved changes');
  assert.equal(t('파일로 저장하고 계속'), 'Save to a file and continue');
  assert.equal(t('저장하지 않고 계속'), 'Continue without saving');
  assert.equal(t('취소'), 'Cancel');
  const reasons = { '다른 악보 열기': 'Open another score', '새 악보 만들기': 'Create new score', '데모 열기': 'Open a demo score', '클라우드 악보 열기': 'Open a cloud score', '로컬 사본 만들기': 'Make a local copy' };
  for (const [ko, en] of Object.entries(reasons))
    assert.equal(t(`${ko} 전에 현재 악보를 어떻게 할까요?`), `What should happen to the current score before you continue? (${en})`);
  for (const ko of ['데모 악보를 불러왔어요 — 스페이스로 재생해 보세요', '스페이스 키로 재생해 보세요!'])
    assert.doesNotMatch(t(ko), /[가-힣]/, ko);   // 새로 연결한 토스트도 번역돼 있어야 한다
});

/* =====================================================================
 * P2-B 악보별 자동 저장 — 실제 core·io·store·session을 한 컨텍스트에 올리고
 * 저장소만 메모리 백엔드로, 화면(대화상자·설치·토스트)만 스텁으로 둔다.
 * ===================================================================== */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TAB_KEY = 'scoreforge.activeDocId', LEGACY_KEY = 'scoreforge.autosave.v1';
function webStorage() {
  const map = new Map();
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, removeItem: key => { map.delete(key); } };
}
/** options: answers(대화상자 답), backend(공유할 메모리 백엔드), backendOptions, localStorage, sessionStorage, noStore */
function boot(options = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, structuredClone, TextEncoder, crypto: globalThis.crypto });
  context.window = context;
  context.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  context.localStorage = options.localStorage || webStorage();
  context.sessionStorage = options.sessionStorage || webStorage();
  for (const name of ['safe-html', 'core', 'engrave', 'playback', 'io', 'store'])
    vm.runInContext(readFileSync(`js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
  const SF = context.SF, C = SF.core;
  const backend = options.backend || SF.storeTesting.memoryBackend(options.backendOptions);
  if (!options.noStore) SF.store = SF.storeTesting.createStore(backend);
  const dialogs = [], installs = [], toasts = [], answers = [...(options.answers || [])];
  SF.ui = { choiceDialog: async dialog => { dialogs.push(dialog); await new Promise(resolve => setTimeout(resolve, 2)); return answers.shift() ?? 'cancel'; } };
  SF.io.saveJSON = () => {};   // 파일 내려받기 흉내(브라우저 API 없음)
  SF.app = { installScore: (score, opts) => { installs.push({ score, opts }); C.state.readOnly = !!opts.readOnly; C.setScore(score); }, toast: message => toasts.push(message) };
  vm.runInContext(readFileSync('js/session.js', 'utf8'), context, { filename: 'session.js' });
  const titled = title => { const score = C.createScore({ measureCount: 1 }); score.meta.title = title; return score; };
  const edit = title => C.mutate('편집', score => { score.meta.title = title; });
  const replace = (score, opts = {}) => SF.session.replaceScore(score, { confirmed: true, ...opts });
  const docId = () => C.state.score.meta.docId;
  return { SF, C, context, backend, dialogs, installs, toasts, answers, titled, edit, replace, docId, local: context.localStorage, tab: context.sessionStorage, list: () => SF.store.listDocs(), load: id => SF.store.loadDoc(id), flush: () => SF.io.flushAutosave() };
}

test('P2-B ① docId 규칙: 새 악보·데모·가져오기=새 UUID, 파일=UUID 이어받기, 클라우드=cloud:+cloudId, 사본=새 UUID, 공유 보기=없음', async () => {
  const h = boot(); const seen = new Set();
  for (const origin of ['new', 'demo', 'import']) {
    await h.replace(h.titled(origin), { origin });
    assert.match(h.docId(), UUID_RE, origin); seen.add(h.docId());
  }
  assert.equal(seen.size, 3);                                                   // 매번 다른 ID
  const fileId = '11111111-2222-4333-8444-555555555555';
  const file = h.titled('파일'); file.meta.docId = fileId;
  await h.replace(file, { origin: 'file' }); assert.equal(h.docId(), fileId);
  const spoof = h.titled('흉내 낸 파일'); spoof.meta.docId = 'cloud:abc';       // UUID가 아닌 ID는 믿지 않는다
  await h.replace(spoof, { origin: 'file' }); assert.match(h.docId(), UUID_RE);
  const cloud = h.titled('클라우드'); cloud.meta.cloudId = 'row-1';
  await h.replace(cloud, { origin: 'cloud' }); assert.equal(h.docId(), 'cloud:row-1');
  const copy = h.titled('사본'); copy.meta.docId = fileId;                      // 같은 ID를 들고 와도
  await h.replace(copy, { origin: 'copy' }); assert.match(h.docId(), UUID_RE); assert.notEqual(h.docId(), fileId);
  assert.equal(h.tab.getItem(TAB_KEY), h.docId());                              // 이 탭의 현재 문서
  await h.replace(h.titled('공유 악보'), { origin: 'cloud', readOnly: true });
  assert.equal(h.docId(), undefined); assert.equal(h.tab.getItem(TAB_KEY), null);
});

test('P2-B ② 열기만 해서는 기록이 없고, 첫 편집 뒤 저장하면 기록 1건(같은 문서는 덮어쓰기)', async () => {
  const h = boot();
  await h.replace(h.titled('열기만 한 데모'), { origin: 'demo' });
  assert.equal(h.SF.session.savedLabel(), '');
  assert.equal((await h.list()).length, 0);
  h.edit('첫 편집'); assert.equal(await h.flush(), true); assert.ok(h.C.isAutosaved());
  const id = h.docId(), rows = await h.list(); assert.equal(rows.length, 1);
  const rec = await h.load(id);
  assert.equal(rec.title, '첫 편집'); assert.equal(rec.origin, 'demo'); assert.equal(rec.revision, h.C.state.revision);
  assert.equal(rec.schema, 1); assert.equal(rec.measures, 1); assert.equal(rec.cloudId, null); assert.ok(rec.bytes > 100);
  assert.equal(rec.data.meta.docId, id); assert.ok(rec.createdAt > 0 && rec.updatedAt >= rec.createdAt);
  assert.equal(await h.SF.store.kvGet('lastDocId'), id); assert.equal(h.tab.getItem(TAB_KEY), id);
  assert.equal(h.SF.session.activeId(), id); assert.equal(h.SF.session.savedLabel(), '파일로 저장한 적 없어요');
  await new Promise(resolve => setTimeout(resolve, 5));
  h.edit('두 번째 편집'); assert.equal(await h.flush(), true);
  assert.equal((await h.list()).length, 1);
  const again = await h.load(id); assert.equal(again.title, '두 번째 편집'); assert.equal(again.createdAt, rec.createdAt);
});

test('P2-B ③ 보관에 성공하면 대화상자 없이 교체하고, 보관 토스트·이전 악보 기록이 남는다', async () => {
  const h = boot();
  await h.replace(h.titled('처음'), { origin: 'new' }); h.edit('지켜야 할 작업'); const oldId = h.docId();
  assert.equal(h.C.state.dirty, true);
  assert.equal(await h.SF.session.replaceScore(h.titled('다음'), { origin: 'demo', reason: '데모 열기' }), true);
  assert.equal(h.dialogs.length, 0);
  assert.equal(JSON.stringify(h.toasts), JSON.stringify(['이전 악보는 최근 작업에 보관했어요']));
  assert.equal((await h.load(oldId)).title, '지켜야 할 작업');
  assert.notEqual(h.docId(), oldId); assert.equal(h.C.state.score.meta.title, '다음');
  assert.equal(h.tab.getItem(TAB_KEY), h.docId());
  // 변경이 없으면 보관 토스트도 없다
  h.toasts.length = 0;
  assert.equal(await h.SF.session.replaceScore(h.titled('또 다음'), { origin: 'new' }), true);
  assert.equal(h.toasts.length, 0); assert.equal(h.dialogs.length, 0);
});

test('P2-B ④ 저장소가 IndexedDB가 아니면(localStorage 방식) flushActive는 false — 예전처럼 3지선다, 저장은 1칸 localStorage', async () => {
  const h = boot({ backendOptions: { failOpen: true }, answers: ['cancel'] });
  await h.replace(h.titled('처음'), { origin: 'new' }); h.edit('편집한 작업');
  assert.equal(await h.SF.session.flushActive(), false);
  assert.equal(h.SF.store.backend, 'localStorage');
  assert.equal(await h.SF.session.replaceScore(h.titled('다음'), { origin: 'demo' }), false);
  assert.equal(h.dialogs.length, 1); assert.equal(h.toasts.length, 0);
  assert.equal(await h.flush(), true);                                          // 기본 writer = 지금 방식 그대로
  assert.equal(JSON.parse(h.local.getItem(LEGACY_KEY)).score.meta.title, '편집한 작업');
});

test('P2-B ⑤ 저장에 실패하면(공간 부족) 보관한 것으로 치지 않고 묻는다', async () => {
  const h = boot({ answers: ['cancel'] });
  await h.replace(h.titled('처음'), { origin: 'new' }); h.edit('편집'); assert.equal(await h.flush(), true);
  h.backend.options.failPut = true; h.edit('더 편집');
  assert.equal(await h.flush(), false);
  assert.equal(h.SF.io.getAutosaveStatus().error.name, 'QuotaExceededError'); assert.equal(h.C.isAutosaved(), false);
  assert.equal(await h.SF.session.flushActive(), false);
  assert.equal(await h.SF.session.replaceScore(h.titled('다음')), false);
  assert.equal(h.dialogs.length, 1);
  assert.equal((await h.list()).length, 1); assert.equal((await h.load(h.docId())).title, '편집');   // 이미 보관된 것은 그대로
});

function legacyPayload(title, savedAt = 1700000000000, revision = 7) {
  const maker = boot(), score = maker.titled(title);
  return JSON.stringify({ savedAt, revision, score: maker.C.toJSON(score) });
}

test('P2-B ⑥ 옛 자동 저장(localStorage v1)은 한 번만 문서로 옮기고 원본은 지우지 않는다(두 번 부팅해도 문서 1개)', async () => {
  const payload = legacyPayload('옛 작업');
  const first = boot(); first.local.setItem(LEGACY_KEY, payload);
  const restored = await first.SF.session.restoreOnBoot();
  assert.equal(restored.meta.title, '옛 작업'); assert.equal(restored.meta.docId, 'legacy-v1');
  const rows = await first.list(); assert.equal(rows.length, 1);
  const rec = await first.load('legacy-v1');
  assert.equal(rec.origin, 'legacy'); assert.equal(rec.updatedAt, 1700000000000); assert.equal(rec.revision, 7); assert.equal(rec.title, '옛 작업');
  assert.equal(JSON.stringify(rec.data.measures), JSON.stringify(JSON.parse(payload).score.measures));   // 내용 동일
  assert.equal(first.local.getItem(LEGACY_KEY), payload);                                              // 원본 유지
  assert.ok(await first.SF.store.kvGet('migrated.v1'));
  // 두 번째 부팅(같은 저장소, 새 탭)
  const second = boot({ backend: first.backend, localStorage: first.local });
  const again = await second.SF.session.restoreOnBoot();
  assert.equal(again.meta.title, '옛 작업'); assert.equal((await second.list()).length, 1);
  // 옮긴 문서를 고치면 그 기록이 갱신되고, 다음 부팅의 이전이 덮어쓰지 않는다
  await new Promise(resolve => setTimeout(resolve, 5));
  second.C.setScore(again); second.edit('고친 옛 작업'); assert.equal(await second.flush(), true);
  const third = boot({ backend: first.backend, localStorage: first.local });
  const last = await third.SF.session.restoreOnBoot();
  assert.equal(last.meta.title, '고친 옛 작업'); assert.equal((await third.list()).length, 1);
  assert.equal(third.local.getItem(LEGACY_KEY), payload);
});

test('P2-B ⑥′ 옛 자동 저장 이전이 실패해도 원본은 그대로이고, 읽을 수 있으면 이번 부팅에 보여 준다', async () => {
  const broken = boot(); broken.local.setItem(LEGACY_KEY, '{이건 JSON이 아니에요');
  assert.equal(await broken.SF.session.restoreOnBoot(), null);
  assert.equal((await broken.list()).length, 0); assert.equal(await broken.SF.store.kvGet('migrated.v1'), null);
  assert.equal(broken.local.getItem(LEGACY_KEY), '{이건 JSON이 아니에요');
  // 쓰기에 실패하는 저장소: 문서로는 못 옮기지만 작업은 보인다
  const payload = legacyPayload('옛 작업');
  const full = boot({ backendOptions: { failPut: true } }); full.local.setItem(LEGACY_KEY, payload);
  const shown = await full.SF.session.restoreOnBoot();
  assert.equal(shown.meta.title, '옛 작업'); assert.equal(shown.meta.docId, 'legacy-v1');
  assert.equal(await full.SF.store.kvGet('migrated.v1'), null); assert.equal(full.local.getItem(LEGACY_KEY), payload);
});

test('P2-B ⑦ 부팅 때 고르는 순서: 이 탭의 문서 → 마지막 문서 → 가장 최근 문서, 깨진 기록은 건너뛴다', async () => {
  const h = boot(); const make = async (id, title, updatedAt, data) => h.SF.store.saveDoc({ id, title, createdAt: 1, updatedAt, revision: 1, origin: 'new', cloudId: null, measures: 1, bytes: 1, schema: 1, data: data || h.C.toJSON(h.titled(title)) });
  await make('a', 'A', 10); await make('b', 'B', 20); await make('c', 'C', 30);
  await h.SF.store.kvSet('lastDocId', 'a'); h.tab.setItem(TAB_KEY, 'b');
  assert.equal((await h.SF.session.restoreOnBoot()).meta.title, 'B'); assert.equal(h.tab.getItem(TAB_KEY), 'b');
  h.tab.removeItem(TAB_KEY); assert.equal((await h.SF.session.restoreOnBoot()).meta.title, 'A'); assert.equal(h.tab.getItem(TAB_KEY), 'a');
  h.tab.removeItem(TAB_KEY); await h.SF.store.kvSet('lastDocId', '없는-문서');
  assert.equal((await h.SF.session.restoreOnBoot()).meta.title, 'C');
  await make('d', 'D 깨짐', 40, { parts: 'x' }); h.tab.setItem(TAB_KEY, 'd');
  assert.equal((await h.SF.session.restoreOnBoot()).meta.title, 'C');            // d는 읽을 수 없어 건너뛴다
  const empty = boot(); assert.equal(await empty.SF.session.restoreOnBoot(), null);   // 기록이 없으면 데모로 시작(호출한 쪽)
});

test('P2-B ⑧ 파일의 docId와 같은 기록이 있고 내용이 다르면 묻는다 — 자동 저장본 / 파일 그대로(새 문서로) / 취소, 기존 기록은 덮어쓰지 않는다', async () => {
  const h = boot();
  await h.replace(h.titled('원본'), { origin: 'new' }); h.edit('자동 저장본에서 고친 제목'); assert.equal(await h.flush(), true);
  const X = h.docId(), before = JSON.stringify(await h.load(X));
  const fileScore = () => { const s = h.titled('파일에 든 제목'); s.meta.docId = X; return s; };
  const choices = () => h.dialogs.at(-1).choices.map(choice => choice.id).join(',');

  h.answers.push('cancel');
  assert.equal(await h.replace(fileScore(), { origin: 'file' }), false);
  assert.equal(h.dialogs.length, 1); assert.equal(choices(), 'autosave,file,cancel'); assert.match(h.dialogs[0].title, /자동 저장본/);
  assert.equal(h.C.state.score.meta.title, '자동 저장본에서 고친 제목');

  h.answers.push('autosave');
  assert.equal(await h.replace(fileScore(), { origin: 'file' }), true);
  assert.equal(h.C.state.score.meta.title, '자동 저장본에서 고친 제목'); assert.equal(h.docId(), X);

  h.answers.push('file');
  assert.equal(await h.replace(fileScore(), { origin: 'file' }), true);
  assert.equal(h.C.state.score.meta.title, '파일에 든 제목'); assert.match(h.docId(), UUID_RE); assert.notEqual(h.docId(), X);
  assert.equal(JSON.stringify(await h.load(X)), before);                         // 기존 기록은 그대로
  h.edit('새 문서로 연 뒤 편집'); assert.equal(await h.flush(), true);
  assert.equal(JSON.stringify(await h.load(X)), before); assert.equal((await h.list()).length, 2);

  // 내용이 같으면 묻지 않고 같은 문서로 이어서 연다
  const same = h.C.fromJSON((await h.load(X)).data);
  h.dialogs.length = 0;
  assert.equal(await h.replace(same, { origin: 'file' }), true);
  assert.equal(h.dialogs.length, 0); assert.equal(h.docId(), X);
});

test('P2-B ⑨ 사본을 만들어도 이전 문서의 기록을 덮어쓰지 않는다', async () => {
  const h = boot();
  await h.replace(h.titled('내 작업'), { origin: 'new' }); h.edit('이전 문서'); assert.equal(await h.flush(), true);
  const X = h.docId(), recordBefore = JSON.stringify(await h.load(X));
  const copy = h.C.fromJSON(h.C.toJSON(h.C.state.score));                        // docId X까지 그대로 들고 있는 사본 재료
  assert.equal(copy.meta.docId, X);
  await h.replace(copy, { origin: 'copy' });
  assert.notEqual(h.docId(), X); h.edit('사본에서 편집'); assert.equal(await h.flush(), true);
  assert.equal((await h.list()).length, 2); assert.equal(JSON.stringify(await h.load(X)), recordBefore);
  assert.equal((await h.load(h.docId())).origin, 'copy');
});

test('P2-B ⑩ docId를 주고 열면 같은 문서로 이어진다(만든 시각·출처 유지)', async () => {
  const h = boot();
  await h.replace(h.titled('원래'), { origin: 'demo' }); h.edit('이어서 열 문서'); assert.equal(await h.flush(), true);
  const record = await h.load(h.docId());
  await h.replace(h.titled('다른 문서'), { origin: 'new' });
  await new Promise(resolve => setTimeout(resolve, 5));
  await h.replace(h.C.fromJSON(record.data), { docId: record.id });
  assert.equal(h.docId(), record.id); h.edit('이어서 편집'); assert.equal(await h.flush(), true);
  const after = await h.load(record.id);
  assert.equal(after.title, '이어서 편집'); assert.equal(after.createdAt, record.createdAt); assert.equal(after.origin, 'demo');
});

test('P2-B ⑪ 파일로 저장하면 시각이 기록과 상태 표시줄 문구에 남는다', async () => {
  const h = boot();
  await h.replace(h.titled('저장할 악보'), { origin: 'new' }); h.edit('편집'); assert.equal(await h.flush(), true);
  assert.equal(h.SF.session.savedLabel(), '파일로 저장한 적 없어요');
  h.C.markSaved();                                                               // io.saveJSON이 끝나면 부르는 것
  assert.match(h.SF.session.savedLabel(), /^마지막 파일 저장 \d{1,2}(\/\d{1,2} )?:?\d{0,2}/);
  assert.equal(await h.flush(), true);
  assert.ok((await h.load(h.docId())).fileSavedAt > 0);
  const next = boot({ backend: h.backend, sessionStorage: h.tab });
  await next.SF.session.restoreOnBoot();
  assert.match(next.SF.session.savedLabel(), /^마지막 파일 저장 /);
});

test('P2-B ⑫ 공유 보기(읽기 전용)는 기록을 만들지 않는다', async () => {
  const h = boot();
  await h.replace(h.titled('공유 악보'), { origin: 'cloud', readOnly: true });
  assert.equal(await h.flush(), true);
  assert.equal((await h.list()).length, 0); assert.equal(h.SF.session.savedLabel(), '');
});

test('P2-B ⑬ 늦게 끝난 오래된 저장이 더 새로운 저장 표시를 덮어쓰지 않고, 기록은 마지막 내용', async () => {
  const h = boot();
  await h.replace(h.titled('처음'), { origin: 'new' });
  h.edit('첫 번째'); const first = h.flush();
  h.edit('두 번째'); const second = h.flush();
  assert.deepEqual(await Promise.all([first, second]).then(list => list.map(Boolean)), [true, true]);
  assert.equal((await h.load(h.docId())).title, '두 번째'); assert.equal(h.SF.io.getAutosaveStatus().revision, h.C.state.revision); assert.ok(h.C.isAutosaved());
});

test('P2-B 구조 고정: 스크립트 순서(store → session → app), 옛 자동 저장 원본을 지우는 곳은 기존 clearAutosave(테스트 전용) 하나뿐', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.indexOf('js/io.js') < html.indexOf('js/store.js') && html.indexOf('js/store.js') < html.indexOf('js/session.js') && html.indexOf('js/session.js') < html.indexOf('js/app.js'));
  const strip = source => source.replace(/\/\/.*$/gm, '');
  const removers = [], callers = [];
  for (const file of readdirSync('js').filter(f => f.endsWith('.js'))) {
    const source = strip(readFileSync(`js/${file}`, 'utf8'));
    const removals = (source.match(/localStorage\??\.removeItem\(\s*(?:AUTOSAVE_KEY|LEGACY_KEY|["']scoreforge\.autosave\.v1["'])/g) || []).length;
    if (removals) removers.push(`${file}:${removals}`);
    const calls = (source.match(/\bclearAutosave\s*\(/g) || []).length - (file === 'io.js' ? 1 : 0);   // io.js의 함수 선언 1회는 제외
    if (calls > 0) callers.push(`${file}:${calls}`);
  }
  assert.equal(removers.join(), 'io.js:1');   // 9-6에서 삭제 예정인 기존 함수. 마이그레이션·부팅·세션은 지우지 않는다
  assert.equal(callers.join(), '');            // 앱 코드 어디서도 부르지 않는다
});

test('P2-B i18n: 보관 토스트·충돌 대화상자·상태 표시줄 문구가 영어로 번역된다', () => {
  const context = vm.createContext({ console, navigator: { language: 'en-US' } });
  context.window = context;
  vm.runInContext(readFileSync('js/i18n.js', 'utf8'), context, { filename: 'i18n.js' });
  const t = text => context.SF.i18n.translate(text);
  for (const ko of ['이전 악보는 최근 작업에 보관했어요', '같은 악보의 자동 저장본이 있어요', '자동 저장본 열기', '파일 그대로 열기(새 문서로)', '파일로 저장한 적 없어요',
    '자동 저장에 실패했어요. 파일 메뉴에서 악보를 저장해 주세요.', '자동 저장은 이 브라우저에만 남아요. 중요한 악보는 파일로 저장해 두세요.',
    '이 파일과 같은 악보가 이 기기에 자동 저장돼 있는데 내용이 달라요. 어느 쪽을 열까요?', '마지막 파일 저장 14:32', '마지막 파일 저장 11/23 09:05'])
    assert.doesNotMatch(t(ko), /[가-힣]/, ko);
  assert.equal(t('마지막 파일 저장 14:32'), 'Last file save 14:32');
});
