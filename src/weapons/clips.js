import { smootherstep, easeOutBack, easeOutCubic, clamp01, lerp } from './mathx.js';

/**
 * Procedural animation clips (reload, inspect, draw, holster).
 *
 * These are *authored keyframes*, not baked animation data: every key is
 * expressed relative to the weapon's own attachment nodes, so the same timeline
 * drives a carbine, an SMG and a pistol with correct hand positions, and the
 * timing scales with the weapon's reload speed.
 *
 * Channels
 *   weapon : additive pose offset for the whole viewmodel  { p:[x,y,z], r:[rx,ry,rz] }
 *   lhand  : support-hand target in WEAPON space           { p, finger, back, pose }
 *   rhand  : shooting-hand additive offset (thumb work)    { p }
 *   parts  : moving-part drive                             { mag, magHand, charge, bolt, slide, trigger }
 *   events : named beats the weapon system reacts to       { t, name }
 *
 * A key may carry `ease`: 'smooth' (default), 'linear', 'out', 'back'.
 */

const EASE = {
  linear: (t) => t,
  smooth: (t) => smootherstep(0, 1, t),
  out: (t) => easeOutCubic(t),
  back: (t) => easeOutBack(t, 1.4),
};

function sampleTrack(keys, t, out, blend) {
  if (!keys || !keys.length) return false;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  let w = 0;
  if (b !== a) {
    const span = b.t - a.t;
    w = span > 1e-6 ? clamp01((t - a.t) / span) : 1;
    w = (EASE[b.ease] ?? EASE.smooth)(w);
  }
  blend(a, b, w, out);
  return true;
}

export class Clip {
  constructor(name, duration, channels) {
    this.name = name;
    this.duration = duration;
    this.weapon = channels.weapon ?? null;
    this.lhand = channels.lhand ?? null;
    this.rhand = channels.rhand ?? null;
    this.parts = channels.parts ?? null;
    this.events = channels.events ?? [];
  }

  /** Sample into a preallocated result object. */
  sample(t, out) {
    out.active = true;
    // ---- weapon additive pose ----
    if (this.weapon) {
      sampleTrack(this.weapon, t, out, (a, b, w, o) => {
        for (let k = 0; k < 3; k++) {
          o.pos[k] = lerp(a.p?.[k] ?? 0, b.p?.[k] ?? 0, w);
          o.rot[k] = lerp(a.r?.[k] ?? 0, b.r?.[k] ?? 0, w);
        }
      });
    } else {
      out.pos[0] = out.pos[1] = out.pos[2] = 0;
      out.rot[0] = out.rot[1] = out.rot[2] = 0;
    }

    // ---- support hand ----
    if (this.lhand) {
      sampleTrack(this.lhand, t, out, (a, b, w, o) => {
        for (let k = 0; k < 3; k++) {
          o.lhand.pos[k] = lerp(a.p[k], b.p[k], w);
          o.lhand.finger[k] = lerp(a.finger?.[k] ?? 0, b.finger?.[k] ?? 0, w);
          o.lhand.back[k] = lerp(a.back?.[k] ?? 0, b.back?.[k] ?? 0, w);
        }
        o.lhand.pose = w < 0.5 ? a.pose ?? 'wrap' : b.pose ?? 'wrap';
        o.lhand.weight = lerp(a.weight ?? 1, b.weight ?? 1, w);
      });
    } else {
      out.lhand.weight = 0;
    }

    // ---- moving parts ----
    if (this.parts) {
      sampleTrack(this.parts, t, out, (a, b, w, o) => {
        o.parts.mag = lerp(a.mag ?? 0, b.mag ?? 0, w);
        o.parts.magVisible = (b.magVisible ?? a.magVisible ?? 1) > 0.5 || w < 0.5;
        o.parts.charge = lerp(a.charge ?? 0, b.charge ?? 0, w);
        o.parts.bolt = lerp(a.bolt ?? 0, b.bolt ?? 0, w);
        o.parts.slide = lerp(a.slide ?? 0, b.slide ?? 0, w);
      });
    }
    return out;
  }
}

export function makeSampleResult() {
  return {
    active: false,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    lhand: { pos: [0, 0, 0], finger: [0, 0, 0], back: [0, 0, 0], pose: 'wrap', weight: 0 },
    parts: { mag: 0, magVisible: true, charge: 0, bolt: 0, slide: 0 },
  };
}

/* ========================================================================== */
/*  clip construction                                                         */
/* ========================================================================== */

const v3 = (x, y, z) => [x, y, z];

/**
 * Build every clip for one weapon from its attachment nodes.
 * `scale` compresses or stretches the whole timeline (weapon reload speed).
 */
export function buildClips(nodes, def) {
  const grip = nodes.gripL;
  const seat = nodes.magSeat.pos;
  const magLen = def.magLen ?? 0.2;
  // Support-hand orientation while it is holding the weapon vs. a magazine.
  const wrapFinger = grip.finger ?? v3(0.82, 0.5, -0.28);
  const wrapBack = grip.back ?? v3(-0.5, 0.32, -0.8);
  const magFinger = v3(0.1, 0.72, -0.68);
  const magBack = v3(-0.86, 0.34, -0.38);
  const hgP = grip.pos;

  // Points the support hand visits, all in weapon space.
  const atMag = v3(seat[0] + 0.012, seat[1] - magLen * 0.62, seat[2] + 0.012);
  const belowGun = v3(seat[0] + 0.05, seat[1] - magLen * 1.5, seat[2] + 0.09);
  const offFrame = v3(seat[0] + 0.11, seat[1] - magLen * 2.0, seat[2] + 0.16);
  const magHigh = v3(seat[0] + 0.006, seat[1] - magLen * 0.78, seat[2] + 0.008);
  const seated = v3(seat[0], seat[1] - magLen * 0.62, seat[2]);
  const charge = nodes.chargeRest
    ? v3(nodes.chargeRest.pos[0] - 0.02, nodes.chargeRest.pos[1] + 0.008, nodes.chargeRest.pos[2] + 0.03)
    : null;
  const boltAction = def.boltAction === true;

  const tac = def.reloadTac ?? 2.15;
  const emp = def.reloadEmpty ?? 2.85;

  /* ---------------------------------------------------------------- tactical */
  const reloadTac = new Clip('reloadTac', tac, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.12 * tac, p: v3(0.014, -0.026, 0.03), r: v3(-0.14, 0.3, 0.42) },
      { t: 0.5 * tac, p: v3(0.016, -0.03, 0.026), r: v3(-0.1, 0.34, 0.5) },
      { t: 0.72 * tac, p: v3(0.012, -0.022, 0.022), r: v3(-0.12, 0.26, 0.44) },
      { t: 0.78 * tac, p: v3(0.008, -0.008, 0.014), r: v3(-0.05, 0.18, 0.3), ease: 'back' },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0) },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 0.1 * tac, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.2 * tac, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.3 * tac, p: belowGun, finger: magFinger, back: magBack, pose: 'pinch', ease: 'out' },
      { t: 0.42 * tac, p: offFrame, finger: magFinger, back: magBack, pose: 'open' },
      { t: 0.56 * tac, p: offFrame, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.68 * tac, p: belowGun, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.76 * tac, p: magHigh, finger: magFinger, back: magBack, pose: 'pinch', ease: 'out' },
      { t: 0.8 * tac, p: seated, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.86 * tac, p: v3(seated[0], seated[1] - 0.012, seated[2]), finger: magFinger, back: magBack, pose: 'open' },
      { t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
    ],
    parts: [
      { t: 0, mag: 0, magVisible: 1 },
      { t: 0.16 * tac, mag: 0, magVisible: 1 },
      { t: 0.2 * tac, mag: 1, magVisible: 1 },
      { t: 0.3 * tac, mag: 1, magVisible: 1, ease: 'linear' },
      { t: 0.34 * tac, mag: 1, magVisible: 0 },
      { t: 0.66 * tac, mag: 1, magVisible: 0 },
      { t: 0.68 * tac, mag: 1, magVisible: 1 },
      { t: 0.79 * tac, mag: 1, magVisible: 1, ease: 'out' },
      { t: 0.81 * tac, mag: 0, magVisible: 1 },
      { t: 1, mag: 0, magVisible: 1 },
    ],
    events: [
      { t: 0.02 * tac, name: 'start' },
      { t: 0.2 * tac, name: 'magout' },
      { t: 0.34 * tac, name: 'magdrop' },
      { t: 0.81 * tac, name: 'magin' },
      { t: 0.88 * tac, name: 'slap' },
      { t: 0.995 * tac, name: 'end' },
    ],
  });

  /* ------------------------------------------------------------------ empty */
  const emptyLhand = [
    { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
    { t: 0.08 * emp, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.16 * emp, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.26 * emp, p: belowGun, finger: magFinger, back: magBack, pose: 'open', ease: 'out' },
    { t: 0.36 * emp, p: offFrame, finger: magFinger, back: magBack, pose: 'open' },
    { t: 0.48 * emp, p: offFrame, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.58 * emp, p: belowGun, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.66 * emp, p: magHigh, finger: magFinger, back: magBack, pose: 'pinch', ease: 'out' },
    { t: 0.7 * emp, p: seated, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.75 * emp, p: v3(seated[0], seated[1] - 0.01, seated[2]), finger: magFinger, back: magBack, pose: 'open' },
  ];
  if (boltAction) {
    /**
     * THE BOLT IS THROWN BY THE SHOOTING HAND, so no hand track runs it.
     *
     * The clip system can move the weapon, the support hand and the moving
     * parts, but the shooting hand is welded to the grip (`rhand` is a thumb
     * offset, not an IK target). A bolt handle lives on the RIGHT flank, which
     * is exactly where the support hand cannot reach without crossing the
     * receiver — so animating it with the support hand, as the pistol's slide
     * rack below does, would be visibly wrong on the one weapon whose action is
     * its signature.
     *
     * What sells it instead is the WEAPON: it rolls 0.75 rad to present the
     * right flank to the camera and comes back off the shoulder, while the bolt
     * part itself travels its full 78 mm (the `bolt` channel in `emptyParts`).
     * The hand that is visible stays where a hand belongs, on the forend.
     */
    emptyLhand.push(
      { t: 0.82 * emp, p: v3(hgP[0] + 0.006, hgP[1] - 0.004, hgP[2] + 0.012), finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
      { t: 0.93 * emp, p: v3(hgP[0] + 0.004, hgP[1] - 0.002, hgP[2] + 0.006), finger: wrapFinger, back: wrapBack, pose: 'wrap' }
    );
  } else if (charge) {
    emptyLhand.push(
      { t: 0.82 * emp, p: v3(charge[0], charge[1], charge[2] - 0.01), finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'pinch', ease: 'out' },
      { t: 0.87 * emp, p: charge, finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'pinch' },
      { t: 0.9 * emp, p: v3(charge[0], charge[1], charge[2] + 0.07), finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'pinch', ease: 'linear' },
      { t: 0.93 * emp, p: v3(charge[0], charge[1], charge[2] + 0.02), finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'open', ease: 'out' }
    );
  } else {
    // Pistol: the support hand racks the slide from above.
    emptyLhand.push(
      { t: 0.82 * emp, p: v3(-0.02, seat[1] + 0.06, seat[2] - 0.05), finger: v3(0.7, -0.3, 0.65), back: v3(0.1, 0.94, 0.32), pose: 'pinch', ease: 'out' },
      { t: 0.88 * emp, p: v3(-0.02, seat[1] + 0.06, seat[2] - 0.02), finger: v3(0.7, -0.3, 0.65), back: v3(0.1, 0.94, 0.32), pose: 'pinch', ease: 'linear' },
      { t: 0.92 * emp, p: v3(-0.02, seat[1] + 0.06, seat[2] - 0.06), finger: v3(0.7, -0.3, 0.65), back: v3(0.1, 0.94, 0.32), pose: 'open', ease: 'out' }
    );
  }
  emptyLhand.push({ t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' });

  const emptyParts = [
    { t: 0, mag: 0, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.12 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.16 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.26 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1, ease: 'linear' },
    { t: 0.3 * emp, mag: 1, magVisible: 0, bolt: 1, slide: 1 },
    { t: 0.56 * emp, mag: 1, magVisible: 0, bolt: 1, slide: 1 },
    { t: 0.58 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.69 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1, ease: 'out' },
    { t: 0.71 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.86 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1, charge: 0 },
    { t: 0.9 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1, charge: 1, ease: 'linear' },
    { t: 0.915 * emp, mag: 0, magVisible: 1, bolt: 0, slide: 0, charge: 0, ease: 'back' },
    { t: 1, mag: 0, magVisible: 1, bolt: 0, slide: 0, charge: 0 },
  ];

  // Tail of the weapon track after the magazine seats: the charging stroke for a
  // self-loader, and a much bigger roll-and-drop for a bolt gun (see above).
  const emptyWeaponTail = boltAction
    ? [
      { t: 0.78 * emp, p: v3(0.014, -0.026, 0.03), r: v3(0.02, 0.3, 0.62), ease: 'out' },
      { t: 0.88 * emp, p: v3(0.018, -0.032, 0.046), r: v3(0.06, 0.34, 0.75), ease: 'linear' },
      { t: 0.94 * emp, p: v3(0.012, -0.022, 0.026), r: v3(0.03, 0.28, 0.58), ease: 'out' },
    ]
    : [
      { t: 0.86 * emp, p: v3(0.006, -0.012, 0.016), r: v3(-0.02, 0.42, 0.22) },
      { t: 0.92 * emp, p: v3(0.004, -0.006, 0.022), r: v3(0.02, 0.44, 0.18), ease: 'linear' },
    ];

  const reloadEmpty = new Clip('reloadEmpty', emp, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.1 * emp, p: v3(0.016, -0.03, 0.032), r: v3(-0.16, 0.34, 0.46) },
      { t: 0.44 * emp, p: v3(0.018, -0.034, 0.028), r: v3(-0.12, 0.38, 0.54) },
      { t: 0.7 * emp, p: v3(0.014, -0.026, 0.024), r: v3(-0.14, 0.3, 0.48) },
      { t: 0.72 * emp, p: v3(0.01, -0.014, 0.018), r: v3(-0.06, 0.24, 0.38), ease: 'back' },
      ...emptyWeaponTail,
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: emptyLhand,
    parts: emptyParts,
    events: [
      { t: 0.02 * emp, name: 'start' },
      { t: 0.16 * emp, name: 'magout' },
      { t: 0.3 * emp, name: 'magdrop' },
      { t: 0.71 * emp, name: 'magin' },
      { t: 0.9 * emp, name: 'charge' },
      { t: 0.917 * emp, name: 'boltrelease' },
      { t: 0.995 * emp, name: 'end' },
    ],
  });

  /* ----------------------------------------------------------------- inspect */
  const insp = def.inspectTime ?? 3.0;
  const inspect = new Clip('inspect', insp, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.16 * insp, p: v3(-0.03, -0.012, 0.075), r: v3(0.1, -0.62, -0.34) },
      { t: 0.34 * insp, p: v3(-0.026, -0.006, 0.085), r: v3(-0.05, -0.78, -0.5) },
      { t: 0.52 * insp, p: v3(0.01, -0.02, 0.07), r: v3(0.22, 0.5, 0.9) },
      { t: 0.7 * insp, p: v3(0.012, -0.024, 0.055), r: v3(0.3, 0.62, 1.15) },
      { t: 0.86 * insp, p: v3(-0.006, -0.01, 0.03), r: v3(0.06, -0.18, 0.2) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 0.3 * insp, p: v3(hgP[0] - 0.01, hgP[1] - 0.01, hgP[2] + 0.03), finger: wrapFinger, back: wrapBack, pose: 'clamp' },
      { t: 0.55 * insp, p: v3(hgP[0] + 0.01, hgP[1] - 0.02, hgP[2] - 0.02), finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
    ],
    parts: [
      { t: 0, mag: 0, magVisible: 1 },
      { t: 1, mag: 0, magVisible: 1 },
    ],
    events: [{ t: 0.995 * insp, name: 'end' }],
  });

  /* -------------------------------------------------------------- draw/holster */
  const drawT = def.drawTime ?? 0.62;
  const draw = new Clip('draw', drawT, {
    weapon: [
      { t: 0, p: v3(0.05, -0.3, 0.14), r: v3(-0.85, 0.5, 0.55) },
      { t: 0.55 * drawT, p: v3(0.01, -0.03, 0.02), r: v3(-0.1, 0.06, 0.06), ease: 'out' },
      { t: 0.78 * drawT, p: v3(-0.004, 0.008, -0.006), r: v3(0.04, -0.02, -0.02) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: v3(hgP[0] - 0.02, hgP[1] - 0.09, hgP[2] + 0.06), finger: wrapFinger, back: wrapBack, pose: 'open' },
      { t: 0.6 * drawT, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
      { t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
    ],
    parts: [{ t: 0, mag: 0, magVisible: 1 }],
    events: [{ t: 0.995 * drawT, name: 'end' }],
  });

  const holT = def.holsterTime ?? 0.4;
  const holster = new Clip('holster', holT, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.25 * holT, p: v3(0.004, 0.014, -0.01), r: v3(0.08, -0.04, -0.05) },
      { t: 1, p: v3(0.05, -0.32, 0.15), r: v3(-0.9, 0.55, 0.6), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 1, p: v3(hgP[0] - 0.02, hgP[1] - 0.1, hgP[2] + 0.07), finger: wrapFinger, back: wrapBack, pose: 'open', ease: 'out' },
    ],
    parts: [{ t: 0, mag: 0, magVisible: 1 }],
    events: [{ t: 0.995 * holT, name: 'end' }],
  });

  return { reloadTac, reloadEmpty, inspect, draw, holster };
}
