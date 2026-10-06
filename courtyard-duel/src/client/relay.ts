/**
 * "Relay" multiplayer for when the game runs as a claude.ai artifact (no game server reachable).
 *
 * The artifact runtime offers a realtime `room` (presence + events). The player who HOSTS a duel runs the same
 * authoritative MatchSim the Node server runs, inside their tab; the guest connects through the room relay.
 * Everything travels as *presence* objects (absolute state, coalesced ~30/s, 4 KiB max), which any viewer may set:
 *   host  presence: { r:'h', a: acceptedGuestPeer, s: snapshotForGuest, m: roomInfo, e: [[id, event]...], p: [pingEcho, hostTime] }
 *   guest presence: { r:'g', n: name, ep, c: last N commands, lo: [primary, pistol], rm: 0|1, pc: pingClientTime, rtt }
 * Commands are resent in a sliding window so a dropped/coalesced presence update loses nothing; events carry ids.
 */
import { DT, MATCH, NET } from '../shared/config';
import { MatchSim } from '../shared/match';
import { Cmd } from '../shared/player';
import { GameEvent, PROTOCOL_VERSION, RoomInfo, ServerMsg, Snapshot, encodeCmds, sanitizeName } from '../shared/protocol';
import { NetStatus, Session } from './net';
import { PRIMARIES, PISTOLS } from '../shared/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Room = any;

let roomNs: Promise<Room | null> | null = null;
/** Resolve the artifact room capability, or null when not running inside a claude.ai artifact. */
export function artifactRoom(): Promise<Room | null> {
  if (roomNs) return roomNs;
  roomNs = (async () => {
    const t0 = performance.now();
    // the platform injects window.claude; wait briefly for it
    while (!(window as any).claude?.use && performance.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 50));
    const c = (window as any).claude;
    if (!c?.use) return null;
    try { return (await c.use('room')) ?? null; } catch { return null; }
  })();
  return roomNs;
}

export function isArtifactHost(): boolean {
  return !!(window as any).claude?.use || /claude\.(ai|site|com)|claudeusercontent|anthropic/.test(location.hostname);
}

const LIMIT = 3900; // stay under the 4 KiB presence cap
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Shrink an opponent pose / target list (prediction state stays exact). */
function compactSnap(s: Snapshot): Snapshot {
  if (s.op) s.op = { ...s.op, x: r4(s.op.x), y: r4(s.op.y), z: r4(s.op.z), yaw: r4(s.op.yaw), pitch: r4(s.op.pitch), crouch: r4(s.op.crouch), vx: r4(s.op.vx), vz: r4(s.op.vz) };
  s.pt = Math.round(s.pt * 100) / 100;
  return s;
}
function compactEvent(e: GameEvent): GameEvent {
  const o: any = { ...e };
  for (const k of Object.keys(o)) if (typeof o[k] === 'number' && !Number.isInteger(o[k])) o[k] = Math.round(o[k] * 1000) / 1000;
  return o;
}

export function randomCode(): string {
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}

// ============================================================================ host
export class RelayHostSession implements Session {
  readonly kind = 'online' as const;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus, detail?: string) => void = () => {};
  rtt = 0;
  readonly code: string;
  private sim: MatchSim;
  private acc = 0;
  private named: Room | null = null;
  private guestPeer: string | null = null;
  private guestSeen = { lo: '', rm: 0, pc: 0 };
  private outSnap: Snapshot | null = null;
  private outRoom: RoomInfo | null = null;
  private evRing: [number, GameEvent][] = [];
  private evId = 0;
  private pong: [number, number] | null = null;
  private dirty = false;
  private lobby: Room;
  private name: string;
  private closed = false;

  constructor(lobby: Room, name: string, code = randomCode()) {
    this.lobby = lobby;
    this.name = name;
    this.code = code;
    this.sim = new MatchSim({ config: { ...MATCH }, mode: 'duel', emit: (slot, msg) => this.route(slot, msg as ServerMsg) });
  }

  async start(): Promise<void> {
    this.onStatus('connecting');
    this.sim.connect(0, this.name);
    this.onMessage({ t: 'joined', room: this.code, slot: 0, time: this.sim.timeMs, v: PROTOCOL_VERSION });
    try {
      this.named = await this.lobby.join('cd-' + this.code);
    } catch (e: any) {
      this.onStatus('closed', 'Could not open a relay room (' + (e?.code ?? 'error') + ').');
      return;
    }
    // advertise in the lobby so the friend can pick this duel from a list
    void this.lobby.presence({ h: { code: this.code, name: this.name, open: 1 } }).catch(() => {});
    this.named.onPeers((ch: any) => this.onPeers(ch.peers));
    this.named.onConnection((c: boolean) => this.onStatus(c ? 'open' : 'reconnecting'));
    this.push(true);
  }

  private onPeers(peers: readonly any[]): void {
    const guests = peers.filter((p) => !p.sameTab && p.presence?.r === 'g');
    let g = guests.find((p) => p.peer === this.guestPeer);
    if (!g && this.guestPeer) {
      // our guest left (closed tab / dropped): the match pauses and waits for a reconnect
      this.sim.disconnect(1);
      this.guestPeer = null;
      this.dirty = true;
    }
    if (!g && !this.guestPeer && guests.length) {
      g = guests[0];
      this.guestPeer = g.peer;
      this.guestSeen = { lo: '', rm: 0, pc: 0 };
      this.sim.connect(1, sanitizeName(g.presence.n));
      this.dirty = true;
    }
    if (g) this.readGuest(g.presence);
  }

  private readGuest(pr: any): void {
    if (!pr) return;
    if (Array.isArray(pr.c) && Number.isInteger(pr.ep)) {
      const cmds: Cmd[] = [];
      for (const a of pr.c.slice(-NET.maxQueuedCmds)) {
        if (!Array.isArray(a) || a.length !== 6 || !a.every((x: unknown) => typeof x === 'number' && Number.isFinite(x))) continue;
        const [seq, buttons, yaw, pitch, slot, rt] = a as number[];
        if (!Number.isInteger(seq) || buttons < 0 || buttons > 1023 || Math.abs(pitch) > 10 || slot < -1 || slot > 1) continue;
        cmds.push({ seq, buttons, yaw, pitch, slot, rt });
      }
      if (cmds.length) this.sim.input(1, pr.ep, cmds);
    }
    if (Array.isArray(pr.lo) && pr.lo.join() !== this.guestSeen.lo && PRIMARIES.includes(pr.lo[0]) && PISTOLS.includes(pr.lo[1])) {
      this.guestSeen.lo = pr.lo.join();
      this.sim.setLoadout(1, { primary: pr.lo[0], pistol: pr.lo[1] });
    }
    if (pr.rm && !this.guestSeen.rm) this.sim.voteRematch(1);
    this.guestSeen.rm = pr.rm ? 1 : 0;
    if (typeof pr.pc === 'number' && pr.pc !== this.guestSeen.pc) {
      this.guestSeen.pc = pr.pc;
      this.pong = [pr.pc, this.sim.timeMs];
      this.dirty = true;
    }
    if (typeof pr.rtt === 'number') this.sim.setPing(1, Math.min(5000, Math.max(0, pr.rtt)));
  }

  /** MatchSim output: slot 0 is this tab, slot 1 goes into our presence. */
  private route(slot: number, m: ServerMsg): void {
    if (slot === 0) { this.onMessage(m); return; }
    if (m.t === 'snap') { this.outSnap = compactSnap({ ...m }); this.dirty = true; }
    else if (m.t === 'room') { this.outRoom = m; this.dirty = true; }
    else if (m.t === 'ev') { for (const e of m.e) this.evRing.push([++this.evId, compactEvent(e)]); this.dirty = true; }
  }

  private push(force = false): void {
    if (!this.named || (!this.dirty && !force)) return;
    this.dirty = false;
    // keep the newest events that fit next to the snapshot + room info
    while (this.evRing.length > 40) this.evRing.shift();
    let obj: any = { r: 'h', a: this.guestPeer, s: this.outSnap, m: this.outRoom, e: this.evRing, p: this.pong };
    let size = JSON.stringify(obj).length;
    while (size > LIMIT && this.evRing.length) { this.evRing.shift(); obj = { ...obj, e: this.evRing }; size = JSON.stringify(obj).length; }
    if (size > LIMIT) obj = { ...obj, m: null };
    this.named.presence(obj).catch(() => {});
  }

  sendCmds(ep: number, cmds: Cmd[]): void { this.sim.input(0, ep, cmds); }
  sendLoadout(primary: string, pistol: string): void { this.sim.setLoadout(0, { primary: primary as any, pistol: pistol as any }); }
  rematch(): void { this.sim.voteRematch(0); }
  reset(): void {}
  leave(): void { this.close(); }
  frame(dt: number): void {
    if (this.closed) return;
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= DT && n < 15) { this.sim.step(); this.acc -= DT; n++; }
    if (n === 15) this.acc = 0;
    this.push();
  }
  close(): void {
    this.closed = true;
    void this.lobby.presence({ h: null }).catch(() => {});
    void this.named?.leave().catch(() => {});
    this.onStatus('closed');
  }
}

// ============================================================================ guest
export class RelayGuestSession implements Session {
  readonly kind = 'online' as const;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus, detail?: string) => void = () => {};
  rtt = 0;
  private named: Room | null = null;
  private myPeer = '';
  private hostPeer = '';
  private joined = false;
  private lastSnap = -1;
  private lastEv = 0;
  private lastRoom = '';
  private lastPong = 0;
  private window: Cmd[] = [];
  private ep = 0;
  private lo: [string, string] | null = null;
  private rm = 0;
  private pingTimer = 0;
  private waitTimer = 0;

  constructor(private lobby: Room, private name: string, readonly code: string) {}

  async start(): Promise<void> {
    this.onStatus('connecting');
    try { this.named = await this.lobby.join('cd-' + this.code); }
    catch (e: any) { this.onStatus('closed', 'Could not reach the duel (' + (e?.code ?? 'error') + ').'); return; }
    await this.named.presence({ r: 'g', n: this.name, c: [], ep: 0 }).catch(() => {});
    this.named.onPeers((ch: any) => this.onPeers(ch.peers));
    this.named.onConnection((c: boolean) => { if (!c && this.joined) this.onStatus('reconnecting'); else if (c && this.joined) this.onStatus('open'); });
    this.pingTimer = window.setInterval(() => this.flush(true), 1000);
    this.waitTimer = window.setTimeout(() => { if (!this.joined) this.onStatus('closed', 'No host answered in this duel. Ask your friend to host again, then join from the list.'); }, 15000);
  }

  private onPeers(peers: readonly any[]): void {
    const me = peers.find((p) => p.sameTab);
    if (me) this.myPeer = me.peer;
    const host = peers.find((p) => !p.sameTab && p.presence?.r === 'h');
    if (!host) {
      if (this.joined) this.onStatus('reconnecting');
      return;
    }
    const pr = host.presence;
    if (pr.a && pr.a !== this.myPeer) { if (!this.joined) this.onStatus('closed', 'This duel already has two players.'); return; }
    if (pr.a !== this.myPeer) return; // not admitted yet
    this.hostPeer = host.peer;
    if (!this.joined && pr.s) {
      this.joined = true;
      window.clearTimeout(this.waitTimer);
      this.onStatus('open');
      this.onMessage({ t: 'joined', room: this.code, slot: 1, time: pr.s.st, v: PROTOCOL_VERSION });
      if (this.lo) this.flush(true);
    }
    if (!this.joined) return;
    if (pr.m) { const k = JSON.stringify(pr.m); if (k !== this.lastRoom) { this.lastRoom = k; this.onMessage(pr.m); } }
    if (Array.isArray(pr.e)) {
      const fresh = pr.e.filter((x: any) => Array.isArray(x) && x[0] > this.lastEv);
      if (fresh.length) { this.lastEv = fresh[fresh.length - 1][0]; this.onMessage({ t: 'ev', e: fresh.map((x: any) => x[1]) }); }
    }
    if (pr.s && pr.s.k > this.lastSnap) { this.lastSnap = pr.s.k; this.onMessage(pr.s); }
    if (Array.isArray(pr.p) && pr.p[0] !== this.lastPong) {
      this.lastPong = pr.p[0];
      const rtt = performance.now() - pr.p[0];
      if (rtt >= 0 && rtt < 10000) this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    }
  }

  private flush(withPing = false): void {
    if (!this.named) return;
    const patch: any = { r: 'g', n: this.name, ep: this.ep, c: encodeCmds(this.window) };
    if (this.lo) patch.lo = this.lo;
    patch.rm = this.rm;
    if (withPing) { patch.pc = Math.round(performance.now() * 1000) / 1000; patch.rtt = Math.round(this.rtt); }
    this.named.presence(patch).catch(() => {});
  }

  sendCmds(ep: number, cmds: Cmd[]): void {
    if (ep !== this.ep) { this.window = []; this.ep = ep; }
    this.window.push(...cmds);
    if (this.window.length > 12) this.window.splice(0, this.window.length - 12);
    this.flush();
  }
  sendLoadout(primary: string, pistol: string): void { this.lo = [primary, pistol]; this.flush(); }
  rematch(): void { this.rm = 1; this.flush(); }
  reset(): void {}
  leave(): void { this.close(); }
  frame(): void { if (this.rm && this.lastRoom.includes('"phase":"prep"')) this.rm = 0; }
  close(): void {
    window.clearInterval(this.pingTimer); window.clearTimeout(this.waitTimer);
    void this.named?.leave().catch(() => {});
    this.onStatus('closed');
  }
}

/** Open duels advertised in the artifact's lobby (only people the artifact is shared with can see them). */
export function watchHosts(lobby: Room, cb: (hosts: { code: string; name: string }[]) => void): () => void {
  const emit = (peers: readonly any[]) => cb(peers.filter((p) => !p.sameTab && p.presence?.h?.code && p.presence.h.open)
    .map((p) => ({ code: String(p.presence.h.code).replace(/[^a-z0-9]/g, '').slice(0, 12), name: sanitizeName(p.presence.h.name) })));
  emit(lobby.peers());
  return lobby.onPeers((ch: any) => emit(ch.peers));
}
