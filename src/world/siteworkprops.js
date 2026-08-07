import { PB } from './props.js';

/**
 * WORLD — Site Work's own instanced prop library.
 *
 * `props.js` is the market's vocabulary and every prototype in it is dressed
 * for a lived-in street: weathered wood, rusted steel, litter, sandbags. Site
 * Work is a blockout, so it needs a handful of those objects with all of that
 * taken away — and it needs them as SEPARATE prototypes rather than as a remap
 * of the shared ones, because `crate_a` and `barrel_rust` are placed by five
 * other maps that did not ask to be restyled. (`Assembler.proto` returns early
 * on a duplicate id, so a remap is not available even if it were wanted.)
 *
 * EIGHT PROTOTYPES COVER THE WHOLE MAP, and that is not a shortcut, it is the
 * look. The reference this map is styled after is built from a crate, a brick
 * pallet, an empty pallet, a barrel and a barrier, repeated — no scrap piles,
 * no pipe runs, no generators, no rebar. The first pass at this map dressed it
 * with twenty-six of the shared industrial props and it read as a detailed
 * site; a blockout has no debris, and the moment it does it stops reading as
 * one.
 *
 * Each comes out of `PB` as ONE merged geometry, so it is one instanced draw
 * call per chunk however many boxes went into it, and every part is a chamfered
 * box or a cylinder. Nothing here needs a normal map to do its job — the
 * corrugation on a cabin is real geometry, because at this triangle budget it
 * is cheaper than a texture set and it survives at any distance.
 *
 * MASKS ARE LEFT AT THEIR DEFAULTS AND THEN IGNORED. `PB` writes the usual
 * wear/grime/AO vertex colours, but every `sw_*` palette key sets
 * `vertexMasks: false`, so the shader compiles that block out entirely. The
 * attribute is paid for and unread — much cheaper than forking `PB`.
 */

/**
 * The site cabin, which is also the gate block. Container-shaped on purpose:
 * `sitework.js` parks one across each vehicle gate, and the 5.6 m opening is
 * sized against this length. Changing `l` here changes whether the map leaks.
 */
export const CABIN = { l: 6.0, h: 2.6, w: 2.4 };

/**
 * The crate: a cube with a raised border frame on all four upright faces.
 *
 * The frame is the entire point. A plain tan cube at 15 m is a smudge with no
 * scale and no orientation; a border catches the sun on its outer edge and
 * shadows its inner one, which gives the eye something to measure the map with.
 * That is exactly the job a crate does in a blockout, and it is why the
 * reference's crates are panelled rather than plain.
 */
function flatCrate(s = 0.9) {
  const p = new PB();
  p.box(s, s, s, 0, 0, 0, { bevel: 0.014 });
  const t = 0.07;             // frame thickness
  const d = s * 0.5 + 0.01;   // just proud of the face, never inside it
  const inset = s * 0.5 - t;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) p.box(t * 0.5, t, s - t * 2, sx * d, sy * inset, 0, { bevel: 0.004 });
    for (const sz of [-1, 1]) p.box(t * 0.5, s, t, sx * d, 0, sz * inset, { bevel: 0.004 });
  }
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) p.box(s - t * 2, t, t * 0.5, 0, sy * inset, sz * d, { bevel: 0.004 });
    for (const sx of [-1, 1]) p.box(t, s, t * 0.5, sx * inset, 0, sz * d, { bevel: 0.004 });
  }
  return p.build();
}

/**
 * The brick pallet — the reference's signature object and the map's only
 * repeated red.
 *
 * Built as discrete COURSES with a gap between them rather than as one block,
 * because the shadow line between courses is the whole read: a solid red box
 * is a red box, and eight of them stacked is a red wall. Each course is also
 * offset a few millimetres so the stack has a hand-laid edge.
 */
function flatBrickPallet(courses = 6, w = 1.15, d = 0.85) {
  const p = new PB();
  const ch = 0.11;   // course height
  const gap = 0.025; // the shadow line
  for (let i = 0; i < courses; i++) {
    // Alternate the bond so the stack reads as bricks rather than as slabs.
    const long = i % 2 === 0;
    const off = (i % 3 - 1) * 0.012;
    p.box(long ? w : w * 0.97, ch, long ? d * 0.97 : d, off, ch / 2 + i * (ch + gap), -off, { bevel: 0.006 });
  }
  return p.build();
}

/** An empty pallet: three bearers and five deck boards, and nothing else. */
function flatPallet(w = 1.2, d = 0.8) {
  const p = new PB();
  const bh = 0.09;
  for (const sx of [-1, 0, 1]) p.box(0.1, bh, d, sx * (w / 2 - 0.05), bh / 2, 0, { bevel: 0.005 });
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 0.06 + (i / 4) * (w - 0.12);
    p.box(0.14, 0.028, d, x, bh + 0.014, 0, { bevel: 0.004 });
  }
  return p.build();
}

/** A banded plank bundle, for the loose timber the yards are stacked with. */
function flatTimber(len = 2.4, w = 0.7) {
  const p = new PB();
  const ch = 0.13;
  for (let i = 0; i < 4; i++) p.box(len, ch, w, 0, ch / 2 + i * (ch + 0.015), 0, { bevel: 0.006 });
  // Two straps. On a flat tan stack these are the only thing casting a shadow
  // onto the timber itself.
  for (const u of [-0.3, 0.3]) p.box(0.05, ch * 4.3, w + 0.03, len * u, ch * 2.15, 0, { bevel: 0.004 });
  return p.build();
}

/**
 * The barrel: the map's one curved silhouette, so it is worth its triangles.
 *
 * 14 radial segments rather than the 12 the shared barrel uses — it is the only
 * curve on a map made entirely of boxes, and the two extra facets are what keep
 * it from reading as a heptagon against a flat wall.
 */
function flatBarrel(r = 0.29, h = 0.88) {
  const p = new PB();
  p.cyl(r, h, 0, h / 2, 0, { radial: 14 });
  for (const y of [h * 0.2, h * 0.5, h * 0.8]) p.cyl(r * 1.05, 0.055, 0, y, 0, { radial: 14 });
  for (const sy of [0.025, h - 0.025]) p.cyl(r * 0.97, 0.05, 0, sy, 0, { radial: 14 });
  return p.build();
}

/** A low cover cube: the blockout's unit of "something to crouch behind". */
function flatBlock(w = 1.3, h = 0.85, d = 0.95) {
  const p = new PB();
  p.box(w, h, d, 0, h / 2, 0, { bevel: 0.022 });
  return p.build();
}

/**
 * The site cabin. A box with corner posts and vertical ribs down the long
 * faces — the corrugation is GEOMETRY here, not a normal map, because the
 * `sw_*` keys compile relief out entirely and a ribbed silhouette is what makes
 * a cabin read as a cabin rather than as a coloured brick.
 */
function flatCabin() {
  const { l, h, w } = CABIN;
  const p = new PB();
  p.box(l, h, w, 0, h / 2, 0, { bevel: 0.02 });
  // Corner posts, standing proud on all four verticals.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.box(0.14, h + 0.06, 0.14, sx * (l / 2 - 0.05), h / 2, sz * (w / 2 - 0.05), { bevel: 0.006 });
  // Ribs at roughly the 25 cm pitch profiled sheet comes in.
  const n = Math.round(l / 0.5);
  for (let i = 1; i < n; i++) {
    const x = -l / 2 + (i / n) * l;
    for (const sz of [-1, 1]) p.box(0.07, h - 0.16, 0.05, x, h / 2, sz * (w / 2 + 0.02), { bevel: 0.004 });
  }
  // A roof lip, so the top edge is a line and not a cut.
  p.box(l + 0.1, 0.09, w + 0.1, 0, h + 0.04, 0, { bevel: 0.008 });
  return p.build();
}

/**
 * Register Site Work's prototypes. Called after `registerProps`, and the ids
 * are prefixed `sw_` so they can never collide with the shared vocabulary.
 *
 * CHUNKING IS LEFT ON, unlike Nuketown's family. That map turns it off because
 * 51 x 42 m fits inside the Assembler's 64 m chunking threshold, so splitting
 * its clouds would buy no culling and cost a draw call per chunk. Site Work is
 * 56 x 84 m — past the threshold on Z — so its clouds genuinely do split, and
 * the culling is worth the calls.
 *
 * No `skirt` on any of them. A dust fillet is a contact detail for a weathered
 * ground, and this floor is one flat value; a mound of it against a crate would
 * be the only soft edge in the frame.
 */
export function registerSiteworkProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });

  P('sw_crate', 'sw_tan', flatCrate(0.9));
  P('sw_brick', 'sw_red', flatBrickPallet());
  P('sw_pallet', 'sw_tan', flatPallet());
  P('sw_timber', 'sw_tan', flatTimber());
  P('sw_barrel', 'sw_red', flatBarrel());
  P('sw_barrel_b', 'sw_blue', flatBarrel());
  P('sw_block', 'sw_grey', flatBlock());
  P('sw_cabin', 'sw_orange', flatCabin());
  P('sw_cabin_b', 'sw_blue', flatCabin());
  return A;
}
