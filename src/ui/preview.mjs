#!/usr/bin/env node
/**
 * UI-only dev harness (owned by the `ui` agent, mirrors tools/capture.mjs).
 *
 *   node src/ui/preview.mjs --port=5212 --state=menu --out=/tmp/ui-menu.png
 *   node src/ui/preview.mjs --port=5212 --fonts
 *
 * `--state` is handed to `ui.debugState()`, so this can screenshot HUD states
 * the shared shot list does not cover (the pause menu, a clean HUD, ...).
 * `--fonts` reports which condensed families the browser can actually resolve —
 * the HUD's whole typographic character depends on that answer.
 *
 * Two modes ride `?renderGame=false` (src/dev/uionly.js) instead of a full
 * boot, because nothing they look at needs an engine — which on a software
 * rasteriser is the difference between seconds and minutes:
 *
 *   --fonts          only needs brand.js installed in a page.
 *   --state=lobby    screenshots the lobby surface; `--style=<variant>` picks
 *                    one of its style explorations first. NOTE: the real lobby
 *                    sits its scrim over the live scene, UI-only sits it over
 *                    the flat page background — visually near-identical, but
 *                    not bit-identical, so this is an iteration tool, not a
 *                    baseline source.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? 5212);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const STATE = args.state ?? 'combat';
const OUT = resolve(args.out ?? `/tmp/ui-${STATE}.png`);
const SETTLE = Number(args.settle ?? 90);

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
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) break;
  }
}

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio'],
}));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

// The fonts probe and the lobby state judge only the DOM, so they skip the
// engine entirely; every HUD state still needs the real boot behind it.
const uiOnly = args.fonts || STATE === 'lobby';

try {
  const query = uiOnly ? '?renderGame=false' : '?capture=1&shot=hud';
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });

  if (args.fonts) {
    const report = await page.evaluate(() => {
      const probe = (family) => {
        const c = document.createElement('canvas').getContext('2d');
        c.font = `700 64px ${family}, monospace`;
        const a = c.measureText('HANDGUN 1830').width;
        c.font = '700 64px monospace';
        const b = c.measureText('HANDGUN 1830').width;
        return { family, width: Math.round(a), differs: Math.abs(a - b) > 1 };
      };
      return [
        'DIN Alternate',
        'DIN Condensed',
        'Avenir Next Condensed',
        'Roboto Condensed',
        'Helvetica Neue',
        'Oswald',
        'Bahnschrift Condensed',
        'Inter',
        'system-ui',
        'PT Sans Narrow',
        'Arial Narrow',
        'Impact',
        'Haettenschweiler',
      ].map(probe);
    });
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (STATE === 'lobby') {
      if (args.style) await page.evaluate((s) => window.__UIONLY__?.setStyle(s), String(args.style));
    } else {
      await page.evaluate((s) => window.__ENGINE__?.ctx.peek('ui')?.debugState(s), STATE);
    }
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
    console.log(JSON.stringify({ ok: true, out: OUT, state: STATE }));
  }
} catch (e) {
  console.error('FAILED', e.message);
  console.error(logs.slice(-30).join('\n'));
  process.exitCode = 1;
} finally {
  if (args.verbose) console.error(logs.slice(-40).join('\n'));
  await browser.close();
  server?.kill();
}
