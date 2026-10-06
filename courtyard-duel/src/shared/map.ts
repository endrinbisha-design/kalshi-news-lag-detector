/**
 * Arena layout, reconstructed from the reference top-down image.
 *
 * The map is authored in the reference image's pixel space (1852 x 952, origin top-left) and converted to
 * metres (1 px = 0.026 m, origin = image centre, +X right, +Z down the image, +Y up). Because the layout is
 * (near-)symmetric, most pieces are authored once and mirrored. See docs/MAP_NOTES.md for assumptions.
 *
 * Everything solid is an oriented box (rotated around Y). Players are vertical cylinders; stairs are stacked
 * thin boxes that the player can step over (PLAYER.stepHeight). Both the renderer and the server consume this.
 */

export type Mat = 'stone' | 'plaster' | 'sand' | 'pavers' | 'wood' | 'metal' | 'trim';
export type Style =
  | 'wall' | 'rim' | 'kiosk' | 'courtyard' | 'alcove' | 'pit' | 'step' | 'crate' | 'car' | 'carCabin';

export interface MapBox {
  id: number;
  cx: number; cz: number; // centre (m)
  hx: number; hz: number; // half extents along local u / v axes
  rot: number; // yaw (rad): local u axis = (cos rot, sin rot) in (X, Z)
  y0: number; y1: number;
  mat: Mat;
  style: Style;
  /** Optional render hint (crate variant etc.). */
  variant?: number;
}

export interface SpawnPoint { x: number; y: number; z: number; yaw: number }

export interface TargetSpot {
  x: number; z: number; y: number; yaw: number;
  /** Patrol: oscillates between (x,z) and (x2,z2) at `speed` m/s. */
  x2?: number; z2?: number; speed?: number;
}

export interface MapDef {
  boxes: MapBox[];
  spawns: [SpawnPoint, SpawnPoint];
  practiceSpawn: SpawnPoint;
  targets: TargetSpot[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const PX = 0.026;
const CX = 926, CZ = 476;
const IMG_W = 1852, IMG_H = 952;
export const toX = (px: number) => (px - CX) * PX;
export const toZ = (py: number) => (py - CZ) * PX;

// ---- heights (absolute, metres; courtyard floor = 0)
export const H = {
  alcove: 0.72,   // top / bottom lanes sit 4 steps above the courtyards
  pit: -0.9,      // centre pit is 5 steps below the courtyards
  perimeter: 5.2,
  rim: 2.4,       // pit enclosure walls
  kiosk: 2.4,
  crate: 1.4,
  deepFloor: -6,
};

type Quad = 'tl' | 'tr' | 'bl' | 'br';

interface RectPx { x0: number; y0: number; x1: number; y1: number }

export function buildMap(): MapDef {
  const boxes: MapBox[] = [];
  let nextId = 0;

  const addRect = (r: RectPx, y0: number, y1: number, mat: Mat, style: Style, variant?: number) => {
    boxes.push({
      id: nextId++,
      cx: toX((r.x0 + r.x1) / 2), cz: toZ((r.y0 + r.y1) / 2),
      hx: ((r.x1 - r.x0) / 2) * PX, hz: ((r.y1 - r.y0) / 2) * PX,
      rot: 0, y0, y1, mat, style, variant,
    });
  };
  /** Oriented box given centre in px, full size in metres, rotation in degrees. */
  const addObb = (cxPx: number, cyPx: number, w: number, d: number, rotDeg: number, y0: number, y1: number, mat: Mat, style: Style, variant?: number) => {
    boxes.push({
      id: nextId++, cx: toX(cxPx), cz: toZ(cyPx), hx: w / 2, hz: d / 2,
      rot: rotDeg * Math.PI / 180, y0, y1, mat, style, variant,
    });
  };

  const mirX = (r: RectPx): RectPx => ({ x0: IMG_W - r.x1, x1: IMG_W - r.x0, y0: r.y0, y1: r.y1 });
  const mirY = (r: RectPx): RectPx => ({ x0: r.x0, x1: r.x1, y0: IMG_H - r.y1, y1: IMG_H - r.y0 });
  /** Add a rect in all four quadrants (authoring done in the top-left quadrant). */
  const quadRect = (r: RectPx, y0: number, y1: number, mat: Mat, style: Style, variant?: number) => {
    const set = [r, mirX(r), mirY(r), mirY(mirX(r))];
    for (const q of set) addRect(q, y0, y1, mat, style, variant);
  };
  const xRect = (r: RectPx, y0: number, y1: number, mat: Mat, style: Style, variant?: number) => {
    for (const q of [r, mirX(r)]) addRect(q, y0, y1, mat, style, variant);
  };
  const yRect = (r: RectPx, y0: number, y1: number, mat: Mat, style: Style, variant?: number) => {
    for (const q of [r, mirY(r)]) addRect(q, y0, y1, mat, style, variant);
  };

  /** Oriented box, authored top-left, mirrored into the other quadrants with the correct rotation. */
  const quadObb = (cx: number, cy: number, w: number, d: number, rotDeg: number, y0: number, y1: number, mat: Mat, style: Style, variant?: number) => {
    addObb(cx, cy, w, d, rotDeg, y0, y1, mat, style, variant);
    addObb(IMG_W - cx, cy, w, d, 180 - rotDeg, y0, y1, mat, style, variant);
    addObb(cx, IMG_H - cy, w, d, -rotDeg, y0, y1, mat, style, variant);
    addObb(IMG_W - cx, IMG_H - cy, w, d, 180 + rotDeg, y0, y1, mat, style, variant);
  };

  const T = 46; // wall thickness in px (~1.2 m)

  // ------------------------------------------------------------------ floors
  // Courtyards (level 0). The floor slabs run under the walls so there are no gaps.
  addRect({ x0: 160, y0: 60, x1: 600, y1: 892 }, H.deepFloor, 0, 'pavers', 'courtyard');
  addRect({ x0: 1252, y0: 60, x1: 1692, y1: 892 }, H.deepFloor, 0, 'pavers', 'courtyard');
  // Top / bottom lanes ("alcoves"), raised.
  yRect({ x0: 667, y0: 60, x1: 1185, y1: 318 }, H.deepFloor, H.alcove, 'plaster', 'alcove');
  // Centre pit, sunken.
  addRect({ x0: 680, y0: 330, x1: 1172, y1: 622 }, H.deepFloor, H.pit, 'sand', 'pit');

  // Stairs courtyard -> lane (4 risers, 0.18 m each). Top-left authored, mirrored to all four.
  const stepsUp = [
    { x0: 600, x1: 622.5, top: 0.18 },
    { x0: 622.5, x1: 645, top: 0.36 },
    { x0: 645, x1: 667.5, top: 0.54 },
  ];
  for (const s of stepsUp) quadRect({ x0: s.x0, x1: s.x1, y0: 130, y1: 318 }, H.deepFloor, s.top, 'stone', 'step');
  // Stairs courtyard -> pit (5 risers down). Gate is 4 m wide.
  for (let i = 0; i < 4; i++) {
    const x0 = 600 + i * 20;
    const top = -0.18 * (i + 1);
    xRect({ x0, x1: x0 + 20, y0: 400, y1: 552 }, H.deepFloor, top, 'stone', 'step');
  }

  // ------------------------------------------------------------------ perimeter walls
  // Chamfer between the left wall and the top wall.
  {
    const ax = 245, ay = 290, bx = 390, by = 148;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // candidate normal
    // outward = pointing away from the arena centre
    const midx = (ax + bx) / 2, midy = (ay + by) / 2;
    const out = (CX - midx) * nx + (CZ - midy) * ny > 0 ? -1 : 1;
    const ox = nx * out, oy = ny * out;
    const cxp = midx + ox * T / 2, cyp = midy + oy * T / 2;
    const rot = Math.atan2(dy, dx) * 180 / Math.PI;
    quadObb(cxp, cyp, (len + T) * PX, T * PX, rot, H.deepFloor, H.perimeter, 'stone', 'wall');
  }
  // Top wall of the courtyard (until the jog), and bottom mirrored; right via mirror.
  quadRect({ x0: 380, y0: 102, x1: 690, y1: 148 }, H.deepFloor, H.perimeter, 'stone', 'wall');
  // Lane back walls (recessed 0.6 m further out than the courtyard walls).
  yRect({ x0: 644, y0: 79, x1: 1208, y1: 125 }, H.deepFloor, H.perimeter, 'stone', 'wall');
  // Side walls.
  xRect({ x0: 199, y0: 250, x1: 245, y1: 702 }, H.deepFloor, H.perimeter, 'stone', 'wall');

  // ------------------------------------------------------------------ pit enclosure
  yRect({ x0: 600, y0: 316, x1: 1252, y1: 336 }, H.deepFloor, H.rim, 'stone', 'rim');
  quadRect({ x0: 600, y0: 336, x1: 700, y1: 400 }, H.deepFloor, H.kiosk, 'plaster', 'kiosk');

  // ------------------------------------------------------------------ cover
  // Courtyard crate clusters (x-mirrored).
  for (const mx of [false, true]) {
    const f = (x: number) => (mx ? IMG_W - x : x);
    addObb(f(499), 413, 1.25, 1.25, 0, 0, H.crate, 'wood', 'crate', 1);
    addObb(f(484), 478, 1.5, 2.3, 0, 0, H.crate, 'wood', 'crate', 2);
    addObb(f(486), 478, 1.05, 1.05, 0, H.crate, H.crate + 1.0, 'wood', 'crate', 3);
    addObb(f(500), 545, 1.25, 1.1, 0, 0, H.crate, 'wood', 'crate', 1);
  }
  // Corner stacks pressed against the chamfered walls (stepped crate pairs).
  {
    // Chamfer tangent angle in px space is ~-44.4 deg (running up-right).
    const rot = -44.4;
    const nIn = { x: 0.700, y: 0.714 }; // inward normal (toward the arena centre)
    const base = { x: 245 + (390 - 245) * 0.45, y: 290 + (148 - 290) * 0.45 };
    const off = 25; // px from wall line
    const cx = base.x + nIn.x * off, cy = base.y + nIn.y * off;
    quadObb(cx, cy, 1.8, 1.2, rot, 0, H.crate, 'wood', 'crate', 2);
    // smaller step crate beside it, half height
    const along = { x: 0.714, y: -0.700 };
    quadObb(cx - along.x * 36 + nIn.x * 14, cy - along.y * 36 + nIn.y * 14, 1.0, 1.0, rot, 0, 0.95, 'wood', 'crate', 1);
  }
  // Lane crate stacks (y-mirrored): tall centre crate flanked by two lower ones.
  for (const my of [false, true]) {
    const f = (y: number) => (my ? IMG_H - y : y);
    addObb(926, f(268), 1.6, 1.6, 0, H.alcove, H.alcove + 2.6, 'wood', 'crate', 2);
    addObb(877, f(284), 1.0, 1.1, 0, H.alcove, H.alcove + 1.3, 'wood', 'crate', 1);
    addObb(975, f(284), 1.0, 1.1, 0, H.alcove, H.alcove + 1.3, 'wood', 'crate', 1);
  }
  // Pit crates (point symmetric) and the car.
  addObb(1012, 362, 1.4, 1.4, 0, H.pit, H.pit + 1.35, 'wood', 'crate', 3);
  addObb(IMG_W - 1012, IMG_H - 362, 1.4, 1.4, 0, H.pit, H.pit + 1.35, 'wood', 'crate', 3);
  addObb(933, 483, 4.2, 1.75, -47.5, H.pit + 0.12, H.pit + 0.95, 'metal', 'car');
  addObb(925, 489, 2.0, 1.55, -47.5, H.pit + 0.95, H.pit + 1.5, 'metal', 'carCabin');
  // Spawn cover (x- and y-mirrored): knee-to-chest crates beside each spawn.
  quadObb(350, 383, 1.1, 1.1, 8, 0, 1.15, 'wood', 'crate', 1);

  // ------------------------------------------------------------------ spawns / practice
  const spawnX = toX(320);
  const spawns: [SpawnPoint, SpawnPoint] = [
    { x: spawnX, y: 0, z: 0, yaw: -Math.PI / 2 },
    { x: -spawnX, y: 0, z: 0, yaw: Math.PI / 2 },
  ];

  const tp = (px: number, py: number, yaw: number, extra: Partial<TargetSpot> = {}): TargetSpot => ({
    x: toX(px), z: toZ(py), y: 0, yaw, ...extra,
  });
  const targets: TargetSpot[] = [
    tp(430, 330, -Math.PI / 2),                 // near, courtyard
    tp(560, 612, -Math.PI / 2),                 // courtyard near stairs
    { ...tp(800, 200, Math.PI), y: H.alcove },  // top lane
    { ...tp(1040, 520, Math.PI), y: H.pit },    // pit
    tp(1250, 476, Math.PI / 2),                 // far, right courtyard entrance
    tp(1480, 300, Math.PI / 2),                 // far corner
    { ...tp(380, 700, -Math.PI / 2), x2: toX(380), z2: toZ(260), speed: 1.6 }, // patrolling
    { ...tp(1500, 640, Math.PI / 2), x2: toX(1500), z2: toZ(300), speed: 2.2 },
  ];

  return {
    boxes,
    spawns,
    practiceSpawn: spawns[0],
    targets,
    bounds: { minX: toX(190), maxX: toX(1662), minZ: toZ(70), maxZ: toZ(882) },
  };
}

export const MAP: MapDef = buildMap();
