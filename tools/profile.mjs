#!/usr/bin/env node
/**
 * Gameplay profiler — reproduces the conditions a real player hits, which the
 * static-camera capture harness completely misses:
 *
 *  - real device pixel ratio (Retina => 1.5x internal scale, ~3.3 MP not 2.07 MP)
 *  - a moving camera (forces new shadow cascades, new frusta, streaming)
 *  - firing (particles, decals, tracers, muzzle light, audio)
 *  - AI active (skinned meshes, ragdolls, pathfinding)
 *
 * Reports the frame-time DISTRIBUTION and every hitch, because a median frame
 * time hides exactly the stalls that make a game feel broken. Also tracks WebGL
 * program count per frame — a jump in programs on the same frame as a hitch is
 * a shader compilation stall, the classic cause of Three.js hitching.
 *
 *   node tools/profile.mjs --port=8080 --dpr=2 --w=1512 --h=982
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const PORT = Number(args.port ?? 8080);
const W = Number(args.w ?? 1512);
const H = Number(args.h ?? 982);
const DPR = Number(args.dpr ?? 2);
const FRAMES = Number(args.frames ?? 900);
const TARGET_FPS = Number(args.target ?? 0);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
         '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const t0 = Date.now();
const EXTRA = args.query ? `?${args.query}` : '';
await page.goto(`http://127.0.0.1:${PORT}/${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
const bootMs = Date.now() - t0;

// Boot-phase breakdown: how much of that boot was spent where.
const bootMarks = await page.evaluate(() =>
  performance.getEntriesByType('measure').map((m) => ({ name: m.name, ms: +m.duration.toFixed(1) }))
    .sort((a, b) => b.ms - a.ms).slice(0, 25));

const internal = await page.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render');
  const gl = r.renderer.getContext();
  return {
    pixelRatio: r.renderer.getPixelRatio(),
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    megapixels: +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(2),
    quality: window.__ENGINE__.config.quality,
    renderScale: window.__ENGINE__.config.q.renderScale,
  };
});

// Enable player control and run a scripted gameplay sequence while sampling.
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.enabled = true; e.input.frozen = false;
  e.ctx.peek('player')?.setControlEnabled?.(true);
  e.ctx.peek('ai')?.debugStage?.('firefight');
});

const result = await page.evaluate((FRAMES) => new Promise((done) => {
  const e = window.__ENGINE__;
  const r = e.ctx.peek('render');
  const samples = [];
  let last = performance.now(), i = 0;

  const tick = () => {
    const now = performance.now();
    const dt = now - last; last = now;

    // Drive gameplay: orbit the view, walk, and fire in bursts.
    const t = i / 60;
    e.camera.rotation.y += 0.006;
    const mv = e.ctx.peek('player');
    if (mv) { try { e.input.down.add('KeyW'); } catch {} }
    if (i % 90 < 30) { e.input.down.add('Mouse0'); } else { e.input.down.delete('Mouse0'); }

    samples.push({
      i, dt,
      progs: r.renderer.info.programs?.length ?? 0,
      calls: r.renderer.info.render.calls,
      tris: r.renderer.info.render.triangles,
      geos: r.renderer.info.memory.geometries,
      texs: r.renderer.info.memory.textures,
      heap: performance.memory ? performance.memory.usedJSHeapSize >> 20 : 0,
    });

    if (++i >= FRAMES) return done(samples);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), FRAMES);

// Discard the first 60 frames: control handover and the first shadow-cascade fit
// are one-time costs, not steady state.
//
// `--warmup=0` keeps them, which is how you see the COLD first-load experience:
// a lazily-compiled program lands in exactly those discarded frames, so the
// default view is blind to the stall the pre-warm exists to remove.
const WARMUP = Number(args.warmup ?? 60);
const warm = result.slice(WARMUP);
const dts = warm.map((s) => s.dt).sort((a, b) => a - b);
const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(2);
const med = q(0.5);

const hitches = warm
  .filter((s) => s.dt > Math.max(2 * med, med + 8))
  .map((s, n, arr) => {
    const prev = warm[warm.indexOf(s) - 1];
    return {
      frame: s.i, ms: +s.dt.toFixed(1),
      progDelta: prev ? s.progs - prev.progs : 0,
      geoDelta: prev ? s.geos - prev.geos : 0,
      texDelta: prev ? s.texs - prev.texs : 0,
    };
  });

const first = warm[0], lastS = warm[warm.length - 1];
const enginePerf = await page.evaluate(() => window.__PERF__?.stats?.(240) ?? null);
const report = {
  bootMs,
  bootMarks,
  internal,
  frames: warm.length,
  frameTimeMs: { p1: q(0.01), p50: med, p90: q(0.9), p95: q(0.95), p99: q(0.99), max: q(1) },
  fps: { p50: +(1000 / med).toFixed(0), p95: +(1000 / q(0.95)).toFixed(0), p99: +(1000 / q(0.99)).toFixed(0) },
  hitchCount: hitches.length,
  hitchPctOfFrames: +((hitches.length / warm.length) * 100).toFixed(2),
  worstHitches: hitches.sort((a, b) => b.ms - a.ms).slice(0, 15),
  programs: { start: first.progs, end: lastS.progs, compiledDuringPlay: lastS.progs - first.progs },
  resources: { geosStart: first.geos, geosEnd: lastS.geos, texStart: first.texs, texEnd: lastS.texs },
  heapMb: { start: first.heap, end: lastS.heap, growth: lastS.heap - first.heap },
  drawCalls: { min: Math.min(...warm.map(s=>s.calls)), max: Math.max(...warm.map(s=>s.calls)) },
  enginePerf,
  errors: errs.slice(0, 6),
};
console.log(JSON.stringify(report, null, 2));

await browser.close();
if (TARGET_FPS > 0 && report.fps.p95 < TARGET_FPS) {
  console.error(`FAIL: p95 ${report.fps.p95} FPS is below ${TARGET_FPS} FPS`);
  process.exitCode = 1;
}
