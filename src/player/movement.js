/**
 * The movement state machine.
 *
 * Runs at the fixed 120 Hz step so the feel is framerate-independent and
 * reproducible in capture mode. Collision is *entirely* delegated to
 * `physics.createCharacter()` — this file only ever owns velocity and asks the
 * controller to resolve a displacement.
 *
 * States: stand · crouch · prone · sprint · tacsprint · slide · jump · fall ·
 *         mantle · vault   (+ lean, an additive modifier on any grounded state)
 *
 * Every transition is interruptible. Nothing here waits for an animation to
 * finish except the rooted mantle, and even that can be cut short by taking
 * damage or by control being disabled.
 */

import * as THREE from 'three';
import { STANCE, MOVE, GRAVITY, JUMP_SPEED, FOOTSTEP } from './tuning.js';
import { LedgeProbe, MantleMotion, LEDGE_NONE, LEDGE_VAULT } from './mantle.js';
import { clamp, clamp01, approach, lerp } from './springs.js';

export const STATES = [
  'stand', 'crouch', 'prone', 'sprint', 'tacsprint',
  'slide', 'jump', 'fall', 'mantle', 'vault',
];

export class Movement {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    this.physics = null;
    this.character = null;
    this.probe = null;
    this.mantleMotion = new MantleMotion();

    // ---- authored state ------------------------------------------------
    this.state = 'stand';
    this.prevState = 'stand';
    this.stateTime = 0;
    this.stance = 'stand'; // physical stance: stand | crouch | prone
    this.stanceWant = 'stand';
    this.sprinting = false;
    this.tacticalSprint = false;
    this.sliding = false;
    this.grounded = true;
    this.wasGrounded = true;
    this.airTime = 0;
    this.groundTime = 0;
    this.speed = 0;
    this.horizontalSpeed = 0;
    this.blocked = false;

    // ---- yaw/pitch are owned here so movement and camera never disagree --
    this.yaw = 0;
    this.pitch = 0;
    this.yawRate = 0;

    // ---- externally driven ---------------------------------------------
    /** 0..1 aim-down-sight blend. `weapons` may drive this via setAdsProgress. */
    this.adsAmount = 0;
    this.controlEnabled = true;

    // ---- lean ----------------------------------------------------------
    this.leanInput = 0;
    this.leanAmount = 0;
    this.leanAllowed = 0;
    this.leanOffsetX = 0;
    this.leanOffsetZ = 0;
    this._leanProbeTimer = 0;

    // ---- timers --------------------------------------------------------
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._jumpCooldown = 0;
    this._sprintHoldTime = 0;
    this._lastSprintPress = -10;
    this._tacSprintTime = 0;
    this._tacSprintLock = 0;
    this._slideTime = 0;
    this._slideCooldown = 0;
    this._slideDirX = 0;
    this._slideDirZ = 1;
    this._slideSide = 1;
    this._mantleCooldown = 0;
    this._ledgeProbeTimer = 0;
    this._stepDistance = 0;
    this._bobDistance = 0;
    this._bobPhase = 0;
    this._footLeft = false;
    this._footHold = 0;
    this._tacSprintRequested = false;
    this._edgeFrame = -1;

    /** One-shot flags consumed (and cleared) by PlayerSystem each frame. */
    this.jumped = false;
    this.slideStarted = false;
    this.slideEnded = false;

    // ---- input snapshot (latched once per rendered frame) ---------------
    this.cmd = {
      moveX: 0, moveY: 0,
      jump: false, jumpHeld: false,
      crouchPressed: false, cronePressed: false, pronePressed: false,
      sprintHeld: false, sprintPressed: false,
      leanL: false, leanR: false,
      ads: false,
    };
    this._cmdFrame = -1;
    this._prevHeld = {
      jump: false, crouch: false, prone: false, sprint: false,
    };

    // ---- interpolation for the camera ----------------------------------
    this.prevPosition = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.renderPosition = new THREE.Vector3();

    // ---- events / outputs ----------------------------------------------
    /** Set on the step we land; consumed by PlayerSystem. */
    this.landEvent = { pending: false, speed: 0, surface: 'concrete' };
    this.stepEvent = { pending: false, running: false, surface: 'concrete', x: 0, y: 0, z: 0, left: false };
    this.mantleEvent = { pending: false, kind: 'none', height: 0 };

    // scratch
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
    this._prevVy = 0;
  }

  /* ==================================================================== */
  /* setup                                                                */
  /* ==================================================================== */

  init(physics, spawn) {
    this.physics = physics;
    this.probe = new LedgeProbe(physics);
    this.character = physics.createCharacter({
      id: 'player',
      owner: this.player,
      radius: 0.32,
      height: STANCE.stand.height,
      stepHeight: STANCE.stand.stepHeight,
      slopeLimit: 48 * (Math.PI / 180),
      snapDistance: 0.34,
    });
    if (spawn) {
      this.character.teleport(spawn.x, spawn.y, spawn.z);
    }
    this.position.set(this.character.position.x, this.character.position.y, this.character.position.z);
    this.prevPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    return this.character;
  }

  dispose() {
    if (this.character && this.physics) this.physics.removeCharacter(this.character);
    this.character = null;
  }

  get stanceDef() {
    return STANCE[this.stance];
  }

  /** Eye height for the *current* stance, before camera smoothing. */
  get eyeHeight() {
    return STANCE[this.stance].eye;
  }

  /* ==================================================================== */
  /* input                                                                */
  /* ==================================================================== */

  /**
   * Latch the input snapshot for this rendered frame. Called from the first
   * fixed step of the frame (and from update() if the frame had none), so edge
   * detection is exact regardless of how many substeps run.
   */
  latchInput(frame) {
    if (frame === this._cmdFrame) return;
    this._cmdFrame = frame;
    const cmd = this.cmd;
    const input = this.ctx.input;
    const prev = this._prevHeld;

    if (!this.controlEnabled) {
      cmd.moveX = 0; cmd.moveY = 0;
      cmd.jump = false; cmd.jumpHeld = false;
      cmd.crouchPressed = false; cmd.pronePressed = false;
      cmd.sprintHeld = false; cmd.sprintPressed = false;
      cmd.leanL = false; cmd.leanR = false;
      cmd.ads = false;
      prev.jump = prev.crouch = prev.prone = prev.sprint = false;
      return;
    }

    input.moveVector(cmd);
    cmd.moveX = cmd.x;
    cmd.moveY = cmd.y;

    const jump = input.action('jump');
    const crouch = input.action('crouch');
    const prone = input.action('prone');
    // Full deflection sprints on both analogue sources: gamepad (raw axis,
    // either sign) and the virtual touch stick (+y forward only — a thumb
    // pulled fully back is a retreat, not a sprint request).
    const sprint =
      input.action('sprint') ||
      Math.abs(this.ctx.input.stick.moveY) > 0.92 ||
      this.ctx.input.touch.moveY > 0.92;

    cmd.jump = jump && !prev.jump;
    cmd.jumpHeld = jump;
    cmd.crouchPressed = crouch && !prev.crouch;
    cmd.pronePressed = prone && !prev.prone;
    cmd.sprintHeld = sprint;
    cmd.sprintPressed = sprint && !prev.sprint;
    cmd.leanL = input.action('leanLeft');
    cmd.leanR = input.action('leanRight');
    cmd.ads = input.ads;

    prev.jump = jump;
    prev.crouch = crouch;
    prev.prone = prone;
    prev.sprint = sprint;

    if (cmd.jump) this._jumpBuffer = MOVE.jumpBuffer;
    if (cmd.sprintPressed) {
      const now = this.ctx.time.elapsed;
      if (now - this._lastSprintPress < MOVE.tacSprintTapWindow && this._tacSprintLock <= 0) {
        this._tacSprintRequested = true;
      }
      this._lastSprintPress = now;
    }
  }

  /* ==================================================================== */
  /* the fixed step                                                       */
  /* ==================================================================== */

  step(h) {
    const c = this.character;
    if (!c) return;
    const cmd = this.cmd;

    // A rendered frame contains 0..N fixed steps but only ever *one* key press.
    // Edge flags are therefore consumed by the first substep of the frame; the
    // rest see them cleared. (Without this a 60 fps frame runs two substeps and
    // toggles crouch twice — i.e. never crouches, and cancels a slide on the
    // same step that started it.)
    const frame = this.ctx.time.frame;
    if (frame !== this._edgeFrame) {
      this._edgeFrame = frame;
    } else {
      cmd.jump = false;
      cmd.crouchPressed = false;
      cmd.pronePressed = false;
      cmd.sprintPressed = false;
    }

    this.prevPosition.copy(this.position);
    this.stateTime += h;
    this._tickTimers(h);

    // Basis for this step.
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this._fwd.set(-sy, 0, -cy);
    this._right.set(cy, 0, -sy);

    if (this.mantleMotion.active) {
      this._stepMantle(h);
      this._publish();
      return;
    }

    // ---- wish direction, with directional speed weighting ---------------
    let mx = cmd.moveX;
    let my = cmd.moveY;
    const rawInput = Math.hypot(mx, my);
    const sx = mx * MOVE.strafeScale;
    const sz = my >= 0 ? my : my * MOVE.backScale;
    let wishLen = Math.hypot(sx, sz);
    const wish = this._wish;
    if (wishLen > 1e-5) {
      wish.set(
        this._fwd.x * sz + this._right.x * sx,
        0,
        this._fwd.z * sz + this._right.z * sx
      );
      const l = Math.hypot(wish.x, wish.z);
      wish.x /= l; wish.z /= l;
      if (wishLen > 1) wishLen = 1;
    } else {
      wish.set(0, 0, 0);
      wishLen = 0;
    }
    const forwardIntent = rawInput > 1e-4 ? my / rawInput : 0;

    // ---- discrete decisions, in priority order --------------------------
    this._updateStance(cmd, rawInput);
    this._updateSprint(cmd, rawInput, forwardIntent);
    this._updateSlide(cmd, h, wish, wishLen);
    const jumped = this._updateJump(cmd);

    // ---- integrate velocity ---------------------------------------------
    const v = this.velocity;
    if (this.sliding) {
      this._accelerateSlide(h, wish, wishLen);
    } else if (c.grounded && !jumped) {
      this._accelerateGround(h, wish, wishLen, rawInput);
    } else {
      this._accelerateAir(h, wish, wishLen);
    }

    if (c.grounded && !jumped && v.y < 0) v.y = 0;
    v.y += GRAVITY * h;
    if (v.y < -MOVE.terminalSpeed) v.y = -MOVE.terminalSpeed;

    // ---- ledge detection (before the move, so we never fight the wall) ---
    if (this._tryLedge(h, wish, wishLen, cmd, forwardIntent)) {
      this._publish();
      return;
    }

    // ---- resolve ---------------------------------------------------------
    this._prevVy = v.y;
    c.velocity.x = v.x; c.velocity.y = v.y; c.velocity.z = v.z;
    const travelled = c.move(v.x * h, v.y * h, v.z * h);
    v.x = c.velocity.x; v.y = c.velocity.y; v.z = c.velocity.z;
    this.blocked = c.lastMoveBlocked;

    this.wasGrounded = this.grounded;
    this.grounded = c.grounded;
    this.position.set(c.position.x, c.position.y, c.position.z);

    if (c.touchingCeiling && v.y > 0) v.y = 0;

    // ---- post-move bookkeeping ------------------------------------------
    this._postMove(h, travelled);
    this._updateLean(h, cmd);
    this._resolveState();
    this._publish();
  }

  _tickTimers(h) {
    this._jumpBuffer = Math.max(0, this._jumpBuffer - h);
    this._jumpCooldown = Math.max(0, this._jumpCooldown - h);
    this._slideCooldown = Math.max(0, this._slideCooldown - h);
    this._mantleCooldown = Math.max(0, this._mantleCooldown - h);
    this._tacSprintLock = Math.max(0, this._tacSprintLock - h);
    this._footHold = Math.max(0, this._footHold - h);
    this._ledgeProbeTimer = Math.max(0, this._ledgeProbeTimer - h);
    this._leanProbeTimer = Math.max(0, this._leanProbeTimer - h);
    if (this.grounded) {
      this._coyote = MOVE.coyoteTime;
      this.groundTime += h;
      this.airTime = 0;
    } else {
      this._coyote = Math.max(0, this._coyote - h);
      this.airTime += h;
      this.groundTime = 0;
    }
  }

  /* ==================================================================== */
  /* stance                                                               */
  /* ==================================================================== */

  _updateStance(cmd, rawInput) {
    const c = this.character;
    if (this.sliding) {
      this.stanceWant = 'crouch';
    } else {
      if (cmd.crouchPressed) {
        this.stanceWant = this.stanceWant === 'crouch' ? 'stand' : 'crouch';
      }
      if (cmd.pronePressed) {
        this.stanceWant = this.stanceWant === 'prone' ? 'crouch' : 'prone';
      }
      // Sprinting always stands you up — CoD does not let you sprint crouched.
      if (cmd.sprintHeld && rawInput > 0.5 && this.stanceWant !== 'stand' && cmd.moveY > 0.5) {
        this.stanceWant = 'stand';
      }
      if (cmd.jump && this.stanceWant !== 'stand') this.stanceWant = 'stand';
    }

    if (this.stanceWant === this.stance) return;
    const target = STANCE[this.stanceWant];
    if (target.height <= this.stanceDef.height) {
      // Shrinking always succeeds.
      c.height = target.height;
      c.stepHeight = target.stepHeight;
      this.stance = this.stanceWant;
    } else if (c.canFit(target.height)) {
      c.height = target.height;
      c.stepHeight = target.stepHeight;
      this.stance = this.stanceWant;
    }
    // else: blocked by a ceiling — keep asking every step until it clears.
  }

  /* ==================================================================== */
  /* sprint / tactical sprint                                             */
  /* ==================================================================== */

  _updateSprint(cmd, rawInput, forwardIntent) {
    const c = this.character;
    const wantSprint =
      cmd.sprintHeld &&
      rawInput > 0.45 &&
      forwardIntent > MOVE.sprintForwardDot &&
      this.stance === 'stand' &&
      !this.sliding &&
      this.adsAmount < 0.3 &&
      (c.grounded || this.sprinting);

    if (wantSprint) {
      this._sprintHoldTime += this.ctx.time.fixed;
      if (this._sprintHoldTime >= MOVE.sprintStartDelay) this.sprinting = true;
    } else {
      this._sprintHoldTime = 0;
      this.sprinting = false;
      this.tacticalSprint = false;
      this._tacSprintTime = 0;
      this._tacSprintRequested = false;
    }

    if (this.sprinting) {
      if (this._tacSprintRequested && !this.tacticalSprint) {
        this.tacticalSprint = true;
        this._tacSprintTime = 0;
      }
      this._tacSprintRequested = false;
      if (this.tacticalSprint) {
        this._tacSprintTime += this.ctx.time.fixed;
        if (this._tacSprintTime > MOVE.tacSprintMaxTime) {
          this.tacticalSprint = false;
          this._tacSprintLock = MOVE.tacSprintRecovery;
        }
      }
    }
  }

  /* ==================================================================== */
  /* slide                                                                */
  /* ==================================================================== */

  _updateSlide(cmd, h, wish, wishLen) {
    const c = this.character;
    const v = this.velocity;

    if (!this.sliding) {
      const fast = Math.hypot(v.x, v.z);
      const canStart =
        cmd.crouchPressed &&
        this.sprinting &&
        c.grounded &&
        fast >= MOVE.slide.minSpeedToStart &&
        this._slideCooldown <= 0 &&
        this._mantleCooldown <= 0;
      if (canStart) this._beginSlide(cmd, wish, wishLen, fast);
      return;
    }

    this._slideTime += h;

    // Slide-cancel: a jump out of a slide is the signature CoD movement tech.
    if (this._jumpBuffer > 0 && c.grounded && this._jumpCooldown <= 0) {
      this._endSlide(true);
      return;
    }
    // Standing up mid-slide, or losing the floor, or bleeding out of speed.
    const sp = Math.hypot(v.x, v.z);
    if (
      cmd.crouchPressed ||
      this._slideTime > MOVE.slide.duration ||
      sp < MOVE.slide.exitSpeed ||
      (!c.grounded && this.airTime > 0.14)
    ) {
      this._endSlide(false);
    }
  }

  _beginSlide(cmd, wish, wishLen, currentSpeed) {
    const v = this.velocity;
    let dx = v.x, dz = v.z;
    let l = Math.hypot(dx, dz);
    if (l < 0.4 && wishLen > 0.1) {
      dx = wish.x; dz = wish.z; l = 1;
    }
    if (l < 1e-4) return;
    dx /= l; dz /= l;

    const target = Math.max(MOVE.slide.minEntry, Math.min(MOVE.slide.entrySpeed, currentSpeed * 1.3));
    v.x = dx * target;
    v.z = dz * target;
    this._slideDirX = dx;
    this._slideDirZ = dz;
    this._slideSide = cmd.moveX >= 0 ? 1 : -1;
    this._slideTime = 0;
    this.sliding = true;
    this.sprinting = false;
    this.tacticalSprint = false;
    this.stanceWant = 'crouch';
    // Force the capsule down immediately; a slide is a commitment.
    this.character.height = STANCE.crouch.height;
    this.character.stepHeight = STANCE.crouch.stepHeight;
    this.stance = 'crouch';
    this._setState('slide');
    this.slideStarted = true;
  }

  _endSlide(intoJump) {
    this.sliding = false;
    this._slideCooldown = MOVE.slide.cooldown;
    this._slideTime = 0;
    if (intoJump) {
      // Preserve the burst but never let it compound into a speed exploit.
      const v = this.velocity;
      const sp = Math.hypot(v.x, v.z);
      const cap = MOVE.sprintSpeed * 1.06;
      if (sp > cap) {
        const s = cap / sp;
        v.x *= s; v.z *= s;
      }
      this.stanceWant = 'stand';
      if (this.character.canFit(STANCE.stand.height)) {
        this.character.height = STANCE.stand.height;
        this.character.stepHeight = STANCE.stand.stepHeight;
        this.stance = 'stand';
      }
      this._doJump();
    } else {
      this.stanceWant = 'crouch';
    }
    this.slideEnded = true;
  }

  _accelerateSlide(h, wish, wishLen) {
    const v = this.velocity;
    const s = MOVE.slide;
    let sp = Math.hypot(v.x, v.z);
    if (sp < 1e-5) return;
    let dx = v.x / sp, dz = v.z / sp;

    // Steering: lateral authority only, so the slide curves but never pivots.
    if (wishLen > 0.05) {
      const lat = wish.x * -dz + wish.z * dx; // wish · right(dir)
      const steer = lat * s.steer * h;
      const nx = dx - dz * steer; // dir + right(dir) * steer
      const nz = dz + dx * steer;
      const l = Math.hypot(nx, nz) || 1;
      dx = nx / l;
      dz = nz / l;
    }

    // Downhill keeps a slide alive; uphill kills it fast.
    const gn = this.character.groundNormal;
    const slope = -(gn.x * dx + gn.z * dz);
    sp += slope * s.slopeAssist * h;

    // Exponential drag plus a linear brake — the tail must actually terminate.
    sp = sp * Math.exp(-s.drag * h) - s.brake * h;
    if (sp < 0) sp = 0;

    // Surface friction as a *rate*, not a per-step multiplier: sand eats a
    // slide, sheet metal barely touches it.
    sp -= sp * clamp(this.character.groundFriction - 0.55, 0, 0.8) * 0.62 * h;
    if (sp < 0) sp = 0;

    v.x = dx * sp;
    v.z = dz * sp;
    this._slideDirX = dx;
    this._slideDirZ = dz;
  }

  get slideProgress() {
    return this.sliding ? clamp01(this._slideTime / MOVE.slide.duration) : 0;
  }

  /* ==================================================================== */
  /* jump                                                                 */
  /* ==================================================================== */

  _updateJump(cmd) {
    if (this.sliding) return false;
    if (this._jumpBuffer <= 0) return false;
    if (this._jumpCooldown > 0) return false;
    const c = this.character;
    if (!c.grounded && this._coyote <= 0) return false;

    // You stand up before you jump; if a ceiling forbids it, you do not jump.
    if (this.stance !== 'stand') {
      if (!c.canFit(STANCE.stand.height)) return false;
      c.height = STANCE.stand.height;
      c.stepHeight = STANCE.stand.stepHeight;
      this.stance = 'stand';
      this.stanceWant = 'stand';
    }
    this._doJump();
    return true;
  }

  _doJump() {
    const v = this.velocity;
    v.y = JUMP_SPEED;
    this._jumpBuffer = 0;
    this._jumpCooldown = MOVE.jumpCooldown;
    this._coyote = 0;
    this.grounded = false;
    this.character.grounded = false;
    this.jumped = true;
    this._setState('jump');
  }

  /* ==================================================================== */
  /* acceleration                                                         */
  /* ==================================================================== */

  targetSpeed() {
    let base;
    if (this.sprinting) {
      base = this.tacticalSprint ? MOVE.tacSprintSpeed : MOVE.sprintSpeed;
    } else {
      base = STANCE[this.stance].speed;
      base *= lerp(1, MOVE.adsScale, clamp01(this.adsAmount));
    }
    base *= lerp(1, 0.6, clamp01(Math.abs(this.leanAmount)));
    return base;
  }

  _accelerateGround(h, wish, wishLen, rawInput) {
    const v = this.velocity;
    const speed = this.targetSpeed() * wishLen;

    let tx = wish.x * speed;
    let tz = wish.z * speed;

    // Walk along the ground plane rather than into it, so slopes do not steal
    // speed and ramps do not launch you.
    const gn = this.character.groundNormal;
    if (gn.y > 0.1 && gn.y < 0.999 && (tx !== 0 || tz !== 0)) {
      const d = tx * gn.x + tz * gn.z;
      const px = tx - gn.x * d;
      const pz = tz - gn.z * d;
      const l = Math.hypot(px, pz);
      if (l > 1e-5) {
        const want = Math.hypot(tx, tz);
        tx = (px / l) * want;
        tz = (pz / l) * want;
      }
    }

    const dx = tx - v.x;
    const dz = tz - v.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-6) return;

    const cur = Math.hypot(v.x, v.z);
    let rate;
    if (rawInput < 0.02) rate = MOVE.stopDecel;
    else if (speed < cur * 0.92) rate = MOVE.groundDecel;
    else rate = MOVE.groundAccel;
    // Rough ground (sand, dirt) responds a little more sluggishly.
    rate *= clamp(this.character.groundFriction + 0.08, 0.75, 1.05);

    const step = rate * h;
    if (dl <= step) {
      v.x = tx; v.z = tz;
    } else {
      const s = step / dl;
      v.x += dx * s;
      v.z += dz * s;
    }
  }

  /**
   * Air control: a quarter of ground authority, and it may only add speed along
   * the wish direction up to `airSpeedCap`. Existing momentum (a slide-cancel
   * launch, say) is preserved — you can steer it but not amplify it.
   */
  _accelerateAir(h, wish, wishLen) {
    if (wishLen < 1e-4) return;
    const v = this.velocity;
    const cap = MOVE.airSpeedCap * wishLen;
    const along = v.x * wish.x + v.z * wish.z;
    const add = cap - along;
    if (add <= 0) return;
    const accel = MOVE.groundAccel * MOVE.airAccelScale * wishLen * h;
    const gain = accel < add ? accel : add;
    v.x += wish.x * gain;
    v.z += wish.z * gain;
  }

  /* ==================================================================== */
  /* mantle / vault                                                       */
  /* ==================================================================== */

  _tryLedge(h, wish, wishLen, cmd, forwardIntent) {
    if (this._mantleCooldown > 0 || this.sliding) return false;
    if (wishLen < 0.35 || forwardIntent < 0.4) return false;
    if (this.stance === 'prone') return false;
    if (this._ledgeProbeTimer > 0) return false;

    const c = this.character;
    const v = this.velocity;
    const sp = Math.hypot(v.x, v.z);

    // Cheap gate: only probe when something is actually in the way, when we are
    // descending onto a lip, or when the player asked for it with jump.
    const pressing = cmd.jumpHeld || cmd.jump;
    const blockedNow = c.lastMoveBlocked && sp > 0.3;
    const descending = !c.grounded && v.y < 1.0;
    /**
     * Closing on something at speed. This case matters more than it looks: the
     * character controller's step offset happily *lifts* the capsule onto a
     * knee-high box without ever reporting a blocked move, so waiting to be
     * blocked means you float up low walls instead of vaulting them.
     */
    const closing = c.grounded && sp >= MOVE.mantle.autoSpeed;
    if (!(blockedNow || descending || closing || (pressing && c.grounded))) return false;
    // Probe rate scales with speed. At 7 m/s a fixed 20 Hz probe travels 0.35 m
    // between samples and skips clean over the narrow window in which a vault is
    // still possible — the window closes the instant the step offset starts
    // lifting the capsule.
    this._ledgeProbeTimer = clamp(0.1 / Math.max(1.5, sp), 0.008, 0.05);

    const kind = this.probe.probe(c, wish.x, wish.z, STANCE.stand.height);
    if (kind === LEDGE_NONE) return false;

    const r = this.probe.result;
    const auto = r.fast && sp >= MOVE.mantle.autoSpeed;

    // A proactive vault (nothing blocked us, no jump pressed) has to be certain,
    // or a staircase turns into a series of animations. Two conditions do it:
    // the face must be right in front of us, and the lip must be higher than the
    // step offset can absorb. On stairs the next riser is too low and the one
    // after it is too far, so neither ever qualifies.
    if (closing && !blockedNow && !pressing) {
      // Speed-scaled lookahead: at a sprint the vault has to commit ~60 ms out
      // or the capsule is already riding up the face.
      const reach = MOVE.mantle.proactiveDistance + sp * MOVE.mantle.proactiveLookahead;
      if (r.distance > reach) return false;
      if (r.obstacleHeight < c.stepHeight + 0.07) return false;
    }

    // Low obstacles are cleared automatically at speed; anything taller is an
    // explicit action so you never get yanked up a wall by accident.
    if (!auto && !pressing) return false;

    const side = cmd.moveX >= 0 ? 1 : -1;
    this.mantleMotion.begin(r, c, wish.x, wish.z, side, sp);
    this.velocity.set(0, 0, 0);
    c.velocity.x = c.velocity.y = c.velocity.z = 0;
    this._jumpBuffer = 0;
    this.sprinting = false;
    this.tacticalSprint = false;
    this.mantleEvent.pending = true;
    this.mantleEvent.kind = kind === LEDGE_VAULT ? 'vault' : 'mantle';
    this.mantleEvent.height = r.obstacleHeight;
    this._setState(kind === LEDGE_VAULT ? 'vault' : 'mantle');
    return true;
  }

  _stepMantle(h) {
    const m = this.mantleMotion;
    const c = this.character;
    // You cannot peek round a corner with both hands on a ledge.
    this.leanAmount = approach(this.leanAmount, 0, MOVE.lean.rate, h);
    this.leanOffsetX = this._right.x * this.leanAmount * MOVE.lean.offset;
    this.leanOffsetZ = this._right.z * this.leanAmount * MOVE.lean.offset;
    const alive = m.step(h);
    c.setPosition(m.px, m.py, m.pz);
    this.position.set(m.px, m.py, m.pz);
    this.wasGrounded = this.grounded;
    this.grounded = false;
    if (!alive) {
      m.end();
      c.setPosition(m.landX, m.landY, m.landZ);
      this.position.set(m.landX, m.landY, m.landZ);
      c.depenetrate(4);
      c.probeGround();
      this.grounded = c.grounded;
      this.wasGrounded = true; // suppress a bogus landing event
      const v = this.velocity;
      v.x = m.fx * m.exitSpeed;
      v.z = m.fz * m.exitSpeed;
      v.y = 0;
      this._mantleCooldown = MOVE.mantle.cooldown;
      this._stepDistance = 0;
      this._footHold = FOOTSTEP.landHold;
      this._resolveState();
    }
  }

  cancelMantle() {
    if (!this.mantleMotion.active) return;
    const m = this.mantleMotion;
    m.end();
    this.character.setPosition(m.landX, m.landY, m.landZ);
    this.position.set(m.landX, m.landY, m.landZ);
    this.character.depenetrate(4);
    this.character.probeGround();
    this._mantleCooldown = MOVE.mantle.cooldown;
    this._resolveState();
  }

  /* ==================================================================== */
  /* lean                                                                 */
  /* ==================================================================== */

  _updateLean(h, cmd) {
    let want = (cmd.leanR ? 1 : 0) - (cmd.leanL ? 1 : 0);
    if (this.sprinting || this.sliding || !this.grounded || this.stance === 'prone') want = 0;
    this.leanInput = want;

    // Validate against the world at ~30 Hz — the camera must never poke through
    // a wall, so we shorten the lean until the probe capsule is clear.
    if (this._leanProbeTimer <= 0) {
      this._leanProbeTimer = 1 / 30;
      this.leanAllowed = want === 0 ? 0 : this._probeLean(want);
    }
    const target = want * this.leanAllowed;
    this.leanAmount = approach(this.leanAmount, target, MOVE.lean.rate, h);
    if (Math.abs(this.leanAmount) < 1e-4) this.leanAmount = 0;

    const off = this.leanAmount * MOVE.lean.offset;
    this.leanOffsetX = this._right.x * off;
    this.leanOffsetZ = this._right.z * off;
  }

  _probeLean(side) {
    const phys = this.physics;
    if (!phys) return 0;
    const c = this.character;
    const eye = c.position.y + this.eyeHeight;
    const L = MOVE.lean;
    for (let i = 0; i < 3; i++) {
      const amt = 1 - i * 0.33;
      const dx = this._right.x * side * L.offset * amt;
      const dz = this._right.z * side * L.offset * amt;
      this._p0.set(c.position.x + dx, eye - 0.22, c.position.z + dz);
      this._p1.set(c.position.x + dx, eye + 0.06, c.position.z + dz);
      if (phys.checkCapsule(this._p0, this._p1, L.probeRadius, phys.MASK.WORLD)) return amt;
    }
    return 0;
  }

  /* ==================================================================== */
  /* post-move                                                            */
  /* ==================================================================== */

  _postMove(h, travelled) {
    const c = this.character;
    const v = this.velocity;
    this.speed = Math.hypot(v.x, v.y, v.z);
    this.horizontalSpeed = Math.hypot(v.x, v.z);

    // ---- landing ---------------------------------------------------------
    if (this.grounded && !this.wasGrounded) {
      const impact = Math.max(c.landingSpeed, -Math.min(0, this._prevVy));
      this.landEvent.pending = true;
      this.landEvent.speed = impact;
      this.landEvent.surface = c.groundSurfaceName;
      this._footHold = FOOTSTEP.landHold;
      this._stepDistance = 0;
      if (this.sliding) this._endSlide(false);
    }

    // ---- footstep cadence -------------------------------------------------
    const dx = this.position.x - this.prevPosition.x;
    const dz = this.position.z - this.prevPosition.z;
    const moved = Math.hypot(dx, dz);
    if (this.grounded && !this.sliding) {
      this._stepDistance += moved;
      this._bobDistance += moved;
      const stride = STANCE[this.stance].strideLength * (this.sprinting ? 1.28 : 1);
      // One footfall = pi of bob phase, so the camera's horizontal extreme and
      // the footstep event are the same event by construction.
      this._bobPhase += (moved / stride) * Math.PI;
      if (this._bobPhase > Math.PI * 4) this._bobPhase -= Math.PI * 4;
      if (this._stepDistance >= stride && this.horizontalSpeed > 0.55 && this._footHold <= 0) {
        this._stepDistance -= stride;
        this._footLeft = !this._footLeft;
        this._emitFootstep();
      }
    } else {
      this._bobDistance += moved * 0.25;
      if (!this.grounded) this._stepDistance = STANCE[this.stance].strideLength * 0.55;
    }

  }

  _emitFootstep() {
    const c = this.character;
    const phys = this.physics;
    const e = this.stepEvent;
    const lateral = this._footLeft ? -FOOTSTEP.lateral : FOOTSTEP.lateral;
    const fx = c.position.x + this._right.x * lateral;
    const fz = c.position.z + this._right.z * lateral;

    // Query the surface *under the foot*, not under the capsule centre — a step
    // that lands half on a kerb should sound like the kerb.
    let y = c.position.y;
    let surface = c.groundSurfaceName;
    if (phys) {
      const hit = phys.raycast(fx, c.position.y + 0.35, fz, 0, -1, 0, FOOTSTEP.probe, phys.MASK.WORLD);
      if (hit.hit) {
        y = hit.point.y;
        surface = hit.surface;
      }
    }
    e.pending = true;
    e.running = this.horizontalSpeed >= FOOTSTEP.runSpeed;
    e.surface = surface;
    e.x = fx; e.y = y; e.z = fz;
    e.left = this._footLeft;
  }

  /* ==================================================================== */
  /* state resolution                                                     */
  /* ==================================================================== */

  _resolveState() {
    if (this.mantleMotion.active) return;
    let next;
    if (this.sliding) next = 'slide';
    else if (!this.grounded) next = this.velocity.y > 0.35 ? 'jump' : 'fall';
    else if (this.stance === 'prone') next = 'prone';
    else if (this.stance === 'crouch') next = 'crouch';
    else if (this.sprinting) next = this.tacticalSprint ? 'tacsprint' : 'sprint';
    else next = 'stand';
    this._setState(next);
  }

  _setState(next) {
    if (next === this.state) return;
    this.prevState = this.state;
    this.state = next;
    this.stateTime = 0;
  }

  _publish() {
    const c = this.character;
    this.position.set(c.position.x, c.position.y, c.position.z);
    const v = this.velocity;
    this.speed = Math.hypot(v.x, v.y, v.z);
    this.horizontalSpeed = Math.hypot(v.x, v.z);
  }

  /** Interpolated feet position for rendering. */
  sampleRender(alpha) {
    this.renderPosition.lerpVectors(this.prevPosition, this.position, clamp01(alpha));
    return this.renderPosition;
  }

  /* ==================================================================== */
  /* external control                                                     */
  /* ==================================================================== */

  teleport(x, y, z) {
    if (!this.character) return;
    this.mantleMotion.end();
    this.sliding = false;
    this.sprinting = false;
    this.tacticalSprint = false;
    this.stance = 'stand';
    this.stanceWant = 'stand';
    this.character.height = STANCE.stand.height;
    this.character.stepHeight = STANCE.stand.stepHeight;
    this.character.teleport(x, y, z);
    this.velocity.set(0, 0, 0);
    this.position.set(this.character.position.x, this.character.position.y, this.character.position.z);
    this.prevPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.grounded = this.character.grounded;
    this.wasGrounded = this.grounded;
    this.leanAmount = 0;
    this.leanOffsetX = this.leanOffsetZ = 0;
    this._stepDistance = 0;
    this._bobDistance = 0;
    this._bobPhase = 0;
    this._footHold = 0;
    this._jumpBuffer = 0;
    this.landEvent.pending = false;
    this.stepEvent.pending = false;
    this._setState('stand');
  }

  get bobDistance() {
    return this._bobDistance;
  }

  /** Radians of gait phase; pi per footfall. Drives the camera's figure-eight. */
  get stepPhase() {
    return this._bobPhase;
  }
}
