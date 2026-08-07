import { P } from './atlas.js';
import { resetSpawn } from './particles.js';

/**
 * Tracers.
 *
 * A tracer is a burning pellet in the base of the round, so what you see is a
 * short, very bright, velocity-aligned streak that *travels* — the fact that it
 * takes time to cross the street is most of the read. Real muzzle velocity
 * (~900 m/s) crosses a 30 m street in 33 ms, i.e. two frames, so like every
 * shipped shooter we clamp the visual speed into a range that reads on screen
 * while keeping the departure and arrival times honest.
 *
 * Three sprites: a hot head, the streak core (HDR, blooms), and a longer, dimmer
 * afterglow behind it.
 *
 * THE SPEED CLAMP ALONE DOES NOT ACHIEVE THAT, and for most of a match it
 * achieved the opposite. Lifetime is `dist / v`, so with `v` pinned at
 * MAX_SPEED by every real muzzle velocity, RANGE alone decided how long a
 * streak existed — and inside ~34 m that is less time than the frame rate can
 * resolve. Measured in the FX rig at 12 m: the tracer existed for 35 ms, was
 * sampled at exactly two instants (n=0.47 and n=0.94), moved 5.6 m between
 * them — further than its own 4.9 m streak, so it never overlapped itself —
 * and contributed ZERO warm pixels to either frame. The same tracer at 60 m/s
 * measured 371. So the visual the whole file describes was, at the ranges
 * people actually fight at, not being drawn at all: what read as "tracers"
 * was the muzzle flash and the impact sparks either side of nothing.
 *
 * MIN_LIFE is the fix, and it is a floor on TIME rather than on speed because
 * time is what the frame rate spends. A short shot flies slower so it lasts
 * ~6 frames; a long shot is untouched, because `dist / MIN_LIFE` only falls
 * below MAX_SPEED under MAX_SPEED * MIN_LIFE = 34 m. Departure and arrival
 * stay honest at the ranges where they were ever legible.
 */

const MIN_SPEED = 55;
const MAX_SPEED = 340;
/** Seconds a streak must stay on screen — about six frames at 60 Hz. */
const MIN_LIFE = 0.1;

export function spawnTracer(fx, from, to, speed, opts) {
  const rng = fx.rng;
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.35) return;
  dx /= dist;
  dy /= dist;
  dz /= dist;
  // Slow enough to last MIN_LIFE, never faster than the round and never
  // outside the readable band. MIN_SPEED still wins on a point-blank shot —
  // a tracer that crawls reads as a firework, and over a couple of metres
  // there is no streak to follow anyway.
  const want = Math.min(speed || 260, dist / MIN_LIFE);
  const v = Math.min(MAX_SPEED, Math.max(MIN_SPEED, want));
  const life = dist / v;
  const warm = opts?.warm ?? 1;
  // Start a little out of the bore so the tracer is not born inside the flash.
  const ox = from.x + dx * 0.25;
  const oy = from.y + dy * 0.25;
  const oz = from.z + dz * 0.25;

  // core streak
  let s = resetSpawn();
  s.x = ox; s.y = oy; s.z = oz;
  s.vx = dx * v; s.vy = dy * v; s.vz = dz * v;
  s.tile = P.STREAK;
  s.size0 = 0.055;
  s.size1 = 0.04;
  s.stretch = 0.26;
  s.life = life;
  s.drag = 0.02;
  s.gravity = -1.2;
  s.r0 = 1; s.g0 = 0.52 * warm; s.b0 = 0.18 * warm; s.i0 = 26;
  s.r1 = 1; s.g1 = 0.4 * warm; s.b1 = 0.12 * warm; s.i1 = 16;
  s.alphaCurve = 0.25;
  s.soft = 0.1;
  s.seed = rng.float();
  fx.emitAdd(s);

  // afterglow: longer, dimmer, sits behind the core
  s = resetSpawn();
  s.x = ox; s.y = oy; s.z = oz;
  s.vx = dx * v; s.vy = dy * v; s.vz = dz * v;
  s.tile = P.STREAK;
  s.size0 = 0.09;
  s.size1 = 0.07;
  s.stretch = 0.6;
  s.life = life;
  s.drag = 0.02;
  s.gravity = -1.2;
  s.r0 = 1; s.g0 = 0.33 * warm; s.b0 = 0.1 * warm; s.i0 = 5.5;
  s.r1 = 1; s.g1 = 0.24 * warm; s.b1 = 0.06 * warm; s.i1 = 2.5;
  s.alphaCurve = 0.3;
  s.soft = 0.14;
  s.seed = rng.float();
  fx.emitAdd(s);

  // incandescent head
  s = resetSpawn();
  s.x = ox; s.y = oy; s.z = oz;
  s.vx = dx * v; s.vy = dy * v; s.vz = dz * v;
  s.tile = P.SPARK;
  s.size0 = 0.05;
  s.size1 = 0.042;
  s.life = life;
  s.drag = 0.02;
  s.gravity = -1.2;
  s.r0 = 1; s.g0 = 0.85; s.b0 = 0.6; s.i0 = 30;
  s.r1 = 1; s.g1 = 0.6; s.b1 = 0.3; s.i1 = 18;
  s.alphaCurve = 0.2;
  s.soft = 0.08;
  s.seed = rng.float();
  fx.emitAdd(s);
}
