#!/usr/bin/env node
/**
 * AI — the roo's contract, checked headlessly.
 *
 *   node src/ai/roo.selftest.mjs
 *
 * `RooCore` is pure — LEVEL space, injected rng/ground/walkability — so the
 * three promises the feature makes are all provable without an engine:
 *
 *   1. HARMLESS. Bot fire never detonates him; a player's hit does, exactly
 *      once, at his own position, with the configured charge.
 *   2. HE STAYS ON THE MAP. Hours of simulated hopping never leave his
 *      bounds, never land on closed ground, never cross a ledge taller than
 *      a hop, and every landing is ON the floor.
 *   3. THE RITUAL IS STRICT. He returns only after one well has been held
 *      for that pad's `hold` CONTINUOUS seconds — 2.9 s then stepping off
 *      buys nothing — and holding a well while he is alive does nothing.
 *      ANY well works, and near a well is not in it.
 *
 * Plus the Shivam wiring: the descriptor really carries the config, every
 * energy well really sits on standable ground outside his bounds, and his
 * meadow is real ground. None of this is visible in a frame — a roo who
 * leaks through the reef or a well that can never fire looks exactly like
 * the working thing in a screenshot.
 */

import { Rng } from '../core/rng.js';
import { RooCore, ROO_STATE, HOP, VOICE } from './roo.js';
import {
  SHIVAM_MAP,
  ROO,
  DECK,
  standableAtShivam,
  groundYShivam,
  isOpenShivam,
} from '../world/shivam.js';

let pass = 0;
let fail = 0;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
function ok(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mok\x1b[0m    ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

/** A fresh core on a flat 100 x 100 field unless told otherwise. */
const FLAT = {
  kind: 'roo',
  home: { x: 0, z: 0 },
  bounds: { x0: -50, z0: -50, x1: 50, z1: 50 },
  pads: [
    { x: 20, z: 20, r: 0.9, hold: 3 },
    { x: -20, z: -20, r: 0.9, hold: 3 },
  ],
  explosion: { radius: 6, damage: 95 },
};
function core(cfg = FLAT, opts = {}) {
  return new RooCore(cfg, {
    rng: new Rng(opts.seed ?? 0x900b1e5).fork(),
    groundY: opts.groundY ?? (() => 0),
    isOpen: opts.isOpen ?? (() => true),
  });
}

/* ────────────────────────────────────────────────────────────── harmless ── */
console.log(B('\nharmless until a player shoots him'));
{
  const c = core();
  ok(c.shot('ai') === null && c.alive, 'a bot round does not set him off');
  ok(c.shot(null) === null && c.alive, 'nor does a sourceless legacy payload');
  const boom = c.shot('player');
  ok(!!boom && !c.alive, 'a player round does', boom ? `r=${boom.radius} dmg=${boom.damage}` : '');
  ok(boom.radius === FLAT.explosion.radius && boom.damage === FLAT.explosion.damage,
    'with the configured charge');
  ok(Math.abs(boom.y - 0.7) < 1e-9, 'centred in the body, not the sand', `y=${boom.y}`);
  ok(c.shot('player') === null, 'and exactly once — the second round finds nobody');
}
{
  const c = core();
  ok(c.blast(2, 0.7, 0, 6, 'ai') === null && c.alive, "a bot grenade near him is a near miss");
  ok(c.blast(2, 0.7, 0, 6, 'roo') === null && c.alive, 'his own blast cannot chain to himself');
  ok(!!c.blast(2, 0.7, 0, 6, 'player') && !c.alive, "the player's grenade counts as shooting him");
}
{
  const c = core();
  ok(c.blast(FLAT.pads[0].x, 0, FLAT.pads[0].z, 6, 'player') === null && c.alive,
    'a blast out of radius leaves him grazing');
}

/* ─────────────────────────────────────────────────────── he stays on map ── */
console.log(B('\nhe stays on the map'));
{
  // Shivam's own ground: terraces, the sea wall's blockers, the reef line.
  const c = core(ROO, {
    groundY: groundYShivam,
    isOpen: isOpenShivam,
    seed: 0xf00d,
  });
  let out = 0;
  let closed = 0;
  let bigStep = 0;
  let floating = 0;
  let hops = 0;
  let lastLand = { x: c.x, z: c.z };
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 60 * 30; i++) { // 30 simulated minutes
    const wasHop = c.state === ROO_STATE.HOP;
    c.update(dt, null);
    const b = ROO.bounds;
    if (c.x < b.x0 - 0.01 || c.x > b.x1 + 0.01 || c.z < b.z0 - 0.01 || c.z > b.z1 + 0.01) out++;
    if (c.y < groundYShivam(c.x, c.z) - 0.01) floating++;
    if (wasHop && c.state !== ROO_STATE.HOP) {
      hops++;
      if (!isOpenShivam(c.x, c.z, 0.4)) closed++;
      if (Math.abs(groundYShivam(c.x, c.z) - groundYShivam(lastLand.x, lastLand.z)) >
        HOP.maxStep * (1 + ((c.x - lastLand.x) ** 2 + (c.z - lastLand.z) ** 2) / (HOP.length ** 2)))
        bigStep++;
      if (Math.abs(c.y - groundYShivam(c.x, c.z)) > 0.01) floating++;
      lastLand = { x: c.x, z: c.z };
    }
  }
  ok(hops > 200, 'he actually roams', `${hops} bounds landed in 30 min`);
  ok(out === 0, 'never a step outside his bounds', out ? `${out} frames out` : '');
  ok(closed === 0, 'never lands on closed ground', closed ? `${closed} landings` : '');
  ok(floating === 0, 'never below the floor, and every landing is ON it',
    floating ? `${floating} frames` : '');
  ok(bigStep === 0, 'never crosses a ledge taller than a hop', bigStep ? `${bigStep}` : '');
}

/* ──────────────────────────────────────────────────────────── the ritual ── */
console.log(B('\nthe well ritual'));
{
  const dt = 1 / 60;
  const onPad = { x: FLAT.pads[0].x, y: 0, z: FLAT.pads[0].z };
  const offPad = { x: 0, y: 0, z: 0 };

  const c = core();
  for (let i = 0; i < 600; i++) c.update(dt, onPad);
  ok(c.alive && c.padHold === 0, 'holding a well while he is alive does nothing');

  c.shot('player');
  let r = null;
  for (let i = 0; i < 60 * 120 && !r; i++) r = c.update(dt, offPad);
  ok(r === null && !c.alive, 'he never comes back on his own', '120 s away from every well');

  // 2.9 s on, step off, 2.9 s on again: a running total would fire, the
  // contract must not
  for (let i = 0; i < Math.floor(2.9 / dt); i++) r = c.update(dt, onPad);
  ok(r === null && c.padHold > 2.5, 'almost-held is still held', `${c.padHold.toFixed(2)} s`);
  c.update(dt, offPad);
  ok(c.padHold === 0, 'stepping off resets the ritual');
  for (let i = 0; i < Math.floor(2.9 / dt) && !r; i++) r = c.update(dt, onPad);
  ok(r === null && !c.alive, 'two broken 2.9 s stands do not add up to one 3 s stand');

  // and one continuous hold fires it
  let ticks = 0;
  r = null;
  while (!r && ticks++ < 60 * 10) r = c.update(dt, onPad);
  ok(r === 'respawned' && c.alive, 'one continuous hold brings him back',
    `${(ticks * dt).toFixed(2)} s in the well`);
  ok(c.x === FLAT.home.x && c.z === FLAT.home.z, 'at his home meadow, not at the well');

  // any well works, not just the first
  c.shot('player');
  const onPad2 = { x: FLAT.pads[1].x, y: 0, z: FLAT.pads[1].z };
  ticks = 0;
  r = null;
  while (!r && ticks++ < 60 * 10) r = c.update(dt, onPad2);
  ok(r === 'respawned' && c.alive, 'the second well brings him back too',
    `${(ticks * dt).toFixed(2)} s in the well`);

  // near a well is not in a well
  c.shot('player');
  const near = { x: FLAT.pads[0].x + FLAT.pads[0].r + 0.3, y: 0, z: FLAT.pads[0].z };
  r = null;
  for (let i = 0; i < 600 && !r; i++) r = c.update(dt, near);
  ok(r === null, 'standing beside a well does not count');
}

/* ──────────────────────────────────────────────────────────── idle chatter ── */
/**
 * The chatter is a radius AND a clock, and every one of these failures is
 * inaudible in the way that matters: too-frequent reads as a bug only after
 * the fourth line, and never-again reads as "no audio assets".
 */
console.log(B('\nidle chatter'));
{
  const dt = 1 / 60;
  const at = (x, y = 0, z = 0) => ({ x, y, z });
  const runFor = (c, secs, p) => {
    let n = 0;
    for (let i = 0; i < Math.round(secs / dt); i++) if (c.speak(dt, p)) n++;
    return n;
  };

  {
    const c = core();
    ok(runFor(c, 3, at(1)) === 0, 'silent for the first seconds, even nose to nose');
    ok(runFor(c, 12, at(1)) >= 1, 'he does say something to a player who stays');
  }
  {
    const c = core();
    const n = runFor(c, 120, at(1));
    ok(n >= 5 && n <= 12, 'two minutes of loitering is a handful of lines, not a stream',
      `${n} lines in 120 s`);
  }
  {
    // Every gap the rng hands out has to sit inside the authored range: a
    // single short one is a double-take that talks over itself.
    const c = core();
    const gaps = [];
    let since = 0;
    for (let i = 0; i < 60 * 600; i++) {
      since += dt;
      if (c.speak(dt, at(1))) { gaps.push(since); since = 0; }
    }
    ok(gaps.length > 20, 'enough lines to judge the spacing', `${gaps.length}`);
    ok(gaps.slice(1).every((g) => g >= VOICE.gap[0] - 0.05 && g <= VOICE.gap[1] + 0.05),
      'every gap is inside VOICE.gap',
      `min ${Math.min(...gaps.slice(1)).toFixed(1)}s, max ${Math.max(...gaps.slice(1)).toFixed(1)}s`);
  }
  ok(runFor(core(), 300, at(VOICE.radius + 3)) === 0, 'a player out of earshot hears nothing');
  ok(runFor(core(), 300, at(1, VOICE.height + 2)) === 0,
    'a player on the terrace above him is not in earshot either');
  ok(runFor(core(), 300, null) === 0, 'no player, no chatter');
  {
    // Walking away and coming back must not buy a line: the clock runs
    // regardless of where the player is, so proximity cannot be pumped.
    const c = core();
    runFor(c, 30, at(1));           // get him talking and reset the clock
    let pumped = 0;
    for (let i = 0; i < 40; i++) {
      pumped += runFor(c, 0.5, at(1));
      runFor(c, 0.5, at(60));
    }
    ok(pumped <= 2, 'stepping in and out does not pump lines out of him', `${pumped} in 40 s`);
  }
  {
    const c = core();
    c.shot('player');
    ok(runFor(c, 300, at(1)) === 0, 'a dead roo is silent');
    // ... and the resurrection does not blurt one in the frame he lands.
    let spoke = false;
    for (let i = 0; i < 60 * 10; i++) {
      const p = at(FLAT.pads[0].x, 0, FLAT.pads[0].z);
      if (c.speak(dt, p)) spoke = true;
      c.update(dt, p);
      if (c.alive) break;
    }
    ok(c.alive && !spoke, 'and he does not greet the player the instant the pad brings him back');
  }
}

/* ─────────────────────────────────────────────────────── the shivam wiring ── */
console.log(B('\nthe shivam wiring'));
ok(SHIVAM_MAP.critter === ROO && ROO.kind === 'roo', 'the descriptor carries the critter config');
ok(ROO.pads.length === 3, 'three energy wells around the map', `${ROO.pads.length}`);
ok(ROO.pads.every((p) => standableAtShivam(p.x, p.z)), 'every well is on standable ground');
ok(groundYShivam(ROO.pads[0].x, ROO.pads[0].z) === DECK.y,
  'the original well is on the Icebergs deck', `y=${DECK.y}`);
ok(standableAtShivam(ROO.home.x, ROO.home.z), 'his meadow is real ground');
ok(ROO.bounds.x1 <= DECK.x0 - 2, 'his range stays west of the deck — he cannot camp his own pad',
  `x1=${ROO.bounds.x1}, deck at ${DECK.x0}`);
ok(ROO.pads.every((p) => {
  const b = ROO.bounds;
  return p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1;
}), 'every well sits outside his bounds — he can never camp one');
{
  const b = ROO.bounds;
  const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]];
  ok(corners.every(([x, z]) => Number.isFinite(groundYShivam(x, z))),
    'his whole range has a floor');
  const trips = ROO.pads.map((p) => Math.hypot(p.x - ROO.home.x, p.z - ROO.home.z));
  ok(trips.every((d) => d > 20), 'each ritual is a trip, not a lean',
    trips.map((d) => `${d.toFixed(0)} m`).join(', '));
  ok(ROO.pads.every((p) => p.hold >= 2 && p.hold <= 6), 'the hold is a commitment, not a tap',
    `${ROO.pads.map((p) => p.hold).join('/')} s`);
  // the wells are spread out: the reset-on-step-off contract leans on a
  // player never being inside two at once, and a well pair in one corner
  // would make the "any well" choice cosmetic
  for (let i = 0; i < ROO.pads.length; i++) {
    for (let j = i + 1; j < ROO.pads.length; j++) {
      const d = Math.hypot(ROO.pads[i].x - ROO.pads[j].x, ROO.pads[i].z - ROO.pads[j].z);
      ok(d > 25, `wells ${i} and ${j} are far apart`, `${d.toFixed(0)} m`);
    }
  }
}

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
