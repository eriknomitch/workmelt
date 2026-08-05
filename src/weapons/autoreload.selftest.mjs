/**
 * Headless check: the auto-reload contract.
 *
 *   node src/weapons/autoreload.selftest.mjs
 *
 * `config.autoReload` (default ON, a Controls toggle persisted by
 * core/controls.js) makes an empty magazine reload itself: immediately on a
 * dry trigger pull, or after the last shot's cycle plus a beat when the
 * trigger is left alone. The interesting part is everything that must NOT
 * start a reload — a weapon switch in flight, a draw clip still playing, a
 * cooking grenade, a dead reserve, the setting turned off — and that each of
 * those defers gracefully instead of wedging the timer or spamming reload().
 *
 * Runs against the real `_runAutoReload` and `reload()` on a hand-built
 * instance, because the contract needs neither a GL context nor a clock —
 * just the per-weapon state and a viewmodel that remembers which clip it was
 * asked to play.
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

function makeSystem({ autoReload = true } = {}) {
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
  w.ctx = { config: { autoReload } };
  w._switchTo = null;
  w._fireTimer = 0;
  w._sinceShot = 10;
  w._autoReloadT = -1;
  w._pendingReloadEmpty = false;
  w.throwables = { cooking: false };
  w.viewmodel = {
    clipName: null,
    plays: [],
    play(name) {
      this.clipName = name;
      this.plays.push(name);
      return 0.5;
    },
    stopClip() {
      this.clipName = null;
    },
    get clipPlaying() {
      return this.clipName !== null;
    },
  };
  return w;
}

/** Fire the active weapon completely dry, as if the last round just left. */
function runDry(w) {
  const s = w.state;
  s.mag = 0;
  s.chambered = false;
  w._fireTimer = s.def.cycleTime;
  w._sinceShot = 0;
}

const idle = { firePressed: false };
const pull = { firePressed: true };

/**
 * Pump frames until a reload starts or `max` seconds pass; returns elapsed.
 * `wasEmpty` (the pre-trigger snapshot update() passes) is true throughout:
 * every scenario here begins with a weapon that is already dry.
 */
function pump(w, input, max, dt = 1 / 60) {
  let t = 0;
  while (t < max && !w.reloading) {
    w._runAutoReload(dt, input, w.state, true);
    t += dt;
  }
  return t;
}

console.log('auto-reload');

{
  // A loaded weapon is left entirely alone.
  const w = makeSystem();
  pump(w, idle, 2);
  check('a full magazine never arms the countdown', !w.reloading && w._autoReloadT === -1);
}

{
  // The dry trigger pull, which is the classic path.
  const w = makeSystem();
  runDry(w);
  w._runAutoReload(1 / 60, pull, w.state, true);
  check('a dry trigger pull reloads immediately', w.reloading);
  check(
    'and it is the empty reload, which has to feed the chamber',
    w.viewmodel.clipName === 'reloadEmpty'
  );
}

{
  // The pull that fired the last round is a shot, not a click: on that frame
  // the pre-trigger snapshot still said "loaded", so the reload waits for the
  // cycle instead of swallowing it.
  const w = makeSystem();
  runDry(w);
  w._runAutoReload(1 / 60, pull, w.state, false);
  check('the last round’s own pull does not reload on the spot', !w.reloading);
  check('it arms the countdown instead', w._autoReloadT > 0);
}

{
  // Running dry without pulling again: the cycle finishes, then a beat.
  const w = makeSystem();
  runDry(w);
  const cycle = w.state.def.cycleTime;
  const t = pump(w, idle, 5);
  check('running dry reloads on its own after the shot cycle', w.reloading);
  check(
    'but not before the cycle plus a beat has passed',
    t >= cycle + 0.25,
    `reloaded at ${t.toFixed(3)}s against a ${cycle.toFixed(3)}s cycle`
  );
}

{
  // The bolt gun's cycle IS the bolt stroke; the reload must wait it out.
  const w = makeSystem();
  w.activeId = 'sniper';
  runDry(w);
  const cycle = w.state.def.cycleTime;
  const t = pump(w, idle, 5);
  check(
    'the bolt gun works the bolt before the hands go for a magazine',
    w.reloading && t >= cycle,
    `reloaded at ${t.toFixed(3)}s against a ${cycle.toFixed(3)}s cycle`
  );
}

{
  // The setting, off: nothing reloads without R — not even a dry pull.
  const w = makeSystem({ autoReload: false });
  runDry(w);
  w._runAutoReload(1 / 60, pull, w.state, true);
  pump(w, idle, 2);
  check('OFF means even a dry pull does not reload', !w.reloading && w._autoReloadT === -1);
  // The manual path is untouched by the setting.
  check('while R still reloads exactly as before', w.reload() === true && w.reloading);
}

{
  // A weapon switch in flight parks the countdown instead of racing it.
  const w = makeSystem();
  runDry(w);
  pump(w, idle, 0.05);
  w._switchTo = 'smg';
  w.viewmodel.play('holster');
  pump(w, idle, 3);
  check('a switch in flight is never interrupted by a reload', !w.reloading);
  check('and the countdown is parked, not left ticking', w._autoReloadT === -1);

  // Switch lands: draw plays first, the reload starts only once the hands
  // are free — the case that used to look wrong when reload cut the draw.
  w._switchTo = null;
  w.viewmodel.play('draw');
  pump(w, idle, 3);
  check('the draw clip finishes untouched', !w.reloading && w.viewmodel.clipName === 'draw');
  w.viewmodel.stopClip();
  pump(w, idle, 1);
  check('and the reload starts once the draw is done', w.reloading);
  check(
    'without the draw ever being cut short',
    w.viewmodel.plays.join(',') === 'holster,draw,reloadEmpty'
  );
}

{
  // A cooking grenade owns the weapon hand until it is thrown.
  const w = makeSystem();
  runDry(w);
  w.throwables.cooking = true;
  w._runAutoReload(1 / 60, pull, w.state, true);
  pump(w, idle, 3);
  check('a cooking grenade blocks the reload, dry pull included', !w.reloading);
  w.throwables.cooking = false;
  pump(w, idle, 1);
  check('which begins the moment the grenade leaves the hand', w.reloading);
}

{
  // Dead reserve: nothing to load, so reload() must not be spammed either.
  const w = makeSystem();
  runDry(w);
  w.state.reserve = 0;
  w._runAutoReload(1 / 60, pull, w.state, true);
  pump(w, idle, 2);
  check(
    'an exhausted reserve never arms the countdown or calls for a clip',
    !w.reloading && w._autoReloadT === -1 && w.viewmodel.plays.length === 0
  );
}

{
  // A death mid-countdown must not land the reload on the fresh magazine.
  const w = makeSystem();
  runDry(w);
  pump(w, idle, 0.05);
  check('the countdown was armed before the death', w._autoReloadT > 0);
  w.resetLoadout();
  pump(w, idle, 2);
  check('a respawn parks the countdown with the rest of the state', !w.reloading);
}

console.log(failures ? `\n${failures} failure(s)` : '\nauto-reload ok');
process.exit(failures ? 1 : 0);
