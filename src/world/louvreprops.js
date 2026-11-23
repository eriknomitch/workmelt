import { PB } from './props.js';

/**
 * WORLD — THE LOUVRE props.
 *
 * The Cour Napoléon's own vocabulary: the stone figures along the terrace
 * balustrades, the balustrade itself, the green cast-iron Wallace fountains,
 * Versailles planters with their clipped orange trees, the concrete
 * anti-ram blocks every Paris landmark now wears, park benches and the queue
 * stanchions in front of the pyramid. Lamps, café tables and chairs come from
 * the shared library.
 *
 * Same stance as `rustprops.js`: one geometry under one palette key per
 * prototype, the form blocked out in chamfered boxes and tapered cylinders,
 * and the surface left to the material. A two-colour object is two prototypes
 * placed with the same transform.
 */

/** Footprints the map registers collision for. Published so the two agree. */
export const LV_BLOCK = { l: 2.0, w: 0.9, h: 1.05 };
export const LV_PLANTER = { s: 1.5, h: 1.25 };
export const LV_WALLACE = { s: 0.86, h: 2.7 };
/** One section of terrace balustrade, along +X. */
export const LV_BALUSTRADE = { l: 2.0, h: 1.05 };

/**
 * A standing figure on a pedestal: the "illustrious men" who line the terraces
 * of the Cour Napoléon. A robe is a tapered drum, the shoulders a box, the head
 * a small cylinder; at six metres up and eighty away nobody reads more, and
 * the silhouette against the sky is the whole job.
 */
function statue() {
  const p = new PB();
  p.box(0.86, 0.9, 0.86, 0, 0.45, 0, { bevel: 0.03, grime: 0.35 });
  p.box(1.0, 0.12, 1.0, 0, 0.96, 0, { bevel: 0.02, wear: 1 });
  p.box(0.74, 0.1, 0.74, 0, 0.06, 0, { bevel: 0.02, grime: 0.5 });
  // robe, shoulders, head
  p.cyl(0.3, 1.25, 0, 1.64, 0, { radial: 10, taper: 0.72, grime: 0.3 });
  p.box(0.56, 0.24, 0.3, 0, 2.3, 0, { bevel: 0.05, grime: 0.2 });
  p.cyl(0.12, 0.28, 0, 2.55, 0, { radial: 8, taper: 0.9, grime: 0.25 });
  // an arm across the chest and a scroll — the one gesture every one of them makes
  p.box(0.12, 0.5, 0.12, 0.18, 2.0, 0.14, { bevel: 0.03, rz: 0.6 });
  p.cyl(0.05, 0.36, 0.05, 1.9, 0.2, { radial: 6, rz: Math.PI / 2 });
  return p.build();
}

/** 2 m of stone balustrade: plinth, rail and six turned balusters. */
function balustrade() {
  const p = new PB();
  const L = LV_BALUSTRADE.l;
  p.box(L, 0.18, 0.42, 0, 0.09, 0, { bevel: 0.015, grime: 0.4 });
  p.box(L, 0.14, 0.46, 0, LV_BALUSTRADE.h - 0.07, 0, { bevel: 0.02, wear: 1.1 });
  for (let i = 0; i < 6; i++) {
    const x = -L / 2 + (i + 0.5) * (L / 6);
    p.cyl(0.075, 0.36, x, 0.38, 0, { radial: 8, taper: 1.6 });
    p.cyl(0.12, 0.36, x, 0.74, 0, { radial: 8, taper: 0.62 });
  }
  return p.build();
}

/**
 * A Wallace fountain: four caryatids under a dome on an octagonal plinth, in
 * the green every Parisian knows. The caryatids are four slim drums — the
 * thing that reads is the dome on legs.
 */
function wallace() {
  const p = new PB();
  p.cyl(0.43, 0.5, 0, 0.25, 0, { radial: 8, grime: 0.35 });
  p.cyl(0.32, 0.18, 0, 0.59, 0, { radial: 8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.cyl(0.07, 1.1, Math.cos(a) * 0.2, 1.23, Math.sin(a) * 0.2, { radial: 6, taper: 0.8 });
  }
  p.cyl(0.36, 0.14, 0, 1.85, 0, { radial: 8, wear: 1.1 });
  p.cyl(0.36, 0.55, 0, 1.92, 0, { radial: 8, taper: 0.12 });
  p.cyl(0.05, 0.3, 0, 2.5, 0, { radial: 6 });
  return p.build();
}

/** The green slatted box of a Versailles planter, with its finials. */
function planterBox() {
  const p = new PB();
  const s = LV_PLANTER.s;
  const h = LV_PLANTER.h;
  p.box(s, h - 0.1, s, 0, (h - 0.1) / 2 + 0.1, 0, { bevel: 0.03, grime: 0.3 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      p.box(0.14, h + 0.06, 0.14, sx * (s / 2 - 0.02), (h + 0.06) / 2, sz * (s / 2 - 0.02), { bevel: 0.02, wear: 1.2 });
      p.cyl(0.08, 0.14, sx * (s / 2 - 0.02), h + 0.12, sz * (s / 2 - 0.02), { radial: 8, taper: 0.2 });
    }
  return p.build();
}

/** The orange tree that lives in it: a trunk and a clipped ball. */
function orangeTrunk() {
  const p = new PB();
  p.cyl(0.07, 1.1, 0, LV_PLANTER.h + 0.5, 0, { radial: 7, taper: 0.8, grime: 0.4 });
  return p.build();
}

function orangeCrown() {
  const p = new PB();
  p.cyl(0.78, 1.3, 0, LV_PLANTER.h + 1.75, 0, { radial: 10, taper: 0.55, seg: 1 });
  p.cyl(0.62, 0.5, 0, LV_PLANTER.h + 1.0, 0, { radial: 10, taper: 1.26 });
  return p.build();
}

/** Concrete anti-ram block. Bevelled hard, because they are cast that way. */
function block() {
  const p = new PB();
  const { l, w, h } = LV_BLOCK;
  p.box(l, h * 0.82, w, 0, h * 0.41, 0, { bevel: 0.06, grime: 0.35 });
  p.box(l * 0.94, h * 0.18, w * 0.84, 0, h * 0.91, 0, { bevel: 0.05, wear: 1.2 });
  return p.build();
}

/** A Paris park bench: slatted seat and back on cast legs. */
function bench() {
  const p = new PB();
  for (let i = 0; i < 4; i++) p.box(1.9, 0.04, 0.09, 0, 0.44, -0.18 + i * 0.11, { bevel: 0.01 });
  for (let i = 0; i < 3; i++) p.box(1.9, 0.09, 0.03, 0, 0.62 + i * 0.12, -0.27, { bevel: 0.01, rx: -0.2 });
  for (const sx of [-0.8, 0.8]) {
    p.box(0.06, 0.44, 0.5, sx, 0.22, 0, { bevel: 0.01, grime: 0.4 });
    p.box(0.06, 0.4, 0.06, sx, 0.66, -0.28, { bevel: 0.01 });
  }
  return p.build();
}

/** A queue stanchion with its belt hooked to the next one. */
function stanchion() {
  const p = new PB();
  p.cyl(0.17, 0.04, 0, 0.02, 0, { radial: 12 });
  p.cyl(0.03, 0.95, 0, 0.5, 0, { radial: 8 });
  p.box(1.6, 0.05, 0.01, 0.8, 0.88, 0, { bevel: 0.004 });
  return p.build();
}

export function registerLouvreProps(A) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });
  P('lv_statue', 'stone_pale', statue(), { skirt: 0 });
  P('lv_balustrade', 'stone_pale', balustrade(), { skirt: 0 });
  P('lv_wallace', 'metal_green', wallace(), { skirt: 0.4 });
  P('lv_planter', 'metal_green', planterBox(), { skirt: 0.8 });
  P('lv_orange_trunk', 'bark', orangeTrunk(), { castShadow: false });
  P('lv_orange_crown', 'foliage', orangeCrown());
  P('lv_block', 'concrete_prop', block(), { skirt: 1.0 });
  P('lv_bench', 'wood_dark', bench(), { skirt: 0.6, maxDist: 60 });
  P('lv_stanchion', 'metal_dark', stanchion(), { maxDist: 45 });
  return A;
}
