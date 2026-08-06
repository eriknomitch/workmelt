import { PB } from './props.js';
import { warpGeometry } from './util.js';

/**
 * WORLD — Shivam's own instanced prop library.
 *
 * The beach furniture the shared libraries already carry — `parasol` and
 * `lounger` — does most of the work here; this file adds only the three
 * objects that make a strip of sand read as an Australian surf beach rather
 * than a poolside: an upturned dinghy, a rack of surfboards and the red flag
 * of a patrolled swim zone. Same stance as `rustprops.js`: block the form,
 * spend triangles on the silhouette, let the material carry the surface.
 */

/** Dinghy envelope, in metres — `shivam.js` reads this for its blocker rect. */
export const DINGHY = { l: 2.6, w: 1.15, h: 0.52 };

/**
 * An upturned rowing dinghy, hull to the sky: crouch cover, and the one shape
 * every beach in the country has parked above the high-water mark. Two
 * chamfered courses tapering to a keel strip — the taper is the whole boat.
 */
function dinghy(rng) {
  const p = new PB();
  p.box(DINGHY.l, 0.26, DINGHY.w, 0, 0.13, 0, { bevel: 0.03, grime: 0.3, ao: 0.35 });
  p.box(DINGHY.l * 0.86, 0.2, DINGHY.w * 0.7, 0, 0.36, 0, { bevel: 0.05, grime: 0.2 });
  // keel and two bilge runners, proud of the hull so the top reads as a boat
  p.box(DINGHY.l * 0.92, 0.07, 0.09, 0, 0.49, 0, { bevel: 0.01, wear: 1 });
  for (const s of [-1, 1])
    p.box(DINGHY.l * 0.7, 0.05, 0.07, 0, 0.44, s * DINGHY.w * 0.24, { bevel: 0.01 });
  // transom: one square end, one pointed-ish bow course
  p.box(0.1, 0.3, DINGHY.w * 0.8, DINGHY.l * 0.46, 0.2, 0, { bevel: 0.02, grime: 0.4 });
  const g = p.build();
  warpGeometry(g, 0.02, 1.6, rng.float() * 9);
  return g;
}

/**
 * A surf-club board rack: two A-frames and a rail with five boards leaning in
 * it. Reads from either side, stops a walking player, stops no bullet worth
 * firing — `shivam.js` gives it a knee-high proxy only.
 */
function boardRack(rng) {
  const p = new PB();
  for (const s of [-1, 1]) {
    p.box(0.07, 1.35, 0.07, s * 0.95, 0.675, 0.16, { rz: 0.12 * s, grime: 0.35 });
    p.box(0.07, 1.35, 0.07, s * 0.95, 0.675, -0.16, { rz: 0.12 * s, grime: 0.35 });
  }
  p.box(2.1, 0.07, 0.08, 0, 1.28, 0, { grime: 0.2 });
  p.box(2.1, 0.07, 0.08, 0, 0.18, 0, { grime: 0.5, ao: 0.4 });
  // the boards: thin chamfered slabs, each at its own lean and height
  for (let i = 0; i < 5; i++) {
    const x = -0.78 + i * 0.39;
    p.box(0.05, 1.9, 0.46, x, 1.02, 0.05, {
      bevel: 0.02,
      rx: 0.18,
      rz: (i % 2 ? -1 : 1) * 0.05,
      wear: 1,
      grime: 0.1,
    });
  }
  const g = p.build();
  warpGeometry(g, 0.015, 2.0, rng.float() * 17);
  return g;
}

/**
 * The patrol flag: swim between these. A leaning pole and a stiff little
 * flag — cloth simulation for a 30 cm rectangle would be all cost and no
 * read, so it is a warped slab and the warp is the wind.
 */
function swimFlag(rng) {
  const p = new PB();
  p.cyl(0.035, 2.3, 0, 1.15, 0, { radial: 6, taper: 0.7, grime: 0.25 });
  p.box(0.5, 0.34, 0.02, 0.28, 2.05, 0, { bevel: 0.004, wear: 1 });
  const g = p.build();
  warpGeometry(g, 0.03, 3.0, rng.float() * 31);
  return g;
}

/**
 * Register every Shivam prototype. Called after `registerProps` — the beach
 * also draws on the shared library (and on Wilmot's loungers and the
 * Fisher's parasols), and `put()`'s dust skirt lives in the shared one.
 */
export function registerShivamProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });
  P('dinghy', 'wood_pale', dinghy(rng), { tilt: 0.02, sink: 0.03, skirt: 0.5 });
  P('board_rack', 'wood_pale', boardRack(rng), { tilt: 0.015, sink: 0.02, skirt: 0.4 });
  P('flag_swim', 'fabric_red', swimFlag(rng), { tilt: 0.05, sink: 0.04, maxDist: 90 });
}
