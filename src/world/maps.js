import { MARKET_MAP } from './market.js';
import { RUST_MAP } from './rust.js';
import { WILMOT_MAP } from './wilmot.js';
import { LOOP_MAP } from './loop.js';
import { FISHERS_MAP } from './fishers.js';
import { NUKETOWN_MAP } from './nuketown.js';
import { BLOODGULCH_MAP } from './bloodgulch.js';
import { DOME_MAP } from './dome.js';
import { SHIVAM_MAP } from './shivam.js';

/**
 * WORLD — the map list.
 *
 * The level used to be a single hard-coded build sequence inside
 * `WorldSystem.init`. It is now one of these descriptors, so a second map is a
 * new module rather than a fork of the world subsystem, and so the player can
 * choose one on the Match Start screen.
 *
 * A MAP DESCRIPTOR provides the level itself. Its menu NAME and DESCRIPTION are
 * not here — they live in `REGISTRY` below, beside the enable flag and the menu
 * order, so that one table answers "what ships, in what order, called what".
 *
 *   id           stable string, used in the URL (`?map=rust`) and on the wire
 *   blurb        two lines of "what is it like to play"
 *   size         human-readable extent, for the menu card
 *   transform    { yaw, tx, tz } — LEVEL -> WORLD, baked into every vertex
 *   bounds       [minX,minY,minZ, maxX,maxY,maxZ] of the playable area, LEVEL
 *   spawnPoints  the authored spawn table (see src/world/spawns.js)
 *   standable    (x, z, margin) => boolean, LEVEL space — the cheap first
 *                filter the spawn validator applies before real collision
 *   groundY      (x, z) => number — analytic floor height, LEVEL space
 *   isOpen       (x, z, margin) => boolean — where a character can stand
 *                outdoors; this is what `ui/minimap` draws as floor
 *   build(A,rng) assemble the level into `A`; returns { buildings }
 *   environment  OPTIONAL { hour, weather, exposureBias } — the sky this map is
 *                set under. `hour` is local solar time, 0..24; `weather` is a
 *                patch over the sky's defaults (`turbidity`, `cloudCoverage`,
 *                `cloudDensity`, `cirrusCoverage`, `cirrusOpacity`,
 *                `horizonMurk`, `windSpeed`, `windAngle`, `fogDensity`,
 *                `fogHeight`, `shaftGain` — see `sky.setWeather`);
 *                `exposureBias` is EV of metering compensation the map adds to
 *                the sky's own, positive being darker, for a level whose own
 *                lights carry the frame. `world` hands the whole thing to
 *                `sky.applyEnvironment` on every build, and a map WITHOUT one
 *                restores the sky's defaults rather than inheriting the last
 *                map's — so a night map cannot leak into a day one. The Loop is
 *                the only map that carries one today.
 *
 * `build` must register its own prop prototypes and must draw only from the
 * `rng` it is handed — the world's fork — so a capture run stays reproducible.
 */
/**
 * THE REGISTRY — the one table to edit.
 *
 * Everything that is a DEPLOY decision rather than a level-design one lives
 * here, so "what ships, in what order, called what" is one file to read:
 *
 *   map          the descriptor module
 *   order        menu position, low to high. Sparse on purpose (10, 20, 30…)
 *                so a map can be slotted between two others without renumbering
 *                the rest. Ties break on registry position.
 *   enabled      false hides it from the menu, the URL and the boot resolver.
 *                It is NOT deleted: `ALL_MAPS` still carries it and
 *                `maps.selftest.mjs` still builds it, so a parked map cannot
 *                rot quietly and come back broken.
 *   name         what the menu shows
 *   description  one line under the name
 *
 * `name`/`description` live here rather than on the descriptor so that the
 * modules stay pure geometry, and so there is exactly one place a menu string
 * can be wrong. The descriptor keeps `blurb` and `size` — those are written
 * with the level, not with the release.
 *
 * This list is a MODULE, not `game.json`, because it holds live references to
 * `build`/`standable`/`groundY` closures, because `resolveBootMap` needs it
 * synchronously at boot, and because `maps.selftest.mjs` runs under node where
 * a fetch of the public root would silently resolve to nothing.
 */
const REGISTRY = [
  {
    map: WILMOT_MAP,
    order: 10,
    enabled: true,
    name: 'Wilmot',
    description: 'Bannockburn estate grounds',
  },
  {
    map: FISHERS_MAP,
    order: 20,
    enabled: true,
    name: "The Fisher's",
    description: 'North Shore estate, down the pool axis',
  },
  {
    map: RUST_MAP,
    order: 30,
    enabled: true,
    name: 'Rust',
    description: 'Desert oil refinery',
  },
  {
    map: NUKETOWN_MAP,
    order: 35,
    enabled: true,
    name: 'Nuketown',
    description: 'Two houses across a test-site street',
  },
  {
    map: BLOODGULCH_MAP,
    order: 37,
    enabled: true,
    name: 'Blood Gulch',
    description: 'Box canyon, a base at each end',
  },
  {
    map: DOME_MAP,
    order: 38,
    enabled: true,
    name: 'Dome',
    description: 'Radar station under a broken radome',
  },
  {
    map: SHIVAM_MAP,
    order: 39,
    enabled: true,
    name: 'Shivam',
    description: 'Bondi Beach front, Sydney',
  },
  {
    map: MARKET_MAP,
    order: 40,
    enabled: false,
    name: 'Market',
    description: 'Middle-Eastern market street',
  },
  {
    map: LOOP_MAP,
    order: 50,
    enabled: false,
    name: 'The Loop',
    description: 'Chicago corner under the L, after dark',
  },
];

/** Registry order, resolved once. `sort` is stable, so ties keep listed order. */
const ORDERED = [...REGISTRY].sort((a, b) => a.order - b.order);

/** Registry metadata by map id — what `mapSummaries` merges over the descriptor. */
const META = new Map(ORDERED.map((e) => [e.map.id, e]));

/**
 * EVERY map, enabled or not, in menu order.
 *
 * This is the selftest's surface. Nothing in the running game should read it:
 * a disabled map has no spawns validated against a live match and must not be
 * reachable from the menu, the URL or a stored preference.
 */
export const ALL_MAPS = ORDERED.map((e) => e.map);

/** The maps a player can actually reach, in menu order. */
export const MAPS = ORDERED.filter((e) => e.enabled).map((e) => e.map);

/**
 * The registry as plain data, in menu order — for tooling and the selftest.
 * Copies, so a reader cannot enable a map by mutating what it was handed.
 */
export function mapRegistry() {
  return ORDERED.map((e) => ({
    id: e.map.id,
    order: e.order,
    enabled: e.enabled,
    name: e.name,
    description: e.description,
  }));
}

/**
 * The map a fresh session boots on. Every capture baseline is framed on it.
 *
 * MUST be an ENABLED id — a default that is parked resolves to nothing and boot
 * fails. `maps.selftest.mjs` guards exactly that. Moved off the market when the
 * market was parked; every baseline shot before that framed the market and is
 * not comparable to one shot now.
 */
export const DEFAULT_MAP_ID = 'wilmot';

/** Where the chosen map is remembered between sessions. */
const STORAGE_KEY = 'workmelt.map';

export function getMap(id) {
  return MAPS.find((m) => m.id === id) ?? null;
}

export function isMapId(id) {
  return typeof id === 'string' && MAPS.some((m) => m.id === id);
}

/**
 * A map's FLOORPLAN, rasterised from its own `isOpen` predicate.
 *
 * The menu used to describe a level in prose alone, which makes six maps read
 * as six paragraphs. `isOpen(x, z, margin)` is the same analytic predicate
 * `ui/minimap` draws as floor, so a silhouette costs no art, no texture and no
 * fetch — it is the level answering "where can a character stand".
 *
 * LEVEL space, sampled over `bounds` on the X/Z plane. `cols` fixes the long
 * axis and the short axis follows from the aspect ratio, so a wide canyon and
 * a square compound come back at their true proportions rather than both
 * squashed into a square. Returns cells row-major, north (−Z) first, as a
 * Uint8Array of 0/1 — small enough to hand to a menu and trivially drawable.
 *
 * Pure and deterministic: no rng, no allocation per frame, and nothing here is
 * loaded at runtime by the world itself.
 */
export function mapPlan(map, cols = 56) {
  const [minX, , minZ, maxX, , maxZ] = map.bounds;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const long = Math.max(w, d);
  const cx = Math.max(8, Math.round((cols * w) / long));
  const cz = Math.max(8, Math.round((cols * d) / long));
  const cells = new Uint8Array(cx * cz);
  const open = map.isOpen;
  if (typeof open === 'function') {
    for (let j = 0; j < cz; j++) {
      // +0.5 samples the centre of the cell, not its corner, so a wall that
      // lands exactly on a grid line does not erase the row behind it.
      const z = minZ + ((j + 0.5) / cz) * d;
      for (let i = 0; i < cx; i++) {
        const x = minX + ((i + 0.5) / cx) * w;
        cells[j * cx + i] = open(x, z, 0.3) ? 1 : 0;
      }
    }
  }
  return { cols: cx, rows: cz, cells };
}

/**
 * The menu's model: everything `src/match` needs, and nothing it does not.
 *
 * Menu order is registry order, and the presentation strings are the registry's
 * — the descriptor supplies only what was authored with the level.
 *
 * `plan` is the one derived field: the lobby draws a floorplan thumbnail from
 * it, and computing it here rather than in `src/match` is what keeps the view
 * from importing `isOpen` and `bounds` — i.e. the level itself — to draw a
 * picture of it.
 */
export function mapSummaries() {
  return MAPS.map((m) => ({
    id: m.id,
    name: META.get(m.id).name,
    description: META.get(m.id).description,
    blurb: m.blurb,
    size: m.size,
    plan: mapPlan(m),
  }));
}

/**
 * Which map to build at boot.
 *
 * `?map=` wins, then whatever the player last chose, then the default. A
 * deterministic (capture) run ignores the stored preference entirely: the pixel
 * gate compares against the market, and a developer who once clicked Rust in a
 * browser must not be able to change what `tools/baseline.mjs` renders. An
 * explicit `?map=` still works under capture, which is how you shoot the other
 * map on purpose.
 */
export function resolveBootMap({ search = '', deterministic = false, preferred = null } = {}) {
  try {
    const q = new URLSearchParams(search).get('map');
    if (isMapId(q)) return q;
  } catch {
    /* a URL we cannot parse is not a reason to fail boot */
  }
  if (isMapId(preferred)) return preferred;
  if (!deterministic) {
    const saved = loadMapPreference();
    if (isMapId(saved)) return saved;
  }
  return DEFAULT_MAP_ID;
}

export function loadMapPreference() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveMapPreference(id) {
  if (!isMapId(id)) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    /* private browsing / storage disabled — the choice just does not stick */
  }
}

export { MARKET_MAP, RUST_MAP, WILMOT_MAP, LOOP_MAP, FISHERS_MAP, NUKETOWN_MAP, BLOODGULCH_MAP, DOME_MAP, SHIVAM_MAP };
