import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WEAPONS, WeaponId } from '../../../shared/config';
import { lerp } from '../../../shared/math';
import { HandRig, curlHand, freezeHand, makeHand, makeSegment, placeSegment, solveTwoBone } from './limbs';
import { mergeByMaterial } from './optimize';
import { Mats, mats, mesh } from './kit';
import { WeaponModel, createWeapon } from './weapons';

export interface TeamStyle { shirt: number; vest: number; helmet: number; pants: number; accent: number }
export const TEAM_STYLES: TeamStyle[] = [
  { shirt: 0x6b5f45, vest: 0x4d5238, helmet: 0x4d5238, pants: 0x5b5036, accent: 0xc9a24a }, // desert / olive
  { shirt: 0x2b3547, vest: 0x1d232e, helmet: 0x1d232e, pants: 0x232a38, accent: 0x6fa8ff }, // navy
];
export const DUMMY_STYLE: TeamStyle = { shirt: 0xd9d6cf, vest: 0xd35b2a, helmet: 0xd35b2a, pants: 0x4a4a4a, accent: 0xffffff };

export interface PoseInput {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  crouch: number;
  vx: number; vz: number;
  ground: boolean;
  alive: boolean;
  wid: WeaponId | null;
  reloading: boolean;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A tactical operator built from rounded primitives, animated with analytic IK for arms and legs. */
export class Character {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private weaponMount = new THREE.Group();
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private rHand: HandRig; private lHand: HandRig;
  private armSegs: THREE.Mesh[] = [];
  private legSegs: THREE.Mesh[] = [];
  private feet: THREE.Group[] = [];
  private phase = 0;
  private deadT = 0;
  private lastAlive = true;
  private smoothSpeed = 0;
  private reloadT = 0;
  private style: TeamStyle;
  private m: Mats;
  private tmp = { a: V(), b: V(), c: V(), d: V() };
  height = 1.8;

  constructor(style: TeamStyle) {
    this.style = style;
    this.m = mats();
    const m = this.m;
    const cloth = (c: number, rough = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, bumpMap: (m.rubber as any).bumpMap, bumpScale: 1.2 });
    const shirt = cloth(style.shirt);
    const vest = cloth(style.vest, 0.8);
    const pants = cloth(style.pants);
    const helmet = new THREE.MeshStandardMaterial({ color: style.helmet, roughness: 0.55, metalness: 0.1 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.75, metalness: 0 });
    const accent = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.6, metalness: 0.1 });

    this.hips.name = 'hips'; this.torso.name = 'torso'; this.head.name = 'head';
    this.root.add(this.hips);
    this.hips.add(this.torso);
    // ---- pelvis + belt
    const pelvis = mesh(new RoundedBoxGeometry(0.34, 0.2, 0.2, 3, 0.06), pants);
    pelvis.position.y = 0; this.hips.add(pelvis);
    const belt = mesh(new RoundedBoxGeometry(0.36, 0.05, 0.22, 2, 0.015), m.rubber); belt.position.y = 0.09; this.hips.add(belt);
    // ---- torso (shirt + plate carrier + pouches)
    const chest = mesh(new RoundedBoxGeometry(0.36, 0.5, 0.2, 4, 0.07), shirt);
    chest.position.y = 0.32; this.torso.add(chest);
    const carrier = mesh(new RoundedBoxGeometry(0.385, 0.42, 0.235, 4, 0.05), vest);
    carrier.position.y = 0.34; this.torso.add(carrier);
    for (const x of [-0.11, 0, 0.11]) { const p = mesh(new RoundedBoxGeometry(0.09, 0.11, 0.06, 2, 0.015), vest); p.position.set(x, 0.2, -0.135); this.torso.add(p); }
    const patch = mesh(new THREE.BoxGeometry(0.1, 0.05, 0.005), accent); patch.position.set(0.1, 0.43, -0.122); this.torso.add(patch);
    const pack = mesh(new RoundedBoxGeometry(0.3, 0.36, 0.14, 3, 0.04), vest); pack.position.set(0, 0.36, 0.17); this.torso.add(pack);
    // neck + head
    const neck = mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.1, 12), m.skin); neck.position.y = 0.6; this.torso.add(neck);
    this.torso.add(this.head);
    this.head.position.set(0, 0.7, 0);
    const skull = mesh(new THREE.SphereGeometry(0.105, 24, 18), m.skin); skull.scale.set(0.9, 1.08, 1.0); this.head.add(skull);
    const mask = mesh(new THREE.SphereGeometry(0.108, 24, 14, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), m.black); mask.scale.set(0.93, 1.08, 1.03); this.head.add(mask);
    const helm = mesh(new THREE.SphereGeometry(0.125, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), helmet); helm.position.y = 0.015; helm.scale.set(0.97, 0.95, 1.08); this.head.add(helm);
    const brim = mesh(new THREE.CylinderGeometry(0.128, 0.136, 0.018, 24), helmet); brim.position.set(0, 0.0, -0.01); brim.scale.set(1, 1, 1.12); this.head.add(brim);
    const goggles = mesh(new RoundedBoxGeometry(0.17, 0.05, 0.05, 2, 0.02), m.glass); goggles.position.set(0, 0.012, -0.1); this.head.add(goggles);
    const strap = mesh(new THREE.TorusGeometry(0.108, 0.012, 6, 24), m.rubber); strap.rotation.x = Math.PI / 2; strap.position.y = 0.012; strap.scale.set(0.95, 1.08, 1); this.head.add(strap);
    const nvg = mesh(new THREE.BoxGeometry(0.05, 0.04, 0.04), m.black); nvg.position.set(0, 0.09, -0.115); this.head.add(nvg);

    mergeByMaterial(this.hips, new Set(['torso', 'head']));
    // ---- limbs (segments stretched each frame)
    const armMat = shirt;
    for (let i = 0; i < 4; i++) { const s = makeSegment(i % 2 ? 0.038 : 0.046, i % 2 ? 0.034 : 0.04, armMat); this.armSegs.push(s); this.root.add(s); }
    for (let i = 0; i < 4; i++) { const s = makeSegment(i % 2 ? 0.055 : 0.075, i % 2 ? 0.05 : 0.058, pants); this.legSegs.push(s); this.root.add(s); }
    const mkFoot = () => {
      const f = new THREE.Group();
      const sole = mesh(new RoundedBoxGeometry(0.1, 0.09, 0.28, 2, 0.03), boot); sole.position.set(0, 0.045, -0.05); f.add(sole);
      const shaft = mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 12), boot); shaft.position.set(0, 0.14, 0.02); f.add(shaft);
      return f;
    };
    for (let i = 0; i < 2; i++) { const f = mkFoot(); this.feet.push(f); this.root.add(f); }
    // knee pads / joints
    this.rHand = makeHand('right'); this.lHand = makeHand('left');
    curlHand(this.rHand, [0.95, 1, 1.05, 1.1], 0.4, 0.3, 'right'); curlHand(this.lHand, [0.95, 1, 1.05, 1.1], 0.4, 0.3, 'left');
    freezeHand(this.rHand); freezeHand(this.lHand);
    this.root.add(this.rHand.root, this.lHand.root);
    this.root.add(this.weaponMount);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  setWeapon(id: WeaponId | null): void {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weapon) this.weaponMount.remove(this.weapon.root);
    this.weapon = null;
    if (id) {
      this.weapon = createWeapon(id);
      this.weapon.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
      this.weaponMount.add(this.weapon.root);
    }
  }

  private kick = 0;
  /** Visual weapon kick when this character fires. */
  recoilKick(): void { this.kick = 1; }
  get weaponModel(): WeaponModel | null { return this.weapon; }
  /** World position of the muzzle (valid after update). */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.weapon) return out.copy(this.root.position).setY(this.root.position.y + 1.4);
    this.weapon.root.updateWorldMatrix(true, false);
    return this.weapon.muzzle.getWorldPosition(out);
  }
  ejectWorld(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.weapon) return out.copy(this.root.position);
    return this.weapon.eject.getWorldPosition(out);
  }
  headWorld(out = new THREE.Vector3()): THREE.Vector3 { return this.head.getWorldPosition(out); }

  update(dt: number, p: PoseInput): void {
    const root = this.root;
    root.position.set(p.x, p.y, p.z);
    root.rotation.set(0, p.yaw, 0);
    this.setWeapon(p.wid);

    // ---- death: topple backwards
    if (!p.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
    } else this.deadT = Math.max(0, this.deadT - dt * 8);
    this.lastAlive = p.alive;
    const fall = this.deadT * this.deadT * (3 - 2 * this.deadT);

    const speed = Math.hypot(p.vx, p.vz);
    this.smoothSpeed += (speed - this.smoothSpeed) * Math.min(1, dt * 10);
    const moving = this.smoothSpeed > 0.25 && p.ground;
    if (moving) this.phase += dt * this.smoothSpeed * 2.1 / 1.0;

    // local velocity relative to facing -> lean
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const rightV = p.vx * cy - p.vz * sy; // along right vector (cos,-sin)
    const fwdV = p.vx * -sy + p.vz * -cy;

    // ---- pelvis height with crouch + bounce
    const standH = 0.93, crouchH = 0.62;
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.025 * Math.min(1, this.smoothSpeed / 4) : 0;
    const hipY = lerp(standH, crouchH, p.crouch) - bob + (p.ground ? 0 : 0.05);
    this.hips.position.set(0, hipY, 0.0);
    this.hips.rotation.set(0, 0, -rightV * 0.01);
    this.torso.rotation.set(THREE.MathUtils.clamp(-p.pitch * 0.45, -0.5, 0.5) + p.crouch * 0.18, 0, 0);
    this.torso.position.set(0, 0.1, 0);
    this.head.rotation.set(THREE.MathUtils.clamp(p.pitch * 0.55, -0.7, 0.7), 0, 0);
    root.updateMatrixWorld(true);

    // ---- feet (stride)
    const stride = Math.min(0.5, this.smoothSpeed * 0.1) * (1 - p.crouch * 0.4);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const ph = this.phase + (i === 0 ? 0 : Math.PI);
      const sw = moving ? Math.sin(ph) : 0;
      const lift = moving ? Math.max(0, Math.cos(ph)) * 0.12 * Math.min(1, this.smoothSpeed / 3) : 0;
      // stride direction along local velocity
      const dirX = moving ? rightV / this.smoothSpeed : 0, dirZ = moving ? -fwdV / this.smoothSpeed : 0;
      const fx = s * 0.1 + dirX * sw * stride;
      const fz = dirZ * sw * stride + (p.crouch > 0.5 ? -0.04 : 0);
      const fy = lift + (p.ground ? 0 : 0.2);
      const foot = this.feet[i];
      foot.position.set(fx, fy, fz);
      foot.rotation.set(0, 0, 0);
    }
    root.updateMatrixWorld(true);
    // legs via IK: hip joints under pelvis
    const hipL = this.hips.localToWorld(V(-0.09, -0.06, 0)), hipR = this.hips.localToWorld(V(0.09, -0.06, 0));
    const hipsW = [hipL, hipR];
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i];
      const ankleW = foot.localToWorld(V(0, 0.1, 0.02));
      const kneePole = root.localToWorld(V(i === 0 ? -0.05 : 0.05, 0.2, -1)).sub(root.position);
      const knee = solveTwoBone(hipsW[i], ankleW, 0.43, 0.43, kneePole.normalize());
      const inv = root.quaternion.clone().invert();
      const toR = (v: THREE.Vector3) => v.clone().sub(root.position).applyQuaternion(inv);
      placeSegment(this.legSegs[i * 2], toR(hipsW[i]), toR(knee));
      placeSegment(this.legSegs[i * 2 + 1], toR(knee), toR(ankleW));
    }

    // ---- weapon + arms
    const w = this.weapon;
    if (w) {
      const def = WEAPONS[w.id];
      // aim frame at the shoulders: yaw from root, pitch applied here
      this.torso.updateWorldMatrix(true, true);
      const shoulderR = this.torso.localToWorld(V(0.2, 0.5, 0));
      const shoulderL = this.torso.localToWorld(V(-0.2, 0.5, 0));
      const aimQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch * 0.9, p.yaw, 0, 'YXZ'));
      const pistol = w.kind === 'pistol';
      const reloadK = p.reloading ? 1 : 0;
      this.reloadT += (reloadK - this.reloadT) * Math.min(1, dt * 8);
      // weapon origin relative to right shoulder, in aim space
      const origin = pistol ? V(-0.02, -0.12, -0.42) : V(-0.04, -0.07, -0.28 + (w.kind === 'sniper' ? -0.06 : 0));
      origin.y -= this.reloadT * 0.08; origin.x += this.reloadT * 0.02;
      this.kick = Math.max(0, this.kick - dt * 9);
      origin.z += this.kick * 0.04; origin.y += this.kick * 0.012;
      const worldOrigin = origin.applyQuaternion(aimQ).add(shoulderR);
      this.weaponMount.position.copy(worldOrigin.sub(root.position).applyQuaternion(root.quaternion.clone().invert()));
      const localQ = root.quaternion.clone().invert().multiply(aimQ);
      this.weaponMount.quaternion.copy(localQ);
      this.weaponMount.updateWorldMatrix(true, true);
      void def;

      // hand targets
      const gripRw = w.root.localToWorld(w.gripR.clone());
      const gripLw = w.root.localToWorld((pistol ? w.gripR.clone().add(V(-0.04, -0.01, 0)) : w.gripL.clone()));
      const lTarget = this.reloadT > 0.5 ? w.root.localToWorld(w.magwell.clone().add(V(-0.03, -0.03, 0))) : gripLw;
      const place = (hand: HandRig, target: THREE.Vector3, pose: 'rg' | 'lu' | 'lp', side: 'left' | 'right') => {
        const qBase = aimQ.clone();
        const e = pose === 'rg' ? new THREE.Euler(0.35, 0, -Math.PI / 2) : pose === 'lu' ? new THREE.Euler(0, -Math.PI / 2, Math.PI) : new THREE.Euler(0.35, 0, Math.PI / 2);
        const q = qBase.multiply(new THREE.Quaternion().setFromEuler(e));
        const off = V(0, 0, 0.055).applyQuaternion(q);
        const worldPos = target.clone().add(off);
        hand.root.position.copy(worldPos).sub(root.position).applyQuaternion(root.quaternion.clone().invert());
        hand.root.quaternion.copy(root.quaternion.clone().invert().multiply(q));
        curlHand(hand, pose === 'lu' ? [0.9, 0.95, 1, 1] : [0.95, 1, 1.05, 1.1], 0.4, 0.3, side);
        return worldPos;
      };
      const rw = place(this.rHand, gripRw, 'rg', 'right');
      const lw = place(this.lHand, lTarget, pistol ? 'lp' : 'lu', 'left');
      // arms via IK in world space -> segments live in root space
      const toRoot = (v: THREE.Vector3) => v.clone().sub(root.position).applyQuaternion(root.quaternion.clone().invert());
      const arm = (sh: THREE.Vector3, wrist: THREE.Vector3, i: number, outward: number) => {
        const pole = V(outward, -0.7, 0.2).applyQuaternion(root.quaternion);
        const elbow = solveTwoBone(sh, wrist, 0.29, 0.27, pole);
        placeSegment(this.armSegs[i * 2], toRoot(sh), toRoot(elbow));
        placeSegment(this.armSegs[i * 2 + 1], toRoot(elbow), toRoot(wrist));
      };
      arm(shoulderR, rw, 0, 1);
      arm(shoulderL, lw, 1, -1);
      this.rHand.root.visible = this.lHand.root.visible = true;
      this.weaponMount.visible = true;
    } else {
      this.weaponMount.visible = false;
    }

    // ---- fall pose applied to whole body
    if (fall > 0) {
      root.rotation.x = fall * 1.45;
      root.position.y = p.y + fall * 0.12;
      root.position.addScaledVector(V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), -fall * 0.5 * 0 );
    } else root.rotation.x = 0;
  }
}

export function setLayerCast(o: THREE.Object3D, cast: boolean): void {
  o.traverse((c) => { c.castShadow = cast; });
}
