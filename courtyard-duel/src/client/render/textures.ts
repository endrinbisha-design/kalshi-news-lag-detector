import * as THREE from 'three';

/** CC0 PBR texture sets from Poly Haven (see docs/ASSET_CREDITS.md). 1k diffuse + GL normal + ARM (ao/rough/metal). */
export interface PBRDef { name: string; tile: number; tint?: number; roughness?: number; normalScale?: number }

export const PBR: Record<string, PBRDef> = {
  wall: { name: 'sandstone_blocks_04', tile: 3.2, normalScale: 1.1 },
  trim: { name: 'blue_plaster_wall', tile: 2.4, tint: 0xffffff },
  courtyard: { name: 'concrete_tiles_02', tile: 3.0, normalScale: 1.0 },
  alcove: { name: 'sandstone_blocks_08', tile: 3.2 },
  pit: { name: 'sand_01', tile: 4.5, normalScale: 1.2, tint: 0xfff0cf },
  rim: { name: 'sandstone_cracks', tile: 3.0, tint: 0xf0a868 },
  kiosk: { name: 'sandstone_cracks', tile: 3.0, tint: 0xe6d6c4 },
  step: { name: 'sandstone_blocks_04', tile: 1.6, tint: 0xb9b3a8 },
  crate: { name: 'worn_planks', tile: 1.4, tint: 0xffffff },
};

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();

function load(url: string, srgb: boolean, aniso: number): Promise<THREE.Texture> {
  const key = url + (srgb ? '#s' : '#l');
  let p = cache.get(key);
  if (!p) {
    p = new Promise((resolve, reject) => {
      loader.load(url, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = aniso;
        resolve(t);
      }, undefined, reject);
    });
    cache.set(key, p);
  }
  return p;
}

export interface Loaded { [key: string]: THREE.MeshStandardMaterial }

export async function loadMaterials(base: string, aniso: number, progress: (f: number) => void): Promise<Loaded> {
  const out: Loaded = {};
  const keys = Object.keys(PBR);
  let done = 0;
  const total = keys.length * 3;
  const tick = () => progress(++done / total);
  await Promise.all(keys.map(async (k) => {
    const d = PBR[k];
    const u = (s: string) => `${base}assets/textures/${d.name}_${s}.jpg`;
    const [diff, nor, arm] = await Promise.all([
      load(u('diff'), true, aniso).then((t) => { tick(); return t; }),
      load(u('nor_gl'), false, aniso).then((t) => { tick(); return t; }),
      load(u('arm'), false, aniso).then((t) => { tick(); return t; }),
    ]);
    const m = new THREE.MeshStandardMaterial({
      map: diff, normalMap: nor, aoMap: arm, roughnessMap: arm, metalnessMap: arm,
      color: d.tint ?? 0xffffff, roughness: 1, metalness: 1, // maps modulate (G rough, B metal)
      normalScale: new THREE.Vector2(d.normalScale ?? 1, d.normalScale ?? 1),
    });
    m.name = k;
    m.userData.tile = d.tile;
    out[k] = m;
  }));
  return out;
}

// -------------------------------------------------------------------- procedural canvas textures
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** Seeded PRNG for deterministic procedural art. */
export function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Bullet-hole decals per surface. Returns RGBA textures with alpha. */
export function makeHoleTextures(): Record<string, THREE.CanvasTexture> {
  const out: Record<string, THREE.CanvasTexture> = {};
  const rnd = mulberry(7);
  const mk = (name: string, draw: (g: CanvasRenderingContext2D, s: number) => void) => {
    const [c, g] = canvas(128, 128);
    draw(g, 128);
    out[name] = tex(c);
  };
  const crack = (g: CanvasRenderingContext2D, s: number, n: number, len: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = 1.4;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2; let x = s / 2, y = s / 2;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { const l = (len / 4) * (0.6 + rnd() * 0.8); x += Math.cos(a + (rnd() - 0.5) * 0.7) * l; y += Math.sin(a + (rnd() - 0.5) * 0.7) * l; g.lineTo(x, y); }
      g.stroke();
    }
  };
  const blob = (g: CanvasRenderingContext2D, s: number, r: number, inner: string, outer: string) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    gr.addColorStop(0, inner); gr.addColorStop(0.55, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
  };
  mk('stone', (g, s) => { blob(g, s, 34, 'rgba(235,225,205,0.55)', 'rgba(235,225,205,0)'); blob(g, s, 10, 'rgba(25,20,15,0.95)', 'rgba(25,20,15,0.0)'); crack(g, s, 6, 36, 'rgba(60,50,40,0.6)'); });
  mk('plaster', (g, s) => { blob(g, s, 38, 'rgba(250,244,230,0.7)', 'rgba(250,244,230,0)'); blob(g, s, 9, 'rgba(30,24,18,0.95)', 'rgba(30,24,18,0)'); crack(g, s, 7, 42, 'rgba(70,60,50,0.5)'); });
  mk('sand', (g, s) => { blob(g, s, 30, 'rgba(70,55,35,0.45)', 'rgba(70,55,35,0)'); blob(g, s, 8, 'rgba(40,30,18,0.8)', 'rgba(40,30,18,0)'); });
  mk('pavers', (g, s) => { blob(g, s, 30, 'rgba(200,205,210,0.5)', 'rgba(200,205,210,0)'); blob(g, s, 9, 'rgba(20,20,22,0.95)', 'rgba(20,20,22,0)'); crack(g, s, 5, 34, 'rgba(40,40,44,0.55)'); });
  mk('wood', (g, s) => {
    blob(g, s, 12, 'rgba(20,12,6,0.95)', 'rgba(20,12,6,0)');
    g.strokeStyle = 'rgba(205,170,120,0.85)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const a = rnd() * 6.28, l = 12 + rnd() * 22; g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * 6, s / 2 + Math.sin(a) * 6); g.lineTo(s / 2 + Math.cos(a) * l, s / 2 + Math.sin(a) * l); g.stroke(); }
  });
  mk('metal', (g, s) => { blob(g, s, 14, 'rgba(15,15,18,0.95)', 'rgba(15,15,18,0)'); g.strokeStyle = 'rgba(210,210,220,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(s / 2, s / 2, 14, 0, 6.3); g.stroke(); });
  out.trim = out.stone;
  return out;
}

export function makeSoftDot(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c);
}

export function makeFlashTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.25, 'rgba(255,205,120,0.85)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
  g.fillStyle = 'rgba(255,230,170,0.95)';
  const rnd = mulberry(3);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.3, l = 38 + rnd() * 24, w = 4 + rnd() * 3;
    g.save(); g.rotate(a); g.beginPath(); g.moveTo(0, -w); g.lineTo(l, 0); g.lineTo(0, w); g.closePath(); g.fill(); g.restore();
  }
  return tex(c);
}

/** Blue + white geometric tile pattern for the domes. */
export function makeDomeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#1f3f7a'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#e8eefc'; g.lineWidth = 3;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const cx = x * 32 + 16, cy = y * 32 + 16;
    g.beginPath();
    g.moveTo(cx, cy - 13); g.lineTo(cx + 13, cy); g.lineTo(cx, cy + 13); g.lineTo(cx - 13, cy); g.closePath();
    g.stroke();
    g.fillStyle = (x + y) % 2 ? '#8fb2e8' : '#2b5aa8';
    g.beginPath(); g.arc(cx, cy, 5, 0, 6.3); g.fill();
  }
  const t = tex(c); t.repeat.set(3, 2);
  return t;
}

/** Fine wood-grain for rifle furniture. */
export function makeWoodTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = mulberry(11);
  g.fillStyle = '#7a4524'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const y = rnd() * 256, a = 0.05 + rnd() * 0.2;
    g.strokeStyle = rnd() < 0.5 ? `rgba(40,18,6,${a})` : `rgba(190,120,70,${a})`;
    g.lineWidth = 0.6 + rnd() * 2;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.04 + i) * (2 + rnd() * 3));
    g.stroke();
  }
  return tex(c);
}

/** Subtle noise normal-ish bump for polymer / parkerised metal. */
export function makeGrainTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const rnd = mulberry(5);
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 118 + rnd() * 20; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return tex(c, false);
}
