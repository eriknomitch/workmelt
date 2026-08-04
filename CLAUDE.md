@AGENTS.md

## Claude Code

Deep-dive docs — read on demand, not loaded at session start:

- `DESIGN.md` — the WORKMELT brand and design system: palette, type pairing, the
  65/20/10/4/1 ratio rule, contrast floors and motion timing. Read it before
  touching the lobby, the pause/settings menu or the multiplayer overlay. The
  tokens themselves live in `src/ui/brand.js`; never hard-code a hex outside it.
- `ARCHITECTURE.md` — the engine contract. Read it in full before changing subsystem behavior, `ctx` wiring, or cross-system events.
- `MULTIPLAYER.md` — room-based FFA model, `server/` relay, and the net protocol.
- `CLOUDFLARE.md` — Worker + Durable Object deploy path for `worker/`.
- `TEXTURE-PERF.md` — where texture memory, per-pixel fetches and character draw
  calls actually go, and why a shipped texture pack is the wrong tool for it.
- `LIBRARIES.md` — what `three@0.180` already ships that we don't use, which
  platform APIs replace a dependency, and the one third-party runtime library
  worth a rule change. Read before proposing any new dependency.

## GPU-less cloud sandboxes

Claude Code on the web runs in a container with no GPU. Detect it before
reaching for any browser harness — `ls /dev/dri` is empty, `$DISPLAY` is unset,
and `CLAUDE_CODE_REMOTE=true` is in the environment. WebGL2 still works, but
only through ANGLE's SwiftShader backend, which rasterises every pixel on 4
shared CPU cores. `harness.mjs`'s `resolveGpuMode()` already detects this and
returns `'swiftshader'`; the numbers below are what that costs.

**Default to not rendering.** The Node-only self-tests listed in `AGENTS.md`
carry most of the real coverage and are effectively free here — all fifteen of
them (`physics`, `ai`, `ai/lod`, `ai/footstep`, `weapons/balance`,
`weapons/throwables`, `weapons/loadout`, `audio/attenuation`, `core` × 4,
`render/resolution`, `world/maps`, `world/spawns`) run in **~10 s combined**,
and `world/maps.selftest.mjs` builds every map headlessly without a browser at
all. Run those plus `npm run build` and stop there unless the change is
genuinely a function of the image. Reach for a capture only when you have
changed shading, post-processing, materials, lighting or layout and cannot
otherwise tell whether the picture is right. State plainly that you skipped the
visual check and why — a skipped render reported as a pass is much worse than a
skipped render.

**`node tools/capture.mjs` at its defaults does not work here.** Its defaults
(1920×1080, `--settle=90`, prewarm on, `--timeout=90000`, and a hardcoded
`--use-angle=metal` that Chromium quietly ignores in favour of
`swiftshader-webgl`) are calibrated for a machine with a GPU. Measured on this
container it renders for **25 minutes and then still fails**, because
`page.screenshot` keeps its own 30 s Playwright default that the tool never
raises. Do not "fix" that by passing a longer `--timeout`; that argument is not
what expires. Shrink the work instead:

```
# ~40 s — the smoke-test recipe. Prefer this.
OW_PORT=5273 node tools/capture.mjs --shot=hero \
  --w=640 --h=360 --settle=8 --timeout=600000 --query="prewarm=0&q=performance"

# ~200 s — when 640x360 is genuinely too coarse to judge the change.
OW_PORT=5273 node tools/capture.mjs --shot=hero \
  --w=960 --h=540 --settle=16 --timeout=600000 --query="prewarm=0"
```

Three separate levers, in the order they pay off:

- `?prewarm=0` — shader prewarm alone costs **52 s** here (`[ai]
  prewarmMaterials` ~52.5 s), and it is pure warm-up: it changes nothing about
  the resulting image. It is a supported engine flag (`src/main.js:151`) and is
  already what `harness.mjs` passes. Always set it.
- `--w`/`--h` — SwiftShader cost is linear in pixels. 640×360 and 960×540 are
  both verified working; 1920×1080 provably fails at the screenshot step.
  Treat 960×540 as the ceiling and anything above it as untested — the failure
  mode is a wasted run, not a slow one.
- `--settle` — every settle frame is a full software-rasterised frame. 8 is
  enough to see whether geometry, materials and exposure are sane; TAA will not
  have fully converged, so do not read fine temporal detail off such a frame,
  and never compare it against a baseline captured at different `--w/--h/--settle`.

Keep one dev server up and share it. Start `npm run dev` once and pass
`OW_PORT=5273`, because every harness attaches to whatever is already listening
rather than paying the Vite-plus-shader-warmup boot again. Note that
`tools/cost.mjs` and `tools/visibility.mjs` default to their **own** ports
(5331 and 5321), so they boot a second and third server unless you pass
`--port=5273` explicitly — and `tools/goal.mjs` shells out to both without
forwarding a port at all.

**The goal gate is expensive; scope it.** One tier × one shot at `goal:quick`
dimensions measures at **37 s** against an already-running server, and
`npm run goal` sweeps five tiers over three shots plus targets, twice over
(`visibility.mjs` then `cost.mjs`) — tens of minutes. Narrow it with
`--tiers=` and `--shots=` to the tier you actually changed, and use
`node tools/goal.mjs --score-only` to re-score the last measurement for free
rather than re-measuring. Prefer `npm run goal:quick` over `npm run goal`.

**Frame rate is not measurable here, at any resolution or duration.** Do not
report fps, and do not let a SwiftShader wall-clock number stand in for one.
`costIndex` ratios and `cpuSimMs` from `tools/cost.mjs` are the honest signals;
`swMsPerFrame` is corroboration only. Real fps comes from `tools/profile.mjs` on
real hardware, fed back via `tools/goal.mjs --ingest`. Leave the H* criteria
UNVERIFIED and say so instead of guessing.

**The browser playtests do run here**, since they drive DOM and engine state
rather than judging pixels. `npm run playtest:ads` passes 21/21 in **88 s**
against a shared dev server; the others (`playtest:graphics`,
`playtest:grenade`, `playtest:lobby`) are built the same way and all fall back
to `OW_PORT` with small viewports. They are still a minute or more each under
SwiftShader, so run the one that covers your change, not the set.
