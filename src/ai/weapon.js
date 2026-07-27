/**
 * AI — the enemy's weapon, modelled in the weapon's own frame and then baked
 * into the character mesh rigidly bound to the firing hand. That keeps the
 * whole soldier, rifle included, at one draw call per material.
 *
 * Weapon frame: origin at the pistol grip (the firing wrist), +Z down the bore,
 * +Y up, +X the shooter's left. Bore line sits 0.095 m above the origin.
 */

import * as THREE from 'three';
import {
  emptyMesh, loft, tube, ribbon, revolve, boxRound, superEllipse, ellipseProfile,
  appendMesh, computeNormals, transformMesh, warp,
} from './geo.js';
import { GRIP_R, BORE_DIR } from './rig.js';
// Section counts and the sub-centimetre displacement scale are the character's,
// not the gun's: a low-poly soldier carrying a smooth rifle reads as a bug.
import { F, R, displace } from './parts.js';

const BORE_Y = 0.095;

/** Local helper: rounded box positioned in weapon space. */
function box(hx, hy, hz, x, y, z, opts = {}) {
  const m = boxRound(hx, hy, hz, {
    n: opts.n ?? 3.6,
    seg: F(opts.seg ?? 16),
    rows: R(opts.rows ?? 7),
    roundY: opts.roundY ?? 0.3,
  });
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0, 'YXZ')
  );
  computeNormals(m);
  transformMesh(m, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
  return m;
}

/** Cylinder along +Z in weapon space. */
function cyl(r0, r1, z0, z1, x, y, seg = 14, cap = true) {
  seg = F(seg);
  const n = 3;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([x, y, z0 + ((z1 - z0) * i) / (n - 1)]);
  const m = tube(
    pts,
    (t) => {
      const r = r0 + (r1 - r0) * t;
      return ellipseProfile(r, r, seg);
    },
    { capStart: cap, capEnd: cap, up: [0, 1, 0] }
  );
  computeNormals(m);
  return m;
}

/* ------------------------------------------------------------------ */

/**
 * Build a weapon. `style`:
 *   'carbine' — flat-top 5.56 carbine, short optic, collapsible stock
 *   'ak'      — long-stroke rifle, iron sights, side-folding wire stock
 * Returns { steel, polymer, rubber, glass, muzzle:[x,y,z], stock:[x,y,z] }
 * with every mesh already transformed into the actor's bind space.
 */
export function buildWeapon(nz, style = 'carbine', rng) {
  const steel = emptyMesh();
  const poly = emptyMesh();
  const rubber = emptyMesh();
  const glass = emptyMesh();

  const long = style === 'ak';
  const barrelEnd = long ? 0.50 : 0.435;

  /* ---- lower receiver + magwell + grip (polymer) ---- */
  appendMesh(poly, box(0.019, 0.031, 0.055, 0, BORE_Y - 0.036, -0.012, { n: 4.2, roundY: 0.22 }));
  // magwell
  appendMesh(poly, box(0.0165, 0.030, 0.028, 0, BORE_Y - 0.052, 0.004, { n: 4.5, roundY: 0.18 }));
  // trigger guard
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = Math.PI * t;
      pts.push([0, BORE_Y - 0.068 - Math.sin(a) * 0.020, -0.028 + Math.cos(a) * -0.024 + 0.024]);
    }
    const g = ribbon(pts, 0.014, 0.006, { seg: F(5), up: [1, 0, 0] });
    computeNormals(g);
    appendMesh(poly, g);
  }
  // pistol grip: tapered, raked back 22 degrees
  {
    const rake = -0.38;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      pts.push([
        0,
        BORE_Y - 0.052 - t * 0.105,
        -0.028 - Math.sin(rake) * -t * 0.105 * 0.55 - t * 0.030,
      ]);
    }
    const g = tube(pts, (t) => superEllipse(0.0165 - t * 0.002, 0.020 - t * 0.004, 3.4, F(14)), {
      capStart: true,
      capEnd: true,
      up: [0, 0, 1],
    });
    computeNormals(g);
    // finger grooves
    displace(g, (x, y, z) => Math.sin((y - BORE_Y) * 150) * 0.0012 + nz.fbm3(x * 90, y * 90, z * 90, 2) * 0.0012);
    appendMesh(poly, g);
  }

  /* ---- magazine ---- */
  {
    const rings = [];
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const y = BORE_Y - 0.070 - t * (long ? 0.20 : 0.175);
      // STANAG / AK curve: the magazine sweeps forward as it drops
      const z = 0.004 + t * t * (long ? 0.062 : 0.030);
      rings.push({
        pts: superEllipse(0.0135, 0.0225 - t * 0.001, 4.4, F(14)),
        o: [0, y, z],
        q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * (long ? 0.5 : 0.28)),
      });
    }
    const mag = loft(rings, { capStart: true, capEnd: true });
    computeNormals(mag);
    displace(mag, (x, y, z, nx, ny, nzz) => {
      // moulded ribs down the sides
      const rib = Math.sin((y - BORE_Y) * 210) * 0.5 + 0.5;
      return Math.abs(nx) > 0.6 ? rib * 0.0012 : nz.fbm3(x * 80, y * 80, z * 80, 2) * 0.0008;
    });
    appendMesh(poly, mag);
  }

  /* ---- upper receiver (steel) ---- */
  appendMesh(steel, box(0.0175, 0.0225, 0.062, 0, BORE_Y + 0.014, 0.005, { n: 4.4, roundY: 0.22 }));
  // top rail with slots
  {
    const railZ0 = -0.055, railZ1 = long ? 0.06 : 0.145;
    appendMesh(steel, box(0.0115, 0.005, (railZ1 - railZ0) * 0.5, 0, BORE_Y + 0.040, (railZ0 + railZ1) * 0.5, { n: 6, roundY: 0.1 }));
    const n = Math.floor((railZ1 - railZ0) / 0.0102);
    for (let i = 0; i < n; i++) {
      const z = railZ0 + 0.004 + i * 0.0102;
      appendMesh(steel, box(0.0125, 0.0022, 0.0026, 0, BORE_Y + 0.0435, z, { n: 8, rows: R(4), roundY: 0.1 }));
    }
  }
  // ejection port cover on the shooter's right (-X)
  appendMesh(steel, box(0.0035, 0.011, 0.026, -0.018, BORE_Y + 0.012, 0.012, { n: 5, roundY: 0.2 }));
  // forward assist
  appendMesh(steel, cyl(0.007, 0.007, -0.042, -0.026, -0.014, BORE_Y + 0.028, 10));
  // charging handle
  if (!long) {
    appendMesh(steel, box(0.026, 0.005, 0.010, 0, BORE_Y + 0.036, -0.070, { n: 5, roundY: 0.3 }));
    appendMesh(steel, box(0.010, 0.010, 0.004, -0.026, BORE_Y + 0.036, -0.070, { n: 5, roundY: 0.3 }));
  } else {
    // reciprocating handle on the right
    appendMesh(steel, box(0.010, 0.008, 0.020, -0.024, BORE_Y + 0.026, -0.020, { n: 5, roundY: 0.3 }));
  }
  // barrel + gas block + muzzle device
  appendMesh(steel, cyl(0.0105, 0.0098, 0.055, barrelEnd - 0.045, 0, BORE_Y, 12, false));
  appendMesh(steel, box(0.0115, 0.014, 0.014, 0, BORE_Y + 0.008, long ? 0.33 : 0.29, { n: 5, roundY: 0.25 }));
  {
    const mz = cyl(0.0145, 0.0135, barrelEnd - 0.045, barrelEnd, 0, BORE_Y, 14, true);
    // port slots
    displace(mz, (x, y, z, nx, ny, nzz) => {
      const a = Math.atan2(x, y - BORE_Y);
      const slot = Math.abs(Math.sin(a * 3)) > 0.92 && z > barrelEnd - 0.035 ? -0.0035 : 0;
      return slot;
    });
    appendMesh(steel, mz);
  }

  /* ---- handguard ---- */
  {
    const z0 = 0.055, z1 = long ? 0.34 : 0.30;
    const rows = 7;
    const rings = [];
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const r = long ? 0.0255 - t * 0.002 : 0.0245 - t * 0.0025;
      rings.push({
        pts: superEllipse(r, r * (long ? 1.02 : 0.98), long ? 3.0 : 4.0, 18),
        o: [0, BORE_Y - 0.002, z0 + (z1 - z0) * t],
        q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
      });
    }
    const hg = loft(rings, { capStart: false, capEnd: true });
    computeNormals(hg);
    displace(hg, (x, y, z, nx, ny, nzz) => {
      if (long) {
        // ribbed polymer handguard
        const rib = Math.sin(z * 260) * 0.5 + 0.5;
        return rib * 0.0016 + nz.fbm3(x * 70, y * 70, z * 70, 2) * 0.001;
      }
      // M-LOK slots on the sides and bottom
      const side = Math.abs(nx) > 0.55;
      const down = ny < -0.55;
      const slot = ((z * 1000) % 42) < 22 && (side || down) ? -0.0035 : 0;
      return slot + nz.fbm3(x * 70, y * 70, z * 70, 2) * 0.0008;
    });
    appendMesh(long ? poly : steel, hg);
  }

  /* ---- stock ---- */
  if (long) {
    // side-folding wire stock: two rails and a pad
    for (const s of [-1, 1]) {
      const pts = [
        [s * 0.012, BORE_Y - 0.004, -0.055],
        [s * 0.016, BORE_Y - 0.016, -0.135],
        [s * 0.018, BORE_Y - 0.022, -0.235],
      ];
      const r = ribbon(pts, 0.010, 0.008, { seg: F(6), up: [0, 1, 0] });
      computeNormals(r);
      appendMesh(steel, r);
    }
    appendMesh(rubber, box(0.020, 0.036, 0.008, 0, BORE_Y - 0.026, -0.245, { n: 4, roundY: 0.4 }));
    appendMesh(poly, box(0.020, 0.026, 0.030, 0, BORE_Y - 0.018, -0.085, { n: 4, roundY: 0.3 }));
  } else {
    appendMesh(steel, cyl(0.0155, 0.0155, -0.075, -0.225, 0, BORE_Y + 0.002, 12, false));
    // collapsible stock body
    const body = box(0.0215, 0.030, 0.058, 0, BORE_Y - 0.004, -0.175, { n: 3.8, roundY: 0.28 });
    warp(body, (v) => {
      // cheek weld slope
      if (v.y > BORE_Y + 0.008) v.y -= (v.z + 0.175) * -0.12;
    });
    computeNormals(body);
    displace(body, (x, y, z) => nz.fbm3(x * 80, y * 80, z * 80, 2) * 0.0012);
    appendMesh(poly, body);
    appendMesh(poly, box(0.0075, 0.026, 0.048, 0, BORE_Y - 0.034, -0.165, { n: 4, roundY: 0.3 }));
    appendMesh(rubber, box(0.0215, 0.033, 0.007, 0, BORE_Y - 0.004, -0.230, { n: 4, roundY: 0.35 }));
  }

  /* ---- sights / optic ---- */
  if (long) {
    // rear leaf sight + front post
    appendMesh(steel, box(0.010, 0.010, 0.006, 0, BORE_Y + 0.026, -0.040, { n: 5, roundY: 0.3 }));
    appendMesh(steel, box(0.008, 0.016, 0.005, 0, BORE_Y + 0.030, long ? 0.33 : 0.29, { n: 5, roundY: 0.3 }));
  } else {
    // short tube optic on a riser
    appendMesh(steel, box(0.016, 0.016, 0.028, 0, BORE_Y + 0.056, 0.010, { n: 4.4, roundY: 0.25 }));
    const tubeZ0 = -0.018, tubeZ1 = 0.058;
    appendMesh(steel, cyl(0.0205, 0.0205, tubeZ0, tubeZ1, 0, BORE_Y + 0.085, 16, false));
    appendMesh(steel, cyl(0.0225, 0.0225, tubeZ0 - 0.006, tubeZ0 + 0.004, 0, BORE_Y + 0.085, 16, true));
    appendMesh(steel, cyl(0.0225, 0.0225, tubeZ1 - 0.004, tubeZ1 + 0.006, 0, BORE_Y + 0.085, 16, true));
    // lenses
    const l0 = cyl(0.0185, 0.0185, tubeZ0 - 0.0015, tubeZ0 + 0.0015, 0, BORE_Y + 0.085, 16, true);
    const l1 = cyl(0.0185, 0.0185, tubeZ1 - 0.0015, tubeZ1 + 0.0015, 0, BORE_Y + 0.085, 16, true);
    appendMesh(glass, l0);
    appendMesh(glass, l1);
    // adjustment turret
    appendMesh(steel, cyl(0.009, 0.009, 0.012, 0.030, -0.020, BORE_Y + 0.085, 10, true));
  }

  /* ---- sling loops ---- */
  appendMesh(steel, box(0.005, 0.010, 0.006, -0.016, BORE_Y - 0.020, long ? -0.06 : -0.072, { n: 5, roundY: 0.3 }));
  appendMesh(steel, box(0.005, 0.008, 0.006, -0.020, BORE_Y - 0.012, long ? 0.30 : 0.26, { n: 5, roundY: 0.3 }));

  /* ---- bake into the actor's bind space ---- */
  const z = new THREE.Vector3(...BORE_DIR).normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  // a few degrees of cant so nothing is perfectly upright
  const cant = new THREE.Quaternion().setFromAxisAngle(z, (rng ? rng.range(-0.10, -0.03) : -0.06));
  x.applyQuaternion(cant);
  y.applyQuaternion(cant);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(GRIP_R[0], GRIP_R[1], GRIP_R[2]);

  for (const mesh of [steel, poly, rubber, glass]) {
    computeNormals(mesh);
    transformMesh(mesh, m);
  }

  const toBind = (px, py, pz) =>
    new THREE.Vector3(px, py, pz).applyMatrix4(m).toArray();

  return {
    steel,
    polymer: poly,
    rubber,
    glass,
    matrix: m,
    /** in bind space */
    muzzle: toBind(0, BORE_Y, barrelEnd + 0.012),
    boreOrigin: toBind(0, BORE_Y, 0),
    ejection: toBind(-0.024, BORE_Y + 0.012, 0.012),
    stockTop: toBind(0, BORE_Y, -0.10),
    foregrip: toBind(0, BORE_Y - 0.028, long ? 0.22 : 0.205),
    magBottom: toBind(0, BORE_Y - 0.25, 0.03),
  };
}
