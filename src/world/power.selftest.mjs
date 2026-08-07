#!/usr/bin/env node
/**
 * WORLD — headless checks for the destructible power grid.
 *
 *   node src/world/power.selftest.mjs
 *
 * Every interesting property of an outage is a TIMING property: how long the
 * mains stay down, what they fall to, that they come back at all, that a second
 * generator cannot extend the dark, that the dip envelope is deterministic. A
 * capture shows one instant and cannot see any of them, and none of them throws
 * when it breaks — a grid that never restores just makes a map that is dark
 * forever, and the build, the draw calls and every layout check stay green.
 *
 * So the arithmetic lives in `power.js` with no lights, no materials and no
 * `THREE` in it, and this drives a whole outage in about a millisecond.
 */

import { PowerGrid, POWER_DEFAULTS } from './power.js';
import { SITEWORK_MAP, GENERATORS, FRAME } from './sitework.js';

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

/** A grid of three 2 x 2 x 2 m boxes in a row, for the arithmetic checks. */
const rig = (over = {}) =>
  new PowerGrid({
    hp: 100,
    outage: 10,
    dim: 0.1,
    boxes: [
      { id: 'a', cx: -4, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 },
      { id: 'b', cx: 0, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 },
      { id: 'c', cx: 4, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 },
    ],
    ...over,
  });

/** Run `secs` of clock in fixed 1/60 steps, returning every restore edge. */
function run(g, secs) {
  const edges = [];
  const step = 1 / 60;
  for (let t = 0; t < secs; t += step) if (g.update(step)) edges.push(+t.toFixed(3));
  return edges;
}

/* ─────────────────────────────────────────────────────────── hit detection ── */
console.log(B('\npower — hit detection'));
{
  const g = rig();
  ok(g.at(0, 1, 0)?.id === 'b', 'a point inside a generator finds it');
  ok(g.at(-4, 1.9, 0.9)?.id === 'a', 'and anywhere else inside its box');
  ok(g.at(2, 1, 0) === null, 'a point in the gap between two finds nothing');
  ok(g.at(0, 4, 0) === null, 'and so does a point above them', 'y is tested, not just the footprint');
  // The margin exists because a bullet impact is reported ON the surface, and
  // floating point puts it a hair outside as often as a hair inside.
  ok(g.at(0, 1, 1 + POWER_DEFAULTS.margin * 0.5)?.id === 'b',
    'a point just off the surface still counts', `${POWER_DEFAULTS.margin} m of margin`);
  ok(g.at(0, 1, 1 + POWER_DEFAULTS.margin * 3) === null, 'but not one well clear of it');
}

/* ──────────────────────────────────────────────────────────────── damage ──── */
console.log(B('\npower — damage'));
{
  const g = rig();
  ok(g.damage(0, 1, 0, 30).hit === true, 'a round on a generator lands');
  ok(g.generators[1].hp === 70, 'and takes its hit points down', `${g.generators[1].hp}`);
  ok(g.damage(2, 1, 0, 30).hit === false, 'a round in the gap does nothing');
  ok(!g.out, 'a damaged generator does not trip the grid');

  const r = g.damage(0, 1, 0, 200);
  ok(r.destroyed === true && g.generators[1].alive === false, 'overkill destroys it');
  ok(g.out && Math.abs(g.remaining - 10) < 1e-9, 'and trips the mains for the full outage',
    `${g.remaining.toFixed(1)} s`);
  ok(g.standing === 2, 'the other two are still standing');
}

/**
 * THE CEILING ON THE MECHANIC. Generators are invulnerable while the mains are
 * down, so a player who owns the generator room cannot chain one outage into
 * another and hold the whole map dark for the length of a match. This is the
 * single most important balance property here and it is invisible in every
 * other kind of check.
 */
console.log(B('\npower — the outage cannot be extended'));
{
  const g = rig();
  g.damage(0, 1, 0, 999);
  const at = g.remaining;
  run(g, 3);
  const second = g.damage(-4, 1, 0, 999);
  ok(second.hit === false, 'a second generator cannot be damaged during an outage');
  ok(g.standing === 2, 'so it survives', `${g.standing} standing`);
  ok(g.remaining < at, 'and the clock keeps running down rather than resetting',
    `${g.remaining.toFixed(2)} s left of ${at} s`);

  const edges = run(g, 12);
  ok(edges.length === 1, 'the mains come back exactly once', `at t+${edges[0]} s`);
  ok(!g.out, 'and stay back');
  /**
   * The ramp has to actually ARRIVE. Same root cause as the check above: with
   * the restore timed off a clamped counter it stuck at `dim` forever, which
   * is a map that goes dark once and never comes back.
   */
  run(g, 3);
  ok(g.level === 1, 'and climb the whole way back to their authored brightness',
    g.level.toFixed(3));
  ok(g.standing === 3 && g.generators.every((x) => x.hp === 100),
    'every generator is repaired with them, so the map keeps its feature',
    'a one-shot mechanic is spent in the first minute of a match');
}

/* ─────────────────────────────────────────────────────────────── the level ── */
console.log(B('\npower — the mains level'));
{
  const g = rig();
  ok(g.level === 1, 'the mains sit at full with every generator up');
  /**
   * AND STAY THERE WITHOUT BEING TOLD. A grid that has never tripped must read
   * full on every frame, not just before its first `update`. The first version
   * timed its restore ramp off `-remaining`, which is clamped to 0 — so an
   * untripped grid reported the DIM level from frame one and the map shipped
   * permanently browned out with the outage changing nothing at all. It threw
   * nothing and every other check stayed green.
   *
   * THE FIRST TICK IS THE ONE THAT MATTERS. A grid built with its restore
   * counter at zero rather than saturated heals itself within `restoreTime`,
   * so a check five seconds in cannot see it — it only ever shows in the
   * frames right after a build, which is exactly when a capture is taken.
   */
  g.update(1 / 60);
  ok(g.level === 1, 'and are still at full after the very first tick', g.level.toFixed(3));
  run(g, 5);
  ok(g.level === 1, 'and after five seconds of nobody shooting anything', g.level.toFixed(3));
  g.damage(0, 1, 0, 999);
  g.update(1 / 60);
  ok(g.level < 1, 'and start falling on the frame the generator dies', g.level.toFixed(3));

  // Settle past the dips.
  run(g, 1.2);
  ok(Math.abs(g.level - 0.1) < 1e-6, 'they settle at the authored dim level', g.level.toFixed(3));

  // The dips: sample the whole drop and require the level to go back UP at
  // least once before it settles. A monotonic fall is a renderer glitch; a
  // supply failing is not.
  const h = rig();
  h.damage(0, 1, 0, 999);
  const trace = [];
  for (let i = 0; i < 60; i++) {
    h.update(1 / 120);
    trace.push(h.level);
  }
  let rises = 0;
  for (let i = 1; i < trace.length; i++) if (trace[i] > trace[i - 1] + 1e-6) rises++;
  ok(rises >= 2, 'the supply dips back up on the way out rather than cutting flat',
    `${rises} rising samples`);

  // Determinism: two grids driven identically must agree exactly, or a capture
  // of an outage stops reproducing.
  const a = rig();
  const b = rig();
  a.damage(0, 1, 0, 999);
  b.damage(0, 1, 0, 999);
  let same = true;
  for (let i = 0; i < 400; i++) {
    a.update(1 / 60);
    b.update(1 / 60);
    if (a.level !== b.level) same = false;
  }
  ok(same, 'and the whole envelope is deterministic', 'no rng, so a capture reproduces');
}

/* ───────────────────────────────────────────────────────────────── splash ─── */
console.log(B('\npower — blast damage'));
{
  const g = rig();
  const killed = g.splash(0, 1, 0, 6, 999);
  ok(killed.length === 1, 'one grenade is one outage, however many it reaches',
    `${killed.length} destroyed, ${g.standing} standing`);
  ok(g.out, 'and it trips the mains');

  const h = rig();
  ok(h.splash(40, 1, 0, 6, 999).length === 0, 'a blast nowhere near does nothing');
  ok(!h.out, 'and does not trip anything');

  // Falloff: a blast at the edge of its radius must not one-shot what a blast
  // at the centre does, or radius stops meaning anything.
  const j = rig({ hp: 100 });
  j.splash(0 + 5.9, 1, 0, 6, 100);
  ok(j.standing === 3, 'a blast at the rim of its radius does not destroy',
    `generator b on ${j.generators[1].hp.toFixed(1)} hp`);
}

/* ────────────────────────────────────────────────────── the map's own grid ── */
console.log(B('\npower — site work'));
{
  const spec = SITEWORK_MAP.power;
  ok(spec !== undefined, 'site work declares a power grid');
  ok(GENERATORS.length >= 3, 'with a row of generators', `${GENERATORS.length}`);

  /**
   * Every generator has to sit INSIDE the frame — that is the whole point of
   * the feature, that the power room is the contested middle of the map rather
   * than a box in a corner somebody can farm unopposed.
   */
  const outside = GENERATORS.filter((g) =>
    Math.abs(g.x - FRAME.x) > FRAME.w / 2 - g.w / 2 ||
    Math.abs(g.z - FRAME.z) > FRAME.d / 2 - g.d / 2);
  ok(outside.length === 0, 'and all of them stand inside the frame',
    outside.map((g) => g.id).join(' '));

  // They must not foul each other, or two boxes share a hit point.
  const clash = [];
  for (let i = 0; i < GENERATORS.length; i++)
    for (let j = i + 1; j < GENERATORS.length; j++) {
      const a = GENERATORS[i];
      const b = GENERATORS[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2) {
        clash.push(`${a.id}/${b.id}`);
      }
    }
  ok(clash.length === 0, 'no two generators overlap', clash.join(' '));

  /**
   * BALANCE, WRITTEN DOWN. The rifle does ~34 a round with a 30 round
   * magazine, so a generator at 700 is a little over two thirds of one
   * magazine — committed fire in a room somebody else wants, not a stray
   * round. The outage is long enough to fight a whole engagement in and short
   * enough that a match is not played in the dark.
   */
  const hp = spec.hp ?? POWER_DEFAULTS.hp;
  ok(hp >= 300 && hp <= 1200, 'a generator costs real ammunition to break',
    `${hp} hp ≈ ${(hp / 34).toFixed(0)} rifle rounds`);
  const out = spec.outage ?? POWER_DEFAULTS.outage;
  ok(out >= 10 && out <= 45, 'and the dark is a phase of the match, not the match',
    `${out} s`);
  /**
   * THE DARK IS NEVER TOTAL. `dim` is what the mains fall to, and zero is a
   * map you cannot fight on: the neon carries the layout but the mains carry
   * the near field, and at 0 a player standing next to a lamp mast is as blind
   * as one in open ground. Asserted on the MAP's own number rather than on a
   * test rig's, which is what the first version of this check got wrong — it
   * asserted about its own fixture and could not have failed.
   */
  const dim = spec.dim ?? POWER_DEFAULTS.dim;
  ok(dim > 0.02 && dim < 0.4, 'and the dark is never total — a fight has to stay winnable in it',
    `mains fall to ${(dim * 100).toFixed(0)}% of authored`);

  /**
   * THE EXPOSURE SPLIT. The blacked-out frame is authored at a fixed net stop
   * -down: the map's own `environment.exposureBias` plus the grid's
   * `outageEv`. How that total is DIVIDED is free — it is the only knob for
   * how bright the powered site is — but the total is not, and moving it moves
   * the dark.
   *
   * This exists because "the powered map is too dark" is a one-line edit to
   * `exposureBias`, and made on its own it brightens the outage by exactly as
   * much and quietly undoes the contrast the whole feature is for. It has
   * already been retuned once (1.0/1.1 -> 0.45/1.65) and the sum is what
   * survived unchanged.
   */
  const base = SITEWORK_MAP.environment?.exposureBias ?? 0;
  const ev = spec.outageEv ?? POWER_DEFAULTS.outageEv;
  ok(Math.abs(base + ev - 2.1) < 1e-6,
    'the powered and blacked-out exposures still sum to the authored 2.1 EV',
    `${base} + ${ev} = ${(base + ev).toFixed(2)}`);
  ok(base >= 0 && ev > 0, 'and the outage is a stop DOWN from the powered state, not up',
    `powered ${base} EV, outage +${ev} EV`);

  /**
   * TWO CIRCUITS, WIRED OPPOSITE WAYS, AND NEITHER IS OPTIONAL.
   *
   * The neon is the EMERGENCY circuit: dark while the site has power, and the
   * only thing lit once it does not. Put it on the mains instead and a
   * blacked-out site is a black rectangle; leave it off both lists and it
   * never lights at all and the outage has nothing to read by. Both mistakes
   * build, draw and pass every other check in the suite.
   */
  ok(!spec.mains.includes('sw_neon'), 'the neon is not on the mains', spec.mains.join(' '));
  ok((spec.emergency ?? []).includes('sw_neon'),
    'it is on the emergency circuit — dark with power, lit without',
    (spec.emergency ?? []).join(' ') || 'nothing declared');
  ok(spec.mains.length > 0, 'and something is actually on the mains', spec.mains.join(' '));

  // The two circuits must not share a key: one would fight the other every
  // frame and the last write would win, which is a coin flip on list order.
  const both = spec.mains.filter((k) => (spec.emergency ?? []).includes(k));
  ok(both.length === 0, 'and no key is on both circuits', both.join(' '));

  ok([...spec.mains, ...(spec.emergency ?? [])].every((k) => k.startsWith('sw_')),
    'only this map’s own keys are switched',
    'a shared key would black out every other map that uses it');
}

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
