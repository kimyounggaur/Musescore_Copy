/* File/export dialogs live here; the score and renderer remain independent. */
"use strict";
(function (SF) {
  let A, embeddedFont;
  async function fontStyle() {
    if(embeddedFont)return embeddedFont;
    const response=await fetch("fonts/Bravura.woff2");
    if(!response.ok)throw new Error("악보 글꼴을 불러오지 못했어요.");
    const data=await response.arrayBuffer();let binary="";for(const n of new Uint8Array(data))binary+=String.fromCharCode(n);
    embeddedFont=`<style>@font-face{font-family:BravuraSF;src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}</style>`;
    return embeddedFont;
  }
  async function exportPages() {
    const result=await A.E.renderForExport(A.C.state.score,{viewMode:A.ui.viewMode,pageMode:"pages",multiRest:A.ui.viewMode.type==="part"&&A.ui.multiRest,numberFirstPage:true});
    // The renderer already emits vector glyphs; unavailable fonts must not block export.
    const font=await fontStyle().catch(()=>"");return {layout:result.layout,pages:result.pages.map(svg=>svg.replace(/(<svg\b[^>]*>)/,"$1"+font))};
  }
  async function png(svg, page) {
    const blob=new Blob([svg],{type:"image/svg+xml;charset=utf-8"}),url=URL.createObjectURL(blob);
    try {
      const image=new Image();image.src=url;await image.decode();
      const layout=A.C.ensureLayout(A.C.state.score), landscape=layout.orientation==="landscape";
      const inches=layout.pageSize==="Letter"?(landscape?11:8.5):(landscape?297:210)/25.4;
      const heightInches=layout.pageSize==="Letter"?(landscape?8.5:11):(landscape?210:297)/25.4;
      const width=Math.round(inches*300),height=Math.round(heightInches*300);
      const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
      const bitmap=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("PNG 변환에 실패했어요.")),"image/png"));
      return pngDpi(bitmap,300);
    } finally {URL.revokeObjectURL(url);}
  }
  async function pngDpi(blob,dpi) {
    const data=new Uint8Array(await blob.arrayBuffer()),view=new DataView(data.buffer);
    const chunk=new Uint8Array(21),cv=new DataView(chunk.buffer);cv.setUint32(0,9);chunk.set([112,72,89,115],4);
    cv.setUint32(8,Math.round(dpi/0.0254));cv.setUint32(12,Math.round(dpi/0.0254));chunk[16]=1;
    let crc=0xffffffff;for(const byte of chunk.subarray(4,17)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}cv.setUint32(17,(crc^0xffffffff)>>>0);
    const parts=[data.slice(0,8)];let offset=8;
    while(offset+12<=data.length){const end=offset+view.getUint32(offset)+12;const type=String.fromCharCode(...data.slice(offset+4,offset+8));if(type!=="pHYs")parts.push(data.slice(offset,end));if(type==="IHDR")parts.push(chunk);offset=end;}
    return new Blob(parts,{type:"image/png"});
  }
  /** 내보낼 파일 이름 계획(순수 함수). 한 쪽이면 지금처럼 파일 하나, 여러 쪽이면 쪽마다 번호를 붙여 ZIP 하나(`이름-svg.zip`)로 묶는다.
   *  쪽 번호는 쪽 수의 자릿수만큼 0을 채워(10쪽 이상이면 -01) 이름순이 쪽 순서가 되게 한다. 9쪽까지는 기존 이름(-1)과 같다.
   *  safeName이 못 거르는 제어 문자는 밑줄로 바꾼다(ZIP 이름 검사가 거절하므로). */
  function planFiles(format,title,count) {
    const base=SF.io.safeName(title).replace(/[\u0000-\u001f\u007f]/g,"_");
    if(count<2)return {zip:false,filename:`${base}.${format}`,entries:[`${base}.${format}`]};
    const width=String(count).length;
    return {zip:true,filename:`${base}-${format}.zip`,entries:Array.from({length:count},(_,i)=>`${base}-${String(i+1).padStart(width,"0")}.${format}`)};
  }
  async function download(format) {
    try {
      const result=await exportPages(),plan=planFiles(format,A.C.state.score.meta.title,result.pages.length),mime=format==="png"?"image/png":"image/svg+xml";
      const pages=[];   // 쪽마다 내용(SVG는 글, PNG는 Blob). PNG는 캔버스를 한 장씩 차례로 만든다(동시에 여러 장을 그리지 않는다)
      for(let i=0;i<result.pages.length;i++)pages.push(format==="png"?await png(result.pages[i],result.layout.pages[i]):result.pages[i]);
      if(!plan.zip) {
        for(const data of pages)A.IO.download(plan.filename,data,mime);
        A.toast(format==="png"?"300dpi PNG를 내보냈어요.":"글꼴을 포함한 SVG를 내보냈어요.");
        return;
      }
      const entries=await Promise.all(pages.map(async(page,i)=>({name:plan.entries[i],data:format==="png"?new Uint8Array(await page.arrayBuffer()):page})));
      A.IO.download(plan.filename,SF.zip.create(entries),"application/zip");
      A.toast(format==="png"?"300dpi PNG를 ZIP 파일 하나로 묶어 내보냈어요.":"글꼴을 포함한 SVG를 ZIP 파일 하나로 묶어 내보냈어요.");
    } catch(error){A.toast(error.message);}
  }
  async function print() {
    const ok=await SF.ui.confirmDialog({title:"인쇄/PDF",message:"인쇄 창에서 '대상'을 'PDF로 저장'으로 고르면 PDF 파일로 보관할 수 있어요(악보가 벡터 품질로 저장돼요). 배율은 100%, 여백은 없음, 머리글·바닥글은 끄기로 설정하세요.",confirmText:"인쇄 열기"});
    if(!ok)return;
    try {
      const result=await exportPages();const host=document.createElement("div");host.id="print-pages";host.innerHTML=result.pages.join("");
      const style=document.createElement("style"),layout=A.C.ensureLayout(A.C.state.score);style.textContent=`@page { size: ${layout.pageSize==="Letter"?"letter":"A4"} ${layout.orientation}; margin:0; }`;
      document.head.append(style);document.body.append(host);
      const clean=()=>{host.remove();style.remove();};window.addEventListener("afterprint",clean,{once:true});
      await document.fonts.ready;window.print();
    } catch(error){A.toast(error.message);}
  }
  function midiOptions(parsed,file) {
    return new Promise(resolve=>{
      const dialog=document.createElement("dialog");dialog.id="dlg-midi-import";
      const form=document.createElement("form");form.className="dlg-body";
      const h=document.createElement("h2");h.textContent="MIDI 가져오기";const name=document.createElement("p");name.textContent=file.name;
      const label=document.createElement("label");label.htmlFor="midi-grid";label.textContent="리듬 격자";
      const grid=document.createElement("select");grid.id="midi-grid";for(const d of [8,16,32])grid.add(new Option(`${d}분음표`,String(1/d)));grid.value=String(1/16);
      const triplets=document.createElement("label"),triplet=document.createElement("input");triplet.type="checkbox";triplet.id="midi-triplets";triplets.append(triplet,document.createTextNode("셋잇단음표 감지"));
      const tracks=document.createElement("fieldset");const legend=document.createElement("legend");legend.textContent="가져올 트랙";tracks.append(legend);
      const choices=[];
      (parsed.tracks||[]).forEach((track,i)=>{const l=document.createElement("label"),c=document.createElement("input");c.type="checkbox";c.checked=true;c.value=i;choices.push(c);l.append(c,document.createTextNode(track.name||`트랙 ${i+1}`));tracks.append(l);});
      const error=document.createElement("p");error.setAttribute("role","alert");const actions=document.createElement("div");actions.className="dlg-actions";
      const cancel=document.createElement("button");cancel.type="button";cancel.className="tbtn";cancel.textContent="취소";cancel.onclick=()=>dialog.close();
      const apply=document.createElement("button");apply.type="submit";apply.className="tbtn primary";apply.textContent="가져오기";actions.append(cancel,apply);
      form.append(h,name,label,grid,triplets,tracks,error,actions);dialog.append(form);document.body.append(dialog);let result=null;
      form.addEventListener("submit",e=>{e.preventDefault();const selected=choices.filter(c=>c.checked).map(c=>+c.value);if(!selected.length){error.textContent="트랙을 하나 이상 선택하세요.";return;}result={grid:+grid.value,detectTriplets:triplet.checked,tracks:selected};dialog.close();});
      dialog.addEventListener("close",()=>{dialog.remove();resolve(result);},{once:true});SF.ui.open(dialog);
    });
  }
  function init(api) {
    A=api;A.IO.requestMidiOptions=midiOptions;
    window.addEventListener("beforeprint",()=>{
      if(document.getElementById("print-pages"))return;
      const result=A.E.render(A.C.state.score,{viewMode:A.ui.viewMode,pageMode:"pages",multiRest:A.ui.viewMode.type==="part"&&A.ui.multiRest,export:true,fallback:true,preserveLayout:true});
      const host=document.createElement("div");host.id="print-pages";host.innerHTML=result.pages.join("");document.body.append(host);
    });
    window.addEventListener("afterprint",()=>document.getElementById("print-pages")?.remove());
    let anchor=A.$('#file-menu [data-act="midi"]');   // 내보내기 묶음 안, MIDI 바로 뒤에 SVG·PNG를 차례로 끼운다
    for(const [format,label]of [["svg","SVG 내보내기 (글꼴 포함)"],["png","PNG 내보내기 (300dpi)"]]){
      const b=document.createElement("button");b.className="mi";b.dataset.act=format;b.type="button";b.setAttribute("role","menuitem");b.textContent=label;anchor.after(b);anchor=b;
      SF.keymap.registerCommand({id:`export-${format}`,label,run:()=>download(format)});
    }
    SF.keymap.registerCommand({id:"print",label:"인쇄/PDF",run:print});
  }
  SF.exportUI={init,download,print,exportPages,midiOptions,planFiles};
})(window.SF);
