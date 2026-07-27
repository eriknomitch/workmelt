# Repository Guidelines

## Project Structure & Module Organization

The browser client lives in `src/`. Features are divided into subsystem directories such as `render/`, `physics/`, `player/`, `weapons/`, `world/`, `ai/`, `fx/`, `audio/`, `net/`, and `match/`; shared engine code is in `src/core/`. Keep subsystem boundaries intact: obtain another system through `ctx.get('render')` rather than importing its module directly. The Node WebSocket relay is in `server/`, while the Cloudflare Worker and Durable Object implementation are in `worker/`. Developer automation and visual test harnesses live in `tools/` and `scripts/`. Read `ARCHITECTURE.md` before changing subsystem behavior or cross-system events.

## Build, Test, and Development Commands

- `./scripts/setup.sh` bootstraps a fresh machine or cloud sandbox: dependencies, the Chromium build playwright expects, and a headless WebGL2 check.
- `npm install` installs the pinned dependencies.
- `npm run dev` starts the Vite client at `http://127.0.0.1:5173`.
- `npm run dev:mp` starts both the client and local multiplayer relay.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the built client for local verification.
- `npm run serve` builds, then serves the client and Node relay.
- `node src/physics/selftest.js` and `node src/ai/selftest.mjs` run subsystem checks.
- `node tools/capture.mjs` performs the required GPU-backed visual smoke test.
- `npm run goal` scores the open goal in `goals/`; `npm run goal:quick` is the faster
  iteration pass. Both run headless on SwiftShader and need no GPU.

## Coding Style & Naming Conventions

Use modern ES modules, two-space indentation, semicolons, and single-quoted strings, matching surrounding code. Use `camelCase` for functions and variables, `PascalCase` for classes, and lowercase subsystem IDs and file names. No formatter or linter is configured, so keep edits consistent and focused. Do not add runtime dependencies; meshes, textures, and animation are generated in code. Use seeded `ctx.rng`, never `Math.random()`. Avoid per-frame allocations, respect quality budgets, and dispose GPU/audio resources.

## Testing Guidelines

Tests are executable subsystem harnesses rather than a centralized test suite; name new focused checks `selftest.js` or `selftest.mjs` beside the code they verify. There is no formal coverage threshold. Before submitting, run relevant self-tests, `npm run build`, and a capture or playtest for rendering/gameplay changes. Preserve deterministic output so `tools/baseline.mjs` and `tools/imagediff.mjs` remain meaningful. Quality-tier or performance work is gated by `node tools/goal.mjs`; `node tools/lib/selftest.mjs` covers the measurement primitives behind it. Frame rate is never measurable on a GPU-less machine — report `costIndex` ratios there, and real fps only from `tools/profile.mjs` on real hardware.

## Commit & Pull Request Guidelines

Recent history favors concise, imperative Conventional Commit subjects such as `feat: web multiplayer` and `docs: add ...`; follow that pattern when practical. Keep commits scoped to one concern. Pull requests should explain the behavior change, list verification commands, link related issues, and include before/after screenshots for visual changes. Call out performance, determinism, protocol, or deployment impacts explicitly.
