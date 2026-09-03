"use strict";
(async () => {
  const lines = []; let pass = 0, fail = 0;
  const signature = score => SF.core.staffRefs(score).map(ref => ref.measures.map(mm => SF.core.measureEntries(mm, {score}).filter(x => x.ev.type === 'note').map(x => [x.voice, x.ev.notes.map(SF.core.midiOf), SF.core.durValue(x.ev.dur).toString()])));
  for (const [name, demo] of Object.entries(SF.io.DEMOS)) {
    try {
      const s = demo();
      const r = SF.engrave.render(s);
      if (!r.layout.eventsById.size || !r.svg.includes('<svg')) throw new Error('render empty');
      const imported = SF.io.parseMusicXML(SF.io.exportMusicXML(s));
      if (JSON.stringify(signature(s)) !== JSON.stringify(signature(imported.score))) throw new Error('MusicXML mismatch');
      const c = SF.playback.compile(s);
      if (!c.events.length || !c.events.every((e, i) => !i || e.t >= c.events[i - 1].t)) throw new Error('playback order');
      lines.push(`PASS ${name}`); pass++;
    } catch (e) { lines.push(`FAIL ${name}: ${e.message}`); fail++; }
  }
  document.querySelector('#results').textContent = lines.join('\n');
  window.__TEST_RESULT = { pass, fail };
})();
