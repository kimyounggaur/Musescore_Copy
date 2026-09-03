/* Dependencies: SF.core, SF.app (runtime). */
"use strict";
(function(SF) {
  const C = SF.core;
  const $ = selector => document.querySelector(selector);
  const toast = message => SF.app.toast(message);
  const htmlEsc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SUPABASE_URL_KEY = "scoreforge.supabase.url";
  const SUPABASE_KEY_KEY = "scoreforge.supabase.publishableKey";
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
    admin: {
      title: "관리자 로그인",
      submit: "관리자 로그인",
      message: "관리자 페이지는 profiles.role 값이 admin인 계정만 열 수 있어요.",
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

  function readSupabaseConfig() {
    const embedded = window.SF_SUPABASE_CONFIG || {};
    let url = "";
    let publishableKey = "";
    try {
      url = localStorage.getItem(SUPABASE_URL_KEY) || "";
      publishableKey = localStorage.getItem(SUPABASE_KEY_KEY) || "";
    } catch {}
    url = url || embedded.url || embedded.supabaseUrl || "";
    publishableKey = publishableKey || embedded.publishableKey || embedded.anonKey || embedded.key || "";
    return {
      url: String(url || "").trim().replace(/\/+$/, ""),
      publishableKey: String(publishableKey || "").trim(),
    };
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
      const { data } = authState.client.auth.onAuthStateChange((_event, session) => {
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
    if (/invalid login credentials/i.test(raw)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (/email not confirmed/i.test(raw)) return "이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인하세요.";
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

  async function clearSupabaseConfig() {
    const client = getSupabaseClient({ requireConfig: false });
    try {
      if (client) await client.auth.signOut();
      localStorage.removeItem(SUPABASE_URL_KEY);
      localStorage.removeItem(SUPABASE_KEY_KEY);
    } catch {}
    authState.client = null;
    authState.configSig = "";
    authState.session = null;
    authState.profile = null;
    fillSupabaseConfigFields();
    updateAuthChrome();
    setAuthMessage("Supabase 연결 설정을 초기화했어요.", "ok");
  }

  async function initSupabaseAuth(opts = {}) {
    fillSupabaseConfigFields();
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
    const adminLogin = $("#btn-admin-login");
    const adminPage = $("#btn-admin-page");
    const logout = $("#btn-logout");
    if (signup) signup.hidden = signedIn;
    if (memberLogin) memberLogin.hidden = signedIn;
    if (adminLogin) adminLogin.hidden = signedIn && admin;
    if (adminPage) adminPage.classList.toggle("on", admin);
    if (logout) logout.hidden = !signedIn;
    window.dispatchEvent(new CustomEvent("scoreforge:auth", { detail: { userId: authState.session?.user?.id || null } }));
    if (SF.cloud?.state.initialized) SF.cloud.onAuthChanged();
  }

  function openAuthDialog(mode = "member") {
    authState.mode = AUTH_MODES[mode] ? mode : "member";
    const meta = AUTH_MODES[authState.mode];
    fillSupabaseConfigFields();
    $("#auth-title").textContent = meta.title;
    $("#auth-submit").textContent = meta.submit;
    $("#auth-display-name-row").style.display = meta.showName ? "grid" : "none";
    $("#auth-password").autocomplete = meta.showName ? "new-password" : "current-password";
    setAuthMessage(isSupabaseConfigured() ? meta.message : `${meta.message} 먼저 Supabase 연결 정보를 저장하세요.`);
    const dlg = $("#dlg-auth");
    if (!dlg.open) dlg.showModal();
    setTimeout(() => {
      const target = isSupabaseConfigured() ? $("#auth-email") : $("#supabase-url");
      target && target.focus();
    }, 0);
  }

  async function handleAuthSubmit() {
    const mode = authState.mode;
    const meta = AUTH_MODES[mode] || AUTH_MODES.member;
    if (!isSupabaseConfigured()) {
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

      if (mode === "admin" && !isAdminProfile(authState.profile)) {
        const profileError = authState.profile && authState.profile.profileError;
        await client.auth.signOut();
        authState.session = null;
        authState.profile = null;
        updateAuthChrome();
        const msg = profileError
          ? "profiles 테이블 또는 RLS 설정을 확인해야 합니다."
          : "관리자 권한이 없습니다. Supabase SQL Editor에서 해당 계정의 role을 admin으로 승격하세요.";
        setAuthMessage(msg, "error");
        return;
      }

      updateAuthChrome();
      $("#dlg-auth").close();
      toast(mode === "admin" ? "관리자로 로그인했어요" : "회원 로그인 완료");
      if (mode === "admin") openAdminPage();
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
    const client = getSupabaseClient({ requireConfig: false });
    if (!client) {
      openAuthDialog("admin");
      setAuthMessage("Supabase 연결 정보를 먼저 저장하세요.", "error");
      return;
    }
    if (!authState.session || !authState.session.user) {
      openAuthDialog("admin");
      return;
    }
    authState.profile = await loadAuthProfile(authState.session.user);
    updateAuthChrome();
    if (!isAdminProfile(authState.profile)) {
      openAuthDialog("admin");
      setAuthMessage("관리자 권한이 필요합니다. 관리자 계정으로 다시 로그인하세요.", "error");
      return;
    }
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
    $("#btn-admin-login").addEventListener("click", () => openAuthDialog("admin"));
    $("#btn-admin-page").addEventListener("click", openAdminPage);
    $("#btn-logout").addEventListener("click", signOutAuth);
    $("#btn-save-supabase-config").addEventListener("click", saveSupabaseConfigFromDialog);
    $("#btn-clear-supabase-config").addEventListener("click", clearSupabaseConfig);
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
  }

  function isPublicKey(key) {
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
    try {
      const encoded = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).role === "anon";
    } catch { return false; }
  }
  SF.auth = { state: authState, getClient: getSupabaseClient, openDialog: openAuthDialog, bindAuth, init: initSupabaseAuth, renderAdminPage, isPublicKey };
})(window.SF);
