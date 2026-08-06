#!/usr/bin/env node

import assert from 'node:assert/strict';
import { QUALITY_PRESETS } from './config.js';
import {
  AdaptiveQualityPolicy,
  AdaptiveQualitySystem,
  bucketRefreshRate,
  chooseCalibrationTier,
  estimateRefreshRate,
  loadGraphicsSettings,
  prepareAutoSettings,
  resolveGraphicsBoot,
} from './quality.js';

let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
}

async function checkAsync(name, fn) {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
}

check('reduces render scale only after two consecutive p95 misses', () => {
  const policy = new AdaptiveQualityPolicy({ targetFps: 60, initialScale: 1 });

  const first = policy.update({ nowMs: 0, p95FrameMs: 25, bound: 'gpu-or-vsync' });
  assert.equal(first.changed, false);
  assert.equal(first.renderScale, 1);

  const second = policy.update({ nowMs: 2000, p95FrameMs: 25, bound: 'gpu-or-vsync' });
  assert.equal(second.changed, true);
  assert.equal(second.renderScale, 0.9);
});

check('uses exact five-percent steps for a small target miss', () => {
  const policy = new AdaptiveQualityPolicy({ targetFps: 60, initialScale: 1 });
  policy.update({ nowMs: 0, p95FrameMs: 18, bound: 'gpu-or-vsync' });
  const result = policy.update({ nowMs: 2000, p95FrameMs: 18, bound: 'gpu-or-vsync' });
  assert.equal(result.renderScale, 0.95);
});

check('does not chase a CPU-bound miss with resolution changes', () => {
  const policy = new AdaptiveQualityPolicy({ targetFps: 60, initialScale: 1 });
  for (let nowMs = 0; nowMs <= 6000; nowMs += 2000)
    policy.update({ nowMs, p95FrameMs: 25, bound: 'cpu' });
  assert.equal(policy.renderScale, 1);
});

check('enforces its resize cooldown under frequent sampling', () => {
  const policy = new AdaptiveQualityPolicy({
    targetFps: 60,
    initialScale: 1,
    evaluateEveryMs: 500,
    cooldownMs: 3000,
  });
  let changes = 0;
  for (let nowMs = 0; nowMs <= 3000; nowMs += 500)
    if (policy.update({ nowMs, p95FrameMs: 25, bound: 'gpu-or-vsync' }).changed) changes++;
  assert.equal(changes, 1);
  assert.equal(policy.renderScale, 0.9);
});

check('raises render scale after three windows with headroom', () => {
  const policy = new AdaptiveQualityPolicy({ targetFps: 60, initialScale: 0.7 });

  assert.equal(policy.update({ nowMs: 0, p95FrameMs: 12 }).changed, false);
  assert.equal(policy.update({ nowMs: 2000, p95FrameMs: 12 }).changed, false);
  const third = policy.update({ nowMs: 4000, p95FrameMs: 12 });

  assert.equal(third.changed, true);
  assert.equal(third.renderScale, 0.75);
});

check('resets adaptation history when the target changes', () => {
  const policy = new AdaptiveQualityPolicy({ targetFps: 60, initialScale: 1 });
  policy.update({ nowMs: 0, p95FrameMs: 25 });
  policy.setTargetFps(30);
  const result = policy.update({ nowMs: 2000, p95FrameMs: 25 });

  assert.equal(result.changed, false);
  assert.equal(result.targetFps, 30);
  assert.equal(result.renderScale, 1);
});

check('reports limited after ten seconds missing the target at the quality floor', () => {
  const policy = new AdaptiveQualityPolicy({ targetFps: 120, initialScale: 0.5 });
  let result;
  for (let nowMs = 0; nowMs <= 10000; nowMs += 2000)
    result = policy.update({ nowMs, p95FrameMs: 16, bound: 'gpu-or-vsync' });

  assert.equal(result.renderScale, 0.5);
  assert.equal(result.status, 'limited');
});

check('buckets clean animation-frame samples to a common display rate', () => {
  const intervals = [8.2, 8.4, 8.3, 8.5, 8.2, 8.3, 8.4];
  assert.equal(bucketRefreshRate(intervals), 120);
  assert.equal(bucketRefreshRate([], 120), 120);
});

check('selects a pipeline tier conservatively from medium-pipeline calibration', () => {
  assert.equal(chooseCalibrationTier(120, 120), 'medium');
  assert.equal(chooseCalibrationTier(144, 120), 'high');
  assert.equal(chooseCalibrationTier(180, 120), 'ultra');
  assert.equal(chooseCalibrationTier(90, 120), 'low');
  assert.equal(chooseCalibrationTier(60, 120), 'low');
  assert.equal(chooseCalibrationTier(30, 120), 'low');
});

check('performance tier exposes the aggressive Auto pipeline contract', () => {
  assert.deepEqual(
    {
      renderScale: QUALITY_PRESETS.performance.renderScale,
      maxRenderScale: QUALITY_PRESETS.performance.maxRenderScale,
      shadows: QUALITY_PRESETS.performance.shadows,
      shadowQuality: QUALITY_PRESETS.performance.shadowQuality,
      prepass: QUALITY_PRESETS.performance.prepass,
      post: QUALITY_PRESETS.performance.post,
    },
    {
      renderScale: 0.3,
      maxRenderScale: 0.3,
      shadows: true,
      shadowQuality: -1,
      prepass: true,
      post: true,
    }
  );
});

check('loads versioned per-browser settings and rejects corrupt values', () => {
  const storage = {
    getItem: () =>
      JSON.stringify({ version: 2, mode: 'auto', targetFps: 144, tier: 'high', renderScale: 0.8 }),
  };
  // v5 recalibrates legacy Auto profiles so the new initial-tier policy runs
  // once rather than preserving an older direct walk-down result.
  assert.deepEqual(loadGraphicsSettings(storage), {
    version: 5,
    mode: 'auto',
    targetFps: 144,
    tier: null,
    renderScale: 1,
    refreshHz: null,
    signature: null,
    calibrated: false,
    overrides: {},
  });
  assert.equal(loadGraphicsSettings({ getItem: () => '{bad' }).mode, 'auto');
  assert.equal(
    loadGraphicsSettings({ getItem: () => JSON.stringify({ version: 1, tier: 'low' }) }).tier,
    null
  );
  const migrated = loadGraphicsSettings({
    getItem: () => JSON.stringify({ version: 1, mode: 'high', targetFps: 90 }),
  });
  assert.equal(migrated.mode, 'high');
  assert.equal(migrated.targetFps, 90);
  assert.equal(migrated.tier, 'high');
  assert.equal(migrated.calibrated, true);

  const retargeted = loadGraphicsSettings({
    getItem: () => JSON.stringify({ version: 3, mode: 'auto', targetFps: 'display', tier: 'high', renderScale: 0.8, calibrated: true }),
  });
  assert.equal(retargeted.version, 5);
  assert.equal(retargeted.targetFps, 60);
  assert.equal(retargeted.tier, null);
  assert.equal(retargeted.renderScale, 1);
  assert.equal(retargeted.calibrated, false);

  const recalibrated = loadGraphicsSettings({
    getItem: () => JSON.stringify({ version: 4, mode: 'auto', targetFps: 60, tier: 'performance', renderScale: 0.3, calibrated: true }),
  });
  assert.equal(recalibrated.version, 5);
  assert.equal(recalibrated.targetFps, 60);
  assert.equal(recalibrated.tier, null);
  assert.equal(recalibrated.renderScale, 1);
  assert.equal(recalibrated.calibrated, false);
});

check('invalidates calibration when the device or measured refresh changes', () => {
  const settings = {
    version: 2,
    mode: 'auto',
    targetFps: 'display',
    tier: 'high',
    renderScale: 0.8,
    refreshHz: 60,
    signature: 'device-a',
    calibrated: true,
  };
  const changed = prepareAutoSettings(settings, { signature: 'device-a', refreshHz: 144 });
  assert.equal(changed.calibrated, false);
  assert.equal(changed.tier, null);
  assert.equal(changed.renderScale, 1);
});

check('capture and explicit quality overrides bypass Auto deterministically', () => {
  const settings = { mode: 'auto', tier: 'low' };
  assert.deepEqual(resolveGraphicsBoot({ capture: true, settings }), {
    enabled: false,
    quality: 'ultra',
  });
  assert.deepEqual(resolveGraphicsBoot({ explicitQuality: 'medium', settings }), {
    enabled: false,
    quality: 'medium',
  });
});

await checkAsync('estimates refresh through an injected animation-frame clock', async () => {
  let now = 0;
  const requestFrame = (callback) => {
    now += 1000 / 144;
    queueMicrotask(() => callback(now));
  };
  assert.equal(await estimateRefreshRate({ requestFrame, samples: 12 }), 144);
  assert.equal(await estimateRefreshRate({ requestFrame, hidden: true }), 120);
});

await checkAsync('calibrates once, persists the tier, and reloads when the pipeline changes', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let nowMs = 0;
  let reloads = 0;
  const location = { href: 'http://localhost:5173/?room=ABC123', reload: () => reloads++ };
  const perf = {
    count: 0,
    stats: () => ({
      fps: { p95: 30 },
      frameMs: { p95: 1000 / 30 },
      bound: 'gpu-or-vsync',
    }),
  };
  const ctx = {
    perf,
    time: { scale: 1 },
    config: { quality: 'ultra', q: { renderScale: 1 } },
    get: () => ({ setRenderScale() {} }),
  };
  const system = new AdaptiveQualitySystem({
    settings: { mode: 'auto', targetFps: 120, refreshHz: 120, calibrated: false },
    storage,
    location,
    now: () => nowMs,
  });

  await system.init(ctx);
  system.lateUpdate(0, ctx);
  nowMs = 5001;
  perf.count = 60;
  system.lateUpdate(0, ctx);

  assert.equal(loadGraphicsSettings(storage).tier, 'low');
  assert.equal(loadGraphicsSettings(storage).renderScale, 0.7);
  assert.equal(reloads, 1);
  assert.equal(location.href, 'http://localhost:5173/?room=ABC123');
});

await checkAsync('discards hidden calibration frames before choosing a tier', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let active = false;
  let nowMs = 0;
  let reloads = 0;
  const perf = {
    count: 0,
    stats: () => ({
      fps: { p95: 60 },
      frameMs: { p95: 1000 / 60 },
      bound: 'gpu-or-vsync',
    }),
  };
  const ctx = {
    perf,
    time: { scale: 1 },
    config: { quality: 'ultra', q: { renderScale: 1 } },
    get: () => ({ setRenderScale() {} }),
  };
  const system = new AdaptiveQualitySystem({
    settings: { mode: 'auto', targetFps: 120, calibrated: false },
    storage,
    location: { reload: () => reloads++ },
    now: () => nowMs,
    isActive: () => active,
  });
  await system.init(ctx);

  perf.count = 60;
  nowMs = 5000;
  system.lateUpdate(0, ctx);
  assert.equal(reloads, 0);

  active = true;
  system.lateUpdate(0, ctx);
  perf.count = 120;
  nowMs = 10001;
  system.lateUpdate(0, ctx);
  assert.equal(reloads, 1);
});

await checkAsync('applies adaptive render scale through the renderer interface', async () => {
  let nowMs = 0;
  let appliedScale = 1;
  const perf = {
    count: 0,
    stats: () => ({
      fps: { p95: 40 },
      frameMs: { p95: 25 },
      bound: 'gpu-or-vsync',
    }),
  };
  const ctx = {
    perf,
    time: { scale: 1 },
    config: { quality: 'low', q: { renderScale: 1 } },
    get: () => ({ setRenderScale: (scale) => (appliedScale = scale) }),
  };
  const system = new AdaptiveQualitySystem({
    settings: {
      mode: 'auto',
      targetFps: 60,
      tier: 'low',
      renderScale: 1,
      calibrated: true,
    },
    storage: { getItem: () => null, setItem() {} },
    now: () => nowMs,
  });

  await system.init(ctx);
  perf.count = 240;
  system.lateUpdate(0, ctx);
  nowMs = 2000;
  perf.count = 480;
  system.lateUpdate(0, ctx);

  assert.equal(appliedScale, 0.9);
  assert.equal(system.getStatus().renderScale, 0.9);
});

await checkAsync('demotes a limited Auto pipeline and reloads at the next tier', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let nowMs = 0;
  let reloads = 0;
  const perf = {
    count: 240,
    stats: () => ({
      fps: { p95: 62.5 },
      frameMs: { p95: 16 },
      bound: 'gpu-or-vsync',
    }),
  };
  const ctx = {
    perf,
    time: { scale: 1 },
    config: { quality: 'low', q: { renderScale: 0.5 } },
    get: () => ({ setRenderScale() {} }),
  };
  const system = new AdaptiveQualitySystem({
    settings: {
      mode: 'auto',
      targetFps: 120,
      tier: 'low',
      renderScale: 0.5,
      calibrated: true,
    },
    storage,
    location: { reload: () => reloads++ },
    now: () => nowMs,
  });

  await system.init(ctx);
  for (nowMs = 0; nowMs <= 10000; nowMs += 2000) {
    perf.count += 240;
    system.lateUpdate(0, ctx);
  }

  const saved = loadGraphicsSettings(storage);
  assert.equal(saved.tier, 'performance');
  assert.equal(saved.renderScale, 0.3);
  assert.equal(system.getStatus().state, 'reloading');
  assert.equal(reloads, 1);
});

check('manual graphics selection persists and reloads exactly once', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let reloads = 0;
  const system = new AdaptiveQualitySystem({
    settings: { mode: 'auto', targetFps: 'display' },
    storage,
    location: { reload: () => reloads++ },
  });
  assert.equal(system.setMode('high'), true);
  assert.equal(loadGraphicsSettings(storage).mode, 'high');
  assert.equal(reloads, 1);
});

/* ------------------------------------------- advanced graphics options -- */
// The schema itself is checked by `src/core/graphics.selftest.mjs`; what
// follows is the quality SYSTEM's half of the contract — persistence, live vs
// restart classification, and the resolution pin.

const optionHarness = ({ settings = {}, render } = {}) => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let reloads = 0;
  const applied = [];
  const renderStub = render ?? {
    settings: { grain: 0.01, exposureBias: 0, skyFill: 0.32 },
    applySettings() {
      applied.push('applySettings');
    },
    setRenderScale(v) {
      applied.push(`renderScale:${v}`);
    },
    setRenderScaleLimits() {},
    setPixelRatioCap(v) {
      applied.push(`dpr:${v}`);
    },
    setAmbientFill(v) {
      applied.push(`ambient:${v}`);
    },
  };
  const ctx = {
    config: { quality: 'ultra', q: { renderScale: 1 }, fov: 80 },
    events: { emit() {} },
    camera: null,
    peek: (id) => (id === 'render' ? renderStub : null),
  };
  const system = new AdaptiveQualitySystem({
    settings: { mode: 'auto', targetFps: 'display', ...settings },
    storage,
    location: { reload: () => reloads++ },
  });
  system.ctx = ctx;
  return { system, storage, ctx, render: renderStub, applied, reloads: () => reloads };
};

check('a live option applies to the renderer without a reload', () => {
  const h = optionHarness();
  const result = h.system.setOption('grain', 0);
  assert.equal(result.ok, true);
  assert.equal(result.live, true);
  assert.equal(result.restart, false);
  assert.equal(h.render.settings.grain, 0);
  assert.equal(h.system.pendingRestart, false);
  assert.equal(h.reloads(), 0);
  assert.equal(loadGraphicsSettings(h.storage).overrides.grain, 0);
});

check('brightness reaches the renderer as an inverted exposure bias', () => {
  const h = optionHarness();
  h.system.setOption('brightness', 0.75);
  assert.equal(h.render.settings.exposureBias, -0.75);
});

check('a restart-only option persists and raises the pending flag', () => {
  const h = optionHarness();
  const result = h.system.setOption('textureScale', 2);
  assert.equal(result.ok, true);
  assert.equal(result.live, false);
  assert.equal(result.restart, true);
  assert.equal(h.system.pendingRestart, true);
  assert.equal(h.reloads(), 0, 'must not reload under the player mid-menu');
  assert.equal(loadGraphicsSettings(h.storage).overrides.textureScale, 2);
  assert.equal(h.system.applyPending(), true);
  assert.equal(h.reloads(), 1);
});

check('an unknown option or value is refused rather than persisted', () => {
  const h = optionHarness();
  assert.equal(h.system.setOption('nope', 1).ok, false);
  assert.equal(h.system.setOption('antialias', 'msaa').ok, false);
  assert.deepEqual(loadGraphicsSettings(h.storage).overrides, {});
});

check('clearing an option drops the override and asks for a restart', () => {
  const h = optionHarness();
  h.system.setOption('shadowQuality', 'ultra');
  h.system.pendingRestart = false;
  const result = h.system.setOption('shadowQuality', 'auto');
  assert.equal(result.ok, true);
  assert.equal(result.restart, true);
  assert.deepEqual(loadGraphicsSettings(h.storage).overrides, {});
});

check('a preview drag moves the picture without touching storage', () => {
  const h = optionHarness();
  assert.equal(h.system.previewOption('grain', 0.04).live, true);
  assert.equal(h.render.settings.grain, 0.04);
  assert.deepEqual(loadGraphicsSettings(h.storage).overrides, {}, 'not persisted');
  // A restart-only option has nothing to preview.
  assert.equal(h.system.previewOption('textureScale', 2).live, false);
});

check('a hand-set resolution scale pins the adaptive scaler', () => {
  const h = optionHarness({ settings: { calibrated: true, tier: 'high', renderScale: 1 } });
  assert.equal(h.system.scaleLocked, false);
  h.system.setOption('renderScale', 1.5);
  assert.equal(h.system.scaleLocked, true);

  const perf = {
    count: 100000,
    stats: () => ({ fps: { p95: 20 }, frameMs: { p95: 50 }, bound: 'gpu-or-vsync' }),
  };
  const ctx = { ...h.ctx, perf, time: { scale: 1 }, get: () => h.render };
  h.system.policy = null;
  h.system.lateUpdate(0, ctx);
  assert.equal(h.system.getStatus().state, 'pinned');
  assert.equal(h.reloads(), 0, 'a pinned resolution can never walk the tier down');
});

check('resetting defaults clears the advanced overrides too', () => {
  const h = optionHarness();
  h.system.setOption('textureScale', 2);
  h.system.setOption('grain', 0);
  h.system.resetDefaults();
  assert.deepEqual(loadGraphicsSettings(h.storage).overrides, {});
});

await checkAsync('a lost GL context persists a smaller pixel budget and reloads', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let reloads = 0;
  const handlers = new Map();
  const ctx = {
    perf: { count: 0, stats: () => ({ fps: { p95: 60 }, frameMs: { p95: 16 }, bound: 'mixed' }) },
    time: { scale: 1 },
    config: { quality: 'high', q: { renderScale: 1 } },
    events: {
      on: (type, fn) => {
        handlers.set(type, fn);
        return () => handlers.delete(type);
      },
    },
    get: () => ({ setRenderScale() {} }),
  };
  const system = new AdaptiveQualitySystem({
    settings: { mode: 'auto', targetFps: 120, refreshHz: 120, tier: 'high', calibrated: true },
    storage,
    location: { reload: () => reloads++ },
    now: () => 0,
  });
  await system.init(ctx);

  // Died at 14.7 MP, so the recovery wants ~7.4 MP and must snap DOWN to an
  // offered menu value rather than inventing one the player cannot recognise.
  handlers.get('render:contextlost')({ pixels: 14745600, suggestedMaxPixels: 7372800 });

  const saved = loadGraphicsSettings(storage);
  assert.equal(saved.overrides.maxPixels, 3686400, 'snaps down to the 1440p budget');
  assert.equal(reloads, 1, 'a fresh context is the only reliable way back');
  assert.equal(system.getStatus().state, 'reloading');

  // A second loss mid-reload must not stack another reload on top.
  handlers.get('render:contextlost')({ pixels: 3686400, suggestedMaxPixels: 1843200 });
  assert.equal(reloads, 1);

  system.dispose();
  assert.equal(handlers.size, 0, 'dispose releases the subscription');
});

check('a lost context is handled even with adaptive quality switched off', () => {
  // Boot with `?q=high` disables this system's scaling entirely. A lost context
  // is not a preference, so the recovery must still be wired.
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const handlers = new Map();
  const system = new AdaptiveQualitySystem({
    settings: { mode: 'auto' },
    enabled: false,
    storage,
    location: { reload: () => {} },
  });
  system.init({
    perf: { count: 0 },
    config: { quality: 'high', q: { renderScale: 1 } },
    events: { on: (t, fn) => (handlers.set(t, fn), () => handlers.delete(t)) },
  });
  assert.ok(handlers.has('render:contextlost'));
});

console.log(`\n${checks} adaptive-quality checks passed`);
