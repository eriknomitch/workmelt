# BLUEPRINT — the tactical architectural blueprint visual system

Scope and plan for reworking WORKMELT's maps and gameplay assets into one
cohesive "tactical architectural blueprint" aesthetic. This document is the
plan, not the implementation: it records what the target is, what the codebase
already gives us, where the brief and the existing code genuinely conflict, and
what order the work lands in.

Read `DESIGN.md` first — the brand rules this extends. Read `ARCHITECTURE.md`
before touching subsystem wiring, and `TEXTURE-PERF.md` before touching a
material bake.

---

## 1. Decisions locked before scoping

Two questions had to be answered before the plan had a shape. Both are settled.

**The maps keep their fiction.** Market stays a Levantine market street, Rust a
desert refinery, Wilmot and Fishers stay country estates, Loop stays a Chicago L
intersection at night. "Tactical architectural blueprint" is a **rendering,
materials, markings and presentation grammar** applied over those fictions — not
a re-set. Wilmot does not become a corporate campus; it becomes a precisely
drafted manor. The brief's vocabulary of brutalist campuses and logistics
facilities describes the *drafting discipline* we borrow (modular proportion,
readable façade hierarchy, technical markings, deliberate negative space), not
the subject matter of the shipped levels.

**Materials get retuned, not replaced.** The 20 procedural generators in
`src/materials/library.js` stay. What changes is the *parameters* in
`src/world/palette.js`: weathering and grime terms come down, value separation
widens, window glass becomes a controlled value block, and the reflectance band
tightens. No literal flat-shaded material path.

Why not flat-shaded, given the brief asks for it: nearly every one of the 81
keys in `palette.js` carries a comment arguing that its surface detail is what
holds value separation at gameplay distance (see `road_rut`, `yard_slab`,
`container_*`, `burlap`). Those arguments are correct, and the open goal in
`goals/perf-visibility.md` scores exactly that property — criterion V1
(`microDetail` floor per tier) and V5 (enemy Weber contrast ≥ 0.15 at ultra).
Flattening the world wholesale would trade a legible arena for a stylistically
purer one. The retune gets the *look* the brief wants — matte, restrained,
uncluttered — by pulling grime and contrast down rather than by deleting the
detail that makes cover readable.

---

## 2. What the codebase already gives us

| Capability | Where | State |
|---|---|---|
| Map descriptor contract | `src/world/maps.js` | Solid. Carries `id/name/subtitle/blurb/size/transform/bounds/spawnPoints/standable/groundY/isOpen/build/environment`. **No `accent`, no `landmark`.** |
| Five maps | `market.js` `rust.js` `wilmot.js` `loop.js` `fishers.js` | All procedural, nothing loaded from disk. Strong individual identities already. |
| Modular kit | `src/world/kit.js` | Already good: `facadeWall`, `windowUnit`, `doorUnit`, `shopfront`, `balcony`, `parapet`, `stairRun`, `awning`, `drainpipe`. This is the seed of the blueprint kit. |
| Surface palette | `src/world/palette.js` | 81 keys, one draw call per key. Tuned toward weathered realism. |
| Material generators | `src/materials/library.js` | 20 procedural bakes + aliases. Untouched by this work. |
| Per-map sky | `maps.js` → `sky.applyEnvironment` | Works, but **only Loop declares an `environment`**. The other four inherit sky defaults. |
| Orthographic map bake | `src/ui/minimap.js` | Already renders a real top-down vector map of the level, with a depth-bake fallback. Directly reusable for map cards. |
| Lobby map cards | `src/match/ui.js` | **Text only** — name, subtitle, blurb, size. No preview of any kind. |
| Quality tiers | `src/core/quality.js` | Five presets, adaptive calibration, per-tier cost ceilings enforced by the goal harness. |
| Pixel gate | `tools/baseline.mjs`, `tools/imagediff.mjs` | 11 shots (`src/dev/shots.js`), framed on Market. |
| Perf/visibility scorecard | `tools/goal.mjs`, `goals/perf-visibility.md` | **Open goal.** Any visual change is scored against V1–V5, P1–P3. |

### What does not exist at all

- **No decal or ground-marking path.** Painted lane arrows, numbered bays, zone
  markers, measured signage, grid motifs and architectural labels — the entire
  "subtle technical details" clause of the brief — has no engine capability
  behind it. `kit.js:974` documents the y-flush trick a decal would need, but
  nothing implements one.
- **No text or glyph baking anywhere in the world.** No `CanvasTexture`, no
  `fillText` in `src/world/` or `src/materials/`. Bay numbers and signage
  lettering need a new atlas path.
- **No per-map accent in code.** DESIGN.md states the one-accent-per-map rule as
  a brand principle; no map declares one and nothing enforces it.
- **No landmark concept.** Each map has a de facto landmark (Rust's derrick,
  Market's arched gate, Loop's elevated structure, Wilmot's manor, Fishers' pool
  axis), but it is not declared, not enforced, and not used by presentation.

---

## 3. Tensions the brief leaves open, and how they resolve

**Loop is a night map.** "Bright overcast daylight" is incompatible with it, and
the brief scopes that clause to "daytime maps." Loop's hour is authored as part
of its identity — lamps, marquee, blade sign and seventy lit windows are the key
light (`loop.js:1700`). Loop is **explicitly exempt** from the daylight rule and
carries the blueprint language through architecture, markings and signage
instead. Its accent is its own (green LEDs read correctly at night).

**"One dominant accent per map" vs. maps that already have two or three.**
Fishers has turquoise pool tile, oxide-red court clay and green conifers. Wilmot
has barn red, court green and rose blooms. Assigning one accent means demoting
the others toward the neutral graphite/gunmetal/concrete/cloud spine — not
deleting them. Concretely: they lose saturation and gain grey, so the accent is
the only chromatic event in the frame. This is a per-map judgement call, made
during Phase 3 with a capture in hand, not decided here.

**Baseline and goal churn is the real cost.** Every pixel baseline is framed on
Market, so any change to `palette.js` moves all 11 shots and the whole set has to
be re-shot and re-reviewed. And because `goals/perf-visibility.md` is open,
Phase 1 has to re-score `npm run goal` rather than assume it still passes.
Budget this as work, not as a formality — it is the single largest verification
expense in the plan.

**Amber vs. Melt Green vs. cyan must not collide.** The brief assigns three
overlapping jobs: Melt Green for gameplay-critical interaction and pickups,
cyan/pale blue for technical markings and navigation, amber for objectives,
routes and warnings. In a live frame these can read as the same "this matters"
signal. The rule this plan adopts: **Melt Green is the only colour that ever
means "you can interact with this right now."** Cyan is always inert
information. Amber is always a place, never an action. Phase 0 writes that into
the token module so it is enforceable rather than remembered.

---

## 4. The plan

Six phases. Each is independently shippable and independently verifiable; none
requires the next one to land to be worth having.

### Phase 0 — Contract and tokens

The foundation everything else references. Small, low-risk, unblocks the rest.

- Add `accent` and `landmark` to the map descriptor in `src/world/maps.js`, with
  the contract documented in the header block alongside the existing fields.
- New `src/world/accent.js`: the approved accent set (brick red, warm teak,
  storage orange, sky blue, corporate teal, green LED, safety yellow), plus
  technical cyan and objective amber, plus the graphite/gunmetal/concrete/cloud
  structural spine. No map hard-codes an accent hex; every one names a token.
  Encodes the three-signal rule from §3.
- Assign one accent and one landmark per map (five one-line descriptor edits).
- Extend `src/world/maps.selftest.mjs`: every map declares an accent from the
  approved set and a landmark; **no two maps share an accent**; every accent
  token resolves.

**Verify:** `node src/world/maps.selftest.mjs`.
**Risk:** none. No rendered pixel changes.

### Phase 1 — The material finish pass

Where the aesthetic actually lands on every surface in the game.

- Retune `src/world/palette.js`: pull the `weather` rain/grime/ground-splash
  terms down across the board, widen value separation between adjacent keys,
  tighten the reflectance band toward the matte middle, and cut the gloss on
  `window_glass` / `pool_water` so glass reads as a controlled value block
  rather than a sky mirror.
- New keys for the blueprint kit: painted marking white, technical cyan, safety
  amber; glazing value-block; chain-link; pipe rail; parapet trim; curb.
- Verify the retune against the render pipeline's AO and shadow path
  (`src/render/gtao.js`, `src/render/csm.js`) — "gentle ambient occlusion,
  restrained contrast" is as much an exposure and AO-weight question as a
  material one.

**Verify:** `npm run build`; `node tools/capture.mjs` on every map; re-shoot
`tools/baseline.mjs` and review all 11 shots; **`npm run goal` re-scored** with
V1/V2/V4/V5 read carefully.
**Risk:** high — this is the phase that can regress legibility. It is also the
phase whose payoff is largest.

### Phase 2 — Markings and signage capability

Net-new engine capability, and the clause of the brief with nothing behind it.

- A ground-marking path in `src/world/`: y-flush projected quads on the trick
  `kit.js:974` already documents, merged into one draw call per material.
- A glyph atlas baked once at build time for numerals, short uppercase labels
  and arrow glyphs — bay numbers, zone markers, measured signage, access-control
  panels, architectural labels.
- Kit additions for the façade vocabulary the brief names and the kit lacks:
  repeated window bands, framed glazing, roof monitors, loading bays, curbs,
  planters, utility poles, signage boards.
- Hard constraints: seeded `ctx.rng` only (never `Math.random()`), no per-frame
  allocation, one atlas → one draw call, disposed on map teardown.

**Verify:** a new `src/world/markings.selftest.mjs` (determinism, draw-call
count, atlas disposal); `node tools/drawcalls.mjs`; `node tools/texcost.mjs`.
**Risk:** medium — the budget risk is real, which is why draw calls and texture
cost are gated rather than eyeballed.

### Phase 3 — Per-map application

Five separate passes. One map per commit, each with a capture.

Per map: apply the declared accent and demote competing chroma; sharpen the
landmark silhouette so it reads from gameplay distance *and* from the isometric
card; apply markings and façade hierarchy; make enterable structures obvious
through doors, stairs, glazing and lighting; keep scenic, climbable and
cover-critical geometry visually distinct.

**Non-negotiable per map:** gameplay lanes, cover density, spawn logic,
sightlines, verticality and playable bounds are unchanged. Every pass re-runs
`node src/world/maps.selftest.mjs`, `node src/world/spawns.selftest.mjs` and
`node src/world/spawns.probe.mjs`.

**Verify:** the three above per map, plus a capture per map, plus `npm run goal`
once at the end of the phase.
**Risk:** medium, and contained by being five independent commits.

### Phase 4 — Map presentation

Highest visibility, lowest risk, and it fills the most obvious current gap: the
lobby map cards have no preview at all.

- A headless blueprint-view baker: build each map, render orthographic/isometric,
  overlay thin cyan technical lines, north arrow, scale bar, compact uppercase
  labels. Reuses the ortho bake machinery already in `src/ui/minimap.js`.
- Wire the result into the `src/match/ui.js` map cards and the loading screen.
- Align `src/ui/minimap.js`, `src/ui/compass.js` and `src/ui/markers.js` to the
  cyan-technical / amber-objective language. The HUD stays exempt from the brand
  tokens by design (`AGENTS.md`, `src/ui/brand.js` header) — it keeps its own
  outlined, viewport-scaled treatment; only the hues align.
- Annotation discipline: cyan technical lines, north arrows, scale bars and
  route arrows live **only** in map cards, loading screens and design views.
  First-person gameplay carries the language through architecture, paint,
  signage and HUD accents — never through annotations laid over the world.

**Verify:** `npm run build`; a lobby capture; `npm run playtest:graphics` for
menu regressions.
**Risk:** low.

### Phase 5 — Documentation and the map skill

Makes the system durable instead of a one-time pass.

- Rewrite the imagery and world-palette sections of `DESIGN.md` against what
  actually shipped, and point `CLAUDE.md`'s deep-dive list at this document.
- Update `.claude/skills/create-map` so a new map is born inside the system:
  declares an accent and a landmark, draws from the blueprint kit, ships a
  blueprint card.

**Verify:** `node src/world/maps.selftest.mjs` (the contract the skill teaches).
**Risk:** none.

---

## 5. Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Legibility regression — calmer materials flatten cover separation | 1 | `npm run goal` V1/V5 are the gate, not taste. Re-score before merging. |
| Baseline churn hides a real regression in 11 moved shots | 1 | Re-shoot and review all 11 deliberately; do not batch-accept. |
| Draw-call and texture budget blown by markings | 2 | `tools/drawcalls.mjs` and `tools/texcost.mjs` gated in the phase's own selftest. |
| Determinism break from a new atlas or marking scatter | 2 | Seeded `ctx.rng` only; determinism asserted in `markings.selftest.mjs`. |
| Gameplay drift while dressing a map | 3 | Spawn selftest + spawn probe per map; lanes and bounds are frozen inputs. |
| Three accent signals collide in a live frame | 0, 4 | The one-job-per-colour rule from §3, encoded in `accent.js`. |
| Loop's night identity eroded by a daylight rule | 3 | Explicitly exempt. Documented here and in its descriptor. |

## 6. Out of scope

- Re-fictioning any shipped map (settled in §1).
- A flat-shaded material path (settled in §1).
- Weapon, character and viewmodel art. The brief says "gameplay assets," but
  `src/weapons/` and the character rig are a separate body of work with their own
  balance and animation contracts; folding them in would make every phase above
  unshippable. Worth its own scope once the world language is fixed.
- New maps. The system is built so the next map is born in it (Phase 5); building
  one is not part of this.
- Any new runtime dependency (`AGENTS.md`; see `LIBRARIES.md`).

## 7. Sequencing note

Phases 0, 4 and 5 are low-risk and high-visibility; 1 and 3 carry the real
verification cost; 2 is the one net-new capability. If the work needs to show
something early, **0 → 4** delivers declared accents, landmarks and real
blueprint map cards without touching a single world pixel — the lobby goes from
text-only cards to the aesthetic's clearest statement. Phase 1 is the one that
should not be rushed, because it is scored.
