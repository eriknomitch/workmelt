import * as THREE from 'three';
import { Registry, EventBus } from './registry.js';
import { FIXED_DT, MAX_SUBSTEPS } from './config.js';
import { Input } from './input.js';
import { Rng } from './rng.js';
import { Perf, PHASE_FIXED, PHASE_UPDATE, PHASE_LATE, PHASE_RENDER } from './perf.js';

/**
 * The Engine owns the frame loop and the shared context handed to every
 * subsystem. It does NOT know what any subsystem does — it only sequences them.
 *
 * Frame order:
 *   1. input.beginFrame()
 *   2. fixedUpdate(FIXED_DT) xN   — physics, deterministic gameplay
 *   3. update(dt)                 — animation, cameras, AI decisions
 *   4. lateUpdate(dt)             — anything that must observe final transforms
 *   5. render subsystem draws
 *   6. input.endFrame()
 *
 * Each of steps 2-5 is timed into `this.perf` (src/core/perf.js), which is what
 * feeds the on-screen counter and every benchmark. The instrumentation is pure
 * measurement — it reads clocks and never writes simulation state — so it stays
 * on in production and cannot move a pixel.
 */
export class Engine {
  constructor({ canvas, config }) {
    this.canvas = canvas;
    this.config = config;
    this.registry = new Registry();
    this.events = new EventBus();
    this.input = new Input(canvas, config);
    this.rng = new Rng(config.deterministic ? 0x5eed1234 : (Math.random() * 2 ** 32) >>> 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    /** Separate scene+camera for the first-person viewmodel, drawn with its own
     *  near plane so hands/weapon never clip into world geometry. */
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(60, 1, 0.005, 12);

    this.time = {
      /** Seconds since start, scaled. */ elapsed: 0,
      /** Unscaled wall-clock seconds since start. */ raw: 0,
      /** Last frame delta, scaled and clamped. */ dt: 0,
      /** Fixed step. */ fixed: FIXED_DT,
      /** Interpolation alpha between the last two physics steps, 0..1. */ alpha: 0,
      scale: 1,
      frame: 0,
    };

    /** Frame instrumentation. Always present; see src/core/perf.js. */
    this.perf = new Perf({ deterministic: !!config.deterministic });

    this.ctx = {
      engine: this,
      perf: this.perf,
      scene: this.scene,
      camera: this.camera,
      viewScene: this.viewScene,
      viewCamera: this.viewCamera,
      canvas,
      config,
      events: this.events,
      input: this.input,
      time: this.time,
      rng: this.rng,
      get: (id) => this.registry.get(id),
      peek: (id) => this.registry.peek(id),
      has: (id) => this.registry.has(id),
    };

    this._accum = 0;
    this._last = 0;
    this._running = false;

    /**
     * Resize is COALESCED, never handled inline.
     *
     * A window drag delivers one `resize` event per frame, and each one would
     * otherwise tear down and rebuild the entire post chain — measured at ~160
     * MB of render targets per megapixel, so ~590 MB per event at 1440p and
     * ~1.3 GB at 4K, synchronously on the main thread, sixty times a second.
     *
     * Nothing about the frame is wrong while we wait. The canvas backbuffer
     * keeps its old size and the browser scales it into the new CSS box, and
     * because the camera aspect moves at the same moment the targets do, that
     * is a uniform stretch rather than a geometry error. It snaps to exact when
     * the drag stops.
     *
     * `resize()` itself stays synchronous and public: `init()` and any harness
     * that needs the new size on the very next frame calls it directly.
     */
    this._resizeQuietMs = 120;
    this._resizePending = false;
    /** Set by the event, consumed by the frame: the handler reads no clock. */
    this._resizeDirty = false;
    this._resizeSeenMs = 0;
    this._lastW = 0;
    this._lastH = 0;
    this._lastDpr = 0;
    this._onResize = () => {
      this._resizeDirty = true;
    };
    /**
     * A devicePixelRatio change does not reliably arrive as a `resize` event —
     * dragging a window from a Retina panel to a non-Retina one can leave the
     * CSS box identical, and then the backbuffer keeps the old pixel ratio for
     * the rest of the session. A `resolution` media query is the only thing that
     * actually reports it, and it has to be re-armed against the new value each
     * time because it only fires on leaving the one it was built with.
     */
    this._dprQuery = null;
    this._onDprChange = () => {
      this._onResize();
      this._watchPixelRatio();
    };
  }

  _watchPixelRatio() {
    const mm = globalThis.matchMedia;
    if (typeof mm !== 'function') return;
    this._dprQuery?.removeEventListener?.('change', this._onDprChange);
    this._dprQuery = null;
    try {
      const q = mm.call(globalThis, `(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
      q?.addEventListener?.('change', this._onDprChange);
      this._dprQuery = q ?? null;
    } catch {
      // Media-query support for `resolution` is not universal; the window
      // `resize` path still covers zoom, which is the common case.
    }
  }

  add(SystemClass, opts) {
    this.registry.add(new SystemClass(opts));
    return this;
  }

  async init() {
    const order = this.registry.resolve();
    for (const sys of order) {
      const t0 = performance.now();
      await sys.init?.(this.ctx);
      const ms = performance.now() - t0;
      if (ms > 50) console.info(`[engine] ${sys.constructor.id} init ${ms.toFixed(0)}ms`);
    }
    this.input.attach();
    addEventListener('resize', this._onResize);
    this._watchPixelRatio();
    this.resize();
    return this;
  }

  /**
   * Apply the current canvas size immediately. Safe to call redundantly: an
   * unchanged size (and unchanged pixel ratio — a DPR move at a fixed CSS size
   * is a real change) returns without touching a subsystem, so the coalescing
   * path never pays for a spurious event.
   */
  resize() {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    const dpr = globalThis.devicePixelRatio || 1;
    this._resizePending = false;
    this._resizeDirty = false;
    if (w === this._lastW && h === this._lastH && dpr === this._lastDpr) return;
    this._lastW = w;
    this._lastH = h;
    this._lastDpr = dpr;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    for (const sys of this.registry.with('resize')) sys.resize(w, h, this.ctx);
    this.events.emit('resize', { width: w, height: h });
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  stop() {
    this._running = false;
  }

  _loop(now) {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    this.step(now);
  }

  /** Advance one frame. Exposed so the capture harness can pump frames by hand. */
  step(now = performance.now()) {
    // Settle the viewport before anything reads it. One reallocation per drag,
    // not one per event — see the note on `_onResize`. The frame clock is the
    // only clock involved, so a harness driving `step()` by hand gets exactly
    // the same behaviour as a real animation frame.
    if (this._resizeDirty) {
      this._resizeDirty = false;
      this._resizePending = true;
      this._resizeSeenMs = now;
    } else if (this._resizePending && now - this._resizeSeenMs >= this._resizeQuietMs) {
      this.resize();
    }

    const t = this.time;
    // Clamp so a tab-switch or a breakpoint doesn't teleport the simulation.
    const rawDt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    t.raw += rawDt;
    t.dt = rawDt * t.scale;
    t.elapsed += t.dt;
    t.frame++;

    this.input.beginFrame();

    // Phase cursor starts here, after input is latched: the gap between the rAF
    // timestamp and this line is browser scheduling latency, not engine cost,
    // and charging it to physics would misattribute every frame.
    const perf = this.perf;
    perf.beginFrame(rawDt * 1000);

    this._accum += t.dt;
    let steps = 0;
    const fixedSystems = this.registry.with('fixedUpdate');
    while (this._accum >= FIXED_DT && steps < MAX_SUBSTEPS) {
      for (const sys of fixedSystems) sys.fixedUpdate(FIXED_DT, this.ctx);
      this._accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this._accum = 0; // shed backlog rather than spiral
    t.alpha = this._accum / FIXED_DT;
    perf.mark(PHASE_FIXED);

    for (const sys of this.registry.with('update')) sys.update(t.dt, this.ctx);
    perf.mark(PHASE_UPDATE);

    for (const sys of this.registry.with('lateUpdate')) sys.lateUpdate(t.dt, this.ctx);
    perf.mark(PHASE_LATE);

    const renderSystem = this.registry.peek('render');
    if (typeof renderSystem?.render === 'function') {
      // The GPU timer query brackets the draw only, so `gpuMs` is comparable to
      // `render` (CPU submit time) rather than to the whole frame.
      perf.beginGpu(renderSystem);
      renderSystem.render(this.ctx);
      perf.endGpu();
    }
    perf.mark(PHASE_RENDER);

    perf.endFrame(renderSystem, steps);

    this.input.endFrame();
  }

  dispose() {
    this.stop();
    removeEventListener('resize', this._onResize);
    this._dprQuery?.removeEventListener?.('change', this._onDprChange);
    this._dprQuery = null;
    this.input.detach();
    for (const sys of [...this.registry.ordered].reverse()) sys.dispose?.();
    this.perf.dispose();
    this.events.clear();
  }
}
