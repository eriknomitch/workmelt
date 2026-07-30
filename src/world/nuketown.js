import * as THREE from 'three';
import { BOX, BOX_THIN, IDENT, LL, stairRun, worldOf, ryOf } from './kit.js';
import { registerProps } from './props.js';
import { fbm3, paintMasks } from './util.js';

/**
 * WORLD — NUKETOWN.
 *
 * A deliberately stripped-back take on the classic Call of Duty map: two
 * suburban houses facing each other across a street, inside a sealed test-site
 * compound. 51 x 42 m of playable ground.
 *
 *   THE STREET    12 m of asphalt running north-south through the middle, with
 *                 a sidewalk each side. It is the map's spine and its longest
 *                 sightline, broken every 8 m by a staggered barricade so it is
 *                 a fighting lane rather than a shooting gallery.
 *   THE HOUSES    one cream, one blue, mirrored across the street and offset 5 m
 *                 along it so neither upstairs window looks straight into the
 *                 other. Both are enterable, both have a stair, and both have
 *                 first-floor windows over the street — that overlook is the
 *                 map's whole risk/reward economy.
 *   THE SIGN      a 6.4 m gantry over the middle of the street. It is the
 *                 landmark: visible from every corner, it tells you which way
 *                 you are facing the moment you spawn.
 *   THE ALLEYS    3 m behind each house, connecting the north and south ends
 *                 without crossing the street. Every space on this map has two
 *                 ways out.
 *
 * ARENA BLOCKOUT IS THE BRIEF. Forms are plain chamfered boxes — no foliage, no
 * vehicles, no facade furniture — and the whole map is drawn from nine palette
 * keys. Surface interest comes from the shared procedural materials, not from
 * geometry or textures, which is what keeps a map this readable this cheap.
 *
 * PROVENANCE. Proportions were measured off a reference model with
 * `tools/glb-plan.mjs` (1 unit = 1 cm; houses ~11 x 15 m, 6 m eaves, ~35 m
 * centre-to-centre; 12 m road; 1.2 m yard walls; a 5.9 m sign). Nothing from
 * that model is loaded, imported or sampled — every mesh below is generated,
 * like the rest of the game. Where the reference and playability disagreed,
 * playability won and the deviation is commented at the site.
 *
 * LAYOUT NOTES
 *   Authored in LEVEL space, compound centred on the origin, north at -Z.
 *   `WorldSystem` bakes the level->world transform into every vertex, proxy and
 *   light, so nothing below knows about world space.
 *
 *   Roofs are pitched and NOT reachable — this engine's controller mantles low
 *   ledges but climbs no ladders, so the only verticality is the two interior
 *   stairs. That is deliberate: on a map this small, a reachable roof would see
 *   everything.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const NUKE = {
  /** Half-extents of the compound. The perimeter wall centre line sits here. */
  halfX: 25.5,
  halfZ: 21,
  wallH: 3.2,
  wallT: 0.4,
  /** Compound floor. Flat: this is a poured test-site apron, not terrain. */
  y: 0,
  /** Street half-width, and the outer edge of the sidewalk beside it. */
  streetHalf: 6,
  kerb: 7.4,
  /** Storey height, eaves and ridge — both houses are identical in section. */
  floorH: 3.2,
  eaves: 6.2,
  ridge: 8.0,
};

/**
 * The two houses. `x`/`z` are centres, `w` the extent across the street, `d`
 * along it. Shape matches the market's `BUILDINGS` entries closely enough for
 * `ui/minimap` to draw them.
 *
 * `face` is the direction the front door looks, as a sign on X — the module
 * builds one house in local coordinates where +X is always "toward the street"
 * and places the east one with a half-turn, so there is exactly one house
 * builder rather than two mirrored ones.
 *
 * The 5 m stagger along Z is a DEVIATION from the reference, which has them
 * nearly opposite. Directly opposed upstairs windows trade first-shot-wins
 * across 33 m with no counterplay; offset, each overlooks the other's yard
 * instead of its window, so the duel is winnable from the ground.
 */
export const HOUSES = [
  { id: 'west', x: -17, z: -2.5, w: 11, d: 15, face: 1, key: 'plaster_cream', floors: 2, h: NUKE.ridge },
  { id: 'east', x: 17, z: 2.5, w: 11, d: 15, face: -1, key: 'plaster_blue', floors: 2, h: NUKE.ridge },
];

/**
 * The sign gantry over the street — the landmark.
 *
 * The reference puts its sign at one end of the road, on two 5.9 m poles. This
 * one spans the middle instead: a landmark at the edge of a 42 m map orients
 * you from one direction only, and the middle of the street is the one place
 * every route can see. The board sits at 4.6 m, well clear of head height, so
 * it costs no sightline it does not mean to.
 */
export const SIGN = { z: 0, poleX: 5.2, poleH: 6.4, boardY: 4.6, boardH: 1.6, boardT: 0.25 };

const H = Math.PI / 2;

/**
 * Low walls, 1.2 m: `[x, z, ry, len]`. `ry` 0 runs along X, `H` runs along Z.
 * Chest-high cover in the yards, taken from the reference's 1.2 m garden walls.
 */
export const YARD_WALLS = [
  [-11.0, -8.0, H, 5.5],
  [-11.0, 3.0, H, 4.5],
  [-14.0, -11.2, 0, 6.0],
  [11.0, 8.0, H, 5.5],
  [11.0, -3.0, H, 4.5],
  [14.0, 11.2, 0, 6.0],
];

/**
 * Street barricades, 1.1 m: `[x, z, ry, len]`. Staggered left/right down the
 * street so the lane never runs more than ~8 m unbroken, which is the market's
 * stall rhythm applied to a road. This is also what replaces the reference's
 * parked cars — the brief is polygon shapes, and a barricade is one.
 */
export const STREET_BLOCKS = [
  [-3.4, -14.0, 0, 4.0],
  [3.4, -6.0, 0, 4.0],
  [-3.4, 6.0, 0, 4.0],
  [3.4, 14.0, 0, 4.0],
];

/**
 * THE MOUTH BLOCKS. The perimeter opens where the street leaves the compound at
 * each end, which is right — a closed box of wall reads as a box of wall. But an
 * opening is a hole a player walks out of into empty desert, so each is parked
 * shut the way a real test site would: a barrier line straight across, 1.9 m
 * inside the wall line. 1.25 m tall, so it stops a player (the controller
 * mantles ~0.5 m) without blocking the view down the road that makes the
 * opening worth having.
 */
export const MOUTH_BLOCKS = [
  [0, -(NUKE.halfZ - 1.9), 0, 12.8],
  [0, NUKE.halfZ - 1.9, 0, 12.8],
];

/**
 * Yard sheds: `[x, z, w, d, h]`. One in each end lot, and they are not dressing.
 *
 * Everything else on this map is either a house or knee-to-chest cover, which
 * left the four end lots — where two thirds of the spawn points live — open at
 * STANDING height from one end of the compound to the other. `spawns.probe.mjs`
 * is what found it: every respawn it drove landed in a bot's line of sight, on a
 * map whose walkable ground was 72%. A 2.9 m box is the cheapest thing that
 * breaks a sightline a 1.1 m barricade does not, and a garden shed is what a
 * suburban back lot would have anyway.
 *
 * Placed clear of every authored spawn point, which the self-test asserts —
 * a shed dropped on a spawn silently deletes it at build time instead.
 */
export const SHEDS = [
  [-15.5, -15.0, 4.0, 3.2, 2.9],
  [15.5, -13.0, 4.0, 3.2, 2.9],
  [-15.5, 13.0, 4.0, 3.2, 2.9],
  [15.5, 15.0, 4.0, 3.2, 2.9],
];

/** Background masses beyond the wall, so the horizon is not a bare sky line. */
export const BACKDROP = [
  [-34, -30, 10, 8, 6.5],
  [30, -34, 12, 9, 8.5],
  [36, 24, 9, 11, 5.5],
  [-30, 33, 14, 8, 7.0],
];

/**
 * Spawn points: `[x, z, turn, zone]`. `turn` is added to the facing that looks
 * at the sign, so nobody spawns staring at a wall and nobody spawns with their
 * back to the lane they have to fight down.
 *
 * INDEX 0 is the boot/dev spawn (exempt from validation in `buildSpawnPoints`),
 * so it is the one point guaranteed to exist: the south end of the street,
 * looking straight up the road under the sign.
 */
const facing = (x, z, turn = 0) => Math.atan2(x - 0, z - SIGN.z) + turn;
export const NUKETOWN_SPAWNS = [
  /**
   * FROZEN — the boot spawn, and the frame every capture of this map is shot
   * from. The `turn` is not decoration: the compound is wider than it is deep,
   * so from the middle of the road both houses sit ~44 deg off axis, just
   * outside a 75 deg frame — the establishing shot of a two-house map contained
   * no houses at all. Swinging 20 deg puts the west house on the left and the
   * sign on the right, which is the map in one frame. Corner positions were
   * tried first and are worse: each one boots you 3 m behind a shed.
   */
  [1.8, 16.8, 0.35, 'south-street'],
  [-2.6, 15.6, 0.2, 'south-street'],
  [4.8, 11.0, -0.2, 'south-street'],

  [-1.8, -16.8, 0, 'north-street'],
  [2.6, -15.6, -0.2, 'north-street'],
  [-4.8, -11.0, 0.2, 'north-street'],

  [-9.2, -6.0, -0.3, 'west-yard'],
  [-9.2, 1.5, 0.3, 'west-yard'],
  [-12.5, -12.5, 0.4, 'west-yard'],
  [-9.0, 7.5, 0, 'west-yard'],

  [9.2, 6.0, 0.3, 'east-yard'],
  [9.2, -1.5, -0.3, 'east-yard'],
  [12.5, 12.5, -0.4, 'east-yard'],
  [9.0, -7.5, 0, 'east-yard'],

  [-24.0, -9.0, 0.5, 'west-alley'],
  [-24.0, 0.0, 0, 'west-alley'],
  [-24.0, 9.0, -0.5, 'west-alley'],

  [24.0, 9.0, -0.5, 'east-alley'],
  [24.0, 0.0, 0, 'east-alley'],
  [24.0, -9.0, 0.5, 'east-alley'],

  // The four end lots are split PER CORNER rather than one north and one south
  // zone. A zone spanning both sides of the street puts its centroid in the
  // middle of the road, next to the street zone's — and crowding is counted per
  // zone, so two zones that overlap in space are one zone that spawn-loops.
  [-19.0, -17.0, 0.35, 'nw-lot'],
  [-11.0, -17.5, -0.2, 'nw-lot'],
  [-22.5, -14.0, 0.5, 'nw-lot'],

  [12.0, -17.5, 0.2, 'ne-lot'],
  [19.5, -16.0, -0.35, 'ne-lot'],
  [22.5, -13.0, -0.5, 'ne-lot'],

  [-12.0, 17.5, 0.2, 'sw-lot'],
  [-19.5, 16.0, -0.35, 'sw-lot'],
  [-22.5, 13.0, -0.5, 'sw-lot'],

  [19.0, 17.0, 0.35, 'se-lot'],
  [11.0, 17.5, -0.2, 'se-lot'],
  [22.5, 14.0, 0.5, 'se-lot'],
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
  for (const h of HOUSES) out.push([h.x - h.w / 2, h.z - h.d / 2, h.x + h.w / 2, h.z + h.d / 2]);
  for (const [x, z, w, d] of SHEDS) out.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
  for (const [x, z, ry, len] of YARD_WALLS) out.push(wallRect(x, z, ry, len, 0.35));
  for (const [x, z, ry, len] of STREET_BLOCKS) out.push(wallRect(x, z, ry, len, 0.8));
  for (const [x, z, ry, len] of MOUTH_BLOCKS) out.push(wallRect(x, z, ry, len, 0.9));
  // The sign's two poles, so nothing gets dressed or spawned inside them.
  for (const sx of [-1, 1]) out.push([sx * SIGN.poleX - 0.3, SIGN.z - 0.3, sx * SIGN.poleX + 0.3, SIGN.z + 0.3]);
  return out;
})();

/** True inside (or within `m` of) anything solid standing on the compound floor. */
export function inSolid(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/**
 * Can a character stand here, in LEVEL space? Inside the wall and off every
 * footprint. Only ever a first filter — real collision decides, in
 * `buildSpawnPoints`.
 */
export function standableAtNuketown(x, z, margin = 0.55) {
  if (Math.abs(x) > NUKE.halfX - 0.8 - margin) return false;
  if (Math.abs(z) > NUKE.halfZ - 0.8 - margin) return false;
  return !inSolid(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenNuketown(x, z, m = 0.3) {
  if (Math.abs(x) > NUKE.halfX - 0.6) return false;
  if (Math.abs(z) > NUKE.halfZ - 0.6) return false;
  return !inSolid(x, z, m);
}

/**
 * Analytic floor height. The compound is a poured apron, so this is dead flat
 * inside the wall; outside it the desert rolls away and climbs into a ridge.
 *
 * The ridge is not scenery for its own sake. From an upstairs window the camera
 * clears a 3.2 m wall, and without it the whole horizon is the terrain plane
 * meeting the sky in one straight pale band — the flat cut-out read the quality
 * bar exists to prevent. Doing it in the height field costs nothing: the terrain
 * mesh already samples this, so the ridge is free and its collision comes with it.
 *
 * Physics owns the exact answer — this is the hint props are dropped on.
 */
export function groundYNuketown(x, z) {
  const out = Math.max(Math.abs(x) - NUKE.halfX, Math.abs(z) - NUKE.halfZ);
  if (out <= 0) return 0.02;
  const t = Math.min(1, out / 12);
  const roll = (fbm3(x * 0.05, 7.3, z * 0.05, 3) - 0.5) * 1.2 * t;
  // Starts 9 m beyond the wall and takes 26 m to reach full height, so the near
  // desert still reads as flat ground and the climb is all in the distance.
  const ridge = Math.min(1, Math.max(0, (out - 9) / 26));
  return 0.02 + roll + ridge * ridge * (4.0 + fbm3(x * 0.02, 2.7, z * 0.02, 2) * 8.0);
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
 * One storey of wall with real openings punched through it.
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

/** A low freestanding wall from a `[x, z, ry, len]` row, with its proxy. */
function lowWall(A, key, x, z, ry, len, h, t, masks) {
  A.add(key, BOX(A), LL(IDENT, x, h / 2, z, ry, len, h, t), { masks: masks ?? [0.6, 0.5, 0.3] });
  A.box(A.surfaceOf(key), x, h / 2, z, len, h, t, ry);
  // A capping course, so the top edge catches light instead of reading as a cut.
  A.add(key, BOX(A), LL(IDENT, x, h + 0.05, z, ry, len + 0.12, 0.1, t + 0.12), { masks: [0.85, 0.3, 0.15] });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildGround(A, rng) {
  // ------------------------------------------------------------- desert --
  const S = 190;
  const N = 46;
  const terrain = new THREE.PlaneGeometry(S, S, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setY(i, groundYNuketown(pa.getX(i), pa.getZ(i)) - 0.04);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out) => {
    out[1] = 0.2 + fbm3(x * 0.28, 2.1, z * 0.28, 2) * 0.4;
    out[0] = 0.18;
  });
  A.add('sand', terrain, null);
  A.collideGeo('sand', terrain);
  terrain.dispose();

  // ------------------------------------------------------------- apron --
  // One subdivided plane so grazing light finds something, and one flat
  // collision box under it so the controller never feels the triangles.
  const W = NUKE.halfX * 2;
  const D = NUKE.halfZ * 2;
  const apron = new THREE.PlaneGeometry(W, D, 26, 22);
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
    out[0] = 0.2 + n * 0.26;
    out[1] = 0.12 + n * 0.2;
  });
  A.add('concrete', apron, null);
  A.box('dirt', 0, -0.25, 0, W, 0.5, D);
  apron.dispose();

  // ------------------------------------------------------------ street --
  // The asphalt is a separate flat sheet laid 1 cm over the apron rather than a
  // hole cut in it: two overlapping planes cost one extra draw call, and cutting
  // the apron would put a seam exactly where players spend the whole match.
  const street = new THREE.PlaneGeometry(NUKE.streetHalf * 2, D, 6, 22);
  street.rotateX(-Math.PI / 2);
  const sa = street.getAttribute('position');
  for (let i = 0; i < sa.count; i++) {
    const x = sa.getX(i);
    const z = sa.getZ(i);
    // A shallow camber to the crown, the way a road actually sheds water.
    sa.setY(i, 0.05 + Math.cos((x / NUKE.streetHalf) * H) * 0.035 + (fbm3(x * 0.5, 8.2, z * 0.5, 2) - 0.5) * 0.02);
  }
  street.computeVertexNormals();
  paintMasks(street, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.15;
    out[1] = 0.25 + Math.abs(x / NUKE.streetHalf) * 0.35;
  });
  A.add('asphalt', street, null);
  street.dispose();

  // Kerbs: a 0.14 m step each side. Low enough to walk over, which is what the
  // controller's mantle is for, and the one line that makes a road read as a road.
  for (const sx of [-1, 1]) {
    A.add('concrete_dark', BOX(A), LL(IDENT, sx * (NUKE.streetHalf + 0.7), 0.07, 0, 0, 1.4, 0.14, D), {
      masks: [0.7, 0.4, 0.2],
    });
  }
}

/**
 * The compound wall, with the street left open at both ends.
 *
 * Each side is emitted as spans BETWEEN its openings, so the opening is a real
 * hole rather than a thin panel — the same reason `wallWithHoles` exists. The
 * openings are then parked shut by `MOUTH_BLOCKS`, which the self-test probes.
 */
function buildPerimeter(A, rng) {
  const { halfX, halfZ, wallH, wallT, streetHalf } = NUKE;
  const key = 'concrete_dark';
  const masks = [0.5, 0.55, 0.35];

  // East and west runs: unbroken, full depth.
  for (const sx of [-1, 1]) {
    A.add(key, BOX(A), LL(IDENT, sx * halfX, wallH / 2, 0, 0, wallT, wallH, halfZ * 2 + wallT), { masks });
    A.box('concrete', sx * halfX, wallH / 2, 0, wallT, wallH, halfZ * 2 + wallT);
  }
  // North and south runs: two spans each, with the street mouth between them.
  for (const sz of [-1, 1]) {
    const span = halfX - streetHalf;
    for (const sx of [-1, 1]) {
      const cx = sx * (streetHalf + span / 2);
      A.add(key, BOX(A), LL(IDENT, cx, wallH / 2, sz * halfZ, 0, span, wallH, wallT), { masks });
      A.box('concrete', cx, wallH / 2, sz * halfZ, span, wallH, wallT);
    }
  }
  // A capping course all round, so the wall top is a line and not a cut edge.
  for (const sx of [-1, 1])
    A.add(key, BOX(A), LL(IDENT, sx * halfX, wallH + 0.08, 0, 0, wallT + 0.18, 0.16, halfZ * 2 + wallT), {
      masks: [0.9, 0.3, 0.1],
    });
  for (const sz of [-1, 1]) {
    const span = halfX - streetHalf;
    for (const sx of [-1, 1])
      A.add(key, BOX(A), LL(IDENT, sx * (streetHalf + span / 2), wallH + 0.08, sz * halfZ, 0, span, 0.16, wallT + 0.18), {
        masks: [0.9, 0.3, 0.1],
      });
  }

  // Piers on the mouth jambs — an opening needs an edge or it reads as damage.
  for (const sz of [-1, 1])
    for (const sx of [-1, 1]) {
      A.add(key, BOX(A), LL(IDENT, sx * streetHalf, wallH * 0.6, sz * halfZ, 0, 0.7, wallH * 1.2, 0.7), {
        masks: [0.6, 0.5, 0.3],
      });
      A.box('concrete', sx * streetHalf, wallH * 0.6, sz * halfZ, 0.7, wallH * 1.2, 0.7);
    }

  // The barrier line across each mouth.
  for (const [x, z, ry, len] of MOUTH_BLOCKS) lowWall(A, 'concrete', x, z, ry, len, 1.25, 0.9, [0.6, 0.6, 0.4]);

  // Background masses past the wall. `A.box` is skipped: they are outside the
  // sealed perimeter, so nothing can ever reach them and a proxy would only be
  // BVH the physics has to walk.
  for (const [x, z, w, d, h] of BACKDROP) {
    const gy = groundYNuketown(x, z);
    A.add('concrete_dark', BOX(A), LL(IDENT, x, gy + h / 2, z, 0.3, w, h, d), { masks: [0.4, 0.6, 0.5] });
  }
}

/**
 * One house, built in LOCAL coordinates where +X is toward the street and the
 * house is centred on the origin. The caller supplies the panel matrix that
 * puts it on the map, so the east house is the west one with a half-turn.
 */
function buildHouse(A, rng, spec) {
  /**
   * The panel matrix must be its OWN Matrix4, never the one `LL` hands back.
   * `LL` returns a shared module-level scratch (`kit.js`), so holding its result
   * as `pm` makes every later `LL(pm, …)` compound the house transform into
   * itself — the walls end up 10^13 m from the origin, the map still builds,
   * every self-test still passes, and the houses are simply not on screen.
   */
  const pm = new THREE.Matrix4().makeRotationY(spec.face > 0 ? 0 : Math.PI);
  pm.setPosition(spec.x, 0, spec.z);
  const hw = spec.w / 2;
  const hd = spec.d / 2;
  const { floorH, eaves, ridge } = NUKE;
  const t = 0.32;
  const key = spec.key;

  // ---- slab and first floor ---------------------------------------------
  pbox(A, pm, 'floor_concrete', 0, -0.06, 0, 0, spec.w + 0.5, 0.24, spec.d + 0.5, [0.5, 0.55, 0.35]);

  // The upper floor, minus a stairwell void at the back-north corner. A stair
  // can only land on a platform at its EDGE — a flight rising inside a solid
  // slab would come up through it.
  const voidX = -hw + 2.4; // void spans x < voidX
  const voidZ = -hd + 5.2; // void spans z < voidZ
  pbox(A, pm, 'floor_wood', (voidX + hw) / 2, floorH - 0.1, 0, 0, hw - voidX, 0.2, spec.d, [0.5, 0.5, 0.3]);
  pbox(A, pm, 'floor_wood', (-hw + voidX) / 2, floorH - 0.1, (voidZ + hd) / 2, 0, voidX + hw, 0.2, hd - voidZ, [0.5, 0.5, 0.3]);

  // ---- the four walls ----------------------------------------------------
  const masks = [0.45, 0.5, 0.3];
  const doorH = 2.2;
  const winY = 1.0;
  const winH = 1.4;

  for (const floor of [0, 1]) {
    const y0 = floor * floorH;
    const h = floor === 0 ? floorH : eaves - floorH;

    // Street face (+X). Ground: front door plus a window. First floor: the two
    // windows that make this map — everything below is watched from here.
    const front = floor === 0
      ? [{ u: -1.2, w: 1.3, y: 0, h: doorH }, { u: 3.2, w: 1.8, y: winY, h: winH }]
      : [{ u: -3.4, w: 1.6, y: 0.9, h: winH }, { u: 1.4, w: 1.8, y: 0.9, h: winH }, { u: 5.0, w: 1.4, y: 0.9, h: winH }];
    wallWithHoles(A, pm, key, hw, 0, -H, spec.d, y0, h, t, front, masks);

    // Back face (-X): the alley door, and one upstairs window watching the alley.
    const back = floor === 0
      ? [{ u: 2.0, w: 1.3, y: 0, h: doorH }, { u: -3.6, w: 1.6, y: winY, h: winH }]
      : [{ u: 0.4, w: 1.6, y: 0.9, h: winH }];
    wallWithHoles(A, pm, key, -hw, 0, H, spec.d, y0, h, t, back, masks);

    // The two end faces, one window each, aimed up and down the alleys.
    for (const sz of [-1, 1]) {
      const holes = [{ u: sz * 1.6, w: 1.6, y: floor === 0 ? winY : 0.9, h: winH }];
      wallWithHoles(A, pm, key, 0, sz * hd, sz > 0 ? 0 : Math.PI, spec.w, y0, h, t, holes, masks);
    }
  }

  // ---- the stair ---------------------------------------------------------
  // Publishes its foot in the returned info so the self-test can assert the run
  // -up is clear: a stair blocked by dressing is the one mistake that makes a
  // house's upper floor unreachable, and no screenshot shows it.
  const stairX = -hw + 1.3;
  const stairZ = -hd + 0.6;
  stairRun(A, pm, stairX, 0, stairZ, 1.9, 16, floorH / 16, 0.27, { key: 'concrete', railing: 'right' });

  // ---- gable roof --------------------------------------------------------
  // Two tilted slabs and a stepped gable end. Not reachable, so the collision is
  // three stacked boxes rather than the true wedge — cheaper, and nothing can
  // ever stand on the difference.
  const over = 0.45;
  const rise = ridge - eaves;
  const runX = hw + over;
  const ang = Math.atan2(rise, runX);
  const slabLen = Math.hypot(runX, rise);
  for (const sx of [-1, 1]) {
    A.add('roof_screed', BOX(A),
      LL(pm, sx * runX / 2, eaves + rise / 2, 0, 0, slabLen, 0.24, spec.d + over * 2, 0, -sx * ang),
      { masks: [0.6, 0.45, 0.25] });
  }
  for (let i = 0; i < 3; i++) {
    const f = i / 3;
    const y = eaves + rise * f;
    const w = spec.w * (1 - f) + 0.3;
    A.box('concrete', ...worldOf(pm, 0, y + rise / 6, 0), w, rise / 3, spec.d, ryOf(pm));
  }
  // Gable ends: three stacked boxes standing in for the triangle. At this poly
  // budget the step reads as a chamfer, and a real triangle would need its own
  // geometry rather than the shared unit box.
  for (const sz of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const f = i / 3;
      const w = spec.w * (1 - f);
      pbox(A, pm, key, 0, eaves + rise * f + rise / 6, sz * hd, 0, w, rise / 3, t, [0.5, 0.5, 0.3]);
    }

  // ---- porch -------------------------------------------------------------
  // A flat canopy on two posts over the front door. Overhead only: it is 3 m up
  // and unreachable, so it costs cover nothing and gives the facade a shadow.
  const px = hw + 1.5;
  A.add('frame_white', BOX(A), LL(pm, px, floorH - 0.15, -1.2, 0, 3.4, 0.2, 4.6), { masks: [0.7, 0.35, 0.2] });
  for (const pz of [-3.3, 0.9]) {
    pbox(A, pm, 'frame_white', hw + 2.9, floorH / 2, pz, 0, 0.22, floorH, 0.22, [0.75, 0.3, 0.15]);
  }
  // Two steps up to the threshold.
  for (let i = 0; i < 2; i++)
    pbox(A, pm, 'concrete', hw + 0.6 + i * 0.42, 0.09 + i * 0.09, -1.2, 0, 0.5, 0.18, 2.2, [0.6, 0.5, 0.3]);

  // Copied, not aliased: `worldOf` returns a shared scratch array, so both
  // houses would otherwise hand back the same one and report the same stair.
  return { spec, id: spec.id, stair: [...worldOf(pm, stairX, 0, stairZ - 1.6)] };
}

/** The sign gantry: two poles, a board, and the map's only reason to look up. */
function buildSign(A, rng) {
  const { poleX, poleH, boardY, boardH, boardT } = SIGN;
  for (const sx of [-1, 1]) {
    A.add('steel_frame', BOX(A), LL(IDENT, sx * poleX, poleH / 2, SIGN.z, 0, 0.3, poleH, 0.3), {
      masks: [0.8, 0.45, 0.2],
    });
    A.box('metal', sx * poleX, poleH / 2, SIGN.z, 0.34, poleH, 0.34);
    // A foot, so the pole meets the road instead of ending in it.
    A.add('concrete', BOX(A), LL(IDENT, sx * poleX, 0.16, SIGN.z, 0, 0.8, 0.32, 0.8), { masks: [0.6, 0.5, 0.3] });
  }
  const span = poleX * 2;
  A.add('sign_red', BOX(A), LL(IDENT, 0, boardY + boardH / 2, SIGN.z, 0, span, boardH, boardT), {
    masks: [0.7, 0.4, 0.2],
  });
  A.box('metal', 0, boardY + boardH / 2, SIGN.z, span, boardH, boardT);
  // A band top and bottom: two boxes are the cheapest thing that reads as
  // lettering from 20 m, and lettering is what makes it a sign and not a wall.
  for (const sy of [-1, 1])
    A.add('paint_yellow', BOX_THIN(A),
      LL(IDENT, 0, boardY + boardH / 2 + sy * (boardH / 2 - 0.16), SIGN.z, 0, span * 0.9, 0.16, boardT + 0.06),
      { masks: [0.9, 0.2, 0.1] });
  // The cross-brace under the board, so the span does not read as floating.
  A.add('steel_frame', BOX_THIN(A), LL(IDENT, 0, boardY - 0.12, SIGN.z, 0, span, 0.14, 0.14), {
    masks: [0.8, 0.5, 0.2],
  });
}

/** Everything that is a low wall: yard walls and street barricades. */
function buildWalls(A, rng) {
  for (const [x, z, ry, len] of YARD_WALLS) lowWall(A, 'concrete', x, z, ry, len, 1.2, 0.35);
  for (const [x, z, ry, len] of STREET_BLOCKS) lowWall(A, 'concrete', x, z, ry, len, 1.1, 0.8, [0.65, 0.55, 0.35]);
}

/**
 * The four yard sheds. A box, a shallow mono-pitch roof and a door panel — the
 * silhouette is doing all the work here, so the geometry stops at three parts.
 */
function buildSheds(A, rng) {
  for (const [x, z, w, d, h] of SHEDS) {
    A.add('plaster_white', BOX(A), LL(IDENT, x, h / 2, z, 0, w, h, d), { masks: [0.5, 0.5, 0.35] });
    A.box('concrete', x, h / 2, z, w, h, d);
    // The roof oversails the box by 15 cm and leans 6°, so the shed reads as
    // built rather than extruded, for one extra part.
    A.add('roof_screed', BOX(A), LL(IDENT, x, h + 0.14, z, 0, w + 0.3, 0.18, d + 0.3, 0, 0.1), {
      masks: [0.65, 0.45, 0.25],
    });
    // A door on the face that looks back at the street.
    A.add('wood_dark', BOX_THIN(A),
      LL(IDENT, x - Math.sign(x) * (w / 2 + 0.02), 1.05, z, 0, 0.06, 2.1, 1.0), { masks: [0.6, 0.5, 0.4] });
  }
}

/**
 * Set dressing. Instanced props only, and nothing the brief excludes: no
 * foliage, no vehicles. Every placement is filtered through `free()` so a crate
 * never lands inside a wall the occupancy tests believe is empty.
 */
function dress(A, rng, stairFeet) {
  const free = (x, z, m = 0.5) => {
    if (!isOpenNuketown(x, z, m)) return false;
    // Keep the stair run-ups clear — see the note in `buildHouse`.
    for (const f of stairFeet) if (Math.hypot(x - f[0], z - f[2]) < 2.6) return false;
    return true;
  };

  A.jitter = { rng, yaw: 0.5, scale: 0.06 };

  // Jersey barriers along the sidewalks and at the mouths: the map's most
  // characteristic piece of street furniture and its cheapest cover.
  const jerseys = [
    [-7.9, -12.0, 0], [-7.9, -3.0, 0], [-7.9, 6.0, 0], [-7.9, 14.0, 0],
    [7.9, 12.0, 0], [7.9, 3.0, 0], [7.9, -6.0, 0], [7.9, -14.0, 0],
    [-4.2, -17.6, H], [4.2, -17.6, H], [-4.2, 17.6, H], [4.2, 17.6, H],
    [-20.0, -18.4, H], [20.0, 18.4, H], [-23.6, 13.5, 0], [23.6, -13.5, 0],
  ];
  for (const [x, z, ry] of jerseys) if (free(x, z, 0.9)) A.put('jersey', x, 0.03, z, ry, 1);

  // Crates and pallets in the yards and alleys.
  const crates = [
    [-23.5, -4.5], [-23.5, -3.4], [-24.2, 4.0], [-22.9, 6.5],
    [23.5, 4.5], [23.5, 3.4], [24.2, -4.0], [22.9, -6.5],
    [-9.8, -13.5], [-13.0, -14.5], [-16.5, -13.0], [-20.5, -12.5],
    [9.8, 13.5], [13.0, 14.5], [16.5, 13.0], [20.5, 12.5],
    [-11.5, 10.5], [-15.0, 11.5], [11.5, -10.5], [15.0, -11.5],
    [-2.0, -19.2], [2.4, -19.6], [-2.4, 19.6], [2.0, 19.2],
  ];
  for (const [x, z] of crates)
    if (free(x, z, 0.6))
      A.put(rng.pick(['crate_a', 'crate_b', 'crate_c', 'crate_flat']), x, 0.03, z, rng.float() * 6.283, rng.range(0.92, 1.08));

  for (const [x, z] of [[-19.0, -15.5], [19.0, 15.5], [-24.0, 11.0], [24.0, -11.0], [-6.0, 19.0], [6.0, -19.0]])
    if (free(x, z, 0.7)) A.put('pallet', x, 0.03, z, rng.float() * 6.283, 1);

  // Barrels: the vertical accent in an otherwise very horizontal blockout.
  const barrels = [
    [-9.0, -10.0], [-9.6, -9.2], [-10.4, 5.5], [9.0, 10.0], [9.6, 9.2], [10.4, -5.5],
    [-22.0, -13.5], [22.0, 13.5], [-13.5, 16.5], [13.5, -16.5],
    [-4.8, -10.5], [4.8, 10.5], [-5.4, 11.2], [5.4, -11.2],
    [-23.8, 0.0], [23.8, 0.0], [-18.0, 18.5], [18.0, -18.5],
  ];
  for (const [x, z] of barrels)
    if (free(x, z, 0.5)) A.put(rng.pick(['barrel_rust', 'barrel_blue']), x, 0.03, z, rng.float() * 6.283, rng.range(0.94, 1.06));

  // Tyres and small stuff, all distance-LOD'd by their prototypes.
  for (const [x, z] of [[-21.5, 8.0], [-21.0, 8.6], [21.5, -8.0], [21.0, -8.6], [-7.5, -19.5], [7.5, 19.5]])
    if (free(x, z, 0.4)) A.put(rng.pick(['tyre', 'tyre_small']), x, 0.03, z, rng.float() * 6.283, 1);

  // Sandbag positions at the two mouths — someone held this road once.
  for (const [gx, gz, ry] of [[-4.6, -18.6, 0], [4.6, 18.6, 0]]) {
    for (let i = 0; i < 9; i++) {
      const row = (i / 3) | 0;
      const col = i % 3;
      A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
        gx + Math.cos(ry) * (col - 1) * 0.56, 0.03 + row * 0.17, gz - Math.sin(ry) * (col - 1) * 0.56,
        ry + rng.range(-0.06, 0.06), 1);
    }
  }

  // Litter and cans scattered on the apron. Cheap, and the only thing keeping
  // the concrete from reading as a bare plane at ankle height.
  A.jitter.yaw = 3.14;
  for (let i = 0; i < 46; i++) {
    const x = rng.range(-NUKE.halfX + 1.5, NUKE.halfX - 1.5);
    const z = rng.range(-NUKE.halfZ + 1.5, NUKE.halfZ - 1.5);
    if (!free(x, z, 0.35)) continue;
    A.put(rng.pick(['litter', 'can', 'bottle', 'brick_a', 'brick_b']), x, 0.03, z, rng.float() * 6.283, rng.range(0.8, 1.2));
  }

  A.jitter = null;

  // Street lamps down the sidewalks. Daylight map, so these are silhouette and
  // lamp anchors rather than a lighting budget.
  for (const [x, z, ry] of [[-7.6, -8.5, 0], [7.6, 8.5, Math.PI], [-7.6, 12.0, 0], [7.6, -12.0, Math.PI]]) {
    A.put('lamp_post', x, 0.03, z, ry, 1);
    A.box('metal', x, 1.6, z, 0.24, 3.2, 0.24);
    A.lampAnchors.push({ x: x + Math.sin(ry) * 0.9, y: 4.4, z });
  }
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map's `build`.
 */
export function buildNuketown(A, rng) {
  registerProps(A, rng);

  buildGround(A, rng);
  buildPerimeter(A, rng);
  buildWalls(A, rng);
  buildSheds(A, rng);
  buildSign(A, rng);

  const infos = [];
  for (const h of HOUSES) infos.push(buildHouse(A, rng, h));

  dress(A, rng, infos.map((i) => i.stair));

  return { buildings: infos };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const NUKETOWN_MAP = {
  id: 'nuketown',
  blurb: 'Two houses, one street, thirty seconds between spawns. Upstairs windows watch everything, and everything watches back.',
  size: '51 × 42 m',
  /**
   * LEVEL -> WORLD. A few tenths off the axes so the street, the wall and both
   * houses do not sit parallel to the sun's shadow direction — every mass on
   * this map is a rectangle, and rectangles lit square-on lose one of their two
   * lit faces.
   */
  transform: { yaw: -0.36, tx: 0, tz: 0 },
  /**
   * Tight to the wall plus a skirt. `ai` builds its nav grid over this, and
   * there is no reason to sample cells out on the ridge: the perimeter is
   * sealed, so nothing walkable out there is reachable anyway.
   */
  bounds: [-31, -2, -27, 31, 22, 27],
  spawnPoints: NUKETOWN_SPAWNS,
  standable: standableAtNuketown,
  groundY: groundYNuketown,
  isOpen: isOpenNuketown,
  build: buildNuketown,
};
