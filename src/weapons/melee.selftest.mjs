/**
 * Headless checks for the melee contract.
 *
 * Melee has no visual tell for most of what matters: a backstab cone a few
 * degrees wide of spec, a recovery ten frames short, or a fan that silently
 * stabs through cover all look identical in a screenshot. This file pins the
 * numbers and exercises the strike against a scripted physics stub.
 *
 * What it asserts, in order:
 *   1. the contract constants — reach, capsule, damage split, cone, recovery
 *   2. the backstab cone: front/side is 45, dead-behind is 100, and the
 *      boundary sits exactly at facing · toAttacker = -0.45
 *   3. the ray fan geometry — centre-first, three heights by three laterals,
 *      spanning exactly the forgiveness capsule at full reach
 *   4. the swing clip fits the recovery window and carries the strike beat
 *   5. attack() honours the recovery window and the hands (reload/switch/cook)
 *   6. strike() against a scripted raycast: nearest actor wins, a wall in the
 *      way vetoes the stab, and the payload is the canonical `damage:dealt`
 *
 *   node src/weapons/melee.selftest.mjs
 */
import * as THREE from 'three';
import { MELEE, Melee, isBackstab, meleeDamageFor, buildFan } from './melee.js';
import { buildClips } from './clips.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

console.log('melee contract');

/* ------------------------------------------------------------- 1. constants */
check('reach is 2.1 m', MELEE.reach === 2.1, `${MELEE.reach}`);
check('forgiveness capsule is 0.58 m wide', Math.abs(MELEE.radius * 2 - 0.58) < 1e-9,
  `${MELEE.radius * 2}`);
check('front damage is 45 — two swings on full health', MELEE.damage === 45, `${MELEE.damage}`);
check('backstab damage is 100 — always lethal', MELEE.backstabDamage === 100,
  `${MELEE.backstabDamage}`);
check('backstab cone is dot <= -0.45', MELEE.backstabDot === -0.45, `${MELEE.backstabDot}`);
check('recovery is 656 ms', MELEE.recovery === 0.656, `${MELEE.recovery}`);
check('the swing clip fits inside the recovery', MELEE.swing < MELEE.recovery,
  `${MELEE.swing} vs ${MELEE.recovery}`);
check('the strike beat lands in the swing\'s first half',
  MELEE.strikeAt > 0 && MELEE.strikeAt < 0.5, `${MELEE.strikeAt}`);

/* ---------------------------------------------------------------- 2. the cone */
check('dead ahead is a front hit', meleeDamageFor(1) === MELEE.damage);
check('a flank (dot 0) is still a front hit', meleeDamageFor(0) === MELEE.damage);
check('dead behind is a backstab', meleeDamageFor(-1) === MELEE.backstabDamage);
check('the boundary is inclusive: dot exactly -0.45 backstabs',
  meleeDamageFor(-0.45) === MELEE.backstabDamage);
check('one tick outside the cone is not a backstab',
  meleeDamageFor(-0.4499) === MELEE.damage);
check('isBackstab agrees with the damage split',
  isBackstab(-0.45) && !isBackstab(-0.4499) && isBackstab(-1) && !isBackstab(1));

/* ------------------------------------------------------------------ 3. the fan */
const fan = buildFan();
const tan = MELEE.radius / MELEE.reach;
check('nine rays: three heights by three laterals', fan.length === 9, `${fan.length}`);
check('the centre ray comes first, exactly on the bore',
  fan[0].x === 0 && fan[0].y === 0);
check('only one centre ray',
  fan.filter((o) => o.x === 0 && o.y === 0).length === 1);
check('three distinct heights', new Set(fan.map((o) => o.y)).size === 3);
check('three distinct laterals', new Set(fan.map((o) => o.x)).size === 3);
check('the fan spans exactly the capsule radius at full reach',
  fan.every((o) => Math.abs(o.x) <= tan + 1e-12 && Math.abs(o.y) <= tan + 1e-12) &&
  fan.some((o) => Math.abs(Math.abs(o.x) - tan) < 1e-12) &&
  fan.some((o) => Math.abs(Math.abs(o.y) - tan) < 1e-12));

/* ----------------------------------------------------------------- 4. the clip */
// buildClips only reads the attachment nodes, so a minimal rig is enough here.
const nodes = { gripL: { pos: [0, -0.04, -0.18] }, magSeat: { pos: [0, -0.06, -0.05] } };
const clips = buildClips(nodes, { magLen: 0.2 });
const clip = clips.melee;
check('every weapon gets a melee clip', !!clip);
check('the clip runs the pinned swing time', clip.duration === MELEE.swing,
  `${clip.duration}`);
const strikeEv = clip.events.find((e) => e.name === 'strike');
const endEv = clip.events.find((e) => e.name === 'end');
check('the clip carries the strike beat at the pinned time',
  !!strikeEv && Math.abs(strikeEv.t - MELEE.strikeAt * MELEE.swing) < 1e-9,
  `${strikeEv?.t}`);
check('the clip ends with an end beat inside its duration',
  !!endEv && endEv.t > (strikeEv?.t ?? 0) && endEv.t < clip.duration);
// The thrust apex is where the butt connects: the weapon must be at its most
// forward (most negative z) on the strike beat, or the damage lands before or
// after the contact reads.
const strikeKey = clip.weapon.find((k) => Math.abs(k.t - (strikeEv?.t ?? -1)) < 1e-9);
check('the strike beat sits on the thrust apex',
  !!strikeKey && clip.weapon.every((k) => (k.p?.[2] ?? 0) >= strikeKey.p[2]),
  `apex z=${strikeKey?.p?.[2]}`);

/* -------------------------------------------------- 5. recovery + the hands */
/** A weapon system stub: everything attack() consults, nothing it doesn't. */
function stubWeapons() {
  const played = [];
  return {
    played,
    reloading: false,
    switching: false,
    inspecting: false,
    throwables: { cooking: false },
    viewmodel: { play: (n) => (played.push(n), MELEE.swing), stopClip: () => played.push('stop') },
    player: null,
    physics: null,
  };
}
const ctxEvents = () => {
  const emitted = [];
  return { emitted, events: { emit: (t, p) => emitted.push({ t, p }) }, peek: () => null };
};

{
  const wp = stubWeapons();
  const m = new Melee(ctxEvents(), wp);
  check('a ready melee swings', m.attack() === true && wp.played.includes('melee'));
  check('a second press inside the recovery is refused', m.attack() === false);
  m.update(MELEE.recovery - 0.01);
  check('still refused one frame before recovery ends', m.attack() === false);
  m.update(0.02);
  check('accepted again once the recovery has run', m.attack() === true);
}
{
  const wp = stubWeapons();
  wp.reloading = true;
  check('refused while reloading', new Melee(ctxEvents(), wp).attack() === false);
}
{
  const wp = stubWeapons();
  wp.switching = true;
  check('refused while switching weapons', new Melee(ctxEvents(), wp).attack() === false);
}
{
  const wp = stubWeapons();
  wp.throwables.cooking = true;
  check('refused while cooking a grenade', new Melee(ctxEvents(), wp).attack() === false);
}
{
  const wp = stubWeapons();
  wp.inspecting = true;
  const m = new Melee(ctxEvents(), wp);
  check('an inspect is cut short, not a refusal',
    m.attack() === true && wp.played[0] === 'stop' && wp.played[1] === 'melee');
}
{
  const wp = stubWeapons();
  const m = new Melee(ctxEvents(), wp);
  m.attack();
  m.reset();
  check('reset() (a fresh spawn) clears the recovery', m.attack() === true);
}

/* --------------------------------------------------------------- 6. strike() */
/**
 * A scripted physics: place capsule-less "actors" straight down the bore and
 * answer every raycast from a plain segment/point model. `hits` maps a max
 * distance at which each scripted body answers; the nearest one wins, exactly
 * like the pooled Hit records the real raycast returns.
 */
function stubCtx(camera, bodies) {
  const emitted = [];
  const phys = {
    MASK: { BULLET: 0xff },
    raycast: (origin, dir, maxDist) => {
      let best = null;
      for (const b of bodies) {
        // distance along the ray at which this scripted body is met
        const to = new THREE.Vector3().copy(b.at).sub(origin);
        const t = to.dot(dir);
        if (t < 0 || t > maxDist) continue;
        const miss = new THREE.Vector3().copy(dir).multiplyScalar(t).sub(to).length();
        if (miss > (b.radius ?? 0.05)) continue;
        if (best && t >= best.distance) continue;
        best = {
          hit: true,
          distance: t,
          actor: b.actor ?? null,
          part: b.part ?? null,
          point: new THREE.Vector3().copy(origin).addScaledVector(dir, t),
        };
      }
      return best ?? { hit: false, distance: maxDist, actor: null, point: new THREE.Vector3() };
    },
  };
  return {
    emitted,
    camera,
    events: { emit: (t, p) => emitted.push({ t, p: t === 'damage:dealt' ? { ...p } : p }) },
    peek: (id) => (id === 'physics' ? phys : null),
  };
}

const camera = new THREE.PerspectiveCamera();
camera.position.set(0, 1.7, 0);
camera.lookAt(0, 1.7, -1); // bore straight down -z
camera.updateMatrixWorld();

{
  // An actor facing away (+z toward the camera means yaw 0 faces... the rig
  // faces (sin yaw, cos yaw), so yaw=0 faces +z — straight AT a camera on the
  // -z side's origin. yaw=π faces -z: away from the attacker. Backstab.
  const actor = { yaw: Math.PI, position: new THREE.Vector3(0, 0, -1.5) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0, 1.7, -1.5), radius: 0.3, actor, part: 'torso' },
  ]);
  const wp = stubWeapons();
  const m = new Melee(ctx, wp);
  const hit = m.strike();
  const swing = ctx.emitted.find((e) => e.t === 'weapon:melee');
  const dealt = ctx.emitted.find((e) => e.t === 'damage:dealt');
  check('every swing emits weapon:melee', !!swing && swing.p.reach === MELEE.reach);
  check('an actor in reach takes damage', !!hit && !!dealt && dealt.p.target === actor);
  check('facing away means a backstab', dealt?.p.amount === MELEE.backstabDamage,
    `${dealt?.p.amount}`);
  check('the payload is the canonical shape',
    !!dealt && 'headshot' in dealt.p && 'killed' in dealt.p && 'point' in dealt.p &&
    dealt.p.part === 'torso');
}
{
  // Same body, now facing the attacker: front damage.
  const actor = { yaw: 0, position: new THREE.Vector3(0, 0, -1.5) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0, 1.7, -1.5), radius: 0.3, actor },
  ]);
  const hit = new Melee(ctx, stubWeapons()).strike();
  check('facing the attacker is front damage', hit?.amount === MELEE.damage, `${hit?.amount}`);
}
{
  // A wall between: the scripted static body answers first with no actor.
  const actor = { yaw: Math.PI, position: new THREE.Vector3(0, 0, -1.8) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0, 1.7, -0.9), radius: 5, actor: null }, // the wall
    { at: new THREE.Vector3(0, 1.7, -1.8), radius: 0.3, actor },
  ]);
  const hit = new Melee(ctx, stubWeapons()).strike();
  const dealt = ctx.emitted.find((e) => e.t === 'damage:dealt');
  check('cover vetoes the stab', hit === null && !dealt);
  check('the whiffed swing still announced itself',
    ctx.emitted.some((e) => e.t === 'weapon:melee'));
}
{
  // Out of reach: 2.3 m is a whiff at 2.1 m reach.
  const actor = { yaw: 0, position: new THREE.Vector3(0, 0, -2.3) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0, 1.7, -2.3), radius: 0.3, actor },
  ]);
  check('past reach is a whiff', new Melee(ctx, stubWeapons()).strike() === null);
}
{
  // Two actors: the nearest one takes the hit, even off the centre ray.
  const near = { yaw: 0, position: new THREE.Vector3(0.12, 0, -1.0) };
  const far = { yaw: 0, position: new THREE.Vector3(0, 0, -1.9) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0.12, 1.7, -1.0), radius: 0.05, actor: near },
    { at: new THREE.Vector3(0, 1.7, -1.9), radius: 0.3, actor: far },
  ]);
  const hit = new Melee(ctx, stubWeapons()).strike();
  check('the nearest actor across the fan wins', hit?.target === near);
}
{
  // The forgiveness: an actor 0.2 m off the bore at 1.8 m is inside the
  // capsule the fan approximates and must still connect. 0.12 m is roughly a
  // torso's half-width, which is what the fan really lands on.
  const actor = { yaw: 0, position: new THREE.Vector3(0.2, 0, -1.8) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0.2, 1.7, -1.8), radius: 0.12, actor },
  ]);
  check('the fan forgives an off-bore hit inside the capsule',
    new Melee(ctx, stubWeapons()).strike() !== null);
}
{
  // An actor with no yaw (a ragdoll, a prop that reports as an actor) never
  // hands out the backstab multiplier.
  const actor = { position: new THREE.Vector3(0, 0, -1.5) };
  const ctx = stubCtx(camera, [
    { at: new THREE.Vector3(0, 1.7, -1.5), radius: 0.3, actor },
  ]);
  const hit = new Melee(ctx, stubWeapons()).strike();
  check('no facing means no free backstab', hit?.amount === MELEE.damage, `${hit?.amount}`);
}

/* ------------------------------------------------------------------- result */
if (failures) {
  console.error(`\n${failures} melee check(s) FAILED`);
  process.exit(1);
}
console.log('\nall melee checks passed');
