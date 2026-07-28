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
for (const m of MAPS.filter((m) => m.environment)) {
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
  const loopEnv = getMap('loop').environment;
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

const wilmot = getMap('wilmot');
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

const loop = getMap('loop');
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

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
