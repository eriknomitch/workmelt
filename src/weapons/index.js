import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { WeaponMaterials, ENV_OCCLUSION } from './materials.js';
import { Viewmodel } from './viewmodel.js';
import { ProjectileSim, rangeFalloff } from './ballistics.js';
import { WEAPON_DEFS, buildRecoilPattern, SPREAD_MODS, HIT_ZONES } from './defs.js';
import { buildRifle } from './models/rifle.js';
import { buildSmg } from './models/smg.js';
import { buildPistol } from './models/pistol.js';
import { buildSniper } from './models/sniper.js';
import { Throwables } from './throwables.js';
import { clamp, clamp01, lerp, damp, DEG } from './mathx.js';

/**
 * THE LOADOUT — every weapon every player carries, in slot order.
 *
 * There is no per-player loadout editor and deliberately so: this is an arena
 * shooter where both sides start identical, and the only asymmetry is which
 * weapon you chose to be holding when the corner came. Everyone spawns with all
 * four, bound to 1-4 (Tab and the mouse wheel cycle them), so a remote player is
 * carrying exactly what you are — `net` replicates the weapon id on a hit so the
 * killfeed and the muzzle-flash class agree with what actually shot you.
 *
 * The order is the draw order and the escalation order: rate of fire, then
 * reach, then a sidearm, then the thing that ends an exchange in one round.
 */
export const LOADOUT = ['rifle', 'smg', 'pistol', 'sniper'];

/** Slot binds, in `LOADOUT` order. */
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

/**
 * WEAPONS — weapon meshes, the first-person viewmodel rig, ADS, recoil, sway,
 * bob, reload/inspect animation and projectile ballistics.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT LIVES HERE
 *   geometry.js   hard-surface kit: chamfered boxes, lathes, extrusions,
 *                 Picatinny rail, M-LOK, knurling, screws, and the Assembly
 *                 that merges everything down to a handful of draw calls.
 *   parts.js      real firearm components built from published dimensions:
 *                 receivers, barrels, muzzle devices, handguards, stocks,
 *                 grips, magazines, optics, iron sights, triggers.
 *   models/*.js   the three weapons assembled from those parts.
 *   hands.js      gloved hands + sleeved arms, two-bone IK from the hand.
 *   viewmodel.js  the animation stack (sway/bob/lag/recoil/ADS/clips).
 *   clips.js      keyframed reload / inspect / draw timelines.
 *   ballistics.js travelling projectiles with gravity and drag.
 *   throwables.js lethal / tactical equipment: cook, arc preview, throw, fuse.
 *   defs.js       every tuning number, plus the deterministic recoil patterns.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API — `const wp = ctx.get('weapons')`
 * ────────────────────────────────────────────────────────────────────────────
 *   wp.current            { id, label, class, mode, magSize, ... } (the def)
 *   wp.ammo               { mag, chambered, reserve, magSize, total, empty }
 *   wp.fireMode           'auto' | 'burst' | 'semi'
 *   wp.spreadDegrees      live cone half-angle — drive the crosshair gap with it
 *   wp.adsProgress        0..1
 *   wp.reloading / wp.firing / wp.switching / wp.inspecting
 *   wp.weaponIds          ['rifle','smg','pistol','sniper']  (= LOADOUT)
 *   wp.damageAt(d, zone)  what one round would do at `d` metres — `net` settles
 *                         PvP hits with it so both damage models agree
 *   wp.setWeapon(id)      draw/holster animated swap
 *   wp.nextWeapon()
 *   wp.cycleFireMode()
 *   wp.reload()           no-op if full or empty of reserve
 *   wp.inspect()
 *   wp.tryFire()          honours fire mode + rpm; returns true if a shot left
 *   wp.viewmodel          the rig (fx/ui may read muzzle/eject transforms)
 *   wp.muzzleWorld(v3)    world-space muzzle, for anything that needs it
 *   wp.debugPose(kind)    'idle' | 'ads' | 'fire'  (the capture harness)
 *   wp.stats              { tris, drawCalls, live, fired }
 *   wp.throwables         equipment: `.counts`, `.cooking`, beginCook/release
 *
 * LOADOUT — 1/2/3/4 select, Tab and the wheel cycle. Every player carries all
 * four; see the `LOADOUT` note below and the balance contract in defs.js.
 *
 * EQUIPMENT — hold `grenade` (G) or `tactical` (H) to cook, release to throw.
 * The cook burns the real fuse, so a held frag air-bursts and a held-too-long
 * one kills the thrower. See throwables.js.
 *
 * EVENTS EMITTED  (all canonical, see ARCHITECTURE.md)
 *   weapon:fire    { weapon, origin, dir, seed }
 *   weapon:shell   { position, velocity }
 *   weapon:reload  { weapon, phase: 'start'|'magout'|'magin'|'end' }
 *                  No position: this is the player's own reload, and `audio`
 *                  reads a missing position as "head-locked". `ai` must send one.
 *   bullet:tracer  { from, to, speed }
 *   explosion      { position, radius, damage }   frag detonation
 *   equipment:flash{ position, radius, duration } stun detonation
 * `bullet:impact` comes from physics, because physics owns penetration.
 * Anything else (ammo counts, fire mode, the current weapon) is a getter on
 * this object rather than an event, so no new event types are introduced.
 */
export class WeaponSystem {
  static id = 'weapons';
  static deps = ['materials', 'physics'];

  constructor() {
    this.viewmodel = null;
    this.sim = null;
    this.states = new Map();
    this.activeId = 'rifle';
    this.debugMode = null;

    this._fireTimer = 0;
    this._burstLeft = 0;
    this._burstCooldown = 0;
    this._semiLatch = false;
    this._spread = 0;
    this._shotIndex = 0;
    this._sinceShot = 10;
    this._switchTimer = 0;
    this._switchTo = null;
    this._reloadPhase = null;

    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._firePayload = { weapon: null, origin: new THREE.Vector3(), dir: new THREE.Vector3(), seed: 0 };
    this._reloadPayload = { weapon: null, phase: 'start' };
    // `weapon:shell` carries the canonical { position, velocity } plus the real
    // case dimensions and a spin, so fx can size and tumble the brass instead of
    // guessing: a 9x19 case is less than half the length of a 5.56x45 one.
    this._shellPayload = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      weapon: null,
      caseLen: 0.0446,
      caseRadius: 0.00495,
      spin: 0,
    };
    this._pendingShots = 0;
    this._pendingFirst = false;

    // Deferred shell ejections (a case leaves the port a few ms after the shot).
    this._shellQueue = [];
    for (let i = 0; i < 8; i++) {
      this._shellQueue.push({ t: -1, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    }
    this._droppedMags = [];
    this._state = {
      ads: false,
      sprint: false,
      lowReady: false,
      speed: 0,
      crouch: false,
      airborne: false,
      trigger: false,
      empty: false,
    };
    // Preallocated HUD snapshot handed to `ui` (see getHudState).
    this._hudState = {
      name: '', mode: 'auto', ammo: 0, reserve: 0, magSize: 0,
      reloading: false, reloadProgress: 0, ads: false, spread: 0, firing: false,
      lethalCount: 0, tacticalCount: 0,
    };

    /** Lethal / tactical equipment — see throwables.js. */
    this.throwables = null;
  }

  /* ====================================================================== */
  /*  init                                                                  */
  /* ====================================================================== */

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.mats = new WeaponMaterials(ctx);
    this.sim = new ProjectileSim(ctx);
    this.viewmodel = new Viewmodel(ctx, this.mats);
    // three only honours `material.envMapIntensity` when the material carries its
    // OWN `envMap`; for a material lit by `scene.environment` the renderer
    // overwrites that uniform with `scene.environmentIntensity` every frame
    // (WebGLRenderer.setProgram, the isMeshStandardMaterial branch). The
    // viewmodel is drawn from its own scene, so ENV_OCCLUSION — how much of the
    // sky a shouldered weapon actually sees, see materials.js — has to be
    // expressed there or it is silently a no-op.
    ctx.viewScene.environmentIntensity = ENV_OCCLUSION;
    this.throwables = new Throwables(ctx, this);
    this.viewmodel.onClipEvent = (name, clip) => this._onClipEvent(name, clip);

    const t0 = performance.now();
    const builders = { rifle: buildRifle, smg: buildSmg, pistol: buildPistol, sniper: buildSniper };
    let tris = 0;
    for (const id of LOADOUT) {
      const def = { ...WEAPON_DEFS[id] };
      def.cycleTime = 60 / def.rpm;
      const model = builders[id]();
      const entry = this.viewmodel.addWeapon(model, def);
      tris += entry.tris;
      this.states.set(id, {
        def,
        pattern: buildRecoilPattern(def, Rng),
        mag: def.magSize,
        chambered: true,
        reserve: def.reserve,
        mode: def.modes[0],
        modeIndex: 0,
      });
    }
    this.viewmodel.setActive(this.activeId);
    this.viewmodel.play('draw');

    // Player hooks (all optional: the viewmodel works standalone).
    this.player = ctx.peek('player');
    this.fx = ctx.peek('fx');
    this.physics = ctx.peek('physics');
    this._off = [];
    this._off.push(
      ctx.events.on('player:land', (e) => this.viewmodel.land(Math.abs(e?.velocity ?? 3)))
    );
    this._off.push(ctx.events.on('player:jump', () => this.viewmodel.jump()));
    // Equipment needs physics resolved, so it initialises after the peeks above.
    // A fresh life restocks it — a cooked grenade must not carry over a respawn.
    this.throwables.init();
    this._off.push(ctx.events.on('player:spawn', () => this.throwables.refill()));

    this.stats = { tris, drawCalls: 0, live: 0, fired: 0 };
    console.info(
      `[weapons] ${this.states.size} weapons · ${(tris / 1000).toFixed(1)}k tris viewmodel · ` +
        `built in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /* ====================================================================== */
  /*  public getters                                                        */
  /* ====================================================================== */

  get state() {
    return this.states.get(this.activeId);
  }

  get current() {
    return this.state?.def ?? null;
  }

  get weaponIds() {
    return [...this.states.keys()];
  }

  get ammo() {
    const s = this.state;
    if (!s) return { mag: 0, chambered: false, reserve: 0, magSize: 0, total: 0, empty: true };
    const mag = s.mag;
    const ch = s.chambered ? 1 : 0;
    return {
      mag: mag + ch,
      inMag: mag,
      chambered: s.chambered,
      reserve: s.reserve,
      magSize: s.def.magSize,
      total: mag + ch + s.reserve,
      empty: mag + ch === 0,
    };
  }

  get fireMode() {
    return this.state?.mode ?? 'semi';
  }

  get adsProgress() {
    return this.viewmodel?.adsT ?? 0;
  }

  get reloading() {
    const n = this.viewmodel?.clipName;
    return n === 'reloadTac' || n === 'reloadEmpty';
  }

  get inspecting() {
    return this.viewmodel?.clipName === 'inspect';
  }

  get switching() {
    return this._switchTo !== null;
  }

  get firing() {
    return this._sinceShot < 0.12;
  }

  /** Current spread cone half-angle in degrees — the crosshair should use this. */
  get spreadDegrees() {
    return this._spread;
  }

  muzzleWorld(out) {
    return this.viewmodel.muzzleWorld(out ?? this._tmp);
  }

  /**
   * What one round of a weapon does at `distance` metres to `zone`.
   *
   * The bullet path never calls this: a round fired at a bot is a real
   * projectile, and `physics` scales it by the collider it hits. This is for
   * everything that has to know the answer WITHOUT firing — `net`, which settles
   * a PvP hit against a remote puppet it raycast itself, and the balance
   * self-test. Keeping it here rather than reimplementing the sums in `net` is
   * what stops the two damage models drifting apart, which is exactly what had
   * happened: PvP was running a hardcoded "1 % per metre past 30 m, floor 55 %"
   * ramp and a flat x2 headshot against the x4 every bot takes.
   *
   * @param {number} distance metres from the muzzle
   * @param {string} [zone]   key in HIT_ZONES ('head' | 'torso' | 'limb' | ...)
   * @param {object} [def]    a weapon def; defaults to the one in hand
   */
  damageAt(distance, zone = 'torso', def = this.current) {
    if (!def) return 0;
    const falloff = rangeFalloff(
      distance,
      def.falloffStart ?? 0,
      def.falloffEnd ?? def.maxRange ?? 400,
      def.dropoff ?? 1
    );
    return def.damage * falloff * (HIT_ZONES[zone] ?? 1);
  }

  /**
   * HUD adapter polled by `ui` every lateUpdate. Shape is fixed by the contract
   * documented at the top of src/ui/index.js; the object is preallocated and
   * mutated in place because `ui` reads it once per frame and never keeps it.
   */
  getHudState() {
    const h = this._hudState;
    const s = this.state;
    if (!s) return h;
    const a = this.ammo;
    const vm = this.viewmodel;
    h.name = s.def.label ?? s.def.id;
    h.mode = s.mode;
    // `a.mag` counts the chambered round, so a topped-off rifle is 31. The HUD
    // draws one pip per round against magSize, so clamp the *display* to the
    // magazine capacity rather than overflowing the pip strip.
    h.ammo = Math.min(a.mag, a.magSize);
    h.reserve = a.reserve;
    h.magSize = a.magSize;
    h.reloading = this.reloading;
    // 0..1 through the active reload clip; the bar is meaningless otherwise.
    h.reloadProgress = h.reloading && vm?.clip?.duration
      ? Math.min(1, vm.clipT / vm.clip.duration)
      : 0;
    h.ads = (vm?.adsT ?? 0) > 0.5;
    // `ui` maps this to reticle bloom as 4 + spread * 40 px, so hand it a
    // normalised 0..1 rather than raw degrees.
    h.spread = Math.min(1, Math.max(0, this._spread / 6));
    // The equipment pips were hardcoded 2/1 in `ui` before anything owned them.
    // These are now the real inventory.
    h.lethalCount = this.throwables?.counts.lethal ?? 0;
    h.tacticalCount = this.throwables?.counts.tactical ?? 0;
    h.firing = this.firing;
    return h;
  }

  /* ====================================================================== */
  /*  weapon management                                                     */
  /* ====================================================================== */

  setWeapon(id) {
    if (!this.states.has(id) || id === this.activeId || this._switchTo) return false;
    this._switchTo = id;
    this._switchTimer = this.viewmodel.play('holster');
    return true;
  }

  nextWeapon() {
    const ids = this.weaponIds;
    const i = ids.indexOf(this.activeId);
    return this.setWeapon(ids[(i + 1) % ids.length]);
  }

  cycleFireMode() {
    const s = this.state;
    if (!s || s.def.modes.length < 2) return s?.mode;
    s.modeIndex = (s.modeIndex + 1) % s.def.modes.length;
    s.mode = s.def.modes[s.modeIndex];
    this._burstLeft = 0;
    return s.mode;
  }

  reload() {
    const s = this.state;
    if (!s || this.reloading || this.switching) return false;
    if (s.mag >= s.def.magSize || s.reserve <= 0) return false;
    this.viewmodel.stopClip();
    const empty = s.mag === 0 && !s.chambered;
    this.viewmodel.play(empty ? 'reloadEmpty' : 'reloadTac');
    this._pendingReloadEmpty = empty;
    return true;
  }

  inspect() {
    if (this.reloading || this.switching || this.inspecting) return false;
    this.viewmodel.play('inspect');
    return true;
  }

  /* ====================================================================== */
  /*  firing                                                                */
  /* ====================================================================== */

  canFire() {
    const s = this.state;
    if (!s) return false;
    if (this.reloading || this.switching) return false;
    if (this._fireTimer > 0) return false;
    return s.chambered;
  }

  /** One round leaves the barrel. Returns false if the trigger clicked dry. */
  tryFire() {
    const s = this.state;
    if (!s) return false;
    if (this.reloading || this.switching || this._fireTimer > 0) return false;
    if (!s.chambered) {
      // Dry: lock the bolt back and let the player know by feel.
      this.viewmodel.boltHold = 1;
      this._fireTimer = 0.25;
      return false;
    }
    if (this.inspecting) this.viewmodel.stopClip();

    const def = s.def;
    const first = this._sinceShot > 0.35;
    // ---- feed the next round ----
    s.chambered = false;
    if (s.mag > 0) {
      s.mag--;
      s.chambered = true;
    } else {
      this.viewmodel.boltHold = 1;
    }

    // ---- deterministic recoil pattern ----
    const idx = Math.min(this._shotIndex, def.recoil.patternLength - 1);
    const pitch = s.pattern[idx * 2];
    const yaw = s.pattern[idx * 2 + 1];
    this._shotIndex++;

    // ---- aim: camera forward + a spread cone ----
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._camDir.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this._dir.copy(this._camDir);
    const spreadRad = this._spread * DEG;
    if (spreadRad > 1e-5) {
      const d = this.rng.disc(this._disc ?? (this._disc = { x: 0, y: 0 }));
      this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      this._dir
        .addScaledVector(this._right, Math.tan(spreadRad) * d.x)
        .addScaledVector(this._up, Math.tan(spreadRad) * d.y)
        .normalize();
    }

    // ---- projectile ----
    this.viewmodel.muzzleWorld(this._muzzle);
    const seed = this.rng.u32();
    this.sim.spawn({
      origin: this._muzzle,
      dir: this._dir,
      speed: def.muzzleVelocity,
      damage: def.damage,
      penetration: def.penetration,
      dragK: def.dragK,
      dropoff: def.dropoff,
      falloffStart: def.falloffStart,
      falloffEnd: def.falloffEnd,
      maxRange: def.maxRange,
      weapon: def,
      tracer: this.stats.fired % def.tracerEvery === 0,
    });

    // ---- feedback ----
    this.viewmodel.addRecoil(pitch, yaw, first);
    const p = this.player;
    if (p?.addRecoil) {
      // The camera climb is the learnable part; the viewmodel kick is the feel.
      p.addRecoil(pitch, yaw, def.recoil.roll * 0.35, def.recoil.punch);
    }
    this._spread = Math.min(def.spreadMax, this._spread + def.spreadPerShot);
    this._fireTimer = 60 / def.rpm;
    this._sinceShot = 0;
    this.stats.fired++;
    this._pendingShots++;
    this._pendingFirst = this._pendingFirst || first;
    this._fireSeed = seed;

    // Shell leaves the port shortly after the shot, once the bolt is back.
    //
    // On a self-loader that is 50 ms — the gas system does it for you. On a bolt
    // gun the case cannot leave until a hand has thrown the bolt, so it rides
    // the same curve the viewmodel animates (`boltCycle`, which runs over 62 %
    // of the cycle) and the brass appears a third of a second after the bang.
    // Ejecting it at 50 ms would have the case flying out of a closed action.
    this._queueShell(
      def.boltAction ? this._fireTimer * 0.3 : Math.min(0.05, this._fireTimer * 0.45)
    );
    return true;
  }

  _queueShell(delay) {
    for (const q of this._shellQueue) {
      if (q.t < 0) {
        q.t = delay;
        return q;
      }
    }
    return null;
  }

  /* ====================================================================== */
  /*  reload / clip callbacks                                               */
  /* ====================================================================== */

  _onClipEvent(name, clipName) {
    const s = this.state;
    const isReload = clipName === 'reloadTac' || clipName === 'reloadEmpty';
    switch (name) {
      case 'start':
        if (isReload) this._emitReload('start');
        break;
      case 'magout':
        if (isReload) this._emitReload('magout');
        break;
      case 'magdrop':
        if (isReload) this._dropMagazine();
        break;
      case 'magin':
        if (isReload) {
          this._emitReload('magin');
          this._completeReload(clipName === 'reloadEmpty');
        }
        break;
      case 'boltrelease':
        this.viewmodel.boltHold = 0;
        break;
      case 'end':
        if (isReload) {
          this._emitReload('end');
          this.viewmodel.boltHold = 0;
        }
        if (clipName === 'holster' && this._switchTo) {
          this.activeId = this._switchTo;
          this._switchTo = null;
          this.viewmodel.setActive(this.activeId);
          this.viewmodel.play('draw');
          this._shotIndex = 0;
          this._spread = 0;
        }
        break;
      default:
        break;
    }
  }

  /**
   * The chambered-round model: a tactical reload keeps the round in the chamber
   * and gives you magSize+1; an empty reload has to feed one out of the fresh
   * magazine, so you end up with exactly magSize.
   */
  _completeReload(empty) {
    const s = this.state;
    if (!s) return;
    const want = s.def.magSize - s.mag;
    const take = Math.min(want, s.reserve);
    s.reserve -= take;
    s.mag += take;
    if (empty && !s.chambered && s.mag > 0) {
      s.mag--;
      s.chambered = true;
    }
    this._shotIndex = 0;
  }

  _emitReload(phase) {
    this._reloadPayload.weapon = this.current;
    this._reloadPayload.phase = phase;
    this.ctx.events.emit('weapon:reload', this._reloadPayload);
  }

  /** Spawn the discarded magazine as a real rigid body in the world. */
  _dropMagazine() {
    const phys = this.physics ?? (this.physics = this.ctx.peek('physics'));
    const w = this.viewmodel.active;
    if (!w) return;
    const proxy = this._magProxy(w);
    if (!proxy) return;
    const mag = w.parts.magazine;
    mag.updateMatrixWorld();
    proxy.group.position.setFromMatrixPosition(mag.matrixWorld);
    proxy.group.quaternion.setFromRotationMatrix(mag.matrixWorld);
    proxy.group.visible = true;
    // Magazine geometry hangs below its origin, so bias the body centre down.
    const half = w.magLen * 0.45;
    proxy.group.position.y -= half * 0.4;

    const vel = this._tmp.set(0, -0.7, 0);
    const pv = this.player?.velocity;
    if (pv) vel.add(pv);
    vel.x += this.rng.signed() * 0.25;
    vel.z += this.rng.signed() * 0.25;

    if (phys?.spawnDebris) {
      proxy.body = phys.spawnDebris(proxy.group.position, vel, {
        size: Math.max(0.02, w.magLen * 0.28),
        surface: 'rubber',
        mass: 0.38,
        lifetime: 22,
        restitution: 0.18,
        object3D: proxy.group,
      });
      proxy.until = this.ctx.time.elapsed + 22;
    } else {
      proxy.until = this.ctx.time.elapsed + 2;
    }
  }

  /** Two reusable world-space magazine props per weapon. */
  _magProxy(w) {
    if (!this._magPools) this._magPools = new Map();
    let pool = this._magPools.get(w.id);
    if (!pool) {
      pool = [];
      for (let i = 0; i < 2; i++) {
        const group = new THREE.Object3D();
        group.name = `dropped-mag-${w.id}-${i}`;
        group.visible = false;
        // Share the viewmodel's geometry and materials; the world copy needs no
        // resources of its own.
        w.parts.magazine.traverse((o) => {
          if (o.isMesh) {
            const m = new THREE.Mesh(o.geometry, o.material);
            m.position.copy(o.position);
            m.quaternion.copy(o.quaternion);
            m.castShadow = true;
            group.add(m);
          }
        });
        this.ctx.scene.add(group);
        pool.push({ group, body: null, until: 0 });
        this._droppedMags.push(pool[i]);
      }
      this._magPools.set(w.id, pool);
    }
    // Reuse the oldest.
    let best = pool[0];
    for (const p of pool) if (p.until < best.until) best = p;
    if (best.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(best.body);
    best.body = null;
    return best;
  }

  /* ====================================================================== */
  /*  frame                                                                 */
  /* ====================================================================== */

  fixedUpdate(h) {
    this.sim.fixedUpdate(h);
  }

  update(dt, ctx) {
    const s = this.state;
    if (!s) return;
    const def = s.def;
    const input = ctx.input;
    const player = this.player ?? (this.player = ctx.peek('player'));
    const st = this._state;

    this._sinceShot += dt;
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._burstCooldown > 0) this._burstCooldown -= dt;

    // ---- spread recovery -------------------------------------------------
    const rest = this._restSpread(def, player, st);
    this._spread = Math.max(rest, this._spread - def.spreadDecay * dt * (1 + this.adsProgress));
    if (this._sinceShot > 0.6) this._shotIndex = 0;

    // ---- gather state ----------------------------------------------------
    const live = !input.frozen && input.enabled !== false && this.debugMode === null;
    st.ads = live ? input.ads || player?.adsRequested === true : this.debugMode === 'ads';
    st.sprint = live ? player?.sprinting === true && this._sinceShot > 0.3 : false;
    st.speed = player?.horizontalSpeed ?? player?.speed ?? 0;
    st.crouch = player?.stance === 'crouch';
    st.airborne = player?.airborne === true;
    st.lowReady = player?.state === 'mantle' || player?.mantling === true;
    st.empty = s.mag === 0 && !s.chambered;

    // ---- input -----------------------------------------------------------
    if (live) {
      if (input.actionPressed('reload')) this.reload();
      if (input.pressed('KeyB')) this.cycleFireMode();
      if (input.pressed('KeyI')) this.inspect();
      for (let i = 0; i < SLOT_KEYS.length; i++) {
        if (input.pressed(SLOT_KEYS[i])) this.setWeapon(LOADOUT[i]);
      }
      if (input.pressed('Tab')) this.nextWeapon();
      if (input.wheel) this.nextWeapon();
      this._runThrowables(input);
      this._runTrigger(dt, input.fire, input.firePressed, def, s);
      st.trigger = input.fire && this.canFire();
      // Auto-reload on a dry trigger pull, like every modern shooter.
      if (input.firePressed && st.empty) this.reload();
    } else if (this.debugMode) {
      this._runDebug(ctx);
      st.trigger = this._sinceShot < 0.09;
    } else if (this.throwables.cooking) {
      // Pause / capture froze the input mid-cook. The pin is already out, so
      // the round is spent rather than silently refunded.
      this.throwables.cancelCook();
    }

    // The cook keeps burning whether or not input is live, and thrown rounds
    // must keep ticking while the player is dead or the menu is open.
    this.throwables.update(dt);
    // A cooked grenade occupies the weapon hand: drop to low ready so the
    // viewmodel visibly commits, and hold the trigger closed.
    if (this.throwables.cooking) {
      st.lowReady = true;
      st.trigger = false;
    }

    // Push the ADS curve to the player so camera FOV / move speed follow it.
    // The second argument is the OPTIC: a 3.3x scope and a 1x red dot cannot
    // share one global zoom, and `player` owns the camera, so the weapon states
    // what its glass does and the camera decides how to get there.
    player?.setAdsProgress?.(this.viewmodel.adsT, def.adsFovScale);

    this.stats.live = this.sim.stats.live;
    this.stats.fired = this.sim.stats.fired;
  }

  /**
   * Equipment binds. Hold to cook, release to throw — so the throw fires on the
   * key going UP, and a tap is just a very short cook.
   *
   * Reloading and swapping both need the weapon hand, so they block a new cook
   * but never interrupt one already in progress: once the pin is out the only
   * ways it ends are `release()` and cooking off.
   */
  _runThrowables(input) {
    const t = this.throwables;
    if (!t.cooking) {
      if (this.reloading || this.switching) return;
      if (input.actionPressed('grenade')) t.beginCook('lethal');
      else if (input.actionPressed('tactical')) t.beginCook('tactical');
      return;
    }
    // Release on the key that STARTED the cook, not on either key: cooking a
    // frag and then tapping H must not hold the frag in the hand until H is let
    // go, which is exactly how it kills you.
    if (!input.action(t.cook.def.slot === 'tactical' ? 'tactical' : 'grenade')) t.release();
  }

  /** Fire-mode state machine. */
  _runTrigger(dt, held, pressed, def, s) {
    switch (s.mode) {
      case 'auto':
        if (held) this.tryFire();
        break;
      case 'burst':
        if (pressed && this._burstLeft === 0 && this._burstCooldown <= 0) {
          this._burstLeft = def.burstCount;
        }
        if (this._burstLeft > 0 && this._fireTimer <= 0) {
          if (this.tryFire()) {
            this._burstLeft--;
            this._fireTimer = 60 / def.burstRpm;
            if (this._burstLeft === 0) this._burstCooldown = def.burstDelay;
          } else {
            this._burstLeft = 0;
          }
        }
        break;
      default: // semi
        if (pressed) this.tryFire();
        break;
    }
  }

  _restSpread(def, player, st) {
    let base = lerp(def.spreadHip, def.spreadAds, this.adsProgress);
    if (st.crouch) base *= SPREAD_MODS.crouch;
    if (player?.stance === 'prone') base *= SPREAD_MODS.prone;
    if (st.speed < 0.4) base *= SPREAD_MODS.still;
    else if (st.speed > 3.2) base *= SPREAD_MODS.walking;
    if (st.sprint) base *= SPREAD_MODS.sprinting;
    if (st.airborne) base *= SPREAD_MODS.airborne;
    /**
     * AIRBORNE IS ADDITIVE, and it is the only modifier that is.
     *
     * Every other stance scales the aimed cone, which is right — bracing a
     * weapon makes crouching matter less, not more. But a weapon with a near-zero
     * ADS cone is immune to a multiplier by construction: 2.0 x 0.02 deg is
     * still 0.04 deg, so the AX-7 would be pinpoint accurate fired mid-jump and
     * the jump-shot would be strictly better than standing still. Feet off the
     * ground adds a fixed cone that no amount of aiming removes.
     */
    if (st.airborne) base += def.spreadAirAdd ?? 0.35;
    return base;
  }

  lateUpdate(dt, ctx) {
    const vm = this.viewmodel;
    if (!vm) return;
    vm.update(dt, this._state);

    // ---- muzzle flash / audio, now that the pose is final ---------------
    if (this._pendingShots > 0) {
      const def = this.current;
      vm.muzzleWorld(this._firePayload.origin);
      vm.boreDir(this._firePayload.dir);
      this._firePayload.weapon = def;
      this._firePayload.seed = this._fireSeed >>> 0;
      for (let i = 0; i < this._pendingShots; i++) {
        ctx.events.emit('weapon:fire', this._firePayload);
      }
      this._pendingShots = 0;
      this._pendingFirst = false;
    }

    // ---- deferred shell ejection ---------------------------------------
    for (const q of this._shellQueue) {
      if (q.t < 0) continue;
      q.t -= dt;
      if (q.t > 0) continue;
      q.t = -1;
      vm.ejectWorld(this._shellPayload.position);
      vm.ejectVelocity(this._shellPayload.velocity, 2.3 + this.rng.float() * 1.2);
      const pv = this.player?.velocity;
      if (pv) this._shellPayload.velocity.add(pv);
      this._shellPayload.velocity.y += 1.1;
      this._shellPayload.weapon = this.current;
      const shell = vm.active?.shell;
      this._shellPayload.caseLen = shell?.caseLen ?? 0.0446;
      this._shellPayload.caseRadius = shell?.rimR ?? 0.00495;
      this._shellPayload.spin = 28 + this.rng.float() * 34;
      ctx.events.emit('weapon:shell', this._shellPayload);
    }

    // ---- retire dropped magazines --------------------------------------
    if (this._droppedMags.length) {
      const now = ctx.time.elapsed;
      for (const p of this._droppedMags) {
        if (p.group.visible && p.until && now > p.until) {
          p.group.visible = false;
          if (p.body && this.physics?.removeRigidBody) {
            this.physics.removeRigidBody(p.body);
            p.body = null;
          }
        }
      }
    }
  }

  /* ====================================================================== */
  /*  capture harness                                                       */
  /* ====================================================================== */

  /**
   * Freeze the viewmodel in a photogenic state.
   * The harness applies a shot, then pumps `SETTLE` frames before grabbing the
   * frame, so 'fire' schedules a short burst that peaks right at the capture.
   */
  debugPose(kind = 'idle', opts = {}) {
    const vm = this.viewmodel;
    this.debugMode = kind;
    this.setWeaponImmediate('rifle');
    vm.stopClip();
    vm.recPos.reset();
    vm.recRot.reset();
    vm.settle.reset();
    vm.lag.reset();
    vm.lagRot.reset();
    vm.boltHold = 0;
    vm.boltCycle = 0;
    vm.sprintT = 0;
    vm.lowReadyT = 0;
    vm.bobPhase = 0;
    vm._angVel.yaw = 0;
    vm._angVel.pitch = 0;
    vm._hasPrev = false;
    // A fixed, non-zero noise phase: a settled but not artificially symmetric pose.
    vm.noiseT = 12.37;
    vm.debugFrozen = true;
    // From the def, not a copy of it: these were the carbine's literal 0.24/2.05
    // and silently went stale the moment its hip cone was retuned.
    const dbgDef = this.states.get(this.activeId)?.def;
    this._spread = kind === 'ads' ? dbgDef?.spreadAds ?? 0.24 : dbgDef?.spreadHip ?? 2.15;
    this._sinceShot = 10;
    this._debugFrame = 0;

    const s = this.state;
    if (s) {
      s.mag = kind === 'fire' ? 22 : s.def.magSize;
      s.chambered = true;
      s.reserve = s.def.reserve;
    }

    if (kind === 'ads') {
      vm.adsT = 1;
      this._state.ads = true;
    } else {
      vm.adsT = 0;
      this._state.ads = false;
    }
    this._state.sprint = false;
    this._state.speed = 0;
    this._state.trigger = false;
    // Frames (at the harness's fixed 60 Hz) on which to fire for the 'fire'
    // shot. The burst has to land at the END of the harness's settle window: a
    // flash core lives 52 ms (~3 frames), so the last rounds must leave the
    // barrel a frame or two before the grab or there is nothing to photograph.
    // `grabFrame` is how many frames the harness will pump — it is a CLI flag
    // (`--settle`), so it cannot be hard-coded here. The offsets below straddle
    // the grab because the harness pumps on its own rAF chain, which can land a
    // frame either side of the engine's.
    // A flash core lives 52 ms — about three frames at 60 Hz — while the exact
    // frame the shutter lands on is only known to within a handful of frames
    // (the harness pumps its settle count on its own rAF chain, then the
    // screenshot RPC costs a few more). So: three spaced rounds early to fill
    // the frame with drifting smoke, brass in flight and a tracer, then a
    // sustained tail on a 2-frame cadence, so a flash is lit continuously
    // across the whole uncertainty window.
    //
    // The cadence was 3 frames, which is the flash core's own lifetime rounded
    // UP: measured across settle 86/88/90/92/94, frame 90 landed in the trough
    // between two cores and photographed a dying flash (10k hot pixels against
    // 26-29k on either side). Two frames guarantees overlap.
    if (kind === 'fire') {
      const grab = Math.round(opts?.grabFrame ?? 90);
      const frames = [grab - 26, grab - 19, grab - 12];
      for (let f = grab - 6; f <= grab + 18; f += 2) frames.push(f);
      this._scriptFrames = frames.filter((f) => f >= 2);
    } else {
      this._scriptFrames = null;
    }
    return kind;
  }

  /** Swap without the draw animation (harness + debug only). */
  setWeaponImmediate(id) {
    if (!this.states.has(id)) return false;
    this._switchTo = null;
    this.activeId = id;
    this.viewmodel.setActive(id);
    return true;
  }

  _runDebug(ctx) {
    this._debugFrame = (this._debugFrame ?? 0) + 1;
    const frames = this._scriptFrames;
    if (!frames) return;
    for (const f of frames) {
      if (f === this._debugFrame) {
        this._fireTimer = 0;
        this.tryFire();
      }
    }
  }

  /* ====================================================================== */

  resize() {}

  dispose() {
    for (const off of this._off ?? []) off();
    this.sim?.clear();
    for (const p of this._droppedMags) {
      p.group.removeFromParent();
      if (p.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(p.body);
    }
    this._droppedMags.length = 0;
    this.throwables?.dispose();
    this.viewmodel?.dispose();
    this.mats?.dispose();
  }
}
