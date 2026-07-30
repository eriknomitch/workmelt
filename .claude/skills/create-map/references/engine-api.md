# Building geometry: the Assembler, the kit, the palette, the props

Everything a `build(A, rng)` function has to work with. The theme
throughout: **merge and instance everything**. A 120 m map of hundreds of
thousands of triangles must come out as ~100–250 draw calls, and the
self-test fails the map at 320.

## The Assembler (`src/world/builder.js`)

Every module writes into the Assembler instead of touching the scene.

Static geometry — merged into ONE mesh per palette key:

```js
A.add(key, geo, matrix, opts)      // merge into the batch for `key`
A.addBox(key, geo, x, y, z, ry, sx, sy, sz)  // convenience transform
A.addOnce(key, geo, matrix)        // merge then dispose the source geo
A.cache(cacheKey, factory)         // share a kit piece geometry; freed by
                                   // releaseCache() after the build
```

Instanced props — one draw call per prototype (chunked at 64 m for culling
when an instance cloud exceeds 24):

```js
A.proto(id, { geo, key, tilt, sink, skirt, castShadow, maxDist, noPrepass })
A.put(id, x, y, z, ry, scale, masks)   // the common placement call
A.putS(id, x, y, z, ry, sx, sy, sz)    // non-uniform scale
A.has(id) / A.count(id)
```

`tilt`/`sink` mark a prototype as *loose*: while `A.jitter = { rng, yaw,
scale }` is armed (arm it for the whole set-dressing pass, null it after),
every loose prop gets knocked out of true — nothing in a real street is
plumb, and identical clones are the loudest tell in an instanced cloud.
`skirt` drops a dust fillet under each instance so props do not read as
decals pasted on the ground; set `A.skirts = false` around stacks (the
second crate stands on the first, not on dirt). `maxDist` gives small props
distance-LOD for free — use it on anything under knee height.

Collision — authored separately from visuals, as cheap boxes:

```js
A.box(surface, cx, cy, cz, sx, sy, sz, ry)  // axis/Y-rotated box proxy
A.collideGeo(surface, geo, matrix)          // real triangles (ramps, terrain)
A.slabBox(surface, panelMatrix, x, y, w, h, t)  // wall slab in panel space
```

Proxies are generated from the same numbers that built the geometry, so a
doorway is a real hole in the hull and the physics BVH stays in the low
thousands of triangles. Never register the visual mesh as collision.

Lights and anchors:

```js
A.light(light, opts)         // punctual light, LEVEL-space position
A.lampAnchors.push({x,y,z})  // where a lamp head wants its point light
A.interiorLights             // filled by interiors.js for bare bulbs
```

Level placement: `A.setTransform(yaw, tx, tz)` is called by `WorldSystem`
from the descriptor — the module never calls it. `A.toWorld(x, y, z)`
converts a point if you need world space (rare).

## The kit (`src/world/kit.js`)

Reusable architectural pieces, all merging into the Assembler. The important
ones:

- `BOX(A)`, `BOX_SOFT(A)`, `BOX_FINE(A)`, `BOX_THIN(A)` — shared chamfered
  unit boxes (chamfer is what catches edge light; `BOX_THIN` is a plain box
  for slivers where a chamfer would z-fight)
- `slab(A, key, pm, …)` — a wall slab placed by a panel matrix
- `facadeWall(A, pm, spec)` — a full facade panel with window/door bays
- `windowUnit / doorUnit / shopfront / balcony / awning / drainpipe` —
  facade furniture, all rng-varied
- `parapet(A, key, cx, cz, w, d, y, rng)` — roofline with damage
- `stairRun(A, pm, x, y, z, w, steps, rise, run, opts)` — a real flight of
  steps WITH its collision; this is how every roof/deck becomes reachable
- `rubbleMound(A, rng, x, y, z, radius, count)` — debris piles
- `stripedCloth`, `pockGeometry`, `spallPatch` — damage and dressing

`src/world/util.js` has the raw generators: `chamferBox`, `tubeY`,
`polyPrism`, `rockGeometry`, `clothGeometry`, `fbm3` noise, `paintMasks`
(vertex wear/grime/AO masks), `patchGeometry`, `warpGeometry`.

For full multi-storey buildings with interiors, `buildBuilding` in
`buildings.js` consumes `BUILDINGS`-style specs (see `layout.js` and
`interiors.js`) — reuse it if the map is architectural like the market
rather than industrial like Rust.

## The palette (`src/world/palette.js`)

Materials are procedural and shared; a build refers to them by key
(`A.add('plaster_sand', …)`). Never invent a hex — pick keys. The families:

- plasters: `plaster_cream / _sand / _blue / _pink / _white`
- masonry/concrete: `brick`, `brick_red`, `brick_lime`, `concrete`,
  `concrete_dark`, `stone_pale`, `roof_screed`, `roof_tile`, `tile_floor`,
  `floor_concrete`, `floor_wood`
- ground: `road_dust`, `asphalt`, `sand`, `dirt`, `gravel`, `yard_slab`,
  `lawn`
- metals: `metal_rust`, `metal_blue`, `metal_green`, `metal_dark`, `steel`,
  `steel_frame`, `steel_grate`, `corrugated`, `corrugated_fine`,
  `container_red / _blue / _green / _sand`
- wood/soft: `wood`, `wood_dark`, `wood_pale`, `fabric_red / _teal /
  _cream`, `burlap`, `rubber`, `glass`
- vegetation: `foliage`, `leaf_core`, `bark`, `bloom`
- special: `pool_water`, `court_green`, `barn_red`, `frame_white`,
  `dust_skirt`

Adding a palette key is allowed but costs texture memory (three RGBA8 maps
per surface — see `TEXTURE-PERF.md`); map the asset's colours onto existing
keys first.

## The prop vocabulary

`registerProps(A, rng)` from `props.js` gives the shared library; call it
first in every build. Existing prototype ids include:

crates/containers: `crate_a/b/c`, `crate_flat`, `pallet`, `box_card_a/b`,
`cont_red/blue/green/sand` (via `rustprops.js`) · barrels/cans: `barrel_rust/
blue/wood`, `jerry_can`, `gas_bottle`, `bucket`, `can`, `bottle` · street:
`jersey`, `sandbag_a/b/c`, `tyre`, `tyre_small`, `lamp_post`, `sign_board`,
`sign_hang`, `planter`, `litter`, `wreck`, `stall` · industrial (rustprops):
`spool`, `valve`, `ibeam`, `tank_horiz`, `generator`, `pipe_long/short/
stack`, `flood_mast`, `flood_lens`, `trestle` · rubble: `brick_a/b`,
`block_big/small`, `slab_shard`, `plank_a/b`, `rebar`, `scrap_a/b`, `rock_a/
b` · furniture: `table`, `table_small`, `chair`, `shelf`, `cabinet`,
`mattress` · rooftop: `ac_unit`, `water_tank`, `roof_vent`, `sat_dish`,
`ladder` · vegetation: `palm_trunk`, `palm_frond`, `shrub`, `weeds`.

Wilmot/Fishers/Loop each add estate/urban vocabularies in `wilmotprops.js`,
`fisherprops.js`, `loopprops.js` — check those before writing anything
garden- or street-shaped.

## Writing a new props file (`<id>props.js`)

Model it on `rustprops.js`. Each prop is built with `PB` (from `props.js`):
a part accumulator of chamfered boxes/tubes/cloth that merges into ONE
geometry with automatic convex-edge wear, registered once with `A.proto`.
The design stance, verbatim from that file: block the form, spend triangles
only on the silhouette (posts, rails, castings), and let the material's
normal map carry corrugation and surface detail — a container is ~13k
instanced triangles for a whole yard instead of ~200k, *because* the ribs
are in the normal map, not the mesh. `p.box(...)` / `p.cyl(...)` take
per-part `{ bevel, wear, grime, ao }` mask options; masks multiply
per-instance so no two instances weather alike.

## Ground and terrain

Simplest (Fishers): a flat plane, every height difference *built* on top —
cheapest to collide and the self-test can assert flatness. Analytic
(Rust): `groundY` is a closed-form function (slab inside the perimeter,
`fbm3`-rolled ridge outside for the horizon); the terrain mesh samples it
and collision comes with it. Whatever the choice, `groundY` is the single
source of truth: props are dropped on it, spawns validate against it, and
the self-test requires it finite on a 4 m grid across the bounds. Keep the
area outside the perimeter cheap scenery — a berm, treeline or ridge that
hides the horizon line (a bare terrain/sky meeting line reads as a flat
cut-out; see Rust's `groundYRust` comment).
