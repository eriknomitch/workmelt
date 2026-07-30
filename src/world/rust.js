import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, stairRun, rubbleMound } from './kit.js';
import { registerProps } from './props.js';
import { registerRustProps, CONTAINER } from './rustprops.js';
import {
  fbm3,
  paintMasks,
  patchGeometry,
  driftBerm,
  rockGeometry,
  tubeY,
  chamferBox,
} from './util.js';

/**
 * WORLD — RUST.
 *
 * A low-poly take on the classic Call of Duty map: a disused desert oil
 * refinery, roughly 55 m square, fought over from the ground up. The whole
 * thing is generated here, like every other surface in the game — nothing is
 * loaded from disk.
 *
 *   THE DERRICK   dead centre, 13 m of steel lattice with two stair-connected
 *                 platforms and a gantry running east to the shed roof. The
 *                 map's whole read is "everyone can see the tower, and the man
 *                 on the tower can see everyone".
 *   THE YARD      two rows of shipping containers north and south of the
 *                 derrick and two more on the flanks, leaving four lanes that
 *                 cross under it — the cover pattern the original is built on.
 *   FOUR CORNERS  a two-storey office (NW), an open steel shed with a walkable
 *                 deck (NE), a garage with a roof you can get onto (SW) and a
 *                 pump house among the tanks (SE).
 *
 * LOW POLY IS THE BRIEF, not a shortcut: forms are blocked out in chamfered
 * boxes, struts and capped tubes, and all the surface detail comes from the
 * shared procedural materials — corrugation, rust bloom, edge wear and grime
 * are in the normal/albedo maps and the vertex masks, so the silhouette stays
 * chunky while the surfaces still meet the engine's quality bar.
 *
 * LAYOUT NOTES
 *   Everything is authored in LEVEL space with the yard centred on the origin,
 *   north at -Z. `WorldSystem` bakes the level->world transform into every
 *   vertex, proxy and light, so nothing below has to know about it.
 *
 *   The vertical routes are deliberately few and deliberately stairs: this
 *   engine's character controller mantles low ledges but does not climb
 *   ladders, so every roof reachable by design is reachable by a real flight of
 *   steps. Container roofs are NOT reachable — they are cover, as they mostly
 *   are in the original.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const RUST = {
  /** Half-extent of the fenced yard. The fence line itself sits on this. */
  half: 27.5,
  fenceH: 3.5,
  /** Yard floor. Flat: Rust is a poured slab under blown sand, not terrain. */
  y: 0,
  /** The height every stair-connected deck lands on, so the gantry is level. */
  deckY: 4.4,
};

/** The central derrick. */
export const DERRICK = {
  x: 0,
  z: 0,
  /** Leg spread at the base and at the crown — the taper is the silhouette. */
  base: 3.9,
  top: 1.45,
  height: 13.2,
  /** Lower deck (gantry level) and upper crow's nest. */
  deck: RUST.deckY,
  deckHalf: 3.3,
  /**
   * The nest is CANTILEVERED off the north face rather than centred on the
   * tower, and that is a hard constraint, not a style choice: a stair can only
   * land on a solid platform at its EDGE, so a flight rising inside a 4 m
   * platform would have to come up through it. Offsetting the platform past
   * the stair's top step is how a real derrick's monkey board is reached, and
   * it also gives the tower an asymmetric profile from the yard.
   */
  nest: 8.7,
  nestHalf: 1.9,
  nestZ: -5.4,
  /**
   * Where the switchback up to the deck starts, relative to the tower centre.
   * Published because the yard has to be kept clear here — a container dropped
   * on the stair's run-up is the one placement mistake that makes the map's
   * only route up unreachable.
   */
  stairX: -1.9,
  stairFootZ: 3.9 + 6.0,
};

/**
 * The four corner structures. `w`/`d` are the X/Z extents of the outer shell,
 * `h` the parapet-less height of the mass. Shape matches the market's
 * `BUILDINGS` entries closely enough for `ui/minimap` to draw them.
 */
export const STRUCTURES = [
  { id: 'office', x: -17, z: -15.5, w: 12, d: 9.5, floors: 2, h: 6.4 },
  { id: 'shed', x: 16.5, z: -14.5, w: 13, d: 10, floors: 1, h: RUST.deckY },
  { id: 'garage', x: -16.5, z: 15.5, w: 12.5, d: 9, floors: 1, h: RUST.deckY },
  { id: 'pumphouse', x: 17.5, z: 16.5, w: 9, d: 8, floors: 1, h: 4.1 },
];

/**
 * Containers: `[x, z, ry, tier, proto]`. `tier` 1 sits on top of the tier-0
 * box at the same x/z. Only 0 and π/2 are used for `ry` — the blocker test
 * below reads them as axis-aligned rects, and a yard of containers at random
 * angles reads as a crash site rather than a stack yard.
 */
const H = Math.PI / 2;
export const CONTAINERS = [
  // north row — the lane between these and the derrick is the map's main artery
  [-8.6, -9.5, 0, 0, 'cont_red'],
  [-8.6, -9.5, 0, 1, 'cont_green'],
  [-2.0, -9.5, 0, 0, 'cont_sand'],
  [4.6, -9.5, 0, 0, 'cont_blue'],

  // south row — pushed out to 14.5 m so the derrick's only stair keeps a clear
  // 3 m run-up, and held east of x = -10 so it clears the garage
  [-6.8, 14.5, 0, 0, 'cont_green'],
  [-0.3, 14.5, 0, 0, 'cont_red'],
  [6.2, 14.5, 0, 0, 'cont_sand'],
  [6.2, 14.5, 0, 1, 'cont_blue'],

  // west flank
  [-11.7, -2.0, H, 0, 'cont_blue'],
  [-11.7, 4.6, H, 0, 'cont_sand'],

  // east flank
  [11.7, -2.6, H, 0, 'cont_sand'],
  [11.7, 4.0, H, 0, 'cont_red'],
  [11.7, 4.0, H, 1, 'cont_green'],

  // the scrap stacks behind the pump house
  [21.0, 6.0, H, 0, 'cont_red'],
  [21.0, 6.0, H, 1, 'cont_sand'],
  [21.0, -0.6, H, 0, 'cont_green'],
  [24.5, 13.0, H, 0, 'cont_blue'],

  // the office approach
  [-21.5, -5.0, H, 0, 'cont_green'],
  [-21.5, -5.0, H, 1, 'cont_red'],
  [-19.0, 3.2, 0, 0, 'cont_sand'],

  // north and south edges: the ground a spawn wave comes in behind
  [-0.3, -20.0, 0, 0, 'cont_blue'],
  [6.6, -21.2, 0, 0, 'cont_red'],
  [-7.0, -20.6, 0, 0, 'cont_sand'],
  [0.0, 20.6, 0, 0, 'cont_green'],
  [-9.0, 22.2, 0, 0, 'cont_blue'],
  [9.5, 21.0, 0, 0, 'cont_sand'],

  /**
   * THE GATE BLOCKS. The perimeter has an opening at each end of the yard,
   * which is right — a sealed box of fence reads as a box of fence. But an
   * opening is a hole a player walks out of, and there is nothing outside but
   * desert. So the yard is sealed the way a real disused yard is sealed: a
   * container parked across the gap. 6.06 m of box across a 4.6 m opening,
   * held far enough inside the fence line to stay in the yard.
   */
  [0.0, -26.0, 0, 0, 'cont_red'],
  [0.0, 26.0, 0, 0, 'cont_green'],
];

/** Vertical storage silos: `[x, z, radius, height]`. */
export const SILOS = [
  [14.0, -23.0, 2.6, 7.4],
  [19.8, -24.3, 2.1, 5.8],
  [-24.0, 21.5, 2.4, 6.6],
];

/** Pipe racks: `[x, z, ry, length]` — a run of trestles carrying pipe. */
export const PIPE_RACKS = [
  [-24.0, -1.0, 0, 15],
  [24.2, 12.0, 0, 12],
  [-3.0, 24.3, H, 14],
];

/**
 * Where the gantry turns north for the shed. Held east of the container stacks
 * on the east flank so its midspan column has somewhere to stand, and west of
 * the shed's own stair. The shed reads it to break its south handrail.
 */
export const GANTRY_X = 13.8;

/** Flood masts, which are also this map's street lamps: `[x, z, ry]`. */
export const MASTS = [
  [-8.5, -16.0, 0.6],
  [9.0, 14.0, -2.2],
  [-13.0, 8.0, 1.9],
  [13.5, -5.5, -0.7],
  [1.0, -25.5, 0.2],
];

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the derrick, so nobody spawns staring at a wall and nobody spawns with
 * their back to the lane they have to fight down.
 *
 * INDEX 0 is the boot/dev spawn (see `buildSpawnPoints` — it is exempt from
 * validation), so it is the one point guaranteed to exist: the south gate,
 * looking straight up the yard at the tower.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - DERRICK.x, z - DERRICK.z) + turn;
export const RUST_SPAWNS = [
  [1.5, 23.5, 0, 'south-gate'], // FROZEN — boot spawn
  [-4.5, 23.0, 0.2, 'south-gate'],
  [7.0, 23.8, -0.2, 'south-gate'],

  [-1.0, -23.5, 0, 'north-gate'],
  [5.0, -24.0, -0.15, 'north-gate'],
  [-6.5, -23.8, 0.2, 'north-gate'],

  [-20.0, -21.5, 0.35, 'office'],
  [-9.0, -18.5, -0.3, 'office'],
  [-25.0, -18.0, 0.5, 'office'],
  [-13.5, -8.5, 0, 'office'],

  [24.0, -21.5, -0.35, 'shed'],
  [9.0, -23.5, 0.3, 'shed'],
  [24.0, -13.5, -0.5, 'shed'],
  [8.0, -13.5, 0, 'shed'],

  [-25.5, 15.0, -0.35, 'garage'],
  [-17.5, 23.5, 0.3, 'garage'],
  [-24.0, 11.0, -0.5, 'garage'],
  [-8.0, 18.5, 0, 'garage'],

  [23.5, 20.5, 0.35, 'pumphouse'],
  [14.0, 22.0, -0.3, 'pumphouse'],
  [25.5, 8.0, 0.5, 'pumphouse'],
  [15.5, 11.0, 0, 'pumphouse'],

  [-24.5, 4.0, -0.4, 'west-lane'],
  [-24.5, -8.0, 0.4, 'west-lane'],
  [-16.0, 0.0, 0, 'west-lane'],
  [-16.5, -6.0, 0, 'west-lane'],

  [25.0, 3.0, 0.4, 'east-lane'],
  [25.5, -8.5, -0.4, 'east-lane'],
  [16.5, 2.0, 0, 'east-lane'],
  [16.0, -5.5, 0, 'east-lane'],

  [-5.5, -14.5, 0.5, 'derrick'],
  [6.0, -14.5, -0.5, 'derrick'],
  [-6.5, 9.5, -0.5, 'derrick'],
  [7.0, 9.5, 0.5, 'derrick'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  for (const [x, z, ry, tier] of CONTAINERS) {
    if (tier !== 0) continue; // a stacked box adds no new footprint
    const hx = (ry === 0 ? CONTAINER.l : CONTAINER.w) / 2;
    const hz = (ry === 0 ? CONTAINER.w : CONTAINER.l) / 2;
    out.push([x - hx, z - hz, x + hx, z + hz]);
  }
  for (const [x, z, r] of SILOS) out.push([x - r, z - r, x + r, z + r]);
  // the derrick's own base pad and the plinth under it
  out.push([DERRICK.x - DERRICK.base - 0.9, DERRICK.z - DERRICK.base - 0.9,
    DERRICK.x + DERRICK.base + 0.9, DERRICK.z + DERRICK.base + 0.9]);
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the yard floor. */
export function inSolid(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/**
 * Can a character stand here, in LEVEL space? Inside the fence and off every
 * footprint. Only ever a first filter — real collision decides, in
 * `buildSpawnPoints`.
 */
export function standableAtRust(x, z, margin = 0.55) {
  const lim = RUST.half - 0.8 - margin;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
  return !inSolid(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenRust(x, z, m = 0.3) {
  const lim = RUST.half - 0.6;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
  return !inSolid(x, z, m);
}

/**
 * Analytic floor height. The yard is a poured slab, so this is flat inside the
 * fence; outside it the desert rolls away and then climbs into a ridge line.
 *
 * The ridge is not scenery for its own sake. The camera sits above a 3.5 m
 * fence the moment you are on any deck, and without it the whole horizon is
 * the terrain plane meeting the sky in a straight pale band — the flat cut-out
 * read the quality bar exists to prevent. Doing it in the height field rather
 * than with geometry costs nothing: the terrain mesh already samples this, so
 * the ridge is free and the collision comes with it.
 *
 * Physics owns the exact answer — this is the hint props are dropped on.
 */
export function groundYRust(x, z) {
  const out = Math.max(Math.abs(x), Math.abs(z)) - RUST.half;
  if (out <= 0) return 0.02;
  const t = Math.min(1, out / 12);
  const roll = (fbm3(x * 0.05, 11.7, z * 0.05, 3) - 0.5) * 1.3 * t;
  // Starts 8 m beyond the fence and takes 26 m to reach full height, so the
  // near desert still reads as flat ground and the climb is all in the distance.
  const ridge = Math.min(1, Math.max(0, (out - 8) / 26));
  return 0.02 + roll + ridge * ridge * (4.5 + fbm3(x * 0.02, 4.1, z * 0.02, 2) * 8.5);
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
const _pm = new THREE.Matrix4();

/**
 * A structural member between two points, oriented by a quaternion rather than
 * by Euler angles. Every leg, brace, stringer and handrail in the derrick is
 * one of these, which is why the tower is 40 lines instead of 400.
 */
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

const _wp = [0, 0];

/**
 * One storey of wall with real openings punched through it.
 *
 * `holes` are `[{ u, w, y, h }]` in wall-local coordinates: `u` along the wall
 * from its centre, `y` up from `y0`. The wall is emitted as the solid spans
 * BETWEEN the holes plus a lintel over and a sill under each, so a doorway is a
 * genuine hole in the collision hull rather than a thin panel the player has to
 * be teleported through.
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
    if (oy > 0.02) seg(o.u, o.w, y0 + oy / 2, oy); // sill / spandrel
    if (oy + oh < h - 0.02) seg(o.u, o.w, y0 + (oy + oh + h) / 2, h - oy - oh); // lintel
    cursor = Math.max(cursor, x1);
  }
  if (cursor < len / 2) seg((cursor + len / 2) / 2, len / 2 - cursor, y0 + h / 2, h);
}

/** A horizontal deck: merged slab, collision proxy, and an optional railing. */
function deck(A, key, cx, y, cz, w, d, opts = {}) {
  const t = opts.t ?? 0.22;
  A.add(key, BOX(A), LL(IDENT, cx, y - t / 2, cz, opts.ry ?? 0, w, t, d), {
    masks: opts.masks ?? [0.6, 0.5, 0.3],
  });
  A.box(A.surfaceOf(key), cx, y - t / 2, cz, w, t, d, opts.ry ?? 0);
  // Underside beams: a deck seen from below is otherwise a floating plane.
  if (opts.beams !== false) {
    const n = Math.max(2, Math.round(w / 1.6));
    for (let i = 0; i <= n; i++) {
      const x = cx - w / 2 + (i / n) * w;
      A.add('steel_frame', BOX_THIN(A), LL(IDENT, x, y - t - 0.09, cz, 0, 0.11, 0.2, d), {
        masks: [0.6, 0.55, 0.5],
      });
    }
  }
  if (opts.rails) railing(A, cx, y, cz, w, d, opts.rails, opts.railH ?? 1.06);
}

/**
 * One straight run of handrail from (x0,z0) to (x1,z1) at deck height `y`.
 *
 * Collision is ONE thin slab spanning deck to rail height, not a proxy per bar:
 * a player walking a 1.4 m gantry must be stopped by the rail, and three
 * separate 9 cm proxies at knee, waist and hand height is a staircase of ledges
 * for the character controller to catch on.
 */
export function railRun(A, x0, z0, x1, z1, y, h = 1.06) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.15) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  for (const yy of [y + h, y + h * 0.52]) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, mx, yy, mz, ry, len, 0.055, 0.055), { masks: [0.9, 0.45, 0.05] });
  }
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    A.add('metal_rust', BOX_THIN(A),
      LL(IDENT, x0 + ((x1 - x0) * i) / n, y + h / 2, z0 + ((z1 - z0) * i) / n, 0, 0.06, h, 0.06),
      { masks: [0.9, 0.5, 0.1] });
  }
  A.box('metal', mx, y + h * 0.55, mz, len, h * 1.1, 0.1, ry);
}

/**
 * Handrail around a deck. `sides` is a string of any of `nsew` (level space:
 * n = -Z, s = +Z, e = +X, w = -X) — the missing letters are where stairs and
 * gantries land.
 */
function railing(A, cx, y, cz, w, d, sides = 'nsew', h = 1.06) {
  const x0 = cx - w / 2 + 0.05;
  const x1 = cx + w / 2 - 0.05;
  const z0 = cz - d / 2 + 0.05;
  const z1 = cz + d / 2 - 0.05;
  if (sides.includes('n')) railRun(A, x0, z0, x1, z0, y, h);
  if (sides.includes('s')) railRun(A, x0, z1, x1, z1, y, h);
  if (sides.includes('w')) railRun(A, x0, z0, x0, z1, y, h);
  if (sides.includes('e')) railRun(A, x1, z0, x1, z1, y, h);
}

/**
 * A parapet around a roof, with real gaps where a stair lands on it.
 *
 * `kit.parapet` runs unbroken around all four sides, which is right for a
 * skyline and wrong for a roof you are supposed to be able to walk onto: the
 * player would arrive at the top step facing an 0.8 m wall with only 0.24 m of
 * coping to mantle onto, and the mantle probe wants 0.46 m of standable ground
 * past the lip. `gaps` is `{ n|s|e|w: [{ u, w }] }` in the same wall-local
 * coordinates `wallWithHoles` uses.
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
    // Coping, one band above the body and carrying the same gaps — a floating
    // lintel over a doorway is the classic tell of a parapet cut by hand.
    wallWithHoles(A, opts.copingKey ?? 'concrete_dark', px, pz, ry, len, y + h, 0.1, t + 0.12,
      g.map((o) => ({ u: o.u, w: o.w, y: 0, h: 0.1 })), { masks: [0.85, 0.3, 0.1] });
  }
}

/** How long a `flight` between two heights comes out, before building it. */
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
 * A flight of steel steps from (x, y, z) up to `top`, climbing in the
 * direction `ry` points.
 *
 * 0.275 rise on a 0.3 going: a 42-degree industrial stair, which is what a
 * refinery actually carries and — more to the point — what fits in the
 * footprints this map has. Returns the LEVEL-space landing point, so a
 * switchback is two calls that cannot drift apart.
 */
function flight(A, x, y, z, ry, top, w = 1.4, opts = {}) {
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

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGround(A, rng) {
  // ------------------------------------------------------------- desert --
  const S = 180;
  const N = 44;
  const terrain = new THREE.PlaneGeometry(S, S, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const z = pa.getZ(i);
    pa.setY(i, groundYRust(x, z) - 0.04);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    out[1] = 0.2 + fbm3(x * 0.28, 2.1, z * 0.28, 2) * 0.42;
    out[0] = 0.18;
  });
  A.add('sand', terrain, null);
  A.collideGeo('sand', terrain);
  terrain.dispose();

  // ---------------------------------------------------------- yard slab --
  // The refinery apron: compacted gravel over a cracked concrete pour. One
  // subdivided plane so grazing light finds something, and one flat collision
  // box so the character controller never feels the triangles.
  const W = RUST.half * 2;
  const yard = new THREE.PlaneGeometry(W, W, 28, 28);
  yard.rotateX(-Math.PI / 2);
  const ya = yard.getAttribute('position');
  for (let i = 0; i < ya.count; i++) {
    const x = ya.getX(i);
    const z = ya.getZ(i);
    const wear = (fbm3(x * 0.4 + 5, 3.3, z * 0.4, 3) - 0.5) * 0.05;
    // a shallow drainage fall toward the middle of the yard
    const fall = -Math.exp(-(x * x + z * z) / 620) * 0.04;
    ya.setY(i, 0.03 + wear + fall);
  }
  yard.computeVertexNormals();
  paintMasks(yard, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.6, 4.9, z * 0.6, 3);
    out[0] = 0.2 + n * 0.28;
    out[1] = 0.12 + Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - 16) / 12) * 0.4 + n * 0.2;
  });
  A.add('yard_slab', yard, null);
  A.box('dirt', 0, -0.25, 0, W, 0.5, W);
  yard.dispose();

  // -------------------------------------------------- stains and drifts --
  // Oil. A refinery yard's ground truth, and the only large dark value on an
  // otherwise uniformly bright deck.
  for (let i = 0; i < 26; i++) {
    const a = rng.float() * 6.283;
    const r = rng.range(3, 24);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inSolid(x, z, -0.4)) continue;
    A.addOnce(
      'asphalt',
      patchGeometry(rng, rng.range(0.7, 2.6), { lobes: 10, wobble: 0.55 }),
      LL(IDENT, x, 0.045, z, rng.float() * 6.283, 1, 1, rng.range(0.5, 1)),
      { masks: [0.05, 0.95, 0.6] }
    );
  }
  // Sand blown up against the fence line on the two downwind sides.
  for (const [sx, sz] of [[1, 0], [0, 1]]) {
    for (let i = 0; i < 9; i++) {
      const t = (i + rng.float() * 0.6) / 9;
      const along = (t - 0.5) * RUST.half * 1.9;
      const x = sx ? RUST.half - 0.9 : along;
      const z = sz ? RUST.half - 0.9 : along;
      const g = driftBerm(rng, rng.range(4, 9), rng.range(1.6, 3.0), rng.range(0.16, 0.34));
      A.addOnce('sand', g, LL(IDENT, x, 0.03, z, sx ? Math.PI / 2 : 0), { masks: [0.1, 0.4, 0.35] });
    }
  }
}

/**
 * The perimeter: corrugated hoarding on steel posts, a berm and a rock line
 * outside it so the skyline is not the sky meeting a fence, and one gate at
 * each end of the yard on the long axis.
 */
function buildFence(A, rng) {
  const R = RUST.half;
  const h = RUST.fenceH;
  const gate = 4.6; // the opening at each gate, centred on x = 0
  for (const side of [0, 1, 2, 3]) {
    const ry = side === 0 || side === 2 ? 0 : Math.PI / 2;
    const cx = side === 1 ? R : side === 3 ? -R : 0;
    const cz = side === 0 ? -R : side === 2 ? R : 0;
    // North and south get the gate opening; the flanks are continuous.
    const holes = side === 0 || side === 2 ? [{ u: 0, w: gate, y: 0, h }] : [];
    wallWithHoles(A, 'corrugated_fine', cx, cz, ry, R * 2, 0, h, 0.14, holes, {
      masks: [0.75, 0.45, 0.2],
    });
    // posts and a top rail
    const n = Math.round((R * 2) / 3);
    for (let i = 0; i <= n; i++) {
      const u = -R + (i / n) * R * 2;
      if ((side === 0 || side === 2) && Math.abs(u) < gate / 2 + 0.2) continue;
      alongWall(cx, cz, ry, u, _wp);
      A.add('steel_frame', BOX(A), LL(IDENT, _wp[0], h / 2 + 0.2, _wp[1], ry, 0.18, h + 0.4, 0.2), {
        masks: [0.7, 0.5, 0.3],
      });
    }
    A.add('steel_frame', BOX_THIN(A), LL(IDENT, cx, h + 0.16, cz, ry, R * 2, 0.11, 0.13), {
      masks: [0.8, 0.4, 0.1],
    });
    // gate posts and the sagging leaf hanging off one of them
    if (side === 0 || side === 2) {
      const s = side === 0 ? 1 : -1;
      for (const sx of [-1, 1])
        A.add('steel_frame', BOX(A), LL(IDENT, sx * (gate / 2 + 0.16), (h + 0.9) / 2, cz, 0, 0.3, h + 0.9, 0.3), {
          masks: [0.75, 0.5, 0.3],
        });
      A.add('corrugated_fine', BOX_THIN(A), LL(IDENT, -gate / 2 + 0.6, h * 0.46, cz + s * 0.5, 0, 2.1, h * 0.9, 0.08, 0, -0.14), {
        masks: [0.85, 0.55, 0.2],
      });
      A.box('metal', -gate / 2 + 0.6, h * 0.46, cz + s * 0.5, 2.1, h * 0.9, 0.16);
    }
  }

  // A berm and a rock line outside, so nothing on the map ends in sky at the
  // fence: three planes of depth is what stops the perimeter reading as a cut-out.
  for (let i = 0; i < 54; i++) {
    const a = (i / 54) * 6.283 + rng.range(-0.05, 0.05);
    const r = R + rng.range(3, 16);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = rng.range(0.5, 2.1);
    A.addOnce('concrete_dark', rockGeometry(rng, s, 1, rng.range(0.5, 0.8)),
      LL(IDENT, x, groundYRust(x, z) - s * 0.2, z, rng.float() * 6.283), { masks: [0.4, 0.6, 0.4] });
  }
}

/**
 * THE DERRICK.
 *
 * Four legs raked in from a 7.8 m base to a 2.9 m crown, cross-braced every
 * 2.2 m, carrying a deck at gantry height and a crow's nest above it. What
 * makes it read as steel rather than as a shape is that the bracing is a real
 * X between every pair of legs on every bay — the sky showing through it is the
 * whole silhouette.
 */
function buildDerrick(A, rng) {
  const D = DERRICK;
  const legT = 0.26;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  /** Leg spread at height y — linear taper from base to crown. */
  const spread = (y) => D.base + (D.top - D.base) * Math.min(1, Math.max(0, y / D.height));
  const legAt = (c, y) => [D.x + corners[c][0] * spread(y), y, D.z + corners[c][1] * spread(y)];

  // concrete pad and four pier blocks
  A.add('concrete', BOX_SOFT(A), LL(IDENT, D.x, 0.11, D.z, 0, D.base * 2 + 1.8, 0.22, D.base * 2 + 1.8), {
    masks: [0.5, 0.6, 0.35],
  });
  A.box('concrete', D.x, 0.11, D.z, D.base * 2 + 1.8, 0.22, D.base * 2 + 1.8);
  for (let c = 0; c < 4; c++) {
    const [x, , z] = legAt(c, 0);
    A.add('concrete', BOX_SOFT(A), LL(IDENT, x, 0.36, z, 0, 1.0, 0.72, 1.0), { masks: [0.55, 0.7, 0.5] });
    A.box('concrete', x, 0.36, z, 1.0, 0.72, 1.0);
  }

  // legs, as one strut per bay so the taper is faceted rather than curved
  const bays = 6;
  for (let c = 0; c < 4; c++) {
    for (let b = 0; b < bays; b++) {
      const y0 = (b / bays) * D.height;
      const y1 = ((b + 1) / bays) * D.height;
      const p = legAt(c, y0);
      const q = legAt(c, y1);
      strut(A, 'steel_frame', p[0], y0, p[2], q[0], y1, q[2], legT, [0.8, 0.4, 0.25]);
    }
    // Collision on the legs only up to head height: above that they are
    // scenery, and a full-height proxy on a raked member is a wall a player
    // can get wedged against with nothing visible to blame.
    const b0 = legAt(c, 0);
    A.box('metal', b0[0], 1.1, b0[2], legT * 1.5, 2.2, legT * 1.5);
  }

  // horizontal girts and the X-bracing between them, on all four faces
  for (let b = 0; b <= bays; b++) {
    const y = (b / bays) * D.height;
    if (b > 0 && b < bays) {
      for (let c = 0; c < 4; c++) {
        const p = legAt(c, y);
        const q = legAt((c + 1) % 4, y);
        strut(A, 'steel_frame', p[0], y, p[2], q[0], y, q[2], 0.13, [0.7, 0.45, 0.2]);
      }
    }
    if (b >= bays) continue;
    const y1 = ((b + 1) / bays) * D.height;
    for (let c = 0; c < 4; c++) {
      const a0 = legAt(c, y);
      const a1 = legAt((c + 1) % 4, y);
      const b0 = legAt(c, y1);
      const b1 = legAt((c + 1) % 4, y1);
      strut(A, 'steel_frame', a0[0], y, a0[2], b1[0], y1, b1[2], 0.1, [0.85, 0.4, 0.1]);
      strut(A, 'steel_frame', a1[0], y, a1[2], b0[0], y1, b0[2], 0.1, [0.85, 0.4, 0.1]);
    }
  }

  // ------------------------------------------------------------ decks --
  //
  // The two openings in the rails are the map's whole vertical design: the
  // SOUTH edge is where the stair arrives, the EAST edge is where the gantry
  // leaves for the shed. Everything else is fenced, because a 4.4 m fall onto
  // concrete is not a movement option, it is a bug report.
  const dh = D.deckHalf;
  const stairX = D.x + D.stairX; // the switchback arriving from the south
  const nestX = D.x + 0.0; // the flight leaving north for the nest
  deck(A, 'steel_grate', D.x, D.deck, D.z, dh * 2, dh * 2, { rails: 'w', t: 0.2 });
  // south: gap for the arriving switchback
  railRun(A, D.x - dh + 0.05, D.z + dh - 0.05, stairX - 0.85, D.z + dh - 0.05, D.deck);
  railRun(A, stairX + 0.85, D.z + dh - 0.05, D.x + dh - 0.05, D.z + dh - 0.05, D.deck);
  // north: gap for the flight up to the nest
  railRun(A, D.x - dh + 0.05, D.z - dh + 0.05, nestX - 0.75, D.z - dh + 0.05, D.deck);
  railRun(A, nestX + 0.75, D.z - dh + 0.05, D.x + dh - 0.05, D.z - dh + 0.05, D.deck);
  // east: gap for the gantry
  railRun(A, D.x + dh - 0.05, D.z - dh + 0.05, D.x + dh - 0.05, D.z - 2.1, D.deck);
  railRun(A, D.x + dh - 0.05, D.z - 0.3, D.x + dh - 0.05, D.z + dh - 0.05, D.deck);

  // ------------------------------------------------------------ stairs --
  // A switchback up the south face to the deck. Each landing is placed FROM
  // the previous flight's own landing point, so the halves cannot drift apart
  // if the deck height moves.
  const mid = 0.22 + (D.deck - 0.22) * 0.5;
  const f1 = flight(A, stairX, 0.22, D.z + D.stairFootZ, Math.PI, mid, 1.4);
  deck(A, 'steel_grate', stairX + 0.75, mid, f1.z - 0.9, 3.2, 1.8, {
    // North is open for the second flight, and the south rail stops short of
    // the first one — a rail across the top step is a stair that ends in a wall.
    rails: 'ew', t: 0.16, beams: false,
  });
  railRun(A, stairX + 0.85, f1.z - 0.05, stairX + 2.3, f1.z - 0.05, mid);
  flight(A, stairX, mid, f1.z - 1.8, Math.PI, D.deck, 1.4);

  // ------------------------------------------------------ crow's nest --
  // The last flight crosses the deck, leaves the tower at its north face and
  // lands on the SOUTH EDGE of the cantilevered nest.
  const nh = D.nestHalf;
  const nz = D.z + D.nestZ;
  flight(A, nestX, D.deck, nz + nh + 4.8, Math.PI, D.nest, 1.3);
  deck(A, 'steel_grate', D.x, D.nest, nz, nh * 2, nh * 2, { rails: 'nwe', t: 0.18 });
  railRun(A, D.x - nh + 0.05, nz + nh - 0.05, nestX - 0.7, nz + nh - 0.05, D.nest);
  railRun(A, nestX + 0.7, nz + nh - 0.05, D.x + nh - 0.05, nz + nh - 0.05, D.nest);
  // Knee braces from the tower legs out to the platform: 4 m of cantilever
  // needs to look carried, not glued.
  for (const s of [-1, 1]) {
    const leg = spread(D.nest) * s;
    strut(A, 'steel_frame', D.x + leg, D.nest - 0.3, D.z - spread(D.nest),
      D.x + s * (nh - 0.2), D.nest - 0.3, nz - nh + 0.3, 0.15, [0.75, 0.45, 0.25]);
    strut(A, 'steel_frame', D.x + leg, D.nest - 3.0, D.z - spread(D.nest - 3.0),
      D.x + s * (nh - 0.3), D.nest - 0.35, nz + nh - 0.4, 0.13, [0.8, 0.45, 0.2]);
  }

  // ------------------------------------------------- crown and boom arm --
  const cs = spread(D.height);
  A.add('steel_frame', BOX(A), LL(IDENT, D.x, D.height + 0.14, D.z, 0, cs * 2.3, 0.28, cs * 2.3), {
    masks: [0.85, 0.4, 0.15],
  });
  // The boom: the asymmetry that makes the tower a landmark from every corner
  // of the yard instead of a symmetrical obelisk.
  const bl = 6.2;
  strut(A, 'steel_frame', D.x, D.height + 0.3, D.z, D.x + bl, D.height + 1.7, D.z, 0.3, [0.85, 0.35, 0.1]);
  strut(A, 'steel_frame', D.x + 0.6, D.height - 1.6, D.z, D.x + bl, D.height + 1.7, D.z, 0.14, [0.85, 0.4, 0.1]);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    strut(A, 'steel_frame',
      D.x + bl * t, D.height + 0.3 + 1.4 * t, D.z,
      D.x + 0.6 + (bl - 0.6) * t, D.height - 1.6 + 3.3 * t, D.z, 0.08, [0.9, 0.4, 0.1]);
  }
  // crown block and the cable hanging off it — the thing you look up at
  A.add('metal_dark', BOX(A), LL(IDENT, D.x + bl - 0.1, D.height + 1.4, D.z, 0, 0.5, 0.7, 0.42), {
    masks: [0.8, 0.5, 0.3],
  });
  strut(A, 'metal_dark', D.x + bl - 0.1, D.height + 1.05, D.z, D.x + bl - 0.1, D.height - 3.4, D.z, 0.05, [0.9, 0.5, 0.1]);
  A.add('metal_dark', BOX(A), LL(IDENT, D.x + bl - 0.1, D.height - 3.9, D.z, 0.4, 0.44, 1.0, 0.44), {
    masks: [0.85, 0.5, 0.2],
  });

  A.lampAnchors.push({ x: D.x, y: D.nest + 0.4, z: D.z });
}

/**
 * THE GANTRY — the walkway from the derrick deck to the shed roof.
 *
 * It has to dog-leg, and the reason is worth writing down: a straight run east
 * would have to sit at a z the derrick deck and the shed roof both contain, and
 * they do not overlap. So it runs east over the container lane, turns at a
 * corner platform clear of the stacks, and runs north onto the shed's south
 * edge. Both ends land at RUST.deckY, so it is dead level and needs no ramp.
 *
 * `path` is a polyline of axis-aligned segments, `[[x, z], …]`.
 */
function buildGantry(A, rng, path, y, w = 1.5) {
  for (let i = 0; i < path.length - 1; i++) {
    gantrySpan(A, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], y, w);
  }
  // Corner platforms at the interior vertices, so the turn is a square of deck
  // rather than two slabs meeting at a notch.
  for (let i = 1; i < path.length - 1; i++) {
    deck(A, 'steel_grate', path[i][0], y, path[i][1], w, w, { t: 0.16, beams: false });
  }
}

/** One axis-aligned run of gantry: deck, rails, underslung truss, one column. */
function gantrySpan(A, x0, z0, x1, z1, y, w) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const len = a1 - a0;
  if (len < 0.2) return;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  deck(A, 'steel_grate', cx, y, cz, alongX ? len : w, alongX ? w : len, { t: 0.16, beams: false });

  const off = w / 2 - 0.05;
  /** (a, lateral) -> world x/z for this run's axis. */
  const px = (a, lat) => (alongX ? a : cx + lat);
  const pz = (a, lat) => (alongX ? cz + lat : a);

  for (const s of [-1, 1]) {
    const lat = s * off;
    railRun(A, px(a0, lat), pz(a0, lat), px(a1, lat), pz(a1, lat), y, 1.02);
    // Underslung Warren truss: two chords and a zig-zag between them. This is
    // the only thing that makes a 1.5 m walkway 4.4 m in the air read as
    // carried rather than as a plank floating in space.
    const l = s * (off - 0.05);
    strut(A, 'steel_frame', px(a0, l), y - 0.2, pz(a0, l), px(a1, l), y - 0.2, pz(a1, l), 0.12, [0.7, 0.5, 0.3]);
    strut(A, 'steel_frame', px(a0, l), y - 0.66, pz(a0, l), px(a1, l), y - 0.66, pz(a1, l), 0.1, [0.7, 0.5, 0.3]);
    const n = Math.max(2, Math.round(len / 1.4));
    for (let i = 0; i < n; i++) {
      const u = a0 + (i / n) * len;
      const v = a0 + ((i + 1) / n) * len;
      strut(A, 'steel_frame', px(u, l), y - 0.2, pz(u, l), px(v, l), y - 0.66, pz(v, l), 0.07, [0.85, 0.45, 0.2]);
      strut(A, 'steel_frame', px(v, l), y - 0.2, pz(v, l), px(u, l), y - 0.66, pz(u, l), 0.07, [0.85, 0.45, 0.2]);
    }
  }

  // One splayed column pair at midspan, placed where the yard is clear.
  const m = (a0 + a1) / 2;
  const mxw = px(m, 0);
  const mzw = pz(m, 0);
  for (const s of [-1, 1]) {
    const footX = alongX ? mxw + s * 1.1 : mxw;
    const footZ = alongX ? mzw : mzw + s * 1.1;
    const headX = alongX ? mxw + s * 0.18 : mxw;
    const headZ = alongX ? mzw : mzw + s * 0.18;
    strut(A, 'steel_frame', footX, 0.1, footZ, headX, y - 0.72, headZ, 0.19, [0.7, 0.5, 0.35]);
  }
  A.box('metal', mxw, 1.1, mzw, alongX ? 2.5 : 0.5, 2.2, alongX ? 0.5 : 2.5);
}

/** NW: a two-storey concrete office with an external stair to the roof. */
function buildOffice(A, rng, s) {
  const t = 0.3;
  const storey = 3.2;
  const { x, z, w, d } = s;
  const key = 'concrete';
  const sides = [
    [x, z - d / 2, 0, w], // n
    [x + w / 2, z, Math.PI / 2, d], // e
    [x, z + d / 2, 0, w], // s
    [x - w / 2, z, Math.PI / 2, d], // w
  ];
  // ground floor: a door onto the yard (east) and openings on three sides
  const g = [
    [{ u: -2.2, w: 2.6, y: 0.95, h: 1.6 }, { u: 2.6, w: 2.2, y: 0.95, h: 1.6 }],
    [{ u: 1.5, w: 1.8, y: 0, h: 2.4 }, { u: -2.4, w: 2.0, y: 0.95, h: 1.6 }],
    [{ u: -3.0, w: 2.4, y: 0.95, h: 1.6 }, { u: 2.0, w: 1.7, y: 0, h: 2.4 }],
    [{ u: 0.6, w: 2.2, y: 0.95, h: 1.6 }],
  ];
  // first floor: the long window on the yard side is the sniper's slot
  const f = [
    [{ u: -1.6, w: 3.2, y: 0.85, h: 1.7 }, { u: 3.2, w: 1.6, y: 0.85, h: 1.7 }],
    [{ u: 0, w: 5.6, y: 0.8, h: 1.9 }],
    [{ u: -2.6, w: 2.4, y: 0.85, h: 1.7 }, { u: 2.4, w: 2.4, y: 0.85, h: 1.7 }],
    [{ u: -1.4, w: 2.0, y: 0.85, h: 1.7 }],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    wallWithHoles(A, key, cx, cz, ry, len, 0, storey, t, g[i], { masks: [0.45, 0.5, 0.3] });
    wallWithHoles(A, key, cx, cz, ry, len, storey, storey, t, f[i], { masks: [0.5, 0.45, 0.25] });
  }

  // slabs
  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.06, z, 0, w - t, 0.12, d - t), { masks: [0.4, 0.55, 0.4] });
  A.box('concrete', x, 0.06, z, w - t, 0.12, d - t);
  deck(A, 'floor_concrete', x, storey, z, w - t, d - t, { t: 0.26, beams: false });
  deck(A, 'roof_screed', x, s.h, z, w, d, { t: 0.3, beams: false });

  // internal stair, ground -> first, against the north wall
  flight(A, x - w / 2 + 1.4, 0.12, z - d / 2 + 0.6, 0, storey, 1.25, { key: 'concrete', railing: 'right' });

  // External switchback up the yard-facing (south) elevation to the roof: the
  // highest ground on the map that is not the derrick, and deliberately out in
  // the open. Everything is measured BACK from the roof edge, because the last
  // step has to land exactly on it — a flight that stops short leaves a gap
  // and one that overshoots comes up through the slab.
  const ex = x - 2;
  const zEdge = z + d / 2;
  const l2 = flightLength(storey, s.h);
  const f2z = zEdge + l2;
  const l1 = flightLength(0.1, storey);
  flight(A, ex, 0.1, f2z + 1.8 + l1, Math.PI, storey, 1.25);
  deck(A, 'steel_grate', ex, storey, f2z + 0.9, 2.4, 1.8, { t: 0.16, rails: 'ew', beams: false });
  flight(A, ex, storey, f2z, Math.PI, s.h, 1.25);
  roofParapet(A, 'concrete', x, z, w, d, s.h, {
    h: 0.85,
    t: 0.26,
    gaps: { s: [{ u: ex - x, w: 1.7 }] },
  });

  // an interior partition, so the ground floor is two rooms and not a hall
  wallWithHoles(A, 'plaster_sand', x + 1.4, z, Math.PI / 2, d - t, 0, storey, 0.2,
    [{ u: 1.2, w: 1.1, y: 0, h: 2.2 }], { masks: [0.4, 0.5, 0.4] });
  wallWithHoles(A, 'plaster_sand', x - 1.0, z, Math.PI / 2, d - t, storey, storey, 0.2,
    [{ u: -1.8, w: 1.1, y: 0, h: 2.2 }], { masks: [0.4, 0.5, 0.4] });

  A.interiorLights.push({ x: x + 3.2, y: storey - 0.4, z });
  A.interiorLights.push({ x: x - 2.6, y: storey - 0.4, z: z + 1.5 });
  A.interiorLights.push({ x: x + 1.0, y: storey * 2 - 0.4, z: z - 1.0 });
}

/** NE: an open steel shed whose roof is the map's east high ground. */
function buildShed(A, rng, s) {
  const { x, z, w, d, h } = s;
  // six columns and the beams they carry
  const cols = [];
  for (const cx of [-1, 0, 1])
    for (const cz of [-1, 1]) cols.push([x + cx * (w / 2 - 0.5), z + cz * (d / 2 - 0.5)]);
  for (const [px, pz] of cols) {
    strut(A, 'steel_frame', px, 0, pz, px, h - 0.2, pz, 0.32, [0.7, 0.5, 0.3]);
    A.box('metal', px, (h - 0.2) / 2, pz, 0.4, h - 0.2, 0.4);
    A.add('concrete', BOX_SOFT(A), LL(IDENT, px, 0.16, pz, 0, 0.9, 0.32, 0.9), { masks: [0.5, 0.7, 0.5] });
  }
  for (const cz of [-1, 1])
    strut(A, 'steel_frame', x - w / 2 + 0.5, h - 0.35, z + cz * (d / 2 - 0.5), x + w / 2 - 0.5, h - 0.35, z + cz * (d / 2 - 0.5), 0.26);
  for (const cx of [-1, 0, 1])
    strut(A, 'steel_frame', x + cx * (w / 2 - 0.5), h - 0.35, z - d / 2 + 0.5, x + cx * (w / 2 - 0.5), h - 0.35, z + d / 2 - 0.5, 0.22);

  // the two closed sides — north and east — in corrugated sheet
  wallWithHoles(A, 'corrugated', x, z - d / 2, 0, w, 0, h, 0.14, [], { masks: [0.7, 0.5, 0.3] });
  wallWithHoles(A, 'corrugated', x + w / 2, z, Math.PI / 2, d, 0, h, 0.14,
    [{ u: -1.0, w: 3.0, y: 0, h: 2.6 }], { masks: [0.7, 0.5, 0.3] });

  // The deck, and the two ways onto it: a stair up the south face at the east
  // end, and the gantry from the derrick arriving further west. Both openings
  // are in the south rail, and both are measured from the deck edge so the top
  // step lands ON it.
  deck(A, 'steel_grate', x, h, z, w, d, { t: 0.24 });
  railing(A, x, h, z, w, d, 'nwe');
  const stx = x + w / 2 - 1.5;
  flight(A, stx, 0.1, z + d / 2 + flightLength(0.1, h), Math.PI, h, 1.4);
  const sz = z + d / 2 - 0.05;
  const gx = GANTRY_X;
  railRun(A, x - w / 2 + 0.05, sz, gx - 0.75, sz, h);
  railRun(A, gx + 0.75, sz, stx - 0.75, sz, h);
  railRun(A, stx + 0.75, sz, x + w / 2 - 0.05, sz, h);

  // roof clutter: an AC plant and a vent bank, so the deck has cover on it
  A.put('ac_unit', x + 2.6, h, z - 2.0, 0.3, 1.15);
  A.put('ac_unit', x - 3.4, h, z + 1.4, -1.2, 1.0);
  A.put('water_tank', x + 4.4, h, z + 2.4, 0.6, 1.1);
  A.put('roof_vent', x - 1.2, h, z - 3.0, 0.2, 1.2);

  A.interiorLights.push({ x, y: h - 0.6, z });
  A.interiorLights.push({ x: x - 4.0, y: h - 0.6, z: z + 2.0 });
}

/** SW: a garage block with a roller opening and a roof you can fight from. */
function buildGarage(A, rng, s) {
  const t = 0.28;
  const { x, z, w, d, h } = s;
  const sides = [
    [x, z - d / 2, 0, w],
    [x + w / 2, z, Math.PI / 2, d],
    [x, z + d / 2, 0, w],
    [x - w / 2, z, Math.PI / 2, d],
  ];
  const holes = [
    [{ u: 2.6, w: 1.6, y: 0, h: 2.3 }, { u: -2.6, w: 2.2, y: 1.2, h: 1.4 }],
    [{ u: 0.4, w: 4.4, y: 0, h: 3.2 }], // the roller door, onto the yard
    [{ u: -3.2, w: 2.2, y: 1.2, h: 1.4 }, { u: 2.8, w: 2.0, y: 1.2, h: 1.4 }],
    [{ u: 0, w: 2.0, y: 1.2, h: 1.4 }],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz, ry, len] = sides[i];
    wallWithHoles(A, 'concrete', cx, cz, ry, len, 0, h, t, holes[i], { masks: [0.5, 0.5, 0.3] });
  }
  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.06, z, 0, w - t, 0.12, d - t), { masks: [0.4, 0.6, 0.45] });
  A.box('concrete', x, 0.06, z, w - t, 0.12, d - t);
  deck(A, 'roof_screed', x, h, z, w, d, { t: 0.3, beams: false });
  // the roller door's rolled-up curtain and its rails
  A.add('metal_rust', BOX(A), LL(IDENT, x + w / 2 - 0.1, 3.42, z + 0.4, 0, 0.42, 0.44, 4.5), {
    masks: [0.85, 0.5, 0.2],
  });
  // external stair up the south face, landing on the roof edge
  const gx = x + 2.0;
  flight(A, gx, 0.1, z + d / 2 + flightLength(0.1, h), Math.PI, h, 1.3);
  roofParapet(A, 'concrete', x, z, w, d, h, { h: 0.8, t: 0.24, gaps: { s: [{ u: gx - x, w: 1.7 }] } });

  A.interiorLights.push({ x, y: h - 0.5, z });
  A.interiorLights.push({ x: x - 3.4, y: h - 0.5, z: z - 1.6 });
}

/** SE: a small open-fronted pump house among the tanks. */
function buildPumpHouse(A, rng, s) {
  const t = 0.26;
  const { x, z, w, d, h } = s;
  wallWithHoles(A, 'concrete', x, z - d / 2, 0, w, 0, h, t, [{ u: 1.2, w: 2.0, y: 1.1, h: 1.5 }], { masks: [0.5, 0.5, 0.3] });
  wallWithHoles(A, 'concrete', x + w / 2, z, Math.PI / 2, d, 0, h, t, [], { masks: [0.5, 0.5, 0.3] });
  wallWithHoles(A, 'concrete', x, z + d / 2, 0, w, 0, h, t, [{ u: -1.0, w: 1.7, y: 0, h: 2.3 }], { masks: [0.5, 0.5, 0.3] });
  // the west face is open to the yard, on two piers
  for (const s2 of [-1, 1])
    A.add('concrete', BOX(A), LL(IDENT, x - w / 2 + t / 2, h / 2, z + s2 * (d / 2 - 0.6), 0, t, h, 1.2), {
      masks: [0.5, 0.5, 0.3],
    });
  for (const s2 of [-1, 1]) A.box('concrete', x - w / 2 + t / 2, h / 2, z + s2 * (d / 2 - 0.6), t, h, 1.2);
  A.add('concrete', BOX(A), LL(IDENT, x - w / 2 + t / 2, h - 0.5, z, 0, t, 1.0, d), { masks: [0.55, 0.5, 0.3] });
  A.box('concrete', x - w / 2 + t / 2, h - 0.5, z, t, 1.0, d);

  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.06, z, 0, w - t, 0.12, d - t), { masks: [0.4, 0.6, 0.45] });
  A.box('concrete', x, 0.06, z, w - t, 0.12, d - t);
  deck(A, 'roof_screed', x, h, z, w + 0.5, d + 0.5, { t: 0.28, beams: false });

  // the pumps it is named for
  A.put('generator', x + 1.6, 0.13, z - 1.6, Math.PI / 2, 1);
  A.put('valve', x - 1.8, 0.13, z + 2.0, 0.4, 1.1);
  A.put('valve', x - 1.6, 0.13, z + 0.8, -0.9, 0.95);
  A.interiorLights.push({ x, y: h - 0.5, z });
}

/** Vertical storage silos: a capped tube, a skirt, a stair-less access cage. */
function buildSilos(A, rng) {
  for (const [x, z, r, h] of SILOS) {
    const body = tubeY(r, h, { radial: 14 });
    A.addOnce('metal_rust', body, LL(IDENT, x, 0.05, z), { masks: [0.55, 0.5, 0.3] });
    A.box('metal', x, h / 2, z, r * 1.78, h, r * 1.78);
    // top cone, hand rail and the two bands that stop it reading as a can
    A.addOnce('metal_rust', tubeY(r, 0.9, { radial: 14, taper: 0.35 }), LL(IDENT, x, h + 0.05, z), {
      masks: [0.75, 0.4, 0.15],
    });
    for (const yy of [h * 0.34, h * 0.68]) {
      A.addOnce('steel_frame', tubeY(r * 1.03, 0.16, { radial: 14 }), LL(IDENT, x, yy, z), { masks: [0.8, 0.45, 0.2] });
    }
    A.addOnce('concrete', chamferBox(r * 2.3, 0.36, r * 2.3, 0.03), LL(IDENT, x, 0.18, z), { masks: [0.5, 0.7, 0.5] });
    A.box('concrete', x, 0.18, z, r * 2.3, 0.36, r * 2.3);
    A.put('ladder', x, 0.3, z - r - 0.06, Math.PI, Math.min(1.6, h / 3.1));
    // discharge chute onto the yard
    strut(A, 'metal_rust', x, h * 0.24, z, x + r * 2.1, h * 0.1, z, 0.3, [0.8, 0.5, 0.3]);
  }
}

/**
 * Pipe racks: a line of trestles carrying long pipe at vault height.
 *
 * `ry` in PIPE_RACKS is the direction the RUN goes, in the same convention the
 * pipe prototype is modelled in — 0 means along +Z. Both the pipe and the
 * trestle take that yaw directly: the pipe because it is modelled along +Z, the
 * trestle because its cradle beam is modelled along +X and therefore comes out
 * across the run, which is the whole job of a trestle.
 */
function buildPipeRacks(A, rng) {
  for (const [x, z, ry, len] of PIPE_RACKS) {
    const ax = Math.sin(ry); // unit vector ALONG the run
    const az = Math.cos(ry);
    const px = -az; // and across it
    const pz = ax;
    const n = Math.max(2, Math.round(len / 3.2));
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * len;
      A.put('trestle', x + ax * t, 0.03, z + az * t, ry, 1);
    }
    const runs = Math.max(1, Math.round(len / 6));
    for (let i = 0; i < runs; i++) {
      const t = ((i + 0.5) / runs - 0.5) * len;
      for (const off of [-0.62, 0.62]) {
        // 1.5 m: the cradle beam tops out at 1.28, so a 0.24 m pipe resting on
        // it sits here. Also the height a player vaults rather than walks round.
        A.put('pipe_long', x + ax * t + px * off, 1.5, z + az * t + pz * off, ry, 1);
      }
    }
  }
}

/** Containers, and the collision that makes them cover. */
function placeContainers(A, rng) {
  const { l: L, h: CH, w: W } = CONTAINER;
  for (const [x, z, ry, tier, proto] of CONTAINERS) {
    const y = 0.04 + tier * (CH + 0.03);
    // A hand-stacked yard is not a CAD model: a couple of degrees of yaw and a
    // centimetre of settle is the difference between "stacked" and "snapped".
    const j = ((x * 31 + z * 17 + tier * 7) % 11) / 11 - 0.5;
    A.put(proto, x, y, z, ry + j * 0.045, 1);
    const hx = (ry === 0 ? L : W) / 2;
    const hz = (ry === 0 ? W : L) / 2;
    A.box('metal', x, y + CH / 2, z, hx * 2, CH, hz * 2);
    if (tier === 0) {
      A.addOnce('dust_skirt', patchGeometry(rng, Math.max(hx, hz) * 0.95, { lobes: 9, wobble: 0.35 }),
        LL(IDENT, x, 0.05, z, ry, 1, 1, Math.min(hx, hz) / Math.max(hx, hz) + 0.35),
        { masks: [0.1, 0.9, 0.6] });
    }
  }
}

/**
 * Set dressing. A refinery is not a set of clean volumes with gaps between
 * them: it is those volumes plus everything that got left leaning against
 * them. Everything here is instanced and jittered.
 */
function dressYard(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.5, scale: 0.06 };

  const free = (x, z, m = 1.0) => !inSolid(x, z, m) && Math.abs(x) < RUST.half - 1 && Math.abs(z) < RUST.half - 1;

  // ---- drums, the map's most common object ------------------------------
  const drumSpots = [
    [-5.5, -6.0], [-4.4, -6.9], [-5.0, -7.6], [6.2, -6.5], [7.1, -7.2],
    [-6.5, 6.4], [-7.3, 7.2], [-6.2, 7.6], [8.4, 6.0], [9.2, 6.9], [8.6, 7.7],
    [-14.5, -6.5], [-15.4, -7.2], [15.0, 8.0], [15.9, 8.7], [15.2, 9.4],
    [-19.5, 9.0], [-20.4, 9.7], [19.0, -8.0], [19.9, -8.7], [19.2, -9.4],
    [2.0, -17.5], [2.9, -18.2], [-3.5, 17.0], [-4.4, 17.7], [-3.8, 18.4],
    [22.0, -2.0], [23.0, -2.6], [-23.5, -14.0], [-24.2, -14.8],
  ];
  for (let i = 0; i < drumSpots.length; i++) {
    const [x, z] = drumSpots[i];
    if (!free(x, z, 0.6)) continue;
    A.put(i % 5 === 0 ? 'barrel_blue' : 'barrel_rust', x, 0.03, z, rng.float() * 6.283, rng.range(0.95, 1.05));
    if (rng.float() < 0.22) A.put('barrel_rust', x, 0.03 + 0.88, z, rng.float() * 6.283, 1);
  }

  // ---- pipe, scrap and the yard's loose steel ---------------------------
  const scrapSpots = [
    [-13.0, -12.5, 'scrap_a'], [13.5, 12.0, 'scrap_a'], [-9.5, 16.5, 'scrap_b'],
    [10.0, -16.0, 'scrap_b'], [23.0, 1.5, 'scrap_a'], [-23.0, 0.5, 'scrap_b'],
    [17.5, -3.0, 'scrap_b'], [-17.0, 6.0, 'scrap_a'], [4.5, 18.0, 'scrap_b'],
    [-2.5, -17.0, 'scrap_a'],
  ];
  for (const [x, z, id] of scrapSpots) if (free(x, z, 0.9)) A.put(id, x, 0.03, z, rng.float() * 6.283, rng.range(0.85, 1.2));

  const pipeSpots = [
    [-6.0, -13.5, 0.4], [7.5, 13.0, -0.5], [-15.5, 11.0, 1.2], [16.0, -8.5, 0.9],
    [-21.0, 13.5, 0.2], [21.5, -13.0, -0.3],
  ];
  for (const [x, z, ry] of pipeSpots) if (free(x, z, 1.4)) A.put('pipe_stack', x, 0.03, z, ry, 1);
  for (const [x, z, ry] of [[-10.5, -16.5, 0.9], [11.5, 16.5, -0.7], [-19.0, -1.5, 0.2], [24.0, 6.5, 1.4]])
    if (free(x, z, 1.0)) A.put('pipe_short', x, 0.22, z, ry, 1);

  // ---- crates, pallets and tyres ---------------------------------------
  const stuff = [
    [-4.0, 12.5, 'crate_a'], [-3.2, 12.9, 'crate_b'], [-3.7, 12.6, 'crate_c'],
    [3.5, -12.5, 'crate_c'], [4.4, -12.9, 'crate_a'],
    [-13.5, 3.5, 'crate_a'], [-14.2, 4.2, 'crate_b'],
    [14.0, -1.0, 'crate_c'], [14.8, -1.7, 'crate_a'],
    [-18.5, -9.5, 'pallet'], [18.5, 9.5, 'pallet'], [0.5, 17.5, 'pallet'],
    [-8.0, -22.5, 'crate_a'], [8.5, 22.5, 'crate_b'],
    [-24.5, -19.5, 'tyre'], [-24.0, -19.0, 'tyre'], [-24.3, -18.4, 'tyre'],
    [24.5, 19.5, 'tyre'], [24.0, 19.0, 'tyre'],
    [12.5, 19.5, 'tyre_small'], [-12.0, -19.0, 'tyre_small'],
  ];
  for (const [x, z, id] of stuff) if (free(x, z, 0.5)) A.put(id, x, 0.03, z, rng.float() * 6.283, rng.range(0.92, 1.08));

  // ---- the props that make it a refinery -------------------------------
  const spools = [[-12.5, 13.5], [13.0, -11.0], [-22.0, 5.0], [20.0, 16.5]];
  for (const [x, z] of spools) if (free(x, z, 1.0)) A.put('spool', x, 0.03, z, rng.float() * 6.283, rng.range(0.9, 1.15));
  for (const [x, z] of [[-9.0, 3.0], [9.5, -3.5], [-2.0, -21.0], [3.0, 21.5], [-25.0, 16.0]])
    if (free(x, z, 0.6)) A.put('valve', x, 0.03, z, rng.float() * 6.283, rng.range(0.9, 1.1));
  for (const [x, z, ry] of [[-16.0, -2.5, 0.3], [16.5, 5.5, -1.1], [5.0, -22.5, 0.8]])
    if (free(x, z, 1.2)) A.put('ibeam', x, 0.03, z, ry, 1);
  for (const [x, z, ry] of [[22.5, -6.0, 0.2], [-22.5, -21.0, 1.4]])
    if (free(x, z, 1.6)) A.put('tank_horiz', x, 0.03, z, ry, 1);
  A.put('generator', -11.0, 0.03, -18.5, 1.2, 1);

  // ---- gas bottles, jerry cans, buckets: the small stuff at ankle level -
  for (let i = 0; i < 34; i++) {
    const a = rng.float() * 6.283;
    const r = rng.range(4, 25);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z, 0.5)) continue;
    A.put(rng.pick(['gas_bottle', 'jerry_can', 'bucket', 'box_card_a', 'box_card_b']),
      x, 0.03, z, rng.float() * 6.283, rng.range(0.9, 1.15));
  }

  // ---- sandbag positions at the two gates -------------------------------
  for (const [gx, gz, ry] of [[-3.6, -24.0, 0], [4.0, 24.0, 0], [-24.0, 8.5, Math.PI / 2]]) {
    for (let i = 0; i < 9; i++) {
      const row = (i / 3) | 0;
      const col = i % 3;
      A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
        gx + Math.cos(ry) * (col - 1) * 0.56, 0.03 + row * 0.17, gz - Math.sin(ry) * (col - 1) * 0.56,
        ry + rng.range(-0.06, 0.06), 1);
    }
  }
  for (const [x, z, ry] of [[-6.5, -22.0, 0.2], [6.8, 22.0, -0.2], [22.0, 22.0, 0.8], [-22.5, -8.0, 1.5]])
    A.put('jersey', x, 0.03, z, ry, 1);

  // ---- flood masts: this map's street lamps ----------------------------
  for (const [x, z, ry] of MASTS) {
    A.put('flood_mast', x, 0.03, z, ry, 1);
    A.put('flood_lens', x, 0.03, z, ry, 1);
    A.box('metal', x, 1.2, z, 0.4, 2.4, 0.4);
    // The head is 5.9 m up and aimed down the yard; the lamp anchor goes where
    // the light actually leaves it.
    A.lampAnchors.push({ x: x - Math.sin(ry) * 0.75, y: 5.95, z: z - Math.cos(ry) * 0.75 });
  }

  // ---- weeds through the cracks, rubble against the walls --------------
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 90; i++) {
    const x = rng.range(-RUST.half + 1, RUST.half - 1);
    const z = rng.range(-RUST.half + 1, RUST.half - 1);
    if (!free(x, z, 0.35)) continue;
    A.put('weeds', x, 0.03, z, rng.float() * 6.283, rng.range(0.6, 1.25));
  }
  for (const s of STRUCTURES) {
    rubbleMound(A, rng, s.x + s.w / 2 + 0.8, 0.03, s.z + rng.range(-2, 2), rng.range(1.2, 2.0), 14);
    rubbleMound(A, rng, s.x - s.w / 2 - 0.8, 0.03, s.z + rng.range(-2, 2), rng.range(1.0, 1.8), 11);
  }
  A.jitter = null;
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as the market's `build`.
 */
export function buildRust(A, rng) {
  registerProps(A, rng);
  registerRustProps(A, rng);

  buildGround(A, rng);
  buildFence(A, rng);
  buildDerrick(A, rng);

  const infos = [];
  for (const s of STRUCTURES) {
    if (s.id === 'office') buildOffice(A, rng, s);
    else if (s.id === 'shed') buildShed(A, rng, s);
    else if (s.id === 'garage') buildGarage(A, rng, s);
    else buildPumpHouse(A, rng, s);
    infos.push({ spec: s, id: s.id });
  }

  // The gantry lands on the shed deck, so it is built after both ends exist.
  const shed = STRUCTURES.find((st) => st.id === 'shed');
  buildGantry(
    A,
    rng,
    [
      [DERRICK.x + DERRICK.deckHalf - 0.2, DERRICK.z - 1.2],
      [GANTRY_X, DERRICK.z - 1.2],
      [GANTRY_X, shed.z + shed.d / 2 - 0.1],
    ],
    RUST.deckY
  );

  buildSilos(A, rng);
  placeContainers(A, rng);
  buildPipeRacks(A, rng);
  dressYard(A, rng);

  return { buildings: infos };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const RUST_MAP = {
  id: 'rust',
  blurb: 'Tight, symmetrical, vertical. Containers for cover, a 13 m derrick in the middle, and nowhere to hide from it.',
  size: '55 × 55 m',
  /**
   * LEVEL -> WORLD. A quarter turn off the axes so the container rows and the
   * fence do not sit parallel to the sun's shadow direction — every mass on the
   * map is a rectangle, and rectangles lit square-on lose one of their two lit
   * faces.
   */
  transform: { yaw: 0.42, tx: 0, tz: 0 },
  /**
   * Tight to the fence plus a skirt. `ai` builds its nav grid over this, and
   * there is no reason to sample cells out on the ridge: the perimeter is
   * sealed, so nothing walkable out there is reachable anyway.
   */
  bounds: [-34, -2, -34, 34, 24, 34],
  spawnPoints: RUST_SPAWNS,
  standable: standableAtRust,
  groundY: groundYRust,
  isOpen: isOpenRust,
  build: buildRust,
};
