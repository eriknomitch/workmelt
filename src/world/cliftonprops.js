import { PB } from './props.js';

/**
 * WORLD — CLIFTON HILL props.
 *
 * The strip's own vocabulary: the cars and the tour trolley parked down the
 * hill, the speedway's karts, the midway's arcade cabinets and the wheel's
 * gondolas. Everything else on the map comes from the shared libraries.
 *
 * A prototype is ONE geometry under ONE palette key, so anything that is two
 * colours is two prototypes placed with the same transform — a car is a body,
 * a glasshouse, four wheels and two lamp clusters. That is still five draw
 * calls for every car on the map, which is the point of instancing them.
 *
 * Same stance as `rustprops.js`: block the form, spend triangles on the
 * silhouette (the wheel arches, the cabin's rake), and leave the surface to the
 * material.
 */

/** Car body dimensions, published so the map can register a collision box. */
export const CAR = { l: 4.5, w: 1.82, h: 1.48 };
/** The tour trolley: Clifton Hill's red-and-white people mover. */
export const TROLLEY = { l: 10.4, w: 2.55, h: 3.15 };
/** The speedway's karts. */
export const KART = { l: 1.75, w: 1.05, h: 0.55 };
/** A wheel gondola, hanging from its pivot at the origin. */
export const GONDOLA = { w: 2.1, h: 2.5 };

function carBody() {
  const p = new PB();
  // the lower body: bonnet, doors and boot in one slab, with a raked nose
  p.box(CAR.l, 0.62, CAR.w, 0, 0.66, 0, { bevel: 0.07, grime: 0.15 });
  p.box(0.6, 0.42, CAR.w * 0.96, CAR.l / 2 - 0.12, 0.6, 0, { bevel: 0.08, rz: -0.25 });
  // roof and pillars over the glasshouse
  p.box(2.2, 0.07, 1.5, -0.25, 1.46, 0, { bevel: 0.02 });
  for (const sx of [-1.25, 0.82]) for (const sz of [-0.72, 0.72]) p.box(0.09, 0.5, 0.07, sx, 1.2, sz, { bevel: 0.01 });
  // bumpers
  for (const s of [-1, 1]) p.box(0.14, 0.24, CAR.w * 0.98, s * (CAR.l / 2 + 0.02), 0.44, 0, { bevel: 0.04, grime: 0.4 });
  return p.build();
}

function carGlass() {
  const p = new PB();
  // a dark glasshouse, slightly tumbled-home
  p.box(2.1, 0.48, 1.56, -0.22, 1.2, 0, { bevel: 0.05 });
  // windscreen and backlight raked
  p.box(0.06, 0.52, 1.5, 0.92, 1.18, 0, { rz: 0.75, bevel: 0.01 });
  p.box(0.06, 0.48, 1.5, -1.35, 1.18, 0, { rz: -0.6, bevel: 0.01 });
  return p.build();
}

function carWheels() {
  const p = new PB();
  for (const sx of [-1.42, 1.42]) {
    for (const sz of [-0.82, 0.82]) p.cyl(0.33, 0.24, sx, 0.33, sz, { radial: 12, rx: Math.PI / 2, grime: 0.6 });
  }
  return p.build();
}

/** Headlamps (warm white, front) — a separate key so they glow. */
function carHeadlamps() {
  const p = new PB();
  for (const sz of [-0.62, 0.62]) p.box(0.06, 0.12, 0.34, CAR.l / 2 + 0.03, 0.74, sz, { bevel: 0.01 });
  return p.build();
}

function carTaillamps() {
  const p = new PB();
  for (const sz of [-0.66, 0.66]) p.box(0.06, 0.12, 0.3, -CAR.l / 2 - 0.03, 0.78, sz, { bevel: 0.01 });
  return p.build();
}

/** A taxi's roof sign. Only taxis get one. */
function taxiTopper() {
  const p = new PB();
  p.box(0.32, 0.16, 0.7, -0.25, 1.58, 0, { bevel: 0.02 });
  return p.build();
}

function trolleyBody() {
  const p = new PB();
  const { l, w, h } = TROLLEY;
  // white upper body and roof, with a clerestory down the middle
  p.box(l, h - 1.2, w, 0, 1.2 + (h - 1.2) / 2, 0, { bevel: 0.08, grime: 0.15 });
  p.box(l * 0.7, 0.22, w * 0.5, 0, h + 0.1, 0, { bevel: 0.04 });
  // fenders over the wheels
  for (const sx of [-l * 0.33, l * 0.33]) p.box(1.3, 0.2, w + 0.06, sx, 1.02, 0, { bevel: 0.05 });
  return p.build();
}

function trolleyBand() {
  const p = new PB();
  const { l, w } = TROLLEY;
  // the red lower body and the cow-catcher bumper
  p.box(l + 0.04, 0.85, w + 0.02, 0, 0.86, 0, { bevel: 0.06, grime: 0.3 });
  p.box(0.25, 0.3, w * 0.9, l / 2 + 0.08, 0.5, 0, { bevel: 0.04 });
  return p.build();
}

function trolleyGlass() {
  const p = new PB();
  const { l, w } = TROLLEY;
  // ten bays a side, lit from inside
  for (let i = 0; i < 9; i++) {
    const x = -l / 2 + 0.8 + i * ((l - 1.6) / 8);
    for (const s of [-1, 1]) p.box(0.9, 0.85, 0.05, x, 2.15, s * (w / 2 + 0.01), { bevel: 0.01 });
  }
  p.box(0.05, 0.95, w * 0.8, l / 2 + 0.01, 2.1, 0, { bevel: 0.01 });
  p.box(0.05, 0.85, w * 0.8, -l / 2 - 0.01, 2.15, 0, { bevel: 0.01 });
  return p.build();
}

function trolleyWheels() {
  const p = new PB();
  const { l, w } = TROLLEY;
  for (const sx of [-l * 0.33, l * 0.33]) for (const sz of [-w / 2 + 0.25, w / 2 - 0.25]) p.cyl(0.48, 0.32, sx, 0.48, sz, { radial: 12, rx: Math.PI / 2, grime: 0.6 });
  return p.build();
}

function kartBody() {
  const p = new PB();
  p.box(KART.l, 0.16, 0.8, 0, 0.18, 0, { bevel: 0.03, grime: 0.3 });
  p.box(0.55, 0.28, 0.9, 0.55, 0.3, 0, { bevel: 0.05 }); // nose fairing
  p.box(0.5, 0.42, 0.5, -0.35, 0.42, 0, { bevel: 0.05 }); // seat back
  p.box(0.3, 0.12, 1.0, -0.78, 0.3, 0, { bevel: 0.03 }); // rear bumper
  return p.build();
}

function kartWheels() {
  const p = new PB();
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.48, 0.48]) p.cyl(0.14, 0.14, sx, 0.14, sz, { radial: 10, rx: Math.PI / 2, grime: 0.5 });
  return p.build();
}

/** An upright arcade cabinet, screen facing +X. */
function arcadeBody() {
  const p = new PB();
  p.box(0.75, 1.15, 0.7, 0, 0.58, 0, { bevel: 0.02, grime: 0.15 });
  p.box(0.5, 0.75, 0.7, -0.12, 1.5, 0, { bevel: 0.02 });
  p.box(0.4, 0.06, 0.66, 0.32, 1.06, 0, { bevel: 0.01, rz: -0.25 }); // control deck
  p.box(0.6, 0.25, 0.72, -0.05, 1.98, 0, { bevel: 0.02 }); // marquee housing
  return p.build();
}

function arcadeScreen() {
  const p = new PB();
  p.box(0.04, 0.5, 0.56, 0.14, 1.45, 0, { bevel: 0.005, rz: 0.12 });
  p.box(0.04, 0.16, 0.6, 0.255, 1.98, 0, { bevel: 0.005 }); // marquee strip
  return p.build();
}

/**
 * A slot machine, front facing +X: a red cabinet with a topper, three lit reel
 * windows, an amber neon trim, and the lever on its right-hand (+Z) side. The
 * midway's one usable bank — `slots.js` owns what pulling it does.
 */
export const SLOT = { w: 0.7, d: 0.66, h: 2.08 };

function slotBody() {
  const p = new PB();
  p.box(SLOT.w, 1.05, SLOT.d, 0, 0.525, 0, { bevel: 0.03, grime: 0.12 });
  p.box(0.5, 0.82, SLOT.d, -0.1, 1.46, 0, { bevel: 0.03 });
  p.box(0.24, 0.05, SLOT.d - 0.04, 0.28, 1.08, 0, { bevel: 0.01, rz: -0.2 }); // button deck
  p.box(0.44, 0.2, SLOT.d - 0.02, -0.1, 1.97, 0, { bevel: 0.03 }); // topper housing
  return p.build();
}

function slotReels() {
  const p = new PB();
  for (const z of [-0.17, 0, 0.17]) p.box(0.04, 0.26, 0.14, 0.16, 1.44, z, { bevel: 0.005 });
  return p.build();
}

/** A thin neon line along the topper's face — a trim, not a panel. */
function slotLights() {
  const p = new PB();
  p.box(0.03, 0.05, SLOT.d - 0.08, 0.125, 2.02, 0, { bevel: 0.005 });
  return p.build();
}

function slotLever() {
  const p = new PB();
  p.box(0.12, 0.12, 0.06, 0, 1.25, SLOT.d / 2 + 0.03, { bevel: 0.02 }); // pivot boss
  p.cyl(0.022, 0.48, 0, 1.49, SLOT.d / 2 + 0.07, { radial: 8 });
  p.cyl(0.06, 0.1, 0, 1.76, SLOT.d / 2 + 0.07, { radial: 10 });
  return p.build();
}

function gondolaFrame() {
  const p = new PB();
  const { w, h } = GONDOLA;
  // hanger bar from the pivot down to the roof
  p.box(0.14, 0.7, 0.14, 0, -0.35, 0, { bevel: 0.02 });
  p.box(w, 0.22, w, 0, -0.75, 0, { bevel: 0.06 }); // roof
  p.box(w, 0.32, w, 0, -h + 0.16, 0, { bevel: 0.06, grime: 0.2 }); // floor pan
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.box(0.09, h - 0.8, 0.09, sx * (w / 2 - 0.05), -(h + 0.6) / 2 - 0.15, sz * (w / 2 - 0.05), { bevel: 0.01 });
  }
  return p.build();
}

function gondolaGlass() {
  const p = new PB();
  const { w, h } = GONDOLA;
  p.box(w - 0.12, h - 1.05, w - 0.12, 0, -(h + 0.6) / 2 - 0.15, 0, { bevel: 0.04 });
  return p.build();
}

/** The lit floor strip under every gondola: the wheel's ring of cold light. */
function gondolaGlow() {
  const p = new PB();
  const { w, h } = GONDOLA;
  p.box(w * 0.9, 0.06, w * 0.9, 0, -h - 0.02, 0, { bevel: 0.01 });
  return p.build();
}

function bollard() {
  const p = new PB();
  p.cyl(0.11, 0.95, 0, 0.475, 0, { radial: 10, grime: 0.3 });
  p.cyl(0.13, 0.08, 0, 0.92, 0, { radial: 10 });
  return p.build();
}

/** A string of festoon bulbs, 1 m long along +X: one segment of a catenary. */
function festoonBulbs() {
  const p = new PB();
  for (let i = 0; i < 4; i++) p.box(0.07, 0.09, 0.07, -0.375 + i * 0.25, -0.06, 0, { bevel: 0.015 });
  return p.build();
}

/**
 * Register every Clifton Hill prototype. Called after `registerProps`; the map
 * also reuses the shared crates, planters, lamp posts, litter and stalls, plus
 * the Loop's street furniture.
 */
export function registerCliftonProps(A) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });

  // cars: one body per paint, shared glass, wheels and lamps
  P('ch_car_taxi', 'paint_yellow', carBody(), { skirt: 1.6 });
  P('ch_car_red', 'sign_red', carBody(), { skirt: 1.6 });
  P('ch_car_blue', 'metal_blue', carBody(), { skirt: 1.6 });
  P('ch_car_white', 'frame_white', carBody(), { skirt: 1.6 });
  P('ch_car_dark', 'el_steel', carBody(), { skirt: 1.6 });
  P('ch_car_glass', 'window_void', carGlass(), { castShadow: false });
  P('ch_car_wheels', 'rubber', carWheels());
  P('ch_car_head', 'ch_neon_white', carHeadlamps(), { castShadow: false });
  P('ch_car_tail', 'ch_neon_red', carTaillamps(), { castShadow: false });
  P('ch_taxi_top', 'ch_neon_amber', taxiTopper(), { castShadow: false });

  P('ch_trolley_body', 'frame_white', trolleyBody(), { skirt: 2.5 });
  P('ch_trolley_band', 'sign_red', trolleyBand());
  P('ch_trolley_glass', 'window_glow', trolleyGlass(), { castShadow: false });
  P('ch_trolley_wheels', 'rubber', trolleyWheels());

  P('ch_kart', 'sign_red', kartBody());
  P('ch_kart_wheels', 'rubber', kartWheels());

  P('ch_arcade', 'el_steel', arcadeBody());
  P('ch_arcade_screen', 'ch_neon_cyan', arcadeScreen(), { castShadow: false });

  P('ch_slot', 'sign_red', slotBody());
  // A lit sign face, not a tube: a panel this size on a neon key clips to
  // white in the dim hall and swallows the cabinet around it.
  P('ch_slot_reels', 'sign_glow', slotReels(), { castShadow: false });
  P('ch_slot_lights', 'ch_neon_amber', slotLights(), { castShadow: false });
  P('ch_slot_lever', 'el_steel', slotLever());

  P('ch_gondola', 'frame_white', gondolaFrame(), { chunk: false });
  P('ch_gondola_glass', 'window_glass', gondolaGlass(), { chunk: false, castShadow: false });
  P('ch_gondola_glow', 'ch_neon_cyan', gondolaGlow(), { chunk: false, castShadow: false });

  P('ch_bollard', 'metal_dark', bollard(), { skirt: 0.2 });
  P('ch_festoon', 'emissive_warm', festoonBulbs(), { castShadow: false, maxDist: 70 });
  return A;
}
