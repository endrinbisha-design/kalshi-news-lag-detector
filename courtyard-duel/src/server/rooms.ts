import { randomBytes } from 'node:crypto';
import { MatchConfig, NET } from '../shared/config';
import { MatchSim } from '../shared/match';
import { ClientMsg, ServerMsg } from '../shared/protocol';
import { World } from '../shared/world';
import { MAP } from '../shared/map';

export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount: number;
}

interface Slot {
  secret: string;
  socket: Socket | null;
}

export type JoinResult = { ok: true; slot: number } | { ok: false; code: string; msg: string };

const sharedWorld = new World(MAP);

/** One private duel room. Max two human players; identified by secret so a reconnect can never create a duplicate. */
export class Room {
  readonly token: string;
  readonly sim: MatchSim;
  slots: [Slot | null, Slot | null] = [null, null];
  lastActive = Date.now();
  createdAt = Date.now();

  constructor(token: string, cfg: MatchConfig) {
    this.token = token;
    this.sim = new MatchSim({
      config: cfg,
      mode: 'duel',
      world: sharedWorld,
      emit: (slot, msg) => this.send(slot, msg as ServerMsg),
      randomSeed: () => randomBytes(4).readUInt32LE(0) / 4294967296,
    });
  }

  get connectedCount(): number {
    return this.slots.filter((s) => s && s.socket).length;
  }

  send(slot: number, msg: ServerMsg): void {
    const s = this.slots[slot]?.socket;
    if (!s) return;
    // Backpressure: never let a stalled client queue unbounded data.
    if (s.bufferedAmount > 512 * 1024) { s.close(1013, 'slow consumer'); return; }
    try { s.send(JSON.stringify(msg)); } catch { /* socket already gone */ }
  }

  join(secret: string, name: string, socket: Socket): JoinResult {
    // Same secret => same player: replaces the previous connection (no duplicates, supports refresh / reconnect).
    let slot = this.slots.findIndex((s) => s && s.secret === secret);
    if (slot >= 0) {
      const old = this.slots[slot]!.socket;
      this.slots[slot]!.socket = socket;
      if (old && old !== socket) {
        try { old.close(4001, 'replaced by a newer connection'); } catch { /* ignore */ }
      }
    } else {
      slot = this.slots.findIndex((s) => s === null);
      if (slot < 0) return { ok: false, code: 'full', msg: 'This room already has two players.' };
      this.slots[slot] = { secret, socket };
    }
    this.lastActive = Date.now();
    this.sim.connect(slot, name);
    return { ok: true, slot };
  }

  /** Called when a socket closes. Only affects the slot if that socket is still the active one. */
  detach(slot: number, socket: Socket): void {
    const s = this.slots[slot];
    if (!s || s.socket !== socket) return;
    s.socket = null;
    this.lastActive = Date.now();
    this.sim.disconnect(slot);
  }

  /** Player explicitly left: free the seat so the room can be re-used, and drop the match. */
  leave(slot: number): void {
    const s = this.slots[slot];
    if (!s) return;
    const sock = s.socket;
    s.socket = null;
    this.slots[slot] = null;
    this.sim.leave(slot);
    this.lastActive = Date.now();
    try { sock?.close(1000, 'left'); } catch { /* ignore */ }
  }

  handle(slot: number, msg: ClientMsg): void {
    this.lastActive = Date.now();
    switch (msg.t) {
      case 'in': this.sim.input(slot, msg.ep, msg.c); break;
      case 'loadout': this.sim.setLoadout(slot, { primary: msg.primary, pistol: msg.pistol }); break;
      case 'ping':
        this.sim.setPing(slot, msg.rtt);
        this.send(slot, { t: 'pong', c: msg.c, s: this.sim.timeMs });
        break;
      case 'rematch': this.sim.voteRematch(slot); break;
      case 'leave': this.leave(slot); break;
      default: break;
    }
  }

  close(reason: string): void {
    for (const s of this.slots) { try { s?.socket?.close(1001, reason); } catch { /* ignore */ } }
  }
}

export interface ManagerOptions {
  cfg: MatchConfig;
  maxRooms: number;
  ttlMs: number;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(private opts: ManagerOptions) {}

  create(): Room | null {
    if (this.rooms.size >= this.opts.maxRooms) return null;
    // 16 random bytes -> 22 url-safe base64 characters (128 bits of entropy). Not guessable, never listed.
    const token = randomBytes(16).toString('base64url');
    const room = new Room(token, this.opts.cfg);
    this.rooms.set(token, room);
    return room;
  }

  get(token: string): Room | undefined { return this.rooms.get(token); }

  step(): void {
    for (const r of this.rooms.values()) {
      r.sim.step();
      if (r.sim.released.length) {
        // an absent player's seat is freed once the match is abandoned, so the link holder can be replaced
        for (const s of r.sim.released) { r.slots[s] = null; }
        r.sim.released.length = 0;
      }
    }
  }

  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [t, r] of this.rooms) {
      if (r.connectedCount === 0 && now - r.lastActive > this.opts.ttlMs) {
        r.close('expired');
        this.rooms.delete(t);
        removed++;
      }
    }
    return removed;
  }
}

/** Token bucket. */
export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private perSec: number) { this.tokens = capacity; }
  take(n = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}

export const MAX_CMDS = NET.maxCmdsPerMessage;
