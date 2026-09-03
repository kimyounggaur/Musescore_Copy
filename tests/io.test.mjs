import test from 'node:test';
import assert from 'node:assert/strict';
import { SF } from './shim.mjs';
test('all demos export MusicXML, lyrics and MIDI', () => {
  for (const demo of Object.values(SF.io.DEMOS)) {
    const s = demo();
    const xml = SF.io.exportMusicXML(s);
    assert.ok(xml.includes('<score-partwise version="4.0">'));
    assert.equal((xml.match(/<measure number=/g) || []).length, s.measures.length);
    assert.ok(SF.playback.exportMidi(s).length > 40);
  }
  assert.ok(SF.io.exportMusicXML(SF.io.DEMOS.butterfly()).includes('<lyric number="1">'));
});
test('render and playback have complete event sequences', () => {
  for (const demo of Object.values(SF.io.DEMOS)) {
    const s = demo();
    const rendered = SF.engrave.render(s);
    assert.ok(rendered.svg.includes('<svg'));
    assert.ok(rendered.layout.eventsById.size > 0);
    const c = SF.playback.compile(s);
    assert.ok(c.events.length > 0);
    assert.ok(c.events.every((e, i) => !i || e.t >= c.events[i - 1].t));
  }
});
