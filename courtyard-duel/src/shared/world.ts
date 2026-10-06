import { MAP, MapBox, MapDef, Mat } from './map';
import { PLAYER } from './config';

/** Preprocessed collision box. */
export interface CBox extends MapBox {
  cos: number; sin: number;
  minX: number; maxX: number; minZ: number; maxZ: number; // world AABB of the footprint
}

export interface RayHit {
  t: number;
  box: CBox;
  nx: number; ny: number; nz: number;
  mat: Mat;
}

const AIR_EPS = 0.02;

export class World {
  boxes: CBox[];
  map: MapDef;

  constructor(map: MapDef = MAP) {
    this.map = map;
    this.boxes = map.boxes.map((b) => {
      const cos = Math.cos(b.rot), sin = Math.sin(b.rot);
      const ex = Math.abs(cos) * b.hx + Math.abs(sin) * b.hz;
      const ez = Math.abs(sin) * b.hx + Math.abs(cos) * b.hz;
      return { ...b, cos, sin, minX: b.cx - ex, maxX: b.cx + ex, minZ: b.cz - ez, maxZ: b.cz + ez };
    });
  }

  /** Highest surface under the circle (x,z,r) that is not above `cap`. Returns -Infinity if none. */
  groundHeight(x: number, z: number, r: number, cap: number): { h: number; mat: Mat | null } {
    let best = -Infinity;
    let mat: Mat | null = null;
    for (const b of this.boxes) {
      if (b.y1 > cap || b.y1 <= best) continue;
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      if (circleBoxDistSq(b, x, z) < r * r) { best = b.y1; mat = b.mat; }
    }
    return { h: best, mat };
  }

  /**
   * Push a circle out of every box that acts as an obstacle for a body whose feet are at `feetY`.
   * `cap` is the highest top surface that counts as walkable (step-up) rather than as a wall.
   * Returns the (possibly corrected) position and accumulated push normal.
   */
  resolveCircle(pos: { x: number; z: number }, r: number, feetY: number, height: number, cap: number, out: { nx: number; nz: number }): boolean {
    let hit = false;
    out.nx = 0; out.nz = 0;
    const headY = feetY + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.boxes) {
        if (b.y1 <= cap || b.y0 >= headY) continue;
        if (pos.x + r < b.minX || pos.x - r > b.maxX || pos.z + r < b.minZ || pos.z - r > b.maxZ) continue;
        // transform to box local space
        const dx = pos.x - b.cx, dz = pos.z - b.cz;
        const lx = dx * b.cos + dz * b.sin;
        const lz = -dx * b.sin + dz * b.cos;
        const px = Math.max(-b.hx, Math.min(b.hx, lx));
        const pz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ox = lx - px, oz = lz - pz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        let nlx: number, nlz: number, push: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          nlx = ox / d; nlz = oz / d; push = r - d;
        } else {
          // centre inside the box: exit through the nearest face
          const penX = b.hx - Math.abs(lx), penZ = b.hz - Math.abs(lz);
          if (penX < penZ) { nlx = lx >= 0 ? 1 : -1; nlz = 0; push = penX + r; }
          else { nlx = 0; nlz = lz >= 0 ? 1 : -1; push = penZ + r; }
        }
        // back to world space
        const nx = nlx * b.cos - nlz * b.sin;
        const nz = nlx * b.sin + nlz * b.cos;
        pos.x += nx * (push + 1e-4);
        pos.z += nz * (push + 1e-4);
        out.nx += nx; out.nz += nz;
        hit = true; moved = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Nearest ray intersection with any solid. Direction need not be normalised (t is in direction units). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxT;
    for (const b of this.boxes) {
      // Quick vertical + AABB reject
      const hit = rayBox(b, ox, oy, oz, dx, dy, dz, bestT);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = hit;
      }
    }
    return best;
  }

  /** Surface material below a point (for footsteps). */
  surfaceAt(x: number, z: number, feetY: number): Mat {
    const g = this.groundHeight(x, z, 0.05, feetY + PLAYER.stepHeight + 0.05);
    return g.mat ?? 'stone';
  }

  /** Is the straight segment between two points unobstructed? */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    return !this.raycast(ax, ay, az, dx, dy, dz, 1);
  }
}

function circleBoxDistSq(b: CBox, x: number, z: number): number {
  const dx = x - b.cx, dz = z - b.cz;
  const lx = dx * b.cos + dz * b.sin;
  const lz = -dx * b.sin + dz * b.cos;
  const px = Math.max(-b.hx, Math.min(b.hx, lx));
  const pz = Math.max(-b.hz, Math.min(b.hz, lz));
  const ox = lx - px, oz = lz - pz;
  return ox * ox + oz * oz;
}

function rayBox(b: CBox, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
  // origin / direction into box-local space
  const rx = ox - b.cx, rz = oz - b.cz;
  const lox = rx * b.cos + rz * b.sin;
  const loz = -rx * b.sin + rz * b.cos;
  const ldx = dx * b.cos + dz * b.sin;
  const ldz = -dx * b.sin + dz * b.cos;
  let tmin = 0, tmax = maxT;
  let nAxis = -1, nSign = 0;

  // X slab
  if (Math.abs(ldx) < 1e-12) { if (lox < -b.hx || lox > b.hx) return null; }
  else {
    let t1 = (-b.hx - lox) / ldx, t2 = (b.hx - lox) / ldx, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 0; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z slab
  if (Math.abs(ldz) < 1e-12) { if (loz < -b.hz || loz > b.hz) return null; }
  else {
    let t1 = (-b.hz - loz) / ldz, t2 = (b.hz - loz) / ldz, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 2; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab
  if (Math.abs(dy) < 1e-12) { if (oy < b.y0 || oy > b.y1) return null; }
  else {
    let t1 = (b.y0 - oy) / dy, t2 = (b.y1 - oy) / dy, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 1; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return null; // origin inside the box
  if (tmin < 0 || tmin > maxT) return null;
  let nx = 0, ny = 0, nz = 0;
  if (nAxis === 0) { nx = nSign * b.cos; nz = nSign * b.sin; }
  else if (nAxis === 2) { nx = -nSign * b.sin; nz = nSign * b.cos; }
  else ny = nSign;
  return { t: tmin, box: b, nx, ny, nz, mat: b.mat };
}

export const AIR_EPSILON = AIR_EPS;
