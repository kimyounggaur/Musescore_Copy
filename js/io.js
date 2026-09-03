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
    const revision = C.state.revision;
    download(safeName(score.meta.title) + ".scoreforge.json",
      JSON.stringify({ app: "scoreforge", version: 1, score: C.toJSON(score) }, null, 1),
      "application/json");
    if (score === C.state.score) C.markSaved?.(revision);
  }

  // Compatibility alias; all file loading goes through the unified dialog.
  function openJSON(onLoaded) { return openScoreDialog(onLoaded); }

  /* ---------------- 자동 저장 ---------------- */
  const AUTOSAVE_KEY = "scoreforge.autosave.v1";
  let saveTimer = null;
  let autosaveStatus = { revision: -1, savedAt: 0, error: null, pending: false };
  function getAutosaveStatus() { return { ...autosaveStatus }; }
  function autosave(score, options = {}) {
    clearTimeout(saveTimer);
    const revision = C.state.revision;
    autosaveStatus = { ...autosaveStatus, pending: true, error: null };
    saveTimer = setTimeout(() => {
      try {
        // Never label a mutable newer score with the revision that queued this save.
        if (score !== C.state.score || revision !== C.state.revision) { autosaveStatus.pending = false; return; }
        const savedAt = Date.now();
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt, revision, score: C.toJSON(score) }));
        autosaveStatus = { revision, savedAt, error: null, pending: false };
        C.markAutosaved?.(revision);
        options.onComplete?.(getAutosaveStatus());
      } catch (error) {
        autosaveStatus = { ...autosaveStatus, error, pending: false };
        options.onComplete?.(getAutosaveStatus());
      }
    }, options.delay ?? 700);
  }
  function loadAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj.score || (!obj.score.measures && !obj.score.parts)) return null;
      return C.fromJSON(obj.score);
    } catch (e) { return null; }
  }
  function clearAutosave() {
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(AUTOSAVE_KEY); autosaveStatus = { revision: -1, savedAt: 0, error: null, pending: false };
      C.state.autosavedRevision = -1; C.state.lastAutosaveAt = 0;
    }
    catch (error) { autosaveStatus = { ...autosaveStatus, error, pending: false }; }
  }

  /* ---------------- MusicXML 내보내기 ---------------- */
  const TYPE_NAMES = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd", 64: "64th", 128: "128th", 256: "256th" };
  const typeName = dur => dur.n === 2 && dur.d === 1 ? "breve" : TYPE_NAMES[dur.d] || "quarter";
  const F = (n, d = 1) => new Fraction(n, d);
  const timeAt = (score, m) => C.timeSigAt ? C.timeSigAt(score, m) : score.measures.slice(0, m + 1).reduce((ts, mm) => mm.timeSig || ts, score.timeSig);
  const keyAt = (score, m) => C.keySigAt ? C.keySigAt(score, m) : score.measures.slice(0, m + 1).reduce((key, mm) => mm.keySig ?? key, score.keySig);
  const lenAt = (score, m) => C.measureLenAt ? C.measureLenAt(score, m) : F(timeAt(score, m).num, timeAt(score, m).den);
  const textOf = (el, selector) => (selector ? el?.querySelector(selector) : el)?.textContent.trim() || "";
  const children = (el, tag) => [...(el?.children || [])].filter(child => child.localName === tag);
  const ORNAMENT_XML = { trill: "trill-mark", mordent: "mordent", invMordent: "inverted-mordent", turn: "turn", invTurn: "inverted-turn" };
  const drumXmlId = ev => ev.drumId + (ev.midi !== undefined && ev.midi !== C.drumSpec(ev.drumId).midi ? "-" + ev.midi : "");
  function instrumentForGm(gm, percussion = false) {
    if (percussion) return "drums";
    if (C.instrumentForGm) return C.instrumentForGm(gm);
    return Object.entries(SF.playback.INSTRUMENTS).filter(([key]) => key !== "drums").sort((a, b) => Math.abs(a[1].gm - gm) - Math.abs(b[1].gm - gm))[0][0];
  }
  function clefXML(ref, m, number) {
    const clef = C.clefAt ? C.clefAt(ref, m) : ref.measures.slice(0, m + 1).reduce((c, mm) => mm.clef || c, ref.clef);
    const sign = ref.staff.staffType === "tab" ? "TAB" : clef === "percussion" ? "percussion" : /bass/.test(clef) ? "F" : /alto|tenor/.test(clef) ? "C" : "G";
    const line = sign === "F" || clef === "tenor" ? 4 : clef === "alto" ? 3 : 2;
    return `<clef number="${number}"><sign>${sign}</sign>${["TAB", "percussion"].includes(sign) ? "" : `<line>${line}</line>`}${/8vb/.test(clef) ? "<clef-octave-change>-1</clef-octave-change>" : ""}</clef>`;
  }
  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const DYN_SOUND = { pp: 40, p: 54, mp: 66, mf: 78, f: 91, ff: 105 };
  const CHORD_KIND_EXPORT = {
    "": { kind: "major", text: "" },
    m: { kind: "minor", text: "m" },
    min: { kind: "minor", text: "m" },
    maj: { kind: "major", text: "maj" },
    maj7: { kind: "major-seventh", text: "maj7" },
    7: { kind: "dominant", text: "7" },
    m7: { kind: "minor-seventh", text: "m7" },
    dim: { kind: "diminished", text: "dim" },
    aug: { kind: "augmented", text: "aug" },
    sus2: { kind: "suspended-second", text: "sus2" },
    sus4: { kind: "suspended-fourth", text: "sus4" },
    add9: { kind: "other", text: "add9" },
    m7b5: { kind: "half-diminished", text: "m7b5" },
  };
  const CHORD_KIND_IMPORT = {
    major: "",
    minor: "m",
    "major-seventh": "maj7",
    dominant: "7",
    "minor-seventh": "m7",
    diminished: "dim",
    augmented: "aug",
    "suspended-second": "sus2",
    "suspended-fourth": "sus4",
    "half-diminished": "m7b5",
  };
  function alterSuffix(n) {
    n = Math.round(+n || 0);
    return n > 0 ? "#".repeat(n) : n < 0 ? "b".repeat(-n) : "";
  }
  function exportFrame(fb) {
    if (!fb || !Array.isArray(fb.positions)) return "";
    const notes = fb.positions.map((val, idx) => {
      const string = idx + 1;
      const fret = val === "x" ? -1 : Math.max(0, val | 0 || 0);
      return `<frame-note><string>${string}</string><fret>${fret}</fret></frame-note>`;
    }).join("");
    return `<frame><frame-strings>${fb.strings || 6}</frame-strings><frame-frets>${fb.frets || 4}</frame-frets><first-fret>${fb.firstFret || 1}</first-fret>${notes}</frame>`;
  }
  function exportHarmony(chord, staffTag, fretboard) {
    const ch = C.cloneChordSymbol(chord);
    const frame = exportFrame(fretboard);
    if (!ch || !ch.root) {
      const raw = ch ? (ch.normalized || ch.raw || "") : "";
      return raw ? `   <harmony><root><root-step>C</root-step></root><kind text="${xmlEsc(raw)}">other</kind>${frame}${staffTag}</harmony>\n` : "";
    }
    const q = CHORD_KIND_EXPORT[ch.quality] || { kind: "other", text: ch.quality || ch.normalized || "" };
    const rootAlter = ch.rootAlter ? `<root-alter>${ch.rootAlter}</root-alter>` : "";
    const kindText = q.text !== undefined ? ` text="${xmlEsc(q.text)}"` : "";
    const bass = ch.bass ? `<bass><bass-step>${ch.bass}</bass-step>${ch.bassAlter ? `<bass-alter>${ch.bassAlter}</bass-alter>` : ""}</bass>` : "";
    return `   <harmony><root><root-step>${ch.root}</root-step>${rootAlter}</root><kind${kindText}>${q.kind}</kind>${bass}${frame}${staffTag}</harmony>\n`;
  }

  function exportMusicXML(score) {
    C.ensureParts(score);
    const refs = C.staffRefs(score);
    const maxMeasures = Math.max(...refs.map(r => r.measures.length));
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    let DIV = 16;
    const includeFraction = value => { const den = value.d / gcd(value.d, 4); DIV = DIV / gcd(DIV, den) * den; if (!Number.isSafeInteger(DIV)) throw new Error("음길이의 분모가 너무 커서 MusicXML로 저장할 수 없어요"); };
    for (let m = 0; m < maxMeasures; m++) includeFraction(lenAt(score, m));
    for (const ref of refs) for (const mm of ref.measures) for (const { ev } of C.measureEntries(mm, { score, includeSilent: true })) includeFraction(C.durValue(ev.dur));
    const units = dur => { const f = C.durValue(dur); return Math.round(f.n * 4 * DIV / f.d); };

    // 스패너 앵커 맵 (slur 번호 1~6 순환)
    const slurStart = new Map(), slurStop = new Map(), wedgeStart = new Map(), wedgeStop = new Map(), octaveStart = new Map(), octaveStop = new Map();
    (score.spanners || []).forEach((sp, i) => {
      const num = (i % 6) + 1;
      const put = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };
      if (sp.type === "slur") {
        put(slurStart, sp.startId, { num });
        put(slurStop, sp.endId, { num });
      } else if (sp.type === "cresc" || sp.type === "dim") {
        put(wedgeStart, sp.startId, { num, kind: sp.type === "cresc" ? "crescendo" : "diminuendo" });
        put(wedgeStop, sp.endId, { num });
      } else if (sp.type === "ottava") {
        put(octaveStart, sp.startId, { num, shift: +sp.shift || 12 });
        put(octaveStop, sp.endId, { num, shift: +sp.shift || 12 });
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
      const gm = part.midiProgram ?? (SF.playback.INSTRUMENTS[part.instrument] || SF.playback.INSTRUMENTS.piano).gm;
      const channel = part.instrument === "drums" ? 10 : (pIdx % 15 >= 9 ? pIdx % 15 + 2 : pIdx % 15 + 1);
      const drumIds = new Map();
      for (const ref of refs.filter(r => r.partIdx === pIdx)) for (const mm of ref.measures) for (const { ev } of C.measureEntries(mm, { score })) if (ev.drumId) drumIds.set(drumXmlId(ev), ev.midi ?? C.drumSpec(ev.drumId).midi);
      xml += `  <score-part id="P${pIdx + 1}"><part-name>${xmlEsc(part.name || "악기")}</part-name>
   <part-abbreviation>${xmlEsc(part.shortName || "")}</part-abbreviation>
   <score-instrument id="P${pIdx + 1}-I1"><instrument-name>${xmlEsc(part.name || part.instrument)}</instrument-name></score-instrument>
   ${[...drumIds.keys()].map(id => `<score-instrument id="P${pIdx + 1}-${xmlEsc(id)}"><instrument-name>${xmlEsc(id)}</instrument-name></score-instrument>`).join("")}
   <midi-instrument id="P${pIdx + 1}-I1"><midi-channel>${channel}</midi-channel><midi-program>${gm + 1}</midi-program></midi-instrument>
   ${[...drumIds].map(([id, midi]) => `<midi-instrument id="P${pIdx + 1}-${xmlEsc(id)}"><midi-channel>10</midi-channel><midi-unpitched>${midi + 1}</midi-unpitched></midi-instrument>`).join("")}
  </score-part>\n`;
    });
    xml += ` </part-list>\n`;

    score.parts.forEach((part, pIdx) => {
      const partRefs = refs.filter(r => r.partIdx === pIdx);
      xml += ` <part id="P${pIdx + 1}">\n`;
      for (let mIdx = 0; mIdx < maxMeasures; mIdx++) {
        const L = lenAt(score, mIdx), measureUnits = Math.round(L.n * 4 * DIV / L.d), ts = timeAt(score, mIdx);
        const mmMeta = C.ensureMeasureMeta(score.measures[mIdx] || {});
        const prevMeta = mIdx > 0 ? C.ensureMeasureMeta(score.measures[mIdx - 1] || {}) : null;
        xml += `  <measure number="${mIdx + 1}"${L.eq(F(ts.num, ts.den)) ? "" : ' implicit="yes"'}>\n`;
        if (prevMeta && prevMeta.breakType) {
          const attrs = prevMeta.breakType === "page" ? ` new-page="yes"` : ` new-system="yes"`;
          xml += `   <print${attrs}/>\n`;
          if (prevMeta.breakType === "section" && prevMeta.sectionName && pIdx === 0) {
            xml += `   <direction placement="above"><direction-type><words>${xmlEsc(prevMeta.sectionName)}</words></direction-type></direction>\n`;
          }
        }
        const changedClefs = partRefs.filter(ref => mIdx === 0 || ref.measures[mIdx]?.clef);
        const changedTranspose = partRefs.filter(ref => ref.measures[mIdx]?.transpose);
        if (mIdx === 0 || mmMeta.timeSig || mmMeta.keySig !== undefined || changedClefs.length || changedTranspose.length) {
          xml += `   <attributes>
    <divisions>${DIV}</divisions>
    ${mIdx === 0 || mmMeta.keySig !== undefined ? `<key><fifths>${keyAt(score, mIdx)}</fifths></key>` : ""}
    ${mIdx === 0 || mmMeta.timeSig ? `<time><beats>${ts.num}</beats><beat-type>${ts.den}</beat-type></time>` : ""}
    ${partRefs.length > 1 ? `<staves>${partRefs.length}</staves>` : ""}
    ${changedClefs.map(ref => clefXML(ref, mIdx, partRefs.indexOf(ref) + 1)).join("\n    ")}
    ${mIdx === 0 ? partRefs.map((ref, i) => ref.staff.staffType === "tab" ? `<staff-details number="${i + 1}"><staff-lines>6</staff-lines></staff-details>` : "").join("") : ""}
    ${mIdx === 0 && part.transpose ? `<transpose><diatonic>${part.transpose.diatonic || 0}</diatonic><chromatic>${part.transpose.chromatic || 0}</chromatic>${part.transpose.octaveChange ? `<octave-change>${part.transpose.octaveChange}</octave-change>` : ""}</transpose>` : ""}
    ${changedTranspose.map(ref => { const tr = ref.measures[mIdx].transpose; return `<transpose number="${partRefs.indexOf(ref) + 1}"><diatonic>${tr.diatonic || 0}</diatonic><chromatic>${tr.chromatic || 0}</chromatic>${tr.octaveChange ? `<octave-change>${tr.octaveChange}</octave-change>` : ""}</transpose>`; }).join("")}
   </attributes>\n`;
          if (pIdx === 0 && mIdx === 0) xml += `   <direction placement="above"><direction-type>
    <metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome>
   </direction-type><sound tempo="${score.tempo}"/></direction>\n`;
        }
        if (mmMeta.marker) {
          const marker = mmMeta.marker, label = { fine: "Fine", toCoda: "To Coda" }[marker];
          const markXML = label ? `<words>${label}</words>` : `<${marker === "coda" ? "coda" : "segno"}/>`;
          const sound = { segno: 'segno="segno"', coda: 'coda="coda"', fine: 'fine="yes"', toCoda: 'tocoda="coda"' }[marker];
          xml += `   <direction><direction-type>${markXML}</direction-type><sound ${sound}/></direction>\n`;
        }
        if (mmMeta.startRepeat || mmMeta.endingStart) {
          xml += `   <barline location="left">`;
          if (mmMeta.endingStart) xml += `<ending number="${xmlEsc(mmMeta.endingStart)}" type="start"/>`;
          if (mmMeta.startRepeat) xml += `<repeat direction="forward"/>`;
          xml += `</barline>\n`;
        }

        partRefs.forEach((ref, sIdx) => {
          if (sIdx > 0) xml += `   <backup><duration>${measureUnits}</duration></backup>\n`;
          const mm = ref.measures[mIdx] || { events: [{ id: "", type: "rest", full: true, dur: { n: L.n, d: L.d, dots: 0 }, notes: [] }] };
          const voiceLists = [];
          for (let voice = 1; voice <= C.VOICE_COUNT; voice++) {
            const evs = C.getVoiceEvents(mm, voice, score);
            if (voice === 1 || !C.voiceIsEmpty(evs)) voiceLists.push({ voice, evs });
          }
          voiceLists.forEach((voiceList, vListIdx) => {
          if (vListIdx > 0) xml += `   <backup><duration>${measureUnits}</duration></backup>\n`;
          const { voice, evs } = voiceList;
          evs.forEach((ev, eIdx) => {
            const staffTag = partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : "";
            const octaveShift = (C.ottavaShiftAt ? C.ottavaShiftAt(score, ev.id) : 0) / 12;
            const tp = ev.dur.tuplet;
            const timeMod = tp ? `<time-modification><actual-notes>${tp.actual}</actual-notes><normal-notes>${tp.normal}</normal-notes></time-modification>` : "";
            const tpStart = tp && (!evs[eIdx - 1] || evs[eIdx - 1].dur.tuplet?.id !== tp.id);
            const tpStop = tp && (!evs[eIdx + 1] || evs[eIdx + 1].dur.tuplet?.id !== tp.id);
            const noteAttrs = (ev.hidden ? ' print-object="no"' : "") + (ev.color ? ` color="${xmlEsc(ev.color)}"` : "") + (Number.isFinite(ev.offsetX) ? ` relative-x="${ev.offsetX}"` : "") + (Number.isFinite(ev.offsetY) ? ` relative-y="${-ev.offsetY}"` : "");
            const stemXML = ["up", "down"].includes(ev.stemDirection) ? `<stem>${ev.stemDirection}</stem>` : "";
            let eventNotations = (tpStart ? '<tuplet type="start"/>' : "") + (tpStop ? '<tuplet type="stop"/>' : "");
            for (const sl of slurStop.get(ev.id) || []) eventNotations += `<slur type="stop" number="${sl.num}"/>`;
            for (const sl of slurStart.get(ev.id) || []) eventNotations += `<slur type="start" number="${sl.num}"/>`;
            const artTags = { accent: "accent", marcato: "strong-accent", staccato: "staccato", tenuto: "tenuto" };
            const articulations = (ev.artics || []).filter(key => artTags[key]).map(key => `<${artTags[key]}/>`).join("");
            if (articulations) eventNotations += `<articulations>${articulations}</articulations>`;
            if (ev.artics?.includes("fermata")) eventNotations += "<fermata/>";
            if (ev.ornament || ev.tremolo) eventNotations += `<ornaments>${ORNAMENT_XML[ev.ornament] ? `<${ORNAMENT_XML[ev.ornament]}/>` : ""}${ev.trillLine ? '<wavy-line type="start"/><wavy-line type="stop"/>' : ""}${ev.tremolo ? `<tremolo type="single">${Math.max(1, Math.min(4, +ev.tremolo || 1))}</tremolo>` : ""}</ornaments>`;
            if (ev.arpeggiate) eventNotations += "<arpeggiate/>";
            if (ev.glissando) eventNotations += '<glissando type="start" number="1"/>';
            if (evs[eIdx - 1]?.glissando) eventNotations += '<glissando type="stop" number="1"/>';
            if (ev.tab) eventNotations += `<technical><string>${Math.max(1, Math.min(6, ev.tab.string || 1))}</string><fret>${Math.max(0, Math.min(24, ev.tab.fret || 0))}</fret></technical>`;
            for (const oct of octaveStart.get(ev.id) || []) xml += `   <direction><direction-type><octave-shift type="${oct.shift > 0 ? "down" : "up"}" size="${Math.abs(oct.shift) === 24 ? 15 : 8}" number="${oct.num}"/></direction-type><voice>${voice}</voice>${staffTag}</direction>\n`;
            if (ev.tempo) {
              xml += `   <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(+ev.tempo)}</per-minute></metronome></direction-type><sound tempo="${Math.round(+ev.tempo)}"/></direction>\n`;
            }
            if (ev.rehearsal) {
              xml += `   <direction placement="above"><direction-type><rehearsal>${xmlEsc(ev.rehearsal)}</rehearsal></direction-type>${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}</direction>\n`;
            }
            if (ev.staffText || ev.soundFlag) {
              xml += `   <direction placement="above"><direction-type><words>${xmlEsc(ev.staffText || C.SOUND_FLAGS[ev.soundFlag]?.label || ev.soundFlag)}</words></direction-type>${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}</direction>\n`;
            }
            if (ev.chordSymbol) {
              xml += exportHarmony(ev.chordSymbol, staffTag, ev.fretboard);
            }
            if (ev.dynamic && DYN_SOUND[ev.dynamic]) {
              xml += `   <direction placement="below"><direction-type><dynamics><${ev.dynamic}/></dynamics></direction-type>` +
                `${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}<sound dynamics="${DYN_SOUND[ev.dynamic]}"/></direction>\n`;
            }
            for (const w of wedgeStart.get(ev.id) || []) {
              xml += `   <direction placement="below"><direction-type><wedge type="${w.kind}" number="${w.num}"/></direction-type>${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}</direction>\n`;
            }

            if (ev.type === "rest") {
              const notations = eventNotations ? `<notations>${eventNotations}</notations>` : "";
              if (ev.full) {
                xml += `   <note${noteAttrs}><rest measure="yes"/><duration>${measureUnits}</duration><voice>${voice}</voice>${staffTag}${notations}</note>\n`;
              } else {
                xml += `   <note${noteAttrs}><rest/><duration>${units(ev.dur)}</duration><voice>${voice}</voice><type>${typeName(ev.dur)}</type>${"<dot/>".repeat(ev.dur.dots || 0)}${timeMod}${staffTag}${notations}</note>\n`;
              }
            } else {
              if (ev.drumId) {
                const spec = C.drumSpec(ev.drumId);
                const notations = eventNotations;
                xml += `   <note${noteAttrs}><unpitched><display-step>${xmlEsc(ev.displayStep || spec.displayStep)}</display-step><display-octave>${ev.displayOctave || spec.displayOctave}</display-octave></unpitched>` +
                  `<duration>${units(ev.dur)}</duration><instrument id="P${pIdx + 1}-${xmlEsc(drumXmlId(ev))}"/><voice>${voice}</voice><type>${typeName(ev.dur)}</type>${"<dot/>".repeat(ev.dur.dots || 0)}${timeMod}${stemXML}` +
                  `${ev.notehead && ev.notehead !== "normal" ? `<notehead>${ev.notehead === "circle-x" ? "circle-x" : ev.notehead}</notehead>` : ""}` +
                  `${staffTag}${notations ? `<notations>${notations}</notations>` : ""}</note>\n`;
                for (const w of wedgeStop.get(ev.id) || []) xml += `   <direction><direction-type><wedge type="stop" number="${w.num}"/></direction-type>${staffTag}</direction>\n`;
                return;
              }
              for (const gr of ev.graceBefore || []) {
                (gr.notes || []).forEach((note, nIdx) => {
                  xml += `   <note><grace slash="${(gr.kind || "acciaccatura") === "acciaccatura" ? "yes" : "no"}"/>${nIdx > 0 ? "<chord/>" : ""}<pitch><step>${C.STEP_EN[note.step]}</step>` +
                    (note.alter ? `<alter>${note.alter}</alter>` : "") +
                    `<octave>${note.oct + octaveShift}</octave></pitch><voice>${voice}</voice><type>${typeName(gr.dur || { n: 1, d: 8 })}</type>${staffTag}</note>\n`;
                });
              }
              ev.notes.forEach((note, nIdx) => {
                const stop = C.isTiedFrom(score, mIdx, eIdx, note, { ...ref, voice });
                const start = !!note.tie;
                xml += `   <note${noteAttrs}>${nIdx > 0 ? "<chord/>" : ""}<pitch><step>${C.STEP_EN[note.step]}</step>` +
                  (note.alter ? `<alter>${note.alter}</alter>` : "") +
                  `<octave>${note.oct + octaveShift}</octave></pitch>` +
                  `<duration>${units(ev.dur)}</duration>` +
                  (stop ? `<tie type="stop"/>` : "") + (start ? `<tie type="start"/>` : "") +
                  `<voice>${voice}</voice><type${ev.small ? ' size="cue"' : ""}>${typeName(ev.dur)}</type>${"<dot/>".repeat(ev.dur.dots || 0)}${timeMod}${stemXML}${ev.notehead && ev.notehead !== "normal" ? `<notehead>${xmlEsc(ev.notehead)}</notehead>` : ""}${staffTag}`;
                let notations = "";
                if (stop) notations += `<tied type="stop"/>`;
                if (start) notations += `<tied type="start"/>`;
                if (nIdx === 0) notations += eventNotations;
                if (notations) xml += `<notations>${notations}</notations>`;
                if (nIdx === 0) {
                  for (const lyr of C.lyricsOf(ev)) {
                    xml += `<lyric number="${lyr.verse}"><syllabic>${xmlEsc(lyr.syllabic || "single")}</syllabic><text>${xmlEsc(lyr.text)}</text>${lyr.extend ? "<extend/>" : ""}</lyric>`;
                  }
                }
                xml += `</note>\n`;
              });
            }

            for (const w of wedgeStop.get(ev.id) || []) {
              xml += `   <direction placement="below"><direction-type><wedge type="stop" number="${w.num}"/></direction-type>${partRefs.length > 1 ? `<staff>${sIdx + 1}</staff>` : ""}</direction>\n`;
            }
            for (const oct of octaveStop.get(ev.id) || []) xml += `   <direction><direction-type><octave-shift type="stop" size="${Math.abs(oct.shift) === 24 ? 15 : 8}" number="${oct.num}"/></direction-type><voice>${voice}</voice>${staffTag}</direction>\n`;
          });
          });
        });
        if (mmMeta.jump) {
          const jump = typeof mmMeta.jump === "string" ? { type: mmMeta.jump } : mmMeta.jump;
          const type = jump.type || "DC", target = type.startsWith("DS") ? 'dalsegno="segno"' : 'dacapo="yes"';
          xml += `   <direction><direction-type><words>${xmlEsc(type.replace("al", " al "))}</words></direction-type><sound ${target}/></direction>\n`;
        }
        if (mmMeta.endRepeat || mmMeta.endingStop) {
          xml += `   <barline location="right">`;
          if (mmMeta.endingStop) xml += `<ending number="${xmlEsc(score.measures.slice(0, mIdx + 1).reverse().find(mm => mm.endingStart)?.endingStart || "1")}" type="stop"/>`;
          if (mmMeta.endRepeat) xml += `<repeat direction="backward" times="${Math.max(2, Math.min(8, mmMeta.repeatCount || 2))}" after-jump="${(mmMeta.repeatAfterJump ?? score.measures.some(mm => mm.jump?.playRepeats)) ? "yes" : "no"}"/>`;
          xml += `</barline>\n`;
        }
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
  function drumIdFromUnpitched(step, octave, notehead) {
    const key = String(step || "").toUpperCase() + String(octave || "");
    const byPos = {
      F4: "kick",
      A4: "low-tom",
      C5: "snare",
      D5: "mid-tom",
      E5: "high-tom",
      F5: notehead === "x" ? "ride" : "ride",
      G5: notehead === "circle-x" ? "open-hihat" : "closed-hihat",
      A5: "crash",
    };
    return byPos[key] || (notehead === "x" || notehead === "circle-x" ? "closed-hihat" : "snare");
  }
  function parseFrame(frameEl) {
    if (!frameEl) return null;
    const strings = parseInt(textOf(frameEl, "frame-strings"), 10) || 6;
    const positions = Array(strings).fill("x");
    for (const n of frameEl.querySelectorAll("frame-note")) {
      const string = parseInt(textOf(n, "string"), 10);
      const fret = parseInt(textOf(n, "fret"), 10);
      if (string >= 1 && string <= strings) positions[string - 1] = fret < 0 ? "x" : fret;
    }
    return {
      strings,
      frets: parseInt(textOf(frameEl, "frame-frets"), 10) || 4,
      firstFret: parseInt(textOf(frameEl, "first-fret"), 10) || 1,
      positions,
      fingers: [],
    };
  }

  function readClef(el) {
    const sign = textOf(el, "sign"), line = +textOf(el, "line"), octave = +textOf(el, "clef-octave-change");
    if (sign === "percussion") return "percussion";
    if (sign === "C") return line === 4 ? "tenor" : "alto";
    if (sign === "F") return octave === -1 ? "bass8vb" : "bass";
    return octave === -1 ? "treble8vb" : "treble";
  }
  // Directions have exact positions even when they fall inside a sustained
  // note or a rest. Split only that lane; tied pitches still sound continuously.
  function directionAnchor(score, partIdx, staffIdx, m, tick, voice = null) {
    const staff = score.parts[partIdx].staves[staffIdx];
    while (m < staff.measures.length && tick.gte(lenAt(score, m))) { tick = tick.sub(lenAt(score, m)); m++; }
    if (!staff.measures[m] || tick.n < 0) return null;
    const mm = staff.measures[m], entries = C.measureEntries(mm, { score, includeSilent: true });
    const exact = entries.find(en => en.tick.eq(tick) && (!voice || en.voice === voice));
    if (exact) return exact.ev;
    const at = entries.find(en => (!voice ? en.voice === 1 : en.voice === voice) && en.tick.lt(tick) && en.tick.add(C.durValue(en.ev.dur)).gt(tick));
    if (!at) return null;
    const before = tick.sub(at.tick), after = C.durValue(at.ev.dur).sub(before), original = at.ev;
    const tail = C.stripDecor ? C.stripDecor(original) : JSON.parse(JSON.stringify(original));
    tail.id = C.newId(); tail.dur = { n: after.n, d: after.d, dots: 0 }; delete tail.full;
    for (const key of ["drumId", "midi", "staffLine", "notehead", "displayStep", "displayOctave", "tab", "hidden", "color", "velocityOffset"]) if (original[key] !== undefined) tail[key] = JSON.parse(JSON.stringify(original[key]));
    original.dur = { n: before.n, d: before.d, dots: 0 }; delete original.full;
    if (original.artics?.includes("fermata")) {
      original.artics = original.artics.filter(art => art !== "fermata");
      tail.artics = ["fermata"];
    }
    if (original.type === "note") original.notes.forEach(note => { note.tie = true; });
    mm.voices[at.voice - 1].splice(at.e + 1, 0, tail); mm.events = mm.voices[0];
    for (const sp of score.spanners || []) if (sp.endId === original.id) sp.endId = tail.id;
    C.invalidate?.(score);
    return tail;
  }
  function xmlDuration(el, divisions, tuplets, lane, warn) {
    const type = textOf(el, ":scope > type"), dots = children(el, "dot").length;
    let dur = type === "breve" ? { n: 2, d: 1, dots } : { n: 1, d: +Object.keys(TYPE_NAMES).find(key => TYPE_NAMES[key] === type) || 4, dots };
    const actual = +textOf(el, "time-modification > actual-notes"), normal = +textOf(el, "time-modification > normal-notes");
    if (actual > 0 && normal > 0) {
      const start = el.querySelector('notations > tuplet[type="start"]');
      const prior = tuplets.get(lane);
      const id = start || !prior || prior.actual !== actual || prior.normal !== normal ? C.newId() : prior.id;
      dur.tuplet = { id, actual, normal }; tuplets.set(lane, dur.tuplet);
      if (el.querySelector('notations > tuplet[type="stop"]')) tuplets.delete(lane);
    } else tuplets.delete(lane);
    const raw = textOf(el, ":scope > duration"), exact = raw ? F(Math.max(0, Math.round(+raw || 0)), divisions * 4) : C.durValue(dur);
    if (!C.durValue(dur).eq(exact)) {
      if (type) warn("표기와 duration이 다른 음길이는 duration을 보존했어요");
      const written = dur.tuplet ? exact.mul(F(actual, normal)) : exact;
      dur = { n: written.n, d: written.d, dots: 0, ...(dur.tuplet ? { tuplet: dur.tuplet } : {}) };
    }
    return { dur, exact };
  }
  function noteDecorations(el, ev, warn) {
    const not = el.querySelector(":scope > notations"), arts = [];
    for (const art of not?.querySelectorAll("articulations > *") || []) {
      const mapped = { "strong-accent": "marcato", staccatissimo: "staccato", "detached-legato": "tenuto" }[art.localName] || art.localName;
      if (["marcato", "staccato", "tenuto", "accent"].includes(mapped)) arts.push(mapped);
      else warn(`지원하지 않는 아티큘레이션: ${art.localName}`);
    }
    if (not?.querySelector("fermata")) arts.push("fermata");
    if (arts.length) ev.artics = [...new Set(arts)];
    for (const [key, tag] of Object.entries(ORNAMENT_XML)) if (not?.querySelector("ornaments > " + tag)) ev.ornament = key;
    if (not?.querySelector("wavy-line")) ev.trillLine = true;
    const tremolo = +textOf(not, "ornaments > tremolo");
    if (tremolo) ev.tremolo = Math.max(1, Math.min(4, tremolo));
    if (not?.querySelector("arpeggiate")) ev.arpeggiate = true;
    if (not?.querySelector('glissando[type="start"], slide[type="start"]')) ev.glissando = true;
    const string = +textOf(not, "technical > string"), fret = +textOf(not, "technical > fret");
    if (string > 0 && fret >= 0) ev.tab = { string, fret };
    const lyrics = children(el, "lyric").map(lyr => ({ verse: Math.max(1, parseInt(lyr.getAttribute("number")) || 1), text: children(lyr, "text").map(t => t.textContent).join(""), syllabic: textOf(lyr, "syllabic") || "single", extend: !!lyr.querySelector("extend") })).filter(lyr => lyr.text.trim());
    if (lyrics.length) { ev.lyrics = lyrics; C.normalizeEventLyrics(ev); }
    if (el.getAttribute("print-object") === "no") ev.hidden = true;
    if (el.getAttribute("color")) ev.color = el.getAttribute("color");
    if (el.hasAttribute("relative-x")) ev.offsetX = +el.getAttribute("relative-x") || 0;
    if (el.hasAttribute("relative-y")) ev.offsetY = -(+el.getAttribute("relative-y") || 0);
    const stem = textOf(el, "stem"); if (["up", "down"].includes(stem)) ev.stemDirection = stem;
    if (el.querySelector('type[size="cue"]') || el.querySelector("cue")) ev.small = true;
  }

  function parseMusicXML(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML을 읽을 수 없어요 (파싱 오류)");
    const root = doc.documentElement, timewise = root.localName === "score-timewise";
    if (!timewise && root.localName !== "score-partwise") throw new Error("MusicXML 악보가 아니에요");
    const definitions = children(root.querySelector("part-list"), "score-part"), outerMeasures = children(root, "measure");
    const sourceParts = children(root, "part");
    const ids = definitions.map(el => el.getAttribute("id"));
    for (const el of timewise ? outerMeasures.flatMap(me => children(me, "part")) : sourceParts) if (!ids.includes(el.getAttribute("id"))) ids.push(el.getAttribute("id"));
    if (!ids.length) throw new Error("파트가 없어요");
    const report = [], partReports = [], globalMeta = [], allItems = [], spanDirections = [], spans = [];
    const parts = [];
    let firstTime = null, firstKey = null, firstTempo = null, placed = 0, maxMeasures = 1;
    for (const [pIdx, id] of ids.entries()) {
      const def = definitions.find(el => el.getAttribute("id") === id);
      const name = textOf(def, "part-name") || `파트 ${pIdx + 1}`, warnings = new Map();
      const warn = msg => warnings.set(msg, (warnings.get(msg) || 0) + 1);
      let measures = timewise ? outerMeasures.map(me => children(me, "part").find(el => el.getAttribute("id") === id) || null) : children(sourceParts.find(el => el.getAttribute("id") === id), "measure");
      if (measures.length > 500) { warn(`앞 500마디만 가져왔어요 (전체 ${measures.length}마디)`); measures = measures.slice(0, 500); }
      maxMeasures = Math.max(maxMeasures, measures.length);
      const unpitchedMap = new Map(children(def, "midi-instrument").map(el => [el.getAttribute("id"), +textOf(el, "midi-unpitched") - 1]));
      const percussion = +textOf(def, "midi-instrument > midi-channel") === 10 || [...unpitchedMap.values()].some(n => n >= 0);
      const program = Math.max(0, (+textOf(def, "midi-instrument > midi-program") || 1) - 1), instrument = instrumentForGm(program, percussion);
      let staffCount = 1;
      for (const me of measures) if (me) {
        staffCount = Math.max(staffCount, +textOf(me, "attributes > staves") || 1);
        for (const st of me.querySelectorAll("note > staff")) staffCount = Math.max(staffCount, +st.textContent || 1);
      }
      if (staffCount > 32) warn(`앞 32개 보표만 가져왔어요 (전체 ${staffCount}개)`);
      staffCount = Math.min(32, staffCount);
      const part = { id: C.newId(), kind: "solo", name, shortName: textOf(def, "part-abbreviation"), instrument, midiProgram: program, group: percussion ? "percussion" : "solo", brace: staffCount > 1 && ["piano", "organ"].includes(instrument) ? "brace" : null,
        staves: Array.from({ length: staffCount }, (_, i) => ({ id: C.newId(), name: "", clef: percussion ? "percussion" : i === 1 ? "bass" : "treble", staffType: "standard", instrumentType: percussion ? "percussion" : "pitched", measures: [] })) };
      parts.push(part);
      const voiceMaps = Array.from({ length: staffCount }, () => new Map()), grace = new Map(), lastNotes = new Map();
      const openSlurs = new Map();
      let divisions = 1;
      const voiceFor = (staff, label) => {
        const map = voiceMaps[staff], key = label || "1";
        if (!map.has(key)) {
          const used = new Set(map.values()), requested = +key;
          let voice = Number.isInteger(requested) && requested >= 1 && requested <= 4 && !used.has(requested) ? requested : [1, 2, 3, 4].find(v => !used.has(v));
          if (!voice) { warn("성부가 4개를 넘어 추가 성부를 생략했어요"); voice = 0; }
          map.set(key, voice);
        }
        return map.get(key);
      };
      measures.forEach((me, m) => {
        const meta = globalMeta[m] || (globalMeta[m] = {}), tuplets = new Map();
        for (const staff of part.staves) staff.measures[m] = { voices: [[], [], [], []] };
        let cur = Fraction.ZERO, max = Fraction.ZERO;
        const localItems = [];
        for (const el of me?.children || []) {
          const tag = el.localName;
          if (tag === "attributes") {
            if (cur.n > 0 && el.querySelector("key, time, clef")) warn("마디 중간 조표·박자·음자리표 변경은 해당 마디 시작에 적용했어요");
            const div = +textOf(el, "divisions"); if (div > 0 && Number.isInteger(div)) divisions = div;
            const fifths = textOf(el, "key > fifths");
            if (fifths !== "") { const key = Math.max(-7, Math.min(7, +fifths || 0)); if (firstKey === null && m === 0) firstKey = key; if (pIdx === 0 || meta.keySig === undefined) meta.keySig = key; }
            const beats = textOf(el, "time > beats").split("+").reduce((sum, n) => sum + (+n || 0), 0), den = +textOf(el, "time > beat-type");
            if (beats > 0 && beats <= 32 && [1, 2, 4, 8, 16, 32, 64].includes(den)) { const ts = { num: beats, den }; if (!firstTime && m === 0) firstTime = ts; if (pIdx === 0 || !meta.timeSig) meta.timeSig = ts; }
            for (const ce of children(el, "clef")) {
              const si = Math.max(0, Math.min(staffCount - 1, (+ce.getAttribute("number") || 1) - 1)), staff = part.staves[si], clef = readClef(ce);
              if (m === 0) staff.clef = clef; else staff.measures[m].clef = clef;
              if (textOf(ce, "sign") === "TAB") staff.staffType = "tab";
              if (clef === "percussion") { staff.instrumentType = "percussion"; part.instrument = "drums"; part.group = "percussion"; }
            }
            for (const detail of children(el, "staff-details")) if (+textOf(detail, "staff-lines") === 6) part.staves[Math.max(0, Math.min(staffCount - 1, (+detail.getAttribute("number") || 1) - 1))].staffType = "tab";
            for (const tr of children(el, "transpose")) {
              const transpose = { chromatic: +textOf(tr, "chromatic") || 0, diatonic: +textOf(tr, "diatonic") || 0, octaveChange: +textOf(tr, "octave-change") || 0 };
              if (m === 0 && !tr.hasAttribute("number")) part.transpose = transpose;
              else for (const [si, staff] of part.staves.entries()) if (!tr.hasAttribute("number") || +tr.getAttribute("number") === si + 1) staff.measures[m].transpose = transpose;
            }
          } else if (tag === "backup" || tag === "forward") {
            const length = F(Math.max(0, +textOf(el, "duration") || 0), divisions * 4);
            cur = tag === "backup" ? cur.sub(length) : cur.add(length);
            if (cur.n < 0) { cur = Fraction.ZERO; warn("음수 backup 위치를 마디 시작으로 보정했어요"); }
            if (cur.gt(max)) max = cur;
          } else if (tag === "print") {
            const target = globalMeta[Math.max(0, m - 1)] || meta;
            if (el.getAttribute("new-page") === "yes") target.breakType = "page";
            else if (el.getAttribute("new-system") === "yes") target.breakType = "system";
          } else if (tag === "barline") {
            const rep = el.querySelector("repeat");
            if (rep?.getAttribute("direction") === "forward") meta.startRepeat = true;
            if (rep?.getAttribute("direction") === "backward") { meta.endRepeat = true; meta.repeatCount = Math.max(2, Math.min(8, +rep.getAttribute("times") || 2)); }
            if (rep?.hasAttribute("after-jump")) meta.repeatAfterJump = rep.getAttribute("after-jump") === "yes";
            for (const ending of children(el, "ending")) {
              if (ending.getAttribute("type") === "start") meta.endingStart = ending.getAttribute("number") || "1";
              else if (["stop", "discontinue"].includes(ending.getAttribute("type"))) meta.endingStop = true;
            }
          } else if (["direction", "sound", "harmony"].includes(tag)) {
            const si = Math.max(0, Math.min(staffCount - 1, (+textOf(el, "staff") || 1) - 1));
            const soundNode = tag === "sound" ? el : el.querySelector("sound");
            const tick = cur.add(F(+(textOf(soundNode, "offset") || textOf(el, ":scope > offset")) || 0, divisions * 4)), decor = {};
            const directionVoice = textOf(el, "voice") ? voiceFor(si, textOf(el, "voice")) : null;
            const sound = tag === "sound" ? el : el.querySelector("sound");
            let tempo = +(sound?.getAttribute("tempo") || textOf(el, "metronome > per-minute"));
            if (!sound?.hasAttribute("tempo") && tempo) {
              const unit = textOf(el, "metronome > beat-unit"), den = +Object.keys(TYPE_NAMES).find(key => TYPE_NAMES[key] === unit) || 4;
              const dots = el.querySelectorAll("metronome > beat-unit-dot").length;
              tempo *= C.durValue({ n: unit === "breve" ? 2 : 1, d: unit === "breve" ? 1 : den, dots }).value * 4;
            }
            if (tempo > 0) { decor.tempo = tempo; if (firstTempo === null && m === 0 && tick.n === 0) firstTempo = tempo; }
            const words = [...el.querySelectorAll("direction-type words")].map(w => w.textContent.trim()).filter(Boolean).join(" ");
            if (words) { decor.staffText = words; const flag = C.detectSoundFlag(words); if (flag) decor.soundFlag = flag; }
            const rehearsal = textOf(el, "direction-type rehearsal"); if (rehearsal) decor.rehearsal = rehearsal;
            const dyn = el.querySelector("direction-type dynamics > *"); if (dyn && DYN_IMPORT[dyn.localName]) decor.dynamic = DYN_IMPORT[dyn.localName];
            if (sound?.hasAttribute("dacapo") || sound?.hasAttribute("dalsegno")) meta.jump = { type: (sound.hasAttribute("dalsegno") ? "DS" : "DC") + (sound.hasAttribute("fine") || /al\s*Fine/i.test(words) ? "alFine" : sound.hasAttribute("tocoda") || /al\s*Coda/i.test(words) ? "alCoda" : ""), playRepeats: false };
            else if (sound?.hasAttribute("fine") || /^Fine$/i.test(words)) meta.marker = "fine";
            else if (sound?.hasAttribute("tocoda") || /^To\s*Coda$/i.test(words)) meta.marker = "toCoda";
            if (el.querySelector("direction-type segno") || sound?.hasAttribute("segno")) meta.marker = "segno";
            if (el.querySelector("direction-type coda") || sound?.hasAttribute("coda")) meta.marker = "coda";
            if (!meta.jump && /^D\.?\s*[CS]\.?/i.test(words)) {
              const normalized = words.replace(/[.\s]/g, "");
              if (/^D[CS](alFine|alCoda)?$/i.test(normalized)) meta.jump = { type: normalized, playRepeats: false };
            }
            if (tag === "harmony") {
              const rootStep = textOf(el, "root > root-step"), kindEl = el.querySelector("kind"), kind = kindEl?.textContent.trim() || "";
              const suffix = kindEl?.getAttribute("text") ?? CHORD_KIND_IMPORT[kind] ?? kind;
              const bass = textOf(el, "bass > bass-step");
              decor.chordSymbol = C.parseChordSymbol(rootStep + alterSuffix(+textOf(el, "root > root-alter")) + suffix + (bass ? "/" + bass + alterSuffix(+textOf(el, "bass > bass-alter")) : ""));
              const frame = parseFrame(el.querySelector("frame")); if (frame) decor.fretboard = frame;
            }
            spanDirections.push({ part: pIdx, staff: si, voice: directionVoice, m, tick, decor });
            for (const sp of el.querySelectorAll("direction-type wedge, direction-type octave-shift")) {
              const type = sp.getAttribute("type"), number = sp.getAttribute("number") || "1", kind = sp.localName;
              const shift = 12 * (type === "up" ? -1 : 1);
              if (kind === "octave-shift" && sp.hasAttribute("size") && sp.getAttribute("size") !== "8") warn("두 옥타브 이상의 선은 8va/8vb로 표시하고 실제 음높이를 보존했어요");
              spanDirections.push({ part: pIdx, staff: si, voice: directionVoice, m, tick, span: { kind, type, number, shift } });
            }
          } else if (tag === "note") {
            const si = Math.max(0, Math.min(staffCount - 1, (+textOf(el, ":scope > staff") || 1) - 1)), voice = voiceFor(si, textOf(el, ":scope > voice"));
            const lane = si + ":" + voice, chord = !!el.querySelector(":scope > chord"), isGrace = !!el.querySelector(":scope > grace"), isRest = !!el.querySelector(":scope > rest");
            const { dur, exact } = xmlDuration(el, divisions, tuplets, lane, warn);
            const last = lastNotes.get(lane), tick = chord && last?.m === m ? last.tick : cur;
            const ev = { id: C.newId(), type: isRest ? "rest" : "note", voice, dur, notes: [] };
            const pitch = el.querySelector(":scope > pitch"), unpitched = el.querySelector(":scope > unpitched");
            if (pitch) {
              const step = STEP_IDX[textOf(pitch, "step")], oct = +textOf(pitch, "octave"), alter = +textOf(pitch, "alter") || 0;
              if (step !== undefined && Number.isFinite(oct)) {
                ev.notes.push({ step, alter, oct, tie: !!el.querySelector('tie[type="start"], notations > tied[type="start"]') });
              } else warn("읽을 수 없는 음높이를 생략했어요");
            } else if (unpitched) {
              const displayStep = textOf(unpitched, "display-step") || "C", displayOctave = +textOf(unpitched, "display-octave") || 5, notehead = textOf(el, "notehead") || "normal";
              const declaredMidi = unpitchedMap.get(el.querySelector("instrument")?.getAttribute("id"));
              const drumId = Object.keys(C.DRUM_MAP).find(key => C.drumSpec(key).midi === declaredMidi) || drumIdFromUnpitched(displayStep, displayOctave, notehead);
              const spec = C.drumSpec(drumId), midi = declaredMidi >= 0 ? declaredMidi : spec.midi;
              Object.assign(ev, { drumId, midi, staffLine: spec.staffLine, notehead, displayStep, displayOctave }); ev.notes.push({ ...C.spellMidi(midi, 0), midi, tie: false });
              part.instrument = "drums"; part.group = "percussion"; part.staves[si].instrumentType = "percussion";
            }
            noteDecorations(el, ev, warn);
            if (isGrace) {
              const list = grace.get(lane) || [];
              if (chord && list.length) list[list.length - 1].notes.push(...ev.notes);
              else list.push({ id: ev.id, kind: el.querySelector("grace")?.getAttribute("slash") === "no" ? "appoggiatura" : "acciaccatura", dur, notes: ev.notes });
              grace.set(lane, list); continue;
            }
            if (!chord) { cur = cur.add(exact); if (cur.gt(max)) max = cur; }
            if (!voice || exact.n <= 0 || (!isRest && !ev.notes.length)) continue;
            if (chord && last && last.m === m && last.exact.eq(exact) && last.ev.type === "note" && !ev.drumId) { last.ev.notes.push(...ev.notes); continue; }
            if (chord && last && (ev.drumId || !last.exact.eq(exact))) {
              const occupied = localItems.filter(it => it.staff === si && it.tick.lt(tick.add(exact)) && it.tick.add(it.exact).gt(tick)).map(it => it.ev.voice);
              const free = [1, 2, 3, 4].find(v => !occupied.includes(v));
              if (!free) { warn("4성부를 넘는 겹친 음을 생략했어요"); continue; } ev.voice = free;
            }
            const pendingGrace = grace.get(lane); if (pendingGrace?.length && !isRest) { ev.graceBefore = pendingGrace; grace.delete(lane); }
            const item = { part: pIdx, staff: si, m, tick, exact, ev };
            allItems.push(item); localItems.push(item); lastNotes.set(lane, item); if (!isRest) placed++;
            for (const sl of el.querySelectorAll("notations > slur")) {
              const key = si + ":" + (sl.getAttribute("number") || "1"), type = sl.getAttribute("type");
              if (type === "stop" && openSlurs.has(key)) { spans.push({ id: C.newId(), type: "slur", startId: openSlurs.get(key), endId: ev.id }); openSlurs.delete(key); }
              if (type === "start") openSlurs.set(key, ev.id);
            }
          }
        }
        const sourceMeasure = timewise ? outerMeasures[m] : me;
        if (sourceMeasure?.getAttribute("implicit") === "yes" && max.n > 0) {
          const prior = meta.length ? Fraction.from(meta.length) : Fraction.ZERO;
          if (max.gt(prior)) meta.length = [max.n, max.d];
        }
      });
      if (openSlurs.size) warn("짝이 없는 이음줄을 생략했어요");
      partReports.push({ part: name, warnings });
    }
    if (!parts.some(part => part.staves.some(staff => staff.measures.length))) throw new Error("마디가 없어요");
    for (const meta of globalMeta) if (meta.jump) meta.jump.playRepeats = globalMeta.some(mm => mm.repeatAfterJump === true);
    // Octave shifts describe printed positions relative to MusicXML's sounding
    // pitches. Resolve intervals after all backup/voice streams have been read.
    const openOctaves = new Map(), octaveRanges = [];
    const comparePosition = (a, b) => a.m - b.m || a.tick.cmp(b.tick);
    for (const dir of spanDirections.filter(dir => dir.span?.kind === "octave-shift").sort(comparePosition)) {
      const key = dir.part + ":" + dir.staff + ":" + dir.span.number;
      if (dir.span.type === "stop") { const start = openOctaves.get(key); if (start) octaveRanges.push({ start, end: dir }); openOctaves.delete(key); }
      else if (dir.span.type !== "continue") openOctaves.set(key, dir);
    }
    for (const start of openOctaves.values()) { octaveRanges.push({ start, end: { m: maxMeasures, tick: Fraction.ZERO } }); partReports[start.part].warnings.set("끝이 없는 옥타브 선은 악보 끝까지 적용했어요", 1); }
    for (const { start, end } of octaveRanges) {
      const covered = allItems.filter(it => it.part === start.part && it.staff === start.staff && (!start.voice || it.ev.voice === start.voice) && comparePosition(it, start) >= 0 && comparePosition(it, end) < 0 && it.ev.type === "note").sort(comparePosition);
      for (const it of covered) {
        for (const note of [...it.ev.notes, ...(it.ev.graceBefore || []).flatMap(gr => gr.notes || [])]) note.oct -= start.span.shift / 12;
      }
      for (const voice of new Set(covered.map(it => it.ev.voice))) {
        const lane = covered.filter(it => it.ev.voice === voice);
        spans.push({ id: C.newId(), type: "ottava", shift: start.span.shift, startId: lane[0].ev.id, endId: lane[lane.length - 1].ev.id });
      }
    }
    const laneItems = new Map(), staffItems = new Map();
    for (const item of allItems) {
      const staffKey = item.part + ":" + item.staff, laneKey = staffKey + ":" + item.m + ":" + item.ev.voice;
      if (!laneItems.has(laneKey)) laneItems.set(laneKey, []);
      if (!staffItems.has(staffKey)) staffItems.set(staffKey, []);
      laneItems.get(laneKey).push(item); staffItems.get(staffKey).push(item);
    }
    for (const [pIdx, part] of parts.entries()) if (part.staves.length === 2 && part.staves.some(staff => staff.staffType === "tab")) {
      const signature = si => JSON.stringify((staffItems.get(pIdx + ":" + si) || []).filter(it => it.ev.type === "note").map(it => [it.m, String(it.tick), String(it.exact), it.ev.notes.map(C.midiOf)]));
      if (signature(0) === signature(1)) {
        part.staves[0].linkedStaffId = part.staves[1].id; part.staves[1].linkedStaffId = part.staves[0].id;
      }
    }
    const score = C.createScore({ title: textOf(root, "work > work-title") || textOf(root, "movement-title") || "가져온 악보", composer: textOf(root, 'identification creator[type="composer"]'), keySig: firstKey ?? 0, timeSig: firstTime || { num: 4, den: 4 }, tempo: firstTempo || 100, measureCount: maxMeasures });
    score.parts = parts; score.measures = parts[0].staves[0].measures; score.spanners = spans;
    for (const part of parts) for (const staff of part.staves) for (let m = 0; m < maxMeasures; m++) {
      const mm = staff.measures[m] || (staff.measures[m] = { voices: [[], [], [], []] }); Object.assign(mm, globalMeta[m]);
    }
    C.invalidate?.(score);
    const rest = (length, voice, full = false) => ({ id: C.newId(), type: "rest", voice, dur: { n: length.n, d: length.d, dots: 0 }, notes: [], ...(full ? { full: true } : {}) });
    for (const [pIdx, part] of parts.entries()) for (const [si, staff] of part.staves.entries()) for (let m = 0; m < maxMeasures; m++) {
      const mm = staff.measures[m], length = lenAt(score, m);
      for (let voice = 1; voice <= 4; voice++) {
        const lane = (laneItems.get(pIdx + ":" + si + ":" + m + ":" + voice) || []).sort((a, b) => a.tick.cmp(b.tick));
        const evs = [], addRests = (start, len) => {
          const pieces = C.decompose(start, len), sum = pieces.reduce((n, d) => n.add(C.durValue(d)), Fraction.ZERO);
          for (const dur of sum.eq(len) ? pieces : [{ n: len.n, d: len.d, dots: 0 }]) evs.push({ ...rest(C.durValue(dur), voice), dur });
        };
        let tick = Fraction.ZERO;
        for (const it of lane) {
          if (it.tick.lt(tick) || it.tick.gte(length)) { partReports[pIdx].warnings.set("마디 범위를 벗어나거나 같은 성부에서 겹친 음을 생략했어요", 1); continue; }
          if (it.tick.gt(tick)) addRests(tick, it.tick.sub(tick));
          if (it.tick.add(it.exact).gt(length)) { const clipped = length.sub(it.tick); it.ev.dur = { n: clipped.n, d: clipped.d, dots: 0 }; it.exact = clipped; partReports[pIdx].warnings.set("마디 경계를 넘는 duration을 잘랐어요", 1); }
          if (it.ev.type === "rest" && it.tick.n === 0 && it.exact.eq(length)) it.ev.full = true;
          evs.push(it.ev); tick = it.tick.add(it.exact);
        }
        if (!evs.length) evs.push(rest(length, voice, true)); else if (tick.lt(length)) addRests(tick, length.sub(tick));
        mm.voices[voice - 1] = evs;
      }
      mm.events = mm.voices[0];
    }
    const openDirections = new Map();
    const comparePos = (a, b) => a.m - b.m || a.tick.cmp(b.tick);
    for (const dir of spanDirections) {
      const lane = (staffItems.get(dir.part + ":" + dir.staff) || []).filter(it => !dir.voice || it.ev.voice === dir.voice).sort(comparePos);
      const next = lane.find(it => comparePos(it, dir) >= 0), prev = [...lane].reverse().find(it => comparePos(it, dir) < 0);
      if (dir.decor && Object.keys(dir.decor).length) {
        const target = directionAnchor(score, dir.part, dir.staff, dir.m, dir.tick, dir.voice) || next?.ev || prev?.ev;
        if (target) Object.assign(target, dir.decor);
      }
      if (dir.span && dir.span.kind !== "octave-shift") {
        const sp = dir.span, key = dir.part + ":" + dir.staff + ":" + sp.kind + ":" + sp.number;
        if (sp.type === "stop") {
          const opened = openDirections.get(key), end = prev || next;
          if (opened && end) score.spanners.push({ id: C.newId(), type: opened.type, startId: opened.startId, endId: end.ev.id, ...(opened.type === "ottava" ? { shift: opened.shift } : {}) });
          openDirections.delete(key);
        } else if (sp.type !== "continue" && next) openDirections.set(key, { type: sp.kind === "octave-shift" ? "ottava" : sp.type === "crescendo" ? "cresc" : "dim", shift: sp.shift, startId: next.ev.id });
      }
    }
    for (const key of openDirections.keys()) partReports[+key.split(":")[0]].warnings.set("끝이 없는 헤어핀을 생략했어요", 1);
    for (const entry of partReports) if (entry.warnings.size) report.push(`${entry.part}: ${[...entry.warnings].map(([msg, count]) => `${msg} (${count}건)`).join("; ")}`);
    report.unshift(`${parts.length}개 파트 · ${parts.reduce((sum, part) => sum + part.staves.length, 0)}개 보표 · ${maxMeasures}마디를 가져왔어요`);
    C.invalidate?.(score);
    return { score: C.fromJSON(C.toJSON(score)), report, placed };
  }


  /* ---------------- Standard MIDI File import (no external dependencies) ---------------- */
  function parseMidi(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength), decoder = new TextDecoder();
    let offset = 0;
    const need = (count, end = data.length) => { if (count < 0 || offset + count > end) throw new Error("잘린 MIDI 파일이에요"); };
    const u16 = () => { need(2); const n = view.getUint16(offset); offset += 2; return n; };
    const u32 = () => { need(4); const n = view.getUint32(offset); offset += 4; return n; };
    const str = count => { need(count); const text = decoder.decode(data.subarray(offset, offset + count)); offset += count; return text; };
    const vlq = end => {
      let value = 0;
      for (let i = 0; i < 4; i++) { need(1, end); const byte = data[offset++]; value = value * 128 + (byte & 127); if (!(byte & 128)) return value; }
      throw new Error("MIDI 가변 길이 값이 너무 길어요");
    };
    if (str(4) !== "MThd") throw new Error("MIDI 파일이 아니에요");
    const headerLength = u32(); if (headerLength < 6) throw new Error("MIDI 헤더가 올바르지 않아요");
    const headerEnd = offset + headerLength; need(headerLength);
    const format = u16(), trackCount = u16(), division = u16(); offset = headerEnd;
    if (format > 1) throw new Error("SMF type 0/1만 지원해요");
    if (division & 0x8000) throw new Error("SMPTE 시간 기반 MIDI는 지원하지 않아요 (PPQ로 변환해 주세요)");
    if (!division) throw new Error("MIDI PPQ가 0이에요");
    const tracks = [], tempoMap = [], timeSigs = [], keySigs = [], report = [];
    while (tracks.length < trackCount) {
      const chunk = str(4), size = u32(); need(size); const end = offset + size;
      if (chunk !== "MTrk") { offset = end; continue; }
      const track = { index: tracks.length, name: "", notes: [], programs: [], events: [], endTick: 0 }, active = new Map();
      let tick = 0, running = 0;
      while (offset < end) {
        tick += vlq(end); need(1, end);
        let status = data[offset];
        if (status & 128) offset++; else { if (!running) throw new Error("MIDI running status가 올바르지 않아요"); status = running; }
        if (status === 255) {
          need(1, end); const type = data[offset++], length = vlq(end); need(length, end);
          const bytes = data.subarray(offset, offset + length); offset += length;
          if (type === 81 && length === 3) { const microseconds = bytes[0] * 65536 + bytes[1] * 256 + bytes[2]; if (microseconds) tempoMap.push({ tick, tempo: 60000000 / microseconds, microseconds }); }
          if (type === 88 && length >= 2 && bytes[1] <= 6) timeSigs.push({ tick, num: bytes[0] || 4, den: 2 ** bytes[1] });
          if (type === 89 && length >= 2) keySigs.push({ tick, keySig: bytes[0] > 127 ? bytes[0] - 256 : bytes[0], minor: !!bytes[1] });
          if (type === 3) track.name = decoder.decode(bytes);
          if (type === 47) break;
          continue;
        }
        if (status === 240 || status === 247) { const length = vlq(end); need(length, end); offset += length; running = 0; continue; }
        if (status >= 240) throw new Error("지원하지 않는 MIDI 시스템 메시지예요");
        running = status;
        const command = status & 240, channel = status & 15, length = command === 192 || command === 208 ? 1 : 2;
        need(length, end); const a = data[offset++], b = length === 2 ? data[offset++] : 0;
        if (a > 127 || b > 127) throw new Error("MIDI 데이터 바이트가 올바르지 않아요");
        track.events.push({ tick, status, data: length === 2 ? [a, b] : [a] });
        if (command === 192) track.programs.push({ tick, channel, program: a });
        const key = channel + ":" + a;
        if (command === 144 && b > 0) {
          const queue = active.get(key) || []; queue.push({ start: tick, midi: a, velocity: b, channel }); active.set(key, queue);
        } else if (command === 128 || (command === 144 && b === 0)) {
          const queue = active.get(key), note = queue?.shift();
          if (note) track.notes.push({ ...note, end: tick, duration: tick - note.start });
          else report.push(`트랙 ${track.index + 1}: 시작이 없는 note-off를 생략했어요`);
        }
      }
      track.endTick = tick;
      for (const queue of active.values()) for (const note of queue) {
        track.notes.push({ ...note, end: Math.max(note.start + 1, tick), duration: Math.max(1, tick - note.start) });
        report.push(`트랙 ${track.index + 1}: note-off가 없는 음을 트랙 끝에서 종료했어요`);
      }
      track.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
      if (!track.name) track.name = `트랙 ${track.index + 1}`;
      tracks.push(track); offset = end;
    }
    const sortMap = (list, fallback) => { list.sort((a, b) => a.tick - b.tick); if (!list.length || list[0].tick > 0) list.unshift(fallback); return list; };
    sortMap(tempoMap, { tick: 0, tempo: 120, microseconds: 500000 });
    sortMap(timeSigs, { tick: 0, num: 4, den: 4 }); sortMap(keySigs, { tick: 0, keySig: 0, minor: false });
    return { format, tracks, ppq: division, tempoMap, timeSigs, keySigs, timeSig: { num: timeSigs[0].num, den: timeSigs[0].den }, keySig: keySigs[0].keySig, report };
  }

  function midiToScore(parsed, opts = {}) {
    const { ppq } = parsed, report = [...(parsed.report || [])], warn = message => { if (!report.includes(message)) report.push(message); };
    let grid = opts.grid ?? 1 / 16;
    if (typeof grid === "object") grid = Array.isArray(grid) ? grid[0] / grid[1] : grid.n / grid.d;
    if (grid > 1) grid = 1 / grid;
    if (![1 / 8, 1 / 16, 1 / 32].includes(grid)) grid = 1 / 16;
    const quantum = ppq * 4 * grid, groups = [];
    for (const track of parsed.tracks) {
      if (Array.isArray(opts.tracks) && !opts.tracks.includes(track.index)) continue;
      const channels = [...new Set(track.notes.map(n => n.channel))];
      const channelGroups = parsed.format === 0 ? channels.map(ch => [ch]) : [channels.filter(ch => ch !== 9), ...(channels.includes(9) ? [[9]] : [])].filter(chs => chs.length);
      for (const chs of channelGroups) {
        const notes = track.notes.filter(n => chs.includes(n.channel)); if (!notes.length) continue;
        const program = track.programs.find(p => chs.includes(p.channel))?.program || 0, percussion = chs[0] === 9;
        const instrument = instrumentForGm(program, percussion), splitHands = !!opts.splitHands && !percussion;
        groups.push({ track, notes, program, percussion, spec: { kind: "solo", name: track.name + (parsed.format === 0 && channels.length > 1 ? ` (ch ${chs[0] + 1})` : ""), instrument, group: percussion ? "percussion" : "solo", staves: splitHands ? [{ clef: "treble" }, { clef: "bass" }] : [{ clef: percussion ? "percussion" : "treble" }] } });
        if (track.programs.filter(p => chs.includes(p.channel)).some(p => p.program !== program)) warn(`${track.name}: 곡 중간 악기 변경은 첫 악기로 통합했어요`);
      }
    }
    if (!groups.length) throw new Error("선택한 MIDI 트랙에 음표가 없어요");
    const sourceEnd = Math.max(...groups.flatMap(group => [...group.notes.map(n => n.end), group.track.endTick || 0])) / (4 * ppq), measureMeta = [], starts = [Fraction.ZERO];
    const timeSigs = parsed.timeSigs || [{ tick: 0, ...parsed.timeSig }];
    let m = 0, ts = parsed.timeSig;
    while (starts[starts.length - 1].value < sourceEnd && m < 2000) {
      const at = starts[m].value * 4 * ppq;
      const change = [...timeSigs].reverse().find(sig => sig.tick <= at + 0.01); if (change) ts = { num: Math.min(32, change.num), den: change.den };
      const meta = { timeSig: { ...ts } }, naturalEnd = starts[m].add(F(ts.num, ts.den));
      const nextChange = timeSigs.find(sig => sig.tick > at + 0.01 && sig.tick < naturalEnd.value * 4 * ppq - 0.01);
      const end = nextChange ? F(nextChange.tick, 4 * ppq) : naturalEnd;
      if (nextChange) { const len = end.sub(starts[m]); meta.length = [len.n, len.d]; }
      measureMeta.push(meta); starts.push(end); m++;
    }
    if (m >= 2000) warn("앞 2000마디만 가져왔어요");
    const score = C.createScore({ title: opts.title || groups[0].track.name || "MIDI 가져오기", parts: groups.map(g => g.spec), measureCount: Math.max(1, m), timeSig: parsed.timeSig, keySig: parsed.keySig || 0, tempo: parsed.tempoMap[0]?.tempo || 120 });
    for (const ref of C.staffRefs(score)) for (let mi = 0; mi < measureMeta.length; mi++) Object.assign(ref.measures[mi], measureMeta[mi]);
    const locate = abs => { let mi = starts.findIndex((start, i) => i + 1 < starts.length && abs.gte(start) && abs.lt(starts[i + 1])); if (mi < 0) mi = Math.max(0, starts.length - 2); return { m: mi, tick: abs.sub(starts[mi]) }; };
    for (const change of parsed.keySigs || []) {
      const pos = locate(F(change.tick, 4 * ppq));
      for (const ref of C.staffRefs(score)) ref.measures[pos.m].keySig = Math.max(-7, Math.min(7, change.keySig));
      if (pos.tick.n) warn("마디 중간 조표 변경을 해당 마디 시작에 적용했어요");
    }
    C.invalidate?.(score);
    // Existing empty measures were made with the initial meter; reset their exact lengths.
    for (const ref of C.staffRefs(score)) ref.measures.forEach((mm, mi) => {
      mm.voices = Array.from({ length: 4 }, (_, vi) => ({ ...C.fullRest(score, mi), id: C.newId(), voice: vi + 1 })).map(ev => [ev]); mm.events = mm.voices[0];
    });
    let placed = 0;
    groups.forEach((group, partIdx) => {
      score.parts[partIdx].midiProgram = group.program;
      const tripletStarts = new Set(), unique = [...new Set(group.notes.map(n => n.start))].sort((a, b) => a - b), tripletGrid = ppq / 3;
      if (opts.detectTriplets) for (let i = 0; i + 2 < unique.length; i++) {
        const chunk = unique.slice(i, i + 3), snapped = chunk.map(t => Math.round(t / tripletGrid));
        if (snapped[1] === snapped[0] + 1 && snapped[2] === snapped[1] + 1 && chunk.every((t, j) => Math.abs(t - snapped[j] * tripletGrid) <= ppq / 24) && chunk.some(t => Math.abs(t - Math.round(t / quantum) * quantum) > ppq / 24)) chunk.forEach(t => tripletStarts.add(t));
      }
      const grouped = new Map();
      for (const note of group.notes) {
        const triplet = tripletStarts.has(note.start), unit = triplet ? tripletGrid : quantum;
        const start = triplet ? F(Math.round(note.start / unit), 12) : F(Math.round(note.start / unit), Math.round(1 / grid));
        const length = triplet ? F(Math.max(1, Math.round(note.duration / unit)), 12) : F(Math.max(1, Math.round(note.duration / unit)), Math.round(1 / grid));
        const staff = opts.splitHands && !group.percussion && note.midi < 60 ? 1 : 0;
        const key = staff + ":" + start + ":" + length + (group.percussion ? ":" + note.midi : "");
        const entry = grouped.get(key) || { start, length, staff, triplet, notes: [] }; entry.notes.push(note); grouped.set(key, entry);
      }
      const laneEnds = Array.from({ length: score.parts[partIdx].staves.length }, () => [Fraction.ZERO, Fraction.ZERO]);
      const tuplets = new Map();
      for (const entry of [...grouped.values()].sort((a, b) => a.start.cmp(b.start) || b.length.cmp(a.length))) {
        if (entry.start.gte(starts[starts.length - 1])) continue;
        const lane = laneEnds[entry.staff].findIndex(end => end.lte(entry.start));
        if (lane < 0) { warn(`${group.track.name}: 두 성부를 넘는 겹친 음을 생략했어요`); continue; }
        laneEnds[entry.staff][lane] = entry.start.add(entry.length);
        const pos = locate(entry.start), keySig = keyAt(score, pos.m), voice = lane + 1;
        const pitches = entry.notes.map(n => ({ ...C.spellMidi(n.midi, keySig), tie: false }));
        let dur = { n: entry.length.n, d: entry.length.d, dots: 0 };
        if (entry.triplet && entry.length.eq(F(1, 12))) {
          const groupKey = entry.staff + ":" + voice + ":" + Math.floor(entry.start.value * 4);
          if (!tuplets.has(groupKey)) tuplets.set(groupKey, C.newId());
          dur = { n: 1, d: 8, dots: 0, tuplet: { id: tuplets.get(groupKey), actual: 3, normal: 2 } };
        }
        const ctx = { partIdx, staffIdx: entry.staff, voice }, id = C.inputAt(score, pos.m, pos.tick, dur, pitches, ctx);
        const found = C.findEvent(score, id);
        if (found) {
          found.ev.velocityOffset = Math.round(entry.notes.reduce((n, note) => n + note.velocity, 0) / entry.notes.length - 82);
          if (group.percussion) {
            const midi = entry.notes[0].midi, drumId = Object.keys(C.DRUM_MAP).find(key => C.drumSpec(key).midi === midi) || "snare", spec = C.drumSpec(drumId);
            if (spec.midi !== midi) warn(`${group.track.name}: 드럼 ${midi}의 표기는 스네어로 대체했어요 (원래 소리 유지)`);
            Object.assign(found.ev, { drumId, midi, staffLine: spec.staffLine, notehead: spec.notehead, displayStep: spec.displayStep, displayOctave: spec.displayOctave });
          }
          if (dur.tuplet && C.durValue(found.ev.dur).eq(entry.length)) found.ev.dur = dur;
          placed++;
        }
      }
    });
    for (const change of parsed.tempoMap) {
      const raw = F(change.tick, 4 * ppq), quantized = F(Math.round(raw.value / grid), Math.round(1 / grid)), pos = locate(quantized);
      const target = directionAnchor(score, 0, 0, pos.m, pos.tick);
      if (target) target.tempo = change.tempo;
    }
    C.invalidate?.(score);
    report.unshift(`${groups.length}개 파트 · ${placed}개 음표/화음을 가져왔어요 (1/${Math.round(1 / grid)} 양자화)`);
    return { score: C.fromJSON(C.toJSON(score)), report, placed };
  }

  /* ---- 통합 열기: .json / .musicxml / .xml / .mxl / .mid ---- */
  function openScoreDialog(onLoaded) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.musicxml,.xml,.mxl,.mid,.midi,application/json,audio/midi";
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
    if (/\.(mid|midi)$/.test(lower)) {
      return file.arrayBuffer().then(parseMidi).then(async parsed => {
        const options = typeof SF.io.requestMidiOptions === "function" ? await SF.io.requestMidiOptions(parsed, file) : {};
        if (options === null || options === false) return;
        const result = midiToScore(parsed, { title: name.replace(/\.(mid|midi)$/i, ""), ...(options || {}) });
        onLoaded(result.score, name, null, result.report);
        return result;
      }).catch(fail);
    }
    if (lower.endsWith(".mxl")) {
      return file.arrayBuffer()
        .then(readMxl)
        .then(xml => { const r = parseMusicXML(xml); onLoaded(r.score, name, null, r.report); return r; })
        .catch(fail);
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const head = text.slice(0, 300).replace(/^﻿/, "").trimStart();
        if (head.startsWith("{")) {
          const obj = JSON.parse(text.replace(/^﻿/, ""));
          const raw = obj.score && (obj.score.measures || obj.score.parts) ? obj.score : (obj.measures || obj.parts ? obj : null);
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
    autosave, loadAutosave, clearAutosave, getAutosaveStatus,
    exportMusicXML, buildDemo, DEMOS,
    parseMusicXML, readMxl, openScoreDialog, loadScoreFile,
    parseMidi, midiToScore, instrumentForGm, requestMidiOptions: null,
  };
})(window.SF);
