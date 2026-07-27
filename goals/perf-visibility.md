# GOAL — hit the frame-rate target without going blind

Status: **open**. Scorecard: `node tools/goal.mjs`. Machine-readable criteria:
`tools/lib/criteria.mjs` (that file, not this one, is what decides "done").

## The complaint

On a fast machine the game reaches 120 fps and looks terrible. That is not a
coincidence, it is the design: `AdaptiveQualitySystem` calibrates against the
display refresh rate, and a 120 Hz target that the `ultra` preset cannot hold
walks the tier down to `low` or `performance`. The `performance` preset renders
at `renderScale: 0.3` — 576x324 upscaled to 1080p — with no TAA, no AO, no
bloom, one 512px shadow cascade and 30 m of shadow distance. It is fast because
it has stopped drawing the game.

Two things are wrong with that, and this goal fixes both:

1. **The cheap tiers spend their budget in the wrong place.** Measured with
   `tools/cost.mjs`, the `performance` preset's modelled GPU load is ~11% of
   `ultra`, and most of what remains is geometry (draw calls and triangles),
   which resolution scaling does not touch. It is paying full price for 1400
   draw calls and 9M triangles while destroying the one thing the player needs
   most — spatial resolution. There is a great deal of room to buy sharpness
   back and stay far below the frame budget.
2. **Nothing in the repo could tell you that.** `tools/perf.mjs` and
   `tools/profile.mjs` measure frame time, `tools/analyze.mjs` prints pixel
   statistics, and no tool anywhere answers "can the player still see an enemy
   at this tier". A goal you cannot score is a wish.

## Definition of done

Every criterion below passes in one `node tools/goal.mjs` run. The exit code is
0 only in that case. `UNVERIFIED` is not a pass.

| ID | Criterion | Threshold |
|---|---|---|
| V1 | Sharpness floor per tier | `microDetail` >= floor x `ultra`, per shot: performance 0.65, low 0.80, medium 0.88, high 0.97 |
| V2 | Shadow legibility | `crushPct` <= min(8%, ultra + 1.0pp) on every shot and tier, and `shadowDetail` >= floor x ultra: performance 0.60, low 0.75, medium 0.85, high 0.95 |
| V3 | Enemy legibility holds up at cheaper tiers | per actor vs ultra: >= 0.5x silhouette pixels and >= 0.8x contrast, and no enemy that resolves at ultra may fail to resolve below it |
| V4 | Tone consistency | mean luma within 8 levels of ultra — a cheap tier may be softer, not darker or washed out |
| V5 | Enemies read against the scene at all | median Weber contrast of enemies inside 30 m, at `ultra`, >= 0.15 |
| P1 | Cost ceiling per tier | `costIndex` / ultra <= performance 0.25, low 0.45, medium 0.70, high 0.90 |
| P2 | Tier ladder | each tier <= 0.85x the modelled cost of the tier above it (no tier that costs what the one above costs) |
| P3 | CPU simulation cost | `fixed+update+late` within 110% of the recorded baseline |
| H1 | Target FPS on real hardware | at the tier auto-calibration selects: `fps.p50` >= target and `fps.p99` >= 0.75x target |
| H2 | No hitching on real hardware | hitches <= 0.5% of frames |

V1-V5 and P1-P3 are decided headlessly and can be re-checked after every edit.
H1-H2 need a GPU and are ingested from a real run — see below.

Thresholds were calibrated against the baseline below rather than guessed, and
V3 is deliberately relative while V5 is deliberately absolute: the first catches
a tier throwing legibility away, the second catches a scene where nobody is
legible in the first place. V5 uses the median actor because one soldier
standing against a wall of his own brightness is art, and a whole squad doing it
is a bug.

## Baseline, 2026-07, 640x360, settle 16

Where the shipped presets actually stand. This is what the criteria were cut
against; regenerate with `node tools/goal.mjs --quick --save-baseline`.

| tier | internal | costIndex vs ultra | microDetail vs ultra (hero/interior/night) | shadowDetail vs ultra | night crush |
|---|---|---|---|---|---|
| performance | 192x108 | 0.11 | 0.65 / 0.56 / 0.53 | 0.56 / 0.55 / 0.50 | 6.8% |
| low | 460x259 | 0.22 | 0.78 / 0.71 / 0.68 | 0.71 / 0.68 / 0.67 | 8.2% |
| medium | 544x306 | 0.35 | 0.74 / 0.73 / 0.69 | 0.74 / 0.75 / 0.68 | 11.2% |
| high | 640x360 | 0.46 | 1.00 / 0.99 / 1.00 | 1.00 / 1.00 / 1.00 | 11.6% |
| ultra | 640x360 | 1.00 | 1.00 | 1.00 | 11.6% |

Enemy legibility on the `combat` shot, Weber contrast per actor, by range:

| tier | #4 @6.7m | #1 @9.7m | #2 @11.9m | #3 @16.4m | #5 @23.9m |
|---|---|---|---|---|---|
| performance | **0.018** | **0.005** | 0.084 | 0.455 | 0.206 |
| low | **0.023** | **0.076** | 0.183 | 0.345 | 0.096 |
| medium | 0.181 | 0.211 | 0.029 | 0.527 | 0.045 |
| high | 0.186 | 0.277 | 0.077 | 0.535 | 0.341 |
| ultra | 0.185 | 0.287 | 0.031 | 0.531 | 0.416 |

Read it: **at `performance` a soldier standing 6.7 m away has 1/10th the contrast
he has at `ultra`, and one at 9.7 m has 1/57th of it.** He is drawn — 885 of the
2050 pixels ultra gives him clear the detection threshold — but he no longer
separates from what is behind him. That is the "visibility is awful" complaint,
in numbers, and it is not caused by a lack of GPU headroom: P1 says the tier is
running at 11% of ultra's modelled load, and P1/P2/P3 all pass today. The cheap
tiers are not short of budget. They are spending it on the wrong things.

Two more findings the baseline forced:

- **`medium` is no sharper than `low`** (0.74x vs 0.78x on `hero`). It costs 1.6x
  more and returns nothing in resolvable detail — the tier ladder has a dead rung.
- **Night is crushed hardest at the TOP tiers**: 11.6% of the frame below L=6 at
  `ultra` and `high`, against 6.8% at `performance`, whose upscale blur
  accidentally lifts the blacks. V2's absolute 8% cap fails `ultra` too, on
  purpose.

## How this is measured without a GPU

Chromium's SwiftShader backend runs the real WebGL2 shaders and produces the
real image. Verified in this repo: the game boots, renders and screenshots
correctly under `--use-angle=swiftshader` on a 4-core container with no GPU at
all. It is slow — roughly 2 s per frame at 640x360, 4 s at 960x540, so a full
five-tier `--quick` scorecard is about 50 minutes on 4 cores — and it is
*wrong about time*, but it is right about pixels.

So the split is:

- **Everything that is a function of the image is measured directly.** Sharpness,
  crush, shadow detail, tone, and per-enemy legibility all come out of real
  frames. This is the whole visibility half of the goal, and it is not a proxy.
- **Frame rate is not measured at all here.** `tools/cost.mjs` builds an
  analytic `costIndex` from quantities read out of the live engine — internal
  render resolution, enabled post passes, shadow texels, draw calls, triangles.
  It is ordinal: it can say "this tier asks for 3.1x less work than ultra", it
  cannot say "112 fps". Every performance criterion is therefore written as a
  ratio between tiers, never as an absolute frame time.
- **CPU simulation cost is measured honestly**, because it has nothing to do with
  the GPU: `phasesMs.fixed + update + late`, in container-CPU terms (P3 is a
  same-machine no-regression check, not a cross-machine number).
- **Real frames per second come from real hardware**, once per iteration that
  changes the tier definitions, not once per edit.

Determinism comes from `?capture=1&lockstep=1`: the engine never schedules its
own frames, the harness advances exactly N of them, so the frame index at the
shutter is a constant and TAA jitter, AO noise rotation and exposure adaptation
all land identically run to run. Numbers are only comparable between runs that
used the same `--w/--h/--settle`.

### Per-enemy legibility, specifically

The `combat` shot is captured twice at each tier: once normally, once with the
AI root hidden. Every pixel that changed is an enemy. `window.__ACTOR_BOXES__()`
(in `src/dev/shots.js`) reports each live actor's screen-space box and range, so
those changed pixels are attributed to individual soldiers rather than to one
undifferentiated blob — which means a tier is compared against `ultra` actor by
actor, and "the soldier at 60 m stopped resolving" is caught by id instead of by
eyeball.

## Known limits of these metrics

Say them out loud rather than discovering them later as a surprise:

- **`edgeEnergy` rewards aliasing, which is why V1 does not use it.** It rated
  the 192x108-buffer `performance` tier at 0.72x of `ultra`, because a
  stair-stepped edge carries more gradient than a resolved one and `ultra`'s TAA
  softens what it resolves. `microDetail` — energy in the finest spatial band,
  which an upscale cannot invent — put the same tier at 0.53-0.65x and `high` at
  0.99x. `edgeEnergy` stays in the report as a secondary reading only.
- **`microDetail` is not a beauty score either.** It measures resolvable detail.
  Keep the captured PNGs (`--png=.goal/shots`) and look at them before believing
  a big V1 win.
- **`costIndex` is a model, not a measurement.** Its pass weights live in
  `tools/lib/costmodel.mjs` and are visible on purpose: changing them re-scores
  history, so treat that as an amendment to the goal, not as tuning.
- **`swMsPerFrame` is a shared-CPU number.** Useful as corroboration when it
  moves by 2x, meaningless when it moves by 10%.
- **The scene is one map at one time of day per shot.** The gate says nothing
  about content it never renders.

## The hardware step

```bash
# on the machine that shows the problem (the 120 Hz one)
node tools/profile.mjs --frames=900 > run.json

# anywhere
node tools/goal.mjs --ingest=run.json --tier=<tier it calibrated to> \
  --target-fps=120 --machine="whatever it is"
```

`tools/profile.mjs` drives real gameplay and reports the frame-time
distribution and every hitch. The in-page `__PERF__.startRecording()` /
`stopRecording()` API produces an equivalent object if you would rather play
the game than script it.

Until a run is ingested, H1/H2 read `UNVERIFIED` and the goal is not met. Ingest
again after any change to `QUALITY_PRESETS` or to the calibration policy — those
are the changes a headless run cannot validate.

## Levers, most promising first

0. **Start where the baseline points: `medium` is a dead rung and the cheap
   tiers have budget they are not spending.** P1/P2/P3 pass with room; V1/V2/V3
   fail. Any change that trades modelled cost for resolvable detail at
   performance/low/medium is moving in the right direction by construction.
1. **Rebalance `performance` and `low` in `src/core/config.js`.** Resolution is
   the most visible thing you can spend on and, at these tiers, not the most
   expensive. Buy `renderScale` back and pay for it with shadow distance,
   cascade count, particle/decal budget and anisotropy.
2. **Give the upscale something to work with.** A cheap sharpen or FXAA-class
   pass on the composite recovers a large part of what a sub-native buffer loses,
   for a fraction of the cost of rendering those pixels.
3. **Attack geometry, not just pixels.** At the cheap tiers `costIndex` is
   dominated by ~1400 draw calls and ~9M triangles, and neither shrinks when
   `renderScale` does. Distance culling, LOD and instancing move the floor that
   currently makes the low tiers expensive-but-ugly.
4. **Keep a real shadow and real AO at every tier.** V2 and V3 exist because
   turning them off is what makes enemies disappear into walls; a cheaper
   contact-shadow or half-res AO is the compromise, not "off".
5. **Revisit the calibration ladder in `src/core/quality.js`.** `chooseCalibrationTier`
   drops to `performance` at ratio < 0.35 and it is reached by targeting the
   display's refresh rate. A machine that can hold 90 fps at `medium` should not
   be shown `performance` because its monitor happens to run at 120 Hz.

## Working the goal

`/goal` runs the loop: score, pick the worst failing criterion, change one thing,
re-measure. The rules it follows are in `.claude/commands/goal.md`.
