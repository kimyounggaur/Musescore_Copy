# 리팩토링 진행 기록

## 실행 방식
- 2026-11-23 사용자 지시: 프롬프트북(`scoreforge-vibecoding-prompts.md`) 순서대로 구현하되, ⚠️ 계획 승인 단계는 에이전트가 계획을 기록한 뒤 스스로 승인하고 진행한다.
- 하지 않는 것: 🧑 사람 작업(대시보드·실기기·눈으로 확인), 🔒 결정이 필요한 곳의 임의 확정(추천안으로 진행하고 DECISIONS.md에 "에이전트 기본값"으로 표시), R-2 릴리스(master 병합·배포), push.
- 브랜치: phase 브랜치는 이전 phase 브랜치 위에 쌓는다(master는 016ad44 그대로).

## 환경
| 항목 | 값 |
|---|---|
| OS | Linux 6.18 · Ubuntu 24.04.5 LTS (클라우드 샌드박스) |
| Node / npm | v22.23.5 / 10.9.9 |
| Playwright | 1.65.1 (`npm i --no-save`). 번들 Chromium 내려받기는 이 환경에서 막혀 있어 시스템 Chrome(Chrome for Testing 153.0.8010.12)을 `PW_CHANNEL=chrome`으로 사용 |
| Microsoft Edge 설치 | 없음 → P3-1·P3-2를 앞당겨 적용(`PW_CHANNEL`, `SF_BLOCK_SAMPLES`) |
| 기준 npm test | 106 / 105 / 1 (016ad44, 건너뜀 1 = 브라우저 테스트) |
| 기준 브라우저 테스트 | `PW_CHANNEL=chrome`, ui-v3 13개 — 헤더 없음: 4회 중 4회 통과 / SF_HEADERS=1: 4회 중 2회 통과, 2회 `MIDI options, safe names…` 실패(간헐) |

## 알려진 불안정 테스트
- `tests/ui-v3.test.mjs` 하위 테스트 "MIDI options, safe names, responsive properties and accessibility"(142행): 대화상자의 확인을 누른 직후 `window.midiOptionResult`를 바로 읽어서 간헐적으로 `undefined`가 된다(016ad44에 이미 있는 경쟁 상태, 앱 오류 아님). 단언은 건드리지 않았다. P3-3(CI)에서 기다림을 추가하는 안을 검토한다.

## Step 기록
| 날짜 | Step | 브랜치 | 결과 | 설계서와 다른 점 | 메모 |
|---|---|---|---|---|---|
| 2026-11-23 | P0-0 | phase/p0-baseline | 완료 | 없음 | 기준 npm test 106/105/1, check 20개 |
| 2026-11-23 | P3-1·P3-2 (앞당김) | refactor/p3-1-browser-channel | 완료 | 번들 Chromium 대신 `PW_CHANNEL=chrome`으로 확인. 컨텍스트 언어를 ko-KR로 고정(`pageOptions`) | Edge가 없는 환경이라 P0-0 지침대로 앞당김. 앱이 navigator.language로 언어를 골라, 영어 Chrome에서는 한국어 문구 단언이 실패했음 |
| 2026-11-23 | P0-1 | phase/p0-baseline | 완료 | perf-edit는 launchOptions 사용(P3-1 앞당김 반영) | MIDI 1천 1.3s·2천 3.5s·4천 13.1s·1만 108.9s, 편집 중앙값 306ms(최대 442), quartet64 197,535B. 태그 v3.0.1-baseline(로컬) |
| 2026-11-23 | P0-2 | — | 건너뜀 | 🧑 사람 작업 | 아래 '사람이 해야 할 일' 참고 |
| 2026-11-23 | P0-3 | phase/p0-baseline | 부분 완료 | 운영 값 미확인(샌드박스에서 호스트 접근 차단) | docs/PRODUCTION_HEADERS.md에 vercel.json 값과 확인 명령을 남김 |
| 2026-11-23 | P0-4 | phase/p0-baseline | 완료 | 사용자 지시로 결정 4건을 추천안으로 자체 승인 | D1 분리 · D2 A · D3 보기·재생·간단한 수정 · D4a 운영 · D4b 불허. P5 행은 Phase 5 뒤 측정으로 판단 |
| 2026-11-23 | P1-1 | refactor/p1-1-safe-html | 완료 | 없음 | esc 3벌→SF.html.esc. npm test 108/107/1(+2), 브라우저 13/13. 옛 esc와 출력 차이로 바뀐 기대값 없음 |

### P1-2 innerHTML 사용처 점검 (016ad44, engrave.js 제외 29곳)
| 위치 | 들어가는 값 | 판정 | 근거 |
|---|---|---|---|
| panels.js 속성 패널(템포 입력) | 이벤트 템포 값 | ❌→수정 | `SF.html.num(ev.tempo, { min: 30, max: 280 })`로 변환 |
| panels.js 속성 패널(나머지 입력·옵션·위치 이름) | 색·리허설·스태프 텍스트·코드·이름 / 오프셋·Velocity | ✅ | `htmlEsc` 또는 `+ev.x` 숫자 변환, 옵션은 상수 목록 |
| panels.js 악보 요약 | 마디 수·용지·마디/줄 | ✅ | `ensureLayout`이 마디/줄을 정수로 바꿈, 용지는 `htmlEsc` |
| panels.js 안내 문구(45) | 상수 | ✅ | 상수 |
| panels.js 내비게이터(231) | 좌표 | ✅ | 숫자 계산값(`r1`) |
| panels.js 타임라인(252) | 표식 문구·마디 번호 | ✅ | `htmlEsc`, 숫자 |
| panels.js 믹서(325) | 파트 id·이름·볼륨·팬 | ✅ | `htmlEsc`, `Math.round` |
| panels.js 조 선택지(372) | 조 이름 | ✅ | 상수 표 |
| app.js 87 | 조판 SVG | ✅ | engrave가 문자열을 `esc`·`safeColor`·숫자 변환으로 처리. 악성 값 23개 항목을 넣어 렌더한 결과 마크업 주입 0건 확인 |
| app.js 429–444 | 음표 버튼·아이콘·악기 목록 | ✅ | 상수·숫자 |
| app.js 547·553 | 보표·보기 선택지 | ✅ | `htmlEsc`, 숫자 |
| app.js 644 | 가져오기 리포트 | ✅ | `&`·`<` 치환(텍스트 위치) |
| input.js 285·294 | 안내 문구 | ✅ | 상수 |
| input.js 869 | 피아노 건반 | ✅ | 숫자·상수 |
| palette.js 299 | 팔레트 마크업 | ✅ | 코드 상수 |
| palette.js 318 | 단축 버튼 | ✅ | 이미 있는 DOM 요소의 내용 복사 |
| export-ui.js 54·85 | 인쇄 페이지 SVG | ✅ | 조판 SVG(위와 같음) |
| auth.js 430–472 | 관리자 요약·회원 표·오류 | ✅ | 모든 값 `htmlEsc`, 나머지는 상수 |

❌ 0건(수정 후). 방어를 하나 더 추가: engrave.js 박자표 글꼴 대체 경로의 문자열도 `esc` 처리.

| 2026-11-23 | P1-2 | refactor/p1-2-tempo | 완료 | 없음 | 속성 패널 입력 1곳 수정, 사용처 29곳 점검표 기록(아래), PR 템플릿 추가. 정적 검사 테스트: 수정 전 실패(1곳)→수정 후 통과 |
| 2026-11-23 | P1-3 | refactor/p1-3-sanitize | 완료 | 템포는 설계서의 Math.round 대신 clamp만(정정 C3) | 테스트 3개: 수정 전 2개 실패·기준 악보 테스트 통과 → 수정 후 전부 통과. npm test 112/111/1 |
| 2026-11-23 | P1-4 | refactor/p1-4-csp | 완료 | 운영 CSP 값은 샌드박스에서 확인 못 함(P0-3 미완료) | CSP script-src 'self'만, CDN 예비 경로 3곳 제거, audioio-v3 바꿔치기 단언 추가. SF_HEADERS=1에서 CSP 위반 0·폰트 OK·재생 호출 OK. npm test 114/113/1, ui-v3 13/13(1회는 기존 간헐 실패 #8) |
| 2026-11-23 | P1-5 | refactor/p1-5-xss-e2e | 완료 | 없음 | 악성 파일 E2E(시나리오 2개) 통과. 취약 상태(수정 되돌림)에서는 2개 모두 실패함을 확인. tests/fixtures/make-xss-fixture.mjs로 파일 생성 |

## 계획 기록 (⚠️ 단계 — 에이전트가 계획을 적고 스스로 승인)

### P2-A 악보 교체 통로 단일화 (2026-11-23 승인)
교체 경로 — 전부 `SF.session.replaceScore` 한 곳을 거치게 한다. 읽기 전용이거나 변경이 없으면 대화상자 없이 교체, 변경이 있으면 [파일로 저장하고 계속 / 저장하지 않고 계속 / 취소]. 저장소 보관(flush)은 2-B 전이라 지금은 항상 실패로 보고 3지선다로 간다.

| # | 경로 | 지금 위치 | 바뀐 뒤 |
|---|---|---|---|
| 1 | 파일 열기 | app.js bindMenu `open` | `IO.openScoreDialog(handleLoadedScore)` — 확인 전에 읽기 전용을 풀던 선호출 삭제(F6) |
| 2 | 끌어다 놓기 | app.js bindDragDrop | 〃 |
| 3 | 앱 파일 실행 | pwa.js handleFileLaunch | `handleLoadedScore` 경유(코드 변경 없음). 읽기 전용 화면에서 실행하면 이제 편집 가능 상태로 열림(기존 버그 수정) |
| 3′ | 앱 파일 실행(중복 소비자) | **ui-v3.js:219**(설계서 표에 없음) | `A.setReadOnly(false)` 선호출만 삭제 — `launchQueue` 소비자가 pwa.js와 ui-v3.js에 둘 다 있어 같은 보호를 적용 |
| 4 | 새 악보 | app.js bindMenu `new` | 무조건 묻던 `confirmDialog` 삭제 → `replaceScore(createScore, { reason })`, 성공 시 `openSettings()` |
| 5 | 데모(메뉴) | app.js bindMenu `demo-*` | `replaceScore(DEMOS[key](), { reason: "데모 열기", toast })` |
| 6 | 클라우드 열기 | cloud.js openScore·installScore | 자체 확인·지문 비교 삭제, `installScore`가 `handleLoadedScore(…, { readOnly, reason })`를 기다림. `suppressChange` try/finally 유지 |
| 7 | 로컬 사본 | cloud.js makeLocalCopy | `installScore` 반환값 확인. 사본은 현재 내용을 그대로 담으므로 `confirmed: true`(읽기 전용 화면이라 확인 불필요) |
| 8 | 시작 화면 빈 악보 | app.js bindWelcome | `replaceScore`, 성공했을 때만 창 닫기·`openSettings()` |
| 9 | 시작 화면 데모 | app.js bindWelcome | 〃 |

- `installScore(score, opts)`(app.js): `setReadOnly` → `C.setScore` → 선택·커서·스피디 초기화 → `stopPlayback` → `update` → 보고서 또는 토스트(`opts.toast`가 문자열이면 그 문구, `false`면 없음). `SF.app`에 공개.
- 기존 동작 보존 한 가지 추가: 클라우드 열기는 예전에 확인 뒤 `loadSequence`가 바뀌었는지 다시 봤다 → `replaceScore`의 `opts.stale`로 같은 검사를 유지(설계서에 없던 보강).
- 대화상자: index.html에 `<dialog id="dlg-choice" class="app-prompt">`(제목·본문·버튼줄은 비워 두고 `textContent`로만 채움). 연속 호출은 줄 세움. Esc·바깥 클릭 = `"cancel"`. 기본 포커스는 데이터를 잃지 않는 "파일로 저장하고 계속".
- i18n(`session` 그룹): 저장하지 않은 변경 사항 / 파일로 저장하고 계속 / 저장하지 않고 계속 / 다른 악보 열기 / 데모 열기 / 클라우드 악보 열기 / 본문 패턴 `{reason} 전에 현재 악보를 어떻게 할까요?`.
- 테스트: tests/session.test.mjs(Node 7 + 구조 고정), tests/session-browser.test.mjs(경로별 취소·깨끗한 상태), cloud.test.mjs 하네스의 `handleLoadedScore` 스텁 교체(기대값 무변경), security-browser의 `handleLoadedScore` 호출을 `await`로(비동기가 된 반환값을 기다리게만 바꿈).
- app.js 줄 수: 현재 1,015 → 예상 약 1,010(1,600 이하 유지).
- 알려진 동작: 클라우드에 저장했어도 파일로 저장하기 전이면 `C.state.dirty`라서 묻는다. 2-B에서 보관(flush)이 생기면 사라진다.

## 릴리스 준비 기록
(로컬에서 버전 올리기·검증까지만 했다. push·PR·병합·배포는 하지 않았다.)

| 날짜 | 버전 | Phase 브랜치 | 포함 Step | 검증 | 상태 |
|---|---|---|---|---|---|
| 2026-11-23 | 3.0.2 | phase/p1-security | P1-1~P1-5 | check 21 · npm test 115/113/2 · 브라우저(SF_HEADERS=1) 16/16 · 오프라인 검증 통과(캐시 42개, CSP 위반 0) | 로컬 준비 완료 — push 대기 |
| 2026-11-23 | P2-A | refactor/p2-a-replace-guard | 완료 | 교체 경로가 설계서 표(7개)+시작 화면 2개 외에 ui-v3.js:219의 중복 앱 파일 실행 소비자 1곳 더. 클라우드 열기에 stale 검사 유지(설계서에 없던 보강) | 9개 경로(+1) 모두 SF.session.replaceScore 경유. session.test 15 + session-browser 18 + cloud 3 추가. check 22 · npm test 136/131/0/5 · 브라우저(SF_HEADERS=1) 34/34 · 오프라인 검증 통과(캐시 43개). 가드를 끄면 Node 테스트 5개 실패 확인. app.js 999줄. 읽기 전용 화면에서 앱 파일 실행 시 이제 편집 가능 상태로 열림(기존 버그 수정). 관찰: 한글 제목 파일 저장 시 헤드리스 Chrome이 내려받기 이름을 'download'로 보고함(기존 동작, 이 Step에서 안 건드림 — 실제 Chrome 확인은 사람 몫) |

## 사람이 해야 할 일 (자동 진행에서 건너뜀)
- [ ] P0-2 공유 동결: Supabase SQL Editor에서 공개 악보·문자열 템포 질의 2건 실행, **개수만** 이 파일에 기록. Phase 1 배포 전까지 새 공유 링크 만들지 않기.
- [ ] P0-3 운영 헤더: `curl.exe -sI https://musescore-copy.vercel.app/` 결과를 docs/PRODUCTION_HEADERS.md의 "운영 값"에 채우기.
- [ ] 재생 메모리 기준(설계서 부록 D-3): 실제 브라우저에서 A·B·C1~C3 측정해 tests/baseline/PERF.md 표에 채우기.
- [ ] **Phase 1 릴리스(3.0.2)**: `phase/p1-security`를 처음으로 push → PR → 곧바로 병합(공개~배포 간격 최소화). 배포 뒤 `curl.exe -sI https://musescore-copy.vercel.app/`로 CSP의 script-src가 'self'뿐인지, 앱 콘솔 오류 0, `SF.VERSION === "3.0.2"`, 기존 설치본에 업데이트 알림이 뜨는지 확인.
- [ ] 배포 확인 뒤 `.git/info/exclude`에서 설계서 줄을 지우고 `docs/scoreforge-refactor-design.md`를 커밋.
- [ ] 외부 공유 재개 공지.
- [ ] (P2-A) 실제 Chrome에서 한글 제목 악보를 파일로 저장했을 때 파일 이름이 `제목.scoreforge.json`으로 나오는지 확인. 헤드리스 Chrome에서는 내려받기 이름이 `download`로 보고됨(앱 코드는 `a.download`에 정상 이름을 넣고 있어 헤드리스 한정 현상으로 보임).
