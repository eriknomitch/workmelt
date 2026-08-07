import { QUALITY_PRESETS } from './config.js';
import {
  GRAPHICS_OPTIONS_BY_ID,
  applyOptionLive,
  needsRestart,
  sanitizeOverrides,
} from './graphics.js';

const quantizeScale = (value) => Math.round(value * 20) / 20;
const REFRESH_BUCKETS = [30, 60, 75, 90, 100, 120, 144, 165, 240, 360];
const LOWER_TIER = { ultra: 'high', high: 'medium', medium: 'low', low: 'performance' };
const HIGHER_TIER = { performance: 'low', low: 'medium', medium: 'high', high: 'ultra' };
const TIER_ORDER = ['performance', 'low', 'medium', 'high', 'ultra'];
// Calibration ignores the first stretch of active play entirely: shader
// compilation, texture bakes and JIT warm-up all land there, and a p95 taken
// over them scores the machine far below what it can actually hold.
const CALIBRATION_WARMUP_MS = 5000;
const CALIBRATION_WARMUP_FRAMES = 60;
// Sustained headroom at the tier's max render scale before promoting a tier.
// While no walk-down has ever proven a real limit (`tierCeiling` null), the
// current tier is one-shot-calibration guesswork measured on whatever scene
// happened to be on screen — so promotion is eager, and the system converges
// from live gameplay evidence instead of trusting that first sample. A wrong
// climb is self-correcting: the walk-down sets the ceiling, ending eagerness.
const PROMOTE_SUSTAIN_MS = 60000;
const PROMOTE_SUSTAIN_UNPROVEN_MS = 20000;
const PROMOTE_HEADROOM = 0.7;
// Sustained CPU-bound target misses before a tier walk-down (resolution cannot
// help a CPU-bound frame, but a cheaper tier's draw/LOD budgets can).
const CPU_LIMIT_MS = 15000;
export const GRAPHICS_STORAGE_KEY = 'cod_graphics_v1';
export const GRAPHICS_MODES = ['auto', 'low', 'medium', 'high', 'ultra'];
export const FPS_TARGETS = [30, 60, 90, 120, 144, 165, 240];
const STORED_VERSIONS = [1, 2, 3, 4, 5];
const CURRENT_VERSION = 5;

const DEFAULT_GRAPHICS = Object.freeze({
  version: CURRENT_VERSION,
  mode: 'auto',
  targetFps: 60,
  tier: null,
  /**
   * A live walk-down proved the tier above this one cannot hold the target, so
   * promotion never climbs past it. Cleared when the target, mode or device
   * changes — the evidence only holds for the conditions it was gathered under.
   */
  tierCeiling: null,
  renderScale: 1,
  refreshHz: null,
  signature: null,
  calibrated: false,
  /** Per-option advanced overrides. See `src/core/graphics.js`. */
  overrides: null,
});

/** Never hand out the frozen literal: `overrides` is a mutable object. */
const defaultGraphics = () => ({ ...DEFAULT_GRAPHICS, overrides: {} });

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadGraphicsSettings(storage = browserStorage()) {
  let raw = null;
  try {
    raw = JSON.parse(storage?.getItem?.(GRAPHICS_STORAGE_KEY) ?? 'null');
  } catch {
    return defaultGraphics();
  }
  if (!raw || !STORED_VERSIONS.includes(raw.version)) return defaultGraphics();
  const migrated = raw.version === 1;
  const mode = GRAPHICS_MODES.includes(raw.mode) ? raw.mode : 'auto';
  let targetFps =
    raw.targetFps === 'display' || FPS_TARGETS.includes(Number(raw.targetFps))
      ? raw.targetFps === 'display'
        ? 'display'
        : Number(raw.targetFps)
      : 60;
  let tier = TIER_ORDER.includes(raw.tier) ? raw.tier : null;
  const tierCeiling = TIER_ORDER.includes(raw.tierCeiling) ? raw.tierCeiling : null;
  let renderScale = Number.isFinite(raw.renderScale)
    ? quantizeScale(Math.min(1, Math.max(0.2, raw.renderScale)))
    : 1;
  const refreshHz =
    Number.isFinite(raw.refreshHz) && raw.refreshHz >= 30 && raw.refreshHz <= 360
      ? Math.round(raw.refreshHz)
      : null;
  let calibrated = raw.calibrated === undefined ? !!tier : !!raw.calibrated;
  let signature = typeof raw.signature === 'string' ? raw.signature : null;
  if (migrated) {
    tier = mode === 'auto' ? null : mode;
    renderScale = mode === 'auto' ? 1 : QUALITY_PRESETS[mode]?.renderScale ?? 1;
    calibrated = mode !== 'auto';
    signature = null;
  }
  // v4 changes the default auto target from "match the display" to a stable
  // 60 fps. Existing auto profiles that were still following the panel refresh
  // are reset so they recalibrate to the new target on next boot instead of
  // preserving a blurry 120 Hz-era compromise on high-refresh panels.
  if (raw.version < 4 && mode === 'auto' && targetFps === 'display') {
    targetFps = 60;
    tier = null;
    renderScale = 1;
    calibrated = false;
  }
  // v5 recalibrates every Auto profile. The initial tier choice is now capped
  // at a one-step drop below the medium boot pipeline, so old persisted tiers
  // — especially aggressive falls straight to `performance` — must be re-done.
  if (raw.version < 5 && mode === 'auto') {
    tier = null;
    renderScale = 1;
    calibrated = false;
  }
  return {
    version: CURRENT_VERSION,
    mode,
    targetFps,
    tier,
    tierCeiling,
    renderScale,
    refreshHz,
    signature,
    calibrated,
    // v1/v2 profiles predate the advanced options, so they migrate to "none set"
    // and keep rendering exactly what they rendered before.
    overrides: sanitizeOverrides(raw.overrides),
  };
}

export function saveGraphicsSettings(settings, storage = browserStorage()) {
  const value = { ...defaultGraphics(), ...settings, version: CURRENT_VERSION };
  value.overrides = sanitizeOverrides(value.overrides);
  try {
    storage?.setItem?.(GRAPHICS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage is optional (private mode and locked-down embeds may reject it).
  }
  return value;
}

export function prepareAutoSettings(settings, { signature, refreshHz }) {
  const signatureChanged = settings.signature !== signature;
  const refreshChanged =
    settings.targetFps === 'display' &&
    settings.refreshHz !== null &&
    refreshHz !== null &&
    settings.refreshHz !== refreshHz;
  const invalidated = signatureChanged || refreshChanged;
  return {
    ...settings,
    signature,
    refreshHz: settings.targetFps === 'display' ? refreshHz : signatureChanged ? null : settings.refreshHz,
    calibrated: invalidated ? false : settings.calibrated,
    tier: invalidated ? null : settings.tier,
    tierCeiling: invalidated ? null : settings.tierCeiling ?? null,
    renderScale: invalidated ? 1 : settings.renderScale,
  };
}

export function resolveGraphicsBoot({ capture = false, explicitQuality = null, settings }) {
  const enabled = !capture && !explicitQuality;
  const quality =
    explicitQuality ??
    (!enabled ? 'ultra' : settings.mode === 'auto' ? settings.tier ?? 'medium' : settings.mode);
  return { enabled, quality };
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function detectDeviceSignature() {
  const s = globalThis.screen;
  const display = `${s?.width ?? 0}x${s?.height ?? 0}:${s?.colorDepth ?? 0}:${
    globalThis.devicePixelRatio ?? 1
  }`;
  let gpu = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext
        ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}:${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`
        : `${gl.getParameter(gl.VENDOR)}:${gl.getParameter(gl.RENDERER)}`;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // Screen/browser data still gives us a useful invalidation signature.
  }
  return hashString(`${display}|${gpu}|${globalThis.navigator?.userAgent ?? ''}`);
}

export function bucketRefreshRate(intervals, fallback = 120) {
  const valid = intervals.filter((ms) => Number.isFinite(ms) && ms >= 2 && ms <= 50);
  if (!valid.length) return fallback;
  valid.sort((a, b) => a - b);
  const median = valid[Math.floor(valid.length / 2)];
  const measured = 1000 / median;
  let best = REFRESH_BUCKETS[0];
  for (const hz of REFRESH_BUCKETS)
    if (Math.abs(hz - measured) < Math.abs(best - measured)) best = hz;
  return Math.abs(best - measured) / best <= 0.2 ? best : Math.round(measured);
}

export function estimateRefreshRate({
  requestFrame = globalThis.requestAnimationFrame,
  samples = 60,
  fallback = 120,
  hidden = globalThis.document?.hidden ?? false,
} = {}) {
  if (hidden || typeof requestFrame !== 'function') return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const intervals = [];
    let previous = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(bucketRefreshRate(intervals, fallback));
    };
    const tick = (now) => {
      if (settled) return;
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (intervals.length >= samples) finish();
      else requestFrame(tick);
    };
    const timeout = setTimeout(finish, 2500);
    requestFrame(tick);
  });
}

export function chooseCalibrationTier(p95Fps, targetFps) {
  const ratio = targetFps > 0 ? p95Fps / targetFps : 0;
  // Calibration is measured while booted on the medium pipeline. Reaching the
  // target there does NOT mean the machine can also hold high or ultra, so the
  // step-up thresholds are intentionally conservative.
  if (ratio >= 1.45) return 'ultra';
  if (ratio >= 1.15) return 'high';
  if (ratio >= 0.95) return 'medium';
  // Likewise, missing the target on medium is not enough evidence to jump
  // straight to the ultra-cheap `performance` preset. Land on `low` first and
  // let the live adaptive policy demote again only if low still misses at its
  // own resolution floor under actual gameplay.
  return 'low';
}

/**
 * Pure adaptive-resolution policy. Browser and renderer side effects live in
 * AdaptiveQualitySystem; tests drive this class with synthetic frame windows.
 */
export class AdaptiveQualityPolicy {
  constructor({
    targetFps = 120,
    initialScale = 1,
    minScale = 0.5,
    maxScale = 1,
    evaluateEveryMs = 2000,
    cooldownMs = 3000,
  } = {}) {
    this.targetFps = targetFps;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.renderScale = quantizeScale(Math.min(maxScale, Math.max(minScale, initialScale)));
    this.evaluateEveryMs = evaluateEveryMs;
    this.cooldownMs = cooldownMs;
    this._lastEvalMs = -Infinity;
    this._lastChangeMs = -Infinity;
    this._misses = 0;
    this._headroom = 0;
    this._floorMissSinceMs = null;
    this._cpuMissSinceMs = null;
    this._status = 'stable';
  }

  setTargetFps(targetFps) {
    if (!Number.isFinite(targetFps) || targetFps <= 0) return this.targetFps;
    this.targetFps = targetFps;
    this._lastEvalMs = -Infinity;
    this._misses = 0;
    this._headroom = 0;
    this._floorMissSinceMs = null;
    this._cpuMissSinceMs = null;
    this._status = 'stable';
    return this.targetFps;
  }

  update({ nowMs, p95FrameMs, p90FrameMs, bound = 'mixed', active = true }) {
    let changed = false;
    if (!active || !Number.isFinite(p95FrameMs) || nowMs - this._lastEvalMs < this.evaluateEveryMs)
      return this._result(changed, p95FrameMs);
    this._lastEvalMs = nowMs;

    const budget = 1000 / this.targetFps;
    // A miss is judged on p90, not p95: over a 240-frame window p95 clears its
    // bar on ~12 bad frames, so a single GC hitch or compositor stall per window
    // could ratchet resolution down on a machine that is otherwise perfect.
    // Headroom stays on p95 — raising resolution should stay conservative.
    const missFrameMs = Number.isFinite(p90FrameMs) ? p90FrameMs : p95FrameMs;
    const missed = missFrameMs > budget * 1.05;
    const roomy = p95FrameMs < budget * 0.85;
    this._misses = missed ? this._misses + 1 : 0;
    this._headroom = roomy ? this._headroom + 1 : 0;
    if (missed && bound === 'cpu') {
      // Resolution cannot help a CPU-bound frame, so the scaler stands down —
      // but the miss is surfaced instead of silently reading as `stable`, and a
      // sustained one escalates to `limited` so the tier walk-down (which also
      // cuts CPU cost: draws, LOD and animation budgets) can act.
      if (this._cpuMissSinceMs === null) this._cpuMissSinceMs = nowMs;
      this._floorMissSinceMs = null;
      this._status = nowMs - this._cpuMissSinceMs >= CPU_LIMIT_MS ? 'limited' : 'cpu-limited';
    } else if (missed && this.renderScale <= this.minScale) {
      this._cpuMissSinceMs = null;
      if (this._floorMissSinceMs === null) this._floorMissSinceMs = nowMs;
      if (nowMs - this._floorMissSinceMs >= 10000) this._status = 'limited';
    } else {
      this._floorMissSinceMs = null;
      this._cpuMissSinceMs = null;
      this._status = 'stable';
    }

    if (
      missed &&
      bound !== 'cpu' &&
      this._misses >= 2 &&
      nowMs - this._lastChangeMs >= this.cooldownMs &&
      this.renderScale > this.minScale
    ) {
      const desired = this.renderScale * Math.sqrt(budget / p95FrameMs);
      const step = this.renderScale - desired >= 0.075 ? 0.1 : 0.05;
      this.renderScale = quantizeScale(Math.max(this.minScale, this.renderScale - step));
      this._lastChangeMs = nowMs;
      this._misses = 0;
      changed = true;
    }

    if (
      roomy &&
      this._headroom >= 3 &&
      nowMs - this._lastChangeMs >= this.cooldownMs &&
      this.renderScale < this.maxScale
    ) {
      this.renderScale = quantizeScale(Math.min(this.maxScale, this.renderScale + 0.05));
      this._lastChangeMs = nowMs;
      this._headroom = 0;
      changed = true;
    }

    return this._result(changed, p95FrameMs);
  }

  _result(changed, p95FrameMs) {
    return {
      changed,
      renderScale: this.renderScale,
      achievedFps: p95FrameMs > 0 ? +(1000 / p95FrameMs).toFixed(1) : 0,
      targetFps: this.targetFps,
      status: this._status,
    };
  }
}

/**
 * Browser-facing system that owns calibration, persistence and renderer scale
 * changes. Callers only need its mode/target/status interface.
 */
export class AdaptiveQualitySystem {
  static id = 'quality';
  static deps = ['render'];

  constructor({ settings, enabled = true, storage, location, now, isActive } = {}) {
    this.settings = { ...defaultGraphics(), ...settings };
    this.settings.overrides = sanitizeOverrides(this.settings.overrides);
    this.enabled = enabled;
    /**
     * A hand-set Resolution Scale is not a suggestion: the adaptive scaler stops
     * touching it, and the tier walk-down (which only ever fires once scaling has
     * bottomed out) can never trigger.
     */
    this.scaleLocked = this.settings.overrides.renderScale !== undefined;
    /** Set by `setOption` when the change cannot land without a reload. */
    this.pendingRestart = false;
    this.storage = storage ?? browserStorage();
    this.location = location ?? globalThis.location;
    this.now = now ?? (() => performance.now());
    this.isActive = isActive ?? ((ctx) => !globalThis.document?.hidden && ctx.time.scale > 0);
    this.policy = null;
    this.ctx = null;
    this._unsubs = [];
    this._reloadPending = false;
    this._deferredReload = false;
    this._demotedThisSession = false;
    this._promoteSinceMs = null;
    this._warmedUp = false;
    this._warmupStartMs = null;
    this._warmupStartFrame = 0;
    this._adaptiveStartFrame = 0;
    this._nextSampleMs = 0;
    this._calibrationStartFrame = 0;
    this._calibrationStartMs = null;
    this._status = {
      mode: this.settings.mode,
      target: this.settings.targetFps,
      targetFps: this._resolveTarget(this.settings.targetFps),
      tier: this.settings.tier,
      renderScale: this.settings.renderScale,
      achievedFps: 0,
      state:
        this.settings.mode !== 'auto'
          ? 'manual'
          : this.settings.calibrated && this.settings.tier
            ? 'stable'
            : 'calibrating',
    };
  }

  async init(ctx) {
    this.ctx = ctx;
    this._calibrationStartFrame = ctx.perf.count;
    this._adaptiveStartFrame = ctx.perf.count;
    // Context-loss recovery lives here rather than in `render` because this is
    // where persistence and reloads already live, and a recovery that is not
    // persisted is a recovery the next boot repeats the crash through. Wired up
    // even when adaptive quality is off: a lost context is not a preference.
    // Optional chaining because the headless tests drive this system with a
    // hand-built ctx that has no event bus.
    const offLost = ctx.events?.on?.('render:contextlost', (e) => this._onContextLost(e));
    if (offLost) this._unsubs.push(offLost);
    // A tier change needs a page reload, and a reload mid-firefight is brutal.
    // Requested reloads wait for a safe boundary instead: the local player's
    // death, the match ending, or the player pausing / hiding the tab (the
    // inactive case is caught at the top of lateUpdate).
    for (const type of ['player:death', 'match:end']) {
      const off = ctx.events?.on?.(type, () => this._fireDeferredReload());
      if (off) this._unsubs.push(off);
    }
    if (!this.enabled || this.settings.mode !== 'auto') {
      this._status.state = this.enabled ? 'manual' : 'override';
      this._status.mode = ctx.config.quality;
      this._status.tier = ctx.config.quality;
      this._status.renderScale = ctx.config.q.renderScale;
      return;
    }
    if (this.settings.calibrated && this.settings.tier) this._activatePolicy();
  }

  lateUpdate(_dt, ctx) {
    if (!this.enabled || this.settings.mode !== 'auto' || this._reloadPending) return;
    if (this._deferredReload) {
      // The new tier is already persisted; the scaler stands down until the
      // reload lands so it cannot write old-tier scales into new-tier settings.
      if (!this.isActive(ctx)) this._fireDeferredReload();
      return;
    }
    const nowMs = this.now();
    if (!this.settings.calibrated || !this.settings.tier) {
      if (!this.isActive(ctx)) {
        this._calibrationStartFrame = ctx.perf.count;
        this._calibrationStartMs = null;
        this._warmedUp = false;
        this._warmupStartMs = null;
        return;
      }
      this._calibrate(nowMs, ctx);
      return;
    }
    // Calibration still runs with a pinned resolution — it is measuring what the
    // machine can hold AT that resolution, which is exactly the right question.
    // Only the scaler itself stands down.
    if (this.scaleLocked) {
      this._status.state = 'pinned';
      this._status.renderScale = this.settings.overrides.renderScale;
      return;
    }
    const active = this.isActive(ctx);
    if (!active) {
      this._adaptiveStartFrame = ctx.perf.count;
      this._nextSampleMs = 0;
      this._promoteSinceMs = null;
      return;
    }
    const adaptiveFrames = ctx.perf.count - this._adaptiveStartFrame;
    if (!this.policy || adaptiveFrames < 240) return;
    if (nowMs < this._nextSampleMs) return;
    this._nextSampleMs = nowMs + 2000;

    const stats = ctx.perf.stats(240);
    const result = this.policy.update({
      nowMs,
      p95FrameMs: stats.frameMs.p95,
      p90FrameMs: stats.frameMs.p90,
      bound: stats.bound,
      active,
    });
    this._status.achievedFps = result.achievedFps;
    this._status.renderScale = result.renderScale;
    this._status.state = result.status;
    if (result.status === 'limited') {
      const tier = LOWER_TIER[this.settings.tier];
      if (tier) {
        const renderScale = QUALITY_PRESETS[tier]?.renderScale ?? result.renderScale;
        // The tier we are leaving is proven unable to hold this target, so the
        // promotion path may never climb back into it.
        this._persist({ tier, tierCeiling: tier, renderScale, calibrated: true });
        this._demotedThisSession = true;
        this._status.tier = tier;
        this._status.renderScale = renderScale;
        this._requestReload();
        return;
      }
    }
    this._maybePromote(nowMs, stats);
    if (this._deferredReload || !result.changed) return;

    ctx.get('render').setRenderScale(result.renderScale);
    this._adaptiveStartFrame = ctx.perf.count;
    this._persist({ renderScale: result.renderScale });
  }

  _calibrate(nowMs, ctx) {
    // The measurement window opens only after the warm-up stretch has fully
    // elapsed — the frames spent warming up are discarded, not averaged in.
    if (!this._warmedUp) {
      if (this._warmupStartMs === null) {
        this._warmupStartMs = nowMs;
        this._warmupStartFrame = ctx.perf.count;
      }
      if (
        nowMs - this._warmupStartMs < CALIBRATION_WARMUP_MS ||
        ctx.perf.count - this._warmupStartFrame < CALIBRATION_WARMUP_FRAMES
      )
        return;
      this._warmedUp = true;
      this._calibrationStartFrame = ctx.perf.count;
      this._calibrationStartMs = nowMs;
      return;
    }
    if (this._calibrationStartMs === null) this._calibrationStartMs = nowMs;
    const frames = ctx.perf.count - this._calibrationStartFrame;
    const elapsed = nowMs - this._calibrationStartMs;
    if (frames < 45 || (frames < 240 && elapsed < 5000)) return;

    const stats = ctx.perf.stats(Math.min(frames, 240));
    const targetFps = this._resolveTarget(this.settings.targetFps);
    const tier = chooseCalibrationTier(stats.fps.p95, targetFps);
    this._status.achievedFps = stats.fps.p95;
    this._status.tier = tier;
    this._persist({
      tier,
      calibrated: true,
      renderScale: QUALITY_PRESETS[tier]?.renderScale ?? 1,
    });

    if (tier !== ctx.config.quality && loadGraphicsSettings(this.storage).tier === tier) {
      // Immediate, not deferred: the UI blocks play behind a scrim for the
      // whole calibration phase, so nobody is mid-fight here — and the deferred
      // path would wait on a death that cannot happen behind the blocker.
      this._status.state = 'reloading';
      this._reloadPending = true;
      this.location?.reload?.();
      return;
    }
    this._activatePolicy();
  }

  /**
   * Tier promotion: calibration and the walk-down can only ever move down, so a
   * machine mis-scored once (a heavy first session, a background download)
   * would otherwise stay pessimised forever. Sustained large headroom while
   * already rendering at the tier's max scale is the evidence that the next
   * tier up is worth trying. Blocked by the persisted ceiling (a tier a live
   * walk-down proved out) and after a same-session demotion, so demote/promote
   * cannot ping-pong.
   */
  _maybePromote(nowMs, stats) {
    const next = HIGHER_TIER[this.settings.tier];
    const ceiling = this.settings.tierCeiling;
    const blocked =
      !next ||
      this._demotedThisSession ||
      this.scaleLocked ||
      (ceiling && TIER_ORDER.indexOf(next) > TIER_ORDER.indexOf(ceiling));
    const budget = 1000 / this.policy.targetFps;
    const headroom =
      !blocked &&
      this._status.state === 'stable' &&
      this.policy.renderScale >= this.policy.maxScale &&
      stats.frameMs.p95 < budget * PROMOTE_HEADROOM;
    if (!headroom) {
      this._promoteSinceMs = null;
      return;
    }
    if (this._promoteSinceMs === null) {
      this._promoteSinceMs = nowMs;
      return;
    }
    const sustain = ceiling === null ? PROMOTE_SUSTAIN_UNPROVEN_MS : PROMOTE_SUSTAIN_MS;
    if (nowMs - this._promoteSinceMs < sustain) return;
    const renderScale = QUALITY_PRESETS[next]?.renderScale ?? 1;
    this._persist({ tier: next, renderScale, calibrated: true });
    this._status.tier = next;
    this._status.renderScale = renderScale;
    this._requestReload();
  }

  /** Ask for a reload at the next safe boundary; immediate if already at one. */
  _requestReload() {
    if (this._reloadPending || this._deferredReload) return;
    this._deferredReload = true;
    this._status.state = 'reload-pending';
    if (!this.ctx || !this.isActive(this.ctx)) this._fireDeferredReload();
  }

  _fireDeferredReload() {
    if (!this._deferredReload || this._reloadPending) return;
    this._deferredReload = false;
    this._reloadPending = true;
    this._status.state = 'reloading';
    this.location?.reload?.();
  }

  /**
   * The GPU dropped the context. Persist a smaller pixel budget than the one we
   * died at, then reload into it — a fresh context is the only reliable way back
   * (the same reason the "limited" walk-down below reloads), and persisting is
   * what stops the next boot walking into the same wall.
   *
   * Snapped DOWN to an offered menu value so the player sees a setting they can
   * recognise and raise again, not an arbitrary number.
   */
  _onContextLost({ suggestedMaxPixels } = {}) {
    if (this._reloadPending) return;
    this._reloadPending = true;
    const offered = (GRAPHICS_OPTIONS_BY_ID.maxPixels?.values ?? [])
      .map((v) => Number(v.value))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    const target = Number(suggestedMaxPixels) || 0;
    const picked = offered.filter((n) => n <= target).pop() ?? offered[0] ?? target;
    this._status.state = 'reloading';
    console.error(`[quality] context lost — reloading at a ${(picked / 1e6).toFixed(1)} MP budget`);
    this._persist({ overrides: { ...this.settings.overrides, maxPixels: picked } });
    this.location?.reload?.();
  }

  _activatePolicy() {
    const targetFps = this._resolveTarget(this.settings.targetFps);
    this.policy = new AdaptiveQualityPolicy({
      targetFps,
      initialScale: this.settings.renderScale,
      minScale: QUALITY_PRESETS[this.settings.tier]?.minRenderScale ?? 0.5,
      maxScale: QUALITY_PRESETS[this.settings.tier]?.maxRenderScale ?? 1,
    });
    this._adaptiveStartFrame = this.ctx?.perf.count ?? 0;
    this._nextSampleMs = 0;
    this._status.targetFps = targetFps;
    this._status.tier = this.settings.tier ?? this.ctx?.config.quality ?? 'ultra';
    this._status.renderScale = this.settings.renderScale;
    this._status.state = 'stable';
  }

  _resolveTarget(target) {
    return target === 'display' ? this.settings.refreshHz ?? 120 : Number(target) || 60;
  }

  _persist(patch) {
    Object.assign(this.settings, patch);
    saveGraphicsSettings(this.settings, this.storage);
  }

  setMode(mode) {
    if (!this.enabled || !GRAPHICS_MODES.includes(mode)) return false;
    if (mode === this.settings.mode) return true;
    const patch =
      mode === 'auto'
        ? { mode, tier: null, tierCeiling: null, calibrated: false, renderScale: 1 }
        : { mode, tier: mode, tierCeiling: null, calibrated: true, renderScale: 1 };
    this._persist(patch);
    this._reloadPending = true;
    this.location?.reload?.();
    return true;
  }

  setTarget(target) {
    const value =
      target === 'display' ? 'display' : FPS_TARGETS.includes(Number(target)) ? Number(target) : null;
    if (value === null) return false;
    if (value === this.settings.targetFps) return true;
    const patch =
      this.settings.mode === 'auto'
        ? { targetFps: value, tier: null, tierCeiling: null, calibrated: false, renderScale: 1 }
        : { targetFps: value };
    this._persist(patch);
    if (this.settings.mode === 'auto' && this.enabled) {
      this._reloadPending = true;
      this.location?.reload?.();
    }
    return true;
  }

  /**
   * Player-triggered fresh start: forget the whole measured profile — tier,
   * ceiling, scale — switch to Auto if not there already, and reload straight
   * into a new calibration. Called from the settings menu, so the game is
   * paused and the reload needs no deferral.
   */
  recalibrate() {
    if (!this.enabled) return false;
    this._persist({ mode: 'auto', tier: null, tierCeiling: null, calibrated: false, renderScale: 1 });
    this._reloadPending = true;
    this.location?.reload?.();
    return true;
  }

  resetDefaults() {
    if (!this.enabled) return false;
    this._persist({
      mode: 'auto',
      targetFps: 60,
      tier: null,
      tierCeiling: null,
      calibrated: false,
      renderScale: 1,
      overrides: {},
    });
    this._reloadPending = true;
    this.location?.reload?.();
    return true;
  }

  /* ------------------------------------------------ advanced options ---- */

  /** The sparse override map, as persisted. Treat it as read-only. */
  getOverrides() {
    return this.settings.overrides ?? {};
  }

  /**
   * Set (or, with `undefined`/`'auto'`, clear) one advanced option.
   *
   * The value is persisted immediately either way — a player who tunes shadows
   * and then alt-F4s should not lose the setting because they never pressed
   * Apply. What Apply does is reload, and only options that cannot take effect
   * without one set `pendingRestart`.
   *
   * @returns {{ ok: boolean, live: boolean, restart: boolean }}
   */
  setOption(id, value, ctx = this.ctx) {
    const opt = GRAPHICS_OPTIONS_BY_ID[id];
    if (!this.enabled || !opt) return { ok: false, live: false, restart: false };

    const next = { ...this.getOverrides() };
    if (value === undefined || value === null || value === 'auto') delete next[id];
    else next[id] = value;
    const clean = sanitizeOverrides(next);
    // sanitizeOverrides drops a value the schema does not offer; refusing here
    // rather than silently persisting "unchanged" keeps the menu honest.
    if (value !== undefined && value !== null && value !== 'auto' && clean[id] === undefined)
      return { ok: false, live: false, restart: false };

    this._persist({ overrides: clean });
    this.scaleLocked = clean.renderScale !== undefined;

    // Clearing an override cannot be pushed live: the preset value it falls back
    // to for a pass or a texture bake only exists at boot.
    const cleared = clean[id] === undefined;
    const live = !cleared && !needsRestart(id) && applyOptionLive(opt, clean[id], ctx);
    if (!live) this.pendingRestart = true;
    return { ok: true, live, restart: !live };
  }

  /**
   * Apply an option to the running renderer WITHOUT persisting it.
   *
   * This is the slider-drag path. Writing localStorage on every pointer sample
   * is a synchronous JSON serialise per frame; the matching `change` event
   * calls `setOption` with the value the player actually settled on.
   */
  previewOption(id, value, ctx = this.ctx) {
    const opt = GRAPHICS_OPTIONS_BY_ID[id];
    if (!this.enabled || !opt || needsRestart(id)) return { ok: false, live: false, restart: true };
    const clean = sanitizeOverrides({ [id]: value })[id];
    if (clean === undefined) return { ok: false, live: false, restart: false };
    const live = applyOptionLive(opt, clean, ctx);
    return { ok: live, live, restart: !live };
  }

  /** Drop every advanced override, keeping mode/target. Always needs a reload. */
  resetOptions() {
    if (!this.enabled) return false;
    this._persist({ overrides: {} });
    this.scaleLocked = false;
    this.pendingRestart = true;
    return true;
  }

  /** Reload so the restart-only options take effect. */
  applyPending() {
    if (!this.enabled || !this.pendingRestart) return false;
    this._reloadPending = true;
    this.location?.reload?.();
    return true;
  }

  /**
   * True while the measurement phase is running. Other systems key protective
   * behaviour off this — the UI's blocking scrim and input freeze, the player's
   * calibration camera pan, and damage immunity (a frozen player is a sitting
   * duck, and a death mid-measurement respawns the camera and pollutes the
   * frames being scored).
   */
  get calibrating() {
    return this.enabled && this._status.state === 'calibrating';
  }

  getStatus() {
    this._status.target = this.settings.targetFps;
    this._status.pendingRestart = this.pendingRestart;
    this._status.scaleLocked = this.scaleLocked;
    return this._status;
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs.length = 0;
  }
}
