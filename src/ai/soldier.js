/**
 * AI — soldier assembly. Turns the part library into a finished, skinned,
 * material-grouped character. One geometry per visual variant, shared by every
 * instance of that variant; only the skeleton is per-instance.
 */

import * as THREE from 'three';
import { RIG, GRIP_R, GRIP_L, BORE_DIR } from './rig.js';
import { CharacterBuilder, Noise, appendMesh, computeNormals, emptyMesh } from './geo.js';
import * as P from './parts.js';
import { buildWeapon } from './weapon.js';
import { liveryFor } from './livery.js';

/**
 * Metres of surface per UV tile. Nothing samples a texture any more — the
 * character materials are flat and untextured (see `livery.js`) — but the
 * builder still writes a UV set, and keeping the tile sizes means the attribute
 * layout the prewarm stand-in mimics is unchanged.
 */
const MATERIALS = {
  cloth: { tile: 0.78 },
  plate: { tile: 0.42 },
  gear: { tile: 0.26 },
  boot: { tile: 0.26 },
  accent: { tile: 0.20 },
  polymer: { tile: 0.15 },
  steel: { tile: 0.18 },
  rubber: { tile: 0.11 },
  glass: { tile: 1.0 },
};

/**
 * VALUE STEPS (vertex colour, multiplied into the livery albedo)
 *
 * A livery gives a figure ONE hue, so every piece of kit on it would land on
 * one flat value if nothing separated them — the "single extruded blob" read
 * that the old camo bake spent an albedo budget escaping. The escape now is
 * pure value: each part multiplies its material's livery colour by a step
 * below, and the baked capsule AO multiplies that again. Cloth is the
 * reference at 1.0 and everything else sits under it.
 *
 * These are neutral by construction. A tint here would fight the livery, which
 * is the only thing in the frame allowed to say what colour a player is.
 */
const GEAR = {
  webbing: [0.86, 0.86, 0.86],
  sling: [0.86, 0.86, 0.86],
  pouch: [1.00, 1.00, 1.00],
  pouchAlt: [0.90, 0.90, 0.90],
  dump: [0.94, 0.94, 0.94],
  belt: [0.74, 0.74, 0.74],
  pad: [0.64, 0.64, 0.64],
  strap: [0.66, 0.66, 0.66],
  wrap: [0.80, 0.80, 0.80],
  glove: [0.95, 0.95, 0.95],
  boot: [0.88, 0.88, 0.88],
  lace: [0.62, 0.62, 0.62],
  // A hard ballistic mask is moulded polymer, not webbing: it keeps the head
  // reading as a mask rather than another facet of the accent colour.
  mask: [0.92, 0.92, 0.92],
};

/**
 * Visual variants. Each is a different SILHOUETTE, never a recolour: helmet vs
 * wrapped head, full plate vs chest rig, carbine vs long rifle. Colour is the
 * livery's job and a variant must not touch it — two players who happen to draw
 * the same variant still have to be told apart instantly, and two players on the
 * same livery never happens (see `liveryFor` and the relay's slot assignment).
 *
 * `helmetTint` is the one survivor of the old tint set, and it is a VALUE step
 * rather than a hue: the head has to separate from the torso at 35 m.
 */
export const VARIANTS = {
  vanguard: {
    helmet: true,
    helmetCover: true,
    helmetTint: [0.80, 0.80, 0.80],
    goggles: true,
    gogglesDown: true,
    faceWrap: true,
    kneePads: true,
    fullCarrier: true,
    weapon: 'carbine',
    bulk: 1.0,
    scale: 1.0,
  },
  irregular: {
    helmet: false,
    headWrap: true,
    goggles: false,
    // dark wrap-around shooting glasses: the bare head needs a hard horizontal
    // dark band at the eye line or it is a featureless egg at 35 m
    shades: true,
    faceWrap: true,
    kneePads: false,
    fullCarrier: false,
    weapon: 'ak',
    bulk: 0.94,
    scale: 0.985,
  },
  breacher: {
    helmet: true,
    helmetCover: false, // bare shell on the carrier laminate instead of cloth
    helmetTint: [0.90, 0.90, 0.90],
    // goggles parked on the shell (not over the eyes like vanguard) plus a hard
    // ballistic half-mask: same helmet family, completely different head read
    goggles: true,
    gogglesDown: false,
    faceWrap: true,
    maskHard: true,
    kneePads: true,
    fullCarrier: true,
    weapon: 'carbine',
    bulk: 1.06,
    scale: 1.025,
  },
};

const bp = (name) => {
  const v = RIG.bindPos[RIG.index(name)];
  return [v.x, v.y, v.z];
};

/**
 * Build one variant. The geometry is shared by every character of that variant
 * regardless of livery; `materials` here is only the default set, because colour
 * lives entirely in the material and never in the mesh.
 *
 * @returns { geometry, materialNames, materials: THREE.Material[], weapon, stats }
 */
export function buildSoldier(name, { rng, materials, livery = liveryFor(0) }) {
  const V = VARIANTS[name] ?? VARIANTS.vanguard;
  const nz = new Noise(rng.fork());
  // `weathering: 0` — the grime / ground dirt / settled dust / edge wear terms
  // in the vertex bake all pull toward warm neutrals, which is exactly what a
  // photoreal uniform wants and exactly what a livery cannot survive: a neon
  // suit dragged 30 % toward brown is a muddy suit, and the colour is the only
  // thing identifying the player wearing it. The per-part amounts are left in
  // the table below so the realistic bake is one constant away. Baked AO and
  // the broad value mottle are unaffected and still carry the form.
  const B = new CharacterBuilder(RIG, { noise: nz, materials: MATERIALS, weathering: 0 });

  const shR = bp('UpperArmR'), elR = bp('ForearmR'), wrR = bp('HandR');
  const shL = bp('UpperArmL'), elL = bp('ForearmL'), wrL = bp('HandL');
  const hipR = bp('UpLegR'), knR = bp('LegR'), anR = bp('FootR');
  const hipL = bp('UpLegL'), knL = bp('LegL'), anL = bp('FootL');
  const head = bp('Head');

  /* ---------------- occlusion proxies (drives baked vertex AO) -------- */
  B.occlude([0, 0.95, -0.01], [0, 1.42, 0.0], 0.155, 1.0); // torso core
  B.occlude([0, 1.17, 0.130], [0, 1.40, 0.138], 0.11, 1.0); // front plate
  B.occlude([0, 1.20, -0.105], [0, 1.40, -0.112], 0.105, 0.8); // back plate
  B.occlude([-0.17, 1.16, 0.02], [-0.17, 1.30, 0.02], 0.055, 0.7); // right side
  B.occlude([0.17, 1.16, 0.02], [0.17, 1.30, 0.02], 0.055, 0.7);
  B.occlude([0, 1.60, 0.0], [0, 1.80, -0.01], 0.122, 1.0); // helmet interior
  B.occlude([-0.09, 1.655, 0.05], [0.09, 1.655, 0.05], 0.055, 1.0); // brim shadow
  B.occlude(shR, elR, 0.058, 0.7);
  B.occlude(shL, elL, 0.058, 0.7);
  B.occlude(hipR, knR, 0.085, 0.8);
  B.occlude(hipL, knL, 0.085, 0.8);
  B.occlude([0, 0.90, -0.01], [0, 1.05, -0.01], 0.15, 0.8); // belt line
  // strap crossings — shoulder yokes and the diagonal sling run. These are the
  // places a real uniform is darkest: sweat, webbing dye and ground-in dust all
  // collect where nylon rubs cloth.
  B.occlude([-0.085, 1.42, 0.06], [-0.085, 1.42, -0.06], 0.048, 1.0);
  B.occlude([0.085, 1.42, 0.06], [0.085, 1.42, -0.06], 0.048, 1.0);
  B.occlude([-0.13, 1.40, 0.055], [0.10, 1.10, 0.115], 0.032, 0.9); // sling diagonal
  B.occlude([-0.02, 1.02, 0.10], [-0.02, 1.02, -0.10], 0.10, 0.6); // carrier hem
  // cuffs, elbows and knees: the three places a uniform is always ground in
  B.occlude(wrR, [wrR[0], wrR[1] + 0.05, wrR[2]], 0.044, 0.9);
  B.occlude(wrL, [wrL[0], wrL[1] + 0.05, wrL[2]], 0.044, 0.9);
  B.occlude(elR, [elR[0], elR[1] - 0.02, elR[2] - 0.01], 0.052, 0.8);
  B.occlude(elL, [elL[0], elL[1] - 0.02, elL[2] - 0.01], 0.052, 0.8);
  B.occlude(knR, [knR[0], knR[1] - 0.03, knR[2] + 0.01], 0.072, 0.8);
  B.occlude(knL, [knL[0], knL[1] - 0.03, knL[2] + 0.01], 0.072, 0.8);
  B.occlude([anR[0], anR[1] + 0.09, anR[2]], [anR[0], anR[1] + 0.15, anR[2]], 0.062, 0.8);
  B.occlude([anL[0], anL[1] + 0.09, anL[2]], [anL[0], anL[1] + 0.15, anL[2]], 0.062, 0.8);
  B.occlude(GRIP_R, [GRIP_R[0] + BORE_DIR[0] * 0.4, GRIP_R[1] + BORE_DIR[1] * 0.4 + 0.09, GRIP_R[2] + BORE_DIR[2] * 0.4], 0.045, 0.6);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.078;
    B.occlude([x, 1.20, 0.160], [x, 1.28, 0.164], 0.040, 0.8); // mag pouches
  }

  /* ---------------- uniform ------------------------------------------ */
  B.add(P.jacketTorso(nz, { bulk: V.bulk }), {
    material: 'cloth',
    bones: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'ClavicleR', 'ClavicleL', 'UpperArmR', 'UpperArmL'],
    bias: [1, 1, 1, 1, 0.8, 0.55, 0.55, 0.30, 0.30],
    colour: [1, 1, 1],
    grime: 0.85,
    dirt: 0.20,
    dust: 0.34,
    wear: 0.08,
    name: 'jacket',
  });
  B.add(P.pelvis(nz), {
    material: 'cloth',
    bones: ['Hips', 'Spine', 'UpLegR', 'UpLegL'],
    bias: [1, 0.7, 0.5, 0.5],
    colour: [0.97, 0.97, 0.97],
    grime: 0.9,
    dirt: 0.35,
    dust: 0.2,
    name: 'pelvis',
  });
  B.add(P.collar(nz), {
    material: 'cloth',
    bones: ['Neck', 'Spine2', 'Head'],
    bias: [1, 0.8, 0.3],
    colour: [0.92, 0.92, 0.91],
    grime: 1.0,
    dust: 0.3,
    name: 'collar',
  });

  // sleeves
  for (const [sh, el, wr, side, suffix] of [
    [shR, elR, wrR, -1, 'R'],
    [shL, elL, wrL, 1, 'L'],
  ]) {
    // deltoid cap. The sleeve tube alone meets the torso in a socket, which is
    // half of the "tube arms" read; this gives the shoulder an actual shape and
    // a highlight to catch the key light on.
    B.add(P.shoulderCap(nz, sh, side), {
      material: 'cloth',
      bones: [`Clavicle${suffix}`, `UpperArm${suffix}`, 'Spine2'],
      bias: [0.8, 1, 0.4],
      colour: [1, 1, 1],
      grime: 0.7,
      dust: 0.5,
      wear: 0.06,
      name: `shoulder${suffix}`,
    });
    B.add(
      P.limbTube(nz, [sh[0] + side * 0.012, sh[1] + 0.055, sh[2]], el, wr,
        [0.050, 0.062, 0.056, 0.050, 0.046, 0.042, 0.038], {
        rings: 22,
        seg: 16,
        fold: 0.0016,
        // 3 mm creases: at 35 m that is sub-pixel as displacement but the normals
        // it generates are what put light and shade *inside* the sleeve outline.
        crease: 0.0030,
        bend: [0, 0, -1], // sleeve bunches inside the elbow
      }),
      {
        material: 'cloth',
        bones: [`Clavicle${suffix}`, `UpperArm${suffix}`, `Forearm${suffix}`, `Hand${suffix}`, 'Spine2'],
        bias: [0.5, 1, 1, 0.7, 0.25],
        colour: [1, 1, 1],
        grime: 0.8,
        dirt: 0.15,
        dust: 0.3,
        wear: 0.12,
        name: `sleeve${suffix}`,
      }
    );
    // elbow reinforcement patch
    B.add(
      P.limbTube(
        nz,
        [el[0] * 0.98 + sh[0] * 0.02, el[1] + 0.05, el[2] - 0.005],
        el,
        [el[0] * 0.98 + wr[0] * 0.02, el[1] - 0.05, el[2] + 0.004],
        [0.050, 0.054, 0.050],
        { rings: 5, seg: 14, fold: 0.001 }
      ),
      {
        material: 'gear',
        bones: [`UpperArm${suffix}`, `Forearm${suffix}`],
        bias: [1, 1],
        colour: GEAR.pad,
        grime: 1.0,
        dirt: 0.25,
        dust: 0.22,
        wear: 0.16,
        name: `elbowPad${suffix}`,
      }
    );
  }

  // trousers
  for (const [hip, kn, an, suffix] of [
    [hipR, knR, anR, 'R'],
    [hipL, knL, anL, 'L'],
  ]) {
    B.add(
      P.limbTube(nz, hip, kn, [an[0], an[1] + 0.085, an[2] + 0.008],
        [0.090, 0.085, 0.076, 0.068, 0.062, 0.060, 0.064], {
        rings: 24,
        seg: 17,
        fold: 0.0018,
        // trousers crease harder than sleeves and stack on the boot cuff
        crease: 0.0042,
        bend: [0, 0, -1], // gathers behind the knee
      }),
      {
        material: 'cloth',
        bones: ['Hips', `UpLeg${suffix}`, `Leg${suffix}`, `Foot${suffix}`],
        bias: [0.6, 1, 1, 0.5],
        colour: [0.98, 0.98, 0.97],
        grime: 0.8,
        dirt: 0.72,
        dust: 0.22,
        wear: 0.10,
        name: `leg${suffix}`,
      }
    );
    // cargo pocket on the outer thigh
    const side = suffix === 'R' ? -1 : 1;
    B.add(
      P.pouch(nz, {
        hx: 0.052, hy: 0.070, hz: 0.026,
        x: hip[0] + side * 0.062, y: hip[1] - 0.16, z: 0.026,
        rz: side * 0.06, ry: side * 0.55, bend: 0.11,
      }),
      {
        material: 'cloth',
        bones: [`UpLeg${suffix}`, 'Hips'],
        bias: [1, 0.4],
        colour: [0.95, 0.95, 0.94],
        grime: 0.9,
        dirt: 0.5,
        dust: 0.4,
        wear: 0.16,
        name: `cargo${suffix}`,
      }
    );
    if (V.kneePads) {
      B.add(P.kneePad(nz, kn, side), {
        material: 'gear',
        bones: [`Leg${suffix}`, `UpLeg${suffix}`],
        bias: [1, 0.5],
        colour: GEAR.pad,
        grime: 1.0,
        dirt: 0.9,
        dust: 0.28,
        wear: 0.20,
        name: `knee${suffix}`,
      });
    }
    // boots
    B.add(P.boot(nz, an, side), {
      material: 'boot',
      bones: [`Leg${suffix}`, `Foot${suffix}`, `Toe${suffix}`],
      bias: [0.55, 1, 0.6],
      colour: GEAR.boot,
      grime: 0.9,
      dirt: 0.85,
      dust: 0.5,
      wear: 0.3,
      name: `boot${suffix}`,
    });
    B.add(P.bootSole(an), {
      material: 'rubber',
      bones: [`Foot${suffix}`, `Toe${suffix}`],
      bias: [1, 0.8],
      grime: 0.9,
      dirt: 1.0,
      name: `sole${suffix}`,
    });
    B.add(P.bootLaces(an), {
      material: 'boot',
      bone: `Foot${suffix}`,
      colour: GEAR.lace,
      grime: 0.9,
      dirt: 0.85,
      name: `laces${suffix}`,
    });
  }

  /* ---------------- load-bearing gear -------------------------------- */
  B.add(P.plateCarrier(nz, V), {
    material: 'plate',
    bones: ['Spine', 'Spine1', 'Spine2', 'ClavicleR', 'ClavicleL'],
    bias: [0.7, 1, 1, 0.45, 0.45],
    colour: [0.72, 0.72, 0.72],
    grime: 0.85,
    dirt: 0.3,
    dust: 0.30,
    wear: 0.18,
    name: 'carrier',
  });
  B.add(P.carrierWebbing(), {
    material: 'gear',
    bones: ['Spine1', 'Spine2'],
    bias: [1, 1],
    colour: GEAR.webbing,
    grime: 1.0,
    dust: 0.3,
    wear: 0.26,
    name: 'webbing',
  });

  // magazine pouches across the front, deliberately not evenly loaded
  const nPouch = V.fullCarrier ? 3 : 2;
  for (let i = 0; i < nPouch; i++) {
    const t = nPouch === 1 ? 0.5 : i / (nPouch - 1);
    const x = (t - 0.5) * (nPouch > 2 ? 0.156 : 0.09);
    B.add(
      P.pouch(nz, {
        hx: 0.033, hy: 0.056, hz: 0.034,
        x, y: 1.236 + rng.range(-0.006, 0.006), z: 0.148,
        rx: -0.10, rz: rng.range(-0.05, 0.05),
        lidTilt: i === 1 ? -0.5 : 0,
        bend: 0.26,
      }),
      {
        material: 'gear',
        bones: ['Spine1', 'Spine2', 'Spine'],
        bias: [1, 0.8, 0.4],
        colour: i === 1 ? GEAR.pouchAlt : GEAR.pouch,
        grime: 0.9,
        dirt: 0.25,
        dust: 0.5,
        wear: 0.30,
        name: `magPouch${i}`,
      }
    );
    // a magazine sticking out of the open pouch
    if (i === 1) {
      const mag = P.pouch(nz, {
        hx: 0.0145, hy: 0.042, hz: 0.023,
        x, y: 1.308, z: 0.152, rx: -0.12,
      });
      B.add(mag, {
        material: 'polymer',
        bones: ['Spine1', 'Spine2'],
        bias: [1, 0.8],
        grime: 0.4,
        wear: 0.2,
        name: 'spareMag',
      });
    }
  }

  // radio on the left chest, admin pouch on the right, IFAK on the belt
  B.add(
    P.pouch(nz, {
      hx: 0.032, hy: 0.058, hz: 0.028,
      x: 0.112, y: 1.336, z: 0.118, ry: 0.35, rz: 0.10, bend: 0.24,
    }),
    {
      material: 'gear',
      bones: ['Spine2', 'ClavicleL', 'Spine1'],
      bias: [1, 0.5, 0.5],
      colour: GEAR.pouchAlt,
      grime: 0.9,
      dust: 0.5,
      wear: 0.22,
      name: 'radio',
    }
  );
  // antenna
  {
    const ant = P.pouch(nz, { hx: 0.005, hy: 0.075, hz: 0.005, x: 0.116, y: 1.424, z: 0.104, rx: -0.18 });
    B.add(ant, {
      material: 'polymer',
      bones: ['Spine2', 'ClavicleL'],
      bias: [1, 0.6],
      grime: 0.3,
      name: 'antenna',
    });
  }
  B.add(P.belt(nz), {
    material: 'gear',
    bones: ['Hips', 'Spine'],
    bias: [1, 0.5],
    colour: GEAR.belt,
    grime: 1.0,
    dirt: 0.4,
    dust: 0.25,
    wear: 0.26,
    name: 'belt',
  });
  B.add(P.hipPouch(nz, -1), {
    material: 'gear',
    bones: ['Hips', 'Spine'],
    bias: [1, 0.4],
    colour: GEAR.dump,
    grime: 0.95,
    dirt: 0.6,
    dust: 0.45,
    wear: 0.26,
    name: 'dumpPouch',
  });

  /* ---------------- head --------------------------------------------- */
  const wrapped = V.faceWrap;
  B.add(P.headMesh(nz, head, {}), {
    material: 'accent',
    bone: 'Head',
    colour: [1, 1, 1],
    grime: 0.3,
    dirt: 0.06,
    name: 'head',
  });
  // NO FACE. The nose, the ears and the two eyeballs that used to go on here
  // are gone, and `headMesh` no longer warps a brow, sockets, cheekbones or a
  // chin into the skull. A head is a faceted block in the accent colour, and
  // what makes it read as a head is the helmet, the visor band and the mask —
  // silhouette, not anatomy. Seven fewer parts, and the four smallest, most
  // triangle-dense meshes on the whole character are the ones that went.
  // neck
  B.add(
    P.limbTube(nz, [head[0], head[1] - 0.10, head[2] - 0.012], [head[0], head[1] - 0.05, head[2] - 0.008], [head[0], head[1], head[2]],
      [0.058, 0.056, 0.054], { rings: 5, seg: 14, fold: 0.001 }),
    {
      material: 'accent',
      bones: ['Neck', 'Head', 'Spine2'],
      bias: [1, 0.7, 0.4],
      grime: 0.5,
      name: 'neck',
    }
  );

  if (wrapped) {
    // A hard ballistic mask is moulded polymer on the *same* geometry: the seam
    // and the bridge fold read as the mask's edge and nose vent instead of a
    // cloth hem, and it lands far darker than any cloth in the kit, which is
    // what gives that variant a legible face at range.
    B.add(P.faceWrap(nz, head, V), {
      material: V.maskHard ? 'polymer' : 'gear',
      bones: ['Head', 'Neck'],
      bias: [1, 0.5],
      colour: V.maskHard ? GEAR.mask : V.helmet ? GEAR.wrap : [0.78, 0.74, 0.66],
      grime: V.maskHard ? 0.5 : 0.85,
      dirt: V.maskHard ? 0.1 : 0.2,
      dust: V.maskHard ? 0.2 : 0.3,
      wear: V.maskHard ? 0.3 : 0.1,
      name: 'faceWrap',
    });
  }

  if (V.helmet) {
    // A COVERED helmet goes on the accent, with the head and the neck. That is
    // what makes the accent colour worth having: every variant covers the skull
    // completely, so a livery whose accent only reached the head mesh was
    // paying for a colour nobody could ever see. On the accent, the helmet is
    // the hot version of the player's hue sitting a value step above the
    // uniform — the head separates from the torso at 35 m, which is exactly
    // what the old camo-cover tint was for, done with hue instead of pattern.
    // A bare shell stays on the carrier laminate: that dark head is the whole
    // point of the breacher silhouette.
    B.add(P.helmet(nz, head, V), {
      material: V.helmetCover ? 'accent' : 'plate',
      bone: 'Head',
      colour: V.helmetTint ?? [1, 1, 1],
      grime: 0.6,
      dirt: 0.2,
      dust: 0.55,
      wear: 0.4,
      name: 'helmet',
    });
    B.add(P.helmetHardware(nz, head), {
      material: 'polymer',
      bone: 'Head',
      grime: 0.5,
      wear: 0.3,
      name: 'helmetHW',
    });
    B.add(P.chinStrap(head), {
      material: 'gear',
      bones: ['Head', 'Neck'],
      bias: [1, 0.4],
      colour: GEAR.strap,
      grime: 0.95,
      dust: 0.25,
      wear: 0.18,
      name: 'chinStrap',
    });
    if (V.goggles) {
      const g = P.goggles(head, V.gogglesDown);
      B.add(g.frame, { material: 'polymer', bone: 'Head', grime: 0.4, wear: 0.35, name: 'goggleFrame' });
      B.add(g.strap, {
        material: 'gear',
        bone: 'Head',
        colour: GEAR.strap,
        grime: 0.85,
        dust: 0.3,
        name: 'goggleStrap',
      });
      B.add(P.goggleLens(head, V.gogglesDown), {
        material: 'glass',
        bone: 'Head',
        colour: [1, 1, 1],
        grime: 0.15,
        name: 'goggleLens',
      });
    }
  } else if (V.headWrap) {
    const wrap = P.headScarf(nz, head);
    B.add(wrap, {
      // On the accent for the same reason the helmet cover is: it is the whole
      // head, and the head is where a livery has to read. The value step keeps
      // it a shade under the helmet's, so a wrapped head and a helmeted one are
      // still two different silhouettes AND two different values.
      material: 'accent',
      bone: 'Head',
      colour: [0.88, 0.88, 0.88],
      grime: 0.8,
      dirt: 0.25,
      dust: 0.4,
      wear: 0.14,
      name: 'shemagh',
    });
  }

  if (V.shades) {
    const s = P.sunglasses(head);
    B.add(s.frame, { material: 'polymer', bone: 'Head', grime: 0.4, wear: 0.3, name: 'shadeFrame' });
    B.add(s.lens, {
      material: 'glass',
      bone: 'Head',
      colour: [1, 1, 1],
      grime: 0.2,
      name: 'shadeLens',
    });
  }

  /* ---------------- hands + weapon ----------------------------------- */
  const bore = new THREE.Vector3(...BORE_DIR).normalize();
  const palmR = new THREE.Vector3(-0.55, 0.35, -0.75).normalize();
  const palmL = new THREE.Vector3(0.75, 0.30, -0.60).normalize();
  const gripAxisR = new THREE.Vector3(0.18, 0.92, -0.34).normalize(); // down the grip
  const gripAxisL = bore.clone();

  B.add(P.glove(nz, wrR, [gripAxisR.x, gripAxisR.y, gripAxisR.z], [palmR.x, palmR.y, palmR.z], -1), {
    material: 'boot',
    bones: ['HandR', 'ForearmR'],
    bias: [1, 0.35],
    colour: GEAR.glove,
    grime: 0.9,
    dirt: 0.3,
    dust: 0.25,
    wear: 0.28,
    name: 'gloveR',
  });
  B.add(P.knuckleGuard(wrR, [gripAxisR.x, gripAxisR.y, gripAxisR.z], [palmR.x, palmR.y, palmR.z]), {
    material: 'polymer',
    bone: 'HandR',
    grime: 0.5,
    wear: 0.35,
    name: 'knuckleR',
  });
  B.add(P.glove(nz, wrL, [gripAxisL.x, gripAxisL.y, gripAxisL.z], [palmL.x, palmL.y, palmL.z], 1), {
    material: 'boot',
    bones: ['HandL', 'ForearmL'],
    bias: [1, 0.35],
    colour: GEAR.glove,
    grime: 0.9,
    dirt: 0.3,
    dust: 0.25,
    wear: 0.28,
    name: 'gloveL',
  });
  B.add(P.knuckleGuard(wrL, [gripAxisL.x, gripAxisL.y, gripAxisL.z], [palmL.x, palmL.y, palmL.z]), {
    material: 'polymer',
    bone: 'HandL',
    grime: 0.5,
    wear: 0.35,
    name: 'knuckleL',
  });

  const W = buildWeapon(nz, V.weapon, rng);
  B.add(W.steel, { material: 'steel', bone: 'HandR', grime: 0.55, wear: 0.25, name: 'wpnSteel' });
  B.add(W.polymer, { material: 'polymer', bone: 'HandR', grime: 0.5, wear: 0.3, name: 'wpnPoly' });
  B.add(W.rubber, { material: 'rubber', bone: 'HandR', grime: 0.6, name: 'wpnRubber' });
  if (W.glass.p.length) {
    B.add(W.glass, { material: 'glass', bone: 'HandR', grime: 0.1, name: 'wpnGlass' });
  }

  // sling: body-bound so it stays on the chest as the arms move
  B.add(P.sling(W.foregrip, W.stockTop), {
    material: 'gear',
    bones: ['Spine2', 'Spine1', 'ClavicleR', 'ClavicleL', 'Hips'],
    bias: [1, 0.8, 0.5, 0.5, 0.3],
    colour: GEAR.sling,
    grime: 1.0,
    dust: 0.2,
    wear: 0.22,
    name: 'sling',
  });

  const built = B.build();
  // Guard the prewarm contract: see MATERIAL_SLOTS.
  if (built.materialNames.join() !== MATERIAL_SLOTS.filter((s) => built.materialNames.includes(s)).join()) {
    console.warn(
      `[ai] material slot order changed (${built.materialNames.join()}); ` +
        'update MATERIAL_SLOTS or prewarmMaterials will reorder opaque draws'
    );
  }
  const mats = resolveMaterials(built.materialNames, materials, livery);

  return {
    geometry: built.geometry,
    materialNames: built.materialNames,
    materials: mats,
    parts: built.parts,
    weapon: W,
    stats: { vertices: built.vertices, triangles: built.triangles },
    variant: V,
  };
}

/**
 * Every material slot a soldier's geometry is grouped by, IN THE ORDER
 * `CharacterBuilder.build()` emits them — which is the order the parts are added
 * above, deduplicated. All three variants use all nine.
 *
 * THE ORDER IS LOad-BEARING, and this is not a style preference. `THREE.Material`
 * hands out globally incrementing ids and three sorts the opaque render list by
 * `material.id` (`painterSortStable`), including the nine groups *within* one
 * soldier. Create them in a different order and the goggle lens draws before its
 * frame instead of after it; with a depth prepass in front, whichever coplanar
 * surface is drawn last wins the equal-depth test. MEASURED: prewarming these in
 * a hand-written order moved 2 pixels of the `combat` shot by 1/255 and failed
 * the pixel gate. `buildSoldier` asserts the order below still matches.
 */
export const MATERIAL_SLOTS = Object.freeze([
  'cloth', 'gear', 'boot', 'rubber', 'plate', 'polymer', 'accent', 'glass', 'steel',
]);

/**
 * Resolve a geometry's material slot names to real materials for one livery.
 *
 * Split out of `buildSoldier` on purpose: `AiSystem.prewarmMaterials()` needs
 * every material a character will ever ask for so their shader programs can be
 * compiled while a loading screen is up, and it must be able to get them WITHOUT
 * building a single triangle (geometry construction draws from the shared RNG
 * stream, so doing it early would move every downstream random draw and change
 * the picture). `SoldierMaterials.get()` is a pure function of its arguments, so
 * calling it early is free of side effects.
 *
 * The variant name is no longer an input, and that is the point: the geometry
 * decides the silhouette, the livery decides the colour, and the two are
 * independent. One prewarm covers every livery because colour is a uniform and
 * not a program permutation — see the note on `customProgramCacheKey`.
 *
 * `slots` MUST arrive in the builder's own order (`MATERIAL_SLOTS`); see the
 * note there for why.
 */
export function resolveMaterials(slots, materials, livery = liveryFor(0)) {
  return slots.map((n) => materials.get(n, livery));
}
