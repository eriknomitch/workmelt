import * as THREE from 'three';
import { mergeSimple, pockGeometry } from './kit.js';
import {
  chamferBox,
  clothGeometry,
  tubeY,
  rockGeometry,
  sackGeometry,
  polyPrism,
  patchGeometry,
  paintMasks,
  fillMasks,
  fbm3,
  warpGeometry,
} from './util.js';

/**
 * WORLD — the prop library.
 *
 * Every prop is a small assembly of chamfered boxes, tubes, cloth grids and
 * noise-deformed rocks, merged into ONE geometry and registered as an
 * InstancedMesh prototype. Placement (rotation/scale/tint variation) lives in
 * dressing.js — this file only decides what things look like.
 *
 * Mask convention as everywhere else: r = edge wear, g = grime, b = extra AO,
 * multiplied per instance by instanceColor so no two crates weather alike.
 */

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

function mat(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

/** Generic convex-edge detector: verts near two or more bounding faces. */
export function autoEdgeWear(geo, margin = 0.02, amount = 1) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  const sz = bb.max.z - bb.min.z;
  return paintMasks(geo, (x, y, z, nx, ny, nz, out) => {
    let near = 0;
    if (sx > margin * 3 && (x - bb.min.x < margin || bb.max.x - x < margin)) near++;
    if (sy > margin * 3 && (y - bb.min.y < margin || bb.max.y - y < margin)) near++;
    if (sz > margin * 3 && (z - bb.min.z < margin || bb.max.z - z < margin)) near++;
    if (near >= 2) out[0] = Math.max(out[0], amount);
  });
}

/**
 * Part accumulator for one prop.
 *
 * Exported because every map's prop library wants the same builder — see
 * `src/world/rustprops.js`. It owns the two things that stop a prop reading as
 * an extruded box: automatic convex-edge wear on every part, and the merge down
 * to a single geometry so a prototype is one draw call however many parts it
 * was assembled from.
 */
export class PB {
  constructor() {
    this.list = [];
  }

  _push(g, wear, grime, ao) {
    if (!g.getAttribute('color')) fillMasks(g, 0.2, 0, 0);
    if (wear !== 1 || grime > 0 || ao > 0) {
      const c = g.getAttribute('color');
      for (let i = 0; i < c.count; i++) {
        c.setXYZ(
          i,
          Math.min(1, c.getX(i) * wear),
          Math.min(1, Math.max(c.getY(i), grime)),
          Math.min(1, Math.max(c.getZ(i), ao))
        );
      }
    }
    this.list.push(g);
    return g;
  }

  box(sx, sy, sz, x = 0, y = 0, z = 0, o = {}) {
    const g = chamferBox(sx, sy, sz, o.bevel ?? 0.008);
    g.applyMatrix4(mat(x, y, z, o.ry ?? 0, o.rx ?? 0, o.rz ?? 0));
    return this._push(g, o.wear ?? 1, o.grime ?? 0, o.ao ?? 0);
  }

  cyl(r, h, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.CylinderGeometry(
      (o.taper ?? 1) * r,
      r,
      h,
      o.radial ?? 12,
      o.seg ?? 1,
      o.open ?? false
    );
    autoEdgeWear(g, o.margin ?? Math.min(r, h) * 0.12, 0.9);
    g.applyMatrix4(mat(x, y, z, o.ry ?? 0, o.rx ?? 0, o.rz ?? 0));
    return this._push(g, o.wear ?? 1, o.grime ?? 0, o.ao ?? 0);
  }

  geo(g, x = 0, y = 0, z = 0, o = {}) {
    if (o.autoWear !== false && !g.getAttribute('color')) autoEdgeWear(g, o.margin ?? 0.02);
    g.applyMatrix4(mat(x, y, z, o.ry ?? 0, o.rx ?? 0, o.rz ?? 0, o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    return this._push(g, o.wear ?? 1, o.grime ?? 0, o.ao ?? 0);
  }

  build() {
    const g = mergeSimple(this.list);
    for (const p of this.list) p.dispose();
    this.list.length = 0;
    return g;
  }
}

// ============================================================== containers ==
function crate(rng, s = 0.62, slats = true) {
  const p = new PB();
  p.box(s, s * 0.85, s * 0.92, 0, 0, 0, { bevel: 0.012, grime: 0.12 });
  if (slats) {
    // plank slats standing proud of the body, with one board sprung loose
    const n = 3;
    for (let i = 0; i < n; i++) {
      const y = -s * 0.32 + (i / (n - 1)) * s * 0.64;
      const loose = rng.float() < 0.18;
      p.box(s * 1.01, s * 0.14, 0.016, 0, y, s * 0.46, {
        bevel: 0.004,
        rz: loose ? rng.range(-0.12, 0.12) : 0,
        wear: 1,
      });
      p.box(s * 1.01, s * 0.14, 0.016, 0, y, -s * 0.46, { bevel: 0.004 });
      p.box(0.016, s * 0.14, s * 0.94, s * 0.5, y, 0, { bevel: 0.004 });
      p.box(0.016, s * 0.14, s * 0.94, -s * 0.5, y, 0, { bevel: 0.004 });
    }
    // corner posts
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        p.box(0.05, s * 0.86, 0.05, sx * (s * 0.48), 0, sz * (s * 0.44), { bevel: 0.006 });
    // lid boards with real gaps: the top face is what the player looks down on,
    // and one unbroken panel there is what makes a crate read as a solid block
    const lid = 4;
    for (let i = 0; i < lid; i++) {
      const z = -s * 0.46 + ((i + 0.5) / lid) * s * 0.92;
      p.box(s * 1.0, 0.02, (s * 0.92) / lid - 0.012, 0, s * 0.425 + 0.012, z, {
        bevel: 0.004,
        rz: rng.range(-0.006, 0.006),
        wear: 1,
      });
    }
    // a cross batten and a couple of nail heads' worth of relief
    p.box(s * 1.02, 0.022, 0.055, 0, s * 0.44, s * 0.2, { bevel: 0.004, wear: 1 });
  }
  const g = p.build();
  g.translate(0, s * 0.425, 0);
  return g;
}

function cardboardBox(rng, s = 0.45) {
  const p = new PB();
  const h = s * rng.range(0.6, 0.9);
  p.box(s, h, s * rng.range(0.8, 1.1), 0, 0, 0, { bevel: 0.006, grime: 0.25 });
  // flaps, one folded up
  p.box(s * 0.48, 0.012, s * 0.9, -s * 0.25, h / 2 + 0.006, 0, { bevel: 0.003, wear: 1 });
  p.box(s * 0.48, 0.012, s * 0.9, s * 0.25, h / 2 + 0.09, 0, { bevel: 0.003, rz: -0.9 });
  const g = p.build();
  g.translate(0, h / 2, 0);
  return g;
}

function barrel(rng, r = 0.29, h = 0.88, ribs = 3) {
  const p = new PB();
  p.cyl(r, h, 0, 0, 0, { radial: 16, grime: 0.15 });
  for (let i = 0; i < ribs; i++) {
    const y = -h / 2 + ((i + 1) / (ribs + 1)) * h;
    p.cyl(r * 1.045, h * 0.055, 0, y, 0, { radial: 16, wear: 1, grime: 0.3 });
  }
  p.cyl(r * 1.02, 0.03, 0, h / 2 - 0.015, 0, { radial: 16, wear: 1 });
  p.cyl(r * 1.02, 0.03, 0, -h / 2 + 0.015, 0, { radial: 16, wear: 1, grime: 0.5 });
  // bung
  p.cyl(0.05, 0.02, r * 0.45, h / 2 + 0.008, 0, { radial: 8, wear: 1 });
  const g = p.build();
  g.translate(0, h / 2, 0);
  warpGeometry(g, 0.008, 2.2, rng.float() * 10);
  return g;
}

function gasBottle(rng) {
  const p = new PB();
  const h = 0.58;
  p.cyl(0.155, h, 0, 0, 0, { radial: 14, grime: 0.2 });
  p.cyl(0.15, 0.06, 0, h / 2 + 0.02, 0, { radial: 14, taper: 0.75, wear: 1 });
  p.cyl(0.032, 0.09, 0, h / 2 + 0.09, 0, { radial: 8, wear: 1 });
  p.cyl(0.075, 0.035, 0, h / 2 + 0.14, 0, { radial: 10, wear: 1 });
  p.cyl(0.16, 0.02, 0, -h / 2 + 0.01, 0, { radial: 14, grime: 0.6 });
  const g = p.build();
  g.translate(0, h / 2, 0);
  return g;
}

function bucket(rng) {
  const p = new PB();
  p.cyl(0.145, 0.28, 0, 0, 0, { radial: 14, taper: 1.24, grime: 0.4, open: true });
  p.cyl(0.145, 0.02, 0, -0.13, 0, { radial: 14, grime: 0.6 });
  p.cyl(0.185, 0.018, 0, 0.14, 0, { radial: 14, wear: 1 });
  const g = p.build();
  g.translate(0, 0.14, 0);
  return g;
}

function jerryCan(rng) {
  const p = new PB();
  p.box(0.34, 0.44, 0.17, 0, 0, 0, { bevel: 0.02, grime: 0.2 });
  p.box(0.3, 0.06, 0.05, 0, 0.24, 0, { bevel: 0.01, wear: 1 });
  p.cyl(0.035, 0.05, 0.11, 0.25, 0, { radial: 8, wear: 1 });
  const g = p.build();
  g.translate(0, 0.22, 0);
  return g;
}

// ================================================================== cover ==
/**
 * A filled bag: ~0.5 m long, 0.17 m tall once it has settled under its stack.
 * Three genuinely different silhouettes, because a wall built from one bag is a
 * lattice of identical lozenges no matter how it is stacked.
 */
function sandbag(rng, i = 0) {
  const dims = [
    [0.49, 0.175, 0.33],
    [0.45, 0.16, 0.35],
    [0.47, 0.15, 0.3],
  ][i % 3];
  const g = sackGeometry(rng, dims[0], dims[1], dims[2], {
    variant: i % 3,
    box: 4.6 - (i % 3) * 0.5,
    lump: 1.2,
  });
  const bb = g.boundingBox;
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 12, y * 12, z * 12, 2);
    // creases and the underside of the bag: where dust and shadow collect
    const crease = Math.max(0, 1 - Math.abs(ny) * 3.2);
    const low = Math.max(0, 1 - (y - bb.min.y) / (dims[1] * 0.55));
    // the tied ends are the darkest part of a bag, and they are what draws the
    // seam between one bag and the next in a stack
    const end = Math.max(0, Math.abs(x) / (dims[0] * 0.5) - 0.62) / 0.38;
    // Bags weather hard: sun-bleached on top, filthy where they touch.
    out[0] = 0.3 + n * 0.45 + Math.max(0, ny) * 0.2;
    // Keep the hessian pale: bags are only filthy where they touch, and burying
    // the weave under grime is what makes sandbags read as beanbags.
    out[1] = 0.16 + Math.max(0, -ny) * 0.45 + n * 0.14 + low * low * 0.3 + end * 0.25;
    out[2] = 0.1 + Math.max(0, -ny) * 0.45 + crease * 0.22 + low * low * 0.35 + end * end * 0.5;
  });
  g.translate(0, dims[1] * 0.5, 0);
  return g;
}

function jerseyBarrier(rng) {
  // Proper jersey profile: wide splayed foot, sloped face, narrow top.
  const prof = [
    [-0.3, 0],
    [0.3, 0],
    [0.3, 0.09],
    [0.16, 0.24],
    [0.09, 0.72],
    [0.09, 0.92],
    [-0.09, 0.92],
    [-0.09, 0.72],
    [-0.16, 0.24],
    [-0.3, 0.09],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(prof[0][0], prof[0][1]);
  for (let i = 1; i < prof.length; i++) shape.lineTo(prof[i][0], prof[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1.9,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -0.95);
  g.computeVertexNormals();
  autoEdgeWear(g, 0.035, 1);
  const p = new PB();
  p.geo(g, 0, 0, 0, { autoWear: false, grime: 0.15 });
  // lifting eyes and a scuffed reflector
  p.cyl(0.035, 0.1, 0, 0.95, -0.55, { radial: 8, rx: Math.PI / 2, wear: 1 });
  p.cyl(0.035, 0.1, 0, 0.95, 0.55, { radial: 8, rx: Math.PI / 2, wear: 1 });
  const out = p.build();
  paintMasks(out, (x, y, z, nx, ny, nz, o) => {
    o[1] = Math.min(1, o[1] + Math.max(0, 1 - y / 0.35) ** 2 * 0.6 + Math.max(0, -ny) * 0.4);
    o[2] = Math.min(1, o[2] + Math.max(0, 1 - y / 0.3) ** 2 * 0.45);
  });
  return out;
}

function concreteBlock(rng, w = 1.2, h = 0.9, d = 0.8) {
  const p = new PB();
  p.box(w, h, d, 0, 0, 0, { bevel: 0.03, grime: 0.2 });
  // chipped corner
  const chip = rockGeometry(rng, 0.34, 0, 0.8);
  p.geo(chip, w / 2 - 0.06, h / 2 - 0.05, d / 2 - 0.08, { grime: 0.4 });
  const g = p.build();
  g.translate(0, h / 2, 0);
  return g;
}

/**
 * A tyre. A smooth torus is the giveaway: real rubber has a tread band with
 * discrete blocks and grooves, a shoulder radius, and raised lettering on the
 * sidewall. The tread count is deliberately low (14 blocks) so it resolves as
 * blocks at 3 m instead of aliasing into a hum like a 34-cycle ripple does.
 */
function tyre(rng, r = 0.33) {
  const BLOCKS = 17;
  // 5 columns per block (block x3 / shoulder / groove). At 3 columns the groove
  // was a third of the pitch and the crown read as a ring of beads rather than
  // as tread; the extra segments also kill the faceting on the shoulder.
  const radial = BLOCKS * 5;
  const HW = r * 0.3; // half the section width
  // A real tyre section: flat-ish sidewalls at the widest point, a distinct
  // shoulder, a flat crown, and a bead that leaves a proper hole in the middle.
  // Revolving this instead of a circle is the difference between a tyre and an
  // inflatable ring.
  const prof = [
    [0.52, 0.45],
    [0.66, 0.88],
    [0.82, 1.0],
    [0.94, 0.92],
    [0.995, 0.62],
    [1.0, 0.35],
    [1.0, -0.35],
    [0.995, -0.62],
    [0.94, -0.92],
    [0.82, -1.0],
    [0.66, -0.88],
    [0.52, -0.45],
    [0.5, -0.18],
    [0.505, 0.18],
    [0.52, 0.45],
  ].map(([pr, py]) => new THREE.Vector2(pr * r, py * HW));
  const g = new THREE.LatheGeometry(prof, radial);
  const pa = g.getAttribute('position');
  const stagger = rng.float() * 6.28;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const y = pa.getY(i);
    const z = pa.getZ(i);
    const a = Math.atan2(z, x);
    const rr = Math.hypot(x, z);
    // tread blocks: a square wave round the crown, split by a centre groove
    const ph = (a * BLOCKS) / (Math.PI * 2) + stagger;
    const blkT = ((ph % 1) + 1) % 1;
    // A block that occupies 62% of the pitch with a chamfered leading and
    // trailing edge. A square pulse over 3 coarse columns made the crown read as
    // a ring of beads; a real tread block has a sloped shoulder into the groove.
    const blk = Math.max(0, Math.min(1, blkT / 0.075, (0.62 - blkT) / 0.075));
    const centre = Math.exp(-((y / (HW * 0.22)) ** 2) * 3); // circumferential groove
    const treadBand = Math.max(0, (rr / r - 0.9) / 0.1) * Math.max(0, 1 - Math.abs(y) / (HW * 0.72));
    // 9 mm of tread relief: enough to read as blocks at 3 m, not a monster truck
    const grow = treadBand * (blk * 0.0062 - 0.0018 - centre * 0.0045) * (r / 0.33);
    const f = 1 + grow / Math.max(1e-4, rr);
    // sidewall lettering / brand ring relief, pushed along the sidewall normal
    const band = Math.exp(-(((rr / r - 0.76) / 0.11) ** 2));
    const letter = band * ((Math.sin(a * 23 + stagger * 3) > 0.4 ? 0.006 : 0) + 0.0022) * (r / 0.33);
    pa.setXYZ(i, x * f, y * 0.94 + Math.sign(y) * letter, z * f);
  }
  g.computeVertexNormals();
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    const rr = Math.hypot(x, z);
    const crown = Math.min(1, Math.max(0, (rr / r - 0.88) / 0.12));
    const hole = Math.max(0, 1 - (rr / r - 0.5) / 0.12); // inside the bead
    const n = fbm3(x * 9, y * 9, z * 9, 2);
    // the crown is scrubbed clean-ish, the sidewalls and grooves hold dust
    out[0] = 0.25 + crown * 0.4 + n * 0.25;
    out[1] = 0.3 + (1 - crown) * 0.35 + Math.max(0, -ny) * 0.3;
    out[2] = 0.12 + (1 - crown) * 0.25 + Math.max(0, -ny) * 0.3 + hole * 0.5;
  });
  g.translate(0, HW * 0.95, 0);
  return g;
}

function pallet(rng) {
  const p = new PB();
  const w = 1.16;
  const d = 0.98;
  for (let i = 0; i < 3; i++) {
    const z = -d / 2 + 0.06 + (i / 2) * (d - 0.12);
    p.box(w, 0.075, 0.11, 0, 0.04, z, { bevel: 0.006, grime: 0.3 });
  }
  const boards = 6;
  for (let i = 0; i < boards; i++) {
    const z = -d / 2 + 0.05 + (i / (boards - 1)) * (d - 0.1);
    p.box(w, 0.018, 0.1, 0, 0.088, z, { bevel: 0.004, rz: rng.range(-0.004, 0.004) });
  }
  for (let i = 0; i < 3; i++) {
    const z = -d / 2 + 0.06 + (i / 2) * (d - 0.12);
    p.box(w, 0.018, 0.1, 0, -0.008, z, { bevel: 0.004 });
  }
  return p.build();
}

// ============================================================== furniture ==
function table(rng, w = 1.5, h = 0.78, d = 0.8) {
  const p = new PB();
  p.box(w, 0.045, d, 0, h - 0.02, 0, { bevel: 0.008, wear: 1 });
  p.box(w - 0.1, 0.05, d - 0.1, 0, h - 0.075, 0, { bevel: 0.006, grime: 0.3 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.box(0.07, h - 0.1, 0.07, sx * (w / 2 - 0.09), (h - 0.1) / 2, sz * (d / 2 - 0.09), {
        bevel: 0.005,
        grime: 0.25,
      });
  return p.build();
}

function stall(rng, w = 2.3) {
  // Market stall: trestle table, back board, cloth over the top, poles.
  const p = new PB();
  const h = 0.84;
  const d = 1.05;
  p.box(w, 0.05, d, 0, h, 0, { bevel: 0.008 });
  p.box(w - 0.06, 0.09, d - 0.08, 0, h - 0.07, 0, { bevel: 0.006, grime: 0.35 });
  for (const sx of [-1, 1]) {
    p.box(0.08, h - 0.05, 0.08, sx * (w / 2 - 0.1), (h - 0.05) / 2, d / 2 - 0.1, { grime: 0.3 });
    p.box(0.08, h - 0.05, 0.08, sx * (w / 2 - 0.1), (h - 0.05) / 2, -d / 2 + 0.1, { grime: 0.3 });
    // corner posts carrying the canopy
    p.box(0.06, 2.0, 0.06, sx * (w / 2 - 0.05), 1.0, -d / 2 + 0.06, { grime: 0.2 });
    p.box(0.06, 2.0, 0.06, sx * (w / 2 - 0.05), 1.0, d / 2 - 0.06, { grime: 0.2 });
  }
  p.box(w, 0.06, 0.06, 0, 1.98, -d / 2 + 0.06, {});
  p.box(w, 0.06, 0.06, 0, 1.98, d / 2 - 0.06, {});
  // shelf under the table
  p.box(w - 0.3, 0.03, d - 0.3, 0, 0.24, 0, { bevel: 0.004, grime: 0.45 });
  return p.build();
}

function shelfUnit(rng, w = 1.1, h = 1.9, d = 0.35) {
  const p = new PB();
  for (const sx of [-1, 1]) p.box(0.05, h, d, sx * (w / 2 - 0.025), h / 2, 0, { grime: 0.2 });
  const n = 4;
  for (let i = 0; i < n; i++) {
    const y = 0.22 + (i / (n - 1)) * (h - 0.4);
    p.box(w - 0.06, 0.03, d, 0, y, 0, { bevel: 0.005, grime: 0.25 });
  }
  p.box(w, 0.03, 0.02, 0, h - 0.02, -d / 2 + 0.01, {});
  return p.build();
}

function mattress(rng) {
  const g = chamferBox(1.85, 0.16, 0.85, 0.05);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    const n = fbm3(x * 3 + 4, y * 3, z * 3, 2);
    out[0] = 0.2;
    out[1] = 0.45 + n * 0.4;
    out[2] = Math.max(0, -ny) * 0.4;
  });
  // sag in the middle
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const y = pa.getY(i);
    const z = pa.getZ(i);
    if (y > 0) pa.setY(i, y - 0.035 * Math.cos((x / 1.85) * Math.PI) * Math.cos((z / 0.85) * Math.PI));
  }
  g.computeVertexNormals();
  g.translate(0, 0.08, 0);
  return g;
}

function chair(rng) {
  const p = new PB();
  const sh = 0.46;
  p.box(0.42, 0.04, 0.4, 0, sh, 0, { bevel: 0.006, wear: 1 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.box(0.04, sh, 0.04, sx * 0.18, sh / 2, sz * 0.17, { grime: 0.2 });
  p.box(0.42, 0.5, 0.035, 0, sh + 0.27, -0.18, { bevel: 0.005, rx: -0.08 });
  p.box(0.42, 0.06, 0.05, 0, sh + 0.48, -0.2, { bevel: 0.005 });
  return p.build();
}

function cabinet(rng, w = 0.9, h = 1.15, d = 0.44) {
  const p = new PB();
  p.box(w, h, d, 0, h / 2, 0, { bevel: 0.01, grime: 0.2 });
  for (const sx of [-1, 1]) {
    p.box(w / 2 - 0.03, h - 0.12, 0.03, sx * (w / 4), h / 2, d / 2 + 0.01, { bevel: 0.005, wear: 1 });
    p.box(0.03, 0.1, 0.03, sx * 0.06, h / 2, d / 2 + 0.03, { wear: 1 });
  }
  p.box(w + 0.04, 0.04, d + 0.04, 0, h + 0.02, 0, { bevel: 0.008, wear: 1, grime: 0.3 });
  return p.build();
}

// ================================================================ services ==
function acUnit(rng) {
  const p = new PB();
  const w = 0.78;
  const h = 0.55;
  const d = 0.34;
  p.box(w, h, d, 0, 0, 0, { bevel: 0.012, grime: 0.35 });
  // louvre grille on the face
  for (let i = 0; i < 7; i++) {
    p.box(w - 0.1, 0.035, 0.02, 0, -h / 2 + 0.08 + i * 0.06, d / 2 + 0.005, {
      bevel: 0.003,
      rx: 0.35,
      wear: 1,
    });
  }
  // fan ring
  p.cyl(0.19, 0.03, 0, 0.02, d / 2 + 0.02, { radial: 16, rx: Math.PI / 2, wear: 1 });
  // wall brackets
  for (const sx of [-1, 1]) {
    p.box(0.05, 0.05, 0.5, sx * (w / 2 - 0.05), -h / 2 + 0.03, -d / 2 - 0.16, { grime: 0.5 });
    p.box(0.05, 0.34, 0.05, sx * (w / 2 - 0.05), -h / 2 - 0.14, -d / 2 - 0.36, { grime: 0.5, rz: 0.5 });
  }
  // condensate drip stain hanger
  p.cyl(0.012, 0.5, w / 2 - 0.12, -h / 2 - 0.24, 0, { radial: 6, grime: 0.6 });
  const g = p.build();
  return g;
}

function satDish(rng) {
  const p = new PB();
  const dish = new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, 0.55);
  dish.scale(1, 0.42, 1);
  dish.rotateX(-2.1);
  autoEdgeWear(dish, 0.03, 0.8);
  p.geo(dish, 0, 0.55, 0.1, { autoWear: false, grime: 0.3 });
  p.cyl(0.03, 0.5, 0, 0.4, -0.12, { radial: 8, rx: 0.5, wear: 1 });
  p.cyl(0.045, 0.55, 0, 0.27, -0.22, { radial: 8, grime: 0.4 });
  p.box(0.24, 0.03, 0.24, 0, 0.02, -0.22, { bevel: 0.005, grime: 0.6 });
  p.cyl(0.028, 0.16, 0, 0.62, 0.34, { radial: 6, rx: 1.1, wear: 1 });
  return p.build();
}

function waterTank(rng) {
  const p = new PB();
  p.cyl(0.55, 1.0, 0, 0.5, 0, { radial: 18, grime: 0.3 });
  p.cyl(0.56, 0.05, 0, 0.99, 0, { radial: 18, wear: 1 });
  p.cyl(0.18, 0.09, 0.16, 1.05, 0, { radial: 12, wear: 1 });
  p.cyl(0.03, 0.5, -0.5, 0.2, 0, { radial: 6, grime: 0.5, rz: 0.3 });
  // cradle
  for (const sz of [-1, 1]) p.box(1.2, 0.09, 0.09, 0, 0.045, sz * 0.36, { grime: 0.5 });
  return p.build();
}

function roofVent(rng) {
  const p = new PB();
  p.box(0.5, 0.3, 0.5, 0, 0.15, 0, { bevel: 0.01, grime: 0.4 });
  p.cyl(0.17, 0.36, 0, 0.48, 0, { radial: 12, grime: 0.3 });
  p.cyl(0.24, 0.06, 0, 0.68, 0, { radial: 12, wear: 1 });
  p.cyl(0.2, 0.05, 0, 0.74, 0, { radial: 12, taper: 0.3, wear: 1 });
  return p.build();
}

function streetLamp(rng, h = 5.4) {
  const p = new PB();
  p.cyl(0.13, 0.35, 0, 0.17, 0, { radial: 12, grime: 0.6 });
  p.cyl(0.075, h, 0, h / 2, 0, { radial: 10, taper: 0.7, grime: 0.25 });
  // Curved arm made of short segments, with a diagonal stay back to the post.
  // The stay matters: without it the head is a box floating a metre off the
  // column, and the moment the column is occluded by a roofline the whole lamp
  // reads as a detached prop hanging in the sky.
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const a = t * 1.35;
    p.cyl(0.055, 0.44, Math.sin(a) * 0.62 * (0.4 + t), h - 0.1 + Math.cos(a) * 0.34 * t, 0, {
      radial: 8,
      rz: -a,
      grime: 0.3,
    });
  }
  p.cyl(0.028, 0.95, 0.32, h - 0.42, 0, { radial: 6, rz: -0.72, grime: 0.4 });
  p.box(0.1, 0.16, 0.1, 0.05, h - 0.72, 0, { bevel: 0.01, grime: 0.45 });
  p.box(0.5, 0.13, 0.28, 0.86, h + 0.06, 0, { bevel: 0.02, rz: -0.16, grime: 0.35 });
  p.box(0.42, 0.06, 0.22, 0.88, h - 0.02, 0, { bevel: 0.01, rz: -0.16, wear: 1 });
  return p.build();
}

/** The lamp's diffuser, kept separate so it can use a glassy material. */
function lampGlass() {
  const g = chamferBox(0.4, 0.05, 0.2, 0.01);
  fillMasks(g, 0.2, 0.1, 0);
  return g;
}

// ================================================================== debris ==
function brickChunk(rng) {
  const g = rockGeometry(rng, 0.22, 0, 0.55);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.5 + fbm3(x * 9, y * 9, z * 9, 2) * 0.5;
    out[1] = 0.4 + Math.max(0, -ny) * 0.4;
    out[2] = 0.25;
  });
  return g;
}

function slabShard(rng) {
  const p = new PB();
  const w = rng.range(0.5, 0.95);
  const d = rng.range(0.35, 0.7);
  const pts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rr = 0.5 * (0.6 + fbm3(Math.cos(t) * 3 + 2, Math.sin(t) * 3, 5, 2) * 0.8);
    pts.push([Math.cos(t) * rr * w, Math.sin(t) * rr * d]);
  }
  const g = polyPrism(pts, rng.range(0.07, 0.13));
  autoEdgeWear(g, 0.02, 1);
  p.geo(g, 0, 0, 0, { autoWear: false, grime: 0.4 });
  // rebar sticking out, bent
  const bars = rng.int(2, 4);
  for (let i = 0; i < bars; i++) {
    const a = rng.float() * Math.PI * 2;
    p.cyl(0.008, rng.range(0.3, 0.7), Math.cos(a) * w * 0.3, 0.06, Math.sin(a) * d * 0.3, {
      radial: 5,
      rz: rng.range(-1.4, 1.4),
      rx: rng.range(-1.2, 1.2),
      grime: 0.5,
    });
  }
  return p.build();
}

function rebarBundle(rng) {
  const p = new PB();
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    p.cyl(0.009, rng.range(1.4, 2.6), rng.range(-0.08, 0.08), 0.012 + i * 0.019, rng.range(-0.06, 0.06), {
      radial: 5,
      rx: Math.PI / 2,
      ry: rng.range(-0.12, 0.12),
      grime: 0.55,
    });
  }
  return p.build();
}

function plank(rng) {
  const g = chamferBox(rng.range(0.9, 2.1), 0.035, rng.range(0.12, 0.2), 0.005);
  autoEdgeWear(g, 0.012, 1);
  warpGeometry(g, 0.012, 1.4, rng.float() * 9);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    out[1] = Math.min(1, out[1] + 0.3 + Math.max(0, -ny) * 0.4);
  });
  return g;
}

/**
 * The swept fillet of dust and grit that piles against anything left standing
 * on a street. Unit radius (put() scales it), 2.5 cm proud at the object and
 * feathering to nothing at the rim, with a jagged outline so it never reads as
 * a disc. Grime mask driven hard at the centre so the material's own cavity
 * grime darkens the contact line.
 */
function dustSkirt(rng) {
  const RAD = 4;
  const SEG = 26;
  const g = new THREE.CylinderGeometry(1, 1, 0, SEG, RAD);
  const pa = g.getAttribute('position');
  const col = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const z = pa.getZ(i);
    const d = Math.min(1, Math.hypot(x, z));
    const a = Math.atan2(z, x);
    // ragged outline: the rim wanders +/-22%
    const wob = 0.86 + 0.28 * fbm3(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 3.1, 3);
    const dd = d * wob;
    pa.setX(i, x * wob);
    pa.setZ(i, z * wob);
    // (1-d)^2 profile: steep against the object, flat at the edge
    const t = Math.max(0, 1 - dd);
    pa.setY(i, t * t * 0.021 + (fbm3(x * 6, z * 6, 9.4, 3) - 0.5) * 0.004 * (1 - dd));
    col[i * 3] = 0.05;
    col[i * 3 + 1] = 0.35 + 0.6 * t;
    col[i * 3 + 2] = 0.3 + 0.55 * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function litterPaper(rng) {
  const g = new THREE.PlaneGeometry(rng.range(0.1, 0.22), rng.range(0.1, 0.28), 2, 2);
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setZ(i, (fbm3(pa.getX(i) * 20, pa.getY(i) * 20, 3, 2) - 0.5) * 0.035);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  fillMasks(g, 0.3, 0.5, 0.2);
  return g;
}

function bottle(rng) {
  const p = new PB();
  p.cyl(0.038, 0.17, 0, 0.085, 0, { radial: 10, grime: 0.3 });
  p.cyl(0.02, 0.08, 0, 0.2, 0, { radial: 8, taper: 0.8 });
  return p.build();
}

function can(rng) {
  const g = new THREE.CylinderGeometry(0.033, 0.033, 0.115, 10, 1);
  autoEdgeWear(g, 0.01, 1);
  // crushed
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    pa.setX(i, pa.getX(i) * (1 - Math.abs(y) * 1.2));
  }
  g.computeVertexNormals();
  g.rotateZ(1.4);
  g.translate(0, 0.033, 0);
  return g;
}

// ============================================================== vegetation ==
function palmTree(rng, h = 5.2) {
  const p = new PB();
  const segs = 9;
  const lean = rng.range(-0.1, 0.1);
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const r = 0.19 * (1 - t * 0.42);
    const y = t * h;
    const x = Math.sin(t * 2.2 + lean * 4) * lean * h * 0.4;
    p.cyl(r, h / segs + 0.02, x, y + h / segs / 2, 0, {
      radial: 9,
      taper: 0.92,
      grime: 0.3 + t * 0.2,
      wear: 1,
    });
    // ring scars where old fronds broke off
    p.cyl(r * 1.13, 0.045, x, y + h / segs * 0.75, 0, { radial: 9, wear: 1, grime: 0.4 });
  }
  const topX = Math.sin(2.2 + lean * 4) * lean * h * 0.4;
  const g = p.build();
  g.userData = { topX, topY: h };
  return g;
}

/** One palm frond: leaflets along a curved spine, foliage-textured quads. */
function palmFrond(rng, len = 2.6) {
  const list = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const x = t * len;
    const droop = -t * t * len * 0.42;
    const lw = (0.42 + Math.sin(t * Math.PI) * 0.55) * (1 - t * 0.35);
    for (const side of [-1, 1]) {
      const q = new THREE.PlaneGeometry(lw, 0.16, 1, 1);
      q.translate(lw / 2, 0, 0);
      const m = mat(x, droop, 0, 0, 0, 0);
      const rot = new THREE.Matrix4().makeRotationZ(-0.5 - t * 0.5);
      const yaw = new THREE.Matrix4().makeRotationY(side * (1.15 - t * 0.35));
      q.applyMatrix4(rot);
      q.applyMatrix4(yaw);
      q.applyMatrix4(m);
      fillMasks(q, 0.2, 0.25, 0);
      list.push(q);
    }
  }
  // spine
  const spine = new THREE.PlaneGeometry(len, 0.05, 6, 1);
  const pa = spine.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i) + len / 2;
    pa.setXYZ(i, x, pa.getY(i) - ((x / len) ** 2) * len * 0.42, pa.getZ(i));
  }
  spine.computeVertexNormals();
  fillMasks(spine, 0.2, 0.3, 0);
  list.push(spine);
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

function shrub(rng, s = 0.8) {
  const list = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const q = new THREE.PlaneGeometry(s * rng.range(0.7, 1.15), s * rng.range(0.6, 1.0), 1, 1);
    const m = mat(
      rng.range(-s * 0.2, s * 0.2),
      s * rng.range(0.28, 0.6),
      rng.range(-s * 0.2, s * 0.2),
      rng.float() * Math.PI,
      rng.range(-0.4, 0.4),
      rng.range(-0.3, 0.3)
    );
    q.applyMatrix4(m);
    fillMasks(q, 0.2, 0.35, 0.2);
    list.push(q);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

function weedTuft(rng) {
  const list = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const q = new THREE.PlaneGeometry(rng.range(0.18, 0.34), rng.range(0.14, 0.3), 1, 1);
    q.applyMatrix4(
      mat(rng.range(-0.06, 0.06), rng.range(0.07, 0.17), rng.range(-0.06, 0.06), rng.float() * 3.14, rng.range(-0.5, 0.5), 0)
    );
    fillMasks(q, 0.2, 0.5, 0.3);
    list.push(q);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

function planter(rng) {
  const p = new PB();
  p.cyl(0.34, 0.42, 0, 0.21, 0, { radial: 14, taper: 0.78, grime: 0.4 });
  p.cyl(0.36, 0.05, 0, 0.42, 0, { radial: 14, wear: 1 });
  p.cyl(0.3, 0.06, 0, 0.4, 0, { radial: 12, grime: 0.9 });
  return p.build();
}

// ================================================================= signage ==
function signBoard(rng, w = 1.5, h = 0.5) {
  const p = new PB();
  p.box(w, h, 0.05, 0, 0, 0, { bevel: 0.008, grime: 0.25 });
  p.box(w + 0.05, 0.045, 0.07, 0, h / 2, 0, { bevel: 0.006, wear: 1 });
  p.box(w + 0.05, 0.045, 0.07, 0, -h / 2, 0, { bevel: 0.006, wear: 1 });
  for (const sx of [-1, 1]) p.box(0.03, 0.24, 0.12, sx * (w / 2 - 0.12), 0, -0.08, { grime: 0.5 });
  return p.build();
}

function signHanging(rng, w = 0.9, h = 0.62) {
  const p = new PB();
  p.box(w, h, 0.04, 0, -h / 2 - 0.12, 0, { bevel: 0.006, grime: 0.3 });
  p.cyl(0.014, 0.14, -w / 2 + 0.08, -0.06, 0, { radial: 6, wear: 1 });
  p.cyl(0.014, 0.14, w / 2 - 0.08, -0.06, 0, { radial: 6, wear: 1 });
  p.cyl(0.018, w + 0.14, 0, 0, 0, { radial: 6, rz: Math.PI / 2, wear: 1, grime: 0.4 });
  return p.build();
}

// ================================================================ vehicles ==
/**
 * A burnt-out saloon. Built as one merged geometry per material group and
 * returned so the caller can place one or two — silhouette first: sagging roof,
 * blown glass, missing wheels, doors hanging.
 */
export function burntCar(rng) {
  const body = new PB();
  const L = 4.35;
  const W = 1.78;
  // main body tub
  body.box(W, 0.5, L, 0, 0.62, 0, { bevel: 0.05, grime: 0.5 });
  body.box(W * 0.99, 0.34, L * 0.62, 0, 0.95, -0.15, { bevel: 0.06, grime: 0.5 });
  // bonnet + boot
  body.box(W * 0.94, 0.13, L * 0.3, 0, 0.94, L * 0.33, { bevel: 0.03, rx: 0.06, wear: 1 });
  body.box(W * 0.94, 0.13, L * 0.22, 0, 0.95, -L * 0.38, { bevel: 0.03, rx: -0.08, wear: 1 });
  // cabin: A/B/C pillars and a sagging roof
  const rh = 1.42;
  for (const sx of [-1, 1]) {
    body.box(0.09, 0.55, 0.1, sx * (W / 2 - 0.08), 1.2, L * 0.14, { rx: 0.35, grime: 0.4 });
    body.box(0.09, 0.5, 0.1, sx * (W / 2 - 0.08), 1.22, -L * 0.02, { grime: 0.4 });
    body.box(0.11, 0.52, 0.12, sx * (W / 2 - 0.08), 1.2, -L * 0.2, { rx: -0.3, grime: 0.4 });
    // sills and door skins
    body.box(0.07, 0.42, L * 0.42, sx * (W / 2 - 0.03), 0.68, 0.05, { bevel: 0.02, wear: 1, grime: 0.5 });
  }
  body.box(W * 0.86, 0.07, L * 0.36, 0, rh - 0.04, -L * 0.04, { bevel: 0.04, wear: 1, grime: 0.6 });
  // wheel arches
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      body.cyl(0.42, 0.1, sx * (W / 2 - 0.04), 0.5, sz * L * 0.31, {
        radial: 12,
        rz: Math.PI / 2,
        open: true,
        grime: 0.5,
      });
    }
  // bumpers
  body.box(W * 0.98, 0.22, 0.16, 0, 0.5, L / 2 - 0.05, { bevel: 0.03, wear: 1, grime: 0.5 });
  body.box(W * 0.98, 0.22, 0.16, 0, 0.5, -L / 2 + 0.05, { bevel: 0.03, wear: 1, grime: 0.5, rz: 0.05 });
  const g = body.build();
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    // soot: heaviest around the cabin and upward faces
    const soot = 0.45 + 0.5 * Math.max(0, ny) + 0.3 * Math.max(0, 1 - Math.abs(z) / 1.6);
    out[1] = Math.min(1, out[1] + soot * 0.8);
    out[0] = Math.min(1, out[0] * 0.8);
  });
  return g;
}

// =============================================================== registry ==
/**
 * Register every instanced prototype. Called once, before the level is built.
 * Prototype ids are the vocabulary dressing.js and interiors.js draw from.
 */
export function registerProps(A, rngIn) {
  const rng = rngIn;
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });
  /**
   * Mark a prototype as a LOOSE object: something a person dropped, stacked or
   * kicked, which is therefore never plumb and never exactly the nominal size.
   * `tilt` is the maximum knock out of true in radians (0.09 ~ 5 deg) and `sink`
   * pushes it down far enough that the corner the tilt raises does not float off
   * the ground. Fixed things — lamp posts, signs, wall pocks, bottles standing
   * on a table — deliberately do not get one.
   */
  const LOOSE = (tilt, sink) => ({ tilt, sink });

  // containers
  P('crate_a', 'wood_prop', crate(rng, 0.64), { skirt: 0.37, ...LOOSE(0.09, 0.022) });
  P('crate_b', 'wood_prop', crate(rng, 0.48), LOOSE(0.10, 0.018));
  P('crate_c', 'wood_prop_dark', crate(rng, 0.82), { skirt: 0.45, ...LOOSE(0.075, 0.026) });
  P('crate_flat', 'wood_prop', crate(rng, 0.55, false), LOOSE(0.10, 0.02));
  P('box_card_a', 'wood_pale', cardboardBox(rng, 0.46), LOOSE(0.10, 0.016));
  P('box_card_b', 'wood_pale', cardboardBox(rng, 0.34), LOOSE(0.11, 0.012));
  P('barrel_rust', 'metal_rust_prop', barrel(rng), { skirt: 0.28, ...LOOSE(0.085, 0.014) });
  P('barrel_blue', 'metal_blue', barrel(rng, 0.28, 0.9, 2), { skirt: 0.26, ...LOOSE(0.085, 0.014) });
  P('barrel_wood', 'wood_prop_dark', barrel(rng, 0.31, 0.78, 4), { skirt: 0.28, ...LOOSE(0.09, 0.015) });
  P('gas_bottle', 'metal_green', gasBottle(rng), { skirt: 0.18, ...LOOSE(0.07, 0.008) });
  P('bucket', 'metal_rust_prop', bucket(rng), LOOSE(0.12, 0.008));
  P('jerry_can', 'metal_green', jerryCan(rng), LOOSE(0.10, 0.01));

  // cover
  P('sandbag_a', 'burlap', sandbag(rng, 0), LOOSE(0.085, 0.006));
  P('sandbag_b', 'burlap', sandbag(rng, 1), LOOSE(0.09, 0.006));
  P('sandbag_c', 'burlap', sandbag(rng, 2), LOOSE(0.095, 0.006));
  P('jersey', 'concrete_prop', jerseyBarrier(rng), { skirt: 0.69, maxDist: 0 });
  P('block_big', 'concrete_prop', concreteBlock(rng, 1.25, 0.95, 0.85), { skirt: 0.63, ...LOOSE(0.05, 0.03) });
  P('block_small', 'concrete_dark', concreteBlock(rng, 0.55, 0.42, 0.4), { skirt: 0.31, ...LOOSE(0.09, 0.018) });
  P('tyre', 'rubber', tyre(rng), { skirt: 0.33, ...LOOSE(0.10, 0.008) });
  P('tyre_small', 'rubber', tyre(rng, 0.26), LOOSE(0.11, 0.006));
  P('pallet', 'wood_prop', pallet(rng), { skirt: 0.51, ...LOOSE(0.055, 0.02) });

  // furniture
  P('table', 'wood_prop_dark', table(rng, 1.5, 0.78, 0.8), { skirt: 0.57 });
  P('table_small', 'wood_prop', table(rng, 0.9, 0.72, 0.7));
  P('stall', 'wood_prop_dark', stall(rng, 2.3), { skirt: 0.90, maxDist: 0 });
  P('shelf', 'wood_prop_dark', shelfUnit(rng), { skirt: 0.42 });
  P('mattress', 'fabric_cream', mattress(rng), LOOSE(0.06, 0.01));
  P('chair', 'wood_prop', chair(rng), LOOSE(0.05, 0.012));
  P('cabinet', 'wood_prop_dark', cabinet(rng), { skirt: 0.42 });

  // services
  P('ac_unit', 'metal_dark', acUnit(rng));
  P('sat_dish', 'metal_dark', satDish(rng));
  P('water_tank', 'metal_blue', waterTank(rng), { skirt: 0.48 });
  P('roof_vent', 'metal_rust', roofVent(rng));
  P('lamp_post', 'metal_dark', streetLamp(rng), { skirt: 0.25, chunk: false });
  P('lamp_glass', 'lamp_lens', lampGlass(), { chunk: false, castShadow: false });

  // debris
  P('brick_a', 'brick', brickChunk(rng), LOOSE(0.16, 0.006));
  P('brick_b', 'brick', brickChunk(rng), LOOSE(0.16, 0.006));
  P('rock_a', 'concrete_prop', rockGeometry(rng, 0.26, 0, 0.7), { maxDist: 90 });
  P('rock_b', 'concrete_dark', rockGeometry(rng, 0.17, 0, 0.8), { maxDist: 70, castShadow: false });
  P('slab_shard', 'concrete_prop', slabShard(rng), LOOSE(0.14, 0.01));
  P('rebar', 'metal_rust', rebarBundle(rng), LOOSE(0.10, 0.004));
  P('plank_a', 'wood_prop', plank(rng), { maxDist: 90, ...LOOSE(0.06, 0.004) });
  P('plank_b', 'wood_prop_dark', plank(rng), { maxDist: 90, ...LOOSE(0.06, 0.004) });
  P('litter', 'wood_pale', litterPaper(rng), { maxDist: 45, castShadow: false });
  /**
   * Contact fillets. Registered last so `put()` can find it, and never given a
   * skirt of its own. maxDist keeps them off the far half of the map, where
   * the contact line is a pixel wide anyway.
   */
  P('dust_skirt', 'dust_skirt', dustSkirt(rng), { maxDist: 42, castShadow: false });
  P('bottle', 'glass', bottle(rng), { maxDist: 55, castShadow: false });
  P('can', 'steel', can(rng), { maxDist: 45, castShadow: false });

  // vegetation
  const palm = palmTree(rng, 5.4);
  P('palm_trunk', 'wood_dark', palm, { skirt: 0.57, chunk: false });
  P('palm_frond', 'foliage', palmFrond(rng, 2.7), { chunk: false, receiveShadow: true });
  P('shrub', 'foliage', shrub(rng, 0.85));
  P('weeds', 'foliage', weedTuft(rng), { maxDist: 40 });
  P('planter', 'concrete_prop', planter(rng), { skirt: 0.33, ...LOOSE(0.07, 0.014) });

  // signage
  P('sign_board', 'metal_blue', signBoard(rng, 1.6, 0.55), { skirt: 0.18 });
  P('sign_hang', 'metal_green', signHanging(rng));

  // damage
  // 3.2 cm base radius: the callers scale it 0.5-1.5x, so pocks land at 3-10 cm
  // across. At the old 5.5 cm base a single rifle strike was 16 cm wide.
  P('pock', 'concrete_dark', pockGeometry(rng, 0.032), { maxDist: 65, castShadow: false });
  return A;
}
