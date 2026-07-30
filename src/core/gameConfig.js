/**
 * GAME CONFIG
 *
 * Loads `game.json` from the public root — data-driven tuning that doesn't
 * need a code change to adjust (currently just the ambience one-shot/boom/
 * volley knobs; more sections land here as they're pulled out of subsystems).
 *
 * Fetch failure (offline build, headless selftest with no server) is not an
 * error: callers get `DEFAULT_GAME_CONFIG` back and behavior is unchanged.
 */

export const DEFAULT_GAME_CONFIG = {
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
 * Fetch and parse game.json. Resolves to DEFAULT_GAME_CONFIG (or a merge of
 * the default with whatever loaded) — never rejects.
 */
export async function loadGameConfig(baseUrl = '/') {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    const res = await fetch(`${base}game.json`);
    if (!res.ok) throw new Error(`game.json ${res.status}`);
    const parsed = await res.json();
    return mergeSection(DEFAULT_GAME_CONFIG, parsed);
  } catch (err) {
    console.info('[config] no game.json — using built-in defaults');
    return DEFAULT_GAME_CONFIG;
  }
}
