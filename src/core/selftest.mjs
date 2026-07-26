#!/usr/bin/env node

import assert from 'node:assert/strict';
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

check('selects a pipeline tier from p95 performance against the target', () => {
  assert.equal(chooseCalibrationTier(120, 120), 'ultra');
  assert.equal(chooseCalibrationTier(90, 120), 'high');
  assert.equal(chooseCalibrationTier(60, 120), 'medium');
  assert.equal(chooseCalibrationTier(30, 120), 'low');
});

check('loads versioned per-browser settings and rejects corrupt values', () => {
  const storage = {
    getItem: () =>
      JSON.stringify({ version: 1, mode: 'auto', targetFps: 144, tier: 'high', renderScale: 0.8 }),
  };
  assert.deepEqual(loadGraphicsSettings(storage), {
    version: 1,
    mode: 'auto',
    targetFps: 144,
    tier: 'high',
    renderScale: 0.8,
    refreshHz: null,
    signature: null,
    calibrated: true,
  });
  assert.equal(loadGraphicsSettings({ getItem: () => '{bad' }).mode, 'auto');
});

check('invalidates calibration when the device or measured refresh changes', () => {
  const settings = {
    version: 1,
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

  assert.equal(loadGraphicsSettings(storage).tier, 'medium');
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

console.log(`\n${checks} adaptive-quality checks passed`);
