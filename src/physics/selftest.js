/**
 * Headless verification + benchmark for the physics system.
 *
 *   node src/physics/selftest.js
 *
 * This is a dev tool, not shipped game code — nothing imports it. It exists
 * because a screenshot cannot show whether a capsule tunnelled through a wall
 * or a ragdoll is quietly gaining energy, and those are the failures that
 * matter here.
 */

import * as THREE from 'three';
import { EventBus } from '../core/registry.js';
import { Rng } from '../core/rng.js';
import { PhysicsSystem } from './index.js';
import { MASK, LAYER, SURFACE } from './surfaces.js';

let failures = 0;
let checks = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else {
    console.log(`  ok    ${label}${detail ? '  (' + detail + ')' : ''}`);
  }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/* ------------------------------------------------------------------ */
/* Test level                                                          */
/* ------------------------------------------------------------------ */

function buildLevel(phys) {
  const scene = new THREE.Scene();

  // Tessellated ground: 120 x 120 grid over 120 m => 28 800 triangles.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120, 120, 120),
    new THREE.MeshBasicMaterial({ name: 'concrete_road' })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground_concrete';
  scene.add(ground);

  // A wall at x = 5, 0.2 m thick (a real box, so it has a backface).
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 12), new THREE.MeshBasicMaterial());
  wall.position.set(5, 2, 0);
  wall.name = 'wall_concrete';
  scene.add(wall);

  // Thin wooden partition at x = -4, 0.06 m thick.
  const wood = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3, 8), new THREE.MeshBasicMaterial());
  wood.position.set(-4, 1.5, 0);
  wood.name = 'partition_wood';
  scene.add(wood);

  // Staircase: 10 steps of 0.18 m rise, 0.30 m run.
  const stairs = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(2, 0.18, 0.3), new THREE.MeshBasicMaterial());
    s.position.set(0, 0.09 + i * 0.18, -3 - i * 0.3);
    s.name = 'step_concrete';
    stairs.add(s);
  }
  scene.add(stairs);

  // A 30 degree ramp and a 70 degree (unwalkable) ramp.
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 6), new THREE.MeshBasicMaterial());
  ramp.position.set(-8, 1.4, 0);
  ramp.rotation.x = -30 * (Math.PI / 180);
  ramp.name = 'ramp_dirt';
  scene.add(ramp);

  const cliff = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.4), new THREE.MeshBasicMaterial());
  cliff.position.set(0, 3, 8);
  cliff.name = 'cliff_metal';
  scene.add(cliff);

  // A crate field for instancing coverage.
  const inst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshBasicMaterial({ name: 'wood_crate' }),
    40
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    m.makeTranslation(-14 + (i % 8) * 1.2, 0.3, -6 + Math.floor(i / 8) * 1.2);
    inst.setMatrixAt(i, m);
  }
  inst.name = 'crates_wood';
  scene.add(inst);

  scene.updateMatrixWorld(true);
  phys.addStaticGroup(scene);
  phys.rebuildStatic();
  return scene;
}

/* ------------------------------------------------------------------ */

const events = new EventBus();
const rng = new Rng(0x5eed1234);
const phys = new PhysicsSystem();
phys.ctx = {
  events,
  scene: null,
  camera: null,
  time: { alpha: 0, elapsed: 0, dt: 1 / 60 },
  rng,
};
phys.rng = rng.fork();
phys.ballistics.rng = phys.rng;

section('BVH build');
const t0 = performance.now();
buildLevel(phys);
const buildMs = performance.now() - t0;
const W = phys.staticWorld;
console.log(
  `  ${W.triCount} triangles, ${W.nodeCount} nodes, depth ${W.maxDepth}, ` +
  `bake+build ${buildMs.toFixed(1)} ms (build ${W.buildMs.toFixed(1)} ms)`
);
ok(W.triCount > 28000, 'tens of thousands of triangles baked', `${W.triCount}`);
ok(W.buildMs < 400, 'build under 400 ms');

/* ---------------- raycast correctness + speed ---------------- */
section('Raycasts');
{
  const h = phys.raycast(0, 10, 0, 0, -1, 0, 100, MASK.WORLD);
  ok(h.hit && Math.abs(h.point.y) < 1e-3, 'down-ray hits ground at y=0', `y=${h.point.y.toFixed(5)}`);
  ok(h.normal.y > 0.999, 'ground normal is +Y', `n=(${h.normal.x.toFixed(2)},${h.normal.y.toFixed(2)},${h.normal.z.toFixed(2)})`);
  ok(h.surface === 'concrete', `surface inferred from name`, h.surface);

  const w = phys.raycast(0, 2, 0, 1, 0, 0, 50, MASK.WORLD);
  ok(w.hit && Math.abs(w.distance - 4.9) < 0.02, 'side-ray hits wall front face at 4.9 m', `${w.distance.toFixed(3)}`);
  ok(w.frontFace === true, 'entry is a front face');
  ok(w.normal.x < -0.99, 'wall normal faces the shooter');

  const miss = phys.raycast(0, 200, 0, 0, 1, 0, 100, MASK.WORLD);
  ok(!miss.hit, 'ray into the sky misses');

  const crate = phys.raycast(-14, 0.3, -6, 0, 0, -1, 3, MASK.WORLD);
  ok(crate.hit && crate.surface === 'wood', 'instanced crate baked with wood surface', crate.surface);

  // brute-force cross-check on 2000 random rays
  let mismatch = 0;
  const r2 = new Rng(7);
  for (let i = 0; i < 2000; i++) {
    const ox = r2.range(-20, 20), oy = r2.range(0.2, 6), oz = r2.range(-20, 20);
    let dx = r2.signed(), dy = r2.signed(), dz = r2.signed();
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const bvh = phys.raycast(ox, oy, oz, dx, dy, dz, 60, MASK.ALL);
    const ref = bruteRay(W, ox, oy, oz, dx, dy, dz, 60);
    const a = bvh.hit ? bvh.distance : Infinity;
    if (Math.abs(a - ref) > 1e-3) mismatch++;
  }
  ok(mismatch === 0, 'BVH matches brute force on 2000 random rays', `${mismatch} mismatches`);

  // speed
  const N = 200000;
  const rays = new Float32Array(N * 6);
  const r3 = new Rng(11);
  for (let i = 0; i < N; i++) {
    rays[i * 6] = r3.range(-30, 30);
    rays[i * 6 + 1] = r3.range(0.2, 8);
    rays[i * 6 + 2] = r3.range(-30, 30);
    let dx = r3.signed(), dy = r3.signed(), dz = r3.signed();
    const l = Math.hypot(dx, dy, dz) || 1;
    rays[i * 6 + 3] = dx / l; rays[i * 6 + 4] = dy / l; rays[i * 6 + 5] = dz / l;
  }
  const rec = phys._raw;
  const tA = performance.now();
  let hits = 0;
  for (let i = 0; i < N; i++) {
    if (W.raycast(rays[i * 6], rays[i * 6 + 1], rays[i * 6 + 2],
      rays[i * 6 + 3], rays[i * 6 + 4], rays[i * 6 + 5], 100, MASK.ALL, rec)) hits++;
  }
  const per = ((performance.now() - tA) / N) * 1000;
  console.log(`  ${N} rays, ${hits} hits, ${per.toFixed(3)} us/ray`);
  ok(per < 1000, 'sub-millisecond raycasts', `${per.toFixed(3)} us`);
}

/* ---------------- capsule sweep / tunnelling ---------------- */
section('Capsule sweeps');
{
  const hit = phys.capsuleCast(
    { x: 0, y: 0.4, z: 0 }, { x: 0, y: 1.5, z: 0 }, 0.32,
    { x: 1, y: 0, z: 0 }, 100, MASK.CHARACTER
  );
  ok(hit.hit && Math.abs(hit.distance - (4.9 - 0.32)) < 0.02,
    'capsule sweep stops at wall surface', `${hit.distance.toFixed(3)}`);

  // 500 m/s in one 1/120 s step = 4.17 m of travel straight through a 0.2 m wall
  const c = phys.createCharacter({ radius: 0.32, height: 1.8, position: { x: 0, y: 0, z: 0 } });
  c.teleport(0, 0, 0);
  const before = c.position.x;
  c.move(500 / 120, 0, 0);
  ok(c.position.x < 4.9 - 0.3 + 0.02 && c.position.x > before,
    'no tunnelling at 500 m/s', `x=${c.position.x.toFixed(3)}`);
  ok(phys.overlapCapsule(
    { x: c.position.x, y: c.position.y + c.radius, z: c.position.z },
    { x: c.position.x, y: c.position.y + c.height - c.radius, z: c.position.z },
    c.radius - 0.01, MASK.CHARACTER) === 0, 'capsule not embedded after the impact');
  phys.removeCharacter(c);
}

/* ---------------- character controller ---------------- */
section('Character controller');
{
  const c = phys.createCharacter({ radius: 0.32, height: 1.8 });
  c.teleport(0, 3, 0);
  for (let i = 0; i < 240; i++) {
    c.velocity.y += phys.gravity / 120;
    c.move(0, c.velocity.y / 120, 0);
  }
  ok(c.grounded, 'falls and lands on the ground');
  ok(Math.abs(c.position.y) < 0.02, 'rests exactly on the floor', `y=${c.position.y.toFixed(4)}`);

  // walk up the staircase (10 x 0.18 m rise, 0.30 m run)
  c.teleport(0, 0, -2.2);
  let steps = 0, peak = 0, peakAt = 0;
  for (let i = 0; i < 400; i++) {
    c.velocity.y += phys.gravity / 120;
    if (c.grounded) c.velocity.y = 0;
    c.move(0, c.velocity.y / 120, -2.2 / 120);
    if (c.steppedUp > 0) steps++;
    if (c.position.y > peak) { peak = c.position.y; peakAt = i; }
  }
  ok(peak > 1.7, 'climbs a 0.18 m staircase', `peak y=${peak.toFixed(3)} at frame ${peakAt}, ${steps} step-ups`);
  ok(peakAt < 300, 'climbs at walking pace, not by grinding', `${(peakAt / 120).toFixed(2)} s for 10 steps`);
  ok(c.position.z < -5.8, 'made forward progress up the stairs', `z=${c.position.z.toFixed(2)}`);

  // 30 degree ramp is walkable
  c.teleport(-8, 3, 2.6);
  for (let i = 0; i < 200; i++) {
    c.velocity.y += phys.gravity / 120;
    if (c.grounded) c.velocity.y = 0;
    c.move(0, c.velocity.y / 120, -1.5 / 120);
  }
  ok(c.grounded && c.position.y > 0.4, 'walks up a 30 degree ramp', `y=${c.position.y.toFixed(2)}`);

  // wall stops horizontal motion, does not eject
  c.teleport(4.0, 0, 0);
  for (let i = 0; i < 120; i++) {
    c.velocity.y += phys.gravity / 120;
    if (c.grounded) c.velocity.y = 0;
    c.move(6 / 120, c.velocity.y / 120, 0);
  }
  ok(c.position.x < 4.65 && c.position.x > 4.4, 'stopped flat against the wall', `x=${c.position.x.toFixed(3)}`);

  // stress: 20 000 random moves must never end inside geometry, never NaN
  const r = new Rng(99);
  let embedded = 0, nan = 0, maxY = -Infinity;
  c.teleport(0, 0.2, 0);
  for (let i = 0; i < 20000; i++) {
    const sp = r.range(0, 14) / 120;
    const a = r.float() * Math.PI * 2;
    c.velocity.y += phys.gravity / 120;
    if (c.grounded) c.velocity.y = r.float() < 0.01 ? 6 : 0;
    c.move(Math.cos(a) * sp, c.velocity.y / 120, Math.sin(a) * sp);
    if (!Number.isFinite(c.position.x + c.position.y + c.position.z)) { nan++; break; }
    if (c.position.y > maxY) maxY = c.position.y;
    if (i % 37 === 0) {
      const n = phys.overlapCapsule(
        { x: c.position.x, y: c.position.y + c.radius + 0.01, z: c.position.z },
        { x: c.position.x, y: c.position.y + c.height - c.radius, z: c.position.z },
        c.radius - 0.02, MASK.CHARACTER
      );
      if (n > 0) embedded++;
    }
  }
  ok(nan === 0, 'no NaN over 20 000 random moves');
  ok(embedded === 0, 'never ends a step inside geometry', `${embedded} embedded samples`);
  ok(maxY < 4.2, 'never launched by a crease', `maxY=${maxY.toFixed(2)}`);
  phys.removeCharacter(c);
}

/* ---------------- ballistics ---------------- */
section('Bullet penetration');
{
  const impacts = [];
  const off = events.on('bullet:impact', (e) =>
    impacts.push({ surface: e.surface, exit: e.exit, damage: e.damage, x: e.point.x, trace: e.trace })
  );

  // 6 cm wooden partition at x = -4 — should punch through.
  impacts.length = 0;
  phys.fireBullet({
    origin: { x: 0, y: 1.5, z: 0 }, dir: { x: -1, y: 0, z: 0 },
    damage: 40, penetration: 1.0, maxDist: 50, mask: MASK.BULLET,
  });
  const woodEntry = impacts.filter((i) => !i.exit && i.surface === 'wood');
  const woodExit = impacts.filter((i) => i.exit && i.surface === 'wood');
  ok(woodEntry.length === 1, 'entry impact on wood', `${woodEntry.length}`);
  ok(woodExit.length === 1, 'exit impact on wood', `${woodExit.length}`);
  ok(woodExit[0] && woodExit[0].damage < woodEntry[0].damage,
    'damage drops through the material',
    woodEntry[0] ? `${woodEntry[0].damage.toFixed(1)} -> ${woodExit[0]?.damage.toFixed(1)}` : '');

  // 0.2 m concrete wall at x = +5 — should stop.
  impacts.length = 0;
  phys.fireBullet({
    origin: { x: 0, y: 2, z: 0 }, dir: { x: 1, y: 0, z: 0 },
    damage: 40, penetration: 1.0, maxDist: 50, mask: MASK.BULLET,
  });
  ok(impacts.length === 1 && impacts[0].surface === 'concrete' && !impacts[0].exit,
    '0.2 m concrete stops the round', `${impacts.length} impacts`);

  // High-power AP round through the same concrete.
  impacts.length = 0;
  phys.fireBullet({
    origin: { x: 0, y: 2, z: 0 }, dir: { x: 1, y: 0, z: 0 },
    damage: 90, penetration: 4.5, maxDist: 50, mask: MASK.BULLET,
  });
  ok(impacts.some((i) => i.exit), 'AP round defeats the same wall', `${impacts.length} impacts`);

  // Multi-layer: three stacked wooden partitions must all report, and the
  // range budget must not be double-counted across layers.
  {
    const scene = new THREE.Scene();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3, 3), new THREE.MeshBasicMaterial());
      p.position.set(20 + i * 1.5, 1.5, 0);
      p.name = 'panel_wood';
      scene.add(p);
    }
    scene.updateMatrixWorld(true);
    const ids = phys.addStaticGroup(scene);
    phys.rebuildStatic();
    impacts.length = 0;
    phys.fireBullet({
      origin: { x: 15, y: 1.5, z: 0 }, dir: { x: 1, y: 0, z: 0 },
      damage: 60, penetration: 1.6, maxDist: 40, mask: MASK.BULLET,
    });
    const entries = impacts.filter((i) => !i.exit).length;
    ok(entries === 3, 'penetrates three stacked panels', `${entries} entries, ${impacts.length} impacts`);
    for (const id of ids) phys.removeStatic(id);
    phys.rebuildStatic();
  }

  /**
   * THE TRACE ID. One `fireBullet` is one id, shared by every crossing it
   * reports, and the next call is a different one.
   *
   * This is the only handle a listener has on "per ROUND", and the failure it
   * guards is silent and was live: `world`'s power grid counted crossings, so
   * a solid generator — three crossings a round, because a 3.2 m machine is
   * thicker than EXIT_PROBE and falls back to the sheet model — took triple
   * damage and Site Work blacked out on a burst nobody aimed at it. Nothing
   * threw, no frame looked wrong, and the balance comment in power.js still
   * said 21 rounds while the real number was 12.
   */
  {
    const scene = new THREE.Scene();
    // A generator-sized solid: thicker than EXIT_PROBE, so it is exactly the
    // case that reports more crossings than it has faces.
    const solid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3.2), new THREE.MeshBasicMaterial());
    solid.position.set(40, 1, 0);
    solid.name = 'plant_metal';
    scene.add(solid);
    scene.updateMatrixWorld(true);
    const ids = phys.addStaticGroup(scene);
    phys.rebuildStatic();

    impacts.length = 0;
    // Its own rng: deflection draws off the shared stream would shift every
    // later check, and the determinism pair below would fail for no reason.
    const traceRng = new Rng(0xdecaf);
    const shoot = () => phys.fireBullet({
      origin: { x: 40, y: 1.2, z: 8 }, dir: { x: 0, y: 0, z: -1 },
      damage: 34, penetration: 1.0, maxDist: 60, mask: MASK.BULLET, rng: traceRng,
    });
    shoot();
    const one = [...impacts];
    ok(one.length > 1, 'a thick solid reports more than one crossing per round', `${one.length}`);
    ok(one.every((i) => i.trace === one[0].trace), 'every crossing of one round shares a trace id',
      one.map((i) => i.trace).join(','));
    impacts.length = 0;
    shoot();
    ok(impacts.length > 0 && impacts[0].trace !== one[0].trace,
      'the next round gets a new trace id', `${one[0].trace} -> ${impacts[0]?.trace}`);

    for (const id of ids) phys.removeStatic(id);
    phys.rebuildStatic();
  }

  // determinism: identical seeds produce identical results.
  // `trace` is deliberately excluded — it is a monotonic counter, so it is the
  // one field that MUST differ between two otherwise identical traces.
  const shape = (list) => JSON.stringify(list.map(({ trace, ...rest }) => rest));
  const seedA = new Rng(1234);
  phys.ballistics.rng = seedA;
  impacts.length = 0;
  phys.fireBullet({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: -1, y: 0.02, z: 0.01 }, damage: 40, penetration: 2, maxDist: 60 });
  const runA = shape(impacts);
  phys.ballistics.rng = new Rng(1234);
  impacts.length = 0;
  phys.fireBullet({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: -1, y: 0.02, z: 0.01 }, damage: 40, penetration: 2, maxDist: 60 });
  ok(runA === shape(impacts), 'penetration is deterministic off the rng');
  phys.ballistics.rng = phys.rng;
  off();
}

/* ---------------- rigid bodies ---------------- */
section('Rigid bodies');
{
  const r = new Rng(5150);
  const bodies = [];
  for (let i = 0; i < 60; i++) {
    bodies.push(phys.spawnDebris(
      { x: r.range(-3, 3), y: r.range(1.5, 4), z: r.range(-3, 3) },
      { x: r.signed() * 2, y: r.range(-1, 2), z: r.signed() * 2 },
      { size: 0.09, surface: 'concrete', lifetime: 999 }
    ));
  }
  const tB = performance.now();
  for (let i = 0; i < 720; i++) phys.bodies.step(1 / 120); // 6 seconds
  const simMs = performance.now() - tB;
  let asleep = 0, below = 0, bad = 0;
  for (const b of bodies) {
    if (b.sleeping) asleep++;
    if (b.position.y < -0.05) below++;
    if (!Number.isFinite(b.position.x + b.position.y + b.position.z)) bad++;
  }
  console.log(`  60 bodies x 720 steps in ${simMs.toFixed(1)} ms (${(simMs / 720).toFixed(3)} ms/step)`);
  ok(bad === 0, 'no NaN bodies');
  ok(below === 0, 'nothing fell through the floor', `${below} below`);
  ok(asleep >= 57, 'debris goes to sleep', `${asleep}/60 asleep`);
  ok(simMs / 720 < 0.5, 'rigid body step is cheap', `${(simMs / 720).toFixed(3)} ms`);

  // fast projectile must not tunnel
  const fast = phys.addRigidBody({
    shape: 'sphere', radius: 0.02, mass: 0.01,
    position: { x: 0, y: 2, z: 0 }, velocity: { x: 300, y: 0, z: 0 },
  });
  for (let i = 0; i < 30; i++) phys.bodies.step(1 / 120);
  ok(fast.position.x < 5.2, 'fast sphere does not tunnel the wall', `x=${fast.position.x.toFixed(2)}`);
  for (const b of bodies) phys.removeRigidBody(b);
  phys.removeRigidBody(fast);
}

/* ---------------- ragdolls ---------------- */
section('Ragdolls');
{
  const m = new THREE.Matrix4().makeTranslation(0, 1.2, -12);
  const rd = phys.createRagdoll({ transform: m, height: 1.82, mass: 84 });
  rd.setVelocity(1.5, 0.5, -2.0);
  const restLen = Float32Array.from(rd.boneLen);

  const tC = performance.now();
  for (let i = 0; i < 900; i++) rd.step(1 / 120); // 7.5 s
  const rdMs = performance.now() - tC;

  let bad = 0, maxStretch = 0, lowest = Infinity, highest = -Infinity;
  for (let i = 0; i < rd.boneCount; i++) {
    const a = rd.boneHead[i], c = rd.boneTail[i];
    const l = Math.hypot(rd.px[c] - rd.px[a], rd.py[c] - rd.py[a], rd.pz[c] - rd.pz[a]);
    if (!Number.isFinite(l)) bad++;
    maxStretch = Math.max(maxStretch, Math.abs(l - restLen[i]) / restLen[i]);
  }
  for (let i = 0; i < rd.particleCount; i++) {
    if (!Number.isFinite(rd.px[i] + rd.py[i] + rd.pz[i])) bad++;
    lowest = Math.min(lowest, rd.py[i]);
    highest = Math.max(highest, rd.py[i]);
  }
  // residual motion after settling
  let motion = 0;
  for (let i = 0; i < rd.particleCount; i++) {
    motion += Math.hypot(rd.px[i] - rd.qx[i], rd.py[i] - rd.qy[i], rd.pz[i] - rd.qz[i]);
  }
  motion /= rd.particleCount;

  console.log(`  ${rd.boneCount} bones, 900 steps in ${rdMs.toFixed(1)} ms (${(rdMs / 900).toFixed(3)} ms/step)`);
  ok(bad === 0, 'ragdoll stays finite');
  ok(maxStretch < 0.06, 'bone lengths preserved', `max stretch ${(maxStretch * 100).toFixed(2)}%`);
  ok(lowest > -0.12, 'no bone sank through the floor', `lowest y=${lowest.toFixed(3)}`);
  ok(highest < 1.4, 'body collapsed instead of exploding', `highest y=${highest.toFixed(3)}`);
  ok(rd.sleeping || motion < 2e-3, 'settles rather than jitters',
    `${rd.sleeping ? 'asleep' : 'motion ' + motion.toExponential(2)}`);
  ok(rdMs / 900 < 0.6, 'ragdoll step is cheap', `${(rdMs / 900).toFixed(3)} ms`);

  // shooting a corpse: aim straight down the middle of the settled chest bone
  const cap = rd.getBoneCapsule(2, { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 });
  const cx = (cap.ax + cap.bx) * 0.5;
  const cy = (cap.ay + cap.by) * 0.5;
  const cz = (cap.az + cap.bz) * 0.5;
  const h = phys.raycast(cx + 6, cy, cz, -1, 0, 0, 20, MASK.BULLET);
  ok(h.hit && h.ragdoll === rd, 'ragdoll bones are raycastable',
    `part=${h.part} at (${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)})`);
  const missed = phys.raycast(cx + 6, cy + 3, cz, -1, 0, 0, 20, MASK.BULLET);
  ok(!missed.ragdoll, 'a ray over the corpse does not hit it');
  phys.removeRagdoll(rd);
}

/* ---------------- dynamic colliders ---------------- */
section('Hitbox colliders');
{
  const actor = { id: 'enemy1' };
  const head = phys.addCollider({
    shape: 'sphere', radius: 0.12, layer: LAYER.ACTOR, surface: 'flesh',
    owner: actor, part: 'head', damageScale: 3,
  });
  head.setSphere(2, 1.65, 0, 0.12);
  const torso = phys.addCollider({
    shape: 'capsule', radius: 0.22, layer: LAYER.ACTOR, surface: 'flesh',
    owner: actor, part: 'chest',
  });
  torso.setSegment(2, 1.0, 0, 2, 1.45, 0);

  const hs = phys.raycast(0, 1.65, 0, 1, 0, 0, 10, MASK.BULLET);
  ok(hs.hit && hs.part === 'head', 'headshot resolves to the head collider', `${hs.part}`);
  const body = phys.raycast(0, 1.2, 0, 1, 0, 0, 10, MASK.BULLET);
  ok(body.hit && body.part === 'chest', 'torso shot resolves to the chest collider', `${body.part}`);
  const behind = phys.raycast(0, 1.65, 0, 1, 0, 0, 10, MASK.WORLD);
  ok(behind.hit && behind.part === null, 'WORLD mask ignores actor hitboxes');

  // The round penetrates the head and then strikes the torso behind it, so we
  // only assert on the first damage event.
  let dealt = null;
  const offD = events.on('damage:dealt', (e) => {
    if (!dealt) dealt = { target: e.target, headshot: e.headshot, amount: e.amount };
  });
  phys.fireBullet({ origin: { x: 0, y: 1.65, z: 0 }, dir: { x: 1, y: 0, z: 0 }, damage: 30, penetration: 1 });
  ok(dealt && dealt.headshot === true && dealt.target === actor,
    'damage:dealt emitted with headshot flag',
    dealt ? `amount=${dealt.amount.toFixed(1)} (x3 head multiplier)` : 'no event');
  offD();
  phys.removeCollider(head);
  phys.removeCollider(torso);
}

/* ---------------- debug view ---------------- */
section('Debug view');
{
  const { PhysicsDebugView } = await import('./debug.js');
  const view = new PhysicsDebugView(new THREE.Scene());
  view.setEnabled(true);
  view.begin();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, 3),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6),
    new THREE.Vector3(1, 1, 1)
  );
  view.obb(m, 0.5, 0.25, 0.75);
  ok(view._v === 24, 'obb emits 12 edges', `${view._v / 2} lines`);
  // every edge length must match one of the three box dimensions
  let good = 0;
  for (let i = 0; i < view._v; i += 2) {
    const a = i * 3, b = (i + 1) * 3;
    const p = view.positions;
    const len = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    if (Math.abs(len - 1.0) < 1e-4 || Math.abs(len - 0.5) < 1e-4 || Math.abs(len - 1.5) < 1e-4) good++;
  }
  ok(good === 12, 'obb edge lengths match the half-extents', `${good}/12`);
  view.begin();
  view.capsule(0, 1, 0, 0, 2, 0, 0.3, [1, 1, 1]);
  ok(view._v > 40 && view._v < 400, 'capsule wireframe is bounded', `${view._v} verts`);
  view.rebuild(phys, new THREE.PerspectiveCamera(), 1 / 60);
  ok(view._v > 0 && view.geometry.drawRange.count === view._v, 'rebuild sets the draw range');
  view.dispose();
}

/* ---------------- determinism ---------------- */
section('Determinism');
{
  const run = (seed) => {
    const p = new PhysicsSystem();
    p.ctx = { events: new EventBus(), scene: null, camera: null, time: { alpha: 0 }, rng: new Rng(seed) };
    p.rng = new Rng(seed);
    p.ballistics.rng = p.rng;
    buildLevel(p);
    const r = new Rng(seed);
    const bodies = [];
    for (let i = 0; i < 20; i++) {
      bodies.push(p.spawnDebris(
        { x: r.range(-2, 2), y: r.range(2, 4), z: r.range(-2, 2) },
        { x: r.signed() * 3, y: 1, z: r.signed() * 3 },
        { size: 0.1, lifetime: 999 }
      ));
    }
    const rd = p.createRagdoll({
      transform: new THREE.Matrix4().makeTranslation(1, 1.4, 1), height: 1.8,
    });
    rd.setVelocity(2, 0, 1);
    for (let i = 0; i < 400; i++) {
      p.bodies.step(1 / 120);
      rd.step(1 / 120);
    }
    let acc = 0;
    for (const b of bodies) acc += b.position.x + b.position.y * 3 + b.position.z * 7;
    for (let i = 0; i < rd.particleCount; i++) acc += rd.px[i] + rd.py[i] * 3 + rd.pz[i] * 7;
    return acc;
  };
  const a = run(1234);
  const b = run(1234);
  const c = run(4321);
  ok(a === b, 'same seed -> bit-identical state', `${a}`);
  ok(a !== c, 'different seed -> different state');
}

/* ------------------------------------------------------------------ */

console.log(`\n${failures === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m  ${checks - failures}/${checks} checks`);
process.exitCode = failures === 0 ? 0 : 1;

/** Reference implementation for cross-checking the BVH. */
function bruteRay(W, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  const pos = W.pos;
  for (let t = 0; t < W.triCount; t++) {
    const p = t * 9;
    const hit = mt(ox, oy, oz, dx, dy, dz,
      pos[p], pos[p + 1], pos[p + 2],
      pos[p + 3], pos[p + 4], pos[p + 5],
      pos[p + 6], pos[p + 7], pos[p + 8]);
    if (hit >= 0 && hit < best) best = hit;
  }
  return best >= maxDist ? Infinity : best;
}

function mt(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1.000001) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1.000001) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
