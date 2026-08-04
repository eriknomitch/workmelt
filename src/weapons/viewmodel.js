import * as THREE from 'three';
import { Arm } from './hands.js';
import { buildClips, makeSampleResult } from './clips.js';
import { triCount, mergeAll } from './geometry.js';
import {
  Spring,
  Spring3,
  Noise1,
  clamp,
  clamp01,
  lerp,
  damp,
  smootherstep,
  wrapPi,
  TAU,
} from './mathx.js';

/**
 * THE VIEWMODEL RIG.
 *
 * Everything the player looks at for the whole game happens in this file. It is
 * a stack of *additive procedural layers* over one base pose — no baked clips
 * for anything continuous:
 *
 *   base      hip / ADS / sprint / low-ready pose blend
 *   sway      layered incommensurate noise, so idle never visibly loops
 *   bob       stride-driven figure-eight, scaled by speed and stance
 *   lag       the gun TRAILS camera rotation on a spring, overshoots, settles.
 *             This is the single detail that makes a viewmodel feel real.
 *   recoil    per-shot rotational + positional impulse, spring-damper return
 *   clip      keyframed reload / inspect / draw additive offset
 *
 * ADS alignment is computed, not authored: the rig solves for the translation
 * that puts the weapon's sight node exactly on the camera axis at the right eye
 * relief, so the optic is pixel-centred at full ADS whatever the weapon.
 *
 * The scene graph:
 *   viewScene
 *     anchor          <- copies the world camera transform every frame, so the
 *                        gun is lit and shadowed as if it were in the world
 *       rig           <- the animation stack writes here
 *         weapon      <- body meshes + moving-part groups
 *         armL/armR   <- two-bone IK, hands welded to the weapon's grips
 *       reticle       <- collimated dot, placed on the optical axis in camera
 *                        space so it behaves like real glass
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XYZ');
const _m = new THREE.Matrix4();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

/**
 * Re-shape the curvature vertex masks baked by `materials.bakeMasks`.
 *
 * bakeMasks writes a LINEAR convexity ramp into vColor.rgb (wear / grime / AO).
 * On architecture that is right — a wall has interior vertices for the ramp to
 * fall off against. On chamfered hard-surface geometry there are none, so the
 * ramp runs from the chamfer to the middle of the panel and the whole face
 * reads as worn metal. Raising the exponent collapses that ramp back onto the
 * chamfer's own vertices, which is the outer 1-2 mm of the edge — the only place
 * a rifle actually polishes through.
 *
 * @param {THREE.BufferGeometry} geo   must already carry a `color` attribute
 */
function shapeMasks(geo, o) {
  const col = geo.getAttribute('color');
  if (!col) return geo;
  const a = col.array;
  const amp = [o.wearAmp ?? 1, o.grimeAmp ?? 1, o.aoAmp ?? 1];
  const exp = [o.wearExp ?? 1, o.grimeExp ?? 1, o.aoExp ?? 1];
  for (let i = 0; i < a.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = a[i + k];
      a[i + k] = v <= 0 ? 0 : amp[k] * Math.pow(v > 1 ? 1 : v, exp[k]);
    }
  }
  col.needsUpdate = true;
  return geo;
}

/** Right-handed hand basis from a finger direction and a back-of-hand direction. */
function handBasis(out, finger, back) {
  _v.set(-finger[0], -finger[1], -finger[2]).normalize(); // hand +Z
  _v2.set(back[0], back[1], back[2]);
  _v2.addScaledVector(_v, -_v2.dot(_v));
  if (_v2.lengthSq() < 1e-8) _v2.set(0, 1, 0).addScaledVector(_v, -_v.y);
  _v2.normalize(); // hand +Y
  _v3.crossVectors(_v2, _v).normalize(); // hand +X
  _m.makeBasis(_v3, _v2, _v);
  return out.setFromRotationMatrix(_m);
}

export class Viewmodel {
  constructor(ctx, mats) {
    this.ctx = ctx;
    this.mats = mats;
    this.rng = ctx.rng.fork();

    this.anchor = new THREE.Object3D();
    this.anchor.name = 'ow-viewmodel-anchor';
    this.rig = new THREE.Object3D();
    this.rig.name = 'ow-viewmodel-rig';
    this.anchor.add(this.rig);
    ctx.viewScene.add(this.anchor);

    // ---- hands ------------------------------------------------------------
    // Two flat-shaded untextured dark greys — the hands are deliberately
    // low-poly (see hands.js) and cost no texture fetches at all. There are no
    // arm sleeves any more: each glove ends in a short wrist stub, and the IK
    // solve exists to weld the hands to the weapon and aim the stubs.
    const handMats = {
      glove: mats.armGlove(),
      sleeve: mats.armSleeve(),
    };
    // Shoulder joints in CAMERA space: ~200 mm lateral, ~210 mm below the eye
    // and only just behind it. Nothing renders at the shoulder, but its place
    // still matters twice over: it is the far end of the reach budget (too far
    // back and the two-bone solve clamps, dragging the HAND off the grip), and
    // it decides where the solved elbow lands, which is what aims each wrist
    // stub. The reach margin is bought by cheating the bones 10% long — see
    // hands.js L_UPPER — not by moving the shoulders forward.
    this.armR = new Arm(1, handMats, {
      scale: 1,
      shoulderX: 0.205,
      shoulderY: -0.2,
      shoulderZ: 0.06,
      pose: 'grip',
    });
    this.armL = new Arm(-1, handMats, {
      scale: 0.97,
      shoulderX: 0.2,
      shoulderY: -0.22,
      shoulderZ: 0.02,
      pose: 'clamp',
    });
    this.rig.add(this.armR.root);
    this.rig.add(this.armL.root);
    // Body-fixed shoulders, expressed in camera space and re-based into rig
    // space every frame so the elbows do not swing when the gun moves.
    this.shoulderR = new THREE.Vector3(0.205, -0.2, 0.06);
    this.shoulderL = new THREE.Vector3(-0.2, -0.22, 0.02);

    // ---- reticle ----------------------------------------------------------
    this.reticle = new THREE.Object3D();
    this.reticle.name = 'ow-reticle';
    this.anchor.add(this.reticle);
    /**
     * A 2 MOA dot with a soft halo, a dark keyline and a 12-segment outer ring.
     *
     * All four are authored at UNIT radius and scaled together by the dot's
     * angular size in `_updateReticle`, so the whole reticle is one shape that
     * grows and shrinks as a unit — proportions can never drift.
     *
     *   core     the emitter. 0xff1a08 at intensity 1.35, and the intensity is
     *            measured — twice, because the first analysis was wrong.
     *
     *            The old note here reasoned about how much GREEN the emitter adds
     *            and concluded 3.2 was safe. It is not, and the reason is the tone
     *            curve, not the additive maths: the frame is graded with AgX (see
     *            render/composite.js), and AgX's whole signature is that it
     *            DESATURATES as it approaches display white. A pixel whose red
     *            channel is 3.2 over a mid-grey background comes out of the curve
     *            at rgb(255,248,239) whatever its green and blue were — measured on
     *            ads.png, a white dot, exactly what the previous note said it had
     *            fixed. There is no colour available up there.
     *            0.95 keeps the core on the near-linear part of the curve, where a
     *            saturated red stays a saturated red, and the halo + ring below are
     *            what carry the "it is an emitter" read instead of raw radiance.
     *   halo     1.6x the core radius, ~6% alpha. This is the bloom seed and the
     *            reason the dot looks like it is BEHIND glass. It has to stay
     *            tight; the old 0.0095 rad / 0.34 alpha halo was 23 px across and
     *            was what actually read on screen — a soft salmon blob.
     *   rim      a NORMALLY blended dark keyline. Additive blending cannot draw
     *            anything darker than what is behind it, so without a separate
     *            ring the dot dissolves the moment it crosses a blown-out sky.
     *   ring     12 arc segments at 3.2x the dot radius, 35% of its radiance.
     *            A bare dot at 8 px is indistinguishable from a dead subpixel;
     *            the segmented ring is what makes it read as an EMITTER, and it
     *            is the standard 65 MOA circle-dot every modern sight ships.
     */
    const core = new THREE.CircleGeometry(1, 32);
    const halo = new THREE.CircleGeometry(1.6, 32);
    const rim = new THREE.RingGeometry(1, 1.42, 32, 1);
    const RING_SEGS = 12;
    const ringArcs = [];
    for (let i = 0; i < RING_SEGS; i++) {
      const a0 = (i / RING_SEGS) * TAU;
      ringArcs.push(new THREE.RingGeometry(2.98, 3.42, 4, 1, a0, (TAU / RING_SEGS) * 0.56));
    }
    const ring = mergeAll(ringArcs);
    this.dotCore = new THREE.Mesh(core, mats.reticle(0xff1206, 0.95));
    this.dotHalo = new THREE.Mesh(halo, mats.reticle(0xff2a0c, 0.34));
    this.dotRim = new THREE.Mesh(rim, mats.reticleOutline(0.85));
    this.dotRing = new THREE.Mesh(ring, mats.reticle(0xff1206, 0.95 * 0.5));
    this.dotHalo.renderOrder = 19;
    this.dotRim.renderOrder = 20;
    this.dotRing.renderOrder = 20;
    this.dotCore.renderOrder = 21;
    /** The red-dot reticle, shown behind an optic whose `reticle` is 'dot'. */
    this.dotGroup = new THREE.Object3D();
    this.dotGroup.name = 'ow-reticle-dot';
    this.dotGroup.add(this.dotHalo, this.dotRim, this.dotRing, this.dotCore);
    this.reticle.add(this.dotGroup);

    /**
     * THE MAGNIFIED SCOPE'S RETICLE — an etched duplex crosshair, not an emitter.
     *
     * A red dot is a collimated emitter and a rifle scope is a wire etched on
     * glass, and the difference is not decoration: a dot tells you WHERE, a
     * crosshair tells you where AND how far off-centre you are, which is the
     * whole reason a 3.3x picture is worth the FOV it costs. Three parts, all
     * authored at unit radius so they scale as one shape exactly like the dot:
     *
     *   posts   four bars in from the edge of the field that STOP at 35 % of
     *           the radius — the outer two thirds only. A duplex whose posts
     *           reach the middle covers the target at the moment you need to
     *           see it; the gap is the aiming area and the posts are what your
     *           eye tracks in to find it.
     *   hairs   the thin cross across that gap. WIRE-thin: measured on the ADS
     *           frame the first pass was 20 px of post and 8 px of hair against
     *           a ~230 px aperture — 11 % of the field radius was reticle, and
     *           with the glow underlay behind it the cross read as four red
     *           slabs that hid whatever was being aimed at. A real duplex is
     *           etched wire: ~1 % of the field for the hair, 3x that for the
     *           post. That is what these widths are now (2 px / 6 px), and the
     *           sight picture is scene, not reticle.
     *   pip     a small centre square, ~3 px: the thing the eye actually lands
     *           on in a flick, kept just proud of the hair width.
     *
     * Drawn in the OUTLINE material — a normally-blended near-black — rather
     * than the additive emitter: an etched reticle is opaque and reads against
     * a bright sky, which is precisely where an additive one disappears. A thin
     * emissive underlay behind it carries the illuminated-reticle read at night
     * without turning the whole cross into a glow.
     */
    const RETICLE_PARTS = [];
    const POST_OUT = 3.4;
    const POST_IN = 1.19;
    const HAIR_W = 0.016;
    const POST_W = 0.048;
    for (let i = 0; i < 4; i++) {
      // Posts: tapered wedges, wide at the rim, narrow at the tip.
      const post = new THREE.PlaneGeometry(POST_OUT - POST_IN, POST_W * 2);
      post.translate((POST_OUT + POST_IN) * 0.5, 0, 0);
      post.rotateZ((i * TAU) / 4);
      RETICLE_PARTS.push(post);
      // Hairs: the thin cross that crosses the gap.
      const hair = new THREE.PlaneGeometry(POST_IN + 0.02, HAIR_W * 2);
      hair.translate((POST_IN + 0.02) * 0.5, 0, 0);
      hair.rotateZ((i * TAU) / 4);
      RETICLE_PARTS.push(hair);
    }
    const pip = new THREE.PlaneGeometry(0.05, 0.05);
    RETICLE_PARTS.push(pip);
    const cross = mergeAll(RETICLE_PARTS);
    const crossGlow = cross.clone();
    /** Unit-space radius of the post tips — `_updateReticle` scales against it. */
    this._crossOuter = POST_OUT;
    // A distinct colour/intensity so this gets its OWN cached material: the dot's
    // halo uses (0xff2a0c, 0.34) and `WeaponMaterials.reticle` keys on the pair,
    // so reusing it would hand two meshes one material and two per-frame opacity
    // writes that fight.
    this.crossWire = new THREE.Mesh(cross, mats.reticleOutline(0.94));
    this.crossGlow = new THREE.Mesh(crossGlow, mats.reticle(0xff3a14, 0.3));
    // Tight: at 1.5x the glow was a second, wider cross behind the wire — half
    // the on-screen footprint of the old slab reticle was this underlay.
    this.crossGlow.scale.setScalar(1.2);
    this.crossGlow.renderOrder = 20;
    this.crossWire.renderOrder = 21;
    this.crossGroup = new THREE.Object3D();
    this.crossGroup.name = 'ow-reticle-cross';
    this.crossGroup.visible = false;
    this.crossGroup.add(this.crossGlow, this.crossWire);
    this.reticle.add(this.crossGroup);

    this._reticleGeo = [core, halo, rim, ring, cross, crossGlow];
    for (const m of [this.dotCore, this.dotHalo, this.dotRim, this.dotRing, this.crossWire, this.crossGlow]) {
      m.frustumCulled = false;
      m.userData.owNoPrepass = true;
      m.userData.owNoShadow = true;
    }

    // ---- animation state --------------------------------------------------
    this.weapons = new Map();
    this.active = null;

    this.adsT = 0;
    this.adsTarget = 0;
    this.sprintT = 0;
    this.lowReadyT = 0;
    this.bobPhase = 0;
    this.stepT = 0;
    this.noiseT = 0;
    this.triggerT = 0;
    this.triggerTarget = 0;

    this.lag = new Spring3(5.4, 0.46);
    this.lagRot = new Spring3(6.2, 0.42);
    this.recPos = new Spring3(9, 0.42);
    this.recRot = new Spring3(9, 0.42);
    this.jumpSpring = new Spring(5.5, 0.5);
    this.landSpring = new Spring(7.5, 0.55);
    this.settle = new Spring3(2.2, 0.7);

    this.noise = [];
    for (let i = 0; i < 6; i++) this.noise.push(new Noise1(this.rng, 512));
    this.noiseRates = [0.13, 0.19, 0.271, 0.083, 0.117, 0.163];

    this._angVel = { yaw: 0, pitch: 0 };
    this._prevYaw = 0;
    this._prevPitch = 0;
    this._hasPrev = false;

    // clip playback
    this.clip = null;
    this.clipT = 0;
    this.clipPrevT = 0;
    this.clipResult = makeSampleResult();
    this.onClipEvent = null;

    // moving-part drive
    this.boltCycle = 0; // 0..1, driven by firing
    this.boltHold = 0; // 1 = locked back (empty)
    this.magInHand = 0;
    this.magVisible = true;

    // preallocated working state
    this._basePos = new THREE.Vector3();
    this._baseQuat = new THREE.Quaternion();
    this._adsPos = new THREE.Vector3();
    this._adsQuat = new THREE.Quaternion();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._handPos = new THREE.Vector3();
    this._handQuat = new THREE.Quaternion();
    this._handPosL = new THREE.Vector3();
    this._handQuatL = new THREE.Quaternion();
    this._sightLocal = new THREE.Vector3();
    this._lhandTarget = new THREE.Vector3();
    this._lhandFinger = [0, 0, 0];
    this._lhandBack = [0, 0, 0];
    this._muzzleWorld = new THREE.Vector3();
    this._muzzleDir = new THREE.Vector3();
    this._ejectWorld = new THREE.Vector3();
    this._ejectVel = new THREE.Vector3();

    this.debugFrozen = false;
    /** Set false by the preview harness to leave the cameras alone. */
    this.trackCamera = true;
    this.rigOverride = null;
    this._scriptedFire = -1;
    this._scriptShots = 0;
  }

  /* ====================================================================== */
  /*  construction                                                          */
  /* ====================================================================== */

  /**
   * Turn a model description (body + moving assemblies + nodes) into meshes.
   * One mesh per material per assembly: a whole rifle lands in 7-9 draw calls.
   */
  addWeapon(model, def) {
    const group = new THREE.Object3D();
    group.name = `weapon-${model.id}`;
    group.visible = false;
    this.rig.add(group);

    let tris = 0;
    const meshes = [];
    const bake = this.mats.lib?.bakeMasks?.bind(this.mats.lib) ?? null;

    const build = (asm, parent, wearScale = 1) => {
      const map = asm.build();
      for (const [matKey, geo] of map) {
        // Curvature masks: convex chamfers wear to bright metal, creases fill
        // with grime. This is what stops the gun reading as clean plastic.
        if (bake) {
          /**
           * Chamfered hard-surface geometry has no interior vertices on a face,
           * so a per-vertex edge mask interpolates linearly from the chamfer all
           * the way to the far side of the panel: a rail tooth, a mount top face
           * or a handguard slat comes out uniformly worn, which is what turned
           * the rail teeth into flat near-white bars and the mount into beige MDF.
           *
           * Bake the mask at full amplitude and then SHAPE it (below): raising the
           * exponent is the only knob that pulls a vertex-interpolated ramp back
           * onto the outer millimetre or two of the edge, because it pushes
           * everything below the chamfer's own vertices toward zero.
           */
          const soft = matKey === 'polymer' || matKey === 'rubber' || matKey === 'polymer_tan';
          bake(geo, { wear: 1, grime: 1, ao: 1, edgeThreshold: 0.16, rng: this.rng });
          shapeMasks(geo, {
            /**
             * wearAmp comes DOWN and grimeAmp goes UP.
             *
             * With the viewmodel recalibrated to be diffuse-dominant (see
             * materials.js `alu`), the wear layer's contrast against the base
             * albedo is what decides whether a chamfer reads as polished alloy or
             * as a white pencil line, and on small parts — where every vertex is
             * convex — it decides whether a takedown pin reads as steel or as a
             * cream plastic cube. 0.9 -> 0.62 on hard surfaces.
             *
             * Grime is the opposite: it is the only mask that paints the CONCAVE
             * side of the geometry, so it is what puts dirt in the magwell corners,
             * the trigger-guard fillet, the rail slots and the seam between the
             * handguard panels. Those creases were reading perfectly clean, which
             * is a large part of "props read as pasted-on decals" applied to a gun.
             */
            wearAmp: (soft ? 0.42 : 0.62) * wearScale,
            wearExp: soft ? 3.4 : 2.8,
            grimeAmp: 1.15,
            grimeExp: 1.25,
            aoAmp: 1.0,
            aoExp: 1.15,
          });
        }
        const mesh = new THREE.Mesh(geo, this.mats.get(matKey));
        mesh.name = `${asm.name}-${matKey}`;
        // The viewmodel does not cast into the cascades (it is not in the world
        // scene), but it absolutely must RECEIVE the sun shadow: without this the
        // gun is lit at full sun while the street around it is in shade, which is
        // the single most obvious "pasted-on sticker" tell.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        parent.add(mesh);
        meshes.push(mesh);
        tris += triCount(geo);
      }
    };

    build(model.body, group);

    const parts = {};
    for (const [name, asm] of Object.entries(model.moving)) {
      const sub = new THREE.Object3D();
      sub.name = `${model.id}-${name}`;
      group.add(sub);
      build(asm, sub, name === 'magazine' ? 0.8 : 1);
      parts[name] = sub;
    }

    // Seat the moving parts at their rest transforms.
    const n = model.nodes;
    if (parts.magazine && n.magSeat) applyNode(parts.magazine, n.magSeat);
    if (parts.charging && n.chargeRest) applyNode(parts.charging, n.chargeRest);
    if (parts.bolt && n.boltRest) applyNode(parts.bolt, n.boltRest);
    if (parts.slide && n.slideRest) applyNode(parts.slide, n.slideRest);
    if (parts.trigger && n.triggerPivot) applyNode(parts.trigger, n.triggerPivot);
    if (parts.selector && n.selectorPivot) applyNode(parts.selector, n.selectorPivot);

    /**
     * The scope's sight-picture mask (see WeaponMaterials.apertureMask). It is
     * built here rather than in the model assembly because it needs three things
     * a merged material bucket cannot give it: it draws FIRST, it is hidden until
     * the eye is behind the glass, and it opens with the ADS blend.
     */
    const maskSpec = model.nodes.opticGlass?.mask ?? null;
    let apertureMask = null;
    if (maskSpec) {
      apertureMask = new THREE.Mesh(
        new THREE.CircleGeometry(maskSpec.r, 64),
        this.mats.apertureMask()
      );
      apertureMask.name = `${model.id}-aperture-mask`;
      apertureMask.position.set(0, maskSpec.y, maskSpec.z);
      apertureMask.renderOrder = -1;
      apertureMask.frustumCulled = false;
      apertureMask.castShadow = false;
      apertureMask.receiveShadow = false;
      apertureMask.visible = false;
      group.add(apertureMask);
    }

    const entry = {
      id: model.id,
      def,
      model,
      group,
      parts,
      meshes,
      apertureMask,
      tris,
      clips: buildClips(model.nodes, def),
      // the sight point and its axis, in weapon space
      sight: new THREE.Vector3().fromArray(model.nodes.sight),
      ironSight: new THREE.Vector3().fromArray(model.nodes.ironSight ?? model.nodes.sight),
      muzzle: new THREE.Vector3().fromArray(model.nodes.muzzle),
      eject: new THREE.Vector3().fromArray(model.nodes.eject),
      ejectDir: new THREE.Vector3().fromArray(model.nodes.ejectDir ?? [1, 0.4, 0.2]).normalize(),
      optic: model.nodes.opticGlass ?? null,
      magSeatPos: new THREE.Vector3().fromArray(model.nodes.magSeat.pos),
      magSeatQuat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler().fromArray(model.nodes.magSeat.rot)
      ),
      gripR: model.nodes.gripR,
      gripL: model.nodes.gripL,
      chargePull: new THREE.Vector3().fromArray(model.nodes.chargePull ?? [0, 0, 0]),
      boltTravel: new THREE.Vector3().fromArray(model.nodes.boltTravel ?? [0, 0, 0]),
      slideTravel: new THREE.Vector3().fromArray(model.nodes.slideTravel ?? [0, 0, 0]),
      triggerPull: model.nodes.triggerPull ?? -0.3,
      magLen: model.magSize?.len ?? 0.2,
      shell: model.shell,
      lhandPose: model.id === 'pistol' ? 'cup' : 'clamp',
    };
    this._fitSupportHand(entry);
    this.weapons.set(model.id, entry);
    return entry;
  }

  /**
   * GROUND THE SUPPORT HAND ON THE HANDGUARD — once, at build time.
   *
   * Two halves, and both are needed: geometry alone still reads as two floating
   * objects, and AO alone cannot close a 10 mm gap.
   *
   *  1. `Arm.fitToCylinder` searches each distal joint for the rotation that puts
   *     that fingertip's contact patch on the handguard surface (<=1 mm off, up
   *     to 1.5 mm buried), measured through the real transform chain rather than
   *     derived analytically — see the note there for why the analytic version
   *     was 8-14 mm out in every frame despite the maths being right.
   *  2. The contact points that come back are then used to bake a contact-AO
   *     gradient into the handguard. 0.55 multiply at the contact, easing to
   *     1.0 over 12 mm. (Only the weapon side: the flat-shaded arm materials
   *     do not read vertex masks.)
   *
   * The AO mask lives in vColor.b, which the library's shader turns into
   * `orm.r *= 1 - vColor.b * wear[2]`; wear[2] is 0.5 on every weapon material,
   * so a mask of 0.9 is the 0.55 multiply asked for.
   */
  _fitSupportHand(w) {
    const hg = w.model.nodes.handguard;
    const gL = w.gripL;
    if (!hg || !gL || w.id === 'pistol') return;
    this._handPosL.fromArray(gL.pos);
    handBasis(this._handQuatL, gL.finger ?? [0.82, 0.5, -0.28], gL.back ?? [-0.5, 0.32, -0.8]);
    const poseName = `clamp:${w.id}`;
    this.armL.setPose('clamp');
    const contacts = this.armL.fitToCylinder(
      this._handPosL,
      this._handQuatL,
      hg.axis,
      hg.dir,
      hg.r,
      { clearance: 0.001, poseName }
    );
    w.lhandPose = poseName;
    // Only keep contacts that actually landed on the handguard's own extent —
    // a fingertip that overshot past the end cap must not paint AO on the barrel.
    const z0 = Math.max(hg.z0, hg.z1);
    const z1 = Math.min(hg.z0, hg.z1);
    const kept = contacts.filter((p) => p.z <= z0 + 0.012 && p.z >= z1 - 0.012);
    this._bakeContactAOOnWeapon(w, kept, 0.012, 0.9);
    this.armL.setPose(poseName);
  }

  /**
   * The weapon side of the same contact gradient. The handguard geometry already
   * carries wear/grime/AO masks from `bakeMasks`, so this only ever RAISES the
   * AO channel — the edge-wear and grime layers are untouched.
   */
  _bakeContactAOOnWeapon(w, contacts, radius, peak) {
    if (!contacts.length) return;
    const r2 = radius * radius;
    for (const mesh of w.meshes) {
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const col = geo.getAttribute('color');
      if (!pos || !col) continue;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        let closest = Infinity;
        for (const c of contacts) {
          const d2 = _v.distanceToSquared(c);
          if (d2 < closest) closest = d2;
        }
        if (closest > r2) continue;
        const t = 1 - Math.sqrt(closest) / radius;
        const s = t * t * t * (t * (t * 6 - 15) + 10);
        const k = i * 3 + 2;
        col.array[k] = Math.max(col.array[k], peak * s);
      }
      col.needsUpdate = true;
    }
  }

  setActive(id) {
    const w = this.weapons.get(id);
    if (!w || w === this.active) return this.active;
    if (this.active) this.active.group.visible = false;
    this.active = w;
    w.group.visible = true;
    this.recPos.reset();
    this.recRot.reset();
    this.settle.reset();
    this.boltCycle = 0;
    this.boltHold = 0;
    this.magInHand = 0;
    this.magVisible = true;
    this.armR.setPose('grip');
    // The FITTED clamp for this weapon, not the authored one — see _fitSupportHand.
    this.armL.setPose(w.lhandPose ?? (id === 'pistol' ? 'cup' : 'clamp'));
    return w;
  }

  /* ====================================================================== */
  /*  clip playback                                                         */
  /* ====================================================================== */

  play(name) {
    const w = this.active;
    if (!w) return 0;
    const clip = w.clips[name];
    if (!clip) return 0;
    this.clip = clip;
    this.clipT = 0;
    this.clipPrevT = -1;
    return clip.duration;
  }

  stopClip() {
    this.clip = null;
    this.clipResult.active = false;
    this.clipResult.lhand.weight = 0;
  }

  get clipPlaying() {
    return this.clip !== null;
  }

  get clipName() {
    return this.clip?.name ?? null;
  }

  /* ====================================================================== */
  /*  impulses                                                              */
  /* ====================================================================== */

  /**
   * Per-shot viewmodel kick. `pitch`/`yaw` are the aim-space recoil for this
   * shot (from the deterministic pattern) so the visual climb matches where the
   * bullets are actually going.
   */
  addRecoil(pitch, yaw, first = false) {
    const w = this.active;
    if (!w) return;
    const r = w.def.recoil;
    const ads = this.adsT;
    // Aiming braces the weapon: less travel, faster return.
    const scale = lerp(1, 0.54, ads) * (first ? 1.18 : 1);
    const jitter = 0.86 + this.rng.float() * 0.3;
    this.recPos.f = r.freq;
    this.recPos.z = r.damping;
    this.recRot.f = r.freq * 0.92;
    this.recRot.z = r.damping;
    // A velocity impulse of v0 on a spring of angular frequency w peaks at
    // roughly v0/w, so the kick amplitudes below are in real metres/radians.
    const wp = TAU * this.recPos.f;
    const wr = TAU * this.recRot.f;
    this.recPos.kick(
      this.rng.signed() * r.kickBack * 0.2 * scale * wp,
      r.kickUp * scale * jitter * wp,
      r.kickBack * scale * jitter * wp
    );
    this.recRot.kick(
      (pitch * 5.5 + r.pitch * 1.4) * scale * jitter * wr,
      (-yaw * 4.5 - this.rng.signed() * r.yaw * 0.8) * scale * wr,
      (this.rng.signed() * 0.4 + 0.6) * r.roll * scale * wr
    );
    // Slow settling drift after a burst — the muzzle keeps wandering a little.
    const ws = TAU * this.settle.f;
    this.settle.kick(
      this.rng.signed() * 0.0012 * scale * ws,
      0.0018 * scale * ws,
      this.rng.signed() * 0.003 * scale * ws
    );
    this.boltCycle = 1;
  }

  jump() {
    this.jumpSpring.kick(-1.2);
  }

  land(speed = 3) {
    this.landSpring.kick(clamp(speed * 0.45, 0.4, 3.4));
  }

  /* ====================================================================== */
  /*  frame update                                                          */
  /* ====================================================================== */

  /**
   * @param {number} dt
   * @param {object} s  { ads, sprint, lowReady, speed, crouch, airborne,
   *                      trigger, empty, cycleTime }
   */
  update(dt, s) {
    const w = this.active;
    if (!w) return;
    const def = w.def;
    // Defensive: a non-positive or absurd dt would integrate the whole
    // animation stack backwards (a negative step snaps ADS straight to 1).
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;

    /* -------- camera-relative anchor ---------------------------------- */
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    if (this.trackCamera) {
      cam.updateMatrixWorld();
      this.anchor.position.setFromMatrixPosition(cam.matrixWorld);
      this.anchor.quaternion.setFromRotationMatrix(cam.matrixWorld);
      // Keep the viewmodel camera coincident with the world camera: the renderer
      // uses that to decide the gun can share the world's shadow cascades.
      vcam.position.copy(this.anchor.position);
      vcam.quaternion.copy(this.anchor.quaternion);
    }

    /* -------- angular velocity for the lag layer ---------------------- */
    _e.setFromQuaternion(this.anchor.quaternion, 'YXZ');
    const yaw = _e.y;
    const pitch = _e.x;
    if (this._hasPrev && dt > 1e-5) {
      const dy = wrapPi(yaw - this._prevYaw) / dt;
      const dp = wrapPi(pitch - this._prevPitch) / dt;
      // Low-pass, then clamp: a teleport must not throw the gun off screen.
      this._angVel.yaw = damp(this._angVel.yaw, clamp(dy, -9, 9), 18, dt);
      this._angVel.pitch = damp(this._angVel.pitch, clamp(dp, -9, 9), 18, dt);
    } else {
      this._angVel.yaw = 0;
      this._angVel.pitch = 0;
    }
    this._prevYaw = yaw;
    this._prevPitch = pitch;
    this._hasPrev = true;

    /* -------- blends --------------------------------------------------- */
    const adsRate = 1 / Math.max(0.05, def.adsTime);
    const wantAds = this.clip && this.clip.name !== 'draw' ? 0 : s.ads ? 1 : 0;
    this.adsTarget = wantAds;
    // Linear rate with a smootherstep shaping: a spring here reads as mushy.
    this.adsT = clamp01(this.adsT + (wantAds ? adsRate : -adsRate * 1.25) * dt);
    const ads = smootherstep(0, 1, this.adsT);

    const sprintTarget = s.sprint && !this.clip ? 1 : 0;
    this.sprintT = damp(this.sprintT, sprintTarget, 9, dt);
    this.lowReadyT = damp(this.lowReadyT, s.lowReady ? 1 : 0, 8, dt);

    this.triggerTarget = s.trigger ? 1 : 0;
    this.triggerT = damp(this.triggerT, this.triggerTarget, 26, dt);

    /* -------- base pose ------------------------------------------------ */
    const hipP = def.hipPos;
    const hipR = def.hipRot;
    this._basePos.set(hipP[0], hipP[1], hipP[2]);
    _e.set(hipR[0], hipR[1], hipR[2], 'XYZ');
    this._baseQuat.setFromEuler(_e);

    // Sprint / low-ready poses replace the hip pose.
    if (this.sprintT > 1e-3) {
      const p = def.sprintPos;
      const r = def.sprintRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.sprintT);
      this._baseQuat.slerp(this._tmpQuat, this.sprintT);
    }
    if (this.lowReadyT > 1e-3) {
      const p = def.lowReadyPos;
      const r = def.lowReadyRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.lowReadyT);
      this._baseQuat.slerp(this._tmpQuat, this.lowReadyT);
    }

    /* -------- ADS pose: solved, not authored --------------------------- */
    if (ads > 1e-4) {
      const cant = def.adsCant;
      _e.set(cant[0], cant[1], cant[2], 'XYZ');
      this._adsQuat.setFromEuler(_e);
      // sight point in rig space, then the translation that lands it on axis
      this._sightLocal.copy(w.sight).applyQuaternion(this._adsQuat);
      this._adsPos.set(0, 0, -def.eyeRelief).sub(this._sightLocal);
      this._basePos.lerp(this._adsPos, ads);
      this._baseQuat.slerp(this._adsQuat, ads);
    }

    /* -------- additive layers ------------------------------------------ */
    const swayScale = def.swayScale * lerp(1, 0.22, ads) * lerp(1, 1.5, this.sprintT);
    this.noiseT += dt;
    const n = this.noise;
    const nr = this.noiseRates;
    const t = this.noiseT;
    // Layered, incommensurate rates: the pattern does not repeat in a session.
    const swayX = n[0].fbm(t * nr[0], 3) * 0.55 + n[3].fbm(t * nr[3] * 2.3, 2) * 0.45;
    const swayY = n[1].fbm(t * nr[1], 3) * 0.55 + n[4].fbm(t * nr[4] * 2.1, 2) * 0.45;
    const swayZ = n[2].fbm(t * nr[2], 2) * 0.6 + n[5].fbm(t * nr[5] * 1.7, 2) * 0.4;
    // Breathing: a slow 0.22 Hz cycle under the noise.
    const breath = Math.sin(t * 1.38) * 0.5 + Math.sin(t * 0.61 + 1.1) * 0.25;

    let px = swayX * 0.0075 * swayScale;
    let py = (swayY * 0.006 + breath * 0.0022) * swayScale;
    let pz = swayZ * 0.004 * swayScale;
    let rx = (swayY * 0.021 + breath * 0.006) * swayScale;
    let ry = swayX * 0.028 * swayScale;
    let rz = swayZ * 0.017 * swayScale;

    /* -------- movement bob --------------------------------------------- */
    const speed = s.speed ?? 0;
    const bobAmt =
      def.bobScale * clamp01(speed / 4.2) * lerp(1, 0.28, ads) * (s.airborne ? 0.25 : 1);
    if (speed > 0.05) {
      // Stride frequency scales with speed; sprint takes longer strides.
      this.bobPhase += dt * (3.1 + speed * 0.72) * (s.sprint ? 1.05 : 1);
      if (this.bobPhase > TAU * 64) this.bobPhase -= TAU * 64;
    }
    const bp = this.bobPhase;
    px += Math.sin(bp) * 0.0165 * bobAmt;
    py += (Math.abs(Math.cos(bp)) - 0.6) * 0.0125 * bobAmt;
    pz += Math.sin(bp * 2) * 0.0055 * bobAmt;
    rz += Math.sin(bp) * 0.031 * bobAmt;
    rx += Math.cos(bp * 2) * 0.014 * bobAmt;
    ry += Math.sin(bp + 0.6) * 0.019 * bobAmt;

    /* -------- weapon lag ---------------------------------------------- */
    const lagScale = lerp(1, 0.42, ads);
    const av = this._angVel;
    this.lag.step(
      dt,
      clamp(-av.yaw * 0.019, -0.05, 0.05) * lagScale,
      clamp(av.pitch * 0.014, -0.04, 0.04) * lagScale,
      clamp(-Math.abs(av.yaw) * 0.006, -0.03, 0.03) * lagScale
    );
    this.lagRot.step(
      dt,
      clamp(-av.pitch * 0.075, -0.24, 0.24) * lagScale,
      clamp(av.yaw * 0.085, -0.3, 0.3) * lagScale,
      clamp(-av.yaw * 0.055, -0.2, 0.2) * lagScale
    );
    px += this.lag.x;
    py += this.lag.y;
    pz += this.lag.z;
    rx += this.lagRot.x;
    ry += this.lagRot.y;
    rz += this.lagRot.z;

    /* -------- recoil + settle ----------------------------------------- */
    this.recPos.step(dt, 0, 0, 0);
    this.recRot.step(dt, 0, 0, 0);
    this.settle.step(dt, 0, 0, 0);
    px += this.recPos.x;
    py += this.recPos.y;
    pz += this.recPos.z;
    rx += this.recRot.x + this.settle.y;
    ry += this.recRot.y + this.settle.x;
    rz += this.recRot.z + this.settle.z;

    /* -------- jump / land --------------------------------------------- */
    this.jumpSpring.step(dt, 0);
    this.landSpring.step(dt, 0);
    py -= this.landSpring.x * 0.014 + this.jumpSpring.x * 0.006;
    rx -= this.landSpring.x * 0.05;

    /* -------- clip (reload / inspect / draw) -------------------------- */
    const res = this.clipResult;
    if (this.clip) {
      this.clipT += dt;
      const c = this.clip;
      const tt = clamp(this.clipT, 0, c.duration);
      c.sample(tt, res);
      for (const ev of c.events) {
        if (ev.t > this.clipPrevT && ev.t <= tt) this.onClipEvent?.(ev.name, c.name);
      }
      this.clipPrevT = tt;
      px += res.pos[0];
      py += res.pos[1];
      pz += res.pos[2];
      rx += res.rot[0];
      ry += res.rot[1];
      rz += res.rot[2];
      if (this.clipT >= c.duration) {
        this.stopClip();
      }
    }

    /* -------- compose -------------------------------------------------- */
    this.rig.position.set(
      this._basePos.x + px,
      this._basePos.y + py,
      this._basePos.z + pz
    );
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    this.rig.quaternion.copy(this._baseQuat).multiply(_q);
    // The standalone preview harness pins the rig so the weapon can be framed
    // in its own space; everything downstream reads the composed transform.
    if (this.rigOverride) {
      this.rig.position.copy(this.rigOverride.position);
      this.rig.quaternion.copy(this.rigOverride.quaternion);
    }
    this.rig.updateMatrix();
    this.rig.updateMatrixWorld(true);

    /* -------- hands (first: the magazine can be held by one) ---------- */
    this._solveHands(w, res);

    /* -------- moving parts -------------------------------------------- */
    this._updateParts(w, dt, s, res);

    /* -------- reticle -------------------------------------------------- */
    this._updateReticle(w, ads);
    this._updateApertureMask(w, ads);

    /* -------- viewmodel FOV ------------------------------------------- */
    const fovBase = 60;
    const targetFov = fovBase * lerp(1, def.viewFov, ads);
    if (Math.abs(vcam.fov - targetFov) > 1e-3) {
      vcam.fov = targetFov;
      vcam.updateProjectionMatrix();
    }
  }

  /**
   * OPEN THE SCOPE'S SIGHT PICTURE, and only while the eye is behind it.
   *
   * The mask is a depth punch through the viewmodel, so away from the ADS eye
   * point it is a lie: the disc is 5.5 % wider than the bore, and seen from the
   * hip pose's angle its silhouette clears the tube and bites a hole out of the
   * mount, the objective and the barrel behind it. It has to be off at the hip.
   *
   * SCALED rather than switched. A visibility flip swaps a dark tube for a full
   * sight picture in one frame, in the middle of a 0.34 s raise, and the eye
   * reads that as a display glitch rather than as a scope. Growing the disc over
   * the last 40 % of the blend is the same thing a real exit pupil does as the
   * eye comes into position — the picture opens from a spot to the full field —
   * and at scale 0 the geometry is degenerate, so the hip pose costs nothing.
   */
  _updateApertureMask(w, ads) {
    const mask = w.apertureMask;
    if (!mask) return;
    const open = smootherstep(0.55, 0.95, ads);
    mask.visible = open > 0.002;
    if (mask.visible) mask.scale.set(open, open, 1);
  }

  /* ---------------------------------------------------------------------- */

  _updateParts(w, dt, s, res) {
    const p = w.parts;

    // Bolt / slide cycle: a fast rearward stroke and a slightly slower return.
    if (this.boltCycle > 0) {
      const cycle = Math.max(0.045, (w.def.cycleTime ?? 60 / w.def.rpm) * 0.62);
      this.boltCycle = Math.max(0, this.boltCycle - dt / cycle);
    }
    const cyc = this.boltCycle;
    // 1 -> 0 over the cycle: out fast, back with a small bounce.
    const stroke = cyc > 0.55 ? (1 - cyc) / 0.45 : cyc / 0.55;
    const clipBolt = res.active ? res.parts.bolt : 0;
    const boltOff = Math.max(stroke, this.boltHold, clipBolt * this.boltHold);

    if (p.bolt) {
      p.bolt.position.set(
        w.model.nodes.boltRest.pos[0] + w.boltTravel.x * boltOff,
        w.model.nodes.boltRest.pos[1] + w.boltTravel.y * boltOff,
        w.model.nodes.boltRest.pos[2] + w.boltTravel.z * boltOff
      );
    }
    if (p.slide) {
      p.slide.position.set(
        w.model.nodes.slideRest.pos[0] + w.slideTravel.x * boltOff,
        w.model.nodes.slideRest.pos[1] + w.slideTravel.y * boltOff,
        w.model.nodes.slideRest.pos[2] + w.slideTravel.z * boltOff
      );
    }
    if (p.charging) {
      const pull = res.active ? res.parts.charge : 0;
      const rest = w.model.nodes.chargeRest.pos;
      p.charging.position.set(
        rest[0] + w.chargePull.x * pull,
        rest[1] + w.chargePull.y * pull,
        rest[2] + w.chargePull.z * pull
      );
    }
    if (p.trigger) {
      p.trigger.rotation.x = w.triggerPull * this.triggerT;
    }
    if (p.selector) {
      p.selector.rotation.x = lerp(-0.95, 0, clamp01(this.selectorLive ?? 1));
    }

    // Magazine: seated, in the support hand, or hidden.
    if (p.magazine) {
      const inHand = res.active ? res.parts.mag : 0;
      this.magVisible = res.active ? res.parts.magVisible : true;
      p.magazine.visible = this.magVisible;
      if (inHand > 1e-4) {
        // Follow the support hand: the magazine is gripped by its spine.
        this._magFromHand(w, p.magazine, inHand);
      } else {
        p.magazine.position.copy(w.magSeatPos);
        p.magazine.quaternion.copy(w.magSeatQuat);
      }
    }
  }

  _magFromHand(w, magGroup, weight) {
    // The hand target is a WRIST in weapon space, so the magazine has to be
    // offset into the palm (about 62 mm along the hand's -Z, the metacarpal
    // axis) before the along-the-magazine offset — otherwise the mag is gripped
    // by thin air behind the hand.
    _q.copy(this._handQuatL);
    _v.copy(this._handPosL);
    _v2.set(0, w.magLen * 0.62, -0.062).applyQuaternion(_q);
    _v.add(_v2);
    magGroup.position.lerpVectors(w.magSeatPos, _v, weight);
    _q2.copy(w.magSeatQuat).slerp(_q, weight);
    magGroup.quaternion.copy(_q2);
  }

  _solveHands(w, res) {
    // Shoulders are body-fixed: express the camera-space anchor in rig space.
    _q.copy(this.rig.quaternion).invert();
    _v.copy(this.shoulderR).sub(this.rig.position).applyQuaternion(_q);
    this.armR.shoulder.copy(_v);
    _v.copy(this.shoulderL).sub(this.rig.position).applyQuaternion(_q);
    this.armL.shoulder.copy(_v);

    // ---- shooting hand: welded to the grip ----
    const gR = w.gripR;
    this._handPos.fromArray(gR.pos);
    handBasis(this._handQuat, gR.finger ?? [0, -0.35, -0.94], gR.back ?? [0.95, 0.25, 0.18]);
    this.armR.solve(this._handPos, this._handQuat);
    this.armR.setTrigger(this.triggerT);

    // ---- support hand: grip, or wherever the clip puts it ----
    const gL = w.gripL;
    let pos = gL.pos;
    let finger = gL.finger ?? [0.82, 0.5, -0.28];
    let back = gL.back ?? [-0.5, 0.32, -0.8];
    let pose = w.lhandPose ?? (w.id === 'pistol' ? 'cup' : 'clamp');
    if (res.active && res.lhand.weight > 0.5) {
      pos = res.lhand.pos;
      finger = res.lhand.finger;
      back = res.lhand.back;
      pose = res.lhand.pose;
    }
    this._handPosL.set(pos[0], pos[1], pos[2]);
    handBasis(this._handQuatL, finger, back);
    if (pose !== this.armL.pose) this.armL.setPose(pose);
    this.armL.solve(this._handPosL, this._handQuatL);
  }

  /**
   * The collimated dot.
   *
   * A red dot sight is a collimator: the reticle sits at optical infinity along
   * the tube axis, so its apparent direction from the eye is the tube axis —
   * independent of where the eye is. Reproducing that exactly (rather than
   * gluing a sprite to the glass) is why the dot stays on target while the
   * weapon sways, and why it vignettes out when you look through the tube from
   * an angle.
   */
  _updateReticle(w, ads) {
    const optic = w.optic;
    if (!optic) {
      this.reticle.visible = false;
      return;
    }
    // Optic axis and lens centre, both in camera space. The weapon group is a
    // child of the rig which is a child of the anchor, so camera space is just
    // the rig transform applied to the weapon-local values — no inverses, no
    // allocation.
    _v.fromArray(optic.center).applyQuaternion(this.rig.quaternion).add(this.rig.position);
    _v3.set(0, 0, -1).applyQuaternion(this.rig.quaternion).normalize();

    // Where the axis ray from the eye crosses the lens plane.
    const axisS = _v.dot(_v3);
    if (axisS <= 0.02) {
      this.reticle.visible = false;
      return;
    }
    _v2.copy(_v3).multiplyScalar(axisS); // foot of the perpendicular from the lens
    // Vignette: how far off the lens centre the apparent dot lands. Measured on
    // the optic's own plane, so it is the true off-axis distance whatever plane
    // the geometry ends up drawn on below.
    const offX = _v2.x - _v.x;
    const offY = _v2.y - _v.y;
    const off = Math.hypot(offX, offY);
    const apertureR = optic.apertureR ?? 0.01;
    // Eye-to-lens distance, captured BEFORE the lookAt below reuses `_v`.
    const lensDist = Math.max(1e-4, _v.length());
    /**
     * WHICH PLANE THE GEOMETRY SITS ON IS FREE, and on a masked optic it has to
     * move. A collimated reticle's apparent DIRECTION is the tube axis at any
     * distance — every size term below is `s * angle`, so pulling the plane in
     * and shrinking the geometry by the same factor is a no-op on screen. But the
     * plane that the optic's own centre projects to is 151 mm out, and the
     * aperture mask writes depth at 103 mm, so a scope's crosshair drawn on it is
     * depth-rejected by the very disc that opens the sight picture. The mask sits
     * `mask.z - center.z` further back along the axis in weapon space, so its own
     * plane is exact rather than guessed at; 92 % of it clears the mask and still
     * lands behind nothing but air. Unmasked optics keep the original plane.
     */
    const s = optic.mask
      ? Math.min(axisS, (axisS - (optic.mask.z - optic.center[2])) * 0.92)
      : axisS;
    _v2.copy(_v3).multiplyScalar(s);
    let alpha = 1 - smootherstep(apertureR * 0.5, apertureR * 1.05, off);
    alpha *= lerp(0.55, 1, ads); // brighter once the eye is behind the glass

    if (alpha <= 0.01) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.copy(_v2);
    this.reticle.lookAt(this.anchor.getWorldPosition(_v));

    const crosshair = optic.reticle === 'crosshair';
    this.dotGroup.visible = !crosshair;
    this.crossGroup.visible = crosshair;
    if (crosshair) {
      /**
       * A SCOPE'S RETICLE IS FIXED TO THE GLASS, not to a legibility budget.
       *
       * The dot below cheats its angular size upward as the eye comes into the
       * sight, because a geometrically honest 2 MOA emitter is a dead subpixel.
       * A duplex crosshair cannot cheat the same way and must not: its posts are
       * the RANGING reference, so if they grew as you scoped in, the one thing
       * the reticle exists to tell you would be a lie. It is pinned to the exit
       * pupil instead — the post tips land at 84 % of the clear aperture at any
       * ADS blend, so the cross always frames the sight picture exactly.
       *
       * The geometry lives on a plane `s` metres out, so a unit of it subtends
       * 1/s; the aperture is `apertureR` at `lensDist`. Matching the two:
       *   scale * POST_OUT / s = apertureR * 0.84 / lensDist
       */
      const scale = (s * apertureR * 0.84) / (this._crossOuter * lensDist);
      this.crossGroup.scale.setScalar(scale);
      this.crossWire.material.opacity = alpha * 0.94;
      // The illuminated underlay only earns its place once the eye is behind the
      // glass; in hipfire it is a red smear on a sight nobody is looking through.
      this.crossGlow.material.opacity = alpha * 0.075 * ads;
      return;
    }

    /**
     * SIZE. Angular, so it is FOV-independent within a stance — but not constant
     * across stances, because the requirement is a fixed number of PIXELS.
     *
     * A geometrically honest 2 MOA emitter subtends 0.58 mrad, which at the
     * viewmodel camera's 0.97 mrad/px (60 deg over 1080 px) is 0.6 px: a dead
     * subpixel, which is exactly what the old 0.0012 rad dot measured as. Every
     * shipped red dot cheats this, and cheats it in the same direction — the
     * reticle is drawn at a legible size and grows as you come into the glass,
     * because that is the perceptual experience of putting your eye behind a
     * collimator. So:
     *   hipfire  0.00385 rad -> 4.0 px radius,  7.9 px dot
     *   ADS      0.00655 rad -> 7.9 px radius, 15.7 px dot   (0.83 mrad/px)
     * with the halo at 1.6x and the segmented ring at 3.2x, both scaled off the
     * same number so the reticle never changes shape.
     */
    const coreR = s * lerp(0.00385, 0.00655, ads);
    this.dotCore.scale.setScalar(coreR);
    this.dotRim.scale.setScalar(coreR);
    this.dotHalo.scale.setScalar(coreR);
    this.dotRing.scale.setScalar(coreR);
    this.dotCore.material.opacity = alpha;
    this.dotRim.material.opacity = alpha * 0.8;
    this.dotRing.material.opacity = alpha;
    // The halo is a bloom seed, not a glow: 6% at 1.6x the core radius adds ~1 px
    // of soft falloff and nothing else.
    this.dotHalo.material.opacity = alpha * 0.06;
  }

  /* ====================================================================== */
  /*  world-space queries for firing                                        */
  /* ====================================================================== */

  /** Muzzle position in WORLD space (for the flash and the shell). */
  muzzleWorld(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    out.copy(w.muzzle).applyMatrix4(w.group.matrixWorld);
    // viewScene space == world space because the anchor tracks the camera.
    return out;
  }

  ejectWorld(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    out.copy(w.eject).applyMatrix4(w.group.matrixWorld);
    return out;
  }

  ejectVelocity(out, speed = 2.6) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    out.copy(w.ejectDir).transformDirection(w.group.matrixWorld).multiplyScalar(speed);
    return out;
  }

  /** Bore direction in world space. */
  boreDir(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, -1);
    out.set(0, 0, -1).transformDirection(w.group.matrixWorld).normalize();
    return out;
  }

  dispose() {
    for (const w of this.weapons.values()) {
      for (const m of w.meshes) m.geometry.dispose();
      // Not in `meshes`: the mask is built outside the assembly (see addWeapon).
      w.apertureMask?.geometry.dispose();
    }
    this.weapons.clear();
    this.armL.dispose();
    this.armR.dispose();
    for (const g of this._reticleGeo) g.dispose();
    this.anchor.removeFromParent();
  }
}

function applyNode(obj, node) {
  obj.position.fromArray(node.pos);
  if (node.rot) obj.rotation.fromArray(node.rot);
}
