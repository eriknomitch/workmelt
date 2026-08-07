/**
 * AUDIO / FOLEY
 *
 * Impacts, footsteps, shell casings, reload mechanics, explosions, body falls
 * and UI. Everything is keyed off the twelve surface names in ARCHITECTURE.md
 * so physics, FX, decals and audio always agree about what was hit.
 *
 * The recurring recipe for a physical impact is:
 *   transient (contact)  +  body (mass)  +  texture (material)  +  debris
 * Which of those four dominates is what makes concrete sound like concrete and
 * flesh sound like flesh; the envelope shapes matter far more than the exact
 * filter frequencies.
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, semis, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * Per-surface impact recipe.
 *  bodyF/bodyDecay  the mass thump
 *  ring             high-Q partials (metal, glass, wood) or null
 *  tex              { kind, f, q, decay, level } the material texture burst
 *  grains           number of debris grains
 *  bright           transient level 0..1
 *  wet              reverb send
 */
const IMPACT = {
  concrete: {
    bright: 0.85, bodyF: 180, bodyDecay: 0.05, ring: null,
    tex: { kind: 'white', f: 2600, q: 0.9, decay: 0.075, level: 0.75 },
    dust: { f: 1200, decay: 0.3, level: 0.16 }, grains: 5, wet: 0.4,
  },
  plaster: {
    bright: 0.7, bodyF: 220, bodyDecay: 0.035, ring: null,
    tex: { kind: 'white', f: 1900, q: 0.8, decay: 0.05, level: 0.6 },
    dust: { f: 900, decay: 0.42, level: 0.26 }, grains: 6, wet: 0.42,
  },
  metal: {
    bright: 1.0, bodyF: 150, bodyDecay: 0.035,
    ring: [{ f: 1750, q: 34, g: 0.42, decay: 0.28 }, { f: 3120, q: 26, g: 0.3, decay: 0.17 },
      { f: 5400, q: 18, g: 0.18, decay: 0.09 }, { f: 8100, q: 12, g: 0.09, decay: 0.05 }],
    tex: { kind: 'white', f: 5200, q: 1.2, decay: 0.03, level: 0.5 },
    dust: null, grains: 3, wet: 0.5,
  },
  wood: {
    bright: 0.6, bodyF: 320, bodyDecay: 0.055,
    ring: [{ f: 420, q: 14, g: 0.35, decay: 0.11 }, { f: 780, q: 11, g: 0.2, decay: 0.07 },
      { f: 1520, q: 8, g: 0.1, decay: 0.04 }],
    tex: { kind: 'white', f: 1500, q: 1.0, decay: 0.045, level: 0.45 },
    dust: null, grains: 5, wet: 0.32,
  },
  dirt: {
    bright: 0.25, bodyF: 120, bodyDecay: 0.07, ring: null,
    tex: { kind: 'brown', f: 700, q: 0.7, decay: 0.09, level: 0.7 },
    dust: { f: 600, decay: 0.34, level: 0.2 }, grains: 4, wet: 0.2,
  },
  sand: {
    bright: 0.18, bodyF: 105, bodyDecay: 0.055, ring: null,
    tex: { kind: 'white', f: 1500, q: 0.5, decay: 0.13, level: 0.5 },
    dust: { f: 1000, decay: 0.4, level: 0.24 }, grains: 3, wet: 0.16,
  },
  glass: {
    bright: 1.0, bodyF: 500, bodyDecay: 0.02,
    ring: [{ f: 3400, q: 40, g: 0.34, decay: 0.13 }, { f: 5300, q: 34, g: 0.26, decay: 0.1 },
      { f: 7900, q: 26, g: 0.2, decay: 0.07 }, { f: 11200, q: 18, g: 0.12, decay: 0.05 }],
    tex: { kind: 'crackle', f: 6000, q: 0.9, decay: 0.28, level: 0.6 },
    dust: null, grains: 11, wet: 0.46,
  },
  water: {
    bright: 0.3, bodyF: 260, bodyDecay: 0.03, ring: null,
    tex: { kind: 'white', f: 1800, q: 0.8, decay: 0.14, level: 0.75, rise: true },
    dust: null, grains: 4, wet: 0.3, bubbles: true,
  },
  foliage: {
    bright: 0.25, bodyF: 380, bodyDecay: 0.02, ring: null,
    tex: { kind: 'crackle', f: 2600, q: 0.8, decay: 0.16, level: 0.6 },
    dust: null, grains: 7, wet: 0.22,
  },
  fabric: {
    bright: 0.2, bodyF: 150, bodyDecay: 0.045, ring: null,
    tex: { kind: 'white', f: 900, q: 0.6, decay: 0.06, level: 0.4 },
    dust: { f: 700, decay: 0.2, level: 0.1 }, grains: 2, wet: 0.18,
  },
  flesh: {
    bright: 0.35, bodyF: 128, bodyDecay: 0.06, ring: null,
    tex: { kind: 'white', f: 620, q: 1.4, decay: 0.055, level: 0.62 },
    dust: null, grains: 3, wet: 0.24, wet_squelch: true,
  },
  rubber: {
    bright: 0.3, bodyF: 190, bodyDecay: 0.04,
    ring: [{ f: 260, q: 9, g: 0.2, decay: 0.06 }],
    tex: { kind: 'white', f: 1100, q: 0.9, decay: 0.03, level: 0.3 },
    dust: null, grains: 1, wet: 0.2,
  },
};

/* ------------------------------------------------------------------ */
/* Bullet impacts                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o { when, surface, energy (0..1.5), distance }
 */
export function surfaceImpact(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const s = IMPACT[o.surface] ?? IMPACT.concrete;
  const e = clamp(o.energy ?? 1, 0.15, 1.6);
  const jit = semis(rng.range(-2.5, 2.5));
  const out = gain(actx, 0.22);  // VOICE TRIM
  let end = t0 + 0.2;

  /* transient */
  if (s.bright > 0.05) {
    const src = bank.source('white', rng, rng.range(0.9, 1.35));
    const hp = biquad(actx, 'highpass', 3000 * jit, 0.7);
    const g = gain(actx, 0);
    series(src, hp, g).connect(out);
    hit(g.gain, t0, 0.55 * s.bright * e, rng.range(0.003, 0.008));
    src.start(t0, src._offset, 0.04);
  }

  /* body */
  {
    const b = osc(actx, 'sine', s.bodyF * jit);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2.5, 0.4), '2x');
    b.connect(g); series(g, drv).connect(out);
    sweep(b.frequency, t0, s.bodyF * jit * 1.6, s.bodyF * jit * 0.7, s.bodyDecay * 1.5);
    ad(g.gain, t0, 0.5 * e, 0.0015, s.bodyDecay * rng.range(0.85, 1.2));
    b.start(t0); b.stop(t0 + s.bodyDecay * 2.2 + 0.02);
    end = Math.max(end, t0 + s.bodyDecay * 2.2);
  }

  /* material texture */
  {
    const tx = s.tex;
    const src = bank.source(tx.kind, rng, rng.range(0.8, 1.3));
    const bp = biquad(actx, 'bandpass', tx.f * jit, tx.q);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    if (tx.rise) sweep(bp.frequency, t0, tx.f * 0.4, tx.f * 2.2, tx.decay);
    else sweep(bp.frequency, t0, tx.f * 1.5 * jit, tx.f * 0.6 * jit, tx.decay * 1.6);
    ad(g.gain, t0, tx.level * e, tx.rise ? 0.008 : 0.0015, tx.decay * rng.range(0.85, 1.25));
    src.start(t0, src._offset, tx.decay * 3 + 0.05);
    end = Math.max(end, t0 + tx.decay * 3);
  }

  /* resonant ring (metal / glass / wood) */
  if (s.ring) {
    const parts = [];
    for (const p of s.ring) {
      parts.push({
        f: p.f * semis(rng.range(-3, 3)),
        q: p.q * rng.range(0.8, 1.25),
        g: p.g * e,
        decay: p.decay * rng.range(0.75, 1.3),
      });
    }
    const r = struckResonator(actx, bank, rng, t0, parts, 0.0035);
    r.connect(out);
    end = Math.max(end, t0 + 0.4);
  }

  /* dust / powder cloud */
  if (s.dust) {
    const src = bank.source('white', rng, rng.range(0.7, 1.1));
    const lp = biquad(actx, 'lowpass', s.dust.f, 0.8);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, s.dust.f * 1.4, s.dust.f * 0.5, s.dust.decay);
    ad(g.gain, t0, s.dust.level * e, 0.02, s.dust.decay * rng.range(0.8, 1.3));
    src.start(t0, src._offset, s.dust.decay * 2 + 0.05);
    end = Math.max(end, t0 + s.dust.decay * 2);
  }

  /* debris grains — chips, splinters, glass shards landing */
  const grains = Math.round(s.grains * clamp(e, 0.3, 1.4));
  for (let i = 0; i < grains; i++) {
    const gt = t0 + rng.range(0.015, 0.06) + i * rng.range(0.01, 0.055);
    const r = struckResonator(actx, bank, rng, gt, [
      { f: rng.range(1800, 9000), q: rng.range(12, 30), g: rng.range(0.02, 0.05) * e, decay: rng.range(0.01, 0.05) },
    ], 0.0018);
    r.connect(out);
    end = Math.max(end, gt + 0.08);
  }

  /* water bubbles */
  if (s.bubbles) {
    for (let i = 0; i < 4; i++) {
      const bt = t0 + rng.range(0.02, 0.18);
      const b = osc(actx, 'sine', rng.range(400, 1400));
      const g = gain(actx, 0);
      b.connect(g); g.connect(out);
      sweep(b.frequency, bt, rng.range(350, 700), rng.range(900, 2200), 0.05);
      hit(g.gain, bt, rng.range(0.04, 0.1) * e, 0.05);
      b.start(bt); b.stop(bt + 0.12);
      end = Math.max(end, bt + 0.14);
    }
  }

  /* flesh squelch */
  if (s.wet_squelch) {
    const src = bank.source('pink', rng, rng.range(0.7, 1.1));
    const bp = biquad(actx, 'bandpass', 380, 2.2);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, t0, 260, 900, 0.09);
    ad(g.gain, t0 + 0.004, 0.4 * e, 0.006, 0.1);
    src.start(t0, src._offset, 0.25);
  }

  return { node: out, end: end + 0.05, send: s.wet };
}

/* ------------------------------------------------------------------ */
/* Footsteps                                                          */
/* ------------------------------------------------------------------ */

/** Per-surface footstep character. */
const STEP = {
  concrete: { bodyF: 92, bodyDecay: 0.055, texKind: 'white', texF: 2100, texQ: 0.7, texDecay: 0.045, texLevel: 0.5, scuff: 0.35, grit: 4 },
  plaster:  { bodyF: 100, bodyDecay: 0.05, texKind: 'white', texF: 1800, texQ: 0.7, texDecay: 0.05, texLevel: 0.45, scuff: 0.3, grit: 4 },
  metal:    { bodyF: 120, bodyDecay: 0.05, texKind: 'white', texF: 3200, texQ: 1.0, texDecay: 0.04, texLevel: 0.5, scuff: 0.3, grit: 2,
    ring: [{ f: 620, q: 16, g: 0.24, decay: 0.16 }, { f: 1480, q: 20, g: 0.16, decay: 0.11 }, { f: 2900, q: 14, g: 0.08, decay: 0.06 }] },
  wood:     { bodyF: 110, bodyDecay: 0.06, texKind: 'white', texF: 1300, texQ: 0.8, texDecay: 0.04, texLevel: 0.4, scuff: 0.28, grit: 2,
    ring: [{ f: 260, q: 12, g: 0.26, decay: 0.09 }, { f: 540, q: 9, g: 0.14, decay: 0.05 }] },
  dirt:     { bodyF: 78, bodyDecay: 0.07, texKind: 'brown', texF: 620, texQ: 0.6, texDecay: 0.075, texLevel: 0.62, scuff: 0.45, grit: 6 },
  sand:     { bodyF: 70, bodyDecay: 0.06, texKind: 'white', texF: 1500, texQ: 0.45, texDecay: 0.14, texLevel: 0.6, scuff: 0.7, grit: 3 },
  glass:    { bodyF: 96, bodyDecay: 0.04, texKind: 'crackle', texF: 5200, texQ: 0.8, texDecay: 0.2, texLevel: 0.6, scuff: 0.3, grit: 9 },
  water:    { bodyF: 88, bodyDecay: 0.045, texKind: 'white', texF: 1600, texQ: 0.7, texDecay: 0.17, texLevel: 0.8, scuff: 0.5, grit: 3, splash: true },
  foliage:  { bodyF: 84, bodyDecay: 0.05, texKind: 'crackle', texF: 2400, texQ: 0.7, texDecay: 0.18, texLevel: 0.7, scuff: 0.5, grit: 6 },
  fabric:   { bodyF: 82, bodyDecay: 0.05, texKind: 'white', texF: 800, texQ: 0.6, texDecay: 0.05, texLevel: 0.3, scuff: 0.35, grit: 0 },
  flesh:    { bodyF: 86, bodyDecay: 0.055, texKind: 'white', texF: 520, texQ: 1.2, texDecay: 0.05, texLevel: 0.35, scuff: 0.2, grit: 0 },
  rubber:   { bodyF: 96, bodyDecay: 0.04, texKind: 'white', texF: 1000, texQ: 0.8, texDecay: 0.03, texLevel: 0.28, scuff: 0.2, grit: 0 },
};

/**
 * @param {object} o { when, surface, gait: 'walk'|'run'|'sprint'|'crouch'|'land',
 *                     level, gear (0..1), distance }
 */
export function footstep(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const s = STEP[o.surface] ?? STEP.concrete;
  const gait = o.gait ?? 'walk';
  const weight = gait === 'sprint' ? 1.25 : gait === 'run' ? 1.0 : gait === 'land' ? 1.7 : gait === 'crouch' ? 0.42 : 0.62;
  const lvl = (o.level ?? 1) * weight;
  const jit = semis(rng.range(-3, 3));
  const out = gain(actx, 0.32);  // VOICE TRIM
  let end = t0 + 0.3;

  /* heel/toe transient — two contacts, milliseconds apart, is what reads as a
     foot rather than a hammer. */
  const contacts = gait === 'land' ? 1 : 2;
  for (let c = 0; c < contacts; c++) {
    const ct = t0 + (c === 0 ? 0 : rng.range(0.012, 0.032));
    const cl = c === 0 ? 1 : rng.range(0.35, 0.6);

    const b = osc(actx, 'sine', s.bodyF * jit);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(1.8, 0.5), '2x');
    b.connect(bg); series(bg, drv).connect(out);
    sweep(b.frequency, ct, s.bodyF * jit * 1.7, s.bodyF * jit * 0.75, s.bodyDecay * 1.4);
    ad(bg.gain, ct, 0.42 * lvl * cl, 0.0025, s.bodyDecay * rng.range(0.85, 1.2));
    b.start(ct); b.stop(ct + s.bodyDecay * 2.4 + 0.02);

    const src = bank.source(s.texKind, rng, rng.range(0.8, 1.25));
    const bp = biquad(actx, 'bandpass', s.texF * jit, s.texQ);
    const tg = gain(actx, 0);
    series(src, bp, tg).connect(out);
    sweep(bp.frequency, ct, s.texF * 1.4 * jit, s.texF * 0.55 * jit, s.texDecay * 2);
    ad(tg.gain, ct, s.texLevel * lvl * cl, 0.002, s.texDecay * rng.range(0.8, 1.3));
    src.start(ct, src._offset, s.texDecay * 3 + 0.05);
    end = Math.max(end, ct + s.texDecay * 3);

    if (s.ring && c === 0) {
      const parts = s.ring.map((p) => ({
        f: p.f * semis(rng.range(-2, 2)), q: p.q * rng.range(0.85, 1.2),
        g: p.g * lvl, decay: p.decay * rng.range(0.8, 1.25),
      }));
      struckResonator(actx, bank, rng, ct, parts, 0.003).connect(out);
      end = Math.max(end, ct + 0.3);
    }
  }

  /* scuff — the slide of the sole, longer when running */
  if (s.scuff > 0.05) {
    const st = t0 + rng.range(0.01, 0.04);
    const dur = (gait === 'sprint' ? 0.13 : gait === 'run' ? 0.1 : 0.07) * rng.range(0.8, 1.3);
    const src = bank.source('white', rng, rng.range(0.85, 1.2));
    const bp = biquad(actx, 'bandpass', rng.range(2200, 4200), 0.8);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, st, rng.range(2800, 4600), rng.range(1200, 2000), dur);
    ad(g.gain, st, s.scuff * lvl * 0.5, 0.012, dur);
    src.start(st, src._offset, dur * 2);
    end = Math.max(end, st + dur * 2);
  }

  /* grit grains */
  for (let i = 0; i < s.grit; i++) {
    if (rng.float() > 0.55) continue;
    const gt = t0 + rng.range(0.004, 0.09);
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(2400, 9000), q: rng.range(10, 26), g: rng.range(0.015, 0.05) * lvl, decay: rng.range(0.008, 0.03) },
    ], 0.0015).connect(out);
  }

  /* water splash */
  if (s.splash) {
    const src = bank.source('white', rng, rng.range(0.9, 1.2));
    const bp = biquad(actx, 'bandpass', 900, 0.7);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, t0, 700, 3400, 0.16);
    ad(g.gain, t0 + 0.006, 0.45 * lvl, 0.01, 0.2);
    src.start(t0, src._offset, 0.4);
    end = Math.max(end, t0 + 0.42);
  }

  /* gear: sling swivels, mag pouches, buckles — only when moving fast */
  const gear = (o.gear ?? (gait === 'sprint' ? 1 : gait === 'run' ? 0.7 : gait === 'land' ? 0.9 : 0.25));
  if (gear > 0.05) {
    const n = 1 + ((rng.u32() % 3) | 0);
    for (let i = 0; i < n; i++) {
      const gt = t0 + rng.range(0.005, 0.11);
      struckResonator(actx, bank, rng, gt, [
        { f: rng.range(1600, 4200), q: rng.range(18, 40), g: rng.range(0.03, 0.1) * gear * lvl, decay: rng.range(0.03, 0.12) },
        { f: rng.range(4200, 8000), q: rng.range(12, 26), g: rng.range(0.01, 0.04) * gear * lvl, decay: rng.range(0.01, 0.05) },
      ], 0.002).connect(out);
      end = Math.max(end, gt + 0.18);
    }
    // Cloth/webbing rustle.
    const src = bank.source('white', rng, rng.range(0.7, 1.1));
    const bp = biquad(actx, 'bandpass', rng.range(1400, 2600), 0.6);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    ad(g.gain, t0, 0.09 * gear * lvl, 0.02, 0.13);
    src.start(t0, src._offset, 0.3);
  }

  return { node: out, end: end + 0.05, send: 0.3 };
}

/** Cloth movement, used for stance changes and ADS. */
export function cloth(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 1);
  const dur = rng.range(0.13, 0.26);
  const src = bank.source('white', rng, rng.range(0.7, 1.15));
  const bp = biquad(actx, 'bandpass', rng.range(1300, 2400), 0.55);
  const g = gain(actx, 0);
  series(src, bp, g).connect(out);
  sweep(bp.frequency, t0, rng.range(1000, 1600), rng.range(2200, 3400), dur);
  ad(g.gain, t0, 0.3 * lvl, 0.03, dur);
  src.start(t0, src._offset, dur * 2);
  if (rng.float() < 0.6) {
    struckResonator(actx, bank, rng, t0 + rng.range(0.02, 0.1), [
      { f: rng.range(2200, 5200), q: 26, g: 0.05 * lvl, decay: rng.range(0.03, 0.09) },
    ], 0.002).connect(out);
  }
  return { node: out, end: t0 + dur * 2 + 0.15, send: 0.2 };
}

/* ------------------------------------------------------------------ */
/* Shell casings                                                      */
/* ------------------------------------------------------------------ */

/**
 * A casing bounces 2–4 times with shortening intervals and then rolls. Brass on
 * concrete is one of the most recognisable sounds in a shooter; the trick is
 * that each bounce is a *different* set of partials because the shell lands on a
 * different part of itself.
 */
export function shellCasing(actx, bank, rng, o = {}) {
  const t0 = (o.when ?? actx.currentTime) + (o.flight ?? rng.range(0.28, 0.52));
  const surface = o.surface ?? 'concrete';
  const hard = surface === 'metal' || surface === 'concrete' || surface === 'glass' || surface === 'plaster';
  const soft = surface === 'dirt' || surface === 'sand' || surface === 'foliage' || surface === 'fabric';
  const out = gain(actx, 1);
  const base = rng.range(2650, 4200);
  let t = t0;
  let amp = (o.level ?? 1) * (soft ? 0.35 : 1) * rng.range(0.8, 1.1);
  const bounces = soft ? 1 : 2 + ((rng.u32() % 3) | 0);
  let end = t0;
  for (let i = 0; i < bounces; i++) {
    const detune = semis(rng.range(-4, 4));
    struckResonator(actx, bank, rng, t, [
      { f: base * detune, q: rng.range(30, 60), g: 0.95 * amp, decay: rng.range(0.05, 0.13) * (hard ? 1 : 0.5) },
      { f: base * detune * 1.87, q: rng.range(24, 44), g: 0.58 * amp, decay: rng.range(0.03, 0.08) },
      { f: base * detune * 3.1, q: rng.range(16, 30), g: 0.3 * amp, decay: rng.range(0.015, 0.04) },
      { f: base * detune * 0.42, q: 12, g: 0.2 * amp, decay: 0.03 },
    ], 0.0015).connect(out);
    end = t + 0.2;
    t += rng.range(0.045, 0.13) * (i === 0 ? 1 : 0.6);
    amp *= rng.range(0.38, 0.62);
    if (amp < 0.03) break;
  }
  // Roll: a stream of very quiet, very short pings.
  if (hard && rng.float() < 0.55) {
    const rolls = 3 + ((rng.u32() % 5) | 0);
    for (let i = 0; i < rolls; i++) {
      const rt = t + i * rng.range(0.018, 0.05);
      struckResonator(actx, bank, rng, rt, [
        { f: base * semis(rng.range(-5, 5)), q: rng.range(20, 44), g: rng.range(0.03, 0.09) * (o.level ?? 1), decay: rng.range(0.01, 0.03) },
      ], 0.0012).connect(out);
      end = Math.max(end, rt + 0.06);
    }
  }
  return { node: out, end: end + 0.05, send: 0.42 };
}

/* ------------------------------------------------------------------ */
/* Reload foley                                                       */
/* ------------------------------------------------------------------ */

/**
 * Reload mechanics, one call per `weapon:reload` phase. Keeping the phases as
 * separate one-shots (instead of one long sound) is what lets the audio stay
 * locked to the animation whatever its length.
 */
/** The four phases are wildly different in energy; level them per phase. */
const RELOAD_TRIM = { start: 3.2, magout: 3.0, magin: 1.0, end: 1.5 };

export function reloadPhase(actx, bank, rng, phase, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const heavy = o.heavy ?? 1; // LMG/shotgun = heavier hardware
  const out = gain(actx, 0.42 * (RELOAD_TRIM[phase] ?? 1.5)); // VOICE TRIM
  let end = t0 + 0.3;
  const metal = (t, parts, exc = 0.0025) => {
    struckResonator(actx, bank, rng, t, parts, exc).connect(out);
    end = Math.max(end, t + 0.35);
  };
  const rustle = (t, dur, level, f) => {
    const src = bank.source('white', rng, rng.range(0.8, 1.2));
    const bp = biquad(actx, 'bandpass', f, 0.6);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    ad(g.gain, t, level, 0.02, dur);
    src.start(t, src._offset, dur * 2 + 0.05);
    end = Math.max(end, t + dur * 2);
  };

  switch (phase) {
    case 'start':
      // Hand leaves the grip, palm slaps the magwell, mag catch is pressed.
      rustle(t0, 0.18, 0.2, rng.range(1400, 2200));
      metal(t0 + rng.range(0.04, 0.08), [
        { f: 2450 * semis(rng.range(-2, 2)), q: 30, g: 0.55 * heavy, decay: 0.03 },
        { f: 5100, q: 18, g: 0.25, decay: 0.016 },
        { f: 780, q: 10, g: 0.3 * heavy, decay: 0.045 },
      ]);
      break;

    case 'magout': {
      // Spring release, mag scrapes out of the well, then plastic hits the deck.
      metal(t0, [
        { f: 1650 * semis(rng.range(-2, 2)), q: 24, g: 0.65 * heavy, decay: 0.05 },
        { f: 3400, q: 16, g: 0.35, decay: 0.025 },
      ]);
      const st = t0 + 0.03;
      const src = bank.source('white', rng, rng.range(0.9, 1.3));
      const bp = biquad(actx, 'bandpass', 3200, 1.1);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, st, 4200, 1600, 0.12);
      ad(g.gain, st, 0.2, 0.01, 0.12);
      src.start(st, src._offset, 0.3);
      // Empty magazine hitting the ground — polymer, not metal.
      const dt = t0 + rng.range(0.16, 0.3);
      metal(dt, [
        { f: 480 * semis(rng.range(-3, 3)), q: 9, g: 0.2, decay: 0.05 },
        { f: 1180, q: 7, g: 0.11, decay: 0.03 },
        { f: 2600, q: 5, g: 0.05, decay: 0.015 },
      ], 0.004);
      end = Math.max(end, dt + 0.3);
      break;
    }

    case 'magin': {
      // Fresh mag guided in, seated with a palm strike: a low thunk plus a sharp
      // latch click. The thunk needs real low end or it feels weightless.
      rustle(t0, 0.12, 0.16, rng.range(1200, 2000));
      const it = t0 + rng.range(0.05, 0.1);
      const b = osc(actx, 'sine', 190 * heavy);
      const bg = gain(actx, 0);
      const drv = shaper(actx, saturationCurve(3, 0.5), '2x');
      b.connect(bg); series(bg, drv).connect(out);
      sweep(b.frequency, it, 230 * heavy, 110 * heavy, 0.06);
      ad(bg.gain, it, 0.4 * heavy, 0.002, 0.055);
      b.start(it); b.stop(it + 0.16);
      metal(it, [
        { f: 1250 * semis(rng.range(-2, 2)), q: 20, g: 0.3 * heavy, decay: 0.06 },
        { f: 2800, q: 26, g: 0.18, decay: 0.03 },
        { f: 6200, q: 14, g: 0.07, decay: 0.012 },
      ], 0.003);
      metal(it + rng.range(0.02, 0.05), [
        { f: 3600, q: 34, g: 0.16, decay: 0.02 },
        { f: 7400, q: 20, g: 0.07, decay: 0.01 },
      ], 0.0015);
      break;
    }

    case 'end':
    default: {
      // Charging handle: scrape, hard rearward stop, spring-driven return, and
      // the bolt slamming into battery.
      const st = t0;
      const src = bank.source('white', rng, rng.range(0.9, 1.25));
      const bp = biquad(actx, 'bandpass', 2600, 1.6);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, st, 1800, 4200, 0.07);
      ad(g.gain, st, 0.24, 0.008, 0.07);
      src.start(st, src._offset, 0.2);
      metal(st + 0.06, [
        { f: 1450 * semis(rng.range(-2, 2)), q: 22, g: 0.3 * heavy, decay: 0.05 },
        { f: 3100, q: 18, g: 0.16, decay: 0.022 },
      ]);
      // Spring ring — the metallic "zing" behind the clack.
      metal(st + 0.065, [
        { f: 4900 * semis(rng.range(-3, 3)), q: 46, g: 0.09, decay: 0.16 },
        { f: 7200, q: 38, g: 0.05, decay: 0.1 },
      ], 0.002);
      const bt = st + rng.range(0.1, 0.15);
      const b = osc(actx, 'sine', 150 * heavy);
      const bg = gain(actx, 0);
      b.connect(bg); bg.connect(out);
      sweep(b.frequency, bt, 200 * heavy, 90 * heavy, 0.05);
      ad(bg.gain, bt, 0.38 * heavy, 0.0015, 0.05);
      b.start(bt); b.stop(bt + 0.14);
      metal(bt, [
        { f: 1750, q: 20, g: 0.34 * heavy, decay: 0.05 },
        { f: 3900, q: 15, g: 0.15, decay: 0.02 },
        { f: 8200, q: 10, g: 0.05, decay: 0.008 },
      ], 0.0035);
      break;
    }
  }
  return { node: out, end: end + 0.05, send: 0.3 };
}

/* ------------------------------------------------------------------ */
/* Explosions                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o { when, distance, radius, level }
 * Near: a violent transient, a huge sub sweep and a bright shrapnel spatter.
 * Far: almost no transient, a long rolling low rumble, and a big wet tail.
 */
export function explosion(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const size = clamp((o.radius ?? 6) / 6, 0.5, 2.4);
  const near = clamp(1 - dist / 70, 0, 1);
  const far = 1 - near;
  const lvl = (o.level ?? 1) * size;
  const out = gain(actx, 0.42); // VOICE TRIM
  let end = t0 + 1;

  /* detonation transient */
  if (near > 0.05) {
    const src = bank.source('white', rng, rng.range(0.9, 1.2));
    const hp = biquad(actx, 'highpass', 1800, 0.6);
    const drv = shaper(actx, saturationCurve(14, 0.7), '4x');
    const g = gain(actx, 0);
    series(src, hp, drv, g).connect(out);
    hit(g.gain, t0, 0.85 * near * lvl, 0.02);
    src.start(t0, src._offset, 0.1);
  }

  /* sub-bass impact: the thing you feel in your chest */
  {
    const s = osc(actx, 'sine', 110);
    const s2 = osc(actx, 'triangle', 62);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(4, 0.6), '2x');
    const lp = biquad(actx, 'lowpass', 220, 0.9);
    s.connect(g); s2.connect(g);
    series(g, drv, lp).connect(out);
    const subDur = (0.55 + size * 0.35) * rng.range(0.9, 1.15);
    sweep(s.frequency, t0, 130 * size, 26, subDur);
    sweep(s2.frequency, t0, 74 * size, 21, subDur * 1.2);
    ad(g.gain, t0, 1.0 * lvl * (0.55 + near * 0.6), 0.008 + far * 0.05, subDur);
    s.start(t0); s2.start(t0);
    s.stop(t0 + subDur * 1.6); s2.stop(t0 + subDur * 1.6);
    end = Math.max(end, t0 + subDur * 1.6);
  }

  /* blast body: broadband noise under a fast-falling lowpass */
  {
    const dur = (0.45 + size * 0.5) * (1 + far * 1.8);
    const src = bank.source('brown', rng, rng.range(0.6, 1.1));
    const lp = biquad(actx, 'lowpass', 6000, 0.8);
    const drv = shaper(actx, saturationCurve(6, 0.5), '2x');
    const g = gain(actx, 0);
    series(src, lp, drv, g).connect(out);
    sweep(lp.frequency, t0, lerp(7000, 700, far), lerp(260, 130, far), dur);
    ad(g.gain, t0, 0.8 * lvl, 0.01 + far * 0.06, dur);
    src.start(t0, src._offset, dur * 1.4 + 0.1);
    end = Math.max(end, t0 + dur * 1.4);
  }

  /* debris / shrapnel: grains scattered over the following second */
  const grains = Math.round(lerp(26, 4, far) * size);
  for (let i = 0; i < grains; i++) {
    const gt = t0 + rng.range(0.02, 0.9) * rng.range(0.3, 1);
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(700, 7000), q: rng.range(8, 32), g: rng.range(0.02, 0.09) * near * lvl, decay: rng.range(0.01, 0.09) },
    ], 0.002).connect(out);
    end = Math.max(end, gt + 0.15);
  }

  /* dust and settling */
  {
    const dur = 1.0 + size * 0.8;
    const src = bank.source('pink', rng, rng.range(0.5, 0.9));
    const lp = biquad(actx, 'lowpass', 1400, 0.7);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, 1600, 320, dur);
    ad(g.gain, t0 + 0.05, 0.2 * lvl * (0.4 + near * 0.6), 0.12, dur);
    src.start(t0 + 0.05, src._offset, dur * 1.3);
    end = Math.max(end, t0 + dur * 1.3);
  }

  return { node: out, end: end + 0.1, send: 0.85 + far * 0.5 };
}

/** A body hitting the ground: mass, gear, and a wet slap. */
export function bodyFall(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.4); // VOICE TRIM
  const b = osc(actx, 'sine', 74);
  const bg = gain(actx, 0);
  const drv = shaper(actx, saturationCurve(2.2, 0.55), '2x');
  b.connect(bg); series(bg, drv).connect(out);
  sweep(b.frequency, t0, 96, 44, 0.12);
  ad(bg.gain, t0, 0.6 * lvl, 0.004, 0.13);
  b.start(t0); b.stop(t0 + 0.35);

  const src = bank.source('white', rng, rng.range(0.7, 1.1));
  const lp = biquad(actx, 'lowpass', 900, 0.8);
  const g = gain(actx, 0);
  series(src, lp, g).connect(out);
  ad(g.gain, t0, 0.35 * lvl, 0.006, 0.16);
  src.start(t0, src._offset, 0.4);

  for (let i = 0; i < 5; i++) {
    const gt = t0 + rng.range(0.005, 0.26);
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(1500, 5200), q: rng.range(16, 40), g: rng.range(0.03, 0.09) * lvl, decay: rng.range(0.02, 0.1) },
    ], 0.002).connect(out);
  }
  return { node: out, end: t0 + 0.6, send: 0.4 };
}

/**
 * The mains going down: a breaker clunk, then the transformer hum winding
 * out of pitch and dying. Fallback for the sampled `world/powerdown` take —
 * the blackout is a gameplay signal (the map goes dark, `power:out`), so it
 * must sound even in a build with no encoded assets.
 */
export function powerDown(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.55); // VOICE TRIM

  // The breaker: a blunt mechanical thud, no ring — switchgear, not a bell.
  const th = osc(actx, 'sine', 68);
  const tg = gain(actx, 0);
  th.connect(tg); tg.connect(out);
  sweep(th.frequency, t0, 110, 46, 0.09);
  ad(tg.gain, t0, 0.7 * lvl, 0.003, 0.12);
  th.start(t0); th.stop(t0 + 0.3);
  const cl = bank.source('white', rng, 0.9);
  const clp = biquad(actx, 'lowpass', 1200, 0.7);
  const cg = gain(actx, 0);
  series(cl, clp, cg).connect(out);
  ad(cg.gain, t0, 0.3 * lvl, 0.002, 0.08);
  cl.start(t0, cl._offset, 0.2);

  // The hum: 50 Hz saw pair a few cents apart (a transformer beats, a clean
  // oscillator does not), sagging to sub-audio over two seconds as the
  // rotating mass runs down, level dying with the pitch.
  const DUR = 2.1;
  const drv = shaper(actx, saturationCurve(2.0, 0.3), '2x');
  const hg = gain(actx, 0);
  for (const f of [50, 50.7]) {
    // Constructed at the sweep's own start pitch so the first 100 ms hold,
    // before the ramp begins, is not a different note.
    const h = osc(actx, 'sawtooth', f * 2);
    h.connect(hg);
    sweep(h.frequency, t0 + 0.1, f * 2, f * 0.28, DUR);
    h.start(t0); h.stop(t0 + 0.15 + DUR);
  }
  const hlp = biquad(actx, 'lowpass', 480, 0.9);
  series(hg, drv, hlp).connect(out);
  ad(hg.gain, t0 + 0.05, 0.5 * lvl, 0.03, DUR);

  return { node: out, end: t0 + 0.2 + DUR, send: 0.25 };
}

/**
 * The mirror: `power:restored`. Same breaker, hum climbing back to pitch and
 * then releasing — a one-shot voice cannot sustain the mains forever, so the
 * swell hands off to the (visual) lights it just brought back.
 */
export function powerUp(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.55); // VOICE TRIM

  const th = osc(actx, 'sine', 68);
  const tg = gain(actx, 0);
  th.connect(tg); tg.connect(out);
  sweep(th.frequency, t0, 110, 46, 0.09);
  ad(tg.gain, t0, 0.7 * lvl, 0.003, 0.12);
  th.start(t0); th.stop(t0 + 0.3);
  const cl = bank.source('white', rng, 0.9);
  const clp = biquad(actx, 'lowpass', 1200, 0.7);
  const cg = gain(actx, 0);
  series(cl, clp, cg).connect(out);
  ad(cg.gain, t0, 0.3 * lvl, 0.002, 0.08);
  cl.start(t0, cl._offset, 0.2);

  // Rotating mass spinning up: the powerDown sweep run backwards, and the
  // envelope inverted — a slow attack up the swell, then a release once the
  // hum reaches pitch.
  const DUR = 2.1;
  const drv = shaper(actx, saturationCurve(2.0, 0.3), '2x');
  const hg = gain(actx, 0);
  for (const f of [50, 50.7]) {
    const h = osc(actx, 'sawtooth', f * 0.28);
    h.connect(hg);
    sweep(h.frequency, t0 + 0.1, f * 0.28, f * 2, DUR * 0.7);
    h.start(t0); h.stop(t0 + 0.15 + DUR);
  }
  const hlp = biquad(actx, 'lowpass', 480, 0.9);
  series(hg, drv, hlp).connect(out);
  ad(hg.gain, t0 + 0.05, 0.5 * lvl, DUR * 0.6, DUR * 0.4);

  return { node: out, end: t0 + 0.2 + DUR, send: 0.25 };
}

/* ------------------------------------------------------------------ */
/* UI                                                                 */
/* ------------------------------------------------------------------ */

/** Non-diegetic feedback. Short, dry, and deliberately synthetic. */
export function uiSound(actx, bank, rng, kind, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 1);
  const lvl = o.level ?? 1;
  switch (kind) {
    case 'hitmarker': {
      const o1 = osc(actx, 'square', 2400);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 5200, 0.7);
      o1.connect(g); series(g, lp).connect(out);
      hit(g.gain, t0, 0.55 * lvl, 0.022);
      o1.start(t0); o1.stop(t0 + 0.06);
      break;
    }
    case 'headshot': {
      const o1 = osc(actx, 'square', 3200);
      const o2 = osc(actx, 'square', 4800);
      const g = gain(actx, 0);
      o1.connect(g); o2.connect(g); g.connect(out);
      hit(g.gain, t0, 0.34 * lvl, 0.05);
      o1.start(t0); o2.start(t0 + 0.03);
      o1.stop(t0 + 0.12); o2.stop(t0 + 0.14);
      break;
    }
    case 'kill': {
      for (let i = 0; i < 3; i++) {
        const o1 = osc(actx, 'triangle', 900 * Math.pow(1.5, i));
        const g = gain(actx, 0);
        o1.connect(g); g.connect(out);
        ad(g.gain, t0 + i * 0.055, 0.3 * lvl, 0.004, 0.09);
        o1.start(t0 + i * 0.055); o1.stop(t0 + i * 0.055 + 0.2);
      }
      break;
    }
    case 'damage': {
      // Directional pain sting: a dissonant low pair, no melody.
      const o1 = osc(actx, 'sawtooth', 180);
      const o2 = osc(actx, 'sawtooth', 191);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 1400, 1.4);
      o1.connect(g); o2.connect(g); series(g, lp).connect(out);
      ad(g.gain, t0, 0.42 * lvl, 0.004, 0.22);
      o1.start(t0); o2.start(t0);
      o1.stop(t0 + 0.4); o2.stop(t0 + 0.4);
      break;
    }
    case 'armour': {
      // Ceramic plate strike: brighter and harder than a flesh hitmarker.
      const r = struckResonator(actx, bank, rng, t0, [
        { f: 3900, q: 30, g: 0.09 * lvl, decay: 0.045 },
        { f: 6400, q: 22, g: 0.05 * lvl, decay: 0.025 },
      ], 0.0015);
      r.connect(out);
      break;
    }
    case 'grenade_warn': {
      // Three rising beeps — reads as "danger", not as a notification.
      for (let i = 0; i < 3; i++) {
        const bt = t0 + i * 0.14;
        const o1 = osc(actx, 'square', 1150 * Math.pow(1.19, i));
        const lp = biquad(actx, 'lowpass', 4200, 0.8);
        const g = gain(actx, 0);
        o1.connect(g); series(g, lp).connect(out);
        ad(g.gain, bt, 0.3 * lvl, 0.004, 0.07);
        o1.start(bt); o1.stop(bt + 0.16);
      }
      break;
    }
    case 'regen': {
      // Soft filtered swell: the "you are OK now" cue. Deliberately unpitched.
      const src = bank.source('pink', rng, 0.9);
      const bp = biquad(actx, 'bandpass', 700, 1.1);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, t0, 500, 1900, 0.5);
      ad(g.gain, t0, 0.3 * lvl, 0.15, 0.45);
      src.start(t0, src._offset, 0.9);
      const o1 = osc(actx, 'sine', 420);
      const og = gain(actx, 0);
      o1.connect(og); og.connect(out);
      sweep(o1.frequency, t0, 380, 640, 0.45);
      ad(og.gain, t0, 0.12 * lvl, 0.14, 0.4);
      o1.start(t0); o1.stop(t0 + 0.8);
      break;
    }
    case 'lowhealth': {
      const o1 = osc(actx, 'sine', 92);
      const g = gain(actx, 0);
      o1.connect(g); g.connect(out);
      ad(g.gain, t0, 0.45 * lvl, 0.05, 0.55);
      o1.start(t0); o1.stop(t0 + 0.9);
      break;
    }
    /* ---- lobby / match start ------------------------------------------- */
    case 'join': {
      // Somebody entered the room: two clean rising notes (G5 -> C6), each with
      // an octave sine on top so it reads over a live firefight as well as over
      // a silent lobby. Rising = arrival; 'leave' is the same figure inverted.
      for (let i = 0; i < 2; i++) {
        const bt = t0 + i * 0.085;
        const f = i ? 1046 : 784;
        const o1 = osc(actx, 'triangle', f);
        const o2 = osc(actx, 'sine', f * 2);
        const g = gain(actx, 0);
        const lp = biquad(actx, 'lowpass', 6200, 0.7);
        o1.connect(g); o2.connect(g); series(g, lp).connect(out);
        ad(g.gain, bt, (i ? 0.3 : 0.22) * lvl, 0.005, 0.13);
        o1.start(bt); o2.start(bt);
        o1.stop(bt + 0.26); o2.stop(bt + 0.26);
      }
      break;
    }
    case 'leave': {
      for (let i = 0; i < 2; i++) {
        const bt = t0 + i * 0.085;
        const f = i ? 588 : 784;
        const o1 = osc(actx, 'triangle', f);
        const g = gain(actx, 0);
        const lp = biquad(actx, 'lowpass', 3800, 0.7);
        o1.connect(g); series(g, lp).connect(out);
        ad(g.gain, bt, 0.2 * lvl, 0.006, 0.12);
        o1.start(bt); o1.stop(bt + 0.24);
      }
      break;
    }
    case 'ready': {
      // Locked in: a hard mechanical click plus one bright confirm blip. The
      // click is what makes it feel like a switch rather than a notification.
      const clk = bank.source('white', rng, 1.6);
      const cbp = biquad(actx, 'bandpass', 2600, 1.6);
      const cg = gain(actx, 0);
      series(clk, cbp, cg).connect(out);
      hit(cg.gain, t0, 0.3 * lvl, 0.012);
      clk.start(t0, clk._offset, 0.06);
      const o1 = osc(actx, 'square', 1320);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 5200, 0.8);
      o1.connect(g); series(g, lp).connect(out);
      ad(g.gain, t0 + 0.012, 0.2 * lvl, 0.004, 0.1);
      o1.start(t0 + 0.012); o1.stop(t0 + 0.2);
      break;
    }
    case 'unready': {
      const o1 = osc(actx, 'square', 660);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 2600, 0.8);
      o1.connect(g); series(g, lp).connect(out);
      sweep(o1.frequency, t0, 660, 470, 0.09);
      ad(g.gain, t0, 0.18 * lvl, 0.004, 0.09);
      o1.start(t0); o1.stop(t0 + 0.18);
      break;
    }
    case 'countdown': {
      // One tick of the pre-match countdown. Deliberately dry and narrow so
      // three of them in a row read as a clock, not as a melody.
      const o1 = osc(actx, 'square', 880);
      const g = gain(actx, 0);
      const bp = biquad(actx, 'bandpass', 900, 1.1);
      o1.connect(g); series(g, bp).connect(out);
      ad(g.gain, t0, 0.26 * lvl, 0.003, 0.075);
      o1.start(t0); o1.stop(t0 + 0.16);
      break;
    }
    case 'matchstart': {
      // Deployment horn: a low fifth that swells under a filtered noise rush,
      // then a short bright cap so the moment of control lands on a transient.
      for (const [f, g0] of [[98, 0.3], [147, 0.22], [196, 0.14]]) {
        const o1 = osc(actx, 'sawtooth', f);
        const g = gain(actx, 0);
        const lp = biquad(actx, 'lowpass', 1500, 0.9);
        o1.connect(g); series(g, lp).connect(out);
        ad(g.gain, t0, g0 * lvl, 0.045, 0.7);
        o1.start(t0); o1.stop(t0 + 1.1);
      }
      const air = bank.source('pink', rng, 1);
      const bp = biquad(actx, 'bandpass', 500, 0.9);
      const ag = gain(actx, 0);
      series(air, bp, ag).connect(out);
      sweep(bp.frequency, t0, 380, 3200, 0.42);
      ad(ag.gain, t0, 0.2 * lvl, 0.13, 0.4);
      air.start(t0, air._offset, 0.9);
      const cap = osc(actx, 'triangle', 1568);
      const cg2 = gain(actx, 0);
      cap.connect(cg2); cg2.connect(out);
      ad(cg2.gain, t0 + 0.36, 0.16 * lvl, 0.004, 0.22);
      cap.start(t0 + 0.36); cap.stop(t0 + 0.7);
      break;
    }
    default: {
      const o1 = osc(actx, 'sine', 1200);
      const g = gain(actx, 0);
      o1.connect(g); g.connect(out);
      hit(g.gain, t0, 0.26 * lvl, 0.03);
      o1.start(t0); o1.stop(t0 + 0.08);
    }
  }
  // The deployment horn is the one UI voice that rings past a second; its slot
  // has to be held that long or the tail gets stolen mid-swell.
  if (kind === 'matchstart') return { node: out, end: t0 + 1.4, send: 0 };
  return { node: out, end: t0 + 0.9, send: 0 };
}

/**
 * Heartbeat + laboured breathing for low health. Returned so the caller can
 * schedule it repeatedly rather than looping a node.
 */
export function heartbeat(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.5); // VOICE TRIM
  for (let i = 0; i < 2; i++) {
    const bt = t0 + i * 0.19;
    const b = osc(actx, 'sine', 58);
    const g = gain(actx, 0);
    b.connect(g); g.connect(out);
    sweep(b.frequency, bt, 72, 42, 0.1);
    ad(g.gain, bt, (i === 0 ? 0.5 : 0.33) * lvl, 0.008, 0.11);
    b.start(bt); b.stop(bt + 0.3);
  }
  return { node: out, end: t0 + 0.6, send: 0.1 };
}
