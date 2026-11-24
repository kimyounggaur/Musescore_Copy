// 회원 탈퇴 Edge Function의 본체(P8-4d).
//
// ⚠️ 이 함수는 사용자 계정을 지운다. ScoreForge는 아직 레슨 앱과 같은 Supabase 프로젝트·profiles 표를 쓰므로
//    (결정 D1 = 분리, 실제 분리는 사람 작업 8-5) 분리가 끝나기 전에는 배포하지 않는다 — README.md 참고.
//
// 설계: createClient를 주입받아 Node 시험(tests/delete-account.test.mjs)에서 가짜로 바꿔 끼울 수 있게 했다.
// 타입 표기만 쓴다(enum·namespace 같은 실행되는 TS 문법 금지) — Node의 타입 지우기로도 읽혀야 한다.

export type Deps = {
  env: (name: string) => string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClient: (url: string, key: string, options?: any) => any;
  log?: (message: string) => void;
};

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

export function createHandler({ env, createClient, log = console.error }: Deps) {
  // 허용 출처 목록(쉼표로 구분, 비밀값 ALLOWED_ORIGINS). 비어 있으면 브라우저 요청은 모두 거절한다 — 닫힌 채로 시작.
  const allowed = new Set((env("ALLOWED_ORIGINS") ?? "").split(",").map(item => item.trim()).filter(Boolean));

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin");
    const cors: Record<string, string> = origin && allowed.has(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": ALLOWED_HEADERS, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "600", Vary: "Origin" }
      : { Vary: "Origin" };
    const json = (status: number, body: Record<string, string>, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, "Content-Type": "application/json" } });

    try {
      // 브라우저가 보낸 요청(Origin 있음)은 허용 목록에 있어야 한다. Origin이 없는 호출(서버·curl)은 아래 JWT 확인만 거친다.
      if (origin && !allowed.has(origin)) return json(403, { error: "origin_not_allowed" });
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });

      const authorization = req.headers.get("Authorization") ?? "";
      const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) return json(401, { error: "unauthorized" });

      const url = env("SUPABASE_URL");
      const anonKey = env("SUPABASE_ANON_KEY");
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
      const missing = [["SUPABASE_URL", url], ["SUPABASE_ANON_KEY", anonKey], ["SUPABASE_SERVICE_ROLE_KEY", serviceKey]].filter(([, value]) => !value).map(([name]) => name);
      if (missing.length) {
        log(`delete-account: 환경 값이 없어요: ${missing.join(", ")}`);
        return json(500, { error: "server_not_configured" });
      }

      // 1) 요청자의 JWT로 "누구인지" 확인한다. 지울 대상은 오직 이 사용자이고, 본문·주소로 받은 id는 보지 않는다.
      const asUser = createClient(url!, anonKey!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await asUser.auth.getUser(token);
      const user = data?.user;
      if (error || !user) return json(401, { error: "unauthorized" });

      // 2) 서비스 키는 이 줄에서만 쓴다(Supabase가 환경에 넣어 주는 값 — 파일·로그·응답에 남기지 않는다).
      const admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError) {
        log(`delete-account: 삭제 실패 user=${user.id}: ${deleteError.message}`);
        return json(500, { error: "delete_failed" });
      }
      return new Response(null, { status: 204, headers: cors });
    } catch (error) {
      log(`delete-account: 예외 ${error instanceof Error ? error.name : "error"}`);
      return json(500, { error: "internal" });
    }
  };
}
