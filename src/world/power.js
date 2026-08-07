/**
 * WORLD — the power grid.
 *
 * A map can declare a set of destructible generators and a mains supply that
 * they feed. Shoot a generator down and the mains go out across the whole map
 * for a fixed time, then come back. Site Work is the only map that carries one
 * today; the descriptor field is optional and a map without it never builds a
 * grid at all.
 *
 * THIS MODULE IS PURE ON PURPOSE. It owns the arithmetic — hit tests, hit
 * points, the outage clock, the dip envelope — and owns no lights, no
 * materials, no events and no `THREE`. `WorldSystem` is what listens to
 * `bullet:impact`, converts a point, calls in here and then pushes `level()`
 * at the lamps and the emissive materials. That split is what lets
 * `power.selftest.mjs` drive a whole outage in Node in a millisecond, which
 * matters because every interesting property of this feature is a TIMING
 * property and a screenshot cannot see one.
 *
 * SPACE: the grid is agnostic. It hit-tests points against boxes and it is the
 * caller's job to hand it both in the same frame of reference — `WorldSystem`
 * keeps the boxes in LEVEL space and converts each impact point into it.
 *
 * That is the more expensive direction on purpose, and converting the three
 * boxes once at build instead is WRONG on any map with a `transform.yaw`:
 * `at()` is axis-aligned, a box is only axis-aligned in the space it was
 * authored in, and a rotated centre carrying level-axis half-extents describes
 * a machine standing at an angle to the one that is drawn. On Site Work (yaw
 * 0.26) that mismatch made 11% of the test volume empty floor, up to 0.40 m
 * clear of the plant, and hid an equal slice of the real machine.
 */

/** Clamp helper — no dependency on the engine's maths for a two-line job. */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Defaults. A map overrides any of these in its `power` block; they are here
 * rather than inline so the self-test can state the contract in one place.
 */
export const POWER_DEFAULTS = {
  /** Hit points per generator. */
  hp: 700,
  /** Seconds the mains stay down. */
  outage: 25,
  /** What the mains fall to, as a fraction of their authored intensity. */
  dim: 0.1,
  /** Seconds to fall, and to come back. */
  dropTime: 0.12,
  restoreTime: 1.5,
  /** Metres of slack around a generator box when hit-testing a bullet. */
  margin: 0.15,
  /**
   * Self-repair, in hit points per second. ALWAYS ON — a wounded generator
   * heals continuously, including while it is being shot.
   *
   * THIS IS WHAT MAKES THE TRIGGER DELIBERATE, and it exists because the
   * damage feed cannot be filtered by intent. The generator room is the
   * contested middle of the map BY DESIGN, so stray fire crosses it all match.
   * Without regen that chip damage accumulates silently until some late stray
   * round trips an outage nobody asked for and nobody can explain.
   *
   * A CONTINUOUS RATE, NOT A DELAY AFTER THE LAST HIT, and the difference is
   * the whole feature. The first version healed only once a generator had gone
   * `regenDelay` seconds unhit — but every hit restarted that clock, so ANY
   * trickle with gaps under the delay disabled regen outright and accumulated
   * forever. Measured: one stray round every 3.9 s (8.5 dps) blacked the map
   * out after 86 seconds having never healed a single point, which is exactly
   * the mystery outage regen was added to prevent. The cliff sat between "a
   * round every 6 s" — the case the self-test happened to pick — and "a round
   * every 4 s", and nothing about the failure is visible in a frame.
   *
   * As a rate the contract states itself and has no cliff in it: sustained
   * damage below `regenRate` can NEVER trip the grid however long it goes on,
   * and anything above it takes `hp / (dps - regenRate)` seconds. At 45 the
   * line falls between a bot's stray round every few seconds (~10 dps) and a
   * rifle magazine (800 rpm x 33 = 440 dps, so 700 hp in 1.8 s — 24 rounds,
   * comfortably inside one 30-round magazine).
   */
  regenRate: 45,
  /**
   * EV of extra metering compensation while the mains are down. POSITIVE IS
   * DARKER, the same sign the map's own `environment.exposureBias` uses.
   *
   * This is the half of a blackout the emissive materials cannot do. Cutting
   * the lamps and the lit windows takes away the light the LEVEL owns, but the
   * moonlit sky is still the biggest contributor to a night frame, and without
   * stopping down as well the outage reads as "some signs went off" rather
   * than as the power going out. The moon does not go out — the camera adapts
   * to a darker scene, which is what a real one does.
   */
  outageEv: 1.1,
};

export class PowerGrid {
  /**
   * @param {object} spec  the map's `power` block, plus `boxes`: one
   *   `{ id, cx, cy, cz, hx, hy, hz }` per generator, in the caller's space.
   */
  constructor(spec = {}) {
    const s = { ...POWER_DEFAULTS, ...spec };
    this.outage = s.outage;
    this.dim = clamp01(s.dim);
    this.dropTime = s.dropTime;
    this.restoreTime = s.restoreTime;
    this.margin = s.margin;
    this.maxHp = s.hp;
    this.outageEv = s.outageEv;
    this.regenRate = s.regenRate;

    this.generators = (spec.boxes ?? []).map((b) => ({ ...b, hp: s.hp, alive: true }));

    /** Seconds left on the outage, 0 when the mains are up. */
    this.remaining = 0;
    /** Mains level, 0..1. `1` is the authored brightness. */
    this.level = 1;
    /** Seconds since the outage began — drives the dip envelope. */
    this._since = 0;
    /**
     * Seconds since the mains came back, saturating at `restoreTime`.
     *
     * A SEPARATE counter, and it has to be: `remaining` is clamped to 0 the
     * moment an outage ends, so `-remaining` is 0 forever after and cannot
     * time the ramp. The first version read the restore branch off exactly
     * that and had two bugs in one line — the ramp never advanced, and a grid
     * that had NEVER tripped reported the dim level from its very first frame,
     * so the map shipped permanently browned out and an outage changed
     * nothing. Neither threw. Starting saturated is what makes "never tripped"
     * and "long since restored" the same state, which is what they are.
     */
    this._restore = this.restoreTime;
  }

  /** True while the mains are down. */
  get out() {
    return this.remaining > 0;
  }

  /** How many generators are still standing. */
  get standing() {
    return this.generators.reduce((n, g) => n + (g.alive ? 1 : 0), 0);
  }

  /**
   * Hit test a point against the generators.
   *
   * @returns the generator whose box contains the point, or null.
   */
  at(x, y, z) {
    const m = this.margin;
    for (const g of this.generators) {
      if (!g.alive) continue;
      if (Math.abs(x - g.cx) > g.hx + m) continue;
      if (Math.abs(y - g.cy) > g.hy + m) continue;
      if (Math.abs(z - g.cz) > g.hz + m) continue;
      return g;
    }
    return null;
  }

  /**
   * Apply damage at a point.
   *
   * INVULNERABLE WHILE THE MAINS ARE DOWN, and that is a balance decision
   * rather than an implementation convenience. Without it a player who can
   * reach the generator room holds the whole map in the dark indefinitely:
   * kill one, wait, kill the next as the lights come up, and the outage never
   * ends. Locking the generators for the duration puts a hard ceiling on the
   * mechanic — the map can be dark for `outage` seconds and then it is lit
   * again, whatever anybody does.
   *
   * @returns {{hit:boolean, destroyed:boolean, generator:object|null, hp:number}}
   */
  damage(x, y, z, amount) {
    const miss = { hit: false, destroyed: false, generator: null, hp: 0 };
    if (this.out || !(amount > 0)) return miss;
    const g = this.at(x, y, z);
    if (!g) return miss;
    g.hp -= amount;
    if (g.hp > 0) return { hit: true, destroyed: false, generator: g, hp: g.hp };
    g.hp = 0;
    g.alive = false;
    this.trip();
    return { hit: true, destroyed: true, generator: g, hp: 0 };
  }

  /**
   * Blast damage: every standing generator whose box centre is inside `radius`
   * takes `amount`, falling off linearly. Grenades are the other way in, and a
   * generator room is exactly where somebody will roll one.
   *
   * @returns the list of generators destroyed by this blast.
   */
  splash(x, y, z, radius, amount) {
    if (this.out || !(radius > 0) || !(amount > 0)) return [];
    const killed = [];
    for (const g of [...this.generators]) {
      if (!g.alive) continue;
      const d = Math.hypot(x - g.cx, y - g.cy, z - g.cz);
      if (d > radius) continue;
      const r = this.damage(g.cx, g.cy, g.cz, amount * (1 - d / radius));
      if (r.destroyed) killed.push(g);
      // ONE BLAST IS ONE OUTAGE, and the thing that guarantees it is `damage`
      // refusing every call once the grid is out — not this `break`, which
      // only stops the loop walking generators it already cannot hurt. Worth
      // being precise about: a reader who believes the `break` is the guard
      // would happily delete the check in `damage` that actually is one.
      if (this.out) break;
    }
    return killed;
  }

  /** Take the mains down. Idempotent while already out — see `damage`. */
  trip() {
    if (this.out) return false;
    this.remaining = this.outage;
    this._since = 0;
    this._restore = this.restoreTime;
    return true;
  }

  /**
   * Advance the clock. Returns `true` on the frame the mains come back, so the
   * caller can emit its event without polling `out` itself.
   */
  update(dt) {
    if (!(dt > 0)) return false;
    let restored = false;
    if (this.remaining > 0) {
      this._since += dt;
      this.remaining -= dt;
      if (this.remaining <= 0) {
        this.remaining = 0;
        restored = true;
        this._restore = 0;
        /**
         * Generators come back with the mains. The alternative — a grid that
         * stays down once every generator is gone — makes the mechanic a
         * one-shot that the first thirty seconds of a match spends, and the
         * remaining nine minutes are played on a map with a dead feature.
         */
        for (const g of this.generators) {
          g.alive = true;
          g.hp = this.maxHp;
        }
      }
    } else if (this._restore < this.restoreTime) {
      this._restore = Math.min(this.restoreTime, this._restore + dt);
    }
    // Self-repair — see `POWER_DEFAULTS.regenRate`. Standing and wounded is
    // the whole condition: there is deliberately no "has it been left alone"
    // test, because that test is what a trickle defeats.
    for (const g of this.generators) {
      if (!g.alive || g.hp >= this.maxHp) continue;
      g.hp = Math.min(this.maxHp, g.hp + this.regenRate * dt);
    }
    this.level = this._envelope();
    return restored;
  }

  /**
   * The mains level for the current clock.
   *
   * Fast down, slow up, with two dips on the way out. The dips are not a
   * flourish: an instant cut reads as a renderer glitch, and the thing that
   * tells a player "somebody shot the generator" rather than "the game broke"
   * is a supply failing over a few tenths of a second.
   *
   * Deterministic — a function of the clock alone, no `rng` — so a capture of
   * an outage reproduces frame for frame.
   */
  _envelope() {
    if (this.remaining <= 0) {
      // Up, or coming back up: ramp from `dim` to full over `restoreTime`.
      if (this._restore >= this.restoreTime) return 1;
      const t = clamp01(this._restore / this.restoreTime);
      return this.dim + (1 - this.dim) * t * t;
    }
    const t = this._since;
    if (t < this.dropTime) {
      // The first fall.
      return 1 - (1 - this.dim) * clamp01(t / this.dropTime);
    }
    // Two dips back toward the authored level before it settles, each shorter
    // and weaker than the last.
    const flick = [
      [0.16, 0.09, 0.55],
      [0.34, 0.06, 0.28],
    ];
    for (const [at, len, height] of flick) {
      if (t >= at && t < at + len) {
        const u = (t - at) / len;
        // A single hump, so the dip has no corners.
        return this.dim + (1 - this.dim) * height * Math.sin(u * Math.PI);
      }
    }
    return this.dim;
  }
}

/**
 * The CITY circuit's transfer function: what fraction of authored emissive the
 * set-dressing past the playable area keeps, for a given mains `level`.
 *
 * The mains bottom out at `dim` because a fight next to a lamp mast has to
 * stay winnable in the dark — a NEAR-FIELD property, asserted in the selftest.
 * The lit rooms in the backdrop blocks are not near anything, and at even 6%
 * of authored they still read as lit windows once the night meter adapts up.
 * So their wire renormalises the level's [dim, 1] onto [0, 1]: full at full
 * mains, actual zero at the floor, riding the same envelope (and the same
 * restore ramp) as everything else so the city can never disagree with the
 * site about whether the power is on.
 *
 * Pure on purpose, like the rest of this module: `world` owns the materials,
 * this owns the arithmetic, and the selftest drives it without a renderer.
 */
export function cityLevel(level, dim) {
  const span = Math.max(1e-3, 1 - dim);
  return clamp01((level - dim) / span);
}
