/**
 * Headless verification for the spawn director.
 *
 *   node src/world/spawns.selftest.mjs
 *
 * A screenshot cannot show that a spawn point was inside somebody's line of
 * sight, or that two players deployed onto the same slab, or that a room of two
 * settled into a spawn loop — those are exactly the failures this system exists
 * to prevent, so they get checked here instead.
 *
 * The director takes its collision through callbacks (`los`) and its actors
 * through sources, so the whole thing runs against a stub map with no engine,
 * no renderer and no GPU.
 */

import * as THREE from 'three';
import {
  SPAWN_POINTS,
  SpawnDirector,
  buildSpawnPoints,
  standableAt,
  TUNING,
} from './spawns.js';

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

/* ────────────────────────────────────────────────────────────────────────── */
/* a stub map: the authored points, flat ground, no occluders unless asked     */
/* ────────────────────────────────────────────────────────────────────────── */

function makeDirector({ los = null, salt = 0 } = {}) {
  const points = buildSpawnPoints(SPAWN_POINTS, {
    toWorld: (x, y, z) => new THREE.Vector3(x, y, z), // identity: level == world
    groundY: () => 0,
    clear: () => true,
  });
  return { director: new SpawnDirector({ points, los, salt }), points };
}

/** A source that reports a fixed list of actors. */
function actorSource(list) {
  return (add) => {
    for (const a of list) add(a.x, a.y ?? 0, a.z, a.yaw ?? 0, a.team, a.id, a.dead);
  };
}

const dist = (p, a) => Math.hypot(p.position.x - a.x, p.position.z - a.z);

/* ────────────────────────────────────────────────────────────────────────── */

section('the authored table');
{
  const [x, z, yaw, zone] = SPAWN_POINTS[0];
  ok(
    x === 0.4 && z === 22.5 && yaw === Math.PI && zone === 'north-street',
    'point 0 is frozen',
    'capture baselines are framed from it'
  );

  const { points } = makeDirector();
  ok(points.length >= 30, `${points.length} points survive placement`, 'want a real spread, not 8');

  let offMap = 0;
  for (const p of points) if (!standableAt(p.lx, p.lz)) offMap++;
  ok(offMap <= 1, 'every point but the frozen one is on open ground', `${offMap} off-map`);

  // Zones are the unit crowding is reasoned about in: several, none enormous.
  const zones = new Map();
  for (const p of points) zones.set(p.zone, (zones.get(p.zone) ?? 0) + 1);
  ok(zones.size >= 8, `${zones.size} zones`, [...zones.keys()].join(' '));
  ok([...zones.values()].every((n) => n >= 2 && n <= 8), 'zones are 2-8 points each');

  // Spacing: points close enough to share a zone, far enough not to be one point.
  let tooClose = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = points[i].position.distanceTo(points[j].position);
      if (d < 3.5) tooClose++;
    }
  }
  ok(tooClose === 0, 'no two points within 3.5 m', `${tooClose} pairs`);
}

section('the hard bubble');
{
  const { director } = makeDirector();
  // One enemy parked in the middle of the market.
  const enemy = { x: 0, z: 5, team: 'red', id: 'e1' };
  director.addSource(actorSource([enemy]));

  let worst = Infinity;
  for (let i = 0; i < 40; i++) {
    const p = director.select({ team: 'blue', actorId: 'me' });
    worst = Math.min(worst, dist(p, enemy));
    director.update(1.0); // let the cooldowns age out between picks
  }
  ok(
    worst >= TUNING.hardMinEnemy,
    `never spawned inside ${TUNING.hardMinEnemy} m of a living enemy`,
    `closest ${worst.toFixed(1)} m`
  );
}

section('line of sight');
{
  // "Visible" = the enemy is within 30 m and the point is north of z = -20.
  // Crude on purpose: the director only needs a boolean back.
  const los = (ax, ay, az, bx, by, bz) =>
    Math.hypot(ax - bx, az - bz) < 30 && bz > -20;
  const { director } = makeDirector({ los });
  const enemy = { x: 0, z: 0, team: 'red', id: 'e1' };
  director.addSource(actorSource([enemy]));

  let seen = 0;
  let relaxed = 0;
  for (let i = 0; i < 30; i++) {
    const p = director.select({ team: 'blue', actorId: 'me' });
    if (los(enemy.x, 1.5, enemy.z, p.position.x, 1.2, p.position.z)) seen++;
    if (director.lastPick.relax > 0) relaxed++;
    director.update(1.0);
  }
  ok(seen === 0, 'never spawned in an enemy line of sight', `${seen}/30 visible`);
  // Half the map is visible here, which is more than one shortlist's worth: the
  // director has to walk past the rejected points rather than give up the rule.
  ok(relaxed === 0, 'and never had to relax the rule to do it', `${relaxed}/30 relaxed`);
}

section('facing');
{
  const { director } = makeDirector();
  // An enemy at the north end of the street looking south down it (the camera
  // convention: forward is (-sin yaw, -cos yaw), so yaw 0 looks toward -Z).
  director.addSource(actorSource([{ x: 0, z: 30, yaw: 0, team: 'red', id: 'e1' }]));
  let inFront = 0;
  for (let i = 0; i < 20; i++) {
    const p = director.select({ team: 'blue', actorId: 'me' });
    // Inside the cone == south of him and roughly on his axis.
    if (p.position.z < 30 && Math.abs(p.position.x) < 8 && p.position.z > 30 - TUNING.coneRange) {
      inFront++;
    }
    director.update(1.0);
  }
  ok(inFront === 0, 'stayed out of the enemy view cone', `${inFront}/20 in front`);
}

section('memory: cooldown, deaths, the killer');
{
  const { director } = makeDirector();
  director.addSource(actorSource([]));

  // Back-to-back picks with no time passing must not reuse the same point.
  const a = director.select({ team: 'blue', actorId: 'me' });
  const b = director.select({ team: 'blue', actorId: 'me' });
  const c = director.select({ team: 'blue', actorId: 'me' });
  ok(a !== b && b !== c && a !== c, 'three quick spawns are three different points');

  // A killer standing on the gate pushes the pick away from the gate.
  const killer = { x: 0, z: -42 };
  let near = 0;
  for (let i = 0; i < 20; i++) {
    const p = director.select({ team: 'blue', actorId: 'me', killer });
    if (Math.hypot(p.position.x - killer.x, p.position.z - killer.z) < 20) near++;
    director.update(1.0);
  }
  ok(near === 0, 'spawns away from the man who killed me', `${near}/20 within 20 m`);

  // A pile of deaths in the market makes the market unattractive.
  const fresh = makeDirector().director;
  fresh.addSource(actorSource([]));
  for (let i = 0; i < 6; i++) fresh.noteDeath(i * 0.5 - 1, 0, 5 + i * 0.5);
  let inMarket = 0;
  for (let i = 0; i < 20; i++) {
    const p = fresh.select({ team: 'blue', actorId: 'me' });
    if (p.zone === 'market') inMarket++;
    fresh.update(0.2); // deaths still warm
  }
  ok(inMarket <= 2, 'avoids ground people just died on', `${inMarket}/20 in the market`);

  // …and forgets about it once the memory has aged out.
  fresh.update(TUNING.deathMemory + 1);
  ok(fresh.stats.deaths === 0, 'death memory decays');
}

section('claims (two clients respawning on the same tick)');
{
  const { director } = makeDirector();
  director.addSource(actorSource([]));
  const mine = director.select({ team: 'p1', actorId: 'me' });
  // A remote client announces the same ground a frame later.
  director.noteClaim(mine.position.x, mine.position.y, mine.position.z);
  const theirs = director.select({ team: 'p2', actorId: 'other' });
  ok(
    theirs !== mine && theirs.position.distanceTo(mine.position) > 6,
    'a claimed point is not handed out twice',
    `${theirs.position.distanceTo(mine.position).toFixed(1)} m apart`
  );
}

section('deployment spread');
{
  const { director } = makeDirector();
  director.addSource(actorSource([]));
  const picked = director.selectMany(6, { team: 'ai' });
  ok(picked.length === 6, 'six deploy points');
  let worst = Infinity;
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      worst = Math.min(worst, picked[i].position.distanceTo(picked[j].position));
    }
  }
  ok(worst > 8, 'deploy points repel each other', `closest pair ${worst.toFixed(1)} m`);
  ok(new Set(picked).size === 6, 'no point used twice');
}

section('teams: friends pull, enemies push');
{
  const { director } = makeDirector();
  // Two friends holding the south street, one enemy in the north plaza.
  director.addSource(
    actorSource([
      { x: 2.6, z: -32, team: 'ai', id: 'f1' },
      { x: -3.8, z: -24, team: 'ai', id: 'f2' },
      { x: -2.4, z: 30, team: 'blue', id: 'e1' },
    ])
  );
  let nearFriends = 0;
  for (let i = 0; i < 12; i++) {
    const p = director.select({ team: 'ai', actorId: 'newbot' });
    if (p.position.z < -14) nearFriends++;
    director.update(1.0);
  }
  ok(nearFriends >= 8, 'reinforcements come in near their squad', `${nearFriends}/12 south`);
}

section('the fallback ladder');
{
  // A cordon: an enemy standing on top of every single spawn point. There is no
  // legal answer, and the director still has to produce one.
  const { director, points } = makeDirector();
  director.addSource(
    actorSource(
      points.map((p, i) => ({ x: p.position.x, z: p.position.z, team: 'red', id: `e${i}` }))
    )
  );
  const p = director.select({ team: 'blue', actorId: 'me' });
  ok(!!p, 'a contested map still produces a spawn');
  ok(director.lastPick.relax >= 1, 'and says it had to relax the rules', `relax ${director.lastPick?.relax}`);

  // A dead man is not a threat.
  const { director: d2 } = makeDirector();
  d2.addSource(actorSource([{ x: 0, z: 5, team: 'red', id: 'e1', dead: true }]));
  const q = d2.select({ team: 'blue', actorId: 'me' });
  ok(d2.lastPick.relax === 0, 'corpses do not block spawns', `zone ${q.zone}`);
}

section('determinism and per-client salt');
{
  const seq = (salt) => {
    const { director } = makeDirector({ salt });
    director.addSource(actorSource([{ x: 0, z: 5, team: 'red', id: 'e1' }]));
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push(director.select({ team: 'blue', actorId: 'me' }).index);
      director.update(1.0);
    }
    return out.join(',');
  };
  ok(seq(0) === seq(0), 'the same salt gives the same sequence', seq(0));
  ok(seq(1) !== seq(2), 'different clients break ties differently', `${seq(1)} vs ${seq(2)}`);

  // Two clients in the same room, deploying on the same frame, with each other
  // reported as live actors: they must not choose the same ground.
  const room = makeDirector();
  const clientA = new SpawnDirector({ points: room.points, salt: 11 });
  const clientB = new SpawnDirector({ points: room.points, salt: 27 });
  const a = clientA.select({ team: 'p11', actorId: 'me' });
  const b = clientB.select({ team: 'p27', actorId: 'me' });
  ok(
    a.position.distanceTo(b.position) > 6,
    'two clients deploying at once pick different ground',
    `${a.position.distanceTo(b.position).toFixed(1)} m apart`
  );
}

section('cost');
{
  const los = () => false;
  const { director } = makeDirector({ los });
  director.addSource(
    actorSource(
      Array.from({ length: 11 }, (_, i) => ({
        x: (i % 4) * 3 - 4, z: i * 4 - 20, team: `p${i}`, id: `e${i}`,
      }))
    )
  );
  const t0 = performance.now();
  const N = 500;
  for (let i = 0; i < N; i++) {
    director.select({ team: 'me', actorId: 'me' });
    director.update(0.016);
  }
  const ms = (performance.now() - t0) / N;
  ok(ms < 2, `a spawn costs ${ms.toFixed(3)} ms with a full room`, 'budget: 2 ms, and it is not per-frame');
}

console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
