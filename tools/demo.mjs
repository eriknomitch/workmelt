#!/usr/bin/env node
/**
 * DEMO REEL RECORDER — records the game being played, frame by frame.
 *
 * Boots vite, opens the page in GPU-backed Chromium under `?capture=1&lockstep=1`,
 * injects tools/demo-driver.js (a bot that plays through the real input layer),
 * then loops: advance exactly one engine frame, take one screenshot. Because
 * lockstep mode means the engine never schedules its own frames, the recorder's
 * own latency cannot affect the simulation — a frame the encoder took 400 ms to
 * write is still 1/60 s of game time. That is the whole reason this is frame
 * stepped rather than a screen recording of real-time play: no dropped frames,
 * no variable pacing, and the result is reproducible.
 *
 * Screenshots (not canvas readback) because the HUD is DOM, not WebGL — see
 * index.html. `page.screenshot` composites both.
 *
 * Usage:
 *   node tools/demo.mjs                            # 20 s, 1080p
 *   node tools/demo.mjs --frames=120 --w=1280 --h=720
 *   node tools/demo.mjs --frames=1800 --out=reel.mp4 --keep
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(args.port ?? 5178);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const FPS = Number(args.fps ?? 60);
const FRAMES = Number(args.frames ?? 1200);
const TIME_OF_DAY = args.time !== undefined ? Number(args.time) : 17.4;
const OUT = resolve(args.out ?? 'demo/workmelt-demo.mp4');
const TMP = resolve(args.tmp ?? '.tmp-demo');
const QUALITY = Number(args.jpeg ?? 94);

const log = (...m) => console.log(...m);

/* ------------------------------------------------------------------ server -- */

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

async function ensureServer() {
  if (await portOpen(PORT)) return null;
  const p = spawn(resolve(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) return p;
  }
  p.kill();
  throw new Error('vite failed to start');
}

/* ------------------------------------------------------------------- record -- */

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

const server = await ensureServer();
log(`[demo] vite on :${PORT}${server ? '' : ' (already running)'}`);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=metal',
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

const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let failed = null;
let telemetry = [];
let events = [];

try {
  const t0 = Date.now();
  // prewarm=0: the shader pre-warm is only there to stop multi-second compile
  // stalls during real-time play, and in lockstep those stalls cost wall clock
  // but not a single frame of simulation. It is also what leaves the weapon in
  // debug mode and six staged mannequins in the level (both worked around in
  // the driver's begin(), but not paying for it at all is cleaner).
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&q=ultra&prewarm=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 180000 });
  log(`[demo] booted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const installed = await page.evaluate(readFileSync(join(ROOT, 'tools/demo-driver.js'), 'utf8'));
  log('[demo] driver:', JSON.stringify(installed));

  const begun = await page.evaluate(
    (o) => window.__DEMO__.begin(o),
    { frames: FRAMES, time: TIME_OF_DAY }
  );
  log('[demo] begin:', JSON.stringify(begun));

  const pad = (n) => String(n).padStart(5, '0');
  const started = Date.now();
  let lastReport = 0;

  for (let i = 0; i < FRAMES; i++) {
    // One engine frame, then one rAF so the compositor has the new backbuffer
    // before the screenshot RPC asks for it. Nothing simulates during the wait.
    const info = await page.evaluate(
      () =>
        new Promise((done) => {
          const r = window.__DEMO__.frame();
          requestAnimationFrame(() => done(r));
        })
    );
    telemetry.push(info);
    await page.screenshot({ path: join(TMP, `f${pad(i)}.jpg`), type: 'jpeg', quality: QUALITY });

    if (i - lastReport >= 60 || i === FRAMES - 1) {
      lastReport = i;
      const el = (Date.now() - started) / 1000;
      const rate = (i + 1) / el;
      const eta = (FRAMES - i - 1) / rate;
      log(
        `[demo] ${i + 1}/${FRAMES}  ${info.phase.padEnd(6)} ` +
          `alive=${String(info.alive).padStart(2)} kills=${String(info.kills).padStart(2)} ` +
          `ammo=${String(info.ammo).padStart(2)} pitch=${String(info.pitch).padStart(5)} ` +
          `wp=${info.wp} scale=${info.scale.toFixed(2)} ` +
          `keys=${(info.keys || '-').padEnd(22)} ${rate.toFixed(1)}fps eta ${eta.toFixed(0)}s`
      );
    }
  }

  events = await page.evaluate(() => window.__DEMO__.events());
  const stats = await page.evaluate(() => window.__DEMO__.stats());
  log('[demo] stats:', JSON.stringify(stats));
} catch (e) {
  failed = e;
} finally {
  if (failed || args.verbose) console.error(logs.slice(-50).join('\n'));
  await browser.close().catch(() => {});
  if (server) server.kill();
}

if (failed) {
  console.error('[demo] FAILED', failed.message, '\n', failed.stack);
  process.exit(1);
}

/* -------------------------------------------------------------------- encode -- */

const nFrames = readdirSync(TMP).filter((f) => f.endsWith('.jpg')).length;
log(`[demo] ${nFrames} frames captured`);
writeFileSync(join(TMP, 'events.json'), JSON.stringify(events));
writeFileSync(join(TMP, 'telemetry.json'), JSON.stringify(telemetry));

const count = (n) => events.filter((e) => e.name === n).length;
log(
  `[demo] gameplay: ${telemetry.at(-1)?.kills ?? 0} kills, ${count('fire')} rounds fired, ` +
    `${count('hit')} damage events (an explosion raises this for every enemy in radius, ` +
    `so it is not an accuracy figure), ${count('impact')} impacts, ${count('boom')} explosions, ` +
    `${count('hurt')} hits taken`
);

const ff = (a) => {
  const r = spawnSync('ffmpeg', a, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(-1200)}`);
};

// Audio track is synthesized offline from events.json by tools/demo-audio.mjs;
// it is muxed in there. This produces the video-only master.
const silent = OUT.replace(/\.mp4$/, '') + '.silent.mp4';
// Fade up from black and out to black. This build of ffmpeg has no libfreetype,
// so there is no `drawtext` — the title cards are DOM, composited in the page by
// the driver. `fade` needs no external library.
const FADE = 0.5;
const durSec = nFrames / FPS;
ff([
  '-y',
  '-framerate', String(FPS),
  '-i', join(TMP, 'f%05d.jpg'),
  '-vf', `fade=t=in:st=0:d=${FADE},fade=t=out:st=${(durSec - FADE).toFixed(3)}:d=${FADE}`,
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  silent,
]);
log(`[demo] video -> ${silent}`);

/* --------------------------------------------------------------------- audio -- */

let finalOut = silent;
if (args['no-audio']) {
  log('[demo] --no-audio: skipping the audio pass');
} else {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'tools/demo-audio.mjs'), `--events=${join(TMP, 'events.json')}`,
     `--frames=${nFrames}`, `--fps=${FPS}`, `--out=${join(TMP, 'track.wav')}`],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) {
    log('[demo] audio pass failed — keeping the silent master');
  } else {
    ff([
      '-y',
      '-i', silent,
      '-i', join(TMP, 'track.wav'),
      '-c:v', 'copy',
      // loudnorm first: the raw synthesized track measures about -22 LUFS, which
      // is ~8 dB under what anything that plays this back will expect, so it came
      // out sounding thin. Then match the picture fades. The track is deliberately
      // longer than the video so the last explosion rings out; -shortest trims it.
      // The alimiter is not redundant with loudnorm's TP: single-pass loudnorm
      // only predicts true peak, and between its error and the AAC encoder's own
      // overshoot the master measured +0.4 dBFS — clipping. This pins it.
      '-af',
      `loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000,` +
        `afade=t=in:st=0:d=${FADE},afade=t=out:st=${(durSec - 0.7).toFixed(3)}:d=0.7,` +
        `alimiter=limit=0.89:level=disabled`,
      // 320k, not 256k, and the reason is measured rather than cargo-culted: the
      // track is ~1900 transients in 40 s, and at 256k the encoder's quantization
      // ringing overshot the limiter by 2 dB, decoding to +0.97 dBFS. At 320k the
      // same limiter setting decodes to -0.98 dBFS.
      '-c:a', 'aac', '-b:a', '320k',
      '-shortest',
      '-movflags', '+faststart',
      OUT,
    ]);
    rmSync(silent, { force: true });
    finalOut = OUT;
  }
}

if (!args.keep) rmSync(TMP, { recursive: true, force: true });

const probe = spawnSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration,size',
  '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
  '-of', 'default=nw=1', finalOut,
]);
log('\n[demo] DONE ->', finalOut);
log(probe.stdout?.toString().trim());
