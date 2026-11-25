# innerHTML 사용처 보고 (Trusted Types 준비)

P9-6에서 만든 보고서입니다. 앱 코드가 HTML 문자열을 DOM에 넣는 곳(`.innerHTML =`, `.outerHTML =`, `insertAdjacentHTML(`, `document.write(`)을 파일별로 세어 두고, 나중에 브라우저의 Trusted Types를 켜 볼 때 어디부터 봐야 하는지 알려 줍니다. **목록화만** 하며 각 사용처의 안전 여부를 판정하지 않습니다.

- 목록 도구: `node tests/tools/list-html-sinks.mjs` (이 문서의 표와 목록은 이 도구의 결과이고, `tests/structure-docs.test.mjs`가 두 개가 같은지 지킵니다.)
- 이 단계에서 **헤더·CSP는 바꾸지 않았습니다.** `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` 헤더는 운영 설정이라 사람이 정합니다(🧑 — 아래 "다음에 할 일").

## 분류

| 분류 | 뜻 | 보는 방법 |
|---|---|---|
| 지움 | 빈 문자열로 비우는 용도(`= ""`) | 따로 볼 필요 없음 |
| 고정 문구 | 코드에 적힌 글자만 넣음(변수 없음) | 번역 문구를 바꿀 때만 확인 |
| 값 섞임 | 변수·계산 결과가 문자열에 들어감 | Trusted Types를 켜기 전에 하나씩 확인할 대상 |

## 파일별 개수

| 파일 | 합계 | 지움 | 고정 문구 | 값 섞임 |
|---|---:|---:|---:|---:|
| js/app.js | 11 | 0 | 0 | 11 |
| js/auth.js | 6 | 0 | 4 | 2 |
| js/engrave.js | 10 | 7 | 0 | 3 |
| js/export-ui.js | 2 | 0 | 0 | 2 |
| js/input.js | 3 | 0 | 2 | 1 |
| js/palette.js | 2 | 0 | 0 | 2 |
| js/panels.js | 6 | 0 | 0 | 6 |
| **합계** | **40** | **7** | **6** | **27** |

## 값 섞임 목록

아래 사용처가 Trusted Types 도입 시 `TrustedHTML` 변환(또는 `textContent`·DOM 만들기로 대체)이 필요한 곳입니다. 내용은 줄 번호 기준이며 코드가 바뀌면 도구로 다시 뽑습니다.

- js/app.js:87 `.innerHTML = markup`
- js/app.js:129 `.innerHTML = res.svg`
- js/app.js:468 `.innerHTML = DURS.map((b, i) => '<button class="tbtn dur" data-i`
- js/app.js:476 `.innerHTML = E.iconAcc("sharp")`
- js/app.js:477 `.innerHTML = E.iconAcc("flat")`
- js/app.js:478 `.innerHTML = E.iconAcc("natural")`
- js/app.js:479 `.innerHTML = E.iconRest() + "<span>쉼표</span>"`
- js/app.js:483 `.innerHTML = Object.entries(P.INSTRUMENTS).map(([k, v]) => '<option va`
- js/app.js:616 `.innerHTML = staffOptions`
- js/app.js:622 `.innerHTML = viewOptions`
- js/app.js:751 `.innerHTML = report.map(r => '<li>${r.replace(/&/g, "&amp;").replace(/`
- js/auth.js:683 `.innerHTML = [ ["계정", user && user.email ? user.email : profile.`
- js/auth.js:725 `.innerHTML = '<div class="admin-empty">회원 목록을 불러오지 못했어요. ${htmlEsc(aut`
- js/engrave.js:1914 `.innerHTML = s`
- js/engrave.js:1926 `.innerHTML = '<line class="input-caret" x1="${r2(x)}" y1="${ST.y`
- js/engrave.js:1964 `.innerHTML = s`
- js/export-ui.js:68 `.innerHTML=result.pages.join("")`
- js/export-ui.js:99 `.innerHTML=result.pages.join("")`
- js/input.js:869 `.innerHTML = html`
- js/palette.js:299 `.innerHTML=item.markup`
- js/palette.js:319 `.innerHTML=target.querySelector("svg")?.outerHTML||target.textContent`
- js/panels.js:45 `.innerHTML = html + '<section class="prop-sec"><div class="prop-empty"`
- js/panels.js:87 `.innerHTML = html`
- js/panels.js:232 `.innerHTML = svg`
- js/panels.js:253 `.innerHTML = '<div class="timeline-grid">' + score.measures.map((_, i)`
- js/panels.js:337 `.innerHTML = score.parts.map((part, idx) => { const mx = mixerRe`
- js/panels.js:385 `.innerHTML = Object.keys(C.KEY_NAMES)`

## 다음에 할 일 (🧑)

1. 배포 환경에서 `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` 헤더를 **보고 전용**으로 먼저 달아 보고, 보고서가 가리키는 곳이 위 "값 섞임" 목록과 맞는지 확인합니다. 헤더 변경은 운영 설정이므로 이 저장소 작업에서는 하지 않았습니다.
2. 목록의 사용처를 하나씩 `textContent`·`createElement` 또는 안전한 변환 함수(`js/safe-html.js`)로 모아 정책(`trustedTypes.createPolicy`) 한 곳을 거치게 바꿀지 정합니다.
3. 새 `innerHTML` 사용처를 만들면 이 문서의 표가 어긋나 시험이 실패하므로, 그때 목록을 다시 뽑고 사유를 같이 적습니다.
