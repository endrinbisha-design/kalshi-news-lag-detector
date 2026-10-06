import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeGrainTexture, makeWoodTexture } from '../textures';

/** Weapon-space convention: -Z is forward (muzzle), +Y up, +X right. "f" below means forward distance (= -z). */

export type P = [number, number]; // [forward, up] in side-profile space

/** Extrude a closed side-profile polygon (forward, up) into a solid of given width (x), centred on x=0. */
export function side(pts: P[], width: number, bevel = 0.0025, holes: P[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([f, y]) => new THREE.Vector2(f, y))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 10,
  });
  // shape x (forward) -> world -Z, extrusion z -> world x
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Sample a quadratic bezier for use inside a polygon. */
export function curve(a: P, c: P, b: P, n = 8): P[] {
  const out: P[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** Cylinder along the weapon axis from forward f0 to f1 at (x,y). */
export function bar(r0: number, r1: number, f0: number, f1: number, x = 0, y = 0, seg = 20): THREE.BufferGeometry {
  const len = f1 - f0;
  const g = new THREE.CylinderGeometry(r1, r0, len, seg); // top (r1) towards +Y, we rotate so +Y -> -Z (forward)
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, -(f0 + len / 2));
  return g;
}

/** Axis-aligned rounded box with centre given in (x, y, forward). */
export function box(w: number, h: number, l: number, x: number, y: number, f: number, r = 0.003): THREE.BufferGeometry {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2.01, h / 2.01, l / 2.01)) : new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, -f);
  return g;
}

export interface Mats {
  steel: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  olive: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  sleeveTan: THREE.MeshStandardMaterial;
  sleeveOlive: THREE.MeshStandardMaterial;
  sleeveNavy: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
}

let cached: Mats | null = null;
export function mats(): Mats {
  if (cached) return cached;
  const grain = makeGrainTexture();
  grain.repeat.set(2, 2);
  const wood = makeWoodTexture();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  cached = {
    steel: std({ color: 0x3a3d41, metalness: 0.88, roughness: 0.42, roughnessMap: grain }),
    darkSteel: std({ color: 0x1f2124, metalness: 0.85, roughness: 0.5, roughnessMap: grain }),
    polymer: std({ color: 0x1d1e20, metalness: 0.0, roughness: 0.58, bumpMap: grain, bumpScale: 0.6 }),
    rubber: std({ color: 0x141414, metalness: 0.0, roughness: 0.85, bumpMap: grain, bumpScale: 1.2 }),
    wood: std({ color: 0xffffff, map: wood, metalness: 0.0, roughness: 0.5 }),
    darkWood: std({ color: 0x8a5a38, map: wood, metalness: 0.0, roughness: 0.55 }),
    alu: std({ color: 0x9a9ea3, metalness: 1, roughness: 0.38, roughnessMap: grain }),
    chrome: std({ color: 0xd6d9de, metalness: 1, roughness: 0.2 }),
    olive: std({ color: 0x4b5a3a, metalness: 0.0, roughness: 0.6, bumpMap: grain, bumpScale: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x223a4a, metalness: 0, roughness: 0.03, clearcoat: 1, reflectivity: 0.9 }),
    brass: std({ color: 0xcaa24a, metalness: 1, roughness: 0.3 }),
    black: std({ color: 0x0b0b0c, metalness: 0.2, roughness: 0.6 }),
    sleeveTan: std({ color: 0x8c7a58, metalness: 0, roughness: 0.92, bumpMap: grain, bumpScale: 1.5 }),
    sleeveOlive: std({ color: 0x4a5436, metalness: 0, roughness: 0.92, bumpMap: grain, bumpScale: 1.5 }),
    sleeveNavy: std({ color: 0x2b3547, metalness: 0, roughness: 0.92, bumpMap: grain, bumpScale: 1.5 }),
    glove: std({ color: 0x1e1f21, metalness: 0, roughness: 0.78, bumpMap: grain, bumpScale: 1.2 }),
    skin: std({ color: 0xc58f6c, metalness: 0, roughness: 0.7 }),
  };
  return cached;
}

/** Collect named sub-assemblies so animation code can find them after cloning. */
export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

/** Merge several (geometry, material) pairs that share a material into one mesh. */
export function group(name: string, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  for (const c of children) g.add(c);
  return g;
}

/** A thin elongated ribbing pattern (for magazines, grips): n slats along the profile direction. */
export function ribs(n: number, w: number, h: number, d: number, from: THREE.Vector3, to: THREE.Vector3, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.lerpVectors(from, to, t);
    g.add(m);
  }
  return g;
}
