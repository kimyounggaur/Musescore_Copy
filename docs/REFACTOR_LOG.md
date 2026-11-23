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
| 기준 브라우저 테스트 | `PW_CHANNEL=chrome`, ui-v3 13개 — 헤더 없음: 4회 중 4회 통과 / SF_HEADERS=1: 4회 중 3회 통과, 1회 `MIDI options, safe names…` 실패 |

## 알려진 불안정 테스트
- `tests/ui-v3.test.mjs` 하위 테스트 "MIDI options, safe names, responsive properties and accessibility"(142행): 대화상자의 확인을 누른 직후 `window.midiOptionResult`를 바로 읽어서 간헐적으로 `undefined`가 된다(016ad44에 이미 있는 경쟁 상태, 앱 오류 아님). 단언은 건드리지 않았다. P3-3(CI)에서 기다림을 추가하는 안을 검토한다.

## Step 기록
| 날짜 | Step | 브랜치 | 결과 | 설계서와 다른 점 | 메모 |
|---|---|---|---|---|---|
| 2026-11-23 | P0-0 | phase/p0-baseline | 완료 | 없음 | 기준 npm test 106/105/1, check 20개 |
| 2026-11-23 | P3-1·P3-2 (앞당김) | refactor/p3-1-browser-channel | 완료 | 번들 Chromium 대신 `PW_CHANNEL=chrome`으로 확인. 컨텍스트 언어를 ko-KR로 고정(`pageOptions`) | Edge가 없는 환경이라 P0-0 지침대로 앞당김. 앱이 navigator.language로 언어를 골라, 영어 Chrome에서는 한국어 문구 단언이 실패했음 |
