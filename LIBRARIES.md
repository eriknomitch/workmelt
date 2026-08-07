# Libraries — what we can leverage, and what we should not

**Question asked:** what libraries can we adopt to make the game faster, or make
building it easier?

**Short answer.** The largest untapped library in this project is the one already
in `package.json`. `three@0.180.0` ships ~90 addon modules and a whole second
renderer, and `src/` imports exactly two of them. Before considering a new
dependency, there is a batching primitive, an LOD class, a worker pool, an atlas
packer, a radix sorter and a tuning GUI sitting unused in `node_modules/three`,
every one of which lands against a bottleneck already measured in
`TEXTURE-PERF.md`.

The second-largest is the platform: Web Workers, `DataView`, `OffscreenCanvas`
and `DataArrayTexture` are not dependencies at all, and three of the top
measured costs in this engine (3.27 s of blocking boot, 51.7 draw calls per
character, 29 KB/s of JSON per player) are addressed by them without adding a
byte to `package.json`.

Exactly **one** third-party runtime library is worth a rule change, and it is a
single 20 KB-gzip MIT file with no dependencies: `meshopt_simplifier`. Everything
else in the usual list — Rapier, Jolt, `three-mesh-bvh`, `postprocessing`,
`msgpackr`, Colyseus — is either a rewrite of something this repo already does
well, or buys less than the zero-dependency alternative.

Measured on this branch, `main` at `7deacee`, `npm run build` with vite 7.3.6:

```
dist/assets/index-*.js   1,723.30 kB raw  │  528.05 kB gzip  │  157 modules  │  7.49 s
src/                     73,681 LOC
three addons imported    2   (RoundedBoxGeometry, BufferGeometryUtils)
BatchedMesh / LOD / Worker / DataArrayTexture uses    0
CI workflows             0
```

> **Status note.** Those numbers are from `7deacee`. See **§7 — Addendum
> (2026-08-06)** for what has changed since: nothing in §5 has been executed, and
> `three` has moved five releases. Read §7 before acting on §5's ordering.

---

## 0. What the rules actually forbid

`AGENTS.md` and `ARCHITECTURE.md` say: *"No new npm dependencies. `three` only.
No CDN fetches — every asset the game needs ships in the bundle, so it runs fully
offline."* and *"Do not add runtime dependencies."*

Read precisely, that draws three lines, not one:

| | status | precedent |
|---|---|---|
| **Runtime deps** (shipped in `dist/`) | forbidden | only `three` |
| **Dev deps** (build/test/tooling) | **already normal** | `vite`, `playwright`, `wrangler`, `pngjs` |
| **Vendored source** (a file committed into the repo) | undecided | `assets-src/`, the encoded SFX |

The `ws` dependency is runtime for `server/`, not for the client bundle — the
Cloudflare Worker path (`worker/`) uses the platform WebSocket and ships no
dependency at all.

So everything in §3 (dev tooling) is available today under existing precedent.
Only §4 needs a decision from the repo owner, and only for one library.

The budget for that decision is the 528 KB gzip bundle. A 20 KB gzip addition is
+3.8%; a 900 KB WASM physics engine is +170%.

---

## 1. Tier 0 — already paid for: `three@0.180.0`

These cost **nothing**: no `package.json` change, no bundle-size argument, no
rule change. `three` is already a dependency, the export map already exposes
them (`three/addons/*`, `three/webgpu`, `three/tsl`), and vite already
tree-shakes what we do not import.

### 1.1 `BatchedMesh` — the world's 1266 draw calls

`TEXTURE-PERF.md` measured the frame at **1724 draw calls, of which `world`
contributes 1266 (73.4%)**. `src/world/builder.js` uses `InstancedMesh` in two
places; there is no `BatchedMesh` anywhere in `src/`.

`InstancedMesh` requires identical geometry. `BatchedMesh` (core since r156,
`node_modules/three/build/three.core.js`) requires only a shared *material*, and
keeps every instance individually addressable — per-instance transform,
per-instance visibility, per-instance frustum culling, and a
`sortObjects` hook. That is exactly the shape of a modular building kit: a
hundred distinct wall/floor/trim geometries that all draw with the same
`shader.js`-extended `MeshStandardMaterial`.

This is the highest-leverage unused thing in the tree. It is also the one with
the most caveats, so read them before starting:

- Per-instance draw ordering changes, and `ARCHITECTURE.md` treats material
  creation order as load-bearing for coplanar sorting (see the `MATERIAL_SLOTS`
  comment in `src/ai/soldier.js`). This will move pixels. Gate it on
  `tools/baseline.mjs`.
- `render._collect` walks the scene for `owNoPrepass` / `owNoShadow` per object.
  A `BatchedMesh` is one object, so those flags become all-or-nothing for
  everything inside it. Group the batches accordingly.
- `src/physics/bvh.js` flattens `Mesh` and `InstancedMesh` into world-space
  triangles (`bvh.js:836`). It does **not** know `BatchedMesh`. Either register
  static collision before batching, or teach `_flatten` the third case.

`three/addons/utils/SceneOptimizer.js` is an experimental auto-batcher that
converts a scene's meshes into `BatchedMesh` by hashing geometry and material.
Do not ship it as-is, but it is a good way to get a *measurement* of the
available win in an afternoon: run it over the built level in `tools/drawcalls.mjs`
and read the new draw-call count before committing to a hand-rolled batching pass
in `src/world/builder.js`.

### 1.2 `THREE.LOD` + `SimplifyModifier` — the characters' missing LOD

`TEXTURE-PERF.md` §5.4 calls this out and does not solve it: *"The characters
have no geometry LOD. 25,698 triangles each at every distance, drawn into four
cascades… That is a bigger number than anything textures can give back, and it
is the obvious next investigation."*

`THREE.LOD` is in core and unused. `three/addons/modifiers/SimplifyModifier.js`
(16 KB source) can generate the reduced meshes at boot.

Be honest about `SimplifyModifier`'s limits before planning around it: it is a
naive edge-collapse that operates on positions and **drops or mangles other
attributes**. For a skinned soldier carrying `skinIndex`, `skinWeight`, normals,
tangents and UVs across nine material groups, it is the wrong tool. It is fine
for the *props* in `src/world/props.js` — static, single-material, no skinning —
and that is a real win on its own, because props are instanced and every
instance pays the full triangle count into four shadow cascades.

For the characters, see `meshopt_simplifier` in §4.1. That is the one place a
third-party library genuinely beats what is already here.

A cheaper, pixel-safer first move that needs no simplifier at all: **cascade
LOD**. The soldier does not need 25,698 triangles in cascade 3. A hand-authored
low-poly proxy swapped in for the two distant cascades removes most of the
per-character shadow cost, and it is invisible by construction because shadow
cascades at that distance are filtered to mush anyway.

### 1.3 `WorkerPool` — the 3.27 s character bake

`three/addons/utils/WorkerPool.js` is 4 KB of `Worker` lifecycle management.
`grep -rn "new Worker" src/` returns nothing: this engine has never left the main
thread.

`src/ai/textures.js` is the ideal first customer. It is **3.27 s of blocking
main-thread JavaScript at every quality preset** (`TEXTURE-PERF.md` §2), and it
is structurally perfect for a worker:

- pure CPU, no WebGL, no DOM — value noise, fbm, ridged noise, a Sobel pass;
- its only inputs are a seed and a size;
- its only outputs are `Uint8Array` buffers that go straight into `DataTexture`,
  and those are **transferable**, so handing them back costs nothing.

Four workers turn 3.27 s of blocked main thread into ~0.8 s of parallel work that
does not block anything. Two notes:

- Determinism survives. Rule 4 requires `ctx.rng`, and `TileNoise` already takes
  an `rng` in its constructor. Fork one stream per worker deterministically
  (`ctx.rng.fork()` per uniform variant, in a fixed order) and the output is
  bit-identical regardless of completion order — which matters, because
  `tools/baseline.mjs` compares pixels.
- This is complementary to, not a replacement for, `TEXTURE-PERF.md` §5.1
  (porting the bake to GLSL). GLSL is faster and makes the size preset-scalable;
  the worker is a fraction of the effort and can land this week.

The same pattern applies to `src/physics/bvh.js`'s binned-SAH build — this is
what `three-mesh-bvh` does with its `ParallelMeshBVHWorker`, and we can copy the
idea without copying the library (§4.3).

### 1.4 `three/webgpu` + `three/tsl` — the compute path

`node_modules/three/build/` ships `three.webgpu.js`, `three.webgpu.nodes.js` and
`three.tsl.js`, and `package.json` exports them as `three/webgpu` and `three/tsl`.
`WebGPURenderer` has been the production-recommended renderer since r171, with
automatic WebGL2 fallback; WebGPU reached Baseline across Chrome, Firefox, Safari
and Edge in 2026, so the fallback is now the exception rather than the rule.

`TEXTURE-PERF.md` §3 already identified the prize and correctly deferred it:

> *"If the project ever moves to `WebGPURenderer`, this changes: compute shaders
> make runtime BCn/ASTC compression of a procedurally baked texture practical,
> and it becomes the single biggest available win."*

That still stands — 288 MB of library texture memory at `high` would become ~72 MB
at BC7 — and compute would also collapse the character bake (§1.3) to
milliseconds and unlock a proper GPU particle system in `src/fx/`.

It is also a **rewrite of `src/render/`**, which is 5,853 LOC of hand-built HDR
pipeline, CSM, GTAO, SSR, TAA, DOF and composite, plus `src/materials/shader.js`,
which is a heavily extended `MeshStandardMaterial` driven by `onBeforeCompile`
and raw GLSL — the one thing TSL does not port mechanically. Treat this as a
roadmap item with its own design doc, not a task. The realistic first step is
much smaller: **write new shader code in TSL where it is self-contained** (`src/sky/`
is the best candidate — mostly full-screen passes and LUTs), so the eventual
migration has less GLSL left to convert.

### 1.5 The small ones, individually worth an afternoon

| module | size | what it lands on |
|---|---|---|
| `libs/potpack.module.js` | 4 KB | Bin-packs rectangles into an atlas. `TEXTURE-PERF.md` §5.3 wants the soldier's nine material slots atlased; this is the packing half of that, already vendored. |
| `utils/SortUtils.js` | — | Radix sort over typed arrays. `src/fx/` sorts particles/decals by depth every frame; a radix pass over a `Float32Array` of keys beats `Array.prototype.sort` with a comparator, and allocates nothing (rule 5). |
| `libs/lil-gui.module.min.js` | 32 KB | A tuning GUI, **already in the tree**. See §3.5 — this is the biggest single DX item in this document. |
| `libs/stats.module.js` | — | Superseded by `src/ui/perfhud.js`, which is better. Skip. |
| `libs/mikktspace.module.js` | — | Industry-standard tangent generation. Relevant if normal-map seams ever show on the weapon or character meshes; `BufferGeometryUtils.computeMikkTSpaceTangents` is the entry point. |
| `libs/basis/` + `KTX2Loader` | — | Already anticipated: `vite.config.js` lists `**/*.ktx2` in `assetsInclude`. `TEXTURE-PERF.md` §3 explains why a shipped pack is still the wrong call. Leave it. |
| `math/OBB.js`, `math/Capsule.js`, `math/Octree.js` | — | Superseded by `src/physics/`. Listed only so nobody re-derives them. |

### 1.6 `DataArrayTexture` — core, WebGL2, unused

Not an addon — core `three`, and WebGL2 `sampler2DArray` is something this project
can already assume. `TEXTURE-PERF.md` §5.3 names it directly as the way to
collapse a character from 51.7 draw calls to ~6. Zero uses in `src/` today.

---

## 2. Tier 1 — platform APIs, which are not dependencies at all

### 2.1 A binary wire format — measured 6.2× smaller

`src/net/index.js:164,194` and `server/index.mjs:192-226` send JSON over
WebSocket at 20 Hz. Measured on the actual message shape in `_sendState()`
(`src/net/index.js:527`):

```
                    JSON snapshot   down/client   relay egress
 4 players             515 B         10.1 KB/s      40.2 KB/s
 8 players            1003 B         19.6 KB/s     156.7 KB/s
12 players (MAX_ROOM) 1491 B         29.1 KB/s     349.5 KB/s

vs. a fixed 20-byte-per-player binary layout
(id u8, pos 3×f32, yaw/pitch 2×i16, speed u8, flags u8, hp u8):

 4 players              82 B          1.6 KB/s       6.4 KB/s
 8 players             162 B          3.2 KB/s      25.3 KB/s
12 players             242 B          4.7 KB/s      56.7 KB/s
```

**6.2× smaller on the wire, and it removes `JSON.parse` from the receive path.**

The library answer here is *no library*. `msgpackr` is the fastest general
MessagePack implementation and is genuinely faster than native `JSON` — but
MessagePack is schema-free, so it buys 15–50% compaction where a fixed schema
buys 84%. FlatBuffers' zero-copy design is aimed at exactly this case, but it
needs a schema compiler in the build and a code-gen step, for a message that is
ten fields wide and already fully specified in `MULTIPLAYER.md`. `DataView` and
`ArrayBuffer` are in the platform, cost zero bytes, and work identically in
Node (`server/`) and in the Worker (`worker/`).

Scope note: only `state`/`snapshot` are hot. `join`, `ready`, `lobby`, `chat`
and the rest are once-per-event and should stay JSON — keep the transport
polymorphic on `typeof evt.data === 'string'`, which `worker/room.js:53`
already tests for.

### 2.2 WebTransport — real, but not yet for our deploy target

WebTransport reached Baseline across all major browsers in March 2026. Over
QUIC it offers **unreliable datagrams**, which is the correct transport for a
20 Hz positional snapshot: today a single dropped TCP segment head-of-line
blocks every subsequent update, and on a 1–5% loss link that is exactly the
stutter an FPS cannot hide. It is a better fit than WebSocket for the `state` /
`snapshot` channel, and it is a platform API, not a dependency.

**But `CLOUDFLARE.md` is our deploy path, and Workers has no QUIC/HTTP3
implementation.** WebTransport in `workerd` is an open tracking request, and
Cloudflare's own position is that WebTransport's semantics do not fit the Worker
invocation model. Durable Objects ship WebSocket support and nothing else.

So: keep WebSocket. Do §2.1 instead — it is available today, it is a strict
improvement on both transports, and a binary frame is exactly what you would
send over a datagram anyway, so it is the prerequisite for WebTransport rather
than an alternative to it. Revisit if `server/index.mjs` (the Node/Fly path in
`fly.toml`) ever becomes the primary target, where `node:quic` makes it viable.

Do **not** reach for `geckos.io` (WebRTC unreliable data channels) as a
workaround. It solves the transport problem at the cost of a STUN/TURN
dependency, a much heavier client, and a connection model that does not run on
Workers either.

### 2.3 `OffscreenCanvas`, `SharedArrayBuffer`, WASM SIMD

- `OffscreenCanvas` lets a worker own a real WebGL2 context. That would let the
  procedural bake in `src/materials/generator.js` run off-thread on the GPU. It
  is a bigger change than §1.3 and shares GPU resources across contexts poorly;
  file it behind the worker work.
- `SharedArrayBuffer` needs COOP/COEP headers, which `server/index.mjs` and
  `worker/` would both have to set. It buys a zero-copy BVH build across workers.
  Only worth it if §1.3's transferable-buffer approach proves insufficient.
- WASM SIMD is what makes Rapier fast (§4.2). We are not writing WASM, so this
  is only relevant as context for why a WASM physics engine outruns hand-written
  JS at scale — and why that does not matter at our object counts.

---

## 3. Tier 2 — dev dependencies, allowed today

Four `devDependencies` already exist. Nothing below ships in `dist/`.

Ranked by what they buy *this specific project*, which is developed by parallel
agents that each own one directory and cannot see each other's edits.

### 3.1 CI — the largest gap, and it costs nothing

`ls .github/workflows` → nothing. This repo has `tools/capture.mjs`,
`tools/baseline.mjs`, `tools/imagediff.mjs`, `tools/profile.mjs`,
`tools/drawcalls.mjs`, `tools/texcost.mjs`, `src/physics/selftest.js`,
`src/ai/selftest.mjs`, `src/world/spawns.selftest.mjs`, `npm run test:input`,
`npm run playtest:ads` — an unusually good harness suite — and **nothing runs
any of it automatically.**

`ARCHITECTURE.md` rule 7 says *"`npm run build` must pass and `node
tools/capture.mjs` must produce a frame after your change. If you break the
boot, nobody else can work."* That rule is currently enforced by hope.

A workflow that runs `npm run build`, the three self-tests and a capture on every
PR is the single highest-value change in this document per hour spent, and it is
a YAML file, not a library. `scripts/setup.sh` already provisions Chromium for
playwright, so the runner setup is solved.

### 3.2 A contract checker — enforce the rules the docs state

Three of `ARCHITECTURE.md`'s seven hard rules are mechanically checkable:

| rule | check | today |
|---|---|---|
| 2. Never import another subsystem's module | no `../<other-subsystem>/` import | **clean** except `src/weapons/preview.js:16` importing `MaterialSystem` |
| 4. No `Math.random()` | AST scan of `src/` | **clean** — all 9 hits are prose in comments, plus the one legitimate non-deterministic seed at `src/core/engine.js:32` |
| 5. Allocate nothing per-frame | no `new THREE.X()` inside `update`/`fixedUpdate`/`lateUpdate` | needs an AST pass to judge |

The discipline here is genuinely good — this is a regression guard, not a
cleanup. That is precisely when a checker is cheap to add and worth having,
because the cost of the first violation is paid by whichever agent trips over it
three weeks later.

Two ways:

- **`dependency-cruiser`** (dev dep). Purpose-built: declare
  `src/ai` may not depend on `src/(?!core)`, get a violation report and a
  dependency graph. Also finds cycles and orphans. This is the standard answer
  and it is a good one.
- **`tools/contract.mjs`** (zero dep, ~80 lines). Rules 2 and 4 are a regex walk
  over `src/`. Rule 5 needs a parser, and vite already has `es-module-lexer` and
  `rollup`'s acorn in the tree transitively.

Recommendation: write `tools/contract.mjs` for rules 2 and 4 now — it is an hour,
it needs no dependency decision, and it can run in the §3.1 workflow immediately.
Reach for `dependency-cruiser` only if the graph visualisation becomes worth the
dep.

### 3.3 Type checking without a build step

`tsc --noEmit --allowJs --checkJs` over a `jsconfig.json`, with types expressed
in the JSDoc the codebase already writes prolifically. No `.ts` files, no build
step, no change to how anything runs. `three` ships its own `.d.ts`, so
`ctx.get('render').renderer` types itself.

The payoff is specific to this architecture. `ctx.get('fx')` returns `any`, so
every cross-subsystem call is unchecked — a renamed method in `src/fx/` fails at
runtime, in a frame, in a browser, and the agent that renamed it never sees the
break. A hand-written `ctx.d.ts` mapping subsystem ids to their classes turns
the entire registry into a checked interface. That is the exact failure mode
this repo's ownership model creates, and the exact one types fix.

Start with `// @ts-check` on `src/core/` and one subsystem; do not try to make
73k LOC clean at once.

### 3.4 A linter

None configured (`AGENTS.md` says so explicitly). `oxlint` is the fastest option
— 50–100× ESLint, ~300 rules, zero config, one binary — and for a project whose
style rules are "two-space, semicolons, single quotes, camelCase" that is the
right weight. `biome` bundles a formatter too, which is a bigger behavioural
change than this repo wants mid-flight (a repo-wide reformat would wreck `git
blame` across fifteen agent-owned directories).

Recommendation: `oxlint` with `no-unused-vars`, `no-undef` and the correctness
set. Explicitly **do not** enable a formatter yet.

### 3.5 `lil-gui` — the DX item that is already vendored

`node_modules/three/examples/jsm/libs/lil-gui.module.min.js`, 32 KB, importable
today as `three/addons/libs/lil-gui.module.min.js`. **Not a new dependency.**

`src/dev/` contains one file (`shots.js`). There is no in-game tuning UI. Every
constant in this game — `SEND_HZ`, `INTERP_MS`, recoil curves, the ADS blend,
sky turbidity, GTAO radius, spawn scoring weights — is currently tuned by editing
a file, waiting for HMR, and looking again.

A `src/dev/tuning.js` behind a `?dev=1` flag that exposes each subsystem's
constants live is worth more per hour to iteration speed than anything else in
this document. Gate the import so it tree-shakes out of the production bundle:

```js
if (import.meta.env.DEV) { const { Tuning } = await import('./dev/tuning.js'); … }
```

### 3.6 Test runner — probably not

Vitest 4 browser mode is stable and runs real WebGL in Chromium via a playwright
provider, which is a real match for a graphics project. But this repo's harnesses
are not unit tests; they are **probes** — `spawns.probe.mjs` boots the real level
and does 30 respawns, `profile.mjs` reports a frame-time distribution and hitch
count, `imagediff.mjs` is a pixel gate. A test runner adds `describe`/`expect`
and a reporter to things whose value is the domain logic, not the assertion
syntax.

`AGENTS.md` deliberately chose this: *"Tests are executable subsystem harnesses
rather than a centralized test suite."* Keep it. The missing piece is §3.1 (a
thing that runs them), not a runner.

### 3.7 Bundle and frame inspection

- `rollup-plugin-visualizer` (dev dep) — a treemap of the 1.72 MB bundle. One
  config line. Answers "how much of this is `three` and how much is us" in one
  build, which is the question you need answered before any tree-shaking work.
- `spector.js` — captures a WebGL frame and lists every call, state change and
  program switch. This is the tool for the shader-recompilation stalls
  `ARCHITECTURE.md` documents at "+33 to +36 programs and 640–900 ms on that
  single frame". `tools/profile.mjs` already *detects* those; Spector tells you
  which draw caused it. Load it from `src/dev/` behind `?dev=1`, same gate as
  §3.5.

---

## 4. Tier 3 — runtime libraries, which need a rule change

### 4.1 `meshopt_simplifier` — RECOMMENDED, as a vendored file

**The one third-party runtime library worth the argument.**

- `js/meshopt_simplifier.js` — **69,385 B raw, 20,244 B gzip** (+3.8% on our
  528 KB bundle)
- MIT, single file, **self-contained**: the WASM is an embedded base64 string,
  no separate `.wasm` to fetch, no npm dependencies of its own
- Ships nothing over the network at runtime → the "runs fully offline" rule holds
- `simplifyWithAttributes(indices, positions, stride, attributes, attrStride,
  weights, vertexLock, targetIndexCount, targetError, flags)` → `[indices, error]`

This is the piece `SimplifyModifier` (§1.2) cannot do. It takes **weighted
vertex attributes** and a **vertex lock mask**, which is exactly what a skinned
soldier needs: weight normals and UVs into the error metric so the silhouette
and the camo pattern survive, lock the seam vertices between the nine material
groups so the slots stay separable. It is the standard runtime-LOD path for
glTF content and it is fast enough to run at boot.

Against the measured baseline: 6 characters at 25,698 triangles each are
820,342 of the frame's 11.35M triangles, drawn into the forward pass, the
prepass and four cascades. LOD1 at 50% and LOD2 at 20% removes most of that
for anything past ~25 m, and it composes with §1.1 rather than competing.

Why it clears the bar the rules set: the rules exist to keep the bundle small,
keep the game offline-capable, and keep content generated rather than authored.
A 20 KB simplifier does not ship content — it *processes content we generated*,
at load time, on the user's machine. That is on the right side of the intent,
which is why this is the only §4 entry recommended.

Two caveats to verify before landing: the README does not document determinism
guarantees, so pin the version, run it once at boot with fixed inputs, and check
`tools/baseline.mjs` — if the output is not bit-stable across runs, the pixel
gate becomes unusable, and that is a blocker, not a nuisance. And the vendored
copy must be committed with its version and upstream commit recorded, or the
next agent cannot tell it from our code.

Alternative if the rule holds absolutely: hand-author low-poly proxies for the
distant cascades (§1.2). Less good, zero dependencies, and a smaller change.

### 4.2 Rapier / Jolt / Ammo — REJECT

Rapier is the fastest physics engine in the browser as of 2026 — the SIMD builds
are 2–5× its own 2024 releases — and it has a documented cross-platform
deterministic build variant. Jolt has more features (soft bodies, vehicles) and
is the engine behind shipped AAA titles. Both are excellent. Neither belongs
here.

`src/physics/` is 5,598 LOC of *purpose-built FPS physics*: a binned-SAH BVH over
the level's triangle soup, a swept capsule character controller with step-up and
slope limits, an impulse rigid-body solver, a PBD ragdoll solver, and bullet
penetration — all stepped at 120 Hz from `fixedUpdate`, all deterministic off
`ctx.rng`, and all allocation-free. It exposes exactly the queries this game
needs: `capsuleCast`, `overlapCapsule`, `groundHeight`, `lineOfSight`, and a hit
record carrying `surface`, `actor`, `part`, `frontFace` — the surface taxonomy
that `ARCHITECTURE.md` makes the shared vocabulary for FX, decals, audio and
footsteps.

Swapping in a general-purpose engine would mean: rewriting the character
controller against someone else's (FPS movement feel is the hardest thing in
this file to get right, and it is already right), re-deriving the surface tagging
per triangle, adding ~900 KB of WASM to a 528 KB bundle, and inheriting a
determinism story that is *theirs* rather than one seeded off `ctx.rng`. The
engines win at 10,000 dynamic bodies. This game has a handful of ragdolls and
some shell casings.

The narrow case worth revisiting: if ragdolls or destructible props ever become
a headline feature at scale, Rapier for **dynamics only** — keeping our BVH,
raycasts and character controller — is a defensible split. Not before.

### 4.3 `three-mesh-bvh` — REJECT, but steal one idea

`three-mesh-bvh` is a packed binary BVH in typed arrays with a SAH build option
that tests 32 splits per axis per node. `src/physics/bvh.js` is a **binned-SAH
BVH in flat typed arrays** (`nodeBounds` `Float32Array`, `nodeMeta` `Int32Array`,
leaf/interior discriminated by `count`) that allocates nothing after build and
writes into caller-supplied records. These are the same design. We would be
swapping our implementation for a near-identical one and losing the surface
tagging, layer masks and hit-record pooling that are welded into ours.

The one thing worth copying: `ParallelMeshBVHWorker`. Building the BVH
asynchronously off the main thread is a boot-time win, and §1.3 already argues
for the worker infrastructure it needs.

### 4.4 `postprocessing` (pmndrs) — REJECT

Merges post-processing passes into fewer fullscreen draws and is the right answer
for a project assembling stock `EffectComposer` passes. `src/render/` is not that
project: bloom, GTAO, SSR, TAA, DOF, motion blur, exposure, LUT and composite are
hand-written against an MRT prepass that produces `depthTexture` and
`velocityTexture` for other subsystems, with a documented `registerPass()`
extension point and a pre-warm contract that depends on the exact bound render
target. Adopting the library means rewriting all of it to get a merging pass we
could implement ourselves in `src/render/composite.js`.

### 4.5 `msgpackr` / protobuf / FlatBuffers — REJECT

See §2.1. A fixed 20-byte layout beats schema-free MessagePack 84% to 15–50%,
and beats schema-full FlatBuffers on build complexity for a ten-field message.

### 4.6 Colyseus / Nakama / PlayFab — REJECT

Authoritative-simulation and matchmaking frameworks. `MULTIPLAYER.md` is explicit
that the relay is *not* an authoritative simulation and that this is a deliberate
trade for a friends-only game — no accounts, no matchmaking, an invite link and
a room code. These frameworks solve the problem we chose not to have, and they do
not deploy to a Durable Object.

---

## 5. Recommended sequence

Ordered by (measured win) ÷ (effort × risk). Nothing above step 6 changes
`package.json`.

| # | change | tier | buys | risk |
|---|---|---|---|---|
| 1 | GitHub Actions: build + self-tests + capture on PR | §3.1 | enforces rule 7 for every agent | none |
| 2 | `tools/contract.mjs` — rules 2 & 4 | §3.2 | regression guard on the ownership model | none |
| 3 | `src/dev/tuning.js` on vendored `lil-gui`, `?dev=1` | §3.5 | live tuning; biggest iteration-speed win | none, dev-gated |
| 4 | Binary `state`/`snapshot` via `DataView` | §2.1 | **6.2× wire reduction**, no `JSON.parse` in receive | protocol change, both relays |
| 5 | Character texture bake → `WorkerPool` | §1.3 | **3.27 s → ~0.8 s non-blocking** boot | determinism; verify with `baseline.mjs` |
| 6 | Measure `SceneOptimizer` over the built level | §1.1 | sizes the `BatchedMesh` prize before committing | none — measurement only |
| 7 | `BatchedMesh` in `src/world/builder.js` | §1.1 | attacks **1266 of 1724** draw calls | moves pixels; `bvh.js` needs teaching |
| 8 | Vendor `meshopt_simplifier`, LOD the soldier | §4.1 | attacks **820k tris × 6 passes** | +20 KB gzip; **needs a rule decision** |
| 9 | `jsconfig.json` + `ctx.d.ts`, `// @ts-check` per subsystem | §3.3 | catches cross-subsystem breakage at author time | none, incremental |
| 10 | New shaders in TSL where self-contained (`src/sky/`) | §1.4 | reduces the eventual WebGPU migration surface | none if scoped to new code |

Steps 4, 5, 7 and 8 all touch measured numbers in `TEXTURE-PERF.md`, so their
verification path is already built: `tools/drawcalls.mjs` and `tools/texcost.mjs`
for the counts, `tools/profile.mjs` on real hardware for the frame times,
`tools/baseline.mjs` and `tools/imagediff.mjs` for the pixel gate.

## 6. What this does not cover

Every number here is either read out of a real build on this branch, measured
with `node` against the actual message shapes in `src/net/index.js`, or quoted
from `TEXTURE-PERF.md` with its own caveats intact. As in that document, the
container has no GPU, so **nothing here is a frame-time claim** — draw calls,
bytes, triangles, blocking milliseconds and bundle sizes are all
hardware-independent, and the predicted frame impact of steps 7 and 8 is
explicitly not stated.

Not evaluated: audio libraries (`src/audio/` is 4,895 LOC of synthesis and
sampling with its own mixer and spatialisation, and nothing off-the-shelf targets
that), animation libraries (`src/ai/animator.js` and the weapon rig are
procedural by design), UI frameworks (the HUD is direct DOM in `src/ui/` and a
framework would add a render loop competing with the game's), and state
management (`ctx` is the state model).

Sources for the third-party claims: the
[meshoptimizer JS module docs](https://github.com/zeux/meshoptimizer/blob/master/js/README.md),
[three.js `BatchedMesh` docs](https://threejs.org/docs/pages/BatchedMesh.html),
[three.js 2026 / WebGPU status](https://www.utsubo.com/blog/threejs-2026-what-changed),
[WebGPU Baseline coverage](https://vr.org/articles/webgpu-baseline-2026-three-js-webxr-default),
[WebSocket vs WebTransport](https://websocket.org/comparisons/webtransport/),
[WebTransport 2026 Baseline status](https://anhtu.dev/webtransport-next-gen-realtime-protocol-2026-2228),
[workerd WebTransport tracking issue](https://github.com/cloudflare/workerd/issues/6451),
[Rapier](https://rapier.rs/),
[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh),
[dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md),
[oxlint vs Biome 2026](https://jsmanifest.com/biome-oxlint-comparison-2026),
[Vitest browser mode](https://vitest.dev/guide/browser/why),
[TypeScript on JS projects](https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html),
and [JS serialization benchmarks](https://github.com/Adelost/javascript-serialization-benchmark).

---

## 7. Addendum — 2026-08-06, re-researched at `7073a36`

176 commits after `ba67754`. The question was asked again; this section records
what changed rather than restating §§0–6, which still stand.

### 7.1 Nothing in §5 has been executed

Re-measured on this branch, same greps as the header block:

```
three addons imported    2   (RoundedBoxGeometry, BufferGeometryUtils)
BatchedMesh uses         0        THREE.LOD uses            0
new Worker uses          0        DataArrayTexture uses     0
CI workflows             0        tools/contract.mjs        absent
src/dev/tuning.js        absent   jsconfig.json             absent
DataView in net path     0        meshopt vendored          no
```

Every one of §5's ten steps is still open. The `meshopt` string in
`tools/glb-bake.mjs:142` is a glTF-extension *rejection* check, not a
dependency — §4.1 remains an undecided proposal.

The finding, then, is not that §5 picked the wrong libraries. It is that the
constraint on this codebase was never library selection. Steps 1–3 are still
hours of work each, still need no dependency decision, and still have no risk.

Note also that both addon imports still use the legacy `three/examples/jsm/`
path rather than the `three/addons/` export alias §1 assumes.

### 7.2 `three` is five releases behind — this is the new step 0

`package.json` pins `^0.180.0`; upstream is `r185`. The caret will not cross a
minor here, so this is a deliberate edit, not an `npm update`.

It matters because it lands directly on §1.1, the highest-leverage item in this
document. **`BatchedMesh` was substantially revised in r183–r184** — wireframe
material support, per-instance opacity, and corrected index/attribute handling
during `optimize()`. Doing §1.1's world-batching work on r180 means doing it
against a version missing those fixes.

One caveat discovered while checking: `BatchedMesh` currently emulates
instancing by repeating `multiDrawElements` parameters instead of using
`multiDrawElementsInstanced`. The open issue measures the forgone speedup at
~1.5× on integrated GPUs and ~2× on discrete. This does not change the
recommendation — 1266 draw calls collapsing is still the prize — but it caps
the expected win, so do §5 step 6 (measure with `SceneOptimizer`) before
committing.

**Upgrade cost, checked rather than assumed.** The documented r183/r185
deprecations cost this repo nothing: `grep` finds no `THREE.Clock` and no
deprecated `Matrix3.scale/rotate/translate` in `src/`.

The real risk is elsewhere and is not an API break. Six files patch GLSL —
`src/materials/shader.js`, `src/render/csm.js`, `src/render/materialpatch.js`,
`src/render/prepass.js`, `src/fx/decals.js`, `src/ai/livery.js` — via
`onBeforeCompile` and `#include` chunk surgery. `ShaderChunk` contents drift
between releases with no deprecation warning, because they are not API. A chunk
whose body changed shape will either fail to compile (loud, fine) or silently
patch into something subtly different (quiet, and exactly what the pixel gate
exists for). Gate the bump on `npm run build` plus `tools/baseline.mjs` and
`tools/imagediff.mjs`.

#### 7.2.1 The bump was attempted. It fails the pixel gate. — 2026-08-06

Run, not predicted. `three@0.185.0` installed, then the full gate:

```
25 free self-tests      all pass            (identical to r180)
npm run build           passes, 196 modules (identical module count)
bundle boot chunk       508.44 → 516.06 kB gzip   (+7.6 kB, +1.5%)
draw calls / triangles  IDENTICAL on all 12 shots
shader programs         +1 on all 12 shots (e.g. hero 192→193, combat 199→200)
tools/baseline.mjs      12/12 shots captured, zero pageerrors
tools/imagediff.mjs     94.7–97.7% of pixels changed, maxDelta 137–198
```

**Every green signal is green and the picture is still wrong.** No API broke,
no chunk name disappeared (all 28 `#include` targets patched by `src/` still
exist in r185), nothing threw. This is precisely the silent-drift failure the
paragraph above predicts, and it is why the gate is not optional.

Control run first, because a 97% diff is equally consistent with a
nondeterministic harness: **two consecutive r185 captures are bit-exact zero on
all 12 shots.** The harness is sound; the difference is real.

The uniform `+1` program on every single shot, with draw calls and triangle
counts frozen, is itself the tell: nothing about what we submit changed, but
every material compiles one additional permutation. That points at the lighting
path, not at our geometry — and the chunk diff confirms it.

Cause, isolated by diffing `ShaderChunk` bodies between the two versions —
**9 of the 28 chunks this repo patches changed**, and they are almost entirely
the lighting cluster:

```
common                  defaultnormal_vertex    normal_fragment_maps
lights_pars_begin       lights_fragment_begin
lights_fragment_maps    lights_fragment_end
color_fragment          batching_pars_vertex
```

Wider context: `lights_physical_fragment`, `lights_physical_pars_fragment`,
`envmap_physical_pars_fragment`, `shadowmap_pars_fragment` and
`shadowmask_pars_fragment` also changed, and a **new `lightprobes_pars_fragment`
chunk appeared** — i.e. §7.3's `LightProbeGrid` work refactored the diffuse
irradiance path, which is exactly the path `src/materials/shader.js` and
`src/render/materialpatch.js` splice into.

Visually (read `.shots/three180/hero.png` against `.shots/three185/hero.png`):
r185 is flatter — ambient lifted, direct shadows weakened, foliage
desaturated, ground washed out. The diff image is magenta across the entire 3D
scene and **black on the minimap and HUD text**, confirming geometry and UI are
untouched and this is purely a shading difference.

**Revised verdict on step 0: it is not a version bump, it is a port.** The work
is to re-derive the nine patches in `src/materials/shader.js`,
`src/render/{csm,materialpatch,prepass}.js`, `src/fx/decals.js` and
`src/ai/livery.js` against the r185 chunk bodies, then drive the diff back to
zero. Reverted to `^0.180.0` pending that work; do not re-attempt it as a
one-line `package.json` edit.

Reproduce with:

```
node tools/baseline.mjs --out=.shots/three180 --port=5273   # on r180
npm install three@0.185.0
node tools/baseline.mjs --out=.shots/three185 --port=5273
node tools/imagediff.mjs --a=.shots/three180 --b=.shots/three185 --write-diff
```

### 7.3 Two new three.js features, correctly sized

- **`LightProbeGrid` (r184)** — position-dependent diffuse GI. Genuinely
  interesting for the maps. **Not recommended yet: WebGLRenderer support is
  unconfirmed.** Many recent additions are node-material/WebGPU-only and the
  release notes do not say which this is. Verify against
  `node_modules/three` before planning around it.
- **`RenderPipeline` (r183)** — widely written up as "the modern
  `EffectComposer`". It is the WebGPU-side rename of `PostProcessing`, so it is
  irrelevant here for the same reason §4.4 rejects the `postprocessing` package:
  `src/render/` is not a stock pass stack, it is 5,853 LOC built against an MRT
  prepass with its own `registerPass()` contract. Do not let the write-ups
  reopen §4.4.

### 7.4 §3's dev-tooling picks still hold, and `oxlint` got stronger

Re-checked because §3 is ten months old. §3.4 recommended `oxlint` over
`biome`; that call has aged well and is now better supported than it was:
`oxlint` is v1-stable with ~787 rules, an ESLint-config migration tool, and
type-aware linting via `tsgo`. The new fact is ecosystem alignment — **Vite 8
ships `oxlint` as its default linter**, both being VoidZero projects.

We are on `vite@^7.3.6`; Vite 8 (stable March 2026) defaults to Rolldown as its
bundler. That is a separate and larger decision than a linter, and it is not
recommended here — but it means choosing `oxlint` is now the
path-of-least-resistance option rather than a side bet.

§3.4's other half is unchanged and worth restating, because Vite 8 makes it
tempting: **still do not enable a formatter.** A repo-wide reformat across
fifteen agent-owned directories destroys `git blame` at exactly the moment
`git blame` is how agents discover each other's intent.

### 7.5 Revised sequence

§5 stands as written, with one step inserted ahead of it:

| # | change | buys | risk |
|---|---|---|---|
| **0** | `three` 0.180 → 0.185 — **attempted, blocked, see §7.2.1** | unblocks the fixed `BatchedMesh` before §5 step 7 builds on it | **higher than assumed.** No API break, but 9 patched lighting chunks changed bodies and the pixel gate fails at 94.7–97.7%. This is a port of `src/materials/shader.js` + `src/render/materialpatch.js`, not a bump. |

Then §5 steps 1–10 unchanged.

Because step 0 turned out to be a project rather than an afternoon, it should
**not** block the rest. §5 steps 1–3 (CI, contract checker, `lil-gui` tuning
panel) touch none of the render path and remain the correct next moves; step 0
is a prerequisite only for step 7, which is far down the list.

### 7.5.1 Model import: the restriction was doctrine, not the rule

Asked 2026-08-07: how should premade 3D models come in?

The repo's answer was "bake, never load — there is no `GLTFLoader` in the
client and there must not be one" (`glb-weapon` skill, `tools/glb-bake.mjs`).
Checked against rule 3, that is **stricter than the rule requires**:

- `GLTFLoader` and `MeshoptDecoder` are `three/addons` — the one dependency
  already allowed. Not a new npm dependency.
- A `.glb` imported through vite is emitted into `dist/` and served from our
  own origin. Not a CDN fetch; the game still runs fully offline.
- `vite.config.js` already lists `**/*.glb` in `assetsInclude` — the build was
  configured for this before anyone asked.

So no hard rule needed amending. The restriction lived in `AGENTS.md`'s
"meshes, textures, and animation are generated in code" and in the skill's
doctrine, and those are what changed.

**The decision rule now recorded in `AGENTS.md`:** static single-material
geometry bakes (unchanged default — cheaper on every axis and reviewable in a
diff); skinned, morphed or animated content loads a bundled meshopt-compressed
`.glb`. The bake discards skins and clips *by design*, so a rigged character
was never expressible in it — that gap, not a preference, is what justifies the
second path.

Measured cost of the two addons in the boot chunk: **508.44 → 527.35 kB gzip,
+18.91 kB (+3.7%)**. Import them only where needed so a build with no imported
model does not pay it.

Meshopt over Draco, for a reason specific to our rules: `meshopt_decoder.module.js`
is a single 24.8 KB ES module that bundles, while Draco needs `draco_decoder.wasm`
plus worker files fetched from a path at runtime — reintroducing exactly the
external fetch rule 3 forbids. Meshopt also preserves morph targets and
animation; Draco drops them.

Three guardrails carried into the doc, because they are where this can go
wrong silently: the load must complete before `window.__READY__` or the pixel
gate races; animation runs off the engine clock, never wall clock; and glTF
materials still map to the procedural library, because geometry and clips come
in but the look does not.

### 7.5.2 Rules 1 and 2 amended — 2026-08-07

The question behind this was whether the rules, written for a smaller codebase
and a fleet of parallel agents, had started limiting the work. Measured: `src/`
has grown **73,681 → 101,743 LOC (+38%)** since §§0–6 were written, across 15
subsystems and 30 self-tests.

The decisive evidence was not an argument from principle. **The rules had
already lost to practice.** `DESIGN.md`'s One Token File Rule *requires* menu
surfaces to import `src/ui/brand.js`; rule 2 forbade it. Three standing
violations, two of them mandated by another first-party doc:

```
src/net/ui.js:17           -> ../ui/brand.js
src/match/ui.js:61         -> ../ui/brand.js
src/weapons/preview.js:16  -> ../materials/index.js
```

**Rule 1** was made conditional. It is mutual exclusion, not architecture — it
buys something only when several writers share one filesystem. The deciding
variable is not subagents-vs-instances but *shared working tree vs isolated
worktree*: subagents in one session and two Claude Code instances on one
checkout are both the former; a git worktree or separate checkout is the
latter, where git already resolves the overlap and the rule only blocks
legitimate cross-cutting edits.

**Rule 2** gained a stateless-leaf exception, which legalises what the code
already does. Note the honest sizing: `ctx.get` appears at 29 sites, roughly
half of them self-lookups, so there are only about **12 real cross-subsystem
edges in 101k LOC**. The boundary is cheap, not expensive — rule 2 was never
the thing slowing anyone down, and it stays because it is what lets one
subsystem be refactored without breaking the rest.

Its genuine cost is unchanged by this edit: `ctx.get()` returns `any`, so all
12 edges are unchecked and a rename in `src/fx/` fails at runtime, in a frame,
in a browser. The fix is §3.3 (`jsconfig.json` + a hand-written `ctx.d.ts`) and
it needs **no rule change at all**.

Deliberately **not** changed: rules 3–7. Rule 3's dependency ban has aged well
and §7.5.1 showed the model-import restriction was never in it. Rules 4, 5 and
6 are load-bearing and cheaply checkable — §7.2.1 only reached a conclusion
because rule 4 makes two capture runs bit-exact. Rule 7 is the counter-example
worth remembering: it read as friction for a year, and became invisible the
moment §7.6 automated it. Some rules are not too strict, only unautomated.

### 7.6 §5 step 1 has landed — `.github/workflows/ci.yml`

Written 2026-08-06. `npm ci` → `npm run build` → the self-tests, on push to
`main` and on every PR. `ARCHITECTURE.md` rule 7 is now enforced by a machine
rather than by hope.

It **discovers** the suites with the `find` incantation from `AGENTS.md` rather
than listing them, because that list drifts — a new `selftest.mjs` is picked up
the moment it lands, with no edit to the workflow. Currently 25. Two families
are excluded deliberately and the file says why: `server/*.selftest.mjs` each
bind a real socket, and `src/audio/selftest.js` asserts nothing when run
directly.

It renders nothing, per `AGENTS.md`'s "default to not rendering". GitHub runners
have no GPU, so a capture would go through SwiftShader at minutes per shot to
produce a frame no human reads — and the `visual-check` skill is explicit that
this is worse than not capturing. Captures, playtests and the pixel gate stay a
local step.

Not verified: no Actions run has executed. The YAML parses, the discovery
command returns the expected 25 locally, and every command in it was run green
on this machine — but a green first run is still pending on the first push.

Sources for this addendum:
[three.js r184](https://github.com/mrdoob/three.js/releases/tag/r184),
[r185](https://github.com/mrdoob/three.js/releases/tag/r185),
[BatchedMesh multiDraw issue #31935](https://github.com/mrdoob/three.js/issues/31935),
[Vite 8 / Rolldown / Oxc](https://www.alexcloudstar.com/blog/vite-8-rolldown-oxc-2026/),
[Biome vs ESLint vs Oxlint 2026](https://www.pkgpulse.com/guides/biome-vs-eslint-vs-oxlint-2026).
