# ScoreForge Supabase 연결 가이드

ScoreForge는 정적 웹앱이라 브라우저에서 Supabase Auth를 직접 사용합니다. 브라우저에는 `publishable key`만 저장하고, `service_role` key는 절대 넣지 않습니다.

## 1. Supabase SQL 적용

1. Supabase Dashboard에서 프로젝트를 엽니다.
2. `SQL Editor`에 [`scoreforge_auth.sql`](./scoreforge_auth.sql) 내용을 붙여 넣고 실행합니다.
3. `Authentication > Providers > Email`에서 Email/Password 로그인이 켜져 있는지 확인합니다.
4. 이메일 인증을 사용할 경우 `Authentication > URL Configuration`에서 배포 URL과 로컬 테스트 URL을 Redirect URL로 추가합니다.

## 2. 웹앱에서 연결

1. ScoreForge 상단의 `회원가입`, `회원 로그인`, `관리자 로그인` 중 하나를 누릅니다.
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

3. ScoreForge에서 `관리자 로그인`을 누르고 같은 이메일/비밀번호로 로그인합니다.
4. `관리자 페이지`에서 회원 목록이 보이면 연결이 완료된 것입니다.

## 보안 메모

- `profiles` 테이블은 RLS가 켜져 있습니다.
- 일반 회원은 자기 프로필만 조회할 수 있습니다.
- `role = 'admin'`인 회원만 전체 회원 목록을 조회할 수 있습니다.
- 관리자 승격은 브라우저 UI가 아니라 Supabase SQL Editor에서만 수행합니다.
