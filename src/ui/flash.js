import { el, setStyle, clamp01, ease } from './util.js';

/**
 * FLASHBANG — the screen half of a stun detonation.
 *
 * Three stacked stages, because a single white div reads as a bug rather than a
 * blast:
 *   1. bloom    hard white, fully opaque at point blank, decays fastest
 *   2. bleach   a lingering wash that desaturates and lifts the black point,
 *               so the world comes back *through* a haze rather than snapping
 *   3. afterimage a soft radial ghost burned where the blast was, which is what
 *               actually makes it feel ocular instead of like a screen fade
 *
 * Intensity is set by the caller from range AND view angle: a stun behind you
 * still bleaches (light bounces) but must never full-white, or the player is
 * blinded by something they could not have seen coming.
 *
 * The HUD deliberately fades with the flash — `hudDim` is read by the HUD root
 * opacity — because keeping a crisp ammo counter legible over a whiteout tells
 * the player their eyes are fine.
 */
export class FlashFx {
  /** @param {HTMLElement} parent full-screen layer, mounted ABOVE the HUD */
  constructor(parent) {
    this.root = el('div', 'ow-flash', parent);
    this.bloom = el('div', 'ow-flash-bloom', this.root);
    this.bleach = el('div', 'ow-flash-bleach', this.root);
    this.ghost = el('div', 'ow-flash-ghost', this.root);

    /** 0..1 peak set on detonation, decays to 0. */
    this.level = 0;
    this._duration = 1;
    this._t = 0;
    this._active = false;
    /** Where the blast was, in screen space, for the afterimage. */
    this._gx = 50;
    this._gy = 50;

    this._shownBloom = -1;
    this._shownBleach = -1;
    this._shownGhost = -1;
    setStyle(this.root, 'display', 'none');
  }

  /**
   * @param {number} intensity 0..1 — range and facing already folded in
   * @param {number} duration  seconds of the full decay at intensity 1
   * @param {number} sx        blast x in screen percent (0..100)
   * @param {number} sy        blast y in screen percent (0..100)
   */
  trigger(intensity, duration, sx = 50, sy = 50) {
    const i = clamp01(intensity);
    if (i <= 0.01) return;
    // A second stun mid-blind tops up rather than restarting, so two overlapping
    // flashes cannot come out dimmer than one.
    this.level = Math.max(this.level, i);
    this._duration = Math.max(this._duration * clamp01(1 - this._t / this._duration), duration * i);
    this._t = 0;
    this._active = true;
    this._gx = sx;
    this._gy = sy;
    setStyle(this.root, 'display', '');
  }

  /** 0..1 — how much the rest of the HUD should be suppressed. */
  get hudDim() {
    return this._active ? clamp01(this.level * 1.15) : 0;
  }

  get active() {
    return this._active;
  }

  clear() {
    this.level = 0;
    this._t = 0;
    this._active = false;
    setStyle(this.root, 'display', 'none');
  }

  update(dt) {
    if (!this._active) return;
    this._t += dt;
    const p = clamp01(this._t / this._duration);
    if (p >= 1) {
      this.clear();
      return;
    }

    // The bloom is gone in the first third; the bleach carries the rest, and
    // the ghost trails both so the last thing to fade is the burned-in spot.
    const bloom = this.level * (1 - ease.outCubic(clamp01(p / 0.34)));
    const bleach = this.level * (1 - ease.inOutSine(p)) * 0.72;
    const ghost = this.level * (1 - p) * (1 - clamp01(p / 0.85)) * 0.5;

    this._set(this.bloom, '_shownBloom', bloom);
    this._set(this.bleach, '_shownBleach', bleach);
    this._set(this.ghost, '_shownGhost', ghost);
    if (this._shownGhost > 0.002) {
      setStyle(this.ghost, 'background', this._ghostGradient());
    }
  }

  _ghostGradient() {
    return (
      `radial-gradient(ellipse 34% 30% at ${this._gx.toFixed(1)}% ${this._gy.toFixed(1)}%, ` +
      'rgba(255,252,242,.9) 0%, rgba(255,244,220,.35) 45%, rgba(255,240,210,0) 72%)'
    );
  }

  /** Only touch the DOM when the value actually moved a visible amount. */
  _set(node, key, v) {
    const c = clamp01(v);
    if (Math.abs(c - this[key]) < 0.004) return;
    this[key] = c;
    setStyle(node, 'opacity', c.toFixed(3));
  }
}
