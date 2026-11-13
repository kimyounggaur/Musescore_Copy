import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sources = Object.fromEntries(['core', 'input', 'keymap'].map(name => [name, readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8')]));

function inputHarness(options = {}) {
  const listeners = new Map();
  const input = { value: '', focus() {}, select() {}, blur() {} };
  const box = { style: {}, dataset: {}, querySelector: q => q === 'input' ? input : { textContent: '' } };
  const canvas = { classList: { add() {}, remove() {} }, focus() {} };
  const btn = { disabled: false };
  const select = { replaceChildren() {}, add() {}, innerHTML: '' };
  const nodes = { '#canvas': canvas, '#lyric-editor': box, '#paper-head': { offsetHeight: 0 }, '#btn-midi': btn, '#midi-select': select };
  const context = {
    window: {}, navigator: options.navigator || {}, structuredClone, performance, setTimeout, clearTimeout, console,
    document: { addEventListener: (name, fn) => listeners.set(name, fn), getElementById: () => null },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  };
  vm.createContext(context);
  vm.runInContext(sources.core, context);
  vm.runInContext(sources.input, context);
  const SF = context.window.SF, C = SF.core;
  C.setScore(C.createScore({ measureCount: 1, ensemble: options.ensemble || 'solo' }));
  const ui = { currentVoice: 1, inputMode: true, speedy: false, curDur: { n: 1, d: 4, dots: 0 }, speedyHeld: new Set(), lastPitch: { step: 0, alter: 0, oct: 4 }, lyricVerse: 1 };
  const selected = [];
  const api = {
    C, Fraction: SF.Fraction, ui, $: q => nodes[q] || {}, $$: () => [],
    E: { drawGhost() {}, getLayout: () => ({ eventsById: new Map(C.staffRefs(C.state.score).flatMap(ref => ref.measures.flatMap(m => m.events.map(ev => [ev.id, { x: 120, staff: { yTop: 0 } }])))) }) },
    P: { previewNote() {} }, update() {}, refreshCursor() {}, select: id => selected.push(id), selectedEvent() {}, selectedIds() {}, targetEvent() {}, canDot() {}, repitchSelection() {}, refreshToolbar() {}, updateStatus() {}, toast() {}, flashHint() {},
  };
  return { SF, C, ui, input, box, btn, selected, actions: SF.input.create(api) };
}

for (const speedy of [false, true]) test(`${speedy ? 'speedy' : 'normal'} entry appends final bars and preserves earlier notes`, () => {
  const h = inputHarness({ ensemble: 'piano' });
  const { C, ui, actions } = h;
  ui.speedy = speedy; ui.speedyStep = 28;
  for (let i = 0; i < 7; i++) {
    const pitch = { step: i % 7, alter: 0, oct: 4 };
    if (speedy) actions.doSpeedyInput(ui.curDur, { pitches: [pitch] });
    else { const p = actions.cursorPos(); actions.doInput(p.mIdx, p.tick, [pitch]); }
  }
  const notes = C.activeRef(C.state.score).measures.flatMap(m => m.events.filter(e => e.type === 'note'));
  assert.equal(notes.length, 7);
  assert.equal(notes.map(e => e.notes[0].step).join(','), '0,1,2,3,4,5,6');
  assert.ok(C.staffRefs(C.state.score).every(ref => ref.measures.length === 2));
  assert.equal(actions.cursorPos().mIdx, 1);
  assert.equal(actions.cursorPos().tick.toString(), '3/4');
});

test('drum entry continues into a new bar instead of replacing the final hit', () => {
  const { C, actions } = inputHarness({ ensemble: 'drumkit' });
  for (let i = 0; i < 5; i++) actions.inputDrum(i % 2 ? 'snare' : 'kick');
  const notes = C.activeRef(C.state.score).measures.flatMap(m => m.events.filter(e => e.type === 'note'));
  assert.equal(notes.length, 5);
  assert.equal(notes.map(e => e.drumId).join(','), 'kick,snare,kick,snare,kick');
  assert.equal(C.state.score.measures.length, 2);
});

test('a cross-bar input retains its whole duration and leaves a writable next onset', () => {
  const { C, ui, actions, SF } = inputHarness();
  ui.curDur = { n: 2, d: 1, dots: 0 };
  actions.doInput(0, SF.Fraction.ZERO, [{ step: 0, alter: 0, oct: 4 }]);
  assert.equal(C.state.score.measures.length, 3);
  const sum = C.state.score.measures.flatMap(m => m.events.filter(e => e.type === 'note')).reduce((n, e) => n.add(C.durValue(e.dur)), SF.Fraction.ZERO);
  assert.equal(sum.toString(), '2/1');
  assert.equal(actions.cursorPos().mIdx, 2);
});

for (const mode of ['lyric', 'chord']) test(`${mode} editor keeps IME composition on the current note until confirmed`, () => {
  const { C, SF, actions, input, box, selected } = inputHarness();
  const a = C.inputAt(C.state.score, 0, SF.Fraction.ZERO, { n: 1, d: 4 }, [{ step: 0, alter: 0, oct: 4 }]);
  const b = C.inputAt(C.state.score, 0, SF.F(1, 4), { n: 1, d: 4 }, [{ step: 1, alter: 0, oct: 4 }]);
  if (mode === 'lyric') actions.editLyric(a); else actions.editChordSymbol(a);
  input.value = mode === 'lyric' ? '나' : 'C';
  const key = (extra = {}) => ({ key: 'Enter', stopPropagation() {}, preventDefault() {}, ...extra });
  const revision = C.state.revision;
  input.oncompositionstart(); input.onkeydown(key());
  assert.equal(C.state.revision, revision); assert.equal(box.style.display, 'block'); assert.equal(selected.length, 0);
  input.oncompositionend(); input.onkeydown(key({ keyCode: 229 }));
  assert.equal(C.state.revision, revision); assert.equal(selected.length, 0);
  input.onkeydown(key({ isComposing: true }));
  assert.equal(C.state.revision, revision);
  input.onkeydown(key());
  assert.equal(selected[0], b);
  assert.equal(input.value, '');
  assert.equal(mode === 'lyric' ? C.lyricsOf(C.findEvent(C.state.score, a).ev)[0].text : C.findEvent(C.state.score, a).ev.chordSymbol.normalized, mode === 'lyric' ? '나' : 'C');
});

test('MIDI permission is explicit, non-sysex, and denial stays retryable', async () => {
  let requests = 0;
  const h = inputHarness({ navigator: { requestMIDIAccess: async opts => {
    requests++; assert.equal(opts.sysex, false);
    if (requests === 1) throw new Error('denied');
    return { inputs: new Map() };
  } } });
  h.actions.toggleSpeedy(true);
  assert.equal(requests, 0);
  assert.equal(await h.actions.initMidi(), false);
  assert.equal(h.btn.disabled, false);
  assert.equal(await h.actions.initMidi(), true);
  assert.equal(requests, 2);
  assert.equal(await h.actions.initMidi(), true);
  assert.equal(requests, 2);
});

function keymapHarness(platform = '') {
  const listeners = new Map();
  const document = { activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), querySelector: () => null };
  let plays = 0, inputs = 0, focused = 0;
  const notices = [], authModes = [];
  const canvas = { focus: () => { focused++; document.activeElement = canvas; } };
  const context = { window: { SF: {} }, document, navigator: { platform }, queueMicrotask, setTimeout, clearTimeout };
  vm.runInNewContext(sources.keymap, context);
  const SF = context.window.SF, K = SF.keymap;
  SF.auth = { openDialog: mode => authModes.push(mode) };
  const actions = K.create({ C: { isPercussionRef: () => false }, ui: {}, $: q => q === '#canvas' ? canvas : null, $$: () => [], P: {}, togglePlay: () => plays++, setInputMode: () => inputs++, toast: message => notices.push(message) });
  actions.bindKeys();
  return { SF, K, listeners, document, canvas, notices, authModes, counts: () => ({ plays, inputs, focused }) };
}

test('Korean physical letters work outside editors without hijacking text composition', () => {
  const h = keymapHarness();
  assert.equal(h.K.combo({ key: 'ㅜ', code: 'KeyN' }), 'N');
  assert.equal(h.K.combo({ key: 'ㄷ', code: 'KeyE', shiftKey: true }), 'Shift+E');
  const event = { key: 'ㅜ', code: 'KeyN', isComposing: true, target: { closest: () => null }, preventDefault() {} };
  h.listeners.get('keydown')(event);
  assert.equal(h.counts().inputs, 1);
  h.listeners.get('keydown')({ ...event, target: { closest: q => q.startsWith('input') ? {} : null } });
  assert.equal(h.counts().inputs, 1);
});

test('pointer toolbar actions restore score focus; keyboard button activation retains it', async () => {
  const h = keymapHarness();
  const button = { closest: () => ({}), matches: () => false };
  h.document.activeElement = button;
  h.listeners.get('click')({ detail: 1, target: { closest: () => button } });
  await Promise.resolve(); assert.equal(h.counts().focused, 1);
  h.listeners.get('keydown')({ key: ' ', code: 'Space', target: { closest: () => null }, preventDefault() {} });
  assert.equal(h.counts().plays, 1);
  h.document.activeElement = button;
  h.listeners.get('click')({ detail: 0, target: { closest: () => button } });
  await Promise.resolve(); assert.equal(h.counts().focused, 1); assert.equal(h.document.activeElement, button);
  h.listeners.get('keydown')({ key: ' ', code: 'Space', target: { closest: q => q === 'button' ? button : null }, preventDefault() {} });
  assert.equal(h.counts().plays, 1);
});

test('browser shortcuts are released and Mac help renders platform modifiers', () => {
  const { K } = keymapHarness('MacIntel');
  for (const key of ['F11', 'F12', 'Ctrl+L', 'Ctrl+F', 'Ctrl+G', 'Ctrl+2', 'Ctrl+9']) assert.ok(!K.KEYMAP.some(item => item.keys.includes(key)), key);
  assert.equal(K.KEYMAP.find(item => item.id === 'timeline').keys[0], 'Alt+T');
  assert.equal(K.formatShortcut('Ctrl+Alt+Shift+S'), '⌘+⌥+⇧+S');
  assert.equal(K.formatShortcut('Ctrl+S', false), 'Ctrl+S');
});


test('the authoritative cloud-save shortcut handles permission failures without unhandled rejections', async () => {
  const h = keymapHarness();
  const press = () => h.listeners.get('keydown')({ key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, target: { closest: () => null }, preventDefault() {}, stopImmediatePropagation() {} });
  h.SF.cloud = { saveCurrent: async () => { throw Object.assign(new Error('Sign in'), { code: 'AUTH_REQUIRED' }); } };
  press(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.authModes, ['member']);
  h.SF.cloud.saveCurrent = async () => { throw Object.assign(new Error('Read only'), { code: 'READ_ONLY' }); };
  press(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.notices, ['Read only']);
});
