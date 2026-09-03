# Baseline Architecture

Commit: 20a188a

Static IIFEs: app -> engrave / playback / io -> core.

## SF.core

durBase, durValue, durEq, durName, decompose, BASES, tupletNormalFor, tupletWrittenDur, tupletMeta, midiOf, absStep, pitchEq, keyAlterFor, spellMidi, transposePitch, pitchName, parseChordSymbol, normalizeChordSymbol, displayChordSymbol, cloneChordSymbol, lyricsOf, cloneLyrics, setLyric, normalizeEventLyrics, STEP_EN, STEP_KO, STEP_SEMIS, KEY_NAMES, CLEFS, DRUM_MAP, drumSpec, GUITAR_STANDARD_TUNING, midiToStringFret, stringFretToMidi, applyTabToEvent, FRETBOARD_LIBRARY, getDefaultFretboard, SOUND_FLAGS, detectSoundFlag, keySigSteps, beamGroups, beatLen, PART_LIBRARY, ENSEMBLES, createScore, measureLen, fullRest, newId, DEFAULT_LAYOUT, ensureLayout, pageSizeDefaults, VOICE_COUNT, normalizeVoice, ensureMeasureVoices, getVoiceEvents, measureEntries, forEachEvent, voiceIsEmpty, hasVisibleContent, ensureParts, ensureMeasureMeta, staffRefs, visibleStaffRefs, isStaffEmpty, staffRef, staffMeasures, activeRef, activeClef, isPercussionRef, setActiveStaff, ensembleKey, applyEnsemble, toggleStartRepeat, toggleEndRepeat, setRepeatCount, setEnding, clearEndings, setMeasureBreak, clearMeasureBreak, eventStartTick, findEvent, nextEvent, prevEvent, replaceRange, inputAt, addDrumNote, deleteEvent, makeTupletAt, consolidateRests, normalizeTies, isTiedFrom, addGraceBefore, findGrace, cloneGraceList, eventOrderMap, normalizeSpanners, slurCoverMap, rebar, transposeScore, toJSON, fromJSON, state, mutate, undo, redo, canUndo, canRedo, resetHistory, setScore, onChange

## SF.engrave

SP, PAGE_W, MARGIN, STAFF_H, pageMetrics, pageWidth, loadFont, isFontReady, layout, render, hitTest, yForStep, stepForY, drawGhost, drawInputCursor, drawSpeedy, clearOverlays, iconNote, iconRest, iconAcc, getLayout

## SF.playback

INSTRUMENTS, audio, play, stop, previewNote, pausePos, player, compile, exportMidi, getSampleStatus, setSampleStatusHandler, ensureSampleInstrument, buildPlaybackPlan

## SF.io

download, saveJSON, openJSON, safeName, autosave, loadAutosave, clearAutosave, exportMusicXML, buildDemo, DEMOS, parseMusicXML, readMxl, openScoreDialog, loadScoreFile

## SF.app

ui, update, toast, auth

## Mutation / update callers

- app.js:112 update: function update(opts = {}) {
- app.js:192 setCurrentVoice: update();
- app.js:358 pasteClipboard: C.mutate("붙여넣기", (s2) => {
- app.js:385 pasteClipboard: update();
- app.js:393 doInput: C.mutate(pitches ? "음표 입력" : "쉼표 입력", (score) => {
- app.js:408 doInput: update();
- app.js:434 inputDrum: C.mutate("드럼 입력", (score) => {
- app.js:443 inputDrum: update();
- app.js:530 doSpeedyInput: C.mutate(pitches ? "스피디 입력" : "스피디 쉼표", (s2) => {
- app.js:548 doSpeedyInput: update();
- app.js:563 toggleSpeedyDot: C.mutate("스피디 점음표", (score) => {
- app.js:571 toggleSpeedyDot: update();
- app.js:578 addSpeedyChordTone: C.mutate("스피디 화음 추가", (score) => {
- app.js:590 addSpeedyChordTone: update();
- app.js:596 speedyDeleteAt: C.mutate("스피디 지우기", (score) => {
- app.js:604 speedyDeleteAt: update();
- app.js:647 select: update();
- app.js:705 setDuration: C.mutate("음길이 변경", (score) => {
- app.js:734 setDuration: update();
- app.js:754 toggleDot: C.mutate("점음표", (score) => {
- app.js:767 toggleDot: update();
- app.js:778 applyAccidental: C.mutate("임시표", (score) => {
- app.js:786 applyAccidental: update();
- app.js:792 transposeSelection: C.mutate("음높이 변경", (score) => {
- app.js:806 transposeSelection: update();
- app.js:812 deleteSelection: C.mutate("범위 삭제", (score) => {
- app.js:819 deleteSelection: update();
- app.js:824 deleteSelection: C.mutate("삭제", (score) => {
- app.js:829 deleteSelection: update();
- app.js:837 repitchSelection: C.mutate("음높이 재지정", (score) => {
- app.js:845 repitchSelection: update();
- app.js:857 toggleTie: C.mutate("타이", (s2) => {
- app.js:867 toggleTie: C.mutate("타이", (s2) => {
- app.js:877 toggleTie: update();
- app.js:892 applyArticulation: C.mutate("아티큘레이션", (score) => {
- app.js:901 applyArticulation: update();
- app.js:915 applyDynamic: C.mutate("셈여림", (score) => {
- app.js:921 applyDynamic: update();
- app.js:940 toggleSlur: C.mutate("이음줄", (s2) => {
- app.js:946 toggleSlur: update();
- app.js:958 toggleHairpin: C.mutate(type === "cresc" ? "크레셴도" : "디미누엔도", (s2) => {
- app.js:964 toggleHairpin: update();
- app.js:974 applyTuplet: C.mutate(`${actual}잇단음표`, (score) => {
- app.js:986 applyTuplet: update();
- app.js:989 applyTuplet: update();
- app.js:1000 applyGraceBefore: C.mutate("꾸밈음", (score) => {
- app.js:1004 applyGraceBefore: update();
- app.js:1012 toggleNotation: C.mutate("고급 기보", (score) => {
- app.js:1021 toggleNotation: update();
- app.js:1046 applyStartRepeat: C.mutate("시작 반복", score => C.toggleStartRepeat(score, range.from));
- app.js:1047 applyStartRepeat: update();
- app.js:1053 applyEndRepeat: C.mutate("끝 반복", score => C.toggleEndRepeat(score, range.to));
- app.js:1054 applyEndRepeat: update();
- app.js:1064 applyRepeatCount: C.mutate("반복 횟수", score => C.setRepeatCount(score, range.to, count));
- app.js:1065 applyRepeatCount: update(); toast(`${count}번 반복으로 설정했어요`);
- app.js:1071 applyVolta: C.mutate(`${label}번 엔딩`, score => C.setEnding(score, range.from, range.to, label));
- app.js:1072 applyVolta: update(); toast(`${label}번 엔딩을 표시했어요`);
- app.js:1079 applyChordSymbol: update();
- app.js:1090 applyTempoMark: C.mutate("템포 표시", (score) => {
- app.js:1096 applyTempoMark: stopPlayback(); update(); toast(`템포 ♩=${v}`);
- app.js:1115 applyRehearsalMark: C.mutate("리허설 마크", (score) => {
- app.js:1120 applyRehearsalMark: update(); toast(text ? `리허설 ${text}` : "리허설 마크를 지웠어요");
- app.js:1129 applyStaffText: C.mutate("스태프 텍스트", (score) => {
- app.js:1141 applyStaffText: update(); toast(text ? "스태프 텍스트를 붙였어요" : "스태프 텍스트를 지웠어요");
- app.js:1202 toggleSpeedy: update();
- app.js:1221 setInputMode: update();
- app.js:1235 inputLetter: C.mutate("화음에 음 추가", (s2) => {
- app.js:1243 inputLetter: update();
- app.js:1294 onCanvasClick: C.mutate("화음에 음 추가", (s2) => {
- app.js:1303 onCanvasClick: update();
- app.js:1314 onCanvasClick: if (ui.selection) { ui.selection = null; ui.selAnchor = null; update(); }
- app.js:1361 onPointerUp: C.mutate("음높이 드래그", (score) => {
- app.js:1374 onPointerUp: update();
- app.js:1414 editLyric: C.mutate("가사", (score) => {
- app.js:1420 editLyric: update();
- app.js:1486 editChordSymbol: C.mutate("코드 기호", (score) => {
- app.js:1502 editChordSymbol: update();
- app.js:1711 buildPiano: C.mutate("화음에 음 추가", (s2) => {
- app.js:1719 buildPiano: update();
- app.js:1755 buildToolbar: update();
- app.js:1767 buildToolbar: stopPlayback(); update();
- app.js:1771 buildToolbar: stopPlayback(); update();
- app.js:1984 mutateSelectedEvents: C.mutate(label, (score) => {
- app.js:1990 mutateSelectedEvents: update();
- app.js:2048 applyMeasureBreak: C.mutate("마디 브레이크", (score) => C.setMeasureBreak(score, range.to, type || null, sectionName));
- app.js:2049 applyMeasureBreak: update();
- app.js:2095 scrollToMeasure: update();
- app.js:2675 handleLoadedScore: update();
- app.js:2732 bindMenu: stopPlayback(); update();
- app.js:2758 bindMenu: stopPlayback(); update();
- app.js:2792 updateMixerValue: C.mutate("믹서", (score) => {
- app.js:2801 updateMixerValue: update();
- app.js:2919 bindSettings: C.mutate("악보 설정", (s2) => {
- app.js:2941 bindSettings: update();
- app.js:2945 bindSettings: C.mutate("마디 추가", (s2) => {
- app.js:2950 bindSettings: update(); toast("마디 4개를 추가했어요");
- app.js:2954 bindSettings: C.mutate("마디 삭제", (s2) => {
- app.js:2960 bindSettings: update(); toast("마지막 마디를 삭제했어요");
- app.js:2966 bindSettings: C.mutate("조옮김", (s2) => C.transposeScore(s2, semis));
- app.js:2967 bindSettings: update();
- app.js:2994 bindWelcome: update();
- app.js:2998 bindWelcome: update();
- app.js:3289 bindKeys: if (ui.selection) { ui.selection = null; ui.selAnchor = null; update(); return; }
- app.js:3325 bindKeys: if (found && found.ev.type === "note") { ui.selection = found.ev.id; update(); editLyric(found.ev.id); }
- app.js:3367 afterHistory: update();
- app.js:3388 bindButtons: $("#btn-rewind").addEventListener("click", () => { pausedAt = 0; ui.selection = null; if (P.player.playing) startPlayback(0); else update(); });
- app.js:3414 bindButtons: if (found && found.ev.type === "note") { ui.selection = found.ev.id; update(); editLyric(found.ev.id); }
- app.js:3449 bindButtons: C.mutate("빠르기", (s2) => { s2.tempo = v; });
- app.js:3450 bindButtons: stopPlayback(); update();
- app.js:3454 bindButtons: C.mutate("스윙", (s2) => {
- app.js:3458 bindButtons: stopPlayback(); update();
- app.js:3462 bindButtons: C.mutate("악기", (s2) => {
- app.js:3469 bindButtons: update();
- app.js:3490 bindButtons: ui.selection = id; update(); editChordSymbol(id); return;
- app.js:3492 bindButtons: if (found && found.ev.type === "note") { ui.selection = id; update(); editLyric(id); }
- app.js:3516 bindButtons: C.mutate("제목/작곡가", (s2) => { s2.meta[key] = v; });
- app.js:3517 bindButtons: update();
- app.js:3561 start: C.onChange(() => { /* mutate 이후 update()는 호출부가 수행 */ });
- app.js:3562 start: update({ noSave: !saved });
- app.js:3565 start: E.loadFont(() => update({ noSave: true })); // Bravura 로드되면 다시 그림

## Data model fixture

All serialized fields are recorded in the five JSON fixtures. Optional decoration inventory is in the supplied design document and tested in core-v3.test.mjs.
