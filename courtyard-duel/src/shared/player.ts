import { BTN, DT, MOVE, PLAYER, WEAPONS, WeaponId, Loadout, weaponCooldown } from './config';
import { DEG, TAU, clamp, forwardVec, hash01, lerp, wrapAngle } from './math';
import { Mat, SpawnPoint } from './map';
import { AIR_EPSILON, World } from './world';

/** One input sample, produced at a fixed 60 Hz by the client and consumed identically by client prediction and server. */
export interface Cmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  /** Requested weapon slot, or -1. */
  slot: number;
  /** Server-time (ms) of the world the shooter was looking at (for lag compensation). */
  rt: number;
}

/** Fully serialisable simulation state of a single player (also what the server snapshots to its owner). */
export interface PlayerState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  ground: number;
  crouch: number;
  jumpHeld: number;
  yaw: number; pitch: number;
  hp: number; armor: number; alive: number;
  weapon: number; // active slot
  wids: [WeaponId, WeaponId];
  ammo: [number, number];
  reserve: [number, number];
  cooldown: number;
  reloadT: number;
  switchT: number;
  fireHeld: number;
  zoom: number;
  shotIdx: number;
  lastShotAge: number;
  punchYaw: number; punchPitch: number; // degrees
  spreadAcc: number;
  shotCounter: number;
  seed: number;
  stepAcc: number;
}

export type SimEvent =
  | { k: 'shot'; w: WeaponId; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; n: number }
  | { k: 'dry' }
  | { k: 'reload'; w: WeaponId }
  | { k: 'reloadDone' }
  | { k: 'switch'; slot: number }
  | { k: 'step'; surf: Mat }
  | { k: 'jump' }
  | { k: 'land'; speed: number; surf: Mat };

export function createPlayerState(spawn: SpawnPoint, loadout: Loadout, seed: number): PlayerState {
  const wids: [WeaponId, WeaponId] = [loadout.primary, loadout.pistol];
  return {
    x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, ground: 1, crouch: 0, jumpHeld: 0,
    yaw: spawn.yaw, pitch: 0,
    hp: PLAYER.maxHealth, armor: PLAYER.maxArmor, alive: 1,
    weapon: 0, wids,
    ammo: [WEAPONS[wids[0]].magSize, WEAPONS[wids[1]].magSize],
    reserve: [WEAPONS[wids[0]].reserve, WEAPONS[wids[1]].reserve],
    cooldown: 0, reloadT: 0, switchT: WEAPONS[wids[0]].drawTime * 0.5, fireHeld: 0, zoom: 0,
    shotIdx: 0, lastShotAge: 99, punchYaw: 0, punchPitch: 0, spreadAcc: 0, shotCounter: 0, seed: seed >>> 0, stepAcc: 0,
  };
}

export const eyeHeight = (crouch: number): number => lerp(PLAYER.eye, PLAYER.crouchEye, crouch);
export const bodyHeight = (crouch: number): number => lerp(PLAYER.height, PLAYER.crouchHeight, crouch);
export const currentWeapon = (p: PlayerState) => WEAPONS[p.wids[p.weapon]];

export interface StepOptions {
  /** Freeze movement (preparation phase); view angles and weapon selection still work. */
  frozen: boolean;
}

const MAX_PITCH = 89 * DEG;
const tmpPos = { x: 0, z: 0 };
const tmpN = { nx: 0, nz: 0 };

/** Advance one player by exactly one tick (DT). Pure function of (state, cmd, world, options). */
export function stepPlayer(p: PlayerState, cmd: Cmd, world: World, opts: StepOptions, events: SimEvent[]): void {
  p.yaw = wrapAngle(cmd.yaw);
  p.pitch = clamp(cmd.pitch, -MAX_PITCH, MAX_PITCH);
  const b = cmd.buttons;
  const def = currentWeapon(p);

  // ---------------------------------------------------------------- stance
  const wantCrouch = (b & BTN.CROUCH) !== 0;
  p.crouch = clamp(p.crouch + (wantCrouch ? DT : -DT) / PLAYER.crouchTime, 0, 1);

  if (opts.frozen) {
    p.vx = 0; p.vz = 0;
  } else {
    moveStep(p, b, def.moveSpeed, def.scope && p.zoom > 0 ? def.scope.moveMult : 1, world, events);
  }

  stepWeapon(p, cmd, def, events);
}

function moveStep(p: PlayerState, b: number, weaponSpeed: number, scopeMult: number, world: World, events: SimEvent[]) {
  let maxSpeed = MOVE.baseSpeed * weaponSpeed * scopeMult;
  if (b & BTN.WALK) maxSpeed *= MOVE.walkMult;
  maxSpeed *= lerp(1, MOVE.crouchMult, p.crouch);

  const fwd = (b & BTN.FWD ? 1 : 0) - (b & BTN.BACK ? 1 : 0);
  const side = (b & BTN.RIGHT ? 1 : 0) - (b & BTN.LEFT ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = fwd * -sy + side * cy;
  let wz = fwd * -cy + side * -sy;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const wishSpeed = wl > 0 ? maxSpeed : 0;

  // ---------------------------------------------------------------- jump
  let grounded = p.ground === 1;
  const jumpPressed = (b & BTN.JUMP) !== 0;
  if (jumpPressed && grounded && !p.jumpHeld) {
    p.vy = MOVE.jumpSpeed;
    grounded = false;
    p.ground = 0;
    events.push({ k: 'jump' });
  }
  p.jumpHeld = jumpPressed ? 1 : 0;

  // ---------------------------------------------------------------- horizontal velocity
  if (grounded) {
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > 0) {
      const drop = Math.max(speed, MOVE.stopSpeed) * MOVE.friction * DT;
      const ns = Math.max(0, speed - drop) / speed;
      p.vx *= ns; p.vz *= ns;
    }
    if (wishSpeed > 0) {
      const cur = p.vx * wx + p.vz * wz;
      const add = wishSpeed - cur;
      if (add > 0) {
        const a = Math.min(add, MOVE.accel * DT * wishSpeed);
        p.vx += wx * a; p.vz += wz * a;
      }
    }
  } else if (wishSpeed > 0) {
    const capped = Math.min(wishSpeed, MOVE.airWishCap);
    const cur = p.vx * wx + p.vz * wz;
    const add = capped - cur;
    if (add > 0) {
      const a = Math.min(add, MOVE.airAccel * DT * wishSpeed);
      p.vx += wx * a; p.vz += wz * a;
    }
  }
  // Never exceed a sane maximum (guards against numerical growth).
  const hs = Math.hypot(p.vx, p.vz);
  const hardCap = MOVE.baseSpeed * 1.15;
  if (hs > hardCap) { p.vx *= hardCap / hs; p.vz *= hardCap / hs; }

  // ---------------------------------------------------------------- horizontal move + collision
  const height = bodyHeight(p.crouch);
  const cap = grounded ? p.y + PLAYER.stepHeight : p.y + AIR_EPSILON;
  tmpPos.x = p.x + p.vx * DT;
  tmpPos.z = p.z + p.vz * DT;
  if (world.resolveCircle(tmpPos, PLAYER.radius, p.y, height, cap, tmpN)) {
    const nl = Math.hypot(tmpN.nx, tmpN.nz);
    if (nl > 1e-6) {
      const nx = tmpN.nx / nl, nz = tmpN.nz / nl;
      const vn = p.vx * nx + p.vz * nz;
      if (vn < 0) { p.vx -= nx * vn; p.vz -= nz * vn; }
    }
  }
  const bd = world.map.bounds;
  p.x = clamp(tmpPos.x, bd.minX, bd.maxX);
  p.z = clamp(tmpPos.z, bd.minZ, bd.maxZ);

  // ---------------------------------------------------------------- vertical
  if (grounded) {
    const g = world.groundHeight(p.x, p.z, PLAYER.radius, p.y + PLAYER.stepHeight + 1e-3);
    if (g.h > -Infinity && g.h >= p.y - PLAYER.stepHeight - 1e-3) {
      p.y = g.h; p.vy = 0;
    } else {
      p.ground = 0; // walked off an edge
    }
  }
  if (p.ground === 0) {
    const prevY = p.y;
    p.vy -= MOVE.gravity * DT;
    const newY = prevY + p.vy * DT;
    if (p.vy <= 0) {
      const g = world.groundHeight(p.x, p.z, PLAYER.radius, prevY + AIR_EPSILON);
      if (newY <= g.h) {
        const impact = -p.vy;
        p.y = g.h; p.vy = 0; p.ground = 1;
        if (impact > MOVE.landEventSpeed) events.push({ k: 'land', speed: impact, surf: g.mat ?? 'stone' });
      } else p.y = newY;
    } else p.y = newY;
  }

  // ---------------------------------------------------------------- footsteps (walking/crouching is silent)
  const speed = Math.hypot(p.vx, p.vz);
  if (p.ground === 1 && speed > 1.2) {
    p.stepAcc += speed * DT;
    if (p.stepAcc >= MOVE.stepStride) {
      p.stepAcc -= MOVE.stepStride;
      if (!(b & BTN.WALK) && p.crouch < 0.5) events.push({ k: 'step', surf: world.surfaceAt(p.x, p.z, p.y) });
    }
  } else if (p.ground === 1) p.stepAcc = Math.min(p.stepAcc, MOVE.stepStride * 0.5);
}

/** Inaccuracy cone half-angle (degrees) for the current state. */
export function currentSpread(p: PlayerState): number {
  const def = currentWeapon(p);
  const s = def.spread;
  if (def.scope && p.zoom === 0 && s.unscoped !== undefined) return s.unscoped + p.spreadAcc;
  const max = MOVE.baseSpeed * def.moveSpeed;
  const speed = Math.hypot(p.vx, p.vz);
  const thresh = MOVE.accurateSpeedFrac * max;
  const moveF = clamp((speed - thresh) / (max - thresh), 0, 1);
  const still = lerp(s.stand, s.crouch, p.crouch);
  let spread = lerp(still, s.move, moveF);
  if (p.ground === 0) spread = Math.max(spread, s.air);
  return spread + p.spreadAcc;
}

function stepWeapon(p: PlayerState, cmd: Cmd, def: ReturnType<typeof currentWeapon>, events: SimEvent[]) {
  const b = cmd.buttons;
  p.cooldown = Math.max(0, p.cooldown - DT);
  p.lastShotAge += DT;
  p.spreadAcc = Math.max(0, p.spreadAcc - def.spreadDecay * DT);

  // recoil recovery
  if (p.lastShotAge > def.recoverDelay) {
    const mag = Math.hypot(p.punchYaw, p.punchPitch);
    if (mag > 0) {
      const rate = Math.max(def.recoverRate, mag * 3) * DT;
      if (mag <= rate) { p.punchYaw = 0; p.punchPitch = 0; }
      else { const k = (mag - rate) / mag; p.punchYaw *= k; p.punchPitch *= k; }
    }
  }

  // weapon switching
  if (cmd.slot === 0 || cmd.slot === 1) {
    if (cmd.slot !== p.weapon) {
      p.weapon = cmd.slot;
      const nd = currentWeapon(p);
      p.switchT = nd.drawTime;
      p.reloadT = 0;
      p.zoom = 0;
      events.push({ k: 'switch', slot: cmd.slot });
      def = nd;
    }
  }
  if (p.switchT > 0) p.switchT = Math.max(0, p.switchT - DT);

  // reload
  const slot = p.weapon;
  if (p.reloadT > 0) {
    p.reloadT -= DT;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      const take = Math.min(def.magSize - p.ammo[slot], p.reserve[slot]);
      p.ammo[slot] += take; p.reserve[slot] -= take;
      events.push({ k: 'reloadDone' });
    }
  } else if ((b & BTN.RELOAD) && p.switchT <= 0 && p.ammo[slot] < def.magSize && p.reserve[slot] > 0) {
    startReload(p, def, events);
  }

  // scope toggle
  if ((b & BTN.SCOPE) && def.scope && p.reloadT <= 0 && p.switchT <= 0) {
    p.zoom = (p.zoom + 1) % (def.scope.fovs.length + 1);
  }

  // an empty magazine reloads on its own (like holding the trigger on the last round)
  if (p.reloadT <= 0 && p.switchT <= 0 && p.ammo[slot] === 0 && p.reserve[slot] > 0) startReload(p, def, events);

  // fire
  const fireDown = (b & BTN.FIRE) !== 0;
  if (fireDown && p.switchT <= 0 && p.reloadT <= 0 && p.cooldown <= 0 && (def.auto || !p.fireHeld)) {
    if (p.ammo[slot] > 0) fireShot(p, def, events);
    else if (!p.fireHeld) {
      events.push({ k: 'dry' });
      if (p.reserve[slot] > 0) startReload(p, def, events);
    }
  }
  p.fireHeld = fireDown ? 1 : 0;
}

function startReload(p: PlayerState, def: ReturnType<typeof currentWeapon>, events: SimEvent[]) {
  p.reloadT = def.reloadTime;
  p.zoom = 0;
  events.push({ k: 'reload', w: def.id });
}

const fwdTmp: [number, number, number] = [0, 0, 0];

function fireShot(p: PlayerState, def: ReturnType<typeof currentWeapon>, events: SimEvent[]) {
  const slot = p.weapon;
  if (p.lastShotAge > def.recoilReset) p.shotIdx = 0;

  const spread = currentSpread(p) * DEG;
  const n = p.shotCounter++;
  const r = spread * Math.sqrt(hash01(p.seed, n, 1));
  const th = TAU * hash01(p.seed, n, 2);
  const yaw = p.yaw + p.punchYaw * DEG + (r * Math.cos(th)) / Math.max(0.2, Math.cos(p.pitch));
  const pitch = p.pitch + p.punchPitch * DEG + r * Math.sin(th);
  forwardVec(yaw, pitch, fwdTmp);
  events.push({
    k: 'shot', w: def.id,
    ox: p.x, oy: p.y + eyeHeight(p.crouch), oz: p.z,
    dx: fwdTmp[0], dy: fwdTmp[1], dz: fwdTmp[2], n,
  });

  p.ammo[slot]--;
  p.cooldown = weaponCooldown(def);
  p.lastShotAge = 0;
  const kick = def.recoil[Math.min(p.shotIdx, def.recoil.length - 1)];
  p.punchYaw += kick[0];
  p.punchPitch = Math.min(22, p.punchPitch + kick[1]);
  p.shotIdx++;
  p.spreadAcc = Math.min(def.spreadMax, p.spreadAcc + def.spreadPerShot);
  if (def.scope) p.zoom = 0; // bolt-action: unscope after every shot
}

export function cloneState(s: PlayerState): PlayerState {
  return { ...s, wids: [...s.wids] as [WeaponId, WeaponId], ammo: [...s.ammo] as [number, number], reserve: [...s.reserve] as [number, number] };
}

export function copyState(dst: PlayerState, src: PlayerState): void {
  const { wids, ammo, reserve, ...rest } = src;
  Object.assign(dst, rest);
  dst.wids = [wids[0], wids[1]];
  dst.ammo = [ammo[0], ammo[1]];
  dst.reserve = [reserve[0], reserve[1]];
}
