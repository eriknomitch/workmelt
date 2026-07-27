import * as THREE from 'three';
import { clamp01, lerp } from './mathx.js';

/**
 * THROWABLES — the player's lethal / tactical equipment: cook, arc preview,
 * throw, bounce and detonate.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE BALLISTIC SOLVE IS NOT SHARED WITH `ai`
 * `src/ai` throws grenades too (`ai/index.js#throwGrenade`) and solves a lob
 * that lands ON a known target point. This one throws along the camera bore at
 * a speed set by how long the pin was held — there is no target to solve for,
 * so the two are genuinely different problems, not duplicated code. Even if
 * they converged, hard rule 2 in ARCHITECTURE.md forbids importing across
 * subsystems and the shared home (`src/core/`) is lead-owned.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LIFECYCLE
 *   beginCook(slot)  pin out, fuse starts burning, arc preview appears
 *   release()        leaves the hand with the REMAINING fuse
 *   cancelCook()     pause / death / weapon swap — the round is spent, not
 *                    silently refunded, because the pin is already gone
 *   fuse <= 0 in hand -> cooks off on the player, which is the whole risk of
 *                    cooking and the reason the mechanic has any tension
 *
 * Detonation emits a canonical `explosion` for frags (physics applies impulse,
 * player/ai apply damage, fx draws it) and `equipment:flash` for stuns.
 */

/** Trajectory preview resolution. Fixed so the buffer can be preallocated. */
const ARC_POINTS = 28;
const ARC_STEP = 0.055;

export const THROWABLE_DEFS = {
  frag: {
    id: 'frag',
    label: 'FRAG',
    slot: 'lethal',
    capacity: 2,
    fuse: 3.1,
    /** Speed on an instant tap vs. a full wind-up, and the time between them. */
    tapSpeed: 9.5,
    throwSpeed: 18.5,
    windup: 0.3,
    /** Fraction of the throw speed added as +Y, so a flat look still arcs. */
    upBias: 0.2,
    radius: 6.5,
    damage: 120,
    mass: 0.42,
    bodyRadius: 0.05,
    restitution: 0.26,
    friction: 0.72,
    surfaceType: 'metal',
    colour: 0x2c3226,
    arcColour: 0xffb648,
  },
  stun: {
    id: 'stun',
    label: 'STUN',
    slot: 'tactical',
    capacity: 2,
    fuse: 1.7,
    tapSpeed: 10.5,
    throwSpeed: 20,
    windup: 0.26,
    upBias: 0.17,
    radius: 11,
    damage: 0,
    /** Seconds of full whiteout at point blank, ramped down by range + angle. */
    flashDuration: 3.6,
    mass: 0.28,
    bodyRadius: 0.042,
    restitution: 0.34,
    friction: 0.6,
    surfaceType: 'metal',
    colour: 0x9aa3ad,
    arcColour: 0x8fd8ff,
  },
};

export class Throwables {
  /**
   * @param {object} ctx engine context
   * @param {object} weapons owning WeaponSystem — read for viewmodel/player
   */
  constructor(ctx, weapons) {
    this.ctx = ctx;
    this.weapons = weapons;
    this.phys = null;

    /** Remaining rounds per slot, the source of truth the HUD reads. */
    this.counts = { lethal: THROWABLE_DEFS.frag.capacity, tactical: THROWABLE_DEFS.stun.capacity };

    /** Non-null while the pin is out. `{ def, held, fuse }` */
    this.cook = null;
    /** Live thrown rounds: `{ def, body, mesh, fuse }` */
    this.live = [];

    this._geo = new Map();
    this._mat = new Map();
    this._arc = null;
    this._arcPositions = null;
    this._arcMat = null;

    // Preallocated scratch — nothing in here may allocate per frame.
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this._explosion = { position: new THREE.Vector3(), radius: 0, damage: 0, source: 'player' };
    this._flash = {
      position: new THREE.Vector3(),
      radius: 0,
      duration: 0,
      source: 'player',
    };
  }

  init() {
    this.phys = this.ctx.peek('physics');
    for (const def of Object.values(THROWABLE_DEFS)) {
      this._geo.set(def.id, new THREE.IcosahedronGeometry(def.bodyRadius, 1));
      this._mat.set(
        def.id,
        new THREE.MeshStandardMaterial({
          color: def.colour,
          roughness: def.id === 'stun' ? 0.38 : 0.62,
          metalness: 0.85,
        })
      );
    }
    this._buildArc();
  }

  /** The trajectory preview: one polyline, rewritten in place while cooking. */
  _buildArc() {
    const geo = new THREE.BufferGeometry();
    this._arcPositions = new Float32Array(ARC_POINTS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._arcPositions, 3));
    geo.setDrawRange(0, 0);
    this._arcMat = new THREE.LineBasicMaterial({
      color: THROWABLE_DEFS.frag.arcColour,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this._arc = new THREE.Line(geo, this._arcMat);
    this._arc.frustumCulled = false;
    this._arc.visible = false;
    // The preview is a gameplay aid, not scene content: keep it out of the
    // depth/normal prepass and the shadow cascades (ARCHITECTURE.md).
    this._arc.userData.owNoPrepass = true;
    this._arc.userData.owNoShadow = true;
    this.ctx.scene.add(this._arc);
  }

  /* ====================================================================== */
  /*  cook / throw                                                          */
  /* ====================================================================== */

  get cooking() {
    return this.cook !== null;
  }

  /** @param {'lethal'|'tactical'} slot */
  beginCook(slot) {
    if (this.cook) return false;
    const def = slot === 'tactical' ? THROWABLE_DEFS.stun : THROWABLE_DEFS.frag;
    if (this.counts[def.slot] <= 0) return false;
    this.cook = { def, held: 0, fuse: def.fuse };
    this._arcMat.color.setHex(def.arcColour);
    return true;
  }

  /**
   * Let go. The round leaves with whatever fuse is left, so a cooked frag can
   * air-burst. Returns true if something was actually thrown.
   */
  release() {
    const c = this.cook;
    if (!c) return false;
    this.cook = null;
    this._arc.visible = false;

    const def = c.def;
    this.counts[def.slot] = Math.max(0, this.counts[def.slot] - 1);

    const speed = lerp(def.tapSpeed, def.throwSpeed, clamp01(c.held / def.windup));
    this._throwOrigin(this._origin);
    this._throwDir(this._dir);

    this._v.copy(this._dir).multiplyScalar(speed);
    this._v.y += speed * def.upBias;
    // Inherit the thrower's motion, or a grenade thrown while sprinting hangs
    // behind the player and lands at their feet.
    const pv = this.weapons.player?.velocity;
    if (pv) this._v.add(pv);

    this._spawn(def, this._origin, this._v, c.fuse);
    return true;
  }

  /**
   * The pin is gone, so a cancel still spends the round — it just detonates
   * where it lies rather than in the player's hand. Called on pause, death and
   * weapon swap.
   */
  cancelCook() {
    if (!this.cook) return;
    this.release();
  }

  _spawn(def, position, velocity, fuse) {
    const mesh = new THREE.Mesh(this._geo.get(def.id), this._mat.get(def.id));
    mesh.userData.owNoShadow = true;
    this.ctx.scene.add(mesh);
    const body = this.phys?.addRigidBody({
      shape: 'sphere',
      radius: def.bodyRadius,
      mass: def.mass,
      position,
      velocity,
      restitution: def.restitution,
      friction: def.friction,
      lifetime: Math.max(4, fuse + 2),
      object3D: mesh,
      surfaceType: def.surfaceType,
    });
    if (!body) mesh.position.copy(position);
    this.live.push({ def, body, mesh, fuse });
  }

  /** Muzzle-ish release point: eye height, slightly forward and to the right. */
  _throwOrigin(out) {
    const cam = this.ctx.camera;
    out.copy(cam.position);
    this._step.set(0.22, -0.1, -0.35).applyQuaternion(cam.quaternion);
    out.add(this._step);
    return out;
  }

  _throwDir(out) {
    this.ctx.camera.getWorldDirection(out);
    return out.normalize();
  }

  /* ====================================================================== */
  /*  frame                                                                 */
  /* ====================================================================== */

  update(dt) {
    const c = this.cook;
    if (c) {
      c.held += dt;
      c.fuse -= dt;
      if (c.fuse <= 0) {
        // Cooked off in the hand. Spend the round and detonate on the player.
        const def = c.def;
        this.cook = null;
        this._arc.visible = false;
        this.counts[def.slot] = Math.max(0, this.counts[def.slot] - 1);
        this._throwOrigin(this._p);
        this._detonate(def, this._p);
      } else {
        this._updateArc(c.def);
      }
    } else if (this._arc.visible) {
      this._arc.visible = false;
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      if (g.fuse > 0) continue;
      const p = g.body?.position ?? g.mesh.position;
      this._p.set(p.x, p.y, p.z);
      this._detonate(g.def, this._p);
      if (g.body) this.phys?.removeRigidBody(g.body);
      this.ctx.scene.remove(g.mesh);
      this.live.splice(i, 1);
    }
  }

  _detonate(def, position) {
    if (def.id === 'stun') {
      const p = this._flash;
      p.position.copy(position);
      p.radius = def.radius;
      p.duration = def.flashDuration;
      p.source = 'player';
      this.ctx.events.emit('equipment:flash', p);
      return;
    }
    const p = this._explosion;
    p.position.copy(position);
    p.radius = def.radius;
    p.damage = def.damage;
    p.source = 'player';
    this.ctx.events.emit('explosion', p);
  }

  /**
   * Integrate the predicted path and stop it at the first wall. Runs only while
   * cooking, so the raycast cost is bounded to one held key.
   */
  _updateArc(def) {
    const g = this.phys?.gravity ?? -9.81;
    const speed = lerp(def.tapSpeed, def.throwSpeed, clamp01(this.cook.held / def.windup));
    this._throwOrigin(this._p);
    this._throwDir(this._dir);
    this._v.copy(this._dir).multiplyScalar(speed);
    this._v.y += speed * def.upBias;
    const pv = this.weapons.player?.velocity;
    if (pv) this._v.add(pv);

    const pos = this._arcPositions;
    let n = 0;
    pos[0] = this._p.x;
    pos[1] = this._p.y;
    pos[2] = this._p.z;
    n = 1;

    for (let i = 1; i < ARC_POINTS; i++) {
      this._step.copy(this._v).multiplyScalar(ARC_STEP);
      const segLen = this._step.length();
      let stop = false;
      if (this.phys && segLen > 1e-4) {
        this._dir.copy(this._step).multiplyScalar(1 / segLen);
        const hit = this.phys.raycast(this._p, this._dir, segLen, this.phys.MASK.WORLD);
        if (hit && hit.hit) {
          this._p.copy(hit.point ?? this._p);
          stop = true;
        }
      }
      if (!stop) {
        this._p.add(this._step);
        this._v.y += g * ARC_STEP;
      }
      pos[n * 3] = this._p.x;
      pos[n * 3 + 1] = this._p.y;
      pos[n * 3 + 2] = this._p.z;
      n++;
      if (stop) break;
    }

    this._arc.geometry.setDrawRange(0, n);
    this._arc.geometry.attributes.position.needsUpdate = true;
    this._arc.visible = n > 1;
  }

  /** Restock on respawn. */
  refill() {
    this.counts.lethal = THROWABLE_DEFS.frag.capacity;
    this.counts.tactical = THROWABLE_DEFS.stun.capacity;
  }

  dispose() {
    for (const g of this.live) {
      if (g.body) this.phys?.removeRigidBody(g.body);
      this.ctx.scene.remove(g.mesh);
    }
    this.live.length = 0;
    this.cook = null;
    for (const g of this._geo.values()) g.dispose();
    for (const m of this._mat.values()) m.dispose();
    this._geo.clear();
    this._mat.clear();
    if (this._arc) {
      this.ctx.scene.remove(this._arc);
      this._arc.geometry.dispose();
      this._arcMat.dispose();
      this._arc = null;
    }
  }
}
