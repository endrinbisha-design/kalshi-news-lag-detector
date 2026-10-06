import { describe, expect, it } from 'vitest';
import { BTN, MatchConfig, NET } from '../src/shared/config';
import { MatchSim } from '../src/shared/match';
import { eyeHeight } from '../src/shared/player';
import { Cmd } from '../src/shared/player';

const cfg: MatchConfig = { winRounds: 3, prepSeconds: 1, roundSeconds: 5, roundEndSeconds: 1, reconnectGraceSeconds: 4 };

function mk() {
  const out: { slot: number; msg: any }[] = [];
  const sim = new MatchSim({ config: cfg, mode: 'duel', emit: (slot, msg) => out.push({ slot, msg }), randomSeed: () => 0.5 });
  let seq = [0, 0];
  const events = (slot: number) => out.filter((o) => o.slot === slot && o.msg.t === 'ev').flatMap((o) => o.msg.e as any[]);
  /** Advance time; players without a queued command send an idle one each tick (like a real client at 60 Hz). */
  const run = (secs: number, fn?: () => void) => {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      fn?.();
      for (const slot of [0, 1]) {
        const p = sim.players[slot];
        if (p.connected && p.state && p.queue.length === 0) send(slot, 0, p.state.yaw, p.state.pitch);
      }
      sim.step();
    }
  };
  /** queue one cmd for slot */
  const send = (slot: number, buttons: number, yaw: number, pitch = 0, slotReq = -1, rt = 0) => {
    const c: Cmd = { seq: ++seq[slot], buttons, yaw, pitch, slot: slotReq, rt };
    sim.input(slot, sim.players[slot].epoch, [c]);
  };
  return { sim, out, events, run, send };
}

/** Put the two players in a clear line in the left courtyard so shots land. */
function arrange(sim: MatchSim) {
  const a = sim.players[0].state!, b = sim.players[1].state!;
  a.x = -14; a.z = -4.5; a.y = 0; b.x = -9.5; b.z = -4.5; b.y = 0; // open ground, +X direction
  if (!sim.world.lineOfSight(a.x, 1.5, a.z, b.x, 1.5, b.z)) throw new Error('arrange(): no line of sight');
  a.yaw = -Math.PI / 2; b.yaw = Math.PI / 2;
}
const aim = (from: any, to: any) => {
  const dx = to.x - from.x, dz = to.z - from.z;
  const dy = (to.y + 1.25) - (from.y + eyeHeight(from.crouch));
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
};

describe('match flow', () => {
  it('waits for two players, then prep -> live; sides alternate between rounds', () => {
    const { sim, run } = mk();
    sim.connect(0, 'A');
    expect(sim.phase).toBe('waiting');
    sim.connect(1, 'B');
    expect(sim.phase).toBe('prep');
    const firstSide = sim.players[0].state!.x;
    expect(Math.sign(sim.players[0].state!.x)).toBe(-Math.sign(sim.players[1].state!.x));
    run(1.1);
    expect(sim.phase).toBe('live');
    // timeout => draw, no point, new prep with flipped side
    run(5.2);
    expect(sim.phase).toBe('roundEnd');
    expect(sim.players[0].score + sim.players[1].score).toBe(0);
    run(1.1);
    expect(sim.phase).toBe('prep');
    expect(Math.sign(sim.players[0].state!.x)).toBe(-Math.sign(firstSide));
  });

  it('players are frozen during prep and cannot fire; both are at full health/armor', () => {
    const { sim, run, send } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    const x0 = sim.players[0].state!.x;
    for (let i = 0; i < 30; i++) { send(0, BTN.FWD | BTN.FIRE, -Math.PI / 2); sim.step(); }
    expect(sim.players[0].state!.x).toBeCloseTo(x0, 5);
    expect(sim.players[0].state!.hp).toBe(100);
    expect(sim.players[0].state!.armor).toBe(100);
    void run;
  });

  it('server validates a kill: AWP body shot kills, score increments, round ends, next round starts', () => {
    const { sim, run, send, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    sim.setLoadout(0, { primary: 'awp', pistol: 'glock' });
    run(1.1);
    expect(sim.phase).toBe('live');
    arrange(sim);
    run(1.5); // let the awp deploy (draw time 1.25)
    const a = sim.players[0].state!, b = sim.players[1].state!;
    const { yaw, pitch } = aim(a, b);
    // spread when standing still with the AWP unscoped is large -> scope in first (SCOPE bit then hold)
    send(0, BTN.SCOPE, yaw, pitch); sim.step();
    for (let i = 0; i < 20; i++) { send(0, 0, yaw, pitch); sim.step(); }
    send(0, BTN.FIRE, yaw, pitch);
    run(0.2);
    const hits = events(0).filter((e) => e.k === 'hit');
    expect(hits.length).toBe(1);
    expect(hits[0].by).toBe(0);
    expect(hits[0].kill).toBe(1);
    expect(sim.phase).toBe('roundEnd');
    expect(sim.players[0].score).toBe(1);
    expect(sim.players[0].kills).toBe(1);
    expect(sim.players[1].deaths).toBe(1);
    run(1.1);
    expect(sim.phase).toBe('prep');
    expect(sim.round).toBe(2);
    expect(sim.players[1].state!.alive).toBe(1);
    expect(sim.players[1].state!.hp).toBe(100);
  });

  it('walls block shots (no damage through the perimeter wall / crate)', () => {
    const { sim, run, send, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    run(1.1);
    const a = sim.players[0].state!, b = sim.players[1].state!;
    // attacker in the courtyard, victim behind the left perimeter wall (outside the arena, y at floor)
    a.x = -14; a.z = -2; b.x = -22; b.z = -2; // x<-17 is inside/behind the wall
    run(0.6);
    const { yaw, pitch } = aim(a, b);
    for (let i = 0; i < 20; i++) { send(0, BTN.FIRE, yaw, pitch); sim.step(); }
    expect(events(0).filter((e) => e.k === 'hit').length).toBe(0);
    expect(b.hp).toBe(100);
  });

  it('timeout is a draw: no point, round restarts', () => {
    const { sim, run, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    run(1.1 + 5.2);
    const r = events(0).find((e) => e.k === 'round');
    expect(r.winner).toBe(-1);
    expect(r.reason).toBe('timeout');
    expect(sim.players[0].score).toBe(0);
  });

  it('simultaneous kills in one tick produce a draw (trade)', () => {
    const { sim, run, send, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    sim.setLoadout(0, { primary: 'ak47', pistol: 'deagle' });
    sim.setLoadout(1, { primary: 'ak47', pistol: 'deagle' });
    run(1.1);
    arrange(sim);
    run(1.2);
    const a = sim.players[0].state!, b = sim.players[1].state!;
    a.hp = 20; b.hp = 20; a.armor = 0; b.armor = 0;
    // both fire on the same tick
    const aa = aim(a, b), bb = aim(b, a);
    send(0, BTN.FIRE, aa.yaw, aa.pitch); send(1, BTN.FIRE, bb.yaw, bb.pitch);
    sim.step();
    expect(a.alive + b.alive).toBe(0);
    run(0.1);
    const r = events(0).find((e) => e.k === 'round');
    expect(r.winner).toBe(-1);
    expect(r.reason).toBe('double');
    expect(sim.players[0].score + sim.players[1].score).toBe(0);
  });

  it('first to N wins the match; rematch needs both players and resets the score', () => {
    const { sim, run, send, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    sim.setLoadout(0, { primary: 'awp', pistol: 'deagle' });
    for (let r = 0; r < 3; r++) {
      expect(sim.phase).toBe('prep');
      run(1.1);
      arrange(sim);
      // use the pistol (deagle) headshot-free body shots: 2 shots; set victim hp low for speed
      sim.players[1].state!.hp = 10;
      sim.players[0].state!.weapon = 1; sim.players[0].state!.switchT = 0;
      run(0.1);
      const a = sim.players[0].state!, b = sim.players[1].state!;
      const { yaw, pitch } = aim(a, b);
      send(0, 0, yaw, pitch); run(0.4);
      send(0, BTN.FIRE, yaw, pitch);
      run(0.2);
      expect(sim.players[0].score).toBe(r + 1);
      run(1.1);
    }
    expect(sim.phase).toBe('matchEnd');
    expect(sim.roomInfo(0).winner).toBe(0);
    sim.voteRematch(0);
    expect(sim.phase).toBe('matchEnd');
    sim.voteRematch(0); // double vote from the same player does not start it
    expect(sim.phase).toBe('matchEnd');
    sim.voteRematch(1);
    expect(sim.phase).toBe('prep');
    expect(sim.players[0].score + sim.players[1].score).toBe(0);
    expect(sim.round).toBe(1);
    void events;
  });

  it('disconnect pauses, reconnect restarts the round without duplicates or score change; grace expiry resets', () => {
    const { sim, run } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    run(1.1);
    expect(sim.phase).toBe('live');
    sim.players[0].score = 1;
    sim.disconnect(1);
    expect(sim.phase).toBe('paused');
    run(1);
    sim.connect(1, 'B');
    expect(sim.phase).toBe('prep');
    expect(sim.players[0].score).toBe(1);
    expect(sim.players.filter((p) => p.connected).length).toBe(2);
    // never returns
    run(1.1);
    sim.disconnect(0);
    run(cfg.reconnectGraceSeconds + 0.5);
    expect(sim.phase).toBe('waiting');
    expect(sim.players[1].score).toBe(0);
  });
});

describe('lag compensation', () => {
  it('rewinds the victim to the shooter\'s view time, bounded by lagCompMaxMs', () => {
    const { sim, run, send, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    sim.setLoadout(0, { primary: 'ak47', pistol: 'glock' });
    run(1.1);
    arrange(sim);
    run(1.2);
    const a = sim.players[0].state!, b = sim.players[1].state!;
    const spot = { x: b.x, y: b.y, z: b.z, crouch: 0 };
    // victim strafes away over 200 ms; the shooter aims at the old position with an old render time
    const tOld = sim.timeMs;
    for (let i = 0; i < 12; i++) { b.x = spot.x; b.z = spot.z - 0.15 * i; sim.step(); }
    const aimed = aim(a, spot as any);
    // fire with rt = tOld (200 ms in the past: inside the bound) -> hit
    send(0, BTN.FIRE, aimed.yaw, aimed.pitch, -1, tOld);
    sim.step();
    expect(events(0).filter((e) => e.k === 'hit').length).toBe(1);
  });

  it('a stale render time beyond the bound is clamped (no hit on a position older than 250 ms)', () => {
    const { sim, run, send, events } = mk();
    sim.connect(0, 'A'); sim.connect(1, 'B');
    run(1.1);
    arrange(sim);
    run(1.2);
    const a = sim.players[0].state!, b = sim.players[1].state!;
    const spot = { x: b.x, y: b.y, z: b.z, crouch: 0 };
    const tOld = sim.timeMs;
    for (let i = 0; i < 60; i++) { b.x = spot.x; b.z = spot.z - 0.05 * i; sim.step(); } // 1 s of movement, ends 3 m away
    const aimed = aim(a, spot as any);
    send(0, BTN.FIRE, aimed.yaw, aimed.pitch, -1, tOld);
    sim.step();
    expect(events(0).filter((e) => e.k === 'hit').length).toBe(0);
    expect(NET.lagCompMaxMs).toBeLessThanOrEqual(250);
  });
});
