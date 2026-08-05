# Capturing in a GPU-less cloud sandbox

Everything here is measured on the Claude-Code-on-the-web container: 4 shared
CPU cores, no GPU, WebGL2 via ANGLE's SwiftShader. **The numbers are specific to
that environment** — they say nothing about real hardware, and a wall-clock
figure from here must never be presented as a performance result.

Detect it first: `ls /dev/dri` is empty, `$DISPLAY` is unset, and
`CLAUDE_CODE_REMOTE=true` is in the environment. `tools/lib/harness.mjs`'s
`resolveGpuMode()` already returns `'swiftshader'` here.

## Why the defaults fail

`tools/capture.mjs` defaults to 1920×1080, `--settle=90`, prewarm on,
`--timeout=90000`, and a hardcoded `--use-angle=metal` that Chromium quietly
ignores in favour of `swiftshader-webgl`. All of that is calibrated for a machine
with a GPU. Measured here it renders for **25 minutes and then still fails**,
because `page.screenshot` keeps its own 30 s Playwright default that the tool
never raises.

Do **not** "fix" that by passing a longer `--timeout` — that argument is not what
expires. Shrink the work instead.

## The two recipes

```
# ~40 s — the smoke-test recipe. Prefer this.
OW_PORT=5273 node tools/capture.mjs --shot=hero \
  --w=640 --h=360 --settle=8 --timeout=600000 \
  --query="prewarm=0&q=performance" --out=<scratchpad>/after.png

# ~200 s — when 640x360 is genuinely too coarse to judge the change.
OW_PORT=5273 node tools/capture.mjs --shot=hero \
  --w=960 --h=540 --settle=16 --timeout=600000 \
  --query="prewarm=0" --out=<scratchpad>/after.png
```

## Three levers, in the order they pay off

**`?prewarm=0`** — shader prewarm alone costs **52 s** here (`[ai]
prewarmMaterials` ~52.5 s), and it is pure warm-up: it changes nothing about the
resulting image. It is a supported engine flag (`src/main.js`, the `params.get('prewarm')`
check around the `prewarm(engine)` call) and is already what `harness.mjs`
passes. Always set it.

**`--w` / `--h`** — SwiftShader cost is linear in pixels. 640×360 and 960×540 are
both verified working; 1920×1080 provably fails at the screenshot step. Treat
960×540 as the ceiling and anything above it as untested — the failure mode is a
wasted run, not a slow one.

**`--settle`** — every settle frame is a full software-rasterised frame. 8 is
enough to see whether geometry, materials and exposure are sane. TAA will not
have fully converged, so do not read fine temporal detail off such a frame, and
never compare it against a baseline captured at different `--w/--h/--settle`.

## Share one dev server

Start `npm run dev` once and pass `OW_PORT=5273` to everything. Every harness
attaches to whatever is already listening rather than paying the
Vite-plus-shader-warmup boot again, so a whole suite pays the ~20–40 s boot cost
once instead of per script.

`tools/cost.mjs` and `tools/visibility.mjs` default to their **own** ports (5331
and 5321), so they boot a second and third server unless you pass `--port=5273`
explicitly — and `tools/goal.mjs` shells out to both without forwarding a port
at all.

The dev-only subsystem preview probes under `src/**` (`shoot.mjs`, `preview.mjs`,
`probe.mjs`, `feeltest.mjs`) deliberately keep their own fixed ports instead —
that is what lets several of them run side by side without colliding.

`OW_USE_BUILD=1` (with `harness.mjs`'s `ensureServer`, i.e.
`goal.mjs`/`cost.mjs`/`visibility.mjs` and anything built on it) serves the
production bundle via `vite preview` instead of raw dev mode, after `npm run
build`: fewer, bundled module requests instead of one per source file. Meaningful
on the first boot of a run, not on per-frame cost. The dev-only preview pages
under `src/**` are not part of the production build and still need real Vite dev
mode.

## Chromium resolution

Every browser-launching harness resolves Chromium through
`tools/lib/chromium.mjs`'s `resolveChromium()`/`launchOpts()`, falling back to
whatever `chromium-*` build is already under `PLAYWRIGHT_BROWSERS_PATH` when
Playwright's own pinned revision isn't installed. That is what lets these
harnesses run in a sandbox that preseeds one Chromium build while
`package-lock.json` pins another, without `scripts/setup.sh` first downloading a
fresh few-hundred-megabyte build.

## Cost of the goal gate here

One tier × one shot at `goal:quick` dimensions measures at **37 s** against an
already-running server. `npm run goal` sweeps five tiers over three shots plus
targets, twice over — tens of minutes. Narrow with `--tiers=` / `--shots=`, and
prefer `--score-only` to re-score the last measurement for free.
