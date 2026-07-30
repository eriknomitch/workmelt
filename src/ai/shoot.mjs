#!/usr/bin/env node
/**
 * DEV ONLY — screenshot the standalone character rig (src/ai/preview.html).
 * Mirrors tools/capture.mjs so the soldier model and its animation can be
 * iterated on while the rest of the game is mid-edit.
 *
 *   node src/ai/shoot.mjs --view=front --variant=vanguard --out=/tmp/ai-front.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? 5211);
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 1600);
const OUT = resolve(args.out ?? `/tmp/ai-${args.view ?? 'front'}.png`);
const SETTLE = Number(args.settle ?? 12);

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

const root = resolve(import.meta.dirname, '../..');
let server = null;
if (!(await portOpen(PORT))) {
  server = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    up = await portOpen(PORT);
  }
  if (!up) {
    server.kill();
    throw new Error('vite failed to start');
  }
}

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
  ],
}));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

const qs = new URLSearchParams();
for (const k of ['view', 'variant', 'clip', 'phase', 'aim']) if (args[k]) qs.set(k, args[k]);

let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/src/ai/preview.html?${qs}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
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
  console.log(JSON.stringify({ ok: true, out: OUT, view: args.view ?? 'front' }));
} catch (e) {
  failed = e;
}
if (failed || args.verbose) console.error(logs.slice(-40).join('\n'));
await browser.close();
if (server) server.kill();
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
