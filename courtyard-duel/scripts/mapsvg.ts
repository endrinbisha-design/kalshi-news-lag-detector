import { writeFileSync } from 'node:fs';
import { MAP, PX } from '../src/shared/map';
const W = 1852, Hh = 952;
const col = (b: any) => {
  const h = b.y1;
  switch (b.style) {
    case 'wall': return '#7c6a55';
    case 'rim': return '#c98a50';
    case 'kiosk': return '#a98aa0';
    case 'courtyard': return '#9fb2c0';
    case 'alcove': return '#bfa98a';
    case 'pit': return '#e3c79a';
    case 'step': return '#667788';
    case 'crate': return '#f2efe6';
    case 'car': return '#7fb7b0';
    case 'carCabin': return '#5f9c96';
  }
  return '#f0f';
};
const order = ['courtyard', 'alcove', 'pit', 'step', 'wall', 'rim', 'kiosk', 'crate', 'car', 'carCabin'];
const boxes = [...MAP.boxes].sort((a, b) => order.indexOf(a.style) - order.indexOf(b.style) || a.y1 - b.y1);
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><rect width="${W}" height="${Hh}" fill="#e9d9ad"/>`;
for (const b of boxes) {
  const cx = b.cx / PX + 926, cz = b.cz / PX + 476;
  const w = (b.hx * 2) / PX, d = (b.hz * 2) / PX;
  s += `<rect x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}" fill="${col(b)}" stroke="#000" stroke-opacity=".35" stroke-width="1" transform="translate(${cx} ${cz}) rotate(${b.rot * 180 / Math.PI})"/>`;
}
for (const sp of MAP.spawns) s += `<circle cx="${sp.x / PX + 926}" cy="${sp.z / PX + 476}" r="10" fill="red"/>`;
for (const t of MAP.targets) s += `<circle cx="${t.x / PX + 926}" cy="${t.z / PX + 476}" r="7" fill="orange"/>`;
s += '</svg>';
writeFileSync(process.argv[2], s);
