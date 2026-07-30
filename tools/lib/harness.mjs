/**
 * Shared browser harness for the goal measurement tools.
 *
 * The one thing every measurement tool here needs and `tools/capture.mjs` does
 * not provide: it must run on a machine with NO GPU. Chromium's SwiftShader
 * backend renders the game correctly — same shaders, same pixels, just slowly
 * (~4 s/frame at 960x540 on a 4-core container) — so everything that is a
 * function of the IMAGE is measurable here. Nothing that is a function of
 * wall-clock frame time is; see tools/cost.mjs for what replaces it.
 *
 * Every boot goes through `?capture=1&lockstep=1`, so the engine only advances
 * inside `__PUMP__(n)` and the frame index at the shutter is a constant. That is
 * what makes a metric comparable between two runs on two different machines.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';
import { resolveChromium } from './chromium.mjs';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export { resolveChromium };

/** `--foo=bar --baz` -> `{ foo: 'bar', baz: true }`. */
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    })
  );
}

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

const COMMON_ARGS = [
  '--ignore-gpu-blocklist',
  '--mute-audio',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
];

/**
 * `gpu`:
 *   'swiftshader' — force the software rasteriser. Deterministic, GPU-free, slow.
 *   'hw'          — real GPU (ANGLE picks the platform backend).
 *   'auto'        — hardware if this machine plausibly has it, else software.
 */
export function browserArgs(gpu = 'auto') {
  if (gpu === 'swiftshader')
    return [...COMMON_ARGS, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const backend = process.platform === 'darwin' ? 'metal' : 'default';
  return [...COMMON_ARGS, `--use-angle=${backend}`, '--enable-gpu-rasterization', '--enable-zero-copy'];
}

export function resolveGpuMode(requested = 'auto') {
  if (requested === 'hw' || requested === 'swiftshader') return requested;
  // A headless Linux container is the case this whole harness exists for.
  if (process.platform === 'linux' && !process.env.DISPLAY) return 'swiftshader';
  return 'hw';
}

/**
 * Boot vite on `port` unless something is already listening there — which is
 * exactly what happens when another harness (or `npm run dev`) already booted
 * one on the same port: a shared OW_PORT lets an entire suite of these tools
 * reuse the same boot instead of each re-paying vite/shader-compile startup.
 *
 * `OW_USE_BUILD=1` serves the production bundle (`vite preview`, after `npm
 * run build`) instead of raw dev mode: fewer, bundled module requests instead
 * of one round trip per source file. Opt-in and scoped to this harness only —
 * `vite preview` serves just the entries built in vite.config.js (`main`,
 * `debugAudio`), not the dev-only subsystem preview pages under src/**.
 */
export async function ensureServer(port) {
  if (await portOpen(port)) return null;
  const useBuild = process.env.OW_USE_BUILD === '1';
  const bin = resolve(ROOT, 'node_modules/.bin/vite');
  if (!existsSync(bin)) throw new Error('vite is not installed — run `npm install` first');
  if (useBuild && !existsSync(resolve(ROOT, 'dist'))) {
    throw new Error('OW_USE_BUILD=1 needs a build first — run `npm run build`');
  }
  const p = spawn(bin, [useBuild ? 'preview' : undefined, '--port', String(port), '--strictPort'].filter(Boolean), {
    cwd: ROOT,
    stdio: 'ignore',
    // A file saved mid-run would otherwise reload the page under playwright.
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(port)) return p;
  }
  p.kill();
  throw new Error(`vite failed to start on ${port}`);
}

/**
 * Open the game at one quality tier and hand back a small control surface.
 *
 * Timeouts are deliberately enormous: under SwiftShader a single `ultra` frame
 * can take tens of seconds, and a run that dies at 30 s tells you nothing.
 */
export async function openGame({
  port,
  width = 960,
  height = 540,
  quality = 'ultra',
  gpu = 'auto',
  query = '',
  bootTimeoutMs = 900000,
  onConsole = null,
} = {}) {
  const mode = resolveGpuMode(gpu);
  const executablePath = resolveChromium();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: browserArgs(mode),
  });
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(bootTimeoutMs);
  page.setDefaultNavigationTimeout(bootTimeoutMs);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
  if (onConsole) page.on('console', (m) => onConsole(m.text()));

  const url =
    `http://127.0.0.1:${port}/?capture=1&lockstep=1&q=${quality}` +
    `&match=0&mp=0${query ? `&${query}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: bootTimeoutMs });

  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('game')?.getContext('webgl2');
    if (!gl) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });

  return {
    page,
    browser,
    renderer,
    gpuMode: mode,
    software: /swiftshader|llvmpipe|software/i.test(renderer),
    errors,
    /** Advance exactly n engine frames. Nothing else moves the clock. */
    pump: (n) => page.evaluate((k) => window.__PUMP__(k), n),
    applyShot: (name, opts = {}) =>
      page.evaluate(([n, o]) => window.__APPLY_SHOT__(n, o), [name, opts]),
    /** The 3D canvas only — the HUD is DOM and would otherwise skew scene metrics. */
    canvasPng: () => page.locator('canvas#game').screenshot({ type: 'png' }),
    /** Canvas + DOM HUD, i.e. what the player actually looks at. */
    framePng: () => page.screenshot({ type: 'png' }),
    renderInfo: () => page.evaluate(() => window.__RENDER_INFO__),
    close: () => browser.close(),
  };
}

/** Fixed-width table printer so reports diff cleanly between runs. */
export function table(rows, columns) {
  if (!rows.length) return '';
  const head = columns.map((c) => c.label ?? c.key);
  const body = rows.map((r) => columns.map((c) => String(c.get ? c.get(r) : r[c.key] ?? '')));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
  return [line(head), line(w.map((n) => '-'.repeat(n))), ...body.map(line)].join('\n');
}
