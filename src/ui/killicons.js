/**
 * Killfeed icons — side-profile silhouettes, muzzle to the right, the way a
 * CoD-style feed draws the weapon between the two names.
 *
 * Pure data and pure functions: no DOM, no THREE, so `killicons.selftest.mjs`
 * can check from Node that every weapon the game can kill with resolves to a
 * drawn icon rather than the fallback. A gun added to `defs.js` without an
 * entry here would still render — as a rifle — which is exactly the kind of
 * silent miss the selftest is for.
 *
 * Each icon is ONE path filled with the nonzero rule. Solid parts are wound
 * clockwise (screen space, y down) so overlapping parts union cleanly; cut-outs
 * (thumbhole, skull eyes, fullers) are wound counter-clockwise so they punch
 * through to the row's scrim instead of needing a second, dark fill colour.
 */

/** Clockwise rectangle — a solid part. */
const rect = (x, y, w, h) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
/** Counter-clockwise rectangle — a cut-out. */
const hole = (x, y, w, h) => `M${x} ${y}V${y + h}H${x + w}V${y}Z`;
/** Polygon through the points in the order given (wind it yourself). */
const poly = (...pts) => {
  let d = '';
  for (let i = 0; i < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]}`;
  return `${d}Z`;
};
/** Circle, clockwise (`cw`) for a solid disc or counter-clockwise for a hole. */
const circle = (cx, cy, r, cw = true) => {
  const s = cw ? 1 : 0;
  return `M${cx - r} ${cy}a${r} ${r} 0 1 ${s} ${2 * r} 0a${r} ${r} 0 1 ${s} ${-2 * r} 0Z`;
};

// The skull is shared by the headshot reticle and the bare "no killer" icon.
const SKULL =
  'M12 5.6C15.6 5.6 17.6 8 17.6 10.9C17.6 12.7 16.8 13.8 15.8 14.5V16.4H8.2V14.5' +
  'C7.2 13.8 6.4 12.7 6.4 10.9C6.4 8 8.4 5.6 12 5.6Z' +
  rect(9.2, 16.4, 5.6, 2) +
  hole(11.1, 16.9, 0.6, 1.5) +
  hole(12.3, 16.9, 0.6, 1.5) +
  circle(10, 11.2, 1.6, false) +
  circle(14, 11.2, 1.6, false) +
  poly(12, 13.1, 11.2, 14.6, 12.8, 14.6);

/**
 * `vb` is the viewBox, `h` the displayed height in reference pixels (scaled by
 * the HUD's `--k`); the displayed width follows from the viewBox aspect.
 */
export const KILL_ICONS = {
  // M4A1 — collapsible stock, flat-top rail, front sight post, curved mag.
  rifle: {
    vb: [0, 0, 64, 20],
    h: 22,
    d:
      poly(1, 5.6, 12.5, 6.2, 12.5, 7, 17, 7, 17, 9.6, 12.5, 9.6, 12.5, 11.2, 7, 11.6, 3.6, 14.6, 1, 14.6) +
      rect(16.5, 4.6, 16.5, 6) +
      rect(17, 3.2, 29, 1.4) +
      rect(18, 1.6, 3.2, 1.6) +
      rect(33, 5, 14, 5) +
      hole(35, 7, 10, 0.8) +
      poly(43.4, 1.4, 44.8, 1.4, 45.6, 5, 42.6, 5) +
      rect(47, 6.6, 11, 1.8) +
      rect(58, 6, 4.5, 3) +
      poly(25.4, 10.6, 30.4, 10.6, 32.2, 17.8, 27.6, 18.6) +
      poly(18.2, 10.6, 22, 10.6, 20.6, 16.6, 17, 16) +
      rect(21.6, 12.6, 4, 0.8),
  },
  // AK — the irregulars' rifle: fixed stock, gas tube, forward-swept mag.
  ak: {
    vb: [0, 0, 62, 20],
    h: 22,
    d:
      poly(1, 7.2, 13, 6.2, 17, 6.4, 17, 9.8, 13, 10, 6, 13.6, 1, 14.4) +
      rect(16.5, 5.4, 15.5, 4.8) +
      rect(17, 4.6, 14, 0.8) +
      poly(30, 4.6, 33, 3.8, 33, 5.4, 30, 5.4) +
      rect(32, 6.4, 10, 3.8) +
      rect(32, 4.4, 12, 1.6) +
      rect(42, 6.8, 15, 1.6) +
      rect(43.5, 4.6, 2, 3.6) +
      poly(53.6, 3.6, 55, 3.6, 55.4, 6.8, 53, 6.8) +
      rect(57, 6.4, 4, 2.4) +
      'M24.6 10.2H29.4C30.6 13 32.2 15.6 34.2 17.4L30.4 19.2C28 17 25.8 13.6 24.6 10.2Z' +
      poly(19, 10.2, 22.4, 10.2, 21, 16.4, 17.6, 15.8) +
      rect(22, 12.2, 2.8, 0.8),
  },
  // MPX-9 — skeleton stock, short handguard, straight magazine.
  smg: {
    vb: [0, 0, 49, 20],
    h: 22,
    d:
      poly(1, 6, 9.5, 6.4, 9.5, 7.6, 13, 7.6, 13, 9.4, 9.5, 9.4, 9.5, 12.6, 1, 13) +
      hole(3, 8, 4.6, 3.2) +
      rect(12.6, 4.8, 17.4, 5.8) +
      rect(13.2, 3.4, 24, 1.4) +
      rect(14, 2, 2.6, 1.4) +
      rect(35.6, 2, 1.4, 1.4) +
      rect(30, 5.4, 9, 4.6) +
      rect(39, 6.4, 5.5, 2) +
      rect(44.5, 5.9, 3.5, 3) +
      poly(21.6, 10.6, 25.4, 10.6, 26.6, 18.4, 22.6, 18.6) +
      poly(14, 10.6, 17.6, 10.6, 16.4, 16.2, 12.8, 15.6) +
      rect(17.2, 12.4, 4.6, 0.8),
  },
  // G31 — polymer-frame pistol: slide with serrations, raked grip.
  pistol: {
    vb: [0, 0, 29, 20],
    h: 22,
    d:
      rect(2, 4, 25, 4.6) +
      hole(4.4, 4.8, 0.5, 3) +
      hole(5.6, 4.8, 0.5, 3) +
      hole(6.8, 4.8, 0.5, 3) +
      rect(3, 3.2, 1.6, 0.8) +
      rect(24.6, 3.2, 1.2, 0.8) +
      rect(4, 8.6, 21, 1.8) +
      poly(4.2, 10.4, 10.6, 10.4, 8.8, 18.6, 2.4, 18.2) +
      poly(10.6, 10.4, 15.6, 10.4, 14.6, 13.6, 10, 13.6) +
      poly(11.2, 11.2, 11, 12.8, 13.7, 12.8, 14.4, 11.2) +
      rect(12, 11.2, 0.7, 1.4),
  },
  // AX-7 — thumbhole stock, bolt handle, long scope, braked barrel, bipod.
  sniper: {
    vb: [0, 0, 70, 20],
    h: 22,
    d:
      poly(1, 5.4, 15, 6.6, 20.5, 7, 20.5, 11.4, 16, 11.4, 12.6, 13.4, 9.6, 15.4, 1, 15.4) +
      poly(13, 8.6, 11, 11.6, 15.4, 10.8, 16.4, 8.6) +
      rect(20.5, 6.4, 15.5, 4.4) +
      poly(30.4, 10.8, 31.8, 10.8, 33.4, 13.4, 32.4, 14.2) +
      rect(25, 2.6, 15, 2.2) +
      poly(21, 1.8, 25, 2.2, 25, 5.2, 21, 5.6) +
      poly(40, 2.2, 45, 1, 45, 6.4, 40, 5.2) +
      rect(31.4, 1.2, 2.2, 1.4) +
      rect(27, 4.8, 1.8, 1.6) +
      rect(36.2, 4.8, 1.8, 1.6) +
      poly(36, 6.6, 52, 6.6, 52, 9.6, 36, 10.6) +
      poly(52, 7.2, 64, 7.4, 64, 8.8, 52, 9) +
      rect(64, 6.6, 5.2, 2.8) +
      rect(44, 9.8, 8, 0.9) +
      rect(25.4, 10.8, 4.2, 3.4) +
      poly(21.4, 10.8, 25, 10.8, 24, 15.8, 20.6, 15.2),
  },
  // Combat knife — the melee swing.
  knife: {
    vb: [0, 0, 40, 20],
    h: 22,
    d:
      rect(1, 7.6, 1.6, 5) +
      poly(2, 8.2, 14.6, 7.8, 14.6, 12.4, 2, 12) +
      hole(5, 9, 1, 2.4) +
      hole(8, 9, 1, 2.4) +
      hole(11, 9, 1, 2.4) +
      rect(14.6, 5, 2, 10) +
      'M16.6 7.6H31C34.5 7.6 37 8.6 39 10.4C36.4 12 33.6 12.6 30 12.6H16.6Z' +
      hole(19, 9.2, 10, 0.7),
  },
  // Frag grenade — body, fuse, spoon and pull ring.
  frag: {
    vb: [0, 0, 20, 20],
    h: 22,
    d:
      circle(10, 12.2, 6.4) +
      hole(4.4, 10.2, 11.2, 0.6) +
      hole(4.4, 13.6, 11.2, 0.6) +
      rect(7.6, 3.6, 4.8, 3) +
      poly(12.4, 3.6, 15, 4, 16.8, 10.8, 15.6, 11.2, 14, 5.4, 12.4, 5.4) +
      circle(5.6, 3.6, 2.4) +
      circle(5.6, 3.6, 1.5, false),
  },
  // Mortar round — the killstreak.
  mortar: {
    vb: [0, 0, 40, 20],
    h: 22,
    d:
      poly(1, 4, 6, 7.6, 6, 12.4, 1, 16) +
      rect(5, 8.2, 6, 3.6) +
      'M10 6.8L24 6.2C30 6.2 35 7.6 38.6 10C35 12.4 30 13.8 24 13.8L10 13.2Z' +
      hole(14, 7, 0.8, 6) +
      hole(16, 6.9, 0.8, 6.2),
  },
  // Headshot — the skull inside a reticle, drawn INSTEAD of the weapon.
  headshot: {
    vb: [0, 0, 24, 24],
    h: 26,
    d:
      circle(12, 12, 10.6) +
      circle(12, 12, 9.3, false) +
      rect(11.35, 0, 1.3, 3.4) +
      rect(11.35, 20.6, 1.3, 3.4) +
      rect(0, 11.35, 3.4, 1.3) +
      rect(20.6, 11.35, 3.4, 1.3) +
      SKULL,
  },
  // No credited killer: a fall, an environmental blast, your own grenade.
  skull: {
    vb: [5.4, 4.6, 13.2, 14.8],
    h: 20,
    d: SKULL,
  },
};

/**
 * Weapon id (as it rides on events) -> icon key. `carbine` / `ak` are the bot
 * variants' guns (`VARIANTS[*].weapon` in src/ai/soldier.js) and `ai_rifle` the
 * generic bot round; `melee` is the knife swing; `frag`/`mortar` ride on blasts.
 */
export const WEAPON_ICON = {
  rifle: 'rifle',
  carbine: 'rifle',
  ak: 'ak',
  ai_rifle: 'rifle',
  smg: 'smg',
  g31: 'pistol',
  sniper: 'sniper',
  melee: 'knife',
  frag: 'frag',
  mortar: 'mortar',
};

/** What a weapon id draws when nothing maps it — exported for the selftest. */
export const FALLBACK_ICON = 'rifle';

/**
 * Which icon a killfeed row draws.
 *   - a headshot replaces the weapon with the reticle skull;
 *   - no attacker (a fall, a stray blast, your own grenade) draws the bare
 *     skull, since "<weapon> Victim" with nobody holding it reads as a bug;
 *   - otherwise the weapon's silhouette, or the fallback for an unknown id.
 * `weapon` may be an id string or a def object with an `id`.
 */
export function killIcon(weapon, headshot = false, hasAttacker = true) {
  if (headshot) return 'headshot';
  if (!hasAttacker) return 'skull';
  const id = typeof weapon === 'string' ? weapon : weapon?.id;
  return (id && WEAPON_ICON[id]) || FALLBACK_ICON;
}
