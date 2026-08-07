/**
 * The GLB bake pipeline, end to end.
 *
 *   node src/weapons/models/baked.selftest.mjs
 *
 * Builds a synthetic .glb in a temp directory, runs the REAL `tools/glb-bake.mjs`
 * over it, imports the generated module and decodes it with `baked.js` — so the
 * tool, the file format and the runtime decoder are checked against each other
 * rather than against a fixture that could drift from all three.
 *
 * Why this suite exists at all: every failure in this pipeline is silent. A
 * position-only weld still renders, just smooth. A dropped winding flip still
 * renders, just inside out under a mirrored node. A selector that matches
 * nothing still renders, just with the slide welded to the frame — and the only
 * symptom is that the gun stops cycling three animations later. None of these
 * throw, and a capture of a static gun shows most of them as "fine".
 *
 * Each guard below is mutation-checked: I broke the corresponding line in the
 * tool and confirmed the assertion fires (noted per section).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { bakedGeometry, addBaked, requireBaked, bakedTris, bakedBounds } from './baked.js';
import { Assembly, triCount } from '../geometry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bake-'));

let failures = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${what}`);
  }
};
const near = (a, b, eps, what) => ok(Math.abs(a - b) <= eps, `${what}  (${a} vs ${b}, eps ${eps})`);
const section = (name) => console.log(`\n${name}`);

/* ─────────────────────────────────────────────────────────── GLB fixture ── */

/**
 * A unit cube, split into two primitives so the material grouping has something
 * to group. Faces carry their own flat normals and their own four vertices —
 * which is exactly the shape of a low-poly export, and what the weld must not
 * collapse.
 */
const FACES = [
  { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

function facesToArrays(faces, half) {
  const pos = [];
  const nrm = [];
  const idx = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const v of f.v) {
      pos.push(v[0] * half, v[1] * half, v[2] * half);
      nrm.push(...f.n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint16Array.from(idx) };
}

/** Minimal glTF 2.0 binary container: JSON chunk + BIN chunk, 4-byte padded. */
function writeGlb(file, { prims, nodeScale = null, nodeTranslation = null }) {
  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;

  const push = (typed, target, type, componentType, count, minmax) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes, Buffer.alloc(pad));
    offset += bytes.length + pad;
    accessors.push({ bufferView: views.length - 1, componentType, count, type, ...(minmax ?? {}) });
    return accessors.length - 1;
  };

  const primitives = prims.map((p) => {
    const n = p.pos.length / 3;
    const min = [0, 1, 2].map((k) => Math.min(...Array.from({ length: n }, (_, i) => p.pos[i * 3 + k])));
    const max = [0, 1, 2].map((k) => Math.max(...Array.from({ length: n }, (_, i) => p.pos[i * 3 + k])));
    const a = push(p.pos, 34962, 'VEC3', 5126, n, { min, max });
    const b = push(p.nrm, 34962, 'VEC3', 5126, n);
    const c = push(p.idx, 34963, 'SCALAR', 5123, p.idx.length);
    return { attributes: { POSITION: a, NORMAL: b }, indices: c, material: p.material, mode: 4 };
  });

  const bin = Buffer.concat(chunks);
  const node = { name: 'cube', mesh: 0 };
  if (nodeScale) node.scale = nodeScale;
  if (nodeTranslation) node.translation = nodeTranslation;

  const json = {
    asset: { version: '2.0', generator: 'baked.selftest.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [node],
    meshes: [{ name: 'cube', primitives }],
    materials: [{ name: 'Body' }, { name: 'Trim' }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors,
  };

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + jsonPad.length + 8 + bin.length, 8);

  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(jsonBuf.length + jsonPad.length, 0);
  jsonHdr.writeUInt32LE(0x4e4f534a, 4);
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(bin.length, 0);
  binHdr.writeUInt32LE(0x004e4942, 4);

  fs.writeFileSync(file, Buffer.concat([header, jsonHdr, jsonBuf, jsonPad, binHdr, bin]));
}

/* half-extent 0.5 -> a 1 m cube, big enough that quantisation error is readable */
const bodyGeo = facesToArrays(FACES.slice(0, 5), 0.5);
const trimGeo = facesToArrays(FACES.slice(5), 0.5);

const GLB = path.join(TMP, 'cube.glb');
writeGlb(GLB, {
  prims: [
    { ...bodyGeo, material: 0 },
    { ...trimGeo, material: 1 },
  ],
});

const MAP = path.join(TMP, 'cube.materials.json');
fs.writeFileSync(MAP, JSON.stringify({ Body: 'polymer', Trim: 'brass' }));

/** Run the tool and import what it wrote. Cache-busted so re-bakes are visible. */
let bakeSeq = 0;
async function bake(args, { glb = GLB } = {}) {
  const out = path.join(TMP, `out${bakeSeq++}.data.js`);
  execFileSync(process.execPath, [path.join(ROOT, 'tools/glb-bake.mjs'), glb, '--out=' + out, '--quiet', ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return { mod: await import(`file://${out}`), out };
}

/* ══════════════════════════════════════════════════ 1. the round trip ══ */

section('1. bake -> decode round trip');
{
  const { mod } = await bake(['--id=cube', '--map=' + MAP]);
  const { PARTS, BOUNDS, SOURCE } = mod;

  ok(PARTS.length === 2, 'one part per (node, material) pair');
  ok(SOURCE.tris === 12, `12 triangles survive the bake (got ${SOURCE.tris})`);
  ok(bakedTris(PARTS) === 12, 'declared triangle counts agree with SOURCE');

  const byMat = Object.fromEntries(PARTS.map((p) => [p.material, p.mat]));
  ok(byMat.Body === 'polymer' && byMat.Trim === 'brass', 'the material map is applied per glTF material');

  /**
   * The quantisation floor: uint16 across a 1 m span is 15.3 um, so a decoded
   * corner must land within one step of the authored one. Mutation-checked by
   * halving the 65535 divisor in `bakedGeometry` — the corners then land at
   * half scale and this fires on every axis.
   */
  const step = 1 / 65535;
  let worst = 0;
  let decodedTris = 0;
  let unitErr = 0;
  for (const part of PARTS) {
    const geo = bakedGeometry(part, BOUNDS);
    const pos = geo.getAttribute('position').array;
    const nrm = geo.getAttribute('normal').array;
    decodedTris += geo.getIndex().count / 3;
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(Math.abs(pos[i + k]) - 0.5));
      unitErr = Math.max(unitErr, Math.abs(Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) - 1));
    }
  }
  ok(decodedTris === 12, `all 12 triangles decode (got ${decodedTris})`);
  near(worst, 0, step * 1.5, 'every cube corner decodes to +/-0.5 m within one quantisation step');
  near(unitErr, 0, 1e-5, 'decoded normals are unit length');
}

/* ══════════════════════════════════════════ 2. the weld keeps the facets ══ */

section('2. the weld preserves normal splits');
{
  const { mod } = await bake(['--id=cube', '--map=' + MAP]);
  const verts = mod.PARTS.reduce((s, p) => s + p.verts, 0);

  /**
   * THE guard on this pipeline.
   *
   * A cube authored flat-shaded has 24 vertices: four per face, because the
   * three faces meeting at a corner disagree about the normal there. A weld
   * keyed on position alone collapses those to 8, three-quarters of the mesh
   * disappears into shared corners, and every hard edge on the gun turns into a
   * smooth ramp. The model still renders, still has 12 triangles, and looks
   * like a lighting or material bug rather than a mesh one.
   *
   * Mutation-checked: dropping the normal terms from the weld key in
   * glb-bake.mjs takes this to 12 and the assertion fires.
   */
  ok(verts === 24, `flat-shaded cube keeps 24 vertices, not 8 (got ${verts})`);

  /* A genuinely duplicated vertex must still be removed, or the weld is a no-op
     that happens to pass the check above. Re-bake with the trim face repeated. */
  const dupGlb = path.join(TMP, 'dup.glb');
  writeGlb(dupGlb, {
    prims: [
      { ...bodyGeo, material: 0 },
      { ...trimGeo, material: 1 },
      { ...trimGeo, material: 1 },
    ],
  });
  const { mod: dup } = await bake(['--id=dup', '--map=' + MAP], { glb: dupGlb });
  const trim = dup.PARTS.find((p) => p.material === 'Trim');
  ok(trim.verts === 4, `an exactly duplicated face welds back to 4 vertices (got ${trim.verts})`);
  ok(trim.tris === 4, `...while keeping both copies' triangles (got ${trim.tris})`);
}

/* ═══════════════════════════════════════════════ 3. placement arguments ══ */

section('3. --scale / --rot / --origin');
{
  const { mod } = await bake(['--id=cube', '--map=' + MAP, '--scale=0.5']);
  near(mod.BOUNDS.max[0] - mod.BOUNDS.min[0], 0.5, 1e-4, '--scale=0.5 halves the extent');

  const { mod: moved } = await bake(['--id=cube', '--map=' + MAP, '--origin=0.5,0,0']);
  near(moved.BOUNDS.max[0], 0, 1e-4, '--origin shifts the model in POST-rotation space');
  near(moved.BOUNDS.min[0], -1, 1e-4, '...by exactly the given offset');

  /**
   * A 90-degree yaw has to move the long axis, not just relabel it. A cube is
   * symmetric, so stretch it first: scale the fixture on X and check the length
   * lands on Z, which is the transform every Sketchfab gun needs (they export
   * muzzle-down-+X; the engine wants muzzle-down--Z, see models/pistol.js).
   */
  const longGlb = path.join(TMP, 'long.glb');
  writeGlb(longGlb, { prims: [{ ...bodyGeo, material: 0 }, { ...trimGeo, material: 1 }], nodeScale: [4, 1, 1] });
  const { mod: yaw } = await bake(['--id=long', '--map=' + MAP, '--rot=0,90,0'], { glb: longGlb });
  const ext = [0, 1, 2].map((k) => yaw.BOUNDS.max[k] - yaw.BOUNDS.min[k]);
  near(ext[2], 4, 1e-3, '--rot=0,90,0 puts the long axis on Z');
  near(ext[0], 1, 1e-3, '...and the short axis on X');
}

/* ═════════════════════════════════════ 4. mirrored nodes keep their facing ══ */

section('4. negative-determinant nodes flip winding');
{
  /**
   * A node with a negative scale mirrors its mesh, which reverses triangle
   * winding. Left unhandled, every face of that part is backface-culled: the
   * part vanishes, or worse, renders inside-out and shadows wrongly. Sketchfab
   * exports mirror the left-hand furniture of a gun routinely.
   *
   * Check the geometric truth rather than the index order: on a closed convex
   * mesh, an outward-facing triangle's winding normal must agree with the
   * direction from the centroid. Mutation-checked by removing `tri.reverse()`
   * from the tool — every one of the 12 triangles then disagrees.
   */
  const mirrorGlb = path.join(TMP, 'mirror.glb');
  writeGlb(mirrorGlb, {
    prims: [{ ...bodyGeo, material: 0 }, { ...trimGeo, material: 1 }],
    nodeScale: [-1, 1, 1],
  });
  const { mod } = await bake(['--id=mirror', '--map=' + MAP], { glb: mirrorGlb });

  let agree = 0;
  let total = 0;
  for (const part of mod.PARTS) {
    const geo = bakedGeometry(part, mod.BOUNDS);
    const pos = geo.getAttribute('position').array;
    const idx = geo.getIndex().array;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      total++;
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0) agree++;
    }
  }
  ok(agree === total, `all ${total} triangles face outward through a mirrored node (got ${agree})`);
}

/* ═══════════════════════════════════════════ 5. the Assembly integration ══ */

section('5. addBaked / requireBaked');
{
  const { mod } = await bake(['--id=cube', '--map=' + MAP]);
  const { PARTS, BOUNDS } = mod;

  const asm = new Assembly('cube');
  const added = addBaked(asm, PARTS, BOUNDS);
  ok(added === 2, `addBaked reports what it added (got ${added})`);
  const map = asm.build();
  ok(map.size === 2, 'one bucket per material key');
  ok([...map.keys()].sort().join(',') === 'brass,polymer', `buckets carry the mapped keys (${[...map.keys()]})`);
  let tris = 0;
  for (const geo of map.values()) tris += triCount(geo);
  ok(tris === 12, `every triangle reaches the Assembly (got ${tris})`);

  /* Selection is how a slide leaves the frame; both directions must work. */
  const only = new Assembly('trim');
  ok(addBaked(only, PARTS, BOUNDS, { include: /cube/ }) === 2, 'include matches on node name');
  const none = new Assembly('none');
  ok(addBaked(none, PARTS, BOUNDS, { include: /slide/ }) === 0, 'a non-matching include adds nothing');
  const filtered = new Assembly('filtered');
  ok(
    addBaked(filtered, PARTS, BOUNDS, { exclude: (p) => p.mat === 'brass' }) === 1,
    'exclude accepts a predicate and runs after include'
  );

  /**
   * The silent failure this pipeline is most likely to hit in practice: a
   * re-bake renames parts, the selector stops matching, and the moving assembly
   * is quietly empty. `requireBaked` is the reason that becomes a boot error.
   */
  let threw = false;
  try {
    requireBaked(new Assembly('x'), PARTS, BOUNDS, { include: /nonexistent/ });
  } catch {
    threw = true;
  }
  ok(threw, 'requireBaked throws when a selector matches nothing');

  const bounds = bakedBounds(PARTS);
  near(bounds.max[1] - bounds.min[1], 1, 1e-3, 'bakedBounds measures the selection');
}

/* ══════════════════════════════════════════ 6. refusals and determinism ══ */

section('6. refusals and determinism');
{
  /* A material key that does not exist in materials.js must fail the bake, not
     silently ship a missing material. */
  const badMap = path.join(TMP, 'bad.json');
  fs.writeFileSync(badMap, JSON.stringify({ Body: 'unobtainium', Trim: 'brass' }));
  let rejected = false;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/glb-bake.mjs'), GLB, '--out=' + path.join(TMP, 'bad.js'), '--map=' + badMap], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch {
    rejected = true;
  }
  ok(rejected, 'an unknown material key is rejected against src/weapons/materials.js');

  /**
   * `tools/baseline.mjs` compares captures pixel for pixel, so a re-bake of an
   * unchanged source must be byte-identical or every visual baseline is noise.
   */
  const a = await bake(['--id=cube', '--map=' + MAP]);
  const b = await bake(['--id=cube', '--map=' + MAP]);
  const readNoHeader = (f) => fs.readFileSync(f, 'utf8').split('export const SOURCE')[1];
  ok(readNoHeader(a.out) === readNoHeader(b.out), 'two bakes of the same source are byte-identical');
}

/* ─────────────────────────────────────────────────────────────── verdict ── */

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log('baked geometry pipeline OK');
