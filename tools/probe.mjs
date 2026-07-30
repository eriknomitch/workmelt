#!/usr/bin/env node
/**
 * HDR scene-radiance probe. Applies a shot, then reads named regions straight
 * out of the pre-post HDR buffer so lighting ratios can be read in stops.
 *
 *   node tools/probe.mjs --port=5402 --shots=hero,sunset,night
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { launchOpts } from './lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const PORT = Number(args.port ?? 5402);
const ROOT = resolve(import.meta.dirname, '..');

// Per-shot regions, chosen by eye off the captures. name -> [u0,v0,u1,v1]
const COMMON = {
  skyHi: [0.30, 0.03, 0.40, 0.09],
};
const SHOT_REGIONS = {
  hero: {
    ...COMMON,
    sunlit: [0.79, 0.04, 0.97, 0.18],   // top-right facade, in sun
    shade: [0.03, 0.38, 0.14, 0.49],    // left building wall, in shade
    street: [0.37, 0.58, 0.56, 0.66],   // mid street
    fg: [0.20, 0.86, 0.42, 0.96],       // foreground gravel
  },
  interior: {
    ...COMMON,
    sunlit: [0.46, 0.29, 0.60, 0.42],   // exterior facade seen through the opening
    shade: [0.78, 0.10, 0.95, 0.45],    // interior wall panel, right
    street: [0.13, 0.15, 0.22, 0.30],   // interior wall panel, left
    fg: [0.37, 0.86, 0.52, 0.95],       // interior floor
  },
  sunset: {
    ...COMMON,
    sunlit: [0.72, 0.10, 0.92, 0.30],
    shade: [0.03, 0.40, 0.13, 0.52],
    street: [0.37, 0.72, 0.56, 0.80],
    fg: [0.20, 0.86, 0.42, 0.96],
  },
  night: {
    ...COMMON,
    sunlit: [0.72, 0.10, 0.92, 0.30],
    shade: [0.03, 0.40, 0.13, 0.52],
    street: [0.37, 0.60, 0.56, 0.70],
    fg: [0.20, 0.86, 0.42, 0.96],
  },
};
const DEFAULT_REGIONS = SHOT_REGIONS.hero;

const portOpen = (p) =>
  new Promise((res) => {
    const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

let server = null;
if (!(await portOpen(PORT))) {
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 160; i++) { await new Promise((r) => setTimeout(r, 250)); if (await portOpen(PORT)) break; }
}

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--mute-audio'],
}));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });

const shots = String(args.shots ?? 'hero,sunset,night,interior').split(',');
for (const s of shots) {
  await page.evaluate(({ n, settle }) => window.__APPLY_SHOT__(n, { grabFrame: settle }), { n: s, settle: 60 });
  await page.evaluate(
    (n) => new Promise((d) => { let i = 0; const t = () => (++i >= n ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    60
  );
  const out = await page.evaluate((regions) => {
    const r = window.__ENGINE__.ctx.get('render');
    const ex = window.__RENDER_EXPOSURE__ ?? null;
    const res = {};
    for (const [k, v] of Object.entries(regions)) res[k] = r.probeHdr(v[0], v[1], v[2], v[3]);
    return { res, ex, grid: r.probeHdrGrid(24, 14) };
  }, SHOT_REGIONS[s] ?? DEFAULT_REGIONS);
  const L = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const parts = Object.entries(out.res).map(
    ([k, c]) => `${k.padEnd(7)}=${c.r.toFixed(4)}/${c.g.toFixed(4)}/${c.b.toFixed(4)} L${(0.2126*c.r+0.7152*c.g+0.0722*c.b).toFixed(4)} B-R%=${(100*(c.b-c.r)/Math.max(1e-6,0.2126*c.r+0.7152*c.g+0.0722*c.b)).toFixed(0)}`
  );
  console.log(`\n== ${s}`);
  for (const p of parts) console.log('   ' + p);
  const g = out.res.street, sl = out.res.sunlit, sh = out.res.shade, sk = out.res.skyHi;
  const st = (a, b) => (Math.log2(Math.max(L(a), 1e-9) / Math.max(L(b), 1e-9))).toFixed(2);
  console.log(`   key:fill = ${st(sl, sh)} stops   sky:sunlit = ${st(sk, sl)} stops   sunlit:ground = ${st(sl, g)} stops`);
  if (args.grid) {
    const { cols, rows, cells } = out.grid;
    console.log('   grid: luminance (log2) / chroma B-R sign, row0=top');
    for (let y = 0; y < rows; y++) {
      let a = '', b = '';
      for (let x = 0; x < cols; x++) {
        const c = cells[y * cols + x];
        const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const ev = Math.round(Math.log2(Math.max(l, 1e-6)));
        a += String(ev).padStart(4);
        const br = (c[2] - c[0]) / Math.max(l, 1e-6);
        b += (br > 0.10 ? '  B ' : br < -0.10 ? '  W ' : '  . ');
      }
      console.log('   ' + a + '  |' + b);
    }
  }
}
await browser.close();
if (server) server.kill();
