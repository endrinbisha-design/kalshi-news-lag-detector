import * as THREE from 'three';
import { WEAPONS, WeaponId } from '../../shared/config';
import { PlayerState } from '../../shared/player';
import { HandRig, curlHand, freezeHand, makeHand, makeSegment, placeSegment } from './models/limbs';
import { WeaponModel, createWeapon } from './models/weapons';
import { mats } from './models/kit';
import { makeFlashTexture } from './textures';

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const sstep = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
const lerp = THREE.MathUtils.lerp;

interface Pose { rot: THREE.Euler; curl: number[]; thumb: number; swing: number }

/** Hand poses are tuned per weapon kind (see preview ?view=fp). */
const R_GRIP: Pose = { rot: new THREE.Euler(0.35, 0.0, -Math.PI / 2), curl: [0.95, 1.0, 1.05, 1.1], thumb: 0.45, swing: 0.3 };
const L_UNDER: Pose = { rot: new THREE.Euler(0.0, -Math.PI / 2, Math.PI), curl: [0.9, 0.95, 1.0, 1.0], thumb: 0.3, swing: 0.3 };
const L_PISTOL: Pose = { rot: new THREE.Euler(0.35, 0.0, Math.PI / 2), curl: [0.9, 0.95, 1.0, 1.0], thumb: 0.15, swing: 0.4 };

/**
 * First-person weapon + arms. Rendered in a separate scene with its own camera so it never clips into walls.
 * All motion (bob, sway, recoil, reload, deploy, bolt cycle) is procedural and driven by the predicted player state.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private holder = new THREE.Group();
  private model: WeaponModel | null = null;
  private rHand: HandRig;
  private lHand: HandRig;
  private rArm = makeSegment(0.02, 0.03, mats().sleeveOlive);
  private lArm = makeSegment(0.02, 0.03, mats().sleeveOlive);
  private rEnd = new THREE.Vector3(0.26, -0.55, 0.3);
  private lEnd = new THREE.Vector3(-0.18, -0.62, 0.22);
  private flash: THREE.Sprite;
  private flashT = 0;
  private flashLen = 0.06;
  private mag: THREE.Object3D | null = null;
  private magRest = new THREE.Vector3();
  private bolt: THREE.Object3D | null = null;
  private boltRest = new THREE.Vector3();
  private slide: THREE.Object3D | null = null;
  private slideRest = new THREE.Vector3();
  private handle: THREE.Object3D | null = null;
  private handleRest = new THREE.Euler();
  private id: WeaponId | null = null;
  private kick = 0; private kickVel = 0;
  private sway = new THREE.Vector2();
  private bobPhase = 0;
  private bobAmt = 0;
  private landKick = 0;
  private lastCrouch = 0;
  private crouchOff = 0;
  private time = 0;
  private lastSlot = -1;
  private deployFrom = 0;
  visible = true;
  private frozen = false;
  private sleeve = mats().sleeveOlive;
  /** Cached world-space helper positions for effects. */
  readonly muzzleView = new THREE.Vector3();
  readonly ejectView = new THREE.Vector3();

  constructor() {
    this.root.add(this.holder);
    this.rHand = makeHand('right');
    this.lHand = makeHand('left');
    // fingers are posed once per weapon kind, then baked into one mesh each (saves ~30 draw calls)
    const fm = new THREE.SpriteMaterial({ map: makeFlashTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false });
    this.flash = new THREE.Sprite(fm);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
  }

  setSleeve(color: number): void {
    this.sleeve = mats().sleeveOlive.clone();
    this.sleeve.color.setHex(color);
    (this.rArm.material as THREE.Material) = this.sleeve;
    (this.lArm.material as THREE.Material) = this.sleeve;
  }

  setWeapon(id: WeaponId): void {
    if (this.id === id) return;
    this.id = id;
    if (this.model) this.holder.remove(this.model.root);
    const m = createWeapon(id);
    this.model = m;
    this.holder.add(m.root);
    m.root.add(this.rHand.root, this.lHand.root, this.rArm, this.lArm, this.flash);
    this.mag = m.root.getObjectByName('mag') ?? null;
    this.bolt = m.root.getObjectByName('bolt') ?? null;
    this.slide = m.root.getObjectByName('slide') ?? null;
    this.handle = m.root.getObjectByName('handle') ?? null;
    if (this.mag) this.magRest.copy(this.mag.position);
    if (this.bolt) this.boltRest.copy(this.bolt.position);
    if (this.slide) this.slideRest.copy(this.slide.position);
    if (this.handle) this.handleRest.copy(this.handle.rotation);
    this.holder.position.copy(m.fp.pos);
    this.holder.rotation.copy(m.fp.rot);
    this.flash.position.copy(m.muzzle.position);
    this.flash.scale.setScalar(0.001);
    this.poseHands();
  }

  private poseHands(): void {
    const m = this.model!;
    const placeHand = (h: HandRig, target: THREE.Vector3, pose: Pose, side: 'left' | 'right') => {
      h.root.rotation.copy(pose.rot);
      const off = new THREE.Vector3(0, 0, 0.055).applyEuler(pose.rot);
      h.root.position.copy(target).add(off);
      curlHand(h, pose.curl, pose.thumb, pose.swing, side);
    };
    placeHand(this.rHand, m.gripR, R_GRIP, 'right');
    if (m.kind === 'pistol') placeHand(this.lHand, m.gripR.clone().add(new THREE.Vector3(-0.045, -0.012, 0.0)), L_PISTOL, 'left');
    else placeHand(this.lHand, m.gripL, L_UNDER, 'left');
    if (!this.frozen) { freezeHand(this.rHand); freezeHand(this.lHand); this.frozen = true; }
  }

  /** Called when the local player fires (immediate response: kick + flash). */
  onFire(): void {
    const w = this.id ? WEAPONS[this.id] : null;
    const heavy = w ? Math.min(1.6, 0.5 + w.damage / 70) : 1;
    this.kickVel += 5.5 * heavy;
    this.flashT = 0.045;
    if (this.slide) this.slide.position.z = this.slideRest.z + 0.045;
    if (this.bolt && this.id !== 'awp') this.bolt.position.z = this.boltRest.z + 0.02;
  }

  onLand(speed: number): void { this.landKick = Math.min(1, speed / 9); }

  /** dt seconds; look = recent view delta in radians (yaw,pitch); speed = horizontal speed in m/s */
  update(dt: number, p: PlayerState, lookDX: number, lookDY: number, speedFrac: number, scoped: boolean): void {
    if (!this.model) return;
    this.time += dt;
    const m = this.model;
    const def = WEAPONS[p.wids[p.weapon]];
    this.root.visible = this.visible && !scoped;

    // ---- procedural idle/bob/sway
    this.bobAmt += (Math.min(1, speedFrac) * (p.ground ? 1 : 0) - this.bobAmt) * Math.min(1, dt * 10);
    this.bobPhase += dt * (6 + 5 * speedFrac) * (this.bobAmt > 0.05 ? 1 : 0);
    const bx = Math.sin(this.bobPhase) * 0.0035 * this.bobAmt;
    const by = Math.abs(Math.cos(this.bobPhase)) * -0.004 * this.bobAmt + Math.sin(this.time * 1.4) * 0.0012;
    this.sway.x += (-lookDX * 0.35 - this.sway.x) * Math.min(1, dt * 9);
    this.sway.y += (-lookDY * 0.35 - this.sway.y) * Math.min(1, dt * 9);
    const sx = THREE.MathUtils.clamp(this.sway.x, -0.06, 0.06), sy = THREE.MathUtils.clamp(this.sway.y, -0.05, 0.05);

    // ---- recoil kick spring
    const stiff = 120, damp = 14;
    this.kickVel += (-stiff * this.kick - damp * this.kickVel) * dt;
    this.kick += this.kickVel * dt;
    this.landKick *= Math.max(0, 1 - dt * 7);
    const crouchTarget = p.crouch * 0.012;
    this.crouchOff += (crouchTarget - this.crouchOff) * Math.min(1, dt * 10);

    // ---- deploy / switch
    if (this.lastSlot !== p.weapon) { this.lastSlot = p.weapon; }
    const deployT = p.switchT > 0 ? 1 - p.switchT / def.drawTime : 1;
    const dep = 1 - ease(deployT);

    // ---- reload (all procedural; progress rt in 0..1 from the predicted reload timer)
    const rt = p.reloadT > 0 ? 1 - p.reloadT / def.reloadTime : -1;
    const reloading = rt >= 0;
    let tiltZ = 0, tiltX = 0, lowerY = 0, magRot = 0, boltBack = 0, slideBack = 0;
    const leftOff = new THREE.Vector3();
    const magOff = new THREE.Vector3();
    if (reloading) {
      const rest = m.kind === 'pistol' ? m.gripR.clone().add(new THREE.Vector3(-0.045, -0.012, 0)) : m.gripL.clone();
      const well = m.magwell.clone().sub(rest).add(new THREE.Vector3(m.kind === 'pistol' ? -0.01 : -0.02, -0.03, 0.0));
      const pull = well.clone().add(new THREE.Vector3(-0.02, -0.17, 0.04));
      const far = well.clone().add(new THREE.Vector3(-0.12, -0.34, 0.1));
      const mix = (a: THREE.Vector3, b: THREE.Vector3, t: number) => new THREE.Vector3().lerpVectors(a, b, t);
      const zero = new THREE.Vector3();
      if (m.kind === 'sniper') {
        const open = sstep(0, 0.14, rt) * (1 - sstep(0.78, 0.92, rt));
        boltBack = open; tiltZ = 0.12 * open;
        if (rt < 0.22) leftOff.copy(mix(zero, well, sstep(0.08, 0.22, rt)));
        else if (rt < 0.34) leftOff.copy(mix(well, pull, sstep(0.22, 0.34, rt)));
        else if (rt < 0.46) leftOff.copy(mix(pull, far, sstep(0.34, 0.46, rt)));
        else if (rt < 0.58) leftOff.copy(mix(far, pull, sstep(0.46, 0.58, rt)));
        else if (rt < 0.7) leftOff.copy(mix(pull, well, sstep(0.58, 0.7, rt)));
        else leftOff.copy(mix(well, zero, sstep(0.7, 0.8, rt)));
        if (rt >= 0.22 && rt < 0.34) magOff.copy(leftOff).sub(well).add(new THREE.Vector3(0, 0, 0));
        else if (rt >= 0.34 && rt < 0.5) { magOff.set(-0.03, -0.45 * sstep(0.34, 0.5, rt), 0.05); magRot = 1.0 * sstep(0.34, 0.5, rt); }
        else if (rt >= 0.5 && rt < 0.7) magOff.copy(leftOff).sub(well).add(new THREE.Vector3(0, 0, 0));
      } else {
        const tilt = sstep(0, 0.12, rt) * (1 - sstep(0.9, 1, rt));
        tiltZ = 0.3 * tilt; tiltX = -0.1 * tilt; lowerY = -0.02 * tilt;
        const pistol = m.kind === 'pistol';
        const tOut = pistol ? 0.34 : 0.3, tFar = pistol ? 0.48 : 0.45, tBack = pistol ? 0.6 : 0.58, tIn = pistol ? 0.72 : 0.7;
        if (rt < 0.12) leftOff.copy(mix(zero, well, sstep(0, 0.12, rt)));
        else if (rt < 0.2) leftOff.copy(well);
        else if (rt < tOut) leftOff.copy(mix(well, pull, sstep(0.2, tOut, rt)));
        else if (rt < tFar) leftOff.copy(mix(pull, far, sstep(tOut, tFar, rt)));
        else if (rt < tBack) leftOff.copy(mix(far, pull, sstep(tFar, tBack, rt)));
        else if (rt < tIn) leftOff.copy(mix(pull, well, sstep(tBack, tIn, rt)));
        else leftOff.copy(mix(well, zero, sstep(tIn, 0.84, rt)));
        // magazine rides with the hand, drops when released, re-appears with the new one
        if (rt >= 0.2 && rt < tOut) magOff.copy(leftOff).sub(well);
        else if (rt >= tOut && rt < tFar) { const k = sstep(tOut, tFar, rt); magOff.set(-0.04 * k, -0.55 * k, 0.12 * k); magRot = 1.3 * k; }
        else if (rt >= tBack && rt < tIn) magOff.copy(leftOff).sub(well).add(new THREE.Vector3(0, -0.0, 0));
        if (pistol) slideBack = sstep(0.74, 0.8, rt) * (1 - sstep(0.82, 0.88, rt));
        else boltBack = sstep(0.76, 0.82, rt) * (1 - sstep(0.84, 0.9, rt));
      }
    }
    const magHidden = reloading && m.kind !== 'sniper' ? (rt > 0.4 && rt < 0.52) : reloading && rt > 0.44 && rt < 0.5;

    // ---- apply holder transform
    const base = m.fp;
    this.holder.position.set(
      base.pos.x + bx + sx * 0.15,
      base.pos.y + by - this.crouchOff - this.landKick * 0.03 + lowerY - dep * 0.32 + sy * 0.12,
      base.pos.z + this.kick * 0.02 + dep * 0.08,
    );
    this.holder.rotation.set(
      base.rot.x + this.kick * 0.035 + tiltX - dep * 0.9 + sy * 0.4 + this.landKick * 0.04,
      base.rot.y + sx * 0.5 + dep * 0.25,
      base.rot.z + tiltZ + bx * 4,
    );

    // ---- moving parts
    if (this.slide) {
      this.slide.position.z += (this.slideRest.z - this.slide.position.z) * Math.min(1, dt * 22);
      if (p.ammo[p.weapon] === 0 && !reloading) this.slide.position.z = this.slideRest.z + 0.045; // locked back when empty
      if (slideBack > 0) this.slide.position.z = this.slideRest.z + 0.045 * slideBack;
    }
    if (this.bolt) {
      if (this.id === 'awp') {
        // bolt cycle after a shot (cooldown) or during reload
        const cyc = def.rpm > 0 ? 60 / def.rpm : 1;
        const cd = p.cooldown / cyc; // 1 -> 0
        const cycle = reloading ? boltBack : (cd > 0 ? Math.sin(Math.min(1, (1 - cd) * 1.0) * Math.PI) * (cd < 0.85 ? 1 : 0) : 0);
        this.bolt.position.z = this.boltRest.z + cycle * 0.07;
        if (this.handle) this.handle.rotation.z = this.handleRest.z + cycle * 1.0;
      } else {
        const target = this.boltRest.z + boltBack * 0.05;
        this.bolt.position.z += (target - this.bolt.position.z) * Math.min(1, dt * (reloading ? 18 : 20));
      }
    }
    if (this.mag) {
      this.mag.position.copy(this.magRest).add(magOff);
      this.mag.rotation.z = magRot;
      this.mag.visible = !magHidden;
    }

    // ---- hands + forearms
    const lh = this.lHand.root;
    const basePose = m.kind === 'pistol' ? m.gripR.clone().add(new THREE.Vector3(-0.045, -0.012, 0.0)) : m.gripL;
    const poseL = m.kind === 'pistol' ? L_PISTOL : L_UNDER;
    const off = new THREE.Vector3(0, 0, 0.055).applyEuler(poseL.rot);
    lh.position.copy(basePose).add(off).add(leftOff);
    // forearms: wrist -> elbow anchored in view space
    this.updateArm(this.rArm, this.rHand.root.position, this.rEnd);
    this.updateArm(this.lArm, lh.position, this.lEnd);

    // ---- muzzle flash sprite
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      const k = Math.max(0, this.flashT / 0.045);
      const s = 0.22 * (0.7 + 0.5 * Math.random()) * (0.5 + k);
      this.flash.scale.setScalar(s);
      (this.flash.material as THREE.SpriteMaterial).rotation = Math.random() * 6.28;
      (this.flash.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.4);
    } else this.flash.visible = false;

    // ---- cached anchor points in view space
    this.holder.updateMatrixWorld(true);
    m.root.updateMatrixWorld(true);
    this.muzzleView.copy(m.muzzle.position).applyMatrix4(m.root.matrixWorld);
    this.ejectView.copy(m.eject.position).applyMatrix4(m.root.matrixWorld);
  }

  private updateArm(seg: THREE.Mesh, wristLocal: THREE.Vector3, elbowView: THREE.Vector3): void {
    if (!this.model) return;
    const root = this.model.root;
    root.updateMatrixWorld(true);
    const elbowLocal = root.worldToLocal(elbowView.clone().applyMatrix4(this.root.matrixWorld));
    placeSegment(seg, wristLocal, elbowLocal);
  }
}
