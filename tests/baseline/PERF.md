# Render Baseline

20 renders, Edge headless, 1440x1080.

| Score | Baseline ms |
| --- | ---: |
| butterfly | 13.7 |
| star | 13.4 |
| airplane | 7.6 |
| rhythm | 5.7 |
| quartet64 | 54.0 |

## v3 comparison (2026-09-03)

Same 64-measure string quartet, 20 calls in Edge headless. New layout includes
metadata, annotation lanes and page allocation. Timings are wall-clock samples,
not stable CI assertions.

| Path | 20 renders, ms |
| --- | ---: |
| Original renderer | 54.0 |
| v3 forced full rendering (cache disabled) | 369.0 |
| v3 revision cache (one full render + 19 reuses) | 18.8 |

The actual app opts into revision caching. Repeated unchanged rendering is 65.2%
below the original 20-render baseline. This is not a claim that new full layout is
faster: cold layout has more work and remains a future optimization target.
Selecting a note invokes E.render zero times and schedules no autosave, verified
with an actual pointer click. Raw model consumers may use uncached rendering;
cache users must edit via core.mutate/core helpers or call core.invalidate.

## 리팩토링 전 기준 (016ad44)

측정일 2026-11-23. 환경: 클라우드 샌드박스(Ubuntu 24.04), Node v22.23.5, Chrome for Testing 153(헤드리스, `PW_CHANNEL=chrome`). 같은 PC라도 값은 ±20% 흔들린다. 나중 Phase와 비교할 때는 같은 환경에서 다시 잰다.

| 측정 | 값 | 방법 | 환경 | 비교할 Phase |
|---|---:|---|---|---|
| MIDI 가져오기 1,000음(변환) | 1,335ms | `node tests/bench-midi.mjs 1000` | Node 22 | 7-A1 |
| MIDI 가져오기 2,000음(변환) | 3,524ms | 〃 2000 | Node 22 | 7-A1 |
| MIDI 가져오기 4,000음(변환) | 13,119ms | 〃 4000 | Node 22 | 7-A1 |
| MIDI 가져오기 10,000음(변환) | 108,914ms | 〃 10000(1회) | Node 22 | 7-A1 |
| 피아노 100마디 음표 입력 1회 — 중앙값 | 306ms (3회: 359·294·306) | `node tests/perf-edit.mjs` 3회의 중앙값 | Chrome 153, 1,600음 | 5-B, 9-8 |
| 피아노 100마디 음표 입력 1회 — 최댓값 | 442ms (3회 중 가장 큰 값, 360~442) | 〃 | 〃 | 5-B, 9-8 |
| quartet64 저장 바이트 | 197,535B | `fromJSON`→`toJSON`→`JSON.stringify` 길이(설계서 197,503B) | Node 22 | 7-B1 |
| 재생 메모리 A·B·C1~C3 | (사람이 잼) | 설계서 부록 D-3 | 실제 브라우저 | 4-1~4-4 |

참고: 편집 중앙값이 300ms를 넘으므로 결정 기록의 P5 행(9-8을 앞당길지)은 Phase 5 뒤에 다시 재서 판단한다.

## Phase 4 후 재생 메모리 (4-4)

자동으로 확인한 것: **악보를 몇 번 바꿔도 살아 있는 샘플 악기 수 = 지금 악보의 연주 파트 수** (`tests/playback-lifecycle.test.mjs`). 피아노 악보 A → 피아노 악보 B(다른 파트 ID) → 현악 악보 C(+드럼 파트)를 세 바퀴 돌려도 `debugStats()`의 `instances`는 연주 파트 수, `buses`는 파트 수와 같고, 지난 악보의 악기는 정확히 한 번씩 `dispose`되며, `loaders`는 쓰는 Splendid 종류 수(고음질 피아노가 있을 때만 1)를 넘지 않는다. 기본 음질과 고음질 두 경우 모두 확인했다.

아래 표는 **사람이 채운다**(실제 브라우저의 작업 관리자 값은 자동으로 읽을 수 없다). 같은 PC·같은 Chrome에서 같은 순서로 재야 비교할 수 있다.

**D-3 절차**: 새 시크릿 창 → 앱 열기 → Chrome 작업 관리자(Shift+Esc)에서 이 탭의 메모리 값 → **A** → 데모 "나비야"(파일 ▸ 데모)를 끝까지 재생 → **B** → 다른 데모를 열어 재생하기를 3번 → **C1·C2·C3**. 각 시점마다 개발자도구 콘솔에서 `SF.playback.debugStats()`를 같이 적는다. 두 번 잰다: ① 설정을 건드리지 않은 기본 음질, ② 설정 ▸ 피아노 음질 ▸ 고음질(약 19MB)로 바꾼 뒤(시크릿 창을 새로 열어 다시 시작).

| 시점 | 리팩토링 전 | Phase 4 후 — 기본 음질 | Phase 4 후 — 고음질 | `debugStats()` instances / loaders / buses |
|---|---:|---:|---:|---|
| A 앱을 연 직후 | | | | |
| B 나비야 재생 직후 | | | | |
| C1 다른 데모 재생 (1회) | | | | |
| C2 (2회) | | | | |
| C3 (3회) | | | | |

판정(설계서 8장): C3 − B ≤ 약 +50MB(목표, 실측 후 조정) · 로딩 중 200ms를 넘는 Long Task 0~1개(Chrome 성능 패널, 목표) · 모든 시점에서 `instances` = 지금 악보의 연주 파트 수. "리팩토링 전" 열은 `git switch --detach v3.0.1-baseline`로 같은 방법으로 잰 값(`debugStats()`는 이 시점에 없으니 메모리 값만).
