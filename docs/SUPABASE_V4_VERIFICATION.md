# Supabase v4 검증 기록 — 회원별 저장 한도 · 관리자 열람 축소 · 프로젝트 분리(D1)

> **상태: 틀(template).** "사람 실행" 칸은 비어 있다. 에이전트(Claude)는 운영·스테이징 Supabase에 접속하거나 SQL을 실행하지 않았다(연결 도구가 있어도 쓰지 않았다).
> "에이전트 로컬 실행" 칸은 같은 SQL 파일을 **일회용 로컬 PostgreSQL 16**에서 실행한 결과다(2026-11-24, `tests/supabase-sql.test.mjs`).
> 로컬 PostgreSQL은 PostgREST·Auth·Security Advisor가 없는 순수 Postgres라서 **Supabase 위의 검증을 대신하지 않는다.** 아래 표의 "사람 실행" 칸은 사람이 직접 채운다.

대상 SQL: [`scoreforge_v4.sql`](../supabase/scoreforge_v4.sql) (되돌리기: [`scoreforge_v4_rollback.sql`](../supabase/scoreforge_v4_rollback.sql))
결정(docs/DECISIONS.md): D1 = 프로젝트 분리 · D4a = 운영 · D4b = 관리자는 다른 회원의 악보를 **열람 불가**(회원별 악보 개수 집계만)

| 기록 | 값 |
|---|---|
| 적용 환경(스테이징/새 프로젝트 이름) | ______ |
| 적용한 사람 · 날짜 | ______ |
| 적용 직전 v3 상태 확인(아래 4-1) | ☐ |
| Dashboard Security Advisor | ______ |

## 1. 무엇이 바뀌나

| 항목 | v3 | v4 |
|---|---|---|
| 회원당 악보 수 | 제한 없음 | 200개 (201번째 저장은 `SCOREFORGE_QUOTA_COUNT`로 거절) |
| 회원당 악보 데이터 합계 | 제한 없음(행마다 2MB 미만만) | 50 MiB (`octet_length(data::text)` 합계, 넘으면 `SCOREFORGE_QUOTA_BYTES`) |
| 이름 바꾸기 · 공유 켜기/끄기 | — | 한도를 따지지 않는다(`data`를 바꾸지 않는 갱신) |
| 관리자가 다른 회원의 악보 읽기 | 가능 | **불가** — 관리자 페이지는 회원별 **개수**만 본다 |
| 회원별 개수 함수 | RLS를 거치는 호출자 함수 | 호출자 함수가 private 정의자 함수를 부름(일반 회원은 자기 개수만, 관리자는 전체 개수, 익명 불가) |
| 같은 DB의 다른 앱(레슨 앱) | — | 건드리지 않는다(4-2에서 전·후 지문이 같은지 확인) |

동시에 같은 회원이 저장해도 한도를 넘지 않도록 회원별 어드바이저리 잠금을 쓴다(잠금 키는 두 개짜리라서 다른 앱의 잠금과 겹치지 않는다).

## 2. 적용 순서 (사람) — 새 프로젝트(D1)

SQL Editor에서 **DB 소유자(보통 postgres)** 로 한 파일씩 실행한다. v4는 여러 번 실행해도 같은 상태가 된다(멱등).

1. 새 프로젝트 만들기(지역은 사용자와 가까운 곳). DB 비밀번호는 비밀번호 관리자에 둔다.
2. `supabase/scoreforge_auth.sql` → `supabase/scoreforge_scores.sql`. (`scoreforge_profile_compat.sql`은 새 프로젝트에서는 필요 없지만 실행해도 안전하다. 로컬에서 compat 없이 auth → scores → v4 → `scores_rls.sql`이 통과하는 것을 확인했다.)
3. **(회원·악보를 옮기는 경우) 여기서 옮긴다.** 한도 트리거는 INSERT에도 걸리므로, 옮기는 작업은 v4 **전에** 한다. 옮긴 뒤 한도를 넘는 회원이 있는지 본다:
   ```sql
   select owner, count(*) as scores, sum(octet_length(data::text)) as bytes
   from public.scores group by owner
   having count(*) > 200 or sum(octet_length(data::text)) > 50 * 1024 * 1024;
   ```
   결과가 있으면 그 회원에게 정리를 안내하거나 한도를 다시 상의한다. 한도를 넘은 회원의 기존 악보는 그대로 남고 읽을 수 있다. 개수만 넘은 회원은 새 악보를 만들 수 없지만 기존 악보는 고칠 수 있고, 용량이 넘은 회원은 어떤 악보의 `data`도 바꿀 수 없다(줄이는 저장도 막힌다). 이름 바꾸기·공유 켜기/끄기·삭제는 늘 된다(9장).
4. v3 상태의 지문을 기록한다(4-1·4-2).
5. `supabase/scoreforge_v4.sql` 실행 → 오류 없이 끝나는지 확인.
6. `supabase/tests/scores_rls.sql` 실행 → 마지막 결과가 `PASS: …` 한 줄이면 통과(시험 데이터는 ROLLBACK되어 남지 않는다).
7. v4 상태의 지문을 기록한다(4-1·4-2). 4-2는 전·후가 같아야 한다.
8. (스테이징) `supabase/tests/quota_cost.sql` 실행 → 오류 문구의 숫자를 6장에 기록.
9. 5장 표의 "사람 실행" 칸을 채운다.

기존 프로젝트(레슨 앱과 같이 쓰는 곳)에 v4를 먼저 적용할지는 사람이 정한다. 분리 전까지 관리자 열람을 닫고 싶으면 적용하고(롤백 가능), 곧 이전할 거면 건너뛴다.

> **v3 SQL(`scoreforge_scores.sql`)을 v4 뒤에 다시 실행했다면** 관리자 열람 정책이 되살아난다. 이어서 `scoreforge_v4.sql`을 다시 실행하고 `scores_rls.sql`로 확인한다.

## 3. 되돌리기

`supabase/scoreforge_v4_rollback.sql`을 실행하면 v3 상태로 돌아간다: 한도 트리거·함수 제거, 선택 정책에 관리자 조건 복원, 개수 함수 v3 본문 복원, private 개수 함수 제거. **되돌리면 관리자가 다른 회원의 악보를 다시 읽을 수 있다.** 로컬에서 롤백 뒤 지문이 v3와 같은 것을 확인했다(4-1). 되돌린 뒤 `supabase/tests/scores_rls.sql`은 일부러 실패한다(관리자 열람 기대가 반대이므로) — 이것이 되돌렸다는 증거다.

## 4. 확인 쿼리

### 4-1. ScoreForge 객체 지문 — v3 상태, v4 적용 후, (되돌렸다면) 롤백 후에 각각 실행해 기록
`supabase/tests/scoreforge_fingerprint.sql` (읽기 전용). 결과 첫 값은 요약(md5), 뒤는 자세한 목록이다.
기대: v3 ≠ v4, 롤백 후 = v3.

| 시점 | md5 요약 | 기록한 사람 · 날짜 |
|---|---|---|
| v3 | ______ | |
| v4 적용 후 | ______ | |
| 롤백 후(해당 시) | ______ | |

### 4-2. 다른 앱(레슨 앱) 객체 지문 — **전·후가 반드시 같아야 한다**
`supabase/tests/other_apps_fingerprint.sql` (읽기 전용). ScoreForge가 만든 객체를 뺀 public·private의 표·정책·함수·트리거를 요약한다.

| 시점 | md5 요약 | 같음? |
|---|---|---|
| v4 적용 전 | ______ | |
| v4 적용 후 | ______ | ☐ |

### 4-3. 권한 한 줄 확인
```sql
select
  has_table_privilege('anon', 'public.scores', 'SELECT') as anon_select,                                   -- false
  has_function_privilege('anon', 'public.count_scoreforge_scores_by_owner(uuid[])', 'EXECUTE') as anon_count, -- false
  has_function_privilege('authenticated', 'private.scoreforge_enforce_quota()', 'EXECUTE') as member_quota_fn; -- false

select policyname, cmd, roles, qual from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'scores' and policyname = 'scoreforge_scores_select';
-- qual에 is_admin이 없어야 한다(소유자만).
```

## 5. 결과 기록표

| # | 확인 항목 | 기대 | 에이전트 로컬 PostgreSQL 16 | 사람 실행(날짜 · 결과) |
|---|---|---|---|---|
| 1 | v3에서 새 시험이 실패한다(대조군) | "관리자가 남의 악보를 읽음"으로 실패 | ✅ | |
| 2 | v4 적용 후 `scores_rls.sql` | `PASS: …` | ✅ | ☐ |
| 3 | v4를 한 번 더 적용해도 같은 상태 | 지문 같음 | ✅ | ☐ |
| 4 | 롤백 → v3와 같은 지문, 관리자 열람 복귀 | 지문 같음 | ✅ | ☐(선택) |
| 5 | 롤백 뒤 v4 재적용 = 처음 v4 | 지문 같음 | ✅ | ☐(선택) |
| 6 | 다른 앱 객체 지문 전·후 동일 | 같음 | ✅ (시험용 가짜 레슨 앱 객체) | ☐ **실제 레슨 앱 객체로** |
| 7 | 낯선 정책이 있으면 v4가 아무것도 바꾸지 않고 멈춤 | 안내 문구 + 상태 그대로 | ✅ | ☐ |
| 8 | 악보 200개 경계: 200번째 성공, 201번째 거절 | `SCOREFORGE_QUOTA_COUNT` | ✅ | ☐ |
| 9 | 50 MiB 경계: 정확히 50 MiB 성공, +1바이트 거절 | `SCOREFORGE_QUOTA_BYTES` | ✅ | ☐ |
| 10 | 한도에서도 이름 바꾸기 · 공유 켜기/끄기 · 삭제 가능 | 성공 | ✅ | ☐ |
| 11 | 같은 회원이 199개일 때 동시에 2건 저장 | 정확히 1건만 성공 | ✅ (세션 2개) | ☐ |
| 12 | 한도는 회원마다 따로 센다 | 다른 회원 악보 합산 안 함 | ✅ | ☐ |
| 13 | 관리자: 남의 악보 조회·수정·삭제 불가, 자기 악보는 가능 | 불가 | ✅ | ☐ |
| 14 | 관리자: 회원별 개수 집계(100명까지) 가능, 101명은 빈 결과 | 가능 | ✅ | ☐ |
| 15 | 일반 회원 집계는 자기 것만, 익명은 집계·표 직접 조회 불가 | 자기 것만 | ✅ | ☐ |
| 16 | PostgREST로 실제 API 호출해도 같은 결과(예: 앱에서 로그인 후 저장·목록·공유) | 같음 | ⛔ 해당 없음(PostgREST 없음) | ☐ |
| 17 | 한도 초과 때 앱 안내(실제 서버에서 200개 만들기는 `quota_cost.sql`로 대신 가능) | "악보 저장 한도(200개·50MB)…" 알림, 상태 줄 "클라우드 저장 한도 도달", 자동 저장 중지 | ◐ 앱 쪽 동작은 노드 시험 6건(`tests/cloud.test.mjs`)으로 확인, 실제 서버 응답 모양은 아님 | ☐ |
| 18 | 관리자 페이지의 회원별 악보 수가 정상으로 보임(F12) | 숫자 표시 | ⛔ | ☐ |
| 19 | Security Advisor: 새 함수·정책에 대한 경고 없음 | 경고 없음 | ⛔ 해당 없음 | ☐ |
| 20 | 레슨 앱이 평소처럼 동작(같은 프로젝트를 쓰는 동안) | 이상 없음 | ⛔ | ☐ |

범례: ✅ 통과 · ◐ 일부만 · ⛔ 이 환경에서는 확인할 수 없음 · ☐ 사람이 확인할 칸

## 6. 한도 트리거 비용 (저장마다 그 회원의 모든 행 크기를 합산한다)

에이전트 로컬 PostgreSQL 16.15(작은 임시 서버, 네트워크 없음)에서 한 회원이 악보를 가진 상태로 잰 값. 거의 압축되지 않는 글자를 써서 실제 악보 JSON보다 불리하게 잡았다.

| 경우 | 마지막(200번째) 저장 | `data` 고쳐 쓰기(한도 직전) | 이름만 바꾸기 |
|---|---|---|---|
| 최악: 200개 × 약 249,000자(합계 약 50MB) | 66.0 ms | 105.0 ms | 1.09 ms |
| 무거운 편: 200개 × 40,000자(합계 약 8MB) | 12.8 ms | 14.5 ms | 0.47 ms |
| 보통: 200개 × 5,000자(합계 약 1MB) | 1.8 ms | 2.1 ms | 0.27 ms |

최악의 경우에 199개를 채우는 데 걸린 전체 시간은 8.9초(저장당 평균 45 ms)다. 판단 기준은 1초 — 넘으면 사람과 상의한다(대안: 행 크기 열을 추가해 합산을 없앰. 스키마 변경이라 이번 단계에는 넣지 않았다).
Supabase 서버는 이 환경과 다르므로 스테이징에서 `supabase/tests/quota_cost.sql`로 다시 잰다.

| 환경 | 마지막 저장(ms) | data 고쳐 쓰기(ms) | 이름만(ms) | 기록 |
|---|---|---|---|---|
| 스테이징/새 프로젝트 | ______ | ______ | ______ | |

## 7. 프로젝트 분리(D1) 체크리스트 — 설계서 8-5 (a) 1~6단계

- [ ] 1. 새 프로젝트 만들기 → 2장의 순서대로 SQL 적용
- [ ] 2. 이전 규모 확인(구 프로젝트): `select count(*), count(distinct owner) from public.scores;` → 회원 ___명 · 악보 ___개
- [ ] 3. 이전 방식 결정·공지: 회원이 적으면 공지 + 각자 악보를 로컬 파일로 내려받은 뒤 새 프로젝트에서 다시 가입 / 많으면 인증 사용자를 포함해 옮김(Supabase 공식 마이그레이션 가이드; 비밀번호 해시를 유지할 수 있는지 먼저 확인). 이 앱에는 "모두 내려받기" 기능이 없다 — 회원 수에 따라 필요한지 결정한다.
- [ ] 4. 앱 설정을 새 프로젝트로 바꾸기(아래 명령 → 커밋 → 배포)
  ```bash
  node tests/switch-supabase-project.mjs --url https://<새 ref>.supabase.co --key sb_publishable_… --dry-run   # 먼저 미리보기
  node tests/switch-supabase-project.mjs --url https://<새 ref>.supabase.co --key sb_publishable_…
  npm run release        # sw.js 해시 등 릴리스 파일을 다시 만든다(같이 커밋)
  ```
  도구는 `js/config.js`의 주소·공개 키와 `vercel.json` CSP의 supabase 주소(와일드카드 → 새 프로젝트 하나)만 바꾸고, 비밀 키(`sb_secret_…`·service_role)는 거절한다. **비밀 키를 어디에도 적지 않는다.**
  CSP가 한 프로젝트로 좁혀지므로 개발 모드의 "사용자 지정 연결"로 다른 프로젝트에 붙는 것은 배포본에서 막힌다(의도된 동작; 로컬 개발 서버는 CSP 헤더가 없어 그대로 된다).
- [ ] 5. 새 프로젝트의 Auth 설정을 다시 한다: URL Configuration(배포 주소·로컬 주소), 이메일 문구(비밀번호 재설정 포함), 비밀번호 정책(아래 8장)
- [ ] 6. 탈퇴 기능: 새 프로젝트에 `supabase/functions/delete-account`를 배포하고 `ALLOWED_ORIGINS`를 정한 뒤(절차: [`delete-account/README.md`](../supabase/functions/delete-account/README.md)), 4번 명령에 `--enable-delete-account`를 더해 플래그를 켜고 커밋·배포. **Edge Function 배포 전에는 켜지 않는다.** 저장소의 시험은 "플래그가 켜져 있으면 CSP가 새 프로젝트 하나로 좁혀져 있어야 한다"(D1 규칙)를 확인하므로, 전환 도구로 켜면 그대로 통과하고 `js/config.js`만 손으로 켜면 막힌다. 확인: 시험 계정으로 탈퇴 → 관련 행 0건(설계서 Phase 8 DoD).
- [ ] 7. 구 프로젝트의 `scores` 표·함수는 레슨 앱 영향 확인 후 **최소 30일 병행 뒤** 제거(제거일: ______)
- [ ] 8. `privacy.html`의 `[확정 필요]` 표시를 확인한다(관리자 열람 범위 문구는 v4 적용 후에 확정)

## 8. 요금제와 비밀번호 정책 (F13)

유출된 비밀번호 검사(leaked password protection)는 Supabase Pro 이상에서만 켤 수 있다. 구 프로젝트에서는 꺼져 있었다(docs/SUPABASE_V3_VERIFICATION.md).
- 새 프로젝트 요금제: ______ → 유출 비밀번호 검사: ☐ 켬 / ☐ 못 켬
- 못 켠다면 보완으로 Authentication > Policies에서 최소 길이와 문자 조합 요구를 설정하고 아래에 적는다: ______ (설정한 날짜 ______)

## 9. 알려진 한계

- 로컬 PostgreSQL 시험은 SQL의 논리(정책·함수·트리거·권한·동시성)를 실제로 실행해 확인한 것이다. Supabase의 PostgREST(요청 → 역할 전환), Auth, 기본 권한 설정, Advisor는 흉내 낸 최소한뿐이므로 5장의 "사람 실행" 칸이 필요하다.
- 한도 값(200개 · 50 MiB)을 바꾸려면 `scoreforge_v4.sql`의 두 상수와 함께 `supabase/tests/scores_rls.sql`, `js/cloud.js`·`js/i18n.js`의 안내 문구, 관련 시험의 숫자를 같이 고쳐 다시 적용한다.
- **이미 한도를 넘은 회원**(예: 한도 없는 v3에서 쓰던 회원, 또는 옮겨 온 회원): 개수 한도는 새 악보를 만들 때만 따지므로 개수만 넘은 회원은 기존 악보를 계속 고칠 수 있고 새로 만들 수만 없다. 용량 한도는 `data`를 쓸 때마다 "그 회원의 다른 악보 합계 + 이번 `data`"를 따지므로, 합계가 이미 넘은 회원은 악보를 줄이는 저장도 막힌다. 악보를 지워 합계가 한도 아래로 내려오면 풀린다. 이름 바꾸기·공유 켜기/끄기·삭제는 `data`를 쓰지 않으므로 늘 된다. 시험이 이 동작을 고정한다(`tests/supabase-sql.test.mjs`의 "이미 한도를 넘은 회원").
- 한도에 막힌 저장은 앱이 "저장 한도" 안내를 띄우고 그 저장 작업의 자동 재시도를 멈춘다. 안 쓰는 악보를 지운 뒤 Ctrl+Shift+S(또는 상태 줄 누르기)로 직접 저장하면 다시 시도한다. 한도에 막힌 동안 고친 내용은 이 브라우저의 로컬 저장과 저장 대기열에 남는다.
