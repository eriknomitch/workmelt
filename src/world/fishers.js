import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, PANE, IDENT, LL, stairRun } from './kit.js';
import { registerProps } from './props.js';
import { registerWilmotProps } from './wilmotprops.js';
import { registerFisherProps, CONIFER } from './fisherprops.js';
import { fbm3, paintMasks, patchGeometry, polyPrism, tubeY } from './util.js';

/**
 * WORLD — THE FISHER'S.
 *
 * A low-poly take on a North Shore country place: a red-brick house under grey
 * slate at the head of a 24 m lap pool, with a flat-roofed pool house down one
 * side, a walled kitchen garden, a sunk tennis court behind an evergreen
 * screen, and a carriage house off the gravel forecourt — compressed to a
 * 56 x 70 m walled ground the way Rust compresses a refinery. Everything is
 * generated here; nothing is loaded from disk.
 *
 *   THE AXIS       the whole map is one north-south spine. The house owns the
 *                  north end of it, the loggia the south, and between them a
 *                  raised stone terrace carries the spa and the lap pool. It
 *                  is the map's longest sightline and its most exposed ground.
 *   THE HOUSE      centre-north. Two enterable storeys, a real staircase, and
 *                  a first floor whose south windows look down the entire
 *                  length of the pool — the overwatch everything else answers.
 *   THE POOL HOUSE east of the terrace: a long flat-roofed building with a
 *                  colonnade on the water and an outside stair to a walkable
 *                  roof. The map's second storey, and the counter to the house.
 *   THE GARDEN     north-east, behind a 1.15 m brick wall: raised beds at
 *                  crouch height, gravel paths between them, a potting shed in
 *                  the corner. Cover you fight *inside*, not around.
 *   THE COURT      west, screened by spruce. Wide open acrylic with one way in.
 *   THE FORECOURT  west of the house: gravel, a planted island, the carriage
 *                  house on its north side and the drive gate behind it.
 *
 * LOW POLY IS THE BRIEF, same as Rust, Wilmot and the Loop: chunky massing,
 * chamfered boxes and capped tubes, with all surface detail carried by the
 * shared procedural materials.
 *
 * AND PERFORMANCE IS THE TIE-BREAKER — this map spends less than Wilmot does
 * on the same acreage, on purpose, and the three decisions that buy it are:
 *
 *   1. THE GROUND IS FLAT INSIDE THE BOUNDARY. Wilmot digs a sunken garden and
 *      a pool basin into its height field, which is what forces its terrain to
 *      96 x 96 quads. Here the pool sits inside a RAISED terrace instead, so
 *      the basin is built geometry that was going to exist anyway and the lawn
 *      needs no resolution at all: 60 x 60 quads carries the whole estate.
 *   2. THE EVERGREENS ARE OPAQUE. Every green volume on Wilmot is a pair — a
 *      solid core plus an alpha-cut leaf shell. The ~150 conifers here are one
 *      opaque prototype each (see `fisherprops.js`), which is half the draw
 *      calls and none of the overdraw.
 *   3. THE GARDEN LIBRARY IS BORROWED, not rebuilt. `wilmotprops.js` already
 *      owns hedges, oaks, topiary, urns, benches and loungers; this map
 *      registers them and adds three prototypes of its own.
 *
 * LAYOUT NOTES
 *   Authored in LEVEL space, north at -Z, the house at the north end of the
 *   axis with its entrance front facing west onto the forecourt and its garden
 *   front facing south down the pool. The vertical routes are stairs only, as
 *   everywhere else in the game: the house's internal stair, and the outside
 *   flight up to the pool house roof. The pool is wadeable — its floor collider
 *   sits 0.58 m under the coping and a step at each end walks back out, so
 *   falling in is a detour, never a trap.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

const H = Math.PI / 2;

export const FISHER = {
  /** Half-extents of the grounds. The boundary treeline sits on these. */
  halfX: 28,
  halfZ: 35,
  /** Half-thickness of the treeline's collision slab, and how tall it stands. */
  treeT: 0.9,
  treeWall: 4.2,
  /** The clipped base hedge the spruces stand in. */
  hedgeH: 1.35,
  y: 0,
};

/**
 * The five buildings. Same shape as the market's `BUILDINGS` entries so
 * `ui/minimap` can draw them. `h` is the eaves (or parapet) line of the mass.
 */
export const STRUCTURES = [
  { id: 'house', x: 0, z: -24.5, w: 22, d: 11, floors: 2, h: 6.5 },
  { id: 'poolhouse', x: 13, z: 2, w: 6.5, d: 20, floors: 1, h: 3.5 },
  { id: 'carriage', x: -20, z: -30, w: 10, d: 7, floors: 1, h: 3.3 },
  { id: 'shed', x: 22.5, z: -30.2, w: 6, d: 4.2, floors: 1, h: 2.8 },
  { id: 'loggia', x: 8.5, z: 24.5, w: 9, d: 5.5, floors: 1, h: 3.2 },
];

/** The house's storey heights, shared by walls, floors and the stair. */
const HOUSE = { floor: 0.3, g: 3.3, deck: 3.6, top: 6.5, rise: 2.5 };

/**
 * The raised stone terrace: one platform carrying the spa, the lap pool and
 * the house's whole garden front. 0.3 m proud of the lawn — under the 0.42 m
 * a standing character steps and inside the 0.3 m a crouching one does, so it
 * is a plinth you walk onto from any side and never a wall.
 */
export const TERRACE = { x0: -7.5, z0: -19, x1: 7.5, z1: 20.5, h: 0.3 };

/** The wider apron of the terrace where it meets the house's south face. */
export const APRON = { x0: -10.5, z0: -19, x1: 10.5, z1: -15.5 };

/** The lap pool, cut out of the terrace. Water sits at `waterY`. */
export const POOL = { x0: -3.6, z0: -8.5, x1: 3.6, z1: 15, waterY: 0.1, walkY: -0.28 };

/** The round spa at the head of the pool: cover you fight around. */
export const SPA = { x: 0, z: -12.6, r: 2.6 };

/** The tennis court: run-off apron, playing slab and the net line. */
export const TENNIS = { x0: -25.5, z0: 4, x1: -13, z1: 26, inset: 1.3, netZ: 15 };

/** The walled kitchen garden. `t` is the wall thickness, `h` its coping line. */
export const GARDEN = { x0: 13.5, z0: -33, x1: 26.5, z1: -20, h: 1.15, t: 0.45 };

/**
 * The garden wall, as axis-aligned runs: `[cx, cz, ry, len]`. The gaps BETWEEN
 * the runs are the two ways in — west from the house lane, south to the east
 * lawn — so the openings are authored once and the occupancy test, the build
 * and the selftest all read the same table.
 */
export const GARDEN_WALLS = [
  [20, -33, 0, 13], // north
  [26.5, -26.5, H, 13], // east
  [16.1, -20, 0, 5.2], // south, west of the path
  [23.9, -20, 0, 5.2], // south, east of the path
  [13.5, -30.15, H, 5.7], // west, north of the lane
  [13.5, -22.35, H, 4.7], // west, south of the lane
];

/** Raised beds inside the garden: `[x, z, w, d]`. 0.55 m — crouch cover. */
export const BEDS = [
  [17.2, -23.6, 5.2, 1.7],
  [23, -23.6, 5.2, 1.7],
  [17.2, -26.6, 5.2, 1.7],
  [23, -26.6, 5.2, 1.7],
  [16.5, -29.6, 3.8, 1.7],
];

/** The gravel forecourt and the planted island in the middle of it. */
export const FORECOURT = { x: -17.5, z: -21, r: 6.2, island: 2.4 };

/**
 * Boundary openings: `[u, side, w]`, `u` in wall-local coordinates (see
 * `alongWall` — on the east and west runs u counts back along -Z). Both are
 * gated shut, and `maps.selftest.mjs` walks every line across them.
 */
export const GATES = [
  { u: 21, side: 'w', w: 4.5 }, // the drive gate, opposite the forecourt
  { u: 14, side: 's', w: 3.0 }, // the service gate behind the orchard
];

/**
 * Spruce rows: `[x, z, ry, len]`. Axis-aligned only — the occupancy test reads
 * them as rects. These are the estate's interior walls: they screen the court,
 * flank the pool axis and cut the two sightlines the buildings do not.
 */
export const CONIFER_ROWS = [
  // north of the court the west lawn is 20 m wide, so the terrace gets its own
  // screen; alongside the court there is only a 5.5 m corridor between the two,
  // and ONE row has to serve both or the whole west flank closes up
  [-10.4, -5, H, 14],
  [-19.25, 2.4, 0, 12.5], // the court's north screen
  [-11.4, 8, H, 10], // the court's east screen, north of the way in
  [-11.4, 22.5, H, 9], // …and south of it, with 5 m between them
  [-22, -13, 0, 8], // between the forecourt and the west lawn
  [10.4, 17.5, H, 6], // closes the terrace's south-east corner
];

/** Specimen trees on the lawns: `[x, z, scale]`. Trunks are solid. */
export const TREES = [
  [-14.5, 6, 1.05],
  [-16.5, -8.5, 0.95],
  [-24, -6, 1],
  [-6, 32, 1.05],
  [20.5, -12, 1.1],
  [25.5, -4.5, 0.95],
  [18.5, 6, 1],
  [4, -33, 0.9],
  [-25, 31.5, 1.1],
  [26, 31, 1],
];

/** The orchard behind the loggia: a planted grid, `[x, z]`, all one scale. */
export const ORCHARD = (() => {
  const out = [];
  for (const x of [16, 20, 24]) for (const z of [15.5, 19.5, 23.5, 27.5]) out.push([x, z]);
  return out;
})();

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the house, so everyone comes in reading the landmark.
 *
 * INDEX 0 is the boot/dev spawn: the south lawn on the axis, looking straight
 * up the pool at the whole garden front of the house.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - 0, z - -24.5) + turn;
export const FISHERS_SPAWNS = [
  [0, 30, 0, 'south-lawn'], // FROZEN — boot spawn
  [-7.5, 29.5, 0.2, 'south-lawn'],
  [6, 31.5, -0.2, 'south-lawn'],
  [-3, 26.5, 0.1, 'south-lawn'],

  [-21, -24.5, 0.35, 'forecourt'],
  [-14.5, -24.5, 0.2, 'forecourt'],
  [-21.5, -17.5, 0.4, 'forecourt'],
  [-13.5, -17.5, 0.15, 'forecourt'],

  [16, -21.5, -0.3, 'kitchen-garden'],
  [24.5, -21.5, -0.45, 'kitchen-garden'],
  [15.5, -31.5, -0.5, 'kitchen-garden'],
  [21.5, -25.1, -0.35, 'kitchen-garden'],

  // the court itself is a zone — it is enclosed by spruce on two sides and the
  // treeline on the other two, so it plays as a room rather than as open lawn
  [-19, 10, 0.45, 'tennis'],
  [-24, 14, 0.5, 'tennis'],
  [-14, 20, 0.3, 'tennis'],
  [-19, 22, 0.45, 'tennis'],

  [-22, 30.5, 0.4, 'court-lawn'],
  [-25.5, 27.5, 0.5, 'court-lawn'],
  [-15.5, 31, 0.3, 'court-lawn'],

  [12, -11.5, -0.25, 'poolhouse'],
  [17.5, -11, -0.4, 'poolhouse'],
  [13.8, 15.5, -0.2, 'poolhouse'],
  [17.5, 14, -0.3, 'poolhouse'],

  [22.5, -8, -0.4, 'east-lawn'],
  [25.5, -15, -0.5, 'east-lawn'],
  [21.5, -2, -0.3, 'east-lawn'],
  [25.5, 4, -0.4, 'east-lawn'],

  [-13.5, -6.5, 0.3, 'west-lawn'],
  [-15.5, -12.5, 0.4, 'west-lawn'],
  [-14, 0, 0.35, 'west-lawn'],
  [-17, -4, 0.4, 'west-lawn'],

  [18, 17.5, -0.2, 'orchard'],
  [22, 25.5, -0.3, 'orchard'],
  [25, 31, -0.4, 'orchard'],
  [16, 30.5, -0.3, 'orchard'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above.
 *
 * What is deliberately NOT in here: the terrace platform, the tennis slab, the
 * pool house roof and the garden's interior. All four are walkable, and a
 * blocker over them would take a third of the map off the minimap and out of
 * the spawn director's reach.
 */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) {
    // the loggia is open on three sides — only its back wall is solid
    if (s.id === 'loggia') continue;
    out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  }
  out.push([4, 27, 13, 27.5]); // the loggia's back wall
  // the pool and the spa, plus their coping: no spawns treading water
  out.push([POOL.x0 - 0.5, POOL.z0 - 0.5, POOL.x1 + 0.5, POOL.z1 + 0.5]);
  out.push([SPA.x - SPA.r - 0.3, SPA.z - SPA.r - 0.3, SPA.x + SPA.r + 0.3, SPA.z + SPA.r + 0.3]);
  out.push([FORECOURT.x - FORECOURT.island, FORECOURT.z - FORECOURT.island, FORECOURT.x + FORECOURT.island, FORECOURT.z + FORECOURT.island]);
  for (const [cx, cz, ry, len] of GARDEN_WALLS) {
    const hx = (ry === 0 ? len : GARDEN.t) / 2;
    const hz = (ry === 0 ? GARDEN.t : len) / 2;
    out.push([cx - hx, cz - hz, cx + hx, cz + hz]);
  }
  for (const [x, z, w, d] of BEDS) out.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
  for (const [x, z, ry, len] of CONIFER_ROWS) {
    const hx = (ry === 0 ? len : CONIFER.r * 1.5) / 2 + 0.05;
    const hz = (ry === 0 ? CONIFER.r * 1.5 : len) / 2 + 0.05;
    out.push([x - hx, z - hz, x + hx, z + hz]);
  }
  for (const [x, z, s] of TREES) out.push([x - 0.45 * s, z - 0.45 * s, x + 0.45 * s, z + 0.45 * s]);
  for (const [x, z] of ORCHARD) out.push([x - 0.3, z - 0.3, x + 0.3, z + 0.3]);
  // the tennis net, the pool house's outside stair, the closed gates
  out.push([TENNIS.x0 - 0.4, TENNIS.netZ - 0.15, TENNIS.x1 + 0.4, TENNIS.netZ + 0.15]);
  out.push([16.3, -6.75, 20.3, -5.25]);
  out.push([-FISHER.halfX - 0.4, -23.3, -FISHER.halfX + 0.5, -18.7]);
  out.push([12.4, FISHER.halfZ - 0.5, 15.6, FISHER.halfZ + 0.4]);
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the grounds. */
export function inSolidFishers(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/** Can a character stand here? Inside the treeline and off every footprint. */
export function standableAtFishers(x, z, margin = 0.55) {
  if (Math.abs(x) > FISHER.halfX - FISHER.treeT - margin) return false;
  if (Math.abs(z) > FISHER.halfZ - FISHER.treeT - margin) return false;
  return !inSolidFishers(x, z, margin);
}

/** True where a character can stand outdoors — the minimap's floor. */
export function isOpenFishers(x, z, m = 0.3) {
  if (Math.abs(x) > FISHER.halfX - FISHER.treeT || Math.abs(z) > FISHER.halfZ - FISHER.treeT) return false;
  return !inSolidFishers(x, z, m);
}

/**
 * Analytic floor height.
 *
 * FLAT INSIDE THE BOUNDARY, and that is a design decision rather than a
 * shortcut: everything this map does vertically — the terrace, the pool basin,
 * the raised beds, the pool house roof — is BUILT, so the height field carries
 * nothing but a mown roll nobody can feel. That is what lets the terrain plane
 * be sampled at 2.5 m instead of Wilmot's 1.75 m and still be exact where it
 * matters. Outside, the parkland rolls away and climbs into a treeline berm
 * that keeps the horizon from being a flat band of sky — same trick as Rust's
 * ridge, for the same reason.
 */
export function groundYFishers(x, z) {
  const out = Math.max(Math.abs(x) - FISHER.halfX, Math.abs(z) - FISHER.halfZ);
  if (out > 0) {
    const t = Math.min(1, out / 10);
    const roll = (fbm3(x * 0.045, 7.3, z * 0.045, 3) - 0.5) * 1.5 * t;
    const berm = Math.min(1, Math.max(0, (out - 4) / 16));
    return 0.02 + roll + berm * berm * (2.8 + fbm3(x * 0.03, 3.1, z * 0.03, 2) * 3.2);
  }
  return 0.02 + (fbm3(x * 0.11, 5.1, z * 0.11, 2) - 0.5) * 0.05;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* geometry helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _wp = [0, 0];

/** Point `u` metres along a wall centred at (cx, cz) and rotated by `ry`. */
function alongWall(cx, cz, ry, u, out) {
  out[0] = cx + Math.cos(ry) * u;
  out[1] = cz - Math.sin(ry) * u;
  return out;
}

/**
 * The solid spans of a run of length `len` with `holes` punched in it, as
 * `[centre, width]` pairs in wall-local coordinates. Shared by the boundary
 * treeline and by `ewall`, so an opening is an opening for both.
 */
function spans(len, holes) {
  const out = [];
  const sorted = [...holes].sort((a, b) => a.u - b.u);
  let cursor = -len / 2;
  for (const o of sorted) {
    const x0 = o.u - o.w / 2;
    const x1 = o.u + o.w / 2;
    if (x0 > cursor) out.push([(cursor + x0) / 2, x0 - cursor]);
    cursor = Math.max(cursor, x1);
  }
  if (cursor < len / 2) out.push([(cursor + len / 2) / 2, len / 2 - cursor]);
  return out;
}

/**
 * One storey of wall with real openings punched through it — the same solid
 * spans/sill/lintel scheme Rust and Wilmot use, so a doorway is a genuine hole
 * in the collision hull. `holes` are `[{ u, w, y, h }]` in wall-local space.
 */
function ewall(A, key, cx, cz, ry, len, y0, h, t, holes = [], opts = {}) {
  const surface = A.surfaceOf(key);
  const masks = opts.masks ?? [0.5, 0.45, 0.25];
  const seg = (u, w, yc, hh) => {
    if (w < 0.02 || hh < 0.02) return;
    alongWall(cx, cz, ry, u, _wp);
    A.add(key, BOX(A), LL(IDENT, _wp[0], yc, _wp[1], ry, w, hh, t), { masks });
    A.box(surface, _wp[0], yc, _wp[1], w, hh, t, ry);
  };
  const sorted = [...holes].sort((a, b) => a.u - b.u);
  let cursor = -len / 2;
  for (const o of sorted) {
    const x0 = o.u - o.w / 2;
    const x1 = o.u + o.w / 2;
    if (x0 > cursor) seg((cursor + x0) / 2, x0 - cursor, y0 + h / 2, h);
    const oy = o.y ?? 0;
    const oh = o.h ?? h;
    if (oy > 0.02) seg(o.u, o.w, y0 + oy / 2, oy);
    if (oy + oh < h - 0.02) seg(o.u, o.w, y0 + (oy + oh + h) / 2, h - oy - oh);
    cursor = Math.max(cursor, x1);
  }
  if (cursor < len / 2) seg((cursor + len / 2) / 2, len / 2 - cursor, y0 + h / 2, h);
}

/** White-painted sill and lintel around an opening, and glass if asked. */
function dressOpening(A, cx, cz, ry, y0, o, opts = {}) {
  alongWall(cx, cz, ry, o.u, _wp);
  const t = opts.t ?? 0.34;
  const oy = o.y ?? 0;
  if (oy > 0.02) {
    A.add('stone_pale', BOX(A), LL(IDENT, _wp[0], y0 + oy - 0.04, _wp[1], ry, o.w + 0.24, 0.09, t + 0.16), {
      masks: [0.7, 0.3, 0.1],
    });
  }
  A.add('stone_pale', BOX(A), LL(IDENT, _wp[0], y0 + oy + o.h + 0.06, _wp[1], ry, o.w + 0.24, 0.12, t + 0.12), {
    masks: [0.6, 0.35, 0.12],
  });
  if (opts.glass) {
    // The pane is single-sided; `flip` turns it to face OUT of the building.
    const py = ry + (opts.flip ? Math.PI : 0);
    A.add('window_glass', PANE(A), LL(IDENT, _wp[0], y0 + oy + o.h / 2, _wp[1], py, o.w - 0.06, o.h - 0.06, 1));
    // glazing bars: one mullion, one transom
    A.add('frame_white', BOX_THIN(A), LL(IDENT, _wp[0], y0 + oy + o.h / 2, _wp[1], ry, 0.06, o.h, 0.07), {
      masks: [0.7, 0.3, 0.05],
    });
    A.add('frame_white', BOX_THIN(A), LL(IDENT, _wp[0], y0 + oy + o.h * 0.55, _wp[1], ry, o.w, 0.06, 0.07), {
      masks: [0.7, 0.3, 0.05],
    });
  }
}

/** A horizontal slab with collision: floors, decks, terrace treads. */
function deck(A, key, cx, y, cz, w, d, opts = {}) {
  const t = opts.t ?? 0.24;
  A.add(key, BOX(A), LL(IDENT, cx, y - t / 2, cz, opts.ry ?? 0, w, t, d), {
    masks: opts.masks ?? [0.5, 0.5, 0.3],
  });
  A.box(A.surfaceOf(key), cx, y - t / 2, cz, w, t, d, opts.ry ?? 0);
}

/** How long a flight between two heights comes out, before building it. */
function flightLength(from, to, rise = 0.275, run = 0.3) {
  return Math.max(1, Math.round((to - from) / rise)) * run;
}

/** A level-space panel matrix a stair flight can be composed onto. */
function panel(x, y, z, ry) {
  _quat.setFromAxisAngle(_up, ry);
  _pos.set(x, y, z);
  _scl.set(1, 1, 1);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

/** A flight of stone or timber steps climbing in the direction `ry` points. */
function flight(A, x, y, z, ry, top, w = 1.3, opts = {}) {
  const rise = opts.rise ?? 0.275;
  const run = opts.run ?? 0.3;
  const steps = Math.max(1, Math.round((top - y) / rise));
  stairRun(A, panel(x, y, z, ry), 0, 0, 0, w, steps, (top - y) / steps, run, {
    key: opts.key ?? 'stone_pale',
    railing: opts.railing ?? false,
    stringer: opts.stringer !== false,
  });
  const len = steps * run;
  return { top, len, x: x + Math.sin(ry) * len, z: z + Math.cos(ry) * len };
}

/** A structural member between two points — colonnades, rafters, gate rails. */
function strut(A, key, x0, y0, z0, x1, y1, z1, t, masks) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  _pos.set(dx / len, dy / len, dz / len);
  _quat.setFromUnitVectors(_up, _pos);
  _pos.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  _scl.set(t, len, t);
  A.add(key, BOX_THIN(A), new THREE.Matrix4().compose(_pos, _quat, _scl), {
    masks: masks ?? [0.7, 0.35, 0.15],
  });
}

/**
 * A pitched roof with its ridge along X: two slate slabs, a ridge cap, and
 * sloped collision so grenades roll off it instead of through it. Returns the
 * pitch for anyone hanging anything under it.
 */
function gableRoof(A, key, cx, cz, eaves, w, d, rise, opts = {}) {
  const ov = opts.overhang ?? 0.45;
  const half = d / 2 + ov;
  const slope = Math.hypot(half, rise);
  const pitch = Math.atan2(rise, half);
  const wr = w + (opts.endOverhang ?? 0.5) * 2;
  // rx sign: rotating +Z by rx tips it to y' = −sin(rx), so the slab whose
  // local +Z points AWAY from the ridge needs rx = +pitch to fall toward the
  // eaves — that is the s = +1 slab, hence `s * pitch`.
  for (const s of [-1, 1]) {
    const m = LL(IDENT, cx, eaves + rise / 2 - 0.04, cz + (s * half) / 2, 0, wr, 0.16, slope, s * pitch);
    A.add(key, BOX(A), m, { masks: opts.masks ?? [0.55, 0.4, 0.25] });
    A.collideGeo('concrete', BOX_THIN(A), LL(IDENT, cx, eaves + rise / 2, cz + (s * half) / 2, 0, wr, 0.14, slope, s * pitch));
  }
  A.add(key, BOX(A), LL(IDENT, cx, eaves + rise + 0.02, cz, 0, wr, 0.12, 0.34), { masks: [0.7, 0.3, 0.1] });
  return pitch;
}

/** A gable triangle standing in the YZ plane at `x`, ridge along X. */
function gableEnd(A, key, x, cz, y, d, rise, t) {
  const g = polyPrism([[-d / 2, 0], [d / 2, 0], [0, rise]], t);
  g.rotateX(Math.PI / 2);
  A.addOnce(key, g, LL(IDENT, x, y, cz, Math.PI / 2), { masks: [0.5, 0.45, 0.25] });
  A.box('concrete', x + t / 2, y + rise * 0.35, cz, t, rise * 0.7, d * 0.55);
}

/** A flat strip of surfacing laid on the lawn: drive, apron, garden path. */
function strip(A, cx, cz, ry, len, w, key = 'road_dust') {
  const g = new THREE.PlaneGeometry(len, w, Math.max(2, Math.round(len / 4)), 1);
  g.rotateX(-Math.PI / 2);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.2 + fbm3(x * 0.7, 3.3, z * 0.7, 2) * 0.3;
    out[1] = 0.2;
  });
  A.addOnce(key, g, LL(IDENT, cx, 0.045, cz, ry));
}

/** One specimen tree: bark, dark heart, leaf shell — and a solid trunk. */
function tree(A, x, z, s, ry) {
  const y = Math.max(0, groundYFishers(x, z) - 0.04);
  A.put('oak_trunk', x, y, z, ry, s);
  A.put('oak_core', x, y, z, ry, s);
  A.put('oak_leaf', x, y, z, ry, s);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Lawn, drive, paths — and the spruce boundary that seals the grounds. */
function buildGrounds(A, rng) {
  // ------------------------------------------------------------- the lawn --
  // One plane carries the whole estate and the parkland beyond it. 2.5 m
  // cells: nothing inside the boundary is dug, so there is nothing finer to
  // resolve, and the berm outside is smooth by construction.
  const S = 150;
  const N = 60;
  const terrain = new THREE.PlaneGeometry(S, S, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setY(i, groundYFishers(pa.getX(i), pa.getZ(i)) - 0.04);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    // mowing bands: long alternating stripes read at distance, thatch up close
    const bands = 0.5 + 0.5 * Math.sin(z * 0.85 + Math.sin(x * 0.2) * 1.6);
    out[1] = 0.14 + bands * 0.16 + fbm3(x * 0.5, 8.8, z * 0.5, 2) * 0.22;
    out[0] = 0.12;
  });
  A.add('lawn', terrain, null);
  A.collideGeo('dirt', terrain);
  terrain.dispose();

  // ------------------------------------------------ drive, court, paths --
  strip(A, -25.6, -21, 0, 6.5, 4.2); // the run in from the drive gate
  const court = patchGeometry(rng, FORECOURT.r, { lobes: 16, wobble: 0.08 });
  paintMasks(court, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.25;
    out[1] = 0.25;
  });
  A.addOnce('road_dust', court, LL(IDENT, FORECOURT.x, 0.04, FORECOURT.z, 0.3));
  const apron = patchGeometry(rng, 3.2, { lobes: 12, wobble: 0.15 });
  A.addOnce('road_dust', apron, LL(IDENT, -20, 0.045, -25.4, 1.1), { masks: [0.2, 0.3, 0.2] });
  // flagstone links: entrance front to the forecourt, terrace to the garden,
  // terrace to the court gap
  strip(A, -12.6, -24.5, 0, 3.4, 1.8, 'flagstone');
  strip(A, 15.5, -17.6, -0.34, 11.5, 1.6, 'flagstone');
  strip(A, -9.6, 14.5, 0.42, 6.5, 1.5, 'flagstone');

  // ------------------------------------------------------ the boundary --
  /**
   * THE TREELINE IS THE WALL. Wilmot is a walled garden and its perimeter is
   * brick; a North Shore place is screened, not walled, and in every aerial of
   * one the boundary is a solid dark band of spruce. So the seal here is a
   * 1.35 m clipped hedge — merged static, four runs, opaque — with the
   * conifers standing IN it, and one collision slab per span carrying both.
   * The hedge is what stops daylight (and bullets) at ankle height; the
   * spruces are what stop everything above it and what the eye actually reads.
   */
  for (const side of ['n', 'e', 's', 'w']) {
    const ns = side === 'n' || side === 's';
    const ry = ns ? 0 : H;
    const cx = side === 'e' ? FISHER.halfX : side === 'w' ? -FISHER.halfX : 0;
    const cz = side === 'n' ? -FISHER.halfZ : side === 's' ? FISHER.halfZ : 0;
    const len = (ns ? FISHER.halfX : FISHER.halfZ) * 2;
    const holes = GATES.filter((g) => g.side === side);
    for (const [u, w] of spans(len, holes)) {
      alongWall(cx, cz, ry, u, _wp);
      const px = _wp[0];
      const pz = _wp[1];
      A.add('leaf_core', BOX(A), LL(IDENT, px, FISHER.hedgeH / 2, pz, ry, w, FISHER.hedgeH, FISHER.treeT * 1.7), {
        masks: [0.4, 0.4, 0.35],
      });
      A.box('foliage', px, FISHER.treeWall / 2, pz, w, FISHER.treeWall, FISHER.treeT * 2, ry);
      // the spruces themselves, alternating either side of the hedge line
      const n = Math.max(1, Math.round(w / 2.5));
      for (let i = 0; i < n; i++) {
        const t = -w / 2 + (i + 0.5) * (w / n);
        alongWall(px, pz, ry, t, _wp);
        const off = (i % 2 === 0 ? 1 : -1) * rng.range(0.15, 0.5);
        A.put(
          'conifer',
          _wp[0] + Math.sin(ry) * off,
          -0.05,
          _wp[1] + Math.cos(ry) * off,
          rng.float() * 6.28,
          rng.range(0.82, 1.22)
        );
      }
    }
    // a sparser rank outside, for depth. No collision: nothing out there plays.
    const outer = Math.round(len / 4.5);
    for (let i = 0; i < outer; i++) {
      const t = -len / 2 + (i + 0.5) * (len / outer);
      alongWall(cx, cz, ry, t, _wp);
      const off = rng.range(2.4, 7.5);
      const px = _wp[0] + (ns ? rng.range(-1.5, 1.5) : Math.sign(cx) * off);
      const pz = _wp[1] + (ns ? Math.sign(cz) * off : rng.range(-1.5, 1.5));
      A.put('conifer', px, groundYFishers(px, pz) - 0.1, pz, rng.float() * 6.28, rng.range(0.9, 1.5));
    }
  }

  // ------------------------------------------------------------ the gates --
  for (const g of GATES) {
    const ns = g.side === 'n' || g.side === 's';
    const ry = ns ? 0 : H;
    const cx = g.side === 'e' ? FISHER.halfX : g.side === 'w' ? -FISHER.halfX : 0;
    const cz = g.side === 'n' ? -FISHER.halfZ : g.side === 's' ? FISHER.halfZ : 0;
    // jamb piers either side of the opening
    for (const s of [-1, 1]) {
      alongWall(cx, cz, ry, g.u + s * (g.w / 2 + 0.35), _wp);
      A.add('stone_pale', BOX(A), LL(IDENT, _wp[0], 1.6, _wp[1], ry, 0.7, 3.2, 0.7), { masks: [0.55, 0.45, 0.3] });
      A.box('concrete', _wp[0], 1.6, _wp[1], 0.7, 3.2, 0.7, ry);
      A.add('stone_pale', BOX_SOFT(A), LL(IDENT, _wp[0], 3.3, _wp[1], ry, 0.84, 0.18, 0.84), { masks: [0.8, 0.3, 0.1] });
    }
    alongWall(cx, cz, ry, g.u, _wp);
    const gx = _wp[0];
    const gz = _wp[1];
    if (g.side === 'w') {
      // wrought iron: rails, bars with spear tips, and a dip in the middle
      for (const yy of [0.25, 1.35, 2.15]) {
        A.add('metal_dark', BOX_THIN(A), LL(IDENT, gx, yy, gz, ry, g.w, 0.07, 0.07), { masks: [0.8, 0.4, 0.1] });
      }
      const bars = Math.round(g.w / 0.28);
      for (let i = 0; i <= bars; i++) {
        alongWall(gx, gz, ry, -g.w / 2 + (i / bars) * g.w, _wp);
        const bh = 2.35 - Math.cos(((i / bars) * 2 - 1) * 1.2) * 0.2;
        A.add('metal_dark', BOX_THIN(A), LL(IDENT, _wp[0], bh / 2 + 0.06, _wp[1], ry, 0.05, bh, 0.05), {
          masks: [0.85, 0.4, 0.1],
        });
      }
      A.box('metal', gx, 1.4, gz, 0.16, 2.8, g.w, 0);
    } else {
      // the service gate: painted boards, a brace, shut and staying shut
      A.add('wood_dark', BOX(A), LL(IDENT, gx, 1.3, gz, ry, g.w - 0.1, 2.6, 0.09), { masks: [0.6, 0.45, 0.25] });
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, gx, 1.3, gz - 0.08, 0.44, g.w - 0.3, 0.16, 0.05), {
        masks: [0.75, 0.4, 0.15],
      });
      A.box('wood', gx, 1.4, gz, g.w, 2.8, 0.18, ry);
    }
  }
}

/** The house: two storeys, a real stair, and the windows over the pool. */
function buildHouse(A, rng) {
  const s = STRUCTURES[0];
  const t = 0.34;
  const { x, z, w, d } = s;
  const g0 = HOUSE.floor;
  const sides = [
    [x, z - d / 2, 0, w], // n — the service lane
    [x + w / 2, z, H, d], // e — toward the kitchen garden
    [x, z + d / 2, 0, w], // s — the garden front, over the pool
    [x - w / 2, z, H, d], // w — the entrance front, onto the forecourt
  ];
  // ground floor. On the east and west runs `u` counts back along -Z.
  const g = [
    [{ u: -6, w: 1.5, y: 0, h: 2.4 }, { u: -1, w: 1.7, y: 0.95, h: 1.7 }, { u: 4.5, w: 1.7, y: 0.95, h: 1.7 }, { u: 9, w: 1.7, y: 0.95, h: 1.7 }],
    [{ u: 0, w: 1.4, y: 0, h: 2.3 }, { u: 3.4, w: 1.5, y: 0.95, h: 1.6 }],
    // french doors line up with the terrace beyond, clear of the partitions
    [{ u: -5.5, w: 1.8, y: 0, h: 2.5 }, { u: 5.5, w: 1.8, y: 0, h: 2.5 }, { u: 0, w: 2.4, y: 0.95, h: 1.7 }, { u: -9.2, w: 1.6, y: 0.95, h: 1.7 }, { u: 9.2, w: 1.6, y: 0.95, h: 1.7 }],
    [{ u: 0, w: 1.8, y: 0, h: 2.6 }, { u: -3.6, w: 1.5, y: 0.95, h: 1.6 }, { u: 3.6, w: 1.5, y: 0.95, h: 1.6 }],
  ];
  // first floor: the south windows are the map's overwatch, and they are big
  const f = [
    [{ u: -6, w: 1.6, y: 0.9, h: 1.5 }, { u: 0, w: 1.6, y: 0.9, h: 1.5 }, { u: 6, w: 1.6, y: 0.9, h: 1.5 }],
    [{ u: 0, w: 1.4, y: 1, h: 1.4 }],
    [{ u: -8.2, w: 2, y: 0.85, h: 1.7 }, { u: -2.8, w: 2, y: 0.85, h: 1.7 }, { u: 2.8, w: 2, y: 0.85, h: 1.7 }, { u: 8.2, w: 2, y: 0.85, h: 1.7 }],
    [{ u: -3.2, w: 1.5, y: 0.9, h: 1.5 }, { u: 3.2, w: 1.5, y: 0.9, h: 1.5 }],
  ];
  const flips = [true, false, false, true]; // which sides' panes face −Z/−X
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    ewall(A, 'brick_red', cx, cz, ry, len, 0, HOUSE.g, t, g[i], { masks: [0.5, 0.45, 0.28] });
    ewall(A, 'brick_red', cx, cz, ry, len, HOUSE.g, HOUSE.top - HOUSE.g, t, f[i], { masks: [0.55, 0.42, 0.22] });
    for (const o of g[i]) if ((o.y ?? 0) > 0) dressOpening(A, cx, cz, ry, 0, o, { glass: true, flip: flips[i] });
    for (const o of f[i]) dressOpening(A, cx, cz, ry, HOUSE.g, o, { glass: true, flip: flips[i] });
    // the string course between the storeys, and the eaves band over both
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, HOUSE.g + 0.04, cz, ry, len + 0.12, 0.14, t + 0.14), {
      masks: [0.7, 0.35, 0.15],
    });
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, HOUSE.top - 0.12, cz, ry, len + 0.12, 0.18, t + 0.16), {
      masks: [0.72, 0.35, 0.15],
    });
  }

  // floors: hardwood over the whole plate, a stairwell cut in the first
  deck(A, 'floor_wood', x, g0, z, w - t, d - t, { t: 0.16, masks: [0.45, 0.4, 0.3] });
  const holeX0 = 4.6;
  const holeX1 = 7.8;
  const holeZ0 = z - d / 2 + t / 2; // against the north wall
  const holeZ1 = -26.2;
  deck(A, 'floor_wood', (-(w - t) / 2 + holeX0) / 2, HOUSE.deck, z, holeX0 + (w - t) / 2, d - t, { t: 0.26 });
  deck(A, 'floor_wood', (holeX1 + (w - t) / 2) / 2, HOUSE.deck, z, (w - t) / 2 - holeX1, d - t, { t: 0.26 });
  deck(A, 'floor_wood', (holeX0 + holeX1) / 2, HOUSE.deck, (holeZ1 + z + d / 2 - t / 2) / 2, holeX1 - holeX0, z + d / 2 - t / 2 - holeZ1, { t: 0.26 });

  // The stair up, tight to the north wall. Its foot is measured BACK from the
  // stairwell's east edge so the top step lands exactly on it — a flight that
  // overshoots comes up under the floor slab and stops at head height.
  flight(A, holeX1 - flightLength(g0, HOUSE.deck, 0.275, 0.3), g0, -28.2, H, HOUSE.deck, 1.25, {
    key: 'wood_dark',
  });
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    A.add('wood_dark', BOX_THIN(A), LL(IDENT, (x0 + x1) / 2, HOUSE.deck + 0.92, (z0 + z1) / 2, ry, len, 0.07, 0.07), {
      masks: [0.7, 0.35, 0.1],
    });
    const n = Math.max(2, Math.round(len / 0.5));
    for (let i = 0; i <= n; i++)
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, x0 + ((x1 - x0) * i) / n, HOUSE.deck + 0.46, z0 + ((z1 - z0) * i) / n, 0, 0.05, 0.92, 0.05), { masks: [0.7, 0.4, 0.1] });
    A.box('wood', (x0 + x1) / 2, HOUSE.deck + 0.5, (z0 + z1) / 2, Math.max(len, 0.1), 1, 0.09, ry);
  };
  rail(holeX0, holeZ1, holeX1, holeZ1);
  rail(holeX0, holeZ0 + 0.1, holeX0, holeZ1);

  // ground-floor rooms: the hall on the entrance axis, a room either side
  ewall(A, 'plaster_cream', -3, z, H, d - t, 0, HOUSE.g, 0.2, [{ u: 4, w: 1.2, y: 0, h: 2.2 }], { masks: [0.4, 0.45, 0.35] });
  ewall(A, 'plaster_cream', 3, z, H, d - t, 0, HOUSE.g, 0.2, [{ u: 4, w: 1.2, y: 0, h: 2.2 }], { masks: [0.4, 0.45, 0.35] });
  // first floor: two bedrooms off the landing
  ewall(A, 'plaster_cream', -3.5, z, H, d - t, HOUSE.deck, HOUSE.top - HOUSE.deck, 0.2, [{ u: -2.4, w: 1.1, y: 0, h: 2.2 }], { masks: [0.42, 0.45, 0.32] });
  ewall(A, 'plaster_cream', 3.2, z, H, d - t, HOUSE.deck, HOUSE.top - HOUSE.deck, 0.2, [{ u: -2.4, w: 1.1, y: 0, h: 2.2 }], { masks: [0.42, 0.45, 0.32] });

  // the roof: slate, brick gables, three dormers over the pool, two stacks
  gableRoof(A, 'roof_slate', x, z, HOUSE.top, w, d, HOUSE.rise);
  gableEnd(A, 'brick_red', x - w / 2 + t / 2, z, HOUSE.top, d - 0.1, HOUSE.rise - 0.12, t);
  gableEnd(A, 'brick_red', x + w / 2 - t / 2, z, HOUSE.top, d - 0.1, HOUSE.rise - 0.12, t);
  /**
   * The dormers are the one piece of pure decoration on this map, and they
   * earn it: a two-storey box under a plain gable reads as a warehouse, and
   * three dormers stepping along the south slope is the whole difference
   * between that and a house. Four boxes each, no collision — nothing walks
   * on a roof here.
   */
  const half = d / 2 + 0.45;
  for (const dx of [-6.6, 0, 6.6]) {
    const dz = z + 2.9;
    const dy = HOUSE.top + HOUSE.rise * (1 - 2.9 / half);
    A.add('brick_red', BOX(A), LL(IDENT, dx, dy + 0.5, dz, 0, 1.5, 1.55, 1.5), { masks: [0.55, 0.45, 0.28] });
    A.add('window_void', BOX_THIN(A), LL(IDENT, dx, dy + 0.55, dz + 0.76, 0, 1.05, 1.05, 0.06));
    A.add('window_glass', PANE(A), LL(IDENT, dx, dy + 0.55, dz + 0.79, 0, 1, 1, 1));
    A.add('roof_slate', BOX(A), LL(IDENT, dx, dy + 1.36, dz + 0.15, 0, 1.85, 0.14, 1.5, 0.42), { masks: [0.6, 0.4, 0.2] });
    A.add('roof_slate', BOX(A), LL(IDENT, dx, dy + 1.36, dz - 0.85, 0, 1.85, 0.14, 1.5, -0.42), { masks: [0.6, 0.4, 0.2] });
  }
  for (const [chx, chz] of [[-10.2, z - 1.2], [10.2, z - 1.2]]) {
    A.add('brick_red', BOX(A), LL(IDENT, chx, 4.9, chz, 0, 1.1, 9.8, 1.6), { masks: [0.55, 0.5, 0.3] });
    A.box('concrete', chx, HOUSE.top / 2, chz, 1.1, HOUSE.top, 1.6);
    A.add('stone_pale', BOX_SOFT(A), LL(IDENT, chx, 9.88, chz, 0, 1.3, 0.18, 1.8), { masks: [0.8, 0.3, 0.1] });
    for (const pz of [-0.45, 0.45]) {
      A.addOnce('brick_red', tubeY(0.16, 0.5, { radial: 8 }), LL(IDENT, chx, 9.96, chz + pz), { masks: [0.7, 0.4, 0.2] });
    }
  }

  // the entrance porch: two white columns, a flat hood and a stone platform
  for (const pz of [-1.4, 1.4]) {
    A.addOnce('frame_white', tubeY(0.15, 3.1, { radial: 10 }), LL(IDENT, x - w / 2 - 1.15, 0.28, z + pz), {
      masks: [0.6, 0.35, 0.15],
    });
    A.box('concrete', x - w / 2 - 1.15, 1.85, z + pz, 0.34, 3.1, 0.34);
  }
  A.add('stone_pale', BOX(A), LL(IDENT, x - w / 2 - 0.8, 3.5, z, 0, 2.2, 0.24, 4.4), { masks: [0.65, 0.35, 0.15] });
  A.box('concrete', x - w / 2 - 0.8, 3.5, z, 2.2, 0.24, 4.4);
  deck(A, 'stone_pale', x - w / 2 - 1, 0.28, z, 2.6, 4.6, { t: 0.14 });
  // and a threshold step at the north door
  deck(A, 'stone_pale', -6, 0.2, z - d / 2 - 0.6, 2, 1.3, { t: 0.12 });

  A.interiorLights.push({ x: -6.5, y: HOUSE.g - 0.5, z });
  A.interiorLights.push({ x: 0, y: HOUSE.g - 0.5, z });
  A.interiorLights.push({ x: 7, y: HOUSE.g - 0.5, z });
  A.interiorLights.push({ x: -6, y: HOUSE.top - 0.6, z });
  A.interiorLights.push({ x: 6.5, y: HOUSE.top - 0.6, z });
}

/** The terrace platform, the spa, the lap pool and the poolside. */
function buildTerrace(A, rng) {
  const T = TERRACE;
  const P = POOL;
  const plate = (x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    A.add('deck_pale', BOX(A), LL(IDENT, cx, T.h / 2, cz, 0, x1 - x0, T.h, z1 - z0), { masks: [0.5, 0.45, 0.3] });
    A.box('concrete', cx, T.h / 2, cz, x1 - x0, T.h, z1 - z0);
  };
  // the deck, laid as four plates around the pool's opening
  plate(T.x0, T.z0, T.x1, P.z0);
  plate(T.x0, P.z1, T.x1, T.z1);
  plate(T.x0, P.z0, P.x0, P.z1);
  plate(P.x1, P.z0, T.x1, P.z1);
  // the wings where the terrace widens against the house
  plate(APRON.x0, APRON.z0, T.x0, APRON.z1);
  plate(T.x1, APRON.z0, APRON.x1, APRON.z1);

  // the coping ring, proud of the deck, and the tiled shell under it
  for (const [sx, sz, sw, sd] of [
    [(P.x0 + P.x1) / 2, P.z0 - 0.3, P.x1 - P.x0 + 1.2, 0.6],
    [(P.x0 + P.x1) / 2, P.z1 + 0.3, P.x1 - P.x0 + 1.2, 0.6],
    [P.x0 - 0.3, (P.z0 + P.z1) / 2, 0.6, P.z1 - P.z0],
    [P.x1 + 0.3, (P.z0 + P.z1) / 2, 0.6, P.z1 - P.z0],
  ]) {
    A.add('deck_pale', BOX_SOFT(A), LL(IDENT, sx, T.h + 0.03, sz, 0, sw, 0.1, sd), { masks: [0.72, 0.3, 0.12] });
    A.box('concrete', sx, T.h + 0.03, sz, sw, 0.1, sd);
  }
  /**
   * The tiled shell. The visible floor sits just under the walk collider so a
   * wader STANDS on what they can see — a deep-looking basin under a shallow
   * collider would float everyone in it half a metre over the tiles.
   */
  const cx = (P.x0 + P.x1) / 2;
  const cz = (P.z0 + P.z1) / 2;
  const pw = P.x1 - P.x0;
  const pd = P.z1 - P.z0;
  for (const [sx, sz, sw, sd] of [
    [cx, P.z0 + 0.25, pw, 0.5],
    [cx, P.z1 - 0.25, pw, 0.5],
    [P.x0 + 0.25, cz, 0.5, pd - 1],
    [P.x1 - 0.25, cz, 0.5, pd - 1],
  ]) {
    A.add('pool_tile', BOX(A), LL(IDENT, sx, -0.15, sz, 0, sw, 0.9, sd), { masks: [0.45, 0.4, 0.25] });
    A.box('concrete', sx, -0.15, sz, sw, 0.9, sd);
  }
  A.add('pool_tile', BOX(A), LL(IDENT, cx, -0.46, cz, 0, pw - 0.2, 0.2, pd - 0.2), { masks: [0.4, 0.45, 0.3] });
  // the wading floor: what you actually stand on, tagged water for the FX
  A.box('water', cx, P.walkY - 0.2, cz, pw - 1.1, 0.4, pd - 1.1);
  // a step at each end, so the pool is a detour and never a trap
  for (const sz of [P.z0 + 1.2, P.z1 - 1.2]) {
    A.add('pool_tile', BOX(A), LL(IDENT, cx, -0.15, sz, 0, pw - 1.1, 0.26, 0.9), { masks: [0.5, 0.4, 0.2] });
    A.box('concrete', cx, -0.15, sz, pw - 1.1, 0.26, 0.9);
  }
  const water = new THREE.PlaneGeometry(pw - 0.15, pd - 0.15, 1, 1);
  water.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', water, LL(IDENT, cx, P.waterY, cz));

  // ---------------------------------------------------------------- the spa --
  // A raised round basin at the head of the pool: waist-high cover on the one
  // piece of ground both fronts of the house look straight down.
  A.addOnce('deck_pale', tubeY(SPA.r, 0.62, { radial: 18 }), LL(IDENT, SPA.x, T.h - 0.02, SPA.z), {
    masks: [0.55, 0.45, 0.25],
  });
  // the bowl: a shallow tiled dish inside the rim, so the spa is the same
  // turquoise as the pool rather than a stone ring with a blue disc in it
  A.addOnce('pool_tile', tubeY(SPA.r - 0.16, 0.5, { radial: 18 }), LL(IDENT, SPA.x, T.h - 0.02, SPA.z), {
    masks: [0.4, 0.4, 0.3],
  });
  A.addOnce('deck_pale', tubeY(SPA.r + 0.14, 0.12, { radial: 18 }), LL(IDENT, SPA.x, T.h + 0.5, SPA.z), {
    masks: [0.78, 0.3, 0.1],
  });
  for (const [sx, sz, sw, sd] of [
    [SPA.x, SPA.z - SPA.r + 0.2, SPA.r * 1.7, 0.45],
    [SPA.x, SPA.z + SPA.r - 0.2, SPA.r * 1.7, 0.45],
    [SPA.x - SPA.r + 0.2, SPA.z, 0.45, SPA.r * 1.7],
    [SPA.x + SPA.r - 0.2, SPA.z, 0.45, SPA.r * 1.7],
  ]) {
    A.box('concrete', sx, (T.h + 0.62) / 2, sz, sw, T.h + 0.62, sd);
  }
  A.box('water', SPA.x, T.h + 0.25, SPA.z, SPA.r * 1.3, 0.3, SPA.r * 1.3);
  const spaWater = new THREE.CircleGeometry(SPA.r - 0.16, 18);
  spaWater.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', spaWater, LL(IDENT, SPA.x, T.h + 0.4, SPA.z));

  // the diving board over the deep end, and the poolside furniture
  A.add('deck_pale', BOX(A), LL(IDENT, cx, T.h + 0.24, P.z1 + 1.1, 0, 0.6, 0.48, 0.5), { masks: [0.6, 0.4, 0.2] });
  A.box('concrete', cx, T.h + 0.24, P.z1 + 1.1, 0.6, 0.48, 0.5);
  A.add('wood_pale', BOX(A), LL(IDENT, cx, T.h + 0.5, P.z1 + 0.2, 0, 0.5, 0.09, 2.1), { masks: [0.7, 0.3, 0.1] });
  A.box('wood', cx, T.h + 0.5, P.z1 + 0.2, 0.5, 0.09, 2.1);

  A.put('lounger', -5.6, T.h, -5, H + 0.06, 1);
  A.put('lounger', -5.6, T.h, -2.6, H - 0.04, 1);
  A.put('lounger', -5.6, T.h, -0.2, H + 0.08, 1);
  A.put('parasol', -5.9, T.h, -3.8, 0.4, 1);
  A.put('lounger', 5.6, T.h, 8, -H + 0.05, 1);
  A.put('lounger', 5.6, T.h, 10.4, -H - 0.06, 1);
  A.put('parasol', 5.9, T.h, 9.2, 1.3, 1);
  A.put('table_small', -5.7, T.h, 3.4, 0.3, 0.95);
  A.put('chair', -4.6, T.h, 3.6, 1.6, 1);
  A.put('planter', -6.6, T.h, -16.4, 0.4, 1.1);
  A.put('planter', 6.6, T.h, -16.4, 1.9, 1.1);
  A.put('bench', 0, T.h, 18.6, 0, 1);
}

/** The pool house: colonnade on the water, a walkable roof, one way up. */
function buildPoolHouse(A, rng) {
  const s = STRUCTURES[1];
  const { x, z, w, d } = s;
  const t = 0.3;
  const wallH = s.h;
  const sides = [
    [x, z - d / 2, 0, w], // n
    [x + w / 2, z, H, d], // e — the lane, and the stair up
    [x, z + d / 2, 0, w], // s
    [x - w / 2, z, H, d], // w — the colonnade, facing the pool
  ];
  const holes = [
    [{ u: 0, w: 1.5, y: 0, h: 2.4 }],
    [{ u: 6, w: 1.6, y: 1, h: 1.5 }, { u: -6, w: 1.6, y: 1, h: 1.5 }],
    [{ u: 0, w: 1.6, y: 1, h: 1.5 }],
    [{ u: -7.4, w: 2, y: 0, h: 2.6 }, { u: -2.5, w: 2, y: 0, h: 2.6 }, { u: 2.5, w: 2, y: 0, h: 2.6 }, { u: 7.4, w: 2, y: 0, h: 2.6 }],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    ewall(A, 'plaster_white', cx, cz, ry, len, 0, wallH, t, holes[i], { masks: [0.45, 0.45, 0.3] });
    for (const o of holes[i]) {
      if (i === 3) continue; // the colonnade openings are glazed below
      dressOpening(A, cx, cz, ry, 0, o, { glass: (o.y ?? 0) > 0, flip: i === 0 || i === 3, t });
    }
  }
  // the colonnade: glazed doors between white piers, under a stone lintel
  for (const o of holes[3]) {
    alongWall(sides[3][0], sides[3][1], H, o.u, _wp);
    A.add('window_glass', PANE(A), LL(IDENT, _wp[0] - 0.02, o.h / 2, _wp[1], -H, o.w - 0.08, o.h - 0.06, 1));
    A.add('frame_white', BOX_THIN(A), LL(IDENT, _wp[0], o.h / 2, _wp[1], H, 0.07, o.h, 0.08), { masks: [0.7, 0.3, 0.05] });
  }
  A.add('stone_pale', BOX_THIN(A), LL(IDENT, x - w / 2, wallH - 0.2, z, H, d + 0.1, 0.3, t + 0.3), {
    masks: [0.7, 0.35, 0.15],
  });
  // plinth, floor, flat roof and the parapet that makes the roof a position
  ewall(A, 'stone_pale', x, z - d / 2, 0, w + 0.3, 0, 0.26, t + 0.2, [{ u: 0, w: 1.5, y: 0, h: 0.26 }], { masks: [0.6, 0.4, 0.2] });
  ewall(A, 'stone_pale', x, z + d / 2, 0, w + 0.3, 0, 0.26, t + 0.2, [], { masks: [0.6, 0.4, 0.2] });
  deck(A, 'floor_concrete', x, 0.24, z, w - t, d - t, { t: 0.16 });
  deck(A, 'roof_screed', x, wallH, z, w + 0.3, d + 0.3, { t: 0.26, masks: [0.6, 0.3, 0.2] });
  const par = [
    [x, z - d / 2 - 0.15, 0, w + 0.3, []],
    [x, z + d / 2 + 0.15, 0, w + 0.3, []],
    [x - w / 2 - 0.15, z, H, d + 0.3, []],
    [x + w / 2 + 0.15, z, H, d + 0.3, [{ u: 8, w: 1.7, y: 0, h: 0.9 }]], // the stair head at z = -6
  ];
  for (const [cx, cz, ry, len, cut] of par) {
    ewall(A, 'plaster_white', cx, cz, ry, len, wallH, 0.9, 0.24, cut, { masks: [0.5, 0.4, 0.25] });
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, wallH + 0.94, cz, ry, len + 0.2, 0.1, 0.4), {
      masks: [0.75, 0.3, 0.1],
    });
  }
  // the outside flight, off the east lane. Its length is measured so the top
  // tread lands exactly on the roof edge, in the gap left in the parapet.
  flight(A, x + w / 2 + 0.15 + flightLength(0.02, wallH, 0.275, 0.3), 0.02, -6, -H, wallH, 1.5, {
    railing: true,
  });

  // inside: a long room with what a pool house holds
  A.put('table', x, 0.24, z - 6, H, 1);
  A.put('chair', x - 1.2, 0.24, z - 6.4, 1.4, 1);
  A.put('chair', x + 1.2, 0.24, z - 5.6, -1.7, 1);
  A.put('cabinet', x + 2, 0.24, z + 1.4, -H, 1);
  A.put('shelf', x + 2, 0.24, z + 4.6, -H, 1);
  A.put('crate_a', x - 1.9, 0.24, z + 7.4, 0.5, 1);
  A.put('barrel_wood', x + 1.8, 0.24, z + 8.2, 0.9, 1);
  A.put('bucket', x - 2, 0.24, z + 5.4, 2.1, 1);

  A.interiorLights.push({ x, y: wallH - 0.5, z: z - 5 });
  A.interiorLights.push({ x, y: wallH - 0.5, z: z + 5 });
}

/** The loggia closing the south end of the axis: open on three sides. */
function buildLoggia(A, rng) {
  const s = STRUCTURES[4];
  const { x, z, w, d } = s;
  // the floor runs north past the columns to meet the terrace, so the axis is
  // one continuous surface from the house's french doors to the back wall
  deck(A, 'flagstone', x, 0.26, z - 0.9, w, d + 1.8, { t: 0.26, masks: [0.5, 0.45, 0.35] });
  // the back wall, and six columns carrying the roof
  ewall(A, 'stone_pale', x, z + d / 2, 0, w, 0, s.h, 0.4, [{ u: -2.6, w: 1.2, y: 1.1, h: 1.2 }, { u: 2.6, w: 1.2, y: 1.1, h: 1.2 }], { masks: [0.5, 0.45, 0.3] });
  for (const cx of [x - w / 2 + 0.5, x, x + w / 2 - 0.5]) {
    for (const cz of [z - d / 2 + 0.4]) {
      A.addOnce('stone_pale', tubeY(0.22, s.h, { radial: 10 }), LL(IDENT, cx, 0.24, cz), { masks: [0.6, 0.4, 0.2] });
      A.box('concrete', cx, 0.24 + s.h / 2, cz, 0.44, s.h, 0.44);
    }
  }
  for (const cx of [x - w / 2 + 0.5, x + w / 2 - 0.5]) {
    A.addOnce('stone_pale', tubeY(0.22, s.h, { radial: 10 }), LL(IDENT, cx, 0.24, z + d / 2 - 1.6), { masks: [0.6, 0.4, 0.2] });
    A.box('concrete', cx, 0.24 + s.h / 2, z + d / 2 - 1.6, 0.44, s.h, 0.44);
  }
  A.add('stone_pale', BOX(A), LL(IDENT, x, s.h + 0.34, z, 0, w + 0.5, 0.24, d + 0.5), { masks: [0.68, 0.35, 0.15] });
  A.box('concrete', x, s.h + 0.34, z, w + 0.5, 0.24, d + 0.5);
  gableRoof(A, 'roof_slate', x, z, s.h + 0.46, w, d, 1, { overhang: 0.3, endOverhang: 0.3 });
  A.put('bench', x - 2.4, 0.26, z + 1.7, Math.PI, 1);
  A.put('bench', x + 2.4, 0.26, z + 1.7, Math.PI, 1);
  A.put('table_small', x, 0.26, z + 0.2, 0.3, 1);
  A.interiorLights.push({ x, y: s.h - 0.3, z });
}

/** The tennis court: acrylic over an oxide apron, and a net you round. */
function buildTennis(A, rng) {
  const T = TENNIS;
  const cx = (T.x0 + T.x1) / 2;
  const cz = (T.z0 + T.z1) / 2;
  const w = T.x1 - T.x0;
  const d = T.z1 - T.z0;
  A.add('court_clay', BOX(A), LL(IDENT, cx, 0.03, cz, 0, w, 0.06, d), { masks: [0.4, 0.5, 0.35] });
  A.box('concrete', cx, 0.03, cz, w, 0.06, d);
  A.add('court_green', BOX(A), LL(IDENT, cx, 0.07, cz, 0, w - T.inset * 2, 0.05, d - T.inset * 2), {
    masks: [0.4, 0.5, 0.3],
  });
  // white lines: the doubles box, the service lines, the centre line
  const line = (lx, lz, lw, ld) =>
    A.add('plaster_white', BOX_THIN(A), LL(IDENT, lx, 0.1, lz, 0, lw, 0.012, ld), { masks: [0.7, 0.2, 0] });
  const ix = T.inset + 1.1;
  const iz = T.inset + 1.4;
  line(T.x0 + ix, cz, 0.06, d - iz * 2);
  line(T.x1 - ix, cz, 0.06, d - iz * 2);
  line(cx, T.z0 + iz, w - ix * 2, 0.06);
  line(cx, T.z1 - iz, w - ix * 2, 0.06);
  line(cx, cz, 0.05, d - iz * 2);
  line(cx, T.netZ - 3.6, w - ix * 2, 0.05);
  line(cx, T.netZ + 3.6, w - ix * 2, 0.05);
  // the net: posts, a dark mesh slab, white tape — solid to the controller
  for (const nx of [T.x0 + 0.7, T.x1 - 0.7]) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, nx, 0.6, T.netZ, 0, 0.09, 1.1, 0.09), { masks: [0.8, 0.4, 0.1] });
  }
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, cx, 0.55, T.netZ, 0, w - 1.5, 0.9, 0.05), { masks: [0.7, 0.5, 0.2] });
  A.add('plaster_white', BOX_THIN(A), LL(IDENT, cx, 1, T.netZ, 0, w - 1.4, 0.07, 0.06), { masks: [0.75, 0.2, 0] });
  A.box('fabric', cx, 0.52, T.netZ, w - 1.4, 1.04, 0.1);
  A.put('bench', -12, 0.02, 15.6, -H, 1);
  A.put('bench', -12, 0.02, 18.4, -H, 1);
}

/** The walled kitchen garden: beds at crouch height and a potting shed. */
function buildGarden(A, rng) {
  const G = GARDEN;
  for (const [cx, cz, ry, len] of GARDEN_WALLS) {
    ewall(A, 'brick_red', cx, cz, ry, len, 0, G.h, G.t, [], { masks: [0.5, 0.5, 0.3] });
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, G.h + 0.06, cz, ry, len + 0.05, 0.12, G.t + 0.16), {
      masks: [0.75, 0.3, 0.12],
    });
  }
  // gravel underfoot between the beds
  const path = new THREE.PlaneGeometry(G.x1 - G.x0 - 1, G.z1 - G.z0 - 1, 4, 4);
  path.rotateX(-Math.PI / 2);
  paintMasks(path, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.22;
    out[1] = 0.28;
  });
  A.addOnce('road_dust', path, LL(IDENT, (G.x0 + G.x1) / 2, 0.045, (G.z0 + G.z1) / 2));
  // the beds: a stone kerb round dark soil, planted in rows
  for (const [x, z, w, d] of BEDS) {
    A.add('stone_pale', BOX(A), LL(IDENT, x, 0.27, z, 0, w, 0.54, d), { masks: [0.55, 0.5, 0.35] });
    A.box('concrete', x, 0.27, z, w, 0.54, d);
    A.add('dirt', BOX_THIN(A), LL(IDENT, x, 0.55, z, 0, w - 0.24, 0.06, d - 0.24), { masks: [0.2, 0.6, 0.4] });
    // three rows a bed: two leaves a 5 m box of soil looking half planted
    for (let i = 0; i < 3; i++) {
      A.put('crop_row', x - w / 3 + (i * w) / 3 + rng.range(-0.3, 0.3), 0.56, z + rng.range(-0.35, 0.35), 0, rng.range(0.85, 1.15));
    }
  }
  // the potting shed in the corner: a flat-roofed box with one door and one
  // window, and no pitch — it is a garden building, not a cottage
  const s = STRUCTURES[3];
  const t = 0.26;
  ewall(A, 'plaster_white', s.x, s.z - s.d / 2, 0, s.w, 0, s.h, t, [{ u: -1.5, w: 1.3, y: 0.9, h: 1.1 }], { masks: [0.45, 0.45, 0.3] });
  ewall(A, 'plaster_white', s.x, s.z + s.d / 2, 0, s.w, 0, s.h, t, [{ u: 1.6, w: 1.4, y: 0, h: 2.2 }], { masks: [0.45, 0.45, 0.3] });
  ewall(A, 'plaster_white', s.x - s.w / 2, s.z, H, s.d, 0, s.h, t, [{ u: 0, w: 1.5, y: 0.9, h: 1.1 }], { masks: [0.45, 0.45, 0.3] });
  ewall(A, 'plaster_white', s.x + s.w / 2, s.z, H, s.d, 0, s.h, t, [], { masks: [0.45, 0.45, 0.3] });
  dressOpening(A, s.x, s.z + s.d / 2, 0, 0, { u: 1.6, w: 1.4, y: 0, h: 2.2 }, { t });
  dressOpening(A, s.x - s.w / 2, s.z, H, 0, { u: 0, w: 1.5, y: 0.9, h: 1.1 }, { glass: true, flip: true, t });
  dressOpening(A, s.x, s.z - s.d / 2, 0, 0, { u: -1.5, w: 1.3, y: 0.9, h: 1.1 }, { glass: true, flip: true, t });
  deck(A, 'floor_concrete', s.x, 0.1, s.z, s.w - t, s.d - t, { t: 0.14 });
  deck(A, 'roof_screed', s.x, s.h + 0.14, s.z, s.w + 0.5, s.d + 0.5, { t: 0.2, masks: [0.6, 0.35, 0.2] });
  A.put('table', s.x - 1.2, 0.1, s.z, H, 1);
  A.put('planter', s.x + 1.6, 0.1, s.z - 1.2, 0.6, 1);
  A.put('bucket', s.x + 1.9, 0.1, s.z + 1.1, 1.4, 1);
  A.put('crate_b', s.x - 2, 0.1, s.z + 1.4, 0.3, 1);
  A.interiorLights.push({ x: s.x, y: s.h - 0.4, z: s.z });

  // urns on the garden's two gate piers
  A.put('urn', 18.6, 0.02, -19.4, 0.4, 1);
  A.put('urn', 21.4, 0.02, -19.4, 2.2, 1);
  A.put('urn', 12.9, 0.02, -27.6, 1.2, 1);
}

/** The carriage house on the forecourt: two open bays and a workshop. */
function buildCarriage(A, rng) {
  const s = STRUCTURES[2];
  const t = 0.3;
  const { x, z, w, d } = s;
  const sides = [
    [x, z - d / 2, 0, w], // n
    [x + w / 2, z, H, d], // e — the bays, onto the forecourt
    [x, z + d / 2, 0, w], // s
    [x - w / 2, z, H, d], // w
  ];
  const holes = [
    [{ u: -3, w: 1.4, y: 1, h: 1.3 }, { u: 3, w: 1.4, y: 1, h: 1.3 }],
    [{ u: -1.8, w: 2.4, y: 0, h: 2.6 }, { u: 1.8, w: 2.4, y: 0, h: 2.6 }],
    [{ u: 3.2, w: 1.4, y: 0, h: 2.3 }, { u: -2.6, w: 1.5, y: 1, h: 1.3 }],
    [],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    ewall(A, 'brick_red', cx, cz, ry, len, 0, s.h, t, holes[i], { masks: [0.5, 0.45, 0.28] });
    for (const o of holes[i]) if ((o.y ?? 0) > 0) dressOpening(A, cx, cz, ry, 0, o, { glass: true, flip: i === 0, t });
  }
  // the two bay heads, and the timber lintel over them
  A.add('wood_dark', BOX(A), LL(IDENT, x + w / 2, 2.75, z, H, d - 0.4, 0.3, t + 0.14), { masks: [0.6, 0.4, 0.2] });
  deck(A, 'floor_concrete', x, 0.08, z, w - t, d - t, { t: 0.14 });
  gableRoof(A, 'roof_slate', x, z, s.h, w, d, 1.5, { endOverhang: 0.4 });
  gableEnd(A, 'brick_red', x - w / 2 + t / 2, z, s.h, d - 0.1, 1.4, t);
  gableEnd(A, 'brick_red', x + w / 2 - t / 2, z, s.h, d - 0.1, 1.4, t);
  A.put('table', x - 3, 0.08, z, H, 1);
  A.put('crate_a', x - 3.4, 0.08, z + 2.4, 0.4, 1);
  A.put('crate_c', x - 2.4, 0.08, z + 2.6, 1.2, 1);
  A.put('barrel_wood', x - 1.2, 0.08, z - 2.4, 0.9, 1);
  A.put('pallet', x + 1.4, 0.08, z - 2.6, 0.2, 1);
  A.put('tyre', x + 2.6, 0.08, z + 2.5, 1.1, 1);
  A.interiorLights.push({ x, y: s.h - 0.5, z });
}

/** Spruce rows, specimen trees and the orchard: the estate's real screening. */
function plantEstate(A, rng) {
  for (const [x, z, ry, len] of CONIFER_ROWS) {
    const n = Math.max(1, Math.round(len / 2.6));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * (len / n);
      alongWall(x, z, ry, u, _wp);
      const off = (i % 2 === 0 ? 1 : -1) * rng.range(0.1, 0.35);
      A.put(
        'conifer',
        _wp[0] + Math.sin(ry) * off,
        -0.05,
        _wp[1] + Math.cos(ry) * off,
        rng.float() * 6.28,
        rng.range(0.85, 1.15)
      );
    }
    A.box('foliage', x, 2.2, z, ry === 0 ? len : CONIFER.r * 1.5, 4.4, ry === 0 ? CONIFER.r * 1.5 : len, 0);
  }
  for (const [x, z, s] of TREES) {
    tree(A, x, z, s, (x * 7.3 + z * 3.1) % 6.28);
    A.box('wood', x, 1.5 * s, z, 0.6 * s, 3 * s, 0.6 * s);
  }
  // the orchard behind the loggia: small, planted on a grid, and solid
  for (const [x, z] of ORCHARD) {
    tree(A, x, z, 0.62, (x * 5.1 + z * 2.7) % 6.28);
    A.box('wood', x, 1, z, 0.42, 2, 0.42);
  }
}

/** Set dressing: garden furniture, lamps, and the stuff at ankle level. */
function dressEstate(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.4, scale: 0.06 };
  const free = (x, z, m = 0.8) =>
    !inSolidFishers(x, z, m) && Math.abs(x) < FISHER.halfX - 1.6 && Math.abs(z) < FISHER.halfZ - 1.6;

  // topiary pairs at the doors that matter
  for (const [x0, z0, x1, z1, y] of [
    [-13.4, -26.4, -13.4, -22.6, 0.02], // the entrance front, flanking the porch
    [-2.6, -17.6, 2.6, -17.6, TERRACE.h], // the garden front, on the apron
    [5.5, 21.2, 11.5, 21.2, 0.02], // the loggia
  ]) {
    for (const [tx, tz] of [[x0, z0], [x1, z1]]) {
      A.put('topiary_core', tx, y, tz, rng.float() * 3, 1);
      A.put('topiary_leaf', tx, y, tz, rng.float() * 3, 1);
    }
  }
  // urns down the drive and on the terrace corners
  for (const [x, z] of [[-24.5, -18.6], [-24.5, -23.4], [-8.4, 19.6], [8.4, 19.6]]) {
    if (free(x, z, 0.4)) A.put('urn', x, 0.02, z, rng.float() * 3, 1);
  }
  for (const [x, z, ry] of [[-16, -0.5, 0.3], [23, 10, -H + 0.4], [-4, -33, 0.2]]) {
    if (free(x, z, 0.6)) A.put('bench', x, 0.02, z, ry, 1);
  }
  // estate lamps: the map's street lights
  for (const [x, z, ry] of [
    [-11.6, -21, 0.5],
    [-24.2, -21, -2.6],
    [-11.2, -15, 0.2],
    [11.2, -15, -0.2],
    [13.5, -17.2, -1.4],
    [2.5, 22, -1.9],
  ]) {
    A.put('lamp_post', x, 0.02, z, ry, 0.85);
    A.put('lamp_glass', x, 0.02, z, ry, 0.85);
    A.box('metal', x, 1.1, z, 0.3, 2.2, 0.3);
    A.lampAnchors.push({ x: x + Math.cos(ry) * 0.74, y: 4.55, z: z - Math.sin(ry) * 0.74 });
  }
  // foundation planting along the house's two public fronts
  for (const [x, z] of [[-8.4, -14.8], [8.4, -14.8], [-12.4, -28.4], [-12.4, -20.6], [3.4, -30.6], [-3.4, -30.6]]) {
    if (free(x, z, 0.4)) A.put('shrub', x, 0.02, z, rng.float() * 6.28, rng.range(0.8, 1.2));
  }

  // inside the house: what a place this size leaves downstairs
  const F = HOUSE.floor;
  A.put('table', -6.6, F, -24.5, 0.05, 1);
  A.put('chair', -7.6, F, -23.8, 1.7, 1);
  A.put('chair', -5.6, F, -25.2, -1.3, 1);
  A.put('cabinet', -9.6, F, -28.4, 0, 1);
  A.put('shelf', -10, F, -21.6, H, 1);
  A.put('table_small', 0.6, F, -21.2, 0.4, 1);
  A.put('cabinet', 8.4, F, -28.6, 0, 1);
  A.put('table', 7.4, F, -22.6, H, 1);
  A.put('chair', 6.4, F, -23.4, 0.5, 1);
  A.put('crate_b', 9.6, F, -20.4, 0.7, 1);
  // upstairs: two beds, a wardrobe, the landing table
  A.put('mattress', -7.8, HOUSE.deck + 0.02, -27.4, H, 1);
  A.put('cabinet', -9.6, HOUSE.deck + 0.02, -21.4, H, 1);
  A.put('mattress', 8, HOUSE.deck + 0.02, -21.6, H + 0.1, 1);
  A.put('shelf', 9.6, HOUSE.deck + 0.02, -27.4, H, 1);
  A.put('table_small', 0.4, HOUSE.deck + 0.02, -20.6, -0.3, 1);

  // weeds where the mower doesn't reach: the boundary, the court, the lane
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 60; i++) {
    const side = i % 4;
    const along = rng.range(-0.9, 0.9);
    const inset = rng.range(1.4, 3);
    const x = side === 0 || side === 2 ? along * FISHER.halfX : side === 1 ? FISHER.halfX - inset : -FISHER.halfX + inset;
    const z = side === 0 ? -FISHER.halfZ + inset : side === 2 ? FISHER.halfZ - inset : along * FISHER.halfZ;
    if (!free(x, z, 0.4)) continue;
    A.put('weeds', x, 0.02, z, rng.float() * 6.28, rng.range(0.6, 1.2));
  }
  for (let i = 0; i < 14; i++) {
    const x = -19 + rng.range(-7, 7);
    const z = 15 + rng.range(-11, 11);
    if (!free(x, z, 0.5)) continue;
    A.put('weeds', x, 0.02, z, rng.float() * 6.28, rng.range(0.7, 1.3));
  }
  A.jitter = null;
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map's `build`.
 */
export function buildFishers(A, rng) {
  registerProps(A, rng);
  registerWilmotProps(A, rng);
  registerFisherProps(A, rng);

  buildGrounds(A, rng);
  buildHouse(A, rng);
  buildTerrace(A, rng);
  buildPoolHouse(A, rng);
  buildLoggia(A, rng);
  buildTennis(A, rng);
  buildGarden(A, rng);
  buildCarriage(A, rng);
  plantEstate(A, rng);
  dressEstate(A, rng);

  return { buildings: STRUCTURES.map((s) => ({ spec: s, id: s.id })) };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const FISHERS_MAP = {
  id: 'fishers',
  name: "The Fisher's",
  subtitle: 'North Shore estate, down the pool axis',
  blurb:
    'One long axis from the house to the loggia: a lap pool between raised stone terraces, a pool house roof looking down on it, and a walled kitchen garden and a screened court either side.',
  size: '56 × 70 m',
  /**
   * LEVEL -> WORLD. Off-axis for the same reason Rust, Wilmot and the Loop
   * are: every mass here is a rectangle, and rectangles lit square-on lose one
   * of their two lit faces. Turned the other way from Wilmot's so the two
   * estates do not sit under the same sun.
   */
  transform: { yaw: -0.44, tx: 0, tz: 0 },
  /** Tight to the treeline plus a skirt for the nav grid; the perimeter is sealed. */
  bounds: [-34, -3.5, -41, 34, 24, 41],
  spawnPoints: FISHERS_SPAWNS,
  standable: standableAtFishers,
  groundY: groundYFishers,
  isOpen: isOpenFishers,
  build: buildFishers,
};
