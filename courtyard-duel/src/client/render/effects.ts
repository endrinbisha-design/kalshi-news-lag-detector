import * as THREE from 'three';
import { Mat } from '../../shared/map';
import { World } from '../../shared/world';
import { makeFlashTexture, makeHoleTextures } from './textures';

/** Single-draw-call GPU point particles (dust, sparks, blood). */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array;
  private vel: Float32Array; private life: Float32Array; private maxLife: Float32Array; private grav: Float32Array; private startSize: Float32Array; private growth: Float32Array;
  private next = 0;
  constructor(readonly capacity = 640) {
    const n = capacity;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.grav = new Float32Array(n); this.startSize = new Float32Array(n); this.growth = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vColor; void main(){ vec2 c=gl_PointCoord-0.5; float d=dot(c,c)*4.0; if(d>1.0) discard; float a=(1.0-d); a=a*a; gl_FragColor=vec4(vColor.rgb, vColor.a*a); }`,
      fog: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) this.life[i] = 0;
  }
  setScale(h: number): void { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9; }
  spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, alpha: number, size: number, life: number, grav: number, growth = 0): void {
    const i = this.next; this.next = (this.next + 1) % this.capacity;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b, alpha], i * 4);
    this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.startSize[i] = size; this.size[i] = size; this.growth[i] = growth;
  }
  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.max(0, 1 - 2.2 * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.startSize[i] * (1 + this.growth[i] * (1 - k));
      this.col[i * 4 + 3] *= (1 - dt * 2.4 * (1 - k * 0.5));
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Tracer { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; t: number; dist: number; speed: number; len: number; active: boolean }
interface Shell { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number; bounces: number; active: boolean; rest: boolean }

const DUST: Record<Mat, number> = { stone: 0xcfc3ab, plaster: 0xe3d7bf, sand: 0xd9bf8a, pavers: 0xb8bcc2, wood: 0xb08c5a, metal: 0xb8b8b8, trim: 0xb9c6d6 };

export class Effects {
  readonly group = new THREE.Group();
  private particles = new Particles();
  private tracers: Tracer[] = [];
  private shells: Shell[] = [];
  private holes: THREE.Mesh[] = [];
  private holeAge: number[] = [];
  private holeMats: Record<string, THREE.MeshStandardMaterial> = {};
  private holeIdx = 0;
  private flashes: { sprite: THREE.Sprite; t: number }[] = [];
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private lightT = 0;

  constructor(private scene: THREE.Scene, private world: World, private light: THREE.PointLight) {
    this.group.add(this.particles.points);
    // tracers
    const tm = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const tg = new THREE.BoxGeometry(0.016, 0.016, 1);
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(tg, tm.clone());
      m.visible = false; m.frustumCulled = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0, dist: 0, speed: 380, len: 3, active: false });
    }
    // shells
    const sg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 8); sg.rotateX(Math.PI / 2);
    const sm = new THREE.MeshStandardMaterial({ color: 0xcaa24a, metalness: 1, roughness: 0.3 });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(sg, sm); m.visible = false; m.castShadow = false;
      this.group.add(m);
      this.shells.push({ mesh: m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, bounces: 0, active: false, rest: false });
    }
    // bullet holes
    const tex = makeHoleTextures();
    for (const k of Object.keys(tex)) {
      this.holeMats[k] = new THREE.MeshStandardMaterial({ map: tex[k], transparent: true, depthWrite: false, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    }
    const hg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 56; i++) {
      const m = new THREE.Mesh(hg, this.holeMats.stone);
      m.visible = false; m.receiveShadow = true;
      this.group.add(m); this.holes.push(m); this.holeAge.push(0);
    }
    // world-space muzzle flash sprites (opponent)
    const fm = new THREE.SpriteMaterial({ map: makeFlashTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(fm.clone()); s.visible = false; this.group.add(s);
      this.flashes.push({ sprite: s, t: 0 });
    }
    scene.add(this.group);
  }

  setRenderHeight(h: number): void { this.particles.setScale(h); }

  /** Streak that travels from a to b. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const tr = this.tracers.find((t) => !t.active) ?? this.tracers[0];
    tr.a.copy(a); tr.b.copy(b); tr.t = 0; tr.dist = a.distanceTo(b); tr.active = true; tr.len = Math.min(4, Math.max(0.8, tr.dist * 0.25));
    (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    tr.mesh.visible = true;
  }

  muzzleFlash(pos: THREE.Vector3, strength = 1): void {
    const f = this.flashes.find((x) => x.t <= 0) ?? this.flashes[0];
    f.sprite.position.copy(pos); f.t = 0.05; f.sprite.visible = true;
    f.sprite.scale.setScalar(0.35 * strength * (0.8 + Math.random() * 0.4));
    this.light.position.copy(pos); this.light.intensity = 14 * strength; this.lightT = 0.05;
  }

  /** Impact on a world surface: dust puff, sparks/chips and a bullet hole. */
  impact(p: THREE.Vector3, n: THREE.Vector3, mat: Mat, hole = true): void {
    const c = this.tmpC.setHex(DUST[mat] ?? 0xcccccc);
    const cnt = mat === 'sand' ? 9 : 6;
    for (let i = 0; i < cnt; i++) {
      const v = this.tmpV.set((Math.random() - 0.5) * 1.1, (Math.random() - 0.2) * 0.9, (Math.random() - 0.5) * 1.1).addScaledVector(n, 0.9 + Math.random() * 1.3);
      this.particles.spawn(p, v, c, 0.55, 0.12 + Math.random() * 0.12, 0.7 + Math.random() * 0.5, 0.4, 1.5);
    }
    if (mat === 'metal' || mat === 'stone' || mat === 'pavers' || mat === 'trim') {
      const sc = new THREE.Color(mat === 'metal' ? 0xffe2a0 : 0xfff0c8);
      for (let i = 0; i < (mat === 'metal' ? 7 : 4); i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3).addScaledVector(n, 2.5);
        this.particles.spawn(p, v, sc, 1, 0.03, 0.25 + Math.random() * 0.2, 9, 0);
      }
    }
    if (mat === 'wood') {
      const sc = new THREE.Color(0xc79a62);
      for (let i = 0; i < 5; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).addScaledVector(n, 1.5);
        this.particles.spawn(p, v, sc, 1, 0.04, 0.5, 8, 0);
      }
    }
    if (hole) this.bulletHole(p, n, mat);
  }

  private bulletHole(p: THREE.Vector3, n: THREE.Vector3, mat: Mat): void {
    const i = this.holeIdx; this.holeIdx = (this.holeIdx + 1) % this.holes.length;
    const m = this.holes[i];
    m.material = this.holeMats[mat] ?? this.holeMats.stone;
    const s = mat === 'sand' ? 0.16 : mat === 'metal' ? 0.1 : 0.13;
    m.scale.setScalar(s * (0.85 + Math.random() * 0.4));
    m.position.copy(p).addScaledVector(n, 0.004);
    m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.visible = true; this.holeAge[i] = 0;
  }

  blood(p: THREE.Vector3, dir: THREE.Vector3, amount: number, color = 0x8a0f0f): void {
    const c = this.tmpC.setHex(color);
    for (let i = 0; i < amount; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 1.2, (Math.random() - 0.5) * 1.4).addScaledVector(dir, 1.5 + Math.random() * 2);
      this.particles.spawn(p, v, c, 0.85, 0.05 + Math.random() * 0.06, 0.5 + Math.random() * 0.4, 5, 0.6);
    }
  }

  /** Eject a brass casing from `at` with initial velocity relative to world. */
  shell(at: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, scale = 1): void {
    const s = this.shells.find((x) => !x.active) ?? this.shells[0];
    s.active = true; s.rest = false; s.life = 3.5; s.bounces = 0;
    s.mesh.visible = true; s.mesh.position.copy(at); s.mesh.scale.setScalar(scale);
    s.v.copy(right).multiplyScalar(1.6 + Math.random() * 0.8).addScaledVector(up, 1.4 + Math.random() * 0.8);
    s.v.x += (Math.random() - 0.5) * 0.4; s.v.z += (Math.random() - 0.5) * 0.4;
    s.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }

  clearDecals(): void {
    for (const h of this.holes) h.visible = false;
    for (const s of this.shells) { s.active = false; s.mesh.visible = false; }
  }

  update(dt: number): void {
    this.particles.update(dt);
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt;
      const head = t.t * t.speed, tail = head - t.len;
      if (tail >= t.dist) { t.active = false; t.mesh.visible = false; continue; }
      const h = Math.min(head, t.dist), tl = Math.max(0, tail);
      const L = Math.max(0.01, h - tl);
      const mid = (h + tl) / 2;
      t.mesh.position.copy(t.a).lerp(t.b, mid / Math.max(0.001, t.dist));
      t.mesh.scale.set(1, 1, L);
      t.mesh.lookAt(t.b);
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - tl / Math.max(1, t.dist) * 0.6);
    }
    for (const f of this.flashes) {
      if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.sprite.visible = false; else (f.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * 6.28; }
    }
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
    for (const s of this.shells) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; s.mesh.visible = false; continue; }
      if (s.rest) continue;
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.spin.x * dt; s.mesh.rotation.y += s.spin.y * dt; s.mesh.rotation.z += s.spin.z * dt;
      const g = this.world.groundHeight(s.mesh.position.x, s.mesh.position.z, 0.01, s.mesh.position.y + 0.3).h;
      if (s.mesh.position.y < g + 0.006) {
        s.mesh.position.y = g + 0.006;
        if (s.bounces++ < 2) { s.v.y = Math.abs(s.v.y) * 0.35; s.v.x *= 0.5; s.v.z *= 0.5; s.spin.multiplyScalar(0.5); }
        else { s.rest = true; s.mesh.rotation.x = 0; s.mesh.rotation.z = 0; }
      }
    }
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      if (!h.visible) continue;
      this.holeAge[i] += dt;
      if (this.holeAge[i] > 45) h.visible = false;
    }
  }
}
