import * as THREE from 'three';

/**
 * KILLSTREAKS — the reward ladder for kills earned without dying.
 *
 * The tracker is the one authority on the count. `audio` keeps a private
 * counter for its announcer (every third kill); this one is the gameplay
 * contract: it banks rewards, gates their activation, and emits the canonical
 * `streak:*` events in ARCHITECTURE.md that the HUD and `ai` react to.
 *
 * WHAT COUNTS
 *   • A bot kill: `damage:dealt` with `killed` set and a target that is not
 *     the local player. This is exactly the signal `audio` scores, so the
 *     announcer and the ladder can never disagree about a kill.
 *   • A PvP kill: `net:kill` with `mine` — the relay is what confirms those.
 *   The count resets on `player:death` and on `match:start`; kills landed on
 *   the lobby backdrop (or in a capture tableau) never score because nothing
 *   counts while no match is live.
 *
 * BANKING
 *   A reached tier is BANKED, not fired: rewards survive the death that ends
 *   the streak (CoD's contract — the streak is the price, the reward is paid).
 *   Digit5 activates the oldest banked reward; weapons own Digit1–4.
 *   Each tier can be banked once until it is spent — reaching 3 twice in one
 *   life does not stack two sweeps.
 *
 * REWARDS
 *   uav     `streak:uav { duration }` — `ai` publishes actor blips through
 *           `getHudActors()` for the window and the minimap lights up.
 *   mortar  a volley of `explosion` events walked over the point the player
 *           was aiming at. Each round is announced by a `bullet:tracer`
 *           falling out of the sky, then detonates with `source: 'player'`
 *           so `ai` credits the kill back to the streak (see the explosion
 *           listener in src/ai/index.js). Rounds land on the first surface
 *           under open sky — a roof shields whatever is beneath it.
 *
 * MULTIPLAYER: not yet on the wire. The count includes relay-confirmed PvP
 * kills, but a mortar only damages what this client owns (bots and the local
 * player) and a sweep only reveals bots. Versus-mode streaks need relay work.
 */

export const STREAK_TIERS = [
  { kills: 3, reward: 'uav' },
  { kills: 5, reward: 'mortar' },
];

/** Recon sweep window, seconds. */
export const UAV = { duration: 25 };

export const MORTAR = {
  rounds: 9,
  /** Seconds from activation to the first impact — shells in the air. */
  delay: 1.6,
  /** Seconds between rounds, plus up to `jitter` more each. */
  interval: 0.55,
  jitter: 0.3,
  /** Scatter disc radius around the aim point, metres. */
  scatter: 9,
  radius: 5.5,
  damage: 150,
  /** Rounds appear this far above the aim point and fall from there. */
  ceiling: 46,
  /** Seconds a round is visibly falling before it lands. */
  flight: 0.75,
  /** How far ahead the aim solve will look for a target point. */
  maxRange: 140,
};

/** Weapons own Digit1–4; the streak ladder takes the next key along. */
const ACTIVATE_CODE = 'Digit5';

/** Banner copy per reward id (the HUD meter keeps its own, in src/ui). */
const LABELS = { uav: 'RECON SWEEP', mortar: 'MORTAR BARRAGE' };

export class StreakTracker {
  constructor(ctx) {
    this.ctx = ctx;
    this.kills = 0;
    /** Reward ids in earn order, waiting on Digit5. */
    this.banked = [];
    /** Nothing scores or activates outside a live match. */
    this.live = false;
    /** Lazily forked so boot-time RNG draws are untouched (capture parity). */
    this._rng = null;
    /** In-flight mortar rounds: { t, fired, announced, x, z, y } (t relative). */
    this._volley = [];
    this._volleyT = 0;

    this._target = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._explosion = {
      position: new THREE.Vector3(),
      radius: MORTAR.radius,
      damage: MORTAR.damage,
      source: 'player',
    };
    this._tracer = { from: new THREE.Vector3(), to: new THREE.Vector3(), speed: 0 };
    this._killsEvent = { kills: 0 };

    this._off = [];
    const on = (t, fn) => this._off.push(ctx.events.on(t, fn));
    on('damage:dealt', (e) => {
      if (!e?.killed || this._isPlayer(e.target)) return;
      this._score();
    });
    on('net:kill', (e) => {
      if (e?.mine) this._score();
    });
    on('player:death', () => this._resetKills());
    on('match:start', () => {
      this.live = true;
      this.banked.length = 0;
      this._volley.length = 0;
      this._resetKills();
    });
    on('match:end', () => {
      this.live = false;
      this.banked.length = 0;
      this._volley.length = 0;
      this._resetKills();
    });
  }

  _isPlayer(t) {
    return t === 'player' || t?.isPlayer === true || t === this.ctx.peek('player');
  }

  _score() {
    if (!this.live) return;
    this.kills++;
    this._emitKills();
    for (const tier of STREAK_TIERS) {
      if (tier.kills !== this.kills || this.banked.includes(tier.reward)) continue;
      this.banked.push(tier.reward);
      this.ctx.events.emit('streak:earned', { reward: tier.reward, kills: this.kills });
      this._banner(`${LABELS[tier.reward] ?? tier.reward} READY`, 'PRESS 5 TO ACTIVATE');
      this._sfx('ready', 0.9);
    }
  }

  _resetKills() {
    if (this.kills === 0) return;
    this.kills = 0;
    this._emitKills();
  }

  _emitKills() {
    this._killsEvent.kills = this.kills;
    this.ctx.events.emit('streak:kills', this._killsEvent);
  }

  update(dt) {
    this._updateVolley(dt);
    if (!this.live || !this.ctx.input.enabled) return;
    if (this.ctx.input.pressed(ACTIVATE_CODE)) this.activate();
  }

  /** Fire the oldest banked reward. Returns the reward id, or null. */
  activate() {
    if (!this.banked.length) return null;
    if (this.ctx.peek('player')?.health?.dead) return null;
    const reward = this.banked[0];
    if (reward === 'mortar' && !this._solveAim(this._target)) {
      // Not consumed: aiming at open sky is a mistake, not a spent streak.
      this._banner('NO TARGET', 'AIM AT THE GROUND AND TRY AGAIN');
      return null;
    }
    this.banked.shift();
    if (reward === 'uav') {
      this.ctx.events.emit('streak:activated', { reward });
      this.ctx.events.emit('streak:uav', { duration: UAV.duration });
      this._banner('RECON SWEEP ONLINE', 'HOSTILES ON YOUR MINIMAP');
    } else if (reward === 'mortar') {
      this.ctx.events.emit('streak:activated', { reward, position: this._target });
      this._banner('MORTAR BARRAGE INBOUND', 'DANGER CLOSE — KEEP YOUR DISTANCE');
      this._scheduleVolley(this._target);
    }
    this._sfx('matchstart', 0.7);
    return reward;
  }

  /** The point the player is looking at, or false when the ray escapes the map. */
  _solveAim(out) {
    const phys = this.ctx.peek('physics');
    if (!phys) return false;
    const cam = this.ctx.camera;
    cam.getWorldDirection(this._dir);
    const hit = phys.raycast(cam.position, this._dir, MORTAR.maxRange);
    if (!hit.hit) return false;
    out.copy(hit.point);
    return true;
  }

  _scheduleVolley(centre) {
    const rng = (this._rng ??= this.ctx.rng.fork());
    this._volley.length = 0;
    this._volleyT = 0;
    for (let i = 0; i < MORTAR.rounds; i++) {
      // Uniform over the disc, so the middle of the barrage is not a magnet.
      const r = MORTAR.scatter * Math.sqrt(rng.float());
      const a = rng.float() * Math.PI * 2;
      this._volley.push({
        t: MORTAR.delay + i * MORTAR.interval + rng.float() * MORTAR.jitter,
        announced: false,
        fired: false,
        x: centre.x + Math.cos(a) * r,
        z: centre.z + Math.sin(a) * r,
        y: centre.y,
      });
    }
  }

  _updateVolley(dt) {
    if (!this._volley.length) return;
    this._volleyT += dt;
    const t = this._volleyT;
    let done = true;
    for (const round of this._volley) {
      if (!round.fired) done = false;
      if (!round.announced && t >= round.t - MORTAR.flight) {
        round.announced = true;
        this._announceRound(round);
      }
      if (!round.fired && t >= round.t) {
        round.fired = true;
        this._explosion.position.set(round.x, round.y, round.z);
        this.ctx.events.emit('explosion', this._explosion);
      }
    }
    if (done) this._volley.length = 0;
  }

  /**
   * Resolve where the round actually lands — the first surface under open sky,
   * so a roof protects the room beneath it — and send its fall down the sky as
   * a tracer (`fx` draws the streak, `audio` plays the pass-by).
   */
  _announceRound(round) {
    const phys = this.ctx.peek('physics');
    if (phys) {
      const drop = phys.raycast(round.x, round.y + MORTAR.ceiling, round.z, 0, -1, 0, MORTAR.ceiling + 40);
      if (drop.hit) round.y = drop.point.y;
    }
    const tr = this._tracer;
    // A slight lean keeps the fall from reading as a laser-straight plumb line.
    tr.from.set(round.x + MORTAR.ceiling * 0.16, round.y + MORTAR.ceiling, round.z + MORTAR.ceiling * 0.09);
    tr.to.set(round.x, round.y, round.z);
    tr.speed = tr.from.distanceTo(tr.to) / MORTAR.flight;
    this.ctx.events.emit('bullet:tracer', tr);
  }

  _banner(title, sub) {
    try {
      this.ctx.peek('ui')?.banner?.show?.(title, sub, 2.4);
    } catch {
      /* the banner is feedback, not state */
    }
  }

  _sfx(kind, level = 1) {
    try {
      this.ctx.peek('audio')?.ui(kind, level);
    } catch {
      /* feedback is optional */
    }
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this._volley.length = 0;
  }
}
