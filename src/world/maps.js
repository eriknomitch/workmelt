import { MARKET_MAP } from './market.js';
import { RUST_MAP } from './rust.js';
import { WILMOT_MAP } from './wilmot.js';
import { LOOP_MAP } from './loop.js';

/**
 * WORLD — the map list.
 *
 * The level used to be a single hard-coded build sequence inside
 * `WorldSystem.init`. It is now one of these descriptors, so a second map is a
 * new module rather than a fork of the world subsystem, and so the player can
 * choose one on the Match Start screen.
 *
 * A MAP DESCRIPTOR provides:
 *
 *   id           stable string, used in the URL (`?map=rust`) and on the wire
 *   name         what the menu shows
 *   subtitle     one line under the name
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
 *
 * `build` must register its own prop prototypes and must draw only from the
 * `rng` it is handed — the world's fork — so a capture run stays reproducible.
 */
export const MAPS = [MARKET_MAP, RUST_MAP, WILMOT_MAP, LOOP_MAP];

/** The map a fresh session boots on. Every capture baseline is framed on it. */
export const DEFAULT_MAP_ID = 'market';

/** Where the chosen map is remembered between sessions. */
const STORAGE_KEY = 'workmelt.map';

export function getMap(id) {
  return MAPS.find((m) => m.id === id) ?? null;
}

export function isMapId(id) {
  return typeof id === 'string' && MAPS.some((m) => m.id === id);
}

/** The menu's model: everything `src/match` needs, and nothing it does not. */
export function mapSummaries() {
  return MAPS.map((m) => ({
    id: m.id,
    name: m.name,
    subtitle: m.subtitle,
    blurb: m.blurb,
    size: m.size,
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

export { MARKET_MAP, RUST_MAP, WILMOT_MAP, LOOP_MAP };
