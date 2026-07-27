import * as THREE from 'three';
import { latheZ } from './geometry.js';

/**
 * First-person arms — deliberately minimal low-poly.
 *
 * The rig is the same as it always was: two bones per arm, solved analytically
 * from the hand (which is the thing the animation drives — the hands are welded
 * to the weapon, the elbows follow), articulated fingers, and a build-time
 * contact solve that wraps the support hand onto the real handguard. That is
 * what makes a hand look like it is HOLDING something, and none of it changed.
 *
 * The skin over that rig did. The previous pass chased realism — stitched
 * seams, knuckle caps, sleeve fold rings, four textured fabric/leather
 * materials — and the sum read as an uncanny half-real limb while costing ~45
 * meshes per arm and four extra texture-set bakes. This version goes the other
 * way on purpose: faceted prisms, flat shading, two untextured dark-grey
 * materials. A stylised limb the eye accepts at a glance, at a fraction of the
 * cost (~17 meshes per arm, zero texture fetches per pixel).
 *
 * Hand-local space: -Z along the fingers, +Y out of the back of the hand,
 * +X toward the thumb (a right hand; the left is mirrored).
 */

/**
 * Humerus and forearm+wrist lengths, in metres.
 *
 * Cheated 10% long over anatomy (330/300 vs 300/272). MEASURED in an earlier
 * pass: at true length the support hand's reach needs 99.5% extension, the
 * two-bone solve clamps, the elbow locks straight and the arm reads as a
 * broomstick. The longer chain bends visibly and pushes the elbow further OUT
 * of frame, not into it.
 */
const L_UPPER = 0.33;
const L_FORE = 0.3;

/* -------------------------------------------------------------------------- */
/*  geometry                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tapered faceted prism extending along -Z from the origin — the whole
 * low-poly vocabulary in one primitive.
 *
 * `rBase`/`rTip` are half-WIDTHS (the +-X face distance for a 4-sided prism);
 * `flat` squashes Y so limbs are wider than they are deep, like limbs are.
 * `rear` extends the base backwards past the origin so a hinged child stays
 * covered by its parent when the joint bends — the low-poly stand-in for the
 * rounded joint caps the old capsules had.
 */
function prism(len, rBase, rTip, opts = {}) {
  const sides = opts.sides ?? 4;
  const flat = opts.flat ?? 0.82;
  const rear = opts.rear ?? 0;
  // 4-sided: vertices sit on the axes, so faces are at 45 degrees. Pre-rotate
  // and scale the radius so the parameter is the face half-width instead.
  const k = sides === 4 ? Math.SQRT2 : 1;
  const g = new THREE.CylinderGeometry(rTip * k, rBase * k, len + rear, sides, 1, false);
  if (sides === 4) g.rotateY(Math.PI / 4);
  g.rotateX(-Math.PI / 2); // +Y (tip end) -> -Z
  g.translate(0, 0, (rear - len) / 2); // spans [rear, -len]
  g.scale(1, flat, 1);
  return g;
}

/**
 * Build one finger as three nested groups so it can curl.
 * One mesh per segment — no pads, seams or nails.
 * @returns {{root: THREE.Object3D, joints: THREE.Object3D[]}}
 */
function buildFinger(materials, spec) {
  const { lengths, radii, curl } = spec;
  const root = new THREE.Object3D();
  const joints = [];
  let parent = root;
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Object3D();
    j.rotation.x = -curl[i];
    parent.add(j);
    // The tip narrows and the base overlaps backwards into the parent segment
    // so the chain stays closed through the full curl range.
    const geo = prism(lengths[i], radii[i], radii[i + 1] * (i === 2 ? 0.66 : 0.9), {
      rear: radii[i] * 0.9,
    });
    const mesh = new THREE.Mesh(geo, materials.glove);
    j.add(mesh);
    const next = new THREE.Object3D();
    next.position.z = -lengths[i];
    j.add(next);
    parent = next;
    joints.push(j);
  }
  return { root, joints };
}

/**
 * Glove: one tapered slab for the palm, knuckles wider than the wrist.
 * The rear extension past z=0 is the cuff — it covers the sleeve/wrist seam.
 * Fingers are added as children so they can be posed per-weapon.
 */
function buildGlove(materials, opts = {}) {
  const scale = opts.scale ?? 1;
  const w = 0.044 * scale; // half-width at the knuckles (88 mm across)
  const palmLen = 0.098 * scale;
  const root = new THREE.Object3D();
  const palm = prism(palmLen, w * 0.8, w, { rear: 0.03 * scale, flat: 0.38 });
  root.add(new THREE.Mesh(palm, materials.glove));
  return root;
}

/**
 * Thumb: two segments on the +X side, angled across the grip.
 *
 * The proximal segment is the metacarpal AND the proximal phalanx — 50 mm, not
 * 38. MEASURED in an earlier pass: with an anatomical 38+30 thumb the C-clamp
 * contact solve leaves the tip 13 mm off the handguard however the base is
 * aimed, because the rig has no carpometacarpal segment. 50+32 reaches.
 */
function buildThumb(materials, scale = 1, spec = THUMB) {
  const root = new THREE.Object3D();
  const j1 = new THREE.Object3D();
  root.add(j1);
  j1.add(
    new THREE.Mesh(
      prism(spec.l0 * scale, spec.r0 * scale, spec.r1 * scale * 0.95, { rear: spec.r0 * scale }),
      materials.glove
    )
  );
  const j2 = new THREE.Object3D();
  j2.position.z = -spec.l0 * scale;
  j1.add(j2);
  j2.add(
    new THREE.Mesh(
      prism(spec.l1 * scale, spec.r1 * scale, spec.r2 * scale * 0.7, { rear: spec.r1 * scale * 0.9 }),
      materials.glove
    )
  );
  return { root, joints: [j1, j2] };
}

/** Thumb dimensions, shared by the mesh and the contact solve. */
const THUMB = { l0: 0.05, l1: 0.032, r0: 0.0115, r1: 0.0102, r2: 0.0078 };

/**
 * Sleeve: a closed 8-sided tapered tube. Eight flats are the point — the
 * facets ARE the read, and they carry the silhouette that fold rings and
 * wrinkle ridges used to. The fore sleeve gets a hard cuff step at the wrist
 * so the arm terminates instead of melting into the glove.
 */
function buildSleeve(material, len, r0, r1, opts = {}) {
  const profile = [
    [-r0 * 0.5, 0],
    [-r0 * 0.4, r0 * 0.9],
    [len * 0.14, r0],
    [len * 0.55, (r0 + r1) * 0.52],
  ];
  if (opts.cuff) {
    profile.push(
      [len - 0.034, r1 * 1.02],
      [len - 0.03, r1 * 1.16],
      [len - 0.006, r1 * 1.12],
      [len, r1 * 0.85],
      [len, 0]
    );
  } else {
    // Blunt, slightly overshot tip: joint mass that keeps the elbow covered
    // through the solve's bend range.
    profile.push([len * 0.94, r1], [len + r1 * 0.7, r1 * 0.8], [len + r1 * 0.9, 0]);
  }
  const g = latheZ(profile, 8);
  g.scale(1, 0.9, 1);
  g.rotateY(Math.PI); // extend along -Z, like the bones
  return new THREE.Mesh(g, material);
}

/* -------------------------------------------------------------------------- */
/*  arm rig                                                                   */
/* -------------------------------------------------------------------------- */

const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _up = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();
// contact-fit scratch (build time only, but the no-allocation rule holds anyway)
const _fitInv = new THREE.Matrix4();
const _fitP = new THREE.Vector3();
const _fitD = new THREE.Vector3();
const _fitAxis = new THREE.Vector3();
const _fitAx0 = new THREE.Vector3();

/**
 * Orient a bone whose geometry runs along its local -Z so that -Z points along
 * `dir`, with local +Y rolled toward `up`.
 *
 * This deliberately does NOT use Object3D.lookAt(): for non-camera objects
 * lookAt aims local **+Z** at the target (so a -Z bone would point backwards),
 * and it interprets the target in WORLD space, which is wrong here because
 * every joint position is authored in the rig's local space.
 */
function aimBone(quat, dir, up) {
  _bz.copy(dir).multiplyScalar(-1).normalize(); // local +Z is opposite the bone
  _by.copy(up);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-9) {
    // Degenerate roll reference: pick any axis that is not parallel to the bone.
    _by.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
    if (_by.lengthSq() < 1e-9) _by.set(1, 0, 0).addScaledVector(_bz, -_bz.x);
  }
  _by.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _bm.makeBasis(_bx, _by, _bz);
  return quat.setFromRotationMatrix(_bm);
}

/**
 * One arm: shoulder -> upper -> fore -> hand, solved from the hand target.
 * All positions are expressed in the arm root's parent space (the viewmodel
 * rig's space), which is what makes the maths trivial.
 */
export class Arm {
  constructor(side, materials, opts = {}) {
    this.side = side; // -1 left, +1 right
    this.scale = opts.scale ?? 1;
    this.l1 = (opts.upper ?? L_UPPER) * this.scale;
    this.l2 = (opts.fore ?? L_FORE) * this.scale;

    this.root = new THREE.Object3D();
    this.root.name = side < 0 ? 'arm-left' : 'arm-right';

    this.shoulder = new THREE.Vector3(
      side * (opts.shoulderX ?? 0.19),
      opts.shoulderY ?? -0.19,
      opts.shoulderZ ?? 0.12
    );
    /**
     * Elbow swing direction, in the ARM ROOT's space (= the viewmodel rig's
     * space), NOT in hand space.
     *
     * Expressing the pole in hand space is the intuitive choice and it is wrong:
     * the support hand is rolled palm-up on the handguard, so its local "down"
     * points at the sky and the elbow swings UP — straight through the near
     * plane, filling half the screen with forearm. Elbows go down and outboard,
     * always, exactly as they do on a real shooter.
     */
    this.pole = new THREE.Vector3(side * 0.46, -0.86, 0.22).normalize();

    // Bones. Geometry extends along -Z from each joint. Radii are the measured
    // combat-shirt values from the previous pass (68 mm elbow / 48 mm wrist on
    // the support arm) — the silhouette that survived the tube-width critique.
    this.upper = buildSleeve(materials.sleeve, this.l1, 0.044 * this.scale, 0.036 * this.scale);
    this.fore = buildSleeve(materials.sleeve, this.l2, 0.034 * this.scale, 0.024 * this.scale, {
      cuff: true,
    });
    this.upperPivot = new THREE.Object3D();
    this.forePivot = new THREE.Object3D();
    this.upperPivot.add(this.upper);
    this.forePivot.add(this.fore);
    this.root.add(this.upperPivot);
    this.root.add(this.forePivot);

    // Hand.
    this.hand = new THREE.Object3D();
    this.hand.name = side < 0 ? 'hand-left' : 'hand-right';
    this.handInner = new THREE.Object3D();
    /**
     * CHIRALITY. The basis built by handBasis is right-handed with X = Y cross Z,
     * so for a hand whose fingers run along -Z and whose palm faces -Y, +X points
     * AWAY from the thumb on a right hand and TOWARD it on a left hand. The
     * geometry below puts the thumb at +X, which makes the authored mesh a LEFT
     * hand — so it is the RIGHT arm that needs the mirror, not the left.
     *
     * With this the wrong way round the shooting hand was a left hand on the
     * right side of the grip: the index (which setTrigger drives) came out at the
     * bottom-rear of the grip instead of on the trigger, and no choice of target
     * frame could fix it, because putting the thumb at the top of the grip forced
     * the fingers to wrap backwards around the back strap.
     */
    this.handInner.scale.x = side < 0 ? 1 : -1;
    this.hand.add(this.handInner);
    this.glove = buildGlove(materials, { scale: this.scale });
    this.handInner.add(this.glove);
    this.root.add(this.hand);

    // Fingers: index is separate so it can work the trigger.
    const fingerSpecs = [
      { x: 0.0298, len: [0.045, 0.028, 0.022], r: [0.0102, 0.0096, 0.0086, 0.0062] }, // index
      { x: 0.0102, len: [0.049, 0.031, 0.023], r: [0.0104, 0.0098, 0.0088, 0.0064] },
      { x: -0.0104, len: [0.046, 0.029, 0.022], r: [0.01, 0.0094, 0.0084, 0.006] },
      { x: -0.0298, len: [0.038, 0.024, 0.02], r: [0.0092, 0.0086, 0.0078, 0.0056] },
    ];
    this.fingers = [];
    // Per-segment dimensions, kept so `fitToCylinder` can walk the chain without
    // re-deriving them.
    this._segRadius = fingerSpecs.map((s) => s.r.map((v) => v * this.scale));
    this._segLength = fingerSpecs.map((s) => s.len.map((v) => v * this.scale));
    for (let i = 0; i < 4; i++) {
      const sp = fingerSpecs[i];
      const f = buildFinger(materials, {
        lengths: sp.len.map((v) => v * this.scale),
        radii: sp.r.map((v) => v * this.scale),
        curl: [0, 0, 0],
      });
      // The metacarpophalangeal joints sit on the PALMAR half of the hand, not on
      // its centre line — -6 mm puts the finger axis one finger radius off the
      // palm's contact plane, so a palm flush on a handguard closes the fingers
      // onto it instead of leaving them hovering.
      f.root.position.set(sp.x * this.scale, -0.006 * this.scale, -0.096 * this.scale);
      // fingers fan out very slightly
      f.root.rotation.y = -sp.x * 2.2;
      this.glove.add(f.root);
      this.fingers.push(f);
    }
    this.thumb = buildThumb(materials, this.scale, THUMB);
    // The carpometacarpal joint is palmar and a little further into the hand than
    // the hand's centre plane: a thumb rooted on the centre plane rotates in the
    // plane of the back of the hand and reads as a spur.
    this.thumb.root.position.set(0.037 * this.scale, -0.009 * this.scale, -0.04 * this.scale);
    this.thumb.root.rotation.set(0.2, -0.95, -0.5);
    this.glove.add(this.thumb.root);

    // Same rule as the weapon: receive the world sun shadow, cast nothing.
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });

    /**
     * Per-weapon pose overrides, written by `fitToCylinder`. `setPose` looks here
     * first, so a pose solved against one weapon's handguard cannot leak onto
     * another's — and, critically, a clip that swaps the support hand to 'open'
     * and back to 'clamp' restores the FITTED clamp, not the authored one.
     */
    this.poses = {};

    this.setPose(opts.pose ?? 'wrap');
  }

  /**
   * BUILD-TIME CONTACT SOLVE: clamp every fingertip onto a cylinder.
   *
   * The authored `clamp` curls were derived analytically and left the distal
   * segments visibly standing clear of the handguard, because the analytic
   * solve ignored the flattened finger sections, the palmar MCP offset, the
   * fan-out rotation on each finger root and the fact that four fingers meet
   * the cylinder at four different clock angles. So MEASURE instead: pose the
   * hand, walk the real transform chain to each fingertip's contact patch, and
   * search the joint's own rotation for the value that lands the patch on the
   * surface. Exact by construction, because it uses the same matrices the
   * renderer will.
   *
   * The thumb is fitted the same way but wraps to the OPPOSITE side of the tube:
   * a C-clamp whose thumb is on the same side as the fingers is a fist held next
   * to the gun, not a grip on it.
   *
   * @param {THREE.Vector3}  handPos    wrist target, arm-root space
   * @param {THREE.Quaternion} handQuat wrist orientation
   * @param {number[]} axisPoint  a point on the cylinder axis, arm-root space
   * @param {number[]} axisDir    the cylinder axis direction
   * @param {number}   radius     cylinder radius
   * @param {object}   opts       { clearance, poseName }
   * @returns {THREE.Vector3[]}   contact points, arm-root space
   */
  fitToCylinder(handPos, handQuat, axisPoint, axisDir, radius, opts = {}) {
    const clearance = opts.clearance ?? 0.001;
    const poseName = opts.poseName ?? this.pose;
    const base = this.poses[poseName] ?? HAND_POSES[poseName] ?? HAND_POSES.clamp;

    this.hand.position.copy(handPos);
    this.hand.quaternion.copy(handQuat);
    this.root.updateMatrixWorld(true);
    // Everything is measured in the ARM ROOT's space, so the result is
    // independent of wherever the rig happens to be this frame.
    _fitInv.copy(this.root.matrixWorld).invert();
    _fitAxis.set(axisDir[0], axisDir[1], axisDir[2]).normalize();
    const ax0 = _fitAx0.set(axisPoint[0], axisPoint[1], axisPoint[2]);

    /** Signed distance from a joint-local point to the cylinder surface. */
    const gapAt = (joint, lx, ly, lz, out) => {
      joint.updateWorldMatrix(true, true);
      _fitP.set(lx, ly, lz).applyMatrix4(joint.matrixWorld).applyMatrix4(_fitInv);
      if (out) out.copy(_fitP);
      _fitD.copy(_fitP).sub(ax0);
      _fitD.addScaledVector(_fitAxis, -_fitD.dot(_fitAxis));
      return _fitD.length() - radius;
    };

    /**
     * Scan a joint's flexion for the angle that puts `local` on the surface.
     *
     * A scan, not a bisection: the gap is not monotonic in curl (past ~110 deg
     * the tip starts coming back OUT the far side of the tube), so a bisection
     * can converge on the wrong root. 48 samples over the anatomical range is
     * 2.5 deg of resolution, which is 0.4 mm at the fingertip.
     */
    const fitJoint = (joint, local, lo, hi, standoff = 0) => {
      let best = joint.rotation.x;
      let bestCost = Infinity;
      for (let i = 0; i <= 48; i++) {
        const a = lo + ((hi - lo) * i) / 48;
        joint.rotation.x = a;
        const g = gapAt(joint, local[0], local[1], local[2]) - standoff;
        // Target: on the surface, up to `clearance` proud, at most 1.5 mm buried.
        const cost = Math.abs(g - clearance * 0.5) + (g < -0.0015 ? (-g - 0.0015) * 8 : 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = a;
        }
      }
      joint.rotation.x = best;
      return best;
    };

    /**
     * Wrap all three joints, PROXIMAL FIRST.
     *
     * Fitting only the distal joint cannot wrap a cylinder: if the MCP and PIP
     * are authored for a different contact clock angle the finger traces the
     * wrong spiral, and the distal joint is then asked to close a gap it is 22 mm
     * long and physically cannot reach. Solving the chain outward — each joint
     * placing the NEXT joint's origin one finger-radius off the surface, then the
     * distal joint placing the actual contact patch on it — is what a finger does,
     * and it is stable because each stage only has one degree of freedom.
     */
    const fingers = [];
    const contacts = [];
    for (let i = 0; i < 4; i++) {
      const f = this.fingers[i];
      const curl = base.fingers[i].slice();
      for (let j = 0; j < 3; j++) f.joints[j].rotation.x = -curl[j];
      const rr = this._segRadius?.[i] ?? [0.01, 0.0094, 0.0084, 0.006];
      const ll = this._segLength?.[i] ?? [0.046, 0.029, 0.022];
      for (let j = 0; j < 2; j++) {
        // The next joint's origin sits ON the finger's own axis, so it wants to
        // be one segment-radius clear of the surface, not on it.
        const a = fitJoint(f.joints[j], [0, 0, -ll[j]], -1.75, -0.05, rr[j + 1] * 0.92);
        curl[j] = -a;
      }
      // The fingertip contact patch: palmar side, one radius below the axis,
      // half way along the distal segment.
      const local = [0, -rr[3] * 1.05, -ll[2] * 0.5];
      const a2 = fitJoint(f.joints[2], local, -1.95, -0.1, 0);
      curl[2] = -a2;
      fingers.push(curl);
      const p = new THREE.Vector3();
      gapAt(f.joints[2], local[0], local[1], local[2], p);
      contacts.push(p);
    }

    /**
     * ---- thumb: over the top and down the FAR side --------------------------
     *
     * THE THUMB BASE IS SOLVED TOO, and it has to be. The thumb's
     * carpometacarpal joint is a saddle with two useful degrees of freedom, and
     * an authored abduction aimed for a different contact clock angle leaves
     * 68 mm of thumb flexing on two hinges that simply cannot reach the tube —
     * the scan just parks both joints at their limits, 13 mm off the surface.
     * So the base's across-the-palm and off-the-palm axes are scanned first,
     * coarsely, for the aim that brings a mid-flexed tip closest, and only then
     * are the two flexion joints fitted. Build time only.
     */
    const thumbBase = (base.thumbBase ?? [0, 0, 0]).slice();
    const thumb = (base.thumb ?? [0.3, 0.24]).slice();
    this.thumb.root.rotation.fromArray(thumbBase);
    this.thumb.joints[0].rotation.x = -thumb[0];
    this.thumb.joints[1].rotation.x = -thumb[1];
    const tr = THUMB.r2 * this.scale;
    const tlen = THUMB.l1 * this.scale;
    const tLocal = [0, -tr * 1.05, -tlen * 0.55];
    {
      // Mid-flex the two hinges while the base is searched, so the scan measures
      // where a naturally curled thumb would land rather than where a straight
      // one would.
      this.thumb.joints[0].rotation.x = -0.55;
      this.thumb.joints[1].rotation.x = -0.45;
      const y0 = thumbBase[1];
      const z0 = thumbBase[2];
      let bestY = y0;
      let bestZ = z0;
      let bestCost = Infinity;
      for (let i = 0; i <= 20; i++) {
        const yy = y0 - 1.3 + (2.6 * i) / 20;
        for (let k = 0; k <= 14; k++) {
          const zz = z0 - 0.9 + (1.8 * k) / 14;
          this.thumb.root.rotation.y = yy;
          this.thumb.root.rotation.z = zz;
          const g = gapAt(this.thumb.joints[1], tLocal[0], tLocal[1], tLocal[2]);
          // Prefer just-touching; punish burying much harder than standing off, and
          // add a small pull toward the authored pose so the solve stays plausible.
          const cost =
            Math.abs(g - clearance) +
            (g < -0.002 ? (-g - 0.002) * 10 : 0) +
            (Math.abs(yy - y0) + Math.abs(zz - z0)) * 0.0009;
          if (cost < bestCost) {
            bestCost = cost;
            bestY = yy;
            bestZ = zz;
          }
        }
      }
      this.thumb.root.rotation.y = bestY;
      this.thumb.root.rotation.z = bestZ;
      thumbBase[1] = bestY;
      thumbBase[2] = bestZ;
    }
    const a0 = fitJoint(
      this.thumb.joints[0],
      [0, 0, -THUMB.l0 * this.scale],
      -1.45,
      -0.02,
      THUMB.r1 * this.scale
    );
    thumb[0] = -a0;
    const a1 = fitJoint(this.thumb.joints[1], tLocal, -1.6, -0.05, 0);
    thumb[1] = -a1;
    const tp = new THREE.Vector3();
    gapAt(this.thumb.joints[1], tLocal[0], tLocal[1], tLocal[2], tp);
    contacts.push(tp);

    this.poses[poseName] = { fingers, thumb, thumbBase };
    this.pose = poseName;
    return contacts;
  }

  /** Static finger poses. The trigger finger is driven separately. */
  setPose(name) {
    const P = this.poses?.[name] ?? HAND_POSES[name] ?? HAND_POSES.wrap;
    for (let i = 0; i < 4; i++) {
      const curl = P.fingers[i];
      for (let j = 0; j < 3; j++) this.fingers[i].joints[j].rotation.x = -curl[j];
    }
    this.thumb.joints[0].rotation.x = -P.thumb[0];
    this.thumb.joints[1].rotation.x = -P.thumb[1];
    if (P.thumbBase) this.thumb.root.rotation.fromArray(P.thumbBase);
    this.pose = name;
    return this;
  }

  /** Trigger-finger curl, 0 = off the trigger, 1 = fully pressed. */
  setTrigger(t) {
    const f = this.fingers[0];
    // Rest pose matches HAND_POSES.grip.fingers[0]: the finger is already ON the
    // trigger with the slack taken up, not standing off it straight.
    f.joints[0].rotation.x = -(0.55 + t * 0.3);
    f.joints[1].rotation.x = -(0.72 + t * 0.42);
    f.joints[2].rotation.x = -(0.34 + t * 0.3);
  }

  /**
   * Solve the two-bone chain so the hand lands exactly on `targetPos` with
   * orientation `targetQuat`, elbow swung toward the pole.
   */
  solve(targetPos, targetQuat) {
    this.hand.position.copy(targetPos);
    this.hand.quaternion.copy(targetQuat);

    _t.copy(targetPos).sub(this.shoulder);
    let d = _t.length();
    const maxD = (this.l1 + this.l2) * 0.995;
    const minD = Math.abs(this.l1 - this.l2) * 1.05 + 1e-4;
    if (d > maxD) {
      _t.multiplyScalar(maxD / d);
      d = maxD;
    } else if (d < minD) {
      if (d < 1e-5) _t.set(0, 0, -minD);
      else _t.multiplyScalar(minD / d);
      d = minD;
    }
    _dir.copy(_t).divideScalar(d);

    // Circle of possible elbow positions; pick the point toward the pole.
    const a = (this.l1 * this.l1 - this.l2 * this.l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, this.l1 * this.l1 - a * a));
    _pole.copy(this.pole);
    _perp.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir));
    if (_perp.lengthSq() < 1e-8) {
      _perp.set(this.side, -1, 0).addScaledVector(_dir, 0);
      _perp.addScaledVector(_dir, -_perp.dot(_dir));
    }
    _perp.normalize();
    _elbow.copy(this.shoulder).addScaledVector(_dir, a).addScaledVector(_perp, h);

    // Upper arm: shoulder -> elbow, rolled so the flat of the prism follows the
    // outside of the bend — that is the pole side.
    this.upperPivot.position.copy(this.shoulder);
    _hp.copy(_elbow).sub(this.shoulder);
    if (_hp.lengthSq() > 1e-12) aimBone(this.upperPivot.quaternion, _hp, _perp);

    // Forearm: elbow -> wrist, rolled with the back of the hand so the cuff and
    // the wrist line up with the glove.
    this.forePivot.position.copy(_elbow);
    _up.set(0, 1, 0).applyQuaternion(targetQuat);
    _hp.copy(targetPos).sub(_elbow);
    if (_hp.lengthSq() > 1e-12) aimBone(this.forePivot.quaternion, _hp, _up);
    return this;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
}

/**
 * Finger curls per pose, in radians per joint (proximal, middle, distal).
 * These are read straight off reference photos of a firing grip: the little
 * finger curls hardest, the index rides the trigger, the thumb wraps high.
 */
export const HAND_POSES = {
  /**
   * Firing grip on the pistol grip. The three lower fingers wrap ~180 deg of a
   * 31 x 34 mm grip section — with the MCP carrying the most, because that is
   * the joint that gets the finger round the front strap. The index is the
   * trigger finger and is driven separately by setTrigger(); the value here is
   * its rest pose, taking up the slack on the trigger face.
   */
  grip: {
    fingers: [
      [0.55, 0.72, 0.34],
      [1.15, 1.2, 0.62],
      [1.2, 1.25, 0.65],
      [1.22, 1.28, 0.66],
    ],
    thumb: [0.5, 0.34],
    thumbBase: [0.15, -1.02, -0.62],
  },
  /** Support hand wrapped around a handguard. */
  wrap: {
    fingers: [
      [1.18, 1.05, 0.45],
      [1.26, 1.12, 0.5],
      [1.3, 1.16, 0.55],
      [1.34, 1.2, 0.6],
    ],
    thumb: [0.42, 0.3],
    thumbBase: [0.1, -1.15, -0.35],
  },
  /**
   * C-clamp on a handguard: the modern support grip, and the only one whose
   * knuckle line turns toward the camera.
   *
   * SOLVED, per joint, against the rifle's 47 mm handguard — a uniform curl
   * ratio cannot wrap a cylinder (it traces a spiral). The distribution that
   * falls out (MCP ~0.6, PIP ~1.2, DIP ~0.8) is what a real hand does on a
   * tube: the middle joint carries most of the wrap. These are the authored
   * fallback; `fitToCylinder` re-solves them per weapon at build time.
   */
  clamp: {
    fingers: [
      [0.612, 1.059, 0.797],
      [0.731, 1.286, 0.863],
      [0.73, 1.268, 0.808],
      [0.601, 1.105, 0.684],
    ],
    // Thumb laid ACROSS the top of the handguard rather than forward into space:
    // the thumb root stands ~50 mm off the tube on a C-clamp, so a forward-
    // pointing thumb hangs in mid-air. Aimed at the tube it bridges the gap and
    // closes the silhouette.
    thumb: [0.3, 0.24],
    thumbBase: [0.04, 0.76, -0.05],
  },
  /** Two-handed pistol grip: support hand cups the shooting hand. */
  cup: {
    fingers: [
      [1.05, 0.95, 0.4],
      [1.12, 1.0, 0.44],
      [1.16, 1.04, 0.48],
      [1.2, 1.08, 0.52],
    ],
    thumb: [0.28, 0.2],
    thumbBase: [0.0, -1.25, -0.2],
  },
  /** Open hand: mag grab, charging handle, inspect. */
  open: {
    fingers: [
      [0.35, 0.28, 0.14],
      [0.32, 0.26, 0.12],
      [0.34, 0.28, 0.14],
      [0.4, 0.32, 0.16],
    ],
    thumb: [0.12, 0.1],
    thumbBase: [0.1, -0.8, -0.35],
  },
  /** Pinch: holding the charging handle or a magazine by its spine. */
  pinch: {
    fingers: [
      [0.95, 0.85, 0.55],
      [1.0, 0.9, 0.6],
      [0.7, 0.6, 0.35],
      [0.6, 0.5, 0.3],
    ],
    thumb: [0.62, 0.55],
    thumbBase: [0.25, -0.75, -0.7],
  },
};
