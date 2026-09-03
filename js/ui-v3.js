/* Advanced notation controls, transport options, and pointer accessibility. */
"use strict";
(function (SF) {
  let A;
  const clefs = {treble:"높은음자리표",bass:"낮은음자리표",alto:"알토",tenor:"테너",treble8vb:"높은음자리표 8vb",bass8vb:"낮은음자리표 8vb",percussion:"타악 보표"};
  const ornamentNames = {trill:"트릴",mordent:"모르덴트",invMordent:"뒤집힌 모르덴트",turn:"턴",invTurn:"뒤집힌 턴"};
  const jumpNames = {DC:"D.C.",DS:"D.S.",DCalFine:"D.C. al Fine",DSalFine:"D.S. al Fine",DCalCoda:"D.C. al Coda",DSalCoda:"D.S. al Coda"};
  const markerNames = {segno:"세뇨",coda:"코다",fine:"Fine",toCoda:"To Coda"};
  function element(tag, attrs = {}, text) {
    const el=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    if(text!==undefined)el.textContent=text;
    return el;
  }
  function options(select, values, value) {
    for(const [key,label] of Object.entries(values)) select.add(new Option(label,key));
    select.value=String(value??""); return select;
  }
  function field(host, label, input) {
    input.id ||= "v3-field-" + Math.random().toString(36).slice(2,10);
    host.append(element("label",{for:input.id},label),input); return input;
  }
  function button(host, id, label, action) {
    const b=element("button",{type:"button",class:"chip",id},label);b.addEventListener("click",action);host.append(b);return b;
  }
  function commit(label, fn, coalesce) {
    try { A.C.mutate(label,fn,coalesce?{coalesce}:{}); A.update(); }
    catch(error) { A.toast(error instanceof RangeError ? "이 위치에서는 적용할 수 없어요. 마디 길이와 반복·조표 경계를 확인하세요." : error.message); }
  }
  function measureTarget() { return A.selectedEvent() || A.targetEvent() || A.cursorPos().found; }
  function resetSelection(m) {
    const ref=A.activeRef(), mm=ref.measures[Math.max(0,Math.min(m,ref.measures.length-1))];
    A.ui.selection=A.C.getVoiceEvents(mm,A.ui.currentVoice,A.C.state.score)[0]?.id;A.ui.selAnchor=A.ui.selection;A.ui.cursorId=A.ui.selection;A.ui.selectedNoteIdx=null;A.ui.selectAll=false;
  }
  async function measureAction(action) {
    const f=measureTarget();if(!f)return;
    const {C}=A, range=A.selectedMeasureRange() || {from:f.m,to:f.m};
    if(action==="split" || action==="pickup") {
      const tick=C.eventStartTick(f.measures[f.m],f.e,f);
      const raw=await SF.ui.promptDialog({title:action==="split"?"마디 나누기":"못갖춘마디 길이",label:"온음표 기준 분수 (예: 1/4)",value:action==="split"?(tick.n?tick.toString():"1/2"):"1/4",validate:v=>{
        const match=v.trim().match(/^(\d+)\/(\d+)$/);if(!match||!+match[2]||!+match[1])return "양수 분수로 입력하세요.";
        const t=new SF.Fraction(+match[1],+match[2]),max=action==="split"?C.measureLenAt(C.state.score,f.m):new SF.Fraction(C.timeSigAt(C.state.score,0).num,C.timeSigAt(C.state.score,0).den);
        return (action==="split"?t.lt(max):t.lte(max))?"":"마디 길이보다 짧게 입력하세요.";
      }});
      if(raw===null)return;const [n,d]=raw.trim().split("/").map(Number);
      commit(action==="split"?"마디 나누기":"못갖춘마디",s=>action==="split"?C.splitMeasureAt(s,f.m,new SF.Fraction(n,d)):C.setPickup(s,new SF.Fraction(n,d)));
    } else commit(({before:"앞에 마디 삽입",after:"뒤에 마디 삽입",delete:"마디 삭제",range:"마디 범위 삭제",join:"마디 합치기",unpickup:"못갖춘마디 해제"})[action],s=>{
      if(action==="before")C.insertMeasures(s,f.m,1);
      if(action==="after")C.insertMeasures(s,f.m+1,1);
      if(action==="delete")C.deleteMeasures(s,f.m,f.m);
      if(action==="range")C.deleteMeasures(s,range.from,range.to);
      if(action==="join")C.joinMeasures(s,f.m);
      if(action==="unpickup")C.setPickup(s,null);
    });
    resetSelection(f.m);A.stopPlayback();A.update();
  }
  function ornament(type) {
    const ids=A.selectedIds() || new Set(A.targetEvent()?[A.targetEvent().ev.id]:[]);
    if(!ids.size){A.toast("장식을 붙일 음표를 선택하세요.");return;}
    commit("꾸밈 기호",s=>{for(const id of ids){const f=A.C.findEvent(s,id);if(f?.ev.type==="note")A.C.setOrnament(s,id,f.ev.ornament===type?null:type);}});
  }
  function ottava(shift) {
    const ends=A.rangeNoteEnds();if(!ends){A.toast("옥타브 선을 붙일 음표 범위를 선택하세요.");return;}
    commit(shift>0?"8va 옥타브 선":"8vb 옥타브 선",s=>{
      const old=s.spanners.find(x=>x.type==="ottava"&&x.startId===ends.firstId&&x.endId===ends.lastId&&x.shift===shift);
      if(old)s.spanners=s.spanners.filter(x=>x!==old);else A.C.addOttava(s,ends.firstId,ends.lastId,shift);
    });
  }
  function addMeasureProperties() {
    const host=A.$("#properties-body"), f=measureTarget();
    if(!host||!f||host.querySelector("#measure-v3"))return;
    const {C}=A,s=C.state.score,mm=s.measures[f.m];
    const section=element("section",{class:"prop-sec",id:"measure-v3"});section.append(element("h3",{},`마디 ${f.m+1}`));
    const grid=element("div",{class:"prop-grid"});section.append(grid);
    const key=field(grid,"조표",options(element("select",{id:"measure-key"}),{"":"이전 마디에서 이어받기",...C.KEY_NAMES},mm.keySig??""));
    key.addEventListener("change",()=>commit("마디 조표",score=>C.setMeasureKeySig(score,f.m,key.value===""?null:+key.value)));
    const clef=field(grid,"음자리표",options(element("select",{id:"measure-clef"}),{"":"이전 보표에서 이어받기",...clefs},f.measures[f.m].clef??""));
    clef.addEventListener("change",()=>commit("마디 음자리표",score=>C.setMeasureClef(score,f.m,clef.value||null,f)));
    const ts=C.timeSigAt(s,f.m), time=field(grid,"박자",element("input",{id:"measure-time",type:"text",value:`${ts.num}/${ts.den}`,placeholder:"3/4"}));
    time.addEventListener("change",()=>{const [num,den]=time.value.split("/").map(Number);if(!Number.isInteger(num)||num<1||num>32||![1,2,4,8,16,32,64].includes(den)){A.toast("박자는 1~32 / 1·2·4·8·16·32·64로 입력하세요.");time.value=`${ts.num}/${ts.den}`;return;}commit("마디 박자",score=>C.setMeasureTimeSig(score,f.m,{num,den}));resetSelection(f.m);});
    const jump=field(grid,"다시 가기",options(element("select",{id:"measure-jump"}),{"":"없음",...jumpNames},mm.jump?.type||""));
    jump.addEventListener("change",()=>commit("다시 가기",score=>C.setMeasureJump(score,f.m,jump.value?{type:jump.value,playRepeats:!!mm.jump?.playRepeats}:null)));
    const repeats=field(grid,"돌아간 뒤 반복",element("input",{id:"jump-repeats",type:"checkbox"}));repeats.checked=!!mm.jump?.playRepeats;repeats.disabled=!mm.jump;
    repeats.addEventListener("change",()=>commit("점프 반복",score=>C.setMeasureJump(score,f.m,{type:mm.jump.type,playRepeats:repeats.checked})));
    const marker=field(grid,"이동 표지",options(element("select",{id:"measure-marker"}),{"":"없음",...markerNames},mm.marker||""));
    marker.addEventListener("change",()=>commit("이동 표지",score=>C.setMeasureMarker(score,f.m,marker.value||null)));
    const actions=element("div",{class:"prop-actions"});section.append(actions);
    for(const [action,label]of Object.entries({before:"앞에 삽입",after:"뒤에 삽입",delete:"이 마디 삭제",range:"선택 마디 삭제",split:"나누기",join:"다음 마디와 합치기",pickup:"못갖춘마디",unpickup:"못갖춘마디 해제"}))button(actions,`measure-${action}`,label,()=>measureAction(action));
    host.append(section);
    if(f.ev.type==="note") {
      const notes=element("section",{class:"prop-sec",id:"note-v3"});notes.append(element("h3",{},"화음·장식"));const ng=element("div",{class:"prop-grid"});notes.append(ng);
      const chord=field(ng,"선택 음",options(element("select",{id:"chord-note-select"}),Object.fromEntries([["","화음 전체"],...f.ev.notes.map((n,i)=>[i,`${i+1}. ${C.pitchName(n,"ko")}`])]),A.ui.selectedNoteIdx??""));
      chord.addEventListener("change",()=>{A.ui.selectedNoteIdx=chord.value===""?null:+chord.value;A.update();});
      const orn=field(ng,"꾸밈 기호",options(element("select",{id:"ornament-select"}),{"":"없음",...ornamentNames},f.ev.ornament||""));
      orn.addEventListener("change",()=>commit("꾸밈 기호",score=>C.setOrnament(score,f.ev.id,orn.value||null,f.ev.trillLine)));
      const line=field(ng,"트릴 연장선",element("input",{id:"trill-line",type:"checkbox"}));line.checked=!!f.ev.trillLine;line.disabled=f.ev.ornament!=="trill";
      line.addEventListener("change",()=>commit("트릴 연장선",score=>C.setOrnament(score,f.ev.id,"trill",line.checked)));
      const na=element("div",{class:"prop-actions"});notes.append(na);button(na,"prop-ottava-up","8va",()=>ottava(12));button(na,"prop-ottava-down","8vb",()=>ottava(-12));host.append(notes);
    }
  }
  function toggleLoop() {
    if(A.ui.loop){A.ui.loop=null;A.ui.loopIds=null;A.P.setLoop(null);A.update();return;}
    const ids=A.selectedIds();if(!ids?.size){A.toast("반복 재생할 범위를 먼저 선택하세요.");return;}
    const comp=A.P.compile(A.C.state.score,{viewMode:A.ui.viewMode});
    const events=(comp.timelineEvents||[]).filter(e=>ids.has(e.id));
    if(!events.length)return;
    const startSec=Math.min(...events.map(e=>e.t)), endSec=Math.max(...events.map(e=>e.t+(e.durSec||0)));
    A.ui.loop={startSec,endSec:Math.max(startSec+0.05,endSec)};A.ui.loopIds=[...ids];A.P.setLoop(A.ui.loop);A.update();
  }
  function seekToEvent(id) {
    const comp=A.P.compile(A.C.state.score,{viewMode:A.ui.viewMode});const event=comp.timelineEvents?.find(e=>e.id===id);
    if(event)A.P.seek(event.t);
  }
  function drawLoop() {
    if(!A)return;
    A.$$(".loop-overlay").forEach(el=>el.remove());if(!A.ui.loop||!A.ui.loopIds)return;
    const layout=A.getLayoutCache(), ids=new Set(A.ui.loopIds);
    for(const system of layout?.systems||[]) {
      const events=[...layout.eventsById.values()].filter(e=>e.sys===system&&ids.has(e.id));if(!events.length)continue;
      const svg=A.ui.pageMode==="pages"?A.$(`#score-svg-page-${system.page}`):A.$("#score-svg");if(!svg)continue;
      const group=svg.querySelector(".page-content")||svg.querySelector("#score-main");
      const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");rect.setAttribute("class","loop-overlay");
      const x=Math.min(...events.map(e=>e.x))-9,y=Math.min(...system.staffLayouts.map(st=>st.yTop))-18;
      for(const [k,v] of Object.entries({x,y,width:Math.max(...events.map(e=>e.x))-x+24,height:Math.max(...system.staffLayouts.map(st=>st.yTop))+A.E.STAFF_H-y+18,fill:"#258866",opacity:.12,"pointer-events":"none"}))rect.setAttribute(k,v);
      group?.prepend(rect);
    }
  }
  function contextMenu(event) {
    event.preventDefault?.();const pt=A.svgPoint(event),hit=pt&&A.E.hitTest(pt.x,pt.y);
    if(hit?.le&&!A.selectedIds()?.has(hit.le.id))A.select(hit.le.id,{silent:true});
    A.$("#measure-context")?.remove();
    const menu=element("div",{id:"measure-context",class:"measure-context",role:"menu","aria-label":"마디 메뉴"});
    for(const [label,run]of [["앞에 마디 삽입",()=>measureAction("before")],["뒤에 마디 삽입",()=>measureAction("after")],["선택 마디 삭제",()=>measureAction("range")],["시작 반복",A.applyStartRepeat],["끝 반복",A.applyEndRepeat],["시스템 줄바꿈",()=>A.applyMeasureBreak("system")],["마디 설정",showMeasureProperties]]) {
      const b=button(menu,"",label,()=>{menu.remove();run();});b.setAttribute("role","menuitem");
    }
    document.body.append(menu);menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-menu.offsetWidth-8))+"px";menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+"px";menu.firstElementChild.focus();
    menu.addEventListener("keydown",e=>{const items=[...menu.children],i=items.indexOf(document.activeElement);if(e.key==="Escape"){menu.remove();A.$("#canvas").focus();}if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();items[(i+(e.key==="ArrowDown"?1:-1)+items.length)%items.length].focus();}});
    setTimeout(()=>document.addEventListener("pointerdown",e=>{if(!menu.contains(e.target))menu.remove();},{once:true}),0);
  }
  function showMeasureProperties() { A.$("#properties-panel").classList.remove("collapsed");A.$("#btn-props").classList.add("on");A.update();requestAnimationFrame(()=>A.$("#measure-key")?.focus()); }
  function bindTouch() {
    const canvas=A.$("#canvas"),points=new Map();let timer=null,pinch=null,down=null;
    canvas.addEventListener("contextmenu",contextMenu);
    canvas.addEventListener("pointerdown",e=>{
      if(e.pointerType!=="touch")return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(points.size===1){down={x:e.clientX,y:e.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};timer=setTimeout(()=>{A.ui.dragging=null;A.ui.suppressClickUntil=performance.now()+800;contextMenu(e);},500);}
      if(points.size===2){clearTimeout(timer);A.ui.dragging=null;const [a,b]=[...points.values()];const rect=canvas.getBoundingClientRect();pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:A.ui.zoom,x:(a.x+b.x)/2-rect.left,y:(a.y+b.y)/2-rect.top,left:canvas.scrollLeft,top:canvas.scrollTop};A.ui.suppressClickUntil=performance.now()+1000;}
    },{passive:true});
    canvas.addEventListener("pointermove",e=>{
      if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>8)clearTimeout(timer);
      if(!pinch&&points.size===1&&down&&!A.ui.dragging&&!A.ui.inputMode&&!A.ui.speedy){canvas.scrollLeft=down.left+down.x-e.clientX;canvas.scrollTop=down.top+down.y-e.clientY;if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>8)A.ui.suppressClickUntil=performance.now()+500;}
      if(pinch&&points.size===2){e.preventDefault();A.ui.dragging=null;const [a,b]=[...points.values()];const ratio=Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance;A.ui.zoom=Math.max(.5,Math.min(2.4,pinch.zoom*ratio));A.applyZoom();const r=A.ui.zoom/pinch.zoom,rect=canvas.getBoundingClientRect();canvas.scrollLeft=(pinch.left+pinch.x)*r-((a.x+b.x)/2-rect.left);canvas.scrollTop=(pinch.top+pinch.y)*r-((a.y+b.y)/2-rect.top);}
    },{passive:false});
    for(const name of ["pointerup","pointercancel"])window.addEventListener(name,e=>{points.delete(e.pointerId);clearTimeout(timer);if(pinch){A.ui.suppressClickUntil=performance.now()+500;A.ui.dragging=null;}if(points.size<2)pinch=null;if(name==="pointercancel")A.ui.dragging=null;});
  }
  function settingsExtras() {
    const host=A.$("#dlg-settings .form-grid");
    for(const [key,label]of Object.entries({subtitle:"부제",lyricist:"작사가",copyright:"저작권"}))field(host,label,element("input",{id:`set-${key}`,type:"text",maxlength:"160"}));
    const styles=element("section",{id:"settings-style",class:"style-grid"});styles.append(element("h3",{},"조판 스타일"));
    const names={staffLineWidth:"보표 선 두께",stemWidth:"스템 두께",beamThickness:"빔 두께",ledgerLength:"덧줄 길이",noteheadScale:"음표 머리 크기",lyricFontSize:"가사 크기",lyricLineHeight:"가사 행 간격",chordFontSize:"코드 글자 크기",systemFirstMeasurePadding:"첫 마디 안쪽 여백",measureMinWidth:"최소 마디 폭",spaceBase:"음표 기본 간격",spaceK:"음길이 간격 비율",slurThickness:"이음줄 두께",tieHeightFactor:"붙임줄 높이"};
    const grid=element("div",{class:"form-grid"});styles.append(grid);
    for(const [key,label]of Object.entries(names)) {
      const value=A.C.ensureStyle(A.C.state.score)[key];const input=field(grid,label,element("input",{id:`style-${key}`,type:"range",min:value/2,max:value*2,step:value/20,value}));
      input.addEventListener("input",()=>{input.title=Number(input.value).toFixed(2);commit("조판 스타일",s=>{A.C.ensureStyle(s)[key]=+input.value;},"style:"+key);});
    }
    button(styles,"style-reset","기본값 복원",()=>{commit("스타일 기본값",s=>{s.style={};A.C.ensureStyle(s);});loadSettingsExtras();});
    A.$("#dlg-settings .dlg-body").append(styles);
    const tabs=element("div",{class:"settings-tabs",role:"tablist","aria-label":"악보 설정 분류"});const basic=element("div",{id:"settings-basic",role:"tabpanel"}),page=element("div",{id:"settings-page",role:"tabpanel"});
    const basicGrid=element("div",{class:"form-grid"}),pageGrid=element("div",{class:"form-grid"});basic.append(basicGrid);page.append(pageGrid);
    const pageIds=new Set(["set-measures-system","set-page-size","set-orientation","set-margin","set-note-spacing","set-system-gap","set-staff-gap","set-beam-thickness"]);
    while(host.children.length){const label=host.firstElementChild,control=label.nextElementSibling;const dest=pageIds.has(control?.id)?pageGrid:basicGrid;dest.append(label);if(control)dest.append(control);}
    host.replaceWith(tabs,basic,page);styles.setAttribute("role","tabpanel");
    const sections=[basic,page,styles];["기본","페이지","스타일"].forEach((label,i)=>{const b=button(tabs,`settings-tab-${i}`,label,()=>{sections.forEach((s,j)=>s.hidden=i!==j);[...tabs.children].forEach((t,j)=>{t.setAttribute("aria-selected",String(i===j));t.tabIndex=i===j?0:-1;});});b.setAttribute("role","tab");b.setAttribute("aria-controls",sections[i].id);sections[i].setAttribute("aria-labelledby",b.id);});tabs.firstElementChild.click();
    A.$("#btn-settings").addEventListener("click",loadSettingsExtras);
  }
  function loadSettingsExtras() {
    for(const key of ["subtitle","lyricist","copyright"])A.$(`#set-${key}`).value=A.C.state.score.meta[key]||"";
    for(const [key,value]of Object.entries(A.C.ensureStyle(A.C.state.score))){const input=A.$(`#style-${key}`);if(input){input.value=value;input.title=String(value);}}
  }
  function transport() {
    const anchor=A.$("#tempo-input");const host=element("span",{class:"transport-options"});anchor.after(host);
    const rate=element("select",{id:"playback-rate",class:"tsel compact","aria-label":"재생 속도"});for(const value of [.5,.75,1,1.25,1.5,1.75,2])rate.add(new Option(`${value*100}%`,String(value)));rate.value="1";host.append(rate);rate.addEventListener("change",()=>{A.ui.playbackRate=+rate.value;A.P.setRate(A.ui.playbackRate);refresh();});
    const count=element("label",{class:"count-in"});const check=element("input",{id:"count-in",type:"checkbox"});count.append(check,document.createTextNode("예비박"));host.append(count);check.addEventListener("change",()=>A.ui.countIn=check.checked);
    button(host,"btn-loop","반복",toggleLoop);const duration=element("span",{id:"play-duration",class:"transport-duration",role:"timer","aria-label":"재생 시간"});host.append(duration);
    const views=element("span",{class:"view-options"});A.$("#view-select").after(views);
    const mode=options(element("select",{id:"page-mode",class:"tsel compact","aria-label":"악보 보기 방식"}),{continuous:"연속 보기",pages:"페이지 보기"},A.ui.pageMode);views.append(mode);mode.addEventListener("change",()=>{A.ui.pageMode=mode.value;A.update();});
    const multi=element("label",{class:"multi-rest"});const m=element("input",{id:"multi-rest",type:"checkbox"});m.checked=A.ui.multiRest;multi.append(m,document.createTextNode("여러 마디 쉼표"));views.append(multi);m.addEventListener("change",()=>{A.ui.multiRest=m.checked;A.update();});
  }
  function refresh() {
    if(!A)return;addMeasureProperties();
    if(A.$("#page-mode"))A.$("#page-mode").value=A.ui.pageMode;
    if(A.$("#playback-rate"))A.$("#playback-rate").value=String(A.ui.playbackRate);
    const loop=A.$("#btn-loop");if(loop){loop.classList.toggle("on",!!A.ui.loop);loop.setAttribute("aria-pressed",String(!!A.ui.loop));}
    const multi=A.$("#multi-rest");if(multi)multi.disabled=A.ui.viewMode.type!=="part";
    const duration=A.$("#play-duration");if(duration){const total=(A.P.player.compiled?.totalSec||0)/A.ui.playbackRate;duration.textContent=total?`${Math.floor(total/60)}:${String(Math.round(total%60)).padStart(2,"0")}`:"";}
    for(const grid of A.$$(".prop-grid"))for(const label of grid.querySelectorAll("label:not([for])")){const control=label.nextElementSibling;if(control?.matches("input,select,textarea")){control.id||=`prop-${control.dataset.prop||Math.random().toString(36).slice(2)}`;label.htmlFor=control.id;}}
    document.querySelectorAll("button,select,input").forEach(el=>{
      if(!el.getAttribute("aria-label")&&!el.labels?.length&&!el.getAttribute("aria-labelledby")&&(el.tagName!=="BUTTON"||!el.textContent.trim())){const label=el.title||el.placeholder||el.id;if(label)el.setAttribute("aria-label",label);}
      if(el.matches("button.tbtn,button.dur"))el.setAttribute("aria-pressed",String(el.classList.contains("on")));
    });
  }
  function init(api) {
    A=api;transport();settingsExtras();bindTouch();
    A.$("#canvas").tabIndex=0;
    A.$$("#file-menu .mi").forEach(el=>{el.tabIndex=0;el.setAttribute("role","menuitem");el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();el.click();}});});
    for(const [id,run]of [["btn-trill",()=>ornament("trill")],["btn-mordent",()=>ornament("mordent")],["btn-turn",()=>ornament("turn")],["btn-ottava-up",()=>ottava(12)],["btn-ottava-down",()=>ottava(-12)],["btn-measure-insert",()=>measureAction("before")],["btn-measure-delete",()=>measureAction("range")],["btn-measure-options",showMeasureProperties]])A.$("#"+id).addEventListener("click",run);
    for(const [id,label]of Object.entries({before:"앞에 마디 삽입",after:"뒤에 마디 삽입",delete:"이 마디 삭제",range:"선택 마디 삭제",split:"마디 나누기",join:"마디 합치기",pickup:"못갖춘마디"}))SF.keymap.registerCommand({id:`measure-${id}`,label,run:()=>measureAction(id)});
    A.$("#canvas").addEventListener("click",e=>{
      const meta=e.target.closest("[data-meta]");if(!meta||A.C.state.readOnly)return;
      e.stopPropagation();const key=meta.dataset.meta;if(!["title","subtitle","composer","lyricist","copyright"].includes(key))return;
      const paper=A.$("#paper"), input=element("input",{id:"score-meta-editor",type:"text","aria-label":"악보 제목·저작자",maxlength:160});
      A.$("#score-meta-editor")?.remove();
      const box=meta.getBoundingClientRect(), parent=paper.getBoundingClientRect(), scale=A.ui.fitScale*A.ui.zoom;
      input.value=A.C.state.score.meta[key]||"";input.style.position="absolute";input.style.left=Math.max(8,(box.left-parent.left)/scale-12)+"px";input.style.top=(box.top-parent.top)/scale-4+"px";input.style.width=Math.max(180,box.width/scale+30)+"px";input.style.fontSize=key==="title"?"28px":"16px";input.style.zIndex="5";paper.append(input);input.focus();input.select();
      let cancel=false;input.addEventListener("keydown",event=>{event.stopPropagation();if(event.key==="Escape"){cancel=true;input.blur();}if(event.key==="Enter"){event.preventDefault();input.blur();}});
      input.addEventListener("blur",()=>{const value=input.value.trim();input.remove();if(!cancel&&value!==(A.C.state.score.meta[key]||""))commit("악보 제목·저작자",s=>{s.meta[key]=value;});},{once:true});
    });
    if(window.launchQueue)window.launchQueue.setConsumer(async params=>{for(const handle of params.files||[]) {const file=await handle.getFile();A.setReadOnly(false);A.IO.loadScoreFile(file,A.handleLoadedScore);}});
  }
  SF.uiV3={init,refresh,drawLoop,toggleLoop,seekToEvent,measureAction,ornament,ottava,contextMenu,loadSettingsExtras};
})(window.SF);
