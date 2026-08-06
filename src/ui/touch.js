import { el, setStyle } from './util.js';

/**
 * ===========================================================================
 * Touch controls — the on-screen control scheme for phones and tablets
 * ===========================================================================
 *
 * Mounted by UiSystem only when `config.touchMode` is true (decided once at
 * boot by `detectTouchMode()` in src/core/input.js). Everything here drives
 * the existing input snapshot rather than any gameplay system directly:
 *
 *   left half     dynamic virtual joystick -> input.setTouchMove()
 *                 (nipple.js-style: the stick base appears where the thumb
 *                 lands, so there is no fixed target to miss. Implemented
 *                 in-house — the repo ships no third-party runtime code.)
 *   right half    drag to look             -> input.touchLook() (raw px)
 *   buttons       press/release synthetic codes -> input.touchPress/Release()
 *                 so fire is a held 'Mouse0', a grenade cooks on a held
 *                 'KeyG', and pause is a tapped 'Escape' — gameplay cannot
 *                 tell a thumb from a keyboard.
 *   ADS           input.toggleAds() — always a toggle, same latch as the
 *                 keyboard bind; sprint breaks it, the menu clears it.
 *   full forward  sprint (handled by player/movement.js at >0.92 deflection,
 *                 mirroring the gamepad rule).
 *
 * Layout notes: control sizes are raw px, NOT the HUD's `--k` viewport scale.
 * Thumbs are a physical size; a button that shrinks with the viewport is a
 * button a phone player cannot hit. The HUD exemption in DESIGN.md covers
 * this file's visual treatment (outlined, over a live scene).
 *
 * Multi-touch is per-control via Pointer Events + setPointerCapture, so a
 * thumb on the stick, a thumb on the look zone and a finger on the trigger
 * coexist. The `touchstart`/`touchend` preventDefault below is what stops
 * the browser from synthesising mouse events (which would fire the weapon
 * through `Input._onMouseDown`) and from scrolling/zooming the page.
 */

/** Stick geometry (CSS px). */
export const STICK = { radius: 60, deadzone: 0.12, sprintAt: 0.92 };

/**
 * Drag offset -> stick vector in the game convention (+y forward), with a
 * radial deadzone and re-normalisation so the first usable value is small
 * rather than a jump to `deadzone`. Pure — covered by touch.selftest.mjs.
 */
export function stickVector(dx, dy, radius = STICK.radius, deadzone = STICK.deadzone) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0, mag: 0 };
  const mag = Math.min(1, len / radius);
  if (mag < deadzone) return { x: 0, y: 0, mag: 0 };
  const t = (mag - deadzone) / (1 - deadzone);
  const s = t / len;
  return { x: dx * s, y: -dy * s, mag: t };
}

/* 1.5px-stroke glyphs, enterprise-icon language: no skulls, no crosshairs. */
const G = {
  fire: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
  ads: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/></svg>',
  crouch: '<svg viewBox="0 0 24 24"><path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 11-2-4.9"/><path d="M17.5 3.5v4h-4"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M8 7h11M15.5 3.5L19 7l-3.5 3.5"/><path d="M16 17H5M8.5 13.5L5 17l3.5 3.5"/></svg>',
  lethal: '<svg viewBox="0 0 24 24"><rect x="7.5" y="8" width="9" height="12" rx="4.5"/><path d="M10 8V5.5h4V8M14 5.5h3.5"/></svg>',
  tactical: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="12" rx="2"/><path d="M10 8V4.5h4V8"/><path d="M12 12.5v3"/></svg>',
  use: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M9.5 12l2 2 3.5-4"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5.5v13M15 5.5v13"/></svg>',
};

/**
 * The button roster. `hold` buttons press on finger-down and release on
 * finger-up (autofire, stance, grenade cooking); the rest act on the tap.
 * Codes are real `KeyboardEvent.code`s / mouse pseudo-codes from
 * `ACTIONS` in src/core/input.js — the selftest asserts the mapping.
 */
export const TOUCH_BUTTONS = [
  { id: 'fire', code: 'Mouse0', hold: true, glyph: 'fire', cls: 'fire' },
  { id: 'fire2', code: 'Mouse0', hold: true, glyph: 'fire', cls: 'fire2' },
  { id: 'ads', action: 'toggleAds', glyph: 'ads', cls: 'ads' },
  { id: 'jump', code: 'Space', hold: true, glyph: 'jump', cls: 'jump' },
  { id: 'crouch', code: 'KeyC', hold: true, glyph: 'crouch', cls: 'crouch' },
  { id: 'reload', code: 'KeyR', glyph: 'reload', cls: 'reload' },
  { id: 'swap', action: 'wheel', glyph: 'swap', cls: 'swap' },
  { id: 'lethal', code: 'KeyG', hold: true, glyph: 'lethal', cls: 'lethal' },
  { id: 'tactical', code: 'KeyH', hold: true, glyph: 'tactical', cls: 'tactical' },
  { id: 'use', code: 'KeyF', glyph: 'use', cls: 'use' },
  { id: 'pause', action: 'pause', glyph: 'pause', cls: 'pause' },
];

export class TouchControls {
  /**
   * @param parent  the HUD root (`.ow-hud`) — the overlay is HUD chrome
   * @param ctx     engine context (input, config, events)
   * @param ui      the owning UiSystem, for menu/prompt state
   */
  constructor(parent, ctx, ui) {
    this.ctx = ctx;
    this.ui = ui;
    // NOT class `ow-touch` — that is the mode marker already on the HUD root,
    // and sharing it would leak this container's positioning onto the HUD.
    this.root = el('div', 'ow-touchctl', parent);

    // Kill synthetic mouse events (they would re-enter Input._onMouseDown and
    // fire the weapon) and every default touch gesture over the game. Not
    // passive — preventDefault is the point.
    this._prevent = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    for (const type of ['touchstart', 'touchmove', 'touchend'])
      this.root.addEventListener(type, this._prevent, { passive: false });
    this.root.addEventListener('contextmenu', this._prevent);

    // ---- zones -----------------------------------------------------------
    this.moveZone = el('div', 'ow-touch-zone move', this.root);
    this.lookZone = el('div', 'ow-touch-zone look', this.root);

    // ---- virtual stick ---------------------------------------------------
    this.stick = el('div', 'ow-stick', this.root);
    el('div', 'ow-stick-ring', this.stick);
    this.nub = el('div', 'ow-stick-nub', this.stick);
    this._movePointer = null;
    this._base = { x: 0, y: 0 };

    const mz = this.moveZone;
    mz.addEventListener('pointerdown', (e) => {
      if (this._movePointer !== null) return;
      this._movePointer = e.pointerId;
      mz.setPointerCapture(e.pointerId);
      const r = mz.getBoundingClientRect();
      const m = STICK.radius * 0.55;
      this._base.x = Math.min(r.right - m, Math.max(r.left + m, e.clientX));
      this._base.y = Math.min(r.bottom - m, Math.max(r.top + m, e.clientY));
      this._placeStick(0, 0);
      this.stick.classList.add('on');
      this._applyStick(e.clientX, e.clientY);
    });
    mz.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._movePointer) return;
      this._applyStick(e.clientX, e.clientY);
    });
    const endMove = (e) => {
      if (e.pointerId !== this._movePointer) return;
      this._movePointer = null;
      this.stick.classList.remove('on', 'sprint');
      this.ctx.input.setTouchMove(0, 0);
    };
    mz.addEventListener('pointerup', endMove);
    mz.addEventListener('pointercancel', endMove);
    // Capture can be torn down without a pointerup reaching us (multi-finger
    // lifts under some browsers, element removal): a stuck stick is a player
    // running into a wall, so treat lost capture as a release too.
    mz.addEventListener('lostpointercapture', endMove);

    // ---- look ------------------------------------------------------------
    this._lookPointer = null;
    this._last = { x: 0, y: 0 };
    const lz = this.lookZone;
    lz.addEventListener('pointerdown', (e) => {
      if (this._lookPointer !== null) return;
      this._lookPointer = e.pointerId;
      lz.setPointerCapture(e.pointerId);
      this._last.x = e.clientX;
      this._last.y = e.clientY;
    });
    lz.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookPointer) return;
      this.ctx.input.touchLook(e.clientX - this._last.x, e.clientY - this._last.y);
      this._last.x = e.clientX;
      this._last.y = e.clientY;
    });
    const endLook = (e) => {
      if (e.pointerId === this._lookPointer) this._lookPointer = null;
    };
    lz.addEventListener('pointerup', endLook);
    lz.addEventListener('pointercancel', endLook);
    lz.addEventListener('lostpointercapture', endLook);

    // ---- buttons ---------------------------------------------------------
    this.buttons = new Map();
    this._held = new Set();
    for (const def of TOUCH_BUTTONS) this._buildButton(def);

    this.shown = false;
    this.root.classList.add('off');
  }

  _placeStick(dx, dy) {
    setStyle(this.stick, 'transform', `translate(${this._base.x}px, ${this._base.y}px)`);
    setStyle(this.nub, 'transform', `translate(${dx}px, ${dy}px)`);
  }

  _applyStick(cx, cy) {
    const dx = cx - this._base.x;
    const dy = cy - this._base.y;
    const v = stickVector(dx, dy);
    this.ctx.input.setTouchMove(v.x, v.y);
    // Nub tracks the finger, clamped to the ring.
    const len = Math.hypot(dx, dy) || 1;
    const c = Math.min(len, STICK.radius);
    this._placeStick((dx / len) * c, (dy / len) * c);
    this.stick.classList.toggle('sprint', v.y > STICK.sprintAt);
  }

  _buildButton(def) {
    const b = el('div', `ow-tbtn ${def.cls}`, this.root);
    b.innerHTML = G[def.glyph];
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', def.id);
    const input = () => this.ctx.input;

    b.addEventListener('pointerdown', (e) => {
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      if (def.action === 'toggleAds') input().toggleAds();
      else if (def.action === 'wheel') input().touchWheel(1);
      else if (def.action === 'pause') input().touchTap('Escape');
      else if (def.hold) {
        input().touchPress(def.code);
        this._held.add(def.code);
      } else input().touchTap(def.code);
    });
    const release = () => {
      b.classList.remove('down');
      if (def.hold && def.code) {
        input().touchRelease(def.code);
        this._held.delete(def.code);
      }
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    // A release must never be missable — a stuck trigger is the worst possible
    // failure of this overlay. Double releases are harmless (a redundant
    // pendingUp on an already-up code is a no-op in Input).
    b.addEventListener('lostpointercapture', release);
    this.buttons.set(def.id, b);
  }

  /** Let go of everything held — called whenever the overlay loses the stage. */
  releaseAll() {
    for (const code of this._held) this.ctx.input.touchRelease(code);
    this._held.clear();
    this._movePointer = null;
    this._lookPointer = null;
    this.stick.classList.remove('on', 'sprint');
    this.ctx.input.setTouchMove(0, 0);
    for (const b of this.buttons.values()) b.classList.remove('down');
  }

  /** Driven from UiSystem.lateUpdate with unscaled time. */
  update(rawDt, ctx) {
    const show = ctx.input.enabled && !ctx.input.frozen && !this.ui.menu.open;
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('off', !show);
      if (!show) this.releaseAll();
    }
    if (!show) return;
    this.buttons.get('ads')?.classList.toggle('latched', ctx.input.ads);
    // The USE button only earns screen space while something is interactable.
    const use = this.buttons.get('use');
    if (use) use.classList.toggle('hidden', !this.ui.prompt?.active);
  }

  dispose() {
    this.releaseAll();
    for (const type of ['touchstart', 'touchmove', 'touchend'])
      this.root.removeEventListener(type, this._prevent);
    this.root.removeEventListener('contextmenu', this._prevent);
    this.root.remove();
  }
}
