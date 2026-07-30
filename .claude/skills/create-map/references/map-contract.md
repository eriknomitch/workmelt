# The map contract

What a map must provide, what the self-test enforces, and how a new map gets
registered and verified. Line references drift; trust the named files.

## The descriptor

`src/world/maps.js` documents this in full. Every map exports one object:

```js
export const FOO_MAP = {
  id: 'foo',            // stable slug: URL (?map=foo) and the wire
  name: 'Foo',          // menu card title
  subtitle: '…',        // one line under the name
  blurb: '…',           // two lines of "what is it like to play"
  size: '80 × 80 m',    // human-readable extent for the menu card
  transform: { yaw, tx, tz },  // LEVEL -> WORLD, baked into every vertex
  bounds: [minX, minY, minZ, maxX, maxY, maxZ],  // playable area, LEVEL space
  spawnPoints,          // [[x, z, yaw, zone], …] — LEVEL space
  standable,            // (x, z, margin) => bool — cheap spawn pre-filter
  groundY,              // (x, z) => number — analytic floor height
  isOpen,               // (x, z, margin) => bool — what the minimap draws
  build,                // (A, rng) => { buildings } — assemble the level
  environment,          // OPTIONAL { hour, weather, exposureBias }
};
```

Notes that matter:

- **LEVEL space** is the authoring frame: origin at the map centre, north at
  −Z. `WorldSystem` bakes `transform` into every vertex/proxy/light, so
  nothing in the module knows about world space. Pick a `yaw` a few tenths
  off the axes: every mass is a rectangle, and a rectangle lit square-on
  loses one of its two lit faces (see the comment on `RUST_MAP.transform`).
- **`bounds`** should hug the perimeter plus a small skirt. The AI builds
  its nav grid over this box, so slack bounds are wasted nav cells.
- **`build(A, rng)`** must register its own prop prototypes and draw ONLY
  from the handed `rng` fork. It returns `{ buildings }` — an array where
  each entry (or its `.spec`) has `x, z, w, d` — that is what the minimap
  draws as building footprints.
- **`environment`** is optional and only for maps not set in default
  daylight. `hour` is 0–24 local solar time; `weather` keys are limited to:
  `turbidity, cloudCoverage, cloudDensity, cirrusCoverage, cirrusOpacity,
  windSpeed, windAngle, horizonMurk, fogDensity, fogHeight, shaftGain`;
  `exposureBias` is EV within ±3. Omit the whole field for a day map — the
  sky restores its defaults automatically.

## What `maps.selftest.mjs` enforces (with the numbers)

The test builds every map for real (real Assembler, stub materials) in Node.
For every map in `MAPS`:

- descriptor shape: all functions present, `bounds.length === 6`, finite yaw
- menu summary complete: id, name, subtitle, blurb, size all truthy
- builds without throwing
- `staticTris > 5000` — real merged geometry
- `instances > 100` — a real instanced prop cloud
- `collideTris > 500` — authored collision proxies
- `0 < drawCalls < 320` — the draw-call budget; typical maps land 100–250
- `buildings` non-empty, every footprint has finite `x, z` and `w, d > 0`
- spawn table: length ≥ 8; every point except index 0 passes `standable`
  AND `isOpen`; every point inside `bounds`; `groundY` finite at every point
- zones: ≥ 4 distinct zone names, no zone with fewer than 2 points, zone
  centroids > 5 m apart
- `groundY` finite on a 4 m grid across the whole `bounds`

Per-map layout sections (Rust, Wilmot, Fishers, Loop) then check what the
generic pass cannot: import the map's exported tables and assert
- no two solid rects intersect,
- everything solid is inside the perimeter,
- landmark invariants (the derrick has two climbable levels, the manor is
  two storeys, …),
- stair feet start from open ground (or the second storey is scenery),
- outside the perimeter `isOpen` is false,
- sampled walkable fraction sits in a band that matches the map's density
  (Loop 0.28–0.6; Rust 0.45–0.9; the estates 0.5–0.92),
- **every gate/mouth is sealed**: walk lines across each perimeter opening
  every 0.2 m and require `inSolid` within the first 2–3 m. Keep the probe
  depth shallow — a deep probe reaches past the mouth, finds unrelated
  cover, and becomes an assertion that cannot fail.

A new map must add its own section in this style. Each existing check is
there because it caught a real shipped-looking bug (a gate that leaked into
empty desert, a stair buried under a container) that no screenshot showed.

## Spawn table format

`[x, z, yaw, zone]` in LEVEL space. Yaw faces down the lane toward the play
space — never at a wall two metres away. Rust's trick is worth copying:
author `[x, z, turn, zone]` and map through a `facing()` helper that aims
every point at the landmark, `turn` being the hand adjustment.

**Index 0 is the frozen boot spawn**: `world.spawn(0)` is the player's boot
position and capture runs frame from it. It is exempt from validation, so it
is the one point guaranteed to exist. Once baselines are shot against the
map, moving it invalidates them.

At build time `buildSpawnPoints` (in `spawns.js`) re-validates every point
against real collision and drops failures — so an authored point that ends
up inside a dressed prop is removed, not shipped. Author a few more points
than the minimum to survive that cull.

## Registration checklist

1. `src/world/<id>.js` — the module, descriptor exported.
2. (optional) `src/world/<id>props.js` — map-specific prototypes.
3. `src/world/maps.js` — import, append to `MAPS`, add to the re-export
   line. Leave `DEFAULT_MAP_ID` alone.
4. `src/world/maps.selftest.mjs` — import the new map's tables, add its
   layout section.
5. `ARCHITECTURE.md` — extend the `world.mapId` union in the doc comment.

Nothing else: lobby menu, minimap, `?map=` boot resolution, localStorage
preference and the multiplayer relay all key off the `MAPS` list (the relay
validates slugs generically — see `server/map.selftest.mjs`).

## Verification commands

Headless (always run):

```
node src/world/maps.selftest.mjs     # the contract above
node src/world/spawns.selftest.mjs   # spawn director scoring
npm run build                        # the bundle still builds
```

Browser/GPU (run when the environment has one; otherwise say so):

```
node src/world/spawns.probe.mjs      # collision-validated spawns, bot
                                     # garrison, 30 respawns in the built level
node tools/capture.mjs               # GPU visual smoke test (frames the
                                     # market; pass ?map=<id> to shoot the new map)
node src/world/probe.mjs --query="map=<id>" --eval="w.spawnPoints.length"
                                     # ad-hoc queries against the real build
```

Determinism caveat from AGENTS.md: frame rate is never measurable on a
GPU-less machine — report `costIndex` ratios there, and real fps only from
`tools/profile.mjs` on real hardware.
