#!/usr/bin/env node
/**
 * AI — headless checks for the view-distance LOD (`AiSystem._updateRelevance`
 * and `animGate`).
 *
 *   node src/ai/lod.selftest.mjs
 *
 * Neither half of this is visible in a screenshot, which is why it is worth a
 * harness. A broken phase offset costs exactly the same average frame time as a
 * correct one and shows up only as a stutter; inverted hysteresis oscillates a
 * tier boundary that no still frame can catch; and a starved actor holds a pose
 * that looks fine until you watch it walk.
 *
 * The relevance pass is driven through the REAL method on the real prototype
 * with a minimal ctx, so the tier boundaries, the hysteresis and the shadow
 * cutoff are read out of the shipping code rather than restated here.
 */

import * as THREE from 'three';
import assert from 'node:assert/strict';
import { AiSystem } from './index.js';
import { animGate } from './agent.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ------------------------------------------------------------------ */
/* a stand-in actor: only what _updateRelevance actually reads          */
/* ------------------------------------------------------------------ */

function makeAgent(x, y, z) {
  const geo = new THREE.BufferGeometry();
  // A standing soldier's bound. _updateRelevance inflates it by 4 m itself.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.1);
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return { mesh, lodIrrelevant: false, animEvery: 1 };
}

/** A bare AiSystem with just the state the relevance pass touches. */
function makeSystem(agents, shadowDistance = 140) {
  const sys = Object.create(AiSystem.prototype);
  sys.agents = agents;
  sys.grid = null;
  sys._frustum = new THREE.Frustum();
  sys._mvp = new THREE.Matrix4();
  sys._sphere = new THREE.Sphere();
  sys._sweep = new THREE.Sphere();
  sys._sun = new THREE.Vector3(0, 1, 0);
  sys._eye = new THREE.Vector3();
  sys._lodStats = { irrelevant: 0, unshadowed: 0 };
  sys.stats = {};
  // Straight down, so the shadow sweep terminates immediately and cannot
  // rescue an actor that the frustum test rejected.
  sys._sky = { sunDirection: new THREE.Vector3(0, 1, 0) };
  return {
    sys,
    ctx: {
      camera: null,
      config: { q: { shadowDistance } },
      peek: () => sys._sky,
    },
  };
}

/** Camera at the origin looking down -Z, wide enough to hold the whole test. */
function makeCamera() {
  const cam = new THREE.PerspectiveCamera(90, 16 / 9, 0.15, 400);
  cam.position.set(0, 1.7, 0);
  cam.lookAt(0, 1.7, -1);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/* ================================================================== */
/* 1. animGate — phase spreading                                       */
/* ================================================================== */

// A tier's work must arrive flat, not as a spike. With 12 actors at every = 3
// no single frame may carry more than a ceil(12/3) share of them.
for (const every of [2, 3]) {
  const N = 12;
  const perFrame = [];
  for (let frame = 0; frame < 60; frame++) {
    let n = 0;
    for (let id = 1; id <= N; id++) if (animGate(frame, id, every, 0)) n++;
    perFrame.push(n);
  }
  const worst = Math.max(...perFrame);
  ok(
    worst <= Math.ceil(N / every),
    `every=${every}: worst frame evaluates ${worst} of ${N}, want <= ${Math.ceil(N / every)}`
  );
  // And it must genuinely be spread, not merely capped: no idle frames either.
  ok(Math.min(...perFrame) >= Math.floor(N / every) - 1,
    `every=${every}: some frame evaluates almost nobody (${Math.min(...perFrame)})`);
}

// every = 1 is unconditional.
for (let frame = 0; frame < 10; frame++) {
  ok(animGate(frame, 7, 1, 0) === true, 'every=1 must evaluate every frame');
}

/* ================================================================== */
/* 2. animGate — the run bound                                         */
/* ================================================================== */

// Simulate one actor whose tier keeps changing underneath it. The adversarial
// case is a tier that moves so its phase never comes up; the bound is what stops
// that becoming a frozen pose.
{
  let skip = 0;
  let longestRun = 0;
  let run = 0;
  let evaluations = 0;
  const FRAMES = 600;
  for (let frame = 0; frame < FRAMES; frame++) {
    // Worst case on purpose: pick the `every` that misses this actor's phase.
    let every = 3;
    for (const cand of [2, 3]) {
      if (((frame + 5) % cand) !== 0) { every = cand; break; }
    }
    if (animGate(frame, 5, every, skip)) {
      skip = 0;
      evaluations++;
      longestRun = Math.max(longestRun, run);
      run = 0;
    } else {
      skip++;
      run++;
    }
  }
  ok(longestRun <= 2, `adversarial re-tiering starved the pose for ${longestRun} frames, want <= 2`);
  ok(evaluations >= FRAMES / 3,
    `adversarial re-tiering evaluated ${evaluations}/${FRAMES}, want >= 1 in 3`);
}

// The steady-state guarantee at each tier: at least one evaluation in `every`.
for (const every of [2, 3]) {
  let skip = 0;
  let run = 0;
  let longestRun = 0;
  for (let frame = 0; frame < 300; frame++) {
    if (animGate(frame, 4, every, skip)) { skip = 0; longestRun = Math.max(longestRun, run); run = 0; }
    else { skip++; run++; }
  }
  ok(longestRun <= every - 1,
    `every=${every}: held ${longestRun} consecutive frames, want <= ${every - 1}`);
}

/* ================================================================== */
/* 3. Tiering by distance                                              */
/* ================================================================== */

{
  const cam = makeCamera();
  // Straight down the view axis at a spread of ranges.
  const ranges = [5, 15, 24, 30, 40, 50, 70, 120];
  const agents = ranges.map((d) => makeAgent(0, 1.7, -d));
  const { sys, ctx } = makeSystem(agents);
  ctx.camera = cam;
  sys._updateRelevance(ctx);

  const tier = (d) => agents[ranges.indexOf(d)].animEvery;
  eq(tier(5), 1, 'an actor at 5 m must animate every frame');
  eq(tier(15), 1, 'an actor at 15 m must animate every frame');
  eq(tier(24), 1, 'an actor at 24 m is inside the near band');
  eq(tier(30), 2, 'an actor at 30 m must drop to half rate');
  eq(tier(40), 2, 'an actor at 40 m stays at half rate');
  eq(tier(50), 3, 'an actor at 50 m must drop to a third');
  eq(tier(120), 3, 'a very distant actor must animate at a third');

  // Monotonic: a further actor can never animate more often than a nearer one.
  for (let i = 1; i < ranges.length; i++) {
    ok(agents[i].animEvery >= agents[i - 1].animEvery,
      `tier must not improve with distance (${ranges[i - 1]} m -> ${ranges[i]} m)`);
  }
}

/* ================================================================== */
/* 4. Hysteresis — the boundary must not oscillate                     */
/* ================================================================== */

// Park a STATIONARY actor at each of a spread of distances and step the pass
// many times. Any tier that changes under it is an oscillation.
//
// Sweeping matters: an inverted band is stable when the actor sits exactly ON
// the boundary (both comparisons are `<=`) and only thrashes strictly INSIDE
// the hysteresis zone. A check parked on 25 and 45 m passes with the bug intact
// — which is how the bug got written in the first place. Step finely enough to
// land several samples inside a 3 m band.
for (let d = 20; d <= 55; d += 0.5) {
  const cam = makeCamera();
  const a = makeAgent(0, 1.7, -d);
  const { sys, ctx } = makeSystem([a]);
  ctx.camera = cam;
  sys._updateRelevance(ctx);
  const settled = a.animEvery;
  let stable = true;
  for (let i = 0; i < 20; i++) {
    sys._updateRelevance(ctx);
    if (a.animEvery !== settled) { stable = false; break; }
  }
  ok(stable, `tier oscillated under a stationary actor at ${d} m`);
}

// Crossing outward then back must show a real band: the distance that drops a
// tier is strictly further than the one that restores it.
{
  const cam = makeCamera();
  const a = makeAgent(0, 1.7, -20);
  const { sys, ctx } = makeSystem([a]);
  ctx.camera = cam;

  const at = (d) => {
    a.mesh.position.set(0, 1.7, -d);
    a.mesh.updateMatrixWorld(true);
    sys._updateRelevance(ctx);
    return a.animEvery;
  };

  eq(at(20), 1, 'starts in the near tier');
  eq(at(26), 1, 'must not leave the near tier the instant it passes 25 m');
  eq(at(29), 2, 'must leave the near tier once well past the band');
  eq(at(26), 2, 'must not re-enter the near tier at the same distance it left');
  eq(at(24), 1, 're-enters the near tier inside the boundary');
}

/* ================================================================== */
/* 5. Sun shadow cutoff                                                */
/* ================================================================== */

{
  const cam = makeCamera();
  // high preset: shadowDistance 140 -> actor cutoff 63 m
  const near = makeAgent(0, 1.7, -30);
  const far = makeAgent(0, 1.7, -100);
  const { sys, ctx } = makeSystem([near, far], 140);
  ctx.camera = cam;
  sys._updateRelevance(ctx);

  eq(near.mesh.userData.owNoShadow, false, 'an actor at 30 m must still cast');
  eq(far.mesh.userData.owNoShadow, true, 'an actor at 100 m must leave the cascades');
  eq(sys.stats.lodUnshadowed, 1, 'lodUnshadowed must count the dropped caster');
}

// The cutoff scales with the preset, so a cheap tier cannot cast further than
// its own cascades reach.
{
  const cam = makeCamera();
  const mk = (shadowDistance) => {
    const a = makeAgent(0, 1.7, -40);
    const { sys, ctx } = makeSystem([a], shadowDistance);
    ctx.camera = cam;
    sys._updateRelevance(ctx);
    return a.mesh.userData.owNoShadow;
  };
  eq(mk(200), false, 'ultra (200 m) must still cast at 40 m');
  eq(mk(140), false, 'high (140 m) must still cast at 40 m');
  eq(mk(60), true, 'low (60 m) must not cast at 40 m — past its own cascades');
  eq(mk(30), true, 'performance (30 m) must not cast at 40 m');
}

// Shadow hysteresis: a body loitering on the cutoff must not flicker, which is
// far more visible on the ground than the shadow simply being absent.
//
// This has to MOVE the actor. A stationary one cannot expose a missing band at
// all — without hysteresis the test is a pure function of distance, so it is
// perfectly stable standing still and thrashes only while crossing. Walk it
// back and forth over the 63 m cutoff, entirely inside the 8% restore band, and
// count transitions: with a band there is exactly one (the initial drop), and
// with none there is one per step.
{
  const cam = makeCamera();
  const a = makeAgent(0, 1.7, -60);
  const { sys, ctx } = makeSystem([a], 140);
  ctx.camera = cam;
  sys._updateRelevance(ctx);

  let transitions = 0;
  let prev = a.mesh.userData.owNoShadow;
  for (let i = 0; i < 40; i++) {
    const d = 63 + (i % 2 ? 1.5 : -1.5); // 64.5 / 61.5, both inside the band
    a.mesh.position.set(0, 1.7, -d);
    a.mesh.updateMatrixWorld(true);
    sys._updateRelevance(ctx);
    if (a.mesh.userData.owNoShadow !== prev) transitions++;
    prev = a.mesh.userData.owNoShadow;
  }
  ok(transitions <= 1,
    `shadow toggled ${transitions} times while loitering on the cutoff, want <= 1`);
}

// And the band must actually release: walk it well inside and the shadow
// returns, or "hysteresis" is just a one-way latch.
{
  const cam = makeCamera();
  const a = makeAgent(0, 1.7, -80);
  const { sys, ctx } = makeSystem([a], 140);
  ctx.camera = cam;

  const at = (d) => {
    a.mesh.position.set(0, 1.7, -d);
    a.mesh.updateMatrixWorld(true);
    sys._updateRelevance(ctx);
    return a.mesh.userData.owNoShadow;
  };

  eq(at(80), true, 'starts well past the cutoff, not casting');
  eq(at(61), true, 'must not restore the instant it re-enters the cutoff');
  eq(at(50), false, 'must restore once well inside the band');
}

/* ================================================================== */
/* 6. The off-screen case still behaves as it did                      */
/* ================================================================== */

{
  const cam = makeCamera();
  // Directly behind the camera, and the sun is straight up, so the shadow sweep
  // cannot bring it back.
  const behind = makeAgent(0, 1.7, 60);
  const { sys, ctx } = makeSystem([behind]);
  ctx.camera = cam;
  sys._updateRelevance(ctx);

  eq(behind.lodIrrelevant, true, 'an actor behind the camera is irrelevant');
  eq(behind.animEvery, 3, 'an irrelevant actor animates at a third rate');
  eq(behind.mesh.userData.owNoShadow, true, 'an irrelevant actor leaves the cascades');
  eq(sys.stats.lodIrrelevant, 1, 'lodIrrelevant must count it');
}

/* ================================================================== */
/* 7. What the tiers are actually worth                                */
/* ================================================================== */

// Not an assertion — a hardware-independent report, in the spirit of
// `costIndex`. Pose evaluations per frame for a garrison spread across the map,
// against the every-frame cost the binary LOD paid for the same set.
{
  const cam = makeCamera();
  const agents = [];
  // A plausible spread: a firefight up close, the rest of the map behind it.
  for (let i = 0; i < 24; i++) {
    const d = 6 + i * 4; // 6 m out to 98 m
    agents.push(makeAgent(0, 1.7, -d));
  }
  const { sys, ctx } = makeSystem(agents, 140);
  ctx.camera = cam;
  sys._updateRelevance(ctx);

  let evals = 0;
  const FRAMES = 180;
  for (let frame = 0; frame < FRAMES; frame++) {
    for (let i = 0; i < agents.length; i++) {
      if (animGate(frame, i + 1, agents[i].animEvery, 0)) evals++;
    }
  }
  const before = agents.length * FRAMES;
  const tiers = agents.reduce((m, a) => (m[a.animEvery] = (m[a.animEvery] ?? 0) + 1, m), {});
  const unshadowed = sys.stats.lodUnshadowed;
  console.log(
    `\n  24 actors, 6-98 m, high preset:\n` +
    `    tiers            every-frame ${tiers[1] ?? 0}, half ${tiers[2] ?? 0}, third ${tiers[3] ?? 0}\n` +
    `    pose evaluations ${evals} / ${before} frames-actors ` +
    `(${((1 - evals / before) * 100).toFixed(0)}% fewer)\n` +
    `    sun casters      ${agents.length - unshadowed} / ${agents.length} ` +
    `(${unshadowed} dropped past 63 m)`
  );
}

console.log(`\nOK — ${checks} checks`);
