#!/usr/bin/env node
/**
 * Screenshot the standalone weapons preview (dev tool, not shipped).
 *
 *   node src/weapons/shoot.mjs --w=rifle --view=hero --out=/tmp/wp-hero.png --port=5210
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

const PORT = Number(args.port ?? 5210);
const W = Number(args.width ?? 1600);
const H = Number(args.height ?? 900);
const WEAPON = args.w ?? 'rifle';
const VIEW = args.view ?? 'hero';
const OUT = resolve(args.out ?? `/tmp/wp-${args.w ?? 'rifle'}-${VIEW}${args.arms === '0' ? '-noarms' : ''}.png`);
// Animation frames the page runs before it freezes and flags __READY__. Fixed so
// the grab is bit-reproducible: it used to be "however many rAF ticks fitted
// between boot and the screenshot RPC", which made the pose depend on machine
// load. 16 matches the old nominal count (4 to ready + 12 pumped).
const FRAMES = Math.max(1, Math.round(Number(args.frames ?? 16)));
const ROOT = resolve(import.meta.dirname, '../..');

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

let server = null;
if (!(await portOpen(PORT))) {
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
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
    '--disable-frame-rate-limit',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
  ],
}));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

let failed = null;
try {
  const extra =
    `&w=${encodeURIComponent(WEAPON)}` +
    `&grab=${FRAMES}` +
    (args.t ? `&t=${encodeURIComponent(args.t)}` : '') +
    (args.arms ? `&arms=${args.arms}` : '');
  await page.goto(`http://127.0.0.1:${PORT}/src/weapons/preview.html?view=${VIEW}${extra}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
  await page.evaluate(
    () =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= 12 ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      })
  );
  mkdirSync(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  const info = await page.evaluate('window.__INFO__ ?? null');
  console.log(JSON.stringify({ ok: true, out: OUT, view: VIEW, info }, null, 2));
} catch (e) {
  failed = e;
}
const errs = logs.filter((l) => /error|Error|THREE\./.test(l));
console.error((errs.length ? errs : logs).slice(0, 40).join('\n'));
await browser.close();
if (server) server.kill();
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
