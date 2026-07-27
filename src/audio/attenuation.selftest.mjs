/**
 * AUDIO / ATTENUATION ROUTING self-test.
 *
 * `attenuation()` is flat at exactly 1.0 inside REF (2 m) — the standard
 * inverse-distance near field, and deliberate: gain must not run away as a
 * source approaches the head. The consequence is that the *routing* decision
 * carries the whole burden for anything close to the listener:
 *
 *   - A source rigidly attached to the listener must NOT go through a 3D
 *     emitter. It would get maximum gain, HRTF panning that encodes nothing,
 *     and a pooled emitter that can be stolen mid-firefight.
 *   - A source out in the world must NOT reach the dry path. `_playDry` applies
 *     no distance law at all, so a reload that forgot its position is as loud
 *     from 60 m as from arm's reach.
 *
 * Both failures are silent in a screenshot and inaudible in a build that is
 * merely "working", which is why they are pinned here rather than left to ears.
 *
 *   node src/audio/attenuation.selftest.mjs
 */

import * as THREE from 'three';
import { SpatialField } from './spatial.js';
import { AudioSystem } from './index.js';
import { AiSystem } from '../ai/index.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`!! ${msg}`); };
const ok = (msg) => console.log(`   ${msg}`);
const check = (name, cond, detail) => (cond ? ok : fail)(`${name} — ${detail}`);

/** attenuation() touches no instance state, so it runs unbound. */
const atten = (d) => SpatialField.prototype.attenuation.call(null, d);

/**
 * A real AudioSystem with the graph replaced by a recorder. Every handler under
 * test reads only `running`, `field`, `_budget`, `ctx` and `rng`, so nothing
 * here needs an AudioContext.
 */
function makeAudio(listener = { x: 0, y: 1.6, z: 0 }) {
  const a = new AudioSystem();
  a.running = true;
  a.calls = [];
  a.field = {
    listenerPos: listener,
    distanceTo: (x, y, z) => Math.hypot(x - listener.x, y - listener.y, z - listener.z),
  };
  a.ctx = { peek: () => null };
  a.rng = { range: (lo, hi) => (lo + hi) / 2, float: () => 0.5, u32: () => 7, int: (lo) => lo, pick: (xs) => xs[0] };
  a._playAt = (kind, x, y, z, o = {}) => { a.calls.push({ path: 'spatial', kind, x, y, z, o }); return true; };
  a._playDry = (kind, o = {}) => { a.calls.push({ path: 'dry', kind, o }); return true; };
  a.reset = () => {
    a.calls.length = 0;
    for (const k of Object.keys(a._budget)) a._budget[k] = 0;
  };
  return a;
}

console.log('\n=== the near field really is flat (the fact that motivates all of this) ===');
{
  const flat = [0, 0.3, 0.8, 1.6, 2.0];
  const vals = flat.map(atten);
  check('near field', vals.every((v) => v === 1), `${flat.join('/')} m all return exactly ${vals[0]}`);
  check('slopes past REF', atten(3) < 1 && atten(10) < atten(3),
    `3 m ${atten(3).toFixed(3)} < 1.0, 10 m ${atten(10).toFixed(3)} < 3 m`);
  check('a step-distance source', Math.abs(atten(1.6) - atten(0.3)) < 1e-9,
    'boots at 1.6 m are indistinguishable from a source at 0.3 m');
}

console.log('\n=== the local landing never takes a 3D emitter ===');
{
  const a = makeAudio();
  for (const v of [0, 3, 4, 7, 12, 40]) {
    a.reset();
    a._onLand({ velocity: -v, surface: 'concrete' });
    const spatial = a.calls.filter((c) => c.path === 'spatial');
    check(`land v=${v}`, spatial.length === 0,
      `${a.calls.length} voice(s), ${spatial.length} spatialised`);
  }
}

console.log('\n=== landing levels stay on the calibrated scale ===');
{
  const a = makeAudio();
  const levelAt = (v) => {
    a.reset();
    a._onLand({ velocity: -v });
    return a.calls.find((c) => c.kind === 'step').o.level;
  };
  const soft = levelAt(0.5), hard = levelAt(7), absurd = levelAt(400);
  // 0.72 was the effective level of your own boots through the old emitter path,
  // and was judged loud enough to drown the mix. Nothing head-locked may exceed it.
  check('ceiling', absurd <= 0.72, `a 400 m/s impact still caps at ${absurd.toFixed(3)} <= 0.72`);
  check('no runaway', hard === absurd, `v=7 and v=400 both clamp to ${hard.toFixed(3)}`);
  check('floor', soft >= 0.34, `the gentlest landing is ${soft.toFixed(3)}, at or above a walking step`);
  check('ordered', soft < hard, `soft ${soft.toFixed(3)} < hard ${hard.toFixed(3)}`);
  check('under the old peak', hard < 1.7,
    `hard landing ${hard.toFixed(3)} vs the 1.7 the emitter path could reach`);
}

console.log('\n=== a shell with no position makes no sound at all ===');
{
  const a = makeAudio();
  for (const p of [{}, { position: null }, { position: { x: 0, y: NaN, z: 0 } }]) {
    a.reset();
    a._onShell(p);
    check('malformed shell', a.calls.length === 0,
      `${JSON.stringify(p)} -> ${a.calls.length} voice(s) (must not land on the listener)`);
  }
  a.reset();
  a._onShell({ position: { x: 0.4, y: 1.4, z: -0.3 } });
  check('real shell', a.calls.length === 1 && a.calls[0].path === 'spatial',
    `own brass still spatialised (${a.calls[0]?.path})`);
}

console.log('\n=== a reload out in the world is spatialised, not head-locked ===');
{
  const a = makeAudio();
  a.reset();
  a._onReload({ weapon: 'ai_rifle', phase: 'start', position: { x: 40, y: 1.1, z: -25 } });
  check('bot reload', a.calls[0]?.path === 'spatial',
    `a reload 47 m out took the ${a.calls[0]?.path} path`);

  // The local player's own reload has no position and must stay dry.
  a.reset();
  a._onReload({ weapon: 'rifle', phase: 'magout' });
  check('own reload', a.calls[0]?.path === 'dry',
    `the local reload took the ${a.calls[0]?.path} path`);
}

console.log('\n=== ai actually puts a position on the wire ===');
{
  const emitted = [];
  const fake = {
    ctx: { events: { emit: (name, p) => emitted.push({ name, ...p, position: { ...p.position } }) } },
    _reloadEvent: {
      weapon: 'ai_rifle', phase: 'start', actor: null, position: new THREE.Vector3(),
    },
  };
  const agent = { position: new THREE.Vector3(12, 0.5, -30) };
  AiSystem.prototype.emitReload.call(fake, agent);
  const e = emitted[0];
  check('event name', e?.name === 'weapon:reload', `emitted ${e?.name}`);
  check('carries a position',
    !!e && Number.isFinite(e.position.x + e.position.y + e.position.z),
    `position ${e ? `${e.position.x}/${e.position.y}/${e.position.z}` : 'missing'}`);
  check('tracks the agent',
    e?.position.x === 12 && e?.position.z === -30 && e.position.y > agent.position.y,
    'at the agent, lifted to hand height');

  // Preallocated: a second reload must reuse the same object, not allocate.
  const before = fake._reloadEvent;
  AiSystem.prototype.emitReload.call(fake, { position: new THREE.Vector3(1, 0, 2) });
  check('no per-call allocation', fake._reloadEvent === before, 'reload payload is reused');
}

console.log(`\nATTENUATION SELFTEST: ${failures ? `FAIL (${failures})` : 'PASS'}\n`);
process.exit(failures ? 1 : 0);
