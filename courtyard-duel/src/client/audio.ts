import { WEAPONS, WeaponId, SfxParams } from '../shared/config';
import { Mat } from '../shared/map';

/**
 * Fully synthesised audio (no sample files): gunshots are built from a transient "crack", a low "body" thump and a room "tail"
 * using each weapon's SfxParams from the central config. Spatialised with HRTF panners, a shared convolution reverb and a
 * low-pass "occlusion" filter when a wall is between the source and the listener.
 */
export interface PlayOpts {
  pos?: { x: number; y: number; z: number };
  gain?: number;
  rate?: number;
  occluded?: boolean;
  reverb?: number;
  refDistance?: number;
}

const SR = 44100;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverbIn!: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private volume = 0.7;
  private sfxVolume = 1;
  private lastStepAt = 0;

  /** Must be called from a user gesture at least once. Safe to call repeatedly. */
  init(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ latencyHint: 'interactive', sampleRate: SR });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master); this.master.connect(comp); comp.connect(ctx.destination);
    // convolution reverb for the courtyard slap
    const conv = ctx.createConvolver();
    const len = Math.floor(SR * 1.4);
    const ir = ctx.createBuffer(2, len, SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); const r = rng(77 + c * 31);
      for (let i = 0; i < len; i++) { const t = i / SR; d[i] = r() * Math.exp(-t * 3.6) * (t < 0.012 ? t / 0.012 : 1) * 0.5; }
    }
    conv.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(conv);
    const revOut = ctx.createGain(); revOut.gain.value = 0.55;
    conv.connect(revOut); revOut.connect(this.sfx);
    this.applyVolume();
    this.build();
  }

  setVolume(master: number, sfx: number): void { this.volume = master; this.sfxVolume = sfx; this.applyVolume(); }
  private applyVolume(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volume;
    this.sfx.gain.value = this.sfxVolume;
  }

  setListener(pos: { x: number; y: number; z: number }, yaw: number, pitch: number): void {
    const ctx = this.ctx; if (!ctx) return;
    const l = ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------------ playback
  play(name: string, o: PlayOpts = {}): void {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const list = this.buffers.get(name);
    if (!list || !list.length) return;
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * 0.04);
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let node: AudioNode = src;
    if (o.occluded) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.4;
      node.connect(lp); node = lp; g.gain.value *= 0.55;
    }
    node.connect(g);
    let out: AudioNode = g;
    if (o.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = o.refDistance ?? 3; p.maxDistance = 200; p.rolloffFactor = 1.15;
      p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z;
      g.connect(p); out = p;
    }
    out.connect(this.sfx);
    const rv = o.reverb ?? 0;
    if (rv > 0) {
      const send = ctx.createGain(); send.gain.value = rv;
      out.connect(send); send.connect(this.reverbIn);
    }
    src.start();
  }

  shot(id: WeaponId, pos?: PlayOpts['pos'], occluded = false, listenerDist = 0): void {
    // distant shots lose their crack: add a little low-pass through occlusion-like damping beyond 40 m
    this.play('shot_' + id, { pos, gain: pos ? 1.15 : 1.0, occluded: occluded || listenerDist > 45, reverb: pos ? 0.4 : 0.25, refDistance: 6 });
  }
  step(surf: Mat, pos: PlayOpts['pos'], occluded: boolean): void {
    const s = surf === 'sand' ? 'step_sand' : surf === 'metal' ? 'step_metal' : surf === 'wood' ? 'step_wood' : 'step_stone';
    this.play(s, { pos, gain: 0.9, occluded, reverb: 0.1, refDistance: 2.2 });
  }
  impact(surf: Mat, pos: PlayOpts['pos'], occluded = false): void {
    const s = surf === 'metal' ? 'imp_metal' : surf === 'wood' ? 'imp_wood' : surf === 'sand' ? 'imp_sand' : 'imp_stone';
    this.play(s, { pos, gain: 0.8, occluded, reverb: 0.15, refDistance: 3 });
  }
  whiz(pos: PlayOpts['pos']): void { this.play('whiz', { pos, gain: 0.8, refDistance: 2 }); }
  ui(name: string, gain = 1): void { this.play(name, { gain }); }

  // ------------------------------------------------------------------ synthesis
  private add(name: string, ...b: Float32Array[]): void {
    const ctx = this.ctx!;
    this.buffers.set(name, b.map((d) => { const buf = ctx.createBuffer(1, d.length, SR); buf.copyToChannel(d as Float32Array<ArrayBuffer>, 0); return buf; }));
  }

  private gun(p: SfxParams, seed: number): Float32Array {
    const n = Math.floor(SR * (0.15 + p.tailDecay * 1.6));
    const out = new Float32Array(n);
    const r = rng(seed);
    let lpN = 0, lpT = 0, hp = 0, prev = 0;
    const aN = Math.exp(-2 * Math.PI * p.noiseLP / SR), aT = Math.exp(-2 * Math.PI * p.tailLP / SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const w = r();
      // transient crack: high-passed noise + short metallic tone
      lpN = (1 - aN) * w + aN * lpN;
      hp = lpN - prev; prev = lpN; // crude high-pass
      const crack = (hp * 2.2 + Math.sin(2 * Math.PI * p.crackFreq * t) * 0.35 * Math.exp(-t / 0.004)) * Math.exp(-t / p.crackDecay) * p.crackLevel;
      // body: downward-swept sine + low noise
      const f = p.bodyFreq * (1 + 1.3 * Math.exp(-t / 0.03));
      const body = (Math.sin(2 * Math.PI * f * t) * 0.9 + lpN * 0.3) * Math.exp(-t / p.bodyDecay) * p.bodyLevel;
      // tail
      lpT = (1 - aT) * w + aT * lpT;
      const tail = lpT * Math.exp(-t / p.tailDecay) * p.tailLevel * Math.min(1, t / 0.02) * 1.6;
      let s = crack + body + tail;
      s = Math.tanh(s * 1.4) * 0.85;
      out[i] = s;
    }
    // fade end
    for (let i = 0; i < 400; i++) out[n - 1 - i] *= i / 400;
    return out;
  }

  private tone(dur: number, f0: number, f1: number, decay: number, noiseMix = 0, noiseLP = 6000, seed = 3, amp = 0.8): Float32Array {
    const n = Math.floor(SR * dur); const o = new Float32Array(n); const r = rng(seed);
    let lp = 0; const a = Math.exp(-2 * Math.PI * noiseLP / SR); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = f0 + (f1 - f0) * Math.min(1, t / dur);
      ph += 2 * Math.PI * f / SR;
      lp = (1 - a) * r() + a * lp;
      o[i] = (Math.sin(ph) * (1 - noiseMix) + lp * noiseMix * 2.2) * Math.exp(-t / decay) * amp;
    }
    return o;
  }

  private seq(parts: [number, Float32Array][], total: number): Float32Array {
    const o = new Float32Array(Math.floor(SR * total));
    for (const [at, d] of parts) { const off = Math.floor(at * SR); for (let i = 0; i < d.length && off + i < o.length; i++) o[off + i] += d[i]; }
    return o;
  }

  private build(): void {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const p = WEAPONS[id].sfx;
      this.add('shot_' + id, this.gun(p, 11 + id.length), this.gun(p, 101 + id.length * 3));
    }
    // footsteps
    const stepSand = (seed: number) => this.tone(0.2, 180, 90, 0.05, 0.92, 1100, seed, 0.55);
    const stepStone = (seed: number) => this.seq([[0, this.tone(0.12, 260, 140, 0.02, 0.55, 3200, seed, 0.9)], [0.0, this.tone(0.06, 1400, 900, 0.008, 0.9, 7000, seed + 1, 0.35)]], 0.14);
    this.add('step_sand', stepSand(5), stepSand(6), stepSand(7));
    this.add('step_stone', stepStone(8), stepStone(9), stepStone(10));
    this.add('step_wood', this.tone(0.14, 200, 120, 0.03, 0.4, 2400, 12, 0.9), this.tone(0.14, 230, 110, 0.03, 0.4, 2400, 13, 0.9));
    this.add('step_metal', this.seq([[0, this.tone(0.2, 520, 400, 0.04, 0.3, 5000, 14, 0.7)], [0.0, this.tone(0.2, 1300, 1100, 0.03, 0.1, 5000, 15, 0.25)]], 0.2));
    // bullet impacts
    this.add('imp_stone', this.seq([[0, this.tone(0.12, 900, 400, 0.02, 0.8, 5000, 21, 0.8)], [0, this.tone(0.1, 1800, 1500, 0.015, 0.2, 5000, 22, 0.3)]], 0.14));
    this.add('imp_sand', this.tone(0.16, 300, 140, 0.04, 0.9, 1800, 23, 0.7));
    this.add('imp_wood', this.seq([[0, this.tone(0.14, 360, 180, 0.03, 0.5, 3000, 24, 0.9)], [0.01, this.tone(0.08, 900, 700, 0.015, 0.4, 4000, 25, 0.4)]], 0.15));
    this.add('imp_metal', this.seq([[0, this.tone(0.3, 1700, 1500, 0.09, 0.15, 7000, 26, 0.6)], [0, this.tone(0.05, 900, 500, 0.01, 0.9, 7000, 27, 0.5)]], 0.32));
    // bullet whiz
    this.add('whiz', (() => { const n = Math.floor(SR * 0.22); const o = new Float32Array(n); const r = rng(31); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n; const f = 5000 - 3800 * t; const a = Math.exp(-2 * Math.PI * f / SR); lp = (1 - a) * r() + a * lp; o[i] = lp * 3 * Math.sin(Math.PI * t) * 0.8; } return o; })());
    // weapon handling
    this.add('dry', this.tone(0.07, 1800, 1200, 0.012, 0.3, 6000, 41, 0.5));
    this.add('mag_out', this.seq([[0, this.tone(0.07, 700, 400, 0.015, 0.5, 4000, 42, 0.7)], [0.05, this.tone(0.12, 220, 120, 0.04, 0.4, 2500, 43, 0.8)]], 0.2));
    this.add('mag_in', this.seq([[0, this.tone(0.1, 330, 200, 0.03, 0.5, 3500, 44, 0.9)], [0.06, this.tone(0.06, 1500, 1300, 0.01, 0.4, 6000, 45, 0.6)]], 0.2));
    this.add('rack', this.seq([[0, this.tone(0.07, 1100, 700, 0.015, 0.6, 7000, 46, 0.8)], [0.11, this.tone(0.09, 900, 500, 0.02, 0.6, 7000, 47, 0.9)]], 0.26));
    this.add('bolt', this.seq([[0, this.tone(0.08, 800, 500, 0.02, 0.5, 6000, 48, 0.8)], [0.2, this.tone(0.1, 650, 400, 0.025, 0.5, 6000, 49, 0.9)]], 0.34));
    this.add('draw', this.seq([[0, this.tone(0.06, 900, 600, 0.012, 0.6, 6000, 50, 0.5)], [0.07, this.tone(0.07, 500, 300, 0.015, 0.5, 5000, 51, 0.5)]], 0.16));
    this.add('jump', this.tone(0.1, 160, 90, 0.025, 0.7, 1500, 52, 0.4));
    this.add('land', this.tone(0.18, 120, 55, 0.05, 0.6, 1400, 53, 0.9));
    // feedback
    this.add('hit', this.tone(0.07, 1900, 1900, 0.012, 0, 0, 54, 0.45));
    this.add('hit_head', this.seq([[0, this.tone(0.14, 2600, 2600, 0.04, 0, 0, 55, 0.5)], [0, this.tone(0.14, 3900, 3900, 0.03, 0, 0, 56, 0.3)]], 0.16));
    this.add('hit_kill', this.seq([[0, this.tone(0.12, 1500, 1500, 0.04, 0, 0, 57, 0.5)], [0.07, this.tone(0.18, 2200, 2200, 0.06, 0, 0, 58, 0.5)]], 0.28));
    this.add('hurt', this.seq([[0, this.tone(0.2, 140, 70, 0.07, 0.5, 900, 59, 1.0)], [0, this.tone(0.08, 1500, 800, 0.015, 0.9, 6000, 60, 0.35)]], 0.22));
    this.add('death', this.tone(0.7, 120, 40, 0.25, 0.3, 700, 61, 0.9));
    this.add('beep', this.tone(0.12, 880, 880, 0.08, 0, 0, 62, 0.35));
    this.add('go', this.seq([[0, this.tone(0.14, 660, 660, 0.1, 0, 0, 63, 0.35)], [0.12, this.tone(0.3, 990, 990, 0.2, 0, 0, 64, 0.35)]], 0.45));
    this.add('win', this.seq([[0, this.tone(0.3, 523, 523, 0.2, 0, 0, 65, 0.3)], [0.14, this.tone(0.3, 659, 659, 0.2, 0, 0, 66, 0.3)], [0.28, this.tone(0.5, 784, 784, 0.3, 0, 0, 67, 0.3)]], 0.9));
    this.add('lose', this.seq([[0, this.tone(0.3, 392, 392, 0.2, 0, 0, 68, 0.3)], [0.18, this.tone(0.5, 294, 294, 0.3, 0, 0, 69, 0.3)]], 0.8));
    this.add('click', this.tone(0.03, 1400, 1200, 0.006, 0.2, 6000, 70, 0.4));
  }
}

export const audio = new AudioEngine();
