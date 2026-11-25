## 설계서 Step
<!-- 예: Step 2-A (docs/scoreforge-refactor-design.md) -->

## 백로그 번호
<!-- 예: #2 -->

## 변경 요약


## 테스트 결과
- [ ] `npm run check`
- [ ] `npm test` — 통과 / 전체:
- [ ] 브라우저 테스트(`PLAYWRIGHT_MODULE` 지정) — 통과 / 미실행(이유):

## 리뷰 체크
- [ ] innerHTML 템플릿의 `${…}`는 `SF.html.esc`·`SF.html.num`·상수·숫자 연산만 쓴다
- [ ] 새 사용자 문구는 `js/i18n.js`에 KO·EN 등록했다
- [ ] 앱 셸 파일을 바꿨다면 `npm run release`(Step 3-5 이후)로 생성 파일을 함께 커밋했다
