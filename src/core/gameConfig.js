/**
 * GAME CONFIG
 *
 * Loads `game.json` from the public root — the per-deploy switches and tuning
 * that don't need a code change or a rebuild to adjust. Edit
 * `public/game.json`, deploy, done.
 *
 *   features   on/off switches for whole features, read by the subsystem that
 *              owns each one
 *   audio      the ambience scheduler's timers, distances and gains
 *
 * `src/boot.js` loads it ONCE, before the engine exists, and every subsystem
 * reads the result synchronously as `ctx.config.game` — nothing else fetches
 * it, so there is no race between the file landing and a system starting.
 *
 * Fetch failure (offline build, headless selftest with no server) is not an
 * error: callers get `DEFAULT_GAME_CONFIG` back and behavior is unchanged.
 * Keep these defaults equal to what `public/game.json` ships, so a deploy
 * with the file missing behaves exactly like one with it present.
 */

export const DEFAULT_GAME_CONFIG = {
  /**
   * Whole-feature switches. Adding one is a default here, the same key in
   * `public/game.json`, and a check in the subsystem that owns the feature.
   */
  features: {
    /**
     * The continuous background layers: distant city hum, distant war rumble
     * and the wind (whose level is further scaled by audio.ambience.wind).
     * OFF by default.
     */
    ambienceBeds: false,
    /**
     * The scheduled background events: distant gunfire volleys, distant
     * explosions, the ambient one-shots (dog, siren, helicopter, ...) and
     * distant enemy chatter. OFF by default. Gameplay sounds that happen to
     * use the ambience bus — the Site Work blackout — are not part of this.
     */
    ambienceEvents: false,
  },
  audio: {
    ambience: {
      wind: { level: 0, bedGain: 0.5 },
      /** Ranges used to seed each timer once, when the beds first start. */
      timers: {
        gust: [4, 14],
        volley: [3, 11],
        boom: [14, 44],
        oneshot: [5, 17],
        chatter: [18, 50],
      },
      /** Ranges used to reseed each timer every time it fires. */
      repeatTimers: {
        gust: [5, 16],
        volley: [2.5, 12],
        boom: [16, 50],
        oneshot: [6, 20],
        chatter: [20, 60],
      },
      distantVolley: {
        distance: [70, 240],
        heightJitter: [-2, 6],
        maxRounds: 6,
        rateRange: [0.075, 0.13],
        gain: 4.5,
        maxDist: 400,
      },
      distantBoom: {
        distance: [120, 330],
        heightJitter: [0, 8],
        radius: [6, 16],
        gain: 6,
        maxDist: 400,
      },
      oneShot: {
        nearDistance: [14, 90],
        farDistance: [90, 260],
        levelRange: [0.55, 1],
        nearGain: 2.5,
        farGain: 14,
        maxDist: 400,
      },
      distantChatter: { distance: [25, 75], level: 0.85 },
    },
  },
};

/** How long boot waits for game.json before giving up on it. */
const FETCH_TIMEOUT_MS = 4000;

/** Shallow-merge per top-level section so a partial game.json still works. */
function mergeSection(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k])
      ? mergeSection(base[k], v)
      : v;
  }
  return out;
}

/**
 * The config a run actually uses. Capture runs take the built-in `features`
 * whatever the deploy's game.json says, so flipping a switch on the live site
 * can never move the pixel baselines `tools/baseline.mjs` compares against.
 */
export function gameConfigForRun(cfg, { capture = false } = {}) {
  if (!capture) return cfg;
  return { ...cfg, features: { ...DEFAULT_GAME_CONFIG.features } };
}

/**
 * Fetch and parse game.json. Resolves to DEFAULT_GAME_CONFIG (or a merge of
 * the default with whatever loaded) — never rejects.
 */
export async function loadGameConfig(baseUrl = '/') {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    // Boot awaits this, so a request that never answers must not stall the
    // game: past the timeout it is a failed fetch like any other — defaults.
    const res = await fetch(`${base}game.json`, { signal: AbortSignal.timeout?.(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`game.json ${res.status}`);
    const parsed = await res.json();
    return mergeSection(DEFAULT_GAME_CONFIG, parsed);
  } catch (err) {
    console.info('[config] no game.json — using built-in defaults');
    return DEFAULT_GAME_CONFIG;
  }
}
