"use strict";
window.SF_SUPABASE_CONFIG = window.SF_SUPABASE_CONFIG || {
  url: "https://cgoafcjvnbzozxbbyfle.supabase.co",
  publishableKey: "sb_publishable_4Uaud2QBRlKMdN3DC-G2BQ_yJ15uZuP"
};
// 기능 플래그. 회원 탈퇴는 레슨 앱과 Supabase 프로젝트·profiles 테이블을 함께 쓰는 동안 켜면 안 된다 —
// 사용자를 지우면 레슨 앱 쪽 데이터까지 연쇄 삭제될 수 있다(D1: 프로젝트 분리 전). 분리가 끝나면 8-5의 전환 도구로 이 값을 켠다:
//   node tests/switch-supabase-project.mjs --url https://<새 ref>.supabase.co --key sb_publishable_… --enable-delete-account  (주소·공개 키도 함께 바뀐다)
// 켜기 전에는 Edge Function(supabase/functions/delete-account)도 배포하지 않는다. 주소·localStorage로는 켜지지 않는다.
window.SF_FEATURES = window.SF_FEATURES || { deleteAccount: false };
window.SF = window.SF || {};
window.SF.loadSupabase = function () {
  return window.supabase ? Promise.resolve(window.supabase)
    : Promise.reject(new Error("Supabase library unavailable"));
};
