---
name: visual-check
description: >-
  Verify a Workmelt change by looking at the rendered picture — captures,
  screenshots, image diffs, baselines, the goal/visibility/cost gate, and the
  browser playtests. Use this skill whenever the work calls for a capture or a
  screenshot, whenever a change touches shading, post-processing, materials,
  lighting, layout or the HUD and someone needs to see whether the frame is
  right, whenever `tools/capture.mjs` / `imagediff.mjs` / `goal.mjs` /
  `visibility.mjs` / `cost.mjs` / `profile.mjs` are involved, and whenever
  performance or quality-tier work needs measuring. Also use it before
  reporting fps or a perf number, and before claiming a visual check passed.
---

# Look at the picture

The engine's cheap coverage is the Node-only self-tests; this skill is for the
part they cannot reach — whether the frame is actually right. Two rules govern
everything below, and both are about honesty rather than technique:

1. **A command exiting 0 is not a visual check.** The picture is. If a `.png`
   was written and nobody read it, no check happened.
2. **A skipped render reported as a pass is much worse than a skipped render.**
   Say plainly that you skipped it and why.

## First: should you render at all?

Usually not. The seventeen Node-only self-tests (see `AGENTS.md`) carry most of
the real coverage and run in ~10 s combined. Run those plus `npm run build` and
stop there **unless the change is genuinely a function of the image** — shading,
post-processing, materials, lighting, layout, or a HUD/menu surface.

Collision is the sharpest example of the inverse: it is authored separately from
the mesh, so an invisible wall is invisible *in a capture too*. The frame is
correct and the thing that is wrong is the thing that is not drawn.
`node src/world/collision.selftest.mjs` catches it; no screenshot can.

## Detect the environment before reaching for a browser

Claude Code on the web runs in a container with **no GPU**: `ls /dev/dri` is
empty, `$DISPLAY` is unset, `CLAUDE_CODE_REMOTE=true`. WebGL2 still works, but
only through ANGLE's SwiftShader backend, rasterising every pixel on 4 shared
CPU cores. `tools/lib/harness.mjs`'s `resolveGpuMode()` already detects this and
returns `'swiftshader'`.

This matters because **`node tools/capture.mjs` at its defaults does not work
there** — it renders for 25 minutes and still fails. Read
`references/gpuless-sandbox.md` before capturing, scoping the goal gate, or
quoting any timing in that environment. On real hardware the defaults are fine.

## Capture

Always pass an explicit `--out=` under the scratchpad directory rather than
letting the tool pick a path, so you know what to read back. The tools perform
no shell expansion of a variable you did not export — write the real absolute
path.

```
# real GPU — defaults are calibrated for this
node tools/capture.mjs --shot=hero --out=<scratchpad>/after.png

# GPU-less container — the smoke-test recipe (~40 s)
OW_PORT=5273 node tools/capture.mjs --shot=hero \
  --w=640 --h=360 --settle=8 --timeout=600000 \
  --query="prewarm=0&q=performance" --out=<scratchpad>/after.png
```

`tools/capture.mjs` frames the boot map from its spawn 0; `--query="map=<id>"`
shoots another. `npm run shot` is the same command.

Keep one dev server up and share it: start `npm run dev` once and pass
`OW_PORT=5273`, because every harness attaches to whatever is already listening
instead of paying the Vite-plus-shader-warmup boot again. `strictPort` is on.
Note that `tools/cost.mjs` and `tools/visibility.mjs` default to their **own**
ports (5331 and 5321) and boot extra servers unless you pass `--port=5273`, and
`tools/goal.mjs` shells out to both without forwarding a port at all.

## Then actually look at it

**`Read` the exact path you just wrote.** A `Read` on an image renders it inline
in the transcript, which is the only way the render gets looked at rather than
assumed. Paying for a frame and never reading it is worse than skipping the
capture, because it reads as a visual check that never happened.

This applies to *anything* that writes a `.png` — `tools/capture.mjs`,
`tools/imagediff.mjs`, a `page.screenshot` inside a playtest, a one-off script.

**Then send it to the user with `SendUserFile`** when the image is the point of
the work — a before/after, a layout change, a bug you are demonstrating. `Read`
puts the frame in front of you; only `SendUserFile` puts it in front of them.
Pass `display: "render"` so it opens inline rather than as a download card,
batch related frames into one call, and caption it with what to look at.

Two frames captured at the same `--w/--h/--settle` are a fair before/after.
Frames captured at different settings are **not**, and must not be presented as
one. The same goes for comparing against a `tools/baseline.mjs` baseline —
preserve deterministic output so baselines and `tools/imagediff.mjs` stay
meaningful.

## The goal gate

Quality-tier and performance work is gated by `node tools/goal.mjs`, which
scores the open goals in `goals/`. `tools/lib/selftest.mjs` (`npm run
test:metrics`) covers the measurement primitives behind it.

It is expensive — `npm run goal` sweeps five tiers over three shots plus
targets, twice over (`visibility.mjs` then `cost.mjs`). Scope it:

- `npm run goal:quick` over `npm run goal`.
- `--tiers=` and `--shots=` narrowed to the tier you actually changed.
- `node tools/goal.mjs --score-only` re-scores the last measurement for free
  rather than re-measuring.

## Never report fps you did not measure

Frame rate is **not measurable on a GPU-less machine**, at any resolution or
duration. Do not report fps there, and do not let a SwiftShader wall-clock
number stand in for one. `costIndex` ratios and `cpuSimMs` from `tools/cost.mjs`
are the honest signals; `swMsPerFrame` is corroboration only.

Real fps comes from `tools/profile.mjs` on real hardware, fed back via
`tools/goal.mjs --ingest`. Leave the H* criteria UNVERIFIED and say so instead
of guessing.

## Browser playtests

These drive DOM and engine state rather than judging pixels, so they run
anywhere — including the GPU-less container, where `npm run playtest:ads` passes
21/21 in ~88 s against a shared dev server.

- `npm run playtest:ads` — pause menu and ADS binds.
- `npm run playtest:graphics` — advanced graphics menu, including a reload that
  carries overrides back into `config.q`.
- `npm run playtest:grenade` — G / H equipment binds: cook, arc preview, throw,
  detonation, HUD pips, the stun's screen flash.
- `npm run playtest:lobby` — the whole join flow in two real browsers against a
  real relay.

They are a minute or more each under SwiftShader. Run the one that covers your
change, not the set.
