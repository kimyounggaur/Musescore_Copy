/* ScoreForge ko/en UI strings. No score data is read or changed by this module. */
"use strict";
(function (host) {
  const SF = host.SF || (host.SF = {});
  const STRINGS = { ko: Object.create(null), en: Object.create(null) };
  // Hand-written semantic entries. The third column is always an actual translation.
  function group(prefix, rows) {
    for (const line of rows.trim().split("\n")) {
      const [name, ko, en] = line.trim().split(" | ");
      if (!name || ko === undefined || en === undefined) throw new Error("Invalid i18n entry: " + line);
      const key = prefix + "." + name;
      if (Object.hasOwn(STRINGS.ko, key)) throw new Error("Duplicate i18n key: " + key);
      STRINGS.ko[key] = ko; STRINGS.en[key] = en;
    }
  }
  group("app", `
    title | ScoreForge — 쉬운 웹 악보 에디터 | ScoreForge — Easy web notation editor
    tagline | 웹 악보 에디터 | Web notation editor
    description | 브라우저에서 바로 쓰는 악보 만들기·재생 도구. 음표 입력, 재생, 가사, MusicXML/MIDI 내보내기까지. | Create and play scores in your browser. Enter notes and lyrics, play music, and export MusicXML or MIDI.
    language | 언어 | Language
    chooseLanguage | 언어 선택 | Choose language
    theme | UI 테마 선택 | Choose UI theme
  `);
  group("common", `
    ok | 확인 | OK
    cancel | 취소 | Cancel
    close | 닫기 | Close
    apply | 적용 | Apply
    reset | 초기화 | Reset
    refresh | 새로고침 | Refresh
    save | 저장 | Save
    open | 열기 | Open
    delete | 삭제 | Delete
    input | 입력 | Input
    content | 내용 | Content
    none | 없음 | None
    auto | 자동 | Auto
    optional | (선택) | (Optional)
    name | 이름 | Name
    title | 제목 | Title
    composer | 작곡가 | Composer
    subtitle | 부제 | Subtitle
    lyricist | 작사가 | Lyricist
    copyright | 저작권 | Copyright
    up | 위 | Up
    down | 아래 | Down
    normal | 일반 | Normal
    diamond | 다이아 | Diamond
    enabled | 켜짐 | On
    disabled | 꺼짐 | Off
    unknownError | 알 수 없는 오류 | Unknown error
  `);
  group("menu.file", `
    label | 파일 | File
    title | 파일 메뉴 | File menu
    new | 새 악보 만들기 | Create new score
    newIcon | 🆕 새 악보 만들기 | 🆕 Create new score
    openIcon | 📂 열기 | 📂 Open
    save | 저장 (.json) | Save (.json)
    saveIcon | 💾 저장 (.json) | 💾 Save (.json)
    musicxml | MusicXML 내보내기 | Export MusicXML
    musicxmlIcon | 🎼 MusicXML 내보내기 | 🎼 Export MusicXML
    musescore | MuseScore용 | For MuseScore
    midi | MIDI 내보내기 (.mid) | Export MIDI (.mid)
    midiIcon | 🎵 MIDI 내보내기 (.mid) | 🎵 Export MIDI (.mid)
    print | 인쇄 / PDF 저장 | Print / Save PDF
    printIcon | 🖨️ 인쇄 / PDF 저장 | 🖨️ Print / Save PDF
    manuals | 설명서 | Manuals
    quick | 🚀 퀵스타트 한글 설명서 | 🚀 Quick start guide (Korean)
    quickTime | 10분 입문 | 10-minute introduction
    manual | 📘 유저 매뉴얼 | 📘 User manual (Korean)
    allFeatures | 전체 기능 | All features
    demos | 데모 악보 열기 | Open a demo score
    butterfly | 🦋 나비야 (가사 포함) | 🦋 Butterfly (with lyrics)
    star | ⭐ 반짝반짝 작은 별 | ⭐ Twinkle, Twinkle, Little Star
    airplane | ✈️ 비행기 | ✈️ Airplane
    rhythm | 🥁 리듬 연습 (8분·점음표) | 🥁 Rhythm practice (eighth and dotted notes)
    cloudSave | 클라우드에 저장 (Ctrl+Shift+S) | Save to cloud (Ctrl+Shift+S)
    cloudList | 내 악보… | My scores…
    share | 공유 링크 만들기 | Create share link
    autoCloud | 자동 클라우드 저장 | Auto-save to cloud
    copy | 사본 만들기 | Make a copy
  `);
  group("toolbar", `
    settings | 악보 설정 | Score settings
    settingsTitle | 조표·박자·빠르기 등 악보 설정 | Score settings: key, time signature, tempo, and more
    undo | 실행 취소 | Undo
    redo | 다시 실행 | Redo
    rewind | 처음으로 | Rewind
    play | 재생/일시정지 | Play / Pause
    playTitle | 재생/일시정지 (스페이스) | Play / Pause (Space)
    stop | 정지 | Stop
    metronome | 메트로놈 | Metronome
    metronomeTitle | 메트로놈 켜기/끄기 | Toggle metronome
    tempoTitle | 빠르기 (BPM) | Tempo (BPM)
    swingTitle | 스윙 재생 | Swing playback
    swingOff | 스윙 끔 | Swing off
    swingLight | 스윙 약 | Light swing
    swingMedium | 스윙 중 | Medium swing
    swingHeavy | 스윙 강 | Heavy swing
    mixer | 믹서 | Mixer
    mixerTitle | 파트별 믹서 | Part mixer
    staffTitle | 입력할 보표 | Input staff
    viewTitle | 총보/파트 보기 | Full score / Part view
    fullScore | 총보 | Full score
    hideEmpty | 빈보표 | Empty staves
    hideEmptyTitle | 총보에서 빈 보표 숨김 | Hide empty staves in full score
    navigator | 내비게이터 | Navigator
    timeline | 타임라인 | Timeline
    properties | 속성 | Properties
    propertiesTitle | 속성 패널 보이기/숨기기 | Show / Hide properties panel
    propertiesClose | 속성 패널 닫기 | Close properties panel
    instrumentTitle | 활성 파트의 재생 악기 | Playback instrument for active part
    sample | 샘플 | Samples
    sampleTitle | 실제 악기 샘플 음원 | Sampled instrument sounds
    piano | 건반 | Keyboard
    pianoTitle | 화면 피아노 건반 보이기/숨기기 | Show / Hide piano keyboard
    midiTitle | Web MIDI 입력 켜기/끄기 | Toggle Web MIDI input
    midiDevice | MIDI 입력 장치 | MIDI input device
    shortcuts | 단축키 확인 | Keyboard shortcuts
    help | 도움말·단축키 | Help and shortcuts
    input | 입력 모드 | Note input
    inputTitle | 음표 입력 모드 켜기/끄기 (N) | Toggle note input mode (N)
    speedy | 스피디 | Speedy
    speedyTitle | 스피디 입력 — 숫자 키 한 번으로 음표 입력 (Q) | Speedy input — enter a note with one number key (Q)
    voice | 성부 선택 | Select voice
    duration | 음길이 | Duration
    dot | 점음표 | Dotted note
    rest | 쉼표 | Rest
    restInput | 쉼표 입력 | Enter rest
    sharp | 올림표 ♯ | Sharp ♯
    flat | 내림표 ♭ | Flat ♭
    natural | 제자리표 ♮ | Natural ♮
    tie | 타이 | Tie
    tieTitle | 붙임줄(타이) — 같은 음 연결 (T) | Tie — connect notes of the same pitch (T)
    grace | 꾸밈음 추가 | Add grace note
    slur | 이음줄 | Slur
    slurTitle | 이음줄(슬러) — 부드럽게 잇기 (S, 범위 선택 후) | Slur — connect notes smoothly (S, after selecting a range)
    lyric | 가사 | Lyrics
    lyricTitle | 가사 입력 (L 또는 음표 더블클릭) | Enter lyrics (L or double-click a note)
    verse | 가사 절 | Lyric verse
    chord | 코드 기호 입력 | Enter chord symbol
    tempoMarkTitle | 선택 위치에 템포 표시 (Shift+T) | Add tempo at selection (Shift+T)
    rehearsal | 리허설 마크 | Rehearsal mark
    staffText | 스태프 텍스트 | Staff text
    glissando | 글리산도 | Glissando
    arpeggio | 아르페지오 | Arpeggio
    tremolo | 트레몰로 | Tremolo
    repeatStart | 시작 반복 마디선 | Start repeat barline
    repeatEnd | 끝 반복 마디선 | End repeat barline
    repeatCount | 반복 횟수 설정 | Set repeat count
    endingOne | 1번 엔딩(볼타) | First ending (volta)
    endingTwo | 2번 엔딩(볼타) | Second ending (volta)
    breakSystem | 선택 마디 뒤 시스템 줄바꿈 | Add system break after selected measure
    breakPage | 선택 마디 뒤 페이지 나눔 | Add page break after selected measure
    breakSection | 선택 마디 뒤 섹션 브레이크 | Add section break after selected measure
    staccatoTitle | 스타카토 — 짧게 끊어서 (Shift+S) | Staccato — short and detached (Shift+S)
    tenutoTitle | 테누토 — 음길이를 충분히 (Shift+N) | Tenuto — hold for full duration (Shift+N)
    accentTitle | 악센트 — 세게 강조 (Shift+V) | Accent — emphasize (Shift+V)
    marcatoTitle | 마르카토 — 매우 강하게 (Shift+O) | Marcato — strongly accented (Shift+O)
    fermataTitle | 페르마타 — 충분히 늘이기 | Fermata — hold longer
    ppTitle | 피아니시모 — 매우 여리게 | Pianissimo — very soft
    pTitle | 피아노 — 여리게 | Piano — soft
    mpTitle | 메조피아노 — 조금 여리게 | Mezzo-piano — moderately soft
    mfTitle | 메조포르테 — 조금 세게 | Mezzo-forte — moderately loud
    fTitle | 포르테 — 세게 | Forte — loud
    ffTitle | 포르티시모 — 매우 세게 | Fortissimo — very loud
    crescTitle | 크레셴도 — 점점 세게 (범위 선택 후 <) | Crescendo — gradually louder (< after selecting a range)
    dimTitle | 디미누엔도 — 점점 여리게 (범위 선택 후 >) | Diminuendo — gradually softer (> after selecting a range)
    deleteTitle | 삭제 — 쉼표로 바꾸기 (Delete) | Delete — replace with rest (Delete)
    drumPad | 드럼 입력 패드 | Drum input pad
    editTitle | 클릭해서 제목 수정 | Click to edit title
    editComposer | 클릭해서 작곡가 수정 | Click to edit composer
    zoomOut | 축소 | Zoom out
    zoomIn | 확대 | Zoom in
    fit | 화면에 맞추기 | Fit to screen
    rate | 재생 속도 | Playback speed
    loop | 루프 | Loop
    countIn | 카운트인 | Count-in
  `);
  group("settings", `
    scoreTitle | 악보 제목 | Score title
    ensemble | 편성 | Ensemble
    solo | 독주 1단 | Solo (one staff)
    piano | 피아노 2단 | Piano (two staves)
    flutePiano | 플루트 + 피아노 3단 | Flute and piano (three staves)
    quartet | 현악4중주 | String quartet
    clef | 음자리표 | Clef
    treble | 높은음자리표 𝄞 | Treble clef 𝄞
    bass | 낮은음자리표 𝄢 | Bass clef 𝄢
    percussion | 타악 보표 | Percussion staff
    alto | 알토음자리표 | Alto clef
    tenor | 테너음자리표 | Tenor clef
    treblePlain | 높은음자리표 | Treble clef
    bassPlain | 낮은음자리표 | Bass clef
    key | 조표 | Key signature
    time | 박자 | Time signature
    tempo | 빠르기 ♩= | Tempo ♩=
    measuresPerSystem | 마디/줄 | Measures per system
    paper | 용지 | Paper
    orientation | 방향 | Orientation
    portrait | 세로 | Portrait
    landscape | 가로 | Landscape
    margin | 여백 | Margins
    noteSpacing | 음표 간격 | Note spacing
    systemGap | 시스템 간격 | System spacing
    staffGap | 보표 간격 | Staff spacing
    beamThickness | 빔 두께 | Beam thickness
    measures | 마디 | Measures
    addFour | ＋ 마디 4개 추가 | ＋ Add four measures
    deleteLast | － 마지막 마디 삭제 | － Delete last measure
    transpose | 조옮김 | Transpose
    semitoneUp | 반음 ↑ | Semitone ↑
    semitoneDown | 반음 ↓ | Semitone ↓
    toneUp | 온음 ↑ | Whole tone ↑
    toneDown | 온음 ↓ | Whole tone ↓
    octaveUp | 옥타브 ↑ | Octave ↑
    octaveDown | 옥타브 ↓ | Octave ↓
  `);
  group("properties", `
    score | 악보 | Score
    staff | 보표 | Staves
    empty | 음표나 쉼표를 선택하면 이곳에서 보임, 색상, 오프셋, 기호, 브레이크를 바로 조정할 수 있어요. | Select a note or rest to adjust visibility, color, offsets, symbols, and breaks here.
    note | 음표 | Note
    position | 위치 | Position
    visible | 보임 | Visible
    color | 색상 | Color
    break | 마디 브레이크 | Measure break
    system | 시스템 | System
    page | 페이지 | Page
    section | 섹션 | Section
    resetOffset | 오프셋 초기화 | Reset offsets
    resetColor | 색상 초기화 | Reset color
    appearance | 음표 모양 | Note appearance
    stem | 스템 | Stem
    head | 머리 | Notehead
    small | 작게 | Small
    symbols | 기호/텍스트 | Symbols / Text
    dynamics | 셈여림 | Dynamics
    tempo | 템포 | Tempo
    rehearsal | 리허설 | Rehearsal
    chord | 코드 | Chord
  `);
  group("instrument", `
    piano | 피아노 | Piano
    epiano | 일렉피아노 | Electric piano
    musicbox | 뮤직박스 | Music box
    organ | 오르간 | Organ
    strings | 현악기 | Strings
    flute | 플루트 | Flute
    guitar | 기타 | Guitar
    chiptune | 8비트 | Chiptune
    drums | 드럼 키트 | Drum kit
    guitarTab | 기타 + TAB | Guitar + TAB
    violin | 바이올린 | Violin
    viola | 비올라 | Viola
    cello | 첼로 | Cello
    label | 악기 | Instrument
  `);
  group("key", `
    c | 다장조 (C) | C major (C)
    g | 사장조 (G, ♯1) | G major (G, ♯1)
    d | 라장조 (D, ♯2) | D major (D, ♯2)
    a | 가장조 (A, ♯3) | A major (A, ♯3)
    e | 마장조 (E, ♯4) | E major (E, ♯4)
    b | 나장조 (B, ♯5) | B major (B, ♯5)
    fSharp | 올림바장조 (F♯, ♯6) | F♯ major (F♯, ♯6)
    cSharp | 올림다장조 (C♯, ♯7) | C♯ major (C♯, ♯7)
    f | 바장조 (F, ♭1) | F major (F, ♭1)
    bFlat | 내림나장조 (B♭, ♭2) | B♭ major (B♭, ♭2)
    eFlat | 내림마장조 (E♭, ♭3) | E♭ major (E♭, ♭3)
    aFlat | 내림가장조 (A♭, ♭4) | A♭ major (A♭, ♭4)
    dFlat | 내림라장조 (D♭, ♭5) | D♭ major (D♭, ♭5)
    gFlat | 내림사장조 (G♭, ♭6) | G♭ major (G♭, ♭6)
    cFlat | 내림다장조 (C♭, ♭7) | C♭ major (C♭, ♭7)
  `);
  group("duration", `
    breve | 겹온음표 | Breve
    whole | 온음표 | Whole note
    half | 2분음표 | Half note
    quarter | 4분음표 | Quarter note
    eighth | 8분음표 | Eighth note
    sixteenth | 16분음표 | Sixteenth note
    thirtySecond | 32분음표 | Thirty-second note
    sixtyFourth | 64분음표 | Sixty-fourth note
    fullRest | 온마디 쉼표 | Whole-measure rest
    dotted | 점{duration} | Dotted {duration}
    doubleDotted | 겹점{duration} | Double-dotted {duration}
    tuplet | {count}잇단 {duration} | {count}-tuplet {duration}
    rest | {duration} 쉼표 | {duration} rest
  `);
  group("dialog", `
    new | 새 악보 | New score
    newConfirm | 새 악보를 만들까요? 현재 작업을 보관하려면 파일로 저장해 주세요. | Create a new score? Save your current work to a file first if you want to keep it.
    repeatCount | 반복 횟수 (2~8) | Repeat count (2–8)
    tempo | 템포 표시 ♩ = | Tempo marking ♩ =
    sectionName | 섹션 이름 | Section name
    goTo | 이동: 마디 번호, r:A | Go to: measure number, r:A
    commandSearch | 명령 검색 | Search commands
    import | 📂 가져오기 결과 | 📂 Import report
    importPlain | 가져오기 결과 | Import report
  `);
  group("welcome", `
    title | 🎼 ScoreForge에 어서 오세요! | 🎼 Welcome to ScoreForge!
    intro | 브라우저에서 바로 악보를 만들고, 듣고, 인쇄할 수 있어요. 딱 3가지만 기억하세요: | Create, listen to, and print scores in your browser. Remember these three steps:
    inputBefore | 키 또는 입력 모드 버튼으로 | or the Note input button to enable
    inputAfter | 켜기 | mode
    staffBefore | 보표를 | On the staff,
    staffBetween | 하거나 아래 | or use the
    staffAfter | 을 눌러 음표 넣기 | below to enter notes
    click | 클릭 | click
    piano | 피아노 건반 | piano keyboard
    playBefore | 키로 | to
    play | 재생 | play
    playAfter | 해서 들어보기 | and listen
    blank | 빈 악보로 시작 | Start with a blank score
    blankHint | 조표·박자부터 직접 설정 | Choose the key and time signature
    butterfly | 나비야 | Butterfly
    butterflyHint | 가사가 있는 동요 예제 | A children's song with lyrics
    star | 반짝반짝 작은 별 | Twinkle, Twinkle, Little Star
    starHint | 계이름 가사 예제 | An example with solfège lyrics
    rhythm | 리듬 연습 | Rhythm practice
    rhythmHint | 8분음표·점음표·빔 예제 | Eighth notes, dotted notes, and beams
  `);
  group("help", `
    title | 도움말 · 단축키 | Help · Keyboard shortcuts
    imageAlt | 도움말 단축키 다이얼로그 이미지 | Help and keyboard shortcuts dialog image
    shortcutClose | 단축키 닫기 | Close keyboard shortcuts
    overlayHint | 단축키를 누르면 해당 항목이 반짝입니다. 클릭하거나 등록되지 않은 키를 누르면 닫힙니다. | Press a shortcut to highlight its action. Click or press an unassigned key to close.
    noteInput | 음표 입력 (MuseScore 방식) | Note input (MuseScore style)
    toggleInput | 입력 모드 켜기/끄기 | Toggle note input
    pitchInput | 음 입력 | Enter pitch
    chooseDuration | 음길이 선택 | Choose duration
    chordStack | 화음 쌓기 | Build chord
    semitone | 반음 올리기/내리기 | Raise / Lower by a semitone
    octave | 옥타브 이동 | Move by an octave
    tie | 붙임줄(타이) | Tie
    tuplet | 잇단음표로 나누기 | Split into tuplet
    tempo | 템포 표시 | Tempo marking
    exitInput | 입력 종료 | Exit input
    speedy | 스피디 입력 (빠른 입력) | Speedy input (quick entry)
    toggleSpeedy | 스피디 켜기/끄기 | Toggle Speedy input
    instant | 음표 즉시 입력 | Enter note immediately
    crosshair | 크로스헤어 이동 | Move pitch crosshair
    caret | 캐럿 이동 | Move caret
    accidental | 반음 올림/내림 | Raise / Lower a semitone
    dotTie | 점음표·타이 | Dot / Tie
    chordAdd | 화음 추가 | Add to chord
    erase | 지우기 | Erase
    hold | 건반 홀드 입력 | Enter with held keys
    holdHint | 건반을 누른 채 | Hold piano keys, then press
    editing | 선택·편집 | Selection and editing
    previousNext | 이전/다음 음표 선택 | Select previous / next note
    range | 범위 선택(여러 음표) | Select a range of notes
    changePitch | 선택 음표 음높이 변경 | Change selected pitch
    respell | 음이름으로 재지정 | Assign by note name
    clipboard | 복사/붙여넣기/잘라내기 | Copy / Paste / Cut
    commands | 명령 팔레트 | Command palette
    chordHint | 명령 팔레트 또는 툴바 | Command palette or toolbar
    text | 리허설/스태프 텍스트 | Rehearsal mark / Staff text
    repeats | 시작/끝 반복 | Start / End repeat
    endings | 1·2번 엔딩 | First / Second ending
    delete | 삭제(쉼표로) | Delete (replace with rest)
    lyrics | 가사 입력 | Enter lyrics
    hyphen | 가사 하이픈/멜리스마 | Lyric hyphen / Melisma
    undoRedo | 실행 취소/다시 실행 | Undo / Redo
    expression | 표현 기호 (선택 후) | Expression (after selecting notes)
    slur | 이음줄(슬러) | Slur
    staccato | 스타카토 | Staccato
    accent | 악센트 | Accent
    tenuto | 테누토 | Tenuto
    marcato | 마르카토 | Marcato
    hairpins | 크레셴도/디미누엔도 | Crescendo / Diminuendo
    dynamics | 셈여림(pp~ff) | Dynamics (pp–ff)
    fermata | 페르마타 | Fermata
    other | 재생·기타 | Playback and more
    playSelection | 선택한 음부터 재생 | Play from selected note
    zoom | 확대/축소 | Zoom in / out
    print | 인쇄/PDF | Print / PDF
    printHint | 파일 메뉴 → 인쇄 | File menu → Print
    toolbar | 툴바 | Toolbar
    toolbarButton | 툴바 버튼 | Toolbar button
    toolbarToggle | 툴바 버튼 (다시 누르면 삭제) | Toolbar button (press again to remove)
    afterRange | (범위 선택 후) | (after selecting a range)
    rangeToolbar | 범위 선택 후 툴바 | Select a range, then use the toolbar
    afterSelection | 음표 선택 후 | Select a note, then press
    whileInput | 입력 중 | While entering lyrics
    doubleClick | 또는 더블클릭 | or double-click
    drag | 또는 드래그 | or drag
    clickSuffix | /클릭 | / click
    shiftClick | +클릭 / | + click /
    wheel | +휠 | + wheel
    octaveSuffix | =옥타브) | = octave)
    measureSuffix | =마디) | = measure)
    sixteenthTo | 16분 ~ | sixteenth to
    fileSave | 파일 → 저장(.json) | File → Save (.json)
    savedIntro | 💡 작업 내용은 브라우저에 자동 저장돼요. 다른 컴퓨터로 옮기려면 | 💡 Your work is saved automatically in this browser. To move it to another computer, use
    savedMiddle | 으로 내려받고, MuseScore 프로그램에서 열려면 | to download it. To open it in MuseScore, use
    savedEnd | 를 쓰세요. | .
    importIntro | 💡 가져온 악보는 자유롭게 수정한 뒤 | 💡 Edit the imported score, then keep it using
    importEnd | 으로 보관하세요. | .
    space | 스페이스 | Space
  `);
  group("toast", `
    saved | 악보 파일을 내려받았어요 | Score file downloaded
    autosaved | 이 기기에 자동 저장했어요 | Saved automatically on this device
    storageFull | 자동 저장 공간이 부족해요. 파일 메뉴에서 악보를 저장해 주세요. | Auto-save storage is full. Save your score from the File menu.
    musicxml | MusicXML로 내보냈어요 — MuseScore에서 열 수 있어요 | Exported MusicXML — open it in MuseScore
    midi | MIDI 파일을 내려받았어요 | MIDI file downloaded
    quickManual | 퀵스타트 설명서를 새 탭으로 열었어요 | Opened the quick start guide in a new tab
    userManual | 유저 매뉴얼을 새 탭으로 열었어요 | Opened the user manual in a new tab
    demo | 데모 악보를 불러왔어요 — 스페이스로 재생해 보세요 | Demo loaded — press Space to play
    tryPlay | 스페이스 키로 재생해 보세요! | Press Space to play!
    restored | 이전 작업을 자동으로 불러왔어요 | Restored your previous work
    metronomeOn | 메트로놈 켜짐 | Metronome on
    metronomeOff | 메트로놈 꺼짐 | Metronome off
    midiOn | MIDI 입력 켜짐 | MIDI input on
    midiOff | MIDI 입력 꺼짐 | MIDI input off
    midiConnected | MIDI 건반 연결됨 — 건반 누른 채 숫자 키 | MIDI keyboard connected — hold keys and press a number
    addMeasures | 마디 4개를 추가했어요 | Added four measures
    deleteMeasure | 마지막 마디를 삭제했어요 | Deleted the last measure
    slurRemoved | 이음줄을 지웠어요 | Slur removed
    slurAdded | 이음줄을 걸었어요 (다시 S = 삭제) | Slur added (press S again to remove)
    hairpinRemoved | 쐐기를 지웠어요 | Hairpin removed
    crescendo | 크레셴도(점점 세게)를 걸었어요 | Crescendo added (gradually louder)
    diminuendo | 디미누엔도(점점 여리게)를 걸었어요 | Diminuendo added (gradually softer)
    grace | 꾸밈음을 추가했어요 | Grace note added
    rehearsalRemoved | 리허설 마크를 지웠어요 | Rehearsal mark removed
    textAdded | 스태프 텍스트를 붙였어요 | Staff text added
    textRemoved | 스태프 텍스트를 지웠어요 | Staff text removed
    breakAdded | 브레이크를 표시했어요 | Break added
    breakRemoved | 브레이크를 지웠어요 | Break removed
    readOnly | 읽기 전용 악보예요. 사본을 만들어 편집하세요. | This score is read-only. Make a copy to edit it.
    error | 문제가 생겼어요 — 자동 저장은 안전합니다 | Something went wrong — your auto-save is safe
    theme | {theme}로 전환했어요 | Switched to {theme}
    loaded | "{title}" 불러왔어요 | Loaded "{title}"
    copied | {count}개를 복사했어요 | Copied {count} items
    pasted | {count}개를 붙여넣었어요 | Pasted {count} items
    transposeUp | {count}반음 올렸어요 | Transposed up {count} semitones
    transposeDown | {count}반음 내렸어요 | Transposed down {count} semitones
    tuplet | {count}잇단음표로 나눴어요 | Split into a {count}-tuplet
    repeat | {count}번 반복으로 설정했어요 | Set to repeat {count} times
    ending | {count}번 엔딩을 표시했어요 | Added ending {count}
    tempo | 템포 ♩={tempo} | Tempo ♩={tempo}
    rehearsal | 리허설 {text} | Rehearsal {text}
    openError | 열 수 없어요: {name} | Cannot open: {name}
  `);
  group("hint", `
    selectCopy | 복사할 음표나 쉼표를 먼저 선택하세요 | Select notes or rests to copy first
    sameStaff | 복사는 한 보표 안의 범위에서만 할 수 있어요 | Copy a range within a single staff
    emptyClipboard | 붙여넣을 악보 조각이 없어요 | No score fragment to paste
    restAdded | 쉼표를 입력했어요 | Rest entered
    chooseDrums | 드럼 키트 보표를 선택하면 드럼 패드를 사용할 수 있어요 | Select a drum kit staff to use the drum pad
    unsupportedDot | 16분음표에는 점을 붙일 수 없어요 | A dot cannot be added to a sixteenth note
    selectNote | 먼저 음표를 선택하세요 | Select a note first
    selectNotes | 음표를 선택하세요 | Select notes
    selectTie | 타이를 걸 음표를 선택하세요 | Select a note to tie
    tiePitch | 다음 음이 같은 높이일 때만 타이를 걸 수 있어요 | A tie requires the next note to have the same pitch
    selectSymbol | 기호를 붙일 음표를 먼저 선택하세요 | Select notes for the symbol first
    selectDynamic | 셈여림을 붙일 음표를 먼저 선택하세요 | Select a note for the dynamic first
    selectSlur | 이음줄을 걸 음표를 먼저 선택하세요 | Select notes for the slur first
    noNextSlur | 이음줄을 이을 다음 음표가 없어요 | No next note to connect with a slur
    selectHairpin | 범위를 선택한 뒤 누르면 쐐기가 걸려요 (Shift+클릭으로 범위) | Select a range before adding a hairpin (Shift+click to select a range)
    selectTuplet | 잇단음표로 바꿀 음표나 쉼표를 선택하세요 | Select a note or rest to turn into a tuplet
    fullRestTuplet | 온마디 쉼표는 먼저 음길이를 바꾼 뒤 잇단음표로 만들 수 있어요 | Change a whole-measure rest's duration before making a tuplet
    alreadyTuplet | 이미 잇단음표 안에 있어요 | Already inside a tuplet
    selectGrace | 꾸밈음을 붙일 음표를 먼저 선택하세요 | Select a note for the grace note first
    selectNotation | 기보를 붙일 음표를 먼저 선택하세요 | Select a note for the notation first
    selectRepeat | 반복 기호를 붙일 마디를 먼저 선택하세요 | Select a measure for the repeat first
    selectRepeatEnd | 끝 반복 마디를 먼저 선택하세요 | Select the end-repeat measure first
    selectEnding | 볼타를 붙일 마디 범위를 선택하세요 | Select a measure range for the ending
    selectChord | 코드 기호를 붙일 위치를 먼저 선택하세요 | Select a position for the chord symbol first
    selectTempo | 템포를 붙일 위치를 먼저 선택하세요 | Select a position for the tempo first
    selectRehearsal | 리허설 마크를 붙일 위치를 먼저 선택하세요 | Select a position for the rehearsal mark first
    selectText | 텍스트를 붙일 위치를 먼저 선택하세요 | Select a position for the text first
    selectLyrics | 가사를 붙일 음표를 먼저 선택하세요 | Select a note for the lyrics first
    selectBreak | 브레이크를 붙일 마디를 먼저 선택하세요 | Select a measure for the break first
    notFound | 이동할 위치를 찾지 못했어요 | Could not find the requested position
    dropFile | 악보 파일(.json/.musicxml/.xml/.mxl)을 끌어다 놓아주세요 | Drop a score file (.json/.musicxml/.xml/.mxl)
    lyricKeys | Space=다음 · Esc=닫기 | Space=next · Esc=close
    lyricMelisma | Space=다음 · -=하이픈 · _=멜리스마 | Space=next · -=hyphen · _=melisma
    chordKeys | Space=다음 · Shift+Space=이전 · Esc=닫기 | Space=next · Shift+Space=previous · Esc=close
    speedy | ↑↓=음높이 조준 · ←→=이동 · 1~8=입력 · 0=쉼표 · Esc=종료 | ↑↓=aim pitch · ←→=move · 1–8=enter · 0=rest · Esc=exit
    restMode | 보표를 클릭하면 쉼표가 들어가요 · 쉼표 버튼으로 해제 | Click the staff to enter rests · Press Rest to exit rest mode
    input | 보표 클릭 또는 A~G·피아노 건반으로 입력 · 0=쉼표 · ↑↓=반음 · Esc=종료 | Click the staff, press A–G, or use piano keys · 0=rest · ↑↓=semitone · Esc=exit
    idle | N 또는 ✏️=입력 모드 · 음표 클릭=선택 · 드래그=음높이 · 스페이스=재생 | N or ✏️=note input · Click note=select · Drag=change pitch · Space=play
    held | 건반 {count}개 누름 — 숫자로 입력 · 1~8=입력 · 0=쉼표 · Esc=종료 | {count} keys held — enter with numbers · 1–8=enter · 0=rest · Esc=exit
  `);
  group("status", `
    online | 온라인 | Online
    offline | 오프라인 | Offline
    midiUnavailable | Web MIDI 없음 | Web MIDI unavailable
    midiPermission | MIDI 권한 필요 | MIDI permission required
    noDevice | 장치 없음 | No device
    sampleWaiting | 샘플 대기 | Samples pending
    sampleLoading | 샘플 로딩 | Loading samples
    sampleReady | 샘플 준비 | Samples ready
    synth | 신스 사용 | Using synthesizer
    sampleHelp | 재생하면 smplr 실제 악기 샘플을 불러옵니다. | Instrument samples load when you start playback.
    libraryLoading | smplr 라이브러리를 불러오는 중입니다. | Loading the smplr library.
    libraryFailed | smplr를 불러오지 못해 내장 신스로 재생합니다. | Could not load smplr. Using the built-in synthesizer.
    sampleFailed | 샘플 음원을 불러오지 못해 내장 신스로 재생합니다. | Could not load samples. Using the built-in synthesizer.
    samplePlaybackFailed | 샘플 재생 중 문제가 생겨 내장 신스로 전환합니다. | Sample playback failed. Switching to the built-in synthesizer.
    sampleSession | 이번 재생은 준비된 음원으로 끝까지 재생합니다. 다음 재생에 새 샘플을 적용합니다. | This playback uses the sounds already available. New samples will be used on the next playback.
    sampleInstrumentLoading | {instrument} 샘플을 불러오는 중입니다. | Loading {instrument} samples.
    sampleInstrumentReady | {instrument} 샘플 음원 준비 완료 | {instrument} samples ready
    selected | {count}개 선택 | {count} selected
    selectionHint | {count}개 선택 — Ctrl+C/V=복사/붙여넣기 · S=이음줄 · < >=쐐기 | {count} selected — Ctrl+C/V=copy/paste · S=slur · < >=hairpins
    overview | {measures}마디 · {staves}보표 · {key} · {time} | {measures} measures · {staves} staves · {key} · {time}
    position | {name} · V{voice} · 마디 {measure} | {name} · V{voice} · Measure {measure}
    input | 입력 위치: {name} · V{voice} · 마디 {measure} · {duration}로 입력 | Input: {name} · V{voice} · Measure {measure} · Enter {duration}
    speedy | 스피디: {name} · 마디 {measure} · 크로스헤어 {pitch} | Speedy: {name} · Measure {measure} · Crosshair {pitch}
    note | {position} · {duration} · {details} | {position} · {duration} · {details}
    chordNote | {status} · 화음 {index}번째 음 | {status} · Chord note {index}
    verse | {verse}절 | Verse {verse}
    verseLyrics | {verse}절 가사 | Verse {verse} lyrics
    chord | 코드 {symbol} | Chord {symbol}
  `);
  group("history", `
    paste | 붙여넣기 | Paste
    note | 음표 입력 | Enter note
    drum | 드럼 입력 | Enter drum note
    speedy | 스피디 입력 | Speedy input
    speedyRest | 스피디 쉼표 | Speedy rest
    speedyDot | 스피디 점음표 | Speedy dotted note
    speedyChord | 스피디 화음 추가 | Speedy chord addition
    speedyErase | 스피디 지우기 | Speedy erase
    chord | 화음에 음 추가 | Add note to chord
    dragPitch | 음높이 드래그 | Drag pitch
    duration | 음길이 변경 | Change duration
    accidental | 임시표 | Accidental
    pitch | 음높이 변경 | Change pitch
    deleteRange | 범위 삭제 | Delete range
    repitch | 음높이 재지정 | Reassign pitch
    articulation | 아티큘레이션 | Articulation
    crescendo | 크레셴도 | Crescendo
    diminuendo | 디미누엔도 | Diminuendo
    grace | 꾸밈음 | Grace note
    advanced | 고급 기보 | Advanced notation
    repeatStart | 시작 반복 | Start repeat
    repeatEnd | 끝 반복 | End repeat
    repeatCount | 반복 횟수 | Repeat count
    chordSymbol | 코드 기호 | Chord symbol
    properties | 속성 변경 | Change properties
    resetProperties | 속성 초기화 | Reset properties
    addMeasure | 마디 추가 | Add measures
    deleteMeasure | 마디 삭제 | Delete measure
    tempo | 빠르기 | Tempo
    swing | 스윙 | Swing
    metadata | 제목/작곡가 | Title / Composer
    tuplet | {count}잇단음표 | {count}-tuplet
    ending | {count}번 엔딩 | Ending {count}
    undo | 실행 취소: {action} | Undo: {action}
    redo | 다시 실행: {action} | Redo: {action}
  `);
  group("import", `
    summary | "{title}" — {measures}마디를 가져왔어요. 아래 항목은 이 앱이 지원하는 범위로 줄이면서 바뀌거나 무시됐어요. | Imported {measures} measures from "{title}". The items below were changed or omitted to fit the features supported by this app.
    counted | {message} ({count}건) | {message} ({count} occurrences)
    firstPart | 파트 {count}개 중 첫 번째만 가져왔어요 | Imported only the first of {count} parts
    tooManyMeasures | 마디가 많아 앞 500마디만 가져왔어요 (전체 {count}마디) | Imported the first 500 measures (out of {count})
    timewise | timewise 형식을 변환해서 읽었어요 | Converted and imported timewise format
    key | 조표 변경은 지원하지 않아 첫 조표만 사용 | Key changes are unsupported; used the first key signature
    time | 박자 변경은 지원하지 않아 첫 박자만 사용 | Time signature changes are unsupported; used the first time signature
    clef | 지원하지 않는 음자리표는 높은음자리표로 표시 | Displayed unsupported clefs as treble clefs
    clefChange | 중간 음자리표 변경은 무시 | Omitted mid-score clef changes
    staves | 여러 단 보표 중 첫 단만 가져옴 | Imported only the first staff
    transpose | 조옮김 악기 정보는 무시(적힌 음 그대로) | Ignored instrument transposition (kept written pitches)
    dynamics | 지원하지 않는 셈여림은 무시 | Omitted unsupported dynamics
    wedge | 짝이 맞지 않는 쐐기(헤어핀) 무시 | Omitted unmatched hairpins
    octave | 옥타브 선(8va)은 무시 | Omitted octave lines (8va)
    backup | backup 위치 오차 보정 | Corrected backup position errors
    unpitched | 매핑할 수 없는 무율(타악) 음표는 무시 | Omitted unmapped unpitched percussion notes
    badPitch | 읽을 수 없는 음높이 건너뜀 | Skipped unreadable pitches
    respell | 겹임시표는 같은 소리의 다른 철자로 변환 | Respelled double accidentals as equivalent pitches
    tuplet | 잇단음표는 16분 격자로 근사 | Approximated tuplets on a sixteenth-note grid
    articulation | 일부 아티큘레이션은 비슷한 기호로 대체 | Replaced some articulations with similar symbols
    ornament | 장식음·글리산도·트레몰로 등은 무시 | Omitted ornaments, glissandi, tremolos, and similar markings
    defaultTime | 박자표가 없어 4/4로 가정했어요 | No time signature; assumed 4/4
    pickup | 못갖춘마디(여린내기)는 앞을 쉼표로 채웠어요 | Filled the beginning of the pickup measure with rests
    tiny | 너무 짧은 음(32분 이하 등)은 격자 근사로 생략 | Omitted very short notes (such as thirty-second notes) during quantization
    overflow | 마디 범위를 벗어난 음 무시 | Omitted notes outside the measure
    slur | 짝이 없는 이음줄 무시 | Omitted unmatched slurs
  `);
  group("error", `
    denominator | 음길이의 분모가 너무 커서 MusicXML로 저장할 수 없어요 | Note duration denominators are too large to export as MusicXML
    notZip | mxl(zip) 형식이 아니에요 | Not an MXL (ZIP) file
    decompress | 이 브라우저는 mxl 압축 해제를 지원하지 않아요 (최신 브라우저 필요) | This browser cannot decompress MXL files (a newer browser is required)
    compression | 지원하지 않는 zip 압축 방식이에요 | Unsupported ZIP compression method
    missingXml | mxl 안에서 악보 xml을 찾지 못했어요 | No score XML found in the MXL file
    parseXml | XML을 읽을 수 없어요 (파싱 오류) | Cannot read XML (parse error)
    notMusicXml | MusicXML 악보가 아니에요 | Not a MusicXML score
    noParts | 파트가 없어요 | No parts found
    noMeasures | 마디가 없어요 | No measures found
    notScoreForge | ScoreForge 악보 파일이 아니에요 | Not a ScoreForge score file
    unknownFormat | 알 수 없는 파일 형식이에요 | Unknown file format
    readFile | 파일을 읽지 못했어요 | Could not read the file
  `);
  group("auth", `
    menu | 회원 메뉴 | Account menu
    status | Supabase 로그인 상태 | Supabase sign-in status
    notConfigured | Supabase 미설정 | Supabase not configured
    signup | 회원가입 | Sign up
    signupTitle | Supabase 회원가입 | Sign up with Supabase
    memberLogin | 회원 로그인 | Member sign-in
    adminLogin | 관리자 로그인 | Admin sign-in
    adminPage | 관리자 페이지 | Admin panel
    logout | 로그아웃 | Sign out
    login | 로그인 | Sign in
    loggedOut | 로그인 전 | Signed out
    connection | Supabase 연결 | Supabase connection
    saveConnection | 연결 저장 | Save connection
    urlPlaceholder | https://프로젝트.supabase.co | https://project.supabase.co
    configHelp | Supabase Dashboard의 Project URL과 publishable key만 입력하세요. service_role key는 브라우저에 넣지 않습니다. | Enter only the Project URL and publishable key from your Supabase Dashboard. Do not put a service_role key in the browser.
    displayName | 표시 이름 | Display name
    email | 이메일 | Email
    password | 비밀번호 | Password
    minPassword | 6자 이상 | At least 6 characters
    signupHelp | 이메일과 비밀번호로 새 계정을 만들어요. 이메일 확인이 켜져 있으면 인증 메일 확인 뒤 로그인됩니다. | Create an account with your email and password. If email confirmation is enabled, confirm your email before signing in.
    memberHelp | 가입한 회원 계정으로 로그인합니다. | Sign in with your member account.
    adminHelp | 관리자 페이지는 profiles.role 값이 admin인 계정만 열 수 있어요. | Only accounts with profiles.role set to admin can open the admin panel.
    configureFirst | Supabase Project URL과 publishable key를 먼저 저장하세요. | Save the Supabase Project URL and publishable key first.
    libraryFailed | Supabase JS 라이브러리를 불러오지 못했어요. 네트워크 연결을 확인하세요. | Could not load the Supabase JS library. Check your network connection.
    invalidCredentials | 이메일 또는 비밀번호가 올바르지 않습니다. | Incorrect email or password.
    unconfirmed | 이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인하세요. | Your email has not been confirmed. Check your inbox.
    networkError | Supabase에 연결할 수 없습니다. URL, publishable key, 네트워크 상태를 확인하세요. | Cannot connect to Supabase. Check the URL, publishable key, and network connection.
    busy | 처리 중... | Working...
    needConfig | Project URL과 publishable key를 모두 입력하세요. | Enter both the Project URL and publishable key.
    https | Project URL은 https:// 로 시작해야 합니다. | The Project URL must start with https://.
    secretKey | service_role key는 브라우저에 저장하면 안 됩니다. publishable key를 입력하세요. | Do not store a service_role key in the browser. Enter a publishable key.
    storageError | 브라우저 저장소에 Supabase 설정을 저장하지 못했어요. | Could not save Supabase settings in browser storage.
    configSaved | Supabase 연결 정보를 저장했어요. | Supabase connection saved.
    configReset | Supabase 연결 설정을 초기화했어요. | Supabase connection settings reset.
    saveFirst | Supabase 연결 정보를 먼저 저장하세요. | Save the Supabase connection details first.
    configSuffix | {message} 먼저 Supabase 연결 정보를 저장하세요. | {message} Save the Supabase connection details first.
    needCredentials | 이메일과 비밀번호를 입력하세요. | Enter your email and password.
    shortPassword | 비밀번호는 6자 이상이어야 합니다. | The password must contain at least 6 characters.
    signupDone | 회원가입 완료. 로그인했어요 | Account created. You are signed in
    confirmEmail | 회원가입 요청이 완료됐어요. 이메일 인증이 켜져 있다면 받은 편지함에서 확인 링크를 눌러주세요. | Sign-up request complete. If email confirmation is enabled, click the confirmation link in your inbox.
    checkRls | profiles 테이블 또는 RLS 설정을 확인해야 합니다. | Check the profiles table or RLS settings.
    noAdmin | 관리자 권한이 없습니다. Supabase SQL Editor에서 해당 계정의 role을 admin으로 승격하세요. | This account has no admin access. Set its role to admin in the Supabase SQL Editor.
    adminDone | 관리자로 로그인했어요 | Signed in as administrator
    memberDone | 회원 로그인 완료 | Signed in as member
    logoutDone | 로그아웃했어요 | Signed out
    adminRequired | 관리자 권한이 필요합니다. 관리자 계정으로 다시 로그인하세요. | Admin access is required. Sign in again with an admin account.
    adminStatus | {email} · 관리자 | {email} · Admin
    memberStatus | {email} · 회원 | {email} · Member
    adminAuth | 관리자 인증 | Admin authentication
    members | 회원 목록 | Member list
    promoteSql | 관리자 승격 SQL | Admin promotion SQL
    promoteHelp | 첫 관리자 계정은 Supabase SQL Editor에서 직접 승격하세요. | Promote the first admin account directly in the Supabase SQL Editor.
    account | 계정 | Account
    role | 권한 | Role
    currentScore | 현재 악보 | Current score
    joined | 가입일 | Joined
    membersLoading | 회원 목록을 불러오는 중입니다. | Loading members.
    adminUnverified | 관리자 권한이 확인되지 않았습니다. | Admin access has not been verified.
    noMembers | 표시할 회원 프로필이 없습니다. | No member profiles to display.
    membersFailed | 회원 목록을 불러오지 못했어요. {error} | Could not load members. {error}
  `);
  group("cloud", `
    invalidId | 악보 ID가 올바르지 않아요. | Invalid score ID.
    invalidSlug | 공유 링크가 올바르지 않아요. | Invalid share link.
    tooLarge | 악보 데이터는 2MB 미만이어야 해요. 로컬 파일로 저장해 주세요. | Score data must be smaller than 2 MB. Save it as a local file.
    readOnly | 공유 악보는 사본을 만든 뒤 편집해 주세요. | Make a copy of the shared score before editing.
    accountChanged | 계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요. | Your account changed. Try again with the current account.
    loginRequired | 클라우드를 사용하려면 먼저 로그인해 주세요. | Sign in to use cloud storage.
    memberRequired | 회원 로그인이 필요해요. | A member sign-in is required.
    originalAccount | 이 저장 요청을 만든 계정으로 로그인해 주세요. | Sign in with the account that created this save request.
    storageFull | 클라우드 대기 중 · 브라우저 저장 공간이 부족해요. 로컬 파일도 저장해 주세요. | Cloud save pending · Browser storage is full. Save a local file too.
    saved | 클라우드 저장됨 {time} | Saved to cloud {time}
    pendingChanges | 변경 사항 저장 대기 중 | Changes waiting to be saved
    conflictStatus | 다른 기기에서 수정됨 · 눌러서 해결 | Changed on another device · Click to resolve
    pendingError | 클라우드 저장 대기 · {error} | Cloud save pending · {error}
    checkConnection | 연결을 확인해 주세요. | Check your connection.
    failed | 클라우드 작업을 마치지 못했어요. | Could not complete the cloud operation.
    dialogUnavailable | 앱 다이얼로그를 사용할 수 없어요. | App dialogs are unavailable.
    title | 클라우드 악보 | Cloud scores
    otherAccount | 다른 계정의 악보예요. 사본으로 저장해 주세요. | This score belongs to another account. Save a copy.
    otherProject | 다른 Supabase 프로젝트의 악보예요. 사본으로 저장해 주세요. | This score belongs to another Supabase project. Save a copy.
    uncertainSave | 저장 결과를 확인할 수 없어요. 사본으로 저장해 주세요. | Could not verify the save result. Save a copy.
    noVersion | 마지막 저장 시각이 없어 덮어쓸 수 없어요. | Cannot overwrite without the last save time.
    changedOrDeleted | 다른 기기에서 수정되었거나 삭제된 악보예요. | This score was changed or deleted on another device.
    conflictMessage | 다른 기기에서 수정되었거나 삭제된 악보예요. 현재 내용으로 덮어쓸까요? 취소하면 다른 이름으로 저장할 수 있어요. | This score was changed or deleted on another device. Overwrite it with the current content? Cancel to save under another name.
    conflictTitle | 클라우드 저장 충돌 | Cloud save conflict
    overwrite | 덮어쓰기 | Overwrite
    saveAs | 다른 이름으로 저장 | Save as
    copyName | 사본 이름을 입력해 주세요. 취소하면 현재 악보를 그대로 유지해요. | Enter a name for the copy. Cancel to keep the current score.
    cancelled | 저장을 취소했어요. 현재 악보는 그대로 있어요. | Save cancelled. Your current score is unchanged.
    offlinePending | 오프라인 · 최신 악보 저장 대기 중 | Offline · Latest score waiting to be saved
    saving | 클라우드에 저장 중… | Saving to cloud…
    unsaved | 클라우드에 저장하지 않은 변경 사항 | Changes not saved to cloud
    sharedReadOnly | 공유 악보 · 읽기 전용 | Shared score · Read-only
    pending | 클라우드 저장 대기 중 | Cloud save pending
    ready | 클라우드 저장 준비 | Cloud storage ready
    invalidScore | 악보 데이터 형식이 올바르지 않아요. | Invalid score data format.
    notFound | 악보가 없거나 열 권한이 없어요. | Score not found or access denied.
    configRequired | 공유 악보를 열려면 Supabase 연결 설정이 필요해요. | Configure the Supabase connection to open shared scores.
    shareUnavailable | 공유가 중지되었거나 삭제된 악보예요. | Sharing has been disabled or the score was deleted.
    openUnavailable | 악보 열기 연결이 준비되지 않았어요. | The score-opening integration is not ready.
    openConfirm | 현재 악보의 변경 사항을 남겨 두려면 먼저 저장해 주세요. 선택한 악보를 열까요? | Save first if you want to keep changes to the current score. Open the selected score?
    openTitle | 악보 열기 | Open score
    copyDone | 로컬 사본을 만들었어요. 이제 편집할 수 있어요. | Local copy created. You can now edit it.
    refreshRequired | 악보 목록을 새로 불러온 뒤 다시 시도해 주세요. | Refresh the score list and try again.
    changedRefresh | 다른 기기에서 수정되었어요. 목록을 새로 불러와 주세요. | Changed on another device. Refresh the list.
    alreadyDeleted | 다른 기기에서 수정되었거나 이미 삭제된 악보예요. | Changed on another device or already deleted.
    deletedStatus | 클라우드에서 삭제됨 · 로컬 악보는 유지했어요 | Deleted from cloud · Local score kept
    tooManyUsers | 한 번에 회원 100명까지 조회할 수 있어요. | Up to 100 members can be queried at a time.
    shareLink | 공유 링크 | Share link
    shareHelp | 링크를 가진 사람은 로그인 없이 악보를 볼 수 있어요. 공유를 끄면 링크가 중지돼요. | Anyone with the link can view the score without signing in. Turning off sharing disables the link.
    copyLink | 링크 복사 | Copy link
    linkCopied | 공유 링크를 복사했어요. | Share link copied.
    manualCopy | 링크를 선택했어요. 복사해 주세요. | Link selected. Copy it now.
    saveBeforeShare | 온라인에서 저장을 마친 뒤 공유할 수 있어요. | Finish saving online before sharing.
    shareConfirm | 링크를 가진 누구나 이 악보를 볼 수 있도록 공유할까요? | Share this score with anyone who has the link?
    shareConfirmGeneric | 링크를 가진 누구나 악보를 볼 수 있도록 공유할까요? | Share the score with anyone who has the link?
    share | 공유 | Share
    loading | 악보를 불러오는 중… | Loading scores…
    empty | 표시할 악보가 없어요. | No scores to display.
    public | 공유 중 | Shared
    private | 비공개 | Private
    rename | 이름 바꾸기 | Rename
    namePrompt | 악보 이름을 입력해 주세요. | Enter a score name.
    shareOff | 공유 끄기 | Turn off sharing
    shareOn | 공유 켜기 | Turn on sharing
    stopSharing | 기존 공유 링크를 중지할까요? | Disable the existing share link?
    shareTitle | 악보 공유 | Share score
    deleteConfirm | “{title}” 악보를 클라우드에서 삭제할까요? | Delete “{title}” from cloud storage?
    deleteTitle | 악보 삭제 | Delete score
    myScores | 내 악보 | My scores
    search | 악보 제목 검색 | Search score titles
    queueError | 保存 대기 목록을 읽지 못했어요. 로컬 악보를 확인해 주세요. | Could not read pending saves. Check your local score.
    copyBanner | 공유 악보 · 사본 만들기 | Shared score · Make a copy
    row | {measures}마디 · {date} · {visibility} | {measures} measures · {date} · {visibility}
  `);
  group("pwa", `
    update | 새 버전 · 새로고침 | New version · Reload
    updateTitle | 새 버전 적용 | Apply new version
    saveFirst | 현재 악보를 파일로 저장한 뒤 새 버전을 적용할까요? | Save the current score to a file and apply the new version?
    saveReload | 저장 후 새로고침 | Save and reload
  `);
  // Second source scan: generated keyboard map, mobile palette, and validated dialogs.
  group("keymap", `
    save | 악보 파일 저장 | Save score file
    copy | 복사 | Copy
    cut | 잘라내기 | Cut
    selectAll | 전체 선택 | Select all
    loop | 선택 범위 반복 재생 | Loop selected range
    goTo | 마디·리허설 이동 | Go to measure / rehearsal mark
    play | 재생·일시정지 | Play / Pause
    escape | 입력 종료·정지·선택 해제 | Exit input / Stop / Clear selection
    speedy | 스피디 입력 전환 | Toggle Speedy input
    input | 입력 모드 전환 | Toggle note input
    dot | 점음표·겹점음표 순환 | Cycle dotted / double-dotted notes
    tie | 선택 음 붙임줄 | Tie selected note
    delete | 선택 음 삭제 | Delete selected note
    chordNext | 화음의 다음 음 선택 | Select next note in chord
    chordPrevious | 화음의 이전 음 선택 | Select previous note in chord
    wholeChord | 화음 전체 선택 | Select whole chord
    speedySharp | 스피디 반음 올림 | Speedy: raise a semitone
    speedyFlat | 스피디 반음 내림 | Speedy: lower a semitone
    speedyDelete | 스피디 현재 음 삭제 | Speedy: delete current note
    speedyBackspace | 스피디 이전 음 삭제 | Speedy: delete previous note
    previous | 이전 | Previous
    next | 다음 | Next
    voice | 성부 {voice} | Voice {voice}
    pitch | {pitch} 음 입력 | Enter {pitch}
    chordPitch | {pitch} 화음 쌓기 | Add {pitch} to chord
    speedyRest | 스피디 {duration} 쉼표 | Speedy: {duration} rest
    rangeDirection | 범위 {direction} | Extend selection {direction}
    octaveDirection | 옥타브·마디 {direction} | Octave / measure {direction}
  `);
  group("palette", `
    accidentals | 임시표·타이 | Accidentals / Ties
    symbols | 기호 | Symbols
    text | 텍스트 | Text
    repeats | 반복·마디 | Repeats / Measures
    repeatLayout | 반복·레이아웃 | Repeats / Layout
    trill | 트릴 | Trill
    mordent | 모르덴트 | Mordent
    turn | 턴 | Turn
    ottavaUp | 8va 옥타브 선 | 8va octave line
    ottavaDown | 8vb 옥타브 선 | 8vb octave line
    insertMeasure | 앞에 마디 삽입 | Insert measure before selection
    deleteMeasure | 선택 마디 삭제 | Delete selected measures
    measureSettingsTitle | 마디 조표·박자·음자리표 | Measure key, time signature, and clef
    measureSettings | 마디 설정 | Measure settings
    addMeasure | ＋마디 | ＋Measure
    removeMeasure | −마디 | −Measure
  `);
  group("validation", `
    goToLabel | 마디 번호 또는 r:A | Measure number or r:A
    goTo | 마디 번호 또는 r:A 형식으로 입력하세요. | Enter a measure number or use the format r:A.
    repeat | 2~8 사이 정수를 입력하세요. | Enter an integer from 2 to 8.
    tempo | 30~280 사이 정수를 입력하세요. | Enter an integer from 30 to 280.
    time | 박자는 1~32 / 1·2·4·8·16·32·64 형식으로 입력하세요. | Enter a time signature with numerator 1–32 and denominator 1, 2, 4, 8, 16, 32, or 64.
  `);
  group("uiV3", `
    languageLabel | 언어 / Language | Language
    palette | 악보 입력 팔레트 | Score input palette
    paletteGroups | 팔레트 그룹 | Palette groups
    alto | 알토 | Alto
    tenor | 테너 | Tenor
    trebleOctave | 높은음자리표 8vb | Treble clef 8vb
    bassOctave | 낮은음자리표 8vb | Bass clef 8vb
    invertedMordent | 뒤집힌 모르덴트 | Inverted mordent
    invertedTurn | 뒤집힌 턴 | Inverted turn
    segno | 세뇨 | Segno
    coda | 코다 | Coda
    cannotApply | 이 위치에서는 적용할 수 없어요. 마디 길이와 반복·조표 경계를 확인하세요. | Cannot apply here. Check measure length and repeat or key signature boundaries.
    splitMeasure | 마디 나누기 | Split measure
    pickupLength | 못갖춘마디 길이 | Pickup measure length
    fraction | 온음표 기준 분수 (예: 1/4) | Fraction of a whole note (for example, 1/4)
    positiveFraction | 양수 분수로 입력하세요. | Enter a positive fraction.
    shorterThanMeasure | 마디 길이보다 짧게 입력하세요. | Enter a duration shorter than the measure.
    pickup | 못갖춘마디 | Pickup measure
    insertAfter | 뒤에 마디 삽입 | Insert measure after selection
    deleteRange | 마디 범위 삭제 | Delete measure range
    join | 마디 합치기 | Join measures
    removePickup | 못갖춘마디 해제 | Remove pickup measure
    selectOrnament | 장식을 붙일 음표를 선택하세요. | Select notes for the ornament.
    selectOttava | 옥타브 선을 붙일 음표 범위를 선택하세요. | Select a note range for the octave line.
    ornament | 꾸밈 기호 | Ornament
    inheritMeasure | 이전 마디에서 이어받기 | Inherit from previous measure
    inheritStaff | 이전 보표에서 이어받기 | Inherit previous staff setting
    measureKey | 마디 조표 | Measure key signature
    measureClef | 마디 음자리표 | Measure clef
    measureTime | 마디 박자 | Measure time signature
    timeValidation | 박자는 1~32 / 1·2·4·8·16·32·64로 입력하세요. | Enter a time signature with numerator 1–32 and denominator 1, 2, 4, 8, 16, 32, or 64.
    jump | 다시 가기 | Jump
    repeatsAfterJump | 돌아간 뒤 반복 | Play repeats after jump
    jumpRepeats | 점프 반복 | Jump repeats
    marker | 이동 표지 | Navigation marker
    before | 앞에 삽입 | Insert before
    after | 뒤에 삽입 | Insert after
    deleteThis | 이 마디 삭제 | Delete this measure
    split | 나누기 | Split
    joinNext | 다음 마디와 합치기 | Join with next measure
    chordOrnaments | 화음·장식 | Chords / Ornaments
    selectedNote | 선택 음 | Selected note
    wholeChord | 화음 전체 | Whole chord
    trillLine | 트릴 연장선 | Trill extension line
    selectLoop | 반복 재생할 범위를 먼저 선택하세요. | Select a range to loop first.
    measureMenu | 마디 메뉴 | Measure menu
    systemBreak | 시스템 줄바꿈 | System break
    style | 조판 스타일 | Engraving style
    staffLine | 보표 선 두께 | Staff line thickness
    stem | 스템 두께 | Stem thickness
    ledger | 덧줄 길이 | Ledger line length
    notehead | 음표 머리 크기 | Notehead size
    lyricSize | 가사 크기 | Lyric size
    lyricGap | 가사 행 간격 | Lyric line spacing
    chordSize | 코드 글자 크기 | Chord text size
    firstPadding | 첫 마디 안쪽 여백 | First measure padding
    measureWidth | 최소 마디 폭 | Minimum measure width
    noteSpace | 음표 기본 간격 | Base note spacing
    durationSpace | 음길이 간격 비율 | Duration spacing ratio
    slurThickness | 이음줄 두께 | Slur thickness
    tieHeight | 붙임줄 높이 | Tie height
    restoreDefaults | 기본값 복원 | Restore defaults
    styleDefaults | 스타일 기본값 | Style defaults
    settingsGroups | 악보 설정 분류 | Score settings categories
    basic | 기본 | Basic
    styleTab | 스타일 | Style
    countIn | 예비박 | Count-in
    loop | 반복 | Loop
    playbackTime | 재생 시간 | Playback time
    viewMode | 악보 보기 방식 | Score view mode
    continuous | 연속 보기 | Continuous view
    pages | 페이지 보기 | Page view
    multiRest | 여러 마디 쉼표 | Multimeasure rests
    metadata | 악보 제목·저작자 | Score title / Credits
    measure | 마디 {measure} | Measure {measure}
    paper | {paper} {orientation} | {paper} {orientation}
  `);
  group("solfege", `
    do | 도 | Do
    re | 레 | Re
    mi | 미 | Mi
    fa | 파 | Fa
    sol | 솔 | Sol
    la | 라 | La
    si | 시 | Si
  `);
  group("export", `
    svg | SVG 내보내기 (글꼴 포함) | Export SVG (with font)
    png | PNG 내보내기 (300dpi) | Export PNG (300 dpi)
    fontError | 악보 글꼴을 불러오지 못했어요. | Could not load the score font.
    pngError | PNG 변환에 실패했어요. | PNG conversion failed.
    pngDone | 300dpi PNG를 내보냈어요. | Exported a 300 dpi PNG.
    svgDone | 글꼴을 포함한 SVG를 내보냈어요. | Exported an SVG with the font included.
    print | 인쇄 · PDF | Print · PDF
    printHelp | 인쇄 설정에서 배율 100%, 여백 없음, 머리글·바닥글 끄기를 선택하세요. PDF로 저장하면 벡터 품질로 보관할 수 있어요. | In print settings, choose 100% scale, no margins, and no headers or footers. Save as PDF to keep vector quality.
    printOpen | 인쇄 열기 | Open print dialog
    midiImport | MIDI 가져오기 | Import MIDI
    grid | 리듬 격자 | Rhythm grid
    triplets | 셋잇단음표 감지 | Detect triplets
    tracks | 가져올 트랙 | Tracks to import
    import | 가져오기 | Import
    selectTrack | 트랙을 하나 이상 선택하세요. | Select at least one track.
    customEnsemble | 현재 사용자 편성 | Current custom ensemble
    errorRecovery | 문제가 생겼어요. 마지막 자동 저장본을 확인해 주세요. | Something went wrong. Check the last auto-saved copy.
  `);
  group("import", `
    durationPreserved | 표기와 duration이 다른 음길이는 duration을 보존했어요 | Preserved durations that differ from the written note values
    unsupportedArticulation | 지원하지 않는 아티큘레이션: {name} | Unsupported articulation: {name}
    first500 | 앞 500마디만 가져왔어요 (전체 {count}마디) | Imported only the first 500 measures (out of {count})
    extraVoices | 성부가 4개를 넘어 추가 성부를 생략했어요 | Omitted voices beyond the four-voice limit
    negativeBackup | 음수 backup 위치를 마디 시작으로 보정했어요 | Moved negative backup positions to the start of the measure
    unreadablePitch | 읽을 수 없는 음높이를 생략했어요 | Omitted unreadable pitches
    overlapFour | 4성부를 넘는 겹친 음을 생략했어요 | Omitted overlapping notes beyond four voices
    unmatchedSlur | 짝이 없는 이음줄을 생략했어요 | Omitted unmatched slurs
    outOfMeasure | 마디 범위를 벗어나거나 같은 성부에서 겹친 음을 생략했어요 | Omitted notes outside the measure or overlapping in the same voice
    clippedDuration | 마디 경계를 넘는 duration을 잘랐어요 | Trimmed durations extending beyond measure boundaries
    partsSummary | {parts}개 파트 · {staves}개 보표 · {measures}마디를 가져왔어요 | Imported {parts} parts · {staves} staves · {measures} measures
    midiSummary | {parts}개 파트 · {notes}개 음표/화음을 가져왔어요 (1/{grid} 양자화) | Imported {parts} parts · {notes} notes/chords (1/{grid} quantization)
    orphanNoteOff | 트랙 {track}: 시작이 없는 note-off를 생략했어요 | Track {track}: omitted note-off without note-on
    missingNoteOff | 트랙 {track}: note-off가 없는 음을 트랙 끝에서 종료했어요 | Track {track}: ended notes without note-off at the track end
    programChanges | {name}: 곡 중간 악기 변경은 첫 악기로 통합했어요 | {name}: used the first instrument for mid-score instrument changes
    first2000 | 앞 2000마디만 가져왔어요 | Imported only the first 2000 measures
    keyAtStart | 마디 중간 조표 변경을 해당 마디 시작에 적용했어요 | Applied mid-measure key changes at the start of the measure
    overlapTwo | {name}: 두 성부를 넘는 겹친 음을 생략했어요 | {name}: omitted overlapping notes beyond two voices
    drumFallback | {name}: 드럼 {midi}의 표기는 스네어로 대체했어요 (원래 소리 유지) | {name}: used snare notation for drum {midi} (original sound kept)
    partReport | {name}: {report} | {name}: {report}
  `);
  group("error.midi", `
    truncated | 잘린 MIDI 파일이에요 | Truncated MIDI file
    variableLength | MIDI 가변 길이 값이 너무 길어요 | MIDI variable-length value is too long
    notMidi | MIDI 파일이 아니에요 | Not a MIDI file
    header | MIDI 헤더가 올바르지 않아요 | Invalid MIDI header
    format | SMF type 0/1만 지원해요 | Only SMF type 0/1 is supported
    smpte | SMPTE 시간 기반 MIDI는 지원하지 않아요 (PPQ로 변환해 주세요) | SMPTE-based MIDI timing is unsupported (convert to PPQ)
    ppq | MIDI PPQ가 0이에요 | MIDI PPQ is zero
    runningStatus | MIDI running status가 올바르지 않아요 | Invalid MIDI running status
    systemMessage | 지원하지 않는 MIDI 시스템 메시지예요 | Unsupported MIDI system message
    dataByte | MIDI 데이터 바이트가 올바르지 않아요 | Invalid MIDI data byte
    noNotes | 선택한 MIDI 트랙에 음표가 없어요 | No notes in the selected MIDI tracks
  `);
  group("recent", `
    shortcutHint | 키를 누르면 해당 동작이 반짝여요. 악보는 편집되지 않아요. | Press a key to highlight its action. The score will not be edited.
    publishableOnly | 브라우저에는 publishable key 또는 anon key만 저장할 수 있어요. | Only a publishable key or anon key can be stored in the browser.
    cloudCopyName | 클라우드 사본 이름 | Cloud copy name
    cloudScoreName | 클라우드 악보 이름 | Cloud score name
    queueError | 저장 대기 목록을 읽지 못했어요. 로컬 악보를 확인해 주세요. | Could not read pending saves. Check your local score.
    chordDelete | 화음의 음 삭제 | Delete note from chord
    singleTie | 개별 음 타이 | Tie individual note
    midiInput | MIDI 입력 | MIDI input
    frequentInput | 자주 쓰는 입력 | Frequent input tools
  `);
  STRINGS.ko["toast.openErrorDetail"] = "열 수 없어요: {name} — {error}";
  STRINGS.en["toast.openErrorDetail"] = "Cannot open: {name} — {error}";
  group("a11y", `
    score | 악보: {title}, {measures}마디 | Score: {title}, {measures} measures
    scoreSummary | {title} · {measures}마디 | {title} · {measures} measures
  `);

  const STORAGE_KEY = "scoreforge-language";
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const normalize = value => String(value).replace(/\s+/g, " ").trim();
  const korean = /[가-힣]/;
  const unknownKeys = new Set();
  const unknownMessages = new Set();
  const listeners = new Set();
  let language = null;
  let documentRoot = null;
  let observer = null;
  let decorating = false;
  let selector = null;
  const textRecords = new WeakMap();
  const attributeRecords = new WeakMap();
  const generatedTags = new WeakMap();
  const exact = { ko: new Map(), en: new Map() };
  for (const locale of ["ko", "en"]) {
    for (const [key, value] of Object.entries(STRINGS[locale])) {
      if (!/\{\w+\}/.test(value) && !exact[locale].has(normalize(value))) exact[locale].set(normalize(value), key);
    }
  }
  function supported(value) {
    const base = String(value || "").toLowerCase().split(/[-_]/)[0];
    return base === "en" || base === "ko" ? base : null;
  }
  function getLanguage() {
    if (!language) {
      try { language = supported(host.localStorage?.getItem(STORAGE_KEY)); } catch { /* Private mode/storage denied. */ }
      if (!language) {
        const nav = host.navigator;
        language = supported(nav?.language) || (nav?.languages || []).map(supported).find(Boolean) || "ko";
      }
    }
    return language;
  }
  function t(key, vars) {
    key = String(key);
    const locale = getLanguage();
    let value = own(STRINGS[locale], key) ? STRINGS[locale][key] : STRINGS.ko[key];
    if (typeof value !== "string") {
      if (!unknownKeys.has(key)) {
        unknownKeys.add(key);
        host.console?.warn?.("[ScoreForge i18n] Unknown key: " + key);
      }
      return key;
    }
    return value.replace(/\{(\w+)\}/g, (placeholder, name) => vars && own(vars, name) ? String(vars[name]) : placeholder);
  }
  const entry = (key, vars = {}, locale = "ko") => ({ key, vars, locale });
  // Nested entries represent UI grammar only. Captured user values stay plain strings.
  function render(match) {
    const vars = {};
    for (const [key, value] of Object.entries(match.vars || {})) vars[key] = value && typeof value === "object" && own(value, "key") ? render(value) : value;
    return t(match.key, vars);
  }
  const patterns = [];
  function pattern(key, koPattern, names, nested = []) {
    patterns.push({ key, expression: koPattern, names, nested });
  }
  pattern("toast.loaded", /^"([\s\S]*)" 불러왔어요$/, ["title"]);
  pattern("toast.copied", /^(\d+)개를 복사했어요$/, ["count"]);
  pattern("toast.pasted", /^(\d+)개를 붙여넣었어요$/, ["count"]);
  pattern("toast.transposeUp", /^(\d+)반음 올렸어요$/, ["count"]);
  pattern("toast.transposeDown", /^(\d+)반음 내렸어요$/, ["count"]);
  pattern("toast.tuplet", /^(\d+)잇단음표로 나눴어요$/, ["count"]);
  pattern("toast.repeat", /^(\d+)번 반복으로 설정했어요$/, ["count"]);
  pattern("toast.ending", /^(\d+)번 엔딩을 표시했어요$/, ["count"]);
  pattern("toast.tempo", /^템포 ♩=(\d+)$/, ["tempo"]);
  pattern("toast.rehearsal", /^리허설 ([\s\S]+)$/, ["text"]);
  pattern("toast.theme", /^(Dark|Light|Pretty|Cute)(?: UI)?로 전환했어요$/, ["theme"]);
  pattern("toast.openError", /^열 수 없어요: ([\s\S]*)$/, ["name"]);
  pattern("status.selected", /^(\d+)개 선택$/, ["count"]);
  pattern("status.selectionHint", /^(\d+)개 선택 — Ctrl\+C\/V=복사\/붙여넣기 · S=이음줄 · < >=쐐기$/, ["count"]);
  pattern("hint.held", /^건반 (\d+)개 누름 — 숫자로 입력 · 1~8=입력 · 0=쉼표 · Esc=종료$/, ["count"]);
  pattern("status.verseLyrics", /^(\d+)절 가사$/, ["verse"]);
  pattern("status.verse", /^(\d+)절$/, ["verse"]);
  pattern("status.chord", /^코드 ([\s\S]+)$/, ["symbol"]);
  pattern("history.tuplet", /^(\d+)잇단음표$/, ["count"]);
  pattern("history.ending", /^(\d+)번 엔딩$/, ["count"]);
  pattern("history.undo", /^실행 취소: ([\s\S]+)$/, ["action"], ["action"]);
  pattern("history.redo", /^다시 실행: ([\s\S]+)$/, ["action"], ["action"]);
  pattern("import.summary", /^"([\s\S]*)" — (\d+)마디를 가져왔어요\.\s*아래 항목은 이 앱이 지원하는 범위로 줄이면서 바뀌거나 무시됐어요\.$/, ["title", "measures"]);
  pattern("import.firstPart", /^파트 (\d+)개 중 첫 번째만 가져왔어요$/, ["count"]);
  pattern("import.tooManyMeasures", /^마디가 많아 앞 500마디만 가져왔어요 \(전체 (\d+)마디\)$/, ["count"]);
  pattern("import.counted", /^([\s\S]+) \((\d+)건\)$/, ["message", "count"], ["message"]);
  pattern("auth.adminStatus", /^([^\s]+@[^\s]+) · 관리자$/, ["email"]);
  pattern("auth.memberStatus", /^([^\s]+@[^\s]+) · 회원$/, ["email"]);
  pattern("auth.configSuffix", /^([\s\S]+) 먼저 Supabase 연결 정보를 저장하세요\.$/, ["message"], ["message"]);
  pattern("auth.membersFailed", /^회원 목록을 불러오지 못했어요\. ([\s\S]*)$/, ["error"], ["error"]);
  pattern("cloud.saved", /^클라우드 저장됨 ([\s\S]+)$/, ["time"]);
  pattern("cloud.pendingError", /^클라우드 저장 대기 · ([\s\S]*)$/, ["error"], ["error"]);
  pattern("cloud.deleteConfirm", /^“([\s\S]*)” 악보를 클라우드에서 삭제할까요\?$/, ["title"]);
  pattern("cloud.row", /^(\d+)마디 · ([\s\S]+) · (공유 중|비공개)$/, ["measures", "date", "visibility"], ["visibility"]);
  pattern("status.sampleInstrumentLoading", /^([\s\S]+) 샘플을 불러오는 중입니다\.$/, ["instrument"], ["instrument"]);
  pattern("status.sampleInstrumentReady", /^([\s\S]+) 샘플 음원 준비 완료$/, ["instrument"], ["instrument"]);
  pattern("keymap.voice", /^성부 ([1-4])$/, ["voice"]);
  pattern("keymap.pitch", /^([A-G]) 음 입력$/, ["pitch"]);
  pattern("keymap.chordPitch", /^([A-G]) 화음 쌓기$/, ["pitch"]);
  pattern("keymap.speedyRest", /^스피디 (.+) 쉼표$/, ["duration"], ["duration"]);
  pattern("keymap.rangeDirection", /^범위 (위|아래|이전|다음)$/, ["direction"], ["direction"]);
  pattern("keymap.octaveDirection", /^옥타브·마디 (위|아래|이전|다음)$/, ["direction"], ["direction"]);
  pattern("uiV3.measure", /^마디 (\d+)$/, ["measure"]);
  pattern("uiV3.paper", /^(A4|Letter) (세로|가로)$/, ["paper", "orientation"], ["orientation"]);
  pattern("import.unsupportedArticulation", /^지원하지 않는 아티큘레이션: ([\w:.-]+)$/, ["name"]);
  pattern("import.first500", /^앞 500마디만 가져왔어요 \(전체 (\d+)마디\)$/, ["count"]);
  pattern("import.partsSummary", /^(\d+)개 파트 · (\d+)개 보표 · (\d+)마디를 가져왔어요$/, ["parts", "staves", "measures"]);
  pattern("import.midiSummary", /^(\d+)개 파트 · (\d+)개 음표\/화음을 가져왔어요 \(1\/(\d+) 양자화\)$/, ["parts", "notes", "grid"]);
  pattern("import.orphanNoteOff", /^트랙 (\d+): 시작이 없는 note-off를 생략했어요$/, ["track"]);
  pattern("import.missingNoteOff", /^트랙 (\d+): note-off가 없는 음을 트랙 끝에서 종료했어요$/, ["track"]);
  pattern("import.programChanges", /^([\s\S]*): 곡 중간 악기 변경은 첫 악기로 통합했어요$/, ["name"]);
  pattern("import.overlapTwo", /^([\s\S]*): 두 성부를 넘는 겹친 음을 생략했어요$/, ["name"]);
  pattern("import.drumFallback", /^([\s\S]*): 드럼 (\d+)의 표기는 스네어로 대체했어요 \(원래 소리 유지\)$/, ["name", "midi"]);

  // Messages may arrive pretranslated by the toast adapter. Recognize only the
  // English forms of our approved templates, so existing panels remain reversible.
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reversePatterns = patterns.filter(rule => rule.key !== "uiV3.paper").map(rule => {
    const names = [];
    const template = STRINGS.en[rule.key];
    let offset = 0, expression = "^";
    for (const match of template.matchAll(/\{(\w+)\}/g)) {
      expression += escapeRegExp(template.slice(offset, match.index));
      names.push(match[1]);
      expression += /^(count|voice|verse|measures|tempo|parts|staves|notes|grid|track|midi)$/.test(match[1]) ? "(\\d+)" : "([\\s\\S]*?)";
      offset = match.index + match[0].length;
    }
    expression += escapeRegExp(template.slice(offset)) + "$";
    return { ...rule, names, expression: new RegExp(expression), locale: "en" };
  });
  reversePatterns.push({ key: "uiV3.paper", expression: /^(A4|Letter) (Portrait|Landscape)$/, names: ["paper", "orientation"], nested: ["orientation"], locale: "en" });

  // Duration syntax is intentionally limited to known note lengths; it never scans user prose.
  function duration(value) {
    const key = exact.ko.get(normalize(value));
    if (key?.startsWith("duration.")) return entry(key);
    let match = /^(\d+)잇단 (.+)$/.exec(value);
    if (match) { const inner = duration(match[2]); return inner && entry("duration.tuplet", { count: match[1], duration: inner }); }
    match = /^(겹점|점)(.+)$/.exec(value);
    if (match) { const inner = duration(match[2]); return inner && entry(match[1] === "겹점" ? "duration.doubleDotted" : "duration.dotted", { duration: inner }); }
    match = /^(.+) 쉼표$/.exec(value);
    if (match) { const inner = duration(match[1]); return inner && entry("duration.rest", { duration: inner }); }
    return null;
  }
  function resolve(value, depth = 0) {
    if (typeof value !== "string" || depth > 6) return null;
    const normalized = normalize(value);
    const koKey = exact.ko.get(normalized);
    const key = koKey || exact.en.get(normalized);
    if (key) return entry(key, {}, koKey ? "ko" : "en");
    const text = value.trim();
    const dur = duration(text);
    if (dur) return dur;
    if (text.startsWith("열 수 없어요: ")) {
      const separator = text.lastIndexOf(" — ");
      const error = separator >= 0 && resolve(text.slice(separator + 3), depth + 1);
      if (error && /^(error\.|auth\.|cloud\.)/.test(error.key)) return entry("toast.openErrorDetail", { name: text.slice("열 수 없어요: ".length, separator), error });
    }
    // The selection suffix is removed before parsing its UI prefix. User details are opaque.
    let match = /^([\s\S]+) · 화음 (\d+)번째 음$/.exec(text);
    if (match) {
      const status = resolve(match[1], depth + 1);
      if (status) return entry("status.chordNote", { status, index: match[2] });
    }
    match = /^(\d+)마디 · (\d+)보표 · (.+) · (\d+\/\d+)$/.exec(text);
    if (match) return entry("status.overview", { measures: match[1], staves: match[2], key: resolve(match[3], depth + 1) || match[3], time: match[4] });
    match = /^입력 위치: ([\s\S]+) · V([1-4]) · 마디 (\d+) · (.+)로 입력$/.exec(text);
    if (match && duration(match[4])) return entry("status.input", { name: match[1], voice: match[2], measure: match[3], duration: duration(match[4]) });
    match = /^스피디: ([\s\S]+) · 마디 (\d+) · 크로스헤어 ([\s\S]+)$/.exec(text);
    if (match) return entry("status.speedy", { name: match[1], measure: match[2], pitch: match[3] });
    match = /^([\s\S]+?) · V([1-4]) · 마디 (\d+)(?: · ([\s\S]+))?$/.exec(text);
    if (match) {
      const position = entry("status.position", { name: match[1], voice: match[2], measure: match[3] });
      if (!match[4]) return position;
      const split = match[4].indexOf(" · ");
      const length = split < 0 ? match[4] : match[4].slice(0, split);
      const parsed = duration(length);
      if (parsed) return split < 0 ? entry("ui.join", { first: position, separator: " · ", second: parsed }) : entry("status.note", { position, duration: parsed, details: match[4].slice(split + 3) });
    }
    // A report's part/track name can contain punctuation and Korean UI words.
    // Only a suffix consisting entirely of approved report entries is translated.
    if (/\(\d+(?:건| occurrences)\)$/.test(text)) {
      for (let colon = text.lastIndexOf(": "); colon >= 0; colon = text.lastIndexOf(": ", colon - 1)) {
        const reports = text.slice(colon + 2).split("; ").map(report => resolve(report, depth + 1));
        if (reports.every(report => report?.key === "import.counted" && report.vars.message?.key?.startsWith("import."))) {
          const report = reports.reduce((first, second) => first ? entry("ui.join", { first, separator: "; ", second }) : second, null);
          return entry("import.partReport", { name: text.slice(0, colon), report }, reports[0].locale);
        }
        if (colon === 0) break;
      }
    }
    // Resolve shortcut suffixes before message templates such as "코드 {symbol}".
    match = /^(.+?)\s+(\((?:Ctrl|Alt|Shift|Esc|Delete|F\d|[A-Z0-9./])[^가-힣]*\))$/.exec(text);
    if (match) {
      const label = resolve(match[1], depth + 1);
      if (label) return entry("ui.shortcut", { label, shortcut: match[2] }, label.locale);
    }
    for (const rule of [...patterns, ...reversePatterns]) {
      const result = rule.expression.exec(text);
      if (!result) continue;
      const vars = {};
      rule.names.forEach((name, index) => { vars[name] = rule.nested.includes(name) ? resolve(result[index + 1], depth + 1) || result[index + 1] : result[index + 1]; });
      return entry(rule.key, vars, rule.locale || "ko");
    }
    return null;
  }
  // These composition entries are not literal replacements and have no ambiguous global regex.
  STRINGS.ko["ui.shortcut"] = STRINGS.en["ui.shortcut"] = "{label} {shortcut}";
  STRINGS.ko["ui.join"] = STRINGS.en["ui.join"] = "{first}{separator}{second}";
  function rememberMessage(message) {
    if (korean.test(message) && unknownMessages.size < 500) unknownMessages.add(message);
  }
  function translate(message) {
    if (typeof message !== "string") return message;
    const match = resolve(message);
    if (!match) { rememberMessage(message); return message; }
    if (getLanguage() === "ko") return message;
    const leading = message.match(/^\s*/)[0];
    const trailing = message.match(/\s*$/)[0];
    return leading + render(match) + trailing;
  }

  const ATTRIBUTES = ["title", "aria-label", "aria-description", "aria-valuetext", "placeholder", "alt"];
  const SKIP = [
    "script", "style", "svg", "math", "code", "pre", "textarea",
    "[contenteditable]:not([contenteditable='false'])", "[data-i18n-skip]", "[data-user-content]", "[translate='no']",
    ".user-content", ".user-text", ".score-content", ".score-title", ".score-subtitle", ".score-composer", ".score-lyrics", ".part-name", ".staff-name", ".lyric", ".lyrics",
    "#svg-host", "#t-title", "#t-composer", "#t-subtitle", "#t-lyricist", "#t-copyright",
    "#staff-select option", "#view-select option:not([value='full'])", "#midi-select option[value]:not([value=''])",
    "#chord-note-select option:not([value=''])",
    "#dlg-midi-import form > p:not([role='alert'])", "#dlg-midi-import fieldset label",
    ".mixer-row > b", ".cloud-score-row > strong", "#admin-users tbody", "#admin-summary .admin-stat > b"
  ].join(",");
  function isSkipped(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    return !!element?.closest?.(SKIP);
  }
  function readVars(element) {
    try {
      const vars = JSON.parse(element.getAttribute("data-i18n-vars") || "{}");
      return vars && typeof vars === "object" && !Array.isArray(vars) ? vars : {};
    } catch { return {}; }
  }
  function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  function automaticTag(element, attribute, match) {
    // Generated static tags are safe to copy back into HTML or clone. Templates
    // keep their variables in the WeakMap, rather than emitting incomplete tags.
    if (match && Object.keys(match.vars || {}).length) match = null;
    let tags = generatedTags.get(element);
    if (!tags) { tags = new Map(); generatedTags.set(element, tags); }
    const tag = attribute ? "data-i18n-" + attribute : "data-i18n";
    // Never overwrite a tag provided by the UI author.
    if (element.hasAttribute(tag) && !tags.has(tag)) return;
    if (match) { tags.set(tag, match.key); setAttribute(element, tag, match.key); }
    else if (tags.has(tag)) { tags.delete(tag); element.removeAttribute(tag); }
  }
  function explicitKey(element, tag) {
    const key = element.getAttribute(tag);
    // An author can replace an automatically generated tag with an explicit key.
    return key && generatedTags.get(element)?.get(tag) !== key ? key : null;
  }
  function translateRecord(current, previous, explicit, vars) {
    if (explicit) return { original: current, last: t(explicit, vars), match: entry(explicit, vars) };
    // Keep the Korean source while our own English output is still present.
    let record = previous && current === previous.last ? previous : null;
    if (!record) {
      const match = resolve(current);
      if (!match) return null;
      record = { original: current, match, sourceKorean: match.locale !== "en", leading: current.match(/^\s*/)[0], trailing: current.match(/\s*$/)[0] };
    }
    record.last = getLanguage() === "ko" && record.sourceKorean ? record.original : (record.leading || "") + render(record.match) + (record.trailing || "");
    return record;
  }
  function decorateText(node) {
    const parent = node.parentElement;
    if (!parent || isSkipped(node) || parent.tagName === "INPUT") return;
    const leaf = !parent.children.length && parent.childNodes.length === 1;
    const explicit = leaf && explicitKey(parent, "data-i18n");
    const current = node.nodeValue;
    if (!current.trim() && !explicit) return;
    const record = translateRecord(current, textRecords.get(node), explicit, readVars(parent));
    if (record) {
      // An option without a value attribute otherwise changes its effective value
      // when its display text changes. Freeze that original value first.
      if (parent.tagName === "OPTION" && !parent.hasAttribute("value")) setAttribute(parent, "value", parent.value);
      textRecords.set(node, record);
      if (!explicit && leaf) automaticTag(parent, null, record.match);
      if (node.nodeValue !== record.last) node.nodeValue = record.last;
    } else {
      textRecords.delete(node);
      if (leaf) automaticTag(parent, null, null);
    }
  }
  function decorateElement(element) {
    if (isSkipped(element)) return;
    let records = attributeRecords.get(element);
    if (!records) { records = new Map(); attributeRecords.set(element, records); }
    for (const attribute of ATTRIBUTES) {
      const tag = "data-i18n-" + attribute;
      const explicit = explicitKey(element, tag);
      const current = element.getAttribute(attribute);
      if (current === null && !explicit) { records.delete(attribute); continue; }
      const record = translateRecord(current || "", records.get(attribute), explicit, readVars(element));
      if (record) {
        records.set(attribute, record);
        if (!explicit) automaticTag(element, attribute, record.match);
        setAttribute(element, attribute, record.last);
      } else { records.delete(attribute); automaticTag(element, attribute, null); }
    }
    // Explicit text keys target text-only elements. Never destroy icons, controls, or spans.
    const key = explicitKey(element, "data-i18n");
    if (key && !element.children.length && element.tagName !== "INPUT" && !element.childNodes.length) element.textContent = t(key, readVars(element));
    if (element.id === "language-select") bindSelector(element);
  }
  function scan(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || isSkipped(node)) continue;
      if (node.nodeType === 3) { decorateText(node); continue; }
      if (node.nodeType === 1) decorateElement(node);
      if (node.childNodes) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
  }
  function mutationRoots(records) {
    const roots = new Set();
    for (const record of records) {
      if (isSkipped(record.target)) continue;
      if (record.type === "childList") {
        for (const node of record.addedNodes) roots.add(node);
      } else roots.add(record.target);
    }
    return roots;
  }
  function observe() {
    if (!observer || !documentRoot) return;
    observer.observe(documentRoot, { childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: [...ATTRIBUTES, "data-i18n", "data-i18n-vars", ...ATTRIBUTES.map(name => "data-i18n-" + name)] });
  }
  function decorate(root) {
    root = root || documentRoot || host.document?.documentElement;
    if (!root || decorating) return root;
    const pending = observer ? mutationRoots(observer.takeRecords()) : new Set();
    observer?.disconnect();
    decorating = true;
    try { scan(root); for (const node of pending) if (node.isConnected && !root.contains?.(node)) scan(node); }
    finally { decorating = false; observe(); }
    return root;
  }
  function onMutations(records) {
    // Disconnect while writing so our own changes never schedule another observer pass.
    observer.disconnect();
    decorating = true;
    try { for (const node of mutationRoots(records)) if (node.isConnected) scan(node); }
    finally { decorating = false; observe(); }
  }
  function selectorChanged(event) { setLanguage(event.target.value); }
  function bindSelector(element) {
    if (selector !== element) {
      selector?.removeEventListener("change", selectorChanged);
      selector = element;
      selector.addEventListener("change", selectorChanged);
    }
    selector.value = getLanguage();
    if (!selector.hasAttribute("aria-label")) setAttribute(selector, "data-i18n-aria-label", "app.chooseLanguage");
    if (selector.getAttribute("data-i18n-aria-label") === "app.chooseLanguage") setAttribute(selector, "aria-label", t("app.chooseLanguage"));
  }
  function setLanguage(value, options = {}) {
    const previous = getLanguage();
    language = supported(value) || "ko";
    if (options.persist !== false) try { host.localStorage?.setItem(STORAGE_KEY, language); } catch { /* Usable even if storage is blocked. */ }
    if (documentRoot) {
      const doc = documentRoot.ownerDocument || (documentRoot.nodeType === 9 ? documentRoot : host.document);
      if (doc?.documentElement) setAttribute(doc.documentElement, "lang", language);
      decorate(documentRoot);
    }
    if (selector) selector.value = language;
    if (previous !== language) {
      for (const listener of listeners) listener(language, previous);
      if (typeof host.CustomEvent === "function" && host.dispatchEvent) host.dispatchEvent(new host.CustomEvent("scoreforge:language", { detail: { language, previousLanguage: previous } }));
    }
    return language;
  }
  function init(options = {}) {
    if (options?.nodeType) options = { root: options };
    const root = options.root || host.document?.documentElement;
    if (!root) { if (options.language) setLanguage(options.language); return SF.i18n; }
    if (root !== documentRoot) { observer?.disconnect(); documentRoot = root; }
    if (!observer && typeof host.MutationObserver === "function") observer = new host.MutationObserver(onMutations);
    setLanguage(options.language || getLanguage(), { persist: !!options.language });
    observe();
    return SF.i18n;
  }
  function disconnect() {
    observer?.disconnect(); observer = null; documentRoot = null;
    selector?.removeEventListener("change", selectorChanged); selector = null;
  }
  function locationOf(element) {
    return element ? (element.id ? "#" + element.id : element.tagName.toLowerCase() + (element.className && typeof element.className === "string" ? "." + element.className.trim().replace(/\s+/g, ".") : "")) : "";
  }
  function audit(root) {
    root = root || documentRoot || host.document?.documentElement;
    const untranslated = [];
    const preservedValues = [];
    function inspect(element, attribute, message) {
      const known = resolve(message);
      const item = { location: locationOf(element), attribute, message: message.trim(), key: known?.key || null };
      // A translated sentence may intentionally contain a Korean title or name.
      if (getLanguage() === "en" && known && normalize(render(known)) === normalize(message)) preservedValues.push(item);
      else untranslated.push(item);
    }
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop();
      if (isSkipped(node)) continue;
      if (node.nodeType === 3 && korean.test(node.nodeValue)) {
        inspect(node.parentElement, "text", node.nodeValue);
      } else if (node.nodeType === 1) {
        for (const name of ATTRIBUTES) {
          const value = node.getAttribute(name);
          if (value && korean.test(value)) inspect(node, name, value);
        }
      }
      if (node.childNodes) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
    return { language: getLanguage(), unknownKeys: [...unknownKeys], missingEnglish: Object.keys(STRINGS.ko).filter(key => !own(STRINGS.en, key)), pendingMessages: [...unknownMessages], untranslated, preservedValues };
  }
  SF.t = t;
  SF.i18n = {
    STRINGS, strings: STRINGS, STORAGE_KEY, init, decorate, translate, setLanguage, getLanguage,
    setLang: setLanguage, getLang: getLanguage, disconnect, audit,
    // lookup is read-only and never warns; semantic keys belong in SF.t, literals in translate.
    lookup: resolve,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    clearAudit() { unknownKeys.clear(); unknownMessages.clear(); },
    get language() { return getLanguage(); },
    get lang() { return getLanguage(); },
    get pendingKeys() { return [...unknownKeys]; },
    get pendingMessages() { return [...unknownMessages]; }
  };
})(typeof window !== "undefined" ? window : globalThis);
