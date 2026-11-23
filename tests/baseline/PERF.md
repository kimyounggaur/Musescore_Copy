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
