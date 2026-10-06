import { Bindings, DEFAULT_BINDINGS, DEFAULT_SETTINGS, keyLabel, saveSettings, settings } from '../settings';
import { Input } from '../input';

const LABELS: Record<keyof Bindings, string> = {
  forward: 'Move forward', back: 'Move backward', left: 'Strafe left', right: 'Strafe right', jump: 'Jump', crouch: 'Crouch (hold)', walk: 'Walk silently (hold)',
  reload: 'Reload', fire: 'Fire', scope: 'Scope / zoom (AWP)', slot1: 'Primary weapon', slot2: 'Pistol', lastWeapon: 'Last weapon', scoreboard: 'Scoreboard (hold)',
  resetTargets: 'Reset targets (practice)', toggleMinimap: 'Toggle minimap',
};

/** Builds the tabbed settings panel (gameplay / video / audio / controls). */
export function buildSettings(host: HTMLElement, input: Input, onClose: () => void): void {
  host.innerHTML = '';
  const tabs = ['Gameplay', 'Video', 'Audio', 'Controls'];
  let tab = 0;
  const bar = document.createElement('div'); bar.className = 'tabs';
  const body = document.createElement('div');
  host.append(bar, body);

  const slider = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string = (v) => String(v)) => {
    const row = document.createElement('div'); row.className = 'setrow';
    const val = document.createElement('span'); val.className = 'val';
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(get());
    val.textContent = fmt(get());
    inp.oninput = () => { set(Number(inp.value)); val.textContent = fmt(Number(inp.value)); saveSettings(); };
    const l = document.createElement('label'); l.textContent = label;
    row.append(l, inp, val); return row;
  };
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const row = document.createElement('div'); row.className = 'setrow';
    const l = document.createElement('label'); l.textContent = label;
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = get(); c.onchange = () => { set(c.checked); saveSettings(); };
    row.append(l, c); return row;
  };
  const select = <T extends string>(label: string, get: () => T, set: (v: T) => void, opts: [T, string][]) => {
    const row = document.createElement('div'); row.className = 'setrow';
    const l = document.createElement('label'); l.textContent = label;
    const s = document.createElement('select');
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === get()) o.selected = true; s.appendChild(o); }
    s.onchange = () => { set(s.value as T); saveSettings(); };
    row.append(l, s); return row;
  };

  const render = () => {
    bar.innerHTML = '';
    tabs.forEach((t, i) => { const b = document.createElement('button'); b.textContent = t; b.className = i === tab ? 'on' : ''; b.onclick = () => { tab = i; render(); }; bar.appendChild(b); });
    body.innerHTML = '';
    if (tab === 0) {
      body.append(
        slider('Mouse sensitivity', () => settings.sensitivity, (v) => (settings.sensitivity = v), 0.1, 6, 0.05, (v) => v.toFixed(2)),
        toggle('Invert Y axis', () => settings.invertY, (v) => (settings.invertY = v)),
        slider('Field of view', () => settings.fov, (v) => (settings.fov = v), 55, 95, 1, (v) => v + '°'),
        toggle('Rotate minimap with view', () => settings.minimapRotate, (v) => (settings.minimapRotate = v)),
        slider('Crosshair size', () => settings.crosshair.size, (v) => (settings.crosshair.size = v), 2, 16, 1),
        slider('Crosshair gap', () => settings.crosshair.gap, (v) => (settings.crosshair.gap = v), 0, 12, 1),
        slider('Crosshair thickness', () => settings.crosshair.thickness, (v) => (settings.crosshair.thickness = v), 1, 5, 1),
        toggle('Crosshair centre dot', () => settings.crosshair.dot, (v) => (settings.crosshair.dot = v)),
      );
      const row = document.createElement('div'); row.className = 'setrow';
      const l = document.createElement('label'); l.textContent = 'Crosshair colour';
      const c = document.createElement('input'); c.type = 'color'; c.value = settings.crosshair.color; c.oninput = () => { settings.crosshair.color = c.value; saveSettings(); };
      row.append(l, c); body.append(row);
    } else if (tab === 1) {
      body.append(
        select('Graphics preset', () => settings.preset, (v) => (settings.preset = v), [['low', 'Low (no AA / AO, 1k shadows)'], ['medium', 'Medium (4× MSAA, 2k shadows)'], ['high', 'High (MSAA + ambient occlusion + bloom, 4k shadows)']]),
        select('Resolution', () => settings.resolution, (v) => (settings.resolution = v), [['native', 'Native (window size)'], ['1920x1080', '1920 × 1080'], ['1600x900', '1600 × 900'], ['1280x720', '1280 × 720'], ['960x540', '960 × 540']]),
        slider('Render scale', () => settings.renderScale, (v) => (settings.renderScale = v), 0.5, 1, 0.05, (v) => Math.round(v * 100) + '%'),
        toggle('Show FPS', () => settings.showFps, (v) => (settings.showFps = v)),
      );
      const n = document.createElement('p'); n.className = 'note';
      n.textContent = 'Tip: if you are below 60 FPS, lower the preset first, then render scale. The final image is always stretched to fill the window.';
      body.append(n);
    } else if (tab === 2) {
      body.append(
        slider('Master volume', () => settings.volume, (v) => (settings.volume = v), 0, 1, 0.01, (v) => Math.round(v * 100) + '%'),
        slider('Effects volume', () => settings.sfxVolume, (v) => (settings.sfxVolume = v), 0, 1, 0.01, (v) => Math.round(v * 100) + '%'),
      );
    } else {
      const note = document.createElement('p'); note.className = 'note';
      note.innerHTML = 'Click a binding, then press a key or mouse button. <b>Avoid Ctrl</b>: browsers reserve <kbd>Ctrl</kbd>+<kbd>W</kbd> (closes the tab).';
      body.append(note);
      (Object.keys(LABELS) as (keyof Bindings)[]).forEach((k) => {
        const row = document.createElement('div'); row.className = 'kb';
        const l = document.createElement('span'); l.textContent = LABELS[k];
        const b = document.createElement('button'); b.textContent = keyLabel(settings.bindings[k]);
        b.onclick = () => {
          b.textContent = 'Press a key…'; b.classList.add('listening');
          input.rebinding = (code) => {
            if (code !== 'Escape') settings.bindings[k] = code;
            b.classList.remove('listening'); b.textContent = keyLabel(settings.bindings[k]); saveSettings();
          };
        };
        row.append(l, b); body.append(row);
      });
      const reset = document.createElement('button'); reset.textContent = 'Reset controls to default'; reset.style.marginTop = '12px';
      reset.onclick = () => { settings.bindings = { ...DEFAULT_BINDINGS }; saveSettings(); render(); };
      body.append(reset);
    }
  };
  render();
  const row = document.createElement('div'); row.className = 'btnrow';
  const back = document.createElement('button'); back.textContent = 'Back'; back.className = 'primary'; back.onclick = onClose;
  const rst = document.createElement('button'); rst.textContent = 'Restore all defaults'; rst.onclick = () => {
    const name = settings.name;
    Object.assign(settings, structuredClone(DEFAULT_SETTINGS)); settings.name = name; saveSettings(); render();
  };
  row.append(back, rst); host.append(row);
}
