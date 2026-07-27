import * as THREE from 'three';
import { PB } from './props.js';
import { mergeSimple } from './kit.js';
import { fillMasks, rockGeometry, warpGeometry } from './util.js';

/**
 * WORLD — the Wilmot map's own instanced prop library.
 *
 * `props.js` is the market's vocabulary and `rustprops.js` the refinery's; a
 * North Shore country estate needs a third one — broadleaf trees, clipped
 * hedges, topiary, garden urns and benches, pool loungers and hay bales.
 * Everything is built with the same `PB` accumulator, so each prototype is ONE
 * merged geometry and one instanced draw call however many parts went into it.
 *
 * LOW POLY ON PURPOSE, same brief as Rust: forms are blocked out, and the
 * surface interest comes from the shared procedural materials.
 *
 * FOLIAGE IS TWO PROTOTYPES. The `foliage` material is alpha-cut leaf cover on
 * double-sided planes — exactly right for the ragged edge of a canopy, and
 * exactly wrong on its own for a clipped hedge or a tree crown, where the
 * cutout would show daylight straight through the middle of the mass. So every
 * green volume here is a PAIR: an opaque dark core (`leaf_core` palette) that
 * gives the mass its silhouette and shadow, and a leaf shell of alpha planes
 * floating just proud of it that gives the edge its sparkle. `wilmot.js`
 * places both with one helper so they can never drift apart.
 */

/** Hedge segment size, in metres. Runs along +X; `wilmot.js` tiles them. */
export const HEDGE = { l: 1.9, h: 1.0, w: 0.8 };

/** A clipped hedge's opaque body: one softly chamfered, slightly warped slab. */
function hedgeCore(rng) {
  const p = new PB();
  p.box(HEDGE.l, HEDGE.h, HEDGE.w, 0, HEDGE.h / 2, 0, { bevel: 0.06, grime: 0.35, ao: 0.3 });
  const g = p.build();
  warpGeometry(g, 0.045, 1.6, rng.float() * 25);
  return g;
}

/** The leaf shell around a hedge segment: alpha planes skimming every face. */
function hedgeLeaf(rng) {
  const list = [];
  const put = (w, h, x, y, z, ry, rx = 0) => {
    const q = new THREE.PlaneGeometry(w, h, 1, 1);
    q.applyMatrix4(
      new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ'))
        .setPosition(x, y, z)
    );
    fillMasks(q, 0.15, 0.3, 0.2);
    list.push(q);
  };
  const { l: L, h: H, w: W } = HEDGE;
  for (const s of [-1, 1]) {
    put(L * 1.04, H * 1.05, 0, H / 2, s * (W / 2 + 0.03), 0);
    put(W * 1.05, H * 1.05, s * (L / 2 + 0.03), H / 2, 0, Math.PI / 2);
  }
  // the clipped top, and two tilted fillers that break the box read
  put(L * 1.02, W * 1.04, 0, H + 0.03, 0, 0, -Math.PI / 2);
  put(L * 0.7, H * 0.8, rng.range(-0.3, 0.3), H * 0.62, 0.12, 0.35, -0.25);
  put(L * 0.7, H * 0.8, rng.range(-0.3, 0.3), H * 0.62, -0.12, -0.35, 0.25);
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/**
 * A mature broadleaf trunk: tapering bole and three main limbs reaching into
 * where the canopy blobs sit. Bark only — the green is the other two protos.
 */
function oakTrunk(rng) {
  const p = new PB();
  p.cyl(0.42, 0.5, 0, 0.22, 0, { radial: 9, taper: 0.72, grime: 0.55, ao: 0.4 });
  p.cyl(0.3, 2.9, 0, 1.55, 0, { radial: 9, taper: 0.62, grime: 0.3 });
  const limbs = [
    [0.45, 3.6, 0.5, 0.16],
    [-0.5, 3.4, -0.3, 0.15],
    [0.1, 3.9, -0.55, 0.13],
  ];
  for (const [dx, y, dz, r] of limbs) {
    const a = Math.atan2(Math.hypot(dx, dz), 1.4);
    p.cyl(r, 1.9, dx * 0.55, y, dz * 0.55, {
      radial: 7,
      taper: 0.5,
      rx: Math.cos(Math.atan2(dx, dz)) * a,
      rz: -Math.sin(Math.atan2(dx, dz)) * a,
      grime: 0.25,
    });
  }
  const g = p.build();
  warpGeometry(g, 0.03, 0.8, rng.float() * 30);
  return g;
}

/** The canopy's opaque heart: overlapping rock blobs, squashed like a crown. */
function oakCore(rng) {
  const list = [];
  const blobs = [
    [0, 5.0, 0, 2.15],
    [1.15, 4.5, 0.7, 1.5],
    [-1.2, 4.6, -0.5, 1.45],
    [0.25, 4.3, -1.15, 1.3],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = rockGeometry(rng, r, 1, 0.72);
    g.translate(x, y, z);
    fillMasks(g, 0.1, 0.25, 0.25);
    list.push(g);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/** The leaf shell: bigger, softer blobs of alpha-cut cover over the core. */
function oakLeaf(rng) {
  const list = [];
  const blobs = [
    [0, 5.1, 0, 2.5],
    [1.3, 4.5, 0.8, 1.8],
    [-1.35, 4.7, -0.55, 1.75],
    [0.3, 4.2, -1.3, 1.55],
    [0, 6.1, 0.3, 1.6],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = rockGeometry(rng, r, 1, 0.75);
    g.translate(x, y, z);
    fillMasks(g, 0.12, 0.2, 0.15);
    list.push(g);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/** A clipped box ball on a stone kerb — the pair that flanks every doorway. */
function topiaryCore(rng) {
  const p = new PB();
  p.cyl(0.34, 0.16, 0, 0.08, 0, { radial: 10, grime: 0.5, ao: 0.4 });
  const g = rockGeometry(rng, 0.52, 1, 0.95);
  g.translate(0, 0.72, 0);
  fillMasks(g, 0.1, 0.25, 0.25);
  p.geo(g, 0, 0, 0, {});
  g.dispose();
  return p.build();
}

function topiaryLeaf(rng) {
  const g = rockGeometry(rng, 0.62, 1, 0.95);
  g.translate(0, 0.74, 0);
  fillMasks(g, 0.12, 0.2, 0.15);
  return g;
}

/** Classical garden urn: foot, bowl, lip. Waist-high stone punctuation. */
function gardenUrn(rng) {
  const p = new PB();
  p.box(0.5, 0.14, 0.5, 0, 0.07, 0, { bevel: 0.012, grime: 0.55, ao: 0.4 });
  p.cyl(0.13, 0.3, 0, 0.29, 0, { radial: 10, grime: 0.4 });
  p.cyl(0.34, 0.34, 0, 0.6, 0, { radial: 12, taper: 0.45, wear: 1 });
  p.cyl(0.38, 0.08, 0, 0.8, 0, { radial: 12, wear: 1 });
  // the planting mounded over the lip
  const soil = rockGeometry(rng, 0.3, 0, 0.5);
  soil.translate(0, 0.84, 0);
  fillMasks(soil, 0.1, 0.5, 0.3);
  p.geo(soil, 0, 0, 0, {});
  soil.dispose();
  return p.build();
}

/** A slatted garden bench along +X. Knee-high cover that reads as furniture. */
function gardenBench(rng) {
  const p = new PB();
  for (const s of [-1, 1]) {
    p.box(0.09, 0.42, 0.55, s * 0.62, 0.21, 0, { bevel: 0.008, grime: 0.45, ao: 0.35 });
    p.box(0.09, 0.52, 0.09, s * 0.62, 0.68, -0.24, { bevel: 0.008, grime: 0.3 });
  }
  for (let i = 0; i < 4; i++)
    p.box(1.5, 0.035, 0.1, 0, 0.44, -0.2 + i * 0.13, { bevel: 0.004, wear: 1 });
  for (let i = 0; i < 3; i++)
    p.box(1.5, 0.1, 0.03, 0, 0.62 + i * 0.14, -0.26, { bevel: 0.004, wear: 1 });
  const g = p.build();
  warpGeometry(g, 0.008, 1.4, rng.float() * 15);
  return g;
}

/** A poolside lounger along +X: raked back, flat seat, two runners. */
function poolLounger(rng) {
  const p = new PB();
  for (const s of [-1, 1]) p.box(1.7, 0.07, 0.08, 0, 0.12, s * 0.3, { bevel: 0.006, grime: 0.3 });
  for (let i = 0; i < 6; i++)
    p.box(0.14, 0.035, 0.66, -0.55 + i * 0.22, 0.32, 0, { bevel: 0.004, wear: 1 });
  for (let i = 0; i < 4; i++)
    p.box(0.14, 0.035, 0.66, 0.68 + i * 0.16, 0.36 + i * 0.14, 0, {
      bevel: 0.004,
      rz: -0.75,
      wear: 1,
    });
  for (const [x, z] of [[-0.5, 0.24], [-0.5, -0.24], [0.45, 0.24], [0.45, -0.24]])
    p.box(0.06, 0.24, 0.06, x, 0.16, z, { bevel: 0.004, grime: 0.4, ao: 0.3 });
  return p.build();
}

/** A hay bale — the barn's crate. Stacks two high, vaults at one. */
function hayBale(rng) {
  const p = new PB();
  p.box(0.92, 0.5, 0.48, 0, 0.25, 0, { bevel: 0.07, grime: 0.3, ao: 0.2 });
  // twine
  for (const x of [-0.24, 0.24])
    p.box(0.03, 0.52, 0.5, x, 0.25, 0, { bevel: 0.004, grime: 0.6 });
  const g = p.build();
  warpGeometry(g, 0.025, 2.2, rng.float() * 18);
  return g;
}

/** Low rose bloom tufts for the sunken garden's parterre beds. */
function roseTuft(rng) {
  const list = [];
  for (let i = 0; i < 5; i++) {
    const q = new THREE.PlaneGeometry(rng.range(0.24, 0.4), rng.range(0.22, 0.36), 1, 1);
    q.applyMatrix4(
      new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(rng.range(-0.4, 0.4), rng.float() * Math.PI, 0, 'YXZ'))
        .setPosition(rng.range(-0.12, 0.12), rng.range(0.1, 0.24), rng.range(-0.12, 0.12))
    );
    fillMasks(q, 0.2, 0.3, 0.2);
    list.push(q);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/**
 * Register every Wilmot prototype. Called after `registerProps` — the estate
 * also draws on the shared furniture, crates, barrels and planters, and
 * `put()`'s dust skirt lives in that library.
 */
export function registerWilmotProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });
  const LOOSE = (tilt, sink) => ({ tilt, sink });

  // Green volumes are placed in matched pairs (core + leaf) by wilmot.js, so
  // they are never jittered independently — `chunk` stays on for culling.
  P('hedge_core', 'leaf_core', hedgeCore(rng), { castShadow: true });
  P('hedge_leaf', 'foliage', hedgeLeaf(rng), { receiveShadow: true });
  P('oak_trunk', 'bark', oakTrunk(rng), { skirt: 0.6, chunk: false });
  P('oak_core', 'leaf_core', oakCore(rng), { chunk: false });
  P('oak_leaf', 'foliage', oakLeaf(rng), { chunk: false, receiveShadow: true });
  P('topiary_core', 'leaf_core', topiaryCore(rng), { skirt: 0.3 });
  P('topiary_leaf', 'foliage', topiaryLeaf(rng), { receiveShadow: true });
  P('rose_tuft', 'bloom', roseTuft(rng), { maxDist: 45, castShadow: false });

  P('urn', 'concrete_prop', gardenUrn(rng), { skirt: 0.32, ...LOOSE(0.03, 0.008) });
  P('bench', 'wood_prop_dark', gardenBench(rng), { skirt: 0.5, ...LOOSE(0.04, 0.012) });
  P('lounger', 'wood_pale', poolLounger(rng), { skirt: 0.5, ...LOOSE(0.05, 0.01) });
  P('bale', 'straw', hayBale(rng), { skirt: 0.4, ...LOOSE(0.08, 0.015) });
  return A;
}
