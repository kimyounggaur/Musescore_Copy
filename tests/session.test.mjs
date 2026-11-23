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
