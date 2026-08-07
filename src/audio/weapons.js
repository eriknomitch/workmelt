/**
 * AUDIO / WEAPON FIRE
 *
 * A gunshot is not one sound. Every layer below exists in real recordings and
 * removing any one of them is immediately audible:
 *
 *   1. TRANSIENT  sub-millisecond click — the pressure step. Gives the shot its
 *                 "instant" feel; without it the gun sounds like a firework.
 *   2. BODY       a fast downward-swept sine/triangle pair, saturated. This is
 *                 the chest thump, the layer people describe as "punch".
 *   3. CRACK      resonant band-passed noise around 1.5–3.5 kHz driven into
 *                 saturation. Calibre character lives here.
 *   4. MID        a short 500–900 Hz noise body that glues 2 and 3 together.
 *   5. TAIL       a broadband burst under a falling lowpass, fed hard into the
 *                 reverb send — this is what the *room* hears.
 *   6. MECH       the bolt/action: a separate, drier, later metallic layer. It
 *                 is what makes a weapon feel mechanical rather than sampled.
 *   7. BOOM       (distance only) a slow, dark, rolling low-frequency swell
 *                 plus a ground-bounce repeat.
 *
 * Variation: each profile owns a round-robin table of 6 timbre variants, and on
 * top of that every shot gets fresh pitch/level/decay jitter from ctx.rng. Two
 * consecutive rounds are never the same waveform, which is the single biggest
 * difference between "synthesized game audio" and "a looping sample".
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, semis, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * Per-weapon character. Frequencies in Hz, times in seconds.
 * `level` is a linear trim; the mix expects ~1.0 for a 5.56 rifle.
 */
export const WEAPON_PROFILES = {
  rifle: {
    name: 'rifle', level: 1.0, bodyF: 148, bodyF2: 56, bodyDecay: 0.085, subF: 62, subDecay: 0.12,
    crackF: 2450, crackQ: 0.95, crackDecay: 0.055, drive: 6, asym: 0.35,
    midF: 780, midDecay: 0.05, tailDecay: 0.3, tailF: 5200, tailEndF: 700,
    mechDelay: 0.028, mechLevel: 0.42, mechPartials: [1880, 3260, 5400], send: 0.5,
  },
  ak: {
    name: 'ak', level: 1.1, bodyF: 124, bodyF2: 46, bodyDecay: 0.105, subF: 52, subDecay: 0.15,
    crackF: 1780, crackQ: 0.9, crackDecay: 0.07, drive: 7.5, asym: 0.5,
    midF: 640, midDecay: 0.06, tailDecay: 0.42, tailF: 4200, tailEndF: 560,
    mechDelay: 0.034, mechLevel: 0.55, mechPartials: [1420, 2650, 4300], send: 0.55,
  },
  smg: {
    name: 'smg', level: 0.84, bodyF: 172, bodyF2: 72, bodyDecay: 0.06, subF: 78, subDecay: 0.08,
    crackF: 3050, crackQ: 1.05, crackDecay: 0.04, drive: 5, asym: 0.3,
    midF: 900, midDecay: 0.035, tailDecay: 0.19, tailF: 6200, tailEndF: 900,
    mechDelay: 0.021, mechLevel: 0.5, mechPartials: [2200, 3900, 6300], send: 0.44,
  },
  pistol: {
    name: 'pistol', level: 0.74, bodyF: 186, bodyF2: 84, bodyDecay: 0.05, subF: 92, subDecay: 0.07,
    crackF: 2750, crackQ: 1.15, crackDecay: 0.035, drive: 4.5, asym: 0.28,
    midF: 950, midDecay: 0.03, tailDecay: 0.16, tailF: 6800, tailEndF: 1000,
    mechDelay: 0.038, mechLevel: 0.46, mechPartials: [2450, 4200, 6900], send: 0.4,
  },
  shotgun: {
    name: 'shotgun', level: 1.18, bodyF: 108, bodyF2: 40, bodyDecay: 0.13, subF: 44, subDecay: 0.19,
    crackF: 1450, crackQ: 0.7, crackDecay: 0.09, drive: 9, asym: 0.6,
    midF: 520, midDecay: 0.08, tailDecay: 0.5, tailF: 3600, tailEndF: 460,
    mechDelay: 0.16, mechLevel: 0.7, mechPartials: [980, 1760, 3050], send: 0.6,
    pellets: 6,
  },
  sniper: {
    name: 'sniper', level: 1.3, bodyF: 96, bodyF2: 34, bodyDecay: 0.16, subF: 38, subDecay: 0.24,
    crackF: 1320, crackQ: 0.8, crackDecay: 0.11, drive: 10, asym: 0.55,
    midF: 470, midDecay: 0.1, tailDecay: 0.95, tailF: 3300, tailEndF: 380,
    mechDelay: 0.19, mechLevel: 0.65, mechPartials: [1150, 2050, 3400], send: 0.72,
  },
  lmg: {
    name: 'lmg', level: 1.14, bodyF: 118, bodyF2: 44, bodyDecay: 0.11, subF: 50, subDecay: 0.16,
    crackF: 1920, crackQ: 0.85, crackDecay: 0.075, drive: 8, asym: 0.45,
    midF: 610, midDecay: 0.065, tailDecay: 0.5, tailF: 4000, tailEndF: 520,
    mechDelay: 0.03, mechLevel: 0.6, mechPartials: [1330, 2480, 4100], send: 0.58,
  },
  suppressed: {
    name: 'suppressed', level: 0.5, bodyF: 132, bodyF2: 64, bodyDecay: 0.055, subF: 70, subDecay: 0.07,
    crackF: 900, crackQ: 0.6, crackDecay: 0.03, drive: 2.5, asym: 0.2,
    midF: 430, midDecay: 0.05, tailDecay: 0.1, tailF: 1800, tailEndF: 400,
    mechDelay: 0.019, mechLevel: 0.85, mechPartials: [2100, 3700, 5900], send: 0.18,
    suppressed: true,
  },
};

/** Map whatever the weapons subsystem calls its guns onto a profile. */
export function resolveProfile(name) {
  if (!name) return WEAPON_PROFILES.rifle;
  const k = String(name).toLowerCase();
  if (WEAPON_PROFILES[k]) return WEAPON_PROFILES[k];
  if (/suppress|silenc/.test(k)) return WEAPON_PROFILES.suppressed;
  if (/ak|7\.?62|akm|scar/.test(k)) return WEAPON_PROFILES.ak;
  if (/mp5|mp7|smg|ump|vector|uzi/.test(k)) return WEAPON_PROFILES.smg;
  // `g31`: the imported competition 9 mm. Named for the model it was built
  // from rather than its class, so it needs to be spelled out here or it falls
  // through to the default profile and quietly sounds like the wrong gun.
  if (/pistol|glock|g31|m19|deagle|handgun|sidearm/.test(k)) return WEAPON_PROFILES.pistol;
  if (/shot|pump|12g|benelli|spas/.test(k)) return WEAPON_PROFILES.shotgun;
  if (/snip|dmr|awp|barrett|338|intervention|marksman/.test(k)) return WEAPON_PROFILES.sniper;
  if (/lmg|mg4|m249|pkm|saw|minigun/.test(k)) return WEAPON_PROFILES.lmg;
  return WEAPON_PROFILES.rifle;
}

/* ------------------------------------------------------------------ */
/* Round robin                                                        */
/* ------------------------------------------------------------------ */

const RR_SLOTS = 6;

/** Build (once, lazily) the round-robin timbre table for a profile. */
function roundRobin(profile, rng) {
  if (profile._rr) return profile._rr;
  const rr = [];
  for (let i = 0; i < RR_SLOTS; i++) {
    rr.push({
      body: semis(rng.range(-1.1, 1.1)),
      crack: semis(rng.range(-1.7, 1.7)),
      crackQ: rng.range(0.85, 1.2),
      tail: rng.range(0.86, 1.18),
      drive: rng.range(0.85, 1.2),
      mid: semis(rng.range(-2, 2)),
      level: rng.range(0.93, 1.07),
      mech: rng.range(0.8, 1.25),
      // Slight per-slot spectral tilt: microphone/room position variance.
      tilt: rng.range(-2.5, 2.5),
    });
  }
  profile._rr = rr;
  profile._rrIndex = (rng.u32() % RR_SLOTS) | 0;
  return rr;
}

/**
 * Synthesize one shot.
 *
 * @param {BaseAudioContext} actx
 * @param {import('./dsp.js').NoiseBank} bank
 * @param {import('../core/rng.js').Rng} rng
 * @param {object} profile from WEAPON_PROFILES
 * @param {object} o { when, distance, indoor, firstPerson, echo }
 * @returns {{node: GainNode, end: number, send: number}}
 */
export function weaponShot(actx, bank, rng, profile, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;

  const rr = roundRobin(profile, rng);
  profile._rrIndex = (profile._rrIndex + 1) % RR_SLOTS;
  const v = rr[profile._rrIndex];

  // Per-shot jitter on top of the round-robin slot — the fine grain.
  const jB = v.body * semis(rng.range(-0.45, 0.45));
  const jC = v.crack * semis(rng.range(-0.8, 0.8));
  const jT = v.tail * rng.range(0.94, 1.07);
  const jL = v.level * rng.range(0.95, 1.05);

  // Distance mixing. Near = all crack and click; far = all boom and tail.
  const near = clamp(1 - dist / 42, 0, 1);
  const nearP = Math.pow(near, 0.7);
  const far = 1 - near;

  // VOICE TRIM — the gunshot is the loudest thing in the game and defines the
  // reference the rest of the mix is staged against.
  const out = gain(actx, 0.46);
  let end = t0 + 0.2;

  /* ---- 1. transient --------------------------------------------- */
  if (nearP > 0.05) {
    const tg = gain(actx, 0);
    const src = bank.source('white', rng, rng.range(0.9, 1.3));
    const hp = biquad(actx, 'highpass', 2600, 0.6);
    const pk = biquad(actx, 'peaking', 6200 * jC, 1.1, 8 + v.tilt);
    series(src, hp, pk, tg).connect(out);
    hit(tg.gain, t0, 0.9 * nearP * jL * (profile.suppressed ? 0.35 : 1), 0.0075);
    src.start(t0, src._offset, 0.05);
    // A single-cycle sine at the top of the click adds the "snap" that pure
    // noise cannot produce.
    const clk = osc(actx, 'triangle', 1750 * jC);
    const cg = gain(actx, 0);
    clk.connect(cg); cg.connect(out);
    hit(cg.gain, t0, 0.35 * nearP * jL, 0.004);
    clk.start(t0); clk.stop(t0 + 0.02);
  }

  /* ---- 2. body + sub -------------------------------------------- */
  {
    const bodyLevel = (0.85 + far * 0.5) * jL * profile.level;
    const b1 = osc(actx, 'sine', profile.bodyF * jB);
    const b2 = osc(actx, 'triangle', profile.bodyF * jB * 0.5);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive * 0.5, profile.asym), '2x');
    const bodyLP = biquad(actx, 'lowpass', lerp(2200, 700, far), 0.9);
    b1.connect(bg); b2.connect(bg);
    series(bg, drv, bodyLP).connect(out);
    sweep(b1.frequency, t0, profile.bodyF * jB, profile.bodyF2 * jB, profile.bodyDecay * 1.4);
    sweep(b2.frequency, t0, profile.bodyF * jB * 0.5, profile.bodyF2 * jB * 0.55, profile.bodyDecay * 1.6);
    ad(bg.gain, t0, bodyLevel, 0.0012, profile.bodyDecay * rng.range(0.9, 1.15));
    b1.start(t0); b2.start(t0);
    const bEnd = t0 + profile.bodyDecay * 1.8 + 0.02;
    b1.stop(bEnd); b2.stop(bEnd);
    end = Math.max(end, bEnd);

    // Sub thump — this is the one that moves air; keep it out of the reverb.
    const s = osc(actx, 'sine', profile.subF * jB);
    const sg = gain(actx, 0);
    s.connect(sg); sg.connect(out);
    sweep(s.frequency, t0, profile.subF * jB * 1.5, profile.subF * jB * 0.8, profile.subDecay);
    ad(sg.gain, t0, (0.5 + far * 0.55) * profile.level, 0.004, profile.subDecay * 1.3);
    s.start(t0); s.stop(t0 + profile.subDecay * 2 + 0.05);
    end = Math.max(end, t0 + profile.subDecay * 2 + 0.05);
  }

  /* ---- 3. crack -------------------------------------------------- */
  if (nearP > 0.03) {
    const src = bank.source('white', rng, rng.range(0.85, 1.25));
    const bp = biquad(actx, 'bandpass', profile.crackF * jC, profile.crackQ * v.crackQ);
    const res = biquad(actx, 'peaking', profile.crackF * jC * 1.9, 1.6, 6 + v.tilt);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive, profile.asym * 0.6), '2x');
    const cg = gain(actx, 0);
    series(src, bp, res, drv, cg).connect(out);
    // The crack's own band sweeps down a little: the shock front decays.
    sweep(bp.frequency, t0, profile.crackF * jC * 1.35, profile.crackF * jC * 0.8, profile.crackDecay * 2);
    ad(cg.gain, t0, 1.05 * nearP * jL * profile.level, 0.0015, profile.crackDecay * rng.range(0.85, 1.2));
    src.start(t0, src._offset, profile.crackDecay * 3 + 0.05);
    end = Math.max(end, t0 + profile.crackDecay * 3);
  }

  /* ---- 4. mid body ---------------------------------------------- */
  {
    const src = bank.source('pink', rng, rng.range(0.8, 1.25));
    const bp = biquad(actx, 'bandpass', profile.midF * v.mid, 1.1);
    const mg = gain(actx, 0);
    series(src, bp, mg).connect(out);
    ad(mg.gain, t0, (0.5 + far * 0.35) * jL * profile.level, 0.002, profile.midDecay * 1.4);
    src.start(t0, src._offset, profile.midDecay * 4 + 0.05);
  }

  /* ---- 5. tail --------------------------------------------------- */
  {
    const tailDur = profile.tailDecay * jT * (1 + far * 1.6);
    const src = bank.source('pink', rng, rng.range(0.7, 1.15));
    const lp = biquad(actx, 'lowpass', profile.tailF, 0.6);
    const hp = biquad(actx, 'highpass', lerp(160, 70, far), 0.7);
    const tg = gain(actx, 0);
    series(src, hp, lp, tg).connect(out);
    sweep(lp.frequency, t0, profile.tailF * lerp(1, 0.35, far), profile.tailEndF * lerp(1, 0.6, far), tailDur);
    ad(tg.gain, t0, (0.42 + far * 0.5) * jL * profile.level, 0.006, tailDur);
    src.start(t0, src._offset, tailDur * 1.3 + 0.05);
    end = Math.max(end, t0 + tailDur * 1.3);
  }

  /* ---- 6. mechanical / bolt ------------------------------------- */
  // Only audible close up — a rifle 40 m away has no audible action noise, and
  // spending nodes on it would be waste.
  if (dist < 14 && profile.mechLevel > 0) {
    const md = profile.mechDelay * rng.range(0.85, 1.2);
    const lvl = profile.mechLevel * v.mech * (fp ? 1 : 0.6) * clamp(1 - dist / 14, 0.15, 1);
    const partials = profile.mechPartials;
    const bolt = struckResonator(actx, bank, rng, t0 + md, [
      { f: partials[0] * rng.range(0.96, 1.05), q: 26, g: 0.5 * lvl, decay: 0.055 },
      { f: partials[1] * rng.range(0.96, 1.05), q: 20, g: 0.34 * lvl, decay: 0.035 },
      { f: partials[2] * rng.range(0.96, 1.05), q: 14, g: 0.2 * lvl, decay: 0.02 },
    ], 0.0035);
    bolt.connect(out);
    // Return-to-battery: a second, softer clack a few ms later.
    const back = struckResonator(actx, bank, rng, t0 + md * 2.1, [
      { f: partials[0] * 0.88, q: 18, g: 0.3 * lvl, decay: 0.04 },
      { f: partials[1] * 1.12, q: 12, g: 0.16 * lvl, decay: 0.022 },
    ], 0.003);
    back.connect(out);
    // Spring/gas hiss.
    const hs = bank.source('white', rng, rng.range(1, 1.4));
    const hbp = biquad(actx, 'bandpass', 4200 * rng.range(0.9, 1.1), 1.4);
    const hg = gain(actx, 0);
    series(hs, hbp, hg).connect(out);
    ad(hg.gain, t0 + md * 0.6, 0.12 * lvl, 0.006, 0.05);
    hs.start(t0 + md * 0.6, hs._offset, 0.12);
    end = Math.max(end, t0 + md * 2.1 + 0.1);
  }

  /* ---- 7. distant rolling boom ---------------------------------- */
  if (far > 0.12) {
    const boomDur = 0.28 + dist * 0.0055;
    const src = bank.source('brown', rng, rng.range(0.6, 1.0));
    const lp = biquad(actx, 'lowpass', 420, 0.8);
    const bg = gain(actx, 0);
    series(src, lp, bg).connect(out);
    sweep(lp.frequency, t0, 620, 190, boomDur);
    ad(bg.gain, t0, 0.95 * far * far * profile.level, 0.012 + dist * 0.0004, boomDur);
    src.start(t0, src._offset, boomDur * 1.4 + 0.05);
    end = Math.max(end, t0 + boomDur * 1.4);

    // Ground/terrain bounce: one discrete slap after the direct sound. This is
    // the detail that makes long-range fire read as *outdoors*.
    const bounceT = t0 + clamp(dist * 0.0022, 0.012, 0.12);
    const b2 = bank.source('pink', rng, rng.range(0.6, 0.9));
    const blp = biquad(actx, 'lowpass', 900, 0.7);
    const b2g = gain(actx, 0);
    series(b2, blp, b2g).connect(out);
    ad(b2g.gain, bounceT, 0.3 * far, 0.004, 0.12 + dist * 0.001);
    b2.start(bounceT, b2._offset, 0.4);
  }

  /* ---- shotgun pellet spatter ----------------------------------- */
  if (profile.pellets && nearP > 0.2) {
    for (let i = 0; i < profile.pellets; i++) {
      const pt = t0 + rng.range(0.0004, 0.006);
      const src = bank.source('white', rng, rng.range(0.9, 1.4));
      const bp = biquad(actx, 'bandpass', rng.range(2600, 6200), 1.8);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      hit(g.gain, pt, 0.1 * nearP, rng.range(0.004, 0.014));
      src.start(pt, src._offset, 0.05);
    }
  }

  const send = profile.send * (1 + far * 1.4) * (o.echoBoost ?? 1);
  return { node: out, end: end + 0.05, send };
}

/**
 * Supersonic round passing near the listener. Tiny, cheap, and enormously
 * effective at making incoming fire feel dangerous.
 */
export function bulletWhizz(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const miss = clamp(o.miss ?? 1.5, 0.15, 6); // metres from the ear
  const level = clamp(1.1 - miss / 6, 0.1, 1) * (o.gain ?? 1);
  const out = gain(actx, 3.2); // VOICE TRIM
  const src = bank.source('white', rng, rng.range(0.9, 1.2));
  const bp = biquad(actx, 'bandpass', 2400, 3.2);
  const g = gain(actx, 0);
  series(src, bp, g).connect(out);
  // The N-wave's apparent pitch drops sharply as the round passes — Doppler on
  // a Mach 2.5 projectile is violent.
  const dur = 0.055 + miss * 0.012;
  sweep(bp.frequency, t0, rng.range(3600, 5200), rng.range(900, 1500), dur);
  ad(g.gain, t0, 1.5 * level, 0.004, dur);
  src.start(t0, src._offset, dur * 2);
  // Snap of the shock front.
  const s2 = bank.source('white', rng, 1.2);
  const hp = biquad(actx, 'highpass', 4000, 0.7);
  const g2 = gain(actx, 0);
  series(s2, hp, g2).connect(out);
  hit(g2.gain, t0, 0.85 * level, 0.006);
  s2.start(t0, s2._offset, 0.03);
  return { node: out, end: t0 + dur * 2 + 0.05, send: 0.25 };
}

/** Dry-fire click when the magazine is empty. */
export function dryFire(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 1);
  const r = struckResonator(actx, bank, rng, t0, [
    { f: 2600 * rng.range(0.95, 1.05), q: 24, g: 1.2, decay: 0.035 },
    { f: 4700, q: 16, g: 0.66, decay: 0.02 },
    { f: 860, q: 10, g: 0.5, decay: 0.05 },
  ], 0.0025);
  r.connect(out);
  return { node: out, end: t0 + 0.14, send: 0.2 };
}
