import * as THREE from 'three';
import { BOX, BOX_THIN, IDENT, LL, stairRun, worldOf, ryOf } from './kit.js';
import { registerProps } from './props.js';
import { registerSiteworkProps, CABIN } from './siteworkprops.js';
import { fbm3, paintMasks } from './util.js';

/**
 * WORLD — SITE WORK.
 *
 * A live construction site inside a sealed orange hoarding: a half-built
 * concrete frame across the middle, a lift-shaft core standing over each half
 * of the ground, and a materials yard at either end. 56 x 84 m of playable
 * ground.
 *
 *   THE FRAME     the map's spine — a 34 x 14 m concrete deck on columns,
 *                 straddling the middle of the site. It is ENTERABLE, with six
 *                 doorways, and its roof at 3.8 m is the map's contested
 *                 middle ground. Two external stairs reach it, one from each
 *                 side, so taking it always means crossing open ground.
 *   THE CORE      a 13.5 m lift-shaft tower north of the frame — the landmark,
 *                 visible from every corner of the site. Its deck at 7.2 m is
 *                 the strongest position on the map and it is priced
 *                 accordingly: the only way up is a 7.2 m external flight
 *                 standing in the open.
 *   THE LANES     three independent north-south routes: a 15 m west haul road,
 *                 a 7 m east service gap, and straight through the frame. No
 *                 space on this map has one exit.
 *   THE YARDS     a materials yard at each end, each with a shed breaking the
 *                 sightline down the site, and the bulk of the spawn points.
 *
 * PROVENANCE. Proportions were read off a downloaded low-poly TDM site model
 * with `tools/glb-plan.mjs` and `tools/glb-render.mjs` — a sealed orange
 * hoarding, a spine building across the middle, two towers flanking it, gravel
 * yards at both ends, and a palette of safety orange, concrete grey, timber and
 * brick red. The model measured 18.7 x 36 m at its true scale (calibrated off
 * its oil drums at 0.58 x 0.88 m), which is a third of this game's 55-120 m
 * band, so POSITIONS were scaled ~3x while props stayed their real size. See
 * the deviations noted at each site below. Nothing from the model is loaded,
 * imported or sampled — every mesh here is generated, like the rest of the game.
 *
 * DEVIATIONS, AND WHY
 *   The source's spine seals to the east wall, leaving a single ~3 m gap at the
 *   west as the only route between the two halves. In a team mode that is a
 *   choke; in an 8-player free-for-all it is a coin flip. So the frame here is
 *   permeable (six doorways) and the east gap is real, giving three routes.
 *   The source is also 180-degree symmetric, which on a map with no team
 *   colours means no way to tell which end you are looking at. The two towers
 *   are therefore deliberately unequal — one is 13.5 m with a deck, the other
 *   9.5 m and solid — and the two end sheds differ in size and side.
 *
 * LAYOUT NOTES
 *   Authored in LEVEL space, site centred on the origin, north at -Z.
 *   `WorldSystem` bakes the level->world transform into every vertex, proxy and
 *   light, so nothing below knows about world space.
 *
 *   Verticality is stairs only — this engine's controller mantles ~0.5 m ledges
 *   and climbs no ladders, so a deck without a flight is scenery. Exactly two
 *   places are positions: the frame roof and the core deck. Everything else
 *   that is tall is cover.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const SITE = {
  /** Half-extents of the hoarding. The hoarding centre line sits here. */
  halfX: 28,
  halfZ: 42,
  wallH: 4.4,
  wallT: 0.35,
  /** Site floor. Flat: this is a compacted and blinded slab, not terrain. */
  y: 0,
  /**
   * The two vehicle gates, centred on z = 0 in the east and west hoarding.
   *
   * 5.6 m of opening against the 6.06 m container parked across it. The
   * container length is the constraint, not a preference: a wider gate leaves a
   * gap at each jamb that a player walks straight out of, and the self-test
   * probes for exactly that.
   */
  gateHalf: 2.8,
};

const H = Math.PI / 2;

/**
 * The solid masses: `{ id, x, z, w, d, h }` with `x`/`z` the centre.
 *
 * `h` is the height a player interacts with — for `frame` and `core` that is
 * the walkable deck, not the silhouette, because the deck is what the layout
 * and the self-test reason about. The core's mast carries on above its deck
 * and is built separately.
 *
 * Shape matches the market's `BUILDINGS` entries closely enough for
 * `ui/minimap` to draw them.
 */
export const STRUCTURES = [
  /**
   * THE FRAME. Deliberately off-centre on X: it leaves a 15 m haul road to the
   * west and a 7 m service gap to the east, which are two different kinds of
   * lane rather than two of the same. A centred frame gave two 11 m lanes and
   * the map played identically whichever way you went round.
   */
  { id: 'frame', x: 4, z: 0, w: 34, d: 14, h: 3.8, key: 'sw_amber' },
  /** THE CORE — the landmark. `h` is the deck; the mast goes to `CORE.mastTop`. */
  { id: 'core', x: 2, z: -20, w: 8, d: 8, h: 7.2, key: 'sw_amber' },
  /** The south core: same idea, taller, and with no way in. Pure sightline break. */
  { id: 'core_s', x: -4, z: 18, w: 7, d: 7, h: 9.5, key: 'sw_amber' },
  /** Site office in the north yard, and the materials store in the south. */
  { id: 'office', x: -18, z: -37, w: 12, d: 7, h: 4.2, key: 'sw_concrete' },
  { id: 'store', x: 14, z: 34, w: 13, d: 7, h: 4.6, key: 'sw_concrete' },
];

const byId = (id) => STRUCTURES.find((s) => s.id === id);
export const FRAME = byId('frame');
export const CORE = { ...byId('core'), mastW: 3.5, mastTop: 13.5, parapet: 1.0 };

/**
 * Doorways through the frame, as `[face, offset, width]`. `face` is 'n'/'s'
 * (a hole in the z = -+d/2 wall, `offset` along X) or 'w'/'e' (a hole in the
 * x = -+w/2 wall, `offset` along Z).
 *
 * Six of them, and that count is the deviation the whole layout turns on — see
 * the header. Two per long face means the frame cannot be held by watching one
 * door, and the west and east holes make it a through-route rather than a room.
 */
export const FRAME_DOORS = [
  ['n', -6, 3.2], ['n', 12, 3.2],
  ['s', -6, 3.2], ['s', 12, 3.2],
  ['w', 0, 3.2], ['e', 0, 3.2],
];

/** Frame columns, `[x, z]`. Kept clear of every doorway's line through. */
export const FRAME_COLUMNS = [
  [-10, -3.5], [-2, -3.5], [6, -3.5], [16, -3.5],
  [-10, 3.5], [-2, 3.5], [6, 3.5], [16, 3.5],
];

/**
 * The stairs, `[x, z, ry, steps, rise, run, width, key]`. `x`/`z` is the FOOT,
 * and the flight climbs in the direction `ry` faces (0 = +Z, PI = -Z).
 *
 * A stair lands on a platform at its EDGE — a flight rising inside a slab would
 * come up through it — so each of these is placed to arrive exactly on the deck
 * edge it serves, and the arithmetic (`steps * rise` = deck height,
 * `steps * run` = the gap it spans) is asserted in the self-test rather than
 * eyeballed.
 *
 * All three stand in open ground on purpose. The frame roof and the core deck
 * are the two positions on this map, and a covered stair would make either of
 * them free.
 */
export const STAIRS = [
  // Frame roof, from the north side: foot at z -12.7, arriving at z -7 = the
  // frame's north edge, 19 x 0.2 = 3.8 m up.
  { id: 'frame-n', x: -8, z: -12.7, ry: 0, steps: 19, rise: 0.2, run: 0.3, w: 1.8, top: 3.8 },
  // Frame roof, from the south side, mirrored to the far end of the deck so
  // the two flights do not overlook each other.
  { id: 'frame-s', x: 16, z: 12.7, ry: Math.PI, steps: 19, rise: 0.2, run: 0.3, w: 1.8, top: 3.8 },
  /**
   * The core deck: 24 x 0.3 = 7.2 m, climbing WEST onto the core's east face.
   *
   * It was on the south face first, which put its foot 1.8 m off the frame's
   * north wall — the flight fitted, but its run-up did not, and the strongest
   * position on the map was reachable from behind cover. Turning it a quarter
   * gives the approach 6 m of open yard, which is what prices the position.
   */
  { id: 'core', x: 13.2, z: -20, ry: -H, steps: 24, rise: 0.3, run: 0.3, w: 1.7, top: 7.2 },
];

/**
 * Which way a flight climbs, as a unit step in LEVEL space. `stairRun` marches
 * along its panel matrix's local +Z, and `RotY(ry)` sends that to
 * `(sin ry, 0, cos ry)` — so this is the one place the direction is derived and
 * both the blocker rects and the self-test read it rather than assuming +Z.
 *
 * SNAPPED, and that is load-bearing: every flight here is a quarter turn, but
 * `Math.sin(Math.PI)` is 1.2e-16 rather than 0. Callers ask "does this stair
 * move in X?" as a truthiness test, and 1.2e-16 is true — so an un-snapped
 * vector makes a north-south flight claim to travel in both axes at once, and
 * every check built on it silently measures the wrong edge.
 */
export const stairDir = (ry) => [Math.sin(ry), Math.cos(ry)].map((v) => (Math.abs(v) < 1e-9 ? 0 : v));

/**
 * Concrete barrier lines, 1.15 m: `[x, z, ry, len]`. `ry` 0 runs along X, `H`
 * along Z.
 *
 * The rhythm is the market's, applied to a haul road: nothing runs more than
 * ~10 m unbroken down the west lane, which is the longest straight on the map.
 * These are the cover that the 3x position scaling would otherwise have thinned
 * out — the source's cover spacing, tripled, leaves courtyards.
 */
export const BARRIERS = [
  // west haul road, staggered so the lane never reads as a corridor
  [-24, -31, 0, 6], [-16, -28, 0, 5], [-24, -20, 0, 6], [-17, -12, 0, 5],
  [-21, -2, 0, 6], [-17, 9, 0, 5], [-24, 19, 0, 6], [-18, 28, 0, 5],
  [-22, 36, 0, 6],
  // north yard
  [-6, -30, H, 6], [8, -34, 0, 6], [16, -31, H, 5], [-2, -39, 0, 5],
  // south yard
  [4, 30, H, 6], [-10, 36, 0, 6], [-24, 27, H, 5], [20, 39, 0, 5],
  // east service gap — 4 m across a 7 m lane, so it is cover and not a plug
  [24.5, -14, 0, 4], [24.5, 6, 0, 4], [24.5, 24, 0, 4],
  // the open ground each side of the frame, where the stairs are crossed
  [-13, -13, 0, 5], [12, -14, H, 5], [10, 12, 0, 5], [-11, 14, H, 5],
];

/**
 * Timber stacks, 1.35 m: `[x, z, ry, len]`. Same job as the barriers, different
 * silhouette — a site is not built out of one object, and the source's biggest
 * cover pieces were banded plank stacks.
 */
export const TIMBER = [
  [-20, -31, H, 4.5], [11, -24, 0, 4.5], [-9, -25, H, 4],
  [21, -32, 0, 4], [-14, 22, 0, 4.5], [7, 21, H, 4],
  [-8, 33, H, 4.5], [18, 20, 0, 4],
];

/**
 * Site cabins used as cover: `[x, z, ry, tier, proto]`. Container-shaped
 * offices and material stores. Only 0 and H are used for `ry` — the blocker test below
 * reads them as axis-aligned rects.
 */
export const CABINS = [
  [-24, -9, H, 0, 'sw_cabin_b'],
  [-24, -9, H, 1, 'sw_cabin'],
  [-21, 4, H, 0, 'sw_cabin'],
  [18, -25, 0, 0, 'sw_cabin_b'],
  [-2, -33, 0, 0, 'sw_cabin'],
  [-2, -33, 0, 1, 'sw_cabin_b'],
  [-16, 12, 0, 0, 'sw_cabin'],
  [12, 26, 0, 0, 'sw_cabin_b'],
  [-13, -19, 0, 0, 'sw_cabin'],
  [24, 14, H, 0, 'sw_cabin_b'],
  /**
   * THE GATE BLOCKS. The hoarding opens for a vehicle gate on each long side,
   * which is right — a sealed box of hoarding reads as a box of hoarding. But
   * an opening is a hole a player walks out of into nothing, so each is parked
   * shut the way a real site is: a container across the gap, 2 m inside the
   * hoarding line. The self-test probes both.
   */
  [-25.8, 0, H, 0, 'sw_cabin'],
  [25.8, 0, H, 0, 'sw_cabin_b'],
];

/**
 * Background masses beyond the hoarding: the half-built blocks this site is one
 * of. Without them the frame roof and the core deck — both of which see over a
 * 4.4 m hoarding — look out at a bare terrain/sky line.
 */
export const BACKDROP = [
  [-42, -50, 16, 12, 22],
  [40, -38, 14, 16, 17],
  [46, 20, 12, 14, 26],
  [-38, 46, 18, 12, 19],
  [8, -58, 22, 14, 14],
  [-10, 56, 20, 12, 16],
];

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the middle of the frame, so nobody spawns staring at a hoarding panel and
 * nobody spawns with their back to the lane they have to fight down.
 *
 * Eight zones, because crowding is counted per zone and the director can only
 * pick from what is authored: two end yards, the two halves of the west haul
 * road, the east service gap, the ground around each core, and the north-west
 * corner behind the office.
 *
 * INDEX 0 is the boot/dev spawn (exempt from validation in `buildSpawnPoints`),
 * so it is the one point guaranteed to exist.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - FRAME.x, z - FRAME.z) + turn;
export const SITEWORK_SPAWNS = [
  /**
   * FROZEN — the boot spawn, and the frame every capture of this map is shot
   * from. The south yard on the site's centre line, looking straight up it: the
   * frame fills the middle distance, the core stands above it, and the store
   * shed closes the right-hand side. That is the map in one frame. Positions
   * further back were tried and are worse — from the hoarding line the frame is
   * a band across the horizon and the core reads as a chimney behind it.
   */
  [2, 34, 0.12, 'south-yard'],
  [-6, 33, -0.1, 'south-yard'],
  [-12, 31, 0.2, 'south-yard'],
  [1, 39, 0, 'south-yard'],

  [4, -31, 0, 'north-yard'],
  [13, -32, -0.15, 'north-yard'],
  [-4, -35, 0.15, 'north-yard'],
  [16, -38, 0.1, 'north-yard'],

  [-20, -24, 0.3, 'west-lane-n'],
  [-21, -16, 0.15, 'west-lane-n'],
  [-19, -9, -0.2, 'west-lane-n'],

  [-20, 22, -0.3, 'west-lane-s'],
  [-21, 15, -0.15, 'west-lane-s'],
  [-19, 8, 0.2, 'west-lane-s'],

  [24.5, -18, 0.35, 'east-gap'],
  // Held west of the lane's centre line: the gate container is parked at
  // x 24.6..27.0, and a point on the centre line sits inside its margin.
  [23.5, -8, 0.2, 'east-gap'],
  [24.5, 18, -0.35, 'east-gap'],

  [-6, -18, -0.3, 'core-north'],
  [11, -15, 0.3, 'core-north'],
  [8, -12, 0.15, 'core-north'],

  [-12, 17, 0.3, 'core-south'],
  [4, 19, -0.25, 'core-south'],
  [-2, 25, 0, 'core-south'],

  [-22, -30, 0.4, 'nw-corner'],
  [-16, -30, 0.2, 'nw-corner'],
  [-25, -25, 0.5, 'nw-corner'],

  /**
   * SEVEN MORE, ONE PER ZONE — authored spare, not authored spacious.
   *
   * `buildSpawnPoints` re-validates every point against real collision at build
   * time and silently drops the failures, and `spawns.probe.mjs` wants 28 to
   * survive that cull. Twenty-six authored means twenty-six shipped only while
   * nothing ever lands on one; the first prop that does takes the map under the
   * bar with nothing in the headless tests to say so. These are the margin.
   */
  [-16, 40, 0.15, 'south-yard'],
  [6.5, -40, -0.1, 'north-yard'],
  [-15, -14.5, -0.25, 'west-lane-n'],
  [-26, 27, -0.3, 'west-lane-s'],
  [26, 4.5, 0.25, 'east-gap'],
  [-1, -10, 0.2, 'core-north'],
  [-3, 10, -0.2, 'core-south'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** A `[x, z, ry, len]` row as an axis-aligned `[x0, z0, x1, z1]` rect. */
function rowRect(x, z, ry, len, t) {
  const hx = (ry === 0 ? len : t) / 2;
  const hz = (ry === 0 ? t : len) / 2;
  return [x - hx, z - hz, x + hx, z + hz];
}

/** Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  for (const [x, z, ry, tier] of CABINS) {
    if (tier !== 0) continue; // a stacked box adds no new footprint
    const hx = (ry === 0 ? CABIN.l : CABIN.w) / 2;
    const hz = (ry === 0 ? CABIN.w : CABIN.l) / 2;
    out.push([x - hx, z - hz, x + hx, z + hz]);
  }
  for (const [x, z, ry, len] of BARRIERS) out.push(rowRect(x, z, ry, len, 0.6));
  for (const [x, z, ry, len] of TIMBER) out.push(rowRect(x, z, ry, len, 1.1));
  // The stairs. A flight is solid from the side, and dressing dropped on one is
  // how a deck quietly stops being reachable.
  for (const s of STAIRS) {
    const len = s.steps * s.run;
    const [dx, dz] = stairDir(s.ry);
    const x0 = s.x + Math.min(0, dx * len) - (dx ? 0 : s.w / 2);
    const x1 = s.x + Math.max(0, dx * len) + (dx ? 0 : s.w / 2);
    const z0 = s.z + Math.min(0, dz * len) - (dz ? 0 : s.w / 2);
    const z1 = s.z + Math.max(0, dz * len) + (dz ? 0 : s.w / 2);
    out.push([x0, z0, x1, z1]);
  }
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the site floor. */
export function inSolid(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/**
 * Can a character stand here, in LEVEL space? Inside the hoarding and off every
 * footprint. Only ever a first filter — real collision decides, in
 * `buildSpawnPoints`.
 */
export function standableAtSitework(x, z, margin = 0.55) {
  if (Math.abs(x) > SITE.halfX - 0.8 - margin) return false;
  if (Math.abs(z) > SITE.halfZ - 0.8 - margin) return false;
  return !inSolid(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenSitework(x, z, m = 0.3) {
  if (Math.abs(x) > SITE.halfX - 0.6) return false;
  if (Math.abs(z) > SITE.halfZ - 0.6) return false;
  return !inSolid(x, z, m);
}

/**
 * Analytic floor height. The site is a blinded slab, so this is dead flat
 * inside the hoarding; outside it the spoil rolls away and climbs into a bank.
 *
 * The bank is not scenery for its own sake. From the core deck at 7.2 m the
 * camera clears the 4.4 m hoarding easily, and without it the whole horizon is
 * the terrain plane meeting the sky in one straight band — the flat cut-out
 * read the quality bar exists to prevent. Doing it in the height field costs
 * nothing: the terrain mesh already samples this, so the bank is free and its
 * collision comes with it.
 *
 * Physics owns the exact answer — this is the hint props are dropped on.
 */
export function groundYSitework(x, z) {
  const out = Math.max(Math.abs(x) - SITE.halfX, Math.abs(z) - SITE.halfZ);
  if (out <= 0) return 0.02;
  const t = Math.min(1, out / 12);
  const roll = (fbm3(x * 0.05, 3.1, z * 0.05, 3) - 0.5) * 1.3 * t;
  // Starts 10 m out and takes 30 m to reach full height, so the near spoil
  // still reads as flat ground and the climb is all in the distance.
  const bank = Math.min(1, Math.max(0, (out - 10) / 30));
  return 0.02 + roll + bank * bank * (4.5 + fbm3(x * 0.02, 5.7, z * 0.02, 2) * 7.5);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* geometry helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

const _wp = [0, 0];

/** Point `u` metres along a wall centred at (cx, cz) and rotated by `ry`. */
function alongWall(cx, cz, ry, u, out) {
  out[0] = cx + Math.cos(ry) * u;
  out[1] = cz - Math.sin(ry) * u;
  return out;
}

/** Add a box in panel space AND its collision proxy, converting once. */
function pbox(A, pm, key, x, y, z, ry, sx, sy, sz, masks) {
  A.add(key, BOX(A), LL(pm, x, y, z, ry, sx, sy, sz), { masks: masks ?? [0.55, 0.45, 0.25] });
  const w = worldOf(pm, x, y, z);
  A.box(A.surfaceOf(key), w[0], w[1], w[2], sx, sy, sz, ry + ryOf(pm));
}

/**
 * One run of wall with real openings punched through it.
 *
 * `holes` are `[{ u, w, y, h }]` in wall-local coordinates: `u` along the wall
 * from its centre, `y` up from `y0`. The wall is emitted as the solid spans
 * BETWEEN the holes plus a lintel over and a sill under each, so a doorway is a
 * genuine hole in the collision hull rather than a thin panel the player has to
 * be teleported through.
 */
function wallWithHoles(A, pm, key, cx, cz, ry, len, y0, h, t, holes = [], masks) {
  const seg = (u, w, yc, hh) => {
    if (w < 0.02 || hh < 0.02) return;
    alongWall(cx, cz, ry, u, _wp);
    pbox(A, pm, key, _wp[0], yc, _wp[1], ry, w, hh, t, masks);
  };
  const sorted = [...holes].sort((a, b) => a.u - b.u);
  let cursor = -len / 2;
  for (const o of sorted) {
    const x0 = o.u - o.w / 2;
    const x1 = o.u + o.w / 2;
    if (x0 > cursor) seg((cursor + x0) / 2, x0 - cursor, y0 + h / 2, h);
    const oy = o.y ?? 0;
    const oh = o.h ?? h;
    if (oy > 0.02) seg(o.u, o.w, y0 + oy / 2, oy); // sill
    if (oy + oh < h - 0.02) seg(o.u, o.w, y0 + (oy + oh + h) / 2, h - oy - oh); // lintel
    cursor = Math.max(cursor, x1);
  }
  if (cursor < len / 2) seg((cursor + len / 2) / 2, len / 2 - cursor, y0 + h / 2, h);
}

/** A low freestanding run from a `[x, z, ry, len]` row, with its proxy. */
function lowRow(A, key, x, z, ry, len, h, t, masks, cap = true) {
  A.add(key, BOX(A), LL(IDENT, x, h / 2, z, ry, len, h, t), { masks: masks ?? [0.6, 0.5, 0.3] });
  A.box(A.surfaceOf(key), x, h / 2, z, len, h, t, ry);
  // A capping course, so the top edge catches light instead of reading as a cut.
  if (cap) {
    A.add(key, BOX(A), LL(IDENT, x, h + 0.05, z, ry, len + 0.12, 0.1, t + 0.12), { masks: [0.85, 0.3, 0.15] });
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGround(A, rng) {
  // -------------------------------------------------------------- spoil --
  const S = 230;
  const N = 52;
  const terrain = new THREE.PlaneGeometry(S, S, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setY(i, groundYSitework(pa.getX(i), pa.getZ(i)) - 0.04);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    out[1] = 0.25 + fbm3(x * 0.26, 2.4, z * 0.26, 2) * 0.4;
    out[0] = 0.2;
  });
  // A value apart from the site floor, so the hoarding line reads as an edge
  // between two grounds rather than as a wall standing on one.
  A.add('sw_dark', terrain, null);
  A.collideGeo('sand', terrain);
  terrain.dispose();

  // ---------------------------------------------------------------- slab --
  // One subdivided plane so grazing light finds something, and one flat
  // collision box under it so the controller never feels the triangles.
  const W = SITE.halfX * 2;
  const D = SITE.halfZ * 2;
  const slab = new THREE.PlaneGeometry(W, D, 28, 42);
  slab.rotateX(-Math.PI / 2);
  const sa = slab.getAttribute('position');
  for (let i = 0; i < sa.count; i++) {
    const x = sa.getX(i);
    const z = sa.getZ(i);
    sa.setY(i, 0.03 + (fbm3(x * 0.35 + 4, 3.9, z * 0.35, 3) - 0.5) * 0.06);
  }
  slab.computeVertexNormals();
  paintMasks(slab, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.55, 4.4, z * 0.55, 3);
    out[0] = 0.24 + n * 0.28;
    out[1] = 0.18 + n * 0.24;
  });
  // Dark, and that is the blockout's load-bearing choice: everything on this
  // map is a saturated mass, and they only read as silhouettes if the floor
  // they stand on is a value below all of them.
  A.add('sw_ground', slab, null);
  A.box('dirt', 0, -0.25, 0, W, 0.5, D);
  slab.dispose();

  // ---------------------------------------------------------- haul road --
  // Compacted stone down the west lane and across both yards, laid 1 cm over
  // the slab rather than cut into it: two overlapping planes cost one extra
  // draw call, and cutting the slab would put a seam exactly where players
  // spend the whole match.
  const road = new THREE.PlaneGeometry(15, D, 8, 42);
  road.rotateX(-Math.PI / 2);
  const ra = road.getAttribute('position');
  for (let i = 0; i < ra.count; i++) {
    ra.setY(i, 0.05 + (fbm3(ra.getX(i) * 0.5, 8.6, ra.getZ(i) * 0.5, 2) - 0.5) * 0.03);
  }
  road.computeVertexNormals();
  paintMasks(road, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.18;
    out[1] = 0.3 + fbm3(x * 0.7, 1.9, z * 0.7, 2) * 0.35;
  });
  road.translate(-20.5, 0, 0);
  A.add('sw_dark', road, null);
  road.dispose();
}

/**
 * The hoarding, with a vehicle gate left open on each long side.
 *
 * Each side is emitted as spans BETWEEN its openings, so the opening is a real
 * hole rather than a thin panel — the same reason `wallWithHoles` exists. The
 * openings are then parked shut by the gate containers, which the self-test
 * probes.
 */
function buildPerimeter(A, rng) {
  const { halfX, halfZ, wallH, wallT, gateHalf } = SITE;
  const key = 'sw_orange';
  const masks = [0.5, 0.55, 0.35];

  // North and south runs: unbroken, full width.
  for (const sz of [-1, 1]) {
    A.add(key, BOX(A), LL(IDENT, 0, wallH / 2, sz * halfZ, 0, halfX * 2 + wallT, wallH, wallT), { masks });
    A.box('metal', 0, wallH / 2, sz * halfZ, halfX * 2 + wallT, wallH, wallT);
    A.add(key, BOX(A), LL(IDENT, 0, wallH + 0.08, sz * halfZ, 0, halfX * 2 + wallT, 0.16, wallT + 0.18), {
      masks: [0.9, 0.3, 0.1],
    });
  }
  // East and west runs: two spans each, with the gate mouth between them.
  for (const sx of [-1, 1]) {
    const span = halfZ - gateHalf;
    for (const sz of [-1, 1]) {
      const cz = sz * (gateHalf + span / 2);
      A.add(key, BOX(A), LL(IDENT, sx * halfX, wallH / 2, cz, 0, wallT, wallH, span), { masks });
      A.box('metal', sx * halfX, wallH / 2, cz, wallT, wallH, span);
      A.add(key, BOX(A), LL(IDENT, sx * halfX, wallH + 0.08, cz, 0, wallT + 0.18, 0.16, span), {
        masks: [0.9, 0.3, 0.1],
      });
    }
    // Piers on the gate jambs — an opening needs an edge or it reads as damage.
    for (const sz of [-1, 1]) {
      A.add('sw_amber', BOX(A), LL(IDENT, sx * halfX, wallH * 0.58, sz * gateHalf, 0, 0.6, wallH * 1.16, 0.6), {
        masks: [0.6, 0.5, 0.3],
      });
      A.box('metal', sx * halfX, wallH * 0.58, sz * gateHalf, 0.6, wallH * 1.16, 0.6);
    }
  }

  // Standard-panel posts down the hoarding: a 2.4 m rhythm is what makes a run
  // of sheet read as bolted-together panels instead of one extruded ribbon.
  for (const sz of [-1, 1]) {
    for (let x = -halfX + 2.4; x < halfX; x += 2.4) {
      A.add('sw_amber', BOX_THIN(A), LL(IDENT, x, wallH / 2, sz * (halfZ + 0.22), 0, 0.13, wallH, 0.1), {
        masks: [0.7, 0.5, 0.3],
      });
    }
  }
  for (const sx of [-1, 1]) {
    for (let z = -halfZ + 2.4; z < halfZ; z += 2.4) {
      if (Math.abs(z) < gateHalf) continue;
      A.add('sw_amber', BOX_THIN(A), LL(IDENT, sx * (halfX + 0.22), wallH / 2, z, 0, 0.1, wallH, 0.13), {
        masks: [0.7, 0.5, 0.3],
      });
    }
  }

  // Background masses past the hoarding. `A.box` is skipped: they are outside
  // the sealed perimeter, so nothing can ever reach them and a proxy would only
  // be BVH the physics has to walk.
  for (const [x, z, w, d, h] of BACKDROP) {
    const gy = groundYSitework(x, z);
    A.add('sw_dark', BOX(A), LL(IDENT, x, gy + h / 2, z, 0.24, w, h, d), { masks: [0.4, 0.6, 0.5] });
    // A crown of slab edges, so a backdrop block reads as unfinished floors
    // rather than a monolith — this site is one of several going up.
    for (let i = 1; i <= 3; i++) {
      A.add('sw_grey', BOX_THIN(A),
        LL(IDENT, x, gy + h * (i / 4), z, 0.24, w + 0.5, 0.24, d + 0.5), { masks: [0.7, 0.4, 0.2] });
    }
  }
}

/**
 * THE FRAME — the map's spine, and its only enterable structure.
 *
 * A concrete deck on columns with six doorways through it. The walls are only
 * one storey: everything above is the deck slab and its parapet, so the roof is
 * a position and the inside is a route, and neither costs an interior.
 */
function buildFrame(A, rng) {
  const s = FRAME;
  const hw = s.w / 2;
  const hd = s.d / 2;
  const t = 0.4;
  const wallH = s.h - 0.3; // the deck slab is the last 0.3 m
  const doorH = 2.8;
  const masks = [0.45, 0.5, 0.3];
  // Axis-aligned and centred, so IDENT does the job and there is no panel
  // matrix to accidentally alias — see `stairRun` below for the case that does
  // need one.
  const pm = IDENT;

  // Door offsets are authored in LEVEL x/z; `wallWithHoles` wants `u` measured
  // from the wall's own centre, which is the structure centre on that axis.
  const holesFor = (face) => FRAME_DOORS
    .filter((d) => d[0] === face)
    .map(([, offset, w]) => ({ u: offset - (face === 'n' || face === 's' ? s.x : s.z), w, y: 0, h: doorH }));

  // Long faces. `ry` is the wall's own rotation: 0 runs along X.
  for (const sz of [-1, 1]) {
    const face = sz < 0 ? 'n' : 's';
    wallWithHoles(A, pm, s.key, s.x, s.z + sz * hd, 0, s.w, 0, wallH, t, holesFor(face), masks);
  }
  // End faces, running along Z.
  for (const sx of [-1, 1]) {
    const face = sx < 0 ? 'w' : 'e';
    wallWithHoles(A, pm, s.key, s.x + sx * hw, s.z, H, s.d, 0, wallH, t, holesFor(face), masks);
  }

  // Columns, so the deck reads as carried rather than floating on its walls.
  for (const [cx, cz] of FRAME_COLUMNS) {
    pbox(A, pm, 'sw_orange', cx, wallH / 2, cz, 0, 0.55, wallH, 0.55, [0.6, 0.45, 0.25]);
  }

  // The deck slab. Its top is exactly `s.h` — the stairs are built to land here.
  A.add('sw_concrete', BOX(A), LL(IDENT, s.x, s.h - 0.15, s.z, 0, s.w + 0.6, 0.3, s.d + 0.6), {
    masks: [0.5, 0.5, 0.3],
  });
  A.box('concrete', s.x, s.h - 0.15, s.z, s.w + 0.6, 0.3, s.d + 0.6);

  /**
   * The parapet. 1.0 m, which is cover from the deck but does NOT stop a player
   * walking off — the controller falls, it does not clip. That is deliberate:
   * the deck is meant to be a place you can leave in any direction under fire,
   * and a 1.6 m wall would make it a pen with two exits.
   *
   * Left open where each stair arrives, or the flight would land against a wall.
   */
  const gapN = STAIRS.find((q) => q.id === 'frame-n').x;
  const gapS = STAIRS.find((q) => q.id === 'frame-s').x;
  for (const sz of [-1, 1]) {
    const gapX = sz < 0 ? gapN : gapS;
    const z = s.z + sz * (hd + 0.25);
    // Two spans, one each side of the stair head.
    const x0 = s.x - hw - 0.3;
    const x1 = s.x + hw + 0.3;
    for (const [a, b] of [[x0, gapX - 1.2], [gapX + 1.2, x1]]) {
      if (b - a < 0.3) continue;
      lowRow(A, 'sw_concrete', (a + b) / 2, z, 0, b - a, 1.0, 0.24, [0.6, 0.5, 0.3]);
    }
  }
  for (const sx of [-1, 1]) {
    lowRow(A, 'sw_concrete', s.x + sx * (hw + 0.25), s.z, H, s.d + 0.1, 1.0, 0.24, [0.6, 0.5, 0.3]);
  }
}

/**
 * THE CORE — the landmark, and the map's one commanding position.
 *
 * A lift-shaft box up to a 7.2 m deck, then a slimmer mast carrying on to
 * 13.5 m so the silhouette is visible over the frame from both yards. The deck
 * is the ring of slab around the mast.
 */
function buildCore(A, rng) {
  const c = CORE;
  const hw = c.w / 2;
  const t = 0.45;
  const mh = c.mastW / 2;

  // The shaft: four solid walls, no way through at ground level. The stair is
  // the only route, which is the whole point of the position.
  for (const sz of [-1, 1]) {
    pbox(A, IDENT, c.key, c.x, c.h / 2, c.z + sz * hw, 0, c.w, c.h, t, [0.45, 0.55, 0.35]);
  }
  for (const sx of [-1, 1]) {
    pbox(A, IDENT, c.key, c.x + sx * hw, c.h / 2, c.z, 0, t, c.h, c.w - t * 2, [0.45, 0.55, 0.35]);
  }

  // The deck slab, top at exactly `c.h`.
  A.add('sw_concrete', BOX(A), LL(IDENT, c.x, c.h - 0.15, c.z, 0, c.w + 0.7, 0.3, c.w + 0.7), {
    masks: [0.5, 0.5, 0.3],
  });
  A.box('concrete', c.x, c.h - 0.15, c.z, c.w + 0.7, 0.3, c.w + 0.7);

  // The mast above the deck. Solid, and the deck wraps it.
  A.add('sw_orange', BOX(A), LL(IDENT, c.x, (c.h + c.mastTop) / 2, c.z, 0, c.mastW, c.mastTop - c.h, c.mastW), {
    masks: [0.5, 0.5, 0.35],
  });
  A.box('concrete', c.x, (c.h + c.mastTop) / 2, c.z, c.mastW, c.mastTop - c.h, c.mastW);
  // A cap and a mast head — the silhouette is what makes this the landmark, so
  // it gets the two extra parts that stop it reading as an extruded post.
  A.add('sw_concrete', BOX(A), LL(IDENT, c.x, c.mastTop + 0.15, c.z, 0, c.mastW + 0.6, 0.3, c.mastW + 0.6), {
    masks: [0.75, 0.35, 0.2],
  });
  for (const sx of [-1, 1]) {
    A.add('sw_dark', BOX_THIN(A),
      LL(IDENT, c.x + sx * (mh + 0.35), c.mastTop - 1.4, c.z, 0, 0.16, 2.8, 0.16), { masks: [0.8, 0.5, 0.25] });
  }

  /**
   * Deck parapet, left open where the stair arrives — a flight landing against a
   * wall is a deck nobody can reach. The stair climbs west onto the EAST face,
   * so that is the side that gets the gap.
   */
  const stair = STAIRS.find((q) => q.id === 'core');
  for (const sz of [-1, 1]) {
    lowRow(A, 'sw_concrete', c.x, c.z + sz * (hw + 0.3), 0, c.w + 0.7, c.parapet, 0.22, [0.6, 0.5, 0.3]);
  }
  for (const sx of [-1, 1]) {
    const x = c.x + sx * (hw + 0.3);
    if (sx > 0) {
      for (const [a, b] of [[c.z - hw - 0.35, stair.z - 1.1], [stair.z + 1.1, c.z + hw + 0.35]]) {
        if (b - a < 0.3) continue;
        lowRow(A, 'sw_concrete', x, (a + b) / 2, H, b - a, c.parapet, 0.22, [0.6, 0.5, 0.3]);
      }
    } else {
      lowRow(A, 'sw_concrete', x, c.z, H, c.w + 0.7, c.parapet, 0.22, [0.6, 0.5, 0.3]);
    }
  }
}

/** The south core and the two end sheds: solid masses, no way in. */
function buildBlocks(A, rng) {
  for (const s of STRUCTURES) {
    if (s.id === 'frame' || s.id === 'core') continue;
    A.add(s.key, BOX(A), LL(IDENT, s.x, s.h / 2, s.z, 0, s.w, s.h, s.d), { masks: [0.5, 0.5, 0.35] });
    A.box('concrete', s.x, s.h / 2, s.z, s.w, s.h, s.d);
    // A roof that oversails and leans, so a shed reads as built rather than
    // extruded, for one extra part.
    A.add('sw_dark', BOX(A), LL(IDENT, s.x, s.h + 0.16, s.z, 0, s.w + 0.4, 0.2, s.d + 0.4, 0, s.id === 'core_s' ? 0 : 0.08), {
      masks: [0.65, 0.45, 0.25],
    });
    if (s.id === 'core_s') continue;
    // A door and two windows on the face that looks into the site.
    const sz = Math.sign(s.z) * -1;
    A.add('sw_dark', BOX_THIN(A),
      LL(IDENT, s.x - 2.4, 1.1, s.z + sz * (s.d / 2 + 0.03), 0, 1.1, 2.2, 0.06), { masks: [0.6, 0.5, 0.4] });
    for (const dx of [1.2, 4.0]) {
      A.add('sw_blue', BOX_THIN(A),
        LL(IDENT, s.x + dx, 2.0, s.z + sz * (s.d / 2 + 0.03), 0, 1.5, 1.1, 0.06), { masks: [0.4, 0.4, 0.2] });
    }
  }
}

/** Every stair on the map, built from one table so the self-test can read it. */
function buildStairs(A, rng) {
  const feet = [];
  for (const s of STAIRS) {
    /**
     * The panel matrix must be its OWN Matrix4, never the one `LL` hands back.
     * `LL` returns a shared module-level scratch (`kit.js`), so holding its
     * result as `pm` makes every later `LL(pm, …)` compound this transform into
     * itself — the flight ends up 10^13 m from the origin, the map still
     * builds, every self-test still passes, and the stair is simply not there.
     */
    const pm = new THREE.Matrix4().makeRotationY(s.ry);
    pm.setPosition(s.x, 0, s.z);
    stairRun(A, pm, 0, 0, 0, s.w, s.steps, s.rise, s.run, { key: 'sw_concrete', railing: 'right' });
    feet.push({ id: s.id, at: [s.x, 0, s.z] });
  }
  return feet;
}

/** Every low run: concrete barriers and banded timber stacks. */
function buildCover(A, rng) {
  for (const [x, z, ry, len] of BARRIERS) {
    lowRow(A, 'sw_grey', x, z, ry, len, 1.15, 0.6, [0.65, 0.55, 0.35]);
  }
  for (const [x, z, ry, len] of TIMBER) {
    // Four banded courses rather than one box: a timber stack's whole read is
    // the stripe of shadow between courses, and it is three extra parts.
    for (let i = 0; i < 4; i++) {
      A.add(i % 2 ? 'sw_tan' : 'sw_amber', BOX(A),
        LL(IDENT, x, 0.17 + i * 0.34, z, ry, len, 0.3, 1.1), { masks: [0.6, 0.5, 0.3] });
    }
    A.box('wood', x, 0.68, z, ry === 0 ? len : 1.1, 1.35, ry === 0 ? 1.1 : len);
    // Two banding straps, the detail that says "delivered" rather than "stacked".
    for (const u of [-0.28, 0.28]) {
      A.add('sw_dark', BOX_THIN(A),
        LL(IDENT, x + (ry === 0 ? len * u : 0), 0.68, z + (ry === 0 ? 0 : len * u), ry, 0.06, 1.4, 1.16),
        { masks: [0.8, 0.5, 0.2] });
    }
  }
}

/** The containers: cabins, stores and the two gate blocks. */
function buildContainers(A, rng) {
  const { l: L, w: W, h: CH } = CABIN;
  for (const [x, z, ry, tier, proto] of CABINS) {
    const y = 0.04 + tier * (CH + 0.03);
    // A hand-parked site is not a CAD model: a couple of degrees of yaw and a
    // centimetre of settle is the difference between "parked" and "snapped".
    const j = ((x * 31 + z * 17 + tier * 7) % 11) / 11 - 0.5;
    A.put(proto, x, y, z, ry + j * 0.045, 1);
    const hx = (ry === 0 ? L : W) / 2;
    const hz = (ry === 0 ? W : L) / 2;
    A.box('metal', x, y + CH / 2, z, hx * 2, CH, hz * 2);
  }
}

/**
 * Set dressing — eight prototypes, repeated.
 *
 * QUARTER TURNS ONLY, AND NO SCALE JITTER. Every other map in the game arms
 * `A.jitter` here so no two instances sit alike, because identical clones are
 * the loudest tell in an instanced cloud. This map wants exactly the opposite,
 * for the reason Nuketown gives: a blockout reads as a blockout because its
 * objects are repetitions of ONE object, all plumb, squared to the world. A
 * crate rolled three degrees off true would be the only thing on screen not
 * aligned to everything else. So `A.jitter` is never armed, scale is always 1,
 * and rotation is snapped to the compass.
 *
 * Every placement is filtered through `free()` so nothing lands inside
 * something the occupancy tests believe is empty, or on a stair run-up.
 */
function dress(A, rng, feet) {
  const free = (x, z, m = 0.5) => {
    if (!isOpenSitework(x, z, m)) return false;
    // Keep every stair run-up clear. A stair blocked by dressing is the one
    // mistake that makes a deck unreachable, and no screenshot shows it.
    for (const f of feet) if (Math.hypot(x - f.at[0], z - f.at[2]) < 3.0) return false;
    return true;
  };

  /**
   * `Rng.int` takes (min, max). Called with one argument it returns NaN, which
   * does not throw and does not fail any headless check — it propagates into
   * the instance matrix, then into the InstancedMesh's bounding sphere, and
   * three culls the whole cloud every frame. Nuketown lost 82 of its 122 props
   * exactly that way. `rng.float()` has no such trap.
   */
  const turn = () => Math.floor(rng.float() * 4) * H;

  const scatter = (proto, list, m = 0.6) => {
    for (const [x, z] of list) if (free(x, z, m)) A.put(proto, x, 0.02, z, turn(), 1);
  };

  // ---- crates: the yards' unit of clutter, singly and stacked -------------
  const S = 0.9;
  const crates = [
    [-10, -28], [-7, -27], [14, -30], [17, -31], [-25, -13], [-24, 11],
    [20, -18], [-6, 22], [0, 28], [3, 27], [-16, 35], [22, 30],
    [-24, 33], [19, 8], [-11, -8], [8, 8], [-20, -5], [21, -8],
    [-9, -37], [19, -35], [6, 35], [-14, 5], [26, 27], [-2, -12],
  ];
  for (let i = 0; i < crates.length; i++) {
    const [x, z] = crates[i];
    if (!free(x, z, 0.6)) continue;
    A.put('sw_crate', x, S / 2 + 0.02, z, turn(), 1);
    // Every third one carries a second tier. A stack is what gives a blockout
    // its only vertical rhythm, and it is free: the same prototype again.
    if (i % 3 === 0) A.put('sw_crate', x, S * 1.5 + 0.03, z, turn(), 1);
  }

  // ---- brick pallets: the reference's signature object --------------------
  // Placed in twos and threes, because one is a red post and three is a
  // delivery — the difference between an object and a place.
  for (const [cx, cz] of [[-16, -6], [19, -9], [-8, 8], [22, 12], [-3, -26], [7, 24], [-21, -27], [11, 32]]) {
    const ry = turn();
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    for (let i = 0; i < 3; i++) {
      const u = (i - 1) * 1.3;
      const x = cx + cos * u;
      const z = cz - sin * u;
      if (free(x, z, 0.7)) A.put('sw_brick', x, 0.02, z, ry, 1);
    }
  }

  // ---- pallets and loose timber ------------------------------------------
  scatter('sw_pallet', [
    [-13, -33], [12, -21], [-3, 26], [23, -22], [-22, 25], [15, 16], [-17, -15],
    [-25, -34], [24, -29], [-25, 30], [17, 12], [-11, 30], [13, -36],
  ]);
  scatter('sw_timber', [
    [-6, -14], [9, 17], [-19, 32], [20, -6], [-12, 27], [16, -11], [-8, 30], [25, 20],
  ]);

  // ---- barrels: clustered, because one barrel is a bollard ----------------
  const barrels = [
    [-19, -34], [-18.2, -33.2], [15, -26], [15.8, -25.2], [-26, -18], [-26, 22],
    [22, 20], [21.2, 20.8], [-9, 20], [-8.2, 20.8], [4, -29], [4.8, -28.2],
    [-14, -11], [18, -2], [-3, 12], [26, -25], [-26, -6], [11, 5],
    [-21, 38], [23, 35], [-5, 38], [13, -18], [-20, -20], [16, 22],
  ];
  for (let i = 0; i < barrels.length; i++) {
    const [x, z] = barrels[i];
    if (!free(x, z, 0.45)) continue;
    A.put(i % 3 === 0 ? 'sw_barrel_b' : 'sw_barrel', x, 0.02, z, turn(), 1);
  }

  // ---- low blocks: cover between the authored barrier lines ---------------
  scatter('sw_block', [
    [-15, -17], [17, -20], [-11, 11], [9, -6], [-24, -22], [23, 6],
    [-12, -30], [14, -14], [-22, 8], [6, 31], [24, -4], [-1, -35],
    [7, -30], [-21, 18], [12, 28], [-26, 2],
  ], 0.8);
}


/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map's `build`.
 */
export function buildSitework(A, rng) {
  registerProps(A, rng);
  registerSiteworkProps(A, rng);

  buildGround(A, rng);
  buildPerimeter(A, rng);
  buildFrame(A, rng);
  buildCore(A, rng);
  buildBlocks(A, rng);
  const feet = buildStairs(A, rng);
  buildCover(A, rng);
  buildContainers(A, rng);
  dress(A, rng, feet);

  return { buildings: STRUCTURES.map((s) => ({ spec: s, id: s.id, ...s })) };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const SITEWORK_MAP = {
  id: 'sitework',
  blurb: 'A half-built concrete frame across a live site, with the lift core watching everything. Three ways past the middle and none of them quiet.',
  size: '56 × 84 m',
  /**
   * LEVEL -> WORLD. A few tenths off the axes on purpose: every mass here is a
   * rectangle, and a rectangle lit square-on loses one of its two lit faces.
   */
  transform: { yaw: 0.26, tx: 0, tz: 0 },
  /**
   * Tight to the hoarding plus a skirt. `ai` builds its nav grid over this, and
   * there is no reason to sample cells out on the spoil: the perimeter is
   * sealed, so nothing walkable out there is reachable anyway. `maxY` clears
   * the core mast head at 13.65 m.
   */
  bounds: [-33, -2, -47, 33, 20, 47],
  spawnPoints: SITEWORK_SPAWNS,
  standable: standableAtSitework,
  groundY: groundYSitework,
  isOpen: isOpenSitework,
  build: buildSitework,
  // No `environment`: clean daylight, the cheap and safe choice, and the sky
  // restores its own defaults for a map without one.
  //
  // An `exposureBias` was tried here to push the floor toward the near-black of
  // the reference art and is deliberately NOT kept: it made no measurable
  // difference to the frame, and the premise was wrong anyway. `sw_ground` is
  // already at the palette's 0.02 reflectance floor and the shader receives it
  // as 0.027 linear (measured, not assumed) — a 2.4% surface under an open sky
  // tonemaps to a mid grey, which is what dark asphalt does in a photograph
  // too. The reference renders near-black because it is flat-shaded in a viewer
  // with no sky, not because its albedo is lower than this one.
};
