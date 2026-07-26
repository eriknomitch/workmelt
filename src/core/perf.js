/**
 * Frame instrumentation — the numbers behind the on-screen counter and behind
 * every benchmark run.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tools/profile.mjs` already samples frame time from the driver side, but it
 * can only see what `requestAnimationFrame` exposes: one wall-clock delta per
 * frame. That is enough to say "the frame took 34 ms" and useless for saying
 * *where* the 34 ms went. Optimizing against a single number means guessing.
 *
 * This module sits inside the frame loop instead, so it can attribute cost:
 *
 *   frameMs   wall clock between rAF callbacks — what the player actually feels
 *   cpuMs     time our JavaScript held the main thread (fixed+update+late+render)
 *   gpuMs     real GPU time, when EXT_disjoint_timer_query_webgl2 is available
 *   other     frameMs - cpuMs — vsync wait, compositing, GPU back-pressure
 *
 * `other` is the diagnostic that matters most. cpuMs ≈ frameMs means we are CPU
 * bound and the phase breakdown says which subsystem to attack. cpuMs well under
 * frameMs means the main thread is idle and the cost is GPU or vsync — in which
 * case shaving JS work changes nothing, and the README's history of this repo is
 * a long record of exactly that mistake.
 *
 * DESIGN CONSTRAINTS
 * ------------------
 *  - Allocates nothing per frame (hard rule 5). Every buffer is a typed array
 *    sized at construction; percentiles sort a reused scratch buffer, and only
 *    when somebody asks for stats — not every frame.
 *  - Never reads a clock that feeds simulation. `performance.now()` here is
 *    measurement only; nothing in this file is allowed to influence a rendered
 *    pixel, which is what keeps `tools/imagediff.mjs` a usable gate.
 *  - Costs ~5 `performance.now()` calls per frame (about 1 µs total) and stays
 *    enabled in production, because a profiler you have to switch on is a
 *    profiler you don't have when the hitch happens.
 */

/** Phase slots, in frame order. Indices are used directly by Engine.step(). */
export const PHASES = ['fixed', 'update', 'late', 'render'];
export const PHASE_FIXED = 0;
export const PHASE_UPDATE = 1;
export const PHASE_LATE = 2;
export const PHASE_RENDER = 3;

/** Ring capacity: 900 frames ≈ 15 s at 60 fps, matching tools/profile.mjs. */
const CAP = 900;

/** GPU timer queries resolve a few frames late; never keep more than this in flight. */
const GPU_QUEUE_MAX = 6;

export class Perf {
  constructor({ capacity = CAP, deterministic = false } = {}) {
    this.cap = capacity;
    /** Capture/pixel-gate runs must not issue extra GL calls of any kind. */
    this.gpuEnabled = !deterministic;

    // ---- ring buffers ----------------------------------------------------
    const f = () => new Float32Array(capacity);
    const u = () => new Uint32Array(capacity);
    this.buf = {
      dt: f(), // wall ms between rAF callbacks
      cpu: f(), // sum of the four phases
      gpu: f(), // GPU ms, NaN until/unless a query resolves
      fixed: f(),
      update: f(),
      late: f(),
      render: f(),
      substeps: u(),
      calls: u(),
      tris: u(),
      progs: u(),
      geos: u(),
      texs: u(),
      heap: f(), // MB
    };
    this.count = 0; // total frames ever recorded
    this.head = 0; // next write index

    // ---- live smoothed values (what the HUD reads) ------------------------
    this.live = {
      fps: 0,
      frameMs: 0,
      cpuMs: 0,
      gpuMs: NaN,
      otherMs: 0,
      fixed: 0,
      update: 0,
      late: 0,
      render: 0,
      substeps: 0,
      calls: 0,
      tris: 0,
      progs: 0,
      geos: 0,
      texs: 0,
      heapMb: 0,
    };

    this._ph = new Float64Array(4);
    this._cursor = 0;
    this._scratch = new Float64Array(capacity);

    // Program count is watched for *deltas*: a jump on the same frame as a
    // hitch is a lazily-compiled shader, the classic Three.js stall.
    this._lastProgs = 0;
    this._progJumpFrame = -1;
    this._progJumpCount = 0;

    // ---- GPU timer query state -------------------------------------------
    this._gl = null;
    this._ext = null;
    this._gpuTried = false;
    this._gpuQueue = []; // in-flight WebGLQuery objects, oldest first
    this._gpuActive = null;
    this._gpuMs = NaN;

    // ---- recording -------------------------------------------------------
    this._rec = null;

    this._logEvery = 0;
    this._logAt = 0;
  }

  /* ------------------------------------------------------------- frame --- */

  /**
   * Called by Engine.step() once input has been latched, so the phase cursor
   * starts at the top of our own work rather than at the rAF timestamp (the gap
   * between those two is browser scheduling latency, not engine cost).
   */
  beginFrame(dtMs) {
    this._dt = dtMs;
    this._cursor = performance.now();
    this._ph[0] = this._ph[1] = this._ph[2] = this._ph[3] = 0;
  }

  /** Close out one phase. `i` is one of the PHASE_* constants. */
  mark(i) {
    const now = performance.now();
    this._ph[i] = now - this._cursor;
    this._cursor = now;
  }

  /**
   * Record the frame. `renderSystem` is duck-typed: anything exposing a
   * three.js `renderer` works, and a missing one just leaves counters at zero.
   */
  endFrame(renderSystem, substeps) {
    const b = this.buf;
    const i = this.head;
    const ph = this._ph;
    const cpu = ph[0] + ph[1] + ph[2] + ph[3];

    b.dt[i] = this._dt;
    b.cpu[i] = cpu;
    // Stored as 0 rather than NaN when no query has resolved yet: a NaN in the
    // ring buffer poisons the percentile sort for the rest of the window.
    b.gpu[i] = Number.isFinite(this._gpuMs) ? this._gpuMs : 0;
    b.fixed[i] = ph[0];
    b.update[i] = ph[1];
    b.late[i] = ph[2];
    b.render[i] = ph[3];
    b.substeps[i] = substeps;

    const info = renderSystem?.renderer?.info;
    if (info) {
      b.calls[i] = info.render.calls;
      b.tris[i] = info.render.triangles;
      b.progs[i] = info.programs?.length ?? 0;
      b.geos[i] = info.memory.geometries;
      b.texs[i] = info.memory.textures;
    } else {
      b.calls[i] = b.tris[i] = b.progs[i] = b.geos[i] = b.texs[i] = 0;
    }

    // performance.memory is Chrome-only and non-standard; absent elsewhere.
    const mem = performance.memory;
    b.heap[i] = mem ? mem.usedJSHeapSize / 1048576 : 0;

    const progs = b.progs[i];
    if (this.count > 0 && progs > this._lastProgs) {
      this._progJumpFrame = this.count;
      this._progJumpCount = progs - this._lastProgs;
    }
    this._lastProgs = progs;

    this.head = (i + 1) % this.cap;
    this.count++;

    this._updateLive(i, cpu);
    if (this._rec) this._pushRecord(i);
    if (this._logEvery && this.count >= this._logAt) {
      this._logAt = this.count + this._logEvery;
      this.log();
    }
  }

  /**
   * Exponential smoothing for the readout. A raw per-frame number is unreadable
   * — it flickers every digit — but a long average hides hitches, so the HUD
   * pairs this with the p99 from stats().
   */
  _updateLive(i, cpu) {
    const b = this.buf;
    const l = this.live;
    // ~0.35 s time constant at 60 fps: settles fast enough to feel live, slow
    // enough that the integer digits hold still.
    const k = 0.06;
    const dt = b.dt[i];
    l.frameMs += (dt - l.frameMs) * k;
    l.cpuMs += (cpu - l.cpuMs) * k;
    l.fps = l.frameMs > 0 ? 1000 / l.frameMs : 0;
    if (Number.isFinite(this._gpuMs)) {
      l.gpuMs = Number.isFinite(l.gpuMs) ? l.gpuMs + (this._gpuMs - l.gpuMs) * k : this._gpuMs;
    }
    l.otherMs = Math.max(0, l.frameMs - l.cpuMs);
    l.fixed += (b.fixed[i] - l.fixed) * k;
    l.update += (b.update[i] - l.update) * k;
    l.late += (b.late[i] - l.late) * k;
    l.render += (b.render[i] - l.render) * k;
    // Counters are exact, not smoothed — a draw-call number that lags is a lie.
    l.substeps = b.substeps[i];
    l.calls = b.calls[i];
    l.tris = b.tris[i];
    l.progs = b.progs[i];
    l.geos = b.geos[i];
    l.texs = b.texs[i];
    l.heapMb = b.heap[i];
  }

  /* --------------------------------------------------------------- gpu --- */

  /**
   * Bracket the draw with a GPU timer query. Called by Engine.step() around the
   * render subsystem, because that is the only place the whole frame's GL work
   * is guaranteed to be enclosed.
   *
   * WebGL2 allows exactly one active TIME_ELAPSED query, and the result is not
   * readable until the GPU drains — typically 2-4 frames later. So this keeps a
   * short FIFO and reports the newest resolved result, which means `gpuMs` is a
   * few frames stale. That is fine for a readout and for a benchmark average,
   * and it is the only way to get real GPU time in a browser.
   */
  beginGpu(renderSystem) {
    if (!this.gpuEnabled) return;
    const gl = this._resolveGl(renderSystem);
    if (!gl || !this._ext || this._gpuActive) return;
    try {
      const q = gl.createQuery();
      gl.beginQuery(this._ext.TIME_ELAPSED_EXT, q);
      this._gpuActive = q;
    } catch {
      this._disableGpu();
    }
  }

  endGpu() {
    if (!this._gpuActive) {
      this._pollGpu();
      return;
    }
    const gl = this._gl;
    try {
      gl.endQuery(this._ext.TIME_ELAPSED_EXT);
      this._gpuQueue.push(this._gpuActive);
      this._gpuActive = null;
      // Bounded queue: if results stop arriving, drop the oldest rather than
      // leaking query objects for the life of the page.
      while (this._gpuQueue.length > GPU_QUEUE_MAX) {
        gl.deleteQuery(this._gpuQueue.shift());
      }
      this._pollGpu();
    } catch {
      this._disableGpu();
    }
  }

  _pollGpu() {
    const gl = this._gl;
    const ext = this._ext;
    if (!gl || !ext) return;
    try {
      // A disjoint event means the GPU was interrupted (power state change,
      // context switch) and every outstanding result is garbage.
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        for (const q of this._gpuQueue) gl.deleteQuery(q);
        this._gpuQueue.length = 0;
        this._gpuMs = NaN;
        return;
      }
      while (this._gpuQueue.length) {
        const q = this._gpuQueue[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        this._gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; // ns -> ms
        gl.deleteQuery(q);
        this._gpuQueue.shift();
      }
    } catch {
      this._disableGpu();
    }
  }

  _resolveGl(renderSystem) {
    if (this._gl) return this._gl;
    if (this._gpuTried) return null;
    this._gpuTried = true;
    const renderer = renderSystem?.renderer;
    if (!renderer?.getContext) return null;
    try {
      const gl = renderer.getContext();
      // Not available in most stock browser configs (Chrome gates it behind a
      // flag, SwiftShader lacks it entirely). Absence is normal, not an error.
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) return null;
      this._gl = gl;
      this._ext = ext;
      return gl;
    } catch {
      return null;
    }
  }

  _disableGpu() {
    this.gpuEnabled = false;
    this._gl = null;
    this._ext = null;
    this._gpuQueue.length = 0;
    this._gpuActive = null;
    this._gpuMs = NaN;
    this.live.gpuMs = NaN;
  }

  get gpuAvailable() {
    return !!this._ext;
  }

  /* ------------------------------------------------------------- stats --- */

  /** Number of samples currently held. */
  get length() {
    return Math.min(this.count, this.cap);
  }

  /**
   * Percentiles over the last `frames` samples. Sorts a reused scratch buffer,
   * so this allocates nothing but is O(n log n) — call it at a few Hz, not
   * every frame.
   */
  percentiles(key = 'dt', frames = this.length) {
    const n = Math.min(frames, this.length);
    if (n === 0) return { p1: 0, p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
    const src = this.buf[key];
    const s = this._scratch;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      // Walk backwards from the newest sample, wrapping the ring.
      const idx = (this.head - 1 - k + this.cap * 2) % this.cap;
      const v = src[idx];
      s[k] = v;
      sum += v;
    }
    const view = s.subarray(0, n);
    view.sort();
    const at = (p) => view[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))];
    return {
      p1: at(0.01),
      p50: at(0.5),
      p90: at(0.9),
      p95: at(0.95),
      p99: at(0.99),
      min: view[0],
      max: view[n - 1],
      mean: sum / n,
    };
  }

  /**
   * Hitch census over the window. Threshold matches tools/profile.mjs so the
   * in-page number and the CLI number mean the same thing:
   * a frame is a hitch when it exceeds max(2 × median, median + 8 ms).
   */
  hitches(frames = this.length) {
    const n = Math.min(frames, this.length);
    const p = this.percentiles('dt', n);
    const threshold = Math.max(2 * p.p50, p.p50 + 8);
    const dt = this.buf.dt;
    let hits = 0;
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const v = dt[(this.head - 1 - k + this.cap * 2) % this.cap];
      if (v > threshold) {
        hits++;
        if (v > worst) worst = v;
      }
    }
    return { count: hits, threshold, worstMs: worst, pct: n ? (hits / n) * 100 : 0 };
  }

  /**
   * Everything a benchmark wants, as one plain JSON-safe object.
   * This is the contract `tools/fpslog.mjs` and any future optimization pass
   * reads — keep field names stable.
   */
  stats(frames = this.length) {
    const n = Math.min(frames, this.length);
    const frame = this.percentiles('dt', n);
    const cpu = this.percentiles('cpu', n);
    const hitch = this.hitches(n);
    const r2 = (v) => +v.toFixed(2);
    const r1 = (v) => +v.toFixed(1);
    const fpsOf = (ms) => (ms > 0 ? +(1000 / ms).toFixed(1) : 0);

    const out = {
      frames: n,
      totalFrames: this.count,
      frameMs: { p1: r2(frame.p1), p50: r2(frame.p50), p90: r2(frame.p90), p95: r2(frame.p95), p99: r2(frame.p99), max: r2(frame.max), mean: r2(frame.mean) },
      // p50 frame time -> average fps; p99 frame time -> the "1% low" that is
      // what actually reads as stutter.
      fps: { p50: fpsOf(frame.p50), p95: fpsOf(frame.p95), p99: fpsOf(frame.p99), avg: fpsOf(frame.mean), low1: fpsOf(frame.p99) },
      cpuMs: { p50: r2(cpu.p50), p95: r2(cpu.p95), max: r2(cpu.max), mean: r2(cpu.mean) },
      phasesMs: {
        fixed: r2(this.percentiles('fixed', n).mean),
        update: r2(this.percentiles('update', n).mean),
        late: r2(this.percentiles('late', n).mean),
        render: r2(this.percentiles('render', n).mean),
      },
      hitches: { count: hitch.count, pctOfFrames: r2(hitch.pct), thresholdMs: r2(hitch.threshold), worstMs: r2(hitch.worstMs) },
      lastProgramJump: this._progJumpCount ? { atFrame: this._progJumpFrame, programs: this._progJumpCount } : null,
      counters: {
        drawCalls: this.live.calls,
        triangles: this.live.tris,
        programs: this.live.progs,
        geometries: this.live.geos,
        textures: this.live.texs,
        substeps: this.live.substeps,
        heapMb: r1(this.live.heapMb),
      },
    };

    // `other` is frameMs the main thread did not spend in our JS: vsync wait,
    // compositing, GPU back-pressure. The bound classification below is the
    // first question any optimization pass has to answer.
    out.otherMs = r2(Math.max(0, frame.mean - cpu.mean));
    if (this.gpuAvailable) {
      const g = this.percentiles('gpu', n);
      out.gpuMs = { p50: r2(g.p50), p95: r2(g.p95), mean: r2(g.mean) };
    } else {
      out.gpuMs = null;
    }
    out.bound = cpu.mean > frame.mean * 0.7 ? 'cpu' : out.otherMs > frame.mean * 0.5 ? 'gpu-or-vsync' : 'mixed';
    return out;
  }

  /* --------------------------------------------------------- recording --- */

  /**
   * Begin a benchmark capture. Unlike the ring buffer this grows without bound,
   * so it is explicitly started and stopped by tooling rather than always on.
   * `frames` auto-stops the recording; omit it to run until stopRecording().
   */
  startRecording({ label = 'run', frames = 0 } = {}) {
    this._rec = { label, limit: frames, startedAtFrame: this.count, rows: [] };
    return { label, limit: frames };
  }

  _pushRecord(i) {
    const b = this.buf;
    const rec = this._rec;
    rec.rows.push({
      f: this.count,
      dt: +b.dt[i].toFixed(3),
      cpu: +b.cpu[i].toFixed(3),
      gpu: Number.isFinite(b.gpu[i]) ? +b.gpu[i].toFixed(3) : null,
      fixed: +b.fixed[i].toFixed(3),
      update: +b.update[i].toFixed(3),
      late: +b.late[i].toFixed(3),
      render: +b.render[i].toFixed(3),
      sub: b.substeps[i],
      calls: b.calls[i],
      tris: b.tris[i],
      progs: b.progs[i],
      heap: +b.heap[i].toFixed(1),
    });
    if (rec.limit && rec.rows.length >= rec.limit) this.stopRecording();
  }

  /** Ends the capture and returns `{label, stats, rows}`. Safe to call twice. */
  stopRecording() {
    const rec = this._rec;
    this._rec = null;
    if (!rec) return null;
    rec.done = true;
    this._lastRecording = {
      label: rec.label,
      frames: rec.rows.length,
      stats: this.stats(Math.min(rec.rows.length, this.cap)),
      rows: rec.rows,
    };
    return this._lastRecording;
  }

  get recording() {
    return !!this._rec;
  }

  get lastRecording() {
    return this._lastRecording ?? null;
  }

  /** Recording as CSV, for dropping into a spreadsheet or a diff. */
  csv(rec = this._lastRecording) {
    if (!rec?.rows?.length) return '';
    const cols = Object.keys(rec.rows[0]);
    const lines = [cols.join(',')];
    for (const r of rec.rows) lines.push(cols.map((c) => (r[c] === null ? '' : r[c])).join(','));
    return lines.join('\n');
  }

  /* ------------------------------------------------------------ output --- */

  /** One-line-per-section summary on the console. `?perflog=N` calls it every N frames. */
  log(frames = this.length) {
    const s = this.stats(frames);
    const g = s.gpuMs ? ` gpu ${s.gpuMs.p50}ms` : '';
    console.info(
      `[perf] ${s.fps.p50} fps (1% low ${s.fps.low1}) · frame ${s.frameMs.p50}ms p99 ${s.frameMs.p99}ms · ` +
        `cpu ${s.cpuMs.p50}ms${g} other ${s.otherMs}ms · bound:${s.bound} · ` +
        `${s.counters.drawCalls} calls ${(s.counters.triangles / 1e6).toFixed(2)}M tris ${s.counters.programs} progs · ` +
        `hitches ${s.hitches.count} (${s.hitches.pctOfFrames}%)`,
      s
    );
    return s;
  }

  /** `?perflog=N` — auto-log a summary every N frames (0 disables). */
  autoLog(everyFrames) {
    this._logEvery = Math.max(0, everyFrames | 0);
    this._logAt = this.count + this._logEvery;
  }

  reset() {
    this.count = 0;
    this.head = 0;
    this._progJumpFrame = -1;
    this._progJumpCount = 0;
    for (const k in this.buf) this.buf[k].fill(0);
    this.live.gpuMs = NaN;
  }

  dispose() {
    if (this._gl) {
      try {
        for (const q of this._gpuQueue) this._gl.deleteQuery(q);
      } catch {
        /* context already lost — nothing to free */
      }
    }
    this._gpuQueue.length = 0;
    this._gpuActive = null;
    this._rec = null;
  }
}
