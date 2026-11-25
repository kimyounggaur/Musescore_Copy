// P8-3 한글 입력 상태(IME)에서도 단축키가 동작해야 한다 — 글자(e.key) 대신 자판 위치(e.code)로도 판정한다.
// keymap.js만 vm으로 올려 combo·baseKey를 시험한다(ui-v3.test.mjs와 같은 방식). 브라우저에서 실제 키 이벤트로 확인하는 시험은 ime-keys-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const keymapSource = readFileSync(new URL('../js/keymap.js', import.meta.url), 'utf8');
const context = { window: { SF: {} } };
vm.runInNewContext(keymapSource, context, { filename: 'keymap.js' });
const { KEYMAP, combo, baseKey } = context.window.SF.keymap;

test('P8-3 SF.keymap이 combo·baseKey를 공개한다', () => {
  assert.equal(typeof combo, 'function'); assert.equal(typeof baseKey, 'function');
  assert.ok(Array.isArray(KEYMAP) && KEYMAP.length > 90);
});

test('P8-3 설계서 표 8건 — 한글·AZERTY·macOS Option·기호·숫자 이벤트가 같은 단축키 문자열이 된다', () => {
  const table = [
    [{ key: 'ㅁ', code: 'KeyA' }, 'A'],
    [{ key: 'Process', code: 'KeyC', shiftKey: true }, 'Shift+C'],
    [{ key: 'q', code: 'KeyA' }, 'Q'],                                               // AZERTY: 글자 기준
    [{ key: '<', code: 'Comma', shiftKey: true }, '<'],
    [{ key: 'Process', code: 'Comma', shiftKey: true }, '<'],
    [{ key: 'å', code: 'KeyA', altKey: true }, 'Alt+A'],                              // macOS Option+A
    [{ key: 'ㄴ', code: 'KeyS', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+S'],
    [{ key: '1', code: 'Digit1' }, '1'],
  ];
  for (const [event, expected] of table) assert.equal(combo(event), expected, JSON.stringify(event));
});

test('P8-3 기호·공백·이름 있는 키: 한글 입력 상태에서도 같은 문자열이고, 이름 있는 키(Enter·방향키·F11)는 그대로다', () => {
  const table = [
    [{ key: 'Process', code: 'Period' }, '.'], [{ key: 'Process', code: 'Period', shiftKey: true }, '>'],
    [{ key: 'Process', code: 'Comma' }, ','], [{ key: 'Process', code: 'Slash' }, '/'], [{ key: 'Process', code: 'Slash', shiftKey: true }, '?'],
    [{ key: 'Process', code: 'Minus' }, '-'], [{ key: 'Process', code: 'Minus', shiftKey: true }, '_'],
    [{ key: 'Process', code: 'Equal' }, '='], [{ key: 'Process', code: 'Equal', shiftKey: true }, '+'],
    [{ key: 'Process', code: 'Semicolon' }, ';'], [{ key: 'Process', code: 'Quote' }, "'"], [{ key: 'Process', code: 'BracketLeft' }, '['],
    [{ key: 'Process', code: 'BracketRight' }, ']'], [{ key: 'Process', code: 'Backslash' }, '\\'], [{ key: 'Process', code: 'Backquote' }, '`'],
    [{ key: ' ', code: 'Space' }, 'Space'], [{ key: 'Process', code: 'Space' }, 'Space'],
    [{ key: '+', code: 'NumpadAdd' }, '+'], [{ key: '3', code: 'Numpad3' }, '3'], [{ key: '!', code: 'Digit1', shiftKey: true }, 'Shift+1'],
    [{ key: 'Process', code: 'NumpadAdd' }, '+'], [{ key: 'Process', code: 'NumpadSubtract' }, '-'], [{ key: 'Process', code: 'NumpadDecimal' }, '.'],
    [{ key: 'Process', code: 'Digit4', shiftKey: true }, 'Shift+4'], [{ key: 'Process', code: 'Numpad7' }, '7'],
    [{ key: 'Enter', code: 'Enter' }, 'Enter'], [{ key: 'Escape', code: 'Escape' }, 'Escape'], [{ key: 'F11', code: 'F11' }, 'F11'],
    [{ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true }, 'Ctrl+ArrowUp'], [{ key: 'Delete', code: 'Delete' }, 'Delete'],
    [{ key: 'Delete', code: 'NumpadDecimal' }, 'Delete'],                              // 숫자 잠금이 꺼진 숫자패드의 Del은 점(.)이 아니라 Delete
    [{ key: 'Enter', code: 'NumpadEnter' }, 'Enter'], [{ key: 'Backspace', code: 'Backspace' }, 'Backspace'],
    [{ key: 'z', code: 'KeyZ', metaKey: true }, 'Ctrl+Z'],                             // Mac의 Cmd는 Ctrl로 센다
    [{ key: 'ㅋ', code: 'KeyZ', metaKey: true, shiftKey: true }, 'Ctrl+Shift+Z'],
  ];
  for (const [event, expected] of table) assert.equal(combo(event), expected, JSON.stringify(event));
});

test('P8-3 글자가 라틴이면 글자를, 아니면 자판 위치를 따른다 — Dvorak처럼 글자와 위치가 다른 자판을 해치지 않는다', () => {
  assert.equal(baseKey({ key: 'o', code: 'KeyS' }), 'O');                           // Dvorak에서 S 위치의 키는 O
  assert.equal(baseKey({ key: 'S', code: 'KeyS', shiftKey: true }), 'S');
  assert.equal(baseKey({ key: 'ф', code: 'KeyA' }), 'A');                           // 러시아어 자판도 위치 기준
  assert.equal(baseKey({ key: 'Dead', code: 'KeyE', altKey: true }), 'E');
  assert.equal(baseKey({ key: 'Unidentified', code: 'KeyQ' }), 'Q');               // 가상 키보드·일부 입력기
  assert.equal(baseKey({ key: '$', code: 'Digit4', shiftKey: true }), '4');         // 숫자는 자판 위치(Digit)가 바탕 글자
  assert.equal(baseKey({ key: 'Process', code: 'Numpad9' }), '9');
});

test('P8-3 e.key가 ASCII 한 글자면 자판 위치를 보지 않는다 — AZERTY의 M 위치 쉼표가 M 단축키로 오인되지 않는다', () => {
  assert.equal(combo({ key: ',', code: 'KeyM' }), ',');
  assert.equal(combo({ key: ';', code: 'KeyM' }), ';');
  assert.equal(combo({ key: '=', code: 'KeyW' }), '=');
  assert.equal(baseKey({ key: '.', code: 'KeyV' }), '.');
  assert.equal(combo({ key: '&', code: 'Digit1' }), '1', '숫자는 예전부터 자판 위치(Digit)를 따른다');
});

test('P8-3 자판 고유 글자(ö·ß·≤…)는 위치로 바꾸지 않는다 — 독일어 ß 키가 "-" 단축키로 오인되지 않는다', () => {
  const cases = [[{ key: 'ß', code: 'Minus' }, 'ß'], [{ key: 'ö', code: 'Semicolon' }, 'ö'], [{ key: 'ü', code: 'BracketLeft' }, 'ü'],
    [{ key: '≤', code: 'Comma', altKey: true }, 'Alt+≤'],                       // macOS Option+쉼표
    [{ key: 'é', code: 'Slash' }, 'é'], [{ key: '\u3000', code: 'Space' }, 'Space']];   // 전각 공백도 Space 키
  for (const [event, expected] of cases) assert.equal(combo(event), expected, JSON.stringify(event));
  for (const [event] of cases.slice(0, 5)) assert.ok(KEYMAP.every(item => !item.keys.includes(combo(event))), JSON.stringify(event));
});

test('P8-3 Shift 표시는 최종 바탕 글자로 정한다 — 숫자 자리에 기호가 나오는 자판(스위스 독일어 Shift+1 = "+")도 Shift+1', () => {
  assert.equal(combo({ key: '+', code: 'Digit1', shiftKey: true }), 'Shift+1');
  assert.equal(combo({ key: '"', code: 'Digit2', shiftKey: true }), 'Shift+2');
  assert.equal(combo({ key: '+', code: 'Equal', shiftKey: true }), '+', '기호 키 자체는 Shift를 붙이지 않는다');
});

test('P8-3 이상한 이벤트(key·code가 없음)에도 던지지 않고, 어떤 단축키와도 맞지 않는다', () => {
  for (const event of [{}, { key: undefined, code: undefined }, { key: null, code: null, ctrlKey: true }, { key: 'Unidentified', code: '' }, { key: '', code: '' }]) {
    let result;
    assert.doesNotThrow(() => { result = combo(event); }, JSON.stringify(event));
    assert.equal(typeof result, 'string');
    assert.ok(KEYMAP.every(item => !item.keys.includes(result)), `${JSON.stringify(event)} → ${result}`);
  }
});

/* ----- 회귀: 기존 KEYMAP의 모든 키 문자열을 라틴 자판 이벤트로 만들어 combo가 원래 문자열을 돌려주는지 ----- */
const HANGUL = { Q: 'ㅂ', W: 'ㅈ', E: 'ㄷ', R: 'ㄱ', T: 'ㅅ', Y: 'ㅛ', U: 'ㅕ', I: 'ㅑ', O: 'ㅐ', P: 'ㅔ', A: 'ㅁ', S: 'ㄴ', D: 'ㅇ', F: 'ㄹ', G: 'ㅎ', H: 'ㅗ', J: 'ㅓ', K: 'ㅏ', L: 'ㅣ', Z: 'ㅋ', X: 'ㅌ', C: 'ㅊ', V: 'ㅍ', B: 'ㅠ', N: 'ㅜ', M: 'ㅡ' };
const HANGUL_SHIFT = { ...HANGUL, Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ' };
const PUNCT = { '.': ['Period', false], '/': ['Slash', false], '=': ['Equal', false], '-': ['Minus', false], '+': ['Equal', true], '<': ['Comma', true], '>': ['Period', true] };
const SHIFTED_DIGIT = ')!@#$%^&*(';
/** 단축키 문자열("Ctrl+Shift+Z")을 { latin: 라틴 자판 이벤트, others: [한글·macOS Option 등 다른 입력 상태의 이벤트] }로 만든다. */
function eventsFor(spec) {
  const parts = spec === '+' ? ['+'] : spec.split('+');
  const name = parts.pop(), mods = new Set(parts);
  const flags = { ctrlKey: mods.has('Ctrl'), altKey: mods.has('Alt'), shiftKey: mods.has('Shift') };
  const withMeta = event => (flags.ctrlKey ? [{ ...event, ctrlKey: false, metaKey: true }] : []);   // Mac: Ctrl 대신 Cmd
  let latin; const others = [];
  if (/^[A-Z]$/.test(name)) {
    latin = { ...flags, key: flags.shiftKey ? name : name.toLowerCase(), code: `Key${name}` };
    others.push({ ...flags, key: 'Process', code: `Key${name}` });                                  // Chrome(Windows·Mac) 한글 입력 상태
    others.push({ ...flags, key: (flags.shiftKey ? HANGUL_SHIFT : HANGUL)[name], code: `Key${name}` }); // Firefox·Safari: 한글 자모가 그대로
    if (flags.altKey) others.push({ ...flags, key: 'å', code: `Key${name}` });                     // macOS Option+글자
  } else if (/^[0-9]$/.test(name)) {
    latin = { ...flags, key: flags.shiftKey ? SHIFTED_DIGIT[+name] : name, code: `Digit${name}` };
    others.push({ ...flags, key: 'Process', code: `Digit${name}` });
    if (flags.altKey) others.push({ ...flags, key: '¡', code: `Digit${name}` });                    // macOS Option+숫자
    others.push({ ...flags, key: name, code: `Numpad${name}` });                                    // 숫자패드
  } else if (PUNCT[name]) {
    const [code, shift] = PUNCT[name];
    latin = { ...flags, shiftKey: shift || flags.shiftKey, key: name, code };
    others.push({ ...flags, shiftKey: shift || flags.shiftKey, key: 'Process', code });
  } else if (name === 'Space') {
    latin = { ...flags, key: ' ', code: 'Space' }; others.push({ ...flags, key: 'Process', code: 'Space' });
  } else {
    latin = { ...flags, key: name, code: name };                                                   // Escape·Enter·Delete·Backspace·F11·방향키
  }
  for (const event of [latin, ...others]) others.push(...withMeta(event));
  return { latin, others };
}

test('P8-3 회귀: KEYMAP의 모든 키 문자열(99개)이 라틴 자판 이벤트에서 원래 문자열 그대로 나온다', () => {
  const specs = [...new Set(KEYMAP.flatMap(item => item.keys))];
  assert.ok(specs.length >= 95, `키 문자열 ${specs.length}개`);
  for (const spec of specs) {
    const { latin } = eventsFor(spec);
    assert.equal(combo(latin), spec, `${spec} ← ${JSON.stringify(latin)}`);
  }
});

test('P8-3 한글 입력·macOS Option·Cmd 이벤트도 모든 키 문자열이 같은 단축키로 나온다 — 고치기 전에는 글자·일부 기호가 안 먹었다', () => {
  const specs = [...new Set(KEYMAP.flatMap(item => item.keys))];
  let checked = 0, letters = 0;
  for (const spec of specs) {
    const { others } = eventsFor(spec);
    for (const event of others) { assert.equal(combo(event), spec, `${spec} ← ${JSON.stringify(event)}`); checked++; }
    if (/(^|\+)[A-Z]$/.test(spec)) letters++;
  }
  assert.ok(checked >= 200 && letters >= 40, `${checked}개 이벤트 · 글자 단축키 ${letters}개`);   // 시험 생성기가 조용히 비어 버리지 않았는지 확인(실제 228개·41개)
});

test('P8-3 같은 이벤트가 두 단축키로 풀리지 않는다 — 서로 다른 키 문자열은 서로 다른 이벤트 결과다(중복 없음)', () => {
  const seen = new Map();
  for (const spec of new Set(KEYMAP.flatMap(item => item.keys))) {
    const result = combo(eventsFor(spec).latin);
    assert.equal(seen.has(result), false, `${spec}와 ${seen.get(result)}가 같은 결과 ${result}`);
    seen.set(result, spec);
  }
});

/* ----- 쓰는 곳 고정: 드럼 입력과 클라우드 저장 단축키가 baseKey/combo를 쓴다 ----- */
test('P8-3 구조 고정: 드럼 입력은 baseKey, 클라우드 저장은 SF.keymap.combo를 쓰고, 조합 중(isComposing) 무시는 그대로다', () => {
  assert.match(keymapSource, /DRUM_KEYS\.get\(baseKey\(e\)\)/, '드럼 입력은 baseKey로 판정한다');
  assert.doesNotMatch(keymapSource, /e\.key\.toUpperCase\(\)/, '글자를 e.key로 바로 판정하지 않는다');
  assert.match(keymapSource, /if\(e\.isComposing \|\| e\.defaultPrevented\) return;/, '조합 중(입력칸 안) 무시는 유지');
  assert.match(keymapSource, /SF\.keymap = \{[^}]*\bbaseKey\b[^}]*\bcombo\b|SF\.keymap = \{[^}]*\bcombo\b[^}]*\bbaseKey\b/);
  const cloudSource = readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
  assert.match(cloudSource, /SF\.keymap\?\.combo/, '클라우드 저장 단축키는 keymap의 combo로 판정한다');
  assert.match(cloudSource, /"Ctrl\+Shift\+S"/);
  assert.doesNotMatch(cloudSource, /event\.key\.toLowerCase\(\) === "s"/, 'e.key만 보던 예전 판정이 남아 있지 않다(대체 경로는 String(event.key)로 안전하게)');
});
