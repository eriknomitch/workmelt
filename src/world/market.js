import { BUILDINGS } from './layout.js';
import { buildGround } from './ground.js';
import { buildBuilding, collapseRoof } from './buildings.js';
import { registerProps } from './props.js';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  scatterDebris,
  buildGate,
  buildPerimeter,
  groundY,
  isOpen,
} from './dressing.js';
import { SPAWN_POINTS, standableAt } from './spawns.js';

/**
 * WORLD — MARKET, the original map, as a map descriptor.
 *
 * This is the ~120 x 120 m Middle-Eastern market street the game shipped with:
 * one main street with a plaza, flanking alleys, eighteen buildings (three of
 * them enterable and furnished over multiple floors), an arched gate closing
 * the vista, and several thousand props.
 *
 * The build sequence below is EXACTLY the one that used to live inline in
 * `WorldSystem.init` — same order, same RNG draw order — because the capture
 * baselines in `tools/baseline.mjs` are pixel comparisons against this map and
 * a reordered `rng` call would move every one of them.
 *
 * See `maps.js` for what a map descriptor has to provide.
 */
export const MARKET_MAP = {
  id: 'market',
  name: 'Market',
  subtitle: 'Middle-Eastern market street',
  blurb:
    'One long street, two flanking alleys and an arched gate. Fought at every range, with interiors and rooftops on both sides.',
  size: '120 × 120 m',
  /**
   * LEVEL -> WORLD. The street is authored down -Z; this yaw puts it on the
   * axis the canonical hero/sunset cameras look along, with the market in the
   * near third of the frame and the gate closing the far end.
   */
  transform: { yaw: 0.5877, tx: 0.9, tz: 1.34 },
  /** Playable bounds in LEVEL space, [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds: [-62, -2, -62, 62, 26, 62],
  spawnPoints: SPAWN_POINTS,
  standable: standableAt,
  groundY,
  isOpen,

  build(A, rng) {
    // 1. prototypes first: the level references them by id while it builds
    registerProps(A, rng);
    registerDressingProps(A, rng);

    // 2. ground, then the shells, then what people put in and on them
    buildGround(A, rng);

    const infos = [];
    for (const spec of BUILDINGS) {
      const info = buildBuilding(A, rng, spec);
      infos.push(info);
      if (spec.collapse) {
        collapseRoof(A, rng, spec, info, {
          x: spec.x + rng.range(-2, 2),
          z: spec.z + rng.range(-2, 2),
        });
      }
    }

    buildGate(A, rng);
    buildPerimeter(A, rng);
    dressStreet(A, rng);
    dressBuildings(A, rng, infos);
    scatterDebris(A, rng);

    return { buildings: infos };
  },
};
