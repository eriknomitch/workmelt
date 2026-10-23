import * as THREE from 'three';
import { el, setText, setStyle, clamp01 } from './util.js';

/**
 * Enemy nameplates — the red name that appears over a soldier's head when your
 * crosshair is on him.
 *
 * This is the Call of Duty rule, and every part of it is load-bearing:
 *
 *   • ENEMIES ARE NEVER LABELLED BY DEFAULT. A name hovering over every hostile
 *     head would be a wallhack: you would spot people by their tag rather than
 *     their silhouette. The name is a reward for having already found someone.
 *   • IT TAKES THE CROSSHAIR. Only the body under the reticle is named — the
 *     nearest one along the aim ray, so a soldier standing behind another one
 *     is not.
 *   • IT TAKES LINE OF SIGHT. A wall between you and the body suppresses the
 *     tag, so sweeping the reticle across a building never tells you who is
 *     inside it. Glass and foliage do not block (the SIGHT mask), the same as
 *     your eyes.
 *   • IT LINGERS, BRIEFLY. After the reticle leaves, the tag holds for HOLD
 *     seconds and then fades. Tracking a strafing target always leaves the
 *     crosshair edge for a frame or two; without the hold the name would
 *     strobe exactly while you are fighting him.
 *   • IT IS RED. In a free-for-all everyone is an enemy, and red is the enemy
 *     colour in every CoD HUD. The player's livery is carried in a small swatch
 *     beside the name, because in this game colour is identity.
 *   • THE RETICLE TURNS RED with it (`Crosshair.setEnemy`), which is the cue a
 *     CoD player actually reads first.
 *
 * The aim test and the fade are pure functions below so
 * `nameplates.selftest.mjs` can pin them in Node; the DOM class only projects
 * and paints.
 */

/** Past this, nobody is named — a 2-pixel figure does not need a label. */
export const MAX_RANGE = 80;
/** Nothing closer than this: you are inside his capsule, not aiming at him. */
export const MIN_RANGE = 0.4;
/** Half-width of the aim tube around a body's spine, in metres. */
export const BODY_RADIUS = 0.3;
/**
 * The tube widens with range by this angle, so a body at 60 m does not need
 * pixel-perfect aim to be named — at that range a soldier is ~15 px wide and
 * sway alone moves the reticle further than that. 0.6° adds 0.63 m at 60 m and
 * 5 cm at 5 m, so up close it is still the body itself that has to be covered.
 */
export const ASSIST_DEG = 0.6;
const ASSIST_TAN = Math.tan((ASSIST_DEG * Math.PI) / 180);
/** The spine runs from this far above the feet up to the top of the head. */
export const SPINE_BASE = 0.3;
/** Seconds a tag holds after the reticle leaves the body. */
export const HOLD = 0.5;
/** Fade rates, alpha per second. In fast enough to read as instant; out slower. */
export const FADE_IN = 12;
export const FADE_OUT = 4;
/** A body that dies under the reticle loses its tag this fast. */
export const FADE_DEAD = 10;
/** How far above the top of the head the tag sits, in metres. */
const LIFT = 0.28;
/** Tags on screen at once: the targeted one plus any still fading out. */
const POOL = 4;

/**
 * Closest approach of an aim ray to one body.
 *
 * The body is the segment from `feet + SPINE_BASE` up to `head`, so it follows
 * a crouch for free (the head bone drops). Returns `{ t, miss }`: `t` is the
 * distance along the ray at the closest point (how far away he is, as aimed)
 * and `miss` how far from the spine the ray passes there. Writes the point on
 * the spine nearest the ray into `out` when given — that is the point the
 * line-of-sight test aims at.
 *
 * `o` / `d` are the ray origin and a UNIT direction. Plain `{x,y,z}` objects
 * throughout, so this runs in Node.
 */
const _closest = { t: 0, miss: 0 };
export function aimDistance(o, d, feet, head, out) {
  const ax = feet.x;
  const ay = feet.y + SPINE_BASE;
  const az = feet.z;
  let ux = head.x - ax;
  let uy = head.y - ay;
  let uz = head.z - az;
  const len2 = ux * ux + uy * uy + uz * uz;
  const wx = o.x - ax;
  const wy = o.y - ay;
  const wz = o.z - az;
  // Closest points between the line o + t·d and the segment a + s·u, s ∈ [0,1].
  const b = d.x * ux + d.y * uy + d.z * uz;
  const dw = d.x * wx + d.y * wy + d.z * wz;
  const uw = ux * wx + uy * wy + uz * wz;
  let s;
  if (len2 < 1e-9) s = 0;
  else {
    const denom = len2 - b * b; // |d| = 1
    s = denom > 1e-9 ? (uw - b * dw) / denom : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
  }
  const px = ax + ux * s;
  const py = ay + uy * s;
  const pz = az + uz * s;
  // Re-project the clamped spine point onto the ray.
  const t = (px - o.x) * d.x + (py - o.y) * d.y + (pz - o.z) * d.z;
  const cx = o.x + d.x * t - px;
  const cy = o.y + d.y * t - py;
  const cz = o.z + d.z * t - pz;
  _closest.t = t;
  _closest.miss = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (out) {
    out.x = px;
    out.y = py;
    out.z = pz;
  }
  return _closest;
}

/** The aim tube's radius at range `t`. */
export function aimTolerance(t) {
  return BODY_RADIUS + t * ASSIST_TAN;
}

/**
 * Which body the crosshair is on: the NEAREST along the ray whose spine the ray
 * passes within `aimTolerance`, inside [MIN_RANGE, MAX_RANGE]. Returns its index
 * in `list` (the first `n` entries, each `{ feet, head }`) or -1, and writes the
 * aimed-at spine point into `out`.
 *
 * Nearest-along-the-ray, not nearest-to-the-ray: the soldier in front is the
 * one under your reticle even when the ray passes closer to the spine of the
 * one behind him. Occlusion by the WORLD is the caller's job (one ray against
 * the chosen body, not one per candidate).
 */
export function pickTarget(o, d, list, n, out) {
  let best = -1;
  let bestT = Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  const p = out ?? { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const r = aimDistance(o, d, c.feet, c.head, p);
    if (r.t < MIN_RANGE || r.t > MAX_RANGE || r.t >= bestT) continue;
    if (r.miss > aimTolerance(r.t)) continue;
    best = i;
    bestT = r.t;
    bx = p.x;
    by = p.y;
    bz = p.z;
  }
  if (best >= 0) {
    p.x = bx;
    p.y = by;
    p.z = bz;
  }
  return best;
}

/**
 * One tag's fade, advanced by `dt`. `plate` is `{ alpha, hold }`; `aimed` is
 * whether the reticle is on this body this frame, `alive` whether the body is
 * still a live candidate at all. Returns the new alpha.
 *
 *   aimed        → fade in, hold re-armed to HOLD
 *   not aimed    → hold counts down at full alpha, then fade out
 *   gone / dead  → fade out fast, no hold: a tag on a corpse lies
 */
export function stepPlate(plate, aimed, alive, dt) {
  if (!alive) {
    plate.hold = 0;
    plate.alpha = Math.max(0, plate.alpha - FADE_DEAD * dt);
  } else if (aimed) {
    plate.hold = HOLD;
    plate.alpha = Math.min(1, plate.alpha + FADE_IN * dt);
  } else if (plate.hold > 0) {
    plate.hold = Math.max(0, plate.hold - dt);
  } else {
    plate.alpha = Math.max(0, plate.alpha - FADE_OUT * dt);
  }
  return plate.alpha;
}

/**
 * The DOM half. `update()` takes the candidate list the UI system gathered from
 * `ai.getNameplates()` and `net.getNameplates()` — `{ key, name, colour, feet,
 * head }`, where `key` is a stable identity for the body (the Agent / the peer
 * record) — and owns targeting, line of sight and the fades.
 */
export class Nameplates {
  constructor(parent) {
    this.root = el('div', 'ow-layer', parent);
    this.plates = [];
    for (let i = 0; i < POOL; i++) {
      const node = el('div', 'ow-np', this.root);
      const swatch = el('i', 'ow-np-sw', node);
      const name = el('span', 'ow-np-name', node, '');
      setStyle(node, 'display', 'none');
      this.plates.push({
        node,
        swatch,
        name,
        key: null,
        alpha: 0,
        hold: 0,
        shown: false,
        head: new THREE.Vector3(),
      });
    }
    /** The body under the reticle this frame, or null. */
    this.target = null;
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  /**
   * @param list     candidates (first `n` used)
   * @param camera   the world camera, final transform for the frame
   * @param physics  for the line-of-sight ray; without it nothing is named
   * @param active   false while the player cannot be aiming (dead, menu)
   */
  update(dt, list, n, camera, physics, active, w, h) {
    // ---- who is under the reticle ----------------------------------------
    let hit = -1;
    if (active && physics && n > 0) {
      const o = this._o.setFromMatrixPosition(camera.matrixWorld);
      const d = camera.getWorldDirection(this._d);
      hit = pickTarget(o, d, list, n, this._aim);
      // One occlusion ray, against the body actually chosen. Aimed at the
      // spine point nearest the reticle, so a man whose legs are behind a
      // wall but whose chest is in the clear is still named when you aim at
      // his chest — and is not when you aim at the wall in front of his legs.
      if (hit >= 0 && !physics.lineOfSight(o, this._aim)) hit = -1;
    }
    const key = hit >= 0 ? list[hit].key : null;
    this.target = key;

    // ---- bind the target to a plate --------------------------------------
    // Reuse its own plate if it is still fading, else the faintest one.
    if (key) {
      let slot = null;
      for (const p of this.plates) if (p.key === key) slot = p;
      if (!slot) {
        slot = this.plates[0];
        for (const p of this.plates) if (p.alpha < slot.alpha) slot = p;
        slot.key = key;
        slot.alpha = 0;
        slot.hold = 0;
        const c = list[hit];
        setText(slot.name, c.name);
        setStyle(slot.swatch, 'background', c.colour || 'transparent');
        setStyle(slot.swatch, 'display', c.colour ? '' : 'none');
      }
    }

    // ---- fade, follow and paint ------------------------------------------
    for (const p of this.plates) {
      if (!p.key) continue;
      let live = null;
      for (let i = 0; i < n; i++) {
        if (list[i].key === p.key) {
          live = list[i];
          break;
        }
      }
      // A lingering tag keeps tracking the head it belongs to; one whose body
      // has left the list (killed, left the room) holds its last spot while
      // it drops out.
      if (live) p.head.copy(live.head);
      const a = stepPlate(p, p.key === key, !!live && active, dt);
      if (a <= 0) {
        p.key = null;
        if (p.shown) {
          p.shown = false;
          setStyle(p.node, 'display', 'none');
        }
        continue;
      }
      const v = this._v.copy(p.head);
      v.y += LIFT;
      v.project(camera);
      if (v.z > 1 || v.z < -1) {
        // Behind the camera: there is no sensible place to draw it.
        if (p.shown) {
          p.shown = false;
          setStyle(p.node, 'display', 'none');
        }
        continue;
      }
      if (!p.shown) {
        p.shown = true;
        setStyle(p.node, 'display', '');
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      setStyle(p.node, 'transform', `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`);
      setStyle(p.node, 'opacity', clamp01(a).toFixed(3));
    }
  }

  clear() {
    this.target = null;
    for (const p of this.plates) {
      p.key = null;
      p.alpha = 0;
      p.hold = 0;
      p.shown = false;
      setStyle(p.node, 'display', 'none');
    }
  }

  dispose() {
    this.root.remove();
  }
}
