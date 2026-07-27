#!/usr/bin/env node
/**
 * Performance gate — without a GPU.
 *
 * You cannot measure frames per second on a machine that has no graphics
 * hardware, and pretending otherwise is how optimization work goes wrong. So
 * this tool measures the things that DO transfer:
 *
 *   1. costIndex — an analytic model of the per-frame GPU workload, built from
 *      quantities read out of the live engine: internal render resolution, which
 *      post passes are enabled, shadow-map texels, draw calls, triangles. It is
 *      ordinal, not predictive: it cannot tell you "112 fps", it can tell you
 *      "this tier asks the GPU for 3.1x less work than ultra". Every performance
 *      criterion in the goal is written as a ratio for exactly that reason.
 *   2. cpuSimMs — real measured CPU time in fixed/update/late. This is genuine
 *      simulation cost and has nothing to do with the GPU, so a container
 *      measures it honestly (in container-CPU terms).
 *   3. swMsPerFrame — SwiftShader wall time per frame. A second, independent,
 *      very noisy witness: it is a real rasteriser doing the real shader work,
 *      so it moves with resolution and pass count. Corroboration only.
 *
 * Real frames per second come from a machine with a GPU: `node tools/profile.mjs`
 * or the in-page `__PERF__` recorder, ingested with `tools/goal.mjs --ingest`.
 *
 *   node tools/cost.mjs
 *   node tools/cost.mjs --tiers=performance,low --frames=6 --out=/tmp/cost.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureServer, openGame, parseArgs, table, ROOT } from './lib/harness.mjs';
import { costIndex, PASS_WEIGHT, SHADOW_TEXEL_WEIGHT, TRI_WEIGHT, CALL_WEIGHT } from './lib/costmodel.mjs';
import { TIERS } from './lib/criteria.mjs';

const args = parseArgs();
const W = Number(args.w ?? 960);
const H = Number(args.h ?? 540);
const FRAMES = Number(args.frames ?? 8);
const SETTLE = Number(args.settle ?? 8);
const PORT = Number(args.port ?? 5331);
const GPU = args.gpu ?? 'auto';
const SHOT = String(args.shot ?? 'combat');
const tiers = String(args.tiers ?? TIERS.join(',')).split(',').filter(Boolean);

async function measureTier(tier) {
  const game = await openGame({ port: PORT, width: W, height: H, quality: tier, gpu: GPU, query: 'prewarm=0' });
  try {
    await game.applyShot(SHOT);
    await game.pump(SETTLE);
    const frameMs = [];
    for (let i = 0; i < FRAMES; i++) {
      const t = Date.now();
      await game.pump(1);
      frameMs.push(Date.now() - t);
    }
    frameMs.sort((a, b) => a - b);

    const live = await game.page.evaluate(() => {
      const e = window.__ENGINE__;
      const r = e.ctx.peek('render');
      const s = e.perf.stats();
      const q = e.config.q;
      return {
        internal: { ...r.screenSize },
        renderScale: q.renderScale,
        q: {
          renderScale: q.renderScale, shadows: q.shadows, prepass: q.prepass, taa: q.taa,
          gtao: q.gtao, ssr: q.ssr, volumetrics: q.volumetrics, motionBlur: q.motionBlur,
          bloom: q.bloom, shadowMapSize: q.shadowMapSize, cascades: q.cascades,
          shadowDistance: q.shadowDistance, anisotropy: q.anisotropy,
          particleBudget: q.particleBudget, decalBudget: q.decalBudget,
        },
        calls: r.renderer.info.render.calls,
        tris: r.renderer.info.render.triangles,
        programs: r.renderer.info.programs?.length ?? 0,
        textures: r.renderer.info.memory.textures,
        geometries: r.renderer.info.memory.geometries,
        phasesMs: s.phasesMs,
      };
    });

    const internalMP = (live.internal.width * live.internal.height) / 1e6;
    const model = costIndex({ internalMP, q: live.q, calls: live.calls, tris: live.tris });
    return {
      tier,
      internal: `${live.internal.width}x${live.internal.height}`,
      internalMP: +internalMP.toFixed(3),
      renderScale: live.renderScale,
      calls: live.calls,
      triM: +(live.tris / 1e6).toFixed(2),
      programs: live.programs,
      textures: live.textures,
      geometries: live.geometries,
      cpuSimMs: +(live.phasesMs.fixed + live.phasesMs.update + live.phasesMs.late).toFixed(2),
      phasesMs: live.phasesMs,
      swMsPerFrame: frameMs[(frameMs.length / 2) | 0],
      ...model,
      q: live.q,
    };
  } finally {
    await game.close();
  }
}

const server = await ensureServer(PORT);
let report;
try {
  const rows = [];
  for (const tier of tiers) {
    process.stderr.write(`[cost] ${tier} ...\n`);
    rows.push(await measureTier(tier));
  }
  report = {
    kind: 'cost',
    config: { width: W, height: H, frames: FRAMES, settle: SETTLE, shot: SHOT, weights: { PASS_WEIGHT, SHADOW_TEXEL_WEIGHT, TRI_WEIGHT, CALL_WEIGHT } },
    tiers: rows,
  };
} finally {
  server?.kill();
}

const ref = report.tiers.find((t) => t.tier === 'ultra');
console.log(
  table(
    report.tiers.map((t) => ({
      tier: t.tier,
      internal: t.internal,
      calls: t.calls,
      triM: t.triM,
      passW: t.passWeight,
      shadowMT: t.shadowMTexels,
      costIndex: t.costIndex,
      vsUltra: ref ? (t.costIndex / ref.costIndex).toFixed(2) : '-',
      cpuSimMs: t.cpuSimMs,
      swMs: t.swMsPerFrame,
    })),
    [
      { key: 'tier' }, { key: 'internal' }, { key: 'calls' }, { key: 'triM' }, { key: 'passW' },
      { key: 'shadowMT' }, { key: 'costIndex' }, { key: 'vsUltra' }, { key: 'cpuSimMs' }, { key: 'swMs' },
    ]
  )
);

if (args.out) {
  const out = resolve(String(args.out));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out.replace(ROOT + '/', '')}`);
}
