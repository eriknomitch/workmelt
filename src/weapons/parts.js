import * as THREE from 'three';
import {
  box,
  blob,
  latheZ,
  tubeZ,
  rodZ,
  dome,
  extrude,
  roundRect,
  ring,
  screw,
  knurlBand,
  picatinny,
  mlokSlot,
  mergeAll,
} from './geometry.js';

/**
 * Reusable firearm components.
 *
 * Each function bolts a real mechanical assembly onto an `Assembly` at a given
 * offset. Everything is authored from published dimensions (an AR-15 upper
 * receiver really is 198 mm long with a 21.2 mm rail and a 66 mm optic height
 * over bore), because proportion is what the eye checks first — no amount of
 * texture detail rescues a receiver that is 30% too fat.
 *
 * Weapon-local space: +X right, +Y up, -Z toward the muzzle. The origin is the
 * shooting hand's anchor (the web of the thumb, top-rear of the pistol grip),
 * which is also what the viewmodel rig positions.
 */

const TAU = Math.PI * 2;

/** Overall length of each muzzle device, so callers can lay out the barrel. */
export const MUZZLE_LEN = { brake: 0.062, a2: 0.0483, comp: 0.058, trilug: 0.042 };

/* -------------------------------------------------------------------------- */
/*  small hardware                                                            */
/* -------------------------------------------------------------------------- */

/** Cross pin with a domed head (takedown pins, trigger/hammer pins). */
export function addPin(asm, mat, x, y, z, r = 0.0022, len = 0.02) {
  asm.add(rodZ(r, r, len, 12, 0.0004), mat, { x, y, z, ry: Math.PI / 2 });
  asm.add(dome(r * 1.25, 10, 0.5), mat, { x: x + len / 2, y, z, ry: -Math.PI / 2 });
  asm.add(dome(r * 1.25, 10, 0.5), mat, { x: x - len / 2, y, z, ry: Math.PI / 2 });
}

/** Hex-socket screw, head facing +axis. */
export function addScrew(asm, mat, x, y, z, rHead = 0.0022, axis = 'y', len = 0.008) {
  const g = screw(rHead, rHead * 0.55, rHead * 0.5, len, 10);
  const rot = axis === 'y' ? { rx: Math.PI / 2 } : axis === 'x' ? { ry: -Math.PI / 2 } : {};
  asm.add(g, mat, { x, y, z, ...rot });
  g.dispose();
}

/** QD sling swivel socket: a countersunk cup with a steel insert. */
export function addQdSocket(asm, matBody, matSteel, x, y, z, axis = 'x', r = 0.0055) {
  const cup = latheZ(
    [
      [0, r * 0.55],
      [0, r * 1.5],
      [0.0012, r * 1.62],
      [0.006, r * 1.62],
      [0.006, r * 0.9],
    ],
    14
  );
  const inner = latheZ(
    [
      [0.004, 0],
      [0.004, r * 0.55],
      [0, r * 0.55],
    ],
    12
  );
  const rot = axis === 'x' ? { ry: Math.PI / 2 } : axis === 'y' ? { rx: -Math.PI / 2 } : {};
  asm.add(cup, matBody, { x, y, z, ...rot });
  asm.add(inner, matSteel, { x, y, z, ...rot });
  cup.dispose();
  inner.dispose();
}

/** Fixed sling loop — a flat steel eye. */
export function addSlingLoop(asm, mat, x, y, z, radius = 0.008, rot = {}) {
  const g = ring(radius, 0.0016, 14, 6);
  asm.add(g, mat, { x, y, z, ...rot });
  g.dispose();
}

/** A live cartridge: brass case, shoulder, neck, copper FMJ tip. */
export function cartridge(caseLen = 0.0446, rimR = 0.00495, bulletLen = 0.019) {
  const neckR = rimR * 0.72;
  const brass = latheZ(
    [
      [0, 0],
      [0, rimR],
      [0.0012, rimR * 0.97],
      [caseLen * 0.62, rimR * 0.965],
      [caseLen * 0.78, neckR],
      [caseLen, neckR],
    ],
    16
  );
  const bullet = latheZ(
    [
      [caseLen - 0.004, neckR * 0.98],
      [caseLen + bulletLen * 0.45, neckR * 0.98],
      [caseLen + bulletLen * 0.8, neckR * 0.62],
      [caseLen + bulletLen, neckR * 0.16],
      [caseLen + bulletLen + 0.0004, 0],
    ],
    16
  );
  return { brass, bullet, length: caseLen + bulletLen };
}

/** Fired case — same brass, no bullet, slightly belled mouth. */
export function emptyCase(caseLen = 0.0446, rimR = 0.00495) {
  const neckR = rimR * 0.72;
  return latheZ(
    [
      [0, 0],
      [0, rimR],
      [0.0012, rimR * 0.97],
      [caseLen * 0.62, rimR * 0.965],
      [caseLen * 0.78, neckR],
      [caseLen, neckR * 1.02],
      [caseLen, neckR * 0.86],
      [caseLen * 0.8, neckR * 0.86],
    ],
    16
  );
}

/* -------------------------------------------------------------------------- */
/*  rails                                                                     */
/* -------------------------------------------------------------------------- */

/** Picatinny run along Z, top face at `y`. */
export function addRail(asm, mat, z0, z1, y, x = 0, opts = {}) {
  const len = Math.abs(z1 - z0);
  const baseH = opts.baseH ?? 0.0042;
  const topH = opts.topH ?? 0.0032;
  const waist = opts.waist ?? 0.0157;
  const cz = (z0 + z1) / 2;
  const yb = y - baseH - topH;
  const g = picatinny(len, opts);
  asm.add(g, mat, { x, y: yb, z: cz });
  g.dispose();
  /**
   * SLOT FLOORS.
   *
   * A recoil slot is a 5.35 mm gap with a 3.2 mm deep floor that in real light is
   * always in shadow. Left in the rail's own aluminium the floor caught the sky
   * at exactly the same rate as the tooth tops, so a rail read as a ladder of
   * flat near-white bars instead of a row of cavities — the single loudest
   * artefact on the whole weapon.
   *
   * The strip is exactly the width of a tooth's foot, so it is occluded by the
   * teeth everywhere except inside the slots, where it becomes the floor.
   */
  if (opts.slotFloor !== false) {
    const floor = box(waist * 0.99, 0.0014, len - 0.0004, 0.0002, 1);
    asm.add(floor, 'cavity', { x, y: yb + baseH - 0.0003, z: cz });
    floor.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/*  barrel + muzzle devices                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stepped barrel with a chamber shoulder, a gas journal and a knurled section.
 * Returns the muzzle Z so the device can be bolted onto the crown.
 */
export function addBarrel(asm, matSteel, matCavity, o) {
  const y = o.y ?? 0;
  const zBreech = o.zBreech;
  const zMuzzle = o.zMuzzle;
  const rChamber = o.rChamber ?? 0.0112;
  const rBore = o.rBarrel ?? 0.0072;
  const rGas = o.rGas ?? 0.0092;
  const len = zBreech - zMuzzle;
  const gasAt = o.gasAt ?? zMuzzle + len * 0.34;

  const profile = [
    [0, 0],
    [0, rChamber + 0.0018],
    [0.004, rChamber + 0.0022],
    [0.02, rChamber + 0.0022],
    [0.022, rChamber],
    [len * 0.24, rChamber],
    [len * 0.26, rBore + 0.0012],
    [zBreech - gasAt - 0.012, rBore + 0.0012],
    [zBreech - gasAt - 0.01, rGas],
    [zBreech - gasAt + 0.012, rGas],
    [zBreech - gasAt + 0.014, rBore],
    [len - 0.014, rBore],
    [len - 0.012, rBore + 0.0009],
    [len - 0.001, rBore + 0.0009],
    [len, rBore * 0.72],
  ];
  // Authored from the breech forward; flip so +axial runs toward -Z.
  const g = latheZ(profile, o.seg ?? 22);
  asm.add(g, matSteel, { y, z: zBreech, ry: Math.PI });
  g.dispose();

  // Bore: a real dark tube so the crown does not read as a painted dot.
  const bore = tubeZ(rBore * 0.7, rBore * 0.42, len * 0.5, 14, 0.0002);
  asm.add(bore, matCavity, { y, z: zMuzzle + len * 0.25 });
  bore.dispose();

  // Knurled section behind the muzzle threads.
  if (o.knurl !== false) {
    const k = knurlBand(rBore + 0.0006, 0.012, 26, 0.00035, 3);
    asm.add(k, matSteel, { y, z: zMuzzle + 0.026 });
    k.dispose();
  }
  return { gasAt, rBore };
}

/**
 * Gas block + gas tube. Low-profile block with two set screws and the tube
 * running back over the barrel into the receiver.
 */
export function addGasBlock(asm, matSteel, o) {
  const y = o.y ?? 0;
  const z = o.z;
  const r = o.rBarrel ?? 0.0072;
  const w = o.w ?? 0.021;
  const h = o.h ?? 0.019;
  const bodyG = box(w, h, o.len ?? 0.026, 0.0008, 2);
  asm.add(bodyG, matSteel, { y: y - 0.0015, z });
  bodyG.dispose();
  addScrew(asm, matSteel, 0, y - h / 2 + 0.0015, z - 0.007, 0.0022, 'y', 0.006);
  addScrew(asm, matSteel, 0, y - h / 2 + 0.0015, z + 0.007, 0.0022, 'y', 0.006);
  // gas tube back to the receiver
  const tubeLen = o.tubeTo - z;
  const t = tubeZ(0.0026, 0.0014, Math.abs(tubeLen), 10, 0.0002);
  asm.add(t, matSteel, { y: y + r + 0.0052, z: z + tubeLen / 2 });
  t.dispose();
}

/**
 * Muzzle devices. All of them get a real bore, a crush washer, chamfered ports
 * and a crowned exit — the muzzle is the part the player stares at while firing.
 */
export function addMuzzleDevice(asm, matSteel, matCavity, kind, zBarrelEnd, rBarrel, y = 0) {
  const parts = [];
  let len = MUZZLE_LEN[kind] ?? 0.05;
  const rOut = rBarrel + 0.0038;
  // The device threads onto the barrel, so its rear face sits at the barrel end
  // and the crown ends up `len` further forward.
  const zCrown = zBarrelEnd - len;

  if (kind === 'brake') {
    parts.push(
      latheZ(
        [
          [0, rBarrel + 0.0012],
          [0.006, rBarrel + 0.0022],
          [0.008, rOut],
          [len - 0.01, rOut],
          [len - 0.008, rOut * 0.96],
          [len - 0.002, rOut * 0.96],
          [len, rOut * 0.8],
          [len, rBarrel * 0.66],
          [len - 0.006, rBarrel * 0.62],
        ],
        20
      )
    );
    // three pairs of side ports, chamfered, plus a top pair for muzzle rise
    for (let i = 0; i < 3; i++) {
      const z = 0.016 + i * 0.013;
      const port = box(rOut * 2.4, 0.0055, 0.0072, 0.0006, 1);
      const g1 = port.clone();
      g1.translate(0, 0, z);
      parts.push(g1);
      port.dispose();
    }
  } else if (kind === 'a2') {
    // A2 birdcage: closed bottom, five slots
    parts.push(
      latheZ(
        [
          [0, rBarrel + 0.001],
          [0.005, rBarrel + 0.002],
          [0.007, rOut * 0.92],
          [0.012, rOut],
          [len - 0.004, rOut],
          [len, rOut * 0.86],
          [len, rBarrel * 0.6],
          [len - 0.005, rBarrel * 0.58],
        ],
        20
      )
    );
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.44 + (i / 4) * Math.PI * 0.88;
      const slot = box(0.0032, 0.0075, 0.021, 0.0005, 1);
      slot.translate(0, rOut * 0.82, 0);
      slot.rotateZ(a);
      slot.translate(0, 0, 0.03);
      parts.push(slot);
    }
  } else if (kind === 'comp') {
    // linear compensator / blast can
    parts.push(
      latheZ(
        [
          [0, rBarrel + 0.0012],
          [0.005, rBarrel + 0.003],
          [0.008, rOut + 0.0016],
          [0.03, rOut + 0.0016],
          [0.031, rOut + 0.0022],
          [len - 0.003, rOut + 0.0022],
          [len, rOut + 0.0006],
          [len, rBarrel * 0.7],
          [len - 0.007, rBarrel * 0.66],
        ],
        20
      )
    );
    const k = knurlBand(rOut + 0.0018, 0.018, 30, 0.0003, 4);
    k.translate(0, 0, 0.018);
    parts.push(k);
  } else {
    // tri-lug / flash hider for the SMG class
    parts.push(
      latheZ(
        [
          [0, rBarrel + 0.0014],
          [0.004, rBarrel + 0.0026],
          [0.006, rOut],
          [0.024, rOut],
          [0.026, rOut - 0.0012],
          [len - 0.002, rOut - 0.0012],
          [len, rOut - 0.003],
          [len, rBarrel * 0.62],
          [len - 0.005, rBarrel * 0.6],
        ],
        18
      )
    );
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const lug = box(0.0042, 0.0038, 0.012, 0.0005, 1);
      lug.translate(0, rOut + 0.0012, 0);
      lug.rotateZ(a);
      lug.translate(0, 0, 0.008);
      parts.push(lug);
    }
  }

  const g = mergeAll(parts);
  // Authored breech-to-crown along +Z, so flip it onto the muzzle.
  asm.add(g, matSteel, { y, z: zCrown + len, ry: Math.PI });
  g.dispose();

  // crush washer
  const washer = latheZ(
    [
      [0, rBarrel + 0.0012],
      [0, rBarrel + 0.0032],
      [0.0018, rBarrel + 0.0032],
      [0.0018, rBarrel + 0.0012],
    ],
    16
  );
  asm.add(washer, matSteel, { y, z: zCrown + len });
  washer.dispose();

  // the bore itself, and the dark expansion chamber behind it
  const bore = tubeZ(rBarrel * 0.66, rBarrel * 0.4, len * 0.9, 14, 0.0002);
  asm.add(bore, matCavity, { y, z: zCrown + len * 0.5 });
  bore.dispose();
  return { len, crownZ: zCrown };
}

/* -------------------------------------------------------------------------- */
/*  handguard                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Free-float handguard built from longitudinal slats with real gaps, so the
 * barrel and gas block are visible through it and the silhouette breaks up.
 */
export function addHandguard(asm, matAlu, o) {
  /**
   * MATERIAL SPLIT. The barrel nut, the ring braces and the end cap are machined
   * aluminium (they carry the barrel); the slats and their M-LOK slots are a
   * moulded polymer panel set. That is a real product configuration, and it is
   * also the only place on the gun where the two dielectric classes sit directly
   * against each other over a large area — which is what makes the class break
   * legible at hipfire framing instead of theoretical.
   */
  const matPanel = o.matPanel ?? matAlu;
  const yb = o.y ?? 0;
  const z0 = o.z0; // receiver end (rear, larger z)
  const z1 = o.z1; // muzzle end
  const len = z0 - z1;
  const rOut = o.r ?? 0.0235;
  const sides = o.sides ?? 8;
  const slatW = o.slatW ?? 0.0135;
  const slatT = o.slatT ?? 0.0032;
  const cz = (z0 + z1) / 2;

  // barrel nut / rear collar
  const collar = latheZ(
    [
      [0, rOut * 0.72],
      [0, rOut + 0.0018],
      [0.0025, rOut + 0.0026],
      [0.014, rOut + 0.0026],
      [0.0165, rOut + 0.0012],
      [0.0165, rOut * 0.72],
    ],
    18
  );
  asm.add(collar, matAlu, { y: yb, z: z0 - 0.0165 });
  collar.dispose();
  const nutKnurl = knurlBand(rOut + 0.0028, 0.011, 34, 0.00035, 3);
  asm.add(nutKnurl, matAlu, { y: yb, z: z0 - 0.0085 });
  nutKnurl.dispose();

  const slat = box(slatW, slatT, len - 0.019, 0.0006, 1);
  /**
   * mlokSlot is authored as a flat plate in XY extruded along +Z, so its pocket
   * recesses along -Z and its long axis is X. Assembly composes its Euler in
   * 'XYZ' order, which APPLIES rz first, so a single add() cannot both roll the
   * plate onto the barrel axis and spin it round to the slat's clock position.
   * Bake the axis roll into the geometry once: normal -> +X (radial), long axis
   * -> Z (along the barrel). Then `rz: a` alone puts it on any slat.
   *
   * Left unrolled the plates lay in the XY plane and read as loose diamond tabs
   * standing off the handguard, which is exactly what they were doing.
   */
  const slotGeo = mlokSlot(0.026, 0.0072, 0.0018);
  slotGeo.rotateY(Math.PI / 2);
  // The top slat is normally the rail's job. `topFrom`/`topTo` let a caller ask
  // for a bare polymer top over the section the support hand actually grips, so
  // the fingers can close over the handguard instead of through a rail.
  const topFrom = o.topFrom ?? null;
  const topTo = o.topTo ?? null;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU + Math.PI / sides;
    const isTop = Math.abs(Math.sin(a) - 1) < 0.35;
    const y = Math.sin(a) * (rOut - slatT * 0.5);
    const x = Math.cos(a) * (rOut - slatT * 0.5);
    if (isTop) {
      if (topFrom === null) continue;
      const tLen = Math.abs(topFrom - topTo);
      const top = box(slatW, slatT, tLen, 0.0006, 1);
      asm.add(top, matPanel, {
        x,
        y: yb + y,
        z: (topFrom + topTo) / 2,
        rz: a - Math.PI / 2,
      });
      top.dispose();
      continue;
    }
    asm.add(slat, matPanel, { x, y: yb + y, z: cz - 0.0095, rz: a - Math.PI / 2 });
    // M-LOK slots on the 3/6/9-o'clock slats only, like the real thing
    const cardinal = Math.abs(Math.cos(a)) > 0.85 || Math.sin(a) < -0.85;
    if (cardinal) {
      for (let s = 0; s < (o.slots ?? 3); s++) {
        const sz = cz + len * 0.5 - 0.045 - s * 0.038;
        if (sz < z1 + 0.02) break;
        asm.add(slotGeo, matPanel, { x: x * 1.005, y: yb + y * 1.005, z: sz, rz: a });
        // The pocket floor: a dark recess so the slot is a hole in the panel and
        // not a raised lozenge that catches the same light as the panel face.
        const pocket = box(0.0012, 0.0052, 0.0232, 0.0002, 1);
        asm.add(pocket, 'cavity', { x: x * 0.955, y: yb + y * 0.955, z: sz, rz: a });
        pocket.dispose();
      }
    }
  }
  slat.dispose();
  slotGeo.dispose();

  // ring braces tie the slats together
  const braceCount = o.braces ?? 3;
  for (let i = 0; i < braceCount; i++) {
    const z = z0 - 0.03 - (i / Math.max(1, braceCount - 1)) * (len - 0.07);
    const brace = latheZ(
      [
        [0, rOut - slatT],
        [0, rOut + 0.0006],
        [0.0035, rOut + 0.0006],
        [0.0035, rOut - slatT],
      ],
      Math.max(10, sides * 2)
    );
    asm.add(brace, matAlu, { y: yb, z });
    brace.dispose();
  }

  // anti-rotation index tabs at the front, and a chamfered end cap ring
  const cap = latheZ(
    [
      [0, rOut - slatT - 0.0008],
      [0, rOut - 0.0002],
      [0.0022, rOut - 0.0012],
      [0.0022, rOut - slatT - 0.0008],
    ],
    Math.max(10, sides * 2)
  );
  asm.add(cap, matAlu, { y: yb, z: z1 + 0.001 });
  cap.dispose();
}

/* -------------------------------------------------------------------------- */
/*  receiver                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * AR-pattern upper receiver: a flat-top tube with the rail on the crest, the
 * forward assist and brass deflector at the rear right, a recessed ejection
 * port, and the charging-handle channel.
 */
export function addUpperReceiver(asm, mat, matSteel, matCavity, o) {
  const zRear = o.zRear;
  const zFront = o.zFront;
  const bore = o.bore;
  const r = o.r ?? 0.0192;
  const len = zRear - zFront;
  const cz = (zRear + zFront) / 2;

  // Main tube, flattened on top where the rail sits.
  //
  // Both ends are CLOSED (radius 0). An annular end face leaves a 19 mm hole
  // straight down the receiver, and in ADS the eye is 0.2 m behind it looking
  // right in: you see the bolt carrier and the chambered round floating in a
  // black pipe. Nothing inside the receiver is ever meant to be visible except
  // through the ejection-port cavity.
  const body = latheZ(
    [
      [0, 0],
      [0, r * 0.98],
      [0.0022, r],
      [len * 0.52, r],
      [len * 0.54, r * 0.985],
      [len - 0.004, r * 0.985],
      [len, r * 0.93],
      [len, 0],
    ],
    22
  );
  asm.add(body, mat, { y: bore, z: zRear, ry: Math.PI });
  body.dispose();

  // Flat top deck the rail is machined onto.
  const deck = box(0.0235, 0.008, len - 0.002, 0.0008, 1);
  asm.add(deck, mat, { y: bore + r - 0.0025, z: cz });
  deck.dispose();

  // Charging-handle raceway hump at the rear.
  const hump = box(0.0245, 0.011, 0.05, 0.0012, 2);
  asm.add(hump, mat, { y: bore + r - 0.0075, z: zRear - 0.024 });
  hump.dispose();

  // Forward assist boss (rear right) — a real stepped cylinder with a pad.
  const fa = latheZ(
    [
      [0, 0],
      [0, 0.0055],
      [0.0015, 0.0062],
      [0.006, 0.0062],
      [0.007, 0.0048],
      [0.019, 0.0048],
      [0.019, 0],
    ],
    14
  );
  asm.add(fa, mat, { x: 0.0115, y: bore - 0.004, z: zRear - 0.006, rz: 0, ry: 0, rx: 0.35 });
  fa.dispose();
  const faPad = box(0.0085, 0.0085, 0.0035, 0.0008, 2);
  asm.add(faPad, matSteel, { x: 0.0132, y: bore - 0.0025, z: zRear + 0.0025, rx: 0.35 });
  faPad.dispose();

  // Brass deflector: the little wedge behind the port.
  const defl = extrude(
    [
      [0, 0],
      [0.013, 0.004],
      [0.013, 0.019],
      [0, 0.017],
    ],
    0.016,
    { bevel: 0.0009 }
  );
  asm.add(defl, mat, { x: r - 0.001, y: bore - 0.006, z: zRear - 0.045, ry: Math.PI / 2 });
  defl.dispose();

  // Ejection port: a recessed cavity with a hinged dust cover just below.
  const portW = 0.032;
  const portH = 0.019;
  const cav = box(portH, 0.012, portW, 0.0008, 1);
  asm.add(cav, matCavity, { x: r - 0.0075, y: bore + 0.001, z: o.portZ, ry: Math.PI / 2 });
  cav.dispose();
  // port lip
  const lip = extrude(roundRect(portW + 0.005, portH + 0.005, 0.0022, 3), 0.0022, { bevel: 0.0006 });
  const lipInner = extrude(roundRect(portW, portH, 0.0018, 3), 0.003, { bevel: 0.0005 });
  asm.add(lip, mat, { x: r - 0.0022, y: bore + 0.001, z: o.portZ, ry: Math.PI / 2 });
  asm.add(lipInner, matCavity, { x: r - 0.0042, y: bore + 0.001, z: o.portZ, ry: Math.PI / 2 });
  lip.dispose();
  lipInner.dispose();

  /**
   * DUST COVER, hung open.
   *
   * The port on its own is a dark rectangle and reads as a decal. What makes it
   * read as a mechanism is the cover: a stamped panel with a RAISED LIP around
   * three edges (that lip is the stiffening flange, and it is the only part of
   * the cover that ever catches a highlight), sprung open on a hinge rod below
   * the port so it hangs down and rearward off the receiver flank. Two separate
   * masses — the rod and the flanged panel — where there used to be none.
   */
  const hingeY = bore - 0.0092;
  const hingeX = r - 0.0035;
  const rod = rodZ(0.0016, 0.0016, portW + 0.014, 10, 0.0003);
  asm.add(rod, matSteel, { x: hingeX, y: hingeY, z: o.portZ });
  rod.dispose();
  // The panel swings open about the rod: 1.35 rad puts it hanging down-outboard,
  // clear of the magwell, which is where a sprung cover actually sits.
  const coverOpen = 1.35;
  const coverParts = [];
  const panel = box(portH + 0.004, 0.0014, portW + 0.006, 0.0005, 1);
  coverParts.push(panel);
  // Stiffening flange: proud 1.2 mm on the two long edges and the free edge.
  for (const sz of [-1, 1]) {
    const f = box(portH + 0.004, 0.0032, 0.0016, 0.0004, 1);
    f.translate(0, 0.0009, sz * (portW * 0.5 + 0.0022));
    coverParts.push(f);
  }
  const freeEdge = box(0.0018, 0.0034, portW + 0.006, 0.0004, 1);
  freeEdge.translate((portH + 0.004) * 0.5 - 0.0009, 0.001, 0);
  coverParts.push(freeEdge);
  const cover = mergeAll(coverParts);
  // Author it lying in the XZ plane hinged along -X, then swing it open.
  cover.translate((portH + 0.004) * 0.5, 0, 0);
  cover.rotateZ(-coverOpen);
  asm.add(cover, mat, { x: hingeX, y: hingeY, z: o.portZ });
  cover.dispose();

  // Rail on the crest.
  addRail(asm, mat, zFront + 0.002, zRear - 0.002, o.railTop);

  // Receiver pins.
  addPin(asm, matSteel, 0, bore - r + 0.004, zFront + 0.014, 0.0024, r * 2 - 0.004);
  return { railTop: o.railTop };
}

/**
 * Bolt carrier group seen through the ejection port, and the case in the
 * chamber. Returned as its own assembly because it cycles.
 */
export function addBoltCarrier(asm, matSteel, o) {
  const y = o.y ?? 0;
  const r = o.r ?? 0.0155;
  const len = o.len ?? 0.09;
  const body = latheZ(
    [
      [0, r * 0.6],
      [0, r],
      [0.002, r + 0.0004],
      [len * 0.45, r + 0.0004],
      [len * 0.47, r],
      [len, r],
      [len, r * 0.5],
    ],
    18
  );
  asm.add(body, matSteel, { y, z: o.z, ry: Math.PI });
  body.dispose();
  // cam pin track + gas key
  const key = box(0.011, 0.0075, 0.016, 0.0006, 1);
  asm.add(key, matSteel, { y: y + r + 0.0026, z: o.z + len * 0.25 });
  key.dispose();
  const lug = box(0.006, 0.005, 0.03, 0.0005, 1);
  asm.add(lug, matSteel, { x: r * 0.78, y: y + r * 0.42, z: o.z + len * 0.1, rz: 0.5 });
  lug.dispose();
}

/**
 * AR lower receiver: magwell, trigger guard, grip boss, selector, mag release,
 * bolt catch, takedown pins.
 */
export function addLowerReceiver(asm, mat, matSteel, o) {
  const bore = o.bore;
  const zRear = o.zRear;
  const zFront = o.zFront;
  const w = o.w ?? 0.0245;
  const magW = o.magW ?? 0.0295;
  const magD = o.magD ?? 0.0685;
  const magTop = o.magTop ?? bore - 0.014;
  const magBottom = o.magBottom ?? bore - 0.062;
  const magZ = o.magZ;
  const magTilt = o.magTilt ?? 0.09;

  // Receiver body — the flat-sided box under the upper.
  const bodyH = 0.026;
  const bodyG = box(w, bodyH, zRear - zFront, 0.0016, 2);
  asm.add(bodyG, mat, { y: bore - 0.014, z: (zRear + zFront) / 2 });
  bodyG.dispose();

  // Magwell: a genuinely hollow tube (so the well is a hole when the magazine
  // drops out during a reload), tilted forward like the real one.
  const wellH = magTop - magBottom;
  const well = extrude(roundRect(magW, magD, 0.0075, 5), wellH, {
    bevel: 0.0012,
    holes: [roundRect(magW - 0.005, magD - 0.005, 0.006, 5)],
  });
  asm.add(well, mat, {
    y: (magTop + magBottom) / 2,
    z: magZ,
    rx: Math.PI / 2 + magTilt,
  });
  well.dispose();
  const liner = extrude(roundRect(magW - 0.0052, magD - 0.0052, 0.006, 5), wellH - 0.004, {
    bevel: 0.0006,
    holes: [roundRect(magW - 0.0082, magD - 0.0082, 0.005, 5)],
  });
  asm.add(liner, 'cavity', {
    y: (magTop + magBottom) / 2,
    z: magZ,
    rx: Math.PI / 2 + magTilt,
  });
  liner.dispose();
  const mouth = extrude(roundRect(magW + 0.004, magD + 0.005, 0.008, 5), 0.006, {
    bevel: 0.0012,
    holes: [roundRect(magW - 0.003, magD - 0.003, 0.006, 5)],
  });
  asm.add(mouth, mat, {
    y: magBottom + 0.002,
    z: magZ + Math.sin(magTilt) * wellH * 0.5,
    rx: Math.PI / 2 + magTilt,
  });
  mouth.dispose();

  // Rear takedown lug + buffer tower.
  const tower = box(w - 0.001, 0.03, 0.026, 0.0014, 2);
  asm.add(tower, mat, { y: bore - 0.0155, z: zRear - 0.012 });
  tower.dispose();

  // Trigger guard: a bevelled loop under the receiver.
  //
  // The outline is authored in the weapon's SIDE plane — the first coordinate is
  // fore/aft, the second is up/down — and then rotated so the extrusion runs
  // across the receiver. Extruding the outline straight out of the XY plane
  // would stand the loop up across the gun like a trigger-shaped cattle guard,
  // which is invisible from the side and wrong from every other angle.
  // +X in the outline is the muzzle side, so it maps to -Z below.
  const guardOuter = [
    [-0.028, 0],
    [0.03, 0],
    [0.032, -0.006],
    [0.028, -0.0225],
    [0.018, -0.0275],
    [-0.02, -0.0275],
    [-0.028, -0.021],
  ];
  const guardInner = [
    [-0.0225, -0.003],
    [0.0245, -0.003],
    [0.0255, -0.008],
    [0.022, -0.0205],
    [0.015, -0.0235],
    [-0.0165, -0.0235],
    [-0.0225, -0.019],
  ];
  const guard = extrude(guardOuter, 0.0172, {
    bevel: 0.0011,
    bevelSegments: 2,
    holes: [guardInner],
  });
  guard.rotateY(Math.PI / 2); // outline-X -> -Z (forward), extrusion -> across
  asm.add(guard, mat, { y: bore - 0.026, z: o.triggerZ });
  guard.dispose();

  // Grip boss + screw.
  const bossG = box(0.028, 0.012, 0.03, 0.0012, 2);
  asm.add(bossG, mat, { y: bore - 0.0255, z: zRear - 0.028, rx: -o.gripAngle * 0.5 });
  bossG.dispose();

  // Selector lever: a real paddle with a detent boss, both sides.
  return { magTop, magBottom, magZ, magTilt, wellH, magW, magD };
}

/** Ambidextrous safety selector — the paddle rotates around the X axis. */
export function selectorPart(matAlu, matSteel, r = 0.006) {
  const parts = [];
  const shaft = rodZ(r * 0.62, r * 0.62, 0.03, 12, 0.0004);
  shaft.rotateY(Math.PI / 2);
  parts.push(shaft);
  const boss = latheZ(
    [
      [0, 0],
      [0, r],
      [0.0012, r * 1.1],
      [0.005, r * 1.1],
      [0.005, 0],
    ],
    12
  );
  boss.rotateY(-Math.PI / 2);
  boss.translate(0.0135, 0, 0);
  parts.push(boss);
  const paddle = extrude(
    [
      [0, -0.0035],
      [0.021, -0.006],
      [0.024, 0.0],
      [0.02, 0.005],
      [0, 0.0045],
    ],
    0.0042,
    { bevel: 0.0008 }
  );
  paddle.rotateY(Math.PI / 2);
  paddle.translate(0.0185, 0, 0);
  parts.push(paddle);
  return { geo: mergeAll(parts), mat: matAlu };
}

/**
 * Curved trigger blade with a serrated face; pivots about its pin.
 *
 * The outline is a SIDE view: +X is rearward (the face the finger presses),
 * -Y is down. The whole blade is rotated at the end so that outline-X becomes
 * +Z and the 7 mm extrusion becomes the blade's width across the receiver —
 * without that the blade is a plate standing across the trigger guard.
 */
export function triggerPart(matSteel) {
  const blade = extrude(
    [
      [-0.0045, 0.0045],
      [0.0048, 0.0045],
      [0.0056, -0.008],
      [0.0044, -0.0158],
      [0.0016, -0.0202],
      [-0.0032, -0.0192],
      [-0.0055, -0.011],
      [-0.006, -0.002],
    ],
    0.0072,
    { bevel: 0.0007, bevelSegments: 2 }
  );
  const parts = [blade];
  // Serrations across the face the finger pad sits on.
  for (let i = 0; i < 6; i++) {
    const g = box(0.0015, 0.0011, 0.0066, 0.0003, 1);
    // Spin in place first, THEN place: rotating after the translate would swing
    // the serration around the blade's pivot instead of tilting it.
    g.rotateZ(-0.2 - i * 0.05);
    g.translate(0.0049 - i * 0.0004, -0.0045 - i * 0.0026, 0);
    parts.push(g);
  }
  const geo = mergeAll(parts);
  geo.rotateY(-Math.PI / 2); // outline-X -> +Z (rearward), extrusion -> across
  return { geo, mat: matSteel };
}

/* -------------------------------------------------------------------------- */
/*  grip / stock                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pistol grip with a palm swell, finger grooves, a beavertail and moulded
 * texture panels. Built along its own axis then rotated by `angle`.
 */
export function addPistolGrip(asm, matPoly, matRubber, o) {
  const len = o.len ?? 0.108;
  const w = o.w ?? 0.031;
  const angle = o.angle ?? 0.38; // rake: positive tilts the BOTTOM rearward
  const oy = o.y ?? 0;
  const oz = o.z ?? 0;

  // Side profile in (z, y), authored as one closed outline and extruded across
  // the grip's width. A single solid cannot develop the seams a lofted stack of
  // slices does, and the outline is where the shape actually lives: a swept
  // front strap with finger relief, a straight back strap, a beavertail.
  const zf = -0.0155; // front strap
  const zb = 0.0155; // back strap
  const profile = [
    [zb + 0.004, 0.008],
    [zf - 0.002, 0.007],
    [zf - 0.0035, -0.006],
    [zf - 0.0015, -0.02],
    [zf - 0.003, -0.034],
    [zf - 0.0005, -0.05],
    [zf - 0.002, -0.064],
    [zf + 0.001, -0.08],
    [zf + 0.0035, -len + 0.004],
    [zf + 0.008, -len],
    [zb - 0.006, -len],
    [zb - 0.001, -len + 0.006],
    [zb + 0.001, -0.06],
    [zb + 0.0025, -0.03],
    [zb + 0.006, -0.012],
  ];
  const core = extrude(profile, w, { bevel: 0.0035, bevelSegments: 3, curveSegments: 4 });
  core.rotateY(Math.PI / 2);
  asm.add(core, matPoly, { y: oy, z: oz, rx: -angle });
  core.dispose();

  // Palm swell on both flanks so the grip is not a slab.
  const swell = blob(0.008, len * 0.62, 0.03, 0.006, 3);
  for (const sx of [-1, 1]) {
    asm.add(swell, matPoly, {
      x: sx * (w * 0.5 - 0.0015),
      y: oy - len * 0.42,
      z: oz + 0.0035,
      rx: -angle,
    });
  }
  swell.dispose();

  // Beavertail behind the trigger, blending into the receiver.
  const beaver = blob(w * 0.96, 0.02, 0.024, 0.006, 3);
  asm.add(beaver, matPoly, { y: oy + 0.005, z: oz + 0.012, rx: -angle * 0.6 });
  beaver.dispose();

  // Rubberised over-mould: side panels plus the front-strap finger swells.
  const panel = blob(w * 1.03, len * 0.58, 0.019, 0.005, 3);
  asm.add(panel, matRubber, { y: oy - len * 0.44, z: oz + 0.0025, rx: -angle });
  panel.dispose();
  // Finger swells on the front strap: shallow cross-wise ridges, not rings.
  for (let i = 0; i < 4; i++) {
    const t = 0.15 + i * 0.2;
    const ridge = blob(w * 0.9, 0.011, 0.007, 0.003, 3);
    const yy = oy - t * len;
    const zz = oz + zf + 0.001 + Math.sin(t * Math.PI) * 0.001;
    // Rotate into the raked frame by hand so the ridge hugs the strap.
    const cs = Math.cos(-angle);
    const sn = Math.sin(-angle);
    asm.add(ridge, matRubber, {
      y: oy + (yy - oy) * cs - (zz - oz) * sn,
      z: oz + (yy - oy) * sn + (zz - oz) * cs,
      rx: -angle,
    });
    ridge.dispose();
  }

  // Grip cap with its screw.
  const capY = oy - Math.cos(angle) * len;
  const capZ = oz + Math.sin(angle) * len;
  const cap = blob(w * 0.92, 0.007, 0.031, 0.0025, 2);
  asm.add(cap, matPoly, { y: capY + 0.001, z: capZ, rx: -angle });
  cap.dispose();
  addScrew(asm, matRubber, 0, capY - 0.0015, capZ, 0.0026, 'y', 0.006);
}

/**
 * Collapsible carbine stock on a mil-spec receiver extension: 6 detent
 * positions, cheek weld, sling loop, adjustment lever and a rubber butt pad.
 */
export function addCarbineStock(asm, matAlu, matPoly, matRubber, o) {
  const bore = o.bore;
  const zRear = o.zRear; // butt
  const zFront = o.zFront; // receiver face
  const yAxis = o.y ?? bore - 0.012;
  const tubeR = 0.0146;
  const len = zRear - zFront;

  // receiver extension
  const ext = tubeZ(tubeR, tubeR - 0.0022, len - 0.004, 18, 0.0004);
  asm.add(ext, matAlu, { y: yAxis, z: (zRear + zFront) / 2 });
  ext.dispose();
  // castle nut + end plate
  const nut = latheZ(
    [
      [0, tubeR],
      [0, tubeR + 0.0034],
      [0.0016, tubeR + 0.0038],
      [0.0085, tubeR + 0.0038],
      [0.01, tubeR + 0.003],
      [0.01, tubeR],
    ],
    18
  );
  asm.add(nut, matAlu, { y: yAxis, z: zFront });
  nut.dispose();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const notch = box(0.0022, 0.0034, 0.006, 0.0004, 1);
    notch.translate(0, tubeR + 0.0032, 0);
    notch.rotateZ(a);
    notch.translate(0, yAxis, zFront + 0.005);
    asm.add(notch, matAlu, {});
    notch.dispose();
  }
  // detent notches along the bottom of the tube
  for (let i = 0; i < 6; i++) {
    const z = zFront + 0.026 + i * 0.018;
    if (z > zRear - 0.02) break;
    const n = box(0.0075, 0.0032, 0.0075, 0.0006, 1);
    asm.add(n, matAlu, { y: yAxis - tubeR + 0.0008, z });
    n.dispose();
  }

  // Stock body: a side profile extruded across the width, so the comb slopes
  // and the toe kicks down the way a collapsible carbine stock actually does.
  const bodyLen = 0.104;
  const bz = zRear - bodyLen / 2;
  const combY = yAxis + 0.026;
  const toeY = yAxis - 0.042;
  const outline = [
    [-bodyLen * 0.5, yAxis + 0.004],
    [-bodyLen * 0.5 + 0.012, yAxis + 0.017],
    [-bodyLen * 0.5 + 0.03, combY - 0.002],
    [bodyLen * 0.5 - 0.012, combY],
    [bodyLen * 0.5, combY - 0.006],
    [bodyLen * 0.5, toeY + 0.008],
    [bodyLen * 0.5 - 0.008, toeY],
    [-bodyLen * 0.5 + 0.028, toeY + 0.006],
    [-bodyLen * 0.5 + 0.008, yAxis - 0.02],
    [-bodyLen * 0.5, yAxis - 0.009],
  ];
  const shellParts = [];
  const shell = extrude(outline, 0.043, { bevel: 0.0035, bevelSegments: 2 });
  shell.rotateY(Math.PI / 2);
  shellParts.push(shell);
  // Cheek weld ridge along the comb.
  const cheek = blob(0.047, 0.012, bodyLen * 0.66, 0.005, 3);
  cheek.translate(0, combY - 0.002, -0.006);
  shellParts.push(cheek);
  // Lightening scallops on both flanks.
  for (const sx of [-1, 1]) {
    const sc = blob(0.005, 0.024, 0.052, 0.005, 3);
    sc.translate(sx * 0.0205, yAxis - 0.012, 0.004);
    shellParts.push(sc);
  }
  const body = mergeAll(shellParts);
  asm.add(body, matPoly, { z: bz });
  body.dispose();

  // adjustment lever under the stock
  const lever = extrude(
    [
      [-0.014, 0],
      [0.016, 0],
      [0.018, -0.007],
      [0.012, -0.011],
      [-0.012, -0.011],
      [-0.016, -0.005],
    ],
    0.014,
    { bevel: 0.0008 }
  );
  asm.add(lever, matPoly, { y: yAxis - 0.036, z: bz + 0.012 });
  lever.dispose();

  // Butt pad — rubber, with real grooves, following the comb-to-toe rake.
  const pad = blob(0.045, 0.072, 0.013, 0.0045, 3);
  asm.add(pad, matRubber, { y: yAxis - 0.008, z: zRear - 0.004, rx: 0.06 });
  pad.dispose();
  for (let i = 0; i < 5; i++) {
    const g = box(0.043, 0.0035, 0.005, 0.0012, 2);
    asm.add(g, matRubber, { y: yAxis + 0.02 - i * 0.0125, z: zRear + 0.0026, rx: 0.06 });
    g.dispose();
  }

  // sling loop + QD socket
  addSlingLoop(asm, matAlu, 0.0225, yAxis - 0.026, bz - 0.03, 0.0075, { ry: Math.PI / 2 });
  addQdSocket(asm, matPoly, matAlu, -0.0215, yAxis - 0.014, bz - 0.026, 'x', 0.005);
}

/**
 * Fixed precision-chassis stock — a machined skeleton, not a moulded shell.
 *
 * The silhouette is the whole point of it. A carbine stock is a solid wedge on a
 * buffer tube and reads as "assault rifle" from any angle; a chassis stock is a
 * spine with a THUMBHOLE cut through it, an adjustable comb standing proud on
 * two posts, and a butt plate on a length-of-pull rail. That cut-out is the one
 * feature that says "bolt gun" at 40 px of screen width, which is what the rear
 * half of the weapon occupies in hipfire framing.
 *
 *   spine     top rail of the stock, receiver face to the butt plate
 *   under     the lower strap that closes the thumbhole
 *   comb      adjustable cheek riser on two 8 mm posts
 *   plate     butt plate + rubber pad on the LOP rail
 *   monopod   the rear support spigot under the toe
 */
export function addChassisStock(asm, matAlu, matPoly, matRubber, o) {
  const bore = o.bore;
  const zFront = o.zFront; // receiver face
  const zRear = o.zRear; // butt pad
  const yAxis = o.y ?? bore - 0.016;
  const w = o.w ?? 0.0205;
  const len = zRear - zFront;

  // ---- spine: the top strap, running level with the receiver -------------
  const spine = box(w, 0.0235, len - 0.012, 0.0018, 2);
  asm.add(spine, matAlu, { y: yAxis + 0.0195, z: (zFront + zRear) / 2 - 0.004 });
  spine.dispose();
  // Lightening cuts along the spine flanks — a chassis is always milled out.
  for (let i = 0; i < 3; i++) {
    const cut = box(0.006, 0.013, 0.026, 0.0012, 2);
    asm.addMirrored(cut, 'cavity', {
      x: w * 0.5 - 0.002,
      y: yAxis + 0.0195,
      z: zFront + 0.03 + i * 0.036,
    });
    cut.dispose();
  }

  // ---- lower strap: closes the thumbhole and carries the grip tang -------
  const strap = extrude(
    [
      [-len * 0.5 + 0.006, yAxis - 0.006],
      [-len * 0.5 + 0.05, yAxis - 0.052],
      [len * 0.5 - 0.036, yAxis - 0.056],
      [len * 0.5 - 0.006, yAxis - 0.012],
      [len * 0.5 - 0.006, yAxis + 0.002],
      [len * 0.5 - 0.03, yAxis - 0.038],
      [-len * 0.5 + 0.058, yAxis - 0.034],
      [-len * 0.5 + 0.02, yAxis - 0.002],
    ],
    w - 0.003,
    { bevel: 0.0016, bevelSegments: 2 }
  );
  strap.rotateY(Math.PI / 2); // outline-X is fore/aft; extrude across the weapon
  asm.add(strap, matAlu, { z: (zFront + zRear) / 2 });
  strap.dispose();

  // ---- adjustable comb on two posts -------------------------------------
  for (const dz of [-0.03, 0.028]) {
    const post = rodZ(0.0042, 0.0042, 0.026, 10, 0.0005);
    asm.add(post, matAlu, {
      y: yAxis + 0.031 + 0.013,
      z: zFront + len * 0.46 + dz,
      rx: Math.PI / 2,
    });
    post.dispose();
    addScrew(asm, matAlu, w * 0.5 - 0.001, yAxis + 0.028, zFront + len * 0.46 + dz, 0.0026, 'x', 0.008);
  }
  const comb = blob(w + 0.008, 0.0155, 0.104, 0.005, 3);
  asm.add(comb, matPoly, { y: yAxis + 0.052, z: zFront + len * 0.46, rx: -0.035 });
  comb.dispose();
  // Cheek pad: rubber, so the one surface a face touches is not anodised alloy.
  const cheekPad = blob(w + 0.0035, 0.005, 0.09, 0.003, 3);
  asm.add(cheekPad, matRubber, { y: yAxis + 0.0605, z: zFront + len * 0.46, rx: -0.035 });
  cheekPad.dispose();

  // ---- butt plate on the length-of-pull rail -----------------------------
  const lopRail = box(w - 0.004, 0.008, 0.052, 0.0009, 1);
  asm.add(lopRail, matAlu, { y: yAxis - 0.004, z: zRear - 0.03 });
  lopRail.dispose();
  const plate = extrude(roundRect(w + 0.014, 0.096, 0.008, 4), 0.009, { bevel: 0.0014 });
  asm.add(plate, matAlu, { y: yAxis + 0.004, z: zRear - 0.006, rx: 0.05 });
  plate.dispose();
  const pad = blob(w * 0.5 + 0.009, 0.048, 0.0105, 0.004, 3);
  asm.add(pad, matRubber, { y: yAxis + 0.004, z: zRear + 0.001, rx: 0.05 });
  pad.dispose();
  for (let i = 0; i < 4; i++) {
    const g = box(w + 0.008, 0.0032, 0.005, 0.0011, 2);
    asm.add(g, matRubber, { y: yAxis + 0.026 - i * 0.0155, z: zRear + 0.0038, rx: 0.05 });
    g.dispose();
  }

  // ---- monopod spigot under the toe --------------------------------------
  const spigot = rodZ(0.0062, 0.0062, 0.03, 12, 0.0006);
  asm.add(spigot, matAlu, { y: yAxis - 0.046, z: zRear - 0.022, rx: Math.PI / 2 });
  spigot.dispose();
  const wheel = latheZ(
    [
      [0, 0],
      [0, 0.0092],
      [0.005, 0.0098],
      [0.009, 0.0092],
      [0.009, 0],
    ],
    16
  );
  asm.add(wheel, matAlu, { y: yAxis - 0.062, z: zRear - 0.022, rx: -Math.PI / 2 });
  wheel.dispose();

  addSlingLoop(asm, matAlu, w * 0.5 + 0.002, yAxis - 0.036, zFront + 0.05, 0.0075, {
    ry: Math.PI / 2,
  });
  addQdSocket(asm, matAlu, matAlu, -(w * 0.5 + 0.001), yAxis - 0.03, zFront + 0.078, 'x', 0.005);
}

/**
 * Folded bipod under the forend.
 *
 * Deployed it would be a prop that never touches the ground in a run-and-gun
 * shooter; folded it is two 150 mm legs lying back along the underside, which is
 * the read a marksman rifle needs from the side and costs a few hundred tris.
 */
export function addBipod(asm, matSteel, matPoly, o) {
  const y = o.y;
  const z = o.z;
  const spread = o.spread ?? 0.019;
  const legLen = o.legLen ?? 0.15;

  const hub = blob(0.026, 0.016, 0.03, 0.0026, 2);
  asm.add(hub, matPoly, { y: y + 0.005, z });
  hub.dispose();
  addPin(asm, matSteel, 0, y, z + 0.006, 0.0028, 0.03);

  for (const sx of [-1, 1]) {
    // Legs fold BACK and outward, so the feet end up under the magwell.
    const leg = rodZ(0.0055, 0.0048, legLen, 10, 0.0006);
    asm.add(leg, matSteel, {
      x: sx * spread,
      y: y - 0.004,
      z: z + legLen * 0.5 - 0.008,
      rx: 0.14,
      ry: sx * 0.05,
    });
    leg.dispose();
    const foot = blob(0.0072, 0.0062, 0.012, 0.0022, 2);
    asm.add(foot, matPoly, { x: sx * spread, y: y - 0.011, z: z + legLen - 0.006 });
    foot.dispose();
    const collar = latheZ(
      [
        [0, 0.0058],
        [0, 0.0072],
        [0.006, 0.0072],
        [0.006, 0.0058],
      ],
      12
    );
    asm.add(collar, matSteel, { x: sx * spread, y: y - 0.004, z: z + 0.042 });
    collar.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/*  magazine                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Polymer box magazine. Slight curve, moulded ribs, witness holes, a floor
 * plate with a finger ledge, feed lips and a visible top round.
 * Built in its own space: origin at the top of the feed lips, +Y up, body down.
 */
export function buildMagazine(asm, mats, o) {
  const w = o.w ?? 0.0255;
  const d = o.d ?? 0.0655;
  const len = o.len ?? 0.215;
  /** Sagitta of the feed curve in METRES over the magazine's length. */
  const curve = o.curve ?? 0.028;
  const segs = o.segs ?? 8;
  const poly = o.poly ?? 'polymer';

  // Arc: y runs down, z bows forward (-Z), and each slice is rotated to the
  // local tangent so the stack reads as one continuous curved body.
  const at = (t) => ({
    y: -t * len,
    z: -curve * t * t,
    tilt: Math.atan2(2 * curve * t, len),
  });

  const bodyParts = [];
  const ribParts = [];
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const p = at(t);
    const taper = 1 - t * 0.04;
    const seg = extrude(roundRect(w * taper, d * taper, 0.0055, 5), step * 1.06, {
      bevel: 0.0008,
    });
    seg.rotateX(Math.PI / 2 + p.tilt);
    seg.translate(0, p.y, p.z);
    bodyParts.push(seg);

    // Moulded grip ribs down the flanks.
    if (i > 0 && i < segs - 1) {
      for (const sx of [-1, 1]) {
        const rib = box(0.0018, step * 0.62, d * 0.66, 0.0005, 1);
        rib.rotateX(p.tilt);
        rib.translate(sx * (w * taper * 0.5), p.y, p.z);
        ribParts.push(rib);
      }
    }
  }

  // Feed lips: two rails either side of the mouth, plus the rear catch notch.
  const lip = extrude(
    [
      [-0.0032, 0],
      [0.0032, 0],
      [0.0026, 0.009],
      [-0.0026, 0.009],
    ],
    d * 0.9,
    { bevel: 0.0005 }
  );
  lip.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const g = lip.clone();
    g.translate(sx * (w * 0.5 - 0.0032), -0.0015, 0);
    bodyParts.push(g);
  }
  lip.dispose();
  const notch = box(0.008, 0.0075, 0.0055, 0.0009, 1);
  notch.translate(0, -0.03, d * 0.5 + 0.0015);
  bodyParts.push(notch);

  // Floor plate + finger ledge, on the arc's tangent.
  const end = at(1);
  const plate = extrude(roundRect(w + 0.0026, d * 0.97, 0.004, 4), 0.01, { bevel: 0.001 });
  plate.rotateX(Math.PI / 2 + end.tilt);
  plate.translate(0, end.y - 0.0035, end.z);
  bodyParts.push(plate);
  const ledge = box(w + 0.0034, 0.007, 0.013, 0.0016, 2);
  ledge.rotateX(end.tilt);
  ledge.translate(0, end.y - 0.007, end.z - d * 0.4);
  bodyParts.push(ledge);
  // Base pad, a slightly different polymer batch.
  const pad = extrude(roundRect(w + 0.003, d * 0.9, 0.004, 4), 0.005, { bevel: 0.0009 });
  pad.rotateX(Math.PI / 2 + end.tilt);
  pad.translate(0, end.y - 0.0105, end.z);

  const body = mergeAll(bodyParts);
  asm.add(body, poly, {});
  body.dispose();
  const ribs = mergeAll(ribParts);
  if (ribs) {
    asm.add(ribs, poly, {});
    ribs.dispose();
  }
  asm.add(pad, 'rubber', {});
  pad.dispose();

  // Witness holes: recessed dark slots down both sides.
  const holes = o.witness ?? 4;
  for (let i = 0; i < holes; i++) {
    const t = 0.26 + (i / Math.max(1, holes - 1)) * 0.56;
    const p = at(t);
    for (const sx of [-1, 1]) {
      const h = extrude(roundRect(0.0085, 0.0044, 0.0018, 3), 0.004, { bevel: 0.0004 });
      h.rotateY(Math.PI / 2);
      h.rotateX(p.tilt);
      h.translate(sx * (w * 0.5 - 0.0006), p.y, p.z);
      asm.add(h, 'cavity', {});
      h.dispose();
    }
  }

  // The top round under the feed lips — the detail everyone notices.
  // It lies along the magazine's DEPTH axis (bullet forward, -Z) like a real
  // stack, not across its width; the cartridge is authored base-at-0 running
  // +Z, so ry=PI turns it muzzle-forward and the case head ends up at the rear
  // wall. Rotated the other way it lances straight out through the mag's flank.
  const caseLen = o.caseLen ?? 0.0446;
  const bulletLen = o.bulletLen ?? 0.019;
  const c = cartridge(caseLen, o.rimR ?? 0.00495, bulletLen);
  const cz = Math.min(d * 0.5 - 0.0025, caseLen + bulletLen - d * 0.5 + 0.0015);
  asm.add(c.brass, 'brass', { y: -0.0085, z: cz, ry: Math.PI });
  asm.add(c.bullet, 'copper', { y: -0.0085, z: cz, ry: Math.PI });
  c.brass.dispose();
  c.bullet.dispose();

  return { len, w, d };
}

/* -------------------------------------------------------------------------- */
/*  optics + sights                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Tube red-dot sight (T2 pattern) on a cantilever mount.
 * Returns the reticle plane's local position so the rig can align it to screen
 * centre in ADS, plus the aperture radius for the vignette.
 *
 * Built centred on (0, 0, 0) in optic space; the caller positions it.
 */
export function buildOptic(asm, o) {
  const rTube = o.rTube ?? 0.0155;
  const len = o.len ?? 0.068;
  const matBody = o.matBody ?? 'alu';
  const matSteel = o.matSteel ?? 'steel';
  const y = o.y ?? 0;
  const z = o.z ?? 0;
  const railTop = o.railTop;

  /**
   * SEGMENT BUDGET.
   *
   * In ADS the objective ring is ~250 px across and it is the single largest
   * curve on screen, so it is the one place in the whole game where a 24-gon is
   * COUNTABLE. 56 segments puts the facet sagitta at 250 * (1-cos(3.2 deg)) /2 =
   * 0.2 px, i.e. under the AA threshold. The interior rings matter just as much
   * as the outer one, because a hard dark/light boundary shows faceting far more
   * readily than a shaded exterior does.
   */
  const SEG = 72;
  const SEG_IN = 80;

  /**
   * THE APERTURE BUDGET — the whole reason the ADS frame read as a drainpipe.
   *
   * Looking down a tube from a fixed eye point, the visible sight picture is the
   * SMALLER of two cones: the ocular bore subtended at the eye relief, and the
   * objective bore subtended at (relief + length). With the old geometry — a
   * 70 mm tube, a straight 0.71*rTube bore and 78 mm of eye relief — those were
   *   ocular    0.011 / 0.078  -> 158 px
   *   objective 0.011 / 0.148  ->  87 px
   * so the objective won by a factor of 1.8 and the resulting sight picture was
   * 87 px of a 256 px housing radius: 34%. Measured on ads.png, and it is
   * exactly what "a flat grey wedge where glass should be" and "four concentric
   * rings that shrink the sight picture to a third of the tube" describe. The
   * 69 px of dark tube wall between them is over a quarter of the frame height.
   *
   * The fix is not a material and it is not a segment count. A real red dot beats
   * this by having an objective lens BIGGER than its exit aperture — the bore
   * flares and the front of the housing carries an objective bell. So:
   *
   *   bore   12.2 mm radius at the ocular, FLARING to 16.5 mm at the objective
   *   shell  15.5 mm radius at the ocular, belling to 19.0 mm at the objective
   *   length 52 mm (was 70)
   *   relief 115 mm (was 78, see defs.js eyeRelief)
   *
   * which lands both cones on the same number — the mark of a correctly stopped
   * optical train, and the reason a real sight has no visible second vignette:
   *   ocular    0.0122 / 0.115 -> 118 px
   *   objective 0.0165 / 0.160 -> 115 px
   *   housing   0.0163 / 0.108 -> 168 px
   * A 230 px sight picture inside a 336 px housing: 69% instead of 34%, and the
   * housing itself drops from 50% of frame height to 31%, which is where a modern
   * shooter actually frames a tube sight.
   *
   * A MAGNIFIED scope has to solve the same budget with a much longer tube, and
   * the only variable that pays for the length is the objective: a 3-4x glass is
   * a 35 mm tube with a 50-56 mm front bell, not a straight pipe. `boreOb` /
   * `bellOb` exist for that — the objective cone is what keeps
   * `boreOb*rTube / (relief + len)` on top of `boreOc*rTube / relief` once `len`
   * doubles. The defaults are the red dot's, so the carbine and the SMG are
   * bit-identical to before.
   */
  const rBoreOc = rTube * (o.boreOc ?? 0.787); // 12.2 mm on a 15.5 mm tube
  const rBoreOb = rTube * (o.boreOb ?? 1.065); // flared to 16.5 mm at the objective
  const rBellOb = rTube * (o.bellOb ?? 1.226); // 19.0 mm objective bell
  const zOc = len / 2;
  const zOb = -len / 2;

  /**
   * WIDE EYEPIECE — and why the aperture budget above cannot deliver one.
   *
   * Everything from here to the objective is solved for a sight picture that is
   * literally SEEN THROUGH the tube, and that construction has a hard ceiling on
   * how much of the housing the glass can fill. Measured on the ADS frame at
   * 1600x900 (src/weapons/preview.js `view=ads`, which is the ADS eye point):
   *
   *   housing silhouette   19.08 mm @  92.5 mm  ->  tan 0.2062   404 px
   *   sight picture (stop) 24.85 mm @ 203.5 mm  ->  tan 0.1221   240 px
   *
   * and 240 px is the OPTIMISTIC number — the eye-relief ring and the vignette
   * take the measured edge in to 188 px, a bezel wider than the glass. Even at
   * 240 that is a 26 % bezel, and the ratio is fixed by the two DISTANCES, not by the
   * radii: the eyecup is 93 mm from the eye and the objective bore is 204 mm, so
   * the objective has to be 2.2x the eyecup's radius just to break even. Filling
   * 90 % of the housing needs a 37 mm bore radius on a 17.5 mm tube — a 75 mm
   * objective on a 35 mm body, a megaphone. Shortening the tube does not help:
   * even at len = 0 the eye is close enough that the bore would still have to be
   * 1.5x the tube.
   *
   * So a magnified scope stops being a see-through tube. `wideEyepiece` opens the
   * ocular clear aperture to (just past) the full tube, narrows the eyecup to a
   * rim, and returns a `mask` — a depth-only disc the viewmodel draws first, in
   * ADS only. Because the viewmodel has its own colour+depth target and is
   * composited premultiplied over the world (see render/index.js steps 9 + 14),
   * a disc that writes depth and no colour leaves those pixels at alpha 0: the
   * already-rendered, already-3.3x-zoomed world shows through, and every part of
   * the weapon behind the disc — the light trap, the objective, the tube wall,
   * the turrets, and the muzzle brake 660 mm downrange — is depth-rejected out of
   * the glass. That is the same picture a real scope's eyepiece projects, at the
   * cost of one extra draw and no extra scene pass.
   *
   * The ocular stack is then sized off the APERTURE CONE rather than off one
   * radius. The cone through the eyecup lip diverges by 0.18 mm per mm of depth,
   * so glass sized on the lip's radius but sunk 7 mm in leaves a bright untinted
   * ring around the sight picture; every element below sits within 4.5 mm of the
   * lip and is sized to land on the same circle.
   */
  const wide = !!o.wideEyepiece;
  // Outer radius of the ocular ring — the short flare at the rear of the tube.
  const rOcRing = rTube * (o.bellOc ?? 1.05);

  /**
   * Main tube: a straight section at the ocular, a conical flare, then the
   * objective bell. Every rim carries a 0.3 mm chamfer face — the only thing on
   * the silhouette that can catch a specular line and say the rim has thickness.
   *
   * The bell is deliberately SMALLER on screen than the ocular rim (135 px against
   * 168 px at the ADS eye point), so it never breaks the housing's outer circle:
   * from behind the sight the silhouette is one clean ring, and from the side in
   * hipfire the bell is what makes the optic read as a red dot rather than a pipe.
   */
  const tube = latheZ(
    [
      [zOb, rBoreOb * 0.995],
      [zOb + 0.0004, rBellOb * 0.99],
      [zOb, rBellOb * 1.008],
      [zOb + 0.0022, rBellOb],
      [zOb + 0.008, rBellOb * 0.995],
      [zOb + 0.014, rTube * 1.1],
      [zOb + 0.022, rTube * 1.01],
      [zOb + 0.03, rTube],
      [zOc - 0.012, rTube],
      [zOc - 0.01, rOcRing],
      [zOc - 0.002, rOcRing],
      // Rear face. On a wide eyepiece the bore is WIDER than the tube's mid-body
      // radius, so the face is what is left of the ocular ring's wall — 0.24 mm
      // of chamfered rim, and the rubber sleeves it (see the eyecup below).
      [zOc - 0.0003, wide ? rOcRing * 0.995 : rTube * 1.02],
      [zOc, wide ? rOcRing * 0.985 : rTube * 0.995],
      [zOc, wide ? rBoreOc * 1.005 : rBoreOc * 1.02],
    ],
    SEG
  );
  asm.add(tube, matBody, { y, z });
  tube.dispose();

  /**
   * Interior: a LIGHT TRAP, not a black hole, and now a CONE rather than a
   * cylinder. `cavity` (0.0015 linear) had nothing for the fill or the bounce off
   * the objective to land on. `optic_tube` is 0.0205 linear at roughness 0.9 with
   * the grazing lobe clamped: still black, but a black with a readable gradient
   * down it. See WeaponMaterials.opticTube().
   *
   * Because the cone opens away from the eye, the wall is seen at a much shallower
   * angle than a cylinder's would be, so it occupies a thin 3 px annulus instead
   * of a 69 px band — which is the geometric half of the drainpipe fix.
   *
   * The trap's ocular end doubles as the FIELD STOP on a wide eyepiece, so it
   * runs 7.5 mm further back — right up under the rubber lip. Stopping it 9 mm
   * short (which is correct behind a 12 mm bore, where the eye-relief ring below
   * covers the gap) would leave the last few millimetres of bore unmodelled, and
   * with the aperture now at the tube wall that gap is inside the sight picture:
   * back-face culling turns it into a notch of see-through at the rim.
   */
  const zTrapOc = zOc - (wide ? 0.002 : 0.009);
  const baffle = latheZ(
    [
      [zOb + 0.001, rBoreOb],
      [zOb + 0.001, rBoreOb * 0.985],
      // The rear lip is a FRACTION of the bore, so it grows with it: 1.5 % is the
      // 0.18 mm shoulder a 12 mm red dot bore wants and 0.55 mm — another ring of
      // bezel — on a 36 mm one. 0.3 % holds it at a 1 px hairline and hands the
      // framing back to the rubber lip 0.8 mm outboard.
      [zTrapOc, rBoreOc * (wide ? 0.997 : 0.985)],
      [zTrapOc, rBoreOc],
    ],
    SEG_IN
  );
  asm.add(baffle, 'optic_tube', { y, z });
  baffle.dispose();
  /**
   * NO INTERNAL BAFFLE STEPS. Three shallow rings down the bore were tried, on
   * the theory that each would shade the one behind it and give the trap a
   * gradient. Measured in ADS: they did the opposite. Each step's inner lip is an
   * annulus facing the eye and they rendered as four concentric LIGHT-GREY rings.
   * The gradient has to come from the wall itself, not from geometry in the bore.
   */

  // The ocular clear aperture — everything downstream (vignette, edge ring,
  // reticle vignette) is derived from this one number.
  const lensR = rBoreOc * (wide ? 1.0 : 0.99);
  // How far behind the tube's rear face the ocular stack sits. A wide eyepiece
  // pulls it up against the rim (see the aperture-cone note above); a red dot
  // keeps the deep-set element the eye-relief ring is built around.
  const zStack = wide ? 0.0032 : 0.007;

  /**
   * EYE-RELIEF RING. A real sight has a black field stop right behind the ocular
   * lens: the shoulder between the glass and the tube wall is in shadow from
   * every direction, and it is what frames the sight picture. Without it the
   * aperture edge is the tube's own lit inner wall and the "glass" reads as a
   * drilled hole. It is 1.2 mm deep and no more — anything longer is another
   * concentric ring.
   *
   * A wide eyepiece has no shoulder to put it on — the bore IS the tube — and it
   * does not need one: the rubber lip 0.8 mm outboard is already an unlit edge
   * against the glass, and the light trap now runs up to `zTrapOc` to supply the
   * hairline. This ring is measurably the "thick black inner ring": at a 12 mm
   * bore it is a 3.4 mm annulus facing the eye, 60 px of the 404 px housing.
   */
  if (!wide) {
    const relief = latheZ(
      [
        [0, lensR * 0.998],
        [0.0012, lensR * 1.012],
        [0.0034, rBoreOc * 1.01],
        [0.0038, rTube * 1.0],
        [0.0038, rBoreOc],
        [0, rBoreOc],
      ],
      SEG_IN
    );
    asm.add(relief, 'optic_tube', { y, z: z + zOc - 0.0045 });
    relief.dispose();
  }

  // Lens elements — AR-coated glass, both ends, slightly dished. The coating's
  // angle-dependent hue (green on axis, magenta by 70 deg) lives on the
  // material: see WeaponMaterials.glass(). The objective element is the big one,
  // as it is on the real product.
  const lensOc = latheZ(
    [
      [0, 0],
      [-0.0009, lensR * 0.6],
      [-0.0014, lensR],
    ],
    SEG_IN
  );
  const lensOb = latheZ(
    [
      [0, 0],
      [-0.0012, rBoreOb * 0.58],
      [-0.0019, rBoreOb * 0.985],
    ],
    SEG_IN
  );
  asm.add(lensOb, 'glass', { y, z: z + zOb + 0.0055 });
  asm.add(lensOc, 'glass', { y, z: z + zOc - zStack, ry: Math.PI });
  lensOc.dispose();
  lensOb.dispose();

  /**
   * INNER-EDGE REFLECTION RING.
   *
   * The unmistakable cue that a tube contains glass rather than air is a thin,
   * very bright arc a millimetre inside the objective rim — the inside of the
   * bezel reflected in the front surface of the lens. It is a property of the
   * LENS, so it is a 0.5 mm additive ring sitting on the glass, not a bright
   * band painted onto the bezel. Painting it on the bezel is precisely the
   * failure mode that produced the cream ring around the front lip: a fat, warm,
   * grazing-lit annulus instead of a hairline specular.
   */
  // HAIRLINE, and on the ocular only — the objective's ring is behind two lenses
  // and a light trap, so it can only add haze. At 0.965-0.99 of the clear
  // aperture this is 0.4 mm wide, which is ~4 px at full ADS. The first attempt
  // was 0.9-0.965 at intensity 0.55 and rendered as a 12 px blown-white band
  // right around the sight picture: a worse artefact than the one it replaced.
  {
    // 0.965 of a 12 mm aperture is the 0.30 mm the note above is about; 0.965 of a
    // 36 mm one is 0.9 mm, and the hairline comes back as the blown band. Held at
    // an absolute width on a wide eyepiece: 6 px at ADS scale rather than 18.
    const edge = new THREE.RingGeometry(
      wide ? lensR * 0.99 - 0.00032 : lensR * 0.965,
      lensR * 0.99,
      SEG_IN,
      1
    );
    asm.add(edge, 'lens_ring', { y, z: z + zOc - zStack + 0.0004 });
    edge.dispose();
  }

  /**
   * TUBE VIGNETTE. 6-8% darkening toward the rim of the exit pupil, from the
   * field stop and the tube wall eating the outer rays. It is a flat disc with a
   * radial alpha ramp (see WeaponMaterials.lensVignette) sitting just inside the
   * ocular glass, so it darkens the sight picture and nothing else.
   */
  const vig = new THREE.CircleGeometry(lensR * 0.995, SEG_IN);
  asm.add(vig, wide ? 'lens_vig_soft' : 'lens_vig', {
    y,
    z: z + zOc - zStack - (wide ? 0.0006 : 0.0015),
  });
  vig.dispose();

  /**
   * APERTURE MASK — the depth-only disc described at the top of this function.
   *
   * It is NOT added to the assembly: it needs its own draw order (first, so the
   * geometry it hides has not already written colour) and its own visibility (it
   * only exists once the eye is behind the glass), and an Assembly bucket is a
   * merged, always-on mesh. `buildOptic` returns the placement and the Viewmodel
   * owns the mesh — see Viewmodel.addWeapon / _updateApertureMask.
   *
   * 4.5 mm behind the rear face puts it in front of the light trap's field stop
   * (`zTrapOc`, 2 mm) and behind every element of the ocular stack, so the glass,
   * the edge ring and the vignette all still draw over the sight picture. The
   * radius is 5.5 % proud of the bore: enough that the rubber lip is what the eye
   * sees the picture end at rather than the mask itself, and still 10 % inside the
   * housing silhouette so it can never punch a hole in the eyecup.
   */
  const mask = wide ? { y, z: z + zOc - 0.0045, r: rBoreOc * 1.055 } : null;

  /**
   * Turrets: windage on the right, elevation on top, each a knurled cap with an
   * engraved click scale. The scale is real geometry in the part's own local
   * space rather than a projected decal, so it can never swim as the viewmodel
   * animates — the same reason the rollmark below is modelled.
   */
  const turret = (() => {
    const parts = [];
    parts.push(
      latheZ(
        [
          [0, 0.0062],
          [0.004, 0.0075],
          [0.0075, 0.0075],
          [0.0085, 0.0068],
          [0.0125, 0.0068],
          [0.0128, 0.006],
          [0.0128, 0],
        ],
        32
      )
    );
    parts.push(knurlBand(0.0072, 0.0052, 26, 0.00032, 3).translate(0, 0, 0.0102));
    return mergeAll(parts);
  })();
  // Engraved click marks around the turret skirt: 12 short recessed dashes and
  // one long index, cut in the cavity material so each reads as a dark line.
  const marks = (() => {
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const long = i === 0;
      const h = long ? 0.0026 : 0.0014;
      const t = box(0.00035, h, 0.0006, 0.00008, 1);
      t.rotateZ(a);
      t.translate(Math.cos(a) * (0.0075 - h * 0.42), Math.sin(a) * (0.0075 - h * 0.42), 0);
      parts.push(t);
    }
    return mergeAll(parts);
  })();
  // Elevation on top (its local +Z ends up along +Y), windage on the right (+X).
  // The marks sit 5.5 mm up each turret's own axis, on the skirt below the knurl.
  const elev = { y: y + rTube * 0.9, z: z + 0.004, rx: -Math.PI / 2 };
  const wind = { x: rTube * 0.9, y, z: z + 0.004, ry: Math.PI / 2 };
  asm.add(turret, matBody, elev);
  asm.add(turret, matBody, wind);
  asm.add(marks, 'cavity', { ...elev, y: elev.y + 0.0055 });
  asm.add(marks, 'cavity', { ...wind, x: wind.x + 0.0055 });
  turret.dispose();
  marks.dispose();

  // Battery cap / brightness dial on the left.
  const dial = latheZ(
    [
      [0, 0.008],
      [0.005, 0.0092],
      [0.0125, 0.0092],
      [0.0128, 0.008],
      [0.0128, 0],
    ],
    32
  );
  asm.add(dial, matBody, { x: -rTube * 0.9, y, z: z - 0.006, ry: -Math.PI / 2 });
  dial.dispose();
  const dialKnurl = knurlBand(0.0094, 0.006, 26, 0.00028, 3);
  asm.add(dialKnurl, matBody, { x: -rTube * 0.9 - 0.008, y, z: z - 0.006, ry: -Math.PI / 2 });
  dialKnurl.dispose();

  /**
   * Mount: a slim cantilever riser clamped to the rail with two crossbolts.
   * The riser is NARROW (9 mm) and waisted — a full-width block under the tube
   * is the single thing that makes a red dot read as a plumbing fixture when
   * you are looking straight down it in ADS.
   *
   * `mountTop` is TANGENT to the tube's outer wall. It used to be y - rTube*0.35,
   * which put the top face of the riser 5 mm ABOVE the floor of the tube bore —
   * so in ADS a lit grey slab cut clean across the bottom third of the sight
   * picture. The riser must never enter the bore.
   */
  const mountTop = y - rTube;
  const mountH = mountTop - railTop;
  /**
   * `ringZ` is where the two clamps sit relative to the tube centre. A 52 mm red
   * dot carries one short cantilever, so the default pair is 26 mm apart; a
   * 105 mm scope in a one-piece mount needs them spread over most of the tube or
   * the glass reads as balanced on a peg. Same part, two spacings.
   */
  const ringZ = o.ringZ ?? [-0.014, 0.012];
  const base = extrude(
    [
      [-0.0092, 0],
      [0.0092, 0],
      [0.0105, -0.0025],
      [0.0072, -mountH * 0.45],
      [0.0072, -mountH + 0.005],
      [0.013, -mountH + 0.0018],
      [0.013, -mountH],
      [-0.013, -mountH],
      [-0.013, -mountH + 0.0018],
      [-0.0072, -mountH + 0.005],
      [-0.0072, -mountH * 0.45],
      [-0.0105, -0.0025],
    ],
    o.mountLen ?? 0.03,
    { bevel: 0.0008 }
  );
  asm.add(base, matBody, { y: mountTop, z: z + 0.002 });
  base.dispose();
  // ring clamp around the tube
  const clamp = latheZ(
    [
      [0, rTube],
      [0, rTube + 0.0035],
      [0.0055, rTube + 0.0035],
      [0.0055, rTube],
    ],
    SEG
  );
  for (const rz of ringZ) asm.add(clamp, matBody, { y, z: z + rz });
  clamp.dispose();
  for (const rz of ringZ) {
    addScrew(asm, matSteel, 0.0135, mountTop - 0.004, z + rz + 0.0025, 0.0028, 'x', 0.01);
  }
  // recoil lug + rail clamp bolts
  const clampBar = box(0.032, 0.006, (o.mountLen ?? 0.03) + 0.002, 0.0008, 1);
  asm.add(clampBar, matBody, { y: railTop + 0.001, z: z + 0.002 });
  clampBar.dispose();
  addScrew(asm, matSteel, 0.0165, railTop + 0.001, z - 0.008, 0.003, 'x', 0.012);
  addScrew(asm, matSteel, 0.0165, railTop + 0.001, z + 0.012, 0.003, 'x', 0.012);

  /**
   * RUBBER EYEPIECE BEZEL — and this is the fix for the cream ring.
   *
   * MEASURED, by mapping the ADS frame radially against the known radius of every
   * feature: the bright warm band the critique called "a rim of unpainted MDF" sat
   * at screen radius 225-262 px, which is the tube's own rear rim chamfer and
   * outer flank at 1.00-1.05 rTube. It is not albedo — an anodised oxide at 0.003
   * linear cannot reach 200 sRGB — it is the grazing specular lobe: those two
   * surfaces are nearly edge-on to the eye and they sit right in the reflection
   * path of the viewmodel's warm rim light.
   *
   * Two things are needed and neither works alone. The material clamp (alu_fine
   * specularIntensity, see materials.js) takes the amplitude down; but as long as
   * an ALUMINIUM surface is what the eye is looking at, at 89 degrees of incidence
   * something will always light up. So the rear of the sight stops being aluminium
   * at all: the rubber bezel now covers the bore lip, the whole rear annulus, the
   * rim chamfer AND wraps 6 mm down the outside of the flank, out to 1.10 rTube —
   * past the widest point of the housing, so the entire outer circle of the optic
   * in ADS is moulded rubber. Which is also what a real sight's rubber bumper is
   * for and where it sits.
   *
   * `rubber` rather than `cavity`: cavity is 0.0015 linear and unlit, so it reads
   * as a hole punched in the frame. Moulded rubber is nearly as dark but it takes
   * the mask bake, the micro-relief and a faint shading gradient, so the bezel
   * reads as a surface.
   *
   * On a WIDE EYEPIECE the same part becomes a RIM. Every radius that sets the
   * silhouette is untouched — 1.075 at 1.6 mm, the 1.1 crown at 5.5 mm, the 1.09
   * rear-most point at 7.2 mm — so the optic's outer circle in ADS is the same
   * 404 px it always was. Only the lip moves: out from 0.787 rTube to 0.995 of a
   * bore that is now 1.04 rTube, which leaves 0.97 mm of rubber between the glass
   * and the crown. Measured on the ADS frame: 357 px of sight picture to the hard
   * edge, 348 px to the half-luminance crossing (a coated lens does not end on a
   * pixel), inside 404 px of housing — a 5.8-6.9 % bezel against the 26 % it
   * replaces. The rim is still 24 px wide on screen, which is all the moulded
   * rubber ever needed to carry its own shading.
   *
   * The flank comes back at 1.06 rTube rather than 1.03: it now sleeves the
   * ocular ring (`rOcRing`, 1.075) instead of the bare tube, and rubber sunk
   * inside the alloy it is supposed to cover is a z-fight, not a bumper.
   */
  const cup = latheZ(
    wide
      ? [
          [0, rBoreOc * 0.995],
          [0.0006, rBoreOc * 1.012],
          [0.0016, rTube * 1.075],
          [0.0055, rTube * 1.1],
          [0.0072, rTube * 1.09],
          [-0.0042, rTube * 1.085],
          [-0.0048, rOcRing * 1.004],
        ]
      : [
          [0, rBoreOc * 0.995],
          [0.0004, rBoreOc * 1.03],
          [0.0009, rTube * 1.02],
          [0.0018, rTube * 1.075],
          [0.0055, rTube * 1.1],
          [0.0072, rTube * 1.09],
          [-0.0042, rTube * 1.085],
          [-0.0048, rTube * 1.03],
        ],
    SEG
  );
  asm.add(cup, 'rubber', { y, z: z + zOc - 0.0012 });
  cup.dispose();
  /**
   * Objective shade. It rides on the BELL now, so it is wider than the tube and
   * (like the bell) still projects inside the ocular rim in ADS — it can never
   * break the housing silhouette. The inside is the light-trap material for the
   * same reason the bore is: a near-cylindrical anodised wall pointed at the sky
   * is the other place the cream ring used to come from.
   */
  const hoodLen = o.hood ?? 0.009;
  const hood = latheZ(
    [
      [0, rBellOb * 1.0],
      [0, rBellOb * 1.05],
      [hoodLen - 0.0003, rBellOb * 1.05],
      [hoodLen, rBellOb * 1.035],
      [hoodLen, rBellOb * 0.99],
    ],
    SEG
  );
  asm.add(hood, matBody, { y, z: z + zOb - hoodLen + 0.0015 });
  hood.dispose();
  const hoodLiner = tubeZ(rBellOb * 1.035, rBellOb * 0.998, hoodLen - 0.0008, SEG, 0.0002);
  asm.add(hoodLiner, 'optic_tube', { y, z: z + zOb - hoodLen * 0.5 + 0.0015 });
  hoodLiner.dispose();
  // A rubber bumper on the objective rim too — same argument as the eyepiece, and
  // it is the part of the optic that faces the camera in hipfire.
  const obBumper = latheZ(
    [
      [0, rBellOb * 1.01],
      [0.0006, rBellOb * 1.075],
      [0.0038, rBellOb * 1.08],
      [0.005, rBellOb * 1.03],
    ],
    SEG
  );
  asm.add(obBumper, 'rubber', { y, z: z + zOb - hoodLen - 0.0035 });
  obBumper.dispose();

  return {
    center: [0, y, z],
    lensZ: z + zOc - 0.007,
    // The exit pupil the reticle vignettes against is the ocular clear aperture.
    apertureR: lensR * 0.94,
    tubeR: rTube,
    len,
    // Depth-only sight-picture mask, or null on a see-through optic.
    mask,
    // Which reticle the viewmodel collimates behind this glass: a red dot's
    // emitter, or a magnified scope's etched crosshair. See Viewmodel._updateReticle.
    reticle: o.reticle ?? 'dot',
  };
}

/**
 * Engraved rollmark / calibre stamp.
 *
 * A machined receiver always carries one, and it is one of the very few cues that
 * tells the eye the surface is metal that has been through a press rather than a
 * moulded shell. It is modelled as real recessed strokes in the part's own local
 * space — not a projected decal — precisely because the viewmodel translates and
 * rotates every frame: anything sampled in world space swims across the receiver.
 *
 * At 0.35 m a 4 mm rollmark is ~12 px tall, so what has to be right is the RHYTHM
 * of the strokes and the underline, not the letterforms. The pattern is fixed, so
 * the mark is byte-identical every boot (capture reproducibility).
 */
export function addRollmark(asm, mat, o) {
  const h = o.h ?? 0.0036;
  const stroke = o.stroke ?? 0.0006;
  const depth = o.depth ?? 0.0008;
  const pitch = o.pitch ?? 0.0017;
  const pat = o.pattern ?? [3, 2, 3, 3, 1, 0, 2, 3, 2, 3, 0, 3, 1, 2, 3, 2, 0, 3, 3, 2];
  const n = o.count ?? pat.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const p = pat[i % pat.length];
    if (p === 0) continue;
    const bh = h * (0.52 + p * 0.16);
    const b = box(depth, bh, stroke, 0.00008, 1);
    b.translate(0, (h - bh) * 0.5, -i * pitch);
    parts.push(b);
    if (p === 3) {
      // a crossbar, so a run of strokes reads as letters and not as a comb
      const c = box(depth, stroke * 0.85, pitch * 0.72, 0.00008, 1);
      c.translate(0, (h - bh) * 0.5 + bh * 0.16, -i * pitch - pitch * 0.3);
      parts.push(c);
    }
  }
  const line = box(depth, stroke * 0.9, (n - 1) * pitch, 0.00008, 1);
  line.translate(0, -h * 0.55, -(n - 1) * pitch * 0.5);
  parts.push(line);
  const g = mergeAll(parts);
  if (o.sx) g.scale(o.sx, 1, 1);
  asm.add(g, mat, { x: o.x, y: o.y, z: o.z });
  g.dispose();
}

/** Folding front sight: post, protective ears, hinge, detent. */
export function addFrontSight(asm, matSteel, matAlu, x, railTop, z, up = true) {
  const baseG = box(0.024, 0.008, 0.019, 0.0008, 1);
  asm.add(baseG, matAlu, { x, y: railTop + 0.004, z });
  baseG.dispose();
  const hinge = rodZ(0.0026, 0.0026, 0.026, 10, 0.0003);
  asm.add(hinge, matSteel, { x, y: railTop + 0.008, z: z + 0.006, ry: Math.PI / 2 });
  hinge.dispose();

  const h = up ? 0.03 : 0.006;
  const tilt = up ? 0 : -1.35;
  const earL = extrude(
    [
      [-0.0022, 0],
      [0.0022, 0],
      [0.0022, h],
      [0, h + 0.002],
      [-0.0022, h],
    ],
    0.0075,
    { bevel: 0.0005 }
  );
  const ears = [];
  for (const sx of [-1, 1]) {
    const g = earL.clone();
    g.translate(sx * 0.0088, 0, 0);
    ears.push(g);
  }
  earL.dispose();
  // the post itself
  const post = rodZ(0.0011, 0.0009, h * 0.72, 8, 0.0002);
  post.rotateX(Math.PI / 2);
  post.translate(0, h * 0.36 + 0.002, 0);
  ears.push(post);
  const cross = box(0.019, 0.0022, 0.0055, 0.0004, 1);
  cross.translate(0, h - 0.0012, 0);
  ears.push(cross);
  const g = mergeAll(ears);
  asm.add(g, matSteel, { x, y: railTop + 0.008, z, rx: tilt });
  g.dispose();
}

/** Folding rear sight: aperture wheel, windage drum, protective wings. */
export function addRearSight(asm, matSteel, matAlu, x, railTop, z, up = true) {
  const baseG = box(0.024, 0.0085, 0.022, 0.0008, 1);
  asm.add(baseG, matAlu, { x, y: railTop + 0.0042, z });
  baseG.dispose();
  const h = up ? 0.027 : 0.005;
  const tilt = up ? 0 : 1.35;
  const parts = [];
  const leaf = extrude(
    [
      [-0.011, 0],
      [0.011, 0],
      [0.011, h * 0.55],
      [0.006, h],
      [-0.006, h],
      [-0.011, h * 0.55],
    ],
    0.006,
    { bevel: 0.0006 }
  );
  parts.push(leaf);
  // aperture ring
  const ap = ring(0.0032, 0.0011, 14, 6);
  ap.translate(0, h * 0.66, 0);
  parts.push(ap);
  /**
   * Windage drum — KNURLED, and the knurl is not decoration.
   *
   * MEASURED: as a smooth 12-gon lathe this 10 mm drum rendered as a specular bead
   * at L=188 in hipfire, the brightest thing on the front half of the weapon. It
   * is a metal, so specularIntensity does nothing (three folds albedo into F0 at
   * metalness 1) and dropping F0 twice only moved it by a fifth of a stop — a
   * smooth convex metal facing the viewmodel key IS a mirror by construction and
   * the only thing that breaks a mirror is surface curvature.
   *
   * A real windage drum is knurled so you can turn it with wet fingers. 22 splines
   * scatter the lobe across 22 tiny highlights instead of one bead, which is both
   * correct and self-solving. The segment count also goes 12 -> 20, because a
   * 12-gon on a 10 mm part 0.44 m from the eye has countable facets.
   */
  const drum = latheZ(
    [
      [0, 0],
      [0, 0.0048],
      [0.0035, 0.0052],
      [0.008, 0.0052],
      [0.008, 0],
    ],
    20
  );
  const drumKnurl = knurlBand(0.0053, 0.0042, 22, 0.00028, 3);
  drumKnurl.translate(0, 0, 0.0055);
  const drumG = mergeAll([drum, drumKnurl]);
  drumG.rotateY(Math.PI / 2);
  drumG.translate(0.012, h * 0.3, 0);
  parts.push(drumG);
  const g = mergeAll(parts);
  asm.add(g, matSteel, { x, y: railTop + 0.0085, z, rx: tilt });
  g.dispose();
}

/** AR charging handle: latch, T-bar, ridged wings. Moves as one part. */
export function chargingHandlePart() {
  const parts = [];
  const bar = box(0.028, 0.0055, 0.052, 0.0008, 1);
  bar.translate(0, 0, 0.012);
  parts.push(bar);
  const shaftG = rodZ(0.0055, 0.0055, 0.07, 12, 0.0005);
  shaftG.translate(0, -0.0022, -0.02);
  parts.push(shaftG);
  // T-handle wings with grip ridges
  const wing = extrude(
    [
      [0, -0.005],
      [0.02, -0.0075],
      [0.024, -0.002],
      [0.024, 0.004],
      [0.0, 0.004],
    ],
    0.0055,
    { bevel: 0.0007 }
  );
  const wR = wing.clone();
  wR.rotateY(Math.PI / 2);
  wR.rotateZ(0);
  wR.translate(0.012, 0.0, 0.034);
  parts.push(wR);
  const wL = wing.clone();
  wL.rotateY(-Math.PI / 2);
  wL.translate(-0.012, 0.0, 0.034);
  parts.push(wL);
  wing.dispose();
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      const r = box(0.0022, 0.0075, 0.0016, 0.0003, 1);
      r.translate(sx * (0.017 + i * 0.003), 0.0, 0.031 + i * 0.0022);
      parts.push(r);
    }
  }
  /**
   * THE LATCH. A charging handle without one is a T-shaped tab and reads as a
   * moulded lug; the latch is what says "this part is a mechanism that has to be
   * released before it moves". It is a separate hooked lever on the LEFT wing —
   * the side that faces the camera in the hipfire pose — pivoting on a visible
   * roll pin, with the hook standing proud of the wing so it breaks the
   * silhouette rather than being a groove in it.
   */
  const latchBody = extrude(
    [
      [0, -0.0032],
      [0.0165, -0.0042],
      [0.0205, -0.0018],
      [0.0205, 0.0026],
      [0.0155, 0.0042],
      [0, 0.0034],
    ],
    0.0042,
    { bevel: 0.0006 }
  );
  latchBody.rotateY(-Math.PI / 2);
  latchBody.translate(-0.0125, 0.0012, 0.0335);
  parts.push(latchBody);
  // The hook that engages the receiver shelf: proud 1.6 mm, pointing forward.
  const hook = box(0.0038, 0.0052, 0.0032, 0.0005, 1);
  hook.translate(-0.0295, 0.0006, 0.0292);
  parts.push(hook);
  // Pivot pin through the wing, and the finger pad on the lever's tail.
  const pin = rodZ(0.0011, 0.0011, 0.0072, 8, 0.0002);
  pin.rotateY(Math.PI / 2);
  pin.translate(-0.0135, 0.0012, 0.0356);
  parts.push(pin);
  const pad = box(0.0028, 0.0062, 0.0075, 0.0004, 1);
  pad.translate(-0.0316, 0.0014, 0.0345);
  parts.push(pad);
  return mergeAll(parts);
}

/** Vertical / angled foregrip for the SMG. */
export function addForeGrip(asm, matPoly, matRubber, o) {
  const len = o.len ?? 0.062;
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const g = blob(0.026 - t * 0.003, len / 5 + 0.003, 0.03 - t * 0.004, 0.005, 3);
    g.translate(0, -t * len, t * 0.008);
    parts.push(g);
  }
  const core = mergeAll(parts);
  asm.add(core, matPoly, { y: o.y, z: o.z, rx: o.angle ?? 0.25 });
  core.dispose();
  const gripParts = [];
  for (let i = 0; i < 4; i++) {
    const t = 0.15 + i * 0.23;
    const gr = box(0.024, 0.006, 0.0055, 0.002, 2);
    gr.translate(0, -t * len, -0.013);
    gripParts.push(gr);
  }
  const grips = mergeAll(gripParts);
  asm.add(grips, matRubber, { y: o.y, z: o.z, rx: o.angle ?? 0.25 });
  grips.dispose();
}

/**
 * Mini reflex sight (RMR pattern): an open frame with a canted glass window,
 * a hood, an emitter housing, a battery tray and two mounting screws.
 * Returned data lets the rig place the floating dot on the optical axis.
 */
export function buildMiniReflex(asm, o) {
  const w = o.w ?? 0.0246;
  const h = o.h ?? 0.021;
  const len = o.len ?? 0.0455;
  const y = o.y ?? 0;
  const z = o.z ?? 0;
  const matBody = o.matBody ?? 'alu';
  const glassTilt = o.tilt ?? 0.16; // rear-canted window, like the real thing

  // Base plate.
  const base = extrude(roundRect(w, len, 0.003, 3), 0.0042, { bevel: 0.0007 });
  asm.add(base, matBody, { y: y + 0.002, z, rx: Math.PI / 2 });
  base.dispose();

  // Two side walls that taper toward the front, joined by the hood.
  const wall = extrude(
    [
      [-len * 0.5, 0],
      [len * 0.42, 0],
      [len * 0.46, h * 0.52],
      [len * 0.3, h * 0.86],
      [-len * 0.42, h],
      [-len * 0.5, h * 0.92],
    ],
    0.0036,
    { bevel: 0.0007 }
  );
  for (const sx of [-1, 1]) {
    asm.add(wall, matBody, { x: sx * (w * 0.5 - 0.0018), y: y + 0.004, z, ry: Math.PI / 2 });
  }
  wall.dispose();

  // Hood over the front, and the emitter housing at the front floor.
  const hood = box(w, 0.0035, 0.011, 0.0008, 1);
  asm.add(hood, matBody, { y: y + h * 0.98, z: z - len * 0.36 });
  hood.dispose();
  const emitter = blob(w - 0.007, 0.0075, 0.012, 0.0016, 2);
  asm.add(emitter, matBody, { y: y + 0.0075, z: z - len * 0.3 });
  emitter.dispose();
  const led = latheZ(
    [
      [0, 0],
      [0, 0.0016],
      [0.0012, 0.0018],
      [0.0012, 0],
    ],
    10
  );
  asm.add(led, 'steel_bright', { y: y + 0.0105, z: z - len * 0.28, rx: -0.5 });
  led.dispose();

  // Battery tray + adjustment screws.
  addScrew(asm, 'steel', 0, y + 0.004, z + len * 0.4, 0.0026, 'y', 0.008);
  addScrew(asm, 'steel', w * 0.5 - 0.002, y + h * 0.5, z + len * 0.28, 0.0022, 'x', 0.006);
  addScrew(asm, 'steel', 0, y + h * 0.86, z + len * 0.1, 0.0022, 'y', 0.006);

  // The window: a real pane, canted back, in a bevelled frame.
  const glassW = w - 0.007;
  const glassH = h * 0.72;
  const pane = extrude(roundRect(glassW, glassH, 0.0015, 3), 0.0012, { bevel: 0.0003 });
  asm.add(pane, 'glass', { y: y + h * 0.56, z: z + len * 0.14, rx: glassTilt });
  pane.dispose();
  const frame = extrude(roundRect(glassW + 0.0028, glassH + 0.0028, 0.0018, 3), 0.0022, {
    bevel: 0.0005,
    holes: [roundRect(glassW - 0.0002, glassH - 0.0002, 0.0014, 3)],
  });
  asm.add(frame, matBody, { y: y + h * 0.56, z: z + len * 0.14, rx: glassTilt });
  frame.dispose();

  return {
    center: [0, y + h * 0.56, z + len * 0.14],
    lensZ: z + len * 0.14,
    apertureR: Math.min(glassW, glassH) * 0.46,
    windowW: glassW * 0.46,
    windowH: glassH * 0.46,
    tilt: glassTilt,
  };
}

/**
 * Pistol slide: a machined block with front and rear grasping serrations, a
 * lightening cut, the ejection port, a chamber hood, sight dovetails and a
 * breech face. Built in slide space with the origin at the bore axis, so the
 * rig can cycle it straight back along +Z.
 */
export function buildSlide(asm, o) {
  const w = o.w ?? 0.0262;
  const h = o.h ?? 0.0248;
  const len = o.len ?? 0.183;
  const mat = o.mat ?? 'steel';
  const zRear = o.zRear ?? 0.052;
  const zFront = zRear - len;
  const cz = (zRear + zFront) / 2;
  const bore = 0;

  // Main body: chamfered block with a top rib.
  const bodyG = box(w, h, len, 0.0016, 2);
  asm.add(bodyG, mat, { y: bore + 0.0015, z: cz });
  bodyG.dispose();
  const rib = box(w - 0.008, 0.004, len - 0.02, 0.0012, 2);
  asm.add(rib, mat, { y: bore + h * 0.5 + 0.0025, z: cz - 0.004 });
  rib.dispose();
  // front taper / nose bevel
  const nose = extrude(
    [
      [-w * 0.5, -h * 0.5],
      [w * 0.5, -h * 0.5],
      [w * 0.5, h * 0.34],
      [w * 0.36, h * 0.5],
      [-w * 0.36, h * 0.5],
      [-w * 0.5, h * 0.34],
    ],
    0.016,
    { bevel: 0.0012 }
  );
  asm.add(nose, mat, { y: bore + 0.0015, z: zFront + 0.008 });
  nose.dispose();

  // Grasping serrations, front and rear.
  for (const [z0, count] of [
    [zRear - 0.006, 7],
    [zFront + 0.03, 5],
  ]) {
    for (let i = 0; i < count; i++) {
      const z = z0 - i * 0.0052;
      const g = box(w + 0.0006, h * 0.62, 0.0026, 0.0006, 1);
      asm.add(g, mat, { y: bore + 0.0015, z });
      g.dispose();
    }
  }

  // Lightening cuts on the flanks.
  for (const sx of [-1, 1]) {
    const cut = extrude(roundRect(0.042, h * 0.4, 0.004, 3), 0.0016, { bevel: 0.0005 });
    asm.add(cut, mat, { x: sx * (w * 0.5 - 0.0004), y: bore + 0.001, z: cz - 0.012, ry: Math.PI / 2 });
    cut.dispose();
  }

  // Ejection port with a real cavity and a chamber hood.
  const portW = 0.036;
  const portH = 0.0135;
  const cav = box(0.01, portH, portW, 0.0008, 1);
  asm.add(cav, 'cavity', { x: w * 0.5 - 0.006, y: bore + 0.004, z: zRear - 0.05, ry: Math.PI / 2 });
  cav.dispose();
  const lip = extrude(roundRect(portW + 0.004, portH + 0.004, 0.002, 3), 0.002, {
    bevel: 0.0005,
    holes: [roundRect(portW, portH, 0.0016, 3)],
  });
  asm.add(lip, mat, { x: w * 0.5 - 0.0009, y: bore + 0.004, z: zRear - 0.05, ry: Math.PI / 2 });
  lip.dispose();

  // Breech face + extractor.
  const breech = box(w - 0.006, h - 0.008, 0.004, 0.0008, 1);
  asm.add(breech, 'steel_bright', { y: bore + 0.001, z: zRear - 0.032 });
  breech.dispose();

  // Sights: front post with a dot, rear notch with two.
  const rear = extrude(
    [
      [-0.009, 0],
      [0.009, 0],
      [0.009, 0.0055],
      [0.0022, 0.0055],
      [0.0022, 0.0022],
      [-0.0022, 0.0022],
      [-0.0022, 0.0055],
      [-0.009, 0.0055],
    ],
    0.0055,
    { bevel: 0.0004 }
  );
  asm.add(rear, 'steel_bright', { y: bore + h * 0.5 + 0.0045, z: zRear - 0.012 });
  rear.dispose();
  for (const sx of [-1, 1]) {
    const dot = dome(0.0011, 8, 0.5);
    asm.add(dot, 'steel_bright', { x: sx * 0.0055, y: bore + h * 0.5 + 0.0075, z: zRear - 0.0148, ry: Math.PI });
    dot.dispose();
  }
  const front = box(0.0035, 0.0062, 0.0042, 0.0004, 1);
  asm.add(front, 'steel_bright', { y: bore + h * 0.5 + 0.0055, z: zFront + 0.014 });
  front.dispose();
  const fdot = dome(0.0013, 8, 0.5);
  asm.add(fdot, 'steel_bright', { y: bore + h * 0.5 + 0.0058, z: zFront + 0.0118, ry: Math.PI });
  fdot.dispose();

  return { zRear, zFront, w, h, len, sightY: bore + h * 0.5 + 0.0065 };
}
