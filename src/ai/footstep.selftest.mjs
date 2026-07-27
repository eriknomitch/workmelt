/**
 * AI FOOT PLANT self-test — the stride clock that drives `actor:footstep`.
 *
 * Enemy footsteps are timed off `Animator.footPlant` rather than off a timer,
 * so the sound lands when the foot visually contacts the ground. That only
 * holds if the detector fires exactly twice per stride, alternates feet, stays
 * silent on idle clips, and survives the animation-rate LOD in Agent._drive —
 * which skips two frames in three and then hands the animator an accumulated
 * dt. All four are checked here, headlessly, with no WebGL.
 *
 *   node src/ai/footstep.selftest.mjs
 */

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { RIG } from './rig.js';
import { Animator } from './animator.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`!! ${msg}`); };
const ok = (msg) => console.log(`   ${msg}`);

function check(name, cond, detail) {
  if (cond) ok(`${name} — ${detail}`);
  else fail(`${name} — ${detail}`);
}

/**
 * A bare animator on the real rig. No scene, no physics, no ground probe.
 *
 * The rig root is parented to a group and its world matrix primed, exactly as
 * Agent's constructor does — the arm IK reads `bones[0].parent`'s world
 * quaternion, so an unparented skeleton throws on the first update.
 */
function makeAnimator(seed = 7) {
  const { bones, root } = RIG.createSkeleton();
  const group = new THREE.Group();
  group.add(root);
  group.updateMatrixWorld(true);
  const a = new Animator(RIG, bones, { rng: new Rng(seed), scale: 1 });
  a.footIk = false; // no probe callback, so skip the ground solve entirely
  return a;
}

/**
 * Drive `seconds` of animation and collect the plants.
 * `chunk` emulates the LOD: 1 = every frame, 3 = one evaluation in three with
 * the skipped time accumulated, exactly as Agent._drive does.
 */
function run(clip, speed, seconds, { dt = 1 / 60, chunk = 1, crouch = false } = {}) {
  const an = makeAnimator();
  an.setState({ clip, speed, crouch });
  const plants = [];
  let accum = 0;
  let t = 0;
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    accum += dt;
    t += dt;
    if (i % chunk !== chunk - 1) continue;
    an.update(accum, t);
    accum = 0;
    if (an.footPlant) plants.push({ t, foot: an.footPlant, phase: an.phase });
  }
  return plants;
}

console.log('\n=== stride rate: two plants per cycle ===');
// strideHz mirrors animator.js: run speed/2.05, walk speed/1.42, crouch /0.95.
for (const [clip, speed, div, crouch] of [
  ['walk', 2.6, 1.42, false],
  ['run', 6.0, 2.05, false],
  ['crouchWalk', 1.4, 0.95, true],
]) {
  const secs = 12;
  const plants = run(clip, speed, secs, { crouch });
  const expected = Math.round((speed / div) * secs * 2); // two feet per cycle
  const drift = Math.abs(plants.length - expected);
  check(clip, drift <= 1, `${plants.length} plants in ${secs}s, expected ~${expected}`);

  // Feet must alternate: a body that plants the same foot twice is limping.
  let alternates = true;
  for (let i = 1; i < plants.length; i++) {
    if (plants[i].foot === plants[i - 1].foot) alternates = false;
  }
  check(`${clip} alternation`, alternates, alternates ? 'L/R strictly alternating' : 'repeated foot');

  // Contact sits at the pelvis-bob minima, a quarter and three quarters in.
  const offPhase = plants.filter((p) => {
    const d = Math.min(Math.abs(p.phase - 0.25), Math.abs(p.phase - 0.75));
    return d > 0.08;
  });
  check(`${clip} phase`, offPhase.length === 0,
    `${plants.length - offPhase.length}/${plants.length} plants within 0.08 of a bob minimum`);
}

console.log('\n=== idle clips never plant ===');
for (const clip of ['idle', 'crouchIdle', 'hurtIdle']) {
  const plants = run(clip, 0, 20);
  check(clip, plants.length === 0, `${plants.length} plants in 20s (idle phase still advances)`);
}

console.log('\n=== no plant on the first update ===');
{
  const an = makeAnimator();
  an.setState({ clip: 'run', speed: 6 });
  an.update(1 / 60, 0.016);
  check('first frame', an.footPlant === 0,
    `footPlant=${an.footPlant} — a body must not step on the frame it appears`);
}

console.log('\n=== animation-rate LOD preserves the step count ===');
{
  const full = run('run', 6.0, 12, { chunk: 1 });
  const lod = run('run', 6.0, 12, { chunk: 3 });
  const drift = Math.abs(full.length - lod.length);
  check('LOD 1-in-3', drift <= 1,
    `${full.length} plants at full rate vs ${lod.length} at a third rate`);
}

console.log('\n=== a slow frame drops steps rather than inventing them ===');
{
  // 4 Hz with an LOD skip is ~0.75 s of accumulated phase: more than a half
  // cycle, so plants are missed. What must never happen is a spurious extra.
  const slow = run('run', 6.0, 12, { dt: 1 / 4, chunk: 3 });
  const expected = Math.round((6.0 / 2.05) * 12 * 2);
  check('slow frame', slow.length <= expected,
    `${slow.length} plants <= the ${expected} a full-rate run produces`);
}

console.log(failures ? `\nFOOTSTEP SELFTEST: ${failures} FAILURE(S)\n` : '\nFOOTSTEP SELFTEST: PASS\n');
process.exit(failures ? 1 : 0);
