import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Preset, ResolutionMode, Settings } from '../settings';

interface PresetDef {
  shadowMap: number;
  shadows: boolean;
  msaa: number;
  ao: boolean;
  bloom: boolean;
  composer: boolean;
  maxAniso: number;
}

export const PRESETS: Record<Preset, PresetDef> = {
  low: { shadowMap: 1024, shadows: true, msaa: 0, ao: false, bloom: false, composer: false, maxAniso: 2 },
  medium: { shadowMap: 2048, shadows: true, msaa: 4, ao: false, bloom: false, composer: true, maxAniso: 8 },
  high: { shadowMap: 4096, shadows: true, msaa: 4, ao: true, bloom: true, composer: true, maxAniso: 16 },
};

// Sun: SSW, fairly high so the courtyards get soft long-ish shadows from the walls.
export const SUN_DIR = new THREE.Vector3(-0.42, 0.74, 0.52).normalize();

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly viewSun: THREE.DirectionalLight;
  readonly muzzleLight: THREE.PointLight;
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private viewPass: RenderPass | null = null;
  private preset: Preset = 'medium';
  private lastShadowSize = 0;
  private cssW = 1; private cssH = 1;
  internalW = 1; internalH = 1;
  maxAnisotropy = 8;
  envTexture: THREE.Texture | null = null;
  viewShade = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.renderer.info.autoReset = false; // accumulate across composer passes; reset per frame in render()

    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 400);
    this.viewCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 10);
    this.scene.add(this.camera);

    // ---- sky + image based lighting generated once from the procedural sky
    const sky = new Sky();
    sky.scale.setScalar(800);
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5; u.rayleigh.value = 1.35; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIR);
    sky.name = 'sky';
    this.scene.add(sky);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky(); envSky.scale.setScalar(400);
    Object.assign(envSky.material.uniforms.turbidity, { value: 5.5 });
    envSky.material.uniforms.rayleigh.value = 1.35; envSky.material.uniforms.mieCoefficient.value = 0.004;
    envSky.material.uniforms.mieDirectionalG.value = 0.82; envSky.material.uniforms.sunPosition.value.copy(SUN_DIR);
    envScene.add(envSky);
    // warm sand-coloured bounce light from the ground: a large dim plane below the horizon
    const bounce = new THREE.Mesh(new THREE.CircleGeometry(300, 24), new THREE.MeshBasicMaterial({ color: 0xc9a977, side: THREE.DoubleSide }));
    bounce.rotation.x = Math.PI / 2; bounce.position.y = -2;
    envScene.add(bounce);
    this.envTexture = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.62;
    this.viewScene.environment = this.envTexture;
    this.viewScene.environmentIntensity = 0.62;
    this.scene.fog = new THREE.FogExp2(0xd9c7a2, 0.0042);

    // ---- sun
    this.sun = new THREE.DirectionalLight(0xfff0d4, 3.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(70);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    // soft fill from the opposite side (sky bounce); no shadows
    const fill = new THREE.HemisphereLight(0xcfe0ff, 0xc2a67a, 0.35);
    this.scene.add(fill);

    // ---- viewmodel scene lighting
    this.viewSun = new THREE.DirectionalLight(0xfff0d4, 3.0);
    this.viewSun.position.copy(SUN_DIR);
    this.viewScene.add(this.viewSun, this.viewCamera);
    this.viewScene.add(new THREE.HemisphereLight(0xcfe0ff, 0xc2a67a, 0.5));

    // muzzle flash light (constant light count avoids shader recompiles)
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.scene.add(this.muzzleLight);
  }

  applySettings(s: Settings): void {
    this.preset = s.preset;
    const p = PRESETS[s.preset];
    this.sun.castShadow = p.shadows;
    if (this.lastShadowSize !== p.shadowMap) {
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      this.lastShadowSize = p.shadowMap;
    }
    this.resize(this.cssW, this.cssH, s);
  }

  /** Compute internal render size from CSS size, device pixel ratio, render scale and the fixed-resolution option. */
  private internalSize(cssW: number, cssH: number, s: Settings): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = cssW * dpr, h = cssH * dpr;
    if (s.resolution !== 'native') {
      const [fw, fh] = (s.resolution as ResolutionMode).split('x').map(Number);
      const k = Math.min(fw / cssW, fh / cssH);
      if (k < dpr) { w = cssW * k; h = cssH * k; }
    }
    w = Math.max(2, Math.round(w * s.renderScale));
    h = Math.max(2, Math.round(h * s.renderScale));
    return [w, h];
  }

  resize(cssW: number, cssH: number, s: Settings): void {
    this.cssW = cssW; this.cssH = cssH;
    const [w, h] = this.internalSize(cssW, cssH, s);
    this.internalW = w; this.internalH = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    const aspect = w / h;
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = aspect; this.viewCamera.updateProjectionMatrix();
    this.buildComposer(w, h);
  }

  private buildComposer(w: number, h: number): void {
    const p = PRESETS[this.preset];
    this.composer?.dispose();
    this.composer = null; this.gtao = null; this.bloom = null; this.viewPass = null;
    if (!p.composer) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping; // OutputPass does tone mapping
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: p.msaa });
    const c = new EffectComposer(this.renderer, rt);
    c.setPixelRatio(1);
    c.setSize(w, h);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (p.ao) {
      const g = new GTAOPass(this.scene, this.camera, w, h);
      g.output = GTAOPass.OUTPUT.Default;
      g.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao = g;
      c.addPass(g);
    }
    const vp = new RenderPass(this.viewScene, this.viewCamera);
    vp.clear = false;
    vp.clearDepth = true;
    this.viewPass = vp;
    c.addPass(vp);
    if (p.bloom) {
      const b = new UnrealBloomPass(new THREE.Vector2(w, h), 0.16, 0.6, 0.92);
      this.bloom = b;
      c.addPass(b);
    }
    c.addPass(new OutputPass());
    this.composer = c;
  }

  setFov(vertical: number): void {
    if (Math.abs(this.camera.fov - vertical) > 1e-3) { this.camera.fov = vertical; this.camera.updateProjectionMatrix(); }
  }

  render(dt: number): void {
    // dim the viewmodel's sun when the player stands in shadow
    const target = this.viewShade;
    this.viewSun.intensity += (3.0 * target - this.viewSun.intensity) * Math.min(1, dt * 8);
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.clearDepth();
      this.renderer.autoClear = false;
      this.renderer.render(this.viewScene, this.viewCamera);
      this.renderer.autoClear = true;
    }
  }
}
