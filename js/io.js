/* =========================================================================
 * ScoreForge io — 저장/열기(JSON), MusicXML 내보내기, 자동 저장, 데모 악보
 * ========================================================================= */
"use strict";
(function (SF) {
  const C = SF.core;
  const { Fraction } = SF;

  /* ---------------- 파일 다운로드/업로드 ---------------- */
  function download(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function safeName(title) {
    return (title || "악보").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  }

  function saveJSON(score) {
    download(safeName(score.meta.title) + ".scoreforge.json",
      JSON.stringify({ app: "scoreforge", version: 1, score: C.toJSON(score) }, null, 1),
      "application/json");
  }

  function openJSON(onLoaded) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          const raw = obj.score && obj.score.measures ? obj.score : (obj.measures ? obj : null);
          if (!raw) throw new Error("형식이 다릅니다");
          onLoaded(C.fromJSON(raw), file.name);
        } catch (err) {
          onLoaded(null, file.name, err);
        }
      };
      reader.readAsText(file, "utf-8");
    };
    input.click();
  }

  /* ---------------- 자동 저장 ---------------- */
  const AUTOSAVE_KEY = "scoreforge.autosave.v1";
  let saveTimer = null;
  function autosave(score) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), score: C.toJSON(score) }));
      } catch (e) { /* 저장공간 부족 등 — 무시 */ }
    }, 700);
  }
  function loadAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj.score || !obj.score.measures) return null;
      return C.fromJSON(obj.score);
    } catch (e) { return null; }
  }
  function clearAutosave() { try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { } }

  /* ---------------- MusicXML 내보내기 ---------------- */
  const TYPE_NAMES = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th" };
  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const DYN_SOUND = { pp: 40, p: 54, mp: 66, mf: 78, f: 91, ff: 105 };

  function exportMusicXML(score) {
    C.ensureParts(score);
    const DIV = 8; // 4분음표당 division
    const units = (dur) => Math.round(C.durValue(dur).value * 4 * DIV);
    const L = C.measureLen(score);
    const measureUnits = Math.round(L.value * 4 * DIV);
    const refs = C.staffRefs(score);
    const maxMeasures = Math.max(...refs.map(r => r.measures.length));

    // 스패너 앵커 맵 (slur 번호 1~6 순환)
    const slurStart = new Map(), slurStop = new Map(), wedgeStart = new Map(), wedgeStop = new Map();
    (score.spanners || []).forEach((sp, i) => {
      const num = (i % 6) + 1;
      const put = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };
      if (sp.type === "slur") {
        put(slurStart, sp.startId, { num });
        put(slurStop, sp.endId, { num });
      } else if (sp.type === "cresc" || sp.type === "dim") {
        put(wedgeStart, sp.startId, { num, kind: sp.type === "cresc" ? "crescendo" : "diminuendo" });
        put(wedgeStop, sp.endId, { num });
      }
    });

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
 <work><work-title>${xmlEsc(score.meta.title || "")}</work-title></work>
 <identification>
  <creator type="composer">${xmlEsc(score.meta.composer || "")}</creator>
  <encoding><software>ScoreForge</software></encoding>
 </identification>
 <part-list>\n`;
    score.parts.forEach((part, pIdx) => {
      const gm = (SF.playback.INSTRUMENTS[part.instrument] || SF.playback.INSTRUMENTS.piano).gm;
      xml += `  <score-part id="P${pIdx + 1}"><part-name>${xmlEsc(part.name || "악기")}</part-name>
   <midi-instrument id="P${pIdx + 1}-I1"><midi-channel>${pIdx + 1}</midi-channel><midi-program>${gm + 1}</midi-program></midi-instrument>
  </score-part>\n`;
    });
    xml += ` </part-list>\n`;

    score.parts.forEach((part, pIdx) => {
      const partRefs = refs.filter(r => r.partIdx === pIdx);
      xml += ` <part id="P${pIdx + 1}">\n`;
      for (let mIdx = 0; mIdx < maxMeasures; mIdx++) {
        xml += `  <measure number="${mIdx + 1}">\n`;
        if (mIdx === 0) {
          xml += `   <attributes>
    <divisions>${DIV}</divisions>
    <key><fifths>${score.keySig}</fifths></key>
    <time><beats>${score.timeSig.num}</beats><beat-type>${score.timeSig.den}</beat-type></time>
    ${partRefs.length > 1 ? `<staves>${partRefs.length}</staves>` : ""}
    ${partRefs.map((ref, i) => `<clef${partRefs.length > 1 ? ` number="${i + 1}"` : ""}><sign>${ref.clef === "bass" ? "F" : "G"}</sign><line>${ref.clef === "bass" ? 4 : 2}</line></clef>`).join("\n    ")}
   </attributes>\n`;
          if (pIdx === 0) xml += `   <direction placement="above"><direction-type>
    <metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome>
   </direction-type><sound tempo="${score.tempo}"/></direction>\n`;
        }

        partRefs.forEach((ref, sIdx) => {
          if (sIdx > 0) xml += `   <backup><duration>${measureUnits}</duration></backup>\n`;
          const mm = ref.measures[mIdx] || { events: [{ id: "", type: "rest", full: true, dur: { n: L.n, d: L.d, dots: 0 }, notes: [] }] };
          mm.events.forEach((ev, eIdx) => {
            const staffTag = partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : "";
            const tp = ev.dur.tuplet;
            const timeMod = tp ? `<time-modification><actual-notes>${tp.actual}</actual-notes><normal-notes>${tp.normal}</normal-notes></time-modification>` : "";
            const tpStart = tp && (!mm.events[eIdx - 1] || mm.events[eIdx - 1].dur.tuplet?.id !== tp.id);
            const tpStop = tp && (!mm.events[eIdx + 1] || mm.events[eIdx + 1].dur.tuplet?.id !== tp.id);
            if (ev.dynamic && DYN_SOUND[ev.dynamic]) {
              xml += `   <direction placement="below"><direction-type><dynamics><${ev.dynamic}/></dynamics></direction-type>` +
                `${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}<sound dynamics="${DYN_SOUND[ev.dynamic]}"/></direction>\n`;
            }
            for (const w of wedgeStart.get(ev.id) || []) {
              xml += `   <direction placement="below"><direction-type><wedge type="${w.kind}" number="${w.num}"/></direction-type>${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}</direction>\n`;
            }

            if (ev.type === "rest") {
              if (ev.full) {
                xml += `   <note><rest measure="yes"/><duration>${measureUnits}</duration><voice>1</voice>${staffTag}</note>\n`;
              } else {
                let notations = "";
                if (tpStart) notations += `<tuplet type="start"/>`;
                if (tpStop) notations += `<tuplet type="stop"/>`;
                xml += `   <note><rest/><duration>${units(ev.dur)}</duration><voice>1</voice><type>${TYPE_NAMES[ev.dur.d]}</type>${"<dot/>".repeat(ev.dur.dots || 0)}${timeMod}${staffTag}${notations ? `<notations>${notations}</notations>` : ""}</note>\n`;
              }
            } else {
              ev.notes.forEach((note, nIdx) => {
                const stop = C.isTiedFrom(score, mIdx, eIdx, note, ref);
                const start = !!note.tie;
                xml += `   <note>${nIdx > 0 ? "<chord/>" : ""}<pitch><step>${C.STEP_EN[note.step]}</step>` +
                  (note.alter ? `<alter>${note.alter}</alter>` : "") +
                  `<octave>${note.oct}</octave></pitch>` +
                  `<duration>${units(ev.dur)}</duration>` +
                  (stop ? `<tie type="stop"/>` : "") + (start ? `<tie type="start"/>` : "") +
                  `<voice>1</voice><type>${TYPE_NAMES[ev.dur.d]}</type>${"<dot/>".repeat(ev.dur.dots || 0)}${timeMod}${staffTag}`;
                let notations = "";
                if (stop) notations += `<tied type="stop"/>`;
                if (start) notations += `<tied type="start"/>`;
                if (nIdx === 0) {
                  if (tpStart) notations += `<tuplet type="start"/>`;
                  if (tpStop) notations += `<tuplet type="stop"/>`;
                  for (const sl of slurStop.get(ev.id) || []) notations += `<slur type="stop" number="${sl.num}"/>`;
                  for (const sl of slurStart.get(ev.id) || []) notations += `<slur type="start" number="${sl.num}"/>`;
                  const ar = ev.artics || [];
                  const artXml =
                    (ar.includes("accent") ? "<accent/>" : "") +
                    (ar.includes("marcato") ? "<strong-accent/>" : "") +
                    (ar.includes("staccato") ? "<staccato/>" : "") +
                    (ar.includes("tenuto") ? "<tenuto/>" : "");
                  if (artXml) notations += `<articulations>${artXml}</articulations>`;
                  if (ar.includes("fermata")) notations += `<fermata/>`;
                }
                if (notations) xml += `<notations>${notations}</notations>`;
                if (nIdx === 0 && ev.lyric) {
                  xml += `<lyric number="1"><syllabic>single</syllabic><text>${xmlEsc(ev.lyric)}</text></lyric>`;
                }
                xml += `</note>\n`;
              });
            }

            for (const w of wedgeStop.get(ev.id) || []) {
              xml += `   <direction placement="below"><direction-type><wedge type="stop" number="${w.num}"/></direction-type>${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}</direction>\n`;
            }
          });
        });
        xml += `  </measure>\n`;
      }
      xml += ` </part>\n`;
    });
    xml += `</score-partwise>\n`;
    return xml;
  }

  /* ====================================================================
   * MusicXML 가져오기 (Step 6-3) — 세상의 MusicXML은 더럽다. 방어적으로.
   * 우리 모델로 줄이면서 버린 것은 전부 리포트에 수집한다.
   * ==================================================================== */

  /* ---- .mxl(zip) 해제: 외부 라이브러리 없이 중앙 디렉토리 직접 파싱 ---- */
  async function readMxl(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("mxl(zip) 형식이 아니에요");
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count && off + 46 <= u8.length; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const cmtLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
      entries.push({ name, method, compSize, lho });
      off += 46 + nameLen + extraLen + cmtLen;
    }
    const readEntry = async (ent) => {
      const nameLen = dv.getUint16(ent.lho + 26, true);
      const extraLen = dv.getUint16(ent.lho + 28, true);
      const dataOff = ent.lho + 30 + nameLen + extraLen;
      const data = u8.subarray(dataOff, dataOff + ent.compSize);
      if (ent.method === 0) return new TextDecoder().decode(data);
      if (ent.method === 8) {
        if (typeof DecompressionStream === "undefined")
          throw new Error("이 브라우저는 mxl 압축 해제를 지원하지 않아요 (최신 브라우저 필요)");
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      }
      throw new Error("지원하지 않는 zip 압축 방식이에요");
    };
    // META-INF/container.xml → rootfile 경로
    let rootPath = null;
    const cont = entries.find(e => e.name === "META-INF/container.xml");
    if (cont) {
      try {
        const cdoc = new DOMParser().parseFromString(await readEntry(cont), "application/xml");
        rootPath = cdoc.querySelector("rootfile")?.getAttribute("full-path") || null;
      } catch (e) { /* container 손상 → 휴리스틱으로 */ }
    }
    let entry = rootPath ? entries.find(e => e.name === rootPath) : null;
    if (!entry) entry = entries.find(e => !e.name.startsWith("META-INF") && /\.(musicxml|xml)$/i.test(e.name));
    if (!entry) throw new Error("mxl 안에서 악보 xml을 찾지 못했어요");
    return readEntry(entry);
  }

  /* ---- MusicXML 파서 ---- */
  const DYN_IMPORT = {
    pp: "pp", p: "p", mp: "mp", mf: "mf", f: "f", ff: "ff",
    ppp: "pp", pppp: "pp", ppppp: "pp", fff: "ff", ffff: "ff", fffff: "ff",
    sf: "f", sfz: "f", fz: "f", rf: "f", rfz: "f", fp: "f", sffz: "ff", pf: "mf",
  };
  const STEP_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

  function parseMusicXML(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML을 읽을 수 없어요 (파싱 오류)");
    let root = doc.querySelector("score-partwise");
    let timewise = false;
    if (!root) { root = doc.querySelector("score-timewise"); timewise = !!root; }
    if (!root) throw new Error("MusicXML 악보가 아니에요");

    const report = [];
    const counts = new Map(); // key → {msg, n}
    const warn = (msg) => report.push(msg);
    const countWarn = (key, msg) => {
      const c = counts.get(key) || { msg, n: 0 };
      c.n++; counts.set(key, c);
    };
    const textOf = (el, sel) => {
      const t = sel ? el?.querySelector(sel) : el;
      return t ? t.textContent.trim() : "";
    };

    // ---- 파트 선택 (첫 파트) ----
    let measEls;
    if (!timewise) {
      const parts = [...root.children].filter(el => el.tagName === "part");
      if (!parts.length) throw new Error("파트가 없어요");
      if (parts.length > 1) warn(`파트 ${parts.length}개 중 첫 번째만 가져왔어요`);
      measEls = [...parts[0].children].filter(el => el.tagName === "measure");
    } else {
      warn("timewise 형식을 변환해서 읽었어요");
      const allM = [...root.children].filter(el => el.tagName === "measure");
      const firstParts = allM.length ? [...allM[0].children].filter(el => el.tagName === "part") : [];
      if (!firstParts.length) throw new Error("파트가 없어요");
      if (firstParts.length > 1) warn(`파트 ${firstParts.length}개 중 첫 번째만 가져왔어요`);
      const pid = firstParts[0].getAttribute("id");
      measEls = allM
        .map(me => [...me.children].find(p => p.tagName === "part" && p.getAttribute("id") === pid))
        .filter(Boolean);
    }
    if (!measEls.length) throw new Error("마디가 없어요");
    if (measEls.length > 500) {
      warn(`마디가 많아 앞 500마디만 가져왔어요 (전체 ${measEls.length}마디)`);
      measEls = measEls.slice(0, 500);
    }

    // ---- 메타 ----
    const title = textOf(root, "work > work-title") || textOf(root, "movement-title") || "가져온 악보";
    const composer = textOf(root.querySelector('identification creator[type="composer"]'));

    // ---- 본문 스캔 ----
    let divisions = 1;
    let timeSig = null, keySig = null, clef = null, tempo = null;
    let chosenVoice = null, chosenStaff = null;
    let pendingDynamic = null;
    const pendingWedges = new Map(); // number → {type, startItem|null}
    const wedgePairs = [];
    const items = []; // 선택 성부의 음표들
    const measureLens = [];
    let lastNoteItem = null;

    const durFrac = (el) => {
      const d = Math.round(+textOf(el, "duration") || 0);
      return SF.F(Math.max(0, d), Math.max(1, divisions * 4));
    };

    measEls.forEach((me, mIdx) => {
      let cur = SF.F(0, 1), maxCur = cur;
      for (const el of [...me.children]) {
        const tag = el.tagName;
        if (tag === "attributes") {
          const dv2 = parseInt(textOf(el, "divisions"), 10);
          if (dv2 > 0) divisions = dv2;
          const fifths = textOf(el, "key > fifths");
          if (fifths !== "") {
            const k = Math.max(-7, Math.min(7, parseInt(fifths, 10) || 0));
            if (keySig === null) keySig = k;
            else if (keySig !== k) countWarn("key", "조표 변경은 지원하지 않아 첫 조표만 사용");
          }
          const beats = parseInt(textOf(el, "time > beats"), 10);
          const beatType = parseInt(textOf(el, "time > beat-type"), 10);
          if (beats > 0 && beatType > 0) {
            if (timeSig === null) timeSig = { num: beats, den: beatType };
            else if (timeSig.num !== beats || timeSig.den !== beatType)
              countWarn("time", "박자 변경은 지원하지 않아 첫 박자만 사용");
          }
          const clefEl = el.querySelector("clef");
          if (clefEl) {
            const sign = textOf(clefEl, "sign");
            const mapped = sign === "F" ? "bass" : "treble";
            if (sign !== "G" && sign !== "F") countWarn("clef", "지원하지 않는 음자리표는 높은음자리표로 표시");
            if (clef === null) clef = mapped;
            else if (clef !== mapped) countWarn("clefchg", "중간 음자리표 변경은 무시");
          }
          if (parseInt(textOf(el, "staves"), 10) > 1) countWarn("staves", "여러 단 보표 중 첫 단만 가져옴");
          if (el.querySelector("transpose")) countWarn("transpose", "조옮김 악기 정보는 무시(적힌 음 그대로)");
        } else if (tag === "direction" || tag === "sound") {
          const soundEl = tag === "sound" ? el : el.querySelector("sound");
          const t = soundEl?.getAttribute("tempo") || textOf(el, "metronome > per-minute");
          if (t && !isNaN(+t)) {
            if (tempo === null) tempo = Math.max(30, Math.min(280, Math.round(+t)));
            else countWarn("tempo", "템포 변경은 첫 값만 사용");
          }
          if (tag === "direction") {
            const dynEl = el.querySelector("direction-type dynamics > *");
            if (dynEl) {
              const mark = DYN_IMPORT[dynEl.tagName];
              if (mark) pendingDynamic = mark;
              else countWarn("dyn", `지원하지 않는 셈여림은 무시`);
            }
            for (const w of el.querySelectorAll("direction-type wedge")) {
              const wt = w.getAttribute("type");
              const num = w.getAttribute("number") || "1";
              if (wt === "crescendo" || wt === "diminuendo") {
                pendingWedges.set(num, { type: wt === "crescendo" ? "cresc" : "dim", startItem: null });
              } else if (wt === "stop") {
                const open = pendingWedges.get(num) || [...pendingWedges.values()][0];
                if (open && open.startItem && lastNoteItem) {
                  wedgePairs.push({ type: open.type, start: open.startItem, end: lastNoteItem });
                  pendingWedges.delete(num);
                } else {
                  pendingWedges.delete(num);
                  countWarn("wedge", "짝이 맞지 않는 쐐기(헤어핀) 무시");
                }
              }
            }
            if (el.querySelector("direction-type octave-shift")) countWarn("oct", "옥타브 선(8va)은 무시");
          }
        } else if (tag === "backup") {
          cur = cur.sub(durFrac(el));
          if (cur.n < 0) { cur = SF.F(0, 1); countWarn("backup", "backup 위치 오차 보정"); }
        } else if (tag === "forward") {
          cur = cur.add(durFrac(el));
        } else if (tag === "harmony") {
          countWarn("harmony", "코드 기호는 무시");
        } else if (tag === "barline") {
          if (el.querySelector("repeat") || el.querySelector("ending")) countWarn("repeat", "도돌이표/볼타는 무시(전개 없음)");
        } else if (tag === "note") {
          const isChord = !!el.querySelector(":scope > chord");
          const isRest = !!el.querySelector(":scope > rest");
          if (el.querySelector(":scope > grace")) { countWarn("grace", "꾸밈음(grace)은 무시"); continue; }
          const voice = textOf(el, ":scope > voice") || "1";
          const staff = textOf(el, ":scope > staff") || "1";
          const dF = durFrac(el);
          if (chosenVoice === null && !isRest) chosenVoice = voice;
          if (chosenStaff === null) chosenStaff = staff;
          const mine = (chosenVoice === null || voice === chosenVoice) && staff === chosenStaff;
          if (!mine) {
            if (staff !== chosenStaff) countWarn("staves", "여러 단 보표 중 첫 단만 가져옴");
            else countWarn("voice", "두 번째 이후 성부는 건너뜀");
            if (!isChord) { cur = cur.add(dF); if (cur.gt(maxCur)) maxCur = cur; }
            continue;
          }
          if (isRest) {
            if (!isChord) { cur = cur.add(dF); if (cur.gt(maxCur)) maxCur = cur; }
            continue;
          }
          // ---- 음높이 ----
          const pEl = el.querySelector(":scope > pitch");
          if (!pEl) {
            countWarn("unpitched", "무율(타악) 음표는 무시");
            if (!isChord) { cur = cur.add(dF); if (cur.gt(maxCur)) maxCur = cur; }
            continue;
          }
          const stepCh = textOf(pEl, "step").toUpperCase();
          let alter = Math.round(parseFloat(textOf(pEl, "alter") || "0")) || 0;
          let oct = parseInt(textOf(pEl, "octave"), 10);
          if (!(stepCh in STEP_IDX) || isNaN(oct)) {
            countWarn("badpitch", "읽을 수 없는 음높이 건너뜀");
            if (!isChord) { cur = cur.add(dF); if (cur.gt(maxCur)) maxCur = cur; }
            continue;
          }
          oct = Math.max(0, Math.min(8, oct));
          let pitch = { step: STEP_IDX[stepCh], alter, oct };
          if (Math.abs(alter) > 1) {
            pitch = C.spellMidi(C.midiOf(pitch), keySig ?? 0);
            countWarn("respell", "겹임시표는 같은 소리의 다른 철자로 변환");
          }
          if (el.querySelector("time-modification")) countWarn("tuplet", "잇단음표는 16분 격자로 근사");
          const tieStart = !!el.querySelector(':scope > tie[type="start"]') ||
            !!el.querySelector('notations tied[type="start"]');

          if (isChord && lastNoteItem && lastNoteItem.mIdx === mIdx) {
            lastNoteItem.pitches.push({ ...pitch, tie: tieStart });
          } else {
            const item = {
              mIdx, tick: cur, dur: dF,
              pitches: [{ ...pitch, tie: tieStart }],
              lyric: null, artics: [], dynamic: pendingDynamic,
              slurStarts: [], slurStops: [],
            };
            pendingDynamic = null;
            // 가사 (1절만)
            const lyrEl = el.querySelector(":scope > lyric");
            if (lyrEl) {
              item.lyric = [...lyrEl.querySelectorAll("text")].map(t => t.textContent).join("") || null;
              if (el.querySelectorAll(":scope > lyric").length > 1) countWarn("verse", "가사는 1절만 가져옴");
            }
            // 아티큘레이션·페르마타·슬러
            const not = el.querySelector("notations");
            if (not) {
              const art = not.querySelector("articulations");
              if (art) {
                for (const a of [...art.children]) {
                  if (a.tagName === "staccato") item.artics.push("staccato");
                  else if (a.tagName === "staccatissimo") { item.artics.push("staccato"); countWarn("artic", "일부 아티큘레이션은 비슷한 기호로 대체"); }
                  else if (a.tagName === "tenuto") item.artics.push("tenuto");
                  else if (a.tagName === "accent") item.artics.push("accent");
                  else if (a.tagName === "strong-accent") item.artics.push("marcato");
                  else if (a.tagName === "detached-legato") { item.artics.push("staccato", "tenuto"); }
                  else countWarn("artic", "일부 아티큘레이션은 비슷한 기호로 대체");
                }
              }
              if (not.querySelector("fermata")) item.artics.push("fermata");
              for (const sl of not.querySelectorAll("slur")) {
                const num = sl.getAttribute("number") || "1";
                if (sl.getAttribute("type") === "start") item.slurStarts.push(num);
                else if (sl.getAttribute("type") === "stop") item.slurStops.push(num);
              }
              if (not.querySelector("ornaments, glissando, slide, arpeggiate, tremolo"))
                countWarn("orn", "장식음·글리산도·트레몰로 등은 무시");
            }
            items.push(item);
            lastNoteItem = item;
            for (const w of pendingWedges.values()) if (!w.startItem) w.startItem = item;
            cur = cur.add(dF);
          }
          if (cur.gt(maxCur)) maxCur = cur;
        }
      }
      measureLens.push(maxCur);
    });

    // ---- 악보 구성 ----
    if (!timeSig) { timeSig = { num: 4, den: 4 }; warn("박자표가 없어 4/4로 가정했어요"); }
    const score = C.createScore({
      title, composer,
      keySig: keySig ?? 0, timeSig, tempo: tempo || 100,
      clef: clef || "treble", measureCount: Math.max(1, measEls.length),
    });
    const L = C.measureLen(score);

    // 못갖춘마디(여린내기): 첫 마디 내용을 오른쪽 정렬
    let offset0 = SF.F(0, 1);
    if (measureLens[0] && measureLens[0].n > 0 && measureLens[0].lt(L)) {
      offset0 = SF.F(Math.round(L.sub(measureLens[0]).value * 16), 16);
      if (offset0.n > 0) warn("못갖춘마디(여린내기)는 앞을 쉼표로 채웠어요");
    }

    const q16 = (f) => SF.F(Math.round(f.value * 16), 16);
    let placed = 0;
    for (const item of items) {
      let tick = item.tick;
      if (item.mIdx === 0) tick = tick.add(offset0);
      const qTick = q16(tick);
      let qDur = q16(tick.add(item.dur)).sub(qTick);
      if (qDur.n <= 0) { countWarn("tiny", "너무 짧은 음(32분 이하 등)은 격자 근사로 생략"); continue; }
      if (qTick.n < 0 || qTick.gte(L)) { countWarn("ofl", "마디 범위를 벗어난 음 무시"); continue; }
      if (qTick.add(qDur).gt(L)) qDur = L.sub(qTick);
      const pieces = C.decompose(qTick, qDur);
      const evs = pieces.map((d, i) => ({
        id: C.newId(), type: "note", dur: d,
        notes: item.pitches.map(p => ({ step: p.step, alter: p.alter, oct: p.oct, tie: i < pieces.length - 1 ? true : !!p.tie })),
      }));
      if (item.lyric) evs[0].lyric = item.lyric;
      if (item.artics.length) evs[0].artics = [...new Set(item.artics)];
      if (item.dynamic) evs[0].dynamic = item.dynamic;
      C.replaceRange(score, item.mIdx, qTick, qDur, () => evs);
      item.firstId = evs[0].id;
      item.lastId = evs[evs.length - 1].id;
      placed++;
    }
    for (let i = 0; i < score.measures.length; i++) C.consolidateRests(score, i);
    C.normalizeTies(score);

    // ---- 스패너 복원 ----
    const openSlurs = new Map();
    for (const item of items) {
      if (!item.firstId) continue;
      for (const num of item.slurStops) {
        const sid = openSlurs.get(num);
        if (sid && sid !== item.firstId) {
          score.spanners.push({ id: C.newId(), type: "slur", startId: sid, endId: item.firstId });
          openSlurs.delete(num);
        }
      }
      for (const num of item.slurStarts) openSlurs.set(num, item.firstId);
    }
    if (openSlurs.size) countWarn("slur", "짝이 없는 이음줄 무시");
    for (const w of wedgePairs) {
      if (w.start.firstId && w.end.lastId)
        score.spanners.push({ id: C.newId(), type: w.type, startId: w.start.firstId, endId: w.end.lastId });
    }
    C.normalizeSpanners(score);

    // ---- 리포트 정리 ----
    for (const { msg, n } of counts.values()) report.push(`${msg} (${n}건)`);
    return { score: C.fromJSON(C.toJSON(score)), report, placed };
  }

  /* ---- 통합 열기: .json / .musicxml / .xml / .mxl ---- */
  function openScoreDialog(onLoaded) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.musicxml,.xml,.mxl,application/json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) loadScoreFile(file, onLoaded);
    };
    input.click();
  }

  function loadScoreFile(file, onLoaded) {
    const name = file.name || "악보";
    const fail = (err) => onLoaded(null, name, err, []);
    const lower = name.toLowerCase();
    if (lower.endsWith(".mxl")) {
      file.arrayBuffer()
        .then(readMxl)
        .then(xml => { const r = parseMusicXML(xml); onLoaded(r.score, name, null, r.report); })
        .catch(fail);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const head = text.slice(0, 300).replace(/^﻿/, "").trimStart();
        if (head.startsWith("{")) {
          const obj = JSON.parse(text.replace(/^﻿/, ""));
          const raw = obj.score && obj.score.measures ? obj.score : (obj.measures ? obj : null);
          if (!raw) throw new Error("ScoreForge 악보 파일이 아니에요");
          onLoaded(C.fromJSON(raw), name, null, []);
        } else if (head.startsWith("<")) {
          const r = parseMusicXML(text);
          onLoaded(r.score, name, null, r.report);
        } else {
          throw new Error("알 수 없는 파일 형식이에요");
        }
      } catch (err) { fail(err); }
    };
    reader.onerror = () => fail(new Error("파일을 읽지 못했어요"));
    reader.readAsText(file, "utf-8");
  }

  /* ---------------- 데모 악보 ----------------
   * 토큰: "G4" (4분음표) / "G4:h" / "r:q" 쉼표 / 길이 w h q e s, '.'=점
   */
  function buildDemo(spec) {
    const score = C.createScore({
      title: spec.title, composer: spec.composer || "",
      keySig: spec.keySig || 0, timeSig: spec.timeSig || { num: 4, den: 4 },
      tempo: spec.tempo || 100, measureCount: spec.bars.length,
      clef: spec.clef || "treble", instrument: spec.instrument || "piano",
    });
    const DUR = { w: { n: 1, d: 1 }, h: { n: 1, d: 2 }, q: { n: 1, d: 4 }, e: { n: 1, d: 8 }, s: { n: 1, d: 16 } };
    spec.bars.forEach((bar, mIdx) => {
      let tick = Fraction.ZERO;
      bar.trim().split(/\s+/).forEach(tok => {
        if (!tok) return;
        let [head, durCode] = tok.split(":");
        durCode = durCode || "q";
        const dots = durCode.endsWith(".") ? 1 : 0;
        const base = DUR[durCode.replace(".", "")] || DUR.q;
        const dur = { n: base.n, d: base.d, dots };
        let lyric = null;
        const lyrIdx = head.indexOf("=");
        if (lyrIdx >= 0) { lyric = head.slice(lyrIdx + 1); head = head.slice(0, lyrIdx); }
        if (head === "r") {
          C.inputAt(score, mIdx, tick, dur, null);
        } else {
          const pitches = head.split("+").map(parsePitch);
          const id = C.inputAt(score, mIdx, tick, dur, pitches);
          if (lyric) {
            const found = C.findEvent(score, id);
            if (found) found.ev.lyric = lyric;
          }
        }
        tick = tick.add(C.durValue(dur));
      });
    });
    return score;
  }
  function parsePitch(s) {
    const m = s.match(/^([A-G])(#|b)?(\d)$/);
    if (!m) return { step: 0, alter: 0, oct: 4 };
    return {
      step: { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }[m[1]],
      alter: m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0,
      oct: +m[3],
    };
  }

  const DEMOS = {
    butterfly: () => {
      const s = buildDemo({
        title: "나비야", composer: "전래동요", tempo: 96,
        bars: [
          "G4=나 E4=비 E4=야:h",
          "F4=나 D4=비 D4=야:h",
          "C4=이 D4=리 E4=날 F4=아",
          "G4=오 G4=너 G4=라:h",
          "G4=노 G4=랑 G4=나 G4=비",
          "E4=흰 E4=나 E4=비:h",
          "C4=춤 D4=을 E4=추 F4=며",
          "G4=오 E4=너 C4=라:h",
        ],
      });
      // 표현 기호 시연: 셈여림·슬러·헤어핀·스타카토·페르마타
      const m = s.measures;
      m[0].events[0].dynamic = "mf";
      m[4].events[0].dynamic = "f";
      for (const ev of m[4].events) ev.artics = ["staccato"];
      m[6].events[0].dynamic = "mf";
      s.spanners.push(
        { id: C.newId(), type: "slur", startId: m[2].events[0].id, endId: m[2].events[3].id },
        { id: C.newId(), type: "slur", startId: m[6].events[0].id, endId: m[6].events[3].id },
        { id: C.newId(), type: "dim", startId: m[5].events[0].id, endId: m[5].events[2].id },
      );
      const last = m[7].events[m[7].events.length - 1];
      last.artics = ["fermata"];
      return s;
    },
    star: () => buildDemo({
      title: "반짝반짝 작은 별", composer: "프랑스 민요", tempo: 92,
      bars: [
        "C4=도 C4=도 G4=솔 G4=솔",
        "A4=라 A4=라 G4=솔:h",
        "F4=파 F4=파 E4=미 E4=미",
        "D4=레 D4=레 C4=도:h",
        "G4=솔 G4=솔 F4=파 F4=파",
        "E4=미 E4=미 D4=레:h",
        "G4=솔 G4=솔 F4=파 F4=파",
        "E4=미 E4=미 D4=레:h",
        "C4=도 C4=도 G4=솔 G4=솔",
        "A4=라 A4=라 G4=솔:h",
        "F4=파 F4=파 E4=미 E4=미",
        "D4=레 D4=레 C4=도:h",
      ],
    }),
    airplane: () => buildDemo({
      title: "비행기", composer: "외국 곡", tempo: 104, keySig: 0,
      bars: [
        "E4 D4 C4 D4",
        "E4 E4 E4:h",
        "D4 D4 D4:h",
        "E4 G4 G4:h",
        "E4 D4 C4 D4",
        "E4 E4 E4 E4",
        "D4 D4 E4 D4",
        "C4:w",
      ],
    }),
    rhythm: () => buildDemo({
      title: "리듬 연습 (8분음표와 점음표)", composer: "ScoreForge", tempo: 88, keySig: 1,
      bars: [
        "G4:e A4:e B4:e G4:e D5:q B4:q",
        "A4:q. B4:e A4:q D4:q",
        "G4:e G4:e B4:e B4:e D5:e D5:e B4:q",
        "A4:h G4:h",
      ],
    }),
  };

  SF.io = {
    download, saveJSON, openJSON, safeName,
    autosave, loadAutosave, clearAutosave,
    exportMusicXML, buildDemo, DEMOS,
    parseMusicXML, readMxl, openScoreDialog, loadScoreFile,
  };
})(window.SF);
