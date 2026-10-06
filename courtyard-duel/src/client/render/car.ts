import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Vintage hatchback in pale teal, ~4.2 m long, wheels on y=0, +X is the nose. Pure geometry, no assets. */
export function buildCar(): THREE.Group {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x7fb9b0, metalness: 0.35, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1b2a30, metalness: 0.0, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.88 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.18 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7, metalness: 0.2 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe9b0, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x992222, roughness: 0.3, metalness: 0.2 });

  // ---- body: side profile extruded across the width
  const W = 1.62;
  const prof = new THREE.Shape();
  prof.moveTo(-2.02, 0.34);
  prof.lineTo(-2.08, 0.56);
  prof.quadraticCurveTo(-2.1, 0.86, -1.82, 0.9);
  prof.lineTo(-1.35, 0.94);
  prof.bezierCurveTo(-1.1, 1.0, -0.98, 1.38, -0.62, 1.46);
  prof.lineTo(0.42, 1.46);
  prof.bezierCurveTo(0.74, 1.46, 0.86, 1.12, 1.08, 0.97);
  prof.lineTo(1.82, 0.9);
  prof.quadraticCurveTo(2.1, 0.86, 2.12, 0.56);
  prof.lineTo(2.06, 0.34);
  prof.lineTo(1.5, 0.3);
  prof.absarc(1.25, 0.34, 0.38, 0, Math.PI, false);
  prof.lineTo(-0.9, 0.3);
  prof.absarc(-1.25, 0.34, 0.38, 0, Math.PI, false);
  prof.lineTo(-2.02, 0.34);
  const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: W - 0.24, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 5, curveSegments: 18 });
  bodyGeo.translate(0, 0, -(W - 0.24) / 2);
  const body = new THREE.Mesh(bodyGeo, paint);
  car.add(body);

  // ---- glasshouse: slightly smaller extrusion of the cabin region, inset
  const cab = new THREE.Shape();
  cab.moveTo(-1.28, 0.97);
  cab.bezierCurveTo(-1.06, 1.03, -0.94, 1.34, -0.6, 1.42);
  cab.lineTo(0.4, 1.42);
  cab.bezierCurveTo(0.7, 1.42, 0.8, 1.14, 1.0, 1.0);
  cab.lineTo(-1.28, 0.97);
  const glassGeo = new THREE.ExtrudeGeometry(cab, { depth: W - 0.12, bevelEnabled: false, curveSegments: 12 });
  glassGeo.translate(0, 0.0, -(W - 0.12) / 2);
  const gl = new THREE.Mesh(glassGeo, glass);
  gl.position.y = 0.002;
  car.add(gl);
  // roof panel (paint) on top of the glass
  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.07, W - 0.2, 3, 0.03), paint);
  roof.position.set(-0.12, 1.46, 0);
  car.add(roof);
  // pillars
  for (const z of [-1, 1]) for (const [x, y, rz] of [[-0.95, 1.17, 0.5], [0.85, 1.2, -0.6]] as const) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.07), paint);
    p.position.set(x, y, z * (W / 2 - 0.04)); p.rotation.z = rz; car.add(p);
  }

  // ---- wheels
  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 28); tireGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.255, 20); rimGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.27, 12); hubGeo.rotateX(Math.PI / 2);
  for (const x of [-1.25, 1.25]) for (const z of [-1, 1]) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(tireGeo, rubber), new THREE.Mesh(rimGeo, chrome), new THREE.Mesh(hubGeo, dark));
    g.position.set(x, 0.34, z * (W / 2 - 0.12));
    car.add(g);
  }
  // ---- bumpers, lamps, grille
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.12, W + 0.02, 2, 0.04), chrome);
    b.position.set(s * 2.12, 0.46, 0); car.add(b);
  }
  for (const z of [-0.56, 0.56]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), lamp); h.position.set(2.12, 0.74, z); h.scale.set(0.6, 1, 1); car.add(h);
    const t = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.12, 0.2, 2, 0.02), tail); t.position.set(-2.12, 0.74, z); car.add(t);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.5), dark); grille.position.set(2.14, 0.66, 0); car.add(grille);
  // door seams + handles
  for (const z of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.03), chrome);
    handle.position.set(-0.05, 0.98, z * (W / 2 + 0.0)); car.add(handle);
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.08, 0.14, 2, 0.03), paint);
    mirror.position.set(0.82, 1.08, z * (W / 2 + 0.1)); car.add(mirror);
  }
  car.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return car;
}
