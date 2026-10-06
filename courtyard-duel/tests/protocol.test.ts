import { describe, expect, it } from 'vitest';
import { ROOM_TOKEN_RE, parseClientMsg, sanitizeName } from '../src/shared/protocol';
import { Bucket, RoomManager } from '../src/server/rooms';
import { MATCH } from '../src/shared/config';

const secret = 'a'.repeat(24);

describe('message validation', () => {
  it('accepts well-formed messages and rejects malformed ones', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'create', name: 'Alice', secret, v: 1 }), 12)?.t).toBe('create');
    expect(parseClientMsg(JSON.stringify({ t: 'join', room: 'A'.repeat(22), name: 'Bob', secret, v: 1 }), 12)?.t).toBe('join');
    for (const bad of ['', 'null', '[]', '{"t":5}', '{"t":"create"}', '{"t":"create","secret":"short"}', '{"t":"join","room":"x","secret":"' + secret + '"}', '{"t":"in","ep":0,"c":"x"}', '{"t":"nope"}', 'garbage{']) {
      expect(parseClientMsg(bad, 12)).toBeNull();
    }
  });

  it('validates command batches strictly', () => {
    const ok = [1, 3, 0.5, -0.2, -1, 123456];
    expect(parseClientMsg(JSON.stringify({ t: 'in', ep: 2, c: [ok] }), 12)).not.toBeNull();
    const bads: any[] = [
      [[1, 3, 0.5, -0.2, -1]], // wrong arity
      [[1.5, 3, 0, 0, -1, 0]], // non-integer seq
      [[1, 99999, 0, 0, -1, 0]], // buttons out of range
      [[1, 3, 1e9, 0, -1, 0]], // yaw absurd
      [[1, 3, 0, 99, -1, 0]], // pitch absurd
      [[1, 3, 0, 0, 5, 0]], // slot out of range
      [[1, 3, 0, 0, -1, -5]], // negative render time
      [[1, 3, 0, 0, -1, null]],
    ];
    for (const c of bads) expect(parseClientMsg(JSON.stringify({ t: 'in', ep: 0, c }), 12)).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'in', ep: 0, c: Array(13).fill(ok) }), 12)).toBeNull(); // too many
    expect(parseClientMsg('{"t":"in","ep":0,"c":[[1,3,NaN,0,0,0]]}', 12)).toBeNull(); // NaN is not JSON
  });

  it('rejects unknown weapons in loadout messages', () => {
    expect(parseClientMsg('{"t":"loadout","primary":"ak47","pistol":"glock"}', 12)).not.toBeNull();
    expect(parseClientMsg('{"t":"loadout","primary":"glock","pistol":"ak47"}', 12)).toBeNull();
    expect(parseClientMsg('{"t":"loadout","primary":"__proto__","pistol":"glock"}', 12)).toBeNull();
  });

  it('sanitises display names', () => {
    expect(sanitizeName('  Al\u0000ice‮  ')).toBe('Alice');
    expect(sanitizeName('x'.repeat(100)).length).toBe(16);
    expect(sanitizeName('   ')).toBe('Player');
    expect(sanitizeName(42)).toBe('Player');
    expect(sanitizeName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerr'); // stays text; the UI escapes on render
  });
});

describe('rooms', () => {
  const mgr = new RoomManager({ cfg: { ...MATCH }, maxRooms: 3, ttlMs: 1000 });

  it('room tokens are 128-bit url-safe random and unique', () => {
    const tokens = new Set<string>();
    const m2 = new RoomManager({ cfg: { ...MATCH }, maxRooms: 5000, ttlMs: 1000 });
    for (let i = 0; i < 2000; i++) tokens.add(m2.create()!.token);
    expect(tokens.size).toBe(2000);
    for (const t of tokens) expect(t).toMatch(ROOM_TOKEN_RE);
  });

  it('enforces the room capacity and expires abandoned rooms', () => {
    expect(mgr.create()).not.toBeNull(); expect(mgr.create()).not.toBeNull(); expect(mgr.create()).not.toBeNull();
    expect(mgr.create()).toBeNull();
    expect(mgr.sweep(Date.now() + 5000)).toBe(3);
    expect(mgr.rooms.size).toBe(0);
  });

  it('a seat is bound to its secret: same secret replaces, a new secret is refused when full', () => {
    const m = new RoomManager({ cfg: { ...MATCH }, maxRooms: 3, ttlMs: 1000 });
    const room = m.create()!;
    const mk = () => { const closed: number[] = []; return { s: { send() {}, close: (c?: number) => { closed.push(c ?? 0); }, bufferedAmount: 0 }, closed }; };
    const a = mk(), a2 = mk(), b = mk(), c = mk();
    expect(room.join('A'.repeat(24), 'A', a.s)).toEqual({ ok: true, slot: 0 });
    expect(room.join('B'.repeat(24), 'B', b.s)).toEqual({ ok: true, slot: 1 });
    expect(room.join('A'.repeat(24), 'A', a2.s)).toEqual({ ok: true, slot: 0 });
    expect(a.closed).toContain(4001);
    const r = room.join('C'.repeat(24), 'C', c.s);
    expect(r.ok).toBe(false);
    // stale socket close must not detach the new connection
    room.detach(0, a.s);
    expect(room.slots[0]!.socket).toBe(a2.s);
    expect(room.connectedCount).toBe(2);
  });
});

describe('rate limiter', () => {
  it('token bucket allows bursts then throttles', () => {
    const b = new Bucket(5, 1);
    const t = Date.now();
    let ok = 0;
    for (let i = 0; i < 20; i++) if (b.take(1, t)) ok++;
    expect(ok).toBe(5);
    expect(b.take(1, t + 2000)).toBe(true);
  });
});
