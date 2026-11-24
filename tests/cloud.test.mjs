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
      setReadOnly: value => { SF.app.ui.readOnly = value; },
      handleLoadedScore: async (value, name, err, report, opts = {}) => {
        // SF.session.guard 흉내: 편집 중이면 확인을 받아야 교체(기존 confirms 대기열 재사용)
        if (!opts.confirmed && !SF.app.ui.readOnly && C.state.dirty
            && !(await SF.ui.confirmDialog({ title: 'replace', message: opts.reason }))) return false;
        SF.app.setReadOnly(!!opts.readOnly); C.setScore(value); return true;
      } },
    ui: { confirmDialog: async opts => { prompts.push(opts); return confirms.shift() ?? false; },
      promptDialog: async opts => { prompts.push(opts); return answers.shift() ?? null; } },
  };
  if (options.schema) SF.schema = options.schema;   // P8-2: 실제 schema.js를 끼워 넣는 시험용(기본은 없음 — 다른 시험은 그대로)
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

// P2-A: 클라우드 열기·사본은 교체 통로(SF.app.handleLoadedScore → SF.session)에 이유와 읽기 전용 여부를 넘긴다.
test('클라우드 열기·로컬 사본은 교체 통로에 reason·readOnly·stale·confirmed를 넘긴다', async () => {
  const h = await harness(); h.seed(ID, { is_public: true, share_slug: 'AbC_123-xyZ9' });
  const calls = [], stub = h.SF.app.handleLoadedScore;
  h.SF.app.handleLoadedScore = (...args) => { calls.push(args[4]); return stub(...args); };
  await h.SF.cloud.openShared('AbC_123-xyZ9'); await h.SF.cloud.makeLocalCopy();
  assert.equal(calls[0].reason, '클라우드 악보 열기'); assert.equal(calls[0].readOnly, true); assert.equal(typeof calls[0].stale, 'function');
  assert.equal(calls[1].readOnly, false); assert.equal(calls[1].confirmed, true);
});

test('변경이 있을 때 클라우드 열기를 취소하면 악보·읽기 전용 상태가 그대로이고 null을 돌려준다', async () => {
  const h = await harness(); h.seed(ID); h.edit('지키려는 작업'); h.confirms.push(false);
  assert.equal(await h.SF.cloud.open(ID), null);
  assert.equal(h.C.state.score.meta.title, '지키려는 작업'); assert.equal(h.SF.app.ui.readOnly, false);
  assert.equal(h.prompts.at(-1).message, '클라우드 악보 열기');
});

test('확인을 기다리는 동안 더 새로운 열기가 시작되면 먼저 요청한 열기는 교체하지 않는다(stale)', async () => {
  const h = await harness(); h.seed(ID); h.seed('22222222-2222-4222-8222-222222222222', { title: '둘째 악보' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const stub = h.SF.app.handleLoadedScore, installed = [];
  h.SF.app.handleLoadedScore = async (value, name, err, report, opts) => {
    if (name === '저장된 악보') await gate;                                   // 첫 요청의 확인창이 떠 있는 상황
    if (opts.stale?.()) return false;
    installed.push(name); return stub(value, name, err, report, { ...opts, confirmed: true });
  };
  const first = h.SF.cloud.open(ID); await new Promise(r => setTimeout(r, 20));
  const second = h.SF.cloud.open('22222222-2222-4222-8222-222222222222');
  assert.equal((await second)?.meta.title, '둘째 악보'); release();
  assert.equal(await first, null); assert.deepEqual(installed, ['둘째 악보']);
});

// P7-B1: 저장 형식 v2에는 최상위 measures가 없다. 클라우드 행의 measures 칸(목록의 "N마디")은 첫 보표의 마디 수로 센다.
test('v2 모양 악보(최상위 measures 없음)를 클라우드에 저장해도 행의 measures 칸은 실제 마디 수', async () => {
  const h = await harness();
  const staff = { id: 's1', measures: [{ voices: [[{ id: 'e1', type: 'rest', dur: { n: 1, d: 1, dots: 0 }, notes: [] }]] }, { voices: [[]] }, { voices: [[]] }] };
  h.C.setScore({ meta: { title: 'v2 모양' }, schema: 2, parts: [{ id: 'p1', staves: [staff] }] });
  h.edit('v2 모양 저장');
  assert.equal('measures' in h.C.state.score, false, '준비한 악보에는 최상위 measures가 없다');
  const row = await h.SF.cloud.saveCurrent();
  assert.equal(h.db.rows.get(row.id).measures, 3);
});
test('옛 모양 악보(최상위 measures)의 마디 수 계산은 그대로', async () => {
  const h = await harness();
  h.C.setScore({ meta: { title: '옛 모양' }, measures: [{}, {}], parts: [] });
  h.edit('옛 모양 저장');
  const row = await h.SF.cloud.saveCurrent();
  assert.equal(h.db.rows.get(row.id).measures, 2);
});

// P8-2: 클라우드에서 열 때도 파일 열기와 같은 검사(SF.schema.validate)를 거친다 — 고칠 수 있는 값은 고쳐서 열고(결과 창 문구와 함께 넘김),
// 고칠 수 없으면 ScoreFormatError로 거절한다. 서버의 원본 행은 열기만으로 바뀌지 않는다.
const schemaSource = readFileSync(new URL('../js/schema.js', import.meta.url), 'utf8');
function realSchema() {
  const sandbox = { SF: {} }; sandbox.window = sandbox;
  vm.runInNewContext(schemaSource, sandbox, { filename: 'schema.js' });
  return sandbox.SF.schema;
}
const v2Data = (extra = {}) => ({ format: 'scoreforge-1', meta: { title: '저장된 악보' }, schema: 2,
  parts: [{ id: 'p1', staves: [{ id: 's1', measures: [{ voices: [[{ id: 'e1', type: 'rest', dur: { n: 1, d: 1, dots: 0 }, notes: [], full: true }]] }] }] }], ...extra });
const spyLoaded = h => { const calls = [], stub = h.SF.app.handleLoadedScore; h.SF.app.handleLoadedScore = (...args) => { calls.push(args); return stub(...args); }; return calls; };

test('P8-2 클라우드 열기: 값이 틀린 악보는 고쳐서 열고 고친 항목을 결과 창으로 넘긴다(원본 행은 그대로)', async () => {
  const h = await harness({ schema: realSchema() });
  h.seed(ID, { data: v2Data({ tempo: 5000 }) });
  const calls = spyLoaded(h);
  const opened = await h.SF.cloud.open(ID);
  assert.equal(opened.tempo, 999);
  assert.deepEqual([...calls[0][3]], ['템포를 10~999 범위로 맞췄어요 (1건)']);   // [...] — schema.js는 다른 vm 영역이라 배열 prototype이 다르다
  assert.equal(calls[0][4].reportKind, 'fixes');
  assert.equal(h.db.rows.get(ID).data.tempo, 5000, '서버 행은 열기만으로 바뀌지 않는다');
});

test('P8-2 클라우드 열기: 공유 링크로 연 악보도 같은 검사를 거친다(읽기 전용 + 고친 항목)', async () => {
  const h = await harness({ schema: realSchema() }); h.switchUser(null);
  h.seed(ID, { is_public: true, share_slug: 'AbC_123-xyZ9', data: v2Data({ tempo: 1 }) });
  const calls = spyLoaded(h);
  const opened = await h.SF.cloud.openShared('AbC_123-xyZ9');
  assert.equal(opened.tempo, 10);
  assert.deepEqual([...calls[0][3]], ['템포를 10~999 범위로 맞췄어요 (1건)']);
  assert.deepEqual([calls[0][4].reportKind, calls[0][4].readOnly], ['fixes', true]);
});

test('P8-2 클라우드 열기: 정상 악보는 고친 항목 없이 열린다(결과 창 문구를 넘기지 않음)', async () => {
  const h = await harness({ schema: realSchema() });
  h.seed(ID, { data: v2Data() });
  const calls = spyLoaded(h);
  await h.SF.cloud.open(ID);
  assert.deepEqual([...calls[0][3]], []);
  assert.equal('reportKind' in calls[0][4], false);
});

test('P8-2 클라우드 열기: 고칠 수 없는 악보는 ScoreFormatError로 거절하고 지금 악보는 그대로', async () => {
  const h = await harness({ schema: realSchema() });
  const bad = v2Data(); bad.parts[0].staves = 'x';
  h.seed(ID, { data: bad });
  const before = h.C.state.score, calls = spyLoaded(h);
  await assert.rejects(h.SF.cloud.open(ID), { name: 'ScoreFormatError', code: 'STAVES_NOT_ARRAY', path: 'parts[0].staves' });
  assert.equal(h.C.state.score, before); assert.equal(calls.length, 0);
});

/* ----- P8-3: 클라우드 저장 단축키(Ctrl+Shift+S)도 한글 입력 상태에서 먹는다 ----- */
const keymapSource = readFileSync(new URL('../js/keymap.js', import.meta.url), 'utf8');
function realKeymap() { const sf = {}; vm.runInNewContext(keymapSource, { window: { SF: sf } }, { filename: 'keymap.js' }); return sf.keymap; }
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
function press(h, event) {
  const seen = { prevented: 0, stopped: 0 };
  h.events.get('keydown')({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() { seen.prevented++; }, stopImmediatePropagation() { seen.stopped++; }, ...event });
  return seen;
}
const wroteToCloud = h => h.operations.some(op => op.op === 'insert' || op.op === 'update');

test('P8-3 저장 단축키: keymap이 있으면 라틴·한글 입력(Process·ㄴ)·Mac Cmd 모두 Ctrl+Shift+S로 저장한다', async () => {
  const events = [
    { ctrlKey: true, shiftKey: true, key: 'S', code: 'KeyS' },
    { ctrlKey: true, shiftKey: true, key: 's', code: 'KeyS' },
    { ctrlKey: true, shiftKey: true, key: 'Process', code: 'KeyS' },     // Windows·Chrome 한글 입력 상태
    { ctrlKey: true, shiftKey: true, key: 'ㄴ', code: 'KeyS' },           // Firefox·Safari 한글 입력 상태
    { metaKey: true, shiftKey: true, key: 'ㄴ', code: 'KeyS' },           // Mac: Cmd+Shift+S
    { ctrlKey: true, shiftKey: true, key: 'ы', code: 'KeyS' },            // 러시아어 자판
  ];
  for (const event of events) {
    const h = await harness(); h.SF.keymap = realKeymap(); h.edit('단축키로 저장');
    const seen = press(h, event); await flush();
    assert.equal(wroteToCloud(h), true, JSON.stringify(event));
    assert.deepEqual(seen, { prevented: 1, stopped: 1 }, '브라우저 기본 동작(페이지 저장)을 막고 다른 처리기로 넘기지 않는다');
  }
});

test('P8-3 저장 단축키: Shift가 없거나 Alt가 섞였거나 다른 글자면 저장하지 않고 이벤트도 건드리지 않는다', async () => {
  const events = [
    { ctrlKey: true, key: 's', code: 'KeyS' },                                   // Ctrl+S(저장 아님: 로컬 저장은 keymap이 처리)
    { ctrlKey: true, shiftKey: true, altKey: true, key: 'S', code: 'KeyS' },
    { ctrlKey: true, shiftKey: true, key: 'Process', code: 'KeyA' },
    { ctrlKey: true, shiftKey: true, key: 'ㅁ', code: 'KeyA' },
    { shiftKey: true, key: 'S', code: 'KeyS' },                                   // Ctrl 없이
    { ctrlKey: true, shiftKey: true, key: 'Unidentified', code: '' },
    { ctrlKey: true, shiftKey: true },                                            // key·code가 아예 없는 이벤트
  ];
  for (const event of events) {
    const h = await harness(); h.SF.keymap = realKeymap(); h.edit('저장되면 안 된다');
    const seen = press(h, event); await flush();
    assert.equal(wroteToCloud(h), false, JSON.stringify(event));
    assert.deepEqual(seen, { prevented: 0, stopped: 0 }, JSON.stringify(event));
  }
});

test('P8-3 저장 단축키: keymap이 없는 환경에서도 예전처럼 Ctrl+Shift+S로 저장하고, key가 없는 이벤트에도 던지지 않는다', async () => {
  for (const mod of [{ ctrlKey: true, key: 'S' }, { ctrlKey: true, key: 's' }, { metaKey: true, key: 's' }]) {
    const h = await harness(); assert.equal(h.SF.keymap, undefined); h.edit('keymap 없이 저장');
    const seen = press(h, { shiftKey: true, ...mod }); await flush();
    assert.equal(wroteToCloud(h), true, JSON.stringify(mod)); assert.deepEqual(seen, { prevented: 1, stopped: 1 });
  }
  const h = await harness(); h.edit('저장되면 안 된다');
  for (const event of [{ ctrlKey: true, shiftKey: true }, { ctrlKey: true, shiftKey: true, key: null }, { ctrlKey: true, key: 's' }, { ctrlKey: true, shiftKey: true, altKey: true, key: 's' }]) {
    assert.doesNotThrow(() => press(h, event), JSON.stringify(event));
  }
  await flush(); assert.equal(wroteToCloud(h), false);
});

// ───────── P8-4d 탈퇴 뒤처리: 이 브라우저에 남은 그 계정의 흔적만 지운다 ─────────
test('P8-4d purgeOwner: 탈퇴한 계정의 저장 대기 작업만 지우고 다른 계정의 것은 남긴다(네트워크 호출 없음)', async () => {
  const first = await harness({ online: false }); first.edit('탈퇴할 계정의 대기 작업');
  const [mine] = JSON.parse(first.storage.get('scoreforge.cloud.queue.v1'));
  assert.equal(mine.owner, OWNER);
  const theirs = { ...mine, key: '44444444-4444-4444-8444-444444444444', owner: OTHER, insertId: '55555555-5555-4555-8555-555555555555' };
  first.storage.set('scoreforge.cloud.queue.v1', JSON.stringify([mine, theirs]));
  const h = await harness({ online: false, storage: first.storage });
  const before = h.operations.length;
  assert.equal(h.SF.cloud.purgeOwner(OWNER), 1, '지운 작업 수');
  assert.deepEqual(JSON.parse(h.storage.get('scoreforge.cloud.queue.v1')).map(job => job.owner), [OTHER], '다른 계정의 대기 작업은 그대로');
  assert.equal(h.operations.length, before, '서버 호출(getUser·delete 포함) 없음');
  assert.equal(h.C.state.score.meta.title, '처음 악보', '지금 열린 악보 내용은 건드리지 않는다');
  assert.equal(h.SF.cloud.purgeOwner(OWNER), 0, '두 번 불러도 같은 결과(이미 없음)');
});

test('P8-4d purgeOwner: 열린 악보가 그 계정의 클라우드 악보면 클라우드 식별 정보만 떼고, 새 계정으로 저장하면 새 행을 만든다', async () => {
  const h = await harness(); h.seed(); await h.attach();
  assert.equal(h.C.state.score.meta.cloudOwner, OWNER);
  h.SF.cloud.purgeOwner(OWNER);
  const meta = h.C.state.score.meta;
  for (const key of ['cloudId', 'cloudUpdatedAt', 'cloudOwner', 'cloudProject']) assert.equal(key in meta, false, key);
  assert.equal(meta.title, '저장된 악보', '악보 내용·제목은 그대로');
  assert.equal(h.history.length, 0, '실행 취소 기록을 만들지 않는다');
  h.switchUser(OTHER);
  h.operations.length = 0;
  await h.SF.cloud.saveCurrent();
  const writes = h.operations.filter(op => op.op === 'insert' || op.op === 'update');
  assert.deepEqual(writes.map(op => op.op), ['insert'], '사라진 행을 고치려 하지 않고 새로 만든다');
  assert.equal(writes[0].payload.owner, OTHER);
  assert.equal([...h.db.rows.values()].filter(row => row.owner === OWNER).length, 1, '이전 계정 행은 이 시험의 가짜 DB에 그대로(서버 쪽 삭제는 이 함수의 일이 아니다)');
});

test('P8-4d purgeOwner: 공유로 연 다른 사람의 악보는 건드리지 않고, UUID가 아닌 값은 던지지 않고 0을 돌려준다', async () => {
  const h = await harness({ online: false }); h.edit('대기 작업');
  for (const bad of [undefined, null, '', 'abc', 42, {}, [], '33333333-3333-4333-8333-33333333333']) assert.equal(h.SF.cloud.purgeOwner(bad), 0, JSON.stringify(bad));
  assert.equal(JSON.parse(h.storage.get('scoreforge.cloud.queue.v1')).length, 1, '대기 작업은 그대로');
  h.C.state.score.meta.cloudOwner = OTHER; h.C.state.score.meta.cloudId = ID;
  h.SF.cloud.onScoreLoaded(h.C.state.score);
  h.SF.cloud.purgeOwner(OWNER);
  assert.equal(h.C.state.score.meta.cloudOwner, OTHER, '다른 계정의 악보 식별 정보는 그대로');
  assert.equal(h.C.state.score.meta.cloudId, ID);
});

test('P8-4d purgeOwner: 그 계정의 저장 대기 작업을 지우면 "저장 대기"도 끝나고, 엉뚱한 값(null·undefined)으로는 지금 저장 대기 표시를 건드리지 않는다', async () => {
  const h = await harness({ online: false }); h.edit('대기 작업');
  assert.equal(h.SF.cloud.state.dirty, true, '지우기 전에는 저장 대기');
  for (const bad of [null, undefined]) { h.SF.cloud.purgeOwner(bad); assert.equal(h.SF.cloud.state.dirty, true, `${bad} 로는 그대로`); }
  assert.equal(h.SF.cloud.purgeOwner(OWNER), 1);
  assert.equal(h.SF.cloud.state.dirty, false, '이 계정의 대기 작업이 사라졌으니 저장할 것도 없다');
  assert.equal(h.SF.cloud.state.status, '클라우드 저장 준비');
});

test('P8-4d purgeOwner: 목록에서 읽어 둔 그 계정의 행 버전도 비워서, 지운 계정의 행을 옛 버전으로 고치려 하지 않는다', async () => {
  const h = await harness(); h.seed();
  await h.SF.cloud.list();
  h.SF.cloud.purgeOwner(OWNER);
  await assert.rejects(h.SF.cloud.remove(ID), { code: 'CONFLICT' }, '옛 버전을 쓰지 않고 목록을 다시 불러오라고 한다');
  assert.equal(h.db.rows.has(ID), true, '가짜 DB의 행은 그대로(서버 쪽 삭제는 이 함수의 일이 아니다)');
});

// ───────── P8-5 저장 한도: 서버(트리거)가 거절한 저장을 알아듣게 보여 주고, 같은 요청을 되풀이하지 않는다 ─────────
// 서버는 악보 200개·합계 50MB를 넘는 저장을 SCOREFORGE_QUOTA_COUNT / SCOREFORGE_QUOTA_BYTES 오류로 거절한다(supabase/scoreforge_v4.sql).
const quotaError = (kind, extra = {}) => ({ code: 'P0001', message: `SCOREFORGE_QUOTA_${kind}`, details: null, hint: null, ...extra });
function failNext(h, op, error) { const hold = h.hold(op); hold.response = { data: null, error }; hold.resolve(); return hold; }
const queued = h => JSON.parse(h.storage.get('scoreforge.cloud.queue.v1'));
const insertsOf = h => h.operations.filter(op => op.op === 'insert').length;
const QUOTA_STATUS = '클라우드 저장 한도 도달 · 악보를 정리해 주세요';

test('P8-5 한도 초과: 서버의 SCOREFORGE_QUOTA_COUNT·BYTES를 QUOTA_EXCEEDED로 바꿔 던진다(쉬운 문구, 서버 코드는 원인으로만 남긴다)', async () => {
  for (const [kind, quota] of [['COUNT', 'count'], ['BYTES', 'bytes']]) {
    const h = await harness(); h.edit('한도 시험'); const raw = quotaError(kind);
    failNext(h, 'insert', raw);
    await assert.rejects(h.SF.cloud.saveCurrent(), err => {
      assert.equal(err.code, 'QUOTA_EXCEEDED', kind); assert.equal(err.quota, quota, kind);
      assert.match(err.message, /200개/); assert.match(err.message, /50MB/);
      assert.ok(!/SCOREFORGE|P0001/.test(err.message), '서버 내부 코드를 사용자 문구에 넣지 않는다');
      assert.equal(err.cause, raw, '원래 오류는 원인으로 남긴다');
      return true;
    });
    assert.equal(h.db.rows.size, 0, '거절된 저장은 아무것도 남기지 않는다');
  }
});

test('P8-5 한도 초과: 오류 문구가 message·details·hint 어디에 담겨 와도, 고치기(UPDATE) 저장에서도 같은 방식으로 바뀐다', async () => {
  for (const field of ['message', 'details', 'hint']) {
    const h = await harness(); h.seed(); await h.attach(); h.edit('용량 초과 수정');
    failNext(h, 'update', { code: 'P0001', message: '다른 문구', details: null, hint: null, [field]: 'raise: SCOREFORGE_QUOTA_BYTES (사용량 초과)' });
    await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'QUOTA_EXCEEDED', quota: 'bytes' }, field);
    assert.equal(h.db.rows.get(ID).title, '저장된 악보', '서버에 쓰이지 않았다');
  }
});

test('P8-5 한도 초과: 한도와 상관없는 서버 오류는 바꾸지 않고 같은 객체 그대로 던진다(비슷한 글자·소문자·빈 값 포함)', async () => {
  const others = [
    { code: '42501', message: 'new row violates row-level security policy for table "scores"', details: null, hint: null },
    { code: 'P0001', message: 'SCOREFORGE_QUOTA_OTHER', details: null, hint: null },
    { code: 'P0001', message: 'scoreforge_quota_count', details: null, hint: null },
    { code: 'P0001', message: 'QUOTA_COUNT', details: null, hint: null },
    { code: 'PGRST301', message: 'JWT expired', details: null, hint: null },
    { code: '57014', message: 'canceling statement due to statement timeout' },
    { message: '' },
    { code: 'X', message: 42, details: { SCOREFORGE_QUOTA_COUNT: true }, hint: ['SCOREFORGE_QUOTA_BYTES'] },
  ];
  for (const raw of others) {
    const h = await harness(); h.edit('다른 오류'); failNext(h, 'insert', raw);
    await assert.rejects(h.SF.cloud.saveCurrent(), err => err === raw, JSON.stringify(raw));
    assert.notEqual(queued(h)[0].blocked, true, `한도 오류가 아니면 멈추지 않는다: ${JSON.stringify(raw)}`);
  }
});

test('P8-5 한도 초과: 걸린 저장 작업은 멈춰 두어 자동 저장이 같은 요청을 되풀이하지 않고, 직접 저장만 같은 행 ID로 다시 시도해 성공한다', async () => {
  const h = await harness(); h.edit('한도에 걸린 악보'); failNext(h, 'insert', quotaError('COUNT'));
  await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'QUOTA_EXCEEDED' });
  const [job] = queued(h);
  assert.equal(job.blocked, true, '저장 대기열에 멈춤 표시');
  assert.equal(insertsOf(h), 1);
  await h.SF.cloud.drain(); await h.SF.cloud.drain();
  assert.equal(insertsOf(h), 1, '자동 재시도(drain)는 멈춘 작업을 건드리지 않는다');
  h.edit('한도에 걸린 채 더 고침');
  assert.equal(queued(h)[0].blocked, true, '고쳐도 멈춤 표시는 유지');
  for (const timer of [...h.timers.values()]) timer.fn();   // 10초 자동 저장 타이머가 돌아도
  await flush();
  assert.equal(insertsOf(h), 1, '타이머가 돌아도 같은 요청을 되풀이하지 않는다');
  // 안 쓰는 악보를 지워 자리가 생긴 뒤 직접 저장하면 한 번 더 시도한다(가짜 DB는 이제 받아 준다)
  const row = await h.SF.cloud.saveCurrent();
  assert.equal(insertsOf(h), 2); assert.equal(h.db.rows.size, 1);
  assert.equal(row.id, job.insertId, '같은 행 ID로 다시 보낸다(중복 행이 생기지 않는다)');
  assert.equal(h.db.rows.get(row.id).title, '한도에 걸린 채 더 고침', '그동안 고친 내용이 저장된다');
  assert.deepEqual(queued(h), [], '성공하면 대기열이 비워진다'); assert.equal(h.SF.cloud.state.dirty, false);
});

test('P8-5 한도 초과: Ctrl+Shift+S로 저장하다 걸리면 쉬운 문구를 알림으로 띄우고, 자동 저장 때는 알림 없이 상태 줄만 바뀐다', async () => {
  const h = await harness(); h.edit('단축키 저장'); failNext(h, 'insert', quotaError('COUNT'));
  press(h, { ctrlKey: true, shiftKey: true, key: 'S', code: 'KeyS' }); await flush();
  assert.equal(h.SF.cloud.state.status, QUOTA_STATUS);
  const toasts = h.notices.map(String);
  assert.ok(toasts.some(text => /200개·50MB/.test(text) && /지운 뒤 다시 저장/.test(text)), `알림에 쉬운 문구: ${toasts}`);
  assert.ok(!toasts.some(text => /SCOREFORGE|member/.test(text)), '서버 코드·로그인 창 없이');
  const auto = await harness(); auto.edit('자동 저장'); failNext(auto, 'insert', quotaError('BYTES'));
  const before = auto.notices.length;
  await auto.SF.cloud.drain();
  assert.equal(auto.SF.cloud.state.status, QUOTA_STATUS); assert.equal(auto.notices.length, before, '자동 저장은 알림창을 띄우지 않는다');
  assert.equal(queued(auto)[0].blocked, true);
});

test('P8-5 한도 초과: 충돌 처리에서 "다른 이름으로 저장"한 사본이 한도에 걸려도 같은 방식으로 멈추고, 원본은 그대로 둔다', async () => {
  const h = await harness(); h.seed(); await h.attach(); h.edit('충돌 뒤 사본');
  h.db.rows.get(ID).updated_at = '2026-02-01T00:00:00Z'; h.confirms.push(false); h.answers.push('한도 직전 사본');
  failNext(h, 'insert', quotaError('COUNT'));
  await assert.rejects(h.SF.cloud.saveCurrent(), { code: 'QUOTA_EXCEEDED', quota: 'count' });
  assert.equal(h.db.rows.size, 1, '사본은 만들어지지 않았다'); assert.equal(h.db.rows.get(ID).title, '저장된 악보', '원본 행은 그대로');
  assert.equal(queued(h)[0].blocked, true);
  assert.equal(h.C.state.score.meta.title, '한도 직전 사본', '로컬 악보에는 사본 이름이 남아 있다(내용은 잃지 않는다)');
});
