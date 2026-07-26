#!/usr/bin/env node
/**
 * Screenshot a browser that is ALREADY RUNNING, over the Chrome DevTools Protocol.
 *
 * The difference from every other tool in here: `capture.mjs`, `shotset.mjs` and
 * `baseline.mjs` all launch their own headless Chromium and boot the game from
 * scratch. This one attaches to the browser you are playing in, so it can capture
 * your session — your camera, your weapon state, the bug you just hit — and,
 * unlike the in-page F2 path (src/dev/screenshot.js), it screenshots the
 * *composited page*, so the DOM HUD (crosshair, ammo, minimap, perf readout) is
 * in the image.
 *
 * Start the browser with remote debugging once:
 *
 *   # macOS
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --user-data-dir=/tmp/cod-profile
 *   # Linux
 *   chromium --remote-debugging-port=9222 --user-data-dir=/tmp/cod-profile
 *
 * then open http://127.0.0.1:5173 in it and:
 *
 *   node tools/attach-shot.mjs                          # one shot of the game tab
 *   node tools/attach-shot.mjs --name=weapon-lighting   # name it
 *   node tools/attach-shot.mjs --count=10 --every=500   # a 5 s sequence
 *   node tools/attach-shot.mjs --selector=#game         # clip to the canvas only
 *   node tools/attach-shot.mjs --list                   # what tabs are attachable
 *
 * Each PNG is written to artifacts/shots/ with a JSON sidecar holding the page
 * URL, viewport, and a live `__PERF__.stats()` reading, so the frame cost that
 * produced the image is recorded with it.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const ENDPOINT = String(args.endpoint ?? 'http://127.0.0.1:9222');
const MATCH = String(args.match ?? '5173');
const OUT = resolve(String(args.out ?? 'artifacts/shots'));
const COUNT = Math.max(1, Number(args.count ?? 1));
const EVERY = Math.max(0, Number(args.every ?? 500));
const NAME = String(args.name ?? 'attach');
const root = resolve(import.meta.dirname, '..');

let browser;
try {
  browser = await chromium.connectOverCDP(ENDPOINT);
} catch (err) {
  console.error(`Could not attach to ${ENDPOINT}: ${err.message}\n`);
  console.error('Start the browser with remote debugging enabled first:\n');
  console.error('  chromium --remote-debugging-port=9222 --user-data-dir=/tmp/cod-profile');
  console.error('  # macOS: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\');
  console.error('  #          --remote-debugging-port=9222 --user-data-dir=/tmp/cod-profile\n');
  console.error('then open the game in it and re-run this command.');
  process.exit(1);
}

// A CDP connection exposes the real browser's contexts; every tab is a page.
const pages = browser.contexts().flatMap((c) => c.pages());

// Never call browser.close() on a CDP attachment — this is the user's browser and
// they are still playing in it. Dropping the connection by exiting is the only
// safe teardown.
const detach = (code) => process.exit(code);

if (args.list) {
  const rows = await Promise.all(pages.map(async (p) => ({ url: p.url(), title: await p.title().catch(() => '') })));
  console.log(JSON.stringify(rows, null, 2));
  detach(0);
}

const page = pages.find((p) => p.url().includes(MATCH));
if (!page) {
  console.error(
    `No open tab matched "${MATCH}". Attachable tabs:\n` +
      pages.map((p) => `  ${p.url()}`).join('\n') +
      '\n\nPass --match=<substring> or --list.'
  );
  detach(1);
}

// Bring it to front: an occluded or backgrounded tab throttles rAF, so a
// sequence captured from a hidden tab is not the frame rate you think it is.
await page.bringToFront().catch(() => {});

mkdirSync(OUT, { recursive: true });

const written = [];
for (let i = 0; i < COUNT; i++) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const suffix = COUNT > 1 ? `-${String(i + 1).padStart(3, '0')}` : '';
  const base = `${stamp}_${safeName(NAME)}${suffix}`;
  const png = resolve(OUT, `${base}.png`);

  const target = args.selector ? page.locator(String(args.selector)) : page;
  await target.screenshot({ path: png, ...(args.full && !args.selector ? { fullPage: true } : {}) });

  // Pull the live instrumentation so the image and its cost are one record.
  const meta = await page
    .evaluate(() => ({
      url: location.href,
      title: document.title,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      frame: window.__ENGINE__?.time?.frame ?? null,
      quality: window.__ENGINE__?.config?.quality ?? null,
      perf: window.__PERF__ ? window.__PERF__.stats() : null,
    }))
    .catch(() => ({}));

  writeFileSync(
    resolve(OUT, `${base}.json`),
    JSON.stringify({ ...meta, file: `${base}.png`, source: 'attach-shot', selector: args.selector ?? null }, null, 2)
  );
  written.push(relativeTo(root, png));
  if (i < COUNT - 1 && EVERY) await new Promise((r) => setTimeout(r, EVERY));
}

console.log(JSON.stringify({ ok: true, count: written.length, out: relativeTo(root, OUT), files: written }, null, 2));
detach(0);

function safeName(s) {
  return (
    String(s)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'attach'
  );
}

function relativeTo(from, p) {
  return p.startsWith(from) ? p.slice(from.length + 1) : p;
}
