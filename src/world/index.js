import * as THREE from 'three';
import { Assembler } from './builder.js';
import { BUILDINGS, STREET, SET_PIECES, GATE } from './layout.js';
import { Rng } from '../core/rng.js';
import { SpawnDirector, buildSpawnPoints } from './spawns.js';
import { MAPS, DEFAULT_MAP_ID, getMap, isMapId, mapSummaries, resolveBootMap, saveMapPreference } from './maps.js';

/**
 * WORLD — level geometry, the modular building kit, props, set dressing and
 * static collision.
 *
 * THE MAP IS NOW A CHOICE. This system owns the machinery — the Assembler, the
 * level->world transform, spawn validation, the light budget — and a *map
 * descriptor* owns the level. Five ship today:
 *
 *   market   the ~120 m Middle-Eastern market street   (src/world/market.js)
 *   rust     a low-poly desert oil refinery            (src/world/rust.js)
 *   wilmot   a low-poly walled country estate          (src/world/wilmot.js)
 *   loop     a low-poly Chicago corner, at night       (src/world/loop.js)
 *   fishers  a low-poly estate down one pool axis      (src/world/fishers.js)
 *
 * See `src/world/maps.js` for the descriptor contract and how the boot choice
 * is resolved (`?map=` > the player's last choice > the default). Nothing is
 * loaded from disk on either map — every vertex is generated here.
 *
 * HOW IT FITS TOGETHER
 *   maps.js       the map list, the descriptor contract, the boot resolver
 *   market.js     the market's build sequence and its queries
 *   rust.js       the Rust yard: derrick, containers, sheds, spawn table
 *   layout.js     the market's map: footprints, facade programmes, set pieces
 *   util.js       geometry toolkit (chamfered boxes, wall panels with real
 *                 holes, cloth grids, catenary tubes, rocks) + vertex masks
 *   kit.js        the modular building kit (facades, windows, doors, balconies,
 *                 stairs, awnings, parapets, drainpipes, damage)
 *   buildings.js  assembles a building from a footprint + a facade programme
 *   interiors.js  furnishes rooms so an interior screenshot is worth taking
 *   props.js      the shared instanced prop library
 *   rustprops.js  the refinery's own prop library (containers, pipe, masts)
 *   wilmotprops.js the estate garden library — hedges, trees, urns, loungers;
 *                 shared by both estate maps
 *   fisherprops.js The Fisher's own: the opaque spruce, parasols, crop rows
 *   dressing.js   places the hundreds of props, cables, laundry and debris
 *   ground.js     terrain, road camber, kerbs, pavement slabs, sand drifts
 *   builder.js    the Assembler: merges statics, batches instances, authors
 *                 collision proxies, bakes the level->world transform
 *
 * PUBLIC API — `const world = ctx.get('world')`
 *   world.root                THREE.Group holding everything
 *   world.bounds              THREE.Box3 of the playable area, world space
 *   world.map                 the active map descriptor
 *   world.mapId               its id — 'market' | 'rust' | 'wilmot' | 'loop' |
 *                             'fishers' | 'nuketown' | 'bloodgulch'
 *   world.maps                [{ id, name, description, blurb, size }] for
 *                             menus — enabled maps only, in registry order
 *   world.setMap(id)          rebuild the level on another map. Awaitable, and
 *                             ONLY legal before a match goes live — see below.
 *   world.spawnPoints         [{ position:Vector3, yaw:number, tag:string }]
 *   world.spawn(i)            one of the above, by index
 *   world.spawns              the SpawnDirector (see src/world/spawns.js) —
 *                             scored, CoD-style spawn selection for players,
 *                             remote players and bots
 *   world.selectSpawn(opts)   shorthand for world.spawns.select(opts)
 *   world.groundHeight(x, z)  cheap analytic floor height (physics is exact)
 *   world.isOpen(x, z)        true where a character can stand outdoors
 *   world.stats               { staticTris, instTris, instances, drawCalls }
 *   world.prewarmMaterials()  compile every shader permutation the world can
 *                             produce, before the frame loop starts. Awaitable.
 *                             Call it from src/core/prewarm.js — see the method.
 *   world.levelToWorld(x,y,z,out) / world.worldToLevel(x,y,z,out)
 *
 * EVENTS EMITTED
 *   world:rebuilt { mapId, map }   the level was torn down and rebuilt on
 *                                  another map. Anything that cached level
 *                                  geometry — `ai`'s nav grid, the minimap's
 *                                  baked bitmap — has to redo it.
 */

/**
 * How many zero-intensity "ballast" point lights the world parks in the scene to
 * hold `numPointLights` — and therefore the shader permutation — constant. See
 * `_addBallast()`. Must be at least the worst-case number of practicals that can
 * be in range at once: a sweep of the whole playable area at three eye heights
 * puts that at 10 for the world's own lights, plus whatever `fx` keeps live.
 */
const LIGHT_SLOTS = 20;

export class WorldSystem {
  static id = 'world';
  /**
   * `sky` is a dependency because a MAP OWNS THE HOUR IT PLAYS AT: `_build`
   * hands the descriptor's `environment` to `sky.applyEnvironment` (see
   * maps.js), and that has to happen with the sky already stood up — before
   * the pre-warm compiles anything and before the first frame, not on the
   * first `update`, or a night map would boot through a frame of daylight.
   * Ordering was already sky-then-world; this makes the registry enforce it.
   */
  static deps = ['materials', 'physics', 'sky'];

  constructor(opts = {}) {
    /** Overrides the URL / stored preference. Used by headless harnesses. */
    this.requestedMap = opts.map ?? null;
  }

  async init(ctx) {
    this.ctx = ctx;
    this.maps = mapSummaries();

    this._v = new THREE.Vector3();
    this._losA = new THREE.Vector3();
    this._losB = new THREE.Vector3();
    this._capA = new THREE.Vector3();
    this._capB = new THREE.Vector3();

    this.root = new THREE.Group();
    this.root.name = 'world';
    this.root.matrixAutoUpdate = false;
    ctx.scene.add(this.root);

    this._addBallast();

    // ONE seed for the level, drawn once. `ctx.rng.fork()` is exactly
    // `new Rng(ctx.rng.u32())`, so the first build is bit-identical to what it
    // was before maps existed — and every REBUILD of a given map now produces
    // the same level, instead of a differently dressed one each time.
    this._seed = ctx.rng.u32();

    const id = resolveBootMap({
      search: typeof location !== 'undefined' ? location.search : '',
      deterministic: !!ctx.config?.deterministic,
      preferred: this.requestedMap,
    });
    this._build(id);
  }

  /* ==================================================================== */
  /* build / rebuild                                                      */
  /* ==================================================================== */

  /**
   * Tear the level down and put another one up in its place.
   *
   * ONLY LEGAL BEFORE A MATCH IS LIVE, and that is not a caveat — it is what
   * makes this cheap enough to do at all. On the Match Start screen there are
   * no bots, no deployed remote players and no ragdolls: the only things
   * holding references into the level are the physics BVH, `ai`'s nav grid and
   * the minimap's baked bitmap, and all three are rebuilt from the
   * `world:rebuilt` event. `src/match` is the only caller, and it gates on its
   * own 'setup' state.
   *
   * Awaitable: it also re-runs the shader pre-warm, because the new map can
   * introduce material permutations the boot warm never saw, and eating those
   * as 600 ms stalls on the first frame of a match is exactly what
   * `src/core/prewarm.js` exists to prevent.
   */
  async setMap(id) {
    if (!isMapId(id) || id === this.mapId) return this.mapId;
    const t0 = performance.now();
    this._teardown();
    this._build(id);
    saveMapPreference(id);
    try {
      await this.prewarmMaterials(this.ctx, { sync: true });
    } catch (err) {
      // A driver we cannot pre-warm on still has to be able to play the map.
      console.warn('[world] prewarm after map change failed', err);
    }
    this.ctx.events.emit('world:rebuilt', { mapId: this.mapId, map: this.map });
    console.info(`[world] switched to "${id}" in ${(performance.now() - t0).toFixed(0)}ms`);
    return this.mapId;
  }

  _build(id) {
    const ctx = this.ctx;
    const map = getMap(id) ?? getMap(DEFAULT_MAP_ID);
    this.map = map;
    this.mapId = map.id;

    // The sky this map is set under — The Loop plays at night, the rest under
    // the sky's own defaults. Applied before the level is assembled so the
    // lamps, the pre-warm and the first frame all see the same hour; passing a
    // map's `environment` (or null) also puts back what the last map changed.
    ctx.peek('sky')?.applyEnvironment?.(map.environment ?? null);

    // A fresh stream off the level seed, so rebuilding a map reproduces it
    // exactly and a map change never perturbs another subsystem's sequence.
    this.rng = new Rng(this._seed);
    const rng = this.rng;
    const materials = ctx.get('materials');
    const physics = ctx.peek('physics');
    const render = ctx.peek('render');

    // Weathering in the shared materials keys off the ground plane.
    materials.setGroundLevel?.(0);

    const t0 = performance.now();
    const A = new Assembler({ materials, rng, render });
    this.A = A;
    A.setTransform(map.transform.yaw, map.transform.tx, map.transform.tz);

    const built = map.build(A, rng) ?? {};
    this.buildings = built.buildings ?? [];

    this._addLights(A);

    A.finalize(this.root, physics);
    A.releaseCache();

    // -------------------------------------------------------------- queries --
    this._inv = new THREE.Matrix4().copy(A.xform).invert();
    this._buildSpawns(physics);
    const b = map.bounds;
    this.bounds = new THREE.Box3(
      new THREE.Vector3(b[0], b[1], b[2]),
      new THREE.Vector3(b[3], b[4], b[5])
    ).applyMatrix4(A.xform);
    this.stats = A.stats;

    const ms = performance.now() - t0;
    console.info(
      `[world] "${map.id}" built in ${ms.toFixed(0)}ms — ${(A.stats.staticTris / 1000).toFixed(0)}k static tris, ` +
        `${(A.stats.instTris / 1000).toFixed(0)}k instanced tris in ${A.stats.instances} instances, ` +
        `${A.stats.drawCalls} draw calls, ${(A.stats.collideTris / 1000).toFixed(1)}k collision tris`
    );
  }

  /**
   * Give back everything the current level owns.
   *
   * Order matters: physics first (the BVH holds the collision meshes the
   * Assembler is about to dispose), then the registered lights (`render`'s cull
   * list would otherwise keep them alive and keep counting them toward the
   * shader permutation), then the geometry.
   */
  _teardown() {
    const physics = this.ctx.peek('physics');
    const render = this.ctx.peek('render');
    for (const off of this._offEvents ?? []) off?.();
    this._offEvents = null;
    // `player`, `ai` and `net` register a spawn source once, at init. Hand the
    // list — and the per-client salt `net` set from its peer id — to whichever
    // director comes next, or every spawn on the new map scores against an
    // empty room.
    this._carry = this.spawns
      ? { sources: this.spawns.sources, salt: this.spawns.salt }
      : this._carry;
    this.spawns = null;
    this.spawnPoints = [];

    if (physics) {
      for (const h of this.A?.handles ?? []) physics.removeStatic(h);
      physics.rebuildStatic();
    }
    for (const { light } of this.A?.lights ?? []) {
      render?.removeLight?.(light);
      light.parent?.remove(light);
    }
    this.A?.collisionRoot?.parent?.remove(this.A.collisionRoot);
    this.A?.dispose();
    this.A = null;
    this.bulbs = null;
    this.lamps = null;
    this.lampLens = null;

    // The ballast pool survives (it belongs to the system, not to the level),
    // but the scan of everybody else's point lights is stale and the adopted
    // target has to fall back to the budget or a busy map raises it forever.
    this._pointLightsFrame = -1e9;
    this._pointLights.length = 0;
    this._lightTarget = LIGHT_SLOTS;
  }

  // ----------------------------------------------------------------- spawns --
  /**
   * Validate the authored spawn table against real collision and stand up the
   * spawn director.
   *
   * Validation matters because levels are *dressed procedurally*: a spawn
   * authored on clear pavement can end up inside a crate the debris pass
   * happened to drop there. Every point therefore gets the floor height that
   * collision actually reports and a standing-capsule clearance test, and a
   * point that fails is dropped with a reason in the boot log.
   *
   * Index 0 is exempt — it is the frozen boot/capture spawn.
   */
  _buildSpawns(physics) {
    const A = this.A;

    // The clearance capsule is the TORSO, not the whole body: the character
    // controller steps over anything up to 0.42 m, so a kerb or a brick under
    // a spawn is not a reason to throw the point away — a crate at chest
    // height is.
    const R = 0.34; // a shade wider than the player capsule: spawns want room
    this.spawnPoints = buildSpawnPoints(this.map.spawnPoints, {
      toWorld: (x, y, z) => A.toWorld(x, y, z),
      standable: this.map.standable,
      groundY: physics ? (x, z, fromY) => physics.groundHeight(x, z, fromY) : null,
      clear: physics
        ? (x, y, z) =>
          physics.checkCapsule(
            this._capA.set(x, y + 0.5, z),
            this._capB.set(x, y + 1.72, z),
            R,
            physics.MASK.CHARACTER
          )
        : null,
      log: (m) => console.info(m),
    });
    // Authored yaws are LEVEL space; the level is rotated into the world.
    for (const p of this.spawnPoints) p.yaw += this.map.transform.yaw;

    this.spawns = new SpawnDirector({
      points: this.spawnPoints,
      // The director never draws from an RNG (a spawn must not perturb any
      // other subsystem's stream, and capture runs must stay reproducible), so
      // its variety comes from this salt. One draw from the world's own fork,
      // taken after the level is built and that fork is finished with, so it
      // cannot move a pixel: fixed under `deterministic`, different every
      // session otherwise. `net` overrides it with the peer id in a room.
      salt: this._carry ? this._carry.salt : this.rng.u32(),
      sources: this._carry?.sources ?? null,
      los: physics
        ? (ax, ay, az, bx, by, bz) =>
          physics.lineOfSight(
            this._losA.set(ax, ay, az),
            this._losB.set(bx, by, bz),
            physics.MASK.SIGHT
          )
        : null,
    });
    // Every death poisons the ground it happened on for a few seconds — the
    // rule that stops a room settling into a spawn loop. `world` subscribes
    // rather than each shooter reporting: a death is a death whoever caused it.
    this._offEvents = [];
    const on = (t, fn) => this._offEvents.push(this.ctx.events.on(t, fn));
    on('actor:death', (e) => {
      const p = e?.point ?? e?.actor?.position;
      if (p) this.spawns.noteDeath(p.x, p.y, p.z);
    });
    on('player:death', (e) => {
      const p = e?.position;
      if (p) this.spawns.noteDeath(p.x, p.y, p.z);
    });

    const zones = [...this.spawns.zones.values()].map((z) => `${z.name}:${z.points.length}`);
    console.info(
      `[world] ${this.spawnPoints.length} spawn points in ${this.spawns.zones.size} zones — ${zones.join(' ')}`
    );
  }

  // ----------------------------------------------------------------- lights --
  /**
   * Punctual lights the world owns: the bare bulbs inside the enterable
   * buildings (what makes an interior read as lived-in against cool skylight)
   * and the street lamps — flood masts, on Rust — which only draw power after
   * dusk. Both lists are filled by the map's own build pass.
   */
  _addLights(A) {
    this.bulbs = [];
    this.lamps = [];

    for (const b of A.interiorLights.slice(0, 20)) {
      // A bare 60 W bulb in an unlit room: the only thing separating an interior
      // from a black hole, so it has to actually carry the room.
      // Intensity is re-driven every update() off the solar altitude; this is
      // the daylight value so a frame captured before the first update is right.
      const l = new THREE.PointLight(0xffc07a, 5, 13, 2);
      l.position.set(b.x, b.y, b.z);
      l.castShadow = false;
      A.light(l, { range: 13, priority: 2 });
      this.bulbs.push(l);
    }

    for (const p of A.lampAnchors) {
      const l = new THREE.PointLight(0xffb765, 0, 22, 2);
      l.position.set(p.x, p.y - 0.12, p.z);
      l.castShadow = false;
      A.light(l, { range: 22, priority: 3 });
      this.lamps.push(l);
    }
    this.lampLens = A.mat('lamp_lens');
    this._lampMix = -1;
  }

  /**
   * BALLAST — hold the scene's point-light COUNT constant.
   *
   * MEASURED, not guessed. The single worst source of stalls in this build was
   * not geometry: it was shader compilation triggered by the world's own
   * practicals. `render` distance-culls every registered punctual light
   * (`light.visible = fade > 0.002`), and Three bakes the number of *visible*
   * point lights into the program cache key. The world owns 17 practicals (12
   * interior bulbs at 13 m, 5 street lamps at 22 m), so walking down the street
   * sweeps the visible count through 9-8-7-6-5-4 — and every single step
   * recompiles EVERY lit material in the frame:
   *
   *   f15 +36 programs  636 ms   f32 +35  702 ms   f41 +35  699 ms
   *   f51 +35 programs  678 ms   f99 +33  698 ms
   *   → 186 programs and ~3.5 s of stalls inside 900 frames of play
   *
   * Pre-compiling every count instead costs 9.5 s of boot (measured: 595
   * programs for counts 0-16), which is the wrong trade. Holding the count
   * still costs nothing.
   *
   * These lights are black (`color 0x000000`, `intensity 0`) with a 1 cm range,
   * parked under the map, and are NOT registered with `render.addLight`, so
   * nothing culls or re-lights them. A point light whose colour times intensity
   * is exactly 0 contributes `0.0` to irradiance — not "almost nothing", but a
   * float zero that is added to the accumulator — so this cannot move a pixel
   * no matter how many slots are lit. It only changes `numPointLights`, which
   * is a shader-permutation input and nothing else.
   *
   * Cost of the padding, measured over 3 paired runs at 1512x982 DPR 2 with 20
   * ballast slots live: p05 frame time 15.7 ms -> 14.4 ms (i.e. inside noise).
   *
   * The pool belongs to the SYSTEM, not to the level: a map change tears the
   * level's practicals down and puts new ones up, and holding the permutation
   * still across that swap is the whole point.
   */
  _addBallast() {
    this._ballast = [];
    for (let i = 0; i < LIGHT_SLOTS + 4; i++) {
      const l = new THREE.PointLight(0x000000, 0, 0.01, 2);
      l.name = `world_light_ballast_${i}`;
      l.castShadow = false;
      l.visible = false;
      l.userData.owBallast = true;
      // Far under the terrain, so even the distance-attenuation term is 0.
      l.position.set(0, -1000, 0);
      this.root.add(l);
      this._ballast.push(l);
    }
    /** Point lights in the scene that are NOT ballast; refreshed periodically. */
    this._pointLights = [];
    this._pointLightsFrame = -1e9;
    this._lightTarget = LIGHT_SLOTS;
    this._lightRanges = new Map(); // light -> the cull radius `render` gave it
    this._camPos = new THREE.Vector3();
    this._collectPointLight = (o) => {
      if (o.isPointLight === true && o.userData.owBallast !== true) this._pointLights.push(o);
    };
  }

  /**
   * Top the visible point-light count up to a fixed target. Runs in lateUpdate,
   * after every subsystem has finished moving lights and the camera, and before
   * `render` draws — so the count Three sees is the same every frame.
   *
   * The count has to be PREDICTED rather than read off `light.visible`, because
   * `render._cullLights()` runs inside `render.render()` — i.e. after this. Using
   * last frame's flags is right on 99% of frames and off by one on exactly the
   * frames where a light crosses its cull radius, which are exactly the frames
   * that used to stall. So mirror the renderer's own test here. Getting the
   * prediction wrong can only cost a permutation, never a pixel: the ballast
   * lights are black, and a black light is a no-op however many are lit.
   */
  _stabiliseLightCount(ctx) {
    const list = this._pointLights;
    if (!list) return;
    const render = this._render ?? (this._render = ctx.peek('render'));
    // The set of point lights in the scene only changes when a subsystem builds
    // or frees a pool, so rescanning every frame is pure waste. Every 90 frames
    // is often enough to catch a pool that appears after boot.
    if (ctx.time.frame - this._pointLightsFrame >= 90) {
      this._pointLightsFrame = ctx.time.frame;
      list.length = 0;
      ctx.scene.traverse(this._collectPointLight);
      this._lightRanges.clear();
      for (const e of render?.lights ?? []) {
        if (e.light?.isPointLight === true) this._lightRanges.set(e.light, e.range);
      }
    }

    ctx.camera.getWorldPosition(this._camPos);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const range = this._lightRanges.get(l);
      if (range === undefined) {
        // Not registered for distance culling: its owner drives `visible`.
        if (l.visible === true) n++;
        continue;
      }
      // The renderer's test, verbatim: fade = 1 - smoothstep(d, .75r, 1.15r),
      // light.visible = fade > 0.002.
      const d = l.position.distanceTo(this._camPos);
      if (1 - THREE.MathUtils.smoothstep(d, range * 0.75, range * 1.15) > 0.002) n++;
    }

    // A subsystem can always out-run the pool; adopting the higher count costs
    // one compile, once, instead of one per crossing.
    if (n > this._lightTarget) this._lightTarget = n;
    const want = this._lightTarget - n;
    const pool = this._ballast;
    for (let i = 0; i < pool.length; i++) {
      const v = i < want;
      if (pool[i].visible !== v) pool[i].visible = v;
    }
  }

  // ---------------------------------------------------------------- runtime --
  update(dt, ctx) {
    // Distance LOD for the scatter clouds: one bounding-sphere test per batch.
    this.A?.updateLod(ctx.camera);

    // Spawn memory (recent deaths, spawn cooldowns, remote claims) decays on
    // wall time, not on when somebody next asks for a spawn.
    this.spawns?.update(dt);

    // Street lamps come on as the sun goes down, driven by the sky's real solar
    // altitude rather than a timer, so it is right at any time of day.
    const sky = this._sky ?? (this._sky = ctx.peek('sky'));
    const alt = sky?.sunAltitude ?? 0.6;
    const mix = 1 - Math.min(1, Math.max(0, (alt + 0.05) / 0.16));
    if (Math.abs(mix - this._lampMix) > 0.01) {
      this._lampMix = mix;
      for (let i = 0; i < this.lamps.length; i++) this.lamps[i].intensity = 14 * mix;
      if (this.lampLens) this.lampLens.emissiveIntensity = 9 * mix;
      // Bulbs stay on around the clock — but a 60 W bulb is NOT competitive with
      // daylight, and running it at night strength at noon is what made every
      // interior read as pure tungsten (B-R -93) and sit level with the sunlit
      // street instead of 1.5-2.5 stops under it. Gate the bulb on solar
      // altitude: a weak practical by day, the room's only light after dark.
      for (let i = 0; i < this.bulbs.length; i++) this.bulbs[i].intensity = 5 + 17 * mix;
    }
  }

  lateUpdate(dt, ctx) {
    this._stabiliseLightCount(ctx);
  }

  // --------------------------------------------------------------- pre-warm --
  /**
   * Compile every shader permutation the world can produce, before the frame
   * loop starts. See `src/core/prewarm.js` — that module asks each subsystem for
   * exactly this hook, because `renderer.compileAsync(scene, camera)` alone
   * reaches only the forward lit variant of a material, not the two override
   * passes the world's geometry also goes through every frame:
   *
   *   - the CSM cascades render the whole scene with `csm.depthMaterial`
   *   - the prepass renders it again with the gbuffer's ShaderMaterial
   *
   * Both are separate programs, and each one has its own permutations for plain
   * geometry, instanced geometry and instanced geometry with an instanceColor —
   * which is precisely the mix the world puts in front of them.
   *
   * Pixel-neutral by construction: it compiles, it does not draw. The only
   * mutations are `scene.overrideMaterial` and the ballast light visibility,
   * both restored in the `finally`.
   *
   * `sync` is the MID-SESSION variant, used by `setMap`. The override passes
   * park a material on `scene.overrideMaterial` while they compile, and at boot
   * that is safe because no frame has run yet. Once the loop is turning, an
   * `await` between setting and restoring it hands the renderer a frame drawn
   * entirely in the CSM depth material — one flash frame of solid grey. So a
   * mid-session warm compiles synchronously: the whole thing runs inside one
   * task, nothing can interleave, and the longer hitch is spent behind the
   * menu's own "Loading…" state.
   */
  async prewarmMaterials(ctx = this.ctx, { sync = false } = {}) {
    const render = ctx.peek?.('render') ?? ctx.get?.('render');
    const renderer = render?.renderer;
    if (!renderer) return { ok: false, reason: 'no renderer' };
    const scene = ctx.scene;
    const camera = ctx.camera;
    const before = renderer.info.programs?.length ?? 0;
    const t0 = performance.now();

    // Every lit material must carry render's CSM/AO/SSR injection before it is
    // compiled, or the program we warm is not the program the frame will use.
    render.patchMaterials?.(this.root);

    // Compile at the count the frame loop will actually run at, not at whatever
    // the distance cull happens to have left visible during boot.
    this._stabiliseLightCount(ctx);

    const overrides = [render.csm?.depthMaterial, render.gbuffer?.material].filter(Boolean);
    const prevOverride = scene.overrideMaterial;
    try {
      if (sync) {
        this._compileSync(renderer, scene, camera);
        for (const over of overrides) {
          scene.overrideMaterial = over;
          this._compileSync(renderer, scene, camera);
        }
      } else {
        // 1. forward lit pass.
        await this._compile(renderer, scene, camera);
        // 2. the shadow cascades and 3. the depth/normal/velocity prepass, both
        //    of which draw this same geometry through an override material.
        for (const over of overrides) {
          scene.overrideMaterial = over;
          await this._compile(renderer, scene, camera);
        }
      }
    } finally {
      scene.overrideMaterial = prevOverride;
    }

    return {
      ok: true,
      ms: Math.round(performance.now() - t0),
      compiled: (renderer.info.programs?.length ?? 0) - before,
      lightTarget: this._lightTarget,
    };
  }

  async _compile(renderer, scene, camera) {
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      this._compileSync(renderer, scene, camera);
    }
  }

  _compileSync(renderer, scene, camera) {
    try {
      renderer.compile(scene, camera);
    } catch {
      /* a driver we cannot pre-warm on; boot must still proceed */
    }
  }

  // ---------------------------------------------------------------- queries --
  spawn(i = 0) {
    const n = this.spawnPoints.length;
    if (!n) return null;
    return this.spawnPoints[((i % n) + n) % n];
  }

  /**
   * Pick a spawn point the way a shooter should: scored against every living
   * actor rather than drawn out of a hat. See src/world/spawns.js for the
   * options and the reasoning.
   */
  selectSpawn(opts = {}) {
    return this.spawns?.select(opts) ?? this.spawn(0);
  }

  levelToWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.A.xform);
  }

  worldToLevel(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this._inv);
  }

  /** Analytic floor height. Physics owns the exact answer; this is a hint. */
  groundHeight(x, z) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return this.map.groundY(p.x, p.z);
  }

  /** True where a character can stand outdoors (street, pavement, alley). */
  isOpen(x, z, margin = 0.4) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return this.map.isOpen(p.x, p.z, margin);
  }

  dispose() {
    this._teardown();
    this.root?.parent?.remove(this.root);
    for (const l of this._ballast ?? []) l.parent?.remove(l);
    this._ballast = null;
    this._pointLights = null;
  }
}

export { BUILDINGS, STREET, SET_PIECES, GATE, MAPS, DEFAULT_MAP_ID };
