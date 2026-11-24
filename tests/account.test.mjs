// P8-4: 계정 기능·노출 정리 — 노드 시험(브라우저 없이 되는 것: 마크업 불변식, 순수 함수, Edge Function 핸들러, i18n).
// 브라우저 동작(대화상자·복구 링크 흐름)은 tests/account-browser.test.mjs가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const html = read('index.html');
const section = (text, openTag) => {
  const start = text.indexOf(openTag);
  assert.ok(start >= 0, `${openTag} 가 있어야 한다`);
  const name = openTag.match(/^<(\w+)/)[1];
  let depth = 0;
  for (const m of text.slice(start).matchAll(new RegExp(`<${name}\\b|</${name}>`, 'g'))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return text.slice(start, start + m.index + m[0].length);
  }
  throw new Error(`${openTag} 의 닫는 태그를 못 찾음`);
};
function loadAuth(extra = {}) {
  const context = { window: { SF: { core: {} } }, atob, URLSearchParams, URL, ...extra };
  vm.runInNewContext(read('js/safe-html.js'), context);
  vm.runInNewContext(read('js/auth.js'), context);
  return context.window.SF.auth;
}

// ───────── a. 연결 설정 숨김 ─────────
test('P8-4a 마크업: Supabase 연결 칸(#auth-config)은 hidden으로 시작하고, URL·키 입력은 그 안에만 있다', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  const config = section(dialog, '<section id="auth-config"');
  assert.match(config.match(/^<section[^>]*>/)[0], /\bhidden\b/, '처음에는 숨김(개발 모드에서만 js가 연다)');
  for (const id of ['supabase-url', 'supabase-key', 'btn-save-supabase-config', 'btn-clear-supabase-config']) {
    assert.ok(config.includes(`id="${id}"`), `${id} 는 연결 칸 안에 있다`);
    assert.equal(dialog.split(`id="${id}"`).length - 1, 1, `${id} 는 한 번만 나온다`);
  }
});

test('P8-4a 마크업: "사용자 지정 연결 사용 중 · [기본값으로]" 띠는 hidden으로 시작하고 연결 칸 밖에 있다', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  const banner = section(dialog, '<div id="auth-custom-banner"');
  assert.match(banner.match(/^<div[^>]*>/)[0], /\bhidden\b/);
  assert.match(banner.match(/^<div[^>]*>/)[0], /role="status"/);
  assert.match(banner, /사용자 지정 연결 사용 중/);
  assert.match(banner, /<button id="btn-reset-default-connection" type="button"[^>]*>기본값으로<\/button>/);
  assert.equal(section(dialog, '<section id="auth-config"').includes('auth-custom-banner'), false, '개발 모드가 아니어도 보여야 하므로 연결 칸 밖');
});

test('P8-4a 개발 모드 판정: ?dev=1 또는 localStorage scoreforge.dev = "1"/"true"일 때만 켜진다', () => {
  const { devModeFrom } = loadAuth();
  assert.equal(devModeFrom('?dev=1', null), true);
  assert.equal(devModeFrom('?x=2&dev=1', ''), true);
  assert.equal(devModeFrom('', '1'), true);
  assert.equal(devModeFrom('', 'true'), true);
  assert.equal(devModeFrom('', 'TRUE'), true);
  for (const search of ['', '?dev', '?dev=', '?dev=0', '?dev=true', '?dev=11', '?xdev=1', '?x=dev%3D1', '?dev%3D1']) assert.equal(devModeFrom(search, null), false, `search ${JSON.stringify(search)}`);
  for (const stored of [null, undefined, '', '0', 'false', 'yes', '2', ' ']) assert.equal(devModeFrom('', stored), false, `stored ${JSON.stringify(stored)}`);
  assert.equal(devModeFrom(undefined, undefined), false);
  assert.equal(devModeFrom(null, null), false);
});

test('P8-4a 개발 모드 판정은 URLSearchParams가 없는 환경에서도 던지지 않는다', () => {
  const auth = loadAuth({ URLSearchParams: undefined });
  assert.equal(auth.devModeFrom('?dev=1', null), false);
  assert.equal(auth.devModeFrom('?dev=1', '1'), true, '저장값 경로는 그대로 동작');
});

test('P8-4a 사용자 지정 연결 판정: 실제로 쓰는 연결이 기본 설정(js/config.js)과 다를 때만 참', () => {
  const { customConnectionFrom } = loadAuth();
  const base = { url: 'https://a.supabase.co', publishableKey: 'sb_publishable_a' };
  assert.equal(customConnectionFrom({ ...base }, base), false);
  assert.equal(customConnectionFrom({ ...base, url: 'https://b.supabase.co' }, base), true);
  assert.equal(customConnectionFrom({ ...base, publishableKey: 'sb_publishable_b' }, base), true);
  assert.equal(customConnectionFrom({ url: '', publishableKey: '' }, { url: '', publishableKey: '' }), false, '기본값도 없고 저장값도 없으면 사용자 지정이 아니다');
  assert.equal(customConnectionFrom(base, { url: '', publishableKey: '' }), true, '기본값이 없는 포크에서 저장값을 쓰면 사용자 지정');
});

// ───────── b. 관리자 버튼 ─────────
test('P8-4b 마크업: "관리자 로그인" 버튼은 없고, "관리자 페이지" 버튼은 hidden으로 시작한다', () => {
  assert.equal(html.includes('btn-admin-login'), false, '관리자도 일반 로그인을 쓴다');
  assert.equal(/>\s*관리자 로그인\s*</.test(html), false);
  const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
  const authbar = section(header, '<div class="authbar"');
  const page = authbar.match(/<button id="btn-admin-page"[^>]*>/)[0];
  assert.match(page, /\bhidden\b/, '관리자일 때만 js가 보인다');
  assert.ok(authbar.indexOf('id="btn-member-login"') < authbar.indexOf('id="btn-admin-page"'), '순서: 회원 로그인 → 관리자 페이지');
});

test('P8-4b auth.js: 관리자 로그인 모드와 버튼 연결이 남아 있지 않다', () => {
  const source = read('js/auth.js');
  assert.equal(/btn-admin-login/.test(source), false);
  assert.equal(/^\s*admin:\s*\{/m.test(source), false, 'AUTH_MODES.admin 없음');
  assert.equal(/mode === "admin"/.test(source), false, '관리자 로그인 뒤 권한 확인·로그아웃 가지 없음');
  assert.match(source, /adminPage\.hidden = !\(signedIn && admin\)/, '"관리자 페이지"는 로그인한 관리자에게만');
});

test('P8-4b i18n: 관리자 로그인 전용 문구는 쓰는 곳이 없어 지웠고, 관리자 페이지 문구는 남아 있다', () => {
  const i18n = read('js/i18n.js');
  for (const key of ['adminLogin', 'adminHelp', 'noAdmin', 'adminDone', 'checkRls']) assert.equal(new RegExp(`^\\s+${key} \\|`, 'm').test(i18n), false, `auth.${key}`);
  for (const key of ['adminPage', 'adminRequired', 'adminStatus', 'adminAuth']) assert.equal(new RegExp(`^\\s+${key} \\|`, 'm').test(i18n), true, `auth.${key}`);
});

// ───────── c. 비밀번호 재설정 ─────────
test('P8-4c 마크업: 로그인 창에 "비밀번호를 잊으셨나요?" 버튼이 있다(type=button, 폼 제출과 무관)', () => {
  const dialog = section(html, '<dialog id="dlg-auth">');
  assert.match(dialog, /<button id="btn-forgot-password" type="button" class="auth-link">비밀번호를 잊으셨나요\?<\/button>/);
  assert.ok(dialog.indexOf('id="auth-password"') < dialog.indexOf('id="btn-forgot-password"'), '비밀번호 칸 다음');
});

test('P8-4c 재설정 메일 주소: http·https에서만 <origin>/?auth=recovery, 그 밖(file 등)에서는 지정하지 않는다', () => {
  const { recoveryRedirectFrom } = loadAuth();
  assert.equal(recoveryRedirectFrom({ protocol: 'https:', origin: 'https://musescore-copy.vercel.app' }), 'https://musescore-copy.vercel.app/?auth=recovery');
  assert.equal(recoveryRedirectFrom({ protocol: 'http:', origin: 'http://127.0.0.1:8000' }), 'http://127.0.0.1:8000/?auth=recovery');
  assert.equal(recoveryRedirectFrom({ protocol: 'file:', origin: 'null' }), '');
  assert.equal(recoveryRedirectFrom({ protocol: 'https:', origin: '' }), '');
  assert.equal(recoveryRedirectFrom(null), '');
  assert.equal(recoveryRedirectFrom(undefined), '');
});

test('P8-4c 복구 링크로 돌아온 주소 해석: 성공 토큰·실패(만료)·아무것도 없음·관계없는 주소', () => {
  const { recoveryReturnFrom } = loadAuth();
  const base = 'https://app.example/';
  const ok = recoveryReturnFrom(base + '?auth=recovery#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
  assert.deepEqual({ ...ok }, { recovery: true, failed: false, hasTokens: true });
  const expired = recoveryReturnFrom(base + '?auth=recovery#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.deepEqual({ ...expired }, { recovery: true, failed: true, hasTokens: false });
  assert.deepEqual({ ...recoveryReturnFrom(base + '?auth=recovery') }, { recovery: true, failed: false, hasTokens: false });
  assert.deepEqual({ ...recoveryReturnFrom(base + '?auth=recovery&code=abc') }, { recovery: true, failed: false, hasTokens: true }, '코드 방식(PKCE)도 토큰으로 본다');
  for (const other of [base, base + '?share=abc', base + '?auth=other#access_token=x', base + '#access_token=x', 'not a url', '', null, undefined]) {
    assert.deepEqual({ ...recoveryReturnFrom(other) }, { recovery: false, failed: false, hasTokens: false }, String(other));
  }
});

test('P8-4c 오류 문구 변환: 로그인 실패·요청 과다·같은 비밀번호·약한 비밀번호·세션 없음·네트워크', () => {
  const { errorMessage } = loadAuth();
  assert.equal(errorMessage({ message: 'Invalid login credentials' }), '이메일 또는 비밀번호가 올바르지 않습니다.');
  assert.equal(errorMessage({ message: 'Email not confirmed' }), '이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인하세요.');
  assert.equal(errorMessage({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' }), '요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.');
  assert.equal(errorMessage({ message: 'For security purposes, you can only request this after 49 seconds.' }), '요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.');
  assert.equal(errorMessage({ message: 'New password should be different from the old password.' }), '이전과 다른 비밀번호를 입력하세요.');
  assert.equal(errorMessage({ message: 'Password should be at least 6 characters.', code: 'weak_password' }), '비밀번호가 너무 짧아요. 더 길게 만들어 주세요.', '코드가 weak_password여도 길이 문제는 길이로 안내');
  assert.equal(errorMessage({ message: 'Password should be at least 12 characters.' }), '비밀번호가 너무 짧아요. 더 길게 만들어 주세요.', '서버가 정한 길이가 6이 아니어도 틀린 숫자를 말하지 않는다');
  assert.equal(errorMessage({ message: 'Password is known to be weak and easy to guess, please choose a different one.' }), '너무 흔한 비밀번호예요. 다른 비밀번호를 고르세요.');
  assert.equal(errorMessage({ message: 'Auth session missing!' }), '로그인 상태가 풀렸어요. 다시 로그인하거나 재설정 메일을 다시 받으세요.');
  assert.match(errorMessage(new TypeError('Failed to fetch')), /Supabase에 연결할 수 없습니다/);
  assert.equal(errorMessage({ message: '뜻밖의 오류' }), '뜻밖의 오류', '모르는 오류는 그대로');
  assert.equal(errorMessage(null), '알 수 없는 오류');
});

test('P8-4c promptDialog는 autocomplete 옵션을 입력칸에 넘긴다(새 비밀번호 칸에 new-password)', () => {
  assert.match(read('js/ui-dialog.js'), /\["min", "max", "step", "maxLength", "placeholder", "autocomplete"\]/);
});

// ───────── i18n: 회원 창·메뉴의 한국어 문구가 모두 영어로 번역된다 ─────────
function englishTranslator() {
  const context = vm.createContext({ console: { warn() {} }, navigator: { language: 'ko-KR' }, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(read('js/i18n.js'), context);
  context.SF.i18n.setLanguage('en', { persist: false });
  return text => context.SF.i18n.translate(text);
}
const hangul = /[가-힣]/;

test('P8-4 i18n: 회원 창(#dlg-auth)·회원 메뉴·관리자 창 마크업의 한국어 문구는 모두 영어로 번역된다', () => {
  const en = englishTranslator();
  for (const open of ['<dialog id="dlg-auth">', '<div class="authbar"', '<dialog id="dlg-admin">']) {
    const part = section(html, open);
    const texts = new Set();
    for (const m of part.matchAll(/>([^<>]*[가-힣][^<>]*)</g)) texts.add(m[1].trim());
    for (const m of part.matchAll(/\b(?:title|placeholder|aria-label)="([^"]*[가-힣][^"]*)"/g)) texts.add(m[1].trim());
    assert.ok(texts.size >= 5, `${open}: 문구를 찾지 못함`);
    for (const text of texts) assert.equal(hangul.test(en(text)), false, `${open}: "${text}" 의 영어 문구가 없다 — js/i18n.js의 auth 그룹에 같은 한국어로 추가`);
  }
});

test('P8-4 i18n: js/auth.js가 화면에 내는 한국어 문구(토스트·안내·대화상자)는 모두 영어로 번역된다', () => {
  const en = englishTranslator();
  const source = read('js/auth.js');
  const literals = new Set();
  for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) if (hangul.test(m[1]) && !m[1].includes('${')) literals.add(m[1].replace(/\\"/g, '"'));
  for (const m of source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) if (hangul.test(m[1]) && !m[1].includes('${')) literals.add(m[1].replace(/\\'/g, "'"));
  for (const m of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) if (hangul.test(m[1]) && !m[1].includes('${')) literals.add(m[1]);
  // 화면 문구가 아닌 조각: 주석 속 인용, 상태 글자의 앞부분(" · 관리자" 등은 패턴으로 번역), 관리자 목록 마크업(DOM 번역 대상)
  const notUi = new Set(['사용자 지정 연결', ' · 관리자', ' · 회원']);
  const missing = [...literals].filter(text => !notUi.has(text) && !/^<div class="admin-empty">/.test(text) && hangul.test(en(text)));
  assert.deepEqual(missing, [], '영어 문구가 없는 한국어 문구 — js/i18n.js의 auth 그룹에 추가(화면 문구가 아니면 이 시험의 notUi에)');
  assert.ok(literals.size >= 50, `문구 ${literals.size}개`);
  for (const sentence of ['요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.', '기본 연결로 돌아왔어요.', '새 비밀번호 설정', '비밀번호를 바꿨어요']) {
    assert.ok(literals.has(sentence), `${sentence} 는 auth.js에 있어야 한다`);
  }
});
