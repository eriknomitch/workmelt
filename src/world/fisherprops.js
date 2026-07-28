import * as THREE from 'three';
import { PB } from './props.js';
import { mergeSimple } from './kit.js';
import { fillMasks, warpGeometry } from './util.js';

/**
 * WORLD — The Fisher's own instanced prop library.
 *
 * The estate vocabulary itself — clipped hedges, broadleaf trees, topiary,
 * urns, benches, loungers — already exists in `wilmotprops.js` and this map
 * draws on it directly rather than growing a second copy of every garden
 * object. What a North Shore place has and Wilmot does not is the EVERGREEN:
 * rows of spruce screening the pool axis, the court and the boundary, which is
 * the single most recognisable thing in an aerial photograph of it.
 *
 * PERFORMANCE IS THE BRIEF ON THIS MAP, so the conifer is deliberately NOT
 * built the way `wilmotprops.js` builds a green volume. A hedge or an oak crown
 * there is a PAIR — an opaque core plus an alpha-cut leaf shell — because a
 * ragged broadleaf edge needs the cutout. A spruce does not: its silhouette is
 * a cone, its interior is genuinely opaque, and the map places ~150 of them.
 * Two prototypes and an alpha-tested shell over every one of those would cost a
 * second draw call per chunk and a screenful of overdraw to buy an edge nobody
 * reads past 10 m. So a conifer here is ONE opaque prototype of ~80 triangles:
 * four open cone tiers, no caps, no cutout, warped so no two read alike.
 */

/** Conifer envelope, in metres. `fishers.js` scales rows off these. */
export const CONIFER = { h: 5.6, r: 1.55 };

/**
 * A spruce: a stub of bare trunk under four overlapping cone tiers. The tiers
 * are open-ended cylinders with a near-zero top radius — a cone with no caps,
 * which is 14 triangles a tier and reads correctly from every angle a player
 * ever sees one from, because the tier above always covers the hole.
 */
function conifer(rng) {
  const p = new PB();
  p.cyl(0.18, 1.2, 0, 0.6, 0, { radial: 6, taper: 0.7, grime: 0.6, ao: 0.55 });
  for (const [r, y, h] of [
    [1.55, 0.5, 1.95],
    [1.24, 1.95, 1.8],
    [0.93, 3.2, 1.6],
    [0.58, 4.3, 1.3],
  ]) {
    p.cyl(r, h, 0, y + h / 2, 0, { radial: 7, taper: 0.12, open: true, grime: 0.25, ao: 0.4 });
  }
  const g = p.build();
  warpGeometry(g, 0.07, 0.7, rng.float() * 24);
  return g;
}

/** A poolside parasol: thin mast under a shallow eight-panel cone. */
function parasol(rng) {
  const p = new PB();
  p.cyl(0.05, 2.3, 0, 1.15, 0, { radial: 6, grime: 0.35 });
  p.cyl(1.42, 0.44, 0, 2.34, 0, { radial: 8, taper: 0.07, open: true, wear: 1, grime: 0.2 });
  p.cyl(0.06, 0.12, 0, 2.62, 0, { radial: 6, taper: 0.4, wear: 1 });
  const g = p.build();
  warpGeometry(g, 0.02, 1.8, rng.float() * 14);
  return g;
}

/**
 * A row of crop foliage for the kitchen garden's raised beds: a handful of
 * alpha-cut planes lying along +X, low enough to shoot over and dense enough
 * that a bed reads as planted rather than as a bare box of soil.
 */
function cropRow(rng) {
  const list = [];
  for (let i = 0; i < 7; i++) {
    const q = new THREE.PlaneGeometry(rng.range(0.5, 0.82), rng.range(0.26, 0.42), 1, 1);
    q.applyMatrix4(
      new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.float() * Math.PI, 0, 'YXZ'))
        .setPosition(-0.9 + (i / 6) * 1.8, rng.range(0.12, 0.24), rng.range(-0.16, 0.16))
    );
    fillMasks(q, 0.18, 0.28, 0.2);
    list.push(q);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/**
 * Register every Fisher's prototype. Called after `registerProps` and
 * `registerWilmotProps` — the estate also draws on the shared furniture and on
 * the garden library, and `put()`'s dust skirt lives in the shared one.
 */
export function registerFisherProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });

  P('conifer', 'conifer', conifer(rng), { chunk: true });
  P('parasol', 'fabric_cream', parasol(rng), { skirt: 0.4, tilt: 0.03, sink: 0.008 });
  P('crop_row', 'foliage', cropRow(rng), { maxDist: 48, castShadow: false, receiveShadow: true });
  return A;
}
