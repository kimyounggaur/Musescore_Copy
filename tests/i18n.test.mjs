import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
function setup(options = {}) {
  const warnings = [];
  const saved = new Map(Object.entries(options.saved || {}));
  const context = vm.createContext({
    console: { warn: message => warnings.push(message) },
    navigator: options.navigator || { language: 'ko-KR' },
    localStorage: options.storage || {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  });
  if (options.domTrap) Object.defineProperty(context, 'document', { get() { throw new Error('Unexpected DOM access'); } });
  vm.runInContext(source, context, { filename: 'i18n.js' });
  return { SF: context.SF, context, warnings, saved };
}

test('loads and translates semantic keys without window or document', () => {
  const { SF, warnings } = setup({ domTrap: true });
  assert.equal(SF.t('menu.file.label'), '파일');
  SF.i18n.setLanguage('en');
  assert.equal(SF.t('menu.file.label'), 'File');
  assert.equal(SF.t('dialog.new'), 'New score');
  assert.equal(warnings.length, 0);
});

test('every semantic key has real Korean/English strings and matching placeholders', () => {
  const { SF, warnings } = setup();
  const { ko, en } = SF.i18n.STRINGS;
  assert.ok(Object.keys(ko).length > 500);
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(ko)) {
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/);
    assert.ok(ko[key].trim(), key);
    assert.ok(en[key].trim(), key);
    assert.equal(/[가-힣]/.test(en[key]), false, `${key}: ${en[key]}`);
    assert.deepEqual(placeholders(ko[key]), placeholders(en[key]), key);
    SF.i18n.setLanguage('en', { persist: false });
    assert.equal(SF.t(key), en[key]);
  }
  assert.equal(warnings.length, 0);
});

test('language preference persists, recognizes locales, and tolerates blocked storage', () => {
  const first = setup({ navigator: { language: 'en-US' } });
  assert.equal(first.SF.i18n.language, 'en');
  first.SF.i18n.setLanguage('ko-KR');
  assert.equal(first.saved.get(first.SF.i18n.STORAGE_KEY), 'ko');
  const second = setup({ navigator: { language: 'en-GB' }, saved: Object.fromEntries(first.saved) });
  assert.equal(second.SF.i18n.language, 'ko');
  const blocked = setup({ navigator: { language: 'en-US' }, storage: {
    getItem() { throw new Error('storage denied'); }, setItem() { throw new Error('storage denied'); },
  } });
  assert.equal(blocked.SF.i18n.language, 'en');
  assert.equal(blocked.SF.i18n.setLanguage('ko'), 'ko');
  assert.equal(setup({ navigator: { language: 'fr-FR' } }).SF.i18n.language, 'ko');
  assert.equal(setup({ saved: { 'scoreforge-language': 'invalid' }, navigator: { language: 'en' } }).SF.i18n.language, 'en');
});

test('Korean fallback is silent; only truly unknown semantic keys warn once', () => {
  const { SF, warnings } = setup();
  SF.i18n.setLanguage('en');
  delete SF.i18n.STRINGS.en['toast.saved'];
  assert.equal(SF.t('toast.saved'), '악보 파일을 내려받았어요');
  assert.equal(warnings.length, 0);
  assert.equal(SF.t('not.a.real.key'), 'not.a.real.key');
  assert.equal(SF.t('not.a.real.key'), 'not.a.real.key');
  assert.equal(warnings.length, 1);
  assert.deepEqual([...SF.i18n.pendingKeys], ['not.a.real.key']);
  assert.deepEqual([...SF.i18n.audit().missingEnglish], ['toast.saved']);
});

test('interpolation preserves user text, replacement tokens, markup, whitespace and zero', () => {
  const { SF } = setup();
  SF.i18n.setLanguage('en');
  const title = '  파일 <img src=x> $& ${name} {count} "악보"\n한글  ';
  const vars = Object.freeze({ title, measures: 0 });
  assert.equal(SF.t('toast.loaded', vars), `Loaded "${title}"`);
  assert.ok(SF.t('import.summary', vars).includes(`"${title}"`));
  assert.ok(SF.t('import.summary', vars).includes('0 measures'));
  assert.equal(SF.t('toast.loaded'), 'Loaded "{title}"');
  assert.equal(SF.t('toast.loaded', Object.create({ title: 'inherited' })), 'Loaded "{title}"');
});

test('literal translation uses only complete known messages; arbitrary prose is untouched', () => {
  const { SF, warnings } = setup();
  SF.i18n.setLanguage('en');
  assert.equal(SF.i18n.translate('  악보 설정  '), '  Score settings  ');
  assert.equal(SF.i18n.translate('임의 사용자 문장: 파일과 피아노'), '임의 사용자 문장: 파일과 피아노');
  assert.equal(SF.i18n.translate('An arbitrary English message'), 'An arbitrary English message');
  assert.equal(SF.i18n.translate(null), null);
  assert.equal(SF.i18n.translate(undefined), undefined);
  assert.equal(SF.i18n.translate(0), 0);
  assert.equal(SF.i18n.lookup('missing semantic.key'), null);
  assert.equal(warnings.length, 0);
  assert.ok(SF.i18n.pendingMessages.includes('임의 사용자 문장: 파일과 피아노'));
  assert.equal(SF.i18n.pendingKeys.length, 0);
});

test('exact toast/hint/import mappings and variables use proper English', () => {
  const { SF, warnings } = setup();
  SF.i18n.setLanguage('en');
  const cases = [
    ['악보 파일을 내려받았어요', 'Score file downloaded'],
    ['마디 4개를 추가했어요', 'Added four measures'],
    ['7개를 복사했어요', 'Copied 7 items'],
    ['2반음 내렸어요', 'Transposed down 2 semitones'],
    ['3잇단음표로 나눴어요', 'Split into a 3-tuplet'],
    ['3번 반복으로 설정했어요', 'Set to repeat 3 times'],
    ['2번 엔딩을 표시했어요', 'Added ending 2'],
    ['템포 ♩=120', 'Tempo ♩=120'],
    ['4절 가사', 'Verse 4 lyrics'],
    ['실행 취소: 마디 추가', 'Undo: Add measures'],
    ['실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)'],
    ['내비게이터 (F12)', 'Navigator (F12)'],
    ['코드 기호 입력 (Ctrl+K)', 'Enter chord symbol (Ctrl+K)'],
    ['리허설 마크 (R)', 'Rehearsal mark (R)'],
    ['파트 4개 중 첫 번째만 가져왔어요', 'Imported only the first of 4 parts'],
    ['지원하지 않는 셈여림은 무시 (3건)', 'Omitted unsupported dynamics (3 occurrences)'],
    ['피아노 샘플 음원 준비 완료', 'Piano samples ready'],
    ['스피디 64분음표 쉼표', 'Speedy: Sixty-fourth note rest'],
    ['성부 4', 'Voice 4'],
    ['A 화음 쌓기', 'Add A to chord'],
    ['범위 다음', 'Extend selection Next'],
  ];
  for (const [ko, en] of cases) {
    assert.equal(SF.i18n.translate(ko), en, ko);
    assert.ok(SF.i18n.lookup(en), `pretranslated label can be decorated: ${en}`);
  }
  assert.equal(warnings.length, 0);
});

test('current multi-part MusicXML and MIDI reports preserve user-supplied part names', () => {
  const { SF, warnings } = setup();
  SF.i18n.setLanguage('en');
  const part = '파일: 피아노; 원곡 $&';
  assert.equal(SF.i18n.translate(`${part}: 읽을 수 없는 음높이를 생략했어요 (2건); 짝이 없는 이음줄을 생략했어요 (1건)`), `${part}: Omitted unreadable pitches (2 occurrences); Omitted unmatched slurs (1 occurrences)`);
  assert.equal(SF.i18n.translate(`${part}: 드럼 40의 표기는 스네어로 대체했어요 (원래 소리 유지)`), `${part}: used snare notation for drum 40 (original sound kept)`);
  assert.equal(SF.i18n.translate('2개 파트 · 3개 보표 · 16마디를 가져왔어요'), 'Imported 2 parts · 3 staves · 16 measures');
  assert.equal(SF.i18n.translate('3개 파트 · 82개 음표/화음을 가져왔어요 (1/16 양자화)'), 'Imported 3 parts · 82 notes/chords (1/16 quantization)');
  assert.equal(SF.i18n.translate('열 수 없어요: 파일 — 피아노.mid — MIDI 파일이 아니에요'), 'Cannot open: 파일 — 피아노.mid — Not a MIDI file');
  assert.equal(SF.i18n.lookup('Loaded "피아노"').locale, 'en');
  assert.equal(SF.i18n.lookup('"피아노" 불러왔어요').locale, 'ko');
  assert.equal(warnings.length, 0);
});

test('template captures never translate names, titles, rehearsal text or unknown errors', () => {
  const { SF } = setup();
  SF.i18n.setLanguage('en');
  const title = '저장 "새 악보" <b>피아노</b> $&\n가사';
  assert.equal(SF.i18n.translate(`"${title}" 불러왔어요`), `Loaded "${title}"`);
  assert.equal(SF.i18n.translate(`리허설 ${title}`), `Rehearsal ${title}`);
  assert.equal(SF.i18n.translate(`“${title}” 악보를 클라우드에서 삭제할까요?`), `Delete “${title}” from cloud storage?`);
  assert.equal(SF.i18n.translate('열 수 없어요: 피아노.json — 사용자 오류'), 'Cannot open: 피아노.json — 사용자 오류');
  const summary = `"${title}" — 12마디를 가져왔어요. 아래 항목은 이 앱이 지원하는 범위로 줄이면서 바뀌거나 무시됐어요.`;
  assert.equal(SF.i18n.translate(summary), `Imported 12 measures from "${title}". The items below were changed or omitted to fit the features supported by this app.`);
});

test('status grammar translates UI tokens but preserves mixed score content', () => {
  const { SF } = setup();
  SF.i18n.setLanguage('en');
  const name = '저장 피아노';
  const details = '도4(C4) · 코드 C7 · 리허설 파일 · 가사와 작곡가';
  assert.equal(SF.i18n.translate(`${name} · V2 · 마디 3 · 점4분음표 · ${details}`), `${name} · V2 · Measure 3 · Dotted Quarter note · ${details}`);
  assert.equal(SF.i18n.translate(`${name} · V2 · 마디 3 · 온마디 쉼표`), `${name} · V2 · Measure 3 · Whole-measure rest`);
  assert.equal(SF.i18n.translate(`입력 위치: ${name} · V1 · 마디 2 · 3잇단 8분음표로 입력`), `Input: ${name} · V1 · Measure 2 · Enter 3-tuplet Eighth note`);
  assert.equal(SF.i18n.translate('4마디 · 2보표 · 다장조 (C) · 4/4'), '4 measures · 2 staves · C major (C) · 4/4');
  assert.equal(SF.i18n.translate(`${name} · V2 · 마디 3 · 온마디 쉼표 · 화음 2번째 음`), `${name} · V2 · Measure 3 · Whole-measure rest · Chord note 2`);
});

test('Korean bridge is lossless and language callbacks are idempotent', () => {
  const { SF } = setup();
  const original = '  "피아노 \n 저장" 불러왔어요  ';
  assert.equal(SF.i18n.translate(original), original);
  const events = [];
  const off = SF.i18n.onChange((next, previous) => events.push([next, previous]));
  SF.i18n.setLanguage('en'); SF.i18n.setLanguage('en');
  off(); SF.i18n.setLanguage('ko');
  assert.deepEqual(events, [['en', 'ko']]);
  SF.i18n.clearAudit();
  assert.equal(SF.i18n.pendingKeys.length, 0);
  assert.equal(SF.i18n.pendingMessages.length, 0);
  assert.equal(SF.i18n.init(), SF.i18n);
});

test('all current generated keymap and palette labels have an approved mapping', () => {
  const { SF, context } = setup();
  context.window = context;
  SF.i18n.setLanguage('en');
  for (const name of ['keymap', 'palette']) {
    const file = new URL(`../js/${name}.js`, import.meta.url);
    if (!existsSync(file)) continue;
    vm.runInContext(readFileSync(file, 'utf8'), context, { filename: `${name}.js` });
  }
  const labels = [
    ...(SF.keymap?.KEYMAP || []).map(item => item.label),
    ...(SF.palette?.PALETTE || []).flatMap(group => [group.label, ...group.items.map(item => item.label).filter(Boolean)]),
  ];
  assert.ok(labels.length > 50);
  for (const label of labels) assert.ok(SF.i18n.lookup(label), `Unmapped UI label: ${label}`);
});
