import * as THREE from 'three';
import { P } from './atlas.js';
import { resetSpawn } from './particles.js';
import { V, cone } from './util.js';

/**
 * Always-on atmosphere.
 *
 * Three things, all subtle enough that you notice them only when they are gone:
 *
 *  - **Dust motes.** A population of tiny forward-scattering specks kept alive
 *    in a box that follows the camera, drifting on the same analytic turbulence
 *    as everything else. They are what makes a shaft of light look like air
 *    instead of a gradient.
 *  - **Heat shimmer.** Refraction sprites laid on the ground ahead of the
 *    player while the sun is high, so hot surfaces boil slightly.
 *  - **Smoke sources.** Long-lived emitters. `world` can tag any object with
 *    `userData.fxSmoke = { radius, rate }` and it will start smoking without
 *    either subsystem knowing about the other; explosions use the same pool for
 *    their smoke column.
 *  - **Energy wells.** Persistent columns of tiny glowing embers and the odd
 *    angular "data cube" rising out of a marked circle on the ground and
 *    fading out around eye level — the respawn wells of Shivam's roo ritual
 *    (`FxSystem._syncWells` registers one per `map.critter.pads` entry).
 *    Subtle by construction: a handful of particles a second, no light, no
 *    haze.
 */

const TWO_PI = Math.PI * 2;
const MAX_EMITTERS = 24;

/** Energy wells go quiet past this — nobody can read a 2 cm ember at 80 m. */
const WELL_CULL = 80;

class Emitter {
  constructor() {
    this.active = false;
    this.age = 0;
    this.duration = Infinity;
    this.acc = 0;
    this.rate = 6;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.radius = 0.25;
    this.rise = 1.2;
    this.dark = 0.16;
    this.life = 2.6;
    this.growth = 3;
    this.ember = 0;
    this.haze = 0;
    this.object = null;
    this.tag = 0;
  }
}

export class Ambience {
  constructor(fx, opts = {}) {
    this.fx = fx;
    this.emitters = [];
    for (let i = 0; i < MAX_EMITTERS; i++) this.emitters.push(new Emitter());
    this._tag = 1;

    this.moteCount = opts.motes ?? 240;
    this.moteLife = 9;
    this.moteAcc = 0;
    this.moteBox = opts.box ?? 22;
    this.moteEnabled = this.moteCount > 0;
    this.sunFactor = 1;

    this.shimmerAcc = 0;
    this.shimmerEnabled = opts.shimmer !== false;

    this._scanTimer = 0;
    this._tracked = new Set();
    this._tmp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._warm = 0;
  }

  /* --------------------------------------------------------------------- */
  /*  emitters                                                            */
  /* --------------------------------------------------------------------- */

  _acquire() {
    let oldest = null;
    for (const e of this.emitters) {
      if (!e.active) return e;
      if (!oldest || e.age / e.duration > oldest.age / oldest.duration) oldest = e;
    }
    return oldest;
  }

  /** Finite-duration smoke column (explosions, burning wreck). */
  addColumn(x, y, z, o = {}) {
    const e = this._acquire();
    e.active = true;
    e.age = 0;
    e.acc = 0;
    e.duration = o.duration ?? 1.5;
    e.rate = o.rate ?? 8;
    e.x = x;
    e.y = y;
    e.z = z;
    e.radius = o.radius ?? 0.5;
    e.rise = o.rise ?? 1.5;
    e.dark = o.dark ?? 0.14;
    e.life = o.life ?? 3.2;
    e.growth = o.growth ?? 3;
    e.ember = o.ember ?? 0;
    e.haze = o.haze ?? 0;
    e.object = null;
    e.tag = this._tag++;
    return e.tag;
  }

  /** Persistent source; pass an Object3D to have it follow that object. */
  addSource(position, o = {}) {
    const tag = this.addColumn(position.x, position.y, position.z, {
      duration: o.duration ?? Infinity,
      rate: o.rate ?? 4.5,
      radius: o.radius ?? 0.35,
      rise: o.rise ?? 1.1,
      dark: o.dark ?? 0.13,
      life: o.life ?? 3.4,
      growth: o.growth ?? 3.4,
      ember: o.ember ?? 0.25,
      haze: o.haze ?? 0.35,
    });
    if (o.object) {
      for (const e of this.emitters) if (e.tag === tag) e.object = o.object;
    }
    return tag;
  }

  remove(tag) {
    for (const e of this.emitters) {
      if (e.tag === tag) {
        e.active = false;
        e.object = null;
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /*  energy wells                                                         */
  /* --------------------------------------------------------------------- */

  /** Persistent energy well at a world position; `radius` is the floor disc. */
  addWell(x, y, z, o = {}) {
    const w = {
      tag: this._tag++,
      x,
      y,
      z,
      radius: o.radius ?? 0.9,
      /** Embers per second. Deliberately low — the well is an accent. */
      rate: o.rate ?? 8,
      acc: 0,
    };
    (this.wells ??= []).push(w);
    return w.tag;
  }

  removeWell(tag) {
    if (!this.wells) return;
    const i = this.wells.findIndex((w) => w.tag === tag);
    if (i >= 0) this.wells.splice(i, 1);
  }

  /**
   * One rising mote out of a well. Mostly soft ember points with a digital
   * flicker; roughly one in five is an angular CHIP fleck — the "data cube".
   * The climb is drag-free and unhurried (~0.3 m/s for ~5 s), so a particle
   * expires around 1.2-1.9 m up: they fade out at eye level rather than
   * escaping into the sky, which is what keeps the column a place marker and
   * not a smoke signal.
   */
  _wellEmber(w, dt) {
    const fx = this.fx;
    const rng = fx.rng;
    const s = resetSpawn();
    const a = rng.float() * TWO_PI;
    const r = Math.sqrt(rng.float()) * w.radius * 0.8;
    s.x = w.x + Math.cos(a) * r;
    s.y = w.y + rng.range(0.02, 0.1);
    s.z = w.z + Math.sin(a) * r;
    s.vx = rng.signed() * 0.03;
    s.vy = rng.range(0.24, 0.38);
    s.vz = rng.signed() * 0.03;
    const cube = rng.float() < 0.2;
    s.tile = cube ? P.CHIP : P.MOTE;
    s.size0 = cube ? rng.range(0.035, 0.055) : rng.range(0.02, 0.036);
    s.size1 = s.size0 * 0.75;
    s.life = rng.range(4.2, 5.4);
    s.delay = -rng.float() * dt;
    s.rot = rng.float() * TWO_PI;
    s.spin = cube ? rng.signed() * 0.8 : 0;
    // teal-cyan, dimming as it climbs; flags=1 adds the spark flicker that
    // makes it read as signal rather than as a floating dust mote. Intensity
    // sits in the fire-ember band (3-9) — anything below ~2 is invisible in
    // full daylight, which is when the well still has to read as a place.
    s.r0 = 0.35; s.g0 = 1.0; s.b0 = 0.92; s.i0 = rng.range(4, 8);
    s.r1 = 0.25; s.g1 = 0.8; s.b1 = 1.0; s.i1 = 0.4;
    s.flags = 1;
    s.alpha = rng.range(0.65, 0.95);
    s.alphaCurve = 1.4;
    s.soft = 0.15;
    s.turb = rng.range(0.02, 0.06);
    s.turbFreq = rng.range(0.3, 0.7);
    s.seed = rng.float();
    fx.emitAdd(s);
  }

  _wells(dt, camera) {
    if (!this.wells) return;
    const cp = camera.position;
    for (const w of this.wells) {
      const dx = w.x - cp.x;
      const dz = w.z - cp.z;
      if (dx * dx + dz * dz > WELL_CULL * WELL_CULL) {
        w.acc = 0;
        continue;
      }
      w.acc += w.rate * dt;
      let guard = 8;
      while (w.acc >= 1 && guard-- > 0) {
        w.acc -= 1;
        this._wellEmber(w, dt);
      }
    }
  }

  _puff(e, now, dt) {
    const fx = this.fx;
    const rng = fx.rng;
    cone(V, rng, 0, 1, 0, 0.6, 0.7);
    const s = resetSpawn();
    const r = e.radius;
    s.x = e.x + rng.signed() * r * 0.6;
    s.y = e.y + rng.range(0, r * 0.4);
    s.z = e.z + rng.signed() * r * 0.6;
    s.vx = V.x * e.rise * 0.5 + rng.signed() * 0.25;
    s.vy = e.rise * rng.range(0.7, 1.25);
    s.vz = V.z * e.rise * 0.5 + rng.signed() * 0.25;
    s.tile = rng.float() < 0.5 ? P.SMOKE_A : P.SMOKE_B;
    s.size0 = r * rng.range(0.7, 1.2);
    s.size1 = r * e.growth * rng.range(0.8, 1.25);
    s.sizeCurve = 0.7;
    s.life = e.life * rng.range(0.75, 1.25);
    s.delay = -rng.float() * dt;
    s.drag = 0.75;
    s.gravity = 0.42; // buoyant, keeps accelerating upward
    s.rot = rng.float() * TWO_PI;
    s.spin = rng.signed() * 0.35;
    const d = e.dark;
    s.r0 = d; s.g0 = d * 0.97; s.b0 = d * 0.94;
    s.r1 = d * 1.9; s.g1 = d * 1.86; s.b1 = d * 1.8;
    s.alpha = rng.range(0.3, 0.55);
    s.alphaCurve = 1.7;
    s.soft = 0.8;
    s.turb = r * 0.5;
    s.turbFreq = 0.55;
    s.seed = rng.float();
    fx.emitLit(s);

    if (e.ember > 0 && rng.float() < e.ember) {
      const t = resetSpawn();
      t.x = s.x; t.y = e.y; t.z = s.z;
      t.vx = rng.signed() * 0.5;
      t.vy = rng.range(1.2, 3.2);
      t.vz = rng.signed() * 0.5;
      t.tile = P.SPARK;
      t.size0 = rng.range(0.006, 0.014);
      t.size1 = t.size0 * 0.5;
      t.life = rng.range(0.8, 1.9);
      t.drag = 0.9;
      t.gravity = 1.2;
      t.r0 = 1; t.g0 = 0.5; t.b0 = 0.16; t.i0 = rng.range(3, 9);
      t.r1 = 0.9; t.g1 = 0.14; t.b1 = 0.02; t.i1 = 0.1;
      t.flags = 1;
      t.alphaCurve = 1.2;
      t.turb = 0.12; t.turbFreq = 1.6;
      t.soft = 0.1;
      t.seed = rng.float();
      fx.emitAdd(t);
    }
    if (e.haze > 0 && rng.float() < 0.35) {
      fx.haze(e.x, e.y + r * 0.6, e.z, r * 1.4, 2.4, 0.9, e.haze, P.SMOKE_A);
    }
  }

  /* --------------------------------------------------------------------- */
  /*  motes + shimmer                                                     */
  /* --------------------------------------------------------------------- */

  _motes(dt, now, camera) {
    const fx = this.fx;
    const rng = fx.rng;
    // Keep the population at `moteCount` by replacing what expires.
    const rate = this.moteCount / this.moteLife;
    // On the first couple of frames fill the volume in one go so the air is
    // never visibly empty when a shot is captured.
    let n;
    if (this._warm < 2) {
      this._warm++;
      n = this.moteCount;
    } else {
      this.moteAcc += rate * dt;
      n = Math.min(64, Math.floor(this.moteAcc));
      this.moteAcc -= n;
    }
    if (n <= 0) return;
    camera.getWorldDirection(this._fwd);
    const cx = camera.position.x + this._fwd.x * this.moteBox * 0.22;
    const cy = camera.position.y + this._fwd.y * this.moteBox * 0.1;
    const cz = camera.position.z + this._fwd.z * this.moteBox * 0.22;
    const half = this.moteBox * 0.5;
    const bright = 0.16 * this.sunFactor;
    for (let i = 0; i < n; i++) {
      const s = resetSpawn();
      s.x = cx + rng.signed() * half;
      s.y = cy + rng.signed() * half * 0.42;
      s.z = cz + rng.signed() * half;
      s.vx = rng.signed() * 0.09;
      s.vy = rng.range(-0.05, 0.06);
      s.vz = rng.signed() * 0.09;
      s.tile = P.MOTE;
      s.size0 = rng.range(0.0035, 0.011);
      s.size1 = s.size0;
      s.life = this.moteLife * rng.range(0.55, 1.45);
      // Spread the first fill through the lifetime so they do not all die at
      // once and pulse the whole volume.
      s.delay = this._warm <= 2 ? -rng.float() * s.life * 0.95 : -rng.float() * dt;
      s.drag = 0.22;
      s.gravity = -0.02;
      const b = bright * rng.range(0.35, 1.5);
      s.r0 = 1; s.g0 = 0.96; s.b0 = 0.9; s.i0 = b;
      s.r1 = 1; s.g1 = 0.94; s.b1 = 0.88; s.i1 = b * 0.6;
      s.alpha = rng.range(0.25, 0.7);
      s.alphaCurve = 1.1;
      s.soft = 0.05;
      s.turb = rng.range(0.05, 0.22);
      s.turbFreq = rng.range(0.15, 0.5);
      s.seed = rng.float();
      fx.emitMote(s);
    }
  }

  _shimmer(dt, now, camera) {
    const fx = this.fx;
    if (!this.shimmerEnabled || this.sunFactor < 0.35) return;
    this.shimmerAcc += dt;
    if (this.shimmerAcc < 0.22) return;
    this.shimmerAcc = 0;
    const rng = fx.rng;
    camera.getWorldDirection(this._fwd);
    const d = rng.range(3.5, 15);
    const sx = camera.position.x + this._fwd.x * d + rng.signed() * 4;
    const sz = camera.position.z + this._fwd.z * d + rng.signed() * 4;
    let gy = camera.position.y - 1.6;
    if (fx.physics?.groundHeight) {
      const h = fx.physics.groundHeight(sx, sz, camera.position.y + 6);
      if (Number.isFinite(h)) gy = h;
    }
    fx.haze(
      sx,
      gy + rng.range(0.15, 0.6),
      sz,
      rng.range(0.5, 1.2),
      1.9,
      rng.range(1.1, 2.0),
      rng.range(0.12, 0.3) * this.sunFactor,
      rng.float() < 0.5 ? P.SMOKE_A : P.MIST
    );
  }

  /* --------------------------------------------------------------------- */

  /** Discover objects the world subsystem tagged as smoking. */
  _scan(scene) {
    scene.traverse((o) => {
      const cfg = o.userData?.fxSmoke;
      if (!cfg || this._tracked.has(o)) return;
      this._tracked.add(o);
      o.updateWorldMatrix(true, false);
      this._tmp.setFromMatrixPosition(o.matrixWorld);
      this.addSource(this._tmp, {
        radius: cfg.radius ?? 0.35,
        rate: cfg.rate ?? 4,
        rise: cfg.rise ?? 1.1,
        dark: cfg.dark ?? 0.13,
        life: cfg.life ?? 3.4,
        ember: cfg.ember ?? 0.2,
        haze: cfg.haze ?? 0.3,
        object: o,
      });
    });
  }

  update(dt, now, camera, scene) {
    for (const e of this.emitters) {
      if (!e.active) continue;
      e.age += dt;
      if (e.age > e.duration) {
        e.active = false;
        continue;
      }
      if (e.object) {
        if (!e.object.parent) {
          e.active = false;
          e.object = null;
          continue;
        }
        e.object.updateWorldMatrix(true, false);
        this._tmp.setFromMatrixPosition(e.object.matrixWorld);
        e.x = this._tmp.x;
        e.y = this._tmp.y;
        e.z = this._tmp.z;
      }
      e.acc += e.rate * dt;
      let guard = 8;
      while (e.acc >= 1 && guard-- > 0) {
        e.acc -= 1;
        this._puff(e, now, dt);
      }
    }

    this._wells(dt, camera);
    if (this.moteEnabled) this._motes(dt, now, camera);
    this._shimmer(dt, now, camera);

    this._scanTimer += dt;
    if (this._scanTimer > 2 && scene) {
      this._scanTimer = 0;
      this._scan(scene);
    }
  }
}
