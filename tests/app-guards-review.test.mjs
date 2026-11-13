import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const coreSource = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(confirm = async () => false) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { style: {}, dataset: {}, listeners: new Map(), classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { this.listeners.set(type, fn); }, close() { this.open = false; } });
    return nodes.get(id);
  }
  const welcome = node('welcome-start'); welcome.dataset.start = 'blank';
  const document = { body: node('body'), querySelector: node, querySelectorAll: q => q === '#dlg-welcome [data-start]' ? [welcome] : [], addEventListener() {} };
  const scope = { window: {}, document, structuredClone, console, matchMedia: () => ({ matches: false }), setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, performance };
  vm.createContext(scope); vm.runInContext(coreSource, scope);
  const SF = scope.window.SF, C = SF.core;
  const calls = { confirm: 0, cancelledAutosaves: 0, resetHandles: 0, settings: 0 };
  SF.engrave = {};
  SF.playback = { player: {}, stop() {} };
  SF.io = { cancelPendingAutosave() { calls.cancelledAutosaves++; }, resetFileHandle() { calls.resetHandles++; } };
  SF.input = { create: api => ({ setInputMode: value => { api.ui.inputMode = value; }, toggleSpeedy: value => { api.ui.speedy = value; }, clearSpeedyHeld: () => api.ui.speedyHeld.clear() }) };
  SF.editing = { create: () => ({}) };
  SF.panels = { create: () => ({ openSettings() { calls.settings++; } }) };
  SF.keymap = { create: () => ({}) };
  SF.ui = { confirmDialog: async options => { calls.confirm++; return confirm(options); } };
  SF.cloud = { state: { dirty: false } };
  C.setScore(C.createScore({ title: 'current', measureCount: 1 }));
  vm.runInContext(appSource, scope);
  return { SF, C, calls, node, welcome };
}

test('cancelled file replacement preserves the score, readonly state and pending local work', async () => {
  const { SF, C, calls } = harness();
  C.mutate('edit', score => { score.meta.title = 'unsaved'; });
  const before = C.state.score, revision = C.state.revision;
  const accepted = await SF.app.handleLoadedScore(C.createScore({ title: 'replacement' }), 'replacement.json');
  assert.equal(accepted, false);
  assert.equal(C.state.score, before); assert.equal(C.state.revision, revision);
  assert.equal(C.state.dirty, true); assert.equal(C.state.readOnly, false);
  assert.equal(calls.cancelledAutosaves, 0); assert.equal(calls.resetHandles, 0); assert.equal(calls.confirm, 1);
});

test('awaiting replacement confirmation leaves the current editor intact, acceptance installs requested readonly state', async () => {
  const hold = deferred();
  const { SF, C, calls } = harness(() => hold.promise);
  C.mutate('edit', score => { score.meta.title = 'unsaved'; });
  const before = C.state.score;
  const pending = SF.app.handleLoadedScore(C.createScore({ title: 'shared' }), 'shared', null, [], { readOnly: true });
  await Promise.resolve();
  assert.equal(C.state.score, before); assert.equal(C.state.readOnly, false); assert.equal(calls.cancelledAutosaves, 0);
  hold.resolve(true); assert.equal(await pending, true);
  assert.equal(C.state.score.meta.title, 'shared'); assert.equal(C.state.readOnly, true); assert.equal(SF.app.ui.readOnly, true);
  assert.equal(calls.cancelledAutosaves, 1); assert.equal(calls.resetHandles, 1);
  const revision = C.state.revision;
  C.mutate('blocked', score => { score.meta.title = 'changed'; });
  assert.equal(C.state.revision, revision); assert.equal(C.state.score.meta.title, 'shared');
});

test('making a local file replacement from shared view restores editing without a spurious loss prompt', async () => {
  const { SF, C, calls } = harness();
  SF.app.setReadOnly(true);
  const accepted = await SF.app.handleLoadedScore(C.createScore({ title: 'local' }), 'local.json');
  assert.equal(accepted, true); assert.equal(calls.confirm, 0); assert.equal(C.state.readOnly, false);
  C.mutate('edit local', score => { score.meta.title = 'editable'; });
  assert.equal(C.state.score.meta.title, 'editable');
});

test('welcome blank action leaves a shared document in editable local mode', async () => {
  const { SF, C, welcome, calls } = harness();
  SF.app.setReadOnly(true);
  SF.app.actions.bindWelcome();
  await welcome.listeners.get('click')();
  assert.equal(C.state.readOnly, false); assert.equal(SF.app.ui.readOnly, false); assert.equal(calls.settings, 1);
});

function authHarness(hostname, allow = false) {
  const storage = new Map([['scoreforge.supabase.url', 'https://override.supabase.co'], ['scoreforge.supabase.publishableKey', 'sb_publishable_override']]);
  const scope = {
    window: { SF: { core: {} }, location: { hostname }, SF_ALLOW_CONNECTION_OVERRIDE: allow, SF_SUPABASE_CONFIG: { url: 'https://official.supabase.co', publishableKey: 'sb_publishable_official' } },
    localStorage: { getItem: key => storage.get(key) }, atob, URL,
    location: { href: 'https://scoreforge.example/app?share=AbC_123-xyZ9&code=secret#access_token=secret' },
  };
  vm.runInNewContext(authSource, scope);
  return scope.window.SF.auth;
}

test('production ignores stored Supabase endpoints and localhost overrides require an explicit flag', () => {
  for (const [host, allow, expected] of [['scoreforge.example', true, 'official'], ['localhost', false, 'official'], ['localhost', true, 'override']]) {
    const auth = authHarness(host, allow);
    assert.equal(auth.readSupabaseConfig().url, `https://${expected}.supabase.co`);
    assert.equal(auth.readSupabaseConfig().publishableKey, `sb_publishable_${expected}`);
  }
});

test('password-reset callback URLs omit shared score IDs and auth query/fragment values', () => {
  const auth = authHarness('scoreforge.example');
  assert.equal(auth.authRedirectURL(), 'https://scoreforge.example/app');
});

test('shared payload validation runs before model normalization can repair malformed staff data', async () => {
  const scope = { window: {}, structuredClone, TextEncoder, Uint8Array, console };
  vm.createContext(scope); vm.runInContext(coreSource, scope);
  const SF = scope.window.SF, C = SF.core;
  const malformed = JSON.parse(JSON.stringify(C.toJSON(C.createScore({ measureCount: 1 }))));
  malformed.parts[0].staves[0].measures = [];
  SF.auth = { getClient: () => ({ rpc: async () => ({ data: [{ title: 'bad shared score', data: malformed }] }) }) };
  SF.app = {};
  vm.runInContext(readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8'), scope);
  assert.throws(() => C.fromJSON(malformed), /마디 목록/);
  await assert.rejects(SF.cloud.loadShared('AbC_123-xyZ9'), /마디 목록/);
});
