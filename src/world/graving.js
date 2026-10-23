import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, stairRun } from './kit.js';
import { registerProps } from './props.js';
import { registerRustProps, CONTAINER } from './rustprops.js';
import { fbm3, paintMasks, patchGeometry, tubeY, polyPrism } from './util.js';

/**
 * WORLD — GRAVING DOCK.
 *
 * A cargo coaster sitting on keel blocks in a drained dry dock, late in the
 * afternoon. 84 x 60 m of shipyard fought over on three levels, and the map's
 * whole idea is that the HIGH GROUND IS THE RIM: every other map puts its
 * overwatch in the middle (a derrick, a manor's windows, a lift core); this one
 * puts the middle six metres DOWN and lets the quay ring look into it.
 *
 *   THE QUAY RING  ±0.0. The north quay, the head quay, the south apron, the
 *                  entrance pier and the caisson gate's deck — one continuous
 *                  loop, the map's high ground, all of it looking into the pit.
 *   THE ALTAR BANK the north side of the dock steps down in sixteen altars to
 *                  the floor, with a 3 m broad altar halfway. Walkable along its
 *                  whole 66 m: the pit is never more than a walk away.
 *   THE PIT        −6.4. A pit at each end of the ship, a 4.8 m gap along the
 *                  hull's north side and a 3 m gap along its south side, and
 *                  under the hull itself a 2 m walk-through on keel blocks —
 *                  the one place on the map the rim cannot see into.
 *   THE SHIP       −0.8. Its deck sits just under the quay, so it is a place
 *                  to fight across rather than a perch to hold: the forecastle
 *                  at +0.6 is the highest thing in the dock and still below a
 *                  standing player's eye on the rim. Four ways up — a long
 *                  flying brow off the broad altar, a short brow off the south
 *                  apron, and a scaffold stair tower in each end pit.
 *
 * GAMEPLAY OVER REALISM, AND WHERE IT WON:
 *   - The altars are 0.4 m, not a real dock's 0.6–1.0 m. Bots path over a step
 *     of 0.45 m at most (`ai/nav.js` maxStep) and a player walks up 0.42 m
 *     without mantling, so a real altar would wall bots out of half the map.
 *     The treads are 0.9 m, so every step spans more than one 0.8 m nav cell.
 *   - Altars on the NORTH side only; the south wall is sheer with two stairs
 *     cut into it. Lopsided on purpose — it is how you know which way you face.
 *   - 6.4 m deep, not 10–12: the floor stays inside rifle range of the rim.
 *   - 2.0 m keel blocks, so the undercroft is a standing lane, not a crawl.
 *   - The deck is held under the rim and the deckhouse roof has no stair.
 *   - 70 m of dock for a 46 m ship, so each end is a 12 m fighting pit.
 *   - The sea edge is a 2.6 m palisade: anything lower is a vault (players
 *     mantle 1.85 m) into water with no floor under it.
 *   - No timber shores across the north gap. A strut that crosses a lane at
 *     shin-to-head height is either a visible beam players walk through or a
 *     collision strip bots cannot step over; the south ones span wall to hull
 *     above head height, where they are scenery.
 *
 * WHAT BOTS SEE. `ai/nav.js` samples ONE floor per cell, the topmost. So the
 * undercroft is a player route: a bot reads the deck above it and paths over
 * the ship instead. Nothing in the lanes is allowed to be collidable and
 * overhead (no scaffold boards, no shores) — a plank over a lane is a floor the
 * nav grid believes in, and the lane under it vanishes for every bot.
 *
 * LAYOUT NOTES
 *   Authored in LEVEL space, origin at the map centre, north at −Z, the dock
 *   running east–west with its head at the west and the sea gate at the east.
 *   Heights are relative to the quay. The vertical routes are stairs only, as
 *   everywhere else in the game.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export const DOCK = {
  /** The perimeter: yard walls north, south and west, the sea palisade east. */
  x0: -44,
  x1: 40,
  z0: -30,
  z1: 30,
  quayY: 0,
  floorY: -6.4,
  /** Everything structural is poured down to here. */
  baseY: -7.4,
  /** The dock floor: both pits, both gaps and the ground under the hull. */
  floor: { x0: -36, x1: 34, z0: -4.4, z1: 13.4 },
  /**
   * The altar bank: two flights of eight 0.4 m altars either side of a 3 m
   * broad altar. Tread 7 of the upper flight IS the broad altar.
   */
  bank: { x0: -36, x1: 30, zTop: -20, rise: 0.4, tread: 0.9, broadZ0: -13.7, broadZ1: -10.7, broadY: -3.2 },
  /** The caisson gate: a steel box across the dock entrance, decked at quay level. */
  caisson: { x0: 34, x1: 38 },
  /** Where the quays stop and the sea palisade stands. */
  seaX: 40,
  fenceH: 2.6,
  wallH: 3.2,
  /** The west yard gate, sealed by a container parked across it. */
  gate: { z0: 17.5, z1: 23.5 },
};

/**
 * The ship. Plan points are the hull's outline at the deck, `[x, z]`, bow
 * west. The bow is blunt — a 2.4 m flat at x = −24.6 — so the bow tower has
 * something to land against.
 */
export const SHIP = {
  x0: -24.6,
  x1: 22,
  z0: 0.4,
  z1: 10.4,
  zc: 5.4,
  bottomY: -4.4,
  /** The boot-topping line: anti-fouling red below, grey above. */
  bootY: -2.6,
  deckY: -0.8,
  bulwarkH: 1.0,
  /** Forecastle: the raised bow deck, bow to `xBreak`. */
  fcY: 0.6,
  xBreak: -16,
  /** Hatch coamings, `[x0, x1]`, spanning `hatchZ`, 1.0 m tall. */
  hatches: [[-14, -4], [-1, 9]],
  hatchZ: [2.4, 8.4],
  house: { x0: 13, x1: 20, z0: 1.8, z1: 9.0, h: 2.8 },
};
/** The two stairs from the main deck up to the forecastle. */
export const FC_STAIR = { steps: 7, run: 0.45 };
export const HULL_PLAN = [
  [-20, 0.4], [22, 0.4], [22, 10.4], [-20, 10.4],
  [-23, 9.2], [-24.6, 6.6], [-24.6, 4.2], [-23, 1.6],
];

/**
 * The two gangways. `x` is the centreline, the run goes along +Z from `z0`
 * (at `y0`) to `z1` (at `y1`). The flying brow is the ONLY direct route from
 * the north side onto the ship, and it is 11 m long and in the open.
 */
export const BROWS = {
  flying: { x: -2.5, w: 1.3, z0: -10.7, z1: 0.4, y0: -3.2, y1: -0.8 },
  aft: { x: 11.0, w: 1.3, z0: 10.4, z1: 13.4, y0: -0.8, y1: 0 },
};

/**
 * The scaffold stair towers, one in each end pit. Each is a switchback of two
 * flights whose top landing meets the hull: `hullX` is the face it lands
 * against, `dir` the way the tower extends from it (−1 west, +1 east), `top`
 * the deck it reaches.
 */
const TOWER_RISE = 0.275;
const TOWER_RUN = 0.3;
const towerSteps = (top) => Math.max(1, Math.round((top - DOCK.floorY) / 2 / TOWER_RISE));
function towerSpec(id, hullX, dir, top) {
  const steps = towerSteps(top);
  const L = steps * TOWER_RUN;
  const landing = 1.4;
  const mid = 1.6;
  const xa = hullX + dir * landing; // top landing's outer edge = flight 1's foot
  const xb = xa + dir * L; // flight 1's top = mid landing's inner edge
  const xc = xb + dir * mid; // mid landing's outer edge
  return {
    id, hullX, dir, top, steps, L, landing, mid,
    xa, xb, xc,
    x0: Math.min(hullX, xc),
    x1: Math.max(hullX, xc),
    z0: SHIP.zc - 1.5,
    z1: SHIP.zc + 1.5,
  };
}
export const TOWERS = [
  towerSpec('bow', SHIP.x0, -1, SHIP.fcY),
  towerSpec('stern', SHIP.x1, 1, SHIP.deckY),
];

/**
 * The two dock stairs cut into the south wall, each a single straight flight
 * in a 1.4 m slot. `foot` is on the dock floor in an end pit, the flight
 * climbs along X to `top` at quay level.
 */
const SLOT_D = 1.4;
const SLOT_STEPS = Math.round((DOCK.quayY - DOCK.floorY) / 0.275);
const SLOT_LEN = SLOT_STEPS * 0.3;
export const DOCK_STAIRS = [
  { id: 'sw', foot: -31.0, top: -31.0 + SLOT_LEN, dir: 1 },
  { id: 'se', foot: 30.0, top: 30.0 - SLOT_LEN, dir: -1 },
].map((s) => ({ ...s, x0: Math.min(s.foot, s.top), x1: Math.max(s.foot, s.top), z0: DOCK.floor.z1, z1: DOCK.floor.z1 + SLOT_D }));

/**
 * The buildings. `h` is the eaves / parapet line. Only the pump house, the
 * fitting shop and the dockmaster's office are enterable; the welding shack
 * is a solid box against the north wall.
 */
export const STRUCTURES = [
  // Set forward on the apron so the strip behind it is a yard the pit
  // cannot see into — the pump-yard spawns live there.
  { id: 'pump', x: -26.5, z: 21.25, w: 12, d: 7.5, h: 6.0 },
  { id: 'shop', x: 17, z: 24.75, w: 26, d: 6.5, h: 7.0 },
  { id: 'office', x: -40.5, z: -5, w: 5, d: 6, h: 3.2 },
  { id: 'shack', x: 11, z: -28.0, w: 6, d: 3.4, h: 2.8 },
];

/**
 * The two portal cranes. `x` is the portal centre; `rails` the two rail
 * lines (Z) its legs stand on, 4 m apart along X; `jib` the point its jib
 * reaches, `[x, y, z]`. Painted yellow: the map's one accent.
 */
export const CRANES = [
  { id: 'c1', x: -12, rails: [-28.5, -22.5], jib: [-12, 18.5, 3.0] },
  { id: 'c2', x: 28, rails: [15.6, 19.8], jib: [17.5, 17.0, 6.6] },
];
export const CRANE_LEG = 0.7;
const craneLegs = (c) => {
  const out = [];
  for (const dx of [-2, 2]) for (const z of c.rails) out.push([c.x + dx, z]);
  return out;
};

/**
 * Cover on open ground: `[x, z, w, d, h, kind]`, axis-aligned, standing on
 * whatever `groundY` says is under it. `kind` picks the look and the surface:
 * `plates` steel plate stacks, `timber` stacked baulks, `blocks` spare keel
 * blocks, `crates` a crate stack, `skip` a skip bin, `sluice` a sluice-valve
 * housing, `capstan` a capstan (w is its diameter).
 *
 * The rhythm is the point: every long lane on the map — both quays, the broad
 * altar, the north gap — gets something to stand behind every 8–14 m.
 */
export const COVER = [
  // north quay
  [-32, -25, 4.0, 2.4, 1.1, 'plates'],
  [-24, -24, 5.0, 1.2, 1.0, 'timber'],
  [-4, -23, 1.4, 1.4, 1.5, 'blocks'],
  [2, -26.5, 4.0, 2.4, 1.1, 'plates'],
  [22, -25, 4.0, 2.4, 1.3, 'plates'],
  // entrance pier and head quay
  [36, -12, 1.6, 1.6, 1.4, 'crates'],
  // the broad altar: sluice housings and capstans
  [-32, -13.0, 1.6, 1.2, 1.3, 'sluice'],
  [2, -13.0, 1.6, 1.2, 1.3, 'sluice'],
  [18, -13.0, 1.6, 1.2, 1.3, 'sluice'],
  [-24, -12.2, 1.2, 1.2, 0.9, 'capstan'],
  [-8, -12.2, 1.2, 1.2, 0.9, 'capstan'],
  [10, -12.2, 1.2, 1.2, 0.9, 'capstan'],
  [26, -12.2, 1.2, 1.2, 0.9, 'capstan'],
  // the upper and lower altars: spare blocks, each on ONE tread
  [-28, -17.75, 1.4, 0.8, 1.2, 'blocks'],
  [-14, -16.85, 1.4, 0.8, 1.2, 'blocks'],
  [8, -17.75, 1.4, 0.8, 1.2, 'blocks'],
  [22, -15.95, 1.4, 0.8, 1.2, 'blocks'],
  [-20, -8.45, 1.4, 0.8, 1.2, 'blocks'],
  [-9, -6.65, 1.4, 0.8, 1.2, 'blocks'],
  [12, -8.45, 1.4, 0.8, 1.2, 'blocks'],
  [24, -6.65, 1.4, 0.8, 1.2, 'blocks'],
  // the north gap, between the bank foot and the staging
  [-15, -3.7, 1.4, 1.4, 1.5, 'blocks'],
  [-7, -3.7, 1.4, 1.4, 1.5, 'blocks'],
  [6, -3.7, 1.4, 1.4, 1.5, 'blocks'],
  [17, -3.7, 1.4, 1.4, 1.5, 'blocks'],
  // the end pits
  [-34.6, -2.6, 1.4, 1.4, 1.5, 'blocks'],
  [-27.5, 11.4, 1.6, 1.2, 1.4, 'blocks'],
  [31.6, -2.5, 1.4, 1.4, 1.4, 'blocks'],
  [31.8, 4.5, 1.8, 3.4, 1.4, 'skip'],
  // the south apron
  [-5.5, 18.8, 2.4, 1.4, 1.2, 'timber'],
  [10, 18, 2.2, 1.6, 1.8, 'crates'],
  // laydown, between the pump house and the shop
  [-2, 24, 4.0, 2.4, 1.1, 'plates'],
];

/** Cable drums (the `spool` prop): `[x, z]`. Cover on the south apron. */
export const DRUMS = [[0, 17.6], [-17, 22.5], [1.5, 28.2], [-22, 15.4]];

/**
 * Containers on the quays, `[x, z, ry, protos]` with ry 0 (long along X) or
 * π/2 and one prototype per tier. The first is parked across the yard gate —
 * the Rust trick for an opening that must not lead anywhere.
 *
 * THE TWO-HIGH STACKS ARE SIGHTLINE BREAKERS, and they are why the quay ring
 * plays as a ring rather than as four shooting galleries. Without them every
 * rim zone could see most of the others across the open pit (half of all
 * zone-to-zone pairs, measured in the built level) and the spawn director had
 * three safe zones out of nine. They stagger — back of the north quay, front
 * of it, front of the south apron — so each quay is an S-bend, not a lane.
 */
const H = Math.PI / 2;
export const BOXES = [
  [-42.6, 20.5, H, ['cont_blue']],
  [32, -26, 0, ['cont_red', 'cont_sand']],
  [-10, 25.5, 0, ['cont_sand']],
  [-6.5, -26.6, H, ['cont_green', 'cont_blue']], // north quay, back
  [16, -21.6, 0, ['cont_blue', 'cont_red']], // north quay, front
  [31.5, -12, H, ['cont_sand', 'cont_green']], // the pier's west edge
  [-12, 15.9, 0, ['cont_red', 'cont_green']], // south apron, west
  [17.5, 15.9, 0, ['cont_green', 'cont_sand']], // south apron, east
  [-40, 14.5, H, ['cont_sand', 'cont_red']], // head quay
  [-35, 26.5, H, ['cont_blue', 'cont_green']], // closes the pump yard's west end
  [35.5, 18.8, 0, ['cont_red', 'cont_blue']], // screens the south-east yard
];

/**
 * Deck cargo: containers on the hatch covers, `[x, z, protos]`, long along X.
 * This is what makes the ship a DIVIDER: the deck sits under the rim, so on
 * its own it hides nothing, and the two quays duelled across 36 m of open pit
 * from end to end. Stacked, the cargo leaves four windows across the dock —
 * the bow, midships where the flying brow lands, the deckhouse, the stern —
 * and the cross-dock fight happens through those. Each stack sits on a 1 m
 * coaming with 2 m of hatch cover either side of it, which is a ledge, not a
 * way up: 2.6 m of container is beyond a 1.85 m mantle.
 */
export const DECK_CARGO = [
  [-9, 4.0, ['cont_blue', 'cont_red']],
  [-9, 6.8, ['cont_green']],
  [4, 4.0, ['cont_sand']],
  [4, 6.8, ['cont_red', 'cont_sand']],
];

/** Flood masts — the quay lighting: `[x, z, ry]`, ry the way the head faces. */
export const MASTS = [
  [-34, -21.2, Math.PI],
  [8, -21.2, Math.PI],
  [37.5, -6.0, 1.87],
  [-37.4, 19.6, -1.1],
  [-4, 15.2, 0],
  [36, 15.2, 0.4],
];

/**
 * Spawn points: `[x, z, turn, zone]`, aimed at the ship, `turn` a hand
 * adjustment. Nobody spawns on the bank or the deck: those are places you go.
 *
 * INDEX 0 is the boot/capture spawn — the head quay, looking east down the
 * full length of the dock.
 */
const AIM = [-1, SHIP.zc];
const facing = (x, z, turn = 0) => Math.atan2(x - AIM[0], z - AIM[1]) + turn;
export const GRAVING_SPAWNS = [
  [-40, 3, null, 'head'], // FROZEN — boot spawn, set below
  [-40, -14, 0.2, 'head'],
  [-41, 10, -0.2, 'head'],
  [-42.5, -11, 0.3, 'head'],

  [-28, -27, 0, 'north-quay-west'],
  [-20, -27.5, 0, 'north-quay-west'],
  [-34, -22, 0.2, 'north-quay-west'],
  [-18, -22, 0, 'north-quay-west'],

  [4, -22.5, 0, 'north-quay-east'],
  [17, -25.0, 0, 'north-quay-east'],
  [26, -28, -0.2, 'north-quay-east'],

  [34.5, -16.5, 0, 'pier'],
  [36.5, -8.5, 0.2, 'pier'],
  [37.5, -15, -0.2, 'pier'],

  [-34, 1, 0, 'head-pit'],
  [-33.5, 9, 0, 'head-pit'],
  [-28, -1.8, 0.2, 'head-pit'],

  [30, 1, 0, 'stern-pit'],
  [31, 8.5, 0, 'stern-pit'],
  [26, -2, -0.2, 'stern-pit'],

  [-31, 27.4, 0, 'pump-yard'],
  [-26, 27.0, 0, 'pump-yard'],
  [-22, 28.0, 0.2, 'pump-yard'],

  [-14, 22.5, 0, 'laydown'],
  [-5, 27.5, 0, 'laydown'],
  [-17, 27.5, 0.2, 'laydown'],

  [6, 17, 0, 'shop-apron'],
  [12.5, 19.2, 0, 'shop-apron'],
  [22, 18.5, -0.2, 'shop-apron'],

  [34, 25, 0, 'se-yard'],
  [37.5, 22.5, 0, 'se-yard'],
  [32, 28.4, 0.2, 'se-yard'],
].map(([x, z, turn, zone], i) => [x, z, i === 0 ? -Math.PI / 2 : facing(x, z, turn), zone]);

/* ─────────────────────────────────────────────────────────────────────────── */
/* occupancy — what `spawns`, `ai` and the minimap ask about the map            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Solid footprints as `[x0, z0, x1, z1]`, built once from the tables above. */
const BLOCKERS = (() => {
  const out = [];
  for (const s of STRUCTURES) out.push([s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  out.push([SHIP.x0, SHIP.z0, SHIP.x1, SHIP.z1]);
  for (const t of TOWERS) out.push([t.x0, t.z0, t.x1, t.z1]);
  for (const c of CRANES)
    for (const [x, z] of craneLegs(c)) out.push([x - CRANE_LEG / 2, z - CRANE_LEG / 2, x + CRANE_LEG / 2, z + CRANE_LEG / 2]);
  for (const [x, z, w, d] of COVER) out.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
  for (const [x, z] of DRUMS) out.push([x - 0.85, z - 0.85, x + 0.85, z + 0.85]);
  for (const [x, z, ry] of BOXES) {
    const hx = (ry === 0 ? CONTAINER.l : CONTAINER.w) / 2;
    const hz = (ry === 0 ? CONTAINER.w : CONTAINER.l) / 2;
    out.push([x - hx, z - hz, x + hx, z + hz]);
  }
  for (const [x, z] of MASTS) out.push([x - 0.25, z - 0.25, x + 0.25, z + 0.25]);
  return out;
})();

/** Every solid footprint, `[label, x0, z0, x1, z1]` — what the self-test reads. */
export function gravingSolids() {
  const out = [];
  for (const s of STRUCTURES) out.push([s.id, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
  out.push(['ship', SHIP.x0, SHIP.z0, SHIP.x1, SHIP.z1]);
  for (const t of TOWERS) out.push([`tower-${t.id}`, t.x0, t.z0, t.x1, t.z1]);
  for (const c of CRANES)
    for (const [x, z] of craneLegs(c))
      out.push([`${c.id}-leg(${x},${z})`, x - CRANE_LEG / 2, z - CRANE_LEG / 2, x + CRANE_LEG / 2, z + CRANE_LEG / 2]);
  for (const [x, z, w, d, , kind] of COVER) out.push([`${kind}(${x},${z})`, x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
  for (const [x, z] of DRUMS) out.push([`drum(${x},${z})`, x - 0.85, z - 0.85, x + 0.85, z + 0.85]);
  for (const [x, z, ry, p] of BOXES) {
    const hx = (ry === 0 ? CONTAINER.l : CONTAINER.w) / 2;
    const hz = (ry === 0 ? CONTAINER.w : CONTAINER.l) / 2;
    out.push([`${p[0]}(${x},${z})`, x - hx, z - hz, x + hx, z + hz]);
  }
  for (const [x, z] of MASTS) out.push([`mast(${x},${z})`, x - 0.25, z - 0.25, x + 0.25, z + 0.25]);
  return out;
}

/** True inside (or within `m` of) anything solid standing on the ground. */
export function inSolidGraving(x, z, m = 0.3) {
  for (let i = 0; i < BLOCKERS.length; i++) {
    const b = BLOCKERS[i];
    if (x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true;
  }
  return false;
}

/** The water between the caisson and the quay heads — no floor under it. */
const inNotch = (x, z, m = 0) =>
  x > DOCK.caisson.x1 - m && z > DOCK.floor.z0 - m && z < DOCK.floor.z1 + m;

/** Inside the yard walls and the sea palisade, with `m` of margin. */
const insideYard = (x, z, m) =>
  x > DOCK.x0 + m && x < DOCK.seaX - m && z > DOCK.z0 + m && z < DOCK.z1 - m && !inNotch(x, z, m);

/** Can a character stand here? The cheap first filter spawns apply. */
export function standableAtGraving(x, z, margin = 0.55) {
  if (!insideYard(x, z, 0.8 + margin)) return false;
  return !inSolidGraving(x, z, margin);
}

/** True where a character can stand outdoors — what the minimap draws as floor. */
export function isOpenGraving(x, z, m = 0.3) {
  if (!insideYard(x, z, 0.6)) return false;
  return !inSolidGraving(x, z, m);
}

/** Height of the altar bank at `z` (inside its X span). */
export function bankY(z) {
  const B = DOCK.bank;
  if (z < B.zTop) return DOCK.quayY;
  if (z < B.broadZ0) return -B.rise * (Math.floor((z - B.zTop) / B.tread) + 1);
  if (z < B.broadZ1) return B.broadY;
  if (z < DOCK.floor.z0) return B.broadY - B.rise * (Math.floor((z - B.broadZ1) / B.tread) + 1);
  return DOCK.floorY;
}

/**
 * Analytic floor height — the quay, the bank, the pit and the dock stairs.
 * The ship is NOT answered here: the ground under the hull is the dock floor,
 * which is where anything dropped there actually lands. The sea answers its
 * surface so the function is finite out to the horizon.
 */
export function groundYGraving(x, z) {
  const F = DOCK.floor;
  if (x > DOCK.seaX || inNotch(x, z)) return -1.6;
  if (x >= F.x0 && x <= F.x1 && z >= F.z0 && z <= F.z1) return DOCK.floorY;
  const B = DOCK.bank;
  if (x >= B.x0 && x <= B.x1 && z >= B.zTop && z < F.z0) return bankY(z);
  for (const s of DOCK_STAIRS) {
    if (x >= s.x0 && x <= s.x1 && z > s.z0 && z <= s.z1) {
      const t = Math.abs(x - s.foot) / SLOT_LEN;
      return DOCK.floorY + (DOCK.quayY - DOCK.floorY) * Math.min(1, t);
    }
  }
  return DOCK.quayY;
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

/** A solid block, drawn and collided from the same numbers. */
function block(A, key, x0, y0, z0, x1, y1, z1, masks, box = BOX) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  A.add(key, box(A), LL(IDENT, cx, cy, cz, 0, w, h, d), { masks: masks ?? [0.5, 0.5, 0.3] });
  A.box(A.surfaceOf(key), cx, cy, cz, w, h, d);
}

/**
 * One storey of wall with real openings punched through it — Rust's helper.
 * `holes` are `[{ u, w, y, h }]` in wall-local coordinates.
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

/** A horizontal deck: merged slab, collision proxy, optional railing. */
function deck(A, key, cx, y, cz, w, d, opts = {}) {
  const t = opts.t ?? 0.22;
  A.add(key, BOX(A), LL(IDENT, cx, y - t / 2, cz, 0, w, t, d), { masks: opts.masks ?? [0.6, 0.5, 0.3] });
  A.box(A.surfaceOf(key), cx, y - t / 2, cz, w, t, d);
  if (opts.rails) railing(A, cx, y, cz, w, d, opts.rails, opts.railH ?? 1.06);
}

/** One straight run of handrail: two bars, posts, ONE collision slab. */
function railRun(A, x0, z0, x1, z1, y, h = 1.06, key = 'metal_rust') {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.15) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  for (const yy of [y + h, y + h * 0.52]) {
    A.add(key, BOX_THIN(A), LL(IDENT, mx, yy, mz, ry, len, 0.055, 0.055), { masks: [0.9, 0.45, 0.05] });
  }
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    A.add(key, BOX_THIN(A), LL(IDENT, x0 + ((x1 - x0) * i) / n, y + h / 2, z0 + ((z1 - z0) * i) / n, 0, 0.06, h, 0.06),
      { masks: [0.9, 0.5, 0.1] });
  }
  A.box('metal', mx, y + h * 0.55, mz, len, h * 1.1, 0.1, ry);
}

/** Handrail around a deck; `sides` any of `nsew` (n = −Z). */
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

/** A level-space panel matrix a stair flight can be composed onto. */
function panel(x, y, z, ry) {
  _quat.setFromAxisAngle(_up, ry);
  _pos.set(x, y, z);
  _scl.set(1, 1, 1);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

/** A flight from (x, y, z) up to `top`, climbing the way `ry` points. */
function flight(A, x, y, z, ry, top, w = 1.3, opts = {}) {
  const rise = opts.rise ?? 0.275;
  const run = opts.run ?? 0.3;
  const steps = opts.steps ?? Math.max(1, Math.round((top - y) / rise));
  stairRun(A, panel(x, y, z, ry), 0, 0, 0, w, steps, (top - y) / steps, run, {
    key: opts.key ?? 'steel_grate',
    railing: opts.railing ?? true,
    stringer: opts.stringer !== false,
  });
  const len = steps * run;
  return { top, len, x: x + Math.sin(ry) * len, z: z + Math.cos(ry) * len };
}

/**
 * A slab along the segment P→Q, its centre `inset` metres INBOARD — toward
 * the ship's centreline — so a positive inset tucks a bulwark inside the hull
 * line and a negative one stands a strake proud of it. `collide` false for
 * trim that only exists to be looked at.
 */
const SHIP_MID = [-1, 5.4];
function edgeWall(A, key, p, q, y0, h, t, inset = 0, masks, collide = true) {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const ry = Math.atan2(-dz, dx);
  const mx = (p[0] + q[0]) / 2;
  const mz = (p[1] + q[1]) / 2;
  let nx = dz / len;
  let nz = -dx / len;
  if (nx * (SHIP_MID[0] - mx) + nz * (SHIP_MID[1] - mz) < 0) {
    nx = -nx;
    nz = -nz;
  }
  const cx = mx + nx * inset;
  const cz = mz + nz * inset;
  A.add(key, BOX(A), LL(IDENT, cx, y0 + h / 2, cz, ry, len, h, t), { masks: masks ?? [0.7, 0.5, 0.3] });
  if (collide) A.box(A.surfaceOf(key), cx, y0 + h / 2, cz, len, h, t, ry);
}

/** A plan outline `[x, z]` as a +Y prism from y0 to y1, merged under `key`. */
function prism(A, key, plan, y0, y1, masks) {
  // polyPrism takes [x, y] in the shape plane and maps shape-y to −Z.
  const g = polyPrism(plan.map(([x, z]) => [x, -z]), y1 - y0);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    out[0] = masks?.[0] ?? 0.6;
    out[1] = (masks?.[1] ?? 0.5) + fbm3(x * 0.3, y * 0.6, z * 0.3, 2) * 0.25;
    out[2] = masks?.[2] ?? 0.3;
  });
  A.addOnce(key, g, LL(IDENT, 0, y0, 0));
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the build                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * The yard outside the walls, the sea, and the far shore. Visual only: the
 * perimeter is sealed, so nothing out here carries collision.
 */
function buildSurroundings(A, rng) {
  // The yard beyond the walls: three strips that stop at the wall line, so
  // nothing outside ever pokes up through the pit.
  const W = 0.4;
  for (const [x0, z0, x1, z1] of [
    [-160, -120, DOCK.seaX, DOCK.z0 - W],
    [-160, DOCK.z1 + W, DOCK.seaX, 120],
    [-160, DOCK.z0 - W, DOCK.x0 - W, DOCK.z1 + W],
  ]) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / 8), Math.ceil((z1 - z0) / 8));
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, -0.04, (z0 + z1) / 2);
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      out[0] = 0.15;
      out[1] = 0.25 + fbm3(x * 0.15, 1.7, z * 0.15, 2) * 0.4;
    });
    A.addOnce('yard_slab', g, null);
  }

  // the sea: one sheet from the caisson out to the horizon
  const sea = new THREE.PlaneGeometry(220, 260, 4, 4);
  sea.rotateX(-Math.PI / 2);
  A.addOnce('pool_water', sea, LL(IDENT, DOCK.caisson.x1 + 110, -1.6, 0), { masks: [0.1, 0.1, 0] });

  // Shipyard sheds and a far breakwater: three planes of depth past every
  // wall, so no edge of the map ends in sky.
  const sheds = [
    [-20, -44, 30, 16, 14, 'corrugated'],
    [16, -42, 24, 12, 10, 'metal_blue'],
    [-62, -8, 14, 34, 12, 'corrugated'],
    [-60, 26, 16, 22, 9, 'brick_red'],
    [-14, 42, 34, 14, 12, 'corrugated'],
    [24, 41, 22, 12, 8, 'metal_green'],
  ];
  for (const [x, z, w, d, h, key] of sheds) {
    A.add(key, BOX(A), LL(IDENT, x, h / 2 - 0.1, z, 0, w, h, d), { masks: [0.5, 0.5, 0.35] });
    A.add('roof_screed', BOX(A), LL(IDENT, x, h + 0.1, z, 0, w + 0.4, 0.3, d + 0.4), { masks: [0.6, 0.5, 0.3] });
  }
  // a far gantry crane over the next berth — a silhouette, nothing more
  for (const z of [-58, -46]) {
    for (const x of [44, 70]) strut(A, 'paint_yellow', x, -1.6, z, x, 24, z, 1.0, [0.6, 0.5, 0.3]);
  }
  strut(A, 'paint_yellow', 40, 24.5, -52, 76, 24.5, -52, 1.4, [0.6, 0.5, 0.3]);
  // the breakwater across the harbour mouth
  for (let i = 0; i < 9; i++) {
    const x = 90 + i * 4;
    const z = -40 + i * 11 + rng.range(-1, 1);
    A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, x, -0.6, z, rng.range(-0.3, 0.3), 9, 2.4, 6), { masks: [0.4, 0.7, 0.5] });
  }
}

/**
 * The quays, the dock walls, the altar bank and the floor. Every block is
 * poured from `baseY` up, so the dock-facing faces are real walls, and every
 * block carries its own collision box.
 */
function buildDock(A, rng) {
  const D = DOCK;
  const F = D.floor;
  const B = D.bank;
  const base = D.baseY;
  const top = 0.3; // quay surfacing

  /** A quay block: dark dock wall below, light surfacing on top. */
  const quay = (x0, z0, x1, z1) => {
    block(A, 'concrete_dark', x0, base, z0, x1, -top, z1, [0.4, 0.75, 0.5]);
    block(A, 'concrete', x0, -top, z0, x1, D.quayY, z1, [0.45, 0.55, 0.35], BOX_SOFT);
  };

  quay(D.x0, D.z0, D.seaX, B.zTop); // north quay
  quay(D.x0, B.zTop, F.x0, D.z1); // head quay
  quay(B.x1, B.zTop, D.seaX, F.z0); // entrance pier
  // the south quay, with the two dock stairs cut into its face
  quay(F.x0, F.z1 + SLOT_D, D.seaX, D.z1);
  const strips = [F.x0];
  for (const s of [...DOCK_STAIRS].sort((a, b) => a.x0 - b.x0)) strips.push(s.x0, s.x1);
  strips.push(D.seaX);
  for (let i = 0; i < strips.length; i += 2) quay(strips[i], F.z1, strips[i + 1], F.z1 + SLOT_D);

  // the dock floor
  block(A, 'concrete_dark', F.x0, base, F.z0, F.x1, D.floorY, F.z1, [0.35, 0.85, 0.6]);
  // a drain channel down the centreline, under the keel — the dock's own datum
  A.add('steel_grate', BOX_THIN(A), LL(IDENT, (F.x0 + F.x1) / 2, D.floorY + 0.01, SHIP.zc + 1.6, 0, F.x1 - F.x0 - 1, 0.02, 0.5), {
    masks: [0.7, 0.8, 0.4],
  });

  // the altar bank: one block per tread, each poured from the base
  const treads = [];
  for (let i = 0; i < 7; i++) treads.push([B.zTop + i * B.tread, B.zTop + (i + 1) * B.tread, -B.rise * (i + 1)]);
  treads.push([B.broadZ0, B.broadZ1, B.broadY]);
  for (let j = 0; j < 7; j++) treads.push([B.broadZ1 + j * B.tread, B.broadZ1 + (j + 1) * B.tread, B.broadY - B.rise * (j + 1)]);
  for (const [z0, z1, y] of treads) {
    block(A, 'concrete_dark', B.x0, base, z0, B.x1, y - 0.12, z1, [0.4, 0.75, 0.5], BOX_THIN);
    // the altar's coping: a lighter nosing so every step reads at range
    A.add('concrete', BOX_SOFT(A), LL(IDENT, (B.x0 + B.x1) / 2, y - 0.06, (z0 + z1) / 2, 0, B.x1 - B.x0, 0.12, z1 - z0), {
      masks: [0.55, 0.6, 0.35],
    });
    A.box('concrete', (B.x0 + B.x1) / 2, y - 0.06, (z0 + z1) / 2, B.x1 - B.x0, 0.12, z1 - z0);
  }

  // the caisson: a steel box across the entrance, decked at quay level
  const C = D.caisson;
  block(A, 'metal_rust', C.x0, base, F.z0, C.x1, -0.25, F.z1, [0.7, 0.6, 0.4]);
  block(A, 'steel_grate', C.x0, -0.25, F.z0, C.x1, D.quayY, F.z1, [0.7, 0.5, 0.3], BOX_THIN);
  for (let z = F.z0 + 1.5; z < F.z1 - 0.5; z += 3.0) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, C.x0 - 0.06, -3.2, z, 0, 0.12, 6.0, 0.3), { masks: [0.8, 0.5, 0.3] });
  }

  // the quay edge: a yellow stripe along every edge you can fall from
  const stripe = (x0, z0, x1, z1) =>
    A.add('paint_yellow', BOX_THIN(A), LL(IDENT, (x0 + x1) / 2, D.quayY + 0.008, (z0 + z1) / 2, 0, Math.max(0.22, x1 - x0), 0.016, Math.max(0.22, z1 - z0)), {
      masks: [0.7, 0.6, 0.2],
    });
  stripe(B.x0, B.zTop - 0.15, B.x1, B.zTop - 0.15);
  stripe(F.x0 - 0.15, B.zTop, F.x0 - 0.15, F.z1);
  stripe(B.x1, F.z0 - 0.15, C.x0, F.z0 - 0.15);
  stripe(C.x0 + 0.15, F.z0, C.x0 + 0.15, F.z1);
  for (let i = 0; i < strips.length; i += 2) stripe(strips[i], F.z1 + 0.15, strips[i + 1], F.z1 + 0.15);

  // the dock stairs, each in its slot, foot on the floor
  for (const s of DOCK_STAIRS) {
    const ry = s.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    flight(A, s.foot, D.floorY, F.z1 + SLOT_D / 2, ry, D.quayY, SLOT_D - 0.1, {
      // the rail goes on the open, pit side: local +X is north for the
      // east-climbing flight and south for the west-climbing one
      key: 'concrete', railing: s.dir > 0 ? 'right' : 'left', stringer: true, steps: SLOT_STEPS,
    });
  }

  // stains: water left on the floor, rust run down the walls
  for (let i = 0; i < 22; i++) {
    const x = rng.range(F.x0 + 2, F.x1 - 2);
    const z = rng.range(F.z0 + 1, F.z1 - 1);
    A.addOnce('pool_water', patchGeometry(rng, rng.range(0.6, 2.2), { lobes: 9, wobble: 0.5 }),
      LL(IDENT, x, D.floorY + 0.02, z, rng.float() * 6.283, 1, 1, rng.range(0.5, 1)), { masks: [0.05, 0.3, 0.2] });
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.range(F.x0 + 1, F.x1 - 1);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, x, -3.4, F.z1 - 0.01, 0, rng.range(0.25, 0.7), rng.range(2.0, 5.2), 0.01), {
      masks: [0.1, 0.9, 0.5],
    });
  }

  // bollards along the south quay and the pier
  for (const [x, z] of [[-20, 14.2], [-6, 14.2], [6, 14.2], [20, 14.2], [32, -5.0], [37, -5.0], [-36.8, -16]]) {
    A.addOnce('metal_dark', tubeY(0.22, 0.7, { radial: 10 }), LL(IDENT, x, D.quayY, z), { masks: [0.8, 0.5, 0.3] });
    A.addOnce('metal_dark', tubeY(0.3, 0.1, { radial: 10 }), LL(IDENT, x, D.quayY + 0.62, z), { masks: [0.85, 0.4, 0.2] });
    A.box('metal', x, 0.35, z, 0.44, 0.7, 0.44);
  }
}

/**
 * The perimeter: brick yard walls north, south and west (with the gate), and
 * a steel palisade along the sea — bars you can see the water through and
 * cannot climb.
 */
function buildPerimeter(A, rng) {
  const D = DOCK;
  const h = D.wallH;
  const t = 0.35;
  wallWithHoles(A, 'brick_red', (D.x0 + D.seaX) / 2, D.z0 - t / 2, 0, D.seaX - D.x0, 0, h, t, [], { masks: [0.5, 0.55, 0.3] });
  wallWithHoles(A, 'brick_red', (D.x0 + D.seaX) / 2, D.z1 + t / 2, 0, D.seaX - D.x0, 0, h, t, [], { masks: [0.5, 0.55, 0.3] });
  const gz = (D.gate.z0 + D.gate.z1) / 2;
  wallWithHoles(A, 'brick_red', D.x0 - t / 2, 0, Math.PI / 2, D.z1 - D.z0, 0, h, t,
    [{ u: -gz, w: D.gate.z1 - D.gate.z0, y: 0, h }], { masks: [0.5, 0.55, 0.3] });
  // coping
  for (const [cx, cz, ry, len] of [
    [(D.x0 + D.seaX) / 2, D.z0 - t / 2, 0, D.seaX - D.x0],
    [(D.x0 + D.seaX) / 2, D.z1 + t / 2, 0, D.seaX - D.x0],
  ]) A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, h + 0.06, cz, ry, len, 0.12, t + 0.1), { masks: [0.7, 0.4, 0.2] });
  // gate posts
  for (const z of [D.gate.z0, D.gate.z1]) block(A, 'concrete', D.x0 - 0.5, 0, z - 0.25, D.x0 + 0.1, h + 0.6, z + 0.25);

  // the sea palisade
  const runs = [
    [[D.seaX, D.z0], [D.seaX, D.floor.z0]],
    [[D.seaX, D.floor.z0], [D.caisson.x1, D.floor.z0]],
    [[D.caisson.x1, D.floor.z0], [D.caisson.x1, D.floor.z1]],
    [[D.caisson.x1, D.floor.z1], [D.seaX, D.floor.z1]],
    [[D.seaX, D.floor.z1], [D.seaX, D.z1]],
  ];
  const fh = D.fenceH;
  for (const [[x0, z0], [x1, z1]] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    const n = Math.max(1, Math.round(len / 0.24));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      A.add('steel_frame', BOX_THIN(A), LL(IDENT, x0 + (x1 - x0) * u, fh / 2, z0 + (z1 - z0) * u, ry, 0.035, fh, 0.035), {
        masks: [0.8, 0.45, 0.2],
      });
    }
    const posts = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= posts; i++) {
      const u = i / posts;
      A.add('steel_frame', BOX(A), LL(IDENT, x0 + (x1 - x0) * u, fh / 2 + 0.05, z0 + (z1 - z0) * u, ry, 0.1, fh + 0.1, 0.1), {
        masks: [0.75, 0.5, 0.3],
      });
    }
    for (const yy of [0.15, fh * 0.5, fh - 0.05]) {
      A.add('steel_frame', BOX_THIN(A), LL(IDENT, (x0 + x1) / 2, yy, (z0 + z1) / 2, ry, len, 0.06, 0.07), {
        masks: [0.8, 0.45, 0.2],
      });
    }
    A.box('metal', (x0 + x1) / 2, fh / 2, (z0 + z1) / 2, len, fh, 0.1, ry);
  }
}

/** The ship: hull, decks, bulwarks, hatches, deckhouse, keel blocks, rudder. */
function buildShip(A, rng) {
  const S = SHIP;
  const fcPlan = [
    [S.xBreak, S.z0], [S.xBreak, S.z1], [-20, S.z1], [-23, 9.2],
    [-24.6, 6.6], [-24.6, 4.2], [-23, 1.6], [-20, S.z0],
  ];

  // ---------------------------------------------------------------- hull --
  prism(A, 'barn_red', HULL_PLAN, S.bottomY, S.bootY, [0.6, 0.65, 0.35]);
  prism(A, 'metal_dark', HULL_PLAN, S.bootY, S.deckY, [0.6, 0.55, 0.3]);
  prism(A, 'metal_dark', fcPlan, S.deckY, S.fcY, [0.6, 0.5, 0.3]);
  // the white boot-topping line and the deck-edge rubbing strake
  for (const [y, key, th] of [[S.bootY, 'frame_white', 0.14], [S.deckY - 0.35, 'metal_rust', 0.1]]) {
    for (let i = 0; i < HULL_PLAN.length; i++) {
      const p = HULL_PLAN[i];
      const q = HULL_PLAN[(i + 1) % HULL_PLAN.length];
      edgeWall(A, key, p, q, y - th / 2, th, 0.08, -0.03, [0.8, 0.4, 0.1], false);
    }
  }

  // Collision: the rectangle aft, rotated boxes along the bow diagonals,
  // and the forecastle carried up to its own deck.
  A.box('metal', (S.xBreak + S.x1) / 2, (S.bottomY + S.deckY) / 2, S.zc, S.x1 - S.xBreak, S.deckY - S.bottomY, S.z1 - S.z0);
  A.box('metal', (-20 + S.xBreak) / 2, (S.bottomY + S.fcY) / 2, S.zc, S.xBreak + 20, S.fcY - S.bottomY, S.z1 - S.z0);
  A.box('metal', -21.5, (S.bottomY + S.fcY) / 2, S.zc, 3, S.fcY - S.bottomY, 7.6);
  A.box('metal', -23.8, (S.bottomY + S.fcY) / 2, S.zc, 1.6, S.fcY - S.bottomY, 2.4);
  // The bow's four raked faces: a 0.8 m slab inboard of each, so the
  // triangles the two rectangles above leave uncovered are solid too.
  for (const [p, q] of [[[-20, S.z0], [-23, 1.6]], [[-23, 1.6], [-24.6, 4.2]], [[-24.6, 6.6], [-23, 9.2]], [[-23, 9.2], [-20, S.z1]]]) {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    let nx = dz / len;
    let nz = -dx / len;
    if (nx * (SHIP_MID[0] - mx) + nz * (SHIP_MID[1] - mz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    A.box('metal', mx + nx * 0.4, (S.bottomY + S.fcY) / 2, mz + nz * 0.4, len, S.fcY - S.bottomY, 0.8, Math.atan2(-dz, dx));
  }

  // ---------------------------------------------------------------- decks --
  // Painted plating, not bare steel: bare metal mirrors a low sky and the
  // whole deck reads as a white sheet from the rim.
  A.add('metal_green', BOX_THIN(A), LL(IDENT, (S.xBreak + S.x1) / 2, S.deckY + 0.01, S.zc, 0, S.x1 - S.xBreak - 0.2, 0.02, S.z1 - S.z0 - 0.2), {
    masks: [0.5, 0.7, 0.45],
  });
  const fcDeck = polyPrism(fcPlan.map(([x, z]) => [x, -z]), 0.02);
  paintMasks(fcDeck, (x, y, z, nx, ny, nz, out) => { out[0] = 0.5; out[1] = 0.65; out[2] = 0.4; });
  A.addOnce('metal_green', fcDeck, LL(IDENT, 0, S.fcY, 0));

  // --------------------------------------------------------- bulwarks --
  // Main deck: along both sides from the break to the transom, and across the
  // transom, with gaps where the brows and the stern tower land.
  const bh = S.bulwarkH;
  const fly = BROWS.flying;
  const aft = BROWS.aft;
  const gap = 0.75;
  const bw = (p, q, y, h) => edgeWall(A, 'metal_dark', p, q, y, h, 0.16, 0.08, [0.75, 0.5, 0.3]);
  bw([S.xBreak, S.z0], [fly.x - gap, S.z0], S.deckY, bh);
  bw([fly.x + gap, S.z0], [S.x1, S.z0], S.deckY, bh);
  bw([S.xBreak, S.z1], [aft.x - gap, S.z1], S.deckY, bh);
  bw([aft.x + gap, S.z1], [S.x1, S.z1], S.deckY, bh);
  // the stern tower's landing comes in over the transom, in its lane B
  const sternGap = [S.zc + 0.0, S.zc + 1.6];
  bw([S.x1, S.z1], [S.x1, sternGap[1]], S.deckY, bh);
  bw([S.x1, sternGap[0]], [S.x1, S.z0], S.deckY, bh);
  // forecastle: round the bow, with the tower's gap at the bow flat
  const fcb = 0.9;
  const bowGap = [S.zc + 0.0, S.zc + 1.6];
  const bowPts = [[S.xBreak, S.z1], [-20, S.z1], [-23, 9.2], [-24.6, 6.6]];
  for (let i = 0; i < bowPts.length - 1; i++) bw(bowPts[i], bowPts[i + 1], S.fcY, fcb);
  bw([-24.6, 6.6], [-24.6, bowGap[1]], S.fcY, fcb);
  bw([-24.6, bowGap[0]], [-24.6, 4.2], S.fcY, fcb);
  const bowPts2 = [[-24.6, 4.2], [-23, 1.6], [-20, S.z0], [S.xBreak, S.z0]];
  for (let i = 0; i < bowPts2.length - 1; i++) bw(bowPts2[i], bowPts2[i + 1], S.fcY, fcb);
  // the break of the forecastle: a rail across, open where its two stairs land
  const fcStairs = [1.3, 9.5];
  railRun(A, S.xBreak - 0.06, 1.9, S.xBreak - 0.06, 8.9, S.fcY);
  // 0.2 m risers on a 0.45 m going: shallow enough that two of them never
  // land inside one 0.8 m nav cell, so bots can climb onto the forecastle
  // (`ai/nav.js` refuses any cell-to-cell rise over 0.45 m).
  for (const z of fcStairs) {
    flight(A, S.xBreak + FC_STAIR.steps * FC_STAIR.run, S.deckY, z, -Math.PI / 2, S.fcY, 1.0,
      { steps: FC_STAIR.steps, run: FC_STAIR.run, stringer: true });
  }

  // ---------------------------------------------------------- hatches --
  const [hz0, hz1] = S.hatchZ;
  for (const [x0, x1] of S.hatches) {
    block(A, 'metal_dark', x0, S.deckY, hz0, x1, S.deckY + 0.86, hz1, [0.7, 0.55, 0.3]);
    // hatch boards: three panels, slightly proud, with the gaps between them
    const n = 3;
    const pw = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      A.add('metal_blue', BOX(A), LL(IDENT, x0 + pw * (i + 0.5), S.deckY + 0.93, (hz0 + hz1) / 2, 0, pw - 0.08, 0.14, hz1 - hz0 - 0.1), {
        masks: [0.8, 0.5, 0.25],
      });
    }
    A.box('metal', (x0 + x1) / 2, S.deckY + 0.93, (hz0 + hz1) / 2, x1 - x0, 0.14, hz1 - hz0);
  }
  for (const [x, z, protos] of DECK_CARGO) stack(A, x, S.deckY + 1.0, z, 0, protos);

  // -------------------------------------------------------- deckhouse --
  const Hs = S.house;
  const hx = (Hs.x0 + Hs.x1) / 2;
  const hzc = (Hs.z0 + Hs.z1) / 2;
  const hw = Hs.x1 - Hs.x0;
  const hd = Hs.z1 - Hs.z0;
  const ht = 0.2;
  const door = { w: 1.2, y: 0, h: 2.1 };
  const win = (u) => ({ u, w: 1.3, y: 1.0, h: 0.9 });
  wallWithHoles(A, 'frame_white', hx, Hs.z0, 0, hw, S.deckY, Hs.h, ht, [{ u: 0.5, ...door }, win(-2.2), win(2.4)]);
  wallWithHoles(A, 'frame_white', hx, Hs.z1, 0, hw, S.deckY, Hs.h, ht, [{ u: 0.5, ...door }, win(-2.2), win(2.4)]);
  wallWithHoles(A, 'frame_white', Hs.x1, hzc, Math.PI / 2, hd, S.deckY, Hs.h, ht, [{ u: 0, ...door }]);
  wallWithHoles(A, 'frame_white', Hs.x0, hzc, Math.PI / 2, hd, S.deckY, Hs.h, ht, [win(-1.8), win(1.8)]);
  deck(A, 'roof_screed', hx, S.deckY + Hs.h + 0.22, hzc, hw + 0.3, hd + 0.3, { t: 0.22 });
  railing(A, hx, S.deckY + Hs.h + 0.22, hzc, hw + 0.2, hd + 0.2, 'nsew', 0.9);
  // funnel and the mast that carries the ship's lights
  A.addOnce('metal_dark', tubeY(0.95, 2.8, { radial: 14, taper: 0.88 }), LL(IDENT, hx + 1.4, S.deckY + Hs.h + 0.2, hzc), {
    masks: [0.7, 0.55, 0.3],
  });
  A.addOnce('barn_red', tubeY(0.86, 0.5, { radial: 14 }), LL(IDENT, hx + 1.4, S.deckY + Hs.h + 2.6, hzc), {
    masks: [0.75, 0.45, 0.2],
  });
  strut(A, 'steel_frame', hx - 2.4, S.deckY + Hs.h + 0.2, hzc, hx - 2.4, S.deckY + Hs.h + 5.4, hzc, 0.16);
  strut(A, 'steel_frame', hx - 2.4, S.deckY + Hs.h + 4.2, hzc - 1.2, hx - 2.4, S.deckY + Hs.h + 4.2, hzc + 1.2, 0.08);
  // inside: a mess table, benches, a locker
  A.put('table', hx - 0.6, S.deckY, hzc, 0, 1.1);
  A.put('chair', hx - 1.6, S.deckY, hzc + 0.6, 0.4, 1);
  A.put('chair', hx + 0.4, S.deckY, hzc - 0.7, 2.8, 1);
  A.put('cabinet', Hs.x0 + 0.5, S.deckY, Hs.z1 - 0.6, Math.PI / 2, 1);
  A.interiorLights.push({ x: hx, y: S.deckY + Hs.h - 0.3, z: hzc });

  // ----------------------------------------------------- keel blocks --
  const fy = DOCK.floorY;
  for (let x = -21; x <= 19; x += 1.8) block(A, 'wood_dark', x - 0.4, fy, S.zc - 0.6, x + 0.4, S.bottomY, S.zc + 0.6, [0.6, 0.65, 0.5]);
  for (let x = -19.8; x <= 19; x += 3.6) {
    for (const z of [2.2, 8.6]) block(A, 'wood_dark', x - 0.4, fy, z - 0.5, x + 0.4, S.bottomY, z + 0.5, [0.6, 0.65, 0.5]);
  }
  // bulbs under the hull: the undercroft is lit, just barely
  for (const x of [-12, 0, 12]) A.interiorLights.push({ x, y: S.bottomY - 0.3, z: S.zc - 1.6 });

  // -------------------------------------------------- rudder, propeller --
  // The rudder hangs under the stern overhang and stands 0.6 m proud of it;
  // the propeller turns just forward of it, clear of the last keel block.
  block(A, 'barn_red', S.x1 - 0.6, -5.8, S.zc - 0.22, S.x1 + 0.6, S.bottomY, S.zc + 0.22, [0.7, 0.6, 0.3]);
  strut(A, 'steel', S.x1 - 2.4, -5.0, S.zc, S.x1 - 0.7, -5.0, S.zc, 0.32);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    strut(A, 'steel', S.x1 - 1.4, -5.0, S.zc, S.x1 - 1.4, -5.0 + Math.cos(a) * 1.15, S.zc + Math.sin(a) * 1.15, 0.22, [0.8, 0.4, 0.2]);
  }

  // ------------------------------------------------- deck dressing --
  A.put('spool', -20.5, S.fcY, 3.6, 0.3, 0.9);
  A.put('spool', -20.5, S.fcY, 7.2, 1.2, 0.9);
  A.put('generator', -19.0, S.fcY, S.zc, Math.PI / 2, 0.9);
  for (const [x, z] of [[-14.6, 1.3], [-3.6, 9.4], [11.6, 1.2]]) A.put('barrel_rust', x, S.deckY, z, rng.float() * 6.283, 1);
  // staging bays along both sides of the hull: open frames, no boards —
  // see the header for why nothing overhead in a lane may collide
  for (const x of [-16, -6, 4, 14]) {
    for (const [zi, zo] of [[S.z0 - 0.1, S.z0 - 1.2], [S.z1 + 0.1, S.z1 + 1.2]]) {
      for (const xx of [x, x + 3]) {
        for (const zz of [zi, zo]) {
          strut(A, 'steel_frame', xx, fy, zz, xx, S.deckY + 0.4, zz, 0.06, [0.8, 0.45, 0.2]);
          A.box('metal', xx, fy + 1.0, zz, 0.12, 2.0, 0.12);
        }
      }
      for (const yy of [-4.4, -2.4]) {
        strut(A, 'steel_frame', x, yy, zo, x + 3, yy, zo, 0.05, [0.8, 0.45, 0.2]);
        strut(A, 'steel_frame', x, yy, zi, x, yy, zo, 0.05, [0.8, 0.45, 0.2]);
        strut(A, 'steel_frame', x + 3, yy, zi, x + 3, yy, zo, 0.05, [0.8, 0.45, 0.2]);
      }
      strut(A, 'steel_frame', x, fy + 0.2, zo, x + 3, -2.6, zo, 0.04, [0.85, 0.45, 0.2]);
    }
  }
  // the south shores: wall to hull, above head height, scenery
  for (const x of [-18, -9, 0, 9, 18]) {
    strut(A, 'wood_dark', x, -2.7, S.z1 + 0.05, x, -2.7, DOCK.floor.z1 - 0.05, 0.3, [0.65, 0.6, 0.4]);
  }
}

/** The two gangways: stepped planks on stringers, with rails. */
function buildBrows(A, rng) {
  for (const b of Object.values(BROWS)) {
    const len = b.z1 - b.z0;
    const steps = Math.max(1, Math.round((b.y1 - b.y0) / 0.2));
    stairRun(A, panel(b.x, b.y0, b.z0, 0), 0, 0, 0, b.w, steps, (b.y1 - b.y0) / steps, len / steps, {
      key: 'steel_grate', railing: true, stringer: false,
    });
    for (const s of [-1, 1]) {
      strut(A, 'steel_frame', b.x + s * (b.w / 2 + 0.04), b.y0 - 0.12, b.z0, b.x + s * (b.w / 2 + 0.04), b.y1 - 0.12, b.z1, 0.12, [0.75, 0.5, 0.3]);
    }
  }
  // the flying brow is long enough to want carrying: a trestle on the altars
  const f = BROWS.flying;
  const tz = -5.0;
  const ty = f.y0 + ((tz - f.z0) / (f.z1 - f.z0)) * (f.y1 - f.y0) - 0.2;
  const by = bankY(tz);
  for (const s of [-1, 1]) {
    strut(A, 'steel_frame', f.x + s * 0.75, by, tz, f.x + s * 0.7, ty, tz, 0.14, [0.75, 0.5, 0.3]);
  }
  strut(A, 'steel_frame', f.x - 0.75, ty, tz, f.x + 0.75, ty, tz, 0.12);
}

/** The scaffold stair towers in the end pits. */
function buildTowers(A, rng) {
  const fy = DOCK.floorY;
  for (const t of TOWERS) {
    const mid = fy + (t.top - fy) / 2;
    const zA = SHIP.zc - 0.8; // flight 1 lane
    const zB = SHIP.zc + 0.8; // flight 2 lane
    const away = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    const toward = -away;
    flight(A, t.xa, fy, zA, away, mid, 1.3, { steps: t.steps, stringer: false });
    flight(A, t.xb, mid, zB, toward, t.top, 1.3, { steps: t.steps, stringer: false });
    // landings
    const midX = (t.xb + t.xc) / 2;
    deck(A, 'steel_grate', midX, mid, SHIP.zc, t.mid, 3.0, { t: 0.16 });
    const topX = (t.hullX + t.xa) / 2;
    deck(A, 'steel_grate', topX, t.top, SHIP.zc, t.landing, 3.0, { t: 0.16 });
    // rails: the mid landing on its three outer sides; the top landing on
    // its outer side and across the lane flight 1 rises under
    const xo = t.xc - t.dir * 0.05;
    railRun(A, xo, t.z0 + 0.05, xo, t.z1 - 0.05, mid);
    railRun(A, t.xb, t.z0 + 0.05, t.xc, t.z0 + 0.05, mid);
    railRun(A, t.xb, t.z1 - 0.05, t.xc, t.z1 - 0.05, mid);
    railRun(A, t.hullX, t.z0 + 0.05, t.xa, t.z0 + 0.05, t.top);
    railRun(A, t.hullX, t.z1 - 0.05, t.xa, t.z1 - 0.05, t.top);
    railRun(A, t.xa, t.z0 + 0.05, t.xa, SHIP.zc - 0.05, t.top);
    // the frame: four standards and ledgers every lift
    const sx = [t.x0 + 0.06, t.x1 - 0.06, t.xa];
    const sz = [t.z0 - 0.04, t.z1 + 0.04];
    for (const x of sx) {
      if (Math.abs(x - t.hullX) < 0.2) continue; // the hull carries this side
      for (const z of sz) {
        strut(A, 'steel_frame', x, fy, z, x, t.top + 1.1, z, 0.07, [0.8, 0.45, 0.2]);
        A.box('metal', x, fy + 1.0, z, 0.14, 2.0, 0.14);
      }
    }
    for (let y = fy + 2.0; y < t.top + 1.0; y += 2.0) {
      for (const z of sz) strut(A, 'steel_frame', t.x0, y, z, t.x1, y, z, 0.05, [0.8, 0.45, 0.2]);
      for (const x of sx) strut(A, 'steel_frame', x, y, t.z0, x, y, t.z1, 0.05, [0.8, 0.45, 0.2]);
    }
    for (const z of sz) strut(A, 'steel_frame', t.x0, fy + 0.1, z, t.x1, t.top - 0.2, z, 0.04, [0.85, 0.45, 0.2]);
  }
}

/**
 * A portal crane: four legs on two rails, a machinery house, a cab and a
 * lattice jib. Collision on the legs only, to head height — everything above
 * is out of reach and a proxy up there is a bullet sponge nobody can see.
 */
function buildCrane(A, rng, c) {
  const legs = craneLegs(c);
  const portalY = 7.6;
  const zc = (c.rails[0] + c.rails[1]) / 2;
  const gz = c.rails[1] - c.rails[0];
  for (const [x, z] of legs) {
    strut(A, 'paint_yellow', x, 0, z, x + (c.x - x) * 0.18, portalY, z + (zc - z) * 0.12, CRANE_LEG, [0.7, 0.5, 0.3]);
    A.box('metal', x, 1.1, z, CRANE_LEG, 2.2, CRANE_LEG);
    // bogie on the rail
    A.add('metal_dark', BOX(A), LL(IDENT, x, 0.3, z, 0, 1.6, 0.6, 0.9), { masks: [0.8, 0.5, 0.3] });
  }
  // portal frame
  for (const z of c.rails) {
    const zz = z + (zc - z) * 0.12;
    strut(A, 'paint_yellow', c.x - 1.64, portalY, zz, c.x + 1.64, portalY, zz, 0.6);
    strut(A, 'paint_yellow', c.x - 1.9, 2.2, z, c.x + 1.9, 2.2, z, 0.3);
  }
  for (const dx of [-1.64, 1.64]) strut(A, 'paint_yellow', c.x + dx, portalY, c.rails[0] + gz * 0.12, c.x + dx, portalY, c.rails[1] - gz * 0.12, 0.6);
  // turntable, machinery house, cab
  A.addOnce('metal_dark', tubeY(1.6, 0.6, { radial: 16 }), LL(IDENT, c.x, portalY + 0.3, zc), { masks: [0.8, 0.5, 0.3] });
  const jx = c.jib[0] - c.x;
  const jz = c.jib[2] - zc;
  const yaw = Math.atan2(-jz, jx); // the jib's heading, as a Y rotation
  A.add('paint_yellow', BOX(A), LL(IDENT, c.x - Math.cos(yaw) * 0.8, portalY + 2.3, zc + Math.sin(yaw) * 0.8, yaw, 4.6, 3.2, 3.4), {
    masks: [0.7, 0.5, 0.3],
  });
  A.add('roof_screed', BOX(A), LL(IDENT, c.x - Math.cos(yaw) * 0.8, portalY + 4.0, zc + Math.sin(yaw) * 0.8, yaw, 4.8, 0.2, 3.6), {
    masks: [0.7, 0.5, 0.3],
  });
  // counterweight
  A.add('concrete_dark', BOX(A), LL(IDENT, c.x - Math.cos(yaw) * 3.6, portalY + 1.6, zc + Math.sin(yaw) * 3.6, yaw, 1.2, 2.4, 3.0), {
    masks: [0.6, 0.6, 0.4],
  });
  // cab, hung off the front of the house, glazed toward the jib
  const cabX = c.x + Math.cos(yaw) * 2.0;
  const cabZ = zc - Math.sin(yaw) * 2.0 + Math.cos(yaw) * 1.1;
  A.add('paint_yellow', BOX(A), LL(IDENT, cabX, portalY + 2.0, cabZ, yaw, 1.6, 2.0, 1.4), { masks: [0.7, 0.5, 0.3] });
  A.add('window_glow', BOX_THIN(A), LL(IDENT, cabX + Math.cos(yaw) * 0.81, portalY + 2.3, cabZ - Math.sin(yaw) * 0.81, yaw, 0.02, 0.9, 1.1), {
    masks: [0, 0, 0],
  });
  // A-frame and the lattice jib: two chords and a zig-zag
  const pivot = [c.x + Math.cos(yaw) * 1.6, portalY + 3.8, zc - Math.sin(yaw) * 1.6];
  const apex = [c.x - Math.cos(yaw) * 0.6, portalY + 9.0, zc + Math.sin(yaw) * 0.6];
  strut(A, 'paint_yellow', pivot[0], pivot[1], pivot[2], apex[0], apex[1], apex[2], 0.36);
  strut(A, 'paint_yellow', c.x - Math.cos(yaw) * 2.6, portalY + 4.0, zc + Math.sin(yaw) * 2.6, apex[0], apex[1], apex[2], 0.3);
  const [tx, ty, tz] = c.jib;
  const px = Math.sin(yaw) * 0.5;
  const pz = Math.cos(yaw) * 0.5;
  for (const s of [-1, 1]) {
    strut(A, 'paint_yellow', pivot[0] + s * px, pivot[1], pivot[2] + s * pz, tx + s * px * 0.4, ty, tz + s * pz * 0.4, 0.22);
  }
  strut(A, 'paint_yellow', pivot[0], pivot[1] + 1.1, pivot[2], tx, ty + 0.3, tz, 0.18);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const b = (i + 1) / n;
    const lerp = (u, p0, p1) => p0 + (p1 - p0) * u;
    strut(A, 'paint_yellow',
      lerp(a, pivot[0], tx), lerp(a, pivot[1], ty), lerp(a, pivot[2], tz),
      lerp(b, pivot[0], tx), lerp(b, pivot[1] + 1.1, ty + 0.3), lerp(b, pivot[2], tz), 0.08, [0.8, 0.45, 0.2]);
  }
  // luffing ties from the apex, and the hook hanging off the tip
  strut(A, 'steel', apex[0], apex[1], apex[2], tx, ty + 0.3, tz, 0.06, [0.9, 0.4, 0.1]);
  strut(A, 'steel', tx, ty, tz, tx, ty - 7.5, tz, 0.04, [0.9, 0.4, 0.1]);
  A.add('metal_dark', BOX(A), LL(IDENT, tx, ty - 7.9, tz, yaw, 0.5, 0.7, 0.4), { masks: [0.85, 0.5, 0.2] });
  // floods on the cab roof: the anchor sits where the light leaves them
  A.add('lamp_lens', BOX_THIN(A), LL(IDENT, cabX + Math.cos(yaw) * 0.5, portalY + 3.15, cabZ - Math.sin(yaw) * 0.5, yaw, 0.3, 0.25, 0.6), {
    masks: [0, 0, 0],
  });
  A.lampAnchors.push({ x: cabX + Math.cos(yaw) * 0.7, y: portalY + 3.0, z: cabZ - Math.sin(yaw) * 0.7 });
  // rails along the quay
  for (const z of c.rails) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, c.x, DOCK.quayY + 0.02, z, 0, 32, 0.04, 0.12), { masks: [0.85, 0.5, 0.2] });
  }
}

/** The pump house: brick, three doors, the dock's pumps inside. */
function buildPumpHouse(A, rng, s) {
  const { x, z, w, d, h } = s;
  const t = 0.3;
  const door = (u) => ({ u, w: 1.6, y: 0, h: 2.4 });
  const win = (u) => ({ u, w: 1.8, y: 1.4, h: 1.6 });
  wallWithHoles(A, 'brick_red', x, z - d / 2, 0, w, 0, h, t, [door(-2), win(2.6), win(-4.6)]);
  wallWithHoles(A, 'brick_red', x, z + d / 2, 0, w, 0, h, t, [win(-2.4), win(2.4)]);
  wallWithHoles(A, 'brick_red', x + w / 2, z, Math.PI / 2, d, 0, h, t, [door(0.8)]);
  wallWithHoles(A, 'brick_red', x - w / 2, z, Math.PI / 2, d, 0, h, t, [door(-0.8)]);
  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.05, z, 0, w - t, 0.1, d - t), { masks: [0.4, 0.6, 0.45] });
  A.box('concrete', x, 0.05, z, w - t, 0.1, d - t);
  deck(A, 'roof_screed', x, h, z, w + 0.4, d + 0.4, { t: 0.3 });
  for (const [cx, cz, ry, len] of [[x, z - d / 2 - 0.1, 0, w + 0.5], [x, z + d / 2 + 0.1, 0, w + 0.5], [x - w / 2 - 0.1, z, Math.PI / 2, d + 0.5], [x + w / 2 + 0.1, z, Math.PI / 2, d + 0.5]]) {
    A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, h + 0.35, cz, ry, len, 0.7, 0.3), { masks: [0.6, 0.5, 0.3] });
  }
  A.put('generator', x - 2.5, 0.1, z + 1.2, 0, 1.1);
  A.put('valve', x + 1.8, 0.1, z + 1.8, 0.4, 1.1);
  A.put('valve', x + 3.6, 0.1, z + 1.6, -0.9, 1.0);
  A.put('tank_horiz', x + 2.0, 0.1, z - 1.0, Math.PI / 2, 0.8);
  A.interiorLights.push({ x: x - 2, y: h - 0.6, z });
  A.interiorLights.push({ x: x + 3, y: h - 0.6, z });
}

/** The fitting shop: a steel shed, three roller bays onto the apron. */
function buildShop(A, rng, s) {
  const { x, z, w, d, h } = s;
  const t = 0.18;
  const bay = (u) => ({ u, w: 3.4, y: 0, h: 3.8 });
  const door = (u) => ({ u, w: 1.4, y: 0, h: 2.3 });
  wallWithHoles(A, 'corrugated', x, z - d / 2, 0, w, 0, h, t, [bay(-8.5), bay(0), bay(8.5)]);
  wallWithHoles(A, 'corrugated', x, z + d / 2, 0, w, 0, h, t, [door(-5), door(7)]);
  wallWithHoles(A, 'corrugated', x + w / 2, z, Math.PI / 2, d, 0, h, t, [door(0)]);
  wallWithHoles(A, 'corrugated', x - w / 2, z, Math.PI / 2, d, 0, h, t, [door(0)]);
  A.add('floor_concrete', BOX(A), LL(IDENT, x, 0.05, z, 0, w - t, 0.1, d - t), { masks: [0.4, 0.6, 0.45] });
  A.box('concrete', x, 0.05, z, w - t, 0.1, d - t);
  deck(A, 'corrugated', x, h, z, w + 0.6, d + 0.6, { t: 0.2 });
  // portal frames inside, every bay
  for (let i = 0; i <= 6; i++) {
    const px = x - w / 2 + 0.3 + (i / 6) * (w - 0.6);
    for (const pz of [z - d / 2 + 0.25, z + d / 2 - 0.25]) strut(A, 'steel_frame', px, 0, pz, px, h - 0.2, pz, 0.22);
    strut(A, 'steel_frame', px, h - 0.4, z - d / 2 + 0.25, px, h - 0.4, z + d / 2 - 0.25, 0.2);
  }
  // roller curtains, rolled up over each bay
  for (const u of [-8.5, 0, 8.5]) {
    A.add('metal_rust', BOX(A), LL(IDENT, x + u, 4.1, z - d / 2 + 0.3, 0, 3.6, 0.45, 0.45), { masks: [0.85, 0.5, 0.2] });
  }
  // benches, racks and stock: interior cover that does not block the bays
  for (const [bx, bz, ry] of [[x - 10, z + 1.6, 0], [x - 4, z + 1.8, 0], [x + 4, z + 1.8, 0], [x + 10.5, z + 1.6, 0]]) {
    A.put('table', bx, 0.1, bz, ry, 1.2);
    A.box('wood', bx, 0.45, bz, 1.6, 0.9, 0.8);
  }
  for (const bx of [x - 12, x - 1, x + 12]) {
    A.put('shelf', bx, 0.1, z + d / 2 - 0.6, 0, 1.1);
  }
  A.put('spool', x - 6.5, 0.1, z - 0.6, 0.3, 0.9);
  A.put('pipe_stack', x + 4.5, 0.1, z - 0.4, 0, 0.8);
  A.put('crate_a', x - 13, 0.1, z - 1.6, 0.2, 1);
  A.put('crate_b', x + 13, 0.1, z - 1.4, -0.3, 1);
  for (const lx of [x - 8.5, x, x + 8.5]) A.interiorLights.push({ x: lx, y: h - 1.0, z });
}

/** The dockmaster's office on the head quay, windows down the dock. */
function buildOffice(A, rng, s) {
  const { x, z, w, d, h } = s;
  const t = 0.25;
  const door = (u) => ({ u, w: 1.1, y: 0, h: 2.2 });
  const win = (u, ww = 1.4) => ({ u, w: ww, y: 1.0, h: 1.2 });
  // east face looks down the dock; doors east and north
  wallWithHoles(A, 'plaster_white', x + w / 2, z, Math.PI / 2, d, 0, h, t, [door(1.6), win(-1.0, 2.2)]);
  wallWithHoles(A, 'plaster_white', x - w / 2, z, Math.PI / 2, d, 0, h, t, [win(0)]);
  wallWithHoles(A, 'plaster_white', x, z - d / 2, 0, w, 0, h, t, [door(0.6)]);
  wallWithHoles(A, 'plaster_white', x, z + d / 2, 0, w, 0, h, t, [win(0)]);
  A.add('floor_wood', BOX(A), LL(IDENT, x, 0.05, z, 0, w - t, 0.1, d - t), { masks: [0.4, 0.6, 0.45] });
  A.box('wood', x, 0.05, z, w - t, 0.1, d - t);
  deck(A, 'roof_screed', x, h, z, w + 0.5, d + 0.5, { t: 0.25 });
  A.put('table', x + 0.6, 0.1, z - 0.8, Math.PI / 2, 1);
  A.put('chair', x - 0.2, 0.1, z - 0.6, 1.4, 1);
  A.put('cabinet', x - w / 2 + 0.5, 0.1, z + 1.8, Math.PI / 2, 1);
  A.interiorLights.push({ x, y: h - 0.4, z });
}

/** The welding shack: a corrugated box against the north wall. Cover only. */
function buildShack(A, rng, s) {
  const { x, z, w, d, h } = s;
  block(A, 'corrugated_fine', x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, [0.75, 0.5, 0.3]);
  A.add('roof_screed', BOX(A), LL(IDENT, x, h + 0.08, z, 0, w + 0.3, 0.16, d + 0.3), { masks: [0.6, 0.5, 0.3] });
  for (let i = 0; i < 5; i++) A.put('gas_bottle', x - 2 + i * 0.5, 0.02, z + d / 2 + 0.35, rng.float() * 6.283, 1);
}

/**
 * A container stack, one prototype per tier, collided as one box. A couple of
 * centimetres of settle and a hair of yaw per tier, like Rust's yard.
 */
function stack(A, x, y, z, ry, protos) {
  const { l: L, h: CH, w: W } = CONTAINER;
  for (let t = 0; t < protos.length; t++) {
    const j = ((x * 31 + z * 17 + t * 7) % 11) / 11 - 0.5;
    A.put(protos[t], x, y + t * (CH + 0.03), z, ry + j * 0.03, 1);
  }
  const hx = (ry === 0 ? L : W) / 2;
  const hz = (ry === 0 ? W : L) / 2;
  const h = protos.length * (CH + 0.03);
  A.box('metal', x, y + h / 2, z, hx * 2, h, hz * 2);
}

/** The cover table, built: one look per `kind`, collision from the same numbers. */
function buildCover(A, rng) {
  for (const [x, z, w, d, h, kind] of COVER) {
    const y = groundYGraving(x, z);
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    if (kind === 'plates') {
      // a stack of plate, each sheet a little out of square
      const n = Math.max(3, Math.round(h / 0.12));
      for (let i = 0; i < n; i++) {
        const j = (rng.float() - 0.5) * 0.12;
        A.add(i % 4 === 0 ? 'metal_rust' : 'steel', BOX_THIN(A),
          LL(IDENT, x + j, y + (i + 0.5) * (h / n), z - j, j * 0.4, w - 0.1, h / n - 0.01, d - 0.1), { masks: [0.8, 0.6, 0.3] });
      }
      A.box('metal', x, y + h / 2, z, w - 0.1, h, d - 0.1);
      for (const xx of [x0 + 0.5, x1 - 0.5]) A.add('wood_dark', BOX(A), LL(IDENT, xx, y + 0.05, z, 0, 0.2, 0.1, d + 0.1), { masks: [0.6, 0.6, 0.4] });
    } else if (kind === 'timber' || kind === 'blocks') {
      const along = w >= d;
      const n = Math.max(2, Math.round(h / 0.36));
      for (let i = 0; i < n; i++) {
        const rows = kind === 'timber' ? 3 : 2;
        for (let r = 0; r < rows; r++) {
          const cross = (i % 2 === 1) !== !along;
          const bw = cross ? w : w / rows;
          const bd = cross ? d / rows : d;
          const bx = cross ? x : x0 + bw * (r + 0.5);
          const bz = cross ? z0 + bd * (r + 0.5) : z;
          A.add('wood_dark', BOX_SOFT(A), LL(IDENT, bx, y + (i + 0.5) * (h / n), bz, (rng.float() - 0.5) * 0.04, bw - 0.04, h / n - 0.02, bd - 0.04), {
            masks: [0.65, 0.6, 0.45],
          });
        }
      }
      A.box('wood', x, y + h / 2, z, w, h, d);
    } else if (kind === 'crates') {
      block(A, 'wood_dark', x0, y, z0, x1, y + 0.12, z1, [0.6, 0.6, 0.4], BOX_THIN);
      A.put('crate_a', x - w * 0.22, y + 0.12, z - d * 0.2, rng.range(-0.2, 0.2), 1);
      A.put('crate_b', x + w * 0.22, y + 0.12, z + d * 0.2, rng.range(-0.2, 0.2), 1);
      A.put('crate_c', x, y + 0.82, z, rng.range(-0.3, 0.3), 1);
      A.box('wood', x, y + h / 2, z, w * 0.9, h, d * 0.9);
    } else if (kind === 'skip') {
      block(A, 'metal_green', x0, y, z0, x1, y + h, z1, [0.75, 0.6, 0.35]);
      A.put('scrap_a', x, y + h - 0.2, z, rng.float() * 6.283, 0.8);
    } else if (kind === 'sluice') {
      block(A, 'concrete', x0, y, z0, x1, y + h, z1, [0.55, 0.55, 0.35], BOX_SOFT);
      A.addOnce('metal_rust', tubeY(0.32, 0.4, { radial: 12 }), LL(IDENT, x, y + h, z), { masks: [0.8, 0.5, 0.3] });
      A.addOnce('metal_rust', tubeY(0.5, 0.06, { radial: 14 }), LL(IDENT, x, y + h + 0.4, z), { masks: [0.85, 0.45, 0.2] });
    } else if (kind === 'capstan') {
      const r = w / 2;
      A.addOnce('metal_dark', tubeY(r * 0.75, h, { radial: 14, taper: 0.85 }), LL(IDENT, x, y, z), { masks: [0.8, 0.5, 0.3] });
      A.addOnce('metal_dark', tubeY(r, 0.14, { radial: 14 }), LL(IDENT, x, y + h - 0.14, z), { masks: [0.85, 0.45, 0.2] });
      A.box('metal', x, y + h / 2, z, w * 0.8, h, d * 0.8);
    }
  }
  for (const [x, z] of DRUMS) {
    const y = groundYGraving(x, z);
    A.put('spool', x, y, z, rng.float() * 6.283, 1.0);
    A.box('wood', x, y + 0.7, z, 1.5, 1.4, 1.5);
  }
  for (const [x, z, ry, protos] of BOXES) stack(A, x, DOCK.quayY + 0.02, z, ry, protos);
}

/** Small stuff: drums, bottles, pallets, hoses — where nobody needs to walk. */
function dressYard(A, rng) {
  A.jitter = { rng: rng.fork(), yaw: 0.5, scale: 0.06 };
  const free = (x, z, m) => isOpenGraving(x, z, m);

  for (const [x, z] of [
    [-35, -28.6], [-34.2, -28.8], [-14, -29], [-13.2, -29.2], [17, -29], [37.5, -18], [38.2, -17.2],
    [-42.8, -18], [-42.6, -17.2], [-42.6, 4.5], [38.5, 27.5], [37.7, 28.4], [-30, 28.7], [-29.2, 28.8],
    [-33, 12.7], [-14, 12.8], [-13.2, 12.6], [2, 12.8], [27, 12.9], [33, 5.0], [-35.2, 6.2],
  ]) {
    if (!free(x, z, 0.4)) continue;
    const y = groundYGraving(x, z);
    A.put(rng.float() < 0.25 ? 'barrel_blue' : 'barrel_rust', x, y, z, rng.float() * 6.283, rng.range(0.95, 1.05));
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.range(DOCK.x0 + 1, DOCK.seaX - 1);
    const z = rng.range(DOCK.z0 + 1, DOCK.z1 - 1);
    if (!free(x, z, 0.6)) continue;
    A.put(rng.pick(['gas_bottle', 'jerry_can', 'bucket', 'pallet', 'tyre_small', 'plank_a', 'plank_b']),
      x, groundYGraving(x, z), z, rng.float() * 6.283, rng.range(0.9, 1.1));
  }
  // pipe on the laydown, a generator on the pier
  for (const [x, z, ry] of [[-17, 21.6, 0.1], [-4, 21.0, -0.05]]) if (free(x, z, 1.2)) A.put('pipe_stack', x, 0.02, z, ry, 0.9);
  if (free(34.5, -18.5, 1.0)) A.put('generator', 34.5, 0.02, -18.5, 0.2, 1);
  A.jitter = null;

  // flood masts: the quay lighting
  for (const [x, z, ry] of MASTS) {
    A.put('flood_mast', x, 0.02, z, ry, 1);
    A.put('flood_lens', x, 0.02, z, ry, 1);
    A.box('metal', x, 1.2, z, 0.4, 2.4, 0.4);
    A.lampAnchors.push({ x: x - Math.sin(ry) * 0.75, y: 5.95, z: z - Math.cos(ry) * 0.75 });
  }
}

/**
 * Build the level. Called by `WorldSystem` with a fresh Assembler and its own
 * RNG fork — same contract as every other map.
 */
export function buildGraving(A, rng) {
  registerProps(A, rng);
  registerRustProps(A, rng);

  buildSurroundings(A, rng);
  buildDock(A, rng);
  buildPerimeter(A, rng);
  buildShip(A, rng);
  buildBrows(A, rng);
  buildTowers(A, rng);
  for (const c of CRANES) buildCrane(A, rng, c);

  const infos = [];
  for (const s of STRUCTURES) {
    if (s.id === 'pump') buildPumpHouse(A, rng, s);
    else if (s.id === 'shop') buildShop(A, rng, s);
    else if (s.id === 'office') buildOffice(A, rng, s);
    else buildShack(A, rng, s);
    infos.push({ spec: s, id: s.id });
  }
  // the ship is the biggest footprint on the minimap, and it should read as one
  infos.push({ spec: { id: 'ship', x: (SHIP.x0 + SHIP.x1) / 2, z: SHIP.zc, w: SHIP.x1 - SHIP.x0, d: SHIP.z1 - SHIP.z0, h: 0 }, id: 'ship' });

  buildCover(A, rng);
  dressYard(A, rng);
  return { buildings: infos };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* the map descriptor                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

export const GRAVING_MAP = {
  id: 'graving',
  blurb: 'A ship in a drained dry dock. The quay ring looks down on everything; the altar steps, the deck and the dark under the hull are how you get close.',
  size: '84 × 60 m',
  /**
   * LEVEL -> WORLD. Chosen for the sun, not for the axes: at 18:00 the sun
   * sits 16 degrees up in the world's WNW, and this turn puts it down the
   * dock's long axis from the head, a little to the south. The boot spawn
   * looks east with the sun at its back, the light runs along the pit rather
   * than across it (so the south wall shades a strip, not the whole floor),
   * and the altar risers, which face south, catch it at a rake.
   */
  transform: { yaw: -0.65, tx: 0, tz: 0 },
  /** Down to the dock floor, up to the crane jibs. */
  bounds: [-45, -8, -31, 41, 22, 31],
  spawnPoints: GRAVING_SPAWNS,
  standable: standableAtGraving,
  groundY: groundYGraving,
  isOpen: isOpenGraving,
  build: buildGraving,
  /**
   * Late afternoon, the sun low over the dock head: long light down the
   * pit, the cranes and the rim lit warm, the floor a value darker. Daylight
   * enough that nobody fights a silhouette — the hour is mood, not a mechanic.
   */
  environment: {
    hour: 18.0,
    exposureBias: 0,
    weather: {
      turbidity: 2.4,
      horizonMurk: 0.3,
      cloudCoverage: 0.26,
      cirrusCoverage: 0.32,
      cirrusOpacity: 0.34,
    },
  },
};
