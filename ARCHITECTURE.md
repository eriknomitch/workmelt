# WORKMELT — engine contract

**Every agent must read this before writing code. It is the only coordination mechanism.**

Target: a browser FPS whose *visual and tactile quality* stands next to a modern
Call of Duty. WebGL2 + Three.js r180. Textures, meshes and animation are
generated procedurally at load time; audio may be procedural or sample-based.

## Hard rules

1. **You own your directory. Never edit files outside it.** Another agent owns
   every other directory and your edit will be clobbered or will break them.
2. **Never import another subsystem's module.** Get it at runtime:
   `const fx = ctx.get('fx')`. This is what makes parallel work safe.
3. **No new npm dependencies.** `three` only. No CDN fetches — every asset the
   game needs ships in the bundle, so it runs fully offline.
4. **No `Math.random()` in gameplay or visuals.** Use `ctx.rng` (see
   `src/core/rng.js`) or a `ctx.rng.fork()` you keep. Capture reproducibility
   depends on it.
5. **Allocate nothing per-frame.** Preallocate vectors, matrices and arrays in
   `init()` and reuse. A `new THREE.Vector3()` inside `update()` is a bug.
6. **Dispose what you create.** Geometries, materials, textures and render
   targets get freed in `dispose()`.
7. `npm run build` must pass and `node tools/capture.mjs` must produce a frame
   after your change. If you break the boot, nobody else can work.

## Subsystem interface

```js
export class MySystem {
  static id = 'mysystem';       // unique; how others reach you
  static deps = ['render'];     // ids that must init before you

  async init(ctx) {}            // build resources; may await
  fixedUpdate(h, ctx) {}        // optional, 120 Hz, deterministic gameplay
  update(dt, ctx) {}            // optional, once per frame
  lateUpdate(dt, ctx) {}        // optional, after all update()
  resize(w, h, ctx) {}          // optional
  dispose() {}                  // optional
}
```

`ctx` provides: `scene`, `camera`, `viewScene`, `viewCamera`, `canvas`,
`config`, `events`, `input`, `time`, `rng`, `get(id)`, `peek(id)`, `has(id)`.

- `scene` / `camera` — the world. `viewScene` / `viewCamera` — the first-person
  weapon, drawn separately so it can never clip through walls.
- `time` — `{ elapsed, raw, dt, fixed, alpha, scale, frame }`. Use `alpha` to
  interpolate rendered transforms between physics steps.
- `config.q` — the active quality preset (see `src/core/config.js`). Respect
  `q.taa`, `q.gtao`, `q.ssr`, `q.volumetrics`, `q.shadowMapSize`,
  `q.particleBudget`, `q.decalBudget`. Never exceed a budget.

  A preset field is also the **only** place the advanced graphics menu can
  reach. `src/core/graphics.js` folds the player's per-option overrides into
  `config.q` at boot, before `init()` runs, so a subsystem never learns that an
  option exists — it reads the same preset object it always did. If your
  subsystem re-derives a quality decision from `config.quality` (the tier NAME)
  rather than from a `config.q` field, that decision cannot be exposed as a
  setting: give it a preset field instead. `q.textureScale`,
  `q.characterTextureSize`, `q.parallaxScale`, `q.detailScale`, `q.antialias`,
  `q.viewSamples`, `q.contactShadows`, `q.dof` and `q.pixelRatioCap` all moved
  out of such derivations for exactly this reason.

## Ownership map

| id | directory | owns |
|---|---|---|
| `render` | `src/render/` | WebGLRenderer, HDR pipeline, all post-processing, CSM shadows, the final composite |
| `materials` | `src/materials/` | procedural PBR texture generation, the shared material library, triplanar/detail mapping |
| `sky` | `src/sky/` | physical sky, sun/moon, time of day, IBL/env map generation, volumetric fog & light shafts |
| `world` | `src/world/` | level geometry, the modular building kit, props, set dressing, static collision meshes, the spawn point set and the spawn director (`src/world/spawns.js`), the map list and the level rebuild (`src/world/maps.js`) |
| `physics` | `src/physics/` | broadphase, raycasts, character controller collision, rigid bodies, ragdolls, penetration |
| `player` | `src/player/` | movement state machine, camera feel, sprint/slide/mantle/lean, health |
| `weapons` | `src/weapons/` | weapon meshes, viewmodel rig, ADS, recoil, sway, bob, reload & inspect animation, ballistics |
| `fx` | `src/fx/` | GPU particles, muzzle flash, tracers, impacts, decals, smoke, blood, shells |
| `ai` | `src/ai/` | enemy characters, navigation, perception, cover selection, combat behaviour |
| `ui` | `src/ui/` | HUD, crosshair, hitmarkers, damage indicators, ammo, killfeed, menus |
| `audio` | `src/audio/` | sampled + synthesized weapon/foley audio, spatialisation, reverb, occlusion, mix |
| `quality` | `src/core/quality.js` | per-browser graphics calibration, FPS targeting, dynamic render scale, persisted graphics mode, and the advanced per-option graphics overrides (schema in `src/core/graphics.js`) |
| `net` | `src/net/` | web multiplayer: room transport, remote player puppets, PvP hit settlement, invite bar / scoreboard, the match-start lobby on the wire |
| `match` | `src/match/` | the Match Start view: map choice, bot-garrison choice, ready-up, countdown, and when the match goes live |

Shared, owned by the lead (do not edit): `src/core/`, `src/main.js`,
`src/dev/`, `tools/`, `vite.config.js`.

## Cross-subsystem events

Emit and listen via `ctx.events`. Payloads are plain objects. The canonical set:

| event | payload | emitted by |
|---|---|---|
| `weapon:fire` | `{ weapon, origin: Vector3, dir: Vector3, seed }` | weapons |
| `weapon:reload` | `{ weapon, phase: 'start'\|'magout'\|'magin'\|'end', position? }` | weapons / ai |
| ↳ | `position` is absent for the local player's own reload — that one is head-locked by definition. An emitter that is *not* the local player must supply it: `audio` falls back to a dry, unattenuated voice without one, which would put a bot's magazine clatter in your ears from across the map. | |
| `weapon:shell` | `{ position, velocity }` | weapons / ai |
| ↳ | `position` is required, not optional. Brass defaulted to the listener would sit in `attenuation()`'s flat near field and ring at full gain; `audio` drops a payload without one instead. | |
| `bullet:impact` | `{ point, normal, surface, incident, damage }` | physics |
| `bullet:tracer` | `{ from, to, speed }` | weapons |
| `damage:dealt` | `{ target, amount, headshot, killed, point }` | ai / physics |
| ↳ | means *damage dealt **to** `target`*. `target` is the local player when an enemy round connects (`'player'`, the player system, or anything with `isPlayer === true`) — filter it out before drawing a hitmarker. Damage is applied by the target's own listener, never by the emitter as well. | |
| `damage:taken` | `{ amount, from: Vector3, health }` | player |
| `actor:death` | `{ actor, point, impulse }` | ai |
| `actor:footstep` | `{ actor, position, surface, speed, running, crouched, left }` — a bot or a remote player planted a foot | ai |
| ↳ | NOT interchangeable with `player:footstep`, which means *the local player* stepped and is what `ai` perception and `fx` dust read. Only `audio` consumes this one; anything that would react to the player moving must keep listening to `player:footstep`. `ai` gates emission on range, so an inaudible body is silent, not merely quiet. | |
| `player:spawn` | `{ position, yaw, zone }` — the local player entered the map at a spawn point chosen by `world.spawns` | player |
| `player:land` | `{ velocity, surface }` | player |
| ↳ | Local only, and `audio` plays it head-locked rather than at a position. A landing is always directly under your own head, so panning it encodes nothing and 1.6 m sits inside `attenuation()`'s flat near field — the 3D path gave it maximum gain. | |
| `player:footstep` | `{ position, surface, running }` | player |
| `player:state` | `{ stance, sprinting, sliding, ads }` | player |
| `explosion` | `{ position, radius, damage }` | any |
| `equipment:flash` | `{ position, radius, duration, source }` — a stun grenade detonated. Every listener folds in its own range / line-of-sight / facing falloff rather than trusting a pre-scaled intensity, so the player's whiteout (`ui`) and the bots' blindness (`ai`) stay consistent with each other. | weapons |
| `resize` | `{ width, height }` | engine |
| `net:lobby` | `{ connected, everConnected, live, players, myId, ready }` | net |
| `net:join` / `net:leave` | `{ id, name }` | net |
| `net:countdown` | `{ ms }` — the relay fired the pre-match start signal | net |
| `net:kill` | `{ by, victim, headshot, mine }` — a relay-confirmed PvP kill | net |
| `match:start` | `{ bots, squads, perSquad, mode, map }` — the match is live | match |
| `match:countdown` | `{ seconds }` | match |
| `world:rebuilt` | `{ mapId, map }` — the level was torn down and rebuilt on another map. Anything holding level-derived state (`ai`'s nav grid, the minimap bake) must redo it. Only ever fires before a match goes live. | world |

If you need an event that is not listed, add a row here in the same commit.

## Surface types

Shared vocabulary for impact FX, decals, audio and footsteps. Physics tags every
collider with one of: `concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`,
`water`, `foliage`, `fabric`, `flesh`, `rubber`, `plaster`.

## Maps

The level is one of the descriptors in `src/world/maps.js`, not a hard-coded
build sequence. Five ship: `market` (the Middle-Eastern street), `rust` (a
low-poly desert refinery), `wilmot` (a low-poly walled country estate), `loop`
(a low-poly Chicago corner under the elevated tracks, at night) and `fishers`
(a low-poly North Shore estate down one long pool axis). Which one boots
is `?map=` > the player's last choice > `market`; a capture run ignores the
stored choice so the pixel gate always frames the same level unless `?map=`
says otherwise.

```js
const world = ctx.get('world');
world.mapId                 // 'market' | 'rust' | 'wilmot' | 'loop' | 'fishers'
world.maps                  // [{ id, name, subtitle, blurb, size }] for menus
await world.setMap('rust')  // tear the level down and build another. Emits
                            // `world:rebuilt`. ONLY legal before a match is
                            // live — `src/match` is the only caller.
```

Adding a map means adding a module that exports a descriptor and listing it in
`MAPS`; no other subsystem changes. `node src/world/maps.selftest.mjs` builds
every map headlessly and checks the descriptor contract.

A descriptor may also carry an **`environment`** — `{ hour, weather,
exposureBias }`, the sky that map is set under. `world` hands it to
`sky.applyEnvironment()` on every build, before the pre-warm and the first
frame, so a map's time of day is a property of the map and not of whoever
loaded it. `exposureBias` is EV added to the metering compensation `sky`
already publishes for the hour (positive is darker) — how far a night frame can
be stopped down depends on how much light the level itself owns. A map without one plays under
the sky's defaults, and switching to it *restores* them, so a night map can
never leak its haze into the next level. `loop` is the one night map today
(01:30, moonlit, city haze); everything on it that emits — the marquee, the
lamps, the lit rooms, the stalled train — is dressed for that hour.

## Spawning

Nobody picks their own spawn point. `world` owns the point set and the scoring
(`src/world/spawns.js`); everyone else asks:

```js
const world = ctx.get('world');
world.selectSpawn({ team, actorId, killer, from })  // -> { position, yaw, zone }
world.spawns.selectMany(n, { team })                // deploy spread; picks repel
world.spawns.noteClaim(x, y, z)                     // a remote player is coming in here
world.spawn(0)                                      // by index — dev harnesses only
```

If your subsystem controls bodies that can be spawned on, register a source in
`init()` and drop it in `dispose()`. The director pulls it at the moment of a
spawn, so it can never be stale:

```js
this._off = world.spawns.addSource((add) => {
  for (const a of this.things) add(a.x, a.y, a.z, viewYaw, team, id, dead);
});
```

`viewYaw` is the CAMERA convention (forward is `-sin yaw, -cos yaw`). The
soldier rig faces +Z, so an `ai` agent's yaw is a half turn from it — add `π`.

Points are validated against real collision at boot and any that a standing
character does not fit in are dropped, so the count is a property of the built
level, not of the table. `SPAWN_POINTS[0]` is frozen: it is the deterministic
boot spawn every capture baseline is framed from.

## Render integration

`render` exposes these to other subsystems:

```js
const r = ctx.get('render');
r.renderer            // THREE.WebGLRenderer — do not change its state outside a frame
r.registerPass(pass)  // insert a custom post pass
r.addLight(light)     // register a punctual light so it participates in culling/budgets
r.requestEnvMap()     // PMREM env map currently in use
r.screenSize          // { width, height } of the internal render target
r.depthTexture        // linear depth, for soft particles / SSR
r.velocityTexture     // motion vectors, for TAA / motion blur
r.setRenderScale(n)   // resize targets within the active preset's scale range
r.setRenderScaleLimits(min, max)  // widen that range (manual scale goes to 2x)
r.setPixelRatioCap(n) // ceiling on devicePixelRatio for the backbuffer
r.applySettings(patch?)           // push `r.settings` at the passes caching it
r.setAmbientFill(k)   // scale every indirect term at once ("Shadow Lift")
```

The last four exist for the advanced graphics menu, which drives `r.settings`
live. Anything else that writes `r.settings` directly must call
`r.applySettings()` afterwards or the passes will not see it.

Anything drawn into `viewScene` is composited after the world with a cleared
depth buffer.

Per-object opt-outs, honoured every frame by `render._collect`:

```js
mesh.userData.owNoPrepass = true  // keep out of the depth/normal/velocity prepass
mesh.userData.owNoShadow  = true  // do not cast into the CSM cascades
```

`owNoShadow` is the ONLY shadow-caster switch: the cascades draw with
`scene.overrideMaterial` and never consult `mesh.castShadow`. `src/ai` relies on
this for its off-screen actor LOD.

### The point-light count is a shader permutation key

`r.addLight()` puts a light under distance culling, and the cull sets
`light.visible = false` once the fade reaches zero. Three bakes the number of
**visible** point lights into every material's program cache key, so one lamp
crossing its radius recompiles every lit material in the scene — measured at
+33 to +36 programs and 640-900 ms on that single frame, five times in 900
frames. Anything that registers distance-culled point lights must keep the
visible count constant. Two ways, both pixel-exact:

- drive `intensity` to 0 and leave `visible` true (what `src/fx/lights.js` does), or
- park zero-intensity "ballast" lights and top the count up to a fixed slot
  budget every `lateUpdate` (what `src/world` does for its 17 practicals — see
  `_stabiliseLightCount`, which mirrors the renderer's own fade test because the
  cull runs *after* `lateUpdate`).

A light whose colour × intensity is exactly 0 adds a float `0.0` to the
irradiance accumulator, so extra lit slots cannot move a pixel.

### Pre-warm

`src/core/prewarm.js` runs before the first frame and calls
`prewarmMaterials(ctx)` on every subsystem that implements it (`render`,
`world`, `ai`). The contract: **build and compile every material the subsystem
can produce, without spawning gameplay objects, drawing a gameplay frame, or
touching the clock/RNG.** `renderer.compileAsync(scene, camera)` alone only
reaches the forward lit variant — not the CSM depth pass, the MRT prepass, or
the post chain. Two traps:

- A render target must be bound while compiling. `outputColorSpace` and
  `toneMapping` are part of the cache key and are read off the *currently bound*
  target, so compiling with the canvas bound warms the wrong variant.
- `fx` is excluded and self-warms on frame 2: its key depends on the visible
  light count, which is only settled inside the first rendered frame.

## Quality bar

Every visual subsystem is reviewed by an adversarial critic against real CoD
frames. Non-negotiables:

The Auto-only `performance` tier is the cadence safety valve when Low cannot
meet the user's FPS target. It may reduce resolution and shadow filtering, but
must keep a valid depth/velocity prepass, registered gameplay-feedback passes,
and at least one real sun-shadow sample. Manual Low–Ultra presets retain the
full requirements below.

- **No flat/untextured surfaces.** Every material needs albedo variation, a
  normal map, roughness variation, and a detail layer visible at 0.5 m.
  **Characters are the standing exception**, deliberately and by direction:
  `src/ai/livery.js` renders them flat-shaded and untextured in one saturated
  hue per player, and `src/ai/parts.js` builds them at a fraction of the
  sections the anatomy was authored at. A player is identified by COLOUR and
  SILHOUETTE at 30 m, which a camo pattern actively works against, and that
  read is worth more than surface detail nobody resolves past 5 m. The
  first-person arms (`src/weapons/hands.js`) took the same trade first. Do not
  "fix" either back to textured without changing this line.
- **No uniform lighting.** Contact shadows, bounce, ambient occlusion, and a
  clear key/fill/rim separation.
- **Physically plausible values.** Albedo in 0.02–0.9, metals are 0 or 1,
  real-world light intensities, exposure-driven not multiplier-driven.
- **Nothing perfectly straight, clean, or repeated.** Edge wear, grime in
  crevices, subtle warp, varied instance rotation/scale.
- **Every action has weight.** Recoil, camera shake, screen-space impulse,
  audio transient, and a visual FX on every impact.
