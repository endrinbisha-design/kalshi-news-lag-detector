import * as THREE from 'three';
import { mats, mesh } from './kit';

const UP = new THREE.Vector3(0, 1, 0);

/** A tapered limb segment (unit height along +Y) that can be stretched between two points. */
export function makeSegment(r0: number, r1: number, mat: THREE.Material, radial = 14): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, 1, radial, 1);
  g.translate(0, 0.5, 0); // base at origin, extends along +Y
  const m = mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
/** Place a unit-height segment from a to b. */
export function placeSegment(seg: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  _d.subVectors(b, a);
  const len = _d.length();
  seg.position.copy(a);
  seg.scale.set(1, Math.max(1e-4, len), 1);
  _q.setFromUnitVectors(UP, _d.divideScalar(Math.max(1e-6, len)));
  seg.quaternion.copy(_q);
}

/** Analytic two-bone IK. Returns the elbow/knee position. `pole` biases the bend direction. */
export function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const d = new THREE.Vector3().subVectors(target, root);
  let dist = d.length();
  const maxReach = (l1 + l2) * 0.999;
  const minReach = Math.abs(l1 - l2) * 1.001 + 1e-3;
  dist = Math.min(Math.max(dist, minReach), maxReach);
  const dir = d.normalize();
  // distance along dir to the elbow's projection, and its height
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // pole component perpendicular to dir
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (p.lengthSq() < 1e-8) p.set(0, -1, 0).sub(dir.clone().multiplyScalar(-dir.y));
  p.normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(p, h);
}

export interface HandRig {
  root: THREE.Group; // wrist at origin, fingers along -Z, palm normal -Y, thumb on -X (right) / +X (left)
  fingers: THREE.Group[][]; // [finger][joint]
  thumb: THREE.Group[];
}

const FINGER_LEN = [0.046, 0.05, 0.047, 0.04]; // proximal lengths (index, middle, ring, pinky)

/** A gloved hand built from rounded segments. `side` flips the thumb. */
export function makeHand(side: 'left' | 'right', mat: THREE.Material = mats().glove, scale = 1): HandRig {
  const root = new THREE.Group();
  root.name = 'hand';
  const s = side === 'right' ? 1 : -1;
  const palm = mesh(new THREE.BoxGeometry(0.086, 0.032, 0.095, 2, 2, 2), mat);
  palm.position.set(0, 0, -0.05);
  // soften the box into a rounded palm
  const pos = palm.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 - 0.18 * (Math.abs(x) / 0.043) * (Math.abs(z) / 0.0475);
    pos.setXYZ(i, x * k, y, z * k);
  }
  palm.geometry.computeVertexNormals();
  root.add(palm);
  // cuff
  const cuff = mesh(new THREE.CylinderGeometry(0.042, 0.047, 0.05, 16), mats().sleeveOlive);
  cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0.0, 0.02);
  const knuckles = mesh(new THREE.BoxGeometry(0.088, 0.018, 0.02), mat);
  knuckles.position.set(0, 0.004, -0.1);
  root.add(knuckles);
  void cuff;
  const fingers: THREE.Group[][] = [];
  const xs = [-0.033, -0.011, 0.011, 0.032].map((x) => x * s);
  for (let f = 0; f < 4; f++) {
    const base = FINGER_LEN[f];
    const j0 = new THREE.Group();
    j0.position.set(xs[f], 0.002, -0.1);
    const lens = [base, base * 0.78, base * 0.6];
    const joints: THREE.Group[] = [j0];
    let parent: THREE.Group = j0;
    for (let k = 0; k < 3; k++) {
      const seg = mesh(new THREE.CapsuleGeometry(0.0112 - k * 0.0009, lens[k] - 0.016, 4, 8), mat);
      seg.rotation.x = Math.PI / 2;
      seg.position.set(0, 0, -lens[k] / 2);
      parent.add(seg);
      if (k < 2) {
        const nj = new THREE.Group();
        nj.position.set(0, 0, -lens[k]);
        parent.add(nj);
        joints.push(nj);
        parent = nj;
      }
    }
    root.add(j0);
    fingers.push(joints);
  }
  // thumb: two segments angled out from the palm side
  const t0 = new THREE.Group();
  t0.position.set(-0.04 * s, 0, -0.04);
  t0.rotation.set(0, 0.5 * s, 0);
  const tl = [0.04, 0.034];
  const seg0 = mesh(new THREE.CapsuleGeometry(0.0105, tl[0] - 0.02, 4, 8), mat);
  seg0.rotation.x = Math.PI / 2; seg0.position.set(0, 0, -tl[0] / 2);
  const t1 = new THREE.Group(); t1.position.set(0, 0, -tl[0]);
  const seg1 = mesh(new THREE.CapsuleGeometry(0.0095, tl[1] - 0.018, 4, 8), mat);
  seg1.rotation.x = Math.PI / 2; seg1.position.set(0, 0, -tl[1] / 2);
  t0.add(seg0, t1); t1.add(seg1);
  root.add(t0);
  root.scale.setScalar(scale);
  return { root, fingers, thumb: [t0, t1] };
}

/** Curl fingers: c in radians per joint (0 = straight, ~1.4 = fully bent). Finger curls toward the palm (+Y local = back of hand, so negative X rotation bends toward -Y). */
export function curlHand(h: HandRig, c: number[], thumbCurl: number, thumbSwing: number, side: 'left' | 'right'): void {
  const s = side === 'right' ? 1 : -1;
  for (let f = 0; f < 4; f++) {
    const base = c[f] ?? c[0];
    h.fingers[f][0].rotation.x = -base * 0.75;
    h.fingers[f][1].rotation.x = -base * 1.0;
    h.fingers[f][2].rotation.x = -base * 0.85;
  }
  h.thumb[0].rotation.set(0.1, (0.5 + thumbSwing) * s, 0.0);
  h.thumb[1].rotation.x = -thumbCurl;
}
