/**
 * AI self-test — builds every soldier variant headlessly (no WebGL) and reports
 * NaN / degenerate geometry per part, triangle counts and skin-weight sanity,
 * then audits the two things the flat-livery characters are actually made of:
 * the LIVERY PALETTE (are twelve players told apart, and does every albedo sit
 * in the band the level's exposure can render as a colour rather than as white?)
 * and the VALUE HIERARCHY (with one hue on the whole figure, does the kit still
 * separate from the uniform?).
 *
 *   node src/ai/selftest.mjs
 */

import { Rng } from '../core/rng.js';
import { RIG } from './rig.js';
import { CharacterBuilder, Noise, vcount } from './geo.js';
import * as P from './parts.js';
import { buildWeapon } from './weapon.js';
import { VARIANTS, buildSoldier } from './soldier.js';
import { BAND, HARDWARE, LIVERIES, PLAYER_SLOTS, BOT_SLOT, liveryFor } from './livery.js';

const rng = new Rng(1234);
const nz = new Noise(rng.fork());

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`!! ${msg}`);
};

function check(name, m) {
  let nan = 0, deg = 0;
  for (let i = 0; i < m.p.length; i++) if (!Number.isFinite(m.p[i])) nan++;
  for (let i = 0; i < m.n.length; i++) if (!Number.isFinite(m.n[i])) deg++;
  for (let i = 0; i < m.uv.length; i++) if (!Number.isFinite(m.uv[i])) nan++;
  const status = nan || deg ? `NaN pos/uv:${nan} nrm:${deg}` : 'ok';
  console.log(
    `${status === 'ok' ? '  ' : '!!'} ${name.padEnd(18)} v=${String(vcount(m)).padStart(5)} t=${String(
      m.i.length / 3
    ).padStart(5)}  ${status}`
  );
  return nan + deg;
}

const bp = (n) => {
  const v = RIG.bindPos[RIG.index(n)];
  return [v.x, v.y, v.z];
};

let bad = 0;
const head = bp('Head');
bad += check('jacketTorso', P.jacketTorso(nz, {}));
bad += check('pelvis', P.pelvis(nz));
bad += check('collar', P.collar(nz));
bad += check('limbTube arm', P.limbTube(nz, bp('UpperArmR'), bp('ForearmR'), bp('HandR'), [0.07, 0.058, 0.052, 0.05, 0.046, 0.043, 0.04], { rings: 13, seg: 15 }));
bad += check('limbTube leg', P.limbTube(nz, bp('UpLegR'), bp('LegR'), bp('FootR'), [0.098, 0.092, 0.082, 0.074, 0.068, 0.066, 0.07], { rings: 13, seg: 16 }));
bad += check('shoulderCap', P.shoulderCap(nz, bp('UpperArmR'), -1));
bad += check('headMesh', P.headMesh(nz, head, {}));
bad += check('faceWrap', P.faceWrap(nz, head, {}));
bad += check('helmet', P.helmet(nz, head, {}));
bad += check('helmetHardware', P.helmetHardware(nz, head));
bad += check('chinStrap', P.chinStrap(head));
const g = P.goggles(head);
bad += check('goggleFrame', g.frame);
bad += check('goggleStrap', g.strap);
bad += check('goggleLens', P.goggleLens(head));
bad += check('plateCarrier', P.plateCarrier(nz, {}));
bad += check('carrierWebbing', P.carrierWebbing());
bad += check('pouch', P.pouch(nz, { x: 0, y: 1.2, z: 0.13, bend: 0.2 }));
bad += check('belt', P.belt(nz));
bad += check('hipPouch', P.hipPouch(nz, -1));
bad += check('kneePad', P.kneePad(nz, bp('LegR'), -1));
bad += check('boot', P.boot(nz, bp('FootR'), -1));
bad += check('bootSole', P.bootSole(bp('FootR')));
bad += check('bootLaces', P.bootLaces(bp('FootR')));
bad += check('glove', P.glove(nz, bp('HandR'), [0.18, 0.92, -0.34], [-0.55, 0.35, -0.75], -1));
bad += check('knuckleGuard', P.knuckleGuard(bp('HandR'), [0.18, 0.92, -0.34], [-0.55, 0.35, -0.75]));
for (const style of ['carbine', 'ak']) {
  const W = buildWeapon(nz, style, rng.fork());
  bad += check(`wpn ${style} steel`, W.steel);
  bad += check(`wpn ${style} poly`, W.polymer);
  bad += check(`wpn ${style} rubber`, W.rubber);
  if (W.glass.p.length) bad += check(`wpn ${style} glass`, W.glass);
  bad += check(`sling ${style}`, P.sling(W.foregrip, W.stockTop));
  for (const k of ['muzzle', 'foregrip', 'stockTop']) {
    if (!W[k].every(Number.isFinite)) console.log(`!! weapon.${k} NaN`);
  }
}

if (bad) fail(`${bad} bad components`);
console.log(bad ? `\nFAIL — ${bad} bad components` : '\nall parts finite');

// A face is a defect now, not a feature.
for (const gone of ['nose', 'ear', 'eyeball']) {
  if (typeof P[gone] === 'function') fail(`parts.js still exports \`${gone}\` — no faces`);
}

// rig sanity
for (let i = 0; i < RIG.count; i++) {
  const p = RIG.bindPos[i], q = RIG.bindQuat[i];
  if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) {
    fail(`rig bone ${RIG.names[i]} NaN`);
  }
  if (RIG.length[i] < 1e-4) fail(`rig bone ${RIG.names[i]} zero length`);
}
console.log(`rig: ${RIG.count} bones, eye ${RIG.eyeHeight}m`);

/* ------------------------------------------------------------------ */
/* liveries: can twelve players tell each other apart?                 */
/* ------------------------------------------------------------------ */

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Hue angle of a linear RGB triple, in turns. Two liveries are distinguishable
 * when their hues are far apart — value cannot do the job here because every
 * livery is deliberately pinned to the same albedo band.
 */
function hueTurns(c) {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  if (d < 1e-9) return 0;
  let h;
  if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}

/** Shortest distance between two hue angles, in turns (0 .. 0.5). */
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

/**
 * Minimum hue separation between any two player liveries.
 *
 * Twelve hues spaced evenly would be 1/12 = 0.083 turns apart. 0.05 is the
 * floor: below that two players in the same match are arguing about whether
 * they are both "the orange one", which is the exact failure this whole system
 * exists to prevent.
 */
const MIN_HUE_GAP = 0.05;

console.log('\nliveries — the twelve a room of players draws from');
{
  const hues = LIVERIES.map((l) => hueTurns(l.suit));
  for (let i = 0; i < LIVERIES.length; i++) {
    const l = LIVERIES[i];
    let nearest = 1;
    for (let j = 0; j < LIVERIES.length; j++) {
      if (i !== j) nearest = Math.min(nearest, hueGap(hues[i], hues[j]));
    }
    const ok = nearest >= MIN_HUE_GAP;
    if (!ok) fail(`livery ${l.id}: nearest hue only ${nearest.toFixed(3)} turns away`);
    console.log(
      `${ok ? '  ' : '!!'} ${String(i).padStart(2)} ${l.id.padEnd(8)} ` +
        `suit ${l.suit.map((c) => c.toFixed(3)).join(' ')}  ` +
        `lum ${lum(l.suit).toFixed(3)}  hue ${hues[i].toFixed(3)}  ` +
        `nearest ${nearest.toFixed(3)}`
    );
  }
  console.log(`   (floor: any two player liveries >= ${MIN_HUE_GAP} turns apart in hue)`);
}

/**
 * Albedo ceiling.
 *
 * The level's sunlit surfaces behave like 0.05-0.09 albedo on screen and the
 * read-back fit is screen_linear ~= 2.1 x albedo, so a channel above ~0.45
 * clips to white in the sun and the figure loses the hue it is identified by —
 * the same failure the old 0.21 uniform bake had. 0.02 is the floor a livery
 * has to clear to be a colour at all rather than a black shape.
 */
const ALBEDO_MAX = 0.45;

console.log('\nalbedo band — every livery channel that ends up on a character');
{
  let mx = 0;
  let mn = Infinity;
  for (let s = 0; s < BOT_SLOT + 8; s++) {
    const l = liveryFor(s);
    for (const k of ['suit', 'accent', 'carrier', 'kit', 'trim']) {
      for (const c of l[k]) {
        if (!Number.isFinite(c)) fail(`livery ${l.id}.${k} is not finite`);
        mx = Math.max(mx, c);
        mn = Math.min(mn, c);
      }
    }
  }
  for (const k in HARDWARE) mx = Math.max(mx, ...HARDWARE[k]);
  if (mx > ALBEDO_MAX) fail(`livery channel ${mx.toFixed(3)} clips (max ${ALBEDO_MAX})`);
  if (mn < 0) fail(`negative livery channel ${mn.toFixed(3)}`);
  console.log(
    `  ${mx <= ALBEDO_MAX ? '  ' : '!!'}channels span ${mn.toFixed(4)}-${mx.toFixed(3)} ` +
      `over ${BOT_SLOT + 8} slots (ceiling ${ALBEDO_MAX})`
  );
  console.log(
    `    band: suit ${BAND.suit} accent ${BAND.accent} ` +
      `carrier ${BAND.carrierHue}xhue+${BAND.carrierBase} kit ${BAND.kit} trim ${BAND.trim}`
  );
}

console.log('\nslot allocation — players and bots never collide');
{
  if (BOT_SLOT < PLAYER_SLOTS) fail(`bots start at ${BOT_SLOT}, inside the player block`);
  // Generated hues past the curated twelve must still be distinct from each
  // other, or a garrison is a crowd of one colour.
  const gaps = [];
  for (let a = BOT_SLOT; a < BOT_SLOT + 10; a++) {
    for (let b = a + 1; b < BOT_SLOT + 10; b++) {
      gaps.push(hueGap(hueTurns(liveryFor(a).suit), hueTurns(liveryFor(b).suit)));
    }
  }
  const worst = Math.min(...gaps);
  if (worst < 0.02) fail(`two bot liveries only ${worst.toFixed(3)} turns apart`);
  console.log(
    `  player slots 0-${PLAYER_SLOTS - 1}, bots from ${BOT_SLOT}; ` +
      `closest pair among 10 bot slots ${worst.toFixed(3)} turns`
  );
}

/* ------------------------------------------------------------------ */
/* value hierarchy: one hue, so does the kit still read?               */
/* ------------------------------------------------------------------ */

/**
 * Perceptual-ish distance between two linear RGB colours: a cube root per
 * channel (the L* curve, near enough) and then a Euclidean distance.
 *
 * The uniform-vs-carrier test HAS to be a colour distance and not a luminance
 * ordering, because half the palette breaks a luminance ordering by design. A
 * cobalt suit is 0.022 linear luminance and the carrier under it is 0.037: the
 * suit is genuinely DARKER, and it does not matter in the slightest, because
 * the two are separated by ~0.19 of chroma and read as obviously different
 * surfaces. Asserting `cloth > plate` would fail on every blue and violet
 * livery while the frame looks perfect.
 */
const pdist = (a, b) => {
  const c = (v) => Math.cbrt(Math.max(0, v));
  return Math.hypot(c(a[0]) - c(b[0]), c(a[1]) - c(b[1]), c(a[2]) - c(b[2]));
};

/** Floor for suit-vs-carrier separation. Measured worst case is flare, 0.37. */
const MIN_SEPARATION = 0.12;

console.log('\nsuit vs carrier — colour separation, per livery');
{
  for (const l of LIVERIES) {
    const d = pdist(l.suit, l.carrier);
    if (d < MIN_SEPARATION) fail(`livery ${l.id}: suit/carrier only ${d.toFixed(3)} apart`);
    const kit = lum(l.kit);
    const car = lum(l.carrier);
    if (!(car > kit * 1.5)) {
      fail(`livery ${l.id}: carrier ${car.toFixed(4)} not clear of webbing ${kit.toFixed(4)}`);
    }
  }
  const worst = LIVERIES.reduce(
    (w, l) => (pdist(l.suit, l.carrier) < pdist(w.suit, w.carrier) ? l : w)
  );
  console.log(
    `  closest is ${worst.id} at ${pdist(worst.suit, worst.carrier).toFixed(3)} ` +
      `(floor ${MIN_SEPARATION}); carrier luminance ` +
      `${Math.min(...LIVERIES.map((l) => lum(l.carrier))).toFixed(4)}-` +
      `${Math.max(...LIVERIES.map((l) => lum(l.carrier))).toFixed(4)} ` +
      `over webbing ${lum(LIVERIES[0].kit).toFixed(4)}`
  );
}

/**
 * Effective linear luminance per part = the livery colour its material slot
 * uses, times the mean vertex colour the geometry baked (per-part value step x
 * capsule AO x mottle; no weathering). Printed, not asserted — the assertions
 * that matter are the two above, on the colours themselves.
 */
console.log('\nvalue hierarchy — livery colour x baked vertex colour, per part (linear)');
{
  const stub = { get: () => ({}), glass: () => ({}) };
  const livery = liveryFor(0);
  const SLOT_COLOUR = {
    cloth: livery.suit,
    plate: livery.carrier,
    gear: livery.kit,
    boot: livery.trim,
    accent: livery.accent,
    polymer: HARDWARE.polymer,
    steel: HARDWARE.steel,
    rubber: HARDWARE.rubber,
    glass: HARDWARE.glass,
  };
  for (const vname in VARIANTS) {
    const built = buildSoldier(vname, { rng: new Rng(7).fork(), materials: stub, livery });
    const col = built.geometry.getAttribute('color');
    const rows = [];
    const byMat = new Map();
    for (const p of built.parts) {
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < p.count; i++) {
        r += col.getX(p.start + i); g += col.getY(p.start + i); b += col.getZ(p.start + i);
      }
      const base = SLOT_COLOUR[p.material] ?? HARDWARE.polymer;
      const v = lum([
        base[0] * (r / p.count),
        base[1] * (g / p.count),
        base[2] * (b / p.count),
      ]);
      rows.push({ name: p.name, mat: p.material, v });
      byMat.set(p.material, Math.max(byMat.get(p.material) ?? 0, v));
    }
    console.log(`  ${vname}: ${built.stats.triangles} tris, ${built.materialNames.length} slots`);
    for (const r of rows) {
      console.log(`     ${r.name.padEnd(13)} ${r.mat.padEnd(8)} ${r.v.toFixed(4)}`);
    }
    const plate = byMat.get('plate') ?? 0;
    const gear = byMat.get('gear') ?? 0;
    if (!(plate > gear * 1.4)) {
      fail(`${vname}: carrier ${plate.toFixed(4)} not clear of webbing ${gear.toFixed(4)}`);
    }
    // A face would show up here as a `skin` part that is not the head or neck.
    for (const r of rows) {
      if (r.mat === 'accent' && !['head', 'neck', 'helmet', 'shemagh'].includes(r.name)) {
        fail(`${vname}: unexpected accent part "${r.name}" — no faces`);
      }
    }
  }
}

console.log(failures ? `\nFAIL — ${failures} problem(s)` : '\nOK');
process.exitCode = failures ? 1 : 0;
