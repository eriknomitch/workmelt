/**
 * Every number that defines how the player feels, in one place.
 *
 * Calibration notes — these are matched to Modern Warfare (2019) / MWII, which
 * are authored in inches at 20 units = 1 ft. Converted:
 *   base run          150 u/s  -> 4.57 m/s
 *   sprint            230 u/s  -> 7.01 m/s
 *   tactical sprint   275 u/s  -> 8.38 m/s
 *   crouch walk        80 u/s  -> 2.44 m/s
 *   prone              33 u/s  -> 1.01 m/s
 *   jump apex         ~39 u    -> 0.60 m   (with 800 u/s^2 -> ~20.6 m/s^2 gravity)
 *   slide burst       290 u/s  -> 8.84 m/s, ~0.9 s to bleed out
 *   stance change      ~0.2 s  crouch<->stand, ~0.75 s to/from prone
 *
 * Gravity comes from UNITS.gravity (-20.6 m/s^2) so the jump arc matches the
 * rest of the game's physics rather than a private constant.
 */

import { UNITS } from '../core/config.js';
import { DEG } from './springs.js';

export const GRAVITY = UNITS.gravity; // negative
export const JUMP_APEX = 0.6;
/** v = sqrt(2 g h) — solved from the apex so tuning the apex is meaningful. */
export const JUMP_SPEED = Math.sqrt(2 * Math.abs(GRAVITY) * JUMP_APEX);

export const STANCE = {
  stand: {
    name: 'stand',
    height: UNITS.playerHeight, // 1.78
    eye: UNITS.playerHeight - UNITS.eyeOffset, // 1.66
    speed: 4.57,
    stepHeight: 0.42,
    strideLength: 1.48,
  },
  crouch: {
    name: 'crouch',
    height: UNITS.playerCrouchHeight, // 1.12
    eye: UNITS.playerCrouchHeight - 0.1, // 1.02
    speed: 2.44,
    stepHeight: 0.3,
    strideLength: 1.05,
  },
  prone: {
    name: 'prone',
    height: 0.7, // capsule floor: 2 * radius = 0.64
    eye: 0.4,
    speed: 1.01,
    stepHeight: 0.14,
    strideLength: 0.78,
  },
};

export const MOVE = {
  sprintSpeed: 7.01,
  tacSprintSpeed: 8.38,

  /** Directional scaling — you are slower sideways and slower still backwards. */
  strafeScale: 0.92,
  backScale: 0.8,
  /** ADS movement penalty (CoD: ~45 % of base, a touch more forgiving here). */
  adsScale: 0.5,

  /**
   * Ground response. 92 m/s^2 reaches base run speed in 50 ms — effectively
   * instant, which is what makes CoD feel "tight". Deceleration is deliberately
   * lower so there is a short slide-off tail instead of a dead stop.
   */
  groundAccel: 92,
  groundDecel: 52,
  /** Extra braking when the stick is released entirely. */
  stopDecel: 30,
  /** Air control: a quarter of ground authority, and it cannot add speed. */
  airAccelScale: 0.25,
  airSpeedCap: 3.4,
  terminalSpeed: 55,
  /**
   * How far a grounded move may drop to stay on the ground — the stair-descent
   * snap. At least the standing step height, so any step that can be walked up
   * can be walked down: under a 0.34 m snap every 0.4 m altar on Graving Dock
   * was a hop and a landing.
   */
  snapDistance: 0.44,

  /** Grace windows that hide input/timing error. */
  coyoteTime: 0.09,
  jumpBuffer: 0.13,
  jumpCooldown: 0.28,

  /** Tactical sprint is a double-tap of sprint, MWII style. */
  tacSprintTapWindow: 0.32,
  tacSprintMaxTime: 6.0,
  tacSprintRecovery: 1.6,
  /** How far off dead-ahead the stick may be before sprint drops. */
  sprintForwardDot: 0.55,
  sprintStartDelay: 0.05,

  slide: {
    entrySpeed: 8.84,
    /** Never slower than this on entry, so a slide always feels like a burst. */
    minEntry: 6.2,
    /** Speed at which the slide gives up and becomes a crouch walk. */
    exitSpeed: 2.95,
    duration: 0.9,
    /**
     * Exponential drag (1/s) plus a linear brake, tuned together so an 8.8 m/s
     * entry bleeds to the exit speed at ~0.8 s on concrete — inside the 0.9 s
     * hard cap, later on smooth surfaces, sooner in sand.
     */
    drag: 0.75,
    brake: 0.85,
    cooldown: 0.55,
    minSpeedToStart: 5.2,
    /** Steering authority while sliding — enough to curve, not to turn around. */
    steer: 2.6,
    /** Downhill acceleration keeps slides alive on ramps. */
    slopeAssist: 9.0,
  },

  mantle: {
    /** Anything up to this is stepped/vaulted without a rooted animation. */
    autoVaultMax: 0.72,
    minHeight: 0.34,
    maxHeight: 1.85,
    /** Forward reach of the ledge probe from the capsule surface. */
    reach: 0.62,
    /** How far past the lip we must find standable ground. */
    landDepth: 0.46,
    vaultTime: 0.34,
    mantleTime: 0.62,
    highMantleTime: 0.82,
    cooldown: 0.2,
    /** Minimum forward speed for an automatic (no key press) vault. */
    autoSpeed: 2.4,
    /**
     * How close the face has to be for an *unprompted* vault to fire. Tight on
     * purpose: it is the main thing that stops a staircase reading as a series
     * of vaultable ledges.
     */
    proactiveDistance: 0.2,
    /** Extra reach per m/s of closing speed (seconds of travel, effectively). */
    proactiveLookahead: 0.035,
  },

  lean: {
    /** Lateral camera travel at full lean — enough to clear a doorframe. */
    offset: 0.34,
    roll: 13 * DEG,
    drop: 0.035,
    rate: 0.085, // tau
    probeRadius: 0.17,
  },

  /** Stance transition time constants (seconds to 63 %). */
  stanceTau: {
    standCrouch: 0.062,
    crouchStand: 0.072,
    prone: 0.16,
  },
};

export const CAMERA = {
  /**
   * View bob. Figure-eight (1:2 Lissajous) locked to the footstep cadence, so
   * the eye is at a horizontal extreme exactly when a foot lands. Amplitudes
   * are metres at base run speed — deliberately small; anything larger reads as
   * nausea rather than weight.
   */
  bob: {
    ampX: 0.0165,
    ampY: 0.0115,
    ampZ: 0.006,
    roll: 0.42 * DEG,
    pitch: 0.16 * DEG,
    speedExp: 0.85,
    speedCap: 1.55,
    adsScale: 0.22,
    airFade: 0.11, // tau to fade bob out in the air
  },

  /** Per-footstep vertical micro-shift, on top of the bob. */
  step: {
    impulse: 0.085, // m/s injected into the landing spring
    freq: 5.4,
    damping: 0.62,
    sprintScale: 1.7,
  },

  land: {
    /** Fall speed at which a landing starts to register at all. */
    minSpeed: 2.2,
    /** Fall speed that produces a full-strength dip. */
    fullSpeed: 12.5,
    dipImpulse: 2.35, // m/s into the dip spring
    pitch: 3.4 * DEG,
    roll: 0.9 * DEG,
    freq: 3.05,
    damping: 0.52,
    trauma: 0.34,
    /** Hard landings cost health (CoD only damages above ~14 m/s). */
    damageSpeed: 15.0,
    damagePerSpeed: 7.0,
  },

  /** Lean-into-the-turn. Small; it is felt, not seen. */
  roll: {
    strafe: 1.05 * DEG,
    yawRate: 0.055, // radians of roll per radian/second of yaw
    yawRateMax: 1.5 * DEG,
    tau: 0.11,
    slide: 5.2 * DEG,
    air: 0.9 * DEG,
  },

  recoil: {
    freq: 9.5,
    damping: 0.5,
    residualTau: 0.28,
    residualShare: 0.34,
    /** Positional punch (camera pushed back along view) uses a stiffer spring. */
    punchFreq: 12,
    punchDamping: 0.62,
  },

  shake: {
    decay: 1.85,
    rot: 1.35, // degrees at trauma = 1
    pos: 0.022,
    freq: 22,
  },

  breath: {
    /** Resting respiration ~14/min while idle. */
    freqA: 0.235,
    freqB: 0.155,
    amp: 0.0021, // radians
    posAmp: 0.0035, // metres
    /** Scoped optics magnify hold error — sway grows when aiming. */
    adsScale: 1.85,
    /** Wounded players cannot hold still. */
    lowHealthScale: 2.6,
    moveDamp: 0.78,
    suppressionScale: 2.2,
  },

  fov: {
    /** Multipliers on config.fov. */
    sprint: 1.055,
    tacSprint: 1.1,
    slide: 1.085,
    air: 1.015,
    /** Time constants — ADS must be crisp, sprint can breathe. */
    adsTau: 0.052,
    moveTau: 0.13,
  },

  /** Camera never gets closer than this to a wall when leaning/mantling. */
  wallPad: 0.09,
  pitchLimit: 88 * DEG,
};

export const HEALTH = {
  max: 100,
  /** CoD: regen starts ~5 s after the last hit and refills in ~2.5 s. */
  regenDelay: 4.6,
  regenRate: 34,
  regenRamp: 0.55,
  lowThreshold: 0.36,
  criticalThreshold: 0.18,
  /** Directional damage indicators live this long. */
  indicatorTime: 1.8,
  indicatorMax: 4,

  suppression: {
    /** Suppression added by a round cracking past / hitting nearby. */
    perNearMiss: 0.28,
    perHit: 0.5,
    perExplosion: 0.85,
    radius: 3.2,
    decay: 0.62, // per second
    /** How much suppression is allowed to move the camera. */
    swayScale: 1.5,
    shakeScale: 0.28,
  },

  /** Low-health screen treatment (desaturate + vignette + heartbeat). */
  effect: {
    desaturate: 0.62,
    vignette: 0.55,
    tint: 0.3,
    heartbeatMin: 1.05, // Hz at the low-health threshold
    heartbeatMax: 2.05, // Hz at death's door
    pulseGain: 0.42,
    hitFlash: 0.85,
    hitFlashTau: 0.22,
  },
};

export const FOOTSTEP = {
  /** Foot is offset laterally from the capsule centre so FX/audio pan. */
  lateral: 0.13,
  /** Surface probe length below the foot. */
  probe: 0.9,
  /** A step is only "running" (louder, dustier) above this speed. */
  runSpeed: 5.4,
  /** Landing suppresses the next step so you do not get a double transient. */
  landHold: 0.12,
};
