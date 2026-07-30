/**
 * Headless check: a fresh life is a fresh loadout.
 *
 *   node src/weapons/loadout.selftest.mjs
 *
 * Ammunition was the one resource in this game that never came back. Health
 * regenerates, equipment is refilled on `player:spawn` (see throwables.refill),
 * and there are no ammo pickups by design — but magazines and reserves were
 * handed out once, when the weapon system booted, and depleted from there for the
 * rest of the session. A death did not restore them. Neither did leaving a match
 * and starting a new one, which is how a party plays: two matches in, the AX-7's
 * 25-round reserve was gone for good and no mechanic in the game could refill it.
 *
 * `resetLoadout()` is the fix and this pins it. It runs against the real method
 * on a hand-built instance, because a live WeaponSystem wants a GL context, a
 * materials library and a physics world, none of which the contract needs.
 */
import { WEAPON_DEFS, buildRecoilPattern } from './defs.js';
import { WeaponSystem, LOADOUT } from './index.js';
import { Rng } from '../core/rng.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/**
 * The same per-weapon state the constructor builds, on a real prototype so the
 * `reloading` getter and `resetLoadout` are the shipped ones.
 */
function makeSystem() {
  const w = Object.create(WeaponSystem.prototype);
  w.states = new Map();
  w.activeId = LOADOUT[0];
  for (const id of LOADOUT) {
    const def = { ...WEAPON_DEFS[id] };
    def.cycleTime = 60 / def.rpm;
    w.states.set(id, {
      def,
      pattern: buildRecoilPattern(def, Rng),
      mag: def.magSize,
      chambered: true,
      reserve: def.reserve,
      mode: def.modes[0],
      modeIndex: 0,
    });
  }
  w._fireTimer = 0;
  w._burstLeft = 0;
  w._burstCooldown = 0;
  w._spread = 0;
  w._shotIndex = 0;
  w._sinceShot = 10;
  w._reloadPhase = null;
  w._pendingReloadEmpty = false;
  w.viewmodel = {
    clipName: null,
    stopped: 0,
    stopClip() {
      this.stopped++;
      this.clipName = null;
    },
  };
  return w;
}

/** Play out a bad life: fire everything dry, mid-reload, mid-burst. */
function deplete(w) {
  for (const s of w.states.values()) {
    s.mag = 0;
    s.chambered = false;
    s.reserve = 0;
  }
  w._fireTimer = 0.08;
  w._burstLeft = 2;
  w._burstCooldown = 0.2;
  w._spread = 3.4;
  w._shotIndex = 17;
  w._sinceShot = 0;
  w._pendingReloadEmpty = true;
  w.viewmodel.clipName = 'reloadEmpty';
}

console.log('loadout');

// Every def has to carry a reserve worth resetting: with no pickups in the game,
// a def that shipped `reserve: 0` would be a one-magazine weapon for a whole life.
for (const id of LOADOUT) {
  const def = WEAPON_DEFS[id];
  check(
    `${id} carries a finite, non-zero magazine and reserve`,
    def.magSize > 0 && def.reserve > 0 && Number.isFinite(def.reserve),
    `magSize ${def.magSize}, reserve ${def.reserve}`
  );
}

{
  const w = makeSystem();
  deplete(w);
  w.resetLoadout();

  let restocked = true;
  let detail = '';
  for (const [id, s] of w.states) {
    if (s.mag === s.def.magSize && s.chambered && s.reserve === s.def.reserve) continue;
    restocked = false;
    detail = `${id}: ${s.mag}/${s.def.magSize} + ${s.reserve}/${s.def.reserve}`;
  }
  check('a spawn restocks every weapon in the loadout, not just the one in hand', restocked, detail);
  check('including a round in the chamber', [...w.states.values()].every((s) => s.chambered));

  check('the fire timer is clear, so the first shot of a life is not swallowed', w._fireTimer === 0);
  check('a burst interrupted by death does not resume', w._burstLeft === 0 && w._burstCooldown === 0);
  check('the recoil pattern starts at the top', w._shotIndex === 0);
  check('the spread cone starts at rest', w._spread === 0);
  check('and the crosshair is not left mid-bloom', w._sinceShot > 0.6);
  check(
    'a reload that was in flight is dropped, not landed on the fresh magazine',
    w.viewmodel.stopped === 1 && w._pendingReloadEmpty === false
  );
}

{
  // The regression this was written for: a second match must not inherit the
  // first one's ammunition. Two lives of firing, then the new match's spawn.
  const w = makeSystem();
  const sniper = w.states.get('sniper');
  const before = sniper.reserve;
  sniper.reserve -= 10;
  w.resetLoadout(); // died once
  sniper.reserve -= 10;
  w.resetLoadout(); // and again, in the next match
  check(
    'depletion does not accumulate across lives or matches',
    sniper.reserve === before,
    `${sniper.reserve} vs ${before}`
  );
}

{
  // Not reloading: nothing to stop, and the draw/idle clip must be left alone.
  const w = makeSystem();
  w.viewmodel.clipName = 'draw';
  w.resetLoadout();
  check('a spawn during any other animation leaves the clip running', w.viewmodel.stopped === 0);
  check('and the draw is still playing', w.viewmodel.clipName === 'draw');
}

console.log(failures ? `\n${failures} failure(s)` : '\nloadout ok');
process.exit(failures ? 1 : 0);
