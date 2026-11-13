"use strict";
window.SF_SUPABASE_CONFIG = window.SF_SUPABASE_CONFIG || {
  url: "https://cgoafcjvnbzozxbbyfle.supabase.co",
  publishableKey: "sb_publishable_4Uaud2QBRlKMdN3DC-G2BQ_yJ15uZuP"
};
window.SF = window.SF || {};
window.SF.loadSupabase = function() {
  if (window.supabase) return Promise.resolve(window.supabase);
  if (!window.SF._supabaseLoading) window.SF._supabaseLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/supabase.js";
    script.onload = () => resolve(window.supabase);
    script.onerror = () => { window.SF._supabaseLoading = null; reject(new Error("Supabase library unavailable")); };
    document.head.appendChild(script);
  });
  return window.SF._supabaseLoading;
};
