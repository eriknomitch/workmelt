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
import { PALETTE } from './palette.js';
import { LIBRARY } from '../materials/library.js';
import {
  MAPS,
  ALL_MAPS,
  DEFAULT_MAP_ID,
  getMap,
  isMapId,
  mapRegistry,
  mapSummaries,
  resolveBootMap,
} from './maps.js';
import { CONTAINER } from './rustprops.js';
import { CONTAINERS, STRUCTURES, RUST, DERRICK, inSolid } from './rust.js';
import { HEDGE } from './wilmotprops.js';
import {
  WILMOT,
  STRUCTURES as WILMOT_STRUCTURES,
  TERRACE,
  POOL,
  BOWL,
  HEDGES,
  TREES,
  GATES,
  inSolidWilmot,
  groundYWilmot,
} from './wilmot.js';
import { CONIFER } from './fisherprops.js';
import {
  FISHER,
  STRUCTURES as FISHER_STRUCTURES,
  TREES as FISHER_TREES,
  GATES as FISHER_GATES,
  GARDEN,
  GARDEN_WALLS,
  BEDS,
  CONIFER_ROWS,
  POOL as POOL_F,
  SPA,
  inSolidFishers,
  groundYFishers,
} from './fishers.js';
import {
  NUKE,
  HOUSES as NUKE_HOUSES,
  SHEDS as NUKE_SHEDS,
  SIGN as NUKE_SIGN,
  YARD_WALLS as NUKE_YARD_WALLS,
  STREET_BLOCKS as NUKE_STREET_BLOCKS,
  MOUTH_BLOCKS as NUKE_MOUTH_BLOCKS,
  inSolid as inSolidNuketown,
  groundYNuketown,
} from './nuketown.js';
import {
  GULCH,
  BASE,
  BASES,
  SOLIDS as GULCH_SOLIDS,
  TOOTH,
  RIDGES,
  BOULDERS,
  baseSolids,
  inSolid as inSolidBloodGulch,
  groundYBloodGulch,
} from './bloodgulch.js';
import {
  DOME,
  RADOME,
  RADOME_STAIR_FOOT_Z,
  BUNKER,
  STRUCTURES as DOME_STRUCTURES,
  CONTAINERS as DOME_CONTAINERS,
  MOUTHS as DOME_MOUTHS,
  RUIN_WALLS,
  WRECKS,
  inSolidDome,
  groundYDome,
} from './dome.js';
import {
  SHIVAM,
  DECK as ICE_DECK,
  POOL as ICE_POOL,
  STRUCTURES as SHIVAM_STRUCTURES,
  TOWER as SHIVAM_TOWER,
  WALL_GAPS,
  WALL_GAP_W,
  WALL_Z0,
  REEF,
  WEST_ROCKS,
  PAVILION_STAIR,
  KIOSK_STAIR,
  CLUB_STAIR,
  DECK_STAIR_Z,
  inSolidShivam,
  groundYShivam,
} from './shivam.js';
import {
  LOOP,
  EL,
  STATION,
  TRAIN,
  SCAFFOLD,
  STRUCTURES as LOOP_STRUCTURES,
  ALLEYS,
  MOUTHS,
  COLUMNS,
  inSolidLoop,
} from './loop.js';

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

/**
 * Look a map up REGARDLESS of its enable flag — `getMap` deliberately hides a
 * disabled one, and the per-map geometry checks below must keep running on a
 * parked map. That is the whole point of parking rather than deleting it.
 */
const mapById = (id) => ALL_MAPS.find((m) => m.id === id) ?? null;

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
ok(new Set(ALL_MAPS.map((m) => m.id)).size === ALL_MAPS.length, 'ids are unique');
ok(isMapId(DEFAULT_MAP_ID) && getMap(DEFAULT_MAP_ID) != null, 'the default map exists', DEFAULT_MAP_ID);
ok(getMap('nope') === null && !isMapId('nope'), 'an unknown id resolves to null');
ok(
  mapSummaries().every((s) => s.id && s.name && s.description && s.blurb && s.size),
  'every summary the menu renders is complete'
);

/**
 * THE REGISTRY — the failures that come from editing that one table.
 *
 * None of these is visible in a frame. Disabling the boot map or leaving a
 * stale id in `localStorage` both end as "the game does not start", and a menu
 * string that drifted back onto a descriptor is a string nobody renders.
 */
ok(MAPS.every((m) => ALL_MAPS.includes(m)), 'the enabled list is a subset of every map');
{
  const reg = mapRegistry();
  ok(new Set(reg.map((e) => e.order)).size === reg.length, 'menu orders are unique',
    reg.map((e) => e.order).join(', '));
  ok(reg.every((e, i) => i === 0 || reg[i - 1].order < e.order), 'the registry is exposed in menu order');
  ok(reg.every((e) => typeof e.enabled === 'boolean'), 'every entry states enabled explicitly');
  ok(
    reg.map((e) => e.id).join() === ALL_MAPS.map((m) => m.id).join(),
    'ALL_MAPS follows the registry order'
  );
  ok(
    mapSummaries().map((s) => s.id).join() ===
      reg.filter((e) => e.enabled).map((e) => e.id).join(),
    'the menu renders in registry order'
  );
}
ok(
  MAPS.some((m) => m.id === DEFAULT_MAP_ID),
  'the default map is ENABLED — disabling it bricks boot',
  DEFAULT_MAP_ID
);
{
  const disabled = ALL_MAPS.filter((m) => !MAPS.includes(m));
  ok(
    disabled.every((m) => !isMapId(m.id) && getMap(m.id) === null),
    'a disabled map is unreachable by id',
    disabled.length ? disabled.map((m) => m.id).join(', ') : 'none disabled'
  );
  ok(
    disabled.every((m) =>
      resolveBootMap({ search: `?map=${m.id}` }) === DEFAULT_MAP_ID &&
      resolveBootMap({ preferred: m.id }) === DEFAULT_MAP_ID),
    'a disabled map falls back to the default rather than failing boot'
  );
  ok(
    mapSummaries().every((s) => !disabled.some((m) => m.id === s.id)),
    'the menu never offers a disabled map'
  );
}
ok(
  ALL_MAPS.every((m) => m.name === undefined && m.subtitle === undefined),
  'no descriptor carries its own menu strings — the registry owns them',
  ALL_MAPS.filter((m) => m.name !== undefined || m.subtitle !== undefined).map((m) => m.id).join(', ')
);

for (const m of ALL_MAPS) {
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

/**
 * The optional `environment` — the sky a map is set under. It is handed
 * straight to `sky.applyEnvironment`, which merges its `weather` over the
 * sky's defaults and calls `setTimeOfDay(hour)`, so the only things that can
 * be wrong here are wrong in a way no frame would explain: an hour outside
 * 0..24 wraps silently to another time of day, and a weather key the sky does
 * not read is a setting the author believes is applied and is not.
 */
const WEATHER_KEYS = new Set([
  'turbidity', 'cloudCoverage', 'cloudDensity', 'cirrusCoverage', 'cirrusOpacity',
  'windSpeed', 'windAngle', 'horizonMurk', 'fogDensity', 'fogHeight', 'shaftGain',
]);
for (const m of ALL_MAPS.filter((m) => m.environment)) {
  const e = m.environment;
  ok(Number.isFinite(e.hour) && e.hour >= 0 && e.hour < 24, `"${m.id}" is set at a real hour`, `${e.hour}`);
  ok(
    e.exposureBias === undefined || (Number.isFinite(e.exposureBias) && Math.abs(e.exposureBias) <= 3),
    `"${m.id}" asks for a sane exposure compensation`,
    `${e.exposureBias ?? 0} EV`
  );
  const unknown = Object.keys(e.weather ?? {}).filter((k) => !WEATHER_KEYS.has(k));
  ok(unknown.length === 0, `"${m.id}" only asks for weather the sky reads`, unknown.join(' '));
  ok(
    Object.values(e.weather ?? {}).every((v) => Number.isFinite(v)),
    `"${m.id}" weather values are numbers`
  );
}
// The Loop is the night map. If this ever passes on a daylight hour the map
// still builds, still plays and looks nothing like itself — every emitter on
// it (marquee, blade sign, lit rooms, the stalled train) was placed for 23:30.
{
  const loopEnv = mapById('loop').environment;
  ok(loopEnv != null && (loopEnv.hour < 4.5 || loopEnv.hour > 21), 'the loop is a night map',
    `${loopEnv?.hour ?? 'no environment'}`);
}

/* ─────────────────────────────────────────────────────── the boot resolver ── */
console.log(B('\nwhich map boots'));
ok(resolveBootMap({}) === DEFAULT_MAP_ID, 'nothing asked for -> the default');
ok(resolveBootMap({ search: '?map=rust' }) === 'rust', '?map= wins');
ok(resolveBootMap({ search: '?map=atlantis' }) === DEFAULT_MAP_ID, 'an unknown ?map= falls back');
ok(resolveBootMap({ preferred: 'rust' }) === 'rust', 'an explicit override is honoured');
ok(
  resolveBootMap({ search: '?map=fishers', preferred: 'rust' }) === 'fishers',
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
for (const map of ALL_MAPS) {
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

  const { A, root, built } = out;
  const s = A.stats;
  ok(s.staticTris > 5000, 'has real static geometry', `${(s.staticTris / 1000).toFixed(0)}k tris`);

  /**
   * EVERY VERTEX LANDS SOMEWHERE REAL.
   *
   * Nothing else in this file looks at a coordinate. The stats above count
   * triangles and draw calls, and the layout sections below interrogate the
   * TABLES — so a build that emits the right number of triangles at the wrong
   * place passes the entire suite.
   *
   * That is not hypothetical. `kit.js`'s `LL` returns a shared scratch matrix;
   * hold onto it as a panel matrix and every subsequent call compounds the
   * transform into itself, and a building walks off to 10^13 m. The map builds,
   * every check here goes green, and the house is simply not on screen. Only a
   * GPU capture caught it, which is a slow way to learn about a typo.
   *
   * The bound is deliberately loose — terrain planes legitimately run to ±95 m
   * around a 50 m map — because it is not measuring composition. It is asking
   * whether the numbers are numbers.
   */
  const SANE = 500;
  let vmin = Infinity;
  let vmax = -Infinity;
  let stray = null;
  root.traverse((o) => {
    if (stray || !o.isMesh || !o.geometry?.attributes?.position) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    for (const v of [b.min, b.max])
      for (const c of [v.x, v.y, v.z]) {
        if (!Number.isFinite(c) || Math.abs(c) > SANE) stray = `${o.name ?? 'mesh'} at ${c.toExponential(1)}`;
        vmin = Math.min(vmin, c);
        vmax = Math.max(vmax, c);
      }

    /**
     * AND EVERY INSTANCE MATRIX, which the check above cannot see.
     *
     * An instanced prop's geometry is one prototype at the origin and is always
     * finite; the placement lives in `instanceMatrix`. Put a NaN in there — a
     * rotation from `Rng.int(4)` when the signature is `int(min, max)`, say —
     * and nothing throws, the prop count is right, `A.stats` is right, and the
     * geometry bounding box is right. What happens is that the InstancedMesh's
     * bounding SPHERE goes NaN, the frustum test fails, and three silently
     * culls the entire cloud on every frame of every map that uses it.
     *
     * That cost this map 82 of its 122 props, invisibly, past a green suite.
     */
    if (o.isInstancedMesh) {
      const el = o.instanceMatrix.array;
      for (let i = 0; i < el.length; i++) {
        if (Number.isFinite(el[i]) && Math.abs(el[i]) <= SANE) continue;
        stray = `${o.name ?? 'instances'} instance ${(i / 16) | 0} matrix[${i % 16}] = ${el[i]}`;
        break;
      }
    }
  });
  ok(!stray, 'every vertex the build emits lands somewhere real',
    stray ?? `${vmin.toFixed(0)}..${vmax.toFixed(0)} m`);

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

const rust = mapById('rust');
// The only route to the deck. If a container ever lands on its run-up the map
// loses its vertical half and nothing else in the build would say so.
const footOpen =
  rust.isOpen(DERRICK.x + DERRICK.stairX, DERRICK.z + DERRICK.stairFootZ) &&
  rust.isOpen(DERRICK.x + DERRICK.stairX, DERRICK.z + DERRICK.stairFootZ + 2.0);
ok(footOpen, 'the derrick stair has open ground to start from');
ok(!rust.isOpen(0, RUST.half + 3), 'outside the fence is not playable ground');
// Not a single lucky point: a container parked where the probe happens to look
// would fail a spot check and prove nothing. Sample the yard and ask how much
// of it a player can actually stand on — that catches an inverted occupancy
// test or a blocker that swallowed the map, and survives moving a container.
let open = 0;
let total = 0;
for (let x = -RUST.half; x <= RUST.half; x += 1)
  for (let z = -RUST.half; z <= RUST.half; z += 1) {
    total++;
    if (rust.isOpen(x, z)) open++;
  }
const frac = open / total;
ok(frac > 0.45 && frac < 0.9, 'most of the yard inside the fence is walkable',
  `${(frac * 100).toFixed(0)}% open`);

/**
 * THE GATES ARE SEALED.
 *
 * The perimeter has a 4.6 m opening at each end of the yard, and a container
 * parked across it is the only thing stopping a player walking out into empty
 * desert. That is one placement — nudge it and the map leaks, with nothing else
 * in the build or in any frame to say so. A raycast in a browser found this
 * once; this is the same question asked of the layout tables, in 2 ms.
 *
 * For every line across the opening, walk in from the fence and require
 * something solid within the GATE MOUTH — the first 3 m. The depth matters:
 * at 8 m the probe reaches past the mouth and finds the north/south edge
 * container rows, so it passed with the gate blocks deleted. An assertion that
 * cannot fail is worse than no assertion, because it reads as coverage.
 */
const GATE_HALF = 2.3;
for (const [name, sign] of [['north', -1], ['south', 1]]) {
  const leaks = [];
  for (let x = -GATE_HALF + 0.2; x <= GATE_HALF - 0.2; x += 0.2) {
    let solid = false;
    for (let d = 0; d <= 3 && !solid; d += 0.2) if (inSolid(x, sign * (RUST.half - d), 0)) solid = true;
    if (!solid) leaks.push(x.toFixed(1));
  }
  ok(leaks.length === 0, `the ${name} gate is sealed`,
    leaks.length ? `open at x=${leaks.join(',')}` : `${GATE_HALF * 2} m of opening covered`);
}

/* ────────────────────────────────────────────────────── wilmot: the grounds ── */
console.log(B('\nwilmot — the grounds'));

const wRects = [];
for (const s of WILMOT_STRUCTURES) wRects.push([s.id, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
for (const [x, z, ry, len] of HEDGES) {
  const hx = (ry === 0 ? len : HEDGE.w) / 2;
  const hz = (ry === 0 ? HEDGE.w : len) / 2;
  wRects.push([`hedge(${x},${z})`, x - hx, z - hz, x + hx, z + hz]);
}
for (const [x, z, s] of TREES) wRects.push([`tree(${x},${z})`, x - 0.45 * s, z - 0.45 * s, x + 0.45 * s, z + 0.45 * s]);
wRects.push(['pool', POOL.x0, POOL.z0, POOL.x1, POOL.z1]);
wRects.push(['terrace', TERRACE.x0, TERRACE.z0, TERRACE.x1, TERRACE.z1]);
const wOverlaps = [];
for (let i = 0; i < wRects.length; i++) {
  for (let j = i + 1; j < wRects.length; j++) {
    const a = wRects[i];
    const b = wRects[j];
    if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) wOverlaps.push(`${a[0]} ∩ ${b[0]}`);
  }
}
ok(wOverlaps.length === 0, 'nothing solid is inside anything else solid', wOverlaps.slice(0, 3).join(', '));

const wOut = wRects.filter(
  (r) => r[1] < -WILMOT.halfX || r[2] < -WILMOT.halfZ || r[3] > WILMOT.halfX || r[4] > WILMOT.halfZ
);
ok(wOut.length === 0, 'everything solid is inside the wall', wOut.map((r) => r[0]).join(' '));

const wilmot = mapById('wilmot');
// The manor is the landmark: two real storeys and the map's tallest eaves.
const manor = WILMOT_STRUCTURES.find((s) => s.id === 'manor');
ok(manor.floors === 2 && manor.h > 6, 'the manor is a two-storey landmark', `${manor.h} m eaves`);
ok(HEDGES.every(([, , ry]) => ry === 0 || ry === Math.PI / 2), 'clipped hedges are clipped (axis-aligned)');

// The estate's three signature grounds features behave as designed:
// the pool is water (not minimap floor), the sunken garden is walkable floor
// a full metre below the lawn, and the lawn right at its lip is still lawn.
ok(!wilmot.isOpen((POOL.x0 + POOL.x1) / 2, (POOL.z0 + POOL.z1) / 2), 'the pool is not open ground');
// probe beside the sundial, not through it — the centre of the bowl is cover
const bowlMid = [(BOWL.x0 + BOWL.x1) / 2 + 1.5, (BOWL.z0 + BOWL.z1) / 2 - 1.2];
ok(
  wilmot.isOpen(bowlMid[0], bowlMid[1]) && groundYWilmot(bowlMid[0], bowlMid[1]) < -1.0,
  'the sunken garden is a walkable trench',
  `${groundYWilmot(bowlMid[0], bowlMid[1]).toFixed(2)} m`
);
ok(Math.abs(groundYWilmot(BOWL.x1 + BOWL.lip + 1.5, bowlMid[1])) < 0.15, 'the lawn at its lip is still lawn');
ok(!wilmot.isOpen(0, WILMOT.halfZ + 3), 'outside the wall is not playable ground');

// Sample the grounds and ask how much a player can actually stand on — an
// estate is open country compared with Rust's yard, and should read as such.
let wOpen = 0;
let wTotal = 0;
for (let x = -WILMOT.halfX; x <= WILMOT.halfX; x += 1)
  for (let z = -WILMOT.halfZ; z <= WILMOT.halfZ; z += 1) {
    wTotal++;
    if (wilmot.isOpen(x, z)) wOpen++;
  }
const wFrac = wOpen / wTotal;
ok(wFrac > 0.5 && wFrac < 0.92, 'most of the grounds are walkable', `${(wFrac * 100).toFixed(0)}% open`);

/**
 * THE GATES ARE SEALED — same probe as Rust's, for the same reason. The wall
 * has one opening for the drive and one for the service gate, and the closed
 * gate leaf is the only thing between them and empty parkland. Walk every
 * line across each opening and require something solid within the mouth.
 */
for (const g of GATES) {
  const sign = g.side === 'n' ? -1 : 1;
  const leaks = [];
  for (let x = g.u - g.w / 2 + 0.2; x <= g.u + g.w / 2 - 0.2; x += 0.2) {
    let solid = false;
    for (let d = 0; d <= 2 && !solid; d += 0.2) {
      if (inSolidWilmot(x, sign * (WILMOT.halfZ - d), 0)) solid = true;
    }
    if (!solid) leaks.push(x.toFixed(1));
  }
  ok(leaks.length === 0, `the ${g.side === 'n' ? 'drive' : 'service'} gate is sealed`,
    leaks.length ? `open at x=${leaks.join(',')}` : `${g.w} m of opening covered`);
}

/* ────────────────────────────────────────────────── fishers: the grounds ── */
console.log(B("\nfishers — the grounds"));

const fRects = [];
for (const s of FISHER_STRUCTURES) {
  if (s.id === 'loggia') continue; // open on three sides; only its back wall is solid
  fRects.push([s.id, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
}
for (const [cx, cz, ry, len] of GARDEN_WALLS) {
  const hx = (ry === 0 ? len : GARDEN.t) / 2;
  const hz = (ry === 0 ? GARDEN.t : len) / 2;
  fRects.push([`garden-wall(${cx},${cz})`, cx - hx, cz - hz, cx + hx, cz + hz]);
}
for (const [x, z, w, d] of BEDS) fRects.push([`bed(${x},${z})`, x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
for (const [x, z, ry, len] of CONIFER_ROWS) {
  const hx = (ry === 0 ? len : CONIFER.r * 1.5) / 2;
  const hz = (ry === 0 ? CONIFER.r * 1.5 : len) / 2;
  fRects.push([`spruce(${x},${z})`, x - hx, z - hz, x + hx, z + hz]);
}
for (const [x, z, s] of FISHER_TREES) fRects.push([`tree(${x},${z})`, x - 0.45 * s, z - 0.45 * s, x + 0.45 * s, z + 0.45 * s]);
fRects.push(['pool', POOL_F.x0, POOL_F.z0, POOL_F.x1, POOL_F.z1]);
fRects.push(['spa', SPA.x - SPA.r, SPA.z - SPA.r, SPA.x + SPA.r, SPA.z + SPA.r]);
const fOverlaps = [];
for (let i = 0; i < fRects.length; i++) {
  for (let j = i + 1; j < fRects.length; j++) {
    const a = fRects[i];
    const b = fRects[j];
    // the garden wall's four runs meet at its own corners, by construction
    if (a[0].startsWith('garden-wall') && b[0].startsWith('garden-wall')) continue;
    if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) fOverlaps.push(`${a[0]} ∩ ${b[0]}`);
  }
}
ok(fOverlaps.length === 0, 'nothing solid is inside anything else solid', fOverlaps.slice(0, 3).join(', '));

const fOut = fRects.filter(
  (r) => r[1] < -FISHER.halfX || r[2] < -FISHER.halfZ || r[3] > FISHER.halfX || r[4] > FISHER.halfZ
);
ok(fOut.length === 0, 'everything solid is inside the treeline', fOut.map((r) => r[0]).join(' '));

const fishers = mapById('fishers');
// The house is the landmark and the north end of the axis; the pool house is
// the map's second storey and the only thing that answers its first floor.
const fHouse = FISHER_STRUCTURES.find((s) => s.id === 'house');
const fPool = FISHER_STRUCTURES.find((s) => s.id === 'poolhouse');
ok(fHouse.floors === 2 && fHouse.h > 6, 'the house is a two-storey landmark', `${fHouse.h} m eaves`);
ok(fPool.h > 3 && fPool.d > 15, 'the pool house roof is a real firing platform', `${fPool.d} m of it at ${fPool.h} m`);
ok(CONIFER_ROWS.every(([, , ry]) => ry === 0 || ry === Math.PI / 2), 'the spruce rows are axis-aligned');

/**
 * The three things the layout is FOR, asked of the tables rather than of a
 * screenshot: the pool is water and not minimap floor, the terrace it is cut
 * out of is walkable all the way round it, and the lawn is flat — this map
 * pays for its cheap terrain by building every height difference on it, so a
 * dig sneaking back into the height field is a real regression.
 */
const poolMid = [(POOL_F.x0 + POOL_F.x1) / 2, (POOL_F.z0 + POOL_F.z1) / 2];
ok(!fishers.isOpen(poolMid[0], poolMid[1]), 'the pool is not open ground');
// Both lanes past the spa are probed: it is parked between the pool's head
// and the house, and a spa that grew until it touched the terrace edge would
// cut the axis in half with nothing else in the build to say so.
const rim = [
  [POOL_F.x0 - 1.6, poolMid[1]],
  [POOL_F.x1 + 1.6, poolMid[1]],
  [poolMid[0], POOL_F.z1 + 2.6],
  [SPA.x - SPA.r - 1.2, SPA.z],
  [SPA.x + SPA.r + 1.2, SPA.z],
];
const walled = rim.filter(([x, z]) => !fishers.isOpen(x, z));
ok(walled.length === 0, 'the terrace walks all the way round it, and past the spa',
  walled.map(([x, z]) => `(${x},${z})`).join(' '));
let flat = true;
for (let x = -FISHER.halfX; x <= FISHER.halfX && flat; x += 2)
  for (let z = -FISHER.halfZ; z <= FISHER.halfZ && flat; z += 2) if (Math.abs(groundYFishers(x, z)) > 0.2) flat = false;
ok(flat, 'the lawn inside the treeline is flat — every rise on this map is built');
ok(!fishers.isOpen(0, FISHER.halfZ + 3), 'outside the treeline is not playable ground');

// Sample the grounds. An estate is open country compared with the Loop's
// block, and the buildings sit around the edges of it rather than in it.
let fOpen = 0;
let fTotal = 0;
for (let x = -FISHER.halfX; x <= FISHER.halfX; x += 1)
  for (let z = -FISHER.halfZ; z <= FISHER.halfZ; z += 1) {
    fTotal++;
    if (fishers.isOpen(x, z)) fOpen++;
  }
const fFrac = fOpen / fTotal;
ok(fFrac > 0.5 && fFrac < 0.92, 'most of the grounds are walkable', `${(fFrac * 100).toFixed(0)}% open`);

/**
 * THE GATES ARE SEALED — same probe as Rust's and Wilmot's, for the same
 * reason. The treeline has one opening for the drive and one for the service
 * gate, and the closed leaf is the only thing between them and open parkland.
 * Unlike Wilmot's, these sit on two different runs, so the probe walks in
 * along whichever axis the run belongs to.
 */
for (const g of FISHER_GATES) {
  const ns = g.side === 'n' || g.side === 's';
  const ry = ns ? 0 : Math.PI / 2;
  const cx = g.side === 'e' ? FISHER.halfX : g.side === 'w' ? -FISHER.halfX : 0;
  const cz = g.side === 'n' ? -FISHER.halfZ : g.side === 's' ? FISHER.halfZ : 0;
  const inward = ns ? -Math.sign(cz) : -Math.sign(cx);
  const leaks = [];
  for (let u = g.u - g.w / 2 + 0.2; u <= g.u + g.w / 2 - 0.2; u += 0.2) {
    const px = cx + Math.cos(ry) * u;
    const pz = cz - Math.sin(ry) * u;
    let solid = false;
    for (let dd = 0; dd <= 2 && !solid; dd += 0.2) {
      const x = ns ? px : px + inward * dd;
      const z = ns ? pz + inward * dd : pz;
      if (inSolidFishers(x, z, 0)) solid = true;
    }
    if (!solid) leaks.push(u.toFixed(1));
  }
  ok(leaks.length === 0, `the ${g.side === 'w' ? 'drive' : 'service'} gate is sealed`,
    leaks.length ? `open at u=${leaks.join(',')}` : `${g.w} m of opening covered`);
}

/* ─────────────────────────────────────────────────────── loop: the corner ── */
console.log(B('\nloop — the corner'));

// Blocks and columns must not intersect each other: buildings own the
// quadrants, columns stand in the streets, the two never meet.
const lRects = [];
for (const s of LOOP_STRUCTURES) lRects.push([s.id, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
for (const [x, z] of COLUMNS) lRects.push([`column(${x},${z})`, x - 0.4, z - 0.4, x + 0.4, z + 0.4]);
lRects.push(['station-stair', STATION.stair.x0, STATION.stair.z0, STATION.stair.x1, STATION.stair.z1]);
lRects.push(['scaffold', SCAFFOLD.x - 0.85, SCAFFOLD.topZ - 1.6, SCAFFOLD.x + 0.85, SCAFFOLD.footZ + 0.3]);
const lOverlaps = [];
for (let i = 0; i < lRects.length; i++) {
  for (let j = i + 1; j < lRects.length; j++) {
    const a = lRects[i];
    const b = lRects[j];
    if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) lOverlaps.push(`${a[0]} ∩ ${b[0]}`);
  }
}
ok(lOverlaps.length === 0, 'nothing solid is inside anything else solid', lOverlaps.slice(0, 3).join(', '));

const lOut = lRects.filter(
  (r) => r[1] < -LOOP.half - 0.01 || r[2] < -LOOP.half - 0.01 || r[3] > LOOP.half + 0.01 || r[4] > LOOP.half + 0.01
);
ok(lOut.length === 0, 'everything solid is inside the block', lOut.map((r) => r[0]).join(' '));

// The streets are streets: every bent column stands in a roadway (the L's
// legs famously do), except the platform legs, which stand on the south
// sidewalk under the platform they carry.
ok(
  COLUMNS.every(([x, z]) => {
    const inRoad = Math.min(Math.abs(x), Math.abs(z)) + 0.25 < LOOP.road;
    const underPlatform = z > LOOP.road && z < LOOP.walk && x > STATION.x0 && x < STATION.x1;
    return inRoad || underPlatform;
  }),
  'every column stands in a street or under the platform'
);

// The elevated structure is the landmark and the second storey.
ok(EL.deckY > 5.5, 'the tracks are a real second storey', `${EL.deckY} m`);
ok(EL.girderH > 0.8 && EL.girderH < 1.4, 'the guard girders are crouch cover', `${EL.girderH} m`);
// The curve actually joins the two runs: its ends sit on both centrelines.
const c0 = EL.curve[0];
const c1 = EL.curve[EL.curve.length - 1];
ok(c0[0] === 0 && c1[1] === 0, 'the curve joins the north run to the east run',
  `(${c0}) -> (${c1})`);
// The stalled train is stopped AT the platform, on the deck, north track.
ok(TRAIN.x0 < STATION.x1 && TRAIN.x1 > STATION.x0, 'the train is stalled at the platform');
ok(TRAIN.z < 0 && Math.abs(TRAIN.z) + TRAIN.w / 2 < EL.deckHalf, 'on the north track, inside the deck');
// And the deck lane past it stays wide enough to walk.
ok(STATION.z0 - (TRAIN.z + TRAIN.w / 2) > 1.2, 'the platform lane squeezes past the train',
  `${(STATION.z0 - (TRAIN.z + TRAIN.w / 2)).toFixed(1)} m`);

const loop = mapById('loop');
// Both stair feet start from open ground, or the second storey is scenery.
// The station flight is entered from the intersection's sidewalk to its west,
// the scaffold flight from the roadway south of it.
const sf = STATION.stair;
ok(
  loop.isOpen(sf.x0 - 1.4, 5.7) && loop.isOpen(sf.x0 - 3.4, 5.7),
  'the station stair has open ground to start from'
);
ok(
  loop.isOpen(SCAFFOLD.x, SCAFFOLD.footZ + 1.5) && loop.isOpen(SCAFFOLD.x, SCAFFOLD.footZ + 3.5),
  'the scaffold stair has open ground to start from'
);
ok(!loop.isOpen(0, LOOP.half + 3), 'outside the block is not playable ground');

// Sample the block: the plus of streets and the two alleys should leave the
// map far tighter than Wilmot's lawns but still leave real room to move.
let lOpen = 0;
let lTotal = 0;
for (let x = -LOOP.half; x <= LOOP.half; x += 1)
  for (let z = -LOOP.half; z <= LOOP.half; z += 1) {
    lTotal++;
    if (loop.isOpen(x, z)) lOpen++;
  }
const lFrac = lOpen / lTotal;
ok(lFrac > 0.28 && lFrac < 0.6, 'the streets and alleys are walkable', `${(lFrac * 100).toFixed(0)}% open`);

/**
 * THE MOUTHS ARE SEALED — same probe as Rust's gates, for the same reason.
 * Two streets and two alleys hit the map edge in eight places, and hoarding,
 * barriers or a dumpster line is the only thing between each one and empty
 * backdrop. Walk every line across each mouth and require something solid
 * within the first 3 m.
 */
for (const m of MOUTHS) {
  const leaks = [];
  for (let u = m.u - m.w / 2 + 0.2; u <= m.u + m.w / 2 - 0.2; u += 0.2) {
    let solid = false;
    for (let d = 0; d <= 3 && !solid; d += 0.2) {
      const along = LOOP.half - d;
      const [x, z] =
        m.side === 'n' ? [u, -along] : m.side === 's' ? [u, along] : m.side === 'w' ? [-along, u] : [along, u];
      if (inSolidLoop(x, z, 0)) solid = true;
    }
    if (!solid) leaks.push(u.toFixed(1));
  }
  ok(leaks.length === 0, `the ${m.side}${m.u !== 0 ? ` alley (${m.u})` : ' street'} mouth is sealed`,
    leaks.length ? `open at u=${leaks.join(',')}` : `${m.w} m of opening covered`);
}

/* ─────────────────────────────────────────────────── nuketown — the block ── */
console.log(B('\nnuketown — the block'));

const nuketown = mapById('nuketown');

/**
 * THE GREYBOX CONTRACT.
 *
 * Nuketown's look is not geometry, it is five palette entries that agree to do
 * nothing: no weathering, no edge wear, no grime, no macro drift, no normal
 * relief. Every one of those is a parameter, so every one of them is a single
 * character away from coming back — and a reviewer reading a diff that adds
 * `weather: [0.4, 0.5, 1.4, 0.55]` to one key has no way to know it just
 * un-styled a map.
 *
 * These four guards are the look written down. They are also the texture
 * budget: `TEXTURE-PERF.md` counts every `bake:` override, and the whole point
 * of this family is that four of the five keys share one 256 set.
 */
{
  const gb = Object.entries(PALETTE).filter(([k]) => k.startsWith('gb_'));
  ok(gb.length >= 5, 'the greybox palette family exists', gb.map(([k]) => k).join(' '));

  const notFlat = gb.filter(([, v]) => {
    const o = v.opts ?? {};
    const w = o.weather ?? [1, 1, 1, 1];
    return o.vertexMasks !== false || w.some((n) => n !== 0) || o.normalStrength !== 0;
  });
  ok(notFlat.length === 0, 'every greybox key is flat — no weather, no masks, no relief',
    notFlat.map(([k]) => k).join(' '));

  // `tint` is a linear multiply on a baked albedo, and palette.js opens by
  // saying values stay inside 0.02-0.9 reflectance. A pure-white tint is not a
  // material, it is a blown highlight with a mesh behind it.
  const outOfBand = gb.filter(([, v]) => {
    const t = v.opts?.tint;
    if (t === undefined) return false;
    return [16, 8, 0].some((sh) => {
      const lin = Math.pow(((t >> sh) & 255) / 255, 2.2);
      return lin < 0.02 || lin > 0.9;
    });
  });
  ok(outOfBand.length === 0, 'and every tint sits inside the 0.02-0.9 reflectance band',
    outOfBand.map(([k]) => k).join(' '));

  // Only the ruled deck may carry its own bake. The flat colours are one shared
  // 256 set differing by tint, which is what makes four of them free.
  const extraBakes = gb.filter(([, v]) => v.opts?.bake !== undefined);
  ok(extraBakes.length === 0, 'no greybox key overrides its bake — they share resident sets',
    extraBakes.map(([k]) => k).join(' '));
}

/**
 * The deck's squares are METRES, and that fact lives in three numbers across
 * two files: the cell count baked into the texture, the metres one tile spans,
 * and the projection scale the shader tiles it at. If they drift the floor
 * still looks like a grid — just a grid of 1.3 m squares, silently lying about
 * every distance a player reads off it.
 */
{
  const g = LIBRARY.grid;
  const cells = g.bake.param[0];
  ok(g.bake.worldSize / cells === 1, 'the deck grid is exactly 1 m',
    `${g.bake.worldSize} m / ${cells} cells`);
  ok(g.mat.scale === g.bake.worldSize, 'and the projection tiles it at its bake size',
    `scale ${g.mat.scale} vs worldSize ${g.bake.worldSize}`);
}

/**
 * The grid projects in WORLD space and `setTransform` bakes this yaw into every
 * vertex, so a non-zero yaw runs the ruling diagonally across every wall and
 * kerb on the map. Every other map wants a few tenths here — this is the one
 * that cannot have it, and the reason is invisible from inside `nuketown.js`.
 */
ok(nuketown.transform.yaw === 0,
  'nuketown is square to the world — the deck grid is world-projected and would skew',
  `yaw ${nuketown.transform.yaw}`);
const nRects = [];
for (const h of NUKE_HOUSES) nRects.push([h.id, h.x - h.w / 2, h.z - h.d / 2, h.x + h.w / 2, h.z + h.d / 2]);
const nWallRect = (label, x, z, ry, len, t) => {
  const hx = (ry === 0 ? len : t) / 2;
  const hz = (ry === 0 ? t : len) / 2;
  return [label, x - hx, z - hz, x + hx, z + hz];
};
for (const [x, z, w, d] of NUKE_SHEDS) nRects.push([`shed(${x},${z})`, x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
for (const [x, z, ry, len] of NUKE_YARD_WALLS) nRects.push(nWallRect(`yard-wall(${x},${z})`, x, z, ry, len, 0.35));
for (const [x, z, ry, len] of NUKE_STREET_BLOCKS) nRects.push(nWallRect(`street-block(${x},${z})`, x, z, ry, len, 0.8));
for (const [x, z, ry, len] of NUKE_MOUTH_BLOCKS) nRects.push(nWallRect(`mouth-block(${z})`, x, z, ry, len, 0.9));

const nOverlaps = [];
for (let i = 0; i < nRects.length; i++)
  for (let j = i + 1; j < nRects.length; j++) {
    const a = nRects[i];
    const b = nRects[j];
    if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) nOverlaps.push(`${a[0]} ∩ ${b[0]}`);
  }
ok(nOverlaps.length === 0, 'nothing solid is inside anything else solid', nOverlaps.slice(0, 3).join(', '));

const nOut = nRects.filter((r) => r[1] < -NUKE.halfX || r[2] < -NUKE.halfZ || r[3] > NUKE.halfX || r[4] > NUKE.halfZ);
ok(nOut.length === 0, 'everything solid is inside the compound wall', nOut.map((r) => r[0]).join(' '));

/**
 * The two houses ARE the map, and three things about them are load-bearing in a
 * way no still frame shows: that both are two storeys (the upstairs windows are
 * the whole risk/reward economy), that they are mirrored across the street
 * rather than merely near it, and that they are STAGGERED along it.
 *
 * The stagger is the one deliberate deviation from the reference layout. If a
 * later edit quietly lines the houses up, the map still builds, still plays and
 * silently becomes a first-shot-wins duel across 34 m — exactly the failure the
 * offset exists to prevent, and exactly the kind a screenshot cannot show.
 */
const west = NUKE_HOUSES.find((h) => h.id === 'west');
const east = NUKE_HOUSES.find((h) => h.id === 'east');
ok(NUKE_HOUSES.every((h) => h.floors === 2 && h.h > 6), 'both houses are two storeys', `${west.h} m ridge`);
ok(west.x === -east.x && west.face === -east.face, 'the houses mirror across the street');
ok(Math.abs(west.z - east.z) >= 4, 'and are staggered along it, so the upstairs windows do not face off',
  `${Math.abs(west.z - east.z)} m of offset`);
ok(
  Math.min(Math.abs(west.x) - west.w / 2, Math.abs(east.x) - east.w / 2) > NUKE.kerb,
  'neither house is built out over its own yard'
);

/**
 * The sheds exist to break standing sightlines in the end lots, which only
 * works if they are TALL — a shed that drifted down to barricade height would
 * leave the failure `spawns.probe.mjs` found still there, with nothing in the
 * build to say so. And a shed dropped on a spawn point does not fail anything
 * either: `buildSpawnPoints` silently culls the point against real collision,
 * so the map just quietly ships a zone short.
 */
ok(NUKE_SHEDS.every(([, , , , h]) => h > 2.4), 'the sheds stand above head height',
  `${Math.min(...NUKE_SHEDS.map((s) => s[4]))} m shortest`);
{
  const swallowed = nuketown.spawnPoints.filter(([x, z]) =>
    NUKE_SHEDS.some(([sx, sz, w, d]) => Math.abs(x - sx) < w / 2 + 0.6 && Math.abs(z - sz) < d / 2 + 0.6));
  ok(swallowed.length === 0, 'and none of them is parked on a spawn point',
    swallowed.map(([x, z, , zone]) => `${zone}(${x},${z})`).join(' '));
}

/**
 * The alleys behind the houses are the map's only route between the north and
 * south ends that does not cross the street. Without them each end is a pocket
 * with one watched exit — the dead end the playbook exists to forbid — so the
 * corridor is walked end to end rather than spot-checked.
 */
for (const h of NUKE_HOUSES) {
  const ax = Math.sign(h.x) * (Math.abs(h.x) + h.w / 2 + 1.5);
  const blocked = [];
  for (let z = -NUKE.halfZ + 2; z <= NUKE.halfZ - 2; z += 0.5)
    if (!nuketown.isOpen(ax, z)) blocked.push(z.toFixed(1));
  ok(blocked.length === 0, `the ${h.id} alley runs the length of the map`,
    blocked.length ? `blocked at z=${blocked.slice(0, 4).join(',')}` : `x=${ax.toFixed(1)}, wall to wall`);
}

/**
 * The sign is the landmark: the one thing visible from every corner, and the
 * only reason to look up on a map with no reachable roof. It has to span the
 * street to read as a gantry, clear head height so it costs no sightline it
 * does not mean to, and stand on ground a player can actually walk to.
 */
ok(NUKE_SIGN.poleX * 2 >= NUKE.streetHalf, 'the sign spans a real part of the street',
  `${(NUKE_SIGN.poleX * 2).toFixed(1)} m across ${NUKE.streetHalf * 2} m of road`);
ok(NUKE_SIGN.boardY > 2.4 && NUKE_SIGN.poleH > 6, 'it clears head height and stands above the houses’ eaves line',
  `board at ${NUKE_SIGN.boardY} m, ${NUKE_SIGN.poleH} m tall`);
ok(
  [-1, 1].every((s) => nuketown.isOpen(s * (NUKE_SIGN.poleX + 1.2), NUKE_SIGN.z)),
  'and you can walk up to both of its feet'
);

// The apron is a poured slab: this map pays for cheap terrain by building every
// height difference on top of it, so a dig sneaking into the height field is a
// real regression.
let nFlat = true;
for (let x = -NUKE.halfX; x <= NUKE.halfX && nFlat; x += 2)
  for (let z = -NUKE.halfZ; z <= NUKE.halfZ && nFlat; z += 2) if (Math.abs(groundYNuketown(x, z)) > 0.2) nFlat = false;
ok(nFlat, 'the compound floor is flat — every rise on this map is built');
ok(!nuketown.isOpen(0, NUKE.halfZ + 3) && !nuketown.isOpen(NUKE.halfX + 3, 0), 'outside the wall is not playable ground');

// Sample the block. Two 11 x 15 m houses in 51 x 42 m leaves a lot of street,
// so this sits nearer Rust's yard than the Loop's dense block.
let nOpen = 0;
let nTotal = 0;
for (let x = -NUKE.halfX; x <= NUKE.halfX; x += 1)
  for (let z = -NUKE.halfZ; z <= NUKE.halfZ; z += 1) {
    nTotal++;
    if (nuketown.isOpen(x, z)) nOpen++;
  }
const nFrac = nOpen / nTotal;
ok(nFrac > 0.45 && nFrac < 0.85, 'most of the compound is walkable', `${(nFrac * 100).toFixed(0)}% open`);

/**
 * THE STREET MOUTHS ARE SEALED — same probe as Rust's gates and the Loop's
 * street mouths, for the same reason. The compound wall is deliberately open
 * where the road leaves it at each end, and the barrier line parked across is
 * the only thing between that opening and empty desert.
 *
 * The probe stays 3 m deep on purpose: run it deeper and it reaches the first
 * street barricade 5 m inside, and becomes an assertion that cannot fail.
 */
for (const sz of [-1, 1]) {
  const leaks = [];
  for (let x = -NUKE.streetHalf + 0.2; x <= NUKE.streetHalf - 0.2; x += 0.2) {
    let solid = false;
    for (let d = 0; d <= 3 && !solid; d += 0.2) if (inSolidNuketown(x, sz * (NUKE.halfZ - d), 0)) solid = true;
    if (!solid) leaks.push(x.toFixed(1));
  }
  ok(leaks.length === 0, `the ${sz < 0 ? 'north' : 'south'} street mouth is sealed`,
    leaks.length ? `open at x=${leaks.join(',')}` : `${NUKE.streetHalf * 2} m of opening covered`);
}

/* ────────────────────────────────────────────────── bloodgulch — the canyon ── */
console.log(B('\nbloodgulch — the canyon'));

const gulch = mapById('bloodgulch');

/**
 * THE CANYON PALETTE CONTRACT — the same guard the greybox family gets, for the
 * same reason and one more.
 *
 * This map's brief is performance, and the whole of that brief in the material
 * layer is that every `bg_*` key is one shared `flat_matte` bake plus a tint:
 * no relief, no weathering, no vertex masks, no second texture set. Every one
 * of those is a parameter one character away from coming back, and a diff that
 * adds `bake:` to a key here reads as a nicer-looking rock right up until it is
 * seven more 1024 texture sets (TEXTURE-PERF.md).
 */
{
  const bg = Object.entries(PALETTE).filter(([k]) => k.startsWith('bg_'));
  ok(bg.length >= 7, 'the canyon palette family exists', bg.map(([k]) => k).join(' '));

  const notFlat = bg.filter(([, v]) => {
    const o = v.opts ?? {};
    const w = o.weather ?? [1, 1, 1, 1];
    return o.vertexMasks !== false || w.some((n) => n !== 0) || o.normalStrength !== 0;
  });
  ok(notFlat.length === 0, 'every canyon key is flat — no weather, no masks, no relief',
    notFlat.map(([k]) => k).join(' '));

  const extraBakes = bg.filter(([, v]) => v.opts?.bake !== undefined);
  ok(extraBakes.length === 0, 'and none of them overrides its bake — one resident set for the map',
    extraBakes.map(([k]) => k).join(' '));

  const outOfBand = bg.filter(([, v]) => {
    const t = v.opts?.tint;
    if (t === undefined) return false;
    return [16, 8, 0].some((sh) => {
      const lin = Math.pow(((t >> sh) & 255) / 255, 2.2);
      return lin < 0.02 || lin > 0.9;
    });
  });
  ok(outOfBand.length === 0, 'every tint sits inside the 0.02-0.9 reflectance band',
    outOfBand.map(([k]) => k).join(' '));
}

/**
 * `SOLIDS` is derived once and read by the build, by `inSolid` and by this
 * section, so these two checks are asking about the tables the map actually
 * ships rather than about a second copy of the arithmetic.
 */
{
  const overlaps = [];
  for (let i = 0; i < GULCH_SOLIDS.length; i++)
    for (let j = i + 1; j < GULCH_SOLIDS.length; j++) {
      const a = GULCH_SOLIDS[i];
      const b = GULCH_SOLIDS[j];
      if (a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0) overlaps.push(`${a.id} ∩ ${b.id}`);
    }
  ok(overlaps.length === 0, 'nothing solid is inside anything else solid', overlaps.slice(0, 3).join(', '));

  const outside = GULCH_SOLIDS.filter(
    (s) => s.x0 < -GULCH.halfX || s.z0 < -GULCH.halfZ || s.x1 > GULCH.halfX || s.z1 > GULCH.halfZ
  );
  ok(outside.length === 0, 'everything solid is inside the cliffs', outside.map((s) => s.id).join(' '));
}

// The two bases are one base placed twice, by a half-turn. If a later edit ever
// makes them merely similar, the map stops being symmetric in a way that only
// shows up as one end of the canyon quietly playing better than the other.
{
  const red = BASES.find((b) => b.id === 'red');
  const blue = BASES.find((b) => b.id === 'blue');
  ok(red.x === -blue.x && red.z === -blue.z && red.face === -blue.face, 'the bases mirror by a half-turn');
  ok(red.w === blue.w && red.d === blue.d, 'and are the same building', `${red.w} × ${red.d} m`);
  ok(Math.abs(red.x - blue.x) - red.w > 40, 'with a real field between them',
    `${(Math.abs(red.x - blue.x) - red.w).toFixed(0)} m mouth to mouth`);
}

/**
 * BOTH BASES ARE ENTERABLE, AND THE COURTYARD IS FLOOR.
 *
 * Every other structure in this game is a solid footprint the occupancy tests
 * refuse; this map's bases are hollow, and the courtyard is where a third of
 * its spawn points live. Model the base as one rect by accident and the map
 * still builds, still looks right, and quietly loses ten spawns, both flag
 * stands and every route through the middle of either end.
 */
// The probe below walks whatever width the table declares, so it cannot catch
// an opening that SHRANK — this is the check that does. A doorway under about a
// metre and a half is a choke two players cannot pass through at once, and the
// mouth is the base's front, not a door.
ok(
  BASE.mouthHalf * 2 >= 8 && BASE.backHalf * 2 >= 4 && BASE.doorX1 - BASE.doorX0 >= 3,
  'every opening in a base is wide enough to fight through',
  `mouth ${BASE.mouthHalf * 2} m, back ${BASE.backHalf * 2} m, sides ${BASE.doorX1 - BASE.doorX0} m`
);
for (const b of BASES) {
  const mx = b.x + b.face * (b.w / 2 - 0.9);
  const shut = [];
  for (let u = -BASE.mouthHalf + 0.4; u <= BASE.mouthHalf - 0.4; u += 0.4)
    if (!gulch.isOpen(mx, b.z + u)) shut.push(u.toFixed(1));
  ok(shut.length === 0, `the ${b.id} base mouth is open`, shut.length ? `blocked at u=${shut.join(',')}` : `${BASE.mouthHalf * 2} m of it`);
  ok(gulch.isOpen(b.x, b.z + 3) && gulch.isOpen(b.x, b.z - 3), `the ${b.id} courtyard is walkable floor`);
  // The back door and both side doors: three more ways out of the courtyard,
  // which is what stops a base being a room with one watched entrance.
  ok(gulch.isOpen(b.x - b.face * (b.w / 2 - 0.9), b.z), `the ${b.id} back door is open`);
  const sideX = b.x + b.face * ((BASE.doorX0 + BASE.doorX1) / 2);
  ok(
    [-1, 1].every((sz) => gulch.isOpen(sideX, b.z + sz * (b.d / 2 - 0.9))),
    `both ${b.id} side doors are open`
  );
}

/**
 * THE RAMPS REACH THE ROOF.
 *
 * Two numbers hold the only route to either roof: where the flight's top step
 * lands, and where the gap in the roof parapet is. They live in different parts
 * of `buildBase`, and if they ever stop bracketing each other the map keeps
 * both roofs and loses every way onto them — a failure that is invisible in a
 * still frame and total in play.
 */
{
  const topX = BASES[0].w / 2 - BASE.stairLen;
  ok(topX > 1.0 && topX + 0.5 < 4.4, 'the parapet gap brackets where the flight lands',
    `top step at x=${topX.toFixed(2)}, gap 1.0..4.4`);
  ok(Math.abs(BASE.stairSteps * BASE.stairRise - BASE.roofY) < 0.01, 'and the flight climbs exactly to the roof',
    `${(BASE.stairSteps * BASE.stairRise).toFixed(2)} m of ${BASE.roofY} m`);
  ok(BASE.lipH < 0.5, 'the kerb round the roof hole is steppable, so the drop-in works', `${BASE.lipH} m`);
  ok(BASE.roofY - BASE.voidHalf > 0 && BASE.voidHalf * 2 >= 6, 'the roof hole is a real opening',
    `${BASE.voidHalf * 2} m square`);
  ok(BASES[0].d / 2 - BASE.voidHalf >= 3, 'and the roof ring is wide enough to fight on',
    `${(BASES[0].d / 2 - BASE.voidHalf).toFixed(1)} m`);
}
// Each ramp foot starts from open field, or the roof is scenery. Probed at the
// foot and 2.5 m out in front of it, the way the derrick's stair is.
for (const b of BASES) {
  for (const s of baseSolids(b).filter((x) => x.kind === 'stair')) {
    const fx = b.x + b.face * (b.w / 2 + 1.6);
    const cz = (s.z0 + s.z1) / 2;
    ok(gulch.isOpen(fx, cz) && gulch.isOpen(fx + b.face * 2.5, cz),
      `${s.id} has open ground to start from`);
  }
}

/**
 * THE TOOTH IS DOING ITS JOB.
 *
 * It is the landmark, and it is the only thing standing between two base mouths
 * 42 m apart on a dead flat field. Height alone is not the invariant — a spire
 * nudged 10 m off the axis is still 13.5 m tall and no longer blocks anything —
 * so the check walks the line between the base centres and requires the spire's
 * own footprint to interrupt it.
 */
ok(TOOTH.height > 12, 'the Tooth is a landmark', `${TOOTH.height} m`);
// `height` is what this section reasons about; the slabs are what gets built.
// They are two numbers in two places, so they are checked against each other.
ok(
  Math.abs(TOOTH.levels.reduce((a, l) => a + l[2], 0) - TOOTH.height) < 0.01,
  'and the slabs it is built from add up to that height',
  `${TOOTH.levels.reduce((a, l) => a + l[2], 0)} m of slab`
);
// The top slab carries the silhouette: squat courses all the way up read as a
// stepped mesa, and a mesa is not a thing you navigate by.
ok(
  TOOTH.levels[2][2] > TOOTH.levels[0][2] && TOOTH.levels[2][0] < TOOTH.levels[0][0] / 2,
  'and it finishes in a spire rather than a step',
  `${TOOTH.levels[2][0]} m wide, ${TOOTH.levels[2][2]} m tall on top`
);
{
  const [red, blue] = [BASES[0], BASES[1]];
  let blocked = 0;
  for (let t = 0; t <= 1; t += 0.004) {
    const x = red.x + (blue.x - red.x) * t;
    const z = red.z + (blue.z - red.z) * t;
    if (inSolidBloodGulch(x, z, 0)) blocked++;
  }
  ok(blocked > 20, 'and it breaks the mouth-to-mouth sightline', `${blocked} of 251 samples solid`);
}
ok(
  RIDGES.every(([x, z, ry, len, w, h]) => h > 1.8 && h < 3.4),
  'every field ridge is above head height and below a roof',
  `${Math.min(...RIDGES.map((r) => r[5]))}..${Math.max(...RIDGES.map((r) => r[5]))} m`
);

// The floor is flat: this map pays for one collision box under the whole
// playable area, so a dig or a rise sneaking into the height field is a real
// regression and an expensive one.
let gFlat = true;
for (let x = -GULCH.halfX; x <= GULCH.halfX && gFlat; x += 2)
  for (let z = -GULCH.halfZ; z <= GULCH.halfZ && gFlat; z += 2)
    if (Math.abs(groundYBloodGulch(x, z)) > 0.2) gFlat = false;
ok(gFlat, 'the canyon floor is flat — every rise on this map is built');
ok(!gulch.isOpen(0, GULCH.halfZ + 3) && !gulch.isOpen(GULCH.halfX + 3, 0), 'outside the cliffs is not playable ground');

// Sample the floor. An open canyon should read as open — but the ridges,
// boulders and buttresses have to keep it well under an empty field.
let gOpen = 0;
let gTotal = 0;
for (let x = -GULCH.halfX; x <= GULCH.halfX; x += 1)
  for (let z = -GULCH.halfZ; z <= GULCH.halfZ; z += 1) {
    gTotal++;
    if (gulch.isOpen(x, z)) gOpen++;
  }
const gFrac = gOpen / gTotal;
ok(gFrac > 0.5 && gFrac < 0.8, 'the canyon floor is open country with real cover in it',
  `${(gFrac * 100).toFixed(0)}% open`);

/**
 * NO PATCH OF NO-MAN'S-LAND.
 *
 * The walkable fraction above is an average, and an average is exactly the
 * wrong statistic for this map: 100 m of canyon can be 61% open with all of the
 * cover at one end. What actually decides whether the field is crossable is the
 * WORST cell — the furthest a player can be from something that stops a bullet.
 *
 * This is the check that found the four flank ridges missing: the corridors
 * between each base's side wall and the cliff were 25 m of empty grass, and no
 * average said so. The map ships at 10.5 m and the bar is 12, which is tight
 * enough that deleting those ridges fails it again and loose enough that moving
 * one mid-lane rock does not — a bar the layout cannot reach is not a bar.
 */
{
  const nearest = (x, z) => {
    let best = Infinity;
    for (const s of GULCH_SOLIDS) {
      const dx = Math.max(s.x0 - x, 0, x - s.x1);
      const dz = Math.max(s.z0 - z, 0, z - s.z1);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
    return best;
  };
  let worst = 0;
  let at = null;
  for (let x = -GULCH.halfX; x <= GULCH.halfX; x += 1)
    for (let z = -GULCH.halfZ; z <= GULCH.halfZ; z += 1) {
      if (!gulch.isOpen(x, z)) continue;
      const d = nearest(x, z);
      if (d > worst) {
        worst = d;
        at = [x, z];
      }
    }
  ok(worst < 12, 'nowhere on the field is a long way from cover',
    `worst ${worst.toFixed(1)} m, at (${at})`);
}

/**
 * EVERY SPAWN IS REACHABLE FROM EVERY OTHER.
 *
 * The per-map checks above ask whether each authored point stands on open
 * ground; none of them asks whether a player can WALK from one to another. On a
 * map whose cover is 30 authored rectangles, the way that fails is a boulder
 * nudged against a ridge to close a lane, or a buttress grown until it meets
 * the base — leaving a pocket of perfectly standable ground nobody can enter or
 * leave. A flood fill from the boot spawn is the cheapest question that catches
 * it, and it also proves both courtyards connect to the field.
 */
{
  const seen = new Set();
  const start = gulch.spawnPoints[0];
  const stack = [[Math.round(start[0]), Math.round(start[1])]];
  seen.add(`${stack[0][0]},${stack[0][1]}`);
  while (stack.length) {
    const [x, z] = stack.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k)) continue;
      // 0.45 m of clearance: a body's width, not a point.
      if (!gulch.isOpen(nx, nz, 0.45)) continue;
      seen.add(k);
      stack.push([nx, nz]);
    }
  }
  const stranded = gulch.spawnPoints.filter(([x, z]) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) if (seen.has(`${Math.round(x) + dx},${Math.round(z) + dz}`)) return false;
    return true;
  });
  ok(stranded.length === 0, 'every spawn point can be walked to from the boot spawn',
    stranded.length ? stranded.map(([x, z, , zone]) => `${zone}(${x},${z})`).join(' ') : `${seen.size} cells reachable`);
}

/**
 * THE CANYON MOUTHS ARE SEALED — the same probe as Rust's gates and Nuketown's
 * street mouths, for the same reason. The cliff is deliberately left open at
 * both ends of the gulch, and the rockslide parked in each gap is the only
 * thing between it and open terrain. The probe stays 3 m deep: run it deeper
 * and it reaches the base's back wall, and becomes an assertion that cannot fail.
 */
for (const sx of [-1, 1]) {
  const leaks = [];
  for (let z = -GULCH.mouthHalf + 0.2; z <= GULCH.mouthHalf - 0.2; z += 0.2) {
    let solid = false;
    for (let d = 0; d <= 3 && !solid; d += 0.2) if (inSolidBloodGulch(sx * (GULCH.halfX - d), z, 0)) solid = true;
    if (!solid) leaks.push(z.toFixed(1));
  }
  ok(leaks.length === 0, `the ${sx < 0 ? 'west' : 'east'} canyon mouth is sealed`,
    leaks.length ? `open at z=${leaks.join(',')}` : `${GULCH.mouthHalf * 2} m of opening covered`);
}

// Every boulder is authored cover: the table the build places from is the table
// occupancy reads, so a rock a player can see is a rock they can hide behind.
ok(
  BOULDERS.every(([x, z, r]) => r >= 1.0 && GULCH_SOLIDS.some((s) => s.id.startsWith('boulder') && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1)),
  'every authored boulder is real cover, not a decal',
  `${BOULDERS.length} of them`
);

/* ───────────────────────────────────────────────────── dome — the station ── */
console.log(B('\ndome — the station'));

const dome = mapById('dome');

const dRects = [];
for (const s of DOME_STRUCTURES) dRects.push([s.id, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
for (const [x, z, ry, tier] of DOME_CONTAINERS) {
  if (tier !== 0) continue;
  const hx = (ry === 0 ? CONTAINER.l : CONTAINER.w) / 2;
  const hz = (ry === 0 ? CONTAINER.w : CONTAINER.l) / 2;
  dRects.push([`cont(${x},${z})`, x - hx, z - hz, x + hx, z + hz]);
}
for (const [x, z, ry, len] of RUIN_WALLS) {
  const hx = (ry === 0 ? len : 0.4) / 2;
  const hz = (ry === 0 ? 0.4 : len) / 2;
  dRects.push([`ruin(${x},${z})`, x - hx, z - hz, x + hx, z + hz]);
}
for (const [x, z] of WRECKS) dRects.push([`wreck(${x},${z})`, x - 2.2, z - 2.2, x + 2.2, z + 2.2]);

const dOverlaps = [];
for (let i = 0; i < dRects.length; i++)
  for (let j = i + 1; j < dRects.length; j++) {
    const a = dRects[i];
    const b = dRects[j];
    if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) dOverlaps.push(`${a[0]} ∩ ${b[0]}`);
  }
ok(dOverlaps.length === 0, 'nothing solid is inside anything else solid', dOverlaps.slice(0, 3).join(', '));

const dOut = dRects.filter((r) => r[1] < -DOME.halfX || r[2] < -DOME.halfZ || r[3] > DOME.halfX || r[4] > DOME.halfZ);
ok(dOut.length === 0, 'everything solid is inside the fence line', dOut.map((r) => r[0]).join(' '));

/**
 * THE RADOME IS THE MAP, and its numbers are load-bearing in ways no still
 * frame shows. The catwalk must oversail the machine room (a ring narrower
 * than the shed would land the stair on the shed roof instead), the sphere
 * must clear standing head height everywhere on the walkway, and the pedestal
 * must actually fit inside the room built around it. Any of these can drift a
 * few tenths in an edit and the map still builds, still screenshots fine, and
 * quietly loses its overlook.
 */
ok(RADOME.catOuter > RADOME.shedHalf, 'the catwalk oversails the machine room',
  `ring to ${RADOME.catOuter} m vs shed at ${RADOME.shedHalf} m`);
ok(RADOME.catY > RADOME.shedH + 0.9, 'and clears its roof by a real margin',
  `${(RADOME.catY - RADOME.shedH).toFixed(1)} m`);
ok(RADOME.pedR + 0.4 < RADOME.shedHalf, 'the pedestal fits inside the room with a walkway around it');
{
  // Sphere clearance over the walkway, from the same numbers the build uses:
  // surface height above the ring at its inner edge, minus the deck height.
  const dy = Math.sqrt(RADOME.sphereR ** 2 - RADOME.catInner ** 2);
  const clearance = RADOME.sphereY - dy - RADOME.catY;
  ok(clearance > 2.0, 'the sphere clears head height over the whole catwalk',
    `${clearance.toFixed(2)} m at the inner edge`);
}
ok(RADOME.sphereY + RADOME.sphereR > 16, 'the sphere is tall enough to be the landmark',
  `${(RADOME.sphereY + RADOME.sphereR).toFixed(1)} m to the crown`);

/**
 * THE STAIR IS THE ONLY WAY UP, so two facts about it are the whole vertical
 * design: the top step lands exactly on the catwalk's south edge (derived and
 * asserted from the same constants, so they cannot drift apart), and the foot
 * plus its run-up stand on open ground — a container nudged over the run-up
 * would strand the overlook with every other check green.
 */
{
  const run = Math.round(RADOME.catY / 0.275) * 0.3;
  ok(Math.abs(RADOME_STAIR_FOOT_Z - (RADOME.z + RADOME.catOuter) - run) < 1e-9,
    'the stair top lands on the catwalk edge', `${run.toFixed(1)} m of run`);
  const clear = [];
  for (let d = 0; d <= 2.4; d += 0.4)
    if (!dome.isOpen(RADOME.stairX, RADOME_STAIR_FOOT_Z + 0.4 + d)) clear.push(d.toFixed(1));
  ok(clear.length === 0, 'and its foot and run-up stand on open ground',
    clear.length ? `blocked ${clear.join(',')} m out` : `foot at z=${RADOME_STAIR_FOOT_Z.toFixed(1)}`);
}

/**
 * The bunker's yard wall is three ways in — door, breach, door — which is what
 * keeps a 30 m hall from being a two-door trap. The breach must stay a real
 * walk-through opening, and the doors must stay at the ends, one each side of
 * it, or the interior collapses to a camp with one watched approach.
 */
ok(BUNKER.doors.length === 2 && BUNKER.doors[0] < -8 && BUNKER.doors[1] > 8,
  'the bunker keeps a door at each end', `u = ${BUNKER.doors.join(', ')}`);
ok(BUNKER.breach.w >= 3 && BUNKER.breach.h >= 2.4,
  'and the breach between them is a walk-through opening',
  `${BUNKER.breach.w} × ${BUNKER.breach.h} m`);
ok(BUNKER.roofHole.s >= 2, 'the roof hole is real, not a crack', `${BUNKER.roofHole.s} m square`);

// The apron is a graded pad: every rise on this map is built, so a dig
// sneaking into the height field is a regression.
let dFlat = true;
for (let x = -DOME.halfX; x <= DOME.halfX && dFlat; x += 2)
  for (let z = -DOME.halfZ; z <= DOME.halfZ && dFlat; z += 2) if (Math.abs(groundYDome(x, z)) > 0.2) dFlat = false;
ok(dFlat, 'the compound floor is flat — every rise on this map is built');
ok(!dome.isOpen(0, DOME.halfZ + 3) && !dome.isOpen(DOME.halfX + 3, 0), 'outside the fence is not playable ground');

// Sample the yard. Two structures and a container scatter in 68 x 52 m — this
// sits in Rust's open-yard band, not the Loop's dense block.
let dOpen = 0;
let dTotal = 0;
for (let x = -DOME.halfX; x <= DOME.halfX; x += 1)
  for (let z = -DOME.halfZ; z <= DOME.halfZ; z += 1) {
    dTotal++;
    if (dome.isOpen(x, z)) dOpen++;
  }
const dFrac = dOpen / dTotal;
ok(dFrac > 0.55 && dFrac < 0.9, 'most of the compound is walkable', `${(dFrac * 100).toFixed(0)}% open`);

/**
 * EVERY SPAWN IS REACHABLE FROM EVERY OTHER — the flood fill Blood Gulch
 * carries, for the same reason: cover on this map is authored rectangles, and
 * the way connectivity fails is a container nudged against the radome shed or
 * a wreck against the ruin line, leaving standable ground nobody can enter.
 */
{
  const seen = new Set();
  const start = dome.spawnPoints[0];
  const stack = [[Math.round(start[0]), Math.round(start[1])]];
  seen.add(`${stack[0][0]},${stack[0][1]}`);
  while (stack.length) {
    const [x, z] = stack.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k)) continue;
      if (!dome.isOpen(nx, nz, 0.45)) continue;
      seen.add(k);
      stack.push([nx, nz]);
    }
  }
  const stranded = dome.spawnPoints.filter(([x, z]) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) if (seen.has(`${Math.round(x) + dx},${Math.round(z) + dz}`)) return false;
    return true;
  });
  ok(stranded.length === 0, 'every spawn point can be walked to from the boot spawn',
    stranded.length ? stranded.map(([x, z, , zone]) => `${zone}(${x},${z})`).join(' ') : `${seen.size} cells reachable`);
}

/**
 * THE FENCE MOUTHS ARE SEALED — the same probe as Rust's gates, for the same
 * reason. Each long side opens once, and the container parked across the gap
 * is the only thing between that opening and empty desert. The probe stays
 * 3 m deep: any deeper and it reaches unrelated mid-yard cover and becomes an
 * assertion that cannot fail.
 */
for (const [sz, mx, mw] of DOME_MOUTHS) {
  const leaks = [];
  for (let x = mx - mw / 2 + 0.2; x <= mx + mw / 2 - 0.2; x += 0.2) {
    let solid = false;
    for (let d = 0; d <= 3 && !solid; d += 0.2) if (inSolidDome(x, sz * (DOME.halfZ - d), 0)) solid = true;
    if (!solid) leaks.push(x.toFixed(1));
  }
  ok(leaks.length === 0, `the ${sz < 0 ? 'north' : 'south'} mouth is sealed`,
    leaks.length ? `open at x=${leaks.join(',')}` : `${mw} m of opening covered`);
}

/* ────────────────────────────────────────────────────── shivam — the beach ── */
console.log(B('\nshivam — the beach'));

const shivam = mapById('shivam');

/**
 * THE TERRACES FLOW DOWNHILL. The north half of the map is three slabs whose
 * steps are authored at 0.45 m precisely so they can be mantled anywhere —
 * nudge one terrace and the step quietly becomes a wall, the lawn becomes a
 * one-way drop, and nothing in a frame looks wrong.
 */
{
  const steps = [SHIVAM.yStreet - SHIVAM.yLawn, SHIVAM.yLawn - SHIVAM.yProm];
  ok(steps.every((s) => s > 0.2 && s <= 0.5), 'every terrace step is a mantle, not a wall',
    steps.map((s) => s.toFixed(2)).join(', '));
  ok(
    SHIVAM.yStreet > SHIVAM.yLawn && SHIVAM.yLawn > SHIVAM.yProm && SHIVAM.yProm > SHIVAM.beachTop,
    'and the terraces descend toward the sand'
  );
}

/**
 * THE SEA WALL IS ONE-WAY. Promenade side: 0.48 m — cover you can vault and
 * drop over. Beach side: the wall plus the terrace face, well past any
 * mantle, so the way back up is the three stairs. Both halves are one
 * constant each; either drifting flips the map's whole north-south flow.
 */
ok(SHIVAM.wallH <= 0.5, 'the sea wall can be vaulted from the promenade', `${SHIVAM.wallH} m`);
ok(
  SHIVAM.yProm + SHIVAM.wallH - SHIVAM.beachTop > 1.0,
  'but not from the beach',
  `${(SHIVAM.yProm + SHIVAM.wallH - SHIVAM.beachTop).toFixed(2)} m face over the sand`
);
// The gaps are open floor and the wall between them is not.
for (const g of WALL_GAPS) {
  ok(shivam.isOpen(g, WALL_Z0 + 0.15) && shivam.isOpen(g, 2.2),
    `the stair gap at x=${g} connects promenade to sand`);
}
{
  const mids = [-33, -12, 7, 19.5]; // segment midpoints between the gaps
  ok(mids.every((x) => inSolidShivam(x, WALL_Z0 + 0.15, 0)), 'and the wall between the gaps blocks');
}

/** Solids: no two overlap, everything inside the perimeter. */
{
  const rects = SHIVAM_STRUCTURES.filter((s) => s.id !== 'tower')
    .map((s) => ({ id: s.id, x0: s.x - s.w / 2, z0: s.z - s.d / 2, x1: s.x + s.w / 2, z1: s.z + s.d / 2 }));
  rects.push({ id: 'pool', x0: ICE_POOL.x0, z0: ICE_POOL.z0, x1: ICE_POOL.x1, z1: ICE_POOL.z1 });
  const overlaps = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0) overlaps.push(`${a.id} ∩ ${b.id}`);
    }
  ok(overlaps.length === 0, 'nothing solid is inside anything else solid', overlaps.join(', '));
  const outside = rects.filter(
    (r) => r.x0 < -SHIVAM.halfX || r.x1 > SHIVAM.halfX || r.z0 < SHIVAM.zBack || r.z1 > ICE_DECK.z1
  );
  ok(outside.length === 0, 'everything solid is inside the perimeter', outside.map((r) => r.id).join(' '));
}

/**
 * THE SURF LINE IS SEALED. The one perimeter that cannot be a wall: from the
 * west side to the Icebergs deck the reef chain must interrupt every walk
 * line into the water, and the deck itself (with its parapets) seals the
 * rest. Same probe as Rust's gates — shallow on purpose.
 */
{
  const leaks = [];
  for (let x = -SHIVAM.halfX + 0.5; x <= ICE_DECK.x0 - 0.2; x += 0.2) {
    let solid = false;
    for (let z = SHIVAM.zSurf; z <= SHIVAM.zSurf + 4 && !solid; z += 0.2) {
      if (inSolidShivam(x, z, 0)) solid = true;
    }
    if (!solid) leaks.push(x.toFixed(1));
  }
  ok(leaks.length === 0, 'the reef seals the surf line, west wall to deck',
    leaks.length ? `open at x=${leaks.slice(0, 5).join(',')}` : `${(ICE_DECK.x0 + SHIVAM.halfX).toFixed(0)} m of waterline`);
  // and the chain really is a chain — consecutive rects must overlap
  const gaps = [];
  for (let i = 1; i < REEF.length; i++) {
    const [ax, az, ar] = REEF[i - 1];
    const [bx, bz, br] = REEF[i];
    if (ax + ar * 0.75 < bx - br * 0.75 || Math.abs(az - bz) > (ar + br) * 0.75) gaps.push(i);
  }
  ok(gaps.length === 0, 'the reef rocks chain without a gap', gaps.length ? `broken at ${gaps.join(',')}` : `${REEF.length} rocks`);
}
{
  const leaks = [];
  for (let z = 0.5; z <= SHIVAM.zSurf; z += 0.2) {
    let solid = false;
    for (let x = -SHIVAM.halfX + 0.2; x <= -SHIVAM.halfX + 4.5 && !solid; x += 0.2) {
      if (inSolidShivam(x, z, 0)) solid = true;
    }
    if (!solid) leaks.push(z.toFixed(1));
  }
  ok(leaks.length === 0, 'the headland rocks seal the west end of the sand',
    leaks.length ? `open at z=${leaks.slice(0, 5).join(',')}` : 'sea wall to reef corner');
}
ok(
  !shivam.isOpen(0, SHIVAM.zSurf + 3) && !shivam.isOpen(33, ICE_DECK.z1 + 1.5) &&
    !shivam.isOpen(0, SHIVAM.zBack - 1.5) && !shivam.isOpen(-SHIVAM.halfX - 1, -10) &&
    !shivam.isOpen(SHIVAM.halfX + 1, -10),
  'outside the perimeter is not playable ground'
);

/**
 * THE ICE_POOL IS A DETOUR, NEVER A TRAP — the same contract as the Fisher's
 * pool. The floor sits a mantle below the coping, the water between the two,
 * and a full apron ring survives around it.
 */
ok(ICE_DECK.y - ICE_POOL.floorY <= 0.5, 'the pool can be mantled out of anywhere on its rim',
  `${(ICE_DECK.y - ICE_POOL.floorY).toFixed(2)} m deep`);
ok(ICE_POOL.floorY < ICE_POOL.waterY && ICE_POOL.waterY < ICE_DECK.y, 'and its water sits inside the basin');
ok(
  ICE_POOL.x0 - ICE_DECK.x0 >= 2.5 && ICE_DECK.x1 - ICE_POOL.x1 >= 2.5 && ICE_DECK.z1 - ICE_POOL.z1 >= 2.0,
  'the apron ring around the pool is wide enough to fight on',
  `${(ICE_POOL.x0 - ICE_DECK.x0).toFixed(1)} / ${(ICE_DECK.x1 - ICE_POOL.x1).toFixed(1)} / ${(ICE_DECK.z1 - ICE_POOL.z1).toFixed(1)} m`
);
ok(shivam.isOpen(ICE_DECK.x0 + 1.2, DECK_STAIR_Z) && shivam.isOpen(ICE_DECK.x0 - 2.5, DECK_STAIR_Z),
  'the deck beach stair has floor at both ends');

/**
 * THE PAVILION IS THE LANDMARK. Tallest position on the map, biggest
 * footprint, and its roof is reached by one stair whose foot starts from
 * open lawn — the three constants that hold that route live in three places.
 */
{
  const pav = SHIVAM_STRUCTURES.find((s) => s.id === 'pavilion');
  const roofs = SHIVAM_STRUCTURES.map((s) => (s.id === 'tower' ? SHIVAM_TOWER.deckY : s.floorY + s.h));
  const pavRoof = pav.floorY + pav.h;
  ok(roofs.every((r) => r <= pavRoof), 'the pavilion roof is the highest position',
    `${pavRoof.toFixed(1)} m vs ${roofs.map((r) => r.toFixed(1)).join('/')}`);
  ok(
    SHIVAM_STRUCTURES.every((s) => s.w * s.d <= pav.w * pav.d),
    'and its footprint is the biggest on the map'
  );
  ok(Math.abs(PAVILION_STAIR.x) < pav.w / 2 - 1.5, 'its roof stair lands inside the parapet line');
}
// Every roof stair's foot starts from open ground, or the roof is scenery.
for (const [id, x, z] of [
  ['pavilion', PAVILION_STAIR.x, PAVILION_STAIR.footZ - 0.5],
  ['kiosk', KIOSK_STAIR.x, KIOSK_STAIR.footZ + 1.2],
  ['clubhouse', CLUB_STAIR.x, CLUB_STAIR.footZ - 1.2],
]) {
  ok(shivam.isOpen(x, z), `the ${id} roof stair has open ground to start from`, `(${x}, ${z})`);
}

// The floor: flat on each terrace, monotonic down the sand, underwater past
// the surf — `groundY` is what spawns validate against and props drop onto.
{
  let flat = true;
  for (let x = -40; x <= 40 && flat; x += 2) {
    if (groundYShivam(x, -26) !== SHIVAM.yStreet) flat = false;
    if (groundYShivam(x, -18) !== SHIVAM.yLawn) flat = false;
    if (groundYShivam(x, -7) !== SHIVAM.yProm && !(x >= -13 && x <= 13) && !(x >= -37 && x <= -29)) flat = false;
  }
  ok(flat, 'each terrace is dead flat — every height on this map is built');
  ok(
    groundYShivam(0, 1) > groundYShivam(0, 8) && groundYShivam(0, 8) > groundYShivam(0, 13),
    'the sand falls toward the water'
  );
  ok(groundYShivam(0, 20) < -0.22, 'and the seabed is under the water plane past the surf');
  ok(groundYShivam(25.5, 15) === ICE_DECK.y && groundYShivam(33, 16) === ICE_POOL.floorY,
    'the deck and the pool answer for their own floor');
}

// Sample the floor. A beach should read open — the structures, the pool, the
// wall and the rock chains have to keep it under an empty field.
{
  let open = 0;
  let total = 0;
  for (let x = -SHIVAM.halfX; x <= SHIVAM.halfX; x += 1)
    for (let z = SHIVAM.zBack; z <= ICE_DECK.z1; z += 1) {
      total++;
      if (shivam.isOpen(x, z)) open++;
    }
  const frac = open / total;
  ok(frac > 0.55 && frac < 0.9, 'walkable fraction sits in the open-beach band', frac.toFixed(2));
}

// The wall gaps must line up with where the sea wall actually breaks — the
// spawn-side tables and the build both read WALL_GAPS, so what can drift is
// a gap wide enough to matter: two bodies, like the bases' doors.
ok(WALL_GAP_W >= 1.6, 'every sea-wall stair gap passes two players', `${WALL_GAP_W} m`);

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
