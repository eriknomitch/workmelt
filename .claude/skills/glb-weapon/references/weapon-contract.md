# The weapon contract

Everything a model-derived weapon must satisfy, with the numbers. Read this in
full before writing the builder.

---

## 1. What a builder returns

`viewmodel.addWeapon(model, def)` consumes this shape. It is not a
`THREE.Object3D` and never can be — the wear/grime curvature bake runs over the
`matKey -> geometry` buckets that `Assembly.build()` produces.

```js
return {
  id: 'g31',
  label: 'G31',
  fxClass: 'pistol',        // 'carbine' | 'smg' | 'pistol' | 'sniper'
  body,                     // Assembly — everything that does not move
  moving: { magazine, slide, trigger },   // name -> Assembly, see §3
  nodes: { ... },           // §2 — the real work
  shell: { caseLen: 0.0192, rimR: 0.00478 },   // ejected case dimensions, m
  magSize: { len, w, d },   // the magazine's own box, m — drives the drop anim
};
```

`fxClass` is carried on the model and is currently not read anywhere in `src/`.
Set it correctly anyway; it costs nothing and it is the obvious hook for
per-class muzzle effects.

Assemblies come from `src/weapons/geometry.js`; fill them with `addBaked` /
`requireBaked` from `src/weapons/models/baked.js`.

---

## 2. The node table

`nodes` is how `clips.js` and the viewmodel find the parts of a gun that mean
something. All positions are **weapon-local metres**, origin at roughly the web
of the shooting hand, **muzzle down −Z**, **up +Y**, **shooter's right +X**.

### Required on every weapon

| node | type | what it is |
|---|---|---|
| `muzzle` | `[x,y,z]` | crown of the bore — flash, smoke and tracer spawn |
| `chamber` | `[x,y,z]` | where the round sits; used by the shell/eject path |
| `eject` | `[x,y,z]` | the ejection port mouth |
| `ejectDir` | `[x,y,z]` | direction cases leave, normalised on read (default `[1,0.4,0.2]`) |
| `sight` | `[x,y,z]` | optic ocular — **the ADS camera target** |
| `sightAxis` | `[x,y,z]` | sight line, normally `[0,0,-1]` |
| `ironSight` | `[x,y,z]` | fallback sight picture (defaults to `sight`) |
| `gripR` | `{pos, finger, back}` | shooting-hand **wrist** target, §4 |
| `gripL` | `{pos, finger, back}` | support-hand **wrist** target, §4 |
| `magSeat` | `{pos, rot}` | where the magazine sits when seated |
| `magDrop` | `[x,y,z]` | direction/distance it falls on an empty reload |
| `triggerPivot` | `{pos, rot}` | trigger hinge |
| `triggerPull` | number | radians of trigger travel (negative pulls rearward) |

### Per-mechanism — supply the ones your gun has

| node | for | notes |
|---|---|---|
| `slideRest` + `slideTravel` | pistols | `slideTravel` is the full rearward stroke, e.g. `[0,0,0.0225]` |
| `slideGeom` | pistols | the raw slide geometry, kept for the aperture mask |
| `boltRest` + `boltTravel` | rifles/SMGs | reciprocating bolt carrier |
| `chargeRest` + `chargePull` | rifles/SMGs | charging handle; `clips.js` reads `chargeRest` and offsets from it |
| `selectorPivot` | rifles | fire-selector lever |
| `handguard` | rifles/SMGs | `{axis, dir, r}` — a cylinder the support hand is **solved against** at build time (`Arm.fitToCylinder`), not just posed near |
| `opticGlass` | any optic | the lens object; `.mask` drives the ADS aperture |

A missing optional node is not an error — the corresponding animation simply
does nothing. That is convenient and dangerous: a pistol with no `slideTravel`
fires forever without the slide moving, and nothing warns you.

### Deriving them

Use `bakedBounds(PARTS, /selector/)` rather than eyeballing. The muzzle is the
−Z extreme of the barrel part; the ejection port is the +X face of the slide
around the chamber; `magSeat` is the top-centre of the magazine part in its
rest position. Write the derivation into a comment — every node in
`pistol.js`/`rifle.js` has one, and that is why they can be re-tuned.

---

## 3. Splitting the assemblies

The body is everything that does not move. Everything that does gets its own
`Assembly`, positioned so its **local origin is the pivot or slide axis** —
`viewmodel` translates and rotates these directly.

```js
const body = new Assembly('g31-frame');
requireBaked(body, PARTS, BOUNDS, { exclude: /Object_12|Object_13|Object_11/ });

const slide = new Assembly('g31-slide');
requireBaked(slide, PARTS, BOUNDS, { include: /Object_12|Object_13/, offset: { y: -BORE } });
```

Selectors take a RegExp, a string array, or a predicate over the part
(`{ node, material, mat, tris, min, max }`). **Always `requireBaked`** — a
selector that matches nothing produces an empty assembly that renders fine and
silently stops the gun cycling.

Exports name parts `Object_12`, so leave a comment saying what each selector
actually caught. A re-bake of a renamed source is where this breaks.

---

## 4. Hand targets — the hard part

`gripR` and `gripL` are **wrist** targets, not palms. The glove is modelled
from the wrist forward with the knuckle line 98 mm along the hand's −Z:

```
pos = knuckleContact − 0.098 × finger
```

- `finger` — direction the metacarpals run. On a grip they run **down** the
  grip, not forward along the receiver.
- `back` — the dorsal normal; it decides whether the camera sees the back of
  the hand or its edge.

Authoring the palm position directly is what buries the hand inside the
handguard. Getting `finger` wrong by 60° throws the knuckles 40 mm off the
front strap and the fingers close on air.

For a support hand on a tube, solve rather than guess: pick a clock angle on
the handguard cylinder, take the surface normal and tangent there, push the
knuckle contact ~14.5 mm off the surface (a 16 mm half-palm then
interpenetrates by 1.5 mm, so there is no daylight). `rifle.js` carries the
full derivation including why it ended up at 250° — under the handguard, not a
C-clamp — because the C-clamp put the hand on top of the muzzle on screen.

**This is the one part that cannot be finished from numbers.** Capture
`?view=hands`, `?view=grip` and `?view=ads`, look at them, iterate.

---

## 5. Material keys

From `src/weapons/materials.js` (`MATERIAL_KEYS` — the tool validates against
it, so a typo fails the bake rather than shipping):

```
alu  alu_fine  steel  steel_soot  steel_bright  steel_black
polymer  polymer_tan  rubber  brass  copper
```

Rough mapping for a modern handgun: slide and barrel `steel_black` or `steel`,
frame and grip `polymer`, controls and pins `steel_bright`, backstrap or
grip inserts `rubber`, optic housing `alu_fine`, cartridge `brass`.

The mask amplitudes are shaped per key in `viewmodel.addWeapon` — `polymer`,
`polymer_tan` and `rubber` are treated as soft surfaces and get less edge wear.
A gun mapped entirely to `steel` gets hard-surface wear everywhere and reads
as a prop.

**One caveat for low-poly imports.** The wear mask is per-vertex and
interpolates across a face. Chamfered procedural geometry has vertices along
every edge; a low-poly import does not, so wear spreads further across each
panel. If the result looks chalky, lower `edgeThreshold` from the 0.16 used
today rather than turning the wear down.

---

## 6. `defs.js` — a shots-to-kill number, not a feel number

A body is 100 HP, scaled by zone: head ×4.0, upper torso ×1.0, lower torso
×0.9, arm ×0.65, leg ×0.7. Damage is therefore an integer-boundary decision.
The shipped matrix:

| weapon | dmg | torso STK | rpm | TTK | head |
|---|---|---|---|---|---|
| rifle | 33 | 4 | 800 | 225 ms | 1 shot |
| smg | 26 | 4 | 950 | 189 ms | 1 shot |
| pistol | 29 | 4 | 480 | 375 ms | 1 shot |
| sniper | 115 | 1 | 50 | one shot | 1 shot |

`balance.selftest.mjs` enforces, for every def:

- **every required field present** — `id, label, class, caliber, rpm, modes,
  magSize, reserve, muzzleVelocity, damage, penetration, falloffStart,
  falloffEnd, dropoff, maxRange, spreadHip, spreadAds, spreadPerShot,
  spreadMax, spreadDecay, spreadAirAdd, recoil, adsTime, adsFovScale, viewFov,
  eyeRelief, hipPos, hipRot, magLen`
- `0 ≤ falloffStart < falloffEnd ≤ maxRange`
- `0.3 < dropoff ≤ 1`
- `spreadAds < spreadHip`, `spreadMax > spreadHip × 0.5`, `spreadAirAdd > 0`
- `0 < adsFovScale ≤ 1`
- **`reserve % magSize === 0`** — a whole number of magazines
- the sidearm still draws fastest; the sniper keeps the lowest rpm, the
  smallest magazine and the slowest ADS
- **no weapon is strictly dominated by another** — the one rule a weapon set
  may never break

---

## 7. LOADOUT — decide this with the user

`LOADOUT` in `src/weapons/index.js` is a fixed four:

```js
export const LOADOUT = ['rifle', 'smg', 'pistol', 'sniper'];
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
```

and `balance.selftest.mjs` asserts **both** of these:

```js
check('the loadout is every defined weapon, in slot order',
  LOADOUT.length === IDS.length && LOADOUT.every((id) => WEAPON_DEFS[id]));
check('four slots, and 1-4 can address them', LOADOUT.length === 4);
```

So there are exactly two paths, and they are not the same size of job:

**A. Replace a slot** (supported, no test changes). Add the def under a new id,
swap the entry in `LOADOUT`, register the builder in the `builders` map in
`index.js`. The self-test stays green because the counts still match. The
balance matrix in `balance.selftest.mjs` names weapons by id, so update the
rows for the id you removed.

**B. Extend to five** (a real change). Every player carries every weapon, so a
fifth means: a fifth `SLOT_KEYS` bind, relaxing both assertions above,
extending the balance matrix and the dominance check, and re-checking the
loadout restock in `loadout.selftest.mjs`. It also changes the game's shape —
four is a deliberate design, not an accident.

Ask which one the user wants before writing the def. Do not silently pick.

---

## 8. Verification

Free, run always:

```
node src/weapons/models/baked.selftest.mjs     # the bake pipeline itself
node src/weapons/balance.selftest.mjs          # defs, STK matrix, dominance
node src/weapons/loadout.selftest.mjs          # a spawn restocks every mag
node src/weapons/autoreload.selftest.mjs       # the auto-reload contract
node src/weapons/throwables.selftest.mjs
node src/weapons/melee.selftest.mjs
npm run build
```

Visual — required for any model work, see the `visual-check` skill:

```
/src/weapons/preview.html?w=<id>&view=hero
```

Views: `hero side top muzzle optic grip stock hands fp ads sprint reload
inspect`. Add the builder to the import block in `src/weapons/preview.js` so
`?w=<id>` resolves; the harness boots materials plus the viewmodel only, so it
runs without the game.

Then `npm run playtest:ads` for the aim path, and `node tools/capture.mjs` for
the in-game frame. Write throwaway images to `.shots/`, read them back, and say
what you saw.

---

## 9. Licence

`assets-src/models/<name>/license.txt` travels with most downloads. A CC-BY
model needs attribution in the shipped build. Read it, surface the terms to the
user, and let them decide — this is not a call to make on their behalf.
