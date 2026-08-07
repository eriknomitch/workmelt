import * as THREE from 'three';

import { blit, hdrTarget } from './fullscreen.js';
import {
  ATMO,
  SCENE_LUX,
  SUN_ILLUMINANCE_TOP,
  MOON_ILLUMINANCE_NIGHT,
  transmittanceToSpace,
} from './atmosphere.js';
import { SkyLuts } from './luts.js';
import { SkyDome } from './dome.js';
import { Volumetrics } from './volumetrics.js';
import { Celestial } from './celestial.js';
import { cloudSunOcclusion } from './clouds.js';

/**
 * Floor on the beam's *luminous* transmittance, as a fraction of unity — see
 * the beam-floor note in `_updateCelestial`. 0.35 puts a 4-degree sun about a
 * stop of luminance under a noon sun (whose luminous transmittance is 0.77)
 * while leaving its physical hue untouched, which is what keeps a golden hour
 * reading as a key light instead of as an ambient wash.
 */
const SUN_LUM_FLOOR = 0.35;

/**
 * Gain on the sun's DIRECTIONAL LIGHT only — not on the irradiance the
 * atmosphere scatters, and not on the sky.
 *
 * The photometric chain in atmosphere.js is right, and it predicts a sunlit
 * stucco wall at ~0.32 radiance units. The level's albedos are darker than that
 * assumption: measured off the 16:30 frame a facade in full sun comes back at
 * 0.144, which is 1.1 stops under the model, while the clear sky at 30 degrees
 * of elevation lands exactly where the model says (0.17 against a predicted
 * 0.16-0.24). The result is a frame whose sky is BRIGHTER than the surfaces the
 * sun is lighting, and a key:fill ratio of 3.3 stops where a real sunlit street
 * runs 4-5.
 *
 * Correcting it in the albedos is the right fix and belongs to src/materials.
 * Until then this is the one place the deficit can be paid, and paying it here
 * is at least honest: it moves the key and nothing else, so the sky, the
 * scattering, the aureole and the discs stay on the physical scale, and
 * autoexposure absorbs the level change so what actually moves is the ratio.
 */
const SUN_KEY_GAIN = 1.55;

/**
 * Whole-sky diffuse illuminance as a fraction of the beam. Real clear-sky
 * daylight runs 12-18% of the direct component; this is the CPU stand-in the
 * renderer scales its sky-fill band off (see `ambientColor`).
 */
const SKY_AMBIENT_FRACTION = 0.15;

/** Cool night hue for the published ambient — moonlight after the Purkinje shift. */
const NIGHT_AMBIENT_HUE = [0.35, 0.5, 1.0];

/**
 * WORKMELT sky, atmosphere and global lighting.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS OWNS
 * ---------------------------------------------------------------------------
 *   - A Hillaire/Bruneton atmosphere (Rayleigh + Mie + ozone + multiple
 *     scattering) evaluated through three LUTs, drawn as a full-screen dome
 *     with a limb-darkened solar disc and an analytic circumsolar aureole that
 *     restores the Mie forward peak the LUT resolution destroys.
 *                                                               dome.js luts.js
 *   - Sun and moon positions from real spherical astronomy.       celestial.js
 *   - A starfield with a magnitude power law, blackbody colours, airmass
 *     extinction, scintillation, and a Milky Way with dust lanes.     stars.js
 *   - Two procedural cloud decks, self-shadowed and correctly lit.   clouds.js
 *   - Raymarched volumetric fog with shadow-mapped light shafts, plus
 *     analytic aerial perspective on all geometry.                volumetrics.js
 *   - A PMREM environment map regenerated from the sky whenever the sun moves
 *     meaningfully, published through `render.setEnvMap`.
 *   - The sun/moon `DirectionalLight`s the renderer's cascades follow.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC API — `const sky = ctx.get('sky')`
 * ---------------------------------------------------------------------------
 *   sky.setTimeOfDay(hours)      0..24, local solar time. Rebakes everything.
 *   sky.timeOfDay                current hour
 *   sky.setTimeRate(hoursPerSec) animate the sun (0 = frozen; default 0)
 *   sky.applyEnvironment(env)    { hour, weather, exposureBias } — the sky a
 *                                MAP is set under, or `null` for the defaults
 *                                this system booted with. `world` calls it on
 *                                every level build; see src/world/maps.js.
 *   sky.sunDirection             Vector3 pointing AT the sun   (read only)
 *   sky.moonDirection            Vector3 pointing AT the moon  (read only)
 *   sky.sunAltitude              radians above the horizon
 *   sky.keyLight                 whichever of sun/moon the cascades follow
 *   sky.sunLight  sky.moonLight  THREE.DirectionalLight
 *   sky.envMap                   the PMREM currently published
 *   sky.ambientColor             Color, approximate whole-sky tint AND level:
 *                                the sky's own model of whole-sky irradiance
 *                                (15% of the beam by day, moonlit at night).
 *                                The renderer scales its sky-fill band off it.
 *   sky.indirectScale            indirect-light budget for the current sun
 *                                elevation: ~0.45 at golden hour, 1 by day, 2.2
 *                                after dark. See _updateCelestial. `render`
 *                                multiplies its IBL diffuse budget by this.
 *   sky.exposureBias             EV of metering compensation for this sun
 *                                elevation, plus whatever the active map's
 *                                environment asks for (+ is darker). `render`
 *                                adds it to settings.exposureBias.
 *   sky.cloudShadowAt(x, z)      0..1 direct sunlight reaching a ground point
 *   sky.setWeather({ ... })      coverage, cirrus, turbidity, fogDensity,
 *                                fogHeight, windSpeed, windAngle, shaftGain
 *   sky.fog                      live fog tuning object (see _fog below)
 *
 * Events emitted on `ctx.events`:
 *   `sky:changed`  { hour, sunDir, sunIntensity, moonIntensity }  time changed
 *   `sky:env`      { envMap, sunDir }                             IBL rebaked
 *
 * ---------------------------------------------------------------------------
 * COST
 * ---------------------------------------------------------------------------
 * Measured at 1920x1080, ultra, headless ANGLE/Metal on an Apple silicon laptop, in a scene
 * of ~7M triangles and ~1300 draw calls:
 *
 *   whole frame with the sky and volumetrics   10.1 - 11.8 ms
 *   sky dome only, volumetrics off             ~0.9 ms of that
 *   volumetric chain (56 steps @ half res)     ~1.5 ms of that
 *
 * The LUTs, the ambient probe and the PMREM only run when the sun has moved
 * more than 0.35 degrees, so a frozen time of day pays none of that. With
 * `setTimeRate` running, the sky-view LUT rebakes a few times a second
 * (~0.6 ms) and the PMREM at most every 250 ms.
 */
export class SkySystem {
  static id = 'sky';
  static deps = ['render', 'materials'];

  async init(ctx) {
    this.ctx = ctx;
    const r = ctx.get('render');
    this.render = r;
    this.renderer = r.renderer;
    const q = ctx.config.q;

    this.celestial = new Celestial();
    this.hour = 16.5;
    this.timeRate = 0;

    // ---- weather / atmosphere state ---------------------------------------
    this.weather = {
      /** Aerosol multiplier. 1 clear, 2-3 hazy, 5 dust storm. */
      turbidity: 1.35,
      /** Fewer, deeper cumulus. Below ~0.34 the deck breaks into discrete
       *  masses with clean blue between them instead of one lumpy sheet. */
      cloudCoverage: 0.30,
      /** Raised with the coverage drop: a cloud that survives the erosion is
       *  now optically deep, so its self-shadowed base sits 2-3 stops under its
       *  sunlit top and the billow reads as a solid with volume. */
      cloudDensity: 1.9,
      /**
       * Cirrus is banded, not a glaze. Coverage and opacity both came down here
       * because the sky behind them is now 1.65 stops darker (see the photometric
       * note in atmosphere.js) while the decks, which were always on the correct
       * scale, did not move — so the layer gained that much contrast against the
       * blue for free and at the old settings it dominated the upper half of every
       * daylight frame and read as hatching.
       */
      cirrusCoverage: 0.21,
      cirrusOpacity: 0.30,
      windSpeed: 0.0042, // km/s at the cloud deck (~4 m/s)
      windAngle: 0.7,
      horizonMurk: 0.13,
    };

    /**
     * Ground fog. `scatter` and `extinction` are intentionally independent —
     * see the header of volumetrics.js for why no single density can give both
     * readable interior shafts and a clean 200 m street.
     */
    this._fog = {
      /**
       * Aerial perspective, 40% lighter than it was.
       *
       * The test is not "can I see haze", it is "does a facade at 60 m still
       * have its own local contrast and its own hue". At 2.4e-3 it did not: the
       * transmittance to 60 m along a street was 0.86 and the in-scatter filled
       * the remaining 14% with a single neutral value, so plaster, shadow and
       * sky all converged inside a few code values and the terminating arch went
       * ghost. At 1.45e-3 the same 60 m keeps ~92% of the surface's own light,
       * and what the haze adds is now hue-split (see skFogAmbient in
       * volumetrics.js) rather than grey — distance reads as colour temperature,
       * which is how it reads in a photograph.
       */
      scatter: 3.6e-3, // 1/m at the fog base
      extinction: 1.45e-3, // 1/m at the fog base
      /**
       * 18 m of e-folding, not 30. Dust and exhaust settle: the bottom of a
       * street is measurably hazier than roof height, and that vertical
       * gradient is most of what makes a long street read as deep rather than
       * as uniformly foggy. It also keeps the sky slot between buildings clear.
       */
      heightScale: 18.0,
      baseY: -2.0,
      maxDistance: 900.0,
      /**
       * Inscatter gain on the key light. Above 1 this is not physical, and it
       * is the one knob here that is not: a shaft only reads on screen when its
       * radiance is within a stop or two of the surfaces around it, and at a
       * density low enough to keep a 200 m street clear the honest single
       * scattering term lands two decades below that. Every shipping engine
       * exposes this same multiplier. The alternative is either invisible
       * shafts or milk.
       *
       * It applies to the *anisotropic excess* of the phase function only — see
       * skFogInscatterPhase in volumetrics.js. Scaling the whole phase function
       * scales its 1/4pi floor too, and that floor is not a shaft, it is a veil
       * over every pixel of the frame.
       */
      shaftGain: 2.6,
      /** Kept well under the key gain: the shafts are all contrast, and a
       *  strong ambient term is exactly what washes that contrast out. */
      ambientGain: 0.22,
      noise: 0.55,
      noiseScale: 0.045,
      phaseForward: 0.76,
      phaseBackward: -0.36,
      phaseBackWeight: 0.34,
      /** Blue-biased so distant geometry loses red first, as Rayleigh does. */
      extinctionTint: new THREE.Vector3(0.94, 1.02, 1.24),
    };

    // ---- shared uniform objects -------------------------------------------
    // Every pass and the dome reference these same objects, so one write per
    // frame updates the entire subsystem. Same trick render/materialpatch uses.
    const viewR = ATMO.groundRadiusMM + ATMO.viewAltitudeMM;
    this.shared = {
      uMieScale: { value: this.weather.turbidity },
      uViewPos: { value: new THREE.Vector3(0, viewR, 0) },

      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunIrradiance: { value: new THREE.Vector3() },
      uMoonIrradiance: { value: new THREE.Vector3() },
      uSunDiscRadiance: { value: new THREE.Vector3() },
      uMoonDiscRadiance: { value: new THREE.Vector3() },
      uSunAltitude: { value: 0 },
      uMoonAltitude: { value: 0 },
      uMoonRelAz: { value: 0 },
      // x/y are the true angular radii of the sun and moon; z/w scale them up for
      // readability. 3.0 puts the solar disc at 1.6 degrees across — a 22 pixel
      // dot in a 75-degree frame, which is the smallest that still reads as a disc
      // rather than as a hot pixel once the bloom prefilter has clamped it.
      // skSunDisc divides by z*z so enlarging it adds no energy.
      uDisc: { value: new THREE.Vector4(0.004654, 0.004516, 3.0, 4.2) },
      // Lower hemisphere of the IBL. This town is sand and lime plaster, not
      // asphalt: a 0.32 warm albedo is both correct for the setting and the
      // only warm fill a shaded alley gets once the sun is off it.
      uGroundAlbedo: { value: new THREE.Vector3(0.33, 0.29, 0.225) },
      uHorizonMurk: { value: this.weather.horizonMurk },
      // Sky highlight roll-off: knee in scene radiance, overshoot room above it.
      // Driven off the beam luminance every time the sun moves — see skRolloff.
      uSkyRolloff: { value: new THREE.Vector2(0.30, 1.5) },

      uStarParams: { value: new THREE.Vector4(0, 0.5, 0, 0) },
      uCelestial: { value: new THREE.Matrix3() },

      uCloudParams: {
        value: new THREE.Vector4(
          this.weather.cloudCoverage,
          this.weather.cloudDensity,
          1,
          0
        ),
      },
      uCloudParams2: {
        value: new THREE.Vector4(
          this.weather.cirrusCoverage,
          this.weather.cirrusOpacity,
          0.004,
          0.0016
        ),
      },

      // volumetric / camera
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector4() },
      uFog2: { value: new THREE.Vector4() },
      uFogExt: { value: new THREE.Vector3() },
      uPhase: { value: new THREE.Vector4() },
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
      uKeyIrr: { value: new THREE.Vector3() },
      uFogDrift: { value: new THREE.Vector3() },
    };

    // ---- LUTs -------------------------------------------------------------
    this.luts = new SkyLuts(this.renderer, this.shared);
    this.luts.bakeStatic();

    // ---- visible sky ------------------------------------------------------
    this.dome = new SkyDome(this.shared);
    ctx.scene.add(this.dome.mesh);
    // We paint the sky ourselves; drop the renderer's fallback background so it
    // is not drawn underneath us every frame for nothing.
    ctx.scene.background = null;

    // ---- lights -----------------------------------------------------------
    // The renderer takes over shadowing for whichever directional light is
    // brightest (see render/index.js _syncSun), so castShadow stays off: its
    // cascades beat three's single shadow frustum by a mile.
    this.sunLight = new THREE.DirectionalLight(0xffffff, 4.0);
    this.sunLight.name = 'sky-sun';
    this.sunLight.castShadow = false;
    this.sunLight.target.name = 'sky-sun-target';
    ctx.scene.add(this.sunLight, this.sunLight.target);
    r.addLight(this.sunLight, { range: 1e9, priority: 10 });

    this.moonLight = new THREE.DirectionalLight(0x9fc0ff, 0.0);
    this.moonLight.name = 'sky-moon';
    this.moonLight.castShadow = false;
    ctx.scene.add(this.moonLight, this.moonLight.target);
    r.addLight(this.moonLight, { range: 1e9, priority: 9 });

    this.keyLight = this.sunLight;

    // ---- IBL --------------------------------------------------------------
    // 512x256 equirect -> PMREM at cube size 128, which is what three's own
    // equirect environments use. Baked from the *same* shader and the *same*
    // uniform objects as the visible sky, so the IBL can never disagree with it.
    this.envEquirect = hdrTarget(512, 256, { name: 'sky-equirect' });
    this.envEquirect.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this._pmremTarget = null;
    this.envMap = null;

    // ---- volumetrics ------------------------------------------------------
    const steps = q.volumetrics ? (ctx.config.quality === 'ultra' ? 56 : q.ssr ? 44 : 28) : 0;
    this.volumetrics = new Volumetrics(this.shared, r, {
      volumetrics: q.volumetrics,
      steps: Math.max(8, steps),
      scale: 0.5,
    });
    this._unregisterPass = r.registerPass(this.volumetrics);

    // ---- bookkeeping ------------------------------------------------------
    this.ambientColor = new THREE.Color(0, 0, 0);
    /** Indirect-light budget for this sun elevation, 0..1. See _updateCelestial. */
    this.indirectScale = 1;
    /** EV of exposure compensation for this sun elevation; + is darker. */
    this.exposureBias = 0;
    this._beamGain = 1;
    this._beamLuminance = 0;
    this._sunT = [0, 0, 0];
    this._moonT = [0, 0, 0];
    this._envSunDir = new THREE.Vector3(0, -1, 0);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._cloudOcclusion = 1;
    this._cloudOccTarget = 1;
    this._baseSunIntensity = 0;
    this._envAge = 1e9;
    this._skyDirty = true;
    this._envDirty = true;
    this._cloudTime = 0;
    this._occParams = { coverage: 0, density: 0, windX: 0, windZ: 0, time: 0 };

    /**
     * The sky the game boots on, captured from the authored state above rather
     * than restated as a literal, so it can never drift from it. A map that
     * carries an `environment` is applied over this, and dropping that map puts
     * it back — see `applyEnvironment`. The three fog fields are the ones
     * `setWeather` understands; `fogDensity` is a multiplier on the authored
     * fog, so 1 is the identity.
     */
    this._defaultEnvironment = {
      hour: this.hour,
      weather: {
        ...this.weather,
        fogDensity: 1,
        fogHeight: this._fog.heightScale,
        shaftGain: this._fog.shaftGain,
      },
    };
    /** The map environment currently applied, or null for the defaults. */
    this._environment = null;
    /** EV the active map adds to this system's own metering compensation. */
    this._envExposureBias = 0;
    this._envMoonlight = 1;

    this._applyWeather();
    this._applyFog();
    this.setTimeOfDay(this.hour);

    console.info(
      `[sky] atmosphere ready · lat ${this.celestial.site.latitudeDeg} · ` +
        `vol ${q.volumetrics ? steps + ' steps @1/2' : 'analytic'} · ` +
        `1 unit = ${SCENE_LUX} lx`
    );
  }

  // =========================================================================
  //  public API
  // =========================================================================

  get timeOfDay() {
    return this.hour;
  }
  get sunDirection() {
    return this.celestial.sun;
  }
  get moonDirection() {
    return this.celestial.moon;
  }
  get sunAltitude() {
    return this.celestial.sunAlt;
  }
  get fog() {
    return this._fog;
  }

  /** Hour of day, 0..24 local solar time. Rebakes the sky and the IBL. */
  setTimeOfDay(hours) {
    this.hour = ((hours % 24) + 24) % 24;
    this._skyDirty = true;
    this._envDirty = true;
    this._updateCelestial();
    this._bakeSky();
    this._bakeEnv();
    this.volumetrics.reset();
    this.ctx.events.emit('sky:changed', {
      hour: this.hour,
      sunDir: this.celestial.sun,
      sunIntensity: this.sunLight.intensity,
      moonIntensity: this.moonLight.intensity,
    });
    if (this.ctx.config.deterministic === true) {
      const c = this.celestial;
      const sc = this.sunLight.color;
      console.info(
        `[sky] t=${this.hour.toFixed(2)} sunAlt=${((c.sunAlt * 180) / Math.PI).toFixed(1)} ` +
          `sunI=${this.sunLight.intensity.toFixed(3)} sunCol=${sc.r.toFixed(2)},${sc.g.toFixed(2)},${sc.b.toFixed(2)} ` +
          `moonI=${this.moonLight.intensity.toFixed(4)} beamLum=${(this._beamLuminance ?? 0).toFixed(3)} ` +
          `amb=${this.ambientColor.r.toFixed(3)},${this.ambientColor.g.toFixed(3)},${this.ambientColor.b.toFixed(3)} ` +
          `indirect=${this.indirectScale.toFixed(2)} evBias=${this.exposureBias.toFixed(2)} ` +
          `knee=${this.shared.uSkyRolloff.value.x.toFixed(3)}`
      );
    }
    return this;
  }

  /** Hours of sky time per second of wall clock. 0 freezes the sun. */
  setTimeRate(hoursPerSecond) {
    this.timeRate = hoursPerSecond || 0;
    return this;
  }

  setWeather(patch = {}) {
    Object.assign(this.weather, patch);
    if (patch.fogDensity !== undefined) {
      const k = patch.fogDensity;
      this._fog.scatter = 3.6e-3 * k;
      this._fog.extinction = 1.45e-3 * k;
    }
    if (patch.fogHeight !== undefined) this._fog.heightScale = patch.fogHeight;
    if (patch.shaftGain !== undefined) this._fog.shaftGain = patch.shaftGain;
    this._applyWeather();
    this._applyFog();
    // Turbidity is baked into all three LUTs, so it needs the static bake too.
    if (patch.turbidity !== undefined) this.luts.bakeStatic();
    this._skyDirty = true;
    this._envDirty = true;
    return this;
  }

  /**
   * The sky a MAP is set under.
   *
   * A map descriptor may carry an `environment` — the hour it plays at and any
   * weather it wants over the defaults (see the contract in src/world/maps.js)
   * — and `world` hands it here every time it builds a level. The Loop is a
   * night map; the rest play under the sky's own defaults, and pass `null`.
   *
   * That `null` is the half that matters. Switching from a night map to a day
   * one has to put the whole sky back, not just the hour, or the next map
   * inherits the last one's haze and cloud deck. So the patch is always applied
   * over `_defaultEnvironment` rather than over whatever is live now.
   *
   * `exposureBias` is EV the map adds to the metering compensation this system
   * already publishes for the hour (see the end of `_updateCelestial`);
   * positive is darker. It is a MAP's knob, not a time-of-day one: the level's
   * own light matters. On a street whose practicals are one moon and nothing
   * else, the half stop after dark is the whole correction; on a block with ten
   * lamp posts, a marquee and seventy lit windows there is enough light in the
   * frame that the meter can be stopped down further, and stopping it down is
   * what puts the lamps at the top of the tone curve instead of the moonlit
   * limestone behind them. Every night frame is exposed for its practicals.
   *
   * A descriptor is a module singleton, which makes the identity check exact:
   * rebuilding the same map is free, and booting a map with no environment of
   * its own costs nothing at all.
   */
  applyEnvironment(env = null) {
    const next = env ?? null;
    if (next === this._environment) return this;
    this._environment = next;
    const base = this._defaultEnvironment;
    this._envExposureBias = next?.exposureBias ?? 0;
    // How much of the moon a map keeps, 0..1. The atmosphere is physical, so
    // at this site the moon is up all night and the sky it scatters is BLUE —
    // there is no hour that gives a black, starlit sky. A map that wants one
    // (Site Work: a city in blackout) dials the moon down instead of lying
    // about the hour. Scales the beam, the sky's moon irradiance and the disc
    // together so the sky stays self-consistent; stars are untouched.
    this._envMoonlight = THREE.MathUtils.clamp(next?.moonlight ?? 1, 0, 1);
    this.setWeather({ ...base.weather, ...(next?.weather ?? null) });
    // setTimeOfDay re-runs _updateCelestial, which is where the bias lands.
    this.setTimeOfDay(next?.hour ?? base.hour);
    return this;
  }

  /** Fraction of direct sunlight reaching a ground point through the clouds. */
  cloudShadowAt(x, z) {
    // Reuses one preallocated params object: this runs every frame.
    const p = this._occParams;
    p.coverage = this.weather.cloudCoverage;
    p.density = this.weather.cloudDensity;
    p.windX = this.shared.uCloudParams2.value.z;
    p.windZ = this.shared.uCloudParams2.value.w;
    p.time = this._cloudTime;
    return cloudSunOcclusion(x, z, this.celestial.sun, p);
  }

  // =========================================================================
  //  frame
  // =========================================================================

  update(dt, ctx) {
    // Cloud drift is deterministic (driven by ctx.time.elapsed) so capture mode
    // reproduces the exact same sky every run.
    this._cloudTime = ctx.time.elapsed;
    this.shared.uCloudParams.value.w = this._cloudTime;
    this.shared.uStarParams.value.z = this._cloudTime;
    // Fog advects slower than the cloud deck and mostly horizontally, so the
    // wisps drift rather than boil.
    this.shared.uFogDrift.value.set(
      this._cloudTime * 0.09,
      this._cloudTime * 0.015,
      this._cloudTime * 0.045
    );

    if (this.timeRate !== 0) {
      this.hour = (this.hour + this.timeRate * dt) % 24;
      this._updateCelestial();
    }

    // A cloud crossing the sun is a real, large-scale lighting change. Sampled
    // on the CPU from the same macro field the shader draws (clouds.js) and
    // eased hard, because a snapping key light reads as a bug.
    const cam = ctx.camera;
    this._cloudOccTarget = this.cloudShadowAt(cam.position.x, cam.position.z);
    const k = Math.min(1, dt * 0.9);
    this._cloudOcclusion += (this._cloudOccTarget - this._cloudOcclusion) * k;
    this._applyLightIntensities();

    if (this._skyDirty) this._bakeSky();

    this._envAge += dt;
    // Cheap when nothing moves; the dirty flag is only set by a real sun move.
    if (this._envDirty && this._envAge > 0.2) this._bakeEnv();
  }

  lateUpdate(dt, ctx) {
    // The renderer applies the TAA jitter after lateUpdate and removes it again
    // before custom passes run, so these unjittered matrices are exactly what
    // the volumetric pass wants. The dome takes the jittered ones itself, in
    // its own onBeforeRender.
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    this.shared.uInvProj.value.copy(cam.projectionMatrixInverse);
    this.shared.uCamWorld.value.copy(cam.matrixWorld);
    this.shared.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
  }

  // =========================================================================
  //  internals
  // =========================================================================

  _applyWeather() {
    const w = this.weather;
    this.shared.uMieScale.value = w.turbidity;
    this.shared.uHorizonMurk.value = w.horizonMurk;
    const cp = this.shared.uCloudParams.value;
    cp.x = w.cloudCoverage;
    cp.y = w.cloudDensity;
    const cp2 = this.shared.uCloudParams2.value;
    cp2.x = w.cirrusCoverage;
    cp2.y = w.cirrusOpacity;
    cp2.z = Math.cos(w.windAngle) * w.windSpeed;
    cp2.w = Math.sin(w.windAngle) * w.windSpeed;
  }

  _applyFog() {
    const f = this._fog;
    this.shared.uFog.value.set(f.scatter, 1 / f.heightScale, f.baseY, f.maxDistance);
    this.shared.uFog2.value.set(f.extinction, f.shaftGain, f.ambientGain, f.noise);
    this.shared.uFogExt.value.copy(f.extinctionTint).multiplyScalar(f.extinction);
    this.shared.uPhase.value.set(
      f.phaseForward,
      f.phaseBackward,
      f.phaseBackWeight,
      f.noiseScale
    );
  }

  /** Sun/moon geometry, colours and intensities for the current hour. */
  _updateCelestial() {
    const c = this.celestial.setHour(this.hour);
    const s = this.shared;

    s.uSunDir.value.copy(c.sun);
    s.uMoonDir.value.copy(c.moon);
    s.uSunAltitude.value = c.sunAlt;
    s.uMoonAltitude.value = c.moonAlt;
    // The sky-view LUT is baked with the sun at azimuth 0, so the moon only
    // needs its azimuth *relative* to the sun.
    let rel = c.moonAz - c.sunAz;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    s.uMoonRelAz.value = rel;
    c.celestialMatrix(s.uCelestial.value);

    const mie = this.weather.turbidity;

    // ---- sun ---------------------------------------------------------------
    const muS = Math.sin(c.sunAlt);
    // Fraction of the solar disc above the horizon: without this the key light
    // snaps off at sunset instead of dimming through the last half degree.
    const discS = THREE.MathUtils.clamp(0.5 + muS / (2 * 0.004654), 0, 1);
    transmittanceToSpace(Math.max(muS, 0.0008), mie, this._sunT);
    // The solar spectrum is a touch warm of D65 even before the atmosphere.
    const tint = [1.0, 0.975, 0.94];
    const T = this._sunT;
    // ---- the key is the disc PLUS its aureole -------------------------------
    // Transmittance alone is the extinction of the *disc*, and at four degrees of
    // elevation it is (0.51, 0.23, 0.06) — a beam with essentially no blue in it,
    // which is why the 19:20 frame came out as a single orange hue with the whole
    // street the same colour as the sky. But a surface at golden hour is not lit
    // by the disc alone: the aerosol forward peak puts a solar aureole ten to
    // fifteen degrees wide around it, that light arrives from within a few degrees
    // of the beam direction, and it is *far* less reddened because it was scattered
    // out of the column near the observer rather than travelling the whole of it.
    //
    // Raising the transmittance to a power below one is the cheap, monotonic way
    // to express "the effective key is the disc convolved with its aureole": it
    // keeps the ordering and the hue direction (still red-dominant, still tracks
    // turbidity and elevation) while pulling the saturation back to what a golden
    // hour photograph actually shows. Exponent 1 above 16 degrees, so the daytime
    // sun is untouched.
    const aureoleP = THREE.MathUtils.lerp(
      0.55,
      1.0,
      THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(c.sunAlt), 0, 16)
    );
    const sr = Math.pow(T[0], aureoleP) * tint[0];
    const sg = Math.pow(T[1], aureoleP) * tint[1];
    const sb = Math.pow(T[2], aureoleP) * tint[2];
    const smax = Math.max(1e-6, sr, sg, sb);
    this.sunLight.color.setRGB(sr / smax, sg / smax, sb / smax);

    // ---- beam floor --------------------------------------------------------
    // The transmittance at 4 degrees elevation is (0.51, 0.23, 0.06): the beam
    // keeps its red channel but loses two thirds of its LUMINANCE, while the
    // whole west sky is at its brightest. Left alone that inverts the frame —
    // the shaded wall comes out brighter than the sunlit one, which is what the
    // 19:20 shot was doing. A real golden hour still reads as a key light.
    //
    // So: the beam's *hue* stays exactly on the physical transmittance curve,
    // and only its luminance is floored, at about a stop below the noon value,
    // for as long as any part of the disc can see the scene (down to -2 deg).
    // Below that it releases and the beam dies out normally into blue hour.
    const lumT = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
    const altDeg = THREE.MathUtils.radToDeg(c.sunAlt);
    // 1 while the disc still lights the street, 0 by the time it is 6 deg under.
    const beamAlive = THREE.MathUtils.smoothstep(altDeg, -6.0, -1.0);
    const lumFloor = SUN_LUM_FLOOR * beamAlive;
    // Applied as a gain on the physical value so nothing above ~12 deg moves.
    const beamGain = Math.max(1, lumFloor / Math.max(lumT, 1e-5));
    this._beamGain = beamGain;
    this._baseSunIntensity = SUN_ILLUMINANCE_TOP * smax * discS * beamGain;
    // Luminous beam level, in scene units — the reference the indirect terms
    // are held against so the key:fill ratio is elevation-invariant.
    this._beamLuminance = SUN_ILLUMINANCE_TOP * Math.max(lumT * beamGain, 1e-6) * discS;

    // Irradiance handed to the sky LUT is the *extraterrestrial* value: the
    // scattering raymarch applies the transmittance itself.
    s.uSunIrradiance.value.set(
      SUN_ILLUMINANCE_TOP * tint[0],
      SUN_ILLUMINANCE_TOP * tint[1],
      SUN_ILLUMINANCE_TOP * tint[2]
    );

    // Solar disc radiance is E/omega = 5.12/6.8e-5 = 75000 units, which
    // overflows a half-float target once bloom touches it. Clamped to 4000:
    // still six stops above anything else in the frame, so it tone-maps to
    // pure white and blooms hard, which is all the number is for.
    const discRad = 4000;
    s.uSunDiscRadiance.value.set(discRad * tint[0], discRad * tint[1], discRad * tint[2]);

    // ---- night ramps -------------------------------------------------------
    // Key handover: the moon may only become the brightest light once the sun
    // is genuinely gone, or the renderer would fit its cascades to the wrong one.
    const keyRamp = THREE.MathUtils.smoothstep(-altDeg, -3, 5);
    // Presentation ramp for stars, Milky Way and the moon disc.
    const nightRamp = THREE.MathUtils.smoothstep(-altDeg, 0, 9);

    // ---- moon --------------------------------------------------------------
    const muM = Math.sin(c.moonAlt);
    const discM = THREE.MathUtils.clamp(0.5 + muM / (2 * 0.004516), 0, 1);
    transmittanceToSpace(Math.max(muM, 0.0008), mie, this._moonT);
    const MT = this._moonT;
    // Moonlight is physically warm (lunar regolith is reddish) but reads cool
    // because scotopic vision peaks blue — the Purkinje shift. Cinema has
    // rendered night blue for a century; we follow it, and modulate that tint
    // by the real atmospheric reddening so a low moon still goes amber.
    const cool = [0.66, 0.80, 1.0];
    const mr = MT[0] * cool[0];
    const mg = MT[1] * cool[1];
    const mb = MT[2] * cool[2];
    const mmax = Math.max(1e-6, mr, mg, mb);
    this.moonLight.color.setRGB(mr / mmax, mg / mmax, mb / mmax);
    const moonScale = this._envMoonlight ?? 1;
    let moonI = MOON_ILLUMINANCE_NIGHT * c.moonPhase * mmax * discM * keyRamp * moonScale;

    // The renderer switches its own 4.3-intensity fallback sun back on if no
    // foreign directional light is brighter than 0.01. Keep a floor so that
    // never happens during the handover minute.
    if (Math.max(this._baseSunIntensity, moonI) < 0.03) moonI = 0.03;
    this.moonLight.intensity = moonI;

    const moonIrr = MOON_ILLUMINANCE_NIGHT * c.moonPhase * keyRamp * moonScale;
    s.uMoonIrradiance.value.set(moonIrr * cool[0], moonIrr * cool[1], moonIrr * cool[2]);

    // Day: a pale disc a little above the daytime sky, which is what the moon
    // actually looks like at 16:30. Night: far enough above the night sky to
    // clip to white and bloom, the way every photograph of a moon does.
    // Both numbers are *ratios to the sky the LUT produces*, so they moved with
    // the pi correction in atmosphere.js rather than being retuned by eye.
    // The disc keeps a floor: a blackout dims the CITY, not the moon itself —
    // a starfield with no moon in it reads as an error, not as night.
    const moonDisc = THREE.MathUtils.lerp(0.35, 3.5, nightRamp) * Math.max(moonScale, 0.4);
    s.uMoonDiscRadiance.value.set(moonDisc, moonDisc * 0.985, moonDisc * 0.95);

    // ---- ambient colour (published, not used for lighting) -----------------
    // The real ambient is the PMREM; this is a cheap CPU stand-in so the HUD and
    // gameplay code can ask "what colour is the daylight right now" without a
    // GPU readback. Whole-sky diffuse illuminance runs about 15% of the beam,
    // and the hue swings from Rayleigh blue overhead to the beam's own colour as
    // the sun sets, because at that point most of the sky *is* the sunset.
    //
    // Two things this must NOT do. It must not go warm at night: below the
    // horizon the sun's transmittance is (0.09, 0.009, 0.0001) and normalising
    // that gives pure sodium orange, so an unguarded lerp toward "the beam's
    // colour" published a street-lamp-coloured night ambient and every shadow
    // in the frame came out the same hue as the practicals. And the warm swing
    // at sunset belongs to the sun's own *hue*, not to a dead beam, so it is
    // gated on the beam still being alive.
    const warm = (1 - THREE.MathUtils.smoothstep(altDeg, 1, 22)) * beamAlive;
    const night = 1 - beamAlive;
    const nh = NIGHT_AMBIENT_HUE;
    const ar = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.36, nh[0], night),
      this.sunLight.color.r,
      warm
    );
    const ag = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.56, nh[1], night),
      this.sunLight.color.g,
      warm
    );
    const ab = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(1.0, nh[2], night),
      this.sunLight.color.b,
      warm
    );
    // The moon term is deliberately generous against the day term (0.55 vs 0.15
    // of the key): a moonlit sky is a much larger fraction of its own key than a
    // daylit one, and it is the only thing separating a night shadow from black.
    const aLevel = SKY_AMBIENT_FRACTION * this._baseSunIntensity + 0.9 * moonI;
    this.ambientColor.setRGB(ar * aLevel, ag * aLevel, ab * aLevel);

    // ---- indirect budget, published for the renderer ------------------------
    // The other half of the beam floor. A low sun does not just redden: the whole
    // western sky lights up, and the PMREM integrates that into an irradiance
    // that can exceed the beam's own luminance — which is how a sunset ends up
    // with its shaded walls brighter than its sunlit ones. The sky is physically
    // right; what is wrong is that a hemispherical average taken off a 20-degree
    // horizon glow over-reports how much of it any vertical surface can see.
    //
    // So the indirect terms come down on the same elevation curve the beam is
    // floored on, which makes the key:fill ratio elevation-invariant rather than
    // something that happens to work at 16:30. `render` multiplies its IBL
    // diffuse budget by this (see RenderSystem._updateBounceFill).
    // Sky shoulder. The knee tracks the beam's luminance because autoexposure
    // does: 7.5% of the beam lands a couple of stops under display white at any
    // hour, so a daylight zenith (2% of the beam) passes through untouched while
    // a sunset horizon glow (200%+ of it) is rolled off into a gradient instead
    // of a plateau. Floored so the night sky and the stars are never touched.
    // The knee comes down as the sun does. At 30 degrees the only thing over it
    // is a sunlit cumulus top, which SHOULD be near white; at 5 degrees the
    // whole western half of the dome is over it and it is the difference
    // between a graded amber ramp and a cream void.
    const kneeFrac = THREE.MathUtils.lerp(
      0.045,
      0.11,
      THREE.MathUtils.smoothstep(altDeg, 2.0, 15.0)
    );
    s.uSkyRolloff.value.set(
      Math.max(kneeFrac * this._beamLuminance, 0.02 + 6.0 * moonI),
      0.34
    );

    // ---- exposure compensation for the time of day --------------------------
    // At four degrees of elevation a street canyon is ENTIRELY in shadow — the
    // sun only reaches the top two floors of the leeward side — so a meter that
    // is (correctly) weighted onto the geometry opens up two stops and puts the
    // sky, which has not moved, on the flat top of the tone curve. That is the
    // whole reason the 19:20 sky was one achromatic plateau with no Rayleigh
    // column in it: not the atmosphere model, the exposure.
    //
    // Every stills photographer shooting a golden hour stops down for the sky
    // and lets the street go dark. This is that decision, on a curve, so the sky
    // stays inside the part of the tone curve that still has a gradient in it.
    this.exposureBias =
      1.35 * (1 - THREE.MathUtils.smoothstep(altDeg, 1.0, 13.0)) * beamAlive +
      // ...and half a stop after dark. The meter is (correctly) weighted onto
      // the geometry, and once the only key is a moon plus twenty-two sodium
      // lamps it opens up until a midnight street reads as an overcast evening.
      // Every night frame ever shot is underexposed on purpose.
      0.55 * (1 - beamAlive) +
      // ...plus whatever the active map asks for on top. How far a night frame
      // can be stopped down depends on how much light the LEVEL owns, which is
      // a property of the map and not of the hour. See `applyEnvironment`.
      this._envExposureBias;

    // Released — and then some — once the beam is gone. After dark the moonlit
    // sky is the ONLY fill there is, the warm ground bounce that made the daytime
    // budget need cutting is not there to swamp it, and a night frame with a
    // fifth of its pixels under code value 12 is not a night frame, it is an
    // empty one. So the budget goes ABOVE unity at night rather than being held
    // at the daylight value.
    this.indirectScale = THREE.MathUtils.lerp(
      2.2,
      THREE.MathUtils.lerp(0.45, 1.0, THREE.MathUtils.smoothstep(altDeg, 0.0, 14.0)),
      beamAlive
    );

    // ---- stars -------------------------------------------------------------
    // Calibrated against the moonlit sky the LUT actually produces: the
    // brightest first-magnitude stars sit about two stops above the zenith
    // radiance, the Milky Way's spine about half a stop below it. Anything
    // dimmer than that and the night sky is empty; anything brighter and it
    // reads as a planetarium ceiling. The level tracks the sky, so it dropped by
    // pi with the photometric fix in atmosphere.js instead of being re-eyeballed.
    s.uStarParams.value.x = 0.07 * nightRamp;
    s.uStarParams.value.y = 0.55;
    s.uStarParams.value.w = 0.16 * nightRamp;

    // ---- light transforms --------------------------------------------------
    // Clamp the light direction just above the horizon: a directional light at
    // exactly 0 degrees degenerates the cascade fit.
    this._placeLight(this.sunLight, c.sun, 0.006);
    this._placeLight(this.moonLight, c.moon, 0.026);

    this._applyLightIntensities();
    this._skyDirty = true;
    if (this._envSunDir.dot(c.sun) < Math.cos(0.35 * (Math.PI / 180))) this._envDirty = true;
  }

  _placeLight(light, dir, minY) {
    this._tmp.copy(dir);
    if (this._tmp.y < minY) {
      this._tmp.y = minY;
      this._tmp.normalize();
    }
    light.position.copy(this._tmp).multiplyScalar(600);
    light.target.position.set(0, 0, 0);
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
  }

  _applyLightIntensities() {
    // A cloud crossing the sun dims the whole street, so the range has to stay
    // narrow: this light is global, and a hard 4x drop reads as somebody pulling
    // the exposure rather than as weather. Real broken cover on the ground swings
    // maybe a stop, which is what 0.58..1.0 gives.
    const occ = 0.58 + 0.42 * this._cloudOcclusion;
    this.sunLight.intensity = this._baseSunIntensity * occ * SUN_KEY_GAIN;

    const sunI = this.sunLight.intensity;
    const moonI = this.moonLight.intensity;
    const moonKey = moonI > sunI;
    this.keyLight = moonKey ? this.moonLight : this.sunLight;

    // The fog's key must be the light the renderer fitted its cascades to, or
    // the shafts would be masked by shadows cast from another direction.
    const key = this.keyLight;
    const dir = moonKey ? this.celestial.moon : this.celestial.sun;
    this.shared.uKeyDir.value.copy(dir);
    const i = key.intensity;
    this.shared.uKeyIrr.value.set(key.color.r * i, key.color.g * i, key.color.b * i);
  }

  _bakeSky() {
    this.luts.bakeSkyView();
    this._skyDirty = false;
    this.renderer.setRenderTarget(null);
  }

  _bakeEnv() {
    // One equirect draw of the same sky shader, then PMREM. The first call
    // allocates; every later call reuses the target so nothing churns.
    blit(this.renderer, this.dome.envMaterial, this.envEquirect);
    this._pmremTarget = this.pmrem.fromEquirectangular(
      this.envEquirect.texture,
      this._pmremTarget
    );
    this._pmremTarget.texture.name = 'sky-env';
    this.envMap = this._pmremTarget.texture;
    this.render.setEnvMap(this.envMap);
    this.renderer.setRenderTarget(null);

    this._envSunDir.copy(this.celestial.sun);
    this._envDirty = false;
    this._envAge = 0;

    this.ctx.events.emit('sky:env', { envMap: this.envMap, sunDir: this.celestial.sun });
  }

  dispose() {
    this._unregisterPass?.();
    this.volumetrics.dispose();
    this.ctx.scene.remove(this.dome.mesh);
    this.dome.dispose();
    this.luts.dispose();
    this.envEquirect.dispose();
    this._pmremTarget?.dispose();
    this.pmrem.dispose();
    this.ctx.scene.remove(this.sunLight, this.sunLight.target);
    this.ctx.scene.remove(this.moonLight, this.moonLight.target);
    this.render.removeLight?.(this.sunLight);
    this.render.removeLight?.(this.moonLight);
    this.sunLight.dispose();
    this.moonLight.dispose();
  }
}
