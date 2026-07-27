import * as THREE from 'three';
import { PB } from './props.js';
import { warpGeometry } from './util.js';

/**
 * WORLD — The Loop's own instanced prop library.
 *
 * `props.js` is the market's vocabulary, `rustprops.js` the refinery's and
 * `wilmotprops.js` the estate's; a downtown Chicago street corner needs a
 * fourth — hydrants, relay boxes, news boxes, dumpsters, wire litter baskets,
 * platform benches and the railroad ties the elevated track rides on.
 * Everything is built with the same `PB` accumulator, so each prototype is ONE
 * merged geometry and one instanced draw call however many parts went into it.
 *
 * LOW POLY IS THE BRIEF, same as Rust and Wilmot: chunky massing with the
 * surface interest carried by the shared procedural materials.
 */

/** Railroad tie dimensions — `loop.js` spaces them along the track by `gap`. */
export const TIE = { l: 2.5, h: 0.13, w: 0.24, gap: 0.62 };

/** A fire hydrant: squat barrel, domed bonnet, two hose caps. Shin cover. */
function hydrant(rng) {
  const p = new PB();
  p.cyl(0.17, 0.1, 0, 0.05, 0, { radial: 10, grime: 0.6, ao: 0.45 });
  p.cyl(0.145, 0.5, 0, 0.34, 0, { radial: 10, taper: 0.88, wear: 1, grime: 0.35 });
  p.cyl(0.15, 0.14, 0, 0.62, 0, { radial: 10, taper: 0.55, wear: 1 });
  p.cyl(0.05, 0.09, 0, 0.72, 0, { radial: 8, taper: 0.6, wear: 1 });
  for (const s of [-1, 1]) {
    p.cyl(0.075, 0.12, s * 0.17, 0.42, 0, { radial: 8, rz: s * Math.PI / 2, wear: 1, grime: 0.3 });
  }
  p.cyl(0.08, 0.1, 0, 0.42, 0.16, { radial: 8, rx: -Math.PI / 2, wear: 1, grime: 0.3 });
  return p.build();
}

/** A USPS relay box: rounded-top drum on four stub legs. Waist-high cover. */
function mailbox(rng) {
  const p = new PB();
  for (const [x, z] of [[-0.24, -0.18], [0.24, -0.18], [-0.24, 0.18], [0.24, 0.18]]) {
    p.box(0.06, 0.18, 0.06, x, 0.09, z, { bevel: 0.006, grime: 0.55, ao: 0.4 });
  }
  p.box(0.62, 0.72, 0.5, 0, 0.54, 0, { bevel: 0.02, grime: 0.3, ao: 0.2 });
  p.cyl(0.25, 0.62, 0, 0.9, 0, { radial: 10, rz: Math.PI / 2, seg: 1, wear: 1, grime: 0.25 });
  // the pull-down mouth plate
  p.box(0.4, 0.16, 0.04, 0, 0.78, 0.25, { bevel: 0.006, wear: 1, grime: 0.2 });
  return p.build();
}

/** A coin news box: cabinet on legs with a window in the door. */
function newsbox(rng) {
  const p = new PB();
  for (const [x, z] of [[-0.16, -0.13], [0.16, -0.13], [-0.16, 0.13], [0.16, 0.13]]) {
    p.box(0.05, 0.22, 0.05, x, 0.11, z, { bevel: 0.004, grime: 0.6, ao: 0.4 });
  }
  p.box(0.44, 0.62, 0.36, 0, 0.53, 0, { bevel: 0.012, grime: 0.35, ao: 0.2 });
  p.box(0.34, 0.3, 0.03, 0, 0.62, 0.18, { bevel: 0.004, grime: 0.7, ao: 0.5 });
  p.box(0.3, 0.1, 0.05, 0, 0.87, 0.16, { bevel: 0.004, wear: 1 });
  return p.build();
}

/** An alley dumpster: tub, sliding lids, side pockets. The alley's crate. */
function dumpster(rng) {
  const p = new PB();
  p.box(1.85, 0.98, 1.15, 0, 0.63, 0, { bevel: 0.02, grime: 0.4, ao: 0.25 });
  // a raked front face so it is not a pure box
  p.box(1.85, 0.32, 0.2, 0, 0.32, 0.62, { bevel: 0.012, rx: 0.5, grime: 0.5 });
  for (const s of [-1, 1]) {
    // fork pockets and the lifted lid half
    p.box(0.24, 0.18, 1.0, s * 0.62, 0.28, 0, { bevel: 0.008, grime: 0.6, ao: 0.4 });
    p.box(0.86, 0.05, 1.12, s * 0.455, s > 0 ? 1.17 : 1.13, 0, {
      bevel: 0.008,
      rz: s > 0 ? -0.12 : 0,
      wear: 1,
      grime: 0.3,
    });
  }
  for (const [x, z] of [[-0.75, -0.5], [0.75, -0.5], [-0.75, 0.5], [0.75, 0.5]]) {
    p.cyl(0.07, 0.14, x, 0.07, z, { radial: 8, grime: 0.8, ao: 0.6 });
  }
  const g = p.build();
  warpGeometry(g, 0.012, 1.6, rng.float() * 20);
  return g;
}

/** A wire litter basket: an open ring of mesh read as a coarse cylinder. */
function litterBasket(rng) {
  const p = new PB();
  p.cyl(0.34, 0.78, 0, 0.39, 0, { radial: 12, taper: 0.9, open: true, wear: 1, grime: 0.4 });
  p.cyl(0.3, 0.05, 0, 0.05, 0, { radial: 12, grime: 0.7, ao: 0.5 });
  for (const yy of [0.12, 0.72]) {
    p.cyl(0.35, 0.05, 0, yy, 0, { radial: 12, taper: 1, open: true, wear: 1 });
  }
  return p.build();
}

/** The bag mound that sits inside a litter basket, as its own dark prop. */
function litterBag(rng) {
  const p = new PB();
  p.cyl(0.28, 0.3, 0, 0.68, 0, { radial: 9, taper: 0.55, grime: 0.4, ao: 0.3 });
  const g = p.build();
  warpGeometry(g, 0.05, 2.4, rng.float() * 12);
  return g;
}

/** A CTA platform bench: steel frame, slat seat and back, no arms. */
function platformBench(rng) {
  const p = new PB();
  for (const s of [-1, 1]) {
    p.box(0.08, 0.44, 0.5, s * 0.7, 0.22, 0, { bevel: 0.008, grime: 0.5, ao: 0.35 });
    p.box(0.08, 0.5, 0.08, s * 0.7, 0.68, -0.22, { bevel: 0.008, grime: 0.35 });
  }
  for (let i = 0; i < 4; i++) {
    p.box(1.6, 0.04, 0.11, 0, 0.45, -0.18 + i * 0.125, { bevel: 0.004, wear: 1 });
  }
  for (let i = 0; i < 3; i++) {
    p.box(1.6, 0.1, 0.04, 0, 0.6 + i * 0.14, -0.25, { bevel: 0.004, wear: 1 });
  }
  const g = p.build();
  warpGeometry(g, 0.006, 1.5, rng.float() * 9);
  return g;
}

/** One railroad tie. The track bed lays hundreds of these along the deck. */
function railTie(rng) {
  const p = new PB();
  p.box(TIE.l, TIE.h, TIE.w, 0, TIE.h / 2, 0, { bevel: 0.014, grime: 0.5, ao: 0.35 });
  return p.build();
}

/** A green street-name blade pair on a pole, crossed at the corner. */
function streetSign(rng) {
  const p = new PB();
  p.cyl(0.045, 3.0, 0, 1.5, 0, { radial: 8, grime: 0.4 });
  p.box(0.82, 0.2, 0.03, 0.3, 2.86, 0, { bevel: 0.004, wear: 1 });
  p.box(0.03, 0.2, 0.7, -0.02, 2.62, 0.24, { bevel: 0.004, wear: 1 });
  return p.build();
}

/** A traffic drum / channelizer for the torn-up street mouths. */
function trafficDrum(rng) {
  const p = new PB();
  p.box(0.5, 0.06, 0.5, 0, 0.03, 0, { bevel: 0.008, grime: 0.7, ao: 0.5 });
  p.cyl(0.24, 0.82, 0, 0.47, 0, { radial: 10, taper: 0.82, wear: 1, grime: 0.35 });
  return p.build();
}

/**
 * Register every Loop prototype. Called after `registerProps` — the corner
 * also draws on the shared crates, pallets, planters, lamp posts and litter,
 * and `put()`'s dust skirt lives in that library.
 */
export function registerLoopProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });
  const LOOSE = (tilt, sink) => ({ tilt, sink });

  P('hydrant', 'sign_red', hydrant(rng), { skirt: 0.26 });
  P('mailbox', 'metal_blue', mailbox(rng), { skirt: 0.4, ...LOOSE(0.02, 0.006) });
  P('newsbox', 'sign_red', newsbox(rng), { skirt: 0.3, ...LOOSE(0.05, 0.01) });
  P('newsbox_blue', 'metal_blue', newsbox(rng), { skirt: 0.3, ...LOOSE(0.05, 0.01) });
  P('dumpster', 'metal_green', dumpster(rng), { skirt: 0.7, ...LOOSE(0.02, 0.008) });
  P('litter_basket', 'metal_dark', litterBasket(rng), { skirt: 0.3, ...LOOSE(0.04, 0.01) });
  P('litter_bag', 'rubber', litterBag(rng), { ...LOOSE(0.06, 0.01) });
  P('bench_cta', 'wood_prop_dark', platformBench(rng), { ...LOOSE(0.02, 0.006) });
  P('tie', 'wood_prop_dark', railTie(rng), { castShadow: false });
  P('street_sign', 'metal_green', streetSign(rng), { ...LOOSE(0.03, 0.006) });
  P('traffic_drum', 'sign_red', trafficDrum(rng), { skirt: 0.28, ...LOOSE(0.09, 0.012) });
  return A;
}
