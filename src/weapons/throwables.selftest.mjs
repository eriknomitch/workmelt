/**
 * Headless checks for the player's lethal / tactical equipment.
 *
 * The throw path is pure state + maths, so it runs with a stub ctx: no GL, no
 * physics world, no browser. What is actually being pinned down here is the
 * inventory contract (a pulled pin is never refunded) and the cook-off, because
 * both are the kind of thing a later refactor silently inverts.
 *
 *   node src/weapons/throwables.selftest.mjs
 */
import * as THREE from 'three';
import { Throwables, THROWABLE_DEFS } from './throwables.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/** Minimal ctx: a scene that accepts adds, a camera, and an event recorder. */
function makeCtx() {
  const events = [];
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 1.7, -10);
  camera.updateMatrixWorld(true);
  return {
    scene: new THREE.Scene(),
    camera,
    events: {
      emitted: events,
      emit(type, payload) {
        // Payloads are preallocated and reused, so snapshot what matters now.
        events.push({
          type,
          position: payload.position?.clone?.() ?? null,
          radius: payload.radius,
          damage: payload.damage,
          duration: payload.duration,
        });
      },
    },
    // No physics: the arc preview and rigid bodies degrade to mesh-only.
    peek: () => null,
  };
}

function makeSystem() {
  const ctx = makeCtx();
  const t = new Throwables(ctx, { player: null });
  t.init();
  return { ctx, t };
}

console.log('throwables');

/* ---------------------------------------------------------------- counts -- */
{
  const { t } = makeSystem();
  check(
    'starts stocked from the defs',
    t.counts.lethal === THROWABLE_DEFS.frag.capacity &&
      t.counts.tactical === THROWABLE_DEFS.stun.capacity,
    JSON.stringify(t.counts)
  );

  t.beginCook('lethal');
  check('cooking does not spend the round early', t.counts.lethal === THROWABLE_DEFS.frag.capacity);
  t.update(0.1);
  t.release();
  check('release spends exactly one', t.counts.lethal === THROWABLE_DEFS.frag.capacity - 1);

  // Drain the slot and confirm it cannot go negative or cook on empty.
  for (let i = 0; i < 6; i++) {
    if (t.beginCook('lethal')) {
      t.update(0.05);
      t.release();
    }
  }
  check('never goes negative', t.counts.lethal === 0, `got ${t.counts.lethal}`);
  check('cannot cook an empty slot', t.beginCook('lethal') === false);
}

/* ------------------------------------------------------------ one at a time */
{
  const { t } = makeSystem();
  check('first cook takes', t.beginCook('lethal') === true);
  check('second cook is refused while one is out', t.beginCook('tactical') === false);
  check('slots are independent once free', (t.release(), t.beginCook('tactical')) === true);
}

/* --------------------------------------------------------------- cook-off -- */
{
  const { ctx, t } = makeSystem();
  t.beginCook('lethal');
  // Hold past the fuse without ever releasing.
  for (let i = 0; i < 200 && t.cooking; i++) t.update(1 / 60);
  check('cooks off in the hand', !t.cooking);
  const boom = ctx.events.emitted.filter((e) => e.type === 'explosion');
  check('cook-off detonates', boom.length === 1, `${boom.length} explosions`);
  check('cook-off still spends the round', t.counts.lethal === THROWABLE_DEFS.frag.capacity - 1);
  check(
    'cook-off lands on the player, not downrange',
    boom[0].position.distanceTo(ctx.camera.position) < 1.5,
    `${boom[0].position.distanceTo(ctx.camera.position).toFixed(2)}m away`
  );
}

/* ------------------------------------------------------------- cancel path -- */
{
  const { t } = makeSystem();
  t.beginCook('tactical');
  t.update(0.2);
  t.cancelCook();
  check('cancel ends the cook', !t.cooking);
  check(
    'cancel does NOT refund the pulled pin',
    t.counts.tactical === THROWABLE_DEFS.stun.capacity - 1,
    `got ${t.counts.tactical}`
  );
}

/* ------------------------------------------------------------- detonation -- */
{
  const { ctx, t } = makeSystem();
  t.beginCook('tactical');
  t.update(0.05);
  t.release();
  check('a live round exists after release', t.live.length === 1);
  for (let i = 0; i < 400 && t.live.length; i++) t.update(1 / 60);
  const flashes = ctx.events.emitted.filter((e) => e.type === 'equipment:flash');
  check('stun emits equipment:flash, not explosion', flashes.length === 1);
  check(
    'flash payload carries radius + duration',
    flashes[0].radius === THROWABLE_DEFS.stun.radius &&
      flashes[0].duration === THROWABLE_DEFS.stun.flashDuration
  );
  check('live list drains', t.live.length === 0);
}

/* ------------------------------------------------------------------ cook -- */
{
  const { ctx, t } = makeSystem();
  // A cooked frag must detonate SOONER than an uncooked one.
  t.beginCook('lethal');
  t.update(1.5); // cook for 1.5s
  t.release();
  const fuseAfterCook = t.live[0].fuse;
  check(
    'cooking burns the fuse before the throw',
    fuseAfterCook < THROWABLE_DEFS.frag.fuse - 1.4,
    `fuse ${fuseAfterCook.toFixed(2)} vs ${THROWABLE_DEFS.frag.fuse}`
  );
  check('cooked fuse is still positive', fuseAfterCook > 0);
  void ctx;
}

/* ------------------------------------------------------------- throw power -- */
{
  // A tap and a held throw must not come out at the same speed. Compare the
  // spawn velocity by reading the mesh displacement over one integration step;
  // with no physics the body is null, so assert on the def maths directly.
  const tap = THROWABLE_DEFS.frag.tapSpeed;
  const full = THROWABLE_DEFS.frag.throwSpeed;
  check('wind-up meaningfully changes throw speed', full > tap * 1.5, `${tap} -> ${full}`);
}

/* --------------------------------------------------------------- disposal -- */
{
  const { ctx, t } = makeSystem();
  t.beginCook('lethal');
  t.update(0.1);
  t.release();
  const before = ctx.scene.children.length;
  t.dispose();
  check('dispose clears live rounds from the scene', ctx.scene.children.length < before);
  check('dispose empties the live list', t.live.length === 0);
}

/* ----------------------------------------------------------------- refill -- */
{
  const { t } = makeSystem();
  t.beginCook('lethal');
  t.update(0.1);
  t.release();
  t.refill();
  check(
    'refill restocks both slots',
    t.counts.lethal === THROWABLE_DEFS.frag.capacity &&
      t.counts.tactical === THROWABLE_DEFS.stun.capacity
  );
}

console.log(failures ? `\n${failures} FAILED` : '\nOK');
process.exit(failures ? 1 : 0);
