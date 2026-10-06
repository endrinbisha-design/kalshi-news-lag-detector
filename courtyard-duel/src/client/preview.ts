// Developer preview: renders the arena and models from URL-specified cameras for screenshots.
import * as THREE from 'three';
import { Stage } from './render/stage';
import { loadMaterials } from './render/textures';
import { buildMapMeshes } from './render/mapBuilder';
import { settings } from './settings';
import { createWeapon } from './render/models/weapons';
import { WEAPON_IDS, WEAPONS } from '../shared/config';
import { ViewModel } from './render/viewmodel';
import { Character, TEAM_STYLES, DUMMY_STYLE } from './render/models/character';
import { createPlayerState } from '../shared/player';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const stage = new Stage(canvas);
settings.preset = (q.get('preset') as any) ?? 'medium';
stage.resize(window.innerWidth, window.innerHeight, settings);
stage.applySettings(settings);
(window as any).__stage = stage;

async function main() {
  const view = q.get('view') ?? 'map';
  if (view === 'map') {
    const mats = await loadMaterials(import.meta.env.BASE_URL, stage.maxAnisotropy, () => {});
    const arena = buildMapMeshes(mats, stage.maxAnisotropy);
    stage.scene.add(arena.group);
    const cam = (q.get('cam') ?? '0,1.62,0,0,0').split(',').map(Number);
    const [x, y, z, yaw, pitch] = cam;
    stage.camera.position.set(x, y, z);
    stage.camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
    stage.setFov(Number(q.get('fov') ?? 70));
    if (q.get('top')) {
      stage.camera.position.set(0, 46, 0.01);
      stage.camera.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
      stage.setFov(Number(q.get('fov') ?? 38));
    }
  } else if (view === 'weapons') {
    // studio: a neutral floor, all weapons side by side seen from the right side
    stage.scene.fog = null;
    stage.scene.getObjectByName('sky')!.visible = false;
    stage.scene.background = new THREE.Color(0x8c8f93);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x777a7e, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.4; floor.receiveShadow = true; stage.scene.add(floor);
    const only = q.get('id');
    const ids = only ? [only] : WEAPON_IDS;
    ids.forEach((id, i) => {
      const w = createWeapon(id as any);
      w.root.position.set(0, -i * (only ? 0 : 0.5), 0);
      if (!only) w.root.position.y = 1.2 - i * 0.42;
      // face +X looking so the right side of the gun faces the camera at +X: rotate gun so forward (-Z) points to -X? keep forward = -Z and view from +X
      stage.scene.add(w.root);
    });
    const az = THREE.MathUtils.degToRad(Number(q.get('az') ?? 90));
    const el = THREE.MathUtils.degToRad(Number(q.get('el') ?? 8));
    const dist = Number(q.get('dist') ?? (only ? 1.3 : 3.6));
    const cy = only ? 0 : 0.0;
    stage.camera.position.set(Math.sin(az) * Math.cos(el) * dist, cy + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    stage.camera.lookAt(0, only ? 0.0 : 0.0, only ? -0.05 : 0);
    stage.setFov(Number(q.get('fov') ?? 30));
    if (!only) stage.camera.lookAt(0, 0.0, 0.0);
    stage.sun.position.set(2, 6, 3);
  }
  else if (view === 'fp') {
    const mats = await loadMaterials(import.meta.env.BASE_URL, stage.maxAnisotropy, () => {});
    const arena = buildMapMeshes(mats, stage.maxAnisotropy);
    stage.scene.add(arena.group);
    stage.camera.position.set(-14, 1.62, -4.5); stage.camera.rotation.set(0, -Math.PI / 2 + 0.2, 0, 'YXZ');
    stage.setFov(70);
    const id = (q.get('id') ?? 'ak47') as any;
    const vm = new ViewModel();
    stage.viewScene.add(vm.root);
    vm.setWeapon(id);
    const def = WEAPONS[id as keyof typeof WEAPONS];
    const st = createPlayerState({ x: 0, y: 0, z: 0, yaw: 0 }, { primary: def.slot === 0 ? id : 'ak47', pistol: def.slot === 1 ? id : 'glock' }, 1);
    st.weapon = def.slot; st.switchT = 0;
    const rt = Number(q.get('rt') ?? -1);
    if (rt >= 0) st.reloadT = def.reloadTime * (1 - rt);
    if (q.get('fire')) vm.onFire();
    for (let i = 0; i < 40; i++) vm.update(0.016, st, 0, 0, 0, false);
    if (q.get('fire')) { vm.onFire(); vm.update(0.016, st, 0, 0, 0, false); }
  }
  else if (view === 'char') {
    stage.scene.fog = null;
    stage.scene.getObjectByName('sky')!.visible = false;
    stage.scene.background = new THREE.Color(0x9a9c9f);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x80807c, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; stage.scene.add(floor);
    const defs: [number, any, number, number, boolean, number][] = [[0, 'ak47', 0, 0, true, 0], [1, 'awp', 0, 0.0, true, 0], [0, 'glock', 1, 0.0, true, 0], [1, 'm4a4', 0, 0, true, 3.2], [0, 'mp5', 0, 0, false, 0]];
    defs.forEach(([team, wid, crouch, , alive, speed], i) => {
      const c = new Character(TEAM_STYLES[team]);
      stage.scene.add(c.root);
      const yaw = Number(q.get('yaw') ?? 0);
      for (let k = 0; k < 30; k++) c.update(0.016, { x: (i - 2) * 1.0, y: 0, z: 0, yaw, pitch: 0, crouch, vx: speed * -Math.sin(yaw), vz: speed * -Math.cos(yaw), ground: true, alive, wid, reloading: i === 4 });
    });
    void DUMMY_STYLE;
    const az = THREE.MathUtils.degToRad(Number(q.get('az') ?? 0)), dist = Number(q.get('dist') ?? 5);
    stage.camera.position.set(Math.sin(az) * dist, 1.2, -Math.cos(az) * dist * -1);
    stage.camera.lookAt(0, 0.9, 0);
    stage.setFov(35);
    stage.sun.position.set(3, 8, 4);
  }
  for (let i = 0; i < 3; i++) stage.render(0.016);
  (window as any).__ready = true;
}
main();
