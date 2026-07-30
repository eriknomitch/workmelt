#!/usr/bin/env node
/**
 * Rigorous, reproducible shot capture — the regression gate for optimisation work.
 *
 * Differs from shotset.mjs (which is the fast review set for critics) in three ways
 * that matter for byte-comparability:
 *
 *  1. ISOLATION — each shot gets a brand new page. shotset reuses one page for all
 *     11 shots, so particle ages, decal buffers, animation phase and auto-exposure
 *     state leak forward. That leakage is why two shotset runs differ on every shot
 *     except the first one.
 *  2. FIXED FRAME BUDGET — the shot is applied at a known frame index and exactly
 *     `settle` frames are pumped, so temporal accumulators (TAA jitter phase,
 *     exposure adaptation) always converge from the same starting phase.
 *  3. TEMPORAL RESET — asks the renderer to drop its TAA history and snap exposure
 *     before pumping, if it exposes a hook to do so.
 *
 *   node tools/baseline.mjs --out=shots/base --port=8080
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';
import { resolveChromium } from './lib/chromium.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const PORT = Number(args.port ?? process.env.OW_PORT ?? 5273);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const SETTLE = Number(args.settle ?? 90);
const OUTDIR = resolve(args.out ?? 'shots/base');
const ROOT = resolve(import.meta.dirname, '..');
// Extra query string appended to every shot URL, e.g. --query=prewarm=0
const EXTRA = args.query ? `&${args.query}` : '';

const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(400, () => (s.destroy(), res(false)));
});

let server = null;
if (!(await portOpen(PORT))) {
  // OW_NO_HMR: this is the regression GATE, and it runs for minutes. A file
  // saved by a concurrently-working agent would otherwise hot-reload the page
  // mid-capture — either failing with "Execution context was destroyed" or,
  // worse, silently finishing the run against two different builds. drawcalls
  // .mjs already did this; the gate needs it more than any other harness.
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OW_NO_HMR: '1' } });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await portOpen(PORT); }
  if (!up) { server.kill(); throw new Error('vite failed to start'); }
}

const launch = {
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--force-color-profile=srgb',
         '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--disable-frame-rate-limit'],
};
// Same escape hatch tools/drawcalls.mjs has: point at a browser playwright did
// not install itself (cloud sandboxes ship one that its version does not match).
// Both sides of a comparison must use the SAME binary for the diff to mean
// anything — this only exists so a run is possible at all, never to mix them.
// `resolveChromium` is the same auto-detect fallback; `--chrome` still wins.
launch.executablePath = String(args.chrome ?? resolveChromium() ?? '') || undefined;
const browser = await chromium.launch(launch);

mkdirSync(OUTDIR, { recursive: true });
const report = { ok: true, outDir: OUTDIR, size: `${W}x${H}`, isolated: true, settle: SETTLE, shots: [], errors: [] };

// Discover the shot list from a throwaway page.
const probe = await browser.newPage({ viewport: { width: W, height: H } });
await probe.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await probe.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
const all = await probe.evaluate('Object.keys(window.__SHOTS__ ?? {})');
await probe.close();

const wanted = args.shots ? String(args.shots).split(',').map((s) => s.trim()) : all;

for (const name of wanted) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => m.type() !== 'debug' && logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&shot=${encodeURIComponent(name)}${EXTRA}`,
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });

    const applied = await page.evaluate(
      ({ s, settle }) => window.__APPLY_SHOT__(s, { grabFrame: settle }), { s: name, settle: SETTLE });

    // Drop temporal history so accumulation starts from a known phase.
    await page.evaluate(() => {
      const r = window.__ENGINE__?.ctx?.peek?.('render');
      r?.resetTemporal?.() ?? r?.resetHistory?.() ?? r?.invalidateHistory?.();
    });

    // LOCKSTEP: advance exactly SETTLE engine frames. The page runs no frame loop
    // of its own, so nothing advances during any of the round trips above or
    // during the screenshot below — engine.time.frame at the shutter is a
    // constant (BOOT_FRAMES + SETTLE) on every run and on every machine.
    await page.evaluate((n) => window.__PUMP__(n), SETTLE);
    // Yield two rAFs with the simulation frozen so the compositor has certainly
    // picked up the final rendered frame before the shutter.
    await page.evaluate(() => window.__PRESENT__(2));

    await page.screenshot({ path: `${OUTDIR}/${name}.png`, type: 'png' });
    const info = await page.evaluate('window.__RENDER_INFO__ ?? null');
    report.shots.push({ shot: name, ok: !applied?.error, info, logs: logs.filter((l) => /pageerror|\[error\]/.test(l)) });
  } catch (e) {
    report.ok = false;
    report.shots.push({ shot: name, ok: false, error: e.message });
  } finally {
    await page.close();
  }
}

report.errors = report.shots.flatMap((s) => s.logs ?? []);
await browser.close();
if (server) server.kill();

writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
