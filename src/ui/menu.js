import { el, setText, setStyle, clamp, damp, ease } from './util.js';
import { installBrand } from './brand.js';
import {
  ADS_MODES,
  DEFAULT_CONTROLS,
  isBindableKey,
  keyLabel,
  saveControlSettings,
} from '../core/controls.js';

const GRAPHICS_MODES = ['auto', 'low', 'medium', 'high', 'ultra'];
const FPS_TARGETS = ['display', '30', '60', '90', '120', '144', '165', '240'];

/**
 * ===========================================================================
 * Pause / settings menu
 * ===========================================================================
 *
 * Wired straight into `ctx.config`: the quality segments call
 * `config.setQuality`, the sliders write `config.sensitivity` and `config.fov`
 * (and push the FOV into the live camera), and every change is announced on the
 * event bus so render/player can react without importing this module.
 *
 * ---------------------------------------------------------------------------
 * THE MOUSE, WHICH IS THE WHOLE POINT OF THIS FILE
 * ---------------------------------------------------------------------------
 * This menu was previously close to unusable, for three separate reasons that
 * all looked like the same bug ("I can't see my cursor"):
 *
 *  1. `#game` carried `cursor: none` unconditionally, so releasing pointer lock
 *     released an INVISIBLE cursor. Fixed in index.html: the canvas only hides
 *     the cursor while `body.wm-pointer-locked` is set, and `core/input.js`
 *     sets that class from the one authoritative source, `pointerlockchange`.
 *
 *  2. `core/input.js` re-grabs pointer lock on ANY left click. Clicking a
 *     settings row therefore swallowed the cursor again mid-interaction. Fixed
 *     here: `show()` puts `ctx.input.enabled` down for the duration, so the
 *     menu owns the mouse outright, and `close()` puts it back only if it was
 *     up when we arrived (opening settings from the lobby must not hand
 *     gameplay input back).
 *
 *  3. With input disabled, Escape can no longer reach the game's action map —
 *     so the menu listens for it itself, in the capture phase, and yields to a
 *     rebind in progress.
 *
 * The fourth failure lived in `ui/index.js`: browsers refuse a pointer-lock
 * request for ~1s after a user-initiated Escape, so "Resume" often left the
 * game unlocked, which the lost-lock watchdog instantly read as another pause.
 * The menu re-opened itself. That watchdog now re-arms only after lock is
 * actually observed, and until it is, `setLockHint(true)` puts a click-to-
 * resume target on screen instead of a menu nobody asked for.
 *
 * Events emitted: `ui:pause` {paused}, `ui:quality` {quality},
 * `ui:sensitivity` {value}, `ui:fov` {value}, `ui:setting` {key, value}.
 */
export class PauseMenu {
  constructor(parent, ctx) {
    // This menu is the only brand surface that exists on a capture run (the
    // lobby and the multiplayer overlay are both off), so it is also the one
    // that has to keep the webfont out of the pixel gate. See installBrandFont.
    installBrand({ webfont: !ctx.config.deterministic });
    this.ctx = ctx;
    this.root = el('div', 'ow-menu', parent);

    // Clicking the scrim resumes. It is the largest target on the screen and it
    // is what every player already tries first.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });

    const panel = el('div', 'ow-menu-inner', this.root);
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    const head = el('div', 'ow-menu-hd', panel);
    const titles = el('div', null, head);
    this.title = el('h1', null, titles, 'PAUSED');
    this.subtitle = el('div', 'sub', titles, 'WORKMELT — TACTICAL OPERATIONS');
    el('div', 'grow', head);
    this.closeBtn = el('button', 'ow-x', head);
    // 1.5px stroke, sharp geometry — the icon language in DESIGN.md.
    this.closeBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>';
    this.closeBtn.type = 'button';
    this.closeBtn.title = 'Resume (Esc)';
    this.closeBtn.setAttribute('aria-label', 'Close settings');
    this.closeBtn.addEventListener('click', () => this.close());

    this.rows = el('div', 'ow-menu-bd', panel);

    // ---- display ---------------------------------------------------------
    this._group('Display');
    this.graphicsBtns = [];
    const qRow = this._row('Graphics');
    const seg = el('div', 'ow-seg', qRow);
    for (const p of GRAPHICS_MODES) {
      const b = el('button', null, seg, p);
      b.type = 'button';
      b.addEventListener('click', () => this.setGraphicsMode(p));
      this.graphicsBtns.push(b);
    }

    const targetRow = this._row('FPS Target');
    this.target = el('select', 'ow-select', targetRow);
    for (const value of FPS_TARGETS) {
      const option = el('option', null, this.target, value === 'display' ? 'Display' : `${value} FPS`);
      option.value = value;
      if (value === 'display') this.displayTargetOption = option;
    }
    this.target.addEventListener('change', () =>
      this.ctx.peek('quality')?.setTarget(this.target.value)
    );

    const statusRow = this._row('Auto Status');
    this.qualityStatus = el('div', 'val ow-quality-status', statusRow, '--');

    // ---- field of view ---------------------------------------------------
    this.fov = this._slider('Field Of View', 65, 120, 1, (v) => {
      this.ctx.config.fov = v;
      const cam = this.ctx.camera;
      if (cam) {
        cam.fov = v;
        cam.updateProjectionMatrix();
      }
      this.ctx.events.emit('ui:fov', { value: v });
      return String(v | 0);
    });

    // ---- controls --------------------------------------------------------
    this._group('Controls');

    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v) => {
      this.ctx.config.sensitivity = 0.0022 * v;
      this.ctx.events.emit('ui:sensitivity', { value: this.ctx.config.sensitivity, multiplier: v });
      return v.toFixed(2);
    });

    const invRow = this._row('Invert Look');
    const invSeg = el('div', 'ow-seg', invRow);
    this.invBtns = [];
    for (const [label, val] of [
      ['off', false],
      ['on', true],
    ]) {
      const b = el('button', null, invSeg, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.ctx.config.invertY = val;
        this.ctx.events.emit('ui:setting', { key: 'invertY', value: val });
        this.syncFromConfig();
      });
      this.invBtns.push([b, val]);
    }

    // Trackpad escape hatch: right-mouse-held is a two-finger click on a
    // laptop, which cannot coexist with the one-finger click that fires. Either
    // knob alone solves it; together they take the pointer out of aiming
    // entirely. See `core/controls.js`.
    const adsRow = this._row('Aim (ADS)');
    const adsSeg = el('div', 'ow-seg', adsRow);
    this.adsModeBtns = [];
    for (const mode of ADS_MODES) {
      const b = el('button', null, adsSeg, mode);
      b.type = 'button';
      b.addEventListener('click', () => this._setAdsMode(mode));
      this.adsModeBtns.push([b, mode]);
    }

    const adsKeyRow = this._row('ADS Key');
    this.adsKeyBtn = el('button', 'ow-bind', adsKeyRow, 'X');
    this.adsKeyBtn.type = 'button';
    this.adsKeyBtn.addEventListener('click', () => this._beginRebind());
    this._rebinding = false;
    this._rebindKeydown = null;
    this._keyFlash = 0;

    // ---- footer ----------------------------------------------------------
    const foot = el('div', 'ow-menu-ft', panel);
    const btns = el('div', 'ow-btns', foot);
    this.resumeBtn = el('button', 'ow-btn primary', btns, 'Resume');
    this.resumeBtn.type = 'button';
    this.resumeBtn.addEventListener('click', () => this.close());
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.sens.set(1);
      this.fov.set(80);
      this.ctx.config.invertY = false;
      this._setAdsMode(DEFAULT_CONTROLS.adsMode);
      this._setAdsKey(DEFAULT_CONTROLS.adsKey);
      this.ctx.peek('quality')?.resetDefaults();
    });
    el('div', 'grow', btns);
    // Only offered in a live match — from the lobby there is nothing to leave.
    this.leaveBtn = el('button', 'ow-btn danger', btns, 'Leave match');
    this.leaveBtn.type = 'button';
    this.leaveBtn.addEventListener('click', () => this._leave());
    this.hint = el('div', 'hint', foot, '');

    /**
     * Click-to-resume target, shown when the game is live but the browser has
     * not (yet) given pointer lock back. Lives outside the menu because it is
     * only ever on screen while the menu is closed.
     */
    this.lockHint = el('div', 'ow-lockhint', parent);
    this.lockHint.innerHTML =
      '<span class="t">Click to resume</span><span class="k">Esc</span><span class="s">settings</span>';
    this.lockHint.addEventListener('mousedown', () => this.ctx.input?.requestPointerLock?.());
    setStyle(this.lockHint, 'display', 'none');
    this._lockHint = false;

    // Escape while the menu is open. In the capture phase because `Input` binds
    // on window in the bubble phase, and because this listener must beat the
    // page's own default handling of the key.
    this._onKey = (e) => {
      if (e.key !== 'Escape' || !this.open) return;
      if (this._rebinding) return; // the rebind handler owns Escape (it cancels)
      e.preventDefault();
      e.stopPropagation();
      this.close();
    };

    this.open = false;
    this.shown = 0;
    /** True when close() should hand gameplay input and pointer lock back. */
    this._resumeToGame = false;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this.syncFromConfig();
  }

  _group(label) {
    el('div', 'ow-group', this.rows, label.toUpperCase());
  }

  _row(name) {
    const r = el('div', 'ow-row', this.rows);
    el('div', 'name', r, name.toUpperCase());
    return r;
  }

  _slider(name, min, max, step, apply) {
    const row = this._row(name);
    const wrap = el('div', 'ow-slider', row);
    el('div', 'track', wrap);
    const fill = el('div', 'fill', wrap);
    const knob = el('div', 'knob', wrap);
    const input = el('input', null, wrap);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', name);
    const val = el('div', 'val', row, '');

    const paint = (v) => {
      const t = (v - min) / (max - min);
      setStyle(fill, 'width', (t * 100).toFixed(2) + '%');
      setStyle(knob, 'left', (t * 100).toFixed(2) + '%');
      setText(val, apply(v) ?? String(v));
    };
    input.addEventListener('input', () => paint(parseFloat(input.value)));
    const api = {
      set: (v) => {
        const c = clamp(v, min, max);
        input.value = String(c);
        paint(c);
      },
    };
    return api;
  }

  /* --------------------------------------------------------------- ADS -- */

  _setAdsMode(mode) {
    this.ctx.config.adsMode = mode;
    // Switching styles mid-latch would strand the optic up (or down).
    this.ctx.input?.clearAdsToggle?.();
    this._persistControls();
    this.ctx.events.emit('ui:setting', { key: 'adsMode', value: mode });
    this.syncFromConfig();
  }

  _setAdsKey(code) {
    this.ctx.config.adsKey = code;
    this.ctx.input?.clearAdsToggle?.();
    this._persistControls();
    this.ctx.events.emit('ui:setting', { key: 'adsKey', value: code });
    this.syncFromConfig();
  }

  _persistControls() {
    const cfg = this.ctx.config;
    saveControlSettings({ adsMode: cfg.adsMode, adsKey: cfg.adsKey });
  }

  /**
   * Listen in the capture phase so the keypress never reaches `Input`, which
   * binds on `window` in the bubble phase — otherwise choosing a key would also
   * fire the action it is being taken from.
   */
  _beginRebind() {
    if (this._rebinding) return;
    this._rebinding = true;
    this._keyFlash = 0;
    setText(this.adsKeyBtn, 'PRESS A KEY');
    this.adsKeyBtn.classList.add('on');
    this._rebindKeydown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._finishRebind(e.code);
    };
    addEventListener('keydown', this._rebindKeydown, true);
  }

  _cancelRebind() {
    if (!this._rebinding) return;
    removeEventListener('keydown', this._rebindKeydown, true);
    this._rebindKeydown = null;
    this._rebinding = false;
    this.adsKeyBtn.classList.remove('on');
  }

  _finishRebind(code) {
    this._cancelRebind();
    if (code === 'Escape') {
      this.syncFromConfig();
      return;
    }
    if (code === 'Backspace' || code === 'Delete') {
      this._setAdsKey(null);
      return;
    }
    if (!isBindableKey(code)) {
      // Taken by movement/stance/etc, or not a key we can render a cap for.
      setText(this.adsKeyBtn, 'IN USE');
      this._keyFlash = 1.1;
      return;
    }
    this._setAdsKey(code);
  }

  setGraphicsMode(mode) {
    this.ctx.peek('quality')?.setMode(mode);
    this.syncFromConfig();
  }

  syncFromConfig() {
    const cfg = this.ctx.config;
    const status = this.ctx.peek('quality')?.getStatus();
    const mode = status?.mode ?? cfg.quality;
    for (let i = 0; i < this.graphicsBtns.length; i++)
      this.graphicsBtns[i].classList.toggle('on', GRAPHICS_MODES[i] === mode);
    this.target.value = String(status?.target ?? cfg.targetFps ?? 'display');
    this.displayTargetOption.textContent = `Display (${cfg.displayRefreshHz ?? 120} Hz est.)`;
    this.setQualityStatus(status);
    for (const [b, v] of this.invBtns) b.classList.toggle('on', !!cfg.invertY === v);
    this.sens?.set((cfg.sensitivity ?? 0.0022) / 0.0022);
    this.fov?.set(cfg.fov ?? 80);

    const adsMode = cfg.adsMode ?? 'hold';
    for (const [b, v] of this.adsModeBtns) b.classList.toggle('on', adsMode === v);
    // Don't stomp the prompt while the player is mid-rebind.
    if (!this._rebinding && this._keyFlash <= 0)
      setText(this.adsKeyBtn, keyLabel(cfg.adsKey ?? null));
    const aim = cfg.adsKey ? `${keyLabel(cfg.adsKey)}/RMB ADS` : 'RMB ADS';
    setText(this.hint, `WASD MOVE · SHIFT SPRINT · ${aim} · R RELOAD · ESC ${this._resumeToGame ? 'RESUME' : 'CLOSE'}`);
  }

  setQualityStatus(status) {
    if (!status) {
      setText(this.qualityStatus, '--');
      return;
    }
    const rawState = status.state ?? 'manual';
    const scale = Math.round((status.renderScale ?? 1) * 100);
    const achieved = Math.round(status.achievedFps ?? 0);
    const tier = status.tier ?? status.mode;
    if (
      this._qualityState === rawState &&
      this._qualityMode === status.mode &&
      this._qualityTier === tier &&
      this._qualityScale === scale &&
      this._qualityAchieved === achieved &&
      this._qualityTarget === status.targetFps
    )
      return;
    this._qualityState = rawState;
    this._qualityMode = status.mode;
    this._qualityTier = tier;
    this._qualityScale = scale;
    this._qualityAchieved = achieved;
    this._qualityTarget = status.targetFps;
    const state = String(rawState).toUpperCase();
    if (status.mode !== 'auto') {
      setText(this.qualityStatus, `${String(tier).toUpperCase()} · ${state}`);
      return;
    }
    const fps = achieved ? `${achieved}/${status.targetFps}` : `--/${status.targetFps}`;
    setText(
      this.qualityStatus,
      `${state} · ${String(tier ?? 'ultra').toUpperCase()} · ${scale}% · ${fps} FPS`
    );
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    // Gameplay input enabled == we are in a live match. That single fact
    // decides the title, the buttons, and whether close() hands control back.
    this._resumeToGame = !!this.ctx.input?.enabled;
    // Take the mouse. Without this, `core/input.js` re-grabs pointer lock on the
    // first click at a settings row and the cursor vanishes mid-interaction.
    if (this.ctx.input) this.ctx.input.enabled = false;
    addEventListener('keydown', this._onKey, true);
    this.setLockHint(false);

    setText(this.title, this._resumeToGame ? 'PAUSED' : 'SETTINGS');
    setText(
      this.subtitle,
      this._resumeToGame ? 'WORKMELT — TACTICAL OPERATIONS' : 'WORKMELT — PREFERENCES'
    );
    setText(this.resumeBtn, this._resumeToGame ? 'Resume' : 'Back to lobby');
    // Only when there is a lobby to go back to: with `?match=0` the game boots
    // straight into a live match and there is no setup state to return to.
    const canLeave =
      this._resumeToGame && typeof this.ctx.peek('match')?.returnToSetup === 'function';
    setStyle(this.leaveBtn, 'display', canLeave ? '' : 'none');

    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    document.exitPointerLock?.();
    const t = this.ctx.time;
    if (t) {
      this._prevScale = t.scale;
      t.scale = 0;
    }
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this.ctx.events.emit('ui:pause', { paused: true });
    // Focus the safest button so the panel is keyboard-drivable from the moment
    // it opens (and so a stray Space/Enter resumes rather than doing nothing).
    requestAnimationFrame(() => {
      try {
        this.resumeBtn.focus({ preventScroll: true });
      } catch {
        /* focus is a nicety, never a requirement */
      }
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this._cancelRebind();
    removeEventListener('keydown', this._onKey, true);
    this.syncFromConfig();
    const t = this.ctx.time;
    if (t) t.scale = this._prevScale ?? 1;
    if (this._resumeToGame) {
      this.ctx.peek('player')?.setControlEnabled?.(true);
      if (this.ctx.input) this.ctx.input.enabled = true;
      // Chrome refuses a lock request for ~1s after a user-initiated Escape.
      // When it does, `ui/index.js` puts the click-to-resume hint up rather
      // than treating the missing lock as another pause.
      this.ctx.input?.requestPointerLock?.();
    }
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  /** Show/hide the click-to-resume target. Cheap enough to call every frame. */
  setLockHint(on) {
    if (this._lockHint === !!on) return;
    this._lockHint = !!on;
    setStyle(this.lockHint, 'display', on ? '' : 'none');
  }

  /** "Leave match" — hand the player back to the lobby, keeping the room. */
  _leave() {
    const match = this.ctx.peek('match');
    if (typeof match?.returnToSetup !== 'function') return this.close();
    // Close WITHOUT handing gameplay control back: the lobby is about to take
    // it, and a requestPointerLock() here would race the exitPointerLock() in
    // `_enterSetup` — a race whose losing outcome is a locked pointer on a menu
    // screen, which is the exact failure this whole pass is about.
    this._resumeToGame = false;
    this.close();
    match.returnToSetup();
  }

  /** Driven with unscaled time so the fade still runs while the game is frozen. */
  update(rawDt) {
    if (this._keyFlash > 0) {
      this._keyFlash -= rawDt;
      if (this._keyFlash <= 0) this.syncFromConfig();
    }
    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose() {
    this._cancelRebind();
    removeEventListener('keydown', this._onKey, true);
    this.lockHint.remove();
    this.root.remove();
  }
}
