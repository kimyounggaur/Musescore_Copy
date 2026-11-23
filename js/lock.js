/* js/lock.js — 같은 악보를 두 탭에서 동시에 고치지 못하게 하는 잠금(P2-D).
 * 악보를 열 때 Web Locks(이름 "scoreforge-doc:<docId>")를 잡고, 다른 악보로 바꾸거나 탭이 닫힐 때까지 쥔다(탭이 닫히면 브라우저가 풀어 준다).
 * Web Locks가 없는 브라우저는 BroadcastChannel("scoreforge")로 "이 악보 편집 중인 탭 있어요?"를 물어(200ms) 대신한다.
 * 같은 채널로 docs-changed(보관 목록이 바뀜)·doc-closed(잠금을 놓음)도 알린다.
 * 이 모듈은 화면을 모른다 — 상태·안내는 session.js와 lock-ui.js가 맡는다. */
"use strict";
(function (SF) {
  const PREFIX = "scoreforge-doc:";
  const CHANNEL = "scoreforge";
  const config = { pingWait: 200, watchInterval: 2500, settle: 800 };   // 대체 경로에서 응답을 기다리는 시간 · 읽기 전용 문서가 풀렸는지 확인하는 주기 · 풀린 채로 이만큼 지나야 "풀렸다"고 본다(ms). 테스트가 줄여 쓴다

  const tabId = (() => {
    try { if (window.crypto?.randomUUID) return window.crypto.randomUUID(); } catch { /* 아래 대체 */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  })();
  const uid = () => `${tabId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // 테스트에서 바꿔 끼울 수 있게, 부를 때마다 window에서 읽는다.
  function locksApi() {
    try { const api = window.navigator?.locks; return api && typeof api.request === "function" ? api : null; } catch { return null; }
  }

  /* ---------------- 채널 ---------------- */
  let channel;                                 // undefined=아직 안 만듦, null=쓸 수 없음
  const listeners = new Map();                 // type → Set<fn>
  function chan() {
    if (channel !== undefined) return channel;
    try {
      channel = typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel(CHANNEL) : null;
      if (channel) channel.onmessage = event => dispatch(event?.data);
    } catch { channel = null; }
    return channel;
  }
  function post(type, payload = {}) {
    const ch = chan();
    if (!ch) return false;
    try { ch.postMessage({ app: "scoreforge", v: 1, type, from: tabId, ...payload }); return true; } catch { return false; }
  }
  function dispatch(message) {
    if (!message || message.app !== "scoreforge" || message.from === tabId || typeof message.type !== "string") return;
    for (const fn of listeners.get(message.type) || []) { try { fn(message); } catch { /* 한 처리기의 오류가 다른 처리기를 막지 않게 */ } }
  }
  /** 다른 탭이 보낸 메시지를 받는다. 돌려주는 함수를 부르면 받기를 그만둔다. */
  function onMessage(type, fn) {
    chan();                                    // 받기만 하는 탭도 채널을 열어 둔다
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }
  const notify = (type, payload) => post(type, payload);

  /* ---------------- 이 탭이 쥔 잠금 ---------------- */
  const held = new Map();                      // docId → handle
  const trying = new Map();                    // 대체 경로: 아직 확정 전인 docId → 이 탭의 시도 번호(동시에 시도하면 작은 쪽이 이긴다)

  function makeHandle(docId, free) {
    const handle = {
      docId, released: false,
      release() {
        if (handle.released) return;
        handle.released = true;
        if (held.get(docId) === handle) held.delete(docId);
        try { free(); } catch { /* 이미 풀림 */ }
        post("doc-closed", { docId });
      },
    };
    held.set(docId, handle);
    return handle;
  }

  /** 대체 경로: 이 악보를 편집 중인 다른 탭이 있는지 묻는다(있으면 true). */
  function ping(docId) {
    return new Promise(resolve => {
      if (!chan()) { resolve(false); return; }
      const nonce = uid();
      let timer = null;
      const off = onMessage("pong", message => {
        if (message.nonce !== nonce || message.docId !== docId) return;
        clearTimeout(timer); off(); resolve(true);
      });
      timer = setTimeout(() => { off(); resolve(false); }, config.pingWait);
      post("ping", { docId, nonce, order: tabId });
    });
  }
  onMessage("ping", message => {
    const mine = held.has(message.docId) || (trying.has(message.docId) && trying.get(message.docId) < message.order);
    if (mine) post("pong", { docId: message.docId, nonce: message.nonce });
  });

  async function tryOnce(docId) {
    const locks = locksApi();
    if (locks) {
      return new Promise(resolve => {
        let request;
        try {
          request = locks.request(PREFIX + docId, { ifAvailable: true }, lock => {
            if (!lock) { resolve(null); return undefined; }        // 다른 탭이 편집 중
            return new Promise(free => resolve(makeHandle(docId, free)));   // release() 전까지 쥐고 있다
          });
        } catch { resolve(makeHandle(docId, () => {})); return; }  // 잠금 기능을 쓸 수 없는 환경(보안 제한 등)은 막지 않고 연다
        Promise.resolve(request).catch(() => resolve(makeHandle(docId, () => {})));
      });
    }
    if (chan()) {
      trying.set(docId, tabId);
      try { if (await ping(docId)) return null; } finally { trying.delete(docId); }
      return makeHandle(docId, () => {});
    }
    return makeHandle(docId, () => {});                            // 잠금도 채널도 없는 옛 브라우저: 보호 없이 연다
  }

  /** docId의 편집 잠금을 잡는다. 잡으면 { docId, release() }, 다른 탭이 편집 중이면 null.
   * 이 탭이 이미 쥐고 있으면 같은 handle을 돌려준다. retries: 새로고침 직후 옛 페이지의 잠금이 풀리길 잠깐 기다릴 때 쓴다. */
  async function acquire(docId, { retries = 0, delay = 150 } = {}) {
    if (typeof docId !== "string" || !docId) return null;
    const mine = held.get(docId);
    if (mine && !mine.released) return mine;
    for (let attempt = 0; ; attempt++) {
      const handle = await tryOnce(docId);
      if (handle || attempt >= retries) return handle;
      await sleep(delay);
    }
  }

  /** 다른 탭이 지금 편집 중인 문서 ID 모음. Web Locks가 있으면 한 번에 알고, 없으면 ids에 든 문서만 물어본다. */
  async function heldElsewhere(ids = []) {
    const out = new Set();
    const locks = locksApi();
    if (locks && typeof locks.query === "function") {
      try {
        const snapshot = await locks.query();
        for (const lock of snapshot?.held || []) if (typeof lock.name === "string" && lock.name.startsWith(PREFIX)) out.add(lock.name.slice(PREFIX.length));
      } catch { /* 조회 실패 — 표시만 못 한다 */ }
    } else if (chan()) {
      await Promise.all(ids.filter(id => !held.has(id)).map(async id => { if (await ping(id)) out.add(id); }));
    }
    for (const id of held.keys()) out.delete(id);                  // 이 탭이 쥔 문서는 "다른 탭"이 아니다
    return out;
  }

  /** 읽기 전용으로 열린 문서가 풀리길 지켜본다 — doc-closed 알림이 오거나 주기 확인에서 비어 있으면 onFree를 한 번 부른다. 돌려주는 함수로 그만둔다.
   * 알림은 상대 탭이 잠금을 놓기 직전·직후에 올 수 있어 받은 뒤 짧은 간격으로 몇 번 더 확인하고,
   * 새로고침처럼 놓았다가 곧바로 다시 잡는 경우에 헛되이 알리지 않도록 config.settle 동안 계속 비어 있어야 "풀렸다"고 본다. */
  function watch(docId, onFree, { interval = config.watchInterval } = {}) {
    let done = false, busy = false, freeSince = 0;
    const timers = new Set();
    const later = (delay, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, delay); timers.add(id); };
    const stop = () => { done = true; clearInterval(poll); for (const id of timers) clearTimeout(id); timers.clear(); off(); };
    const probe = async () => {
      if (done || busy) return;
      busy = true;
      try {
        if ((await heldElsewhere([docId])).has(docId)) { freeSince = 0; return; }   // 아직(또는 다시) 다른 탭이 쥐고 있다
        if (!freeSince) { freeSince = Date.now(); later(config.settle, probe); return; }
        if (Date.now() - freeSince >= config.settle && !done) { stop(); onFree(); }
      } finally { busy = false; }
    };
    const off = onMessage("doc-closed", message => {
      if (message.docId !== docId) return;
      probe();
      for (const delay of [150, 600]) later(delay, probe);
    });
    const poll = setInterval(probe, interval);
    poll?.unref?.();                           // Node(테스트)에서는 이 타이머가 프로세스 종료를 붙잡지 않게 한다(브라우저의 숫자 ID에는 영향 없음)
    return stop;
  }

  // 탭이 사라질 때 바로 알린다(브라우저는 잠금을 알아서 풀지만, 기다리는 탭이 몇 초 늦게 알지 않도록).
  try { window.addEventListener?.("pagehide", () => { for (const id of [...held.keys()]) post("doc-closed", { docId: id }); }); } catch { /* 테스트 환경 */ }

  SF.lock = {
    acquire, heldElsewhere, watch, notify, onMessage, tabId,
    heldIds: () => [...held.keys()],
    support: () => ({ locks: Boolean(locksApi()), channel: Boolean(chan()) }),
  };
  SF.lockTesting = { PREFIX, CHANNEL, config };
})(window.SF = window.SF || {});
