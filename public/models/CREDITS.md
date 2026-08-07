# Model credits

Weapon and prop geometry in this game is generated in code, with one exception
so far: models baked from downloaded sources by `tools/glb-bake.mjs`. The bake
converts a `.glb` into a committed ES module of typed arrays
(`src/weapons/models/<id>.data.js`) — the source `.glb` lives in `assets-src/`
and is gitignored, and nothing is ever fetched at runtime.

**Baking geometry into source does not change the licence.** Where a source is
CC-BY, the credit below ships with the build and has to stay with it.

## Low-Poly G31 Competition

- **Author:** Kaan (https://sketchfab.com/swagmasterkaan)
- **License:** CC BY 4.0 — **attribution required**, commercial use allowed
- **Source:** https://sketchfab.com/3d-models/low-poly-g31-competition-19f87c1c07b64c4cad194c6bc880d0eb
- **Used for:** the G31 sidearm (`src/weapons/models/g31.js`), the frame,
  slide, compensator, controls and the slide-mounted red dot. The magazine,
  trigger shoe and every material are generated in code.

> This work is based on "Low-Poly G31 Competition"
> (https://sketchfab.com/3d-models/low-poly-g31-competition-19f87c1c07b64c4cad194c6bc880d0eb)
> by Kaan (https://sketchfab.com/swagmasterkaan) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)
