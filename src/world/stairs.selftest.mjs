#!/usr/bin/env node
/**
 * WORLD — a stair flight must look like stairs from where you approach it.
 *
 *   node src/world/stairs.selftest.mjs
 *
 * `stairRun` used to dress every flight with an axis-aligned "stringer" box
 * of the flight's full width, height and depth. That box ENCLOSED the treads,
 * so from the floor every staircase in the game rendered as a solid cube, and
 * it only turned into stairs once you were standing on it: with the eye inside
 * the box, its single-sided faces back-culled and the steps showed through.
 *
 * Nothing else catches it. Collision is per step, so the controller climbs as
 * it should; the build is green; and a capture from the usual vantage points
 * shows a believable concrete block. So the invariant is asserted on the
 * geometry: no drawn box may contain the air just above a tread or just in
 * front of a riser — and, so the fix cannot be "delete the stringer", the
 * soffit under every step must still be covered by something drawn.
 *
 * Mutation-checked: restoring the old full-height box fails the first two
 * groups on every flight below.
 */

import * as THREE from 'three';
import { stairRun } from './kit.js';

let pass = 0;
let fail = 0;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
function ok(cond, label, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mok\x1b[0m    ${label}${detail ? `  \x1b[2m(${detail})\x1b[0m` : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

/**
 * The smallest assembler `stairRun` runs against. Every drawn piece it emits is
 * a unit box scaled by its matrix, so recording the inverse of each matrix is
 * enough to ask "is this point inside anything drawn?".
 */
function rig() {
  const drawn = [];
  const A = {
    cache: (key, make) => make(),
    surfaceOf: (key) => key,
    add: (key, geo, m) => drawn.push(m.clone().invert()),
    box: () => {},
  };
  return { A, drawn };
}

const _v = new THREE.Vector3();
/** Indices of every drawn box containing level-space point `p`. */
function inside(drawn, p, pad = 0) {
  const out = [];
  drawn.forEach((inv, i) => {
    _v.copy(p).applyMatrix4(inv);
    const h = 0.5 + pad;
    if (Math.abs(_v.x) < h && Math.abs(_v.y) < h && Math.abs(_v.z) < h) out.push(i);
  });
  return out;
}

// The flights the maps actually build, by their own numbers: a market
// stairwell, the Wilmot manor and terrace, Blood Gulch's long exterior run,
// Nuketown's sixteen-step flight. Each is posed off-axis so a check that only
// held for an identity matrix would not pass by accident.
const FLIGHTS = [
  { name: 'market stairwell', w: 1.2, steps: 16, rise: 0.19, run: 0.275 },
  { name: 'wilmot manor', w: 1.3, steps: 11, rise: 0.271, run: 0.3 },
  { name: 'wilmot terrace', w: 2.4, steps: 3, rise: 0.133, run: 0.32 },
  { name: 'blood gulch ramp', w: 2.2, steps: 18, rise: 0.256, run: 0.467 },
  { name: 'nuketown', w: 1.9, steps: 16, rise: 0.2, run: 0.27 },
];

for (const f of FLIGHTS) {
  console.log(B(`\n${f.name}`));
  const pm = new THREE.Matrix4().compose(
    new THREE.Vector3(3.5, 0.4, -7.25),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0)),
    new THREE.Vector3(1, 1, 1)
  );
  const { A, drawn } = rig();
  stairRun(A, pm, 0, 0, 0, f.w, f.steps, f.rise, f.run, { railing: 'right' });
  // `stairRun` adds the treads first, one per step; everything after is dressing.
  const treads = new Set(Array.from({ length: f.steps }, (_, i) => i));
  const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(pm);

  // 1. The air a centimetre above each tread, at its nosing, middle and back.
  const buried = [];
  for (let i = 0; i < f.steps; i++) {
    for (const u of [0.05, 0.5, 0.95]) {
      const hit = inside(drawn, at(0, (i + 1) * f.rise + 0.01, (i + u) * f.run));
      if (hit.length) buried.push(`step ${i} @${u}`);
    }
  }
  ok(buried.length === 0, 'every tread is open to the air above it',
    buried.length ? `${buried.length} buried, first ${buried[0]}` : `${f.steps * 3} points`);

  // 2. The air two centimetres in front of each riser, at mid-height.
  const hidden = [];
  for (let i = 0; i < f.steps; i++) {
    if (inside(drawn, at(0, (i + 0.5) * f.rise, i * f.run - 0.02)).length) hidden.push(i);
  }
  ok(hidden.length === 0, 'every riser faces open air',
    hidden.length ? `risers ${hidden.join(',')} are inside a box` : `${f.steps} risers`);

  // 3. ...and the flight is still carried by something: just under each step's
  //    lower back corner there is dressing, not the gap between two blocks.
  const bare = [];
  for (let i = 0; i < f.steps; i++) {
    const hit = inside(drawn, at(0, i * f.rise - 0.02, (i + 1) * f.run - 0.02));
    if (!hit.some((k) => !treads.has(k))) bare.push(i);
  }
  ok(bare.length === 0, 'the underside is one carried slope, not floating blocks',
    bare.length ? `steps ${bare.join(',')} have nothing under them` : `${f.steps} soffits`);
}

console.log(B('\nstringer: false'));
{
  const { A, drawn } = rig();
  stairRun(A, new THREE.Matrix4(), 0, 0, 0, 1.2, 10, 0.2, 0.3, { stringer: false });
  ok(drawn.length === 10, 'opting out draws the treads and nothing else', `${drawn.length} boxes`);
}

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
