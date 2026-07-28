# Repository Guidelines

## Project Structure & Module Organization

The browser client lives in `src/`. Features are divided into subsystem directories such as `render/`, `physics/`, `player/`, `weapons/`, `world/`, `ai/`, `fx/`, `audio/`, `net/`, and `match/`; shared engine code is in `src/core/`. Keep subsystem boundaries intact: obtain another system through `ctx.get('render')` rather than importing its module directly. The Node WebSocket relay is in `server/`, while the Cloudflare Worker and Durable Object implementation are in `worker/`. Developer automation and visual test harnesses live in `tools/` and `scripts/`. Read `ARCHITECTURE.md` before changing subsystem behavior or cross-system events.

## Build, Test, and Development Commands

- `./scripts/setup.sh` bootstraps a fresh machine or cloud sandbox: dependencies, the Chromium build playwright expects, and a headless WebGL2 check.
- `npm install` installs the pinned dependencies.
- `npm run dev` starts the Vite client at `http://127.0.0.1:5273`. `strictPort` is on, so set `OW_PORT` if that port is taken; the capture harnesses read the same variable.
- `npm run dev:mp` starts both the client and local multiplayer relay.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the built client for local verification.
- `npm run serve` builds, then serves the client and Node relay.
- `node src/physics/selftest.js` and `node src/ai/selftest.mjs` run subsystem checks.
- `node src/weapons/throwables.selftest.mjs` checks the equipment inventory contract (a pulled pin is never refunded), the cook-off, and which event each throwable detonates with.
- `node src/audio/attenuation.selftest.mjs` checks which sounds are head-locked and
  which are spatialised — the near field is flat at 1.0 and the dry path has no
  distance law, so the routing decision is what keeps either from running away.
- `node src/ai/footstep.selftest.mjs` checks the stride clock behind `actor:footstep`
  — rate, foot alternation, contact phase and the animation-rate LOD.
- `node src/audio/probe.mjs --port=5213` is the audio equivalent of the capture
  harness: offline render of every voice plus a live-graph event storm.
- `npm run test:input` checks input aggregation and the persisted control binds.
- `node src/core/graphics.selftest.mjs` checks the advanced graphics option schema, including that an empty override set is a bit-exact no-op on every preset.
- `node src/core/selftest.mjs` covers adaptive quality and the option persistence/live-apply contract.
- `npm run playtest:ads` drives the pause menu and ADS binds in a real browser.
- `npm run playtest:graphics` drives the advanced graphics menu in a real browser, including a reload that carries the overrides back into `config.q`.
- `npm run playtest:grenade` drives the G / H equipment binds in a real browser: cook, arc preview, throw, detonation, the HUD pips and the stun's screen flash.
- `node server/map.selftest.mjs` walks the relay's room-map protocol against a real server on a real socket.
- `node server/skin.selftest.mjs` does the same for the player-colour slots the relay hands out — no two players in a room may share one.
- `node src/world/maps.selftest.mjs` builds every map headlessly and checks the map-descriptor contract, spawn tables and layout invariants.
- `node src/world/spawns.selftest.mjs` checks the spawn director's scoring headlessly; `node src/world/spawns.probe.mjs` verifies spawn placement, the bot garrison and 30 respawns inside the real built level (needs a browser).
- `node tools/capture.mjs` performs the required GPU-backed visual smoke test.
- `npm run goal` scores the open goal in `goals/`; `npm run goal:quick` is the faster
  iteration pass. Both run headless on SwiftShader and need no GPU.

## Coding Style & Naming Conventions

Use modern ES modules, two-space indentation, semicolons, and single-quoted strings, matching surrounding code. Use `camelCase` for functions and variables, `PascalCase` for classes, and lowercase subsystem IDs and file names. No formatter or linter is configured, so keep edits consistent and focused. Do not add runtime dependencies; meshes, textures, and animation are generated in code. Use seeded `ctx.rng`, never `Math.random()`. Avoid per-frame allocations, respect quality budgets, and dispose GPU/audio resources.

Menu surfaces — the lobby (`src/match/ui.js`), the pause/settings menu (`src/ui/menu.js` + the menu block of `src/ui/style.js`) and the multiplayer overlay (`src/net/ui.js`) — follow `DESIGN.md` and take every colour, font, radius and duration from the CSS custom properties in `src/ui/brand.js`. Do not introduce a literal hex there. The in-world HUD is deliberately exempt: it is drawn over a live scene and keeps its own outlined, viewport-scaled treatment. Note that these stylesheets are template literals, so a backtick in a CSS comment is a syntax error.

## Testing Guidelines

Tests are executable subsystem harnesses rather than a centralized test suite; name new focused checks `selftest.js` or `selftest.mjs` beside the code they verify. There is no formal coverage threshold. Before submitting, run relevant self-tests, `npm run build`, and a capture or playtest for rendering/gameplay changes. Preserve deterministic output so `tools/baseline.mjs` and `tools/imagediff.mjs` remain meaningful. Quality-tier or performance work is gated by `node tools/goal.mjs`; `node tools/lib/selftest.mjs` covers the measurement primitives behind it. Frame rate is never measurable on a GPU-less machine — report `costIndex` ratios there, and real fps only from `tools/profile.mjs` on real hardware.

## Commit & Pull Request Guidelines

Recent history favors concise, imperative Conventional Commit subjects such as `feat: web multiplayer` and `docs: add ...`; follow that pattern when practical. Keep commits scoped to one concern. Pull requests should explain the behavior change, list verification commands, link related issues, and include before/after screenshots for visual changes. Call out performance, determinism, protocol, or deployment impacts explicitly.
