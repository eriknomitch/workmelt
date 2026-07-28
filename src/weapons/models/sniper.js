import { Assembly, box, extrude, roundRect, latheZ, rodZ, mergeAll } from '../geometry.js';
import {
  addBarrel,
  addMuzzleDevice,
  addHandguard,
  addRail,
  addPistolGrip,
  addChassisStock,
  addBipod,
  addQdSocket,
  addSlingLoop,
  addScrew,
  addRollmark,
  buildMagazine,
  buildOptic,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The bolt-action marksman rifle — an AI AX / L115-flavoured .338 on an
 * aluminium chassis: heavy fluted barrel, side-baffle brake, folded bipod, a
 * skeleton chassis stock with an adjustable comb, and a 3.3x tube scope in a
 * one-piece mount.
 *
 * WHY IT IS BUILT SEPARATELY AND NOT AS A LONG CARBINE.
 *
 * Three silhouette facts carry "sniper" at the 40-60 px of screen width the
 * rear half of a weapon occupies in hipfire, and a stretched M4 has none of
 * them:
 *
 *   1. THE BOLT HANDLE. A 45 mm shaft with a ball knob standing out of the
 *      right flank of the action, level with the shooter's eye in ADS. It is
 *      the single most recognisable feature on the class and it is a MOVING
 *      part here — it is thrown on every shot (see boltTravel), which is what
 *      sells the 1.2 s cycle as mechanical rather than as a cooldown.
 *   2. THE THUMBHOLE. `addChassisStock` cuts a hole clean through the stock.
 *      Nothing else in the game's silhouette vocabulary has one.
 *   3. THE OBJECTIVE BELL. A 56 mm front lens on a 35 mm tube, hooded, and the
 *      scope is 105 mm long against the carbine red dot's 52 mm.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.078
 *   rail deck        y = +0.108   (30 mm over bore, one continuous rail)
 *   optic centre     y = +0.173   (95 mm over bore — see the note on `opticY`)
 *   action           z = +0.088 .. -0.152
 *   chassis forend   z = -0.156 .. -0.512
 *   muzzle crown     z = -0.660
 *   butt pad         z = +0.272
 * Overall 932 mm, 25 % longer than the carbine's 747 mm.
 */
export function buildSniper() {
  const bore = 0.078;
  const rAction = 0.021;
  const railTop = bore + 0.03;
  const zActionRear = 0.088;
  const zActionFront = -0.152;
  const portZ = -0.016;
  const magZ = -0.062;
  const magTilt = 0.03;
  const hgZ0 = -0.156;
  const hgZ1 = -0.512;
  const hgR = 0.0265;
  const zBreech = -0.115;
  const zBarrelEnd = -0.598;
  /**
   * 95 mm over bore, and the number is set by what the SIGHT PICTURE must not
   * contain, not by the ring height a 56 mm bell needs (that is 62 mm).
   *
   * The optic is a literal tube here, so anything inside the cone from the eye
   * through the objective bore is visible in ADS — including the weapon's own
   * muzzle, which is 660 mm downrange and `opticY - 0.093` below the axis. At
   * 88 mm the brake subtended 0.105 against a 0.118 clear aperture and sat as a
   * lit lump inside the bottom of the glass; at 95 mm it is 0.113, i.e. pushed
   * out to 96 % of the field radius where the tube vignette eats it. (The
   * carbine has the same geometry and the same margin — see models/rifle.js.)
   */
  const opticY = bore + 0.095;
  const opticZ = -0.052;
  const handZ = -0.222;

  const body = new Assembly('sniper-body');

  /* ---- action: a flat-sided billet, not an alloy tube ------------------ */
  /**
   * THE ACTION IS `alu`, AND THE FIRST ATTEMPT AT `steel_black` IS WHY.
   *
   * A bolt action really is a machined steel receiver bedded into an aluminium
   * chassis, which is the reverse of the AR's alloy-receiver/steel-barrel split,
   * and building it that way was the whole idea: the same three material classes
   * arranged differently, so the two rifles read as different weapons at 40 px.
   *
   * Measured in the hipfire frame it produced the exact defect the carbine's
   * material notes are about. `steel_black` is a METAL — no albedo, only an F0 —
   * and the action's flank is a 240 x 42 mm flat slab presented almost edge-on
   * to the eye and sitting right in the viewmodel rim light's reflection path.
   * It rendered as a cream-white bar down the middle of the frame: "unpainted
   * MDF", the same read the optic bezel and the charging handle both had to be
   * moved off metal to cure. The `alu` class exists for precisely this — it is a
   * dielectric oxide and takes the specular clamp (see materials.js) — and the
   * chamfer wear mask puts bare aluminium back on the corners where a receiver
   * actually polishes through.
   *
   * The class contrast survives anyway, because it was never really about the
   * receiver: the barrel here is 480 mm of exposed `steel` against the carbine's
   * 90 mm, and that is the read.
   */
  const actionLen = zActionRear - zActionFront;
  const actionBody = box(rAction * 2 - 0.0025, 0.042, actionLen, 0.0022, 2);
  body.add(actionBody, 'alu', { y: bore - 0.002, z: (zActionRear + zActionFront) / 2 });
  actionBody.dispose();
  // Round bolt raceway on top of the flats — the part the bolt actually runs in.
  const raceway = latheZ(
    [
      [0, 0],
      [0, rAction * 0.97],
      [0.0022, rAction],
      [actionLen - 0.004, rAction],
      [actionLen, rAction * 0.9],
      [actionLen, 0],
    ],
    24
  );
  body.add(raceway, 'alu', { y: bore, z: zActionRear, ry: Math.PI });
  raceway.dispose();
  // Recoil lug / bedding block under the action, into the chassis.
  const lug = box(rAction * 2 + 0.004, 0.014, 0.03, 0.0016, 2);
  body.add(lug, 'alu', { y: bore - 0.026, z: -0.096 });
  lug.dispose();
  addScrew(body, 'steel', 0, bore - 0.033, -0.096, 0.0038, 'y', 0.012);
  addScrew(body, 'steel', 0, bore - 0.033, 0.052, 0.0038, 'y', 0.012);

  // Ejection port, right flank, with the loading port ahead of it.
  const portW = 0.052;
  const portH = 0.021;
  const cav = box(0.012, portH, portW, 0.0009, 1);
  body.add(cav, 'cavity', { x: rAction - 0.007, y: bore + 0.003, z: portZ, ry: Math.PI / 2 });
  cav.dispose();
  const lip = extrude(roundRect(portW + 0.005, portH + 0.005, 0.0025, 3), 0.0022, {
    bevel: 0.0006,
    holes: [roundRect(portW, portH, 0.002, 3)],
  });
  body.add(lip, 'alu', { x: rAction - 0.0016, y: bore + 0.003, z: portZ, ry: Math.PI / 2 });
  lip.dispose();

  // Rear tang + two-position safety catch, behind the bolt shroud.
  const tang = extrude(
    [
      [-0.016, 0],
      [0.018, -0.002],
      [0.019, -0.014],
      [-0.016, -0.012],
    ],
    rAction * 1.6,
    { bevel: 0.001 }
  );
  body.add(tang, 'alu', { y: bore - 0.012, z: zActionRear + 0.014, ry: Math.PI / 2 });
  tang.dispose();
  const safety = extrude(
    [
      [-0.009, -0.0028],
      [0.011, -0.0034],
      [0.012, 0.0034],
      [-0.009, 0.0028],
    ],
    0.0036,
    { bevel: 0.0006 }
  );
  // Nitrided, not bright: in ADS the eye is 100 mm from this and a bright
  // 20 mm lever is the same near-field blowout the carbine's rear BUIS was.
  body.add(safety, 'steel_black', {
    x: 0.0122,
    y: bore + 0.008,
    z: zActionRear + 0.01,
    ry: Math.PI / 2,
    rz: 0.2,
  });
  safety.dispose();

  // Calibre rollmark on the LEFT flank of the action — the side that faces the
  // camera in the hip pose, engraved so it can never swim (see models/rifle.js).
  addRollmark(body, 'cavity', { x: -(rAction - 0.0011), y: bore + 0.012, z: -0.05, h: 0.0038 });
  addRollmark(body, 'cavity', {
    x: -(rAction - 0.0011),
    y: bore + 0.0022,
    z: -0.052,
    h: 0.0026,
    pitch: 0.0015,
    pattern: [3, 3, 8, 0, 2, 1, 3, 0, 3, 2],
  });

  /* ---- chassis: magwell, grip tang, trigger guard ---------------------- */
  const magW = 0.0305;
  const magD = 0.086;
  const chassis = box(rAction * 2 + 0.001, 0.03, 0.176, 0.0022, 2);
  body.add(chassis, 'alu', { y: bore - 0.036, z: -0.03 });
  chassis.dispose();

  const wellH = 0.042;
  const well = extrude(roundRect(magW + 0.0035, magD + 0.0035, 0.006, 5), wellH, {
    bevel: 0.0013,
    holes: [roundRect(magW - 0.0022, magD - 0.0022, 0.005, 5)],
  });
  body.add(well, 'alu', { y: bore - 0.054, z: magZ, rx: Math.PI / 2 + magTilt });
  well.dispose();
  const liner = extrude(roundRect(magW - 0.0025, magD - 0.0025, 0.005, 5), wellH - 0.004, {
    bevel: 0.0006,
    holes: [roundRect(magW - 0.0058, magD - 0.0058, 0.004, 5)],
  });
  body.add(liner, 'cavity', { y: bore - 0.054, z: magZ, rx: Math.PI / 2 + magTilt });
  liner.dispose();
  const flare = extrude(roundRect(magW + 0.009, magD + 0.01, 0.007, 5), 0.008, {
    bevel: 0.0014,
    holes: [roundRect(magW + 0.001, magD + 0.001, 0.005, 5)],
  });
  body.add(flare, 'alu', { y: bore - 0.0745, z: magZ + 0.0018, rx: Math.PI / 2 + magTilt });
  flare.dispose();
  // Paddle release at the front of the magwell — an AI-pattern rifle's is a
  // lever inside the trigger guard, ahead of the trigger.
  const paddle = extrude(
    [
      [-0.014, -0.003],
      [0.012, -0.004],
      [0.013, 0.004],
      [-0.014, 0.003],
    ],
    0.005,
    { bevel: 0.0007 }
  );
  body.add(paddle, 'alu', { y: bore - 0.052, z: -0.02, rx: -0.3 });
  paddle.dispose();

  // Trigger guard: a wide loop, gloved-hand sized.
  const guardOuter = [
    [-0.03, 0],
    [0.026, 0],
    [0.028, -0.007],
    [0.024, -0.026],
    [0.012, -0.031],
    [-0.024, -0.031],
    [-0.03, -0.023],
  ];
  const guardInner = [
    [-0.0245, -0.003],
    [0.021, -0.003],
    [0.023, -0.009],
    [0.019, -0.0235],
    [0.009, -0.0275],
    [-0.0205, -0.0275],
    [-0.0245, -0.0205],
  ];
  const guard = extrude(guardOuter, 0.0175, { bevel: 0.0011, bevelSegments: 2, holes: [guardInner] });
  guard.rotateY(Math.PI / 2); // outline-X -> -Z, as in addLowerReceiver
  body.add(guard, 'alu', { y: bore - 0.05, z: 0.006 });
  guard.dispose();

  addPistolGrip(body, 'polymer', 'rubber', { y: 0.034, z: 0.016, angle: 0.34, len: 0.112, w: 0.032 });

  /* ---- barrel: heavy, fluted, free-floated ----------------------------- */
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0138,
    rBarrel: 0.0104,
    /**
     * A bolt gun has no gas block, so the profile's gas step is neutralised by
     * setting `rGas` equal to `rBarrel` — the step is there with zero height.
     *
     * `gasAt` still has to sit INSIDE the barrel. The first attempt parked it at
     * -0.9, "off the barrel", on the assumption that a step outside the extent
     * would simply not be drawn. It is a lathe profile: the four gas keys are
     * emitted at `zBreech - gasAt ± 0.012`, so they landed at axial 0.773-0.799
     * against a 0.483 m barrel, and the lathe ran out to 0.799 and folded back.
     * Measured on the preview harness's bbox: bmin.z was -0.914 against a muzzle
     * crown at -0.660 — a quarter-metre of spurious bright tube sticking out
     * past the brake. -0.36 is mid-barrel and invisible.
     */
    rGas: 0.0104,
    gasAt: -0.36,
    knurl: false,
    seg: 24,
  });
  /**
   * SIX LONGITUDINAL FLUTES. A heavy .338 barrel is fluted to lose mass without
   * losing stiffness, and the flutes are also the only thing that stops a 480 mm
   * cylinder of `steel` from reading as a drainpipe: they cut six specular
   * highlights down its length instead of one, which is what makes it turn as
   * the viewmodel sways.
   */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const flute = box(0.0055, 0.0032, 0.2, 0.0007, 1);
    flute.translate(0, 0.0104, 0);
    flute.rotateZ(a);
    body.add(flute, 'cavity', { y: bore, z: -0.36 });
    flute.dispose();
  }
  const brake = addMuzzleDevice(body, 'steel_soot', 'cavity', 'brake', zBarrelEnd, 0.0104, bore);
  // Barrel nut / chassis interface at the breech end.
  const nut = latheZ(
    [
      [0, 0.0142],
      [0, 0.019],
      [0.014, 0.019],
      [0.016, 0.0158],
      [0.016, 0.0142],
    ],
    22
  );
  body.add(nut, 'alu', { y: bore, z: zBreech - 0.03 });
  nut.dispose();

  /* ---- chassis forend + full-length rail ------------------------------- */
  addHandguard(body, 'alu', {
    y: bore,
    z0: hgZ0,
    z1: hgZ1,
    r: hgR,
    sides: 8,
    slatW: 0.0172,
    slatT: 0.0038,
    slots: 6,
    braces: 4,
    topFrom: handZ + 0.05,
    topTo: hgZ1 + 0.06,
  });
  // ONE rail from the back of the action to the end of the forend. A precision
  // rifle's rail is continuous over the action AND the forend (it is what makes
  // the optic repeatable), and it is what a 86 mm one-piece mount clamps to.
  addRail(body, 'alu', hgZ1 + 0.006, zActionRear - 0.006, railTop);
  addQdSocket(body, 'alu', 'steel', -hgR + 0.001, bore - 0.009, hgZ0 - 0.04, 'x', 0.005);
  addSlingLoop(body, 'steel', 0, bore - hgR - 0.0018, hgZ1 + 0.034, 0.008, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });
  addBipod(body, 'steel', 'polymer', { y: bore - hgR - 0.006, z: hgZ1 + 0.052 });

  /* ---- stock ----------------------------------------------------------- */
  addChassisStock(body, 'alu', 'polymer', 'rubber', {
    bore,
    zFront: zActionRear + 0.004,
    zRear: 0.272,
    y: bore - 0.016,
    w: 0.0205,
  });

  /* ---- optic ----------------------------------------------------------- */
  /**
   * 35 mm tube, 105 mm long, a 56 mm belled objective under a 10 mm shade.
   *
   * SOLVED ON THE SAME APERTURE BUDGET AS THE RED DOT (see buildOptic), because
   * doubling the tube length is exactly what breaks that budget: the sight
   * picture is stopped by the objective bore subtended at (relief + len), so at
   * the carbine's 1.065 objective ratio a 105 mm tube would deliver
   * 0.0186/0.210 = 0.089 against a 0.183 housing — 48 %, the drainpipe.
   * A magnified scope's answer is a bigger front lens, so `boreOb` 1.42 and
   * `bellOb` 1.60:
   *   ocular    0.0140 / 0.105 -> 0.1333
   *   objective 0.0249 / 0.210 -> 0.1184     (the stop, as it should be)
   *   housing   0.0193 / 0.105 -> 0.1833
   * 65 % of the housing is sight picture, matching the red dot's 69 %.
   */
  const optic = buildOptic(body, {
    rTube: 0.0175,
    len: 0.105,
    hood: 0.01,
    boreOc: 0.8,
    boreOb: 1.42,
    bellOb: 1.6,
    y: opticY,
    z: opticZ,
    railTop,
    mountLen: 0.086,
    ringZ: [-0.032, 0.03],
    matBody: 'alu_fine',
    matSteel: 'steel',
    reticle: 'crosshair',
  });
  // Ocular focus ring, knurled — the rear of a variable scope, and the thing the
  // eye is closest to in ADS after the bezel.
  const focus = latheZ(
    [
      [0, 0.0175],
      [0, 0.0192],
      [0.016, 0.0192],
      [0.016, 0.0175],
    ],
    40
  );
  body.add(focus, 'alu_fine', { y: opticY, z: opticZ + 0.038 });
  focus.dispose();

  /* ---- moving parts ---------------------------------------------------- */
  const magazine = new Assembly('sniper-mag');
  const mag = buildMagazine(magazine, null, {
    w: 0.0295,
    d: 0.084,
    len: 0.118,
    curve: 0.006,
    segs: 5,
    witness: 3,
    caseLen: 0.0635,
    rimR: 0.0072,
    bulletLen: 0.04,
    poly: 'polymer',
  });

  /**
   * THE BOLT — body, handle and knob in one moving assembly.
   *
   * It runs on `boltTravel`, which the viewmodel drives from `boltCycle` on
   * every shot (see Viewmodel._updateParts). So the 1.2 s between rounds is not
   * an invisible timer: the bolt lifts out of the frame, travels 78 mm back past
   * the shooter's eye and returns, and the round leaves the port on the way.
   */
  // Authored on the bore axis at y = 0, like the carbine's carrier: the group is
  // seated at `boltRest` (which carries the bore height) when the weapon is added.
  const bolt = new Assembly('sniper-bolt');
  const boltParts = [];
  const boltShaft = latheZ(
    [
      [0, rAction * 0.42],
      [0, rAction * 0.86],
      [0.128, rAction * 0.86],
      [0.128, rAction * 0.42],
    ],
    20
  );
  boltShaft.translate(0, 0, -0.128);
  boltParts.push(boltShaft);
  // Three locking lugs at the bolt face.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const lugG = box(0.0075, 0.0042, 0.014, 0.0006, 1);
    lugG.translate(0, rAction * 0.86, 0);
    lugG.rotateZ(a);
    lugG.translate(0, 0, -0.124);
    boltParts.push(lugG);
  }
  // Bolt shroud at the rear, and the cocking indicator pin.
  const shroud = latheZ(
    [
      [0, rAction * 0.5],
      [0, rAction * 0.95],
      [0.016, rAction * 0.95],
      [0.018, rAction * 0.8],
      [0.018, rAction * 0.5],
    ],
    20
  );
  boltParts.push(shroud);
  const indicator = rodZ(0.0026, 0.0026, 0.01, 8, 0.0004);
  indicator.translate(0, 0, 0.02);
  boltParts.push(indicator);
  const boltG = mergeAll(boltParts);
  bolt.add(boltG, 'steel_bright', {});
  boltG.dispose();

  /**
   * THE HANDLE. Authored along +Z from the bolt's surface — shaft, then a 13.6 mm
   * ball knob on the end of it — and placed with ONE rotation, so the knob can
   * never drift off the shaft the way two independently-posed parts do.
   *
   * The rotation is solved rather than eyeballed. The handle points outboard,
   * down and slightly back: d = (0.939, -0.280, 0.200). An Euler in three's XYZ
   * order sends +Z to (sin y, -sin x cos y, cos x cos y), so
   *   sin y = 0.939            -> ry = 1.2185
   *   sin x = 0.280 / cos y    -> rx = 0.951
   * and cos x cos y = 0.200 falls out, which is the check.
   *
   * Down matters as much as out: a handle that only goes sideways reads as a peg,
   * and the reason a bolt knob is raked down is that a hand comes off the grip
   * and up to it. This is the shape the eye reads as "bolt gun" from the side.
   */
  const HANDLE_RX = 0.951;
  const HANDLE_RY = 1.2185;
  const handleParts = [];
  const handleShaft = rodZ(0.0046, 0.0042, 0.038, 12, 0.0006);
  handleShaft.translate(0, 0, 0.019); // rodZ is centred; run it from the surface
  handleParts.push(handleShaft);
  // 13.6 mm ball knob. Nitrided rather than bright: it is the part of the bolt a
  // hand is always on, and it sits right beside the eye in ADS.
  const knob = latheZ(
    [
      [0, 0],
      [0.0016, 0.0052],
      [0.0062, 0.0068],
      [0.0116, 0.0052],
      [0.0132, 0],
    ],
    16
  );
  knob.translate(0, 0, 0.036);
  handleParts.push(knob);
  const handleG = mergeAll(handleParts);
  // Origin 12 mm out along the handle's own XY direction, i.e. just inside the
  // 18 mm bolt body, so there is no seam where the two meet.
  bolt.add(handleG, 'steel_black', {
    x: 0.0115,
    y: -0.0034,
    z: -0.05,
    rx: HANDLE_RX,
    ry: HANDLE_RY,
  });
  handleG.dispose();
  // A round on the bolt face, along the bore (see models/rifle.js for the trap).
  const chamberRound = cartridge(0.0635, 0.0072, 0.04);
  bolt.add(chamberRound.brass, 'brass', { z: -0.19, ry: Math.PI });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('sniper-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  return {
    id: 'sniper',
    label: 'AX-7',
    fxClass: 'sniper',
    body,
    moving: { magazine, bolt, trigger },
    nodes: {
      muzzle: [0, bore, brake.crownZ],
      chamber: [0, bore, portZ],
      eject: [rAction + 0.007, bore + 0.004, portZ],
      ejectDir: [0.92, 0.36, 0.16],
      sight: [0, opticY, optic.lensZ],
      sightAxis: [0, 0, -1],
      ironSight: [0, railTop + 0.026, 0.04],
      // Shooting hand: the same wrist derivation as the carbine's (see
      // models/rifle.js) against a grip raked 0.34 rad at the same origin.
      gripR: {
        pos: [0.0251, 0.06, 0.1223],
        finger: [0.05, -0.55, -0.833],
        back: [1, 0.03, 0.04],
      },
      /**
       * Support hand under the forend, clock angle 250 deg, solved exactly as
       * the carbine's (see models/rifle.js): the forend is a 60.2 mm tube on the
       * bore axis (26.5 mm chassis + 3.8 mm panels), the knuckle contact stands
       * 8.6 mm off it so a 16 mm half-palm buries by 7 mm, and the wrist target
       * is that contact minus 0.098 along the finger direction.
       *
       * `handZ` is 13 mm FURTHER BACK than the carbine's hand, not further
       * forward, even though the rifle is 185 mm longer. Reach is the binding
       * constraint, not the weapon: the hip pose puts this weapon 335 mm from
       * the eye (see defs.js), so a hand at -0.222 in weapon space is already
       * 557 mm downrange of a shoulder 200 mm off the eye and a 572 mm arm has
       * nothing left. On a chassis rifle that lands the hand at the rear of the
       * forend against the magwell, which is where a bolt gun is actually driven.
       */
      gripL: {
        pos: [-0.1012, 0.0737, handZ + 0.029],
        finger: [0.8977, -0.3267, -0.2955],
        back: [-0.2784, -0.7648, 0.581],
      },
      handguard: {
        axis: [0, bore, 0],
        dir: [0, 0, 1],
        r: hgR + 0.0038,
        z0: hgZ0,
        z1: hgZ1,
      },
      magSeat: { pos: [0, bore - 0.03, magZ], rot: [magTilt, 0, 0] },
      magDrop: [0, -0.4, 0.02],
      boltRest: { pos: [0, bore, 0.021], rot: [0, 0, 0] },
      // 78 mm of travel: a .338 bolt has to clear a 63.5 mm case.
      boltTravel: [0, 0, 0.078],
      triggerPivot: { pos: [0, bore - 0.044, -0.004], rot: [0, 0, 0] },
      triggerPull: -0.3,
      opticGlass: optic,
    },
    shell: { caseLen: 0.0635, rimR: 0.0072 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}
