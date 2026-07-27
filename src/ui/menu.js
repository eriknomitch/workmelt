import { el, setText, setStyle, clamp, damp, ease } from './util.js';
import {
  ADS_MODES,
  DEFAULT_CONTROLS,
  isBindableKey,
  keyLabel,
  saveControlSettings,
} from '../core/controls.js';
import {
  GRAPHICS_AUTO,
  GRAPHICS_GROUPS,
  GRAPHICS_OPTIONS_BY_ID,
  applyOptionLive,
  needsRestart,
  optionsInGroup,
  resolveOptionValue,
} from '../core/graphics.js';

const GRAPHICS_MODES = ['auto', 'low', 'medium', 'high', 'ultra'];
const FPS_TARGETS = ['display', '30', '60', '90', '120', '144', '165', '240'];

/**
 * Pause / settings menu.
 *
 * Two layers, one panel:
 *
 * - The GENERAL tab is wired straight into `ctx.config`: the quality segments
 *   call the quality system, the sliders write `config.sensitivity` and
 *   `config.fov` (and push the FOV into the live camera), and every change is
 *   announced on the event bus so render/player can react without importing
 *   this module.
 * - The remaining tabs are GENERATED from the option table in
 *   `src/core/graphics.js` — this file knows nothing about what a "Parallax
 *   Occlusion" is, only how to draw an enum and a slider. Adding a graphics
 *   setting means adding a row to that table and nothing here.
 *
 * A setting that the renderer can take mid-frame is applied on the spot. One
 * that cannot (a pass, a render target, a texture bake) is persisted
 * immediately and flagged: the footer grows an APPLY & RESTART button, and the
 * row is marked, rather than reloading the page under the player mid-menu.
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

    /** Guards the config -> UI sync from writing back through the controls. */
    this._syncing = false;
    /** Per-option row handles, keyed by option id, for syncFromConfig. */
    this._optionRows = new Map();

    // ---- tabs -------------------------------------------------------------
    this.tabs = el('div', 'ow-tabs', inner);
    this.panels = el('div', 'ow-panels', inner);
    this._tabBtns = [];
    this._panelEls = new Map();
    this.tab = 'general';

    this.rows = this._panel('general', 'General');
    for (const group of GRAPHICS_GROUPS) this._buildGroupPanel(group);

    // ---- adaptive graphics ------------------------------------------------
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
    // Mirrors the Visibility tab's entry, and goes through the same option so
    // the choice is persisted rather than lost on the next load.
    this.fov = this._slider('Field Of View', 65, 130, 1, (v) => {
      // Live while dragging, persisted once on release — a JSON serialise per
      // pointer sample is not what localStorage is for.
      if (!this._syncing) this._setOption('fovSlider', v, { persist: false });
      return String(v | 0);
    });
    this.fov.input.addEventListener('change', () => {
      if (!this._syncing) this._setOption('fovSlider', parseFloat(this.fov.input.value));
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
    this.adsKeyBtn = el('button', 'ow-bind', adsKeyRow, 'X');
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
    this.applyBtn = el('button', 'ow-btn warn', btns, 'Apply & Restart');
    this.applyBtn.type = 'button';
    this.applyBtn.addEventListener('click', () => this.ctx.peek('quality')?.applyPending());
    setStyle(this.applyBtn, 'display', 'none');
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.sens.set(1);
      this.ctx.config.invertY = false;
      this._setAdsMode(DEFAULT_CONTROLS.adsMode);
      this._setAdsKey(DEFAULT_CONTROLS.adsKey);
      // Clears the advanced overrides as well as the mode/target, then reloads.
      this.ctx.peek('quality')?.resetDefaults();
    });
    this.hint = el('div', 'hint', inner, '');

    this.open = false;
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this._selectTab('general');
    this.syncFromConfig();
  }

  /* ------------------------------------------------------------- layout -- */

  _panel(id, label) {
    const b = el('button', 'ow-tab', this.tabs, label);
    b.type = 'button';
    b.addEventListener('click', () => this._selectTab(id));
    this._tabBtns.push([b, id]);
    const panel = el('div', 'ow-panel', this.panels);
    this._panelEls.set(id, panel);
    return panel;
  }

  _selectTab(id) {
    this.tab = id;
    for (const [b, tabId] of this._tabBtns) b.classList.toggle('on', tabId === id);
    for (const [panelId, panel] of this._panelEls)
      setStyle(panel, 'display', panelId === id ? '' : 'none');
    this.syncFromConfig();
  }

  /** A row in whichever panel is currently being built (General by default). */
  _row(name, parent = this.rows) {
    const r = el('div', 'ow-row', parent);
    el('div', 'name', r, name.toUpperCase());
    return r;
  }

  _slider(name, min, max, step, apply, parent = this.rows) {
    const row = this._row(name, parent);
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
      row,
      input,
      set: (v) => {
        const c = clamp(v, min, max);
        input.value = String(c);
        paint(c);
      },
    };
    return api;
  }

  /* --------------------------------------------------- advanced options -- */

  /**
   * Build one tab from the option table. Every control writes through
   * `_setOption`, which is the only place this file talks to the quality
   * system — so "is it live or does it need a restart" is decided in exactly
   * one place, by the schema, not by whoever added the row.
   */
  _buildGroupPanel(group) {
    const panel = this._panel(group.id, group.label);
    if (group.blurb) el('div', 'ow-panel-blurb', panel, group.blurb.toUpperCase());

    for (const opt of optionsInGroup(group.id)) {
      const row = this._row(opt.label, panel);
      if (opt.hint) row.title = opt.hint;
      // Marked on the row rather than in a legend: by the time a player has
      // scrolled to Shadow Quality they have forgotten the legend.
      if (needsRestart(opt.id)) el('span', 'ow-tag', row.firstChild, 'RESTART');

      if (opt.kind === 'enum') {
        const select = el('select', 'ow-select', row);
        opt.values.forEach((entry, i) => {
          const o = el('option', null, select, entry.label);
          o.value = String(i);
        });
        select.addEventListener('change', () => {
          const entry = opt.values[Number(select.value)];
          if (entry) this._setOption(opt.id, entry.value);
          this.syncFromConfig();
        });
        this._optionRows.set(opt.id, { opt, kind: 'enum', row, select });
        continue;
      }

      // Slider. `input` fires continuously and is applied live for the instant
      // feedback that makes a graphics slider worth having; `change` fires once
      // the player lets go and is what actually persists.
      const wrap = el('div', 'ow-slider', row);
      el('div', 'track', wrap);
      const fill = el('div', 'fill', wrap);
      const knob = el('div', 'knob', wrap);
      const input = el('input', null, wrap);
      input.type = 'range';
      input.min = String(opt.min);
      input.max = String(opt.max);
      input.step = String(opt.step);
      const val = el('div', 'val', row, '');

      const paint = (v) => {
        const t = (v - opt.min) / (opt.max - opt.min);
        setStyle(fill, 'width', (t * 100).toFixed(2) + '%');
        setStyle(knob, 'left', (t * 100).toFixed(2) + '%');
        setText(val, opt.format ? opt.format(v) : String(v));
      };
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        paint(v);
        if (!this._syncing) this._setOption(opt.id, v, { persist: false });
      });
      input.addEventListener('change', () => {
        if (!this._syncing) this._setOption(opt.id, parseFloat(input.value));
      });
      this._optionRows.set(opt.id, { opt, kind: 'slider', row, input, paint });
    }
  }

  /**
   * Write one advanced option. `persist:false` is the live-drag path — it moves
   * the picture without hammering localStorage on every pointer sample; the
   * matching `change` event persists the value the player settled on.
   */
  _setOption(id, value, { persist = true } = {}) {
    const quality = this.ctx.peek('quality');
    const result = persist
      ? quality?.setOption(id, value, this.ctx)
      : quality?.previewOption(id, value, this.ctx);
    if (persist) this._refreshFooter();
    if (result?.ok) return result;

    // The quality system refuses everything on a `?q=` or capture boot, where
    // persisted graphics settings are deliberately out of the picture. A live
    // knob should still MOVE in that mode — it just does not survive the
    // reload, which is the whole point of those boots.
    const opt = GRAPHICS_OPTIONS_BY_ID[id];
    if (opt && !needsRestart(id)) applyOptionLive(opt, value, this.ctx);
    return result ?? null;
  }

  _refreshFooter() {
    const pending = this.ctx.peek('quality')?.pendingRestart === true;
    setStyle(this.applyBtn, 'display', pending ? '' : 'none');
  }

  /** Re-read every advanced control from the schema + the live renderer. */
  _syncOptions() {
    const quality = this.ctx.peek('quality');
    const render = this.ctx.peek('render');
    const overrides = quality?.getOverrides?.() ?? {};
    const ctxArg = { overrides, q: this.ctx.config.q, config: this.ctx.config, render };
    for (const entry of this._optionRows.values()) {
      const { opt } = entry;
      const { value, source } = resolveOptionValue(opt, ctxArg);
      entry.row.classList.toggle('ow-row-set', source === 'user');
      if (entry.kind === 'enum') {
        const override = overrides[opt.id];
        // No override means "Auto", which is always index 0 — even when the
        // preset resolves to the same value as one of the explicit entries.
        // Showing "On" for an unset option would make Auto unreachable.
        const idx =
          override === undefined
            ? 0
            : Math.max(
                0,
                opt.values.findIndex((v) => v.value === override)
              );
        entry.select.value = String(idx);
        entry.select.title =
          override === undefined && value !== GRAPHICS_AUTO
            ? `Preset: ${labelFor(opt, value)}`
            : (opt.hint ?? '');
      } else {
        const v = clamp(Number(value) || 0, opt.min, opt.max);
        entry.input.value = String(v);
        entry.paint(v);
      }
    }
    this._refreshFooter();
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
    if (this._syncing) return;
    this._syncing = true;
    try {
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
      this._syncOptions();

      const adsMode = cfg.adsMode ?? 'hold';
      for (const [b, v] of this.adsModeBtns) b.classList.toggle('on', adsMode === v);
      // Don't stomp the prompt while the player is mid-rebind.
      if (!this._rebinding && this._keyFlash <= 0)
        setText(this.adsKeyBtn, keyLabel(cfg.adsKey ?? null));
      // Must stay one line at the menu's width, with room for a long bind label
      // ("L SHIFT/RMB ADS"), so the aim entry costs the two hints that are
      // already shown elsewhere: ESC by the Resume button directly above, and
      // F by the in-world use prompt. Hold vs toggle is on the row above too.
      const aim = cfg.adsKey ? `${keyLabel(cfg.adsKey)}/RMB ADS` : 'RMB ADS';
      setText(this.hint, `WASD MOVE · SHIFT SPRINT · ${aim} · R RELOAD`);
    } finally {
      this._syncing = false;
    }
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
    // The number that actually explains a soft image: not the scale percentage
    // but the pixel count it lands on, after BOTH the render scale and the
    // device-pixel-ratio cap have taken their cut. A player looking at a blurry
    // 3024x1964 panel needs to see "1344x756" to know what to change.
    const size = this.ctx.peek('render')?.screenSize;
    const px = size ? `${size.width}x${size.height}` : '';
    if (
      this._qualityState === rawState &&
      this._qualityMode === status.mode &&
      this._qualityTier === tier &&
      this._qualityScale === scale &&
      this._qualityAchieved === achieved &&
      this._qualityPx === px &&
      this._qualityTarget === status.targetFps
    )
      return;
    this._qualityState = rawState;
    this._qualityMode = status.mode;
    this._qualityTier = tier;
    this._qualityScale = scale;
    this._qualityAchieved = achieved;
    this._qualityPx = px;
    this._qualityTarget = status.targetFps;
    const state = String(rawState).toUpperCase();
    if (status.mode !== 'auto') {
      setText(this.qualityStatus, `${String(tier).toUpperCase()} · ${state} · ${px}`);
      return;
    }
    const fps = achieved ? `${achieved}/${status.targetFps}` : `--/${status.targetFps}`;
    setText(
      this.qualityStatus,
      `${String(tier ?? 'ultra').toUpperCase()} · ${scale}% · ${px} · ${fps} FPS · ${state}`
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

/** Human label for a resolved enum value, for the "Preset: …" tooltip. */
function labelFor(opt, value) {
  return opt.values?.find((v) => v.value === value)?.label ?? String(value);
}
