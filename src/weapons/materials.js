import * as THREE from 'three';

/**
 * The weapon material set.
 *
 * Everything comes out of `ctx.get('materials')` — the shared procedural PBR
 * library — re-tuned for hand-held scale. Three things matter at 0.4 m from the
 * eye and are what these overrides are for:
 *
 *  1. TEXEL DENSITY. The library bakes surfaces for architecture (a 2.5 m
 *     tile). A weapon needs a 0.10-0.15 m tile plus a detail layer at ~8 mm, or
 *     the receiver reads as smooth plastic. `detail[3]` (the fade distance) is
 *     pulled in to 3-6 m so the micro layer is at full strength in the hand.
 *  2. OBJECT-SPACE PROJECTION. `localSpace + triplanar` means the texture is
 *     nailed to the mesh, so nothing swims while the viewmodel animates, and no
 *     UV unwrap is needed for procedurally merged geometry.
 *  3. EDGE WEAR. Every weapon geometry gets curvature vertex masks baked
 *     (see materials.bakeMasks), and these materials turn that mask into bare
 *     bright metal on the chamfers of high-contact parts — the single most
 *     important cue that a gun has been used.
 *
 * World-space weathering (rain streaks, ground splash) is switched off: it is
 * driven by world Y, which is meaningless for something parented to the camera.
 * Cavity grime (weather.w) is height-driven and stays on.
 */

/** Shared base for every weapon surface. */
const BASE = {
  uvMode: 'triplanar',
  localSpace: true,
  vertexMasks: true,
  /**
   * No dust / rain streak / ground splash: all three are driven by world Y, which
   * is meaningless for something parented to the camera.
   *
   * Cavity grime (weather.w) is the exception and it is now the single most
   * valuable texture layer on the gun. It is driven by the surface's OWN height
   * channel in object space (see shader.js: `cav = 1 - owHeightS`), so it cannot
   * swim, and it both darkens the valleys of the moulding stipple / anodising
   * grain and adds AO to them. 0.4 -> 0.62: with the exposure recalibration below
   * making the gun diffuse-dominant, this is what turns a smooth dark panel into a
   * surface with grime living in its pores.
   */
  weather: [0, 0, 0, 0.62],
  // low amplitude, because the macro layer is the one thing sampled in world
  // space and would otherwise crawl across the gun as the player moves
  macro: [0.55, 0.05, 0.07, 0.06],
  aoStrength: 1,
};

const c = (r, g, b) => new THREE.Color(r, g, b);

/**
 * How much of the sky hemisphere a shouldered weapon actually sees. Applied to
 * every weapon/hand material's envMapIntensity — see WeaponMaterials.get() —
 * AND to `viewScene.environmentIntensity` in index.js, which is the one that
 * actually bites: three ignores `material.envMapIntensity` for a material lit by
 * `scene.environment` alone.
 */
export const ENV_OCCLUSION = 0.24;

/**
 * key -> [libraryName, opts]
 * Ordered roughly from receiver outward so the log reads like a parts list.
 */
export const WEAPON_MATERIALS = {
  /**
   * Hard-anodised aluminium — upper/lower receiver, rails, handguard.
   *
   * Anodising is an oxide *coating*, not bare metal: a matte near-black
   * dielectric that chips back to bright aluminium on the corners. Using a
   * brushed-metal surface here reads as polished chrome, which is the single
   * biggest mistake available on a gun.
   */
  alu: [
    // NOT metal_painted: that surface is authored for industrial painted steel
    // and layers rust bloom, rain streaks and bright bare-metal scratches over
    // everything, which on a 0.2 m receiver reads as a weathered dumpster.
    // Type-III hard-coat anodising is a matte black *dielectric* oxide with a
    // fine sub-millimetre grain, so the rubber surface is the honest base; the
    // bare-aluminium wear comes from the vertex edge mask below, which is
    // exactly where it belongs (corners, charging-handle path, magwell mouth).
    'rubber',
    {
      ...BASE,
      bake: { size: 1024, seed: 601, relief: 0.005 },
      scale: 0.095,
      /**
       * MATERIAL CLASS 1 of 3 — hard-anodised aluminium.
       *
       * `tint` multiplies the surface's own baked albedo, which for the `rubber`
       * surface measures 0.0334 linear (read back off the GPU, not guessed), so
       * this is NOT the linear albedo. It is deliberately COOL, because the other
       * two classes are a WARM polymer (class 2) and a metal with no albedo at all
       * (class 3, only an F0) — hue is the only separation cue that survives a
       * part being 40 px wide in hipfire framing.
       *
       * ===================================================================
       * THE VIEWMODEL EXPOSURE RECALIBRATION — read this before touching any
       * albedo in this file.
       * ===================================================================
       *
       * Every previous pass fought the same symptom ("the rail is a bright comb",
       * "the mount is beige MDF", "the optic bezel is unpainted") by driving
       * albedos DOWN and leaving the specular alone. This one measured what was
       * actually on screen and it is the opposite problem.
       *
       * MEASUREMENT (live uniform sweep on the `weapon` shot, reading the
       * framebuffer back — see the report). With every specular path on the
       * viewmodel switched off, so the numbers below are pure diffuse:
       *
       *            base albedo   diffuse-only   with spec (shipped)
       *   rail          0.0033        L=106            L=192
       *   receiver      0.0033        L= 26            L= 67
       *   handguard     0.0027        L= 32            L=101
       *   magazine      0.0027        L= 26            L= 62
       *
       * The receiver's diffuse term was 26 and its shipped value was 67: SIXTY
       * PERCENT of what the eye saw on the gun was Fresnel. That is the whole
       * explanation for "an untextured greybox where receiver, handguard, barrel,
       * rail and magazine share one flat blue-grey albedo": they were not sharing
       * an albedo, they were all showing the SAME F0. A dielectric's specular
       * lobe has no material identity in it — no stipple, no anodising grain, no
       * phosphate, no colour — so no amount of texturing could ever have shown up.
       *
       * Two coupled moves, and neither works alone:
       *   1. specularIntensity 0.5 -> 0.11. Type-III hard-coat oxide really is a
       *      rough conversion coating around 0.02 reflectance, so this is the
       *      honest number and it was always half-applied here.
       *   2. albedo x3. 0.098 -> 0.285 puts the anodising at ~0.0095 linear.
       *      Still a third of physical (a real oxide is 0.026-0.032) because the
       *      viewmodel rig delivers far more irradiance per unit albedo than the
       *      world does, but now it is DIFFUSE-dominant, which is the only regime
       *      in which the detail layer, the wear mask, the grime and the hue
       *      separation from the polymer can be seen at all.
       *
       * The hue is unchanged: 0.285/0.302/0.349 is the same cool blue-grey ratio.
       */
      tint: c(0.285, 0.302, 0.349),
      /**
       * `roughness` is [scale, offset, minimum] against the surface's own ORM
       * green channel (see materials/shader.js), so raising the scale raises the
       * whole range. 0.66/0.09 with a hard 0.24 floor lands the anodising at
       * 0.31-0.53 — matte, but with enough range left that the detail layer's
       * roughness modulation is visible as a grain.
       */
      roughness: [0.66, 0.09, 0.24],
      three: { physical: true, specularIntensity: 0.11 },
      /**
       * normalStrength 0.5 -> 1.05 and the detail layer's amplitudes roughly
       * tripled. Both were tuned when the surface was specular-dominated, where a
       * normal perturbation only shifts the lobe around and an albedo perturbation
       * does nothing at all; the sensible response then was to keep them tiny so
       * they did not make the Fresnel sheet boil. With diffuse in charge they are
       * the texture, and a 1.5 mm anodising grain at 0.14 albedo amplitude is
       * invisible.
       *
       * detail = [tiles-per-base-tile, normalAmp, albedoAmp, fadeMetres]. 20 tiles
       * over a 95 mm base tile is a 4.75 mm cell; the fade stays at 5 m so it is
       * at full strength everywhere the gun ever is.
       */
      normalStrength: 1.5,
      detail: [22, 1.2, 0.72, 5],
      /**
       * The vertex edge mask bleeds across chamfered panels (they have no interior
       * vertices), so the amplitude stays LOW and the exponent applied in
       * viewmodel.js keeps it on the outer millimetre.
       *
       * The wear layer is a MIX toward wearColor, so its screen contrast depends on
       * the ratio wearColor/albedo — and albedo just went up 3x, which cuts that
       * ratio from 23:1 to 7.6:1. So the amplitude can come back UP (0.12 -> 0.26)
       * and finally do what it is for: bare bright alloy on the charging-handle
       * path, the magwell mouth and the rail crowns, at a contrast that reads as
       * polished metal rather than as a white comb.
       */
      wear: [0.2, 0.6, 0.5, 0],
      /**
       * MEASURED, and this is the fix for "bright cream blocky bits" — the pale
       * boxes scattered over the receiver flank that read as unpainted plastic.
       *
       * They are the edge-wear layer. The vertex mask marks convex geometry, and on
       * a SMALL part (a bolt-catch boss, a takedown pin head, a mag-release fence)
       * every vertex is convex, so the whole part gets painted with wearColor. At
       * 0x585c63 that is 0.107 linear — ELEVEN times the anodising's 0.0095 — and
       * `wearMaterial` was also flipping it to metalness 1 at roughness 0.30, i.e.
       * a polished mirror. The result was a dotted white outline round every small
       * boss, exactly as if the vertices had been highlighted, which is what it was.
       *
       * Bare aluminium really is ~30x the albedo of black anodising, but it is a
       * METAL, and a rubbed edge on a real rifle is a hairline. 0x3c4046 is 0.037
       * linear, ~3.9x the oxide, which reads as polished alloy without leaving the
       * exposure band; roughness 0.30 -> 0.54 and metalness 1.0 -> 0.8 take the
       * mirror out of it.
       */
      wearColor: 0x34383d,
      wearMaterial: [0.54, 0.8, 0, 0.8],
      grimeColor: 0x0b0a08,
    },
  ],

  /**
   * The same anodising, but with the grain pulled in to ~0.5 mm.
   *
   * In ADS the optic body is 145 mm from the eye — three times closer than the
   * receiver ever gets — so the 1.5 mm stipple that reads as a fine machined
   * finish on the receiver reads as cast concrete on the sight. Anything the
   * player presses their eye against gets this.
   */
  alu_fine: [
    'rubber',
    {
      ...BASE,
      bake: { size: 1024, seed: 733, relief: 0.0025 },
      scale: 0.038,
      // Same alloy and the same anodising bath as `alu`, one step darker and one
      // step smoother because an optic body is bead-blasted before it is coated.
      // It must stay inside the aluminium family: the class break on this gun is
      // alu / polymer / phosphate, not receiver / sight.
      // x3 with `alu` — see the recalibration note there. ~0.0089 linear, one step
      // darker than the receiver because an optic body is bead-blasted before it
      // is coated.
      // x2.2 rather than the receiver's x3: in ADS the optic body is 110 mm from
       // the eye and its top deck faces the key square on, so it was measuring
       // L=130 against a receiver at 62 — a black sight reading as grey plastic.
       // MEASURED IN ADS: at x2.2 the optic body area-averaged L=97 against a sunlit
       // world wall at 169 — a black sight reading as mid-grey plastic. x1.45
       // (0.135) lands it at ~70 with its chamfers still reaching 180+, which is
       // what a Type-III anodised housing looks like with a key on it.
       tint: c(0.135, 0.144, 0.165),
      // Same 0.22 floor as `alu`: this material carries the optic body, and the
      // bezel around the objective is exactly where a smooth facet turns into a
      // cream grazing ring in ADS.
      roughness: [0.56, 0.07, 0.26],
      // In ADS the optic body is 110 mm from the eye, three times closer than the
      // receiver ever gets, so this is the one surface on the gun whose micro
      // relief is genuinely resolvable. 0.3 -> 0.8, detail albedo 0.1 -> 0.34.
      normalStrength: 1.15,
      detail: [30, 0.85, 0.6, 4],
      wear: [0.18, 0.5, 0.5, 0],
      // Same argument as `alu`: the turret caps, the clamp rings and the mount are
      // all small convex parts whose every vertex reads as an edge.
      wearColor: 0x40444a,
      wearMaterial: [0.5, 0.8, 0, 0.75],
      grimeColor: 0x0b0a08,
      /**
       * In ADS the eye looks straight down the tube, so every ray just outside the
       * exit pupil grazes the tube's own flank. MeshStandardMaterial hard-codes
       * specularF90 = 1.0, so at grazing incidence a matte black oxide reflects the
       * sky like polished chrome — a 2.5 mm bright warm band right around the sight
       * picture, which is the single most-complained-about pixel on this weapon.
       * A type-III oxide is a rough conversion coating, not a polished dielectric;
       * specularIntensity 0.16 is what that costs it, and it needs the physical
       * material to expose the parameter.
       *
       * 0.45 was still leaving a measurable cream ring on the objective bezel and
       * the front lip of the hood — the brightest thing in the whole ADS frame
       * and the reason the objective read as a grey gradient disc with a rim of
       * unpainted MDF. 0.28 is the same order as a real anodised flank's
       * reflectance and it takes the ring out without dulling the chamfers,
       * which are lit by the key, not by grazing env.
       *
       * 0.16 -> 0.08. Re-measured radially against the ADS frame: the band was
       * still 225-262 px at ~200 sRGB. Halving it again is the amplitude half of
       * the fix; the other half is geometric and matters more — the rear of the
       * sight is no longer aluminium at all, it is a rubber bezel that wraps past
       * the widest point of the housing (see parts.js buildOptic `cup`).
       */
      three: { physical: true, specularIntensity: 0.08 },
    },
  ],

  /**
   * Parkerised / phosphated steel: barrel, gas block, pins, small parts.
   * Manganese phosphate is a genuine metal conversion coating — metalness 1,
   * F0 pulled well below neutral steel and roughness pushed up near 0.8, which
   * is what gives a barrel its dead, non-reflective grey-brown look.
   */
  steel: [
    'metal_brushed',
    {
      ...BASE,
      bake: { size: 512, seed: 617, relief: 0.006 },
      scale: 0.12,
      /**
       * MATERIAL CLASS 3 of 3 — metalness 1, so this "tint" is the F0, not an
       * albedo. Phosphate is a warm dark grey conversion coating.
       *
       * NOTE for the recalibration above: `specularIntensity` does NOT apply to a
       * metal (three folds the albedo into F0 when metalness = 1), so the only
       * levers on the steel family are this F0 and the roughness. That is why the
       * three steel entries below move their tint and roughness instead, while
       * every dielectric moves its specularIntensity.
       *
       * 0.42 -> 0.30: manganese phosphate is a dark, low-reflectance conversion
       * coating and the barrel was reading a stop over the receiver it is bolted
       * into.
       */
      /**
       * 0.42 -> 0.30 -> 0.17. MEASURED IN ADS: the folded rear sight sits 74 mm
       * from the eye — closer than anything else on the weapon, because it is
       * directly under the optic — and it was rendering the bottom 180 px of the
       * ADS frame as a pale cream slab at L=210-224, the brightest thing on screen.
       *
       * `specularIntensity` cannot touch it (metalness 1), and roughness makes it
       * WORSE past ~0.5 (a wider lobe on a metal collects more of the env
       * hemisphere — measured in an earlier pass), so F0 is the only lever that
       * works. Manganese phosphate is genuinely one of the darkest metal finishes
       * there is; 0.17 x the brushed base is the bottom of that band and it is what
       * makes a barrel read as parkerised rather than as bare stainless.
       */
      tint: c(0.17, 0.162, 0.152),
      /**
       * The metal_brushed ORM runs ~0.30 to ~0.60. The old [1.5, 0.34] mapped
       * that to 0.79-1.0 — i.e. saturated matte over almost the whole range, and
       * with metalness 1 a perfectly matte metal has NO specular lobe at all and
       * NO diffuse either: it is a black hole that only picks up the flat env
       * average. That is the measured "mean RGB 98.9/97.5/98.4, not one specular
       * highlight".
       *
       * [0.66, 0.16] with a 0.30 floor lands parkerised steel at 0.35-0.56.
       *
       * MEASURED, and this is as far as roughness goes: pushing it to [0.60,0.30]
       * (0.48-0.66) made the remaining bright bead at ~(1500,790) BRIGHTER, from
       * 0.509 to 0.580 linear — with metalness 1 a wider lobe collects more of the
       * env hemisphere, so past ~0.5 roughness the trade reverses. That bead
       * belongs to the folded rear sight assembly and is NOT fixable from this
       * material; see the report.
       */
      roughness: [0.66, 0.24, 0.42],
      normalStrength: 1.2,
      detail: [13, 0.95, 0.42, 5],
      // A barrel and gas block DO polish on the high spots — more wear than the
      // receiver, but still nowhere near a whole-surface effect.
      wear: [0.16, 0.55, 0.5, 0],
      wearColor: 0x62666b,
      wearMaterial: [0.26, 1.0, 0, 0.7],
      grimeColor: 0x0c0a07,
      three: { anisotropy: 0.1 },
    },
  ],

  /**
   * SOOTED steel — the muzzle device and the gas block.
   *
   * Everything within about 40 mm of a muzzle crown, and everything the gas
   * system vents through, is coated in carbon within a magazine of firing. It is
   * the single most recognisable "this weapon has been used" cue on a rifle and
   * it lives exactly where the eye goes in the hipfire frame (the muzzle brake is
   * the leading edge of the silhouette, and it is where the flash spawns).
   *
   * Carbon is a near-black, completely matte, slightly WARM deposit sitting on
   * top of the phosphate: F0 down to 0.55 of the parkerising, roughness floored
   * at 0.62, and the polish-through wear layer cut to a third because a sooted
   * brake has no bright high spots left on it. The 0.75 cavity-grime weight also
   * fills the ports and the flutes, which is where soot actually collects.
   */
  steel_soot: [
    'metal_brushed',
    {
      ...BASE,
      bake: { size: 512, seed: 617, relief: 0.006 },
      scale: 0.1,
      /**
       * CARBON IS NOT A METAL, and treating it as one is why every attempt to
       * darken the muzzle brake failed.
       *
       * MEASURED: as a metal at F0 0.085 x brushed base, roughness floored at 0.80,
       * the brake's upper flank still rendered L=230-237 — display white. With
       * metalness 1 there is no diffuse term at all, so the ONLY thing on screen is
       * a GGX lobe, and a cylinder guarantees that some band of it sits in the
       * key's mirror direction whatever the roughness. Dropping F0 and raising
       * roughness had moved it by 7 code values across two attempts.
       *
       * Soot is a dielectric powder sitting ON the phosphate. metalness 0.12 keeps
       * a trace of the metal underneath showing through and makes the surface
       * DIFFUSE-dominant like the rest of the recalibrated gun, so it finally has
       * an albedo to be dark with, and the 0.10 specular clamp takes the lobe out.
       * The albedo then has to come down to match: 0.085 -> 0.022 lands it at
       * ~0.013 linear, level with the anodised receiver, which is what a carbon-
       * caked brake looks like next to the rifle it is screwed to.
       */
      tint: c(0.022, 0.02, 0.018),
      /**
       * Floored at 0.80, higher than anything else on the weapon. MEASURED: at
       * 0.62 the brake's top facet still rendered a 25 x 12 px cream highlight at
       * L=190 — a flat metal facet sitting in the mirror direction of the
       * viewmodel key produces a concentrated GGX lobe whatever its F0 is, and at
       * this rig's light level a concentrated lobe is display white. Carbon is the
       * one surface on the gun where a near-total diffusion of the lobe is also
       * the physically right answer.
       */
      roughness: [0.42, 0.5, 0.8],
      normalStrength: 1.3,
      detail: [15, 1.0, 0.5, 5],
      wear: [0.06, 0.7, 0.55, 0],
      wearColor: 0x3a3c3e,
      wearMaterial: [0.55, 1.0, 0, 0.6],
      grimeColor: 0x070604,
      weather: [0, 0, 0, 0.75],
      three: { physical: true, metalness: 0.12, specularIntensity: 0.1, anisotropy: 0.06 },
    },
  ],

  /**
   * Bare, oiled steel: bolt carrier, charging handle, trigger, sight blades.
   * These ARE polished metal, so they keep the brushed surface — but with the
   * anisotropy pulled right down, because a bolt carrier is turned and
   * machined, not sanded in one direction.
   */
  steel_bright: [
    'metal_brushed',
    {
      ...BASE,
      scale: 0.05,
      /**
       * Nitrided / oiled steel: a metal, so the "albedo" is its F0.
       *
       * MEASURED IN ADS: the charging-handle latch rendered as a 60 px MIRROR bead
       * at L=235 — the brightest object in the frame and the single most "toy"
       * thing on the gun. specularIntensity cannot touch it (metalness 1 ignores
       * it), so the fix has to be F0 and roughness: 0.40 -> 0.27, and the roughness
       * floor from 0.34 to 0.48. It is still visibly the glossiest class on the
       * weapon; it is no longer chrome.
       */
      tint: c(0.155, 0.155, 0.164),
      /**
       * Bolt carrier / charging handle / trigger: the shiniest thing on the gun,
       * 0.44-0.57, floor 0.40.
       *
       * MEASURED, twice. At [0.55,0.055] (min 0.22) and again at [0.5,0.2] (min
       * 0.32) the charging-handle latch and the takedown pin heads still rendered
       * as mirror-chrome beads at ~(1500,790) in every frame — a smooth convex
       * metal facing the viewmodel key needs a LOT of roughness before its
       * highlight stops being a specular point. 0.44 is still visibly the
       * glossiest class on the weapon; it just no longer has a mirror in it.
       */
      roughness: [0.5, 0.44, 0.58],
      normalStrength: 1.0,
      detail: [12, 0.8, 0.3, 5],
      wear: [0.16, 0.45, 0.4, 0],
      wearColor: 0x5c6066,
      wearMaterial: [0.18, 1.0, 0, 0.6],
      grimeColor: 0x0a0806,
      three: { anisotropy: 0.12 },
    },
  ],

  /**
   * Black nitrided steel — pistol slides, bolt bodies, small levers.
   *
   * A salt-bath nitride finish is a metal, but a very dark and fairly rough one:
   * F0 around 0.2 and roughness near 0.6. Rendering a slide as plain brushed
   * steel gives a broad flat surface facing straight up at the sky, and it
   * blows out to cream — the pistol ends up looking like it was carved from
   * ivory.
   */
  steel_black: [
    'metal_brushed',
    {
      ...BASE,
      bake: { size: 512, seed: 829, relief: 0.004 },
      scale: 0.07,
      // Metal, so this is F0 — see the note on `steel`. 0.24 -> 0.19 with the
      // roughness floor up: a nitrided slide is dark but it absolutely has a
      // highlight running down its top edge, and that highlight is the whole read.
      tint: c(0.155, 0.158, 0.165),
      roughness: [0.56, 0.14, 0.36],
      normalStrength: 0.95,
      detail: [18, 0.7, 0.3, 5],
      wear: [0.24, 0.5, 0.5, 0],
      wearColor: 0x6a6f75,
      wearMaterial: [0.22, 1.0, 0, 0.75],
      grimeColor: 0x0a0806,
      three: { anisotropy: 0.14 },
    },
  ],

  /** Glass-filled polymer: magazine, stock, grip shell, handguard panels. */
  polymer: [
    'rubber',
    {
      ...BASE,
      bake: { size: 1024, seed: 149, relief: 0.009 },
      scale: 0.055,
      /**
       * MATERIAL CLASS 2 of 3 — moulded glass-filled nylon furniture.
       *
       * ~0.027/0.026/0.023 linear off the same baked base: 15% DARKER than the
       * anodised aluminium and marginally WARM against its cool blue-grey. That
       * pair of offsets (a fifth of a stop of value, opposite hue bias) plus 0.13
       * more roughness is what makes a polymer handguard read as a different
       * substance from the alloy receiver it is bolted to at 1080p — which it did
       * not when `alu` and `alu_fine` were the same colour and carried the lot.
       */
      // x2.7 with `alu`, keeping the 15%-darker/warmer offset that is the whole
      // polymer-vs-alloy separation cue: ~0.0075/0.0070/0.0064 linear against the
      // anodising's 0.0095/0.0101/0.0117.
      tint: c(0.224, 0.211, 0.192),
      // 0.61-0.75 — semi-matte, a full 0.25 rougher than the anodising, so the
      // two catch the sky at visibly different rates as the gun sways.
      roughness: [0.63, 0.15, 0.3],
      // Glass-filled nylon has the most aggressive micro-texture on the gun — a
      // moulded stipple straight off the tool — and it is the second-biggest area
      // in frame after the receiver. Amplitudes up with the rest of the
      // recalibration; roughness detail especially, because a stipple reads as a
      // scatter of tiny specular breaks before it reads as an albedo pattern.
      normalStrength: 1.5,
      detail: [26, 1.15, 0.55, 6],
      wear: [0.26, 0.6, 0.5, 0],
      wearColor: 0x3e4145,
      wearMaterial: [0.46, 0.0, 0, 0.5],
      grimeColor: 0x0b0a08,
      // Glass-filled nylon is a low-gloss dielectric: 0.02-0.025 reflectance, not
      // glass's 0.04. Same argument as `alu`, and the handguard panels are the
      // largest single area on the weapon so it matters most here.
      three: { physical: true, specularIntensity: 0.13 },
    },
  ],

  /** Coyote / FDE polymer for furniture variation. */
  polymer_tan: [
    'rubber',
    {
      ...BASE,
      bake: { seed: 131 },
      scale: 0.08,
      // Flat dark earth: bright enough to read as a colour break against the black
      // furniture, dark enough to be paint. Only 1.6x rather than the 2.7x the
      // black polymer got — FDE is already the light material on the gun and it
      // must not become the brightest thing in the frame.
      tint: c(0.62, 0.498, 0.358),
      roughness: [0.63, 0.16, 0.3],
      normalStrength: 1.2,
      detail: [24, 1.0, 0.5, 5],
      wear: [0.24, 0.7, 0.5, 0],
      wearColor: 0x5c5340,
      wearMaterial: [0.44, 0.0, 0, 0.5],
      grimeColor: 0x0f0c08,
      three: { physical: true, specularIntensity: 0.14 },
    },
  ],

  /** Soft rubber: grip overmould, butt pad, eyecup. */
  rubber: [
    'rubber',
    {
      ...BASE,
      bake: { seed: 211 },
      scale: 0.055,
      // Rubber overmould: the darkest thing on the weapon, ~0.0049 linear after the
      // recalibration. Very slightly warm rather than dead neutral — moulded EPDM
      // is never blue.
      tint: c(0.147, 0.137, 0.127),
      roughness: [0.86, 0.04, 0.55],
      normalStrength: 1.35,
      // 1.2 mm pebble at this tile, at full amplitude. This material now carries
      // the optic's eyepiece and objective bezels — the two annuli that face the
      // eye squarely in ADS — so its micro-relief is what keeps them from reading
      // as flat punched holes.
      detail: [14, 1.0, 0.55, 5],
      wear: [0.22, 0.8, 0.6, 0],
      wearColor: 0x24262a,
      wearMaterial: [0.72, 0.0, 0, 0.35],
      grimeColor: 0x0a0908,
      weather: [0, 0, 0, 0.55],
      /**
       * Rubber is a dielectric with ~0.02 specular reflectance, half glass's 0.04,
       * and three's specularF90 = 1.0 is what lights an edge-on moulded surface
       * like chrome. This material is the optic's rear bezel, and that bezel is
       * the outer circle of the whole ADS frame, so the grazing clamp is not
       * optional here — it is the reason the cream ring is gone.
       */
      three: { physical: true, specularIntensity: 0.12 },
    },
  ],

  /** Cartridge brass — chambered round, shells on the belt/carrier. */
  brass: [
    'metal_brushed',
    {
      ...BASE,
      scale: 0.05,
      // Metal, so this is F0 (see `steel`). Cartridge brass really is a bright
      // metal, but a chambered round in a shadowed port was rendering as a lamp;
      // pulled back a third and roughened, which is what a fired-and-reloaded case
      // actually looks like.
      tint: c(2.3, 1.58, 0.74),
      roughness: [0.55, 0.16, 0.36],
      normalStrength: 0.75,
      detail: [10, 0.55, 0.28, 4],
      wear: [0.8, 0.3, 0.3, 0],
      wearColor: 0xe8c98a,
      wearMaterial: [0.12, 1.0, 0, 0.8],
      three: { anisotropy: 0.05 },
    },
  ],

  /** Copper jacket of a visible projectile tip. */
  copper: [
    'metal_brushed',
    {
      ...BASE,
      scale: 0.04,
      tint: c(2.25, 1.4, 1.09),
      roughness: [0.6, 0.18, 0.34],
      normalStrength: 0.75,
      detail: [10, 0.55, 0.28, 4],
      wear: [0.5, 0.3, 0.3, 0],
      wearColor: 0xd9a271,
      wearMaterial: [0.2, 1.0, 0, 0.8],
      three: { anisotropy: 0.05 },
    },
  ],

  /*
   * The arm/hand materials (`glove`, `glove_pad`, `glove_seam`, `sleeve`) that
   * used to live here were four textured fabric/leather library surfaces, each
   * with its own bake override. The viewmodel arms are now deliberately
   * low-poly, flat-shaded dark grey — see `armGlove()` / `armSleeve()` on the
   * class below — which removes those four texture-set bakes and every
   * per-pixel texture fetch on the largest close-to-camera surfaces in the
   * frame.
   */
};

/**
 * Resolves and caches the weapon materials, plus the couple of custom
 * materials that have no library equivalent (optic glass, illuminated reticle).
 * Those two are owned here and disposed here.
 */
export class WeaponMaterials {
  constructor(ctx) {
    this.ctx = ctx;
    this.lib = ctx.peek('materials');
    this.cache = new Map();
    this.owned = [];
    this.ownedTex = [];
    this._rimTex = null;
    this._fallbacks = new Map();
  }

  /** @returns {THREE.Material} */
  get(key) {
    if (key === 'cavity') return this.cavity();
    if (key === 'optic_tube') return this.opticTube();
    if (key === 'glass') return this.glass();
    if (key === 'lens_ring') return this.lensRing();
    if (key === 'lens_vig') return this.lensVignette();
    let m = this.cache.get(key);
    if (m) return m;
    const def = WEAPON_MATERIALS[key];
    if (def && this.lib) {
      m = this.lib.get(def[0], def[1]);
      // The viewmodel is drawn with its own near plane; nothing about it should
      // write into the world's shadow cascades.
      m.shadowSide = THREE.FrontSide;
      // A weapon held at the shoulder sees maybe half the sky: the shooter's own
      // head, chest and arms block the rest, and the sight, the mount and the
      // magwell shade each other. Without this the gun samples the full bright
      // sky IBL while the street around it is in shade, which is the single most
      // obvious "sticker pasted on the frame" tell. The opts above are unique to
      // this subsystem, so the library instance being tuned here is ours alone.
      m.envMapIntensity = ENV_OCCLUSION;
      m.needsUpdate = true;
    } else {
      m = this._fallback(key);
    }
    this.cache.set(key, m);
    return m;
  }

  /** Used only if the materials subsystem is unavailable (standalone harness). */
  _fallback(key) {
    let m = this._fallbacks.get(key);
    if (m) return m;
    const metal =
      key === 'steel' || key === 'steel_bright' || key === 'steel_black' || key === 'brass' || key === 'copper';
    m = new THREE.MeshStandardMaterial({
      color: key === 'brass' ? 0xb08d3a : metal ? 0x3a3d42 : 0x2a2b2e,
      roughness: metal ? 0.38 : 0.72,
      metalness: metal ? 1 : 0,
    });
    this._fallbacks.set(key, m);
    this.owned.push(m);
    return m;
  }

  /**
   * The viewmodel hands: minimal low-poly, flat-shaded, untextured dark greys.
   *
   * Two materials, not four — a glove and the wrist stub that replaced the
   * sleeves — and neither touches the texture units at all. The full forearm
   * sleeve this untextured pass was built for is gone (see hands.js), but the
   * gloves are still the closest surfaces to the eye in the frame, so the
   * zero-fetch rule keeps earning its place.
   *
   * Exposure: the viewmodel light rig delivers roughly 20x the irradiance per
   * unit albedo that the world does (see the recalibration note on `alu`), so
   * these albedos sit in the same deliberately crushed band as the gun's.
   * The anodised receiver is ~0.0095 linear and renders mid-grey (L~67); the
   * glove sits just under it and the sleeve half a stop above, so the limb
   * reads as two dark greys with the flat-shaded facets carrying the value
   * separation from the gun. MEASURED: a first pass at 2-3x these albedos
   * rendered the sunlit forearm pale grey — the crush is not optional.
   *
   * `flatShading` is the whole look: the arm geometry is faceted prisms, and
   * the per-facet value steps are what replace seams, pads and fold rings as
   * the thing that separates the fingers and breaks up the forearm.
   * `specularIntensity` stays clamped for the same reason it is everywhere
   * else on the viewmodel: three's specularF90 = 1.0 turns any matte dielectric
   * chrome at grazing incidence, and a forearm is all grazing incidence.
   */
  armGlove() {
    const key = 'arm_glove';
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshPhysicalMaterial({
      // ~0.0085 linear — the same crushed band as the gun (receiver ~0.0095).
      // MEASURED: at 0x202124 (~0.019 linear) the arm rendered pale grey in the
      // weapon shot; the rig's irradiance needs gun-level albedos.
      color: 0x171818,
      roughness: 0.86,
      metalness: 0,
      specularIntensity: 0.12,
      flatShading: true,
    });
    m.name = 'ow-arm-glove';
    m.shadowSide = THREE.FrontSide;
    m.envMapIntensity = ENV_OCCLUSION;
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  armSleeve() {
    const key = 'arm_sleeve';
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshPhysicalMaterial({
      // ~0.013 linear — about half a stop above the receiver and a bit over the
      // glove, so the limb keeps its two-value structure while staying dark.
      color: 0x1e2021,
      roughness: 0.92,
      metalness: 0,
      specularIntensity: 0.12,
      flatShading: true,
    });
    m.name = 'ow-arm-sleeve';
    m.shadowSide = THREE.FrontSide;
    m.envMapIntensity = ENV_OCCLUSION;
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /**
   * The inside of the optic tube: a LIGHT TRAP, not a cavity.
   *
   * `cavity()` is 0x030405 — 0.0015 linear — which is blacker than any real
   * surface and, being effectively zero, has nothing for the fill or the bounce
   * off the objective to land on. The result was measured in ads.png: the tube
   * interior sampled rgb(27,36,53), i.e. it was carrying nothing but a flat blue
   * env term, so the objective read as "a flat grey gradient disc".
   *
   * A real anodised/flocked tube bore is 0.018-0.025 linear: black, but a black
   * you can see a gradient across. Roughness 0.9 and a hard specular clamp keep
   * it from doing what the old cavity did at grazing incidence, which is throw
   * the cream ring around the front lip that the critique measured.
   */
  opticTube() {
    const key = 'optic_tube';
    let m = this.cache.get(key);
    if (m) return m;
    // 0x272a2c is 0.0205 linear — the middle of the band.
    m = new THREE.MeshPhysicalMaterial({
      color: 0x1d2023,
      roughness: 0.9,
      metalness: 0,
      // The whole point: no grazing lobe. MeshStandardMaterial hard-codes
      // specularF90 = 1.0, so a matte black tube wall lights up like chrome to
      // any ray that skims it — which is every ray just outside the exit pupil
      // when the eye is on the optical axis.
      specularIntensity: 0.12,
      envMapIntensity: 0.3,
      side: THREE.DoubleSide,
    });
    m.name = 'ow-optic-tube';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /**
   * The bright inner-edge reflection ring just inside the objective rim.
   *
   * Looking into a real coated objective the one unmistakable cue is a thin,
   * very bright arc where the inside of the bezel is reflected in the glass. It
   * is a specular feature of the lens, so it does not belong on the bezel
   * geometry (which is what produced the fat cream ring) — it is its own 0.4 mm
   * ring, unlit and additive, sitting on the glass.
   */
  lensRing(intensity = 0.14) {
    const key = `lensRing:${intensity}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9fc4d8).multiplyScalar(intensity),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: false,
    });
    m.name = 'ow-lens-ring';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /**
   * Optic glass — an AR-coated dielectric, not a smoked window.
   *
   * A broadband AR stack leaves a residual reflection whose hue swings with
   * angle: green at normal incidence (the stack is tuned for the red and blue
   * ends, so what it fails to kill is the middle) through violet to magenta by
   * ~70 degrees. That swing is the single cue that says "there is glass in the
   * tube", and it is driven by Fresnel, so it is built out of two terms that
   * peak at opposite ends of the angle range:
   *   specularColor  tints F0, i.e. NORMAL incidence  -> green
   *   sheen          is a grazing lobe                -> magenta
   * with three's iridescence (a real thin film) filling in the transition.
   */
  glass(tint = 0x3b6e8c) {
    const key = `glass:${tint}`;
    let m = this.cache.get(key);
    if (m) return m;
    // A multi-coated red-dot objective transmits ~88% on axis with a faint cool
    // cast, and throws a strong bluish-magenta sheen at grazing angles. Opacity
    // is the *absorption*, so it has to stay low: at 0.3 the sight reads as a
    // smoked lens and the world behind it goes muddy.
    m = new THREE.MeshPhysicalMaterial({
      color: 0x121c22,
      transparent: true,
      opacity: 0.1,
      // 0.03: inside the 0.02-0.04 band. Below 0.02 the reflection collapses to
      // a single pixel-sized sun spot and the lens reads as a hole again.
      roughness: 0.03,
      metalness: 0,
      ior: 1.52,
      reflectivity: 0.55,
      specularIntensity: 1,
      // GREEN at normal incidence — the residual an AR stack cannot cancel.
      specularColor: new THREE.Color(0x59c489),
      /**
       * The AR stack. A broadband anti-reflective coating IS a thin film, so the
       * physically-correct way to get "cyan on axis, magenta at the rim" is
       * three's iridescence term rather than a hand-authored gradient: the
       * thickness range below is a real 5-layer MgF2/TiO2 stack (310-560 nm),
       * which swings the reflected hue from cyan-green through violet to magenta
       * across the last ~25 degrees of view angle. Without this the lens shows
       * the raw world and there is no cue that there is any glass in the tube at
       * all — which is exactly what the critique measured.
       */
      iridescence: 1,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [220, 560],
      /**
       * MAGENTA at grazing — sheen is a pure Fresnel-weighted rim lobe, so it is
       * ~0 down the axis and dominant by 70 degrees, which is exactly the swing a
       * coated objective makes as you roll off it.
       *
       * 0.85 / roughness 0.08 -> 0.42 / 0.30. MEASURED in the ADS frame: a tight
       * magenta rim lobe on a curved lens element, sampled against an 8-bit
       * framebuffer with the composite's grain on top, resolved as a field of
       * violet chroma speckle across the whole optic — read as compression
       * artefacts rather than as a coating. Halving the amplitude and quadrupling
       * the lobe width keeps the hue swing and takes the noise out of it.
       */
      sheen: 0.42,
      sheenColor: new THREE.Color(0xa856b8),
      sheenRoughness: 0.3,
      envMapIntensity: 2.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      premultipliedAlpha: true,
    });
    m.name = 'ow-optic-glass';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /**
   * Radial alpha ramp, 1 at the rim and 0 in the middle.
   *
   * Used by the tube vignette and the eye-relief ring: a real sight darkens
   *6-8% toward the edge of the exit pupil because the field stop and the tube
   * wall eat the outer rays, and that soft darkening is a large part of why
   * looking through glass looks different from looking through a hole.
   */
  _rimRamp() {
    if (this._rimTex) return this._rimTex;
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N - 0.5;
        const v = (y + 0.5) / N - 0.5;
        const r = Math.min(1, Math.hypot(u, v) * 2);
        // flat centre, then a smooth ramp over the outer third of the aperture
        const t = Math.max(0, (r - 0.8) / 0.2);
        const a = t * t * (3 - 2 * t);
        const i = (y * N + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(a * 255);
      }
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.needsUpdate = true;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    this._rimTex = t;
    this.ownedTex.push(t);
    return t;
  }

  /**
   * Tube vignette: an unlit dark disc that sits just behind the ocular lens and
   * is transparent in the middle, opaque-ish at the rim. `strength` is the peak
   * darkening at the very edge of the aperture.
   */
  lensVignette(strength = 0.34) {
    const key = `vignette:${strength}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({
      color: 0x05070a,
      transparent: true,
      opacity: strength,
      alphaMap: this._rimRamp(),
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: false,
    });
    m.name = 'ow-lens-vignette';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /**
   * The reticle's dark outline. Additive blending cannot draw anything darker
   * than the background, so the 0.5 px keyline that keeps a 2 px dot legible
   * against a blown-out sky has to be a separate normally-blended ring.
   */
  reticleOutline(opacity = 0.8) {
    const key = `reticleOutline:${opacity}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({
      color: 0x14060a,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    m.name = 'ow-reticle-outline';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /** Additive, unlit, depth-tested reticle. */
  reticle(color = 0xff2a12, intensity = 6.5) {
    const key = `reticle:${color}:${intensity}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: false,
    });
    m.name = 'ow-reticle';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  /** Matte black interior — bores, lens housings, ejection port cavity. */
  cavity() {
    const key = 'cavity';
    let m = this.cache.get(key);
    if (m) return m;
    // Truly black and truly matte. Anything with a specular lobe left in it
    // catches the sky from inside the optic tube and paints a bright crescent
    // across the bottom of the sight picture — and MeshStandardMaterial has no
    // way to say "no specular lobe", because it hard-codes F0 = 0.04 and
    // specularF90 = 1.0. Every engraved rollmark stroke, bore and port cavity on
    // the gun uses this material, and at grazing incidence they were all lighting
    // up like glass. MeshPhysicalMaterial with specularIntensity 0.04 is the same
    // black with the Fresnel taken out.
    m = new THREE.MeshPhysicalMaterial({
      color: 0x0a0c0e,
      roughness: 1,
      metalness: 0,
      specularIntensity: 0.04,
      envMapIntensity: 0.18,
      side: THREE.DoubleSide,
    });
    m.name = 'ow-cavity';
    this.cache.set(key, m);
    this.owned.push(m);
    return m;
  }

  dispose() {
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
    for (const t of this.ownedTex) t.dispose();
    this.ownedTex.length = 0;
    this._rimTex = null;
    this.cache.clear();
    this._fallbacks.clear();
  }
}

export const MATERIAL_KEYS = Object.keys(WEAPON_MATERIALS);
