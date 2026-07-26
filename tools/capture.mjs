#!/usr/bin/env node
/**
 * Deterministic screenshot harness for the game.
 *
 * Boots vite (if not already up), opens the page in GPU-backed Chromium,
 * waits for `window.__READY__`, optionally runs a named "shot" defined in
 * src/dev/shots.js, then writes a PNG.
 *
 * Usage:
 *   node tools/capture.mjs --shot=hero --out=shots/hero.png
 *   node tools/capture.mjs --shot=hero --out=shots/hero.png --w=2560 --h=1440
 *   node tools/capture.mjs --list
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const SHOT = args.shot ?? 'default';
const OUT = resolve(args.out ?? `shots/${SHOT}.png`);
const TIMEOUT = Number(args.timeout ?? 90000);
// Frames to render before capture: lets TAA converge, streaming settle, LOD pick.
const SETTLE = Number(args.settle ?? 90);
const EXTRA_QUERY = args.query ? `&${args.query}` : '';

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

async function ensureServer() {
  if (await portOpen(PORT)) return null;
  const root = resolve(import.meta.dirname, '..');
  const p = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    detached: false,
    // No hot reload: a file saved mid-run would reload the page under playwright.
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) return p;
  }
  p.kill();
  throw new Error('vite failed to start');
}

const server = await ensureServer();

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=metal',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--disable-frame-rate-limit',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});

const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

let failed = null;
try {
  await page.goto(
    `http://127.0.0.1:${PORT}/?capture=1&shot=${encodeURIComponent(SHOT)}${EXTRA_QUERY}`,
    {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    }
  );

  // Engine sets window.__READY__ = true once assets are loaded and first frame drawn.
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });

  if (args.list) {
    const shots = await page.evaluate('Object.keys(window.__SHOTS__ ?? {})');
    console.log(JSON.stringify(shots, null, 2));
  } else {
    // Apply the shot (camera pose, time of day, weapon state, ...).
    const applied = await page.evaluate(
      ({ s, settle }) =>
        window.__APPLY_SHOT__ ? window.__APPLY_SHOT__(s, { grabFrame: settle }) : 'no-shot-api',
      { s: SHOT, settle: SETTLE }
    );
    logs.push(`[shot] ${JSON.stringify(applied)}`);

    // Pump deterministic frames so temporal effects converge.
    await page.evaluate(
      (n) =>
        new Promise((done) => {
          let i = 0;
          const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      SETTLE
    );

    mkdirSync(dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT, type: 'png' });

    const info = await page.evaluate('window.__RENDER_INFO__ ?? null');
    console.log(JSON.stringify({ ok: true, out: OUT, shot: SHOT, w: W, h: H, info }, null, 2));
  }
} catch (e) {
  failed = e;
} finally {
  const gpu = await page
    .evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return 'NO WEBGL2';
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })
    .catch(() => 'n/a');
  if (failed || args.verbose) {
    console.error('GPU:', gpu);
    console.error(logs.slice(-60).join('\n'));
  }
  await browser.close();
  if (server) server.kill();
}

if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
