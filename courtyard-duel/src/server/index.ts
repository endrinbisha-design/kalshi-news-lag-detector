import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';
import { MATCH, MatchConfig, NET, TICK_RATE } from '../shared/config';
import { PROTOCOL_VERSION, parseClientMsg, ServerMsg } from '../shared/protocol';
import { Bucket, MAX_CMDS, Room, RoomManager, Socket } from './rooms';

// ------------------------------------------------------------------ configuration (environment variables)
const env = process.env;
const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };

export const PORT = num(env.PORT, 8080);
const HOST = env.HOST ?? '0.0.0.0';
const TRUST_PROXY = env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true';
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_ROOMS = num(env.MAX_ROOMS, 500);
const ROOM_TTL_MS = num(env.ROOM_TTL_MIN, 30) * 60_000;
const SIM_LATENCY_MS = num(env.SIM_LATENCY_MS, 0); // dev/test only: artificial one-way delay
const SIM_JITTER_MS = num(env.SIM_JITTER_MS, 0);
const MAX_CONN_PER_IP = num(env.MAX_CONN_PER_IP, 8);
const STATIC_DIR = resolve(env.STATIC_DIR ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'client'));

const matchCfg: MatchConfig = {
  winRounds: num(env.WIN_ROUNDS, MATCH.winRounds),
  prepSeconds: num(env.PREP_TIME_SEC, MATCH.prepSeconds),
  roundSeconds: num(env.ROUND_TIME_SEC, MATCH.roundSeconds),
  roundEndSeconds: num(env.ROUND_END_SEC, MATCH.roundEndSeconds),
  reconnectGraceSeconds: num(env.RECONNECT_GRACE_SEC, MATCH.reconnectGraceSeconds),
};

const log = (...a: unknown[]) => { if (env.QUIET !== '1') console.log(new Date().toISOString(), ...a); };

// ------------------------------------------------------------------ static file server
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const gzCache = new Map<string, { mtime: number; body: Buffer }>();

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
if (env.HSTS === '1') SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel: string;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.includes('\0')) { res.writeHead(400).end(); return; }
  let file = normalize(join(STATIC_DIR, rel));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) { res.writeHead(403).end(); return; }
  let isIndex = false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(rel) && extname(rel) !== '.html') { res.writeHead(404, SECURITY_HEADERS).end('Not found'); return; }
    file = join(STATIC_DIR, 'index.html'); // SPA fallback (invite links use the hash, but be lenient)
    isIndex = true;
  }
  if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Client not built. Run `npm run build` first (or use `npm run dev`).'); return; }
  const st = statSync(file);
  const ext = extname(file).toLowerCase();
  const headers: Record<string, string | number> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    ...SECURITY_HEADERS,
    'Cache-Control': isIndex || ext === '.html' ? 'no-cache' : file.includes(`${sep}assets${sep}`) && /-[A-Za-z0-9_-]{8}\./.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    ETag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
    'Last-Modified': st.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === headers.ETag) { res.writeHead(304, headers).end(); return; }
  if (req.method === 'HEAD') { res.writeHead(200, { ...headers, 'Content-Length': st.size }).end(); return; }
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (acceptsGzip && COMPRESSIBLE.has(ext) && st.size > 512) {
    let c = gzCache.get(file);
    if (!c || c.mtime !== st.mtimeMs) { c = { mtime: st.mtimeMs, body: gzipSync(readFileSync(file), { level: 9 }) }; gzCache.set(file, c); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': c.body.length });
    res.end(c.body);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------ rate limiting by IP
function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const ipBuckets = new Map<string, { create: Bucket; badJoin: Bucket; conns: number }>();
function ipState(ip: string) {
  let s = ipBuckets.get(ip);
  if (!s) { s = { create: new Bucket(6, 6 / 60), badJoin: new Bucket(10, 10 / 60), conns: 0 }; ipBuckets.set(ip, s); }
  return s;
}
setInterval(() => { for (const [ip, s] of ipBuckets) if (s.conns === 0) ipBuckets.delete(ip); }, 10 * 60_000).unref();

// ------------------------------------------------------------------ artificial latency (testing)
function wrapSocket(ws: WebSocket): Socket {
  if (SIM_LATENCY_MS <= 0) return ws as unknown as Socket;
  let lastDue = 0;
  return {
    send(data: string) {
      const due = Math.max(lastDue, Date.now() + SIM_LATENCY_MS + Math.random() * SIM_JITTER_MS);
      lastDue = due;
      setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(data); }, due - Date.now());
    },
    close: (c, r) => ws.close(c, r),
    get bufferedAmount() { return ws.bufferedAmount; },
  };
}

// ------------------------------------------------------------------ HTTP + WebSocket
const manager = new RoomManager({ cfg: matchCfg, maxRooms: MAX_ROOMS, ttlMs: ROOM_TTL_MS });

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, v: PROTOCOL_VERSION }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxMessageBytes, perMessageDeflate: false });

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, bots)
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

server.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/ws') { socket.destroy(); return; }
  if (!originAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  const ip = clientIp(req);
  const st = ipState(ip);
  if (st.conns >= MAX_CONN_PER_IP) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req, ip); });
});

interface Conn { room: Room | null; slot: number; alive: boolean; bucket: Bucket; dropped: number }

wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ip: string) => {
  const st = ipState(ip);
  st.conns++;
  const sock = wrapSocket(ws);
  const conn: Conn = { room: null, slot: -1, alive: true, bucket: new Bucket(120, 90), dropped: 0 };
  const sendErr = (code: string, msg: string) => sock.send(JSON.stringify({ t: 'err', code, msg } satisfies ServerMsg));

  ws.on('pong', () => { conn.alive = true; });
  ws.on('error', () => { /* handled by close */ });

  const onMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (isBinary) return;
    if (!conn.bucket.take()) {
      // Flooding: drop the message; persistent flooding disconnects.
      if (++conn.dropped > 300) ws.close(1008, 'rate limit');
      return;
    }
    const msg = parseClientMsg(data.toString(), MAX_CMDS);
    if (!msg) { if (++conn.dropped > 300) ws.close(1008, 'bad messages'); return; }

    if (!conn.room) {
      if (msg.t === 'create') {
        if (!st.create.take()) { sendErr('rate', 'Too many rooms created. Try again in a minute.'); return; }
        const room = manager.create();
        if (!room) { sendErr('capacity', 'The server is full right now. Try again later.'); return; }
        const r = room.join(msg.secret, msg.name, sock);
        if (r.ok) { conn.room = room; conn.slot = r.slot; sock.send(JSON.stringify({ t: 'joined', room: room.token, slot: r.slot, time: room.sim.timeMs, v: PROTOCOL_VERSION } satisfies ServerMsg)); log('room created', room.token.slice(0, 4) + '…'); }
        return;
      }
      if (msg.t === 'join') {
        const room = manager.get(msg.room);
        if (!room) {
          if (!st.badJoin.take()) { sendErr('rate', 'Too many invalid room links. Slow down.'); ws.close(1008, 'rate'); return; }
          sendErr('no_room', 'Room not found. The link may be wrong or the room expired.');
          return;
        }
        const r = room.join(msg.secret, msg.name, sock);
        if (!r.ok) { sendErr(r.code, r.msg); return; }
        conn.room = room; conn.slot = r.slot;
        sock.send(JSON.stringify({ t: 'joined', room: room.token, slot: r.slot, time: room.sim.timeMs, v: PROTOCOL_VERSION } satisfies ServerMsg));
        log('player joined room', room.token.slice(0, 4) + '…', 'slot', r.slot);
        return;
      }
      return; // everything else requires a room
    }
    if (msg.t === 'create' || msg.t === 'join') return;
    conn.room.handle(conn.slot, msg);
  };

  if (SIM_LATENCY_MS > 0) {
    let lastDue = 0;
    ws.on('message', (d, b) => {
      const due = Math.max(lastDue, Date.now() + SIM_LATENCY_MS + Math.random() * SIM_JITTER_MS);
      lastDue = due;
      setTimeout(() => onMessage(d as Buffer, b), due - Date.now());
    });
  } else ws.on('message', (d, b) => onMessage(d as Buffer, b));

  ws.on('close', () => {
    st.conns = Math.max(0, st.conns - 1);
    if (conn.room) conn.room.detach(conn.slot, sock);
  });

  // a connection that never joins a room is dropped quickly
  setTimeout(() => { if (!conn.room && ws.readyState === WebSocket.OPEN) ws.close(1008, 'no join'); }, 15_000).unref();

  (ws as any).__conn = conn;
});

// keep-alive: dead TCP connections are terminated so reconnect logic can kick in
setInterval(() => {
  for (const ws of wss.clients) {
    const c = (ws as any).__conn as Conn | undefined;
    if (!c) continue;
    if (!c.alive) { ws.terminate(); continue; }
    c.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 10_000).unref();

// ------------------------------------------------------------------ fixed-rate simulation loop
let last = performance.now();
let acc = 0;
const STEP_MS = 1000 / TICK_RATE;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(now - last, 250);
  last = now;
  let n = 0;
  while (acc >= STEP_MS && n < 8) { manager.step(); acc -= STEP_MS; n++; }
  if (n === 8) acc = 0;
}, 4);
setInterval(() => { const n = manager.sweep(); if (n) log('expired rooms:', n); }, 60_000).unref();

server.listen(PORT, HOST, () => {
  log(`Courtyard Duel server listening on http://${HOST}:${PORT}  (static: ${STATIC_DIR})`);
  log(`match: first to ${matchCfg.winRounds}, prep ${matchCfg.prepSeconds}s, round ${matchCfg.roundSeconds}s` + (SIM_LATENCY_MS ? `  [simulated latency ${SIM_LATENCY_MS}ms]` : ''));
});

function shutdown() {
  log('shutting down');
  for (const r of manager.rooms.values()) r.close('server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
