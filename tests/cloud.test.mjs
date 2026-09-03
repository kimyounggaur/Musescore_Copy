import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function harness(options = {}) {
  const storage = options.storage || new Map();
  const listeners = new Set(), timers = new Map(), events = new Map(), operations = [], notices = [], prompts = [];
  const confirms = [], answers = [], history = [];
  let timerId = 0, stamp = 0, authError = null, authHold = null, hold = null, connected;
  const score = { format: 'scoreforge-1', meta: { title: '처음 악보' }, measures: [{}], parts: [] };
  const C = {
    state: { score, dirty: false }, toJSON: clone, fromJSON: clone,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    mutate: (label, fn) => { history.push(clone(C.state.score)); fn(C.state.score); C.state.dirty = true; emit('mutate'); },
    setScore: value => { C.state.score = clone(value); history.length = 0; emit('setScore'); },
    setCloudMetadata: meta => {
      for (const key of ['cloudId', 'cloudUpdatedAt', 'cloudOwner', 'cloudProject']) {
        if (meta[key] == null) delete C.state.score.meta[key]; else C.state.score.meta[key] = meta[key];
      }
    },
    undo: () => { C.state.score = history.pop(); emit('undo'); },
  };
  function emit(type) { for (const fn of listeners) fn(C.state.score, { type }); }
  const authState = { session: { user: { id: OWNER } } };
  const db = {
    supabaseUrl: 'https://example.supabase.co', rows: new Map(),
    auth: { getUser: async () => {
      operations.push({ op: 'getUser' });
      const user = authState.session?.user;
      if (authHold) { const current = authHold; authHold = null; current.started.resolve(); await current.promise; }
      return { data: { user }, error: authError };
    } },
    from(table) { assert.equal(table, 'scores'); return new Query(); },
    async rpc(name, args) {
      operations.push({ op: 'rpc', name, args: clone(args) });
      if (name === 'get_shared_score') {
        const row = [...db.rows.values()].find(r => r.is_public && r.share_slug === args.slug);
        return { data: row ? [{ title: row.title, data: clone(row.data) }] : [], error: null };
      }
      assert.equal(name, 'count_scoreforge_scores_by_owner');
      const counts = new Map();
      for (const row of db.rows.values()) if (args.owner_ids.includes(row.owner)) counts.set(row.owner, (counts.get(row.owner) || 0) + 1);
      return { data: [...counts].map(([owner, score_count]) => ({ owner, score_count })), error: null };
    },
  };
  connected = db;
  class Query {
    constructor() { this.op = 'select'; this.filters = []; this.columns = '*'; }
    select(columns) { this.columns = columns; return this; }
    insert(data) { this.op = 'insert'; this.payload = clone(data); return this; }
    update(data) { this.op = 'update'; this.payload = clone(data); return this; }
    delete() { this.op = 'delete'; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    order() { return this; }
    range(from, to) { this.slice = [from, to + 1]; return this; }
    single() { this.one = true; return this.run(); }
    maybeSingle() { this.one = true; return this.run(); }
    then(ok, fail) { return this.run().then(ok, fail); }
    async run() {
      operations.push({ op: this.op, filters: clone(this.filters), payload: this.payload, columns: this.columns });
      if (hold && hold.op === this.op) {
        const current = hold; hold = null; current.started.resolve(); await current.promise;
        if (current.response) return current.response;
      }
      let found = [...db.rows.values()].filter(row => this.filters.every(([key, value]) => row[key] === value));
      const date = () => new Date(1700000000000 + ++stamp * 1000).toISOString();
      if (this.op === 'insert') {
        if (db.rows.has(this.payload.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const row = { is_public: false, share_slug: null, created_at: date(), updated_at: date(), ...this.payload };
        db.rows.set(row.id, row); found = [row];
      } else if (this.op === 'update') {
        for (const row of found) Object.assign(row, this.payload, { updated_at: date() });
      } else if (this.op === 'delete') {
        for (const row of found) db.rows.delete(row.id);
      }
      if (this.slice) found = found.slice(...this.slice);
      const project = row => this.columns === '*' ? clone(row) : Object.fromEntries(this.columns.split(',').map(key => [key, clone(row[key] ?? null)]));
      return { data: this.one ? (found[0] ? project(found[0]) : null) : found.map(project), error: null };
    }
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.value = ''; this.classList = { remove() {}, add() {} }; this.hidden = false; this.open = false; }
    set textContent(value) { this.text = value; }
    get textContent() { return this.text || ''; }
    set innerHTML(value) { throw new Error(`Unsafe innerHTML: ${value}`); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener() {}
    setAttribute() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
    select() {}
  }
  const menu = new Element('div'), footer = new Element('footer'), body = new Element('body');
  const document = { body, createElement: tag => new Element(tag),
    querySelector: selector => selector === '#file-menu' ? menu : selector === '.statusbar' ? footer : null,
    addEventListener: (type, fn) => events.set(type, fn) };
  const SF = {
    core: C, auth: { state: authState, getClient: () => connected, openDialog: mode => notices.push(mode) },
    io: { autosave: () => {} },
    app: { ui: { readOnly: false }, update() {}, toast: value => notices.push(value),
      setReadOnly: value => { SF.app.ui.readOnly = value; }, handleLoadedScore: value => C.setScore(value) },
    ui: { confirmDialog: async opts => { prompts.push(opts); return confirms.shift() ?? false; },
      promptDialog: async opts => { prompts.push(opts); return answers.shift() ?? null; } },
  };
  const scope = { SF, document, console, URL, TextEncoder, Uint8Array, crypto: webcrypto,
    navigator: { onLine: options.online !== false }, location: { href: 'https://scoreforge.example/app?code=secret#access_token=secret' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    history: { replaceState: (state, title, url) => { scope.location.href = url; } },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    addEventListener: (type, fn) => events.set(type, fn),
  };
  scope.window = scope;
  vm.runInNewContext(source, scope, { filename: 'cloud.js' });
  await SF.cloud.init();
  function seed(id = ID, extra = {}) {
    const row = { id, owner: OWNER, title: '저장된 악보', data: clone(score), measures: 1,
      is_public: false, share_slug: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', ...extra };
    db.rows.set(id, row); return row;
  }
  async function attach(id = ID) { C.setScore(await SF.cloud.load(id)); SF.cloud.onScoreLoaded(C.state.score); }
  return { SF, C, db, operations, notices, prompts, confirms, answers, scope, timers, storage, history, menu, footer, events, seed, attach,
    edit: title => C.mutate('title', s => { s.meta.title = title; }),
    switchUser: id => { authState.session = id ? { user: { id } } : null; },
    expire: () => { authError = { code: 'session_not_found', message: 'Session expired' }; },
    disconnect: () => { connected = null; }, emit,
    hold: op => { const d = deferred(); hold = { ...d, op, started: deferred() }; return hold; },
    holdAuth: () => { const d = deferred(); authHold = { ...d, started: deferred() }; return authHold; },
  };
}

test('save verifies user; INSERT records actual owner and metadata without undo entries', async () => {
  const h = await harness(); h.edit('첫 클라우드 저장'); const undo = h.history.length;
  const row = await h.SF.cloud.saveCurrent();
  assert.equal(row.owner, OWNER); assert.equal(h.C.state.score.meta.cloudId, row.id);
  assert.equal(h.history.length, undo); assert.equal(h.SF.cloud.state.dirty, false);
  assert.equal(h.operations[0].op, 'getUser');
  assert.equal(h.db.rows.get(row.id).data.meta.cloudId, undefined);
});

test('ordinary update has atomic owner + id + original updated_at filters and no preflight SELECT', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.operations.length = 0; h.edit('로컬 수정');
  await h.SF.cloud.saveCurrent();
  assert.deepEqual(h.operations.map(op => op.op), ['getUser', 'update']);
  assert.deepEqual(h.operations[1].filters, [['id', ID], ['owner', OWNER], ['updated_at', '2026-01-02T00:00:00Z']]);
});

test('remote conflict offers overwrite and does not silently replace the remote score', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.edit('로컬 수정');
  h.db.rows.get(ID).updated_at = '2026-02-01T00:00:00Z'; h.confirms.push(false); h.answers.push(null);
  await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'CANCELLED' });
  assert.equal(h.db.rows.get(ID).title, '저장된 악보'); assert.equal(h.C.state.score.meta.title, '로컬 수정');
  assert.equal(h.prompts[0].confirmText, '덮어쓰기'); assert.equal(h.prompts[0].cancelText, '다른 이름으로 저장');
  assert.equal(h.SF.cloud.state.dirty, true);
});

test('explicit conflict overwrite is the only save UPDATE allowed without a timestamp filter', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.edit('덮어쓴 내용');
  h.db.rows.get(ID).updated_at = '2026-02-01T00:00:00Z'; h.confirms.push(true);
  await h.SF.cloud.saveCurrent();
  const writes = h.operations.filter(op => op.op === 'update');
  assert.equal(writes.length, 2); assert.ok(writes[0].filters.some(([key]) => key === 'updated_at'));
  assert.ok(!writes[1].filters.some(([key]) => key === 'updated_at')); assert.equal(h.db.rows.get(ID).title, '덮어쓴 내용');
});

test('save-copy conflict creates a private new row and retains original remote content', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.edit('수정');
  h.db.rows.get(ID).updated_at = '2026-02-01T00:00:00Z'; h.confirms.push(false); h.answers.push('별도 사본');
  const row = await h.SF.cloud.saveCurrent();
  assert.notEqual(row.id, ID); assert.equal(row.is_public, false); assert.equal(row.title, '별도 사본');
  assert.equal(h.db.rows.get(ID).title, '저장된 악보'); assert.equal(h.C.state.score.meta.cloudId, row.id);
});

test('edits during an INSERT response stay dirty and next UPDATE uses returned timestamp', async () => {
  const h = await harness(); h.edit('첫 내용'); const hold = h.hold('insert'); const saving = h.SF.cloud.saveCurrent();
  await hold.started.promise; h.edit('더 최신 내용'); hold.resolve();
  const first = await saving;
  assert.equal(h.C.state.score.meta.title, '더 최신 내용'); assert.equal(h.SF.cloud.state.dirty, true);
  assert.ok(!h.SF.cloud.state.status.startsWith('클라우드 저장됨'));
  await h.SF.cloud.drain();
  const update = h.operations.find(op => op.op === 'update');
  assert.ok(update.filters.some(([key, value]) => key === 'updated_at' && value === first.updated_at));
  assert.equal(h.db.rows.size, 1); assert.equal(h.db.rows.get(first.id).title, '더 최신 내용');
  assert.equal(h.SF.cloud.state.dirty, false);
});

test('10-second debounce coalesces edits, offline queue drains latest only on reconnect', async () => {
  const h = await harness({ online: false });
  h.edit('하나'); h.edit('둘'); h.edit('마지막');
  assert.equal(h.SF.cloud.state.autoSave, true);
  assert.equal([...h.timers.values()].filter(t => t.ms === 10000).length, 1);
  assert.equal(h.operations.length, 0);
  assert.equal(JSON.parse(h.storage.get('scoreforge.cloud.queue.v1'))[0].data.meta.title, '마지막');
  h.scope.navigator.onLine = true; await h.events.get('online')();
  assert.equal(h.db.rows.size, 1); assert.equal([...h.db.rows.values()][0].title, '마지막');
});

test('expired session and anonymous sign-in never write privately', async () => {
  const h = await harness(); h.expire();
  await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'session_not_found' });
  assert.ok(!h.operations.some(op => op.op === 'insert'));
  const anon = await harness(); anon.SF.auth.state.session.user.is_anonymous = true;
  await assert.rejects(anon.SF.cloud.list(), { code: 'AUTH_REQUIRED' });
});

test('identity change during getUser cannot invent owner or send a write', async () => {
  const h = await harness(); const hold = h.holdAuth(); const saving = h.SF.cloud.saveCurrent();
  await hold.started.promise; h.switchUser(OTHER); hold.resolve();
  await assert.rejects(saving, { code: 'SESSION_CHANGED' });
  assert.equal(h.db.rows.size, 0);
});

test('identity change during a response leaves new account/editor metadata untouched', async () => {
  const h = await harness(); h.edit('계정 A 내용'); const hold = h.hold('insert'); const saving = h.SF.cloud.saveCurrent();
  await hold.started.promise; h.switchUser(OTHER); hold.resolve();
  await assert.rejects(saving, { code: 'SESSION_CHANGED' });
  assert.equal(h.C.state.score.meta.cloudId, undefined); assert.equal(h.SF.cloud.state.dirty, true);
  const calls = h.operations.length; await h.SF.cloud.drain(); assert.equal(h.operations.length, calls);
});

test('offline queues persist but do not drain as a different user', async () => {
  const h = await harness({ online: false }); h.edit('비공개'); h.switchUser(OTHER);
  h.scope.navigator.onLine = true; await h.SF.cloud.drain(); assert.equal(h.db.rows.size, 0);
  h.switchUser(OWNER); await h.SF.cloud.drain(); assert.equal(h.db.rows.size, 1);
});

test('durable queue reload retains only the latest snapshot and same insert UUID', async () => {
  const first = await harness({ online: false }); first.edit('이전'); first.edit('복구할 최신 내용');
  const stored = JSON.parse(first.storage.get('scoreforge.cloud.queue.v1'))[0];
  const second = await harness({ storage: first.storage });
  assert.equal(second.db.rows.size, 1); assert.equal(second.db.rows.get(stored.insertId).title, '복구할 최신 내용');
  assert.equal(JSON.parse(second.storage.get('scoreforge.cloud.queue.v1')).length, 0);
});

test('lost INSERT acknowledgement recovers the same UUID without a duplicate score', async () => {
  const h = await harness({ online: false }); h.edit('같은 내용');
  const job = JSON.parse(h.storage.get('scoreforge.cloud.queue.v1'))[0];
  h.seed(job.insertId, { title: '같은 내용', data: { parts: [], measures: [{}], meta: { title: '같은 내용' }, format: 'scoreforge-1' } });
  h.scope.navigator.onLine = true; await h.SF.cloud.drain();
  assert.equal(h.db.rows.size, 1); assert.equal(h.C.state.score.meta.cloudId, job.insertId);
  assert.equal(h.SF.cloud.state.dirty, false);
});

test('auto-save toggle off stops creating new cloud jobs', async () => {
  const h = await harness(); h.SF.cloud.setAutoSave(false); h.edit('로컬만');
  await h.SF.cloud.drain(); assert.equal(h.operations.length, 0);
  assert.equal(h.storage.get('scoreforge.cloud.auto.v1'), 'false');
  h.SF.cloud.setAutoSave(true); await h.SF.cloud.drain(); assert.equal(h.db.rows.size, 1);
});

test('metadata survives undo without undo restoring stale cloud ID/timestamp', async () => {
  const h = await harness(); h.edit('변경'); const row = await h.SF.cloud.saveCurrent();
  h.C.undo(); assert.equal(h.C.state.score.meta.cloudId, row.id); assert.equal(h.C.state.score.meta.cloudUpdatedAt, row.updated_at);
  await h.SF.cloud.drain(); assert.equal(h.db.rows.size, 1);
});

test('a response for a previously open document never attaches to a newly opened score', async () => {
  const h = await harness(); h.edit('이전 악보'); const hold = h.hold('insert'); const saving = h.SF.cloud.saveCurrent();
  await hold.started.promise;
  h.C.setScore({ meta: { title: '새 악보' }, measures: [], parts: [] }); hold.resolve(); await saving;
  assert.equal(h.C.state.score.meta.title, '새 악보'); assert.equal(h.C.state.score.meta.cloudId, undefined);
});

test('get_shared_score is the only anonymous read; malformed slugs never reach RPC', async () => {
  const h = await harness(); h.switchUser(null);
  for (const slug of ['', '%', 'abc', '../scores', 'a'.repeat(13), 'a'.repeat(12) + '\n', '<img src=x>', 'abc%2F1234567']) {
    await assert.rejects(h.SF.cloud.loadShared(slug), { code: 'INVALID_SLUG' });
  }
  assert.equal(h.operations.length, 0);
  h.seed(ID, { is_public: true, share_slug: 'AbC_123-xyZ9', data: { meta: { title: 'x', cloudId: ID, cloudOwner: OTHER }, measures: [] } });
  const loaded = await h.SF.cloud.loadShared('AbC_123-xyZ9');
  assert.equal(loaded.meta.cloudId, undefined); assert.equal(loaded.meta.cloudOwner, undefined);
  assert.deepEqual(h.operations.map(op => op.op), ['rpc']);
});

test('sharing uses a 12-character cryptographic capability and strips auth URL secrets', async () => {
  const h = await harness(); h.seed(); await h.attach();
  const url = new URL(await h.SF.cloud.setPublic(ID, true));
  const slug = url.searchParams.get('share'); assert.match(slug, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(url.searchParams.size, 1); assert.equal(url.hash, ''); assert.ok(!url.href.includes('secret'));
  await h.SF.cloud.setPublic(ID, false); assert.equal(h.db.rows.get(ID).share_slug, null);
  const again = new URL(await h.SF.cloud.setPublic(ID, true)); assert.notEqual(again.searchParams.get('share'), slug);
});

test('failed/private and malformed/shared loads preserve the current unsaved score', async () => {
  const h = await harness(); h.edit('잃으면 안 되는 악보'); const before = clone(h.C.state.score);
  await assert.rejects(h.SF.cloud.open(ID), { code: 'NOT_FOUND' }); assert.deepEqual(h.C.state.score, before);
  h.seed(ID, { is_public: true, share_slug: 'AbC_123-xyZ9', data: { unexpected: true } });
  await assert.rejects(h.SF.cloud.openShared('AbC_123-xyZ9'), { code: 'INVALID_SCORE' });
  assert.deepEqual(h.C.state.score, before); assert.equal(h.SF.app.ui.readOnly, false);
});

test('shared open becomes read-only; local copy strips identity and removes share URL', async () => {
  const h = await harness(); h.seed(ID, { is_public: true, share_slug: 'AbC_123-xyZ9' });
  await h.SF.cloud.openShared('AbC_123-xyZ9'); assert.equal(h.SF.app.ui.readOnly, true);
  await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'READ_ONLY' });
  await h.SF.cloud.makeLocalCopy(); assert.equal(h.SF.app.ui.readOnly, false);
  assert.equal(h.C.state.score.meta.cloudId, undefined); assert.match(h.C.state.score.meta.title, /사본$/);
});

test('shared content identical to a queued local draft cannot inherit its cloud identity', async () => {
  const h = await harness({ online: false }); h.edit('같은 제목');
  h.seed(ID, { title: '같은 제목', data: clone(h.C.state.score), is_public: true, share_slug: 'AbC_123-xyZ9' });
  h.confirms.push(true); await h.SF.cloud.openShared('AbC_123-xyZ9');
  h.scope.navigator.onLine = true; await h.SF.cloud.drain();
  assert.equal(h.C.state.score.meta.cloudId, undefined); assert.equal(h.SF.app.ui.readOnly, true);
  assert.match(h.SF.cloud.state.status, /읽기 전용/);
});

test('list observation of a newer remote version does not erase the edit conflict', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.edit('로컬 변경');
  h.db.rows.get(ID).updated_at = '2026-02-01T00:00:00Z'; await h.SF.cloud.list();
  await assert.rejects(h.SF.cloud.saveCurrent({ interactive: false }), { code: 'CONFLICT' });
});

test('metadata change from refreshed list cannot acknowledge unseen remote score edits', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.edit('로컬 변경');
  h.db.rows.get(ID).updated_at = '2026-02-01T00:00:00Z'; const [row] = await h.SF.cloud.list();
  await h.SF.cloud.setPublic(ID, true, row.updated_at);
  await assert.rejects(h.SF.cloud.saveCurrent({ interactive: false }), { code: 'CONFLICT' });
});

test('count RPC returns exact owner mapping, and local-save events do not trigger cloud saves', async () => {
  const h = await harness(); h.seed(); const counts = await h.SF.cloud.countByOwner([OWNER, OTHER]);
  assert.equal(counts[OWNER], 1); assert.equal(counts[OTHER], 0);
  h.emit('saved'); h.emit('autosaved'); assert.equal(h.SF.cloud.state.dirty, false);
  assert.ok(![...h.timers.values()].some(t => t.ms === 10000));
});

test('two-megabyte payload is rejected before reaching Supabase', async () => {
  const h = await harness(); h.SF.cloud.setAutoSave(false); h.edit('x'.repeat(2000000));
  await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'TOO_LARGE' }); assert.equal(h.operations.length, 0);
});

test('cloud DOM uses safe text and creates file actions without inline onclick', async () => {
  const h = await harness(); h.seed(ID, { title: '<img src=x onerror=alert(1)>' }); await h.SF.cloud.openList();
  const group = h.menu.children.find(child => child.id === 'cloud-menu');
  assert.ok(group); assert.ok(group.children.some(child => child.dataset.action === 'cloud-save'));
  assert.equal(/\.innerHTML\s*=|onclick\s*=/.test(source), false);
});
