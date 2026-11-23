import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, stairRun } from './kit.js';
import { registerProps } from './props.js';
import { registerLouvreProps, LV_BLOCK, LV_PLANTER, LV_WALLACE, LV_BALUSTRADE } from './louvreprops.js';
import { fbm3, paintMasks, tubeY } from './util.js';

/**
 * WORLD — THE LOUVRE.
 *
 * The Cour Napoléon in Paris: the museum's main courtyard, cropped to its
 * fighting core and enclosed the way the real one is — palace wings on three
 * sides and the Carrousel gardens on the fourth. Everything is generated here;
 * nothing is loaded from disk.
 *
 *   THE PYRAMID     dead centre, I. M. Pei's glass pyramid at its real size:
 *                   35.4 m on a side, 21.6 m tall. It stops bodies, not eyes —
 *                   glass is transparent and shatters (see `physics/surfaces`),
 *                   so the map's centre is a see-through obstacle: you can read
 *                   the far lane through it, and shoot through it, but you have
 *                   to walk round it. The steel lattice is the only thing that
 *                   breaks a sightline across it.
 *   THE BASINS      the triangular pools on three sides of it, with a small
 *                   pyramid on an island in each side. Kerb-height stone rims:
 *                   crouch cover, wadeable water.
 *   THE ARCADES     the Richelieu wing (north) and Denon wing (south) fronted by
 *                   arcaded galleries, the statue terrace running along their
 *                   roofs. A stair at each end of each terrace makes them the
 *                   map's high ground: 6.4 m up, behind a stone balustrade, in
 *                   front of a palace wall nobody can flank through.
 *   SULLY           the east wing and the Pavillon de l'Horloge, its clock and
 *                   square dome, with the passage to the Cour Carrée gated shut.
 *   CARROUSEL       the west edge: the Arc du Carrousel, walkable through its
 *                   three arches, and the iron railing of the Carrousel garden
 *                   behind it. On the axis between it and the pyramid, the lead
 *                   equestrian Louis XIV that stands there.
 *
 * LAYOUT NOTES
 *   LEVEL space: origin at the pyramid's centre, north (Richelieu) at -Z, east
 *   (Sully) at +X. The real courtyard is ~110 m between the wings and the Arc du
 *   Carrousel stands well out in the Place du Carrousel; both are pulled in so
 *   the court is 95 × 80 m — inside the Workmelt band — while the pyramid keeps
 *   its true size, since it IS the map. The arcade terraces are real (statues
 *   of illustrious Frenchmen line them); the stairs onto them are not — they
 *   are how a terrace becomes a position rather than scenery.
 *
 *   Cover in the lanes is what Paris actually puts there: Versailles planters
 *   with clipped orange trees, Wallace fountains, and the concrete anti-ram
 *   blocks every landmark now wears. Placed every 11-14 m down each lane so
 *   the 95 m east-west run is never one sightline.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

const H = Math.PI / 2;

export const LOUVRE = {
  /** West edge: the Carrousel garden railing. */
  x0: -49,
  /** East edge: the Sully wing's west face. */
  x1: 46,
  /** The Richelieu / Denon wing faces, behind the arcades (±Z). */
  zWall: 40,
  /** The arcade front line (±Z). */
  zArcade: 34,
  /** Statue terrace walking height, over the arcades. */
  terraceY: 6.4,
  /** Wing cornice height and the mansard over it. */
  wingH: 18.5,
  /** Railing height: well over the 1.85 m mantle ceiling. */
  fenceH: 3.1,
};

/** The glass pyramid, at its real dimensions. */
export const PYRAMID = { x: 0, z: 0, half: 17.7, h: 21.6 };

/**
 * The pools around it: on the north, south and east sides, a band from 2 m to
 * 8 m out from the pyramid's base. Each band is two right triangles flanking an
 * island that carries one of the small pyramids. The west side is the
 * entrance plaza and has no pool.
 */
export const POOLS = { d0: PYRAMID.half + 2, d1: PYRAMID.half + 8, island: 3.2, rim: 0.36, rimH: 0.62, waterY: 0.44 };

/** The three small pyramids: `[x, z]` centres, sharing one size. */
export const PYRAMIDION = { half: 2.8, h: 3.4 };
const pMid = (POOLS.d0 + POOLS.d1) / 2;
export const PYRAMIDIONS = [
  [0, -pMid],
  [0, pMid],
  [pMid, 0],
];

/** Side frames: (u along the side, d out from the centre) -> level x/z. */
const SIDES = {
  n: (u, d) => [u, -d],
  s: (u, d) => [u, d],
  e: (u, d) => [d, u],
};

/** Triangular basins as `[[x,z],[x,z],[x,z]]`, built from POOLS. */
export const BASINS = (() => {
  const { d0, d1, island } = POOLS;
  const P = PYRAMID.half;
  const out = [];
  for (const f of Object.values(SIDES)) {
    out.push([f(-P, d0), f(-island, d0), f(-island, d1)]);
    out.push([f(island, d0), f(P, d0), f(island, d1)]);
  }
  return out;
})();

/**
 * The arcades. Piers on a 4 m pitch from x0 to x1, an arch springing at 3.6 m
 * between each pair, and the terrace slab over the whole run. `pierD` is the
 * pier's depth into the gallery from the arcade front line.
 */
export const ARCADE = { x0: -30, x1: 30, pitch: 4, pier: 1.1, pierD: 1.2, spring: 3.6, soffit: 5.8 };

/**
 * The four terrace stairs: `[footX, z, dir]`. Each climbs along X (dir +1
 * east, -1 west) beside the wing wall and lands on the terrace's end edge.
 * Foot positions are derived, not typed, so the top step cannot drift off the
 * terrace edge if the terrace height moves.
 */
export const STAIR = { w: 2.4, zOff: 38.6, rise: 0.275, run: 0.3 };
export const stairSteps = () => Math.round(LOUVRE.terraceY / STAIR.rise);
export const stairLen = () => stairSteps() * STAIR.run;
export const STAIRS = [
  [ARCADE.x0 - stairLen(), -STAIR.zOff, 1],
  [ARCADE.x1 + stairLen(), -STAIR.zOff, -1],
  [ARCADE.x0 - stairLen(), STAIR.zOff, 1],
  [ARCADE.x1 + stairLen(), STAIR.zOff, -1],
];
/** A stair's footprint `[x0, z0, x1, z1]`. */
export function stairRect([fx, z, dir]) {
  const x0 = dir > 0 ? fx : fx - stairLen();
  return [x0, z - STAIR.w / 2, x0 + stairLen(), z + STAIR.w / 2];
}

/**
 * Palace masses: `{ id, x0, z0, x1, z1, h, roof, y0 }`. `roof` is `x`/`z` for
 * a mansard whose ridge runs along that axis, `dome` for a pavilion's square
 * dome, or omitted. `bg` marks scenery outside the court.
 */
const W = LOUVRE.wingH;
export const MASSES = [
  { id: 'richelieu', x0: -50, z0: -52, x1: 58, z1: -40, h: W, roof: 'x' },
  { id: 'pav-richelieu', x0: -9, z0: -53, x1: 9, z1: -40, h: 22, roof: 'dome' },
  { id: 'denon', x0: -50, z0: 40, x1: 58, z1: 52, h: W, roof: 'x' },
  { id: 'pav-denon', x0: -9, z0: 40, x1: 9, z1: 53, h: 22, roof: 'dome' },
  // corner pavilions, projecting to the arcade line
  { id: 'pav-nw', x0: -50, z0: -52, x1: -40, z1: -34, h: 22, roof: 'dome' },
  { id: 'pav-ne', x0: 40, z0: -52, x1: 58, z1: -34, h: 22, roof: 'dome' },
  { id: 'pav-sw', x0: -50, z0: 34, x1: -40, z1: 52, h: 22, roof: 'dome' },
  { id: 'pav-se', x0: 40, z0: 34, x1: 58, z1: 52, h: 22, roof: 'dome' },
  // Sully, split round the Pavillon de l'Horloge and its passage
  { id: 'sully-n', x0: 46, z0: -40, x1: 58, z1: -11, h: W, roof: 'z' },
  { id: 'sully-s', x0: 46, z0: 11, x1: 58, z1: 40, h: W, roof: 'z' },
  { id: 'horloge-n', x0: 46, z0: -11, x1: 58, z1: -3, h: 24 },
  { id: 'horloge-s', x0: 46, z0: 3, x1: 58, z1: 11, h: 24 },
  { id: 'horloge-back', x0: 52, z0: -3, x1: 58, z1: 3, h: 24 },
  { id: 'horloge-lintel', x0: 46, z0: -3, x1: 52, z1: 3, h: 24, y0: 7.9 },
  // the wings running on west past the garden — the Grande Galerie and Rivoli
  { id: 'rivoli', x0: -112, z0: -52, x1: -50, z1: -40, h: W, roof: 'x', bg: true },
  { id: 'galerie', x0: -112, z0: 40, x1: -50, z1: 52, h: W, roof: 'x', bg: true },
];

/** The Sully passage to the Cour Carrée, gated shut. */
export const PASSAGE = { z: 3, spring: 4.6, top: 7.9, gateX: 48 };

/** The Arc du Carrousel, pulled in to close the west end of the court. */
export const ARC = {
  x: -43,
  z: 0,
  /** Depth along X and width along Z. */
  d: 7.3,
  w: 19.5,
  /** Entablature, attic and the quadriga plinth on top. */
  body: 10.4,
  attic: 13.6,
  /** Arches through it, E-W: `[zCentre, halfWidth, springline]`. */
  arches: [[0, 2.2, 5.4], [-6.25, 1.35, 3.4], [6.25, 1.35, 3.4]],
  /** Column pedestals project this far from each face. */
  pedestal: 1.0,
};
/** The arc's four piers, as `[z0, z1]`, between the arches. */
export const ARC_PIERS = (() => {
  const edges = [-ARC.w / 2];
  for (const [zc, hw] of [...ARC.arches].sort((a, b) => a[0] - b[0])) edges.push(zc - hw, zc + hw);
  edges.push(ARC.w / 2);
  const out = [];
  for (let i = 0; i < edges.length; i += 2) out.push([ARC.z + edges[i], ARC.z + edges[i + 1]]);
  return out;
})();

/** The lead equestrian Louis XIV: plinth footprint and height. */
export const LOUIS = { x: -33, z: 0, l: 6, w: 3.2, h: 2.6 };

/**
 * Cover in the court: `[x, z, kind, ry]`. Kinds are the planter (orange tree),
 * the anti-ram `block` and the Wallace fountain. `ry` is 0 or π/2 only — the
 * occupancy test reads them as axis-aligned rects.
 */
export const COVER = [
  // north lane, along the Richelieu arcade
  [-42, -30, 'orange', 0], [-28, -30, 'orange', 0], [-14, -30, 'block', H], [0, -30, 'wallace', 0],
  [14, -30, 'block', H], [28, -30, 'orange', 0], [40, -30, 'orange', 0],
  // south lane, along the Denon arcade
  [-42, 30, 'orange', 0], [-28, 30, 'block', H], [-14, 30, 'orange', 0], [0, 30, 'wallace', 0],
  [14, 30, 'orange', 0], [28, 30, 'block', H], [40, 30, 'orange', 0],
  // east lane, under the clock
  [36, -22, 'orange', 0], [36, -11, 'block', 0], [36, 0, 'wallace', 0], [36, 11, 'block', 0], [36, 22, 'orange', 0],
  // west lane, either side of Louis XIV
  [-34, -23, 'orange', 0], [-34, -12, 'block', 0], [-34, 12, 'block', 0], [-34, 23, 'orange', 0],
  // the pyramid's own corners, where the pools give out
  [-24, -21, 'block', 0], [-24, 21, 'block', 0],
];
export function coverRect([x, z, kind, ry]) {
  let hx;
  let hz;
  if (kind === 'block') {
    hx = (ry ? LV_BLOCK.w : LV_BLOCK.l) / 2;
    hz = (ry ? LV_BLOCK.l : LV_BLOCK.w) / 2;
  } else if (kind === 'orange') hx = hz = LV_PLANTER.s / 2;
  else hx = hz = LV_WALLACE.s / 2;
  return [x - hx, z - hz, x + hx, z + hz];
}

/** Lamp standards at the pyramid's corners: `[x, z, ry]`. */
const LC = PYRAMID.half + 3.8;
export const LAMPS = [[-LC, -LC, 0.8], [LC, -LC, 2.4], [-LC, LC, -0.8], [LC, LC, -2.4]];

/** Benches facing the pyramid across the pools: `[x, z, ry]`. */
export const BENCHES = [
  [-9, -27.5, 0], [9, -27.5, 0], [-9, 27.5, Math.PI], [9, 27.5, Math.PI],
  [27.5, -9, -H], [27.5, 9, -H],
];

/**
 * Spawn points: `[x, z, turn, zone]`, aimed at the pyramid plus `turn`.
 *
 * INDEX 0 is the boot spawn: the south-west corner of the court beside the
 * Arc, looking up the axis at the pyramid with the clock pavilion behind it.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - PYRAMID.x, z - PYRAMID.z) + turn;
export const LOUVRE_SPAWNS = [
  [-38, 16, 0, 'arc-south'], // FROZEN — boot spawn
  [-45, 22, 0.2, 'arc-south'],
  [-45, 14, -0.1, 'arc-south'],
  [-38, -16, 0, 'arc-north'],
  [-45, -22, -0.2, 'arc-north'],
  [-45, -14, 0.1, 'arc-north'],

  [-24, -37.4, 0.3, 'richelieu-west'],
  [-16, -37.4, 0.2, 'richelieu-west'],
  [16, -37.4, -0.2, 'richelieu-east'],
  [24, -37.4, -0.3, 'richelieu-east'],

  [-24, 37.4, -0.3, 'denon-west'],
  [-16, 37.4, -0.2, 'denon-west'],
  [16, 37.4, 0.2, 'denon-east'],
  [24, 37.4, 0.3, 'denon-east'],

  [42, -26, 0, 'sully-north'],
  [42, -16, 0.1, 'sully-north'],
  [41, -6, 0.2, 'sully-north'],
  [42, 26, 0, 'sully-south'],
  [42, 16, -0.1, 'sully-south'],
  [41, 6, -0.2, 'sully-south'],

  [-6, -31.5, 0, 'north-lane'],
  [6, -31.5, 0, 'north-lane'],
  [-6, 31.5, 0, 'south-lane'],
  [6, 31.5, 0, 'south-lane'],

  [-25, -14, 0, 'queue'],
  [-25, 14, 0, 'queue'],
].map(([x, z, turn, zone]) => [x, z, facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Arcade pier footprints, both wings. */
export const PIERS = (() => {
  const out = [];
  const n = Math.round((ARCADE.x1 - ARCADE.x0) / ARCADE.pitch);
  for (const s of [-1, 1]) {
    for (let i = 0; i <= n; i++) {
      const x = ARCADE.x0 + i * ARCADE.pitch;
      const za = s * LOUVRE.zArcade;
      const zb = s * (LOUVRE.zArcade + ARCADE.pierD);
      out.push([x - ARCADE.pier / 2, Math.min(za, zb), x + ARCADE.pier / 2, Math.max(za, zb)]);
    }
  }
  return out;
})();

/** Small fixed things in the court: lamps and benches. */
const smallRect = (x, z, hx, hz) => [x - hx, z - hz, x + hx, z + hz];
export const FURNITURE = [
  ...LAMPS.map(([x, z]) => smallRect(x, z, 0.2, 0.2)),
  ...BENCHES.map(([x, z, ry]) => (Math.abs(Math.sin(ry)) > 0.5 ? smallRect(x, z, 0.3, 0.98) : smallRect(x, z, 0.98, 0.3))),
];

/** The railing across the west end, as a rect. */
export const FENCE = [LOUVRE.x0 - 0.15, -LOUVRE.zArcade, LOUVRE.x0 + 0.15, LOUVRE.zArcade];
/** The passage gate. */
export const GATE = [PASSAGE.gateX - 0.06, -PASSAGE.z, PASSAGE.gateX + 0.06, PASSAGE.z];

const ARC_X0 = ARC.x - ARC.d / 2 - ARC.pedestal;
const ARC_X1 = ARC.x + ARC.d / 2 + ARC.pedestal;

const RECTS = (() => {
  const out = [];
  for (const m of MASSES) if (!m.y0) out.push([m.x0, m.z0, m.x1, m.z1]);
  out.push([PYRAMID.x - PYRAMID.half, PYRAMID.z - PYRAMID.half, PYRAMID.x + PYRAMID.half, PYRAMID.z + PYRAMID.half]);
  for (const [x, z] of PYRAMIDIONS) out.push(smallRect(x, z, PYRAMIDION.half, PYRAMIDION.half));
  for (const p of PIERS) out.push(p);
  for (const st of STAIRS) out.push(stairRect(st));
  for (const c of COVER) out.push(coverRect(c));
  for (const f of FURNITURE) out.push(f);
  for (const [z0, z1] of ARC_PIERS) out.push([ARC_X0, z0, ARC_X1, z1]);
  out.push(smallRect(LOUIS.x, LOUIS.z, LOUIS.l / 2, LOUIS.w / 2));
  out.push(FENCE, GATE);
  return out;
})();

/** Each basin as three edge half-planes `[ax, az, nx, nz]`, normals outward. */
const TRI_EDGES = BASINS.map((t) => {
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
  const cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
  const edges = [];
  for (let i = 0; i < 3; i++) {
    const a = t[i];
    const b = t[(i + 1) % 3];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    const l = Math.hypot(nx, nz);
    nx /= l;
    nz /= l;
    if ((cx - a[0]) * nx + (cz - a[1]) * nz > 0) {
      nx = -nx;
      nz = -nz;
    }
    edges.push([a[0], a[1], nx, nz]);
  }
  return edges;
});

/** True inside (or within `m` of) a basin. */
export function inBasin(x, z, m = 0.3) {
  for (const edges of TRI_EDGES) {
    let inside = true;
    for (const [ax, az, nx, nz] of edges) {
      if ((x - ax) * nx + (z - az) * nz > m) {
        inside = false;
        break;
      }
    }
    if (inside) return true;
  }
  return false;
}

/** True inside (or within `m` of) anything solid standing on the court floor. */
export function inSolidLouvre(x, z, m = 0.3) {
  for (let i = 0; i < RECTS.length; i++) {
    const b = RECTS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return inBasin(x, z, m);
}

function inCourt(x, z, m) {
  return x > LOUVRE.x0 + m && x < LOUVRE.x1 - m && Math.abs(z) < LOUVRE.zWall - m;
}

export function standableAtLouvre(x, z, margin = 0.55) {
  return inCourt(x, z, margin + 0.2) && !inSolidLouvre(x, z, margin);
}

export function isOpenLouvre(x, z, m = 0.3) {
  return inCourt(x, z, m) && !inSolidLouvre(x, z, m);
}

/** Paved and flat: every height difference on this map is built. */
export function groundYLouvre() {
  return 0.02;
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

/** A member between two points — lattice bars, hands, legs. */
function strut(A, key, x0, y0, z0, x1, y1, z1, t, masks, geo) {
  _dir.set(x1 - x0, y1 - y0, z1 - z0);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.divideScalar(len);
  _quat.setFromUnitVectors(_up, _dir);
  _pos.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  _scl.set(t, len, t);
  _mat4.compose(_pos, _quat, _scl);
  A.add(key, geo ?? BOX_THIN(A), _mat4, { masks: masks ?? [0.7, 0.3, 0.1] });
}

/**
 * An axis-aligned block from two corners, drawn and (unless `collide` is
 * false) given the same box as collision. Most of the palace is this.
 */
function block(A, key, x0, y0, z0, x1, y1, z1, opts = {}) {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const sz = z1 - z0;
  if (sx <= 0 || sy <= 0 || sz <= 0) return;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  A.add(key, (opts.soft ? BOX_SOFT : BOX)(A), LL(IDENT, cx, cy, cz, 0, sx, sy, sz), {
    masks: opts.masks ?? [0.45, 0.4, 0.25],
  });
  if (opts.collide !== false) A.box(opts.surface ?? A.surfaceOf(key), cx, cy, cz, sx, sy, sz);
}

/**
 * The stone over an arch: a `2·hw`-wide panel from the springline to `top`
 * with a semicircle cut from its underside, extruded `depth` along local Z.
 * Its curved underside IS the arch's intrados, so one cached piece gives the
 * arcade its rhythm without a single texture.
 */
function spandrelGeo(hw, spring, top, depth) {
  const s = new THREE.Shape();
  s.moveTo(-hw, spring);
  const n = 12;
  for (let i = 1; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    s.lineTo(Math.cos(a) * hw, spring + Math.sin(a) * hw);
  }
  s.lineTo(hw, top);
  s.lineTo(-hw, top);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Collision for the stone over an arch: from 60% of the way up the curve to
 * the top. The corners of the arch below that line stay open, which is a few
 * square decimetres of stone a round can pass through — the alternative is a
 * box across the opening with air under the crown, which is an invisible wall.
 */
function spandrelCollide(A, cx, cz, alongX, hw, spring, top, depth) {
  const y0 = spring + hw * 0.6;
  const cy = (y0 + top) / 2;
  if (alongX) A.box('concrete', cx, cy, cz, hw * 2, top - y0, depth);
  else A.box('concrete', cx, cy, cz, depth, top - y0, hw * 2);
}

/** A square-based frustum of unit footprint, for domes and pavilion roofs. */
function sqFrustum(A, taper) {
  return A.cache(`lv:sqf:${taper}`, () => {
    const g = tubeY(Math.SQRT1_2, 1, { radial: 4, taper });
    g.rotateY(Math.PI / 4);
    g.computeVertexNormals();
    return g;
  });
}

/** A unit mansard: trapezoid section across Z, run along X, 0..1 tall. */
function mansardGeo(A) {
  return A.cache('lv:mansard', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(0.5, 0);
    s.lineTo(0.3, 1);
    s.lineTo(-0.3, 1);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

/** A flight climbing `ry` from (x, y, z) to `top`. */
function flight(A, x, y, z, ry, top, w) {
  const steps = Math.max(1, Math.round((top - y) / STAIR.rise));
  _quat.setFromAxisAngle(_up, ry);
  _pos.set(x, y, z);
  _scl.set(1, 1, 1);
  const pm = new THREE.Matrix4().compose(_pos, _quat, _scl);
  stairRun(A, pm, 0, 0, 0, w, steps, (top - y) / steps, STAIR.run, { key: 'stone_pale', railing: true });
}

/**
 * A window on a palace face: dark reveal, stone surround, and a cap — a
 * pediment on the piano nobile, a plain cornice above it. `face` is
 * `{ axis: 'x'|'z', at, out }`: the face lies on the plane `axis = at` and
 * looks toward `out` (±1). `u` runs along the face.
 */
function windowOn(A, face, u, y, w, h, cap = 'plain') {
  const o = face.out;
  const put = (key, du, dy, dn, sw, sh, sn) => {
    if (face.axis === 'z') A.add(key, BOX(A), LL(IDENT, u + du, y + dy, face.at + o * dn, 0, sw, sh, sn), { masks: [0.5, 0.35, 0.3] });
    else A.add(key, BOX(A), LL(IDENT, face.at + o * dn, y + dy, u + du, 0, sn, sh, sw), { masks: [0.5, 0.35, 0.3] });
  };
  put('window_void', 0, 0, 0.02, w, h, 0.08);
  put('stone_pale', -w / 2 - 0.09, 0, 0.08, 0.18, h + 0.1, 0.16);
  put('stone_pale', w / 2 + 0.09, 0, 0.08, 0.18, h + 0.1, 0.16);
  put('stone_pale', 0, -h / 2 - 0.1, 0.12, w + 0.4, 0.14, 0.26);
  if (cap === 'pediment') {
    put('stone_pale', 0, h / 2 + 0.2, 0.15, w + 0.7, 0.22, 0.32);
    put('stone_pale', 0, h / 2 + 0.44, 0.13, w + 0.3, 0.26, 0.26);
  } else {
    put('stone_pale', 0, h / 2 + 0.12, 0.12, w + 0.4, 0.18, 0.26);
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function plane(A, key, x0, z0, x1, z1, y, cell, maskFn) {
  const w = x1 - x0;
  const d = z1 - z0;
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / cell)), Math.max(1, Math.round(d / cell)));
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  paintMasks(g, maskFn);
  A.add(key, g, null);
  g.dispose();
}

function buildGround(A) {
  const P = PYRAMID.half;
  const { x0, x1, zWall } = LOUVRE;
  const pave = (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.35, 1.7, z * 0.35, 3);
    out[0] = 0.15 + n * 0.25;
    out[1] = 0.08 + n * 0.22;
  };
  // The court, laid round the pyramid's footprint — inside it the floor
  // drops away into the hall below, and is built separately.
  const pieces = [
    [x0, -zWall, -P, zWall],
    [P, -zWall, x1, zWall],
    [-P, -zWall, P, -P],
    [-P, P, P, zWall],
  ];
  for (const [a, b, c, d] of pieces) {
    plane(A, 'flagstone', a, b, c, d, 0.02, 2.5, pave);
    A.box('concrete', (a + c) / 2, -0.2, (b + d) / 2, c - a, 0.4, d - b);
  }
  // under the arc and the railing, a strip of the court runs on to the garden
  // The Carrousel garden: gravel, the Tuileries' own ground.
  plane(A, 'gravel', -150, -70, x0, 70, 0.0, 6, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.2;
    out[1] = 0.2 + fbm3(x * 0.1, 3.1, z * 0.1, 2) * 0.3;
  });
  A.box('dirt', (-150 + x0) / 2, -0.2, 0, x0 + 150, 0.4, 140);
  // and under the far side of Sully and the wings, where nobody walks
  plane(A, 'flagstone', x1, -70, 90, 70, 0.0, 10, pave);
  plane(A, 'flagstone', -150, -70, 90, -zWall, -0.01, 12, pave);
  plane(A, 'flagstone', -150, zWall, 90, 70, -0.01, 12, pave);
}

/**
 * THE PYRAMID.
 *
 * Four glass faces on a steel lattice. The faces are one open square-based
 * cone, used both as the visual and — the same triangles — as the collision
 * hull, so what you see is exactly what stops you. The lattice is the real
 * one's rhombic grid: two families of bars, each parallel to one of a face's
 * hips, running from the base to the opposite hip.
 */
function buildPyramid(A) {
  const { x, z, half, h } = PYRAMID;
  const shell = tubeY(half * Math.SQRT2, h, { radial: 4, taper: 0, open: true });
  shell.rotateY(Math.PI / 4);
  shell.computeVertexNormals();
  A.add('glass', shell, LL(IDENT, x, 0.02, z), { masks: [0.1, 0.3, 0] });
  A.collideGeo('glass', shell, LL(IDENT, x, 0.02, z));
  shell.dispose();

  const apex = [x, h + 0.02, z];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * half, 0.02, z + b * half]);
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const n = 11;
  for (let f = 0; f < 4; f++) {
    const b0 = corners[f];
    const b1 = corners[(f + 1) % 4];
    // hips and base: the heavy members
    strut(A, 'steel_frame', ...b0, ...apex, 0.3);
    strut(A, 'steel_frame', ...b0, ...b1, 0.34);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const s0 = lerp(b0, b1, t);
      const e0 = [b1[0] * t + apex[0] * (1 - t), b1[1] * t + apex[1] * (1 - t), b1[2] * t + apex[2] * (1 - t)];
      strut(A, 'steel_frame', ...s0, ...e0, 0.09);
      const s1 = lerp(b1, b0, t);
      const e1 = [b0[0] * t + apex[0] * (1 - t), b0[1] * t + apex[1] * (1 - t), b0[2] * t + apex[2] * (1 - t)];
      strut(A, 'steel_frame', ...s1, ...e1, 0.09);
    }
  }
  // the granite kerb it stands in
  for (const [sx, sz, w, d] of [[0, -1, 2, 0], [0, 1, 2, 0], [-1, 0, 0, 2], [1, 0, 0, 2]]) {
    const cx = x + sx * (half + 0.2);
    const cz = z + sz * (half + 0.2);
    A.add('stone_grey', BOX(A), LL(IDENT, cx, 0.06, cz, 0, w ? half * 2 + 0.8 : 0.4, 0.1, d ? half * 2 + 0.8 : 0.4), {
      masks: [0.6, 0.4, 0.2],
    });
  }

  // ---- inside: the floor round the opening down into the Hall Napoléon --
  const hole = 8;
  for (const [a, b, c, d] of [
    [-half, -half, half, -hole], [-half, hole, half, half], [-half, -hole, -hole, hole], [hole, -hole, half, hole],
  ]) {
    A.add('flagstone', BOX(A), LL(IDENT, x + (a + c) / 2, -0.04, z + (b + d) / 2, 0, c - a, 0.12, d - b), {
      masks: [0.2, 0.2, 0.1],
    });
  }
  const deep = 7;
  for (const [cx, cz, w, d] of [[0, -hole, hole * 2, 0.3], [0, hole, hole * 2, 0.3], [-hole, 0, 0.3, hole * 2], [hole, 0, 0.3, hole * 2]]) {
    A.add('stone_pale', BOX(A), LL(IDENT, x + cx, -deep / 2, z + cz, 0, w, deep, d), { masks: [0.3, 0.3, 0.6] });
    // the balustrade round the opening
    A.add('stone_pale', BOX(A), LL(IDENT, x + cx, 0.5, z + cz, 0, w || 0.3, 1.0, d || 0.3), { masks: [0.4, 0.2, 0.2] });
  }
  A.add('stone_grey', BOX(A), LL(IDENT, x, -deep, z, 0, hole * 2, 0.2, hole * 2), { masks: [0.2, 0.3, 0.7] });
  // The spiral stair: steps fanned round a central drum, down into the hall.
  A.add('stone_pale', tubeY(0.9, deep + 0.6, { radial: 16 }), LL(IDENT, x, -deep, z), { masks: [0.4, 0.3, 0.2] });
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2.4;
    const y = -0.25 - (i / steps) * (deep - 0.4);
    A.add('stone_pale', BOX(A), LL(IDENT, x + Math.cos(a) * 2.2, y, z + Math.sin(a) * 2.2, -a, 2.6, 0.18, 0.7), {
      masks: [0.5, 0.2, 0.2],
    });
  }
}

/** The small pyramids: same construction, coarser lattice. */
function buildPyramidions(A) {
  const { half, h } = PYRAMIDION;
  for (const [x, z] of PYRAMIDIONS) {
    const shell = tubeY(half * Math.SQRT2, h, { radial: 4, taper: 0, open: true });
    shell.rotateY(Math.PI / 4);
    shell.computeVertexNormals();
    A.add('glass', shell, LL(IDENT, x, 0.32, z), { masks: [0.1, 0.3, 0] });
    A.collideGeo('glass', shell, LL(IDENT, x, 0.32, z));
    shell.dispose();
    const apex = [x, h + 0.32, z];
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * half, 0.32, z + b * half]);
    for (let f = 0; f < 4; f++) {
      strut(A, 'steel_frame', ...c[f], ...apex, 0.12);
      strut(A, 'steel_frame', ...c[f], ...c[(f + 1) % 4], 0.14);
    }
    // The granite plinth it sits on. Its collision is the plinth only: the
    // glass hull above is its own collision.
    block(A, 'stone_grey', x - half - 0.2, 0, z - half - 0.2, x + half + 0.2, 0.32, z + half + 0.2, { soft: true });
  }
}

/**
 * The basins: stone rims along every edge, a pale stone bed and water over
 * it. Collision is the rims and a low pad under the water — never a lid, so
 * the water stays water (you wade it, as at Wilmot's fountain) rather than
 * becoming an invisible floor at rim height.
 */
function buildBasins(A) {
  const { rim, rimH, waterY } = POOLS;
  for (let i = 0; i < BASINS.length; i++) {
    const t = BASINS[i];
    const edges = TRI_EDGES[i];
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
    const cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      const [, , nx, nz] = edges[e];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ry = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      // pulled half a rim inside the edge, so the triangle is the outside line
      const mx = (a[0] + b[0]) / 2 - nx * rim / 2;
      const mz = (a[1] + b[1]) / 2 - nz * rim / 2;
      A.add('stone_grey', BOX_SOFT(A), LL(IDENT, mx, rimH / 2, mz, ry, len + rim * 0.6, rimH, rim), {
        masks: [0.6, 0.45, 0.25],
      });
      A.box('concrete', mx, rimH / 2, mz, len, rimH, rim, ry);
    }
    // bed and water: the triangle pulled in by the rim
    const k = 0.86;
    const pts = t.map(([px, pz]) => [cx + (px - cx) * k, cz + (pz - cz) * k]);
    for (const [key, y] of [['stone_grey', 0.1], ['pool_water', waterY]]) {
      const g = new THREE.BufferGeometry();
      const pos = [];
      for (const [px, pz] of pts) pos.push(px, y, pz);
      // wind it to face up
      const cross = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]);
      if (cross > 0) pos.splice(3, 6, pos[6], pos[7], pos[8], pos[3], pos[4], pos[5]);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap(([px, pz]) => [px * 0.25, pz * 0.25]), 2));
      g.computeVertexNormals();
      A.addOnce(key, g, null, { masks: [0.1, 0.2, 0.1] });
    }
    // the wading pad
    const r = Math.min(...edges.map(([ax, az, nx, nz]) => -((cx - ax) * nx + (cz - az) * nz)));
    A.box('water', cx, 0.2, cz, r * 1.2, 0.2, r * 1.2);
    // the jets: a little bronze nozzle at the triangle's heart
    A.add('metal_dark', tubeY(0.06, 0.5, { radial: 6 }), LL(IDENT, cx, 0.1, cz), { masks: [0.6, 0.5, 0.2] });
  }
}

/** One wing's arcade, statue terrace and its two stairs. `s` is -1 north, +1 south. */
function buildArcade(A, s) {
  const { x0, x1, pitch, pier, pierD, spring, soffit } = ARCADE;
  const { zArcade, zWall, terraceY } = LOUVRE;
  const zf = s * zArcade;
  const zp = s * (zArcade + pierD / 2);
  const hw = (pitch - pier) / 2;
  const span = spandrelGeo(hw, spring, soffit, pierD);
  for (const [px0, pz0, px1, pz1] of PIERS) {
    if (Math.sign(pz0 + pz1) !== s) continue;
    block(A, 'stone_pale', px0, 0, pz0, px1, soffit, pz1);
    // the pier's base and impost mouldings
    block(A, 'stone_pale', px0 - 0.1, 0, pz0 - 0.08, px1 + 0.1, 0.5, pz1 + 0.08, { collide: false });
    block(A, 'stone_pale', px0 - 0.08, spring - 0.12, pz0 - 0.06, px1 + 0.08, spring + 0.12, pz1 + 0.06, { collide: false });
  }
  const n = Math.round((x1 - x0) / pitch);
  for (let i = 0; i < n; i++) {
    const cx = x0 + (i + 0.5) * pitch;
    A.add('stone_pale', span, LL(IDENT, cx, 0, zp), { masks: [0.45, 0.4, 0.3] });
    spandrelCollide(A, cx, zp, true, hw, spring, soffit, pierD);
    // keystone
    A.add('stone_pale', BOX(A), LL(IDENT, cx, spring + hw + 0.05, zf - s * 0.06, 0, 0.42, 0.6, 0.12), { masks: [0.6, 0.3, 0.2] });
    // a transverse rib across the gallery at each pier line, and the French
    // doors in the back wall of every bay
    windowOn(A, { axis: 'z', at: s * zWall, out: -s }, cx, 2.0, 1.7, 3.6, 'plain');
  }
  for (let i = 1; i < n; i++) {
    const x = x0 + i * pitch;
    block(A, 'stone_pale', x - 0.35, soffit - 0.45, s > 0 ? zArcade + pierD : -zWall, x + 0.35, soffit, s > 0 ? zWall : -zArcade - pierD, { collide: false });
  }

  // ---- the terrace: slab, paving, balustrade and the illustrious men ----
  const za = Math.min(zf, s * zWall);
  const zb = Math.max(zf, s * zWall);
  block(A, 'stone_pale', x0, soffit, za, x1, terraceY - 0.04, zb);
  block(A, 'flagstone', x0, terraceY - 0.04, za, x1, terraceY, zb, { collide: false });
  // a cornice under the balustrade, standing proud of the arcade face
  block(A, 'stone_pale', x0 - 0.3, soffit - 0.1, zf - s * 0.25 - 0.15, x1 + 0.3, soffit + 0.35, zf - s * 0.25 + 0.15, { collide: false });

  const bz = zf + s * 0.25;
  for (let i = 0; i < n; i++) {
    const cx = x0 + (i + 0.5) * pitch;
    A.putS('lv_balustrade', cx, terraceY, bz, 0, (pitch - 1.0) / LV_BALUSTRADE.l, 1, 1);
  }
  A.box('concrete', 0, terraceY + LV_BALUSTRADE.h / 2, bz, x1 - x0, LV_BALUSTRADE.h, 0.4);
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * pitch;
    A.put('lv_statue', x, terraceY, bz, s > 0 ? Math.PI : 0, 1);
    A.box('concrete', x, terraceY + 1.3, bz, 0.9, 2.6, 0.9);
  }
  // The terrace's two ends: balustrade from the arcade line back to the
  // stair, which lands on the rest of the edge.
  const stairNear = s * (STAIR.zOff - STAIR.w / 2);
  for (const ex of [x0, x1]) {
    const e = ex + (ex < 0 ? 0.25 : -0.25);
    const z0 = Math.min(zf, stairNear);
    const z1 = Math.max(zf, stairNear);
    const len = z1 - z0 - 0.15;
    A.putS('lv_balustrade', e, terraceY, (z0 + z1) / 2, H, len / LV_BALUSTRADE.l, 1, 1);
    A.box('concrete', e, terraceY + LV_BALUSTRADE.h / 2, (z0 + z1) / 2, 0.4, LV_BALUSTRADE.h, len);
  }

  // ---- the stairs ---------------------------------------------------
  for (const st of STAIRS) {
    const [fx, fz, dir] = st;
    if (Math.sign(fz) !== s) continue;
    flight(A, fx, 0.02, fz, dir > 0 ? H : -H, terraceY, STAIR.w);
    A.lampAnchors.push({ x: fx + dir * stairLen(), y: terraceY + 3, z: fz });
  }
}

/** A palace mass: walls, cornice and roof. */
function buildMass(A, m) {
  const y0 = m.y0 ?? 0;
  block(A, 'stone_pale', m.x0, y0, m.z0, m.x1, m.h, m.z1, { masks: [0.4, 0.45, 0.25] });
  // cornice
  block(A, 'stone_pale', m.x0 - 0.5, m.h - 0.6, m.z0 - 0.5, m.x1 + 0.5, m.h, m.z1 + 0.5, { collide: false, masks: [0.6, 0.4, 0.3] });
  const w = m.x1 - m.x0;
  const d = m.z1 - m.z0;
  const cx = (m.x0 + m.x1) / 2;
  const cz = (m.z0 + m.z1) / 2;
  if (m.roof === 'x' || m.roof === 'z') {
    const ry = m.roof === 'x' ? 0 : H;
    A.add('roof_slate', mansardGeo(A), LL(IDENT, cx, m.h, cz, ry, m.roof === 'x' ? w : d, 6, m.roof === 'x' ? d : w), {
      masks: [0.4, 0.5, 0.3],
    });
  } else if (m.roof === 'dome') {
    // the square "imperial" dome: three frusta stepping in, and a lantern
    A.add('roof_slate', sqFrustum(A, 0.78), LL(IDENT, cx, m.h, cz, 0, w, 4.5, d), { masks: [0.4, 0.5, 0.3] });
    A.add('roof_slate', sqFrustum(A, 0.55), LL(IDENT, cx, m.h + 4.5, cz, 0, w * 0.78, 3.6, d * 0.78), { masks: [0.4, 0.5, 0.3] });
    A.add('stone_pale', BOX(A), LL(IDENT, cx, m.h + 8.6, cz, 0, w * 0.2, 1.0, d * 0.2), { masks: [0.5, 0.4, 0.3] });
    A.add('metal_dark', tubeY(0.12, 2.0, { radial: 6 }), LL(IDENT, cx, m.h + 9.1, cz), { masks: [0.6, 0.5, 0.2] });
  }
}

/** Windows on the faces of the court. */
function dressFacades(A) {
  const { zWall, wingH, terraceY } = LOUVRE;
  // Richelieu and Denon above the terraces
  for (const s of [-1, 1]) {
    const face = { axis: 'z', at: s * zWall, out: -s };
    for (let x = -36; x <= 36; x += 4) {
      const pav = Math.abs(x) < 9;
      windowOn(A, face, x, terraceY + 2.6, 1.5, 3.0, 'pediment');
      windowOn(A, face, x, terraceY + 7.8, 1.4, 2.4, 'plain');
      if (pav) windowOn(A, face, x, wingH + 1.4, 1.2, 1.6, 'plain');
      // dormer
      if (!pav) {
        const z = s * (zWall + 0.9);
        A.add('stone_pale', BOX(A), LL(IDENT, x, wingH + 1.5, z, 0, 1.6, 2.2, 1.2), { masks: [0.5, 0.4, 0.3] });
        A.add('window_void', BOX(A), LL(IDENT, x, wingH + 1.4, z - s * 0.62, 0, 1.0, 1.5, 0.05), { masks: [0.2, 0.2, 0.2] });
        A.add('roof_slate', BOX(A), LL(IDENT, x, wingH + 2.7, z, 0, 1.9, 0.3, 1.5), { masks: [0.4, 0.4, 0.3] });
      }
    }
    // pilasters and the string course
    for (let x = -38; x <= 38; x += 4) {
      const h = Math.abs(x) < 9 ? 22 : wingH;
      block(A, 'stone_pale', x - 0.35, terraceY, s * zWall - 0.12, x + 0.35, h - 0.6, s * zWall + 0.12, { collide: false });
    }
    block(A, 'stone_pale', -40, terraceY + 5.2, s * zWall - 0.2, 40, terraceY + 5.5, s * zWall + 0.2, { collide: false });
  }
  // the corner pavilions' two court faces
  for (const [x0, x1, sz] of [[-50, -40, -1], [40, 46, -1], [-50, -40, 1], [40, 46, 1]]) {
    const zf = sz * LOUVRE.zArcade;
    const face = { axis: 'z', at: zf, out: -sz };
    for (let x = x0 + 2.5; x < x1 - 1; x += 5) {
      windowOn(A, face, x, 2.6, 1.8, 3.4, 'plain');
      windowOn(A, face, x, 9.0, 1.5, 3.0, 'pediment');
      windowOn(A, face, x, 14.4, 1.4, 2.4, 'plain');
      windowOn(A, face, x, 19.2, 1.2, 1.7, 'plain');
    }
    const ex = x0 < 0 ? x1 : x0;
    const efc = { axis: 'x', at: ex, out: x0 < 0 ? 1 : -1 };
    windowOn(A, efc, sz * 37, 9.0, 1.5, 3.0, 'pediment');
    windowOn(A, efc, sz * 37, 14.4, 1.4, 2.4, 'plain');
    // rusticated quoins on the projecting corner
    for (let y = 0.6; y < 21; y += 1.2) {
      const qx = x0 < 0 ? x1 : x0;
      A.add('stone_pale', BOX(A), LL(IDENT, qx, y, zf, 0, 0.9, 0.55, 0.9), { masks: [0.6, 0.4, 0.3] });
    }
  }
  // Sully, north and south of the clock pavilion
  const sf = { axis: 'x', at: LOUVRE.x1, out: -1 };
  for (let z = -32; z <= 32; z += 4) {
    if (Math.abs(z) < 12) continue;
    windowOn(A, sf, z, 2.4, 1.8, 3.4, 'plain');
    windowOn(A, sf, z, 8.8, 1.5, 3.0, 'pediment');
    windowOn(A, sf, z, 14.2, 1.4, 2.4, 'plain');
  }
  // and the pavilion itself, framing the passage
  for (const z of [-8, -5, 5, 8]) {
    windowOn(A, sf, z, 9.4, 1.3, 3.2, 'pediment');
    windowOn(A, sf, z, 14.8, 1.2, 2.4, 'plain');
  }
}

/**
 * The Pavillon de l'Horloge: the passage arch, its gate, the clock and the
 * pediment, and the tall square dome over the lot.
 */
function buildHorloge(A) {
  const x = LOUVRE.x1;
  const { z: hz, spring, top, gateX } = PASSAGE;
  // the arch over the passage mouth
  const span = spandrelGeo(hz, spring, top, 0.9);
  A.add('stone_pale', span, LL(IDENT, x + 0.45, 0, 0, H), { masks: [0.45, 0.4, 0.3] });
  spandrelCollide(A, x + 0.45, 0, false, hz, spring, top, 0.9);
  // the passage beyond the gate is dark: the Cour Carrée is not on this map
  A.add('window_void', BOX(A), LL(IDENT, 51.9, top / 2, 0, 0, 0.1, top, hz * 2), { masks: [0.1, 0.1, 0.5] });
  // the gate: bars on a frame, and the slab that is its collision
  for (let z = -hz + 0.1; z < hz; z += 0.16) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, gateX, 3.0, z, 0, 0.05, 6.0, 0.05), { masks: [0.7, 0.4, 0.1] });
  }
  for (const y of [0.15, 3.0, 5.9]) A.add('metal_dark', BOX_THIN(A), LL(IDENT, gateX, y, 0, 0, 0.08, 0.12, hz * 2), { masks: [0.7, 0.4, 0.1] });
  A.box('metal', gateX, 3.0, 0, 0.08, 6.0, hz * 2);
  // pilasters either side of the passage, carrying the pediment
  for (const z of [-3.6, 3.6, -10.6, 10.6]) block(A, 'stone_pale', x - 0.3, 0, z - 0.45, x + 0.05, 23.4, z + 0.45, { collide: Math.abs(z) < 5 });
  // the triangular pediment over the clock
  const pd = new THREE.Shape();
  pd.moveTo(-10, 0);
  pd.lineTo(10, 0);
  pd.lineTo(0, 3.6);
  pd.closePath();
  const pg = new THREE.ExtrudeGeometry(pd, { depth: 1.2, bevelEnabled: false });
  pg.translate(0, 0, -0.6);
  A.addOnce('stone_pale', pg, LL(IDENT, x + 0.2, 24, 0, H), { masks: [0.5, 0.4, 0.3] });
  // the clock
  A.add('frame_white', tubeY(1.6, 0.14, { radial: 24 }), LL(IDENT, x - 0.1, 20.3, 0, 0, 1, 1, 1, 0, H), { masks: [0.2, 0.3, 0.1] });
  A.add('paint_yellow', tubeY(1.8, 0.1, { radial: 24 }), LL(IDENT, x - 0.04, 20.3, 0, 0, 1, 1, 1, 0, H), { masks: [0.4, 0.3, 0.1] });
  strut(A, 'metal_dark', x - 0.2, 20.3, 0, x - 0.2, 21.4, 0.2, 0.08);
  strut(A, 'metal_dark', x - 0.22, 20.3, 0, x - 0.22, 19.75, -0.65, 0.1);
  // the dome, taller and steeper than the corner pavilions'
  const dz = 22;
  const dw = 12;
  const cx = (LOUVRE.x1 + 58) / 2;
  A.add('roof_slate', sqFrustum(A, 0.8), LL(IDENT, cx, 24, 0, 0, dw, 6, dz), { masks: [0.4, 0.5, 0.3] });
  A.add('roof_slate', sqFrustum(A, 0.5), LL(IDENT, cx, 30, 0, 0, dw * 0.8, 5, dz * 0.8), { masks: [0.4, 0.5, 0.3] });
  A.add('stone_pale', BOX(A), LL(IDENT, cx, 35.6, 0, 0, 2.6, 1.4, 3.4), { masks: [0.5, 0.4, 0.3] });
  A.add('metal_dark', tubeY(0.14, 3.0, { radial: 6 }), LL(IDENT, cx, 36.3, 0), { masks: [0.6, 0.5, 0.2] });
}

/**
 * The Arc du Carrousel: three arches through it east-west, pink marble
 * columns on pedestals, a soldier on every column, and the quadriga on top.
 */
function buildArc(A) {
  const { x, z, d, w, body, attic, arches, pedestal } = ARC;
  const xw = x - d / 2;
  const xe = x + d / 2;
  for (const [z0, z1] of ARC_PIERS) block(A, 'stone_pale', xw, 0, z0, xe, body, z1, { masks: [0.4, 0.45, 0.3] });
  for (const [zc, hw, spring] of arches) {
    const g = spandrelGeo(hw, spring, body, d);
    A.addOnce('stone_pale', g, LL(IDENT, x, 0, z + zc, H), { masks: [0.4, 0.45, 0.3] });
    spandrelCollide(A, x, z + zc, false, hw, spring, body, d);
  }
  // entablature, attic and cornice
  block(A, 'stone_pale', xw - 0.4, body, z - w / 2 - 0.3, xe + 0.4, body + 1.0, z + w / 2 + 0.3);
  block(A, 'stone_pale', xw - 0.1, body + 1.0, z - w / 2, xe + 0.1, attic, z + w / 2);
  block(A, 'stone_pale', xw - 0.3, attic, z - w / 2 - 0.2, xe + 0.3, attic + 0.35, z + w / 2 + 0.2, { collide: false });
  // a band of relief panels on the attic: darker inset slabs
  for (const zc of [-6.2, 0, 6.2]) {
    for (const fx of [xw - 0.13, xe + 0.13]) {
      A.add('stone_grey', BOX(A), LL(IDENT, fx, body + 2.3, z + zc, 0, 0.08, 1.5, 4.2), { masks: [0.4, 0.4, 0.4] });
    }
  }
  // columns: one before each pier on both faces
  for (const [z0, z1] of ARC_PIERS) {
    const zc = (z0 + z1) / 2;
    for (const [fx, sgn] of [[xw, -1], [xe, 1]]) {
      const px = fx + sgn * pedestal / 2;
      block(A, 'stone_pale', px - pedestal / 2, 0, zc - 0.55, px + pedestal / 2, 2.0, zc + 0.55, { masks: [0.5, 0.45, 0.3] });
      A.add('plaster_pink', tubeY(0.38, 6.9, { radial: 14 }), LL(IDENT, px, 2.0, zc), { masks: [0.4, 0.3, 0.2] });
      A.box('concrete', px, 5.45, zc, 0.6, 6.9, 0.6);
      block(A, 'stone_pale', px - 0.5, 8.9, zc - 0.5, px + 0.5, 9.5, zc + 0.5, { collide: false });
      block(A, 'stone_pale', px - 0.55, 9.5, zc - 0.6, px + 0.55, body + 1.0, zc + 0.6, { collide: false });
      A.put('lv_statue', px, body + 1.0, zc, sgn > 0 ? -H : H, 0.95);
    }
  }
  // The quadriga: four horses abreast drawing a chariot, in bronze.
  const qy = attic + 0.35;
  block(A, 'stone_pale', x - 2.2, qy, z - 3.2, x + 2.2, qy + 0.9, z + 3.2, { collide: false });
  const hy = qy + 0.9;
  for (let i = 0; i < 4; i++) {
    const hzc = z - 1.8 + i * 1.2;
    const hx = x + 0.6;
    strut(A, 'metal_dark', hx - 1.0, hy + 1.35, hzc, hx + 0.8, hy + 1.5, hzc, 0.62, [0.6, 0.4, 0.3], BOX_SOFT(A));
    strut(A, 'metal_dark', hx + 0.7, hy + 1.6, hzc, hx + 1.3, hy + 2.5, hzc, 0.34, [0.6, 0.4, 0.3], BOX_SOFT(A));
    strut(A, 'metal_dark', hx + 1.3, hy + 2.5, hzc, hx + 1.85, hy + 2.2, hzc, 0.28, [0.6, 0.4, 0.3], BOX_SOFT(A));
    for (const [lx, lz] of [[-0.8, -0.2], [-0.8, 0.2], [0.6, -0.2], [0.6, 0.2]]) {
      const raise = i % 2 === 0 && lx > 0 ? 0.5 : 0;
      strut(A, 'metal_dark', hx + lx, hy + 1.2, hzc + lz, hx + lx + raise, hy + raise * 0.8, hzc + lz, 0.13);
    }
  }
  block(A, 'metal_dark', x - 1.7, hy, z - 0.8, x - 0.5, hy + 1.4, z + 0.8, { collide: false });
  strut(A, 'metal_dark', x - 1.1, hy + 1.4, z, x - 1.1, hy + 3.4, z, 0.45, [0.6, 0.4, 0.3], BOX_SOFT(A));
  strut(A, 'metal_dark', x - 1.1, hy + 3.4, z, x - 1.0, hy + 3.8, z, 0.26);
  // figures either side: the two Victories leading the chariot
  for (const s of [-1, 1]) {
    strut(A, 'metal_dark', x + 2.6, hy, z + s * 2.9, x + 2.6, hy + 2.2, z + s * 2.9, 0.4, [0.6, 0.4, 0.3], BOX_SOFT(A));
  }
}

/** The railing across the west end, on its stone plinth, and the garden beyond. */
function buildCarrousel(A, rng) {
  const { x0, zArcade, fenceH } = LOUVRE;
  const z0 = -zArcade;
  const z1 = zArcade;
  block(A, 'stone_pale', x0 - 0.3, 0, z0, x0 + 0.3, 0.5, z1, { masks: [0.5, 0.45, 0.3] });
  for (let z = z0 + 0.07; z < z1; z += 0.14) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, x0, 0.5 + (fenceH - 0.5) / 2, z, 0, 0.045, fenceH - 0.5, 0.045), {
      masks: [0.7, 0.4, 0.1],
    });
  }
  for (const y of [0.75, fenceH - 0.25]) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, x0, y, 0, 0, 0.07, 0.09, z1 - z0), { masks: [0.7, 0.4, 0.1] });
  }
  // gilded finials every few metres, and stone piers on the long run
  for (let z = z0 + 4; z < z1 - 2; z += 8) {
    block(A, 'stone_pale', x0 - 0.4, 0, z - 0.4, x0 + 0.4, fenceH + 0.3, z + 0.4, { masks: [0.5, 0.45, 0.3] });
    A.add('paint_yellow', tubeY(0.2, 0.5, { radial: 8, taper: 0.1 }), LL(IDENT, x0, fenceH + 0.3, z), { masks: [0.5, 0.3, 0.1] });
  }
  A.box('metal', x0, fenceH / 2, 0, 0.1, fenceH, z1 - z0);

  // ---- beyond it: parterres and hedges, then the Tuileries' trees ------
  for (const [a, b, c, d] of [[-80, -30, -54, -4], [-80, 4, -54, 30]]) {
    plane(A, 'lawn', a, b, c, d, 0.03, 4, (x, y, z, nx, ny, nz, out) => {
      out[1] = 0.2 + fbm3(x * 0.2, 1.3, z * 0.2, 2) * 0.3;
    });
    for (const [hx0, hz0, hx1, hz1] of [[a, b, c, b + 0.9], [a, d - 0.9, c, d], [a, b, a + 0.9, d], [c - 0.9, b, c, d]]) {
      block(A, 'foliage', hx0, 0, hz0, hx1, 1.3, hz1, { collide: false, masks: [0.3, 0.3, 0.5] });
    }
  }
  for (let i = 0; i < 26; i++) {
    const row = i % 2;
    const tx = -86 - row * 9 + rng.range(-1, 1);
    const tz = -54 + Math.floor(i / 2) * 9 + rng.range(-1.5, 1.5);
    const th = rng.range(10, 14);
    A.add('bark', tubeY(0.35, th * 0.55, { radial: 7, taper: 0.7 }), LL(IDENT, tx, 0, tz), { masks: [0.3, 0.5, 0.3] });
    A.add('foliage', tubeY(rng.range(3.4, 4.4), th * 0.6, { radial: 9, taper: 0.45 }), LL(IDENT, tx, th * 0.4, tz, rng.float() * 6.28), {
      masks: [0.3, 0.3, 0.4],
    });
  }
  // and on the horizon, the Rue de Rivoli's roofline closing the view west
  for (let i = 0; i < 7; i++) {
    const bz = -60 + i * 20;
    const bh = rng.range(17, 22);
    block(A, 'stone_pale', -150, 0, bz - 9.5, -128, bh, bz + 9.5, { collide: false, masks: [0.3, 0.4, 0.3] });
    A.add('roof_slate', mansardGeo(A), LL(IDENT, -139, bh, bz, H, 19, 4, 22), { masks: [0.4, 0.5, 0.3] });
  }
}

/** Louis XIV on his rearing horse, on the axis between the Arc and the pyramid. */
function buildLouis(A) {
  const { x, z, l, w, h } = LOUIS;
  block(A, 'stone_pale', x - l / 2, 0, z - w / 2, x + l / 2, h, z + w / 2, { masks: [0.5, 0.45, 0.3] });
  block(A, 'stone_pale', x - l / 2 - 0.25, 0, z - w / 2 - 0.25, x + l / 2 + 0.25, 0.4, z + w / 2 + 0.25, { collide: false });
  block(A, 'stone_pale', x - l / 2 - 0.15, h - 0.3, z - w / 2 - 0.15, x + l / 2 + 0.15, h, z + w / 2 + 0.15, { collide: false });
  // horse, rearing to the west, and rider; lead grey
  const y = h;
  const k = 'metal_dark';
  const soft = BOX_SOFT(A);
  strut(A, k, x + 1.2, y + 1.3, z, x - 0.9, y + 2.4, z, 0.95, [0.5, 0.4, 0.3], soft); // barrel
  strut(A, k, x - 0.9, y + 2.4, z, x - 1.6, y + 3.6, z, 0.5, [0.5, 0.4, 0.3], soft); // neck
  strut(A, k, x - 1.6, y + 3.6, z, x - 2.3, y + 3.3, z, 0.38, [0.5, 0.4, 0.3], soft); // head
  for (const s of [-1, 1]) {
    strut(A, k, x + 1.2, y + 1.1, z + s * 0.28, x + 1.5, y + 0.0, z + s * 0.28, 0.2); // hind legs to the plinth
    strut(A, k, x - 0.8, y + 2.1, z + s * 0.28, x - 1.6, y + 1.8, z + s * 0.28, 0.17); // forelegs, raised
    strut(A, k, x - 1.6, y + 1.8, z + s * 0.28, x - 1.5, y + 1.2, z + s * 0.28, 0.15);
  }
  strut(A, k, x + 1.5, y + 1.6, z, x + 2.2, y + 0.2, z, 0.3, [0.5, 0.4, 0.3], soft); // tail, to the ground as a prop
  strut(A, k, x + 0.0, y + 2.4, z, x - 0.2, y + 3.6, z, 0.6, [0.5, 0.4, 0.3], soft); // rider
  strut(A, k, x - 0.2, y + 3.6, z, x - 0.25, y + 4.0, z, 0.3, [0.5, 0.4, 0.3], soft);
  strut(A, k, x - 0.2, y + 3.3, z - 0.3, x - 1.0, y + 3.9, z - 0.5, 0.12); // the outstretched arm
}

/** Cover, lamps, benches and the small life of a museum forecourt. */
function dressCourt(A, rng) {
  for (const c of COVER) {
    const [x, z, kind, ry] = c;
    const r = coverRect(c);
    if (kind === 'block') {
      A.put('lv_block', x, 0.02, z, ry, 1);
      A.box('concrete', x, LV_BLOCK.h / 2, z, r[2] - r[0], LV_BLOCK.h, r[3] - r[1]);
    } else if (kind === 'orange') {
      A.put('lv_planter', x, 0.02, z, 0, 1);
      A.put('lv_orange_trunk', x, 0.02, z, rng.float() * 6.28, 1);
      A.put('lv_orange_crown', x, 0.02, z, rng.float() * 6.28, rng.range(0.92, 1.08));
      A.box('wood', x, LV_PLANTER.h / 2, z, LV_PLANTER.s, LV_PLANTER.h, LV_PLANTER.s);
    } else {
      A.put('lv_wallace', x, 0.02, z, rng.float() * 6.28, 1);
      A.box('metal', x, 0.42, z, 0.8, 0.84, 0.8);
      A.box('metal', x, 1.6, z, 0.36, 1.6, 0.36);
    }
  }
  for (const [x, z, ry] of LAMPS) {
    A.put('lamp_post', x, 0.02, z, ry, 1.15);
    A.put('lamp_glass', x, 0.02, z, ry, 1.15);
    A.box('metal', x, 1.5, z, 0.3, 3.0, 0.3);
  }
  for (const [x, z, ry] of BENCHES) {
    A.put('lv_bench', x, 0.02, z, ry, 1);
    const along = Math.abs(Math.sin(ry)) < 0.5;
    A.box('wood', x, 0.25, z, along ? 1.9 : 0.5, 0.5, along ? 0.5 : 1.9);
  }
  // the visitor queue on the pyramid's west face: belt lines in a switchback
  for (const qx of [-20.6, -22.2]) {
    for (let qz = -9; qz < 9; qz += 1.6) A.put('lv_stanchion', qx, 0.02, qz, 0, 1);
  }
  // Café Marly, under the Richelieu arcade: tables in the middle bays
  for (const tx of [-6, -2, 2, 6]) {
    A.put('table_small', tx, 0.02, -38.2, rng.float() * 0.3, 1);
    A.put('chair', tx - 0.7, 0.02, -38.2, H + rng.range(-0.2, 0.2), 1);
    A.put('chair', tx + 0.7, 0.02, -38.2, -H + rng.range(-0.2, 0.2), 1);
    A.put('table_small', tx, 0.02, -36.4, rng.float() * 0.3, 1);
    A.put('chair', tx - 0.7, 0.02, -36.4, H + rng.range(-0.2, 0.2), 1);
  }
  // a little litter, never much: this is the most swept square in Paris
  for (let i = 0; i < 24; i++) {
    const x = rng.range(LOUVRE.x0 + 2, LOUVRE.x1 - 2);
    const z = rng.range(-LOUVRE.zWall + 1, LOUVRE.zWall - 1);
    if (!isOpenLouvre(x, z, 0.4)) continue;
    A.put('litter', x, 0.02, z, rng.float() * 6.28, rng.range(0.7, 1.1));
  }
}

export function buildLouvre(A, rng) {
  registerProps(A, rng);
  registerLouvreProps(A);

  buildGround(A);
  for (const m of MASSES) buildMass(A, m);
  dressFacades(A);
  buildHorloge(A);
  buildArcade(A, -1);
  buildArcade(A, 1);
  buildPyramid(A);
  buildPyramidions(A);
  buildBasins(A);
  buildArc(A);
  buildLouis(A);
  buildCarrousel(A, rng);
  dressCourt(A, rng);

  const P = PYRAMID.half;
  const buildings = [
    ...MASSES.filter((m) => !m.bg && !m.y0).map((m) => ({
      id: m.id,
      spec: { x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2, w: m.x1 - m.x0, d: m.z1 - m.z0 },
    })),
    { id: 'pyramid', spec: { x: PYRAMID.x, z: PYRAMID.z, w: P * 2, d: P * 2 } },
    { id: 'arc', spec: { x: ARC.x, z: ARC.z, w: ARC.d, d: ARC.w } },
  ];
  return { buildings };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const LOUVRE_MAP = {
  id: 'louvre',
  blurb: 'Round the glass pyramid in the Cour Napoléon. See-through in the middle, statue terraces on both flanks, the Arc du Carrousel at your back.',
  size: '95 × 80 m',
  /**
   * LEVEL -> WORLD. The real Louvre axis runs about 25° off east-west, which
   * is also what keeps the palace faces from being lit square-on.
   */
  transform: { yaw: -0.44, tx: 0, tz: 0 },
  bounds: [-51, -2, -42, 48, 40, 42],
  spawnPoints: LOUVRE_SPAWNS,
  standable: standableAtLouvre,
  groundY: groundYLouvre,
  isOpen: isOpenLouvre,
  build: buildLouvre,
};
