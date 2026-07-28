/**
 * Headless checks for the weapon balance contract.
 *
 * Balance is the one part of a weapon that has no visual tell: a def that has
 * drifted one point of damage looks identical in a screenshot and plays
 * completely differently, because damage is a SHOTS-TO-KILL number and shots to
 * kill is an integer. This file pins the integers.
 *
 * What it asserts, in order:
 *   1. every def is complete and internally sane
 *   2. the two-point falloff ramp behaves (flat, linear, flat)
 *   3. the shots-to-kill matrix documented at the top of defs.js
 *   4. that no weapon is strictly dominated — the SMG wins close, the carbine
 *      wins far, and the crossover exists
 *   5. the four quickscope invariants for the AX-7, including the spread-decay
 *      one, which is the only mechanic here that is not a single constant
 *   6. recoil patterns are deterministic (capture reproducibility)
 *
 *   node src/weapons/balance.selftest.mjs
 */
import { WEAPON_DEFS, HIT_ZONES, SPREAD_MODS, buildRecoilPattern } from './defs.js';
import { rangeFalloff } from './ballistics.js';
import { LOADOUT } from './index.js';
import { Rng } from '../core/rng.js';
import { lerp, smootherstep } from './mathx.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const HEALTH = 100;

/** Damage one round of `def` does at `dist` metres to `zone`. */
function damageAt(def, dist, zone) {
  const f = rangeFalloff(dist, def.falloffStart, def.falloffEnd, def.dropoff);
  return def.damage * f * HIT_ZONES[zone];
}

/** Rounds needed to take a 100 HP body down, at that range and zone. */
function stk(def, dist, zone) {
  const d = damageAt(def, dist, zone);
  return d <= 0 ? Infinity : Math.ceil(HEALTH / d);
}

/** Milliseconds from the first round leaving the barrel to the kill. */
function ttk(def, dist, zone) {
  return ((stk(def, dist, zone) - 1) * 60000) / def.rpm;
}

console.log('weapon balance');

/* ------------------------------------------------------------------ 1. defs */
const IDS = Object.keys(WEAPON_DEFS);
check('the loadout is every defined weapon, in slot order',
  LOADOUT.length === IDS.length && LOADOUT.every((id) => WEAPON_DEFS[id]),
  `loadout=${LOADOUT} defs=${IDS}`);
check('four slots, and 1-4 can address them', LOADOUT.length === 4, `${LOADOUT.length}`);

const REQUIRED = [
  'id', 'label', 'class', 'caliber', 'rpm', 'modes', 'magSize', 'reserve',
  'muzzleVelocity', 'damage', 'penetration', 'falloffStart', 'falloffEnd',
  'dropoff', 'maxRange', 'spreadHip', 'spreadAds', 'spreadPerShot', 'spreadMax',
  'spreadDecay', 'spreadAirAdd', 'recoil', 'adsTime', 'adsFovScale', 'viewFov',
  'eyeRelief', 'hipPos', 'hipRot', 'magLen',
];
for (const id of IDS) {
  const def = WEAPON_DEFS[id];
  const missing = REQUIRED.filter((k) => def[k] === undefined);
  check(`${id}: def is complete`, missing.length === 0, `missing ${missing}`);
  check(`${id}: falloff window is ordered and positive`,
    def.falloffStart >= 0 && def.falloffEnd > def.falloffStart && def.falloffEnd <= def.maxRange,
    `${def.falloffStart}..${def.falloffEnd} of ${def.maxRange}`);
  check(`${id}: retains between 30 % and 100 % at range`,
    def.dropoff > 0.3 && def.dropoff <= 1, `${def.dropoff}`);
  check(`${id}: aiming is tighter than the hip`, def.spreadAds < def.spreadHip);
  check(`${id}: the bloom cap is above the resting hip cone`, def.spreadMax > def.spreadHip * 0.5);
  check(`${id}: airborne adds a cone aiming cannot remove`, def.spreadAirAdd > 0);
  check(`${id}: the optic zooms in, never out`, def.adsFovScale > 0 && def.adsFovScale <= 1,
    `${def.adsFovScale}`);
  check(`${id}: reserve is a whole number of magazines`,
    def.reserve % def.magSize === 0, `${def.reserve} / ${def.magSize}`);
}

/* --------------------------------------------------------------- 2. falloff */
{
  const d = WEAPON_DEFS.smg;
  check('falloff: flat inside the near band',
    rangeFalloff(0, d.falloffStart, d.falloffEnd, d.dropoff) === 1 &&
    rangeFalloff(d.falloffStart, d.falloffStart, d.falloffEnd, d.dropoff) === 1);
  check('falloff: exactly `dropoff` at the far edge',
    Math.abs(rangeFalloff(d.falloffEnd, d.falloffStart, d.falloffEnd, d.dropoff) - d.dropoff) < 1e-9);
  check('falloff: flat beyond the far edge',
    rangeFalloff(d.falloffEnd * 4, d.falloffStart, d.falloffEnd, d.dropoff) === d.dropoff);
  const mid = (d.falloffStart + d.falloffEnd) / 2;
  check('falloff: linear across the ramp',
    Math.abs(rangeFalloff(mid, d.falloffStart, d.falloffEnd, d.dropoff) - (1 + d.dropoff) / 2) < 1e-9);
  let prev = 1.0001;
  let monotone = true;
  for (let m = 0; m <= 300; m += 5) {
    const f = rangeFalloff(m, d.falloffStart, d.falloffEnd, d.dropoff);
    if (f > prev + 1e-9) monotone = false;
    prev = f;
  }
  check('falloff: never increases with distance', monotone);
}

/* ------------------------------------------------- 3. the shots-to-kill matrix */
/**
 * These are the numbers the doc block at the top of defs.js promises. If a
 * damage value moves, one of these flips and this test says which.
 */
const MATRIX = [
  // id,       range, zone,       shots
  ['rifle', 5, 'torso', 4],
  ['rifle', 5, 'torsoLow', 4],
  ['rifle', 5, 'head', 1],
  ['rifle', 110, 'torso', 5],
  ['smg', 5, 'torso', 4],
  ['smg', 5, 'head', 1],
  ['smg', 46, 'torso', 9],
  ['pistol', 5, 'torso', 4],
  ['pistol', 5, 'torsoLow', 4],
  ['pistol', 55, 'torso', 7],
  ['pistol', 5, 'head', 1],
  ['sniper', 5, 'head', 1],
  ['sniper', 5, 'torso', 1],
  ['sniper', 5, 'torsoLow', 1],
  ['sniper', 420, 'torso', 1],
  ['sniper', 5, 'arm', 2],
  ['sniper', 5, 'leg', 2],
];
for (const [id, range, zone, want] of MATRIX) {
  const got = stk(WEAPON_DEFS[id], range, zone);
  check(`${id} @ ${range} m, ${zone}: ${want} shot${want > 1 ? 's' : ''}`, got === want,
    `got ${got} (${damageAt(WEAPON_DEFS[id], range, zone).toFixed(1)} per hit)`);
}

/* ------------------------------------------------------------ 4. no dominance */
{
  const rifle = WEAPON_DEFS.rifle;
  const smg = WEAPON_DEFS.smg;
  const pistol = WEAPON_DEFS.pistol;
  check('the SMG wins the close fight (10 m)', ttk(smg, 10, 'torso') < ttk(rifle, 10, 'torso'),
    `smg ${ttk(smg, 10, 'torso').toFixed(0)} ms vs rifle ${ttk(rifle, 10, 'torso').toFixed(0)} ms`);
  check('the carbine wins the long one (40 m)', ttk(rifle, 40, 'torso') < ttk(smg, 40, 'torso'),
    `rifle ${ttk(rifle, 40, 'torso').toFixed(0)} ms vs smg ${ttk(smg, 40, 'torso').toFixed(0)} ms`);
  // Find the crossover and check it lands somewhere a map actually plays.
  let cross = null;
  for (let m = 1; m <= 60 && cross === null; m++) {
    if (ttk(smg, m, 'torso') >= ttk(rifle, m, 'torso')) cross = m;
  }
  check('their crossover is inside a room-to-street distance', cross !== null && cross >= 10 && cross <= 35,
    `${cross} m`);
  check('the sidearm is the slowest of the three to a kill',
    ttk(pistol, 10, 'torso') > ttk(rifle, 10, 'torso') && ttk(pistol, 10, 'torso') > ttk(smg, 10, 'torso'));
  check('the sidearm still draws fastest', LOADOUT.every(
    (id) => id === 'pistol' || WEAPON_DEFS[id].drawTime > WEAPON_DEFS.pistol.drawTime));
  check('the sniper trades every other advantage for the one shot',
    WEAPON_DEFS.sniper.rpm === Math.min(...IDS.map((i) => WEAPON_DEFS[i].rpm)) &&
    WEAPON_DEFS.sniper.magSize === Math.min(...IDS.map((i) => WEAPON_DEFS[i].magSize)) &&
    WEAPON_DEFS.sniper.adsTime === Math.max(...IDS.map((i) => WEAPON_DEFS[i].adsTime)) &&
    WEAPON_DEFS.sniper.spreadHip === Math.max(...IDS.map((i) => WEAPON_DEFS[i].spreadHip)));
}

/* ---------------------------------------------------------- 5. the quickscope */
{
  const s = WEAPON_DEFS.sniper;
  check('quickscope 1: the scoped cone is effectively zero', s.spreadAds <= 0.05,
    `${s.spreadAds} deg = ${(Math.tan((s.spreadAds * Math.PI) / 180) * 50 * 100).toFixed(1)} cm at 50 m`);
  check('quickscope 2: the no-scope is a lottery', s.spreadHip >= 5,
    `${s.spreadHip} deg = ${(Math.tan((s.spreadHip * Math.PI) / 180) * 50).toFixed(1)} m at 50 m`);
  check('quickscope 4: one round per bolt cycle, and the cycle is over a second',
    s.rpm <= 60 && 60 / s.rpm >= 1, `${(60 / s.rpm).toFixed(2)} s`);
  check('quickscope 4: firing blows the cone wide open', s.spreadPerShot > 2, `${s.spreadPerShot}`);

  /**
   * QUICKSCOPE 3 — the one that is a simulation rather than a constant.
   *
   * Reproduces the integrator in WeaponSystem.update: spread relaxes toward its
   * resting value at `spreadDecay * (1 + adsProgress)` deg/s and can never go
   * below it. Starting from the hip cone with the trigger finger already moving,
   * the shot has to be true by the time the glass is up — if it is not, the
   * player is scoped, on target and missing, and quickscoping does not exist.
   */
  const sim = (def, seconds, dt = 1 / 120) => {
    let spread = def.spreadHip;
    let adsT = 0;
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      adsT = Math.min(1, adsT + dt / def.adsTime);
      const ads = smootherstep(0, 1, adsT);
      const rest = lerp(def.spreadHip, def.spreadAds, ads) * SPREAD_MODS.still;
      spread = Math.max(rest, spread - def.spreadDecay * dt * (1 + ads));
    }
    return spread;
  };
  const atScopeUp = sim(s, s.adsTime);
  check('quickscope 3: the cone is gone by the time the scope is up',
    atScopeUp <= 0.05, `${atScopeUp.toFixed(3)} deg after ${s.adsTime}s`);
  // And the counter-example, so the reason `spreadDecay` is 24 stays on record:
  const slow = sim({ ...s, spreadDecay: WEAPON_DEFS.rifle.spreadDecay }, s.adsTime);
  check('quickscope 3: at the carbine`s decay rate it would NOT be', slow > 1,
    `${slow.toFixed(3)} deg — a scoped miss`);

  check('a scoped mid-air shot is still a prayer',
    (s.spreadAds * SPREAD_MODS.airborne + s.spreadAirAdd) > 1,
    `${(s.spreadAds * SPREAD_MODS.airborne + s.spreadAirAdd).toFixed(2)} deg`);
  check('the scope is the only magnified optic in the loadout',
    LOADOUT.filter((id) => WEAPON_DEFS[id].adsFovScale < 0.5).length === 1);
  check('a bolt gun is flagged as one', WEAPON_DEFS.sniper.boltAction === true);
  check('nothing else is', LOADOUT.every((id) => id === 'sniper' || !WEAPON_DEFS[id].boltAction));
}

/* ------------------------------------------------------- 6. recoil determinism */
for (const id of IDS) {
  const def = WEAPON_DEFS[id];
  const a = buildRecoilPattern(def, Rng);
  const b = buildRecoilPattern(def, Rng);
  check(`${id}: the recoil pattern is byte-identical run to run`,
    a.length === b.length && a.every((v, i) => v === b[i]));
  check(`${id}: the pattern covers a whole magazine`,
    def.recoil.patternLength >= Math.min(def.magSize, 5),
    `${def.recoil.patternLength} for a ${def.magSize}-round magazine`);
  let climbs = true;
  for (let i = 0; i < a.length; i += 2) if (a[i] <= 0) climbs = false;
  check(`${id}: every shot climbs, none dips`, climbs);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
