# Asset credits and licences

## Third-party assets actually shipped

| Asset | Source | Licence | Files |
|---|---|---|---|
| **Sandstone Blocks 04** (PBR: diffuse, normal, ARM) by Rob Tuytel | [Poly Haven](https://polyhaven.com/a/sandstone_blocks_04) | CC0 1.0 | `public/assets/textures/sandstone_blocks_04_*.jpg` |
| **Sandstone Blocks 08** by Rob Tuytel | [Poly Haven](https://polyhaven.com/a/sandstone_blocks_08) | CC0 1.0 | `…/sandstone_blocks_08_*.jpg` |
| **Sandstone Cracks** by Rob Tuytel | [Poly Haven](https://polyhaven.com/a/sandstone_cracks) | CC0 1.0 | `…/sandstone_cracks_*.jpg` |
| **Sand 01** by Rob Tuytel | [Poly Haven](https://polyhaven.com/a/sand_01) | CC0 1.0 | `…/sand_01_*.jpg` |
| **Concrete Tiles 02** by Charlotte Baglioni | [Poly Haven](https://polyhaven.com/a/concrete_tiles_02) | CC0 1.0 | `…/concrete_tiles_02_*.jpg` |
| **Blue Plaster Wall** by Dimitrios Savva | [Poly Haven](https://polyhaven.com/a/blue_plaster_wall) | CC0 1.0 | `…/blue_plaster_wall_*.jpg` |
| **Worn Planks** by Dimitrios Savva | [Poly Haven](https://polyhaven.com/a/worn_planks) | CC0 1.0 | `…/worn_planks_*.jpg` |

The 1k JPGs were re-compressed (quality 80, 4:2:0) to cut download size; otherwise they are unmodified.

Runtime libraries: [three.js](https://threejs.org) (MIT), [ws](https://github.com/websockets/ws) (MIT).
Dev tooling: Vite, esbuild, TypeScript, Vitest, tsx, Playwright (all MIT / Apache-2.0).

## Everything else is original and generated in code

No proprietary (Counter-Strike or other) assets were used and none are referenced.

* **Weapon models** (AK-style rifle, M4-style rifle, AWP-style sniper, Desert-Eagle-style pistol, Glock-style pistol,
  MP5-style SMG), **first-person gloves/arms**, **third-person operator character**, **parked car**, **crates**, domes
  and architectural decor: built procedurally from extruded side profiles and primitives (`src/client/render/models/*`,
  `render/car.ts`, `render/mapBuilder.ts`). I looked for suitable openly licensed modern-firearm models; Poly Haven (CC0)
  only carries an old bolt-action rifle and a WWII-era pistol and several other sources need an account/API, so detailed
  replacements were modelled in code instead.
* **Audio**: every sound (gunshots, reloads, footsteps, impacts, bullet whizz, UI) is synthesised at start-up
  (`src/client/audio.ts`) from the per-weapon parameters in `src/shared/config.ts`. No samples.
* **Procedural textures**: bullet-hole decals, dome tile pattern, wood grain for rifle furniture, muzzle flash sprite.
* **Sky / lighting**: three.js `Sky` shader + PMREM environment generated at start-up.
* **Fonts**: system font stack, nothing downloaded.
