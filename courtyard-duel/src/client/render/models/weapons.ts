import * as THREE from 'three';
import { WeaponId } from '../../../shared/config';
import { P, Mats, bar, box, curve, group, mats, mesh, side } from './kit';
import { mergeByMaterial } from './optimize';

export type WeaponKind = 'rifle' | 'pistol' | 'sniper' | 'smg';

export interface WeaponModel {
  id: WeaponId;
  kind: WeaponKind;
  root: THREE.Group;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  /** Hand anchors in weapon space. */
  gripR: THREE.Vector3;
  gripL: THREE.Vector3;
  /** Where the support hand goes to pull/insert the magazine. */
  magwell: THREE.Vector3;
  /** Resting viewmodel placement relative to the camera. */
  fp: { pos: THREE.Vector3; rot: THREE.Euler };
  /** Third-person: position of the weapon relative to the right-hand anchor, so gripR sits in the hand. */
  length: number;
  scope?: boolean;
}

const v = (x: number, y: number, f: number) => new THREE.Vector3(x, y, -f);

function finish(id: WeaponId, kind: WeaponKind, root: THREE.Group, o: Omit<WeaponModel, 'id' | 'kind' | 'root' | 'muzzle' | 'eject'> & { muzzleAt: THREE.Vector3; ejectAt: THREE.Vector3 }): WeaponModel {
  mergeByMaterial(root);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.copy(o.muzzleAt); root.add(muzzle);
  const eject = new THREE.Object3D(); eject.name = 'eject'; eject.position.copy(o.ejectAt); root.add(eject);
  root.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return { id, kind, root, muzzle, eject, gripR: o.gripR, gripL: o.gripL, magwell: o.magwell, fp: o.fp, length: o.length, scope: o.scope };
}

// ============================================================ AK-47
function buildAK(m: Mats): WeaponModel {
  const root = new THREE.Group();
  // stamped receiver (lower body + dust cover with the characteristic hump)
  root.add(mesh(side([[-0.1, -0.026], [-0.1, 0.045], [-0.04, 0.05], [0.12, 0.05], [0.165, 0.044], [0.165, -0.026]], 0.036, 0.003), m.darkSteel));
  root.add(mesh(side([[-0.085, 0.046], [-0.06, 0.06], [0.0, 0.065], [0.11, 0.065], [0.158, 0.057], [0.162, 0.046]], 0.031, 0.003), m.steel));
  root.add(mesh(side([[-0.05, -0.026], [0.09, -0.026], [0.09, -0.04], [-0.05, -0.04]], 0.032, 0.002), m.darkSteel));
  // trigger guard (ring) + trigger
  root.add(mesh(side([[-0.045, -0.038], [0.07, -0.038], [0.08, -0.058], [0.066, -0.078], [-0.03, -0.078], [-0.045, -0.06]], 0.011, 0.001,
    [[[-0.032, -0.046], [0.058, -0.046], [0.066, -0.058], [0.055, -0.07], [-0.022, -0.07], [-0.032, -0.06]]]), m.darkSteel));
  root.add(mesh(side([[0.0, -0.04], [0.011, -0.04], [0.006, -0.066], [-0.003, -0.066]], 0.005, 0.0008), m.darkSteel));
  // wood stock with slight drop + steel buttplate
  root.add(mesh(side([[-0.098, 0.04], [-0.2, 0.034], [-0.33, 0.012], [-0.335, -0.07], [-0.3, -0.074], [-0.2, -0.05], [-0.098, -0.02]], 0.034, 0.004), m.wood));
  root.add(mesh(side([[-0.33, 0.014], [-0.346, 0.012], [-0.35, -0.072], [-0.334, -0.07]], 0.038, 0.002), m.darkSteel));
  // pistol grip (swept back)
  root.add(mesh(side([[-0.036, -0.026], [0.002, -0.026], [-0.014, -0.118], [-0.056, -0.122]], 0.03, 0.004), m.darkWood));
  // curved banana magazine with ribs
  const magPts: P[] = [[0.034, -0.026], ...curve([0.034, -0.026], [0.05, -0.13], [0.115, -0.205], 10), [0.165, -0.198], ...curve([0.165, -0.198], [0.112, -0.125], [0.092, -0.026], 10).slice(0, -1), [0.092, -0.026]];
  const mag = group('mag', mesh(side(magPts, 0.032, 0.003), m.darkSteel));
  for (let i = 0; i < 5; i++) { const t = 0.14 + i * 0.17; const r = mesh(new THREE.BoxGeometry(0.034, 0.0025, 0.048), m.steel); r.position.set(0, -0.026 - t * 0.17, -(0.063 + t * 0.07)); r.rotation.x = -0.5; mag.add(r); }
  root.add(mag);
  // wooden lower handguard + upper handguard over the gas tube
  root.add(mesh(box(0.046, 0.04, 0.2, 0, -0.002, 0.265, 0.012), m.wood));
  root.add(mesh(bar(0.0215, 0.0215, 0.2, 0.37, 0, 0.044, 18), m.wood));
  // gas block, front sight, barrel, rod, slant muzzle brake
  root.add(mesh(bar(0.0105, 0.0105, 0.165, 0.5, 0, 0.026, 16), m.darkSteel));
  root.add(mesh(box(0.022, 0.034, 0.028, 0, 0.044, 0.385, 0.004), m.darkSteel));
  root.add(mesh(box(0.022, 0.05, 0.022, 0, 0.05, 0.45, 0.004), m.darkSteel));
  root.add(mesh(box(0.0035, 0.032, 0.005, 0, 0.092, 0.452, 0.0005), m.darkSteel));
  root.add(mesh(bar(0.0035, 0.0035, 0.16, 0.45, 0, 0.0035, 8), m.steel));
  root.add(mesh(bar(0.0142, 0.0142, 0.495, 0.545, 0, 0.026, 16), m.darkSteel));
  root.add(mesh(bar(0.0095, 0.0095, 0.545, 0.55, 0, 0.026, 16), m.black));
  // rear sight leaf
  root.add(mesh(box(0.016, 0.01, 0.045, 0, 0.07, 0.115, 0.002), m.darkSteel));
  root.add(mesh(side([[0.1, 0.073], [0.12, 0.073], [0.135, 0.094], [0.126, 0.094]], 0.011, 0.001), m.darkSteel));
  // charging handle (animated), selector lever, ejection port
  const bolt = group('bolt', mesh(box(0.012, 0.012, 0.03, 0.026, 0.034, 0.06, 0.002), m.steel), mesh(bar(0.003, 0.003, 0.05, 0.062, 0.018, 0.034, 8), m.steel));
  root.add(bolt);
  root.add(mesh(box(0.003, 0.01, 0.14, 0.0185, 0.0, 0.0, 0.001), m.steel));
  root.add(mesh(box(0.002, 0.022, 0.07, 0.0182, 0.026, 0.05, 0), m.black));
  return finish('ak47', 'rifle', root, {
    muzzleAt: v(0, 0.026, 0.552), ejectAt: v(0.02, 0.03, 0.05),
    gripR: v(0, -0.07, -0.03), gripL: v(0, -0.004, 0.27), magwell: v(0, -0.11, 0.08),
    fp: { pos: new THREE.Vector3(0.16, -0.205, -0.6), rot: new THREE.Euler(0.02, 0.05, 0) }, length: 0.9,
  });
}

// ============================================================ M4A4
function buildM4(m: Mats): WeaponModel {
  const root = new THREE.Group();
  // upper + lower receiver
  root.add(mesh(side([[-0.12, 0.03], [-0.12, 0.062], [-0.02, 0.07], [0.12, 0.07], [0.2, 0.066], [0.2, 0.02], [0.14, 0.015], [0.14, -0.03], [-0.12, -0.034]], 0.036, 0.003), m.darkSteel));
  root.add(mesh(side([[-0.085, -0.034], [0.145, -0.034], [0.145, -0.058], [0.08, -0.058], [0.05, -0.034]], 0.034, 0.002), m.darkSteel)); // magwell block
  // carry handle with rear sight
  root.add(mesh(side([[-0.1, 0.064], [-0.09, 0.098], [-0.05, 0.108], [0.07, 0.108], [0.1, 0.098], [0.108, 0.07]], 0.022, 0.003, [[[-0.055, 0.074], [-0.05, 0.096], [0.06, 0.096], [0.07, 0.074]]]), m.darkSteel));
  // pistol grip + trigger guard
  root.add(mesh(side([[-0.04, -0.034], [0.002, -0.034], [-0.014, -0.15], [-0.058, -0.152]], 0.033, 0.005), m.polymer));
  root.add(mesh(side([[-0.015, -0.034], [0.08, -0.034], [0.082, -0.06], [0.06, -0.074], [0.0, -0.074]], 0.01, 0.001, [[[0.0, -0.043], [0.07, -0.043], [0.07, -0.057], [0.055, -0.066], [0.006, -0.066]]]), m.polymer));
  root.add(mesh(side([[0.0, -0.04], [0.012, -0.04], [0.005, -0.068], [-0.004, -0.066]], 0.005, 0.0008), m.black));
  // stock: buffer tube + collapsible stock
  root.add(mesh(bar(0.018, 0.018, -0.24, -0.1, 0, 0.034, 16), m.darkSteel));
  root.add(mesh(side([[-0.1, 0.044], [-0.24, 0.038], [-0.31, 0.024], [-0.315, -0.062], [-0.27, -0.066], [-0.2, -0.036], [-0.1, -0.014]], 0.034, 0.004), m.polymer));
  root.add(mesh(side([[-0.31, 0.026], [-0.326, 0.022], [-0.33, -0.066], [-0.314, -0.062]], 0.038, 0.003), m.rubber));
  // STANAG magazine
  const mag = group('mag', mesh(side([[0.03, -0.034], [0.076, -0.034], [0.094, -0.2], [0.045, -0.204]], 0.03, 0.003), m.darkSteel),
    mesh(side([[0.044, -0.2], [0.096, -0.197], [0.098, -0.212], [0.046, -0.215]], 0.032, 0.002), m.polymer));
  for (let i = 0; i < 3; i++) { const r = mesh(box(0.032, 0.003, 0.05, 0, -0.07 - i * 0.04, 0.062 + i * 0.006, 0), m.steel); mag.add(r); }
  root.add(mag);
  // handguard with vents + barrel + flash hider
  root.add(mesh(bar(0.0295, 0.0295, 0.2, 0.46, 0, 0.034, 20), m.polymer));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.062, 0.009, 0.012, 0, 0.034, 0.24 + i * 0.037, 0), m.black));
  root.add(mesh(bar(0.0105, 0.0105, 0.46, 0.64, 0, 0.034, 16), m.steel));
  root.add(mesh(bar(0.0135, 0.0135, 0.64, 0.7, 0, 0.034, 16), m.darkSteel));
  for (let i = 0; i < 3; i++) root.add(mesh(box(0.032, 0.003, 0.012, 0, 0.034, 0.655 + i * 0.015, 0), m.black));
  // front sight post
  root.add(mesh(side([[0.52, 0.04], [0.55, 0.04], [0.548, 0.1], [0.53, 0.1]], 0.008, 0.001), m.darkSteel));
  // top rail ticks
  for (let i = 0; i < 9; i++) root.add(mesh(box(0.022, 0.006, 0.01, 0, 0.074, 0.14 + i * 0.012, 0), m.darkSteel));
  // charging handle + ejection port cover
  const bolt = group('bolt', mesh(side([[-0.12, 0.072], [-0.06, 0.072], [-0.06, 0.082], [-0.1, 0.082], [-0.125, 0.076]], 0.018, 0.002), m.darkSteel), mesh(box(0.012, 0.012, 0.03, 0.026, 0.045, 0.03, 0.002), m.steel));
  root.add(bolt);
  root.add(mesh(box(0.003, 0.03, 0.07, 0.0188, 0.04, 0.05, 0), m.black));
  return finish('m4a4', 'rifle', root, {
    muzzleAt: v(0, 0.034, 0.705), ejectAt: v(0.02, 0.04, 0.05),
    gripR: v(0, -0.09, -0.03), gripL: v(0, 0.0, 0.32), magwell: v(0, -0.12, 0.07),
    fp: { pos: new THREE.Vector3(0.16, -0.21, -0.6), rot: new THREE.Euler(0.02, 0.05, 0) }, length: 1.0,
  });
}

// ============================================================ AWP
function buildAWP(m: Mats): WeaponModel {
  const root = new THREE.Group();
  // olive polymer stock with thumbhole + cheek riser
  const stock: P[] = [[-0.36, 0.045], [-0.34, -0.12], [-0.28, -0.125], [-0.2, -0.07], [-0.1, -0.075], [-0.07, -0.16], [-0.01, -0.165], [0.0, -0.06],
    [0.2, -0.05], [0.42, -0.045], [0.44, -0.012], [0.2, -0.0], [0.0, 0.0], [-0.12, 0.0], [-0.2, 0.05], [-0.3, 0.07]];
  root.add(mesh(side(stock, 0.045, 0.006, [[[-0.2, -0.03], [-0.13, -0.035], [-0.13, -0.065], [-0.18, -0.065]]]), m.olive));
  // action / receiver
  root.add(mesh(bar(0.0225, 0.0225, -0.05, 0.19, 0, 0.026, 20), m.darkSteel));
  root.add(mesh(box(0.04, 0.03, 0.2, 0, 0.0, 0.07, 0.004), m.darkSteel));
  // bolt (animated): body + swept handle with knob
  const bolt = group('bolt', mesh(bar(0.012, 0.012, -0.07, 0.0, 0, 0.034, 12), m.steel),
    mesh(bar(0.004, 0.004, 0.0, 0.0001, 0, 0, 6), m.steel));
  const h = mesh(bar(0.005, 0.005, 0, 0.07, 0, 0, 8), m.steel); h.rotation.set(0, 0, 0); h.position.set(0.0, 0, 0);
  const handle = group('handle', mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 8), m.steel), mesh(new THREE.SphereGeometry(0.014, 14, 10), m.black));
  (handle.children[0] as THREE.Mesh).rotation.z = Math.PI / 2; (handle.children[0] as THREE.Mesh).position.set(0.04, 0, 0);
  (handle.children[1] as THREE.Mesh).position.set(0.085, -0.008, 0);
  handle.position.set(0.0, 0.032, 0.012 * -1);
  handle.rotation.z = -0.5;
  bolt.add(handle);
  bolt.position.set(0, 0, 0);
  root.add(bolt);
  // trigger guard + trigger + magazine box
  root.add(mesh(side([[-0.02, -0.014], [0.08, -0.014], [0.09, -0.04], [0.07, -0.068], [-0.015, -0.068], [-0.025, -0.045]], 0.01, 0.001,
    [[[-0.008, -0.025], [0.07, -0.025], [0.075, -0.04], [0.062, -0.057], [-0.003, -0.057], [-0.012, -0.044]]]), m.darkSteel));
  const mag = group('mag', mesh(box(0.034, 0.075, 0.095, 0, -0.045, 0.1, 0.004), m.darkSteel));
  root.add(mag);
  // heavy barrel + fluted shroud + muzzle brake
  root.add(mesh(bar(0.0135, 0.0125, 0.19, 0.52, 0, 0.026, 20), m.steel));
  root.add(mesh(bar(0.0115, 0.0115, 0.52, 0.76, 0, 0.026, 20), m.steel));
  root.add(mesh(bar(0.0185, 0.0185, 0.76, 0.84, 0, 0.026, 20), m.darkSteel));
  for (let i = 0; i < 4; i++) root.add(mesh(box(0.05, 0.004, 0.008, 0, 0.026, 0.775 + i * 0.016, 0), m.black));
  // scope: mounts, main tube, objective bell, eyepiece, turrets, lenses
  for (const f of [0.0, 0.2]) root.add(mesh(side([[f - 0.025, 0.04], [f + 0.025, 0.04], [f + 0.02, 0.07], [f - 0.02, 0.07]], 0.025, 0.002), m.darkSteel));
  const tube = mesh(bar(0.0155, 0.0155, -0.12, 0.34, 0, 0.088, 24), m.darkSteel);
  root.add(tube);
  root.add(mesh(bar(0.0155, 0.0245, 0.3, 0.4, 0, 0.088, 24), m.darkSteel));
  root.add(mesh(bar(0.0245, 0.0245, 0.4, 0.43, 0, 0.088, 24), m.black));
  root.add(mesh(bar(0.0155, 0.0225, -0.17, -0.12, 0, 0.088, 24), m.darkSteel));
  const lensF = mesh(new THREE.CircleGeometry(0.0225, 24), m.glass); lensF.position.set(0, 0.088, -0.428); lensF.rotation.y = Math.PI;
  root.add(lensF);
  const lensR = mesh(new THREE.CircleGeometry(0.0205, 24), m.glass); lensR.position.set(0, 0.088, 0.1695); root.add(lensR);
  root.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.03, 12), m.steel)).position.set(0, 0.114, -0.1);
  const t2 = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.03, 12), m.steel); t2.rotation.z = Math.PI / 2; t2.position.set(0.026, 0.088, -0.13); root.add(t2);
  root.add(mesh(bar(0.017, 0.017, 0.06, 0.12, 0, 0.088, 20), m.steel));
  // bipod legs folded
  for (const s of [-1, 1]) { const l = mesh(bar(0.004, 0.004, 0.36, 0.5, s * 0.02, -0.02, 6), m.darkSteel); l.rotation.z = s * 0.1; root.add(l); }
  return finish('awp', 'sniper', root, {
    muzzleAt: v(0, 0.026, 0.845), ejectAt: v(0.025, 0.034, 0.02),
    gripR: v(0, -0.105, -0.045), gripL: v(0, -0.02, 0.28), magwell: v(0, -0.06, 0.1),
    fp: { pos: new THREE.Vector3(0.17, -0.235, -0.78), rot: new THREE.Euler(0.02, 0.05, 0) }, length: 1.2, scope: true,
  });
}

// ============================================================ MP5
function buildMP5(m: Mats): WeaponModel {
  const root = new THREE.Group();
  // round receiver (tube) + lower housing
  root.add(mesh(bar(0.025, 0.025, -0.16, 0.2, 0, 0.034, 22), m.darkSteel));
  root.add(mesh(side([[-0.12, 0.012], [0.19, 0.012], [0.19, -0.034], [-0.12, -0.034]], 0.038, 0.004), m.polymer));
  // trigger group + grip
  root.add(mesh(side([[-0.07, -0.034], [-0.03, -0.034], [-0.052, -0.148], [-0.098, -0.152]], 0.033, 0.005), m.polymer));
  root.add(mesh(side([[-0.025, -0.034], [0.07, -0.034], [0.074, -0.06], [0.054, -0.075], [-0.01, -0.075]], 0.01, 0.001,
    [[[-0.012, -0.044], [0.062, -0.044], [0.062, -0.058], [0.05, -0.066], [-0.002, -0.066]]]), m.polymer));
  root.add(mesh(side([[-0.015, -0.04], [-0.003, -0.04], [-0.01, -0.066], [-0.02, -0.064]], 0.005, 0.0008), m.black));
  // fixed stock
  root.add(mesh(side([[-0.155, 0.04], [-0.33, 0.032], [-0.35, -0.06], [-0.32, -0.064], [-0.25, -0.02], [-0.155, -0.002]], 0.03, 0.004), m.polymer));
  root.add(mesh(side([[-0.33, 0.034], [-0.345, 0.03], [-0.365, -0.06], [-0.35, -0.062]], 0.034, 0.002), m.rubber));
  // curved 30 rd magazine
  const magPts: P[] = [[0.05, -0.034], ...curve([0.05, -0.034], [0.056, -0.12], [0.085, -0.21], 10), [0.138, -0.2], ...curve([0.138, -0.2], [0.108, -0.12], [0.098, -0.034], 10).slice(0, -1), [0.098, -0.034]];
  const mag = group('mag', mesh(side(magPts, 0.03, 0.003), m.darkSteel));
  for (let i = 0; i < 5; i++) { const r = mesh(box(0.032, 0.003, 0.034, 0, -0.05 - i * 0.03, 0.074 + i * 0.008, 0), m.steel); r.rotation.x = -0.35; mag.add(r); }
  root.add(mag);
  // handguard (tropical) + barrel sleeve + hooded front sight
  root.add(mesh(side([[0.2, 0.052], [0.4, 0.052], [0.4, -0.014], [0.2, -0.014]], 0.048, 0.01), m.polymer));
  for (let i = 0; i < 4; i++) root.add(mesh(box(0.05, 0.003, 0.012, 0, -0.008 + i * 0.0, 0.25 + i * 0.03, 0), m.black));
  root.add(mesh(bar(0.0115, 0.0115, 0.4, 0.46, 0, 0.034, 14), m.darkSteel));
  root.add(mesh(bar(0.0175, 0.0175, 0.4, 0.43, 0, 0.034, 18), m.darkSteel));
  root.add(mesh(side([[0.39, 0.054], [0.46, 0.054], [0.455, 0.07], [0.395, 0.07]], 0.03, 0.002), m.darkSteel));
  root.add(mesh(side([[0.405, 0.066], [0.425, 0.066], [0.42, 0.098], [0.41, 0.098]], 0.006, 0.0008), m.darkSteel));
  root.add(mesh(bar(0.015, 0.015, 0.43, 0.445, 0, 0.087, 12), m.darkSteel));
  // rear drum sight
  root.add(mesh(bar(0.011, 0.011, 0.14, 0.17, 0, 0.074, 14), m.darkSteel).rotateZ(0));
  // charging handle (animated) + ejection port
  const bolt = group('bolt', mesh(side([[0.2, 0.01], [0.26, 0.01], [0.26, 0.02], [0.2, 0.02]], 0.014, 0.002), m.steel));
  bolt.position.set(0.028, 0.02, 0);
  root.add(bolt);
  root.add(mesh(box(0.003, 0.02, 0.06, 0.0195, 0.016, 0.06, 0), m.black));
  return finish('mp5', 'smg', root, {
    muzzleAt: v(0, 0.034, 0.465), ejectAt: v(0.02, 0.018, 0.06),
    gripR: v(0, -0.092, -0.07), gripL: v(0, -0.0, 0.3), magwell: v(0, -0.12, 0.09),
    fp: { pos: new THREE.Vector3(0.16, -0.2, -0.56), rot: new THREE.Euler(0.02, 0.05, 0) }, length: 0.7,
  });
}

// ============================================================ Desert Eagle
function buildDeagle(m: Mats): WeaponModel {
  const root = new THREE.Group();
  // chunky frame with long barrel housing, wedge-shaped slide, top rail
  root.add(mesh(side([[-0.07, 0.006], [0.17, 0.006], [0.205, -0.008], [0.205, -0.022], [0.052, -0.024], [0.034, -0.044], [-0.07, -0.044]], 0.03, 0.004), m.alu));
  const slide = group('slide',
    mesh(side([[-0.085, 0.06], [-0.086, 0.008], [0.2, 0.008], [0.222, 0.024], [0.222, 0.056], [0.2, 0.062], [-0.07, 0.064]], 0.032, 0.004), m.chrome),
    mesh(box(0.014, 0.007, 0.2, 0, 0.066, 0.07, 0.001), m.chrome));
  for (let i = 0; i < 6; i++) slide.add(mesh(box(0.034, 0.036, 0.0035, 0, 0.034, -0.072 + i * 0.0095, 0), m.steel));
  slide.add(mesh(box(0.002, 0.018, 0.05, 0.0165, 0.04, 0.07, 0), m.black));
  slide.add(mesh(box(0.006, 0.013, 0.01, 0, 0.072, 0.212, 0.001), m.black));
  slide.add(mesh(box(0.02, 0.009, 0.01, 0, 0.072, -0.072, 0.001), m.black));
  root.add(slide);
  root.add(mesh(box(0.022, 0.024, 0.02, 0, 0.026, 0.225, 0.002), m.black));
  // rubber grip with finger grooves
  root.add(mesh(side([[-0.074, -0.01], [0.036, -0.01], [0.014, -0.122], [-0.078, -0.122]], 0.036, 0.006), m.rubber));
  for (let i = 0; i < 5; i++) root.add(mesh(box(0.038, 0.003, 0.085, 0, -0.03 - i * 0.017, -0.018, 0), m.black));
  root.add(mesh(side([[0.04, -0.024], [0.14, -0.024], [0.145, -0.044], [0.126, -0.06], [0.056, -0.06], [0.046, -0.044]], 0.009, 0.001,
    [[[0.05, -0.032], [0.132, -0.032], [0.136, -0.043], [0.12, -0.052], [0.06, -0.052], [0.054, -0.043]]]), m.alu));
  root.add(mesh(side([[0.075, -0.028], [0.086, -0.028], [0.081, -0.05], [0.072, -0.05]], 0.005, 0.0008), m.black));
  root.add(mesh(side([[-0.09, 0.04], [-0.076, 0.04], [-0.07, 0.062], [-0.086, 0.066]], 0.008, 0.001), m.darkSteel));
  const mag = group('mag', mesh(box(0.028, 0.016, 0.07, 0, -0.124, -0.012, 0.003), m.darkSteel));
  root.add(mag);
  return finish('deagle', 'pistol', root, {
    muzzleAt: v(0, 0.026, 0.233), ejectAt: v(0.018, 0.04, 0.05),
    gripR: v(0, -0.05, -0.01), gripL: v(0.0, -0.05, 0.0), magwell: v(0, -0.12, -0.012),
    fp: { pos: new THREE.Vector3(0.115, -0.15, -0.42), rot: new THREE.Euler(0.03, 0.04, 0) }, length: 0.27,
  });
}

// ============================================================ Glock 18
function buildGlock(m: Mats): WeaponModel {
  const root = new THREE.Group();
  // polymer frame + grip (angled), stippling and finger grooves
  root.add(mesh(side([[-0.072, 0.006], [0.115, 0.006], [0.115, -0.014], [0.048, -0.018], [0.04, -0.04], [-0.068, -0.04]], 0.028, 0.004), m.polymer));
  root.add(mesh(side([[-0.068, 0.0], [0.034, 0.0], [0.012, -0.108], [-0.072, -0.108]], 0.029, 0.005), m.polymer));
  for (let i = 0; i < 4; i++) root.add(mesh(box(0.031, 0.0035, 0.06, 0, -0.03 - i * 0.017, -0.016, 0), m.black));
  // slide with front/rear serrations
  const slide = group('slide',
    mesh(side([[-0.08, 0.052], [-0.08, 0.008], [0.12, 0.008], [0.126, 0.02], [0.126, 0.05], [0.112, 0.054], [-0.064, 0.055]], 0.027, 0.004), m.darkSteel),
    mesh(side([[-0.078, 0.055], [-0.066, 0.056], [0.112, 0.056], [0.124, 0.05]], 0.022, 0.002), m.steel));
  for (let i = 0; i < 6; i++) slide.add(mesh(box(0.029, 0.034, 0.0028, 0, 0.032, -0.068 + i * 0.0075, 0), m.black));
  for (let i = 0; i < 3; i++) slide.add(mesh(box(0.029, 0.03, 0.0028, 0, 0.032, 0.085 + i * 0.0075, 0), m.black));
  slide.add(mesh(box(0.002, 0.016, 0.04, 0.0138, 0.036, 0.04, 0), m.black));
  slide.add(mesh(box(0.005, 0.009, 0.009, 0, 0.0625, 0.116, 0.001), m.black));
  slide.add(mesh(box(0.017, 0.008, 0.011, 0, 0.0625, -0.07, 0.001), m.black));
  root.add(slide);
  root.add(mesh(box(0.014, 0.012, 0.01, 0, 0.024, 0.128, 0.001), m.black));
  // trigger guard, trigger, rail
  root.add(mesh(side([[0.028, -0.016], [0.1, -0.016], [0.105, -0.034], [0.09, -0.05], [0.042, -0.05], [0.034, -0.034]], 0.009, 0.001,
    [[[0.038, -0.024], [0.092, -0.024], [0.095, -0.033], [0.084, -0.042], [0.05, -0.042], [0.044, -0.034]]]), m.polymer));
  root.add(mesh(side([[0.058, -0.018], [0.068, -0.018], [0.064, -0.04], [0.055, -0.04]], 0.005, 0.0008), m.black));
  root.add(mesh(box(0.018, 0.005, 0.045, 0, -0.016, 0.085, 0.001), m.polymer));
  const mag = group('mag', mesh(box(0.024, 0.016, 0.052, 0, -0.108, -0.018, 0.003), m.darkSteel));
  root.add(mag);
  return finish('glock', 'pistol', root, {
    muzzleAt: v(0, 0.024, 0.132), ejectAt: v(0.014, 0.036, 0.04),
    gripR: v(0, -0.05, -0.015), gripL: v(0, -0.05, -0.015), magwell: v(0, -0.105, -0.018),
    fp: { pos: new THREE.Vector3(0.115, -0.15, -0.42), rot: new THREE.Euler(0.03, 0.04, 0) }, length: 0.2,
  });
}

const BUILDERS: Record<WeaponId, (m: Mats) => WeaponModel> = {
  ak47: buildAK, m4a4: buildM4, awp: buildAWP, mp5: buildMP5, deagle: buildDeagle, glock: buildGlock,
};

const templates = new Map<WeaponId, WeaponModel>();
/** Build (once) and clone a weapon model. Clones share geometry/materials; animated parts are found by name. */
export function createWeapon(id: WeaponId): WeaponModel {
  let t = templates.get(id);
  if (!t) { t = BUILDERS[id](mats()); templates.set(id, t); }
  const root = t.root.clone(true);
  return {
    ...t,
    root,
    muzzle: root.getObjectByName('muzzle')!,
    eject: root.getObjectByName('eject')!,
    gripR: t.gripR.clone(), gripL: t.gripL.clone(), magwell: t.magwell.clone(),
    fp: { pos: t.fp.pos.clone(), rot: t.fp.rot.clone() },
  };
}
