"use strict";
window.SF_SUPABASE_CONFIG = window.SF_SUPABASE_CONFIG || {
  url: "https://cgoafcjvnbzozxbbyfle.supabase.co",
  publishableKey: "sb_publishable_4Uaud2QBRlKMdN3DC-G2BQ_yJ15uZuP"
};
window.SF = window.SF || {};
window.SF.loadSupabase = function () {
  return window.supabase ? Promise.resolve(window.supabase)
    : Promise.reject(new Error("Supabase library unavailable"));
};
