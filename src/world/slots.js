/**
 * WORLD — slot machines.
 *
 * A map can declare a bank of slot machines (Clifton Hill's midway carries
 * one). Walk up, press use, and the machine takes a pull of HEALTH and spins.
 *
 *   JACKPOT  7 7 7         invincible for `invuln` seconds
 *   PAYOUT   any triple    full health and a restocked reserve
 *   (else)   nothing       — the health is gone, and regen is held off
 *
 * WHY HEALTH AND NOT AMMO. Ammo is an invisible cost: a reserve you will not
 * run dry this life is not felt, and there are no pickups to make it scarce in
 * a way the player can read. Health is the one resource everybody watches. A
 * pull hits the bar, starts the low-health heartbeat after a few, and — the
 * real price — restarts the regen delay, so a gambler stands in the busiest
 * hall on the map wounded. The bet is against the room, not against the
 * machine. A pull can never kill: it is refused unless you have more than
 * `cost` to give.
 *
 * WHY THE OUTCOME IS DRAWN FIRST. Independent reels make the jackpot odds a
 * cube of a symbol weight, which ties "how often does 7 7 7 land" to "how
 * often does any triple land" and leaves no clean knob. Real machines solve
 * this with virtual reels; this does the same: one draw picks the outcome from
 * a stated table, and the three symbols shown are then composed to match it —
 * a losing pull sometimes shows the 7 7 _ near miss, because that is what
 * makes the next pull feel worth it. `slots.selftest.mjs` states the table.
 *
 * WHY A COOLDOWN AFTER A JACKPOT. Invincibility chained into invincibility is
 * a player nobody can kill. After a jackpot the whole bank refuses that player
 * for `lockout` seconds (counted from the win, so it covers the invincible
 * window and then some).
 *
 * THIS MODULE IS PURE, like `power.js`: no `THREE`, no ctx, no events. Time is
 * advanced by `update(dt)`, randomness comes in as a `() => [0,1)` function
 * (the world passes its seeded `rng`), and `WorldSystem` turns what `pull()`
 * and `update()` return into health, HUD and sound.
 */

export const SLOT_DEFAULTS = {
  /** Health per pull. Five pulls is a full bar; the fifth is always refused. */
  cost: 20,
  /** Seconds the reels run. The three reels stop at these fractions of it. */
  spinTime: 1.5,
  stops: [0.5, 0.75, 1],
  /** Odds per pull. The rest is a loss. */
  pJackpot: 1 / 12,
  pPayout: 1 / 6,
  /** Of the losses, how many are dressed as the 7 7 _ near miss. */
  pTease: 0.3,
  /** Invincibility on a jackpot, seconds. */
  invuln: 6,
  /** Seconds after a jackpot before the same player may pull again. */
  lockout: 30,
  /** Metres from a machine's front at which it can be used. */
  reach: 1.35,
  /**
   * Metres of height between the player's feet and the machine's floor. The
   * midway's roof is the speedway, standing right over the bank — without
   * this, a player up there lights the prompt through the ceiling.
   */
  reachY: 1.0,
};

export const SYMBOLS = ['7', 'BAR', 'BELL', 'CHERRY'];
export const SEVEN = 0;

/** The outcome a set of three symbols means. */
export function judge(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return a === SEVEN ? 'jackpot' : 'payout';
  return 'lose';
}

/**
 * Draw one pull: the outcome from the table, then three symbols that show it.
 * @param {() => number} rand  uniform [0,1)
 * @returns {{ outcome: 'jackpot'|'payout'|'lose', reels: number[] }}
 */
export function drawPull(rand, cfg = SLOT_DEFAULTS) {
  const n = SYMBOLS.length;
  const pick = (k) => Math.min(k - 1, Math.floor(rand() * k));
  const u = rand();
  if (u < cfg.pJackpot) return { outcome: 'jackpot', reels: [SEVEN, SEVEN, SEVEN] };
  if (u < cfg.pJackpot + cfg.pPayout) {
    const s = 1 + pick(n - 1); // any symbol but the seven
    return { outcome: 'payout', reels: [s, s, s] };
  }
  // A loss. Either the tease — two sevens and a miss on the last reel — or
  // three symbols that are anything but a triple.
  if (rand() < cfg.pTease) return { outcome: 'lose', reels: [SEVEN, SEVEN, 1 + pick(n - 1)] };
  const a = pick(n);
  const b = pick(n);
  let c = pick(n);
  if (a === b && c === a) c = (c + 1 + pick(n - 1)) % n;
  return { outcome: 'lose', reels: [a, b, c] };
}

/**
 * The bank: where the machines are, which one the player is at, and the one
 * local player's spin and lockout. Machines are `{ x, y, z, fx, fz }` — the
 * point on the floor in front of the reels (y is the floor's height), and the
 * unit direction the machine faces (toward the player using it), all in level
 * space.
 */
export class SlotBank {
  constructor(spec = {}) {
    this.cfg = { ...SLOT_DEFAULTS, ...spec };
    this.machines = (spec.machines ?? []).map((m, i) => ({ id: i, ...m }));
    /** The spin in flight: { machine, reels, outcome, t, shown } or null. */
    this.spin = null;
    /** Seconds until this player may pull again after a jackpot. */
    this.lockout = 0;
  }

  /**
   * The machine a player with feet at (x, y, z) looking along (lx, lz) is
   * using, or null. Inside `reach` of its front, on its floor, AND facing it
   * — so walking down the aisle with your back to the bank does not light the
   * prompt, and neither does standing on the roof above it.
   */
  machineAt(x, y, z, lx, lz) {
    let best = null;
    let bestD = this.cfg.reach;
    for (const m of this.machines) {
      if (Math.abs(y - (m.y ?? 0)) > this.cfg.reachY) continue;
      const dx = x - m.x;
      const dz = z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      // standing in front of it, not behind the row
      if (dx * m.fx + dz * m.fz < -0.2) continue;
      // looking at it: the view points back against the machine's facing
      const ll = Math.hypot(lx, lz) || 1;
      if ((lx * m.fx + lz * m.fz) / ll > -0.35) continue;
      best = m;
      bestD = d;
    }
    return best;
  }

  /**
   * Why a pull would be refused right now, or null if it would be taken.
   * @param {number} health  the player's current health
   */
  refusal(health) {
    if (this.spin) return 'spinning';
    if (this.lockout > 0) return 'lockout';
    if (!(health > this.cfg.cost)) return 'health';
    return null;
  }

  /**
   * Pull the lever. Returns the spin (the caller charges `cfg.cost` health
   * immediately) or null if refused. The result is decided here but only
   * PAID by `update()` once the last reel stops.
   */
  pull(machine, health, rand) {
    if (!machine || this.refusal(health)) return null;
    const d = drawPull(rand, this.cfg);
    this.spin = { machine, reels: d.reels, outcome: d.outcome, t: 0, shown: 0 };
    return this.spin;
  }

  /**
   * Advance the clock. Returns null on most frames; `{ type: 'reel', index }`
   * when a reel stops, and `{ type: 'result', outcome, reels }` on the frame
   * the last one does (one event per call — a long frame catches up next
   * call, and the result is always the last thing a spin reports).
   */
  update(dt) {
    if (this.lockout > 0) this.lockout = Math.max(0, this.lockout - dt);
    const s = this.spin;
    if (!s) return null;
    s.t += dt;
    const stops = this.cfg.stops;
    if (s.shown < stops.length && s.t >= stops[s.shown] * this.cfg.spinTime) {
      const index = s.shown++;
      if (s.shown < stops.length) return { type: 'reel', index };
      this.spin = null;
      if (s.outcome === 'jackpot') this.lockout = this.cfg.lockout;
      return { type: 'result', outcome: s.outcome, reels: s.reels, machine: s.machine };
    }
    return null;
  }

  /** The symbols to show this frame: stopped reels show their stop, the rest roll. */
  face(rollT, out = []) {
    const s = this.spin;
    const n = SYMBOLS.length;
    for (let i = 0; i < 3; i++) {
      if (s && i < s.shown) out[i] = s.reels[i];
      else out[i] = Math.floor(rollT * 14 + i * 1.7) % n;
    }
    return out;
  }

  /** A death or a respawn ends the spin unpaid (the health is already gone). */
  cancel() {
    this.spin = null;
  }

  /** A new match: no spin and no lockout carried over. */
  reset() {
    this.spin = null;
    this.lockout = 0;
  }
}
