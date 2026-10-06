import { ARMORED, ARMOR_ABSORB, HIT_MULT, HitRegion, PLAYER, WeaponDef } from './config';
import { lerp } from './math';
import { eyeHeight } from './player';

/** Pose of a body for hit-testing (feet position, facing and crouch amount). */
export interface BodyPose { x: number; y: number; z: number; yaw: number; crouch: number }

export interface BodyHit { t: number; region: HitRegion }

interface HBox { r: HitRegion; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

/** Build region boxes in the body frame: x = right, y = up, z = backwards. Head is handled as a sphere. */
function bodyBoxes(crouch: number): HBox[] {
  const s = lerp(PLAYER.height, PLAYER.crouchHeight, crouch) / PLAYER.height;
  const mk = (r: HitRegion, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): HBox => ({ r, x0, x1, y0: y0 * s, y1: y1 * s, z0, z1 });
  return [
    mk('leg', -0.21, 0.21, 0, 0.88, -0.15, 0.15),
    mk('stomach', -0.2, 0.2, 0.88, 1.12, -0.15, 0.15),
    mk('chest', -0.24, 0.24, 1.12, 1.46, -0.17, 0.17),
    mk('arm', -0.36, -0.2, 0.98, 1.46, -0.42, 0.12),
    mk('arm', 0.2, 0.36, 0.98, 1.46, -0.42, 0.12),
  ];
}
const HEAD_R = 0.15;

/** Ray (world space) vs one body. Returns the nearest hit region, or null. */
export function rayBody(pose: BodyPose, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): BodyHit | null {
  // world -> body frame
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const rx = ox - pose.x, rz = oz - pose.z, ry = oy - pose.y;
  // right = (cos, -sin), forward = (-sin, -cos); body z axis points backwards => back = -forward
  const lox = rx * cy - rz * sy;
  const loz = -(rx * -sy + rz * -cy);
  const ldx = dx * cy - dz * sy;
  const ldz = -(dx * -sy + dz * -cy);

  let bestT = maxT;
  let region: HitRegion | null = null;

  // head sphere
  {
    const hcy = eyeHeight(pose.crouch) + 0.03;
    const cx = lox, cyy = ry - hcy, cz = loz;
    const a = ldx * ldx + dy * dy + ldz * ldz;
    const bq = cx * ldx + cyy * dy + cz * ldz;
    const c = cx * cx + cyy * cyy + cz * cz - HEAD_R * HEAD_R;
    const disc = bq * bq - a * c;
    if (disc >= 0) {
      const t = (-bq - Math.sqrt(disc)) / a;
      if (t >= 0 && t < bestT) { bestT = t; region = 'head'; }
      else if (c < 0) { bestT = 0; region = 'head'; }
    }
  }
  for (const b of bodyBoxes(pose.crouch)) {
    const t = slab(lox, ry, loz, ldx, dy, ldz, b, bestT);
    if (t !== null && t < bestT) { bestT = t; region = b.r; }
  }
  return region ? { t: bestT, region } : null;
}

function slab(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: HBox, maxT: number): number | null {
  let tmin = 0, tmax = maxT;
  const axes: [number, number, number, number][] = [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

export interface DamageResult { health: number; armor: number; raw: number }

/** CS-style damage: region multiplier, distance falloff, then armor absorption (legs unprotected). */
export function computeDamage(def: WeaponDef, region: HitRegion, dist: number, armor: number): DamageResult {
  const raw = def.damage * HIT_MULT[region] * Math.pow(def.rangeMod, dist / def.rangeUnit);
  if (armor > 0 && ARMORED[region]) {
    let toHealth = raw * def.armorPen;
    let armorLoss = (raw - toHealth) * ARMOR_ABSORB;
    if (armorLoss > armor) {
      armorLoss = armor;
      toHealth = raw - armor / ARMOR_ABSORB;
    }
    return { health: Math.max(1, Math.round(toHealth)), armor: Math.round(armorLoss), raw };
  }
  return { health: Math.max(1, Math.round(raw)), armor: 0, raw };
}
