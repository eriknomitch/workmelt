import { el, setText, setStyle, clamp, damp, ease } from './util.js';
import { installBrand } from './brand.js';
import {
  ADS_MODES,
  DEFAULT_CONTROLS,
  TOUCH_SENS_RANGE,
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
 * ---------------------------------------------------------------------------
 * THE ADVANCED GRAPHICS TABS
 * ---------------------------------------------------------------------------
 * GENERAL is the hand-written panel above. Every other tab is GENERATED from
 * the option table in `src/core/graphics.js` — this file knows how to draw an
 * enum and a slider and nothing else, so adding a graphics setting is a row in
 * that table and no change here.
 *
 * Tabs rather than one long scroll because there are ~38 of them: DESIGN.md
 * asks these surfaces to read like Linear or Notion, and neither of those puts
 * forty settings in a single column.
 *
 * A setting the renderer can take mid-frame is applied on the spot (and slider
 * drags are previewed live, persisted on release). One that cannot — a pass, a
 * render target, a texture bake, all built once in `init()` — is persisted
 * immediately, tagged RESTART on its row, and applied by the footer's APPLY
 * button. Reloading the page under a player who is still reading the menu is
 * not an option.
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

    /** Guards the config -> UI sync from writing back through the controls. */
    this._syncing = false;
    /** Per-option row handles, keyed by option id, for `_syncOptions`. */
    this._optionRows = new Map();

    // The tab strip does not scroll with the settings; the body does.
    this.tabs = el('div', 'ow-tabs', panel);
    this.tabs.setAttribute('role', 'tablist');
    this.body = el('div', 'ow-menu-bd', panel);
    this._tabBtns = [];
    this._panelEls = new Map();
    this.tab = 'general';

    this.rows = this._panel('general', 'General');
    for (const group of GRAPHICS_GROUPS) this._buildGroupPanel(group);

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

    this.recalRow = this._row('Auto Setup');
    this.recalBtn = el('button', 'ow-btn', this.recalRow, 'Recalibrate');
    this.recalBtn.type = 'button';
    this.recalBtn.title =
      'Forget the measured graphics profile and measure this machine again. Switches to Auto and reloads.';
    this.recalBtn.addEventListener('click', () => this.ctx.peek('quality')?.recalibrate());

    // ---- field of view ---------------------------------------------------
    // Mirrors the Visibility tab's entry and goes through the same option, so
    // the choice is persisted rather than lost on the next load. Live while
    // dragging, written to storage once on release: a JSON serialise per
    // pointer sample is not what localStorage is for.
    this.fov = this._slider('Field Of View', 65, 130, 1, (v) => {
      if (!this._syncing) this._setOption('fovSlider', v, { persist: false });
      return String(v | 0);
    });
    this.fov.input.addEventListener('change', () => {
      if (!this._syncing) this._setOption('fovSlider', parseFloat(this.fov.input.value));
    });

    // ---- controls --------------------------------------------------------
    this._group('Controls');

    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v) => {
      this.ctx.config.sensitivity = 0.0022 * v;
      this.ctx.events.emit('ui:sensitivity', { value: this.ctx.config.sensitivity, multiplier: v });
      return v.toFixed(2);
    });

    // Touch-look speed, its own knob on top of the shared base sensitivity —
    // a thumb on glass and a mouse on a desk are different instruments. Only
    // surfaced on a touch session; the value still persists with the other
    // control prefs either way.
    this.touchSens = this._slider(
      'Touch Sensitivity',
      TOUCH_SENS_RANGE.min,
      TOUCH_SENS_RANGE.max,
      0.05,
      (v) => {
        this.ctx.config.touchSensitivity = v;
        this.ctx.events.emit('ui:setting', { key: 'touchSensitivity', value: v });
        return v.toFixed(2);
      }
    );
    // Persist once the finger lets go, not on every drag sample.
    this.touchSens.input.addEventListener('change', () => this._persistControls());
    if (!ctx.config.touchMode) setStyle(this.touchSens.row, 'display', 'none');

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
    // laptop, which cannot coexist with the one-finger click that fires. This
    // row covers the mouse; the key below takes the pointer out of aiming
    // entirely and always toggles. See `core/controls.js`.
    const adsRow = this._row('Aim (Mouse)');
    adsRow.title = 'How the right mouse button aims. The ADS key always toggles.';
    const adsSeg = el('div', 'ow-seg', adsRow);
    this.adsModeBtns = [];
    for (const mode of ADS_MODES) {
      const b = el('button', null, adsSeg, mode);
      b.type = 'button';
      b.addEventListener('click', () => this._setAdsMode(mode));
      this.adsModeBtns.push([b, mode]);
    }

    // Persisted with the other control prefs (see core/controls.js). `weapons`
    // reads `config.autoReload` live every frame, so no event wiring is needed
    // beyond the generic `ui:setting` announcement.
    const arRow = this._row('Auto-Reload');
    arRow.title = 'Reload automatically when the magazine runs dry';
    const arSeg = el('div', 'ow-seg', arRow);
    this.autoReloadBtns = [];
    for (const [label, val] of [
      ['off', false],
      ['on', true],
    ]) {
      const b = el('button', null, arSeg, label);
      b.type = 'button';
      b.addEventListener('click', () => this._setAutoReload(val));
      this.autoReloadBtns.push([b, val]);
    }

    const adsKeyRow = this._row('ADS Key (Toggle)');
    this.adsKeyBtn = el('button', 'ow-bind', adsKeyRow, 'X');
    this.adsKeyBtn.type = 'button';
    this.adsKeyBtn.title = 'Tap to raise the optic, tap again to lower it';
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
    // Only on screen while a restart-only graphics option is waiting.
    this.applyBtn = el('button', 'ow-btn warn', btns, 'Apply');
    this.applyBtn.type = 'button';
    this.applyBtn.title = 'Reload so the RESTART settings take effect';
    this.applyBtn.addEventListener('click', () => this.ctx.peek('quality')?.applyPending());
    setStyle(this.applyBtn, 'display', 'none');
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.sens.set(1);
      this.touchSens.set(DEFAULT_CONTROLS.touchSensitivity);
      this.ctx.config.invertY = false;
      this._setAdsMode(DEFAULT_CONTROLS.adsMode);
      this._setAdsKey(DEFAULT_CONTROLS.adsKey);
      this._setAutoReload(DEFAULT_CONTROLS.autoReload);
      // Clears the advanced overrides (FOV included) as well as the mode and
      // target, then reloads — which is what puts the presets back.
      this.ctx.peek('quality')?.resetDefaults();
    });
    el('div', 'grow', btns);
    // Only shown when a room exists — absent under `?mp=0`.
    this.copyLinkBtn = el('button', 'ow-btn', btns, 'Copy Link');
    this.copyLinkBtn.type = 'button';
    this.copyLinkBtn.addEventListener('click', () => this._copyLink());
    setStyle(this.copyLinkBtn, 'display', 'none');
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
    this._selectTab('general');
    this.syncFromConfig();
  }

  /* ------------------------------------------------------------- layout -- */

  /** One tab + the panel it shows. Returns the panel, for `_row` to fill. */
  _panel(id, label) {
    const b = el('button', 'ow-tab', this.tabs, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => this._selectTab(id));
    this._tabBtns.push([b, id]);
    const panel = el('div', 'ow-panel', this.body);
    panel.setAttribute('role', 'tabpanel');
    this._panelEls.set(id, panel);
    return panel;
  }

  _selectTab(id) {
    this.tab = id;
    for (const [b, tabId] of this._tabBtns) {
      const on = tabId === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const [panelId, panel] of this._panelEls)
      setStyle(panel, 'display', panelId === id ? '' : 'none');
    // A tall tab scrolled halfway down then swapped for a short one leaves the
    // new panel scrolled past its own content.
    this.body.scrollTop = 0;
    this.syncFromConfig();
  }

  _group(label, parent = this.rows) {
    el('div', 'ow-group', parent, label.toUpperCase());
  }

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
   * system — so "is this live or does it need a restart" is decided once, by
   * the schema, and not by whoever adds the next row.
   */
  _buildGroupPanel(group) {
    const panel = this._panel(group.id, group.label);
    if (group.blurb) el('div', 'ow-group', panel, group.blurb.toUpperCase());

    for (const opt of optionsInGroup(group.id)) {
      const row = this._row(opt.label, panel);
      if (opt.hint) row.title = opt.hint;
      // Tagged on the row rather than explained in a legend: by the time a
      // player has scrolled to Shadow Quality the legend is off screen.
      if (needsRestart(opt.id)) el('span', 'ow-tag', row.firstChild, 'RESTART');

      if (opt.kind === 'enum') {
        const select = el('select', 'ow-select', row);
        select.setAttribute('aria-label', opt.label);
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

      // Slider. `input` fires continuously and is previewed live, which is what
      // makes a graphics slider worth having at all; `change` fires once the
      // player lets go, and that is what persists.
      const wrap = el('div', 'ow-slider', row);
      el('div', 'track', wrap);
      const fill = el('div', 'fill', wrap);
      const knob = el('div', 'knob', wrap);
      const input = el('input', null, wrap);
      input.type = 'range';
      input.min = String(opt.min);
      input.max = String(opt.max);
      input.step = String(opt.step);
      input.setAttribute('aria-label', opt.label);
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
    // knob should still MOVE there — it just does not survive the reload, which
    // is the entire point of those boots.
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
    const arg = { overrides, q: this.ctx.config.q, config: this.ctx.config, render };
    for (const entry of this._optionRows.values()) {
      const { opt } = entry;
      const { value, source } = resolveOptionValue(opt, arg);
      entry.row.classList.toggle('ow-row-set', source === 'user');
      if (entry.kind === 'enum') {
        const override = overrides[opt.id];
        // No override means Auto, which is always index 0 — even when the
        // preset happens to resolve to the same value as an explicit entry.
        // Selecting that entry instead would make Auto unreachable.
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

  _setAutoReload(on) {
    this.ctx.config.autoReload = !!on;
    this._persistControls();
    this.ctx.events.emit('ui:setting', { key: 'autoReload', value: !!on });
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
    saveControlSettings({
      adsMode: cfg.adsMode,
      adsKey: cfg.adsKey,
      autoReload: cfg.autoReload,
      touchSensitivity: cfg.touchSensitivity,
    });
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
    // The FOV slider writes back through `_setOption`, so painting it from the
    // config would otherwise re-persist the value it was just handed.
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
      const autoReload = cfg.autoReload !== false;
      for (const [b, v] of this.autoReloadBtns) b.classList.toggle('on', autoReload === v);
      this.touchSens?.set(cfg.touchSensitivity ?? 1);
      // Don't stomp the prompt while the player is mid-rebind.
      if (!this._rebinding && this._keyFlash <= 0)
        setText(this.adsKeyBtn, keyLabel(cfg.adsKey ?? null));
      const aim = cfg.adsKey ? `${keyLabel(cfg.adsKey)}/RMB ADS` : 'RMB ADS';
      setText(
        this.hint,
        cfg.touchMode
          ? 'LEFT STICK MOVE · PUSH FULL FORWARD TO SPRINT · DRAG RIGHT SIDE TO AIM'
          : `WASD MOVE · SHIFT SPRINT · ${aim} · R RELOAD · ESC ${this._resumeToGame ? 'RESUME' : 'CLOSE'}`
      );
    } finally {
      this._syncing = false;
    }
  }

  setQualityStatus(status) {
    if (!status) {
      setText(this.qualityStatus, '--');
      setStyle(this.recalRow, 'display', 'none');
      return;
    }
    // `override` means a `?q=`/capture boot: the quality system is not driving,
    // so a recalibrate that reloads into the same override would be a no-op.
    setStyle(this.recalRow, 'display', status.state === 'override' ? 'none' : '');
    const rawState = status.state ?? 'manual';
    const scale = Math.round((status.renderScale ?? 1) * 100);
    const achieved = Math.round(status.achievedFps ?? 0);
    const tier = status.tier ?? status.mode;
    // The number that actually explains a soft image is not the scale
    // percentage but the pixel count it lands on, after BOTH the render scale
    // and the device-pixel-ratio cap have taken their cut. Someone on a
    // 3024x1964 panel needs to read "1344x756" to know what to change.
    const render = this.ctx.peek('render');
    const size = render?.screenSize;
    // "CAPPED" is the difference between "my expensive monitor looks soft" and
    // "the Resolution Limit is doing that, and it is one row up this menu".
    const px = size
      ? `${size.width}x${size.height}${render.budgetLimited ? ' CAPPED' : ''}`
      : '';
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
      setText(this.qualityStatus, `${String(tier).toUpperCase()} · ${px} · ${state}`);
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
    setStyle(this.copyLinkBtn, 'display', this.ctx.peek('net') ? '' : 'none');

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

  /** Copy the room's invite link to the clipboard. */
  _copyLink() {
    const net = this.ctx.peek('net');
    if (!net) return;
    net.copyInvite();
    clearTimeout(this._copyLinkT);
    setText(this.copyLinkBtn, 'Copied');
    this._copyLinkT = setTimeout(() => setText(this.copyLinkBtn, 'Copy Link'), 1600);
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
    clearTimeout(this._copyLinkT);
    removeEventListener('keydown', this._onKey, true);
    this.lockHint.remove();
    this.root.remove();
  }
}

/** Human label for a resolved enum value, for the "Preset: …" tooltip. */
function labelFor(opt, value) {
  return opt.values?.find((v) => v.value === value)?.label ?? String(value);
}
