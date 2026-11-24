// 회원 탈퇴 Edge Function 진입점(P8-4d). 논리는 handler.ts에 있고, 여기서는 실제 클라이언트와 환경을 이어 준다.
// ⚠️ 결정 D1(Supabase 프로젝트 분리)이 끝나기 전에는 배포하지 않는다 — 같은 프로젝트를 쓰는 레슨 앱의 데이터까지 연쇄 삭제될 수 있다.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({ env: name => Deno.env.get(name), createClient }));
