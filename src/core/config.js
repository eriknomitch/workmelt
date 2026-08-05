/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;

/** Real-world units are metres, seconds, kilograms. */
export const UNITS = {
  gravity: -9.81 * 2.1, // Games use exaggerated gravity; CoD-like feel.
  playerHeight: 1.78,
  playerCrouchHeight: 1.12,
  playerRadius: 0.32,
  eyeOffset: 0.12, // below top of capsule
};

/**
 * Fields every preset carries but which used to be derived inside `render`
 * from the tier name. They are spelled out per preset now so the advanced
 * settings menu has something to override, and so a subsystem never has to
 * re-derive "what does `medium` mean" for itself. Values below reproduce
 * exactly what the derivations produced before they moved here.
 */
const SHARED = {
  prepass: true,
  post: true,
  /** Multiplier on the world texture bake resolution; 1 = 1K reference. */
  textureScale: 1,
  /** Multiplier on per-surface parallax depth; 0 disables the POM march. */
  parallaxScale: 1,
  /** Multiplier on the shared micro-detail layer's strength and range. */
  detailScale: 1,
  /** Ceiling on devicePixelRatio for the canvas backbuffer. */
  pixelRatioCap: 1.5,
  /**
   * Hard ceiling on the pixel AREA of the backbuffer and the internal targets,
   * whatever the window size — 3840x2160 worth of pixels.
   *
   * Every other knob in the resolution chain is a ratio of the window, and the
   * window has no upper bound: one unchanged profile asks for 2.1 MP on a
   * laptop, 8.3 MP on a 4K panel, 14.7 MP on a 5K one and 33 MP on an 8K one,
   * against a render-target set that costs ~160 MB per megapixel at `high`.
   * This is the number that makes "how big is your monitor" stop being an
   * unbounded input. Area rather than width x height, so an ultrawide is not
   * singled out for being wide. See src/render/resolution.js.
   */
  maxPixels: 8294400,
};

export const QUALITY_PRESETS = {
  performance: {
    ...SHARED,
    renderScale: 0.3,
    minRenderScale: 0.2,
    maxRenderScale: 0.3,
    shadows: true,
    shadowQuality: -1,
    shadowMapSize: 512,
    cascades: 1,
    shadowDistance: 30,
    taa: false,
    antialias: 'fxaa',
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: false,
    contactShadows: false,
    dof: false,
    viewSamples: 0,
    anisotropy: 2,
    textureScale: 0.5,
    particleBudget: 1000,
    decalBudget: 32,
  },
  low: {
    ...SHARED,
    renderScale: 0.72,
    minRenderScale: 0.5,
    maxRenderScale: 1,
    shadows: true,
    shadowQuality: 0,
    shadowMapSize: 1024,
    cascades: 3,
    shadowDistance: 60,
    taa: false,
    antialias: 'fxaa',
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    contactShadows: false,
    dof: false,
    viewSamples: 0,
    anisotropy: 4,
    textureScale: 0.5,
    particleBudget: 2000,
    decalBudget: 64,
  },
  medium: {
    ...SHARED,
    renderScale: 0.85,
    minRenderScale: 0.5,
    maxRenderScale: 1,
    shadows: true,
    shadowQuality: 1,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 90,
    taa: true,
    antialias: 'taa',
    gtao: true,
    ssr: false,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    contactShadows: true,
    dof: true,
    viewSamples: 2,
    anisotropy: 8,
    textureScale: 0.75,
    particleBudget: 6000,
    decalBudget: 128,
  },
  high: {
    ...SHARED,
    renderScale: 1.0,
    minRenderScale: 0.5,
    maxRenderScale: 1,
    shadows: true,
    shadowQuality: 2,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 140,
    taa: true,
    antialias: 'taa',
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    contactShadows: true,
    dof: true,
    viewSamples: 4,
    anisotropy: 16,
    textureScale: 1,
    particleBudget: 12000,
    decalBudget: 256,
  },
  ultra: {
    ...SHARED,
    renderScale: 1.0,
    minRenderScale: 0.5,
    maxRenderScale: 1,
    shadows: true,
    shadowQuality: 3,
    shadowMapSize: 4096,
    cascades: 4,
    shadowDistance: 200,
    taa: true,
    antialias: 'taa',
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    contactShadows: true,
    dof: true,
    viewSamples: 4,
    anisotropy: 16,
    textureScale: 1,
    particleBudget: 24000,
    decalBudget: 512,
  },
};

export const DEFAULTS = {
  quality: 'ultra',
  graphicsMode: 'auto',
  targetFps: 'display',
  displayRefreshHz: 120,
  adaptiveQuality: true,
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensScale: 0.65,
  /**
   * How the right mouse button aims: 'hold' (classic) or 'toggle'. Toggle
   * exists for trackpads, where a two-finger click cannot be held while a
   * one-finger click fires. Does not apply to `adsKey`. Persisted by
   * `core/controls.js`.
   */
  adsMode: 'hold',
  /**
   * Optional keyboard bind for ADS, so aiming never needs the pointer at all.
   * Always a toggle — tap to raise the optic, tap again to lower it.
   */
  adsKey: 'KeyX',
  invertY: false,
  exposure: 1.0,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
  /**
   * Don't garrison the level during boot — the `match` subsystem spawns the AI
   * when a match actually starts, so a players-only match has no bots in it.
   * Set by src/boot.js whenever the Match Start view is in play.
   */
  deferGarrison: false,
};

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };
  /**
   * Advanced-settings overrides for keys the RENDER subsystem owns the defaults
   * for (`RenderSystem.settings`). Core must not invent values for those, so it
   * only carries the sparse patch across and lets render merge it.
   * See `src/core/graphics.js`.
   */
  cfg.renderSettings = {};
  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
  };
  return cfg;
}
