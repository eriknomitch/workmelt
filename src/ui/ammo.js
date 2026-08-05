import { el, svg, setText, setStyle, setClass, clamp01, damp, ease } from './util.js';

const MAX_PIPS = 30;

/** Tracking / size steps the weapon name falls back through when it overflows. */
const NAME_FIT = [
  ['.22em', 'calc(12.5px * var(--k))'],
  ['.14em', 'calc(12.5px * var(--k))'],
  ['.1em', 'calc(11px * var(--k))'],
  ['.06em', 'calc(9.5px * var(--k))'],
];

function fragIcon(parent) {
  const s = svg('svg', { viewBox: '0 0 16 20', fill: 'rgba(255,255,255,.92)' }, parent);
  svg('path', { d: 'M6.4 0h3.2v2.1h1.5l1.1 2H3.8l1.1-2h1.5z' }, s);
  svg(
    'path',
    {
      d:
        'M8 4.6c3.1 0 5.6 2.9 5.6 7.1S11.1 20 8 20 2.4 15.9 2.4 11.7 4.9 4.6 8 4.6z',
    },
    s
  );
  const g = svg('g', { stroke: 'rgba(0,0,0,.5)', 'stroke-width': 0.9 }, s);
  for (const y of [9.5, 13, 16.2]) svg('line', { x1: 3, y1: y, x2: 13, y2: y }, g);
  svg('line', { x1: 8, y1: 5, x2: 8, y2: 19.6 }, g);
  return s;
}

function flashIcon(parent) {
  const s = svg('svg', { viewBox: '0 0 16 20', fill: 'rgba(255,255,255,.92)' }, parent);
  svg('path', { d: 'M6.2 0h3.6v2.4H6.2z' }, s);
  svg('path', { d: 'M4.2 3.1h7.6c.5 0 .9.4.9.9v13.4c0 1.4-1.1 2.6-2.6 2.6H5.9c-1.4 0-2.6-1.2-2.6-2.6V4c0-.5.4-.9.9-.9z' }, s);
  svg('rect', { x: 4.6, y: 6.2, width: 6.8, height: 1.2, fill: 'rgba(0,0,0,.45)' }, s);
  svg('rect', { x: 4.6, y: 9.1, width: 6.8, height: 1.2, fill: 'rgba(0,0,0,.45)' }, s);
  return s;
}

/**
 * Ammo / weapon readout, bottom right.
 *
 *              ▲ 2   ✦ 1     equipment — its OWN row
 *   [AUTO]        M4A1
 *              28 / 210
 *   ▮▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯        magazine state, one pip per round
 *
 * Layout contract: the panel is a single column of fixed width pinned to the
 * right margin (`--ammo-w` in style.js) and every row is an explicit grid with
 * an 8 px gutter, so all rows share one left edge and no run can grow sideways
 * into another. The equipment counts used to be an absolutely positioned strip
 * that happened to land on the head row and collided with it.
 *
 * Deliberately understated: three ink levels, no boxes, no icons bigger than
 * the type. The only colour is the low-ammo amber and the empty-mag red.
 */
export class AmmoPanel {
  constructor(parent) {
    this.root = el('div', 'ow-ammo', parent);

    this.equip = el('div', 'ow-equip', this.root);
    this.slotL = el('div', 'ow-slot', this.equip);
    fragIcon(this.slotL);
    this.slotLn = el('span', null, this.slotL, '2');
    this.slotT = el('div', 'ow-slot', this.equip);
    flashIcon(this.slotT);
    this.slotTn = el('span', null, this.slotT, '1');

    const head = el('div', 'ow-ammo-head', this.root);
    this.mode = el('div', 'ow-ammo-mode', head, 'AUTO');
    this.name = el('div', 'ow-ammo-name', head, 'M4A1');

    const row = el('div', 'ow-ammo-row', this.root);
    this.cur = el('div', 'ow-ammo-cur', row, '30');
    this.sep = el('div', 'ow-ammo-sep', row, '/');
    this.res = el('div', 'ow-ammo-res', row, '210');

    this.mag = el('div', 'ow-mag', this.root);
    this.pips = new Array(MAX_PIPS);
    for (let i = 0; i < MAX_PIPS; i++) this.pips[i] = el('b', null, this.mag);

    this.reload = el('div', 'ow-reload', this.root, 'RELOADING');
    const bar = el('div', 'ow-reload-bar', this.root);
    this.reloadFill = el('i', null, bar);
    this.reloadBar = bar;

    this.punch = 0;
    this._lastAmmo = -1;
    this._lastPips = -1;
    this._lastCount = -1;
    this._lastName = null;
    this._nameFit = 0;
    setStyle(this.reload, 'display', 'none');
    setStyle(this.reloadBar, 'display', 'none');
  }

  /**
   * @param {object} s { name, mode, ammo, reserve, magSize, reloading,
   *                     reloadProgress, lethal, lethalCount, tacticalCount }
   */
  update(dt, s) {
    const ammo = Math.max(0, s.ammo | 0);
    const magSize = Math.max(1, s.magSize | 0 || 30);

    if (this._lastAmmo !== ammo) {
      if (this._lastAmmo >= 0 && ammo < this._lastAmmo) this.punch = 1;
      this._lastAmmo = ammo;
      setText(this.cur, ammo);
    }
    setText(this.res, Math.max(0, s.reserve | 0));
    this._fitName(String(s.weaponName ?? s.name ?? 'M4A1'));
    setText(this.mode, s.fireMode ?? 'AUTO');

    this.punch = Math.max(0, this.punch - dt * 6.5);
    const p = 1 - 0.075 * ease.outQuad(this.punch);
    setStyle(this.cur, 'transform', `scale(${p.toFixed(3)})`);

    const frac = ammo / magSize;
    const low = ammo > 0 && frac <= 0.34;
    setClass(this.root, 'ow-ammo-low', low);
    setClass(this.root, 'ow-ammo-empty', ammo === 0);

    const reloading = !!s.reloading;
    const reloadP = clamp01(s.reloadProgress ?? 0);

    // --- magazine pips ----------------------------------------------------
    // The strip shows the state of the magazine that is *in the gun*. During a
    // reload that is not the pre-reload count: the old mag leaves (strip
    // empties) and the fresh one seats (strip fills to what the gun will
    // actually hold). Drawing a nearly full strip next to RELOADING and a
    // progress bar is a straight contradiction.
    const pipCount = Math.min(MAX_PIPS, magSize);
    if (pipCount !== this._lastPips) {
      this._lastPips = pipCount;
      for (let i = 0; i < MAX_PIPS; i++)
        setStyle(this.pips[i], 'display', i < pipCount ? '' : 'none');
    }
    let pipAmmo = ammo;
    if (reloading) {
      const after = Math.min(magSize, ammo + Math.max(0, s.reserve | 0));
      pipAmmo =
        reloadP < 0.45
          ? ammo * (1 - reloadP / 0.45) // mag out
          : after * ((reloadP - 0.45) / 0.55); // mag in
    }
    const filled =
      pipAmmo <= 0.001
        ? 0
        : Math.max(1, Math.round((pipAmmo / magSize) * pipCount));
    if (filled !== this._lastCount) {
      this._lastCount = filled;
      for (let i = 0; i < pipCount; i++) {
        const on = i < filled;
        setClass(this.pips[i], 'off', !on);
        setClass(this.pips[i], 'warn', on && !reloading && filled / pipCount <= 0.34);
      }
    }

    // --- reload state -----------------------------------------------------
    // Three rungs: RELOADING while the mag is out, a loud pulsing prompt on an
    // empty gun, and a quiet RELOAD nudge as soon as the count goes amber —
    // the last only when there is reserve to reload from, so it never asks for
    // the impossible. It stays up until the player actually reloads.
    const nudge = !reloading && (ammo === 0 || (low && (s.reserve | 0) > 0));
    setStyle(this.reload, 'display', reloading || nudge ? '' : 'none');
    setText(this.reload, reloading ? 'RELOADING' : ammo === 0 ? 'PRESS R TO RELOAD' : 'RELOAD');
    if (!reloading && ammo === 0) {
      // pulse the prompt so an empty gun is impossible to miss
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin((s.time ?? 0) * 3.8));
      setStyle(this.reload, 'opacity', pulse.toFixed(3));
    } else {
      setStyle(this.reload, 'opacity', '1');
    }
    setStyle(this.reloadBar, 'display', reloading ? '' : 'none');
    if (reloading) setStyle(this.reloadFill, 'transform', `scaleX(${reloadP.toFixed(3)})`);

    // --- equipment --------------------------------------------------------
    const lc = s.lethalCount ?? 0;
    const tc = s.tacticalCount ?? 0;
    setText(this.slotLn, lc);
    setText(this.slotTn, tc);
    setClass(this.slotL, 'empty', lc <= 0);
    setClass(this.slotT, 'empty', tc <= 0);
  }

  /**
   * Measure the weapon-name glyph run against the column it has to live in and
   * step tracking, then size, down until it fits. A long name is the only run
   * in the block that can push its row out of the grid, and it changes on a
   * weapon swap, so it is measured exactly once per name.
   */
  _fitName(name) {
    if (this._lastName === name) return;
    this._lastName = name;
    setText(this.name, name);
    for (let i = 0; i < NAME_FIT.length; i++) {
      setStyle(this.name, 'letter-spacing', NAME_FIT[i][0]);
      setStyle(this.name, 'font-size', NAME_FIT[i][1]);
      if (this.name.scrollWidth <= this.name.clientWidth + 1) break;
    }
  }

  dispose() {
    this.root.remove();
  }
}
