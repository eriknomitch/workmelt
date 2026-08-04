import * as THREE from 'three';
import { BOX, BOX_THIN, IDENT, LL, stairRun } from './kit.js';
import { registerBloodGulchProps } from './bloodgulchprops.js';
import { fbm3 } from './util.js';

/**
 * WORLD — BLOOD GULCH.
 *
 * A box canyon with a base at each end, after the Halo map. 104 x 72 m of grass
 * between two rock walls, and PERFORMANCE IS THE BRIEF — the map is authored to
 * be the cheapest thing in the game to draw, and every decision below that could
 * have gone the other way went this way for that reason:
 *
 *   FLAT SURFACES        every key is `bg_*` (palette.js): one shared 256 bake,
 *                        tinted. No normal maps, no weathering, no vertex
 *                        masks, no macro variation — those blocks compile out
 *                        of the shader entirely rather than being multiplied by
 *                        zero at runtime.
 *   BLOCKED-OUT FORMS    cliffs, buttresses, ridges and the central spire are
 *                        chamfered boxes at a few degrees to one another. A
 *                        canyon wall is the largest thing on screen at all
 *                        times, and it costs ~44 triangles per block.
 *   TWO PROTOTYPES       a boulder and a scatter stone (`bloodgulchprops.js`).
 *   NO SHARED PROP LIB   `registerProps` is deliberately NOT called: it builds
 *                        ~70 prototype geometries this map never places, and
 *                        every one of them is build-time work and garbage on a
 *                        map that wants neither.
 *   NO OUTER COLLISION   the terrain beyond the cliffs carries no proxy. The
 *                        perimeter is sealed, so nothing out there is reachable
 *                        and its triangles would only be BVH physics walks.
 *
 * The whole map lands around 15 draw calls against a budget of 320.
 *
 * LAYOUT (LEVEL space, origin at the canyon centre, north at -Z, x is the
 * base-to-base axis):
 *
 *        -Z                          x = -52 .. +52,  z = -36 .. +36
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ▓▓▓▓▓ buttress ▓▓▓        ridge          ▓▓▓ buttress ▓▓▓▓▓  │
 *   │        ridge                                    ridge        │
 *   │  ▓▓ ┌─────────┐                        ┌─────────┐ ▓▓        │
 *   │ rock│  RED    │≡ramp        /\        ≡│  BLUE   │rock       │
 *   │ fall│  BASE   │           /TOOTH\      │  BASE   │fall       │
 *   │  ▓▓ └─────────┘≡ramp        \/         └─────────┘ ▓▓        │
 *   │        ridge                                    ridge        │
 *   │ ▓▓▓▓▓ buttress ▓▓▓        ridge          ▓▓▓ buttress ▓▓▓▓▓  │
 *   └──────────────────────────────────────────────────────────────┘
 *        +Z
 *
 *   THE BASES     20 x 18 m, mirrored by a half-turn, 62 m apart. Each is a
 *                 walled courtyard open to the sky through an 8 x 8 m hole in
 *                 its roof, with a 10 m mouth facing the field, a back door,
 *                 a door in each side wall and a flag stand in the middle.
 *                 Both are enterable — the courtyard is real floor the minimap
 *                 draws and spawns use.
 *   THE RAMPS     two per base, on the outside of the side walls, running from
 *                 the FRONT corner back up to the roof. Deliberately the most
 *                 exposed approach on the map: the roof overlooks everything,
 *                 so it is priced by having to climb it in the open. The roof
 *                 ring drops back into the courtyard through the hole, which is
 *                 the escape that keeps the roof from being a trap.
 *   THE TOOTH     a 13.5 m rock spire at the centre. It is the landmark, and it
 *                 is load-bearing: without it the two base mouths look straight
 *                 down 62 m of open grass at each other.
 *   THE LANES     the field splits around the Tooth into a north and a south
 *                 lane, each broken by rock ridges every ~10 m so neither is an
 *                 unbroken firing line.
 *   THE BACK      11 m behind each base, reached through the back door or round
 *                 either side, closed by a rockslide where the canyon carries
 *                 on. Every space on this map has at least two ways out.
 *
 * PROVENANCE AND DEVIATIONS. Halo's canyon is roughly 250 x 130 m with the
 * bases ~200 m apart, which is three times the distance this game's weapons and
 * eight-player count are built for. It is CROPPED to its fighting core rather
 * than shrunk uniformly: base proportions, the roof-hole courtyard, the twin
 * ramps and the rockslide ends are kept at true size, the distance between them
 * is not. The other deliberate departures, each because a faithful copy plays
 * worse here:
 *
 *   - The floor is FLAT. The real gulch rolls; every rise on this map is built
 *     on top of a flat plane instead, which is what lets the whole playable
 *     area collide as one box (see `groundYBloodGulch`).
 *   - The base tunnels and teleporters are gone. This engine has no teleport,
 *     and an underground passage is a second floor of collision for a route
 *     the side doors already provide.
 *   - Ramps are STAIRS. The controller mantles ~0.5 m and climbs no ladders;
 *     `stairRun` is the sanctioned way up and carries its own collision.
 *   - The bases are rotationally symmetric rather than mirrored, so neither
 *     ramp pair faces the other across the field.
 *
 * Authored in LEVEL space; `WorldSystem` bakes the level->world transform into
 * every vertex, proxy and light, so nothing below knows about world space.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the canyon                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export const GULCH = {
  /** Half-extents of the playable floor. The cliffs' INNER faces sit here. */
  halfX: 52,
  halfZ: 36,
  /** How far the cliff mass runs outward, and how tall the shortest run is. */
  cliffOut: 9,
  cliffH: 15,
  /** Half-width of the canyon mouth left open at each end of the gulch. */
  mouthHalf: 7,
};

/**
 * The two bases. `x`/`z` are centres; `face` is the sign on X the front mouth
 * looks along. Everything about a base is authored ONCE in local coordinates
 * where +X is "toward the field", and `face: -1` places the other one with a
 * half-turn — so there is one base builder rather than two mirrored ones, and
 * the pair cannot drift apart under a later edit.
 */
export const BASES = [
  { id: 'red', x: -31, z: 0, w: 20, d: 18, face: 1, key: 'bg_red' },
  { id: 'blue', x: 31, z: 0, w: 20, d: 18, face: -1, key: 'bg_blue' },
];

/**
 * The base section, in local coordinates. One table, read by BOTH the geometry
 * and the occupancy tests — a wall that moves in one moves in the other.
 */
export const BASE = {
  t: 0.6,           // wall thickness
  wallH: 4.2,       // wall top / underside of the roof slab
  roofT: 0.4,
  roofY: 4.6,       // the roof walking surface
  voidHalf: 4.0,    // the 8 x 8 m hole over the courtyard
  mouthHalf: 5.0,   // the front opening, 10 m of it
  backHalf: 2.5,    // the back door
  /**
   * The side doors, in the BACK half of each side wall. Not a style choice: the
   * ramps run up the outside of those same walls from the front corner, and a
   * door in the front half opens straight into the underside of a flight ~4 m
   * up. Back-half doors also connect the back area to the courtyard without
   * crossing the mouth, which is the loop that keeps a base from being a room
   * with one watched way in.
   */
  doorX0: -7.0,
  doorX1: -3.0,
  doorH: 2.8,
  mouthLintel: 3.4, // head clearance under the beam across the front mouth
  parapetH: 1.0,
  parapetT: 0.3,
  lipH: 0.4,        // the kerb round the roof hole — steppable, on purpose
  lipT: 0.25,
  stairW: 2.2,
  stairSteps: 18,
  stairRun: 0.467,
  blockH: 1.1,      // the two courtyard cover blocks
  standH: 2.6,      // the flag stand
};
/** 18 steps of 0.256 m over 8.4 m: a 29° flight, which is a Halo ramp's pitch. */
BASE.stairRise = BASE.roofY / BASE.stairSteps;
BASE.stairLen = BASE.stairSteps * BASE.stairRun;
/** Courtyard cover: `[x, z, w, d]`, local. Two blocks, off the mouth axis. */
BASE.blocks = [
  [-4.0, -5.0, 3.0, 2.2],
  [3.0, 6.0, 3.0, 2.2],
];

/**
 * THE TOOTH — the landmark, and the only thing standing between the two base
 * mouths. Three stacked slabs, each smaller and turned a few degrees off the
 * one below, which is the cheapest shape that reads as broken stone rather than
 * as a stack of boxes. Not climbable: 13.5 m with no stair is scenery you
 * fight around, and on a map with two roof positions already that is the point.
 *
 * Offset 3 m north of centre so the two lanes around it are different widths —
 * a symmetric spire makes both flanks the same decision.
 */
export const TOOTH = {
  x: 0,
  z: -3,
  height: 13.5,
  /** `[w, d, h, ry]`, stacked bottom to top. */
  levels: [
    [17.0, 15.0, 4.5, 0.12],
    [12.5, 10.5, 4.5, -0.18],
    [7.0, 6.0, 4.5, 0.30],
  ],
};

/**
 * Rock ridges: `[x, z, ry, len, w, h]`. The cover rhythm of the two lanes —
 * nothing on this map is more than ~12 m from something that stops a bullet,
 * which is what keeps 100 m of open canyon from being a shooting gallery.
 * Rotated a few tenths so the field does not read as a grid; occupancy uses
 * each one's axis-aligned bound, which is slightly generous and never optimistic.
 */
export const RIDGES = [
  [-14, -19, 0.30, 15.0, 4.0, 2.6],
  [14, 19, 0.30, 15.0, 4.0, 2.6],
  [-12, 21, -0.25, 13.0, 4.5, 2.4],
  [12, -21, -0.25, 13.0, 4.5, 2.4],
  [0, 29, 0.12, 12.0, 5.0, 3.0],
  [0, -29, 0.12, 12.0, 5.0, 3.0],
  [-15, 14, 0.10, 10.0, 3.5, 2.2],
  [15, -14, 0.10, 10.0, 3.5, 2.2],
  // The four flank ridges, one in each corridor between a base's side wall and
  // the cliff. Those corridors are the route round a base and they were the one
  // part of the field with nothing in them — 25 m of open grass a player had to
  // cross in the open, which is precisely the no-man's-land the rest of this
  // table exists to prevent. `maps.selftest.mjs` measures it.
  [-33, -22, 0.15, 10.0, 3.5, 2.4],
  [33, 22, 0.15, 10.0, 3.5, 2.4],
  [-33, 22, -0.15, 10.0, 3.5, 2.4],
  [33, -22, -0.15, 10.0, 3.5, 2.4],
];

/**
 * Buttresses: `[x, z, w, d, h]`. Rock masses standing against the cliffs, which
 * do two jobs for one box — they break the wall into bays a player can fight
 * out of instead of a flat 104 m face, and they give the back areas behind the
 * bases something to fight around.
 */
export const BUTTRESSES = [
  [-26, -32.5, 11, 7, 8],
  [14, -32.75, 12, 6.5, 7],
  [26, 32.5, 11, 7, 8],
  [-14, 32.75, 12, 6.5, 7],
  [-48.5, -26, 7, 10, 7],
  [-48.5, 26, 7, 10, 7],
  [48.5, -26, 7, 10, 7],
  [48.5, 26, 7, 10, 7],
];

/**
 * Boulders: `[x, z, r]`. Instanced from ONE prototype and scaled, but every one
 * of them is authored, solid and known to the occupancy tests — a rock a player
 * can see and not take cover behind is worse than no rock. The ankle-height
 * scatter in `dress()` is the opposite deal: no proxy, and short enough that
 * nobody expects one.
 */
export const BOULDERS = [
  [-18, 2, 1.5], [18, -2, 1.5],
  [-16, -8, 1.2], [16, 8, 1.2],
  // Not the mirror of its partner: the Tooth is offset 3 m north, so the
  // rock that answers (-8, 12) has to stand clear of the spire's own footprint.
  [-8, 12, 1.4], [7.5, -14.5, 1.4],
  [-4, 14, 1.1], [4, -14, 1.1],
  [-24, -15, 1.6], [24, 15, 1.6],
  [-26, 16, 1.3], [26, -16, 1.3],
  [-45, 18, 1.5], [45, -18, 1.5],
  [-45, -18, 1.5], [45, 18, 1.5],
  [-5, -34, 1.6], [5, 34, 1.6],
  [-11, -12, 1.3], [11, 12, 1.3],
  // The spill at the foot of each rockslide. Authored rather than scattered by
  // the build for the reason at the head of this table: they are the first
  // thing a player fights over coming out of a back area, so they have to be
  // cover the occupancy tests know about.
  [-45.8, 5.2, 1.3], [-45.8, -5.2, 1.3],
  [45.8, 5.2, 1.3], [45.8, -5.2, 1.3],
];

/**
 * THE ROCKSLIDES: `[x, z, w, d, h]`.
 *
 * The cliff is left OPEN at both ends of the gulch, because a canyon that
 * closes into a rectangle reads as a room. What an opening actually is, though,
 * is a hole a player walks out of into empty terrain — so each one is filled by
 * a rockslide 1.25 m inside the cliff line, 5 m tall against a 15 m wall, so the
 * canyon still visibly carries on above it. `maps.selftest.mjs` probes both.
 */
export const ROCKSLIDES = [
  [-49, 0, 3.5, 15, 5],
  [49, 0, 3.5, 15, 5],
];

/**
 * The cliff runs: `[x, z, w, d, h]`. Inner faces land exactly on the perimeter;
 * everything else about them (depth, height) varies so the wall has a skyline.
 * The end runs stop short of the middle, which is what leaves the mouth.
 */
export const CLIFFS = [
  [-35, -40.5, 42, 9, 15],
  [3, -42, 34, 12, 18],
  [38, -39.5, 36, 7, 13],
  [35, 40.5, 42, 9, 15],
  [-3, 42, 34, 12, 18],
  [-38, 39.5, 36, 7, 13],
  [-56.5, -21.5, 9, 29, 16],
  [-56.5, 21.5, 9, 29, 16],
  [56.5, -21.5, 9, 29, 16],
  [56.5, 21.5, 9, 29, 16],
];

/**
 * Far mesas past each canyon mouth. Two boxes, and they exist for one frame:
 * looking out through the gap over the rockslide, the alternative is bare sky
 * meeting bare terrain in a straight line. No collision — nothing can reach them.
 */
export const MESAS = [
  [-74, 4, 22, 36, 22],
  [74, -4, 22, 36, 22],
];

/* ─────────────────────────────────────────────────────────────────────────── */
/* the solid tables — geometry and occupancy read the SAME rects               */
/* ─────────────────────────────────────────────────────────────────────────── */

/** A rotated footprint's axis-aligned bound. Generous, never optimistic. */
function rotatedRect(id, x, z, ry, len, w) {
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  const hx = (len * c + w * s) / 2;
  const hz = (w * c + len * s) / 2;
  return { id, x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz };
}

const rect = (id, x, z, w, d, extra = null) => ({
  id,
  x0: x - w / 2,
  z0: z - d / 2,
  x1: x + w / 2,
  z1: z + d / 2,
  ...extra,
});

/**
 * One base's ground-level solids, in LEVEL space.
 *
 * `kind`, `y0` and `h` ride along on each rect because `buildBase` renders
 * straight off this list: the wall a player walks into and the wall the spawn
 * validator refuses to stand in are the same four numbers, so they cannot
 * disagree. The half-turn for `face: -1` is applied here, once.
 */
export function baseSolids(b) {
  const B = BASE;
  const hw = b.w / 2;
  const hd = b.d / 2;
  const out = [];
  /** local rect -> level rect. A half-turn negates both axes, so re-order. */
  const put = (id, kind, x0, z0, x1, z1, y0, h) => {
    const ax = b.x + b.face * x0;
    const az = b.z + b.face * z0;
    const bx = b.x + b.face * x1;
    const bz = b.z + b.face * z1;
    out.push({
      id: `${b.id}-${id}`,
      kind,
      x0: Math.min(ax, bx),
      z0: Math.min(az, bz),
      x1: Math.max(ax, bx),
      z1: Math.max(az, bz),
      y0,
      h,
    });
  };

  // Side walls, split by their doorway. The two runs stop exactly where the
  // front and back walls start, so no two rects overlap at the corners.
  for (const sz of [-1, 1]) {
    const z0 = sz > 0 ? hd - B.t : -hd;
    const z1 = sz > 0 ? hd : -hd + B.t;
    put(`side${sz > 0 ? '+' : '-'}a`, 'wall', -hw, z0, B.doorX0, z1, 0, B.wallH);
    put(`side${sz > 0 ? '+' : '-'}b`, 'wall', B.doorX1, z0, hw, z1, 0, B.wallH);
  }
  // Front: two piers flanking the mouth. Back: two flanking the door.
  put('front-a', 'wall', hw - B.t, -(hd - B.t), hw, -B.mouthHalf, 0, B.wallH);
  put('front-b', 'wall', hw - B.t, B.mouthHalf, hw, hd - B.t, 0, B.wallH);
  put('back-a', 'wall', -hw, -(hd - B.t), -hw + B.t, -B.backHalf, 0, B.wallH);
  put('back-b', 'wall', -hw, B.backHalf, -hw + B.t, hd - B.t, 0, B.wallH);

  // The two ramps, outside the side walls, running from the front corner back.
  for (const sz of [-1, 1]) {
    const z0 = sz > 0 ? hd : -(hd + B.stairW);
    put(`ramp${sz > 0 ? '+' : '-'}`, 'stair', hw - B.stairLen, z0, hw, z0 + B.stairW, 0, BASE.roofY);
  }

  // The flag stand, and the courtyard cover.
  put('stand', 'stand', -0.7, -0.7, 0.7, 0.7, 0, B.standH);
  BASE.blocks.forEach(([x, z, w, d], i) =>
    put(`block${i}`, 'block', x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, B.blockH));
  return out;
}

/**
 * EVERY ground-level solid on the map, labelled, in LEVEL space.
 *
 * Derived once from the tables above and used by `inSolid`, by the build, and
 * by the self-test — so the test is asking about the numbers that actually
 * shipped rather than re-deriving them and agreeing with itself.
 */
export const SOLIDS = (() => {
  const out = [];
  for (const b of BASES) out.push(...baseSolids(b));
  out.push({ ...rotatedRect('tooth', TOOTH.x, TOOTH.z, TOOTH.levels[0][3], TOOTH.levels[0][0], TOOTH.levels[0][1]), kind: 'rock' });
  RIDGES.forEach(([x, z, ry, len, w], i) =>
    out.push({ ...rotatedRect(`ridge${i}`, x, z, ry, len, w), kind: 'rock' }));
  BUTTRESSES.forEach(([x, z, w, d], i) => out.push({ ...rect(`buttress${i}`, x, z, w, d), kind: 'rock' }));
  BOULDERS.forEach(([x, z, r], i) => out.push({ ...rect(`boulder${i}`, x, z, r * 2, r * 2), kind: 'rock' }));
  ROCKSLIDES.forEach(([x, z, w, d], i) => out.push({ ...rect(`rockslide${i}`, x, z, w, d), kind: 'rock' }));
  return out;
})();

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** The hot form of `SOLIDS`: flat arrays, no property lookups per test. */
const BLOCKERS = SOLIDS.map((s) => [s.x0, s.z0, s.x1, s.z1]);

/** True inside (or within `m` of) anything solid standing on the canyon floor. */
export function inSolid(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/**
 * Can a character stand here, in LEVEL space? Inside the cliffs and off every
 * footprint — INCLUDING inside a base, which is open floor and not a footprint.
 * Only ever a first filter; real collision decides, in `buildSpawnPoints`.
 */
export function standableAtBloodGulch(x, z, margin = 0.55) {
  if (Math.abs(x) > GULCH.halfX - 0.8 - margin) return false;
  if (Math.abs(z) > GULCH.halfZ - 0.8 - margin) return false;
  return !inSolid(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenBloodGulch(x, z, m = 0.3) {
  if (Math.abs(x) > GULCH.halfX - 0.6) return false;
  if (Math.abs(z) > GULCH.halfZ - 0.6) return false;
  return !inSolid(x, z, m);
}

/**
 * Analytic floor height.
 *
 * DEAD FLAT inside the cliffs. The real gulch rolls, and rolling ground here
 * would cost the map its cheapest asset: one collision box under the entire
 * 104 x 72 m floor instead of a few thousand terrain triangles in the physics
 * BVH. Every rise on this map is BUILT on top of that plane instead, which the
 * self-test asserts.
 *
 * Outside, the ground rolls and climbs — but only enough to seat the far mesas
 * and to keep the gap over each rockslide from showing a straight terrain/sky
 * line. The cliffs hide the rest, so nothing out there earns more than this.
 */
export function groundYBloodGulch(x, z) {
  const out = Math.max(Math.abs(x) - GULCH.halfX, Math.abs(z) - GULCH.halfZ);
  if (out <= 0) return 0.02;
  const t = Math.min(1, out / 12);
  const roll = (fbm3(x * 0.045, 5.1, z * 0.045, 2) - 0.5) * 1.4 * t;
  const climb = Math.min(1, Math.max(0, (out - 10) / 34));
  return 0.02 + roll + climb * climb * (5.0 + fbm3(x * 0.02, 3.3, z * 0.02, 2) * 9.0);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* spawns                                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the Tooth, so every point opens onto the field rather than at a wall two
 * metres away — the spire is the one thing visible from everywhere, which makes
 * it the right thing to aim at.
 *
 * Ten zones, because crowding is counted PER ZONE and the director can only
 * pick from what is authored: both courtyards, both back areas, the four
 * quarter-field corners and the two mid-lane pockets. A map whose zones all sit
 * on one side of the canyon spawn-loops.
 *
 * INDEX 0 is the boot/dev spawn and is exempt from validation, so it is the one
 * point guaranteed to exist.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - TOOTH.x, z - TOOTH.z) + turn;
export const BLOODGULCH_SPAWNS = [
  /**
   * FROZEN — the boot spawn, and the frame every capture of this map is shot
   * from. Off the red base's south shoulder looking down the gulch: the Tooth
   * centre-frame, the blue base behind it, the red base's flank filling the
   * left of the shot. The `turn` is what buys that last part — aimed straight
   * at the spire the establishing shot of a two-base map contains one base.
   */
  [-38, 15, 0.28, 'red-base'],
  // The four courtyard points sit in the corners the two cover blocks and the
  // flag stand leave — a spawn tucked against a block is one `buildSpawnPoints`
  // culls against real collision, and the zone quietly ships a point short.
  [-37.5, 2.5, 0, 'red-base'],
  [-25.5, -5.5, 0, 'red-base'],
  [-37.8, -2.0, 0, 'red-base'],
  [-25.0, 3.0, 0, 'red-base'],

  [37.5, -2.5, 0, 'blue-base'],
  [25.5, 5.5, 0, 'blue-base'],
  [37.8, 2.0, 0, 'blue-base'],
  [25.0, -3.0, 0, 'blue-base'],

  // The back areas. These face AWAY from the Tooth (the base is in the way),
  // so the turn swings them onto the lane they will actually have to fight up.
  [-45, 0, 0.9, 'red-back'],
  [-46, -11, 0.5, 'red-back'],
  [-46, 11, -0.5, 'red-back'],

  [45, 0, 0.9, 'blue-back'],
  [46, 11, 0.5, 'blue-back'],
  [46, -11, -0.5, 'blue-back'],

  [-22, -27, 0, 'red-north'],
  [-16, -30, 0.2, 'red-north'],
  [-25, -22, -0.2, 'red-north'],

  [-24, 20, 0, 'red-south'],
  [-20, 27, -0.2, 'red-south'],
  [-27, 25, 0.2, 'red-south'],

  [24, -20, 0, 'blue-north'],
  [20, -27, -0.2, 'blue-north'],
  [27, -25, 0.2, 'blue-north'],

  [22, 27, 0, 'blue-south'],
  [16, 30, 0.2, 'blue-south'],
  [25, 22, -0.2, 'blue-south'],

  [0, -21, 0, 'mid-north'],
  [-5, -25, 0.25, 'mid-north'],
  [8, -26, -0.25, 'mid-north'],

  [0, 21, 0, 'mid-south'],
  [5, 25, 0.25, 'mid-south'],
  [-8, 26, -0.25, 'mid-south'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* geometry helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * A box straight from a level-space rect, plus its collision proxy.
 *
 * Everything on this map except the ridges and the Tooth's upper slabs is
 * axis-aligned, so this one helper builds most of it — and because it takes the
 * same rect the occupancy tests read, a wall cannot be drawn anywhere other
 * than where the map says it is.
 */
function boxOfRect(A, key, r, y0, h, collide = true) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const cy = y0 + h / 2;
  A.add(key, BOX(A), LL(IDENT, cx, cy, cz, 0, w, h, d));
  if (collide) A.box(A.surfaceOf(key), cx, cy, cz, w, h, d);
}

/** The same, from centre/size — for everything not driven by a rect. */
function boxAt(A, key, x, y, z, w, h, d, ry = 0, collide = true) {
  A.add(key, BOX(A), LL(IDENT, x, y + h / 2, z, ry, w, h, d));
  if (collide) A.box(A.surfaceOf(key), x, y + h / 2, z, w, h, d, ry);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGround(A, rng) {
  // ------------------------------------------------------------- outside --
  // One coarse plane for everything past the cliffs. 22 x 19 segments over
  // 220 x 190 m is a 10 m cell, which is all the resolution a landform gets to
  // have when a 15 m wall stands in front of it. NO collision proxy: the
  // perimeter is sealed, so every triangle out here would be BVH and nothing
  // else (`groundYBloodGulch` explains the rest of that trade).
  const terrain = new THREE.PlaneGeometry(220, 190, 22, 19);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) pa.setY(i, groundYBloodGulch(pa.getX(i), pa.getZ(i)) - 0.05);
  terrain.computeVertexNormals();
  A.add('bg_rock_dark', terrain, null);
  terrain.dispose();

  // --------------------------------------------------------------- floor --
  // The valley floor: one plane at 4 m per cell, rolled by a few centimetres.
  // That displacement is the only thing standing between a flat-shaded green
  // sheet and a screen-filling area of one single colour — the surfaces here
  // carry no normal map by design, so the geometry has to give the light
  // something to vary across.
  const W = GULCH.halfX * 2;
  const D = GULCH.halfZ * 2;
  const floor = new THREE.PlaneGeometry(W, D, 26, 18);
  floor.rotateX(-Math.PI / 2);
  const fa = floor.getAttribute('position');
  for (let i = 0; i < fa.count; i++) {
    const x = fa.getX(i);
    const z = fa.getZ(i);
    fa.setY(i, 0.02 + (fbm3(x * 0.12 + 4, 2.7, z * 0.12, 3) - 0.5) * 0.14);
  }
  floor.computeVertexNormals();
  A.add('bg_grass', floor, null);
  // ONE box under the whole thing. This is what the flat floor buys.
  A.box('dirt', 0, -0.25, 0, W, 0.5, D);
  floor.dispose();
}

/**
 * The cliffs, the buttresses that stand against them, the rockslides that close
 * the two canyon mouths, and the mesas past them.
 */
function buildPerimeter(A, rng) {
  for (const [x, z, w, d, h] of CLIFFS) {
    // Cliffs start below the floor so the join never shows a seam, and are
    // stepped back once near the top so the wall has a profile rather than
    // reading as a single extruded slab.
    boxAt(A, 'bg_rock', x, -1.5, z, w, h + 1.5, d);
    const sign = Math.sign(z || 1);
    const nx = Math.abs(z) > Math.abs(x) ? x : x + Math.sign(x) * 1.6;
    const nz = Math.abs(z) > Math.abs(x) ? z + sign * 1.6 : z;
    A.add('bg_rock_dark', BOX(A), LL(IDENT, nx, h + 1.2, nz, 0, w * 0.82, 2.4, d * 0.7));
  }
  for (const [x, z, w, d, h] of BUTTRESSES) {
    boxAt(A, 'bg_rock', x, 0, z, w, h, d);
    // A smaller cap, turned a little: two boxes is the difference between a
    // rock and a shipping container.
    A.add('bg_rock_dark', BOX(A), LL(IDENT, x, h + 0.9, z, 0.22, w * 0.7, 1.8, d * 0.72));
  }
  for (const [x, z, w, d, h] of ROCKSLIDES) {
    boxAt(A, 'bg_rock', x, 0, z, w, h, d);
    // A shoulder each end, so the slide meets the cliff jamb in a heap rather
    // than in a straight vertical joint. The lumps that read as fallen rock in
    // front of it are in `BOULDERS`, because they are cover and have to be
    // known to occupancy — a slide is not an excuse to scatter solid-looking
    // props the map does not believe in.
    for (const sz of [-1, 1])
      A.add('bg_rock_dark', BOX(A), LL(IDENT, x, 1.1, z + sz * (d / 2 - 1.6), 0.18, w * 0.9, 2.2, 3.6));
  }
  for (const [x, z, w, d, h] of MESAS) {
    const gy = groundYBloodGulch(x, z);
    A.add('bg_rock_dark', BOX(A), LL(IDENT, x, gy + h / 2, z, 0.24, w, h, d));
  }
}

/** The Tooth: three slabs, each turned off the one below it. */
function buildTooth(A, rng) {
  let y = 0;
  for (const [w, d, h, ry] of TOOTH.levels) {
    A.add('bg_rock', BOX(A), LL(IDENT, TOOTH.x, y + h / 2, TOOTH.z, ry, w, h, d));
    A.box('concrete', TOOTH.x, y + h / 2, TOOTH.z, w, h, d, ry);
    y += h;
  }
  // A dark collar at the foot, where the spire meets the grass. Purely a value
  // break: without it a 13.5 m tan monolith stands on green with no transition.
  A.add('bg_rock_dark', BOX(A), LL(IDENT, TOOTH.x, 0.35, TOOTH.z, TOOTH.levels[0][3],
    TOOTH.levels[0][0] + 1.4, 0.7, TOOTH.levels[0][1] + 1.4));
}

/** The field's rock ridges. Two boxes each: the mass, and a turned cap. */
function buildRidges(A, rng) {
  for (const [x, z, ry, len, w, h] of RIDGES) {
    boxAt(A, 'bg_rock', x, 0, z, len, h, w, ry);
    A.add('bg_rock_dark', BOX(A), LL(IDENT, x, h + 0.35, z, ry + 0.14, len * 0.74, 0.7, w * 0.78));
  }
}

/**
 * One base.
 *
 * Walls, cover and the flag stand come straight off `baseSolids(b)` — the same
 * list `inSolid` tests against — so the only numbers this function invents are
 * the ones that are NOT ground blockers: lintels over the openings, the roof
 * ring, the parapet and the kerb round the roof hole.
 */
function buildBase(A, rng, b) {
  const B = BASE;
  const hw = b.w / 2;
  const hd = b.d / 2;
  const solids = baseSolids(b);
  /** local point -> level point, the same half-turn `baseSolids` applies. */
  const lx = (x) => b.x + b.face * x;
  const lz = (z) => b.z + b.face * z;

  // ---- walls, courtyard cover, flag stand --------------------------------
  for (const s of solids) {
    if (s.kind === 'wall' || s.kind === 'block') boxOfRect(A, 'bg_conc', s, s.y0, s.h);
  }
  // The team band: a stripe of colour at head height round the outside of the
  // base. It is one box per side and it is the entire reason a player 90 m away
  // knows which end of the canyon they are looking at. The side runs stop at
  // x = 1.0, where the ramp starts climbing across them — a stripe that carries
  // on behind a flight is a stripe nobody sees, drawn every frame.
  for (const sz of [-1, 1])
    A.add(b.key, BOX(A), LL(IDENT, lx((-hw + 1.0) / 2), 3.3, lz(sz * (hd + 0.06)), 0, hw + 1.0, 0.5, 0.16));
  for (const sx of [-1, 1])
    A.add(b.key, BOX(A), LL(IDENT, lx(sx * (hw + 0.06)), 3.3, lz(0), 0, 0.16, 0.5, b.d + 0.14));

  // ---- lintels, so every opening has a head rather than an edge -----------
  const lintel = (x, z, w, d, y0, h) => boxAt(A, 'bg_conc', lx(x), y0, lz(z), w, h, d);
  // The front mouth's beam sits at 3.4 m: high enough to cost no sightline the
  // 10 m opening is there to give, low enough to read as carrying the roof.
  lintel(hw - B.t / 2, 0, B.t, B.mouthHalf * 2, B.mouthLintel, B.wallH - B.mouthLintel);
  lintel(-hw + B.t / 2, 0, B.t, B.backHalf * 2, B.doorH, B.wallH - B.doorH);
  for (const sz of [-1, 1])
    lintel((B.doorX0 + B.doorX1) / 2, sz * (hd - B.t / 2), B.doorX1 - B.doorX0, B.t, B.doorH, B.wallH - B.doorH);
  // A dark reveal inside each door head — the one place a value break stands in
  // for the shadow a real opening would have.
  for (const sz of [-1, 1])
    A.add('bg_dark', BOX_THIN(A),
      LL(IDENT, lx((B.doorX0 + B.doorX1) / 2), B.doorH + 0.06, lz(sz * (hd - B.t / 2)), 0,
        B.doorX1 - B.doorX0, 0.12, B.t + 0.04));

  // ---- the roof ring, around the hole over the courtyard -----------------
  const V = B.voidHalf;
  const ring = [
    [-hw, -hd, hw, -V],
    [-hw, V, hw, hd],
    [-hw, -V, -V, V],
    [V, -V, hw, V],
  ];
  for (const [x0, z0, x1, z1] of ring) {
    const w = x1 - x0;
    const d = z1 - z0;
    boxAt(A, 'bg_conc', lx((x0 + x1) / 2), B.wallH, lz((z0 + z1) / 2), w, B.roofT, d);
  }
  // The kerb round the hole: 0.4 m, which is UNDER the controller's ~0.5 m
  // mantle. You step over it and drop into the courtyard on purpose, and you do
  // not walk off it by accident.
  for (const sz of [-1, 1]) {
    boxAt(A, 'bg_dark', lx(0), B.roofY, lz(sz * (V - B.lipT / 2)), V * 2, B.lipH, B.lipT);
    boxAt(A, 'bg_dark', lx(sz * (V - B.lipT / 2)), B.roofY, lz(0), B.lipT, B.lipH, V * 2 - B.lipT * 2);
  }

  // ---- the parapet, with a gap where each ramp lands ----------------------
  const P = B.parapetT;
  boxAt(A, 'bg_conc', lx(hw - P / 2), B.roofY, lz(0), P, B.parapetH, b.d);
  boxAt(A, 'bg_conc', lx(-hw + P / 2), B.roofY, lz(0), P, B.parapetH, b.d);
  // The gap is 1.0 .. 4.4 m along the side, which brackets where the flight's
  // top step lands (x = 1.6). Close it and the ramps go nowhere — the map keeps
  // both roofs and loses every route to them, and nothing in a frame says so.
  // A team band along the parapet top, so the base still reads red or blue from
  // above — which is the view from the other base's roof. Split at the same gap
  // as the parapet under it: a continuous band would be a strip of colour
  // floating over the one hole a player has to walk through.
  for (const sz of [-1, 1])
    for (const [x0, x1] of [[-hw, 1.0], [4.4, hw]]) {
      boxAt(A, 'bg_conc', lx((x0 + x1) / 2), B.roofY, lz(sz * (hd - P / 2)), x1 - x0, B.parapetH, P);
      A.add(b.key, BOX(A),
        LL(IDENT, lx((x0 + x1) / 2), B.roofY + B.parapetH + 0.06, lz(sz * (hd - P / 2)), 0, x1 - x0, 0.12, P + 0.06));
    }

  // ---- the two ramps -----------------------------------------------------
  // The panel matrix must be its OWN Matrix4: `LL` hands back a shared scratch
  // (kit.js), and holding that as a panel matrix compounds the transform into
  // itself until the flight is 10^13 m away — with every check still green.
  for (const sz of [-1, 1]) {
    const pm = new THREE.Matrix4().makeRotationY(-b.face * Math.PI / 2);
    pm.setPosition(lx(hw), 0, lz(sz * (hd + B.stairW / 2)));
    stairRun(A, pm, 0, 0, 0, B.stairW, B.stairSteps, B.stairRise, B.stairRun, { key: 'bg_conc' });
  }

  // ---- the flag stand ----------------------------------------------------
  const stand = solids.find((s) => s.kind === 'stand');
  boxOfRect(A, 'bg_rock_dark', stand, 0, 0.4);
  boxAt(A, 'bg_conc', lx(0), 0.4, lz(0), 0.34, B.standH - 0.4, 0.34);
  // The flag itself: one plate in the team colour, up where the roof hole lets
  // the sun onto it. Nothing on this map is more identifying than this object.
  A.add(b.key, BOX(A), LL(IDENT, lx(0.62), B.standH - 0.55, lz(0), 0, 1.1, 0.72, 0.1));

  return { spec: { id: b.id, x: b.x, z: b.z, w: b.w, d: b.d }, id: b.id, base: b };
}

/**
 * Set dressing: the boulder line and the scatter.
 *
 * Boulders come from the authored table (they are cover and they collide);
 * the scatter is generated from the handed rng and filtered through the same
 * occupancy the rest of the map uses, so a stone can never land inside a wall.
 * No jitter is armed: both prototypes are already asymmetric lumps, and jitter
 * would only buy variation the rock shapes already have.
 */
function dress(A, rng) {
  for (const [x, z, r] of BOULDERS) {
    A.put('bg_boulder', x, 0, z, (x * 0.7 + z * 0.3) % 6.283, r);
    // The proxy is a plain box a shade smaller than the lump: a player should
    // never be stopped by air they can see past, and a boulder's silhouette
    // overhangs its own waist.
    A.box('concrete', x, r * 0.7, z, r * 1.7, r * 1.4, r * 1.45, r * 0.9);
  }

  // The scatter. Rejection-sampled rather than placed on a grid — 220 tries at
  // ~140 survivors is cheap at build time and costs nothing afterward.
  // A base is a poured floor, so the stones stop at its walls: the filter is
  // the footprint plus a metre, not the wall rects, because the courtyard reads
  // as open ground to `isOpen` and would otherwise collect gravel indoors.
  const indoors = (x, z) =>
    BASES.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1);
  let placed = 0;
  for (let i = 0; i < 220 && placed < 150; i++) {
    const x = rng.range(-GULCH.halfX + 1.5, GULCH.halfX - 1.5);
    const z = rng.range(-GULCH.halfZ + 1.5, GULCH.halfZ - 1.5);
    if (indoors(x, z) || !isOpenBloodGulch(x, z, 1.0)) continue;
    A.put('bg_stone', x, 0, z, rng.range(0, 6.283), rng.range(0.7, 1.8));
    placed++;
  }
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map's `build`.
 *
 * `registerProps` is NOT called here, and that is the one line in this file
 * most likely to look like an omission. It is not: the shared library builds
 * ~70 prototype geometries for a vocabulary of crates, barrels, litter and
 * street furniture, none of which belongs in a box canyon and none of which
 * this map places. Registering them would be build-time work and immediate
 * garbage. Nothing outside `src/world` depends on the shared prototypes
 * existing — they are only ever reached through `A.put`.
 */
export function buildBloodGulch(A, rng) {
  registerBloodGulchProps(A, rng);

  buildGround(A, rng);
  buildPerimeter(A, rng);
  buildTooth(A, rng);
  buildRidges(A, rng);

  const infos = [];
  for (const b of BASES) infos.push(buildBase(A, rng, b));

  dress(A, rng);

  // The Tooth is reported to the minimap alongside the bases: it is the one
  // mass on the field big enough that a player reading the map needs it there.
  infos.push({ spec: { id: 'tooth', x: TOOTH.x, z: TOOTH.z, w: TOOTH.levels[0][0], d: TOOTH.levels[0][1] } });
  return { buildings: infos };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const BLOODGULCH_MAP = {
  id: 'bloodgulch',
  blurb: 'A box canyon with a base at each end. Two ramps to every roof, one rock spire in the middle, and nowhere on the field more than a sprint from cover.',
  size: '104 × 72 m',
  /**
   * A fifth of a radian off the axes, which is the rule every map but Nuketown
   * follows: the canyon is built out of rectangles, and a rectangle lit
   * square-on loses one of its two lit faces. This map needs that more than
   * most — its surfaces carry no normal map, so the ONLY thing separating one
   * flat tan cliff face from the next is the angle it makes with the sun.
   */
  transform: { yaw: 0.28, tx: 0, tz: 0 },
  /** Tight to the cliffs plus a skirt; the AI's nav grid is built over this. */
  bounds: [-56, -2, -40, 56, 20, 40],
  spawnPoints: BLOODGULCH_SPAWNS,
  standable: standableAtBloodGulch,
  groundY: groundYBloodGulch,
  isOpen: isOpenBloodGulch,
  build: buildBloodGulch,
  /**
   * Late morning, high and clear. The gulch is remembered as a bright place,
   * and clear air is also the cheap choice: `cloudCoverage` low enough that the
   * sky is a gradient rather than a cloud field, and no cirrus layer at all.
   *
   * `hour` is doing real work beyond the mood. At 10:30 the sun sits off the
   * canyon's long axis, so the two cliff walls are lit and shaded rather than
   * both being the same flat tan — the same job `transform.yaw` does for the
   * bases. `fogHeight` is kept above the cliff line so the tops stay in it and
   * the far mesas sit back where they belong.
   */
  environment: {
    hour: 10.5,
    exposureBias: -0.15,
    weather: {
      turbidity: 2.6,
      cloudCoverage: 0.14,
      cloudDensity: 0.7,
      cirrusCoverage: 0,
      cirrusOpacity: 0,
      horizonMurk: 0.26,
      fogDensity: 0.65,
      fogHeight: 28,
    },
  },
};
