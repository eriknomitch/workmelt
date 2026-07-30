# From assets to a playable layout

How to keep the layout faithful to the reference material while making it a
good Workmelt FFA map. The game is a fast room-based free-for-all for up to
~8 players plus bots, on maps 55–120 m across, fought at every range with
mantling (~0.5 m) but no ladder climbing.

## 0. If the reference is a 3D model, measure it

`node tools/glb-plan.mjs <file.glb> --scale=0.01 --depth=3 --cell=1` prints a
model's true extent, its named parts, and a top-down ASCII height field with
slices — a floor plan you can read footprints straight off. Two things it
exists to catch up front: downloaded models are routinely **not in metres**
(Sketchfab exports are often centimetres — check the extent against something
you know before copying a single coordinate) and routinely **not axis-aligned**
(`--yaw=<deg>` spins the sampling grid until the layout squares up into the
rectangles a map module is authored in).

The model is a measuring tape and nothing else. Nothing from it is loaded,
imported or sampled — see the hard rules in `SKILL.md`. Keep the file out of
the repo; `assets-src/*` is already gitignored.

## 1. Calibrate scale first

Everything downstream depends on metres being right. Anchor to objects of
known size in the assets: doors ≈ 1 m wide, storey height ≈ 3 m, cars
≈ 4.5 m, a 20 ft container 6.06 × 2.44 m, parking bays ≈ 2.5 m wide. If the
source is a real place, its true dimensions may be findable; if it is a game
map, published dimensions are usually paced in-game — treat them as ±20 %.

Then fit to the Workmelt band. If the source is larger than ~130 m,
**crop to its best fighting core** rather than shrinking uniformly —
compressed layouts lose their cover rhythm (doorways shrink below shoulder
width, lanes below two bodies). State the crop in your summary.

## 2. Transcribe, then adjust — keep the two passes separate

**Transcription pass:** place every mass from the asset at its measured
position in LEVEL space (origin centre, north −Z), as axis-aligned rects
where possible — the occupancy tests and self-test read rects. Preserve the
things that make the place recognisable: the proportions of its main open
space, the relative positions of landmarks, its signature objects.

**Playability pass:** adjust with named reasons. What to look for:

- **Lanes.** The market's main street is 9 m of asphalt kerb-to-kerb inside
  a 13 m building line; its alleys are 3–4 m. Below ~3 m a lane is a
  corridor fight only; above ~15 m unbroken it is a sniper lane — break it
  with cover every 8–12 m (the market's stall/jersey/wreck rhythm).
- **A landmark.** One tall or unmistakable element visible from most of the
  map (derrick, gate, manor, elevated track). It orients players and gives
  the self-test an invariant. If the asset lacks one, promote something.
- **Loops, not dead ends.** Every space needs ≥ 2 exits so a player is
  never trapped by one watched door. Cul-de-sacs in the source get a
  broken wall, an alley or a window mantle.
- **Verticality by stairs.** Decide which roofs/decks are *positions* and
  give each a real stair (`stairRun`) with an open run-up; everything else
  is cover/scenery. A stair lands on a platform at its EDGE — a flight
  rising inside a platform would come up through it (see the derrick's
  cantilevered nest). Keep stair feet clear of prop placement; Rust
  publishes the stair foot in its constants for exactly this reason.
- **Cover density.** Sample walkable fraction: dense urban ~0.3–0.6, a
  yard ~0.45–0.9, open estates ~0.5–0.92. Open ground wider than ~20 m
  with no cover is a no-man's-land nobody crosses.
- **Sightline check.** Walk the plan mentally from each spawn zone: every
  long sightline should have a flank route, every powerful position
  (landmark top, long-lane overlook) an exposed approach that prices it.

## 3. Seal the perimeter

The map edge must read as a place, not a wall of nothing, and must not leak.
The established patterns: fence + parked container across each gate (Rust),
estate wall/treeline with closed gate leaves (Wilmot, Fishers), hoarding,
barriers and dumpster lines across street mouths (Loop), background
building masses past the play line (Market — with `skipSides` on the faces
nobody sees). Openings in the perimeter are good (a sealed box reads as a
box) — but every opening gets something solid parked across its first 2–3 m,
and the self-test must probe it. Add one or two background masses beyond
the perimeter if the horizon would otherwise be a bare terrain/sky line.

## 4. Author the spawn table

Zones are the unit the map is reasoned about in (crowding is counted per
zone). Author like CoD does:

- A zone = a cluster of **3–6 points, 5–9 m apart**; zones **20–40 m
  apart**, one per distinct area of the map (each gate, each corner
  structure, each flank lane…). The self-test wants ≥ 4 zones, ≥ 2 points
  per zone, centroids > 5 m apart; real maps ship 8–12 zones.
- Every point on open, standable ground inside bounds; yaw looking into the
  play space (aim-at-landmark plus a hand `turn` is the clean pattern).
- Cover the map's compass: the director scores against live enemies, and it
  can only pick from what you author — a map with all zones on one side
  spawn-loops.
- Index 0: the boot spawn, somewhere with a good establishing view of the
  landmark (it frames captures). Frozen once baselines exist.

## 5. Palette and mood

Map the asset's materials onto palette keys (see `engine-api.md`) and say
so in comments ("the source's red brick → `brick_red`"). If the asset shows
a distinctive time of day or weather, use the descriptor's `environment` —
but remember the Loop rule: a night map's emitters (signs, lit rooms,
lamps) must be *placed for* its hour, and the map without an `environment`
gets clean daylight defaults. Daylight is the cheap, safe choice.

## 6. Budget sanity while designing

- Structures: the existing maps ship 4–18 buildings/structures plus
  background masses. Every enterable interior multiplies cost (rooms,
  furniture, lights) — the market ships 3 enterable of 18. One or two
  enterable landmarks beat ten hollow shells.
- Props: thousands of *instances* are fine (they batch); dozens of new
  *prototypes* are not (each is geometry + a draw call per 64 m chunk).
- Keep total draw calls under ~250 to leave headroom under the 320 gate —
  check `A.stats` output in the self-test run.
- Lights: punctual lights are budgeted by the render system; a handful of
  lamp anchors is fine, a hundred is not. Daylight maps barely need any.

## 7. When the assets and playability conflict

Accuracy is the default; playability wins conflicts; **report every
deviation**. Typical calls: widen a lane, punch a second doorway, delete an
unreachable mezzanine, move a landmark 5 m for a sightline, crop the site.
The user gave you a specific place — the deliverable is that place, tuned,
and a summary honest about the tuning.
