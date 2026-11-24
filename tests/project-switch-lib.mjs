// D1(Supabase 프로젝트 분리) 전환 도구의 본체 — 파일을 읽고 쓰지 않는 순수 함수만 둔다(시험하기 쉽게). 명령줄은 tests/switch-supabase-project.mjs.
// 이 도구가 다루는 것은 공개해도 되는 값(프로젝트 주소·publishable/anon 키)뿐이다.
// 비밀 키(sb_secret_·service_role)는 거절하고, 어떤 오류 문구·요약에도 키 값을 싣지 않는다.

export class SwitchError extends Error {
  constructor(message) { super(message); this.name = 'SwitchError'; }
}

const REF = /^[a-z0-9]{20}$/;
const SHAPE = '올바른 모양: https://<소문자·숫자 20자>.supabase.co (예: https://abcdefghijklmnopqrst.supabase.co)';

// "https://<ref>.supabase.co"만 받는다. 끝의 /·공백·대문자는 정리하고, 경로·포트·계정·쿼리가 붙은 주소와 다른 호스트는 거절한다.
export function parseProjectUrl(input) {
  const text = String(input ?? '').trim();
  let url;
  try { url = new URL(text); } catch { throw new SwitchError(`프로젝트 주소를 읽을 수 없어요. ${SHAPE}`); }
  if (url.protocol !== 'https:') throw new SwitchError(`프로젝트 주소는 https여야 해요. ${SHAPE}`);
  if (url.username || url.password || url.port || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new SwitchError(`프로젝트 주소 뒤에 계정·포트·경로·쿼리가 붙으면 안 돼요. ${SHAPE}`);
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (!match || !REF.test(match[1])) throw new SwitchError(`프로젝트 주소가 ${SHAPE.replace('올바른 모양: ', '')} 모양이 아니에요. 사용자 지정 도메인은 이 도구가 다루지 않아요.`);
  return { ref: match[1], url: `https://${match[1]}.supabase.co` };
}

// 앱(js/auth.js의 isPublicKey)이 받는 키와 같은 것만 받는다: sb_publishable_… 또는 role이 anon인 JWT.
// 그 위에 하나 더: anon JWT 안에 프로젝트 ref가 있으면 주소의 ref와 같아야 한다(다른 프로젝트의 키를 넣는 실수 방지).
export function checkPublicKey(input, { ref } = {}) {
  const key = String(input ?? '').trim();
  if (!key) throw new SwitchError('공개(publishable) 키를 주세요. sb_publishable_… 로 시작해요.');
  if (/^sb_secret_/i.test(key)) throw new SwitchError('비밀 키(sb_secret_…)는 앱 파일에 넣을 수 없어요. 공개(publishable) 키만 쓰세요.');
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return { key, kind: 'publishable' };
  const parts = key.split('.');
  if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
    let payload = null;
    try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { payload = null; }
    if (!payload || typeof payload !== 'object') throw new SwitchError('키 안의 내용을 읽을 수 없어요. 공개(publishable) 키나 anon 키를 확인해 주세요.');
    if (payload.role === 'service_role') throw new SwitchError('service_role 키는 앱 파일에 넣을 수 없어요. 공개(publishable) 키나 anon 키만 쓰세요.');
    if (payload.role !== 'anon') throw new SwitchError('anon 키가 아니에요. 공개(publishable) 키나 anon 키만 쓸 수 있어요.');
    if (ref && payload.ref !== undefined && payload.ref !== ref) throw new SwitchError('이 키는 다른 프로젝트의 것이에요(키 안의 프로젝트 ref가 주소와 달라요).');
    return { key, kind: 'anon' };
  }
  throw new SwitchError('지원하지 않는 키 모양이에요. sb_publishable_… 로 시작하는 공개 키를 쓰세요.');
}

function replaceOnce(text, pattern, value, what) {
  const found = text.match(pattern);
  if (!found || found.length !== 1) throw new SwitchError(`js/config.js에서 ${what}을(를) 정확히 한 곳만 찾지 못했어요(${found ? found.length : 0}곳). 파일 모양이 달라졌는지 확인해 주세요.`);
  return text.replace(pattern, (_, before, _old, after) => `${before}${value}${after}`);
}

function rewriteConfig(source, { url, key, enableDeleteAccount }) {
  const current = /^\s*url:\s*"(https:\/\/[^"\s]+)"/m.exec(source);
  let text = replaceOnce(source, /^(\s*url:\s*")(https:\/\/[^"\s]+)(")/gm, url, '프로젝트 주소(url)');
  text = replaceOnce(text, /^(\s*publishableKey:\s*")([^"\s]+)(")/gm, key, '공개 키(publishableKey)');
  let deleteAccount = 'unchanged';
  const flag = /(window\.SF_FEATURES\s*=\s*window\.SF_FEATURES\s*\|\|\s*\{\s*deleteAccount:\s*)(true|false)(?=\s*\})/;
  const found = flag.exec(text);
  if (enableDeleteAccount) {
    if (!found) throw new SwitchError('js/config.js에서 탈퇴 플래그(SF_FEATURES.deleteAccount) 줄을 찾지 못했어요.');
    if (found[2] === 'true') deleteAccount = 'already-enabled';
    else { text = text.replace(flag, (_, before) => `${before}true`); deleteAccount = 'enabled'; }
  }
  return { text, previousUrl: current ? current[1] : null, deleteAccount };
}

// CSP 값 안의 supabase 주소 토큰(와일드카드 또는 한 프로젝트)을 새 프로젝트 하나로 바꾼다. 다른 토큰·다른 지시어는 건드리지 않는다.
const CSP_TOKEN = /\b(https|wss):\/\/(?:\*|[a-z0-9]{20})\.supabase\.co(?=[\s;]|$)/g;
function rewriteCsp(source, ref) {
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new SwitchError('vercel.json을 JSON으로 읽을 수 없어요.'); }
  const values = [];
  for (const group of (parsed && Array.isArray(parsed.headers) ? parsed.headers : [])) {
    for (const item of (group && Array.isArray(group.headers) ? group.headers : [])) {
      if (item && typeof item.key === 'string' && item.key.toLowerCase() === 'content-security-policy' && typeof item.value === 'string') values.push(item.value);
    }
  }
  if (!values.length) throw new SwitchError('vercel.json에서 Content-Security-Policy(CSP) 헤더를 찾지 못했어요.');
  let text = source, tokens = 0;
  for (const value of new Set(values)) {
    const next = value.replace(CSP_TOKEN, (_, scheme) => { tokens += 1; return `${scheme}://${ref}.supabase.co`; });
    if (next === value) continue;
    if (!text.includes(value)) throw new SwitchError('vercel.json의 CSP를 글자 그대로 찾지 못했어요(이스케이프된 글자가 있나요?).');
    text = text.split(value).join(next);
  }
  if (!tokens) throw new SwitchError('vercel.json의 CSP에서 supabase 주소(https://….supabase.co)를 찾지 못했어요.');
  try { JSON.parse(text); } catch { throw new SwitchError('vercel.json을 바꾼 결과가 JSON이 아니에요. 바꾸지 않았어요.'); }
  if (/\*\.supabase\.co/.test(text)) throw new SwitchError('vercel.json에 와일드카드 supabase 주소가 남았어요. 바꾸지 않았어요.');
  return { text, tokens };
}

// 한 번에 계산한다(파일은 건드리지 않는다). 어느 하나라도 틀리면 던지고 아무것도 돌려주지 않는다 — 반쯤 바뀐 결과가 없다.
export function switchProject({ configText, vercelText, url, key, enableDeleteAccount = false }) {
  const project = parseProjectUrl(url);
  const checked = checkPublicKey(key, { ref: project.ref });
  const config = rewriteConfig(String(configText), { url: project.url, key: checked.key, enableDeleteAccount });
  const csp = rewriteCsp(String(vercelText), project.ref);
  const previousRef = config.previousUrl ? (/^https:\/\/([^./]+)\.supabase\.co/.exec(config.previousUrl) || [])[1] || null : null;
  return {
    config: config.text, vercel: csp.text,
    summary: {
      url: project.url, ref: project.ref, keyKind: checked.kind,
      previousUrl: config.previousUrl, previousRef,
      cspTokens: csp.tokens, deleteAccount: config.deleteAccount,
      changed: config.text !== String(configText) || csp.text !== String(vercelText),
    },
  };
}

// 옛 프로젝트 ref가 아직 적힌 파일을 찾는다(문서·시험 기록 등 사람이 봐야 할 곳). 내용은 돌려주지 않고 파일 이름과 횟수만.
export function findStaleReferences(files, ref) {
  if (!ref) return [];
  const entries = files instanceof Map ? [...files] : Object.entries(files || {});
  return entries
    .map(([file, text]) => ({ file, count: String(text).split(ref).length - 1 }))
    .filter(item => item.count > 0)
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
