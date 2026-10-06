import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const NAMES_KEPT = new Set(['mag', 'bolt', 'slide', 'handle', 'muzzle', 'eject']);

/**
 * Bake all static meshes under `group` into one mesh per material (huge draw-call saving for models built from many
 * primitives). Named animated sub-assemblies (mag/bolt/slide/handle) are kept as separate nodes and optimised internally.
 */
export function mergeByMaterial(group: THREE.Object3D, keep: Set<string> = NAMES_KEPT): void {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kept: { node: THREE.Object3D; m: THREE.Matrix4 }[] = [];
  const shadowFlags = new Map<THREE.Material, { cast: boolean; receive: boolean }>();

  const walk = (node: THREE.Object3D, parentM: THREE.Matrix4) => {
    for (const child of [...node.children]) {
      child.updateMatrix();
      const cm = parentM.clone().multiply(child.matrix);
      if (keep.has(child.name)) {
        if (child.name !== 'muzzle' && child.name !== 'eject') mergeByMaterial(child, keep);
        kept.push({ node: child, m: cm });
      } else if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        let g = mesh.geometry.clone();
        if (g.index) g = g.toNonIndexed();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(cm);
        const mat = mesh.material as THREE.Material;
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat)!.push(g);
        shadowFlags.set(mat, { cast: mesh.castShadow, receive: mesh.receiveShadow });
      } else walk(child, cm);
    }
  };
  walk(group, new THREE.Matrix4());

  for (const c of [...group.children]) group.remove(c);
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    const f = shadowFlags.get(mat)!;
    mesh.castShadow = true; mesh.receiveShadow = f.receive;
    group.add(mesh);
  }
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const { node, m } of kept) {
    m.decompose(p, q, s);
    node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s);
    group.add(node);
  }
}
