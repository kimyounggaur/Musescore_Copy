// 소스 검사용 작은 도구(앱에는 들어가지 않는다): 호출 인자 속 한글 리터럴 찾기.
// 주석을 건너뛰고 문자열·템플릿 안의 괄호는 세지 않으며 괄호를 맞춰 인자 전체를 잘라 낸다.
export const HANGUL = /[가-힣]/;
/** 소스에서 주석을 같은 길이의 공백으로 바꾼다(줄 번호 유지). 문자열·템플릿 안의 // 는 건드리지 않는다. */
export function blankComments(src) {
  let out = '', i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } if (q === '`' && src[i] === '$' && src[i + 1] === '{') { /* 템플릿 식: 중괄호 맞추기 */ let depth = 0; do { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; out += src[i]; i++; } while (i < n && depth > 0); continue; } out += src[i]; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
/**
 * 같은 길이의 "뼈대" 소스: 주석과 문자열·템플릿의 글자는 공백으로 지우고(따옴표·줄바꿈은 남김),
 * 템플릿 안의 ${ … } 식은 코드라서 그대로 둔다. 호출 이름·괄호를 찾을 때 문자열 속 글자에 속지 않으려는 것.
 */
export function mask(src) {
  const n = src.length, out = new Array(n).fill(' ');
  const blank = c => (c === '\n' ? '\n' : ' ');
  const tplStack = [];   // ${ 를 연 시점의 중괄호 깊이
  let i = 0, brace = 0;
  const readTemplate = () => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out[i + 1] = blank(src[i + 1] ?? ' '); i += 2; continue; }
      if (c === '`') { out[i] = '`'; i++; return; }
      if (c === '$' && src[i + 1] === '{') { out[i] = '$'; out[i + 1] = '{'; i += 2; tplStack.push(brace); brace++; return; }
      out[i] = blank(c); i++;
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out[i] = blank(src[i]); i++; } i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; out[i] = q; i++;
      while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') { i += 2; continue; } i++; }
      if (i < n && src[i] === q) { out[i] = q; i++; }
      continue;
    }
    if (c === '`') { out[i] = '`'; i++; readTemplate(); continue; }
    if (c === '{') { brace++; out[i] = c; i++; continue; }
    if (c === '}') { brace--; out[i] = c; i++; if (tplStack.length && tplStack[tplStack.length - 1] === brace) { tplStack.pop(); readTemplate(); } continue; }
    out[i] = c === '\n' ? '\n' : c; i++;
  }
  return out.join('');
}
/** name( … ) 호출마다 { index, line, name, args } 를 돌려준다. function 선언은 뺀다. */
export function calls(src, nameRegex) {
  const skeleton = mask(src), found = [];
  const re = new RegExp('(?<![\\w$])(' + nameRegex + ')\\s*\\(', 'g');
  let m;
  while ((m = re.exec(skeleton))) {
    if (/function\s*\*?\s*$/.test(skeleton.slice(Math.max(0, m.index - 14), m.index))) continue;
    let depth = 0, i = m.index + m[0].length - 1;
    const start = i;
    for (; i < skeleton.length; i++) { const c = skeleton[i]; if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
    found.push({ index: m.index, line: skeleton.slice(0, m.index).split('\n').length, name: m[1], args: src.slice(start + 1, i) });
  }
  return found;
}
/** 인자 텍스트에서 한글이 들어 있는 문자열·템플릿 리터럴을 모은다(주석 제외). */
export function hangulLiterals(args) {
  const out = []; const text = blankComments(args);
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g; let m;
  while ((m = re.exec(text))) { const body = m[1] ?? m[2] ?? m[3]; if (HANGUL.test(body)) out.push({ quote: m[1] !== undefined ? '"' : m[2] !== undefined ? "'" : '`', body, index: m.index }); }
  return out;
}

/** `{ a, b: 1, 'c': 2 }` 꼴 텍스트의 가장 바깥 키 이름들(값 안쪽의 중괄호는 건너뛴다). */
export function topLevelKeys(objectText) {
  const text = blankComments(objectText), keys = [];
  let depth = 0, i = 0;
  const startAt = text.indexOf('{');
  if (startAt < 0) return keys;
  for (i = startAt; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; if (depth === 1) { const m = /^\s*(?:\.\.\.)?\s*(["']?)([A-Za-z_$][\w$]*)\1\s*(?=[:,}])/.exec(text.slice(i + 1)); if (m) keys.push(m[2]); } continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) break; continue; }
    if (c === ',' && depth === 1) { const m = /^\s*(?:\.\.\.)?\s*(["']?)([A-Za-z_$][\w$]*)\1\s*(?=[:,}])/.exec(text.slice(i + 1)); if (m) keys.push(m[2]); }
  }
  return keys;
}
/** 호출 인자 텍스트를 가장 바깥 쉼표에서 나눈다. */
export function splitArgs(args) {
  const text = blankComments(args), parts = []; let depth = 0, last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } continue; }
    if (c === '(' || c === '[' || c === '{') depth++; else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(args.slice(last, i)); last = i + 1; }
  }
  parts.push(args.slice(last));
  return parts;
}
