import { el, setText, setStyle, clamp, damp, ease } from './util.js';
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
 * Pause / settings menu.
 *
 * Wired straight into `ctx.config`: the quality segments call
 * `config.setQuality`, the sliders write `config.sensitivity` and `config.fov`
 * (and push the FOV into the live camera), and every change is announced on the
 * event bus so render/player can react without importing this module.
 *
 * Events emitted: `ui:pause` {paused}, `ui:quality` {quality},
 * `ui:sensitivity` {value}, `ui:fov` {value}, `ui:setting` {key, value}.
 */
export class PauseMenu {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.root = el('div', 'ow-menu', parent);
    const inner = el('div', 'ow-menu-inner', this.root);

    const h = el('h1', null, inner, 'Paused');
    h.textContent = 'PAUSED';
    el('div', 'sub', inner, 'WORKMELT — TACTICAL OPERATIONS');
    el('div', 'rule', inner);

    this.rows = el('div', null, inner);

    // ---- adaptive graphics ----------------------------------------------
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

    // ---- sensitivity -----------------------------------------------------
    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v) => {
      this.ctx.config.sensitivity = 0.0022 * v;
      this.ctx.events.emit('ui:sensitivity', { value: this.ctx.config.sensitivity, multiplier: v });
      return v.toFixed(2);
    });

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

    // ---- invert look -----------------------------------------------------
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

    // ---- aim down sights -------------------------------------------------
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
    this.adsKeyBtn = el('button', 'ow-key', adsKeyRow, 'X');
    this.adsKeyBtn.type = 'button';
    this.adsKeyBtn.addEventListener('click', () => this._beginRebind());
    this._rebinding = false;
    this._rebindKeydown = null;
    this._keyFlash = 0;

    // ---- buttons ---------------------------------------------------------
    const btns = el('div', 'ow-btns', inner);
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
    this.hint = el('div', 'hint', inner, '');

    this.open = false;
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this.syncFromConfig();
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
    const aimKey = cfg.adsKey ? `${keyLabel(cfg.adsKey)}/RMB` : 'RMB';
    const aim = `${aimKey} ADS${adsMode === 'toggle' ? ' (TAP)' : ''}`;
    setText(this.hint, `ESC RESUME · WASD MOVE · SHIFT SPRINT · ${aim} · R RELOAD · F USE`);
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
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this._cancelRebind();
    this.syncFromConfig();
    const t = this.ctx.time;
    if (t) t.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    this.ctx.input?.requestPointerLock?.();
    this.ctx.events.emit('ui:pause', { paused: false });
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
    this.root.remove();
  }
}
