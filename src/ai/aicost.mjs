#!/usr/bin/env node
/**
 * AI-subsystem CPU cost probe (agent-local measurement aid).
 *
 * The shared gameplay profiler reports whole-frame time, which on a machine
 * running several optimisation passes at once is dominated by contention. This
 * wraps ai.update()/ai.lateUpdate() and reports the distribution of the time
 * the AI subsystem itself spends per frame, under the same scripted gameplay
 * drive tools/profile.mjs uses. Relative numbers only — but they are the
 * numbers this directory can actually move.
 *
 *   node src/ai/aicost.mjs --port=5333 --frames=900
 */
import { chromium } from 'playwright';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PORT = Number(args.port ?? 5333);
const FRAMES = Number(args.frames ?? 900);
const DPR = Number(args.dpr ?? 2);

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
         '--disable-frame-rate-limit', '--disable-gpu-vsync'],
}));
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: DPR });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.enabled = true; e.input.frozen = false;
  e.ctx.peek('player')?.setControlEnabled?.(true);
  e.ctx.peek('ai')?.debugStage?.('firefight');
});

const out = await page.evaluate((FRAMES) => new Promise((done) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const acc = { ms: 0, anim: 0, path: 0, cover: 0, hitbox: 0, ground: 0, pathN: 0 };
  for (const k of ['update', 'lateUpdate']) {
    const orig = ai[k].bind(ai);
    ai[k] = (...a) => { const t = performance.now(); orig(...a); acc.ms += performance.now() - t; };
  }
  const wrap = (obj, k, slot, count) => {
    if (!obj) return;
    const proto = Object.getPrototypeOf(obj);
    const orig = proto[k];
    if (!orig) return;
    proto[k] = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      acc[slot] += performance.now() - t;
      if (count) acc[count]++;
      return r;
    };
  };
  const a0 = ai.agents[0];
  wrap(a0?.animator, 'update', 'anim');
  wrap(ai.grid, 'findPath', 'path', 'pathN');
  wrap(ai.cover, 'pick', 'cover');
  wrap(a0, 'syncHitboxes', 'hitbox');
  wrap(ai.ground, 'addActor', 'ground');
  const rows = [];
  let last = performance.now(), i = 0;
  const tick = () => {
    const now = performance.now();
    const dt = now - last; last = now;
    e.camera.rotation.y += 0.006;
    try { e.input.down.add('KeyW'); } catch {}
    if (i % 90 < 30) e.input.down.add('Mouse0'); else e.input.down.delete('Mouse0');
    rows.push({ i, dt, ai: acc.ms, anim: acc.anim, path: acc.path, cover: acc.cover, hitbox: acc.hitbox, ground: acc.ground, pathN: acc.pathN, agents: ai.agents.length, alive: ai.stats.alive });
    for (const k in acc) acc[k] = 0;
    if (++i >= FRAMES) return done(rows);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), FRAMES);

const warm = out.slice(60);
const s = (key) => {
  const v = warm.map((r) => r[key]).sort((a, b) => a - b);
  const q = (p) => +v[Math.min(v.length - 1, Math.floor(v.length * p))].toFixed(2);
  const mean = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
  return { mean, p50: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99), max: q(1) };
};
console.log(JSON.stringify({
  frames: warm.length,
  agents: warm[warm.length - 1].agents,
  alive: warm[warm.length - 1].alive,
  aiMs: s('ai'),
  animMs: s('anim'),
  pathMs: s('path'),
  coverMs: s('cover'),
  hitboxMs: s('hitbox'),
  groundMs: s('ground'),
  pathCalls: s('pathN'),
  pathCallsTotal: warm.reduce((a, r) => a + r.pathN, 0),
  frameMs: s('dt'),
  aiOver5ms: warm.filter((r) => r.ai > 5).length,
  errors: errs.slice(0, 5),
}, null, 2));
await browser.close();
