# ScoreForge Supabase 연결 가이드

ScoreForge는 정적 웹앱이라 브라우저에서 Supabase Auth를 직접 사용합니다. 브라우저에는 `publishable key`만 저장하고, `service_role` key는 절대 넣지 않습니다.

## 1. Supabase SQL 적용

1. Supabase Dashboard에서 프로젝트를 엽니다.
2. `SQL Editor`에 [`scoreforge_auth.sql`](./scoreforge_auth.sql) 내용을 붙여 넣고 실행합니다.
3. 클라우드 악보 기능을 사용할 때 [`scoreforge_scores.sql`](./scoreforge_scores.sql)을 먼저 검토한 뒤 DB 소유자(보통 `postgres`)로 적용합니다. `private.is_admin()`이 필요하므로 인증 SQL 다음에 적용해야 합니다. 회원별 저장 한도와 관리자 열람 축소(결정 D4b)를 쓰려면 이어서 [`scoreforge_v4.sql`](./scoreforge_v4.sql)을 적용합니다(5-1장). 이 작업의 구현 에이전트는 원격 SQL을 적용하지 않았습니다.
4. `Authentication > Providers > Email`에서 Email/Password 로그인이 켜져 있는지 확인합니다.
5. 이메일 인증을 사용할 경우 `Authentication > URL Configuration`에서 배포 URL과 로컬 테스트 URL을 Redirect URL로 추가합니다.

## 2. 웹앱에서 연결

1. 주소 끝에 `?dev=1`을 붙여(또는 개발자 도구 콘솔에서 `localStorage.setItem('scoreforge.dev','1')`) 연 뒤 상단의 `회원가입` 또는 `회원 로그인`을 누릅니다. 일반 화면에는 연결 칸이 보이지 않습니다.
2. `Supabase 연결` 영역에 Project URL과 publishable key를 입력합니다.
3. `연결 저장`을 누르면 브라우저 localStorage에 저장됩니다.

Project URL과 publishable key는 Supabase Dashboard의 `Project Settings > API`에서 확인할 수 있습니다.

## 3. 첫 관리자 만들기

1. 웹앱에서 관리자에게 사용할 이메일로 `회원가입`을 먼저 합니다.
2. Supabase SQL Editor에서 아래 SQL의 이메일만 바꿔 실행합니다.

```sql
update public.profiles
set role = 'admin', updated_at = now()
where email = 'admin@example.com';
```

3. ScoreForge에서 `회원 로그인`을 누르고 같은 이메일/비밀번호로 로그인합니다(관리자도 일반 로그인을 씁니다).
4. 로그인하면 상단에 `관리자 페이지` 버튼이 나타납니다(관리자 계정에만). 눌러서 회원 목록이 보이면 연결이 완료된 것입니다.

## 보안 메모

- `profiles` 테이블은 RLS가 켜져 있습니다.
- 일반 회원은 자기 프로필만 조회할 수 있습니다.
- `role = 'admin'`인 회원만 전체 회원 목록을 조회할 수 있습니다.
- 관리자 승격은 브라우저 UI가 아니라 Supabase SQL Editor에서만 수행합니다.
- 회원 탈퇴 Edge Function(`functions/delete-account/`)은 **D1(프로젝트 분리) 전에는 배포하지 않습니다.** 같은 프로젝트를 쓰는 레슨 앱 데이터까지 지워질 수 있기 때문입니다. 앱의 탈퇴 버튼도 `js/config.js`의 `SF_FEATURES.deleteAccount`가 꺼져 있는 동안 숨겨집니다. 배포·확인 절차는 [`functions/delete-account/README.md`](./functions/delete-account/README.md)를 보세요.

## 4. 클라우드 저장·목록·공유

- 파일 메뉴의 `클라우드에 저장 (Ctrl+Shift+S)`, `내 악보…`, `공유 링크 만들기`를 사용합니다. 기존 Ctrl+S는 로컬 JSON 파일 저장입니다.
- 로그인한 회원은 변경 후 10초 동안 추가 변경이 없으면 자동 저장합니다. 기본값은 켬이며 파일 메뉴에서 바꿀 수 있습니다. 초기 데모/문서 열기 자체는 새 클라우드 저장을 만들지 않습니다.
- 목록에서 제목 검색, 열기, 이름 바꾸기, 삭제, 공유 켜기/끄기를 할 수 있습니다. 삭제해도 현재 편집기의 로컬 악보는 유지됩니다.
- 온라인 저장은 매번 `auth.getUser()`로 회원을 확인합니다. 오프라인에서는 최신 스냅샷을 브라우저에 보관하고, 온라인 복귀 후 같은 Supabase 프로젝트/계정에서만 전송합니다. 다른 계정의 대기 작업은 업로드하지 않습니다. 브라우저 데이터 삭제 시 이 로컬 대기 데이터도 삭제됩니다.
- 기본 저장은 `UPDATE ... WHERE id = ... AND owner = ... AND updated_at = 마지막으로_본_시각 RETURNING ...` 한 요청입니다. 0행이면 충돌로 처리하며 자동 저장은 멈추고 상태바에 표시합니다. 수동 저장에서 덮어쓰기 또는 다른 이름으로 저장을 선택할 수 있습니다. **사용자가 명시적으로 덮어쓰기를 선택한 요청만** 시각 조건을 생략합니다.
- 저장 중 새 편집이 생기면 이전 요청의 성공으로 새 편집을 저장 완료 처리하지 않습니다. 응답의 새 시각은 다음 요청의 조건에만 반영하며 최신 내용은 대기열에 남습니다. INSERT 응답이 유실되어 재시도할 때 같은 UUID를 사용하고, 이미 생성된 내용이 정확히 같을 때만 완료를 인정합니다.
- `score.meta.cloudId`, `cloudUpdatedAt`, `cloudOwner`, `cloudProject`는 로컬 연결 정보입니다. 클라우드 `data`에 보내기 전 제거하며, 네트워크 응답으로 undo 항목을 만들지 않습니다. 공개 악보의 내부 연결 정보도 읽을 때 제거합니다.
- 공유 URL의 `?share=<slug>`는 로그인 없이 읽기 전용으로 열립니다. `사본 만들기`는 연결 정보를 제거한 편집 가능한 로컬 악보를 만듭니다. 악보 읽기/검증에 실패하면 현재 문서를 그대로 유지합니다.
- 별도 브라우저에서도 공유가 동작하려면 배포본에 동일 프로젝트의 **공개 설정**(Project URL + publishable key)이 있어야 합니다. 설정을 localStorage에만 넣었다면 익명 브라우저에도 먼저 연결 설정이 필요합니다. 비밀 키를 배포 파일에 넣으면 안 됩니다.

## 5. 악보 SQL 권한 모델

`scoreforge_scores.sql`(v3)의 `public.scores`는 owner CRUD와 관리자 read를 허용합니다. **`scoreforge_v4.sql`을 적용하면 관리자 read가 사라지고 owner CRUD만 남습니다**(5-1장). 관리자 판단에는 기존 `private.is_admin()`을 사용하며 사용자 편집 가능한 `user_metadata`를 사용하지 않습니다. UPDATE에는 SELECT 정책도 필요하므로 두 정책을 모두 둡니다. owner/created_at/updated_at 직접 UPDATE 권한은 주지 않고, `updated_at`은 서버 트리거가 마이크로초 단위로 단조 증가시킵니다. `data`는 JSON 객체이며 `pg_column_size(data)`와 비압축 텍스트 바이트 모두 2,000,000 미만이어야 합니다.

익명 사용자는 테이블의 SELECT를 포함해 직접 권한이 없습니다. 공개 행을 열거할 수 있는 `public_scores` 뷰도 만들지 않습니다. 대신 다음 경로만 제공합니다.

```text
anon / authenticated
  → public.get_shared_score(slug text) [SECURITY INVOKER]
    → private.scoreforge_lookup_shared_score(slug text) [SECURITY DEFINER]
      → public.scores WHERE is_public AND share_slug = 정확한_slug LIMIT 1
      ← title, data 두 필드만 반환
```

입력은 **정확히 12자 `[A-Za-z0-9_-]`**인 경우만 허용하며 잘못된 값/없는 값/중지된 공유는 0행을 반환합니다. 클라이언트는 Web Crypto로 균등한 72비트 capability를 생성합니다. 접두사, 와일드카드, 필터식, UUID로 조회할 수 없습니다. 링크 소유자가 읽을 수 있는 공유 방식이므로 링크를 재배포하면 재배포받은 사람도 읽을 수 있습니다. 공유 끄기는 slug를 지우고 다시 켤 때 새 slug를 만듭니다. 기존에 다운로드된 내용까지 회수하지는 않습니다.

두 함수 모두 `search_path = ''`이며 객체 이름을 명시합니다. 함수의 기본 `PUBLIC EXECUTE`를 철회한 다음 anon/authenticated에 필요한 두 함수만 EXECUTE를 부여합니다. **invoker 래퍼가 private 함수를 호출하려면 익명 역할에도 `USAGE ON SCHEMA private`와 해당 함수 EXECUTE가 필요합니다.** 이는 private 테이블 접근권한이나 다른 함수 EXECUTE를 주지 않습니다. `private`를 Data API/PostgREST의 Exposed schemas에 추가하지 마세요. 적용자는 기존 private 함수 ACL도 검토해야 합니다. 이 SQL은 기존 인증 함수, profiles, 레슨 앱의 객체/권한/기본 권한을 변경하지 않습니다.

익명 접근용 private definer lookup에는 의도적으로 `auth.uid()` 조건이 없습니다. 이는 로그인 없이 공유하기 위한 좁은 capability API이며, 인증이 필요한 일반 definer 함수와 용도가 다릅니다. 데이터베이스 소유자로 적용해야 조회가 작동합니다. Security Advisor 결과에서도 이 용도/함수 범위를 확인하세요.

회원별 악보 수는 `count_scoreforge_scores_by_owner(owner_ids uuid[])` invoker RPC로 계산합니다. 최대 100명, RLS 적용 후 서버에서 집계하므로 페이지 행 수 제한으로 잘리지 않습니다. 일반 회원은 자기 악보만 집계되고 관리자는 전체를 집계합니다. 익명 실행 권한은 없습니다. v4부터는 이 invoker 함수가 private 정의자 함수 `private.scoreforge_count_by_owner(uuid[])`를 불러서, 관리자가 남의 악보를 읽지 못해도 **개수만** 셉니다(5-1장).

SQL은 ScoreForge 범위의 함수/정책/트리거 이름을 사용하며 같은 스크립트를 재실행할 수 있습니다. 기존 `public.scores`가 이 스크립트의 소유 표시(comment)를 갖고 있지 않거나 알 수 없는 정책이 있으면 트랜잭션 전체를 중단합니다. 기존 다른 앱의 동명 테이블이나 permissive 정책을 무단 변경하지 않기 위한 처리입니다. 이 경우 적용자가 기존 객체를 조사해 별도로 조정해야 합니다.

### 5-1. v4 — 회원별 저장 한도, 관리자 열람 축소(D4b), 프로젝트 분리(D1)

적용 순서: `scoreforge_auth.sql` → `scoreforge_scores.sql` → **`scoreforge_v4.sql`**. 모두 DB 소유자(보통 `postgres`)로, 한 파일씩 오류가 없는지 보고 다음으로 갑니다. `scoreforge_profile_compat.sql`은 새 프로젝트에는 필요 없고(로컬에서 없이도 통과하는 것을 확인), 레슨 앱과 같이 쓰던 기존 프로젝트에만 의미가 있습니다. 먼저 스테이징(또는 새 프로젝트)에 적용하고, 되돌릴 수 있도록 [`scoreforge_v4_rollback.sql`](./scoreforge_v4_rollback.sql)을 곁에 둡니다. 이 작업의 구현 에이전트는 어떤 Supabase 프로젝트에도 SQL을 적용하지 않았습니다.

| 바뀌는 것 | 내용 |
|---|---|
| 저장 한도 | 회원당 악보 200개, 악보 JSON 합계 50 MiB. 넘으면 저장이 `SCOREFORGE_QUOTA_COUNT` 또는 `SCOREFORGE_QUOTA_BYTES` 오류로 거절되고, 앱은 "악보 저장 한도(200개·50MB)에 도달했어요…" 안내를 띄웁니다. 이름 바꾸기·공유 켜기/끄기·삭제는 한도에 막히지 않습니다. 같은 회원이 동시에 저장해도 회원별 잠금 때문에 한도를 넘지 못합니다. |
| 관리자 열람 | 관리자는 다른 회원의 악보 내용을 **읽을 수 없습니다**(선택 정책이 소유자 전용). 관리자 페이지는 회원별 악보 **개수**만 봅니다. |
| 되돌리기 | `scoreforge_v4_rollback.sql` → v3 상태로 복귀(관리자 열람이 다시 열립니다). |
| 건드리지 않는 것 | 같은 DB의 다른 앱 객체(레슨 앱 등), `public.scores`의 소유 표시(comment), 인증 SQL. |

v4 뒤에 `scoreforge_scores.sql`을 다시 실행하면 관리자 열람 정책이 되살아나므로, 이어서 `scoreforge_v4.sql`을 다시 실행하세요(여러 번 실행해도 같은 상태가 됩니다). 한도 값(200개 · 50 MiB)을 바꾸려면 SQL의 두 상수와 함께 `tests/scores_rls.sql`, `js/cloud.js`·`js/i18n.js`의 안내 문구, 관련 시험의 숫자를 같이 고칩니다.

확인: [`tests/scores_rls.sql`](./tests/scores_rls.sql)을 실행해 마지막 결과가 `PASS: …` 한 줄인지 봅니다(시험 데이터는 ROLLBACK됩니다). 객체 지문([`tests/scoreforge_fingerprint.sql`](./tests/scoreforge_fingerprint.sql), 다른 앱 객체는 [`tests/other_apps_fingerprint.sql`](./tests/other_apps_fingerprint.sql) — 적용 전·후가 같아야 함)과 한도 트리거 비용([`tests/quota_cost.sql`](./tests/quota_cost.sql))은 [v4 검증 기록](../docs/SUPABASE_V4_VERIFICATION.md)의 표에 적습니다. 먼저 스테이징이나 새 프로젝트에서 실행하세요. 특히 `quota_cost.sql`은 악보 200개를 임시로 만들었다가 마지막에 일부러 오류를 내서 모두 되돌리는 스크립트이므로 **운영 DB에서는 실행하지 않습니다.**

프로젝트 분리(D1): 새 프로젝트에 위 순서로 SQL을 적용한 뒤, 앱의 접속 정보를 한 번에 바꾸는 도구를 씁니다.

```bash
node tests/switch-supabase-project.mjs --url https://<새 ref>.supabase.co --key sb_publishable_… --dry-run   # 미리보기
node tests/switch-supabase-project.mjs --url https://<새 ref>.supabase.co --key sb_publishable_…
npm run release   # 릴리스 파일(sw.js 등)을 다시 만든 뒤 함께 커밋
```

도구는 `js/config.js`의 프로젝트 주소·공개 키와 `vercel.json` CSP의 Supabase 주소만 바꿉니다. 비밀 키(`sb_secret_…`, service_role)는 거절하고 어디에도 쓰지 않습니다. 탈퇴 Edge Function을 새 프로젝트에 배포한 **뒤에만** `--enable-delete-account`를 더해 탈퇴 버튼을 켭니다. CSP가 새 프로젝트 하나로 좁혀지므로 배포본에서는 개발 모드의 "사용자 지정 연결"로 다른 프로젝트에 붙을 수 없습니다(의도된 동작). 전체 체크리스트는 [v4 검증 기록](../docs/SUPABASE_V4_VERIFICATION.md) 7장입니다.

## 6. 적용 후 검증 (메인 에이전트/운영자 실행)

2026-09-03 기존 프로젝트 `cgoafcjvnbzozxbbyfle`에 적용했고, 실제 SQL RLS 및 브라우저 로그인/저장/다른 브라우저 열기/충돌/익명 공유/해제를 검증했습니다. 상세 결과는 [원격 검증 기록](../docs/SUPABASE_V3_VERIFICATION.md)에 있습니다. 새 프로젝트는 인증 SQL → `scoreforge_scores.sql` → `scoreforge_v4.sql` 순서로 적용합니다(5-1장). `scoreforge_profile_compat.sql`은 기존 프로젝트에서 빠져 있던 프로필 열을 보완하고 트리거 함수의 직접 실행을 막는 호환 SQL로, 기존 프로젝트(2026-09-03 적용분)에는 필요했습니다. 새 프로젝트에서는 없어도 v4 시험이 일회용 로컬 PostgreSQL에서 통과했고, 실제 새 프로젝트에서는 [v4 검증 기록](../docs/SUPABASE_V4_VERIFICATION.md)의 표로 확인합니다.

[수동 검증 목록](../tests/manual/cloud.md)과 아래 권한 조회로 배포 환경에서도 확인할 수 있습니다. SQL 재실행 가능성은 별도 검증 환경에서 확인하세요.

```sql
select
  has_table_privilege('anon', 'public.scores', 'SELECT') as anon_select, -- false
  has_table_privilege('authenticated', 'public.scores', 'SELECT') as member_select, -- true
  has_column_privilege('authenticated', 'public.scores', 'data', 'UPDATE') as data_update, -- true
  has_column_privilege('authenticated', 'public.scores', 'owner', 'UPDATE') as owner_update, -- false
  has_function_privilege('anon', 'public.get_shared_score(text)', 'EXECUTE') as anon_share, -- true
  has_function_privilege('anon', 'public.count_scoreforge_scores_by_owner(uuid[])', 'EXECUTE') as anon_counts; -- false

select n.nspname, p.proname, p.prosecdef, p.proconfig
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'private' and p.proname in ('scoreforge_lookup_shared_score', 'scoreforge_scores_touch_updated_at'))
   or (n.nspname = 'public' and p.proname in ('get_shared_score', 'count_scoreforge_scores_by_owner'));
-- lookup only: prosecdef=true; all four: search_path="".

select * from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'scores';
-- Four ScoreForge policies, all TO authenticated; no public-row SELECT policy.
-- v4 적용 후에는 scoreforge_scores_select의 qual에 is_admin이 없어야 합니다(소유자만).
```

이후 Security Advisor와 실제 API의 RLS 테스트를 실행합니다. CLI를 쓸 때는 버전과 각 명령의 `--help`를 먼저 확인하세요. Node 모의 테스트는 PostgreSQL 구문·권한·RLS 실행 검증을 대신하지 않습니다.

## 7. 확인한 공식 문서 (2026-09-03)

- [Changelog index](https://supabase.com/changelog.md)와 관련 [2026-04-28 Data API 명시적 권한 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): 신규 테이블은 자동 노출을 가정하지 않고 범위가 명확한 GRANT를 함께 작성합니다.
- [auth.getUser](https://supabase.com/docs/reference/javascript/auth-getuser): Auth 서버에서 사용자를 확인합니다.
- [UPDATE와 반환 행](https://supabase.com/docs/reference/javascript/update): 조건 뒤 `.select()`로 수정된 행을 받아 0행 충돌을 판별합니다.
- [Database functions / privileges / search_path](https://supabase.com/docs/guides/database/functions): invoker 우선, 좁은 private definer, 명시적 함수 권한을 적용했습니다.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): SELECT 및 UPDATE의 USING/WITH CHECK를 함께 적용합니다.
