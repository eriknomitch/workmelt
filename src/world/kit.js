import * as THREE from 'three';
import {
  chamferBox,
  plainBox,
  quad,
  wallPanel,
  solidSlabs,
  clothGeometry,
  tubeY,
  polyPrism,
  rockGeometry,
  fbm3,
  paintMasks,
} from './util.js';

/**
 * WORLD — the modular building kit.
 *
 * Panel space for every facade element: x along the wall (centred), y up from
 * the floor line, z from 0 at the OUTER face to +t at the inner face. The
 * caller supplies `pm`, the matrix that puts panel space into level space, and
 * every element composes onto it — so a window knows how deep its own reveal is
 * and can put a sill, a frame, shutters and a grille at the right depth without
 * the caller doing trigonometry.
 */

const _m = new THREE.Matrix4();
const _mm = new THREE.Matrix4();
/** Shared identity for elements authored straight in level space. */
export const IDENT = new THREE.Matrix4();

/** local -> level matrix, composed onto the panel matrix. */
function L(pm, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _mm.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  _mm.scale(new THREE.Vector3(sx, sy, sz));
  _mm.setPosition(x, y, z);
  return _m.copy(pm).multiply(_mm);
}

// A tiny allocation-light path for the common case (no rotation).
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function LL(pm, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _mm.compose(_p, _q, _s);
  return _m.copy(pm).multiply(_mm);
}

export const BOX = (A) => A.cache('box:0.012', () => chamferBox(1, 1, 1, 0.012));
export const BOX_FINE = (A) => A.cache('box:0.004', () => chamferBox(1, 1, 1, 0.004));
export const BOX_SOFT = (A) => A.cache('box:0.03', () => chamferBox(1, 1, 1, 0.03));
/** 12-tri box for thin members (see util.plainBox). */
export const BOX_THIN = (A) => A.cache('box:plain', () => plainBox());
/** Single quad for glass panes. */
export const PANE = (A) => A.cache('pane', () => quad(1, 1));

/** Merge a unit chamfer box scaled to a slab. */
export function slab(A, key, pm, x, y, z, sx, sy, sz, opts = null, ry = 0) {
  A.add(key, BOX(A), LL(pm, x, y, z, ry, sx, sy, sz), opts);
}

// ============================================================== facade wall ==
/**
 * A facade panel with real openings. Returns the list of openings so the
 * caller can hang props (AC units, laundry, awnings) off them.
 *
 * spec: { w, h, t, key, openings:[{x,y,w,h,arch,kind}], top, rng }
 */
export function facadeWall(A, pm, spec) {
  const { w, h, t, key, openings = [], rng } = spec;
  const geo = wallPanel(w, h, t, openings, {
    bevel: spec.bevel ?? 0.022,
    rng,
    top: spec.top ?? 'flat',
    raggedAmp: spec.raggedAmp ?? 0.5,
    jag: spec.jag ?? 0,
    curveSegments: 7,
  });
  // Nothing perfectly flat: bow the face by a few millimetres.
  const warpAmp = spec.warp ?? 0.018;
  if (warpAmp > 0) {
    const pa = geo.getAttribute('position');
    const na = geo.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      const nz = na.getZ(i);
      if (Math.abs(nz) < 0.5) continue;
      const d = (fbm3(x * 0.5 + 3.7, y * 0.42 + 1.3, 0.5, 2) - 0.5) * warpAmp * 2;
      pa.setZ(i, z + d);
    }
    geo.computeVertexNormals();
  }
  // Accum.add expects an OPTIONS object, not a bare callback: passing the
  // function straight through silently dropped every facade's base-grime paint.
  A.addOnce(key, geo, pm, spec.paint ? { paint: spec.paint } : null);

  // Collision: the solid rectangles left after the holes are cut.
  const surface = A.surfaceOf(key);
  for (const s of solidSlabs(w, h, openings)) {
    A.slabBox(surface, pm, s.x, s.y, s.w, s.h, t);
  }
  return openings;
}

// =================================================================== window ==
/**
 * The per-window states. A facade where every opening is the same glazed panel
 * is the single loudest tell of procedural architecture — real streets have
 * open windows, boarded windows, shuttered windows and the odd lit room, and the
 * variation is what makes the wall read as a building people live in.
 *
 * `windowState(rng, f, damage)` picks one; `buildFacade` hands it straight to
 * `windowUnit`, which turns it into geometry.
 */
export function windowState(rng, floor = 1, damage = 0.2, opts = {}) {
  const r = rng.float();
  // Ground-floor openings are shopfronts and barred windows, not open sashes;
  // upper floors are where laundry, shutters and open casements live.
  const upper = floor > 0;
  if (r < 0.07 + damage * 0.25) return 'boarded';
  if (r < 0.2 + damage * 0.5) return 'open';
  if (upper && r < 0.42) return 'shuttered';
  if (upper && r < 0.52) return 'ajar';
  if (r < 0.6) return 'curtain';
  if (opts.allowLit !== false && r < 0.66) return 'lit';
  return 'glazed';
}

/**
 * Window unit: recessed frame, mullions, glass (or blown out), stone sill,
 * lintel, optional shutters / grille / curtain — and, crucially, a DARK
 * INTERIOR BACKING PLANE set back behind the glass.
 *
 * That backing is what separates a window from a rectangle of paint. The glass
 * sits at `depth` inside the reveal as a low-roughness specular sheet that picks
 * up the sky; 15-25 cm behind it sits a `window_void` plane at ~0.03 linear
 * albedo. From the street you therefore see: a bright sky glint on the pane, a
 * dark core behind it, and the reveal shadow crossing the two at a different
 * parallax as the camera moves.
 */
export function windowUnit(A, pm, o, rng, opts = {}) {
  const t = opts.t ?? 0.34;
  const frameKey = opts.frameKey ?? 'wood_dark';
  const depth = opts.depth ?? t * 0.62; // how far in from the outer face
  const w = o.w;
  const h = o.h;
  const x = o.x;
  const y = o.y;
  const fw = 0.055; // frame member thickness
  const fd = 0.075;
  const state = opts.state ?? (opts.broken ? 'open' : 'glazed');
  const broken = opts.broken ?? state === 'open';
  const boarded = state === 'boarded';
  const open = state === 'open' || state === 'ajar';
  const lit = state === 'lit';
  const box = BOX_THIN(A);

  // ---- the dark room behind the opening -----------------------------------
  // Set back from the glass so the reveal shadows onto it and the two planes
  // parallax against each other. `back:false` is for enterable buildings, which
  // have a real furnished room behind the wall already.
  if (opts.back !== false) {
    const bd = depth + (open ? 0.26 : opts.backSet ?? 0.19);
    // Slightly oversized so the reveal never shows daylight round the edge.
    A.add(lit ? 'window_glow' : 'window_void', PANE(A), LL(pm, x, y, bd, 0, w + 0.14, h + 0.14, 1), {
      masks: lit ? [0.2, 0.4, 0.1] : [0.15, 0.9, 0.95],
    });
    // A sliver of side wall inside the opening: gives the void a second value
    // and a real corner rather than reading as one flat card.
    if (!boarded) {
      A.add('window_void', box, LL(pm, x - w / 2 - 0.03, y, bd - 0.09, 0, 0.05, h + 0.1, 0.2), {
        masks: [0.1, 0.95, 1.0],
      });
      A.add('window_void', box, LL(pm, x, y + h / 2 + 0.03, bd - 0.09, 0, w + 0.1, 0.05, 0.2), {
        masks: [0.1, 0.95, 1.0],
      });
    }
  }

  // frame: four members inside the reveal. These are 5 cm members repeated
  // several hundred times across the level, so they use the 12-tri box.
  A.add(frameKey, box, LL(pm, x, y + h / 2 - fw / 2, depth, 0, w - 0.02, fw, fd), null);
  A.add(frameKey, box, LL(pm, x, y - h / 2 + fw / 2, depth, 0, w - 0.02, fw, fd), null);
  A.add(frameKey, box, LL(pm, x - w / 2 + fw / 2, y, depth, 0, fw, h - 0.02, fd), null);
  A.add(frameKey, box, LL(pm, x + w / 2 - fw / 2, y, depth, 0, fw, h - 0.02, fd), null);
  // mullion + transom, or swung-in casement leaves
  let openL = false;
  let openR = false;
  if (!open) {
    A.add(frameKey, box, LL(pm, x, y, depth, 0, 0.045, h - 0.1, fd * 0.85), null);
    A.add(frameKey, box, LL(pm, x, y + h * 0.16, depth, 0, w - 0.1, 0.04, fd * 0.85), null);
  } else {
    // An open casement: the sash swung inward off its hinge, catching light on
    // its edge against the dark room behind it.
    openL = true;
    openR = state === 'open' || rng.float() < 0.4;
    const sw = w / 2 - 0.03;
    const sash = A.cache(`sash:${sw.toFixed(2)}:${h.toFixed(2)}`, () => sashLeaf(sw, h - 0.06));
    A.add(
      frameKey,
      sash,
      LL(pm, x - w / 2 + 0.04, y, depth + 0.02, rng.range(-1.35, -0.75), 1, 1, 1),
      { masks: [0.8, 0.45, 0.2] }
    );
    if (openR) {
      A.add(
        frameKey,
        sash,
        LL(pm, x + w / 2 - 0.04, y, depth + 0.02, rng.range(0.75, 1.35), 1, 1, 1),
        { masks: [0.8, 0.45, 0.2] }
      );
    } else {
      A.add(frameKey, box, LL(pm, x, y, depth, 0, 0.045, h - 0.1, fd * 0.85), null);
    }
  }

  // ---- plywood board nailed over the opening ------------------------------
  if (boarded) {
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const bh = (h + 0.05) / n;
      A.add(
        'plywood',
        box,
        LL(
          pm,
          x + rng.range(-0.04, 0.04),
          y - (h + 0.05) / 2 + (i + 0.5) * bh,
          depth - 0.05,
          0,
          w - 0.02,
          bh - 0.012,
          0.026,
          0,
          rng.range(-0.02, 0.02)
        ),
        { masks: [0.75, 0.55, 0.25] }
      );
    }
    // a gap left at the top where a board is missing, showing the dark room
    if (rng.float() < 0.5) {
      A.add('metal_rust', box, LL(pm, x, y + h / 2 - 0.1, depth - 0.08, 0, w * 0.5, 0.03, 0.02), {
        masks: [0.9, 0.6, 0],
      });
    }
  }

  // glass: four panes, some missing
  if (!opts.noGlass && !boarded) {
    const panes = [
      [x - w / 4, y + h * 0.33, w / 2 - 0.09, h * 0.3],
      [x + w / 4, y + h * 0.33, w / 2 - 0.09, h * 0.3],
      [x - w / 4, y - h * 0.17, w / 2 - 0.09, h * 0.6],
      [x + w / 4, y - h * 0.17, w / 2 - 0.09, h * 0.6],
    ];
    for (let i = 0; i < panes.length; i++) {
      const [px, py, pw, ph] = panes[i];
      // A swung-open leaf takes its glazing with it; the closed half keeps its.
      if (px < x ? openL : openR) continue;
      if (broken && rng.float() < 0.55) continue;
      A.add('window_glass', PANE(A), LL(pm, px, py, depth, 0, pw, ph, 1), {
        masks: [0.1, 0.3, 0],
      });
    }
    if (broken) {
      // a couple of shards still in the frame
      for (let i = 0; i < 3; i++) {
        const sw = rng.range(0.08, 0.26);
        A.add(
          'glass',
          box,
          LL(
            pm,
            x + rng.range(-w / 2 + 0.1, w / 2 - 0.1),
            y + h / 2 - sw * rng.range(0.4, 0.9),
            depth,
            0,
            sw,
            sw * rng.range(0.6, 1.4),
            0.01,
            0,
            rng.range(-0.5, 0.5)
          ),
          null
        );
      }
    }
  }

  // stone sill, protruding and dripping dirt
  if (opts.sill !== false) {
    A.add(
      'concrete',
      BOX_SOFT(A),
      LL(pm, x, y - h / 2 - 0.045, -0.045, 0, w + 0.26, 0.09, t * 0.55),
      { masks: [0.5, 0.35, 0.2] }
    );
  }
  // lintel
  if (opts.lintel !== false) {
    A.add('concrete', BOX(A), LL(pm, x, y + h / 2 + 0.055, 0.02, 0, w + 0.18, 0.11, t * 0.42), {
      masks: [0.35, 0.5, 0.3],
    });
  }

  // metal grille on some ground-floor windows
  if (opts.grille) {
    const bar = BOX_THIN(A);
    const n = Math.max(3, Math.round(w / 0.16));
    for (let i = 0; i < n; i++) {
      const gx = x - w / 2 + 0.08 + (i / (n - 1)) * (w - 0.16);
      A.add('metal_rust', bar, LL(pm, gx, y, 0.055, 0, 0.022, h - 0.06, 0.022), {
        masks: [0.8, 0.5, 0],
      });
    }
    for (let i = 0; i < 2; i++) {
      A.add(
        'metal_rust',
        bar,
        LL(pm, x, y - h / 4 + (i * h) / 2, 0.055, 0, w - 0.05, 0.022, 0.022),
        { masks: [0.8, 0.5, 0] }
      );
    }
  }

  // shutters — one closed, one hanging open at an angle
  if (opts.shutters) {
    const key = opts.shutterKey ?? 'metal_blue';
    const sw = w / 2 - 0.01;
    const louvre = A.cache(`shutter:${sw.toFixed(2)}:${h.toFixed(2)}`, () =>
      shutterLeaf(sw, h - 0.03)
    );
    // `state:'shuttered'` means shut for the afternoon — both leaves flat on the
    // reveal, which is a completely different silhouette from a half-open pair.
    const shut = state === 'shuttered';
    const swungL = shut ? false : rng.float() < 0.45;
    const swungR = shut ? false : rng.float() < 0.45;
    A.add(
      key,
      louvre,
      LL(
        pm,
        x - w / 2 + (swungL ? 0.02 : sw / 2),
        y,
        -0.03,
        swungL ? rng.range(0.9, 1.5) : 0,
        1,
        1,
        1
      ),
      { masks: [0.9, 0.4, 0] }
    );
    A.add(
      key,
      louvre,
      LL(
        pm,
        x + w / 2 - (swungR ? 0.02 : sw / 2),
        y,
        -0.03,
        swungR ? -rng.range(0.9, 1.5) : 0,
        1,
        1,
        1
      ),
      { masks: [0.9, 0.4, 0] }
    );
  }

  // interior curtain / cloth, visible from the street
  if (opts.curtain) {
    const c = clothGeometry(w * 0.92, h * 0.95, {
      segX: 7,
      segY: 7,
      sag: 0.05,
      wrinkle: 0.055,
      twist: 0.05,
      fray: 0.012,
      rng,
    });
    A.addOnce(
      opts.curtainKey ?? 'fabric_cream',
      c,
      LL(pm, x + w * 0.03, y, depth + 0.09, 0, 1, 1, 1),
      { masks: [0.1, 0.35, 0.1] }
    );
  }
  return o;
}

/**
 * A glazed casement leaf, hinged at its LEFT edge (origin on the hinge) so it can
 * be swung by a single Y rotation. Stiles, rails, a centre bar and a thin glazed
 * infill — enough that an open window shows a rectangle of frame catching the sun
 * against the dark room instead of just an empty hole.
 */
function sashLeaf(w, h) {
  const parts = [];
  const push = (sx, sy, sz, x, y, z) => {
    const g = plainBox();
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    parts.push(g);
  };
  push(0.05, h, 0.032, 0.025, 0, 0);
  push(0.05, h, 0.032, w - 0.025, 0, 0);
  push(w, 0.05, 0.032, w / 2, h / 2 - 0.025, 0);
  push(w, 0.05, 0.032, w / 2, -h / 2 + 0.025, 0);
  push(w - 0.08, 0.038, 0.026, w / 2, h * 0.14, 0);
  // the pane, inset into the rebate — a thin sheet, not a solid slab
  push(w - 0.09, h - 0.09, 0.008, w / 2, 0, -0.006);
  const merged = mergeSimple(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** A louvred shutter leaf: stiles, rails and slats. Origin at leaf centre. */
function shutterLeaf(w, h) {
  const parts = [];
  const push = (sx, sy, sz, x, y, z, rx = 0) => {
    const g = plainBox();
    g.scale(sx, sy, sz);
    const m = new THREE.Matrix4();
    _e.set(rx, 0, 0);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(1, 1, 1);
    m.compose(_p, _q, _s);
    g.applyMatrix4(m);
    parts.push(g);
  };
  push(0.05, h, 0.035, -w / 2 + 0.025, 0, 0);
  push(0.05, h, 0.035, w / 2 - 0.025, 0, 0);
  push(w, 0.05, 0.035, 0, h / 2 - 0.025, 0);
  push(w, 0.05, 0.035, 0, -h / 2 + 0.025, 0);
  push(w, 0.05, 0.035, 0, 0, 0);
  const slats = Math.max(4, Math.floor((h - 0.16) / 0.115));
  for (let i = 0; i < slats; i++) {
    const y = -h / 2 + 0.09 + (i / (slats - 1)) * (h - 0.18);
    if (Math.abs(y) < 0.04) continue;
    push(w - 0.08, 0.06, 0.014, 0, y, 0.006, -0.5);
  }
  const merged = mergeSimple(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** Minimal geometry merge for kit sub-parts (all chamferBox, same attributes). */
export function mergeSimple(list) {
  let vc = 0;
  let ic = 0;
  for (const g of list) {
    vc += g.getAttribute('position').count;
    ic += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const col = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    const c = g.getAttribute('color');
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (c) col.set(c.array, vo * 3);
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) idx[io + i] = vo + a[i];
      io += a.length;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ===================================================================== door ==
export function doorUnit(A, pm, o, rng, opts = {}) {
  const t = opts.t ?? 0.34;
  const w = o.w;
  const h = o.h;
  const x = o.x;
  const y = o.y;
  const box = BOX(A);
  const frameKey = opts.frameKey ?? 'wood_dark';
  // jamb + head casing standing slightly proud of the wall
  A.add(frameKey, box, LL(pm, x - w / 2 - 0.03, y, 0.0, 0, 0.09, h + 0.1, t * 0.9), {
    masks: [0.6, 0.4, 0.2],
  });
  A.add(frameKey, box, LL(pm, x + w / 2 + 0.03, y, 0.0, 0, 0.09, h + 0.1, t * 0.9), {
    masks: [0.6, 0.4, 0.2],
  });
  A.add(frameKey, box, LL(pm, x, y + h / 2 + 0.06, 0.0, 0, w + 0.2, 0.11, t * 0.9), {
    masks: [0.6, 0.45, 0.25],
  });
  // threshold
  A.add('concrete', BOX_SOFT(A), LL(pm, x, y - h / 2 + 0.03, t * 0.5 - 0.02, 0, w + 0.1, 0.06, t), {
    masks: [0.7, 0.5, 0.3],
  });

  if (opts.leaf !== false) {
    const key = opts.leafKey ?? 'metal_green';
    const ang = opts.open ?? 0;
    const leafW = w - 0.06;
    const leaf = A.cache(`doorleaf:${leafW.toFixed(2)}:${h.toFixed(2)}`, () =>
      doorLeaf(leafW, h - 0.06)
    );
    // hinge at the left jamb: rotate about the hinge, not the centre
    const hx = x - leafW / 2;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    A.add(
      key,
      leaf,
      LL(pm, hx + (leafW / 2) * cs, y, t * 0.45 + (leafW / 2) * sn, -ang, 1, 1, 1),
      { masks: [0.95, 0.5, 0.1] }
    );
  }
  return o;
}

function doorLeaf(w, h) {
  const parts = [];
  const add = (sx, sy, sz, x, y, z) => {
    const g = chamferBox(sx, sy, sz, 0.006);
    g.translate(x, y, z);
    parts.push(g);
  };
  add(w, h, 0.05, 0, 0, 0);
  // recessed panels framed by rails
  add(w, 0.1, 0.062, 0, h / 2 - 0.07, 0);
  add(w, 0.1, 0.062, 0, -h / 2 + 0.07, 0);
  add(w, 0.12, 0.062, 0, h * 0.06, 0);
  add(0.09, h, 0.062, -w / 2 + 0.05, 0, 0);
  add(0.09, h, 0.062, w / 2 - 0.05, 0, 0);
  // handle
  add(0.035, 0.13, 0.035, w / 2 - 0.16, -0.02, 0.05);
  const g = mergeSimple(parts);
  for (const p of parts) p.dispose();
  return g;
}

// =============================================================== shopfront ==
/** Wide ground-floor opening with a roller shutter part-way down. */
export function shopfront(A, pm, o, rng, opts = {}) {
  const t = opts.t ?? 0.34;
  const { x, y, w, h } = o;
  const box = BOX(A);
  // lintel beam over the opening
  A.add('concrete', box, LL(pm, x, y + h / 2 + 0.11, t * 0.5, 0, w + 0.5, 0.22, t), {
    masks: [0.4, 0.55, 0.35],
  });
  // shutter housing
  A.add('metal_dark', box, LL(pm, x, y + h / 2 - 0.09, 0.06, 0, w + 0.12, 0.18, 0.16), {
    masks: [0.85, 0.5, 0.1],
  });
  const drop = opts.drop ?? rng.range(0.15, 0.85);
  if (drop > 0.02) {
    const sh = h * drop;
    const shutter = A.cache(`roller:${w.toFixed(2)}`, () => rollerShutter(w, 1));
    A.add(
      'corrugated',
      shutter,
      LL(pm, x, y + h / 2 - 0.18 - sh / 2, 0.05, 0, 1, sh, 1),
      { masks: [0.85, 0.6, 0.15] }
    );
    // collision for the closed part
    A.slabBox('metal', pm, x, y + h / 2 - 0.18 - sh / 2, w, sh, 0.12);
  }
  // stall counter in the opening
  if (opts.counter !== false) {
    A.add('wood_dark', box, LL(pm, x, 0.42, t + 0.28, 0, w * 0.82, 0.08, 0.7), {
      masks: [0.8, 0.5, 0.2],
    });
    A.add('wood_dark', box, LL(pm, x - w * 0.34, 0.21, t + 0.28, 0, 0.09, 0.42, 0.62), {
      masks: [0.7, 0.6, 0.3],
    });
    A.add('wood_dark', box, LL(pm, x + w * 0.34, 0.21, t + 0.28, 0, 0.09, 0.42, 0.62), {
      masks: [0.7, 0.6, 0.3],
    });
    A.slabBox('wood', pm, x, 0.25, w * 0.82, 0.5, t + 0.6);
  }

  /**
   * Inside dressing beside the opening. The wall a shop is seen through is the
   * biggest surface in any interior shot, and bare render there is the fastest
   * way to make an interior look like an empty box.
   */
  if (opts.inside !== false) {
    const thin = BOX_THIN(A);
    for (const sx of [-1, 1]) {
      const bx = x + sx * (w / 2 + 0.75);
      // wall shelf with goods
      const sy = 1.35 + (rng?.range ? rng.range(-0.1, 0.25) : 0);
      A.add('wood_prop', BOX_FINE(A), LL(pm, bx, sy, t + 0.17, 0, 1.3, 0.045, 0.34), {
        masks: [0.85, 0.4, 0.15],
      });
      for (const b of [-1, 1]) {
        A.add(
          'metal_rust',
          thin,
          LL(pm, bx + b * 0.5, sy - 0.12, t + 0.09, 0, 0.03, 0.24, 0.18),
          { masks: [0.9, 0.6, 0.2] }
        );
      }
      // conduit up the wall into a junction box
      A.add('metal_dark', thin, LL(pm, bx + 0.62, 1.5, t + 0.03, 0, 0.045, 2.6, 0.045), {
        masks: [0.7, 0.5, 0.2],
      });
      A.add('metal_dark', BOX_FINE(A), LL(pm, bx + 0.62, 1.42, t + 0.06, 0, 0.16, 0.22, 0.09), {
        masks: [0.8, 0.5, 0.2],
      });
    }
    // a bolt of cloth hung on the inside wall over the counter
    if (rng && rng.float() < 0.7) {
      const c = clothGeometry(rng.range(0.9, 1.5), rng.range(1.1, 1.7), {
        segX: 7,
        segY: 8,
        sag: 0.05,
        wrinkle: 0.055,
        twist: 0.06,
        thickness: 0.003,
        fray: 0.02,
        rng,
      });
      A.addOnce(
        rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
        c,
        LL(pm, x + (rng.float() < 0.5 ? -1 : 1) * (w / 2 + rng.range(0.9, 1.5)), 1.75, t + 0.08, Math.PI),
        { masks: [0.3, 0.45, 0.2] }
      );
    }
  }
  return o;
}

/** Corrugated roller shutter, 1 m tall, scaled by the caller. */
function rollerShutter(w, h) {
  const g = new THREE.PlaneGeometry(w, h, 2, 14);
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    pa.setZ(i, Math.sin(y * 90) * 0.008);
  }
  g.computeVertexNormals();
  const g2 = g.clone();
  g2.rotateY(Math.PI);
  const out = mergeSimple([g, g2]);
  g.dispose();
  g2.dispose();
  return out;
}

// ================================================================= balcony ==
export function balcony(A, pm, x, y, w, rng, opts = {}) {
  const d = opts.depth ?? 1.15;
  const box = BOX(A);
  const key = opts.key ?? 'concrete';
  // slab, slightly sagging feel via thickness taper
  A.add(key, BOX_SOFT(A), LL(pm, x, y + 0.06, -d / 2, 0, w, 0.13, d), {
    masks: [0.45, 0.55, 0.3],
  });
  A.box('concrete', ...worldOf(pm, x, y + 0.06, -d / 2), w, 0.16, d, ryOf(pm));
  // brackets underneath
  for (let i = -1; i <= 1; i += 2) {
    A.add(key, box, LL(pm, x + i * (w / 2 - 0.16), y - 0.14, -d * 0.42, 0, 0.11, 0.3, d * 0.75), {
      masks: [0.4, 0.6, 0.4],
    });
  }
  // railing
  if (opts.railing === 'concrete') {
    A.add(key, box, LL(pm, x, y + 0.55, -d + 0.06, 0, w, 0.85, 0.12), { masks: [0.5, 0.5, 0.2] });
    A.add(key, box, LL(pm, x - w / 2 + 0.06, y + 0.55, -d / 2, 0, 0.12, 0.85, d), {
      masks: [0.5, 0.5, 0.2],
    });
    A.add(key, box, LL(pm, x + w / 2 - 0.06, y + 0.55, -d / 2, 0, 0.12, 0.85, d), {
      masks: [0.5, 0.5, 0.2],
    });
    A.box('concrete', ...worldOf(pm, x, y + 0.55, -d + 0.06), w, 0.9, 0.16, ryOf(pm));
  } else {
    const bar = BOX_THIN(A);
    const rk = opts.railKey ?? 'metal_rust';
    // top and mid rails
    A.add(rk, bar, LL(pm, x, y + 1.0, -d + 0.04, 0, w, 0.05, 0.05), { masks: [0.9, 0.45, 0] });
    A.add(rk, bar, LL(pm, x, y + 0.52, -d + 0.04, 0, w, 0.035, 0.035), { masks: [0.9, 0.45, 0] });
    A.add(rk, bar, LL(pm, x - w / 2, y + 1.0, -d / 2 + 0.02, 0, 0.05, 0.05, d), {
      masks: [0.9, 0.45, 0],
    });
    A.add(rk, bar, LL(pm, x + w / 2, y + 1.0, -d / 2 + 0.02, 0, 0.05, 0.05, d), {
      masks: [0.9, 0.45, 0],
    });
    const n = Math.max(4, Math.round(w / 0.17));
    for (let i = 0; i <= n; i++) {
      const bx = x - w / 2 + (i / n) * w;
      A.add(rk, bar, LL(pm, bx, y + 0.53, -d + 0.04, 0, 0.024, 1.0, 0.024), {
        masks: [0.9, 0.5, 0],
      });
    }
    // corner posts
    for (const sx of [-1, 1]) {
      A.add(rk, bar, LL(pm, x + sx * (w / 2), y + 0.53, -d + 0.04, 0, 0.05, 1.05, 0.05), {
        masks: [0.9, 0.5, 0],
      });
      for (let i = 0; i <= 3; i++) {
        A.add(
          rk,
          bar,
          LL(pm, x + sx * (w / 2), y + 0.53, -d + 0.04 + (i / 3) * (d - 0.08), 0, 0.024, 1.0, 0.024),
          { masks: [0.9, 0.5, 0] }
        );
      }
    }
    A.box('metal', ...worldOf(pm, x, y + 0.55, -d + 0.06), w, 0.95, 0.1, ryOf(pm));
  }
  return { x, y, w, d };
}

// ================================================================= parapet ==
/** Roof edge wall with a coping course and scupper gaps. */
export function parapet(A, key, cx, cz, w, d, y, rng, opts = {}) {
  const h = opts.h ?? 0.72;
  const t = opts.t ?? 0.24;
  const box = BOX(A);
  const sides = [
    [cx, cz - d / 2 + t / 2, w, t],
    [cx, cz + d / 2 - t / 2, w, t],
    [cx - w / 2 + t / 2, cz, t, d],
    [cx + w / 2 - t / 2, cz, t, d],
  ];
  const pmI = IDENT;
  for (let i = 0; i < sides.length; i++) {
    const [sx, sz, sw, sd] = sides[i];
    const jitter = rng.range(-0.05, 0.05);
    pmI.identity();
    A.add(
      key,
      box,
      LL(pmI, sx, y + (h + jitter) / 2, sz, 0, sw, h + jitter, sd),
      { masks: [0.5, 0.4, 0.15] }
    );
    // coping: a slightly wider, weathered cap
    A.add(
      opts.copingKey ?? 'concrete',
      BOX_SOFT(A),
      LL(pmI, sx, y + h + jitter + 0.045, sz, 0, sw + 0.09, 0.09, sd + 0.09),
      { masks: [0.75, 0.3, 0.1] }
    );
    A.box('concrete', sx, y + (h + 0.1) / 2, sz, sw, h + 0.1, sd);
  }
  return y + h;
}

// =================================================================== stairs ==
/**
 * A straight flight. Origin at the bottom step's front-centre, climbing +Z.
 * Emits per-step collision so the character controller steps up naturally.
 */
export function stairRun(A, pm, x, y, z, w, steps, rise, run, opts = {}) {
  const key = opts.key ?? 'concrete';
  const box = BOX(A);
  for (let i = 0; i < steps; i++) {
    const sy = y + (i + 0.5) * rise;
    const sz = z + (i + 0.5) * run;
    A.add(key, box, LL(pm, x, sy, sz, 0, w, rise, run), {
      masks: [0.7, 0.35, 0.15],
    });
    const wp = worldOf(pm, x, sy, sz);
    A.box(A.surfaceOf(key), wp[0], wp[1], wp[2], w, rise, run, ryOf(pm));
  }
  // Waist slab under the flight so it doesn't read as floating slabs. It must
  // be a SLOPED slab tucked under the steps, never an axis-aligned box: an
  // H × D box encloses every tread, so from outside the flight renders as a
  // solid cube, and only once the eye is inside it (i.e. standing on the
  // stairs) do its single-sided faces back-cull and reveal the steps.
  // The top face runs along the line through each step's lower-front corner,
  // just inside the treads; the underside sits `rise + 0.1` below it, which
  // covers the sawtooth of the step soffits with one clean slope.
  const H = steps * rise;
  const D = steps * run;
  const ang = Math.atan2(H, D);
  const len = Math.hypot(H, D);
  if (opts.stringer !== false) {
    const T = (rise + 0.1) * Math.cos(ang);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    A.add(
      key,
      box,
      LL(pm, x, y + H / 2 - 0.01 - (T / 2) * ca, z + D / 2 + (T / 2) * sa, 0, w * 1.02, T, len, -ang),
      { masks: [0.4, 0.6, 0.4] }
    );
  }
  if (opts.railing) {
    const bar = BOX_THIN(A);
    for (const sx of [-1, 1]) {
      if (opts.railing === 'right' && sx < 0) continue;
      if (opts.railing === 'left' && sx > 0) continue;
      A.add(
        'metal_rust',
        bar,
        LL(pm, x + sx * (w / 2 - 0.05), y + H / 2 + 0.95, z + D / 2, 0, 0.045, 0.045, len, -ang),
        { masks: [0.9, 0.5, 0] }
      );
      for (let i = 0; i < steps; i += 3) {
        A.add(
          'metal_rust',
          bar,
          LL(pm, x + sx * (w / 2 - 0.05), y + i * rise + 0.5, z + (i + 0.5) * run, 0, 0.03, 1.0, 0.03),
          { masks: [0.9, 0.5, 0] }
        );
      }
    }
  }
  return { top: y + H, endZ: z + D };
}

// ================================================================= canopies ==
/**
 * A striped cloth canopy. Real market awnings are woven or sewn from bands, and
 * a single flat colour is the fastest way to make fabric read as a tarpaulin —
 * so this splits one continuous catenary surface into alternating colour strips.
 *
 * @param {Array<string>} keys  two or three palette keys to alternate
 * @param {THREE.Matrix4} m     transform for the whole canopy
 */
export function stripedCloth(A, keys, m, w, h, opts = {}) {
  const bands = opts.bands ?? Math.max(3, Math.round(w / 0.38));
  const rng = opts.rng ?? null;
  const seed = (rng ?? { float: () => 0.5 }).float() * 30;
  const segX = Math.max(2, Math.round(24 / bands));
  // `skipBand` tears one strip out of an old tarp: the gap, and the fact that
  // the neighbouring bands then read as separate pieces of cloth, is worth more
  // than any amount of texture on an intact rectangle.
  const skip = opts.skipBand ?? -1;
  const masks = opts.masks ?? [0.3, 0.5, 0.15];
  for (let i = 0; i < bands; i++) {
    if (i === skip) continue;
    const u0 = i / bands;
    const u1 = (i + 1) / bands;
    const g = clothGeometry(w, h, {
      segX: opts.segX ?? segX,
      segY: opts.segY ?? 6,
      sag: opts.sag ?? 0.14,
      wrinkle: opts.wrinkle ?? 0.03,
      bulge: opts.bulge ?? 0.04,
      twist: opts.twist ?? 0,
      thickness: opts.thickness ?? 0.0024,
      hem: opts.hem ?? 1,
      fray: opts.fray ?? 0,
      uRange: [u0, u1],
      seed,
    });
    // per-band weathering: sewn-together strips never age at the same rate
    const gv = rng ? rng.range(0.85, 1.18) : 1;
    A.addOnce(keys[i % keys.length], g, m, {
      masks: [masks[0], Math.min(1, masks[1] * gv), masks[2]],
    });
  }
}

// ================================================================== awning ==
/** Fabric awning over a shopfront: sloped cloth, scalloped edge, steel poles. */
export function awning(A, pm, x, y, w, rng, opts = {}) {
  const d = opts.depth ?? 1.5;
  const key = opts.key ?? 'fabric_red';
  const slope = opts.slope ?? 0.32;
  // the cloth is authored in XY; tip it to the awning slope
  const keys = opts.keys ?? [key, opts.key2 ?? 'fabric_cream'];
  const slack = rng ? rng.range(0.85, 1.45) : 1;
  stripedCloth(A, keys, LL(pm, x, y - slope * 0.5, -d / 2, 0, 1, 1, 1, -Math.PI / 2 + slope), w, d, {
    segY: 6,
    sag: 0.11 * slack,
    wrinkle: 0.026 * slack,
    bulge: 0.055 * slack,
    thickness: 0.0026,
    rng,
    masks: [0.2, 0.45, 0.15],
  });
  // valance hanging off the front edge, scalloped and frayed along the bottom
  stripedCloth(A, keys, LL(pm, x, y - slope - 0.13, -d, 0, 1, 1, 1), w, 0.26, {
    segY: 3,
    sag: 0.05 * slack,
    wrinkle: 0.026 * slack,
    bulge: 0,
    thickness: 0.0026,
    fray: 0.018,
    rng,
    masks: [0.3, 0.5, 0.2],
  });
  // frame
  const bar = BOX_THIN(A);
  for (const sx of [-1, 1]) {
    A.add('metal_rust', bar, LL(pm, x + sx * (w / 2 - 0.05), y - slope * 0.5, -d / 2, 0, 0.04, 0.04, d, -Math.atan2(slope, d)), {
      masks: [0.9, 0.5, 0],
    });
    if (opts.legs) {
      A.add('metal_rust', bar, LL(pm, x + sx * (w / 2 - 0.05), (y - slope) / 2, -d + 0.05, 0, 0.045, y - slope, 0.045), {
        masks: [0.9, 0.55, 0],
      });
    }
  }
  A.add('metal_rust', bar, LL(pm, x, y - slope, -d + 0.03, 0, w, 0.04, 0.04), {
    masks: [0.9, 0.5, 0],
  });
  return { x, y, w, d };
}

// ================================================================ pipework ==
export function drainpipe(A, pm, x, yTop, h, rng, opts = {}) {
  const r = opts.r ?? 0.055;
  const key = opts.key ?? 'metal_rust';
  const pipe = A.cache(`pipe:${r.toFixed(3)}`, () => tubeY(r, 1, { radial: 8 }));
  const z = opts.z ?? -r - 0.02;
  // three sections with visible joints and a slight lean
  const segs = Math.max(2, Math.round(h / 1.6));
  let y = yTop - h;
  for (let i = 0; i < segs; i++) {
    const sh = h / segs;
    A.add(key, pipe, LL(pm, x + (i % 2 ? 0.006 : -0.006), y, z, 0, 1, sh, 1), {
      masks: [0.85, 0.6, 0.1],
    });
    A.add(key, pipe, LL(pm, x, y + sh - 0.03, z, 0, 1.22, 0.075, 1.22), { masks: [0.9, 0.7, 0.2] });
    y += sh;
  }
  // shoe at the bottom kicking out to the street
  A.add(key, pipe, LL(pm, x, yTop - h + 0.02, z + 0.09, 0, 1, 0.3, 1, -0.75), {
    masks: [0.85, 0.7, 0.3],
  });
  // A rainwater head at the top. Without it the pipe simply stops in mid-air,
  // which is what makes a downpipe read as a floating mast rather than as
  // plumbing that goes somewhere.
  A.add(key, BOX_FINE(A), LL(pm, x, yTop - 0.09, z - 0.01, 0, 0.2, 0.2, 0.17), {
    masks: [0.85, 0.65, 0.25],
  });
  A.add('metal_dark', BOX_FINE(A), LL(pm, x, yTop + 0.02, z - 0.01, 0, 0.24, 0.03, 0.2), {
    masks: [0.9, 0.55, 0.2],
  });
  // and the stain the overflow leaves down the render beside it
  A.add(key, BOX_FINE(A), LL(pm, x, yTop - 0.24, z * 0.35, 0, 0.09, 0.3, 0.02), {
    masks: [0.2, 1.0, 0.6],
  });
  // brackets
  for (let i = 1; i < segs; i++) {
    A.add('metal_dark', BOX_FINE(A), LL(pm, x, yTop - h + (i * h) / segs, z * 0.45, 0, 0.16, 0.03, Math.abs(z) * 0.9), {
      masks: [0.9, 0.6, 0.2],
    });
  }
}

// ================================================================== damage ==
/**
 * Bullet pocks: a shallow crater with a chipped rim. Instanced by the caller.
 * Origin on the wall face, opening toward +Z.
 *
 * This used to be a solid `ConeGeometry` rotated to point along +Z, i.e. a
 * CONVEX spike sticking r*1.3 straight OUT of the render — the opposite of a
 * crater. At the sizes the callers use (radius up to 8 cm) every burst read as a
 * cluster of dark faceted heptagonal lumps glued onto the plaster, which is the
 * "rows of dark dots" artifact the critics kept flagging on the facades and the
 * concrete barrier.
 *
 * We cannot cut a real hole: the wall behind is opaque geometry at z = 0, so any
 * vertex pushed to z < 0 simply disappears. A crater therefore has to be built
 * the way a decal artist builds one — the floor sits ~flush with the wall and the
 * RIM is raised, so the shading gradient reads as a depression. Nothing ever
 * breaks the silhouette by more than a couple of millimetres.
 *
 * The rng is drawn exactly 16 times, matching the old implementation, because
 * `registerProps` shares one stream with the whole level build: changing the
 * draw count here silently re-rolls every window state and roof prop downstream.
 */
export function pockGeometry(rng, r = 0.05) {
  const SEG = 8;
  // (radius factor, height factor) — floor, bowl wall, rim crest, outer skirt.
  const RINGS = [
    [0.0, 0.010],
    [0.42, 0.024],
    [0.8, 0.075],
    [1.0, 0.004],
  ];
  // chipped rim: per-segment radius and crest-height jitter. 8 + 8 = 16 draws.
  const jr = [];
  const jz = [];
  for (let s = 0; s < SEG; s++) jr.push(1 + (rng.float() - 0.5) * 0.42);
  for (let s = 0; s < SEG; s++) jz.push(0.62 + rng.float() * 0.76);

  const pos = [];
  const idx = [];
  // ring 0 is the single centre vertex; rings 1..3 are full circles.
  pos.push(0, 0, RINGS[0][1] * r);
  for (let k = 1; k < RINGS.length; k++) {
    const [rf, zf] = RINGS[k];
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      // Only the two outer rings are chipped; the bowl stays smooth so the
      // floor does not poke through the wall.
      const rj = k >= 2 ? jr[s] : 1;
      const zj = k === 2 ? jz[s] : 1;
      pos.push(Math.cos(a) * rf * r * rj, Math.sin(a) * rf * r * rj, zf * r * zj);
    }
  }
  const ringStart = (k) => 1 + (k - 1) * SEG;
  for (let s = 0; s < SEG; s++) {
    const n = (s + 1) % SEG;
    idx.push(0, ringStart(1) + s, ringStart(1) + n); // floor fan
  }
  for (let k = 1; k < RINGS.length - 1; k++) {
    const a0 = ringStart(k);
    const b0 = ringStart(k + 1);
    for (let s = 0; s < SEG; s++) {
      const n = (s + 1) % SEG;
      idx.push(a0 + s, b0 + s, b0 + n, a0 + s, b0 + n, a0 + n);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    // Wear (exposed substrate) and AO are strongest in the crater floor; the
    // raised rim is cleaner and catches light, which is what sells the depth.
    const t = Math.min(1, Math.hypot(x, y) / (r * 0.8));
    out[0] = 0.9 - 0.35 * t;
    out[1] = 0.62 - 0.3 * t;
    out[2] = 0.9 - 0.55 * t;
  });
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A crumbled corner / spalled patch: exposes the substrate under the render. */
export function spallPatch(rng, w, h, depth = 0.03) {
  const g = polyPrism(
    (() => {
      const pts = [];
      const n = 11;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const rr = 0.5 * (1 + (fbm3(Math.cos(t) * 2 + 9, Math.sin(t) * 2 + 3, 1.7, 2) - 0.5) * 0.9);
        pts.push([Math.cos(t) * rr * w, Math.sin(t) * rr * h]);
      }
      return pts;
    })(),
    depth
  );
  g.rotateX(Math.PI / 2);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.3;
    out[1] = 0.55 + 0.3 * (1 - Math.abs(nz));
    out[2] = 0.5 * (1 - Math.abs(nz)) + 0.2;
  });
  return g;
}

/** Rubble mound: a low pile of masonry chunks and dust. */
export function rubbleMound(A, rng, x, y, z, radius, count, opts = {}) {
  const key = opts.key ?? 'concrete';
  for (let i = 0; i < count; i++) {
    const a = rng.float() * Math.PI * 2;
    const rr = Math.sqrt(rng.float()) * radius;
    const s = rng.range(0.09, 0.3) * (1 - rr / radius / 1.6);
    const g = rockGeometry(rng, s, 0, 0.75);
    A.addOnce(
      key,
      g,
      LL(
        IDENT,
        x + Math.cos(a) * rr,
        y + s * 0.3 + Math.max(0, (1 - rr / radius) * radius * 0.3),
        z + Math.sin(a) * rr,
        rng.float() * 6.28,
        1,
        1,
        1,
        rng.range(-0.4, 0.4),
        rng.range(-0.4, 0.4)
      ),
      { masks: [0.3, 0.75, 0.45] }
    );
  }
  A.box(A.surfaceOf(key), x, y + radius * 0.14, z, radius * 1.5, radius * 0.34, radius * 1.5);
}

// --------------------------------------------------------------- utilities --
const _wp = [0, 0, 0];
/** Transform a panel-space point to level space (returns a shared triple). */
export function worldOf(pm, x, y, z) {
  _p.set(x, y, z).applyMatrix4(pm);
  _wp[0] = _p.x;
  _wp[1] = _p.y;
  _wp[2] = _p.z;
  return _wp;
}

/** Extract the Y rotation baked into a panel matrix. */
export function ryOf(pm) {
  const e = pm.elements;
  return Math.atan2(e[8], e[10]);
}

export { L, LL };
