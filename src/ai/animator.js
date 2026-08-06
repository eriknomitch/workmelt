/**
 * AI — the animation runtime: a small layered blend tree plus the three IK
 * solvers that make an armed character believable.
 *
 * LAYERS, in evaluation order
 *   1  locomotion base      idle / walk / run / crouch-walk / crouch-idle,
 *                           crossfaded, phase driven by real ground speed so
 *                           the feet never skate
 *   2  additive             aim, suppression flinch, reload body language,
 *                           firing recoil, per-region hit reactions
 *   3  one-shots            turn-in-place, vault (override weight ramps)
 *
 * IK, after the pose is written to the bones
 *   A  aim      — the spine chain is rotated until the weapon's bore points at
 *                 the aim target; the residual is spread over Spine1/Spine2 and
 *                 clamped, so the AI has to physically turn to cover a wide arc
 *   B  look-at  — neck and head lead the aim, clamped to human limits
 *   C  arm      — two-bone solve puts the support hand back on the handguard
 *                 (or on the magazine during a reload) after the spine moved
 *   D  foot     — ground probe per foot, two-bone solve per leg lifts a foot
 *                 that would sink into the ground, sole aligned to the normal.
 *                 The pelvis is never moved by it; see the note in _footIk.
 *
 * Everything is preallocated: `update()` does not allocate.
 */

import * as THREE from 'three';
import * as C from './clips.js';
import { BORE_DIR } from './rig.js';

const DEG = Math.PI / 180;

/** Pose accumulator handed to clip functions. */
class Poser {
  constructor(rig) {
    this.rig = rig;
    this.d3 = new Float32Array(rig.count * 3);
    this.hipOff = new THREE.Vector3();
    this.w = 1;
    // name -> index cache for the clip helpers
    this._idx = new Map();
    for (let i = 0; i < rig.count; i++) this._idx.set(rig.names[i], i);
  }

  reset() {
    this.d3.fill(0);
    this.hipOff.set(0, 0, 0);
    this.w = 1;
  }

  /** additive euler delta in degrees */
  d(name, x, y, z) {
    const i = this._idx.get(name);
    if (i === undefined) return;
    const w = this.w;
    this.d3[i * 3] += x * w;
    this.d3[i * 3 + 1] += y * w;
    this.d3[i * 3 + 2] += z * w;
  }

  hip(dx, dy, dz) {
    const w = this.w;
    this.hipOff.x += dx * w;
    this.hipOff.y += dy * w;
    this.hipOff.z += dz * w;
  }
}

export class Animator {
  /**
   * @param rig    the shared Rig
   * @param bones  this instance's THREE.Bone array (same order as the rig)
   * @param opts   { weapon, rng, probe, scale }
   */
  constructor(rig, bones, opts = {}) {
    this.rig = rig;
    this.bones = bones;
    this.weapon = opts.weapon ?? null;
    this.rng = opts.rng ?? null;
    this.probe = opts.probe ?? null;
    this.scale = opts.scale ?? 1;
    this.enabled = true;

    this.P = new Poser(rig);

    this.state = {
      clip: 'idle',
      speed: 0,
      crouch: false,
      aimTarget: null,
      lookTarget: null,
      aimWeight: 1,
      suppress: 0,
      hurt: 0,
    };

    this.phase = 0;
    /**
     * Foot contact for the frame just evaluated: 0 none, -1 left, +1 right.
     * Read it after update() — Agent and NetPuppet turn it into `actor:footstep`.
     * The animator itself stays event-free so it can run in the model preview
     * and the selftests with no ctx at all.
     */
    this.footPlant = 0;
    this._stepHalf = null; // which half of the stride we were in last update
    this.prevClip = 'idle';
    this.blend = 1; // weight of the current clip vs the previous one
    this.time = 0;

    // one-shot timers (negative = inactive)
    this.recoilT = -1;
    this.recoilK = 1;
    this.hitT = -1;
    this.hitRegion = 'torso';
    this.hitSide = 1;
    this.hitK = 1;
    this.reloadT = -1;
    this.reloadDur = 2.4;
    this.vaultT = -1;
    this.vaultDur = 0.85;
    this.turnT = -1;
    this.turnDir = 1;
    this.footIk = true;

    /* ---- indices we touch often ---- */
    this.iHips = rig.index('Hips');
    this.iSpine = rig.index('Spine');
    this.iSpine1 = rig.index('Spine1');
    this.iSpine2 = rig.index('Spine2');
    this.iNeck = rig.index('Neck');
    this.iHead = rig.index('Head');
    this.iHandR = rig.index('HandR');
    this.armL = [rig.index('UpperArmL'), rig.index('ForearmL'), rig.index('HandL')];
    this.armR = [rig.index('UpperArmR'), rig.index('ForearmR'), rig.index('HandR')];
    this.legs = [
      [rig.index('UpLegR'), rig.index('LegR'), rig.index('FootR')],
      [rig.index('UpLegL'), rig.index('LegL'), rig.index('FootL')],
    ];

    /* ---- weapon anchors, expressed in HandR bind-local space ---- */
    const qInv = rig.bindQuat[this.iHandR].clone().invert();
    const handPos = rig.bindPos[this.iHandR];
    const toLocal = (p) =>
      new THREE.Vector3(p[0] - handPos.x, p[1] - handPos.y, p[2] - handPos.z).applyQuaternion(qInv);
    this.boreLocal = new THREE.Vector3(...BORE_DIR).applyQuaternion(qInv).normalize();
    this.muzzleLocal = this.weapon ? toLocal(this.weapon.muzzle) : new THREE.Vector3(0, 0, 0.4);
    this.foregripLocal = this.weapon ? toLocal(this.weapon.foregrip) : new THREE.Vector3(0, 0, 0.2);
    this.magLocal = this.weapon ? toLocal(this.weapon.magBottom) : new THREE.Vector3(0, -0.2, 0);
    this.ejectLocal = this.weapon ? toLocal(this.weapon.ejection) : new THREE.Vector3(0, 0, 0);

    /* ---- scratch ---- */
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._qc = new THREE.Quaternion();
    this._qd = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._v5 = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._probeOut = { y: 0, nx: 0, ny: 1, nz: 0, hit: false };
    this._footY = [0, 0];
    this._footN = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    this._aimApplied = 0;
    this.muzzleWorld = new THREE.Vector3();
    this.muzzleDir = new THREE.Vector3(0, 0, 1);
    this.ejectWorld = new THREE.Vector3();
  }

  setState(s) {
    const st = this.state;
    if (s.clip !== undefined && s.clip !== st.clip) {
      this.prevClip = st.clip;
      this.blend = 0;
      st.clip = s.clip;
    }
    if (s.speed !== undefined) st.speed = s.speed;
    if (s.crouch !== undefined) st.crouch = s.crouch;
    if (s.aimTarget !== undefined) st.aimTarget = s.aimTarget;
    if (s.lookTarget !== undefined) st.lookTarget = s.lookTarget;
    if (s.aimWeight !== undefined) st.aimWeight = s.aimWeight;
    if (s.suppress !== undefined) st.suppress = s.suppress;
    if (s.hurt !== undefined) st.hurt = s.hurt;
  }

  /* ---------------- one-shot triggers ---------------- */

  fire(strength = 1) {
    this.recoilT = 0;
    this.recoilK = strength;
  }

  hit(region = 'torso', side = 1, strength = 1) {
    this.hitT = 0;
    this.hitRegion = region;
    this.hitSide = side;
    this.hitK = strength;
  }

  reload(duration = 2.4) {
    this.reloadT = 0;
    this.reloadDur = duration;
  }

  get reloading() {
    return this.reloadT >= 0;
  }

  vault(duration = 0.85) {
    this.vaultT = 0;
    this.vaultDur = duration;
  }

  get vaulting() {
    return this.vaultT >= 0;
  }

  turn(dir) {
    if (this.turnT >= 0) return;
    this.turnT = 0;
    this.turnDir = dir >= 0 ? 1 : -1;
  }

  /* ---------------- main ---------------- */

  update(dt, now) {
    if (!this.enabled) return;
    this.time = now;
    const st = this.state;
    const P = this.P;

    /* --- phase advance: stride length keeps the feet stuck to the ground --- */
    const clip = st.clip;
    const strideHz =
      clip === 'run' ? Math.max(1.1, st.speed / 2.05)
        : clip === 'walk' ? Math.max(0.55, st.speed / 1.42)
          : clip === 'crouchWalk' ? Math.max(0.4, st.speed / 0.95)
            : 0.19; // idle breathing rate
    this.phase = (this.phase + dt * strideHz) % 1;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / 0.18);

    /* --- foot contact -------------------------------------------------------
     * gait() puts the pelvis bob at cos(2t), so it bottoms out a quarter and
     * three quarters through the stride — the same instants the thigh reaches
     * full forward swing. That is the weight transfer, so it is where a step
     * sounds. Tracking which half of [0.25, 0.75) we are in survives the phase
     * wrap and the animation-rate LOD, which hands us an accumulated dt rather
     * than skipping phase. Idle clips still advance phase (breathing), so only
     * a locomotion clip may plant. */
    this.footPlant = 0;
    const half = ((this.phase - 0.25 + 1) % 1) < 0.5 ? 0 : 1;
    if (half !== this._stepHalf) {
      // null on the first update and after a rig reset: sync without planting,
      // so a body never steps on the frame it appears.
      if (this._stepHalf !== null && (clip === 'walk' || clip === 'run' || clip === 'crouchWalk')) {
        this.footPlant = half === 0 ? 1 : -1;
      }
      this._stepHalf = half;
    }

    /* --- layer 1: locomotion, crossfaded --- */
    P.reset();
    const fn = C.CLIPS[clip] ?? C.idle;
    const prev = C.CLIPS[this.prevClip] ?? C.idle;
    if (this.blend < 1) {
      P.w = 1 - this.blend;
      prev(P, this.phase);
      P.w = this.blend;
      fn(P, this.phase);
    } else {
      P.w = 1;
      fn(P, this.phase);
    }

    /* --- layer 2: additives --- */
    P.w = 1;
    if (st.aimWeight > 0 && !this.vaulting) C.aimAdd(P, st.aimWeight * (1 - (this.reloadT >= 0 ? 0.6 : 0)));
    if (st.suppress > 0) C.suppressAdd(P, Math.min(1, st.suppress));
    if (this.recoilT >= 0) {
      C.recoilAdd(P, this.recoilT, this.recoilK);
      this.recoilT += dt;
      if (this.recoilT > 0.3) this.recoilT = -1;
    }
    if (this.hitT >= 0) {
      C.hitAdd(P, this.hitRegion, this.hitT, this.hitSide, this.hitK);
      this.hitT += dt;
      if (this.hitT > 0.55) this.hitT = -1;
    }
    if (this.reloadT >= 0) {
      C.reloadAdd(P, this.reloadT / this.reloadDur);
      this.reloadT += dt;
      if (this.reloadT > this.reloadDur) this.reloadT = -1;
    }
    if (this.turnT >= 0) {
      C.turnStep(P, this.turnT / 0.42, this.turnDir);
      this.turnT += dt;
      if (this.turnT > 0.42) this.turnT = -1;
    }
    if (this.vaultT >= 0) {
      const t = this.vaultT / this.vaultDur;
      P.w = 1;
      C.vault(P, t);
      this.vaultT += dt;
      if (this.vaultT > this.vaultDur) this.vaultT = -1;
    }

    /* --- write the pose --- */
    this._writePose();

    /* --- IK --- */
    const root = this.bones[0];
    root.updateMatrixWorld(true);

    if (this.footIk && !this.vaulting) this._footIk();
    if (st.aimTarget && st.aimWeight > 0.01 && !this.vaulting) this._aimIk(st.aimTarget, st.aimWeight);
    if (st.lookTarget) this._lookAt(st.lookTarget, Math.max(0.35, st.aimWeight));
    this._supportHandIk();
    this._updateMuzzle();
  }

  _writePose() {
    const rig = this.rig;
    const bones = this.bones;
    const d3 = this.P.d3;
    const e = this._e;
    const q = this._q;
    for (let i = 0; i < rig.count; i++) {
      const x = d3[i * 3], y = d3[i * 3 + 1], z = d3[i * 3 + 2];
      const b = bones[i];
      if (x || y || z) {
        e.set(x * DEG, y * DEG, z * DEG, 'XYZ');
        q.setFromEuler(e);
        b.quaternion.copy(rig.localQuat[i]).multiply(q);
      } else {
        b.quaternion.copy(rig.localQuat[i]);
      }
      if (i === 0) {
        b.position.copy(rig.localPos[i]).add(this.P.hipOff);
      } else {
        b.position.copy(rig.localPos[i]);
      }
      b.updateMatrix();
    }
  }

  /* ---------------- helpers on world transforms ---------------- */

  _wp(i, out) {
    const m = this.bones[i].matrixWorld.elements;
    return out.set(m[12], m[13], m[14]);
  }

  _wq(i, out) {
    return this.bones[i].getWorldQuaternion(out);
  }

  /** Rotate bone `i` in world space by quaternion `dq`, keeping its position. */
  _applyWorld(i, dq) {
    const b = this.bones[i];
    const parent = b.parent;
    // NOTE: private scratch — callers pass their own quaternions in as `dq`,
    // so this must never reuse the shared _q/_q2/_q3 slots.
    const q = this._qa;
    if (parent) parent.getWorldQuaternion(q);
    else q.identity();
    const cur = this._qb.copy(q).multiply(b.quaternion); // current world
    cur.premultiply(dq);
    b.quaternion.copy(q.invert()).multiply(cur);
    b.updateMatrix();
    b.updateMatrixWorld(true);
  }

  /** Point bone `i`'s +Y axis along `dir` (world, unit), preserving twist. */
  _aimBone(i, dir) {
    const b = this.bones[i];
    const wq = this._wq(i, this._qc);
    const cur = this._v5.set(0, 1, 0).applyQuaternion(wq);
    const dq = this._qd.setFromUnitVectors(cur, dir);
    this._applyWorld(i, dq);
    return b;
  }

  /* ---------------- A: aim ---------------- */

  _aimIk(target, weight) {
    const spread = [
      [this.iSpine, 0.12],
      [this.iSpine1, 0.34],
      [this.iSpine2, 0.54],
    ];
    for (let iter = 0; iter < 2; iter++) {
      const hand = this.bones[this.iHandR];
      const bore = this._v.copy(this.boreLocal).applyQuaternion(this._wq(this.iHandR, this._q2)).normalize();
      const muzzle = this._v2.copy(this.muzzleLocal).applyMatrix4(hand.matrixWorld);
      const want = this._v3.copy(target).sub(muzzle);
      if (want.lengthSq() < 1e-6) return;
      want.normalize();
      const dot = Math.min(1, Math.max(-1, bore.dot(want)));
      let ang = Math.acos(dot) * weight;
      if (ang < 0.0015) return;
      // clamp how far the spine will twist before the body has to turn
      const maxThisIter = iter === 0 ? 0.9 : 0.35;
      if (ang > maxThisIter) ang = maxThisIter;
      const axis = this._v4.crossVectors(bore, want);
      if (axis.lengthSq() < 1e-10) return;
      axis.normalize();
      for (const [bi, f] of spread) {
        this._q3.setFromAxisAngle(axis, ang * f);
        this._applyWorld(bi, this._q3);
      }
    }
  }

  /* ---------------- B: look-at ---------------- */

  _lookAt(target, weight) {
    // the head's forward is its local +Z
    const chain = [
      [this.iNeck, 0.4],
      [this.iHead, 0.6],
    ];
    for (const [bi, f] of chain) {
      const wq = this._wq(bi, this._q2);
      const fwd = this._v.set(0, 0, 1).applyQuaternion(wq);
      const want = this._v2.copy(target).sub(this._wp(bi, this._v3));
      if (want.lengthSq() < 1e-6) return;
      want.normalize();
      const dot = Math.min(1, Math.max(-1, fwd.dot(want)));
      let ang = Math.acos(dot) * weight * f;
      if (ang < 0.002) continue;
      if (ang > 0.5) ang = 0.5; // ~29 deg per bone per frame cap
      const axis = this._v4.crossVectors(fwd, want);
      if (axis.lengthSq() < 1e-10) continue;
      axis.normalize();
      this._q3.setFromAxisAngle(axis, ang);
      this._applyWorld(bi, this._q3);
    }
  }

  /* ---------------- C: support hand ---------------- */

  _supportHandIk() {
    const hand = this.bones[this.iHandR];
    const t = this._target;
    if (this.vaulting) return;
    if (this.reloadT >= 0) {
      const p = this.reloadT / this.reloadDur;
      // magwell -> chest pouch -> magwell -> slap -> back to the handguard
      const mag = this._v.copy(this.magLocal).applyMatrix4(hand.matrixWorld);
      const grip = this._v2.copy(this.foregripLocal).applyMatrix4(hand.matrixWorld);
      // chest pouch in world space, from the actor root
      const chest = this._v3.set(0.02, 1.19, 0.17).applyMatrix4(this.bones[0].parent.matrixWorld);
      if (p < 0.18) t.copy(grip).lerp(mag, p / 0.18);
      else if (p < 0.42) t.copy(mag).lerp(chest, (p - 0.18) / 0.24);
      else if (p < 0.62) t.copy(chest).lerp(mag, (p - 0.42) / 0.20);
      else if (p < 0.78) t.copy(mag);
      else t.copy(mag).lerp(grip, (p - 0.78) / 0.22);
    } else {
      t.copy(this.foregripLocal).applyMatrix4(hand.matrixWorld);
    }
    // pole: elbow down and out to the character's left
    this._pole.set(0.6, -1, -0.25).applyQuaternion(this.bones[0].parent.getWorldQuaternion(this._q2));
    this._twoBone(this.armL, t, this._pole);
  }

  /* ---------------- D: feet ---------------- */

  _footIk() {
    if (!this.probe) return;
    const s = this.scale;
    const ankleH = 0.088 * s;
    for (let k = 0; k < 2; k++) {
      const ankle = this._wp(this.legs[k][2], this._v);
      const ok = this.probe(ankle.x, ankle.z, ankle.y + 0.55 * s, this._probeOut);
      if (!ok) {
        this._footY[k] = ankle.y;
        this._footN[k].set(0, 1, 0);
        continue;
      }
      this._footY[k] = this._probeOut.y + ankleH;
      this._footN[k].set(this._probeOut.nx, this._probeOut.ny, this._probeOut.nz);
    }

    /* NOTE: there is deliberately no pelvis drop here.
     *
     * There used to be one, meant to keep both feet planted over uneven ground.
     * It compared each ankle against the ground and took the largest *downward*
     * correction — which is always the SWING foot, the one that is supposed to
     * be in the air. So it hauled the hips down until the lifted foot reached
     * the floor and the solve below then welded it there: both ankles pinned at
     * ground height every frame, the whole body heaving instead of the legs
     * striding. That was the enemy "bobble" — 10 cm peak-to-peak at a walk and
     * 21 cm at a run, against 2 cm of authored pelvis bob.
     *
     * A correct version would move the hips only when a *planted* foot is out
     * of the leg's reach, but the solve below never lowers a foot (it clamps to
     * `max(groundY, ankleY)`), so a planted foot can never be out of reach and
     * the test can never fire. Per-foot ground contact is the solve's job
     * alone; if the hips ever need to track terrain, that belongs in the
     * character controller's capsule, not here. */
    for (let k = 0; k < 2; k++) {
      const leg = this.legs[k];
      const ankle = this._wp(leg[2], this._v);
      const target = this._target.set(ankle.x, Math.max(this._footY[k], ankle.y - 0.001), ankle.z);
      // knee pole: forward, in the actor's facing
      this._pole
        .set(k === 0 ? -0.12 : 0.12, 0.05, 1)
        .applyQuaternion(this.bones[0].parent.getWorldQuaternion(this._q2));
      this._twoBone(leg, target, this._pole);
      // roll the sole onto the ground plane
      const n = this._footN[k];
      if (n.y < 0.999) {
        const foot = leg[2];
        const up = this._v2.set(0, 0, 1).applyQuaternion(this._wq(foot, this._q2));
        const dot = Math.min(1, Math.max(-1, up.dot(n)));
        let ang = Math.acos(dot);
        if (ang > 0.35) ang = 0.35;
        const axis = this._v4.crossVectors(up, n);
        if (axis.lengthSq() > 1e-10) {
          axis.normalize();
          this._q3.setFromAxisAngle(axis, ang);
          this._applyWorld(foot, this._q3);
        }
      }
    }
  }

  /* ---------------- two-bone solver ---------------- */

  /**
   * Classic analytic two-bone IK. `chain` = [upper, lower, end] bone indices.
   * Preserves the bones' twist and never over-extends.
   */
  _twoBone(chain, target, pole) {
    const [iu, il, ie] = chain;
    const A = this._wp(iu, this._v);
    const B = this._wp(il, this._v2);
    const Cp = this._wp(ie, this._v3);
    const l1 = A.distanceTo(B);
    const l2 = B.distanceTo(Cp);
    if (l1 < 1e-5 || l2 < 1e-5) return;
    const dir = this._v4.copy(target).sub(A);
    let d = dir.length();
    if (d < 1e-5) return;
    dir.multiplyScalar(1 / d);
    const min = Math.abs(l1 - l2) + 1e-4;
    const max = l1 + l2 - 1e-4;
    d = Math.min(max, Math.max(min, d));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // pole component perpendicular to the limb axis
    const perp = this._elbow.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0).addScaledVector(dir, -dir.y);
    perp.normalize();
    // elbow/knee position
    const ex = A.x + dir.x * a + perp.x * h;
    const ey = A.y + dir.y * a + perp.y * h;
    const ez = A.z + dir.z * a + perp.z * h;
    // upper segment
    const toE = this._elbow.set(ex - A.x, ey - A.y, ez - A.z);
    if (toE.lengthSq() < 1e-10) return;
    this._aimBone(iu, toE.normalize());
    // lower segment (world matrices refreshed by _aimBone)
    const B2 = this._wp(il, this._v2);
    const toT = this._elbow.set(target.x - B2.x, target.y - B2.y, target.z - B2.z);
    if (toT.lengthSq() < 1e-10) return;
    this._aimBone(il, toT.normalize());
  }

  /* ---------------- outputs for FX / ballistics ---------------- */

  _updateMuzzle() {
    const hand = this.bones[this.iHandR];
    this.muzzleWorld.copy(this.muzzleLocal).applyMatrix4(hand.matrixWorld);
    this.ejectWorld.copy(this.ejectLocal).applyMatrix4(hand.matrixWorld);
    this.muzzleDir
      .copy(this.boreLocal)
      .applyQuaternion(hand.getWorldQuaternion(this._q2))
      .normalize();
  }

  /** World position of a bone, for hitboxes and FX. */
  bonePos(name, out) {
    return this._wp(this.rig.index(name), out);
  }
}
