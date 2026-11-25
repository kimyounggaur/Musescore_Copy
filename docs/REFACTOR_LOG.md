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
| 2026-11-23 | P1-2 | refactor/p1-2-tempo | 완료 | 없음 | 속성 패널 입력 1곳 수정, 사용처 29곳 점검표 기록(아래), PR 템플릿 추가. 정적 검사 테스트: 수정 전 실패(1곳)→수정 후 통과 |
| 2026-11-23 | P1-3 | refactor/p1-3-sanitize | 완료 | 템포는 설계서의 Math.round 대신 clamp만(정정 C3) | 테스트 3개: 수정 전 2개 실패·기준 악보 테스트 통과 → 수정 후 전부 통과. npm test 112/111/1 |
| 2026-11-23 | P1-4 | refactor/p1-4-csp | 완료 | 운영 CSP 값은 샌드박스에서 확인 못 함(P0-3 미완료) | CSP script-src 'self'만, CDN 예비 경로 3곳 제거, audioio-v3 바꿔치기 단언 추가. SF_HEADERS=1에서 CSP 위반 0·폰트 OK·재생 호출 OK. npm test 114/113/1, ui-v3 13/13(1회는 기존 간헐 실패 #8) |
| 2026-11-23 | P1-5 | refactor/p1-5-xss-e2e | 완료 | 없음 | 악성 파일 E2E(시나리오 2개) 통과. 취약 상태(수정 되돌림)에서는 2개 모두 실패함을 확인. tests/fixtures/make-xss-fixture.mjs로 파일 생성 |
| 2026-11-23 | P2-A | refactor/p2-a-replace-guard | 완료 | 교체 경로가 설계서 표(7개)+시작 화면 2개 외에 ui-v3.js:219의 중복 앱 파일 실행 소비자 1곳 더. 클라우드 열기에 stale 검사 유지(설계서에 없던 보강) | 9개 경로(+1) 모두 SF.session.replaceScore 경유. session.test 15 + session-browser 18 + cloud 3 추가. check 22 · npm test 136/131/0/5 · 브라우저(SF_HEADERS=1) 34/34 · 오프라인 검증 통과(캐시 43개). 가드를 끄면 Node 테스트 5개 실패 확인. app.js 999줄. 읽기 전용 화면에서 앱 파일 실행 시 이제 편집 가능 상태로 열림(기존 버그 수정). 관찰: 한글 제목 파일 저장 시 헤드리스 Chrome이 내려받기 이름을 'download'로 보고함(기존 동작, 이 Step에서 안 건드림 — 실제 Chrome 확인은 사람 몫) |
| 2026-11-23 | P2-B | refactor/p2-b-idb-autosave | 통과: check 23 · npm test 170/160/0(스킵 10=브라우저) · 브라우저 45/45 · 오프라인 검증 통과 | docId는 META_KEYS 대신 LOCAL_META_KEYS · 파일 저장 시각은 core 'saved' 이벤트에서 기록 · P2-A 브라우저 테스트는 IndexedDB 차단 환경에서 실행(기대값 무변경) · 상세는 '계획 기록 — P2-B' | store.js 신규, io.js writer 훅, session.js(문서 id·보관·부팅 복원·옛 자동 저장 이전·충돌 대화상자), 상태 표시줄 '마지막 파일 저장', ui-v3:113 한 줄 교체 |
| 2026-11-23 | P2-C | refactor/p2-c-recent | 통과: check 24 · npm test 184/170/0(스킵 14=브라우저) · 브라우저(SF_HEADERS=1) 57/57 · 오프라인 검증 통과(캐시 45개) | ①공간 부족(QuotaExceededError)이면 최근 작업 창을 사용량과 함께 열되, 탭마다 처음 한 번만 자동으로 열고 그 뒤로는 토스트의 [최근 작업] 버튼으로 안내(실패할 때마다 모달이 뜨면 편집 중 포커스를 뺏음) ②보관된 기록을 여는 일은 SF.session.openDoc(id)로 한 곳에 모음(결과 opened/canceled/missing/unreadable) — 최근 작업 창과 되돌리기 토스트가 같이 씀 ③io.jsonFileText(data) 추출(saveJSON과 출력 동일) — 목록의 내려받기가 같은 파일 형식을 씀 ④지금 열린 문서의 내려받기는 화면의 악보 기준(일반 저장과 같고 파일 저장 시각이 남음), 나머지는 보관된 기록 그대로(기록은 건드리지 않으므로 '마지막 파일 저장'에는 반영 안 됨) ⑤목록에서 열 때 창을 먼저 닫고 취소·실패하면 목록으로 되돌아옴(토스트·확인 창이 모달 뒤에 가려지지 않게) ⑥토스트에 버튼이 있으면 마우스·키보드가 올라가 있는 동안 타이머를 멈추고 6초, 숨은 토스트는 visibility:hidden(버튼이 탭 순서에 남지 않게) ⑦다른 탭 편집 중 표시는 SF.lock?.heldElsewhere?.() 훅과 번역 문구만 마련(2-D에서 채움) ⑧P2-B 브라우저 테스트 2곳은 토스트 전체 글자 대신 문구 부분(#toast > span)을 같은 문자열로 비교하고 [되돌리기] 존재를 추가 확인(기대 문구 무변경) | js/recent.js 신규(163줄) · recent.test 5 + recent-browser 12 + session.test 5 추가. 변이 검사 7종(제목을 HTML로 넣기·현재 문서 삭제 허용·공간 부족 창 매번 열기·되돌리기 버튼 제거·같은 문서에도 버튼·깨진 기록 무시·토스트 버튼 잔류) 모두 테스트가 잡음. 화면 확인: 어두운·밝은·Pretty·Cute 테마와 폭 390px. 측정: 300마디 366KB 문서 100건에서 listDocs 250ms·창 열기 208ms — restoreOnBoot가 부팅 때마다 listDocs를 부르는 점은 P2-E에서 지연 호출로 고칠 것. 관찰: 밝은 테마들에서 .tbtn.danger의 빨강이 테마 CSS에 덮여 삭제 버튼이 일반 버튼처럼 보임(기존 현상, Phase 9에서). 로그 정리: 흩어져 있던 P1-2~P1-5·P2-A·P2-B 행을 Step 표로 옮기고 logrow가 Step 표 끝에 붙이도록 고침 |
| 2026-11-23 | P2-D 탭 간 충돌 방지 | refactor/p2-d-tab-lock | 통과 — check 26개, npm test 222건(205 통과·0 실패·17 건너뜀), 브라우저 69/69(새 lock-browser 12), 오프라인 검증 47파일·오류 0, 변이 검사 23건 전부 잡힘 | ①풀림 "안정화"(settle 800ms, 놓았다 곧바로 다시 잡는 새로고침이면 알리지 않음) 추가 ②쓰기 직전 안전망(교체 통로 밖에서 들어온 악보도 잠금을 잡고, 남이 쥔 문서는 저장 실패로 처리) 추가 ③restoreOnBoot가 listDocs를 필요할 때만 읽음(2-E 예정분을 앞당김) ④부팅 데모는 claim 대신 adopt(잠금까지) ⑤최근 작업 창이 열려 있으면 docs-changed·doc-closed로 저절로 새로 그림(초점 유지) ⑥사본 제목 접미사는 언어에 맞춰 " 사본"/" (copy)" | SF.lock(acquire·heldElsewhere·watch·notify·onMessage), SF.session.lockState/onLock/resume/copyForEditing/adopt, js/lock-ui.js(배너), body.tab-locked. Web Locks 없는 브라우저는 BroadcastChannel ping(200ms)+tabId 비교로 대체, 둘 다 없으면 막지 않고 엶. 실제 Safari·Firefox 다중 탭 확인은 사람이 해야 할 일에 기록 |
| 2026-11-23 | P2-E 부팅 안전 모드 | refactor/p2-e-safe-boot | 통과 — check 27개, npm test 253건(235 통과·0 실패·18 건너뜀, 새 테스트 schema 9·boot 21·boot-browser 1묶음 8건), 브라우저 78/78(새 boot-browser 9), 오프라인 검증 48파일·CSP 위반 0·오류 0, 변이 검사 36건 전부 잡힘(쓰이지 않는 force 인자 1건은 죽은 코드라 삭제, 격리 위 고정은 테스트 보강 뒤 잡힘) | ①손상 기록 처리를 4종으로 나눔: 설치 전에 읽을 수 없는 기록→격리하고 다음 정상 문서로(없으면 데모), 설치·첫 렌더 예외→격리+데모, 지난 부팅이 끝나지 못한 표시→자동으로 안 열고 안전 모드 대화상자, 이미 격리된 기록→자동 선택에서 조용히 제외(기존 테스트 P2-B ⑦의 '다음 정상 문서로 건너뜀'과 설계서의 '격리+데모'가 부딪혀 둘 다 살림) ②boot.pending은 문서 하나가 아니라 {문서ID: 시각} 맵(여러 탭 동시 부팅 때 서로의 표시를 지우지 않음, 20개 상한) ③격리·표시 쓰기는 store.updateDoc/updateKv의 한 트랜잭션(읽은 뒤 다른 탭이 새로 저장했으면 덮어쓰지 않음) ④숨은 탭은 프레임이 멈추므로 첫 렌더 대기를 건너뜀(상한 1.5초) ⑤tests/session.test.mjs 구조 고정 테스트의 app.js 직접 C.setScore 개수 3→1(설계 항목 6이 허락한 유일한 기존 테스트 수정; lock.test의 고정 문구는 코드를 맞춰 그대로 통과) | js/schema.js 신규(checkShape·ScoreFormatError), session.bootInfo/bootBegin/bootDone/bootFailed/bootOpenPending/bootSkipPending/bootDownloadPending, store.updateDoc/updateKv, 최근 작업 ⚠️ 행(맨 위·내려받기 우선). 알려진 한계: IndexedDB를 못 쓰는 브라우저(localStorage 대체)는 격리 없음, 실제 Safari·Firefox 확인은 사람이 해야 할 일 |

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

## 릴리스 준비 기록
(로컬에서 버전 올리기·검증까지만 했다. push·PR·병합·배포는 하지 않았다.)

| 날짜 | 버전 | Phase 브랜치 | 포함 Step | 검증 | 상태 |
|---|---|---|---|---|---|
| 2026-11-23 | 3.0.2 | phase/p1-security | P1-1~P1-5 | check 21 · npm test 115/113/2 · 브라우저(SF_HEADERS=1) 16/16 · 오프라인 검증 통과(캐시 42개, CSP 위반 0) | 로컬 준비 완료 — push 대기 |
| 2026-11-23 | 3.1.0 | phase/p2-work-safety | P2-A~P2-E (+DoD ③ 테스트) | check 27 · npm test 254/236/0/18 skip · 브라우저(SF_HEADERS=1) 78/78 · 오프라인 검증 통과(캐시 48개, CSP 위반 0) | 로컬 준비 완료 — push 대기(Phase 1의 3.0.2를 먼저 배포) |

## 사람이 해야 할 일 (자동 진행에서 건너뜀)
- [ ] P0-2 공유 동결: Supabase SQL Editor에서 공개 악보·문자열 템포 질의 2건 실행, **개수만** 이 파일에 기록. Phase 1 배포 전까지 새 공유 링크 만들지 않기.
- [ ] P0-3 운영 헤더: `curl.exe -sI https://musescore-copy.vercel.app/` 결과를 docs/PRODUCTION_HEADERS.md의 "운영 값"에 채우기.
- [ ] 재생 메모리 기준(설계서 부록 D-3): 실제 브라우저에서 A·B·C1~C3 측정해 tests/baseline/PERF.md 표에 채우기.
- [ ] **Phase 1 릴리스(3.0.2)**: `phase/p1-security`를 처음으로 push → PR → 곧바로 병합(공개~배포 간격 최소화). 배포 뒤 `curl.exe -sI https://musescore-copy.vercel.app/`로 CSP의 script-src가 'self'뿐인지, 앱 콘솔 오류 0, `SF.VERSION === "3.0.2"`, 기존 설치본에 업데이트 알림이 뜨는지 확인.
- [ ] 배포 확인 뒤 `.git/info/exclude`에서 설계서 줄을 지우고 `docs/scoreforge-refactor-design.md`를 커밋.
- [ ] 외부 공유 재개 공지.
- [ ] (P2-B) 실제 Chrome·Safari(iPad 포함)·Firefox에서 악보를 편집한 뒤 새로고침·탭 두 개 시나리오로 자동 저장이 문서별로 나뉘는지 확인. Firefox는 `navigator.storage.persist()` 때 권한 안내가 뜰 수 있음(허용·거부 모두 앱은 정상 동작해야 함). 시크릿 창에서는 저장소 용량이 작을 수 있음.
- [ ] **Phase 2 릴리스(3.1.0)**: 3.0.2(Phase 1)를 먼저 push·병합·배포 확인한 뒤 `phase/p2-work-safety`를 push → PR(R-2 본문: 포함 Step, DoD 체크표, 수동 확인 결과, 되돌리기 방법) → 병합. 병합 전 3.0.x에서 작업하던 브라우저로 새 버전을 열어, 옛 자동 저장본이 최근 작업에 'legacy'로 옮겨졌는지 확인(원본 `scoreforge.autosave.v1`은 지워지지 않는다). 2-B는 데이터 형식이 바뀌는 단계라 문제가 생기면 R-5(되돌리기)의 5번 확인이 필요하다.
- [ ] (P2-E) 실제 Chrome·Safari·Firefox에서 부팅 안전 모드 확인: ①개발자도구에서 IndexedDB `scoreforge`의 `kv`에 `boot.pending`(값 `{"<문서ID>": 시각}`)을 넣고 새로고침 → "지난번에 여는 중 문제가 있었어요" 대화상자(그래도 열기·파일로 내려받기·새 악보로 시작) ②[파일로 내려받기]가 열지 않은 원본을 `제목.scoreforge.json`으로 받는지 ③손상 기록(`docs`의 한 기록에서 `data`의 어떤 음표 `dur`을 `{n:0,d:0,dots:0}`로)을 만든 뒤 새로고침 → 데모+안내 토스트, 최근 작업 맨 위 ⚠️ 행 ④백그라운드 탭으로 복원되는 경우(브라우저 재시작 후 탭 복원)에 "여는 중" 표시가 남지 않는지.
- [ ] (P2-D) 실제 Chrome·Safari(iPad 포함)·Firefox에서 탭 두 개로 확인: ①같은 악보를 두 번째 탭에서 열면 읽기 전용+안내 띠 ②첫 탭을 닫거나 다른 악보로 바꾸면 "이제 편집할 수 있어요"가 뜨고 [편집 시작]이 최신 내용으로 연다 ③탭 복제·새로고침 때 악보를 잃지 않는다 ④Safari에서 탭이 백그라운드로 가거나 절전된 뒤에도 잠금이 유지되는지(Web Locks는 페이지가 살아 있는 동안만 유지, 폐기된 탭은 풀린 것으로 보임).
- [ ] (P2-C) 실제 iPad·휴대폰 브라우저에서 최근 작업 창(작은 화면 배치)과 [되돌리기] 토스트가 하단 건반·툴바에 가려지지 않는지 확인. 저장 공간 사용량 줄(navigator.storage.estimate)은 Safari·Firefox에서 값이 근사치이거나 없을 수 있음(없으면 줄이 숨겨짐).
- [ ] (P2-A) 실제 Chrome에서 한글 제목 악보를 파일로 저장했을 때 파일 이름이 `제목.scoreforge.json`으로 나오는지 확인. 헤드리스 Chrome에서는 내려받기 이름이 `download`로 보고됨(앱 코드는 `a.download`에 정상 이름을 넣고 있어 헤드리스 한정 현상으로 보임).
