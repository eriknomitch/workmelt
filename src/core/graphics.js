/**
 * Advanced graphics options — the schema the settings menu is generated from.
 *
 * The quality PRESETS in `config.js` stay the coarse ladder ("high", "ultra",
 * and what Auto calibration picks). This module is the fine ladder on top of
 * them: a sparse map of per-option OVERRIDES, persisted next to the graphics
 * mode, applied over `config.q` at boot and — where the renderer can take it
 * mid-frame — pushed live while the menu is open.
 *
 * Design rules, so this stays one file rather than thirty scattered branches:
 *
 * 1. **Absent means "follow the preset".** An option with no override writes
 *    nothing. A capture run, a `?q=` run and a fresh profile therefore render
 *    exactly what they rendered before this module existed, which is what keeps
 *    `tools/baseline.mjs` and `tools/goal.mjs` meaningful.
 * 2. **`apply()` only ever writes into `config.q`.** Subsystems keep reading the
 *    preset object they already read; nobody imports this file but `main.js`,
 *    the quality system and the menu.
 * 3. **`renderSetting` options are live.** They name a key in
 *    `RenderSystem.settings`, which is a documented live-tuning surface, so the
 *    menu can move them with the game running and never needs a reload. Their
 *    "preset" value is whatever the renderer itself defaults to — deliberately
 *    NOT duplicated here, so the two can't drift.
 * 4. **Everything else costs a reload.** Passes, render targets, texture bakes
 *    and shader permutations are built once in `init()`. Rebuilding them live is
 *    a much larger change than exposing them, and every shipped engine draws the
 *    same line. Those options carry `restart: true` and the menu says so.
 */

export const GRAPHICS_GROUPS = [
  { id: 'display', label: 'Display', blurb: 'Resolution, scaling and anti-aliasing' },
  { id: 'textures', label: 'Textures & Detail', blurb: 'Surface bake resolution and filtering' },
  { id: 'shading', label: 'Shading & Lighting', blurb: 'Shadows, occlusion and reflections' },
  { id: 'post', label: 'Post-Processing', blurb: 'Everything after the world is drawn' },
  { id: 'visibility', label: 'Visibility', blurb: 'Read the frame, and the people in it' },
];

/** Presentation-only: what the UI writes next to an option it cannot apply live. */
export const RESTART_TAG = 'RESTART';

const AUTO = 'auto';

/** Convenience: `[value, label]` pairs -> `{ value, label }`. */
const vals = (pairs) => pairs.map(([value, label]) => ({ value, label }));

/**
 * The option table. Order inside a group is display order.
 *
 * kind: 'enum'   -> `values`, first entry is always `auto`
 *       'slider' -> `min`/`max`/`step`, and either `renderSetting` (live, value
 *                   read back off the renderer) or `apply` (+ `preset`).
 */
export const GRAPHICS_OPTIONS = [
  // ------------------------------------------------------------- display --
  {
    id: 'renderScale',
    label: 'Resolution Scale',
    group: 'display',
    kind: 'enum',
    restart: false,
    hint: 'Internal render resolution. Above 100% is supersampling: the most reliable sharpness there is, and the one setting that makes a distant enemy resolve at all. Anything but Auto pins the adaptive scaler.',
    values: vals([
      [AUTO, 'Auto'],
      [0.5, '50%'],
      [0.6, '60%'],
      [0.7, '70%'],
      [0.8, '80%'],
      [0.9, '90%'],
      [1, '100%'],
      [1.15, '115%'],
      [1.3, '130%'],
      [1.5, '150% (SSAA)'],
      [1.75, '175% (SSAA)'],
      [2, '200% (SSAA)'],
    ]),
    preset: (q) => q.renderScale ?? 1,
    apply(q, v) {
      q.renderScale = v;
      q.minRenderScale = Math.min(q.minRenderScale ?? 0.5, v);
      q.maxRenderScale = Math.max(q.maxRenderScale ?? 1, v);
      // Read by AdaptiveQualitySystem: a hand-set resolution is not a
      // suggestion, so the adaptive scaler stops moving it.
      q.lockRenderScale = true;
    },
    live(render, v) {
      render.setRenderScaleLimits(Math.min(0.2, v), Math.max(2, v));
      render.setRenderScale(v);
    },
  },
  {
    id: 'maxPixels',
    label: 'Resolution Limit',
    group: 'display',
    kind: 'enum',
    restart: false,
    hint: 'Hard ceiling on how many pixels get drawn, however large the window is. Every other setting here is a fraction of your window, and a window has no upper limit — this is what stops a very large display asking for an internal buffer no GPU budget survives. Counted as area, so an ultrawide is not penalised for being wide.',
    values: vals([
      [AUTO, 'Auto (4K budget)'],
      [2073600, '1080p budget'],
      [3686400, '1440p budget'],
      [8294400, '4K budget'],
      [14745600, '5K budget'],
      [33177600, '8K budget'],
      // Deliberately a large finite number rather than Infinity: this value
      // round-trips through JSON.stringify into localStorage, and Infinity
      // serialises as null, which would silently reset the setting.
      [67108864, 'No limit (64 MP)'],
    ]),
    preset: (q) => q.maxPixels ?? 8294400,
    apply(q, v) {
      q.maxPixels = v;
    },
    live(render, v) {
      render.setPixelBudget(v);
    },
  },
  {
    id: 'pixelRatioCap',
    label: 'Display Sharpness',
    group: 'display',
    kind: 'enum',
    restart: false,
    hint: 'Ceiling on the backbuffer’s device-pixel ratio. Auto stops at 1.5x, which throws away a third of a Retina panel; 2.0x draws every physical pixel.',
    values: vals([
      [AUTO, 'Auto (1.5x cap)'],
      [1, '1.0x'],
      [1.25, '1.25x'],
      [1.5, '1.5x'],
      [1.75, '1.75x'],
      [2, '2.0x (native Retina)'],
      [3, '3.0x'],
    ]),
    preset: (q) => q.pixelRatioCap ?? 1.5,
    apply(q, v) {
      q.pixelRatioCap = v;
    },
    live(render, v) {
      render.setPixelRatioCap(v);
    },
  },
  {
    id: 'antialias',
    label: 'Anti-Aliasing',
    group: 'display',
    kind: 'enum',
    restart: true,
    hint: 'TAA resolves sub-pixel detail across frames and is what the sharpen filter is tuned against; FXAA is a single-frame edge blur; Off is the sharpest and the noisiest.',
    values: vals([
      [AUTO, 'Auto'],
      ['taa', 'TAA (temporal)'],
      ['fxaa', 'FXAA'],
      ['off', 'Off'],
    ]),
    preset: (q) => q.antialias ?? (q.taa ? 'taa' : 'fxaa'),
    apply(q, v) {
      q.antialias = v;
      q.taa = v === 'taa';
    },
  },
  {
    id: 'viewSamples',
    label: 'Weapon MSAA',
    group: 'display',
    kind: 'enum',
    restart: true,
    hint: 'The viewmodel is composited after TAA resolves, so its edges get no temporal filter. MSAA on that one small target is the cheapest fix.',
    values: vals([
      [AUTO, 'Auto'],
      [0, 'Off'],
      [2, '2x'],
      [4, '4x'],
      [8, '8x'],
    ]),
    preset: (q) => q.viewSamples ?? 4,
    apply(q, v) {
      q.viewSamples = v;
    },
  },

  // ------------------------------------------------------------ textures --
  {
    id: 'textureScale',
    label: 'Texture Quality',
    group: 'textures',
    kind: 'enum',
    restart: true,
    hint: 'Resolution every world surface is baked at. Ultra doubles it — and doubles texture memory with it (~290 MB becomes ~1.1 GB), so it is for a discrete GPU only.',
    values: vals([
      [AUTO, 'Auto'],
      [0.5, 'Low (512)'],
      [0.75, 'Medium (768)'],
      [1, 'High (1024)'],
      [2, 'Ultra (2048, high VRAM)'],
    ]),
    preset: (q) => q.textureScale ?? 1,
    apply(q, v) {
      q.textureScale = v;
    },
  },
  {
    id: 'anisotropy',
    label: 'Anisotropic Filter',
    group: 'textures',
    kind: 'enum',
    restart: true,
    hint: 'Sharpness of ground and wall texture at a grazing angle. Nearly free on any GPU made this decade.',
    values: vals([
      [AUTO, 'Auto'],
      [1, 'Off'],
      [2, '2x'],
      [4, '4x'],
      [8, '8x'],
      [16, '16x'],
    ]),
    preset: (q) => q.anisotropy ?? 8,
    apply(q, v) {
      q.anisotropy = v;
    },
  },
  {
    id: 'parallaxScale',
    label: 'Parallax Occlusion',
    group: 'textures',
    kind: 'enum',
    restart: true,
    hint: 'Per-pixel depth on brick, mortar and tread plate. The single most expensive thing in the surface shader (~17 of its 32 texture fetches), and the reason walls have relief instead of a printed normal map.',
    values: vals([
      [AUTO, 'Auto'],
      [0, 'Off'],
      [0.5, 'Low'],
      [1, 'Normal'],
      [1.6, 'High'],
    ]),
    preset: (q) => q.parallaxScale ?? 1,
    apply(q, v) {
      q.parallaxScale = v;
    },
  },
  {
    id: 'detailScale',
    label: 'Micro Detail',
    group: 'textures',
    kind: 'enum',
    restart: true,
    hint: 'Strength and range of the shared sub-millimetre detail layer — the tooth that stops a surface going flat grey at 0.5 m.',
    values: vals([
      [AUTO, 'Auto'],
      [0, 'Off'],
      [0.6, 'Low'],
      [1, 'Normal'],
      [1.4, 'High'],
    ]),
    preset: (q) => q.detailScale ?? 1,
    apply(q, v) {
      q.detailScale = v;
    },
  },
  {
    id: 'particleBudget',
    label: 'Particle Budget',
    group: 'textures',
    kind: 'enum',
    restart: true,
    hint: 'Hard cap on live particles. Impact debris, smoke and shell density scale with it.',
    values: vals([
      [AUTO, 'Auto'],
      [1000, 'Very Low (1k)'],
      [2000, 'Low (2k)'],
      [6000, 'Medium (6k)'],
      [12000, 'High (12k)'],
      [24000, 'Ultra (24k)'],
      [48000, 'Extreme (48k)'],
    ]),
    preset: (q) => q.particleBudget ?? 12000,
    apply(q, v) {
      q.particleBudget = v;
    },
  },
  {
    id: 'decalBudget',
    label: 'Decal Budget',
    group: 'textures',
    kind: 'enum',
    restart: true,
    hint: 'How many bullet holes and scorch marks persist before the oldest is recycled.',
    values: vals([
      [AUTO, 'Auto'],
      [32, 'Very Low (32)'],
      [64, 'Low (64)'],
      [128, 'Medium (128)'],
      [256, 'High (256)'],
      [512, 'Ultra (512)'],
      [1024, 'Extreme (1024)'],
    ]),
    preset: (q) => q.decalBudget ?? 256,
    apply(q, v) {
      q.decalBudget = v;
    },
  },

  // ------------------------------------------------------------- shading --
  {
    id: 'shadowQuality',
    label: 'Shadow Quality',
    group: 'shading',
    kind: 'enum',
    restart: true,
    hint: 'Cascade count, shadow map resolution and filter width in one knob.',
    values: vals([
      [AUTO, 'Auto'],
      ['off', 'Off'],
      ['low', 'Low (1k, 3 cascades)'],
      ['medium', 'Medium (2k, 3 cascades)'],
      ['high', 'High (2k, 4 cascades)'],
      ['ultra', 'Ultra (4k, 4 cascades)'],
      ['extreme', 'Extreme (8k, 4 cascades)'],
    ]),
    preset: (q) =>
      q.shadows === false
        ? 'off'
        : q.shadowMapSize >= 8192
          ? 'extreme'
          : q.shadowMapSize >= 4096
            ? 'ultra'
            : q.cascades >= 4
              ? 'high'
              : q.shadowMapSize >= 2048
                ? 'medium'
                : 'low',
    apply(q, v) {
      if (v === 'off') {
        q.shadows = false;
        q.shadowQuality = -1;
        return;
      }
      q.shadows = true;
      const table = {
        low: [1024, 3, 0],
        medium: [2048, 3, 1],
        high: [2048, 4, 2],
        ultra: [4096, 4, 3],
        extreme: [8192, 4, 3],
      };
      const [size, cascades, quality] = table[v] ?? table.high;
      q.shadowMapSize = size;
      q.cascades = cascades;
      q.shadowQuality = quality;
    },
  },
  {
    id: 'shadowDistance',
    label: 'Shadow Distance',
    group: 'shading',
    kind: 'enum',
    restart: true,
    hint: 'How far the cascades reach. Longer costs cascade texel density, not draw calls.',
    values: vals([
      [AUTO, 'Auto'],
      [30, '30 m'],
      [60, '60 m'],
      [90, '90 m'],
      [140, '140 m'],
      [200, '200 m'],
      [300, '300 m'],
    ]),
    preset: (q) => q.shadowDistance ?? 140,
    apply(q, v) {
      q.shadowDistance = v;
    },
  },
  {
    id: 'shadowStrength',
    label: 'Shadow Density',
    group: 'shading',
    kind: 'slider',
    min: 0,
    max: 1.5,
    step: 0.05,
    renderSetting: 'shadowStrength',
    hint: 'How dark a sun shadow gets. Below 1.0 lifts everything hiding in one.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'gtao',
    label: 'Ambient Occlusion',
    group: 'shading',
    kind: 'enum',
    restart: true,
    hint: 'Horizon-arc AO, temporally accumulated. It is what puts objects on the ground rather than in front of it.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On (GTAO)'],
    ]),
    preset: (q) => !!q.gtao,
    apply(q, v) {
      q.gtao = v;
    },
  },
  {
    id: 'aoIntensity',
    label: 'AO Intensity',
    group: 'shading',
    kind: 'slider',
    min: 0,
    max: 2,
    step: 0.05,
    renderSetting: 'aoIntensity',
    hint: 'Occlusion is a shaping tool. Past ~1.4 it stops shaping corners and starts filling them in.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'contactShadows',
    label: 'Contact Shadows',
    group: 'shading',
    kind: 'enum',
    restart: true,
    hint: 'A short screen-space ray toward the sun, covering the 0–40 cm gap a cascade texel cannot see.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On'],
    ]),
    preset: (q) => q.contactShadows !== false,
    apply(q, v) {
      q.contactShadows = v;
    },
  },
  {
    id: 'ssr',
    label: 'Screen-Space Reflections',
    group: 'shading',
    kind: 'enum',
    restart: true,
    hint: 'Marched against depth and coloured from the previous frame. Wet asphalt, glass and painted metal only.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On'],
    ]),
    preset: (q) => !!q.ssr,
    apply(q, v) {
      q.ssr = v;
    },
  },
  {
    id: 'volumetrics',
    label: 'Volumetric Lighting',
    group: 'shading',
    kind: 'enum',
    restart: true,
    hint: 'God rays and in-scattered fog. Also the most expensive single pass in a dusty street.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On'],
    ]),
    preset: (q) => !!q.volumetrics,
    apply(q, v) {
      q.volumetrics = v;
    },
  },

  // ---------------------------------------------------------------- post --
  {
    id: 'bloom',
    label: 'Bloom',
    group: 'post',
    kind: 'enum',
    restart: true,
    hint: 'Additive, soft-knee thresholded above display white: the sun disc, glints, tracers and muzzle flash.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On'],
    ]),
    preset: (q) => !!q.bloom,
    apply(q, v) {
      q.bloom = v;
    },
  },
  {
    id: 'bloomStrength',
    label: 'Bloom Strength',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 0.5,
    step: 0.01,
    renderSetting: 'bloomStrength',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'bloomThreshold',
    label: 'Bloom Threshold',
    group: 'post',
    kind: 'slider',
    min: 0.5,
    max: 3,
    step: 0.05,
    renderSetting: 'bloomThreshold',
    hint: 'In exposure-scaled linear light. Drop this below ~1.5 and daylight sky enters the pyramid, which smears every silhouette standing in front of it.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'motionBlur',
    label: 'Motion Blur',
    group: 'post',
    kind: 'enum',
    restart: true,
    hint: 'Velocity-tile reconstruction. Off is the competitive choice; it is also one fewer full-screen pass.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On'],
    ]),
    preset: (q) => !!q.motionBlur,
    apply(q, v) {
      q.motionBlur = v;
    },
  },
  {
    id: 'shutter',
    label: 'Motion Blur Amount',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.02,
    renderSetting: 'shutter',
    hint: 'Shutter angle, as a fraction of the frame interval.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'dof',
    label: 'ADS Depth Of Field',
    group: 'post',
    kind: 'enum',
    restart: true,
    hint: 'Only ever runs while the sights are up. Off keeps everything past the optic pin sharp.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Off'],
      [true, 'On'],
    ]),
    preset: (q) => q.dof !== false,
    apply(q, v) {
      q.dof = v;
    },
  },
  {
    id: 'dofMaxCoc',
    label: 'DOF Blur Radius',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 8,
    step: 0.1,
    renderSetting: 'dofMaxCoc',
    hint: 'Pixels at 1080p. Large values hide the very thing the sights are pointed at.',
    format: (v) => v.toFixed(1),
  },
  {
    id: 'dofPeripheral',
    label: 'DOF Periphery',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    renderSetting: 'dofPeripheral',
    hint: 'How far the frame edges soften while scoped, as a fraction of the blur radius. The sight picture itself always stays in focus. 0 keeps the whole frame sharp except for what is genuinely off the focal plane.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'sharpen',
    label: 'Sharpening',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.02,
    renderSetting: 'sharpen',
    hint: 'Post-TAA contrast-adaptive sharpen. Only active with TAA on — it exists to buy back what temporal resolve softens.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'grain',
    label: 'Film Grain',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 0.05,
    step: 0.002,
    renderSetting: 'grain',
    hint: 'Applied in display space. Zero is a legitimate competitive choice.',
    format: (v) => v.toFixed(3),
  },
  {
    id: 'chromatic',
    label: 'Chromatic Aberration',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 0.004,
    step: 0.0001,
    renderSetting: 'chromatic',
    hint: 'Lateral R/B split at the frame edge, in UV. The sharpen filter turns anything above ~0.002 into visible fringing.',
    format: (v) => v.toFixed(4),
  },
  {
    id: 'vignette',
    label: 'Vignette',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 0.8,
    step: 0.02,
    renderSetting: 'vignette',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'adsVignette',
    label: 'ADS Vignette',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 0.8,
    step: 0.02,
    renderSetting: 'adsVignette',
    hint: 'Closes in while the sights are up, so the frame tells you your eye is behind a tube.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'lutStrength',
    label: 'Colour Grade',
    group: 'post',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    renderSetting: 'lutStrength',
    hint: 'Blend of the display-referred grade LUT. Zero is the raw AgX tone map: flatter, and slightly easier to pick a figure out of.',
    format: (v) => v.toFixed(2),
  },

  // ---------------------------------------------------------- visibility --
  {
    id: 'brightness',
    label: 'Brightness',
    group: 'visibility',
    kind: 'slider',
    min: -2,
    max: 2,
    step: 0.05,
    renderSetting: 'exposureBias',
    // The renderer stores EV where positive is DARKER. Nobody has ever shipped a
    // brightness slider that works that way.
    toSetting: (v) => -v,
    toUi: (v) => -v,
    hint: 'Exposure offset in stops. +1 EV is one stop brighter.',
    format: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
  {
    id: 'autoExposure',
    label: 'Auto Exposure',
    group: 'visibility',
    kind: 'enum',
    restart: false,
    hint: 'Metered off the frame’s own log-luminance. Off locks exposure, so walking into shade no longer re-brightens the shade — and no longer blows out the doorway you came through.',
    values: vals([
      [AUTO, 'Auto'],
      [false, 'Locked'],
      [true, 'On'],
    ]),
    preset: (q) => q.autoExposure !== false,
    apply(q, v) {
      q.autoExposure = v;
    },
    live(render, v) {
      render.settings.autoExposure = v;
      render.applySettings();
    },
  },
  {
    id: 'exposureKey',
    label: 'Exposure Key',
    group: 'visibility',
    kind: 'slider',
    min: 0.5,
    max: 2,
    step: 0.02,
    renderSetting: 'exposureKey',
    hint: 'Where the meter puts middle grey. Higher is a brighter overall image without touching the tone curve.',
    format: (v) => v.toFixed(2),
  },
  {
    id: 'ambientFill',
    label: 'Shadow Lift',
    group: 'visibility',
    kind: 'slider',
    min: 0.25,
    max: 4,
    step: 0.05,
    hint: 'Multiplier on every indirect term at once — sky fill, ground bounce, IBL diffuse and the interior floor. This is the setting for "there is someone in that doorway and I cannot see him". Above ~2x the key-to-fill ratio collapses and the frame stops looking sunlit.',
    format: (v) => `${v.toFixed(2)}x`,
    preset: (q) => q.ambientFill ?? 1,
    apply(q, v) {
      q.ambientFill = v;
    },
    live(render, v) {
      render.setAmbientFill(v);
    },
  },
  {
    id: 'practicalGain',
    label: 'Lamp Brightness',
    group: 'visibility',
    kind: 'slider',
    min: 0,
    max: 2,
    step: 0.05,
    renderSetting: 'practicalGain',
    hint: 'Global trim on room and street practicals. They are the only light in a closed room, so this is the interior-vs-exterior balance.',
    format: (v) => `${v.toFixed(2)}x`,
  },
  {
    id: 'fovSlider',
    label: 'Field Of View',
    group: 'visibility',
    kind: 'slider',
    min: 65,
    max: 130,
    step: 1,
    hint: 'Vertical FOV. Wider sees more and resolves each of it smaller.',
    format: (v) => `${v | 0}°`,
    preset: (q, cfg) => cfg?.fov ?? 80,
    apply(q, v, cfg) {
      if (cfg) cfg.fov = v;
    },
    live(render, v, ctx) {
      ctx.config.fov = v;
      const cam = ctx.camera;
      if (cam) {
        cam.fov = v;
        cam.updateProjectionMatrix();
      }
      ctx.events?.emit('ui:fov', { value: v });
    },
  },
];

export const GRAPHICS_OPTIONS_BY_ID = Object.fromEntries(GRAPHICS_OPTIONS.map((o) => [o.id, o]));

/** Options in a group, in declaration order. */
export function optionsInGroup(groupId) {
  return GRAPHICS_OPTIONS.filter((o) => o.group === groupId);
}

/** True when a change to `id` cannot take effect until the page reloads. */
export function needsRestart(id) {
  const opt = GRAPHICS_OPTIONS_BY_ID[id];
  if (!opt) return false;
  if (opt.restart === true) return true;
  return !opt.renderSetting && !opt.live;
}

/**
 * Drop anything we do not recognise. Persisted settings outlive the schema —
 * an override for a removed option, or a value no longer offered, must not
 * survive into `config.q` where a subsystem would read it as gospel.
 */
export function sanitizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw)) {
    const opt = GRAPHICS_OPTIONS_BY_ID[id];
    if (!opt) continue;
    if (opt.kind === 'enum') {
      if (value === AUTO) continue;
      if (opt.values.some((v) => v.value === value)) out[id] = value;
    } else if (opt.kind === 'slider') {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      out[id] = Math.min(opt.max, Math.max(opt.min, n));
    }
  }
  return out;
}

/**
 * Fold the overrides into a config produced by `createConfig`.
 *
 * `config.q` is mutated in place (subsystems already hold a reference to it by
 * the time this could ever run twice), and the render-settings overrides are
 * parked on `config.renderSettings` for `RenderSystem.init` to merge — it owns
 * the defaults for those, so core must not invent them.
 *
 * @returns {{ q: object, renderSettings: object, applied: string[] }}
 */
export function applyGraphicsOverrides(config, overrides) {
  const clean = sanitizeOverrides(overrides);
  const q = config.q;
  const renderSettings = config.renderSettings ?? (config.renderSettings = {});
  const applied = [];
  for (const opt of GRAPHICS_OPTIONS) {
    const value = clean[opt.id];
    if (value === undefined) continue;
    applied.push(opt.id);
    if (opt.renderSetting) {
      renderSettings[opt.renderSetting] = opt.toSetting ? opt.toSetting(value) : value;
      continue;
    }
    opt.apply?.(q, value, config);
  }
  return { q, renderSettings, applied };
}

/**
 * What an option currently reads as, for the menu.
 *
 * Order of truth: an explicit override, else the live renderer value (for the
 * live-tuning sliders, which is why they are not duplicated in this file), else
 * whatever the preset derives.
 */
export function resolveOptionValue(opt, { overrides = {}, q = {}, config = null, render = null } = {}) {
  const override = overrides[opt.id];
  if (override !== undefined) return { value: override, source: 'user' };
  if (opt.renderSetting && render?.settings) {
    const raw = render.settings[opt.renderSetting];
    if (raw !== undefined)
      return { value: opt.toUi ? opt.toUi(raw) : raw, source: 'preset' };
  }
  if (opt.preset) return { value: opt.preset(q, config), source: 'preset' };
  return { value: opt.kind === 'enum' ? AUTO : opt.min, source: 'preset' };
}

/**
 * Push one option's value at the running game. Returns true when it landed;
 * false means the caller has to tell the player it needs a restart.
 */
export function applyOptionLive(opt, value, ctx) {
  const render = ctx?.peek?.('render') ?? ctx?.get?.('render');
  if (!render) return false;
  try {
    if (opt.renderSetting) {
      render.settings[opt.renderSetting] = opt.toSetting ? opt.toSetting(value) : value;
      render.applySettings?.();
      return true;
    }
    if (opt.live) {
      opt.live(render, value, ctx);
      return true;
    }
  } catch (err) {
    console.warn(`[graphics] live apply failed for "${opt.id}"`, err);
    return false;
  }
  return false;
}

export { AUTO as GRAPHICS_AUTO };
