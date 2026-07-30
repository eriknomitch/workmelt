#!/usr/bin/env node
/**
 * AUDIO PROBE — headless verification for the audio subsystem.
 *
 * Screenshots say nothing about sound, so this is the audio equivalent of the
 * capture harness. It does two independent things:
 *
 *  1. OFFLINE RENDER — imports src/audio/selftest.js in the page and renders
 *     every voice through the real mixer in an OfflineAudioContext, then checks
 *     each one for silence, NaNs, DC offset and clipping. No gesture needed.
 *
 *  2. LIVE GRAPH — clicks the canvas to satisfy the autoplay policy, waits for
 *     the AudioContext to be running, fires `debugStorm()` (one of every event
 *     through the real event bus), pumps frames, and asserts that nothing threw
 *     and no console error appeared.
 *
 * Usage:
 *   node src/audio/probe.mjs --port=5213            # both checks
 *   node src/audio/probe.mjs --port=5213 --verbose  # per-case table
 *   node src/audio/probe.mjs --port=5213 --live=0   # offline only
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? 5213);
const TIMEOUT = Number(args.timeout ?? 120000);
const VERBOSE = !!args.verbose;
const DO_LIVE = args.live !== '0';

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

async function ensureServer() {
  if (await portOpen(PORT)) return null;
  const root = resolve(import.meta.dirname, '../..');
  const p = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root, stdio: 'ignore',
  });
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) return p;
  }
  p.kill();
  throw new Error('vite failed to start');
}

const server = await ensureServer();

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars',
  ],
}));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let exitCode = 0;
try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&shot=hero`, {
    waitUntil: 'domcontentloaded', timeout: TIMEOUT,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });

  /* ---------------- 1. offline synthesis self-test ---------------- */
  // The first dynamic import of selftest.js can make vite's dep optimizer
  // full-reload the page, which kills the execution context. Retry once.
  const runOffline = () => page.evaluate(async () => {
    const mod = await import('/src/audio/selftest.js');
    return mod.runAudioSelfTest();
  });
  let offline;
  try {
    offline = await runOffline();
  } catch (err) {
    if (!/Execution context was destroyed/.test(String(err?.message))) throw err;
    logs.push('[probe] page reloaded during import (vite dep optimize) — retrying');
    await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
    offline = await runOffline();
  }

  console.log(`\n=== OFFLINE SELF TEST — ${offline.cases} cases, ${offline.ok ? 'PASS' : 'FAIL'} ===`);
  if (VERBOSE) {
    const rows = offline.results ?? [];
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('case', 26)}${pad('peak', 9)}${pad('rms', 10)}${pad('dc', 10)}${pad('centroidHz', 12)}ms`);
    for (const r of rows) {
      if (r.error) { console.log(`${pad(r.name, 26)}ERROR ${r.error}`); continue; }
      console.log(`${pad(r.name, 26)}${pad(r.peak, 9)}${pad(r.rms, 10)}${pad(r.dc, 10)}${pad(r.centroid, 12)}${r.ms}`);
    }
    console.log('\nspace classifier:', JSON.stringify(offline.spaces, null, 1));
  }
  if (offline.failures.length) {
    exitCode = 1;
    console.log('\nFAILURES:');
    for (const f of offline.failures) console.log(' ', JSON.stringify(f));
  }

  /* ---------------- 2. live graph ---------------------------------- */
  if (DO_LIVE) {
    // A keypress satisfies the autoplay gesture without triggering the game's
    // pointer-lock request (which headless Chromium refuses, noisily).
    await page.keyboard.press('KeyP');
    await page.evaluate(() => window.__AUDIO__?.start?.());
    const live = await page.waitForFunction(
      () => (window.__AUDIO__?.running ? window.__AUDIO__.report() : false),
      null, { timeout: 20000 }
    ).then((h) => h.jsonValue()).catch(() => null);

    if (!live) {
      console.log('\n=== LIVE GRAPH — could not start (autoplay blocked?) ===');
      exitCode = 1;
    } else {
      console.log(`\n=== LIVE GRAPH — ${live.state} @ ${live.sampleRate} Hz ===`);
      // Pump a second of frames so beds/probes run, then storm the event bus.
      const pump = (n) => page.evaluate(
        (k) => new Promise((done) => {
          let i = 0;
          const tick = () => (++i >= k ? done() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }), n);
      await pump(60);
      const storm = await page.evaluate(() => window.__AUDIO__.debugStorm());
      await pump(120);
      const storm2 = await page.evaluate(() => window.__AUDIO__.debugStorm());
      await pump(180);
      const after = await page.evaluate(() => window.__AUDIO__.report());
      console.log('storm 1:', JSON.stringify(storm));
      console.log('storm 2:', JSON.stringify(storm2));
      console.log('report :', JSON.stringify(after, null, 1));
      if (after.errors > 0) exitCode = 1;

      /* --- 3. does the space probe actually read the level? --------- */
      // The gunshot tail is only environmental if this classification tracks
      // the geometry, so walk the camera through the named shots and print it.
      console.log('\n=== SPACE PROBE PER SHOT ===');
      for (const shot of ['hero', 'interior', 'detail', 'sunset']) {
        await page.evaluate((s) => window.__APPLY_SHOT__(s), shot);
        await pump(45);
        const r = await page.evaluate(() => window.__AUDIO__.report());
        const w = r.spaceWeights ?? {};
        const fmt = (v) => (v ?? 0).toFixed(2);
        console.log(
          `${shot.padEnd(10)} -> ${r.space.padEnd(7)}` +
          ` tight ${fmt(w.tight)} room ${fmt(w.room)} street ${fmt(w.street)}` +
          ` tunnel ${fmt(w.tunnel)} open ${fmt(w.open)}` +
          ` | enclosure ${r.enclosure.toFixed(2)} meanFree ${r.meanFree.toFixed(1)}m`
        );
      }
    }
  }

  const IGNORE = /not valid for pointer lock/;
  const bad = logs.filter((l) => /\[error\]|\[pageerror\]|\[audio\]/.test(l) && !IGNORE.test(l));
  console.log(`\n=== CONSOLE (${logs.length} lines, ${bad.length} of interest) ===`);
  for (const l of bad.slice(0, 40)) console.log(' ', l);
  if (bad.some((l) => /\[error\]|\[pageerror\]/.test(l))) exitCode = 1;
} catch (err) {
  console.error('probe failed:', err);
  for (const l of logs.slice(-40)) console.log(' ', l);
  exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}

console.log(exitCode === 0 ? '\nAUDIO PROBE: PASS' : '\nAUDIO PROBE: FAIL');
process.exit(exitCode);
