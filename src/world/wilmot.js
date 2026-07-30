import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, PANE, IDENT, LL, stairRun } from './kit.js';
import { registerProps } from './props.js';
import { registerWilmotProps, HEDGE } from './wilmotprops.js';
import { fbm3, paintMasks, patchGeometry, polyPrism, tubeY } from './util.js';

/**
 * WORLD — WILMOT.
 *
 * A low-poly take on 1900 Wilmot Road, Bannockburn, Illinois: a 1935
 * English-revival manor in limewashed brick under a heavy brown tile roof, on
 * seven landscaped acres, compressed to a
 * ~62 x 58 m walled garden the way Rust compresses a refinery. The real
 * estate's roster is the map's roster — the listing's swimming pool, sunken
 * garden, tennis court, restored barn and Lord & Burnham greenhouse are the
 * five satellites around the house. Everything is generated here; nothing is
 * loaded from disk.
 *
 *   THE MANOR      centre-north. Two enterable storeys, a real staircase, and
 *                  a door from the first floor onto the library wing's flat
 *                  roof — the map's "office roof". Its long south face of
 *                  windows owns the lawn the way Rust's derrick owns the yard.
 *   THE LAWN       centre-south: the pool terrace and its loungers, wide open
 *                  ground, and the boot spawn looking up all of it.
 *   FOUR CORNERS   a hay-loft barn (SW, with a loft window on the lawn), the
 *                  glass greenhouse (NE), the hedge-screened tennis court (SE)
 *                  and the fountain forecourt off the drive (NW).
 *   THE TRENCH     the sunken garden, west: 1.3 m below the lawn between two
 *                  hedge walls — the one north-south lane the manor's windows
 *                  cannot see into.
 *
 * LOW POLY IS THE BRIEF, same as Rust: chunky massing, chamfered boxes and
 * capped tubes, with all surface detail carried by the shared procedural
 * materials. Foliage is an opaque dark core plus an alpha-cut leaf shell
 * (see wilmotprops.js), so hedges read clipped, not extruded.
 *
 * THE FINISH. The house is WHITE — limewashed brick, not the red brick this
 * map was first built in. `brick_lime` keeps the brick bake and softens its
 * joints, so the coursing still reads under the wash and the worn arrises go
 * pink where the coat has gone. Bare `brick_red` survives in three places,
 * all deliberate: the chimney stacks above the roofline, which no painter
 * reaches; the greenhouse plinth, which is a garden structure rather than
 * part of the house; and the living-room fireplace breast, because an
 * inglenook is bare brick indoors. Terrace and garden paths are
 * `flagstone` (cold bluestone); `stone_pale` is now cut stone only — copings,
 * sills, balustrades and steps.
 *
 * LAYOUT NOTES
 *   Authored in LEVEL space, north at -Z, the manor's front door facing the
 *   north wall. The vertical routes are stairs only, as everywhere else in
 *   the game: an internal stair to the manor's first floor, a door onto the
 *   wing roof, and a barn stair to the hay loft. The pool is wadeable — its
 *   floor collider sits 0.5 m under the coping and shallow-end steps walk
 *   back out, so falling in is a detour, never a trap.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const WILMOT = {
  /** Half-extents of the walled garden. The wall line sits on these. */
  halfX: 31,
  halfZ: 29,
  wallH: 2.7,
  y: 0,
};

/**
 * The five buildings. Same shape as the market's `BUILDINGS` entries so
 * `ui/minimap` can draw them. `h` is the eaves line of the mass.
 */
export const STRUCTURES = [
  { id: 'manor', x: 0, z: -13.15, w: 21, d: 10.5, floors: 2, h: 6.3 },
  { id: 'library', x: -14.6, z: -13.2, w: 8.2, d: 8, floors: 1, h: 3.42 },
  { id: 'garage', x: 14.4, z: -14.4, w: 7.8, d: 7, floors: 1, h: 3.1 },
  { id: 'barn', x: -22, z: 15, w: 9, d: 7.5, floors: 2, h: 4.4 },
  { id: 'greenhouse', x: 25.5, z: -13.5, w: 5.5, d: 11, floors: 1, h: 2.3 },
];

/** The manor's storey heights, shared by walls, floors and the wing door. */
const MANOR = { g: 3.1, top: 6.3, floor: 0.12, deck: 3.1, rise: 2.6 };

/** The stone terrace between the manor's south face and the lawn. */
export const TERRACE = { x0: -8, z0: -7.9, x1: 8, z1: -4.4, h: 0.42 };

/** The pool: coping outline and the wading depth. Water sits at `waterY`. */
export const POOL = { x0: 0, z0: 1, x1: 9, z1: 6, waterY: -0.38, walkY: -0.62 };

/** The tennis court slab and its net line. */
export const TENNIS = { x0: 11, z0: 12, x1: 28, z1: 21, netX: 19.5 };

/** The sunken garden: full-depth core rectangle, feathered over `lip` m. */
export const BOWL = { x0: -23.8, z0: -5, x1: -18.2, z1: 7, depth: 1.3, lip: 2.8 };

export const FOUNTAIN = { x: 0, z: -23.5, r: 2.3 };

/** Wall openings: `[x-or-z centre, side, width]`; both are gated shut. */
export const GATES = [
  { u: -16, side: 'n', w: 4.0 }, // the drive's wrought-iron gates
  { u: 24, side: 's', w: 3.0 }, // the service gate by the tennis court
];

/**
 * Hedge runs: `[x, z, ry, len, h]`. Axis-aligned only (`ry` 0 or π/2) — the
 * occupancy test below reads them as rects, and clipped hedges ARE axis
 * aligned; that is what clipped means.
 */
const H = Math.PI / 2;
export const HEDGES = [
  // the sunken garden's rim walls — the trench read
  [-15.0, 1, H, 12.5, 1.8],
  [-27.0, 1, H, 12.5, 1.8],
  // parterre rows down inside the bowl, low enough to shoot over
  [-21, -2.2, 0, 4.4, 0.55],
  [-21, 4.2, 0, 4.4, 0.55],
  // tennis screens, with walk-in gaps
  [14.25, 10.2, 0, 6.5, 2.0],
  [24.5, 10.2, 0, 9.0, 2.0],
  [9.8, 11.5, H, 3.0, 2.0],
  [9.8, 19.0, H, 8.0, 2.0],
  // the screened lane between the garage and the greenhouse
  [20.8, -13.5, H, 6.0, 1.35],
  // mid-lawn dividers that cut the two longest sightlines
  [2, 12.5, 0, 9.0, 1.35],
  [-9, -1, H, 8.0, 1.35],
];

/** Specimen trees inside the walls: `[x, z, scale]`. Trunks are solid. */
export const TREES = [
  [-8, 8.5, 1.05],
  [12.5, 7.2, 0.95],
  [-12.5, 20.5, 1.1],
  [7.8, 20.5, 1.0],
  [27.5, -7.5, 0.9],
  [25.5, 7, 1.15],
  [-9.5, -21.5, 0.95],
  [-27.5, -23.5, 1.2],
  [13.2, -3.5, 0.85],
  [-27, 11, 0.95],
];

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the manor, so everyone comes in reading the landmark.
 *
 * INDEX 0 is the boot/dev spawn: the south lawn, looking up past the pool
 * terrace at the whole south front of the house.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - 0, z - -13) + turn;
export const WILMOT_SPAWNS = [
  [2, 23, 0, 'south-lawn'], // FROZEN — boot spawn
  [-5.5, 24.5, 0.2, 'south-lawn'],
  [8, 25, -0.2, 'south-lawn'],
  [-1, 19.5, 0.1, 'south-lawn'],

  [-6.5, -24.5, 0.3, 'forecourt'],
  [6, -22.5, -0.3, 'forecourt'],
  [-3.4, -20.0, 0.1, 'forecourt'],
  [7.5, -25.8, -0.4, 'forecourt'],

  [-14, -26.2, 0.4, 'drive'],
  [-19.5, -24.8, 0.5, 'drive'],
  [-11, -27.2, 0.3, 'drive'],
  [-21.5, -27, 0.5, 'drive'],

  [13.8, -19.5, -0.3, 'greenhouse'],
  [20.5, -21.5, -0.3, 'greenhouse'],
  [28.9, -21.8, -0.5, 'greenhouse'],
  [25.3, -5.6, -0.3, 'greenhouse'],
  [20.4, -9.6, 0, 'greenhouse'],

  [28.5, 1.5, -0.4, 'east-lawn'],
  [23, 2.5, -0.2, 'east-lawn'],
  [28, -3.5, -0.5, 'east-lawn'],
  [24, -2, 0, 'east-lawn'],

  [13, 23.5, -0.2, 'tennis'],
  [26, 23.8, -0.4, 'tennis'],
  [28.5, 14, -0.5, 'tennis'],
  [12.2, 14.8, 0, 'tennis'],

  [-15.5, 20.5, 0.3, 'barn'],
  [-26.5, 21.5, 0.4, 'barn'],
  [-14.8, 12.5, 0.2, 'barn'],
  [-28.6, 8.6, 0.5, 'barn'],

  [-22.6, -3.9, 0.2, 'sunken-garden'],
  [-19.4, 0.9, 0, 'sunken-garden'],
  [-22.6, 5.9, 0.3, 'sunken-garden'],

  [-13, -6.5, 0.2, 'west-lawn'],
  [-28.5, -8, 0.5, 'west-lawn'],
  [-12.5, -2, 0, 'west-lawn'],
  [-27.5, -12.5, 0.5, 'west-lawn'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  out.push([TERRACE.x0, TERRACE.z0, TERRACE.x1, TERRACE.z1]);
  // the pool plus its coping: no spawns treading water
  out.push([POOL.x0 - 0.6, POOL.z0 - 0.6, POOL.x1 + 0.6, POOL.z1 + 0.6]);
  out.push([FOUNTAIN.x - 2.5, FOUNTAIN.z - 2.5, FOUNTAIN.x + 2.5, FOUNTAIN.z + 2.5]);
  for (const [x, z, ry, len, h] of HEDGES) {
    const hx = (ry === 0 ? len : HEDGE.w) / 2 + 0.05;
    const hz = (ry === 0 ? HEDGE.w : len) / 2 + 0.05;
    out.push([x - hx, z - hz, x + hx, z + hz]);
  }
  for (const [x, z, s] of TREES) out.push([x - 0.45 * s, z - 0.45 * s, x + 0.45 * s, z + 0.45 * s]);
  // the tennis net and the sundial in the bowl
  out.push([TENNIS.netX - 0.2, TENNIS.z0 + 0.3, TENNIS.netX + 0.2, TENNIS.z1 - 0.3]);
  out.push([-21.5, 0.5, -20.5, 1.5]);
  // the closed gates
  out.push([-18.1, -WILMOT.halfZ - 0.4, -13.9, -WILMOT.halfZ + 0.5]);
  out.push([22.4, WILMOT.halfZ - 0.5, 25.6, WILMOT.halfZ + 0.4]);
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the grounds. */
export function inSolidWilmot(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/** Can a character stand here? Inside the walls and off every footprint. */
export function standableAtWilmot(x, z, margin = 0.55) {
  if (Math.abs(x) > WILMOT.halfX - 0.85 - margin) return false;
  if (Math.abs(z) > WILMOT.halfZ - 0.85 - margin) return false;
  return !inSolidWilmot(x, z, margin);
}

/** True where a character can stand outdoors — the minimap's floor. */
export function isOpenWilmot(x, z, m = 0.3) {
  if (Math.abs(x) > WILMOT.halfX - 0.6 || Math.abs(z) > WILMOT.halfZ - 0.6) return false;
  return !inSolidWilmot(x, z, m);
}

/** 0..1 mask of the sunken garden's recess, feathered over `lip` metres. */
function bowlMask(x, z) {
  const cx = (BOWL.x0 + BOWL.x1) / 2;
  const cz = (BOWL.z0 + BOWL.z1) / 2;
  const dx = Math.max(0, Math.abs(x - cx) - (BOWL.x1 - BOWL.x0) / 2);
  const dz = Math.max(0, Math.abs(z - cz) - (BOWL.z1 - BOWL.z0) / 2);
  const d = Math.hypot(dx, dz);
  if (d >= BOWL.lip) return 0;
  const s = 1 - d / BOWL.lip;
  return s * s * (3 - 2 * s);
}

/**
 * The pool's dig, entirely hidden by the built shell: full depth just inside
 * the coping line, back to lawn level AT it, so the lawn outside stays flat.
 */
function poolMask(x, z) {
  const cx = (POOL.x0 + POOL.x1) / 2;
  const cz = (POOL.z0 + POOL.z1) / 2;
  const dx = Math.max(0, Math.abs(x - cx) - ((POOL.x1 - POOL.x0) / 2 - 0.5));
  const dz = Math.max(0, Math.abs(z - cz) - ((POOL.z1 - POOL.z0) / 2 - 0.5));
  const d = Math.hypot(dx, dz);
  if (d >= 0.5) return 0;
  const s = 1 - d / 0.5;
  return s * s * (3 - 2 * s);
}

/**
 * Analytic floor height. A mown lawn with a just-perceptible roll inside the
 * walls, the sunken garden and the pool basin dug out of it; outside, the
 * parkland rolls away and climbs into the treeline berm that keeps the
 * horizon from being a flat band of sky — same trick as Rust's ridge, for the
 * same reason, at country-club scale.
 */
export function groundYWilmot(x, z) {
  const out = Math.max(Math.abs(x) - WILMOT.halfX, Math.abs(z) - WILMOT.halfZ);
  if (out > 0) {
    const t = Math.min(1, out / 10);
    const roll = (fbm3(x * 0.045, 7.3, z * 0.045, 3) - 0.5) * 1.6 * t;
    const berm = Math.min(1, Math.max(0, (out - 5) / 18));
    return 0.02 + roll + berm * berm * (2.6 + fbm3(x * 0.03, 3.1, z * 0.03, 2) * 3.4);
  }
  let y = 0.02 + (fbm3(x * 0.11, 5.1, z * 0.11, 2) - 0.5) * 0.05;
  y -= BOWL.depth * bowlMask(x, z);
  y -= 1.6 * poolMask(x, z);
  return y;
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
 * One storey of wall with real openings punched through it — the same solid
 * spans/sill/lintel scheme Rust uses, so a doorway is a genuine hole in the
 * collision hull. `holes` are `[{ u, w, y, h }]` in wall-local coordinates.
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
  const t = opts.t ?? 0.32;
  const oy = o.y ?? 0;
  if (oy > 0.02) {
    A.add('frame_white', BOX(A), LL(IDENT, _wp[0], y0 + oy - 0.04, _wp[1], ry, o.w + 0.22, 0.08, t + 0.14), {
      masks: [0.7, 0.3, 0.1],
    });
  }
  A.add('frame_white', BOX(A), LL(IDENT, _wp[0], y0 + oy + o.h + 0.05, _wp[1], ry, o.w + 0.22, 0.1, t + 0.1), {
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
function flightLength(from, to, rise = 0.27, run = 0.3) {
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
  const rise = opts.rise ?? 0.27;
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

/**
 * A stone balustrade from (x0,z0) to (x1,z1) at floor height `y`: plinth,
 * turned balusters, one coping rail — and ONE collision slab, so the
 * character controller meets a wall, not a comb.
 */
function balRun(A, x0, z0, x1, z1, y, h = 0.62) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.2) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  A.add('stone_pale', BOX(A), LL(IDENT, mx, y + 0.05, mz, ry, len, 0.1, 0.24), { masks: [0.6, 0.4, 0.2] });
  A.add('stone_pale', BOX(A), LL(IDENT, mx, y + h, mz, ry, len, 0.1, 0.2), { masks: [0.75, 0.3, 0.1] });
  const n = Math.max(2, Math.round(len / 0.44));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, x0 + (x1 - x0) * t, y + h / 2, z0 + (z1 - z0) * t, ry, 0.09, h, 0.09), {
      masks: [0.65, 0.4, 0.2],
    });
  }
  A.box('concrete', mx, y + h / 2, mz, len, h + 0.12, 0.22, ry);
}

/** A structural member between two points — greenhouse framing, roof rafters. */
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
  const m = new THREE.Matrix4().compose(_pos, _quat, _scl);
  A.add(key, BOX_THIN(A), m, { masks: masks ?? [0.7, 0.35, 0.15] });
}

/**
 * A pitched roof with its ridge along X: two tile slabs, a ridge cap, and
 * sloped collision so grenades roll off it instead of through it. Returns the
 * pitch for anyone hanging rafters under it.
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

/** A brick gable triangle standing in the YZ plane at `x`, ridge along X. */
function gableEnd(A, key, x, cz, y, d, rise, t) {
  const g = polyPrism(
    [[-d / 2, 0], [d / 2, 0], [0, rise]],
    t
  );
  g.rotateX(Math.PI / 2);
  A.addOnce(key, g, LL(IDENT, x, y, cz, Math.PI / 2), { masks: [0.5, 0.45, 0.25] });
  A.box('concrete', x + t / 2, y + rise * 0.35, cz, t, rise * 0.7, d * 0.55);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGrounds(A, rng) {
  // ------------------------------------------------------------- the lawn --
  // One plane carries the whole estate and the parkland beyond the wall. It
  // is sampled finer than Rust's desert because the sunken garden and the
  // pool dig live in the height field, not in extra geometry.
  const S = 168;
  const N = 96;
  const terrain = new THREE.PlaneGeometry(S, S, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const z = pa.getZ(i);
    pa.setY(i, groundYWilmot(x, z) - 0.04);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    // mowing bands: long alternating stripes read at distance, thatch up close
    const bands = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.sin(z * 0.22) * 1.7);
    out[1] = 0.14 + bands * 0.16 + fbm3(x * 0.5, 8.8, z * 0.5, 2) * 0.22;
    out[0] = 0.12;
  });
  A.add('lawn', terrain, null);
  A.collideGeo('dirt', terrain);
  terrain.dispose();

  // ------------------------------------------------- drive, paths, aprons --
  const strip = (cx, cz, ry, len, w, key = 'road_dust') => {
    const g = new THREE.PlaneGeometry(len, w, Math.max(2, Math.round(len / 3)), 1);
    g.rotateX(-Math.PI / 2);
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      out[0] = 0.2 + fbm3(x * 0.7, 3.3, z * 0.7, 2) * 0.3;
      out[1] = 0.2;
    });
    A.addOnce(key, g, LL(IDENT, cx, 0.045, cz, ry));
  };
  // gravel: the gate run, the diagonal to the forecourt, the garage apron
  strip(-16, -26.4, H, 5.4, 3.4);
  strip(-11, -24.1, -0.1, 10.5, 3.4);
  strip(11.2, -20.8, -0.18, 12.5, 2.6);
  strip(14.4, -19.4, 0, 7.4, 3.0);
  const court = patchGeometry(rng, 6.6, { lobes: 15, wobble: 0.1 });
  paintMasks(court, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.25;
    out[1] = 0.25;
  });
  A.addOnce('road_dust', court, LL(IDENT, 0, 0.04, -23.4, 0.3));
  const barnApron = patchGeometry(rng, 2.6, { lobes: 11, wobble: 0.2 });
  A.addOnce('road_dust', barnApron, LL(IDENT, -15.6, 0.045, 15, 1.1), { masks: [0.2, 0.3, 0.2] });
  // flagstone links: terrace -> pool, forecourt -> sunken garden
  strip(4, -2.1, H, 2.9, 1.4, 'flagstone');
  strip(-13.6, -14.4, 0.83, 14.5, 1.4, 'flagstone');

  // ---------------------------------------------------- the estate wall --
  // Brick, stone coping, a pier every sixth bay — and nothing on the map
  // ends in sky at the wall, because the treeline berm rises behind it.
  const wallT = 0.32;
  const hw = WILMOT.wallH;
  for (const side of [0, 1, 2, 3]) {
    const ry = side === 0 || side === 2 ? 0 : H;
    const cx = side === 1 ? WILMOT.halfX : side === 3 ? -WILMOT.halfX : 0;
    const cz = side === 0 ? -WILMOT.halfZ : side === 2 ? WILMOT.halfZ : 0;
    const len = (side === 0 || side === 2 ? WILMOT.halfX : WILMOT.halfZ) * 2;
    // u maps straight onto x on both the north and south wall (ry = 0)
    const holes = [];
    for (const g of GATES) {
      if ((g.side === 'n' && side === 0) || (g.side === 's' && side === 2)) {
        holes.push({ u: g.u, w: g.w, y: 0, h: hw });
      }
    }
    ewall(A, 'brick', cx, cz, ry, len, 0, hw, wallT, holes, { masks: [0.55, 0.5, 0.3] });
    // coping and piers
    const n = Math.round(len / 6.2);
    for (let i = 0; i <= n; i++) {
      const u = -len / 2 + (i / n) * len;
      if (holes.some((o) => Math.abs(o.u - u) < o.w / 2 + 0.8)) continue;
      alongWall(cx, cz, ry, u, _wp);
      A.add('brick', BOX(A), LL(IDENT, _wp[0], (hw + 0.35) / 2, _wp[1], ry, 0.56, hw + 0.35, 0.56), {
        masks: [0.6, 0.45, 0.3],
      });
      A.add('stone_pale', BOX_SOFT(A), LL(IDENT, _wp[0], hw + 0.42, _wp[1], ry, 0.68, 0.14, 0.68), {
        masks: [0.8, 0.3, 0.1],
      });
    }
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, hw + 0.06, cz, ry, len, 0.12, wallT + 0.14), {
      masks: [0.75, 0.35, 0.15],
    });
  }

  // ------------------------------------------------------------ the gates --
  for (const g of GATES) {
    const sign = g.side === 'n' ? -1 : 1;
    const gz = sign * WILMOT.halfZ;
    // jamb piers and the arch beam carrying the coping over the opening
    for (const s of [-1, 1]) {
      A.add('brick', BOX(A), LL(IDENT, g.u + s * (g.w / 2 + 0.3), (hw + 0.7) / 2, gz, 0, 0.6, hw + 0.7, 0.6), {
        masks: [0.6, 0.45, 0.3],
      });
      A.box('concrete', g.u + s * (g.w / 2 + 0.3), (hw + 0.7) / 2, gz, 0.6, hw + 0.7, 0.6);
      A.add('stone_pale', BOX_SOFT(A), LL(IDENT, g.u + s * (g.w / 2 + 0.3), hw + 0.78, gz, 0, 0.72, 0.16, 0.72), {
        masks: [0.8, 0.3, 0.1],
      });
    }
    if (g.side === 'n') {
      // wrought iron: rails, a dip in the middle, bars with spear tips
      for (const yy of [0.25, 1.35, 2.15]) {
        A.add('metal_dark', BOX_THIN(A), LL(IDENT, g.u, yy, gz, 0, g.w, 0.07, 0.07), { masks: [0.8, 0.4, 0.1] });
      }
      const bars = Math.round(g.w / 0.28);
      for (let i = 0; i <= bars; i++) {
        const bx = g.u - g.w / 2 + (i / bars) * g.w;
        const bh = 2.3 - Math.cos(((i / bars) * 2 - 1) * 1.2) * 0.18;
        A.add('metal_dark', BOX_THIN(A), LL(IDENT, bx, bh / 2 + 0.06, gz, 0, 0.05, bh, 0.05), {
          masks: [0.85, 0.4, 0.1],
        });
      }
      A.box('metal', g.u, 1.3, gz, g.w, 2.6, 0.16);
    } else {
      // the service gate: painted boards, a Z-brace, shut and staying shut
      A.add('wood_dark', BOX(A), LL(IDENT, g.u, 1.25, gz, 0, g.w - 0.1, 2.5, 0.09), { masks: [0.6, 0.45, 0.25] });
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, g.u, 1.25, gz + sign * 0.08, 0.42, g.w - 0.3, 0.16, 0.05), {
        masks: [0.75, 0.4, 0.15],
      });
      A.box('wood', g.u, 1.3, gz, g.w, 2.6, 0.18);
    }
  }
}

/** The manor, its two wings, the porch and the terrace. */
function buildManor(A, rng) {
  const s = STRUCTURES[0];
  const t = 0.32;
  const { x, z, w, d } = s;
  const g0 = MANOR.floor;
  const sides = [
    [x, z - d / 2, 0, w], // n — the forecourt front
    [x + w / 2, z, H, d], // e — toward the garage wing
    [x, z + d / 2, 0, w], // s — the lawn front
    [x - w / 2, z, H, d], // w — toward the library wing
  ];
  // ground floor: front door north, french doors south, doors into both wings
  const g = [
    [{ u: 0, w: 1.7, y: 0, h: 2.5 }, { u: -7.5, w: 1.8, y: 0.95, h: 1.7 }, { u: -3.8, w: 1.8, y: 0.95, h: 1.7 }, { u: 3.8, w: 1.8, y: 0.95, h: 1.7 }, { u: 7.5, w: 1.8, y: 0.95, h: 1.7 }],
    [{ u: 1.0, w: 1.2, y: 0, h: 2.2 }, { u: -3.0, w: 1.6, y: 0.95, h: 1.5 }],
    // french doors line up with the terrace stairs below, clear of partitions
    [{ u: -4.5, w: 1.7, y: 0, h: 2.4 }, { u: 4.5, w: 1.7, y: 0, h: 2.4 }, { u: -7.9, w: 1.9, y: 0.95, h: 1.7 }, { u: 7.9, w: 1.9, y: 0.95, h: 1.7 }],
    [{ u: 0, w: 1.4, y: 0, h: 2.2 }],
  ];
  // first floor: the south windows are the map's overwatch, and they are big
  const f = [
    [{ u: -6, w: 1.7, y: 0.9, h: 1.6 }, { u: -2, w: 1.7, y: 0.9, h: 1.6 }, { u: 2, w: 1.7, y: 0.9, h: 1.6 }, { u: 6, w: 1.7, y: 0.9, h: 1.6 }],
    [{ u: -3.5, w: 1.5, y: 1.0, h: 1.4 }],
    [{ u: -6, w: 2.7, y: 0.85, h: 1.8 }, { u: 0, w: 3.2, y: 0.85, h: 1.8 }, { u: 6, w: 2.7, y: 0.85, h: 1.8 }],
    [{ u: 0, w: 1.3, y: 0.32, h: 2.1 }], // the door onto the library roof
  ];
  const glassed = new Set([f[0], f[1], f[2]].flat());
  const flips = [true, false, false, true]; // which sides' panes face −Z/−X
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    ewall(A, 'brick_lime', cx, cz, ry, len, 0, MANOR.g, t, g[i], { masks: [0.5, 0.45, 0.28] });
    ewall(A, 'brick_lime', cx, cz, ry, len, MANOR.g, MANOR.top - MANOR.g, t, f[i], { masks: [0.55, 0.42, 0.22] });
    for (const o of g[i]) if ((o.y ?? 0) > 0) dressOpening(A, cx, cz, ry, 0, o, { glass: i !== 2, flip: flips[i] });
    for (const o of f[i]) dressOpening(A, cx, cz, ry, MANOR.g, o, { glass: glassed.has(o), flip: flips[i] });
  }
  // string course between the storeys — the horizontal an English house needs
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, MANOR.g + 0.03, cz, ry, len + 0.1, 0.12, t + 0.12), {
      masks: [0.7, 0.35, 0.15],
    });
  }

  // floors: hardwood over the whole plate, a stairwell cut in the first
  deck(A, 'floor_wood', x, g0, z, w - t, d - t, { t: 0.16, masks: [0.45, 0.4, 0.3] });
  const holeX0 = -2.2;
  const holeX1 = 1.35;
  const holeZ0 = z - d / 2 + t / 2; // against the north wall
  const holeZ1 = -16.6;
  deck(A, 'floor_wood', x, MANOR.deck, (holeZ1 + (z + d / 2)) / 2 - 0.08, w - t, z + d / 2 - t / 2 - holeZ1 - 0.0, { t: 0.26 });
  deck(A, 'floor_wood', (-(w - t) / 2 + holeX0) / 2, MANOR.deck, (holeZ0 + holeZ1) / 2, holeX0 - -((w - t) / 2), holeZ1 - holeZ0, { t: 0.26 });
  deck(A, 'floor_wood', (holeX1 + (w - t) / 2) / 2, MANOR.deck, (holeZ0 + holeZ1) / 2, (w - t) / 2 - holeX1, holeZ1 - holeZ0, { t: 0.26 });

  // The stair up, tight to the north wall. Its foot is measured BACK from the
  // stairwell's east edge so the top step lands exactly on it — a flight that
  // overshoots comes up under the floor slab and stops at head height.
  flight(A, holeX1 - flightLength(g0, MANOR.deck, 0.271, 0.3), g0, -17.35, H, MANOR.deck, 1.3, {
    key: 'wood_dark',
    rise: 0.271,
  });
  const railW = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    A.add('wood_dark', BOX_THIN(A), LL(IDENT, (x0 + x1) / 2, MANOR.deck + 0.92, (z0 + z1) / 2, ry, len, 0.07, 0.07), {
      masks: [0.7, 0.35, 0.1],
    });
    const n = Math.max(2, Math.round(len / 0.5));
    for (let i = 0; i <= n; i++)
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, x0 + ((x1 - x0) * i) / n, MANOR.deck + 0.46, z0 + ((z1 - z0) * i) / n, 0, 0.05, 0.92, 0.05), { masks: [0.7, 0.4, 0.1] });
    A.box('wood', (x0 + x1) / 2, MANOR.deck + 0.5, (z0 + z1) / 2, Math.max(len, 0.1), 1.0, 0.09, ry);
  };
  railW(holeX0, holeZ1, holeX1, holeZ1);
  railW(holeX0, holeZ0 + 0.1, holeX0, holeZ1);

  // ground-floor rooms: living west of the hall, kitchen east of it
  ewall(A, 'plaster_cream', -2.8, z, H, d - t, 0, MANOR.g, 0.2, [{ u: 1.6, w: 1.1, y: 0, h: 2.2 }], { masks: [0.4, 0.45, 0.35] });
  ewall(A, 'plaster_cream', 3.2, z, H, d - t, 0, MANOR.g, 0.2, [{ u: -1.6, w: 1.1, y: 0, h: 2.2 }], { masks: [0.4, 0.45, 0.35] });
  // first floor: two bedrooms off the landing
  ewall(A, 'plaster_cream', -3.5, z, H, d - t, MANOR.deck, MANOR.top - MANOR.deck, 0.2, [{ u: -2.6, w: 1.1, y: 0, h: 2.2 }], { masks: [0.42, 0.45, 0.32] });
  ewall(A, 'plaster_cream', 4.0, z, H, d - t, MANOR.deck, MANOR.top - MANOR.deck, 0.2, [{ u: -2.6, w: 1.1, y: 0, h: 2.2 }], { masks: [0.42, 0.45, 0.32] });

  // the living-room fireplace: breast, dark firebox, timber mantel
  A.add('brick_red', BOX(A), LL(IDENT, -9.9, 1.0, z, 0, 0.5, 2.0, 2.0), { masks: [0.5, 0.5, 0.3] });
  A.box('concrete', -9.9, 1.0, z, 0.5, 2.0, 2.0);
  A.add('window_void', BOX_THIN(A), LL(IDENT, -9.62, 0.55, z, 0, 0.06, 0.85, 1.0));
  A.add('wood_dark', BOX(A), LL(IDENT, -9.58, 1.42, z, 0, 0.24, 0.1, 1.7), { masks: [0.75, 0.3, 0.1] });

  // the roof: tile, limewashed gables, two chimneys — the skyline
  gableRoof(A, 'roof_tile', x, z, MANOR.top, w, d, MANOR.rise);
  gableEnd(A, 'brick_lime', x - w / 2 + t / 2, z, MANOR.top, d - 0.1, MANOR.rise - 0.12, t);
  gableEnd(A, 'brick_lime', x + w / 2 - t - t / 2 + t, z, MANOR.top, d - 0.1, MANOR.rise - 0.12, t);
  /**
   * THE STACKS ARE THE ONE PLACE THE BRICK SHOWS. The limewash stops at the
   * roofline — a painter works off the scaffold, not off the tiles — so an
   * external stack is a white shaft up the wall and bare red brick above the
   * eaves, and that two-tone stack is the most recognisable thing on the
   * house's skyline. `lime` is the height the wash runs to; above it the same
   * stack is rebuilt in `brick_red`. A stack that never meets a wall (the
   * second one, which surfaces through the roof slope) was never washed at all.
   */
  for (const [chx, chz, base, top, lime] of [
    [x + w / 2 + 0.42, -15.2, 0, 10.2, MANOR.top],
    [-5.2, z, 7.6, 10.0, 0],
  ]) {
    const split = Math.max(base, Math.min(top, lime));
    for (const [key, y0, y1] of [
      ['brick_lime', base, split],
      ['brick_red', split, top],
    ]) {
      if (y1 - y0 < 0.02) continue;
      A.add(key, BOX(A), LL(IDENT, chx, (y0 + y1) / 2, chz, 0, 0.95, y1 - y0, 1.5), {
        masks: [0.55, 0.5, 0.3],
      });
    }
    A.add('stone_pale', BOX_SOFT(A), LL(IDENT, chx, top + 0.08, chz, 0, 1.15, 0.16, 1.7), { masks: [0.8, 0.3, 0.1] });
    // clay pots. `brick_red` rather than a terracotta key of their own: the
    // pots and the stack under them are the same fired clay and the same
    // red-brown, and four 0.16 m cylinders do not earn a draw call.
    for (const pz of [-0.4, 0.4]) {
      A.addOnce('brick_red', tubeY(0.16, 0.5, { radial: 8 }), LL(IDENT, chx, top + 0.14, chz + pz), {
        masks: [0.7, 0.4, 0.2],
      });
    }
    if (base === 0) A.box('concrete', chx, 1.4, chz, 0.95, 2.8, 1.5);
  }

  // the porch: two white columns and a flat hood over the front door
  for (const px of [-1.35, 1.35]) {
    A.addOnce('frame_white', tubeY(0.14, 3.1, { radial: 10 }), LL(IDENT, px, 0.02, z - d / 2 - 1.1), {
      masks: [0.6, 0.35, 0.15],
    });
    A.box('concrete', px, 1.55, z - d / 2 - 1.1, 0.32, 3.1, 0.32);
  }
  A.add('stone_pale', BOX(A), LL(IDENT, 0, 3.28, z - d / 2 - 0.75, 0, 4.3, 0.22, 2.1), { masks: [0.65, 0.35, 0.15] });
  A.box('concrete', 0, 3.28, z - d / 2 - 0.75, 4.3, 0.22, 2.1);
  A.add('frame_white', BOX_THIN(A), LL(IDENT, 0, 3.5, z - d / 2 - 0.75, 0, 4.4, 0.22, 2.2), { masks: [0.7, 0.3, 0.1] });
  deck(A, 'stone_pale', 0, 0.1, z - d / 2 - 1.0, 4.0, 2.0, { t: 0.12 });

  // ------------------------------------------------------- library wing --
  const L = STRUCTURES[1];
  const lw = [
    [L.x, L.z - L.d / 2, 0, L.w], // n
    [L.x - L.w / 2, L.z, H, L.d], // w
    [L.x, L.z + L.d / 2, 0, L.w], // s
  ];
  const lh = [
    [{ u: 0, w: 2.0, y: 0.95, h: 1.6 }],
    [{ u: -2, w: 1.8, y: 0.95, h: 1.6 }, { u: 2, w: 1.8, y: 0.95, h: 1.6 }],
    [{ u: -1.5, w: 1.2, y: 0, h: 2.2 }, { u: 2.2, w: 1.8, y: 0.95, h: 1.6 }],
  ];
  const lFlips = [true, true, false];
  for (let i = 0; i < 3; i++) {
    const [cx, cz, ry, len] = lw[i];
    ewall(A, 'brick_lime', cx, cz, ry, len, 0, 3.2, t, lh[i], { masks: [0.5, 0.45, 0.28] });
    for (const o of lh[i]) if ((o.y ?? 0) > 0) dressOpening(A, cx, cz, ry, 0, o, { glass: true, flip: lFlips[i] });
  }
  deck(A, 'floor_wood', L.x, g0, L.z, L.w - t, L.d - t, { t: 0.16 });
  deck(A, 'roof_screed', L.x, L.h, L.z, L.w + 0.2, L.d + 0.2, { t: 0.26, masks: [0.6, 0.3, 0.2] });
  // parapet on the three free sides; the fourth is the manor's own wall
  for (const [cx, cz, ry, len] of lw) {
    ewall(A, 'brick_lime', cx, cz, ry, len + 0.2, L.h, 0.72, 0.24, [], { masks: [0.55, 0.45, 0.25] });
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, cx, L.h + 0.76, cz, ry, len + 0.34, 0.1, 0.36), {
      masks: [0.75, 0.3, 0.1],
    });
  }

  // ------------------------------------------------------- garage wing --
  const G = STRUCTURES[2];
  const gw = [
    [G.x, G.z - G.d / 2, 0, G.w], // n — the doors, onto the drive apron
    [G.x + G.w / 2, G.z, H, G.d], // e
    [G.x, G.z + G.d / 2, 0, G.w], // s
  ];
  const gh = [
    [{ u: -2.4, w: 2.2, y: 0, h: 2.5 }, { u: 0.2, w: 2.2, y: 0, h: 2.5 }, { u: 2.7, w: 2.2, y: 0.15, h: 2.35 }],
    [{ u: -1.2, w: 1.1, y: 0, h: 2.2 }],
    [{ u: 0, w: 1.6, y: 1.1, h: 1.3 }],
  ];
  for (let i = 0; i < 3; i++) {
    const [cx, cz, ry, len] = gw[i];
    ewall(A, 'brick_lime', cx, cz, ry, len, 0, G.h, t, gh[i], { masks: [0.5, 0.45, 0.28] });
  }
  dressOpening(A, gw[2][0], gw[2][1], 0, 0, gh[2][0], { glass: true });
  // the third door is down: white slats and a real wall behind the look
  A.add('frame_white', BOX(A), LL(IDENT, G.x + 2.7, 1.32, G.z - G.d / 2, 0, 2.16, 2.3, 0.1), { masks: [0.6, 0.4, 0.2] });
  A.box('wood', G.x + 2.7, 1.32, G.z - G.d / 2, 2.16, 2.3, 0.14);
  deck(A, 'floor_concrete', G.x, 0.08, G.z, G.w - t, G.d - t, { t: 0.14 });
  gableRoof(A, 'roof_tile', G.x, G.z, G.h, G.w, G.d, 1.4, { endOverhang: 0.35 });
  gableEnd(A, 'brick_lime', G.x + G.w / 2 - t / 2, G.z, G.h, G.d - 0.1, 1.3, t);

  // ------------------------------------------------------- the terrace --
  const T = TERRACE;
  const tc = [(T.x0 + T.x1) / 2, (T.z0 + T.z1) / 2];
  // bluestone paving under warm stone coping: the terrace is the one place the
  // two stone keys meet, and the contrast is what stops it reading as one slab
  A.add('flagstone', BOX(A), LL(IDENT, tc[0], T.h / 2 - 0.02, tc[1], 0, T.x1 - T.x0, T.h, T.z1 - T.z0), {
    masks: [0.55, 0.45, 0.3],
  });
  A.box('concrete', tc[0], T.h / 2 - 0.02, tc[1], T.x1 - T.x0, T.h, T.z1 - T.z0);
  // balustrade along the lawn edge, broken where the two stairs land
  balRun(A, T.x0 + 0.1, T.z1 - 0.12, -5.4, T.z1 - 0.12, T.h);
  balRun(A, -2.6, T.z1 - 0.12, 2.6, T.z1 - 0.12, T.h);
  balRun(A, 5.4, T.z1 - 0.12, T.x1 - 0.1, T.z1 - 0.12, T.h);
  balRun(A, T.x0 + 0.12, T.z0 + 0.3, T.x0 + 0.12, T.z1 - 0.3, T.h);
  balRun(A, T.x1 - 0.12, T.z0 + 0.3, T.x1 - 0.12, T.z1 - 0.3, T.h);
  for (const sx of [-4, 4]) {
    flight(A, sx, 0.02, T.z1 + flightLength(0.02, T.h, 0.14, 0.32), Math.PI, T.h, 2.4, { rise: 0.14, run: 0.32 });
  }

  A.interiorLights.push({ x: -6, y: MANOR.g - 0.4, z });
  A.interiorLights.push({ x: 0.4, y: MANOR.g - 0.4, z: z - 2.4 });
  A.interiorLights.push({ x: 6.4, y: MANOR.g - 0.4, z });
  A.interiorLights.push({ x: -6, y: MANOR.top - 0.5, z });
  A.interiorLights.push({ x: 6, y: MANOR.top - 0.5, z });
  A.interiorLights.push({ x: L.x, y: 2.7, z: L.z });
  A.interiorLights.push({ x: G.x, y: 2.6, z: G.z });
}

/** The restored barn: hay loft, loft window on the lawn, big east door. */
function buildBarn(A, rng) {
  const s = STRUCTURES[3];
  const t = 0.24;
  const { x, z, w, d } = s;
  const eaves = s.h;
  const loftY = 2.4;
  // stone plinth all round, with the two door gaps carried through it
  ewall(A, 'concrete_dark', x, z - d / 2, 0, w, 0, 0.35, t + 0.1, [], { masks: [0.5, 0.55, 0.35] });
  ewall(A, 'concrete_dark', x, z + d / 2, 0, w, 0, 0.35, t + 0.1, [], { masks: [0.5, 0.55, 0.35] });
  ewall(A, 'concrete_dark', x - w / 2, z, H, d, 0, 0.35, t + 0.1, [{ u: -2.2, w: 1.1, y: 0, h: 0.35 }], { masks: [0.5, 0.55, 0.35] });
  ewall(A, 'concrete_dark', x + w / 2, z, H, d, 0, 0.35, t + 0.1, [{ u: 0, w: 2.9, y: 0, h: 0.35 }], { masks: [0.5, 0.55, 0.35] });
  // board walls: the east gable wall carries the door and the loft window
  ewall(A, 'barn_red', x, z - d / 2, 0, w, 0.35, eaves - 0.35, t, [{ u: -2.4, w: 1.3, y: 0.95, h: 1.1 }, { u: 2.4, w: 1.3, y: 0.95, h: 1.1 }], { masks: [0.55, 0.45, 0.3] });
  ewall(A, 'barn_red', x, z + d / 2, 0, w, 0.35, eaves - 0.35, t, [{ u: 0, w: 1.3, y: 0.95, h: 1.1 }], { masks: [0.55, 0.45, 0.3] });
  ewall(A, 'barn_red', x - w / 2, z, H, d, 0.35, eaves - 0.35, t, [{ u: -2.2, w: 1.1, y: 0, h: 1.85 }], { masks: [0.55, 0.45, 0.3] });
  ewall(A, 'barn_red', x + w / 2, z, H, d, 0.35, eaves - 0.35, t, [
    { u: 0, w: 2.9, y: 0, h: 2.15 },
    { u: 0, w: 1.8, y: 2.55, h: 1.25 }, // the loft window, facing the lawn
  ], { masks: [0.55, 0.45, 0.3] });
  // white trim on the openings, and the slid-open door leaf beside the door
  A.add('frame_white', BOX_THIN(A), LL(IDENT, x + w / 2, 2.62, z, H, 3.2, 0.14, t + 0.1), { masks: [0.7, 0.3, 0.1] });
  A.add('frame_white', BOX_THIN(A), LL(IDENT, x + w / 2, 4.24, z, H, 2.1, 0.12, t + 0.1), { masks: [0.7, 0.3, 0.1] });
  A.add('barn_red', BOX(A), LL(IDENT, x + w / 2 + 0.18, 1.24, z + 2.3, H, 1.6, 2.3, 0.08), { masks: [0.65, 0.4, 0.2] });
  A.box('wood', x + w / 2 + 0.18, 1.24, z + 2.3, 0.08, 2.3, 1.6);
  // rail over the door: the thing that says "this door slides"
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, x + w / 2 + 0.2, 2.42, z + 0.8, H, 4.6, 0.08, 0.08), { masks: [0.85, 0.4, 0.1] });

  // dirt floor, the loft over the east half, and the stair up to it
  deck(A, 'floor_concrete', x, 0.05, z, w - t, d - t, { t: 0.1, masks: [0.35, 0.6, 0.4] });
  deck(A, 'wood_prop_dark', (x + w / 2 - t / 2 + -22) / 2, loftY, z, x + w / 2 - t / 2 - -22, d - t, { t: 0.18, masks: [0.5, 0.5, 0.3] });
  // foot measured back from the loft edge, same rule as the manor stair
  flight(A, -22 - flightLength(0.05, loftY, 0.26, 0.3), 0.05, 17.4, H, loftY, 1.15, { key: 'wood_dark', rise: 0.26 });
  // loft rail on the open west edge, with the gap where the stair lands
  const railB = (z0, z1) => {
    A.add('wood_dark', BOX_THIN(A), LL(IDENT, -22, loftY + 0.85, (z0 + z1) / 2, H, z1 - z0, 0.07, 0.07), { masks: [0.7, 0.35, 0.1] });
    const n = Math.max(1, Math.round((z1 - z0) / 0.55));
    for (let i = 0; i <= n; i++)
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, -22, loftY + 0.42, z0 + ((z1 - z0) * i) / n, 0, 0.05, 0.85, 0.05), { masks: [0.7, 0.4, 0.1] });
    A.box('wood', -22, loftY + 0.45, (z0 + z1) / 2, 0.08, 0.9, z1 - z0, 0);
  };
  railB(z - d / 2 + 0.3, 16.6);
  railB(18.2, z + d / 2 - 0.3);

  // roof and gable peaks
  gableRoof(A, 'corrugated', x, z, eaves, w, d, 1.8, { masks: [0.6, 0.4, 0.25] });
  gableEnd(A, 'barn_red', x - w / 2 + t / 2, z, eaves, d - 0.1, 1.7, t);
  gableEnd(A, 'barn_red', x + w / 2 - t / 2 - t, z, eaves, d - 0.1, 1.7, t);

  // hay: bales on the floor, bales on the loft, straw underfoot
  A.put('bale', x - 1.2, 0.05, z - 2.2, 0.4, 1);
  A.put('bale', x - 2.2, 0.05, z - 2.0, 1.8, 1);
  A.put('bale', x - 1.7, 0.55, z - 2.1, 1.1, 1);
  A.put('bale', x - 3.4, 0.05, z + 2.4, 0.9, 1);
  A.put('bale', x + 1.6, loftY, z - 2.0, 0.3, 1);
  A.put('bale', x + 2.6, loftY, z - 1.7, 1.2, 1);
  A.put('bale', x + 2.0, loftY, z + 2.2, 2.1, 1);
  A.put('barrel_wood', x - 3.6, 0.05, z - 0.2, 0.7, 1);
  A.put('crate_a', x + 2.8, 0.05, z + 2.6, 0.3, 1);
  A.put('pallet', x + 1.4, 0.05, z + 2.8, 1.7, 1);

  A.interiorLights.push({ x, y: 2.1, z });
  A.interiorLights.push({ x: x + 2, y: loftY + 1.6, z });
}

/**
 * The Lord & Burnham greenhouse: brick base, white steel, glass everything.
 * It runs north-south along the east wall — ridge along Z, a door in each
 * gable end — so its long glass face reads from the whole east lawn.
 */
function buildGreenhouse(A, rng) {
  const s = STRUCTURES[4];
  const { x, z, w, d } = s;
  const baseH = 0.62;
  const glassTop = 2.3;
  const rise = 1.25;
  const t = 0.22;
  const doorW = 1.25;
  // brick base: solid down the long sides, a full gap at each end door. Left
  // bare, unlike the house — a glasshouse plinth is a garden structure and
  // nobody limewashes the thing the potting benches sit on.
  ewall(A, 'brick_red', x - w / 2, z, H, d, 0, baseH, t, [], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_red', x + w / 2, z, H, d, 0, baseH, t, [], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_red', x, z - d / 2, 0, w, 0, baseH, t, [{ u: 0, w: doorW, y: 0, h: baseH }], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_red', x, z + d / 2, 0, w, 0, baseH, t, [{ u: 0, w: doorW, y: 0, h: baseH }], { masks: [0.5, 0.5, 0.3] });

  // the glazing band: one sheet per long face, bars over it
  const bandH = glassTop - baseH;
  const bandY = baseH + bandH / 2;
  for (const sx of [-1, 1]) {
    const px = x + (sx * w) / 2;
    // pane yaw: −H faces −X (west), +H faces +X — always outward
    A.add('window_glass', PANE(A), LL(IDENT, px, bandY, z, sx > 0 ? H : -H, d - 0.1, bandH, 1));
    A.box('glass', px, bandY, z, 0.06, bandH, d - 0.1);
    const n = Math.round(d / 1.375);
    for (let i = 0; i <= n; i++) {
      const pz = z - d / 2 + (i / n) * d;
      strut(A, 'frame_white', px, baseH, pz, px, glassTop, pz, 0.07);
    }
    strut(A, 'frame_white', px, glassTop, z - d / 2, px, glassTop, z + d / 2, 0.09);
    strut(A, 'frame_white', px, baseH, z - d / 2, px, baseH, z + d / 2, 0.08);
  }
  for (const sz of [-1, 1]) {
    const pz = z + (sz * d) / 2;
    const py = sz > 0 ? 0 : Math.PI; // outward-facing end panes
    // glass each side of the door, and collision that leaves the doorway real
    for (const so of [-1, 1]) {
      const gw2 = (w - doorW) / 2;
      const gc = x + so * (doorW / 2 + gw2 / 2);
      A.add('window_glass', PANE(A), LL(IDENT, gc, bandY, pz, py, gw2 - 0.05, bandH, 1));
      A.box('glass', gc, (glassTop + 0.1) / 2, pz, gw2 - 0.05, glassTop + 0.1, 0.06);
    }
    // glass over the door, and the gable triangle above the plate
    A.add('window_glass', PANE(A), LL(IDENT, x, glassTop - 0.14, pz, py, doorW, 0.28, 1));
    const tri = polyPrism([[-w / 2, 0], [w / 2, 0], [0, rise - 0.05]], 0.05);
    tri.rotateX(Math.PI / 2);
    A.addOnce('window_glass', tri, LL(IDENT, x, glassTop, pz, py));
    strut(A, 'frame_white', x - w / 2, baseH, pz, x + w / 2, baseH, pz, 0.08);
    strut(A, 'frame_white', x - w / 2, glassTop, pz, x, glassTop + rise - 0.03, pz, 0.07);
    strut(A, 'frame_white', x + w / 2, glassTop, pz, x, glassTop + rise - 0.03, pz, 0.07);
    for (const so of [-1, 1])
      strut(A, 'frame_white', x + so * doorW / 2, baseH, pz, x + so * doorW / 2, glassTop, pz, 0.07);
  }
  // the glass roof: thin slabs (boxes render from both sides), ridge, rafters
  const halfW = w / 2;
  const slope = Math.hypot(halfW, rise);
  const pitch = Math.atan2(rise, halfW);
  for (const sx of [-1, 1]) {
    // yaw H puts the slab's length along Z; its local +Z then points +X, so
    // the same `s * pitch` rule as gableRoof applies with s = sx.
    A.add('window_glass', BOX_THIN(A), LL(IDENT, x + (sx * halfW) / 2, glassTop + rise / 2, z, H, d + 0.15, 0.04, slope, sx * pitch));
    A.collideGeo('glass', BOX_THIN(A), LL(IDENT, x + (sx * halfW) / 2, glassTop + rise / 2, z, H, d + 0.15, 0.05, slope, sx * pitch));
  }
  strut(A, 'frame_white', x, glassTop + rise, z - d / 2 - 0.1, x, glassTop + rise, z + d / 2 + 0.1, 0.1);
  const rn = Math.round(d / 1.375);
  for (let i = 0; i <= rn; i++) {
    const pz = z - d / 2 + (i / rn) * d;
    for (const sx of [-1, 1])
      strut(A, 'frame_white', x + sx * halfW, glassTop, pz, x, glassTop + rise, pz, 0.06);
  }

  // inside: gravel underfoot, a potting row down each glass wall
  const floor = patchGeometry(rng, d * 0.58, { lobes: 12, wobble: 0.08 });
  A.addOnce('road_dust', floor, LL(IDENT, x, 0.05, z, 0, 0.46, 1, 1), { masks: [0.25, 0.3, 0.2] });
  for (const [tx, tz] of [[x - 1.35, z - 3.6], [x - 1.35, z + 0.2], [x - 1.35, z + 3.6], [x + 1.35, z - 1.7], [x + 1.35, z + 2.0]]) {
    A.put('table', tx, 0.06, tz, H, 1);
    A.put('planter', tx + 0.1, 0.84, tz - 0.4, rng.float() * 3, 0.8);
    A.put('planter', tx - 0.1, 0.84, tz + 0.45, rng.float() * 3, 0.7);
    A.put('shrub', tx, 0.8, tz + 0.1, rng.float() * 3, 0.55);
  }
  A.put('barrel_wood', x + 1.8, 0.05, z - 4.6, 0.8, 0.9);
  A.put('bucket', x - 1.9, 0.05, z + 4.4, 1.9, 1);

  A.interiorLights.push({ x, y: 2.3, z: z - 2.6 });
  A.interiorLights.push({ x, y: 2.3, z: z + 2.6 });
}

/** The pool: coping, tiled shell, wadeable water, board and loungers. */
function buildPool(A, rng) {
  const P = POOL;
  const cx = (P.x0 + P.x1) / 2;
  const cz = (P.z0 + P.z1) / 2;
  const w = P.x1 - P.x0;
  const d = P.z1 - P.z0;

  // the stone surround, laid flat on the lawn
  for (const [sx, sz, sw, sd] of [
    [cx, P.z0 - 1.5, w + 6, 2.4],
    [cx, P.z1 + 1.5, w + 6, 2.4],
    [P.x0 - 1.5, cz, 2.4, d + 0.2],
    [P.x1 + 1.5, cz, 2.4, d + 0.2],
  ]) {
    A.add('stone_pale', BOX(A), LL(IDENT, sx, 0.02, sz, 0, sw, 0.07, sd), { masks: [0.5, 0.45, 0.3] });
  }
  // coping ring, proud of the deck
  for (const [sx, sz, sw, sd] of [
    [cx, P.z0 - 0.3, w + 1.2, 0.6],
    [cx, P.z1 + 0.3, w + 1.2, 0.6],
    [P.x0 - 0.3, cz, 0.6, d],
    [P.x1 + 0.3, cz, 0.6, d],
  ]) {
    A.add('stone_pale', BOX_SOFT(A), LL(IDENT, sx, 0.045, sz, 0, sw, 0.11, sd), { masks: [0.7, 0.3, 0.12] });
    A.box('concrete', sx, 0.045, sz, sw, 0.11, sd);
  }
  // The tiled shell. The visible floor sits just under the walk collider so a
  // wader STANDS on what they can see — a deep-looking basin under a shallow
  // collider would float everyone in it 60 cm over the tiles.
  for (const [sx, sz, sw, sd] of [
    [cx, P.z0 + 0.275, w, 0.55],
    [cx, P.z1 - 0.275, w, 0.55],
    [P.x0 + 0.275, cz, 0.55, d - 1.1],
    [P.x1 - 0.275, cz, 0.55, d - 1.1],
  ]) {
    A.add('tile_floor', BOX(A), LL(IDENT, sx, -0.47, sz, 0, sw, 1.0, sd), { masks: [0.45, 0.4, 0.25] });
    A.box('concrete', sx, -0.47, sz, sw, 1.0, sd);
  }
  A.add('tile_floor', BOX(A), LL(IDENT, cx, -0.75, cz, 0, w - 0.2, 0.18, d - 0.2), { masks: [0.4, 0.45, 0.3] });
  // the wading floor: what you actually stand on, tagged water for the FX
  A.box('water', cx + 0.3, P.walkY - 0.2, cz, w - 1.7, 0.4, d - 1.1);
  // shallow-end steps back out, so the pool is a detour and never a trap
  A.add('tile_floor', BOX(A), LL(IDENT, P.x0 + 0.85, -0.46, cz, 0, 0.6, 0.24, 2.4), { masks: [0.5, 0.4, 0.2] });
  A.box('concrete', P.x0 + 0.85, -0.46, cz, 0.6, 0.24, 2.4);
  A.add('tile_floor', BOX(A), LL(IDENT, P.x0 + 0.85, -0.18, cz, 0, 0.3, 0.24, 2.4), { masks: [0.5, 0.4, 0.2] });
  A.box('concrete', P.x0 + 0.85, -0.18, cz, 0.3, 0.24, 2.4);
  // water
  const water = new THREE.PlaneGeometry(w - 0.15, d - 0.15, 1, 1);
  water.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', water, LL(IDENT, cx, P.waterY, cz));

  // the diving board, cantilevered over the deep end
  A.add('stone_pale', BOX(A), LL(IDENT, P.x1 + 0.95, 0.24, cz, 0, 0.5, 0.4, 0.6), { masks: [0.6, 0.4, 0.2] });
  A.box('concrete', P.x1 + 0.95, 0.24, cz, 0.5, 0.4, 0.6);
  A.add('wood_pale', BOX(A), LL(IDENT, P.x1 + 0.15, 0.5, cz, 0, 2.1, 0.09, 0.46), { masks: [0.7, 0.3, 0.1] });
  A.box('wood', P.x1 + 0.15, 0.5, cz, 2.1, 0.09, 0.46);

  // loungers and a drinks table on the south deck
  A.put('lounger', cx - 2.2, 0.06, P.z1 + 1.6, Math.PI + 0.15, 1);
  A.put('lounger', cx - 0.4, 0.06, P.z1 + 1.7, Math.PI - 0.1, 1);
  A.put('lounger', cx + 1.5, 0.06, P.z1 + 1.6, Math.PI + 0.22, 1);
  A.put('table_small', cx + 3.2, 0.06, P.z1 + 1.5, 0.3, 0.9);
}

/** The tennis court: acrylic slab, white lines, a net you vault or round. */
function buildTennis(A, rng) {
  const T = TENNIS;
  const cx = (T.x0 + T.x1) / 2;
  const cz = (T.z0 + T.z1) / 2;
  const w = T.x1 - T.x0;
  const d = T.z1 - T.z0;
  A.add('court_green', BOX(A), LL(IDENT, cx, 0.035, cz, 0, w, 0.07, d), { masks: [0.4, 0.5, 0.3] });
  A.box('concrete', cx, 0.035, cz, w, 0.07, d);
  // white lines: the doubles box, the centre service line
  const line = (lx, lz, lw, ld) =>
    A.add('plaster_white', BOX_THIN(A), LL(IDENT, lx, 0.075, lz, 0, lw, 0.012, ld), { masks: [0.7, 0.2, 0] });
  const ix = 1.6;
  const iz = 1.1;
  line(cx, T.z0 + iz, w - ix * 2, 0.06);
  line(cx, T.z1 - iz, w - ix * 2, 0.06);
  line(T.x0 + ix, cz, 0.06, d - iz * 2);
  line(T.x1 - ix, cz, 0.06, d - iz * 2);
  line(cx, cz, w - ix * 2, 0.05);
  line(T.netX - 3.4, cz, 0.05, d - iz * 2);
  line(T.netX + 3.4, cz, 0.05, d - iz * 2);
  // the net: posts, a dark mesh slab, white tape — solid to the controller
  for (const nz of [T.z0 + 0.4, T.z1 - 0.4]) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, T.netX, 0.6, nz, 0, 0.09, 1.1, 0.09), { masks: [0.8, 0.4, 0.1] });
  }
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, T.netX, 0.55, cz, 0, 0.05, 0.9, d - 0.85), { masks: [0.7, 0.5, 0.2] });
  A.add('plaster_white', BOX_THIN(A), LL(IDENT, T.netX, 1.0, cz, 0, 0.06, 0.07, d - 0.8), { masks: [0.75, 0.2, 0] });
  A.box('fabric', T.netX, 0.52, cz, 0.1, 1.04, d - 0.8);
  // spectators' bench outside the screen gap
  A.put('bench', 11.2, 0.02, 24.2, -H, 1);
}

/** The sunken garden's furniture: the bowl itself is in the height field. */
function buildSunkenGarden(A, rng) {
  const cx = (BOWL.x0 + BOWL.x1) / 2;
  const cz = (BOWL.z0 + BOWL.z1) / 2;
  const floorY = groundYWilmot(cx, cz);
  // the sundial: plinth, column, plate — centre cover you fight around
  A.add('stone_pale', BOX(A), LL(IDENT, cx, floorY + 0.14, 1, 0, 0.9, 0.28, 0.9), { masks: [0.6, 0.4, 0.25] });
  A.addOnce('concrete_prop', tubeY(0.14, 0.85, { radial: 10 }), LL(IDENT, cx, floorY + 0.28, 1), { masks: [0.6, 0.4, 0.2] });
  A.addOnce('concrete_prop', tubeY(0.34, 0.08, { radial: 12 }), LL(IDENT, cx, floorY + 1.13, 1), { masks: [0.75, 0.3, 0.1] });
  A.box('concrete', cx, floorY + 0.65, 1, 0.9, 1.3, 0.9);
  // stone kerb down both long rims, marking the lip before the drop
  for (const rx of [BOWL.x0 - 0.4, BOWL.x1 + 0.4]) {
    A.add('stone_pale', BOX_THIN(A), LL(IDENT, rx, groundYWilmot(rx, cz) + 0.03, cz, H, BOWL.z1 - BOWL.z0 + 1, 0.1, 0.3), {
      masks: [0.7, 0.35, 0.15],
    });
  }
  // urns on the four rim corners, roses down in the beds
  for (const [ux, uz] of [[-25.6, -8.2], [-16.4, -8.2], [-25.6, 10.2], [-16.4, 10.2]]) {
    A.put('urn', ux, groundYWilmot(ux, uz), uz, rng.float() * 3, 1.1);
  }
  for (let i = 0; i < 10; i++) {
    const rx = cx + rng.range(-2.2, 2.2);
    const rz = cz + rng.range(-5.2, 5.2);
    if (Math.abs(rz - -2.2) < 0.8 || Math.abs(rz - 4.2) < 0.8) continue; // the parterre rows
    A.put('rose_tuft', rx, groundYWilmot(rx, rz), rz, rng.float() * 6.28, rng.range(0.8, 1.3));
  }
  A.put('bench', cx - 1.9, floorY, 1, H, 1);
}

/** The forecourt fountain: basin you can take cover behind, water you can't. */
function buildFountain(A, rng) {
  const F = FOUNTAIN;
  A.addOnce('concrete_prop', tubeY(F.r, 0.55, { radial: 18 }), LL(IDENT, F.x, 0.03, F.z), { masks: [0.55, 0.45, 0.25] });
  A.addOnce('stone_pale', tubeY(F.r + 0.14, 0.12, { radial: 18 }), LL(IDENT, F.x, 0.56, F.z), { masks: [0.75, 0.3, 0.1] });
  // collision: four rim slabs, so the middle stays water, not invisible floor
  for (const [sx, sz, sw, sd] of [
    [F.x, F.z - F.r + 0.15, F.r * 1.7, 0.35],
    [F.x, F.z + F.r - 0.15, F.r * 1.7, 0.35],
    [F.x - F.r + 0.15, F.z, 0.35, F.r * 1.7],
    [F.x + F.r - 0.15, F.z, 0.35, F.r * 1.7],
  ]) {
    A.box('concrete', sx, 0.34, sz, sw, 0.68, sd);
  }
  A.box('water', F.x, 0.18, F.z, F.r * 1.35, 0.2, F.r * 1.35);
  const water = new THREE.CircleGeometry(F.r - 0.18, 18);
  water.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', water, LL(IDENT, F.x, 0.42, F.z));
  A.addOnce('concrete_prop', tubeY(0.3, 0.9, { radial: 12 }), LL(IDENT, F.x, 0.1, F.z), { masks: [0.5, 0.5, 0.3] });
  A.addOnce('concrete_prop', tubeY(0.85, 0.14, { radial: 14 }), LL(IDENT, F.x, 1.0, F.z), { masks: [0.7, 0.35, 0.15] });
  A.addOnce('concrete_prop', tubeY(0.12, 0.55, { radial: 8 }), LL(IDENT, F.x, 1.14, F.z), { masks: [0.6, 0.4, 0.2] });
  A.box('concrete', F.x, 0.9, F.z, 0.6, 1.8, 0.6);
}

/** One specimen tree: bark, dark heart, leaf shell — and a solid trunk. */
function tree(A, x, z, s, ry) {
  const y = Math.max(0, groundYWilmot(x, z) - 0.04);
  A.put('oak_trunk', x, y, z, ry, s);
  A.put('oak_core', x, y, z, ry, s);
  A.put('oak_leaf', x, y, z, ry, s);
}

/** Hedges and trees: the estate's real architecture. */
function plantEstate(A, rng) {
  for (const [x, z, ry, len, h] of HEDGES) {
    const n = Math.max(1, Math.round(len / HEDGE.l));
    const seg = len / n;
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * seg;
      alongWall(x, z, ry, u, _wp);
      const jr = ry + rng.range(-0.015, 0.015);
      A.putS('hedge_core', _wp[0], -0.03, _wp[1], jr, seg / HEDGE.l, h / HEDGE.h, 1);
      A.putS('hedge_leaf', _wp[0], -0.03, _wp[1], jr, seg / HEDGE.l, h / HEDGE.h, 1);
    }
    A.box('foliage', x, h / 2, z, ry === 0 ? len : HEDGE.w, h, ry === 0 ? HEDGE.w : len, 0);
  }
  for (const [x, z, s] of TREES) {
    tree(A, x, z, s, (x * 7.3 + z * 3.1) % 6.28);
    A.box('wood', x, 1.5 * s, z, 0.6 * s, 3.0 * s, 0.6 * s);
  }
  // the parkland treeline outside the wall — the skyline, and the reason the
  // horizon is never a flat band. No collision: nothing out there is playable.
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rng.range(-0.06, 0.06);
    const rx = Math.cos(a);
    const rz = Math.sin(a);
    const m = Math.max(Math.abs(rx) / (WILMOT.halfX + rng.range(4, 13)), Math.abs(rz) / (WILMOT.halfZ + rng.range(4, 13)));
    const x = rx / m;
    const z = rz / m;
    tree(A, x, z, rng.range(0.9, 1.5), rng.float() * 6.28);
  }
}

/** Set dressing: garden furniture, lamps, the small stuff at ankle level. */
function dressEstate(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.4, scale: 0.06 };
  const free = (x, z, m = 0.8) =>
    !inSolidWilmot(x, z, m) && Math.abs(x) < WILMOT.halfX - 1.2 && Math.abs(z) < WILMOT.halfZ - 1.2;

  // topiary pairs at the doors and the terrace stairs
  const pairs = [
    [-2.6, -19.4, 2.6, -19.4], // front door
    [-5.6, -3.6, -2.4, -3.6], // west terrace stair
    [2.4, -3.6, 5.6, -3.6], // east terrace stair
    [-16.8, -8.4, -12.6, -8.4], // library south door
  ];
  for (const [x0, z0, x1, z1] of pairs) {
    for (const [tx, tz] of [[x0, z0], [x1, z1]]) {
      A.put('topiary_core', tx, 0.02, tz, rng.float() * 3, 1);
      A.put('topiary_leaf', tx, 0.02, tz, rng.float() * 3, 1);
    }
  }
  // urns along the drive and at the tennis gap
  for (const [x, z] of [[-13.5, -22.5], [-18.5, -25.8], [8.8, -20.3], [18.2, 10.9], [21.2, 10.9]]) {
    if (free(x, z, 0.4)) A.put('urn', x, 0.02, z, rng.float() * 3, 1);
  }
  // benches with views
  for (const [x, z, ry] of [[-6.2, 17.2, 0.3], [28.2, 5.6, H + 0.4], [-28.0, -17.0, -H + 0.3]]) {
    if (free(x, z, 0.6)) A.put('bench', x, 0.02, z, ry, 1);
  }
  // estate lamps: the map's street lights
  for (const [x, z, ry] of [
    [-6.2, -20.6, 0.6],
    [6.4, -26.6, -2.4],
    [-8.9, -3.4, 0.2],
    [8.9, -3.4, -0.2],
    [-16.2, 12.4, 1.2],
    [11.6, 7.6, -1.8],
  ]) {
    A.put('lamp_post', x, 0.02, z, ry, 0.85);
    A.put('lamp_glass', x, 0.02, z, ry, 0.85);
    A.box('metal', x, 1.1, z, 0.3, 2.2, 0.3);
    A.lampAnchors.push({ x: x + Math.cos(ry) * 0.74, y: 4.55, z: z - Math.sin(ry) * 0.74 });
  }

  // the manor's foundation planting, and pots on the terrace
  for (const [x, z] of [[-8.6, -18.9], [-5.6, -18.9], [5.4, -18.9], [8.6, -18.9], [-10.9, -8.0], [10.9, -8.2]]) {
    A.put('shrub', x, 0.02, z, rng.float() * 6.28, rng.range(0.8, 1.2));
  }
  A.put('planter', -7.2, TERRACE.h + 0.02, -6.4, 0.4, 1.1);
  A.put('planter', 7.2, TERRACE.h + 0.02, -6.4, 1.9, 1.1);
  A.put('table_small', 0, TERRACE.h + 0.02, -6.2, 0.2, 1);
  A.put('chair', -0.9, TERRACE.h + 0.02, -6.0, 1.8, 1);
  A.put('chair', 0.9, TERRACE.h + 0.02, -6.5, -1.4, 1);

  // inside the manor: what four bedrooms' worth of house leaves downstairs
  A.put('table', -6.4, MANOR.floor, -13.4, 0.05, 1);
  A.put('chair', -7.3, MANOR.floor, -12.8, 1.7, 1);
  A.put('chair', -5.5, MANOR.floor, -14.1, -1.3, 1);
  A.put('cabinet', -3.6, MANOR.floor, -17.5, 0, 1);
  A.put('shelf', -10.0, MANOR.floor, -10.4, H, 1);
  A.put('table_small', 1.8, MANOR.floor, -10.2, 0.4, 1);
  A.put('cabinet', 4.0, MANOR.floor, -17.6, 0, 1);
  A.put('cabinet', 5.4, MANOR.floor, -17.6, 0, 1);
  A.put('table', 7.0, MANOR.floor, -13.0, H, 1);
  A.put('chair', 6.2, MANOR.floor, -14.2, 0.5, 1);
  A.put('chair', 7.9, MANOR.floor, -11.9, -2.2, 1);
  A.put('crate_b', 9.4, MANOR.floor, -17.4, 0.7, 1);
  // upstairs: two beds, a wardrobe, the landing table
  A.put('mattress', -7.6, MANOR.deck + 0.02, -15.8, H, 1);
  A.put('cabinet', -9.6, MANOR.deck + 0.02, -11.2, H, 1);
  A.put('mattress', 7.4, MANOR.deck + 0.02, -15.6, H + 0.1, 1);
  A.put('shelf', 9.6, MANOR.deck + 0.02, -11.4, H, 1);
  A.put('table_small', 2.8, MANOR.deck + 0.02, -10.4, -0.3, 1);
  // the library: shelves and a reading table
  A.put('shelf', -17.9, MANOR.floor, -15.4, H, 1);
  A.put('shelf', -17.9, MANOR.floor, -13.2, H, 1);
  A.put('shelf', -17.9, MANOR.floor, -11.0, H, 1);
  A.put('table', -14.2, MANOR.floor, -13.0, 0.1, 1);
  A.put('chair', -13.2, MANOR.floor, -13.8, -1.2, 1);
  // the garage: a workbench and the clutter of a working estate
  A.put('table', 16.6, 0.08, -12.2, 0, 1);
  A.put('crate_a', 11.8, 0.08, -12.0, 0.4, 1);
  A.put('crate_c', 12.6, 0.08, -12.6, 1.2, 1);
  A.put('barrel_wood', 17.4, 0.08, -16.8, 0.9, 1);
  A.put('pallet', 12.4, 0.08, -16.6, 0.2, 1);
  A.put('bucket', 15.0, 0.08, -16.9, 2.2, 1);

  // weeds where the mower doesn't reach: wall lines, corners, the barn
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    const along = rng.range(-0.92, 0.92);
    const inset = rng.range(1.0, 2.6);
    const x = side === 0 || side === 2 ? along * WILMOT.halfX : (side === 1 ? WILMOT.halfX - inset : -WILMOT.halfX + inset);
    const z = side === 0 ? -WILMOT.halfZ + inset : side === 2 ? WILMOT.halfZ - inset : along * WILMOT.halfZ;
    if (!free(x, z, 0.4)) continue;
    A.put('weeds', x, 0.02, z, rng.float() * 6.28, rng.range(0.6, 1.2));
  }
  for (let i = 0; i < 14; i++) {
    const x = -22 + rng.range(-6, 6);
    const z = 15 + rng.range(-6, 6);
    if (!free(x, z, 0.5)) continue;
    A.put('weeds', x, 0.02, z, rng.float() * 6.28, rng.range(0.7, 1.3));
  }
  A.jitter = null;
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as the market's and Rust's `build`.
 */
export function buildWilmot(A, rng) {
  registerProps(A, rng);
  registerWilmotProps(A, rng);

  buildGrounds(A, rng);
  buildManor(A, rng);
  buildBarn(A, rng);
  buildGreenhouse(A, rng);
  buildPool(A, rng);
  buildTennis(A, rng);
  buildSunkenGarden(A, rng);
  buildFountain(A, rng);
  plantEstate(A, rng);
  dressEstate(A, rng);

  return { buildings: STRUCTURES.map((s) => ({ spec: s, id: s.id })) };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const WILMOT_MAP = {
  id: 'wilmot',
  blurb:
    'A whitewashed manor over its own lawn: pool terrace, hedge lanes and a sunken garden below the sightlines, with a hay loft and the house windows above them.',
  size: '62 × 58 m',
  /**
   * LEVEL -> WORLD. Off-axis for the same reason Rust is: every mass here is a
   * rectangle, and rectangles lit square-on lose one of their two lit faces.
   */
  transform: { yaw: 0.52, tx: 0, tz: 0 },
  /** Tight to the wall plus a skirt for the nav grid; the perimeter is sealed. */
  bounds: [-37, -3.5, -35, 37, 24, 35],
  spawnPoints: WILMOT_SPAWNS,
  standable: standableAtWilmot,
  groundY: groundYWilmot,
  isOpen: isOpenWilmot,
  build: buildWilmot,
};
