import { el, setText, setStyle, setClass } from './util.js';

/**
 * ===========================================================================
 * Performance readout
 * ===========================================================================
 *
 * The on-screen half of `src/core/perf.js`. Shown by default while playing, in
 * the upper-left slot below the minimap — the one corner no other HUD element
 * claims (minimap top-left, compass top-centre, killfeed top-right, ammo
 * bottom-right).
 *
 * WHAT IT SHOWS AND WHY EACH NUMBER IS THERE
 * ------------------------------------------
 *   FPS + frame ms   the headline. Smoothed, because an unsmoothed readout
 *                    flickers every digit and is unreadable in motion.
 *   1% low           fps at the p99 frame time. This is the number that
 *                    correlates with "feels like it's stuttering"; a healthy
 *                    p50 next to a terrible 1% low is the signature of hitching,
 *                    and the README records a build that read 94 fps while being
 *                    unplayable for exactly this reason.
 *   bound badge      CPU / GPU / MIXED. Answers the only question worth asking
 *                    before optimizing anything, and is derived from cpu vs
 *                    wall time rather than guessed.
 *   graph            frame time history with 60 and 30 fps rules drawn in, so a
 *                    hitch is visible as a spike instead of a number that came
 *                    and went between two reads.
 *   cpu/gpu/other    where the wall-clock time actually goes. `other` is time
 *                    the main thread was not in our JS — vsync, compositing,
 *                    GPU back-pressure. High `other` means JS optimization is
 *                    wasted effort.
 *   fix/upd/late/rnd the four engine phases, mean ms. Points at the subsystem.
 *   counters         draw calls, triangles, programs, heap. A *rising* program
 *                    count during play is a shader compiling mid-frame, which is
 *                    the classic Three.js stall and shows as a graph spike on
 *                    the same frame.
 *
 * Deliberately NOT part of the game HUD's opacity fade: a debug overlay that
 * dims itself when the pause menu opens is useless precisely when you are in
 * the menu changing quality presets to see what it costs.
 */

/** Frames of history in the graph — ~2.8 s at 60 fps. */
const GRAPH_SAMPLES = 168;
/** Fills the panel's content box: 212px wide less 7px padding either side. */
const GRAPH_W = 198;
const GRAPH_H = 34;

/** Display modes, cycled by F3. */
export const PERF_MODES = ['full', 'mini', 'off'];

export class PerfHud {
  /**
   * @param {HTMLElement} parent
   * @param {object} opts
   * @param {string} opts.mode    initial mode, one of PERF_MODES
   * @param {string} opts.corner  'tl' | 'tr' | 'bl' | 'br'
   * @param {number} opts.target  fps considered "good" (drives the colour ramp)
   */
  constructor(parent, { mode = 'full', corner = 'tl', target = 60 } = {}) {
    this.mode = PERF_MODES.includes(mode) ? mode : 'full';
    this.corner = corner;
    this.target = target;
    this.k = 1;
    this._statAt = 0;
    this._stats = null;

    this.root = el('div', `ow-perf ow-perf-${corner}`, parent);

    const head = el('div', 'ow-perf-head', this.root);
    this.fpsNode = el('span', 'ow-perf-fps', head, '--');
    el('span', 'ow-perf-unit', head, 'FPS');
    this.boundNode = el('span', 'ow-perf-bound', head, '');

    this.subNode = el('div', 'ow-perf-sub', this.root, '');

    this.canvas = el('canvas', 'ow-perf-graph', this.root);
    this.g = this.canvas.getContext('2d');

    this.body = el('div', 'ow-perf-body', this.root);
    // Budget rows carry a proportional bar; phase/counter rows are text only.
    this.rows = {
      cpu: this._row('CPU', true),
      gpu: this._row('GPU', true),
      other: this._row('OTHER', true),
    };
    // Four deliberately short lines rather than three long ones: at this width
    // the long form wraps, and a ragged two-line row is harder to read at a
    // glance than four that each fit.
    this.phaseNode = el('div', 'ow-perf-line', this.body, '');
    this.countNode = el('div', 'ow-perf-line', this.body, '');
    this.memNode = el('div', 'ow-perf-line', this.body, '');
    this.hitchNode = el('div', 'ow-perf-line', this.body, '');
    this.hintNode = el('div', 'ow-perf-hint', this.root, 'F3');

    this._applyMode();
    this.resize(1);
  }

  _row(label, withBar) {
    const row = el('div', 'ow-perf-row', this.body);
    el('span', 'ow-perf-label', row, label);
    const value = el('span', 'ow-perf-value', row, '--');
    let bar = null;
    if (withBar) {
      const track = el('span', 'ow-perf-track', row);
      bar = el('span', 'ow-perf-bar', track);
    }
    return { row, value, bar };
  }

  /* --------------------------------------------------------------- api --- */

  setMode(mode) {
    if (!PERF_MODES.includes(mode)) return this.mode;
    this.mode = mode;
    this._applyMode();
    return this.mode;
  }

  cycle() {
    return this.setMode(PERF_MODES[(PERF_MODES.indexOf(this.mode) + 1) % PERF_MODES.length]);
  }

  setCorner(corner) {
    for (const c of ['tl', 'tr', 'bl', 'br']) setClass(this.root, `ow-perf-${c}`, c === corner);
    this.corner = corner;
  }

  _applyMode() {
    const off = this.mode === 'off';
    const full = this.mode === 'full';
    setStyle(this.root, 'display', off ? 'none' : 'block');
    setStyle(this.canvas, 'display', full ? 'block' : 'none');
    setStyle(this.body, 'display', full ? 'block' : 'none');
    setStyle(this.hintNode, 'display', full ? 'block' : 'none');
  }

  resize(k) {
    this.k = k;
    // Back the canvas at device resolution so 1 px rules stay 1 px.
    const dpr = Math.min(3, Math.max(1, devicePixelRatio || 1));
    const w = Math.round(GRAPH_W * k);
    const h = Math.round(GRAPH_H * k);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      setStyle(this.canvas, 'width', `${w}px`);
      setStyle(this.canvas, 'height', `${h}px`);
    }
    this._dpr = dpr;
  }

  /* ------------------------------------------------------------- frame --- */

  /**
   * @param {number} rawDt unscaled seconds since the last call (so the readout
   *   keeps updating at a fixed rate even when `time.scale` is 0)
   * @param {import('../core/perf.js').Perf} perf
   */
  update(rawDt, perf) {
    if (this.mode === 'off' || !perf) return;
    const live = perf.live;

    // Percentiles sort ~900 samples; 6 Hz is plenty for a number a human reads,
    // and keeps the profiler's own cost off the frame it is measuring.
    this._statAt -= rawDt;
    if (this._statAt <= 0 || !this._stats) {
      this._statAt = 1 / 6;
      this._stats = perf.stats();
    }
    const s = this._stats;

    const fps = live.fps;
    setText(this.fpsNode, fps >= 1 ? Math.round(fps) : '--');
    setClass(this.root, 'ow-perf-good', fps >= this.target * 0.95);
    setClass(this.root, 'ow-perf-warn', fps < this.target * 0.95 && fps >= this.target * 0.5);
    setClass(this.root, 'ow-perf-bad', fps < this.target * 0.5);

    setText(this.boundNode, s.bound === 'cpu' ? 'CPU' : s.bound === 'gpu-or-vsync' ? 'GPU' : 'MIX');
    setText(this.subNode, `${live.frameMs.toFixed(1)} ms · 1% low ${s.fps.low1 | 0} · p99 ${s.frameMs.p99} ms`);

    if (this.mode === 'full') {
      // Bars are scaled against the wall-clock frame so the three add up to the
      // frame the player is actually getting, not to an arbitrary budget.
      const budget = Math.max(live.frameMs, 1);
      this._setRow(this.rows.cpu, `${live.cpuMs.toFixed(1)} ms`, live.cpuMs / budget);
      if (perf.gpuAvailable && Number.isFinite(live.gpuMs)) {
        setStyle(this.rows.gpu.row, 'display', '');
        this._setRow(this.rows.gpu, `${live.gpuMs.toFixed(1)} ms`, live.gpuMs / budget);
      } else {
        // Absent in most stock browsers (Chrome gates the extension); hiding the
        // row is honest, an empty "0.0 ms" would not be.
        setStyle(this.rows.gpu.row, 'display', 'none');
      }
      this._setRow(this.rows.other, `${live.otherMs.toFixed(1)} ms`, live.otherMs / budget);

      const p = s.phasesMs;
      setText(this.phaseNode, `fix ${p.fixed} upd ${p.update} late ${p.late} rnd ${p.render} · x${live.substeps}`);
      setText(this.countNode, `${live.calls} calls · ${(live.tris / 1e6).toFixed(2)}M tris`);
      setText(
        this.memNode,
        `${live.progs} prog · ${live.texs} tex` + (live.heapMb ? ` · ${live.heapMb.toFixed(0)} MB` : '')
      );
      const h = s.hitches;
      setText(this.hitchNode, `hitch ${h.count} (${h.pctOfFrames.toFixed(1)}%) · worst ${h.worstMs} ms`);
      setClass(this.hitchNode, 'ow-perf-alert', h.count > 0);

      this._drawGraph(perf, s);
    }
  }

  _setRow(row, text, frac) {
    setText(row.value, text);
    if (row.bar) setStyle(row.bar, 'width', `${Math.min(100, Math.max(0, frac * 100)).toFixed(1)}%`);
  }

  /**
   * Frame-time history. Reads the Perf ring buffer directly — walking it here
   * avoids copying 168 samples into a temporary every frame, which rule 5
   * forbids.
   */
  _drawGraph(perf, s) {
    const g = this.g;
    const dpr = this._dpr;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.clearRect(0, 0, w, h);

    const n = Math.min(GRAPH_SAMPLES, perf.length);
    if (n === 0) return;

    // Scale headroom to the worst recent frame so a spike is never clipped off
    // the top, but never compress below the 30 fps line either — otherwise a
    // smooth 60 fps trace would fill the whole graph and look alarming.
    const ceilMs = Math.max(33.34, Math.min(200, s.frameMs.p99 * 1.35));
    const y = (ms) => h - Math.min(h, (ms / ceilMs) * h);

    // Reference rules: 60 fps (16.7 ms) and 30 fps (33.3 ms).
    g.fillStyle = 'rgba(255,255,255,.13)';
    g.fillRect(0, Math.round(y(16.67)), w, Math.max(1, dpr * 0.5));
    g.fillStyle = 'rgba(255,255,255,.09)';
    g.fillRect(0, Math.round(y(33.34)), w, Math.max(1, dpr * 0.5));

    const dt = perf.buf.dt;
    const cpu = perf.buf.cpu;
    const cap = perf.cap;
    const colW = w / GRAPH_SAMPLES;
    const bw = Math.max(1, Math.ceil(colW));

    for (let k = 0; k < n; k++) {
      // Newest sample on the right.
      const idx = (perf.head - n + k + cap * 2) % cap;
      const ms = dt[idx];
      const x = Math.round((GRAPH_SAMPLES - n + k) * colW);
      const top = y(ms);
      g.fillStyle =
        ms > 33.34 ? 'rgba(255,63,49,.85)' : ms > 20 ? 'rgba(255,176,42,.8)' : 'rgba(168,232,106,.55)';
      g.fillRect(x, top, bw, h - top);
      // CPU portion overlaid darker: the visible gap between the two is `other`,
      // so being GPU bound is legible at a glance rather than only in the rows.
      const ctop = y(cpu[idx]);
      g.fillStyle = 'rgba(6,12,18,.42)';
      g.fillRect(x, ctop, bw, h - ctop);
    }
  }

  dispose() {
    this.root.remove();
  }
}
