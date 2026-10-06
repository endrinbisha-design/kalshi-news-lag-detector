import { describe, expect, it } from 'vitest';
import { BTN, MOVE, PLAYER, WEAPONS } from '../src/shared/config';
import { MAP, toX, toZ, H } from '../src/shared/map';
import { computeDamage, rayBody } from '../src/shared/hit';
import { currentSpread, stepPlayer } from '../src/shared/player';
import { cmd, newPlayer, run, world } from './helpers';

const speed = (p: { vx: number; vz: number }) => Math.hypot(p.vx, p.vz);

describe('map & spawns', () => {
  it('spawns are mirrored and standing on solid ground', () => {
    const [a, b] = MAP.spawns;
    expect(a.x).toBeCloseTo(-b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    for (const s of MAP.spawns) {
      expect(world.groundHeight(s.x, s.z, PLAYER.radius, 0.1).h).toBeCloseTo(0, 5);
      const o = { x: s.x, z: s.z };
      const hit = world.resolveCircle(o, PLAYER.radius, 0, PLAYER.height, 0.5, { nx: 0, nz: 0 });
      expect(hit).toBe(false);
    }
  });

  it('layout is left/right and top/bottom symmetric in solid volume', () => {
    // every obstacle above step height has a mirror partner (within tolerance), except the car/crate pair which is point-symmetric
    const solid = world.boxes.filter((b) => b.y1 - b.y0 > 0.6 && b.style !== 'courtyard');
    for (const b of solid) {
      const partner = solid.find((o) => Math.abs(o.cx + b.cx) < 0.9 && Math.abs(o.hx * o.hz - b.hx * b.hz) < 0.8 && Math.abs(o.cz - b.cz) < 0.9 || (Math.abs(o.cx + b.cx) < 0.9 && Math.abs(o.cz + b.cz) < 0.9));
      expect(partner, `box ${b.id} ${b.style} lacks a mirror`).toBeTruthy();
    }
  });
});

describe('movement', () => {
  it('accelerates to weapon speed and stops quickly with counter-strafe', () => {
    const p = newPlayer(toX(330), toZ(300), 0, -Math.PI / 2);
    run(p, 75, BTN.FWD, -Math.PI / 2); // run forward 1.25 s (yaw -90deg => +X)
    const max = MOVE.baseSpeed * WEAPONS.ak47.moveSpeed;
    expect(speed(p)).toBeGreaterThan(max * 0.97);
    expect(speed(p)).toBeLessThanOrEqual(max + 1e-6);

    // release keys: friction stop
    const q = { ...p, wids: [...p.wids], ammo: [...p.ammo], reserve: [...p.reserve] } as typeof p;
    let tFriction = 0;
    while (speed(q) > MOVE.accurateSpeedFrac * max && tFriction < 120) { run(q, 1, 0, -Math.PI / 2); tFriction++; }
    // counter-strafe: press opposite key
    let tCounter = 0;
    const r = { ...p, wids: [...p.wids], ammo: [...p.ammo], reserve: [...p.reserve] } as typeof p;
    while (speed(r) > MOVE.accurateSpeedFrac * max && tCounter < 120) { run(r, 1, BTN.BACK, -Math.PI / 2); tCounter++; }
    expect(tCounter).toBeLessThan(tFriction);
    expect(tCounter).toBeLessThanOrEqual(9); // <= 150 ms to be accurate again
    expect(tFriction).toBeLessThanOrEqual(14);
  });

  it('is deterministic: identical inputs produce identical state', () => {
    const a = newPlayer(toX(330), toZ(300)), b = newPlayer(toX(330), toZ(300));
    for (let i = 0; i < 300; i++) {
      const c = cmd((i % 90 < 45 ? BTN.FWD : BTN.LEFT) | (i % 100 === 0 ? BTN.JUMP : 0) | (i % 7 === 0 ? BTN.FIRE : 0), i * 0.01, 0);
      stepPlayer(a, c, world, { frozen: false }, []);
      stepPlayer(b, c, world, { frozen: false }, []);
    }
    expect(a).toEqual(b);
  });

  it('jumping reaches ~0.77 m and cannot mount 1 m crates; crouch shrinks speed', () => {
    const p = newPlayer(toX(330), toZ(300));
    let top = 0;
    run(p, 1, BTN.JUMP);
    for (let i = 0; i < 60; i++) { run(p, 1, 0); top = Math.max(top, p.y); }
    expect(top).toBeGreaterThan(0.7); expect(top).toBeLessThan(0.85);
    expect(p.ground).toBe(1);

    const c = newPlayer(toX(330), toZ(300), 0, -Math.PI / 2);
    run(c, 90, BTN.FWD | BTN.CROUCH, -Math.PI / 2);
    expect(speed(c)).toBeLessThan(MOVE.baseSpeed * WEAPONS.ak47.moveSpeed * 0.4);
    const w = newPlayer(toX(330), toZ(300), 0, -Math.PI / 2);
    run(w, 90, BTN.FWD | BTN.WALK, -Math.PI / 2);
    expect(speed(w)).toBeCloseTo(MOVE.baseSpeed * WEAPONS.ak47.moveSpeed * MOVE.walkMult, 1);
  });

  it('no autobhop: holding jump only jumps once', () => {
    const p = newPlayer(toX(330), toZ(300));
    let jumps = 0;
    const ev: any[] = [];
    run(p, 200, BTN.JUMP, 0, 0, ev);
    jumps = ev.filter((e) => e.k === 'jump').length;
    expect(jumps).toBe(1);
  });

  it('walks up and down stairs without getting stuck, into the lane and the pit', () => {
    // top-left stairs: from the courtyard (x=-8.9) heading +X at z=-6.4 up to the lane (y=0.72)
    const up = newPlayer(toX(560), toZ(230), 0, -Math.PI / 2);
    run(up, 150, BTN.FWD, -Math.PI / 2);
    expect(up.y).toBeCloseTo(H.alcove, 2);
    expect(up.x).toBeGreaterThan(toX(700));
    // pit stairs from centre line
    const pit = newPlayer(toX(560), toZ(476), 0, -Math.PI / 2);
    run(pit, 150, BTN.FWD, -Math.PI / 2);
    expect(pit.y).toBeCloseTo(H.pit, 2);
    expect(pit.x).toBeGreaterThan(toX(700));
    // and back up (re-centre on the gate first: the car deflected us sideways)
    pit.x = toX(760); pit.z = toZ(476);
    run(pit, 400, BTN.BACK, -Math.PI / 2);
    expect(pit.y).toBeCloseTo(0, 2);
  });

  it('cannot walk through crates, walls or the car; cannot climb 1.4 m crates', () => {
    // run along +X at z through the middle crate cluster
    const p = newPlayer(toX(430), toZ(478), 0, -Math.PI / 2);
    run(p, 120, BTN.FWD, -Math.PI / 2);
    expect(p.x).toBeLessThan(toX(484 - 40));
    // jump spam against it doesn't mount it
    run(p, 120, BTN.FWD | BTN.JUMP, -Math.PI / 2);
    expect(p.y).toBeLessThan(0.05);
    // run into outer wall
    const w = newPlayer(toX(300), toZ(476), 0, Math.PI / 2);
    run(w, 200, BTN.FWD, Math.PI / 2);
    expect(w.x).toBeGreaterThan(toX(245) - 0.01);
    // car
    const car = newPlayer(toX(760), toZ(480), H.pit, -Math.PI / 2);
    car.y = H.pit;
    run(car, 200, BTN.FWD, -Math.PI / 2);
    expect(Math.hypot(car.x - toX(933), car.z - toZ(483))).toBeGreaterThan(1.0);
  });

  it('players cannot leave the arena or get trapped by any wall slide (fuzz)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const s of MAP.spawns) {
      const p = newPlayer(s.x, s.z, 0, s.yaw);
      let yaw = s.yaw;
      for (let i = 0; i < 6000; i++) {
        if (i % 40 === 0) yaw = rnd() * 6.28;
        const b = (rnd() < 0.8 ? BTN.FWD : 0) | (rnd() < 0.2 ? BTN.LEFT : 0) | (rnd() < 0.2 ? BTN.RIGHT : 0) | (rnd() < 0.03 ? BTN.JUMP : 0) | (rnd() < 0.2 ? BTN.CROUCH : 0);
        run(p, 1, b, yaw);
        expect(p.x).toBeGreaterThan(MAP.bounds.minX - 1e-6);
        expect(p.x).toBeLessThan(MAP.bounds.maxX + 1e-6);
        expect(p.y).toBeGreaterThan(H.pit - 0.01);
        expect(p.y).toBeLessThan(H.alcove + 0.8);
        // never embedded in a solid
        const o = { x: p.x, z: p.z };
        const embedded = world.resolveCircle(o, PLAYER.radius - 0.02, p.y, PLAYER.height, p.y + PLAYER.stepHeight, { nx: 0, nz: 0 });
        expect(embedded).toBe(false);
      }
    }
  });
});

describe('weapons', () => {
  it('fire rate, ammo and reload obey the config', () => {
    const p = newPlayer(0, 0, 0, 0, 'm4a4');
    p.switchT = 0;
    const ev: any[] = [];
    run(p, 60, BTN.FIRE, 0, 0, ev); // hold fire for 1 s
    const shots = ev.filter((e) => e.k === 'shot').length;
    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(12); // 666 rpm = ~11.1/s
    expect(p.ammo[0]).toBe(30 - shots);
    run(p, 1, BTN.RELOAD, 0, 0, ev);
    expect(p.reloadT).toBeGreaterThan(0);
    run(p, Math.ceil(WEAPONS.m4a4.reloadTime * 60) + 2, 0, 0, 0, ev);
    expect(p.ammo[0]).toBe(30);
    expect(p.reserve[0]).toBe(90 - shots);
  });

  it('semi-automatic weapons need a click per shot; AWP bolt cycle is slow', () => {
    const p = newPlayer(0, 0, 0, 0, 'awp');
    p.switchT = 0;
    const ev: any[] = [];
    run(p, 120, BTN.FIRE, 0, 0, ev);
    expect(ev.filter((e) => e.k === 'shot').length).toBe(1);
    const q = newPlayer(0, 0, 0, 0, 'awp'); q.switchT = 0;
    const ev2: any[] = [];
    for (let i = 0; i < 200; i++) run(q, 1, i % 2 ? BTN.FIRE : 0, 0, 0, ev2);
    expect(ev2.filter((e) => e.k === 'shot').length).toBeLessThanOrEqual(3);
  });

  it('recoil pattern climbs and recovers; moving/jumping widens spread, crouching tightens it', () => {
    const p = newPlayer(0, 0, 0, 0, 'ak47'); p.switchT = 0;
    run(p, 30, BTN.FIRE);
    expect(p.punchPitch).toBeGreaterThan(2);
    run(p, 120, 0);
    expect(p.punchPitch).toBeLessThan(0.01);

    const still = newPlayer(0, 0); still.switchT = 0;
    const crouched = newPlayer(0, 0); crouched.crouch = 1;
    const moving = newPlayer(0, 0); moving.vx = 5;
    const air = newPlayer(0, 0); air.ground = 0;
    expect(currentSpread(crouched)).toBeLessThan(currentSpread(still));
    expect(currentSpread(moving)).toBeGreaterThan(currentSpread(still) * 5);
    expect(currentSpread(air)).toBeGreaterThan(currentSpread(moving) * 0.99 - 3);
  });

  it('bullet spread is deterministic for a given seed and shot counter', () => {
    const a = newPlayer(0, 0), b = newPlayer(0, 0);
    a.switchT = b.switchT = 0;
    const ea: any[] = [], eb: any[] = [];
    run(a, 20, BTN.FIRE, 0.3, 0.1, ea); run(b, 20, BTN.FIRE, 0.3, 0.1, eb);
    expect(ea).toEqual(eb);
  });

  it('damage model: head x4, legs x0.75, armor absorbs, falloff by distance', () => {
    const ak = WEAPONS.ak47;
    expect(computeDamage(ak, 'chest', 0, 0).health).toBe(36);
    expect(computeDamage(ak, 'head', 0, 0).health).toBe(144);
    expect(computeDamage(ak, 'leg', 0, 0).health).toBe(27);
    const armored = computeDamage(ak, 'chest', 0, 100);
    expect(armored.health).toBe(Math.round(36 * ak.armorPen));
    expect(armored.armor).toBeGreaterThan(0);
    expect(computeDamage(ak, 'leg', 0, 100).armor).toBe(0);
    expect(computeDamage(WEAPONS.mp5, 'chest', 40, 0).health).toBeLessThan(computeDamage(WEAPONS.mp5, 'chest', 0, 0).health - 6);
    expect(computeDamage(WEAPONS.awp, 'chest', 20, 100).health).toBeGreaterThanOrEqual(100);
    expect(computeDamage(WEAPONS.deagle, 'head', 0, 100).health).toBeGreaterThanOrEqual(100);
  });
});

describe('hit regions & world raycasts', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, crouch: 0 };
  it('classifies head, chest, stomach, legs, arms from the front', () => {
    const shoot = (y: number, x = 0) => rayBody(pose, x, y, -5, 0, 0, 1, 20)?.region;
    expect(shoot(1.66)).toBe('head');
    expect(shoot(1.3)).toBe('chest');
    expect(shoot(1.0)).toBe('stomach');
    expect(shoot(0.4)).toBe('leg');
    expect(shoot(1.2, 0.3)).toBe('arm');
    expect(shoot(1.0, 0.8)).toBeUndefined();
  });
  it('crouching lowers the head hitbox', () => {
    const c = { ...pose, crouch: 1 };
    expect(rayBody(c, 0, 1.66, -5, 0, 0, 1, 20)).toBeNull();
    expect(rayBody(c, 0, 1.23, -5, 0, 0, 1, 20)?.region).toBe('head');
  });
  it('hit boxes follow body yaw', () => {
    // body facing +X (yaw -90deg): arms (which extend forward) are in front along +X
    const side = { x: 0, y: 0, z: 0, yaw: -Math.PI / 2, crouch: 0 };
    expect(rayBody(side, 5, 1.3, 0.3, -1, 0, 0, 20)?.region).toBe('arm');
  });
  it('walls, crates and the car block the line of sight; floors can be shot', () => {
    // across the pit through the car
    const a = [toX(700), H.pit + 0.7, toZ(540)], b = [toX(1150), H.pit + 0.7, toZ(430)];
    expect(world.lineOfSight(a[0], a[1], a[2], b[0], b[1], b[2])).toBe(false);
    // through perimeter wall
    expect(world.lineOfSight(toX(300), 1.5, toZ(476), toX(150), 1.5, toZ(476))).toBe(false);
    // clear shot along an empty courtyard
    expect(world.lineOfSight(toX(300), 1.6, toZ(300), toX(560), 1.6, toZ(300))).toBe(true);
    // spawn to spawn: the central crate stack blocks the straight line
    const [s0, s1] = MAP.spawns;
    expect(world.lineOfSight(s0.x, 1.62, s0.z, s1.x, 1.62, s1.z)).toBe(false);
    // shooting straight down hits the floor material
    const hit = world.raycast(toX(330), 1.6, toZ(300), 0, -1, 0, 5);
    expect(hit?.mat).toBe('pavers');
    // rim wall between the lane and the pit blocks shots (high ray from the lane toward the pit)
    expect(world.lineOfSight(toX(800), H.alcove + 1.62, toZ(250), toX(800), H.pit + 1.62, toZ(480))).toBe(false);
  });
});
