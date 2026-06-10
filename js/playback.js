/* =========================================================================
 * ScoreForge playback — 악보 → 이벤트 컴파일 + Web Audio 재생/샘플러/신스/메트로놈/MIDI
 * 스케줄러는 "두 개의 시계" 패턴: setInterval 루프가 lookahead 안의 이벤트를
 * AudioContext 절대시각으로 예약한다.
 * ========================================================================= */
"use strict";
(function (SF) {
  const C = SF.core;
  const { Fraction } = SF;
  const SMPLR_URL = "https://unpkg.com/smplr/dist/index.mjs";

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
    chiptune: {
      label: "8비트", gm: 80,
      partials: [{ type: "square", ratio: 1, gain: 0.16 }],
      attack: 0.002, decayTau: 0, sustain: 0.8, release: 0.04,
      filter: { type: "lowpass", base: 5000, perVel: 2000, q: 0.2 }, percussive: false,
    },
  };

  /* ---------------- 신스 엔진 ---------------- */
  let ctx = null, master = null, limiter = null;
  const live = new Set(); // 정지 시 끊을 노드들
  const sampleInstruments = new Map();
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
      smplrPromise = import(SMPLR_URL).then(mod => {
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

  function createSampleInstrument(mod, key) {
    const spec = SAMPLE_MAP[sampleKey(key)];
    const opts = {
      destination: master,
      volume: spec.volume || 96,
      onLoadProgress: ({ loaded, total }) => {
        setSampleStatus("loading", `${loaded}/${total}`, `${spec.label} 샘플을 불러오는 중입니다.`);
      },
    };
    if (spec.kind === "splendid" && mod.SplendidGrandPiano) return mod.SplendidGrandPiano(ctx, opts);
    if (mod.Soundfont) return mod.Soundfont(ctx, { ...opts, instrument: spec.instrument });
    throw new Error("smplr Soundfont factory is unavailable");
  }

  function ensureSampleInstrument(instrument) {
    const key = sampleKey(instrument);
    const cached = sampleInstruments.get(key);
    if (cached) return cached.promise;
    const rec = { instrument: null, ready: false, failed: false, promise: null };
    rec.promise = (async () => {
      const mod = await loadSmplrModule();
      const inst = createSampleInstrument(mod, key);
      rec.instrument = inst;
      await (inst.ready || inst.load || Promise.resolve(inst));
      rec.ready = true;
      setSampleStatus("ready", "샘플 준비", `${(SAMPLE_MAP[key] || SAMPLE_MAP.piano).label} 샘플 음원 준비 완료`);
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
    const keys = new Set();
    for (const ref of C.staffRefs(score)) keys.add(sampleKey(ref.instrument || score.instrument));
    return Promise.all([...keys].map(key => ensureSampleInstrument(key)));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function scheduleSampleNote(instrument, midi, when, dur, vel) {
    const rec = sampleInstruments.get(sampleKey(instrument));
    if (!rec || !rec.ready || !rec.instrument || rec.failed) {
      ensureSampleInstrument(instrument);
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

  /* 음 하나 예약 */
  function scheduleNote(preset, midi, when, dur, vel = 0.8) {
    const ac = audio();
    const f = midiToFreq(midi + (preset.octShift || 0));
    const g = ac.createGain();
    g.gain.value = 0;
    let dest = g;
    if (preset.filter) {
      const fl = ac.createBiquadFilter();
      fl.type = preset.filter.type;
      fl.frequency.value = Math.min(preset.filter.base + preset.filter.perVel * vel + f * 1.2, 12000);
      fl.Q.value = preset.filter.q;
      g.connect(fl); fl.connect(master); dest = g;
    } else {
      g.connect(master);
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
      src.connect(bf).connect(bg).connect(master);
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

  function compile(score) {
    C.ensureParts(score);
    const spw = 4 * 60 / score.tempo; // 온음표 1개의 초
    const L = C.measureLen(score);
    const mLenSec = L.value * spw;
    const events = [];
    const consumed = new Set(); // "m:e:midi" 타이로 흡수된 음
    const slurCover = C.slurCoverMap ? C.slurCoverMap(score) : new Set();
    const dynList = []; // 명시적 셈여림 [{t, v}] — 헤어핀 목표 탐색용
    const posById = new Map(); // 이벤트 id → {t, vel} (쉼표 포함)
    let maxMeasures = 0;

    for (const ref of C.staffRefs(score)) {
      let vel = VELS.mf;
      maxMeasures = Math.max(maxMeasures, ref.measures.length);
      for (let m = 0; m < ref.measures.length; m++) {
        const evs = ref.measures[m].events;
        let tick = Fraction.ZERO;
        for (let e = 0; e < evs.length; e++) {
          const ev = evs[e];
          const t = m * mLenSec + tick.value * spw;
          const dval = C.durValue(ev.dur).value * spw;
          if (ev.dynamic && VELS[ev.dynamic] !== undefined) {
            vel = VELS[ev.dynamic];
            dynList.push({ t, v: vel });
          }
          posById.set(ev.id, { t, vel });
          if (ev.type === "note") {
            const midis = [];
            for (const note of ev.notes) {
              const midi = C.midiOf(note);
              const key = ref.globalIdx + ":" + m + ":" + e + ":" + midi;
              if (consumed.has(key)) continue;
              // 타이 체인 길이 합산
              let total = dval;
              let cur = { ...ref, m, e, ev }, curNote = note;
              while (curNote.tie) {
                const nx = C.nextEvent(score, cur.m, cur.e, ref);
                if (!nx || nx.ev.type !== "note") break;
                const n2 = nx.ev.notes.find(n => C.midiOf(n) === midi && n.step === curNote.step);
                if (!n2) break;
                consumed.add(ref.globalIdx + ":" + nx.m + ":" + nx.e + ":" + midi);
                total += C.durValue(nx.ev.dur).value * spw;
                cur = nx; curNote = n2;
              }
              midis.push({ midi, durSec: total });
            }
            if (midis.length) {
              const ar = ev.artics || [];
              let gate = 0.95, boost = 0;
              if (slurCover.has(ev.id)) gate = 1.02;            // 레가토
              if (ar.includes("tenuto")) gate = 1.0;
              if (ar.includes("staccato")) gate = slurCover.has(ev.id) ? 0.7 : 0.45;
              if (ar.includes("fermata")) gate = Math.max(gate, 1.05);
              if (ar.includes("accent")) boost += 0.14;
              if (ar.includes("marcato")) { boost += 0.2; if (!ar.includes("staccato")) gate = Math.min(gate, 0.92); }
              events.push({
                id: ev.id, t, durSec: dval, midis, mIdx: m,
                partIdx: ref.partIdx, staffIdx: ref.staffIdx,
                channel: Math.min(15, ref.partIdx),
                instrument: ref.instrument,
                velBase: vel, boost, gate,
              });
            }
          }
          tick = tick.add(C.durValue(ev.dur));
        }
      }
    }

    // 헤어핀: 시작 레벨 → (헤어핀 뒤 첫 셈여림 | ±0.16) 선형 보간
    for (const sp of score.spanners || []) {
      if (sp.type !== "cresc" && sp.type !== "dim") continue;
      const a = posById.get(sp.startId), b = posById.get(sp.endId);
      if (!a || !b || b.t < a.t) continue;
      const v0 = a.vel;
      const after = dynList.find(d => d.t > b.t + 1e-6);
      let v1 = after ? after.v : v0 + (sp.type === "cresc" ? 0.16 : -0.16);
      if (sp.type === "cresc" && v1 < v0) v1 = v0 + 0.16;
      if (sp.type === "dim" && v1 > v0) v1 = v0 - 0.16;
      v1 = Math.max(0.2, Math.min(1, v1));
      for (const ev of events) {
        if (ev.t >= a.t - 1e-9 && ev.t <= b.t + 1e-9) {
          const f = b.t === a.t ? 1 : (ev.t - a.t) / (b.t - a.t);
          ev.velBase = v0 + (v1 - v0) * f;
        }
      }
    }
    for (const ev of events) ev.vel = Math.max(0.15, Math.min(1, ev.velBase + ev.boost));

    events.sort((a, b) => a.t - b.t || a.partIdx - b.partIdx || a.staffIdx - b.staffIdx);
    return { events, spw, mLenSec, totalSec: Math.max(1, maxMeasures) * mLenSec };
  }

  /* ---------------- 재생 컨트롤 ---------------- */
  const player = {
    playing: false,
    startCtxTime: 0,
    startOffset: 0,
    timer: null,
    raf: null,
    compiled: null,
    loading: false,
    startToken: 0,
    nextIdx: 0,
    nextBeat: 0,
    metronome: false,
    onTick: null,   // (sec, compiled) → UI 갱신
    onState: null,  // (playing) → UI 갱신
    onEnd: null,
  };

  async function play(fromSec = 0) {
    stop(false);
    const token = ++player.startToken;
    const score = C.state.score;
    const ac = audio();
    const comp = compile(score);
    if (!comp.events.length && !player.metronome) {
      // 빈 악보도 커서는 움직이게 재생은 허용
    }
    player.compiled = comp;
    player.loading = true;
    player.onState && player.onState(true);
    try {
      await Promise.race([warmSamplesForScore(score), delay(2200)]);
    } catch (e) { }
    if (token !== player.startToken) return;
    player.loading = false;
    player.startOffset = Math.max(0, Math.min(fromSec, comp.totalSec - 0.001));
    player.startCtxTime = ac.currentTime + 0.12;
    player.nextIdx = comp.events.findIndex(ev => ev.t >= player.startOffset - 1e-6);
    if (player.nextIdx < 0) player.nextIdx = comp.events.length;
    const spb = comp.spw / score.timeSig.den; // 한 박(분모 기준)의 초
    player.nextBeat = Math.ceil((player.startOffset - 1e-9) / spb);
    player.playing = true;

    const LOOKAHEAD = 0.18;

    const pump = () => {
      const now = ac.currentTime;
      const horizon = now - player.startCtxTime + player.startOffset + LOOKAHEAD;
      const evs = comp.events;
      while (player.nextIdx < evs.length && evs[player.nextIdx].t <= horizon) {
        const ev = evs[player.nextIdx];
        const when = player.startCtxTime + (ev.t - player.startOffset);
        const preset = INSTRUMENTS[ev.instrument] || INSTRUMENTS[score.instrument] || INSTRUMENTS.piano;
        for (const n of ev.midis) {
          const dur = Math.max(0.05, n.durSec * (ev.gate || 0.95));
          if (!scheduleSampleNote(ev.instrument || score.instrument, n.midi, when, dur, ev.vel || 0.7)) {
            scheduleNote(preset, n.midi, when, dur, ev.vel || 0.7);
          }
        }
        player.nextIdx++;
      }
      if (player.metronome) {
        const beats = score.timeSig.num;
        while (player.nextBeat * spb <= horizon && player.nextBeat * spb < comp.totalSec) {
          const bIdx = player.nextBeat;
          const when = player.startCtxTime + (bIdx * spb - player.startOffset);
          if (when >= now - 0.01) scheduleClick(when, bIdx % beats === 0);
          player.nextBeat++;
        }
      }
    };
    pump();
    player.timer = setInterval(pump, 25);

    const tickLoop = () => {
      if (!player.playing) return;
      const sec = ac.currentTime - player.startCtxTime + player.startOffset;
      if (sec >= comp.totalSec + 0.25) {
        stop(true);
        player.onEnd && player.onEnd();
        return;
      }
      player.onTick && player.onTick(Math.max(0, sec), comp);
      player.raf = requestAnimationFrame(tickLoop);
    };
    player.raf = requestAnimationFrame(tickLoop);
    player.onState && player.onState(true);
  }

  function stop(notify = true) {
    player.startToken++;
    if (player.timer) { clearInterval(player.timer); player.timer = null; }
    if (player.raf) { cancelAnimationFrame(player.raf); player.raf = null; }
    const wasPlaying = player.playing || player.loading;
    player.playing = false;
    player.loading = false;
    for (const node of live) { try { node.stop(); } catch (e) { } }
    live.clear();
    for (const rec of sampleInstruments.values()) {
      if (rec.instrument && rec.ready) {
        try { rec.instrument.stop(); } catch (e) { }
      }
    }
    if (notify && wasPlaying && player.onState) player.onState(false);
  }

  function pausePos() {
    if (!player.playing || !ctx) return 0;
    return ctx.currentTime - player.startCtxTime + player.startOffset;
  }

  /* 미리듣기(클릭/입력 피드백) */
  function previewNote(midis, durSec = 0.45) {
    const score = C.state.score;
    const ref = C.activeRef ? C.activeRef(score) : null;
    const preset = INSTRUMENTS[ref?.instrument || score.instrument] || INSTRUMENTS.piano;
    const ac = audio();
    const arr = Array.isArray(midis) ? midis : [midis];
    const instrument = ref?.instrument || score.instrument;
    for (const m of arr) {
      if (!scheduleSampleNote(instrument, m, ac.currentTime + 0.01, durSec, 0.7)) {
        scheduleNote(preset, m, ac.currentTime + 0.01, durSec, 0.7);
      }
    }
  }

  /* ---------------- MIDI 내보내기 (SMF type 0) ---------------- */
  function exportMidi(score) {
    const PPQ = 480;
    const comp = compile(score);
    const spq = comp.spw / 4; // 4분음표 초
    const toTicks = (sec) => Math.round(sec / spq * PPQ);

    const msgs = []; // {tick, data[]}
    msgs.push({ tick: 0, data: [0xFF, 0x51, 0x03, ...u24(Math.round(60000000 / score.tempo))] });
    msgs.push({ tick: 0, data: [0xFF, 0x58, 0x04, score.timeSig.num, Math.log2(score.timeSig.den), 24, 8] });
    for (const part of score.parts || [{ instrument: score.instrument }]) {
      const ch = Math.min(15, (score.parts || []).indexOf(part));
      const gm = (INSTRUMENTS[part.instrument || score.instrument] || INSTRUMENTS.piano).gm;
      msgs.push({ tick: 0, data: [0xC0 | ch, gm] });
    }
    for (const ev of comp.events) {
      const v = Math.max(1, Math.min(127, Math.round((ev.vel || 0.7) * 120)));
      const gate = Math.min(ev.gate || 0.95, 0.98);
      for (const n of ev.midis) {
        const ch = ev.channel || 0;
        msgs.push({ tick: toTicks(ev.t), data: [0x90 | ch, n.midi, v] });
        msgs.push({ tick: toTicks(ev.t + n.durSec * gate), data: [0x80 | ch, n.midi, 0] });
      }
    }
    msgs.sort((a, b) => a.tick - b.tick || noteOffFirst(a, b));
    function noteOffFirst(a, b) {
      const offA = (a.data[0] & 0xF0) === 0x80 ? 0 : 1;
      const offB = (b.data[0] & 0xF0) === 0x80 ? 0 : 1;
      return offA - offB;
    }

    const track = [];
    let last = 0;
    for (const m of msgs) {
      vlq(track, m.tick - last); last = m.tick;
      track.push(...m.data);
    }
    vlq(track, 0); track.push(0xFF, 0x2F, 0x00);

    const bytes = [];
    pushStr(bytes, "MThd"); pushU32(bytes, 6); pushU16(bytes, 0); pushU16(bytes, 1); pushU16(bytes, PPQ);
    pushStr(bytes, "MTrk"); pushU32(bytes, track.length); bytes.push(...track);
    return new Uint8Array(bytes);

    function vlq(arr, v) {
      v = Math.max(0, Math.round(v));
      const stack = [v & 0x7F];
      while (v >>= 7) stack.push((v & 0x7F) | 0x80);
      stack.reverse().forEach(b => arr.push(b));
    }
    function u24(v) { return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
    function pushStr(arr, s) { for (const ch of s) arr.push(ch.charCodeAt(0)); }
    function pushU32(arr, v) { arr.push((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255); }
    function pushU16(arr, v) { arr.push((v >> 8) & 255, v & 255); }
  }

  SF.playback = {
    INSTRUMENTS, audio,
    play, stop, previewNote, pausePos, player, compile, exportMidi,
    getSampleStatus, setSampleStatusHandler, ensureSampleInstrument,
  };
})(window.SF);
