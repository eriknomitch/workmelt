/**
 * AI — animation content.
 *
 * Poses are authored as **local euler deltas in degrees** on top of the bind
 * pose. The rig is built so that every bone's local axes mean the same thing:
 *
 *   x  flexion   — positive bends the bone forward (knee extends, spine bows)
 *   y  twist     — roll about the bone's own length
 *   z  lateral   — positive tips the bone toward the character's right
 *
 * That makes a walk cycle readable as anatomy rather than as quaternion soup,
 * and lets layers be blended by simple lerp of the delta arrays.
 *
 * Locomotion curves are hand-tuned against reference gait: the knee flexes
 * hardest just after toe-off, the pelvis drops through mid-stance and rolls
 * toward the stance leg, and the spine counter-rotates against the pelvis.
 */

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;
/** smooth positive lobe used for knee/ankle curves */
const lobe = (x, k = 1.4) => {
  const s = sin(x);
  return s > 0 ? s ** k : 0;
};

/* ------------------------------------------------------------------ */
/* base stance                                                        */
/* ------------------------------------------------------------------ */

/** Weight on the left leg, knees soft, weapon at low ready. */
export function idle(P, ph, p = {}) {
  const t = ph * TAU;
  const breath = sin(t * 0.55);
  const sway = sin(t * 0.31 + 1.1);
  const micro = sin(t * 1.7 + 0.4) * 0.35 + sin(t * 2.9) * 0.2;

  P.hip(0.012 * sway, -0.008 + 0.004 * breath, 0);
  P.d('Hips', -1.5, 2.2 * sway, 1.6);
  P.d('Spine', 1.6 + 0.7 * breath, -1.4 * sway, -0.8);
  P.d('Spine1', 1.2 + 0.9 * breath, -1.0 * sway, -0.6);
  P.d('Spine2', -0.6 + 1.1 * breath, 1.6 * sway, 0.4);
  P.d('Neck', 1.0 - 0.5 * breath, 1.2 * sway + micro, 0);
  P.d('Head', -1.2, 1.0 * micro, 0.6 * sway);

  // stance: right leg carries, left slightly forward
  P.d('UpLegR', -2, 1.5, -1.5);
  P.d('LegR', -5.5, 0, 0);
  P.d('FootR', 4.5, -1.5, 0);
  P.d('UpLegL', 5, -4.5, 2.5);
  P.d('LegL', -9, 0, 0);
  P.d('FootL', 5.5, 3.0, 0);

  // shoulders settle, weapon rides the breath
  P.d('ClavicleR', -1.5 + 0.8 * breath, 0, 1.2);
  P.d('ClavicleL', -1.0 + 0.6 * breath, 0, -1.0);
  P.d('UpperArmR', -3, 0, 2);
  P.d('UpperArmL', 2, 0, -2);
  P.d('ForearmR', 2, 0, 0);
}

/**
 * Stock in the shoulder, head over the sights, weight forward on bent knees.
 * Additive over any base — this is what turns a standing mannequin into a man
 * in a gunfight.
 */
export function aimAdd(P, w = 1) {
  // fighting stance: knees soft, hips dropped, feet staggered
  P.hip(0, -0.035 * w, 0.012 * w);
  P.d('Hips', 4 * w, 3 * w, 0);
  P.d('UpLegR', 8 * w, 4 * w, -3 * w);
  P.d('LegR', -17 * w, 0, 0);
  P.d('FootR', 9 * w, -2 * w, 0);
  P.d('UpLegL', 3 * w, -6 * w, 4 * w);
  P.d('LegL', -13 * w, 0, 0);
  P.d('FootL', 8 * w, 3 * w, 0);
  P.d('Spine1', 2.5 * w, 0, 0);
  P.d('Spine2', 3.0 * w, -5.0 * w, 0);
  P.d('Neck', 5.0 * w, 3.0 * w, 0);
  P.d('Head', -3.5 * w, 2.0 * w, -1.5 * w);
  P.d('ClavicleR', -6.0 * w, -2 * w, 5.0 * w);
  P.d('ClavicleL', -3.0 * w, 4 * w, -3.0 * w);
  P.d('UpperArmR', 10 * w, 0, 14 * w);
  P.d('ForearmR', -12 * w, 0, 0);
  P.d('UpperArmL', 8 * w, 0, -6 * w);
}

/* ------------------------------------------------------------------ */
/* locomotion                                                         */
/* ------------------------------------------------------------------ */

function gait(P, ph, k) {
  const t = ph * TAU;
  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const o = side > 0 ? 0 : Math.PI; // legs half a cycle apart
    const a = t + o;
    // thigh: swings forward through the air, back through stance
    const thigh = k.thigh * sin(a) + k.thighBias;
    // knee: heavy flexion just after toe-off, small at heel strike
    const knee = -(k.kneeBase + k.knee * lobe(a - 0.55, 1.5) + k.kneeStance * lobe(a + Math.PI + 0.4, 2));
    // ankle: toe-off push then dorsiflexion to clear the ground
    const ankle = k.ankle * sin(a - 1.9) + k.ankleBias;
    P.d(`UpLeg${s}`, thigh, side * k.thighTwist, side * k.splay);
    P.d(`Leg${s}`, knee, 0, 0);
    P.d(`Foot${s}`, ankle, -side * 1.5, 0);
    P.d(`Toe${s}`, Math.max(0, -k.toe * sin(a - 2.6)), 0, 0);
  }
  // pelvis: two bobs per stride, roll toward the stance leg, counter-yaw
  P.hip(k.sway * sin(t), k.bobBias + k.bob * cos(2 * t), 0);
  P.d('Hips', k.pelvisTilt, k.pelvisYaw * sin(t), k.pelvisRoll * sin(t + 1.2));
  P.d('Spine', k.lean * 0.35, -k.spineYaw * 0.45 * sin(t), -k.pelvisRoll * 0.35 * sin(t + 1.2));
  P.d('Spine1', k.lean * 0.35, -k.spineYaw * 0.75 * sin(t), 0);
  P.d('Spine2', k.lean * 0.3, -k.spineYaw * sin(t), 0);
  P.d('Neck', -k.lean * 0.5, k.spineYaw * 0.6 * sin(t), 0);
  // the rifle rides on the shoulders, so they take the bounce
  P.d('ClavicleR', -k.armSwing * sin(t) - 1, 0, 1.5);
  P.d('ClavicleL', k.armSwing * sin(t) - 1, 0, -1.5);
  P.d('UpperArmR', -k.armSwing * 0.6 * sin(t), 0, 2);
  P.d('UpperArmL', k.armSwing * 0.8 * sin(t), 0, -2);
}

const WALK = {
  thigh: 21, thighBias: -2, thighTwist: 1.5, splay: 1.5,
  kneeBase: 7, knee: 46, kneeStance: 8,
  ankle: 12, ankleBias: 2, toe: 16,
  sway: 0.012, bob: 0.008, bobBias: -0.008,
  pelvisTilt: -1, pelvisYaw: 4.5, pelvisRoll: 3.2,
  lean: 4, spineYaw: 3.4, armSwing: 3.5,
};

const RUN = {
  thigh: 34, thighBias: 2, thighTwist: 2, splay: 2,
  kneeBase: 14, knee: 86, kneeStance: 22,
  ankle: 20, ankleBias: 4, toe: 26,
  sway: 0.018, bob: 0.018, bobBias: -0.018,
  pelvisTilt: -3, pelvisYaw: 7, pelvisRoll: 5,
  lean: 13, spineYaw: 6, armSwing: 7,
};

const CROUCH = {
  thigh: 13, thighBias: 38, thighTwist: 2, splay: 4,
  kneeBase: 74, knee: 26, kneeStance: 6,
  ankle: 8, ankleBias: 26, toe: 8,
  sway: 0.01, bob: 0.008, bobBias: -0.008,
  pelvisTilt: 6, pelvisYaw: 3, pelvisRoll: 2,
  lean: 16, spineYaw: 2.4, armSwing: 2,
};

export function walk(P, ph) {
  gait(P, ph, WALK);
}

export function run(P, ph) {
  gait(P, ph, RUN);
  // head stabilises against the bigger bounce
  P.d('Head', -3, 0, 0);
}

export function crouchWalk(P, ph) {
  gait(P, ph, CROUCH);
  P.hip(0, -0.30, -0.02);
  P.d('Spine2', 4, 0, 0);
}

/** Static crouch — knees loaded, torso upright behind the weapon. */
export function crouchIdle(P, ph) {
  const t = ph * TAU;
  const breath = sin(t * 0.6);
  P.hip(0.004 * sin(t * 0.4), -0.315 + 0.004 * breath, -0.02);
  P.d('Hips', 7, 1.5, 1);
  P.d('UpLegR', 44, 3, -6);
  P.d('LegR', -78, 0, 0);
  P.d('FootR', 30, -2, 0);
  P.d('UpLegL', 36, -6, 7);
  P.d('LegL', -86, 0, 0);
  P.d('FootL', 32, 4, 0);
  P.d('Spine', 6 + 0.6 * breath, 0, 0);
  P.d('Spine1', 5 + 0.8 * breath, 0, 0);
  P.d('Spine2', 3 + 1.0 * breath, 0, 0);
  P.d('Neck', 2, 0, 0);
  P.d('ClavicleR', -2, 0, 1.5);
  P.d('ClavicleL', -1.5, 0, -1.5);
}

/** Prone-ish crawl is out of scope; a wounded low stance stands in for it. */
export function hurtIdle(P, ph) {
  const t = ph * TAU;
  P.hip(0, -0.10, -0.03);
  P.d('Hips', 10, 0, 4);
  P.d('Spine', 12, 0, -3);
  P.d('Spine1', 9, 0, -2);
  P.d('Spine2', 5 + sin(t * 1.6), 0, 0);
  P.d('Neck', 6, 0, 0);
  P.d('UpLegR', 16, 0, -3);
  P.d('LegR', -28, 0, 0);
  P.d('FootR', 12, 0, 0);
  P.d('UpLegL', 10, 0, 4);
  P.d('LegL', -20, 0, 0);
  P.d('FootL', 9, 0, 0);
}

/* ------------------------------------------------------------------ */
/* one-shots (t is 0..1 over the clip's duration)                     */
/* ------------------------------------------------------------------ */

/** Pivot on the balls of the feet: the trailing foot lifts and re-plants. */
export function turnStep(P, t, dir) {
  const e = Math.sin(Math.PI * Math.min(1, t)); // 0..1..0
  const s = dir > 0 ? 'R' : 'L';
  const o = dir > 0 ? 'L' : 'R';
  P.d(`UpLeg${s}`, 12 * e, dir * 16 * e, 0);
  P.d(`Leg${s}`, -34 * e, 0, 0);
  P.d(`Foot${s}`, 16 * e, 0, 0);
  P.d(`UpLeg${o}`, -4 * e, -dir * 4 * e, 0);
  P.d(`Leg${o}`, -10 * e, 0, 0);
  P.d('Hips', 0, dir * 6 * e, dir * -2 * e);
  P.hip(0, -0.012 * e, 0);
}

/**
 * Vault: plant the support hand, tuck the knees over the obstacle, land.
 * Root motion (the actual translation) is driven by the agent.
 */
export function vault(P, t) {
  const rise = Math.sin(Math.PI * Math.min(1, t * 1.05));
  const tuck = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.12) * 1.3)));
  const land = Math.max(0, (t - 0.7) / 0.3);
  P.hip(0, 0.10 * rise, 0.02 * rise);
  P.d('Hips', 26 * rise - 16 * land, 0, 0);
  P.d('Spine', 20 * rise, 0, -4 * rise);
  P.d('Spine1', 14 * rise, 0, -3 * rise);
  P.d('Spine2', 8 * rise, -14 * rise, 0);
  P.d('Neck', -8 * rise, 6 * rise, 0);
  P.d('UpLegR', 86 * tuck + 30 * land, 0, -10 * tuck);
  P.d('LegR', -104 * tuck - 20 * land, 0, 0);
  P.d('FootR', 24 * tuck, 0, 0);
  P.d('UpLegL', 68 * tuck + 12 * land, 0, 12 * tuck);
  P.d('LegL', -92 * tuck - 30 * land, 0, 0);
  P.d('FootL', 20 * tuck, 0, 0);
  // support arm swings out of the weapon grip
  P.d('ClavicleL', -18 * rise, 12 * rise, -14 * rise);
  P.d('UpperArmL', -46 * rise, 0, -28 * rise);
  P.d('ForearmL', -30 * rise, 0, 0);
  P.d('ClavicleR', -6 * rise, 0, 4 * rise);
  P.d('UpperArmR', -14 * rise, 0, 10 * rise);
}

/**
 * Firing impulse. `t` is seconds since the shot; the shape is a fast spike and
 * a springy settle, which is what makes a burst read as recoil rather than as
 * a wobble.
 */
export function recoilAdd(P, t, strength = 1) {
  if (t > 0.26) return;
  const e = Math.exp(-t * 16);
  const osc = Math.sin(t * 92);
  const k = strength * e;
  P.d('ClavicleR', -7 * k, 0, 3 * k);
  P.d('UpperArmR', -9 * k + 2 * osc * k, 0, 5 * k);
  P.d('ForearmR', 7 * k, 0, 0);
  P.d('ClavicleL', -3 * k, 0, -2 * k);
  P.d('UpperArmL', -6 * k, 0, -3 * k);
  P.d('Spine2', -3.5 * k, 1.5 * k * osc, 0);
  P.d('Spine1', -2.0 * k, 0, 0);
  P.d('Neck', -2.5 * k, 0, 0);
  P.d('Head', 1.5 * k, 0.8 * k * osc, 0);
}

/** Region-specific hit reaction; `t` seconds since impact, 0.45 s long. */
export function hitAdd(P, region, t, dirSide = 0, strength = 1) {
  if (t > 0.5) return;
  const e = Math.exp(-t * 7.5) * Math.min(1, t * 22);
  const k = strength * e;
  const side = dirSide >= 0 ? 1 : -1;
  switch (region) {
    case 'head':
      P.d('Neck', -16 * k, 10 * k * side, 6 * k * side);
      P.d('Head', -20 * k, 14 * k * side, 8 * k * side);
      P.d('Spine2', -7 * k, 4 * k * side, 0);
      P.d('Spine1', -4 * k, 0, 0);
      break;
    case 'torso':
      P.d('Spine', -6 * k, 3 * k * side, 2 * k * side);
      P.d('Spine1', -9 * k, 5 * k * side, 3 * k * side);
      P.d('Spine2', -11 * k, 6 * k * side, 4 * k * side);
      P.d('Neck', 6 * k, -3 * k * side, 0);
      P.d('Hips', 4 * k, 0, 0);
      P.hip(-0.02 * k * side, -0.02 * k, -0.03 * k);
      break;
    case 'armR':
      P.d('ClavicleR', -14 * k, 6 * k, 10 * k);
      P.d('UpperArmR', -22 * k, 0, 14 * k);
      P.d('ForearmR', 16 * k, 0, 0);
      P.d('Spine2', -5 * k, 6 * k, 0);
      break;
    case 'armL':
      P.d('ClavicleL', -14 * k, -6 * k, -10 * k);
      P.d('UpperArmL', -24 * k, 0, -16 * k);
      P.d('ForearmL', 18 * k, 0, 0);
      P.d('Spine2', -5 * k, -6 * k, 0);
      break;
    case 'legR':
      P.d('UpLegR', 14 * k, 0, -8 * k);
      P.d('LegR', -30 * k, 0, 0);
      P.d('Hips', 8 * k, 0, -6 * k);
      P.hip(0, -0.05 * k, 0);
      break;
    case 'legL':
      P.d('UpLegL', 14 * k, 0, 8 * k);
      P.d('LegL', -30 * k, 0, 0);
      P.d('Hips', 8 * k, 0, 6 * k);
      P.hip(0, -0.05 * k, 0);
      break;
    default:
      P.d('Spine1', -6 * k, 0, 0);
      P.d('Spine2', -6 * k, 0, 0);
  }
}

/** Flinch/duck when rounds crack past. */
export function suppressAdd(P, w) {
  if (w <= 0) return;
  P.d('Hips', 7 * w, 0, 0);
  P.d('Spine', 9 * w, 0, 0);
  P.d('Spine1', 8 * w, 0, 0);
  P.d('Spine2', 6 * w, 0, 0);
  P.d('Neck', -6 * w, 0, 0);
  P.d('Head', -8 * w, 0, 0);
  P.d('UpLegR', 16 * w, 0, 0);
  P.d('LegR', -26 * w, 0, 0);
  P.d('UpLegL', 14 * w, 0, 0);
  P.d('LegL', -24 * w, 0, 0);
  P.hip(0, -0.10 * w, 0);
}

/**
 * Reload: the support hand leaves the handguard, drops the magazine, fetches a
 * fresh one from the chest and slaps it home. The hand path itself is driven by
 * the animator's IK target; this is the body language around it.
 */
export function reloadAdd(P, t) {
  const w = Math.min(1, Math.max(0, Math.min(t * 6, (1 - t) * 6)));
  P.d('Spine2', 4 * w, -16 * w, -3 * w);
  P.d('Spine1', 3 * w, -6 * w, 0);
  P.d('Neck', 6 * w, 8 * w, 0);
  P.d('Head', -4 * w, 6 * w, 3 * w);
  P.d('ClavicleR', -4 * w, -4 * w, 4 * w);
  P.d('UpperArmR', 6 * w, 0, 10 * w);
  P.d('ForearmR', -6 * w, 0, 0);
}

export const CLIPS = { idle, walk, run, crouchWalk, crouchIdle, hurtIdle };
