import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import WebSocket from 'ws';
import { BTN } from '../src/shared/config';
import { Bot, findPath, sleep, walkPath } from './bot';

async function freePort(): Promise<number> {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
}

interface Srv { proc: ChildProcess; port: number; url: string; stop(): Promise<void> }
async function startServer(env: Record<string, string> = {}): Promise<Srv> {
  const port = await freePort();
  const proc = spawn('node_modules/.bin/tsx', ['src/server/index.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PREP_TIME_SEC: '1', ROUND_TIME_SEC: '12', ROUND_END_SEC: '0.6', WIN_ROUNDS: '2', RECONNECT_GRACE_SEC: '3', QUIET: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout!.on('data', (d) => (log += d)); proc.stderr!.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (!log.includes('listening')) { if (Date.now() - t0 > 15000) throw new Error('server did not start: ' + log); await sleep(50); }
  return { proc, port, url: `ws://127.0.0.1:${port}/ws`, stop: async () => { proc.kill('SIGTERM'); await sleep(100); } };
}

/** Both bots walk to their firing posts in the open z=-7 lane (clear line of sight across the arena). */
async function toPosts(a: Bot, b: Bot) {
  await Promise.all([a, b].map(async (bot) => {
    await bot.waitFor(() => bot.phase === 'live', 6000, 'live');
    const side = bot.pred!.x < 0 ? -1 : 1;
    const path = findPath({ x: bot.pred!.x, z: bot.pred!.z }, { x: side * 14, z: -7 });
    if (!path.length) throw new Error('no path');
    await walkPath(bot, path);
  }));
}

async function shootUntilKill(shooter: Bot, victim: Bot, ms = 6000) {
  const t0 = Date.now();
  const startRoundWins = shooter.scores[shooter.slot];
  while (Date.now() - t0 < ms) {
    if (victim.phase !== 'live' && victim.phase !== 'roundEnd') break;
    shooter.aimAtOpponent();
    shooter.input.buttons = BTN.FIRE;
    await sleep(10);
    if (shooter.phase === 'roundEnd') break;
  }
  shooter.input.buttons = 0;
  void startRoundWins;
}

describe('room flow, limits and validation', () => {
  let srv: Srv;
  beforeAll(async () => { srv = await startServer(); });
  afterAll(async () => { await srv.stop(); });

  it('creates a private room with a 128-bit token and enforces the two-player limit', async () => {
    const a = new Bot(srv.url, 'Alice');
    const token = await a.create();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.slot).toBe(0);
    const b = new Bot(srv.url, 'Bob');
    await b.join(token);
    expect(b.slot).toBe(1);
    const c = new Bot(srv.url, 'Mallory');
    await c.join(token, false);
    await c.waitFor(() => c.errors.length > 0, 3000, 'error for third player');
    expect(c.errors[0].code).toBe('full');
    // an unknown but well-formed token is rejected without revealing anything
    const d = new Bot(srv.url, 'Eve');
    await d.join('A'.repeat(22), false);
    await d.waitFor(() => d.errors.length > 0, 3000, 'no_room');
    expect(d.errors[0].code).toBe('no_room');
    // a malformed token is dropped silently by validation (no crash, no room)
    const e = new Bot(srv.url, 'Eve2');
    await e.join('short', false);
    await sleep(200);
    expect(e.token).toBe('');
    // the server is still healthy
    const res = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    expect((await res.json()).ok).toBe(true);
    [a, b, c, d, e].forEach((x) => x.close());
  });

  it('rooms are never listed publicly', async () => {
    for (const path of ['/rooms', '/api/rooms', '/api/room', '/rooms.json']) {
      const r = await fetch(`http://127.0.0.1:${srv.port}${path}`);
      const body = await r.text();
      expect(body.includes('"rooms"') && body.includes('token')).toBe(false);
    }
  });

  it('reconnecting with the same secret replaces the old socket and never duplicates the player', async () => {
    const a = new Bot(srv.url, 'Alice');
    const token = await a.create();
    const b = new Bot(srv.url, 'Bob');
    await b.join(token);
    await a.waitFor(() => a.phase === 'prep', 4000, 'prep');
    // Bob refreshes the page: a new socket with the same secret
    const b2 = new Bot(srv.url, 'Bob');
    b2.secret = b.secret;
    await b2.join(token);
    expect(b2.slot).toBe(1);
    await b.waitFor(() => b.closedCode === 4001, 3000, 'old socket replaced');
    await sleep(300);
    const hz = await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json();
    expect(hz.rooms).toBeGreaterThanOrEqual(1);
    // a newcomer still cannot take a third seat
    const c = new Bot(srv.url, 'Carol');
    await c.join(token, false);
    await c.waitFor(() => c.errors.length > 0, 3000, 'full');
    expect(c.errors[0].code).toBe('full');
    [a, b, b2, c].forEach((x) => x.close());
  });

  it('survives garbage, oversized messages, NaN commands and floods', async () => {
    const a = new Bot(srv.url, 'Alice');
    const token = await a.create();
    const b = new Bot(srv.url, 'Bob');
    await b.join(token);
    await a.waitFor(() => a.phase === 'prep' && !!a.pred, 4000, 'prep');
    const raw = new WebSocket(srv.url);
    await new Promise((r) => raw.on('open', r));
    raw.send('not json'); raw.send('{"t":"in"}'); raw.send(JSON.stringify({ t: 'join', room: token, name: 'x'.repeat(200), secret: 'bad' }));
    // oversize
    raw.send('x'.repeat(10_000));
    await new Promise((r) => raw.on('close', r));
    // NaN / absurd command values on a legit connection are rejected by validation, state unaffected
    const x0 = a.pred!.x;
    a.send({ t: 'in', ep: a.epoch, c: [[999999, 1, 1e99, 0, 0, 0], [1000000, 99999, 0, 0, 0, 0], [1000001, 1, 0, 'NaN', 0, 0]] });
    await sleep(200);
    expect(a.pred!.x).toBeCloseTo(x0, 3);
    // flood from a joined connection: it must be cut off while the other player continues unaffected
    const f = new Bot(srv.url, 'Flood');
    await f.connect();
    for (let i = 0; i < 2000; i++) f.send({ t: 'ping', c: i, rtt: 0 });
    for (let i = 0; i < 400; i++) f.send({ t: 'bogus', i });
    await sleep(500);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    const hz = await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json();
    expect(hz.ok).toBe(true);
    [a, b, f].forEach((x) => x.close());
  });
});

describe('full match with two independent clients', () => {
  let srv: Srv;
  beforeAll(async () => { srv = await startServer(); });
  afterAll(async () => { await srv.stop(); });

  it('plays rounds to a match win with alternating sides, then a clean rematch', async () => {
    const a = new Bot(srv.url, 'Alice'), b = new Bot(srv.url, 'Bob');
    const token = await a.create();
    await b.join(token);
    await a.waitFor(() => a.phase === 'prep' && !!a.pred, 4000, 'prep');
    const sides: number[] = [];
    let lastEpoch = -1;

    // round 1: Alice wins, round 2: Bob wins, round 3: Alice wins => 2-1 (first to 2)
    const winners = [a, b, a];
    for (let r = 0; r < 3; r++) {
      await a.waitFor(() => a.phase === 'prep' && a.epoch > lastEpoch && b.epoch === a.epoch && !!a.pred && !!b.pred, 8000, `prep round ${r + 1}`);
      lastEpoch = a.epoch;
      sides.push(Math.sign(a.pred!.x));
      const shooter = winners[r], victim = shooter === a ? b : a;
      await toPosts(a, b);
      await a.waitFor(() => a.phase === 'live' && b.phase === 'live', 3000, 'live');
      await sleep(250);
      await shootUntilKill(shooter, victim);
      await a.waitFor(() => a.phase === 'roundEnd' || a.phase === 'matchEnd', 4000, 'round end');
      a.input.buttons = 0; b.input.buttons = 0;
      await sleep(100);
      expect(shooter.scores[shooter.slot]).toBe(winners.slice(0, r + 1).filter((w) => w === shooter).length);
      if (r < 2) await a.waitFor(() => a.phase === 'prep' && a.round() === r + 2, 4000, 'next prep');
    }
    expect(sides[0]).toBe(-sides[1]);
    expect(sides[1]).toBe(-sides[2]);
    await a.waitFor(() => a.phase === 'matchEnd', 4000, 'match end');
    expect(a.scores).toEqual([2, 1]);
    // events: kill feed + damage data came from the server
    expect(a.eventsOf('kill').length).toBe(3);
    expect(a.eventsOf('hit').some((h: any) => h.dmg > 0 && h.by === 0)).toBe(true);
    // rematch needs both
    a.send({ t: 'rematch' });
    await sleep(200);
    expect(a.phase).toBe('matchEnd');
    b.send({ t: 'rematch' });
    await a.waitFor(() => a.phase === 'prep', 3000, 'rematch prep');
    expect(a.scores).toEqual([0, 0]);
    expect(a.pred!.hp).toBe(100);
    [a, b].forEach((x) => x.close());
  }, 90000);

  it('walls block shots: shooting at an opponent standing behind the left perimeter wall does no damage', async () => {
    const a = new Bot(srv.url, 'Alice'), b = new Bot(srv.url, 'Bob');
    const token = await a.create();
    await b.join(token);
    await a.waitFor(() => a.phase === 'live' && !!a.pred && !!b.pred, 8000, 'live');
    // Alice faces the nearest wall and fires into it: no hit events, wall impact reported to Bob as a shot with a surface
    const left = a.pred!.x < 0;
    a.input.yaw = left ? Math.PI / 2 : -Math.PI / 2; // face outwards, towards the wall behind her
    a.input.pitch = 0;
    a.input.buttons = BTN.FIRE;
    await sleep(500);
    a.input.buttons = 0;
    expect(a.eventsOf('hit').length).toBe(0);
    const shots = b.eventsOf('shot');
    expect(shots.length).toBeGreaterThan(2);
    expect(shots.every((s: any) => s.hit === 0 && s.surf !== '')).toBe(true);
    [a, b].forEach((x) => x.close());
  }, 30000);
});

describe('disconnect handling', () => {
  let srv: Srv;
  beforeAll(async () => { srv = await startServer(); });
  afterAll(async () => { await srv.stop(); });

  it('pauses when the opponent drops, restarts the round when they return, and resets after the grace period', async () => {
    const a = new Bot(srv.url, 'Alice'); const b = new Bot(srv.url, 'Bob');
    const token = await a.create(); await b.join(token);
    await a.waitFor(() => a.phase === 'live', 5000, 'live');
    b.close();
    await a.waitFor(() => a.phase === 'paused', 3000, 'paused');
    expect(a.room!.players[1]!.connected).toBe(false);
    // Bob comes back with the same identity
    const b2 = new Bot(srv.url, 'Bob'); b2.secret = b.secret;
    await b2.join(token);
    await a.waitFor(() => a.phase === 'prep' && !!a.pred, 4000, 'prep after reconnect');
    expect(a.room!.players.filter((p) => p?.connected).length).toBe(2);
    expect(a.scores).toEqual([0, 0]);
    // Bob leaves for good: after the grace period (3 s here) the room waits again and Alice's score resets
    b2.close();
    await a.waitFor(() => a.phase === 'paused', 3000, 'paused again');
    await a.waitFor(() => a.phase === 'waiting', 6000, 'waiting after grace');
    // a brand-new friend may now take the empty seat
    const c = new Bot(srv.url, 'Carol'); await c.join(token);
    await a.waitFor(() => a.phase === 'prep', 4000, 'prep with new player');
    [a, c].forEach((x) => x.close());
  }, 40000);
});

describe('latency: reconciliation and lag compensation under 2x60ms + jitter', () => {
  let srv: Srv;
  beforeAll(async () => { srv = await startServer({ SIM_LATENCY_MS: '60', SIM_JITTER_MS: '20', ROUND_TIME_SEC: '25' }); });
  afterAll(async () => { await srv.stop(); });

  it('keeps prediction error small while moving and still lands shots on a moving target', async () => {
    const a = new Bot(srv.url, 'Alice'), b = new Bot(srv.url, 'Bob');
    const token = await a.create(); await b.join(token);
    await toPosts(a, b);
    await sleep(500);
    expect(a.maxErr).toBeLessThan(0.05); // walking only: prediction == server
    // Bob strafes along the lane while Alice shoots at his delayed position (what her screen shows)
    a.maxErr = 0;
    let dir = 1; let t0 = Date.now();
    const strafe = setInterval(() => { if (Date.now() - t0 > 450) { dir = -dir; t0 = Date.now(); } b.input.buttons = dir > 0 ? BTN.LEFT : BTN.RIGHT; b.input.yaw = b.pred!.x < 0 ? -Math.PI / 2 : Math.PI / 2; }, 20);
    const t1 = Date.now();
    while (Date.now() - t1 < 8000 && a.phase === 'live') {
      a.aimAtOpponent(); a.input.buttons = BTN.FIRE; await sleep(10);
    }
    clearInterval(strafe);
    a.input.buttons = 0; b.input.buttons = 0;
    const hits = a.eventsOf('hit').filter((h: any) => h.by === a.slot);
    expect(hits.length).toBeGreaterThan(0); // moving target is hit thanks to rewind
    expect(b.maxErr).toBeLessThan(0.6);
    [a, b].forEach((x) => x.close());
  }, 40000);
});
