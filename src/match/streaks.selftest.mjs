/**
 * Headless check: the killstreak ladder's contract.
 *
 *   node src/match/streaks.selftest.mjs
 *
 * What it pins, and why each would be invisible in a frame:
 *   • WHAT COUNTS — bot kills via `damage:dealt { killed }`, PvP kills via
 *     `net:kill { mine }`, and nothing else: not the player's own death, not a
 *     spectated PvP kill, not a kill landed while no match is live (a capture
 *     tableau must never bank a reward).
 *   • THE LADDER — the count resets on death but a BANKED reward survives it;
 *     a tier cannot be banked twice while unspent; match start/end clears all.
 *   • THE MORTAR — activation raises the green laser designator instead of
 *     firing (`streak:designate`, reward still banked); a laser that never
 *     finds a surface never locks, cancelling or dying lowers it with the
 *     reward intact, and only a lase held on a real target for
 *     `DESIGNATOR.paintTime` commits the strike. The committed volley is the
 *     old contract unchanged: every round announced by a falling tracer
 *     before its `explosion`, every impact inside the scatter disc around the
 *     LASED point, tagged `source: 'player'` so `ai` can credit the kills,
 *     and the whole pattern deterministic for a given engine seed.
 *
 * Runs against the real StreakTracker on a stub ctx: a real EventBus and Rng,
 * a plane-at-y=0 physics ray stub, and a camera aimed at the ground.
 */
import * as THREE from 'three';
import { StreakTracker, STREAK_TIERS, UAV, MORTAR, DESIGNATOR } from './streaks.js';
import { EventBus } from '../core/registry.js';
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

/** Physics stub: the world is an infinite floor at y = 0. */
const floorPhys = {
  raycast(a, b, c) {
    const hit = { hit: false, point: new THREE.Vector3() };
    if (typeof a === 'number') {
      // scalar form — the volley's drop solve, straight down
      hit.hit = true;
      hit.point.set(a, 0, c);
      return hit;
    }
    // vector form — the aim solve
    if (b.y >= 0) return hit; // looking at the sky
    const t = -a.y / b.y;
    if (t > c) return hit; // floor is beyond the solve range
    hit.hit = true;
    hit.point.set(a.x + b.x * t, 0, a.z + b.z * t);
    return hit;
  },
};

function makeCtx({ seed = 7, aimUp = false, phys = floorPhys } = {}) {
  const events = new EventBus();
  const player = { isPlayer: true, health: { dead: false } };
  const systems = { physics: phys, player };
  const dir = new THREE.Vector3(0, aimUp ? 0.5 : -0.35, -1).normalize();
  return {
    events,
    rng: new Rng(seed),
    input: { enabled: true, pressed: () => false },
    camera: {
      position: new THREE.Vector3(0, 1.7, 0),
      getWorldDirection: (v) => v.copy(dir),
    },
    peek: (id) => systems[id],
    get: (id) => systems[id],
    player,
  };
}

const botKill = (ctx) => ctx.events.emit('damage:dealt', { target: {}, killed: true });

/** Record every payload of `type` (copied, because emitters reuse payloads). */
function record(ctx, type) {
  const out = [];
  ctx.events.on(type, (e) => out.push(JSON.parse(JSON.stringify(e))));
  return out;
}

/* ==================================================================== */
console.log('what counts as a kill');
{
  const ctx = makeCtx();
  const tracker = new StreakTracker(ctx);
  const kills = record(ctx, 'streak:kills');

  botKill(ctx);
  check('nothing scores before a match is live', tracker.kills === 0 && kills.length === 0);

  ctx.events.emit('match:start', {});
  botKill(ctx);
  check('a bot kill scores in a live match', tracker.kills === 1);
  ctx.events.emit('damage:dealt', { target: {}, killed: false });
  check('a wound is not a kill', tracker.kills === 1);
  ctx.events.emit('damage:dealt', { target: 'player', killed: true });
  ctx.events.emit('damage:dealt', { target: ctx.player, killed: true });
  ctx.events.emit('damage:dealt', { target: { isPlayer: true }, killed: true });
  check('the local player dying is not the player killing', tracker.kills === 1);
  ctx.events.emit('net:kill', { mine: true });
  check('a relay-confirmed PvP kill scores', tracker.kills === 2);
  ctx.events.emit('net:kill', { mine: false });
  check("somebody else's PvP kill does not", tracker.kills === 2);
  check('every change was reported as streak:kills', kills.map((e) => e.kills).join(',') === '1,2');
  tracker.dispose();
}

/* ==================================================================== */
console.log('the ladder: earn, bank, reset');
{
  const ctx = makeCtx();
  const tracker = new StreakTracker(ctx);
  const earned = record(ctx, 'streak:earned');
  const kills = record(ctx, 'streak:kills');
  ctx.events.emit('match:start', {});

  for (let i = 0; i < STREAK_TIERS[0].kills; i++) botKill(ctx);
  check('the first tier banks at its threshold',
    earned.length === 1 && earned[0].reward === STREAK_TIERS[0].reward);

  ctx.events.emit('player:death', {});
  check('death resets the count', tracker.kills === 0);
  check('death reports the reset', kills.at(-1).kills === 0);
  check('death does not take the banked reward', tracker.banked.length === 1);

  for (let i = 0; i < STREAK_TIERS[0].kills; i++) botKill(ctx);
  check('an unspent tier cannot be banked twice', earned.length === 1);

  for (let i = STREAK_TIERS[0].kills; i < STREAK_TIERS[1].kills; i++) botKill(ctx);
  check('the second tier banks on the same run',
    earned.length === 2 && earned[1].reward === STREAK_TIERS[1].reward);
  check('banked rewards keep earn order',
    tracker.banked.join(',') === `${STREAK_TIERS[0].reward},${STREAK_TIERS[1].reward}`);

  ctx.events.emit('match:end', {});
  check('match end clears the bank', tracker.banked.length === 0 && tracker.kills === 0);
  tracker.dispose();
}

/* ==================================================================== */
console.log('uav activation');
{
  const ctx = makeCtx();
  const tracker = new StreakTracker(ctx);
  const activated = record(ctx, 'streak:activated');
  const uav = record(ctx, 'streak:uav');
  ctx.events.emit('match:start', {});

  check('nothing to activate, nothing happens', tracker.activate() === null);
  for (let i = 0; i < STREAK_TIERS[0].kills; i++) botKill(ctx);

  ctx.player.health.dead = true;
  check('a dead player cannot activate', tracker.activate() === null && uav.length === 0);
  ctx.player.health.dead = false;

  check('activation fires the oldest banked reward', tracker.activate() === 'uav');
  check('streak:activated announced it', activated.length === 1 && activated[0].reward === 'uav');
  check('streak:uav opened the window for the contracted duration',
    uav.length === 1 && uav[0].duration === UAV.duration);
  check('the reward is spent', tracker.banked.length === 0);
  tracker.dispose();
}

/* ==================================================================== */
console.log('mortar: the laser designator');
{
  // A laser held on the sky paints nothing and can never lock.
  const skyCtx = makeCtx({ aimUp: true });
  const tracker = new StreakTracker(skyCtx);
  const designate = record(skyCtx, 'streak:designate');
  const activated = record(skyCtx, 'streak:activated');
  skyCtx.events.emit('match:start', {});
  for (let i = 0; i < STREAK_TIERS[1].kills; i++) botKill(skyCtx);
  tracker.banked.shift(); // spend the uav off-screen; the mortar is the point
  check('activation raises the designator instead of firing',
    tracker.activate() === 'designating');
  check('the designator going up is announced',
    designate.length === 1 && designate[0].active === true && designate[0].reward === 'mortar');
  check('the reward stays banked while lasing', tracker.banked.join(',') === 'mortar');
  for (let i = 0; i < 60 * 4; i++) tracker.update(1 / 60);
  check('a laser on the sky never locks',
    activated.length === 0 && tracker.banked.join(',') === 'mortar');
  check('the key lowers the laser instead of firing', tracker.activate() === null);
  check('the designator coming down is announced', designate.at(-1).active === false);
  check('a cancelled lase is not consumed', tracker.banked.join(',') === 'mortar');
  tracker.dispose();

  // Dying mid-lase drops the laser but not the banked reward.
  const dieCtx = makeCtx();
  const t2 = new StreakTracker(dieCtx);
  const designate2 = record(dieCtx, 'streak:designate');
  dieCtx.events.emit('match:start', {});
  for (let i = 0; i < STREAK_TIERS[1].kills; i++) botKill(dieCtx);
  t2.banked.shift();
  t2.activate();
  dieCtx.events.emit('player:death', {});
  check('death lowers the laser', designate2.at(-1).active === false);
  check('death does not spend the lased reward', t2.banked.join(',') === 'mortar');
  t2.dispose();
}

/* ==================================================================== */
console.log('mortar: lock, volley, determinism');
{
  const run = (seed) => {
    const ctx = makeCtx({ seed });
    const t = new StreakTracker(ctx);
    const explosions = record(ctx, 'explosion');
    const tracers = record(ctx, 'bullet:tracer');
    const activated = record(ctx, 'streak:activated');
    ctx.events.emit('match:start', {});
    for (let i = 0; i < STREAK_TIERS[1].kills; i++) botKill(ctx);
    t.banked.shift();
    const aim = new THREE.Vector3();
    t._solveAim(aim);
    check('the aim solve lands on the floor plane', Math.abs(aim.y) < 1e-6);
    const midFlight = [];
    ctx.events.on('bullet:tracer', () => midFlight.push(explosions.length));
    check('a grounded aim starts the lase', t.activate() === 'designating');
    check('starting the lase fires nothing yet', activated.length === 0);
    // Hold the laser on the floor until the lock ripens.
    const lockFrames = Math.ceil(DESIGNATOR.paintTime * 60) + 2;
    for (let i = 0; i < lockFrames; i++) t.update(1 / 60);
    check('a held lase commits the strike',
      activated.length === 1 && activated[0].reward === 'mortar');
    check('the committed strike carries the lased point',
      Math.abs(activated[0].position.x - aim.x) < 1e-6 &&
      Math.abs(activated[0].position.z - aim.z) < 1e-6);
    check('the commit spends the reward', t.banked.length === 0);
    for (let i = 0; i < 60 * 12; i++) t.update(1 / 60);
    t.dispose();
    return { explosions, tracers, midFlight, aim };
  };

  const a = run(1234);
  check('every round detonates', a.explosions.length === MORTAR.rounds);
  check('every round announces itself first', a.tracers.length === MORTAR.rounds);
  check('each tracer falls before its own round lands',
    a.midFlight.every((count, i) => count <= i));
  check('impacts are tagged as the player\'s',
    a.explosions.every((e) => e.source === 'player'));
  check('impacts carry the contracted radius and damage',
    a.explosions.every((e) => e.radius === MORTAR.radius && e.damage === MORTAR.damage));
  check('every impact lands inside the scatter disc',
    a.explosions.every((e) => Math.hypot(e.position.x - a.aim.x, e.position.z - a.aim.z) <= MORTAR.scatter + 1e-9));
  check('rounds land on the resolved ground', a.explosions.every((e) => e.position.y === 0));

  const b = run(1234);
  const c = run(4321);
  const sig = (r) => r.explosions.map((e) => `${e.position.x.toFixed(6)},${e.position.z.toFixed(6)}`).join('|');
  check('the same seed reproduces the same pattern', sig(a) === sig(b));
  check('a different seed does not', sig(a) !== sig(c));
}

/* ==================================================================== */
console.log('the activation key');
{
  const ctx = makeCtx();
  let pressed = false;
  ctx.input.pressed = (code) => pressed && code === 'Digit5';
  const tracker = new StreakTracker(ctx);
  const uav = record(ctx, 'streak:uav');
  ctx.events.emit('match:start', {});
  for (let i = 0; i < STREAK_TIERS[0].kills; i++) botKill(ctx);

  tracker.update(1 / 60);
  check('no key, no activation', uav.length === 0);
  pressed = true;
  ctx.input.enabled = false;
  tracker.update(1 / 60);
  check('disabled input (menus, lobby) swallows the key', uav.length === 0);
  ctx.input.enabled = true;
  tracker.update(1 / 60);
  check('Digit5 activates the banked reward', uav.length === 1);
  tracker.dispose();
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
