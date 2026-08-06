import * as THREE from 'three';
import { UNITS } from '../core/config.js';
import { buildParticleAtlas, buildDecalAtlas, P, D } from './atlas.js';
import { ParticleLayer, resetSpawn, disposeQuadSource } from './particles.js';
import { DecalSystem } from './decals.js';
import { HazeSystem } from './haze.js';
import { LightPool } from './lights.js';
import { ShellSystem } from './shells.js';
import { DesignatorBeam } from './designator.js';
import { Ambience } from './ambience.js';
import { spawnImpact } from './impacts.js';
import { muzzleFlash } from './muzzle.js';
import { spawnTracer } from './tracers.js';
import { explode } from './explosions.js';
import { V, cone } from './util.js';

/**
 * FX — GPU particles, impacts, decals, muzzle flash, tracers, shells,
 * explosions, refraction and ambience.
 *
 * Everything visible here is built from two procedurally baked atlases and a
 * handful of instanced draw calls:
 *
 *   world additive particles   1 draw   sparks, flash, fire, tracers, embers
 *   world lit particles        1 draw   smoke, dust, blood, debris, splinters
 *   dust motes                 1 draw   always-on atmosphere
 *   decals                     1 draw   projected onto the physics BVH
 *   shell casings              1 draw   instanced rigid bodies
 *   refraction sprites         1 draw   + one half-res post pass
 *
 * The simulation is entirely in the vertex shader (see particles.js), so the
 * per-frame CPU cost of ten thousand live particles is six uniform writes and
 * one buffer sub-upload of whatever was spawned this frame. Budgets come from
 * `config.q.particleBudget` / `decalBudget` and are hard caps: every layer is a
 * ring, and a ring never allocates.
 */
export class FxSystem {
  static id = 'fx';
  static deps = ['render', 'materials'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.render = ctx.peek('render');
    this._physics = ctx.peek('physics');
    this._audio = ctx.peek('audio');
    this.gravity = UNITS.gravity;
    this.now = 0;

    const q = ctx.config.q;
    const budget = q.particleBudget ?? 6000;
    const big = budget >= 10000;

    const t0 = performance.now();
    const atlasSize = big ? 1024 : 512;
    const particleAtlas = buildParticleAtlas(this.rng.fork(), atlasSize);
    const decalAtlas = buildDecalAtlas(this.rng.fork(), atlasSize);
    this._atlas = particleAtlas;
    this._decalAtlas = decalAtlas;
    const bakeMs = performance.now() - t0;

    const mote = clampI(Math.round(budget * 0.06), 96, 600);
    const hazeCap = clampI(Math.round(budget * 0.04), 48, 320);
    const viewAdd = clampI(Math.round(budget * 0.03), 48, 400);
    const viewLit = clampI(Math.round(budget * 0.02), 32, 256);
    const rest = Math.max(256, budget - mote - hazeCap - viewAdd - viewLit);
    const litCap = Math.round(rest * 0.55);
    const addCap = rest - litCap;

    /** Particles spawned per impact scale with the budget. */
    this.pScale = clamp(budget / 12000, 0.4, 1.25);

    const mk = (capacity, modeName, renderOrder) =>
      new ParticleLayer({
        capacity,
        mode: modeName,
        atlas: particleAtlas.texture,
        cols: particleAtlas.cols,
        renderOrder,
      });

    this.lit = mk(litCap, 'lit', 10);
    this.add = mk(addCap, 'additive', 12);
    this.motes = mk(mote, 'additive', 9);
    this.layers = [this.lit, this.add, this.motes];
    for (const l of this.layers) ctx.scene.add(l.mesh);

    // Viewmodel-space layers. Attached at the end of init() when the game HAS a
    // viewmodel (see the pre-warm note there), and otherwise on the first
    // first-person effect — so a game with no viewmodel never gets objects in
    // viewScene and never triggers the viewmodel pass.
    this.viewAdd = mk(viewAdd, 'additive', 12);
    this.viewLit = mk(viewLit, 'lit', 10);
    this.viewAdd.uniforms.uSoftEnable.value.x = 0;
    this.viewLit.uniforms.uSoftEnable.value.x = 0;
    this._viewAttached = false;

    this.decals = new DecalSystem({
      capacity: q.decalBudget ?? 128,
      albedo: decalAtlas.albedo,
      normal: decalAtlas.normal,
      orm: decalAtlas.orm,
      cols: decalAtlas.cols,
    });
    ctx.scene.add(this.decals.mesh);

    this.hazeSys = new HazeSystem({
      capacity: hazeCap,
      atlas: particleAtlas.texture,
      cols: particleAtlas.cols,
    });
    this._hazeOff = this.render?.registerPass?.(this.hazeSys.pass) ?? null;

    this.lights = new LightPool(ctx.scene, 4);
    if (this.render?.addLight) this.lights.register(this.render);
    /** Mirrored pool inside viewScene; built with the view layers on first use. */
    this.viewLights = null;

    this.shells = new ShellSystem(this);
    ctx.scene.add(this.shells.mesh);

    // The killstreak lase (src/match/streaks.js drives it, immediate-mode).
    // Built at init rather than on first use so the pre-warm compiles its
    // materials — a laser whose first frame is also a shader compile stutters
    // at the exact moment the player is trying to hold an aim.
    this.designatorBeam = new DesignatorBeam();
    ctx.scene.add(this.designatorBeam.group);

    this.ambience = new Ambience(this, {
      motes: mote,
      shimmer: budget >= 4000,
    });

    // ---- lighting inputs (overridable by `sky` via setAmbient) ------------
    this._ambTop = new THREE.Vector3(0.42, 0.5, 0.66);
    this._ambBot = new THREE.Vector3(0.2, 0.17, 0.14);
    this._sunCol = new THREE.Vector3(1, 0.93, 0.82);
    this._sunView = new THREE.Vector3(0, 1, 0);
    this._upView = new THREE.Vector3(0, 1, 0);
    this._fog = new THREE.Vector4(0.62, 0.66, 0.72, 0);
    this._ambientOverride = false;

    // ---- scratch ---------------------------------------------------------
    this._p = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._p2 = new THREE.Vector3();
    this._d2 = new THREE.Vector3();
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._decalOpts = {
      point: this._p,
      normal: this._n,
      size: 0.15,
      tile: 0,
      roll: 0,
      life: 60,
      fade: 0.72,
      opacity: 1,
      maxAngle: 62,
      depth: 0.08,
      flip: false,
      world: null,
      mask: 0xffff,
      now: 0,
    };

    // ---- events ----------------------------------------------------------
    const on = (type, fn) => {
      const off = ctx.events.on(type, fn);
      this._off.push(off);
    };
    this._off = [];
    on('bullet:impact', (e) => this.onImpact(e));
    on('bullet:tracer', (e) => this.tracer(e.from, e.to, e.speed));
    on('weapon:fire', (e) => this.onWeaponFire(e));
    on('weapon:shell', (e) => this.spawnShell(e.position, e.velocity, e));
    on('explosion', (e) => this.explosion(e));
    on('actor:death', (e) => this.onActorDeath(e));
    on('player:land', (e) => this.onLand(e));
    on('player:footstep', (e) => this.onFootstep(e));

    // ---- dev burst script ------------------------------------------------
    this._script = [];
    this._scriptTime = 0;
    this._scriptPeriod = 0;
    this._scriptCursor = 0;

    this.stats = { spawned: 0, decals: 0, live: 0 };

    // ---- shader pre-warm -------------------------------------------------
    // MEASURED: the first trigger pull compiled 12 WebGL programs in one frame
    // (80-160 ms), and not one of them belonged to a particle. Attaching the
    // viewmodel-space layers adds this.viewLights to viewScene, which changes
    // that scene's *light count*, and three bakes the light counts into every
    // program cache key — so the whole viewmodel (weapon, gloves, optic glass,
    // lens rings) recompiled on the frame the player first shot.
    //
    // Attaching here instead means the viewmodel's programs are built once, with
    // their final light count, by the boot-time compile that already happens
    // before the first rendered frame. Nothing is spawned and both meshes stay
    // invisible, so this is pixel-neutral by construction: the two pooled lights
    // sit at intensity 0 (an exactly-zero contribution) until something flashes.
    //
    // Gated on a viewmodel already existing: `render` decides whether to run the
    // viewmodel pass at all by counting viewScene's children, and in an FX-only
    // scene (src/fx/preview.js) adding ours would turn that pass on. In that case
    // the lazy attach on first use still applies.
    this._warmTicks = 0;
    this._warmed = false;
    if (this._viewmodelPresent()) this._attachView();

    console.info(
      `[fx] atlases ${atlasSize}px in ${bakeMs.toFixed(0)}ms · particles ` +
        `lit ${litCap} add ${addCap} motes ${mote} haze ${hazeCap} · decals ${this.decals.capacity}`
    );
  }

  /* ===================================================================== */
  /*  emit helpers (bound so recipe modules can pass them around)          */
  /* ===================================================================== */

  emitAdd = (s) => this.add.emit(s, this.now);
  emitLit = (s) => this.lit.emit(s, this.now);
  emitMote = (s) => this.motes.emit(s, this.now);
  emitViewAdd = (s) => {
    this._attachView();
    return this.viewAdd.emit(s, this.now);
  };
  emitViewLit = (s) => {
    this._attachView();
    return this.viewLit.emit(s, this.now);
  };

  _attachView() {
    if (this._viewAttached) return;
    this._viewAttached = true;
    this.ctx.viewScene.add(this.viewAdd.mesh);
    this.ctx.viewScene.add(this.viewLit.mesh);
    // The viewmodel scene has its own light rig and never sees ctx.scene's
    // punctual lights, so the muzzle flash needs a mirrored pool in there or the
    // weapon is the one object in frame a flash cannot light. Two lights, added
    // once and left at zero between shots: the shader permutation count has to
    // stay constant or every weapon material recompiles mid-firefight.
    if (!this.viewLights) {
      this.viewLights = new LightPool(this.ctx.viewScene, 2);
      // NOT registered with render.addLight: that budgets/culls against world
      // positions, and these live in view space.
    }
  }

  /** Does viewScene already draw something of its own (i.e. is there a weapon)? */
  _viewmodelPresent() {
    let found = false;
    this.ctx.viewScene?.traverse((o) => {
      if (found || !o.isMesh) return;
      if (o === this.viewAdd?.mesh || o === this.viewLit?.mesh) return;
      found = true;
    });
    return found;
  }

  /* ===================================================================== */
  /*  shader pre-warm                                                      */
  /* ===================================================================== */

  /**
   * Build and compile every particle / decal / flash / refraction program
   * WITHOUT spawning anything into the world.
   *
   * Safe to call more than once and from anywhere: it spawns no particle, moves
   * no camera, touches no uniform and leaves every mesh exactly as visible as it
   * found it. All it does is ask the renderer for the programs those materials
   * will need, early, so the frame that first draws a spark is not also the frame
   * that compiles a shader.
   *
   * Two details are load-bearing, both measured:
   *
   *  1. A RENDER TARGET MUST BE BOUND. three folds `outputColorSpace` and
   *     `toneMapping` into the program cache key, and both are read off the
   *     *currently bound* target — so a compile with the canvas bound produces an
   *     `srgb` + tone-mapped program, while every FX draw actually happens inside
   *     the HDR target and needs the `srgb-linear` + NoToneMapping variant. A
   *     boot-time compile without a target bound therefore builds programs that
   *     are never used and the real ones still compile during play. A 1x1 target
   *     is enough to get the right key; nothing is rendered into it.
   *  2. THE REAL MESHES ARE COMPILED, not stand-ins. `renderer.compile` walks
   *     `scene.children` for materials and only uses `targetScene` for lights,
   *     fog and environment, so borrowing the meshes into a scratch scene (never
   *     re-parenting them — `parent` is untouched) is what guarantees the key is
   *     identical to the one the real draw will ask for, down to
   *     InstancedMesh-ness and the geometry's attribute set.
   *
   * @returns {{ok: boolean, compiled: number}}
   */
  prewarmMaterials() {
    const renderer = this.render?.renderer;
    if (!renderer) return { ok: false, compiled: 0, reason: 'no renderer' };
    const ctx = this.ctx;
    const before = renderer.info.programs?.length ?? 0;

    // Reaching the viewmodel layers means attaching them; see the note in init().
    if (!this._viewAttached && this._viewmodelPresent()) this._attachView();

    const prevRt = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace?.() ?? 0;
    const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;
    const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
    const scratch = (this._warmScene ??= new THREE.Scene());
    const compile = (meshes, camera, targetScene) => {
      scratch.children.length = 0;
      for (const m of meshes) if (m) scratch.children.push(m);
      if (!scratch.children.length) return;
      try {
        renderer.compile(scratch, camera, targetScene);
      } catch (err) {
        console.warn('[fx] prewarm compile failed', err);
      }
      scratch.children.length = 0;
    };

    try {
      renderer.setRenderTarget(rt);
      compile(
        [
          this.lit.mesh,
          this.add.mesh,
          this.motes.mesh,
          this.decals.mesh,
          this.shells.mesh,
          this.designatorBeam.beam,
          this.designatorBeam.dot,
        ],
        ctx.camera,
        ctx.scene
      );
      if (this._viewAttached) {
        compile([this.viewAdd.mesh, this.viewLit.mesh], ctx.viewCamera, ctx.viewScene);
      }
      // The refraction sprites and the warp pass live in the haze system's own
      // private scenes, which no scene-graph walk from outside can reach.
      this.hazeSys.prewarm(renderer);
    } finally {
      renderer.setRenderTarget(prevRt, prevFace, prevMip);
      rt.dispose();
    }

    this._warmed = true;
    const compiled = (renderer.info.programs?.length ?? 0) - before;
    return { ok: true, compiled };
  }

  /**
   * Flash light inside the viewmodel scene.
   *
   * Peak is derived from the renderer's viewmodel key so the kick is a fixed
   * number of stops at any time of day: ~2.6x the key at the handguard (0.3 m
   * back down the bore), which 1/d^2 turns into a blown rim at the crown and a
   * soft warm wash by the magwell. Held for 55 ms with a slow temporal decay so
   * it survives 3-4 frames — a flash that dies inside one frame is a flash the
   * player never sees.
   */
  viewFlash(x, y, z, r, g, b, strength = 1) {
    this._attachView();
    const pool = this.viewLights;
    if (!pool) return;
    const key = this.render?.viewSun?.intensity ?? 2.5;
    // 0.72 cd per unit of key puts ~19 W/m^2 on the handguard 0.3 m back down the
    // bore. That is what it takes to land the front third of the handguard and the
    // top of the hand in the L 190-235 band on the flash frame, with 1/d^2 giving
    // the warm falloff back to the magwell for free. At the old 0.26 the kick was
    // under a stop and measured as "zero warm gradient anywhere".
    const peak = Math.max(0.04, key * 0.72 * clamp(strength, 0.05, 2.2));
    // Lifted off the bore axis: a source sitting exactly on the axis rakes the
    // top of the receiver at N.L ~ 0.15 and the kick disappears. Real flash gas
    // is a ball around the crown, so 4 cm of height buys the whole top surface.
    //
    // 90 ms at decay 8, matched to the world light: a view flash that is dead
    // after one 33 ms frame is a flash the capture never photographs.
    pool.flash(x, y + 0.04, z, r, g, b, peak, 0.09, 8, 1.6, 2);
  }

  get physics() {
    if (!this._physics) this._physics = this.ctx.peek('physics');
    return this._physics;
  }

  /* ===================================================================== */
  /*  public API                                                           */
  /* ===================================================================== */

  /** Handle a `bullet:impact` payload. */
  onImpact(e) {
    if (!e || !e.point) return;
    this.now = this.ctx.time.elapsed;
    if (!e.normal) return;
    let energy = clamp(0.7 + (e.damage ?? 25) / 55, 0.7, 1.7);
    if (e.exit === true) energy *= 0.75;
    spawnImpact(this, e.point, e.normal, e.incident ?? this._defaultIncident(e), e.surface, energy);
    this.stats.spawned++;
  }

  _defaultIncident(e) {
    this._d2.set(-e.normal.x, -e.normal.y, -e.normal.z);
    return this._d2;
  }

  /** `weapon:fire` — set `e.fx === false` to suppress and drive FX yourself. */
  onWeaponFire(e) {
    if (!e || e.fx === false || !e.origin || !e.dir) return;
    this.now = this.ctx.time.elapsed;
    this._camPos.setFromMatrixPosition(this.ctx.camera.matrixWorld);
    const firstPerson = this._camPos.distanceToSquared(e.origin) < 2.25;
    this.muzzleFlash({
      position: e.origin,
      direction: e.dir,
      weapon: e.weapon,
      view: firstPerson,
      intensity: e.intensity,
      light: e.light,
      scale: e.flashScale,
    });
  }

  /**
   * Muzzle flash + barrel smoke + light + heat haze.
   * `view: true` emits into the viewmodel scene (converted through the two
   * cameras) so the flash composites over the weapon rather than under it.
   */
  muzzleFlash(o) {
    this.now = this.ctx.time.elapsed;
    let pos = o.position;
    let dir = o.direction;
    // The light always lives in the world, even when the sprites are drawn in
    // viewmodel space, because it is the world it has to illuminate.
    if (o.viewSpace) {
      // Caller handed us a point already in viewmodel space (the usual case for
      // a weapon whose muzzle is a bone in viewScene): map it back out for the
      // light and leave the sprites where they are.
      this._fromView(pos);
      this._lightPos.copy(this._p2);
      o = this._viewArg(o);
    } else {
      this._lightPos.copy(pos);
      if (o.view) {
        this._toView(pos, dir);
        pos = this._p2;
        dir = this._d2;
      }
    }
    this._flashArg.position = pos;
    this._flashArg.direction = dir;
    this._flashArg.lightPos = this._lightPos;
    this._flashArg.weapon = o.weapon;
    this._flashArg.intensity = o.intensity;
    this._flashArg.light = o.light;
    this._flashArg.scale = o.scale;
    this._flashArg.view = o.view === true || o.viewSpace === true;
    return muzzleFlash(this, this._flashArg);
  }

  _flashArg = {
    position: null,
    direction: null,
    lightPos: null,
    weapon: null,
    intensity: 1,
    light: 1,
    scale: undefined,
    view: false,
  };
  _lightPos = new THREE.Vector3();

  /** Mark an options object as already being in viewmodel space. */
  _viewArg(o) {
    this._flashArg.view = true;
    return o;
  }

  /** Viewmodel-scene point -> world space (for the punctual light). */
  _fromView(pos) {
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    cam.updateMatrixWorld();
    vcam.updateMatrixWorld();
    this._p2.copy(pos);
    vcam.worldToLocal(this._p2);
    cam.localToWorld(this._p2);
    return this._p2;
  }

  /** Convert a world-space point+dir into viewmodel-scene space. */
  _toView(pos, dir) {
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    cam.updateMatrixWorld();
    vcam.updateMatrixWorld();
    this._p2.copy(pos);
    cam.worldToLocal(this._p2);
    vcam.localToWorld(this._p2);
    this._d2.copy(dir).transformDirection(cam.matrixWorldInverse).transformDirection(vcam.matrixWorld);
    this._d2.normalize();
  }

  /**
   * Green target-designator beam (the killstreak lase). Immediate-mode: call
   * once per frame while lasing and it hides itself the frame you stop.
   * `opts.hit` marks a painted surface; `opts.progress` 0..1 is the lock.
   */
  designate(from, to, opts) {
    if (!from || !to) return;
    this.now = this.ctx.time.elapsed;
    this.designatorBeam.set(from, to, this.now, opts);
  }

  /** A travelling tracer round. */
  tracer(from, to, speed) {
    if (!from || !to) return;
    this.now = this.ctx.time.elapsed;
    spawnTracer(this, from, to, speed);
  }

  /** Full explosion: fireball, shockwave, debris, smoke column, light, scorch. */
  explosion(e) {
    this.now = this.ctx.time.elapsed;
    explode(this, e);
  }

  /** Eject a brass casing as a physics body. */
  spawnShell(position, velocity, opts) {
    if (!position) return;
    this.now = this.ctx.time.elapsed;
    this.shells.spawn(position, velocity, opts);
  }

  /**
   * Project a decal onto the static world.
   * @param {THREE.Vector3} point
   * @param {THREE.Vector3} normal
   */
  addDecal(point, normal, opts) {
    if (this._suppressDecals) return false;
    const o = this._decalOpts;
    this._p.copy(point);
    this._n.copy(normal);
    o.size = opts.size ?? 0.15;
    o.tile = opts.tile ?? 0;
    o.roll = opts.roll ?? this.rng.float() * Math.PI * 2;
    o.life = opts.life ?? 60;
    o.fade = opts.fade ?? 0.72;
    o.opacity = opts.opacity ?? 1;
    o.maxAngle = opts.maxAngle ?? 62;
    o.depth = opts.depth ?? Math.max(0.04, o.size * 0.32);
    o.flip = opts.flip ?? this.rng.float() < 0.5;
    o.now = this.now;
    const ph = this.physics;
    o.world = ph?.staticWorld ?? null;
    o.mask = ph?.MASK?.WORLD ?? 0xffff;
    if (opts.noFallback && !o.world) return false;
    const ok = this.decals.add(o);
    if (ok) this.stats.decals++;
    return ok;
  }

  /** Soot ring under an explosion. */
  scorch(x, y, z, radius) {
    const ph = this.physics;
    this._tmpA.set(x, y + 0.4, z);
    this._tmpB.set(0, -1, 0);
    let px = x;
    let py = y;
    let pz = z;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (ph?.raycast) {
      const hit = ph.raycast(this._tmpA, this._tmpB, radius * 1.5 + 1, ph.MASK.WORLD);
      if (hit?.hit) {
        px = hit.point.x;
        py = hit.point.y;
        pz = hit.point.z;
        nx = hit.normal.x;
        ny = hit.normal.y;
        nz = hit.normal.z;
      }
    }
    this._tmpA.set(px, py, pz);
    this._tmpB.set(nx, ny, nz);
    this.addDecal(this._tmpA, this._tmpB, {
      tile: D.SCORCH,
      size: radius * 1.05,
      life: 120,
      fade: 0.55,
      opacity: 0.9,
      maxAngle: 80,
      depth: radius * 0.35,
    });
  }

  /** Blood on whatever is behind the body we just hit. */
  bloodSpatterBehind(point, incident) {
    const ph = this.physics;
    if (!ph?.raycast) return;
    this._tmpA.copy(point);
    this._tmpB.copy(incident);
    const hit = ph.raycast(this._tmpA, this._tmpB, 2.6, ph.MASK.WORLD);
    if (!hit?.hit) return;
    this.addDecal(hit.point, hit.normal, {
      tile: this.rng.float() < 0.5 ? D.BLOOD_A : D.BLOOD_B,
      size: this.rng.range(0.32, 0.62),
      life: 90,
      fade: 0.8,
      opacity: this.rng.range(0.7, 1),
      maxAngle: 70,
    });
  }

  /**
   * World-space direction toward the sun, for self-shadowing a particle cluster.
   *
   * The lit-particle shader already shades each sprite, but every sub-puff of a
   * dust cloud gets the same treatment, so the cloud has no lit side. Recipes use
   * this to bias the *authored* colour of each sub-puff by which way it was
   * thrown: the ones going into the light start pale, the ones going away start
   * in their own shadow. Falls back to straight up before `sky` reports in.
   */
  sunWorld() {
    const d = this.render?.sunDir;
    const o = this._sunW ?? (this._sunW = { x: 0, y: 1, z: 0 });
    if (d) {
      o.x = d.x;
      o.y = d.y;
      o.z = d.z;
    }
    return o;
  }

  /** Refraction sprite (hot gas, shimmer). */
  haze(x, y, z, radius, grow, life, strength, tile = P.SMOKE_A) {
    this.hazeSys.emit(this.now, x, y, z, radius, grow, life, strength, tile, this.rng.float());
  }

  /** Expanding shockwave ring in the refraction buffer. */
  hazeRing(x, y, z, radius, grow, life, strength) {
    this.hazeSys.emit(this.now, x, y, z, radius, grow, life, strength, P.RING, this.rng.float());
  }

  addSmokeColumn(x, y, z, o) {
    return this.ambience.addColumn(x, y, z, o);
  }

  /** Persistent smoke source — pass `{ object }` to have it follow a prop. */
  addSmokeSource(position, o) {
    return this.ambience.addSource(position, o);
  }

  removeSmokeSource(tag) {
    this.ambience.remove(tag);
  }

  /** Let `sky` drive the values smoke and dust are lit with. */
  setAmbient(topColor, bottomColor, sunColor) {
    if (topColor) this._ambTop.set(topColor.r ?? topColor.x, topColor.g ?? topColor.y, topColor.b ?? topColor.z);
    if (bottomColor)
      this._ambBot.set(bottomColor.r ?? bottomColor.x, bottomColor.g ?? bottomColor.y, bottomColor.b ?? bottomColor.z);
    if (sunColor) this._sunCol.set(sunColor.r ?? sunColor.x, sunColor.g ?? sunColor.y, sunColor.b ?? sunColor.z);
    this._ambientOverride = true;
  }

  audioPing(x, y, z, gain) {
    const a = this._audio ?? (this._audio = this.ctx.peek('audio'));
    if (!a) return;
    this._tmpA.set(x, y, z);
    if (typeof a.playShell === 'function') a.playShell(this._tmpA, gain);
    else if (typeof a.play === 'function') a.play('shell', this._tmpA, gain);
  }

  /* ===================================================================== */
  /*  gameplay reactions                                                   */
  /* ===================================================================== */

  onActorDeath(e) {
    if (!e?.point) return;
    this.now = this.ctx.time.elapsed;
    const rng = this.rng;
    // a heavier burst of mist than a body shot, plus spatter on the ground
    this._n.set(0, 1, 0);
    for (let i = 0; i < Math.round(8 * this.pScale) + 3; i++) {
      cone(V, rng, 0, 1, 0, 1.4, 0.7);
      const s = resetSpawn();
      s.x = e.point.x; s.y = e.point.y; s.z = e.point.z;
      s.vx = V.x * rng.range(0.6, 2.4);
      s.vy = V.y * rng.range(0.4, 1.6);
      s.vz = V.z * rng.range(0.6, 2.4);
      s.tile = i % 2 ? P.MIST : P.SMOKE_A;
      s.size0 = rng.range(0.05, 0.1);
      s.size1 = rng.range(0.2, 0.4);
      s.sizeCurve = 0.5;
      s.life = rng.range(0.4, 0.8);
      s.drag = 5;
      s.gravity = -3.5;
      s.rot = rng.float() * 6.283;
      s.r0 = 0.3; s.g0 = 0.03; s.b0 = 0.026;
      s.r1 = 0.15; s.g1 = 0.015; s.b1 = 0.013;
      s.alpha = rng.range(0.4, 0.75);
      s.alphaCurve = 1.5;
      s.soft = 0.2;
      s.seed = rng.float();
      this.emitLit(s);
    }
    const ph = this.physics;
    if (ph?.groundHeight) {
      const gy = ph.groundHeight(e.point.x, e.point.z, e.point.y + 1);
      if (Number.isFinite(gy)) {
        this._tmpA.set(e.point.x, gy, e.point.z);
        this._tmpB.set(0, 1, 0);
        this.addDecal(this._tmpA, this._tmpB, {
          tile: this.rng.float() < 0.5 ? D.BLOOD_A : D.BLOOD_B,
          size: this.rng.range(0.5, 0.9),
          life: 120,
          fade: 0.85,
          maxAngle: 80,
        });
      }
    }
  }

  onLand(e) {
    const v = Math.abs(e?.velocity ?? 0);
    if (v < 3.2) return;
    this.now = this.ctx.time.elapsed;
    const rng = this.rng;
    const cam = this.ctx.camera;
    const ph = this.physics;
    const x = cam.position.x;
    const z = cam.position.z;
    let y = cam.position.y - UNITS.playerHeight + UNITS.eyeOffset;
    if (ph?.groundHeight) {
      const gy = ph.groundHeight(x, z, cam.position.y + 1);
      if (Number.isFinite(gy)) y = gy;
    }
    const strength = clamp((v - 3) / 7, 0.2, 1.3);
    for (let i = 0; i < Math.round(7 * this.pScale * strength) + 2; i++) {
      const a = rng.float() * 6.283;
      const sp = rng.range(0.7, 2.4) * strength;
      const s = resetSpawn();
      s.x = x + Math.cos(a) * 0.22;
      s.y = y + 0.03;
      s.z = z + Math.sin(a) * 0.22;
      s.vx = Math.cos(a) * sp;
      s.vy = rng.range(0.1, 0.6);
      s.vz = Math.sin(a) * sp;
      s.tile = P.DUST;
      s.size0 = rng.range(0.05, 0.1);
      s.size1 = rng.range(0.3, 0.55);
      s.sizeCurve = 0.45;
      s.life = rng.range(0.5, 1.0);
      s.drag = 3.2;
      s.gravity = -0.6;
      s.rot = rng.float() * 6.283;
      s.spin = rng.signed() * 1.2;
      s.r0 = 0.48; s.g0 = 0.44; s.b0 = 0.39;
      s.r1 = 0.4; s.g1 = 0.37; s.b1 = 0.33;
      s.alpha = rng.range(0.25, 0.5) * strength;
      s.alphaCurve = 1.6;
      s.soft = 0.3;
      s.turb = 0.05; s.turbFreq = 2;
      s.seed = rng.float();
      this.emitLit(s);
    }
  }

  onFootstep(e) {
    if (!e?.running || !e.position) return;
    if (this.rng.float() > 0.55) return;
    this.now = this.ctx.time.elapsed;
    const rng = this.rng;
    const s = resetSpawn();
    s.x = e.position.x + rng.signed() * 0.08;
    s.y = e.position.y + 0.02;
    s.z = e.position.z + rng.signed() * 0.08;
    s.vy = rng.range(0.1, 0.35);
    s.vx = rng.signed() * 0.3;
    s.vz = rng.signed() * 0.3;
    s.tile = P.DUST;
    s.size0 = 0.04;
    s.size1 = rng.range(0.18, 0.32);
    s.sizeCurve = 0.45;
    s.life = rng.range(0.4, 0.75);
    s.drag = 3.4;
    s.gravity = -0.5;
    s.rot = rng.float() * 6.283;
    s.r0 = 0.46; s.g0 = 0.42; s.b0 = 0.37;
    s.r1 = 0.4; s.g1 = 0.36; s.b1 = 0.32;
    s.alpha = rng.range(0.1, 0.22);
    s.alphaCurve = 1.7;
    s.soft = 0.25;
    s.seed = rng.float();
    this.emitLit(s);
  }

  /* ===================================================================== */
  /*  frame                                                                */
  /* ===================================================================== */

  update(dt, ctx) {
    this.now = ctx.time.elapsed;
    this._syncLighting(ctx);
    this.lights.update(dt);
    this.viewLights?.update(dt);
    this.designatorBeam.update(this.now);
    this._runScript(dt);
    this.ambience.sunFactor = this._sunFactor;
    this.ambience.update(dt, this.now, ctx.camera, ctx.scene);
  }

  lateUpdate(dt, ctx) {
    this.now = ctx.time.elapsed;
    this.shells.update(dt, this.now);
    const r = this.render;
    const depth = r?.depthTexture ?? null;
    const w = r?.screenSize?.width ?? 1920;
    const h = r?.screenSize?.height ?? 1080;
    for (const l of this.layers) {
      l.uniforms.uDepth.value = depth;
      l.uniforms.uSoftEnable.value.x = depth ? 1 : 0;
      l.uniforms.uRes.value.set(w, h);
      l.flush(this.now);
    }
    if (this._viewAttached) {
      this.viewAdd.flush(this.now);
      this.viewLit.flush(this.now);
    }
    this.decals.flush(this.now);
    this.hazeSys.update(this.now, depth, ctx.camera);
    this.stats.live = this.add.spawned + this.lit.spawned;

    // Self-scheduled pre-warm, on the second frame.
    //
    // It cannot run any earlier and be useful: the program cache key carries the
    // number of *visible* lights, and the renderer only settles that when it
    // culls punctual lights inside its first rendered frame. Compiling before
    // that (which is where `src/core/prewarm.js` would call this from) builds a
    // permutation the frame loop never asks for and the real one still compiles
    // later, on whichever frame first draws a spark or a bullet hole. One frame
    // in, the light set is the one gameplay will use.
    if (!this._warmed && ++this._warmTicks > 1) this.prewarmMaterials();
  }

  _syncLighting(ctx) {
    const r = this.render;
    const cam = ctx.camera;
    // Sun direction and colour come from whatever light the renderer decided is
    // the sun, so smoke is lit by the same key as the world.
    const sun = r?.activeSun;
    if (r?.sunDir) {
      this._sunView.copy(r.sunDir).transformDirection(cam.matrixWorldInverse).normalize();
    }
    let sunI = 4.3;
    if (sun) {
      sunI = sun.intensity;
      if (!this._ambientOverride) {
        this._sunCol.set(sun.color.r * sunI, sun.color.g * sunI, sun.color.b * sunI);
      }
    }
    this._sunFactor = clamp(sunI / 4.3, 0, 1.6);

    if (!this._ambientOverride) {
      // Clear-sky irradiance is roughly a fifth of direct sun, blue above and
      // bounced-warm below. `sky` can override this wholesale.
      const a = clamp(sunI * 0.22, 0.02, 3.0);
      this._ambTop.set(a * 0.78, a * 0.92, a * 1.25);
      this._ambBot.set(a * 0.5, a * 0.44, a * 0.38);
    }
    this._upView.set(0, 1, 0).transformDirection(cam.matrixWorldInverse).normalize();

    const fog = ctx.scene.fog;
    if (fog) {
      this._fog.set(fog.color.r, fog.color.g, fog.color.b, fog.density ?? 1 / Math.max(1, fog.far ?? 400));
    } else {
      this._fog.w = 0;
    }

    for (const l of this.layers) this._pushLighting(l);
    if (this._viewAttached) {
      // The viewmodel camera has its own basis; recompute against it.
      const vcam = this.ctx.viewCamera;
      this._pushLighting(this.viewAdd);
      this._pushLighting(this.viewLit);
      if (r?.sunDir) {
        this.viewLit.uniforms.uSunDir.value
          .copy(r.sunDir)
          .transformDirection(vcam.matrixWorldInverse)
          .normalize();
        this.viewAdd.uniforms.uSunDir.value.copy(this.viewLit.uniforms.uSunDir.value);
      }
      this.viewLit.uniforms.uUpView.value.set(0, 1, 0).transformDirection(vcam.matrixWorldInverse).normalize();
    }
  }

  _pushLighting(l) {
    l.uniforms.uSunDir.value.copy(this._sunView);
    l.uniforms.uSunCol.value.copy(this._sunCol);
    l.uniforms.uAmbTop.value.copy(this._ambTop);
    l.uniforms.uAmbBot.value.copy(this._ambBot);
    l.uniforms.uUpView.value.copy(this._upView);
    l.uniforms.uFog.value.copy(this._fog);
  }

  /* ===================================================================== */
  /*  debug staging                                                        */
  /* ===================================================================== */

  /**
   * Stage a photogenic moment for the screenshot harness.
   *
   * The capture pumps ~90 fixed frames after applying a shot, so a single burst
   * would be long gone by the time the PNG is written. Instead we run a looping
   * timeline: old hits that have left decals and hanging dust, a couple of hits
   * caught mid-expansion, and one hit two frames old with its flash and sparks
   * still hot — which is what a real combat frame looks like.
   */
  debugBurst(kind = 'wall') {
    // 'none' stops a previously staged loop. The capture harness applies shots
    // back to back in one session, so a burst staged for `impacts` would
    // otherwise still be walking rounds across a wall during every later shot.
    if (kind === 'none' || kind === 'clear' || kind === 'off') {
      this._script.length = 0;
      this._scriptCursor = 0;
      this._scriptTime = 0;
      this._scriptPeriod = 0;
      return { staged: 'none' };
    }
    this.now = this.ctx.time.elapsed;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._camPos.setFromMatrixPosition(cam.matrixWorld);
    const target = this._findTarget();
    this._script.length = 0;
    this._scriptCursor = 0;
    this._scriptTime = 0;
    this._scriptPeriod = 1.56;

    const rng = this.rng;
    const at = (t, fn) => this._script.push({ t, fn });

    if (kind === 'explosion') {
      // Two detonations per loop, half a period apart, so whenever the harness
      // presses the shutter one of them is inside its first half second —
      // fireball and shockwave rather than only the smoke afterwards.
      this._scriptPeriod = 1.1;
      const boom = (side) => {
        this._tmpA
          .copy(target.point)
          .addScaledVector(target.normal, 1.1)
          .addScaledVector(target.tangent, side * 1.6);
        this.explosion({ position: this._tmpA, radius: 3.6, damage: 120 });
      };
      at(0.02, () => boom(-1));
      at(0.56, () => boom(1));
      this._stageWallHits(at, target, 6, 0.1, 0.95);
      return { staged: 'explosion', at: target.point.toArray() };
    }

    if (kind === 'muzzle') {
      // Cyclic rate shorter than the flash lifetime: a flash is always lit.
      this._scriptPeriod = 0.44;
      for (let i = 0; i < 8; i++) {
        const t = i * 0.055;
        at(t, () => this._stageMuzzle());
        if (i % 3 === 0) at(t + 0.01, () => this._stageShell());
        if (i % 2 === 0) at(t + 0.004, () => this._stageTracer(target));
      }
      return { staged: 'muzzle' };
    }

    if (kind === 'combat' || kind === 'firefight') {
      this._scriptPeriod = 1.6;
      this._stageWallHits(at, target, 9, 0.04, 1.2);
      at(1.3, () => this._impactAt(target, rng.signed() * 0.7, rng.range(-0.2, 0.5), 'metal'));
      at(1.42, () => this._impactAt(target, rng.signed() * 0.6, rng.range(-0.2, 0.5), null));
      at(1.5, () => this._impactAt(target, rng.signed() * 0.5, rng.range(-0.1, 0.6), 'metal'));
      at(1.36, () => this._stageTracer(target));
      at(1.44, () => this._stageCrossfire());
      at(1.12, () => this._stageShell());
      at(1.34, () => this._stageShell());
      at(1.52, () => this._stageMuzzle());
      return { staged: 'combat' };
    }

    // Default: the 'impacts' shot — sustained fire walking across a wall.
    //
    // The cadence matters more than the choreography. The harness decides when
    // it presses the shutter, so rounds land every 60 ms on a 0.9 s loop: at any
    // phase the newest hit is younger than one cadence (flash and sparks still
    // hot), the ones before it are mid-expansion, and several loops' worth of
    // decals and hanging dust have already built up behind them.
    this._scriptPeriod = 0.9;
    // 50 ms cadence against a 75 ms flash: strictly shorter than the flash
    // lifetime, so there is *always* a hot impact somewhere in the frame.
    this._stageWallHits(at, target, 18, 0.0, 0.85);
    console.info(
      `[fx] burst target ${target.surface} at ${target.distance.toFixed(2)}m ` +
        `n=(${target.normal.x.toFixed(2)},${target.normal.y.toFixed(2)},${target.normal.z.toFixed(2)}) ` +
        `support=${this._targetSupport ?? -1} span=${target.spanU.toFixed(2)}x${target.spanV.toFixed(2)}`
    );
    at(0.30, () => this._stageCrossfire());
    at(0.74, () => this._stageCrossfire());
    at(0.18, () => this._stageShell());
    at(0.52, () => this._stageShell());
    return { staged: kind, at: target.point.toArray(), surface: target.surface };
  }

  _stageWallHits(at, target, count, t0, t1) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const f = i / Math.max(1, count - 1);
      const t = t0 + (t1 - t0) * f;
      // A gunner walking rounds across the wall: a broad sweep with a wobble,
      // so the group reads as aimed fire rather than a scatter plot.
      const su = Math.min(1.35, target.spanU * 0.88);
      const sv = Math.min(0.36, target.spanV * 0.7);
      const u = Math.sin(f * 3.9 + 0.4) * su + rng.signed() * su * 0.13;
      const v = Math.cos(f * 2.4) * sv + rng.signed() * sv * 0.35;
      const surf = i % 3 === 2 ? 'metal' : null;
      at(t, () => this._impactAt(target, u, v, surf));
    }
  }

  /** Fake a bullet:impact at an offset on the staged surface. */
  _impactAt(target, u, v, surfaceOverride) {
    this._p.copy(target.point).addScaledVector(target.tangent, u).addScaledVector(target.bitangent, v);
    this._n.copy(target.normal);
    if (target.world && this.physics?.raycast) {
      // Re-trace so the hit sits on the real surface (and picks up its normal
      // and material) rather than on the plane through the first hit.
      this._tmpA.copy(this._p).addScaledVector(this._n, 1.2);
      this._tmpB.copy(this._n).multiplyScalar(-1);
      const hit = this.physics.raycast(this._tmpA, this._tmpB, 2.6, this.physics.MASK.WORLD);
      if (hit?.hit) {
        this._p.copy(hit.point);
        this._n.copy(hit.normal);
      }
    }
    this._d.copy(this._n).multiplyScalar(-1);
    // give the incoming round a believable oblique angle
    this._d.x += this.rng.signed() * 0.35;
    this._d.y -= 0.18;
    this._d.z += this.rng.signed() * 0.35;
    this._d.normalize();
    this._suppressDecals = target.world === null;
    spawnImpact(this, this._p, this._n, this._d, surfaceOverride ?? target.surface, 1.15);
    this._suppressDecals = false;
  }

  /**
   * Staged muzzle flash for the capture harness.
   *
   * `view: true`, because that is the path a real trigger pull takes
   * (`onWeaponFire` sets it for anything inside 1.5 m of the eye) and it is the
   * only path that reaches `viewFlash` — i.e. the only one that lights the
   * weapon. Staging this at `view: false` meant the harness photographed a flash
   * that could not, by construction, put any warm light on the handguard.
   *
   * The crown comes from the weapon's own muzzle transform when there is a
   * weapon, so the flash is welded to the bore rather than to a hardcoded offset
   * from the eye. The offset is only the fallback for an FX-only scene.
   */
  _stageMuzzle() {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const wp = this.ctx.peek('weapons');
    let welded = false;
    if (typeof wp?.muzzleWorld === 'function') {
      wp.muzzleWorld(this._tmpA);
      welded = this._tmpA.lengthSq() > 1e-6;
    }
    if (!welded) this._tmpA.set(0.16, -0.13, -0.72).applyMatrix4(cam.matrixWorld);
    this._tmpB.set(0, 0, -1).transformDirection(cam.matrixWorld);
    this.muzzleFlash({
      position: this._tmpA,
      direction: this._tmpB,
      weapon: 'rifle',
      view: true,
    });
  }

  _stageShell() {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._tmpA.set(0.2, -0.1, -0.45).applyMatrix4(cam.matrixWorld);
    this._tmpB.set(this.rng.range(1.3, 2.1), this.rng.range(1.2, 2.0), this.rng.range(-0.4, 0.4));
    this._tmpB.applyMatrix4(cam.matrixWorld).sub(cam.position);
    this.spawnShell(this._tmpA, this._tmpB);
  }

  _stageTracer(target) {
    const cam = this.ctx.camera;
    this._tmpA.set(0.18, -0.12, -0.7).applyMatrix4(cam.matrixWorld);
    // Fire past the staged surface: a tracer that only travels three metres is
    // over in a sixtieth of a second and can never be photographed.
    this._tmpB
      .set(this.rng.range(-3, 3), this.rng.range(-0.6, 1.4), -46)
      .applyMatrix4(cam.matrixWorld);
    this.tracer(this._tmpA, this._tmpB, 250);
  }

  /** Incoming round crossing the frame — reads as a firefight, not a range. */
  _stageCrossfire() {
    const cam = this.ctx.camera;
    const rng = this.rng;
    this._tmpA.set(rng.range(-14, -9), rng.range(-1.2, 1.4), rng.range(-16, -8)).applyMatrix4(cam.matrixWorld);
    this._tmpB.set(rng.range(9, 15), rng.range(-1.4, 1.2), rng.range(-18, -9)).applyMatrix4(cam.matrixWorld);
    this.tracer(this._tmpA, this._tmpB, 280);
  }

  /** Surface name per probe hit; sized once, reused (see `_findTarget`). */
  _probeSurf = new Array(63).fill('concrete');
  _probeCount = 0;

  _findTarget() {
    const cam = this.ctx.camera;
    const t = (this._target ??= {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      bitangent: new THREE.Vector3(),
      surface: 'concrete',
      world: null,
      distance: 0,
      spanU: 3,
      spanV: 1.2,
    });
    this._camPos.setFromMatrixPosition(cam.matrixWorld);
    const ph = this.physics;
    let best = null;
    let bestDist = Infinity;
    if (ph?.raycast && ph.staticWorld?.triCount > 0) {
      // Fan of probes: prefer something in the 1.5-9 m band, which is where a
      // wall being shot at actually lives in a screenshot.
      //
      // The fan has to be *dense*. A 5x5 grid on 0.14/0.10 rad steps stepped
      // straight over the facing wall in the `impacts` framing and only ever
      // landed grazing hits on tabletops and awnings (face < 0.3), which fell
      // through to the decal-less virtual plane below — an impacts shot with no
      // bullet holes in it. 9x7 on ~0.075/0.08 rad finds it.
      // Two passes. The first records every probe hit; the second scores each one
      // by how many of the OTHERS lie on the same plane.
      //
      // Distance-and-centredness alone is not enough: as soon as the level gains
      // a lamp post or a 12 cm pillar between the camera and the wall, the fan
      // scores the pillar highest and the whole burst — the point of the shot —
      // gets walked across a sliver of geometry 20 px wide where the decals
      // cannot be read at all. Planarity support is what distinguishes "a wall"
      // from "a prop that happens to be 5 m away".
      const probes = this._probes ?? (this._probes = new Float32Array(63 * 8));
      let np = 0;
      for (let i = 0; i < 63; i++) {
        const yaw = ((i % 9) - 4) * 0.075;
        const pitch = (Math.floor(i / 9) - 3) * 0.08;
        this._tmpB.set(0, 0, -1).applyAxisAngle(_axisX, pitch).applyAxisAngle(_axisY, yaw);
        this._tmpB.transformDirection(cam.matrixWorld);
        const hit = ph.raycast(this._camPos, this._tmpB, 40, ph.MASK.WORLD);
        if (!hit?.hit) continue;
        const d = hit.distance;
        // A grazing hit on a thin prop makes a poor showcase.
        const face = -this._tmpB.dot(hit.normal);
        if (d < 1.2 || face < 0.3) continue;
        const b = np * 8;
        probes[b] = hit.point.x;
        probes[b + 1] = hit.point.y;
        probes[b + 2] = hit.point.z;
        probes[b + 3] = hit.normal.x;
        probes[b + 4] = hit.normal.y;
        probes[b + 5] = hit.normal.z;
        probes[b + 6] = d;
        probes[b + 7] = Math.abs(d - 5) + (Math.abs(yaw) + Math.abs(pitch)) * 7 + (1 - face) * 3;
        this._probeSurf[np] = hit.surface ?? 'concrete';
        np++;
      }
      this._probeCount = np;
      for (let i = 0; i < np; i++) {
        const a = i * 8;
        const nx = probes[a + 3];
        const ny = probes[a + 4];
        const nz = probes[a + 5];
        const pd = probes[a] * nx + probes[a + 1] * ny + probes[a + 2] * nz;
        let support = 0;
        for (let j = 0; j < np; j++) {
          if (j === i) continue;
          const c = j * 8;
          if (probes[c + 3] * nx + probes[c + 4] * ny + probes[c + 5] * nz < 0.96) continue;
          const off = probes[c] * nx + probes[c + 1] * ny + probes[c + 2] * nz - pd;
          if (off > -0.12 && off < 0.12) support++;
        }
        // Each co-planar neighbour is worth a metre of framing error: 6+ of them
        // (a broad face) beats a perfectly centred sliver every time.
        const score = probes[a + 7] - Math.min(support, 12) * 1.0;
        if (score < bestDist) {
          bestDist = score;
          this._targetSupport = support;
          best = best ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: '', distance: 0 };
          best.point.set(probes[a], probes[a + 1], probes[a + 2]);
          best.normal.set(nx, ny, nz);
          best.surface = this._probeSurf[i];
          best.distance = probes[a + 6];
        }
      }
    }
    // Real geometry always beats the virtual plane: decals at 20 m still read as
    // bullet holes, a burst with no decals at all does not.
    if (best && best.distance < 22) {
      t.point.copy(best.point);
      t.normal.copy(best.normal);
      t.surface = best.surface;
      t.world = ph.staticWorld;
      t.distance = best.distance;
    } else {
      // Nothing close enough to shoot: stage the burst on a virtual plane in
      // front of the camera and skip decals (there is nothing to stick to).
      this._tmpB.set(0, 0, -1).transformDirection(cam.matrixWorld);
      t.point.copy(this._camPos).addScaledVector(this._tmpB, 3.2);
      t.normal.copy(this._tmpB).multiplyScalar(-1);
      t.surface = 'concrete';
      t.world = null;
      t.distance = 3.2;
    }
    // tangent frame on the surface, biased so 'up' on the wall is world up
    this._tmpA.set(0, 1, 0);
    if (Math.abs(t.normal.y) > 0.9) this._tmpA.set(1, 0, 0);
    t.bitangent.copy(this._tmpA).addScaledVector(t.normal, -t.normal.dot(this._tmpA)).normalize();
    t.tangent.crossVectors(t.bitangent, t.normal).normalize();

    // How big is the thing we picked? Measure the co-planar probe hits in the
    // surface's own frame so the burst can be walked across whatever we found
    // rather than across a fixed 2.7 m. Sweeping 2.7 m over a 0.4 m pilaster
    // threw fifteen of eighteen rounds off it and onto whatever was behind,
    // which is how an "impacts" shot ends up with its decals scattered over the
    // far side of a market street.
    t.spanU = 0.35;
    t.spanV = 0.25;
    const pr = this._probes;
    if (pr && this._probeCount > 0 && t.world) {
      const pd = t.point.dot(t.normal);
      let uMin = 0;
      let uMax = 0;
      let vMin = 0;
      let vMax = 0;
      for (let i = 0; i < this._probeCount; i++) {
        const b = i * 8;
        if (pr[b + 3] * t.normal.x + pr[b + 4] * t.normal.y + pr[b + 5] * t.normal.z < 0.96) continue;
        const off = pr[b] * t.normal.x + pr[b + 1] * t.normal.y + pr[b + 2] * t.normal.z - pd;
        if (off < -0.12 || off > 0.12) continue;
        this._tmpA.set(pr[b], pr[b + 1], pr[b + 2]).sub(t.point);
        const u = this._tmpA.dot(t.tangent);
        const v = this._tmpA.dot(t.bitangent);
        if (u < uMin) uMin = u;
        if (u > uMax) uMax = u;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
      t.spanU = Math.max(0.35, Math.min(uMax, -uMin));
      t.spanV = Math.max(0.25, Math.min(vMax, -vMin));
    }
    return t;
  }

  _runScript(dt) {
    if (!this._script.length) return;
    const period = this._scriptPeriod;
    const prev = this._scriptTime;
    let now = prev + dt;
    if (now < period) {
      this._fire(prev, now);
    } else {
      // Fire the tail of this loop and the head of the next one, so a wrap
      // never silently swallows the events that straddle it.
      this._fire(prev, period);
      now -= period;
      this._fire(-1e-6, now);
    }
    this._scriptTime = now;
  }

  _fire(from, to) {
    const list = this._script;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.t > from && e.t <= to) e.fn();
    }
  }

  /* ===================================================================== */

  dispose() {
    for (const off of this._off ?? []) off();
    this._off = [];
    this._hazeOff?.();
    for (const l of [this.lit, this.add, this.motes, this.viewAdd, this.viewLit]) {
      l.mesh.parent?.remove(l.mesh);
      l.dispose();
    }
    this.decals.mesh.parent?.remove(this.decals.mesh);
    this.decals.dispose();
    this.shells.mesh.parent?.remove(this.shells.mesh);
    this.shells.dispose();
    this.designatorBeam.dispose();
    this.hazeSys.dispose();
    this.lights.dispose();
    this.viewLights?.dispose();
    this.viewLights = null;
    this._atlas.texture.dispose();
    this._decalAtlas.albedo.dispose();
    this._decalAtlas.normal.dispose();
    this._decalAtlas.orm.dispose();
    disposeQuadSource();
  }
}

/** Peak candela per weapon class, used when the caller only gives us a name. */
const MUZZLE_LIGHT = {
  rifle: 90,
  carbine: 78,
  smg: 60,
  pistol: 44,
  shotgun: 150,
  sniper: 130,
  lmg: 105,
  suppressed: 16,
};

function weaponKey(weapon) {
  if (!weapon) return 'rifle';
  const key = typeof weapon === 'string' ? weapon : weapon.class ?? weapon.kind ?? weapon.name ?? '';
  const k = String(key).toLowerCase();
  for (const name in MUZZLE_LIGHT) if (k.includes(name)) return name;
  return 'rifle';
}

const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clampI = (v, a, b) => Math.round(clamp(v, a, b));
