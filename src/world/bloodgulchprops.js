import { PB } from './props.js';

/**
 * WORLD — Blood Gulch's instanced rock library.
 *
 * Two prototypes for the whole map, and that is the brief rather than a
 * shortcut: this map is a box canyon whose only loose objects are rocks, and it
 * is authored for frame cost first (see the header of `bloodgulch.js`). Every
 * prototype is one merged geometry and therefore one draw call per 64 m chunk,
 * so the difference between two rock shapes and eight is eight instanced meshes
 * where two would do.
 *
 * Both are FACETED BOXES, not `rockGeometry` lumps. `props.js`'s `rock_a`/
 * `rock_b` are displaced icosahedra at ~180 triangles each; three chamfered
 * boxes at a few degrees to one another read as the same broken stone from
 * every distance a player fights at, for a third of that, and they flat-shade
 * cleanly under the `bg_*` keys — which have no normal map to carry surface
 * detail, by design.
 *
 * Both are authored with their BASE AT y = 0, so a placement drops them
 * straight onto the ground height rather than needing a per-prop sink.
 */

/**
 * The boulder: knee-to-chest cover, and the only loose object on the map that
 * is solid. Placed from the authored `BOULDERS` table, which is also what the
 * occupancy tests read, so every one of these is real cover rather than a prop
 * a player walks through.
 *
 * Nominal footprint is ~2.0 x 1.7 m at scale 1 and the table's radius scales
 * it, which is why the parts below are built around a 1 m half-width.
 */
function boulder() {
  const p = new PB();
  p.box(1.90, 1.10, 1.60, 0, 0.50, 0, { ry: 0.30, rx: 0.08, bevel: 0.06 });
  p.box(1.40, 0.90, 1.25, 0.15, 1.05, -0.10, { ry: -0.50, rz: 0.12, bevel: 0.05 });
  p.box(0.90, 0.60, 0.80, -0.35, 1.35, 0.20, { ry: 0.90, rx: -0.15, bevel: 0.04 });
  return p.build();
}

/**
 * The scatter stone: ankle height, no collision, pure surface interest.
 *
 * Deliberately below the controller's ~0.5 m mantle so that "you can walk over
 * it" and "it does not block you" agree — a 0.9 m prop with no proxy is the one
 * shape that reads as cover and is not, and there is no worse lie to tell a
 * player looking for somewhere to stand.
 */
function stone() {
  const p = new PB();
  p.box(0.80, 0.40, 0.70, 0, 0.18, 0, { ry: 0.40, rz: 0.06, bevel: 0.03 });
  p.box(0.50, 0.28, 0.45, 0.12, 0.42, -0.06, { ry: -0.70, bevel: 0.025 });
  return p.build();
}

/**
 * Register the canyon's prototypes. Ids are prefixed `bg_` so they can never
 * collide with the shared vocabulary in `props.js` — which this map does not
 * register at all (see `buildBloodGulch`).
 */
export function registerBloodGulchProps(A, rng) {
  // Chunked: the canyon is 104 m long, so both clouds cross the Assembler's
  // 64 m bucket line and split into a handful of frustum-cullable meshes.
  A.proto('bg_boulder', { geo: boulder(), key: 'bg_rock' });
  // Distance LOD for free: a 0.55 m stone contributes nothing past ~70 m, and
  // dropping the whole cloud there is one visibility flag per chunk per frame.
  A.proto('bg_stone', { geo: stone(), key: 'bg_rock_dark', maxDist: 70, castShadow: false });
}
