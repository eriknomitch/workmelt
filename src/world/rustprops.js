import * as THREE from 'three';
import { PB } from './props.js';
import { tubeY, warpGeometry } from './util.js';

/**
 * WORLD — the Rust map's own instanced prop library.
 *
 * `props.js` is the market's vocabulary: crates, barrels, sandbags, palms,
 * market stalls. A disused oil refinery needs a different one — shipping
 * containers, pipe runs and racks, valve stacks, cable drums, flood masts and
 * scrap. Everything here is built with the same `PB` accumulator the market
 * props use, so each prototype comes out as ONE merged geometry with automatic
 * convex-edge wear, and therefore one instanced draw call however many parts
 * went into it.
 *
 * LOW POLY ON PURPOSE. The brief for this map is a low-poly Rust, so the forms
 * are blocked out rather than modelled: a container is a chamfered box with
 * corner castings, rails and door furniture, and the corrugation is the
 * material's normal map, not 60 extruded ribs. That keeps a yard of 30
 * containers at ~13k instanced triangles instead of ~200k, and it is also what
 * the silhouette wants — Rust reads as stacked rectangles.
 *
 * Prototype ids are the vocabulary `rust.js` places from.
 */

/** 20 ft ISO container, in metres. Length runs along +X so `ry` turns it. */
export const CONTAINER = { l: 6.06, h: 2.59, w: 2.44 };

/**
 * A shipping container.
 *
 * The silhouette is the whole prop: what the player reads at 20 m is the corner
 * posts standing proud of the wall plane and the top rail casting a hard line
 * down the side. So the box itself is one chamfered slab and every triangle
 * that is not the box is spent on the edges — castings, posts, rails and the
 * door leaves with their locking bars.
 */
function shippingContainer(rng, tier = 0) {
  const { l: L, h: H, w: W } = CONTAINER;
  const p = new PB();
  // The tier index only varies the dents and grime so a stack does not read as
  // one extruded prism: the upper box has taken less ground splash, the lower
  // one carries the mud line.
  const base = tier === 0 ? 0.35 : 0.12;
  p.box(L - 0.16, H - 0.2, W - 0.16, 0, 0, 0, { bevel: 0.02, grime: base });

  // corner posts, standing 4 cm proud of the wall plane on both faces
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.box(0.14, H - 0.24, 0.14, sx * (L / 2 - 0.07), 0, sz * (W / 2 - 0.07), { bevel: 0.01, wear: 1 });

  // top and bottom rails
  for (const sz of [-1, 1]) {
    p.box(L, 0.16, 0.13, 0, H / 2 - 0.08, sz * (W / 2 - 0.06), { bevel: 0.012, wear: 1 });
    p.box(L, 0.15, 0.13, 0, -H / 2 + 0.075, sz * (W / 2 - 0.06), { bevel: 0.012, grime: 0.55, ao: 0.3 });
  }
  for (const sx of [-1, 1]) {
    p.box(0.12, 0.16, W, sx * (L / 2 - 0.06), H / 2 - 0.08, 0, { bevel: 0.012, wear: 1 });
    p.box(0.12, 0.15, W, sx * (L / 2 - 0.06), -H / 2 + 0.075, 0, { bevel: 0.012, grime: 0.55, ao: 0.3 });
  }

  // corner castings — the chunky blocks that make a stack read as a stack
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        p.box(0.2, 0.17, 0.2, sx * (L / 2 - 0.1), sy * (H / 2 - 0.085), sz * (W / 2 - 0.1), {
          bevel: 0.014,
          wear: 1,
          grime: sy < 0 ? 0.5 : 0.1,
        });

  // roof: a shallow crown so it sheds water and catches a grazing highlight
  p.box(L - 0.2, 0.07, W - 0.2, 0, H / 2 - 0.02, 0, { bevel: 0.01, wear: 0.9, grime: 0.25 });

  // doors on the +X end: two leaves, four locking bars, two hinge stacks
  for (const sz of [-1, 1]) {
    p.box(0.07, H - 0.34, W * 0.46, L / 2 - 0.02, 0, sz * W * 0.235, { bevel: 0.01, wear: 1 });
    for (const b of [0.34, 0.78]) {
      p.cyl(0.032, H - 0.42, L / 2 + 0.035, 0, sz * W * b * 0.5, { radial: 6, wear: 1 });
      p.box(0.07, 0.13, 0.11, L / 2 + 0.035, H * 0.22, sz * W * b * 0.5, { bevel: 0.006, wear: 1 });
    }
    p.box(0.09, 0.14, 0.16, L / 2 + 0.01, H * 0.3, sz * (W / 2 - 0.12), { bevel: 0.006, wear: 1 });
    p.box(0.09, 0.14, 0.16, L / 2 + 0.01, -H * 0.3, sz * (W / 2 - 0.12), { bevel: 0.006, wear: 1 });
  }

  const g = p.build();
  g.translate(0, H / 2, 0);
  // Nothing in a scrapyard is straight. 1.5 cm of warp over six metres is
  // invisible as a shape and lethal to the extruded-box read.
  warpGeometry(g, 0.015, 0.5, rng.float() * 40);
  return g;
}

/** A capped pipe lying along +Z, centred on the origin. */
function pipeRun(rng, len = 6, r = 0.24) {
  const p = new PB();
  const body = tubeY(r, len, { radial: 10 });
  body.translate(0, -len / 2, 0);
  body.rotateX(Math.PI / 2);
  p.geo(body, 0, 0, 0, { grime: 0.25 });
  // flanges at both ends and a joint collar off centre
  for (const s of [-1, 1]) {
    p.cyl(r * 1.28, 0.07, 0, 0, s * (len / 2 - 0.04), { radial: 10, rx: Math.PI / 2, wear: 1 });
    p.cyl(r * 1.1, 0.05, 0, 0, s * (len / 2 - 0.22), { radial: 10, rx: Math.PI / 2, wear: 1 });
  }
  p.cyl(r * 1.14, 0.11, 0, 0, len * rng.range(0.03, 0.16), { radial: 10, rx: Math.PI / 2, wear: 1, grime: 0.3 });
  return p.build();
}

/** Three pipes cradled in a stack, running along +Z. Vaultable at ~0.8 m. */
function pipeStack(rng, len = 5.4, r = 0.3) {
  const p = new PB();
  const put = (x, y) => {
    const g = tubeY(r, len, { radial: 9 });
    g.translate(0, -len / 2, 0);
    g.rotateX(Math.PI / 2);
    p.geo(g, x, y, 0, { grime: 0.3 });
    for (const s of [-1, 1]) p.cyl(r * 1.2, 0.06, x, y, s * (len / 2 - 0.03), { radial: 9, rx: Math.PI / 2, wear: 1 });
  };
  put(-r * 1.05, r);
  put(r * 1.05, r);
  put(0, r + r * 1.72);
  // timber chocks stopping the bottom course rolling
  for (const s of [-1, 1])
    p.box(r * 4.6, 0.14, 0.16, 0, 0.07, s * (len / 2 - 0.5), { bevel: 0.01, grime: 0.5, ao: 0.35 });
  const g = p.build();
  warpGeometry(g, 0.01, 1.1, rng.float() * 20);
  return g;
}

/** A-frame pipe trestle: two splayed legs and a cradle beam, across +X. */
function pipeTrestle(rng, h = 1.15, w = 1.9) {
  const p = new PB();
  for (const s of [-1, 1]) {
    p.box(0.13, h, 0.13, (s * w) / 2, h / 2, 0, { bevel: 0.008, rz: -s * 0.07, grime: 0.35 });
    p.box(0.1, 0.1, 0.5, (s * w) / 2, 0.05, 0, { bevel: 0.008, grime: 0.6, ao: 0.4 });
  }
  p.box(w + 0.3, 0.14, 0.16, 0, h + 0.06, 0, { bevel: 0.01, wear: 1 });
  p.box(w * 0.92, 0.09, 0.1, 0, h * 0.42, 0, { bevel: 0.008 });
  return p.build();
}

/** Vertical valve stack: riser, wheel, flanges. Waist-high silhouette break. */
function valveStack(rng) {
  const p = new PB();
  const h = rng.range(1.05, 1.4);
  p.cyl(0.13, h, 0, h / 2, 0, { radial: 10, grime: 0.3 });
  p.cyl(0.24, 0.06, 0, 0.03, 0, { radial: 10, grime: 0.6, ao: 0.4 });
  p.cyl(0.2, 0.09, 0, h * 0.62, 0, { radial: 10, wear: 1 });
  p.box(0.34, 0.26, 0.24, 0, h * 0.78, 0, { bevel: 0.012, wear: 1 });
  // hand wheel: a rim and four spokes, edge-on to the mast
  p.cyl(0.26, 0.045, 0, h + 0.05, 0, { radial: 12, taper: 1, wear: 1, open: true });
  for (let i = 0; i < 4; i++)
    p.box(0.5, 0.035, 0.035, 0, h + 0.05, 0, { bevel: 0.004, ry: (i * Math.PI) / 4, wear: 1 });
  p.cyl(0.055, 0.1, 0, h + 0.06, 0, { radial: 8, wear: 1 });
  return p.build();
}

/** Cable drum on its side — a rolling round in a yard of rectangles. */
function cableSpool(rng, r = 0.85) {
  const p = new PB();
  const w = r * 0.95;
  for (const s of [-1, 1]) p.cyl(r, 0.09, s * (w / 2), r, 0, { radial: 14, rx: Math.PI / 2, grime: 0.3 });
  p.cyl(r * 0.42, w - 0.16, 0, r, 0, { radial: 12, rx: Math.PI / 2, grime: 0.4, ao: 0.3 });
  // the coil still on the drum
  p.cyl(r * 0.72, w - 0.3, 0, r, 0, { radial: 16, rx: Math.PI / 2, grime: 0.55, ao: 0.25 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.box(0.09, 0.09, w - 0.18, Math.sin(a) * r * 0.72, r + Math.cos(a) * r * 0.72, 0, { bevel: 0.006, wear: 1 });
  }
  return p.build();
}

/** Flood mast: the yard's only tall vertical outside the derrick. */
function floodMast(rng, h = 5.6) {
  const p = new PB();
  p.cyl(0.19, 0.28, 0, 0.14, 0, { radial: 10, grime: 0.6, ao: 0.45 });
  p.cyl(0.11, h, 0, h / 2 + 0.2, 0, { radial: 8, grime: 0.3 });
  // three gusset plates at the foot: the cue that says "welded down", not "stuck in"
  for (let i = 0; i < 3; i++)
    p.box(0.035, 0.42, 0.3, 0, 0.42, 0, { bevel: 0.004, ry: (i * Math.PI * 2) / 3, wear: 1 });
  p.box(0.16, 0.14, 0.85, 0, h + 0.16, 0.3, { bevel: 0.01, wear: 1 });
  p.box(0.62, 0.42, 0.26, 0, h + 0.06, 0.66, { bevel: 0.014, wear: 1, rx: 0.42 });
  p.box(0.09, 0.09, 0.55, 0, h - 0.18, 0.42, { bevel: 0.006, wear: 1 });
  return p.build();
}

/** The flood mast's lens, so the head reads as glass and can be driven at dusk. */
function floodLens() {
  const g = new THREE.PlaneGeometry(0.5, 0.32);
  g.rotateX(-0.42 - Math.PI / 2);
  g.translate(0, 5.98, 0.78);
  return g;
}

/** A ladder against a wall. Visual only — the level is climbed by stair and ramp. */
function ladder(rng, h = 3.1) {
  const p = new PB();
  for (const s of [-1, 1]) p.box(0.06, h, 0.05, s * 0.23, h / 2, 0, { bevel: 0.005, wear: 1 });
  const n = Math.max(2, Math.round(h / 0.31));
  for (let i = 1; i < n; i++)
    p.cyl(0.021, 0.46, 0, (i / n) * h, 0, { radial: 6, rz: Math.PI / 2, wear: 1 });
  for (const s of [-1, 1]) p.box(0.05, 0.05, 0.26, s * 0.23, h - 0.25, 0.13, { bevel: 0.004, grime: 0.4 });
  return p.build();
}

/** Twisted plate and offcut pile — the filler that makes a scrapyard a scrapyard. */
function scrapPile(rng, s = 1.1) {
  const p = new PB();
  const n = 5 + (rng.float() * 4) | 0;
  for (let i = 0; i < n; i++) {
    p.box(
      s * rng.range(0.5, 1.25),
      rng.range(0.03, 0.07),
      s * rng.range(0.3, 0.85),
      rng.range(-s * 0.3, s * 0.3),
      0.04 + i * rng.range(0.04, 0.09),
      rng.range(-s * 0.3, s * 0.3),
      {
        bevel: 0.005,
        ry: rng.float() * 3.14,
        rx: rng.range(-0.22, 0.22),
        rz: rng.range(-0.22, 0.22),
        grime: 0.45,
        ao: 0.3,
      }
    );
  }
  for (let i = 0; i < 3; i++)
    p.cyl(rng.range(0.04, 0.08), s * rng.range(0.6, 1.3), rng.range(-s * 0.3, s * 0.3), 0.1, rng.range(-s * 0.3, s * 0.3), {
      radial: 6,
      rz: Math.PI / 2,
      ry: rng.float() * 3.14,
      grime: 0.4,
    });
  return p.build();
}

/** Rolled steel I-beam along +X. Cover at shin height, ramp when it leans. */
function iBeam(rng, len = 4.2) {
  const p = new PB();
  p.box(len, 0.045, 0.34, 0, 0.18, 0, { bevel: 0.006, wear: 1 });
  p.box(len, 0.045, 0.34, 0, -0.18, 0, { bevel: 0.006, grime: 0.5, ao: 0.35 });
  p.box(len, 0.32, 0.04, 0, 0, 0, { bevel: 0.004, grime: 0.25 });
  const g = p.build();
  g.translate(0, 0.2, 0);
  warpGeometry(g, 0.008, 0.9, rng.float() * 12);
  return g;
}

/** Horizontal storage tank on two saddles, lying along +Z. */
function tankHorizontal(rng, len = 4.6, r = 1.05) {
  const p = new PB();
  const body = tubeY(r, len, { radial: 14 });
  body.translate(0, -len / 2, 0);
  body.rotateX(Math.PI / 2);
  p.geo(body, 0, r + 0.5, 0, { grime: 0.25 });
  for (const s of [-1, 1]) {
    p.cyl(r * 0.99, 0.1, 0, r + 0.5, s * (len / 2 - 0.03), { radial: 14, rx: Math.PI / 2, taper: 0.86, wear: 1 });
    // saddle: a plinth and a curved-ish cradle, blocked out as two boxes
    p.box(r * 1.5, 0.5, 0.44, 0, 0.25, s * (len * 0.28), { bevel: 0.012, grime: 0.6, ao: 0.45 });
    p.box(r * 1.2, 0.34, 0.36, 0, 0.62, s * (len * 0.28), { bevel: 0.012, grime: 0.4, ao: 0.3 });
  }
  p.cyl(0.11, 0.5, 0, r * 2 + 0.55, 0, { radial: 8, wear: 1 });
  p.box(0.44, 0.1, 0.44, 0, r * 2 + 0.8, 0, { bevel: 0.008, wear: 1 });
  return p.build();
}

/** A wheeled site generator — the yard's "why is there power here" prop. */
function generatorSkid(rng) {
  const p = new PB();
  p.box(2.3, 0.18, 1.05, 0, 0.16, 0, { bevel: 0.012, grime: 0.6, ao: 0.4 });
  p.box(2.0, 0.95, 0.92, 0, 0.72, 0, { bevel: 0.02, grime: 0.25 });
  p.box(2.06, 0.09, 0.98, 0, 1.22, 0, { bevel: 0.01, wear: 1 });
  // louvre bank, exhaust and a control door
  for (let i = 0; i < 5; i++)
    p.box(0.06, 0.09, 0.86, -0.98, 0.5 + i * 0.14, 0, { bevel: 0.004, wear: 1, ao: 0.25 });
  p.cyl(0.09, 0.7, 0.72, 1.55, 0.3, { radial: 8, wear: 1, grime: 0.5 });
  p.cyl(0.13, 0.09, 0.72, 1.92, 0.3, { radial: 8, wear: 1 });
  p.box(0.05, 0.62, 0.5, 1.02, 0.72, -0.2, { bevel: 0.008, wear: 1 });
  for (const s of [-1, 1]) p.cyl(0.19, 0.12, s * 0.8, 0.19, 0.56, { radial: 10, rz: Math.PI / 2, grime: 0.5 });
  return p.build();
}

/**
 * Register every Rust prototype. Called before the level is built, after
 * `registerProps` — the yard also uses the shared barrels, crates, pallets,
 * tyres and rubble, and `put()`'s contact fillet lives in that library.
 */
export function registerRustProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });
  const LOOSE = (tilt, sink) => ({ tilt, sink });

  // Containers are placed by hand and stacked, so they are NEVER jittered: a
  // container knocked 5 degrees out of true is a container falling over, and a
  // stack of two would visibly miss.
  P('cont_red', 'container_red', shippingContainer(rng, 0), { chunk: false });
  P('cont_blue', 'container_blue', shippingContainer(rng, 0), { chunk: false });
  P('cont_green', 'container_green', shippingContainer(rng, 1), { chunk: false });
  P('cont_sand', 'container_sand', shippingContainer(rng, 1), { chunk: false });

  P('pipe_long', 'metal_rust_prop', pipeRun(rng, 6.0, 0.24), { skirt: 0.3, chunk: false });
  P('pipe_short', 'metal_rust_prop', pipeRun(rng, 3.2, 0.19), { skirt: 0.24, ...LOOSE(0.05, 0.01) });
  P('pipe_stack', 'metal_rust_prop', pipeStack(rng, 5.4, 0.3), { skirt: 0.9, chunk: false });
  P('trestle', 'steel_frame', pipeTrestle(rng, 1.15, 1.9), { skirt: 0.5 });
  P('valve', 'metal_rust_prop', valveStack(rng), { skirt: 0.3 });
  P('spool', 'wood_prop_dark', cableSpool(rng, 0.85), { skirt: 0.55, ...LOOSE(0.05, 0.012) });
  P('flood_mast', 'metal_dark', floodMast(rng, 5.6), { skirt: 0.3, chunk: false });
  P('flood_lens', 'lamp_lens', floodLens(), { chunk: false, castShadow: false });
  P('ladder', 'metal_rust', ladder(rng, 3.1), { chunk: false });
  P('scrap_a', 'metal_rust_prop', scrapPile(rng, 1.15), { skirt: 0.75, ...LOOSE(0.07, 0.02) });
  P('scrap_b', 'steel', scrapPile(rng, 0.8), { skirt: 0.55, ...LOOSE(0.09, 0.018) });
  P('ibeam', 'metal_rust_prop', iBeam(rng, 4.2), { skirt: 0.5, ...LOOSE(0.045, 0.012) });
  P('tank_horiz', 'metal_rust', tankHorizontal(rng, 4.6, 1.05), { chunk: false });
  P('generator', 'metal_green', generatorSkid(rng), { skirt: 0.9, chunk: false });
  return A;
}
