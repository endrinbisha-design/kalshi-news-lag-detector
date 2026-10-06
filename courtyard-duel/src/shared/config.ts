/**
 * Central configuration: tick rates, movement physics, match rules and every weapon stat.
 * Imported by BOTH the server (authority) and the client (prediction / HUD / audio / animation).
 * Units: metres, seconds, degrees (for spread/recoil), health points.
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // server sends a snapshot every N ticks (30 Hz)

// ---------------------------------------------------------------- player body
export const PLAYER = {
  radius: 0.3,
  height: 1.8,
  crouchHeight: 1.35,
  eye: 1.62,
  crouchEye: 1.2,
  crouchTime: 0.16, // seconds to fully crouch/uncrouch
  stepHeight: 0.5,
  maxHealth: 100,
  maxArmor: 100,
} as const;

// ---------------------------------------------------------------- movement (Source-like, no sprint)
export const MOVE = {
  baseSpeed: 5.8, // multiplied by the weapon's moveSpeed
  walkMult: 0.52, // shift-walk (silent, accurate)
  crouchMult: 0.34,
  accel: 6.5,
  airAccel: 12,
  airWishCap: 0.76, // m/s of wish-speed that counts while airborne (Source's 30 u/s)
  friction: 5.2,
  stopSpeed: 1.9,
  gravity: 22,
  jumpSpeed: 5.8, // apex ~0.77 m
  accurateSpeedFrac: 0.34, // below this fraction of max speed the shot is fully accurate
  fallKillY: -12,
  stepStride: 2.05, // metres per audible footstep
  landEventSpeed: 4.2,
} as const;

// ---------------------------------------------------------------- match rules (server may override via env)
export interface MatchConfig {
  winRounds: number;
  prepSeconds: number;
  roundSeconds: number;
  roundEndSeconds: number;
  reconnectGraceSeconds: number;
}
export const MATCH: MatchConfig = {
  winRounds: 10,
  prepSeconds: 10,
  roundSeconds: 90,
  roundEndSeconds: 4,
  reconnectGraceSeconds: 120,
};

// ---------------------------------------------------------------- networking
export const NET = {
  interpDelayMs: 100,
  lagCompMaxMs: 250, // maximum rewind for lag-compensated hits
  maxCmdsPerMessage: 12,
  maxQueuedCmds: 40,
  maxMessageBytes: 4096,
  historyMs: 1000,
  clientSendEvery: 2, // client batches inputs every N sim ticks (30 msg/s)
} as const;

// ---------------------------------------------------------------- damage model
export const HIT_MULT = { head: 4, chest: 1, stomach: 1.25, arm: 1, leg: 0.75 } as const;
export type HitRegion = keyof typeof HIT_MULT;
/** Regions protected by armor (legs are not). Head is protected because players wear a helmet. */
export const ARMORED: Record<HitRegion, boolean> = { head: true, chest: true, stomach: true, arm: true, leg: false };
export const ARMOR_ABSORB = 0.5;

// ---------------------------------------------------------------- weapons
export type WeaponId = 'ak47' | 'm4a4' | 'awp' | 'deagle' | 'glock' | 'mp5';
export type WeaponSlot = 0 | 1; // 0 = primary, 1 = pistol

export interface SfxParams {
  /** crack = bright transient, body = low thump, tail = room decay. All synthesised, no samples. */
  crackFreq: number; crackLevel: number; crackDecay: number;
  bodyFreq: number; bodyLevel: number; bodyDecay: number;
  tailLevel: number; tailDecay: number; tailLP: number;
  noiseLP: number;
  pitchJitter: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  auto: boolean;
  damage: number;
  /** Fraction of damage that reaches health when armored (rest is absorbed by armor). */
  armorPen: number;
  rpm: number;
  magSize: number;
  reserve: number;
  reloadTime: number;
  drawTime: number;
  /** Damage multiplier per `rangeUnit` metres travelled. */
  rangeMod: number;
  rangeUnit: number;
  maxRange: number;
  moveSpeed: number;
  /** Cone half-angles in degrees. */
  spread: { stand: number; crouch: number; move: number; air: number; unscoped?: number };
  spreadPerShot: number;
  spreadMax: number;
  spreadDecay: number; // deg/s
  /** Per-shot view kick [yaw, pitch] in degrees (positive pitch = up). Indexed by consecutive shot count. */
  recoil: [number, number][];
  recoverDelay: number;
  recoverRate: number; // deg/s
  recoilReset: number; // seconds without firing before the pattern restarts
  scope?: { fovs: number[]; moveMult: number };
  tracerColor: number;
  sfx: SfxParams;
}

const rep = (v: [number, number], n: number): [number, number][] => Array.from({ length: n }, () => [...v] as [number, number]);

// AK-style: strong damage, big vertical climb then a left/right wobble.
const AK_RECOIL: [number, number][] = [
  [0.00, 0.45], [0.02, 0.60], [-0.05, 0.72], [0.10, 0.78], [0.18, 0.75], [-0.15, 0.68], [-0.35, 0.55], [-0.50, 0.42],
  [-0.30, 0.33], [0.10, 0.26], [0.40, 0.17], [0.55, 0.15], [0.45, 0.15], [0.35, 0.15], [0.30, 0.15], [0.10, 0.15],
  [-0.35, 0.15], [-0.55, 0.15], [-0.45, 0.15], [-0.20, 0.15], [-0.30, 0.15], [0.45, 0.15], [0.60, 0.15], [0.35, 0.15],
  [-0.15, 0.15], [-0.55, 0.15], [-0.40, 0.15], [0.20, 0.15], [0.45, 0.15], [0.30, 0.15],
];
// M4-style: lighter, tighter.
const M4_RECOIL: [number, number][] = [
  [0.00, 0.34], [0.02, 0.44], [-0.04, 0.50], [0.07, 0.52], [0.10, 0.50], [-0.10, 0.45], [-0.20, 0.40], [-0.26, 0.33],
  [-0.12, 0.27], [0.08, 0.22], [0.20, 0.12], [0.28, 0.12], [0.22, 0.12], [0.14, 0.12], [0.10, 0.12], [0.02, 0.12],
  [-0.18, 0.12], [-0.28, 0.12], [-0.22, 0.12], [-0.10, 0.12], [-0.14, 0.12], [0.22, 0.12], [0.30, 0.12], [0.18, 0.12],
  [-0.08, 0.12], [-0.28, 0.12], [-0.20, 0.12], [0.10, 0.12], [0.22, 0.12], [0.14, 0.12],
];
// MP5-style: fast, manageable.
const MP5_RECOIL: [number, number][] = [
  [0.00, 0.28], [0.03, 0.36], [-0.05, 0.40], [0.08, 0.38], [0.12, 0.34], [-0.10, 0.30], [-0.18, 0.26], [-0.22, 0.22],
  [-0.10, 0.18], [0.10, 0.14], [0.20, 0.10], [0.24, 0.10], [0.16, 0.10], [0.08, 0.10], [0.02, 0.10], [-0.12, 0.10],
  [-0.22, 0.10], [-0.20, 0.10], [-0.08, 0.10], [0.10, 0.10], [0.22, 0.10], [0.20, 0.10], [0.06, 0.10], [-0.14, 0.10],
  [-0.22, 0.10], [-0.12, 0.10], [0.08, 0.10], [0.18, 0.10], [0.12, 0.10], [0.00, 0.10],
];
// Desert-Eagle-style: huge kick per shot.
const DEAGLE_RECOIL: [number, number][] = [
  [0.00, 2.7], [0.25, 3.0], [-0.30, 3.1], [0.35, 3.1], [-0.20, 3.0], [0.30, 3.0], [-0.25, 3.0], [0.20, 3.0],
];
// Glock-style: mild.
const GLOCK_RECOIL: [number, number][] = [
  [0.00, 0.85], [0.08, 0.95], [-0.12, 1.0], [0.14, 0.95], [-0.10, 0.9], [0.12, 0.9], [-0.14, 0.9], [0.10, 0.9],
  ...rep([0, 0.85], 12),
];
const AWP_RECOIL: [number, number][] = [[0.0, 1.9]];

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 0, auto: true,
    damage: 36, armorPen: 0.775, rpm: 600, magSize: 30, reserve: 90, reloadTime: 2.45, drawTime: 0.9,
    rangeMod: 0.98, rangeUnit: 12.7, maxRange: 250, moveSpeed: 0.86,
    spread: { stand: 0.22, crouch: 0.14, move: 3.6, air: 5.2 },
    spreadPerShot: 0.05, spreadMax: 0.5, spreadDecay: 1.2,
    recoil: AK_RECOIL, recoverDelay: 0.14, recoverRate: 10, recoilReset: 0.42,
    tracerColor: 0xffd08a,
    sfx: { crackFreq: 2600, crackLevel: 1.0, crackDecay: 0.045, bodyFreq: 95, bodyLevel: 1.0, bodyDecay: 0.16, tailLevel: 0.55, tailDecay: 0.55, tailLP: 2400, noiseLP: 9000, pitchJitter: 0.04 },
  },
  m4a4: {
    id: 'm4a4', name: 'M4A4', slot: 0, auto: true,
    damage: 33, armorPen: 0.70, rpm: 666, magSize: 30, reserve: 90, reloadTime: 3.05, drawTime: 0.85,
    rangeMod: 0.97, rangeUnit: 12.7, maxRange: 250, moveSpeed: 0.9,
    spread: { stand: 0.17, crouch: 0.10, move: 3.1, air: 4.8 },
    spreadPerShot: 0.04, spreadMax: 0.4, spreadDecay: 1.2,
    recoil: M4_RECOIL, recoverDelay: 0.12, recoverRate: 12, recoilReset: 0.38,
    tracerColor: 0xffd9a0,
    sfx: { crackFreq: 3400, crackLevel: 1.0, crackDecay: 0.04, bodyFreq: 120, bodyLevel: 0.8, bodyDecay: 0.12, tailLevel: 0.45, tailDecay: 0.5, tailLP: 3000, noiseLP: 11000, pitchJitter: 0.05 },
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 0, auto: false,
    damage: 115, armorPen: 0.975, rpm: 41, magSize: 5, reserve: 30, reloadTime: 3.4, drawTime: 1.25,
    rangeMod: 0.99, rangeUnit: 12.7, maxRange: 400, moveSpeed: 0.8,
    spread: { stand: 0.03, crouch: 0.02, move: 5.5, air: 7.5, unscoped: 5.5 },
    spreadPerShot: 0, spreadMax: 0, spreadDecay: 1,
    recoil: AWP_RECOIL, recoverDelay: 0.3, recoverRate: 8, recoilReset: 0.9,
    scope: { fovs: [26, 8], moveMult: 0.55 },
    tracerColor: 0xfff2c4,
    sfx: { crackFreq: 1800, crackLevel: 1.0, crackDecay: 0.09, bodyFreq: 62, bodyLevel: 1.4, bodyDecay: 0.34, tailLevel: 0.95, tailDecay: 1.5, tailLP: 1800, noiseLP: 6000, pitchJitter: 0.02 },
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 1, auto: false,
    damage: 63, armorPen: 0.93, rpm: 267, magSize: 7, reserve: 35, reloadTime: 2.2, drawTime: 0.6,
    rangeMod: 0.81, rangeUnit: 12.7, maxRange: 120, moveSpeed: 0.92,
    spread: { stand: 0.3, crouch: 0.2, move: 4.2, air: 6.0 },
    spreadPerShot: 0.6, spreadMax: 1.8, spreadDecay: 2.2,
    recoil: DEAGLE_RECOIL, recoverDelay: 0.2, recoverRate: 9, recoilReset: 0.6,
    tracerColor: 0xffe0a8,
    sfx: { crackFreq: 2200, crackLevel: 1.0, crackDecay: 0.07, bodyFreq: 70, bodyLevel: 1.3, bodyDecay: 0.26, tailLevel: 0.8, tailDecay: 1.0, tailLP: 2200, noiseLP: 8000, pitchJitter: 0.03 },
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 1, auto: false,
    damage: 28, armorPen: 0.47, rpm: 400, magSize: 20, reserve: 120, reloadTime: 2.2, drawTime: 0.5,
    rangeMod: 0.85, rangeUnit: 12.7, maxRange: 100, moveSpeed: 0.96,
    spread: { stand: 0.35, crouch: 0.24, move: 3.4, air: 4.8 },
    spreadPerShot: 0.18, spreadMax: 1.0, spreadDecay: 2.0,
    recoil: GLOCK_RECOIL, recoverDelay: 0.12, recoverRate: 14, recoilReset: 0.4,
    tracerColor: 0xffdfa0,
    sfx: { crackFreq: 3600, crackLevel: 0.9, crackDecay: 0.035, bodyFreq: 150, bodyLevel: 0.55, bodyDecay: 0.09, tailLevel: 0.35, tailDecay: 0.4, tailLP: 3600, noiseLP: 12000, pitchJitter: 0.06 },
  },
  mp5: {
    id: 'mp5', name: 'MP5', slot: 0, auto: true,
    damage: 26, armorPen: 0.625, rpm: 750, magSize: 30, reserve: 120, reloadTime: 2.6, drawTime: 0.6,
    rangeMod: 0.84, rangeUnit: 12.7, maxRange: 150, moveSpeed: 0.98,
    spread: { stand: 0.26, crouch: 0.17, move: 2.4, air: 4.2 },
    spreadPerShot: 0.04, spreadMax: 0.5, spreadDecay: 1.4,
    recoil: MP5_RECOIL, recoverDelay: 0.1, recoverRate: 14, recoilReset: 0.32,
    tracerColor: 0xffe2b0,
    sfx: { crackFreq: 3000, crackLevel: 0.7, crackDecay: 0.03, bodyFreq: 140, bodyLevel: 0.55, bodyDecay: 0.08, tailLevel: 0.3, tailDecay: 0.35, tailLP: 3800, noiseLP: 10000, pitchJitter: 0.07 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const PRIMARIES: WeaponId[] = ['ak47', 'm4a4', 'awp', 'mp5'];
export const PISTOLS: WeaponId[] = ['deagle', 'glock'];
export const DEFAULT_LOADOUT: Loadout = { primary: 'ak47', pistol: 'glock' };
export interface Loadout { primary: WeaponId; pistol: WeaponId }

export const weaponCooldown = (w: WeaponDef): number => 60 / w.rpm;

// ---------------------------------------------------------------- button bits shared by input + sim
export const BTN = {
  FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, CROUCH: 32, WALK: 64, FIRE: 128, RELOAD: 256, SCOPE: 512,
} as const;
