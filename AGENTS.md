# Repository Guidelines

## Project Structure & Module Organization

The browser client lives in `src/`. Features are divided into subsystem directories such as `render/`, `physics/`, `player/`, `weapons/`, `world/`, `ai/`, `fx/`, `audio/`, `net/`, and `match/`; shared engine code is in `src/core/`. Keep subsystem boundaries intact: obtain another system through `ctx.get('render')` rather than importing its module directly. The Node WebSocket relay is in `server/`, while the Cloudflare Worker and Durable Object implementation are in `worker/`. Developer automation and visual test harnesses live in `tools/` and `scripts/`. Read `ARCHITECTURE.md` before changing subsystem behavior or cross-system events.

## Build, Test, and Development Commands

Where a check has both an npm alias and a path, the two are the same command and
either works: `test:quality` = `src/core/selftest.mjs`, `test:graphics` =
`src/core/graphics.selftest.mjs`, `test:input` = `src/core/input.selftest.mjs`,
`test:viewport` = `src/core/viewport.selftest.mjs` + `src/render/resolution.selftest.mjs`,
`test:metrics` = `tools/lib/selftest.mjs`, `test:audio` = `src/audio/probe.mjs`,
`shot` = `tools/capture.mjs`, `playtest:lobby` = `tools/lobby-playtest.mjs`,
`playtest:lobby-ui` = `tools/lobby-ui-playtest.mjs`.

- `./scripts/setup.sh` bootstraps a fresh machine or cloud sandbox: dependencies, the Chromium build playwright expects, and a headless WebGL2 check.
- `npm install` installs the pinned dependencies.
- `npm run dev` starts the Vite client at `http://127.0.0.1:5273`. `strictPort` is on, so set `OW_PORT` if that port is taken; every harness reads the same variable and attaches to whatever is already listening. Start it once and share it across a batch — see the `visual-check` skill for the port and `OW_USE_BUILD` details.
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
- `node src/weapons/melee.selftest.mjs` checks the melee contract: reach, the
  forgiving ray fan and its cover veto, the 45/100 front/backstab split with the
  cone boundary pinned at `facing · toAttacker = -0.45`, the 656 ms recovery
  window, and that the swing clip's strike beat sits on the thrust apex.
- `node src/audio/attenuation.selftest.mjs` checks which sounds are head-locked and
  which are spatialised — the near field is flat at 1.0 and the dry path has no
  distance law, so the routing decision is what keeps either from running away.
- `node src/audio/reload.selftest.mjs` checks the reload foley: the weapon /
  variant / phase fallback chain, that `weapon:reload` carries `weapon` and
  `empty` all the way to the lookup, that every gun in `defs.js` resolves a
  sample for all four phases in both variants and that no authored file is
  unreachable. Every rung of that chain fails *silently* — a miss is the cue to
  synthesize, not an error — so a typo or a gun added without foley just sounds
  slightly cheaper and nothing else. Mutation-checked.
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
- `npm run test:input` checks input aggregation and the persisted control binds,
  including the touch channel: virtual-stick merge and clamping, touch-look
  folding and invert, synthetic button press/release (and that a held touch
  button still releases after input is disabled), and the ADS toggle latch.
- `node src/ui/touch.selftest.mjs` checks the touch control scheme's pure half:
  the virtual-stick vector maths (deadzone continuity, unit clamp, +y forward,
  the sprint gate) and that every on-screen button maps to a code the game
  actually binds — a button bound to nothing would render, press, and do
  nothing. Touch mode is decided by `detectTouchMode()` (`src/core/input.js`);
  `?touch=1` / `?touch=0` force it for testing on the wrong hardware.
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
- `npm run playtest:{ads,graphics,grenade,lobby}` drive real browsers against real
  binds and menus. They judge DOM and engine state, not pixels, so they run
  anywhere. See the `visual-check` skill for what each one covers.
- `npm run playtest:lobby-ui` checks the lobby surface alone — map cards,
  garrison chips, keyboard shortcuts — over
  `?renderGame=false`, so no engine boots and it runs in seconds even without
  a GPU. It cannot see the join flow; that stays `playtest:lobby`'s job.
- `node src/match/bounds.selftest.mjs` checks the client half of the bounded-match
  contract: the default kill target and time cap (and that the relay and Durable
  Object default to the same numbers), the bots-match tally that can be won and
  lost, and the time-expiry outcomes including the draw.
- `node server/map.selftest.mjs` walks the relay's room-map protocol against a real server on a real socket.
- `node server/bounds.selftest.mjs` does the same for the bounded match: the
  fresh scoreline at the start signal, `match_end` on the winning kill, the
  time cap crowning the leader, and the room un-living at the horn so the
  rematch flow opens.
- `node server/lobby.selftest.mjs` does the same for the match-start lobby: that a
  warm-up against bots stays private and does not lock the room, that a warm-up
  player is pulled into the countdown instead of having to leave first, the forced
  start, and that a late arrival joins the countdown rather than the match. Set
  `RELAY_URL=ws://127.0.0.1:8788/ws` to run the same checks against the Cloudflare
  Durable Object under `npm run cf:dev`.
- `node src/weapons/loadout.selftest.mjs` checks that a spawn restocks the whole
  loadout — every magazine and reserve — so ammunition does not deplete across
  lives and matches. There are no ammo pickups; this is the only refill.
- `node src/weapons/autoreload.selftest.mjs` checks the auto-reload contract
  (`config.autoReload`, default ON): a dry pull reloads immediately, running
  dry waits out the shot cycle, and a weapon switch, a draw clip, a cooking
  grenade, an exhausted reserve or the setting turned off each defer or refuse
  gracefully instead of cutting an animation or spamming the reload.
- `node server/skin.selftest.mjs` does the same for the player-colour slots the relay hands out — no two players in a room may share one.
- `node src/match/streaks.selftest.mjs` checks the killstreak ladder (`streak:*`
  events in ARCHITECTURE.md): what counts as a kill, that a banked reward
  survives the death that ends the streak, the recon-sweep window, and that a
  mortar volley is announced round by round, lands inside its scatter disc and
  is deterministic for a given seed.
- `node src/world/maps.selftest.mjs` builds every map headlessly and checks the map-descriptor contract, spawn tables and layout invariants.
- `node src/world/collision.selftest.mjs` checks every map, parked ones included,
  for invisible walls: collision proxies with nothing drawn inside them that a
  .338 still cannot pass. Collision is authored separately from the mesh, so
  this failure is invisible in a capture — the frame is correct, and the thing
  that is wrong is the thing that is not drawn. Mutation-checked by re-running
  the market with its barricade geometry withheld.
- `node src/world/spawns.selftest.mjs` checks the spawn director's scoring headlessly; `node src/world/spawns.probe.mjs` verifies spawn placement, the bot garrison and 30 respawns inside the real built level (needs a browser).
- `node tools/capture.mjs` (`npm run shot`) is the visual smoke test — but read
  the `visual-check` skill before running it, especially without a GPU.
- `node tools/glb-plan.mjs <file.glb> --scale=0.01 --depth=3` turns a downloaded
  3D model into measurements: extent, named parts, and a top-down ASCII height
  field with slices, plus `--yaw=<deg>` to square up a layout that sits at an
  angle to its own axes. Reference material for authoring a map by hand —
  nothing it reads is ever loaded at runtime, and `assets-src/*` is gitignored.
- `npm run goal` scores the open goals in `goals/`; `npm run goal:quick` is the
  faster iteration pass. Both are expensive — the `visual-check` skill has the
  scoping flags.

## Coding Style & Naming Conventions

Use modern ES modules, two-space indentation, semicolons, and single-quoted strings, matching surrounding code. Use `camelCase` for functions and variables, `PascalCase` for classes, and lowercase subsystem IDs and file names. No formatter or linter is configured, so keep edits consistent and focused. Do not add runtime dependencies; meshes, textures, and animation are generated in code. Use seeded `ctx.rng`, never `Math.random()`. Avoid per-frame allocations, respect quality budgets, and dispose GPU/audio resources.

Menu surfaces — the lobby (`src/match/ui.js`), the pause/settings menu (`src/ui/menu.js` + the menu block of `src/ui/style.js`) and the multiplayer overlay (`src/net/ui.js`) — follow `DESIGN.md` and take every colour, font, radius and duration from the CSS custom properties in `src/ui/brand.js`. Do not introduce a literal hex there. The in-world HUD is deliberately exempt: it is drawn over a live scene and keeps its own outlined, viewport-scaled treatment. Note that these stylesheets are template literals, so a backtick in a CSS comment is a syntax error.

## Testing Guidelines

Tests are executable subsystem harnesses rather than a centralized test suite; name new focused checks `selftest.js` or `selftest.mjs` beside the code they verify. There is no formal coverage threshold. Before submitting, run relevant self-tests, `npm run build`, and a capture or playtest for rendering/gameplay changes. Preserve deterministic output so `tools/baseline.mjs` and `tools/imagediff.mjs` remain meaningful. See "Verifying a change" below for which of those a given change actually needs.

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

## Verifying a change

**Default to not rendering.** The Node-only self-tests carry most of the real
coverage and are effectively free — all twenty-three of them (`physics`, `ai`,
`ai/lod`, `ai/footstep`, `weapons/balance`, `weapons/throwables`,
`weapons/loadout`, `weapons/autoreload`, `weapons/melee`, `audio/attenuation`,
`audio/reload`,
`core` × 4, `render/resolution`, `render/dof`, `ui/touch`, `match/bounds`,
`match/streaks`, `world/maps`, `world/collision`, `world/spawns`) run in ~10 s
combined, and `world/maps.selftest.mjs` builds every map headlessly without a
browser at all. Run those plus `npm run build` and stop there unless the change
is genuinely a function of the image.

That list drifts as suites are added, so enumerate rather than trust it:

```
find src server \( -name 'selftest.*' -o -name '*.selftest.*' \) | sort
```

Note both halves of that pattern — four suites are a bare `selftest.js`/`.mjs`
(`physics`, `ai`, `core`, `audio`) and `-name '*.selftest.*'` alone silently
misses them. It returns 28 files; the twenty-three above are the free ones. The
other five are not: `server/{bounds,lobby,map,skin}.selftest.mjs` each stand up
a real relay on a real socket, and `src/audio/selftest.js` is a library the audio
probe drives from a page — run directly it exits 0 having asserted nothing.

**When the change *is* a function of the image** — shading, post-processing,
materials, lighting, layout, a HUD or menu surface — or when it needs the
goal/cost gate, real fps, or a browser playtest, use the **`visual-check`**
skill (`.claude/skills/visual-check/`). It carries the capture recipes, the
GPU-less-sandbox costs and levers, the goal-gate scoping, and the rule that a
`.png` nobody read is not a visual check. Do not capture from memory: a skipped
render reported as a pass is much worse than a skipped render.

**Write every ad-hoc screenshot to `.shots/`, then look at it.** Any one-off
image — a `tools/capture.mjs --out=`, a chrome-devtools or playwright screenshot,
a crop, a before/after pair — goes in `.shots/`, which is gitignored. Do not
scatter PNGs across `/tmp`, the session scratchpad, or the repo root: an image
outside `.shots/` is one nobody will find again, and one in the working tree is
one that ends up in a commit.

Capturing is only half of it. **Read the file back with the Read tool so the
image is actually displayed**, and say what you saw in the frame. A `.png`
nobody read is not a visual check — a skipped render reported as a pass is much
worse than a skipped render. Cite the path (`.shots/hero-before.png`) so the
reader can open the same file.

Name for a stranger, not for yourself: `.shots/<subject>-<variant>.png`, e.g.
`.shots/lobby-cards-after.png`. `.shots/` is scratch — overwrite it freely and
never treat it as an archive.

The one exception is the baseline pipeline. `tools/capture.mjs` defaults to
`shots/`, and `tools/baseline.mjs` and `tools/imagediff.mjs` compare against
those paths, so leave committed baselines where they are; `.shots/` is for the
throwaway captures you take while iterating.

**Write throwaway probe scripts to `scratch/`, never `/tmp`.** A one-off script
that imports anything from `node_modules` — `playwright` above all — must live
inside the repo tree. Node resolves a bare ESM specifier by walking up from the
*importing file's own directory*, not from `cwd`, so a script under `/tmp` (or
under an agent's session scratchpad, which is where the tooling nudges you) walks
`/tmp` → `/` and never reaches `node_modules`. It dies with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'
```

which reads exactly like a missing install and is not one. Re-running it from the
repo root does not help — `cd` moves `cwd`, not the resolution base — and
`NODE_PATH` is honoured by the CommonJS resolver only, so it does nothing here.
`scratch/` is gitignored and one level below the root, so it just works. Promote
anything worth keeping to `tools/` with an npm alias.
