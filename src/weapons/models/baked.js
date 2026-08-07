import { THREE, Assembly } from '../geometry.js';

/**
 * Runtime half of the GLB bake pipeline (`tools/glb-bake.mjs`).
 *
 * A baked model is a plain ES module of quantised typed arrays — no loader, no
 * fetch, no decode of a file format. This turns those arrays back into
 * `THREE.BufferGeometry` and feeds them to an `Assembly`, which is the only
 * thing `viewmodel.addWeapon` knows how to consume.
 *
 * Cost: one Uint16/Int8 -> Float32 pass per part at boot, ~5k triangles for a
 * pistol. That is a fraction of a millisecond and it happens once.
 *
 * The quantisation contract, mirrored from the tool:
 *   position   uint16 0..65535 mapped linearly across BOUNDS per axis
 *   normal     int8 -127..127, renormalised on decode
 *   index      uint16, one part is one draw's worth of geometry
 */

const b64 = (s, Type) => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer, 0, bin.length / Type.BYTES_PER_ELEMENT);
};

/**
 * One baked part -> one geometry, in weapon-local metres.
 *
 * @param {object} part   an entry from a generated `PARTS` array
 * @param {object} bounds the module's `BOUNDS`
 * @returns {THREE.BufferGeometry}
 */
export function bakedGeometry(part, bounds) {
  const q = b64(part.pos, Uint16Array);
  const n = b64(part.nrm, Int8Array);
  const idx = b64(part.idx, Uint16Array);

  const count = q.length / 3;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const span = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];

  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = bounds.min[k] + (q[i * 3 + k] / 65535) * span[k];
    }
    // int8 quantisation costs up to ~0.4 degrees of direction; renormalising
    // matters because the mask bake and the shader both assume unit normals.
    const x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l;
    nrm[i * 3 + 1] = y / l;
    nrm[i * 3 + 2] = z / l;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // No uv: `normalizeAttributes` synthesises a zero one, and the weapon
  // materials project in object space (triplanar), so nothing samples it.
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return geo;
}

/**
 * Add a selection of baked parts to an `Assembly`, each under its own material
 * key.
 *
 * Selection is what makes a gun out of a mesh: the slide, magazine and trigger
 * have to leave the body and become their own assemblies or they cannot animate.
 * Author the split with `include`/`exclude` against the part node names printed
 * in the generated file's header.
 *
 *   const body = new Assembly('g31-frame');
 *   addBaked(body, PARTS, BOUNDS, { exclude: /slide|magazine|trigger/i });
 *
 *   const slide = new Assembly('g31-slide');
 *   addBaked(slide, PARTS, BOUNDS, { include: /slide/i, offset: { y: -BORE } });
 *
 * @param {Assembly} asm
 * @param {Array}    parts   a generated `PARTS` array
 * @param {object}   bounds  the matching `BOUNDS`
 * @param {object}   opts    { include, exclude, mat, offset }
 *   include  RegExp | string[] | fn(part) — parts to take (default: all)
 *   exclude  RegExp | string[] | fn(part) — parts to skip, applied after include
 *   mat      override the baked material key for every selected part
 *   offset   a transform passed straight to `Assembly.add` (x/y/z/rx/ry/rz/s*)
 * @returns {number} how many parts were added — assert on it, see below
 */
export function addBaked(asm, parts, bounds, opts = {}) {
  const { include = null, exclude = null, mat = null, offset = null } = opts;
  let added = 0;
  for (const part of parts) {
    if (!matches(part, include, true)) continue;
    if (matches(part, exclude, false)) continue;
    const geo = bakedGeometry(part, bounds);
    asm.add(geo, mat ?? part.mat, offset);
    geo.dispose();
    added++;
  }
  return added;
}

/**
 * A selector that matches nothing is the failure mode of this whole pipeline:
 * a renamed part in a re-bake silently leaves the slide welded to the frame,
 * the gun still renders, and the only symptom is that it stops cycling. Call
 * this rather than ignoring `addBaked`'s return value.
 */
export function requireBaked(asm, parts, bounds, opts = {}) {
  const n = addBaked(asm, parts, bounds, opts);
  if (n === 0) {
    throw new Error(
      `addBaked matched no parts for ${JSON.stringify(String(opts.include ?? '*'))} — ` +
        `available: ${parts.map((p) => p.node).join(', ')}`
    );
  }
  return n;
}

function matches(part, sel, dflt) {
  if (sel === null || sel === undefined) return dflt;
  if (sel instanceof RegExp) return sel.test(part.node);
  if (Array.isArray(sel)) return sel.includes(part.node);
  if (typeof sel === 'function') return !!sel(part);
  return part.node === sel;
}

/** Total triangles across a `PARTS` array — for the budget line in a summary. */
export function bakedTris(parts) {
  return parts.reduce((s, p) => s + p.tris, 0);
}

/** Axis-aligned bounds of a selection, for deriving node positions by eye. */
export function bakedBounds(parts, sel = null) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    if (!matches(part, sel, true)) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], part.min[k]);
      max[k] = Math.max(max[k], part.max[k]);
    }
  }
  return { min, max };
}

export { Assembly };
