#!/usr/bin/env node
/**
 * WORLD — no map may ship an invisible wall.
 *
 *   node src/world/collision.selftest.mjs
 *
 * Collision is authored separately from the visual mesh (see `builder.js`):
 * every drawn mesh is `userData.collision = false` and the whole hull is a set
 * of cheap proxy boxes under `world_collision`, which is never rendered. That
 * is the right trade for a BVH in the low thousands of triangles — and it is
 * also a standing invitation to author a proxy with nothing drawn inside it.
 * The result is a surface the player can see straight through, walk into, and
 * lose rounds against, and NONE of that is visible in a capture: the frame
 * looks correct, because the thing that is wrong is the thing that is not
 * drawn.
 *
 * It was real. `dressing.js` sealed both ends of the market street with a
 * 16 x 2.8 x 1.2 m concrete box and never built the wall it stood in for, so
 * the longest sightline on the map — the one the AX-7 exists for — dead-ended
 * in clear air at head height. This check is what would have caught it.
 *
 * The rule, stated as the player experiences it: no LARGE patch of collision
 * may be BOTH unbacked by anything drawn AND thick enough to stop a round. The
 * second half is what lets a hedge or a tree row keep an honest solid proxy —
 * foliage defeats 6.6 m of a .338's budget, so a 1.5 m screen of it stops
 * nobody's bullet and only ever blocked your feet.
 */

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { Assembler } from './builder.js';
import { ALL_MAPS } from './maps.js';
import { STREET } from './layout.js';
import { StaticWorld } from '../physics/bvh.js';
import { LAYER, MASK, SURFACE_PROPS } from '../physics/surfaces.js';
import { WEAPON_DEFS } from '../weapons/defs.js';

let checks = 0;
let failures = 0;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
function ok(cond, name, detail = '') {
  checks++;
  if (cond) {
    console.log(`  \x1b[32mok\x1b[0m    ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

/**
 * How far from a point something must be drawn before the collision there
 * counts as unbacked. Half a metre is deliberately slack: proxy boxes are
 * meant to be coarser than the mesh, and a chamfer, a warped facade or the rim
 * of a rubble mound routinely stand a few centimetres inside their own box.
 */
const BACKED = 0.5;
/** A face must be orphaned over this much of its area to count. */
const ORPHAN_FRAC = 0.8;
/** Contiguous unbacked area that stops a round, in m^2, before this fails. */
const MAX_PANEL = 2.0;
/** How far in we look for the far side of an unbacked solid. */
const THICK_PROBE = 4.0;

/** The most penetrating round in the game — see `defs.js`. */
const AP = WEAPON_DEFS.sniper.penetration;

const stubMaterials = {
  _cache: new Map(),
  get(name, opts) {
    const key = `${name}:${JSON.stringify(opts ?? {})}`;
    let m = this._cache.get(key);
    if (!m) this._cache.set(key, (m = { name, opts, isMaterial: true, dispose() {} }));
    return m;
  },
  setGroundLevel() {},
};

/** Barycentric sample grid over a triangle, biased off the edges. */
const SAMPLES = [];
for (let i = 0; i <= 4; i++) {
  for (let j = 0; i + j <= 4; j++) SAMPLES.push([(i + 0.34) / 5.02, (j + 0.34) / 5.02]);
}

const raw = {
  t: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0,
  surface: 0, tri: -1, object: -1, frontFace: true,
};

function worlds(map) {
  const rng = new Rng(0x51ed2b73).fork();
  const A = new Assembler({ materials: stubMaterials, rng, render: null });
  A.setTransform(map.transform.yaw, map.transform.tx, map.transform.tz);
  map.build(A, rng);
  const root = new THREE.Group();
  A.finalize(root, null);
  root.updateMatrixWorld(true);

  const visual = new StaticWorld();
  for (const m of A.meshes) visual.addMesh(m, undefined, LAYER.STATIC);
  visual.build();

  const collide = new StaticWorld();
  for (const c of A.collisionRoot.children) collide.addMesh(c, undefined, LAYER.STATIC);
  collide.build();
  A.releaseCache();
  return { A, visual, collide };
}

const backed = (w, x, y, z) => w.overlapCapsule(x, y, z, x, y, z, BACKED, MASK.ALL) > 0;

/**
 * Metres of material between an entry face and the far side of the same solid.
 * This is `Ballistics._measureThickness` in miniature: step just inside and
 * look for the far face. No far face inside the probe means a solid too deep to
 * matter, which is the worst case, so report the probe length.
 *
 * A FRONT face inside the probe means a second solid packed behind this one
 * with a gap between. We count that distance too: the round has to defeat both
 * to come out the other side, so calling it thicker is the honest reading, and
 * the only direction that can be wrong here is the one that reports a wall as
 * shootable when it is not.
 */
function thickness(collide, px, py, pz, nx, ny, nz) {
  const e = 0.002;
  const dx = -nx, dy = -ny, dz = -nz;
  if (!collide.raycast(px + dx * e, py + dy * e, pz + dz * e, dx, dy, dz, THICK_PROBE, MASK.ALL, raw))
    return THICK_PROBE;
  return raw.t + e;
}

/** Unbacked, round-stopping panels, merged into contiguous groups. */
function invisibleWalls(visual, collide) {
  const pos = collide.pos;
  const nrm = collide.nrm;
  const groups = [];
  for (let t = 0; t < collide.triCount; t++) {
    const p = t * 9;
    const ax = pos[p], ay = pos[p + 1], az = pos[p + 2];
    const bx = pos[p + 3], by = pos[p + 4], bz = pos[p + 5];
    const cx = pos[p + 6], cy = pos[p + 7], cz = pos[p + 8];
    // Cheap reject first: almost every face is backed at its centroid.
    if (backed(visual, (ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3)) continue;

    let orphan = 0;
    for (const [u, v] of SAMPLES) {
      const w = 1 - u - v;
      if (!backed(visual, ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v))
        orphan++;
    }
    if (orphan / SAMPLES.length < ORPHAN_FRAC) continue;

    // Can the most penetrating round in the game get through it anyway?
    const si = collide.surfaceOf(t);
    const budget = SURFACE_PROPS[si].penDepth * AP;
    const n3 = t * 3;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    if (thickness(collide, mx, my, mz, nrm[n3], nrm[n3 + 1], nrm[n3 + 2]) <= budget) continue;

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const area = Math.hypot(
      e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x
    ) / 2;
    const f = {
      area,
      minx: Math.min(ax, bx, cx), maxx: Math.max(ax, bx, cx),
      miny: Math.min(ay, by, cy), maxy: Math.max(ay, by, cy),
      minz: Math.min(az, bz, cz), maxz: Math.max(az, bz, cz),
    };
    let g = groups.find(
      (q) =>
        f.minx <= q.maxx + 0.3 && f.maxx >= q.minx - 0.3 &&
        f.miny <= q.maxy + 0.3 && f.maxy >= q.miny - 0.3 &&
        f.minz <= q.maxz + 0.3 && f.maxz >= q.minz - 0.3
    );
    if (!g) groups.push((g = f));
    else {
      g.area += f.area;
      g.minx = Math.min(g.minx, f.minx); g.maxx = Math.max(g.maxx, f.maxx);
      g.miny = Math.min(g.miny, f.miny); g.maxy = Math.max(g.maxy, f.maxy);
      g.minz = Math.min(g.minz, f.minz); g.maxz = Math.max(g.maxz, f.maxz);
    }
  }
  return groups.sort((a, b) => b.area - a.area);
}

console.log(B('\ninvisible walls — collision with nothing drawn in it'));
let marketWorlds = null;
for (const map of ALL_MAPS) {
  const built = worlds(map);
  const { visual, collide } = built;
  if (map.id === 'market') marketWorlds = built;
  const walls = invisibleWalls(visual, collide);
  const worst = walls[0];
  ok(
    !worst || worst.area < MAX_PANEL,
    `${map.id}: no unbacked panel a .338 cannot pass`,
    worst
      ? `worst ${worst.area.toFixed(1)} m2 at ` +
        `x[${worst.minx.toFixed(1)}..${worst.maxx.toFixed(1)}] ` +
        `y[${worst.miny.toFixed(1)}..${worst.maxy.toFixed(1)}] ` +
        `z[${worst.minz.toFixed(1)}..${worst.maxz.toFixed(1)}]`
      : `${collide.triCount} proxy tris, all backed`
  );
}

/**
 * The check has to be able to fail, and this is the failure it exists for:
 * re-run the market with the barricade's geometry withheld and confirm the
 * collision box alone is caught. Without this, a bug in `backed()` or in the
 * thickness term would turn every line above into a green light that means
 * nothing.
 */
console.log(B('\nthe check can fail'));
{
  const { A, visual, collide } = marketWorlds;

  // Everything drawn EXCEPT the two street-mouth walls: drop whatever is inside
  // the barricade proxies, which is exactly what the bug looked like.
  const gone = [];
  const _p = new THREE.Vector3();
  for (const bz of [STREET.zMax + 1.5 + 1.4, STREET.zMin - 1.5 - 1.4]) {
    _p.set(0, 1.4, bz).applyMatrix4(A.xform);
    gone.push([_p.x, _p.y, _p.z]);
  }
  const keep = new Float32Array(visual.pos.length);
  let n = 0;
  for (let t = 0; t < visual.triCount; t++) {
    const p = t * 9;
    const cx = (visual.pos[p] + visual.pos[p + 3] + visual.pos[p + 6]) / 3;
    const cy = (visual.pos[p + 1] + visual.pos[p + 4] + visual.pos[p + 7]) / 3;
    const cz = (visual.pos[p + 2] + visual.pos[p + 5] + visual.pos[p + 8]) / 3;
    if (gone.some((g) => Math.abs(cx - g[0]) < 9 && Math.abs(cz - g[2]) < 1.6 && cy > 0.15 && cy < 3.0))
      continue;
    keep.set(visual.pos.subarray(p, p + 9), n * 9);
    n++;
  }
  const stripped = new StaticWorld();
  stripped.addTriangles(keep.subarray(0, n * 9), n, 'concrete', LAYER.STATIC, 'stripped');
  stripped.build();

  const walls = invisibleWalls(stripped, collide);
  const worst = walls[0]?.area ?? 0;
  ok(
    worst >= MAX_PANEL,
    'undrawing the market barricades trips the check',
    `worst panel ${worst.toFixed(1)} m2, threshold ${MAX_PANEL}`
  );
  ok(
    n < visual.triCount,
    'the stripped build really did lose geometry',
    `${visual.triCount - n} tris withheld`
  );
}

console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
