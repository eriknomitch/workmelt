# Workmelt

Forked from [mshumer/Claude-of-Duty]([url](https://github.com/mshumer/Claude-of-Duty))

A first-person shooter built in the browser with Three.js r180 and WebGL2. Roughly
55k lines across 13 subsystems, written by a fleet of AI agents under orchestration.

Every texture, mesh and animation is generated procedurally at load time from
code — no models, no HDRIs, no image files. Audio combines a procedural synthesis
layer with sampled sound effects. The only runtime dependency is `three`.

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

The game opens on a **Match Start** screen rather than dropping you mid-firefight:
pick a **map**, pick a bot garrison and start on your own, or wait for a friend
to join your room and ready up together. Once the match is live, click the canvas
to lock the cursor. WASD move, mouse aim, LMB fire, RMB or X ADS, R reload, Shift sprint,
Ctrl crouch, Space jump, Q/E lean, Esc release.

**On a trackpad**, aiming down sights has its own settings, because a two-finger
click cannot be held while a one-finger click fires. The pause menu exposes both
halves of the fix: **Aim (ADS)** switches the aim button from `hold` to
`toggle`, and **ADS Key** rebinds aiming to the keyboard — X by default, so
aiming works without a mouse out of the box. Both are stored per browser.

Graphics default to **Auto** per browser profile. On first launch the game
estimates the active display cadence, calibrates a
Performance/Low/Medium/High/Ultra pipeline, then adjusts internal resolution
within that tier to pursue stable p95 frame pacing. Open the pause menu to
choose a fixed preset or a target from 30–240 FPS; settings are stored locally
and never synchronized in multiplayer.

### Advanced graphics

Auto is a starting point, not a ceiling. The pause menu's graphics tabs expose
every knob the renderer has, each of which follows the preset until you touch
it: **Display** (internal resolution scale up to 200% supersampling, the
device-pixel-ratio cap, anti-aliasing, weapon MSAA), **Textures & Detail**
(world bake resolution, character bake resolution, anisotropic filtering,
parallax occlusion, micro detail, particle and decal budgets), **Shading &
Lighting** (cascade count and resolution, shadow distance and density, ambient
occlusion, contact shadows, screen-space reflections, volumetrics),
**Post-Processing** (bloom, motion blur, ADS depth of field, sharpening, grain,
chromatic aberration, vignette, grade strength) and **Visibility** (brightness,
auto-exposure lock, exposure key, shadow lift, lamp brightness, FOV).

Anything the renderer can take mid-frame is applied as you move it. Anything
that is built once at boot — a post pass, a render target, a texture bake — is
marked `RESTART`, saved immediately, and applied when you press **Apply &
Restart**. The Auto Status row reports the resolution you are actually
rendering at, in pixels, which is usually the answer to "why does this look
soft": if you are on a 2x display, Auto caps the backbuffer at 1.5x and then
the adaptive scaler takes its own cut on top.

If distant players are hard to pick out, the settings that move the needle most
are Resolution Scale, Display Sharpness, Character Textures and Shadow Lift —
in that order.

## Maps

Four levels ship, and the Match Start screen picks between them. All are
generated in code like everything else.

| | |
|---|---|
| **Market** | A 120 m Middle-Eastern market street in the spirit of Crash/Backlot: one long street, two flanking alleys, an arched gate closing the vista, three enterable and furnished buildings, several thousand props. |
| **Rust** | A low-poly take on the classic: a 55 m desert oil refinery built around a 13 m steel derrick with two stair-connected platforms and a gantry to the shed roof, rows of shipping containers for cover, and a two-storey office overlooking the yard. |
| **Wilmot** | A low-poly walled country estate modelled on 1900 Wilmot Rd, Bannockburn IL: a two-storey brick manor you fight through, its listing's own pool terrace, tennis court, sunken-garden trench, hay-loft barn and glass greenhouse arranged around the lawn. |
| **The Loop** | A low-poly Chicago corner under the L, played at night: two streets crossing beneath a curve of riveted elevated track, steel columns and lit shopfronts for cover below, a stalled train with its saloon lights on, a wooden station platform and a walkable track deck above, with service alleys behind the brick. The hour belongs to the map — lamp posts, marquee, blade sign and a scatter of lit rooms are what you fight by. |

Deep-link a level with `?map=loop`; otherwise the game remembers whichever you
last chose. In a room the map belongs to the *room* — pick one and everybody in
it switches together. Adding a fifth is a module and one line in
`src/world/maps.js`; see [ARCHITECTURE.md](ARCHITECTURE.md).

## Multiplayer

It's also a room-based free-for-all you invite friends to with a link.

```bash
npm run dev:mp       # client (:5173) + relay (:8787) together
```

Open the URL — a `?room=CODE` is added automatically, so the address bar is
always a shareable **invite link**. Copy it from the Match Start screen and send
it to a friend; anyone who opens it joins your room. When you are both there,
press **Ready**: the relay counts 3–2–1 and starts the match for both of you at
once, players only, no bots. Someone who arrives after the match is live drops
straight in. **Tab** shows the scoreboard.

To put it online so friends can join over the internet, the easiest path is
**Cloudflare** (one command, free plan, global edge):

```bash
npx wrangler login && npm run cf:deploy
```

That prints a `*.workers.dev` URL to share. It runs the client and the
multiplayer relay (a Durable Object per room) from one Worker — see
[CLOUDFLARE.md](CLOUDFLARE.md). Prefer a Node host? `npm run serve` plus the
included Render / Fly / Docker configs. Full details in
[MULTIPLAYER.md](MULTIPLAYER.md).

## What's in it

| subsystem | what it does |
|---|---|
| `render` | HDR pipeline, cascaded shadow maps in a `sampler2DArray` with texel snapping and PCSS contact hardening, MRT depth/normal/velocity prepass, GTAO, TAA with YCoCg variance clipping, tile-dilated motion blur, Karis bloom pyramid, GPU EV100 metering, procedural 33³ grade LUT, AgX composite |
| `materials` | GPU texture forge: 19 procedural surfaces (concrete, brick, plaster, asphalt, sand, rusted/painted/brushed metal, wood, fabric, burlap, glass…), periodic noise so everything tiles seamlessly, Sobel height→normal, parallax occlusion mapping, triplanar projection, curvature-driven edge wear |
| `sky` | Atmospheric scattering, time of day, PMREM environment generation, volumetric fog and light shafts |
| `world` | ~120×120 m market street: modular building kit with real wall thickness, enterable interiors, several hundred instanced props |
| `physics` | Written from scratch, no library. Binned-SAH BVH (29k tris → 14k nodes in 22 ms, 0.25 µs/raycast), swept-capsule character controller with a 5-plane crease stack, impulse rigid bodies with CCD, PBD ragdolls, multi-layer bullet penetration |
| `player` | Movement state machine, slide/mantle/lean, camera feel |
| `weapons` | Procedural weapon geometry, viewmodel rig, ADS, spring recoil, procedural reloads, ballistics with travel time and drop |
| `fx` | GPU particles, decals, tracers, muzzle flash, explosions |
| `ai` | Skinned soldiers, navmesh pathing, perception, cover behaviour, ragdoll death |
| `ui` | DOM/CSS HUD: crosshair, hitmarkers, minimap, compass, killfeed |
| `audio` | CC0/CC-BY samples for shots, footsteps, impacts and UI, layered over Web Audio synthesis for everything else. Convolution reverb, HRTF spatialisation, occlusion |
| `net` | Room-based multiplayer: WebSocket relay transport, interpolated remote players, trust-the-shooter PvP hits, invite bar and scoreboard |
| `match` | The Match Start view: bot garrison size, ready-up, countdown, and the moment the match goes live |

`ARCHITECTURE.md` is the contract the agents worked against: subsystem interface,
directory ownership, the cross-subsystem event vocabulary, and shared surface types.

## Sound

Weapon fire, footsteps, bullet impacts and the UI indicators play from sampled
audio; everything else — enemy barks, suppressed weapons, shell casings,
reloads, explosions, glass/flesh/rubber footsteps — is still synthesized at
runtime. Both go through the same `{ node, end, send }` voice contract, so a
build with no encoded assets is a supported configuration and simply sounds
fully procedural.

The 144 shipped clips total **0.7 MB** (mono 48 kHz Opus, in `public/sfx/`) and
are committed. To re-encode them from the original masters:

```bash
npm run sfx:fetch    # ~338 MB of source packs into assets-src/ (gitignored)
npm run sfx          # trim, normalize, downmix, encode -> public/sfx/
npm run test:audio   # headless verification of the whole graph
```

Curation lives in `tools/sfx-sources.mjs` — which recording becomes which
in-game voice. Sources and licenses are listed in
[public/sfx/CREDITS.md](public/sfx/CREDITS.md); the firearm and Kenney packs are
CC0, and the footstep pack is **CC BY 3.0, so that credit has to stay with any
build you ship**.

## Performance readout

A live counter is on by default in the upper-left, below the minimap. **F3**
cycles it: full → compact → off.

It reports more than fps, because fps alone cannot tell you what to fix:

| field | meaning |
|---|---|
| `FPS` / `ms` | smoothed wall-clock frame time |
| `1% low` / `p99` | fps at the p99 frame time — the number that correlates with "it stutters" |
| `CPU` / `GPU` / `MIX` badge | whether the frame is main-thread bound or waiting on the GPU/vsync |
| `cpu` / `gpu` / `other` | where wall-clock time goes. `other` is time *not* in our JS: vsync, compositing, GPU back-pressure. High `other` means JS optimization is wasted effort |
| `fix/upd/late/rnd` | mean ms in each engine phase — points at the subsystem |
| graph | frame-time history with 60/30 fps rules, so a hitch is visible as a spike |
| `calls` / `tris` / `prog` | draw calls, triangles, shader programs. A *rising* program count during play is a shader compiling mid-frame — the classic Three.js stall |

`gpu` needs `EXT_disjoint_timer_query_webgl2`, which most stock browsers gate
behind a flag; the row hides itself when it is unavailable rather than lying.

The same data is readable and loggable, which is the point — it's the baseline
for an optimization pass:

```js
__PERF__.stats()                       // percentiles, phase breakdown, bound classification
__PERF__.log()                         // one-line summary to the console
__PERF__.startRecording({frames:600})  // begin a benchmark capture
__PERF__.stopRecording()               // -> { label, frames, stats, rows }
__PERF__.csv()                         // last recording as CSV
```

| URL param | effect |
|---|---|
| `?fps=off\|mini\|full` | initial display mode |
| `?fpspos=tl\|tr\|bl\|br` | corner |
| `?fpstarget=120` | fps the colour ramp treats as "good" |
| `?perflog=300` | print a summary to the console every 300 frames |

Instrumentation lives in `src/core/perf.js`, timed from `Engine.step()`. It is
measurement only — it never feeds simulation — and it is suppressed entirely in
capture mode (`?capture=1`), so the pixel gate stays byte-exact.

## Tooling

The interesting part of this repo is arguably the harness, not the game.

| tool | purpose |
|---|---|
| `tools/capture.mjs` | Screenshot one named shot via GPU-backed headless Chromium |
| `tools/shotset.mjs` | All 11 shots in one session — fast review set |
| `tools/baseline.mjs` | **Reproducible** capture: each shot in an isolated page, fixed frame budget. Bit-identical across runs |
| `tools/imagediff.mjs` | Per-pixel gate. Exits non-zero if any pixel moved |
| `tools/profile.mjs` | Isolated gameplay profiler at real device pixel ratio. Frame-time *distribution*, engine timings, and an optional `--target=FPS` exit-code gate |
| `tools/playtest.mjs` | Scripted movement/fire smoke test |
| `tools/visibility.mjs` | Per-tier readability: sharpness, black crush, shadow detail, and per-enemy silhouette contrast. Runs on SwiftShader, needs no GPU |
| `tools/cost.mjs` | Per-tier GPU workload model (`costIndex`) read out of the live engine, plus measured CPU simulation time. Ordinal, not fps |
| `tools/goal.mjs` | Scores an open goal in `goals/` and exits non-zero until every criterion passes |

### Measuring on a machine with no GPU

`visibility.mjs`, `cost.mjs` and `goal.mjs` run under Chromium's SwiftShader
backend, which executes the real shaders and produces the real image at roughly
2 s per frame at 640×360. That makes every *image* metric fully valid on a
GPU-less container — sharpness, crush, enemy contrast — while frame rate stays
strictly the province of `tools/profile.mjs` on real hardware. `goals/` states
which criteria are decided where, and `tools/goal.mjs --ingest=run.json` folds a
real-hardware profile back into the scorecard.

Two findings worth recording, because both invalidated earlier measurements:

**Median frame time hides the actual problem.** A static-camera benchmark reported
94 fps while the game was unplayable. Real gameplay at Retina DPR (internal 3.34 MP,
not 2.07) ran 12–17 fps with **728–1236 ms stalls** caused by 34+ WebGL programs
compiling lazily mid-frame. `profile.mjs` reports p50/p95/p99 and attributes each
hitch, which is what surfaced it.

**Captures were not reproducible.** `shotset.mjs` reuses one page across all 11
shots, so particle age, decal buffers and exposure state leak forward — two identical
runs differed on 10 of 11 shots. `baseline.mjs` isolates each shot in a fresh page,
which is bit-identical and is what makes `imagediff.mjs` a usable gate.

## Performance

The Auto-only Performance tier has an isolated acceptance gate that is
independent of the user's foreground tab:

```bash
node tools/profile.mjs --port=5173 --dpr=2 --w=1280 --h=720 --frames=360 \
  --target=120 --query=q=performance\&mp=0\&prewarm=0
```

On the development Apple-silicon machine this reports 161 FPS p95 and 156 FPS
p99 while moving, firing, and running AI. The tier retains the depth prepass,
registered gameplay feedback, and a single-tap sun shadow; it trades resolution
and expensive shadow filtering for frame time.

Measured on an Apple silicon laptop at 1512×982, DPR 2 (3.34 MP internal), `ultra` preset,
3 runs, gameplay in motion with AI and firing active:

| | before optimization | after |
|---|---|---|
| fps p50 | 12–17 | **28–30** |
| fps p99 | 4–9 | **14–17** |
| worst frame | 728–1236 ms | **66–82 ms** |
| shader compiles during play | 34–35 | **0** |
| boot | ~9–12 s | **3.7–4.6 s** |

The optimization pass was constrained to produce **zero visual change**, enforced by
`imagediff.mjs` rather than by assertion — the shipped build is bit-identical to its
pre-optimization reference across all 11 shots.

Shader pre-warm (`src/core/prewarm.js`) is what removed the stalls. Making it
*provably* pixel-neutral required first fixing subsystems that animated off
`performance.now()` instead of the engine clock, since any change to boot duration
otherwise shifted output.

## Honest assessment

The goal was to match a modern Call of Duty. **It does not.**

Eleven independent adversarial critics scored the frames against that bar. Scores
went 3.59 → 4.14 → 4.05 → **5.05** out of 10. Two shots reached "CLOSE"; the rest
remain "AMATEUR". In a blind A/B, **every critic in every round picked the real Call
of Duty frame.**

Where it falls short, specifically:

- **Hands.** Blocky finger slabs that don't convincingly grip the weapon.
- **Material richness.** Surfaces read as procedural noise rather than photographed
  reality at close range — the ceiling of generating texture from code.
- **Characters.** Enemies read as mannequins at distance.
- **Indirect light.** An approximation, not real GI.
- **Frame rate.** 28–30 fps at Retina. The art passes tripled geometry cost
  (5.9M → 11.3M triangles) and optimization recovered about half.

A known root cause remains unfixed: the viewmodel light rig in `render/index.js`
delivers roughly 20× the irradiance per unit albedo that the world does — a plain
*black* material in the view scene renders at L=110 against a background of 91,
purely from F0=0.04. Every weapon albedo is cheated to a third of physical to
compensate, which caps material separation on the most-looked-at object in the game.

## Process note

Sequential single-owner passes beat parallel fan-out decisively. Three rounds of six
agents each owning one directory moved the score +0.46 and left frame-ruining defects
*higher* than they started (60 → 47 → 66), because tonemapping, sky and indirect light
are one coupled system and isolated agents kept breaking each other's assumptions.
One sequential pass with a single owner per coupled concern moved it +1.00 and cut
defects 66 → 26.

The most valuable single result came from an agent contradicting its own brief. Every
critic for three rounds reported the weapon as "untextured". It wasn't — it was
specular-dominated, with the diffuse term measured at L=26 against a shipped L=67.
Prior rounds had been crushing albedos to fight bright-part complaints, which killed
diffuse and made it worse. The fix was the opposite of what was asked for.
