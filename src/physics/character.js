/**
 * Swept-capsule character controller — collide and slide.
 *
 * The controller is kinematic: `player` (or `ai`) sets a desired displacement
 * each fixed step and we resolve it against the static BVH. Nothing here
 * integrates forces; velocity is owned by the caller and only *clipped* by us,
 * so the movement state machine keeps full authority over feel.
 *
 * Resolution per move():
 *   1. depenetrate  — push out of anything we are already inside
 *   2. lift         — grounded moves raise the capsule by stepHeight first, so
 *                     a stair tread is simply invisible to the horizontal sweep
 *   3. slide        — up to N swept sweeps, clipping the remaining motion
 *                     against every plane we touch (Quake-style plane stack so
 *                     creases don't launch or trap the player)
 *   4. drop         — come back down by the lift plus gravity plus the stair
 *                     descent snap, refusing to cling to unwalkable faces
 *   5. ground probe — publish grounded / normal / surface for this frame
 *
 * The sweep is a true continuous test (see StaticWorld.sweepCapsule), so there
 * is no tunnelling regardless of speed — a 300 m/s displacement resolves
 * correctly in one step.
 */

import { makeHitRecord } from './math.js';
import { MASK, SURFACE_PROPS, surfaceName } from './surfaces.js';

const MAX_PLANES = 5;
const SKIN = 0.008;
/** probeGround()'s narrow trace, as a fraction of the radius. */
const PROBE_THIN = 0.6;

export class CharacterController {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = opts.id ?? 'character';
    this.owner = opts.owner ?? null;

    this.radius = opts.radius ?? 0.32;
    this.height = opts.height ?? 1.78; // total capsule height, feet to crown
    this.stepHeight = opts.stepHeight ?? 0.42;
    this.slopeLimit = opts.slopeLimit ?? 50 * (Math.PI / 180);
    this.snapDistance = opts.snapDistance ?? 0.32;
    this.mask = opts.mask ?? MASK.CHARACTER;
    this.maxIterations = opts.maxIterations ?? 5;

    /** Feet position (bottom of the capsule), the authoritative transform. */
    this.position = { x: 0, y: 0, z: 0 };
    /** Velocity is owned by the caller; move() clips it against contacts. */
    this.velocity = { x: 0, y: 0, z: 0 };

    this.grounded = false;
    this.wasGrounded = false;
    this.groundNormal = { x: 0, y: 1, z: 0 };
    this.groundSurface = 0;
    this.groundDistance = 0;
    this.groundObject = -1;
    this.onSteepSlope = false;
    this.touchingCeiling = false;
    this.touchingWall = false;
    this.wallNormal = { x: 0, y: 0, z: 0 };
    this.lastMoveBlocked = false;
    this.steppedUp = 0;
    /** Impact speed along the ground normal on the frame we landed. */
    this.landingSpeed = 0;
    this.enabled = true;

    // preallocated scratch
    this._hit = makeHitRecord();
    this._hit2 = makeHitRecord();
    this._planes = new Float32Array(MAX_PLANES * 3);
    this._planeCount = 0;
    this._startPos = { x: 0, y: 0, z: 0 };

    if (opts.position) this.setPosition(opts.position.x, opts.position.y, opts.position.z);
  }

  get cosSlope() {
    return Math.cos(this.slopeLimit);
  }

  /** Lower sphere centre of the capsule. */
  get p0y() {
    return this.position.y + this.radius;
  }
  /** Upper sphere centre of the capsule. */
  get p1y() {
    return this.position.y + this.height - this.radius;
  }

  setPosition(x, y, z) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
  }

  /** Teleport: clears contact state and de-penetrates at the destination. */
  teleport(x, y, z) {
    this.setPosition(x, y, z);
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.grounded = false;
    this.touchingCeiling = false;
    this.touchingWall = false;
    this.depenetrate(8);
    this.probeGround();
  }

  /**
   * Change capsule height keeping the feet planted. Returns false if standing
   * up is blocked by a ceiling (caller stays crouched).
   */
  setHeight(h, force = false) {
    if (h > this.height && !force && !this.canFit(h)) return false;
    this.height = h;
    return true;
  }

  /** Would a capsule of `h` metres fit at the current feet position? */
  canFit(h) {
    const r = this.radius;
    const p0y = this.position.y + r;
    const p1y = this.position.y + h - r;
    if (p1y < p0y) return true;
    const n = this.world.overlapCapsule(
      this.position.x, p0y, this.position.z,
      this.position.x, p1y, this.position.z,
      r - 0.01, this.mask, 0
    );
    return n === 0;
  }

  /**
   * Resolve a displacement. `dx/dy/dz` are metres for this step (the caller has
   * already multiplied by dt). Returns the distance actually travelled.
   *
   * Grounded moves use the step-offset scheme: lift the capsule by stepHeight,
   * slide horizontally, then drop back down. A tread shorter than stepHeight is
   * simply invisible to the horizontal sweep, which is the only way to make
   * stairs work with a capsule — its bottom hemisphere always meets a stair
   * nose at a shallow angle, so a "detect the wall then retry higher" scheme
   * never gets enough forward travel in one 8 ms step to clear the nose.
   */
  move(dx, dy, dz) {
    if (!this.enabled) return 0;
    const st = this._startPos;
    st.x = this.position.x; st.y = this.position.y; st.z = this.position.z;
    this.wasGrounded = this.grounded;
    this.touchingCeiling = false;
    this.touchingWall = false;
    this.lastMoveBlocked = false;
    this.steppedUp = 0;

    this.depenetrate(4);

    const jumping = dy > 1e-6;
    const useStepOffset =
      this.wasGrounded && !jumping && this.stepHeight > 1e-4 &&
      (dx * dx + dz * dz) > 1e-10;

    if (!useStepOffset) {
      this._slide(dx, dy, dz);
    } else {
      // 1. lift — a low ceiling shortens the lift automatically
      const lift = this._sweepMove(0, this.stepHeight, 0);
      // 2. horizontal
      this._slide(dx, 0, dz);
      // 3. drop back down, plus this step's gravity, plus the stair-descent snap
      const want = lift + Math.max(0, -dy);
      const snap = this.snapDistance;
      const yBefore = this.position.y;
      const dropped = this._sweepDown(want + snap);
      if (dropped < 0) {
        // Nothing under us: fall exactly what was asked, no more.
        this.position.y = yBefore - want;
      } else if (this._hit2.ny < this.cosSlope) {
        // Resting on something steep. Either a cliff face, which we must not
        // cling to, or a stair nose: one we are rolling off (past ~3/4 of the
        // radius its normal fails the slope test) or one we are stepping up
        // onto. The probe's thin trace tells them apart — it passes a convex
        // edge but not a face, so a tread under the capsule means a stair.
        //
        // On a stair, ride the nose while probeGround() can see it, and settle
        // onto the tread with the thin trace once it cannot: in the last few
        // millimetres of the rim, which neither of its traces reaches. Both of
        // the old outcomes read the frame as airborne. Down a flight, the
        // cliff rule made every nose a ballistic hop and a landing (2 m of
        // flight off the top of a 43 deg flight at a walk, landing hard enough
        // to hurt at a sprint). Up one, the rim left the air branch a plain
        // slide into the nose that clipped the speed away and the velocity
        // upward, then a fall back and a landing: a stall and a hop on every
        // few 0.4 m altars. depenetrate() gives back the overlap with the nose.
        const yRest = this.position.y;
        this.position.y = yBefore;
        const tread = this._sweepDown(want + snap, PROBE_THIN) >= 0 && this._hit2.ny >= this.cosSlope;
        if (!tread) {
          this.position.y = dropped > want ? yBefore - want : yRest;
        } else {
          const yTread = this.position.y;
          this.position.y = yRest;
          if (!this.probeGround()) this.position.y = yTread;
        }
      }
      const gained = this.position.y - st.y;
      if (gained > 1e-4) this.steppedUp = gained;
    }

    this.depenetrate(3);
    this.probeGround();

    if (this.grounded && !this.wasGrounded) {
      this.landingSpeed = -Math.min(0, this.velocity.y);
    }

    return Math.hypot(this.position.x - st.x, this.position.y - st.y, this.position.z - st.z);
  }

  /** Collide-and-slide core. Returns true if any plane stopped us. */
  _slide(dx, dy, dz) {
    const planes = this._planes;
    let planeCount = 0;
    let blocked = false;

    for (let iter = 0; iter < this.maxIterations; iter++) {
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-6) break;
      const inv = 1 / dist;
      const ux = dx * inv, uy = dy * inv, uz = dz * inv;

      const hit = this._hit;
      const r = this.radius;
      const ok = this.world.sweepCapsule(
        this.position.x, this.p0y, this.position.z,
        this.position.x, this.p1y, this.position.z,
        r, ux, uy, uz, dist + SKIN, this.mask, hit
      );

      if (!ok) {
        this.position.x += dx;
        this.position.y += dy;
        this.position.z += dz;
        break;
      }

      blocked = true;
      const advance = Math.max(0, Math.min(hit.t - SKIN, dist));
      this.position.x += ux * advance;
      this.position.y += uy * advance;
      this.position.z += uz * advance;

      // remaining motion
      const rem = dist - advance;
      dx = ux * rem; dy = uy * rem; dz = uz * rem;

      const nx = hit.nx, ny = hit.ny, nz = hit.nz;
      this._classifyContact(nx, ny, nz, hit);
      // Note: steep contacts keep their vertical component on purpose. Zeroing
      // it (the usual "don't ramp up cliffs" hack) turns every stair nose into
      // a wall, because the bottom hemisphere always meets a step edge at a
      // shallow angle. Unwalkable surfaces are handled where they should be —
      // probeGround() reports grounded = false, so the caller keeps applying
      // gravity and the character slides straight back down.

      if (planeCount >= MAX_PLANES) break;
      planes[planeCount * 3] = nx;
      planes[planeCount * 3 + 1] = ny;
      planes[planeCount * 3 + 2] = nz;
      planeCount++;

      // Clip against every plane collected so far; if a single-plane projection
      // still violates another plane, slide along the crease of the two.
      let cx = dx, cy = dy, cz = dz;
      let resolved = false;
      for (let i = 0; i < planeCount && !resolved; i++) {
        const px = planes[i * 3], py = planes[i * 3 + 1], pz = planes[i * 3 + 2];
        if (dx * px + dy * py + dz * pz >= 0) continue;
        let tx = dx, ty = dy, tz = dz;
        const into = tx * px + ty * py + tz * pz;
        tx -= px * into; ty -= py * into; tz -= pz * into;
        let violates = -1;
        for (let j = 0; j < planeCount; j++) {
          if (j === i) continue;
          const qx = planes[j * 3], qy = planes[j * 3 + 1], qz = planes[j * 3 + 2];
          if (tx * qx + ty * qy + tz * qz < 0) { violates = j; break; }
        }
        if (violates < 0) {
          cx = tx; cy = ty; cz = tz;
          resolved = true;
        } else {
          // crease: travel along the intersection of the two planes
          const qx = planes[violates * 3], qy = planes[violates * 3 + 1], qz = planes[violates * 3 + 2];
          let ex = py * qz - pz * qy;
          let ey = pz * qx - px * qz;
          let ez = px * qy - py * qx;
          const el = Math.hypot(ex, ey, ez);
          if (el < 1e-6) { cx = cy = cz = 0; resolved = true; break; }
          ex /= el; ey /= el; ez /= el;
          const along = dx * ex + dy * ey + dz * ez;
          cx = ex * along; cy = ey * along; cz = ez * along;
          // Reject if the crease direction is blocked by a third plane.
          let bad = false;
          for (let j = 0; j < planeCount; j++) {
            const rx = planes[j * 3], ry = planes[j * 3 + 1], rz = planes[j * 3 + 2];
            if (cx * rx + cy * ry + cz * rz < -1e-6) { bad = true; break; }
          }
          if (bad) { cx = cy = cz = 0; }
          resolved = true;
        }
      }
      dx = cx; dy = cy; dz = cz;

      // Clip the caller's velocity the same way so accumulated speed doesn't
      // survive a wall impact.
      this._clipVelocity(nx, ny, nz);

      if (dx * dx + dy * dy + dz * dz < 1e-12) break;
    }
    this._planeCount = planeCount;
    this.lastMoveBlocked = blocked;
    return blocked;
  }

  _classifyContact(nx, ny, nz, hit) {
    if (ny >= this.cosSlope) {
      this.grounded = true;
      this.groundNormal.x = nx; this.groundNormal.y = ny; this.groundNormal.z = nz;
      this.groundSurface = hit.surface;
      this.groundObject = hit.object;
      this.onSteepSlope = false;
    } else if (ny < -0.5) {
      this.touchingCeiling = true;
    } else {
      this.touchingWall = true;
      this.wallNormal.x = nx; this.wallNormal.y = ny; this.wallNormal.z = nz;
      if (ny > 0.05) this.onSteepSlope = true;
    }
  }

  _clipVelocity(nx, ny, nz) {
    const v = this.velocity;
    const into = v.x * nx + v.y * ny + v.z * nz;
    if (into < 0) {
      v.x -= nx * into;
      v.y -= ny * into;
      v.z -= nz * into;
    }
  }

  /** Single swept translation with no sliding. Returns distance travelled. */
  _sweepMove(dx, dy, dz) {
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-7) return 0;
    const inv = 1 / dist;
    const ux = dx * inv, uy = dy * inv, uz = dz * inv;
    const hit = this._hit2;
    const ok = this.world.sweepCapsule(
      this.position.x, this.p0y, this.position.z,
      this.position.x, this.p1y, this.position.z,
      this.radius, ux, uy, uz, dist + SKIN, this.mask, hit
    );
    const adv = ok ? Math.max(0, Math.min(hit.t - SKIN, dist)) : dist;
    this.position.x += ux * adv;
    this.position.y += uy * adv;
    this.position.z += uz * adv;
    return adv;
  }

  /**
   * Sweep straight down up to `dist`. Returns the drop distance, or -1 if
   * nothing was hit (the capsule is then left where it started).
   * `radiusScale` shrinks the capsule for the trace — the step-up drop uses a
   * thinner probe so the bottom hemisphere settles onto a step tread instead of
   * hanging on its nose.
   */
  _sweepDown(dist, radiusScale = 1) {
    const hit = this._hit2;
    const r = this.radius * radiusScale;
    const ok = this.world.sweepCapsule(
      this.position.x, this.position.y + r, this.position.z,
      this.position.x, this.position.y + this.height - r, this.position.z,
      r, 0, -1, 0, dist + SKIN, this.mask, hit
    );
    if (!ok) return -1;
    const adv = Math.max(0, Math.min(hit.t - SKIN, dist));
    this.position.y -= adv;
    return adv;
  }

  /** Push the capsule out of anything it currently overlaps. */
  depenetrate(iterations = 4) {
    const w = this.world;
    let moved = 0;
    for (let it = 0; it < iterations; it++) {
      const n = w.overlapCapsule(
        this.position.x, this.p0y, this.position.z,
        this.position.x, this.p1y, this.position.z,
        this.radius, this.mask, 0
      );
      if (n === 0) break;
      const c = w.contacts;
      // Accumulate the maximum push along each distinct normal rather than the
      // sum — summing over a tessellated wall ejects the capsule across the map.
      let px = 0, py = 0, pz = 0;
      for (let i = 0; i < n; i++) {
        const d = c.depth[i];
        if (d <= 1e-5) continue;
        const nx = c.nx[i], ny = c.ny[i], nz = c.nz[i];
        const already = px * nx + py * ny + pz * nz;
        const extra = d - already;
        if (extra > 0) {
          px += nx * extra;
          py += ny * extra;
          pz += nz * extra;
        }
      }
      const l = Math.hypot(px, py, pz);
      if (l < 1e-5) break;
      // Damp so a bad contact set can never fling the character.
      const maxPush = 0.25;
      const s = l > maxPush ? maxPush / l : 1;
      this.position.x += px * s;
      this.position.y += py * s;
      this.position.z += pz * s;
      moved += l * s;
      if (l < 1e-4) break;
    }
    return moved;
  }

  /**
   * Short downward sweep that publishes grounded state for this frame.
   *
   * Two traces on purpose. The thin one (60 % radius) finds the floor while
   * ignoring convex edges — without it, a character riding up a stair nose is
   * reported airborne because the nose is the nearest thing below and its
   * normal is steeper than the slope limit. The wide one is the fallback for
   * standing on a narrow beam, where the thin trace would miss entirely.
   */
  probeGround() {
    const probe = 0.06;
    const cos = this.cosSlope;
    const hit = this._hit;
    const w = this.world;

    const thin = w.sweepCapsule(
      this.position.x, this.position.y + this.radius * PROBE_THIN, this.position.z,
      this.position.x, this.position.y + this.height - this.radius * PROBE_THIN, this.position.z,
      this.radius * PROBE_THIN, 0, -1, 0, probe, this.mask, hit
    );

    let found = thin && hit.ny >= cos;
    if (!found) {
      const wide = w.sweepCapsule(
        this.position.x, this.p0y, this.position.z,
        this.position.x, this.p1y, this.position.z,
        this.radius * 0.98, 0, -1, 0, probe, this.mask, hit
      );
      // A surface with any meaningful upward component supports us even if it
      // is too steep to be "walkable" — that is what a stair nose is.
      found = wide && hit.ny > 0.15;
    }

    if (found) {
      this.grounded = true;
      this.groundNormal.x = hit.nx;
      this.groundNormal.y = hit.ny;
      this.groundNormal.z = hit.nz;
      this.groundSurface = hit.surface;
      this.groundObject = hit.object;
      this.groundDistance = hit.t;
      this.onSteepSlope = hit.ny < cos;
    } else {
      this.grounded = false;
      this.groundDistance = hit.hit ? hit.t : Infinity;
      this.onSteepSlope = hit.hit && hit.ny > 0.05 && hit.ny < cos;
      if (hit.hit) {
        this.groundNormal.x = hit.nx;
        this.groundNormal.y = hit.ny;
        this.groundNormal.z = hit.nz;
        this.groundSurface = hit.surface;
      }
    }

    // Ceiling probe — the movement machine needs this to cancel a jump.
    const ch = this._hit2;
    this.touchingCeiling = this.world.sweepCapsule(
      this.position.x, this.p0y, this.position.z,
      this.position.x, this.p1y, this.position.z,
      this.radius * 0.98, 0, 1, 0, 0.06, this.mask, ch
    ) && ch.ny < -0.4;

    return this.grounded;
  }

  /** Friction coefficient of whatever we are standing on. */
  get groundFriction() {
    return SURFACE_PROPS[this.groundSurface]?.friction ?? 0.9;
  }

  get groundSurfaceName() {
    return surfaceName(this.groundSurface);
  }

  /**
   * Can the character stand here? Used by AI spawn placement and by `player`
   * before a mantle/vault commits.
   */
  checkCapsule(x, y, z, height = this.height) {
    return (
      this.world.overlapCapsule(
        x, y + this.radius, z,
        x, y + height - this.radius, z,
        this.radius - 0.005, this.mask, 0
      ) === 0
    );
  }
}
