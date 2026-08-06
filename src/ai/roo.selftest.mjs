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
 *   3. THE RITUAL IS STRICT. He returns only after the pad has been held
 *      for `pad.hold` CONTINUOUS seconds — 2.9 s then stepping off buys
 *      nothing — and holding the pad while he is alive does nothing.
 *
 * Plus the Shivam wiring: the descriptor really carries the config, the pad
 * really sits on standable deck, and his meadow is real ground. None of
 * this is visible in a frame — a roo who leaks through the reef or a pad
 * that can never fire looks exactly like the working thing in a screenshot.
 */

import { Rng } from '../core/rng.js';
import { RooCore, ROO_STATE, HOP } from './roo.js';
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
  pad: { x: 20, z: 20, r: 0.9, hold: 3 },
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
  ok(c.blast(FLAT.pad.x, 0, FLAT.pad.z, 6, 'player') === null && c.alive,
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
console.log(B('\nthe pad ritual'));
{
  const dt = 1 / 60;
  const onPad = { x: FLAT.pad.x, y: 0, z: FLAT.pad.z };
  const offPad = { x: 0, y: 0, z: 0 };

  const c = core();
  for (let i = 0; i < 600; i++) c.update(dt, onPad);
  ok(c.alive && c.padHold === 0, 'holding the pad while he is alive does nothing');

  c.shot('player');
  let r = null;
  for (let i = 0; i < 60 * 120 && !r; i++) r = c.update(dt, offPad);
  ok(r === null && !c.alive, 'he never comes back on his own', '120 s away from the pad');

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
    `${(ticks * dt).toFixed(2)} s on the pad`);
  ok(c.x === FLAT.home.x && c.z === FLAT.home.z, 'at his home meadow, not on the pad');

  // near the pad is not on the pad
  c.shot('player');
  const near = { x: FLAT.pad.x + FLAT.pad.r + 0.3, y: 0, z: FLAT.pad.z };
  r = null;
  for (let i = 0; i < 600 && !r; i++) r = c.update(dt, near);
  ok(r === null, 'standing beside the pad does not count');
}

/* ─────────────────────────────────────────────────────── the shivam wiring ── */
console.log(B('\nthe shivam wiring'));
ok(SHIVAM_MAP.critter === ROO && ROO.kind === 'roo', 'the descriptor carries the critter config');
ok(standableAtShivam(ROO.pad.x, ROO.pad.z), 'the pad is on standable ground');
ok(groundYShivam(ROO.pad.x, ROO.pad.z) === DECK.y, 'on the Icebergs deck', `y=${DECK.y}`);
ok(standableAtShivam(ROO.home.x, ROO.home.z), 'his meadow is real ground');
ok(ROO.bounds.x1 <= DECK.x0 - 2, 'his range stays west of the deck — he cannot camp his own pad',
  `x1=${ROO.bounds.x1}, deck at ${DECK.x0}`);
{
  const b = ROO.bounds;
  const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]];
  ok(corners.every(([x, z]) => Number.isFinite(groundYShivam(x, z))),
    'his whole range has a floor');
  ok(Math.hypot(ROO.pad.x - ROO.home.x, ROO.pad.z - ROO.home.z) > 30,
    'the ritual is a trip, not a lean',
    `${Math.hypot(ROO.pad.x - ROO.home.x, ROO.pad.z - ROO.home.z).toFixed(0)} m from meadow to pad`);
  ok(ROO.pad.hold >= 2 && ROO.pad.hold <= 6, 'the hold is a commitment, not a tap',
    `${ROO.pad.hold} s`);
}

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
