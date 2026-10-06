// Test double for the claude.ai artifact `room` capability (presence + named rooms), shared between tabs of one
// origin with BroadcastChannel. Adds one-way latency and enforces the 4 KiB presence cap and ~30 Hz coalescing.
(() => {
  const LAT = Number(new URLSearchParams(location.search).get('mocklat') ?? 60);
  const me = Math.random().toString(36).slice(2, 12);
  const bc = new BroadcastChannel('mock-claude-room');
  const rooms = new Map();
  const stats = (window.__mockRoomStats = { presenceSent: 0, maxBytes: 0, rejected: 0 });
  bc.onmessage = (e) => { const m = e.data; setTimeout(() => rooms.get(m.room)?.handle(m), LAT + Math.random() * LAT * 0.25); };
  function makeRoom(name) {
    const peers = new Map([[me, { presence: {}, updatedAt: Date.now() }]]);
    const listeners = new Set();
    let mine = {}; let notifyQueued = false; let lastSent = 0; let sendTimer = 0; let closed = false;
    const snap = () => [...peers].map(([peer, v]) => Object.freeze({ peer, by: null, isMe: peer === me, sameTab: peer === me, kind: 'viewer', guest: false, presence: v.presence, updatedAt: v.updatedAt }));
    const notify = () => { if (notifyQueued) return; notifyQueued = true; setTimeout(() => { notifyQueued = false; const ps = snap(); for (const l of listeners) l({ peers: ps, joined: [], left: [], updated: [] }); }, 16); };
    const post = (type, extra = {}) => bc.postMessage({ room: name, peer: me, type, ...extra });
    const flush = () => { sendTimer = 0; lastSent = performance.now(); stats.presenceSent++; post('presence', { presence: mine }); };
    const room = {
      name,
      handle(m) {
        if (closed || m.peer === me) return;
        if (m.type === 'hello') { post('presence', { presence: mine }); return; }
        if (m.type === 'presence') { peers.set(m.peer, { presence: Object.freeze(m.presence), updatedAt: Date.now() }); notify(); }
        if (m.type === 'leave') { peers.delete(m.peer); notify(); }
      },
      presence(patch) {
        const next = { ...mine };
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
        const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
        stats.maxBytes = Math.max(stats.maxBytes, bytes);
        if (bytes > 4096) { stats.rejected++; return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB' }); }
        mine = next;
        peers.set(me, { presence: Object.freeze({ ...mine }), updatedAt: Date.now() });
        notify();
        if (!sendTimer) sendTimer = setTimeout(flush, Math.max(0, 33 - (performance.now() - lastSent)));
        return Promise.resolve();
      },
      emit() { return Promise.resolve(); },
      on() { return () => {}; },
      peers: () => snap(),
      onPeers(fn) { listeners.add(fn); notify(); return () => listeners.delete(fn); },
      connected: () => true,
      onConnection(fn) { setTimeout(() => fn(true), 0); return () => {}; },
      join(n) { return Promise.resolve(getRoom(n)); },
      leave() { closed = true; post('leave'); rooms.delete(name); return Promise.resolve(); },
    };
    rooms.set(name, room);
    post('hello');
    return room;
  }
  const getRoom = (n) => rooms.get(n) ?? makeRoom(n);
  addEventListener('pagehide', () => { for (const r of rooms.values()) bc.postMessage({ room: r.name, peer: me, type: 'leave' }); });
  window.claude = { use: async (name) => (name === 'room' ? getRoom('lobby') : null) };
})();
