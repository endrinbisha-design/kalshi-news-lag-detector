import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { BTN, DT, NET } from '../src/shared/config';
import { Cmd, PlayerState, cloneState, eyeHeight, stepPlayer } from '../src/shared/player';
import { GameEvent, OpponentSnap, PHASES, Phase, RoomInfo, ServerMsg, Snapshot, encodeCmds } from '../src/shared/protocol';
import { DEG, lerp } from '../src/shared/math';
import { World } from '../src/shared/world';
import { MAP } from '../src/shared/map';

export const world = new World(MAP);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A headless client that uses the same prediction/reconciliation code path as the browser. */
export class Bot {
  ws!: WebSocket;
  secret = randomBytes(16).toString('base64url');
  slot = -1;
  token = '';
  room: RoomInfo | null = null;
  phase: Phase = 'waiting';
  phaseT = 0;
  epoch = -1;
  pred: PlayerState | null = null;
  me: PlayerState | null = null;
  pending: Cmd[] = [];
  seq = 0;
  opp: OpponentSnap | null = null;
  oppBuf: { st: number; op: OpponentSnap }[] = [];
  events: GameEvent[] = [];
  errors: { code: string; msg: string }[] = [];
  closedCode: number | null = null;
  snaps = 0;
  maxErr = 0;
  rtt = 0;
  lastSt = 0; lastArrival = 0;
  input = { buttons: 0, yaw: 0, pitch: 0, slot: -1 };
  rawMessages: any[] = [];
  private timer: NodeJS.Timeout | null = null;
  private last = performance.now();
  private acc = 0;
  private tickN = 0;
  private outbox: Cmd[] = [];
  private pingTimer: NodeJS.Timeout | null = null;
  scores: [number, number] = [0, 0];
  frozenCheck = true;

  constructor(public url: string, public name: string, public interpMs = 100) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (e) => reject(e));
      this.ws.on('message', (d) => this.onMessage(JSON.parse(d.toString())));
      this.ws.on('close', (code) => { this.closedCode = code; this.stop(); });
    });
  }

  send(o: object) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }

  async create(): Promise<string> {
    await this.connect();
    this.send({ t: 'create', name: this.name, secret: this.secret, v: 1 });
    await this.waitFor(() => !!this.token, 3000, 'room token');
    this.startLoop();
    return this.token;
  }
  async join(token: string, expectOk = true): Promise<void> {
    await this.connect();
    this.send({ t: 'join', room: token, name: this.name, secret: this.secret, v: 1 });
    if (expectOk) { await this.waitFor(() => this.slot >= 0, 3000, 'joined'); this.startLoop(); }
  }

  async waitFor(cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what} (bot ${this.name}, phase=${this.phase}, slot=${this.slot}, errors=${JSON.stringify(this.errors)})`);
      await sleep(10);
    }
  }

  private onMessage(m: ServerMsg) {
    if (m.t === 'joined') { this.token = m.room; this.slot = m.slot; }
    else if (m.t === 'err') this.errors.push({ code: m.code, msg: m.msg });
    else if (m.t === 'room') {
      this.room = m; this.slot = m.slot; this.phase = m.phase;
      this.scores = [m.players[0]?.score ?? 0, m.players[1]?.score ?? 0];
    } else if (m.t === 'ev') this.events.push(...m.e);
    else if (m.t === 'pong') this.rtt = performance.now() - m.c;
    else if (m.t === 'snap') this.onSnap(m);
  }

  serverNow(): number { return this.lastSt + (performance.now() - this.lastArrival); }

  private onSnap(s: Snapshot) {
    this.snaps++;
    this.lastSt = s.st; this.lastArrival = performance.now();
    this.phase = PHASES[s.ph]; this.phaseT = s.pt;
    this.me = s.me; this.opp = s.op;
    if (s.op) { this.oppBuf.push({ st: s.st, op: s.op }); if (this.oppBuf.length > 30) this.oppBuf.shift(); }
    if (s.ep !== this.epoch) {
      this.epoch = s.ep; this.pending = []; this.outbox = []; this.pred = cloneState(s.me); this.oppBuf = s.op ? [{ st: s.st, op: s.op }] : [];
      return;
    }
    this.pending = this.pending.filter((c) => c.seq > s.ack);
    const rec = cloneState(s.me);
    if (rec.alive) for (const c of this.pending) stepPlayer(rec, c, world, { frozen: this.phase === 'prep' }, []);
    if (this.pred) {
      const e = Math.hypot(this.pred.x - rec.x, this.pred.y - rec.y, this.pred.z - rec.z);
      if (e > this.maxErr) this.maxErr = e;
    }
    this.pred = rec;
  }

  /** Opponent pose interpolated at `serverNow - interpMs`, exactly like the browser. */
  oppDelayed(): { x: number; y: number; z: number; crouch: number } | null {
    const buf = this.oppBuf;
    if (!buf.length) return null;
    const rt = this.serverNow() - this.interpMs;
    let a = buf[0], b = buf[0];
    for (let i = 0; i < buf.length; i++) if (buf[i].st <= rt) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; }
    const span = b.st - a.st; const k = span > 0 ? Math.min(1, Math.max(0, (rt - a.st) / span)) : 0;
    return { x: lerp(a.op.x, b.op.x, k), y: lerp(a.op.y, b.op.y, k), z: lerp(a.op.z, b.op.z, k), crouch: lerp(a.op.crouch, b.op.crouch, k) };
  }

  startLoop() {
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 4);
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now(), rtt: Math.round(this.rtt) }), 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); if (this.pingTimer) clearInterval(this.pingTimer); this.timer = this.pingTimer = null; }
  close() { this.stop(); try { this.ws.close(); } catch { /* ignore */ } }

  private pump() {
    const now = performance.now();
    this.acc += Math.min(0.1, (now - this.last) / 1000); this.last = now;
    while (this.acc >= DT) { this.tick(); this.acc -= DT; }
  }

  private tick() {
    if (!this.pred) return;
    const cmd: Cmd = { seq: ++this.seq, buttons: this.input.buttons, yaw: this.input.yaw, pitch: this.input.pitch, slot: this.input.slot, rt: this.serverNow() - this.interpMs };
    this.input.slot = -1;
    this.pending.push(cmd); this.outbox.push(cmd);
    if (this.pred.alive) stepPlayer(this.pred, cmd, world, { frozen: this.phase === 'prep' }, []);
    if (++this.tickN % NET.clientSendEvery === 0 && this.outbox.length) {
      this.send({ t: 'in', ep: this.epoch, c: encodeCmds(this.outbox.splice(0, NET.maxCmdsPerMessage)) });
    }
  }

  /** Aim at the (delayed) opponent chest; returns false when no target. */
  aimAtOpponent(): boolean {
    const o = this.oppDelayed(); const p = this.pred;
    if (!o || !p) return false;
    const dx = o.x - p.x, dz = o.z - p.z;
    const dy = (o.y + 1.3 - 0.3 * o.crouch) - (p.y + eyeHeight(p.crouch));
    // compensate the recoil punch exactly like a player pulling the mouse down while spraying
    this.input.yaw = Math.atan2(-dx, -dz) - p.punchYaw * DEG;
    this.input.pitch = Math.atan2(dy, Math.hypot(dx, dz)) - p.punchPitch * DEG;
    return true;
  }

  round(): number { return this.room?.round ?? 1; }
  eventsOf(k: GameEvent['k']) { return this.events.filter((e) => e.k === k) as any[]; }
}

// -------------------------------------------------------------------- tiny grid path finder on the courtyard level
export function findPath(from: { x: number; z: number }, to: { x: number; z: number }, level = 0): { x: number; z: number }[] {
  const S = 0.5, minX = -19, maxX = 19, minZ = -10, maxZ = 10;
  const W = Math.round((maxX - minX) / S) + 1, H = Math.round((maxZ - minZ) / S) + 1;
  const walk = new Uint8Array(W * H);
  const out = { nx: 0, nz: 0 };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = minX + i * S, z = minZ + j * S;
    const g = world.groundHeight(x, z, 0.1, level + 0.01);
    const pos = { x, z };
    const blocked = world.resolveCircle(pos, 0.45, level, 1.8, level + 0.5, out);
    walk[j * W + i] = g.h > -1 && Math.abs(g.h - level) < 0.01 && !blocked ? 1 : 0;
  }
  const idx = (x: number, z: number) => [Math.round((x - minX) / S), Math.round((z - minZ) / S)] as const;
  const [si, sj] = idx(from.x, from.z), [ti, tj] = idx(to.x, to.z);
  const prev = new Int32Array(W * H).fill(-2);
  const q: number[] = [sj * W + si]; prev[sj * W + si] = -1;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (q.length) {
    const c = q.shift()!;
    if (c === tj * W + ti) break;
    const ci = c % W, cj = (c / W) | 0;
    for (const [di, dj] of dirs) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (prev[n] !== -2 || !walk[n]) continue;
      if (di && dj && (!walk[cj * W + ni] || !walk[nj * W + ci])) continue;
      prev[n] = c; q.push(n);
    }
  }
  const path: { x: number; z: number }[] = [];
  let c = tj * W + ti;
  if (prev[c] === -2) return [];
  while (c >= 0) { path.push({ x: minX + (c % W) * S, z: minZ + ((c / W) | 0) * S }); c = prev[c]; }
  return path.reverse();
}

/** Drive a bot along a path (steer toward the next waypoint). Resolves when within `tol` of the end. */
export async function walkPath(bot: Bot, path: { x: number; z: number }[], tol = 0.35, timeoutMs = 15000): Promise<void> {
  const t0 = Date.now();
  let i = 1;
  while (i < path.length) {
    const p = bot.pred!;
    const w = path[i];
    const dx = w.x - p.x, dz = w.z - p.z;
    if (Math.hypot(dx, dz) < (i === path.length - 1 ? tol : 0.6)) { i++; continue; }
    // movement is relative to view yaw: face the waypoint and press forward
    bot.input.yaw = Math.atan2(-dx, -dz);
    bot.input.pitch = 0;
    bot.input.buttons = BTN.FWD;
    if (Date.now() - t0 > timeoutMs) throw new Error(`walkPath timeout at (${p.x.toFixed(1)},${p.z.toFixed(1)}) -> (${w.x},${w.z})`);
    await sleep(8);
  }
  bot.input.buttons = 0;
}
