#!/usr/bin/env node
/**
 * GLB -> COMMITTED GEOMETRY SOURCE.
 *
 *   node tools/glb-bake.mjs <file.glb>                          # inspect
 *   node tools/glb-bake.mjs <file.glb> --id=g31 --out=src/weapons/models/g31.data.js
 *
 * The sibling of `tools/glb-plan.mjs`. Where that one turns a downloaded model
 * into MEASUREMENTS for hand-authoring a map, this one turns a downloaded gun
 * into a committed ES module of quantised geometry that `src/weapons/models/`
 * can assemble — so a premade mesh becomes a weapon without the engine ever
 * loading a file at runtime.
 *
 * WHY A BAKE AND NOT A LOADER
 * ---------------------------
 * AGENTS.md: no runtime dependencies, no CDN fetches, "every asset the game
 * needs ships in the bundle, so it runs fully offline". A GLTFLoader in the
 * client bundle plus a .glb fetched at boot breaks the second clause and adds
 * parse cost to a boot that TEXTURE-PERF.md already measures at 3.27 s of
 * blocking work. Baking offline keeps the shipped artefact a plain ES module:
 * no loader, no fetch, no decode, deterministic for `tools/baseline.mjs`, and
 * reviewable in a diff (part names, materials and triangle counts are plain
 * text at the top of the file).
 *
 * This is the SFX pipeline applied to geometry: `assets-src/` holds the
 * untracked master, a tool converts it, the OUTPUT is what gets committed.
 *
 * WHAT IT DISCARDS, AND WHY THAT IS SAFE
 * --------------------------------------
 *   TEXCOORD_0  `materials.js` projects every weapon surface in object space
 *               with triplanar blending precisely so merged geometry needs no
 *               unwrap, and `geometry.js normalizeAttributes()` synthesises a
 *               zero UV attribute when one is absent. UVs are dead weight.
 *   materials   glTF PBR values are thrown away. The engine's look comes from
 *               the procedural library + the curvature mask bake, so each glTF
 *               material NAME is mapped to an engine material KEY instead.
 *   tangents, colours, skins, morphs, animations, cameras, lights — unused.
 *
 * Positions become uint16 quantised over the model bounds (~5 um across a 0.3 m
 * pistol, far below what the eye or the mask bake can see) and normals become
 * int8. Vertices identical in BOTH after quantisation are welded, which removes
 * true duplicates while preserving the normal splits that make a low-poly model
 * read as faceted.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/* ─────────────────────────────────────────────────────────────── arguments ── */

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => argv.includes(`--${name}`);

if (!file) {
  console.error(
    'usage: node tools/glb-bake.mjs <file.glb> [--id=<weapon>] [--out=<file.js>]\n' +
      '       [--map=<materials.json>] [--scale=1] [--rot=x,y,z] [--origin=x,y,z]\n' +
      '       [--json] [--quiet]\n' +
      '  no --out: inspect only (part table + a material-map scaffold)'
  );
  process.exit(2);
}

const ID = flag('id', path.basename(file).replace(/\.glb$/i, '').replace(/[^a-z0-9]+/gi, ''));
const OUT = flag('out', '');
const MAP_FILE = flag('map', '');
const SCALE = Number(flag('scale', '1'));
const ROT = flag('rot', '0,0,0').split(',').map(Number);
const ORIGIN = flag('origin', '0,0,0').split(',').map(Number);
const DEFAULT_MAT = flag('default-mat', 'steel');
const JSON_OUT = has('json');
const QUIET = has('quiet');

const log = (...a) => { if (!QUIET) console.log(...a); };

/* ───────────────────────────────────────────────────────── material vocabulary ── */

/**
 * The engine's material keys, read from the source of truth rather than
 * duplicated here — a key added to `materials.js` is usable the same day, and a
 * key removed fails the map validation instead of baking a silent fallback.
 *
 * ALL_MATERIAL_KEYS, not MATERIAL_KEYS: the latter is only the library-derived
 * set, and omits the ones `WeaponMaterials.get()` answers itself. `glass` is in
 * that second group, and an optic lens has nowhere else to go.
 */
let MATERIAL_KEYS;
try {
  ({ ALL_MATERIAL_KEYS: MATERIAL_KEYS } = await import(new URL('../src/weapons/materials.js', import.meta.url)));
} catch (err) {
  console.error(`could not read MATERIAL_KEYS from src/weapons/materials.js: ${err.message}`);
  process.exit(1);
}

/* ──────────────────────────────────────────────────────────── GLB container ── */

const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  /**
   * A `.gltf` + `.bin` pair is the other common download shape and is NOT
   * readable here — this parses the binary container directly. Converting is
   * one command and also collapses the sidecar, so it is worth doing before
   * anything else rather than teaching this tool a second container.
   */
  const hint = /\.gltf$/i.test(file)
    ? `\n${file} is a .gltf. Convert it first:  gltf-transform copy ${file} ${file.replace(/\.gltf$/i, '.glb')}\n(or re-export as glTF Binary from Blender).`
    : '';
  console.error(`${file} is not a GLB (bad magic).${hint}`);
  process.exit(1);
}

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
    off += 8 + len;
    off += (4 - (len % 4)) % 4;
  }
}
if (!gltf) throw new Error('no JSON chunk in GLB');

const required = gltf.extensionsRequired ?? [];
/**
 * Compressed geometry is a hard stop, not a warning: the accessor reader below
 * would happily read the compressed bufferView as floats and emit confident
 * garbage. Everything else in `extensionsRequired` only affects material
 * appearance, which this tool discards anyway.
 */
for (const ext of required) {
  if (/draco|meshopt|quantization/i.test(ext)) {
    console.error(
      `${file} requires ${ext}, which this tool cannot decode.\n` +
        `Re-export uncompressed, or run it through gltf-transform first.`
    );
    process.exit(1);
  }
}

/* ────────────────────────────────────────────────────────── accessor reader ── */

const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Read accessor `i` into a flat Float64Array, honouring byteStride. */
function readAccessor(i) {
  const acc = gltf.accessors[i];
  if (acc.sparse) console.warn(`  ! accessor ${i} is sparse — base values only`);
  const n = NCOMP[acc.type];
  const size = CSIZE[acc.componentType];
  const out = new Float64Array(acc.count * n);
  if (acc.bufferView === undefined) return out; // all zeroes, per spec

  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? n * size;

  for (let e = 0; e < acc.count; e++) {
    const at = base + e * stride;
    for (let c = 0; c < n; c++) {
      const o = at + c * size;
      let v;
      switch (acc.componentType) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); break;
        case 5122: v = bin.readInt16LE(o); break;
        case 5121: v = bin.readUInt8(o); break;
        default: v = bin.readInt8(o); break;
      }
      out[e * n + c] = acc.normalized && acc.componentType !== 5126 ? normalize(v, acc.componentType) : v;
    }
  }
  return out;
}

const normalize = (v, ct) => {
  switch (ct) {
    case 5121: return v / 255;
    case 5123: return v / 65535;
    case 5120: return Math.max(v / 127, -1);
    case 5122: return Math.max(v / 32767, -1);
    default: return v;
  }
};

/* ───────────────────────────────────────────────────────────── node maths ── */

/** Column-major 4x4, glTF convention (same as tools/glb-plan.mjs). */
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

/**
 * Normals transform by the inverse transpose, not the matrix.
 *
 * With a pure rotation+uniform-scale chain the two agree, and every Sketchfab
 * export tested so far is exactly that — but a non-uniform scale anywhere in
 * the node chain would shear every normal and the model would light wrongly in
 * a way that looks like a material bug, not a transform bug. Cheap to be right.
 */
function normalMatrix(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4]);
  if (Math.abs(det) < 1e-20) return a; // degenerate; caller's problem
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  // transpose of the inverse, stored column-major like the source
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
}

const applyN = (n, x, y, z) => {
  const v = [n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) -
  m[4] * (m[1] * m[10] - m[2] * m[9]) +
  m[8] * (m[1] * m[6] - m[2] * m[5]);

/* ─────────────────────────────────────────────── the authored placement ── */

/**
 * Everything the user can move: rotate (XYZ degrees), then uniform scale, then
 * subtract an origin. Applied on top of the glTF's own node transforms, which
 * is where a Sketchfab Z-up->Y-up conversion already lives.
 */
function placement() {
  const [rx, ry, rz] = ROT.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx, row-major maths written straight into column-major slots.
  const r = [
    cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz, 0,
    -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz, 0,
    sy, -sx * cy, cx * cy, 0,
    0, 0, 0, 1,
  ];
  for (let i = 0; i < 12; i++) r[i] *= SCALE;
  const m = Float64Array.from(r);
  m[12] = -ORIGIN[0];
  m[13] = -ORIGIN[1];
  m[14] = -ORIGIN[2];
  return m;
}

/* ──────────────────────────────────────────────── walk the scene, collect ── */

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const PLACE = placement();

/** name -> { node, group, matName, tris:[], min, max } */
const groups = new Map();
let skipped = 0;

function label(nodeName, meshName, i) {
  return nodeName || meshName || `mesh${i}`;
}

/**
 * Exporter scaffolding that carries no meaning. Sketchfab and the FBX
 * converters wrap every scene in three or four of these.
 */
const BOILERPLATE = /^(sketchfab_model|root|rootnode|gltf_scenerootnode|scene|correction|.*\.fbx)$/i;

/**
 * The GROUP is the outermost meaningful ancestor, and it is usually the only
 * human-authored name in the file.
 *
 * Leaf nodes come out of these exporters as `Object_12`, but their parents are
 * named by whoever built the model — `RMR_0`, `G31_1`, `RMR CUT_2`. Those names
 * are exactly the split a weapon needs (optic vs gun vs mount), so throwing
 * them away and keying only on the leaf makes every selector a guess. Both are
 * recorded; selectors match against either.
 */
function groupOf(chain) {
  for (const name of chain) if (name && !BOILERPLATE.test(name)) return name;
  return '';
}

function collect(nodeIndex, parent, inheritedName, chain) {
  const node = gltf.nodes[nodeIndex];
  const world = mul(parent, trs(node));
  const name = node.name || inheritedName;
  const here = [...chain, node.name ?? ''];
  const group = groupOf(here);

  if (node.mesh !== undefined) {
    const nm = normalMatrix(world);
    const flip = det3(world) < 0;
    const mesh = gltf.meshes[node.mesh];
    for (let p = 0; p < (mesh.primitives ?? []).length; p++) {
      const prim = mesh.primitives[p];
      if ((prim.mode ?? 4) !== 4) { skipped++; continue; } // triangles only
      if (prim.attributes?.POSITION === undefined) { skipped++; continue; }

      const matName = prim.material !== undefined ? gltf.materials[prim.material].name ?? `material${prim.material}` : '(none)';
      const key = `${group} ${label(name, mesh.name, node.mesh)} ${matName}`;
      let g = groups.get(key);
      if (!g) {
        g = { node: label(name, mesh.name, node.mesh), group, matName, v: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        groups.set(key, g);
      }

      const pos = readAccessor(prim.attributes.POSITION);
      const nrm = prim.attributes.NORMAL !== undefined ? readAccessor(prim.attributes.NORMAL) : null;
      const idx = prim.indices !== undefined ? readAccessor(prim.indices) : null;
      const count = idx ? idx.length : pos.length / 3;

      for (let i = 0; i + 2 < count; i += 3) {
        const tri = [0, 1, 2].map((k) => (idx ? idx[i + k] : i + k));
        if (flip) tri.reverse();
        for (const vi of tri) {
          const wp = apply(world, pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
          const fp = apply(PLACE, wp[0], wp[1], wp[2]);
          let fn;
          if (nrm) {
            const wn = applyN(nm, nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
            fn = applyN(normalMatrix(PLACE), wn[0], wn[1], wn[2]);
          } else {
            fn = null; // filled by the face-normal pass below
          }
          g.v.push({ p: fp, n: fn });
          for (let k = 0; k < 3; k++) {
            g.min[k] = Math.min(g.min[k], fp[k]);
            g.max[k] = Math.max(g.max[k], fp[k]);
          }
        }
      }
    }
  }
  for (const child of node.children ?? []) collect(child, world, name, here);
}

const scene = gltf.scenes[gltf.scene ?? 0];
for (const root of scene.nodes) collect(root, IDENTITY, '', []);

if (!groups.size) {
  console.error('no triangle geometry found in the scene');
  process.exit(1);
}

/** A primitive without NORMAL gets flat face normals — the glTF default. */
for (const g of groups.values()) {
  for (let i = 0; i + 2 < g.v.length; i += 3) {
    if (g.v[i].n) continue;
    const [a, b, c] = [g.v[i].p, g.v[i + 1].p, g.v[i + 2].p];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++) g.v[i + k].n = [n[0] / l, n[1] / l, n[2] / l];
  }
}

/* model bounds, after placement */
const MIN = [Infinity, Infinity, Infinity];
const MAX = [-Infinity, -Infinity, -Infinity];
for (const g of groups.values())
  for (let k = 0; k < 3; k++) {
    MIN[k] = Math.min(MIN[k], g.min[k]);
    MAX[k] = Math.max(MAX[k], g.max[k]);
  }
/** A perfectly flat axis would divide by zero when quantising. */
const SPAN = MIN.map((v, k) => Math.max(MAX[k] - v, 1e-6));

const parts = [...groups.values()].sort((a, b) => b.v.length - a.v.length || a.node.localeCompare(b.node));
const totalTris = parts.reduce((s, g) => s + g.v.length / 3, 0);

/* ──────────────────────────────────────────────────────── material mapping ── */

const matMap = MAP_FILE ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
/**
 * JSON has no comments, so a leading underscore marks a note rather than a
 * mapping. Skipped by both the validator and the lookup.
 */
const unknown = Object.entries(matMap).filter(
  ([k, v]) => !k.startsWith('_') && !MATERIAL_KEYS.includes(v)
);
if (unknown.length) {
  console.error(
    `${MAP_FILE} maps to material keys that do not exist in src/weapons/materials.js:\n` +
      unknown.map(([k, v]) => `  ${k} -> ${v}`).join('\n') +
      `\nvalid keys: ${MATERIAL_KEYS.join(', ')}`
  );
  process.exit(1);
}
const unmapped = new Set();

/**
 * Resolve a part's engine material key, most specific key first:
 *
 *   "G31_1/Object_11"  a single part
 *   "Object_11"        a leaf name
 *   "G31_1"            a whole group
 *   "Material.001"     every part sharing a glTF material
 *
 * The material name alone is not enough, and this is not a corner case: on the
 * G31 the single glTF material `Material.001` is shared by the red-dot housing
 * and the polymer grip, which must not end up on the same engine key. Modellers
 * reuse a material for whatever was the same colour in the viewport, so the
 * glTF material is a colour, not a substance.
 */
const matKeyFor = (g) => {
  for (const key of [`${g.group}/${g.node}`, g.node, g.group, g.matName]) {
    if (key && !key.startsWith('_') && matMap[key]) return matMap[key];
  }
  unmapped.add(g.matName);
  return DEFAULT_MAT;
};

/* ──────────────────────────────────────────────────────────────── report ── */

const fmt = (n, d = 4) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

log(`${path.relative(process.cwd(), file)}  —  ${parts.length} parts, ${totalTris} triangles`);
log(`extent  ${fmt(SPAN[0], 3)} x ${fmt(SPAN[1], 3)} x ${fmt(SPAN[2], 3)} m` + (SCALE !== 1 ? `  (after --scale=${SCALE})` : ''));
log(`bounds  min [${MIN.map((v) => fmt(v, 3)).join(', ')}]  max [${MAX.map((v) => fmt(v, 3)).join(', ')}]`);
if (skipped) log(`skipped ${skipped} non-triangle / positionless primitives`);
log('');
/**
 * A Sketchfab export names every part `Object_12`, so the only way to tell the
 * slide from the trigger is where it sits and how big it is. Centre and extent
 * are therefore the load-bearing columns of this table, not decoration.
 */
log('  group          part            glTF material    matKey         tris  centre (m)             extent (m)');
log('  ' + '-'.repeat(115));
for (const g of parts) {
  const ext = g.min.map((v, k) => fmt(g.max[k] - v, 3)).join(' x ');
  const mid = g.min.map((v, k) => fmt((g.max[k] + v) / 2, 3).padStart(6)).join(' ');
  log(
    '  ' +
      (g.group || '-').padEnd(14).slice(0, 14) +
      ' ' +
      g.node.padEnd(15).slice(0, 15) +
      ' ' +
      g.matName.padEnd(16).slice(0, 16) +
      ' ' +
      matKeyFor(g).padEnd(13) +
      String(g.v.length / 3).padStart(5) +
      '  ' +
      mid +
      '   ' +
      ext
  );
}

if (unmapped.size && MAP_FILE) {
  log('');
  log(`  ! ${unmapped.size} glTF material(s) not in ${MAP_FILE} — defaulted to '${DEFAULT_MAT}'`);
}

if (!OUT) {
  log('');
  /**
   * The map is committed next to the BAKED OUTPUT, not next to the source
   * model: `assets-src/*` is gitignored, so a map saved beside the .glb is gone
   * on the next clone and the re-bake command in the generated header stops
   * being reproducible.
   */
  log(`material-map scaffold (save as src/weapons/models/${ID}.materials.json, then --map=)`);
  const scaffold = {};
  // Seeded from the glTF materials; override any single part or group by adding
  // a "<group>/<node>", "<node>" or "<group>" key alongside these.
  for (const g of parts) scaffold[g.matName] = matMap[g.matName] ?? DEFAULT_MAT;
  log(JSON.stringify(scaffold, null, 2));
  log('');
  log(`valid material keys: ${MATERIAL_KEYS.join(', ')}`);
  log('');
  log('no --out given: nothing written. Add --out=src/weapons/models/<id>.data.js to bake.');
  if (JSON_OUT) console.log(JSON.stringify({ parts: parts.map((g) => ({ node: g.node, material: g.matName, tris: g.v.length / 3 })), bounds: { min: MIN, max: MAX } }, null, 2));
  process.exit(0);
}

/* ────────────────────────────────────────────────────────────── quantise ── */

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

const qpos = (v, k) => Math.max(0, Math.min(65535, Math.round(((v - MIN[k]) / SPAN[k]) * 65535)));
const qnrm = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));

let bakedVerts = 0;
let bakedTris = 0;

const baked = parts.map((g) => {
  /**
   * Weld on the QUANTISED key, not the float one.
   *
   * Two things fall out of that. It is exactly consistent with what ships — a
   * pair that survives as distinct here is distinct in the output — and it
   * preserves the normal splits a low-poly model relies on to read as faceted,
   * because the key includes the normal. A position-only weld would smooth
   * every hard edge on the gun and is the one mistake that looks like a
   * shading bug rather than a mesh bug.
   */
  const seen = new Map();
  const pos = [];
  const nrm = [];
  const idx = [];
  for (const v of g.v) {
    const q = [qpos(v.p[0], 0), qpos(v.p[1], 1), qpos(v.p[2], 2)];
    const n = [qnrm(v.n[0]), qnrm(v.n[1]), qnrm(v.n[2])];
    const key = `${q[0]},${q[1]},${q[2]},${n[0]},${n[1]},${n[2]}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = pos.length / 3;
      seen.set(key, at);
      pos.push(q[0], q[1], q[2]);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(at);
  }
  const vcount = pos.length / 3;
  if (vcount > 65536) {
    console.error(`part '${g.node}' has ${vcount} vertices — over the uint16 index limit. Split it in the source model.`);
    process.exit(1);
  }
  bakedVerts += vcount;
  bakedTris += idx.length / 3;
  return {
    node: g.node,
    group: g.group,
    material: g.matName,
    mat: matKeyFor(g),
    tris: idx.length / 3,
    verts: vcount,
    min: g.min,
    max: g.max,
    pos: b64(Uint16Array.from(pos)),
    nrm: b64(Int8Array.from(nrm)),
    idx: b64(Uint16Array.from(idx)),
  };
});

/* ───────────────────────────────────────────────────────────────── emit ── */

const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const rel = path.relative(process.cwd(), file);
const j = (v) => JSON.stringify(v);
const round = (a) => a.map((v) => Number(v.toFixed(6)));

const lines = [];
lines.push('/**');
lines.push(` * ${ID} — baked geometry. GENERATED FILE, DO NOT EDIT.`);
lines.push(' *');
lines.push(` *   node tools/glb-bake.mjs ${rel} \\`);
lines.push(`     --id=${ID} --out=${path.relative(process.cwd(), OUT)}${MAP_FILE ? ` \\\n     --map=${path.relative(process.cwd(), MAP_FILE)}` : ''}${SCALE !== 1 ? ` --scale=${SCALE}` : ''}${ROT.some(Boolean) ? ` --rot=${ROT.join(',')}` : ''}${ORIGIN.some(Boolean) ? ` --origin=${ORIGIN.join(',')}` : ''}`);
lines.push(' *');
lines.push(` * source   ${rel}  (sha256:${sha})`);
lines.push(` * geometry ${baked.length} parts, ${bakedTris} triangles, ${bakedVerts} vertices`);
lines.push(` * extent   ${fmt(SPAN[0], 3)} x ${fmt(SPAN[1], 3)} x ${fmt(SPAN[2], 3)} m`);
lines.push(' *');
lines.push(' * Positions are uint16 over BOUNDS, normals int8; decode with');
lines.push(" * `bakedParts()` from './baked.js'. See .claude/skills/glb-weapon/.");
lines.push(' *');
lines.push(' * parts (group / node / glTF material -> engine matKey / triangles):');
for (const p of baked) lines.push(` *   ${(p.group || '-').padEnd(14).slice(0, 14)} ${p.node.padEnd(14).slice(0, 14)} ${p.material.padEnd(16).slice(0, 16)} -> ${p.mat.padEnd(13)} ${String(p.tris).padStart(5)}`);
lines.push(' */');
lines.push('');
lines.push(`export const SOURCE = ${j({ file: rel, sha256: sha, tris: bakedTris, verts: bakedVerts })};`);
lines.push('');
lines.push(`export const BOUNDS = { min: ${j(round(MIN))}, max: ${j(round(MAX))} };`);
lines.push('');
lines.push('export const PARTS = [');
for (const p of baked) {
  lines.push('  {');
  lines.push(`    node: ${j(p.node)}, group: ${j(p.group)}, material: ${j(p.material)}, mat: ${j(p.mat)},`);
  lines.push(`    tris: ${p.tris}, verts: ${p.verts},`);
  lines.push(`    min: ${j(round(p.min))}, max: ${j(round(p.max))},`);
  lines.push(`    pos: ${j(p.pos)},`);
  lines.push(`    nrm: ${j(p.nrm)},`);
  lines.push(`    idx: ${j(p.idx)},`);
  lines.push('  },');
}
lines.push('];');
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'));

const bytes = fs.statSync(OUT).size;
log('');
log(`wrote ${path.relative(process.cwd(), OUT)}`);
log(`  ${baked.length} parts, ${bakedTris} tris, ${bakedVerts} verts`);
log(`  ${(bytes / 1024).toFixed(1)} KB source  (source .glb was ${(buf.length / 1024).toFixed(1)} KB)`);
if (unmapped.size) {
  log('');
  log(`  ! defaulted to '${DEFAULT_MAT}': ${[...unmapped].join(', ')}`);
  log(`    map these with --map=<json> before shipping — one material for the whole gun reads as a toy.`);
}
log('');
log('next: author src/weapons/models/' + ID + '.js — see .claude/skills/glb-weapon/references/weapon-contract.md');
