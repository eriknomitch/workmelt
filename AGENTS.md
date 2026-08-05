# Repository Guidelines

## Project Structure & Module Organization

The browser client lives in `src/`. Features are divided into subsystem directories such as `render/`, `physics/`, `player/`, `weapons/`, `world/`, `ai/`, `fx/`, `audio/`, `net/`, and `match/`; shared engine code is in `src/core/`. Keep subsystem boundaries intact: obtain another system through `ctx.get('render')` rather than importing its module directly. The Node WebSocket relay is in `server/`, while the Cloudflare Worker and Durable Object implementation are in `worker/`. Developer automation and visual test harnesses live in `tools/` and `scripts/`. Read `ARCHITECTURE.md` before changing subsystem behavior or cross-system events.

## Build, Test, and Development Commands

Where a check has both an npm alias and a path, the two are the same command and
either works: `test:quality` = `src/core/selftest.mjs`, `test:graphics` =
`src/core/graphics.selftest.mjs`, `test:input` = `src/core/input.selftest.mjs`,
`test:viewport` = `src/core/viewport.selftest.mjs` + `src/render/resolution.selftest.mjs`,
`test:metrics` = `tools/lib/selftest.mjs`, `test:audio` = `src/audio/probe.mjs`,
`shot` = `tools/capture.mjs`, `playtest:lobby` = `tools/lobby-playtest.mjs`.

- `./scripts/setup.sh` bootstraps a fresh machine or cloud sandbox: dependencies, the Chromium build playwright expects, and a headless WebGL2 check.
- `npm install` installs the pinned dependencies.
- `npm run dev` starts the Vite client at `http://127.0.0.1:5273`. `strictPort` is on, so set `OW_PORT` if that port is taken; the capture harnesses read the same variable. Start it once and leave it running before a batch of `playtest:*`/`shot`/`goal`/`visibility`/`cost` runs — they all attach to whatever is already listening on `OW_PORT` instead of booting their own Vite, so a whole suite pays the ~20-40s dev-server-plus-shader-warmup cost once instead of per script. The dev-only subsystem preview probes under `src/**/*.mjs` (`shoot.mjs`, `preview.mjs`, `probe.mjs`, `feeltest.mjs`) deliberately keep their own fixed ports instead — that is what lets several of those run side by side without colliding.
- Every browser-launching harness resolves Chromium through `tools/lib/chromium.mjs`'s `resolveChromium()`/`launchOpts()`, falling back to whatever `chromium-*` build is already under `PLAYWRIGHT_BROWSERS_PATH` when Playwright's own pinned revision isn't installed. That is what lets these harnesses run in a cloud sandbox that preseeds one Chromium build while `package-lock.json` pins another, without `scripts/setup.sh` first downloading a fresh few-hundred-megabyte build.
- `OW_USE_BUILD=1` (with `tools/lib/harness.mjs`'s `ensureServer`, i.e. `goal.mjs`/`cost.mjs`/`visibility.mjs` and any tool built on it) serves the production bundle via `vite preview` instead of raw dev mode, after `npm run build`. Fewer, bundled module requests instead of one per source file — meaningful on the first boot of a run, not on per-frame cost. Opt-in and scoped to the main-entry harnesses; the dev-only preview pages under `src/**` are not part of the production build and still need real Vite dev mode.
- `npm run dev:mp` starts both the client and local multiplayer relay.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the built client for local verification.
- `npm run serve` builds, then serves the client and Node relay. `npm run server`
  (alias `start`) runs the relay alone against an existing `dist/`.
- `npm run cf:dev` runs the Worker + Durable Object locally under wrangler;
  `npm run cf:deploy` builds and deploys it. See `CLOUDFLARE.md`.
- `npm run sfx:fetch` downloads the sound sources, `npm run sfx` encodes them.
  Neither is part of a normal change — the runtime synthesises its own audio.
- `node src/physics/selftest.js` and `node src/ai/selftest.mjs` run subsystem checks.
- `node src/weapons/throwables.selftest.mjs` checks the equipment inventory contract (a pulled pin is never refunded), the cook-off, and which event each throwable detonates with.
- `node src/weapons/balance.selftest.mjs` checks the weapon balance contract: the
  shots-to-kill matrix, the two-point damage falloff, that no weapon is strictly
  dominated by another, the AX-7's quickscope invariants (including a simulation
  of the spread integrator, which is what makes the technique possible), and that
  recoil patterns stay deterministic.
- `node src/audio/attenuation.selftest.mjs` checks which sounds are head-locked and
  which are spatialised — the near field is flat at 1.0 and the dry path has no
  distance law, so the routing decision is what keeps either from running away.
- `node src/ai/footstep.selftest.mjs` checks the stride clock behind `actor:footstep`
  — rate, foot alternation, contact phase and the animation-rate LOD.
- `node src/ai/lod.selftest.mjs` checks the view-distance LOD: the animation-rate
  tiers and the actor sun-shadow cutoff, that both bands are hysteretic under a
  crossing actor, that a tier's evaluations are phase-spread across frames rather
  than landing on one, and that a re-tiering actor's pose can never starve. Every
  guard in it is mutation-checked — none of these failures is visible in a still
  frame, so a check that cannot fail would be worse than none.
- `node src/audio/probe.mjs --port=5213` is the audio equivalent of the capture
  harness: offline render of every voice plus a live-graph event storm.
- `npm run test:input` checks input aggregation and the persisted control binds.
- `npm run test:viewport` checks how the engine reacts to the window changing
  size: that a window drag costs one render-target reallocation rather than one
  per event, that a devicePixelRatio move at a fixed CSS size still reaches the
  renderer, and the resolution budget's clamp arithmetic — area respected,
  aspect ratio exact, `MAX_TEXTURE_SIZE` never breached.
- `node src/render/dof.selftest.mjs` checks the ADS depth-of-field focus contract:
  that the pixel under the reticle is sharp at every engagement range, that the
  near band never reaches the mid-ground, that the far band always lands behind
  the aim point, and that the peripheral softening stays outside the sight-picture
  disc. A still frame cannot tell you whether the thing you are aiming at is the
  sharpest pixel on screen, which is exactly how the focal plane came to be pinned
  at 18 m — so the invariant is asserted arithmetically instead.
- `node src/core/graphics.selftest.mjs` checks the advanced graphics option schema, including that an empty override set is a bit-exact no-op on every preset.
- `node src/core/selftest.mjs` covers adaptive quality and the option persistence/live-apply contract.
- `npm run playtest:ads` drives the pause menu and ADS binds in a real browser.
- `npm run playtest:graphics` drives the advanced graphics menu in a real browser, including a reload that carries the overrides back into `config.q`.
- `npm run playtest:grenade` drives the G / H equipment binds in a real browser: cook, arc preview, throw, detonation, the HUD pips and the stun's screen flash.
- `node server/map.selftest.mjs` walks the relay's room-map protocol against a real server on a real socket.
- `node server/lobby.selftest.mjs` does the same for the match-start lobby: that a
  warm-up against bots stays private and does not lock the room, that a warm-up
  player is pulled into the countdown instead of having to leave first, the forced
  start, and that a late arrival joins the countdown rather than the match. Set
  `RELAY_URL=ws://127.0.0.1:8788/ws` to run the same checks against the Cloudflare
  Durable Object under `npm run cf:dev`.
- `node src/weapons/loadout.selftest.mjs` checks that a spawn restocks the whole
  loadout — every magazine and reserve — so ammunition does not deplete across
  lives and matches. There are no ammo pickups; this is the only refill.
- `node tools/lobby-playtest.mjs` drives the whole join flow in two real browsers
  against a real relay: A warms up against bots, B follows the invite link, B
  readies up, and both land in one players-only match with fresh magazines.
- `node server/skin.selftest.mjs` does the same for the player-colour slots the relay hands out — no two players in a room may share one.
- `node src/world/maps.selftest.mjs` builds every map headlessly and checks the map-descriptor contract, spawn tables and layout invariants.
- `node src/world/collision.selftest.mjs` checks every map, parked ones included,
  for invisible walls: collision proxies with nothing drawn inside them that a
  .338 still cannot pass. Collision is authored separately from the mesh, so
  this failure is invisible in a capture — the frame is correct, and the thing
  that is wrong is the thing that is not drawn. Mutation-checked by re-running
  the market with its barricade geometry withheld.
- `node src/world/spawns.selftest.mjs` checks the spawn director's scoring headlessly; `node src/world/spawns.probe.mjs` verifies spawn placement, the bot garrison and 30 respawns inside the real built level (needs a browser).
- `node tools/capture.mjs` performs the required GPU-backed visual smoke test.
  It frames the boot map from its spawn 0; `--query="map=<id>"` shoots another.
- `node tools/glb-plan.mjs <file.glb> --scale=0.01 --depth=3` turns a downloaded
  3D model into measurements: extent, named parts, and a top-down ASCII height
  field with slices, plus `--yaw=<deg>` to square up a layout that sits at an
  angle to its own axes. Reference material for authoring a map by hand —
  nothing it reads is ever loaded at runtime, and `assets-src/*` is gitignored.
- `npm run goal` scores the open goal in `goals/`; `npm run goal:quick` is the faster
  iteration pass. Both run headless on SwiftShader and need no GPU.

## Coding Style & Naming Conventions

Use modern ES modules, two-space indentation, semicolons, and single-quoted strings, matching surrounding code. Use `camelCase` for functions and variables, `PascalCase` for classes, and lowercase subsystem IDs and file names. No formatter or linter is configured, so keep edits consistent and focused. Do not add runtime dependencies; meshes, textures, and animation are generated in code. Use seeded `ctx.rng`, never `Math.random()`. Avoid per-frame allocations, respect quality budgets, and dispose GPU/audio resources.

Menu surfaces — the lobby (`src/match/ui.js`), the pause/settings menu (`src/ui/menu.js` + the menu block of `src/ui/style.js`) and the multiplayer overlay (`src/net/ui.js`) — follow `DESIGN.md` and take every colour, font, radius and duration from the CSS custom properties in `src/ui/brand.js`. Do not introduce a literal hex there. The in-world HUD is deliberately exempt: it is drawn over a live scene and keeps its own outlined, viewport-scaled treatment. Note that these stylesheets are template literals, so a backtick in a CSS comment is a syntax error.

## Testing Guidelines

Tests are executable subsystem harnesses rather than a centralized test suite; name new focused checks `selftest.js` or `selftest.mjs` beside the code they verify. There is no formal coverage threshold. Before submitting, run relevant self-tests, `npm run build`, and a capture or playtest for rendering/gameplay changes. Preserve deterministic output so `tools/baseline.mjs` and `tools/imagediff.mjs` remain meaningful. Quality-tier or performance work is gated by `node tools/goal.mjs`; `node tools/lib/selftest.mjs` covers the measurement primitives behind it. Frame rate is never measurable on a GPU-less machine — report `costIndex` ratios there, and real fps only from `tools/profile.mjs` on real hardware.

## Commit & Pull Request Guidelines

Recent history favors concise, imperative Conventional Commit subjects such as `feat: web multiplayer` and `docs: add ...`; follow that pattern when practical. Keep commits scoped to one concern. Pull requests should explain the behavior change, list verification commands, link related issues, and include before/after screenshots for visual changes. Call out performance, determinism, protocol, or deployment impacts explicitly.

## Deep-Dive Docs

Read on demand, not loaded at session start:

- `DESIGN.md` — the WORKMELT brand and design system: palette, type pairing, the
  65/20/10/4/1 ratio rule, contrast floors and motion timing. Read it before
  touching the lobby, the pause/settings menu or the multiplayer overlay. The
  tokens themselves live in `src/ui/brand.js`; never hard-code a hex outside it.
- `ARCHITECTURE.md` — the engine contract. Read it in full before changing subsystem behavior, `ctx` wiring, or cross-system events.
- `MULTIPLAYER.md` — room-based FFA model, `server/` relay, and the net protocol.
- `CLOUDFLARE.md` — Worker + Durable Object deploy path for `worker/`.
- `TEXTURE-PERF.md` — where texture memory, per-pixel fetches and character draw
  calls actually go, and why a shipped texture pack is the wrong tool for it.
- `BLUEPRINT.md` — the tactical-blueprint visual system for maps and gameplay
  assets: the scope and plan behind how levels are authored. Read it before
  building or reworking a map.
- `goals/*.md` — the open goals `npm run goal` scores, with their criteria.
  Read the relevant one before doing quality-tier or performance work.
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

**Default to not rendering.** The Node-only self-tests listed above
carry most of the real coverage and are effectively free here — all seventeen of
them (`physics`, `ai`, `ai/lod`, `ai/footstep`, `weapons/balance`,
`weapons/throwables`, `weapons/loadout`, `audio/attenuation`, `core` × 4,
`render/resolution`, `render/dof`, `world/maps`, `world/collision`,
`world/spawns`) run in **~10 s combined**, and `world/maps.selftest.mjs` builds
every map headlessly without a browser at all. That list drifts as suites are
added, so enumerate rather than trust it:

```
find src server \( -name 'selftest.*' -o -name '*.selftest.*' \) | sort
```

Note both halves of that pattern — four suites are a bare `selftest.js`/`.mjs`
(`physics`, `ai`, `core`, `audio`) and `-name '*.selftest.*'` alone silently
misses them. It returns 21 files; the seventeen above are the free ones. The
other four are not: `server/{lobby,map,skin}.selftest.mjs` each stand up a real
relay on a real socket, and `src/audio/selftest.js` is a library the audio probe
drives from a page — run directly it exits 0 having asserted nothing.

Run the seventeen plus `npm run build` and stop there unless the change is
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

## Always look at the images you generate

Anything that writes a `.png` — `tools/capture.mjs`, `tools/imagediff.mjs`, a
`page.screenshot` in a playtest, a one-off script — produces a file nobody has
seen. The command exiting 0 is not the check; the picture is. So whenever a
command writes an image to `/tmp` or the scratchpad, **immediately `Read` that
exact path**. A `Read` on an image renders it inline in the transcript, which is
the only way the render actually gets looked at rather than assumed. Paying 40 s
of SwiftShader for a frame and then never reading it is worse than skipping the
capture, because it reads as a visual check that never happened.

Pass an explicit `--out=` under the scratchpad directory rather than letting a
tool pick its own path, so you know what to read back:

```
cd /home/user/workmelt; time OW_PORT=5273 node tools/capture.mjs --shot=hero \
  --w=640 --h=360 --settle=8 --timeout=600000 --query="prewarm=0&q=performance" \
  --out=$SCRATCHPAD/default.png 2>&1 | tail -4
```

then `Read` with `file_path` = `$SCRATCHPAD/default.png` (the real absolute
scratchpad path for the session — the tools take no shell expansion of a
variable you did not export).

**Then send it to the user with `SendUserFile`** when the image is the point of
the work — a before/after, a layout change, a bug you are demonstrating.
`Read` puts the frame in front of *me*; only `SendUserFile` puts it in front of
*them*. Pass `display: "render"` so it opens inline instead of as a download
card, batch related frames into one call, and caption it with what to look at:

```
SendUserFile({
  files: ["$SCRATCHPAD/ads-before.png", "$SCRATCHPAD/ads-final.png"],
  caption: "Before / after at the ADS eye point (960x540).",
  display: "render",
  status: "normal",
})
```

Two frames captured at the same `--w/--h/--settle` are a fair before/after;
frames captured at different settings are not, and must not be presented as one.
