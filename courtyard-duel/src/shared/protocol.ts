import { Cmd, PlayerState } from './player';
import { Loadout, MatchConfig, PISTOLS, PRIMARIES, WeaponId } from './config';
import { HitRegion } from './config';
import { Mat } from './map';

export const PROTOCOL_VERSION = 1;

export type Phase = 'waiting' | 'prep' | 'live' | 'roundEnd' | 'matchEnd' | 'paused' | 'practice';
export const PHASES: Phase[] = ['waiting', 'prep', 'live', 'roundEnd', 'matchEnd', 'paused', 'practice'];

// ------------------------------------------------------------------ client -> server
export type ClientMsg =
  | { t: 'create'; name: string; secret: string; v: number }
  | { t: 'join'; room: string; name: string; secret: string; v: number }
  | { t: 'in'; ep: number; c: Cmd[] }
  | { t: 'loadout'; primary: WeaponId; pistol: WeaponId }
  | { t: 'ping'; c: number; rtt: number }
  | { t: 'rematch' }
  | { t: 'reset' } // practice only: respawn + reset targets
  | { t: 'leave' };

// ------------------------------------------------------------------ server -> client
export interface PlayerInfo {
  name: string;
  connected: boolean;
  loadout: Loadout;
  rematch: boolean;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
}

export interface RoomInfo {
  t: 'room';
  phase: Phase;
  round: number;
  slot: number;
  cfg: MatchConfig;
  players: [PlayerInfo | null, PlayerInfo | null];
  winner: number; // match winner slot or -1
  /** Result of the last finished round: slot that won, -1 for a draw, -2 none yet. */
  lastRound: number;
  lastRoundReason: string;
}

export interface OpponentSnap {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  crouch: number; vx: number; vz: number;
  ground: number; alive: number;
  wid: WeaponId; reloading: number; zoom: number;
}

export interface TargetSnap {
  id: number; x: number; y: number; z: number; yaw: number; hp: number; dead: number;
}

export interface Snapshot {
  t: 'snap';
  k: number; // server tick
  st: number; // server time ms
  ack: number; // last processed cmd seq for the receiver
  ep: number; // round epoch (changes on every respawn)
  ph: number; // index into PHASES
  pt: number; // seconds remaining in the phase
  rd: number;
  sc: [number, number];
  me: PlayerState;
  op: OpponentSnap | null;
  tg?: TargetSnap[];
}

export type GameEvent =
  | { k: 'shot'; who: number; w: WeaponId; ox: number; oy: number; oz: number; ex: number; ey: number; ez: number; surf: Mat | ''; nx: number; ny: number; nz: number; hit: number; n: number }
  | { k: 'hit'; by: number; victim: number; region: HitRegion; dmg: number; armorLoss: number; hp: number; armor: number; kill: number; w: WeaponId; dist: number; fx: number; fy: number; fz: number }
  | { k: 'thit'; id: number; region: HitRegion; dmg: number; armorLoss: number; hp: number; kill: number; w: WeaponId; dist: number }
  | { k: 'reload'; who: number; w: WeaponId }
  | { k: 'switch'; who: number; slot: number; w: WeaponId }
  | { k: 'step'; who: number; x: number; y: number; z: number; surf: Mat }
  | { k: 'jump'; who: number; x: number; y: number; z: number }
  | { k: 'land'; who: number; x: number; y: number; z: number; surf: Mat }
  | { k: 'live' }
  | { k: 'round'; winner: number; reason: string; sc: [number, number]; round: number }
  | { k: 'match'; winner: number }
  | { k: 'kill'; killer: number; victim: number; w: WeaponId; head: number };

export type ServerMsg =
  | { t: 'joined'; room: string; slot: number; time: number; v: number }
  | { t: 'err'; code: string; msg: string }
  | RoomInfo
  | Snapshot
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'pong'; c: number; s: number }
  | { t: 'bye'; reason: string };

// ------------------------------------------------------------------ validation
const isNum = (v: unknown, lo = -Infinity, hi = Infinity): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  // strip control characters and bidi overrides, collapse spaces
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length ? s : 'Player';
}

const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const ROOM_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function parseClientMsg(raw: string, maxCmds: number): ClientMsg | null {
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'create':
      if (typeof m.secret !== 'string' || !SECRET_RE.test(m.secret)) return null;
      return { t: 'create', name: sanitizeName(m.name), secret: m.secret, v: isInt(m.v, 0, 1000) ? m.v : 0 };
    case 'join':
      if (typeof m.room !== 'string' || !ROOM_TOKEN_RE.test(m.room)) return null;
      if (typeof m.secret !== 'string' || !SECRET_RE.test(m.secret)) return null;
      return { t: 'join', room: m.room, name: sanitizeName(m.name), secret: m.secret, v: isInt(m.v, 0, 1000) ? m.v : 0 };
    case 'in': {
      if (!isInt(m.ep, 0, 1e9) || !Array.isArray(m.c) || m.c.length > maxCmds) return null;
      const out: Cmd[] = [];
      for (const a of m.c) {
        if (!Array.isArray(a) || a.length !== 6) return null;
        const [seq, buttons, yaw, pitch, slot, rt] = a;
        if (!isInt(seq, 0, 2 ** 31) || !isInt(buttons, 0, 1023) || !isNum(yaw, -1e4, 1e4) || !isNum(pitch, -10, 10) || !isInt(slot, -1, 1) || !isNum(rt, 0, 1e12)) return null;
        out.push({ seq, buttons, yaw, pitch, slot, rt });
      }
      return { t: 'in', ep: m.ep, c: out };
    }
    case 'loadout':
      if (!PRIMARIES.includes(m.primary) || !PISTOLS.includes(m.pistol)) return null;
      return { t: 'loadout', primary: m.primary, pistol: m.pistol };
    case 'ping':
      if (!isNum(m.c, 0, 1e12)) return null;
      return { t: 'ping', c: m.c, rtt: isNum(m.rtt, 0, 5000) ? m.rtt : 0 };
    case 'rematch': return { t: 'rematch' };
    case 'reset': return { t: 'reset' };
    case 'leave': return { t: 'leave' };
    default: return null;
  }
}

export const encodeCmds = (cmds: Cmd[]): number[][] => cmds.map((c) => [c.seq, c.buttons, c.yaw, c.pitch, c.slot, c.rt]);
