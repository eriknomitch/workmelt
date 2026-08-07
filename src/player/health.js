/**
 * Health, regeneration, suppression and the damage-direction model.
 *
 * Behaviour matches the CoD contract: no health pickups, a delay after the last
 * hit, then a fast refill. Damage arriving from a direction produces an
 * indicator (angle in *view* space, so the HUD can draw it without knowing
 * anything about the player's transform) and a matching camera impulse, so a hit
 * is felt before it is read.
 *
 * Suppression is a separate 0..1 pool fed by near misses, hits and blasts. It
 * widens the breathing sway and adds a little shake — the same trick CoD uses to
 * make being shot at feel dangerous without taking control away.
 */

import * as THREE from 'three';
import { HEALTH } from './tuning.js';
import { clamp01, approach, lerp, DEG } from './springs.js';

export class Health {
  constructor(ctx, rig) {
    this.ctx = ctx;
    this.rig = rig;
    this.max = HEALTH.max;
    this.value = HEALTH.max;
    this.dead = false;
    this.regenerating = false;
    this.lastDamageTime = -100;
    this.suppression = 0;
    this.hitFlash = 0;

    /** Direction indicators, oldest first. angle is radians, 0 = straight ahead. */
    this.indicators = [];
    for (let i = 0; i < HEALTH.indicatorMax; i++) {
      this.indicators.push({ active: false, angle: 0, amount: 0, life: 0, worldX: 0, worldY: 0, worldZ: 0 });
    }

    // Heartbeat: phase 0..1 per beat, with a double-thump envelope.
    this.beatPhase = 0;
    this.pulse = 0;
    this.effect = 0; // 0..1 overall low-health treatment weight

    this._payload = { amount: 0, from: new THREE.Vector3(), health: 0, direction: 0, critical: false };
    this._statePayload = {
      health: HEALTH.max, fraction: 1, low: false, critical: false,
      regenerating: false, suppression: 0, dead: false,
    };
    this._emitTimer = 0;
    this._lastEmitHealth = HEALTH.max;
    this._beat = { strength: 0, fraction: 1 };
  }

  get fraction() {
    return clamp01(this.value / this.max);
  }

  get low() {
    return this.fraction < HEALTH.lowThreshold;
  }

  get critical() {
    return this.fraction < HEALTH.criticalThreshold;
  }

  reset(full = true) {
    if (full) this.value = this.max;
    this.dead = false;
    this.suppression = 0;
    this.hitFlash = 0;
    this.lastDamageTime = -100;
    for (let k = 0; k < this.indicators.length; k++) this.indicators[k].active = false;
  }

  /* ==================================================================== */

  /**
   * @param {number} amount
   * @param {THREE.Vector3|null} from  world position of the attacker/blast
   * @param {object} opts { yaw, type, suppress }
   */
  damage(amount, from, opts = {}) {
    if (this.dead || amount <= 0) return 0;
    // Immune while graphics auto-calibration runs: input is frozen behind the
    // scrim, so the player cannot fight back or take cover, and a death would
    // respawn the camera mid-measurement — polluting the very frames being
    // scored — while also firing `player:death` into the quality system's
    // deferred-reload path as a spurious safe-boundary signal.
    if (this.ctx.peek?.('quality')?.calibrating) return 0;
    const before = this.value;
    this.value = Math.max(0, this.value - amount);
    this.lastDamageTime = this.ctx.time.elapsed;
    this.regenerating = false;
    const dealt = before - this.value;

    // ---- direction in view space ---------------------------------------
    let angle = 0;
    if (from) {
      const yaw = opts.yaw ?? this.ctx.camera.rotation.y;
      const dx = from.x - this.ctx.camera.position.x;
      const dz = from.z - this.ctx.camera.position.z;
      // Forward at yaw is (-sin, -cos); right is (cos, -sin).
      const f = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
      const r = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
      angle = Math.atan2(r, f);
      this._pushIndicator(angle, dealt, from);
    }

    // ---- felt response --------------------------------------------------
    const severity = clamp01(dealt / 45);
    this.hitFlash = clamp01(this.hitFlash + HEALTH.effect.hitFlash * (0.4 + severity));
    this.addSuppression(HEALTH.suppression.perHit * (0.5 + severity));
    if (this.rig) {
      // Punch the camera away from the hit: pitch up, yaw and roll off-axis.
      const s = 0.6 + severity * 1.9;
      this.rig.addRecoil(
        (1.1 + severity) * DEG * s * 0.7,
        -Math.sin(angle) * (1.4 * DEG) * s,
        -Math.sin(angle) * (2.2 * DEG) * s,
        0.008 * s
      );
      this.rig.addTrauma(0.22 * s);
    }

    const p = this._payload;
    p.amount = dealt;
    p.health = this.value;
    p.direction = angle;
    p.critical = this.critical;
    if (from) p.from.copy(from);
    else p.from.set(this.ctx.camera.position.x, this.ctx.camera.position.y, this.ctx.camera.position.z);
    this.ctx.events.emit('damage:taken', p);

    if (this.value <= 0) {
      this.dead = true;
      this.ctx.events.emit('player:death', { position: this.ctx.camera.position });
      // (one allocation on death is fine — it happens once)
    }
    this._emitState(true);
    return dealt;
  }

  heal(amount) {
    this.value = Math.min(this.max, this.value + amount);
  }

  addSuppression(a) {
    this.suppression = clamp01(this.suppression + a);
  }

  _pushIndicator(angle, amount, from) {
    // Reuse the slot pointing the most similar way, else the oldest.
    let slot = null;
    let oldest = null;
    for (let k = 0; k < this.indicators.length; k++) {
      const i = this.indicators[k];
      if (!i.active) { slot = i; break; }
      if (Math.abs(angle - i.angle) < 0.5) { slot = i; break; }
      if (!oldest || i.life > oldest.life) oldest = i;
    }
    slot = slot ?? oldest ?? this.indicators[0];
    slot.active = true;
    slot.angle = angle;
    slot.amount = Math.max(slot.active ? slot.amount * 0.5 : 0, amount);
    slot.life = 0;
    slot.worldX = from.x; slot.worldY = from.y; slot.worldZ = from.z;
  }

  /* ==================================================================== */

  update(dt) {
    const H = HEALTH;

    // ---- regeneration ---------------------------------------------------
    const since = this.ctx.time.elapsed - this.lastDamageTime;
    if (!this.dead && this.value < this.max && since > H.regenDelay) {
      this.regenerating = true;
      // Ramp in so the recovery has a shape rather than a step.
      const ramp = clamp01((since - H.regenDelay) / H.regenRamp);
      this.value = Math.min(this.max, this.value + H.regenRate * ramp * dt);
    } else if (this.value >= this.max) {
      this.regenerating = false;
    }

    // ---- pools ----------------------------------------------------------
    this.suppression = Math.max(0, this.suppression - H.suppression.decay * dt);
    this.hitFlash = approach(this.hitFlash, 0, H.effect.hitFlashTau, dt);

    for (let k = 0; k < this.indicators.length; k++) {
      const i = this.indicators[k];
      if (!i.active) continue;
      i.life += dt;
      if (i.life > H.indicatorTime) i.active = false;
    }

    // ---- low-health treatment weight ------------------------------------
    const f = this.fraction;
    const target = clamp01((H.lowThreshold - f) / H.lowThreshold);
    this.effect = approach(this.effect, target, 0.25, dt);

    // ---- heartbeat ------------------------------------------------------
    if (this.effect > 0.02) {
      const freq = lerp(H.effect.heartbeatMin, H.effect.heartbeatMax, clamp01(1 - f / H.lowThreshold));
      this.beatPhase += dt * freq;
      if (this.beatPhase >= 1) {
        this.beatPhase -= Math.floor(this.beatPhase);
        this._beat.strength = this.effect;
        this._beat.fraction = f;
        this.ctx.events.emit('player:heartbeat', this._beat);
      }
      // lub-dub: two gaussian thumps 0.16 of a cycle apart
      const t = this.beatPhase;
      const thump = (c, w, g) => g * Math.exp(-((t - c) * (t - c)) / (2 * w * w));
      this.pulse = (thump(0.06, 0.035, 1) + thump(0.22, 0.045, 0.62)) * this.effect;
    } else {
      this.beatPhase = 0;
      this.pulse = 0;
    }

    // ---- suppression feel ------------------------------------------------
    if (this.rig && this.suppression > 0.02) {
      this.rig.addTrauma(this.suppression * H.suppression.shakeScale * dt);
    }

    this._emitTimer -= dt;
    if (this._emitTimer <= 0) {
      this._emitTimer = 0.1;
      if (Math.abs(this.value - this._lastEmitHealth) > 0.4) this._emitState(false);
    }
  }

  _emitState(force) {
    const s = this._statePayload;
    const wasLow = s.low;
    s.health = this.value;
    s.fraction = this.fraction;
    s.low = this.low;
    s.critical = this.critical;
    s.regenerating = this.regenerating;
    s.suppression = this.suppression;
    s.dead = this.dead;
    this._lastEmitHealth = this.value;
    s.changedLowState = wasLow !== s.low;
    s.forced = !!force;
    this.ctx.events.emit('player:health', s);
  }
}
