/* =========================================================================
 * ScoreForge playback — 악보 → 이벤트 컴파일 + Web Audio 재생/샘플러/신스/메트로놈/MIDI
 * 스케줄러는 "두 개의 시계" 패턴: setInterval 루프가 lookahead 안의 이벤트를
 * AudioContext 절대시각으로 예약한다.
 * ========================================================================= */
"use strict";
(function (SF) {
  const C = SF.core;
  const { Fraction } = SF;
  const SMPLR_URL = "https://unpkg.com/smplr@1.0.0/dist/index.mjs";
  const F = (n, d = 1) => new Fraction(n, d);
  const timeAt = (score, m) => C.timeSigAt ? C.timeSigAt(score, m) : score.measures.slice(0, m + 1).reduce((ts, mm) => mm.timeSig || ts, score.timeSig);
  const lengthAt = (score, m) => {
    if (C.measureLenAt) return C.measureLenAt(score, m);
    const value = score.measures[m]?.actualLen;
    if (value) return Array.isArray(value) ? F(...value) : F(value.n, value.d);
    const ts = timeAt(score, m); return F(ts.num, ts.den);
  };
  const startsFor = score => {
    if (C.measureStarts) return C.measureStarts(score);
    const out = [Fraction.ZERO];
    for (let m = 0; m < score.measures.length; m++) out.push(out[m].add(lengthAt(score, m)));
    return out;
  };
  const channelFor = (part, pIdx) => part.instrument === "drums" || part.group === "percussion" ? 9 : (pIdx % 15 >= 9 ? pIdx % 15 + 1 : pIdx % 15);

  /* ---------------- 악기 프리셋 ---------------- */
  const INSTRUMENTS = {
    piano: {
      label: "피아노", gm: 0,
      partials: [
        { type: "triangle", ratio: 1, gain: 0.55 },
        { type: "sine", ratio: 2, gain: 0.18 },
        { type: "sine", ratio: 3, gain: 0.07 },
        { type: "sine", ratio: 4.01, gain: 0.025 },
      ],
      attack: 0.004, decayTau: 0.45, sustain: 0.0001, release: 0.12,
      filter: { type: "lowpass", base: 2400, perVel: 3200, q: 0.4 }, percussive: true,
    },
    epiano: {
      label: "일렉피아노", gm: 4,
      partials: [
        { type: "sine", ratio: 1, gain: 0.6 },
        { type: "sine", ratio: 2, gain: 0.1 },
        { type: "sine", ratio: 7.0, gain: 0.02 },
      ],
      attack: 0.003, decayTau: 0.6, sustain: 0.0001, release: 0.15,
      filter: { type: "lowpass", base: 2800, perVel: 2000, q: 0.2 }, percussive: true,
    },
    musicbox: {
      label: "뮤직박스", gm: 10,
      partials: [
        { type: "sine", ratio: 1, gain: 0.5 },
        { type: "sine", ratio: 4, gain: 0.18 },
        { type: "sine", ratio: 7.2, gain: 0.04 },
      ],
      attack: 0.002, decayTau: 0.3, sustain: 0.0001, release: 0.2, octShift: 12,
      filter: { type: "highpass", base: 300, perVel: 0, q: 0.3 }, percussive: true,
    },
    organ: {
      label: "오르간", gm: 19,
      partials: [
        { type: "sine", ratio: 0.5, gain: 0.18 },
        { type: "sine", ratio: 1, gain: 0.4 },
        { type: "sine", ratio: 2, gain: 0.22 },
        { type: "sine", ratio: 4, gain: 0.1 },
      ],
      attack: 0.03, decayTau: 0, sustain: 1, release: 0.12,
      filter: null, percussive: false, vibrato: { rate: 5.5, depth: 2.5 },
    },
    strings: {
      label: "현악기", gm: 48,
      partials: [
        { type: "sawtooth", ratio: 1, gain: 0.16, detune: -6 },
        { type: "sawtooth", ratio: 1, gain: 0.16, detune: 6 },
        { type: "sawtooth", ratio: 2, gain: 0.05 },
      ],
      attack: 0.12, decayTau: 0, sustain: 0.85, release: 0.3,
      filter: { type: "lowpass", base: 1500, perVel: 2200, q: 0.5 }, percussive: false,
      vibrato: { rate: 5, depth: 4 },
    },
    flute: {
      label: "플루트", gm: 73,
      partials: [
        { type: "sine", ratio: 1, gain: 0.5 },
        { type: "triangle", ratio: 1, gain: 0.12 },
        { type: "sine", ratio: 2, gain: 0.07 },
      ],
      attack: 0.05, decayTau: 0, sustain: 0.9, release: 0.15,
      filter: null, percussive: false, vibrato: { rate: 5.2, depth: 5 }, breath: 0.04,
    },
    guitar: {
      label: "기타", gm: 24,
      partials: [
        { type: "triangle", ratio: 1, gain: 0.42 },
        { type: "sine", ratio: 2, gain: 0.12 },
        { type: "sine", ratio: 3, gain: 0.06 },
      ],
      attack: 0.004, decayTau: 0.5, sustain: 0.0001, release: 0.18,
      filter: { type: "lowpass", base: 1800, perVel: 2600, q: 0.35 }, percussive: true,
    },
    chiptune: {
      label: "8비트", gm: 80,
      partials: [{ type: "square", ratio: 1, gain: 0.16 }],
      attack: 0.002, decayTau: 0, sustain: 0.8, release: 0.04,
      filter: { type: "lowpass", base: 5000, perVel: 2000, q: 0.2 }, percussive: false,
    },
    drums: {
      label: "드럼 키트", gm: 0,
      partials: [
        { type: "triangle", ratio: 0.5, gain: 0.22 },
        { type: "square", ratio: 1.0, gain: 0.08 },
        { type: "sine", ratio: 2.4, gain: 0.04 },
      ],
      attack: 0.001, decayTau: 0.16, sustain: 0.0001, release: 0.05,
      filter: { type: "lowpass", base: 900, perVel: 2600, q: 0.8 }, percussive: true,
    },
  };

  /* ---------------- 신스 엔진 ---------------- */
  let ctx = null, master = null, limiter = null;
  const live = new Set(); // 정지 시 끊을 노드들
  const sampleInstruments = new Map();
  const partBuses = new Map();
  let smplrModule = null;
  let smplrPromise = null;
  let sampleStatus = { state: "idle", text: "샘플 대기", detail: "재생하면 smplr 실제 악기 샘플을 불러옵니다." };
  let onSampleStatus = null;

  const SAMPLE_MAP = {
    piano: { kind: "splendid", label: "Splendid Grand Piano", volume: 98 },
    epiano: { kind: "soundfont", instrument: "electric_piano_1", label: "Electric Piano", volume: 96 },
    musicbox: { kind: "soundfont", instrument: "music_box", label: "Music Box", volume: 104 },
    organ: { kind: "soundfont", instrument: "church_organ", label: "Church Organ", volume: 94 },
    strings: { kind: "soundfont", instrument: "string_ensemble_1", label: "String Ensemble", volume: 90 },
    flute: { kind: "soundfont", instrument: "flute", label: "Flute", volume: 96 },
    guitar: { kind: "soundfont", instrument: "acoustic_guitar_nylon", label: "Classical Guitar", volume: 96 },
    chiptune: { kind: "soundfont", instrument: "lead_1_square", label: "Square Lead", volume: 92 },
  };

  function setSampleStatus(state, text, detail) {
    sampleStatus = { state, text, detail: detail || text };
    if (onSampleStatus) onSampleStatus(sampleStatus);
  }

  function getSampleStatus() {
    return sampleStatus;
  }

  function setSampleStatusHandler(fn) {
    onSampleStatus = typeof fn === "function" ? fn : null;
    if (onSampleStatus) onSampleStatus(sampleStatus);
  }

  async function loadSmplrModule() {
    if (smplrModule) return smplrModule;
    if (!smplrPromise) {
      setSampleStatus("loading", "샘플 로딩", "smplr 라이브러리를 불러오는 중입니다.");
      smplrPromise = import("../vendor/smplr/index.mjs").catch(() => import(SMPLR_URL)).then(mod => {
        smplrModule = mod;
        return mod;
      }).catch(err => {
        smplrPromise = null;
        setSampleStatus("fallback", "신스 사용", "smplr를 불러오지 못해 내장 신스로 재생합니다.");
        throw err;
      });
    }
    return smplrPromise;
  }

  function sampleKey(instrument) {
    return SAMPLE_MAP[instrument] ? instrument : "piano";
  }

  function createSampleInstrument(mod, key, partId) {
    const spec = SAMPLE_MAP[sampleKey(key)];
    const opts = {
      destination: partBus(partId).input,
      volume: spec.volume || 96,
      onLoadProgress: ({ loaded, total }) => {
        setSampleStatus("loading", `${loaded}/${total}`, `${spec.label} 샘플을 불러오는 중입니다.`);
      },
    };
    if (spec.kind === "splendid" && mod.SplendidGrandPiano) return mod.SplendidGrandPiano(ctx, opts);
    if (mod.Soundfont) return mod.Soundfont(ctx, { ...opts, instrument: spec.instrument });
    throw new Error("smplr Soundfont factory is unavailable");
  }

  function ensureSampleInstrument(instrument, partId = "preview") {
    audio();
    if (instrument === "drums") return Promise.resolve({ ready: false });
    const key = partId + ":" + sampleKey(instrument);
    const cached = sampleInstruments.get(key);
    if (cached && !cached.failed) return cached.promise;
    const rec = { instrument: null, ready: false, failed: false, promise: null };
    rec.promise = (async () => {
      const mod = await loadSmplrModule();
      const inst = createSampleInstrument(mod, instrument, partId);
      rec.instrument = inst;
      await (inst.ready || inst.load || Promise.resolve(inst));
      rec.ready = true;
      setSampleStatus("ready", "샘플 준비", `${(SAMPLE_MAP[sampleKey(instrument)] || SAMPLE_MAP.piano).label} 샘플 음원 준비 완료`);
      return rec;
    })().catch(err => {
      rec.failed = true;
      setSampleStatus("fallback", "신스 사용", "샘플 음원을 불러오지 못해 내장 신스로 재생합니다.");
      console.warn("[ScoreForge] smplr sample load failed:", err);
      return rec;
    });
    sampleInstruments.set(key, rec);
    return rec.promise;
  }

  function warmSamplesForScore(score) {
    return Promise.all(score.parts.map(part => ensureSampleInstrument(part.instrument, part.id)));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function scheduleSampleNote(instrument, midi, when, dur, vel, partId = "preview", session = null) {
    const key = partId + ":" + sampleKey(instrument);
    if (instrument === "drums" || (session && !session.has(key))) return false;
    const rec = sampleInstruments.get(key);
    if (!rec || !rec.ready || !rec.instrument || rec.failed) {
      if (!session) ensureSampleInstrument(instrument, partId);
      return false;
    }
    try {
      rec.instrument.start({
        note: midi,
        velocity: Math.max(1, Math.min(127, Math.round((vel || 0.7) * 120))),
        time: when,
        duration: Math.max(0.03, dur),
        stopId: `${midi}:${when.toFixed(3)}`,
      });
      return true;
    } catch (err) {
      rec.failed = true;
      setSampleStatus("fallback", "신스 사용", "샘플 재생 중 문제가 생겨 내장 신스로 전환합니다.");
      console.warn("[ScoreForge] smplr note failed:", err);
      return false;
    }
  }

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10; limiter.knee.value = 12;
      limiter.ratio.value = 14; limiter.attack.value = 0.002; limiter.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(limiter).connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // Both engines terminate in the same persistent per-part gain/pan bus.
  function partBus(partId = "preview") {
    if (partBuses.has(partId)) return partBuses.get(partId);
    const ac = audio(), input = ac.createGain();
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    input.connect(pan || master);
    if (pan) pan.connect(master);
    const bus = { input, pan };
    partBuses.set(partId, bus);
    return bus;
  }
  function updateMixer(score = C.state.score) {
    if (!ctx || !score) return;
    const solo = score.parts.some(part => mixerFor(score, part).solo);
    for (const part of score.parts) {
      const mx = mixerFor(score, part), bus = partBus(part.id);
      const gain = mx.mute || (solo && !mx.solo) ? 0 : mx.volume;
      bus.input.gain.setTargetAtTime(gain, ctx.currentTime, 0.015);
      if (bus.pan) bus.pan.pan.setTargetAtTime(mx.pan, ctx.currentTime, 0.015);
    }
  }

  /* 음 하나 예약 */
  function scheduleNote(preset, midi, when, dur, vel = 0.8, pan = 0, partId = "preview") {
    const ac = audio();
    const f = midiToFreq(midi + (preset.octShift || 0));
    const g = ac.createGain();
    g.gain.value = 0;
    let dest = g;
    const out = partBus(partId).input;
    if (preset.filter) {
      const fl = ac.createBiquadFilter();
      fl.type = preset.filter.type;
      fl.frequency.value = Math.min(preset.filter.base + preset.filter.perVel * vel + f * 1.2, 12000);
      fl.Q.value = preset.filter.q;
      g.connect(fl); fl.connect(out); dest = g;
    } else {
      g.connect(out);
    }

    const stopAt = when + dur + (preset.release || 0.1) + 0.05;
    const oscs = [];
    let vib = null, vibGain = null;
    if (preset.vibrato) {
      vib = ac.createOscillator();
      vib.frequency.value = preset.vibrato.rate;
      vibGain = ac.createGain();
      vibGain.gain.setValueAtTime(0, when);
      vibGain.gain.linearRampToValueAtTime(preset.vibrato.depth, when + Math.min(0.25, dur * 0.4));
      vib.connect(vibGain);
      vib.start(when); vib.stop(stopAt);
      live.add(vib);
    }
    for (const p of preset.partials) {
      const o = ac.createOscillator();
      o.type = p.type;
      o.frequency.value = f * p.ratio;
      if (p.detune) o.detune.value = p.detune;
      if (vibGain) vibGain.connect(o.detune);
      const pg = ac.createGain();
      pg.gain.value = p.gain;
      o.connect(pg); pg.connect(dest);
      o.start(when); o.stop(stopAt);
      live.add(o);
      o.onended = () => live.delete(o);
      oscs.push(o);
    }
    if (preset.breath) {
      const len = Math.min(0.2, dur);
      const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bg = ac.createGain(); bg.gain.value = preset.breath * vel;
      const bf = ac.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = f * 2; bf.Q.value = 1.2;
      src.connect(bf).connect(bg).connect(out);
      src.start(when); live.add(src);
    }

    // 엔벨로프
    const peak = 0.85 * vel;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + preset.attack);
    if (preset.percussive) {
      g.gain.setTargetAtTime(preset.sustain, when + preset.attack, preset.decayTau * (0.6 + dur * 0.35));
    } else {
      g.gain.setTargetAtTime(peak * preset.sustain, when + preset.attack, 0.06);
    }
    const relStart = when + dur;
    g.gain.cancelScheduledValues(relStart);
    g.gain.setTargetAtTime(0.0001, relStart, preset.release / 3);
    return oscs;
  }

  /* 메트로놈 클릭 */
  function scheduleClick(when, accent) {
    const ac = audio();
    const o = ac.createOscillator();
    o.type = "square";
    o.frequency.value = accent ? 1700 : 1150;
    const g = ac.createGain();
    g.gain.setValueAtTime(accent ? 0.22 : 0.13, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 600;
    o.connect(f).connect(g).connect(master);
    o.start(when); o.stop(when + 0.07);
    live.add(o); o.onended = () => live.delete(o);
  }

  /* ---------------- 컴파일러: 악보 → 시간순 이벤트 ----------------
   * 셈여림(velocity)·헤어핀(선형 보간)·아티큘레이션(gateTime/velocity)·
   * 슬러(레가토)를 모두 이벤트에 반영한다.
   */
  const VELS = { pp: 0.38, p: 0.48, mp: 0.58, mf: 0.68, f: 0.8, ff: 0.92 };
  const SWING = { off: 0, light: 0.54, medium: 0.58, heavy: 0.66 };

  function mixerFor(score, part) {
    C.ensureParts(score);
    const rec = score.playbackSettings?.mixer?.[part.id] || {};
    return {
      mute: !!rec.mute,
      solo: !!rec.solo,
      volume: Math.max(0, Math.min(1.5, Number.isFinite(+rec.volume) ? +rec.volume : 1)),
      pan: Math.max(-1, Math.min(1, +rec.pan || 0)),
    };
  }

  function playableRefs(score, opts) {
    let refs = C.visibleStaffRefs ? C.visibleStaffRefs(score, opts.viewMode, { hideEmptyStaves: false }) : C.staffRefs(score);
    // Keep silent parts in the plan so live unmute/solo never requires recompiling.
    return refs.filter(ref => !(ref.staff.staffType === "tab" && ref.staff.linkedStaffId && refs.some(other => other.staff.id === ref.staff.linkedStaffId && other.staff.staffType !== "tab")));
  }


  function endingMatches(label, pass) {
    return String(label || "")
      .split(/[,\s]+/)
      .map(x => x.trim().replace(/\.$/, ""))
      .filter(Boolean)
      .some(x => {
        if (x === String(pass)) return true;
        const range = x.match(/^(\d+)-(\d+)$/);
        return range && pass >= +range[1] && pass <= +range[2];
      });
  }

  function endingStopAfter(score, m) {
    for (let i = m; i < score.measures.length; i++) {
      if (C.ensureMeasureMeta(score.measures[i] || {}).endingStop) return i;
    }
    return m;
  }


  function buildPlaybackPlan(score) {
    C.ensureParts(score);
    const count = score.measures.length, plan = [], warnings = [];
    const repeatEnds = new Map(), stack = [];
    score.measures.forEach((mm, m) => {
      if (mm.startRepeat) stack.push(m);
      if (mm.endRepeat) repeatEnds.set(m, stack.pop() ?? 0);
    });
    const passes = new Map(), usedJumps = new Set();
    let m = 0, pass = 1, jumped = false, codaTaken = false, jumpMode = "", playRepeats = true, guard = 0;
    const markerAt = marker => score.measures.findIndex(mm => mm.marker === marker || (mm.markers || []).includes(marker));
    while (m >= 0 && m < count && guard++ < Math.max(64, count * 64)) {
      const mm = score.measures[m], activeEnd = [...repeatEnds].find(([end, start]) => start <= m && m <= end)?.[0];
      if (activeEnd !== undefined) pass = passes.get(activeEnd) || 1;
      if (mm.endingStart && !endingMatches(mm.endingStart, pass)) {
        const stop = endingStopAfter(score, m);
        // A skipped first ending can contain the repeat's closing barline.
        if (repeatEnds.has(stop)) passes.set(stop, Math.max(pass, passes.get(stop) || 1));
        m = stop + 1; continue;
      }
      plan.push({ m, pass, jumped });
      const hasMarker = value => mm.marker === value || (mm.markers || []).includes(value);
      if (jumped && /alFine$/i.test(jumpMode) && hasMarker("fine")) break;
      if (jumped && !codaTaken && /alCoda$/i.test(jumpMode) && hasMarker("toCoda")) {
        const target = markerAt("coda");
        codaTaken = true;
        if (target >= 0) { m = target; continue; }
        warnings.push("To Coda has no Coda target.");
      }
      if (mm.jump && !usedJumps.has(m)) {
        const jump = typeof mm.jump === "string" ? { type: mm.jump } : mm.jump;
        const type = String(jump.type || "").replace(/[.\s]/g, "");
        if (/^D[CS](alFine|alCoda)?$/i.test(type)) {
          usedJumps.add(m);
          const target = /^DS/i.test(type) ? markerAt("segno") : 0;
          if (target >= 0) {
            jumped = true; jumpMode = type; playRepeats = !!jump.playRepeats;
            passes.clear(); pass = 1; m = target; continue;
          }
          warnings.push("D.S. has no Segno target.");
        }
      }
      if (mm.endRepeat && (!jumped || (mm.repeatAfterJump ?? playRepeats))) {
        const repeatCount = Math.max(2, Math.min(8, mm.repeatCount || 2));
        const used = passes.get(m) || 1;
        if (used < repeatCount) {
          passes.set(m, used + 1); pass = used + 1;
          const target = repeatEnds.get(m) ?? 0;
          for (const [end, start] of repeatEnds) if (end < m && start >= target) passes.delete(end);
          m = target; continue;
        }
      }
      if (mm.endingStop && !mm.endRepeat) pass = 1;
      m++;
    }
    if (guard >= Math.max(64, count * 64)) warnings.push("Playback jump limit reached.");
    Object.defineProperty(plan, "warnings", { value: warnings });
    return plan;
  }

  function secondsMap(changes) {
    changes.sort((a, b) => a.abs.cmp(b.abs));
    const unique = [];
    for (const change of changes) {
      if (unique.length && unique[unique.length - 1].abs.eq(change.abs)) unique[unique.length - 1] = change;
      else unique.push(change);
    }
    const seconds = [0];
    for (let i = 1; i < unique.length; i++) seconds[i] = seconds[i - 1] + unique[i].abs.sub(unique[i - 1].abs).value * 240 / unique[i - 1].tempo;
    const indexAt = abs => {
      let lo = 0, hi = unique.length - 1;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (unique[mid].abs.lte(abs)) lo = mid; else hi = mid - 1; }
      return lo;
    };
    const secondsAt = abs => { const i = indexAt(abs); return seconds[i] + abs.sub(unique[i].abs).value * 240 / unique[i].tempo; };
    return { changes: unique, secondsAt, tempoAt: abs => unique[indexAt(abs)].tempo, durationSec: (abs, len) => secondsAt(abs.add(len)) - secondsAt(abs) };
  }

  function buildTempoMap(score, refs = C.staffRefs(score)) {
    const starts = startsFor(score), changes = [{ abs: Fraction.ZERO, tempo: Math.max(1, +score.tempo || 100) }];
    const seen = new Set();
    for (const ref of refs) for (let m = 0; m < ref.measures.length; m++) {
      for (const entry of C.measureEntries(ref.measures[m], { score })) if (+entry.ev.tempo > 0) {
        const abs = starts[m].add(entry.tick), key = abs.toString();
        if (!seen.has(key)) { changes.push({ abs, tempo: +entry.ev.tempo }); seen.add(key); }
      }
    }
    const map = secondsMap(changes);
    const measureTimes = starts.map(map.secondsAt), beatTimes = [];
    for (let m = 0; m < score.measures.length; m++) {
      const ts = timeAt(score, m);
      for (let tick = Fraction.ZERO; tick.lt(lengthAt(score, m)); tick = tick.add(F(1, ts.den))) {
        beatTimes.push({ abs: starts[m].add(tick), t: map.secondsAt(starts[m].add(tick)), accent: tick.n === 0 });
      }
    }
    return { ...map, starts, measureTimes, beatTimes, totalSec: measureTimes[measureTimes.length - 1], maxMeasures: score.measures.length };
  }

  function compile(score, opts = {}) {
    C.ensureParts(score);
    const refs = playableRefs(score, opts), base = buildTempoMap(score), plan = buildPlaybackPlan(score);
    if (score.parts.filter(p => p.instrument !== "drums" && p.group !== "percussion").length > 15) plan.warnings.push("MIDI has only 15 melodic channels; additional parts share channels.");
    let totalAbs = Fraction.ZERO;
    const tempoChanges = [], signatures = [], beats = [];
    const expandedPlan = plan.map((item, planIdx) => {
      const baseAbs = base.starts[item.m], len = lengthAt(score, item.m), ts = timeAt(score, item.m);
      const out = { ...item, planIdx, abs: totalAbs, baseAbs, len };
      tempoChanges.push({ abs: totalAbs, tempo: base.tempoAt(baseAbs) });
      for (const change of base.changes) if (change.abs.gt(baseAbs) && change.abs.lt(baseAbs.add(len))) tempoChanges.push({ abs: totalAbs.add(change.abs.sub(baseAbs)), tempo: change.tempo });
      signatures.push({ abs: totalAbs, timeSig: ts, keySig: C.keySigAt ? C.keySigAt(score, item.m) : score.keySig });
      for (let tick = Fraction.ZERO; tick.lt(len); tick = tick.add(F(1, ts.den))) beats.push({ abs: totalAbs.add(tick), accent: tick.n === 0 });
      totalAbs = totalAbs.add(len);
      return out;
    });
    if (!tempoChanges.length) tempoChanges.push({ abs: Fraction.ZERO, tempo: +score.tempo || 100 });
    const events = [], timelineEvents = [], positions = new Map(), holds = new Map();
    const slurCover = C.slurCoverMap ? C.slurCoverMap(score) : new Set();
    const shiftAt = (ref, id) => {
      const here = positions.get(id)?.original;
      const position = positions.get(id);
      let transpose = ref.part.transpose;
      for (let m = position.m; m >= 0; m--) if (ref.measures[m]?.transpose) { transpose = ref.measures[m].transpose; break; }
      let shift = +(transpose?.chromatic || 0) + 12 * +(transpose?.octaveChange || 0);
      if (C.ottavaShiftAt) return shift + C.ottavaShiftAt(score, id);
      for (const sp of score.spanners || []) if (sp.type === "ottava") {
        const a = positions.get(sp.startId), b = positions.get(sp.endId);
        if (a && b && a.ref === ref.globalIdx && b.ref === ref.globalIdx && a.voice === position.voice && b.voice === position.voice && here.gte(a.original) && here.lte(b.original)) shift += +sp.shift || 12;
      }
      return shift;
    };
    for (const ref of refs) for (let m = 0; m < ref.measures.length; m++) for (const en of C.measureEntries(ref.measures[m], { score })) {
      positions.set(en.ev.id, { original: base.starts[m].add(en.tick), ref: ref.globalIdx, m, voice: en.voice });
    }
    const occurrences = [];
    for (const ref of refs) {
      let vel = VELS.mf, soundFlag = null;
      const lanes = new Map();
      for (const item of expandedPlan) for (const entry of C.measureEntries(ref.measures[item.m], { score })) {
        const ev = entry.ev, len = ev.full ? item.len : C.durValue(ev.dur), abs = item.abs.add(entry.tick);
        if (VELS[ev.dynamic] !== undefined) vel = VELS[ev.dynamic];
        if (ev.soundFlag) soundFlag = ["arco", "open"].includes(ev.soundFlag) ? null : ev.soundFlag;
        const occ = { ...entry, ev, len, abs, ref, item, vel, soundFlag };
        occurrences.push(occ);
        const lane = lanes.get(entry.voice) || []; lane.push(occ); lanes.set(entry.voice, lane);
        timelineEvents.push({ id: ev.id, absVal: abs, durVal: len, mIdx: item.m, pass: item.pass, planIdx: item.planIdx, partIdx: ref.partIdx, staffIdx: ref.staffIdx });
        if (ev.artics?.includes("fermata")) {
          const end = abs.add(len), extra = len.mul(F(3, 5)), key = end.toString();
          if (!holds.has(key) || holds.get(key).extra.lt(extra)) holds.set(key, { at: end, extra });
        }
      }
      for (const lane of lanes.values()) {
        const consumed = new Set();
        lane.forEach((occ, idx) => {
          const { ev, abs, len, item, voice } = occ;
          if (ev.type !== "note") return;
          const ar = ev.artics || [], shift = shiftAt(ref, ev.id);
          const baseEvent = {
            id: ev.id, absVal: abs, durVal: len, mIdx: item.m, planIdx: item.planIdx, pass: item.pass, voice,
            partIdx: ref.partIdx, staffIdx: ref.staffIdx, partId: ref.part.id,
            instrument: ev.drumId ? "drums" : ref.instrument, channel: ev.drumId ? 9 : channelFor(ref.part, ref.partIdx),
            mixer: mixerFor(score, ref.part), velBase: occ.vel, boost: (+ev.velocityOffset || 0) / 127,
            gate: slurCover.has(ev.id) ? 1.02 : 0.95,
          };
          if (ar.includes("tenuto")) baseEvent.gate = 1;
          if (ar.includes("staccato")) baseEvent.gate = slurCover.has(ev.id) ? 0.7 : 0.45;
          if (ar.includes("accent")) baseEvent.boost += 0.14;
          if (ar.includes("marcato")) { baseEvent.boost += 0.2; baseEvent.gate = Math.min(baseEvent.gate, 0.92); }
          if (["pizzicato", "palmMute"].includes(occ.soundFlag)) baseEvent.gate = Math.min(baseEvent.gate, 0.38);
          if (occ.soundFlag === "mute") { baseEvent.gate = Math.min(baseEvent.gate, 0.72); baseEvent.boost -= 0.08; }
          const midis = [];
          ev.notes.forEach((note, ni) => {
            if (consumed.has(idx + ":" + ni)) return;
            let total = len, current = note, last = occ;
            for (let j = idx + 1; current.tie && j < lane.length; j++) {
              const next = lane[j];
              // Ties cannot jump backwards through a repeat, Coda, or a skipped ending.
              if (!next.abs.eq(last.abs.add(last.len)) || !positions.get(next.ev.id).original.eq(positions.get(last.ev.id).original.add(last.len))) break;
              const nidx = next.ev.type === "note" ? next.ev.notes.findIndex(n => C.pitchEq(n, current)) : -1;
              if (nidx < 0) break;
              consumed.add(j + ":" + nidx); current = next.ev.notes[nidx]; total = total.add(next.len); last = next;
            }
            const midi = ev.drumId ? +(note.midi ?? ev.midi ?? C.drumSpec(ev.drumId).midi) : C.midiOf(note) + shift;
            midis.push({ midi: Math.max(0, Math.min(127, midi)), durVal: total, offsetVal: ev.arpeggiate ? F(ni, 64) : Fraction.ZERO });
          });
          if (!midis.length) return;
          const ornament = ev.ornament, tremolo = ev.tremolo || (occ.soundFlag === "tremolo" ? 3 : 0);
          if (ornament || tremolo || ev.glissando) {
            const first = ev.notes[0], rootMidi = midis[0].midi;
            const key = C.keySigAt ? C.keySigAt(score, item.m) : score.keySig;
            const neighbor = delta => { const step = first.step + delta; return C.midiOf({ step: (step + 7) % 7, oct: first.oct + Math.floor(step / 7), alter: C.keyAlterFor((step + 7) % 7, key) }) + shift; };
            let pattern = [rootMidi], slices = 1;
            if (ornament === "trill") { pattern = [rootMidi, neighbor(1)]; slices = Math.max(2, Math.ceil(len.div(F(1, 32)).value)); }
            else if (ornament === "mordent" || ornament === "invMordent") { pattern = [rootMidi, neighbor(ornament === "mordent" ? -1 : 1), rootMidi]; slices = 3; }
            else if (ornament === "turn" || ornament === "invTurn") { const dir = ornament === "turn" ? 1 : -1; pattern = [neighbor(dir), rootMidi, neighbor(-dir), rootMidi]; slices = 4; }
            else if (tremolo) slices = Math.max(2, Math.ceil(len.value * Math.pow(2, Math.min(6, (+tremolo || 3) + 2))));
            else if (ev.glissando && lane[idx + 1]?.ev.type === "note") {
              const target = C.midiOf(lane[idx + 1].ev.notes[0]) + shift, dir = Math.sign(target - rootMidi);
              pattern = Array.from({ length: Math.min(49, Math.abs(target - rootMidi) + 1) }, (_, i) => rootMidi + dir * i); slices = pattern.length;
            }
            slices = Math.min(256, slices);
            let at = abs;
            for (let i = 0; i < slices; i++) {
              let span = len.div(F(slices));
              if (/^(invMordent|mordent)$/.test(ornament)) span = i < 2 ? (len.div(F(3)).lt(F(1, 32)) ? len.div(F(3)) : F(1, 32)) : abs.add(len).sub(at);
              const pitches = tremolo && !ornament ? midis.map(n => ({ ...n, durVal: span })) : [{ midi: Math.max(0, Math.min(127, pattern[i % pattern.length])), durVal: span }];
              events.push({ ...baseEvent, absVal: at, durVal: span, midis: pitches, gate: i === slices - 1 ? baseEvent.gate : 1, ornament: ornament || undefined });
              at = at.add(span);
            }
            if (ornament && midis.length > 1) events.push({ ...baseEvent, midis: midis.slice(1) });
          } else events.push({ ...baseEvent, midis });
          (ev.graceBefore || []).forEach((gr, gi, arr) => {
            const before = abs.sub(F(arr.length - gi, 32)), at = before.n < 0 ? Fraction.ZERO : before;
            events.push({ ...baseEvent, id: gr.id, absVal: at, durVal: F(1, 32), gate: 0.9, midis: (gr.notes || []).map(n => ({ midi: C.midiOf(n) + shift, durVal: F(1, 32) })) });
          });
        });
      }
    }
    // Apply a hairpin only to its own staff and each actual traversal.
    for (const sp of score.spanners || []) if (["cresc", "dim"].includes(sp.type)) {
      for (const a of occurrences.filter(o => o.ev.id === sp.startId)) {
        const b = occurrences.find(o => o.ref === a.ref && o.ev.id === sp.endId && o.abs.gte(a.abs));
        if (!b) continue;
        const after = occurrences.find(o => o.ref === a.ref && o.abs.gt(b.abs) && VELS[o.ev.dynamic] !== undefined);
        let target = after?.vel ?? a.vel + (sp.type === "cresc" ? 0.16 : -0.16);
        if ((sp.type === "cresc" && target < a.vel) || (sp.type === "dim" && target > a.vel)) target = a.vel + (sp.type === "cresc" ? 0.16 : -0.16);
        for (const ev of events) if (ev.partIdx === a.ref.partIdx && ev.staffIdx === a.ref.staffIdx && ev.absVal.gte(a.abs) && ev.absVal.lte(b.abs)) {
          ev.velBase = a.vel + (target - a.vel) * (a.abs.eq(b.abs) ? 1 : ev.absVal.sub(a.abs).div(b.abs.sub(a.abs)).value);
        }
      }
    }
    const holdList = [...holds.values()].sort((a, b) => a.at.cmp(b.at));
    const held = abs => holdList.reduce((sum, hold) => hold.at.lte(abs) ? sum.add(hold.extra) : sum, abs);
    const swung = (abs, item) => {
      const ratio = SWING[score.playbackSettings?.swing] || 0;
      if (!ratio || !item) return abs;
      const tick = abs.sub(item.abs), q = tick.div(F(1, 8));
      return q.d === 1 && q.n % 2 === 1 ? abs.add(F(Math.round((ratio * 2 - 1) * 1000), 8000)) : abs;
    };
    for (const change of tempoChanges) change.abs = held(change.abs);
    const clock = secondsMap(tempoChanges);
    for (const ev of events) {
      const original = ev.absVal, item = expandedPlan[ev.planIdx], onset = held(swung(original, item));
      ev.durVal = held(original.add(ev.durVal)).sub(held(original));
      ev.absVal = onset; ev.t = clock.secondsAt(onset); ev.durSec = clock.durationSec(onset, ev.durVal);
      for (const n of ev.midis) {
        const end = held(swung(original.add(n.durVal), item));
        n.durVal = end.sub(onset);
        n.durSec = clock.durationSec(onset, n.durVal);
        n.offsetVal = n.offsetVal || Fraction.ZERO; n.offsetSec = clock.durationSec(onset, n.offsetVal);
      }
      ev.vel = Math.max(0.01, Math.min(1, ev.velBase + ev.boost));
    }
    for (const ev of timelineEvents) {
      const end = held(ev.absVal.add(ev.durVal)); ev.absVal = held(ev.absVal);
      ev.t = clock.secondsAt(ev.absVal); ev.durSec = clock.secondsAt(end) - ev.t;
    }
    for (const beat of beats) { beat.abs = held(beat.abs); beat.t = clock.secondsAt(beat.abs); }
    for (const sig of signatures) sig.abs = held(sig.abs);
    for (const item of expandedPlan) { item.abs = held(item.abs); item.startSec = clock.secondsAt(item.abs); item.baseStartSec = base.secondsAt(item.baseAbs); }
    totalAbs = held(totalAbs);
    const totalSec = clock.secondsAt(totalAbs);
    events.sort((a, b) => a.t - b.t || a.partIdx - b.partIdx || a.staffIdx - b.staffIdx);
    timelineEvents.sort((a, b) => a.t - b.t || a.partIdx - b.partIdx || a.staffIdx - b.staffIdx);
    const measureTimes = expandedPlan.map(p => p.startSec).concat(totalSec);
    return { events, timelineEvents, spw: 240 / clock.changes[0].tempo, mLenSec: measureTimes[1] || totalSec,
      totalSec, totalAbs, beatTimes: beats, measureTimes, tempoChanges: clock.changes, signatures,
      playbackPlan: expandedPlan, warnings: plan.warnings, secondsAt: clock.secondsAt };
  }

  /* ---------------- 재생 컨트롤 ---------------- */
  const player = {
    playing: false, startCtxTime: 0, startOffset: 0, timer: null, raf: null, compiled: null,
    loading: false, startToken: 0, nextIdx: 0, nextBeat: 0, metronome: false,
    rate: 1, loop: null, countIn: false, cycle: 0, sessionSamples: new Set(),
    onTick: null, onState: null, onEnd: null, score: null,
  };

  function silence() {
    for (const node of live) { try { node.stop(); } catch (e) { } }
    live.clear();
    for (const rec of sampleInstruments.values()) if (rec.instrument && rec.ready) { try { rec.instrument.stop(); } catch (e) { } }
  }
  function setRate(rate) {
    const pos = pausePos();
    player.rate = Math.max(0.5, Math.min(2, +rate || 1));
    if (player.playing) seek(pos);
    return player.rate;
  }
  function setLoop(loop, endSec) {
    if (typeof loop === "number") loop = { startSec: loop, endSec };
    const start = Math.max(0, +loop?.startSec || 0), end = +loop?.endSec;
    player.loop = loop && Number.isFinite(end) && end > start ? { startSec: start, endSec: end } : null;
    if (player.playing) seek(pausePos());
    return player.loop;
  }
  function bounds() {
    const end = Math.min(player.compiled?.totalSec || 0, player.loop?.endSec ?? Infinity);
    const start = Math.min(Math.max(0, player.loop?.startSec || 0), Math.max(0, end - 0.001));
    return { start, end, looping: !!player.loop && end > start };
  }
  function rewindIndices(offset) {
    const comp = player.compiled;
    player.nextIdx = comp.events.findIndex(ev => ev.t >= offset - 1e-7);
    if (player.nextIdx < 0) player.nextIdx = comp.events.length;
    player.nextBeat = comp.beatTimes.findIndex(beat => beat.t >= offset - 1e-7);
    if (player.nextBeat < 0) player.nextBeat = comp.beatTimes.length;
    player.chase = comp.events.filter(ev => ev.t < offset - 1e-7 && ev.midis.some(n => ev.t + (n.offsetSec || 0) + n.durSec * ev.gate > offset));
  }
  function seek(sec) {
    if (!player.compiled) return 0;
    const range = bounds();
    const pos = Math.max(range.looping ? range.start : 0, Math.min(+sec || 0, range.end - 0.001));
    silence();
    player.startOffset = pos; player.startCtxTime = (ctx?.currentTime || 0) + 0.03; player.cycle = 0;
    rewindIndices(pos);
    if (player.playing) pump();
    return pos;
  }
  function pausePos() {
    if (!player.playing || !ctx) return player.startOffset || 0;
    let pos = (ctx.currentTime - player.startCtxTime) * player.rate + player.startOffset;
    const range = bounds();
    if (range.looping && pos >= range.end) pos = range.start + (pos - range.end) % (range.end - range.start);
    return Math.max(0, pos);
  }
  function pump() {
    if (!player.playing) return;
    const range = bounds(), comp = player.compiled, now = ctx.currentTime, horizon = now + 0.18;
    updateMixer(player.score);
    let safety = 0;
    while (safety++ < 64) {
      const offset = player.cycle ? range.start : player.startOffset;
      const cycleTime = player.startCtxTime + (player.cycle ? (range.end - player.startOffset + (player.cycle - 1) * (range.end - range.start)) / player.rate : 0);
      const toTime = sec => cycleTime + (sec - offset) / player.rate;
      if (player.chase && cycleTime <= horizon) {
        for (const ev of player.chase) for (const n of ev.midis) {
          const duration = Math.min(ev.t + (n.offsetSec || 0) + n.durSec * ev.gate - offset, range.end - offset) / player.rate;
          if (duration > 0 && cycleTime >= now - 0.08) {
            const when = Math.max(now, cycleTime), preset = INSTRUMENTS[ev.instrument] || INSTRUMENTS.piano;
            if (!scheduleSampleNote(ev.instrument, n.midi, when, duration, ev.vel, ev.partId, player.sessionSamples)) scheduleNote(preset, n.midi, when, duration, ev.vel, 0, ev.partId);
          }
        }
        player.chase = null;
      }
      while (player.nextIdx < comp.events.length) {
        const ev = comp.events[player.nextIdx];
        if (ev.t >= range.end - 1e-8 || toTime(ev.t) > horizon) break;
        const when = toTime(ev.t);
        if (when >= now - 0.08) for (const n of ev.midis) {
          const noteWhen = Math.max(now, when + (n.offsetSec || 0) / player.rate);
          const remaining = Math.max(0, range.end - ev.t - (n.offsetSec || 0));
          const dur = Math.min(n.durSec * ev.gate, remaining) / player.rate;
          if (dur <= 0) continue;
          const preset = INSTRUMENTS[ev.instrument] || INSTRUMENTS.piano;
          if (!scheduleSampleNote(ev.instrument, n.midi, noteWhen, dur, ev.vel, ev.partId, player.sessionSamples)) scheduleNote(preset, n.midi, noteWhen, dur, ev.vel, 0, ev.partId);
        }
        player.nextIdx++;
      }
      while (player.nextBeat < comp.beatTimes.length) {
        const beat = comp.beatTimes[player.nextBeat], when = toTime(beat.t);
        if (beat.t >= range.end - 1e-8 || when > horizon) break;
        if (player.metronome && when >= now - 0.01) scheduleClick(Math.max(now, when), beat.accent);
        player.nextBeat++;
      }
      if (!range.looping || toTime(range.end) > horizon) break;
      player.cycle++; rewindIndices(range.start);
    }
  }

  async function play(fromSec = 0, opts = {}) {
    stop(false);
    const token = ++player.startToken, score = C.state.score, ac = audio();
    player.score = score; player.compiled = compile(score, opts);
    if (opts.rate !== undefined) player.rate = Math.max(0.5, Math.min(2, +opts.rate || 1));
    if (opts.loop !== undefined) setLoop(opts.loop);
    if (opts.countIn !== undefined) player.countIn = !!opts.countIn;
    player.loading = true; player.onState?.(true);
    updateMixer(score);
    await Promise.race([warmSamplesForScore(score), delay(Math.max(0, opts.sampleTimeoutMs ?? 2200))]).catch(() => {});
    if (token !== player.startToken) return;
    // Snapshot once: a late sample load is available only to the next session.
    player.sessionSamples = new Set([...sampleInstruments].filter(([, rec]) => rec.ready && !rec.failed).map(([key]) => key));
    const expected = score.parts.filter(p => p.instrument !== "drums");
    if (expected.some(p => !player.sessionSamples.has(p.id + ":" + sampleKey(p.instrument)))) setSampleStatus("fallback", "신스 사용", "이번 재생은 준비된 음원으로 끝까지 재생합니다. 다음 재생에 새 샘플을 적용합니다.");
    player.loading = false;
    seek(fromSec);
    player.playing = true;
    if (player.countIn && player.metronome) {
      const planItem = [...player.compiled.playbackPlan].reverse().find(p => p.startSec <= player.startOffset) || player.compiled.playbackPlan[0];
      const ts = timeAt(score, planItem?.m || 0);
      const initialTempo = [...player.compiled.tempoChanges].reverse().find(c => player.compiled.secondsAt(c.abs) <= player.startOffset)?.tempo || score.tempo;
      const beatSec = 240 / initialTempo / ts.den / player.rate;
      silence(); player.startCtxTime = ac.currentTime + 0.08 + ts.num * beatSec;
      for (let i = 0; i < ts.num; i++) scheduleClick(ac.currentTime + 0.08 + i * beatSec, i === 0);
      rewindIndices(player.startOffset);
    }
    pump(); player.timer = setInterval(pump, 25);
    const tickLoop = () => {
      if (!player.playing) return;
      const sec = pausePos(), range = bounds();
      if (!range.looping && sec >= range.end + 0.1) { stop(true); player.onEnd?.(); return; }
      player.onTick?.(Math.max(0, sec), player.compiled);
      player.raf = requestAnimationFrame(tickLoop);
    };
    player.raf = requestAnimationFrame(tickLoop); player.onState?.(true);
    return player.compiled;
  }

  function stop(notify = true) {
    player.startToken++;
    if (player.timer) { clearInterval(player.timer); player.timer = null; }
    if (player.raf) { cancelAnimationFrame(player.raf); player.raf = null; }
    const wasPlaying = player.playing || player.loading;
    if (player.playing) player.startOffset = pausePos();
    player.playing = false; player.loading = false; silence();
    if (notify && wasPlaying) player.onState?.(false);
  }

  /* 미리듣기(클릭/입력 피드백) */
  function previewNote(midis, durSec = 0.45) {
    const score = C.state.score, ref = C.activeRef ? C.activeRef(score) : null;
    const instrument = ref?.instrument || score.instrument, preset = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
    const ac = audio(), partId = ref?.part?.id || "preview";
    updateMixer(score);
    for (const midi of Array.isArray(midis) ? midis : [midis]) {
      if (!scheduleSampleNote(instrument, midi, ac.currentTime + 0.01, durSec, 0.7, partId)) scheduleNote(preset, midi, ac.currentTime + 0.01, durSec, 0.7, 0, partId);
    }
  }

  /* ---------------- MIDI 내보내기 (SMF type 1) ---------------- */
  function exportMidi(score) {
    const comp = compile(score);
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    let PPQ = 480;
    for (const ev of comp.events) for (const pos of [ev.absVal, ...ev.midis.map(n => n.durVal)]) {
      const den = pos.d / gcd(pos.d, 4), next = PPQ / gcd(PPQ, den) * den;
      if (next <= 32767) PPQ = next;
    }
    const toTicks = abs => Math.round(abs.n * 4 * PPQ / abs.d);
    const u24 = v => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const vlq = v => { const out = [v & 127]; while ((v = Math.floor(v / 128)) > 0) out.unshift((v & 127) | 128); return out; };
    const textMeta = (type, value) => { const bytes = [...new TextEncoder().encode(value)]; return [255, type, ...vlq(bytes.length), ...bytes]; };
    const conductor = [{ tick: 0, data: textMeta(3, "Tempo / meter") }];
    for (const chg of comp.tempoChanges) conductor.push({ tick: toTicks(chg.abs), data: [255, 81, 3, ...u24(Math.max(1, Math.min(0xffffff, Math.round(60000000 / chg.tempo))))] });
    let lastSig = "", lastKey = null;
    for (const sig of comp.signatures) {
      const ts = sig.timeSig, key = sig.keySig, label = ts.num + "/" + ts.den;
      if (label !== lastSig) { conductor.push({ tick: toTicks(sig.abs), data: [255, 88, 4, ts.num, Math.log2(ts.den), 24, 8] }); lastSig = label; }
      if (key !== lastKey) { conductor.push({ tick: toTicks(sig.abs), data: [255, 89, 2, key & 255, 0] }); lastKey = key; }
    }
    const anySolo = score.parts.some(p => mixerFor(score, p).solo);
    const tracks = [conductor, ...score.parts.map((part, pIdx) => {
      const ch = channelFor(part, pIdx), mx = mixerFor(score, part);
      const gm = Number.isInteger(part.midiProgram) ? part.midiProgram : (INSTRUMENTS[part.instrument] || INSTRUMENTS.piano).gm;
      return [{ tick: 0, data: textMeta(3, part.name || part.instrument || "Part") },
        { tick: 0, data: [0xC0 | ch, gm & 127] },
        { tick: 0, data: [0xB0 | ch, 7, mx.mute || (anySolo && !mx.solo) ? 0 : Math.min(127, Math.round(mx.volume * 100))] },
        { tick: 0, data: [0xB0 | ch, 10, Math.max(0, Math.min(127, Math.round(64 + mx.pan * 63)))] }];
    })];
    for (const ev of comp.events) for (const n of ev.midis) {
      const ch = ev.channel, start = ev.absVal.add(n.offsetVal || Fraction.ZERO);
      const duration = n.durVal.mul(F(Math.round(ev.gate * 1000), 1000));
      const tick = toTicks(start), end = Math.max(tick + 1, toTicks(start.add(duration)));
      tracks[ev.partIdx + 1].push({ tick, data: [0x90 | ch, Math.round(n.midi), Math.max(1, Math.min(127, Math.round(ev.vel * 120)))] },
        { tick: end, data: [0x80 | ch, Math.round(n.midi), 0] });
    }
    const bytes = [];
    const str = value => { for (const ch of value) bytes.push(ch.charCodeAt(0)); };
    const u16 = n => bytes.push((n >> 8) & 255, n & 255);
    const u32 = n => bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    str("MThd"); u32(6); u16(1); u16(tracks.length); u16(PPQ);
    for (const messages of tracks) {
      const priority = msg => (msg.data[0] & 0xf0) === 0x80 ? 0 : (msg.data[0] & 0xf0) === 0x90 ? 2 : 1;
      messages.sort((a, b) => a.tick - b.tick || priority(a) - priority(b));
      const data = []; let previous = 0;
      for (const msg of messages) { data.push(...vlq(msg.tick - previous), ...msg.data); previous = msg.tick; }
      data.push(...vlq(Math.max(0, toTicks(comp.totalAbs) - previous)), 255, 47, 0);
      str("MTrk"); u32(data.length); for (const byte of data) bytes.push(byte);
    }
    return new Uint8Array(bytes);
  }

  SF.playback = {
    INSTRUMENTS, audio,
    play, stop, previewNote, pausePos, player, compile, exportMidi,
    setRate, setLoop, seek, updateMixer, partBuses, buildTempoMap,
    getSampleStatus, setSampleStatusHandler, ensureSampleInstrument, buildPlaybackPlan,
  };
})(window.SF);
