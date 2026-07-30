#!/usr/bin/env node
/**
 * GLB -> FLOOR PLAN.
 *
 *   node tools/glb-plan.mjs <file.glb> [--cell=1] [--slices=0.6,2,4,7] [--json=out.json]
 *
 * Reads a .glb purely as reference material for authoring a map by hand. It
 * reports the model's true extent in metres, the named parts it is built from,
 * and a top-down ASCII occupancy plan sliced at several heights — which is
 * everything you need to transcribe a layout into a `src/world/<id>.js` module.
 *
 * NOTHING HERE SHIPS. Workmelt generates every mesh in code (see AGENTS.md), so
 * a downloaded model is a measuring tape, never an asset. That is also why this
 * parses the container by hand instead of using three's GLTFLoader: all we want
 * is POSITION accessors and the node transforms above them, and the loader's
 * path drags in texture decoding that has no DOM to run against under node.
 *
 * Sketchfab conversions are routinely not in metres and routinely Z-up; the
 * report leads with extent and an up-axis guess so both are caught before a
 * single coordinate is copied out.
 */

import fs from 'node:fs';
import path from 'node:path';

/* ─────────────────────────────────────────────────────────────── arguments ── */

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

if (!file) {
  console.error('usage: node tools/glb-plan.mjs <file.glb> [--cell=1] [--slices=0.6,2,4,7] [--json=out.json]');
  process.exit(2);
}

const CELL = Number(flag('cell', '1'));
const SLICES = flag('slices', '0.6,2,4,7').split(',').map(Number);
const JSON_OUT = flag('json', '');
const SCALE = Number(flag('scale', '1'));

/* ──────────────────────────────────────────────────────────── GLB container ── */

const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB (bad magic)`);

let gltf = null;
let bin = null;
{
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - ((8 + len) % 4)) % 4) * 0;
    off += (4 - (len % 4)) % 4;
  }
}
if (!gltf) throw new Error('no JSON chunk in GLB');

/* ────────────────────────────────────────────────────────── accessor reader ── */

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Read accessor `i` into a flat JS array, honouring byteStride. */
function readAccessor(i) {
  const acc = gltf.accessors[i];
  if (acc.sparse) console.warn(`  ! accessor ${i} is sparse — base values only`);
  const n = NCOMP[acc.type];
  const comp = COMPONENT[acc.componentType];
  const out = new Float64Array(acc.count * n);
  if (acc.bufferView === undefined) return out; // all zeroes, per spec

  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? n * comp.size;

  for (let e = 0; e < acc.count; e++) {
    const at = base + e * stride;
    for (let c = 0; c < n; c++) {
      const o = at + c * comp.size;
      let v;
      switch (acc.componentType) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); break;
        case 5122: v = bin.readInt16LE(o); break;
        case 5121: v = bin.readUInt8(o); break;
        default: v = bin.readInt8(o); break;
      }
      out[e * n + c] = v;
    }
  }
  return out;
}

/* ───────────────────────────────────────────────────────────── node maths ── */

/** Column-major 4x4, same convention as glTF. */
const mul = (a, b) => {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};

function trs(node) {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return Float64Array.from([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/* ──────────────────────────────────────────────── walk the scene, collect ── */

const parts = []; // one entry per named top-level node
let triCount = 0;
const tris = []; // [ax,ay,az, bx,by,bz, cx,cy,cz] in model space

function collectMesh(meshIndex, world, into) {
  for (const prim of gltf.meshes[meshIndex].primitives ?? []) {
    if ((prim.mode ?? 4) !== 4) continue; // triangles only
    if (prim.attributes?.POSITION === undefined) continue;
    const pos = readAccessor(prim.attributes.POSITION);
    const idx = prim.indices !== undefined ? readAccessor(prim.indices) : null;
    const count = idx ? idx.length : pos.length / 3;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = idx ? idx[i] : i;
      const ib = idx ? idx[i + 1] : i + 1;
      const ic = idx ? idx[i + 2] : i + 2;
      const a = apply(world, pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]);
      const b = apply(world, pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]);
      const c = apply(world, pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]);
      tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      into.tris++;
      triCount++;
      for (const p of [a, b, c]) {
        into.min[0] = Math.min(into.min[0], p[0]); into.max[0] = Math.max(into.max[0], p[0]);
        into.min[1] = Math.min(into.min[1], p[1]); into.max[1] = Math.max(into.max[1], p[1]);
        into.min[2] = Math.min(into.min[2], p[2]); into.max[2] = Math.max(into.max[2], p[2]);
      }
    }
  }
}

function walk(nodeIndex, parent, into) {
  const node = gltf.nodes[nodeIndex];
  const world = mul(parent, trs(node));
  if (node.mesh !== undefined) collectMesh(node.mesh, world, into);
  for (const child of node.children ?? []) walk(child, world, into);
}

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const scene = gltf.scenes[gltf.scene ?? 0];

/**
 * Which level of the tree to report as "parts".
 *
 * A Sketchfab export buries everything under `Sketchfab_model > *.fbx >
 * RootNode`, so at depth 0 the report is one row for the entire model. `--depth`
 * descends that far before splitting, carrying each ancestor's transform down so
 * the reported boxes stay in model space.
 */
const DEPTH = Number(flag('depth', '0'));
let roots = scene.nodes.map((i) => ({ index: i, world: IDENTITY }));
for (let d = 0; d < DEPTH; d++) {
  const next = [];
  for (const r of roots) {
    const node = gltf.nodes[r.index];
    const world = mul(r.world, trs(node));
    for (const c of node.children ?? []) next.push({ index: c, world });
  }
  if (!next.length) break;
  roots = next;
}

for (const { index: rootIndex, world: parentWorld } of roots) {
  const node = gltf.nodes[rootIndex];
  const part = {
    name: node.name ?? `node${rootIndex}`,
    tris: 0,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  walk(rootIndex, parentWorld, part);
  if (part.tris > 0) parts.push(part);
}

/* Scale everything after collection so --scale applies uniformly. */
if (SCALE !== 1) {
  for (let i = 0; i < tris.length; i++) tris[i] *= SCALE;
  for (const p of parts) for (let i = 0; i < 3; i++) { p.min[i] *= SCALE; p.max[i] *= SCALE; }
}

const bbox = {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
};
for (const p of parts)
  for (let i = 0; i < 3; i++) {
    bbox.min[i] = Math.min(bbox.min[i], p.min[i]);
    bbox.max[i] = Math.max(bbox.max[i], p.max[i]);
  }
const dim = [0, 1, 2].map((i) => bbox.max[i] - bbox.min[i]);

/* ────────────────────────────────────────────────────────────── the report ── */

const f = (n) => n.toFixed(1).padStart(7);
console.log(`\n\x1b[1m${path.basename(file)}\x1b[0m — ${triCount.toLocaleString()} triangles, ${parts.length} top-level parts`);
console.log(`\nextent   X ${f(dim[0])}   Y ${f(dim[1])}   Z ${f(dim[2])}   (model units${SCALE !== 1 ? ` x${SCALE}` : ''})`);
console.log(`min      X ${f(bbox.min[0])}   Y ${f(bbox.min[1])}   Z ${f(bbox.min[2])}`);
console.log(`max      X ${f(bbox.max[0])}   Y ${f(bbox.max[1])}   Z ${f(bbox.max[2])}`);

// Up axis: the ground plane is the two big extents; up is the small one.
const up = dim[1] < dim[0] * 0.6 && dim[1] < dim[2] * 0.6 ? 'Y' : dim[2] < dim[0] * 0.6 ? 'Z' : '?';
console.log(`\nup axis  ${up === 'Y' ? 'Y (glTF standard — ready to read)' : up === 'Z' ? 'Z (FBX-style — swap Y/Z when transcribing)' : 'ambiguous — inspect the slices'}`);

const zUp = up === 'Z';
const heightOf = (x, y, z) => (zUp ? z : y);

/**
 * `--yaw` rotates the sampling grid about the up axis before binning.
 *
 * A model whose streets run diagonally through its own axes produces a plan of
 * staircased diagonals that cannot be read as rectangles — and rectangles are
 * what a map module is authored in. Spinning the grid instead of the geometry
 * costs one rotation per sample and leaves the reported part boxes untouched,
 * so the two views stay comparable while you hunt for the angle that squares
 * the layout up.
 */
const YAW = (Number(flag('yaw', '0')) * Math.PI) / 180;
const COS = Math.cos(YAW);
const SIN = Math.sin(YAW);
const uvOf = (x, y, z) => {
  const a = x;
  const b = zUp ? y : z;
  return YAW === 0 ? [a, b] : [a * COS - b * SIN, a * SIN + b * COS];
};

console.log(`\n\x1b[1mparts\x1b[0m (metres, top-down footprint${YAW ? ', UNROTATED model space' : ''})`);
console.log('    tris  name                                    u range          v range          height');
const uvRaw = (x, y, z) => [x, zUp ? y : z];
for (const p of [...parts].sort((a, b) => b.tris - a.tris)) {
  const [u0, v0] = uvRaw(p.min[0], p.min[1], p.min[2]);
  const [u1, v1] = uvRaw(p.max[0], p.max[1], p.max[2]);
  const h0 = heightOf(p.min[0], p.min[1], p.min[2]);
  const h1 = heightOf(p.max[0], p.max[1], p.max[2]);
  console.log(
    `  ${String(p.tris).padStart(6)}  ${p.name.slice(0, 38).padEnd(38)}  ` +
    `${f(u0)}..${f(u1)}  ${f(v0)}..${f(v1)}  ${f(h0)}..${f(h1)}`
  );
}

/* ─────────────────────────────────────────────────────────── occupancy plan ── */

/**
 * Grid extent from the ROTATED samples themselves. Rotating the two corners of
 * an axis-aligned bbox does not give the rotated bbox — it gives two points
 * somewhere inside it — so under `--yaw` that shortcut silently crops the plan.
 */
let uMin = Infinity, vMin = Infinity, uMax = -Infinity, vMax = -Infinity;
for (let t = 0; t < tris.length; t += 3) {
  const [u, v] = uvOf(tris[t], tris[t + 1], tris[t + 2]);
  if (u < uMin) uMin = u;
  if (u > uMax) uMax = u;
  if (v < vMin) vMin = v;
  if (v > vMax) vMax = v;
}
const hMin = bbox.min[zUp ? 2 : 1];

const nu = Math.ceil((uMax - uMin) / CELL);
const nv = Math.ceil((vMax - vMin) / CELL);

/** For each cell, the highest surface in it — the plan is a height field. */
const height = new Float64Array(nu * nv).fill(-Infinity);

for (let t = 0; t < tris.length; t += 9) {
  const P = [
    [tris[t], tris[t + 1], tris[t + 2]],
    [tris[t + 3], tris[t + 4], tris[t + 5]],
    [tris[t + 6], tris[t + 7], tris[t + 8]],
  ];
  const uv = P.map((p) => uvOf(p[0], p[1], p[2]));
  const hh = P.map((p) => heightOf(p[0], p[1], p[2]));
  // Sample density follows the triangle's own size, so a 40 m floor slab fills
  // its cells and a 5 cm bolt costs three samples.
  const span = Math.max(
    Math.hypot(uv[1][0] - uv[0][0], uv[1][1] - uv[0][1]),
    Math.hypot(uv[2][0] - uv[0][0], uv[2][1] - uv[0][1]),
    Math.hypot(uv[2][0] - uv[1][0], uv[2][1] - uv[1][1])
  );
  const n = Math.min(160, Math.max(2, Math.ceil((span / CELL) * 1.6)));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j + i <= n; j++) {
      const a = i / n, b = j / n, c = 1 - a - b;
      const u = uv[0][0] * c + uv[1][0] * a + uv[2][0] * b;
      const v = uv[0][1] * c + uv[1][1] * a + uv[2][1] * b;
      const h = hh[0] * c + hh[1] * a + hh[2] * b;
      const cu = Math.min(nu - 1, Math.max(0, Math.floor((u - uMin) / CELL)));
      const cv = Math.min(nv - 1, Math.max(0, Math.floor((v - vMin) / CELL)));
      const k = cv * nu + cu;
      if (h > height[k]) height[k] = h;
    }
  }
}

console.log(`\n\x1b[1mheight field\x1b[0m — ${nu} x ${nv} cells of ${CELL} m, ` +
  `u ${uMin.toFixed(1)}..${uMax.toFixed(1)}, v ${vMin.toFixed(1)}..${vMax.toFixed(1)}`);
console.log('legend: "." nothing   " " ground   digits/letters = metres above the floor\n');

const glyph = (h) => {
  if (!Number.isFinite(h)) return '.';
  const a = h - hMin;
  if (a < 0.4) return ' ';
  if (a < 10) return String(Math.floor(a));
  return String.fromCharCode(97 + Math.min(25, Math.floor(a) - 10));
};

// Column ruler every 10 cells, so a footprint can be read straight off the grid.
const ruler = (label) => {
  let s = '';
  for (let cu = 0; cu < nu; cu++) s += cu % 10 === 0 ? '|' : ' ';
  console.log(`     ${s}  ${label}`);
};
ruler(`u = ${uMin.toFixed(0)} at column 0, +${CELL * 10} m per |`);
for (let cv = 0; cv < nv; cv++) {
  let row = '';
  for (let cu = 0; cu < nu; cu++) row += glyph(height[cv * nu + cu]);
  const v = (vMin + cv * CELL).toFixed(0).padStart(4);
  console.log(`${v} ${cv % 10 === 0 ? '-' : ' '}${row}`);
}

for (const s of SLICES) {
  console.log(`\n\x1b[1mslice > ${s} m\x1b[0m  (# = something at least this tall)`);
  for (let cv = 0; cv < nv; cv++) {
    let row = '';
    for (let cu = 0; cu < nu; cu++) {
      const h = height[cv * nu + cu];
      row += Number.isFinite(h) ? (h - hMin >= s ? '#' : '.') : ' ';
    }
    console.log(`${(vMin + cv * CELL).toFixed(0).padStart(4)} ${row}`);
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    file, triCount, up, bbox, dim, cell: CELL,
    grid: { nu, nv, uMin, vMin },
    parts: parts.map((p) => ({ name: p.name, tris: p.tris, min: p.min, max: p.max })),
    height: Array.from(height, (h) => (Number.isFinite(h) ? +(h - hMin).toFixed(2) : null)),
  }));
  console.log(`\nwrote ${JSON_OUT}`);
}
