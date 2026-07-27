#!/usr/bin/env node
/**
 * WORLD — headless checks for the map list.
 *
 *   node src/world/maps.selftest.mjs
 *
 * Every map is BUILT FOR REAL here: the actual Assembler, the actual geometry
 * code, a stub `materials` library standing in for the GPU-side one. That is
 * the point — a map is several thousand lines of geometry that only ever ran
 * inside a browser, and "does it throw, and how big is it" is a question worth
 * answering in 400 ms instead of in a 6-minute capture run.
 *
 * On top of that it checks the properties the rest of the engine relies on:
 * that the authored spawn table lands on ground the map itself calls standable,
 * that spawns are spread across zones rather than piled in one corner, that the
 * playable bounds actually contain the map, and that the boot-map resolver
 * prefers `?map=` over a stored preference and ignores both under `deterministic`.
 *
 * Collision-validated spawn counts and real walkability need a browser — see
 * `src/world/spawns.probe.mjs`.
 */

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { Assembler } from './builder.js';
import { MAPS, DEFAULT_MAP_ID, getMap, isMapId, mapSummaries, resolveBootMap } from './maps.js';
import { CONTAINER } from './rustprops.js';
import { CONTAINERS, STRUCTURES, RUST, DERRICK } from './rust.js';

let pass = 0;
let fail = 0;
const B = (s) => `\x1b[1m${s}\x1b[0m`;

function ok(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mok\x1b[0m    ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

/**
 * A materials library that hands back inert objects. The Assembler only ever
 * stores what it gets and hangs it off a Mesh, so nothing downstream of here
 * needs a real shader — and building without one is what makes this runnable
 * in node at all.
 */
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

function buildMap(map) {
  const rng = new Rng(0x51ed2b73).fork();
  const A = new Assembler({ materials: stubMaterials, rng, render: null });
  A.setTransform(map.transform.yaw, map.transform.tx, map.transform.tz);
  const built = map.build(A, rng) ?? {};
  const root = new THREE.Group();
  A.finalize(root, null);
  A.releaseCache();
  return { A, root, built };
}

/* ────────────────────────────────────────────────────────────── the list ── */
console.log(B('\nthe map list'));
ok(MAPS.length >= 2, 'at least two maps ship', MAPS.map((m) => m.id).join(', '));
ok(new Set(MAPS.map((m) => m.id)).size === MAPS.length, 'ids are unique');
ok(isMapId(DEFAULT_MAP_ID) && getMap(DEFAULT_MAP_ID) != null, 'the default map exists', DEFAULT_MAP_ID);
ok(getMap('nope') === null && !isMapId('nope'), 'an unknown id resolves to null');
ok(
  mapSummaries().every((s) => s.id && s.name && s.subtitle && s.blurb && s.size),
  'every summary the menu renders is complete'
);
for (const m of MAPS) {
  const shape =
    typeof m.build === 'function' &&
    typeof m.standable === 'function' &&
    typeof m.groundY === 'function' &&
    typeof m.isOpen === 'function' &&
    Array.isArray(m.spawnPoints) &&
    Array.isArray(m.bounds) &&
    m.bounds.length === 6 &&
    m.transform &&
    Number.isFinite(m.transform.yaw);
  ok(shape, `"${m.id}" satisfies the descriptor contract`);
}

/* ─────────────────────────────────────────────────────── the boot resolver ── */
console.log(B('\nwhich map boots'));
ok(resolveBootMap({}) === DEFAULT_MAP_ID, 'nothing asked for -> the default');
ok(resolveBootMap({ search: '?map=rust' }) === 'rust', '?map= wins');
ok(resolveBootMap({ search: '?map=atlantis' }) === DEFAULT_MAP_ID, 'an unknown ?map= falls back');
ok(resolveBootMap({ preferred: 'rust' }) === 'rust', 'an explicit override is honoured');
ok(
  resolveBootMap({ search: '?map=market', preferred: 'rust' }) === 'market',
  '?map= beats the override'
);
ok(
  resolveBootMap({ deterministic: true }) === DEFAULT_MAP_ID,
  'a capture run always boots the default'
);
ok(
  resolveBootMap({ search: '?map=rust', deterministic: true }) === 'rust',
  '…unless the capture asked for another map by name'
);

/* ───────────────────────────────────────────────────────── build every map ── */
for (const map of MAPS) {
  console.log(B(`\n${map.id} — build`));
  let out = null;
  let err = null;
  const t0 = performance.now();
  try {
    out = buildMap(map);
  } catch (e) {
    err = e;
  }
  const ms = performance.now() - t0;
  ok(!err, 'builds without throwing', err ? `${err.message}` : `${ms.toFixed(0)}ms`);
  if (!out) continue;

  const { A, built } = out;
  const s = A.stats;
  ok(s.staticTris > 5000, 'has real static geometry', `${(s.staticTris / 1000).toFixed(0)}k tris`);
  ok(s.instances > 100, 'has an instanced prop cloud', `${s.instances} instances`);
  ok(s.collideTris > 500, 'authored collision proxies', `${(s.collideTris / 1000).toFixed(1)}k tris`);
  // The whole point of the Assembler is that a map of hundreds of thousands of
  // triangles comes out as ~100-250 draw calls. A regression here is silent in
  // a screenshot and expensive in a frame.
  ok(s.drawCalls > 0 && s.drawCalls < 320, 'stays inside the draw-call budget', `${s.drawCalls} calls`);
  ok(Array.isArray(built.buildings) && built.buildings.length > 0, 'reports its footprints to the minimap');
  ok(
    built.buildings.every((b) => {
      const spec = b?.spec ?? b;
      return spec && Number.isFinite(spec.x) && Number.isFinite(spec.z) && spec.w > 0 && spec.d > 0;
    }),
    'every footprint has the x/z/w/d the minimap draws'
  );

  console.log(B(`\n${map.id} — spawns`));
  const table = map.spawnPoints;
  ok(table.length >= 8, 'enough authored points to make a match', `${table.length}`);
  const off = table.filter(([x, z], i) => i > 0 && !map.standable(x, z));
  ok(off.length === 0, 'every point stands on ground the map calls open',
    off.length ? off.map(([x, z, , zone]) => `${zone}(${x},${z})`).join(' ') : `${table.length - 1} checked`);
  const closed = table.filter(([x, z], i) => i > 0 && !map.isOpen(x, z));
  ok(closed.length === 0, 'and on ground the minimap draws as floor', `${closed.length} exceptions`);

  const [x0, , z0, x1, , z1] = map.bounds;
  const outside = table.filter(([x, z]) => x < x0 || x > x1 || z < z0 || z > z1);
  ok(outside.length === 0, 'every point is inside the playable bounds');
  ok(table.every(([x, z]) => Number.isFinite(map.groundY(x, z))), 'groundY is finite at every point');

  const zones = new Map();
  for (const [x, z, , zone] of table) {
    let e = zones.get(zone);
    if (!e) zones.set(zone, (e = { n: 0, x: 0, z: 0 }));
    e.n++;
    e.x += x;
    e.z += z;
  }
  ok(zones.size >= 4, 'points are grouped into zones', `${zones.size} zones`);
  // A zone is the unit crowding is counted in, so a zone of one is a zone that
  // cannot absorb a second player — see src/world/spawns.js.
  const thin = [...zones].filter(([, e]) => e.n < 2).map(([k]) => k);
  ok(thin.length === 0, 'no zone is a single point', thin.join(' ') || `min ${Math.min(...[...zones.values()].map((e) => e.n))}`);
  let minSep = Infinity;
  const cents = [...zones.values()].map((e) => [e.x / e.n, e.z / e.n]);
  for (let i = 0; i < cents.length; i++)
    for (let j = i + 1; j < cents.length; j++)
      minSep = Math.min(minSep, Math.hypot(cents[i][0] - cents[j][0], cents[i][1] - cents[j][1]));
  ok(minSep > 5, 'zones are actually separate places', `closest pair ${minSep.toFixed(1)} m`);

  // groundY has to answer everywhere, not just where a spawn happens to be:
  // every prop the dressing pass drops is placed on it.
  let bad = 0;
  for (let x = x0; x <= x1; x += 4)
    for (let z = z0; z <= z1; z += 4) if (!Number.isFinite(map.groundY(x, z))) bad++;
  ok(bad === 0, 'groundY is finite across the whole map', `${bad} holes`);
}

/* ──────────────────────────────────────────────────────── rust: the layout ── */
console.log(B('\nrust — the yard'));

const rects = [];
for (const s of STRUCTURES) rects.push([s.id, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
for (const [x, z, ry, tier] of CONTAINERS) {
  if (tier !== 0) continue;
  const hx = (ry === 0 ? CONTAINER.l : CONTAINER.w) / 2;
  const hz = (ry === 0 ? CONTAINER.w : CONTAINER.l) / 2;
  rects.push([`container(${x},${z})`, x - hx, z - hz, x + hx, z + hz]);
}
const overlaps = [];
for (let i = 0; i < rects.length; i++) {
  for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i];
    const b = rects[j];
    if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) overlaps.push(`${a[0]} ∩ ${b[0]}`);
  }
}
ok(overlaps.length === 0, 'nothing solid is inside anything else solid', overlaps.slice(0, 3).join(', '));

const outOfYard = rects.filter((r) => Math.min(r[1], r[2]) < -RUST.half || Math.max(r[3], r[4]) > RUST.half);
ok(outOfYard.length === 0, 'everything solid is inside the fence', outOfYard.map((r) => r[0]).join(' '));

const stacked = CONTAINERS.filter(([, , , t]) => t > 0);
ok(stacked.length >= 3, 'containers are stacked, not just scattered', `${stacked.length} on a second tier`);
ok(
  stacked.every(([x, z, ry]) =>
    CONTAINERS.some(([bx, bz, bry, bt]) => bt === 0 && bx === x && bz === z && bry === ry)
  ),
  'every stacked container has one underneath it'
);

// The derrick is the map's landmark: the whole yard has to be able to see it,
// and it has to be tall enough to be worth climbing.
ok(DERRICK.height > 10, 'the derrick is a landmark', `${DERRICK.height} m`);
ok(DERRICK.deck > 3.5 && DERRICK.nest > DERRICK.deck + 3, 'it has two levels worth climbing to',
  `${DERRICK.deck} m and ${DERRICK.nest} m`);
ok(DERRICK.top < DERRICK.base, 'the legs rake inward', `${DERRICK.base} m -> ${DERRICK.top} m`);
// The nest is cantilevered PAST the stair's top step; if that ever stops being
// true the last flight comes up through a solid platform.
ok(
  Math.abs(DERRICK.nestZ) - DERRICK.nestHalf > DERRICK.deckHalf - 4.9,
  'the crow’s nest clears the flight that reaches it'
);

const rust = getMap('rust');
// The only route to the deck. If a container ever lands on its run-up the map
// loses its vertical half and nothing else in the build would say so.
const footOpen =
  rust.isOpen(DERRICK.x + DERRICK.stairX, DERRICK.z + DERRICK.stairFootZ) &&
  rust.isOpen(DERRICK.x + DERRICK.stairX, DERRICK.z + DERRICK.stairFootZ + 2.0);
ok(footOpen, 'the derrick stair has open ground to start from');
ok(!rust.isOpen(0, RUST.half + 3), 'outside the fence is not playable ground');
ok(rust.isOpen(0, RUST.half - 3), 'inside the fence is');

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
