import { Assembly } from '../geometry.js';
import { buildMagazine, triggerPart } from '../parts.js';
import { PARTS, BOUNDS, SOURCE } from './g31.data.js';
import { requireBaked } from './baked.js';

/**
 * The G31 — a compensated competition 9 mm with a slide-mounted red dot.
 *
 * The first weapon in this project whose geometry is IMPORTED rather than
 * authored: the shell comes from a downloaded model baked to source by
 * `tools/glb-bake.mjs` (see `.claude/skills/glb-weapon/`), and everything the
 * mesh does not contain is generated here in code as usual.
 *
 *   source   "Low-Poly G31 Competition" by Kaan, CC-BY-4.0 — see
 *            public/models/CREDITS.md. The credit ships; the .glb does not.
 *   geometry 5,171 triangles, 18 parts, 13 glTF materials mapped to 6 engine
 *            keys by g31.materials.json.
 *
 * PLACEMENT. The bake is authored with `--rot=0,90,0 --origin=0,0.303,0.0316`,
 * which does three things: turns the model's +X muzzle onto the engine's -Z,
 * puts the bore axis at y = 0.036 (the same height as the P-19 it replaces),
 * and lands the slide rear at z = 0.052 — again the P-19's. That last one is
 * not cosmetic: it is what lets the hand targets below start from the P-19's
 * solved values instead of being re-derived from nothing.
 *
 * WHAT THE MODEL DOES NOT HAVE. There is no magazine in the source — the grip
 * and magwell are one solid frame part, and nothing sits below y = -0.105. A
 * reload needs a magazine to drop, so it is built with `buildMagazine` exactly
 * as the other sidearm does. The trigger and slide DO exist as separate parts
 * and are split out below; without that split neither could animate.
 */

/** Bore axis height. Set by the bake's --origin; every node hangs off it. */
const BORE = 0.036;
/** Slide rear face, from the baked bounds of the slide selection. */
const Z_SLIDE_REAR = 0.052;
/** Forwardmost point on the bore axis — the compensator's crown. */
const Z_MUZZLE = -0.1849;

/**
 * Parts that recoil with the slide.
 *
 * The red dot is SLIDE-MOUNTED on this gun (the optic sits at y 0.055-0.081,
 * directly on the slide's 0.058 top face), so `RMR_0` and its mount plate
 * `RMR CUT_2` travel with it. Leaving them on the frame would pin the sight in
 * the air while the slide cycled underneath — which reads as the optic
 * detaching, and is invisible in a still frame.
 *
 * The compensator goes with the slide too: it is barrel-mounted, and barrel and
 * slide recoil together over the first 22 mm, which is the whole of our travel.
 */
const SLIDE_PARTS = /^(Object_1[2-9])$|RMR/;
const TRIGGER_PART = 'Object_20';

export function buildG31() {
  const body = new Assembly('g31-frame');

  /* ---- frame, grip and controls --------------------------------------- */
  // Everything that is not the slide group or the trigger blade. Authored as an
  // exclusion so a part added by a future re-bake lands on the frame — visible
  // and wrong — rather than silently vanishing.
  requireBaked(body, PARTS, BOUNDS, {
    exclude: (p) => SLIDE_PARTS.test(p.node) || SLIDE_PARTS.test(p.group) || p.node === TRIGGER_PART,
  });

  /* ---- slide + optic --------------------------------------------------- */
  /**
   * The assembly's own origin must sit on the slide's travel axis, because the
   * viewmodel positions it at `slideRest.pos` and slides it along
   * `slideTravel`. The baked geometry is in weapon space, so it comes down by
   * the bore height and goes back up in `slideRest`.
   */
  const slide = new Assembly('g31-slide');
  requireBaked(slide, PARTS, BOUNDS, {
    include: (p) => SLIDE_PARTS.test(p.node) || SLIDE_PARTS.test(p.group),
    offset: { y: -BORE },
  });

  /* ---- magazine (generated — the source model has none) ---------------- */
  const magazine = new Assembly('g31-mag');
  const mag = buildMagazine(magazine, null, {
    // Sized to the baked grip: 22 mm across the panels, 75 mm front to back.
    w: 0.0186,
    d: 0.0272,
    len: 0.104,
    curve: 0.003,
    segs: 5,
    witness: 3,
    caseLen: 0.0192,
    rimR: 0.00478,
    bulletLen: 0.0132,
    poly: 'polymer',
  });

  /* ---- trigger --------------------------------------------------------- */
  /**
   * The imported blade is 24 triangles and 2 mm thick — enough of a silhouette
   * to keep, but it has no trigger face to speak of, so the generated
   * `triggerPart` shoe rides with it. Both are authored about the pivot at the
   * blade's top-rear corner, which is where a trigger actually hinges.
   */
  const trigger = new Assembly('g31-trigger');
  requireBaked(trigger, PARTS, BOUNDS, {
    include: TRIGGER_PART,
    mat: 'steel_bright',
    offset: { y: -0.0131, z: 0.0198 },
  });
  const trg = triggerPart('polymer');
  trigger.add(trg.geo, 'polymer', { z: 0.0008 });
  trg.geo.dispose();

  /* ---- optic window ---------------------------------------------------- */
  /**
   * The lens is `RMR_0/Object_7`, a 14-triangle panel at
   * x +/-0.0117, y 0.0595..0.0775, z -0.0075..-0.0046. The optic descriptor is
   * derived from that box rather than from `buildMiniReflex`, which is the
   * generated path the P-19 uses — the geometry is already here, only the
   * numbers the ADS solve needs are missing.
   */
  const glassW = 0.0234;
  const glassH = 0.018;
  const optic = {
    center: [0, 0.0685, -0.006],
    lensZ: -0.006,
    apertureR: Math.min(glassW, glassH) * 0.46,
    windowW: glassW * 0.46,
    windowH: glassH * 0.46,
    tilt: 0.16,
  };

  return {
    id: 'g31',
    label: 'G31',
    fxClass: 'pistol',
    body,
    moving: { magazine, trigger, slide },
    nodes: {
      muzzle: [0, BORE, Z_MUZZLE],
      chamber: [0, BORE, Z_SLIDE_REAR - 0.05],
      // Port on the right flank of the slide, which is 32 mm across.
      eject: [0.0196, BORE + 0.005, Z_SLIDE_REAR - 0.05],
      ejectDir: [0.82, 0.52, 0.24],
      sight: optic.center,
      sightAxis: [0, 0, -1],
      // Backup irons: the top of the rear sight block, Object_16.
      ironSight: [0, 0.0424, 0.0095],
      /**
       * Wrist targets, NOT palms — the glove runs from the wrist forward with
       * the knuckle line 98 mm along its -Z, so each is
       * `knuckle - 0.098 * finger` (the derivation is in models/rifle.js).
       *
       * These start from the P-19's solved pair, which is legitimate only
       * because the bake deliberately put this grip in the same place: bore at
       * y 0.036 and slide rear at z 0.052 on both guns. The G31's grip is 4 mm
       * deeper front-to-back, so both wrists come back 4 mm to sit on the
       * backstrap rather than inside it.
       */
      gripR: {
        pos: [0.028, 0.003, 0.074],
        finger: [0, -0.315, -0.949],
        back: [0.98, 0, -0.2],
      },
      /** Support hand cups the firing hand rather than the frame. */
      gripL: {
        pos: [-0.03, -0.012, 0.08],
        finger: [0.34, -0.28, -0.9],
        back: [0.15, 0.93, -0.33],
      },
      /**
       * Magwell axis, MEASURED off the baked grip rather than guessed.
       *
       * Sampling the grip part's z-centre by height gives -0.012 at the top of
       * the well and +0.039 at the floorplate, over 80 mm of drop: a 0.55 rad
       * rake, much steeper than the P-19's 0.32. The first pass inherited the
       * P-19's numbers and sat 30 mm forward of the well at half the angle.
       *
       * UNVERIFIED IN A RENDER. A seated magazine is entirely inside the grip,
       * so no static view can show it, and `?view=reload` samples the clip at
       * t=0 before the magazine has moved. These numbers are derived from the
       * geometry and are better than what they replaced, but the proof needs a
       * capture partway through the reload clip. Do not treat them as checked.
       */
      magSeat: { pos: [0, 0.006, -0.01], rot: [-0.55, 0, 0] },
      magDrop: [0, -0.42, 0.05],
      slideRest: { pos: [0, BORE, 0], rot: [0, 0, 0] },
      // 22.5 mm of travel, the same stroke as the P-19.
      slideTravel: [0, 0, 0.0225],
      triggerPivot: { pos: [0, 0.0131, -0.0198], rot: [0, 0, 0] },
      triggerPull: -0.3,
      opticGlass: optic,
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
    source: SOURCE,
  };
}
