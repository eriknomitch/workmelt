import * as THREE from 'three';

/**
 * AI — THE ROO.
 *
 * Shivam's ambient kangaroo: he grazes and hops around the beach front,
 * minding his own business. He is completely harmless — bots ignore him, he
 * ignores everyone — right up until a PLAYER puts a round (or a blade, or a
 * grenade) into him, at which point he detonates like a frag. He does not
 * respawn on a timer: somebody has to walk to one of the map's energy wells
 * and stand in it for a few seconds to bring him back.
 *
 * Only the local player's fire sets him off. Bot rounds fly through the same
 * `physics.fireBullet` path, so the trigger keys off the `source` field the
 * trace now carries on `damage:dealt` ('player' | 'ai'), and the chain check
 * on `explosion` events keys off their existing `source` the same way — a
 * bot's grenade cooking off next to him is a near miss, not a detonation.
 *
 * The decision logic lives in `RooCore`, a pure class in LEVEL space with
 * every dependency injected (rng, ground height, walkability), so the hop
 * planner, the one-shot detonation and the stand-on-the-pad respawn contract
 * are all checked headlessly by `roo.selftest.mjs`. The `Roo` shell below
 * owns everything that needs an engine: the mesh, the hit collider, the
 * events and the level->world conversion.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the core — pure, LEVEL space, node-testable                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

export const ROO_STATE = { GRAZE: 0, HOP: 1, GONE: 2 };

/** Hop geometry. One hop is a parabola; a bound is a chain of them. */
export const HOP = {
  length: 2.3,
  time: 0.55,
  apex: 0.75,
  /** The tallest ledge a hop may cross — enough for the sea wall, not a roof. */
  maxStep: 1.2,
};

/**
 * Idle chatter. He mutters an Australianism when the player wanders up to
 * him — see the `roo` vox key in tools/sfx-sources.mjs.
 *
 * The gate is a radius AND a cooldown, and the cooldown is what does the
 * work: the radius alone would fire on the frame the player crosses it and
 * then again the next time they sway across the boundary. It runs down
 * whether or not anyone is nearby, so walking away and coming back does not
 * earn a fresh line — "spaced out" is a property of the clock, not of the
 * player's path.
 *
 * `height` keeps a player on the promenade above him out of it: he stands on
 * the beach, and a voice from under the terrace you are walking on reads as a
 * bug rather than as a kangaroo.
 */
export const VOICE = {
  radius: 8,
  height: 3,
  gap: [11, 19],
};

export class RooCore {
  /**
   * `cfg` is the map descriptor's `critter` field: `home {x,z}`,
   * `bounds {x0,z0,x1,z1}`, `pads [{x,z,r,hold}, ...]`,
   * `explosion {radius,damage}`. `groundY(x,z)` and `isOpen(x,z,margin)`
   * are the map's own occupancy answers, injected so this class never
   * imports a level.
   */
  constructor(cfg, { rng, groundY, isOpen }) {
    this.cfg = cfg;
    this.rng = rng;
    this.groundY = groundY;
    this.isOpen = isOpen;

    this.state = ROO_STATE.GRAZE;
    this.x = cfg.home.x;
    this.z = cfg.home.z;
    this.y = groundY(this.x, this.z);
    this.heading = rng.float() * Math.PI * 2;

    /** 0..1 through the current hop; drives the shell's pose. */
    this.hopT = 0;
    this._hopFrom = { x: this.x, y: this.y, z: this.z };
    this._hopTo = { x: this.x, y: this.y, z: this.z };
    this._hopsLeft = 0;
    this._grazeTimer = rng.range(1.0, 2.5);
    /** Seconds the player has held a pad so far (only counts while GONE). */
    this.padHold = 0;
    this._exploded = false;

    /** Seconds until he may speak again. He starts part-way through one so a
     *  player who spawns near him is not greeted on frame one. */
    this._speakIn = rng.range(...VOICE.gap) * 0.5;
  }

  get alive() {
    return this.state !== ROO_STATE.GONE;
  }

  /**
   * A player's hit landed on him. Returns the explosion spec exactly once;
   * every other call — bot fire, a second round in the same burst, anything
   * after he is gone — returns null and changes nothing.
   */
  shot(source) {
    if (source !== 'player' || !this.alive) return null;
    return this._detonate();
  }

  /**
   * A nearby explosion. Chains only off the player's own ordnance — his
   * grenade counts as shooting him; a bot's does not.
   */
  blast(x, y, z, radius, source) {
    if (source !== 'player' || !this.alive) return null;
    const d = Math.hypot(this.x - x, this.y + 0.7 - y, this.z - z);
    if (d > (radius ?? 5)) return null;
    return this._detonate();
  }

  _detonate() {
    this.state = ROO_STATE.GONE;
    this._exploded = true;
    this.padHold = 0;
    const e = this.cfg.explosion;
    return {
      x: this.x,
      y: this.y + 0.7, // chest height: the blast starts in the body, not the sand
      z: this.z,
      radius: e.radius,
      damage: e.damage,
    };
  }

  /**
   * Advance the chatter clock. `playerLevel` is the player's position in
   * LEVEL space or null. Returns true on the tick he should say something —
   * WHICH line is not his decision: the sample bank picks among the takes
   * under the `roo` key and refuses an immediate repeat.
   *
   * Kept out of update() on purpose: a dead roo is silent, and update()
   * spends its GONE ticks running the pad ritual.
   */
  speak(dt, playerLevel) {
    if (this._speakIn > 0) this._speakIn -= dt;
    if (!this.alive || !playerLevel) return false;
    if (this._speakIn > 0) return false;
    const d = Math.hypot(playerLevel.x - this.x, playerLevel.z - this.z);
    if (d > VOICE.radius || Math.abs(playerLevel.y - this.y) > VOICE.height) return false;
    this._speakIn = this.rng.range(...VOICE.gap);
    return true;
  }

  /**
   * Advance. `playerLevel` is the player's position in LEVEL space or null.
   * Returns 'respawned' the tick the pad ritual completes, else null.
   */
  update(dt, playerLevel) {
    if (this.state === ROO_STATE.GONE) return this._updatePad(dt, playerLevel);
    if (this.state === ROO_STATE.GRAZE) {
      this._grazeTimer -= dt;
      if (this._grazeTimer <= 0) this._planBound();
      return null;
    }
    // HOP: a parabola from _hopFrom to _hopTo. Clamped to the floor under
    // him each frame: a hop that crosses a terrace step near takeoff or
    // landing would otherwise dip its arc a hand's width into the upper
    // lip for a few frames, and skimming the kerb reads right where
    // clipping through it reads broken.
    this.hopT = Math.min(1, this.hopT + dt / HOP.time);
    const t = this.hopT;
    this.x = this._hopFrom.x + (this._hopTo.x - this._hopFrom.x) * t;
    this.z = this._hopFrom.z + (this._hopTo.z - this._hopFrom.z) * t;
    this.y = Math.max(
      this._hopFrom.y + (this._hopTo.y - this._hopFrom.y) * t + HOP.apex * 4 * t * (1 - t),
      this.groundY(this.x, this.z)
    );
    if (t >= 1) {
      this.y = this._hopTo.y;
      if (--this._hopsLeft > 0 && this._planHop(this.heading)) {
        this.hopT = 0;
      } else {
        this.state = ROO_STATE.GRAZE;
        this._grazeTimer = this.rng.range(1.2, 3.5);
      }
    }
    return null;
  }

  /** Pick a heading that stays on open ground, and bound 1-3 hops down it. */
  _planBound() {
    for (let attempt = 0; attempt < 12; attempt++) {
      const heading = this.rng.float() * Math.PI * 2;
      if (this._planHop(heading)) {
        this.heading = heading;
        this.state = ROO_STATE.HOP;
        this.hopT = 0;
        this._hopsLeft = 1 + ((this.rng.float() * 3) | 0);
        return;
      }
    }
    // hemmed in on all sides — sit tight and try again shortly
    this._grazeTimer = this.rng.range(0.6, 1.2);
  }

  /** Validate one hop along `heading`; arms _hopFrom/_hopTo when it lands. */
  _planHop(heading) {
    const b = this.cfg.bounds;
    const tx = this.x + Math.sin(heading) * HOP.length;
    const tz = this.z + Math.cos(heading) * HOP.length;
    if (tx < b.x0 || tx > b.x1 || tz < b.z0 || tz > b.z1) return false;
    if (!this.isOpen(tx, tz, 0.45)) return false;
    const g0 = this.groundY(this.x, this.z);
    const g1 = this.groundY(tx, tz);
    if (!Number.isFinite(g1) || Math.abs(g1 - g0) > HOP.maxStep) return false;
    this._hopFrom.x = this.x;
    this._hopFrom.y = this.y;
    this._hopFrom.z = this.z;
    this._hopTo.x = tx;
    this._hopTo.y = g1;
    this._hopTo.z = tz;
    return true;
  }

  /**
   * THE WELLS. While he is gone, standing in any one of the energy wells
   * accumulates hold time; stepping out resets it — the ritual is that
   * pad's `hold` CONTINUOUS seconds, not a running total. Completing it
   * puts him back at home. The wells are far enough apart that "moving to
   * another well" always passes through "off every well", so the reset
   * needs no per-pad bookkeeping.
   */
  _updatePad(dt, playerLevel) {
    let on = null;
    if (playerLevel) {
      for (const pad of this.cfg.pads) {
        if (
          Math.hypot(playerLevel.x - pad.x, playerLevel.z - pad.z) <= pad.r &&
          Math.abs(playerLevel.y - this.groundY(pad.x, pad.z)) < 1.7
        ) {
          on = pad;
          break;
        }
      }
    }
    if (!on) {
      this.padHold = 0;
      return null;
    }
    this.padHold += dt;
    if (this.padHold < on.hold) return null;
    this.state = ROO_STATE.GRAZE;
    this.x = this.cfg.home.x;
    this.z = this.cfg.home.z;
    this.y = this.groundY(this.x, this.z);
    this.hopT = 0;
    this.padHold = 0;
    this._grazeTimer = this.rng.range(0.6, 1.4);
    // The player is standing on the pad, well inside the chatter radius, so
    // without this he would blurt a line in the same frame he reappears.
    this._speakIn = this.rng.range(...VOICE.gap) * 0.5;
    return 'respawned';
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the shell — mesh, collider, events                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Flat-shaded and untextured, like every character — see the quality bar. */
const RUSSET = 0xa8623c;
const CREAM = 0xd8c5a8;
const DUSK = 0x54382a;

export class Roo {
  /**
   * `cfg` is the descriptor's `critter` field (LEVEL space throughout);
   * `parent` is the ai system's root group.
   */
  constructor(ctx, cfg, rng, parent) {
    this.ctx = ctx;
    this.cfg = cfg;
    const world = ctx.get('world');
    this.world = world;
    this.core = new RooCore(cfg, {
      rng,
      groundY: (x, z) => world.map.groundY(x, z),
      isOpen: (x, z, m) => world.map.isOpen(x, z, m),
    });

    this._mats = [
      new THREE.MeshStandardMaterial({ color: RUSSET, roughness: 0.9, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.95, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: DUSK, roughness: 0.9, flatShading: true }),
    ];
    this._geos = [];
    this.root = new THREE.Group();
    this.root.name = 'roo';
    this.body = new THREE.Group();
    this.root.add(this.body);
    this._build();
    parent.add(this.root);

    const phys = ctx.peek('physics');
    this.phys = phys;
    this.collider = phys
      ? phys.addCollider({
        shape: 'capsule',
        layer: phys.LAYER.ACTOR,
        surface: 'flesh',
        owner: this,
        part: 'torso',
        radius: 0.3,
      })
      : null;

    // preallocated scratch
    this._wp = new THREE.Vector3();
    this._wp2 = new THREE.Vector3();
    this._lp = new THREE.Vector3();
    this._explosionEvent = { position: new THREE.Vector3(), radius: 0, damage: 0, source: 'roo' };
    this._speakEvent = { position: new THREE.Vector3() };
    this._lastHeading = null;
    this._worldYaw = 0;

    const on = (ev, fn) => {
      (this._offs ??= []).push(ctx.events.on(ev, fn));
    };
    on('damage:dealt', (e) => {
      if (!e || e.target !== this || e.applied) return;
      this._maybeExplode(this.core.shot(e.source ?? null));
    });
    on('explosion', (e) => {
      if (!e || !e.position) return;
      // level-space distance check inside the core; convert the blast point
      this.world.worldToLevel(e.position.x, e.position.y, e.position.z, this._lp);
      this._maybeExplode(
        this.core.blast(this._lp.x, this._lp.y, this._lp.z, e.radius, e.source ?? null)
      );
    });

    this._sync(true);
  }

  /** World position — hit records expose `actor`, and listeners peek this. */
  get position() {
    return this.root.position;
  }

  _build() {
    const mesh = (w, h, d, x, y, z, mat = 0, rx = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this._geos.push(g);
      const m = new THREE.Mesh(g, this._mats[mat]);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      this.body.add(m);
      return m;
    };
    // torso, pitched back so the chest sits up; the cream front is the read
    mesh(0.34, 0.62, 0.44, 0, 0.72, -0.02, 0, -0.55);
    mesh(0.26, 0.42, 0.1, 0, 0.68, 0.2, 1, -0.45);
    // head, snout, ears
    mesh(0.2, 0.22, 0.28, 0, 1.12, 0.18);
    mesh(0.1, 0.1, 0.16, 0, 1.07, 0.34, 2);
    this.earL = mesh(0.05, 0.24, 0.03, -0.08, 1.32, 0.12, 0, 0, 0.28);
    this.earR = mesh(0.05, 0.24, 0.03, 0.08, 1.32, 0.12, 0, 0, -0.28);
    // tail: two tapering segments, the counterweight of the whole silhouette
    mesh(0.12, 0.12, 0.5, 0, 0.42, -0.42, 0, 0.55);
    mesh(0.08, 0.08, 0.44, 0, 0.24, -0.8, 0, 0.15);
    // legs: big thighs, long flat feet; small forearms tucked to the chest
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.2, 0.52, -0.05);
    this.legR.position.set(0.2, 0.52, -0.05);
    this.body.add(this.legL, this.legR);
    for (const leg of [this.legL, this.legR]) {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.3), this._mats[0]);
      thigh.position.set(0, -0.14, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.44), this._mats[2]);
      foot.position.set(0, -0.44, 0.1);
      this._geos.push(thigh.geometry, foot.geometry);
      leg.add(thigh, foot);
    }
    mesh(0.06, 0.24, 0.08, -0.14, 0.82, 0.16, 0, 0.6);
    mesh(0.06, 0.24, 0.08, 0.14, 0.82, 0.16, 0, 0.6);
  }

  _maybeExplode(spec) {
    if (!spec) return;
    const e = this._explosionEvent;
    this.world.levelToWorld(spec.x, spec.y, spec.z, e.position);
    e.radius = spec.radius;
    e.damage = spec.damage;
    // Re-entrancy: this emit runs the `explosion` listener above synchronously,
    // but the core is already GONE, so `blast()` returns null.
    this.ctx.events.emit('explosion', e);
    this.root.visible = false;
    if (this.collider) this.collider.enabled = false;
  }

  update(dt) {
    // player position, converted to LEVEL space for the pad ritual
    let playerLevel = null;
    const p = this.ctx.peek('player');
    const src = p?.position ?? null;
    if (src && Number.isFinite(src.x)) {
      playerLevel = this.world.worldToLevel(src.x, src.y, src.z, this._lp);
    }
    if (this.core.speak(dt, playerLevel)) {
      this._speakEvent.position.copy(this.root.position);
      this._speakEvent.position.y += 1.15; // his head, not his feet
      this.ctx.events.emit('roo:speak', this._speakEvent);
    }
    const outcome = this.core.update(dt, playerLevel);
    if (outcome === 'respawned') {
      this.root.visible = true;
      if (this.collider) this.collider.enabled = true;
      this._lastHeading = null;
    }
    if (!this.core.alive) return;
    this._sync(false);
  }

  /** Pose the mesh and the hit capsule from the core's state. */
  _sync(force) {
    const c = this.core;
    this.world.levelToWorld(c.x, c.y, c.z, this._wp);
    this.root.position.copy(this._wp);

    // face down the hop: convert the heading by mapping a step through the
    // level transform, only when it changes (allocation-free, sign-proof)
    if (force || c.heading !== this._lastHeading) {
      this._lastHeading = c.heading;
      this.world.levelToWorld(
        c.x + Math.sin(c.heading), c.y, c.z + Math.cos(c.heading), this._wp2
      );
      this._worldYaw = Math.atan2(this._wp2.x - this._wp.x, this._wp2.z - this._wp.z);
    }
    this.root.rotation.y = this._worldYaw;

    // pose: crouch into the jump, stretch through it, settle on landing
    const t = c.state === ROO_STATE.HOP ? c.hopT : 0;
    const air = Math.sin(Math.PI * t); // 0 ground, 1 apex
    this.body.rotation.x = -0.28 * air;
    const squash = c.state === ROO_STATE.HOP ? 1 + 0.12 * air - 0.1 * (t > 0.9 ? 1 : 0) : 1;
    this.body.scale.set(1, squash, 1);
    this.legL.rotation.x = this.legR.rotation.x = -0.9 * air;
    this.earL.rotation.x = this.earR.rotation.x = -0.35 * air;

    if (this.collider) {
      this.collider.setSegment(
        this._wp.x, this._wp.y + 0.4, this._wp.z,
        this._wp.x, this._wp.y + 1.1, this._wp.z
      );
    }
  }

  dispose() {
    for (const off of this._offs ?? []) off();
    this._offs = null;
    if (this.collider) this.phys?.removeCollider(this.collider);
    this.collider = null;
    this.root.parent?.remove(this.root);
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    this._geos.length = 0;
  }
}
