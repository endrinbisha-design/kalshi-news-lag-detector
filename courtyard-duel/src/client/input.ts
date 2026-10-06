import { BTN } from '../shared/config';
import { Bindings, settings } from './settings';

/** Keyboard / mouse state with pointer-lock handling. Bindings are read live from settings. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0; private dy = 0;
  private wheel = 0;
  locked = false;
  enabled = false; // game accepting input
  onLockChange: (locked: boolean) => void = () => {};
  onPressed: (code: string) => void = () => {};
  rebinding: ((code: string) => void) | null = null;

  /** Fallback when the page may not capture the mouse (e.g. inside a sandboxed iframe): relative mouse movement still works. */
  softLock = false;

  constructor(private canvas: HTMLCanvasElement) {
    document.addEventListener('pointerlockerror', () => this.enterSoftLock());
    document.addEventListener('pointerlockchange', () => {
      if (this.softLock) return;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.down.clear(); }
      this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    window.addEventListener('keydown', (e) => this.key(e, true), { capture: true });
    window.addEventListener('keyup', (e) => this.key(e, false), { capture: true });
    window.addEventListener('mousedown', (e) => this.mouse(e, true), { capture: true });
    window.addEventListener('mouseup', (e) => this.mouse(e, false), { capture: true });
    window.addEventListener('wheel', (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    window.addEventListener('contextmenu', (e) => { if (this.locked || this.enabled) e.preventDefault(); });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  releaseAll(): void { this.down.clear(); this.pressed.clear(); }

  lock(): void {
    const c: any = this.canvas;
    if (!c.requestPointerLock) { this.enterSoftLock(); return; }
    const fallback = () => { try { const q = c.requestPointerLock(); if (q && typeof q.catch === 'function') q.catch(() => this.enterSoftLock()); } catch { this.enterSoftLock(); } };
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(fallback);
    } catch { fallback(); }
  }
  private enterSoftLock(): void {
    if (this.locked) return;
    this.softLock = true;
    this.locked = true;
    this.canvas.style.cursor = 'crosshair';
    this.onLockChange(true);
  }
  unlock(): void {
    if (this.softLock) { this.softLock = false; this.locked = false; this.canvas.style.cursor = ''; this.down.clear(); this.onLockChange(false); return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private key(e: KeyboardEvent, isDown: boolean): void {
    if (this.rebinding && isDown) { e.preventDefault(); e.stopPropagation(); const cb = this.rebinding; this.rebinding = null; cb(e.code); return; }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (this.locked || this.enabled) {
      // swallow keys the game uses (Tab, Space, function keys we bind) so the browser does not react
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || Object.values(settings.bindings).includes(e.code)) e.preventDefault();
    }
    if (isDown && e.code === 'Escape' && this.softLock) { this.unlock(); return; }
    if (isDown) { if (!e.repeat) { this.pressed.add(e.code); this.onPressed(e.code); } this.down.add(e.code); }
    else this.down.delete(e.code);
  }

  private mouse(e: MouseEvent, isDown: boolean): void {
    if (this.rebinding && isDown) { e.preventDefault(); e.stopPropagation(); const cb = this.rebinding; this.rebinding = null; cb('Mouse' + e.button); return; }
    if (!this.locked) return;
    const code = 'Mouse' + e.button;
    if (isDown) { this.pressed.add(code); this.down.add(code); this.onPressed(code); } else this.down.delete(code);
    e.preventDefault();
  }

  isDown(code: string): boolean { return this.down.has(code); }
  wasPressed(code: string): boolean { return this.pressed.has(code); }
  endTick(): void { this.pressed.clear(); }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return r;
  }
  consumeWheel(): number { const w = this.wheel; this.wheel = 0; return w; }

  /** Button bitmask for one sim tick. */
  buttons(b: Bindings): number {
    if (!this.locked) return 0;
    let m = 0;
    if (this.isDown(b.forward)) m |= BTN.FWD;
    if (this.isDown(b.back)) m |= BTN.BACK;
    if (this.isDown(b.left)) m |= BTN.LEFT;
    if (this.isDown(b.right)) m |= BTN.RIGHT;
    if (this.isDown(b.jump)) m |= BTN.JUMP;
    if (this.isDown(b.crouch)) m |= BTN.CROUCH;
    if (this.isDown(b.walk)) m |= BTN.WALK;
    if (this.isDown(b.fire)) m |= BTN.FIRE;
    if (this.isDown(b.reload)) m |= BTN.RELOAD;
    return m;
  }
}
