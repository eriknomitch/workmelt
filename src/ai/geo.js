/**
 * AI — procedural geometry toolkit for the enemy characters.
 *
 * Everything a soldier is made of is lofted from rings of 2D profiles: limbs are
 * tapered tubes along the bone chain, the plate carrier and its pouches are
 * rounded boxes (superellipse rings under a rounding envelope), the helmet and
 * the optic are revolves, the slings and straps are extruded ribbons. One core
 * routine (`loft`) builds all of them, which keeps the vertex layout, the UV
 * convention and the normal handling identical everywhere.
 *
 * UV CONVENTION — u,v are stored in **metres of surface** (u around the ring,
 * v along the path). The builder divides by the material's tile size when it
 * writes the attribute, so the same physical texel density holds on a boot, a
 * sleeve and a magazine without any per-part tuning.
 *
 * Nothing here runs per frame; it is all boot-time work.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Deterministic gradient noise                                        */
/* ------------------------------------------------------------------ */

const G3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

export class Noise {
  constructor(rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Perlin 3D, roughly [-1,1]. */
  n3(x, y, z) {
    const p = this.perm;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, B = p[X + 1] + Y;
    const AA = p[A] + Z, AB = p[A + 1] + Z;
    const BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = (h, dx, dy, dz) => {
      const q = G3[h % 12];
      return q[0] * dx + q[1] * dy + q[2] * dz;
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(
        lerp(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u),
        lerp(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u),
        lerp(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.n3(x * f, y * f, z * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return s / norm;
  }

  /** Billowed / ridged variant — good for cloth folds and rock. */
  ridge3(x, y, z, oct = 3) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * (1 - Math.abs(this.n3(x * f, y * f, z * f)) * 2);
      norm += a;
      a *= 0.5;
      f *= 2.07;
    }
    return s / norm;
  }
}

/* ------------------------------------------------------------------ */
/* Mesh records                                                        */
/* ------------------------------------------------------------------ */

/** A mesh under construction: flat arrays, no GPU resources. */
export function emptyMesh() {
  return { p: [], n: [], uv: [], i: [] };
}

export function vcount(m) {
  return m.p.length / 3;
}

/* ---- profiles ---- */

/** Superellipse ring in the XZ plane. `n` 2 = ellipse, 6+ = rounded box. */
export function superEllipse(rx, rz, n = 2, seg = 16, rot = 0) {
  const pts = new Array(seg);
  const e = 2 / n;
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2 + rot;
    const c = Math.cos(t), s = Math.sin(t);
    pts[i] = [
      rx * Math.sign(c) * Math.abs(c) ** e,
      rz * Math.sign(s) * Math.abs(s) ** e,
    ];
  }
  return pts;
}

export function ellipseProfile(rx, rz, seg = 16, rot = 0) {
  return superEllipse(rx, rz, 2, seg, rot);
}

/* ---- the one true builder: loft a sequence of rings ---- */

/**
 * Loft rings into a tube.
 * rings: [{ pts:[[x,z],...], m: Matrix4 | {o:[x,y,z], q:Quaternion, s:[sx,sz]} }]
 * Every ring must have the same point count. Options:
 *   closed     ring wraps around (default true)
 *   capStart / capEnd   fan caps
 *   flat       flat-shade the caps (always true; side normals are smooth)
 */
export function loft(rings, opts = {}) {
  const out = opts.into ?? emptyMesh();
  const closed = opts.closed !== false;
  const k = rings[0].pts.length;
  const P = out.p, N = out.n, UV = out.uv, I = out.i;
  const base = vcount(out);

  // ring arc lengths for u, path lengths for v
  const uArr = new Float64Array(k + 1);
  const pos = [];
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();

  let vLen = 0;
  let prevCentre = null;
  const centres = [];

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const o = ring.o ?? [0, 0, 0];
    const s = ring.s ?? [1, 1];
    if (ring.q) q.copy(ring.q);
    else q.identity();
    const arr = new Float64Array(k * 3);
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < k; j++) {
      const pt = ring.pts[j];
      v.set(pt[0] * s[0], ring.y ?? 0, pt[1] * s[1]);
      v.applyQuaternion(q);
      v.x += o[0]; v.y += o[1]; v.z += o[2];
      arr[j * 3] = v.x; arr[j * 3 + 1] = v.y; arr[j * 3 + 2] = v.z;
      cx += v.x; cy += v.y; cz += v.z;
    }
    cx /= k; cy /= k; cz /= k;
    centres.push([cx, cy, cz]);
    if (prevCentre) {
      vLen += Math.hypot(cx - prevCentre[0], cy - prevCentre[1], cz - prevCentre[2]);
    }
    prevCentre = [cx, cy, cz];
    pos.push({ arr, v: vLen });
  }

  // u from the arc length of the first ring (consistent across the tube)
  {
    const a = pos[0].arr;
    uArr[0] = 0;
    for (let j = 1; j <= k; j++) {
      const j0 = ((j - 1) % k) * 3, j1 = (j % k) * 3;
      uArr[j] = uArr[j - 1] + Math.hypot(a[j1] - a[j0], a[j1 + 1] - a[j0 + 1], a[j1 + 2] - a[j0 + 2]);
    }
  }

  const cols = closed ? k + 1 : k; // duplicate seam column for correct UVs
  for (let r = 0; r < pos.length; r++) {
    const arr = pos[r].arr;
    for (let c = 0; c < cols; c++) {
      const j = (c % k) * 3;
      P.push(arr[j], arr[j + 1], arr[j + 2]);
      N.push(0, 0, 0);
      UV.push(uArr[c], pos[r].v);
    }
  }

  for (let r = 0; r + 1 < pos.length; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = base + r * cols + c;
      const b = a + 1;
      const d = base + (r + 1) * cols + c;
      const e = d + 1;
      I.push(a, d, b, b, d, e);
    }
  }

  // caps
  const cap = (ringIndex, flip) => {
    const arr = pos[ringIndex].arr;
    const c = centres[ringIndex];
    const cIdx = vcount(out);
    P.push(c[0], c[1], c[2]);
    N.push(0, 0, 0);
    UV.push(uArr[k] * 0.5, pos[ringIndex].v);
    const start = vcount(out);
    for (let j = 0; j < k; j++) {
      P.push(arr[j * 3], arr[j * 3 + 1], arr[j * 3 + 2]);
      N.push(0, 0, 0);
      const ang = (j / k) * Math.PI * 2;
      UV.push(uArr[k] * 0.5 + Math.cos(ang) * 0.02, pos[ringIndex].v + Math.sin(ang) * 0.02);
    }
    for (let j = 0; j < k; j++) {
      const a = start + j;
      const b = start + ((j + 1) % k);
      if (flip) I.push(cIdx, b, a);
      else I.push(cIdx, a, b);
    }
  };
  if (opts.capStart) cap(0, true);
  if (opts.capEnd) cap(pos.length - 1, false);

  return out;
}

/** Build the ring frames for a path of points with an up reference. */
export function pathFrames(points, upRef = [0, 0, 1]) {
  const frames = [];
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3();
  const z = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0);
    dir.normalize();
    up.set(upRef[0], upRef[1], upRef[2]);
    if (Math.abs(up.dot(dir)) > 0.97) up.set(1, 0, 0);
    x.copy(dir).cross(up).normalize();
    z.copy(x).cross(dir).normalize();
    m.makeBasis(x, dir, z);
    frames.push(new THREE.Quaternion().setFromRotationMatrix(m));
  }
  return frames;
}

/**
 * Tapered tube along a polyline. `profile(t, i)` returns a ring of [x,z] pairs
 * (x = side, z = front/back in the frame built from the path direction).
 */
export function tube(points, profile, opts = {}) {
  const frames = opts.frames ?? pathFrames(points, opts.up ?? [0, 0, 1]);
  const rings = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    rings.push({ pts: profile(i / (n - 1), i), o: points[i], q: frames[i] });
  }
  return loft(rings, opts);
}

/** Revolve a 2D profile [[r,y],...] about +Y. */
export function revolve(profile, seg = 20, opts = {}) {
  const rings = [];
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    const rz = opts.squash ? r * opts.squash : r;
    rings.push({ pts: ellipseProfile(Math.max(1e-4, r), Math.max(1e-4, rz), seg), o: [0, y, 0] });
  }
  return loft(rings, opts);
}

/**
 * Rounded box / superellipsoid slab. `n` controls corner sharpness in plan,
 * `roundY` how much the top and bottom edges are rounded off.
 */
export function boxRound(hx, hy, hz, opts = {}) {
  const n = opts.n ?? 5;
  const seg = opts.seg ?? 20;
  const rows = opts.rows ?? 9;
  const roundY = opts.roundY ?? 0.28;
  const ny = opts.ny ?? 5;
  const rings = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const y = (t * 2 - 1) * hy;
    // envelope: 1 in the middle, tucks in over `roundY` of the height
    const a = Math.min(1, Math.abs(y) / hy);
    const k = Math.min(1, Math.max(0, (a - (1 - roundY)) / roundY));
    // clamp before the fractional power: 1 - k^ny can land at -1e-16
    const env = Math.max(0, 1 - k ** ny) ** (1 / ny);
    const e = Math.max(0.02, env);
    rings.push({ pts: superEllipse(hx * e, hz * e, n, seg), o: [0, y, 0] });
  }
  return loft(rings, { ...opts, capStart: false, capEnd: false });
}

/** Ellipsoid with optional latitude clamp (helmet dome, head, shoulder). */
export function ellipsoid(rx, ry, rz, opts = {}) {
  const seg = opts.seg ?? 22;
  const rows = opts.rows ?? 14;
  const v0 = opts.v0 ?? 0; // 0 = south pole
  const v1 = opts.v1 ?? 1;
  const rings = [];
  for (let r = 0; r < rows; r++) {
    const t = v0 + (v1 - v0) * (r / (rows - 1));
    const phi = t * Math.PI;
    const y = -Math.cos(phi) * ry;
    const s = Math.sin(phi);
    rings.push({ pts: ellipseProfile(Math.max(1e-4, rx * s), Math.max(1e-4, rz * s), seg), o: [0, y, 0] });
  }
  return loft(rings, opts);
}

/**
 * Flat ribbon (strap, sling, belt) extruded along a polyline.
 *
 * The frame built by `pathFrames` puts local X perpendicular to the path in the
 * plane of `up`, and local Z along `up`. So by default `width` runs along X —
 * right for a shoulder strap lying across the body. Pass `upright: true` for a
 * belt or a helmet rim, where the width has to run along `up` instead, or the
 * strap turns into a horizontal flange sticking out of the character.
 */
export function ribbon(points, width, thick, opts = {}) {
  const half = width * 0.5, ht = thick * 0.5;
  const pts = opts.upright
    ? superEllipse(ht, half, 4, opts.seg ?? 8)
    : superEllipse(half, ht, 4, opts.seg ?? 8);
  return tube(points, () => pts, { ...opts, capStart: true, capEnd: true });
}

/* ------------------------------------------------------------------ */
/* Mesh ops                                                            */
/* ------------------------------------------------------------------ */

export function computeNormals(m, from = 0) {
  const P = m.p, N = m.n, I = m.i;
  for (let i = from * 3; i < N.length; i++) N[i] = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    if (a < from * 3 && b < from * 3 && c < from * 3) continue;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az;
    const e2x = P[c] - ax, e2y = P[c + 1] - ay, e2z = P[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let i = from * 3; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return m;
}

/** Weld coincident vertices so smooth normals cross the seams of a loft. */
export function weldNormals(m, eps = 1e-4) {
  const P = m.p, N = m.n;
  const cell = 1 / eps;
  const map = new Map();
  const n = vcount(m);
  for (let i = 0; i < n; i++) {
    const k =
      `${Math.round(P[i * 3] * cell)},${Math.round(P[i * 3 + 1] * cell)},${Math.round(P[i * 3 + 2] * cell)}`;
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(i);
  }
  for (const list of map.values()) {
    if (list.length < 2) continue;
    let nx = 0, ny = 0, nz = 0;
    for (const i of list) {
      nx += N[i * 3]; ny += N[i * 3 + 1]; nz += N[i * 3 + 2];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const i of list) {
      N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
    }
  }
  return m;
}

/** Displace every vertex along its normal by fn(x,y,z,nx,ny,nz). */
export function displace(m, fn, from = 0) {
  const P = m.p, N = m.n;
  const n = vcount(m);
  for (let i = from; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const d = fn(x, y, z, nx, ny, nz, i);
    if (!d) continue;
    P[i * 3] = x + nx * d;
    P[i * 3 + 1] = y + ny * d;
    P[i * 3 + 2] = z + nz * d;
  }
  return m;
}

/** Free-form deform: fn(v) mutates the vector in place. */
export function warp(m, fn, from = 0) {
  const P = m.p;
  const v = new THREE.Vector3();
  const n = vcount(m);
  for (let i = from; i < n; i++) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    fn(v, i);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
  }
  return m;
}

export function transformMesh(m, matrix) {
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const v = new THREE.Vector3();
  const P = m.p, N = m.n;
  const n = vcount(m);
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(matrix);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    v.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(nm).normalize();
    N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
  }
  return m;
}

export function appendMesh(dst, src) {
  const base = vcount(dst);
  for (let i = 0; i < src.p.length; i++) dst.p.push(src.p[i]);
  for (let i = 0; i < src.n.length; i++) dst.n.push(src.n[i]);
  for (let i = 0; i < src.uv.length; i++) dst.uv.push(src.uv[i]);
  for (let i = 0; i < src.i.length; i++) dst.i.push(src.i[i] + base);
  return dst;
}

/* ------------------------------------------------------------------ */
/* Character builder — parts, materials, skin weights, baked AO        */
/* ------------------------------------------------------------------ */

/**
 * Collects parts into one interleaved BufferGeometry with one geometry group
 * per material, computes skin weights against the rig's bind-pose segments and
 * bakes ambient occlusion, grime and edge wear into the vertex colours.
 */
export class CharacterBuilder {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.noise = opts.noise;
    this.parts = [];
    /** material name -> { tile } */
    this.materials = opts.materials;
    /**
     * Scales every weathering term in `_shade` — grime, ground dirt, settled
     * dust and edge wear. 1 is the photoreal bake those terms were tuned for;
     * 0 leaves baked AO and the value mottle alone and keeps the part tints
     * exactly as authored, which is what a flat livery needs (see the note in
     * `buildSoldier`). The per-part amounts stay in the part table either way.
     */
    this.weathering = opts.weathering ?? 1;
    this.occluders = []; // AO proxies: {a:[x,y,z], b:[x,y,z], r, k}
  }

  /**
   * @param mesh  mesh record (metres, actor bind space)
   * @param o     { material, bones, bone, colour, wear, grime, dirt, dust,
   *                tile, name }
   *   bones   candidate bone names for smooth binding
   *   bone    single bone name for a rigid part (overrides `bones`)
   */
  add(mesh, o) {
    computeNormals(mesh);
    if (o.weld !== false) weldNormals(mesh);
    this.parts.push({ mesh, ...o });
    return this;
  }

  /** Register an occlusion proxy capsule used when baking vertex AO. */
  occlude(a, b, r, k = 1) {
    this.occluders.push({ a, b, r, k });
    return this;
  }

  build() {
    const rig = this.rig;
    const matNames = [];
    for (const p of this.parts) if (!matNames.includes(p.material)) matNames.push(p.material);
    // sort parts by material so each group is contiguous
    const order = [];
    for (const m of matNames) for (const p of this.parts) if (p.material === m) order.push(p);

    let vTotal = 0, iTotal = 0;
    for (const p of order) {
      vTotal += vcount(p.mesh);
      iTotal += p.mesh.i.length;
    }

    const pos = new Float32Array(vTotal * 3);
    const nrm = new Float32Array(vTotal * 3);
    const uv = new Float32Array(vTotal * 2);
    const col = new Float32Array(vTotal * 3);
    const skinIndex = new Uint16Array(vTotal * 4);
    const skinWeight = new Float32Array(vTotal * 4);
    const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);

    const groups = [];
    let vo = 0, io = 0;
    let curMat = null, groupStart = 0;

    for (const p of order) {
      if (p.material !== curMat) {
        if (curMat !== null) groups.push({ start: groupStart, count: io - groupStart, mat: curMat });
        curMat = p.material;
        groupStart = io;
      }
      const m = p.mesh;
      const n = vcount(m);
      const tile = p.tile ?? this.materials[p.material]?.tile ?? 0.4;
      const inv = 1 / tile;
      for (let i = 0; i < n; i++) {
        pos[(vo + i) * 3] = m.p[i * 3];
        pos[(vo + i) * 3 + 1] = m.p[i * 3 + 1];
        pos[(vo + i) * 3 + 2] = m.p[i * 3 + 2];
        nrm[(vo + i) * 3] = m.n[i * 3];
        nrm[(vo + i) * 3 + 1] = m.n[i * 3 + 1];
        nrm[(vo + i) * 3 + 2] = m.n[i * 3 + 2];
        uv[(vo + i) * 2] = m.uv[i * 2] * inv + (p.uvOffset?.[0] ?? 0);
        uv[(vo + i) * 2 + 1] = m.uv[i * 2 + 1] * inv + (p.uvOffset?.[1] ?? 0);
      }
      for (let i = 0; i < m.i.length; i++) idx[io + i] = m.i[i] + vo;
      p._vo = vo;
      p._vn = n;
      vo += n;
      io += m.i.length;
    }
    groups.push({ start: groupStart, count: io - groupStart, mat: curMat });

    // ---- skin weights -------------------------------------------------
    for (const p of order) {
      this._bind(p, pos, skinIndex, skinWeight);
    }

    // ---- vertex colour: AO + grime + wear ------------------------------
    this._shade(order, pos, nrm, col);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    for (const g of groups) geo.addGroup(g.start, g.count, matNames.indexOf(g.mat));
    geo.computeBoundingSphere();
    // animated poses reach outside the bind-pose bounds
    geo.boundingSphere.radius *= 1.45;
    geo.computeBoundingBox();

    return {
      geometry: geo,
      materialNames: matNames,
      vertices: vTotal,
      triangles: iTotal / 3,
      // vertex range per part, so the albedo audit in selftest.mjs can report
      // the effective value of every single piece of kit
      parts: order.map((p) => ({ name: p.name, material: p.material, start: p._vo, count: p._vn })),
    };
  }

  _bind(part, pos, skinIndex, skinWeight) {
    const rig = this.rig;
    const n = part._vn, vo = part._vo;
    if (part.bone) {
      const bi = rig.index(part.bone);
      for (let i = 0; i < n; i++) {
        skinIndex[(vo + i) * 4] = bi;
        skinWeight[(vo + i) * 4] = 1;
      }
      return;
    }
    const cands = (part.bones ?? ['Hips']).map((nm) => rig.index(nm));
    const bias = part.bias ?? null;
    const power = part.power ?? 3.2;
    const wBuf = new Float64Array(cands.length);
    for (let i = 0; i < n; i++) {
      const x = pos[(vo + i) * 3], y = pos[(vo + i) * 3 + 1], z = pos[(vo + i) * 3 + 2];
      let sum = 0;
      for (let c = 0; c < cands.length; c++) {
        const d = rig.distanceToBone(cands[c], x, y, z);
        let w = 1 / (d ** power + 1e-6);
        if (bias) w *= bias[c] ?? 1;
        wBuf[c] = w;
        sum += w;
      }
      // keep the four strongest
      let i0 = -1, i1 = -1, i2 = -1, i3 = -1;
      let w0 = -1, w1 = -1, w2 = -1, w3 = -1;
      for (let c = 0; c < cands.length; c++) {
        const w = wBuf[c];
        if (w > w0) { i3 = i2; w3 = w2; i2 = i1; w2 = w1; i1 = i0; w1 = w0; i0 = c; w0 = w; }
        else if (w > w1) { i3 = i2; w3 = w2; i2 = i1; w2 = w1; i1 = c; w1 = w; }
        else if (w > w2) { i3 = i2; w3 = w2; i2 = c; w2 = w; }
        else if (w > w3) { i3 = c; w3 = w; }
      }
      const picks = [i0, i1, i2, i3];
      const ws = [w0, w1, w2, w3];
      let tot = 0;
      for (let s = 0; s < 4; s++) if (picks[s] >= 0 && ws[s] > 0) tot += ws[s];
      if (tot <= 0) {
        skinIndex[(vo + i) * 4] = cands[0];
        skinWeight[(vo + i) * 4] = 1;
        continue;
      }
      for (let s = 0; s < 4; s++) {
        const c = picks[s];
        if (c < 0 || ws[s] <= 0) continue;
        skinIndex[(vo + i) * 4 + s] = cands[c];
        skinWeight[(vo + i) * 4 + s] = ws[s] / tot;
      }
    }
  }

  /**
   * Vertex colour = baked capsule AO x crevice grime x edge wear x per-part
   * tint. This is what puts dark under the plate carrier and the helmet brim,
   * grime at the hems and boots, and rub-through on knees and elbows — the
   * things that stop a procedural character reading as plastic.
   *
   * With `weathering: 0` the four weathering terms drop out and this reduces to
   * AO x mottle x tint, which is the only shading a flat untextured livery gets
   * — there is no ORM map behind it any more, so the AO here IS the crevice.
   */
  _shade(order, pos, nrm, col) {
    const occ = this.occluders;
    const nz = this.noise;
    const groundDirt = (y) => Math.max(0, 1 - Math.max(0, y - 0.02) / 0.55);
    const wx = this.weathering;
    for (const part of order) {
      const n = part._vn, vo = part._vo;
      const tint = part.colour ?? [1, 1, 1];
      const wearAmt = (part.wear ?? 0) * wx;
      const grimeAmt = (part.grime ?? 0.5) * wx;
      const dirtAmt = (part.dirt ?? 0.5) * wx;
      const dustAmt = (part.dust ?? 0.22) * wx;
      for (let i = 0; i < n; i++) {
        const vi = vo + i;
        const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
        const nx = nrm[vi * 3], ny = nrm[vi * 3 + 1], nz3 = nrm[vi * 3 + 2];

        // --- capsule AO: sample each proxy, attenuate by how deeply the
        //     vertex sits inside it and how much it faces away from it
        let ao = 1;
        for (let o = 0; o < occ.length; o++) {
          const c = occ[o];
          const d = segDist(x, y, z, c.a, c.b);
          const t = d - c.r;
          if (t > 0.09) continue;
          // facing term: surfaces pointing into the occluder darken most
          const cx = closestX, cy = closestY, cz = closestZ;
          let dx = cx - x, dy = cy - y, dz = cz - z;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
          const face = Math.max(0, nx * dx + ny * dy + nz3 * dz);
          const w = (1 - Math.min(1, Math.max(0, t) / 0.09)) * face * c.k;
          // 0.42, not 0.55: the vertex AO is multiplied into the albedo, so a
          // heavy term here drags the whole uniform out of the 0.16-0.32 window
          // the material set is calibrated to. Occlusion belongs in the light,
          // not in the diffuse colour — the cavity *grime* below is what should
          // carry the visible darkening.
          ao *= 1 - 0.42 * w;
        }

        // --- crevice grime follows AO, tinted brown-black: strap crossings,
        //     cuffs, the underside of pouch lids, knees and elbows
        const grime = (1 - ao) * grimeAmt;
        // --- ground dirt at the hems / boots
        const dirt = groundDirt(y) * dirtAmt * (0.55 + 0.45 * nz.fbm3(x * 26, y * 26, z * 26, 2));
        // --- settled dust: up-facing surfaces (shoulders, helmet crown, pouch
        //     lids, the tops of the boots) collect a pale film. This is the cue
        //     that separates a worn soldier from a moulded figure.
        const dust =
          Math.max(0, ny) ** 2.2 * (0.35 + 0.65 * nz.fbm3(x * 13 + 4, y * 13, z * 13 + 9, 2)) *
          dustAmt;
        // --- edge wear: outward, upward-ish facets on high parts rub pale
        let wear = 0;
        if (wearAmt > 0) {
          const upness = Math.max(0, ny) * 0.55 + Math.max(0, Math.abs(nz3)) * 0.45;
          const nzv = nz.fbm3(x * 34 + 11, y * 34, z * 34 - 7, 3);
          wear = wearAmt * upness * Math.max(0, nzv * 0.5 + 0.42) ** 1.6;
        }
        // --- broad value noise so no two square centimetres match
        const mottle = 1 + 0.055 * nz.fbm3(x * 9, y * 9, z * 9, 3);

        let r = tint[0] * ao * mottle;
        let g = tint[1] * ao * mottle;
        let b = tint[2] * ao * mottle;
        // grime: pull toward a dark warm neutral
        r = r * (1 - grime) + 0.055 * grime;
        g = g * (1 - grime) + 0.045 * grime;
        b = b * (1 - grime) + 0.036 * grime;
        // ground dirt: pull toward pale sand
        r = r * (1 - dirt * 0.42) + 0.34 * dirt * 0.42;
        g = g * (1 - dirt * 0.42) + 0.30 * dirt * 0.42;
        b = b * (1 - dirt * 0.42) + 0.24 * dirt * 0.42;
        // settled dust on up-facing surfaces: a thin pale film, not a repaint
        r = r * (1 - dust * 0.30) + 0.40 * dust * 0.30;
        g = g * (1 - dust * 0.30) + 0.36 * dust * 0.30;
        b = b * (1 - dust * 0.30) + 0.30 * dust * 0.30;
        // wear: rub toward a scuffed mid grey. 0.33, not 0.5 — abraded nylon
        // goes dull, and a pale target turns every knee pad into a highlight
        r = r * (1 - wear) + 0.33 * wear;
        g = g * (1 - wear) + 0.325 * wear;
        b = b * (1 - wear) + 0.31 * wear;

        col[vi * 3] = clamp01(r);
        col[vi * 3 + 1] = clamp01(g);
        col[vi * 3 + 2] = clamp01(b);
      }
    }
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* closest point on a segment, with the point stashed for the caller */
let closestX = 0, closestY = 0, closestZ = 0;
function segDist(px, py, pz, a, b) {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  closestX = ax + dx * t;
  closestY = ay + dy * t;
  closestZ = az + dz * t;
  return Math.hypot(px - closestX, py - closestY, pz - closestZ);
}

export { segDist };
