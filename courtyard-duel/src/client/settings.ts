/** Persistent user settings (localStorage, safe when storage is unavailable). */

export type Preset = 'low' | 'medium' | 'high';
export type ResolutionMode = 'native' | '1920x1080' | '1600x900' | '1280x720' | '960x540';

export interface Bindings {
  forward: string; back: string; left: string; right: string;
  jump: string; crouch: string; walk: string; reload: string;
  fire: string; scope: string;
  slot1: string; slot2: string; lastWeapon: string;
  scoreboard: string; resetTargets: string; toggleMinimap: string;
}

export interface Settings {
  name: string;
  sensitivity: number; // CS-style: degrees per mouse count = sensitivity * 0.022
  invertY: boolean;
  fov: number; // vertical degrees
  volume: number; // master 0..1
  sfxVolume: number;
  preset: Preset;
  renderScale: number; // 0.5..1
  resolution: ResolutionMode;
  showFps: boolean;
  crosshair: { size: number; gap: number; thickness: number; color: string; dot: boolean };
  minimapRotate: boolean;
  bindings: Bindings;
}

export const DEFAULT_BINDINGS: Bindings = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', walk: 'ShiftLeft', reload: 'KeyR',
  fire: 'Mouse0', scope: 'Mouse2',
  slot1: 'Digit1', slot2: 'Digit2', lastWeapon: 'KeyQ',
  scoreboard: 'Tab', resetTargets: 'KeyT', toggleMinimap: 'KeyM',
};

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 1.6,
  invertY: false,
  fov: 70,
  volume: 0.7,
  sfxVolume: 1,
  preset: 'medium',
  renderScale: 1,
  resolution: 'native',
  showFps: false,
  crosshair: { size: 6, gap: 3, thickness: 2, color: '#7dff9a', dot: false },
  minimapRotate: false,
  bindings: { ...DEFAULT_BINDINGS },
};

const KEY = 'courtyard-duel.settings.v1';

function merge<T>(base: T, over: any): T {
  if (over === null || typeof over !== 'object') return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const k of Object.keys(base as any)) {
    const b = (base as any)[k];
    const o = over[k];
    if (o === undefined) continue;
    if (b !== null && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, o);
    else if (typeof b === typeof o) out[k] = o;
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULT_SETTINGS);
}

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();
export const settings: Settings = loadSettings();

export function saveSettings(): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  for (const l of listeners) l(settings);
}
export function onSettings(l: Listener): () => void { listeners.add(l); return () => listeners.delete(l); }

/** Pretty label for a binding code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Mouse')) return ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'][Number(code.slice(5))] ?? code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: 'Space', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', Tab: 'Tab', AltLeft: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return map[code] ?? code;
}

/** Persistent per-browser identity so a refresh / reconnect maps to the same seat (never a duplicate). */
export function playerSecret(): string {
  const K = 'courtyard-duel.secret';
  try {
    let s = sessionStorage.getItem(K) ?? localStorage.getItem(K);
    if (!s) { s = randomId(24); }
    sessionStorage.setItem(K, s);
    localStorage.setItem(K, s);
    return s;
  } catch { return randomId(24); }
}
export function randomId(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b & 63]).join('');
}
