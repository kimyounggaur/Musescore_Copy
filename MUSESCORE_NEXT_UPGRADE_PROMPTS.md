# ScoreForge MuseScore 기능 보강 바이브코딩 프롬프트

작성일: 2026-06-22  
대상 앱: ScoreForge, MuseScore 스타일 웹 기반 악보 편집기  
목표: 현재 웹앱을 분석한 뒤, MuseScore의 주요 기능 중 이 앱에 현실적으로 추가할 수 있는 기능을 단계별 개발 프롬프트로 설계한다.

---

## 1. 현재 앱 분석 요약

### 이미 구현된 축

현재 코드와 README를 기준으로 보면 ScoreForge는 단순 악보 입력기를 넘어 MuseScore식 편집 경험의 핵심 일부를 이미 갖추고 있다.

- 단일/다중 악기 파트와 피아노 2단 구조
- 오선 SVG 렌더링, 박자표/조표/음자리표, 마디 기반 편집
- 음표/쉼표 입력, 점음표, 붙임줄, 임시표
- 범위 선택, 복사/붙여넣기, 삭제, Undo/Redo
- 잇단음표, 꾸밈음
- 코드 심벌
- 반복 기호, 볼타
- 여러 절 가사
- 템포/리허설 마크/스태프 텍스트
- 파트 보기, 빈 보표 숨김
- 스윙 재생, 믹서, 사운드폰트 기반 음색
- MusicXML/MIDI/JSON 입출력

### 현재 코드상 확인된 한계

다음 한계는 MuseScore의 실제 편집 흐름과 비교했을 때 다음 업그레이드 후보가 된다.

- `js/core.js`의 마디 모델이 기본적으로 `measure.events` 단일 레인 중심이다. MuseScore식 1-4성부 독립 입력을 위해서는 `measure.voices` 모델이 필요하다.
- `js/io.js`의 MusicXML import 로직은 두 번째 이후 성부를 건너뛰는 경고를 낸다. 다성부 MusicXML을 충실히 불러오지 못한다.
- `js/io.js`에서 무율 타악 음표를 무시하는 경고를 낸다. 드럼/퍼커션 스태프가 아직 없다.
- 기타 탭, 프렛 번호, 현 번호, 프렛보드 다이어그램 데이터 모델이 없다.
- 스태프 텍스트는 있지만 MuseScore의 사운드 플래그처럼 재생 음색/주법을 구간별로 바꾸는 기능은 없다.
- 렌더링은 고정 페이지 상수와 자동 줄바꿈 중심이다. MuseScore식 페이지 크기, 여백, 스태프 간격, 마디 간격, 강제 줄/페이지 나누기 편집은 아직 약하다.
- MIDI export는 있으나 Web MIDI 입력, 실시간 연주 입력, MIDI 키보드 선택 UI는 없다.

---

## 2. 참고한 MuseScore 공식 문서

아래 문서는 기능 후보를 정할 때 기준으로 삼은 공식 MuseScore Handbook 문서다.

- MuseScore Handbook: https://handbook.musescore.org/
- Multiple voices: https://handbook.musescore.org/basics/working-with-multiple-voices
- Parts: https://handbook.musescore.org/basics/parts
- Mixer: https://handbook.musescore.org/sound-and-playback/mixer
- Swing playback: https://handbook.musescore.org/sound-and-playback/swing-playback
- Percussion input: https://handbook.musescore.org/idiomatic-notation/percussion/inputting-percussion-notation
- Percussion kit customization: https://handbook.musescore.org/idiomatic-notation/percussion/percussion-kit-customization
- Chord symbols: https://handbook.musescore.org/text/chord-symbols
- Fretboard diagrams: https://handbook.musescore.org/idiomatic-notation/guitar/fretboard-diagrams
- Creating tablature staff: https://handbook.musescore.org/idiomatic-notation/guitar/creating-a-tablature-staff
- Page layout concepts: https://handbook.musescore.org/formatting/page-layout-concepts
- Sound flags: https://handbook.musescore.org/sound-and-playback/sound-flags

---

## 3. 추천 우선순위

| 우선순위 | 기능 | 추천 이유 | 난이도 |
| --- | --- | --- | --- |
| 1 | 진짜 다성부 입력/렌더링 | 피아노, 합창, 기타, 관현악 편곡의 핵심. MusicXML 호환성도 크게 좋아진다. | 높음 |
| 2 | 타악/드럼 스태프 | 현재 importer가 무율 음표를 버린다. MuseScore와 차이가 큰 영역이다. | 중상 |
| 3 | 기타 탭 스태프 | MuseScore 사용자에게 체감이 큰 기능. 표준보표+탭보표 연결이 가능하다. | 중상 |
| 4 | 프렛보드 다이어그램 | 이미 코드 심벌이 있으므로 추가 가치가 높고 범위가 비교적 명확하다. | 중 |
| 5 | 사운드 플래그/주법 전환 | 이미 믹서와 스태프 텍스트가 있으므로 확장하기 좋다. | 중 |
| 6 | 페이지 레이아웃/스타일 패널 | 악보 출력 품질을 높인다. PDF/인쇄 전 단계로 중요하다. | 중 |
| 7 | Web MIDI 입력 | 작곡 워크플로를 크게 개선하지만 브라우저 지원과 권한 이슈가 있다. | 중 |
| 8 | MusicXML importer 고도화 | 외부 악보 호환성이 크게 좋아진다. 다성부/타악/탭 이후에 하는 것이 안전하다. | 높음 |
| 9 | 고급 기보: 글리산도/트레몰로/아르페지오/오너먼트 | 현재 import 경고를 실제 기능으로 바꿀 수 있다. | 중 |
| 10 | 네비게이터/속성 패널/명령 팔레트 | 편집 생산성 개선. 핵심 기보 모델 이후에 권장한다. | 중 |

---

## 4. 공통 개발 지시 프롬프트

아래 프롬프트는 모든 단계에 공통으로 붙여서 사용한다.

```text
너는 ScoreForge 웹앱을 개발하는 시니어 프론트엔드/음악 기보 엔지니어다.

작업 전 반드시 현재 파일을 먼저 읽고 기존 구조를 유지한다.

주요 파일:
- index.html: 툴바, 패널, 모달, 단축키 도움말, 컨트롤 DOM
- css/style.css: 레이아웃, 패널, 버튼, 악보 SVG 주변 UI
- js/core.js: score 데이터 모델, 입력/삭제/선택/Undo/Redo/편집 명령
- js/engrave.js: SVG 악보 렌더링
- js/playback.js: WebAudio, MIDI, smplr 기반 재생
- js/io.js: JSON, MusicXML, MIDI import/export
- js/app.js: DOM 이벤트, 단축키, 상태 동기화, UI 연결

개발 원칙:
1. 기존 JSON 저장 파일이 깨지면 안 된다. 새 필드는 optional로 추가하고, load 시 migration을 제공한다.
2. 기존 `measure.events` 기반 악보는 계속 열려야 한다.
3. UI는 기존 ScoreForge의 조용한 작업형 인터페이스 톤을 유지한다.
4. 기능은 작은 단위로 끝까지 연결한다: 데이터 모델 -> 입력 UI -> 렌더링 -> 재생 -> 저장/불러오기 -> MusicXML 가능 범위.
5. 한 번에 대규모 리라이트하지 말고 helper를 추가한 뒤 기존 코드를 점진적으로 통과시킨다.
6. 구현 후 최소 검증을 반드시 수행한다.

공통 검증:
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 브라우저에서 index.html 또는 로컬 dev server로 열어 콘솔 에러가 없는지 확인
- 새 기능을 포함한 샘플 악보를 만들고 JSON export/import 왕복 확인
- 가능하면 MusicXML export/import 왕복 확인
```

---

## 5. Prompt M-01: 진짜 다성부 입력/렌더링

MuseScore의 `Voice 1-4`에 해당하는 기능이다. 현재 ScoreForge에서 가장 먼저 보강할 가치가 크다.

```text
[작업명]
ScoreForge에 MuseScore식 다성부(Voice 1-4) 입력, 렌더링, 재생, MusicXML import/export를 구현한다.

[현재 코드 근거]
- `js/core.js`는 각 마디를 `measure.events` 단일 배열 중심으로 처리한다.
- `js/io.js`는 MusicXML import 시 두 번째 이후 voice를 건너뛰는 경고를 낸다.
- 피아노 2단/다중 악기는 있지만 같은 스태프 안의 독립 성부는 없다.

[목표]
1. 각 스태프의 각 마디가 최대 4개 voice를 가질 수 있게 한다.
2. 기존 `measure.events` 악보는 자동으로 voice 1로 migration한다.
3. UI에서 현재 voice를 선택하고, 입력/삭제/복사/붙여넣기가 현재 voice 기준으로 작동하게 한다.
4. 렌더링에서 같은 박 위치에 여러 voice가 있을 때 음표 머리, 기둥 방향, 쉼표 위치가 충돌하지 않게 한다.
5. 재생은 모든 voice를 동시에 재생한다.
6. MusicXML import/export에서 `<voice>`와 `<backup>` 구조를 지원한다.

[데이터 모델]
1. `measure.voices`를 추가한다.
   - 형태: `measure.voices = [[], [], [], []]`
   - voice index 0은 MuseScore Voice 1, index 1은 Voice 2다.
2. 기존 `measure.events`는 호환용으로 유지한다.
   - load/migration 시 `measure.events`가 있고 `measure.voices`가 없으면 `measure.voices[0] = measure.events`.
   - 저장 시 당분간 `measure.events = measure.voices[0]`도 유지한다.
3. event에는 optional `voice` 필드를 추가한다.
   - voice 1은 `voice: 1`
   - 기존 이벤트에 voice가 없으면 voice 1로 간주한다.

[core.js 구현 순서]
1. `ensureMeasureVoices(measure)` helper를 만든다.
2. `getVoiceEvents(measure, voiceIndex)` helper를 만든다.
3. 기존 `measure.events`를 직접 순회하는 주요 함수에 helper를 적용한다.
   - 입력
   - 삭제
   - 선택
   - 범위 선택
   - 복사/붙여넣기
   - 마디 길이 계산
   - Undo/Redo snapshot
4. `state.currentVoice`를 추가한다.
   - 기본값은 1
   - 값 범위는 1-4
5. 기존 입력 함수가 현재 voice 배열에 이벤트를 넣도록 바꾼다.
6. voice별 박자 합계가 마디 박자를 초과하지 않도록 validation한다.
7. 범위 선택 복사 데이터에 `voice` 정보를 포함한다.
8. 붙여넣기는 기본적으로 원본 voice를 유지하되, 옵션 없이 현재 voice에 붙여넣는 command도 준비한다.

[app.js / index.html 구현 순서]
1. 툴바에 Voice 1, Voice 2, Voice 3, Voice 4 segmented control을 추가한다.
2. 단축키를 추가한다.
   - `Alt+1`: Voice 1
   - `Alt+2`: Voice 2
   - `Alt+3`: Voice 3
   - `Alt+4`: Voice 4
3. 현재 voice 버튼에 active 상태를 표시한다.
4. 선택된 음표의 voice가 현재 voice와 다르면 상태바에 작게 표시한다.

[engrave.js 구현 순서]
1. 마디 렌더링 전에 voice별 이벤트를 `segmentMap`으로 합친다.
   - key는 tick 또는 beat position
   - value는 voice별 이벤트 목록
2. voice 1과 3은 기본 stem up, voice 2와 4는 stem down으로 렌더링한다.
3. 같은 pitch의 notehead가 겹치면 x offset을 준다.
4. voice별 쉼표 y 위치를 다르게 둔다.
   - Voice 1/3: staff 중앙보다 위
   - Voice 2/4: staff 중앙보다 아래
5. 선택 highlight는 voice별 이벤트 id를 그대로 따라가게 한다.
6. 다성부가 없는 기존 악보 렌더링 결과는 최대한 유지한다.

[playback.js 구현 순서]
1. 마디 재생 이벤트 수집 시 모든 voice를 flatten한다.
2. 같은 beat에 여러 voice 음이 있으면 동시에 schedule한다.
3. duration, tie, tuplet, swing 계산이 voice별로 깨지지 않게 한다.
4. mixer의 staff/part 설정은 voice와 무관하게 유지한다.

[io.js 구현 순서]
1. MusicXML import에서 `<voice>` 값을 읽어 voice index로 매핑한다.
2. `<backup>`과 `<forward>`를 이용해 voice별 cursor를 관리한다.
3. export 시 voice별로 note를 출력하고, voice 전환이 필요하면 `<backup>`을 넣는다.
4. 기존 단일 voice MusicXML은 이전과 같은 결과가 나와야 한다.
5. import report에서 "두 번째 이후 성부는 건너뜀" 경고를 제거하고, 실제 import된 voice 수를 보여준다.

[수용 기준]
- 한 스태프의 같은 마디에 Voice 1 멜로디와 Voice 2 반주를 독립 입력할 수 있다.
- Voice 1과 Voice 2의 기둥 방향이 반대로 보인다.
- Voice 2 쉼표가 Voice 1 음표와 겹치지 않는다.
- 선택/삭제/복사/붙여넣기가 voice 정보를 잃지 않는다.
- 다성부 악보 JSON export/import 후 동일하게 보인다.
- MusicXML 다성부 파일을 import하면 두 번째 성부가 사라지지 않는다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 브라우저에서 다음 샘플을 직접 만든다.
  1. 피아노 오른손 스태프 Voice 1에 4분음표 4개 입력
  2. 같은 마디 Voice 2에 2분음표 2개 입력
  3. 저장 후 다시 열어 voice가 유지되는지 확인
  4. 재생 시 두 성부가 동시에 들리는지 확인
```

---

## 6. Prompt M-02: 타악/드럼 스태프

MuseScore의 percussion staff와 drum input panel에 해당한다.

```text
[작업명]
ScoreForge에 무율 타악/드럼 스태프, 드럼 패드 입력, MusicXML unpitched note import/export를 구현한다.

[현재 코드 근거]
- `js/io.js`는 MusicXML import에서 unpitched percussion note를 무시한다.
- 현재 음표 모델은 pitch/midi 중심이다.
- percussion clef, drum map, notehead type이 없다.

[목표]
1. 드럼 키트 파트를 추가할 수 있다.
2. 타악 스태프는 percussion clef로 렌더링한다.
3. 킥, 스네어, 하이햇, 탐, 크래시 등 기본 드럼을 입력할 수 있다.
4. 드럼 음표는 pitch 대신 drum id와 staff line 위치를 가진다.
5. 재생 시 GM Drum channel 또는 smplr percussion sample을 사용한다.
6. MusicXML `<unpitched>`, `<instrument>`, `<notehead>`를 import/export한다.

[데이터 모델]
1. part 또는 staff에 `instrumentType: "percussion"`을 추가한다.
2. event에 다음 필드를 허용한다.
   - `kind: "note"`
   - `drumId: "kick" | "snare" | "closed-hihat" | ...`
   - `displayStep`, `displayOctave` 또는 `staffLine`
   - `notehead: "normal" | "x" | "circle-x" | "diamond"`
3. `DRUM_MAP` 상수를 추가한다.
   - kick: midi 36, staffLine 낮은 F 근처, normal
   - snare: midi 38, staffLine C 근처, normal
   - closed-hihat: midi 42, staffLine 위쪽, x
   - open-hihat: midi 46, staffLine 위쪽, circle-x
   - crash: midi 49, staffLine 최상단, x
   - ride: midi 51, staffLine 상단, x
   - low-tom/mid-tom/high-tom: GM MIDI에 맞춤

[core.js 구현 순서]
1. `PART_LIBRARY` 또는 악기 생성 로직에 `drumkit`을 추가한다.
2. `addDrumNote(drumId, duration)` helper를 만든다.
3. 일반 pitch note와 drum note가 같은 selection/edit pipeline을 쓰도록 event shape만 확장한다.
4. transpose 명령은 percussion staff에서는 비활성화하거나 drum map 이동으로 별도 처리한다.

[index.html / app.js 구현 순서]
1. 악기 추가 메뉴에 "Drum Kit"을 추가한다.
2. percussion staff 선택 시 하단 또는 사이드 패널에 드럼 패드를 보여준다.
3. 패드 구성:
   - Kick
   - Snare
   - Closed HH
   - Open HH
   - Crash
   - Ride
   - Low Tom
   - Mid Tom
   - High Tom
4. 키보드 단축키를 추가한다.
   - `K`: kick
   - `S`: snare
   - `H`: closed hihat
   - `O`: open hihat
   - `C`: crash
5. 현재 staff가 percussion이 아니면 drum pad를 숨기거나 disabled 처리한다.

[engrave.js 구현 순서]
1. percussion clef glyph 또는 간단한 percussion clef 표시를 렌더링한다.
2. `drumId`가 있는 note는 pitch 계산 대신 `DRUM_MAP[drumId].staffLine`으로 y를 계산한다.
3. `notehead: "x"`와 `"circle-x"`를 SVG로 렌더링한다.
4. 하이햇/심벌류는 x notehead를 사용한다.
5. 일반 음표와 같은 duration beam/stem 로직을 재사용한다.

[playback.js 구현 순서]
1. drum note는 GM percussion MIDI number로 재생한다.
2. smplr 또는 SoundFont가 있으면 percussion preset을 사용한다.
3. mixer에서 drum part volume/pan/mute/solo가 작동해야 한다.

[io.js 구현 순서]
1. MusicXML import에서 `<unpitched>`를 읽는다.
2. `<instrument id>` 또는 display-step/display-octave를 `DRUM_MAP`으로 매핑한다.
3. 매핑 실패 시 가장 가까운 staffLine의 unknown percussion note로 보존한다.
4. export 시 drum note를 `<unpitched>`, `<instrument>`, `<notehead>`로 출력한다.
5. 기존 "무율(타악) 음표는 무시" 경고를 제거하고, 매핑 실패 경고만 남긴다.

[수용 기준]
- Drum Kit 파트를 추가하면 percussion clef가 보인다.
- Kick/Snare/Hihat을 입력하면 서로 다른 staff line과 notehead로 보인다.
- 재생 시 각각 다른 드럼 소리가 난다.
- MusicXML unpitched note를 import해도 음표가 사라지지 않는다.
- JSON export/import 후 drumId와 notehead가 유지된다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 브라우저에서 1마디 드럼 패턴을 만든다: Kick 1,3 / Snare 2,4 / Hihat 8분음표.
- 저장 후 다시 열고 재생한다.
```

---

## 7. Prompt M-03: 기타 탭 스태프

MuseScore의 guitar tablature staff에 해당한다.

```text
[작업명]
ScoreForge에 기타 tablature staff와 표준보표-탭 연결 입력을 구현한다.

[현재 코드 근거]
- 현재 staff는 오선 렌더링 중심이며 tab staff type이 없다.
- event에는 string/fret 정보가 없다.
- chord symbol은 있으나 기타 연주 정보는 없다.

[목표]
1. Guitar 악기에 표준보표와 tablature staff를 선택적으로 추가할 수 있다.
2. tab staff는 6개 현 라인과 fret 숫자로 렌더링한다.
3. 일반 음표 입력 시 가능한 string/fret을 자동 추정한다.
4. 사용자가 string/fret을 직접 수정할 수 있다.
5. MusicXML technical string/fret import/export를 지원한다.

[데이터 모델]
1. staff에 `staffType: "standard" | "tab"`을 추가한다.
2. guitar part에는 tuning을 추가한다.
   - 기본 standard tuning: E2 A2 D3 G3 B3 E4
   - 데이터: `tuning: [40, 45, 50, 55, 59, 64]`
3. note event에 optional `tab` 필드를 추가한다.
   - `tab: { string: 1, fret: 0 }`
   - string 1은 가장 높은 E현으로 표시한다.
4. linked staff 구조를 위해 staff에 `linkedStaffId`를 추가한다.

[core.js 구현 순서]
1. `createGuitarPart({ withTab: true })` 생성 로직을 만든다.
2. `midiToStringFret(midi, tuning, preferredPosition)` helper를 만든다.
3. 일반 음표 입력 시 guitar/tab linked staff가 있으면 `tab` 값을 자동 생성한다.
4. tab staff에서 fret 입력 시 linked standard staff의 pitch를 계산한다.
5. 같은 string에서 동시에 같은 시간에 두 fret이 충돌하면 validation warning을 낸다.

[index.html / app.js 구현 순서]
1. 악기 추가 메뉴에 "Guitar + TAB" 옵션을 추가한다.
2. note 속성 패널에 String, Fret 입력 컨트롤을 추가한다.
3. tab staff 선택 시 숫자키 입력으로 fret을 빠르게 입력할 수 있게 한다.
4. `[`와 `]`로 preferred position을 낮추거나 높이는 UX를 추가한다.

[engrave.js 구현 순서]
1. `staffType === "tab"`이면 오선 대신 6개 수평선을 렌더링한다.
2. 음표 머리 대신 fret 숫자를 렌더링한다.
3. duration stem/beam은 tab 숫자 위 또는 아래에 간단히 표시한다.
4. open string은 `0`, muted note는 `x` 표시를 허용한다.
5. linked standard staff와 tab staff의 마디 폭이 같도록 layout을 공유한다.

[playback.js 구현 순서]
1. tab note는 계산된 midi pitch로 재생한다.
2. slide, hammer-on, pull-off는 이번 단계에서 데이터만 보존하고 재생은 후속 단계로 미룬다.

[io.js 구현 순서]
1. MusicXML import에서 `<technical><string>`과 `<fret>`을 읽어 event.tab에 저장한다.
2. export 시 tab 정보가 있으면 `<notations><technical>`에 string/fret을 출력한다.
3. tab staff 자체 export는 MusicXML의 staff-details/tuning 정보를 가능 범위에서 출력한다.

[수용 기준]
- Guitar + TAB 파트를 추가하면 표준보표와 6현 tab staff가 함께 보인다.
- 표준보표에 E4를 입력하면 tab에 적절한 string/fret 숫자가 표시된다.
- tab에서 3번 fret을 입력하면 표준보표 pitch가 연결된다.
- JSON 왕복 후 tab 정보가 유지된다.
- MusicXML import/export에서 string/fret이 사라지지 않는다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 브라우저에서 E minor pentatonic 1마디를 표준보표+TAB으로 입력하고 저장/로드한다.
```

---

## 8. Prompt M-04: 프렛보드 다이어그램

MuseScore의 chord symbol 기반 fretboard diagram 기능에 해당한다.

```text
[작업명]
ScoreForge의 코드 심벌 위에 기타 프렛보드 다이어그램을 표시하고 편집할 수 있게 한다.

[현재 코드 근거]
- `chordSymbol` 필드는 이미 존재한다.
- 코드 심벌 렌더링은 있으나 fretboard diagram 데이터/렌더링은 없다.

[목표]
1. 코드 심벌을 입력하면 일반적인 기타 코드의 프렛보드 다이어그램을 자동 제안한다.
2. 사용자가 string별 fret/mute/open을 수정할 수 있다.
3. 다이어그램을 악보 위에 표시하거나 숨길 수 있다.
4. MusicXML `<frame>` import/export를 지원한다.

[데이터 모델]
1. chord symbol event에 optional `fretboard` 필드를 추가한다.
   - `fretboard: { strings: 6, frets: 4, firstFret: 1, positions: ["x", 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] }`
2. score 설정에 `showFretboards: true | false`를 추가한다.
3. common chord library를 별도 상수로 둔다.
   - C, Cm, C7, D, Dm, E, Em, F, G, G7, A, Am, B7 등 최소 24개

[core.js 구현 순서]
1. `parseChordSymbol()` 결과를 활용해 root/quality를 얻는다.
2. `getDefaultFretboard(chordSymbol)` helper를 만든다.
3. chord symbol 생성 시 default fretboard를 붙인다.
4. 사용자가 코드 이름을 바꾸면 fretboard를 새로 제안하되, 사용자가 수동 편집한 경우 덮어쓰지 않는다.

[index.html / app.js 구현 순서]
1. 코드 심벌 속성 패널에 "Fretboard" 토글을 추가한다.
2. string별 fret 입력 UI를 만든다.
   - x, 0, 1-12 입력 허용
3. "Use default shape" 버튼을 추가한다.
4. 전체 보기 옵션으로 "Show fretboards" 체크박스를 추가한다.

[engrave.js 구현 순서]
1. chord symbol 위 또는 아래에 작은 fretboard SVG group을 렌더링한다.
2. 6개 세로줄, fret 가로줄, nut, position dot을 그린다.
3. muted string은 상단에 `x`, open string은 `o`를 표시한다.
4. 다이어그램이 여러 개 붙을 때 코드 심벌/가사/리허설 마크와 겹치지 않게 y slot을 분리한다.

[io.js 구현 순서]
1. JSON은 fretboard 필드를 그대로 보존한다.
2. MusicXML import에서 `<frame>`을 읽어 fretboard로 변환한다.
3. MusicXML export에서 fretboard가 있으면 `<frame>`을 출력한다.

[수용 기준]
- C, G7, Am 같은 코드 심벌 입력 시 다이어그램이 자동 표시된다.
- 사용자가 string별 fret을 수정하면 저장 후 유지된다.
- Show fretboards를 끄면 코드 심벌만 보인다.
- MusicXML export에 frame 정보가 포함된다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- C - G - Am - F 진행을 만들고 fretboard 표시/숨김/저장/로드를 확인한다.
```

---

## 9. Prompt M-05: 사운드 플래그와 주법 전환

MuseScore의 sound flags와 staff text 기반 재생 변화에 해당한다.

```text
[작업명]
ScoreForge에 스태프 텍스트 기반 사운드 플래그를 추가해 pizzicato, arco, mute, tremolo 같은 재생 주법을 구간별로 바꾼다.

[현재 코드 근거]
- ScoreForge에는 staff text와 mixer/playbackSettings가 있다.
- 하지만 staff text가 실제 playback articulation/instrument switch로 작동하지는 않는다.

[목표]
1. staff text 또는 별도 sound flag 이벤트가 playback에 영향을 준다.
2. 문자열 계열에서 pizz./arco, brass에서 mute/open, guitar에서 palm mute 같은 기본 플래그를 지원한다.
3. 렌더링은 작은 텍스트로 유지하되, 내부적으로 `soundFlag` 데이터를 갖는다.
4. MusicXML의 direction/sound 정보를 가능 범위에서 import/export한다.

[데이터 모델]
1. event에 다음 필드를 추가한다.
   - `kind: "staffText"`
   - `text: "pizz."`
   - `soundFlag: "pizzicato"`
2. 또는 별도 event:
   - `kind: "soundFlag"`
   - `label: "pizz."`
   - `flag: "pizzicato"`
3. part playback state에 현재 flag를 누적 적용한다.

[core.js 구현 순서]
1. `SOUND_FLAGS` 상수를 만든다.
   - pizzicato: labels `pizz.`, `pizzicato`
   - arco: labels `arco`
   - mute: labels `con sord.`, `mute`
   - open: labels `senza sord.`, `open`
   - tremolo: labels `trem.`
   - palmMute: labels `P.M.`, `palm mute`
2. staff text 생성/수정 시 label을 분석해 `soundFlag`를 자동 할당한다.
3. 사용자가 속성 패널에서 soundFlag를 직접 선택할 수 있게 한다.

[app.js / index.html 구현 순서]
1. Staff Text 입력 UI에 Sound Flag select를 추가한다.
2. 선택지는 Auto, None, Pizzicato, Arco, Mute, Open, Tremolo, Palm Mute.
3. 현재 선택된 staff text가 soundFlag이면 작은 badge를 표시한다.

[playback.js 구현 순서]
1. 재생 이벤트를 시간순으로 훑으면서 part/staff별 currentSoundFlag를 갱신한다.
2. note schedule 시 currentSoundFlag를 articulation 옵션으로 전달한다.
3. smplr preset이 있으면 가능한 경우 다른 sample/instrument로 매핑한다.
4. sample이 없으면 fallback으로 envelope/filter/velocity를 조정한다.
   - pizzicato: 짧은 decay
   - mute: lowpass와 낮은 sustain
   - tremolo: 빠른 반복 또는 gain tremolo
   - palm mute: 짧은 decay와 낮은 sustain

[engrave.js 구현 순서]
1. staff text 렌더링은 기존 스타일을 유지한다.
2. soundFlag가 있을 때 선택 상태에서만 작은 indicator를 표시한다.

[io.js 구현 순서]
1. JSON 저장은 soundFlag 필드를 보존한다.
2. MusicXML export 시 direction words와 가능하면 `<sound>` 또는 direction type을 출력한다.
3. MusicXML import 시 words 텍스트를 SOUND_FLAGS와 매칭한다.

[수용 기준]
- Violin staff에 `pizz.`를 넣은 뒤 재생하면 짧은 음으로 들린다.
- 뒤에 `arco`를 넣으면 일반 sustain으로 돌아온다.
- Staff text를 수정해도 soundFlag가 업데이트된다.
- 저장/로드 후 플래그가 유지된다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 4마디 예제: 1-2마디 pizz., 3-4마디 arco로 재생 차이를 확인한다.
```

---

## 10. Prompt M-06: 페이지 레이아웃과 스타일 패널

MuseScore의 page layout concepts에 해당하는 출력 품질 기능이다.

```text
[작업명]
ScoreForge에 페이지 크기, 방향, 여백, 스태프 간격, 마디 폭, 강제 줄바꿈/페이지 나누기 설정을 추가한다.

[현재 코드 근거]
- `js/engrave.js`는 고정 page width/height, margin, system layout 성격이 강하다.
- 사용자가 페이지 스타일을 조정하는 UI가 없다.

[목표]
1. score에 page/style 설정을 저장한다.
2. A4/Letter, portrait/landscape, margins, staff size, system spacing을 바꿀 수 있다.
3. 특정 마디 뒤에 line break 또는 page break를 넣을 수 있다.
4. PDF/인쇄 출력에 가까운 페이지 미리보기를 제공한다.

[데이터 모델]
1. `score.layout`을 추가한다.
   - `pageSize: "A4" | "Letter" | "Custom"`
   - `orientation: "portrait" | "landscape"`
   - `width`, `height`
   - `marginTop`, `marginRight`, `marginBottom`, `marginLeft`
   - `staffScale`
   - `systemGap`
   - `staffGap`
   - `measuresPerSystem`
2. measure meta에 break 정보를 추가한다.
   - `lineBreakAfter: true`
   - `pageBreakAfter: true`

[core.js 구현 순서]
1. default layout을 score 생성 시 넣는다.
2. 기존 score load 시 layout이 없으면 default를 채운다.
3. `setScoreLayout(patch)` command를 만들어 Undo/Redo에 포함한다.
4. measure break toggle command를 만든다.

[index.html / app.js 구현 순서]
1. 오른쪽 또는 상단에 Layout 패널 버튼을 추가한다.
2. 컨트롤:
   - Page Size: A4, Letter
   - Orientation: Portrait, Landscape
   - Staff Size slider
   - System Gap slider
   - Staff Gap slider
   - Measures per system number input
   - Margins 4개 number input
3. 선택 마디 컨텍스트에 "Line break after", "Page break after" 버튼을 추가한다.
4. 변경 즉시 re-render한다.

[engrave.js 구현 순서]
1. 고정 page 상수 대신 `score.layout`에서 값을 읽는다.
2. `measuresPerSystem`이 있으면 해당 값에 맞춰 system break를 계산한다.
3. measure meta의 line/page break를 우선 적용한다.
4. page break 이후에는 새 page group을 시작한다.
5. CSS print 영역과 SVG viewBox가 page 설정을 반영하게 한다.

[css/style.css 구현 순서]
1. 페이지 미리보기 배경과 page shadow를 기존 UI 톤에 맞게 정리한다.
2. 인쇄 시 toolbar/panel은 숨기고 score page만 출력한다.

[io.js 구현 순서]
1. JSON 저장은 layout과 break meta를 보존한다.
2. MusicXML export에서 가능하면 print/layout 관련 정보를 출력한다.
3. MusicXML import에서 page-layout/system-layout을 읽어 score.layout에 반영한다.

[수용 기준]
- A4 portrait와 Letter landscape를 전환하면 악보 페이지 비율이 바뀐다.
- staff size를 줄이면 한 페이지에 더 많은 음악이 들어간다.
- 특정 마디 뒤 line break가 저장/로드 후 유지된다.
- 인쇄 미리보기에서 toolbar가 보이지 않는다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 16마디 악보에서 4마디마다 line break를 넣고 저장/로드한다.
```

---

## 11. Prompt M-07: Web MIDI 입력

MuseScore의 MIDI keyboard input 경험을 브라우저 환경에서 가능한 범위로 구현한다.

```text
[작업명]
ScoreForge에 Web MIDI API 기반 MIDI 키보드 입력을 추가한다.

[현재 코드 근거]
- 현재 MIDI export는 있으나 MIDI input 장치 선택과 실시간 note input은 없다.
- 브라우저 권한과 HTTPS 조건이 필요하므로 graceful fallback이 중요하다.

[목표]
1. Web MIDI 지원 브라우저에서 MIDI input device를 선택할 수 있다.
2. MIDI note on/off를 받아 현재 커서 위치에 음표를 입력한다.
3. 짧은 chord capture window 안에 들어온 note는 화음으로 입력한다.
4. 현재 duration, voice, staff, accidental 정책을 기존 입력 로직과 공유한다.

[데이터 모델]
별도 저장 모델은 필요 없다. MIDI input은 입력 장치 이벤트를 기존 note event로 변환한다.

[app.js 구현 순서]
1. `navigator.requestMIDIAccess` 지원 여부를 확인한다.
2. MIDI 패널 또는 toolbar select를 추가한다.
   - Device select
   - MIDI input on/off toggle
   - Chord capture ms input: 기본 80ms
3. note on 이벤트를 buffer에 넣고 chord capture window가 끝나면 현재 duration으로 입력한다.
4. velocity는 event.velocity 또는 playback accent로 optional 저장한다.
5. note off는 step input에서는 무시하고, 후속 real-time recording을 위해 구조만 분리한다.

[core.js 구현 순서]
1. `inputMidiPitches(pitches, duration, options)` helper를 만든다.
2. pitches가 여러 개면 chord event로 넣는다.
3. 현재 voice/staff/measure/cursor 규칙을 기존 키보드 입력과 동일하게 사용한다.

[index.html / css 구현 순서]
1. MIDI device select와 activity indicator를 만든다.
2. 지원하지 않는 브라우저에서는 "Web MIDI unavailable" 상태를 조용히 표시한다.
3. 권한 거부 시 앱 전체가 깨지지 않게 한다.

[수용 기준]
- MIDI 키보드를 누르면 현재 커서 위치에 음표가 입력된다.
- 동시에 누른 3음은 화음으로 입력된다.
- 장치 연결이 없거나 권한이 없으면 안내만 보이고 기존 기능은 정상 작동한다.
- 입력된 음표는 Undo/Redo로 되돌릴 수 있다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- Web MIDI 지원 브라우저에서 실제 장치 또는 가상 MIDI 장치로 note input을 확인한다.
```

---

## 12. Prompt M-08: MusicXML importer 고도화

여러 파트, 여러 스태프, 다성부, 타악, 탭을 모두 살리는 장기 호환성 작업이다.

```text
[작업명]
ScoreForge MusicXML importer를 MuseScore 악보 호환에 가깝게 고도화한다.

[전제]
이 작업은 M-01 다성부, M-02 타악, M-03 탭 구현 이후 진행하는 것을 권장한다.

[현재 코드 근거]
- import 로직은 일부 voice, unpitched, ornament, glissando 등을 경고로 넘긴다.
- 다중 파트/스태프 정보의 보존 수준을 높일 여지가 있다.

[목표]
1. MusicXML의 part-list를 읽어 ScoreForge parts/staves로 최대한 보존한다.
2. 각 part의 여러 staff를 import한다.
3. voice, backup/forward, tuplets, grace, lyrics, harmony, repeat, ending을 유지한다.
4. unpitched percussion과 guitar technical 정보를 보존한다.
5. import report를 사용자에게 더 명확하게 보여준다.

[io.js 구현 순서]
1. MusicXML parse를 3단계로 분리한다.
   - pass 1: part-list/instrument/staff metadata
   - pass 2: measure structure, attributes, divisions, time/key/clef
   - pass 3: notes/directions/harmony/barline/notations
2. `ImportContext` 객체를 만든다.
   - divisions
   - currentPart
   - currentStaff
   - voiceCursors
   - warnings
   - id maps
3. `<backup>`/`<forward>`를 voice cursor에 정확히 반영한다.
4. `<staff>` 값으로 staff를 분리한다.
5. `<harmony>`는 chordSymbol로 import한다.
6. `<direction>`은 tempo/rehearsal/staffText/soundFlag로 분류한다.
7. `<barline>`은 repeat/ending으로 import한다.
8. 지원하지 않는 notations는 event.rawNotations에 보존하고 경고를 낸다.

[app.js 구현 순서]
1. import 완료 후 report modal을 보여준다.
2. report에는 다음을 표시한다.
   - import한 parts 수
   - import한 staves 수
   - import한 voices 수
   - 보존한 기능
   - 손실되거나 단순화한 기능
3. report가 너무 길면 접기/펼치기 처리한다.

[수용 기준]
- MuseScore에서 export한 피아노 2단+다성부 MusicXML을 열면 양손과 성부가 유지된다.
- 드럼 MusicXML을 열면 unpitched note가 보존된다.
- 기타 TAB MusicXML을 열면 string/fret 정보가 유지된다.
- import report가 실제 손실 정보를 숨기지 않는다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 최소 3개 fixture로 수동 테스트한다.
  1. piano voices
  2. drum kit
  3. guitar tab with chord symbols
```

---

## 13. Prompt M-09: 고급 기보 기호

MuseScore에서 자주 쓰는 glissando, slide, tremolo, arpeggio, ornament를 ScoreForge에 추가한다.

```text
[작업명]
ScoreForge에 글리산도, 슬라이드, 트레몰로, 아르페지오, 오너먼트 기보를 추가한다.

[현재 코드 근거]
- `js/io.js`는 일부 고급 notation을 import warning으로 처리한다.
- 현재 렌더링/재생 모델은 기본 음표 중심이다.

[목표]
1. note event에 고급 notation 필드를 추가한다.
2. SVG에서 기호를 간단명료하게 렌더링한다.
3. MusicXML import/export에서 해당 notation을 보존한다.
4. playback은 가능한 것부터 간단히 반영하고, 어려운 것은 데이터 보존을 우선한다.

[데이터 모델]
note event에 optional 필드를 추가한다.
- `glissando: { type: "start" | "stop", lineType: "solid" | "wavy" }`
- `slide: { type: "start" | "stop" }`
- `tremolo: { strokes: 1 | 2 | 3, type: "single" | "start" | "stop" }`
- `arpeggiate: true`
- `ornaments: ["trill", "mordent", "turn"]`

[core.js 구현 순서]
1. 선택 음표에 notation을 toggle하는 command를 추가한다.
2. range selection에서 start/stop notation을 적용하는 command를 추가한다.
3. Undo/Redo snapshot에 필드가 보존되는지 확인한다.

[index.html / app.js 구현 순서]
1. Notation 패널을 추가한다.
2. 버튼:
   - Gliss.
   - Slide
   - Tremolo 1/2/3
   - Arpeggio
   - Trill
   - Mordent
   - Turn
3. 선택한 음표에만 적용하고, 적용 상태를 버튼 active로 표시한다.

[engrave.js 구현 순서]
1. glissando/slide는 두 음표 사이 사선으로 렌더링한다.
2. arpeggio는 chord 왼쪽에 세로 물결선을 렌더링한다.
3. tremolo는 stem 또는 notehead 근처에 slash를 렌더링한다.
4. ornament는 음표 위에 작은 텍스트/glyph로 렌더링한다.
5. 기호가 가사/코드 심벌과 겹치지 않게 y slot을 분리한다.

[playback.js 구현 순서]
1. glissando는 pitch bend가 어렵다면 빠른 chromatic run fallback을 제공한다.
2. tremolo는 duration 안에서 반복 note로 재생한다.
3. arpeggio는 chord note start time을 아주 조금씩 stagger한다.
4. ornament는 이번 단계에서 간단한 grace-like playback으로 처리한다.

[io.js 구현 순서]
1. MusicXML import에서 notations 내부 glissando/slide/tremolo/arpeggiate/ornaments를 읽는다.
2. export 시 대응 태그를 출력한다.
3. 기존 경고 문구에서 해당 항목은 제거한다.

[수용 기준]
- 선택 음표에 glissando를 걸면 다음 음표까지 선이 보인다.
- chord에 arpeggio를 걸면 왼쪽 물결선이 보이고 재생 시 분산화음처럼 들린다.
- tremolo가 렌더링되고 재생에서 반복된다.
- MusicXML export/import 후 notation이 유지된다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 각 notation을 한 마디씩 포함한 테스트 악보를 만들어 저장/로드한다.
```

---

## 14. Prompt M-10: 네비게이터, 속성 패널, 명령 팔레트

MuseScore의 생산성 UI 일부를 웹앱에 맞게 가볍게 추가한다.

```text
[작업명]
ScoreForge에 전체 악보 네비게이터, 선택 속성 패널, 명령 팔레트를 추가한다.

[목표]
1. 긴 악보에서 현재 위치를 빠르게 이동할 수 있다.
2. 선택한 음표/마디/텍스트의 주요 속성을 한 곳에서 수정할 수 있다.
3. 키보드로 명령을 검색해 실행할 수 있다.

[Navigator 구현]
1. 하단 또는 오른쪽에 miniature system overview를 추가한다.
2. 마디 번호와 현재 viewport 위치를 표시한다.
3. 클릭하면 해당 마디로 스크롤한다.
4. score가 길 때만 표시하거나 접을 수 있게 한다.

[Properties 구현]
1. 선택 타입별 속성 UI를 만든다.
   - note: pitch, duration, accidental, tie, voice, articulation
   - rest: duration, voice
   - chord symbol: text, fretboard toggle
   - staff text: text, soundFlag
   - measure: repeat, ending, line/page break
2. 속성 변경은 기존 command/Undo pipeline을 사용한다.
3. 직접 DOM 값을 바꾸는 식으로 우회하지 않는다.

[Command Palette 구현]
1. `Ctrl+K`로 command palette를 연다.
2. 명령 registry를 만든다.
   - Add measure
   - Delete selection
   - Toggle tie
   - Add chord symbol
   - Add rehearsal mark
   - Toggle repeat
   - Export MusicXML
   - Toggle part view
3. 검색어로 fuzzy filter한다.
4. Enter로 실행, Esc로 닫는다.

[수용 기준]
- 64마디 악보에서 navigator 클릭으로 이동할 수 있다.
- 선택한 음표의 voice/duration을 properties에서 바꾸면 Undo 가능하다.
- Ctrl+K에서 "rehearsal"을 검색해 리허설 마크 명령을 실행할 수 있다.

[검증]
- `node --check js/core.js js/engrave.js js/playback.js js/io.js js/app.js`
- `git diff --check`
- 키보드만으로 command palette 열기/검색/실행/닫기를 확인한다.
```

---

## 15. 이번 라운드에서 보류할 기능

아래 기능은 MuseScore에는 중요하지만, 현재 ScoreForge 웹앱의 규모와 구조에서는 후순위로 두는 것이 좋다.

- 완전한 MuseSounds 호환: 라이선스, 용량, 샘플 배포, 브라우저 메모리 이슈가 크다.
- VST/VSTi 플러그인 호스트: 브라우저 기반 앱에서는 실용성이 낮고 보안/호환성 문제가 크다.
- MuseScore 플러그인 API 호환: 앱 구조를 크게 바꿔야 한다.
- 클라우드 협업/계정/동기화: 음악 기보 기능보다 백엔드 설계 비중이 커진다.
- 완전한 데스크톱 MuseScore parity: 단기 웹앱 업그레이드 목표로는 범위가 너무 크다.

---

## 16. 권장 실행 계획

가장 안전한 순서는 아래와 같다.

1. M-01 다성부 입력/렌더링
2. M-08 MusicXML importer 고도화 중 voice/staff 부분만 1차 반영
3. M-02 타악/드럼 스태프
4. M-03 기타 탭 스태프
5. M-04 프렛보드 다이어그램
6. M-05 사운드 플래그
7. M-06 페이지 레이아웃/스타일 패널
8. M-07 Web MIDI 입력
9. M-09 고급 기보 기호
10. M-10 네비게이터/속성 패널/명령 팔레트

첫 번째 개발 프롬프트로는 반드시 M-01을 추천한다. 이유는 다성부 모델이 뒤의 타악, 탭, MusicXML 호환성, 속성 패널에 모두 영향을 주는 기반 구조이기 때문이다.
