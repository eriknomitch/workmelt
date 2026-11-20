#!/usr/bin/env node
/**
 * WORLD — headless checks for the slot machines.
 *
 *   node src/world/slots.selftest.mjs
 *
 * The slot bank's whole design is a balance — what a pull costs, how often it
 * pays, how long a jackpot protects you, and that a jackpot cannot be chained
 * — and every one of those is a rate or a timing. A capture sees a red
 * cabinet. None of the failures throws: a jackpot table off by a factor of ten
 * just makes a map where one player is unkillable half the match, and every
 * other check stays green. So the odds and the clock live in `slots.js` with
 * no engine in them, and this states them.
 */

import { SlotBank, SLOT_DEFAULTS, SYMBOLS, SEVEN, drawPull, judge } from './slots.js';
import { Rng } from '../core/rng.js';
import { CLIFTON_MAP, SLOT_MACHINES, ARCADE_ROWS, SLOT_ROW } from './clifton.js';
import { HEALTH } from '../player/tuning.js';

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

const C = SLOT_DEFAULTS;
const rand = (seed) => {
  const r = new Rng(seed);
  return () => r.float();
};

/* ------------------------------------------------------------------------- */
console.log(B('\nthe table'));
{
  const N = 200000;
  const r = rand(1234);
  const n = { jackpot: 0, payout: 0, lose: 0 };
  let tease = 0;
  let mismatch = 0;
  for (let i = 0; i < N; i++) {
    const d = drawPull(r);
    n[d.outcome]++;
    if (judge(d.reels) !== d.outcome) mismatch++;
    if (d.outcome === 'lose' && d.reels[0] === SEVEN && d.reels[1] === SEVEN) tease++;
  }
  ok(mismatch === 0, 'the reels shown always read as the outcome paid', `${mismatch} disagree`);
  const pj = n.jackpot / N;
  const pp = n.payout / N;
  ok(Math.abs(pj - C.pJackpot) < 0.004, 'jackpot rate matches the table', `${(pj * 100).toFixed(2)}% vs ${(C.pJackpot * 100).toFixed(2)}%`);
  ok(Math.abs(pp - C.pPayout) < 0.005, 'payout rate matches the table', `${(pp * 100).toFixed(2)}% vs ${(C.pPayout * 100).toFixed(2)}%`);
  ok(pj >= 1 / 16 && pj <= 1 / 8, 'a jackpot is rare but reachable — 1 in 8 to 1 in 16 pulls');
  ok(C.pJackpot + C.pPayout <= 0.3, 'most pulls lose', `${((1 - C.pJackpot - C.pPayout) * 100).toFixed(0)}% lose`);
  const t = tease / n.lose;
  ok(t > 0.2 && t < 0.45, 'some losses show the 7 7 _ near miss', `${(t * 100).toFixed(0)}% of losses`);

  const a = rand(99);
  const b = rand(99);
  let same = true;
  for (let i = 0; i < 500; i++) if (JSON.stringify(drawPull(a)) !== JSON.stringify(drawPull(b))) same = false;
  ok(same, 'deterministic for a given seed');

  // the extremes of a uniform source still produce valid symbols
  for (const v of [0, 0.999999999]) {
    const d = drawPull(() => v);
    ok(d.reels.every((s) => s >= 0 && s < SYMBOLS.length), `rand() = ${v} draws valid symbols`, d.reels.join(','));
  }
}

/* ------------------------------------------------------------------------- */
console.log(B('\nthe price'));
{
  ok(C.cost > 0 && C.cost <= 25, 'a pull costs a real but survivable bite of health', `${C.cost} HP`);
  const pulls = Math.ceil(HEALTH.max / C.cost) - 1;
  ok(pulls >= 3 && pulls <= 5, 'a full bar buys a handful of pulls', `${pulls}`);

  const bank = new SlotBank({ machines: [{ x: 0, z: 0, fx: 0, fz: 1 }] });
  ok(bank.refusal(C.cost) === 'health', 'a pull that would take the last point is refused');
  ok(bank.refusal(C.cost + 0.5) === null, 'anything above the cost is enough');

  // Expected session: pull from full until refused, wait out regen, repeat.
  // How long, in expectation, does a dedicated gambler stand at the bank per jackpot?
  const spin = C.spinTime;
  const refill = HEALTH.regenDelay + (HEALTH.max - (HEALTH.max - pulls * C.cost)) / HEALTH.regenRate;
  const cycle = pulls * spin + refill;
  // a payout heals to full, which only shortens this — so this is the upper bound
  const perJackpot = cycle / (pulls * C.pJackpot);
  ok(perJackpot > 20 && perJackpot < 90, 'a jackpot costs tens of seconds standing wounded at the bank',
    `≤ ${perJackpot.toFixed(0)} s`);
  ok(C.invuln >= 4 && C.invuln <= 8, 'invincibility is a window, not a life', `${C.invuln} s`);
  ok(C.invuln < perJackpot / 3, 'and short against what it costs to win it');
}

/* ------------------------------------------------------------------------- */
console.log(B('\nthe clock'));
{
  const bank = new SlotBank({ machines: [{ x: 0, z: 0, fx: 0, fz: 1 }] });
  const m = bank.machines[0];
  const s = bank.pull(m, 100, () => 0); // rand 0 -> jackpot
  ok(s && s.outcome === 'jackpot', 'pull takes the spin');
  ok(bank.pull(m, 100, () => 0) === null && bank.refusal(100) === 'spinning', 'a second pull mid-spin is refused');
  const evs = [];
  for (let t = 0; t < C.spinTime + 0.5; t += 1 / 60) {
    const e = bank.update(1 / 60);
    if (e) evs.push(e);
  }
  ok(evs.length === 3, 'three reels stop: two ticks and a result', evs.map((e) => e.type).join(' '));
  ok(evs[2]?.type === 'result' && evs[2].outcome === 'jackpot', 'the result is the last thing a spin reports');
  ok(bank.spin === null, 'and the machine is free again');

  ok(bank.refusal(100) === 'lockout', 'after a jackpot the bank refuses this player');
  ok(C.lockout > C.invuln * 2, 'for well past the invincible window — jackpots cannot chain',
    `${C.lockout} s vs ${C.invuln} s`);
  for (let t = 0; t < C.lockout - 0.5; t += 0.5) bank.update(0.5);
  ok(bank.refusal(100) === 'lockout', 'still locked half a second short');
  bank.update(1);
  ok(bank.refusal(100) === null, 'and open once the lockout runs out');

  // a long frame: one event per call, the result still arrives last
  bank.pull(m, 100, () => 0.5);
  const big = [];
  for (let i = 0; i < 4; i++) big.push(bank.update(5)?.type ?? '-');
  ok(big.join(' ') === 'reel reel result -', 'a hitch catches up one reel per call', big.join(' '));

  // a payout or a loss leaves no lockout
  bank.pull(m, 100, () => C.pJackpot + 0.01);
  for (let i = 0; i < 4; i++) bank.update(1);
  ok(bank.refusal(100) === null, 'only a jackpot locks the bank');

  bank.pull(m, 100, () => 0);
  bank.cancel();
  ok(bank.spin === null && bank.refusal(100) === null, 'a death cancels the spin unpaid');
  bank.lockout = 10;
  bank.reset();
  ok(bank.refusal(100) === null, 'a new match clears the lockout');
}

/* ------------------------------------------------------------------------- */
console.log(B('\nusing a machine'));
{
  const bank = new SlotBank({ machines: [{ x: 0, z: 0, fx: 0, fz: 1 }, { x: 0.82, z: 0, fx: 0, fz: 1 }] });
  ok(bank.machineAt(0.05, 0, 0.5, 0, -1)?.id === 0, 'in front of it, facing it: in use');
  ok(bank.machineAt(0.75, 0, 0.5, 0, -1)?.id === 1, 'the nearest machine wins');
  ok(bank.machineAt(0, 0, 0.5, 0, 1) === null, 'back to the bank: no prompt');
  ok(bank.machineAt(0, 0, 0.5, 1, 0) === null, 'looking down the aisle: no prompt');
  ok(bank.machineAt(0, 0, -0.8, 0, 1) === null, 'behind the row: no prompt');
  ok(bank.machineAt(0, 0, 0.5 + C.reach, 0, -1) === null, 'out of reach: no prompt');
  ok(bank.machineAt(0.05, 0.6, 0.5, 0, -1)?.id === 0, 'a step or a crouch still counts');
  ok(bank.machineAt(0.05, 8, 0.5, 0, -1) === null, 'on the roof above it: no prompt');
}

/* ------------------------------------------------------------------------- */
console.log(B('\nclifton hill'));
{
  ok(CLIFTON_MAP.slots?.machines === SLOT_MACHINES, 'the map declares its slot bank');
  const [x0, x1, z, f] = ARCADE_ROWS[SLOT_ROW];
  ok(SLOT_MACHINES.length >= 4, 'a bank, not a single machine', `${SLOT_MACHINES.length}`);
  ok(SLOT_MACHINES.every((m) => m.x > x0 && m.x < x1), 'every machine stands in its row');
  ok(SLOT_MACHINES.every((m) => Math.abs(m.y - CLIFTON_MAP.groundY(m.x, m.z)) < 0.05),
    'every machine knows the height of the floor it stands on');
  ok(SLOT_MACHINES.every((m) => Math.sign(m.z - z) === Math.sign(f) && m.fz === f),
    'every use point is on the aisle side the reels face');
  // A player must be able to stand inside reach of every machine: clear of the
  // row's collision by a body's width, and still within `reach` of the front.
  const R = 0.35; // a body, with a little slack over the capsule
  const reachable = SLOT_MACHINES.every((m) => {
    for (let d = 0; d <= C.reach - 0.05; d += 0.05) {
      if (CLIFTON_MAP.standable(m.x, m.z + f * d, R)) return true;
    }
    return false;
  });
  ok(reachable, 'every machine can be reached from standable floor');
}

console.log(
  fail === 0
    ? `\n\x1b[32m${pass}/${pass + fail} checks passed\x1b[0m\n`
    : `\n\x1b[31m${fail} of ${pass + fail} checks FAILED\x1b[0m\n`
);
process.exit(fail === 0 ? 0 : 1);
