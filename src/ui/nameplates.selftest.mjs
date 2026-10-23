#!/usr/bin/env node
/**
 * Enemy nameplate checks — the pure half of src/ui/nameplates.js.
 *
 * Every rule here is invisible in a still frame that happens to be right: a
 * tag that names the man BEHIND the one you are aiming at, one that appears a
 * metre to the side of a body, one that strobes while you track a strafing
 * target, or one that keeps hovering over a corpse all look fine in the one
 * capture where the reticle is dead-centre on a live soldier. So the aim test
 * and the fade are asserted arithmetically instead.
 *
 * Mutation-checked: flipping the nearest-along-the-ray comparison, dropping the
 * assist term, removing the hold, or skipping the dead fast-path each fails a
 * check below.
 *
 *   node src/ui/nameplates.selftest.mjs
 */

import assert from 'node:assert/strict';
import {
  aimDistance,
  aimTolerance,
  pickTarget,
  stepPlate,
  BODY_RADIUS,
  MAX_RANGE,
  MIN_RANGE,
  HOLD,
  FADE_IN,
  FADE_OUT,
  FADE_DEAD,
} from './nameplates.js';

let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
}

const v = (x, y, z) => ({ x, y, z });
const norm = (d) => {
  const l = Math.hypot(d.x, d.y, d.z);
  return v(d.x / l, d.y / l, d.z / l);
};
/** A standing soldier at (x, z), feet on y = 0, head top at 1.8 m. */
const body = (x, z, head = 1.8) => ({ feet: v(x, 0, z), head: v(x, head, z) });

// The camera: eye height, looking down -Z, level.
const EYE = v(0, 1.6, 0);
const FWD = v(0, 0, -1);

/* --------------------------------------------------------- aim geometry -- */

check('aiming straight at a chest is a dead-centre hit at the right range', () => {
  const b = body(0, -20);
  const r = aimDistance(EYE, FWD, b.feet, b.head);
  assert.ok(Math.abs(r.t - 20) < 1e-9, `t ${r.t}`);
  assert.ok(r.miss < 1e-9, `miss ${r.miss}`);
  assert.equal(pickTarget(EYE, FWD, [b], 1), 0);
});

check('the aim point written out lies on the spine under the reticle', () => {
  const b = body(0, -12);
  const out = v(0, 0, 0);
  pickTarget(EYE, FWD, [b], 1, out);
  assert.ok(Math.abs(out.x) < 1e-9 && Math.abs(out.z + 12) < 1e-9);
  assert.ok(Math.abs(out.y - EYE.y) < 1e-9, `aim y ${out.y}`);
});

check('aiming over his head or at the dirt between his feet names nobody', () => {
  const b = body(0, -10);
  const over = norm(v(0, 1.0, -10)); // passes ~1 m over the head top
  assert.equal(pickTarget(EYE, over, [b], 1), -1);
  const under = norm(v(0, -1.6, -8)); // hits the ground short of him
  assert.equal(pickTarget(EYE, under, [b], 1), -1);
});

check('beside a body is a miss up close, inside the tube is a hit', () => {
  const near = body(BODY_RADIUS * 0.8, -6);
  const wide = body(BODY_RADIUS + 0.3, -6);
  assert.equal(pickTarget(EYE, FWD, [near], 1), 0);
  assert.equal(pickTarget(EYE, FWD, [wide], 1), -1);
});

check('the tube widens with range — the same 0.6 m offset hits at 60 m, misses at 5 m', () => {
  assert.ok(aimTolerance(60) > 0.6, `tol(60) ${aimTolerance(60)}`);
  assert.ok(aimTolerance(5) < 0.6, `tol(5) ${aimTolerance(5)}`);
  assert.equal(pickTarget(EYE, FWD, [body(0.6, -60)], 1), 0);
  assert.equal(pickTarget(EYE, FWD, [body(0.6, -5)], 1), -1);
  // and the assist is a nudge, not a lock-on: tolerance stays under a metre
  // even at the edge of range
  assert.ok(aimTolerance(MAX_RANGE) < 1.2, `tol(max) ${aimTolerance(MAX_RANGE)}`);
});

check('range bounds: nobody past MAX_RANGE, nobody behind the camera', () => {
  assert.equal(pickTarget(EYE, FWD, [body(0, -(MAX_RANGE + 1))], 1), -1);
  assert.equal(pickTarget(EYE, FWD, [body(0, -(MAX_RANGE - 1))], 1), 0);
  assert.equal(pickTarget(EYE, FWD, [body(0, 15)], 1), -1);
  assert.equal(pickTarget(EYE, FWD, [body(0, -MIN_RANGE * 0.5)], 1), -1);
});

check('the soldier in front is named, not the one behind — even off-centre', () => {
  // The front man is 0.2 m off the ray, the rear man dead on it: the front
  // one is still the body your reticle is on.
  const front = body(0.2, -8);
  const rear = body(0, -16);
  assert.equal(pickTarget(EYE, FWD, [rear, front], 2), 1);
  assert.equal(pickTarget(EYE, FWD, [front, rear], 2), 0);
});

check('a crouched body is named at chest height, not at standing head height', () => {
  const crouched = body(0, -10, 1.15);
  const atChest = norm(v(0, 0.85 - EYE.y, -10));
  assert.equal(pickTarget(EYE, atChest, [crouched], 1), 0);
  const atStandingHead = norm(v(0, 1.75 - EYE.y, -10));
  assert.equal(pickTarget(EYE, atStandingHead, [crouched], 1), -1);
});

check('only the first n entries are candidates (pooled lists carry stale tails)', () => {
  const stale = body(0, -10);
  assert.equal(pickTarget(EYE, FWD, [stale], 0), -1);
});

/* ---------------------------------------------------------------- fade -- */

const DT = 1 / 60;
const run = (plate, aimed, alive, seconds) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) stepPlate(plate, aimed, alive, DT);
  return plate.alpha;
};

check('a tag fades in fast — fully up within 1/FADE_IN s', () => {
  const p = { alpha: 0, hold: 0 };
  stepPlate(p, true, true, DT);
  assert.ok(p.alpha > 0 && p.alpha < 1, 'first frame is part of a fade, not a pop');
  assert.equal(run(p, true, true, 1 / FADE_IN + DT), 1);
});

check('it holds for HOLD seconds after the reticle leaves, then fades out', () => {
  const p = { alpha: 0, hold: 0 };
  run(p, true, true, 0.5);
  assert.equal(run(p, false, true, HOLD - 2 * DT), 1, 'still fully up inside the hold');
  run(p, false, true, 4 * DT);
  assert.ok(p.alpha < 1, 'fading once the hold has run out');
  assert.equal(run(p, false, true, 1 / FADE_OUT + DT), 0);
});

check('tracking jitter does not strobe the tag', () => {
  // A strafing target leaves the reticle for a couple of frames every few
  // frames; the tag must stay fully up throughout.
  const p = { alpha: 0, hold: 0 };
  run(p, true, true, 0.3);
  let min = 1;
  for (let i = 0; i < 240; i++) {
    stepPlate(p, i % 5 < 3, true, DT);
    min = Math.min(min, p.alpha);
  }
  assert.equal(min, 1);
});

check('a body that dies under the reticle loses its tag quickly, with no hold', () => {
  assert.ok(FADE_DEAD > FADE_OUT);
  const p = { alpha: 0, hold: 0 };
  run(p, true, true, 0.5);
  assert.equal(run(p, false, false, 1 / FADE_DEAD + DT), 0);
  assert.equal(p.hold, 0);
});

console.log(`nameplates: ${checks} checks passed`);
