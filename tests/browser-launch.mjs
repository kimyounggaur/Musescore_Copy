// 브라우저 테스트 공용 설정 (Step 3-1·3-2)
//   PW_CHANNEL        'msedge' | 'chrome' | 비우면 번들 Chromium
//   PW_HEADED         값이 있으면 창을 띄움
//   SF_BLOCK_SAMPLES  1이면 외부 음원 호스트 요청을 차단(테스트 중 음원 다운로드로 시간 초과되는 것을 막음)
export function launchOptions(extra = {}) {
  const channel = process.env.PW_CHANNEL;
  return { headless: !process.env.PW_HEADED, ...(channel ? { channel } : {}), ...extra };
}

// 앱은 navigator.language로 언어를 고른다. 테스트는 한국어 문구를 기대하므로 컨텍스트 언어를 ko-KR로 맞춘다.
//   PW_LOCALE로 바꿀 수 있다(예: en-US).
export function pageOptions(extra = {}) {
  return { locale: process.env.PW_LOCALE || 'ko-KR', ...extra };
}

// 이 호스트 목록은 sw.js의 SAMPLE_HOSTS와 같아야 한다. 한쪽만 바꾸지 말 것.
const SAMPLE_HOSTS = /gleitz\.github\.io|smpldsnds\.github\.io|goldst\.dev/;
const blocked = new WeakSet();

export async function preparePage(page) {
  if (!process.env.SF_BLOCK_SAMPLES) return;
  const context = page.context();
  if (blocked.has(context)) return;
  blocked.add(context);
  await context.route(SAMPLE_HOSTS, route => route.abort());
}
