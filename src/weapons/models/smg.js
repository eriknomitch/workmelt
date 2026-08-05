import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ, tubeZ, dome, mergeAll } from '../geometry.js';
import {
  addBarrel,
  addMuzzleDevice,
  addHandguard,
  addRail,
  addPistolGrip,
  addQdSocket,
  addSlingLoop,
  addPin,
  addScrew,
  addForeGrip,
  buildMagazine,
  buildMiniReflex,
  selectorPart,
  triggerPart,
  cartridge,
  emptyCase,
} from '../parts.js';

/**
 * The submachine gun — an MPX/MP5-flavoured 9 mm roller: slim tubular
 * receiver, side-mounted non-reciprocating charging handle in a cocking tube,
 * short M-LOK handguard with a vertical foregrip, tri-lug flash hider, folding
 * skeleton stock and a rail-mounted mini reflex sight.
 *
 * A submachine gun is *smaller* than a carbine in every dimension, and that is
 * the whole point of building it separately: 9 mm ammunition means a 26 mm
 * receiver and a 190 mm magazine, and the silhouette has to read that way.
 */
export function buildSmg() {
  const bore = 0.068;
  const rRec = 0.0158;
  const railTop = bore + 0.0245;
  const zRecRear = 0.062;
  const zRecFront = -0.112;
  const portZ = -0.042;
  const magZ = -0.052;
  const magTilt = 0.05;
  const hgZ0 = -0.114;
  const hgZ1 = -0.268;
  const hgR = 0.019;
  const zBarrelEnd = -0.3;
  const opticZ = -0.008;

  const body = new Assembly('smg-body');

  /* ---- receiver: a slim tube with a machined flat top and a mag housing ---- */
  const rec = latheZ(
    [
      [0, rRec * 0.55],
      [0, rRec * 0.99],
      [0.002, rRec],
      [zRecRear - zRecFront - 0.004, rRec],
      [zRecRear - zRecFront - 0.002, rRec * 0.96],
      [zRecRear - zRecFront, rRec * 0.6],
    ],
    22
  );
  body.add(rec, 'alu', { y: bore, z: zRecRear, ry: Math.PI });
  rec.dispose();
  const deck = box(0.0225, 0.009, zRecRear - zRecFront - 0.004, 0.0009, 1);
  body.add(deck, 'alu', { y: bore + rRec - 0.003, z: (zRecRear + zRecFront) / 2 });
  deck.dispose();
  addRail(body, 'alu', zRecFront + 0.004, zRecRear - 0.004, railTop);

  // Cocking tube above the barrel with the charging handle slot.
  const cockTube = tubeZ(0.0072, 0.0052, 0.14, 14, 0.0004);
  body.add(cockTube, 'alu', { x: -rRec + 0.0028, y: bore + rRec - 0.007, z: -0.06 });
  cockTube.dispose();

  // Ejection port, right side.
  const portW = 0.03;
  const portH = 0.017;
  const cav = box(0.01, portH, portW, 0.0008, 1);
  body.add(cav, 'cavity', { x: rRec - 0.006, y: bore + 0.002, z: portZ, ry: Math.PI / 2 });
  cav.dispose();
  const lip = extrude(roundRect(portW + 0.004, portH + 0.004, 0.002, 3), 0.002, {
    bevel: 0.0005,
    holes: [roundRect(portW, portH, 0.0016, 3)],
  });
  body.add(lip, 'alu', { x: rRec - 0.0012, y: bore + 0.002, z: portZ, ry: Math.PI / 2 });
  lip.dispose();
  const carrier = latheZ(
    [
      [0, rRec * 0.5],
      [0, rRec * 0.82],
      [0.07, rRec * 0.82],
      [0.07, rRec * 0.5],
    ],
    16
  );
  body.add(carrier, 'steel_bright', { y: bore, z: portZ - 0.02 });
  carrier.dispose();

  /* ---- lower: magwell housing, trigger group, grip -------------------- */
  const magW = 0.0242;
  const magD = 0.0345;
  const lowerBody = box(0.0245, 0.028, 0.13, 0.0016, 2);
  body.add(lowerBody, 'polymer', { y: bore - 0.0195, z: -0.02 });
  lowerBody.dispose();

  const wellH = 0.036;
  const well = extrude(roundRect(magW + 0.003, magD + 0.003, 0.005, 4), wellH, {
    bevel: 0.0011,
    holes: [roundRect(magW - 0.002, magD - 0.002, 0.004, 4)],
  });
  body.add(well, 'polymer', { y: bore - 0.038, z: magZ, rx: Math.PI / 2 + magTilt });
  well.dispose();
  const liner = extrude(roundRect(magW - 0.0022, magD - 0.0022, 0.004, 4), wellH - 0.004, {
    bevel: 0.0005,
    holes: [roundRect(magW - 0.005, magD - 0.005, 0.003, 4)],
  });
  body.add(liner, 'cavity', { y: bore - 0.038, z: magZ, rx: Math.PI / 2 + magTilt });
  liner.dispose();
  const flare = extrude(roundRect(magW + 0.007, magD + 0.008, 0.006, 4), 0.007, {
    bevel: 0.0012,
    holes: [roundRect(magW + 0.001, magD + 0.001, 0.004, 4)],
  });
  body.add(flare, 'polymer', { y: bore - 0.055, z: magZ + 0.0016, rx: Math.PI / 2 + magTilt });
  flare.dispose();

  // Trigger guard.
  const guardOuter = [
    [-0.026, 0],
    [0.028, 0],
    [0.03, -0.006],
    [0.026, -0.021],
    [0.016, -0.026],
    [-0.018, -0.026],
    [-0.026, -0.02],
  ];
  const guardInner = [
    [-0.021, -0.003],
    [0.0225, -0.003],
    [0.0235, -0.008],
    [0.02, -0.0195],
    [0.013, -0.0225],
    [-0.015, -0.0225],
    [-0.0205, -0.018],
  ];
  const guard = extrude(guardOuter, 0.0155, { bevel: 0.0009, holes: [guardInner] });
  body.add(guard, 'polymer', { y: bore - 0.03, z: -0.008 });
  guard.dispose();

  // Ambi mag release paddles + bolt catch.
  for (const sx of [-1, 1]) {
    const paddle = extrude(
      [
        [-0.008, -0.004],
        [0.009, -0.005],
        [0.01, 0.004],
        [-0.008, 0.005],
      ],
      0.004,
      { bevel: 0.0006 }
    );
    body.add(paddle, 'alu', { x: sx * 0.0132, y: bore - 0.026, z: -0.03, ry: Math.PI / 2 });
    paddle.dispose();
  }

  addPistolGrip(body, 'polymer', 'rubber', { y: 0.033, z: 0.018, angle: 0.36, len: 0.102, w: 0.03 });

  /* ---- barrel + handguard --------------------------------------------- */
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech: -0.09,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0092,
    rBarrel: 0.0062,
    rGas: 0.0072,
    gasAt: -0.2,
    knurl: false,
  });
  const muzzle = addMuzzleDevice(body, 'steel_soot', 'cavity', 'trilug', zBarrelEnd, 0.0062, bore);
  addHandguard(body, 'alu', {
    y: bore,
    z0: hgZ0,
    z1: hgZ1,
    r: hgR,
    sides: 8,
    slatW: 0.0132,
    slatT: 0.0032,
    slots: 3,
    braces: 2,
  });
  addRail(body, 'alu', hgZ1 + 0.004, hgZ0 - 0.002, railTop);
  addForeGrip(body, 'polymer', 'rubber', { y: bore - hgR - 0.004, z: -0.208, angle: 0.2, len: 0.058 });
  addQdSocket(body, 'alu', 'steel', -hgR + 0.001, bore - 0.006, hgZ0 - 0.022, 'x', 0.0045);

  /* ---- folding skeleton stock ---------------------------------------- */
  const hingeBlock = blob(0.026, 0.03, 0.024, 0.003, 3);
  body.add(hingeBlock, 'alu', { y: bore - 0.008, z: zRecRear + 0.008 });
  hingeBlock.dispose();
  addPin(body, 'steel', 0, bore - 0.008, zRecRear + 0.014, 0.003, 0.028);
  // two struts and a butt plate
  for (const sx of [-1, 1]) {
    const strut = box(0.0075, 0.011, 0.145, 0.0018, 2);
    body.add(strut, 'alu', { x: sx * 0.0125, y: bore - 0.014, z: zRecRear + 0.085, rx: -0.045 });
    strut.dispose();
  }
  const crossbar = box(0.032, 0.009, 0.0095, 0.0016, 2);
  body.add(crossbar, 'alu', { y: bore - 0.019, z: zRecRear + 0.12 });
  crossbar.dispose();
  const buttPlate = extrude(roundRect(0.042, 0.058, 0.006, 4), 0.009, { bevel: 0.0012 });
  body.add(buttPlate, 'polymer', { y: bore - 0.026, z: zRecRear + 0.155, rx: 0.06 });
  buttPlate.dispose();
  const pad = blob(0.04, 0.05, 0.0085, 0.0035, 3);
  body.add(pad, 'rubber', { y: bore - 0.026, z: zRecRear + 0.162, rx: 0.06 });
  pad.dispose();
  const cheek = blob(0.019, 0.013, 0.09, 0.005, 3);
  body.add(cheek, 'polymer', { y: bore + 0.012, z: zRecRear + 0.08, rx: -0.05 });
  cheek.dispose();
  addSlingLoop(body, 'steel', 0.0165, bore - 0.022, zRecRear + 0.026, 0.007, { ry: Math.PI / 2 });

  /* ---- sights -------------------------------------------------------- */
  // Mini reflex on a low riser over the receiver rail, where the tube red dot
  // used to sit. An open window has no aperture budget to solve (see
  // buildOptic) — the sight picture IS the scene, so the only sizing question
  // is how much of the frame the housing may eat in ADS. The 6 mm riser is not
  // cosmetic: it lifts the sight line far enough over the bore that neither
  // the muzzle device 300 mm downrange nor the near end of the handguard's top
  // rail crests the window's bottom edge — at 6 mm the rail teeth still poked
  // through the glass; 8 mm clears them by a millimetre of margin at the
  // rail's closest point.
  const riserH = 0.008;
  const riser = box(0.026, riserH, 0.046, 0.0012, 2);
  body.add(riser, 'alu', { y: railTop + riserH * 0.5, z: opticZ });
  riser.dispose();
  const optic = buildMiniReflex(body, {
    w: 0.03,
    h: 0.024,
    len: 0.05,
    y: railTop + riserH,
    z: opticZ,
    matBody: 'alu_fine',
    primary: true,
  });
  // A plain emitter dot, no circle-dot ring: the window is the aiming frame at
  // this eye relief, and the segmented ring on top of it is just clutter.
  optic.plainDot = true;
  // NO folded BUIS, front or rear. Under the old tube optic (centred 30 mm
  // above the rail) they tucked below the glass and filled the frame's lower
  // edge; an open reflex window starts 5 mm off the rail, which puts anything
  // rail-mounted ahead of it — a rear leaf five centimetres from the eye, a
  // front post seen through the glass — dead in the middle of the sight
  // picture. The ADS contract here is a thin outline and the dot, nothing else.

  /* ---- moving parts -------------------------------------------------- */
  const magazine = new Assembly('smg-mag');
  const mag = buildMagazine(magazine, null, {
    w: 0.0235,
    d: 0.0335,
    len: 0.192,
    curve: 0.026,
    segs: 7,
    witness: 5,
    caseLen: 0.0192,
    rimR: 0.00478,
    bulletLen: 0.0132,
    poly: 'polymer',
  });

  // Non-reciprocating charging handle: a paddle in the cocking tube.
  const charging = new Assembly('smg-charging');
  const chParts = [];
  const chShaft = rodZ(0.0048, 0.0048, 0.12, 12, 0.0004);
  chParts.push(chShaft);
  const chPaddle = extrude(
    [
      [0, -0.0075],
      [0.017, -0.009],
      [0.019, 0],
      [0.017, 0.008],
      [0, 0.007],
    ],
    0.0055,
    { bevel: 0.0008 }
  );
  chPaddle.rotateY(-Math.PI / 2);
  chPaddle.translate(-0.0075, 0, -0.05);
  chParts.push(chPaddle);
  const chKnob = dome(0.0055, 12, 0.6);
  chKnob.rotateY(-Math.PI / 2);
  chKnob.translate(-0.024, 0, -0.05);
  chParts.push(chKnob);
  const chG = mergeAll(chParts);
  charging.add(chG, 'steel_bright', {});
  chG.dispose();

  const bolt = new Assembly('smg-bolt');
  const boltBody = latheZ(
    [
      [0, rRec * 0.45],
      [0, rRec * 0.8],
      [0.078, rRec * 0.8],
      [0.078, rRec * 0.45],
    ],
    16
  );
  bolt.add(boltBody, 'steel_bright', { z: -0.078 });
  boltBody.dispose();
  const bface = box(0.014, 0.014, 0.003, 0.0006, 1);
  bolt.add(bface, 'steel', { z: -0.0005 });
  bface.dispose();
  const chamberRound = cartridge(0.0192, 0.00478, 0.0132);
  // Along the bore, not across it (see the rifle for the same trap).
  bolt.add(chamberRound.brass, 'brass', { z: -0.0215, ry: Math.PI });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('smg-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  const selector = new Assembly('smg-selector');
  const sel = selectorPart('alu', 'steel');
  selector.add(sel.geo, 'alu', {});
  sel.geo.dispose();
  const selR = selectorPart('alu', 'steel');
  selector.add(selR.geo, 'alu', { sx: -1 });
  selR.geo.dispose();

  return {
    id: 'smg',
    label: 'MPX-9',
    fxClass: 'smg',
    body,
    moving: { magazine, charging, bolt, trigger, selector },
    nodes: {
      muzzle: [0, bore, muzzle.crownZ],
      chamber: [0, bore, portZ],
      eject: [rRec + 0.006, bore + 0.002, portZ],
      ejectDir: [0.9, 0.4, 0.18],
      sight: optic.center,
      sightAxis: [0, 0, -1],
      // Wrist targets, derived the same way as the rifle's (see models/rifle.js):
      // knuckle/grip contact point minus the palm offset along the hand axis.
      gripR: {
        pos: [0.024, 0.028, 0.064],
        finger: [-0.05, -0.4, -0.915],
        back: [0.97, -0.05, -0.22],
      },
      /** Support hand on the vertical foregrip: metacarpals run forward around
       *  the front of the post, palm facing inboard. */
      gripL: {
        pos: [-0.056, 0.015, -0.153],
        finger: [0.45, 0.05, -0.89],
        back: [-0.88, -0.05, -0.45],
      },
      magSeat: { pos: [0, bore - 0.02, magZ], rot: [magTilt, 0, 0] },
      magDrop: [0, -0.4, 0.02],
      chargeRest: { pos: [-rRec + 0.0028, bore + rRec - 0.007, -0.06], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.062],
      boltRest: { pos: [0, bore, portZ + 0.032], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.05],
      triggerPivot: { pos: [0, bore - 0.026, -0.001], rot: [0, 0, 0] },
      triggerPull: -0.36,
      selectorPivot: { pos: [0, bore - 0.019, 0.022], rot: [0, 0, 0] },
      opticGlass: optic,
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}
