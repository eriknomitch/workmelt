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

`src/weapons/materials.js` exports **two** sets, and the difference has already
cost one shipped bug.

`MATERIAL_KEYS` — the library-derived surfaces:

```
alu  alu_fine  steel  steel_soot  steel_bright  steel_black
polymer  polymer_tan  rubber  brass  copper
```

`SPECIAL_MATERIAL_KEYS` — answered directly by `WeaponMaterials.get()`, in no
library, and every bit as valid:

```
glass  optic_tube  lens_ring  lens_vig  lens_vig_soft  cavity
```

`ALL_MATERIAL_KEYS` is the union, and is what `glb-bake.mjs` validates against.

### An optic lens is `glass`, and nothing else works

**Map the lens panel to `glass`.** Any other key renders a sight that looks
correct from every external angle and is *completely opaque the moment you aim
through it*. There is no error, no warning, and no static three-quarter view
that shows it — only `?view=ads` does.

This is worth stating flatly because the obvious lookup is wrong: `glass` is
absent from `MATERIAL_KEYS`, so anyone (or any tool) validating against that
list alone concludes the correct answer is invalid and picks a metal instead.
That is exactly what happened on the G31.

### Rough mapping for a modern handgun

| part | key |
|---|---|
| slide, barrel | `steel_soot` (see the wear note below), `steel` |
| frame, grip | `polymer` |
| controls, pins, trigger | `steel_bright` |
| backstrap, grip inserts | `rubber` |
| optic housing, comp | `alu_fine`, `alu` |
| **optic lens** | **`glass`** |
| cartridge | `brass` |

### Wear amplitude is the lever, not `edgeThreshold`

The curvature mask is **per-vertex**. Chamfered procedural geometry carries
vertices along every edge; a faceted low-poly import has a vertex at *every*
corner and nothing in between, so on an import essentially every vertex reads
as a hard edge and the wear layer covers whole panels instead of their rims.

The fix is to pick a key whose wear amplitude is low, because that is the term
the mask is multiplied by. From `materials.js`:

| key | wear amp | note |
|---|---|---|
| `steel_black` | **0.24** | the highest in the library — bleaches an imported slide to bare white metal |
| `alu_fine` | 0.18 | |
| `steel`, `steel_bright` | 0.16 | |
| `steel_soot` | **0.06** | near-black tint, 4x less wear — the right slide key for an import |

`polymer`, `polymer_tan` and `rubber` are additionally treated as soft surfaces
in `viewmodel.addWeapon` and get their wear pulled down again, which is why an
imported frame usually looks right on the first try and an imported slide does
not.

Do **not** reach for `edgeThreshold` first: raising it reduces how many vertices
qualify as edges, lowering it increases them, and on geometry where every vertex
is a corner neither helps much. Change the key.

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

### The weapon id is a key into other subsystems

This is the part that bites, because **every one of these degrades silently** —
the gun works, sounds slightly wrong, and nothing reports anything.

| what | where | failure if missed |
|---|---|---|
| reload foley | `FOLEY_ALIASES` in `src/audio/samples.js` | all four reload phases fall through to synthesis |
| shot profile | the regex chain in `resolveProfile`, `src/audio/weapons.js` | fires with the default profile — the wrong gun |
| balance matrix | the `MATRIX` rows + the `WEAPON_DEFS.<id>` references in the dominance block of `balance.selftest.mjs` | the suite fails loudly (the one that *does* shout) |
| preview harness | the `builders` map in `src/weapons/preview.js` | `?w=<id>` cannot resolve |

Reload foley and the shot profile are keyed on the **hardware**, not the weapon
id, so a new gun that is mechanically an existing one should alias to it:
`FOLEY_ALIASES = { g31: 'pistol' }`, and `g31` added to the pistol arm of the
profile regex. `src/audio/reload.selftest.mjs` catches the first — it asserts
every gun in `defs.js` resolves a sample for all four phases in both variants —
which is why the full free sweep matters and the four weapon suites are not
enough.

---

## 8. Verification

**Run the whole free sweep, not just the weapon suites.** A new weapon id
reaches into audio, and `src/audio/reload.selftest.mjs` is the suite that
catches it — it failed on the G31 and none of the weapon suites did:

```
for f in $(find src server \( -name 'selftest.*' -o -name '*.selftest.*' \) \
    | grep -v '^server/' | grep -v 'src/audio/selftest.js' | sort); do
  node "$f" >/dev/null 2>&1 || echo "FAIL $f"
done
npm run build
```

The ones that speak directly to this work:

```
node src/weapons/models/baked.selftest.mjs     # the bake pipeline itself
node src/weapons/balance.selftest.mjs          # defs, STK matrix, dominance
node src/weapons/loadout.selftest.mjs          # a spawn restocks every mag
node src/weapons/autoreload.selftest.mjs       # the auto-reload contract
node src/audio/reload.selftest.mjs             # foley resolves for every def
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
