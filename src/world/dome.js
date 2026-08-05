import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, stairRun, rubbleMound } from './kit.js';
import { registerProps } from './props.js';
import { registerRustProps, CONTAINER } from './rustprops.js';
import { registerDressingProps } from './dressing.js';
import { fbm3, paintMasks, patchGeometry, driftBerm, rockGeometry, tubeY, chamferBox } from './util.js';

/**
 * WORLD — DOME.
 *
 * A low-poly take on the classic Call of Duty map: a derelict radar station on
 * a desert hilltop, 68 x 52 m of dust fought over between its two ends. The
 * whole thing is generated here, like every other surface in the game —
 * nothing is loaded from disk.
 *
 *   THE RADOME    east end: a broken geodesic sphere on a concrete pedestal,
 *                 with a railed catwalk ring around the pedestal at 4.4 m —
 *                 the "track around the dome" that overlooks most of the map —
 *                 and an enterable machine room wrapped around its base. One
 *                 scaffold stair on the south face is the only way up.
 *   THE BUNKER    west end: a long concrete hall with a door at each end, a
 *                 window band over the yard, and a blown-open breach in the
 *                 middle of that wall — three ways in, so no doorway is a
 *                 trap. Inside: columns, a caged store room, and a bombed
 *                 hole in the roof that lets the sun in.
 *   THE YARD      between them, scattered shipping containers, vehicle
 *                 wrecks, sandbag positions and a ground-level dish cluster —
 *                 the cover field the original's mid fight runs on.
 *   THE LANES     a rock-and-ruin lane along the north fence and a container
 *                 lane along the south one, so both ends connect three ways.
 *
 * PROVENANCE. Authored from reference screenshots of the original (overall
 * massing, the drum-and-catwalk radome, the bunker's two-doors-plus-breach
 * wall, the container scatter, the perimeter water tower and antenna masts).
 * Nothing is loaded, imported or sampled at runtime — every mesh below is
 * generated. Deviations for playability are commented where they happen.
 *
 * LAYOUT NOTES
 *   Everything is authored in LEVEL space with the yard centred on the origin,
 *   north at -Z, the radome east and the bunker west.
 *
 *   The only high ground is the catwalk, and the only way onto it is one
 *   exposed stair — the original prices its overlook the same way. Container
 *   roofs, the shed roof and the bunker roof are scenery, not positions.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const DOME = {
  /** Half-extents of the fenced compound. The fence line itself sits on this. */
  halfX: 34,
  halfZ: 26,
  fenceH: 3.2,
  /** Compound floor. Flat: a graded hilltop apron, not terrain. */
  y: 0,
};

/**
 * The radome — the landmark, and the map's whole vertical design.
 *
 * A concrete pedestal carries the sphere; a catwalk ring wraps the pedestal at
 * `catY`, oversailing the machine-room shed built around the base. The shed is
 * ENTERABLE (three door bays) but its roof is not a position: the one route up
 * is the straight scaffold stair on the south face, and its whole run-up is in
 * the open yard — the overlook is paid for on the way to it.
 */
export const RADOME = {
  x: 21,
  z: -6,
  /** The machine room around the base: a 10 x 10 shed, walls at `shedHalf`. */
  shedHalf: 5,
  shedH: 3.3,
  /** Pedestal radius; the catwalk ring runs from `catInner` to `catOuter`. */
  pedR: 2.5,
  pedH: 12.2,
  catY: 4.4,
  catInner: 2.55,
  catOuter: 5.6,
  /** The sphere. Centre height clears 2 m of headroom at the walkway's inner edge. */
  sphereR: 5.8,
  sphereY: 11.8,
  /**
   * Where the scaffold stair climbs the south face, published because the yard
   * has to be kept clear here — a crate dropped on the run-up is the one
   * placement mistake that makes the map's only route up unreachable. The foot
   * is derived, not authored: the top step must land exactly on the catwalk's
   * south edge, so the foot is that edge plus the flight's run.
   */
  stairX: 19,
};
/** 4.4 m at the industrial 0.275/0.3 pitch: 16 steps, 4.8 m of run. */
export const RADOME_STAIR_FOOT_Z = RADOME.z + RADOME.catOuter + Math.round(RADOME.catY / 0.275) * 0.3;

/**
 * The bunker. `doors` are wall-local u offsets of the two end doors in the
 * east (yard-facing) wall; `breach` is the blown-open section between them —
 * the original's "bombed-out portion in the middle of the bunker", and the
 * reason its long wall is never a two-door trap.
 */
export const BUNKER = {
  x: -25,
  z: 0,
  w: 10,
  d: 30,
  h: 4.8,
  doors: [-11, 11],
  breach: { u: 0, w: 3.6, h: 2.9 },
  /** The bombed hole in the roof, in level space. */
  roofHole: { x: -24, z: -3, s: 3 },
};

/**
 * The two structures, shaped like the market's `BUILDINGS` entries so
 * `ui/minimap` can draw them. The shed square stands in for the radome
 * complex's footprint.
 */
export const STRUCTURES = [
  { id: 'bunker', x: BUNKER.x, z: BUNKER.z, w: BUNKER.w, d: BUNKER.d, floors: 1, h: BUNKER.h },
  { id: 'radome', x: RADOME.x, z: RADOME.z, w: RADOME.shedHalf * 2, d: RADOME.shedHalf * 2, floors: 1, h: RADOME.shedH },
];

const H = Math.PI / 2;

/**
 * Containers: `[x, z, ry, tier, proto]`. `tier` 1 sits on the tier-0 box at
 * the same x/z. Only 0 and π/2 for `ry` — the blocker test reads them as
 * axis-aligned rects. The scatter follows the reference: a loose mid-field
 * cluster with one stack, a row squeezed between the radome and the north
 * fence, and the semi-trailer parked against the bunker's south end.
 */
export const CONTAINERS = [
  // mid-field — the cover the yard fight runs on
  [3, 2, 0, 0, 'cont_sand'],
  [3, 2, 0, 1, 'cont_red'],
  [7, -3, 0, 0, 'cont_red'],
  [-1, 8, H, 0, 'cont_green'],
  [9, 12, 0, 0, 'cont_blue'],

  // north lane, between the radome and the fence
  [13, -16, 0, 0, 'cont_green'],
  [21, -17, 0, 0, 'cont_sand'],
  [28, -12, H, 0, 'cont_blue'],

  // east edge, behind the radome
  [29, 2, H, 0, 'cont_sand'],

  // south lane — the trailer against the bunker, and the row past it
  [-14, 14, 0, 0, 'cont_blue'],
  [-4, 18, 0, 0, 'cont_sand'],
  [12, 17, H, 0, 'cont_green'],
  [12, 17, H, 1, 'cont_red'],

  /**
   * THE MOUTH BLOCKS. The perimeter opens once on each long side — a sealed
   * box of fence reads as a box of fence — but an opening is a hole a player
   * walks out of into empty desert, so each is sealed the way a real disused
   * station is: a container parked across the gap, inside the fence line.
   */
  [-6, -24.3, 0, 0, 'cont_red'],
  [2, 24.3, 0, 0, 'cont_green'],
];

/** Where the fence opens: `[side (-1 north / +1 south), x of centre, width]`. */
export const MOUTHS = [
  [-1, -6, 4.4],
  [1, 2, 4.4],
];

/**
 * Ruined low walls along the north lane, 1.6 m of standing masonry — the
 * reference's broken perimeter buildings reduced to the cover they provide.
 * `[x, z, ry, len]`.
 */
export const RUIN_WALLS = [
  [-10, -18, 0, 7],
  [-1, -21, H, 5],
  [-17, -21, 0, 6],
];

/**
 * Vehicle wrecks — the courtyard's dead armour column. `[x, z, ry]`, each with
 * a collision box, so they are cover the occupancy tables know about.
 */
export const WRECKS = [
  [-12, 5, 0.7],
  [-8, 10, -0.4],
  [2, -13, 1.2],
];

/** Flood masts, this map's light towers: `[x, z, ry]`. */
export const MASTS = [
  [-16, -10, 0.8],
  [10, 8, -2.0],
];

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the radome, so nobody spawns staring at a fence.
 *
 * INDEX 0 is the boot/dev spawn (exempt from validation in `buildSpawnPoints`):
 * the south lane, looking north-east across the yard at the sphere.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - RADOME.x, z - RADOME.z) + turn;
export const DOME_SPAWNS = [
  /**
   * FROZEN — the boot spawn, and the frame every capture of this map is shot
   * from: on the service road in front of the bunker, looking straight down
   * its axis at the radome — sandbags and the wreck line right, containers
   * midground, the sphere over everything. The map in one frame.
   */
  [-16, -2, 0, 'courtyard'],
  [-4.5, 21, 0.1, 'south-lane'],
  [3, 19.5, 0.2, 'south-lane'],
  [-9, 20.5, -0.2, 'south-lane'],

  [1, -20, 0, 'north-lane'],
  [7, -19.5, -0.2, 'north-lane'],
  [-5, -20.5, 0.2, 'north-lane'],

  [-26, -18.5, 0.3, 'bunker-north'],
  [-31.5, -13, 0.4, 'bunker-north'],
  [-21, -17.5, 0, 'bunker-north'],

  [-26, 18.5, -0.3, 'bunker-south'],
  [-31.5, 13, -0.4, 'bunker-south'],
  [-21, 17.5, 0, 'bunker-south'],

  [-16, 6, -0.2, 'courtyard'],
  [-14, -4, 0.2, 'courtyard'],
  [-8, 0, 0, 'courtyard'],
  [-17, -8, 0.3, 'courtyard'],

  [5, 6, 0.3, 'mid-yard'],
  [1, -2, 0, 'mid-yard'],
  [10, 8, -0.3, 'mid-yard'],

  [14, -13, 0.2, 'dome-north'],
  [21, -14.5, 0, 'dome-north'],
  [27, -16, -0.2, 'dome-north'],

  [14, 4, 0.2, 'dome-south'],
  [17, 9, 0, 'dome-south'],
  [24, 7, -0.3, 'dome-south'],
  [27, 12, -0.4, 'dome-south'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** A `[x, z, ry, len]` wall row as an axis-aligned `[x0, z0, x1, z1]` rect. */
function wallRect(x, z, ry, len, t) {
  const hx = (ry === 0 ? len : t) / 2;
  const hz = (ry === 0 ? t : len) / 2;
  return [x - hx, z - hz, x + hx, z + hz];
}

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
  for (const [x, z, ry, len] of RUIN_WALLS) out.push(wallRect(x, z, ry, len, 0.4));
  // A wreck is a rotated hull; a conservative axis-aligned square stands in.
  for (const [x, z] of WRECKS) out.push([x - 2.2, z - 2.2, x + 2.2, z + 2.2]);
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the compound floor. */
export function inSolidDome(x, z, m = 0.3) {
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
export function standableAtDome(x, z, margin = 0.55) {
  if (Math.abs(x) > DOME.halfX - 0.8 - margin) return false;
  if (Math.abs(z) > DOME.halfZ - 0.8 - margin) return false;
  return !inSolidDome(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenDome(x, z, m = 0.3) {
  if (Math.abs(x) > DOME.halfX - 0.6) return false;
  if (Math.abs(z) > DOME.halfZ - 0.6) return false;
  return !inSolidDome(x, z, m);
}

/**
 * Analytic floor height. Flat graded apron inside the fence; outside it the
 * desert rolls away and climbs into the ridge line the reference's hills
 * provide — from the catwalk the horizon must be terrain, not a terrain/sky
 * cut. The height field carries it, so the collision comes for free.
 */
export function groundYDome(x, z) {
  const out = Math.max(Math.abs(x) - DOME.halfX, Math.abs(z) - DOME.halfZ);
  if (out <= 0) return 0.02;
  const t = Math.min(1, out / 12);
  const roll = (fbm3(x * 0.05, 5.1, z * 0.05, 3) - 0.5) * 1.3 * t;
  // Starts 8 m beyond the fence and takes 24 m to full height, so the near
  // desert reads flat and the climb is all in the distance.
  const ridge = Math.min(1, Math.max(0, (out - 8) / 24));
  return 0.02 + roll + ridge * ridge * (5.0 + fbm3(x * 0.02, 9.3, z * 0.02, 2) * 8.0);
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

/** A structural member between two points, oriented by quaternion. */
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
 * One storey of wall with real openings punched through it — the same
 * span/sill/lintel emitter Rust carries, so a doorway is a genuine hole in the
 * collision hull. `holes` are `[{ u, w, y, h }]` in wall-local coordinates.
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
    if (oy > 0.02) seg(o.u, o.w, y0 + oy / 2, oy); // sill
    if (oy + oh < h - 0.02) seg(o.u, o.w, y0 + (oy + oh + h) / 2, h - oy - oh); // lintel
    cursor = Math.max(cursor, x1);
  }
  if (cursor < len / 2) seg((cursor + len / 2) / 2, len / 2 - cursor, y0 + h / 2, h);
}

/** A horizontal deck slab with collision and optional under-beams. */
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
      A.add('steel_frame', BOX_THIN(A), LL(IDENT, x, y - t - 0.09, cz, 0, 0.11, 0.2, d), {
        masks: [0.6, 0.55, 0.5],
      });
    }
  }
}

/**
 * One straight run of handrail from (x0,z0) to (x1,z1) at deck height `y`.
 * Collision is ONE thin slab spanning deck to rail height — see Rust's note.
 */
function railRun(A, x0, z0, x1, z1, y, h = 1.06) {
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

/** A level-space panel matrix a stair flight can be composed onto. */
function panel(x, y, z, ry) {
  _quat.setFromAxisAngle(_up, ry);
  _pos.set(x, y, z);
  _scl.set(1, 1, 1);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

/**
 * A flight of steel steps from (x, y, z) up to `top`, climbing in the
 * direction `ry` points. 0.275 rise on a 0.3 going — the industrial pitch.
 */
function flight(A, x, y, z, ry, top, w = 1.4, opts = {}) {
  const steps = Math.max(1, Math.round((top - y) / 0.275));
  stairRun(A, panel(x, y, z, ry), 0, 0, 0, w, steps, (top - y) / steps, 0.3, {
    key: opts.key ?? 'steel_grate',
    railing: opts.railing ?? true,
    stringer: opts.stringer !== false,
  });
  const len = steps * 0.3;
  return { top, len, x: x + Math.sin(ry) * len, z: z + Math.cos(ry) * len };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGround(A, rng) {
  // ------------------------------------------------------------- desert --
  const SX = 200;
  const SZ = 170;
  const terrain = new THREE.PlaneGeometry(SX, SZ, 46, 40);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setY(i, groundYDome(pa.getX(i), pa.getZ(i)) - 0.04);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    out[1] = 0.2 + fbm3(x * 0.28, 6.4, z * 0.28, 2) * 0.42;
    out[0] = 0.18;
  });
  A.add('sand', terrain, null);
  A.collideGeo('sand', terrain);
  terrain.dispose();

  // ------------------------------------------------------------- apron --
  // Compacted dust over the hilltop pad: one subdivided plane so grazing light
  // finds something, one flat collision box so the controller never feels it.
  const W = DOME.halfX * 2;
  const D = DOME.halfZ * 2;
  const apron = new THREE.PlaneGeometry(W, D, 30, 24);
  apron.rotateX(-Math.PI / 2);
  const aa = apron.getAttribute('position');
  for (let i = 0; i < aa.count; i++) {
    const x = aa.getX(i);
    const z = aa.getZ(i);
    aa.setY(i, 0.03 + (fbm3(x * 0.4 + 5, 3.3, z * 0.4, 3) - 0.5) * 0.05);
  }
  apron.computeVertexNormals();
  paintMasks(apron, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.6, 4.9, z * 0.6, 3);
    out[0] = 0.2 + n * 0.28;
    out[1] = 0.14 + Math.max(0, (Math.max(Math.abs(x) - 22, Math.abs(z) - 16) / 10)) * 0.35 + n * 0.2;
  });
  A.add('road_dust', apron, null);
  A.box('dirt', 0, -0.25, 0, W, 0.5, D);
  apron.dispose();

  // The cracked concrete service road from the bunker courtyard to the radome
  // — the reference's slab path, and the line that ties the two ends together.
  const road = new THREE.PlaneGeometry(31, 7, 12, 4);
  road.rotateX(-Math.PI / 2);
  const ra = road.getAttribute('position');
  for (let i = 0; i < ra.count; i++) {
    ra.setY(i, 0.06 + (fbm3(ra.getX(i) * 0.5, 2.2, ra.getZ(i) * 0.5, 2) - 0.5) * 0.03);
  }
  road.computeVertexNormals();
  paintMasks(road, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.7, 7.7, z * 0.7, 3);
    out[0] = 0.25 + n * 0.3;
    out[1] = 0.2 + n * 0.25;
  });
  A.addOnce('yard_slab', road, LL(IDENT, 1, 0, -2, 0));

  // Oil stains and sand drifted against the downwind fences.
  for (let i = 0; i < 18; i++) {
    const a = rng.float() * 6.283;
    const r = rng.range(4, 24);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.7;
    if (inSolidDome(x, z, -0.4)) continue;
    A.addOnce('asphalt', patchGeometry(rng, rng.range(0.7, 2.2), { lobes: 10, wobble: 0.55 }),
      LL(IDENT, x, 0.045, z, rng.float() * 6.283, 1, 1, rng.range(0.5, 1)),
      { masks: [0.05, 0.95, 0.6] });
  }
  for (const [sx, sz] of [[1, 0], [0, 1]]) {
    for (let i = 0; i < 8; i++) {
      const t = (i + rng.float() * 0.6) / 8;
      const x = sx ? DOME.halfX - 0.9 : (t - 0.5) * DOME.halfX * 1.9;
      const z = sz ? DOME.halfZ - 0.9 : (t - 0.5) * DOME.halfZ * 1.9;
      const g = driftBerm(rng, rng.range(4, 9), rng.range(1.6, 3.0), rng.range(0.16, 0.34));
      A.addOnce('sand', g, LL(IDENT, x, 0.03, z, sx ? Math.PI / 2 : 0), { masks: [0.1, 0.4, 0.35] });
    }
  }
}

/**
 * The perimeter: corrugated hoarding on posts, one sealed mouth in each long
 * side, and the reference's skyline furniture beyond it — a rock line, a water
 * tower on the north-west rise, a guard hut and two antenna masts — so the
 * horizon reads as the rest of the station, not a cut-out.
 */
function buildFence(A, rng) {
  const h = DOME.fenceH;
  const sides = [
    [-1, 0], // north
    [1, 0], // south
    [0, -1], // west
    [0, 1], // east
  ];
  for (const [sz, sx] of sides) {
    const ry = sz !== 0 ? 0 : Math.PI / 2;
    const cx = sx * DOME.halfX;
    const cz = sz * DOME.halfZ;
    const len = sz !== 0 ? DOME.halfX * 2 : DOME.halfZ * 2;
    const mouth = MOUTHS.find((m) => sz !== 0 && m[0] === sz);
    const holes = mouth ? [{ u: mouth[1], w: mouth[2], y: 0, h }] : [];
    wallWithHoles(A, 'corrugated_fine', cx, cz, ry, len, 0, h, 0.14, holes, {
      masks: [0.75, 0.45, 0.2],
    });
    const n = Math.round(len / 3);
    for (let i = 0; i <= n; i++) {
      const u = -len / 2 + (i / n) * len;
      if (mouth && Math.abs(u - mouth[1]) < mouth[2] / 2 + 0.2) continue;
      alongWall(cx, cz, ry, u, _wp);
      A.add('steel_frame', BOX(A), LL(IDENT, _wp[0], h / 2 + 0.2, _wp[1], ry, 0.18, h + 0.4, 0.2), {
        masks: [0.7, 0.5, 0.3],
      });
    }
    A.add('steel_frame', BOX_THIN(A), LL(IDENT, cx, h + 0.16, cz, ry, len, 0.11, 0.13), {
      masks: [0.8, 0.4, 0.1],
    });
    if (mouth) {
      for (const s of [-1, 1])
        A.add('steel_frame', BOX(A),
          LL(IDENT, mouth[1] + s * (mouth[2] / 2 + 0.16), (h + 0.9) / 2, cz, 0, 0.3, h + 0.9, 0.3),
          { masks: [0.75, 0.5, 0.3] });
    }
  }

  // Rock line outside, so nothing ends in sky at the fence.
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * 6.283 + rng.range(-0.05, 0.05);
    const x = Math.cos(a) * (DOME.halfX + rng.range(3, 15));
    const z = Math.sin(a) * (DOME.halfZ + rng.range(3, 15));
    const s = rng.range(0.5, 2.1);
    A.addOnce('concrete_dark', rockGeometry(rng, s, 1, rng.range(0.5, 0.8)),
      LL(IDENT, x, groundYDome(x, z) - s * 0.2, z, rng.float() * 6.283), { masks: [0.4, 0.6, 0.4] });
  }

  // The water tower on the north-west rise — pure scenery, outside the sealed
  // perimeter, so it gets no collision proxy the physics would have to walk.
  {
    const tx = -26;
    const tz = -36;
    const ty = groundYDome(tx, tz);
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) {
      strut(A, 'wood_dark', tx + lx, ty, tz + lz, tx + lx * 0.55, ty + 6.6, tz + lz * 0.55, 0.22, [0.7, 0.5, 0.3]);
    }
    strut(A, 'wood_dark', tx - 1.05, ty + 2.6, tz - 1.05, tx + 1.05, ty + 2.6, tz + 1.05, 0.12);
    strut(A, 'wood_dark', tx + 1.05, ty + 2.6, tz - 1.05, tx - 1.05, ty + 2.6, tz + 1.05, 0.12);
    A.addOnce('metal_rust', tubeY(1.7, 2.6, { radial: 10 }), LL(IDENT, tx, ty + 6.6, tz), { masks: [0.6, 0.5, 0.3] });
    A.addOnce('metal_rust', tubeY(1.75, 0.5, { radial: 10, taper: 0.4 }), LL(IDENT, tx, ty + 9.2, tz), {
      masks: [0.75, 0.4, 0.2],
    });
  }
  // The guard hut on the north-east rise.
  {
    const gx = 27;
    const gz = -34;
    const gy = groundYDome(gx, gz);
    A.add('plaster_sand', BOX(A), LL(IDENT, gx, gy + 1.3, gz, 0.2, 4.2, 2.6, 3.2), { masks: [0.5, 0.5, 0.3] });
    A.add('roof_screed', BOX(A), LL(IDENT, gx, gy + 2.72, gz, 0.2, 4.7, 0.24, 3.7), { masks: [0.65, 0.45, 0.25] });
  }
}

/**
 * THE RADOME.
 *
 * Pedestal, machine room, catwalk ring, scaffold stair, and the sphere. The
 * sphere is a faceted geodesic with a handful of panels torn out and its frame
 * left intact over the holes — the reference's silhouette in ~200 merged parts.
 */
function buildRadome(A, rng) {
  const R = RADOME;
  const { x, z } = R;

  // ------------------------------------------------------------ pedestal --
  A.addOnce('concrete', tubeY(R.pedR, R.pedH, { radial: 16 }), LL(IDENT, x, 0.02, z), {
    masks: [0.5, 0.55, 0.35],
  });
  // Two crossed square proxies approximate the drum for collision.
  A.box('concrete', x, R.pedH / 2, z, R.pedR * 2, R.pedH, R.pedR * 2);
  A.box('concrete', x, R.pedH / 2, z, R.pedR * 2, R.pedH, R.pedR * 2, Math.PI / 4);
  // The base ring the reference rails around the drum foot.
  A.addOnce('metal_rust', tubeY(R.pedR + 0.18, 0.9, { radial: 16 }), LL(IDENT, x, 0.05, z), {
    masks: [0.8, 0.5, 0.2],
  });

  // -------------------------------------------------------- machine room --
  // Corrugated walls around the base, three door bays, closed toward the east
  // fence. The roof is a ring of slabs around the drum — scenery, not a
  // position (no stair reaches it), but solid so grenades behave.
  const sh = R.shedHalf;
  const shedSides = [
    [x, z - sh, 0, [{ u: 0.5, w: 2.4, y: 0, h: 2.6 }]], // north door, to the rock lane
    [x, z + sh, 0, [{ u: 1.5, w: 2.4, y: 0, h: 2.6 }]], // south door, clear of the stair
    [x - sh, z, H, [{ u: 0, w: 2.8, y: 0, h: 2.6 }]], // west door, onto the yard
    [x + sh, z, H, [{ u: -2.8, w: 1.6, y: 1.2, h: 1.2 }]], // east: window only, fence behind
  ];
  for (const [cx, cz, ry, holes] of shedSides) {
    wallWithHoles(A, 'corrugated', cx, cz, ry, sh * 2, 0, R.shedH, 0.14, holes, {
      masks: [0.7, 0.5, 0.3],
    });
  }
  // Floor slab and the roof ring.
  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.05, z, 0, sh * 2 - 0.2, 0.1, sh * 2 - 0.2), {
    masks: [0.4, 0.6, 0.45],
  });
  const ringW = sh - 2.6; // slab depth of each roof strip around the drum hole
  for (const [ox, oz, w, d] of [
    [0, -(sh - ringW / 2), sh * 2 + 0.6, ringW],
    [0, sh - ringW / 2, sh * 2 + 0.6, ringW],
    [-(sh - ringW / 2), 0, ringW, (sh - ringW) * 2],
    [sh - ringW / 2, 0, ringW, (sh - ringW) * 2],
  ]) {
    A.add('corrugated', BOX(A), LL(IDENT, x + ox, R.shedH, z + oz, 0, w, 0.14, d), { masks: [0.7, 0.45, 0.25] });
    A.box('metal', x + ox, R.shedH, z + oz, w, 0.14, d);
  }
  // The red steel roof beams the reference carries the ring on.
  for (const s of [-1, 1]) {
    strut(A, 'metal_rust', x - sh + 0.3, R.shedH - 0.22, z + s * 2.2, x + sh - 0.3, R.shedH - 0.22, z + s * 2.2, 0.16, [0.7, 0.5, 0.2]);
    strut(A, 'metal_rust', x + s * 2.2, R.shedH - 0.22, z - sh + 0.3, x + s * 2.2, R.shedH - 0.22, z + sh - 0.3, 0.16, [0.7, 0.5, 0.2]);
  }
  A.interiorLights.push({ x: x - 2.8, y: R.shedH - 0.5, z });
  A.interiorLights.push({ x: x + 2.4, y: R.shedH - 0.5, z: z + 2.2 });

  // ------------------------------------------------------------ catwalk --
  // Four slabs tile the ring between `catInner` and `catOuter`. The outer rail
  // opens once, where the stair lands on the south edge.
  const ci = R.catInner;
  const co = R.catOuter;
  const cw = co - ci;
  const mid = (ci + co) / 2;
  deck(A, 'steel_grate', x, R.catY, z - mid, co * 2, cw, { t: 0.16 });
  deck(A, 'steel_grate', x, R.catY, z + mid, co * 2, cw, { t: 0.16 });
  deck(A, 'steel_grate', x - mid, R.catY, z, cw, ci * 2, { t: 0.16 });
  deck(A, 'steel_grate', x + mid, R.catY, z, cw, ci * 2, { t: 0.16 });
  const e = co - 0.05;
  railRun(A, x - e, z - e, x + e, z - e, R.catY); // north
  railRun(A, x - e, z - e, x - e, z + e, R.catY); // west
  railRun(A, x + e, z - e, x + e, z + e, R.catY); // east
  // South rail opens at the stair head.
  railRun(A, x - e, z + e, R.stairX - 0.85, z + e, R.catY);
  railRun(A, R.stairX + 0.85, z + e, x + e, z + e, R.catY);
  // Knee braces from the shed walls to the oversailing edge, on all four sides.
  for (const s of [-1, 1]) {
    strut(A, 'steel_frame', x + s * sh, R.shedH - 0.4, z, x + s * (co - 0.3), R.catY - 0.2, z, 0.14, [0.75, 0.45, 0.2]);
    strut(A, 'steel_frame', x, R.shedH - 0.4, z + s * sh, x, R.catY - 0.2, z + s * (co - 0.3), 0.14, [0.75, 0.45, 0.2]);
  }

  // ------------------------------------------------------------- stair --
  // One straight scaffold flight up the south face. The top step lands ON the
  // catwalk's south edge; the foot is derived from that (see RADOME_STAIR_FOOT_Z).
  flight(A, R.stairX, 0.02, RADOME_STAIR_FOOT_Z, Math.PI, R.catY, 1.4);
  // The ladder the reference leans against the drum — dressing, not a route.
  A.put('ladder', x, 0.3, z - R.pedR - 0.08, Math.PI, 1.5);

  // ------------------------------------------------------------- sphere --
  // A faceted geodesic ball. Panels are the icosphere's own triangles with a
  // few torn out; the frame is a strut per edge of the FULL sphere, so the
  // lattice stays intact across the holes — that is the reference's silhouette.
  const ball = new THREE.IcosahedronGeometry(R.sphereR, 1);
  const src = ball.getAttribute('position');
  const TORN = new Set([4, 11, 23, 37, 52, 66, 71]); // deterministic tear pattern
  const kept = [];
  for (let f = 0; f < src.count / 3; f++) {
    if (TORN.has(f)) continue;
    for (let v = 0; v < 3; v++) kept.push(src.getX(f * 3 + v), src.getY(f * 3 + v), src.getZ(f * 3 + v));
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  skin.computeVertexNormals();
  paintMasks(skin, (px, py, pz, nx, ny, nz, out) => {
    out[0] = 0.35 + fbm3(px * 0.4, 3.1, py * 0.4, 2) * 0.3;
    out[1] = 0.25 + Math.max(0, -ny) * 0.4; // grime hangs under the belly
  });
  A.addOnce('plaster_white', skin, LL(IDENT, x, R.sphereY, z), { masks: [0.5, 0.4, 0.3] });
  const frame = new THREE.EdgesGeometry(ball, 1);
  const fp = frame.getAttribute('position');
  for (let i = 0; i < fp.count; i += 2) {
    strut(A, 'steel_frame',
      x + fp.getX(i), R.sphereY + fp.getY(i), z + fp.getZ(i),
      x + fp.getX(i + 1), R.sphereY + fp.getY(i + 1), z + fp.getZ(i + 1),
      0.09, [0.8, 0.4, 0.15]);
  }
  frame.dispose();
  ball.dispose();
  // One coarse proxy so shots into the ball stop in it — nothing stands here.
  A.box('concrete', x, R.sphereY, z, R.sphereR * 1.4, R.sphereR * 1.4, R.sphereR * 1.4);

  A.lampAnchors.push({ x, y: R.catY + 2.6, z: z - co });
}

/**
 * THE BUNKER — the west end's long concrete hall.
 *
 * Two end doors, a window band over the yard and the breach between them;
 * inside, two columns, a caged store room and the bombed hole in the roof.
 * The roof is dressed (dishes, whip antennas) but unreachable — on a map this
 * small, a second overlook facing the catwalk would be a cross-map duel.
 */
function buildBunker(A, rng, s) {
  const t = 0.3;
  const { x, z, w, d, h } = s;
  const B = BUNKER;

  // East (yard) face: door - window - window - BREACH - window - window - door.
  const east = [
    { u: B.doors[0], w: 1.5, y: 0, h: 2.5 },
    { u: -7, w: 2.2, y: 1.2, h: 1.5 },
    { u: -3.8, w: 1.8, y: 1.2, h: 1.5 },
    { u: B.breach.u, w: B.breach.w, y: 0, h: B.breach.h },
    { u: 3.8, w: 1.8, y: 1.2, h: 1.5 },
    { u: 7, w: 2.2, y: 1.2, h: 1.5 },
    { u: B.doors[1], w: 1.5, y: 0, h: 2.5 },
  ];
  wallWithHoles(A, 'concrete', x + w / 2, z, H, d, 0, h, t, east, { masks: [0.45, 0.5, 0.3] });
  // West face: two high slits — light, not a route; the fence is 4 m behind.
  wallWithHoles(A, 'concrete', x - w / 2, z, H, d, 0, h, t,
    [{ u: -5, w: 2.4, y: 2.6, h: 1.1 }, { u: 5, w: 2.4, y: 2.6, h: 1.1 }], { masks: [0.45, 0.5, 0.3] });
  // End faces: one window each, watching the lanes.
  wallWithHoles(A, 'concrete', x, z - d / 2, 0, w, 0, h, t, [{ u: 0, w: 2.0, y: 1.2, h: 1.5 }], {
    masks: [0.45, 0.5, 0.3],
  });
  wallWithHoles(A, 'concrete', x, z + d / 2, 0, w, 0, h, t, [{ u: 0, w: 2.0, y: 1.2, h: 1.5 }], {
    masks: [0.45, 0.5, 0.3],
  });

  // Floor.
  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.06, z, 0, w - t, 0.12, d - t), { masks: [0.4, 0.55, 0.4] });
  A.box('concrete', x, 0.06, z, w - t, 0.12, d - t);

  // Roof: four slabs around the bombed hole, then the parapet.
  const hx = B.roofHole.x;
  const hz = B.roofHole.z;
  const hs = B.roofHole.s / 2;
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  const slabs = [
    [x0, hx - hs, z0, z1], // west strip
    [hx + hs, x1, z0, z1], // east strip
    [hx - hs, hx + hs, z0, hz - hs], // between, north of the hole
    [hx - hs, hx + hs, hz + hs, z1], // between, south of it
  ];
  for (const [sx0, sx1, sz0, sz1] of slabs) {
    if (sx1 - sx0 < 0.05 || sz1 - sz0 < 0.05) continue;
    A.add('roof_screed', BOX(A),
      LL(IDENT, (sx0 + sx1) / 2, h, (sz0 + sz1) / 2, 0, sx1 - sx0, 0.26, sz1 - sz0),
      { masks: [0.6, 0.5, 0.3] });
    A.box('concrete', (sx0 + sx1) / 2, h, (sz0 + sz1) / 2, sx1 - sx0, 0.26, sz1 - sz0);
  }
  // Parapet, unbroken — nothing lands on this roof.
  for (const [cx, cz, ry, len] of [
    [x, z0 + 0.13, 0, w],
    [x, z1 - 0.13, 0, w],
    [x0 + 0.13, z, H, d],
    [x1 - 0.13, z, H, d],
  ]) {
    A.add('concrete', BOX(A), LL(IDENT, cx, h + 0.42, cz, ry, len, 0.6, 0.26), { masks: [0.55, 0.5, 0.3] });
  }

  // The rubble the roof hole dropped, directly beneath it.
  rubbleMound(A, rng, hx, 0.06, hz, 1.6, 16);

  // Columns carrying the roof either side of the hole.
  for (const cz of [-7, 7]) {
    A.add('concrete', BOX(A), LL(IDENT, x, h / 2, z + cz, 0, 0.55, h, 0.55), { masks: [0.5, 0.55, 0.35] });
    A.box('concrete', x, h / 2, z + cz, 0.55, h, 0.55);
  }

  // The caged store room in the south half — the reference's inner room, with
  // a door toward the yard wall and a counter window toward the hall.
  wallWithHoles(A, 'plaster_sand', x - 1, z + 7, 0, w - t - 2, 0, 2.6, 0.18,
    [{ u: 1.8, w: 1.1, y: 0, h: 2.2 }], { masks: [0.45, 0.5, 0.4] });
  wallWithHoles(A, 'plaster_sand', x + 2.5 - 1, z + 11, H, 8, 0, 2.6, 0.18,
    [{ u: 0.5, w: 2.0, y: 1.0, h: 1.2 }], { masks: [0.45, 0.5, 0.4] });

  // Furniture: the office the desk graffiti made famous, kept abstract.
  A.put('table', x + 1.2, 0.13, z + 12.5, 0.2, 1);
  A.put('chair', x + 0.2, 0.13, z + 12.0, 2.4, 1);
  A.put('cabinet', x - w / 2 + 1.0, 0.13, z + 13.5, H, 1);
  A.put('shelf', x - w / 2 + 0.8, 0.13, z - 12.5, H, 1);
  A.put('cabinet', x - w / 2 + 1.0, 0.13, z - 9.5, H, 1);
  A.put('crate_b', x + 1.5, 0.13, z - 11.0, 0.7, 1);
  A.put('mattress', x - 2.0, 0.13, z - 4.0, 1.9, 1);

  // Roof dressing: the dish farm and two whip antennas.
  A.put('sat_dish', x - 1.5, h + 0.26, z - 9, 0.9, 1.5);
  A.put('sat_dish', x + 1.0, h + 0.26, z - 5.5, 1.4, 1.2);
  A.put('sat_dish', x - 0.5, h + 0.26, z + 10, -0.7, 1.3);
  strut(A, 'steel_frame', x - 2, h, z + 4, x - 2, h + 4.6, z + 4, 0.09, [0.85, 0.4, 0.1]);
  strut(A, 'steel_frame', x + 2, h, z - 13, x + 2, h + 3.8, z - 13, 0.09, [0.85, 0.4, 0.1]);

  A.interiorLights.push({ x, y: h - 0.6, z: z - 8 });
  A.interiorLights.push({ x, y: h - 0.6, z: z + 2 });
  A.interiorLights.push({ x: x - 1, y: 2.2, z: z + 11.5 });
}

/** The ruined masonry along the north lane, with rubble at its feet. */
function buildRuins(A, rng) {
  for (const [x, z, ry, len] of RUIN_WALLS) {
    wallWithHoles(A, 'stone_pale', x, z, ry, len, 0, 1.6, 0.4,
      [{ u: len * 0.22, w: 1.0, y: 0.9, h: 0.7 }], { masks: [0.6, 0.55, 0.4] });
    rubbleMound(A, rng, x + Math.cos(ry) * (len / 2 + 0.9), 0.03, z - Math.sin(ry) * (len / 2 + 0.9),
      rng.range(0.9, 1.5), 10);
  }
}

/** Containers, and the collision that makes them cover. */
function placeContainers(A, rng) {
  const { l: L, h: CH, w: W } = CONTAINER;
  for (const [x, z, ry, tier, proto] of CONTAINERS) {
    const y = 0.04 + tier * (CH + 0.03);
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
 * Set dressing: the dead armour column, sandbag positions, the ground dish
 * cluster, and the loose steel a radar station sheds. Everything instanced,
 * everything jittered, everything filtered through `free()`.
 */
function dressYard(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.5, scale: 0.06 };

  const free = (x, z, m = 0.8) => {
    if (!isOpenDome(x, z, m)) return false;
    // Keep the stair run-up clear — see the note on RADOME.stairX.
    if (Math.hypot(x - RADOME.stairX, z - RADOME_STAIR_FOOT_Z - 1.2) < 2.8) return false;
    return true;
  };

  // ---- the wrecks: authored cover, so they get real proxies ---------------
  for (const [x, z, ry] of WRECKS) {
    A.put('wreck', x, 0.05, z, ry, 1);
    A.box('metal', x, 0.75, z, 4.4, 1.5, 1.9, ry);
  }

  // ---- sandbag positions --------------------------------------------------
  for (const [gx, gz, ry] of [[-13, -6, 0.4], [4, 7, 1.2], [13, 1, -0.5]]) {
    for (let i = 0; i < 9; i++) {
      const row = (i / 3) | 0;
      const col = i % 3;
      A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
        gx + Math.cos(ry) * (col - 1) * 0.56, 0.03 + row * 0.17, gz - Math.sin(ry) * (col - 1) * 0.56,
        ry + rng.range(-0.06, 0.06), 1);
    }
  }
  for (const [x, z, ry] of [[-2, 15, 0.3], [8, -8, 1.1], [16, 14, 0.7]])
    if (free(x, z, 1.0)) A.put('jersey', x, 0.03, z, ry, 1);

  // ---- the ground dish cluster -------------------------------------------
  for (const [x, z, ry] of [[-4, 12.5, 0.4], [-5.4, 13.6, 1.1], [-2.9, 14.2, -0.6]])
    if (free(x, z, 0.7)) A.put('sat_dish', x, 0.03, z, ry, 1.6);

  // ---- drums, crates, pallets, spools ------------------------------------
  const drumSpots = [
    [-6.5, -7.5], [-5.6, -8.2], [-6.1, -8.9], [12, -6], [12.8, -6.7],
    [-18, 10], [-18.8, 10.7], [16, -18.5], [16.8, -19.2], [25, -3], [25.7, -3.8],
    [5, 21], [5.8, 21.6], [-22, -13], [30, 8], [30.6, 8.8], [-10, 22.5],
  ];
  for (let i = 0; i < drumSpots.length; i++) {
    const [x, z] = drumSpots[i];
    if (!free(x, z, 0.6)) continue;
    A.put(i % 4 === 0 ? 'barrel_blue' : 'barrel_rust', x, 0.03, z, rng.float() * 6.283, rng.range(0.95, 1.05));
    if (rng.float() < 0.2) A.put('barrel_rust', x, 0.03 + 0.88, z, rng.float() * 6.283, 1);
  }
  const stuff = [
    [-6, -14, 'crate_a'], [-5.1, -14.5, 'crate_b'], [14, 20, 'crate_c'], [14.9, 20.4, 'crate_a'],
    [-19, 16.5, 'pallet'], [6, -21.5, 'pallet'], [24, 16, 'crate_b'],
    [-30, 5, 'crate_c'], [-30.5, -5, 'pallet'], [31, -6, 'crate_a'],
    [17, -8.5, 'tyre'], [17.6, -8.0, 'tyre'], [-20, 21, 'tyre_small'],
  ];
  for (const [x, z, id] of stuff) if (free(x, z, 0.5)) A.put(id, x, 0.03, z, rng.float() * 6.283, rng.range(0.92, 1.08));
  for (const [x, z] of [[13, 11], [-11, -13.5], [28, 19]])
    if (free(x, z, 1.0)) A.put('spool', x, 0.03, z, rng.float() * 6.283, rng.range(0.9, 1.15));
  for (const [x, z, ry] of [[-8, 16.5, 0.3], [18, -3, 1.2]])
    if (free(x, z, 1.2)) A.put('pipe_short', x, 0.22, z, ry, 1);
  A.put('generator', 15, 0.05, 5.5, 0.9, 1);
  A.box('metal', 15, 0.55, 5.5, 1.7, 1.1, 1.1, 0.9);

  // Inside the machine room: what a drum room holds.
  A.put('spool', RADOME.x - 3.6, 0.12, RADOME.z + 3.4, 0.8, 1);
  A.put('barrel_rust', RADOME.x + 3.6, 0.12, RADOME.z - 3.5, 1.9, 1);
  A.put('barrel_blue', RADOME.x + 4.0, 0.12, RADOME.z - 2.6, 0.4, 1);
  A.put('box_card_a', RADOME.x - 3.8, 0.12, RADOME.z - 3.4, 2.6, 1);

  // ---- the small stuff at ankle level ------------------------------------
  for (let i = 0; i < 26; i++) {
    const a = rng.float() * 6.283;
    const x = Math.cos(a) * rng.range(4, 30);
    const z = Math.sin(a) * rng.range(4, 22);
    if (!free(x, z, 0.5)) continue;
    A.put(rng.pick(['gas_bottle', 'jerry_can', 'bucket', 'box_card_a', 'box_card_b']),
      x, 0.03, z, rng.float() * 6.283, rng.range(0.9, 1.15));
  }

  // ---- flood masts, which are also this map's lamps ----------------------
  for (const [x, z, ry] of MASTS) {
    A.put('flood_mast', x, 0.03, z, ry, 1);
    A.put('flood_lens', x, 0.03, z, ry, 1);
    A.box('metal', x, 1.2, z, 0.4, 2.4, 0.4);
    A.lampAnchors.push({ x: x - Math.sin(ry) * 0.75, y: 5.95, z: z - Math.cos(ry) * 0.75 });
  }
  // Antenna masts on the ridge outside — the reference's skyline, no proxies.
  for (const [x, z] of [[40, -12], [43, 6], [-40, 14]]) {
    A.put('flood_mast', x, groundYDome(x, z), z, rng.float() * 6.283, rng.range(1.1, 1.35));
  }

  // ---- weeds through the dust --------------------------------------------
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-DOME.halfX + 1, DOME.halfX - 1);
    const z = rng.range(-DOME.halfZ + 1, DOME.halfZ - 1);
    if (!free(x, z, 0.35)) continue;
    A.put('weeds', x, 0.03, z, rng.float() * 6.283, rng.range(0.6, 1.25));
  }
  A.jitter = null;
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map's `build`.
 */
export function buildDome(A, rng) {
  registerProps(A, rng);
  registerRustProps(A, rng);
  registerDressingProps(A, rng); // for the vehicle wrecks

  buildGround(A, rng);
  buildFence(A, rng);
  buildRadome(A, rng);
  buildBunker(A, rng, STRUCTURES.find((s) => s.id === 'bunker'));
  buildRuins(A, rng);
  placeContainers(A, rng);
  dressYard(A, rng);

  return { buildings: STRUCTURES.map((s) => ({ spec: s, id: s.id })) };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const DOME_MAP = {
  id: 'dome',
  blurb: 'A broken radome over a desert outpost. The catwalk ring sees the whole yard — the bunker is the only place it cannot reach.',
  size: '68 × 52 m',
  /**
   * LEVEL -> WORLD. A few tenths off the axes so the bunker, the containers
   * and the fence never sit parallel to the sun's shadow direction — every
   * mass here is a rectangle, and rectangles lit square-on lose one of their
   * two lit faces.
   */
  transform: { yaw: 0.35, tx: 0, tz: 0 },
  /**
   * Tight to the fence plus a skirt. `ai` builds its nav grid over this, and
   * the perimeter is sealed, so nothing walkable outside it is reachable.
   */
  bounds: [-40, -2, -32, 40, 24, 32],
  spawnPoints: DOME_SPAWNS,
  standable: standableAtDome,
  groundY: groundYDome,
  isOpen: isOpenDome,
  build: buildDome,
};
