#!/usr/bin/env node
/**
 * The stall the gameplay profiler cannot see.
 *
 * tools/profile.mjs attaches after `__READY__` and throws away its first 60
 * frames, so the most expensive frame the player actually experiences — the
 * first `update()`, where navigation is sampled out of the physics BVH and the
 * garrison's soldier geometries are built — is never in its sample. This hooks
 * requestAnimationFrame from before the page's own scripts run and reports the
 * frame-time distribution of the first N frames of the engine loop.
 *
 *   node src/ai/bootframes.mjs --port=5401
 */
import { chromium } from 'playwright';
import { launchOpts } from '../../tools/lib/chromium.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PORT = Number(args.port ?? 5333);
const WAIT = Number(args.wait ?? 4000);
const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
}));
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  window.__FRAMES__ = [];
  const raf = window.requestAnimationFrame.bind(window);
  let last = performance.now();
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const a = performance.now();
      cb(t);
      const b = performance.now();
      window.__FRAMES__.push([+(a - last).toFixed(2), +(b - a).toFixed(2)]);
      last = b;
    });
});
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
await page.evaluate((w) => new Promise((r) => setTimeout(r, w)), WAIT);
const frames = await page.evaluate(() => window.__FRAMES__);
// the engine loop is whatever runs after boot; report the callback cost, which
// excludes the browser's own idle time between frames
const cb = frames.map((f) => f[1]);
const sorted = [...cb].sort((a, b) => a - b);
const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1);
console.log(JSON.stringify({
  frames: cb.length,
  worstCallbackMs: +Math.max(...cb).toFixed(1),
  over100ms: cb.filter((x) => x > 100).length,
  over30ms: cb.filter((x) => x > 30).length,
  p50: q(0.5), p90: q(0.9), p99: q(0.99),
  first12: cb.slice(0, 12),
  worstIndex: cb.indexOf(Math.max(...cb)),
}));
await browser.close();
