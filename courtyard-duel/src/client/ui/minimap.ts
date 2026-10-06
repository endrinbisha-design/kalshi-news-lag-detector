import { MAP, PX } from '../../shared/map';

const IMG_W = 1852, IMG_H = 952;
const COLORS: Record<string, string> = {
  courtyard: '#7e90a2', alcove: '#b7a07e', pit: '#d9bf8f', step: '#5f6e7d',
  wall: '#3b3326', rim: '#b9703c', kiosk: '#9a7f96', crate: '#e9e2d2', car: '#6fb0a8', carCabin: '#4f948c',
};
const ORDER = ['courtyard', 'alcove', 'pit', 'step', 'wall', 'rim', 'kiosk', 'crate', 'car', 'carCabin'];

/** Top-down minimap generated from the same collision boxes as the arena, so it always matches the geometry. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  rotate = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = canvas.width; this.base.height = canvas.height;
    this.renderBase();
  }

  private renderBase(): void {
    const g = this.base.getContext('2d')!;
    const k = this.base.width / IMG_W;
    g.fillStyle = '#0e1218'; g.fillRect(0, 0, this.base.width, this.base.height);
    const boxes = [...MAP.boxes].sort((a, b) => ORDER.indexOf(a.style) - ORDER.indexOf(b.style) || a.y1 - b.y1);
    for (const b of boxes) {
      const cx = (b.cx / PX + 926) * k, cz = (b.cz / PX + 476) * k;
      const w = (b.hx * 2 / PX) * k, d = (b.hz * 2 / PX) * k;
      g.save(); g.translate(cx, cz); g.rotate(b.rot);
      g.fillStyle = COLORS[b.style] ?? '#f0f';
      g.fillRect(-w / 2, -d / 2, w, d);
      g.restore();
    }
    // lane / pit labels fade
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, this.base.width - 1, this.base.height - 1);
  }

  /** x,z in metres; yaw as in the simulation (positive = left). */
  draw(x: number, z: number, yaw: number, extras: { x: number; z: number; color: string }[] = []): void {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const k = W / IMG_W;
    const px = (x / PX + 926) * k, py = (z / PX + 476) * k;
    c.save();
    c.clearRect(0, 0, W, H);
    if (this.rotate) {
      c.translate(W / 2, H / 2); c.rotate(yaw); c.translate(-px, -py);
    }
    c.drawImage(this.base, 0, 0);
    for (const e of extras) {
      c.fillStyle = e.color; c.beginPath(); c.arc((e.x / PX + 926) * k, (e.z / PX + 476) * k, 4, 0, 7); c.fill();
    }
    // player arrow (yaw 0 = north/up on the map; positive yaw turns counter-clockwise)
    c.translate(px, py);
    c.rotate(this.rotate ? 0 : -yaw);
    c.fillStyle = '#7dff9a'; c.strokeStyle = '#06210f'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
}
