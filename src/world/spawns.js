/**
 * SPAWNS — where anybody enters the map, and who gets which point.
 *
 * The old system was eight points and `spawnPoints[(Math.random()*n)|0]`. That
 * is the one thing a shooter cannot get away with: a coin-flip spawn puts you
 * behind the man who just killed you as often as it puts you across the map,
 * and a bot garrison drawn the same way materialises in somebody's crosshair.
 *
 * WHAT POPULAR FPS SPAWNING ACTUALLY IS
 *
 * Call of Duty (and Halo, and Titanfall, with different constants) does not
 * "pick a random spawn". It scores every point in the map against the live
 * state of the match and takes one of the best few:
 *
 *   1. A HARD BUBBLE around every enemy. Nothing inside it is eligible, ever.
 *      This is the rule that stops spawn-killing; every other rule is comfort.
 *   2. NO LINE OF SIGHT. A point an enemy can see is rejected even when it is
 *      40 m away — distance does not help if he is already looking at it.
 *   3. FACING. Being inside an enemy's view cone is worse than being behind
 *      him at the same distance, because he only has to keep walking.
 *   4. TRAFFIC AND MEMORY. Points that were just used, places people just died
 *      and the man who just killed you all push the choice elsewhere, which is
 *      what stops two-player rooms degenerating into a spawn loop.
 *   5. FRIENDS PULL. In team/squad play a point near a living friend scores
 *      *up*: that is what makes a garrison hold ground instead of trickling in
 *      one man at a time.
 *   6. SPREAD ON DEPLOY. At match start nobody is anywhere yet, so the choice
 *      is made greedily — each pick repels the next — instead of independently.
 *
 * The points themselves are authored in ZONES (a cluster of 3-6 points 5-9 m
 * apart, zones 20-40 m apart), again as CoD does it. A zone is the unit the
 * map is reasoned about in: crowding is counted per zone, and picking a point
 * inside a busy zone is penalised even when that particular point is clear.
 *
 * WHO USES IT
 *   player  first spawn and every respawn                (world.selectSpawn)
 *   ai      garrison anchors, and bot reinforcements     (world.spawns)
 *   net     multiplayer respawns + remote spawn claims   (world.spawns)
 *   match   the spread deployment when a match goes live
 *
 * Everyone who can be spawned ON registers a SOURCE (`addSource`) that reports
 * its actors; the director never reaches into another subsystem. Sources are
 * pulled at the moment of a spawn, so there is no stale-position problem.
 *
 * DETERMINISM
 *   Selection never calls Math.random() and never draws from `ctx.rng` — a
 *   spawn must not perturb another subsystem's stream, and a capture run has
 *   to be reproducible. Variety comes instead from an integer hash of (salt,
 *   point, pick counter). `world` seeds the salt from its own finished RNG
 *   fork (fixed under `deterministic`, per-session otherwise) and `net`
 *   overrides it with the relay-assigned peer id, which is the only value
 *   guaranteed distinct inside a room.
 */

import * as THREE from 'three';
import { BUILDINGS, STREET, ALLEYS, GATE } from './layout.js';

/**
 * Spawn points in LEVEL space: [x, z, yaw, zone].
 *
 * Yaw faces down the lane the point sits on, toward the middle of the map —
 * you spawn looking at the play space, never at a wall two metres away.
 *
 * INDEX 0 IS FROZEN. `world.spawn(0)` is the player's boot position and the
 * deterministic capture runs frame their shots from it; moving it by a
 * centimetre changes every baseline image.
 *
 * THE FIRST EIGHT keep the old table's order — north street, plaza, market,
 * mid street, south street, gate, east alley, west alley — because
 * `tools/demo-driver.js` walks its demo bot around the map by those indices
 * and that file is not ours to edit. One point per area, in tour order; the
 * rest of the set follows grouped by zone.
 *
 * The set is validated against real collision at build time (see
 * `buildSpawnPoints`), so a point that ends up inside a prop the dressing pass
 * happened to drop there is removed rather than shipped as a spawn-in-a-crate.
 */
export const SPAWN_POINTS = [
  // ---- 0-7: one per area, in the legacy tour order ------------------------
  [0.4, 22.5, Math.PI, 'north-street'], // FROZEN — see above
  [-2.4, 30.0, 0.0, 'north-plaza'],
  [0.2, 4.6, 0.0, 'market'],
  [-3.4, -12.0, Math.PI, 'mid-street'],
  [2.6, -32.0, Math.PI, 'south-street'],
  [2.0, -39.6, Math.PI, 'gate'],
  [10.2, 4.4, Math.PI / 2, 'alley-e'],
  [-11.2, -10.3, -Math.PI / 2, 'alley-w'],

  // ---- north street (the market's north approach) -------------------------
  [-3.6, 19.2, 0.05, 'north-street'],
  [3.9, 14.6, -0.1, 'north-street'],
  [-1.4, 25.6, 0.15, 'north-street'],
  [5.0, 21.0, -0.4, 'north-street'],

  // ---- north plaza (the wide north end) -----------------------------------
  [3.0, 33.5, -0.15, 'north-plaza'],
  [-4.6, 36.5, 0.2, 'north-plaza'],
  [4.4, 28.0, 0.1, 'north-plaza'],

  // ---- north-west alley (flank onto the plaza) ----------------------------
  [-9.2, 22.3, -Math.PI / 2, 'alley-nw'],
  [-14.0, 22.6, -Math.PI / 2 + 0.1, 'alley-nw'],
  [-19.0, 21.8, -Math.PI / 2, 'alley-nw'],

  // ---- market (the middle of the map, and its busiest ground) -------------
  [-1.6, 8.6, 0.1, 'market'],
  [4.4, 8.4, -0.2, 'market'],
  [-4.8, 1.6, 0.25, 'market'],
  [1.8, 11.4, -0.1, 'market'],

  // ---- west courtyard (flank into the market) -----------------------------
  [-9.4, 7.6, -Math.PI / 2, 'court-w'],
  [-14.5, 7.4, -Math.PI / 2 - 0.15, 'court-w'],
  [-19.5, 8.2, -Math.PI / 2, 'court-w'],

  // ---- east alley (the long flank) ----------------------------------------
  [14.5, 5.2, Math.PI / 2 + 0.1, 'alley-e'],
  [19.5, 4.0, Math.PI / 2, 'alley-e'],
  [24.5, 5.6, Math.PI / 2, 'alley-e'],

  // ---- mid street ---------------------------------------------------------
  [3.2, -5.4, Math.PI - 0.1, 'mid-street'],
  [-4.4, -17.4, Math.PI + 0.15, 'mid-street'],
  [1.0, -15.0, Math.PI, 'mid-street'],

  // ---- west alley (flank onto mid street) ---------------------------------
  [-15.5, -10.0, -Math.PI / 2 + 0.1, 'alley-w'],
  [-20.0, -10.6, -Math.PI / 2, 'alley-w'],

  // ---- south street (the run down to the gate) ----------------------------
  [-3.8, -24.6, Math.PI, 'south-street'],
  [4.2, -22.6, Math.PI + 0.15, 'south-street'],
  [-1.4, -36.4, Math.PI, 'south-street'],
  [5.2, -35.6, Math.PI - 0.1, 'south-street'],

  // ---- the gate (a chokepoint: deliberately thin) -------------------------
  [0.0, -43.2, Math.PI, 'gate'],
  [-4.0, -40.2, Math.PI, 'gate'],

  // ---- far cross street (behind the gate) ---------------------------------
  [-6.0, -46.5, Math.PI, 'cross-street'],
  [5.5, -46.8, Math.PI - 0.15, 'cross-street'],
  [-14.0, -47.0, -Math.PI / 2, 'cross-street'],
  [13.5, -47.4, Math.PI / 2, 'cross-street'],
  [-22.0, -46.6, -Math.PI / 2, 'cross-street'],
  [21.0, -47.2, Math.PI / 2, 'cross-street'],
];

/**
 * Every constant the scoring uses, in metres and seconds.
 *
 * The two that decide whether the system feels right are `hardMinEnemy` (CoD
 * is in the same 10-20 m band on maps this size) and `losRange`: raise the
 * first and a 2-player room runs out of legal spawns, lower it and you spawn
 * in a firefight. `relax` is the ladder walked when nothing qualifies — it
 * gives up the comfort rules one at a time and only ever gives up the hard
 * bubble last, because a spawn has to be produced no matter how contested the
 * map is.
 */
export const TUNING = {
  /** Nothing within this of a living enemy is eligible at relax 0. */
  hardMinEnemy: 14,
  /** Enemy distance stops earning score beyond this. */
  softEnemy: 42,
  /**
   * An enemy further away than this cannot veto a point by looking at it.
   *
   * Measured on this map, not guessed: at 55 m a respawn still landed in a
   * bot's sights 11 times in 180 pairs, every one of them down the length of
   * the main street. The street is ~100 m end to end and it is straight, so
   * the veto has to reach the whole of it — a rifle certainly does.
   */
  losRange: 95,
  /** Points whose cheap score survives get the (expensive) LOS test. */
  shortlist: 12,
  /** How many enemies get an LOS ray, nearest first. */
  losEnemies: 8,

  /** Being in front of an enemy: cone half-angle as a cosine, and its reach. */
  coneCos: 0.55,
  coneRange: 38,

  /** Team play: a friend this far away is the ideal anchor. */
  friendIdeal: 13,
  friendMin: 4,
  friendMax: 26,

  /** Anybody (either side) inside this counts toward the point's crowding. */
  crowdRadius: 12,

  /** A point stays "hot" this long after somebody spawned on it. */
  reuse: 9,
  /** Deaths are remembered this long, and poison this far. */
  deathMemory: 12,
  deathRadius: 16,
  /** A remote player's announced spawn blocks its neighbourhood this long. */
  claimTtl: 2.5,
  claimRadius: 12,
  /** How far from the man who just killed you the director tries to get. */
  killerMin: 30,
  /** …and from the spot you died on. */
  deathSiteRadius: 18,

  /* weights — all in the same arbitrary "points" as the 0-100 base score */
  wDistance: 55,
  wCone: 28,
  wFriend: 18,
  wCrowd: 7,
  wZoneCrowd: 9,
  wReuse: 22,
  wSameActor: 14,
  wDeath: 30,
  wClaim: 90,
  wKiller: 40,
  wDeathSite: 12,
  wLos: 45,
  wJitter: 8,

  /** Candidates within this of the best are all live options for the pick. */
  spread: 10,
};

/* ────────────────────────────────────────────────────────────────────────── */
/* placement helpers                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Is (x, z) on ground a character can stand on, in LEVEL space?
 *
 * Deliberately NOT `dressing.isOpen()`: that one takes the alley rects at face
 * value, and one of them is authored with its z pair reversed, so it reports
 * its own map's far yard as solid. This normalises the rect and adds the gate
 * arch, which is a doorway through an otherwise solid mass. It is only ever a
 * first filter — real collision decides, in `buildSpawnPoints`.
 */
export function standableAt(x, z, margin = 0.55) {
  for (const b of BUILDINGS) {
    const hw = b.w / 2 + margin;
    const hd = b.d / 2 + margin;
    if (Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd) return false;
  }
  // The gate mass — solid except for the archway punched through the middle.
  if (Math.abs(z - GATE.z) < GATE.depth / 2 + margin && Math.abs(x) < GATE.outerW / 2) {
    if (Math.abs(x) > GATE.span / 2 - margin) return false;
  }
  if (Math.abs(x) < STREET.kerb - margin && z > STREET.zMin + margin && z < STREET.zMax - margin) {
    return true;
  }
  for (const a of ALLEYS) {
    const [ax0, az0, ax1, az1] = a.rect;
    const x0 = Math.min(ax0, ax1), x1 = Math.max(ax0, ax1);
    const z0 = Math.min(az0, az1), z1 = Math.max(az0, az1);
    if (x > x0 + margin && x < x1 - margin && z > z0 + margin && z < z1 - margin) return true;
  }
  return false;
}

/**
 * Turn the authored table into validated, world-space spawn points.
 *
 * `toWorld(x, y, z)` maps level -> world (the caller owns the level transform),
 * `groundY(x, z, fromY)` is the exact floor from collision, and
 * `clear(x, y, z)` asks whether a standing character fits. A point that fails
 * any of them is dropped with a reason rather than shipped — a spawn inside a
 * market stall is worse than one fewer spawn.
 *
 * The floor probe starts just over head height rather than from the sky: the
 * street is roofed by awnings, cables and laundry lines, and a probe from
 * above lands on those and puts the spawn on a canvas roof. The result is then
 * checked against the level's own datum, so a probe that came down on a crate
 * instead of the road drops the point.
 *
 * `standable` is the map's own cheap occupancy test — `standableAt` above is
 * the MARKET's, and every map descriptor supplies its own (see
 * `src/world/maps.js`). Passing it in rather than importing one keeps this
 * module free of any particular level's layout.
 */
export function buildSpawnPoints(table, { toWorld, groundY, clear, log, standable } = {}) {
  const points = [];
  const dropped = [];
  const open = standable ?? standableAt;
  for (let i = 0; i < table.length; i++) {
    const [lx, lz, yaw, zone] = table[i];
    const frozen = i === 0;
    if (!frozen && !open(lx, lz)) {
      dropped.push({ zone, lx, lz, why: 'not open ground' });
      continue;
    }
    const p = toWorld ? toWorld(lx, 0, lz) : new THREE.Vector3(lx, 0, lz);
    const datum = p.y;
    if (groundY) {
      const gy = groundY(p.x, p.z, datum + 2.4);
      if (!frozen && !Number.isFinite(gy)) {
        dropped.push({ zone, lx, lz, why: 'no floor' });
        continue;
      }
      if (!frozen && (gy > datum + 0.6 || gy < datum - 1.0)) {
        dropped.push({ zone, lx, lz, why: `floor at ${(gy - datum).toFixed(2)}m` });
        continue;
      }
      if (Number.isFinite(gy)) p.y = gy + 0.03;
    }
    if (!frozen && clear && !clear(p.x, p.y, p.z)) {
      dropped.push({ zone, lx, lz, why: 'blocked' });
      continue;
    }
    points.push(makePoint(points.length, p, yaw, zone, lx, lz));
  }
  if (log && dropped.length) {
    log(
      `[spawns] dropped ${dropped.length}/${table.length}: ` +
        dropped.map((d) => `${d.zone}(${d.lx},${d.lz}) ${d.why}`).join(', ')
    );
  }
  return points;
}

function makePoint(index, position, yaw, zone, lx = 0, lz = 0) {
  return {
    index,
    /** WORLD space. Callers copy out of this; nothing writes to it. */
    position: position.isVector3 ? position : new THREE.Vector3(position.x, position.y, position.z),
    /** WORLD yaw, already carrying the level->world rotation. */
    yaw,
    zone,
    tag: zone,
    /** level-space coordinates, kept for logs and the selftest */
    lx,
    lz,
    lastUsed: -1e9,
    lastActor: null,
    uses: 0,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* the director                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Unknown teams are hostile to everybody — the safe reading for a spawn. */
function hostile(a, b) {
  if (a == null || b == null) return true;
  return a !== b;
}

/**
 * Integer hash -> [0,1). Variety without touching an RNG stream.
 *
 * Math.imul throughout: a plain `*` on 32-bit inputs overflows into the float
 * mantissa and throws away exactly the low bits a hash lives on.
 */
function hash01(a, b, c) {
  let h =
    (Math.imul(a | 0, 0x27d4eb2d) + Math.imul(b | 0, 0x165667b1) + Math.imul(c | 0, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class SpawnDirector {
  /**
   * @param opts.points  from `buildSpawnPoints`
   * @param opts.los     (ax,ay,az, bx,by,bz) => boolean — clear line of sight
   * @param opts.tuning  overrides for TUNING
   * @param opts.salt    per-client tie-breaker (the relay peer id, or 0)
   * @param opts.sources source list to ADOPT BY REFERENCE, from a director this
   *                     one replaces. `world` hands the old list over when the
   *                     level is rebuilt on another map: `player`, `ai` and
   *                     `net` register once at init and would otherwise be
   *                     invisible to the new director — every spawn would then
   *                     score as if the map were empty. Adopting the array
   *                     itself (rather than copying it) keeps the unsubscribe
   *                     closures `addSource` already handed out working.
   */
  constructor(opts = {}) {
    this.points = opts.points ?? [];
    this.los = opts.los ?? null;
    this.tuning = { ...TUNING, ...(opts.tuning ?? {}) };
    this.salt = (opts.salt ?? 0) | 0;
    this.time = 0;
    this.picks = 0;

    /** zone name -> { name, points[], count } — crowding is counted per zone. */
    this.zones = new Map();
    for (const p of this.points) {
      let z = this.zones.get(p.zone);
      if (!z) this.zones.set(p.zone, (z = { name: p.zone, points: [], count: 0 }));
      z.points.push(p);
    }

    this._sources = opts.sources ?? [];
    /** Pooled actor records: gathering a spawn must not allocate. */
    this._actors = [];
    this._actorCount = 0;
    this._deaths = [];
    this._claims = [];

    const n = this.points.length;
    this._score = new Float64Array(n);
    this._order = new Int32Array(n);
    this._shortlist = new Int32Array(n);
    /** Points this selection has already ruled out — see `select`. */
    this._rejected = new Uint8Array(n);

    this._add = (x, y, z, yaw = 0, team = null, id = null, dead = false) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      let a = this._actors[this._actorCount];
      if (!a) this._actors[this._actorCount] = a = { x: 0, y: 0, z: 0, yaw: 0, team: null, id: null, dead: false };
      a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.team = team; a.id = id; a.dead = !!dead;
      this._actorCount++;
    };

    /** Last decision, for the dev overlay and the selftest. */
    this.lastPick = null;
  }

  /* ---------------------------------------------------------------- sources */

  /**
   * Register a function that reports live actors:
   *   world.spawns.addSource((add) => { for (…) add(x, y, z, yaw, team, id, dead); });
   * Returns an unsubscribe function — call it in your dispose().
   */
  addSource(fn) {
    if (typeof fn !== 'function') return () => {};
    this._sources.push(fn);
    return () => {
      const i = this._sources.indexOf(fn);
      if (i >= 0) this._sources.splice(i, 1);
    };
  }

  /** The live source list, for a director that is about to replace this one. */
  get sources() {
    return this._sources;
  }

  /** Per-client tie-breaker. `net` calls this with its relay-assigned id. */
  setSalt(n) {
    this.salt = (Number(n) || 0) | 0;
  }

  /* ------------------------------------------------------------- match memory */

  /** Somebody died here. Poisons the neighbourhood for `deathMemory` seconds. */
  noteDeath(x, y, z) {
    if (!Number.isFinite(x)) return;
    this._deaths.push({ x, y, z, t: this.time });
    if (this._deaths.length > 48) this._deaths.shift();
  }

  /**
   * Somebody is about to spawn here (a remote player's announcement, or one of
   * our own picks inside a `selectMany`). Blocks the neighbourhood briefly so
   * two spawns cannot land on top of each other.
   */
  noteClaim(x, y, z, ttl = this.tuning.claimTtl, radius = this.tuning.claimRadius) {
    if (!Number.isFinite(x)) return;
    this._claims.push({ x, y, z, until: this.time + ttl, r: radius });
    if (this._claims.length > 32) this._claims.shift();
  }

  /** Decay the memories. Called once a frame by `world`; allocates nothing. */
  update(dt) {
    this.time += dt;
    const memory = this.tuning.deathMemory;
    while (this._deaths.length && this.time - this._deaths[0].t > memory) this._deaths.shift();
    while (this._claims.length && this._claims[0].until < this.time) this._claims.shift();
  }

  /* ------------------------------------------------------------- selection  */

  /**
   * Pick a spawn.
   *
   * @param opts.team      my team; anybody on another team is an enemy. Give
   *                       every free-for-all player a unique team.
   * @param opts.actorId   me — so I do not count myself as a threat.
   * @param opts.killer    {x,y,z} of whoever just killed me, if anybody.
   * @param opts.from      {x,y,z} where I died.
   * @param opts.anchor    {x,y,z} to come in NEAR (a squad's surviving centre)
   * @param opts.anchorWeight  how hard `anchor` pulls (default 30)
   * @param opts.exclude   points that are not options this time
   * @param opts.claim     announce the pick as a claim (default true)
   * @param opts.claimRadius  how much ground the claim reserves (default 12 m)
   * @param opts.relaxed   start the ladder further down
   * @returns the chosen point, or null when the map has no points at all.
   */
  select(opts = {}) {
    const n = this.points.length;
    if (!n) return null;
    this._gather();
    this._countZones(opts);

    for (let relax = opts.relaxed | 0; relax <= 2; relax++) {
      // The shortlist is a dozen points, and line of sight can reject all of
      // them; walk the next dozen before giving up a rule. Dropping to relax 1
      // because the twelve best happened to be visible would spawn people in
      // sight of an enemy while a perfectly good alley sat unused.
      this._rejected.fill(0);
      for (let round = 0; round < 4; round++) {
        const count = this._rank(opts, relax);
        if (!count) break;
        const chosen = this._refine(count, opts, relax);
        if (chosen) return this._commit(chosen, opts, relax);
      }
    }
    this._rejected.fill(0);
    // The map is wall-to-wall enemies. Take the furthest point from all of them
    // rather than returning nothing — a spawn always has to be produced.
    const far = this._furthest(opts);
    return far ? this._commit(far, opts, 3) : null;
  }

  /**
   * Pick `count` points at once, each repelling the next.
   *
   * This is the deploy case: at match start nobody is standing anywhere yet, so
   * independent picks would all land on the same "best" point. Used for the bot
   * garrison's squad anchors and for staggered player deployment.
   */
  selectMany(count, opts = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = this.select({ ...opts, claim: true });
      if (!p) break;
      out.push(p);
    }
    return out;
  }

  /* ------------------------------------------------------------- internals  */

  _gather() {
    this._actorCount = 0;
    for (let i = 0; i < this._sources.length; i++) {
      try {
        this._sources[i](this._add);
      } catch (err) {
        console.warn('[spawns] source failed', err);
      }
    }
  }

  /**
   * How many living actors are standing in each zone. Zone crowding is what
   * keeps a room moving: a point can be individually clear and still be a bad
   * answer because three men are fighting over the next slab.
   */
  _countZones(opts) {
    for (const z of this.zones.values()) z.count = 0;
    for (let i = 0; i < this._actorCount; i++) {
      const a = this._actors[i];
      if (a.dead || (opts.actorId != null && a.id === opts.actorId)) continue;
      let best = null;
      let bestD = Infinity;
      for (const p of this.points) {
        const d = (p.position.x - a.x) ** 2 + (p.position.z - a.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best && bestD < 30 * 30) {
        const z = this.zones.get(best.zone);
        if (z) z.count++;
      }
    }
  }

  /** Cheap pass over every point. Fills `_shortlist`, best first. */
  _rank(opts, relax) {
    const pts = this.points;
    const score = this._score;
    const order = this._order;
    let live = 0;
    for (let i = 0; i < pts.length; i++) {
      const s = this._rejected[i] ? -Infinity : this._cheapScore(pts[i], opts, relax);
      score[i] = s;
      if (s > -Infinity) order[live++] = i;
    }
    if (!live) return 0;
    // Partial sort: the shortlist is small, so a selection sort over `live` is
    // cheaper than sorting everything and allocates nothing.
    const want = Math.min(this.tuning.shortlist, live);
    for (let a = 0; a < want; a++) {
      let best = a;
      for (let b = a + 1; b < live; b++) if (score[order[b]] > score[order[best]]) best = b;
      const t = order[a];
      order[a] = order[best];
      order[best] = t;
      this._shortlist[a] = order[a];
    }
    return want;
  }

  _cheapScore(p, o, relax) {
    const T = this.tuning;
    const hardMin = T.hardMinEnemy * (relax === 0 ? 1 : relax === 1 ? 0.65 : 0.3);
    let nearestEnemy = Infinity;
    let cone = 0;
    let friend = 0;
    let crowd = 0;

    for (let i = 0; i < this._actorCount; i++) {
      const a = this._actors[i];
      if (a.dead) continue;
      if (o.actorId != null && a.id != null && a.id === o.actorId) continue;
      const dx = a.x - p.position.x;
      const dy = a.y - p.position.y;
      const dz = a.z - p.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < T.crowdRadius) crowd++;
      if (hostile(a.team, o.team)) {
        if (d < nearestEnemy) nearestEnemy = d;
        if (d < T.coneRange && d > 0.01) {
          // Is the point inside his view cone? Forward is (-sin yaw, -cos yaw).
          const inv = 1 / Math.max(0.001, Math.hypot(dx, dz));
          const dot = -dx * inv * -Math.sin(a.yaw) + -dz * inv * -Math.cos(a.yaw);
          if (dot > T.coneCos) {
            cone += ((dot - T.coneCos) / (1 - T.coneCos)) * (1 - d / T.coneRange);
          }
        }
      } else if (d > T.friendMin && d < T.friendMax) {
        friend = Math.max(friend, 1 - Math.abs(d - T.friendIdeal) / T.friendMax);
      }
    }
    if (nearestEnemy < hardMin) return -Infinity;

    let s = 0;
    s += T.wDistance * clamp01((nearestEnemy - hardMin) / Math.max(1, T.softEnemy - hardMin));
    s -= T.wCone * Math.min(2, cone);
    s += T.wFriend * friend;
    s -= T.wCrowd * Math.max(0, crowd - 1);

    const zone = this.zones.get(p.zone);
    if (zone) s -= T.wZoneCrowd * Math.max(0, zone.count - 1);

    const since = this.time - p.lastUsed;
    if (since < T.reuse) {
      s -= T.wReuse * (1 - since / T.reuse);
      if (o.actorId != null && p.lastActor === o.actorId) s -= T.wSameActor;
    }

    for (let i = 0; i < this._deaths.length; i++) {
      const d = this._deaths[i];
      const age = this.time - d.t;
      if (age > T.deathMemory) continue;
      const dist = Math.hypot(d.x - p.position.x, d.z - p.position.z);
      if (dist > T.deathRadius) continue;
      s -= T.wDeath * (1 - age / T.deathMemory) * (1 - dist / T.deathRadius);
    }

    for (let i = 0; i < this._claims.length; i++) {
      const c = this._claims[i];
      if (c.until < this.time) continue;
      const r = c.r ?? T.claimRadius;
      const dist = Math.hypot(c.x - p.position.x, c.z - p.position.z);
      if (dist > r) continue;
      s -= T.wClaim * (1 - dist / r);
    }

    if (o.killer) {
      const dk = Math.hypot(o.killer.x - p.position.x, o.killer.z - p.position.z);
      if (dk < T.killerMin) s -= T.wKiller * (1 - dk / T.killerMin);
    }
    if (o.from) {
      const df = Math.hypot(o.from.x - p.position.x, o.from.z - p.position.z);
      if (df < T.deathSiteRadius) s -= T.wDeathSite * (1 - df / T.deathSiteRadius);
    }
    if (o.anchor) {
      // Reinforcements want to come in near their squad, not across the map.
      const da = Math.hypot(o.anchor.x - p.position.x, o.anchor.z - p.position.z);
      s += (o.anchorWeight ?? 30) * clamp01(1 - da / 45);
    }
    if (o.exclude && o.exclude.includes(p)) return -Infinity;

    s += T.wJitter * hash01(this.salt, p.index, this.picks);
    return s;
  }

  /**
   * Expensive pass over the shortlist: line of sight, then the weighted pick.
   *
   * LOS is deliberately last. It is the strongest rule in the system and the
   * only one that needs the collision world, so it runs against a dozen points
   * instead of all of them — a respawn costs a few dozen rays, not a few
   * hundred.
   */
  _refine(count, o, relax) {
    const T = this.tuning;
    const sl = this._shortlist;
    const score = this._score;
    let best = -Infinity;
    let live = 0;
    for (let i = 0; i < count; i++) {
      const p = this.points[sl[i]];
      const seen = this.los ? this._seenBy(p, o) : 0;
      if (seen && relax === 0) {
        score[sl[i]] = -Infinity;
        // Remember it so the next round reaches further down the map instead
        // of shortlisting the same visible points again.
        this._rejected[sl[i]] = 1;
        continue;
      }
      if (seen) score[sl[i]] -= T.wLos * Math.min(2, seen);
      sl[live++] = sl[i];
      if (score[sl[live - 1]] > best) best = score[sl[live - 1]];
    }
    if (!live) return null;

    // Everything within `spread` of the best is a legitimate answer; choosing
    // among them by hash is what stops a two-player room using the same two
    // slabs all match.
    let total = 0;
    for (let i = 0; i < live; i++) {
      const s = score[sl[i]];
      total += s >= best - T.spread ? s - (best - T.spread) + 1 : 0;
    }
    let r = hash01(this.salt, this.picks, o.actorId == null ? 0 : String(o.actorId).length) * total;
    for (let i = 0; i < live; i++) {
      const s = score[sl[i]];
      if (s < best - T.spread) continue;
      r -= s - (best - T.spread) + 1;
      if (r <= 0) return this.points[sl[i]];
    }
    return this.points[sl[0]];
  }

  /** How many enemies can see this point. Nearest `losEnemies` are tested. */
  _seenBy(p, o) {
    const T = this.tuning;
    let seen = 0;
    let tested = 0;
    // Nearest-first without sorting: walk the actors, test the close ones.
    for (let pass = 0; pass < 2 && tested < T.losEnemies; pass++) {
      const near = pass === 0 ? T.coneRange : T.losRange;
      const far = pass === 0 ? 0 : T.coneRange;
      for (let i = 0; i < this._actorCount && tested < T.losEnemies; i++) {
        const a = this._actors[i];
        if (a.dead || !hostile(a.team, o.team)) continue;
        if (o.actorId != null && a.id != null && a.id === o.actorId) continue;
        const d = Math.hypot(a.x - p.position.x, a.z - p.position.z);
        if (d > near || d <= far) continue;
        tested++;
        if (this.los(a.x, a.y + 1.5, a.z, p.position.x, p.position.y + 1.2, p.position.z)) seen++;
      }
    }
    return seen;
  }

  _furthest(o) {
    let best = null;
    let bestD = -Infinity;
    for (const p of this.points) {
      if (o.exclude && o.exclude.includes(p)) continue;
      let nearest = Infinity;
      for (let i = 0; i < this._actorCount; i++) {
        const a = this._actors[i];
        if (a.dead || !hostile(a.team, o.team)) continue;
        if (o.actorId != null && a.id != null && a.id === o.actorId) continue;
        const d = Math.hypot(a.x - p.position.x, a.z - p.position.z);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestD) {
        bestD = nearest;
        best = p;
      }
    }
    return best;
  }

  _commit(point, o, relax) {
    point.lastUsed = this.time;
    point.lastActor = o.actorId ?? null;
    point.uses++;
    this.picks++;
    if (o.claim !== false) {
      this.noteClaim(
        point.position.x, point.position.y, point.position.z,
        o.claimTtl ?? this.tuning.claimTtl,
        o.claimRadius ?? this.tuning.claimRadius
      );
    }
    this.lastPick = {
      zone: point.zone,
      index: point.index,
      relax,
      score: this._score[point.index],
      actors: this._actorCount,
    };
    return point;
  }

  /** Snapshot for logs and the dev overlay. */
  get stats() {
    return {
      points: this.points.length,
      zones: this.zones.size,
      sources: this._sources.length,
      picks: this.picks,
      deaths: this._deaths.length,
      claims: this._claims.length,
      last: this.lastPick,
    };
  }
}

export { makePoint as _makeSpawnPoint };
