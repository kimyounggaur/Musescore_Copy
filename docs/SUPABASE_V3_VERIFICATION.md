# Supabase v3 검증

대상: `cgoafcjvnbzozxbbyfle` / `lesson-designer`
실행일: 2026-09-03

## 적용

1. `scoreforge_profile_compat_v3`: 기존 profiles에 누락된 display_name/updated_at 열을 추가하고 트리거 전용 함수의 직접 실행 권한을 제한.
2. `scoreforge_scores_v3`: 악보 테이블, 소유자 RLS, 갱신 시간 트리거, 공유 링크 조회 RPC, 관리자 집계 RPC.

기존 api_cost_log, daily_cost_summary, grant_documents, grant_notices, jobs 테이블은 변경하지 않음.

## SQL 검증

`supabase/tests/scores_rls.sql`을 실제 프로젝트에서 실행. 임시 회원/악보는 한 트랜잭션 안에서 검사 후 ROLLBACK.

- 회원가입 트리거: 프로필 자동 생성 통과.
- 소유자: 자기 악보 생성/조회/수정 가능.
- 다른 회원: 조회/수정/삭제/소유자 위조 차단.
- anon: scores 테이블 직접 조회 불가.
- 공유: 정확한 공개 slug로만 조회, 미등록/잘못된 slug는 빈 결과.
- 공개 해제: 기존 공유 링크로 조회 불가.
- 관리자: 다른 소유자의 악보 조회 가능.
- 열 권한: authenticated의 owner UPDATE 불가.

공유 기능은 공개 view 대신 정확한 slug 하나를 받는 RPC를 사용한다. view만으로는 전체 공개 악보 열거를 막을 수 없기 때문이다.
security-definer 조회는 노출되지 않는 private 스키마 안에 한정되고, 고정된 검색 경로와 공개 여부/slug 검증을 사용한다.

## Advisor

이번에 추가한 scores 테이블과 함수에 대한 보안 경고 없음.
기존 별도 앱 테이블 3개의 RLS 정책 없음(INFO), 프로젝트의 유출 비밀번호 검사 비활성화(WARN)는 기존 설정이다.
프로젝트 전역 설정 변경은 이 작업에 포함하지 않았다.

## 실제 브라우저 검증

Edge의 서로 독립된 3개 브라우저 컨텍스트로 `tests/verify-cloud-live.mjs` 실행:

- 앱의 회원 로그인 폼으로 실제 비밀번호 로그인.
- 악보 INSERT 및 연결 정보 반영, 다른 브라우저에서 같은 악보 열기.
- 서로 다른 편집본의 동시 저장 시 마지막 갱신 시각 조건으로 충돌 차단.
- 실제 `?share=` 링크를 익명 브라우저에서 열기, 읽기 전용 확인.
- 공유 해제 후 이전 링크 조회 거부, 소유자 삭제 성공.
- 브라우저 예외 0건.

검증 전용 계정에는 이메일을 전송하지 않았다. 완료 후 해당 계정과 연결 악보/프로필을 삭제하고 잔여 행 0개를 확인했다.
기존 사용자 계정이나 레슨 앱 데이터는 테스트 대상으로 수정하지 않았다.

익명 REST 직접 조회는 권한 거부, 존재하지 않는 공유 slug RPC는 빈 배열을 반환했다.

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [비밀번호 유출 검사](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
