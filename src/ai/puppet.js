/**
 * NetPuppet — a soldier body driven by the network instead of by the AI brain.
 *
 * It reuses the exact skinned soldier the AI ships (geometry, materials, rig and
 * `Animator`) so a remote player looks identical to an enemy, but it has NO
 * physics collider, NO character controller and NO senses/behaviour. The `net`
 * subsystem feeds it interpolated transforms every frame via `apply()`; this
 * class only turns those into an animated pose, exactly the way `Agent._drive`
 * does for a local AI.
 *
 * Created through `ai.createPuppet(variant, ...)` so all skeleton/animation code
 * stays inside `src/ai/` and `net` never imports another subsystem's modules.
 */
import * as THREE from 'three';
import { RIG } from './rig.js';
import { Animator } from './animator.js';

export class NetPuppet {
  constructor(ai, { variant = 'vanguard', position, yaw = 0, scale, livery = 0 } = {}) {
    this.ai = ai;
    this.ctx = ai.ctx;
    this.variantName = variant;
    const def = ai.variant(variant);
    this.def = def;
    this.scale = scale ?? def.variant.scale ?? 1;
    /**
     * The remote player's colour slot, assigned by the relay so every client
     * paints the same player the same colour. See `setLivery` — it can arrive
     * after the body does.
     */
    this.livery = livery;

    const { bones, skeleton, root } = RIG.createSkeleton();
    this.bones = bones;
    this.skeleton = skeleton;
    this.mesh = new THREE.SkinnedMesh(def.geometry, ai.materialsFor(variant, livery));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.group = new THREE.Group();
    this.group.name = 'netpuppet';
    this.group.add(root);
    this.group.add(this.mesh);
    this.mesh.bind(skeleton);
    this.group.scale.setScalar(this.scale);
    ai.root.add(this.group);

    this.position = new THREE.Vector3().copy(position ?? new THREE.Vector3());
    this.yaw = yaw;
    this.pitch = 0;
    this.speed = 0;
    this.crouch = false;
    this.aiming = false;
    this.dead = false;
    this.eyeHeight = RIG.eyeHeight * this.scale;

    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.group.updateMatrixWorld(true);

    this.animator = new Animator(RIG, bones, {
      weapon: def.weapon,
      rng: ai.rng.fork(),
      scale: this.scale,
      probe: (x, z, fromY, out) => this.ai.probeGround(x, z, fromY, out),
    });

    this._aimTarget = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this.clip = 'idle';
    this._prime();
  }

  /** Feet position + facing + coarse motion state, straight from the network. */
  apply({ position, yaw, pitch, speed, crouch, aiming, dead }) {
    if (position) this.position.copy(position);
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
    if (speed !== undefined) this.speed = speed;
    if (crouch !== undefined) this.crouch = crouch;
    if (aiming !== undefined) this.aiming = aiming;
    if (dead !== undefined) this.dead = dead;
  }

  /**
   * Recolour a body that is already in the scene.
   *
   * The relay assigns a colour slot on join, but a puppet is built from the
   * first snapshot that carries a peer, and a snapshot can beat the roster in.
   * Swapping the material array is the whole operation — the geometry, the
   * skeleton and the bind are untouched, and every livery of a slot shares one
   * compiled program, so this cannot stall on a shader compile.
   */
  setLivery(slot) {
    const s = slot | 0;
    if (s === this.livery) return;
    this.livery = s;
    this.mesh.material = this.ai.materialsFor(this.variantName, s);
  }

  /** One-shot muzzle recoil so a remote shot reads on the body too. */
  onFire() {
    this.animator.fire(1);
  }

  onHit(region = 'torso', side = 1, strength = 1) {
    this.animator.hit(region, side, strength);
  }

  /** World-space muzzle after the last pose update (for remote tracers). */
  get muzzleWorld() {
    return this.animator.muzzleWorld;
  }

  _aimVectorInto(out) {
    // Where this player is looking: forward from eye by yaw+pitch.
    const cp = Math.cos(this.pitch);
    this._fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    out.set(
      this.position.x + this._fwd.x * 12,
      this.position.y + this.eyeHeight + this._fwd.y * 12,
      this.position.z + this._fwd.z * 12
    );
    return out;
  }

  _prime() {
    this._aimVectorInto(this._aimTarget);
    this._look.copy(this._aimTarget);
    this.animator.setState({
      clip: 'idle', speed: 0, crouch: false,
      aimTarget: this._aimTarget, lookTarget: this._look, aimWeight: 0.85, suppress: 0,
    });
    this.animator.update(0.016, this.ctx.time.elapsed);
  }

  update(dt) {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.group.updateMatrixWorld(true);

    const moving = this.speed > 0.25;
    let clip;
    if (this.dead) clip = 'hurtIdle';
    else if (this.crouch) clip = moving ? 'crouchWalk' : 'crouchIdle';
    else if (this.speed > 2.6) clip = 'run';
    else if (moving) clip = 'walk';
    else clip = 'idle';
    this.clip = clip;

    this._aimVectorInto(this._aimTarget);
    this._look.copy(this._aimTarget);
    this.animator.setState({
      clip,
      speed: this.speed,
      crouch: this.crouch,
      aimTarget: this._aimTarget,
      lookTarget: this._look,
      aimWeight: this.aiming ? 1 : 0.7,
      suppress: 0,
    });
    this.animator.update(dt, this.ctx.time.elapsed);
  }

  setVisible(v) {
    this.group.visible = v;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.skeleton?.dispose?.();
  }
}
