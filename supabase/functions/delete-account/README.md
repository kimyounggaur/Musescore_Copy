# delete-account — 회원 탈퇴 Edge Function

> ⚠️ **이 함수는 사용자 계정을 지웁니다. 결정 D1(Supabase 프로젝트 분리)이 끝나기 전에는 배포하지 마세요.**
> ScoreForge는 아직 레슨 앱과 같은 Supabase 프로젝트·`profiles` 표를 씁니다. 여기서 사용자를 지우면 `auth.users`를 참조하는
> 레슨 앱 쪽 데이터(외래 키 `on delete cascade`)까지 함께 지워질 수 있습니다.
> 앱 쪽도 같은 이유로 닫혀 있습니다: `js/config.js`의 `SF_FEATURES.deleteAccount`가 꺼져 있는 동안 "회원 탈퇴" 버튼은 로그인해도 보이지 않고,
> 코드로 불러도 아무 요청을 보내지 않습니다.

이 폴더의 코드는 **파일로만** 준비된 것입니다. 개발 과정에서 배포·실행하지 않았고, 서비스 키는 어떤 파일에도 없습니다.

## 하는 일

1. 요청의 `Authorization: Bearer <사용자 JWT>`로 **요청한 본인**을 확인합니다(`auth.getUser(token)`).
2. 서비스 키로 만든 관리 클라이언트로 **그 사용자 한 명**만 `auth.admin.deleteUser(user.id)`로 지웁니다.
3. 성공하면 본문 없는 `204`. (`scores.owner`, `profiles.id`는 `auth.users`에 `on delete cascade`라 함께 지워집니다.)

요청의 본문·쿼리에 다른 id를 실어도 무시합니다(시험으로 고정). 앱은 방금 비밀번호로 다시 확인한 계정의 토큰을 명시해 호출하므로, 그 사이 다른 탭에서 로그인이 바뀌어도 다른 계정을 지우지 않습니다.

| 응답 | 뜻 |
|---|---|
| 204 | 지웠습니다(또는 OPTIONS 사전 요청 허용) |
| 401 | 토큰이 없거나 올바르지 않음 / 만료 |
| 403 | 허용 목록에 없는 출처(`Origin`) — `ALLOWED_ORIGINS` 확인 |
| 405 | POST·OPTIONS 외의 방식 |
| 500 | 서버 설정 누락(`server_not_configured`) 또는 삭제 실패(`delete_failed`) — 자세한 원인은 함수 로그에만 남고 응답에는 싣지 않습니다 |

## 파일

- `handler.ts` — 본체. `createClient`를 주입받아 Node 시험에서 가짜로 바꿔 끼웁니다(`tests/delete-account.test.mjs`, 실제 배포 없이 12건).
- `index.ts` — 진입점. 실제 `createClient`와 `Deno.env`를 이어 줍니다.

## 배포 (D1 분리 뒤, 새 프로젝트에서, **사람이** 합니다)

1. 새 프로젝트에 `scoreforge_auth.sql`·`scoreforge_scores.sql`이 적용돼 있는지 확인합니다(운영 DB 작업은 사람이).
2. 함수 배포: `supabase functions deploy delete-account --project-ref <새 프로젝트 ref>` — 플랫폼의 JWT 검증은 기본값(켜짐)을 둡니다. 함수 안에서도 토큰을 다시 확인하므로 어느 쪽이든 남의 토큰으로는 지울 수 없습니다. 새 JWT 서명 키 때문에 401이 계속 나면 Supabase 공식 문서의 Edge Functions 인증 항목을 확인하세요.
3. 비밀값: `supabase secrets set ALLOWED_ORIGINS="https://<운영 주소>,https://<Preview 주소>" --project-ref <ref>`
   - 쉼표로 구분한 **정확한 출처** 목록입니다. 비어 있으면 브라우저 요청은 전부 403입니다(닫힌 채로 시작).
   - `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 실행 환경이 넣어 주므로 따로 설정하지 않습니다. **서비스 키를 저장소·`.env`·앱 코드·채팅에 적지 마세요.**
4. 시험용 계정으로 확인합니다(아래).
5. 확인이 끝난 뒤에야 `js/config.js`의 `SF_FEATURES.deleteAccount`를 켜는 커밋을 배포합니다(8-5의 분리 커밋).

## 켜기 전 확인 (시험용 계정으로)

- [ ] 진짜 회원이 아닌 **시험용 계정**을 만들고 악보를 1개 저장한다.
- [ ] 앱에서 비밀번호 확인 → `탈퇴` 입력 → "탈퇴가 끝났어요" 알림, 로그아웃 상태가 된다.
- [ ] 그 계정이 지워졌는지 **읽기 전용 조회**로 확인한다: `auth.users`·`profiles`·`scores`에서 해당 계정 행이 0건.
- [ ] 함수 로그에 토큰·서비스 키가 찍히지 않았다(원인 메시지는 이름만).
- [ ] 허용 목록에 없는 출처에서 시도하면 "이 주소에서는 탈퇴를 처리할 수 없어요."(403)가 뜬다.
- [ ] (분리 확인) 레슨 앱 쪽에는 같은 프로젝트의 사용자·데이터가 더 이상 없다.

## 되돌리기

- 앱: `js/config.js`의 `SF_FEATURES.deleteAccount`를 `false`로 되돌려 배포하면 버튼이 사라지고 요청도 멈춥니다.
- 함수: `supabase functions delete delete-account --project-ref <ref>`로 내립니다.
