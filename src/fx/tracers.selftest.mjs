#!/usr/bin/env node
/**
 * FX — headless checks for the tracer's timing.
 *
 *   node src/fx/tracers.selftest.mjs
 *
 * `spawnTracer` is pure arithmetic over three particle descriptors, so the one
 * property that decides whether a tracer is SEEN can be checked without a GPU:
 * how long the streak exists.
 *
 * WHY THIS EXISTS. The shipped tracer was invisible at every range people
 * actually fight at, and nothing anywhere said so. Lifetime is `dist / v`, and
 * with `v` pinned at MAX_SPEED by every real muzzle velocity (800-900 m/s),
 * range alone decided it: a 12 m tracer existed for 35 ms, was sampled at two
 * instants by a 60 Hz frame, moved further between them than its own streak
 * length, and measured ZERO warm pixels in the FX rig. The same tracer at
 * 60 m/s measured 371. Every part of that is invisible to the tools that would
 * normally catch a regression — it throws nothing, the particles really are
 * emitted, `npm run build` is clean, and a still capture of a 35 ms effect is
 * empty whether the effect is correct or not.
 *
 * So the check is on TIME, in frames, because frames are what the failure was
 * measured in.
 */

import { spawnTracer } from './tracers.js';

let failures = 0;
let checks = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else {
    console.log(`  ok    ${label}${detail ? '  (' + detail + ')' : ''}`);
  }
};

/** Minimal stand-in for the FX system: collect what would have been emitted. */
function rig() {
  const emitted = [];
  return {
    fx: { rng: { float: () => 0.5 }, emitAdd: (s) => emitted.push({ ...s }) },
    emitted,
  };
}

/** Fire one tracer over `dist` metres at `speed` and report the descriptors. */
function fire(dist, speed) {
  const r = rig();
  spawnTracer(r.fx, { x: 0, y: 0, z: 0 }, { x: dist, y: 0, z: 0 }, speed);
  return r.emitted;
}

/** The real muzzle velocities in src/weapons/defs.js are all in this band. */
const MUZZLE = 800;
const FRAME = 1 / 60;

console.log('\ntracers — lifetime');
{
  const near = fire(12, MUZZLE);
  ok(near.length === 3, 'a tracer is three sprites: core, afterglow, head', `${near.length}`);
  ok(new Set(near.map((s) => s.life)).size === 1, 'and all three share one lifetime',
    'a head that outlives its streak is a floating spark');

  const life = near[0].life;
  ok(life >= 0.1 - 1e-9, 'a close-range tracer lasts long enough to be seen',
    `${(life * 1000).toFixed(0)} ms = ${(life / FRAME).toFixed(1)} frames at 60 Hz`);

  /**
   * THE REGRESSION, STATED AS THE NUMBER THAT FAILED. Two frames is what the
   * shipped version gave at this range and it measured zero pixels on screen.
   */
  ok(life / FRAME >= 5, 'at least five frames, not the two that measured invisible',
    `${(life / FRAME).toFixed(1)} frames over 12 m`);

  /**
   * A tracer that moves further in one frame than it is long cannot overlap
   * itself, and that is what made the old one read as disconnected dashes
   * rather than as a line of fire. Streak length is the shader's
   * `size * (1 + stretch * speed)` — see the velocity-aligned branch in
   * src/fx/particles.js.
   *
   * Measured against the LONGEST of the three sprites, which is the afterglow,
   * because continuity is exactly the job it is there for — the note above it
   * in tracers.js calls it "longer, dimmer, sits behind the core". The bright
   * core is deliberately shorter than the per-frame travel (1.8 m against
   * 2.0 m at 12 m) and reads as the burning pellet itself.
   *
   * The margin here is not large and the check is not decorative: the
   * afterglow's stretch of 0.6 gives 6.6 m against 2.0 m of travel, and it
   * still passes flattened to the core's 0.26 (2.9 m). Below about 0.17 it
   * fails, which is the point — this is what stops the afterglow being
   * quietly trimmed as "an expensive sprite that looks like the core" until
   * the line breaks into dashes again.
   */
  const v = Math.hypot(near[0].vx, near[0].vy, near[0].vz);
  const streak = Math.max(...near.map((s) => s.size0 * (1 + s.stretch * v)));
  ok(v * FRAME <= streak, 'and it does not outrun its own streak in one frame',
    `${(v * FRAME).toFixed(2)} m travelled vs ${streak.toFixed(2)} m of streak`);
}

console.log('\ntracers — the long shot is untouched');
{
  /**
   * The floor must not slow down the shots that were always legible: it only
   * bites under MAX_SPEED * MIN_LIFE = 34 m. Past that the streak keeps the
   * clamped speed it always had, so departure and arrival stay honest.
   */
  const far = fire(80, MUZZLE);
  const v = Math.hypot(far[0].vx, far[0].vy, far[0].vz);
  ok(Math.abs(v - 340) < 1e-6, 'a long shot still flies at the readable-speed clamp',
    `${v.toFixed(0)} m/s over 80 m`);
  ok(Math.abs(far[0].life - 80 / 340) < 1e-9, 'so its lifetime is unchanged',
    `${(far[0].life * 1000).toFixed(0)} ms`);

  // Monotonic: a longer shot is never on screen for less time than a shorter one.
  let prev = 0;
  let bad = null;
  for (let d = 2; d <= 120; d += 2) {
    const life = fire(d, MUZZLE)[0].life;
    if (life < prev - 1e-9) bad = d;
    prev = life;
  }
  ok(bad === null, 'lifetime never falls as the shot gets longer',
    bad === null ? '2 m to 120 m' : `dropped at ${bad} m`);
}

console.log('\ntracers — degenerate input');
{
  const r = rig();
  spawnTracer(r.fx, { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, MUZZLE);
  ok(r.emitted.length === 0, 'a point-blank hit emits nothing rather than a stationary blob',
    'under the 0.35 m floor');

  const slow = fire(12, 0);
  ok(slow.length === 3 && slow[0].life > 0 && Number.isFinite(slow[0].life),
    'a payload with no speed still produces a finite tracer',
    `${(slow[0].life * 1000).toFixed(0)} ms`);
}

console.log(
  failures === 0 ? `\nPASS  ${checks}/${checks} checks` : `\nFAIL  ${checks - failures}/${checks} checks`
);
process.exit(failures === 0 ? 0 : 1);
