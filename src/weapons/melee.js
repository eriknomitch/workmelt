import * as THREE from 'three';

/**
 * MELEE — the quick strike on V: a weapon-butt jab that closes the last two
 * metres of a fight without asking the magazine's permission.
 *
 * It is a separate key, not a weapon slot: pressing it plays the `melee` clip
 * on whatever is in the hands, the hit lands on the clip's `strike` beat so the
 * damage arrives when the butt visibly connects, and the whole exchange is
 * bounded by one recovery window — no combos, no lunge, no holstering.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE HIT TEST
 * A melee that only connects on a pixel-perfect centre ray feels broken at the
 * range it exists for, so the strike is FORGIVING: a fan of rays approximating
 * a 0.58 m-wide capsule at full reach — three lateral offsets by three heights
 * around the camera bore (`FAN`, pinned by the self-test). Each ray is a real
 * `physics.raycast` against MASK.BULLET, which is what makes cover honest: a
 * ray that meets a wall before flesh hits the wall, closest-hit, and there is
 * no way to stab through a barricade the round could not cross.
 *
 * Bots are settled here — the nearest actor across the fan takes the damage as
 * a `damage:dealt`, exactly the payload physics emits for a bullet, so the
 * hitmarker, the killfeed, the killstreak counter and the announcer all work
 * without knowing melee exists. Remote players carry no actor colliders, so the
 * fan cannot see them: `net` listens to `weapon:melee` and runs the same reach
 * and backstab arithmetic against its own puppet capsules (`_onLocalMelee`),
 * reading the numbers off `weapons.melee` so the two damage models cannot
 * drift apart — the same contract as `damageAt()`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE BACKSTAB
 * 45 from the front or side leaves the victim alive and turning; 100 from
 * inside the victim's rear cone is the kill the flank earned. The cone is the
 * dot of the victim's facing with the unit vector back at the attacker, in the
 * ground plane: `facing · toAttacker <= -0.45` (about a 127° arc behind them).
 * Height is deliberately ignored — a backstab from a balcony is still a
 * backstab.
 *
 * EVENTS EMITTED
 *   weapon:melee   { origin, dir, reach, damage }  every swing, on the strike
 *                  beat, hit or miss — `net` settles PvP off it and `audio`/
 *                  `fx` may score the swing itself
 *   damage:dealt   { target, amount, headshot, killed, point, part, incident }
 *                  only when the fan finds an actor — same shape physics emits
 */

export const MELEE = {
  /** Metres from the eye the strike can connect at. */
  reach: 2.1,
  /** Radius of the forgiveness capsule the ray fan approximates. */
  radius: 0.29,
  /** Damage from the front or side — two swings against full health. */
  damage: 45,
  /** Damage from inside the victim's rear cone — always lethal on 100 HP. */
  backstabDamage: 100,
  /** Backstab when `facing · toAttacker` is at or below this. */
  backstabDot: -0.45,
  /** Seconds from one swing to the next being accepted. */
  recovery: 0.656,
  /** Length of the viewmodel swing clip; must fit inside the recovery. */
  swing: 0.6,
  /** Fraction of the swing at which the strike beat lands. */
  strikeAt: 0.26,
};

/** True when a hit from `dot` (= facing · toAttacker, ground plane) is a backstab. */
export function isBackstab(dot) {
  return dot <= MELEE.backstabDot;
}

/** What one strike does, given the facing dot. `net` reads this via the instance. */
export function meleeDamageFor(dot) {
  return isBackstab(dot) ? MELEE.backstabDamage : MELEE.damage;
}

/**
 * The ray fan, as tangent-space offsets from the camera bore: three lateral by
 * three vertical, spanning the forgiveness capsule's radius at full reach.
 * Centre ray first so an exact aim always wins ties at equal distance.
 */
export function buildFan() {
  const t = MELEE.radius / MELEE.reach;
  const fan = [{ x: 0, y: 0 }];
  for (const y of [-1, 0, 1]) {
    for (const x of [-1, 0, 1]) {
      if (x === 0 && y === 0) continue;
      fan.push({ x: x * t, y: y * t });
    }
  }
  return fan;
}

export class Melee {
  /**
   * @param {object} ctx engine context
   * @param {object} weapons owning WeaponSystem — read for viewmodel/player
   */
  constructor(ctx, weapons) {
    this.ctx = ctx;
    this.weapons = weapons;
    this.def = MELEE;
    this.fan = buildFan();
    /** Seconds until the next swing is accepted; <= 0 means ready. */
    this.cooldown = 0;

    // Preallocated scratch — the strike runs at most once per recovery window.
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._ray = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._incident = new THREE.Vector3();
    this._swingPayload = { origin: this._origin, dir: this._dir, reach: MELEE.reach, damage: MELEE.damage };
    this._hitPayload = {
      target: null,
      amount: 0,
      headshot: false,
      killed: false,
      point: this._point,
      part: 'torso',
      incident: this._incident,
    };
  }

  /** `net` calls this so PvP and PvE agree on the backstab arithmetic. */
  damageFor(dot) {
    return meleeDamageFor(dot);
  }

  get ready() {
    return this.cooldown <= 0;
  }

  /**
   * Start a swing. Refused inside the recovery window and whenever the hands
   * are already committed — a reload, a weapon switch or a cooked grenade all
   * own the weapon hand. An inspect is idle by definition and is cut short.
   * Returns true when the swing actually started.
   */
  attack() {
    if (this.cooldown > 0) return false;
    const wp = this.weapons;
    if (wp.reloading || wp.switching || wp.throwables?.cooking) return false;
    if (wp.inspecting) wp.viewmodel.stopClip();
    this.cooldown = MELEE.recovery;
    wp.viewmodel.play('melee');
    // The body throws the strike, not just the arms: a short camera dip that
    // reads as weight without disturbing the aim the way a shot does.
    wp.player?.addRecoil?.(0.012, 0.003, 0.04, 0.55);
    return true;
  }

  /**
   * The contact beat — called by the weapon system when the `melee` clip fires
   * its `strike` event, so the damage lands when the butt visibly connects.
   */
  strike() {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._origin.copy(cam.position);
    this._dir.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();

    // Every swing announces itself, hit or miss: `net` settles PvP off this.
    this.ctx.events.emit('weapon:melee', this._swingPayload);

    const phys = this.weapons.physics ?? (this.weapons.physics = this.ctx.peek('physics'));
    if (!phys) return null;
    this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);

    // Nearest actor across the fan. A ray that meets the world first reports
    // no actor, which is the cover veto: closest-hit does it for free.
    let best = null;
    for (const o of this.fan) {
      this._ray
        .copy(this._dir)
        .addScaledVector(this._right, o.x)
        .addScaledVector(this._up, o.y)
        .normalize();
      const hit = phys.raycast(this._origin, this._ray, MELEE.reach, phys.MASK.BULLET);
      if (!hit.hit || !hit.actor) continue;
      if (best && hit.distance >= best.distance) continue;
      // Hit records are pooled and the next cast overwrites them — keep values.
      best = { actor: hit.actor, distance: hit.distance, part: hit.part };
      this._point.copy(hit.point);
      this._incident.copy(this._ray);
    }
    if (!best) return null;

    const dmg = this.damageFor(this._facingDot(best.actor));
    const p = this._hitPayload;
    p.target = best.actor;
    p.amount = dmg;
    p.headshot = false;
    p.killed = false;
    p.part = best.part ?? 'torso';
    this.ctx.events.emit('damage:dealt', p);
    return p;
  }

  /**
   * `facing · toAttacker` in the ground plane. The soldier rig faces
   * `(sin yaw, cos yaw)` (see the yaw note in ARCHITECTURE.md); an actor
   * without a yaw is treated as facing the attacker — no free backstabs on
   * things that cannot turn.
   */
  _facingDot(actor) {
    const yaw = actor?.yaw;
    const pos = actor?.position;
    if (typeof yaw !== 'number' || !pos) return 1;
    let dx = this._origin.x - pos.x;
    let dz = this._origin.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return 1;
    dx /= d;
    dz /= d;
    return Math.sin(yaw) * dx + Math.cos(yaw) * dz;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  /** A fresh life swings immediately — fired from `player:spawn`. */
  reset() {
    this.cooldown = 0;
  }
}
