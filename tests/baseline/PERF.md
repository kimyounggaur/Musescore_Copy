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
