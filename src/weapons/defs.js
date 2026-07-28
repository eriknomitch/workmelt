import { DEG } from './mathx.js';

/**
 * Weapon data.
 *
 * Ballistics are real: 5.56x45 leaves a 14.5" barrel at ~880 m/s, 9x19 from a
 * 4.5" barrel at ~360 m/s, and both drop under gravity on the way to the
 * target. Rates of fire, magazine capacities and ADS times are the real ones
 * too (an M4A1 is 800 rpm and reaches the optic in about 220 ms).
 *
 * Recoil is split in two, exactly as a modern shooter does it:
 *   - `pattern`  a DETERMINISTIC per-shot camera climb a player can memorise
 *                and counter. Generated once from a fixed seed.
 *   - `spread`   a random cone that grows with sustained fire and shrinks when
 *                aiming, crouched or still. This is the part you cannot learn.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE BALANCE CONTRACT
 * ────────────────────────────────────────────────────────────────────────────
 * A body is 100 HP and `src/ai` scales incoming damage by the zone it lands in:
 * head x4.0, upper torso x1.0, lower torso x0.9, arm x0.65, leg x0.7. So base
 * damage is not a feel number — it is a SHOTS-TO-KILL number, and each weapon's
 * identity is which side of an integer boundary it lands on:
 *
 *   weapon  dmg   torso STK   rpm    TTK (upper torso)   head
 *   rifle    33      4        800        225 ms          1 shot (132)
 *   smg      26      4        950        189 ms          1 shot (104)
 *   pistol   29      4        480        375 ms          1 shot (116)
 *   sniper  115      1         50        one shot        1 shot (460)
 *
 * The SMG wins inside ~18 m and the carbine everywhere past it — which is what
 * `falloffStart/falloffEnd/dropoff` below are for, and the reason the SMG's is
 * so much steeper. Before this pass the SMG did 24 (a 5-shot kill at 950 rpm =
 * 253 ms) with a WIDER hip cone than the carbine, so it lost at every range and
 * in every stance: strictly dominated, the one thing a weapon set may never do.
 *
 * The AX-7 sits outside that table on purpose. It kills in one shot on any HEAD
 * or TORSO hit at any range the round survives (115 x 0.9 = 103.5 on the lower
 * torso), and in exactly two on a LIMB — which is the whole balance: a hit is
 * lethal, a clipped arm hands the target 1.2 s of bolt cycle to kill you back.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DAMAGE FALLOFF — a two-point ramp, not a curve
 * ────────────────────────────────────────────────────────────────────────────
 * Falloff used to be `1 - (1 - dropoff) * (travelled/maxRange)^2` over the
 * round's whole FLIGHT range. Measured against real engagement distances that
 * did essentially nothing: the SMG kept 99.4 % of its damage at 25 m and 92.8 %
 * at 60 m, because a quadratic over 240 m is flat everywhere a fight happens.
 * Range was therefore not a balance lever at all, and the only thing separating
 * the weapons was rate of fire.
 *
 * It is now the standard two-point ramp every modern shooter uses, decoupled
 * from flight distance:
 *   - full damage out to `falloffStart`
 *   - a straight ramp to `dropoff` of it at `falloffEnd`
 *   - flat beyond, until `maxRange` retires the round
 * so the numbers below are readable as metres on a map.
 */

export const WEAPON_DEFS = {
  rifle: {
    id: 'rifle',
    label: 'M4A1',
    class: 'carbine',
    caliber: '5.56x45',
    /* --- fire control --- */
    rpm: 800,
    modes: ['auto', 'burst', 'semi'],
    burstCount: 3,
    burstRpm: 950,
    burstDelay: 0.16,
    /* --- ammunition --- */
    magSize: 30,
    reserve: 210,
    /* --- terminal ballistics --- */
    muzzleVelocity: 880,
    damage: 33,
    penetration: 1.0,
    /* Full damage to 42 m, ramping to 62 % by 110 m: still a 4-shot kill at the
     * far end of any street on the map, 5 across it. */
    falloffStart: 42,
    falloffEnd: 110,
    dropoff: 0.62,
    maxRange: 420,
    dragK: 0.28,
    tracerEvery: 3,
    /* --- accuracy (degrees) --- */
    spreadHip: 2.15,
    spreadAds: 0.24,
    spreadPerShot: 0.3,
    spreadMax: 3.4,
    spreadDecay: 3.6,
    spreadAirAdd: 0.35,
    /* --- recoil --- */
    recoil: {
      pitch: 0.0085, // radians of camera climb per shot
      yaw: 0.0022,
      kickBack: 0.019, // metres the viewmodel travels rearward
      kickUp: 0.0072,
      roll: 0.032,
      punch: 0.35,
      freq: 8.5,
      damping: 0.42,
      patternLength: 30,
      patternSeed: 0x4d34a1,
      climbShape: [1.45, 1.3, 1.15, 1.05, 1.0], // first-shots multiplier
      drift: 0.55, // how much the pattern wanders horizontally
    },
    /* --- handling (seconds) --- */
    adsTime: 0.22,
    adsFov: 0.74,
    viewFov: 0.86,
    /* World-camera FOV multiplier while aimed — `weapons` pushes it at `player`
     * every frame (see WeaponSystem.update). 0.72 is what `config.adsFovScale`
     * applied to every weapon before optics were allowed to differ, so the
     * carbine's sight picture is unchanged. */
    adsFovScale: 0.72,
    reloadTac: 2.1,
    reloadEmpty: 2.9,
    inspectTime: 3.2,
    drawTime: 0.62,
    holsterTime: 0.4,
    /* --- pose ---
     * Weapon-local origin is the web of the shooting hand (top of the grip).
     * The butt pad is at z=+0.245, the muzzle crown at z=-0.502, the optic
     * ocular at (0, 0.142, +0.006) and the mag floorplate ~150 mm below origin.
     *
     * SOLVED FROM THE BORE AXIS, not from where the optic happens to land.
     *
     * The previous pose (hipPos [0.081,-0.192,-0.215], hipRot [-0.026,0.076,
     * 0.055]) was derived by putting the OPTIC at a chosen screen position, and
     * that is the wrong constraint: it left the bore 1.5 deg nose-down with the
     * weapon only 215 mm from the eye, so the whole barrel forward of the
     * receiver ran off the top-left of the frame and the muzzle crown — where
     * the flash spawns — projected onto empty street. What reads as "the gun
     * points at the crosshair" is the MUZZLE being visible, up-left of the
     * receiver, on the way to the centre of the screen.
     *
     * Constraints, in order:
     *   1. bore axis 4.0 deg LEFT of view-forward (converging on the crosshair)
     *      and 2.9 deg nose-down:  rx = -0.050, ry = +0.070
     *   2. rolled 7.7 deg so the LEFT flank of the receiver (the side that
     *      carries the rollmark, the bolt catch and the port) faces the camera
     *      and the rail deck turns edge-on instead of presenting its lit top
     *      face:  rz = -0.135
     *   3. muzzle crown inside x 1050-1300, y 620-780 at 1920x1080
     *   4. optic ocular below and right of screen centre
     *   5. magazine + pistol grip in the lower-right frame
     *
     * With the rotation above the muzzle offset is (-0.025, +0.049, -0.505) and
     * the ocular offset (+0.019, +0.141, -0.003), so at a 60 deg vertical view
     * FOV (half-height 0.5774|z|, half-width 1.0264|z|):
     *   muzzle -> (1064, 698)   ocular -> (1374, 677)   magwell mouth -> (1268, 870)
     * i.e. the muzzle is 300 px up-LEFT of the optic and heading for the middle
     * of the frame, which is the read that was missing.
     *
     * z = -0.30 (was -0.215) is what makes the weapon small enough for the mag
     * and grip to enter the frame at all: the gun's vertical extent from optic
     * to floorplate is 291 mm, and at 215 mm from the eye that is 93% of the
     * frame height. It is also the limit — the support hand is then 620 mm
     * downrange of a shoulder 200 mm off the eye, and a 572 mm arm has nothing
     * left. The butt pad ends up 60 mm in FRONT of the eye but 140 mm off axis,
     * so it is outside the frustum rather than clipped by the near plane. */
    hipPos: [0.118, -0.185, -0.3],
    hipRot: [-0.05, 0.081, -0.135],
    adsCant: [0, 0, 0.004],
    /* Eye to the rear lens.
     *
     * MEASURED FROM THE ADS FRAME, not chosen for realism. Two numbers have to
     * come out right and they pull in opposite directions:
     *
     *   housing size     the 31 mm tube's outer rim subtends rOuter/relief. At
     *                    0.078 that was 256 px of radius — a 512 px ring, HALF
     *                    the frame height, and every critic called the optic
     *                    oversized. 0.115 puts it at 168 px (336 px across,
     *                    31% of frame height), which is where a modern shooter
     *                    frames a tube sight.
     *   sight picture    is stopped by the objective bore at (relief + len), so a
     *                    LONGER relief improves the picture-to-housing ratio:
     *                    (relief)/(relief+len) goes from 0.53 to 0.69.
     *
     * So both wanted the same thing and the old value was simply too close. With
     * the 52 mm tube and the flared bore (see parts.js buildOptic) this lands the
     * clear aperture at 115 px against a 168 px housing. */
    eyeRelief: 0.115,
    /* Sprint: gun dropped and angled across the body, muzzle down-left.
     * Carried over by the same delta as the hip pose so the blend does not
     * translate the weapon 90 mm sideways on the way into a sprint. */
    sprintPos: [0.09, -0.262, -0.275],
    sprintRot: [-0.4, 0.6, 0.2],
    lowReadyPos: [0.112, -0.28, -0.289],
    lowReadyRot: [-0.46, 0.125, -0.09],
    swayScale: 1,
    bobScale: 1,
    magLen: 0.212,
  },

  smg: {
    id: 'smg',
    label: 'MPX-9',
    class: 'smg',
    caliber: '9x19',
    rpm: 950,
    modes: ['auto', 'semi'],
    burstCount: 2,
    burstRpm: 1100,
    burstDelay: 0.14,
    magSize: 32,
    reserve: 224,
    muzzleVelocity: 400,
    /* 26, not 24. At 24 the SMG needed five torso hits (253 ms at 950 rpm)
     * against the carbine's four (225 ms), so it lost the close-range fight it
     * exists to win. Four hits is 189 ms — 36 ms of daylight inside its band. */
    damage: 26,
    penetration: 0.45,
    /* And it pays for that with the steepest ramp in the set: 44 % by 46 m turns
     * a 4-shot kill into a 6-shot one, which is 379 ms against the carbine's
     * 225. The crossover lands around 18 m. */
    falloffStart: 16,
    falloffEnd: 46,
    dropoff: 0.44,
    maxRange: 240,
    dragK: 0.42,
    tracerEvery: 4,
    /* Hipfire is the SMG's identity and its cone was WIDER than the carbine's
     * (2.5 against 2.05), which is backwards. It is now the tightest of the
     * three, and the bloom per shot is the steepest, so it rewards a burst from
     * the hip and punishes holding the trigger at range. */
    spreadHip: 1.75,
    spreadAds: 0.4,
    spreadPerShot: 0.3,
    spreadMax: 4.4,
    spreadDecay: 4.4,
    spreadAirAdd: 0.4,
    recoil: {
      pitch: 0.0058,
      yaw: 0.0026,
      kickBack: 0.0135,
      kickUp: 0.0052,
      roll: 0.026,
      punch: 0.24,
      freq: 10.5,
      damping: 0.4,
      patternLength: 32,
      patternSeed: 0x9ac31f,
      climbShape: [1.3, 1.18, 1.08, 1.0],
      drift: 0.8,
    },
    adsTime: 0.185,
    adsFov: 0.78,
    viewFov: 0.88,
    /* A 1x compact red dot has no magnification to give, and the peripheral
     * vision it keeps is worth more than reach to a weapon that lives at 15 m. */
    adsFovScale: 0.8,
    reloadTac: 1.85,
    reloadEmpty: 2.5,
    inspectTime: 2.9,
    drawTime: 0.52,
    holsterTime: 0.34,
    /* Solved from the bore axis exactly as the rifle's is (see there): 4.1 deg of
     * convergence, 2.9 deg nose-down, 7.5 deg of outboard roll, and far enough
     * out that the muzzle of a 210 mm barrel is on screen up-left of the optic. */
    hipPos: [0.111, -0.163, -0.288],
    hipRot: [-0.05, 0.072, -0.131],
    adsCant: [0, 0, 0.005],
    /* Same aperture-budget derivation as the rifle (see there): the 27.6 mm tube's
     * outer rim wants to land near 165 px of radius and the 44 mm bore wants the
     * eye far enough back that the objective is not the stop. */
    eyeRelief: 0.104,
    sprintPos: [0.088, -0.24, -0.262],
    sprintRot: [-0.38, 0.58, 0.19],
    lowReadyPos: [0.108, -0.252, -0.276],
    lowReadyRot: [-0.44, 0.125, -0.085],
    swayScale: 0.92,
    bobScale: 0.95,
    magLen: 0.192,
  },

  pistol: {
    id: 'pistol',
    label: 'P-19',
    class: 'pistol',
    caliber: '9x19',
    /* 480, not 460: a striker-fired 9 mm is trigger-limited, and four hits at
     * 460 was 391 ms — far enough behind the carbine that the sidearm was never
     * worth drawing over a reload. 375 ms plus the fastest draw in the game
     * (0.42 s against the carbine's 2.1 s tactical reload) is what makes the
     * swap a real decision. */
    rpm: 480,
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 480,
    burstDelay: 0.1,
    magSize: 17,
    reserve: 68,
    muzzleVelocity: 360,
    /* 29 keeps the four-hit kill intact through the whole ramp (29 x 0.52 x 4 =
     * 60 at 55 m+), so the sidearm degrades in TIME, never in shot count. */
    damage: 29,
    penetration: 0.35,
    falloffStart: 20,
    falloffEnd: 55,
    dropoff: 0.52,
    maxRange: 180,
    dragK: 0.46,
    tracerEvery: 5,
    spreadHip: 2.6,
    spreadAds: 0.5,
    spreadPerShot: 0.42,
    spreadMax: 4.6,
    spreadDecay: 5.2,
    spreadAirAdd: 0.55,
    recoil: {
      pitch: 0.0125,
      yaw: 0.0032,
      kickBack: 0.012,
      kickUp: 0.0105,
      roll: 0.018,
      punch: 0.3,
      freq: 9.0,
      damping: 0.45,
      patternLength: 17,
      patternSeed: 0x1f77bc,
      climbShape: [1.0],
      drift: 1.2,
    },
    adsTime: 0.16,
    adsFov: 0.86,
    viewFov: 0.92,
    /* Irons and a mini reflex over a 183 mm slide: almost no zoom, all speed. */
    adsFovScale: 0.86,
    reloadTac: 1.6,
    reloadEmpty: 2.2,
    inspectTime: 2.6,
    drawTime: 0.42,
    holsterTime: 0.3,
    /* A pistol is held out on the arms rather than braced on the shoulder, so
     * the hip pose is FURTHER from the eye than a carbine's and the ADS eye
     * relief is most of an arm's length. 0.34 m keeps both elbows visibly bent;
     * past ~0.40 m the two-bone solve hits full extension and they lock. */
    hipPos: [0.115, -0.15, -0.34],
    hipRot: [-0.05, 0.066, -0.115],
    adsCant: [0, 0, 0.003],
    eyeRelief: 0.34,
    sprintPos: [0.09, -0.25, -0.28],
    sprintRot: [-0.42, 0.5, 0.14],
    lowReadyPos: [0.1, -0.26, -0.32],
    lowReadyRot: [-0.44, 0.105, -0.07],
    swayScale: 1.15,
    bobScale: 1.1,
    magLen: 0.108,
  },

  /**
   * THE QUICKSCOPE RIFLE.
   *
   * Every number below serves one loop, and it is the loop Call of Duty and
   * Counter-Strike both build a whole skill ceiling on:
   *
   *     flick onto the target -> scope -> the instant the glass is up the
   *     round goes exactly where the crosshair is -> one hit anywhere on the
   *     head or torso ends it -> 1.2 s of bolt cycle, during which you are a
   *     man holding a 932 mm rifle in a corridor.
   *
   * Four mechanics carry it, and they are all in this block:
   *
   *  1. `spreadAds: 0.02`. A cone of 0.02 deg is 1.7 cm at 50 m — the shot goes
   *     where the reticle is, full stop. That is the non-negotiable half of
   *     quickscoping: if a scoped sniper round can miss a stationary head, the
   *     technique does not exist. Counter-Strike's AWP is the same contract.
   *  2. `spreadHip: 6.5`. And the other half. A 6.5 deg cone is 5.7 m across at
   *     50 m, so a no-scope is a lottery ticket, not a playstyle. The entire
   *     value of the weapon is gated behind the scope being up.
   *  3. `spreadDecay: 24`. This is the number that MAKES the technique work and
   *     it is the least obvious. Spread relaxes toward its resting value at
   *     `spreadDecay * (1 + adsProgress)` deg/s, so at the carbine's 3.6 the
   *     6.5 deg hip cone would take 0.9 s to bleed down after the scope was
   *     already up — you would be scoped, on target, and still missing. At 24 it
   *     is gone in 0.14 s, comfortably inside the 0.34 s `adsTime`, so the scope
   *     coming up IS the shot being ready. Nothing else gates it.
   *  4. `rpm: 50` and `spreadPerShot: 3.2`. The cost. One shot every 1.2 s, and
   *     the cone is blown to 3.2 deg the instant you fire, so there is no such
   *     thing as a fast second shot even if you could cycle faster.
   *
   * `adsFovScale: 0.3` is the scope: a 3.3x picture against the carbine's 1.4x.
   * `adsTime: 0.34` is slow enough to lose a close-quarters trade and fast
   * enough to win a flick — which is exactly where a sniper belongs.
   */
  sniper: {
    id: 'sniper',
    label: 'AX-7',
    class: 'sniper',
    caliber: '.338 LM',
    /* --- fire control --- */
    rpm: 50, // 1.2 s of bolt cycle between rounds
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 50,
    burstDelay: 0.1,
    /** Manually cycled: the bolt is thrown on every shot, not by a gas system. */
    boltAction: true,
    /* --- ammunition --- */
    magSize: 5,
    reserve: 25,
    /* --- terminal ballistics --- */
    muzzleVelocity: 915,
    /**
     * 115 is a SHOTS-TO-KILL number, not a feel number. Against the zone table
     * in `src/ai` (head x4, upper torso x1, lower torso x0.9, arm x0.65, leg
     * x0.7) it is the smallest value that kills on any torso hit — 115 x 0.9 =
     * 103.5 — while still leaving a limb hit non-lethal at 74.8 and 80.5. That
     * pair of facts IS the balance: the rifle is decisive when it connects with
     * a body and hands the fight back when it clips an arm.
     */
    damage: 115,
    /** AP-grade: the one weapon in the set that reliably shoots through cover. */
    penetration: 2.2,
    /* Flat to 120 m and 88 % at 420 m, so the torso kill survives any sightline
     * on any map. Past 420 m the lower-torso hit (91) stops being lethal, which
     * is the only range band where a body shot is not enough. */
    falloffStart: 120,
    falloffEnd: 420,
    dropoff: 0.88,
    maxRange: 900,
    dragK: 0.11,
    /** Every round traces. A .338 is loud, bright and visible — sniping from the
     *  same window twice is meant to get you killed. */
    tracerEvery: 1,
    /* --- accuracy (degrees) — see the note above this block --- */
    spreadHip: 6.5,
    spreadAds: 0.02,
    spreadPerShot: 3.2,
    spreadMax: 8.5,
    spreadDecay: 24,
    spreadAirAdd: 2.2,
    /* --- recoil --- */
    recoil: {
      pitch: 0.052, // ~3 deg of camera climb per shot
      yaw: 0.006,
      kickBack: 0.055,
      kickUp: 0.022,
      roll: 0.055,
      punch: 1.15,
      freq: 5.2,
      damping: 0.5,
      patternLength: 5,
      patternSeed: 0x7b2c19,
      climbShape: [1.0],
      drift: 0.4,
    },
    /* --- handling (seconds) --- */
    adsTime: 0.34,
    adsFov: 0.42,
    /**
     * The VIEWMODEL camera, not the world camera. It zooms far less than the
     * world does (0.58 against `adsFovScale` 0.3) because the scope housing is
     * drawn by this camera and the sight picture by the other: at 0.3 the
     * 35 mm tube would be 1.9x oversized and swallow the frame. 0.58 puts the
     * housing at 62 % of frame height with 40 % of clear glass inside it, which
     * is where a modern shooter frames a magnified optic.
     */
    viewFov: 0.58,
    /** 3.3x. The whole reason to carry it. */
    adsFovScale: 0.3,
    reloadTac: 3.0,
    reloadEmpty: 3.9,
    inspectTime: 3.6,
    drawTime: 0.78,
    holsterTime: 0.52,
    /**
     * Pushed 35 mm further from the eye than the carbine's -0.30. The weapon is
     * 932 mm from butt pad to crown against the carbine's 747, and the butt has
     * to stay in front of the eye rather than behind it: at -0.335 the pad sits
     * 63 mm forward of the camera, the same clearance the carbine has.
     * The support hand is the binding constraint on going further — see the
     * `gripL` note in models/sniper.js.
     */
    hipPos: [0.122, -0.196, -0.335],
    hipRot: [-0.05, 0.081, -0.135],
    adsCant: [0, 0, 0.002],
    /**
     * Solved on the same aperture budget as the carbine's red dot (see
     * parts.js buildOptic): with a 35 mm tube, a 105 mm body and a 50 mm
     * objective bore, 105 mm of relief lands the ocular cone at 0.133, the
     * objective at 0.118 and the housing at 0.183 — a sight picture filling
     * 65 % of the housing, against the red dot's 69 %.
     */
    eyeRelief: 0.105,
    sprintPos: [0.094, -0.276, -0.3],
    sprintRot: [-0.42, 0.64, 0.22],
    lowReadyPos: [0.116, -0.298, -0.322],
    lowReadyRot: [-0.48, 0.13, -0.09],
    /** Heavy and long: it wanders more at rest and swings harder on the move. */
    swayScale: 1.55,
    bobScale: 1.3,
    magLen: 0.118,
  },
};

/**
 * Generate the deterministic recoil pattern for a weapon.
 *
 * The shape is what a player learns: a strong vertical climb for the first few
 * shots, then the vertical settles while the muzzle starts to wander sideways
 * in a smooth, repeatable S. Everything comes from one fixed seed so the same
 * weapon always kicks the same way — including in capture mode.
 *
 * @returns {Float32Array} pairs of [pitch, yaw] in radians, length n*2.
 */
export function buildRecoilPattern(def, Rng) {
  const r = def.recoil;
  const n = r.patternLength;
  const rng = new Rng(r.patternSeed);
  const out = new Float32Array(n * 2);
  // Two out-of-phase wanders make the horizontal read as a learnable snake
  // rather than as noise.
  const phase = rng.float() * Math.PI * 2;
  const phase2 = rng.float() * Math.PI * 2;
  const bias = rng.signed() * 0.35;
  for (let i = 0; i < n; i++) {
    const shot = i;
    const climb = r.climbShape[Math.min(shot, r.climbShape.length - 1)];
    // Vertical: strong early, tapering, with a per-shot signature bump.
    const sig = 0.88 + rng.float() * 0.24;
    out[i * 2] = r.pitch * climb * sig;
    // Horizontal: a smooth snake plus a fixed per-shot signature.
    const t = i / Math.max(1, n - 1);
    const snake =
      Math.sin(phase + t * Math.PI * 2.6) * 0.75 + Math.sin(phase2 + t * Math.PI * 5.1) * 0.35;
    out[i * 2 + 1] = r.yaw * (snake * r.drift * 3.2 + bias + rng.signed() * 0.25);
  }
  return out;
}

/**
 * Damage multiplier per hit zone.
 *
 * This MIRRORS the hitbox table `src/ai` builds its soldiers from (see
 * `HITBOXES` in src/ai/agent.js) — it does not define it. `ai` owns the capsules
 * and physics applies `collider.damageScale` at the moment of contact, so a
 * bullet fired at a bot never reads this object.
 *
 * It exists because two other places need to answer "what would this weapon do
 * to that zone" WITHOUT firing a bullet: `WeaponSystem.damageAt`, which `net`
 * uses to settle a PvP hit against a remote puppet (there are no ACTOR colliders
 * on a puppet — `net` raycasts a capsule itself), and the balance self-test,
 * which asserts the shots-to-kill matrix at the top of this file.
 *
 * If `ai` retunes its capsules, this and the self-test both have to follow.
 */
export const HIT_ZONES = {
  head: 4.0,
  torso: 1.0,
  torsoLow: 0.9,
  arm: 0.65,
  leg: 0.7,
  limb: 0.7,
};

export const SPREAD_MODS = {
  crouch: 0.78,
  prone: 0.6,
  still: 0.82,
  walking: 1.15,
  sprinting: 2.2,
  airborne: 2.0,
  hipfire: 1,
};

export const DEG2RAD = DEG;
