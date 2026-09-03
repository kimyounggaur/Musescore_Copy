/* Load after core/playback/io (for example with Playwright addScriptTag).
 * The optional returned promise makes asynchronous file-open tests reviewable. */
window.__AUDIOIO_DONE = (async () => {
  const C = SF.core, IO = SF.io, P = SF.playback, F = SF.F;
  const results = [], check = (value, message) => { if (!value) throw new Error(message); };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  const run = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: error.message, stack: error.stack }); } };
  const add = (score, m, tick, dur, midi, ctx) => C.inputAt(score, m, tick, dur, [C.spellMidi(midi, 0)], ctx);
  const sequence = score => C.staffRefs(score).map(ref => ref.measures.map(mm => C.measureEntries(mm, { score }).filter(it => it.ev.type === 'note').map(it => [it.voice, it.tick.toString(), C.durValue(it.ev.dur).toString(), it.ev.notes.map(n => [n.step, n.alter, n.oct, !!n.tie])])));
  const sound = score => P.compile(score).events.map(ev => [ev.t, ev.midis.map(n => n.midi)]);

  await run('four baseline demo round trips', () => {
    for (const demo of Object.values(IO.DEMOS)) { const score = demo(), imported = IO.parseMusicXML(IO.exportMusicXML(score)).score; equal(sequence(score), sequence(imported), score.meta.title); }
  });
  await run('piano grand staff + flute preserve all voices and exact tuplets', () => {
    const s = C.createScore({ measureCount: 2, parts: ['piano', 'flute'] });
    add(s, 0, F(0), { n: 1, d: 4 }, 60, { partIdx: 0, staffIdx: 0, voice: 1 });
    add(s, 0, F(0), { n: 1, d: 2 }, 48, { partIdx: 0, staffIdx: 1, voice: 1 });
    add(s, 0, F(0), { n: 1, d: 2 }, 55, { partIdx: 0, staffIdx: 0, voice: 2 });
    add(s, 1, F(0), { n: 1, d: 4 }, 74, { partIdx: 1, staffIdx: 0 });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(add(s, 0, F(i, 12), { n: 1, d: 8, tuplet: { actual: 3, normal: 2, id: 'testTuplet' } }, 72 + i * 2, { partIdx: 1, staffIdx: 0 }));
    for (const id of ids) C.findEvent(s, id).ev.dur = { n: 1, d: 8, dots: 0, tuplet: { actual: 3, normal: 2, id: 'testTuplet' } };
    const xml = IO.exportMusicXML(s), r = IO.parseMusicXML(xml);
    equal(sequence(s), sequence(r.score), 'all staff events');
    check(C.staffRefs(r.score).length === 3, 'all staves');
    const triplets = C.staffRefs(r.score)[2].measures[0].voices[0].filter(ev => ev.dur.tuplet);
    check(triplets.length === 3 && new Set(triplets.map(ev => ev.dur.tuplet.id)).size === 1, 'shared tuplet group');
  });
  await run('key/time/clef changes, pickup, 64ths, double dots and breve', () => {
    const s = C.createScore({ measureCount: 3, timeSig: { num: 4, den: 4 } });
    s.measures[0].pickup = [1, 4]; s.measures[1].timeSig = { num: 3, den: 4 }; s.measures[1].keySig = -3; s.measures[1].clef = 'alto';
    s.measures[2].timeSig = { num: 8, den: 4 }; s.measures[2].clef = 'tenor'; C.invalidate(s);
    for (let m = 0; m < 3; m++) { s.measures[m].voices = Array.from({ length: 4 }, (_, v) => [{ ...C.fullRest(s, m), voice: v + 1 }]); }
    add(s, 0, F(0), { n: 1, d: 64 }, 60);
    add(s, 1, F(0), { n: 1, d: 4, dots: 2 }, 62);
    add(s, 2, F(0), { n: 2, d: 1 }, 48);
    const r = IO.parseMusicXML(IO.exportMusicXML(s)).score;
    equal(sequence(s), sequence(r), 'notes and durations');
    equal(C.measureStarts(r).map(String), C.measureStarts(s).map(String), 'actual measure lengths');
    check(C.keySigAt(r, 1) === -3 && C.clefAt(C.staffRefs(r)[0], 1) === 'alto' && C.clefAt(C.staffRefs(r)[0], 2) === 'tenor', 'inherited signatures');
  });
  await run('ornaments, octave line, transpose, grace, lyrics, harmony and hairpins round trip', () => {
    const s = C.createScore({ measureCount: 1, tempo: 120 });
    const a = add(s, 0, F(0), { n: 1, d: 4 }, 60), b = add(s, 0, F(1, 4), { n: 1, d: 4 }, 64);
    Object.assign(C.findEvent(s, a).ev, { ornament: 'turn', trillLine: true, dynamic: 'p', chordSymbol: C.parseChordSymbol('Cm7'), lyric: 'hello', graceBefore: [{ id: C.newId(), kind: 'acciaccatura', dur: { n: 1, d: 8 }, notes: [C.spellMidi(59, 0)] }] });
    C.findEvent(s, b).ev.artics = ['fermata']; s.parts[0].transpose = { chromatic: -2, diatonic: -1 };
    s.spanners.push({ id: C.newId(), type: 'ottava', shift: 12, startId: a, endId: b }, { id: C.newId(), type: 'cresc', startId: a, endId: b }, { id: C.newId(), type: 'slur', startId: a, endId: b });
    const r = IO.parseMusicXML(IO.exportMusicXML(s)).score;
    equal(sequence(s), sequence(r), 'stored notes'); equal(sound(s), sound(r), 'sounding notes');
    check(r.spanners.length === 3, 'all spanners');
    const ev = r.measures[0].voices[0][0]; check(ev.ornament === 'turn' && ev.trillLine && ev.graceBefore.length && ev.chordSymbol, 'event decorations');
  });
  await run('drum and TAB declarations resolve; unsupported percussion MIDI is preserved', () => {
    const s = C.createScore({ measureCount: 1, parts: ['drumkit', 'guitar-tab'] });
    const id = add(s, 0, F(0), { n: 1, d: 4 }, 36, { partIdx: 0 }); Object.assign(C.findEvent(s, id).ev, { drumId: 'kick', midi: 36 });
    const xml = IO.exportMusicXML(s), doc = new DOMParser().parseFromString(xml, 'application/xml');
    const declared = new Set([...doc.querySelectorAll('score-instrument')].map(el => el.getAttribute('id')));
    for (const el of doc.querySelectorAll('note > instrument, midi-instrument')) check(declared.has(el.getAttribute('id')), 'instrument declaration');
    const r = IO.parseMusicXML(xml).score;
    check(r.parts[0].instrument === 'drums' && r.parts[1].staves[1].staffType === 'tab', 'staff types');
    equal(sequence(s), sequence(r), 'percussion sequence');
  });
  await run('timewise backup/forward, arbitrary voice labels and part/staff-specific directions', () => {
    const xml = '<score-timewise><part-list><score-part id="P1"><part-name>Keys</part-name></score-part><score-part id="P2"><part-name>Flute</part-name></score-part></part-list><measure number="1"><part id="P1"><attributes><divisions>12</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><dynamics><ff/></dynamics></direction-type><staff>2</staff></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>12</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><type>half</type><staff>2</staff></note></part><part id="P2"><attributes><divisions>12</divisions></attributes><forward><duration>12</duration></forward><note><pitch><step>D</step><octave>5</octave></pitch><duration>12</duration><type>quarter</type></note></part></measure></score-timewise>';
    const r = IO.parseMusicXML(xml).score, refs = C.staffRefs(r);
    check(refs.length === 3, 'staff count'); check(refs[1].measures[0].voices[0][0].dynamic === 'ff', 'staff-specific dynamic');
    check(refs[0].measures[0].voices[0][0].dynamic === undefined, 'dynamic does not leak');
    check(C.measureEntries(refs[2].measures[0], { score: r }).find(it => it.ev.type === 'note').tick.eq(F(1, 4)), 'forward cursor');
  });
  await run('repeat jump markers survive MusicXML', () => {
    const s = C.createScore({ measureCount: 4 });
    s.measures[0].marker = 'segno'; s.measures[1].marker = 'toCoda'; s.measures[2].marker = 'coda'; s.measures[3].jump = { type: 'DSalCoda', playRepeats: true };
    const r = IO.parseMusicXML(IO.exportMusicXML(s)).score;
    equal(P.buildPlaybackPlan(s).map(p => p.m), P.buildPlaybackPlan(r).map(p => p.m), 'jump sequence');
  });
  await run('MIDI file open awaits UI options and cancellation produces no callback', async () => {
    const file = new File([P.exportMidi(IO.DEMOS.star())], 'star.mid', { type: 'audio/midi' });
    let prompted = 0, loaded = 0;
    IO.requestMidiOptions = async parsed => { check(parsed.tracks.length > 1, 'parsed tracks'); prompted++; return { grid: 1 / 16, tracks: [1] }; };
    await IO.loadScoreFile(file, (score, _name, error) => { if (error) throw error; check(!!score.parts.length, 'import result'); loaded++; });
    check(prompted === 1 && loaded === 1, 'await options');
    IO.requestMidiOptions = async () => null; await IO.loadScoreFile(file, () => { loaded++; });
    check(loaded === 1, 'cancel'); IO.requestMidiOptions = null;
  });
  await run('polyphonic octave lines survive backup streams and preserve sounding pitches', () => {
    const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Polyphony</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><direction><direction-type><octave-shift type="down" size="8"/></direction-type></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note><direction><direction-type><octave-shift type="stop" size="8"/></direction-type></direction></measure></part></score-partwise>';
    const s = IO.parseMusicXML(xml).score;
    check(s.spanners.filter(sp => sp.type === 'ottava').length === 2, 'one span per voice');
    equal(P.compile(s).events.map(ev => ev.midis[0].midi), [72, 60, 62], 'sounding pitch values');
    equal(sound(IO.parseMusicXML(IO.exportMusicXML(s)).score), sound(s), 'second roundtrip');
  });
  await run('exact direction offsets and decorated full rests round trip', () => {
    const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Tempo</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><offset>2</offset></direction><note><rest measure="yes"/><duration>16</duration><notations><fermata/></notations></note></measure></part></score-partwise>';
    const s = IO.parseMusicXML(xml).score;
    const tempo = P.compile(s).tempoChanges.find(c => c.tempo === 120);
    check(tempo.abs.eq(F(1, 8)), 'tempo anchored inside rest at exact divisions');
    const full = C.createScore({ measureCount: 1 }); full.measures[0].voices[0][0].artics = ['fermata'];
    const imported = IO.parseMusicXML(IO.exportMusicXML(full)).score;
    check(imported.measures[0].voices[0][0].artics.includes('fermata'), 'full rest fermata');
  });
  await run('compressed MXL follows container.xml rootfile and decompresses raw deflate', async () => {
    const source = IO.DEMOS.rhythm(), encoder = new TextEncoder(), xml = IO.exportMusicXML(source), files = [
      ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="score/main.musicxml"/></rootfiles></container>'],
      ['score/main.musicxml', xml],
    ];
    const bytes = [], central = [], u16 = (a, n) => a.push(n & 255, (n >>> 8) & 255), u32 = (a, n) => a.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    const crc32 = data => { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
    for (const [path, content] of files) {
      const name = encoder.encode(path), raw = encoder.encode(content), compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()).slice(2, -4);
      const offset = bytes.length, crc = crc32(raw);
      u32(bytes, 0x04034b50); u16(bytes, 20); u16(bytes, 0); u16(bytes, 8); u16(bytes, 0); u16(bytes, 0); u32(bytes, crc); u32(bytes, compressed.length); u32(bytes, raw.length); u16(bytes, name.length); u16(bytes, 0); bytes.push(...name, ...compressed);
      u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 8); u16(central, 0); u16(central, 0); u32(central, crc); u32(central, compressed.length); u32(central, raw.length); u16(central, name.length); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0); u32(central, offset); central.push(...name);
    }
    const offset = bytes.length; bytes.push(...central); u32(bytes, 0x06054b50); u16(bytes, 0); u16(bytes, 0); u16(bytes, files.length); u16(bytes, files.length); u32(bytes, central.length); u32(bytes, offset); u16(bytes, 0);
    const extracted = await IO.readMxl(new Uint8Array(bytes).buffer);
    equal(sequence(IO.parseMusicXML(extracted).score), sequence(source), 'compressed MXL notes');
  });
  await run('JSON save marks the captured current revision saved after download is started', () => {
    C.setScore(C.createScore({ measureCount: 1 })); C.mutate('test edit', score => { score.meta.title = 'saved'; });
    const createElement = document.createElement.bind(document); let clicked = false;
    document.createElement = function (tag, ...args) { const el = createElement(tag, ...args); if (tag === 'a') el.click = () => { clicked = true; }; return el; };
    try { IO.saveJSON(C.state.score); check(clicked && !C.state.dirty, 'saved state'); }
    finally { document.createElement = createElement; }
  });
  window.__AUDIOIO_RESULT = { pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length, results };
  return window.__AUDIOIO_RESULT;
})();
