---
name: create-map
description: >-
  Create a new playable Workmelt map from user-supplied assets (reference
  images, floor plans, screenshots, sketches, blueprints) and/or a written
  description. Use this skill whenever the user asks to add a map, level,
  arena or area to the game, drops in image/plan files meant to become a map,
  wants to recreate a real place or a map from another game, or asks to
  extend or rework an existing map's layout. Also use it for questions about
  how maps are structured if the intent is to build one.
---

# Create a Workmelt map

This skill turns reference assets and a description into a new map module in
`src/world/`, registered in the map list and passing the headless map
self-test. A Workmelt map is **not** loaded from disk: it is a few layout
tables plus a build function that generates every mesh in code. The assets
the user gives you are *reference material for layout, proportions, mood and
palette* — they are never shipped, imported or sampled at runtime.

Two standing priorities, straight from the project's brief:

1. **Performance over realism.** Low-poly blocked-out forms; surface detail
   comes from the shared procedural materials, not geometry or textures. The
   self-test enforces < 320 draw calls for the whole map.
2. **Accurate but playable.** Follow the asset's layout as closely as you
   can, then bend it wherever a faithful copy would make a bad FFA
   deathmatch space (dead ends, unwatchable sightlines, unreachable floors,
   leaky perimeter).

## Reference files — read before writing code

- `references/map-contract.md` — the map descriptor contract, exactly what
  `maps.selftest.mjs` enforces (with numbers), the registration checklist and
  every verification command. Read it in full before authoring the module.
- `references/engine-api.md` — the Assembler, the `PB` prop builder, `kit.js`
  helpers, palette keys and the existing prop vocabulary you should reuse.
  Read it before writing the `build()` function or a props file.
- `references/layout-playbook.md` — how to turn assets into a layout: scale
  calibration, lanes/cover/landmark rules, spawn-zone authoring, sealing the
  perimeter, walkability targets. Read it during the design stage.

Also read `src/world/rust.js` end to end — it is the canonical self-contained
map module and the template every new map should follow. `src/world/maps.js`
documents the descriptor. `ARCHITECTURE.md` covers the engine contract if you
need to touch anything outside `src/world/`.

## Workflow

### 1. Inventory and read the assets

List everything the user supplied. View every image with the Read tool —
actually look at them; the layout you author must be traceable back to what
is in the pictures. For each asset note:

- what it shows (plan view, elevation, screenshot, mood/reference photo)
- the major masses: buildings, walls, roads/lanes, open ground, water
- the landmark — the one tall or unmistakable thing the map reads by
- vertical opportunities: roofs, decks, platforms, terraces
- materials and palette (map these to existing palette keys later)

If there are no assets, work from the description alone; ask nothing the
description or genre conventions can answer.

### 2. Establish scale and draft the plan

Calibrate metres from known objects in the assets (a door ≈ 1 m, a car
≈ 4.5 m, a shipping container is 6.06 × 2.44 m, a floor ≈ 3 m). Existing
maps run 55 × 55 m (Rust) to 120 × 120 m (Market); land inside that band —
smaller plays frantic, larger starves an 8-player FFA of contact.

Draft the plan **before writing any code**: a coordinate sketch (ASCII art or
a commented table) in LEVEL space — origin at the centre, north at −Z,
structures as axis-aligned rectangles. This is where layout accuracy is won:
place each mass where the asset puts it, then apply the playability passes
from `references/layout-playbook.md` (lane widths, cover rhythm, sealed
perimeter, stair-only verticality). Present the plan and the deviations you
made for playability in your summary — the user asked for their space, so
say where and why you bent it.

### 3. Author the map module

Create `src/world/<id>.js` following the `rust.js` shape:

1. **Constants + layout tables first**, exported (the self-test reads them):
   the extent object, `STRUCTURES`, and tables for whatever else is solid.
   Tables of numbers, one entry per placed thing, comments explaining any
   placement that matters.
2. **Spawn table** — `[x, z, yaw, zone]`, ≥ 8 points in ≥ 4 named zones,
   authored per the playbook. Index 0 is the frozen boot spawn.
3. **Occupancy** — build a `BLOCKERS` rect list once from the tables, then
   `inSolid`, `standableAt<Name>`, `isOpen<Name>`, `groundY<Name>`. These
   must agree with the geometry because spawns, AI and the minimap trust
   them.
4. **`build<Name>(A, rng)`** — register prop prototypes, then ground,
   perimeter, structures, set pieces, dressing. Draw randomness only from
   the `rng` argument, never `Math.random()` — capture runs must reproduce.
5. **The `<ID>_MAP` descriptor** at the bottom.

If the map needs props the shared libraries lack, add
`src/world/<id>props.js` built with `PB` — but reuse the ~70 existing
prototypes first (see `references/engine-api.md`); every new prototype is
GPU memory and bake time.

### 4. Register and document

- `src/world/maps.js`: import the descriptor, append to `MAPS`, re-export.
  Do not touch `DEFAULT_MAP_ID` — captures baseline on the market.
- The lobby menu, minimap, relay and `?map=<id>` all pick the map up from
  the list automatically; the relay validates slugs generically, so no
  server change.
- Update the map-id union in `ARCHITECTURE.md` (search for `world.mapId`).

### 5. Extend the self-test

Add a map-specific section to `src/world/maps.selftest.mjs` following the
existing per-map sections: solids don't overlap, everything sits inside the
perimeter, every gate/mouth is sealed (probe the first 2–3 m of each
opening), the landmark invariants, and a sampled walkable fraction with a
band that matches the map's density. These checks exist because each of them
found a real bug a screenshot would not show — give the new map the same
protection.

### 6. Verify

Run, in order (details and more options in `references/map-contract.md`):

```
node src/world/maps.selftest.mjs
node src/world/spawns.selftest.mjs
npm run build
```

Then, where a browser/GPU is available: `node tools/capture.mjs` with
`?map=<id>` for the visual smoke test and `node src/world/spawns.probe.mjs`
for collision-validated spawns. Report which checks ran and which the
environment could not support. Iterate until the self-test is green — its
failures name the exact table entry to fix.

## Hard rules (the ones that are easy to break silently)

- Never load an asset at runtime. Geometry, materials, masks: all generated.
- Never call `Math.random()` in world code; use the handed `rng` fork.
- Never hard-code a hex colour; surfaces come from `palette.js` keys.
- Stairs are the only way up — the controller mantles ~0.5 m ledges but
  cannot climb ladders. A roof without a stair is scenery, not a position.
- The perimeter must be sealed: every opening blocked solid within its first
  2–3 m, or players walk out into empty backdrop.
- Avoid per-frame allocations; register collision as cheap proxy boxes, not
  the visual mesh.
