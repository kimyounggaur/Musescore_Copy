/* Keyboard dispatch, command search, help and the live cheat sheet share KEYMAP. */
"use strict";
(function (SF) {
  const KEYMAP = [
    ["command", "명령 검색", ["Ctrl+Shift+P"], "openCommandPalette"],
    ["chord", "코드 기호 입력", ["Ctrl+K"], "applyChordSymbol"],
    ["undo", "실행 취소", ["Ctrl+Z"], "undo"],
    ["redo", "다시 실행", ["Ctrl+Shift+Z", "Ctrl+Y"], "redo"],
    ["save", "악보 파일 저장", ["Ctrl+S"], "saveScore"],
    ["cloud-save", "클라우드에 저장 (Ctrl+Shift+S)", ["Ctrl+Shift+S"], "cloudSave"],
    ["print", "인쇄/PDF", ["Ctrl+P"], "print"],
    ["copy", "복사", ["Ctrl+C"], "copySelection"],
    ["paste", "붙여넣기", ["Ctrl+V"], "pasteClipboard"],
    ["cut", "잘라내기", ["Ctrl+X"], "cut"],
    ["select-all", "전체 선택", ["Ctrl+A"], "selectAll"],
    ["loop", "선택 범위 반복 재생", ["Ctrl+L"], "loop"],
    ["goto", "마디·리허설 이동", ["Ctrl+G", "Ctrl+F"], "gotoQuery"],
    ["play", "재생·일시정지", ["Space"], "togglePlay"],
    ["escape", "입력 종료·정지·선택 해제", ["Escape"], "escape"],
    ["speedy", "스피디 입력 전환", ["Q"], "speedy"],
    ["input", "입력 모드 전환", ["N"], "input"],
    ["dot", "점음표·겹점음표 순환", ["."], "dot"],
    ["rest", "쉼표 입력", ["0"], "rest"],
    ["tie", "선택 음 붙임줄", ["T"], "toggleTie"],
    ["grace", "꾸밈음 추가", ["/"], "applyGraceBefore"],
    ["slur", "이음줄", ["S"], "toggleSlur", [], "normal"],
    ["lyric", "가사 입력", ["L"], "lyric", [], "normal"],
    ["tempo", "템포 표시", ["Shift+T"], "applyTempoMark", [], "normal"],
    ["rehearsal", "리허설 마크", ["R"], "applyRehearsalMark", [], "normal"],
    ["staff-text", "스태프 텍스트", ["Shift+L"], "applyStaffText", [], "normal"],
    ["staccato", "스타카토", ["Shift+S"], "applyArticulation", ["staccato"], "normal"],
    ["tenuto", "테누토", ["Shift+N"], "applyArticulation", ["tenuto"], "normal"],
    ["accent", "악센트", ["Shift+V"], "applyArticulation", ["accent"], "normal"],
    ["marcato", "마르카토", ["Shift+O"], "applyArticulation", ["marcato"], "normal"],
    ["cresc", "크레셴도", ["<"], "toggleHairpin", ["cresc"], "normal"],
    ["dim", "디미누엔도", [">"], "toggleHairpin", ["dim"], "normal"],
    ["delete", "선택 음 삭제", ["Delete", "Backspace"], "delete", [], "normal"],
    ["next-note", "화음의 다음 음 선택", ["Alt+ArrowUp"], "chordNote", [1]],
    ["prev-note", "화음의 이전 음 선택", ["Alt+ArrowDown"], "chordNote", [-1]],
    ["whole-chord", "화음 전체 선택", ["Alt+0"], "wholeChord"],
    ["navigator", "내비게이터", ["Alt+Shift+N", "F12"], "openNavigator"],
    ["timeline", "타임라인", ["Alt+Shift+T", "F11"], "openTimelinePanel"],
    ["speedy-chord", "스피디 화음 추가", ["Enter"], "addSpeedyChordTone", [], "speedy"],
    ["speedy-sharp", "스피디 반음 올림", ["+", "="], "transposeSelection", [1], "speedy"],
    ["speedy-flat", "스피디 반음 내림", ["-"], "transposeSelection", [-1], "speedy"],
    ["speedy-delete", "스피디 현재 음 삭제", ["Delete"], "speedyDelete", [false], "speedy"],
    ["speedy-backspace", "스피디 이전 음 삭제", ["Backspace"], "speedyDelete", [true], "speedy"],
  ].map(([id, label, keys, action, args = [], mode = "all"]) => ({ id, label, keys, action, args, mode }));
  const durations = [{n:1,d:64},{n:1,d:32},{n:1,d:16},{n:1,d:8},{n:1,d:4},{n:1,d:2},{n:1,d:1},{n:2,d:1}];
  durations.forEach((dur, i) => {
    const label = i === 7 ? "겹온음표" : i === 6 ? "온음표" : `${dur.d}분음표`;
    KEYMAP.push({ id: `duration-${i+1}`, label, keys: [String(i+1)], action: "duration", args: [dur], mode: "all" });
    KEYMAP.push({ id: `speedy-rest-${i+1}`, label: `스피디 ${label} 쉼표`, keys: [`Shift+${i+1}`], action: "speedyRest", args: [dur], mode: "speedy" });
  });
  for (let voice = 1; voice <= 4; voice++) KEYMAP.push({id:`voice-${voice}`,label:`성부 ${voice}`,keys:[`Alt+${voice}`],action:"setCurrentVoice",args:[voice],mode:"all"});
  for (let n = 2; n <= 9; n++) KEYMAP.push({id:`tuplet-${n}`,label:`${n}잇단음표`,keys:[`Ctrl+${n}`],action:"applyTuplet",args:[n],mode:"all"});
  for (const letter of "ABCDEFG") for (const shift of [false,true]) KEYMAP.push({id:`pitch-${letter}-${shift}`,label:shift?`${letter} 화음 쌓기`:`${letter} 음 입력`,keys:[(shift?"Shift+":"")+letter],action:"letter",args:[letter,shift],mode:"all"});
  for (const direction of ["Up","Down","Left","Right"]) for (const modifier of ["","Ctrl+","Shift+"]) KEYMAP.push({id:`move-${modifier}${direction}`,label:`${modifier === "Ctrl+" ? "옥타브·마디 " : modifier === "Shift+" ? "범위 " : ""}${({Up:"위",Down:"아래",Left:"이전",Right:"다음"})[direction]}`,keys:[`${modifier}Arrow${direction}`],action:"arrow",args:[direction,modifier],mode:"all"});
  const extras = new Map();
  function registerCommand(command) { if (command?.id && command?.label && typeof command.run === "function") extras.set(command.id, command); }
  /* 한글 입력기(IME)가 켜져 있으면 e.key가 "Process"나 "ㅁ"처럼 라틴 글자가 아니고, macOS에서 옵션키를 누르면 "å"가 된다.
     그럴 때만 자판 위치(e.code)로 어떤 키인지 알아낸다. e.key가 ASCII 한 글자(글자·기호 모두)면 그 글자를 그대로 쓰므로
     Dvorak·AZERTY·QWERTZ 사용자가 눈에 보이는 글자로 단축키를 쓰는 기존 동작은 그대로다. */
  const CODE_PUNCT = {   // e.code → [Shift 없이, Shift와 함께] 나오는 글자(미국 자판 기준). key가 "Process"·"Dead"일 때만 쓴다.
    Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Minus: ["-", "_"], Equal: ["=", "+"], Semicolon: [";", ":"],
    Quote: ["'", "\""], BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"], Backquote: ["`", "~"],
    NumpadAdd: ["+", "+"], NumpadSubtract: ["-", "-"], NumpadDecimal: [".", "."], NumpadDivide: ["/", "/"], NumpadMultiply: ["*", "*"]
  };
  const SYMBOLIC = ["<", ">", "+", "_", "?"];          // 글자 자체에 Shift가 들어 있어 "Shift+"를 따로 붙이지 않는 기호
  const IME_KEYS = new Set(["Process", "Dead", "Unidentified"]);   // 입력기가 가로채서 글자를 알 수 없는 e.key
  /** 눌린 키의 바탕 글자: 글자는 대문자, 숫자·기호·이름 있는 키는 그대로. 한글 입력 상태에서도 같은 값이 나온다. */
  function baseKey(e) {
    const key = typeof e.key === "string" ? e.key : "", code = typeof e.code === "string" ? e.code : "";
    if (/^(Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);                          // 숫자는 예전부터 자판 위치 기준
    if (key === " ") return "Space";
    if (key.length === 1 && key.charCodeAt(0) < 128) return key.toUpperCase();              // ASCII 한 글자: 눈에 보이는 글자 기준(기존 동작)
    if (key.length > 1 && !IME_KEYS.has(key)) return key;                                   // Enter·Escape·ArrowUp·F11 같은 이름 있는 키
    if (code === "Space") return "Space";
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);                                      // ㅁ·ф·å·Process → 자판 위치의 글자
    if (key.length === 1) return key;                                                       // 그 밖의 한 글자(ö·ß 등 자판 고유 글자): 위치로 바꾸지 않고 그대로
    if (Object.prototype.hasOwnProperty.call(CODE_PUNCT, code)) return CODE_PUNCT[code][e.shiftKey ? 1 : 0];   // Process·Dead의 기호
    return key;
  }
  function combo(e) {
    const key = baseKey(e), symbolic = SYMBOLIC.includes(key);
    return `${e.ctrlKey || e.metaKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey && !symbolic ? "Shift+" : ""}${key}`;
  }
  const DRUM_KEYS = new Map(Object.entries({ K: "kick", S: "snare", H: "closed-hihat", O: "open-hihat", C: "crash" }));
  function create(A) {
    const { C, ui, $, $$, P } = A;
    let pulseTimer;
    function duration(dur, rest = false) {
      if (!ui.speedy) return A.setDuration(dur);
      const pitches = !rest && ui.speedyHeld.size ? [...ui.speedyHeld].sort((a,b)=>a-b).map(m=>C.spellMidi(m, C.keySigAt(C.state.score, A.cursorPos().mIdx))) : undefined;
      A.doSpeedyInput(dur, { rest, pitches });
    }
    const local = {
      openCommandPalette, undo: () => { C.undo(); A.afterHistory(); }, redo: () => { C.redo(); A.afterHistory(); },
      cloudSave: () => SF.cloud.saveCurrent(), print: () => SF.exportUI.print(),
      input: () => A.setInputMode(!ui.inputMode), speedy: () => A.toggleSpeedy(!ui.speedy),
      cut: () => { if (A.copySelection({quiet:true})) A.deleteSelection(); },
      selectAll: () => { const ids = [...C.eventOrderMap(C.state.score).keys()]; ui.selection = ids.at(-1); ui.selAnchor = ids[0]; ui.selectAll = true; ui.selectedNoteIdx = null; A.update(); },
      loop: () => SF.uiV3.toggleLoop(), dot: () => ui.speedy ? A.toggleSpeedyDot() : A.toggleDot(),
      rest: () => { if (ui.speedy) duration(ui.curDur, true); else if (ui.inputMode) { const p=A.cursorPos(); A.doInput(p.mIdx,p.tick,null); } else A.deleteSelection(); },
      duration, speedyRest: d => duration(d, true), delete: A.deleteSelection,
      lyric: () => $("#btn-lyric").click(), wholeChord: () => { ui.selectedNoteIdx=null; A.update(); },
      chordNote: dir => { const f=A.selectedEvent(); if (!f || f.ev.type!=="note") return; ui.selectedNoteIdx=((ui.selectedNoteIdx ?? (dir>0?-1:0))+dir+f.ev.notes.length)%f.ev.notes.length; A.update(); },
      escape: () => { if (P.player.playing) A.stopPlayback(); else if (ui.speedy) A.toggleSpeedy(false); else if (ui.inputMode) A.setInputMode(false); else { ui.selection=null; ui.selAnchor=null; ui.selectedNoteIdx=null; ui.selectAll=false; A.update(); } },
      speedyDelete: previous => { const p=A.cursorPos(); const f=previous?C.prevEvent(C.state.score,p.found.m,p.found.e,p.found):p.found; if(f) A.speedyDeleteAt(f,C.eventStartTick(f.measures[f.m],f.e,f)); },
      letter: (letter, shift) => {
        if (!ui.speedy) return A.inputLetter(letter,shift);
        const step={C:0,D:1,E:2,F:3,G:4,A:5,B:6}[letter];
        const old=ui.speedyStep===null?ui.lastPitch:{step:ui.speedyStep%7,oct:Math.floor(ui.speedyStep/7)};
        ui.speedyStep=A.clampStep(C.absStep({step,oct:A.nearestOctave(step,old)}),A.activeRef());
        A.refreshCursor(); A.updateStatus(); A.previewSpeedyStep();
      },
      arrow: (direction, modifier) => {
        const dir=["Up","Right"].includes(direction)?1:-1;
        if (["Left","Right"].includes(direction)) {
          if (ui.speedy && modifier==="Ctrl+") { const p=A.cursorPos(); const m=p.mIdx+dir; const mm=p.found.measures[m]; if(mm)ui.cursorId=C.getVoiceEvents(mm,ui.currentVoice,C.state.score)[0]?.id; A.refreshCursor(); A.updateStatus(); }
          else A.moveSelection(dir,modifier==="Shift+");
        } else if(ui.speedy) { ui.speedyStep=A.clampStep((ui.speedyStep??28)+dir*(modifier==="Ctrl+"?7:1),A.activeRef()); A.refreshCursor(); A.updateStatus(); A.previewSpeedyStep(); }
        else A.transposeSelection(dir*(modifier==="Ctrl+"?12:1));
      },
    };
    function run(item) { return item.run ? item.run() : (local[item.action] || A[item.action])?.(...(item.args || [])); }
    function items() {
      const all = new Map(KEYMAP.filter(x => x.id!=="escape").map(x=>[x.id,x]));
      for(const group of SF.palette?.PALETTE || []) for(const item of group.items) if(item.id) all.set(item.id,{id:item.id,label:item.label,run:()=>document.getElementById(item.id)?.click()});
      for(const [id,item] of extras) all.set(id,item);
      return [...all.values()];
    }
    function renderHelp(host) {
      host.replaceChildren();
      for (const item of KEYMAP) {
        const row=document.createElement("div"); row.className="shortcut-row"; row.dataset.shortcut=item.id;
        const label=document.createElement("span"); label.textContent=item.label;
        const key=document.createElement("kbd"); key.textContent=item.keys.join(" / "); row.append(label,key); host.append(row);
      }
    }
    function isShortcutOverlayOpen() { return $("#shortcut-overlay")?.open; }
    function closeShortcutOverlay() { $("#shortcut-overlay")?.close(); }
    function bindShortcutOverlay() {
      renderHelp($("#shortcut-list")); renderHelp($("#help-shortcuts"));
      $("#btn-shortcuts").addEventListener("click",()=>SF.ui.open($("#shortcut-overlay")));
      $("#shortcut-close").addEventListener("click",closeShortcutOverlay);
    }
    function bindKeys() {
      document.addEventListener("keydown", e => {
        if(e.isComposing || e.defaultPrevented) return;
        if(e.target.closest("button") && [" ","Enter"].includes(e.key)) return;
        const key=combo(e);
        if(isShortcutOverlayOpen()) {
          if(e.key==="Escape") return;
          const hit=KEYMAP.filter(x=>x.keys.includes(key));
          if(hit.length) { e.preventDefault(); clearTimeout(pulseTimer); $$(".shortcut-row.pulse").forEach(el=>el.classList.remove("pulse")); for(const x of hit) { const el=$("#shortcut-list").querySelector(`[data-shortcut="${CSS.escape(x.id)}"]`); el?.classList.add("pulse"); el?.scrollIntoView({block:"nearest"}); } pulseTimer=setTimeout(()=>$$(".shortcut-row.pulse").forEach(el=>el.classList.remove("pulse")),800); }
          return;
        }
        if(e.target.closest("input, textarea, select, [contenteditable=true], [contenteditable=plaintext-only]")) return;
        if(document.querySelector("dialog[open]")) return;
        const external=[...extras.values()].find(x=>(x.keys||[]).includes(key));
        if(external) { e.preventDefault(); run(external); return; }
        if(ui.inputMode && C.isPercussionRef(A.activeRef()) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const drum=DRUM_KEYS.get(baseKey(e));
          if(drum) {e.preventDefault();A.inputDrum(drum);return;}
        }
        const item=KEYMAP.find(x=>x.keys.includes(key)&&(x.mode==="all"||x.mode===(ui.speedy?"speedy":"normal")));
        if(!item)return;
        e.preventDefault();
        if(item.action==="cloudSave")e.stopImmediatePropagation();
        if(e.repeat && ["input","speedy","duration","speedyRest"].includes(item.action))return;
        run(item);
      });
    }
    function renderCommands(q) {
      const host=$("#cmd-list"); host.replaceChildren();
      for(const item of items().filter(x=>`${x.label} ${SF.i18n?.translate(x.label)||x.label} ${x.id} ${(x.keys||[]).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0,60)) {
        const b=document.createElement("button"); b.type="button"; b.className="cmd-item"; b.textContent=(SF.i18n?.translate(item.label)||item.label) + (item.keys?.length&&!item.label.includes(item.keys[0])?`  ${item.keys[0]}`:"");
        b.addEventListener("click",()=>{$("#dlg-command").close();run(item);}); host.append(b);
      }
      host.firstElementChild?.classList.add("active");
    }
    function openCommandPalette() { renderCommands(""); $("#cmd-input").value=""; SF.ui.open($("#dlg-command")); $("#cmd-input").focus(); }
    function bindCommandPalette() {
      $("#cmd-input").addEventListener("input",e=>renderCommands(e.target.value));
      $("#dlg-command").addEventListener("keydown",e=>{
        if(!["ArrowDown","ArrowUp","Enter"].includes(e.key))return;
        const rows=$$("#cmd-list .cmd-item");if(!rows.length)return;
        e.preventDefault();const idx=rows.findIndex(x=>x.classList.contains("active"));
        if(e.key==="Enter")return rows[Math.max(0,idx)].click();
        rows.forEach(x=>x.classList.remove("active")); const next=rows[(idx+(e.key==="ArrowDown"?1:-1)+rows.length)%rows.length];next.classList.add("active");next.scrollIntoView({block:"nearest"});
      });
    }
    return { bindKeys, bindShortcutOverlay, bindCommandPalette, openCommandPalette, closeShortcutOverlay, isShortcutOverlayOpen };
  }
  SF.keymap = { KEYMAP, create, combo, baseKey, registerCommand };
})(window.SF);
