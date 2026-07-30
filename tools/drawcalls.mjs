#!/usr/bin/env node
/**
 * Draw-call and texture-memory attribution.
 *
 * Boots the game in the capture harness, applies a shot, then reads
 * `renderer.info` with each subsystem's root hidden in turn. The difference is
 * that subsystem's true per-frame draw cost across EVERY pass — forward, the
 * depth/normal prepass and the shadow cascades — which is the number that
 * matters and the one a single `info.render.calls` reading hides.
 *
 * It also walks every material reachable from the world scene, the viewmodel
 * scene and the two texture caches and sums the RGBA8 mip chains, because the
 * procedural sets are the largest allocation the game makes.
 *
 *   node tools/drawcalls.mjs --shot=combat --quality=high
 *
 * NOTE: draw calls and bytes are hardware-independent. Frame times from this
 * harness are not — a headless container usually falls back to SwiftShader.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { resolveChromium } from './lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? process.env.OW_PORT ?? 5273);
const SHOT = args.shot ?? 'combat';
const QUALITY = args.quality ?? 'high';
const W = Number(args.w ?? 960);
const H = Number(args.h ?? 540);

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

async function ensureServer() {
  if (await portOpen(PORT)) return null;
  const root = resolve(import.meta.dirname, '..');
  const p = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) return p;
  }
  p.kill();
  throw new Error('vite failed to start');
}

const server = await ensureServer();
const launch = { headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] };
launch.executablePath = String(args.chrome ?? resolveChromium() ?? '') || undefined;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(`http://127.0.0.1:${PORT}/?capture=1&q=${QUALITY}`, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForFunction('window.__READY__ === true', null, { timeout: 300000 });
await page.evaluate((s) => window.__APPLY_SHOT__(s), SHOT);

/** Render a few frames so culling, LOD and the cascades settle. */
const settle = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        let i = 0;
        const t = () => (++i >= 8 ? done() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      })
  );

const read = () =>
  page.evaluate(() => {
    const r = window.__ENGINE__.registry.peek('render').renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles };
  });

await settle();
const total = await read();

/** Roots we can hide independently. `viewScene` holds the first-person weapon. */
const ROOTS = ['ai', 'world', 'fx'];
const attribution = [];
for (const id of ROOTS) {
  const ok = await page.evaluate((sys) => {
    const s = window.__ENGINE__.registry.peek(sys);
    const root = s?.root ?? s?.group;
    if (!root) return false;
    root.visible = false;
    return true;
  }, id);
  if (!ok) continue;
  await settle();
  const without = await read();
  attribution.push({ system: id, calls: total.calls - without.calls, tris: total.tris - without.tris });
  await page.evaluate((sys) => {
    const s = window.__ENGINE__.registry.peek(sys);
    (s?.root ?? s?.group).visible = true;
  }, id);
  await settle();
}

const detail = await page.evaluate(() => {
  const reg = window.__ENGINE__.registry;

  /* ---- texture bytes: every RGBA8 map with a full mip chain ---- */
  const seen = new Set();
  const byOwner = {};
  const addBytes = (t, owner) => {
    if (!t?.image || seen.has(t.uuid)) return;
    seen.add(t.uuid);
    const { width: w = 0, height: h = 0 } = t.image;
    if (!w || !h) return;
    const b = w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
    byOwner[owner] = (byOwner[owner] ?? 0) + b;
  };
  const mats = reg.peek('materials');
  if (mats?._sets) {
    for (const [key, s] of mats._sets) {
      const owner = key.startsWith('__') ? 'materials:shared' : 'materials:library';
      addBytes(s.albedo, owner);
      addBytes(s.orm, owner);
      addBytes(s.normal, owner);
    }
  }
  const ai = reg.peek('ai');
  if (ai?.materials) {
    for (const k in ai.materials.sets) {
      const s = ai.materials.sets[k];
      addBytes(s.albedo, 'ai:characters');
      addBytes(s.orm, 'ai:characters');
      addBytes(s.normal, 'ai:characters');
    }
    for (const k in ai.materials.details) addBytes(ai.materials.details[k], 'ai:characters');
  }

  /* ---- per-character material groups: one draw call each, every pass ---- */
  const agents = (ai?.agents ?? []).map((a) => ({
    groups: a.mesh?.geometry?.groups?.length ?? 0,
    tris: (a.mesh?.geometry?.index?.count ?? 0) / 3,
  }));

  const mb = {};
  let sum = 0;
  for (const k in byOwner) {
    mb[k] = +(byOwner[k] / 1048576).toFixed(1);
    sum += byOwner[k];
  }
  return {
    textureMB: mb,
    textureTotalMB: +(sum / 1048576).toFixed(1),
    bakedSets: mats?._sets?.size ?? 0,
    materialInstances: mats?._materials?.size ?? 0,
    agents: agents.length,
    groupsPerAgent: agents[0]?.groups ?? 0,
    trisPerAgent: agents[0]?.tris ?? 0,
  };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`shot=${SHOT} quality=${QUALITY} ${W}x${H}\n`);
console.log(`frame total       ${total.calls} draw calls, ${(total.tris / 1e6).toFixed(2)}M triangles\n`);
console.log(pad('system', 12) + pad('draw calls', 12) + pad('share', 8) + 'triangles');
console.log('-'.repeat(50));
for (const a of attribution) {
  console.log(
    pad(a.system, 12) +
      pad(a.calls, 12) +
      pad(`${((a.calls / total.calls) * 100).toFixed(1)}%`, 8) +
      a.tris.toLocaleString()
  );
}
if (detail.agents) {
  console.log(
    `\n${detail.agents} characters, ${detail.groupsPerAgent} material groups each ` +
      `(${detail.trisPerAgent.toLocaleString()} tris of geometry).`
  );
  const ai = attribution.find((a) => a.system === 'ai');
  if (ai) {
    console.log(
      `  ${(ai.calls / detail.agents).toFixed(1)} draw calls per character = ` +
        `${detail.groupsPerAgent} groups x ~${(ai.calls / detail.agents / detail.groupsPerAgent).toFixed(1)} passes.`
    );
  }
}
console.log(`\ntexture memory    ${detail.textureTotalMB} MB (RGBA8 + mips)`);
for (const k of Object.keys(detail.textureMB).sort((a, b) => detail.textureMB[b] - detail.textureMB[a])) {
  console.log(`  ${pad(k, 22)}${detail.textureMB[k]} MB`);
}
console.log(`\n${detail.bakedSets} baked texture sets, ${detail.materialInstances} material instances`);

await browser.close();
server?.kill();
