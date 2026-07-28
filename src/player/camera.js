/**
 * Camera feel.
 *
 * Everything a modern shooter does to make a floating pair of eyes read as a
 * body, layered so no single effect ever dominates:
 *
 *   eye height        stance-smoothed, so crouching is a movement not a cut
 *   view bob          1:2 Lissajous (figure-eight) locked to footstep cadence
 *   step micro-shift  a per-footfall vertical spring on top of the bob
 *   landing impact    dip + pitch + roll from the actual impact speed
 *   strafe / turn roll a degree of bank into the direction of travel
 *   slide             deep dip, forward push and a shoulder roll
 *   mantle            curve-driven offsets handed over by MantleMotion
 *   breathing sway    two detuned sines, amplified by ADS, wounds, suppression
 *   recoil            spring-damper impulse channel owned by the camera
 *   kick              a second, independent channel the weapon system pushes
 *   trauma shake      noise-driven, decays, used by explosions and heavy hits
 *   FOV               critically-damped springs: ADS crisp, sprint breathing
 *
 * Position offsets are built in the *yaw* basis (not the full view basis) so
 * looking up does not turn vertical bob into forward/backward lurch.
 */

import * as THREE from 'three';
import { CAMERA, MOVE } from './tuning.js';
import {
  Spring, RecoilAxis, clamp, clamp01, lerp, approach, hashNoise, DEG,
} from './springs.js';

export class CameraRig {
  constructor(ctx) {
    this.ctx = ctx;
    const C = CAMERA;

    // ---- smoothed stance -------------------------------------------------
    this.eye = 1.66;
    this.crouchBlend = 0;

    // ---- bob -------------------------------------------------------------
    this.bobPhase = 0;
    this.bobWeight = 0;
    this.bobRoll = 0;
    this.bobPitch = 0;

    // ---- springs ---------------------------------------------------------
    this.dip = new Spring(C.land.freq, C.land.damping, 0); // landing
    this.step = new Spring(C.step.freq, C.step.damping, 0); // footfall
    this.recoilPitch = new RecoilAxis(C.recoil.freq, C.recoil.damping, C.recoil.residualTau, C.recoil.residualShare);
    this.recoilYaw = new RecoilAxis(C.recoil.freq * 1.08, C.recoil.damping + 0.06, C.recoil.residualTau, C.recoil.residualShare);
    this.recoilRoll = new RecoilAxis(C.recoil.freq * 0.86, C.recoil.damping + 0.1, C.recoil.residualTau, 0.24);
    this.punch = new Spring(C.recoil.punchFreq, C.recoil.punchDamping, 0);
    /** Second, independent channel: `weapons` pushes into this one. */
    this.kickPitch = new RecoilAxis(11, 0.58, 0.22, 0.28);
    this.kickYaw = new RecoilAxis(11.5, 0.6, 0.22, 0.28);
    this.kickRoll = new RecoilAxis(9, 0.62, 0.22, 0.22);

    // ---- rolls -----------------------------------------------------------
    this.strafeRoll = 0;
    this.turnRoll = 0;
    this.slideRoll = 0;
    this.airRoll = 0;

    // ---- shake -----------------------------------------------------------
    this.trauma = 0;
    this.shakeTime = 0;

    // ---- breathing -------------------------------------------------------
    this.breathPhase = 0;

    // ---- fov -------------------------------------------------------------
    this.baseFov = ctx.config.fov;
    this.fov = this.baseFov;
    this.fovMove = 1;
    this.fovAds = 1;
    /**
     * The optic currently on the weapon, as a multiplier on `config.fov`, or
     * null for "whatever the config says". `weapons` writes it through
     * `Player.setAdsProgress`, because a 3.3x scope and a 1x red dot cannot
     * share one global zoom — see `adsFovScale` in src/weapons/defs.js.
     */
    this.adsFovScale = null;

    // ---- slide -----------------------------------------------------------
    this.slideBlend = 0;
    this.slideSide = 1;

    // ---- outputs (read by weapons for counter-motion) --------------------
    this.viewKick = { pitch: 0, yaw: 0, roll: 0, punch: 0 };
    this.bobOffset = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.eyePosition = new THREE.Vector3();
    this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
    this.forward = new THREE.Vector3(0, 0, -1);

    // scratch
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  reset(eye) {
    this.eye = eye;
    this.bobPhase = 0;
    this.bobWeight = 0;
    this.dip.reset(0);
    this.step.reset(0);
    this.recoilPitch.reset();
    this.recoilYaw.reset();
    this.recoilRoll.reset();
    this.kickPitch.reset();
    this.kickYaw.reset();
    this.kickRoll.reset();
    this.punch.reset(0);
    this.trauma = 0;
    this.strafeRoll = 0;
    this.turnRoll = 0;
    this.slideRoll = 0;
    this.slideBlend = 0;
    this.fovMove = 1;
    this.fovAds = 1;
  }

  /* ==================================================================== */
  /* impulses — the public feel API                                       */
  /* ==================================================================== */

  /** Camera-owned recoil. Angles in radians; `punch` in metres. */
  addRecoil(pitch = 0, yaw = 0, roll = 0, punch = 0) {
    this.recoilPitch.kick(pitch);
    this.recoilYaw.kick(yaw);
    this.recoilRoll.kick(roll);
    if (punch) this.punch.impulse(-punch * 14);
  }

  /** Weapon-driven kick — a separate channel so the two never fight. */
  addKick(pitch = 0, yaw = 0, roll = 0) {
    this.kickPitch.kick(pitch);
    this.kickYaw.kick(yaw);
    this.kickRoll.kick(roll);
  }

  addTrauma(a) {
    this.trauma = clamp01(this.trauma + a);
  }

  onLand(speed) {
    const L = CAMERA.land;
    const t = clamp01((speed - L.minSpeed) / (L.fullSpeed - L.minSpeed));
    if (t <= 0) return 0;
    // Perceptual curve: a 3 m/s landing should still be felt a little.
    const mag = Math.pow(t, 0.72);
    this.dip.impulse(-L.dipImpulse * mag);
    this.recoilPitch.kick(L.pitch * mag);
    this.recoilRoll.kick(L.roll * mag * (this.slideSide || 1));
    this.addTrauma(L.trauma * mag * mag);
    return mag;
  }

  onFootstep(running, stance) {
    const S = CAMERA.step;
    let amp = S.impulse * (running ? S.sprintScale : 1);
    if (stance === 'crouch') amp *= 0.55;
    else if (stance === 'prone') amp *= 0.3;
    this.step.impulse(-amp);
  }

  onSlideStart(side) {
    this.slideSide = side || 1;
    this.dip.impulse(-0.9);
    this.addTrauma(0.12);
  }

  /* ==================================================================== */
  /* per-frame composition                                                */
  /* ==================================================================== */

  /**
   * @param {number} dt
   * @param {import('./movement.js').Movement} m
   * @param {object} health  { fraction, low }
   */
  update(dt, m, health) {
    const C = CAMERA;
    const cfg = this.ctx.config;
    const ads = clamp01(m.adsAmount);

    // ---- stance / eye height --------------------------------------------
    const targetEye = m.eyeHeight + (m.sliding ? -0.1 : 0);
    const growing = targetEye > this.eye;
    const tau = m.stance === 'prone' || this.eye < 0.75
      ? MOVE.stanceTau.prone
      : growing ? MOVE.stanceTau.crouchStand : MOVE.stanceTau.standCrouch;
    this.eye = approach(this.eye, targetEye, tau, dt);
    this.crouchBlend = clamp01(1 - (this.eye - 1.0) / 0.66);

    // ---- slide envelope --------------------------------------------------
    const slideTarget = m.sliding ? 1 - 0.45 * m.slideProgress : 0;
    this.slideBlend = approach(this.slideBlend, slideTarget, m.sliding ? 0.045 : 0.09, dt);

    // ---- yaw basis -------------------------------------------------------
    const sy = Math.sin(m.yaw), cy = Math.cos(m.yaw);
    this._fwd.set(-sy, 0, -cy);
    this._right.set(cy, 0, -sy);

    // ---- bob -------------------------------------------------------------
    this._updateBob(dt, m, ads);

    // ---- springs ---------------------------------------------------------
    this.dip.step(dt);
    this.step.step(dt);
    this.punch.step(dt);
    this.recoilPitch.step(dt);
    this.recoilYaw.step(dt);
    this.recoilRoll.step(dt);
    this.kickPitch.step(dt);
    this.kickYaw.step(dt);
    this.kickRoll.step(dt);

    // ---- rolls -----------------------------------------------------------
    const R = C.roll;
    const strafeTarget = -m.cmd.moveX * R.strafe * (m.grounded ? 1 : 0.45) * (1 - 0.6 * ads);
    this.strafeRoll = approach(this.strafeRoll, strafeTarget, R.tau, dt);
    const turnTarget = clamp(m.yawRate * R.yawRate, -R.yawRateMax, R.yawRateMax) * (1 - 0.5 * ads);
    this.turnRoll = approach(this.turnRoll, turnTarget, R.tau * 1.4, dt);
    const slideRollTarget = m.sliding ? -this.slideSide * R.slide : 0;
    this.slideRoll = approach(this.slideRoll, slideRollTarget, 0.1, dt);
    const airTarget = m.grounded ? 0 : clamp(-m.velocity.y * 0.02, -1, 1) * R.air;
    this.airRoll = approach(this.airRoll, airTarget, 0.22, dt);

    // ---- trauma shake ----------------------------------------------------
    const S = C.shake;
    this.trauma = Math.max(0, this.trauma - S.decay * dt);
    const shake = this.trauma * this.trauma;
    this.shakeTime += dt * S.freq;
    let shakePitch = 0, shakeYaw = 0, shakeRoll = 0, shakeX = 0, shakeY = 0;
    if (shake > 1e-4) {
      shakePitch = hashNoise(this.shakeTime, 11) * shake * S.rot * DEG;
      shakeYaw = hashNoise(this.shakeTime + 31.7, 23) * shake * S.rot * DEG;
      shakeRoll = hashNoise(this.shakeTime + 57.1, 37) * shake * S.rot * 0.7 * DEG;
      shakeX = hashNoise(this.shakeTime * 0.8 + 13.3, 41) * shake * S.pos;
      shakeY = hashNoise(this.shakeTime * 0.8 + 71.9, 53) * shake * S.pos;
    }

    // ---- breathing sway --------------------------------------------------
    const B = C.breath;
    const moveFactor = clamp01(m.horizontalSpeed / 2.2);
    let amp = B.amp;
    amp *= lerp(1, B.adsScale, ads);
    amp *= lerp(1, B.lowHealthScale, 1 - clamp01(health.fraction));
    amp *= lerp(1, B.suppressionScale, clamp01(health.suppression ?? 0));
    amp *= 1 - B.moveDamp * moveFactor;
    this.breathPhase += dt;
    const bA = Math.sin(this.breathPhase * Math.PI * 2 * B.freqA);
    const bB = Math.sin(this.breathPhase * Math.PI * 2 * B.freqB + 1.7);
    const breathPitch = (bA * 0.7 + bB * 0.3) * amp;
    const breathYaw = (bB * 0.75 - bA * 0.25) * amp * 1.15;
    const breathPos = (bA * 0.6 + bB * 0.4) * B.posAmp * (1 - 0.8 * moveFactor);

    // ---- mantle ----------------------------------------------------------
    const mm = m.mantleMotion;
    const mantleY = mm.active ? mm.camY : 0;
    const mantleFwd = mm.active ? mm.camForward : 0;
    const mantlePitch = mm.active ? mm.camPitch : 0;
    const mantleRoll = mm.active ? mm.camRoll : 0;

    // ---- assemble position ----------------------------------------------
    const base = m.sampleRender(this.ctx.time.alpha);
    const bobX = this.bobOffset.x;
    const bobY = this.bobOffset.y;
    const bobZ = this.bobOffset.z;

    // Lean is applied in world space further down (it comes from the validated
    // capsule probe, not from the bob basis).
    const lateral = bobX + shakeX;
    const vertical = bobY + this.dip.value + this.step.value + shakeY + mantleY + breathPos
      - this.slideBlend * 0.1;
    const forward = bobZ + this.punch.value + mantleFwd + this.slideBlend * 0.045;

    this.offset.set(0, 0, 0);
    this.offset.addScaledVector(this._right, lateral);
    this.offset.addScaledVector(this._fwd, forward);
    this.offset.y += vertical;

    this.eyePosition.set(
      base.x + m.leanOffsetX + this.offset.x,
      base.y + this.eye + this.offset.y - Math.abs(m.leanAmount) * MOVE.lean.drop,
      base.z + m.leanOffsetZ + this.offset.z
    );

    // ---- assemble rotation ----------------------------------------------
    const pitch = clamp(
      m.pitch + this.recoilPitch.value + this.kickPitch.value + breathPitch +
        this.bobPitch + shakePitch + mantlePitch,
      -CAMERA.pitchLimit,
      CAMERA.pitchLimit
    );
    const yaw = m.yaw + this.recoilYaw.value + this.kickYaw.value + breathYaw + shakeYaw;
    const roll =
      this.strafeRoll + this.turnRoll + this.slideRoll + this.airRoll +
      this.bobRoll + this.recoilRoll.value + this.kickRoll.value + shakeRoll +
      mantleRoll - m.leanAmount * MOVE.lean.roll;

    this.rotation.set(pitch, yaw, roll);

    // ---- FOV -------------------------------------------------------------
    const F = C.fov;
    let moveTarget = 1;
    if (m.sliding) moveTarget = F.slide;
    else if (m.tacticalSprint) moveTarget = F.tacSprint;
    else if (m.sprinting) moveTarget = F.sprint;
    else if (!m.grounded && m.velocity.y < -6) moveTarget = F.air;
    this.fovMove = approach(this.fovMove, moveTarget, F.moveTau, dt);
    const adsScale = this.adsFovScale ?? cfg.adsFovScale;
    this.fovAds = approach(this.fovAds, lerp(1, adsScale, ads), F.adsTau, dt);
    this.baseFov = cfg.fov;
    this.fov = this.baseFov * this.fovMove * this.fovAds;

    // ---- publish the kick channel for the viewmodel ----------------------
    this.viewKick.pitch = this.recoilPitch.value + this.kickPitch.value;
    this.viewKick.yaw = this.recoilYaw.value + this.kickYaw.value;
    this.viewKick.roll = this.recoilRoll.value + this.kickRoll.value;
    this.viewKick.punch = this.punch.value;
  }

  _updateBob(dt, m, ads) {
    const B = CAMERA.bob;
    const speed = m.horizontalSpeed;

    // Phase comes from the movement machine's gait accumulator (pi per footfall)
    // rather than being integrated here, so the bob can never drift out of sync
    // with the footstep events after a jump or a stance change. The +pi/2 offset
    // puts the horizontal extreme exactly on the footfall.
    this.bobPhase = m.stepPhase + Math.PI * 0.5;

    // Weight: speed-scaled (sprint bobs more than a walk, but not linearly),
    // faded out in the air and while sliding or aiming.
    let w = Math.min(B.speedCap, Math.pow(speed / 4.57, B.speedExp));
    if (!m.grounded || m.sliding) w = 0;
    w *= lerp(1, B.adsScale, ads);
    if (m.stance === 'prone') w *= 0.35;
    this.bobWeight = approach(this.bobWeight, w, B.airFade, dt);

    const th = this.bobPhase;
    const wt = this.bobWeight;
    this.bobOffset.set(
      Math.sin(th) * B.ampX * wt,
      Math.sin(th * 2) * B.ampY * wt,
      Math.cos(th * 2) * B.ampZ * wt
    );
    this.bobRoll = -Math.sin(th) * B.roll * wt;
    this.bobPitch = Math.cos(th * 2) * B.pitch * wt;
  }

  /** Write the composed transform onto the engine camera. */
  applyTo(camera) {
    camera.position.copy(this.eyePosition);
    camera.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z);
    if (Math.abs(camera.fov - this.fov) > 1e-3) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  }
}
