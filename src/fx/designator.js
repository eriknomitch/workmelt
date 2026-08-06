import * as THREE from 'three';

/**
 * Target-designator beam — the green laser the killstreak mortar is lased in
 * with (`match` drives it, see src/match/streaks.js).
 *
 * A laser is the one effect the particle layers are wrong for: it is a solid
 * line that has to be exactly where the player is pointing on the very frame
 * they point there, not a stream of short-lived sprites. So it is two ordinary
 * meshes — a thin open cylinder for the beam and a small sphere for the spot
 * where it lands — with an HDR-green additive material so the bloom pass gives
 * it the glow for free.
 *
 * Immediate-mode contract: the owner calls `set()` every frame the laser is
 * on, and `update()` hides it as soon as a frame goes by without one. There is
 * no on/off state to get out of sync with the caller.
 */

/** Beam core radius, metres. The bloom halo does the rest of the width. */
const RADIUS = 0.013;
/** Seconds without a `set()` before the beam considers itself switched off. */
const STALE = 0.12;

export class DesignatorBeam {
  constructor() {
    this.group = new THREE.Group();

    // Unit cylinder along +Y, re-oriented and stretched per frame.
    this._beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this._beamMat = new THREE.MeshBasicMaterial({
      // Slightly HDR green: just over 1.0 so the bloom pass gives it a soft
      // halo. Anything hotter (first pass was 3.4) blooms into a screen-filling
      // disc that swallows the crosshair — a laser has to be aimable through.
      color: new THREE.Color(0.12, 1.35, 0.3),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(this._beamGeo, this._beamMat);

    // The painted spot: a small sphere that swells as the lock ripens.
    this._dotGeo = new THREE.SphereGeometry(1, 10, 8);
    this._dotMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.25, 1.9, 0.5),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.dot = new THREE.Mesh(this._dotGeo, this._dotMat);

    for (const m of [this.beam, this.dot]) {
      m.visible = false;
      m.renderOrder = 11;
      m.frustumCulled = false;
      // Additive glow: no depth/velocity footprint, and it must not cast.
      m.userData.owNoPrepass = true;
      m.userData.owNoShadow = true;
      this.group.add(m);
    }

    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion();
    this._hit = false;
    this._progress = 0;
    this._seen = -Infinity;
  }

  /**
   * Refresh the beam for this frame.
   * @param {THREE.Vector3} from  world-space origin (the muzzle)
   * @param {THREE.Vector3} to    world-space end (the lased point, or where the
   *                              beam gives out when it found no surface)
   * @param {number} now          fx clock, seconds
   * @param {{hit?: boolean, progress?: number}} [opts]  `hit` marks a painted
   *   surface (draws the spot); `progress` 0..1 is how close the lock is.
   */
  set(from, to, now, opts) {
    this._from.copy(from);
    this._to.copy(to);
    this._hit = opts?.hit === true;
    this._progress = clamp01(opts?.progress ?? 0);
    this._seen = now;
  }

  update(now) {
    const on = now - this._seen <= STALE;
    this.beam.visible = on;
    this.dot.visible = on && this._hit;
    if (!on) return;

    this._dir.subVectors(this._to, this._from);
    const len = Math.max(1e-4, this._dir.length());
    this._dir.divideScalar(len);
    this.beam.position.copy(this._from).addScaledVector(this._dir, len * 0.5);
    this.beam.quaternion.setFromUnitVectors(this._up, this._dir);
    this.beam.scale.set(RADIUS, len, RADIUS);
    // A faint shimmer keeps it reading as light rather than geometry.
    this._beamMat.opacity = 0.55 + 0.08 * Math.sin(now * 31);

    if (this.dot.visible) {
      this.dot.position.copy(this._to);
      const p = this._progress;
      const pulse = 1 + 0.12 * Math.sin(now * 12);
      this.dot.scale.setScalar((0.045 + 0.09 * p) * pulse);
      this._dotMat.opacity = 0.65 + 0.35 * p;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this._beamGeo.dispose();
    this._beamMat.dispose();
    this._dotGeo.dispose();
    this._dotMat.dispose();
  }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
