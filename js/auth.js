/* Dependencies: SF.core, SF.app (runtime). */
"use strict";
(function(SF) {
  const C = SF.core;
  const $ = selector => document.querySelector(selector);
  const toast = message => SF.app.toast(message);
  const longToast = message => SF.app.toast(message, { duration: 6000 });   // 꼭 읽어야 하는 알림(탈퇴 결과 등)
  const htmlEsc = SF.html.esc;
  const SUPABASE_URL_KEY = "scoreforge.supabase.url";
  const SUPABASE_KEY_KEY = "scoreforge.supabase.publishableKey";
  const DEV_KEY = "scoreforge.dev";
  const AUTH_MODES = {
    signup: {
      title: "회원가입",
      submit: "회원가입",
      message: "이메일과 비밀번호로 새 계정을 만들어요. 이메일 확인이 켜져 있으면 인증 메일 확인 뒤 로그인됩니다.",
      showName: true,
    },
    member: {
      title: "회원 로그인",
      submit: "회원 로그인",
      message: "가입한 회원 계정으로 로그인합니다.",
      showName: false,
    },
  };
  const authState = {
    client: null,
    configSig: "",
    mode: "member",
    session: null,
    profile: null,
    authSub: null,
  };

  // js/config.js가 넣어 둔 기본 연결. 저장된 사용자 지정 값이 없을 때 이것을 쓴다.
  function embeddedConfig() {
    const embedded = window.SF_SUPABASE_CONFIG || {};
    return {
      url: String(embedded.url || embedded.supabaseUrl || "").trim().replace(/\/+$/, ""),
      publishableKey: String(embedded.publishableKey || embedded.anonKey || embedded.key || "").trim(),
    };
  }

  function readSupabaseConfig() {
    const embedded = embeddedConfig();
    let url = "";
    let publishableKey = "";
    try {
      url = localStorage.getItem(SUPABASE_URL_KEY) || "";
      publishableKey = localStorage.getItem(SUPABASE_KEY_KEY) || "";
    } catch {}
    return {
      url: String(url || embedded.url).trim().replace(/\/+$/, ""),
      publishableKey: String(publishableKey || embedded.publishableKey).trim(),
    };
  }

  // P8-4a: 연결 주소·키 칸은 개발 모드에서만 보인다(?dev=1 은 처음 열 때 한 번 읽고, localStorage 값은 그때그때 읽는다).
  function devModeFrom(search, stored) {
    let query = false;
    try { query = new URLSearchParams(String(search || "")).get("dev") === "1"; } catch {}
    return query || /^(1|true)$/i.test(String(stored == null ? "" : stored));
  }
  const devQueryAtBoot = (() => { try { return devModeFrom(location.search, null); } catch { return false; } })();
  function isDevMode() {
    let stored = null;
    try { stored = localStorage.getItem(DEV_KEY); } catch {}
    return devQueryAtBoot || devModeFrom("", stored);
  }
  // 실제로 쓰는 연결이 기본 연결과 다르면 "사용자 지정 연결"이다.
  function customConnectionFrom(effective, embedded) {
    return effective.url !== embedded.url || effective.publishableKey !== embedded.publishableKey;
  }
  function hasCustomConnection() {
    return customConnectionFrom(readSupabaseConfig(), embeddedConfig());
  }
  function applyConnectionChrome() {
    const config = $("#auth-config");
    const banner = $("#auth-custom-banner");
    if (config) config.hidden = !isDevMode();
    if (banner) banner.hidden = !hasCustomConnection();
  }

  function fillSupabaseConfigFields() {
    const cfg = readSupabaseConfig();
    const urlEl = $("#supabase-url");
    const keyEl = $("#supabase-key");
    if (urlEl) urlEl.value = cfg.url;
    if (keyEl) keyEl.value = cfg.publishableKey;
  }

  function isSupabaseConfigured() {
    const cfg = readSupabaseConfig();
    return Boolean(cfg.url && cfg.publishableKey);
  }

  function getSupabaseClient(opts = {}) {
    const cfg = readSupabaseConfig();
    if (!cfg.url || !cfg.publishableKey) {
      if (opts.requireConfig === false) return null;
      throw new Error("Supabase Project URL과 publishable key를 먼저 저장하세요.");
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      if (opts.requireConfig === false) return null;
      throw new Error("Supabase JS 라이브러리를 불러오지 못했어요. 네트워크 연결을 확인하세요.");
    }
    const sig = `${cfg.url}|${cfg.publishableKey}`;
    if (!authState.client || authState.configSig !== sig) {
      if (authState.authSub && typeof authState.authSub.unsubscribe === "function") {
        authState.authSub.unsubscribe();
      }
      authState.client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      authState.configSig = sig;
      const { data } = authState.client.auth.onAuthStateChange((event, session) => {
        // 콜백 안에서 Supabase를 바로 부르면 교착할 수 있어, 새 비밀번호 창은 콜백 밖(다음 틱)에서 연다.
        if (event === "PASSWORD_RECOVERY") setTimeout(startPasswordRecovery, 0);
        authState.session = session || null;
        if (!session || !session.user) {
          authState.profile = null;
          updateAuthChrome();
          return;
        }
        const userId = session.user.id;
        loadAuthProfile(session.user).then((profile) => {
          if (!authState.session || !authState.session.user || authState.session.user.id !== userId) return;
          authState.profile = profile;
          updateAuthChrome();
        });
      });
      authState.authSub = data && data.subscription;
    }
    return authState.client;
  }

  function authErrorMessage(err) {
    const raw = String((err && (err.message || err.error_description)) || err || "알 수 없는 오류");
    const code = String((err && (err.code || err.error_code)) || "");
    if (/invalid login credentials/i.test(raw)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (/email not confirmed/i.test(raw)) return "이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인하세요.";
    if (/rate limit|you can only request this after/i.test(`${raw} ${code}`)) return "요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.";
    if (/different from the old password|same_password/i.test(`${raw} ${code}`)) return "이전과 다른 비밀번호를 입력하세요.";
    // 길이 문제를 먼저 본다: 서버는 길이 부족에도 weak_password 코드를 쓴다. 서버가 정한 최소 길이는 6이 아닐 수 있어 숫자는 말하지 않는다.
    if (/password should be at least \d+ characters/i.test(raw)) return "비밀번호가 너무 짧아요. 더 길게 만들어 주세요.";
    if (/known to be weak|easy to guess|weak_password/i.test(`${raw} ${code}`)) return "너무 흔한 비밀번호예요. 다른 비밀번호를 고르세요.";
    if (/auth session missing|session_not_found/i.test(`${raw} ${code}`)) return "로그인 상태가 풀렸어요. 다시 로그인하거나 재설정 메일을 다시 받으세요.";
    if (/failed to fetch|network/i.test(raw)) return "Supabase에 연결할 수 없습니다. URL, publishable key, 네트워크 상태를 확인하세요.";
    return raw;
  }

  function setAuthMessage(msg, type = "") {
    const el = $("#auth-message");
    if (!el) return;
    el.textContent = msg || "";
    el.className = `auth-message${type ? " " + type : ""}`;
  }

  function setAuthBusy(isBusy) {
    const btn = $("#auth-submit");
    if (!btn) return;
    btn.disabled = isBusy;
    btn.textContent = isBusy ? "처리 중..." : (AUTH_MODES[authState.mode] || AUTH_MODES.member).submit;
  }

  async function saveSupabaseConfigFromDialog() {
    const url = ($("#supabase-url").value || "").trim().replace(/\/+$/, "");
    const publishableKey = ($("#supabase-key").value || "").trim();
    if (!url || !publishableKey) {
      setAuthMessage("Project URL과 publishable key를 모두 입력하세요.", "error");
      return false;
    }
    if (!/^https?:\/\//i.test(url)) {
      setAuthMessage("Project URL은 https:// 로 시작해야 합니다.", "error");
      return false;
    }
    if (!isPublicKey(publishableKey)) {
      setAuthMessage("브라우저에는 publishable key 또는 anon key만 저장할 수 있어요.", "error");
      return false;
    }
    try {
      localStorage.setItem(SUPABASE_URL_KEY, url);
      localStorage.setItem(SUPABASE_KEY_KEY, publishableKey);
    } catch {
      setAuthMessage("브라우저 저장소에 Supabase 설정을 저장하지 못했어요.", "error");
      return false;
    }
    authState.client = null;
    authState.configSig = "";
    await initSupabaseAuth({ quiet: true });
    setAuthMessage("Supabase 연결 정보를 저장했어요.", "ok");
    updateAuthChrome();
    return true;
  }

  // 저장해 둔 사용자 지정 연결을 지우고 기본 연결(js/config.js)로 돌아간다. 이 기기에서만 로그아웃한다(scope: local).
  async function resetConnection(message) {
    const client = getSupabaseClient({ requireConfig: false });
    try { if (client) await client.auth.signOut({ scope: "local" }); } catch {}
    try {
      localStorage.removeItem(SUPABASE_URL_KEY);
      localStorage.removeItem(SUPABASE_KEY_KEY);
    } catch {}
    authState.client = null;
    authState.configSig = "";
    authState.session = null;
    authState.profile = null;
    fillSupabaseConfigFields();
    await initSupabaseAuth({ quiet: true });
    setAuthMessage(message, "ok");
  }
  const clearSupabaseConfig = () => resetConnection("Supabase 연결 설정을 초기화했어요.");
  const useDefaultConnection = () => resetConnection("기본 연결로 돌아왔어요.");

  async function initSupabaseAuth(opts = {}) {
    fillSupabaseConfigFields();
    applyConnectionChrome();
    if (!window.supabase && SF.loadSupabase && navigator.onLine) {
      try { await SF.loadSupabase(); } catch (error) {
        if (!opts.quiet) console.warn(error.message);
      }
    }
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) {
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      authState.session = data.session || null;
      authState.profile = data.session && data.session.user
        ? await loadAuthProfile(data.session.user, { silent: true })
        : null;
      updateAuthChrome();
    } catch (err) {
      if (!opts.quiet) console.warn("Supabase auth init failed", err);
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
    }
  }

  async function loadAuthProfile(user, opts = {}) {
    const fallback = {
      id: user.id,
      email: user.email || "",
      display_name: (user.user_metadata && user.user_metadata.display_name) || "",
      role: "member",
    };
    const client = getSupabaseClient({ requireConfig: false });
    if (!client || !user) return fallback;
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id,email,display_name,role,created_at,updated_at")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data || fallback;
    } catch (err) {
      if (!opts.silent) console.warn("Profile load failed", err);
      return { ...fallback, profileError: authErrorMessage(err) };
    }
  }

  async function ensureOwnProfile(user, displayName = "") {
    if (!user) return;
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) return;
    const row = {
      id: user.id,
      email: user.email || "",
      display_name: displayName || (user.user_metadata && user.user_metadata.display_name) || "",
      role: "member",
    };
    try {
      const { error } = await client.from("profiles").insert(row);
      if (error && error.code !== "23505" && !/duplicate/i.test(error.message || "")) {
        console.warn("Profile insert skipped", error);
      }
    } catch (err) {
      console.warn("Profile insert skipped", err);
    }
  }

  function isAdminProfile(profile) {
    return Boolean(profile && profile.role === "admin" && !profile.profileError);
  }

  function updateAuthChrome() {
    const configured = isSupabaseConfigured();
    const signedIn = Boolean(authState.session && authState.session.user);
    const profile = authState.profile || {};
    const email = (authState.session && authState.session.user && authState.session.user.email) || profile.email || "";
    const admin = isAdminProfile(profile);
    const status = $("#auth-status");
    if (status) {
      status.className = `auth-status${signedIn ? " signed-in" : ""}${admin ? " admin" : ""}`;
      status.textContent = !configured
        ? "Supabase 미설정"
        : signedIn
          ? `${email}${admin ? " · 관리자" : " · 회원"}`
          : "로그인 전";
      status.title = status.textContent;
    }
    const signup = $("#btn-signup");
    const memberLogin = $("#btn-member-login");
    const adminPage = $("#btn-admin-page");
    const logout = $("#btn-logout");
    const deleteButton = $("#btn-delete-account");
    if (signup) signup.hidden = signedIn;
    if (memberLogin) memberLogin.hidden = signedIn;
    // P8-4b: 관리자도 일반 로그인을 쓴다. "관리자 페이지"는 로그인한 관리자에게만 보인다.
    if (adminPage) {
      adminPage.hidden = !(signedIn && admin);
      adminPage.classList.toggle("on", admin);
    }
    if (logout) logout.hidden = !signedIn;
    if (deleteButton) deleteButton.hidden = !(signedIn && deleteEnabled());   // P8-4d: 플래그가 꺼진 동안은 로그인해도 숨김
    window.dispatchEvent(new CustomEvent("scoreforge:auth", { detail: { userId: authState.session?.user?.id || null } }));
    if (SF.cloud?.state.initialized) SF.cloud.onAuthChanged();
    applyConnectionChrome();
  }

  // ───────── P8-4c 비밀번호 재설정 ─────────
  // 메일의 링크는 <주소>/?auth=recovery 로 돌아온다. http·https가 아니면(file 등) 돌아올 주소를 정할 수 없어 지정하지 않는다.
  function recoveryRedirectFrom(loc) {
    if (!loc || (loc.protocol !== "http:" && loc.protocol !== "https:") || !loc.origin || loc.origin === "null") return "";
    return `${loc.origin}/?auth=recovery`;
  }
  // 복구 링크로 돌아온 주소를 읽는다: 실패(만료·이미 사용)면 failed, 성공이면 토큰이 주소에 실려 있다(hasTokens).
  function recoveryReturnFrom(href) {
    const none = { recovery: false, failed: false, hasTokens: false };
    let url;
    try { url = new URL(String(href)); } catch { return none; }
    if (url.searchParams.get("auth") !== "recovery") return none;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const failed = Boolean(fragment.get("error") || fragment.get("error_code") || fragment.get("error_description"));
    const hasTokens = !failed && Boolean(fragment.get("access_token") || url.searchParams.get("code"));
    return { recovery: true, failed, hasTokens };
  }
  // 처리가 끝난 복구 표시(?auth=recovery와 남은 인증 조각)를 주소에서 지운다. 다른 주소 값은 그대로 둔다.
  function cleanRecoveryUrl() {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("auth") !== "recovery") return;
      url.searchParams.delete("auth");
      url.searchParams.delete("code");
      if (/(^#|&)(access_token|refresh_token|error|error_code|error_description|type)=/.test(url.hash)) url.hash = "";
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }
  function handleRecoveryReturn() {
    const info = recoveryReturnFrom(location.href);
    if (!info.recovery) return;
    if (info.hasTokens) return; // 성공: 라이브러리가 세션을 만들고 PASSWORD_RECOVERY가 이어서 온다(startPasswordRecovery)
    cleanRecoveryUrl();
    if (!info.failed) return;
    openAuthDialog("member");
    setAuthMessage('재설정 링크가 만료됐거나 이미 사용됐어요. "비밀번호를 잊으셨나요?"를 눌러 메일을 다시 받으세요.', "error");
  }
  let recoveryRunning = false;
  async function startPasswordRecovery() {
    if (recoveryRunning) return;
    recoveryRunning = true;
    try {
      cleanRecoveryUrl();
      const client = getSupabaseClient({ requireConfig: false });
      if (!client || !SF.ui || typeof SF.ui.promptDialog !== "function") return;
      let problem = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const password = await SF.ui.promptDialog({
          title: "새 비밀번호 설정",
          message: problem || "새 비밀번호를 입력하세요. 6자 이상이어야 해요.",
          label: "새 비밀번호",
          type: "password",
          autocomplete: "new-password",
          confirmText: "비밀번호 바꾸기",
          validate: value => (String(value).length < 6 ? "비밀번호는 6자 이상이어야 합니다." : ""),
        });
        if (password === null) { toast("비밀번호는 바꾸지 않았어요"); return; }
        const { error } = await client.auth.updateUser({ password });
        if (!error) { toast("비밀번호를 바꿨어요"); return; }
        problem = authErrorMessage(error);
      }
      toast("비밀번호를 바꾸지 못했어요. 재설정 메일을 다시 요청해 주세요.");
    } finally {
      recoveryRunning = false;
    }
  }
  async function requestPasswordReset() {
    const email = ($("#auth-email").value || "").trim();
    if (!email) {
      setAuthMessage("비밀번호를 재설정할 이메일을 입력하세요.", "error");
      $("#auth-email").focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthMessage("이메일 형식이 올바르지 않아요.", "error");
      return;
    }
    if (!isSupabaseConfigured()) {
      setAuthMessage(isDevMode() ? "Supabase 연결 정보를 먼저 저장하세요." : "이 주소에서는 회원 기능을 쓸 수 없어요.", "error");
      return;
    }
    const button = $("#btn-forgot-password");
    if (button) button.disabled = true;
    try {
      const client = getSupabaseClient();
      const redirectTo = recoveryRedirectFrom(location);
      const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : {});
      if (error) throw error;
      // 그 이메일의 계정이 있는지는 알려 주지 않는다(없어도 같은 문구).
      setAuthMessage("입력한 이메일로 가입한 계정이 있으면 재설정 메일이 곧 도착해요. 받은 편지함과 스팸함을 확인하세요.", "ok");
    } catch (err) {
      setAuthMessage(authErrorMessage(err), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function openAuthDialog(mode = "member") {
    authState.mode = AUTH_MODES[mode] ? mode : "member";
    const meta = AUTH_MODES[authState.mode];
    fillSupabaseConfigFields();
    $("#auth-title").textContent = meta.title;
    $("#auth-submit").textContent = meta.submit;
    $("#auth-display-name-row").style.display = meta.showName ? "grid" : "none";
    $("#btn-forgot-password").hidden = authState.mode === "signup";
    $("#auth-password").autocomplete = meta.showName ? "new-password" : "current-password";
    applyConnectionChrome();
    setAuthMessage(isSupabaseConfigured()
      ? meta.message
      : isDevMode() ? `${meta.message} 먼저 Supabase 연결 정보를 저장하세요.` : "이 주소에서는 회원 기능을 쓸 수 없어요.");
    const dlg = $("#dlg-auth");
    if (!dlg.open) dlg.showModal();
    setTimeout(() => {
      const target = isSupabaseConfigured() || !isDevMode() ? $("#auth-email") : $("#supabase-url");
      target && target.focus();
    }, 0);
  }

  async function handleAuthSubmit() {
    const mode = authState.mode;
    const meta = AUTH_MODES[mode] || AUTH_MODES.member;
    if (!isSupabaseConfigured()) {
      if (!isDevMode()) { setAuthMessage("이 주소에서는 회원 기능을 쓸 수 없어요.", "error"); return; }
      const saved = await saveSupabaseConfigFromDialog();
      if (!saved) return;
    }
    const email = ($("#auth-email").value || "").trim();
    const password = $("#auth-password").value || "";
    const displayName = ($("#auth-display-name").value || "").trim();
    if (!email || !password) {
      setAuthMessage("이메일과 비밀번호를 입력하세요.", "error");
      return;
    }
    if (password.length < 6) {
      setAuthMessage("비밀번호는 6자 이상이어야 합니다.", "error");
      return;
    }
    setAuthBusy(true);
    try {
      const client = getSupabaseClient();
      if (mode === "signup") {
        const options = { data: { display_name: displayName } };
        if (location.protocol === "http:" || location.protocol === "https:") {
          options.emailRedirectTo = location.href.split("#")[0];
        }
        const { data, error } = await client.auth.signUp({ email, password, options });
        if (error) throw error;
        if (data.session && data.user) {
          await ensureOwnProfile(data.user, displayName);
          authState.session = data.session;
          authState.profile = await loadAuthProfile(data.user);
          updateAuthChrome();
          $("#dlg-auth").close();
          toast("회원가입 완료. 로그인했어요");
        } else {
          setAuthMessage("회원가입 요청이 완료됐어요. 이메일 인증이 켜져 있다면 받은 편지함에서 확인 링크를 눌러주세요.", "ok");
        }
        return;
      }

      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) await ensureOwnProfile(data.user);
      authState.session = data.session || null;
      authState.profile = data.user ? await loadAuthProfile(data.user) : null;

      updateAuthChrome();
      $("#dlg-auth").close();
      toast("회원 로그인 완료");
    } catch (err) {
      setAuthMessage(authErrorMessage(err), "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutAuth() {
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) return;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
      toast("로그아웃했어요");
    } catch (err) {
      toast(authErrorMessage(err));
    }
  }

  // ───────── P8-4d 회원 탈퇴 ─────────
  // 레슨 앱과 Supabase 프로젝트를 나누기 전(D1)에는 사용자를 지우면 레슨 앱 데이터까지 지워질 수 있다. 그래서 js/config.js의
  // SF_FEATURES.deleteAccount가 true가 되기 전에는 버튼도 숨기고 deleteAccount()도 아무 요청 없이 돌아온다.
  // 플래그는 그 파일(또는 배포·시험이 먼저 정한 값)에서만 읽는다 — 주소·localStorage로는 켜지지 않는다.
  // 절차: 비밀번호 다시 입력 → "탈퇴" 입력 → Edge Function 호출(비밀번호로 확인한 계정의 토큰에 고정) → 이 기기 로그아웃 → 이 계정의 저장 대기 작업만 삭제.
  const DELETE_WORDS = ["탈퇴", "delete"];   // 영어 화면에서도 쓸 수 있게 DELETE도 받는다
  function deleteEnabled() {
    const flags = window.SF_FEATURES;
    return Boolean(flags && flags.deleteAccount === true);
  }
  function deleteErrorMessage(err) {
    const status = Number(err && err.context && err.context.status);
    if (err && err.name === "FunctionsHttpError") {
      if (status === 401) return "로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.";
      if (status === 403) return "이 주소에서는 탈퇴를 처리할 수 없어요.";
      if (status === 404) return "탈퇴 기능을 아직 쓸 수 없어요.";
      if (status === 429) return "요청이 너무 잦아요. 잠시 뒤에 다시 시도하세요.";
    }
    if ((err && err.name === "FunctionsFetchError") || /failed to fetch|networkerror|load failed|network request failed/i.test(String((err && err.message) || ""))) {
      return "네트워크에 연결하지 못했어요. 탈퇴가 처리됐는지 확인하지 못했어요. 잠시 뒤 다시 로그인해 확인해 주세요.";
    }
    return "탈퇴를 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.";   // 서버가 준 문장은 보이지 않는다
  }
  const isWrongPassword = err => /invalid_credentials/i.test(String((err && err.code) || "")) || /invalid login credentials/i.test(String((err && err.message) || ""));
  // 비밀번호를 다시 입력받아 지금 계정의 비밀번호인지 확인한다(최대 3번). 확인되면 { session }, 그만두거나 실패하면 { reason }.
  async function reauthenticate(client, user) {
    let problem = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const password = await SF.ui.promptDialog({
        title: "회원 탈퇴",
        message: problem || "계정과 클라우드에 저장한 악보가 모두 지워지고 되돌릴 수 없어요. 계속하려면 비밀번호를 입력하세요.",
        label: "비밀번호",
        type: "password",
        autocomplete: "current-password",
        danger: true,
        confirmText: "다음",
        validate: value => (value ? "" : "비밀번호를 입력하세요."),
      });
      if (password === null) return { reason: "cancelled" };
      const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
      if (!error) return { session: data && data.session };
      if (!isWrongPassword(error)) return { reason: "error", message: authErrorMessage(error) };
      problem = "비밀번호가 맞지 않아요. 다시 입력하세요.";
    }
    return { reason: "password" };
  }
  let deleteRunning = false;
  async function deleteAccount() {
    if (!deleteEnabled()) return { ok: false, reason: "disabled" };
    if (deleteRunning) return { ok: false, reason: "busy" };
    const user = authState.session && authState.session.user;
    const client = getSupabaseClient({ requireConfig: false });
    if (!client || !user || !user.id || !user.email) {
      toast("로그인한 뒤에 탈퇴할 수 있어요.");
      return { ok: false, reason: "signed-out" };
    }
    if (!SF.ui || typeof SF.ui.promptDialog !== "function") return { ok: false, reason: "unavailable" };
    deleteRunning = true;
    try {
      let verified;
      try {
        const checked = await reauthenticate(client, user);
        if (checked.reason === "cancelled") { toast("탈퇴를 취소했어요."); return { ok: false, reason: "cancelled" }; }
        if (checked.reason === "password") { longToast("비밀번호가 맞지 않아 탈퇴를 진행하지 못했어요."); return { ok: false, reason: "password" }; }
        if (checked.reason) { longToast(checked.message); return { ok: false, reason: "error" }; }
        verified = checked.session;
        if (!verified || !verified.access_token || !verified.user || verified.user.id !== user.id) {
          longToast("로그인한 계정이 바뀌었어요. 탈퇴를 진행하지 않았어요. 다시 시도해 주세요.");
          return { ok: false, reason: "account-changed" };
        }
        const word = await SF.ui.promptDialog({
          title: "정말 탈퇴할까요?",
          message: '되돌릴 수 없어요. 계속하려면 아래 칸에 "탈퇴"라고 입력하세요.',
          label: "확인 문구",
          autocomplete: "off",
          danger: true,
          confirmText: "회원 탈퇴",
          validate: value => (DELETE_WORDS.includes(String(value).trim().toLowerCase()) ? "" : '"탈퇴"를 그대로 입력하세요.'),
        });
        if (word === null) { toast("탈퇴를 취소했어요."); return { ok: false, reason: "cancelled" }; }
      } catch (err) {
        longToast(deleteErrorMessage(err));
        return { ok: false, reason: "error" };
      }
      // 요청은 방금 비밀번호로 확인한 계정의 토큰으로 보낸다. 그 사이 다른 탭이 로그인을 바꿔도 다른 계정을 지우지 않는다.
      let response;
      try {
        response = await client.functions.invoke("delete-account", { method: "POST", headers: { Authorization: `Bearer ${verified.access_token}` } });
      } catch (err) {
        response = { error: err };
      }
      if (response && response.error) {
        longToast(deleteErrorMessage(response.error));
        return { ok: false, reason: "error" };
      }
      // 서버에서는 이미 지워졌다. 이 기기의 흔적을 정리한다 — 한 단계가 실패해도 나머지는 계속한다.
      try { await client.auth.signOut({ scope: "local" }); } catch {}
      try { if (SF.cloud && typeof SF.cloud.purgeOwner === "function") SF.cloud.purgeOwner(user.id); } catch {}
      authState.session = null;
      authState.profile = null;
      updateAuthChrome();
      longToast("탈퇴가 끝났어요. 이 기기의 로컬 악보는 그대로 남아 있어요.");
      return { ok: true };
    } finally {
      deleteRunning = false;
    }
  }

  function formatAdminDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString(SF.i18n?.getLanguage() === "en" ? "en-US" : "ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(value);
    }
  }

  async function openAdminPage() {
    const needAdmin = () => {
      openAuthDialog("member");
      setAuthMessage("관리자 권한이 필요합니다. 관리자 계정으로 다시 로그인하세요.", "error");
    };
    const client = getSupabaseClient({ requireConfig: false });
    if (!client || !authState.session || !authState.session.user) { needAdmin(); return; }
    authState.profile = await loadAuthProfile(authState.session.user);
    updateAuthChrome();
    if (!isAdminProfile(authState.profile)) { needAdmin(); return; }
    const dlg = $("#dlg-admin");
    if (!dlg.open) dlg.showModal();
    renderAdminPage();
  }

  async function renderAdminPage() {
    const profile = authState.profile || {};
    const user = authState.session && authState.session.user;
    const score = C.state.score;
    $("#admin-summary").innerHTML = [
      ["계정", user && user.email ? user.email : profile.email || "-"],
      ["권한", profile.role || "member"],
      ["현재 악보", SF.t ? SF.t("a11y.scoreSummary", { title: score.meta.title || "제목 없음", measures: score.measures.length }) : `${score.meta.title || "제목 없음"} · ${score.measures.length}마디`],
    ].map(([label, value]) => `<div class="admin-stat"><span>${htmlEsc(label)}</span><b>${htmlEsc(value)}</b></div>`).join("");

    const usersHost = $("#admin-users");
    usersHost.innerHTML = `<div class="admin-empty">회원 목록을 불러오는 중입니다.</div>`;
    const client = getSupabaseClient({ requireConfig: false });
    if (!client || !isAdminProfile(profile)) {
      usersHost.innerHTML = `<div class="admin-empty">관리자 권한이 확인되지 않았습니다.</div>`;
      return;
    }
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id,email,display_name,role,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!data || !data.length) {
        usersHost.innerHTML = `<div class="admin-empty">표시할 회원 프로필이 없습니다.</div>`;
        return;
      }
      let counts = {};
      if (SF.cloud?.countByOwner) {
        try { counts = await SF.cloud.countByOwner(data.map(row => row.id)); }
        catch { /* The score migration may not be installed on a custom project. */ }
      }
      usersHost.innerHTML = `<table>
        <thead><tr><th>이메일</th><th>이름</th><th>권한</th><th>악보 수</th><th>가입일</th></tr></thead>
        <tbody>
          ${data.map((row) => `<tr>
            <td>${htmlEsc(row.email || "-")}</td>
            <td>${htmlEsc(row.display_name || "-")}</td>
            <td><span class="admin-badge ${row.role === "admin" ? "role-admin" : ""}">${htmlEsc(row.role || "member")}</span></td>
            <td>${htmlEsc(counts[row.id] ?? "-")}</td>
            <td>${htmlEsc(formatAdminDate(row.created_at) || "-")}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    } catch (err) {
      usersHost.innerHTML = `<div class="admin-empty">회원 목록을 불러오지 못했어요. ${htmlEsc(authErrorMessage(err))}</div>`;
    }
  }

  function bindAuth() {
    $("#btn-signup").addEventListener("click", () => openAuthDialog("signup"));
    $("#btn-member-login").addEventListener("click", () => openAuthDialog("member"));
    $("#btn-admin-page").addEventListener("click", openAdminPage);
    $("#btn-logout").addEventListener("click", signOutAuth);
    $("#btn-delete-account").addEventListener("click", () => { deleteAccount(); });
    $("#btn-save-supabase-config").addEventListener("click", saveSupabaseConfigFromDialog);
    $("#btn-clear-supabase-config").addEventListener("click", clearSupabaseConfig);
    $("#btn-reset-default-connection").addEventListener("click", useDefaultConnection);
    $("#btn-forgot-password").addEventListener("click", requestPasswordReset);
    $("#auth-submit").addEventListener("click", handleAuthSubmit);
    $("#btn-admin-refresh").addEventListener("click", renderAdminPage);
    ["#auth-display-name", "#auth-email", "#auth-password", "#supabase-url", "#supabase-key"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAuthSubmit();
        }
      });
    });
    $("#dlg-auth").addEventListener("close", () => {
      $("#auth-password").value = "";
      setAuthBusy(false);
    });
    initSupabaseAuth({ quiet: true });
    handleRecoveryReturn();
  }

  function isPublicKey(key) {
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
    try {
      const encoded = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).role === "anon";
    } catch { return false; }
  }
  SF.auth = { state: authState, getClient: getSupabaseClient, openDialog: openAuthDialog, bindAuth, init: initSupabaseAuth, renderAdminPage, isPublicKey,
    isDevMode, devModeFrom, hasCustomConnection, customConnectionFrom,
    errorMessage: authErrorMessage, recoveryRedirectFrom, recoveryReturnFrom,
    deleteAccount, deleteEnabled, deleteErrorMessage };
})(window.SF);
