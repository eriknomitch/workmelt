import * as THREE from 'three';
import { BOX, BOX_THIN, IDENT, LL, stairRun, awning } from './kit.js';
import { registerProps, PB } from './props.js';
import { registerRustProps } from './rustprops.js';
import { registerLoopProps } from './loopprops.js';
import { registerCliftonProps, CAR, TROLLEY, GONDOLA } from './cliftonprops.js';
import { fbm3, paintMasks, tubeY } from './util.js';

/**
 * WORLD — CLIFTON HILL.
 *
 * The bottom block of Clifton Hill, Niagara Falls: the neon strip that climbs
 * west from Falls Avenue, ten minutes after sunset with the sky still burning
 * at the top of the hill. 98 x 66 m, fought along one sloped street, the
 * service lane behind its north side and the fun-zone lot behind its south.
 *
 *   THE STREET    Clifton Hill itself runs east-west and CLIMBS: 3.6 m over
 *                 80 m, a 4.5% grade, so the top of the hill looks down the
 *                 whole strip and the bottom looks up it into the sunset. Ten
 *                 metres of road and two four-metre pavements between building
 *                 lines 18 m apart, broken every ten or so metres by parked
 *                 cars, a tour trolley and the median planters.
 *   NORTH SIDE    a haunted castle, a hotel, the world-records museum with its
 *                 nine-metre blade sign, and the brew house, whose ROOF PATIO
 *                 (two stairs) watches the intersection and the lower street.
 *   SOUTH SIDE    the midway — the one building you can walk into, a hall of
 *                 arcade cabinets with doors front, back and side — and on its
 *                 ROOF THE SPEEDWAY, a go-kart track behind tyre walls with two
 *                 stairs up from the lot. Then the movie wax museum, a wax
 *                 house and the burger bar on the corner.
 *   THE WHEEL     a 36 m observation wheel standing in the fun-zone lot behind
 *                 the south side, lit spoke by spoke. It is the map's
 *                 landmark: visible from everywhere, a silhouette against the
 *                 sunset from the bottom of the hill, and it tells you which
 *                 way is south.
 *   FALLS AVENUE  the cross street at the bottom of the hill, the map's east
 *                 edge, closed off north and south.
 *
 * GAMEPLAY OVER REALISM, AND WHERE IT WON:
 *   - The real strip is ~250 m from Falls Avenue to Victoria Avenue. This is
 *     the bottom 80 m of it plus the intersection: the crop that holds the
 *     wheel, the midway and the densest neon. The hill continues past the
 *     closure as backdrop.
 *   - The real grade is steeper at the top. 4.5% is what keeps bots inside
 *     `ai/nav.js`'s step limit and keeps every sightline down the street
 *     inside rifle range of somebody standing at the top.
 *   - The wheel stands BEHIND the south side rather than beside the midway,
 *     and is about two thirds of the real one's 53 m — at full size it would
 *     be a third of the sky from anywhere on the map.
 *   - Three alleys on the north side and two passages on the south, so every
 *     block can be walked around: the street, the back lane and the lot are a
 *     set of loops rather than one long lane.
 *   - The speedway is real (it sits on a roof on the real strip, too) but its
 *     building is the midway's here, so the map's one enterable hall and its
 *     high ground share a footprint and the stairs come up from the lot.
 *   - The names on the signs are the strip's VOCABULARY, not its trademarks:
 *     a castle, a hotel, a records museum, a movie wax museum, a burger bar.
 *
 * LAYOUT NOTES
 *   LEVEL space, origin at the street's centreline 8 m up from Falls Avenue,
 *   north at -Z, the hill climbing toward -X. Every height on the map is
 *   relative to the intersection: `groundYClifton` is the single source of
 *   truth for the slope and everything is dropped onto it.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const CLIFTON = {
  /** The play perimeter. */
  x0: -50,
  x1: 48,
  z0: -28,
  z1: 38,
  /** Half-width of Clifton Hill's roadway, and of its building line. */
  road: 5,
  line: 9,
  /** Falls Avenue: west building line, roadway, east building line. */
  fallsWest: 30,
  fallsRoad0: 33,
  fallsRoad1: 45,
  /** Rise per metre west of the knee, and where the street starts to climb. */
  grade: 0.045,
  knee: 30,
  /** The blend either side of the knee, so the street does not fold. */
  kneeBlend: 3,
};

/**
 * Analytic floor height. Flat east of the knee — Falls Avenue and the
 * intersection — then a straight 4.5% climb west, joined by a parabola so the
 * slope is continuous (C1). Height depends on X only: the street has no
 * camber and the lots behind it climb with it.
 */
export function groundYClifton(x, z) {
  void z;
  const t = CLIFTON.knee - x;
  const b = CLIFTON.kneeBlend;
  let r;
  if (t <= -b) r = 0;
  else if (t < b) r = ((t + b) * (t + b)) / (4 * b);
  else r = t;
  return 0.02 + CLIFTON.grade * r;
}
const gy = (x) => groundYClifton(x, 0);

/**
 * The blocks. `w`/`d` are the X/Z footprint; `h` the mass height above the
 * ground at its UPHILL (west) edge, so a block's roof is level and its
 * downhill end stands a storey-fraction taller, as they do on the real hill.
 * `roof` instead pins an absolute deck height where the roof is a position.
 */
export const STRUCTURES = [
  // north side, uphill to downhill
  { id: 'dracula', x: -40, z: -14.5, w: 20, d: 11, h: 9.5 },
  { id: 'hotel', x: -16, z: -14.5, w: 20, d: 11, h: 17 },
  { id: 'records', x: 6, z: -14.5, w: 16, d: 11, h: 9 },
  { id: 'brew', x: 24, z: -14.5, w: 12, d: 11, roof: 4.3 },
  // south side
  { id: 'midway', x: -37, z: 16.5, w: 26, d: 15, roof: 8.4, hall: true },
  { id: 'movieland', x: -11, z: 15, w: 18, d: 12, h: 8 },
  { id: 'wax', x: 8.5, z: 14.5, w: 13, d: 11, h: 7 },
  { id: 'burger', x: 24.5, z: 14, w: 11, d: 10, h: 6 },
];
const S = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));
export const topOf = (s) => s.roof ?? gy(s.x - s.w / 2) + s.h;

/** The midway hall: wall thickness and its doors, as absolute X/Z spans. */
export const HALL = {
  t: 0.3,
  /** Street (north) wall doors, `[x0, x1]`. */
  north: [[-46, -43], [-39, -35], [-30, -27]],
  /** Lot (south) wall doors. */
  south: [[-47, -45], [-28.5, -26.5]],
  /** Passage (east) wall door, `[z0, z1]`. */
  east: [[10.6, 12.8]],
  doorH: 3.0,
};

/**
 * The stairs: `[x, z, ry, top]` — foot centre, the direction it climbs (`ry`
 * as in `flight`: 0 = +Z, PI = -Z, -PI/2 = -X), and the deck it reaches. Each
 * lands on a `LANDINGS` platform at the deck's edge, through a gap in its
 * parapet. Published because nothing may be parked on a stair's run-up.
 */
const RISE = 0.275;
const RUN = 0.3;
const SW = 1.4;
export const STAIRS = [
  // speedway: up the passage between the midway and the movie museum
  { id: 'speedway-passage', x: -22.7, z: 23.6, ry: Math.PI, top: S.midway.roof },
  // speedway: along the midway's back wall, from the lot
  { id: 'speedway-lot', x: -29.5, z: 24.75, ry: -Math.PI / 2, top: S.midway.roof },
  // brew patio: up the alley from the street
  { id: 'brew-alley', x: 17.15, z: -9.6, ry: Math.PI, top: S.brew.roof },
  // brew patio: from Falls Avenue
  { id: 'brew-falls', x: 30.8, z: -21.6, ry: 0, top: S.brew.roof },
];
/** Steps a stair takes, from the ground at its foot to its deck. */
export const stairSteps = (st) => Math.max(1, Math.round((st.top - gy(st.x)) / RISE));
/** The stair's horizontal run, foot to top step. */
export const stairLen = (st) => stairSteps(st) * RUN;
/** Its footprint, `[x0, z0, x1, z1]`. */
export function stairRect(st) {
  const L = stairLen(st);
  const dx = Math.sin(st.ry);
  const dz = Math.cos(st.ry);
  const ex = st.x + dx * L;
  const ez = st.z + dz * L;
  const hw = SW / 2;
  return Math.abs(dx) > 0.5
    ? [Math.min(st.x, ex), st.z - hw, Math.max(st.x, ex), st.z + hw]
    : [st.x - hw, Math.min(st.z, ez), st.x + hw, Math.max(st.z, ez)];
}
/** Top-of-stair platforms `[x0, z0, x1, z1, y]`, each touching its deck. */
export const LANDINGS = (() => {
  const out = [];
  for (const st of STAIRS) {
    const r = stairRect(st);
    const y = st.top;
    if (st.id === 'speedway-passage') out.push([-24, r[1] - 1.7, r[2], r[1], y]);
    else if (st.id === 'speedway-lot') out.push([r[0] - 1.7, 24, r[0], r[3], y]);
    else if (st.id === 'brew-alley') out.push([r[0], r[1] - 1.7, 18, r[1], y]);
    else out.push([30, r[3], r[2], r[3] + 1.7, y]);
  }
  return out;
})();

/** The observation wheel. */
export const WHEEL = {
  x: 8,
  z: 33,
  /** Hub height above the local ground, and rim radius. */
  hub: 21.2,
  r: 18,
  /** Half the rim spacing along X (the wheel is two rims tied together). */
  half: 1.15,
  gondolas: 30,
  /** Leg feet: `±legX` either side of the hub, `±legZ` fore and aft. */
  legX: 5.5,
  legZ: 9.5,
  /** The boarding deck under the bottom gondola. */
  deck: { x0: 4, x1: 12, z0: 29.5, z1: 36.5 },
};
export const wheelHubY = () => gy(WHEEL.x) + WHEEL.hub;

/**
 * Cover on the ground, `[x, z, kind, ry]`. Everything here is solid and has a
 * collision box; `KINDS` gives the footprint (along X at ry = 0).
 */
const H = Math.PI / 2;
const KINDS = {
  trolley: [TROLLEY.l, TROLLEY.w, TROLLEY.h],
  car: [CAR.l, CAR.w, CAR.h],
  median: [3.2, 1.1, 0.8],
  dumpster: [1.9, 1.2, 1.3],
  stall: [2.3, 1.1, 1.0],
  booth: [2.0, 2.0, 2.6],
  kiosk: [1.4, 1.4, 2.2],
  crates: [1.6, 1.2, 1.25],
  bench: [1.6, 0.6, 0.6],
  ac: [1.4, 1.0, 1.1],
  container: [6.06, 2.44, 2.6],
};
export const COVER = [
  // the closure at the top of the hill: a trolley parked across the road
  [-48.5, 0, 'trolley', H],
  // Clifton Hill: traffic stopped at the lights, a trolley loading
  [-6, -2.6, 'trolley', 0],
  [-38, 2.7, 'car', Math.PI, 'white'],
  [-27, -2.6, 'car', 0, 'red'],
  [-16, 2.7, 'car', Math.PI, 'dark'],
  [7, 2.6, 'car', Math.PI, 'blue'],
  [19, 2.6, 'car', Math.PI, 'taxi'],
  [15, -2.6, 'car', 0, 'taxi'],
  [-40.5, -2.6, 'car', 0, 'blue'],
  [-25, 2.7, 'car', Math.PI, 'red'],
  [-3, 2.7, 'car', Math.PI, 'white'],
  // the median
  [-44, 0, 'median', 0], [-33, 0, 'median', 0], [-21, 0, 'median', 0], [-10, 0, 'median', 0],
  [3, 0, 'median', 0], [13, 0.0, 'median', 0], [22, 0, 'median', 0],
  // Falls Avenue
  [36.4, -11, 'car', H, 'taxi'],
  [41.6, 17, 'car', -H, 'red'],
  [41.6, -4, 'car', -H, 'white'],
  // the pavements: a hot-dog cart and a ticket kiosk
  [12, 7.6, 'stall', 0],
  [-31, -7.6, 'kiosk', 0],
  // the back lane: bins, a storage box, crates and the hotel's plant
  [-44, -26.6, 'dumpster', 0], [-35, -26.6, 'dumpster', 0],
  [-21, -26.4, 'container', 0],
  [-9, -26.6, 'dumpster', 0], [3, -22.0, 'crates', 0],
  [10, -26.6, 'dumpster', 0], [23, -26.4, 'ac', 0], [26, -26.4, 'ac', 0],
  [-12, -21.0, 'ac', 0],
  // the lot: parked cars nosed in against the wall
  [-47, 35.6, 'car', H, 'blue'], [-43.5, 35.6, 'car', -H, 'dark'],
  [-36, 35.6, 'car', H, 'taxi'], [-32.5, 35.6, 'car', H, 'red'],
  [-24.5, 35.6, 'car', -H, 'white'],
  // the fun zone: game booths, the ticket booth, benches
  [-12, 27.6, 'stall', 0], [-12, 31.2, 'stall', Math.PI],
  [-3, 35.4, 'stall', Math.PI], [19, 35.4, 'stall', Math.PI],
  [24, 27.6, 'stall', 0],
  [-1.5, 25.5, 'booth', 0],
  [27.2, 33.5, 'kiosk', 0],
];
export function coverRect([x, z, kind, ry]) {
  const [l, w] = KINDS[kind];
  const along = Math.abs(Math.cos(ry)) > 0.5;
  const hx = (along ? l : w) / 2;
  const hz = (along ? w : l) / 2;
  return [x - hx, z - hz, x + hx, z + hz];
}

/** Tyre walls on the speedway roof, `[x0, z0, x1, z1]` — cover up there. */
export const TYRE_WALLS = [
  [-44, 14.2, -30, 14.9],
  [-44, 18.6, -30, 19.3],
  [-44.7, 14.2, -44, 19.3],
  [-30, 14.2, -29.3, 19.3],
  // two chicanes on the straights
  [-36.5, 10.6, -35.8, 12.0],
  [-38.5, 21.6, -37.8, 23.0],
];

/**
 * The perimeter, `[x0, z0, x1, z1, kind]`: what stands across each edge. The
 * play space is sealed by these — every opening has something solid within
 * its first metre — and each one is a drawn mass, never an invisible wall.
 */
export const PERIMETER = [
  // north: the backs of the next block, behind the service lane
  [-50, -30, 30, -28, 'backs'],
  // Falls Avenue north, closed by a hoarding
  [30, -28.4, 48, -27.6, 'hoarding'],
  // east: the casino across Falls Avenue
  [48, -30, 50, 40, 'casino'],
  // Falls Avenue south
  [30, 37.6, 48, 38.4, 'hoarding'],
  // south: the fun-zone wall
  [-50, 38, 30, 38.6, 'wall'],
  // west: the service lane's end, the pavements either side of the trolley,
  // and the lot's end wall
  [-50.6, -28, -50, -20, 'wall'],
  [-50, -9, -49.4, -1.3, 'hoarding'],
  [-50, 1.3, -49.4, 9, 'hoarding'],
  [-50.6, 24, -50, 38.6, 'wall'],
];

/** Street lamps, `[x, z, ry]` — the arm reaches toward `ry`. */
const LAMPS = [
  [-42, -8.3, -H], [-22, -8.3, -H], [-1, -8.3, -H], [18.6, -8.3, -H],
  [-32, 8.3, H], [-12, 8.3, H], [9, 8.3, H], [28.6, 8.3, H],
  [31.6, -24, 0], [46.4, 6, Math.PI], [31.6, 26, 0],
];

/**
 * Spawns: `[x, z, yaw, zone]`. Yaw faces the target point given per zone so
 * everyone spawns looking into the play space, never at a wall.
 *
 * INDEX 0 is the boot spawn: the bottom of the hill at Falls Avenue, looking
 * straight up Clifton Hill into the sunset with the wheel on the left — the
 * reference photograph's framing.
 */
const look = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);
export const CLIFTON_SPAWNS = [
  [40, 1.5, look(40, 1.5, -50, 1.5), 'intersection'], // FROZEN — boot spawn
  [39, -5, look(39, -5, 0, 0), 'intersection'],
  [41, 9, look(41, 9, 0, 0), 'intersection'],

  [36, -24.5, look(36, -24.5, 30, 0), 'falls-north'],
  [42, -22, look(42, -22, 30, 0), 'falls-north'],
  [39, -17, look(39, -17, 20, 0), 'falls-north'],

  [36, 33, look(36, 33, 30, 0), 'falls-south'],
  [42, 30, look(42, 30, 30, 0), 'falls-south'],
  [39, 23, look(39, 23, 20, 0), 'falls-south'],

  [8, -24, look(8, -24, -10, -24), 'lane-east'],
  [0, -24.5, look(0, -24.5, 20, -24), 'lane-east'],
  [16, -24, look(16, -24, 0, -24), 'lane-east'],

  [-40, -24, look(-40, -24, -20, -24), 'lane-west'],
  [-30.5, -24.5, look(-30.5, -24.5, -10, -24), 'lane-west'],
  [-24, -23.5, look(-24, -23.5, -40, -24), 'lane-west'],

  [-45, -3.5, look(-45, -3.5, 0, 0), 'hilltop'],
  [-45, 4, look(-45, 4, 0, 0), 'hilltop'],
  [-41, 7, look(-41, 7, 0, 0), 'hilltop'],

  [-42, 16.5, look(-42, 16.5, -30, 16.5), 'midway'],
  [-33, 16.5, look(-33, 16.5, -45, 16.5), 'midway'],
  [-27.5, 15.5, look(-27.5, 15.5, -40, 16.5), 'midway'],

  [-44, 30.5, look(-44, 30.5, -20, 30), 'lot'],
  [-35, 31, look(-35, 31, -20, 30), 'lot'],
  [-27, 29.5, look(-27, 29.5, -45, 30), 'lot'],

  [-6, 30, look(-6, 30, 20, 30), 'wheel'],
  [16, 30.5, look(16, 30.5, -10, 30), 'wheel'],
  [21, 24, look(21, 24, 0, 30), 'wheel'],
];

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/** The midway hall's walls as thin rects — its inside is floor. */
function hallWalls() {
  const s = S.midway;
  const x0 = s.x - s.w / 2;
  const x1 = s.x + s.w / 2;
  const z0 = s.z - s.d / 2;
  const z1 = s.z + s.d / 2;
  const t = HALL.t;
  const out = [];
  const spans = (a, b, holes) => {
    const r = [];
    let c = a;
    for (const [h0, h1] of [...holes].sort((p, q) => p[0] - q[0])) {
      if (h0 > c) r.push([c, h0]);
      c = Math.max(c, h1);
    }
    if (c < b) r.push([c, b]);
    return r;
  };
  for (const [a, b] of spans(x0, x1, HALL.north)) out.push([a, z0, b, z0 + t]);
  for (const [a, b] of spans(x0, x1, HALL.south)) out.push([a, z1 - t, b, z1]);
  for (const [a, b] of spans(z0, z1, HALL.east)) out.push([x1 - t, a, x1, b]);
  out.push([x0, z0, x0 + t, z1]);
  return out;
}
export const HALL_WALLS = hallWalls();

/** Arcade cabinet rows inside the hall: `[x0, x1, z, facing]`. */
export const ARCADE_ROWS = [
  [-48.6, -41.8, 13.0, 1], [-38.0, -31.8, 13.0, 1],
  [-48.6, -44.2, 20.0, -1], [-40.5, -33.0, 20.0, -1],
];

/** Solid footprints `[x0, z0, x1, z1]`, built once from the tables. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) {
    if (s.hall) continue;
    out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  }
  out.push(...HALL_WALLS);
  for (const [x0, x1, z] of ARCADE_ROWS) out.push([x0, z - 0.4, x1, z + 0.4]);
  // the prize counter at the back of the hall
  out.push([-30.5, 21.4, -26.5, 22.4]);
  for (const st of STAIRS) out.push(stairRect(st));
  for (const c of COVER) out.push(coverRect(c));
  for (const p of PERIMETER) {
    out.push(p.slice(0, 4));
    // a Falls Avenue closure has its jersey line on the play side
    if (p[4] === 'hoarding' && p[2] - p[0] > p[3] - p[1]) {
      out.push(p[1] < 0 ? [p[0], p[3], p[2], p[3] + 1.5] : [p[0], p[1] - 1.5, p[2], p[1]]);
    }
  }
  // the wheel's four feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const fx = WHEEL.x + sx * WHEEL.legX;
    const fz = WHEEL.z + sz * WHEEL.legZ;
    out.push([fx - 0.6, fz - 0.6, fx + 0.6, fz + 0.6]);
  }
  return out;
})();
export const cliftonBlockers = () => BLOCKERS.map((b) => b.slice());

/** True inside (or within `m` of) anything solid standing on the ground. */
export function inSolidClifton(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

const inside = (x, z, m) =>
  x > CLIFTON.x0 + m && x < CLIFTON.x1 - m && z > CLIFTON.z0 + m && z < CLIFTON.z1 - m;

/** The wheel's boarding deck is cover you stand ON, not floor: keep spawns off it. */
const onDeck = (x, z, m) => {
  const d = WHEEL.deck;
  return x > d.x0 - m && x < d.x1 + m && z > d.z0 - m - 1.6 && z < d.z1 + m;
};

export function standableAtClifton(x, z, margin = 0.55) {
  if (!inside(x, z, 0.8 + margin)) return false;
  if (onDeck(x, z, margin)) return false;
  return !inSolidClifton(x, z, margin);
}

export function isOpenClifton(x, z, m = 0.3) {
  if (!inside(x, z, 0.6)) return false;
  return !inSolidClifton(x, z, m);
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

/** A member between two points, oriented by quaternion (wheel, legs). */
function strut(A, key, x0, y0, z0, x1, y1, z1, t, masks = [0.6, 0.3, 0.2]) {
  _dir.set(x1 - x0, y1 - y0, z1 - z0);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.divideScalar(len);
  _quat.setFromUnitVectors(_up, _dir);
  _pos.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  _scl.set(t, len, t);
  _mat4.compose(_pos, _quat, _scl);
  A.add(key, BOX_THIN(A), _mat4, { masks });
}

/** A fresh panel matrix: origin (x, 0, z), turned `ry`. Never the LL scratch. */
function panel(x, y, z, ry) {
  _quat.setFromAxisAngle(_up, ry);
  _pos.set(x, y, z);
  _scl.set(1, 1, 1);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

/** A solid box with a matching collision proxy. */
function solid(A, key, cx, cy, cz, sx, sy, sz, ry = 0, masks = [0.5, 0.45, 0.3]) {
  A.add(key, BOX(A), LL(IDENT, cx, cy, cz, ry, sx, sy, sz), { masks });
  A.box(A.surfaceOf(key), cx, cy, cz, sx, sy, sz, ry);
}

/** A drawn box, no collision. */
function deco(A, key, cx, cy, cz, sx, sy, sz, ry = 0, masks = [0.5, 0.4, 0.2]) {
  A.add(key, BOX_THIN(A), LL(IDENT, cx, cy, cz, ry, sx, sy, sz), { masks });
}

/**
 * A building mass from below the ground at its downhill edge to `top`: the
 * slope disappears into it, and its roof stays level.
 */
function mass(A, key, x0, z0, x1, z1, top) {
  const base = gy(x1) - 0.5;
  solid(A, key, (x0 + x1) / 2, (base + top) / 2, (z0 + z1) / 2, x1 - x0, top - base, z1 - z0);
}

/**
 * A wall along X at `z`, from `yb` to `yt`, with door holes `[x0, x1]` cut to
 * `doorTop(x)` — so a doorway on the slope is always door-height above the
 * ground at its own sill.
 */
function wallX(A, key, x0, x1, z, yb, yt, t, holes, doorTop) {
  const surface = A.surfaceOf(key);
  const seg = (a, b, y0, y1) => {
    if (b - a < 0.02 || y1 - y0 < 0.02) return;
    A.add(key, BOX(A), LL(IDENT, (a + b) / 2, (y0 + y1) / 2, z, 0, b - a, y1 - y0, t), { masks: [0.5, 0.45, 0.25] });
    A.box(surface, (a + b) / 2, (y0 + y1) / 2, z, b - a, y1 - y0, t);
  };
  let c = x0;
  for (const [h0, h1] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (h0 > c) seg(c, h0, yb, yt);
    seg(h0, h1, doorTop((h0 + h1) / 2), yt);
    c = Math.max(c, h1);
  }
  if (c < x1) seg(c, x1, yb, yt);
}

/** The same along Z at `x`. */
function wallZ(A, key, z0, z1, x, yb, yt, t, holes, doorTop) {
  const surface = A.surfaceOf(key);
  const seg = (a, b, y0, y1) => {
    if (b - a < 0.02 || y1 - y0 < 0.02) return;
    A.add(key, BOX(A), LL(IDENT, x, (y0 + y1) / 2, (a + b) / 2, 0, t, y1 - y0, b - a), { masks: [0.5, 0.45, 0.25] });
    A.box(surface, x, (y0 + y1) / 2, (a + b) / 2, t, y1 - y0, b - a);
  };
  let c = z0;
  for (const [h0, h1] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (h0 > c) seg(c, h0, yb, yt);
    seg(h0, h1, doorTop, yt);
    c = Math.max(c, h1);
  }
  if (c < z1) seg(c, z1, yb, yt);
}

/** A flat deck with its collision and a few beams underneath. */
function deck(A, key, x0, z0, x1, z1, y, t = 0.25) {
  solid(A, key, (x0 + x1) / 2, y - t / 2, (z0 + z1) / 2, x1 - x0, t, z1 - z0, 0, [0.5, 0.5, 0.3]);
}

/** One straight run of rail, with ONE collision slab (see `rust.railRun`). */
function rail(A, x0, z0, x1, z1, y, h = 1.05, key = 'metal_dark') {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.15) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  for (const yy of [y + h, y + h * 0.5]) deco(A, key, mx, yy, mz, len, 0.05, 0.05, ry);
  const n = Math.max(2, Math.round(len / 1.4));
  for (let i = 0; i <= n; i++) {
    deco(A, key, x0 + ((x1 - x0) * i) / n, y + h / 2, z0 + ((z1 - z0) * i) / n, 0.05, h, 0.05);
  }
  A.box('metal', mx, y + h * 0.55, mz, len, h * 1.1, 0.1, ry);
}

/* ─────────────────────────────── neon lettering ── */

/**
 * A stroke font on a 2 x 4 grid: each glyph is a list of `[x0, y0, x1, y1]`
 * tube runs. Every sign on the strip is drawn from these — no texture, no
 * atlas, one box per stroke, merged by colour into a single draw call.
 */
const GLYPHS = {
  A: [[0, 0, 0, 3], [0, 3, 1, 4], [1, 4, 2, 3], [2, 3, 2, 0], [0, 2, 2, 2]],
  B: [[0, 0, 0, 4], [0, 4, 1.6, 4], [1.6, 4, 1.6, 2], [0, 2, 2, 2], [2, 2, 2, 0], [2, 0, 0, 0]],
  C: [[2, 4, 0, 4], [0, 4, 0, 0], [0, 0, 2, 0]],
  D: [[0, 0, 0, 4], [0, 4, 1.3, 4], [1.3, 4, 2, 3], [2, 3, 2, 1], [2, 1, 1.3, 0], [1.3, 0, 0, 0]],
  E: [[2, 4, 0, 4], [0, 4, 0, 0], [0, 0, 2, 0], [0, 2, 1.5, 2]],
  F: [[2, 4, 0, 4], [0, 4, 0, 0], [0, 2, 1.5, 2]],
  G: [[2, 4, 0, 4], [0, 4, 0, 0], [0, 0, 2, 0], [2, 0, 2, 2], [2, 2, 1, 2]],
  H: [[0, 0, 0, 4], [2, 0, 2, 4], [0, 2, 2, 2]],
  I: [[1, 0, 1, 4], [0.4, 4, 1.6, 4], [0.4, 0, 1.6, 0]],
  K: [[0, 0, 0, 4], [0, 2, 2, 4], [0, 2, 2, 0]],
  L: [[0, 4, 0, 0], [0, 0, 2, 0]],
  M: [[0, 0, 0, 4], [0, 4, 1, 2], [1, 2, 2, 4], [2, 4, 2, 0]],
  N: [[0, 0, 0, 4], [0, 4, 2, 0], [2, 0, 2, 4]],
  O: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 0], [2, 0, 0, 0]],
  P: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 2], [2, 2, 0, 2]],
  R: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 2], [2, 2, 0, 2], [0.8, 2, 2, 0]],
  S: [[2, 4, 0, 4], [0, 4, 0, 2], [0, 2, 2, 2], [2, 2, 2, 0], [2, 0, 0, 0]],
  T: [[0, 4, 2, 4], [1, 4, 1, 0]],
  U: [[0, 4, 0, 0], [0, 0, 2, 0], [2, 0, 2, 4]],
  V: [[0, 4, 1, 0], [1, 0, 2, 4]],
  W: [[0, 4, 0, 0], [0, 0, 1, 1.6], [1, 1.6, 2, 0], [2, 0, 2, 4]],
  X: [[0, 0, 2, 4], [0, 4, 2, 0]],
  Y: [[0, 4, 1, 2], [2, 4, 1, 2], [1, 2, 1, 0]],
  Z: [[0, 4, 2, 4], [2, 4, 0, 0], [0, 0, 2, 0]],
};
export const GLYPH_SET = new Set(Object.keys(GLYPHS));
/**
 * Every letter a build asked for that the font cannot draw. A missing glyph is
 * SILENT — the sign just reads "MOVIELND" — so the build records it and the
 * self-test asserts this stays empty.
 */
export const MISSING_GLYPHS = new Set();

/**
 * Lay `text` out in neon on panel `pm` (local X along the wall, Y up, Z out of
 * the wall). Horizontal text is centred on `u`; vertical text stacks down from
 * `y` (the top of its first letter). `cap` is the letter height.
 */
function neonText(A, key, pm, text, u, y, cap, opts = {}) {
  const sc = cap / 4;
  const t = opts.t ?? Math.max(0.08, cap * 0.1);
  const out = opts.out ?? 0.12;
  const vertical = !!opts.vertical;
  const adv = cap * (opts.adv ?? 0.78);
  const vstep = cap * 1.28;
  const chars = [...text.toUpperCase()];
  const width = chars.length * adv - (adv - 2 * sc);
  const keys = Array.isArray(key) ? key : [key];
  let k = 0;
  chars.forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) {
      if (ch !== ' ') MISSING_GLYPHS.add(ch);
      return;
    }
    const ox = vertical ? u - sc : u - width / 2 + i * adv;
    const oy = vertical ? y - cap - i * vstep : y;
    const kk = keys[k++ % keys.length];
    for (const [ax, ay, bx, by] of g) {
      const x0 = ox + ax * sc;
      const y0 = oy + ay * sc;
      const x1 = ox + bx * sc;
      const y1 = oy + by * sc;
      const len = Math.hypot(x1 - x0, y1 - y0) + t;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      A.add(kk, BOX_THIN(A), LL(pm, (x0 + x1) / 2, (y0 + y1) / 2, out, 0, len, t, t * 0.8, 0, ang), { masks: [0, 0, 0] });
    }
  });
  return width;
}

/** A row of marquee bulbs round a rectangle on panel `pm`. */
function bulbFrame(A, pm, u, y, w, h, out = 0.1, step = 0.36, key = 'ch_neon_white') {
  const bulb = (x, yy) => A.add(key, BOX_THIN(A), LL(pm, x, yy, out, 0, 0.12, 0.12, 0.12), { masks: [0, 0, 0] });
  const nx = Math.max(2, Math.round(w / step));
  const ny = Math.max(2, Math.round(h / step));
  for (let i = 0; i <= nx; i++) {
    const x = u - w / 2 + (i / nx) * w;
    bulb(x, y);
    bulb(x, y + h);
  }
  for (let j = 1; j < ny; j++) {
    const yy = y + (j / ny) * h;
    bulb(u - w / 2, yy);
    bulb(u + w / 2, yy);
  }
}

/** A neon tube outline round a rectangle on panel `pm`. */
function tubeFrame(A, key, pm, u, y, w, h, out = 0.1, t = 0.07) {
  const m = [0, 0, 0];
  A.add(key, BOX_THIN(A), LL(pm, u, y, out, 0, w + t, t, t), { masks: m });
  A.add(key, BOX_THIN(A), LL(pm, u, y + h, out, 0, w + t, t, t), { masks: m });
  A.add(key, BOX_THIN(A), LL(pm, u - w / 2, y + h / 2, out, 0, t, h, t), { masks: m });
  A.add(key, BOX_THIN(A), LL(pm, u + w / 2, y + h / 2, out, 0, t, h, t), { masks: m });
}

/** A five-point star of neon, centred at (u, y) on panel `pm`. */
function neonStar(A, key, pm, u, y, r, out = 0.12, t = 0.12) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push([u + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  for (let i = 0; i < 10; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % 10];
    const len = Math.hypot(x1 - x0, y1 - y0) + t;
    A.add(key, BOX_THIN(A), LL(pm, (x0 + x1) / 2, (y0 + y1) / 2, out, 0, len, t, t, 0, Math.atan2(y1 - y0, x1 - x0)), { masks: [0, 0, 0] });
  }
}

/**
 * A grid of windows on panel `pm` between `u0..u1`, `y0..y1`. `lit` is the
 * fraction of rooms with a light on — at this hour, most of the hotel.
 */
function windows(A, rng, pm, u0, u1, y0, y1, cols, rows, lit = 0.5, opts = {}) {
  const ww = opts.w ?? 1.1;
  const wh = opts.h ?? 1.4;
  for (let r = 0; r < rows; r++) {
    const y = y0 + ((r + 0.5) / rows) * (y1 - y0);
    for (let c = 0; c < cols; c++) {
      const u = u0 + ((c + 0.5) / cols) * (u1 - u0);
      const on = rng.float() < lit;
      A.add(on ? 'window_glow' : 'window_void', BOX_THIN(A), LL(pm, u, y, 0.03, 0, ww, wh, 0.06), { masks: [0.2, 0.4, 0.3] });
      A.add(opts.frame ?? 'concrete_dark', BOX_THIN(A), LL(pm, u, y - wh / 2 - 0.06, 0.08, 0, ww + 0.2, 0.1, 0.16), { masks: [0.6, 0.5, 0.3] });
    }
  }
}

/** A street-face panel for a block: origin on the face centre, Z out to the street. */
function streetFace(s) {
  return s.z < 0 ? panel(s.x, 0, s.z + s.d / 2, 0) : panel(s.x, 0, s.z - s.d / 2, Math.PI);
}

/** A lit shopfront band on a street face: glass, mullions and a fascia. */
function shopfront(A, pm, u, w, y, h = 2.9, key = 'window_glow', fascia = 'el_steel') {
  A.add(key, BOX_THIN(A), LL(pm, u, y + h / 2, 0.04, 0, w, h, 0.06), { masks: [0.2, 0.3, 0.2] });
  const n = Math.max(1, Math.round(w / 1.6));
  for (let i = 0; i <= n; i++) {
    A.add('metal_dark', BOX_THIN(A), LL(pm, u - w / 2 + (i / n) * w, y + h / 2, 0.1, 0, 0.09, h, 0.1), { masks: [0.5, 0.3, 0.2] });
  }
  A.add(fascia, BOX(A), LL(pm, u, y + h + 0.3, 0.18, 0, w + 0.3, 0.6, 0.3), { masks: [0.5, 0.4, 0.3] });
}

/** A parapet ring with an optional neon edge strip, on a level roof. */
function roofline(A, key, s, top, neon, h = 0.9, gaps = {}) {
  const x0 = s.x - s.w / 2;
  const x1 = s.x + s.w / 2;
  const z0 = s.z - s.d / 2;
  const z1 = s.z + s.d / 2;
  const t = 0.3;
  const yt = top + h;
  const dt = () => yt;
  wallX(A, key, x0, x1, z0 + t / 2, top, yt, t, gaps.n ?? [], dt);
  wallX(A, key, x0, x1, z1 - t / 2, top, yt, t, gaps.s ?? [], dt);
  wallZ(A, key, z0 + t, z1 - t, x0 + t / 2, top, yt, t, gaps.w ?? [], yt);
  wallZ(A, key, z0 + t, z1 - t, x1 - t / 2, top, yt, t, gaps.e ?? [], yt);
  // coping
  const cop = 'stone_pale';
  deco(A, cop, s.x, yt + 0.05, z0 + t / 2, s.w + 0.1, 0.1, t + 0.12);
  deco(A, cop, s.x, yt + 0.05, z1 - t / 2, s.w + 0.1, 0.1, t + 0.12);
  if (neon) {
    // the street edge gets a tube under the coping: the strip's skyline
    const zf = s.z < 0 ? z1 + 0.08 : z0 - 0.08;
    deco(A, neon, s.x, yt - 0.1, zf, s.w, 0.07, 0.07, 0, [0, 0, 0]);
  }
}

/** A speedway tyre: a short fat ring, shared across every stack. */
const tyreGeo = (A) => A.cache('ch:tyre', () => {
  const g = new THREE.TorusGeometry(0.25, 0.1, 6, 12);
  g.rotateX(Math.PI / 2);
  return g;
});

/** A flight of steps up from the ground at its foot, with its collision. */
function flight(A, st, key = 'steel_grate') {
  const steps = stairSteps(st);
  const y = gy(st.x);
  const rise = (st.top - y) / steps;
  stairRun(A, panel(st.x, y, st.z, st.ry), 0, 0, 0, SW, steps, rise, RUN, { key, railing: true, stringer: true });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGround(A, rng) {
  // One big plane for everything: the street, the lots, the hill running on
  // past the closure into the backdrop. Asphalt throughout; pavements and the
  // plaza are laid over it.
  const SZ = 260;
  const N = 65;
  const terrain = new THREE.PlaneGeometry(SZ, SZ, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) pa.setY(i, gy(pa.getX(i)) - 0.02);
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.25, 1.7, z * 0.25, 2);
    out[0] = 0.15 + n * 0.2;
    // the gutters collect the grime
    const kerb = Math.max(0, 1 - Math.abs(Math.abs(z) - CLIFTON.road) / 1.2);
    out[1] = 0.15 + n * 0.3 + kerb * 0.35;
  });
  A.add('asphalt', terrain, null);
  A.collideGeo('concrete', terrain);
  terrain.dispose();

  // Overlay slabs following the slope: subdivided along X only, which is the
  // only axis the ground bends on.
  const overlay = (key, x0, z0, x1, z1, lift = 0.025, masks = null) => {
    const segX = Math.max(1, Math.ceil((x1 - x0) / 3));
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segX, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, gy(p.getX(i)) + lift);
    g.computeVertexNormals();
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      const n = fbm3(x * 0.4, 6.1, z * 0.4, 2);
      out[0] = (masks?.[0] ?? 0.2) + n * 0.25;
      out[1] = (masks?.[1] ?? 0.2) + n * 0.3;
    });
    A.addOnce(key, g, null);
  };
  const { road, line, x0, x1, z0, z1 } = CLIFTON;
  // Clifton Hill's pavements, running on past the closure
  overlay('flagstone', -130, -line - 1, CLIFTON.fallsWest, -road);
  overlay('flagstone', -130, road, CLIFTON.fallsWest, line + 1);
  // Falls Avenue's pavements
  overlay('flagstone', CLIFTON.fallsWest, -60, CLIFTON.fallsRoad0, -road);
  overlay('flagstone', CLIFTON.fallsWest, road, CLIFTON.fallsRoad0, 70);
  overlay('flagstone', CLIFTON.fallsRoad1, -60, x1 + 1, 70);
  // the fun-zone plaza (the parking lot west of it stays asphalt)
  overlay('flagstone', -20, 19, CLIFTON.fallsWest, z1 + 0.5, 0.02, [0.25, 0.15]);
  // the midway's floor
  const m = S.midway;
  overlay('tile_floor', m.x - m.w / 2 + 0.3, m.z - m.d / 2 + 0.3, m.x + m.w / 2 - 0.3, m.z + m.d / 2 - 0.3, 0.03, [0.3, 0.3]);

  // Kerbs: a stone edge where pavement meets road. Visual only — 6 cm.
  for (const sz of [-1, 1]) {
    const g = new THREE.PlaneGeometry(CLIFTON.fallsWest + 130, 0.3, 54, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((CLIFTON.fallsWest - 130) / 2, 0, sz * road);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, gy(p.getX(i)) + 0.05);
    g.computeVertexNormals();
    A.addOnce('stone_pale', g, null);
  }

  // Road paint: a double yellow centreline and two zebra crossings.
  for (let x = -120; x < CLIFTON.fallsWest - 1; x += 3) {
    for (const dz of [-0.12, 0.12]) deco(A, 'paint_yellow', x, gy(x) + 0.03, dz, 2.9, 0.012, 0.1, 0, [0.2, 0.3, 0]);
  }
  const zebraX = (cx) => {
    for (let z = -road + 0.5; z < road; z += 1.0) deco(A, 'plaster_white', cx, gy(cx) + 0.03, z, 3.0, 0.012, 0.55, 0, [0.4, 0.5, 0]);
  };
  zebraX(27.5);
  zebraX(-26.5);
  const zebraZ = (cz) => {
    for (let x = CLIFTON.fallsRoad0 + 0.5; x < CLIFTON.fallsRoad1; x += 1.0) deco(A, 'plaster_white', x, 0.05, cz, 0.55, 0.012, 3.0, 0, [0.4, 0.5, 0]);
  };
  zebraZ(-7);
  zebraZ(7);
  // Falls Avenue's centreline
  for (let z = -60; z < 70; z += 3) {
    if (Math.abs(z) < 9) continue;
    for (const dx of [-0.12, 0.12]) deco(A, 'paint_yellow', 39 + dx, 0.05, z, 0.1, 0.012, 2.9, 0, [0.2, 0.3, 0]);
  }
  // parking bays in the lot
  for (let x = -49; x < -21; x += 3.5) deco(A, 'plaster_white', x - 0.0, gy(x) + 0.03, 34.5, 0.12, 0.012, 5.6, 0, [0.4, 0.5, 0]);
  void rng;
  void x0; void z0;
}

/* ─────────────────────────────── the north side ── */

function buildDracula(A, rng, s) {
  const top = topOf(s);
  mass(A, 'brick_chicago', s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, top);
  roofline(A, 'brick_chicago', s, top, 'ch_neon_red', 0.6);
  const pm = streetFace(s);
  const g0 = gy(s.x + s.w / 2);
  // black gables along the street front: the castle's skyline
  for (const u of [-6.5, 0, 6.5]) {
    const w = 5.2;
    for (const sgn of [-1, 1]) {
      A.add('roof_slate', BOX(A), LL(pm, u + (sgn * w) / 4, top + 1.2, -0.6, 0, w * 0.62, 0.35, 1.4, 0, -sgn * 0.75), { masks: [0.4, 0.5, 0.3] });
      A.add('ch_neon_red', BOX_THIN(A), LL(pm, u + (sgn * w) / 4, top + 1.42, 0.15, 0, w * 0.62, 0.06, 0.06, 0, -sgn * 0.75), { masks: [0, 0, 0] });
    }
    A.add('brick_chicago', BOX(A), LL(pm, u, top + 0.7, -0.6, 0, w * 0.86, 1.4, 1.2), { masks: [0.5, 0.5, 0.3] });
  }
  // two corner turrets with cone roofs
  for (const u of [-s.w / 2 + 1.4, s.w / 2 - 1.4]) {
    const x = s.x + u;
    const z = s.z + s.d / 2 - 1.2;
    const turret = tubeY(1.5, top + 3.2 - (g0 - 0.5), { radial: 10 });
    A.addOnce('brick_chicago', turret, LL(IDENT, x, g0 - 0.5, z));
    const cone = new THREE.ConeGeometry(2.0, 3.6, 10);
    A.addOnce('roof_slate', cone, LL(IDENT, x, top + 3.2 + 1.8, z));
    deco(A, 'ch_neon_red', x, top + 3.25, z + 1.5, 2.6, 0.07, 0.07);
  }
  // ground floor: a dark gothic doorway between lit windows
  const y0 = g0;
  shopfront(A, pm, -6, 5.5, gy(s.x - 6) + 0.1, 2.6, 'window_glow', 'roof_slate');
  shopfront(A, pm, 6.2, 5, gy(s.x + 6.2) + 0.1, 2.6, 'window_glow', 'roof_slate');
  A.add('window_void', BOX_THIN(A), LL(pm, 0.2, y0 + 1.7, 0.05, 0, 2.6, 3.4, 0.08), { masks: [0.2, 0.6, 0.5] });
  A.add('ch_neon_red', BOX_THIN(A), LL(pm, 0.2, y0 + 3.45, 0.14, 0, 2.8, 0.07, 0.07), { masks: [0, 0, 0] });
  windows(A, rng, pm, -9, 9, y0 + 4.2, top - 0.6, 8, 1, 0.25, { w: 0.9, h: 1.6, frame: 'roof_slate' });
  // the sign
  A.add('metal_dark', BOX(A), LL(pm, 0.2, top - 2.7, 0.2, 0, 8.4, 1.6, 0.2), { masks: [0.3, 0.6, 0.4] });
  neonText(A, 'ch_neon_red', pm, 'DRACULA', 0.2, top - 3.2, 1.1, { out: 0.36 });
}

function buildHotel(A, rng, s) {
  const top = topOf(s);
  mass(A, 'plaster_sand', s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, top);
  roofline(A, 'concrete', s, top, null, 0.8);
  const pm = streetFace(s);
  const g0 = gy(s.x + s.w / 2);
  // the steakhouse on the ground floor, then four floors of rooms
  shopfront(A, pm, 0, s.w - 1.2, gy(s.x - s.w / 2 + 0.6) + 0.1, 3.0, 'window_glow', 'sign_red');
  windows(A, rng, pm, -9.4, 9.4, gy(s.x - s.w / 2) + 4.6, top - 0.8, 9, 4, 0.55);
  // a band of balconies' slabs between floors
  for (let i = 0; i < 4; i++) {
    const y = gy(s.x - s.w / 2) + 4.6 + (i * (top - 0.8 - (gy(s.x - s.w / 2) + 4.6))) / 4;
    A.add('concrete', BOX(A), LL(pm, 0, y, 0.3, 0, s.w - 0.4, 0.16, 0.6), { masks: [0.5, 0.5, 0.3] });
  }
  // red box sign over the restaurant door
  A.add('ch_neon_red', BOX(A), LL(pm, -5.5, g0 + 4.05, 0.42, 0, 3.6, 0.9, 0.12), { masks: [0, 0, 0] });
  // the hotel's blue box sign, standing on the roof facing down the hill
  const sp = panel(s.x + 3, 0, s.z + s.d / 2 - 1.5, 0);
  A.add('metal_blue', BOX(A), LL(sp, 0, top + 2.4, 0, 0, 7.4, 2.6, 0.3), { masks: [0.4, 0.5, 0.3] });
  tubeFrame(A, 'ch_neon_cyan', sp, 0, top + 1.1, 7.4, 2.6, 0.18);
  neonText(A, 'ch_neon_white', sp, 'HOTEL', 0, top + 1.75, 1.3, { out: 0.2 });
  for (const u of [-3, 3]) deco(A, 'steel_frame', s.x + 3 + u, top + 0.55, s.z + s.d / 2 - 1.5, 0.2, 1.1, 0.2);
  // a vertical blade down the corner, "AT THE FALLS"-style
  const bp = panel(s.x + s.w / 2 - 0.6, 0, s.z + s.d / 2 + 0.6, H);
  A.add('metal_blue', BOX(A), LL(bp, 0, g0 + 9.5, 0, 0, 1.6, 7.8, 0.3), { masks: [0.4, 0.5, 0.3] });
  for (const side of [1, -1]) {
    const bpp = panel(s.x + s.w / 2 - 0.6, 0, s.z + s.d / 2 + 0.6, side > 0 ? H : -H);
    neonText(A, 'ch_neon_white', bpp, 'FALLS', 0, g0 + 13.0, 0.95, { out: 0.18, vertical: true });
  }
  // roof plant
  for (const [dx, dz] of [[-6, -2], [-3, -1], [6, -2.5]]) A.put('ac_unit', s.x + dx, top, s.z + dz, 0, 1.2);
}

function buildRecords(A, rng, s) {
  const top = topOf(s);
  mass(A, 'brick_red', s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, top);
  roofline(A, 'brick_red', s, top, 'ch_neon_amber', 0.7);
  const pm = streetFace(s);
  shopfront(A, pm, 1.5, s.w - 4.5, gy(s.x) + 0.1, 3.2, 'window_glow', 'metal_dark');
  windows(A, rng, pm, -6.5, 7.5, gy(s.x - s.w / 2) + 5.0, top - 0.8, 6, 1, 0.3, { w: 1.4, h: 1.8 });
  bulbFrame(A, pm, 1.5, gy(s.x) + 3.5, s.w - 4.5, 0.6, 0.35);
  /**
   * THE BLADE. Nine metres of red tube hung off the west corner of the
   * museum, standing above its roof — on the real strip it is the one sign
   * you can read from the top of the hill, and here it is the second
   * landmark: it marks the middle of the north side from everywhere on the
   * street.
   */
  const bx = s.x - s.w / 2 + 0.7;
  const bz = s.z + s.d / 2 + 0.8;
  const gb = gy(bx);
  const bh = 11.4;
  const by = gb + 3.4;
  solid(A, 'metal_dark', bx, by + bh / 2, bz - 0.2, 0.35, bh, 1.9, 0, [0.3, 0.6, 0.4]);
  for (const side of [1, -1]) {
    const bp = panel(bx + side * 0.2, 0, bz - 0.2, side * H);
    neonText(A, 'ch_neon_red', bp, 'RECORDS', 0, by + bh - 0.35, 1.05, { out: 0.06, vertical: true });
    tubeFrame(A, 'ch_neon_amber', bp, 0, by + 0.1, 1.75, bh - 0.2, 0.05, 0.06);
  }
  // brackets back to the wall
  for (const dy of [1, bh - 1]) deco(A, 'steel_frame', bx, by + dy, s.z + s.d / 2 + 0.2, 0.12, 0.12, 1.2);
}

function buildBrew(A, rng, s) {
  const top = topOf(s);
  const x0 = s.x - s.w / 2;
  const x1 = s.x + s.w / 2;
  const z0 = s.z - s.d / 2;
  const z1 = s.z + s.d / 2;
  mass(A, 'brick_chicago', x0, z0, x1, z1, top - 0.25);
  deck(A, 'floor_wood', x0, z0, x1, z1, top);
  const pm = streetFace(s);
  shopfront(A, pm, -0.5, s.w - 2.5, gy(s.x) + 0.1, 2.9, 'window_glow', 'wood_dark');
  awning(A, panel(s.x, 0, z1, Math.PI), 0.5, gy(s.x) + 3.3, s.w - 3, rng, { key: 'fabric_teal', depth: 1.4 });
  // the patio: a rail all round, with gaps where the two stairs land
  const L = LANDINGS;
  const la = L[STAIRS.findIndex((st) => st.id === 'brew-alley')];
  const lb = L[STAIRS.findIndex((st) => st.id === 'brew-falls')];
  rail(A, x0 + 0.1, z1 - 0.1, x1 - 0.1, z1 - 0.1, top);
  rail(A, x0 + 0.1, z0 + 0.1, x1 - 0.1, z0 + 0.1, top);
  rail(A, x0 + 0.1, z0 + 0.1, x0 + 0.1, la[1], top);
  rail(A, x0 + 0.1, la[3], x0 + 0.1, z1 - 0.1, top);
  rail(A, x1 - 0.1, z0 + 0.1, x1 - 0.1, lb[1], top);
  rail(A, x1 - 0.1, lb[3], x1 - 0.1, z1 - 0.1, top);
  // a parapet-height bar counter along the back: cover for the patio
  solid(A, 'wood_dark', s.x - 1, top + 0.55, z0 + 1.6, 6.5, 1.1, 0.7, 0, [0.5, 0.5, 0.3]);
  deco(A, 'ch_neon_amber', s.x - 1, top + 1.12, z0 + 1.95, 6.5, 0.06, 0.06);
  // tables and parasols
  for (const [dx, dz] of [[-3.5, 2.0], [0.5, 2.6], [3.6, 1.2], [-1.5, -1.2]]) {
    A.put('table', s.x + dx, top, s.z + dz, rng.float() * 3, 1);
    A.put('parasol', s.x + dx, top, s.z + dz, 0, 0.9);
  }
  // festoon lights strung across the patio
  for (let i = 0; i < 4; i++) {
    const z = z0 + 1.5 + i * 2.6;
    for (let x = x0 + 0.8; x < x1 - 0.5; x += 1) A.put('ch_festoon', x, top + 2.6 - 0.25 * Math.sin(((x - x0) / s.w) * Math.PI), z, 0, 1);
  }
  for (const [px, pz] of [[x0 + 0.3, z0 + 0.3], [x1 - 0.3, z0 + 0.3], [x0 + 0.3, z1 - 0.3], [x1 - 0.3, z1 - 0.3]]) {
    deco(A, 'wood_dark', px, top + 1.35, pz, 0.12, 2.7, 0.12);
  }
  // the sign on the street parapet: BREW in amber over the awning
  A.add('metal_dark', BOX(A), LL(pm, 0, top - 1.35, 0.15, 0, 5.2, 1.3, 0.15), { masks: [0.3, 0.6, 0.4] });
  neonText(A, 'ch_neon_amber', pm, 'BREW', 0, top - 1.8, 0.95, { out: 0.28 });
}

/* ─────────────────────────────── the south side ── */

function buildMidway(A, rng, s) {
  const top = s.roof;
  const x0 = s.x - s.w / 2;
  const x1 = s.x + s.w / 2;
  const z0 = s.z - s.d / 2;
  const z1 = s.z + s.d / 2;
  const t = HALL.t;
  const yb = gy(x1) - 0.5;
  const doorTop = (x) => gy(x) + HALL.doorH;
  // the shell — wall rects are exactly the occupancy test's HALL_WALLS
  wallX(A, 'plaster_cream', x0, x1, z0 + t / 2, yb, top, t, HALL.north, doorTop);
  wallX(A, 'plaster_cream', x0, x1, z1 - t / 2, yb, top, t, HALL.south, doorTop);
  wallZ(A, 'plaster_cream', z0, z1, x1 - t / 2, yb, top, t, HALL.east, gy(x1) + HALL.doorH);
  wallZ(A, 'plaster_cream', z0, z1, x0 + t / 2, yb, top, t, [], 0);
  // the roof: a deck, which is the speedway's track
  deck(A, 'roof_screed', x0, z0, x1, z1, top, 0.35);
  // ceiling strips: the hall is lit pink and blue under a black roof
  for (let i = 0; i < 4; i++) {
    const z = z0 + 2.2 + i * 3.6;
    deco(A, i % 2 ? 'ch_neon_cyan' : 'ch_neon_pink', s.x, top - 0.45, z, s.w - 2, 0.06, 0.08);
  }
  for (let i = 0; i < 4; i++) A.interiorLights.push({ x: x0 + 3 + i * 6.5, y: top - 0.8, z: s.z });

  // ---- the street front: the marquee ----
  const pm = streetFace(s);
  // the midway's arch over the middle door: bulbs and a star topper
  const gm = gy(-37);
  A.add('el_steel', BOX(A), LL(pm, 0, gm + 4.35, 0.35, 0, 14.5, 2.0, 0.4), { masks: [0.3, 0.6, 0.4] });
  bulbFrame(A, pm, 0, gm + 3.35, 14.5, 2.0, 0.6, 0.34);
  // MIDWAY in five colours, the way the real one is
  neonText(A, ['ch_neon_red', 'ch_neon_amber', 'ch_neon_green', 'ch_neon_cyan', 'ch_neon_pink', 'ch_neon_amber'], pm,
    'MIDWAY', 0, gm + 3.6, 1.45, { out: 0.62, t: 0.13 });
  neonText(A, 'ch_neon_red', pm, 'GREAT', -5.6, gm + 4.9, 0.55, { out: 0.62 });
  neonStar(A, 'ch_neon_amber', pm, 6.1, gm + 5.0, 0.75, 0.62);
  // lit glass between the doors
  for (const [a, b] of [[-43, -39], [-35, -30], [-27, -24.6]]) {
    const u = -((a + b) / 2 - s.x); // panel X runs to level -X on the south side
    A.add('window_glow', BOX_THIN(A), LL(pm, u, gy((a + b) / 2) + 1.5, 0.04, 0, b - a - 0.4, 2.4, 0.06), { masks: [0.2, 0.3, 0.2] });
  }
  // neon strips round each doorway
  for (const [a, b] of HALL.north) {
    const u = -((a + b) / 2 - s.x);
    tubeFrame(A, 'ch_neon_pink', pm, u, gy((a + b) / 2) - 0.05, b - a, HALL.doorH, 0.08, 0.06);
  }
  // SPEEDWAY along the roof parapet's street face
  const pp = panel(s.x, 0, z0, Math.PI);
  neonText(A, 'ch_neon_green', pp, 'SPEEDWAY', 4.5, top + 0.12, 0.55, { out: 0.2 });

  // ---- inside: rows of cabinets and a prize counter ----
  for (const [ax0, ax1, z, f] of ARCADE_ROWS) {
    const n = Math.floor((ax1 - ax0) / 0.82);
    for (let i = 0; i < n; i++) {
      const x = ax0 + 0.41 + i * 0.82;
      const ry = f > 0 ? H : -H; // screens face across the aisle
      A.put('ch_arcade', x, gy(x) + 0.03, z, -ry, 1);
      A.put('ch_arcade_screen', x, gy(x) + 0.03, z, -ry, 1);
    }
    A.box('metal', (ax0 + ax1) / 2, gy(ax0) + 1.0, z, ax1 - ax0, 2.2, 0.75);
  }
  solid(A, 'wood_dark', -28.5, gy(-28.5) + 0.55, 21.9, 4, 1.1, 1.0);
  deco(A, 'ch_neon_amber', -28.5, gy(-28.5) + 1.13, 21.35, 4, 0.06, 0.06);
  for (let i = 0; i < 5; i++) A.put(i % 2 ? 'box_card_a' : 'box_card_b', -30 + i * 0.8, gy(-29) + 1.1, 22.0, rng.float(), 0.8);

  // ---- the speedway on the roof ----
  // parapet, with gaps where the two stairs land
  const la = LANDINGS[STAIRS.findIndex((st) => st.id === 'speedway-passage')];
  const lb = LANDINGS[STAIRS.findIndex((st) => st.id === 'speedway-lot')];
  roofline(A, 'plaster_cream', s, top, 'ch_neon_pink', 1.05, {
    e: [[la[1], la[3]]],
    s: [[lb[0], lb[2]]],
  });
  // tyre walls: three tyres high, a box each for collision
  A.skirts = false;
  for (const [tx0, tz0, tx1, tz1] of TYRE_WALLS) {
    const alongX = tx1 - tx0 > tz1 - tz0;
    const len = alongX ? tx1 - tx0 : tz1 - tz0;
    const n = Math.max(1, Math.round(len / 0.68));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const x = alongX ? tx0 + f * len : (tx0 + tx1) / 2;
      const z = alongX ? (tz0 + tz1) / 2 : tz0 + f * len;
      // merged, not instanced: a stack of three low-poly tyres is ~150
      // triangles where the prop library's tread-modelled tyre is thousands
      for (let k = 0; k < 3; k++) A.add('rubber', tyreGeo(A), LL(IDENT, x + (rng.float() - 0.5) * 0.06, top + 0.13 + k * 0.24, z, rng.float() * 6.28), { masks: [0.4, 0.5, 0.4] });
    }
    A.box('rubber', (tx0 + tx1) / 2, top + 0.4, (tz0 + tz1) / 2, tx1 - tx0, 0.8, tz1 - tz0);
  }
  A.skirts = true;
  // the infield: a painted pad and a start gantry
  deco(A, 'plaster_white', -37, top + 0.01, 16.75, 13.5, 0.02, 3.6, 0, [0.3, 0.5, 0.3]);
  for (let i = 0; i < 8; i++) deco(A, i % 2 ? 'plaster_white' : 'el_steel', -26.5, top + 0.015, 9.6 + i * 0.6, 1.2, 0.02, 0.6);
  for (const z of [9.6, 13.6]) deco(A, 'steel_frame', -26.5, top + 1.6, z, 0.18, 3.2, 0.18);
  deco(A, 'steel_frame', -26.5, top + 3.2, 11.6, 0.25, 0.4, 4.2);
  for (const ry of [-H, H]) neonText(A, 'ch_neon_green', panel(-26.5, 0, 11.6, ry), 'GO', 0, top + 2.62, 0.4, { out: 0.16 });
  deco(A, 'metal_dark', -26.5, top + 2.85, 11.6, 0.2, 0.7, 1.4);
  // karts parked and abandoned round the track
  for (const [x, z, ry] of [[-46.5, 11, 0.3], [-41, 11.6, 0.05], [-31, 21.8, Math.PI - 0.2], [-47.6, 21, H + 0.4], [-33, 10.8, -0.15]]) {
    A.put('ch_kart', x, top, z, ry, 1);
    A.put('ch_kart_wheels', x, top, z, ry, 1);
  }
}

function buildMovieland(A, rng, s) {
  const top = topOf(s);
  mass(A, 'sign_red', s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, top);
  roofline(A, 'sign_red', s, top, 'ch_neon_amber', 0.8);
  const pm = streetFace(s);
  const g = gy(s.x);
  shopfront(A, pm, 0, s.w - 2, gy(s.x + s.w / 2 - 1) + 0.1, 3.0, 'window_glow', 'el_steel');
  awning(A, panel(s.x, 0, s.z - s.d / 2, 0), 0, g + 3.5, s.w - 2.5, rng, { key: 'fabric_red', key2: 'fabric_cream', depth: 1.6 });
  // the marquee: a yellow box of letters with bulbs, and the big star
  A.add('el_steel', BOX(A), LL(pm, 0.8, g + 5.6, 0.25, 0, 13.5, 2.0, 0.3), { masks: [0.3, 0.6, 0.4] });
  bulbFrame(A, pm, 0.8, g + 4.6, 13.5, 2.0, 0.45, 0.32, 'ch_neon_amber');
  neonText(A, 'ch_neon_amber', pm, 'MOVIELAND', 0.8, g + 4.95, 1.25, { out: 0.5, t: 0.12 });
  neonText(A, 'ch_neon_white', pm, 'WAX MUSEUM', 0.8, g + 3.0 + 1.05, 0.38, { out: 0.36 });
  // the star stands proud of the roofline, on a mast
  const sx = s.x + s.w / 2 - 2.4;
  const sz = s.z - s.d / 2 + 0.8;
  deco(A, 'steel_frame', sx, top + 1.6, sz + 0.3, 0.2, 3.2, 0.2);
  const sp = panel(sx, 0, sz, Math.PI);
  neonStar(A, 'ch_neon_amber', sp, 0, top + 3.4, 1.9, 0.0, 0.16);
  neonStar(A, 'ch_neon_red', sp, 0, top + 3.4, 1.35, 0.05, 0.12);
}

function buildWax(A, rng, s) {
  const top = topOf(s);
  mass(A, 'plaster_pink', s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, top);
  roofline(A, 'plaster_pink', s, top, 'ch_neon_pink', 0.7);
  const pm = streetFace(s);
  const g = gy(s.x);
  shopfront(A, pm, 0, s.w - 2, gy(s.x + s.w / 2 - 1) + 0.1, 3.0, 'window_glow', 'el_steel');
  A.add('metal_dark', BOX(A), LL(pm, 0, g + 5.1, 0.2, 0, 7.0, 1.9, 0.2), { masks: [0.3, 0.6, 0.4] });
  neonText(A, 'ch_neon_pink', pm, 'WAX', 0, g + 4.45, 1.3, { out: 0.36, t: 0.12 });
  tubeFrame(A, 'ch_neon_cyan', pm, 0, g + 4.2, 7.0, 1.9, 0.34);
  windows(A, rng, pm, -5.5, 5.5, g + 4.0, top - 0.6, 2, 1, 0.5, { w: 1.2, h: 1.6 });
}

function buildBurger(A, rng, s) {
  const top = topOf(s);
  const x1 = s.x + s.w / 2;
  mass(A, 'frame_white', s.x - s.w / 2, s.z - s.d / 2, x1, s.z + s.d / 2, top);
  roofline(A, 'sign_red', s, top, 'ch_neon_red', 0.6);
  const pm = streetFace(s);
  const g = gy(x1);
  shopfront(A, pm, 0, s.w - 1.5, gy(s.x) + 0.1, 3.0, 'window_glow', 'sign_red');
  A.add('sign_red', BOX(A), LL(pm, 0, g + 4.6, 0.2, 0, s.w - 0.6, 1.4, 0.25), { masks: [0.3, 0.5, 0.3] });
  neonText(A, 'ch_neon_white', pm, 'BURGERS', 0, g + 4.15, 0.9, { out: 0.4 });
  // and round the corner onto Falls Avenue
  const ep = panel(x1, 0, s.z, H);
  shopfront(A, ep, 0, s.d - 1.5, g + 0.1, 3.0, 'window_glow', 'sign_red');
  A.add('sign_red', BOX(A), LL(ep, 0, g + 4.6, 0.2, 0, s.d - 0.6, 1.4, 0.25), { masks: [0.3, 0.5, 0.3] });
  neonText(A, 'ch_neon_white', ep, 'BURGERS', 0, g + 4.15, 0.9, { out: 0.4 });
}

/* ─────────────────────────────── stairs and landings ── */

function buildStairs(A) {
  for (const st of STAIRS) flight(A, st);
  for (const [x0, z0, x1, z1, y] of LANDINGS) {
    deck(A, 'steel_grate', x0, z0, x1, z1, y, 0.2);
    // posts down to the ground under every landing
    for (const [px, pz] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z1 - 0.1]]) {
      const g = gy(px);
      deco(A, 'steel_frame', px, (g + y - 0.2) / 2, pz, 0.14, y - 0.2 - g, 0.14);
    }
  }
}

/* ─────────────────────────────── the wheel ── */

function buildWheel(A, rng) {
  const { x, z, r, half, gondolas } = WHEEL;
  const g = gy(x);
  const hy = wheelHubY();
  const SEG = 40;
  const rim = (a) => [z + Math.sin(a) * r, hy - Math.cos(a) * r];
  for (const sx of [-half, half]) {
    for (let i = 0; i < SEG; i++) {
      const [z0, y0] = rim((i / SEG) * Math.PI * 2);
      const [z1, y1] = rim(((i + 1) / SEG) * Math.PI * 2);
      strut(A, 'frame_white', x + sx, y0, z0, x + sx, y1, z1, 0.32);
      // the LED ring, just inside the rim
      const k = 0.985;
      strut(A, 'ch_neon_cyan', x + sx * 1.04, hy + (y0 - hy) * k, z + (z0 - z) * k, x + sx * 1.04, hy + (y1 - hy) * k, z + (z1 - z) * k, 0.13, [0, 0, 0]);
    }
    // spokes, hub to rim — every one a white tube
    for (let i = 0; i < 20; i++) {
      const [zr, yr] = rim((i / 20) * Math.PI * 2 + 0.07);
      strut(A, 'steel_frame', x + sx * 0.35, hy, z, x + sx, yr, zr, 0.1);
      strut(A, 'ch_neon_white', x + sx * 0.4, hy, z, x + sx * 1.02, yr, zr, 0.09, [0, 0, 0]);
    }
  }
  // cross-ties between the rims
  for (let i = 0; i < SEG; i += 2) {
    const [zr, yr] = rim((i / SEG) * Math.PI * 2);
    strut(A, 'frame_white', x - half, yr, zr, x + half, yr, zr, 0.18);
  }
  // the hub
  const hubLen = 2.0 * half + 1.6;
  const hub = tubeY(1.0, hubLen, { radial: 14 });
  hub.translate(0, -hubLen / 2, 0);
  hub.rotateZ(Math.PI / 2);
  A.addOnce('steel', hub, LL(IDENT, x, hy, z));
  const disc = tubeY(1.6, 0.25, { radial: 16 });
  disc.translate(0, -0.125, 0);
  disc.rotateZ(Math.PI / 2);
  for (const sx of [-half - 0.6, half + 0.6]) A.add('ch_neon_white', disc, LL(IDENT, x + sx, hy, z), { masks: [0, 0, 0] });
  disc.dispose();
  // the A-frame legs, and their collision near the ground
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const fx = x + sx * WHEEL.legX;
      const fz = z + sz * WHEEL.legZ;
      const fy = gy(fx) - 0.3;
      strut(A, 'frame_white', fx, fy, fz, x + sx * (half + 0.9), hy, z, 0.75);
      solid(A, 'concrete', fx, gy(fx) + 0.3, fz, 1.2, 0.6, 1.2);
      for (let k = 0; k < 3; k++) {
        const f = (k + 0.5) / 18;
        const px = fx + (x + sx * (half + 0.9) - fx) * f;
        const pz = fz + (z - fz) * f;
        A.box('metal', px, fy + (hy - fy) * f, pz, 0.85, 1.3, 0.85);
      }
    }
    // a brace between the fore and aft legs at a third of the height
    const fx = x + sx * WHEEL.legX;
    const by = gy(fx) + (hy - gy(fx)) * 0.35;
    const bx = fx + (x + sx * (half + 0.9) - fx) * 0.35;
    strut(A, 'frame_white', bx, by, z - WHEEL.legZ * 0.65, bx, by, z + WHEEL.legZ * 0.65, 0.35);
  }
  // gondolas round the rim — index 0 hangs at the bottom, at the deck
  for (let i = 0; i < gondolas; i++) {
    const [gz, gyy] = rim((i / gondolas) * Math.PI * 2);
    for (const id of ['ch_gondola', 'ch_gondola_glass', 'ch_gondola_glow']) A.put(id, x, gyy, gz, 0, 1);
  }
  // the bottom gondola stands on the boarding deck: it is cover
  A.box('metal', x, hy - r - GONDOLA.h / 2 - 0.2, z, GONDOLA.w, GONDOLA.h - 0.6, GONDOLA.w);

  // the boarding deck, with two steps up from the north
  const d = WHEEL.deck;
  const dy = hy - r - GONDOLA.h - 0.02;
  const base = gy(d.x1) - 0.4;
  solid(A, 'concrete', (d.x0 + d.x1) / 2, (base + dy) / 2, (d.z0 + d.z1) / 2, d.x1 - d.x0, dy - base, d.z1 - d.z0);
  for (const [k, h] of [[1, 0.35], [2, 0.7]]) {
    const zz = d.z0 - 0.4 - (k - 1) * 0.8;
    solid(A, 'concrete', (d.x0 + d.x1) / 2, (base + dy - h) / 2, zz, d.x1 - d.x0, dy - h - base, 0.8);
  }
  rail(A, d.x0 + 0.1, d.z1 - 0.1, d.x1 - 0.1, d.z1 - 0.1, dy, 1.0, 'frame_white');
  // the sign on the deck's fascia
  const cx = (d.x0 + d.x1) / 2;
  const sp = panel(cx, 0, d.z0 + 0.1, Math.PI);
  deco(A, 'metal_dark', cx, dy + 2.75, d.z0 + 0.18, d.x1 - d.x0 - 0.4, 1.0, 0.1);
  neonText(A, 'ch_neon_cyan', sp, 'SKYWHEEL', 0, dy + 2.45, 0.6, { out: 0.06 });
  for (const sx of [d.x0 + 0.25, d.x1 - 0.25]) solid(A, 'steel_frame', sx, dy + 1.6, d.z0 + 0.25, 0.16, 3.2, 0.16);
  void rng;
}

/* ─────────────────────────────── perimeter and backdrop ── */

function buildPerimeter(A, rng) {
  for (const [x0, z0, x1, z1, kind] of PERIMETER) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const g = gy(Math.max(x0, Math.min(x1, cx)));
    if (kind === 'hoarding') {
      const h = 2.8;
      const along = x1 - x0 > z1 - z0;
      const L = along ? x1 - x0 : z1 - z0;
      const base = gy(along ? x1 : cx) - 0.2;
      const top = gy(along ? x0 : cx) + h;
      solid(A, 'plywood', cx, (base + top) / 2, cz, along ? L : 0.12, top - base, along ? 0.12 : L);
      // posts and a lit capping, and a row of bulbs: an event closure
      const n = Math.max(2, Math.round(L / 2.4));
      for (let i = 0; i <= n; i++) {
        const u = -L / 2 + (i / n) * L;
        const px = along ? cx + u : cx;
        const pz = along ? cz : cz + u;
        deco(A, 'steel_frame', px, (gy(px) + top) / 2, pz, 0.12, top - gy(px) + 0.2, 0.12);
      }
      deco(A, 'ch_neon_amber', cx, top + 0.06, cz, along ? L : 0.1, 0.06, along ? 0.1 : L);
      // jersey barriers in front, on the play side
      if (along) {
        const side = cz < 0 ? 1 : -1;
        for (let u = -L / 2 + 1; u < L / 2 - 0.5; u += 2.1) A.put('jersey', cx + u, gy(cx + u), cz + side * 0.9, 0, 1);
        A.box('concrete', cx, 0.45, cz + side * 0.9, L - 1, 0.9, 0.6);
      }
    } else if (kind === 'wall') {
      const h = 3.2;
      const along = x1 - x0 > z1 - z0;
      const base = gy(along ? x1 : cx) - 0.4;
      const top = gy(along ? x0 : cx) + h;
      solid(A, 'brick_red', cx, (base + top) / 2, cz, x1 - x0, top - base, z1 - z0);
      deco(A, 'stone_pale', cx, top + 0.06, cz, x1 - x0 + 0.1, 0.12, z1 - z0 + 0.1);
    } else if (kind === 'backs') {
      // the next block's back walls: a run of masses at uneven heights
      let x = x0;
      while (x < x1 - 0.1) {
        const w = Math.min(x1 - x, rng.range(7, 13));
        const h = rng.range(7, 13);
        mass(A, rng.float() < 0.5 ? 'brick_chicago' : 'concrete_dark', x, z0 - 6, x + w, z1, gy(x) + h);
        // service doors and a few lit windows facing the lane
        const pm = panel(x + w / 2, 0, z1, 0);
        A.add('metal_dark', BOX_THIN(A), LL(pm, rng.range(-w / 4, w / 4), gy(x + w / 2) + 1.1, 0.04, 0, 1.2, 2.2, 0.06), { masks: [0.6, 0.7, 0.4] });
        windows(A, rng, pm, -w / 2 + 1, w / 2 - 1, gy(x) + 3.5, gy(x) + h - 1, Math.max(1, Math.round(w / 3.5)), Math.max(1, Math.round((h - 4) / 3.2)), 0.3, { w: 1.0, h: 1.3 });
        x += w;
      }
    } else if (kind === 'casino') {
      buildCasino(A, rng, x0, z0, x1, z1);
    }
  }
}

function buildCasino(A, rng, x0, z0, x1, z1) {
  // the casino and hotel across Falls Avenue: one long lit podium and a tower
  const top = 9;
  mass(A, 'stone_grey', x0, z0, x1 + 14, z1, top);
  mass(A, 'plaster_white', x0 + 4, -18, x1 + 22, 14, 34);
  const pm = panel(x0, 0, (z0 + z1) / 2, -H);
  // lit glass along the whole podium
  A.add('window_glow', BOX_THIN(A), LL(pm, 0, 1.6, 0.05, 0, z1 - z0 - 4, 2.8, 0.06), { masks: [0.2, 0.3, 0.2] });
  for (let u = -(z1 - z0) / 2 + 2; u <= (z1 - z0) / 2 - 2; u += 2) {
    A.add('metal_dark', BOX_THIN(A), LL(pm, u, 1.6, 0.1, 0, 0.1, 2.8, 0.1), { masks: [0.5, 0.3, 0.2] });
  }
  A.add('el_steel', BOX(A), LL(pm, 0, 3.4, 0.4, 0, z1 - z0 - 2, 0.8, 0.8), { masks: [0.4, 0.4, 0.3] });
  bulbFrame(A, pm, 0, 3.0, z1 - z0 - 2, 0.8, 0.85, 0.5, 'ch_neon_amber');
  // the name, big, over the canopy
  A.add('metal_dark', BOX(A), LL(pm, 4, 6.3, 0.15, 0, 13, 3.0, 0.2), { masks: [0.3, 0.6, 0.4] });
  neonText(A, 'ch_neon_amber', pm, 'CASINO', 4, 5.4, 2.0, { out: 0.32, t: 0.16 });
  tubeFrame(A, 'ch_neon_red', pm, 4, 4.9, 13, 3.0, 0.3, 0.08);
  // the tower's rooms
  const tp = panel(x0 + 4, 0, -2, -H);
  windows(A, rng, tp, -15, 15, 10.5, 33, 12, 7, 0.6, { w: 1.4, h: 1.6 });
  neonText(A, 'ch_neon_cyan', tp, 'HOTEL', 0, 30.2, 1.8, { out: 0.2 });
}

/**
 * Everything past the play line: the hill continuing up past the closure to
 * the crest, a few towers to the south-west against the sunset, the river
 * edge behind the casino. Cheap masses, lit windows, no collision needed (the
 * perimeter is sealed in front of all of it).
 */
function buildBackdrop(A, rng) {
  // the upper strip: blocks either side of the street, climbing to the crest
  for (const side of [-1, 1]) {
    let x = -52;
    while (x > -128) {
      const w = rng.range(9, 15);
      const x0 = x - w;
      const d = rng.range(10, 16);
      const z0 = side < 0 ? -CLIFTON.line - d : CLIFTON.line;
      const z1 = z0 + d;
      const h = rng.range(6, 12);
      const key = rng.pick(['brick_chicago', 'plaster_sand', 'plaster_cream', 'brick_red', 'concrete']);
      const top = gy(x0) + h;
      const base = gy(x) - 0.5;
      deco(A, key, (x0 + x) / 2, (base + top) / 2, (z0 + z1) / 2, w - 0.4, top - base, d, 0, [0.5, 0.5, 0.3]);
      const pm = side < 0 ? panel((x0 + x) / 2, 0, z1, 0) : panel((x0 + x) / 2, 0, z0, Math.PI);
      A.add('window_glow', BOX_THIN(A), LL(pm, 0, gy(x0 + w / 2) + 1.6, 0.05, 0, w - 2, 2.6, 0.06), { masks: [0.2, 0.3, 0.2] });
      const neon = rng.pick(['ch_neon_red', 'ch_neon_amber', 'ch_neon_cyan', 'ch_neon_pink', 'ch_neon_green']);
      deco(A, neon, (x0 + x) / 2, top - 0.3, side < 0 ? z1 + 0.1 : z0 - 0.1, w - 0.6, 0.08, 0.08, 0, [0, 0, 0]);
      if (rng.float() < 0.6) {
        A.add(neon, BOX_THIN(A), LL(pm, rng.range(-w / 4, w / 4), gy(x0) + h * 0.6, 0.3, 0, rng.range(2, 4), rng.range(0.6, 1.1), 0.1), { masks: [0, 0, 0] });
      }
      x = x0 - rng.range(0, 3);
    }
  }
  // towers on the escarpment beyond: the Fallsview skyline, south-west
  for (const [cx, cz, w, d, h] of [[-95, 70, 22, 16, 58], [-60, 95, 18, 18, 72], [-135, 30, 20, 14, 46], [-20, 120, 26, 16, 64], [-110, -60, 18, 18, 40]]) {
    const base = gy(cx) - 0.5;
    deco(A, rng.pick(['plaster_white', 'concrete', 'stone_grey']), cx, base + h / 2, cz, w, h, d, 0, [0.4, 0.5, 0.3]);
    for (const [px, pz, ry] of [[cx, cz - d / 2, Math.PI], [cx + w / 2, cz, H]]) {
      const pm = panel(px, 0, pz, ry);
      windows(A, rng, pm, -w / 2 + 2, w / 2 - 2, base + 4, base + h - 3, Math.round(w / 3), Math.round(h / 4.5), 0.45, { w: 1.6, h: 1.4 });
    }
    deco(A, 'ch_neon_red', cx, base + h + 0.6, cz, 0.3, 1.2, 0.3, 0, [0, 0, 0]);
  }
  // south of the fun-zone wall: trees, and the mini-golf's fence
  for (let x = -48; x < 30; x += rng.range(4.5, 7)) {
    const z = rng.range(41, 47);
    A.put('shrub', x, gy(x), z, rng.float() * 6.28, rng.range(2.5, 3.6));
  }
  // north of the backs: a second, taller row of blocks
  for (let x = -70; x < 50; x += 14) {
    const h = rng.range(12, 22);
    deco(A, rng.pick(['concrete_dark', 'brick_chicago', 'plaster_sand']), x + 7, gy(x) + h / 2 - 0.5, -44, 13.5, h + 1, 8, 0, [0.5, 0.5, 0.3]);
    const pm = panel(x + 7, 0, -40, 0);
    windows(A, rng, pm, -5.5, 5.5, gy(x) + 4, gy(x) + h - 2, 4, Math.max(1, Math.round(h / 4)), 0.35, { w: 1.1, h: 1.3 });
  }
  // the far side of Falls Avenue's closures: the road runs on
  for (const zz of [-50, 62]) {
    deco(A, 'concrete_dark', 22, 6, zz, 14, 12, 12);
    const pm = panel(22, 0, zz + (zz < 0 ? 6 : -6), zz < 0 ? 0 : Math.PI);
    windows(A, rng, pm, -6, 6, 3, 11, 4, 3, 0.4);
  }
}

/* ─────────────────────────────── cover and dressing ── */

const CAR_PAINT = { taxi: 'ch_car_taxi', red: 'ch_car_red', blue: 'ch_car_blue', white: 'ch_car_white', dark: 'ch_car_dark' };

function placeCar(A, x, z, ry, paint) {
  const y = gy(x);
  // the car's pitch on the slope: noses down the hill when heading east
  // (+rz lifts the nose; a car heading +X faces down the hill)
  const pitch = Math.atan(CLIFTON.grade) * (x < CLIFTON.knee - CLIFTON.kneeBlend ? 1 : 0);
  const rz = Math.abs(Math.cos(ry)) > 0.5 ? -pitch * Math.sign(Math.cos(ry)) : 0;
  const rx = 0;
  for (const id of [CAR_PAINT[paint], 'ch_car_glass', 'ch_car_wheels', 'ch_car_head', 'ch_car_tail']) A.put(id, x, y, z, ry, 1, null, rx, rz);
  if (paint === 'taxi') A.put('ch_taxi_top', x, y, z, ry, 1, null, rx, rz);
}

function buildCover(A, rng) {
  for (const c of COVER) {
    const [x, z, kind, ry, paint] = c;
    const [l, w, h] = KINDS[kind];
    const y = gy(x);
    if (kind === 'car') {
      placeCar(A, x, z, ry, paint);
      A.box('metal', x, y + 0.75, z, l, 1.45, w, ry);
    } else if (kind === 'trolley') {
      for (const id of ['ch_trolley_body', 'ch_trolley_band', 'ch_trolley_glass', 'ch_trolley_wheels']) A.put(id, x, y, z, ry, 1);
      A.box('metal', x, y + h / 2 + 0.05, z, l, h, w, ry);
    } else if (kind === 'median') {
      // a concrete planter box with a hedge in it, and a lit edge strip
      solid(A, 'concrete', x, y + 0.35, z, l, 0.75, w, 0, [0.5, 0.55, 0.35]);
      for (const dx of [-1, 0, 1]) A.put('shrub', x + dx, y + 0.72, z, rng.float() * 6.28, rng.range(0.9, 1.15));
    } else if (kind === 'dumpster') {
      A.put('dumpster', x, y, z, ry, 1);
      A.box('metal', x, y + 0.65, z, l, 1.3, w, ry);
    } else if (kind === 'stall') {
      A.put('stall', x, y, z, ry, 1);
      A.box('wood', x, y + 0.5, z, l, 1.0, w, ry);
      // a lit header board on each game booth
      const pm = panel(x, 0, z, ry + Math.PI);
      A.add(rng.pick(['ch_neon_pink', 'ch_neon_green', 'ch_neon_amber', 'ch_neon_cyan']), BOX_THIN(A),
        LL(pm, 0, y + 2.1, 0.55, 0, 2.2, 0.08, 0.08), { masks: [0, 0, 0] });
    } else if (kind === 'booth') {
      solid(A, 'paint_yellow', x, y + 1.1, z, l, 2.2, w, ry);
      deco(A, 'sign_red', x, y + 2.35, z, l + 0.4, 0.3, w + 0.4, ry);
      A.add('window_glow', BOX_THIN(A), LL(IDENT, x, y + 1.4, z - w / 2 - 0.03, ry, l - 0.6, 0.8, 0.05), { masks: [0.2, 0.3, 0.2] });
      neonText(A, 'ch_neon_white', panel(x, 0, z - w / 2, Math.PI), 'TICKETS', 0, y + 2.65, 0.32, { out: 0.05 });
    } else if (kind === 'kiosk') {
      solid(A, 'metal_blue', x, y + 1.0, z, l, 2.0, w, ry);
      deco(A, 'ch_neon_cyan', x, y + 2.05, z, l + 0.1, 0.1, w + 0.1, ry, [0, 0, 0]);
    } else if (kind === 'crates') {
      A.skirts = false;
      A.put('crate_a', x - 0.35, y, z, 0.1, 1.1);
      A.put('crate_b', x + 0.4, y, z + 0.1, -0.2, 1.1);
      A.put('crate_c', x, y + 0.58, z, 0.4, 1.0);
      A.skirts = true;
      A.box('wood', x, y + 0.6, z, l, 1.2, w, ry);
    } else if (kind === 'ac') {
      A.put('ac_unit', x, y, z, ry, 1.6);
      A.box('metal', x, y + 0.55, z, l, 1.1, w, ry);
    } else if (kind === 'container') {
      A.put('cont_blue', x, y, z, ry, 1);
      A.box('metal', x, y + 1.3, z, l, 2.6, w, ry);
    }
  }
}

function dress(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.4, scale: 0.05 };
  const free = (x, z, m = 0.6) => isOpenClifton(x, z, m) && !inStairRun(x, z);

  // street lamps — and the point lights the world ramps up at sunset
  for (const [x, z, ry] of LAMPS) {
    const y = gy(x);
    A.put('lamp_post', x, y, z, ry, 0.95);
    A.put('lamp_glass', x, y, z, ry, 0.95);
    A.box('metal', x, y + 1.3, z, 0.3, 2.6, 0.3);
    A.lampAnchors.push({ x: x + Math.cos(ry) * 0.83, y: y + 5.28, z: z - Math.sin(ry) * 0.83 });
  }

  // bollards along the kerbs, gapped at the crossings and the alleys
  for (const sz of [-1, 1]) {
    for (let x = -48; x < 29; x += 3.2) {
      const z = sz * (CLIFTON.road + 0.45);
      if (Math.abs(x - 27.5) < 2.2 || Math.abs(x + 26.5) < 2.2) continue;
      if (!free(x, z, 0.3)) continue;
      A.put('ch_bollard', x, gy(x), z, 0, 1);
    }
  }

  // the pavement vocabulary: bins, boxes, hydrants, sandwich boards, benches
  const street = [
    [-45, -6.2, 'litter_basket'], [-25, 6.4, 'litter_basket'], [-8, -6.2, 'litter_basket'], [16, 6.4, 'litter_basket'],
    [24, -6.3, 'litter_basket'], [33.6, 14, 'litter_basket'], [44.4, -14, 'litter_basket'],
    [-36, 6.3, 'hydrant'], [11, -6.2, 'hydrant'], [44.6, 20, 'hydrant'],
    [-14, -6.4, 'newsbox'], [-13.4, -6.4, 'newsbox_blue'], [26, 6.2, 'newsbox'],
    [-29, 6.6, 'sign_board'], [-2.5, 6.6, 'sign_board'], [5, -6.6, 'sign_board'], [20, -6.6, 'sign_board'],
    [-40, -6.6, 'sign_board'],
  ];
  for (const [x, z, id] of street) if (free(x, z, 0.4)) A.put(id, x, gy(x), z, rng.float() * 6.28, 1);
  for (const [x, z, ry] of [[-18.5, 7.8, Math.PI], [-44.5, -7.9, 0], [2.5, -7.9, 0], [33.4, 20, H]]) {
    if (!free(x, z, 0.5)) continue;
    A.put('bench_cta', x, gy(x), z, ry, 1);
  }
  // pedestrians' leftovers: litter along the gutters and the back lane
  for (let i = 0; i < 70; i++) {
    const x = rng.range(CLIFTON.x0 + 1, CLIFTON.x1 - 1);
    const z = rng.range(CLIFTON.z0 + 1, CLIFTON.z1 - 1);
    if (!free(x, z, 0.3)) continue;
    A.put(rng.pick(['litter', 'can', 'bottle', 'box_card_a', 'litter_bag']), x, gy(x), z, rng.float() * 6.28, rng.range(0.8, 1.1));
  }
  // the back lane: pallets, barrels, gas bottles, a generator for the midway
  const lane = [
    [-47, -21.5, 'pallet'], [-38.5, -26.8, 'barrel_blue'], [-38, -26.3, 'barrel_rust'], [-28, -27, 'pallet'],
    [-16, -27, 'gas_bottle'], [-15.6, -27.1, 'gas_bottle'], [-3, -27, 'pallet'], [6, -27, 'barrel_blue'],
    [16, -26.6, 'crate_a'], [19, -27, 'jerry_can'], [28, -23, 'pallet'],
  ];
  for (const [x, z, id] of lane) if (free(x, z, 0.4)) A.put(id, x, gy(x), z, rng.float() * 6.28, 1);
  // the fun zone: planters and shrubs, traffic drums round the wheel's feet
  for (const [x, z] of [[-17, 23.5], [-6, 23], [14, 24], [26, 23], [2, 37], [-16, 36.5]]) {
    if (!free(x, z, 0.5)) continue;
    A.put('planter', x, gy(x), z, 0, 1.6);
    A.put('shrub', x, gy(x) + 0.65, z, rng.float() * 6.28, 0.8);
  }
  for (const [x, z] of [[1.5, 24.3], [14.5, 24.2], [1.5, 41.8], [14.5, 42.3]]) if (free(x, z, 0.3)) A.put('traffic_drum', x, gy(x), z, 0, 1);
  // festoons strung across the fun zone, wheel to booth to wall
  for (const [ax, az, bx, bz, hh] of [[-18, 21.5, -2, 21.0, 4.2], [-2, 21.0, -2, 37.5, 4.0], [18, 20.5, 29, 37.5, 4.2]]) {
    const n = Math.round(Math.hypot(bx - ax, bz - az));
    const ry = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      A.put('ch_festoon', x, gy(x) + hh - Math.sin(f * Math.PI) * 0.6, z, ry, 1);
    }
  }
  A.jitter = null;
}

const inStairRun = (() => {
  const rects = STAIRS.map((st) => {
    const r = stairRect(st);
    // and the 2 m of run-up in front of the foot
    const dx = Math.sin(st.ry);
    const dz = Math.cos(st.ry);
    const fx = st.x - dx * 2;
    const fz = st.z - dz * 2;
    return [Math.min(r[0], fx - 0.8), Math.min(r[1], fz - 0.8), Math.max(r[2], fx + 0.8), Math.max(r[3], fz + 0.8)];
  });
  return (x, z) => rects.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
})();

/* ─────────────────────────────────────────────────────────────────────────── */
/* build                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

export function buildClifton(A, rng) {
  registerProps(A, rng);
  registerRustProps(A, rng);
  registerLoopProps(A, rng);
  registerCliftonProps(A);
  // the brew patio's parasols are the Fisher's; registered lazily here so the
  // map does not pull a whole estate library for one prototype
  if (!A.has('parasol')) {
    A.proto('parasol', { geo: parasolGeo(), key: 'fabric_red' });
  }

  buildGround(A, rng);
  const infos = [];
  for (const s of STRUCTURES) {
    if (s.id === 'dracula') buildDracula(A, rng, s);
    else if (s.id === 'hotel') buildHotel(A, rng, s);
    else if (s.id === 'records') buildRecords(A, rng, s);
    else if (s.id === 'brew') buildBrew(A, rng, s);
    else if (s.id === 'midway') buildMidway(A, rng, s);
    else if (s.id === 'movieland') buildMovieland(A, rng, s);
    else if (s.id === 'wax') buildWax(A, rng, s);
    else buildBurger(A, rng, s);
    infos.push({ spec: s, id: s.id });
  }
  infos.push({ spec: { id: 'wheel', x: WHEEL.x, z: WHEEL.z, w: WHEEL.deck.x1 - WHEEL.deck.x0, d: WHEEL.deck.z1 - WHEEL.deck.z0, h: 0 }, id: 'wheel' });
  buildStairs(A);
  buildWheel(A, rng);
  buildPerimeter(A, rng);
  buildBackdrop(A, rng);
  buildCover(A, rng);
  dress(A, rng);
  return { buildings: infos };
}

/** A café parasol: a thin mast under a shallow eight-panel cone. */
function parasolGeo() {
  const p = new PB();
  p.cyl(0.05, 2.3, 0, 1.15, 0, { radial: 6, grime: 0.35 });
  p.cyl(1.3, 0.42, 0, 2.34, 0, { radial: 8, taper: 0.07, open: true, wear: 1, grime: 0.2 });
  return p.build();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const CLIFTON_MAP = {
  id: 'clifton',
  blurb: 'A neon strip climbing a hill at sunset. Fight up the street, round the back lane and the fun-zone lot, or from the speedway on the midway roof.',
  size: '98 × 66 m',
  /**
   * LEVEL -> WORLD. Chosen for the sun: at the map's hour the sun is a degree
   * and a half up in the world's WNW, and this turn puts it straight up the
   * hill, nine degrees to the south of the street's axis. So the bottom of
   * the hill looks into the sunset with the wheel silhouetted against it,
   * the south-facing fronts of the north side catch a raking last light, and
   * the south side stands in its own shadow, lit by its neon.
   */
  transform: { yaw: -0.71, tx: 0, tz: 0 },
  bounds: [-52, -2, -30, 50, 42, 40],
  spawnPoints: CLIFTON_SPAWNS,
  standable: standableAtClifton,
  groundY: groundYClifton,
  isOpen: isOpenClifton,
  build: buildClifton,
  /**
   * TEN MINUTES PAST SUNSET-ISH, at the solstice and 45 degrees north (the
   * sky's fixed site — Niagara is 43). The sun is ~1.4 degrees up: still a
   * key light, orange, almost flat along the street; the sky is at its most
   * saturated; and the world's lamps are half up, because they ramp on solar
   * altitude. Every emitter on the map is placed to read against THAT sky.
   *
   * Streaky cloud, as in the reference: plenty of cirrus with high opacity
   * catching the colour, a broken cumulus deck, warm turbid air.
   */
  environment: {
    hour: 19.55,
    exposureBias: 0.2,
    weather: {
      turbidity: 3.4,
      cloudCoverage: 0.42,
      cloudDensity: 1.4,
      cirrusCoverage: 0.62,
      cirrusOpacity: 0.62,
      horizonMurk: 0.32,
      fogDensity: 0.6,
      fogHeight: 14,
    },
  },
};
