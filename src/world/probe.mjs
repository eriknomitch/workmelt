#!/usr/bin/env node
/**
 * WORLD dev probe. Boots the page like the capture harness does, applies a
 * shot, then evaluates an arbitrary expression in the page so level layout can
 * be interrogated (sun azimuth, prop positions, draw calls) without adding
 * console spam to the shipping code.
 *
 *   node src/world/probe.mjs --shot=hero --port=5206 --eval="w.stats"
 *   node src/world/probe.mjs --query="map=rust" --eval="w.spawnPoints.length"
 *
 * `w` is the world subsystem, `e` the engine, `THREE` is not available.
 * Only ever run this on port 5206 — every other agent owns a different port.
 *
 * `--eval` is evaluated synchronously, so it cannot await. To probe something
 * asynchronous — a map change, say — kick it off in `--pre`, stash the result
 * on `window`, and read that back in `--eval`; the settle frames in between are
 * what give it time to land.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    // `[\s\S]` rather than `.`, because `.` stops at the first newline and a
    // `--eval` spanning lines is the normal case here. When it failed to match,
    // the whole expression silently became a KEY with the value `true`, `EXPR`
    // fell back to its default, and the probe printed a well-formed answer to a
    // question nobody asked. An unparsed argument is now loud.
    const m = a.match(/^--([^=\s]+)(?:=([\s\S]*))?$/);
    if (!m) {
      console.error(`[probe] ignoring unrecognised argument: ${a.slice(0, 60)}`);
      return ['_unparsed', true];
    }
    return [m[1], m[2] ?? true];
  })
);
const PORT = Number(args.port ?? 5206);
const SHOT = args.shot ?? 'hero';
const EXPR = args.eval ?? 'w.stats';
/**
 * Extra query string, e.g. `--query="map=rust&prewarm=0"`. The map is resolved
 * from the URL, so this is how you probe a level other than the default.
 */
const QUERY = args.query ? `&${args.query}` : '';
/**
 * Boot can take a while: shader pre-warm alone is 30-40 s on a software-GL
 * sandbox, and the old hard-coded 90 s left nothing for the page to actually
 * reach its third frame. Raise it rather than guessing whether the run hung.
 */
const TIMEOUT = Number(args.timeout ?? 300000);

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

let server = null;
if (!(await portOpen(PORT))) {
  const root = resolve(import.meta.dirname, '../..');
  server = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) break;
  }
}

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
}));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&shot=${SHOT}${QUERY}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
  await page.evaluate((s) => window.__APPLY_SHOT__?.(s), SHOT);
  // --pre="js" runs before the settle and the screenshot: use it to hide a batch
  // and find out which merged mesh a mystery silhouette belongs to.
  if (args.pre) {
    await page.evaluate((expr) => {
      const e = window.__ENGINE__;
      const w = e.ctx.peek('world');
      const r = e.ctx.peek('render');
      // eslint-disable-next-line no-eval
      eval(expr);
    }, args.pre);
  }
  if (args.time) {
    await page.evaluate((h) => window.__ENGINE__.ctx.peek('sky')?.setTimeOfDay(h), Number(args.time));
  }
  // Free camera: --pos=x,y,z --look=x,y,z [--fov=60] [--out=file.png]
  if (args.pos) {
    await page.evaluate(
      ({ pos, look, fov }) => {
        const e = window.__ENGINE__;
        const c = e.camera;
        c.position.set(...pos);
        c.lookAt(...look);
        if (fov) {
          c.fov = fov;
          c.updateProjectionMatrix();
        }
        e.ctx.peek('player')?.teleport?.(c.position, c.rotation);
      },
      {
        pos: args.pos.split(',').map(Number),
        look: (args.look ?? '0,0,0').split(',').map(Number),
        fov: args.fov ? Number(args.fov) : 0,
      }
    );
    await page.evaluate(
      (n) =>
        new Promise((d) => {
          let i = 0;
          const tick = () => (++i >= n ? d() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      Number(args.settle ?? 90)
    );
  }
  // Auto-exposure needs real frames to adapt, or every probe shot is 3 stops dark.
  if (!args.pos) {
    await page.evaluate(
      (n) =>
        new Promise((d) => {
          let i = 0;
          const tick = () => (++i >= n ? d() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      Number(args.settle ?? 90)
    );
  }
  if (args.out) await page.screenshot({ path: resolve(args.out), type: 'png' });

  const out = await page.evaluate((expr) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const sky = e.ctx.peek('sky');
    const r = e.ctx.peek('render');
    const phys = e.ctx.peek('physics');
    // eslint-disable-next-line no-eval
    const v = eval(expr);
    return JSON.stringify(v, (k, val) =>
      typeof val === 'number' ? Math.round(val * 1e4) / 1e4 : val
    );
  }, EXPR);
  console.log(out);
} catch (err) {
  console.error('probe failed:', err.message);
  console.error(logs.slice(-25).join('\n'));
} finally {
  if (args.logs) console.error(logs.slice(-40).join('\n'));
  await browser.close();
  if (server) server.kill();
}
