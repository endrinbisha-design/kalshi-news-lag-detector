import * as THREE from 'three';

/** Accumulates box geometry (with tiled UVs) into one merged BufferGeometry per material key. */
export class GeoBatch {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];

  /**
   * Add a box.
   * @param m   local->world transform (translation + rotation; scale must be 1)
   * @param s   size (x,y,z) in local units
   * @param tile  texture tile size in metres (uv = metres / tile)
   * @param uvOff  uv offset
   * @param worldTop  use world X/Z for top-face uvs (keeps neighbouring floor slabs continuous)
   */
  box(m: THREE.Matrix4, sx: number, sy: number, sz: number, tile: number, uvOff: [number, number] = [0, 0], worldTop = false): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
      { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
      { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    ];
    const e = m.elements;
    const wy0 = e[13];
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    const nm = new THREE.Matrix3().setFromMatrix4(m);
    for (const f of faces) {
      const base = this.pos.length / 3;
      nn.set(...f.n).applyMatrix3(nm).normalize();
      for (const [x, y, z] of f.v) {
        p.set(x, y, z).applyMatrix4(m);
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(nn.x, nn.y, nn.z);
        let u: number, v: number;
        if (f.n[1] !== 0) {
          if (worldTop) { u = p.x; v = p.z; } else { u = x; v = z; }
        } else if (f.n[0] !== 0) { u = z; v = wy0 + y; }
        else { u = x; v = wy0 + y; }
        this.uv.push(u / tile + uvOff[0], v / tile + uvOff[1]);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
/** Matrix from centre + yaw (+ optional pitch/roll). */
export function trs(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.Matrix4 {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s);
}
