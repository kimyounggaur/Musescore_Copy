# ScoreForge — 에이전트 작업 규칙

## 1. 프로젝트
- 빌드 없는 정적 PWA. index.html이 js/*.js(IIFE + window.SF 네임스페이스)를 정해진 순서로 읽는다. npm 런타임 의존성 없음.
- Vercel이 master를 자동 배포한다. .vercelignore가 tests/·docs/·supabase/·*.md를 배포에서 뺀다.
- 리팩토링 설계서: docs/scoreforge-refactor-design.md(로컬 전용, Phase 1 배포 후 커밋). 진행 기록: docs/REFACTOR_LOG.md. 결정: docs/DECISIONS.md.
- 설계서의 `파일:줄`은 016ad44 기준이다. 줄이 밀렸으면 함수 이름으로 찾는다.
- 지시가 겹치면 이번 프롬프트 > 이 파일 > 설계서. 설계서의 코드 스케치는 방향이다. 실제 코드와 맞지 않으면 실제 코드에 맞추고 차이를 보고한다.

## 2. 불변식 — 깨면 안 된다
1. 악보 변경은 C.mutate() 한 통로. 악보 객체를 직접 바꾸지 않는다. 예외: meta의 식별 필드(cloudId·cloudUpdatedAt·cloudOwner·cloudProject·docId)는 기존 cloud.js처럼 직접 기록할 수 있다.
2. 마디 안 각 성부 길이의 합 = 마디 길이(replaceRange가 보장).
3. 의존 방향 app → (engrave, playback, io) → core. core.js는 다른 SF 모듈을 참조하지 않는다. 아래 모듈이 위 모듈을 불러야 하면 훅(콜백 등록)으로 푼다.
4. 렌더 캐시를 쓰는 코드는 mutate·core 도우미로 편집하거나 C.invalidate를 호출한다.
5. 선택만 바뀌면 relayout 없이 repaint.

## 3. 금지
- window.confirm·prompt·alert, document.execCommand → SF.ui.confirmDialog·promptDialog·choiceDialog만
- js/app.js 1,600줄 초과 → 새 기능은 새 모듈로
- 런타임 라이브러리·CDN·외부 스크립트 추가(개발 도구 Playwright만 npm i --no-save)
- vendor/ 수정
- 사용자 값이 들어가는 innerHTML. 템플릿의 ${…}에는 SF.html.esc·SF.html.num·상수·숫자 연산만. 새 코드는 textContent·createElement 우선
- 기존 테스트 삭제·skip·단언 약화·결과에 맞춘 기대값 수정. 설계상 바꿔야 하면 먼저 이유를 보고하고 승인을 받는다
- master 직접 커밋, force push, 태그 삭제, git reset --hard, 사용자가 요청하지 않은 git push
- package-lock.json·node_modules/·output/ 커밋, Phase 1 배포 전 설계서 커밋
- Phase 1 배포 전에는 커밋 메시지·기록·PR에 공격 방법(페이로드, 주입 위치 설명)을 자세히 쓰지 않는다

## 4. 코드 규칙
- 새 모듈: "use strict" + IIFE + window.SF. index.html 로드 위치는 설계서 3.3 표를 따른다.
- 새 모듈이 필요한 모듈을 Node 테스트가 로드하면 로드 목록에도 넣는다: tests/shim.mjs, tests/engrave-v3.test.mjs, tests/auth.test.mjs, tests/cloud.test.mjs 하네스, tests/browser.html.
- 새 사용자 문구는 js/i18n.js에 KO·EN 등록(tests/i18n.test.mjs 통과).
- 단축키를 바꾸면 node tests/gen-readme-keys.mjs. 파일을 추가·삭제하면 node tests/prepare-release.mjs.
- 버전은 Step에서 올리지 않는다(릴리스 때만). 단 Step 3-5 이후에는 앱 셸 파일(js·css·html·manifest·fonts·icons·vendor·manual)을 바꾼 Step마다 npm run release를 실행해 생성 파일(js/version.js, sw.js, precache-manifest.json)을 같이 커밋한다(CI가 검사).
- 새 브라우저 테스트는 tests/*.test.mjs로 만들고 { skip: !process.env.PLAYWRIGHT_MODULE }를 붙인다(npm test에서는 건너뛰고 브라우저 실행 때만 돈다).
- 식별자는 영어, 주석·커밋 메시지는 한국어 가능. 들여쓰기·따옴표·세미콜론은 주변 코드를 따른다.

## 5. 검증 명령
- npm run check
- npm test
- 브라우저: SF_HEADERS=1 npm run serve 를 백그라운드로 띄우고
  PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test --test-concurrency=1 tests/*.test.mjs
  Step 3-1 이후 PW_CHANNEL(비우면 번들 Chromium), 3-2 이후 SF_BLOCK_SAMPLES=1. 끝나면 서버를 끈다.
- Playwright가 없으면 npm i --no-save playwright@<REFACTOR_LOG의 버전> && npx playwright install chromium

## 6. 브랜치
- phase 브랜치(예: phase/p2-work-safety)에서 Step 브랜치(예: refactor/p2-a-replace-guard)를 만든다. 시작 전: git switch <phase>, 원격 브랜치가 있으면 git pull --ff-only.
- 프롬프트가 지정한 브랜치 이름을 쓴다. phase 브랜치가 없으면 멈추고 묻는다(Phase 0은 예외: phase/p0-baseline에 바로 커밋).

## 7. 작업 순서(매 Step)
1. git status가 깨끗한지, 브랜치가 맞는지 확인
2. 설계서의 해당 Step과 관련 코드를 읽는다
3. 계획: 바꿀 파일·함수, 추가할 테스트를 5~15줄로. 프롬프트에 ⚠️가 있으면 여기서 멈추고 "진행"을 기다린다
4. 가능하면 실패하는 테스트를 먼저 만들고 실패를 확인한다
5. 구현하고 의미 단위로 커밋한다. 메시지: <type>(<step>): <요약> — 예: fix(p1-2): 템포 입력값 숫자 변환. type은 feat·fix·refactor·perf·test·docs·chore
6. 5절 검증을 모두 실행한다. 못 돌린 검사는 못 돌렸다고 쓴다
7. docs/REFACTOR_LOG.md의 Step 기록 표에 한 줄 추가
8. 8절 형식으로 보고한다. 같은 문제로 두 번 시도해도 안 되면 멈추고 보고한다. 추측으로 넘어가지 않는다

## 8. 보고 형식
### 결과: <Step> <제목>
- 상태: 완료 / 부분 완료 / 막힘
- 브랜치·커밋: <브랜치> / <커밋 해시와 메시지>
- 변경 파일: <파일> — <한 줄 설명>
- 테스트: check ✅❌ · npm test <통과>/<전체> · 브라우저 ✅❌ 또는 미실행(이유)
- 완료 기준: 프롬프트의 항목마다 ✅❌와 근거(테스트 이름·명령 결과·파일:줄)
- 설계서와 다르게 한 점: 없음 / 목록과 이유
- 사람이 확인할 것: 화면·기기·대시보드 등
- 다음 Step 전에 알아야 할 것: 없음 / 목록
