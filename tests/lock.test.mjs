// P2-D 탭 간 편집 충돌 방지 테스트 — 탭 하나 = vm 컨텍스트 하나.
// 같은 출처를 흉내 내려고 Web Locks·BroadcastChannel·localStorage·IndexedDB(메모리 백엔드)는 탭끼리 공유하고,
// sessionStorage·악보·화면 스텁만 탭마다 따로 둔다. 실제 core·io·store·lock·session을 그대로 올린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const TAB_KEY = 'scoreforge.activeDocId';
// 다른 vm 컨텍스트에서 만든 배열·객체는 프로토타입이 달라 deepStrictEqual이 거부하므로 JSON으로 풀어 비교한다.
const same = (actual, expected, message) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 2000, label = '조건') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await sleep(8); }
  assert.fail(`${label}이(가) ${ms}ms 안에 이루어지지 않았어요`);
}
function webStorage() {
  const map = new Map();
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, removeItem: key => { map.delete(key); } };
}

/** 한 브라우저(같은 출처)의 공유 자원: 잠금 관리자, 방송 채널, 저장소 */
function makeWorld() {
  const held = new Map(), channels = new Set();
  let owners = 0;
  return {
    held, backend: null, localStorage: webStorage(),
    owner: () => ++owners,
    locksFor(owner) {
      return {
        request(name, options, callback) {
          if (typeof options === 'function') { callback = options; options = {}; }
          if (held.has(name)) {
            if (options?.ifAvailable) return Promise.resolve(callback(null));
            return new Promise(() => {});                       // 대기열은 흉내 내지 않는다
          }
          held.set(name, owner);
          return Promise.resolve(callback({ name, mode: 'exclusive' })).finally(() => { if (held.get(name) === owner) held.delete(name); });
        },
        query: async () => ({ held: [...held.keys()].map(name => ({ name, mode: 'exclusive' })), pending: [] }),
      };
    },
    channelFor(owner) {
      return class {
        constructor(name) { this.name = name; this.owner = owner; this.onmessage = null; channels.add(this); }
        postMessage(data) {
          const copy = structuredClone(data);
          for (const peer of channels) if (peer !== this && peer.name === this.name && peer.owner !== owner) setTimeout(() => peer.onmessage?.({ data: copy }), 0);
        }
        close() { channels.delete(this); }
      };
    },
    /** 탭이 사라졌다 — 브라우저가 그 탭의 잠금을 풀고 채널을 닫는다(스크립트는 돌지 않는다) */
    kill(owner) {
      for (const [name, who] of [...held]) if (who === owner) held.delete(name);
      for (const channel of [...channels]) if (channel.owner === owner) channels.delete(channel);
    },
  };
}

/** options: sessionStorage(공유해서 새로고침·탭 복제를 흉내), noLocks, noChannel, answers */
function openTab(world, options = {}) {
  const owner = world.owner();
  const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, structuredClone, TextEncoder, crypto: globalThis.crypto });
  context.window = context;
  context.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  context.localStorage = world.localStorage;
  context.sessionStorage = options.sessionStorage || webStorage();
  context.navigator = options.noLocks ? {} : { locks: world.locksFor(owner) };
  if (!options.noChannel) context.BroadcastChannel = world.channelFor(owner);
  for (const name of ['safe-html', 'core', 'engrave', 'playback', 'io', 'store', 'lock'])
    vm.runInContext(readFileSync(`js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
  const SF = context.SF, C = SF.core;
  SF.lockTesting.config.pingWait = 40; SF.lockTesting.config.watchInterval = 40; SF.lockTesting.config.settle = 30;
  world.backend ||= SF.storeTesting.memoryBackend();
  SF.store = SF.storeTesting.createStore(world.backend);
  const dialogs = [], installs = [], toasts = [], toastOptions = [], answers = [...(options.answers || [])], events = [];
  SF.ui = { choiceDialog: async dialog => { dialogs.push(dialog); await sleep(2); return answers.shift() ?? 'cancel'; } };
  SF.io.saveJSON = () => {};
  SF.app = {
    installScore: (score, opts) => { installs.push({ score, opts }); C.state.readOnly = !!opts.readOnly; C.setScore(score); },
    toast: (message, toastOpts) => { toasts.push(message); toastOptions.push(toastOpts); },
  };
  vm.runInContext(readFileSync('js/session.js', 'utf8'), context, { filename: 'session.js' });
  SF.session.onLock(state => events.push(state));
  const titled = title => { const score = C.createScore({ measureCount: 1 }); score.meta.title = title; return score; };
  const edit = title => C.mutate('편집', score => { score.meta.title = title; });
  const replace = (score, opts = {}) => SF.session.replaceScore(score, { confirmed: true, ...opts });
  return {
    SF, C, context, owner, dialogs, installs, toasts, toastOptions, events, titled, edit, replace,
    tab: context.sessionStorage, docId: () => C.state.score.meta.docId, held: () => SF.lock.heldIds(),
    flush: () => SF.io.flushAutosave(), list: () => SF.store.listDocs(), load: id => SF.store.loadDoc(id),
    close: () => world.kill(owner),
    /** 새 악보를 열어 한 번 고치고 보관까지 마친 문서 ID */
    async make(title, origin = 'new') { await replace(titled(title), { origin }); edit(title + ' 편집'); await this.flush(); return this.docId(); },
  };
}

/* ===================== 잠금 기본 동작 ===================== */

test('P2-D ① 같은 악보를 두 번째 탭이 열면 읽기 전용, 첫 탭은 계속 편집', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  assert.equal(a.SF.session.lockState().locked, false);
  same(a.held(), [id]);
  assert.equal(await b.SF.session.openDoc(id), 'opened');
  assert.equal(b.SF.session.lockState().locked, true);
  assert.equal(b.installs.at(-1).opts.readOnly, true); assert.equal(b.C.state.readOnly, true);
  assert.equal(b.docId(), id); assert.equal(b.tab.getItem(TAB_KEY), id);       // 새로고침하면 다시 시도할 수 있게 문서는 그대로
  same(b.held(), []);                                              // B는 잠금을 쥐지 않는다
  assert.equal(a.C.state.readOnly, false);
  const before = (await a.load(id)).updatedAt;
  await b.SF.session.persist(b.C.state.score, 99, Date.now() + 5000);          // 읽기 전용은 저장하지 않는다
  assert.equal((await a.load(id)).updatedAt, before);
});

test('P2-D ② 다른 악보면 두 탭 모두 편집 가능', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const x = await a.make('악보 X'), y = await b.make('악보 Y');
  assert.notEqual(x, y);
  assert.equal(a.SF.session.lockState().locked, false); assert.equal(b.SF.session.lockState().locked, false);
  assert.equal(a.C.state.readOnly, false); assert.equal(b.C.state.readOnly, false);
  same(a.held(), [x]); same(b.held(), [y]);
});

test('P2-D ③ 같은 탭에서 자기 문서를 다시 열어도 자기 잠금에 막히지 않는다', async () => {
  const world = makeWorld(), a = openTab(world);
  const id = await a.make('악보 X');
  assert.equal(await a.SF.session.openDoc(id), 'opened');
  assert.equal(a.SF.session.lockState().locked, false); assert.equal(a.installs.at(-1).opts.readOnly, undefined);
  same(a.held(), [id]);                                            // 잠금은 하나뿐(놓았다 다시 잡지 않았다)
  same([...world.held.keys()], ['scoreforge-doc:' + id]);
});

test('P2-D ④ 다른 악보로 바꾸면 이전 악보의 잠금을 놓고, 새 악보가 자리 잡은 뒤에야 놓는다', async () => {
  const world = makeWorld(), a = openTab(world);
  const x = await a.make('악보 X');
  let heldDuringInstall = null;
  const original = a.SF.app.installScore;
  a.SF.app.installScore = (score, opts) => { heldDuringInstall = [...world.held.keys()].sort(); original(score, opts); };
  await a.replace(a.titled('악보 Y'), { origin: 'new' });
  const y = a.docId();
  same(heldDuringInstall, ['scoreforge-doc:' + x, 'scoreforge-doc:' + y].sort());   // 설치하는 동안은 둘 다 쥐고 있다
  same([...world.held.keys()], ['scoreforge-doc:' + y]);                               // 설치 뒤에 이전 것을 놓았다
  same(a.held(), [y]);
});

test('P2-D ⑤ 설치가 실패하면 새 잠금은 돌려주고 이전 악보의 잠금은 그대로', async () => {
  const world = makeWorld(), a = openTab(world);
  const x = await a.make('악보 X');
  a.SF.app.installScore = () => { throw new Error('설치 실패'); };
  await assert.rejects(a.replace(a.titled('악보 Y'), { origin: 'new' }), /설치 실패/);
  same([...world.held.keys()], ['scoreforge-doc:' + x]);
  same(a.held(), [x]); assert.equal(a.SF.session.lockState().docId, x);
  assert.equal(a.tab.getItem(TAB_KEY), x);
});

test('P2-D ⑥ 확인 뒤에 더 새로운 요청에 밀리면(stale) 이미 잡은 잠금을 돌려준다', async () => {
  const world = makeWorld(), a = openTab(world);
  const x = await a.make('악보 X');
  let calls = 0;
  assert.equal(await a.replace(a.titled('악보 Y'), { origin: 'new', stale: () => ++calls >= 3 }), false);   // 세 번째 확인(잠금을 잡은 직후)에서 밀린다
  assert.equal(calls, 3);
  same([...world.held.keys()], ['scoreforge-doc:' + x]); same(a.held(), [x]);
});

test('P2-D ⑦ 공유 보기(읽기 전용 열기)는 잠금을 만들지 않고 이전 악보의 잠금을 놓는다', async () => {
  const world = makeWorld(), a = openTab(world);
  await a.make('악보 X');
  await a.replace(a.titled('공유 악보'), { origin: 'cloud', readOnly: true });
  same([...world.held.keys()], []); same(a.held(), []);
  same(a.SF.session.lockState(), { docId: '', locked: false, available: false });
});

test('P2-D ⑧ 두 탭이 같은 파일(같은 UUID)을 동시에 열면 한쪽만 편집', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const file = (tab, title) => { const s = tab.titled(title); s.meta.docId = '11111111-2222-4333-8444-555555555555'; return s; };
  const [ra, rb] = await Promise.all([a.replace(file(a, '파일'), { origin: 'file' }), b.replace(file(b, '파일'), { origin: 'file' })]);
  assert.equal(ra && rb, true);
  const states = [a.SF.session.lockState().locked, b.SF.session.lockState().locked].sort();
  same(states, [false, true]);                                      // 정확히 한쪽만 읽기 전용
});

/* ===================== 풀림 알림 · 편집 시작 · 사본 ===================== */

test('P2-D ⑨ 잡고 있던 탭이 다른 악보로 바꾸면 읽기 전용 탭에 "이제 편집할 수 있어요"', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  await b.SF.session.openDoc(id);
  assert.equal(b.SF.session.lockState().available, false);
  await a.replace(a.titled('악보 Y'), { origin: 'new' });                       // A가 X를 놓는다 → doc-closed 방송
  await until(() => b.SF.session.lockState().available, 1500, '풀림 알림');
  same(b.SF.session.lockState(), { docId: id, locked: true, available: true });
  assert.equal(b.events.at(-1).available, true);
  assert.equal(b.C.state.readOnly, true);                                       // 알려 줄 뿐, 저절로 편집 상태로 바꾸지 않는다
});

test('P2-D ⑨′ 잡고 있던 탭이 새로고침처럼 잠깐 놓았다가 곧바로 다시 잡으면 헛된 "편집할 수 있어요"를 띄우지 않는다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  await b.SF.session.openDoc(id);
  b.SF.lockTesting.config.settle = 400;                                          // 이 안에 다시 잡히면 알리지 않는다
  a.close();                                                                     // 옛 페이지가 사라지고
  await sleep(150);                                                              // 새 페이지가 뜨기까지의 틈 — B는 이 동안 비어 있음을 여러 번 본다(안정화 시간보다는 짧다)
  const reloaded = openTab(world, { sessionStorage: a.tab });
  await reloaded.SF.session.restoreOnBoot();                                     // 새 페이지가 곧바로 자기 문서를 다시 잡는다
  assert.equal(reloaded.SF.session.lockState().locked, false);
  await sleep(700);
  same(b.SF.session.lockState(), { docId: id, locked: true, available: false });
  reloaded.close();                                                              // 이번에는 정말로 사라진다
  await until(() => b.SF.session.lockState().available, 2500, '진짜 풀림');
});

test('P2-D ⑩ 방송 없이 탭이 사라져도(비정상 종료) 주기 확인으로 풀림을 알아낸다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  await b.SF.session.openDoc(id);
  a.close();                                                                    // 방송도 못 하고 사라졌다
  await until(() => b.SF.session.lockState().available, 1500, '주기 확인');
});

test('P2-D ⑪ [편집 시작]은 화면에 있던 낡은 내용이 아니라 보관된 최신 내용을 다시 읽어 연다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');                                            // 제목 "악보 X 편집"
  await b.SF.session.openDoc(id);
  assert.equal(b.C.state.score.meta.title, '악보 X 편집');
  a.edit('A가 더 고친 제목'); await a.flush();                                  // B 화면은 이제 낡았다
  await a.replace(a.titled('악보 Y'), { origin: 'new' });
  await until(() => b.SF.session.lockState().available, 1500, '풀림 알림');
  assert.equal(b.C.state.score.meta.title, '악보 X 편집');                      // 아직 낡은 내용 그대로(저절로 바뀌지 않는다)
  assert.equal(await b.SF.session.resume(), 'resumed');
  assert.equal(b.C.state.score.meta.title, 'A가 더 고친 제목');                 // 최신 내용
  assert.equal(b.C.state.readOnly, false); assert.equal(b.SF.session.lockState().locked, false);
  same(b.held(), [id]); assert.equal(b.installs.at(-1).opts.toast, false);
  b.edit('B가 이어서 고침'); await b.flush();
  assert.equal((await b.load(id)).data.meta.title, 'B가 이어서 고침');
});

test('P2-D ⑫ [편집 시작] 사이에 다른 탭이 다시 잡았으면 최신 내용 그대로 읽기 전용에 머문다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world), c = openTab(world);
  const id = await a.make('악보 X');
  await b.SF.session.openDoc(id);
  a.edit('A의 마지막 제목'); await a.flush();
  await a.replace(a.titled('악보 Y'), { origin: 'new' });
  await until(() => b.SF.session.lockState().available, 1500, '풀림 알림');
  assert.equal(await c.SF.session.openDoc(id), 'opened'); assert.equal(c.SF.session.lockState().locked, false);   // 그새 C가 잡았다
  assert.equal(await b.SF.session.resume(), 'locked');
  assert.equal(b.SF.session.lockState().locked, true); assert.equal(b.SF.session.lockState().available, false);
  assert.equal(b.C.state.readOnly, true); assert.equal(b.C.state.score.meta.title, 'A의 마지막 제목');   // 화면은 최신으로
});

test('P2-D ⑬ [편집 시작] 때 기록이 지워졌으면 missing, 읽기 전용 상태는 그대로', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  await b.SF.session.openDoc(id);
  await a.replace(a.titled('악보 Y'), { origin: 'new' });
  await until(() => b.SF.session.lockState().available, 1500, '풀림 알림');
  await a.SF.store.deleteDoc(id);
  assert.equal(await b.SF.session.resume(), 'missing');
  assert.equal(b.SF.session.lockState().locked, true); assert.equal(b.C.state.readOnly, true);
  assert.equal(await a.SF.session.resume(), 'none');                            // 잠기지 않은 탭에는 할 일이 없다
});

test('P2-D ⑭ [사본으로 편집]은 보관된 최신 내용으로 새 문서를 만들고, 원본 기록과 잠금은 건드리지 않는다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  await b.SF.session.openDoc(id);
  a.edit('최신 제목'); await a.flush();                                         // B 화면은 낡았다
  assert.equal(await b.SF.session.copyForEditing(), true);
  assert.notEqual(b.docId(), id);
  assert.equal(b.C.state.score.meta.title, '최신 제목 사본');                   // 화면이 아니라 최신 기록에서 복사
  assert.equal(b.C.state.readOnly, false); assert.equal(b.SF.session.lockState().locked, false);
  same(b.held(), [b.docId()]);
  assert.equal(b.toasts.at(-1), '사본을 만들었어요. 이제 편집할 수 있어요.');
  await b.flush();                                                              // 사본도 곧 최근 작업에 올라간다
  assert.equal((await b.load(b.docId())).origin, 'copy'); assert.equal((await b.load(b.docId())).title, '최신 제목 사본');
  assert.equal((await a.load(id)).title, '최신 제목');                           // 원본 기록은 그대로
  same(a.held(), [id]); assert.equal(a.C.state.readOnly, false);   // A는 계속 편집 중
  const copy = b.C.state.score.meta;
  for (const key of ['cloudId', 'cloudUpdatedAt', 'cloudOwner', 'cloudProject']) assert.equal(copy[key], undefined, key);
});

test('P2-D ⑭′ 사본은 영어 화면에서 (copy)로 붙고, 기록을 못 읽으면 화면의 내용으로 복사', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('Score X');
  await b.SF.session.openDoc(id);
  b.SF.i18n = { lang: 'en' };
  await a.SF.store.deleteDoc(id);                                               // 기록이 사라졌다
  assert.equal(await b.SF.session.copyForEditing(), true);
  assert.equal(b.C.state.score.meta.title, 'Score X 편집 (copy)');
});

/* ===================== 부팅 복원 ===================== */

test('P2-D ⑮ 새로고침: 옛 페이지가 사라진 뒤라면 자기 문서를 편집 가능한 채로 되살린다', async () => {
  const world = makeWorld(), a = openTab(world);
  const id = await a.make('악보 X');
  a.close();
  const reloaded = openTab(world, { sessionStorage: a.tab });
  const score = await reloaded.SF.session.restoreOnBoot();
  assert.equal(score.meta.docId, id);
  assert.equal(reloaded.SF.session.lockState().locked, false); same(reloaded.held(), [id]);
});

test('P2-D ⑮′ 새로고침 직후 옛 페이지의 잠금이 조금 늦게 풀려도 재시도로 자기 문서를 되찾는다', async () => {
  const world = makeWorld(), a = openTab(world);
  const id = await a.make('악보 X');
  const reloaded = openTab(world, { sessionStorage: a.tab });
  setTimeout(() => a.close(), 250);                                             // 옛 페이지가 정리되는 데 걸리는 시간
  const score = await reloaded.SF.session.restoreOnBoot();
  assert.equal(score.meta.docId, id);
  assert.equal(reloaded.SF.session.lockState().locked, false);
});

test('P2-D ⑯ 새 탭은 다른 탭이 편집 중인 마지막 문서를 건너뛰고 잠기지 않은 최근 문서를 연다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const y = await a.make('악보 Y');
  await sleep(5);
  const x = await a.make('악보 X');                                             // A는 X를 열어 둔 채(마지막 편집 문서)
  assert.equal(await b.SF.store.kvGet('lastDocId'), x);
  const score = await b.SF.session.restoreOnBoot();
  assert.equal(score.meta.docId, y);
  assert.equal(b.SF.session.lockState().locked, false); same(b.held(), [y]);
});

test('P2-D ⑯′ 열 수 있는 문서가 모두 잠겨 있으면 null(데모는 호출한 쪽이 연다)', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  await a.make('악보 X');
  assert.equal(await b.SF.session.restoreOnBoot(), null);
  same(b.SF.session.lockState(), { docId: '', locked: false, available: false });
});

test('P2-D ⑰ 탭 복제처럼 이 탭의 문서가 다른 탭에서 편집 중이면 읽기 전용으로 되살린다', async () => {
  const world = makeWorld(), a = openTab(world);
  const id = await a.make('악보 X');
  const copy = webStorage(); copy.setItem(TAB_KEY, id);                         // 탭을 복제하면 sessionStorage도 복제된다
  const duplicated = openTab(world, { sessionStorage: copy });
  const score = await duplicated.SF.session.restoreOnBoot();
  assert.equal(score.meta.docId, id);
  same(duplicated.SF.session.lockState(), { docId: id, locked: true, available: false });
  same(duplicated.held(), []); assert.equal(duplicated.tab.getItem(TAB_KEY), id);
});

test('P2-D ⑱ adopt는 데모 같은 새 문서에도 잠금을 붙인다(첫 편집 뒤 다른 탭이 열어도 충돌하지 않도록)', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const demo = a.SF.io.DEMOS.butterfly();
  const got = await a.SF.session.adopt(demo, { origin: 'demo' });
  a.C.setScore(demo);
  assert.equal(got.locked, false); same(a.held(), [got.id]);
  a.edit('데모를 고쳤어요'); await a.flush();
  assert.equal(await b.SF.session.openDoc(got.id), 'opened');
  assert.equal(b.SF.session.lockState().locked, true);
});

/* ===================== 안전망 · 방송 · 목록 ===================== */

test('P2-D ⑲ 교체 통로를 거치지 않고 들어온 악보도, 다른 탭이 쥔 문서는 덮어쓰지 않는다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const id = await a.make('악보 X');
  const intruder = b.titled('몰래 들어온 악보'); intruder.meta.docId = id;
  b.C.setScore(intruder);                                                       // replaceScore·adopt를 거치지 않았다
  b.edit('덮어쓰려는 제목');
  assert.equal(await b.flush(), false);                                         // 저장 실패로 처리된다(→ "자동 저장에 실패했어요" 안내)
  assert.match(String(b.SF.io.getAutosaveStatus().error?.message), /다른 탭이 편집 중/);
  assert.equal((await a.load(id)).title, '악보 X 편집');                         // 기록은 그대로
  same(b.held(), []);
});

test('P2-D ⑲′ 교체 통로 밖에서 들어온 새 악보는 쓰기 전에 잠금을 잡아 이후 다른 탭을 막는다', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  a.C.setScore(a.titled('직접 설치'));
  a.edit('직접 설치 편집'); await a.flush();
  const id = a.docId();
  same(a.held(), [id]); assert.equal(a.SF.session.lockState().docId, id);
  assert.equal(await b.SF.session.openDoc(id), 'opened'); assert.equal(b.SF.session.lockState().locked, true);
});

test('P2-D ⑳ 저장하면 다른 탭에 docs-changed를 알리고, 연속 저장은 한꺼번에(1초에 한 번)', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const got = [];
  b.SF.lock.onMessage('docs-changed', message => got.push(message));
  await a.replace(a.titled('악보 X'), { origin: 'new' });
  for (let i = 0; i < 5; i++) { a.edit('편집 ' + i); await a.flush(); }
  await sleep(60);
  assert.equal(got.length, 1); assert.equal(got[0].docId, a.docId()); assert.equal(got[0].from, a.SF.lock.tabId);
});

test('P2-D ㉑ heldElsewhere: 다른 탭이 쥔 문서만 돌려준다(자기 것은 제외)', async () => {
  const world = makeWorld(), a = openTab(world), b = openTab(world);
  const x = await a.make('악보 X'), y = await b.make('악보 Y');
  same([...await a.SF.lock.heldElsewhere()], [y]);
  same([...await b.SF.lock.heldElsewhere()], [x]);
});

/* ===================== Web Locks가 없는 브라우저 ===================== */

test('P2-D ㉒ Web Locks가 없어도 BroadcastChannel로 같은 악보 동시 편집을 막고, 풀림도 알린다', async () => {
  const world = makeWorld(), a = openTab(world, { noLocks: true }), b = openTab(world, { noLocks: true });
  same(a.SF.lock.support(), { locks: false, channel: true });
  const id = await a.make('악보 X');
  same([...world.held.keys()], []);                                 // 진짜 잠금은 없다
  assert.equal(await b.SF.session.openDoc(id), 'opened');
  assert.equal(b.SF.session.lockState().locked, true); assert.equal(b.C.state.readOnly, true);
  same([...await b.SF.lock.heldElsewhere([id])], [id]);            // 문서를 지정해 물어본다
  await a.replace(a.titled('악보 Y'), { origin: 'new' });
  await until(() => b.SF.session.lockState().available, 1500, '풀림 알림(대체 경로)');
  assert.equal(await b.SF.session.resume(), 'resumed');
});

test('P2-D ㉒′ 대체 경로에서 동시에 같은 문서를 잡으려 해도 한쪽만 성공한다', async () => {
  const world = makeWorld(), a = openTab(world, { noLocks: true }), b = openTab(world, { noLocks: true });
  const [ha, hb] = await Promise.all([a.SF.lock.acquire('same-doc'), b.SF.lock.acquire('same-doc')]);
  assert.equal([ha, hb].filter(Boolean).length, 1);
});

test('P2-D ㉓ 잠금도 채널도 없는 옛 브라우저에서는 막지 않고 연다(보호만 없다)', async () => {
  const world = makeWorld(), a = openTab(world, { noLocks: true, noChannel: true }), b = openTab(world, { noLocks: true, noChannel: true });
  same(a.SF.lock.support(), { locks: false, channel: false });
  const id = await a.make('악보 X');
  assert.equal(await b.SF.session.openDoc(id), 'opened');
  assert.equal(b.SF.session.lockState().locked, false); assert.equal(b.C.state.readOnly, false);
});

test('P2-D ㉔ 잠금 모듈 자체가 없어도(session만 로드) 예전처럼 동작한다', async () => {
  const context = vm.createContext({ console, setTimeout, clearTimeout, structuredClone, TextEncoder, crypto: globalThis.crypto });
  context.window = context; context.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  context.localStorage = webStorage(); context.sessionStorage = webStorage();
  for (const name of ['safe-html', 'core', 'engrave', 'playback', 'io', 'store']) vm.runInContext(readFileSync(`js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
  const SF = context.SF, C = SF.core;
  SF.store = SF.storeTesting.createStore(SF.storeTesting.memoryBackend());
  SF.ui = { choiceDialog: async () => 'cancel' }; SF.io.saveJSON = () => {};
  SF.app = { installScore: (score, opts) => { C.state.readOnly = !!opts.readOnly; C.setScore(score); }, toast: () => {} };
  vm.runInContext(readFileSync('js/session.js', 'utf8'), context, { filename: 'session.js' });
  const score = C.createScore({ measureCount: 1 });
  assert.equal(await SF.session.replaceScore(score, { confirmed: true, origin: 'new' }), true);
  same(SF.session.lockState(), { docId: score.meta.docId, locked: false, available: false });
});

/* ===================== 구조 고정 ===================== */

const read = file => readFileSync(file, 'utf8');
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('구조 고정: lock.js는 화면·악보·세션을 모른다(core/app/session/ui 참조 금지)', () => {
  const code = stripComments(read('js/lock.js'));
  assert.doesNotMatch(code, /SF\.(core|app|session|ui|i18n|io|store|recent)\b/);
  assert.doesNotMatch(code, /\b(?:document|innerHTML)\b/);
  assert.match(code, /navigator|locksApi/); assert.match(code, /BroadcastChannel/);
});

test('구조 고정: 새 UI 코드(lock-ui·recent·session)에 HTML 문자열 삽입 방법이 없다', () => {
  for (const file of ['js/lock-ui.js', 'js/lock.js', 'js/session.js', 'js/recent.js']) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);   // 주석에도 쓰지 않는다
  }
  assert.match(read('js/lock-ui.js'), /textContent/);
});

test('구조 고정: index.html — 스크립트 순서(store → lock → session → lock-ui → recent)와 배너 마크업', () => {
  const html = read('index.html');
  const at = name => html.indexOf(`<script src="js/${name}.js"></script>`);
  for (const name of ['store', 'lock', 'session', 'lock-ui', 'recent']) assert.ok(at(name) > 0, name);
  assert.ok(at('store') < at('lock') && at('lock') < at('session') && at('session') < at('lock-ui') && at('lock-ui') < at('recent'));
  assert.ok(html.indexOf('id="lock-banner"') < html.indexOf('id="workspace"'));                  // 작업 영역 위의 띠
  assert.match(html, /id="lock-banner"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  for (const id of ['lock-text', 'lock-resume', 'lock-copy']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(read('css/style.css'), /body\.tab-locked #cloud-copy-banner\s*\{\s*display:\s*none/);
});

test('구조 고정: 교체·부팅 경로가 잠금을 거친다(replaceScore·restoreOnBoot·adopt), 부팅 데모는 adopt', () => {
  const session = stripComments(read('js/session.js')), app = stripComments(read('js/app.js'));
  assert.ok((session.match(/lockDoc\(/g) || []).length >= 4);                                   // 정의 1 + replaceScore + restoreOnBoot + persist 안전망 + adopt
  assert.match(session, /async function adopt\(/);
  assert.match(app, /await SF\.session\.adopt\(demo, \{ origin: "demo" \}\)/);
  assert.doesNotMatch(app, /SF\.session\.claim\(demo/);
  assert.match(app, /SF\.session\.lockState\(\)\.locked\) setReadOnly\(true\)/);
});

test('i18n: 잠금 안내 문구가 모두 영어로 번역되고 한글이 남지 않는다', () => {
  const context = vm.createContext({ console, navigator: { language: 'en-US' } });
  context.window = context;
  vm.runInContext(readFileSync('js/i18n.js', 'utf8'), context, { filename: 'i18n.js' });
  const t = text => context.SF.i18n.translate(text);
  const expected = {
    '다른 탭에서 편집 중인 악보예요': 'This score is being edited in another tab',
    '사본으로 편집': 'Edit a copy', '이제 편집할 수 있어요': 'You can edit this score now', '편집 시작': 'Start editing',
    '아직 다른 탭에서 편집 중이에요': 'It is still being edited in another tab', '사본을 만들지 못했어요': 'Could not make a copy',
    '이 탭에서 편집을 시작했어요': 'Editing started in this tab', '사본을 만들었어요. 이제 편집할 수 있어요.': 'Copy created. You can edit it now.',
    '최신 내용을 불러오지 못했어요. 사본으로 편집해 보세요': 'Could not load the latest version. Try editing a copy instead',
  };
  for (const [ko, en] of Object.entries(expected)) { assert.equal(t(ko), en, ko); assert.doesNotMatch(t(ko), /[가-힣]/, ko); }
  // 저장 확인 창의 이유 문구도 번역된다(읽기 전용에서는 뜨지 않지만 문구가 한글로 남지 않게)
  assert.equal(t('편집 시작 전에 현재 악보를 어떻게 할까요?'), 'What should happen to the current score before you continue? (Start editing)');
});
