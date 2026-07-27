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
2. **Nothing in the repo can currently tell you that.** `tools/perf.mjs` and
   `tools/profile.mjs` measure frame time, `tools/analyze.mjs` prints pixel
   statistics, and no tool anywhere answers "can the player still see an enemy
   at this tier". A goal you cannot score is a wish.

## Definition of done

Every criterion below passes in one `node tools/goal.mjs` run. The exit code is
0 only in that case. `UNVERIFIED` is not a pass.

| ID | Criterion | Threshold |
|---|---|---|
| V1 | Sharpness floor per tier | `edgeEnergy` >= floor x `ultra`, per shot: performance 0.60, low 0.80, medium 0.92, high 0.98 |
| V2 | Shadow legibility | `crushPct` <= ultra + 1.0pp, and `shadowDetail` >= 0.75x ultra, per shot |
| V3 | Enemy legibility | per actor: Weber contrast >= 0.15 inside 30 m; >= 0.5x ultra's silhouette pixels and >= 0.8x ultra's contrast; no enemy that resolves at ultra may fail to resolve at a lower tier |
| V4 | Tone consistency | mean luma within 8 levels of ultra — a cheap tier may be softer, not darker or washed out |
| P1 | Cost ceiling per tier | `costIndex` / ultra <= performance 0.25, low 0.45, medium 0.70, high 0.90 |
| P2 | Tier ladder | each tier <= 0.85x the modelled cost of the tier above it (no tier that costs what the one above costs) |
| P3 | CPU simulation cost | `fixed+update+late` within 110% of the recorded baseline |
| H1 | Target FPS on real hardware | at the tier auto-calibration selects: `fps.p50` >= target and `fps.p99` >= 0.75x target |
| H2 | No hitching on real hardware | hitches <= 0.5% of frames |

V1-V4 and P1-P3 are decided headlessly and can be re-checked after every edit.
H1-H2 need a GPU and are ingested from a real run — see below.

## How this is measured without a GPU

Chromium's SwiftShader backend runs the real WebGL2 shaders and produces the
real image. Verified in this repo: the game boots, renders and screenshots
correctly under `--use-angle=swiftshader` on a 4-core container with no GPU at
all. It is slow — roughly 2 s per frame at 640x360, 4 s at 960x540 — and it is
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

- **`edgeEnergy` rewards aliasing.** A tier with TAA off can score higher than
  `ultra` on a shot full of hard edges, because a stair-stepped edge has more
  gradient than a resolved one. It is reliable for catching a *soft* image (an
  upscaled buffer, the failure this goal is about) and unreliable as a general
  "looks better" score. Keep the captured PNGs (`--png=.goal/shots`) and look at
  them before believing a big V1 win.
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
