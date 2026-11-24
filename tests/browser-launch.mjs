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
const quieted = new WeakSet();

export async function preparePage(page) {
  const context = page.context();
  // 음원 미리 받기(P9-4)는 시험에서는 기본으로 꺼 둔다: 첫 조작 뒤에 음원 서버로 요청이 나가거나 샘플 상태 칩이 바뀌어
  // 그것과 상관없는 시험이 흔들리지 않게 한다. 저장된 값이 이미 있으면(시험이 직접 정했으면) 건드리지 않는다. 미리 받기를 시험하는 쪽은 'on'으로 켠다.
  if (!quieted.has(context)) {
    quieted.add(context);
    await context.addInitScript(() => {
      try { if (localStorage.getItem('scoreforge.audio.preload') === null) localStorage.setItem('scoreforge.audio.preload', 'off'); } catch (err) { /* 저장소를 못 쓰는 문서는 그대로 둔다 */ }
    });
  }
  if (!process.env.SF_BLOCK_SAMPLES) return;
  if (blocked.has(context)) return;
  blocked.add(context);
  await context.route(SAMPLE_HOSTS, route => route.abort());
}
