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

## 사람이 해야 할 일 (자동 진행에서 건너뜀)
- [ ] P0-2 공유 동결: Supabase SQL Editor에서 공개 악보·문자열 템포 질의 2건 실행, **개수만** 이 파일에 기록. Phase 1 배포 전까지 새 공유 링크 만들지 않기.
- [ ] P0-3 운영 헤더: `curl.exe -sI https://musescore-copy.vercel.app/` 결과를 docs/PRODUCTION_HEADERS.md의 "운영 값"에 채우기.
- [ ] 재생 메모리 기준(설계서 부록 D-3): 실제 브라우저에서 A·B·C1~C3 측정해 tests/baseline/PERF.md 표에 채우기.
