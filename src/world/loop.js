import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, PANE, IDENT, LL, stairRun } from './kit.js';
import { registerProps } from './props.js';
import { registerLoopProps, TIE } from './loopprops.js';
import { fbm3, hash3, paintMasks, patchGeometry, polyPrism, tubeY } from './util.js';

/**
 * WORLD — THE LOOP.
 *
 * A low-poly Chicago street corner under the elevated tracks, AT NIGHT: two
 * downtown streets crossing at an intersection the L turns over, compressed to
 * a ~76 x 76 m block the way Rust compresses a refinery. The icon IS the
 * structure — riveted steel bents marching down the middle of the street, a
 * curve of track bed swinging through the corner overhead, and a stalled
 * train sitting at the platform. Everything is generated here; nothing is
 * loaded from disk.
 *
 * THE HOUR IS PART OF THE MAP. The descriptor at the bottom of this file
 * carries an `environment` (see src/world/maps.js), so building this level sets
 * the sky to half past eleven and a city's haze, and leaving it puts the sky back.
 * Everything below is dressed for that: the shopfronts, the marquee, the blade
 * sign, the platform fittings and a fifth of the rooms upstairs are emitters,
 * and the practicals the world already ramps on solar altitude — the lamp posts
 * and the interior bulbs — are the key light for the whole block.
 *
 *   THE TRACKS     enter at the north edge over one street, curve over the
 *                  intersection and leave east over the other. The deck is the
 *                  map's second storey: a walkable lane behind waist-high
 *                  girders, reached by the station stair in the southeast and
 *                  a construction scaffold at the north street mouth.
 *   THE STATION    a wooden side platform with a canopy on the east run, a
 *                  stalled two-tone train alongside it, and the long stair
 *                  down to the sidewalk.
 *   THE STREETS    a plus of asphalt and raised sidewalks: columns for cover
 *                  under the tracks, open sky and shopfronts on the south and
 *                  west arms.
 *   THE ALLEYS     two service lanes behind the streetside blocks, crossing
 *                  the east-west street — dumpsters, fire stairs and the way
 *                  around every sightline.
 *   THE CORNERS    four blocks of brick, limestone and terracotta. The diner
 *                  (NW) and the corner bar (SE) have enterable ground floors;
 *                  the theatre (NE) hangs its marquee and blade sign over the
 *                  corner the tracks turn around.
 *
 * LOW POLY IS THE BRIEF, same as Rust and Wilmot: chunky massing, chamfered
 * boxes and struts, with all surface detail carried by the shared procedural
 * materials.
 *
 * LAYOUT NOTES
 *   Authored in LEVEL space, north at -Z. One street runs north-south under
 *   the L (x = 0), one east-west (z = 0). The vertical routes are stairs
 *   only, as everywhere else in the game: the station stair to the platform
 *   and the scaffold stair at the north mouth, joined by the track deck.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const LOOP = {
  /** Half-extent of the block. The outer building walls sit on this line. */
  half: 38,
  /** Roadway half-width and the sidewalk line either side of each street. */
  road: 4.6,
  walk: 7,
  /** Street level and the sidewalk's curb height. */
  roadY: 0.05,
  walkY: 0.18,
};

/** The elevated structure, the map's whole reason to exist. */
export const EL = {
  deckY: 6.2, // top of the track deck — the walkable second storey
  deckHalf: 3.5, // deck half-width
  girderH: 0.95, // the waist-high guard girder above the deck
  girderD: 1.0, // the plate girder below the deck edge
  colX: 3.6, // bent columns stand this far off the street centreline
  /** Bent (column pair + cross girder) stations along each run. */
  bentsNS: [-35.5, -29, -22.5, -16, -9.5],
  bentsEW: [10.5, 17, 23.5, 30, 36],
  /**
   * The curve: chord joints from the north-south run (ends at z = -8) to the
   * east-west run (starts at x = 8), on an 8 m arc centred at (8, -8).
   */
  curve: [
    [0, -8],
    [1.07, -4],
    [4, -1.07],
    [8, 0],
  ],
};

/** The station platform on the east run, and the stair down to the street. */
export const STATION = {
  x0: 19.8, // platform extents along the run; the stair lands on this edge
  x1: 36.0,
  z0: 3.5, // platform inner edge — flush against the deck
  z1: 6.3,
  /** The flight climbs east from the intersection's sidewalk. */
  stair: { x0: 12.8, x1: 19.9, z0: 4.95, z1: 6.45 },
};

/** The stalled train: one car on the north track, stopped at the platform. */
export const TRAIN = { x0: 16.2, x1: 29.8, z: -1.7, w: 2.75, floor: 0.9, h: 3.0 };

/** The scaffold stair at the north street mouth — the deck's second access. */
export const SCAFFOLD = { x: 4.9, footZ: -27.3, topZ: -34.2, w: 1.3 };

/**
 * The eight blocks. Same shape as the market's `BUILDINGS` entries so
 * `ui/minimap` can draw them. `h` is the parapet line of the mass. Inner
 * blocks front the streets; outer blocks back onto the map edge, with the
 * two service alleys between them.
 */
export const STRUCTURES = [
  { id: 'diner', x: -14.7, z: -22.5, w: 15.4, d: 31, floors: 3, h: 10.2 },
  { id: 'printworks', x: -31.8, z: -22.5, w: 12.4, d: 31, floors: 3, h: 11.8 },
  { id: 'theatre', x: 14.7, z: -22.5, w: 15.4, d: 31, floors: 4, h: 13.4 },
  { id: 'annex', x: 31.8, z: -22.5, w: 12.4, d: 31, floors: 2, h: 8.4 },
  { id: 'tavern', x: -14.7, z: 22.5, w: 15.4, d: 31, floors: 2, h: 7.6 },
  { id: 'warehouse', x: -31.8, z: 22.5, w: 12.4, d: 31, floors: 2, h: 9.2 },
  { id: 'bank', x: 14.7, z: 22.5, w: 15.4, d: 31, floors: 3, h: 9.8 },
  { id: 'exchange', x: 31.8, z: 22.5, w: 12.4, d: 31, floors: 3, h: 12.6 },
];

/** The two service alleys: x extents; each runs the full block either side. */
export const ALLEYS = [
  { x0: -25.6, x1: -22.4 },
  { x0: 22.4, x1: 25.6 },
];

/**
 * Where the block meets the world: every street and alley mouth on the map
 * edge, `{ u, side, w }` like Wilmot's gates. All are sealed — by hoarding,
 * barriers and dumpsters — and the selftest walks every one.
 */
export const MOUTHS = [
  { u: 0, side: 'n', w: 14 },
  { u: 0, side: 's', w: 14 },
  { u: 0, side: 'e', w: 14 },
  { u: 0, side: 'w', w: 14 },
  { u: -24, side: 'n', w: 3.2 },
  { u: 24, side: 'n', w: 3.2 },
  { u: -24, side: 's', w: 3.2 },
  { u: 24, side: 's', w: 3.2 },
];

/** Every bent column foot on the street, `[x, z]` — occupancy and the build. */
export const COLUMNS = (() => {
  const out = [];
  for (const z of EL.bentsNS) out.push([-EL.colX, z], [EL.colX, z]);
  for (const x of EL.bentsEW) out.push([x, -EL.colX], [x, EL.colX]);
  // the curve's own legs, under the deck edges over the intersection
  out.push([1.4, -5.3], [5.3, -1.4]);
  // platform legs on the south sidewalk
  out.push([26, 5.9], [33, 5.9]);
  return out;
})();

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that
 * looks at the corner the tracks turn over, so everyone comes in reading the
 * landmark.
 *
 * INDEX 0 is the boot/dev spawn: the south street, looking north up the
 * whole canyon at the curve, the bents and the stalled train.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - 4, z - -4) + turn;
export const LOOP_SPAWNS = [
  [2, 26, 0, 'south-street'], // FROZEN — boot spawn
  [-3.4, 29.5, 0.2, 'south-street'],
  [5.6, 31.5, -0.2, 'south-street'],
  [-1.2, 22.5, 0.1, 'south-street'],

  [-26.5, -2, 0.3, 'west-street'],
  [-30.5, 2.4, 0.2, 'west-street'],
  [-20.5, 1.8, 0.1, 'west-street'],
  [-33.5, -1.6, 0.3, 'west-street'],

  [-5.8, -20, -0.2, 'north-street'],
  [5.8, -25.5, 0.3, 'north-street'],
  [-5.9, -31.5, -0.1, 'north-street'],
  [5.9, -13.5, 0.2, 'north-street'],

  [26.5, -5.8, -0.4, 'east-street'],
  [33.5, -5.7, -0.4, 'east-street'],
  [30.5, 1.8, -0.5, 'east-street'],

  [23, 5.8, -0.4, 'station'],
  [31, 5.7, -0.5, 'station'],
  [34.6, 5.8, -0.5, 'station'],

  [10.2, -5.8, -0.1, 'theatre'],
  [16.5, -5.7, -0.3, 'theatre'],

  [-9.2, -5.8, 0.1, 'diner'],
  [-5.8, -9.8, 0, 'diner'],

  [-24, -20, 0.2, 'alley-northwest'],
  [-24, -30.5, 0.1, 'alley-northwest'],
  [-24, 20, 0.4, 'alley-southwest'],
  [-24, 30.5, 0.4, 'alley-southwest'],
  [24, -20, -0.4, 'alley-northeast'],
  [24, -30.5, -0.3, 'alley-northeast'],
  [24, 20, -0.5, 'alley-southeast'],
  [24, 30.5, -0.5, 'alley-southeast'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  for (const [x, z] of COLUMNS) out.push([x - 0.4, z - 0.4, x + 0.4, z + 0.4]);
  // the station stair and the scaffold stair, ground to landing
  const st = STATION.stair;
  out.push([st.x0 - 0.2, st.z0 - 0.2, st.x1 + 0.2, st.z1 + 0.2]);
  out.push([SCAFFOLD.x - 0.85, SCAFFOLD.topZ - 1.6, SCAFFOLD.x + 0.85, SCAFFOLD.footZ + 0.3]);
  // the sealed mouths: hoarding lines and the barrier rows in front of them
  out.push([-7.2, -LOOP.half, 7.2, -LOOP.half + 1.4]); // north hoarding
  out.push([-7.2, LOOP.half - 1.4, 7.2, LOOP.half]); // south hoarding
  out.push([-LOOP.half, -7.2, -LOOP.half + 1.4, 7.2]); // west hoarding
  out.push([LOOP.half - 1.4, -7.2, LOOP.half, 7.2]); // east hoarding
  for (const a of ALLEYS) {
    out.push([a.x0 - 0.2, -LOOP.half, a.x1 + 0.2, -LOOP.half + 2.2]);
    out.push([a.x0 - 0.2, LOOP.half - 2.2, a.x1 + 0.2, LOOP.half]);
  }
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the street. */
export function inSolidLoop(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/** Can a character stand here? Inside the block and off every footprint. */
export function standableAtLoop(x, z, margin = 0.55) {
  if (Math.abs(x) > LOOP.half - 0.6 - margin) return false;
  if (Math.abs(z) > LOOP.half - 0.6 - margin) return false;
  return !inSolidLoop(x, z, margin);
}

/** True where a character can stand outdoors — the minimap's floor. */
export function isOpenLoop(x, z, m = 0.3) {
  if (Math.abs(x) > LOOP.half - 0.4 || Math.abs(z) > LOOP.half - 0.4) return false;
  return !inSolidLoop(x, z, m);
}

/** Inside the asphalt cross of the two roadways? */
function onRoad(x, z) {
  return (Math.abs(x) < LOOP.road && Math.abs(z) < LOOP.half) ||
    (Math.abs(z) < LOOP.road && Math.abs(x) < LOOP.half);
}

/**
 * Analytic floor height. The roadway sits a curb below the sidewalks and
 * alleys; both are flat bar a just-perceptible crown and wear. Outside the
 * block the backdrop city is flat — the skyline masses own the horizon.
 */
export function groundYLoop(x, z) {
  if (Math.abs(x) > LOOP.half || Math.abs(z) > LOOP.half) return LOOP.roadY;
  if (onRoad(x, z)) {
    // a shallow crown falling to the gutters on the nearer street
    const d = Math.min(Math.abs(x), Math.abs(z));
    return LOOP.roadY + Math.max(0, 1 - d / LOOP.road) * 0.035 + (fbm3(x * 0.2, 1.7, z * 0.2, 2) - 0.5) * 0.02;
  }
  return LOOP.walkY;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* geometry helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

const H = Math.PI / 2;
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
 * spans/sill/lintel scheme Rust and Wilmot use, so a doorway is a genuine
 * hole in the collision hull. `holes` are `[{ u, w, y, h }]` wall-local.
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

/**
 * Which rooms have a light on.
 *
 * A block at half past eleven is neither uniformly dark nor uniformly lit: a
 * scatter of windows are up, and the scatter has to be STABLE — the same rooms
 * on the same facade every build, or a map rebuild would reshuffle the whole
 * street. So it comes off `hash3` of the opening's own position rather than out
 * of the level rng: nothing to thread through six build functions, and not one
 * draw taken from the stream every prop on the map is placed from.
 *
 * `share` is the fraction lit. A fifth is what a photograph of a real block at
 * this hour shows — enough that no facade is a solid black slab, few enough
 * that a lit window still reads as somebody being in.
 */
const LIT_SHARE = 0.2;
function litRoom(x, y, z, share = LIT_SHARE) {
  return share > 0 && hash3(x, y, z) < share;
}

/**
 * A window in an opening: glass catching the sky, a room plane behind it, and
 * a painted frame. This is the whole upper-storey vocabulary — nothing above
 * the ground floor is enterable, and a lit grey rectangle is the one thing
 * that would give that away.
 *
 * `opts.lit` swaps that dark room for `window_glow`: somebody upstairs left a
 * light on. It is emissive only — no punctual light, no shader permutation,
 * nothing added to the light budget — which is what makes it affordable by the
 * dozen. At night it is most of what stops a facade being a black rectangle
 * with a cornice on top; see `litRoom` for which rooms get one.
 */
function darkWindow(A, cx, cz, ry, y0, o, opts = {}) {
  alongWall(cx, cz, ry, o.u, _wp);
  const t = opts.t ?? 0.32;
  const oy = o.y ?? 0;
  const py = ry + (opts.flip ? Math.PI : 0);
  // sill and lintel
  A.add(opts.trim ?? 'stone_grey', BOX(A), LL(IDENT, _wp[0], y0 + oy - 0.05, _wp[1], ry, o.w + 0.24, 0.1, t + 0.16), {
    masks: [0.65, 0.35, 0.15],
  });
  A.add(opts.trim ?? 'stone_grey', BOX(A), LL(IDENT, _wp[0], y0 + oy + o.h + 0.05, _wp[1], ry, o.w + 0.24, 0.1, t + 0.1), {
    masks: [0.6, 0.35, 0.15],
  });
  // the room behind the glass — dark, or with a light left on — then the glass
  // over it and one mullion
  A.add(
    opts.lit ? 'window_glow' : 'window_void',
    PANE(A),
    LL(IDENT, _wp[0], y0 + oy + o.h / 2, _wp[1], py, o.w - 0.04, o.h - 0.04, 1),
    opts.lit ? { masks: [0.2, 0.4, 0.1] } : null
  );
  A.add('window_glass', PANE(A), LL(IDENT, _wp[0], y0 + oy + o.h / 2, _wp[1], py, o.w - 0.08, o.h - 0.08, 1));
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, _wp[0], y0 + oy + o.h / 2, _wp[1], ry, 0.06, o.h, 0.06), {
    masks: [0.7, 0.3, 0.05],
  });
  if (o.w > 1.9) {
    // a Chicago window: wide centre light, two narrow side mullions
    for (const s of [-1, 1]) {
      alongWall(cx, cz, ry, o.u + s * o.w * 0.28, _wp);
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, _wp[0], y0 + oy + o.h / 2, _wp[1], ry, 0.06, o.h, 0.06), {
        masks: [0.7, 0.3, 0.05],
      });
    }
  }
}

/** A horizontal slab with collision: floors, decks, platform boards. */
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

/** A flight of steel steps climbing in the direction `ry` points. */
function flight(A, x, y, z, ry, top, w = 1.3, opts = {}) {
  const rise = opts.rise ?? 0.275;
  const run = opts.run ?? 0.3;
  const steps = Math.max(1, Math.round((top - y) / rise));
  stairRun(A, panel(x, y, z, ry), 0, 0, 0, w, steps, (top - y) / steps, run, {
    key: opts.key ?? 'steel_grate',
    railing: opts.railing ?? true,
    stringer: opts.stringer !== false,
  });
  const len = steps * run;
  return { top, len, x: x + Math.sin(ry) * len, z: z + Math.cos(ry) * len };
}

/** A structural member between two points — bracing, canopy posts, rafters. */
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
 * One straight run of handrail from (x0,z0) to (x1,z1) at deck height `y`,
 * with ONE collision slab — same reasoning as Rust's `railRun`.
 */
function railRun(A, x0, z0, x1, z1, y, h = 1.04) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.15) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  for (const yy of [y + h, y + h * 0.52]) {
    A.add('el_steel', BOX_THIN(A), LL(IDENT, mx, yy, mz, ry, len, 0.055, 0.055), { masks: [0.85, 0.45, 0.05] });
  }
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    A.add('el_steel', BOX_THIN(A),
      LL(IDENT, x0 + ((x1 - x0) * i) / n, y + h / 2, z0 + ((z1 - z0) * i) / n, 0, 0.06, h, 0.06),
      { masks: [0.85, 0.5, 0.1] });
  }
  A.box('metal', mx, y + h * 0.55, mz, len, h * 1.1, 0.1, ry);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the streets                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildStreets(A, rng) {
  // ---------------------------------------------------------- the asphalt --
  // Three planes cover the roadway cross without overlapping at the
  // intersection; a flat collision box under each so the controller never
  // feels the crown vertices.
  const R = LOOP.road;
  const HF = LOOP.half;
  const roadPiece = (cx, cz, w, d) => {
    const g = new THREE.PlaneGeometry(w, d, Math.max(2, Math.round(w / 2.5)), Math.max(2, Math.round(d / 2.5)));
    g.rotateX(-Math.PI / 2);
    const pa = g.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i) + cx;
      const z = pa.getZ(i) + cz;
      pa.setY(i, groundYLoop(x, z) - 0.02 - LOOP.roadY);
    }
    g.computeVertexNormals();
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      out[0] = 0.15 + fbm3((x + cx) * 0.35, 2.2, (z + cz) * 0.35, 2) * 0.3;
      out[1] = 0.25 + fbm3((x + cx) * 0.5, 6.1, (z + cz) * 0.5, 2) * 0.3;
    });
    // collide the real crowned triangles, so ADS never sinks into the camber
    A.add('asphalt', g, LL(IDENT, cx, LOOP.roadY, cz));
    A.collideGeo('concrete', g, LL(IDENT, cx, LOOP.roadY + 0.02, cz));
    g.dispose();
  };
  roadPiece(0, 0, R * 2, HF * 2); // the north-south street, full length
  roadPiece(-(HF + R) / 2, 0, HF - R, R * 2); // the east-west arms
  roadPiece((HF + R) / 2, 0, HF - R, R * 2);

  // Tyre-polished driving lines down each arm, darker than the field.
  for (const [cx, cz, ry] of [
    [-1.9, 20, 0], [1.9, 20, 0], [-1.9, -20, 0], [1.9, -20, 0],
    [-22, -1.9, H], [-22, 1.9, H], [22, -1.9, H], [22, 1.9, H],
  ]) {
    const g = new THREE.PlaneGeometry(30, 1.5, 8, 1);
    g.rotateX(-Math.PI / 2);
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      out[0] = 0.3 + fbm3(x * 0.4, 3.7, z * 0.4, 2) * 0.3;
      out[1] = 0.3;
    });
    A.addOnce('road_rut', g, LL(IDENT, cx, LOOP.roadY + 0.055, cz, ry));
  }

  // ------------------------------------------------------- the sidewalks --
  // Raised slabs with a visible curb face, and collision that IS the curb.
  const W = LOOP.walk;
  const slab = (x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    A.add('concrete', BOX(A), LL(IDENT, cx, LOOP.walkY - 0.14, cz, 0, x1 - x0, 0.28, z1 - z0), {
      masks: [0.45, 0.4, 0.25],
    });
    A.box('concrete', cx, LOOP.walkY - 0.14, cz, x1 - x0, 0.28, z1 - z0);
  };
  // the four sidewalk bands of the north-south street (they own the corners)
  slab(-W, -HF, -R, -R);
  slab(-W, R, -R, HF);
  slab(R, -HF, W, -R);
  slab(R, R, W, HF);
  // the east-west street's bands, between the corner bands and the map edge
  slab(-HF, -W, -W, -R);
  slab(W, -W, HF, -R);
  slab(-HF, R, -W, W);
  slab(W, R, HF, W);
  // alley floors: poured concrete aprons the full block either side
  for (const a of ALLEYS) {
    slab(a.x0, -HF, a.x1, -W);
    slab(a.x0, W, a.x1, HF);
  }
  // curb stones: a slightly proud darker band along every roadway edge
  const curb = (x0, z0, x1, z1) => {
    const ry = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : H;
    const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    A.add('concrete_dark', BOX_THIN(A), LL(IDENT, (x0 + x1) / 2, LOOP.walkY + 0.005, (z0 + z1) / 2, ry, len, 0.05, 0.28), {
      masks: [0.7, 0.4, 0.2],
    });
  };
  curb(-R - 0.1, -HF, -R - 0.1, -R - 0.1);
  curb(-R - 0.1, R + 0.1, -R - 0.1, HF);
  curb(R + 0.1, -HF, R + 0.1, -R - 0.1);
  curb(R + 0.1, R + 0.1, R + 0.1, HF);
  curb(-HF, -R - 0.1, -R - 0.1, -R - 0.1);
  curb(R + 0.1, -R - 0.1, HF, -R - 0.1);
  curb(-HF, R + 0.1, -R - 0.1, R + 0.1);
  curb(R + 0.1, R + 0.1, HF, R + 0.1);

  // ----------------------------------------------------------- road paint --
  const Y = LOOP.roadY + 0.062;
  const line = (key, cx, cz, ry, len, w) =>
    A.add(key, BOX_THIN(A), LL(IDENT, cx, Y, cz, ry, len, 0.012, w), { masks: [0.55, 0.25, 0] });
  // dashed yellow centrelines down each arm
  for (let u = 9.5; u < HF - 3; u += 6) {
    line('paint_yellow', 0, u + 1, 0, 0.14, 2.4);
    line('paint_yellow', 0, -u - 1, 0, 0.14, 2.4);
    line('paint_yellow', u + 1, 0, 0, 2.4, 0.14);
    line('paint_yellow', -u - 1, 0, 0, 2.4, 0.14);
  }
  // zebra crosswalks across all four approaches
  for (const [cx, cz, ry] of [[0, -6.2, 0], [0, 6.2, 0], [-6.2, 0, H], [6.2, 0, H]]) {
    for (let i = -3; i <= 3; i++) {
      alongWall(cx, cz, ry, i * 1.15, _wp);
      line('plaster_white', _wp[0], _wp[1], ry, 0.55, 2.2);
    }
  }
  // stop bars behind each crosswalk
  line('plaster_white', 2.3, 8.1, 0, 4.2, 0.4);
  line('plaster_white', -2.3, -8.1, 0, 4.2, 0.4);
  line('plaster_white', -8.1, 2.3, 0, 0.4, 4.2);
  line('plaster_white', 8.1, -2.3, 0, 0.4, 4.2);

  // ------------------------------------------------------ steam and stain --
  // Oil where traffic queues at the light, gum-dark patches on the walks.
  for (let i = 0; i < 14; i++) {
    const arm = i % 4;
    const u = rng.range(9, HF - 4);
    const lat = rng.range(-2.6, 2.6);
    const x = arm === 0 ? lat : arm === 1 ? lat : arm === 2 ? u : -u;
    const z = arm === 0 ? u : arm === 1 ? -u : lat, s = rng.range(0.5, 1.6);
    A.addOnce('road_rut', patchGeometry(rng, s, { lobes: 9, wobble: 0.5 }),
      LL(IDENT, x, LOOP.roadY + 0.05, z, rng.float() * 6.283), { masks: [0.06, 0.9, 0.5] });
  }
  // a manhole lid at the middle of the intersection
  A.addOnce('metal_dark', tubeY(0.5, 0.035, { radial: 14 }), LL(IDENT, 1.8, LOOP.roadY + 0.05, 1.2), {
    masks: [0.75, 0.55, 0.3],
  });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the elevated structure                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

/** One bent: two columns off the street centreline and the cross girder. */
function bent(A, cx, cz, ry) {
  const y = EL.deckY - EL.girderD;
  for (const s of [-1, 1]) {
    alongWall(cx, cz, ry, s * EL.colX, _wp);
    const [x, z] = _wp;
    // base plate, riveted box column, cap
    A.add('concrete_dark', BOX(A), LL(IDENT, x, 0.14, z, ry, 0.85, 0.28, 0.85), { masks: [0.6, 0.6, 0.4] });
    A.add('el_steel', BOX(A), LL(IDENT, x, y / 2 + 0.2, z, ry, 0.42, y - 0.4, 0.42), { masks: [0.75, 0.5, 0.3] });
    A.add('el_steel', BOX(A), LL(IDENT, x, y - 0.14, z, ry, 0.62, 0.24, 0.62), { masks: [0.8, 0.45, 0.2] });
    A.box('metal', x, y / 2, z, 0.5, y, 0.5);
    // knee braces up to the cross girder
    alongWall(cx, cz, ry, s * (EL.colX - 1.1), _wp);
    strut(A, 'el_steel', x, y - 1.3, z, _wp[0], y - 0.1, _wp[1], 0.09, [0.85, 0.45, 0.15]);
  }
  // the cross girder carrying the deck
  alongWall(cx, cz, ry, -EL.colX, _wp);
  const a = [_wp[0], _wp[1]];
  alongWall(cx, cz, ry, EL.colX, _wp);
  A.add('el_steel', BOX(A), LL(IDENT, (a[0] + _wp[0]) / 2, y + 0.32, (a[1] + _wp[1]) / 2, ry, EL.colX * 2 + 0.8, 0.6, 0.36), {
    masks: [0.7, 0.5, 0.3],
  });
}

/**
 * One straight span of track deck between (x0,z0) and (x1,z1): deck slab,
 * plate girders below both edges, guard girders above (`guards` is a string
 * of `a` and/or `b` — the -lat and +lat edge), ties and rails on top.
 */
function trackSpan(A, rng, x0, z0, x1, z1, opts = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return;
  const ry = Math.atan2(-dz, dx);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hw = EL.deckHalf;
  const y = EL.deckY;
  const over = opts.over ?? 0.35; // chord overlap so the curve has no slivers

  // deck slab + collision
  A.add('el_steel', BOX(A), LL(IDENT, cx, y - 0.14, cz, ry, len + over, 0.28, hw * 2), {
    masks: [0.55, 0.6, 0.4],
  });
  A.box('metal', cx, y - 0.14, cz, len + over, 0.28, hw * 2, ry);

  // (u, l) -> level space: u along the run from its midpoint, l lateral
  const lat = (u, l) => [cx + (dx / len) * u + (-dz / len) * l, cz + (dz / len) * u + (dx / len) * l];

  for (const [side, s] of [['a', -1], ['b', 1]]) {
    const [ex, ez] = lat(0, s * (hw - 0.15));
    // the deep plate girder under the deck edge
    A.add('el_steel', BOX(A), LL(IDENT, ex, y - EL.girderD / 2 - 0.1, ez, ry, len + over, EL.girderD, 0.3), {
      masks: [0.7, 0.55, 0.35],
    });
    // rivet lines: two thin flanges top and bottom of the web
    for (const yy of [y - 0.34, y - EL.girderD + 0.06]) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, ex, yy, ez, ry, len + over, 0.09, 0.4), { masks: [0.9, 0.5, 0.2] });
    }
    if ((opts.guards ?? 'ab').includes(side)) {
      // the waist-high guard girder — the elevated lane's cover
      A.add('el_steel', BOX(A), LL(IDENT, ex, y + EL.girderH / 2, ez, ry, len + over, EL.girderH, 0.24), {
        masks: [0.65, 0.5, 0.3],
      });
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, ex, y + EL.girderH + 0.04, ez, ry, len + over, 0.09, 0.34), {
        masks: [0.9, 0.45, 0.15],
      });
      A.box('metal', ex, y + EL.girderH / 2, ez, len + over, EL.girderH + 0.08, 0.26, ry);
    }
  }

  // ties and rails for both tracks
  if (opts.track !== false) {
    const nt = Math.max(1, Math.floor(len / TIE.gap));
    for (let i = 0; i < nt; i++) {
      const u = -len / 2 + (i + 0.5) * (len / nt);
      for (const tz of [-1.65, 1.65]) {
        const [tx, tzz] = lat(u, tz);
        // ties lie ACROSS the run — their long axis is the run's lateral
        A.put('tie', tx, y + 0.005, tzz, ry + H, 1, [0.6 + rng.float() * 0.4, 0.5, 0.35]);
      }
    }
    for (const tz of [-1.65, 1.65]) {
      for (const roff of [-0.72, 0.72]) {
        const [rx, rz] = lat(0, tz + roff);
        A.add('metal_dark', BOX_THIN(A), LL(IDENT, rx, y + TIE.h + 0.07, rz, ry, len + over * 0.5, 0.14, 0.08), {
          masks: [0.95, 0.3, 0.05],
        });
      }
    }
  }
}

function buildEl(A, rng) {
  const y = EL.deckY;

  // ------------------------------------------------------------- the runs --
  // North run, in three spans so the east guard girder has a real gap where
  // the scaffold landing meets the deck. Heading south (dz > 0) the -l side
  // is east, which is side 'a'; the middle span keeps only the west guard.
  // The extra 8 m past the map edge is backdrop — the line does not end at
  // the horizon.
  trackSpan(A, rng, 0, -LOOP.half - 8, 0, -35.8, {});
  trackSpan(A, rng, 0, -35.8, 0, -33.3, { guards: 'b' });
  trackSpan(A, rng, 0, -33.3, 0, EL.curve[0][1], {});
  // East run in two spans: girder on both edges until the platform starts,
  // then only on the north edge so the platform is flush with the track bed.
  trackSpan(A, rng, EL.curve[3][0], 0, STATION.x0, 0, {});
  trackSpan(A, rng, STATION.x0, 0, LOOP.half + 8, 0, { guards: 'a' });
  // The curve, as chords. The overlap has to beat hw·tan(15°) ≈ 0.94 m or
  // the outer corners of adjacent chords open a sliver over the street.
  for (let i = 0; i < EL.curve.length - 1; i++) {
    const [ax, az] = EL.curve[i];
    const [bx, bz] = EL.curve[i + 1];
    trackSpan(A, rng, ax, az, bx, bz, { over: 2.0 });
  }

  // ------------------------------------------------------------ the bents --
  for (const z of EL.bentsNS) bent(A, 0, z, 0);
  for (const x of EL.bentsEW) bent(A, x, 0, H);
  // the curve's legs: single columns under the deck edges of the middle chord
  for (const [x, z] of [[1.4, -5.3], [5.3, -1.4]]) {
    A.add('concrete_dark', BOX(A), LL(IDENT, x, 0.14, z, 0, 0.85, 0.28, 0.85), { masks: [0.6, 0.6, 0.4] });
    A.add('el_steel', BOX(A), LL(IDENT, x, (y - 0.4) / 2 + 0.2, z, 0.6, 0.42, y - 0.8, 0.42), {
      masks: [0.75, 0.5, 0.3],
    });
    A.box('metal', x, (y - 0.4) / 2, z, 0.5, y - 0.4, 0.5);
  }
  // platform legs on the south sidewalk
  for (const [x, z] of [[26, 5.9], [33, 5.9]]) {
    A.add('el_steel', BOX(A), LL(IDENT, x, (y - 0.3) / 2, z, H, 0.34, y - 0.3, 0.34), { masks: [0.75, 0.5, 0.3] });
    A.box('metal', x, (y - 0.3) / 2, z, 0.4, y - 0.3, 0.4);
  }

  // ------------------------------------------------- the scaffold access --
  // A construction stair against the north hoarding: the second way up. The
  // flight climbs north beside the deck and a landing bridges west onto it,
  // through the gap left in the east guard girder above.
  const S = SCAFFOLD;
  const f = flight(A, S.x, LOOP.walkY, S.footZ, Math.PI, y, S.w, { key: 'steel_grate' });
  const l0 = f.z + 0.05; // south edge of the landing (where the stair tops out)
  const l1 = -35.5; // north edge
  deck(A, 'steel_grate', 4.55, y, (l0 + l1) / 2, 2.7, l0 - l1, { t: 0.16 });
  // rails: east edge full, north edge full, south edge only west of the stair
  railRun(A, 5.85, l0, 5.85, l1, y);
  railRun(A, 3.4, l1, 5.85, l1, y);
  railRun(A, 3.3, l0, S.x - S.w / 2 - 0.05, l0, y);
  // scaffold poles carrying the landing
  for (const [px, pz] of [[5.75, l1 + 0.15], [5.75, l0 - 0.15], [3.7, l1 + 0.15]]) {
    strut(A, 'steel', px, 0.1, pz, px, y - 0.1, pz, 0.09, [0.8, 0.4, 0.2]);
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the station                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildStation(A, rng) {
  const y = EL.deckY;
  const P = STATION;
  const cx = (P.x0 + P.x1) / 2;
  const cz = (P.z0 + P.z1) / 2;
  const w = P.x1 - P.x0;
  const d = P.z1 - P.z0;

  // the wooden platform deck, flush with the track bed
  deck(A, 'floor_wood', cx, y, cz, w, d, { t: 0.2, masks: [0.5, 0.5, 0.35] });
  // plank lines: thin darker strips so the boards read at range
  for (let i = 0; i < 5; i++) {
    A.add('wood_dark', BOX_THIN(A), LL(IDENT, cx, y + 0.005, P.z0 + 0.3 + i * 0.55, 0, w - 0.2, 0.012, 0.05), {
      masks: [0.4, 0.5, 0.3],
    });
  }
  // the platform edge board and the rubbing strip over the street
  A.add('paint_yellow', BOX_THIN(A), LL(IDENT, cx, y + 0.01, P.z0 + 0.18, 0, w, 0.02, 0.3), { masks: [0.6, 0.3, 0.1] });
  A.add('el_steel', BOX_THIN(A), LL(IDENT, cx, y - 0.32, P.z1 - 0.05, 0, w, 0.5, 0.12), { masks: [0.7, 0.5, 0.3] });

  // guard rails: the full south (street) edge, the east end, and the north
  // stub of the west edge — the rest of the west edge is the stair mouth
  railRun(A, P.x0 + 0.6, P.z1 - 0.12, P.x1 - 0.05, P.z1 - 0.12, y);
  railRun(A, P.x1 - 0.05, P.z0 + 0.1, P.x1 - 0.05, P.z1 - 0.12, y);
  railRun(A, P.x0 + 0.06, P.z0 + 0.1, P.x0 + 0.06, P.z0 + 1.45, y);

  // ------------------------------------------------------------ the stair --
  // One long flight up from the intersection's sidewalk, climbing east along
  // the bank's face to land on the platform's west edge.
  const st = P.stair;
  // the foot is measured BACK from the platform edge so the top step lands
  // exactly on it — same rule as the Wilmot manor stair
  const foot = P.x0 - flightLength(LOOP.walkY, y);
  flight(A, foot, LOOP.walkY, 5.7, H, y, 1.35, { key: 'steel_grate' });
  // newel signage at the foot: the station board on two posts
  for (const pz of [st.z0 + 0.15, st.z1 - 0.15]) {
    strut(A, 'el_steel', foot - 0.4, 0.18, pz, foot - 0.4, 3.2, pz, 0.08, [0.8, 0.45, 0.2]);
  }
  A.add('sign_red', BOX(A), LL(IDENT, foot - 0.4, 2.9, (st.z0 + st.z1) / 2, H, 1.7, 0.5, 0.06), {
    masks: [0.6, 0.35, 0.1],
  });
  A.add('plaster_white', BOX_THIN(A), LL(IDENT, foot - 0.44, 2.9, (st.z0 + st.z1) / 2, H, 1.5, 0.32, 0.03), {
    masks: [0.7, 0.2, 0],
  });

  // ----------------------------------------------------------- the canopy --
  // Hipped tin canopy down the middle of the platform on cast columns.
  const c0 = P.x0 + 1.8;
  const c1 = P.x1 - 3.6;
  const apex = y + 2.55;
  const eave = y + 2.1;
  for (let x = c0; x <= c1; x += 4.4) {
    strut(A, 'el_steel', x, y, cz, x, eave, cz, 0.11, [0.8, 0.45, 0.2]);
    A.box('metal', x, y + 1.1, cz, 0.16, 2.2, 0.16);
    // spandrel brackets
    strut(A, 'el_steel', x, eave - 0.5, cz, x, eave - 0.05, cz - 1.1, 0.06, [0.85, 0.4, 0.1]);
    strut(A, 'el_steel', x, eave - 0.5, cz, x, eave - 0.05, cz + 1.1, 0.06, [0.85, 0.4, 0.1]);
  }
  const clen = c1 - c0 + 3;
  const slope = Math.hypot(1.7, apex - eave);
  const pitch = Math.atan2(apex - eave, 1.7);
  for (const s of [-1, 1]) {
    A.add('corrugated_fine', BOX_THIN(A),
      LL(IDENT, (c0 + c1) / 2, (apex + eave) / 2, cz + s * 0.85, 0, clen, 0.06, slope, s * pitch),
      { masks: [0.7, 0.45, 0.25] });
  }
  A.add('el_steel', BOX_THIN(A), LL(IDENT, (c0 + c1) / 2, apex + 0.03, cz, 0, clen, 0.08, 0.2), {
    masks: [0.8, 0.4, 0.15],
  });

  // station name board hanging under the canopy, and two benches
  A.add('metal_green', BOX(A), LL(IDENT, cx - 2, y + 1.9, cz, 0, 2.2, 0.44, 0.08), { masks: [0.6, 0.35, 0.1] });
  A.add('plaster_white', BOX_THIN(A), LL(IDENT, cx - 2, y + 1.9, cz + 0.055, 0, 2.0, 0.28, 0.02), {
    masks: [0.7, 0.2, 0],
  });
  A.put('bench_cta', cx - 5.5, y, cz + 0.6, 0, 1);
  A.put('bench_cta', cx + 3.5, y, cz + 0.6, 0.04, 1);
  A.put('litter_basket', P.x0 + 1.2, y, cz + 0.7, 0.4, 1);

  // Platform lighting: two fittings hung off the canopy purlin rather than one,
  // because the platform is 16 m long and a single lamp in the middle of it
  // leaves both ends — the stair mouth and the far end of the train — in the
  // dark. The strip lenses are emissive so the fittings read as the source from
  // any angle; the punctual lights are what actually put light on the boards.
  for (const lx of [cx - 4.5, cx + 4.5]) {
    A.add('emissive_warm', BOX_THIN(A), LL(IDENT, lx, y + 2.02, cz, 0, 1.1, 0.07, 0.24));
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, lx, y + 2.09, cz, 0, 1.2, 0.1, 0.32), { masks: [0.8, 0.4, 0.1] });
    A.lampAnchors.push({ x: lx, y: y + 1.95, z: cz });
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the train                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/** The stalled car: two-tone steel, a lit window band, doors, bogies. */
function buildTrain(A, rng) {
  const T = TRAIN;
  const cx = (T.x0 + T.x1) / 2;
  const len = T.x1 - T.x0;
  const y0 = EL.deckY + T.floor;
  const beltY = y0 + 1.05; // bottom of the window band
  const bandH = 1.05;

  // body: skirt panel, green flank below the belt, window band, roof
  A.add('metal_green', BOX(A), LL(IDENT, cx, y0 + 0.525, T.z, 0, len, 1.05, T.w), { masks: [0.55, 0.4, 0.25] });
  A.add('steel', BOX(A), LL(IDENT, cx, beltY + bandH + 0.35, T.z, 0, len, 0.7, T.w), { masks: [0.6, 0.4, 0.25] });
  // The window band: a lit saloon with glass over it on both flanks. A stalled
  // car with its interior lights still on is the brightest thing on the deck
  // and the reason the platform is legible at all from the street below — a
  // dark car up there at this hour would just be a long black mass.
  for (const s of [-1, 1]) {
    A.add('window_glow', PANE(A), LL(IDENT, cx, beltY + bandH / 2, T.z + s * (T.w / 2 + 0.01), s > 0 ? 0 : Math.PI, len - 0.5, bandH - 0.1, 1), {
      masks: [0.3, 0.35, 0.1],
    });
    A.add('window_glass', PANE(A), LL(IDENT, cx, beltY + bandH / 2, T.z + s * (T.w / 2 + 0.02), s > 0 ? 0 : Math.PI, len - 0.6, bandH - 0.16, 1));
    // door leaves: paired panels that interrupt the band
    for (const dx of [-len * 0.32, len * 0.32]) {
      A.add('metal_green', BOX(A), LL(IDENT, cx + dx, y0 + 1.35, T.z + s * (T.w / 2 - 0.02), 0, 1.5, 2.7, 0.06), {
        masks: [0.6, 0.45, 0.25],
      });
      A.add('window_glow', PANE(A), LL(IDENT, cx + dx, y0 + 2.0, T.z + s * (T.w / 2 + 0.045), s > 0 ? 0 : Math.PI, 1.1, 0.8, 1), {
        masks: [0.3, 0.35, 0.1],
      });
    }
    // belt rail
    A.add('plaster_white', BOX_THIN(A), LL(IDENT, cx, beltY - 0.03, T.z + s * (T.w / 2 + 0.01), 0, len, 0.09, 0.03), {
      masks: [0.65, 0.25, 0.05],
    });
  }
  // ends: blunt cabs with a destination box
  for (const s of [-1, 1]) {
    A.add('metal_green', BOX_SOFT(A), LL(IDENT, cx + s * (len / 2 - 0.1), y0 + 1.5, T.z, 0, 0.5, 3.0, T.w - 0.15), {
      masks: [0.55, 0.45, 0.25],
    });
    A.add('window_void', PANE(A), LL(IDENT, cx + s * (len / 2 + 0.16), y0 + 2.3, T.z, s > 0 ? H : -H, 1.5, 0.7, 1));
  }
  // roof: shallow soft box + vents
  A.add('metal_dark', BOX_SOFT(A), LL(IDENT, cx, y0 + T.h + 0.12, T.z, 0, len - 0.3, 0.3, T.w - 0.5), {
    masks: [0.6, 0.5, 0.3],
  });
  for (let i = 0; i < 4; i++) {
    A.add('metal_dark', BOX(A), LL(IDENT, T.x0 + 2.5 + i * 3.2, y0 + T.h + 0.32, T.z, 0, 0.8, 0.14, 0.7), {
      masks: [0.7, 0.5, 0.2],
    });
  }
  // bogies and underslung gear
  for (const dx of [-len / 2 + 1.9, len / 2 - 1.9]) {
    A.add('metal_dark', BOX(A), LL(IDENT, cx + dx, EL.deckY + 0.42, T.z, 0, 2.2, 0.7, T.w - 0.9), {
      masks: [0.75, 0.6, 0.4],
    });
  }
  A.add('metal_dark', BOX(A), LL(IDENT, cx, EL.deckY + 0.5, T.z, 0, len * 0.45, 0.5, T.w - 1.2), {
    masks: [0.7, 0.6, 0.45],
  });
  // one collision box for the whole car
  A.box('metal', cx, y0 + T.h / 2 + 0.1, T.z, len + 0.4, T.h + 0.6, T.w + 0.1);

  // The saloon's own light, so the car throws onto the platform boards and the
  // canopy underside instead of only glowing at them. One, at the centre: this
  // is a punctual light on a map that budgets them (see WorldSystem._addLights),
  // and the emissive band carries the rest of the read.
  A.interiorLights.push({ x: cx, y: y0 + 1.7, z: T.z });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the blocks                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/** A projecting cornice band with a parapet above — every block wears one. */
function cornice(A, key, s, faces) {
  for (const [cx, cz, ry, len] of faces) {
    A.add(key, BOX(A), LL(IDENT, cx, s.h - 0.75, cz, ry, len + 0.5, 0.34, 0.9), { masks: [0.65, 0.4, 0.2] });
    A.add(key, BOX_THIN(A), LL(IDENT, cx, s.h - 0.52, cz, ry, len + 0.6, 0.12, 1.02), { masks: [0.75, 0.3, 0.1] });
  }
}

/**
 * Upper storeys of a street face: rows of windows between string courses, a
 * fifth of them with a light on. `x0..x1` is the face's wall-local window band.
 */
function upperFace(A, key, cx, cz, ry, len, s, opts = {}) {
  const g0 = opts.g0 ?? 4.4; // top of the ground storey
  const storeys = s.floors - 1;
  const sh = (s.h - 1.1 - g0) / Math.max(1, storeys);
  const t = 0.36;
  const wns = [];
  const n = Math.max(2, Math.floor(len / (opts.pitch ?? 4.4)));
  const margin = opts.margin ?? 2.2;
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + margin + ((len - margin * 2) / Math.max(1, n - 1)) * i;
    wns.push(u);
  }
  for (let f = 0; f < storeys; f++) {
    const y0 = g0 + f * sh;
    const wh = Math.min(1.9, sh - 1.15);
    const holes = wns.map((u) => ({ u, w: opts.winW ?? 2.4, y: sh * 0.32, h: wh }));
    ewall(A, key, cx, cz, ry, len, y0, sh, t, holes, { masks: opts.masks ?? [0.5, 0.45, 0.25] });
    for (const o of holes) {
      // hashed off the opening's own place on the facade, so the pattern of
      // lit rooms is a property of the building rather than of the build order
      alongWall(cx, cz, ry, o.u, _wp);
      const lit = litRoom(_wp[0], y0, _wp[1], opts.litShare);
      darkWindow(A, cx, cz, ry, y0, o, { flip: opts.flip, trim: opts.trim, t, lit });
    }
  }
  // the parapet cap
  ewall(A, key, cx, cz, ry, len, s.h - 1.1, 1.1, t, [], { masks: [0.55, 0.45, 0.25] });
}

/** A blank party/back wall: one mass, cheap, with a painted ghost sign. */
function blankFace(A, key, cx, cz, ry, len, y0, h, opts = {}) {
  ewall(A, key, cx, cz, ry, len, y0, h, 0.36, opts.holes ?? [], { masks: opts.masks ?? [0.45, 0.5, 0.3] });
}

/** Sill, lintel and clear glass over an opening that shows a real interior. */
function clearWindow(A, cx, cz, ry, o, opts = {}) {
  alongWall(cx, cz, ry, o.u, _wp);
  const t = opts.t ?? 0.36;
  const py = ry + (opts.flip ? Math.PI : 0);
  A.add(opts.trim ?? 'stone_grey', BOX(A), LL(IDENT, _wp[0], o.y - 0.05, _wp[1], ry, o.w + 0.24, 0.1, t + 0.16), {
    masks: [0.65, 0.35, 0.15],
  });
  A.add(opts.trim ?? 'stone_grey', BOX(A), LL(IDENT, _wp[0], o.y + o.h + 0.05, _wp[1], ry, o.w + 0.24, 0.1, t + 0.1), {
    masks: [0.6, 0.35, 0.15],
  });
  A.add('window_glass', PANE(A), LL(IDENT, _wp[0], o.y + o.h / 2, _wp[1], py, o.w - 0.06, o.h - 0.06, 1));
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, _wp[0], o.y + o.h / 2, _wp[1], ry, 0.06, o.h, 0.06), {
    masks: [0.7, 0.3, 0.05],
  });
}

/** A shut door leaf filling a fake doorway, with collision. */
function backedDoor(A, cx, cz, ry, u, key = 'wood_dark', h = 2.95) {
  alongWall(cx, cz, ry, u, _wp);
  A.add(key, BOX(A), LL(IDENT, _wp[0], h / 2, _wp[1], ry, 1.25, h, 0.1), { masks: [0.55, 0.45, 0.25] });
  A.box('wood', _wp[0], h / 2, _wp[1], 1.25, h, 0.14, ry);
}

/** The NW block: brick offices over the corner diner — enterable. */
function buildDiner(A, rng) {
  const s = STRUCTURES[0];
  const t = 0.36;
  const ex = s.x + s.w / 2; // east face at x = -7; wall-local +u is -z
  const sz = s.z + s.d / 2; // south face at z = -7; wall-local +u is +x
  const wx = s.x - s.w / 2; // alley face
  const g = 4.4;

  // ground floor. The diner is the corner room (x, z in [-15.5, -7]), so its
  // door and windows sit at NEGATIVE u on the east face (u = -z + s.z).
  ewall(A, 'brick_chicago', ex, s.z, H, s.d, 0, g, t, [
    { u: -14.2, w: 1.4, y: 0, h: 3.0 }, // the diner door, at the corner
    { u: -11, w: 3.4, y: 0.8, h: 2.5 }, // diner window
    { u: -2, w: 3.2, y: 0.8, h: 2.5 }, // shop window (dark)
    { u: 5, w: 3.2, y: 0.8, h: 2.5 }, // shop window (dark)
    { u: 8.9, w: 1.3, y: 0, h: 3.0 }, // lobby door (backed)
  ], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_chicago', s.x, sz, 0, s.w, 0, g, t, [
    { u: 5.2, w: 3.4, y: 0.8, h: 2.5 }, // diner corner window
    { u: -3, w: 3.0, y: 0.8, h: 2.5 }, // shop window (dark)
    { u: -6.6, w: 1.3, y: 0, h: 3.0 }, // shop door (backed)
  ], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_chicago', wx, s.z, H, s.d, 0, g, t, [
    { u: 2, w: 1.2, y: 0, h: 2.5 }, // alley back door (backed)
  ], { masks: [0.45, 0.55, 0.35] });
  ewall(A, 'brick_chicago', s.x, s.z - s.d / 2, 0, s.w, 0, g, t, [], { masks: [0.45, 0.5, 0.3] });

  // stone storefront base and the fascia band over the shopfronts
  for (const [cx, cz, ry, len] of [[ex, s.z, H, s.d], [s.x, sz, 0, s.w]]) {
    A.add('stone_grey', BOX_THIN(A), LL(IDENT, cx, 0.4, cz, ry, len + 0.1, 0.8, t + 0.1), { masks: [0.6, 0.45, 0.25] });
    A.add('stone_grey', BOX_THIN(A), LL(IDENT, cx, 3.7, cz, ry, len + 0.14, 0.5, t + 0.14), { masks: [0.7, 0.35, 0.15] });
  }
  // the diner's own windows are clear — a lit room behind real glass; the
  // rest of the ground floor is dark shopfronts and backed doors
  clearWindow(A, ex, s.z, H, { u: -11, w: 3.4, y: 0.8, h: 2.5 }, { t });
  clearWindow(A, s.x, sz, 0, { u: 5.2, w: 3.4, y: 0.8, h: 2.5 }, { t });
  darkWindow(A, ex, s.z, H, 0, { u: -2, w: 3.2, y: 0.8, h: 2.5 }, { trim: 'stone_grey', t });
  darkWindow(A, ex, s.z, H, 0, { u: 5, w: 3.2, y: 0.8, h: 2.5 }, { trim: 'stone_grey', t });
  darkWindow(A, s.x, sz, 0, 0, { u: -3, w: 3.0, y: 0.8, h: 2.5 }, { trim: 'stone_grey', t });
  backedDoor(A, ex, s.z, H, 8.9);
  backedDoor(A, s.x, sz, 0, -6.6);
  backedDoor(A, wx, s.z, H, 2);

  // ------------------------------------------------------------ interior --
  // The diner: the corner room, x in [-15.5, -7], z in [-15.5, -7].
  const ix = -11.25; // room centre
  const iz = -11.25;
  deck(A, 'tile_floor', ix, LOOP.walkY + 0.1, iz, 8.5, 8.5, { t: 0.12, masks: [0.5, 0.45, 0.3] });
  deck(A, 'plaster_cream', ix, 3.6, iz, 8.6, 8.6, { t: 0.2, masks: [0.4, 0.5, 0.4] });
  // back walls of the room (plaster, one door-shaped hole into darkness)
  ewall(A, 'plaster_cream', -15.5, iz, H, 8.5, 0, 3.6, 0.22, [{ u: 1.2, w: 1.1, y: 0, h: 2.3 }], {
    masks: [0.4, 0.5, 0.35],
  });
  ewall(A, 'plaster_cream', ix, -15.5, 0, 8.5, 0, 3.6, 0.22, [], { masks: [0.4, 0.5, 0.35] });
  A.add('window_void', PANE(A), LL(IDENT, -15.6, 1.15, iz + 1.2, H, 1.1, 2.3, 1));
  // the counter with stools, booths on the window side
  A.add('stone_grey', BOX(A), LL(IDENT, ix - 1.4, 0.75, iz - 2.2, 0, 5.2, 1.1, 0.7), { masks: [0.6, 0.4, 0.2] });
  A.box('concrete', ix - 1.4, 0.75, iz - 2.2, 5.2, 1.1, 0.7);
  for (let i = 0; i < 4; i++) {
    A.addOnce('metal_dark', tubeY(0.06, 0.55, { radial: 8 }), LL(IDENT, ix - 3.2 + i * 1.3, 0.3, iz - 1.2), {
      masks: [0.8, 0.4, 0.1],
    });
    A.addOnce('sign_red', tubeY(0.22, 0.08, { radial: 10 }), LL(IDENT, ix - 3.2 + i * 1.3, 0.85, iz - 1.2), {
      masks: [0.6, 0.3, 0.1],
    });
  }
  A.put('table_small', ix + 2.6, LOOP.walkY + 0.1, iz + 1.6, 0.2, 1);
  A.put('chair', ix + 1.8, LOOP.walkY + 0.1, iz + 2.4, 2.4, 1);
  A.put('chair', ix + 3.3, LOOP.walkY + 0.1, iz + 0.8, -0.8, 1);
  A.put('shelf', ix - 3.9, LOOP.walkY + 0.1, iz - 3.6, 0, 1);
  A.put('cabinet', ix + 3.6, LOOP.walkY + 0.1, iz - 3.8, 0, 1);
  A.interiorLights.push({ x: ix - 1, y: 3.1, z: iz });
  A.interiorLights.push({ x: ix + 2, y: 3.1, z: iz + 2 });

  // ------------------------------------------------------- upper storeys --
  upperFace(A, 'brick_chicago', ex, s.z, H, s.d, s, { trim: 'stone_grey', winW: 2.6 });
  upperFace(A, 'brick_chicago', s.x, sz, 0, s.w, s, { trim: 'stone_grey', winW: 2.6 });
  blankFace(A, 'brick_chicago', wx, s.z, H, s.d, 4.4, s.h - 4.4, { masks: [0.42, 0.55, 0.35] });
  blankFace(A, 'brick_chicago', s.x, s.z - s.d / 2, 0, s.w, 4.4, s.h - 4.4);
  cornice(A, 'stone_grey', s, [[ex, s.z, H, s.d], [s.x, sz, 0, s.w]]);

  // the diner's corner sign: a small red blade at the corner over the door,
  // lit — the diner is open, and its sign is the landmark on this corner the
  // way the marquee is on the theatre's
  A.add('sign_red', BOX(A), LL(IDENT, ex + 0.5, 5.4, sz - 3.2, H, 2.6, 1.0, 0.14), { masks: [0.6, 0.3, 0.1] });
  A.add('sign_glow', BOX_THIN(A), LL(IDENT, ex + 0.56, 5.4, sz - 3.2, H, 2.3, 0.6, 0.05));
}

/** The NE block: the theatre — terracotta, marquee and the blade sign. */
function buildTheatre(A, rng) {
  const s = STRUCTURES[2];
  const t = 0.36;
  const wx = s.x - s.w / 2; // west face at x = 7 (under the L)
  const sz = s.z + s.d / 2; // south face at z = -7
  const g = 4.6;

  // ground floor: the lobby front on the south face, poster niches west
  ewall(A, 'stone_grey', s.x, sz, 0, s.w, 0, g, t, [
    { u: -s.w / 2 + 4.6, w: 5.2, y: 0.4, h: 3.2 }, // the lobby doors band
  ], { masks: [0.55, 0.45, 0.25] });
  ewall(A, 'stone_grey', wx, s.z, H, s.d, 0, g, t, [
    { u: s.d / 2 - 6.5, w: 2.4, y: 0.8, h: 2.4 }, // poster case
    { u: s.d / 2 - 12.5, w: 2.4, y: 0.8, h: 2.4 },
    { u: -3, w: 1.3, y: 0, h: 3.0 }, // stage door (backed)
  ], { masks: [0.55, 0.45, 0.25] });
  ewall(A, 'terracotta', s.x + s.w / 2, s.z, H, s.d, 0, g, t, [], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'terracotta', s.x, s.z - s.d / 2, 0, s.w, 0, g, t, [], { masks: [0.45, 0.5, 0.3] });

  // ------------------------------------------------------------ interior --
  // The lobby: a shallow enterable room behind the door band.
  const lx = s.x - s.w / 2 + 4.6; // door band centre in level space
  const room = { x0: 7 + 0.4, x1: 14.4, z0: -13.8, z1: -7 };
  const rx = (room.x0 + room.x1) / 2;
  const rz = (room.z0 + room.z1) / 2;
  deck(A, 'tile_floor', rx, LOOP.walkY + 0.1, rz, room.x1 - room.x0, room.z1 - room.z0, { t: 0.12 });
  deck(A, 'plaster_cream', rx, 4.0, rz, room.x1 - room.x0 + 0.2, room.z1 - room.z0 + 0.2, { t: 0.2 });
  ewall(A, 'plaster_cream', rx, room.z0, 0, room.x1 - room.x0, 0, 4.0, 0.22, [{ u: -1, w: 1.6, y: 0, h: 2.6 }], {
    masks: [0.42, 0.5, 0.32],
  });
  ewall(A, 'plaster_cream', room.x1, rz, H, room.z1 - room.z0, 0, 4.0, 0.22, [], { masks: [0.42, 0.5, 0.32] });
  A.add('window_void', PANE(A), LL(IDENT, rx - 1, 1.3, room.z0 - 0.12, 0, 1.6, 2.6, 1));
  // the ticket booth, centred in the door band
  A.add('wood_dark', BOX(A), LL(IDENT, rx, 0.7, rz + 1.6, 0, 1.6, 1.1, 1.2), { masks: [0.55, 0.4, 0.2] });
  A.box('wood', rx, 0.7, rz + 1.6, 1.6, 1.1, 1.2);
  A.add('window_glass', PANE(A), LL(IDENT, rx, 1.75, rz + 1.0, 0, 1.4, 1.0, 1));
  A.add('wood_dark', BOX_THIN(A), LL(IDENT, rx, 2.35, rz + 1.6, 0, 1.7, 0.12, 1.3), { masks: [0.7, 0.3, 0.1] });
  A.put('shelf', room.x1 - 1.2, LOOP.walkY + 0.1, rz - 1.5, H, 1);
  A.interiorLights.push({ x: rx, y: 3.4, z: rz });

  // poster cases: dark posters under glass in the west-face niches
  for (const u of [s.d / 2 - 6.5, s.d / 2 - 12.5]) {
    alongWall(wx, s.z, H, u, _wp);
    A.add('window_void', PANE(A), LL(IDENT, _wp[0], 2.0, _wp[1], H + Math.PI, 2.3, 2.3, 1));
    A.add('fabric_red', PANE(A), LL(IDENT, _wp[0] - 0.02, 2.0, _wp[1], H + Math.PI, 1.7, 1.9, 1), {
      masks: [0.4, 0.4, 0.2],
    });
    A.add('window_glass', PANE(A), LL(IDENT, _wp[0] - 0.06, 2.0, _wp[1], H + Math.PI, 2.3, 2.3, 1));
  }
  const backedDoor = (cx, cz, ry, u) => {
    alongWall(cx, cz, ry, u, _wp);
    A.add('metal_dark', BOX(A), LL(IDENT, _wp[0], 1.5, _wp[1], ry, 1.25, 2.95, 0.1), { masks: [0.6, 0.45, 0.25] });
    A.box('metal', _wp[0], 1.5, _wp[1], 1.25, 2.95, 0.14, ry);
  };
  backedDoor(wx, s.z, H, -3);

  // ------------------------------------------------------- upper storeys --
  upperFace(A, 'terracotta', wx, s.z, H, s.d, s, { flip: true, trim: 'stone_grey', winW: 2.2, pitch: 4.0, g0: g });
  upperFace(A, 'terracotta', s.x, sz, 0, s.w, s, { trim: 'stone_grey', winW: 2.2, g0: g });
  blankFace(A, 'terracotta', s.x + s.w / 2, s.z, H, s.d, g, s.h - g, { masks: [0.45, 0.52, 0.32] });
  blankFace(A, 'terracotta', s.x, s.z - s.d / 2, 0, s.w, g, s.h - g);
  cornice(A, 'stone_grey', s, [[wx, s.z, H, s.d], [s.x, sz, 0, s.w]]);

  // ---------------------------------------------------------- the marquee --
  // A lit canopy over the lobby doors, wrapping the corner toward the L.
  const my = 3.9;
  const mw = 7.4;
  const mx = lx;
  A.add('sign_red', BOX(A), LL(IDENT, mx, my + 0.5, sz + 1.35, 0, mw, 1.0, 2.7), { masks: [0.55, 0.35, 0.15] });
  // the letterboard, lit from behind — the brightest surface on the map, and
  // the thing you steer by from the far end of either street
  A.add('sign_glow', BOX_THIN(A), LL(IDENT, mx, my + 0.5, sz + 2.72, 0, mw - 0.5, 0.62, 0.06));
  // and the same board on the returns, so the corner reads from the west too
  for (const s of [-1, 1]) {
    A.add('sign_glow', BOX_THIN(A), LL(IDENT, mx + s * (mw / 2 - 0.03), my + 0.5, sz + 1.35, H, 2.2, 0.62, 0.06));
  }
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, mx, my - 0.02, sz + 1.35, 0, mw + 0.2, 0.08, 2.8), {
    masks: [0.8, 0.4, 0.1],
  });
  // marquee bulbs: a row of small warm emitters under the soffit edge
  for (let i = 0; i < 9; i++) {
    A.add('emissive_warm', BOX_THIN(A), LL(IDENT, mx - mw / 2 + 0.6 + i * (mw - 1.2) / 8, my + 0.06, sz + 2.55, 0, 0.09, 0.06, 0.09));
  }
  // hanger rods back to the facade
  for (const dx of [-mw / 2 + 0.5, mw / 2 - 0.5]) {
    strut(A, 'metal_dark', mx + dx, my + 0.9, sz + 2.5, mx + dx, my + 2.6, sz + 0.1, 0.05, [0.85, 0.4, 0.1]);
  }

  // ------------------------------------------------------- the blade sign --
  // Vertical red blade on the corner, big enough to read from the far mouth.
  const bx = 7 + 0.4;
  const bz = -7 + 0.4;
  A.add('sign_red', BOX(A), LL(IDENT, bx - 0.6, 9.2, bz - 0.6, Math.PI / 4, 1.5, 7.2, 0.3), { masks: [0.55, 0.3, 0.1] });
  A.add('sign_glow', BOX_THIN(A), LL(IDENT, bx - 0.68, 9.2, bz - 0.68, Math.PI / 4, 1.1, 6.6, 0.06));
  // stacked bulbs down both edges
  for (let i = 0; i < 7; i++) {
    A.add('emissive_warm', BOX_THIN(A), LL(IDENT, bx - 0.62, 6.2 + i * 1.0, bz - 0.62, Math.PI / 4, 0.1, 0.1, 0.36));
  }
  strut(A, 'metal_dark', bx, 12.6, bz, bx - 1.1, 12.2, bz - 1.1, 0.07, [0.85, 0.4, 0.1]);
  strut(A, 'metal_dark', bx, 6.0, bz, bx - 1.1, 6.4, bz - 1.1, 0.07, [0.85, 0.4, 0.1]);
}

/** The SW block: the tavern — brick, shopfronts, a fire escape. */
function buildTavern(A, rng) {
  const s = STRUCTURES[4];
  const t = 0.36;
  const ex = s.x + s.w / 2; // east face at x = -7
  const nz = s.z - s.d / 2; // north face at z = 7
  const g = 4.0;

  ewall(A, 'brick_red', ex, s.z, H, s.d, 0, g, t, [
    { u: -s.d / 2 + 3.4, w: 3.0, y: 0.8, h: 2.4 },
    { u: -s.d / 2 + 7.2, w: 1.35, y: 0, h: 2.9 }, // door (backed)
    { u: 2.5, w: 3.0, y: 0.8, h: 2.4 },
    { u: 8.5, w: 3.0, y: 0.8, h: 2.4 },
  ], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_red', s.x, nz, 0, s.w, 0, g, t, [
    { u: 2.2, w: 3.2, y: 0.8, h: 2.4 },
    { u: -2.2, w: 1.35, y: 0, h: 2.9 }, // door (backed)
  ], { masks: [0.5, 0.5, 0.3] });
  ewall(A, 'brick_red', s.x - s.w / 2, s.z, H, s.d, 0, g, t, [{ u: -4, w: 1.2, y: 0, h: 2.4 }], {
    masks: [0.45, 0.55, 0.35],
  });
  ewall(A, 'brick_red', s.x, s.z + s.d / 2, 0, s.w, 0, g, t, [], { masks: [0.45, 0.5, 0.3] });

  const backedDoor = (cx, cz, ry, u, key = 'wood_dark') => {
    alongWall(cx, cz, ry, u, _wp);
    A.add(key, BOX(A), LL(IDENT, _wp[0], 1.45, _wp[1], ry, 1.28, 2.85, 0.1), { masks: [0.55, 0.45, 0.25] });
    A.box('wood', _wp[0], 1.45, _wp[1], 1.28, 2.85, 0.14, ry);
  };
  backedDoor(ex, s.z, H, -s.d / 2 + 7.2);
  backedDoor(s.x, nz, 0, -2.2);
  backedDoor(s.x - s.w / 2, s.z, H, -4);
  // the shopfront under the red awning still has its lights on; the other two
  // shut hours ago, which is what makes the lit one read as open
  for (const u of [-s.d / 2 + 3.4, 2.5, 8.5]) {
    darkWindow(A, ex, s.z, H, 0, { u, w: 3.0, y: 0.8, h: 2.4 }, { trim: 'stone_grey', t, lit: u === 2.5 });
  }
  darkWindow(A, s.x, nz, 0, 0, { u: 2.2, w: 3.2, y: 0.8, h: 2.4 }, { flip: true, trim: 'stone_grey', t });

  // awnings over the two south shopfronts — the south arm's colour
  for (const [u, key] of [[2.5, 'fabric_red'], [8.5, 'fabric_teal']]) {
    alongWall(ex, s.z, H, u, _wp);
    A.add(key, BOX_THIN(A), LL(IDENT, _wp[0] + 0.75, 3.15, _wp[1], H, 3.4, 0.05, 1.7, 0, -0.55), {
      masks: [0.5, 0.35, 0.2],
    });
    A.add(key, BOX_THIN(A), LL(IDENT, _wp[0] + 1.45, 2.72, _wp[1], H, 3.4, 0.28, 0.05), { masks: [0.55, 0.35, 0.2] });
  }

  upperFace(A, 'brick_red', ex, s.z, H, s.d, s, { trim: 'stone_grey', winW: 2.2, g0: g });
  upperFace(A, 'brick_red', s.x, nz, 0, s.w, s, { flip: true, trim: 'stone_grey', winW: 2.2, g0: g });
  blankFace(A, 'brick_red', s.x - s.w / 2, s.z, H, s.d, g, s.h - g, { masks: [0.42, 0.55, 0.35] });
  blankFace(A, 'brick_red', s.x, s.z + s.d / 2, 0, s.w, g, s.h - g);
  cornice(A, 'stone_grey', s, [[ex, s.z, H, s.d], [s.x, nz, 0, s.w]]);

  // ------------------------------------------------------ the fire escape --
  // Two balconies and a raked ladder on the street face. Scenery: it starts
  // above head height, the way a real counterweighted stair hangs.
  const fy = [4.9, 6.9];
  const fx = ex + 0.65;
  for (const y of fy) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, fx, y, s.z + 3, H, 7.5, 0.08, 1.15), { masks: [0.8, 0.5, 0.2] });
    for (const [zz, xx] of [[s.z - 0.6, fx + 0.5], [s.z + 6.6, fx + 0.5]]) {
      strut(A, 'metal_dark', ex, y - 0.85, zz, fx + 0.55, y - 0.04, zz, 0.06, [0.85, 0.5, 0.15]);
    }
    for (const yy of [y + 0.95]) {
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, fx + 0.55, yy, s.z + 3, H, 7.5, 0.05, 0.05), { masks: [0.85, 0.45, 0.1] });
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, fx + 0.55, y + 0.5, s.z + 3, H, 7.5, 0.03, 0.03), { masks: [0.85, 0.45, 0.1] });
    }
    for (let i = 0; i <= 8; i++) {
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, fx + 0.55, y + 0.5, s.z - 0.7 + i * 0.925, 0, 0.04, 0.95, 0.04), {
        masks: [0.85, 0.5, 0.1],
      });
    }
  }
  // the raked stair between the balconies, and the dropped ladder stub
  strut(A, 'metal_dark', fx, fy[0] + 0.05, s.z + 6.2, fx, fy[1] + 0.05, s.z + 1.4, 0.1, [0.8, 0.5, 0.2]);
  strut(A, 'metal_dark', fx, fy[0] + 0.02, s.z - 0.4, fx, 3.1, s.z - 0.4, 0.07, [0.85, 0.5, 0.15]);
}

/** The SE block: the bank — limestone, columns, and the corner bar inside. */
function buildBank(A, rng) {
  const s = STRUCTURES[6];
  const t = 0.4;
  const wx = s.x - s.w / 2; // west face at x = 7
  const nz = s.z - s.d / 2; // north face at z = 7, under the platform
  const g = 4.6;

  ewall(A, 'stone_grey', wx, s.z, H, s.d, 0, g, t, [
    { u: s.d / 2 - 3.2, w: 1.5, y: 0, h: 3.2 }, // the bar door, at the corner
    { u: s.d / 2 - 6.8, w: 2.6, y: 0.9, h: 2.3 }, // bar window
    { u: -2, w: 2.6, y: 0.9, h: 2.3 },
    { u: -8, w: 2.6, y: 0.9, h: 2.3 },
  ], { masks: [0.55, 0.45, 0.25] });
  ewall(A, 'stone_grey', s.x, nz, 0, s.w, 0, g, t, [
    { u: -s.w / 2 + 3.4, w: 2.8, y: 0.9, h: 2.3 }, // bar window under the stair
    { u: 2.5, w: 2.6, y: 0.9, h: 2.3 },
  ], { masks: [0.55, 0.45, 0.25] });
  ewall(A, 'brick_chicago', s.x + s.w / 2, s.z, H, s.d, 0, g, t, [{ u: 5, w: 1.2, y: 0, h: 2.4 }], {
    masks: [0.45, 0.55, 0.35],
  });
  ewall(A, 'brick_chicago', s.x, s.z + s.d / 2, 0, s.w, 0, g, t, [], { masks: [0.45, 0.5, 0.3] });
  // pilasters between the west-face bays — the bank face
  for (const u of [-11, -5, 1, 7, 13.8]) {
    alongWall(wx, s.z, H, u, _wp);
    A.add('stone_grey', BOX(A), LL(IDENT, _wp[0] - 0.1, g / 2, _wp[1], H, 0.7, g, t + 0.24), {
      masks: [0.65, 0.4, 0.2],
    });
  }

  const backedDoor = (cx, cz, ry, u) => {
    alongWall(cx, cz, ry, u, _wp);
    A.add('wood_dark', BOX(A), LL(IDENT, _wp[0], 1.25, _wp[1], ry, 1.15, 2.35, 0.1), { masks: [0.55, 0.45, 0.25] });
    A.box('wood', _wp[0], 1.25, _wp[1], 1.15, 2.35, 0.14, ry);
  };
  backedDoor(s.x + s.w / 2, s.z, H, 5);
  for (const u of [-2, -8]) {
    darkWindow(A, wx, s.z, H, 0, { u, w: 2.6, y: 0.9, h: 2.3 }, { flip: true, trim: 'stone_grey', t });
  }
  darkWindow(A, s.x, nz, 0, 0, { u: 2.5, w: 2.6, y: 0.9, h: 2.3 }, { flip: true, trim: 'stone_grey', t });

  // ------------------------------------------------------------ interior --
  // The corner bar: x in [7.4, 14.6], z in [7.4, 14.6].
  const rx = 11;
  const rz = 11;
  deck(A, 'floor_wood', rx, LOOP.walkY + 0.1, rz, 7.2, 7.2, { t: 0.12 });
  deck(A, 'plaster_cream', rx, 3.7, rz, 7.4, 7.4, { t: 0.2 });
  ewall(A, 'plaster_cream', 14.6, rz, H, 7.2, 0, 3.7, 0.22, [{ u: -1.4, w: 1.1, y: 0, h: 2.3 }], {
    masks: [0.42, 0.5, 0.32],
  });
  ewall(A, 'plaster_cream', rx, 14.6, 0, 7.2, 0, 3.7, 0.22, [], { masks: [0.42, 0.5, 0.32] });
  A.add('window_void', PANE(A), LL(IDENT, 14.7, 1.15, rz - 1.4, -H, 1.1, 2.3, 1));
  // the bar along the back wall, bottles behind it
  A.add('wood_dark', BOX(A), LL(IDENT, rx + 1.6, 0.72, rz + 1.8, 0, 4.4, 1.14, 0.65), { masks: [0.5, 0.4, 0.2] });
  A.box('wood', rx + 1.6, 0.72, rz + 1.8, 4.4, 1.14, 0.65);
  A.put('shelf', rx + 2.6, LOOP.walkY + 0.1, rz + 3.4, 0, 1);
  for (let i = 0; i < 5; i++) {
    A.put('bottle', rx + 0.6 + i * 0.7, 1.32, rz + 1.75, rng.float() * 6.28, rng.range(0.8, 1.1));
  }
  A.put('table_small', rx - 2, LOOP.walkY + 0.1, rz - 1.4, 0.3, 1);
  A.put('chair', rx - 2.8, LOOP.walkY + 0.1, rz - 0.6, 2.1, 1);
  A.put('chair', rx - 1.2, LOOP.walkY + 0.1, rz - 2.2, -0.9, 1);
  A.interiorLights.push({ x: rx, y: 3.2, z: rz });

  upperFace(A, 'stone_grey', wx, s.z, H, s.d, s, { flip: true, trim: 'stone_grey', winW: 2.4, g0: g });
  upperFace(A, 'stone_grey', s.x, nz, 0, s.w, s, { flip: true, trim: 'stone_grey', winW: 2.4, g0: g });
  blankFace(A, 'brick_chicago', s.x + s.w / 2, s.z, H, s.d, g, s.h - g, { masks: [0.42, 0.55, 0.35] });
  blankFace(A, 'brick_chicago', s.x, s.z + s.d / 2, 0, s.w, g, s.h - g);
  cornice(A, 'stone_grey', s, [[wx, s.z, H, s.d], [s.x, nz, 0, s.w]]);
}

/** An outer block: simpler massing that seals the map edge behind an alley. */
function buildOuterBlock(A, rng, s, key) {
  const g = 4.2;
  const t = 0.36;
  // the alley face: dock doors, a few barred windows, grime
  const inner = s.x < 0 ? s.x + s.w / 2 : s.x - s.w / 2;
  const ry = H;
  ewall(A, key, inner, s.z, ry, s.d, 0, g, t, [
    { u: -s.d / 2 + 6, w: 2.6, y: 0.2, h: 2.8 }, // dock door (backed)
    { u: 4, w: 1.2, y: 0, h: 2.4 }, // man door (backed)
    { u: 10, w: 1.6, y: 1.4, h: 1.2 }, // high window
  ], { masks: [0.45, 0.55, 0.35] });
  const backed = (u, w, h, y0, key2) => {
    alongWall(inner, s.z, ry, u, _wp);
    A.add(key2, BOX(A), LL(IDENT, _wp[0], y0 + h / 2, _wp[1], ry, w - 0.05, h - 0.05, 0.1), {
      masks: [0.6, 0.5, 0.3],
    });
    A.box('metal', _wp[0], y0 + h / 2, _wp[1], w - 0.05, h - 0.05, 0.14, ry);
  };
  backed(-s.d / 2 + 6, 2.6, 2.8, 0.2, 'corrugated_fine');
  backed(4, 1.2, 2.4, 0, 'metal_dark');
  alongWall(inner, s.z, ry, 10, _wp);
  A.add('window_void', PANE(A), LL(IDENT, _wp[0], 2.0, _wp[1], s.x > 0 ? ry + Math.PI : ry, 1.55, 1.15, 1));
  // the street face (toward the east-west street)
  const face = s.z < 0 ? s.z + s.d / 2 : s.z - s.d / 2;
  ewall(A, key, s.x, face, 0, s.w, 0, g, t, [
    { u: -2, w: 2.4, y: 0.8, h: 2.3 },
    { u: 2.8, w: 1.3, y: 0, h: 2.8 },
  ], { masks: [0.5, 0.5, 0.3] });
  darkWindow(A, s.x, face, 0, 0, { u: -2, w: 2.4, y: 0.8, h: 2.3 }, { flip: s.z > 0, trim: 'concrete_dark', t });
  alongWall(s.x, face, 0, 2.8, _wp);
  A.add('wood_dark', BOX(A), LL(IDENT, _wp[0], 1.4, _wp[1], 0, 1.25, 2.75, 0.1), { masks: [0.55, 0.45, 0.25] });
  A.box('wood', _wp[0], 1.4, _wp[1], 1.25, 2.75, 0.14);
  // upper mass: window rows on the alley and street faces, blank at the edge
  upperFace(A, key, inner, s.z, ry, s.d, s, { flip: s.x > 0, trim: 'concrete_dark', winW: 2.0, pitch: 5.2, g0: g });
  upperFace(A, key, s.x, face, 0, s.w, s, { flip: s.z > 0, trim: 'concrete_dark', winW: 2.0, pitch: 5.2, g0: g });
  blankFace(A, key, s.x < 0 ? s.x - s.w / 2 : s.x + s.w / 2, s.z, H, s.d, 0, s.h);
  blankFace(A, key, s.x, s.z < 0 ? s.z - s.d / 2 : s.z + s.d / 2, 0, s.w, 0, s.h);
  cornice(A, 'concrete_dark', s, [[inner, s.z, H, s.d], [s.x, face, 0, s.w]]);
  // rooftop silhouette: a water tank on the tallest pair
  if (s.h > 11) {
    A.put('water_tank', s.x + rng.range(-2, 2), s.h - 0.6, s.z + rng.range(-6, 6), rng.float() * 3, 1.4);
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the mouths and the backdrop                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Seal a street mouth with hoarding, barriers and drums; alleys get boards. */
function sealMouths(A, rng) {
  const HF = LOOP.half;
  // plywood hoarding on scaffold posts across each street mouth
  const hoard = (cx, cz, ry, len) => {
    A.add('plywood', BOX(A), LL(IDENT, cx, 1.55, cz, ry, len, 3.1, 0.1), { masks: [0.6, 0.5, 0.3] });
    A.box('wood', cx, 1.55, cz, len, 3.1, 0.14, ry);
    const n = Math.round(len / 2.4);
    for (let i = 0; i <= n; i++) {
      alongWall(cx, cz, ry, -len / 2 + (i / n) * len, _wp);
      A.add('steel', BOX_THIN(A), LL(IDENT, _wp[0], 1.6, _wp[1], ry, 0.09, 3.2, 0.09), { masks: [0.8, 0.45, 0.2] });
    }
    // a diagonal warning board mid-line
    alongWall(cx, cz, ry, 0, _wp);
    A.add('sign_red', BOX_THIN(A), LL(IDENT, _wp[0], 2.2, _wp[1], ry, 2.6, 0.5, 0.12), { masks: [0.6, 0.3, 0.1] });
  };
  hoard(0, -HF + 0.7, 0, 14.2); // north — the scaffold stands just inside
  hoard(0, HF - 0.7, 0, 14.2);
  hoard(-HF + 0.7, 0, H, 14.2);
  hoard(HF - 0.7, 0, H, 14.2);
  // jersey barriers and drums staggered in front of each hoarding
  const spill = (cx, cz, ry) => {
    for (const [u, off, yaw] of [[-3.4, 1.9, 0.15], [0.6, 2.3, -0.1], [4, 1.8, 0.2]]) {
      alongWall(cx, cz, ry, u, _wp);
      const px = _wp[0] + Math.sin(ry) * off;
      const pz = _wp[1] + Math.cos(ry) * off;
      A.put('jersey', px, LOOP.roadY + 0.03, pz, ry + yaw, 1);
      A.box('concrete', px, LOOP.roadY + 0.45, pz, 2.0, 0.85, 0.6, ry + yaw);
    }
    for (const [u, off] of [[-1.6, 3.4], [2.4, 3.1]]) {
      alongWall(cx, cz, ry, u, _wp);
      A.put('traffic_drum', _wp[0] + Math.sin(ry) * off, LOOP.roadY + 0.02, _wp[1] + Math.cos(ry) * off, rng.float() * 3, 1);
    }
  };
  spill(0, -HF + 0.8, 0);
  spill(0, HF - 0.8, Math.PI);
  spill(-HF + 0.8, 0, H);
  spill(HF - 0.8, 0, -H);
  // board fences and a dumpster across each alley mouth
  for (const a of ALLEYS) {
    const cx = (a.x0 + a.x1) / 2;
    for (const sz of [-1, 1]) {
      const gz = sz * (HF - 1.2);
      A.add('plywood', BOX(A), LL(IDENT, cx, 1.25, gz, 0, a.x1 - a.x0 + 0.3, 2.5, 0.09), { masks: [0.6, 0.5, 0.3] });
      A.box('wood', cx, 1.25, gz, a.x1 - a.x0 + 0.3, 2.5, 0.13);
      A.put('dumpster', cx, LOOP.walkY, gz - sz * 1.6, sz > 0 ? 0.1 : Math.PI - 0.1, 1);
      A.box('metal', cx, LOOP.walkY + 0.62, gz - sz * 1.6, 1.95, 1.24, 1.2);
    }
  }
}

/**
 * The backdrop: block massing beyond every edge and the L running on, so the
 * street ends in city, not in sky. No collision: nothing out there is playable.
 */
function buildBackdrop(A, rng) {
  const HF = LOOP.half;
  const masses = [
    // [x, z, w, d, h, key]
    [-20, -46, 22, 14, 17, 'brick_chicago'],
    [14, -47, 20, 15, 24, 'stone_grey'],
    [38, -46, 18, 13, 12, 'brick_red'],
    [47, -18, 15, 20, 20, 'brick_chicago'],
    [48, 12, 16, 22, 15, 'concrete_dark'],
    [46, 34, 14, 14, 26, 'stone_grey'],
    [16, 47, 22, 15, 19, 'terracotta'],
    [-16, 46, 20, 13, 13, 'brick_chicago'],
    [-45, 42, 15, 16, 22, 'brick_red'],
    [-47, 8, 16, 20, 16, 'stone_grey'],
    [-46, -24, 14, 18, 25, 'brick_chicago'],
  ];
  for (const [x, z, w, d, h, key] of masses) {
    A.add(key, BOX(A), LL(IDENT, x, h / 2, z, (x * 3.1 + z * 1.7) % 0.14 - 0.07, w, h, d), {
      masks: [0.45, 0.5, 0.35],
    });
    // A window grid on the faces that look into the map. Broken into bays
    // rather than run as one band per floor, because at night this is the
    // skyline: a mass whose whole floor lights at once reads as a lit strip,
    // and a mass with none reads as a hole cut out of the sky. Bay by bay, a
    // fifth of them up, it reads as a building with people in it — which is
    // all the backdrop has to do from 60 m away.
    const gy = Math.floor(h / 3.4);
    const toward = Math.abs(x) > Math.abs(z) ? (x > 0 ? -1 : 1) : 0;
    const faceX = x + (toward !== 0 ? toward * (w / 2 + 0.06) : 0);
    const facez = toward === 0 ? z + (z > 0 ? -1 : 1) * (d / 2 + 0.06) : z;
    const fw = toward === 0 ? w : d;
    const ry = toward === 0 ? (z > 0 ? Math.PI : 0) : (x > 0 ? -H : H);
    const bays = Math.max(2, Math.round((fw - 2.5) / 3.2));
    const bw = (fw - 2.5) / bays;
    for (let fy = 1; fy < gy; fy++) {
      const wy = fy * 3.4 + 0.6;
      for (let b = 0; b < bays; b++) {
        const u = -(fw - 2.5) / 2 + bw * (b + 0.5);
        alongWall(faceX, facez, ry, u, _wp);
        const lit = litRoom(_wp[0], wy, _wp[1]);
        A.add(lit ? 'window_glow' : 'window_void', PANE(A), LL(IDENT, _wp[0], wy, _wp[1], ry, bw - 0.35, 1.4, 1),
          lit ? { masks: [0.25, 0.4, 0.1] } : null);
      }
    }
  }
  // the ground out there: one big dark apron so gaps between masses read as
  // streets in shadow rather than as void
  const apron = new THREE.PlaneGeometry(HF * 2 + 60, HF * 2 + 60, 1, 1);
  apron.rotateX(-Math.PI / 2);
  paintMasks(apron, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.2;
    out[1] = 0.5;
  });
  A.addOnce('asphalt', apron, LL(IDENT, 0, -0.05, 0));
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* set dressing                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function dressLoop(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.4, scale: 0.06 };
  const free = (x, z, m = 0.7) => standableAtLoop(x, z, m);

  // corner lamp posts — the four corners of the intersection
  for (const [x, z, ry] of [[-5.9, -5.9, 0.8], [5.9, -5.9, -0.8], [-5.9, 5.9, 2.4], [5.9, 5.9, -2.4]]) {
    A.put('lamp_post', x, LOOP.walkY, z, ry, 0.95);
    A.put('lamp_glass', x, LOOP.walkY, z, ry, 0.95);
    A.box('metal', x, 1.3, z, 0.3, 2.6, 0.3);
    A.lampAnchors.push({ x: x + Math.cos(ry) * 0.83, y: 5.28, z: z - Math.sin(ry) * 0.83 });
  }
  // mid-arm lamps on the open (south and west) arms
  for (const [x, z, ry] of [[-6.2, 22, 0.2], [6.2, 30, 3.0], [-22, -6.2, 1.8], [-30, 6.2, -1.2]]) {
    A.put('lamp_post', x, LOOP.walkY, z, ry, 0.95);
    A.put('lamp_glass', x, LOOP.walkY, z, ry, 0.95);
    A.box('metal', x, 1.3, z, 0.3, 2.6, 0.3);
    A.lampAnchors.push({ x: x + Math.cos(ry) * 0.83, y: 5.28, z: z - Math.sin(ry) * 0.83 });
  }

  // street furniture: hydrants, boxes, baskets, signs — the corner vocabulary
  A.put('hydrant', -5.6, LOOP.walkY, -12.5, 0.3, 1);
  A.put('hydrant', 5.7, LOOP.walkY, 17, 2.1, 1);
  A.put('hydrant', -17, LOOP.walkY, 5.7, 1.2, 1);
  A.put('mailbox', -5.8, LOOP.walkY, 10.5, H, 1);
  A.box('metal', -5.8, LOOP.walkY + 0.62, 10.5, 0.6, 1.25, 0.7);
  A.put('mailbox', 12.5, LOOP.walkY, -5.9, 0, 1);
  A.box('metal', 12.5, LOOP.walkY + 0.62, -5.9, 0.7, 1.25, 0.6);
  for (const [x, z, i] of [[-5.7, -8.6, 0], [-5.7, -7.9, 1], [8.6, 5.85, 0], [9.3, 5.85, 1], [30, -5.85, 0]]) {
    A.put(i ? 'newsbox_blue' : 'newsbox', x, LOOP.walkY, z, (x > 0 ? -H : H) + rng.range(-0.2, 0.2), 1);
  }
  for (const [x, z] of [[5.8, -12], [-5.85, 14.5], [26, 5.8], [-14, -5.8]]) {
    A.put('litter_basket', x, LOOP.walkY, z, rng.float() * 3, 1);
    A.put('litter_bag', x, LOOP.walkY, z, rng.float() * 3, 1);
  }
  for (const [x, z, ry] of [[-5.7, -5.2, 0.2], [5.7, 5.3, 3.3], [6.1, -5.4, -1.4], [-6.1, 5.4, 1.7]]) {
    A.put('street_sign', x, LOOP.walkY, z, ry, 1);
  }

  // planters down the open arms — green against the brick
  for (const [x, z] of [[-6.1, 25.5], [6.1, 26.5], [-25.5, -6.1], [-26.5, 6.1], [-6.1, 33], [33, 6.1]]) {
    if (!free(x, z, 0.5)) continue;
    A.put('planter', x, LOOP.walkY, z, rng.float() * 3, 1.25);
    A.put('shrub', x, LOOP.walkY + 0.42, z, rng.float() * 6.28, 0.85);
    A.box('concrete', x, LOOP.walkY + 0.3, z, 0.85, 0.6, 0.85);
  }

  // the newsstand along the theatre front, stacked papers behind it
  A.put('stall', 20.5, LOOP.walkY, -6.0, Math.PI, 1);
  A.box('wood', 20.5, LOOP.walkY + 1.0, -6.0, 2.2, 2.0, 1.1);
  A.put('box_card_a', 19.3, LOOP.walkY, -5.3, 0.4, 1);
  A.put('box_card_b', 21.6, LOOP.walkY, -5.2, 1.9, 0.9);

  // under the tracks: the L's own street level — drums, pallets, a spool of
  // cable against a column, puddle-dark patches where the sun never lands
  for (const [x, z] of [[3.1, -18.5], [-3.2, -26], [3.2, -32.5]]) {
    A.put('barrel_rust', x, groundYLoop(x, z), z, rng.float() * 6.28, 1);
  }
  A.put('pallet', -3, groundYLoop(-3, -19.5), -19.5, 0.3, 1);
  A.put('crate_a', -2.9, groundYLoop(-2.9, -12.4), -12.4, 0.9, 1);
  for (let i = 0; i < 8; i++) {
    const onNS = i % 2 === 0;
    const u = rng.range(9, 34);
    const x = onNS ? rng.range(-3, 3) : u;
    const z = onNS ? -u : rng.range(-3, 3);
    if (!free(x, z, 0.4)) continue;
    A.addOnce('road_rut', patchGeometry(rng, rng.range(0.8, 1.8), { lobes: 8, wobble: 0.5 }),
      LL(IDENT, x, LOOP.roadY + 0.048, z, rng.float() * 6.283), { masks: [0.05, 0.95, 0.55] });
  }

  // the alleys: dumpsters, crates, drums — the flanking lanes' cover
  for (const [x, z, ry] of [
    [-24, -14, 0.15], [-24.3, -33.5, -0.1], [-23.8, 14.5, 3.2], [-24, 33, 0.1],
    [24, -14, -3.0], [24.2, 33.5, 0.05], [23.8, -33.5, 3.1],
  ]) {
    if (!free(x, z, 0.9)) continue;
    A.put('dumpster', x, LOOP.walkY, z, ry, 1);
    A.box('metal', x, LOOP.walkY + 0.62, z, 1.95, 1.24, 1.2, ry);
  }
  for (const [id, x, z] of [
    ['crate_b', -23.5, -18.5], ['pallet', 24.5, -18], ['barrel_blue', 23.6, 15],
    ['crate_c', -24.5, 26], ['box_card_a', 24.4, 27.5], ['barrel_rust', -23.4, -27.5],
  ]) {
    if (!free(x, z, 0.5)) continue;
    A.put(id, x, LOOP.walkY, z, rng.float() * 6.28, 1);
  }

  // litter drifted against curbs and column feet
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 60; i++) {
    const arm = i % 4;
    const u = rng.range(8, LOOP.half - 3);
    const lat = rng.range(3.6, 6.6) * (i % 8 < 4 ? 1 : -1);
    const x = arm === 0 ? lat : arm === 1 ? lat : arm === 2 ? u : -u;
    const z = arm === 0 ? u : arm === 1 ? -u : lat;
    if (!free(x, z, 0.3)) continue;
    A.put('litter', x, groundYLoop(x, z), z, rng.float() * 6.28, rng.range(0.7, 1.3));
  }
  // weeds in the sidewalk cracks along the buildings and the alley walls
  for (let i = 0; i < 30; i++) {
    const a = ALLEYS[i % 2];
    const x = (a.x0 + a.x1) / 2 + rng.range(-1.3, 1.3);
    const z = rng.range(-LOOP.half + 4, LOOP.half - 4);
    if (!free(x, z, 0.4)) continue;
    A.put('weeds', x, LOOP.walkY, z, rng.float() * 6.28, rng.range(0.5, 1.0));
  }
  A.jitter = null;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map's `build`.
 */
export function buildLoop(A, rng) {
  registerProps(A, rng);
  registerLoopProps(A, rng);

  buildStreets(A, rng);
  buildEl(A, rng);
  buildStation(A, rng);
  buildTrain(A, rng);
  buildDiner(A, rng);
  buildTheatre(A, rng);
  buildTavern(A, rng);
  buildBank(A, rng);
  buildOuterBlock(A, rng, STRUCTURES[1], 'brick_chicago');
  buildOuterBlock(A, rng, STRUCTURES[3], 'brick_red');
  buildOuterBlock(A, rng, STRUCTURES[5], 'brick_chicago');
  buildOuterBlock(A, rng, STRUCTURES[7], 'stone_grey');
  sealMouths(A, rng);
  buildBackdrop(A, rng);
  dressLoop(A, rng);

  return { buildings: STRUCTURES.map((s) => ({ spec: s, id: s.id })) };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const LOOP_MAP = {
  id: 'loop',
  name: 'The Loop',
  subtitle: 'Chicago corner under the L, after dark',
  blurb:
    'Two streets cross under the elevated at half past eleven: steel columns and lit shopfronts below, a stalled train, a station platform and a walkable curve of track above.',
  size: '76 × 76 m',
  /**
   * LEVEL -> WORLD. Off-axis for the same reason Rust and Wilmot are: every
   * mass here is a rectangle, and rectangles lit square-on lose one of their
   * two lit faces.
   */
  transform: { yaw: 0.46, tx: 0, tz: 0 },
  /** Tight to the block plus a skirt for the nav grid; the perimeter is sealed. */
  bounds: [-42, -2, -42, 42, 24, 42],
  /**
   * NIGHT. The Loop is the game's night map — the one time of day this corner
   * is actually about. Everything the block owns is a light source: the lamps
   * on their cast posts, the marquee and the blade sign, the diner's window,
   * the lit rooms over the shopfronts and the stalled car at the platform. In
   * daylight they are all detail on top of the sun; after dark they ARE the
   * lighting, they are what the streets read by, and the steel of the L turns
   * into a lid that puts everything under it in shadow.
   *
   * `hour` is 23:30 local solar time. The sun is 21 degrees under, so there is
   * no twilight left in the sky at all, and the choice between this and the
   * graded 01:30 of the `night` shot is a COLOUR one, made off the frame.
   *
   * The moon is the only key there is, and how blue it is depends entirely on
   * how far it has to look through the atmosphere: `src/sky` tints it cool for
   * the Purkinje shift and then reddens it by real airmass on the way down.
   * At 01:30 it sits at 21 degrees, which is low enough that the reddening
   * wins — it comes out at (1.00, 0.98, 0.88), a warm key against a blue sky,
   * and pale limestone under a warm key photographs as daylight no matter what
   * the clock says. At 23:30 it is at 42 degrees, the airmass is half of that,
   * and it lands on (0.89, 0.96, 1.00): a cool key against warm sodium lamps
   * and warm windows, which is the separation every night frame is built on.
   * High enough to reach the road between the blocks, off-axis enough (due
   * west, so across both streets) to leave one face of every mass in shadow.
   *
   * The weather is a city's, not the market's desert: more aerosol, so the
   * practicals wear real halos and the far end of a street goes soft; a thinner
   * cloud deck than the default, because the moon is the only key there is and
   * a full one would take it away; and fog banked lower and heavier than the
   * default, which is what a warm street exhaling into cold air does, and what
   * gives the lamps something to stand in.
   *
   * `exposureBias` is a stop of metering compensation ON TOP of the half stop
   * the sky already applies after dark, and it is the difference between a
   * night frame and a long exposure of one. A meter weighted onto the geometry
   * sees a frame that is mostly dark and opens up until moonlight on the bank's
   * limestone reads as sunlight; this block does not need it to, because unlike
   * the market it owns ten lamp posts, a marquee, a lit car and seventy lit
   * windows, and stopping down is what hands the top of the tone curve to
   * those instead of to a wall.
   */
  environment: {
    hour: 23.5,
    exposureBias: 1.0,
    weather: {
      turbidity: 1.85,
      cloudCoverage: 0.22,
      cloudDensity: 2.2,
      cirrusCoverage: 0.14,
      cirrusOpacity: 0.24,
      horizonMurk: 0.2,
      fogDensity: 1.3,
      fogHeight: 14,
    },
  },
  spawnPoints: LOOP_SPAWNS,
  standable: standableAtLoop,
  groundY: groundYLoop,
  isOpen: isOpenLoop,
  build: buildLoop,
};
