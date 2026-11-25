// P9-6 ① 화면 문구는 토스트·대화상자부터 SF.t(key) 직접 호출로 쓴다(사후 번역은 남은 곳을 위해 유지).
//  - 소스 규칙: 토스트·대화상자 호출 인자에 한글 리터럴이 없다(허용 목록은 사유와 함께 아래에 둔다)
//  - 키 검증: 소스가 부르는 모든 키가 STRINGS에 있고(한·영 짝) 값 이름({title} 등)이 문구의 자리와 맞는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { calls, hangulLiterals, splitArgs, topLevelKeys } from './tools/scan-calls.mjs';

const root = new URL('../', import.meta.url);
const jsFiles = readdirSync(new URL('js/', root)).filter(name => name.endsWith('.js') && name !== 'i18n.js').sort();
const source = name => readFileSync(new URL('js/' + name, root), 'utf8');

const context = vm.createContext({ console, setTimeout, clearTimeout });
context.window = context;
context.document = { getElementById: () => null, querySelectorAll: () => [] };
vm.runInContext(readFileSync(new URL('js/i18n.js', root), 'utf8'), context, { filename: 'i18n.js' });
const { STRINGS } = context.SF.i18n;

/** 토스트·대화상자를 여는 호출 이름. confirm·prompt는 cloud.js 안의 대화상자 포장 함수만 센다. */
const MESSAGE_CALLS = String.raw`(?:[\w$.?]*\.)?(?:toast|longToast|flashHint)|(?:[\w$.]*\.)?(?:confirmDialog|promptDialog|choiceDialog)|confirm|prompt`;
const isMessageCall = (file, call) => !/^(confirm|prompt)$/.test(call.name) || file === 'cloud.js';

/**
 * 한글이 그대로 남아도 되는 곳. { file, call(호출 이름 정규식), has(리터럴에 들어 있어야 할 글자), reason }
 * 새 항목을 더할 때는 사유를 꼭 적는다. 쓰이지 않는 항목은 아래 시험이 잡는다.
 */
const ALLOWED = [
  { file: 'cloud.js', call: /^prompt$/, has: ' 사본', reason: '사용자가 고칠 사본 이름의 기본값(저장되는 데이터이지 화면 문구가 아니다)' },
  { file: 'pwa.js', call: /confirmDialog/, has: '', reason: 'message(key, 대체 문구) 도우미가 SF.t를 먼저 쓰고 i18n 없이 불릴 때만 대체 문구를 쓴다' },
];

function findHangul() {
  const hits = [], used = new Set();
  for (const file of jsFiles) {
    for (const call of calls(source(file), MESSAGE_CALLS)) {
      if (!isMessageCall(file, call)) continue;
      for (const literal of hangulLiterals(call.args)) {
        const allowed = ALLOWED.findIndex(rule => rule.file === file && rule.call.test(call.name) && literal.body.includes(rule.has));
        if (allowed >= 0) { used.add(allowed); continue; }
        hits.push(`${file}:${call.line} ${call.name}(${literal.quote}${literal.body.slice(0, 50)}${literal.quote})`);
      }
    }
  }
  return { hits, used };
}

test('P9-6 소스 규칙: 토스트·대화상자 호출 인자에 한글 리터럴이 없다(문구는 SF.t 키로)', () => {
  const { hits } = findHangul();
  assert.deepEqual(hits, [], `SF.t(키)로 바꿔야 하는 곳 ${hits.length}곳:\n${hits.join('\n')}`);
});
test('P9-6 소스 규칙: 허용 목록의 모든 항목이 실제로 쓰인다(낡은 예외를 남기지 않는다)', () => {
  const { used } = findHangul();
  ALLOWED.forEach((rule, index) => assert.ok(used.has(index), `쓰이지 않는 허용 항목: ${rule.file} ${rule.call} — ${rule.reason}`));
});
test('P9-6 검사 도구 자체: 주석·문자열 속 호출은 건너뛰고 인자 속 한글은 찾는다', () => {
  const sample = [
    '// toast("주석 속 한글")',
    '/* A.toast("블록 주석") */',
    'const s = "toast(\'문자열 속\')";',
    'function toast(msg, options) { return msg; }',
    'A.toast("찾아야 하는 문구");',
    'SF.app?.toast(`템플릿 ${x} 문구`);',
    'toast(SF.t("toast.saved"));',
    'SF.ui.confirmDialog({ title: "제목", message: SF.t("a.b") });',
  ].join('\n');
  const found = calls(sample, MESSAGE_CALLS).flatMap(call => hangulLiterals(call.args).map(l => `${call.line}:${call.name}:${l.body}`));
  assert.deepEqual(found, ['5:A.toast:찾아야 하는 문구', '6:SF.app?.toast:템플릿 ${x} 문구', '8:SF.ui.confirmDialog:제목']);
  assert.deepEqual(splitArgs('"k", { a, b: f(1, 2) }, 3').map(s => s.trim()), ['"k"', '{ a, b: f(1, 2) }', '3']);
  assert.deepEqual(topLevelKeys('{ a, b: { x: 1 }, "c": 2, ...d, e }'), ['a', 'b', 'c', 'd', 'e']);
});

/** 소스의 모든 SF.t(…) 호출: { file, line, key, varsText, dynamic } */
function tCalls() {
  const rows = [];
  for (const file of jsFiles) {
    for (const call of calls(source(file), String.raw`SF\.t`)) {
      const [first, second] = splitArgs(call.args).map(part => part.trim());
      const keys = [...(first || '').matchAll(/(["'])([A-Za-z][\w]*(?:\.[\w]+)+)\1/g)].map(m => m[2]);
      rows.push({ file, line: call.line, keys, first, second });
    }
  }
  return rows;
}
const placeholdersOf = key => [...String(STRINGS.ko[key]).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('P9-6 키 검증: 소스가 부르는 모든 키가 한국어·영어 문구를 갖고 있다', () => {
  const rows = tCalls();
  const keys = new Set(rows.flatMap(row => row.keys));
  assert.ok(keys.size >= 150, `직접 호출하는 키가 충분해야 한다(${keys.size})`);
  for (const key of keys) {
    assert.equal(typeof STRINGS.ko[key], 'string', `ko 문구 없음: ${key}`);
    assert.equal(typeof STRINGS.en[key], 'string', `en 문구 없음: ${key}`);
  }
  for (const row of rows) assert.ok(row.keys.length > 0 || !/["'`]/.test(row.first || ''), `${row.file}:${row.line} SF.t 첫 인자가 키 모양이 아니다: ${row.first}`);
});
test('P9-6 키 검증: 값 이름이 문구의 {자리}와 정확히 맞는다(빠지거나 남는 이름 없음)', () => {
  let checked = 0;
  for (const row of tCalls()) {
    if (row.keys.length !== 1) continue;                         // 조건식으로 키를 고르는 호출은 아래 별도 시험
    const key = row.keys[0], need = placeholdersOf(key);
    if (!row.second) { assert.deepEqual(need, [], `${row.file}:${row.line} ${key} 에 값이 필요한데 넘기지 않았다`); continue; }
    if (!row.second.startsWith('{')) continue;                   // 값 묶음을 변수로 넘기는 경우
    assert.deepEqual([...new Set(topLevelKeys(row.second))].sort(), need, `${row.file}:${row.line} ${key} 의 값 이름이 문구 자리 ${JSON.stringify(need)} 와 다르다`);
    checked++;
  }
  assert.ok(checked >= 20, `값이 있는 호출을 충분히 확인해야 한다(${checked})`);
});
test('P9-6 키 검증: 조건식으로 키를 고르는 호출은 후보 키 모두가 같은 자리를 쓴다', () => {
  for (const row of tCalls().filter(r => r.keys.length > 1)) {
    const sets = new Set(row.keys.map(key => JSON.stringify(placeholdersOf(key))));
    assert.equal(sets.size, 1, `${row.file}:${row.line} 후보 키들의 {자리}가 서로 다르다: ${row.keys}`);
  }
});
