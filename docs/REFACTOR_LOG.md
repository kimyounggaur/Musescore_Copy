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
- (해결됨 — P3-3) `tests/ui-v3.test.mjs` 하위 테스트 "MIDI options, safe names, responsive properties and accessibility"(142행): 대화상자의 확인을 누른 직후 `window.midiOptionResult`를 바로 읽어 간헐적으로 `undefined`가 되던 경쟁 상태(016ad44에 이미 있었고 앱 오류가 아님). 확인을 누른 뒤 값이 채워질 때까지 기다리는 `waitForFunction` 한 줄만 추가했고 단언은 그대로다. SF_HEADERS=1에서 4회 중 4회 통과(수정 전 기준 4회 중 2회).
- (해결됨 — P6-1b) `tests/menus-browser.test.mjs` "P6-1 바깥 누름·화면 크기 변경…"(`waitForFunction` 10초 시간 초과)와 `tests/responsive.test.mjs` "P6-4 360×640·375×667 …"(⋯ 더보기 Esc 뒤 `waitPopover(…, false)` 시간 초과): 3.4.0 올림 뒤 CI식 전체 실행 1건, 같은 시험 묶음 반복에서 여러 번. **시험의 경쟁 상태가 아니라 앱 쪽 실제 틈**이었다 — 네이티브 Popover가 열린 뒤 toggle 이벤트가 오기까지(약 10~20ms) Esc·resize 처리기가 붙어 있지 않았다(js/menus.js). 열리는 순간(beforetoggle)에 처리기를 붙이도록 앱을 고쳤고 시험 단언은 그대로다. 같은 작업 안에서 열고 Esc·resize를 보내는 결정적 시험 5건을 더했다. 수정 후 반복 10회(단독 6·묶음 4)와 CI식 전체 478/478 통과(수정 전: 단독 6회 중 4회, 묶음 4회 중 3회 실패). 자세한 내용은 Step 기록 P6-1b.

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
| 2026-11-23 | P1-2 | refactor/p1-2-tempo | 완료 | 없음 | 속성 패널 입력 1곳 수정, 사용처 29곳 점검표 기록(아래), PR 템플릿 추가. 정적 검사 테스트: 수정 전 실패(1곳)→수정 후 통과 |
| 2026-11-23 | P1-3 | refactor/p1-3-sanitize | 완료 | 템포는 설계서의 Math.round 대신 clamp만(정정 C3) | 테스트 3개: 수정 전 2개 실패·기준 악보 테스트 통과 → 수정 후 전부 통과. npm test 112/111/1 |
| 2026-11-23 | P1-4 | refactor/p1-4-csp | 완료 | 운영 CSP 값은 샌드박스에서 확인 못 함(P0-3 미완료) | CSP script-src 'self'만, CDN 예비 경로 3곳 제거, audioio-v3 바꿔치기 단언 추가. SF_HEADERS=1에서 CSP 위반 0·폰트 OK·재생 호출 OK. npm test 114/113/1, ui-v3 13/13(1회는 기존 간헐 실패 #8) |
| 2026-11-23 | P1-5 | refactor/p1-5-xss-e2e | 완료 | 없음 | 악성 파일 E2E(시나리오 2개) 통과. 취약 상태(수정 되돌림)에서는 2개 모두 실패함을 확인. tests/fixtures/make-xss-fixture.mjs로 파일 생성 |
| 2026-11-23 | P2-A | refactor/p2-a-replace-guard | 완료 | 교체 경로가 설계서 표(7개)+시작 화면 2개 외에 ui-v3.js:219의 중복 앱 파일 실행 소비자 1곳 더. 클라우드 열기에 stale 검사 유지(설계서에 없던 보강) | 9개 경로(+1) 모두 SF.session.replaceScore 경유. session.test 15 + session-browser 18 + cloud 3 추가. check 22 · npm test 136/131/0/5 · 브라우저(SF_HEADERS=1) 34/34 · 오프라인 검증 통과(캐시 43개). 가드를 끄면 Node 테스트 5개 실패 확인. app.js 999줄. 읽기 전용 화면에서 앱 파일 실행 시 이제 편집 가능 상태로 열림(기존 버그 수정). 관찰: 한글 제목 파일 저장 시 헤드리스 Chrome이 내려받기 이름을 'download'로 보고함(기존 동작, 이 Step에서 안 건드림 — 실제 Chrome 확인은 사람 몫) |
| 2026-11-23 | P2-B | refactor/p2-b-idb-autosave | 통과: check 23 · npm test 170/160/0(스킵 10=브라우저) · 브라우저 45/45 · 오프라인 검증 통과 | docId는 META_KEYS 대신 LOCAL_META_KEYS · 파일 저장 시각은 core 'saved' 이벤트에서 기록 · P2-A 브라우저 테스트는 IndexedDB 차단 환경에서 실행(기대값 무변경) · 상세는 '계획 기록 — P2-B' | store.js 신규, io.js writer 훅, session.js(문서 id·보관·부팅 복원·옛 자동 저장 이전·충돌 대화상자), 상태 표시줄 '마지막 파일 저장', ui-v3:113 한 줄 교체 |
| 2026-11-23 | P2-C | refactor/p2-c-recent | 통과: check 24 · npm test 184/170/0(스킵 14=브라우저) · 브라우저(SF_HEADERS=1) 57/57 · 오프라인 검증 통과(캐시 45개) | ①공간 부족(QuotaExceededError)이면 최근 작업 창을 사용량과 함께 열되, 탭마다 처음 한 번만 자동으로 열고 그 뒤로는 토스트의 [최근 작업] 버튼으로 안내(실패할 때마다 모달이 뜨면 편집 중 포커스를 뺏음) ②보관된 기록을 여는 일은 SF.session.openDoc(id)로 한 곳에 모음(결과 opened/canceled/missing/unreadable) — 최근 작업 창과 되돌리기 토스트가 같이 씀 ③io.jsonFileText(data) 추출(saveJSON과 출력 동일) — 목록의 내려받기가 같은 파일 형식을 씀 ④지금 열린 문서의 내려받기는 화면의 악보 기준(일반 저장과 같고 파일 저장 시각이 남음), 나머지는 보관된 기록 그대로(기록은 건드리지 않으므로 '마지막 파일 저장'에는 반영 안 됨) ⑤목록에서 열 때 창을 먼저 닫고 취소·실패하면 목록으로 되돌아옴(토스트·확인 창이 모달 뒤에 가려지지 않게) ⑥토스트에 버튼이 있으면 마우스·키보드가 올라가 있는 동안 타이머를 멈추고 6초, 숨은 토스트는 visibility:hidden(버튼이 탭 순서에 남지 않게) ⑦다른 탭 편집 중 표시는 SF.lock?.heldElsewhere?.() 훅과 번역 문구만 마련(2-D에서 채움) ⑧P2-B 브라우저 테스트 2곳은 토스트 전체 글자 대신 문구 부분(#toast > span)을 같은 문자열로 비교하고 [되돌리기] 존재를 추가 확인(기대 문구 무변경) | js/recent.js 신규(163줄) · recent.test 5 + recent-browser 12 + session.test 5 추가. 변이 검사 7종(제목을 HTML로 넣기·현재 문서 삭제 허용·공간 부족 창 매번 열기·되돌리기 버튼 제거·같은 문서에도 버튼·깨진 기록 무시·토스트 버튼 잔류) 모두 테스트가 잡음. 화면 확인: 어두운·밝은·Pretty·Cute 테마와 폭 390px. 측정: 300마디 366KB 문서 100건에서 listDocs 250ms·창 열기 208ms — restoreOnBoot가 부팅 때마다 listDocs를 부르는 점은 P2-E에서 지연 호출로 고칠 것. 관찰: 밝은 테마들에서 .tbtn.danger의 빨강이 테마 CSS에 덮여 삭제 버튼이 일반 버튼처럼 보임(기존 현상, Phase 9에서). 로그 정리: 흩어져 있던 P1-2~P1-5·P2-A·P2-B 행을 Step 표로 옮기고 logrow가 Step 표 끝에 붙이도록 고침 |
| 2026-11-23 | P2-D 탭 간 충돌 방지 | refactor/p2-d-tab-lock | 통과 — check 26개, npm test 222건(205 통과·0 실패·17 건너뜀), 브라우저 69/69(새 lock-browser 12), 오프라인 검증 47파일·오류 0, 변이 검사 23건 전부 잡힘 | ①풀림 "안정화"(settle 800ms, 놓았다 곧바로 다시 잡는 새로고침이면 알리지 않음) 추가 ②쓰기 직전 안전망(교체 통로 밖에서 들어온 악보도 잠금을 잡고, 남이 쥔 문서는 저장 실패로 처리) 추가 ③restoreOnBoot가 listDocs를 필요할 때만 읽음(2-E 예정분을 앞당김) ④부팅 데모는 claim 대신 adopt(잠금까지) ⑤최근 작업 창이 열려 있으면 docs-changed·doc-closed로 저절로 새로 그림(초점 유지) ⑥사본 제목 접미사는 언어에 맞춰 " 사본"/" (copy)" | SF.lock(acquire·heldElsewhere·watch·notify·onMessage), SF.session.lockState/onLock/resume/copyForEditing/adopt, js/lock-ui.js(배너), body.tab-locked. Web Locks 없는 브라우저는 BroadcastChannel ping(200ms)+tabId 비교로 대체, 둘 다 없으면 막지 않고 엶. 실제 Safari·Firefox 다중 탭 확인은 사람이 해야 할 일에 기록 |
| 2026-11-23 | P2-E 부팅 안전 모드 | refactor/p2-e-safe-boot | 통과 — check 27개, npm test 253건(235 통과·0 실패·18 건너뜀, 새 테스트 schema 9·boot 21·boot-browser 1묶음 8건), 브라우저 78/78(새 boot-browser 9), 오프라인 검증 48파일·CSP 위반 0·오류 0, 변이 검사 36건 전부 잡힘(쓰이지 않는 force 인자 1건은 죽은 코드라 삭제, 격리 위 고정은 테스트 보강 뒤 잡힘) | ①손상 기록 처리를 4종으로 나눔: 설치 전에 읽을 수 없는 기록→격리하고 다음 정상 문서로(없으면 데모), 설치·첫 렌더 예외→격리+데모, 지난 부팅이 끝나지 못한 표시→자동으로 안 열고 안전 모드 대화상자, 이미 격리된 기록→자동 선택에서 조용히 제외(기존 테스트 P2-B ⑦의 '다음 정상 문서로 건너뜀'과 설계서의 '격리+데모'가 부딪혀 둘 다 살림) ②boot.pending은 문서 하나가 아니라 {문서ID: 시각} 맵(여러 탭 동시 부팅 때 서로의 표시를 지우지 않음, 20개 상한) ③격리·표시 쓰기는 store.updateDoc/updateKv의 한 트랜잭션(읽은 뒤 다른 탭이 새로 저장했으면 덮어쓰지 않음) ④숨은 탭은 프레임이 멈추므로 첫 렌더 대기를 건너뜀(상한 1.5초) ⑤tests/session.test.mjs 구조 고정 테스트의 app.js 직접 C.setScore 개수 3→1(설계 항목 6이 허락한 유일한 기존 테스트 수정; lock.test의 고정 문구는 코드를 맞춰 그대로 통과) | js/schema.js 신규(checkShape·ScoreFormatError), session.bootInfo/bootBegin/bootDone/bootFailed/bootOpenPending/bootSkipPending/bootDownloadPending, store.updateDoc/updateKv, 최근 작업 ⚠️ 행(맨 위·내려받기 우선). 알려진 한계: IndexedDB를 못 쓰는 브라우저(localStorage 대체)는 격리 없음, 실제 Safari·Firefox 확인은 사람이 해야 할 일 |
| 2026-11-23 | P3-3 GitHub Actions CI | refactor/p3-3-ci | 통과(로컬 재현) — unit 잡 명령(check 27·npm test 254/236/0/18·릴리스 파일 최신 확인) 통과, browser 잡 명령(SF_HEADERS=1 서버 + tests/*.test.mjs 전체, --test-concurrency=1, SF_BLOCK_SAMPLES=1, PW_CHANNEL=chrome) 313건 전부 통과·건너뜀 0·135초, ui-v3 4회 연속 13/13 | ①액션 메이저는 gh로 확인하지 못해(이 세션에서 GitHub 접속 불가) 프롬프트의 v4를 그대로 씀 — 검색으로는 checkout·setup-node가 더 새 메이저(v7)까지 나온 것으로 보임, 적용 시점에 최신으로 올릴 것 ②CI의 번들 Chromium(PW_CHANNEL 없음)은 이 환경에서 받을 수 없어 시스템 Chrome으로 대신 검증 ③ui-v3의 간헐 실패(MIDI 옵션 결과 경쟁 상태)에 기다림 한 줄 추가(단언 그대로) | 실제 GitHub에서 PR로 처음 돌려 보는 것(gh pr checks), 실패 시 playwright-output 아티팩트 업로드 확인은 push가 필요해 사람이 해야 할 일에 기록. workflow YAML은 파서로 구조만 확인 |
| 2026-11-23 | P3-5 버전 단일화 + 셸 해시 | refactor/p3-5-version | 통과 — check 27개, npm test 263건(245 통과·0 실패·18 건너뜀, 새 release.test 9건), CI 명령 재현(tests/*.test.mjs 전체) 322건 전부 통과, 오프라인 검증 48파일·CSP 위반 0·오류 0(캐시를 접두로 찾음), npm run release 2회 연속 결과 동일(멱등), css 공백 1개 추가 → sw.js 해시만 변경, CRLF로 바꿔도 해시 동일, 변이 검사 9건 전부 잡힘 | ①해시·목록·정규화를 tests/release-lib.mjs로 분리(prepare-release와 테스트가 같은 함수 사용) ②기존 테스트 변경은 계획대로 3곳(prepare-release 마지막 검사·pwa.test 51–52행·verify-offline 25행), 모두 같은 뜻을 새 모양(버전+해시 8자리)에 맞춘 것 ③새 release.test는 npm test에 들어가 있어 npm run release를 잊으면 CI 이전에 바로 실패 | package.json의 version만 고치고 npm run release. 셸 파일을 바꾸면 커밋 전에 npm run release(또는 node tests/prepare-release.mjs). 첫 배포 뒤 기존 설치본의 업데이트 알림은 사람이 확인 |
| 2026-11-23 | P3-6 배포 후 자동 점검(선택) | refactor/p3-6-deploy-smoke | 통과 — tests/verify-deploy.mjs를 로컬 서버(8000·8001)에 돌려 통과(첫 응답 200·CSP 문제 0·SF.VERSION=3.1.0·페이지 오류 0), 새 deploy.test 6건(단위 4 + 브라우저 2: 좋은 서버 통과, CDN 허용·버전 불일치·첫 화면 예외 서버는 각각 실패), 변이 6건 전부 잡힘 | ①워크플로에 checkout ref를 배포된 커밋(github.event.deployment.sha)으로 지정 — 그래야 그 커밋의 package.json 버전과 비교됨(프롬프트북에 없던 보강) ②SF_URL은 env로만 넘김(셸 문자열에 끼워 넣지 않음) ③CSP 판정은 tests/deploy-lib.mjs로 분리해 단위 테스트 | 실제 GitHub·Vercel에서의 첫 실행은 push·배포가 필요해 사람이 해야 할 일에 기록(환경 이름이 Production이 맞는지 첫 로그에서 확인) |
| 2026-11-23 | P4-1 공유 로더와 동시 요청 제한 | refactor/p4-1-shared-loader | 통과 — check 27개, npm test 281건(261 통과·0 실패·20 건너뜀, 새 테스트 12건), CI식 전체 실행 340/340(브라우저 포함), 오프라인 검증 48파일·CSP 위반 0·오류 0, 변이 검사 16건 전부 잡힘 | ①슬롯을 응답 헤더가 아니라 본문을 다 읽었을 때 돌려줌(설계서 스케치는 fetch 완료 때 반환 — 본문 수신이 겹쳐 4개 제한이 무의미해짐. 200이 아닌 응답·요청 실패·동기 예외는 즉시 반환, 본문을 읽지 않고 붙잡으면 30초 뒤 반환) ②같은 kind(Splendid)는 한 번에 하나씩 로딩(실제 smplr로 확인: 공유 loader만 쓰면 동시에 시작한 두 인스턴스가 같은 URL을 각자 내려받아 452회 디코딩, 차례로 시작하면 226회 — 공유가 실제로 효과를 내려면 필요) ③SampleLoader가 없는 smplr 모듈이면 loader 없이 진행 | js/playback.js(+69줄: limitedStorage·loaderFor·inTurn, createSampleInstrument에 storage·loader), tests/playback-harness.mjs(가짜 AudioContext·fetch·smplr를 vm에 올리는 도구, P4-4가 재사용), tests/playback-samples.test.mjs 12건(제한기 5·loader 공유·Soundfont storage·구버전 모듈·차례 로딩·실패 비전파·악기 간 공통 제한·실제 smplr 디코딩 1회). 샘플 요청은 전과 같이 전역 fetch(url)을 쓰므로 서비스 워커(sw.js:91, 샘플 호스트 3곳 캐시)를 그대로 거침. Soundfont는 smplr 내부에서 인스턴스마다 디코딩해 공유 효과가 없음(설계서대로 4-2의 해제로 누적을 막음) |
| 2026-11-23 | P4-2 쓰지 않는 악기 해제(releaseUnused)·debugStats | refactor/p4-2-release-unused | 통과 — check 27개, npm test 294건(273 통과·0 실패·21 건너뜀, 새 테스트 단위 12건 + 브라우저 1건), CI식 전체 실행 353/353, 오프라인 검증 48파일·CSP 위반 0·오류 0, 변이 검사 18건 전부 잡힘 | ①정리 기준은 설계서 스케치의 파트ID가 아니라 키(파트ID:악기) — 스케치대로면 같은 파트의 악기를 바꿨을 때 이전 악기가 남아 '악기를 바꾼 mutate 뒤 해제' 호출이 아무 일도 못 함 ②재생·재생 준비 중에 불리면 정리를 하지 않고 재생이 멈출 때로 미룸(releasePending → stop()이 처리). 이유: 쓰는 중인 악기를 dispose하면 곡 도중 샘플이 끊겨 신스로 바뀌고, 정리하려고 재생을 멈추면 사용자가 보는 동작이 바뀜. play() 맨 앞은 stop(false) 직후라 항상 즉시 정리 ③로딩 중(차례 대기·모듈 대기 포함)에 악보에서 빠진 파트는 rec.released로 표시해 악기·버스를 만들지 않고, 뒤늦게 끝나거나 실패해도 '샘플 준비'·'신스 사용' 알림을 내지 않음 ④로딩에 실패한 기록을 다시 만들 때 이전 시도의 악기를 dispose | 호출 위치: 악보 교체는 app.js installScore의 stopPlayback() 바로 뒤 한 곳(정적 테스트가 js/ 전체에서 이 한 곳뿐임을 확인), 재생 준비는 play() 맨 앞, 미룬 정리는 stop() 끝. C.onChange의 setScore 분기는 그 시점에 아직 재생이 멈추지 않아(installScore가 C.setScore 뒤에 stopPlayback) 쓰지 않음. preview 인스턴스·버스는 지우지 않음(설계서대로) — 건반 미리 듣기로 악기를 바꿔 본 종류만큼 최대 8개까지 남을 수 있음. 새 파일 tests/playback-release.test.mjs, tests/playback-browser.test.mjs(실제 앱 흐름으로 악보를 바꾸면 옛 파트의 악기·버스가 정리됨) |
| 2026-11-23 | P4-3 기본 피아노 음원 (D2-A) | refactor/p4-3-default-piano | 통과 — check 27개, npm test 307건(284 통과·0 실패·23 건너뜀, 새 테스트 단위 11건 + 브라우저 2건), CI식 전체 실행 366/366, 오프라인 검증 48파일·CSP 위반 0·오류 0, 변이 검사 19건 전부 잡힘 | ①설계서 4-3 표 A안 그대로: SAMPLE_MAP.piano = Soundfont acoustic_grand_piano, SAMPLE_MAP.pianoHQ = Splendid, sampleKey가 이 기기의 설정으로 piano → pianoHQ를 고름. 악기 이름은 악보 데이터에 계속 "piano"로 저장되므로 기존 악보·파일 호환 ②설정 변경은 '적용' 버튼을 기다리지 않고 바로 저장(악보 설정이 아니라 이 기기 설정이기 때문 — 안내는 선택 상자 title과 토스트로). 바꾸면 재생을 먼저 멈춤(곡 도중 음원이 바뀌지 않게) → 이전 음질의 인스턴스·loader를 releaseUnused로 내림 ③같은 값을 다시 고르면 무동작, 알 수 없는 값은 기본으로 봄, localStorage가 막힌 브라우저는 예외 없이 이번 접속 동안만 적용 ④바꾼 직후 새 음원을 미리 받지는 않음 — 다음 재생 준비 때 불러오므로 바꾼 뒤 첫 재생은 신스로 시작할 수 있음(재생 전 미리 로딩은 9-4에서 다룸) | 기존 P4-1·P4-2 테스트는 Splendid(loader) 동작을 검사하므로 harness에 hq 옵션(음질 설정을 고음질로 시작)을 추가해 고음질로 시작하게만 바꿈 — 단언은 하나도 바꾸지 않음. harness는 localStorage·TextEncoder를 vm 컨텍스트에 제공. 새 파일 tests/playback-quality.test.mjs(기본 음원·고음질·저장/복원·잘못된 값·저장소 차단·무동작·전환 시 정리·재생 중 전환·악보 데이터 불변·설정 화면 연결), tests/playback-browser.test.mjs에 실제 앱 흐름(설정 창 선택 → 저장 → 새로고침 뒤 유지)과 영어 화면 번역 확인 2건. 문구는 js/i18n.js에 등록(라벨·선택지·안내·토스트 2종) |
| 2026-11-23 | P4-4 인스턴스 수명 불변식 테스트·메모리 측정 안내 | refactor/p4-4-lifecycle-test | 통과 — check 27개, npm test 320건(297 통과·0 실패·23 건너뜀, 새 테스트 13건), CI식 전체 실행 379/379, 오프라인 검증 48파일·CSP 위반 0·오류 0, 변이 검사 13건 전부 잡힘 | ①테스트용 훅 P.__setSmplrModuleForTest(mod) 추가. 설계서 스케치(smplrModule에 바로 대입)와 달리 별도 변수(smplrOverride)에 두고 import 경로보다 먼저 확인 — 이미 진행 중인 실제 import가 끝나면서 훅을 덮어쓰는 일을 막기 위해. null이나 모듈이 아닌 값을 주면 해제(원래 import 경로로). 앱 코드(js/)는 이 훅을 부르지 않음(정적 테스트로 고정) ②audioio-v3.test.mjs의 소스 바꿔치기는 선택 사항이라 바꾸지 않음(기존 테스트 변경 없음). harness에 hook 옵션을 더해 새 테스트만 훅을 씀 — P4-1·P4-2 테스트는 import 바꿔치기 경로 그대로 ③'재생 준비'는 앱이 악보를 열 때의 순서(installScore: setScore → 재생 멈춤 → releaseUnused)와 play()를 그대로 따르고, installScore를 거치지 않고 악보만 바뀐 경우(play() 맨 앞의 정리)도 따로 검증 ④기대값: updateMixer가 드럼 파트에도 믹서 버스를 만들므로 buses = 모든 파트 수, instances = 연주(드럼 아닌) 파트 수, loaders = 쓰는 Splendid 종류 수(고음질 피아노가 있을 때만 1) ⑤설계서가 말한 PERF.md의 실제 위치는 tests/baseline/PERF.md — 거기에 "Phase 4 후 재생 메모리" 절(표 + D-3 절차)을 추가, 기존 내용은 그대로 | 새 파일 tests/playback-lifecycle.test.mjs: 기본·고음질 각각 ①A(피아노 2)→B(피아노 3, 다른 파트 ID)→C(현악 3+드럼)를 세 바퀴 ②installScore 없이 play만 ③같은 악보 재준비 ④파트 악기만 바꾸기(다른 파트·버스 유지) ⑤미리 듣기(preview)는 하나씩만 남음, 그리고 악보 비우기·훅 동작·훅 사용처 정적 검사. 지난 악보의 악기는 정확히 한 번씩 dispose(fake 악기에 disposeCalls 추가). Phase 4 DoD: 불변식 테스트 통과 ✔, +50MB·Long Task는 사람이 측정(위 (P4-4) 항목) |
| 2026-11-23 | P5-A1 단일 성부 판정(기둥 방향) | refactor/p5-a1-stem-dir | 통과 — check 27개, npm test 337건(314 통과·0 실패·23 건너뜀, 새 테스트 17건), CI식 전체 실행 396/396(브라우저 포함), 변이 검사 20건 전부 잡힘, 고친 기존 테스트 0건(기둥 방향 기대값을 가진 기존 테스트가 없어 승인 대기 사항 없음) | ①타이·슬러·슬러 회피는 설계서처럼 le.multiVoice로 다시 계산하지 않고 renderNote가 실제로 그린 방향(le.stemDir)을 우선 사용 — 빔 묶음 안의 음은 음마다가 아니라 묶음 전체 방향을 따르기 때문(예: G4 G4 F5 F5 묶음은 아래로 가는데 음마다 계산하면 G4는 위라서 타이·슬러가 기둥 쪽으로 지나감, 테스트로 고정). 기록이 없는 드럼·TAB·쉼표는 예전 성부 규칙 그대로. 부수 효과: 손으로 고른 기둥 방향(stemDirection)에도 타이·슬러가 반대쪽을 따름(예전에는 무시) ②renderBeamRun에 설계서 표(rn.items[0].multiVoice)만 적용하면 드럼·TAB 빔도 음높이로 판정됨(드럼 이벤트는 notes가 비어 평균이 NaN이 되어 아래로 뒤집힘) — 표준 보표만 새 규칙, 드럼·TAB 빔은 성부 규칙(위) 유지하는 가드를 두고 특성 테스트 2건으로 고정. 음높이 판정에는 S 대신 묶음 첫 음의 보표(le.staff)를 씀 — S에는 옥타바 이동(ottavaSteps)이 없어 8va 구간의 빔이 잘못 판정되기 때문(테스트 1건) ③설계서 테스트 5종 + 추가 12종(2성부 중 한 성부가 쉼표뿐/성부 수는 보표마다/가운데 줄 경계/슬러 회피/드럼·TAB 불변 등) | 기준 이미지(PNG)는 아직 그대로 — P5-A2에서 다시 만들고 사람이 확인. 한 성부 마디에서만 규칙이 바뀌고 2성부 이상 마디의 방향은 예전과 같다(테스트로 확인). multiVoice를 안 넘기는 호출부(renderDrumNote·renderTabNote·renderGraceBefore)는 변경 없음 |
| 2026-11-23 | P5-A2 기준 이미지 갱신용 --png-only 옵션 (PNG 재생성은 🧑 대기) | refactor/p5-a2-baseline-png | 코드 부분 통과·그림 갱신은 사람 대기 — tests/capture-baseline.mjs에 --png-only 추가(PNG 4장만 쓰고 기준 JSON·MusicXML·MIDI·ARCHITECTURE_NOTES·PERF·CONSOLE은 쓰지 않음, 옵션 없으면 예전처럼 20개 전부), 새 브라우저 테스트 2건(임시 폴더에서 두 모드를 실제로 실행해 파일 목록 확인), 변이 검사 9건 전부 잡힘, check 27개·npm test 339건(314 통과·0 실패·25 건너뜀, 브라우저 테스트는 CI식 실행에서 확인) | ①마지막 단계가 http://127.0.0.1:8000/tests/browser.html로 고정돼 있어 SF_URL을 바꾸면 어긋나던 것을 SF_URL 기준으로 고침(기본값은 그대로) ②PNG 재생성은 하지 않음 — 원래 기준 그림을 만든 Edge(msedge)가 이 환경에 없고 Chrome으로 만들면 글꼴 렌더링 차이로 그림 전체가 달라져 사람이 기둥 변화만 비교할 수 없음(프롬프트북: Edge가 없으면 보고하고 사람에게 묻는다) | 옵션 없이 capture-baseline을 돌리면 이벤트 id가 달라져 기준 JSON·MusicXML·MIDI 13개가 전부 바뀐다(이 환경에서 실제로 확인) — 그림만 갱신할 때는 반드시 --png-only. 기준 PNG는 자동 테스트가 읽지 않으므로 갱신이 늦어져도 테스트는 영향 없음 |
| 2026-11-23 | P5-B1 relayout 후처리의 반복 검색 제거 | refactor/p5-b1-hit-map | 통과 — check 27개, npm test 340건(314 통과·0 실패·26 건너뜀), CI식 전체 실행 399/399(브라우저 포함: 음표 클릭·화음 개별 음 선택 테스트 통과), 새 브라우저 테스트 1건(layout의 음표머리와 화면의 .note-hit이 1:1·좌표·크기까지 일치 — 데모 4곡·화음(2도 어긋남)·2성부·두 보표·100마디 쪽 나누기), 변이 검사 10건 전부 잡힘. 편집 지연(같은 세션 번갈아 3회) 중앙값 331ms → 220ms | ①설계서 코드와 같은 구조(data-ref → 요소 Map 한 번 훑기, 이벤트별 [data-note] 표)이되, 같은 id·같은 머리 번호가 겹치면 문서에서 먼저 나온 것을 쓰도록 했다(예전 querySelector의 동작과 같게 — 설계서 코드는 마지막 것이 이김). 머리가 없는 이벤트는 조회 전에 건너뜀 ②만들어지는 note-hit은 예전과 같다는 것을 옛 코드에서 먼저 통과시킨 뒤 새 코드로 다시 통과시켜 확인(특성 테스트 → 변경 순서) | 측정은 같은 세션에서 앞뒤를 번갈아 재야 의미가 있다: 이 세션의 리팩토링 전 master는 중앙값 373~436ms로 처음 기준(306ms)보다 느렸다(환경 차이). 표는 tests/baseline/PERF.md "Phase 5 후 편집 지연". 5-B2에서 후처리를 아예 없앤다 |
| 2026-11-23 | P5-B2 클릭 영역을 조판 단계에서 생성 | refactor/p5-b2-engrave-hits | 통과 — check 27개, npm test 350건(324 통과·0 실패·26 건너뜀, 새 테스트 10건), CI식 전체 실행 409/409(브라우저 포함: 새 hit-browser·ui-v3 음표 클릭·화음 개별 음 선택), 변이 검사 21건 전부 잡힘(동등 변이 2건은 제외 — finally의 emitHits 복원은 render()가 호출마다 처음에 다시 정하므로 결과에 영향이 없다). app.js는 1,100줄(relayout 후처리 삭제), 내보내기 SVG·PNG·인쇄물에 note-hit 0개(테스트로 확인). 편집 지연(같은 세션에서 세 코드 번갈아 3회) 5-B1 전 347ms → 5-B1 후 240ms → 5-B2 후 236ms | ①클릭 영역을 data-note 머리 그룹의 마지막 자식으로 조판기가 그린다(설계서 스케치 그대로). 좌표·크기는 le.noteheads와 같은 값을 소수 둘째 자리로 반올림해 찍는다(예전 후처리는 반올림 없이 그대로였으므로 최대 0.005 차이) ②내보내기 판단 방식은 설계서에 구체적으로 없어서, render()의 모듈 변수 emitHits(opts.export로 호출마다 정하고 finally에서 되돌림)로 했다. 되돌리는 줄은 기능상 중복이지만 예외가 나도 상태가 남지 않게 두었다 ③TAB·드럼 머리도 같은 방식(box를 변수로 뽑아 le.noteheads와 hit이 같은 값을 쓴다) | 5-B2의 지연 변화(240 → 236ms)는 측정 오차 안이다: 속도는 5-B1이 올렸고 5-B2는 구조 정리(클릭 영역을 만드는 곳이 조판기 한 곳, 내보내기에는 절대 안 들어감). 중앙값이 300ms 미만이라 DECISIONS P5는 '안 당김'. E.render 호출 위치를 정적으로 검사하는 테스트 추가: 화면용은 app.js relayout 한 곳, 내보내기 두 경로는 export-ui.js. 표는 tests/baseline/PERF.md |
| 2026-11-23 | P6-1 파일 메뉴를 popover로 | refactor/p6-1-file-popover | 통과 — check 28개(js/menus.js 추가), npm test 371건(335 통과·0 실패·36 건너뜀, 새 노드 테스트 11건), CI식 전체 실행 430/430(새 브라우저 테스트 9건 포함: 1200·900·375·360px, 키보드, Esc, 바깥 누름, 크기 변경, Popover 미지원 흉내), 변이 검사 45건 중 동등 4건을 뺀 41건 전부 잡힘. 같은 방식으로 옛 코드(4a1329f)를 재 보면 375×667·360×640·900×800에서 마지막 항목 중심점의 최상위 요소가 항목이 아니다(상단바가 잘라 voice-btn·palette-tabs가 보임), 새 코드는 모든 폭에서 항목이다 | ①프롬프트북 4번은 Popover 미지원 브라우저에서 "기존 방식 유지(6-3의 overflow 해제가 대체)"인데, 미지원 경로도 같은 위치 계산 + position:fixed + .open 클래스로 했다(fixed는 부모 overflow에 잘리지 않아 6-3에 기대지 않는다. setup이 미지원이면 popover·popovertarget 속성을 걷어 낸다) ②위치 계산은 열린 뒤 toggle이 아니라 열리기 직전 beforetoggle에서 한다(한 프레임 깜박임 방지). 닫혀 있는 메뉴의 너비는 잠깐 보이지 않게 펼쳐 left=0에서 잰다 — 처음엔 현재 자리에서 재서 375px에서 메뉴가 오른쪽 가장자리를 넘었고 브라우저 테스트가 잡아 고쳤다 ③CSS는 #file-menu[popover] 대신 .menu[popover]로 써서 6-2·6-3의 메뉴가 같은 규칙을 쓴다 ④바깥 pointerdown 보조 코드는 Popover 미지원 경로에만 둔다(구형 iOS는 popover 자체가 없어 그 경로이고, 지원 브라우저는 바깥 누름 닫기를 내장) ⑤키보드(↑↓·Home·End·Esc·Tab 나가면 닫기·버튼에서 ↓↑로 열기)에 더해, 메뉴가 열려 있는 동안 Esc와 글자 키가 전역 단축키(재생 정지·입력 모드)로 새지 않게 막았다 ⑥내보내기(export-ui.js) 항목 클래스 menu-item을 mi로 통일했고, ui-v3.js의 .mi tabIndex·role 부여 줄은 지웠다(마크업이 대신하고, 버튼은 Enter·Space가 기본 동작) ⑦기존 테스트는 고치지 않았다(tests/cloud.test.mjs 하네스 그대로 통과) | 메뉴 항목은 이제 고정 13 + 내보내기 2 + 클라우드 4 = role="menuitem" 19개 + 자동저장 menuitemcheckbox 1개이고, 브라우저 테스트가 이 개수와 .mi 스타일 적용을 못 박아 둔다. 변이 동등 4건: onDocKey의 열림 확인과 닫는 순간 detach는 한쪽만 빼면 다른 쪽이 막아 주고(둘 다 빼면 잡힘), closeOthers는 메뉴가 하나뿐이라 P6-2에서 두 메뉴로 확인, cloud.js의 닫기 순서는 관찰 불가. 실기기 확인은 (P6-4)에서 한꺼번에 |
| 2026-11-23 | P6-2 계정 메뉴 | refactor/p6-2-account-menu | 통과 — check 28개, npm test 383건(340 통과·0 실패·43 건너뜀, 새 노드 테스트 5건), CI식 전체 실행 442/442(새 브라우저 테스트 7건: 375px 로그인 흐름, 1200↔375↔1200 오가기·리스너 유지·열린 채 넓히기, 500/501 경계, 메뉴 하나만 열림, Popover 미지원 흉내, 키보드, 스크립트 실행 전 첫 그리기 CSS), 변이 검사 21건 중 동등 1건을 뺀 20건 전부 잡힘(P6-1에서 동등으로 남겼던 closeOthers 제거도 이번 테스트가 잡는다) | ①프롬프트북은 .authbar를 #account-menu 안으로 옮기라고만 했는데, 계정 팝오버는 안에 로그인·회원가입·관리자 같은 일반 버튼 묶음이 들어가므로 role="menu"가 아니라 role="group"으로 두고 setup의 items 옵션으로 "button"을 항목으로 쓴다. 그래서 #btn-account에는 aria-haspopup을 붙이지 않는다(setup은 role="menu"일 때만 붙임) ②≤500px에서 .authbar를 통째로 숨기던 옛 규칙(.topbar .authbar)은 지웠고, 스크립트가 .authbar를 옮기기 전 한 프레임 깜박임만 막는 .topbar > .authbar{display:none}(≤500px)을 남겼다. 옮긴 뒤에는 .authbar가 .account-wrap 안에 있어 이 규칙이 닿지 않는다 ③설계서에 없던 공개 함수 SF.menus.open·SF.menus.dock을 추가했다. dock은 원래 자리에 주석 노드를 남겨 되돌아갈 위치를 기억하고, 미디어 쿼리 change 이벤트(구형 Safari는 addListener)를 듣는다 ④.authbar에 role="group" aria-label="회원 메뉴"를 달았다 ⑤js/auth.js는 건드리지 않았다 — 노드를 옮겨도 이벤트 연결이 유지되는 것을 375px 로그인 흐름 테스트로 확인 ⑥기존 테스트는 고치지 않았다 | 넓은 화면(501px 이상)의 상단바 배치는 그대로다. 열린 채 넓어지면 되돌리기 전에 메뉴를 먼저 닫는다(좁아질 때의 닫기는 관찰할 수 없어 코드를 지웠다 — 동등 변이 1건). 상단바 자체는 아직 .topbar max-height·overflow가 남아 375px에서 셋째 줄이 잘린다 → P6-3. 실기기 확인은 (P6-4)에서 한꺼번에 |
| 2026-11-23 | P6-3 상단바 정리 | refactor/p6-3-topbar | 통과 — 375×667 상단바 260px(화면의 39%, 7줄) → 83px(12.4%, 2줄), 360×640 83px(13.0%), 375×812 83px(10.2%), 가로 스크롤 없음(처음 쓴 값은 79px였으나 첫 줄·둘째 줄 줄바꿈 정리 뒤 최종 코드로 다시 재니 83px — P6-4 R-1에서 바로잡음). 501~900px는 스크롤 상자 없이 줄바꿈(768px 153px·900px 153px, 안쪽 스크롤 없음). check 28개, npm test 401건(346 통과·0 실패·55 건너뜀, 새 노드 테스트 6건), CI식 전체 실행 460/460(새 브라우저 테스트 12건: 5개 화면의 높이≤20%·안쪽/가로 스크롤 없음, 핵심 컨트롤 바로 누르기와 두 줄 구성, 열린 메뉴 안 컨트롤 전부 누르기, 테마·언어·빠르기·예비박·도움말·믹서 동작, 키보드, 1200↔375 오가기(자리까지 같음), 좁게 시작해 넓히기, 열린 채 넓히기, 501~900px, 메뉴 동시에 하나만, Popover 미지원 흉내, 스크립트 전 첫 그리기), 변이 검사 34건 중 타이밍 의존 동등 1건을 뺀 33건 전부 잡힘, 새 브라우저 테스트 12건은 옛 코드에서 전부 실패하는 것을 먼저 확인 | ①프롬프트북·설계서는 "테마·언어를 ⋯ 더보기로"만 적었다. 그것만으로는 두 항목이 이미 첫 줄에 있어 줄 수가 그대로(7줄, 260px, 39%)라 DoD(≤20%)를 못 맞춘다 — "넘으면 무엇을 더 숨길지 제안"에 따라 제안하고 스스로 승인했다: 로고·계정·파일·악보 설정·되돌리기·다시·처음·재생·정지·메트로놈·속성은 상단바에 남기고, 나머지(테마·언어·빠르기 상자(재생 속도·예비박·반복 포함)·스윙·믹서·보표·보기·보기 옵션·빈보표·Nav·Time·악기·건반·MIDI·MIDI 장치·단축키·도움말)를 ⋯ 더보기로 옮긴다 ②컨트롤을 하나씩이 아니라 index.html의 .more-group 3묶음째 옮긴다. 넓은 화면에서는 display:contents라 배치가 그대로이고(오가기 테스트가 자리까지 같음을 확인), uiV3.init가 부팅 한참 뒤(await 뒤)에 붙이는 재생·보기 옵션이 묶음 안에 붙으므로 옮겨진 상태든 아니든 제자리로 간다 — 하나씩 옮기면 그 시점 이후에 도킹해야 하고 첫 그리기가 7줄로 깜박인다 ③SF.menus.dock이 노드 배열을 받고, setup에 closeOn 옵션(기본값은 그대로)을 더했다. 메뉴 안 선택 칸·입력 칸에서는 ↑↓·Home·End를 메뉴 이동이 가로채지 않는다(값 바꾸기·숫자 올리기 유지). 선택 칸을 만지는 동안은 열어 두고 버튼을 누르면 닫는다 ④#btn-props(속성)는 상단바에 남겼다 — 기존 ui-v3 테스트가 375×812에서 이 버튼을 바로 누르고, 휴대폰의 간단한 수정에도 필요하다 ⑤첫 .tsep(설정·⋯ 뒤)를 폭 100%의 보이지 않는 선으로 써서 첫 줄(로고·계정·파일·설정 … ⋯)과 둘째 줄(되돌리기·재생·속성)을 나눴고, ⋯은 margin-left:auto로 오른쪽 끝에 둔다 ⑥P6-2에서 내가 쓴 계정 메뉴 브라우저 테스트의 도우미(where)가 "언어 선택 바로 다음"을 비교했는데 언어 선택이 묶음 안으로 들어가 "그 묶음 바로 다음"으로 고쳤다(같은 phase에서 쓴 테스트이고 확인하는 내용은 그대로) ⑦.topbar #sample-status 숨김 규칙은 샘플 표시가 더보기 안으로 옮겨져 #more-menu #sample-status로 바꿨다(여전히 숨김) ⑧번역 toolbar.more(더보기/More)·toolbar.accountMenu(계정 메뉴/Account menu)를 더했다(P6-2의 aria-label도 번역된다) ⑨기존 테스트는 고치지 않았다 | 4개 테마(dark·light·pretty·cute)에서 더보기 메뉴 모양을 스크린샷으로 확인했다. 알려 둔 한계: 가로 방향 휴대폰(폭 501px 이상)은 상단바가 3~4줄(약 150px, 높이 375px의 40%)이다 — 이전에는 148px 상자에 가두고 스크롤했으나 지금은 전부 보이게 줄바꿈하므로 나빠지지는 않았고, 개선은 Phase 9 후보. 동등 변이 1건: 되돌리기 전에 닫는 줄(D05)은 같은 프레임 안에 resize 처리기가 닫아 결과가 같다. iOS Safari에서 더보기 안 선택 칸을 눌러 값을 고를 때 팝업이 유지되는지는 실기기 확인 항목에 포함((P6-4)) |
| 2026-11-23 | P6-4 화면 폭 테스트 | refactor/p6-4-width-tests | 통과 — check 28개, npm test 414건(348 통과·0 실패·66 건너뜀, 새 노드 테스트 2건), CI식 전체 실행 473/473(새 브라우저 테스트 11건: ①6개 폭(360·375·768·900·901·1200)마다 파일 메뉴 맨 아래 항목 한가운데가 화면 안이고 그 자리의 최상위 요소가 그 항목, 로그인(≤500px는 👤 계정 메뉴 안, 501px 이상은 상단바)을 눌러 열리는 로그인 창이 화면 안·안쪽 가로 스크롤 없음·제출 버튼에 손이 닿음, documentElement·body 가로 스크롤 없음(처음·파일 메뉴·계정 메뉴·더보기 메뉴를 연 상태) ②D3 안내 3건: 360·375px에서 믹서·타임라인·내비게이터 버튼과 F11·F12가 창을 열지 않고 안내 토스트만 띄움(영어 포함), 500/501px 경계와 폭을 바꾼 뒤에도 누르는 순간의 폭을 따름 ③D3 범위 2건: 360·375px에서 악보가 보이고 음표를 눌러 삭제(쉼표로)·실행 취소·다시 실행·재생·정지가 됨), 6개 폭 테스트는 Phase 6 이전 코드(phase/p5-stems-render)에서 6건 전부 실패하는 것을, 안내 테스트 3건은 안내 코드를 빼면 실패하는 것을 먼저 확인, 변이 검사 27건 중 23건 잡힘(나머지 4건은 무해·동등으로 판단 — 메모) | ①프롬프트북·설계서는 "믹서·타임라인 같은 고급 패널은 좁은 화면에서 데스크톱 안내로 두고 테스트에서 제외"라고만 했다. 실제로는 375px에서도 믹서(359×166)·내비게이터(335×502)·타임라인(335×176)이 가로 넘침 없이 열렸다. 그래도 D3(보기·재생·간단한 수정)의 뜻대로 ≤500px에서는 창을 열지 않고 토스트로 "○○는 데스크톱에서 사용할 수 있어요"만 알린다 — 경계는 ⋯ 더보기·계정 메뉴와 같은 500px. panels.js의 desktopOnly() 한 곳을 버튼·F11·F12(·명령 팔레트)가 모두 지나고, 누르는 순간의 폭을 보므로 회전·창 크기 변경에도 맞다. D3을 "전체"로 바꾸면 이 함수가 항상 false를 돌려주게 하고 이 phase의 D3 테스트 5건을 "폭마다 열고 닫기"로 바꾸면 된다 ②"고급 패널"의 범위를 믹서·타임라인·내비게이터(⋯ 더보기로 옮긴 데스크톱 전제 패널)로 해석했다. 속성 패널·악보 설정·건반·MIDI·도움말·단축키는 보기·재생·간단한 수정에 필요해 그대로 둔다 ③영어 문구 3개(toast.desktopMixer·desktopTimeline·desktopNavigator)를 더했다 ④같은 phase(P6-3)에서 내가 쓴 테스트 1건을 고쳤다: topbar-browser.test.mjs의 "더보기 안 컨트롤이 실제로 동작한다" 끝부분이 "375px에서 믹서 버튼을 누르면 믹서 창이 열린다"였는데 D3 안내로 바뀌어 "안내 토스트가 뜨고 믹서 창은 안 열리며 더보기 메뉴는 닫힌다"로 고쳤다(버튼을 누르면 메뉴가 닫히는 확인은 그대로) ⑤기존 다른 테스트는 고치지 않았다(ui-v3·security 브라우저 테스트는 1440px에서 패널을 열므로 영향 없음) | 변이 4건(나머지 23건은 전부 잡힘): F02 파일 메뉴의 maxHeight 미적용 = CSS `.menu`의 max-height:80vh가 대신 적용돼 메뉴가 조금 짧아질 뿐 맨 아래 항목에 닿는다(무해) · S02 `.statusbar` overflow:hidden 제거와 S04 `html,body` max-width:100vw 제거 = body{overflow-x:hidden}과 항목별 min-width:0이 이미 막고 있어 지금 내용으로는 넘치지 않는 방어용 중복 규칙(동등) · S03 `#piano-scroll` overflow-x = 대상 요소가 없는 죽은 CSS(style.css 1712행, Phase 9 정리 후보). 알려 둔 것: 360×640에서는 악보 설정 창이 한 화면보다 길어 적용·취소가 창 안쪽 스크롤 맨 아래에 있다(375×667에서는 한 화면) → 실기기 확인 (P6-4)⑧. 유저 매뉴얼(manual/)에는 "휴대폰에서 믹서·타임라인·내비게이터는 안내만 뜬다"를 아직 적지 않았다(Phase 9 문서 정리 때) |
| 2026-11-23 | P6-1b 메뉴 처리기를 열리는 순간에 붙이기 (R-2 중 발견한 간헐 실패) | refactor/p6-1b-menu-attach-early | 통과 — check 28개, npm test 419건(349 통과·0 실패·70 건너뜀, 새 노드 테스트 1건), CI식 전체 실행 478/478(새 브라우저 테스트 4건: ①파일·계정·더보기 메뉴를 SF.menus.open()으로 열자마자(같은 작업 안이라 toggle 이벤트가 올 수 없는 틈) Esc를 보내면 메뉴가 닫히고, 그 Esc는 막혀 전역 단축키로 번지지 않으며, aria-expanded도 false ②같은 틈에 resize 이벤트를 보내도 메뉴가 버튼 아래로 다시 놓임), 새 시험 5건(노드 1·브라우저 4)은 옛 코드에서 전부 실패하는 것을 먼저 확인, 변이 검사 7건 전부 잡힘(노드 정적 6건·fallback 브라우저 시험 1건) | 설계서에 없는 수정이다. 3.4.0 릴리스 후보의 CI식 전체 실행에서 473건 중 1건(P6-1 "바깥 누름·화면 크기 변경"의 waitForFunction 10초 시간 초과)이 간헐적으로 실패했고, 같은 시험 묶음을 반복하자 P6-4 360×640·375×667의 "⋯ 더보기 Esc 뒤 닫힘 대기"도 실패했다. 시험을 느슨하게 하지 않고 원인을 추적했더니 시험의 경쟁 상태가 아니라 P6-1에서 내가 만든 js/menus.js의 틈이었다: 네이티브 Popover는 showPopover() 직후 메뉴가 열리지만 toggle 이벤트는 약 10~20ms 늦게 오는데, Esc 가로채기·창 크기 다시 놓기 처리기(attach())를 toggle에서 붙였다. 그 틈에 Esc가 들어오면 처리기도 없고 브라우저 기본 동작도 메뉴를 닫지 않아 메뉴가 열린 채 남고(또 Esc가 전역 단축키로 새고), 그 틈의 resize는 위치를 다시 잡지 못한다. 사람 손으로는 닿을 수 없는 틈이지만 자동 시험(열자마자 Esc·setViewportSize)은 닿는다. 고침: beforetoggle(열림)에서 place()가 성공한 직후 attach() — toggle에서는 포커스를 첫 항목으로 옮기는 일(onOpened)만 한다. Popover 미지원 경로(.open)는 열 때 처리기를 바로 붙여서 해당 없음. 기존 시험은 한 줄도 바꾸지 않았다 | 재현·확인: 진짜 키 입력으로 [파일 메뉴 Esc → 👤 로그인 창 Esc → ⋯ 열고 Esc]를 새 브라우저로 반복하는 프로브가 수정 전 16회 중 12회 실패(Esc가 beforetoggle와 toggle 사이에 도착한 기록으로 확인), 수정 후 20회 중 0회. responsive.test.mjs 단독 6회 반복: 수정 전 6회 중 4회 실패 → 후 0회. Phase 6 브라우저 4개 파일 묶음 4회: 수정 전 4회 중 3회 실패 → 후 0회(43건씩 전부 통과). 이 틈은 P6-1 때부터 있었고 시험이 우연히 피해 갔다 — 3.4.0 올림 뒤 갑자기 잦아진 이유는 확정하지 못했다(버전 문자열이 직접 원인은 아님, 로드·타이밍 차이로 보임). 변이 7건: B01 열림에서 attach 제거(옛 동작)·B02 attach를 place() 가드 앞으로·B03 attach를 닫힘 쪽에 잘못 둠·B04 닫힘에서 detach 제거·B06 setExpanded(true) 누락·B07 place() 실패 때 열림 허용 = 노드 정적 시험이 잡음, B05 onOpened에서 attach 제거 = Popover 미지원(fallback) 브라우저 시험이 잡음(그 경로는 onOpened에서만 붙이므로 필요한 호출이다) |
| 2026-11-23 | P7-A1 MIDI 가져오기 일괄 입력 | refactor/p7-a1-midi-batch | 통과 — check 28개, npm test 431건(361 통과·0 실패·70 건너뜀, 새 노드 테스트 12건: 골든·일괄 API 10 + 복잡도 2), CI식 전체 실행 490/490, **가져오기 결과가 구현 전과 똑같다**(골든 해시 cf9e4f7da2f9bc60·568음, 그리고 입력·옵션 37가지 행렬 전부 동일 — 옛 코드(eb4ce75)에서 계산한 값과 새 코드를 대조). 4,000음에서 악보 전체 훑기: 인덱스 재구축 4,001 → 1회 · 타이 정리 4,001 → 1회 · 마디 길이 표 계산 4,503 → 503회, 변환 시간 1천 음 1,335 → 82ms · 4천 음 13,119 → 209ms · 1만 음 108,914 → 430ms(중앙값, 목표 2초 이하 ✅). 복잡도 시험은 옛 방식으로 되돌린 변이(I06)에서 실패한다(4,000음에서 인덱스·타이 정리 4,001회)는 것을 확인, 변이 검사 20건 전부 잡힘 | ①설계서는 복잡도 계수기를 indexBuilds 하나로 적었다. 그것만 세면 ②(음마다 타이 정리)·③(음마다 마디 길이 표 재계산)을 되돌려도 시험이 통과하므로 `C.__stats`에 tieSweeps·timingBuilds를 더해 세 훑기를 모두 센다(계수기가 거짓말하지 않는지 보는 시험 포함) ②골든을 1건(568음)에서 37건 행렬로 넓혔다 — 고정 시드 4종×옵션 5(1/8·1/16·1/32 격자, 양손 분리, 셋잇단 감지), 셋잇단 전용 입력, 드럼(채널 10·표기 대체 경로), 기준 악보 .mid 4곡×옵션 3. 행렬이 약해지지 않았는지(셋잇단 30개 이상·드럼 표기 대체 안내·화음·타이·쉼표·양손)도 시험으로 확인 ③가져오기 마지막의 타이 정리 1회는 지금 입력들에서는 결과를 바꾸지 않는다(타이는 다음 조각을 같이 놓을 때만 켜져서 놓는 도중 떠도는 타이가 생기지 않음) — 방어용이지만 설계대로 두고, 빼먹거나 순서가 바뀌면 시험이 실패하도록 호출 자체(마지막 음 직후 정확히 한 번)를 지킨다 ④tests/bench-midi.mjs의 eighthNotesMidi를 tests/golden-utils.mjs로 옮기고 bench가 indexBuilds도 찍는다(설계서 지시). 7-A2는 아래 행 | 설계서 스케치를 그대로 따랐다(inputAtEvent·editedContent·midiToScore 변경 3가지, 기존 inputAt API 유지): ③(timing 캐시 유지)은 ctx.batch에서만 쓴다 — 일반 입력은 캐시를 새로 만든다는 것도 시험으로 못 박았다(박자를 바꾸면 일괄 입력 중에도 묵은 캐시가 남지 않는다는 시험 포함). 알아 둔 것: 준비 단계에서 마디마다 마디 길이 표를 다시 계산한다(4,000음에서 약 500회, 음마다가 아님 — 1만 음이 0.43초라 손대지 않음). 변이 20건: 일괄 모드의 타이 정리·timing 유지·firstEv 기록·반환 형식·계수기 3종·API 내보내기, 가져오기의 batch·마지막 타이 정리(빼기·앞으로 옮기기)·후처리 대상(null·복사본)·옛 방식 되돌리기. 처음에는 마지막 타이 정리 2건(I02·I03)이 안 잡혀서 호출 시험을 더했다. 실제 곡 파일의 속도·모양은 사람 확인 (P7-A1) |
| 2026-11-23 | P7-A2 MIDI 일괄 빌더(선택) | — | 건너뜀 — 필요 없음 | 시작 조건에 해당하지 않음 | 프롬프트북 시작 조건: 7-A1 뒤 PERF.md 수치와 실제 MIDI 파일 가져오기 시간이 둘 다 2초 이하면 "불필요"로 보고하고 끝낸다. 합성 곡 1만 음이 0.43초(PERF.md '7-A1 후')라 불필요. 실제 곡 파일은 받지 못해 재지 못했다 → (P7-A1) 사람 확인에 실제 곡 시간 확인을 적었다. 2초를 넘는 실제 곡이 나오면 그때 이 Step을 한다 |
| 2026-11-23 | P7-B1 저장 형식 v2 | refactor/p7-b1-save-v2 | 통과 — check 28개, npm test 464건(393 통과·0 실패·71 건너뜀, 새 노드 테스트 32건: save-format 25 + save-file 5 + cloud 2), CI식 전체 실행 530/530(새 브라우저 8건 포함). **크기**: 기준 악보 5개 모두 v1 → v2로 69~75% 줄었다 — airplane 21,562 → 5,622자(−73.9%) · butterfly 31,621 → 8,268(−73.9%) · quartet64 197,503 → 61,117(−69.1%) · rhythm 14,489 → 4,160(−71.3%) · star 46,985 → 11,691(−75.1%). 실제 앱에서 그린 뒤 저장해도 같다(star 47,032 → 11,738 −75.0% · airplane −73.8% · butterfly −73.7%). 완료 기준 −60% ✅. **내용은 그대로**: 기준 악보 5개 v2 왕복 ≡ v1 왕복(ID는 순서로 바꿔 비교), v2 → 읽기 → v2가 글자까지 같음, 헤어핀이 빈 성부 쉼표를 가리켜도 보존, 표시(셈여림·문자·연습 기호)가 붙은 쉼표가 든 성부 보존, 박자 바꿈·못갖춘마디·여러 성부·왼손 보표 왕복 OK, measures만 있는 옛 파일 OK. **3.0.1 기준 앱이 v2 파일을 연다**: 새 앱이 저장한 7종(데모 4곡·quartet64·2성부 편집·빈 성부 헤어핀)을 3.0.1 앱에서 열어 보표·성부·음표·스패너가 같고 그려진 음표 수도 같으며 페이지 오류 0(tests/verify-old-app.mjs — 두 앱을 띄워 다시 돌릴 수 있음). 3.0.1이 v2 파일을 열었다가 다시 저장한 모양(schema 2 + 최상위 measures + 마디 events)도 새 앱이 같은 악보로 읽는다(기준 악보 5개). 변이 검사 24건 중 23건 잡힘(pinned 무시·시작점만·끝점만, 모든 쉼표를 빈 것으로 봄, 최상위 measures·schema 누락/오기, fromJSON이 schema를 안 지움, 머리 version 고정 1·2, 기록·클라우드 마디 수 되돌림, 기록 SCHEMA 1, v1 출력의 measures·events 제거, 끝의 빈 성부·keepSilentVoices 무시, 1성부 비움, 메뉴 항목 삭제, 앱이 legacy 옵션을 안 넘김, saveJSON legacy 무시·뒤집힘). 못 잡은 1건(M03: 마디 events를 지우는 줄을 없앰)은 같은 결과가 나오는 변이 — ensureMeasureVoices가 events를 열거되지 않는 접근자로 바꿔 두어 복제본에는 애초에 없다(방어 줄이라 설계서대로 남김) | ①설계서가 놓친 곳 — 기록(session.js)과 클라우드 행(cloud.js)의 마디 수를 data.measures.length로 세서 v2에서는 최근 작업 창·클라우드 목록이 전부 0마디로 나온다 → 한 줄 도우미 measureCountOf(parts[0].staves[0].measures, 없으면 measures)로 세고 두 곳에 시험을 뒀다(변이 M10~M12가 잡음) ②파일 머리 version은 늘 2가 아니라 데이터 모양을 따른다(data.schema === 2면 2, 아니면 1) — 최근 작업 창이 옛 기록을 내려받을 때 머리가 거짓이 되지 않게 ③fromJSON이 입력을 복사한 직후 schema를 지운다(가져오기가 안에서 fromJSON(toJSON())을 하므로 안 지우면 모델에 schema: 2가 남는다) ④keepSilentVoices 옵션을 이번에 구현(7-B2 실행 취소 스냅샷용 — 빈 성부를 남기고 중복 칸만 뺌) ⑤스패너가 가리키는 쉼표가 든 성부(pinned)와 표시가 붙은 쉼표가 든 성부(hasVisibleContent)는 비우지 않는다 — 설계서 스케치에는 없던 보호 ⑥바뀐 기존 테스트 8곳(7개 파일, 전부 설계가 요구한 모양 변경이고 약화·삭제 없음 — 계획 기록 '바뀌는 기존 테스트' 목록): core-v3 64~65행 · session 223·285행 · session-browser 294행 · boot-browser 51행 · menus 67행 · menus-browser 82행 · recent-browser 132행(내려받은 파일 머리 version 1 → 2, 전체 브라우저 실행에서 발견). session 285·session-browser 294는 v2에서 data.measures가 없어 undefined끼리 비교하며 아무것도 안 보고 통과할 뻔했던 것을 실제 마디끼리 비교하도록 고쳤다 ⑦tests/capture-baseline.mjs는 { format: 1 }로 기준 JSON을 써서 기준 파일이 v2로 바뀌지 않게 했다 ⑧설계서에 없던 시험·도구: save-file.test.mjs(io.js 파일 머리·저장·다시 열기), save-format-browser.test.mjs(메뉴 위치·두 파일 다시 열기·자동 저장 기록·최근 작업 N마디·영어 화면), verify-old-app.mjs | (1) v2 toJSON은 복제한 뒤 지우는 방식이라 v1보다 느리다(quartet64 1.79 → 2.42ms, +35%) — 7-B2에서 편집마다 쓰이면 다시 재고, 필요하면 복제 없이 만드는 방식으로 줄인다. (2) 관찰만 하고 바꾸지 않음: 그리기용 임시 값(__acc, 임시표 표시 계산)이 저장 파일에 음표마다 들어간다 — v1부터 있던 동작이고 크기 영향은 약 5%이며, 시험에서 "그리기 전 글"과 "그린 뒤 저장한 파일"을 비교할 때 어긋나는 원인이었다(시험은 __로 시작하는 값을 비교에서 뺌). Phase 9 정리 후보. (3) 사람 확인은 (P7-B1). |
| 2026-11-24 | P7-B2 실행 취소 기억 예산 | refactor/p7-b2-undo-budget | 통과 — check 28개, npm test 480건(409 통과·0 실패·71 건너뜀, 새 노드 테스트 16건: history-budget 13 + core-v3 3), CI식 전체 실행 546/546(기존 브라우저 테스트는 하나도 바꾸지 않고 전부 통과). **동작은 그대로**: 편집 3회 → 실행 취소 3회가 처음과 쉼표 ID까지 같고 다시 실행하면 편집한 상태로 돌아옴 · 빈 성부 쉼표에 커서를 둔 채 편집 → 실행 취소 → 다시 실행해도 같은 쉼표 ID(2번째 성부) · dirty 계산(저장 뒤 편집·실행 취소·다시 실행, 다시 실행 뒤 또 실행 취소까지)·1초 병합·개수 상한 200·실패한 편집의 되돌림(쉼표 ID까지, 기록·revision 변화 없음) 모두 그대로. **메모리**(tests/bench-history.mjs, 편집 200회, 강제 가비지 수집 뒤 힙 증가): quartet64 옛 +67.2MB(객체 복사 200개) → 새 +47.9MB(기록 189개, 글자 총길이 25,050,180자·항목당 132,541자) · 피아노 100마디(1,600음) 옛 +140.8MB → 새 +47.9MB(기록 91개). 예산 48MB가 어떤 악보에서도 상한이다. **지연**: 편집 1회 비용 +1~3ms(quartet64 복사 2.2 → mutate 전체 3.5ms, 피아노 4.5 → 6.8ms), 실제 편집 지연 perf-edit(피아노 100마디 1,600음) 3회 중앙값 변경 전 206·189·171ms → 후 202·191·186ms(측정 오차 안), 실행 취소 복원 시간은 같거나 짧음(9.7 → 8.9ms · 12.7 → 9.9ms). **변이 검사 25건**: 처음에는 19건 잡힘, 못 잡은 6건(undo·redo가 trimHistory를 안 부름 2건 · 예산 경계 > → >= · 예산 0을 기본값으로 취급 · redo가 되돌리기 쪽에 엉뚱한 version을 저장 · 다시 실행 쪽부터 버림)은 시험 3건을 더한 뒤 25/25 잡힘(같은 결과가 나오는 변이 없음). 잡힌 변이: 빈 성부 버림, 실패 복구가 옛 방식, 예산·개수 상한 무시, bytes 1배, 가장 가까운 1개 보존 해제(되돌리기·다시 실행 각각), 최신을 버림, setHistoryBudget이 바로 안 줄임, 기본 예산 4MB, mutate의 trim 누락, 새 편집이 redo를 안 지움, 병합 편집도 항목 추가, 잘못된 예산값 Infinity, redo 바이트 누락, undo가 늘 바뀐 상태, undo 쪽 version 오기, 실패 복구 생략, 과다 삭제, 개수 경계 >= | ①가장 가까운 항목 1개씩(되돌리기·다시 실행)은 예산을 넘어도 남긴다 — 설계서 스케치에는 없던 보호(예산이 아주 작거나 한 항목이 예산보다 커도 한 번은 늘 되돌릴 수 있게, 시험 있음) ②시험·측정용 후크 C.__setHistoryBudget(bytes)·C.__history() 추가(설계서의 C.__stats와 같은 방식, 값이 없거나 잘못되면 기본 48MB로 돌아감) ③스냅샷은 toJSON(score, { keepSilentVoices: true }) — 파일 저장용 v2와 달리 빈 성부를 남겨야 입력 커서·선택이 가리키는 쉼표 ID가 되돌린 뒤에도 같다(P7-B1에서 옵션만 만들어 둠) ④mutate의 실패 복구·undo·redo가 모두 같은 한 함수 restore(text)를 쓴다 ⑤프롬프트북 시험 ②의 "작은 예산(1024)" 대신 항목 크기 × 3.5를 썼다 — 1024바이트면 가장 가까운 1개만 남아 "남은 것은 정확히 복원"을 한 개로만 확인하게 되므로, 3개가 남는 예산으로 확인하고 예산이 아주 작은 경우(1바이트·0)는 history-budget에서 따로 본다 ⑥설계서에 없던 시험·도구: tests/history-budget.test.mjs(13건: 기본값 · 개수 상한 200 · 가장 가까운 1개 보존 · 바이트 합 · 예산 줄이기 즉시 적용·잘못된 값 · dirty · 저장 시점이 버려진 뒤 · 1초 병합 · 실패 복구 · quartet64 200회 · 큰 상태가 반대쪽 더미로 넘어갈 때 예산 다시 맞춤(실행 취소·다시 실행 각각) · 경계·0·버리는 순서)와 tests/bench-history.mjs(옛 방식과 새 방식 메모리 비교 도구) ⑦바뀐 기존 테스트 없음(약화·삭제·건너뛰기 없음, core-v3.test.mjs는 끝에 3건만 추가) | (1) 큰 악보에서는 되돌릴 수 있는 횟수가 200번보다 줄어든다(quartet64 189번, 피아노 100마디 91번, 더 큰 악보는 더 적게) — 메모리 상한을 얻는 대신 의도한 교환이고, 가장 가까운 1번은 늘 남는다. (2) 예산은 글자 수 × 2(UTF-16)로 어림한다: V8은 한글(가사·제목)이 없으면 글자당 1바이트라 실제 메모리는 더 작을 수 있다. (3) 스냅샷에 그리기용 임시 값(__acc)이 들어간다 — v1부터 있던 동작이고 그릴 때 다시 계산되는 값이라 무해하지만 크기의 약 5%다. 파일 저장과 함께 Phase 9 정리 후보. (4) mutate는 병합(coalesce)되는 편집에서도 매번 스냅샷을 찍는다(옛 동작과 같음). (5) 복원은 JSON.parse + fromJSON으로 두 번 복사한다(시간은 옛 방식과 같거나 짧아 그대로 둠). (6) 사람 확인은 (P7-B2). |

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

### P2-B 악보별 자동 저장 — IndexedDB (2026-11-23 승인)
**저장 구조**(설계서와 같음): DB `scoreforge` v1 — `docs`(keyPath `id`, 색인 `updatedAt`) `{ id, title, createdAt, updatedAt, revision, origin, cloudId, measures, bytes, schema, data }`, `kv`(`lastDocId`·`migrated.v1`·`boot.pending`). `data`는 `C.toJSON(score)` 그대로(저장 형식 v1, `schema: 1`). 열기에 실패하면 `SF.store.backend === "localStorage"`가 되고 지금과 똑같이 1칸 방식으로 동작(`flushActive()`는 항상 false). 테스트는 `SF.storeTesting.memoryBackend`(이름 `memory`, 문서 저장 가능으로 취급).

| origin | 만들어지는 때 | docId |
|---|---|---|
| new / demo | 새 악보·데모(메뉴·시작 화면)를 설치할 때 id만 부여, **기록은 첫 편집 때** | 새 UUID |
| file | `.scoreforge.json`을 열 때 | 파일의 `meta.docId`(UUID 형식일 때만, 아니면 새 UUID). 같은 id 기록이 있고 내용이 다르면 [자동 저장본 열기 / 파일 그대로 열기(새 문서로) / 취소] |
| import | MusicXML·MIDI·MXL | 새 UUID |
| cloud | 클라우드에서 열 때 | `cloud:` + cloudId (공유 보기는 기록 안 함) |
| copy | 로컬 사본 | 새 UUID (메타에서 id·클라우드 식별 제거 후) |
| legacy | 옛 localStorage 1칸을 한 번 옮길 때 | 고정 `legacy-v1`(실패 뒤 다시 시도해도 문서가 둘이 되지 않게) |

**쓰기 순서**: io.js `autosave`의 700ms 디바운스·revision 확인은 그대로, 쓰는 곳만 `setAutosaveWriter(fn)` 훅(기본 = 현행 localStorage, 동기 동작 유지 → audioio-v3 테스트 무변경). writer가 Promise를 돌려주면 성공 뒤에 `markAutosaved`. `flushAutosave()`는 대기 중인 저장을 즉시 실행해 성공 여부를 돌려줌. `flushActive()`(session)는 store가 쓸 수 있을 때만 `flushAutosave()`→`C.isAutosaved()`로 판단.

**start()가 async가 될 때**: 저장소 열기·옛 저장본 이전·시작 문서 고르기만 `await SF.session.restoreOnBoot()` 자리(옛 `IO.loadAutosave()` 자리)로 모으고, 그 앞의 UI 만들기·`bind*`는 그대로 앞에 둔다. 저장소 열기는 `start()` 맨 앞에서 먼저 시작(Promise)해 UI 만드는 동안 병렬로 진행하고 옛 위치에서 기다린다. 그 뒤(`C.onChange` 등록, `dirty=false`, uiV3·auth·cloud·pwa init, 첫 `update`)는 순서 그대로이고, 기다리는 지점만 `await`로 바뀐다. 위험: 키·버튼 바인딩(`bind*`)은 `await` 앞에 있어서, 저장소를 여는 동안(보통 수십 ms) 들어온 입력은 아직 `C.onChange`가 없는 빈 임시 악보에 닿았다가 곧 `C.setScore`로 교체된다 → 저장되는 것이 없어 유실 위험은 없고, 그 사이 입력 한 번이 사라질 수 있을 뿐이라 받아들인다(브라우저 테스트의 `networkidle` + `#svg-host .ev` 대기로 안정 확인). 부팅의 `C.setScore` 2곳은 app.js에 남김(구조 고정 3개 유지, 2-E에서 정리).

**옛 자동 저장 이전 실패 시**: localStorage 원본은 어떤 경우에도 지우지 않는다. 쓰기·읽기·형식 오류 어느 쪽이든 `migrated.v1`을 남기지 않아 다음 부팅에 다시 시도하고(문서 id가 고정이라 중복 생성 없음), 이번 부팅에는 `IO.loadAutosave()`로 원본을 그대로 읽어 보여 준다(읽을 수 없으면 데모). 이전에 성공했는데 표시(flag) 쓰기만 실패한 경우에도 같은 id 기록이 있으면 덮어쓰지 않고 표시만 남긴다.

**테스트**: tests/store.test.mjs(Node, 메모리 backend) · tests/session.test.mjs 추가(docId 규칙 5종·첫 편집 전 기록 없음·flush 성공 시 대화상자 없음·localStorage backend면 flush false·이전 1회성·같은 docId 다른 내용 선택·사본이 이전 기록을 덮어쓰지 않음) · ui-v3.test.mjs:113 한 줄만 교체(의미 유지) · session-browser 추가(두 페이지 격리·legacy 이전). 완료 기준 추가 확인: 새 코드에 v1 원본을 지우는 곳이 없음(grep). 기존 `io.clearAutosave()`(테스트 전용, 앱 코드 호출 0)는 그대로 두고 9-6에서 함께 정리.

**구현하면서 달라진 점(설계서·프롬프트북 대비)**
1. `cloud.js`: `META_KEYS`에 `docId`를 넣지 않고 `LOCAL_META_KEYS = ["docId"]`를 따로 둔다. `writeMetadata`의 대체 경로가 `META_KEYS` 중 값이 없는 키를 지우므로, 넣으면 `docId`가 지워진다. 클라우드 데이터(snapshot·decode)에서는 둘 다 제거한다.
2. 파일 저장 시각은 `app.saveScore()`가 아니라 core의 `saved` 이벤트(= `io.saveJSON` 끝)에서 세션이 기록한다 — 파일 메뉴·"파일로 저장하고 계속"·PWA 업데이트 저장 어느 경로든 한 곳에서 처리. 기록(`fileSavedAt`)은 설계서 표에 없는 추가 필드(없던 기록은 0).
3. 상태 표시줄 `#status-saved`는 기록이 있는 문서에서만 보이고 폭 640px 이하에서는 숨긴다(`#status-hint`와 같은 처리 — 좁은 화면 상태 표시줄은 Phase 6에서 다시 본다).
4. `SF.store`의 모든 메서드는 열지 않았으면 먼저 연다(호출하는 쪽이 `open()` 순서를 신경 쓰지 않게). 열기에 5초 안에 못 끝나면 localStorage 방식으로 넘어간다(다른 탭이 막은 경우 앱이 멈추지 않게). 연결이 닫혀 있으면(InvalidStateError) 한 번 다시 열고 재시도.
5. P2-A의 브라우저 테스트 18개는 "보관할 곳이 없을 때의 3지선다"를 보는 테스트라서 IndexedDB를 막은 환경(`openApp`의 `idb: false` 기본값)에서 돈다 — 기대값은 그대로. IndexedDB가 있을 때(묻지 않고 보관·토스트)는 새 테스트가 따로 본다.
6. 파일 열기 충돌 확인은 확인(저장) 대화상자 **뒤에** 한다(취소하면 충돌 질문도 없음). 파일 안의 `docId`가 UUID 모양이 아니면(예: `cloud:…`) 믿지 않고 새 UUID를 준다 — 다른 문서의 id를 흉내 낸 파일이 기록을 건드리지 못하게.

### P2-E 부팅 안전 모드 (2026-11-23 승인)
**목표**: 손상된 저장본 때문에 열 때마다 빈 화면이 반복되는 일을 끝낸다. 여는 중 문제가 나면 그 기록을 격리하고 안전하게 시작하고, 렌더 중 멈췄다면 다음 부팅에서 자동으로 다시 열지 않고 사용자에게 묻는다.

| 종류 | 알아채는 방법 | 동작 |
|---|---|---|
| A 읽을 수 없는 기록 | 설치 **전** `SF.schema.checkShape(data)` 또는 `C.fromJSON` 실패 | 기록을 격리하고 건너뜀 → 다음 정상 문서를 열고, 없으면 데모. 토스트 |
| B 설치·첫 렌더 중 예외 | 첫 렌더(`update({ immediate: true })`)를 try로 감싼 안에서 예외 | 기록 격리 + 데모 + 토스트(같은 부팅에서 다른 문서를 또 열어 보지 않음) |
| C 렌더 중 멈춤·종료 | 다음 부팅에 kv `boot.pending`에 그 문서가 남아 있음 | 자동으로 열지 않고 안전 모드 대화상자 [그래도 열기] [파일로 내려받기] [새 악보로 시작] |
| D 이미 격리된 기록 | 기록 `quarantined: true` | 자동 선택에서 조용히 제외(토스트 반복 없음). 최근 작업에서 ⚠️, 내려받기가 첫 버튼 |

**흐름도**
```
start()
 ├ restoreOnBoot()  (화면을 만드는 동안 먼저 시작)
 │    저장소 열기 → 옛 자동 저장 이전 → kv boot.pending 읽기
 │    후보(이 탭의 문서 → lastDocId → 최근 문서) 하나씩:
 │      격리된 기록 ........................ 조용히 건너뜀                      (D)
 │      checkShape/fromJSON 실패 ........... 격리(updateDoc, 원본 data 유지)+건너뜀  (A)
 │      다른 탭이 편집 중(내 탭의 문서 제외) .. 건너뜀
 │      boot.pending에 있음 ................ 자동으로 열지 않고 bootInfo().pending에 기록 → null  (C)
 │      그 밖 ............................. 잠금+claim → 악보 반환
 ├ (화면 만들기: UI·bind*)
 ├ bootScore():  pending이면 안전 모드 대화상자 → [그래도 열기]=bootOpenPending / [내려받기]=파일 받고 다시 묻기 /
 │                [새 악보로 시작]=bootSkipPending(격리)+빈 악보 / 닫기=이번만 데모(표시는 그대로 → 다음에 또 물음)
 │               복원할 악보가 있으면 bootBegin(id)로 kv에 "여는 중" 표시(쓰기 완료까지 기다림) → installScore(악보, { boot: true, readOnly })
 │               없으면 데모: adopt → installScore(데모, { boot: true })
 ├ (나머지 초기화 — C.onChange 등록, uiV3·exportUI·cloud·auth·pwa·i18n)
 └ settleBoot():  try { update({ immediate: true }); 첫 프레임 2번(+보이지 않는 탭·1.5초 상한 예외) ; bootDone(id) → 표시 해제 }
                  catch → bootFailed(error)(격리·표시 해제·잠금 놓기) → 데모 설치 → 토스트                         (B)
```

**격리 기록 형식** — 기존 기록에 필드만 더한다: `quarantined: true`, `quarantineError: { at, code, message }`(code는 `ScoreFormatError.code`·`Error.name`, message는 200자까지). `data`·`updatedAt`·`revision`·`title`은 그대로(원본 유지, 정렬 위치 유지). 쓰기는 `store.updateDoc(id, mutate)`(IndexedDB 한 트랜잭션 안의 읽기→쓰기) — 읽은 뒤 다른 탭이 새로 저장했거나(updatedAt·revision이 달라짐) 이미 격리돼 있으면 건드리지 않는다. 그 문서를 다시 고쳐서 자동 저장하면 기록이 새로 만들어지므로 표시는 자연히 사라진다.

**바뀌는 문구**: 토스트(부팅 격리) "저장된 악보를 여는 중 문제가 생겨 안전하게 시작했어요. 최근 작업에서 원본을 내려받을 수 있어요." · errors.js:12 "문제가 생겼어요. 마지막 자동 저장본을 확인해 주세요." → "문제가 생겼어요. 최근 작업에서 확인해 주세요." (i18n `errorRecovery`도 함께) · 안전 모드 대화상자 제목 "지난번에 여는 중 문제가 있었어요" / 본문 "지난번에 ‘{제목}’을(를) 여는 중 문제가 있었어요. 어떻게 할까요?"(패턴, 제목은 사용자 글) / [그래도 열기] [파일로 내려받기] [새 악보로 시작] · 최근 작업 ⚠️ 표지 "열 때 문제가 있었어요" + 안내 "원본은 그대로 보관돼 있어요. 파일로 내려받아 확인해 보세요."

**설계서·프롬프트북과 달라지는 점 (이유 포함)**
1. **A는 데모 대신 "다음 정상 문서"로 넘어간다.** 설계서 boot() 스케치는 대상 하나를 고르고 실패하면 곧바로 데모지만, 기존 테스트 P2-B ⑦(깨진 기록은 건너뛰고 다음 문서를 연다, `{ parts: 'x' }`)가 이미 그 동작을 요구한다. 기존 테스트를 바꾸지 않고, 설치 **전에** 알 수 있는 손상(A)은 건너뛰기+격리, 설치·렌더 중 예외(B)는 스케치대로 격리+데모로 나눈다. 정상 문서가 하나도 없으면 A도 데모가 되므로 프롬프트북의 브라우저 시나리오(손상 문서 하나만 있음 → 데모+토스트)와 같다.
2. **`boot.pending`은 `{ [문서ID]: 시작 시각 }` 맵**(읽을 때는 문자열 ID 하나인 옛 모양도 받음). 브라우저가 이전 세션을 복원하면 여러 탭이 동시에 부팅하는데, 값 하나를 공유하면 한 탭이 다른 탭의 표시를 지워 버려 정말 멈춘 탭을 놓친다. 표시·해제는 `store.updateKv`(한 트랜잭션)로 한다.
3. **첫 렌더는 start() 맨 끝**(원래 `update({ immediate: true })` 자리)에서 감싼다. 렌더 전에 uiV3·exportUI 등이 먼저 초기화돼야 하고, 설치(`installScore`)는 그보다 앞서 하므로 설치와 첫 렌더 사이에 다른 초기화가 낀다. 숨은 탭(`document.hidden`)은 requestAnimationFrame이 멈추므로 프레임을 기다리지 않고 동기 렌더 직후 해제한다(세션 복원으로 열린 배경 탭이 "여는 중"으로 남지 않게).
4. `checkShape`는 저장소 기록(항상 `toJSON` 정규화 결과)에만 엄격하게 쓴다: parts→staves→measures→measure.voices→voice(배열)→event.dur(n·d 양의 정수). 파일·MusicXML 가져오기에는 아직 쓰지 않는다(본 검사는 8-2). `openDoc`(최근 작업에서 열기)도 같은 검사를 통과해야 열고, 못 통과하면 기존 "unreadable" 토스트(내려받아 확인) 경로를 쓴다.
5. 안전 모드 대화상자를 그냥 닫으면(Esc·바깥 클릭) 이번에는 데모로 시작하되 표시를 지우지 않아 다음에 다시 묻는다. [새 악보로 시작]은 그 기록을 `BOOT_INTERRUPTED`로 격리해 매 부팅마다 같은 대화상자가 반복되지 않게 한다.
6. 부팅의 데모·복원도 `installScore`를 거친다(`opts.boot`: 부팅 흐름이 자기 토스트를 직접 보여 주므로 "불러왔어요" 토스트 생략) → 구조 고정 테스트의 app.js 직접 `C.setScore(` 수는 3 → 1(installScore 한 곳).

**테스트**: tests/schema.test.mjs(checkShape — 기준 악보 5곡 통과, `dur { n: 0, d: 0 }`·voices 누락·parts 문자열 등 거부, 모듈 구조) · tests/boot.test.mjs(복원·격리·pending·경합·잠금 놓기, Node) · tests/boot-browser.test.mjs(손상 기록 → 데모+토스트 → 다시 새로고침 시 조용 · 정상 문서가 있으면 그 문서 · 렌더 예외 · pending → 대화상자 세 갈래 · 최근 작업 ⚠️). 기존 테스트는 구조 고정 한 줄(3→1)만 바뀌고 나머지 기대값은 그대로.

### P3-5 버전 단일화 — package.json 하나 + 셸 해시 (2026-11-23 승인)
**기준은 package.json의 `version` 하나.** `tests/prepare-release.mjs`가 나머지를 만든다(순서 중요):
1. `version` = package.json → `js/version.js`를 지금 형식 그대로 기록(`"use strict";` / `window.SF = window.SF || {};` / `window.SF.VERSION = "<version>";`, LF).
2. 앱 셸 파일 목록(현행 로직: 최상위 6개 + js·css·vendor·manual 아래 js·mjs·css·html·svg·png·jpg·woff2)을 정렬·중복 제거 → `precache-manifest.json`.
3. 해시 = sha256(목록 순서대로 파일마다 `경로 + "\n" + 내용 + "\n"`)의 앞 8자리. 내용은 확장자가 js·mjs·css·html·svg·json·webmanifest면 문자열로 읽어 `\r\n`→`\n`(Windows autocrlf 체크아웃과 CI의 Linux가 같은 해시), 그 밖(png·woff2 등)은 바이트 그대로. 목록에는 `sw.js`·`precache-manifest.json` 자신이 들어 있지 않다(자기 참조 방지; sw.js 바이트가 바뀌는 것만으로도 브라우저는 새 서비스 워커로 본다).
4. `sw.js`의 `const CACHE_VERSION = "…";` 한 줄만 `"<version>+<hash8>"`로 치환(`SHELL_CACHE`는 그대로 `"scoreforge-shell-" + CACHE_VERSION`이라 셸 파일이 바뀌면 캐시 이름이 새로 생기고, 옛 캐시는 activate에서 삭제됨).
5. 마지막 검사: sw.js에 `CACHE_VERSION = "<version>+`가 있는지.
- 구현 위치: 해시·목록·정규화는 `tests/release-lib.mjs`(prepare-release와 테스트가 같은 함수를 씀).
- 바뀌는 기존 테스트 3곳: prepare-release 마지막 검사(완전 일치 → 접두 `<version>+`), `tests/pwa.test.mjs` 51–52행(정규식 `CACHE_VERSION = "<version>\+[0-9a-f]{8}"`), `tests/verify-offline.mjs` 25행(`caches.keys()`에서 `scoreforge-shell-` 접두로 찾기). 모두 같은 뜻의 검사를 새 모양에 맞춘 것이며 느슨해지지 않는다(해시 8자리를 오히려 더 강하게 요구).
- 새 테스트 `tests/release.test.mjs`(Node): 해시가 CRLF/LF에 같음·한 바이트가 바뀌면 달라짐·이진 파일은 정규화 안 함·sw.js의 해시가 지금 파일들의 해시와 같음(= `npm run release`를 잊으면 `npm test`가 바로 알려 줌)·version.js가 package.json과 같음·manifest가 파일 목록과 같음.
- 릴리스 절차가 이렇게 바뀐다: 버전 올리기 = `package.json`의 version만 고치고 `npm run release`(= 단축키 표 생성 → prepare-release → check → test). 앱 셸 파일을 바꾼 Step은 커밋 전에 `npm run release`(또는 `node tests/prepare-release.mjs`)로 `js/version.js`·`sw.js`·`precache-manifest.json`을 같이 커밋한다. CI의 "release files are up to date" 단계가 이를 검사한다. CLAUDE.md 4절 문구(Step 3-5 이후 규칙)는 실제 절차와 맞아 고치지 않는다.
- 위험: 서비스 워커 캐시 이름이 `3.1.0+ab12cd34`처럼 바뀐다(Cache 이름에 `+` 사용 가능). 기존 설치본은 첫 업데이트에서 옛 캐시를 정리한다.

### P7-B1 저장 형식 v2 (2026-11-23 승인)
**목표**: 같은 음표를 최대 4번 저장하던 중복(마디마다 `events` 별칭 + 최상위 `measures` + 빈 2~4성부의 온쉼표)을 없애 파일·자동 저장·클라우드 크기를 60% 이상 줄인다. **읽기는 옛 형식을 영구 지원, 쓰기만 v2.** 3.0.1 앱도 v2 파일을 열어야 하고, 한 릴리스 동안 "구버전 호환으로 저장"(v1)을 남긴다(9-6에서 정리).

**바꿀 함수·파일**
1. `js/core.js` `toJSON(score, opts = {})` — 설계서 스케치 그대로. `{ format: 1 }` = 지금 출력(마디 `events` 별칭 + 최상위 `measures`) 그대로. 기본(v2) = 마디의 `events`·최상위 `measures` 삭제, 빈 2~4성부는 `[]`(스패너 시작·끝점이 가리키는 쉼표가 든 성부는 보존), 끝의 빈 성부는 잘라냄, `schema = 2`. `{ keepSilentVoices: true }`는 빈 성부를 남김(7-B2 실행 취소용).
2. `js/core.js` `fromJSON` — 입력을 복사한 직후 `delete score.schema`(가져오기가 안에서 `fromJSON(toJSON())`을 하므로 안 지우면 모델에 `schema: 2`가 남음). 읽기 쪽 나머지(빈 성부 채우기·`measures` 되살리기)는 지금 코드가 이미 한다.
3. `js/io.js` — 파일 머리 `{ app: "scoreforge", version: 2, score }`. `jsonFileText(data)`는 **데이터에 맞춰** 머리 version을 정한다(`data.schema === 2`면 2, 아니면 1 — 최근 작업 창이 옛 형식 기록을 내려받을 때 머리가 거짓이 되지 않게). `saveJSON(score, opts)`는 `opts.legacy`면 `toJSON(score, { format: 1 })`. 읽기(`loadScoreFile`·`loadAutosave`)는 머리 version을 보지 않고 `score`·`parts`·`measures`만 보므로 1·2 모두 그대로 열린다.
4. `index.html` + `js/app.js` — 파일 메뉴 "💾 저장 (.json)" **바로 아래**에 항목 하나: `data-act="save-legacy"` "💾 구버전 호환으로 저장 <small>옛 버전 앱에서 열 파일</small>"(단축키 없음). 파일 저장에만 적용(자동 저장·클라우드는 항상 v2). 토스트 "구버전 호환 형식으로 악보 파일을 내려받았어요". `js/i18n.js`에 영어 문구 3개.
5. `js/session.js` — 기록의 `schema` 필드 1 → 2(`SCHEMA`), 기록의 `measures`(최근 작업 창의 "N마디")를 한 줄 도우미 `measureCountOf(data)`(`parts[0].staves[0].measures` → 없으면 `measures`)로 센다. **설계서가 놓친 곳**: 지금은 `data.measures.length`를 읽어서 v2에서는 0마디로 보인다(2곳: 자동 저장 기록·옛 자동 저장 이전).
6. `js/cloud.js` — 같은 이유로 클라우드 행의 `measures` 칸(`job.data.measures.length`, 목록의 "N마디")을 같은 한 줄 도우미로 센다(core를 거치지 않아 cloud.test.mjs의 가짜 core를 그대로 둘 수 있다). snapshot(`C.toJSON`)·decode(`C.fromJSON`)는 그대로(v1·v2 모두 읽음). DB 제약은 `data`가 객체이고 2MB 미만이라는 것뿐이라 v2도 들어간다(supabase/scoreforge_scores.sql 확인).
7. `tests/capture-baseline.mjs` — 기준 JSON을 `toJSON(s, { format: 1 })`로 쓴다(사람이 기준 파일을 다시 만들어도 "원래 형식 기준"이 v2로 바뀌지 않게).

**바뀌는 기존 테스트(설계가 요구하는 모양 변경 때문 — 약화·삭제 없음, 구현 뒤 전체 실행에서 더 나오면 이 목록에 더함)**
- `tests/core-v3.test.mjs` 64–65행(프롬프트북이 지정한 1건): `C.toJSON(score, { format: 1 })`로 바꿔 legacy 별칭 단언을 유지하고, v2 단언(최상위 `measures` 없음·`schema === 2`·첫 마디에 `events` 키 없음)을 추가.
- `tests/session.test.mjs` 223행 `rec.schema` 1 → 2(기록 형식 버전).
- `tests/session.test.mjs` 285행·`tests/session-browser.test.mjs` 294행 "내용 동일" 비교: 지금은 `data.measures`끼리 비교하는데 v2에는 그 칸이 없어 `undefined`끼리 비교하며 **아무것도 안 보고 통과**하게 된다 → 같은 악보 자리(`parts[0].staves[0].measures`)끼리 비교하도록 바꿔 내용 동일 확인을 유지.
- `tests/recent-browser.test.mjs` 132행(최근 작업 창에서 내려받은 파일의 머리 `version`): 1 → 2 + `score.schema === 2` 단언 추가. 이 기록은 새 형식(schema 2)으로 보관돼 있고, 설계대로 머리 version은 데이터 모양(`data.schema === 2`)을 따르기 때문이다(전체 브라우저 실행에서 발견 — 같은 창의 삭제·잠금표시 시험 2건은 이 실패로 대화상자가 열린 채 남아 따라서 실패했을 뿐).
- `tests/boot-browser.test.mjs` 51행 시험 준비 코드 `data.measures.length` → `parts[0].staves[0].measures.length`(v2에서는 TypeError).
- `tests/menus-browser.test.mjs` 82행 메뉴 항목 수 19 → 20(새 항목 1개), `tests/menus.test.mjs` 67행 고정 항목 13 → 14와 필수 data-act 목록에 `save-legacy` 추가(npm test에서 발견).
- (`tests/core.test.mjs` 44행은 통과하지만 `delete old.parts` 한 `old`에 `measures`가 없어져 "measures만 있는 옛 파일 이전"을 더는 보지 못한다 → 파일은 손대지 않고, 같은 일을 하는 새 시험을 save-format에 둔다.)

**테스트(새 `tests/save-format.test.mjs`, core.js만 로드)**: 기준 악보 5개 `fromJSON(v2 왕복) ≡ fromJSON(v1 왕복)`(canonicalIds, `schema` 제외) · quartet64 크기 v2 ≤ v1×0.4 · 빈 성부 쉼표를 시작점으로 하는 헤어핀이 v2 왕복 뒤에도 남음 + 박자 바꾼·못갖춘마디·빈 성부 쉼표를 가리키는 ottava 악보의 왕복, v1·v2 파일 모두 읽힘, measures만 있는 옛 파일 이전, `keepSilentVoices`, `{ format: 1 }`이 옛 출력과 같음, 가져온 악보 모델에 `schema`가 안 남음, 구현 전에 크기·헤어핀 시험이 **실패**하는 것을 확인한 뒤 구현한다.

**위험과 대비**: ①스패너가 빈 성부 쉼표를 가리키면 ID가 바뀌어 `normalizeSpanners`가 지움 → pinned 보존+헤어핀 시험 ②빈 성부를 다시 채울 때 박자·못갖춘마디 길이가 틀어질 수 있음 → 박자 바꾼 악보 왕복 시험(채우기는 첫 보표의 마디 정보를 쓰므로 `measures`가 없어도 같아야 함) ③마디 수 0 표시 → 위 5·6번과 시험 ④옛 앱이 v2를 못 읽음 → 3.0.1 worktree에서 v2 파일 열기 확인(어려우면 사람 절차를 기록), 3.0 이전용으로 "구버전 호환으로 저장" ⑤MIDI 가져오기 결과가 바뀜 → midi-golden이 그대로 통과해야 함(`schema` 제거 때문).

### P7-B2 실행 취소 기억 예산 (2026-11-23 승인)
**목표**: 편집마다 악보 전체를 객체째 복사(`structuredClone`)해 200개까지 쌓던 실행 취소 기록이 큰 악보에서 메모리를 많이 먹는다. 기록을 압축 JSON 글자로 담고 메모리 예산(48MB)을 둔다. **동작은 그대로**: 되돌리기 결과·dirty 계산·1초 병합·개수 상한 200.

**바꿀 곳(`js/core.js`만)**
1. `snapshot(score)` → `JSON.stringify(toJSON(score, { keepSilentVoices: true }))`(빈 성부 쉼표를 남겨 입력 커서·선택이 가리키는 쉼표 ID를 보존). 복원은 한 곳 `restore(text)` = `fromJSON(JSON.parse(text))` — mutate의 실패 복구(`state.score = fromJSON(before)`)·undo·redo가 모두 이것을 쓴다.
2. 기록 항목에 `bytes`(글자 수 × 2, UTF-16 어림)를 두고 `trimHistory()`가 개수 200과 예산 `history.maxBytes = 48 * 1024 * 1024`를 지킨다 — 가장 오래된 것부터 버리되, 되돌리기 쪽과 다시 실행 쪽 **가장 가까운 항목 1개씩은 예산을 넘어도 남긴다**(아주 큰 악보에서도 한 번은 늘 되돌릴 수 있게 — 설계서에는 없는 보호). mutate·undo·redo 끝에서 부른다.
3. 시험용 `C.__setHistoryBudget(bytes)`(바로 적용)와 `C.__history()`(되돌리기·다시 실행 개수, 글자 수, 바이트, 예산).
4. dirty 계산(`contentVersion`·`savedVersion`)·`markSaved`·`markAutosaved`·1초 병합은 **손대지 않는다** — 항목의 `version`·`coalesce` 필드가 그대로이고, 병합일 때는 새 항목을 만들지 않는다.

**테스트**: `tests/core-v3.test.mjs`에 ①편집 3회 → 실행 취소 3회 → 처음과 `toJSON` 동일(쉼표 ID까지 보는 `keepSilentVoices` 출력으로도) ②작은 예산에서 오래된 것부터 버려지고 남은 것은 정확히 복원 ③빈 성부 쉼표에 커서를 둔 채 편집 → 실행 취소 → 같은 쉼표 ID. 새 `tests/history-budget.test.mjs`: 개수 200 유지 · 예산이 아주 작아도 한 번은 되돌리고 다시 실행할 수 있음 · 바이트 계산이 항목 합과 같음 · 예산을 줄이면 바로 적용 · dirty(저장 뒤 편집·실행 취소, 저장 시점이 버려진 뒤에도 dirty 유지) · 1초 병합 유지 · 실패한 mutate가 쉼표 ID까지 되돌림 · quartet64 200회 뒤 총 바이트가 예산 이내. **측정**: quartet64 200회 편집 뒤 기록 글자 수 → `tests/baseline/PERF.md`, 편집 1회 지연은 `tests/perf-edit.mjs` 구현 전(중앙값 206·189·171ms) 대비.

**위험과 대비**: ①스냅샷이 객체 복사보다 느릴 수 있다(노드 측정: quartet64 2.6 → 3.6ms, 피아노 100마디 5.8 → 9.2ms) → perf-edit 전후 3회 중앙값 비교, 크면 복제 없이 글자를 만드는 방식으로 줄인다 ②복원이 쉼표 ID를 바꾸면 커서가 사라진다 → `keepSilentVoices` + 시험 ③ + 변이 검사 ③예산이 너무 작아 실행 취소가 아예 안 되면 곤란 → 가장 가까운 항목 1개 보존 + 시험.

## Phase 검토 기록 (R-1 — 코드는 고치지 않고 점검만)

### Phase 2 작업 보존 검토 (2026-11-23, phase/p2-work-safety)
범위: P2-A~P2-E. 검토 중 DoD ③을 한 번에 증명하는 테스트가 없어 **테스트만** 추가했다(코드 변경 없음).

| # | Phase 2 DoD | 결과 | 증거 |
|---|---|---|---|
| 1 | 교체 경로 보호(설계서 7개 → 실제 9개+1) | ✅ | tests/session.test.mjs "구조 고정: setScore 직접 호출 개수"·"교체 경로는 모두 SF.session.replaceScore 또는 handleLoadedScore를 거친다" / tests/session-browser.test.mjs "악보 교체 보호: 경로마다 확인이 뜨고 취소하면 그대로, 깨끗하면 그냥 교체"(경로별 취소·Esc·바깥 클릭·읽기 전용), "시작 화면 새 악보·데모" |
| 2 | 두 탭이 서로의 작업을 덮어쓰지 않고, 같은 문서는 한쪽만 편집 | ✅ | tests/lock.test.mjs P2-D ①②⑧⑲(같은 문서 둘째 탭 읽기 전용·다른 문서 둘 다 편집·같은 파일 동시 열기·교체 통로 밖 저장도 남의 문서는 안 덮음) / tests/lock-browser.test.mjs "첫 탭은 문서를 쥐고…"·"최근 작업에서 다른 탭이 편집 중인 악보를 열면 읽기 전용"·"서로 다른 문서는 두 탭이 동시에 편집"·Web Locks 없는 대체 경로 / P2-B 악보별 보관(session.test P2-B ②·⑬) |
| 3 | 공유 링크 → 사본 만들기 뒤에도 이전 로컬 작업이 최근 작업에 남음 | ✅(테스트 추가) | tests/session.test.mjs "Phase 2 DoD ③ 공유 링크 열기 → 사본으로 편집해도 이전 로컬 작업은 최근 작업에 그대로 남는다"(새로 추가) + P2-B ⑨·⑫ + cloud.test "클라우드 열기·로컬 사본은 교체 통로에 reason·readOnly·stale·confirmed를 넘긴다" |
| 4 | 손상된 저장본이 있어도 첫 로드에서 사용 가능한 화면 | ✅ | tests/boot-browser.test.mjs "손상된 저장본(dur 0/0)만 있으면 → 데모 + 안내 토스트…"·"정상 문서가 있으면 손상된 문서는 건너뛰고…"·"모양 검사는 통과해도 그리다 예외가 나면…" / tests/boot.test.mjs P2-E ①~③ / tests/schema.test.mjs |
| 5 | 옛 자동 저장 이전 확인, 기존 테스트 전부 통과 | ✅ | tests/session.test.mjs P2-B ⑥(한 번만 옮기고 원본 유지, 두 번 부팅해도 문서 1개)·⑥′(이전 실패해도 원본 유지) / npm test 254건: 236 통과·0 실패·18 건너뜀(브라우저 전용, 아래 별도 실행) |

CLAUDE.md 금지 항목 점검
- `window.confirm`·`window.prompt` 없음(js/cloud.js의 `confirm`·`prompt`는 master에도 있던 자체 비동기 대화상자 함수). app.js 1,110줄(1,600줄 이하). vendor/ 변경 없음. master 대비 새 외부 URL 없음.
- innerHTML 사용 줄 수(engrave.js 제외) master 29 → 30: 늘어난 1건은 js/safe-html.js의 설명 주석이며 사용처가 아니다. 새 UI(최근 작업 ⚠️ 행·대화상자·토스트)는 textContent로만 채운다.
- 테스트 삭제·skip·완화 없음: master 대비 tests에서 사라진 assert 2줄은 모두 같은 뜻의 대체(자동 저장 확인을 localStorage v1 → IndexedDB 기록의 revision 일치로, 회귀 페이지 열기에 pageOptions·preparePage 추가). 기존 테스트 수정은 session.test의 "app.js 직접 setScore 개수" 3→1(P2-E 항목 6이 허락) 하나뿐.

P2 집중 점검: 교체 경로 9개+1 ✅ · 옛 자동 저장 이전 1회성·원본 유지 ✅ · 두 탭 시나리오(Node+브라우저) ✅ · 손상 문서 부팅(Node+브라우저, 변이 36건 전부 잡힘) ✅ · 사본이 이전 작업을 덮지 않음 ✅

전체 검증: npm run check 27개 OK · npm test 254건(236 통과·0 실패·18 건너뜀) · 브라우저(SF_HEADERS=1) 78/78 · 오프라인 검증 48파일·CSP 위반 0·오류 0.
판정: ❌ 없음 → **R-2 가능**(로컬 준비까지만 한다).

### Phase 3 배포 안전망 검토 (2026-11-23, phase/p3-ci)
범위: P3-1·3-2(P0에서 앞당겨 완료)·P3-3·P3-5·P3-6. P3-4는 사람이 GitHub에서 하는 일이라 건너뛰었다(아래 "사람이 해야 할 일").

| # | Phase 3 DoD | 결과 | 증거 |
|---|---|---|---|
| 1 | 일부러 실패시킨 테스트가 있는 PR이 병합 불가(1회 확인) | ⏳ 사람 확인 대기 | push·GitHub 보호 규칙(P3-4)이 있어야 확인할 수 있다. 준비된 것: ci.yml의 잡 이름이 `unit`·`browser`(보호 규칙의 필수 상태 검사 이름과 같음), 실패 시 `playwright-output` 아티팩트 업로드 |
| 2 | `PW_CHANNEL` 없이 번들 Chromium에서 브라우저 테스트 통과 | ⏳ CI 첫 실행에서 확인 | `grep -rn "channel: 'msedge'" tests` → 0줄(P3-1). 이 환경은 번들 Chromium을 받을 수 없어 시스템 Chrome(`PW_CHANNEL=chrome`)으로 CI 명령 전체(SF_HEADERS=1 서버 + tests/*.test.mjs + SF_BLOCK_SAMPLES=1 + --test-concurrency=1)를 재현: 322건 전부 통과·건너뜀 0 |
| 3 | 버전 올리기 = package.json 수정 + `npm run release` | ✅ | tests/release.test.mjs "prepare-release 끝에서 끝까지(임시 폴더): 버전 올리기 = package.json 수정 + 실행"(버전·해시·멱등·CRLF·셸 파일 변경 때만 sw.js 해시 변경) / `npm run release` 2회 연속 결과 동일 |

P3 집중 점검: release 멱등 ✅(변이 9건 전부 잡힘) · 번들 Chromium 통과 ⏳ · 병합 차단 ⏳(3-4 기록 필요) · 배포 후 점검(P3-6) ✅(변이 6건 전부 잡힘)
CLAUDE.md 금지 항목: window.confirm·prompt·새 외부 URL 없음 · app.js 1,110줄 · vendor/ 변경 없음 · 테스트 삭제·skip 없음(사라진 assert 줄은 pwa.test의 더 엄격한 정규식 대체와, ui-v3 한 줄에 기다림을 덧붙인 것뿐).
판정: ❌ 없음, ⏳ 2건(GitHub에서만 확인 가능) → 로컬 릴리스 준비는 가능, **병합 전에 사람이 ⏳ 두 건을 확인**한다.

### Phase 4 재생 메모리 검토 (2026-11-23, phase/p4-playback-memory)
범위: P4-1~P4-4(phase/p3-ci 이후 커밋 8개). 코드는 고치지 않고 점검만 했다.

| # | Phase 4 DoD | 결과 | 증거 |
|---|---|---|---|
| 1 | 인스턴스 불변식 테스트 통과(악보를 바꿔도 샘플 악기 수 = 지금 악보의 연주 파트 수) | ✅ | tests/playback-lifecycle.test.mjs 13건 — "피아노 악보 A → 피아노 악보 B(다른 파트 ID) → 현악 악보 C를 세 바퀴 돌려도 악기·loader·버스가 쌓이지 않는다"(기본·고음질 각각), "installScore를 거치지 않고 악보만 바뀌어도 첫 재생 준비에서 정리된다", "같은 악보에서 파트의 악기만 바꾸면…", "건반 미리 듣기(preview)…" / 변이 검사 13건 전부 잡힘 |
| 2 | 악보 3회 전환 후 메모리가 첫 재생 직후 대비 +50MB 이내(목표, 실측 후 조정) | ⏳ 사람 측정 대기 | 실제 브라우저의 작업 관리자 값이 필요하다. 준비: tests/baseline/PERF.md "Phase 4 후 재생 메모리" 표와 절차, 아래 "사람이 해야 할 일"의 (P4-4). 자동으로 확인된 대리 지표 — 악기·믹서 버스·loader 수가 모든 시점에 현재 악보와 같다(위 1) |
| 3 | 로딩 중 200ms 넘는 Long Task 0~1개(Chrome 성능 패널, 목표) | ⏳ 사람 측정 대기 | Chrome 성능 패널이 필요하다. 준비된 것: 샘플 요청 동시 4개 제한(js/playback.js:215 limitedStorage, 본문을 다 읽을 때까지 슬롯 유지)과 같은 종류 차례 로딩(:258 inTurn). 사람 확인 (P4-1)·(P4-4) |

P4 집중 점검
- 인스턴스 불변식 ✅ — 위 1. 수명 테스트가 앱의 실제 순서(installScore의 setScore → 재생 멈춤 → releaseUnused, 그리고 play())를 그대로 따른다.
- dispose 호출 ✅ — 지난 악보의 악기는 정확히 한 번씩 dispose(tests/playback-lifecycle.test.mjs `disposeCalls === 1`), 로딩 중에 빠진 파트·재시도 때 남은 악기도 정리(tests/playback-release.test.mjs 12건), 재생·재생 준비 중에는 미뤘다가 멈출 때 처리.
- preview 버스 보존 ✅ — tests/playback-release.test.mjs "건반 미리 듣기(preview) 악기와 버스는 지우지 않는다", lifecycle의 preview 시나리오(기본·고음질).
- D2 결정 반영 ✅ — docs/DECISIONS.md D2 = A(메모 갱신). 기본 피아노 = Soundfont acoustic_grand_piano(js/playback.js:135), 고음질 = Splendid(:136), 선택은 이 기기 localStorage에만 저장(악보에 없음). tests/playback-quality.test.mjs 11건 + tests/playback-browser.test.mjs 3건(설정 창 → 저장 → 새로고침 유지, 영어 화면). 🧑 첫 재생까지 시간 체감은 (P4-3) 항목.
- 앱 호출 위치 ✅ — 해제는 app.js installScore(js/app.js:662) 한 곳에서만 부른다(정적 테스트가 js/ 전체에서 확인).

CLAUDE.md 금지 항목 점검
- `window.confirm`·`window.prompt` 없음(js/cloud.js의 자체 비동기 대화상자 함수는 master에도 있던 것). app.js 1,111줄(1,600줄 이하). vendor/ 변경 없음. 새 `innerHTML` 사용 0줄. 새 외부 URL 없음.
- 테스트 삭제·skip·완화 없음: Phase 4 범위에서 기존 테스트 파일을 고친 곳이 없다(전부 새 파일 + PERF.md 끝에 절 추가). 범위 안에서 P4-3이 P4-1·P4-2 테스트를 '고음질로 시작'하게만 바꿨고 단언은 하나도 바꾸지 않았다(audioio-v3.test.mjs는 그대로).
- 설계와 달라진 점(각 Step 기록 참고): 슬롯은 본문을 다 읽을 때까지 유지 · 같은 Splendid 종류는 차례로 로딩 · 해제 기준은 파트ID가 아니라 파트ID:악기 · 재생 중에는 해제를 멈출 때로 미룸 · 설정은 '적용'을 기다리지 않고 바로 저장 · 테스트 훅은 별도 변수에 보관.

전체 검증: npm run check 27개 OK · npm test 320건(297 통과·0 실패·23 건너뜀) · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1, SF_BLOCK_SAMPLES=1, --test-concurrency=1) 379/379 · 오프라인 검증 48파일·CSP 위반 0·오류 0 · verify-deploy 통과.
판정: ❌ 없음, ⏳ 2건(실제 브라우저에서 사람이 재야 하는 측정) → 로컬 릴리스 준비는 가능, **병합 전에 사람이 ⏳ 두 건과 소리 확인 항목((P4-1)~(P4-3))을 확인**한다.

### Phase 5 기둥 방향·편집 반응성 검토 (2026-11-23, phase/p5-stems-render)
범위: P5-A1·A2·B1·B2(phase/p4-playback-memory 이후 커밋 8개 + 검토 중 추가한 테스트 1개). 코드는 고치지 않고 점검만 했다. 검토 중 DoD ②를 실제 브라우저의 내보내기 경로로 한 번에 증명하는 테스트가 없어 **테스트만** 추가했다(tests/export-hits-browser.test.mjs, 코드 변경 없음).

| # | Phase 5 DoD | 결과 | 증거 |
|---|---|---|---|
| 1 | 기둥 테스트 5종 통과, 기준 이미지 갱신 | ✅ 테스트 / ⏳ 기준 이미지 | tests/engrave-v3.test.mjs:251·259·266·282·293 ①~⑤(높은 음 아래·낮은 음 위·2성부는 성부 규칙·높은 8분음표 빔은 아래·사람이 고른 방향 존중) + 보표별 성부 수·쉼표뿐인 성부·경계·옥타바 빔·빔 안 타이/슬러·드럼/TAB 불변 등 12건 / 변이 검사 20건 전부 잡힘. 기준 이미지 4장(tests/baseline/*.png)은 **사람이 Edge로 재생성**해야 한다(자동 테스트는 이 그림을 읽지 않음). `--png-only` 옵션은 tests/capture-baseline.mjs, 테스트는 tests/capture-baseline.test.mjs. 사람 확인 (P5-A1)·(P5-A2) |
| 2 | relayout 후처리 0회, 내보내기 SVG에 `note-hit` 0개 | ✅ | js/app.js:88 후처리 삭제(주석 한 줄만 남음; 정적 테스트 tests/engrave-hits.test.mjs:87) · js/engrave.js:604·610·667 `emitHits`(`!opts.export`, finally로 복원)·:1200 `noteHit` · tests/engrave-hits.test.mjs 10건(:60 내보내기 0개·:71 예외 뒤 복원·:77 캐시·:93 `E.render` 호출 위치 정적 감사) · **실제 브라우저** tests/export-hits-browser.test.mjs(내려받은 SVG 파일·exportPages(PNG도 이 결과를 씀)·인쇄 영역 #print-pages 모두 0개, 화면 클릭 영역은 그대로, 변이 3건 잡힘) · tests/hit-browser.test.mjs(layout 머리와 화면 .note-hit 1:1) |
| 3 | 피아노 100마디 편집 시간 기록 — 300ms 이상이면 9-8을 Phase 8 앞으로 | ✅ | tests/baseline/PERF.md "Phase 5 후 편집 지연": 같은 세션에서 세 코드를 번갈아 3회 잰 중앙값 5-B1 전 347 → 5-B1 후 240 → 5-B2 후 236ms(300ms 미만). docs/DECISIONS.md P5 = "안 당김(Phase 9 그대로)". 사람 PC에서 다시 재는 일은 (P5-B2) ⑥ |

P5 집중 점검
- 기둥 5종 ✅ — 위 1. 드럼·TAB은 성부 규칙 그대로(지금까지와 같음)를 테스트로 고정.
- 기준 이미지 사람 확인 기록 ⏳ — 사람 작업으로 기록했다: (P5-A2) Edge로 `--png-only` 재생성, (P5-A1) 화면에서 기둥 확인.
- 내보내기 SVG note-hit 0 ✅ — 위 2.
- PERF 기록과 9-8 판단 ✅ — 위 3. 편집 지연을 줄인 것은 5-B1(347 → 240ms)이고 5-B2는 측정 오차 안(240 → 236ms)이다 — 5-B2는 구조 정리(클릭 영역을 만드는 곳을 조판기 한 곳으로)가 목적이다.

CLAUDE.md 금지 항목 점검
- `window.confirm`·`window.prompt` 없음. app.js 1,100줄(1,600줄 이하). vendor/ 변경 없음. 새 `innerHTML` 사용 0줄(Phase 4 대비 추가된 줄 0). 새 외부 URL 없음.
- 테스트 삭제·skip·완화 없음: tests/*.test.mjs에서 사라진 assert 0줄(기존 테스트 파일은 줄이 늘기만 함, engrave-v3.test.mjs +200/−0). 사라진 5줄은 모두 tests/capture-baseline.mjs(기준 파일을 만드는 스크립트)의 `--png-only`·`SF_URL` 지원 변경이다. 새 브라우저 테스트의 `skip: !process.env.PLAYWRIGHT_MODULE`은 기존 브라우저 테스트와 같은 관례(조건부).
- 설계와 달라진 점(각 Step 기록 참고): 사람이 고른 기둥 방향이 타이·슬러의 위/아래에도 반영됨(A1) · 드럼·TAB 빔은 성부 규칙 유지(A1) · 이벤트 조회는 문서에서 먼저 나온 것이 이김(B1) · 클릭 영역 좌표는 소수 둘째 자리 반올림(B2) · 내보내기 판단은 모듈 변수 emitHits(B2).

전체 검증: npm run check 27개 OK · npm test 351건(324 통과·0 실패·27 건너뜀) · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1, SF_BLOCK_SAMPLES=1, --test-concurrency=1) 410/410 · 오프라인 검증 48파일·CSP 위반 0·오류 0 · verify-deploy 통과.
판정: ❌ 없음, ⏳ 1건(기준 이미지 4장 — 사람이 Edge로 재생성) → 로컬 릴리스 준비는 가능, **병합 전에 사람이 기준 이미지를 갱신하고 화면에서 기둥 방향·음표 클릭·내보내기를 확인**((P5-A1)·(P5-A2)·(P5-B2))한다.

### Phase 6 좁은 화면 검토 (2026-11-23, phase/p6-narrow-screen)
범위: P6-1~P6-4(phase/p5-stems-render 이후 커밋 8개: Step 4 + 병합 4, 파일 17개 +1,586/−43줄). 점검은 코드를 고치지 않고 했다. 점검 중 P6-3 기록의 상단바 높이가 최종 코드와 4px 달라(79px → 83px) **기록만** 바로잡았다. 릴리스 후보(3.4.0)의 전체 시험에서 간헐 실패가 나 원인을 따로 추적했고, 시험이 아니라 P6-1 코드(js/menus.js)의 틈이어서 별도 Step(P6-1b)으로 고쳤다 — 점검 결과의 숫자는 그 수정 뒤 값이다.

원인 확인(설계서 10장): ≤900px의 `.topbar { max-height:148px; overflow-y:auto }`(옛 style.css:1661)와 ≤500px의 `.topbar .authbar { display:none }`(옛 :1685)는 모두 사라졌다(tests/menus.test.mjs P6-2·P6-3 CSS 정적 테스트가 "다시 생기면 실패"로 지킨다).

| # | Phase 6 DoD | 결과 | 증거 |
|---|---|---|---|
| 1 | 6개 폭 테스트 통과 | ✅ | tests/responsive.test.mjs:72 — 360·375·768·900·901·1200px 각각 ①`#btn-file` → `#file-menu:popover-open`, 맨 아래 항목(클라우드 ▸ 사본 만들기) 한가운데가 화면 안이고 `elementFromPoint`가 그 항목 ②≤500px는 👤 계정 메뉴를 열어 `#btn-member-login` 클릭 가능, 501px 이상은 상단바에서 바로 클릭 가능, 열린 로그인 창이 화면 안·안쪽 가로 스크롤 없음·제출 버튼 클릭 가능 ③`documentElement`·`body` 가로 스크롤 없음(처음·파일 메뉴·계정 메뉴·더보기 메뉴를 연 상태) — 6건 통과. 이 6건은 Phase 6 이전 코드(phase/p5-stems-render)에서 전부 실패하는 것을 먼저 확인했다. 보조: tests/menus-browser.test.mjs:72(1200·900·375·360px), tests/account-menu-browser.test.mjs 7건, tests/topbar-browser.test.mjs 12건. D3(보기·재생·간단한 수정)에 따라 고급 패널은 이 폭 검사에서 제외하고 tests/responsive.test.mjs:133·164·192가 "≤500px에서 안내만(버튼·F11·F12), 500/501px 경계, 보기·재생·간단한 수정은 된다"를 본다 |
| 2 | 375px에서 상단바가 화면 높이의 20% 이하 | ✅ | tests/topbar-browser.test.mjs:90 — 360×640·375×667·375×812·414×896·500×740에서 높이 ≤20%·안쪽 스크롤 없음·가로 스크롤 없음. 최종 코드 실측: 375×667 **83px(12.4%)**, 360×640 83px(13.0%), 375×812 83px(10.2%); 이전 코드는 375×667에서 260px(39%, 7줄). 넓은 쪽: 768×1024 153px(14.9%), 900×800 153px(19.1%), 901×800 161px(20.1%)·1200×800 123px(15.4%)는 데스크톱 배치 그대로(기준은 375px) |

P6 집중 점검
- 6개 폭 ✅ — 위 1.
- 375px 상단바 높이 ✅ — 위 2(첫 줄: 로고·👤·파일·설정·⋯, 둘째 줄: 되돌리기·다시·처음·재생·정지·메트로놈·속성).
- Popover 미지원 대체 경로 ✅(자동 검사는 375·1200px) — popover 속성·showPopover를 지운 브라우저를 흉내 내(HTMLElement.prototype.popover 삭제) 파일·계정·더보기 메뉴가 `.open` 클래스 + `position:fixed` 경로로 열리고 닫히며(바깥 pointerdown·Esc·동시에 하나만) 맨 아래 항목·로그인 버튼에 닿는다: tests/menus-browser.test.mjs:194, tests/account-menu-browser.test.mjs:144, tests/topbar-browser.test.mjs:291. `position:fixed`라 폭에 따라 달라지지 않아 나머지 폭은 따로 돌리지 않았다. 구형 iOS 실기기는 사람 확인 (P6-4)①.
- 변이 검사: P6-1 45건(동등 4건 제외 41건 전부 잡힘) · P6-2 21건(동등 1건은 죽은 줄이라 삭제, 20건 잡힘) · P6-3 34건(타이밍 의존 동등 1건 제외 33건 잡힘) · P6-4 27건(23건 잡힘, 4건은 무해·동등 — 각 Step 행 메모) · P6-1b 7건(7건 전부 잡힘).

CLAUDE.md 금지 항목 점검
- `window.confirm`·`window.prompt` 없음(js/cloud.js의 confirm·prompt는 SF.ui 대화상자를 부르는 기존 래퍼). js/app.js 1,103줄(1,600줄 이하). 새 `innerHTML` 사용 0줄. 새 외부 URL 0. vendor/ 변경 0. 
- 테스트 삭제·skip·완화 없음: Phase 6에서 tests/ 변경은 새 파일 5개(+1,226줄)뿐이고 삭제된 줄이 0줄이다. 새 브라우저 테스트의 `skip: !process.env.PLAYWRIGHT_MODULE`은 기존 브라우저 테스트와 같은 관례(조건부).
- 설계와 달라진 점(각 Step 행의 "설계서와 다른 점" 참고): Popover 미지원 경로도 같은 위치 계산 + position:fixed + .open(P6-1) · 계정 팝오버는 role="group"(메뉴가 아니라 버튼 꾸러미)(P6-2) · 상단바 정리를 위해 테마·언어 말고 믹서·보기·악기·건반 등도 ⋯ 더보기로 옮김, 컨트롤을 3묶음(display:contents)째 옮김(P6-3) · D3에 따라 믹서·타임라인·내비게이터는 ≤500px에서 안내만, 같은 phase의 P6-3 테스트 1건을 그에 맞게 고침(P6-4).

전체 검증(P6-1b 수정 뒤): npm run check 28개 OK · npm test 419건(349 통과·0 실패·70 건너뜀) · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1, SF_BLOCK_SAMPLES=1, --test-concurrency=1) 478/478 · 오프라인 검증 49파일(js/menus.js 추가)·CSP 위반 0·오류 0 · verify-deploy 통과.
판정: ❌ 없음, ⏳ 사람 확인 1건((P6-4) 실제 휴대폰: Android Chrome·iOS Safari 375·390폭·홈 화면 설치) → 로컬 릴리스 준비는 가능, **병합 전에 사람이 실제 휴대폰에서 파일 메뉴·계정 메뉴·⋯ 더보기·안내 문구를 확인**한다. 알려 둔 한계: 가로 방향 휴대폰(501px 이상)은 상단바가 3~4줄(약 150px) · 360×640에서 악보 설정 창은 안쪽 스크롤이 필요 · style.css의 `#piano-scroll` 규칙은 대상이 없는 죽은 CSS(Phase 9 정리 후보).

### Phase 7 가져오기·저장 형식 검토 (2026-11-24, phase/p7-import-save)
범위: P7-A1·P7-B1·P7-B2(phase/p6-narrow-screen 이후 커밋 6개: Step 3 + 병합 3, 파일 29개 +1,464/−63줄). P7-A2(MIDI 일괄 빌더)는 시작 조건(7-A1 뒤에도 2초 초과)에 해당하지 않아 건너뛰었다. 점검은 코드를 고치지 않고 했다.

| # | Phase 7 DoD | 결과 | 증거 |
|---|---|---|---|
| 1 | 1만 음 가져오기: 인덱스 재구축 ≤ 2회, 2초 이하, 결과 동일 | ✅ | tests/audioio-v3.test.mjs:213 — 4,000음에서 악보 전체 훑기: 인덱스 재구축 ≤ 2회·타이 정리 ≤ 2회(실제 4,001 → 1회), :225 계수기가 거짓말하지 않는지 보는 시험 / tests/bench-midi.mjs 1만 음을 이번 점검에서 다시 3회 쟀다: 변환 514·507·509ms(P7-A1 기록 386·430·520ms)·인덱스 재구축 1회 / tests/midi-golden.test.mjs:16(골든 해시 cf9e4f7da2f9bc60·568음)·:91(입력·옵션 37가지 행렬이 옛 코드 eb4ce75에서 계산한 값과 같음) |
| 2 | 저장 크기 −60% 이상(quartet64), 읽기 호환 테스트 통과 | ✅ | tests/save-format.test.mjs:48 quartet64 197,503 → 61,117자 **−69.1%**, :54 기준 악보 5개 모두 −69~−75% / 읽기·내용 보존: :174 v1·v2 모두 읽고 결과가 같음, :162 measures만 있는 옛 파일, :217 3.0.1이 v2를 열었다 다시 저장한 모양도 읽음, :96 빈 성부 쉼표에 걸린 헤어핀 보존, :123 표시가 붙은 쉼표가 든 성부 보존, :146 박자 바꿈·못갖춘마디·여러 성부·왼손 보표 왕복 / tests/save-format-browser.test.mjs(메뉴 위치·두 파일 다시 열기·자동 저장 기록·최근 작업 N마디·영어 화면) / tests/verify-old-app.mjs를 최종 코드로 다시 돌렸다: 3.0.1 기준 앱이 새 앱이 저장한 v2 파일 7종(데모 4곡·quartet64·2성부 편집·빈 성부 헤어핀)을 모두 같은 내용으로 열고 그려진 음표 수도 같으며(42/42·26/26·27/27·19/19·256/256·45/45·4/4) 페이지 오류 0 |
| 3 | 실행 취소 예산 테스트(예산 초과 시 오래된 것부터 제거, 내용 복원 정확) | ✅ | tests/core-v3.test.mjs:363(편집 3회 → 실행 취소 3회가 처음과 쉼표 ID까지 같음)·:384(예산을 넘으면 오래된 것부터 버리고 남은 것은 정확히 복원)·:401(빈 성부 쉼표 ID 보존) / tests/history-budget.test.mjs 13건(개수 200·가장 가까운 1개 보존·바이트 합·예산 즉시 적용·dirty·저장 시점이 버려진 뒤·1초 병합·실패 복구·quartet64 200회·큰 상태 이동 시 예산·경계·0·버리는 순서) / tests/bench-history.mjs: 편집 200회 뒤 기록 메모리 quartet64 +67.2 → +47.9MB(글자 총길이 25,050,180자), 피아노 100마디 +140.8 → +47.9MB(tests/baseline/PERF.md) |

P7 집중 점검
- MIDI 골든 해시 불변 ✅ — 위 1(골든은 옛 코드에서 먼저 계산해 둔 값이고, 새 코드를 대조했다).
- v2 왕복 5곡 ✅ — tests/save-format.test.mjs:38(기준 악보 5개 각각 v2 왕복 ≡ v1 왕복)·:43(5개 각각 v2 → 읽기 → v2가 글자까지 같음)·:146(박자 바꿈·여러 성부 등이 섞인 악보).
- 헤어핀 보존 ✅ — :96(빈 성부 쉼표를 시작·끝점으로 하는 헤어핀) + 대조군 :114(가리키지 않는 빈 성부는 잘리고 온쉼표로 다시 채워짐).
- 3.0.1 앱 호환 ✅ — 위 2의 verify-old-app. 반대 방향("구버전 호환으로 저장" = v1)은 tests/save-file.test.mjs·save-format-browser.test.mjs.
- 실행 취소 예산 ✅ — 위 3.
- 변이 검사: P7-A1 20건(전부 잡힘) · P7-B1 24건(23건 잡힘, 1건은 결과가 같은 변이) · P7-B2 25건(처음 19건, 시험 3건을 더한 뒤 25건 전부 잡힘).

CLAUDE.md 금지 항목 점검
- `window.confirm`·`window.prompt` 없음(js/cloud.js의 confirm·prompt는 SF.ui 대화상자를 부르는 기존 래퍼). js/app.js 1,105줄(1,600줄 이하). 새 `innerHTML` 사용 0줄(engrave.js 제외 30곳 → 30곳). 새 외부 URL 0. vendor/ 변경 0.
- 테스트 삭제·skip·완화 없음: 기존 시험 파일에서 지워진 assert 줄은 5개 파일의 7줄뿐이고 전부 같은 자리에서 같거나 더 많은 assert로 바뀌었다(menus-browser −1/+1 · menus −2/+2 · recent-browser −1/+1 · session-browser −1/+2 · session −2/+4). 이유는 모두 P7-B1이 요구한 모양 변경(파일 머리 version 1 → 2, 메뉴 항목 13 → 14, 마디 수를 실제 마디끼리 비교)이고 P7-B1 계획 기록의 목록과 일치한다. 그 밖의 기존 시험 변경은 값만 바꾼 4곳(boot-browser·core-v3·capture-baseline·bench-midi의 도우미 옮김)이다. 추가된 `.skip`·`.only` 0.

전체 검증: npm run check 28개 OK · npm test 480건(409 통과·0 실패·71 건너뜀) · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1, SF_BLOCK_SAMPLES=1, --test-concurrency=1) 546/546 · 3.0.1 기준 앱 호환 검증 7/7. 오프라인 검증·verify-deploy는 R-2에서 3.5.0으로 한다.
판정: ❌ 없음, ⏳ 사람 확인 3건((P7-A1) 실제 곡 .mid 가져오기 시간·모양 · (P7-B1) 실제 기기에서 저장 v2·구버전 호환 저장 · (P7-B2) 큰 악보 실행 취소·휴대폰 메모리) → 로컬 릴리스 준비는 가능, **병합 전에 사람이 위 세 가지를 확인**한다. 알려 둔 한계: 실제 곡 파일의 가져오기 시간은 못 쟀다(합성 곡 1만 음 0.5초) · 아주 큰 악보에서는 되돌릴 수 있는 횟수가 200번보다 줄어든다(피아노 100마디 약 91번) · 그리기용 임시 값(`__acc`)이 저장 파일과 실행 취소 기록에 약 5% 들어간다(Phase 9 정리 후보).

## 릴리스 준비 기록
(로컬에서 버전 올리기·검증까지만 했다. push·PR·병합·배포는 하지 않았다.)

| 날짜 | 버전 | Phase 브랜치 | 포함 Step | 검증 | 상태 |
|---|---|---|---|---|---|
| 2026-11-23 | 3.0.2 | phase/p1-security | P1-1~P1-5 | check 21 · npm test 115/113/2 · 브라우저(SF_HEADERS=1) 16/16 · 오프라인 검증 통과(캐시 42개, CSP 위반 0) | 로컬 준비 완료 — push 대기 |
| 2026-11-23 | 3.1.0 | phase/p2-work-safety | P2-A~P2-E (+DoD ③ 테스트) | check 27 · npm test 254/236/0/18 skip · 브라우저(SF_HEADERS=1) 78/78 · 오프라인 검증 통과(캐시 48개, CSP 위반 0) | 로컬 준비 완료 — push 대기(Phase 1의 3.0.2를 먼저 배포) |
| 2026-11-23 | 3.1.1 | phase/p3-ci | P3-1·3-2·3-3·3-5·3-6 (3-4는 사람) | check 27 · npm test 269/249/0/20 skip · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1) 328/328 · 오프라인 검증 통과(캐시 48개, CSP 위반 0) · verify-deploy 통과 | 로컬 준비 완료 — push 대기(3.0.2 → 3.1.0 → 3.1.1 순서로 배포, ⏳ 2건은 GitHub에서 확인) |
| 2026-11-23 | 3.2.0 | phase/p4-playback-memory | P4-1~P4-4 | check 27 · npm test 320/297/0/23 skip · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1) 379/379 · 오프라인 검증 통과(캐시 48개, CSP 위반 0) · verify-deploy 통과 | 로컬 준비 완료 — push 대기(3.0.2 → 3.1.0 → 3.1.1 → 3.2.0 순서로 배포, ⏳ 메모리·Long Task 측정과 소리 확인은 사람이) |
| 2026-11-23 | 3.3.0 | phase/p5-stems-render | P5-A1·A2·B1·B2 (+R-1 검토 중 브라우저 테스트 1건) | check 27 · npm test 351/324/0/27 skip · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1) 410/410 · 오프라인 검증 통과(캐시 48개, CSP 위반 0) · verify-deploy 통과 | 로컬 준비 완료 — push 대기(3.0.2 → 3.1.0 → 3.1.1 → 3.2.0 → 3.3.0 순서로 배포, ⏳ 기준 이미지 재생성과 기둥·클릭·내보내기 화면 확인은 사람이) |
| 2026-11-23 | 3.4.0 | phase/p6-narrow-screen | P6-1~P6-4 (+R-2 중 발견한 메뉴 처리기 틈 P6-1b) | check 28 · npm test 419/349/0/70 skip · CI 명령 재현(tests/*.test.mjs 전체, SF_HEADERS=1) 478/478 · 오프라인 검증 통과(캐시 49개, CSP 위반 0) · verify-deploy 통과 | 로컬 준비 완료 — push 대기(3.0.2 → 3.1.0 → 3.1.1 → 3.2.0 → 3.3.0 → 3.4.0 순서로 배포, ⏳ 실제 휴대폰에서 파일 메뉴·계정 메뉴·⋯ 더보기·안내 문구 확인은 사람이 — (P6-4)) |

## 사람이 해야 할 일 (자동 진행에서 건너뜀)
- [ ] P0-2 공유 동결: Supabase SQL Editor에서 공개 악보·문자열 템포 질의 2건 실행, **개수만** 이 파일에 기록. Phase 1 배포 전까지 새 공유 링크 만들지 않기.
- [ ] P0-3 운영 헤더: `curl.exe -sI https://musescore-copy.vercel.app/` 결과를 docs/PRODUCTION_HEADERS.md의 "운영 값"에 채우기.
- [ ] 재생 메모리 기준(설계서 부록 D-3): 실제 브라우저에서 A·B·C1~C3 측정해 tests/baseline/PERF.md 표에 채우기.
- [ ] **Phase 1 릴리스(3.0.2)**: `phase/p1-security`를 처음으로 push → PR → 곧바로 병합(공개~배포 간격 최소화). 배포 뒤 `curl.exe -sI https://musescore-copy.vercel.app/`로 CSP의 script-src가 'self'뿐인지, 앱 콘솔 오류 0, `SF.VERSION === "3.0.2"`, 기존 설치본에 업데이트 알림이 뜨는지 확인.
- [ ] 배포 확인 뒤 `.git/info/exclude`에서 설계서 줄을 지우고 `docs/scoreforge-refactor-design.md`를 커밋.
- [ ] 외부 공유 재개 공지.
- [ ] (P2-B) 실제 Chrome·Safari(iPad 포함)·Firefox에서 악보를 편집한 뒤 새로고침·탭 두 개 시나리오로 자동 저장이 문서별로 나뉘는지 확인. Firefox는 `navigator.storage.persist()` 때 권한 안내가 뜰 수 있음(허용·거부 모두 앱은 정상 동작해야 함). 시크릿 창에서는 저장소 용량이 작을 수 있음.
- [ ] **Phase 2 릴리스(3.1.0)**: 3.0.2(Phase 1)를 먼저 push·병합·배포 확인한 뒤 `phase/p2-work-safety`를 push → PR(R-2 본문: 포함 Step, DoD 체크표, 수동 확인 결과, 되돌리기 방법) → 병합. 병합 전 3.0.x에서 작업하던 브라우저로 새 버전을 열어, 옛 자동 저장본이 최근 작업에 'legacy'로 옮겨졌는지 확인(원본 `scoreforge.autosave.v1`은 지워지지 않는다). 2-B는 데이터 형식이 바뀌는 단계라 문제가 생기면 R-5(되돌리기)의 5번 확인이 필요하다.
- [ ] (P3-3) `.github/workflows/ci.yml`을 처음 push하는 PR에서 `unit`·`browser` 두 잡이 초록인지 `gh pr checks`로 확인. 번들 Chromium(PW_CHANNEL 없음)으로 통과하는지가 로컬에서는 확인되지 않았다(이 환경은 시스템 Chrome만 가능). 일부러 실패시킨 커밋을 1회 올려 `playwright-output` 아티팩트가 올라가는지 확인한 뒤 되돌리기. 액션 메이저(checkout·setup-node·upload-artifact, 지금 v4)를 `gh api repos/actions/checkout/releases/latest --jq .tag_name`으로 확인해 최신 메이저로 올리기.
- [ ] (P3-5) 이 버전을 처음 배포한 뒤 기존 설치본(PWA)에서 업데이트 알림이 뜨는지, 개발자도구 → Application → Cache Storage에서 `scoreforge-shell-<버전>+<해시8자리>`가 새로 생기고 옛 `scoreforge-shell-…`가 지워지는지 확인. 이후 버전 올리기는 `package.json`의 version만 고치고 `npm run release`.
- [ ] (P3-6) 다음 운영 배포 뒤 `deploy-smoke` 워크플로(.github/workflows/deploy-smoke.yml)가 실행되고 통과하는지 확인. Vercel이 GitHub에 남기는 환경 이름이 `Production`이 아니면 조건(`github.event.deployment.environment`)을 첫 실행 로그에 나온 이름으로 고치기. Preview 배포는 Vercel 인증 보호 때문에 건너뛴다.
- [ ] (P3-4, 사람 작업) GitHub에서 master 보호 규칙 적용: Settings → Branches → Add branch protection rule(master) — PR 필수(승인 0명), 상태 검사 `unit`·`browser` 필수 + 최신 상태 유지, 관리자 포함 예외 없음. 또는 프롬프트북 P3-4의 gh 명령(`protect.json`, 저장소 이름 대소문자 확인). 적용 뒤 `test/ci-must-fail` 브랜치에 `assert.equal(1, 2)`만 있는 테스트를 올려 PR이 BLOCKED인지 1회 확인하고 PR·브랜치 삭제. 이 세션에서는 push·설정 변경을 하지 않았다.
- [ ] (P4-1) 실제 Chrome에서 ①피아노 파트가 2개 이상인 악보(예: 피아노 2단 또는 듀엣)를 재생해 소리가 평소와 같은지 ②현악·플루트 같은 Soundfont 악기도 소리가 나는지 ③개발자도구 Network에서 샘플 요청이 한꺼번에 수백 개가 아니라 4개씩 이어서 진행되는지(첫 재생 때 화면이 멈추는 정도가 줄었는지) 확인. 이 환경에는 소리를 들을 방법이 없고 샘플 서버 접속도 막혀 있어(SF_BLOCK_SAMPLES) 실제 음원은 가짜 모듈·가짜 fetch로만 검증했음.
- [ ] (P4-2) 실제 Chrome에서 피아노 악보 → 현악 악보 → 피아노 악보를 번갈아 열며 재생해 소리가 매번 나는지, 개발자도구 콘솔의 `SF.playback.debugStats()`가 `instances`·`buses`를 현재 악보의 파트 수(미리 듣기 사용 시 +1~)로 보여 주는지 확인. 재생 중에 다른 악보를 열면 재생이 멈추고 다음 재생이 정상인지도 확인.
- [ ] (P4-3) 실제 Chrome에서 ①새로 연 브라우저(설정을 건드리지 않은 상태)에서 피아노 악보를 열고 재생 — 첫 재생까지 걸리는 시간이 예전(큰 피아노)보다 짧게 느껴지는지, 소리가 자연스러운지(결정 D2의 '첫 재생까지 시간 체감 확인') ②기본 피아노 음량이 다른 악기(현악·플루트)와 비슷한지 — 너무 작거나 크면 알려 주세요(`SAMPLE_MAP.piano.volume` 96, 고음질 98) ③설정 창(⚙)의 기본 탭에서 '피아노 음질'을 '고음질(약 19MB)'로 바꾸면 안내 토스트가 뜨고, 다음 재생에서 큰 피아노 샘플을 받아(Network 탭: 같은 샘플을 두 번 받지 않고 동시 4개 이하) 소리가 나는지 — 바꾼 뒤 첫 재생은 샘플 로딩 동안 내장 신스로 시작할 수 있음 ④다시 '기본'으로 되돌린 뒤 `SF.playback.debugStats()`의 `loaders`가 0으로 돌아오는지 ⑤새로고침해도 고른 음질이 유지되고 악보 파일(.scoreforge.json) 안에는 음질 정보가 없는지 ⑥Safari·Firefox·휴대폰에서도 설정 창의 '피아노 음질'이 보이고 바뀌는지.
- [ ] (P4-4) 재생 메모리 측정(설계서 부록 D-3, Phase 4 완료 기준 2건): `tests/baseline/PERF.md`의 "Phase 4 후 재생 메모리" 표를 그 절의 절차대로 채우기 — 새 시크릿 창에서 앱을 열어 작업 관리자(Shift+Esc) 메모리 A → 데모 "나비야" 끝까지 재생 B → 다른 데모를 열어 재생 3번 C1~C3, 각 시점의 `SF.playback.debugStats()`도 함께. 기본 음질과 고음질(설정 ▸ 피아노 음질)로 각각 한 번씩, "리팩토링 전" 열은 `git switch --detach v3.0.1-baseline`로 같은 방법으로 재 비교. 판정: C3−B가 약 +50MB 이내이고 로딩 중 200ms 넘는 Long Task(Chrome 성능 패널)가 0~1개이면 통과, 아니면 알려 주세요(목표는 실측 후 조정하기로 한 값).
- [ ] (P5-A1) 실제 화면에서 기둥 방향 확인(데모 4곡과 본인 악보): ①높은 음(가운데 줄 위)의 기둥은 아래, 낮은 음은 위 ②한 마디에 2성부 이상이면 1성부 위·2성부 아래(음높이와 상관없이) ③8분음표 빔 묶음이 음표 위·아래로 자연스럽게 놓이고 묶음 안에서 기둥 방향이 섞이지 않는지 ④타이·슬러가 기둥을 가로지르지 않는지, 가사·코드·셈여림표와 겹치지 않는지 ⑤기타 TAB·드럼 보표는 예전과 같은지. 이상하면 어느 악보·어느 마디인지 알려 주세요.
- [ ] (P5-A2, 사람 작업) 데모 4곡 기준 이미지(tests/baseline/*.png) 갱신 — P5-A1 때문에 높은 음의 기둥이 아래로 바뀌어 그림이 달라졌다. ①`SF_HEADERS=1 npm run serve`로 서버를 띄우고 ②**Edge로**(원래 기준 그림을 만든 브라우저 — Chrome 등 다른 채널은 글꼴 렌더링 차이로 그림 전체가 바뀐다) `PW_CHANNEL=msedge PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node tests/capture-baseline.mjs --png-only` ③`git status`로 PNG 4개(butterfly·star·airplane·rhythm)만 바뀌었는지 확인(다른 파일이 바뀌면 `git restore`; **--png-only 없이 돌리면 기준 JSON·MusicXML·MIDI 13개가 id만 달라진 채 전부 바뀐다**) ④이전 그림은 `git show HEAD:tests/baseline/star.png > output/baseline-diff/star-before.png`처럼 꺼내 새 그림과 나란히 보며 확인: 높은 음 기둥이 아래로, 빔 위치, 가사·기호와 겹침 없음 ⑤`git add tests/baseline/*.png && git commit -m "test(p5-a2): 기둥 방향 변경에 따른 기준 이미지 갱신"` — 코드 변경과 섞지 말고 PNG만 별도 커밋. (자동 테스트는 이 PNG를 읽지 않으므로 늦어져도 CI에는 영향 없음)
- [ ] (P5-B2) 실제 화면에서 음표 클릭·내보내기 확인: ①음표머리를 클릭하면 선택되고, 화음에서는 누른 음만 선택된다 ②선택한 음을 위·아래로 끌어 음높이가 바뀐다 ③TAB의 프렛 숫자와 드럼 음표도 클릭된다 ④악보가 길어 여러 쪽으로 나뉜 보기에서도(쪽마다) 음표가 클릭된다 ⑤파일 ▸ 내보내기(SVG·PNG)와 인쇄 미리보기 악보에 검은 타원·점이 없고 예전과 똑같이 보이는지 ⑥사람 PC에서 `node tests/perf-edit.mjs`(또는 100마디 악보에서 음표를 입력해 보며 체감)로 지연을 재서 중앙값이 300ms 이상이면 알려 주세요 — 그러면 DECISIONS의 P5 줄을 "9-8(증분 조판)을 Phase 8 앞으로"로 바꿉니다.
- [ ] (P6-4) 실제 휴대폰에서 좁은 화면 확인(Android Chrome, iOS Safari 375·390폭, 홈 화면에 설치한 상태 포함): ①파일 메뉴(📁)를 열어 맨 아래 항목(클라우드 ▸ 사본 만들기)까지 메뉴를 스크롤해 누를 수 있는지, 메뉴 바깥을 누르면 닫히는지(구형 iOS는 특히) ②👤 계정 메뉴를 열어 로그인·회원가입 버튼이 눌리고 로그인 창이 화면에 다 들어오는지 ③상단바가 두 줄(로고·계정·파일·설정·⋯ / 되돌리기·재생·속성)로 보이고 악보가 충분히 보이는지, 가로로 밀리지 않는지 ④⋯ 더보기를 열어 테마·언어·빠르기·악기·건반·도움말이 눌리는지(iOS Safari에서 선택 칸을 눌러 값을 고를 때 더보기 팝업이 열린 채 유지되는지) ⑤악보에서 음표를 눌러 고르고 아래 빠른 입력 줄(음길이·삭제·실행 취소)로 고친 뒤 재생·정지가 되는지 ⑥믹서·타임라인·내비게이터를 누르면 창이 열리지 않고 "데스크톱에서 사용할 수 있어요" 안내만 뜨는지(D3) ⑦가로 방향(폭 501px 이상)에서는 상단바가 3~4줄(약 150px)로 보이는데 그 안의 컨트롤이 모두 눌리는지 ⑧360×640 같은 작은 화면에서 악보 설정 창의 적용·취소 버튼에 창 안쪽 스크롤로 닿는지. 결과(기기·OS·브라우저·되는 것/안 되는 것)를 이 줄 아래에 적어 주세요.
- [ ] (P7-A1) 실제 곡 .mid로 가져오기 확인 — 자동 시험은 합성 곡 1만 음(0.43초)과 기준 악보 .mid 4곡·고정 시드 입력으로 결과가 구현 전과 같음을 확인했지만, 실제 곡 파일은 받지 못했다. ① 가지고 있는 .mid 중 큰 것(1,000음 이상이면 좋다) 한 개를 파일 ▸ 열기로 가져와 걸리는 시간이 2초 이하인지(2초를 넘으면 파일을 보관해 알려 주기 → P7-A2) ② 가져온 악보의 음표·타이·쉼표가 예전 주소(운영)에서 가져온 것과 같아 보이는지, ③ 재생했을 때 소리가 같은지. 어긋나면 그 .mid를 보관해 알려 주기.
- [ ] (P7-B1) 실제 기기에서 저장 형식 v2 확인 — 자동 시험은 3.0.1 기준 앱이 v2 파일 7종을 같은 내용으로 여는 것까지 확인했다(tests/verify-old-app.mjs). 사람이 볼 것: ① 파일 메뉴 "💾 저장 (.json)"으로 내려받은 파일을 다른 브라우저·기기(휴대폰 포함)에서 열어 음표·가사·셈여림·헤어핀이 같은지, 파일 크기가 예전의 1/4 안팎인지 ② "💾 구버전 호환으로 저장"으로 받은 파일이 지금 운영 중인 앱(3.0.1)에서 열리는지 ③ 운영 앱에서 쓰던 악보를 새 버전에서 열어 편집·새로고침해도 그대로인지, 최근 작업 창의 "N마디"가 맞는지 ④ GitHub Actions에서 `unit`·`browser` 두 잡이 초록인지(이 단계에서 새 시험 40건). 어긋나면 그 파일을 보관해 알려 주기.
- [ ] (P7-B2) 실제 기기에서 큰 악보 실행 취소 확인 — 자동 시험은 quartet64(64마디 사중주)·피아노 100마디(1,600음)에서 편집 200회 뒤 기록 메모리가 약 48MB에서 멈추고 마지막 편집이 정확히 되돌아옴을 확인했다. 사람이 볼 것: ① 가지고 있는 큰 악보(여러 성부, 100마디 이상)를 열어 50번쯤 편집한 뒤 ↶ 실행 취소를 연타해 악보가 단계마다 정확히 되돌아오는지(음표·가사·셈여림·헤어핀), ↷ 다시 실행으로 앞으로도 가는지 ② 실행 취소 한 번이 체감상 이전과 비슷한 속도인지(눈에 띄게 느려졌다면 알려 주기) ③ 휴대폰(특히 메모리가 적은 기기)에서 큰 악보를 오래 편집해도 탭이 꺼지지 않는지 ④ 아주 큰 악보에서 되돌릴 수 있는 횟수가 줄어드는 것(100마디 피아노는 약 90번)이 사용에 거슬리는지 — 거슬리면 예산(48MB, js/core.js의 HISTORY_BUDGET)을 키우는 것은 한 줄 수정이다 ⑤ GitHub Actions에서 `unit`·`browser` 두 잡이 초록인지(이 단계에서 새 시험 16건). 어긋나면 그 악보 파일을 보관해 알려 주기.
- [ ] (P2-E) 실제 Chrome·Safari·Firefox에서 부팅 안전 모드 확인: ①개발자도구에서 IndexedDB `scoreforge`의 `kv`에 `boot.pending`(값 `{"<문서ID>": 시각}`)을 넣고 새로고침 → "지난번에 여는 중 문제가 있었어요" 대화상자(그래도 열기·파일로 내려받기·새 악보로 시작) ②[파일로 내려받기]가 열지 않은 원본을 `제목.scoreforge.json`으로 받는지 ③손상 기록(`docs`의 한 기록에서 `data`의 어떤 음표 `dur`을 `{n:0,d:0,dots:0}`로)을 만든 뒤 새로고침 → 데모+안내 토스트, 최근 작업 맨 위 ⚠️ 행 ④백그라운드 탭으로 복원되는 경우(브라우저 재시작 후 탭 복원)에 "여는 중" 표시가 남지 않는지.
- [ ] (P2-D) 실제 Chrome·Safari(iPad 포함)·Firefox에서 탭 두 개로 확인: ①같은 악보를 두 번째 탭에서 열면 읽기 전용+안내 띠 ②첫 탭을 닫거나 다른 악보로 바꾸면 "이제 편집할 수 있어요"가 뜨고 [편집 시작]이 최신 내용으로 연다 ③탭 복제·새로고침 때 악보를 잃지 않는다 ④Safari에서 탭이 백그라운드로 가거나 절전된 뒤에도 잠금이 유지되는지(Web Locks는 페이지가 살아 있는 동안만 유지, 폐기된 탭은 풀린 것으로 보임).
- [ ] (P2-C) 실제 iPad·휴대폰 브라우저에서 최근 작업 창(작은 화면 배치)과 [되돌리기] 토스트가 하단 건반·툴바에 가려지지 않는지 확인. 저장 공간 사용량 줄(navigator.storage.estimate)은 Safari·Firefox에서 값이 근사치이거나 없을 수 있음(없으면 줄이 숨겨짐).
- [ ] (P2-A) 실제 Chrome에서 한글 제목 악보를 파일로 저장했을 때 파일 이름이 `제목.scoreforge.json`으로 나오는지 확인. 헤드리스 Chrome에서는 내려받기 이름이 `download`로 보고됨(앱 코드는 `a.download`에 정상 이름을 넣고 있어 헤드리스 한정 현상으로 보임).
