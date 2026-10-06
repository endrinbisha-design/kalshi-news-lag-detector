import * as THREE from 'three';
import { MAP, MapBox, H, toX, toZ } from '../../shared/map';
import { GeoBatch, trs } from './geo';
import { Loaded, makeDomeTexture, mulberry } from './textures';
import { buildCar } from './car';

/** Material key used for a map box's main body. */
const BODY_MAT: Record<string, string> = {
  wall: 'wall', rim: 'wall', kiosk: 'kiosk', courtyard: 'courtyard', alcove: 'alcove', pit: 'pit', step: 'step', crate: 'crate',
};

export interface BuiltMap {
  group: THREE.Group;
}

export function buildMapMeshes(mats: Loaded, anisotropy: number): BuiltMap {
  const group = new THREE.Group();
  group.name = 'arena';
  const batches = new Map<string, GeoBatch>();
  const batch = (k: string) => { let b = batches.get(k); if (!b) { b = new GeoBatch(); batches.set(k, b); } return b; };
  const extra: Record<string, THREE.Material> = {
    panel: new THREE.MeshStandardMaterial({ color: 0xd2bd98, roughness: 0.92, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 0.85, metalness: 0.05 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 0.8, metalness: 0 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.55, metalness: 0.85 }),
    roofMauve: new THREE.MeshStandardMaterial({ color: 0x9d7f93, roughness: 0.75, metalness: 0 }),
    roofBlue: new THREE.MeshStandardMaterial({ color: 0x7f96b8, roughness: 0.75, metalness: 0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x86a9c8, metalness: 0.15, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.6 }),
    rimPaint: mats.rim.clone(),
  };
  const matFor = (k: string): THREE.Material => mats[k] ?? extra[k];
  const tileOf = (k: string) => (mats[k]?.userData.tile as number | undefined) ?? 2;

  const rnd = mulberry(99);
  const addBox = (key: string, m: THREE.Matrix4, sx: number, sy: number, sz: number, worldTop = false, jitter = false) => {
    const off: [number, number] = jitter ? [rnd() * 4, rnd() * 4] : [0, 0];
    batch(key).box(m, sx, sy, sz, tileOf(key), off, worldTop);
  };

  // ---------------------------------------------------------------- collider bodies
  for (const b of MAP.boxes) {
    if (b.style === 'car' || b.style === 'carCabin') continue;
    const key = BODY_MAT[b.style];
    const sy = b.y1 - b.y0;
    const floorLike = b.style === 'courtyard' || b.style === 'alcove' || b.style === 'pit';
    // slabs are sunk 0.0 so tops are exact
    addBox(key, trs(b.cx, (b.y0 + b.y1) / 2, b.cz, -b.rot), b.hx * 2, sy, b.hz * 2, floorLike, !floorLike && b.style !== 'step');
  }

  decoratePerimeter(batch, addBox);
  decorateCover(addBox);
  decoratePit(addBox);
  decorateStairs(addBox);

  // ---------------------------------------------------------------- merge to meshes
  for (const [k, b] of batches) {
    const g = b.build();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, matFor(k));
    mesh.castShadow = k !== 'courtyard' && k !== 'alcove' && k !== 'pit' && k !== 'glass';
    mesh.receiveShadow = true;
    mesh.name = 'static:' + k;
    group.add(mesh);
  }
  for (const m of Object.values(mats)) { m.map && (m.map.anisotropy = anisotropy); }

  // ---------------------------------------------------------------- car
  const car = buildCar();
  const cb = MAP.boxes.find((b) => b.style === 'car')!;
  car.position.set(cb.cx, H.pit, cb.cz);
  car.rotation.y = -cb.rot;
  group.add(car);

  // ---------------------------------------------------------------- scenery beyond the walls
  group.add(buildScenery(mats, anisotropy));
  return { group };
}

type AddBox = (key: string, m: THREE.Matrix4, sx: number, sy: number, sz: number, worldTop?: boolean, jitter?: boolean) => void;
type Batch = (k: string) => GeoBatch;

/** Frame data for the inner face of a (thin) wall box. */
function innerFace(b: MapBox) {
  const thinX = b.hx < b.hz;
  const t = thinX ? b.hx : b.hz;
  const len = (thinX ? b.hz : b.hx) * 2;
  // local axes in world: u = (cos, sin), v = (-sin, cos) in (X,Z)
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const axis = thinX ? { x: c, z: s } : { x: -s, z: c }; // thin axis in world
  const toCenter = (-b.cx) * axis.x + (-b.cz) * axis.z;
  const sg = toCenter >= 0 ? 1 : -1;
  const n = { x: axis.x * sg, z: axis.z * sg }; // face normal (towards arena centre)
  const tan = thinX ? { x: -s, z: c } : { x: c, z: s };
  const face = { x: b.cx + n.x * t, z: b.cz + n.z * t };
  return { n, tan, face, len, yaw: Math.atan2(-n.x, -n.z) * 0 };
}

/** Place a decor box on a wall face: along = offset along the tangent, out = protrusion centre offset, y = centre height. */
function onFace(f: ReturnType<typeof innerFace>, along: number, out: number, y: number, sAlong: number, sY: number, sOut: number) {
  const x = f.face.x + f.tan.x * along + f.n.x * out;
  const z = f.face.z + f.tan.z * along + f.n.z * out;
  // yaw so local X = tangent, local Z = normal
  const yaw = Math.atan2(-f.tan.z, f.tan.x);
  return { m: trs(x, y, z, yaw), sx: sAlong, sy: sY, sz: sOut };
}

function decoratePerimeter(batch: Batch, addBox: AddBox) {
  for (const b of MAP.boxes) {
    if (b.style !== 'wall') continue;
    const f = innerFace(b);
    const top = H.perimeter;
    const place = (key: string, along: number, out: number, y0: number, y1: number, sAlong: number, sOut: number) => {
      const d = onFace(f, along, out, (y0 + y1) / 2, sAlong, y1 - y0, sOut);
      addBox(key, d.m, d.sx, d.sy, d.sz);
    };
    // skip faces that are fully buried: tiny jog faces
    if (f.len < 3) continue;
    // plinth + cornice
    place('step', 0, 0.06, -0.0, 0.5, f.len - 0.1, 0.12);
    place('wall', 0, 0.12, top - 0.35, top, f.len - 0.1, 0.24);
    // blue trim band with dentils beneath it
    place('trim', 0, 0.035, top - 1.35, top - 0.8, f.len - 0.1, 0.07);
    const dentils = Math.floor((f.len - 0.6) / 0.34);
    for (let i = 0; i < dentils; i++) {
      const a = -((dentils - 1) * 0.34) / 2 + i * 0.34;
      place('wall', a, 0.05, top - 1.62, top - 1.36, 0.17, 0.1);
    }
    // pilasters + inset panels between them
    const bay = 4.6;
    const n = Math.max(1, Math.round(f.len / bay));
    const step = f.len / n;
    for (let i = 0; i <= n; i++) {
      const a = -f.len / 2 + i * step;
      const w = i === 0 || i === n ? 0.4 : 0.55;
      const along = i === 0 ? a + w / 2 : i === n ? a - w / 2 : a;
      place('wall', along, 0.07, 0.5, top - 0.35, w, 0.14);
      place('trim', along, 0.09, top - 1.35, top - 0.8, w + 0.12, 0.18);
      place('trim', along, 0.09, 0.5, 0.78, w + 0.1, 0.18);
    }
    for (let i = 0; i < n; i++) {
      const a = -f.len / 2 + (i + 0.5) * step;
      const w = step - 1.3;
      if (w < 1) continue;
      place('panel', a, 0.02, 1.0, top - 1.9, w, 0.04);
      // frame
      place('trim', a, 0.035, 1.0, 1.1, w + 0.1, 0.06);
      place('trim', a, 0.035, top - 2.0, top - 1.9, w + 0.1, 0.06);
    }
    // big recessed glazed doors on the long side walls (the large pale panels in the reference)
    if (Math.abs(f.n.x) > 0.9 && f.len > 8) {
      const w = 7.4, y0 = 0.7, y1 = 3.5;
      place('dark', 0, 0.025, y0 - 0.15, y1 + 0.15, w + 0.3, 0.05);
      place('glass', 0, 0.055, y0, y1, w, 0.03);
      for (let i = -3; i <= 3; i++) place('trim', (i * w) / 6, 0.07, y0, y1, 0.07, 0.05);
      place('trim', 0, 0.07, (y0 + y1) / 2, (y0 + y1) / 2 + 0.07, w, 0.05);
    }
  }
  void batch;
}

function decorateCover(addBox: AddBox) {
  // crate battens, corner posts and cross braces
  for (const b of MAP.boxes) {
    if (b.style !== 'crate') continue;
    const sx = b.hx * 2, sz = b.hz * 2, sy = b.y1 - b.y0;
    const cy = (b.y0 + b.y1) / 2;
    const yaw = -b.rot;
    const local = (lx: number, ly: number, lz: number) => {
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      return { x: b.cx + lx * c - lz * s, y: cy + ly, z: b.cz + lx * s + lz * c };
    };
    const post = 0.1, rail = 0.09, o = 0.02;
    // four vertical corner posts
    for (const sxn of [-1, 1]) for (const szn of [-1, 1]) {
      const p = local(sxn * (sx / 2 - post / 2 + o), 0, szn * (sz / 2 - post / 2 + o));
      addBox('timber', trs(p.x, p.y, p.z, yaw), post, sy + 0.03, post);
    }
    // horizontal rails (top / bottom / mid) on each of the four sides
    const rails = sy > 1.8 ? [-sy / 2 + 0.12, 0, sy / 2 - 0.12] : [-sy / 2 + 0.12, sy / 2 - 0.12];
    for (const ry of rails) {
      for (const szn of [-1, 1]) { const p = local(0, ry, szn * (sz / 2 + o)); addBox('timber', trs(p.x, p.y, p.z, yaw), sx, rail, 0.05); }
      for (const sxn of [-1, 1]) { const p = local(sxn * (sx / 2 + o), ry, 0); addBox('timber', trs(p.x, p.y, p.z, yaw), 0.05, rail, sz); }
    }
    // diagonal cross braces on the long faces (only for single-height panels)
    const panelH = sy > 1.8 ? sy / 2 : sy;
    const ang = Math.atan2(panelH - 0.3, sx - 0.2);
    const len = Math.hypot(panelH - 0.3, sx - 0.2);
    for (let level = 0; level < (sy > 1.8 ? 2 : 1); level++) {
      const ly = sy > 1.8 ? (level === 0 ? -sy / 4 : sy / 4) : 0;
      for (const szn of [-1, 1]) {
        const p = local(0, ly, szn * (sz / 2 + o));
        addBox('timber', trs(p.x, p.y, p.z, yaw, 0, ang * (szn > 0 ? 1 : -1)), len, 0.07, 0.04);
      }
    }
    // top lid frame
    const top = local(0, sy / 2 + 0.005, 0);
    addBox('timber', trs(top.x, top.y, top.z, yaw), sx + 0.06, 0.03, sz + 0.06);
  }
}

function decoratePit(addBox: AddBox) {
  for (const b of MAP.boxes) {
    if (b.style === 'rim') {
      // orange painted face towards the pit + blue cap line
      const toPit = b.cz < 0 ? 1 : -1;
      const z = b.cz + toPit * (b.hz + 0.012);
      const y0 = H.pit, y1 = b.y1 - 0.2;
      addBox('rimPaint', trs(b.cx, (y0 + y1) / 2, z, 0), b.hx * 2 - 0.02, y1 - y0, 0.025);
      addBox('trim', trs(b.cx, b.y1 - 0.1, b.cz + toPit * (b.hz + 0.02), 0), b.hx * 2, 0.2, 0.05);
      // coping stone on top
      addBox('wall', trs(b.cx, b.y1 - 0.06, b.cz, 0), b.hx * 2 + 0.1, 0.12, b.hz * 2 + 0.12);
    }
    if (b.style === 'kiosk') {
      const roof = b.cx < 0 ? 'roofMauve' : 'roofBlue';
      addBox(roof, trs(b.cx, b.y1 - 0.08, b.cz, 0), b.hx * 2 + 0.14, 0.16, b.hz * 2 + 0.14);
    }
  }
}

function decorateStairs(addBox: AddBox) {
  // nosing highlights on every step edge
  for (const b of MAP.boxes) {
    if (b.style !== 'step') continue;
    addBox('wall', trs(b.cx, b.y1 - 0.02, b.cz, 0), b.hx * 2 + 0.01, 0.04, b.hz * 2 + 0.01, true);
  }
}

/** Ground, dunes, distant towers with blue domes: what you see above the walls. */
function buildScenery(mats: Loaded, anisotropy: number): THREE.Group {
  const g = new THREE.Group();
  const sand = mats.pit.clone();
  sand.map = mats.pit.map!.clone(); sand.normalMap = mats.pit.normalMap!.clone();
  sand.aoMap = sand.roughnessMap = sand.metalnessMap = mats.pit.aoMap!.clone();
  for (const t of [sand.map, sand.normalMap, sand.aoMap]) { t!.wrapS = t!.wrapT = THREE.RepeatWrapping; t!.repeat.set(70, 70); t!.needsUpdate = true; t!.anisotropy = anisotropy; }
  sand.color.set(0xe8cf9f);
  // ground ring around the playable rectangle (the interior has its own floors at several heights)
  const R = 400;
  const y = -0.03;
  const rects = [
    [-R, R, -R, -9.0], [-R, R, 9.0, R], [-R, -18.4, -9.0, 9.0], [18.4, R, -9.0, 9.0],
  ];
  for (const [x0, x1, z0, z1] of rects) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), sand);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    // uv in plane space is 0..1, scaled by repeat (70) over ~800 m => ~11 m tiles; fine for distant sand
    m.receiveShadow = true;
    g.add(m);
  }
  // distant dunes
  const dune = new THREE.MeshStandardMaterial({ color: 0xdcbf8a, roughness: 1, metalness: 0 });
  const rnd = mulberry(5);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.3;
    const r = 110 + rnd() * 70;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), dune);
    m.scale.set(40 + rnd() * 50, 6 + rnd() * 10, 28 + rnd() * 30);
    m.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
    g.add(m);
  }

  // towers with blue domes: at the four reference-image dome positions plus a few distant ones
  const domeTex = makeDomeTexture();
  const domeMat = new THREE.MeshStandardMaterial({ map: domeTex, roughness: 0.35, metalness: 0.15 });
  const stone = mats.wall;
  const tower = (x: number, z: number, r: number, h: number) => {
    const t = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 28), stone);
    drum.position.y = h / 2;
    const uvScale = new THREE.Matrix3().setUvTransform(0, 0, (r * 6.28) / 3.2 / 1, h / 3.2, 0, 0, 0);
    (drum.geometry.attributes.uv as THREE.BufferAttribute).applyMatrix3(uvScale);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.5, 28), mats.trim);
    band.position.y = h - 0.4;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = h;
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, r * 0.8, 8), new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 1, roughness: 0.3 }));
    fin.position.y = h + r * 1.0;
    t.add(drum, band, dome, fin);
    t.position.set(x, 0, z);
    t.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.add(t);
  };
  for (const px of [662, 1190]) { tower(toX(px), toZ(30), 2.2, 6.4); tower(toX(px), toZ(922), 2.2, 6.4); }
  for (const [x, z, r, h] of [[-34, -22, 3, 9], [34, -22, 3, 9], [-34, 22, 3, 9], [34, 22, 3, 9], [-60, 0, 4, 12], [62, 6, 4, 11]] as const) tower(x, z, r, h);
  // low block buildings
  const wallBlocks = [[-30, -4, 8, 7, 12], [32, 3, 8, 8, 14], [0, -26, 18, 6, 7], [4, 28, 20, 7, 8], [-48, 18, 10, 9, 10], [50, -16, 12, 8, 12]] as const;
  for (const [x, z, w, h, d] of wallBlocks) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.alcove);
    m.position.set(x, h / 2, z);
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
    uv.applyMatrix3(new THREE.Matrix3().setUvTransform(0, 0, w / 3, h / 3, 0, 0, 0));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
