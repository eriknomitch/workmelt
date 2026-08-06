import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, stairRun } from './kit.js';
import { registerProps } from './props.js';
import { registerWilmotProps } from './wilmotprops.js';
import { registerFisherProps } from './fisherprops.js';
import { registerShivamProps } from './shivamprops.js';
import { fbm3, paintMasks, patchGeometry, rockGeometry, driftBerm } from './util.js';

/**
 * WORLD — SHIVAM.
 *
 * Bondi Beach, Sydney, cropped to its fighting core: the Pavilion, the grass
 * terraces off Campbell Parade, the promenade wall, the sand, and the
 * Icebergs ocean pool hanging over the surf at the south end. Like every
 * other map, all of it is generated here — nothing is loaded from disk.
 *
 *   THE PAVILION   the landmark: a cream colonnaded hall between the lawn and
 *                  the promenade, enterable below, with an external switchback
 *                  to a parapeted roof that overlooks the whole beach.
 *   THE TERRACES   street -> lawn -> promenade, each step 0.45 m — low enough
 *                  to mantle anywhere, so the north half flows downhill.
 *   THE WALL       the promenade sea wall: 0.48 m of cover on the promenade
 *                  side, a 1.5 m face over the sand. Promenade players vault
 *                  over and drop; beach players come back up by three stairs.
 *   THE ICEBERGS   the pool deck at the south-east: a wading pool sunk in a
 *                  concrete apron over the water, a clubhouse with a roof
 *                  deck, and a stair down to the sand.
 *   THE TOWER      the lifeguard tower on the open sand — a quick, exposed
 *                  perch that watches the beach lane both ways.
 *
 * NORTH (-Z) is inland; the ocean is south (+Z). The real beach faces
 * south-east — squared up here because every mass on the map is authored as
 * an axis-aligned rectangle, and the descriptor's yaw puts the sun back off
 * the axes anyway.
 *
 * The sea itself is the one edge that cannot be fenced: the sand runs into a
 * low rock shelf at the surf line (Bondi's real headland shelves, pulled
 * across the middle — see REEF below) and the water beyond it is scenery.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const SHIVAM = {
  /** Half-extent along the beach. The side walls sit on ±halfX. */
  halfX: 42,
  /** The back of Campbell Parade — the north perimeter hoarding. */
  zBack: -30,
  /** Street -> lawn and lawn -> promenade terrace steps. */
  zStreet: -22,
  zLawn: -14,
  /** The promenade sea wall line: promenade north of it, sand south. */
  zWall: 0,
  /** Last open sand — the surf/reef line seals everything past this. */
  zSurf: 15.5,
  /** Terrace tops. Each step is 0.45 m: mantleable up, droppable down. */
  yStreet: 2.2,
  yLawn: 1.75,
  yProm: 1.3,
  /** Sand height at the foot of the sea wall; it falls to 0 at beachToe. */
  beachTop: 0.32,
  beachToe: 14,
  /** The sea wall above the promenade: cover you can vault, not a fence. */
  wallH: 0.48,
};

/**
 * The Icebergs pool deck: a concrete apron over the water at the south-east
 * corner, reached from the promenade at its north edge and from the sand by
 * one stair in its west parapet.
 */
export const DECK = { x0: 24, z0: 0, x1: 42, z1: 26, y: 1.1, railH: 1.0 };

/**
 * The pool sunk in the deck. The floor is 0.45 m below the coping — a wading
 * detour with a mantle out anywhere along the rim, never a trap.
 */
export const POOL = { x0: 27.5, z0: 11, x1: 38.5, z1: 23.5, waterY: 0.78, floorY: 0.65 };

/**
 * The structures. `w`/`d` are outer X/Z extents, `h` the wall height above
 * each structure's own floor (`floorY`). Shape matches the market's
 * `BUILDINGS` entries closely enough for `ui/minimap` to draw them.
 */
export const STRUCTURES = [
  { id: 'pavilion', x: 0, z: -9.5, w: 26, d: 9, h: 5.2, floorY: SHIVAM.yProm },
  { id: 'clubhouse', x: 33, z: 4, w: 12, d: 8, h: 4.6, floorY: DECK.y },
  { id: 'kiosk', x: -33, z: -9, w: 8, d: 6, h: 3.2, floorY: SHIVAM.yProm },
  { id: 'tower', x: -8, z: 9, w: 3.4, d: 3.4, h: 5.5, floorY: 0 },
];

/** The lifeguard tower's numbers, shared by the build and the self-test. */
export const TOWER = {
  x: -8,
  z: 9,
  /** Platform height over the sand, and its size. Walk-under below. */
  deckY: 3.1,
  half: 1.7,
  /** Canopy height; parapet half-walls keep everyone on it honest. */
  roofY: 5.5,
  parapetH: 0.95,
};

/**
 * Where the sea wall opens for a stair down to the sand. Three of them:
 * one per flank and one on the pavilion's axis. `w` is the gap width.
 */
export const WALL_GAPS = [-24, 0, 14];
export const WALL_GAP_W = 2.0;

/** The sea wall's own rect (its centre line sits just inside the promenade). */
export const WALL_Z0 = -0.35;
export const WALL_Z1 = -0.05;

/**
 * Roof stairs need their run-ups kept clear — a stall dropped on a stair
 * foot is the one dressing mistake that deletes a route. Published so the
 * dressing pass and the self-test read the same numbers.
 */
export const PAVILION_STAIR = { x: -2, footZ: -21.2 };
export const KIOSK_STAIR = { x: -33, footZ: -2.4 };
export const CLUB_STAIR = { x: 36, footZ: -4.8 };
export const DECK_STAIR_Z = 4; // the beach stair in the deck's west parapet

/** Deterministic 0..1 hash for the rock tables — no rng at module scope. */
const hash01 = (i, s) => ((i * s) % 97) / 97;

/**
 * THE REEF: the rock shelf across the surf line, `[x, z, r]`.
 *
 * The one perimeter that cannot be a wall. Rocks every 1.7 m with radii
 * 1.4–1.9 m, so adjacent collision rects always overlap and the chain is
 * continuous from the west wall to the deck's west face — the self-test
 * walks the line to prove it. East of the last rock the Icebergs deck and
 * its parapets seal the rest of the waterline.
 */
export const REEF = Array.from({ length: 40 }, (_, i) => [
  -42 + i * 1.7,
  17.4 + (hash01(i, 37) - 0.5) * 1.4,
  1.4 + hash01(i, 53) * 0.5,
]);

/**
 * The west headland rocks, `[x, z, r]`: North Bondi's outcrop, pulled in to
 * seal the sand's west edge between the sea wall and the reef corner.
 */
export const WEST_ROCKS = Array.from({ length: 10 }, (_, i) => [
  -41 + hash01(i, 29) * 0.8,
  0.9 + i * 1.85,
  1.4 + hash01(i, 41) * 0.5,
]);

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that
 * looks at the Pavilion, so nobody spawns staring at a wall.
 *
 * INDEX 0 is the boot/dev spawn (exempt from validation): mid-beach,
 * looking north over the sea wall at the Pavilion with the tower on the
 * left — the establishing shot.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - 0, z - -9.5) + turn;
export const SHIVAM_SPAWNS = [
  [4, 11.5, 0, 'beach-mid'], // FROZEN — boot spawn
  [-3, 10, 0.2, 'beach-mid'],
  [10, 9.5, -0.2, 'beach-mid'],
  [1.5, 5.5, 0.15, 'beach-mid'],

  [-25, 8, 0.25, 'beach-west'],
  [-31, 4.5, 0.35, 'beach-west'],
  [-21, 12, 0, 'beach-west'],
  [-28.5, 11.5, 0.3, 'beach-west'],

  [16, 7, -0.25, 'beach-east'],
  [20, 12, -0.35, 'beach-east'],
  [14.5, 12.5, 0, 'beach-east'],

  [-30, -26, 0.3, 'street-west'],
  [-36, -25.5, 0.4, 'street-west'],
  [-23, -26.5, 0.2, 'street-west'],

  [26, -26, -0.3, 'street-east'],
  [33, -25.5, -0.4, 'street-east'],
  [19, -26.5, -0.2, 'street-east'],

  [-12, -18, 0.2, 'lawn'],
  [-5.5, -17.5, 0, 'lawn'],
  [6, -18.5, 0, 'lawn'],
  [12.5, -17.5, -0.2, 'lawn'],

  [-39.5, -3, 0.4, 'kiosk'],
  [-27, -3.5, 0.1, 'kiosk'],
  [-34, -2.5, 0.3, 'kiosk'],
  [-39.5, -13, 0.5, 'kiosk'],

  [-8.5, -2.5, 0.4, 'pavilion-front'],
  [8.5, -2.5, -0.4, 'pavilion-front'],
  [0, -2.8, 0, 'pavilion-front'],

  [17.5, -7.5, -0.3, 'promenade-east'],
  [23, -3, -0.2, 'promenade-east'],
  [14, -11.5, 0, 'promenade-east'],

  [25.6, 13, 0.3, 'icebergs'],
  [25.6, 24.6, 0.5, 'icebergs'],
  [40.3, 15, -0.5, 'icebergs'],
  [33, 24.6, 0, 'icebergs'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) {
    if (s.id === 'tower') continue; // walk-under: only its legs are solid
    out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  }
  out.push([POOL.x0, POOL.z0, POOL.x1, POOL.z1]); // wading water, not a spawn
  // the sea wall, in segments between the stair gaps
  const xs = [-SHIVAM.halfX, ...WALL_GAPS.flatMap((g) => [g - WALL_GAP_W / 2, g + WALL_GAP_W / 2]), DECK.x0];
  for (let i = 0; i < xs.length; i += 2) out.push([xs[i], WALL_Z0, xs[i + 1], WALL_Z1]);
  // the deck parapets: west (split by the beach stair gap), south, east
  out.push([DECK.x0, DECK.z0, DECK.x0 + 0.3, DECK_STAIR_Z - 0.7]);
  out.push([DECK.x0, DECK_STAIR_Z + 0.7, DECK.x0 + 0.3, DECK.z1]);
  out.push([DECK.x0, DECK.z1 - 0.3, DECK.x1, DECK.z1]);
  out.push([DECK.x1 - 0.3, DECK.z0, DECK.x1, DECK.z1]);
  // the rock chains
  for (const [x, z, r] of REEF) out.push([x - r * 0.75, z - r * 0.75, x + r * 0.75, z + r * 0.75]);
  for (const [x, z, r] of WEST_ROCKS) out.push([x - r * 0.75, z - r * 0.75, x + r * 0.75, z + r * 0.75]);
  // perimeter walls
  out.push([-SHIVAM.halfX, SHIVAM.zBack - 0.2, SHIVAM.halfX, SHIVAM.zBack + 0.2]);
  out.push([-SHIVAM.halfX - 0.2, SHIVAM.zBack, -SHIVAM.halfX + 0.2, SHIVAM.zWall]);
  out.push([SHIVAM.halfX - 0.2, SHIVAM.zBack, SHIVAM.halfX + 0.2, SHIVAM.zWall]);
  // the bus shelter on the street
  out.push([10.8, -23.8, 13.2, -22.9]);
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the ground. */
export function inSolidShivam(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/**
 * Can a character stand here, in LEVEL space? Inside the perimeter, north of
 * the water, off every footprint. Only ever a first filter — real collision
 * decides, in `buildSpawnPoints`.
 */
export function standableAtShivam(x, z, margin = 0.55) {
  if (Math.abs(x) > SHIVAM.halfX - 0.9 - margin) return false;
  if (z < SHIVAM.zBack + 0.9 + margin) return false;
  if (x >= DECK.x0 + margin) {
    if (z > DECK.z1 - 0.6 - margin) return false; // past the deck's south parapet
  } else if (z > SHIVAM.zSurf - margin) {
    return false; // the surf
  }
  return !inSolidShivam(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenShivam(x, z, m = 0.3) {
  if (Math.abs(x) > SHIVAM.halfX - 0.6) return false;
  if (z < SHIVAM.zBack + 0.6) return false;
  if (x >= DECK.x0 + m) {
    if (z > DECK.z1 - 0.5) return false;
  } else if (z > SHIVAM.zSurf) {
    return false;
  }
  return !inSolidShivam(x, z, m);
}

/** Sand and seabed height alone — what the terrain mesh samples. */
function sandY(z) {
  if (z < SHIVAM.zWall) return SHIVAM.beachTop;
  if (z < SHIVAM.beachToe) return SHIVAM.beachTop * (1 - z / SHIVAM.beachToe);
  return -(z - SHIVAM.beachToe) * 0.11;
}

/**
 * Analytic floor height. Flat terraces north of the wall (every one of them
 * BUILT as a slab, so the steps are crisp), a gentle sand fall south of it,
 * and the deck/pool answered explicitly because spawns and props on the
 * apron must not be dropped at sand height under it.
 */
export function groundYShivam(x, z) {
  if (x >= DECK.x0 && x <= DECK.x1 && z >= DECK.z0 && z <= DECK.z1) {
    if (x >= POOL.x0 && x <= POOL.x1 && z >= POOL.z0 && z <= POOL.z1) return POOL.floorY;
    return DECK.y;
  }
  if (z < SHIVAM.zStreet) return SHIVAM.yStreet;
  if (z < SHIVAM.zLawn) return SHIVAM.yLawn;
  if (z < SHIVAM.zWall) return SHIVAM.yProm;
  return sandY(z);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* geometry helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _wp = [0, 0];

/** A structural member between two points — same trick as Rust's derrick. */
function strut(A, key, x0, y0, z0, x1, y1, z1, t, masks) {
  _dir.set(x1 - x0, y1 - y0, z1 - z0);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.divideScalar(len);
  _quat.setFromUnitVectors(_up, _dir);
  _pos.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  _scl.set(t, len, t);
  _mat4.compose(_pos, _quat, _scl);
  A.add(key, BOX(A), _mat4, { masks: masks ?? [0.75, 0.4, 0.2] });
}

/** Point `u` metres along a wall centred at (cx, cz) and rotated by `ry`. */
function alongWall(cx, cz, ry, u, out) {
  out[0] = cx + Math.cos(ry) * u;
  out[1] = cz - Math.sin(ry) * u;
  return out;
}

/**
 * One storey of wall with real openings punched through it — the solid spans
 * between holes plus a lintel over and a sill under each, so a doorway is a
 * genuine hole in the collision hull. Same contract as Rust's.
 */
function wallWithHoles(A, key, cx, cz, ry, len, y0, h, t, holes = [], opts = {}) {
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

/** A horizontal deck plate: merged slab, collision proxy, optional beams. */
function deck(A, key, cx, y, cz, w, d, opts = {}) {
  const t = opts.t ?? 0.22;
  A.add(key, BOX(A), LL(IDENT, cx, y - t / 2, cz, opts.ry ?? 0, w, t, d), {
    masks: opts.masks ?? [0.6, 0.5, 0.3],
  });
  A.box(A.surfaceOf(key), cx, y - t / 2, cz, w, t, d, opts.ry ?? 0);
  if (opts.beams) {
    const n = Math.max(2, Math.round(w / 1.6));
    for (let i = 0; i <= n; i++) {
      const x = cx - w / 2 + (i / n) * w;
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, x, y - t - 0.09, cz, 0, 0.11, 0.2, d), {
        masks: [0.6, 0.55, 0.5],
      });
    }
  }
}

/** One straight run of handrail — one thin collision slab, not a bar each. */
function railRun(A, key, x0, z0, x1, z1, y, h = 1.06) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.15) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  for (const yy of [y + h, y + h * 0.52]) {
    A.add(key, BOX_THIN(A), LL(IDENT, mx, yy, mz, ry, len, 0.055, 0.055), { masks: [0.85, 0.35, 0.05] });
  }
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    A.add(key, BOX_THIN(A),
      LL(IDENT, x0 + ((x1 - x0) * i) / n, y + h / 2, z0 + ((z1 - z0) * i) / n, 0, 0.06, h, 0.06),
      { masks: [0.85, 0.4, 0.1] });
  }
  A.box('metal', mx, y + h * 0.55, mz, len, h * 1.1, 0.1, ry);
}

/**
 * A parapet around a roof, with real gaps where a stair lands on it — same
 * reasoning as Rust's: a rail across the top step is a stair into a wall.
 * `gaps` is `{ n|s|e|w: [{ u, w }] }` in wall-local coordinates.
 */
function roofParapet(A, key, cx, cz, w, d, y, opts = {}) {
  const h = opts.h ?? 0.82;
  const t = opts.t ?? 0.26;
  const gaps = opts.gaps ?? {};
  const sides = [
    ['n', cx, cz - d / 2 + t / 2, 0, w],
    ['s', cx, cz + d / 2 - t / 2, 0, w],
    ['e', cx + w / 2 - t / 2, cz, Math.PI / 2, d],
    ['w', cx - w / 2 + t / 2, cz, Math.PI / 2, d],
  ];
  for (const [k, px, pz, ry, len] of sides) {
    const g = gaps[k] ?? [];
    wallWithHoles(A, key, px, pz, ry, len, y, h, t, g.map((o) => ({ u: o.u, w: o.w, y: 0, h })), {
      masks: [0.55, 0.5, 0.3],
    });
    wallWithHoles(A, opts.copingKey ?? 'stone_pale', px, pz, ry, len, y + h, 0.1, t + 0.12,
      g.map((o) => ({ u: o.u, w: o.w, y: 0, h: 0.1 })), { masks: [0.85, 0.3, 0.1] });
  }
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

/**
 * A flight of steps from (x, y, z) up to `top`, climbing in the direction
 * `ry` points. Returns the LEVEL-space landing point so a switchback is two
 * calls that cannot drift apart. Same 42° geometry as Rust.
 */
function flight(A, x, y, z, ry, top, w = 1.4, opts = {}) {
  const rise = opts.rise ?? 0.275;
  const run = opts.run ?? 0.3;
  const steps = Math.max(1, Math.round((top - y) / rise));
  stairRun(A, panel(x, y, z, ry), 0, 0, 0, w, steps, (top - y) / steps, run, {
    key: opts.key ?? 'concrete',
    railing: opts.railing ?? true,
    stringer: opts.stringer !== false,
  });
  const len = steps * run;
  return { top, len, x: x + Math.sin(ry) * len, z: z + Math.cos(ry) * len };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/** The sand, the sea and the three built terraces above them. */
function buildGround(A, rng) {
  const S = SHIVAM;

  // -------------------------------------------------------- sand and sea --
  // One plane from just under the promenade out past the surf. The deck and
  // the terraces sit on top of it; the water plane hides everything past the
  // reef. Sampled from `sandY`, NOT `groundYShivam` — the apron answers for
  // itself and the sand runs on underneath it, the way the real deck stands
  // over the beach.
  const terrain = new THREE.PlaneGeometry(100, 44, 50, 26);
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(0, 0, 20.8); // z -1.2 .. 42.8
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const z = pa.getZ(i);
    const ripple = (fbm3(x * 0.18, 7.3, z * 0.3, 2) - 0.5) * 0.06;
    pa.setY(i, sandY(z) + (z > 0 ? ripple : 0));
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.4, 3.1, z * 0.4, 2);
    out[0] = 0.15 + n * 0.2;
    // the wet band: sand darkens toward the waterline
    out[1] = 0.1 + Math.max(0, Math.min(1, (z - 11) / 5)) * 0.5 + n * 0.15;
  });
  A.add('sand', terrain, null);
  A.collideGeo('sand', terrain);
  terrain.dispose();

  // the ocean: one sheet out to the horizon. Waterline lands near z = 16.
  const sea = new THREE.PlaneGeometry(170, 50, 4, 4);
  sea.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', sea, LL(IDENT, 0, -0.22, 40.5), { masks: [0.1, 0.1, 0] });

  // surf foam: pale scraps along the waterline, flat and cheap
  for (let i = 0; i < 9; i++) {
    const x = -40 + i * 8 + rng.range(-2, 2);
    if (x > DECK.x0 - 2) continue;
    A.addOnce('plaster_white',
      patchGeometry(rng, rng.range(2.2, 4.5), { lobes: 9, wobble: 0.5 }),
      LL(IDENT, x, -0.13, 15.9 + rng.range(-0.4, 0.6), rng.float() * 6.283, 1, 1, rng.range(0.16, 0.28)),
      { masks: [0.95, 0.05, 0] });
  }

  // ----------------------------------------------------------- terraces --
  // Street, lawn, promenade: one solid slab each, poured from below beach
  // level so the faces read as retaining walls, plus a stone fascia and
  // coping strip along each step edge.
  const W = S.halfX * 2;
  const slab = (key, z0, z1, top, masks) => {
    const cz = (z0 + z1) / 2;
    A.add(key, BOX(A), LL(IDENT, 0, (top - 0.5) / 2, cz, 0, W, top + 0.5, z1 - z0), { masks });
    A.box('concrete', 0, (top - 0.5) / 2, cz, W, top + 0.5, z1 - z0);
  };
  slab('asphalt', S.zBack, S.zStreet, S.yStreet, [0.3, 0.5, 0.2]);
  slab('lawn', S.zStreet, S.zLawn, S.yLawn, [0.25, 0.35, 0.15]);
  slab('deck_pale', S.zLawn, S.zWall, S.yProm, [0.5, 0.4, 0.2]);
  for (const [z, top] of [[S.zStreet, S.yStreet], [S.zLawn, S.yLawn]]) {
    A.add('stone_pale', BOX(A), LL(IDENT, 0, top - 0.26, z + 0.09, 0, W, 0.56, 0.18), {
      masks: [0.6, 0.45, 0.3],
    });
    A.add('stone_pale', BOX_SOFT(A), LL(IDENT, 0, top + 0.02, z + 0.12, 0, W, 0.08, 0.3), {
      masks: [0.85, 0.3, 0.1],
    });
  }

  // kerb between footpath and roadway, and the painted centre line
  A.add('concrete', BOX_THIN(A), LL(IDENT, 0, S.yStreet + 0.05, S.zStreet - 3.4, 0, W, 0.12, 0.24), {
    masks: [0.7, 0.4, 0.2],
  });
  for (let x = -38; x < 40; x += 5.4) {
    A.add('paint_yellow', BOX_THIN(A), LL(IDENT, x, S.yStreet + 0.015, S.zBack + 3.6, 0, 2.4, 0.015, 0.14), {
      masks: [0.9, 0.35, 0],
    });
  }
}

/**
 * The perimeter that is not the sea: the Campbell Parade hoarding across the
 * north, side walls east and west, and the backdrop that keeps any of it
 * from meeting the sky in a bare line.
 */
function buildPerimeter(A, rng) {
  const S = SHIVAM;
  const W = S.halfX * 2;

  // the shopfront hoarding: solid wall, pilasters, awnings — no holes
  wallWithHoles(A, 'plaster_cream', 0, S.zBack, 0, W, S.yStreet, 3.2, 0.3, [], {
    masks: [0.55, 0.45, 0.25],
  });
  for (let x = -S.halfX; x <= S.halfX; x += 7) {
    A.add('plaster_white', BOX(A), LL(IDENT, x, S.yStreet + 1.7, S.zBack + 0.24, 0, 0.5, 3.4, 0.24), {
      masks: [0.65, 0.4, 0.2],
    });
  }
  A.add('stone_pale', BOX(A), LL(IDENT, 0, S.yStreet + 3.3, S.zBack, 0, W, 0.24, 0.5), {
    masks: [0.8, 0.35, 0.1],
  });
  for (let i = 0; i < 8; i++) {
    const x = -37 + i * 10.6;
    A.add(i % 2 ? 'fabric_teal' : 'fabric_red', BOX_THIN(A),
      LL(IDENT, x, S.yStreet + 2.35, S.zBack + 0.75, 0, 4.6, 0.08, 1.3, 0, 0, -0.25), {
        masks: [0.8, 0.25, 0.1],
      });
  }

  // side walls down to the sea wall line
  for (const sx of [-1, 1]) {
    wallWithHoles(A, 'stone_pale', sx * S.halfX, (S.zBack + S.zWall) / 2, Math.PI / 2,
      S.zWall - S.zBack, 1.0, 3.6, 0.4, [], { masks: [0.5, 0.5, 0.3] });
  }

  // backdrop: the parade's far shopfronts, past the hoarding. Visual only.
  const shops = [
    [-33, 6.2, 15, 'plaster_cream'],
    [-17, 4.6, 13, 'plaster_pink'],
    [-3, 7.4, 14, 'brick_red'],
    [12, 5.2, 12, 'plaster_white'],
    [27, 6.6, 15, 'plaster_sand'],
    [39, 4.4, 9, 'plaster_cream'],
  ];
  for (const [x, h, w, key] of shops) {
    A.add(key, BOX(A), LL(IDENT, x, S.yStreet + h / 2, S.zBack - 4.6, 0, w, h, 6), {
      masks: [0.45, 0.5, 0.3],
    });
  }

  // the headlands: grassed mounds and big rocks past each side wall, so the
  // skyline off the flanks is land falling to the sea rather than a cut-out
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const x = sx * (S.halfX + 3 + i * 2.2 + rng.range(0, 1.5));
      const z = -18 + i * 6 + rng.range(-2, 2);
      const s = rng.range(1.6, 3.4);
      A.addOnce('stone_grey', rockGeometry(rng, s, 1, rng.range(0.5, 0.75)),
        LL(IDENT, x, groundYShivam(sx * (S.halfX - 1), z) - s * 0.35, z, rng.float() * 6.283),
        { masks: [0.4, 0.55, 0.35] });
    }
    const berm = driftBerm(rng, 26, 9, 2.6);
    A.addOnce('lawn', berm, LL(IDENT, sx * (S.halfX + 8), 0.4, -12, sx > 0 ? 0.3 : -0.3), {
      masks: [0.25, 0.4, 0.2],
    });
  }
}

/**
 * The sea wall and its three stairs. 0.48 m of cover on the promenade side —
 * vault it and drop to the sand — and with the terrace face below it, a
 * 1.5 m wall over the beach that funnels the way back up through the stairs.
 */
function buildSeaWall(A, rng) {
  const S = SHIVAM;
  const cz = (WALL_Z0 + WALL_Z1) / 2;
  // The wall runs from -halfX to the deck's west face, so its centre sits
  // west of the origin and each gap is shifted into wall-local u.
  const cx = (DECK.x0 - S.halfX) / 2;
  const holes = WALL_GAPS.map((g) => ({ u: g - cx, w: WALL_GAP_W, y: 0, h: S.wallH }));
  wallWithHoles(A, 'plaster_white', cx, cz, 0, DECK.x0 + S.halfX, S.yProm, S.wallH,
    WALL_Z1 - WALL_Z0, holes, { masks: [0.7, 0.35, 0.15] });

  // coping
  wallWithHoles(A, 'stone_pale', cx, cz, 0, DECK.x0 + S.halfX,
    S.yProm + S.wallH, 0.09, WALL_Z1 - WALL_Z0 + 0.14,
    holes.map((o) => ({ u: o.u, w: o.w, y: 0, h: 0.09 })), {
      masks: [0.85, 0.3, 0.1],
    });

  // the three stairs down to the sand, each landing inside its wall gap
  for (const gx of WALL_GAPS) {
    const foot = { x: gx, z: 1.15 };
    flight(A, foot.x, groundYShivam(foot.x, foot.z) - 0.02, foot.z, Math.PI, S.yProm, 1.6, {
      key: 'concrete',
      railing: false,
    });
  }
}

/**
 * THE PAVILION — the landmark.
 *
 * A cream colonnaded hall: four open arches onto the promenade, three rooms
 * inside, and an external switchback off the lawn up to a parapeted roof
 * that overlooks everything south of the parade. Its floor is the promenade
 * slab; its back wall stands against the lawn terrace.
 */
function buildPavilion(A, rng, s) {
  const t = 0.32;
  const { x, z, w, d, h } = s;
  const f = s.floorY;
  const roof = f + h;
  const key = 'plaster_cream';
  const sides = [
    [x, z - d / 2, 0, w], // n — against the lawn
    [x + w / 2, z, Math.PI / 2, d], // e
    [x, z + d / 2, 0, w], // s — the colonnade, onto the promenade
    [x - w / 2, z, Math.PI / 2, d], // w
  ];
  const holes = [
    [
      { u: -10, w: 2.0, y: 1.55, h: 1.4 },
      { u: -4, w: 2.0, y: 1.55, h: 1.4 },
      { u: 4, w: 2.0, y: 1.55, h: 1.4 },
      { u: 10, w: 2.0, y: 1.55, h: 1.4 },
    ],
    [{ u: 0, w: 1.8, y: 0, h: 2.5 }, { u: -3, w: 1.8, y: 1.55, h: 1.3 }],
    [
      // the colonnade: four openings, piers between
      { u: -9.75, w: 3.0, y: 0, h: 3.4 },
      { u: -3.25, w: 3.0, y: 0, h: 3.4 },
      { u: 3.25, w: 3.0, y: 0, h: 3.4 },
      { u: 9.75, w: 3.0, y: 0, h: 3.4 },
    ],
    [{ u: 0, w: 1.8, y: 0, h: 2.5 }, { u: 3, w: 1.8, y: 1.55, h: 1.3 }],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    wallWithHoles(A, key, cx, cz, ry, len, f, h, t, holes[i], { masks: [0.55, 0.45, 0.22] });
  }

  // floor and roof
  A.add('tile_floor', BOX(A), LL(IDENT, x, f + 0.05, z, 0, w - t, 0.1, d - t), { masks: [0.45, 0.5, 0.35] });
  A.box('concrete', x, f + 0.05, z, w - t, 0.1, d - t);
  deck(A, 'roof_screed', x, roof, z, w, d, { t: 0.3 });

  // interior: two partitions make a hall and two side rooms
  for (const px of [-6, 6]) {
    wallWithHoles(A, 'plaster_white', x + px, z, Math.PI / 2, d - t, f, h - 1.4, 0.2,
      [{ u: px > 0 ? -1.4 : 1.4, w: 1.3, y: 0, h: 2.3 }], { masks: [0.5, 0.4, 0.35] });
  }
  // the hall's two columns, holding the long roof span visually honest
  for (const px of [-2.5, 2.5]) {
    A.add('plaster_white', BOX(A), LL(IDENT, x + px, f + h / 2, z, 0, 0.5, h, 0.5), {
      masks: [0.6, 0.4, 0.3],
    });
    A.box('concrete', x + px, f + h / 2, z, 0.5, h, 0.5);
  }

  // the roof: parapet with a gap where the stair lands, and the central
  // blocked arch that gives the skyline its one unmistakable shape
  roofParapet(A, key, x, z, w, d, roof, {
    h: 0.85,
    t: 0.26,
    gaps: { n: [{ u: PAVILION_STAIR.x - x, w: 1.7 }] },
  });
  A.add(key, BOX_SOFT(A), LL(IDENT, x, roof + 0.95, z, 0, 6.2, 1.9, 1.3), { masks: [0.6, 0.4, 0.2] });
  A.box('concrete', x, roof + 0.95, z, 6.2, 1.9, 1.3);
  A.add('terracotta', BOX_SOFT(A), LL(IDENT, x, roof + 2.05, z, 0, 6.8, 0.35, 1.7), {
    masks: [0.7, 0.35, 0.15],
  });
  A.put('roof_vent', x - 8.5, roof, z + 1.5, 0.4, 1.1);
  A.put('ac_unit', x + 8, roof, z - 1.5, -1.1, 1.05);

  // the external switchback: lawn -> landing -> roof, up the north face
  const ex = PAVILION_STAIR.x;
  const zEdge = z - d / 2;
  const mid = SHIVAM.yLawn + (roof - SHIVAM.yLawn) / 2;
  const l2 = flightLength(mid, roof);
  const l1 = flightLength(SHIVAM.yLawn, mid);
  // A straight double run: lawn -> rest landing -> roof, both flights
  // climbing south, so the exit at every stage is straight ahead. The
  // landing is rail-sided east and west; its north and south edges are the
  // stairs themselves.
  flight(A, ex, SHIVAM.yLawn, zEdge - l2 - 1.8 - l1, 0, mid, 1.25);
  deck(A, 'concrete', ex, mid, zEdge - l2 - 0.9, 1.6, 1.8, { t: 0.16 });
  railRun(A, 'frame_white', ex - 0.75, zEdge - l2 - 1.8, ex - 0.75, zEdge - l2, mid);
  railRun(A, 'frame_white', ex + 0.75, zEdge - l2 - 1.8, ex + 0.75, zEdge - l2, mid);
  flight(A, ex, mid, zEdge - l2, 0, roof, 1.25);

  A.interiorLights.push({ x: x - 9, y: f + h - 1.2, z });
  A.interiorLights.push({ x, y: f + h - 1.6, z });
  A.interiorLights.push({ x: x + 9, y: f + h - 1.2, z });
}

/**
 * THE ICEBERGS — the pool deck over the surf, and its clubhouse.
 *
 * The apron is a solid pour around a sunken wading pool; the clubhouse
 * stands at the deck's north end with a stair up its east lane to a roof
 * deck. One gap in the west parapet takes a short flight down to the sand.
 */
function buildIcebergs(A, rng, s) {
  const D = DECK;
  const P = POOL;

  // the apron, as four plates around the pool opening
  const plate = (x0, z0, x1, z1) => {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    A.add('deck_pale', BOX(A), LL(IDENT, cx, (D.y - 0.6) / 2, cz, 0, x1 - x0, D.y + 0.6, z1 - z0), {
      masks: [0.55, 0.4, 0.2],
    });
    A.box('concrete', cx, (D.y - 0.6) / 2, cz, x1 - x0, D.y + 0.6, z1 - z0);
  };
  plate(D.x0, D.z0, D.x1, P.z0);
  plate(D.x0, P.z1, D.x1, D.z1);
  plate(D.x0, P.z0, P.x0, P.z1);
  plate(P.x1, P.z0, D.x1, P.z1);

  // the pool: shell, visible floor just under the wading collider, water
  const cx = (P.x0 + P.x1) / 2;
  const cz = (P.z0 + P.z1) / 2;
  const pw = P.x1 - P.x0;
  const pd = P.z1 - P.z0;
  A.add('concrete', BOX(A), LL(IDENT, cx, (P.floorY - 0.6) / 2, cz, 0, pw, P.floorY + 0.5, pd), {
    masks: [0.5, 0.45, 0.3],
  });
  A.box('concrete', cx, (P.floorY - 0.6) / 2, cz, pw, P.floorY + 0.5, pd);
  A.add('pool_tile', BOX(A), LL(IDENT, cx, P.floorY - 0.08, cz, 0, pw - 0.2, 0.1, pd - 0.2), {
    masks: [0.45, 0.4, 0.25],
  });
  for (const [sx, sz, sw, sd] of [
    [cx, P.z0 + 0.14, pw, 0.28],
    [cx, P.z1 - 0.14, pw, 0.28],
    [P.x0 + 0.14, cz, 0.28, pd - 0.5],
    [P.x1 - 0.14, cz, 0.28, pd - 0.5],
  ]) {
    A.add('pool_tile', BOX(A), LL(IDENT, sx, (P.floorY + D.y) / 2, sz, 0, sw, D.y - P.floorY, sd), {
      masks: [0.5, 0.4, 0.25],
    });
    A.box('concrete', sx, (P.floorY + D.y) / 2, sz, sw, D.y - P.floorY, sd);
  }
  // the wading floor the player actually stands on, tagged water for the FX
  A.box('water', cx, P.floorY - 0.2, cz, pw - 0.5, 0.4, pd - 0.5);
  const water = new THREE.PlaneGeometry(pw - 0.2, pd - 0.2, 1, 1);
  water.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', water, LL(IDENT, cx, P.waterY, cz));
  // coping, proud of the deck
  for (const [sx, sz, sw, sd] of [
    [cx, P.z0 - 0.25, pw + 1.0, 0.5],
    [cx, P.z1 + 0.25, pw + 1.0, 0.5],
    [P.x0 - 0.25, cz, 0.5, pd],
    [P.x1 + 0.25, cz, 0.5, pd],
  ]) {
    A.add('plaster_white', BOX_SOFT(A), LL(IDENT, sx, D.y + 0.035, sz, 0, sw, 0.09, sd), {
      masks: [0.8, 0.3, 0.1],
    });
  }

  // parapets: west (with the beach-stair gap), south over the surf, east
  // against the headland. Solid — a 1 m wall is what stands between the
  // deck and the water, and the self-test counts on these rects.
  const wallSeg = (cx2, cz2, ry, len, gaps = []) =>
    wallWithHoles(A, 'plaster_white', cx2, cz2, ry, len, D.y, D.railH, 0.3,
      gaps.map((g) => ({ u: g.u, w: g.w, y: 0, h: D.railH })), { masks: [0.65, 0.4, 0.2] });
  wallSeg(D.x0 + 0.15, (D.z0 + D.z1) / 2, Math.PI / 2, D.z1 - D.z0,
    [{ u: DECK_STAIR_Z - (D.z0 + D.z1) / 2, w: 1.4 }]);
  wallSeg((D.x0 + D.x1) / 2, D.z1 - 0.15, 0, D.x1 - D.x0);
  wallSeg(D.x1 - 0.15, (D.z0 + D.z1) / 2, Math.PI / 2, D.z1 - D.z0);

  // the stair down to the sand through the west parapet
  flight(A, D.x0 - 0.45, groundYShivam(D.x0 - 1.2, DECK_STAIR_Z) - 0.02, DECK_STAIR_Z, Math.PI / 2, D.y, 1.2, {
    key: 'concrete',
    railing: false,
  });

  // rocks under the deck's seaward corners — the apron stands over the
  // shelf it is actually poured on, and the surf line needs the mass
  for (const [rx, rz, rs] of [
    [D.x0 + 2, D.z1 + 2.5, 2.2],
    [D.x1 - 3, D.z1 + 3.5, 2.8],
    [D.x1 + 1.5, D.z0 + 6, 2.4],
  ]) {
    A.addOnce('stone_grey', rockGeometry(rng, rs, 1, rng.range(0.5, 0.7)),
      LL(IDENT, rx, -rs * 0.45, rz, rng.float() * 6.283), { masks: [0.4, 0.6, 0.4] });
  }

  // ----------------------------------------------------- the clubhouse --
  const { x, z, w, d, h } = s;
  const f = s.floorY;
  const roof = f + h;
  const t = 0.28;
  const sides = [
    [x, z - d / 2, 0, w], // n — onto the promenade
    [x + w / 2, z, Math.PI / 2, d], // e — the stair lane
    [x, z + d / 2, 0, w], // s — over the pool
    [x - w / 2, z, Math.PI / 2, d], // w — over the beach
  ];
  const holes = [
    [{ u: -3, w: 1.8, y: 0, h: 2.4 }, { u: 2.5, w: 2.4, y: 1.3, h: 1.5 }],
    [{ u: -1.5, w: 1.6, y: 0, h: 2.4 }],
    [{ u: -2.5, w: 3.0, y: 1.0, h: 1.8 }, { u: 2.5, w: 3.0, y: 1.0, h: 1.8 }],
    [{ u: 0, w: 2.4, y: 1.0, h: 1.6 }],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx2, cz2, ry, len] = sides[i];
    wallWithHoles(A, 'plaster_white', cx2, cz2, ry, len, f, h, t, holes[i], { masks: [0.6, 0.4, 0.2] });
  }
  A.add('floor_concrete', BOX(A), LL(IDENT, x, f + 0.05, z, 0, w - t, 0.1, d - t), { masks: [0.45, 0.55, 0.4] });
  A.box('concrete', x, f + 0.05, z, w - t, 0.1, d - t);
  deck(A, 'roof_screed', x, roof, z, w, d, { t: 0.28 });

  // the roof stair: one long flight off the promenade, climbing straight
  // up the north face and landing on the roof's north edge — clear of the
  // north door at u -3, and its foot is published keep-clear (CLUB_STAIR).
  flight(A, CLUB_STAIR.x, SHIVAM.yProm, CLUB_STAIR.footZ, 0, roof, 1.2);
  roofParapet(A, 'plaster_white', x, z, w, d, roof, {
    h: 0.8,
    t: 0.24,
    gaps: { n: [{ u: CLUB_STAIR.x - x, w: 1.6 }] },
  });

  A.put('water_tank', x - 3.2, roof, z + 1.6, 0.5, 1.0);
  A.put('roof_vent', x + 2.8, roof, z - 1.8, 0.1, 1.1);
  A.interiorLights.push({ x, y: f + h - 0.6, z });
}

/**
 * The lifeguard tower: an open cabin on legs over the sand. Quick to take,
 * exposed to everything — its parapet half-walls are the only cover up
 * there, and everyone underneath can hear the floorboards.
 */
function buildTower(A, rng) {
  const T = TOWER;
  const g = groundYShivam(T.x, T.z);
  // legs and cross-braces
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) {
    strut(A, 'wood_pale', T.x + lx, g - 0.3, T.z + lz, T.x + lx * 0.92, T.deckY, T.z + lz * 0.92, 0.16, [0.6, 0.45, 0.3]);
    A.box('wood', T.x + lx, (g + T.deckY) / 2, T.z + lz, 0.2, T.deckY - g, 0.2);
  }
  for (const s of [-1, 1]) {
    strut(A, 'wood_pale', T.x - 1.2, g + 0.4, T.z + s * 1.2, T.x + 1.2, T.deckY - 0.4, T.z + s * 1.2, 0.09);
    strut(A, 'wood_pale', T.x + 1.2, g + 0.4, T.z + s * 1.2, T.x - 1.2, T.deckY - 0.4, T.z + s * 1.2, 0.09);
  }
  // platform, parapet half-walls (gap on the west edge for the stair)
  deck(A, 'wood_pale', T.x, T.deckY, T.z, T.half * 2, T.half * 2, { t: 0.2, beams: true });
  const hw = (cx, cz, ry, len) => {
    wallWithHoles(A, 'paint_yellow', cx, cz, ry, len, T.deckY, T.parapetH, 0.12, [], {
      masks: [0.75, 0.35, 0.15],
    });
  };
  hw(T.x, T.z - T.half + 0.06, 0, T.half * 2);
  hw(T.x, T.z + T.half - 0.06, 0, T.half * 2);
  hw(T.x + T.half - 0.06, T.z, Math.PI / 2, T.half * 2);
  railRun(A, 'frame_white', T.x - T.half + 0.05, T.z - T.half + 0.05, T.x - T.half + 0.05, T.z - 0.8, T.deckY, 0.95);
  // canopy on corner posts
  for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]]) {
    strut(A, 'wood_pale', T.x + lx * 0.8, T.deckY, T.z + lz * 0.8, T.x + lx * 0.8, T.roofY - 0.2, T.z + lz * 0.8, 0.1);
  }
  A.add('fabric_red', BOX_SOFT(A), LL(IDENT, T.x, T.roofY, T.z, 0, 3.9, 0.14, 3.9, 0, 0, 0.06), {
    masks: [0.8, 0.25, 0.1],
  });
  // the stair up from the sand, landing on the platform's west edge
  const len = flightLength(g, T.deckY);
  flight(A, T.x - T.half - len + 0.0, g, T.z + 0.2, Math.PI / 2, T.deckY, 1.1, { key: 'wood_pale' });
}

/** The kiosk: a pastel gelato bar with a serving window and a roof you can hold. */
function buildKiosk(A, rng, s) {
  const t = 0.26;
  const { x, z, w, d, h } = s;
  const f = s.floorY;
  const roof = f + h;
  const sides = [
    [x, z - d / 2, 0, w],
    [x + w / 2, z, Math.PI / 2, d],
    [x, z + d / 2, 0, w],
    [x - w / 2, z, Math.PI / 2, d],
  ];
  const holes = [
    [{ u: 1, w: 2.0, y: 1.3, h: 1.3 }],
    [{ u: 0.6, w: 1.6, y: 0, h: 2.3 }],
    [{ u: -0.5, w: 3.0, y: 1.2, h: 1.4 }], // the serving window, onto the promenade
    [{ u: 0, w: 1.8, y: 1.3, h: 1.2 }],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    wallWithHoles(A, 'plaster_pink', cx, cz, ry, len, f, h, t, holes[i], { masks: [0.6, 0.4, 0.2] });
  }
  A.add('floor_concrete', BOX(A), LL(IDENT, x, f + 0.05, z, 0, w - t, 0.1, d - t), { masks: [0.45, 0.55, 0.4] });
  A.box('concrete', x, f + 0.05, z, w - t, 0.1, d - t);
  deck(A, 'roof_screed', x, roof, z, w, d, { t: 0.26 });
  // striped awning over the serving window
  A.add('fabric_teal', BOX_THIN(A), LL(IDENT, x - 0.5, f + 2.75, z + d / 2 + 0.55, 0, 3.6, 0.07, 1.2, 0, 0, -0.3), {
    masks: [0.8, 0.25, 0.1],
  });
  // roof stair from the promenade, perpendicular to the south face
  flight(A, KIOSK_STAIR.x, f, KIOSK_STAIR.footZ, Math.PI, roof, 1.2);
  roofParapet(A, 'plaster_pink', x, z, w, d, roof, {
    h: 0.75,
    t: 0.22,
    gaps: { s: [{ u: KIOSK_STAIR.x - x, w: 1.6 }] },
  });
  A.put('table_small', x + 1.4, f + 0.12, z - 0.6, 0.6, 1);
  A.put('shelf', x - 2.6, f + 0.12, z - 1.9, 0, 1);
  A.interiorLights.push({ x, y: f + h - 0.5, z });
}

/** The rock chains: the reef across the surf and the west headland shelf. */
function buildRocks(A, rng) {
  for (const [x, z, r] of [...REEF, ...WEST_ROCKS]) {
    const g = sandY(z);
    // `rockGeometry(size)` comes out at roughly a THIRD to two-thirds of
    // `size` in radius (icosahedron at size/2, noise-scaled 0.62–1.34), so
    // the mesh is built oversize to wrap the proxy the table promises — a
    // proxy poking out of its rock is exactly the invisible wall
    // `collision.selftest.mjs` exists to catch.
    A.addOnce('stone_grey', rockGeometry(rng, r * 2.1, 1, rng.range(0.55, 0.75)),
      LL(IDENT, x, g - r * 0.18, z, rng.float() * 6.283), { masks: [0.35, 0.6, 0.4] });
    A.box('concrete', x, g + 0.25 * r, z, r * 1.5, r * 0.7, r * 1.5);
  }
}

/**
 * Set dressing: the parade, the lawn, the promenade and the sand each get
 * their own furniture. Everything instanced and jittered.
 */
function dressBeach(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.5, scale: 0.06 };
  const S = SHIVAM;
  const free = (x, z, m = 1.0) =>
    !inSolidShivam(x, z, m) &&
    Math.abs(x) < S.halfX - 1.2 &&
    z > S.zBack + 1 &&
    (x >= DECK.x0 ? z < DECK.z1 - 1 : z < S.zSurf - 0.5);
  const drop = (id, x, z, ry, sc = 1) => {
    if (free(x, z, 0.5)) A.put(id, x, groundYShivam(x, z) + 0.02, z, ry, sc);
  };

  // ---- the street: shelter, benches, planters, signs ---------------------
  // bus shelter (its rect is in BLOCKERS)
  const shX = 12;
  const shZ = -23.35;
  for (const px of [-1.1, 1.1]) {
    A.add('steel_frame', BOX(A), LL(IDENT, shX + px, S.yStreet + 1.25, shZ + 0.35, 0, 0.1, 2.5, 0.1), {
      masks: [0.7, 0.4, 0.2],
    });
  }
  A.add('glass', BOX_THIN(A), LL(IDENT, shX, S.yStreet + 1.15, shZ - 0.05, 0, 2.4, 1.9, 0.05), {
    masks: [0.9, 0.1, 0],
  });
  A.add('steel', BOX_SOFT(A), LL(IDENT, shX, S.yStreet + 2.55, shZ + 0.15, 0, 2.8, 0.1, 1.1), {
    masks: [0.8, 0.3, 0.1],
  });
  A.box('metal', shX, S.yStreet + 1.3, shZ, 2.6, 2.6, 0.7);
  drop('bench', shX, -23.1, 0);

  for (const [x, z] of [[-38, -24], [-20, -28], [2, -24.5], [30, -28.5], [39, -24]]) drop('planter', x, z, rng.float() * 6.283);
  drop('sign_board', -14, -23, 0.2);
  drop('sign_board', 22, -29, -0.1);
  for (const [x, z] of [[-33, -22.8], [-6, -22.8], [17, -22.8], [36, -22.8]]) {
    drop('lamp_post', x, z, Math.PI);
  }

  // ---- the lawn: Norfolk pines, benches, the weekend market stalls -------
  // (the pines are Fisher's conifers at 1.6 scale — a Norfolk's silhouette
  // is the same cone, and one prototype is the whole point)
  for (const x of [-36, -27, -18, -9, 7, 16, 25, 34]) {
    if (Math.abs(x - PAVILION_STAIR.x) < 4) continue; // stair run-up stays clear
    drop('conifer', x, -21.2, rng.float() * 6.283, rng.range(1.45, 1.75));
  }
  for (const [x, z, ry] of [[-15, -15.2, 0], [1, -15.4, 0], [20, -15.2, 0]]) drop('bench', x, z, ry);
  drop('stall', -9, -16.5, 0.15);
  drop('stall', 3, -16, -0.1);
  for (const [x, z] of [[-31, -17], [-24, -19.5], [28, -17.5], [35, -19]]) {
    drop('shrub', x, z, rng.float() * 6.283, rng.range(0.9, 1.3));
  }

  // ---- the promenade: palms, planters, benches facing the sea ------------
  for (const [x, z] of [[-20, -1.6], [-14, -12.6], [8, -12.6], [20, -1.6]]) {
    if (!free(x, z, 0.8)) continue;
    A.put('palm_trunk', x, S.yProm, z, rng.float() * 6.283, rng.range(0.95, 1.2));
    A.put('palm_frond', x, S.yProm, z, rng.float() * 6.283, rng.range(0.95, 1.2));
    A.box('wood', x, S.yProm + 1.2, z, 0.4, 2.4, 0.4);
  }
  for (const [x, z, ry] of [[-18, -1.2, Math.PI], [6, -1.2, Math.PI], [-38.5, -5, Math.PI / 2]]) drop('bench', x, z, ry);
  drop('planter', -27, -6, 0.3);
  drop('planter', 10, -6.5, -0.2);
  drop('litter', -22, -3, 0);
  drop('litter', 15, -9, 0);

  // ---- the sand: parasols, loungers, boats, boards, flags ----------------
  const parasols = [[-18, 6], [-12, 3.5], [-27, 10.5], [6, 8], [12, 5], [18, 10], [-2, 3]];
  for (const [x, z] of parasols) {
    drop('parasol', x, z, rng.float() * 6.283, rng.range(0.95, 1.15));
    if (rng.float() < 0.8) drop('lounger', x + rng.range(-1.6, 1.6), z + rng.range(0.8, 1.6), rng.float() * 6.283);
  }
  drop('lounger', -24, 4, 1.2);
  drop('lounger', 21, 7, -0.6);
  drop('dinghy', -15, 11.5, 0.9);
  drop('dinghy', 19.5, 3.2, -1.2);
  A.box('wood', -15, sandY(11.5) + 0.3, 11.5, 2.2, 0.55, 1.1, 0.9);
  A.box('wood', 19.5, sandY(3.2) + 0.3, 3.2, 2.2, 0.55, 1.1, -1.2);
  drop('board_rack', -7, 1.6, 0.1);
  drop('board_rack', 17, 1.4, -0.15);
  drop('flag_swim', -10, 13, 0.3);
  drop('flag_swim', 12, 13, -0.2);

  // ---- the icebergs deck -------------------------------------------------
  A.put('lounger', 25.7, DECK.y, 8.5, Math.PI / 2 + 0.05, 1);
  A.put('lounger', 25.7, DECK.y, 6.3, Math.PI / 2 - 0.04, 1);
  A.put('parasol', 26.2, DECK.y, 7.4, 0.4, 1);

  // ---- small stuff everywhere -------------------------------------------
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-40, 40);
    const z = rng.range(-28, 14);
    if (!free(x, z, 0.5)) continue;
    A.put(rng.pick(['bucket', 'box_card_a', 'bottle', 'can', 'litter']),
      x, groundYShivam(x, z) + 0.02, z, rng.float() * 6.283, rng.range(0.9, 1.15));
  }

  // ---- weeds in the dune line and through the lawn ----------------------
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-S.halfX + 2, S.halfX - 2);
    const z = rng.float() < 0.5 ? rng.range(S.zStreet, S.zLawn) : rng.range(0.2, 2.4);
    if (!free(x, z, 0.35)) continue;
    A.put('weeds', x, groundYShivam(x, z) + 0.02, z, rng.float() * 6.283, rng.range(0.6, 1.2));
  }
  A.jitter = null;
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its
 * own RNG fork — same contract as every other map's `build`.
 */
export function buildShivam(A, rng) {
  registerProps(A, rng);
  registerWilmotProps(A, rng);
  registerFisherProps(A, rng);
  registerShivamProps(A, rng);

  buildGround(A, rng);
  buildPerimeter(A, rng);
  buildSeaWall(A, rng);

  const infos = [];
  for (const s of STRUCTURES) {
    if (s.id === 'pavilion') buildPavilion(A, rng, s);
    else if (s.id === 'clubhouse') buildIcebergs(A, rng, s);
    else if (s.id === 'kiosk') buildKiosk(A, rng, s);
    else buildTower(A, rng);
    infos.push({ spec: s, id: s.id });
  }

  buildRocks(A, rng);
  dressBeach(A, rng);

  return { buildings: infos };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const SHIVAM_MAP = {
  id: 'shivam',
  blurb: 'Terraces down to the sand. Hold the Pavilion roof, vault the sea wall, or swim for the Icebergs.',
  size: '84 × 62 m',
  /**
   * LEVEL -> WORLD. A few tenths off the axes so the terrace steps and the
   * sea wall do not sit parallel to the sun's shadow direction — every mass
   * on the map is a rectangle, and rectangles lit square-on go flat.
   */
  transform: { yaw: 0.35, tx: 0, tz: 0 },
  /**
   * Hugs the perimeter plus a skirt: the surf past the reef and the water
   * beyond the deck are scenery, and nav cells out there are wasted.
   */
  bounds: [-46, -3, -34, 46, 15, 30],
  spawnPoints: SHIVAM_SPAWNS,
  standable: standableAtShivam,
  groundY: groundYShivam,
  isOpen: isOpenShivam,
  build: buildShivam,
};
