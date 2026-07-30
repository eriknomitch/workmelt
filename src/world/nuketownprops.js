import { PB } from './props.js';

/**
 * WORLD — Nuketown's own instanced prop library.
 *
 * `props.js` is the market's vocabulary and every prototype in it is dressed for
 * a lived-in street: weathered wood, rusted steel, litter, sandbags. Nuketown is
 * a blockout, so it needs the same three objects with all of that taken away —
 * and it needs them as SEPARATE prototypes rather than as a remap of the shared
 * ones, because `crate_a` is placed by four other maps that did not ask to be
 * restyled.
 *
 * Three prototypes cover the whole map. That is not a shortcut, it is the look:
 * the reference blockouts this map is styled after are built from a crate, a
 * barrel and a block, repeated. Litter, tyres and sandbags are deliberately
 * absent — a greybox has no debris, and the moment it does it stops reading as
 * one.
 *
 * Each comes out of `PB` as ONE merged geometry, so it is one instanced draw
 * call however many boxes went into it, and every part is a chamfered box or a
 * cylinder. Nothing here needs a normal map to do its job.
 *
 * MASKS ARE LEFT AT THEIR DEFAULTS AND THEN IGNORED. `PB` writes the usual
 * wear/grime/AO vertex colours, but every `gb_*` palette key sets
 * `vertexMasks: false`, so the shader compiles that block out entirely. The
 * attribute is paid for and unread — the alternative is a bespoke PB path, and
 * a few bytes of vertex colour is much cheaper than a fork of the prop builder.
 */

/**
 * The crate: a cube with a dark X-brace on all four sides.
 *
 * The brace is the entire point. A plain grey cube at 15 m is a smudge with no
 * scale and no orientation; two diagonals across it give the eye something to
 * measure the map with, which is exactly the job a crate does in a blockout.
 * They are separate thin boxes in a second material rather than a texture, so
 * they survive at any distance the geometry does.
 */
function blockCrate(size = 0.92) {
  const p = new PB();
  const s = size;
  p.box(s, s, s, 0, 0, 0, { bevel: 0.012 });
  return p.build();
}

/** The crate's bracing, built separately so it can carry the dark key. */
function blockCrateBrace(size = 0.92) {
  const p = new PB();
  const s = size;
  const t = 0.075;              // brace thickness
  const d = s * 0.5 + 0.008;    // sit just proud of the face, never inside it
  const len = s * 1.30;         // a touch over the diagonal, trimmed by the face
  const ang = Math.PI / 4;

  // Two diagonals per face. X and Z faces only: the top and bottom of a stacked
  // crate are never seen, and bracing them would double the triangles for
  // nothing.
  for (const sx of [-1, 1])
    for (const a of [ang, -ang]) p.box(len, t, t * 0.6, sx * d, 0, 0, { ry: Math.PI / 2, rx: a, bevel: 0.004 });
  for (const sz of [-1, 1])
    for (const a of [ang, -ang]) p.box(len, t, t * 0.6, 0, 0, sz * d, { rz: a, bevel: 0.004 });

  // A rail top and bottom on the two braced faces, which is what stops the
  // diagonals reading as an X floating in front of a cube.
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      p.box(t * 0.6, t, s, sx * d, sy * (s / 2 - t / 2), 0, { bevel: 0.004 });
  for (const sz of [-1, 1])
    for (const sy of [-1, 1])
      p.box(s, t, t * 0.6, 0, sy * (s / 2 - t / 2), sz * d, { bevel: 0.004 });

  return p.build();
}

/**
 * The barrel: the map's one saturated object, so it is worth its triangles.
 *
 * 14 radial segments rather than the 12 the shared barrel uses — a barrel is
 * the only curved silhouette on a map made entirely of boxes, and the two extra
 * facets are what keep it from reading as a heptagon against a flat wall.
 */
function blockBarrel(r = 0.30, h = 0.88) {
  const p = new PB();
  p.cyl(r, h, 0, 0, 0, { radial: 14 });
  // Three rolling hoops. On a flat-shaded orange cylinder these are the only
  // thing casting a shadow onto the barrel itself.
  for (const y of [-h * 0.30, 0, h * 0.30]) p.cyl(r * 1.045, 0.055, 0, y, 0, { radial: 14 });
  // Rim and base, so it meets the ground with an edge instead of a seam.
  for (const sy of [-1, 1]) p.cyl(r * 0.97, 0.05, 0, sy * (h / 2 - 0.025), 0, { radial: 14 });
  return p.build();
}

/**
 * The block: a low grid-textured slab, the blockout's unit of cover.
 *
 * Deliberately a bare box with a generous chamfer and nothing else — it carries
 * the same 1 m grid as the deck, so the surface already tells you how big it is
 * and any added detail would only fight that.
 */
function blockCube(w = 1.5, h = 0.86, d = 1.0) {
  const p = new PB();
  p.box(w, h, d, 0, 0, 0, { bevel: 0.02 });
  return p.build();
}

/**
 * Register Nuketown's prototypes. Called after `registerProps`, and the ids are
 * prefixed `gb_` so they can never collide with the shared vocabulary.
 *
 * `chunk: false` on all of them: the whole map is 51 x 42 m, comfortably inside
 * the Assembler's 64 m chunking threshold, so splitting these clouds spatially
 * would buy no culling and cost a draw call per chunk per prototype.
 */
export function registerNuketownProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });

  // Mid-grey, NOT the white the masses use. A white crate against a white house
  // is a silhouette with no edge — it was invisible at 20 m in the first
  // capture, which is the whole job a crate does. The reference blockouts grey
  // their crates for the same reason: the props have to sit a value below the
  // architecture or they stop being props.
  P('gb_crate', 'gb_grey', blockCrate(0.92), { chunk: false });
  P('gb_crate_brace', 'gb_dark', blockCrateBrace(0.92), { chunk: false });
  P('gb_barrel', 'gb_accent', blockBarrel(), { chunk: false });
  P('gb_block', 'gb_grid', blockCube(), { chunk: false });
}
