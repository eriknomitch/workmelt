/**
 * AI — body & clothing parts for the procedural soldier.
 *
 * Each function returns a mesh record in the actor's bind space (metres, feet
 * on y = 0, facing +Z, character's right at -X). `soldier.js` decides which
 * parts a variant wears and hands them to the CharacterBuilder along with the
 * bones they bind to.
 *
 * LOW POLY. Every section count here goes through `F` (around the ring) or `R`
 * (along the length), and every sub-centimetre displacement goes through
 * `MICRO`. The three constants are the whole art direction: a character is a
 * faceted block of colour, flat-shaded, and it is read by SILHOUETTE and HUE
 * rather than by surface. That is why the counts are scaled in one place
 * instead of being retyped — the shapes below are still authored at the
 * resolution the anatomy wants, and the build decides how much of it survives.
 */

import * as THREE from 'three';
import {
  emptyMesh, loft, tube, ribbon, revolve, ellipsoid, boxRound, superEllipse,
  ellipseProfile, appendMesh, computeNormals, displace as displaceFine, warp,
  transformMesh, vcount,
} from './geo.js';

/**
 * Sections around a ring — tube profiles, revolved shells, ribbon
 * cross-sections. 0.45, floor 3: a sleeve drops 16 -> 7 sides and a strap
 * 6 -> 3, which is where the facets become the surface rather than an
 * artifact of it.
 */
export const F = (n) => Math.max(3, Math.round(n * 0.45));

/**
 * Sections along a length — loft rings, `boxRound` rows, `limbTube` rings.
 * 0.42, floor 3. Lower than `F` on purpose: a limb's silhouette is carried by
 * its ring profile, so the rings between the joints are the cheapest thing on
 * the character to give up.
 */
export const R = (n) => Math.max(3, Math.round(n * 0.42));

/**
 * Amplitude scale for every sub-centimetre displacement field: wrinkles, fold
 * noise, crease bands, pore jitter.
 *
 * ZERO, and not as an oversight. Those fields existed to be read as a NORMAL
 * MAP by a smooth-shaded surface; the characters are `flatShading: true` now
 * (see livery.js), and three shades a flat-shaded fragment from the screen-space
 * derivatives of the position, so the vertex normals those fields were computed
 * to perturb are never sampled. All they could still do is jitter the facets of
 * a 7-sided limb, which reads as noise, not as cloth. Raise it and the wrinkle
 * fields come back exactly as authored.
 */
export const MICRO = 0;

/** `displace`, scaled by MICRO — a no-op, and free, at MICRO 0. */
export const displace = (mesh, fn) =>
  MICRO > 0 ? displaceFine(mesh, (...a) => fn(...a) * MICRO) : mesh;

const V = (x, y, z) => [x, y, z];

/** Cylindrical wrap about the Y axis — bends flat slabs around the torso. */
export function bendY(mesh, radius, centreZ = 0) {
  return warp(mesh, (v) => {
    const r = radius + (v.z - centreZ);
    const a = v.x / radius;
    v.x = Math.sin(a) * r;
    v.z = centreZ + Math.cos(a) * r - radius;
  });
}

/** Mirror across X (right <-> left) and fix the winding. */
export function mirrorX(mesh) {
  const out = { p: mesh.p.slice(), n: mesh.n.slice(), uv: mesh.uv.slice(), i: mesh.i.slice() };
  for (let i = 0; i < out.p.length; i += 3) out.p[i] = -out.p[i];
  for (let i = 0; i < out.n.length; i += 3) out.n[i] = -out.n[i];
  for (let t = 0; t < out.i.length; t += 3) {
    const tmp = out.i[t + 1];
    out.i[t + 1] = out.i[t + 2];
    out.i[t + 2] = tmp;
  }
  return out;
}

export function place(mesh, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz)
  );
  computeNormals(mesh);
  return transformMesh(mesh, m);
}

/* ================================================================== */
/* Torso                                                              */
/* ================================================================== */

/**
 * The jacket shell: lofted horizontal sections from the hem to the neck with a
 * real spinal curve, a deeper chest than back, and layered fold noise. This is
 * the silhouette everything else hangs on.
 */
export function jacketTorso(nz, p = {}) {
  const flare = p.flare ?? 1;
  const bulk = p.bulk ?? 1;
  // y, half-width, half-depth, z offset, corner exponent
  const S = [
    [0.865, 0.150 * flare, 0.107 * flare, -0.004, 3.0],
    [0.925, 0.156, 0.110, -0.008, 3.0],
    [0.985, 0.152, 0.105, -0.012, 3.1],
    [1.055, 0.146, 0.100, -0.014, 3.2],
    [1.120, 0.150, 0.104, -0.010, 3.2],
    [1.185, 0.161, 0.112, -0.004, 3.1],
    [1.250, 0.172 * bulk, 0.113 * bulk, 0.002, 3.0],
    [1.310, 0.184 * bulk, 0.117 * bulk, 0.005, 2.9],
    [1.365, 0.195 * bulk, 0.118 * bulk, 0.004, 2.8],
    [1.418, 0.198, 0.111, -0.002, 2.7],
    [1.452, 0.152, 0.096, -0.008, 2.6],
    [1.482, 0.098, 0.080, -0.010, 2.4],
    [1.505, 0.070, 0.066, -0.010, 2.3],
  ];
  const seg = F(26);
  const rings = S.map(([y, hx, hz, zo, n]) => ({
    pts: superEllipse(hx, hz, n, seg),
    o: [0, y, zo],
  }));
  const m = loft(rings, { capStart: true, capEnd: false });
  computeNormals(m);

  // chest deeper at the front than the back, shoulders squared off
  warp(m, (v) => {
    const t = Math.max(0, Math.min(1, (v.y - 1.1) / 0.3));
    if (v.z > 0) v.z += 0.016 * t;
    else v.z -= 0.006 * t;
    // trapezius slope
    if (v.y > 1.40) v.y -= 0.02 * Math.min(1, Math.abs(v.x) / 0.18) ** 2;
  });
  computeNormals(m);

  // cloth folds: horizontal creases at the waist, vertical pull from the plate
  displace(m, (x, y, z, nx, ny, nz2) => {
    const fold = nz.fbm3(x * 22, y * 15, z * 22, 3);
    const crease = Math.sin(y * 38 + fold * 3.4) * 0.5 + 0.5;
    const waist = Math.exp(-((y - 1.06) ** 2) / 0.006);
    const gather = Math.exp(-((y - 0.93) ** 2) / 0.004);
    return (
      fold * 0.0026 +
      crease * (waist * 0.0022 + gather * 0.0018) +
      nz.fbm3(x * 46, y * 46, z * 46, 2) * 0.0007
    );
  });
  return m;
}

/** Pelvis / seat block so the hips read solid between jacket hem and trousers. */
export function pelvis(nz) {
  const seg = F(22);
  const rings = [
    [0.845, 0.140, 0.100],
    [0.885, 0.148, 0.106],
    [0.935, 0.152, 0.108],
    [0.985, 0.150, 0.104],
    [1.030, 0.144, 0.098],
  ].map(([y, hx, hz]) => ({ pts: superEllipse(hx, hz, 3.0, seg), o: [0, y, -0.006] }));
  const m = loft(rings, { capStart: true, capEnd: true });
  computeNormals(m);
  displace(m, (x, y, z) => nz.fbm3(x * 26, y * 20, z * 26, 3) * 0.004);
  return m;
}

/** Collar: a short stand-up band around the neck. */
export function collar(nz) {
  const seg = F(22);
  const rings = [
    [1.435, 0.108, 0.092],
    [1.470, 0.090, 0.082],
    [1.500, 0.082, 0.076],
    [1.516, 0.086, 0.080],
  ].map(([y, hx, hz]) => ({ pts: superEllipse(hx, hz, 2.6, seg), o: [0, y, -0.006] }));
  const m = loft(rings, { capStart: false, capEnd: true });
  computeNormals(m);
  displace(m, (x, y, z) => nz.fbm3(x * 40, y * 30, z * 40, 2) * 0.003);
  return m;
}

/* ================================================================== */
/* Limbs                                                              */
/* ================================================================== */

/**
 * Sleeve / trouser leg: a tube down a 3-point bone chain with an elliptical
 * cross-section that is wider than deep, plus fold noise at the joints.
 *
 * CLOTH FOLDS (`opts.crease`) — isotropic fbm on a tube gives a lumpy tube, not
 * cloth. Real sleeves and trousers crease in bands that run *around* the limb,
 * they bunch where the limb bends, and they gather at the cuff where the fabric
 * is stopped by a hem. So the crease field is parameterised by arc length `s`
 * down the bone chain, not by world position:
 *
 *   - transverse bands at 5-7 cm, ridged so each one is a sharp line with a soft
 *     valley either side (that is what a pressed crease looks like in light);
 *   - a x2.4 gather inside the elbow / behind the knee (`s` near the joint, on
 *     the bend side), which is the single most legible fold on a walking figure;
 *   - a x1.8 gather at the cuff, where the fabric stacks on the boot or glove.
 *
 * `opts.bend` is the direction the joint folds toward in bind space (default
 * -Z, i.e. behind the knee / inside the elbow for a figure facing +Z).
 */
export function limbTube(nz, a, b, c, radii, opts = {}) {
  const pts = [];
  // Scaled here rather than at the call sites so a caller still states the
  // count the anatomy wants and the build decides what survives.
  const N = R(opts.rings ?? 11);
  const segs = F(opts.seg ?? 14);
  // sample the two-segment path with a smooth blend around the joint
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    if (t <= 0.5) tmp.lerpVectors(A, B, t * 2);
    else tmp.lerpVectors(B, C, (t - 0.5) * 2);
    // round the corner slightly so the knee/elbow is not a crease
    if (t > 0.34 && t < 0.66) {
      const k = 1 - Math.abs(t - 0.5) / 0.16;
      tmp.lerp(new THREE.Vector3().addVectors(A, C).multiplyScalar(0.5), 0.06 * k);
    }
    pts.push([tmp.x, tmp.y, tmp.z]);
  }
  const flat = opts.flat ?? 0.88;
  const m = tube(
    pts,
    (t) => {
      const r = radiusAt(radii, t);
      return ellipseProfile(r, r * flat, segs);
    },
    { capStart: opts.capStart ?? false, capEnd: opts.capEnd ?? false, up: opts.up ?? [0, 0, 1] }
  );
  computeNormals(m);
  const amp = opts.fold ?? 0.0016;
  const crease = opts.crease ?? 0;
  if (crease > 0) {
    // arc-length parameterisation of the two-segment chain
    const AB = new THREE.Vector3().subVectors(B, A);
    const BC = new THREE.Vector3().subVectors(C, B);
    const lAB = AB.length(), lBC = BC.length();
    const uAB = AB.clone().divideScalar(Math.max(1e-5, lAB));
    const uBC = BC.clone().divideScalar(Math.max(1e-5, lBC));
    const total = lAB + lBC;
    const bend = new THREE.Vector3(...(opts.bend ?? [0, 0, -1])).normalize();
    const q = new THREE.Vector3();
    displace(m, (x, y, z, nx, ny, nzc) => {
      // distance along the chain, and how far out along the bend axis we are
      const tAB = Math.max(0, Math.min(lAB, q.set(x, y, z).sub(A).dot(uAB)));
      const tBC = Math.max(0, Math.min(lBC, q.set(x, y, z).sub(B).dot(uBC)));
      const s = tAB < lAB - 1e-4 ? tAB : lAB + tBC;
      const u = s / total;
      // transverse crease bands: ridged, 5.5 cm, jittered so they are not a
      // corduroy ripple
      const jit = nz.fbm3(x * 6, y * 5, z * 6, 2) - 0.5;
      const band = Math.abs(Math.sin((s / 0.055 + jit * 0.9) * Math.PI));
      const ridged = 1 - band ** 0.65;
      // where the cloth actually bunches
      const joint = Math.exp(-((u - 0.5) ** 2) / 0.012);
      const cuff = Math.exp(-((u - 0.94) ** 2) / 0.004);
      const inner = Math.max(0, bend.x * nx + bend.y * ny + bend.z * nzc);
      const gather = 1 + joint * (0.6 + 1.8 * inner) + cuff * 0.8;
      // broad fold field on top, so the limb is never a clean cylinder
      const broad = nz.fbm3(x * 9, y * 7 + u * 3.1, z * 9, 3) - 0.5;
      return crease * (ridged * gather * 0.9 + broad * 1.1);
    });
    computeNormals(m);
  }
  displace(m, (x, y, z) => {
    const f = nz.fbm3(x * 11, y * 9, z * 11, 3);
    const fine = nz.fbm3(x * 34, y * 30, z * 34, 2);
    return f * amp + fine * amp * 0.3;
  });
  return m;
}

function radiusAt(radii, t) {
  const n = radii.length - 1;
  const s = t * n;
  const i = Math.min(n - 1, Math.floor(s));
  const f = s - i;
  return radii[i] + (radii[i + 1] - radii[i]) * f;
}

/** Deltoid cap so the shoulder is round rather than a tube end. */
export function shoulderCap(nz, shoulder, side) {
  const m = ellipsoid(0.052, 0.064, 0.056, { seg: F(18), rows: R(12) });
  computeNormals(m);
  warp(m, (v) => {
    v.y *= 1.0;
    if (v.y < 0) v.x *= 0.9;
  });
  place(m, shoulder[0] + side * 0.012, shoulder[1] - 0.008, shoulder[2], 0, 0, -side * 0.12);
  displace(m, (x, y, z) => nz.fbm3(x * 30, y * 30, z * 30, 3) * 0.004);
  return m;
}

/* ================================================================== */
/* Head                                                              */
/* ================================================================== */

/**
 * The head: a faceted block on the skull's proportions. `base` = Head bone.
 *
 * NO FACE, and that is the whole specification. The nose, ears and eyeballs
 * that used to sit on this are gone, and so are the brow ridge, eye sockets,
 * cheekbones, temple flattening, chin and occiput that used to be warped into
 * these sections. What is left is the head's SHAPE — taller than wide, flat at
 * the temples, tapering to the crown — which is all the silhouette needs, and
 * which the helmet, visor band and mask are then read against.
 *
 * Anatomy was never going to survive here anyway: a face is a 3 cm feature set,
 * the head is nine sections of an eleven-sided ring, and it is drawn in one
 * accent colour with no texture. Modelling a nose at this resolution buys a
 * lump, not a face — and a lump on a bright flat colour is worse than nothing.
 */
export function headMesh(nz, base, p = {}) {
  const w = p.wide ?? 1;
  // y, half-width, half-depth, z offset, corner exponent. The exponents stay
  // low (2.4-2.6) because a superellipse near 2 is a rounded box in plan, which
  // is what gives the faceted head its squared temples.
  const S = [
    [0.000, 0.038 * w, 0.050, 0.020, 2.6],
    [0.030, 0.062 * w, 0.072, 0.012, 2.6],
    [0.070, 0.077 * w, 0.083, 0.001, 2.5],
    [0.110, 0.086 * w, 0.090, -0.004, 2.4],
    [0.150, 0.083 * w, 0.089, -0.010, 2.4],
    [0.190, 0.071 * w, 0.077, -0.013, 2.4],
    [0.225, 0.045 * w, 0.048, -0.014, 2.4],
    [0.244, 0.012 * w, 0.013, -0.014, 2.4],
  ];
  const seg = F(24);
  const rings = S.map(([y, hx, hz, zo, n]) => ({
    pts: superEllipse(hx, hz, n, seg),
    o: [base[0], base[1] + y, base[2] + zo],
  }));
  const m = loft(rings, { capStart: true, capEnd: false });
  computeNormals(m);
  return m;
}

/**
 * Balaclava / shemagh wrap over the lower face and neck.
 *
 * The wrap is not just a dome: the thing that makes a covered face read as a
 * FACE at 35 m is the hem seam along the eye line plus the bridge fold over the
 * nose. Without them the lower head is one smooth value and the figure has no
 * legible facing direction — which is exactly the "featureless void" note. Both
 * are built as geometry (a rolled hem ribbon and a centre-front seam) so they
 * survive to whatever mip the diffuse ends up at.
 */
export function faceWrap(nz, base, p = {}) {
  const bx = base[0], by = base[1], bz = base[2];
  const S = [
    [-0.075, 0.062, 0.062, -0.010, 2.6],
    [-0.040, 0.070, 0.072, -0.006, 2.6],
    [-0.010, 0.080, 0.084, 0.004, 2.5],
    [0.014, 0.070, 0.082, 0.014, 2.5],
    [0.038, 0.078, 0.086, 0.008, 2.5],
    [0.060, 0.086, 0.092, 0.002, 2.4],
    [0.076, 0.090, 0.094, -0.002, 2.4],
    [0.086, 0.090, 0.093, -0.006, 2.4],
  ];
  const seg = F(22);
  const rings = S.map(([y, hx, hz, zo, n]) => ({
    pts: superEllipse(hx, hz, n, seg),
    o: [bx, by + y, bz + zo],
  }));
  const m = loft(rings, { capStart: false, capEnd: false });
  computeNormals(m);
  // cut the front open above the eye line by pulling the top ring back
  displace(m, (x, y, z) => {
    const fold = nz.fbm3(x * 30, y * 24, z * 30, 3);
    const wrap = Math.sin(y * 90 + fold * 4) * 0.5 + 0.5;
    return fold * 0.005 + wrap * 0.0035;
  });

  const out = emptyMesh();
  appendMesh(out, m);

  // --- rolled hem along the eye line -----------------------------------
  // A wrap's top edge is a doubled-over hem: 8 mm of roll that catches the key
  // light and draws the horizontal line under the eyes.
  const hem = [];
  const nHem = 26;
  for (let i = 0; i <= nHem; i++) {
    const a = (i / nHem) * Math.PI * 2;
    const sx = Math.sin(a), sz = Math.cos(a);
    // the hem rides higher over the cheeks and dips at the bridge of the nose
    const y = 0.086 + Math.max(0, sz) * 0.006 - Math.exp(-(sx * sx) / 0.06) * Math.max(0, sz) * 0.010;
    hem.push([bx + sx * 0.092, by + y, bz + sz * 0.096 - 0.004]);
  }
  const roll = ribbon(hem, 0.015, 0.008, { seg: F(6), up: [0, 1, 0], upright: true });
  computeNormals(roll);
  appendMesh(out, roll);

  // --- centre-front seam from the chin to the hem ------------------------
  const seam = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    seam.push([bx, by + 0.082 - t * 0.086, bz + 0.088 - t * 0.020]);
  }
  const sm = ribbon(seam, 0.009, 0.004, { seg: F(5), up: [1, 0, 0] });
  computeNormals(sm);
  appendMesh(out, sm);

  // --- bridge fold over the nose ----------------------------------------
  const bridge = ribbon(
    [
      [bx - 0.042, by + 0.070, bz + 0.070],
      [bx, by + 0.078, bz + 0.092],
      [bx + 0.042, by + 0.070, bz + 0.070],
    ],
    0.013,
    0.005,
    { seg: F(6), up: [0, 1, 0] }
  );
  computeNormals(bridge);
  appendMesh(out, bridge);

  computeNormals(out);
  return out;
}

/**
 * Wrap-around dark shooting glasses for the un-helmeted fighter: a curved lens
 * plus two thin temples. This is the whole of variant #2's facing cue — a dark
 * horizontal band at the eye line, which is the one feature that survives to
 * 35 m on a bare head.
 */
export function sunglasses(base) {
  const bx = base[0], by = base[1], bz = base[2];
  const lens = boxRound(0.072, 0.0155, 0.006, { n: 3.0, seg: F(18), rows: R(5), roundY: 0.6 });
  place(lens, bx, by + 0.100, bz + 0.080, -0.06, 0, 0);
  bendY(lens, 0.098, 0);
  computeNormals(lens);
  const frame = emptyMesh();
  for (const side of [-1, 1]) {
    const arm = ribbon(
      [
        [bx + side * 0.070, by + 0.104, bz + 0.062],
        [bx + side * 0.083, by + 0.104, bz + 0.010],
        [bx + side * 0.080, by + 0.100, bz - 0.030],
      ],
      0.008,
      0.004,
      { seg: F(5), up: [0, 1, 0], upright: true }
    );
    computeNormals(arm);
    appendMesh(frame, arm);
  }
  computeNormals(frame);
  return { lens, frame };
}

/* ================================================================== */
/* Helmet                                                             */
/* ================================================================== */

/**
 * High-cut ballistic helmet with a scalloped ear cut, a brim lip, side rails
 * and an NVG shroud. `base` is the Head bone position.
 */
export function helmet(nz, base, p = {}) {
  const out = emptyMesh();
  const bx = base[0], by = base[1], bz = base[2];
  const cy = by + 0.100; // shell centre (just above the brow)
  const rx = 0.121, ry = 0.158, rz = 0.135;

  // --- shell: revolved dome, bottom edge scalloped per angle
  const seg = F(26), rows = R(12);
  const rings = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    // t 0 = brim, 1 = crown
    const phi = (0.5 + 0.5 * t) * Math.PI; // 90..180 deg
    const y = -Math.cos(phi) * ry;
    const s = Math.sin(phi);
    const pts = ellipseProfile(rx * Math.max(0.08, s), rz * Math.max(0.08, s), seg);
    rings.push({ pts, o: [bx, cy + y, bz - 0.006], t });
  }
  const shell = loft(rings, { capStart: false, capEnd: false });
  computeNormals(shell);
  // scallop: raise the rim over the ears, drop it at the front and back
  warp(shell, (v) => {
    const dy = v.y - cy;
    if (dy > 0.012) return;
    const ang = Math.atan2(v.x - bx, v.z - bz);
    const side = Math.abs(Math.sin(ang));
    const lift = side ** 2 * 0.042 - Math.max(0, Math.cos(ang)) * 0.010;
    const k = Math.min(1, Math.max(0, (0.012 - dy) / 0.06));
    v.y += lift * k;
  });
  computeNormals(shell);
  displace(shell, (x, y, z) => nz.fbm3(x * 40, y * 40, z * 40, 3) * 0.0016);
  appendMesh(out, shell);

  // --- brim lip: a thin band following the rim
  const lipPts = [];
  const nLip = 30;
  for (let i = 0; i <= nLip; i++) {
    const a = (i / nLip) * Math.PI * 2;
    const sx = Math.sin(a), sz = Math.cos(a);
    const side = Math.abs(sx);
    const lift = side ** 2 * 0.042 - Math.max(0, sz) * 0.010;
    lipPts.push([bx + sx * rx * 0.955, cy + lift - 0.001, bz - 0.004 + sz * rz * 0.955]);
  }
  const lip = ribbon(lipPts, 0.011, 0.006, { seg: F(6), up: [0, 1, 0], upright: true });
  computeNormals(lip);
  appendMesh(out, lip);

  return out;
}

/** Side rails, NVG shroud and rear counterweight pouch — the helmet hardware. */
export function helmetHardware(nz, base) {
  const out = emptyMesh();
  const bx = base[0], by = base[1], bz = base[2];
  const cy = by + 0.100;

  // NVG shroud on the brow
  const shroud = boxRound(0.030, 0.012, 0.022, { n: 4, seg: F(12), rows: R(5), roundY: 0.5 });
  place(shroud, bx, cy + 0.062, bz + 0.120, -0.50, 0, 0);
  appendMesh(out, shroud);
  const lug = boxRound(0.009, 0.016, 0.007, { n: 4, seg: F(8), rows: R(4), roundY: 0.4 });
  place(lug, bx, cy + 0.086, bz + 0.126, -0.50, 0, 0);
  appendMesh(out, lug);

  // ARC rails: a slotted strip down each side
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const a = (-0.55 + t * 1.1) * side;
      pts.push([
        bx + side * 0.114 * Math.cos(a * 0.6),
        cy + 0.052 + Math.sin(t * Math.PI) * 0.016,
        bz - 0.004 + Math.sin(a) * 0.118,
      ]);
    }
    const rail = ribbon(pts, 0.016, 0.009, { seg: F(6), up: [0, 1, 0], upright: true });
    computeNormals(rail);
    appendMesh(out, rail);
  }

  // rear counterweight pouch
  const cw = boxRound(0.058, 0.034, 0.026, { n: 4, seg: F(14), rows: R(6), roundY: 0.5 });
  place(cw, bx, cy + 0.075, bz - 0.128, 0.28, 0, 0);
  computeNormals(cw);
  displace(cw, (x, y, z) => nz.fbm3(x * 40, y * 40, z * 40, 2) * 0.002);
  appendMesh(out, cw);
  return out;
}

/** Chin strap + nape pad. */
export function chinStrap(base) {
  const out = emptyMesh();
  const bx = base[0], by = base[1], bz = base[2];
  const cy = by + 0.100;
  for (const side of [-1, 1]) {
    const pts = [
      [bx + side * 0.104, cy + 0.004, bz + 0.036],
      [bx + side * 0.086, cy - 0.058, bz + 0.056],
      [bx + side * 0.048, cy - 0.104, bz + 0.062],
      [bx + side * 0.014, cy - 0.118, bz + 0.054],
    ];
    const s = ribbon(pts, 0.016, 0.005, { seg: F(6), up: [0, 0, 1] });
    computeNormals(s);
    appendMesh(out, s);
    const rear = [
      [bx + side * 0.106, cy + 0.000, bz - 0.024],
      [bx + side * 0.090, cy - 0.058, bz - 0.058],
      [bx + side * 0.040, cy - 0.078, bz - 0.082],
    ];
    const r = ribbon(rear, 0.014, 0.005, { seg: F(6), up: [0, 1, 0] });
    computeNormals(r);
    appendMesh(out, r);
  }
  return out;
}

/** Goggles: pushed up on the shell, or pulled down over the eyes. */
export function goggles(base, down = false) {
  if (down) return gogglesDown(base);
  const frame = boxRound(0.082, 0.026, 0.024, { n: 3.2, seg: F(20), rows: R(6), roundY: 0.5 });
  const bx = base[0], by = base[1], bz = base[2];
  place(frame, bx, by + 0.176, bz + 0.098, -0.95, 0, 0);
  bendY(frame, 0.15, 0);
  computeNormals(frame);
  const strap = ribbon(
    [
      [bx - 0.098, by + 0.176, bz + 0.078],
      [bx - 0.118, by + 0.198, bz - 0.020],
      [bx - 0.072, by + 0.226, bz - 0.116],
      [bx + 0.072, by + 0.226, bz - 0.116],
      [bx + 0.118, by + 0.198, bz - 0.020],
      [bx + 0.098, by + 0.176, bz + 0.078],
    ],
    0.024,
    0.007,
    { seg: F(6), up: [0, 1, 0], upright: true }
  );
  computeNormals(strap);
  return { frame, strap };
}

function gogglesDown(base) {
  const bx = base[0], by = base[1], bz = base[2];
  const frame = boxRound(0.078, 0.028, 0.026, { n: 3.2, seg: F(20), rows: R(6), roundY: 0.5 });
  place(frame, bx, by + 0.098, bz + 0.072, -0.10, 0, 0);
  bendY(frame, 0.115, 0);
  computeNormals(frame);
  const strap = ribbon(
    [
      [bx - 0.084, by + 0.100, bz + 0.058],
      [bx - 0.106, by + 0.108, bz - 0.030],
      [bx - 0.062, by + 0.116, bz - 0.108],
      [bx + 0.062, by + 0.116, bz - 0.108],
      [bx + 0.106, by + 0.108, bz - 0.030],
      [bx + 0.084, by + 0.100, bz + 0.058],
    ],
    0.026,
    0.008,
    { seg: F(6), up: [0, 1, 0], upright: true }
  );
  computeNormals(strap);
  return { frame, strap, down: true };
}

/** Goggle lens — a curved slab of smoked glass. */
export function goggleLens(base, down = false) {
  if (down) {
    const bx = base[0], by = base[1], bz = base[2];
    const lens = boxRound(0.071, 0.020, 0.008, { n: 3.0, seg: F(18), rows: R(5), roundY: 0.6 });
    place(lens, bx, by + 0.098, bz + 0.090, -0.10, 0, 0);
    bendY(lens, 0.105, 0);
    computeNormals(lens);
    return lens;
  }
  const lens = boxRound(0.074, 0.019, 0.008, { n: 3.0, seg: F(18), rows: R(5), roundY: 0.6 });
  const bx = base[0], by = base[1], bz = base[2];
  place(lens, bx, by + 0.176, bz + 0.115, -0.95, 0, 0);
  bendY(lens, 0.14, 0);
  computeNormals(lens);
  return lens;
}

/**
 * Wrapped head scarf for the un-helmeted variant: a skull-hugging dome with a
 * rolled brim and a tail hanging off the back, so the silhouette reads as a
 * fighter in a shemagh rather than a bald mannequin.
 */
export function headScarf(nz, base) {
  const out = emptyMesh();
  const bx = base[0], by = base[1], bz = base[2];
  // The skull crown sits at +0.244 in head-local space, so the dome has to reach
  // +0.250 or the bare scalp pokes through the top of the wrap — which is exactly
  // what it looked like: a pink patch on the crown at every distance.
  const dome = ellipsoid(0.102, 0.146, 0.112, { seg: F(22), rows: R(12), v0: 0.34, v1: 1 });
  computeNormals(dome);
  place(dome, bx, by + 0.104, bz - 0.008);
  displace(dome, (x, y, z) => {
    const f = nz.fbm3(x * 26, y * 22, z * 26, 3);
    return f * 0.006 + Math.sin(y * 70 + f * 4) * 0.0022;
  });
  appendMesh(out, dome);
  // rolled brim
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push([bx + Math.sin(a) * 0.099, by + 0.118 - Math.max(0, Math.cos(a)) * 0.012, bz - 0.008 + Math.cos(a) * 0.109]);
  }
  const brim = ribbon(pts, 0.030, 0.016, { seg: F(7), up: [0, 1, 0], upright: true });
  computeNormals(brim);
  appendMesh(out, brim);
  // tail down the back
  const tail = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    tail.push([
      bx + 0.028 * t,
      by + 0.115 - t * 0.20,
      bz - 0.085 - Math.sin(t * 2.2) * 0.03,
    ]);
  }
  const tl = tube(tail, (t) => superEllipse(0.052 - t * 0.012, 0.020 + t * 0.006, 3, F(12)), {
    capStart: false,
    capEnd: true,
  });
  computeNormals(tl);
  displace(tl, (x, y, z) => nz.fbm3(x * 30, y * 26, z * 30, 3) * 0.006);
  appendMesh(out, tl);
  return out;
}

/* ================================================================== */
/* Load-bearing gear                                                  */
/* ================================================================== */

/** One plate: a curved slab with a soft edge. */
function plate(hx, hy, hz, y, z, tilt, radius) {
  const m = boxRound(hx, hy, hz, { n: 3.6, seg: F(22), rows: R(11), roundY: 0.24 });
  // taper: a real plate narrows toward the waist and wraps in at the bottom
  warp(m, (v) => {
    const t = Math.max(0, -v.y / hy);
    v.x *= 1 - 0.20 * t * t;
    v.z *= 1 - 0.35 * t * t;
  });
  computeNormals(m);
  place(m, 0, y, z, tilt, 0, 0);
  bendY(m, radius, z);
  computeNormals(m);
  return m;
}

/** A pouch: rounded box with a lid, a pull tab and compression stitching. */
export function pouch(nz, o) {
  const out = emptyMesh();
  const hx = o.hx ?? 0.038, hy = o.hy ?? 0.055, hz = o.hz ?? 0.030;
  const body = boxRound(hx, hy, hz, { n: 5.5, seg: F(18), rows: R(8), roundY: 0.18 });
  computeNormals(body);
  displace(body, (x, y, z) => nz.fbm3(x * 40, y * 40, z * 40, 3) * 0.0022);
  appendMesh(out, body);
  // lid
  const lid = boxRound(hx * 1.03, 0.010, hz * 0.98, { n: 5.5, seg: F(18), rows: R(4), roundY: 0.5 });
  place(lid, 0, hy - 0.004, (o.lidTilt ? hz * 0.35 : 0) + hz * 0.10, (o.lidTilt ?? 0) - 0.18, 0, 0);
  computeNormals(lid);
  appendMesh(out, lid);
  // pull tab
  const tab = ribbon(
    [
      [0, hy + 0.004, hz * 0.7],
      [0, hy - 0.010, hz * 1.16],
      [0, hy - 0.034, hz * 1.10],
    ],
    0.014,
    0.004,
    { seg: F(5), up: [1, 0, 0] }
  );
  computeNormals(tab);
  appendMesh(out, tab);
  place(out, o.x ?? 0, o.y ?? 0, o.z ?? 0, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  if (o.bend) bendY(out, o.bend, o.z ?? 0);
  computeNormals(out);
  return out;
}

/** Plate carrier: front & back plates, cummerbund, shoulder straps, buckles. */
export function plateCarrier(nz, p = {}) {
  const out = emptyMesh();
  const front = plate(0.152, 0.140, 0.030, 1.298, 0.126, -0.05, 0.20);
  displace(front, (x, y, z) => nz.fbm3(x * 34, y * 34, z * 34, 3) * 0.0026);
  appendMesh(out, front);
  const back = plate(0.154, 0.148, 0.026, 1.300, -0.116, 0.05, 0.21);
  displace(back, (x, y, z) => nz.fbm3(x * 34, y * 34, z * 34, 3) * 0.0026);
  appendMesh(out, back);

  // cummerbund wrapping the waist
  const cb = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    cb.push([Math.sin(a) * 0.168, 1.152 + Math.cos(a * 2) * 0.005, Math.cos(a) * 0.121 - 0.004]);
  }
  const band = ribbon(cb, 0.100, 0.022, { seg: F(8), up: [0, 1, 0], upright: true });
  computeNormals(band);
  displace(band, (x, y, z) => nz.fbm3(x * 34, y * 34, z * 34, 3) * 0.002);
  appendMesh(out, band);

  // shoulder straps
  for (const side of [-1, 1]) {
    const pts = [
      [side * 0.082, 1.418, 0.144],
      [side * 0.100, 1.468, 0.040],
      [side * 0.104, 1.462, -0.036],
      [side * 0.092, 1.418, -0.120],
    ];
    const s = ribbon(pts, 0.076, 0.030, { seg: F(8), up: [0, 1, 0] });
    computeNormals(s);
    displace(s, (x, y, z) => nz.fbm3(x * 34, y * 34, z * 34, 3) * 0.002);
    appendMesh(out, s);
  }
  return out;
}

/** Webbing: drag handle, elastic retention, admin panel loops. */
export function carrierWebbing() {
  const out = emptyMesh();
  // PALS rows across the front plate
  for (let r = 0; r < 2; r++) {
    const y = 1.322 + r * 0.046;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = (t - 0.5) * 0.150;
      pts.push([x, y, 0.150 - (x * x) / 0.20]);
    }
    const row = ribbon(pts, 0.013, 0.0035, { seg: F(5), up: [0, 1, 0], upright: true });
    computeNormals(row);
    appendMesh(out, row);
  }
  // drag handle on the back
  const drag = ribbon(
    [
      [-0.052, 1.432, -0.132],
      [-0.022, 1.458, -0.152],
      [0.022, 1.458, -0.152],
      [0.052, 1.432, -0.132],
    ],
    0.028,
    0.010,
    { seg: F(6), up: [0, 1, 0], upright: true }
  );
  computeNormals(drag);
  appendMesh(out, drag);
  return out;
}

/** Two-point sling routed across the chest. */
export function sling(gripPoint, stockPoint) {
  const pts = [
    [stockPoint[0], stockPoint[1] + 0.02, stockPoint[2]],
    [-0.130, 1.395, -0.010],
    [-0.120, 1.430, -0.090],
    [0.020, 1.430, -0.118],
    [0.120, 1.330, -0.070],
    [0.150, 1.250, 0.040],
    [0.110, 1.235, 0.135],
    [gripPoint[0] + 0.02, gripPoint[1] + 0.03, gripPoint[2] + 0.02],
  ];
  const m = ribbon(pts, 0.032, 0.009, { seg: F(6), up: [0, 1, 0] });
  computeNormals(m);
  return m;
}

/** Belt with a buckle and a holster. */
export function belt(nz) {
  const out = emptyMesh();
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.sin(a) * 0.158, 0.902, Math.cos(a) * 0.113 - 0.008]);
  }
  const b = ribbon(pts, 0.056, 0.018, { seg: F(7), up: [0, 1, 0], upright: true });
  computeNormals(b);
  displace(b, (x, y, z) => nz.fbm3(x * 40, y * 40, z * 40, 2) * 0.0018);
  appendMesh(out, b);
  return out;
}

/** Dump pouch / canteen hanging off the belt at the back. */
export function hipPouch(nz, side) {
  const m = pouch(nz, {
    hx: 0.048, hy: 0.062, hz: 0.038,
    x: side * 0.142, y: 0.878, z: -0.070,
    rz: side * 0.12, ry: side * 0.5,
  });
  return m;
}

/** Knee pad: a curved cap with two elastic straps. */
export function kneePad(nz, knee, side) {
  const out = emptyMesh();
  const cap = boxRound(0.064, 0.080, 0.026, { n: 4.5, seg: F(18), rows: R(9), roundY: 0.42 });
  place(cap, 0, 0, 0.052, 0, 0, 0);
  bendY(cap, 0.075, 0.052);
  computeNormals(cap);
  displace(cap, (x, y, z) => nz.fbm3(x * 60, y * 60, z * 60, 3) * 0.0018);
  appendMesh(out, cap);
  for (const dy of [-0.056, 0.052]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      pts.push([Math.sin(a) * 0.066, dy, Math.cos(a) * 0.058 + 0.006]);
    }
    const s = ribbon(pts, 0.016, 0.006, { seg: F(6), up: [0, 1, 0], upright: true });
    computeNormals(s);
    appendMesh(out, s);
  }
  place(out, knee[0], knee[1] + 0.012, knee[2] + 0.004, 0.06, 0, 0);
  computeNormals(out);
  return out;
}

/* ================================================================== */
/* Boots, gloves                                                      */
/* ================================================================== */

/** Boot: sole, upper, ankle cuff, tongue and laces. `ankle` = FootR/L bone. */
export function boot(nz, ankle, side) {
  const out = emptyMesh();
  const ax = ankle[0], ay = ankle[1], az = ankle[2];
  // upper: lofted sections front to back
  const S = [
    [-0.078, 0.036, 0.030, 0.052],
    [-0.052, 0.044, 0.038, 0.062],
    [-0.016, 0.048, 0.044, 0.058],
    [0.030, 0.049, 0.046, 0.048],
    [0.076, 0.046, 0.042, 0.038],
    [0.112, 0.040, 0.034, 0.030],
    [0.134, 0.028, 0.022, 0.024],
  ];
  const seg = F(18);
  const rings = S.map(([z, hx, hy, cy]) => ({
    pts: superEllipse(hx, hy, 2.8, seg),
    o: [ax, ay - 0.088 + cy, az + z],
    q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  }));
  const upper = loft(rings, { capStart: true, capEnd: true });
  computeNormals(upper);
  displace(upper, (x, y, z) => nz.fbm3(x * 44, y * 44, z * 44, 3) * 0.0022);
  appendMesh(out, upper);

  // ankle cuff up the shin
  const cuff = tube(
    [
      [ax, ay + 0.010, az - 0.004],
      [ax, ay + 0.070, az - 0.002],
      [ax, ay + 0.125, az + 0.002],
    ],
    (t) => ellipseProfile(0.056 - 0.004 * t, 0.050 - 0.002 * t, F(16)),
    { capStart: false, capEnd: false }
  );
  computeNormals(cuff);
  displace(cuff, (x, y, z) => nz.fbm3(x * 44, y * 44, z * 44, 3) * 0.0025);
  appendMesh(out, cuff);
  return out;
}

/** Boot sole + heel block, rubber. */
export function bootSole(ankle) {
  const S = [
    [-0.082, 0.033, 0.018],
    [-0.055, 0.043, 0.020],
    [-0.020, 0.047, 0.014],
    [0.030, 0.049, 0.013],
    [0.080, 0.046, 0.013],
    [0.118, 0.038, 0.013],
    [0.140, 0.024, 0.012],
  ];
  const ax = ankle[0], ay = ankle[1], az = ankle[2];
  const rings = S.map(([z, hx, hy]) => ({
    pts: superEllipse(hx, hy, 3.6, F(16)),
    o: [ax, ay - 0.088 + hy + 0.001, az + z],
    q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  }));
  const m = loft(rings, { capStart: true, capEnd: true });
  computeNormals(m);
  // heel block
  const heel = boxRound(0.036, 0.011, 0.030, { n: 4, seg: F(12), rows: R(4), roundY: 0.4 });
  place(heel, ax, ay - 0.082, az - 0.056);
  appendMesh(m, heel);
  computeNormals(m);
  return m;
}

/** Laces: cross-over ribbons up the boot tongue. */
export function bootLaces(ankle) {
  const out = emptyMesh();
  const ax = ankle[0], ay = ankle[1], az = ankle[2];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const z = az + 0.088 - t * 0.076;
    const y = ay - 0.028 + t * 0.070;
    const w = 0.030 - t * 0.004;
    const s = ribbon(
      [
        [ax - w, y - 0.006, z + 0.006],
        [ax, y + 0.004, z],
        [ax + w, y - 0.006, z + 0.006],
      ],
      0.008,
      0.004,
      { seg: F(5), up: [0, 1, 0] }
    );
    computeNormals(s);
    appendMesh(out, s);
  }
  return out;
}

/**
 * Gloved hand curled around a grip. `wrist` is the hand bone position, `dir`
 * the direction the fingers wrap about, `axis` the grip axis.
 */
export function glove(nz, wrist, gripAxis, palmNormal, side) {
  const out = emptyMesh();
  const W = new THREE.Vector3(...wrist);
  const A = new THREE.Vector3(...gripAxis).normalize(); // along the grip
  const N = new THREE.Vector3(...palmNormal).normalize(); // out of the palm
  const S = new THREE.Vector3().crossVectors(A, N).normalize(); // across the hand

  // palm block
  const palm = boxRound(0.030, 0.048, 0.022, { n: 3.2, seg: F(16), rows: R(7), roundY: 0.4 });
  const m = new THREE.Matrix4().makeBasis(S, A, N);
  const pos = W.clone().addScaledVector(A, 0.030).addScaledVector(N, -0.006);
  m.setPosition(pos);
  computeNormals(palm);
  transformMesh(palm, m);
  appendMesh(out, palm);

  // finger mass: a tube curling around the grip axis
  for (let f = 0; f < 4; f++) {
    const t = f / 3;
    const pts = [];
    const startY = 0.052 - t * 0.030;
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      const ang = u * 2.2;
      const r = 0.030 - u * 0.004;
      const p = W.clone()
        .addScaledVector(A, startY - 0.004 + Math.sin(ang) * r * 0.55)
        .addScaledVector(N, -0.020 - (1 - Math.cos(ang)) * r * 0.9)
        .addScaledVector(S, side * (0.020 - t * 0.019));
      pts.push([p.x, p.y, p.z]);
    }
    const fin = tube(pts, (u) => ellipseProfile(0.0115 - u * 0.002, 0.0105 - u * 0.002, F(10)), {
      capStart: true,
      capEnd: true,
    });
    computeNormals(fin);
    appendMesh(out, fin);
  }
  // thumb across the top
  const tp = [];
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    const p = W.clone()
      .addScaledVector(A, 0.030 + u * 0.036)
      .addScaledVector(N, 0.006 - u * 0.026)
      .addScaledVector(S, side * (-0.026 - u * 0.004));
    tp.push([p.x, p.y, p.z]);
  }
  const thumb = tube(tp, (u) => ellipseProfile(0.014 - u * 0.003, 0.013 - u * 0.003, F(10)), {
    capStart: true,
    capEnd: true,
  });
  computeNormals(thumb);
  appendMesh(out, thumb);

  computeNormals(out);
  displace(out, (x, y, z) => nz.fbm3(x * 90, y * 90, z * 90, 3) * 0.0012);
  return out;
}

/** Knuckle guard on the back of the glove. */
export function knuckleGuard(wrist, gripAxis, palmNormal) {
  const W = new THREE.Vector3(...wrist);
  const A = new THREE.Vector3(...gripAxis).normalize();
  const N = new THREE.Vector3(...palmNormal).normalize();
  const S = new THREE.Vector3().crossVectors(A, N).normalize();
  const g = boxRound(0.026, 0.024, 0.007, { n: 3.4, seg: F(14), rows: R(5), roundY: 0.5 });
  const m = new THREE.Matrix4().makeBasis(S, A, N);
  m.setPosition(W.clone().addScaledVector(A, 0.050).addScaledVector(N, 0.020));
  computeNormals(g);
  transformMesh(g, m);
  return g;
}
