#!/usr/bin/env node
/**
 * Visibility gate — how readable the game is at each quality tier.
 *
 * Runs entirely on the CPU. Chromium's SwiftShader backend runs the real
 * shaders and produces the real image, so every metric here is exactly as valid
 * on a GPU-less container as on the user's laptop; it is only slow. Frame
 * pacing is the one thing software rendering cannot tell us, and this tool
 * deliberately measures nothing that depends on it — see tools/cost.mjs.
 *
 *   node tools/visibility.mjs                       # all tiers, all gate shots
 *   node tools/visibility.mjs --tiers=performance,ultra --shots=night
 *   node tools/visibility.mjs --w=640 --h=360 --settle=20 --jobs=2   # quick pass
 *   node tools/visibility.mjs --out=/tmp/vis.json --png=/tmp/visshots
 *
 * Comparisons are only meaningful between runs that used the same --w/--h and
 * --settle, because both change how far TAA and exposure adaptation have got.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ensureServer, openGame, parseArgs, table, ROOT } from './lib/harness.mjs';
import { actorLegibility, imageMetrics, silhouetteMetrics } from './lib/metrics.mjs';
import { TIERS, VIS_SHOTS, TARGET_SHOT } from './lib/criteria.mjs';

const args = parseArgs();
const W = Number(args.w ?? 960);
const H = Number(args.h ?? 540);
const SETTLE = Number(args.settle ?? 32);
const JOBS = Math.max(1, Number(args.jobs ?? 2));
const PORT = Number(args.port ?? 5321);
const GPU = args.gpu ?? 'auto';
const PNG_DIR = args.png ? resolve(String(args.png)) : null;
const tiers = String(args.tiers ?? TIERS.join(',')).split(',').filter(Boolean);
const shots = String(args.shots ?? VIS_SHOTS.join(',')).split(',').filter(Boolean);
const withTargets = args.targets !== '0';

async function measureTier(tier) {
  const t0 = Date.now();
  const game = await openGame({ port: PORT, width: W, height: H, quality: tier, gpu: GPU, query: 'prewarm=0' });
  const result = { tier, shots: {}, targets: null, renderer: game.renderer, errors: game.errors };
  try {
    for (const shot of shots) {
      await game.applyShot(shot);
      await game.pump(SETTLE);
      const buf = await game.canvasPng();
      const png = PNG.sync.read(buf);
      result.shots[shot] = imageMetrics(png);
      if (PNG_DIR) {
        mkdirSync(PNG_DIR, { recursive: true });
        writeFileSync(`${PNG_DIR}/${tier}-${shot}.png`, buf);
      }
      process.stderr.write(`  ${tier}/${shot} edge=${result.shots[shot].edgeEnergy} crush=${result.shots[shot].crushPct}%\n`);
    }

    if (withTargets) {
      // Enemy legibility: the same frame with and without the AI root, so the
      // difference IS the set of enemy silhouettes — then scored inside the
      // screen-space box the engine reports for each actor, so a tier can be
      // compared against ultra actor by actor.
      await game.applyShot(TARGET_SHOT);
      await game.pump(SETTLE);
      const boxes = await game.page.evaluate(() => window.__ACTOR_BOXES__());
      const withPng = PNG.sync.read(await game.canvasPng());
      const hidden = await game.page.evaluate(() => {
        const ai = window.__ENGINE__?.ctx?.peek('ai');
        if (!ai?.root) return false;
        ai.root.visible = false;
        return true;
      });
      if (!hidden) {
        result.targets = { error: 'ai root not reachable' };
      } else {
        await game.pump(SETTLE);
        const withoutPng = PNG.sync.read(await game.canvasPng());
        await game.page.evaluate(() => {
          const ai = window.__ENGINE__?.ctx?.peek('ai');
          if (ai?.root) ai.root.visible = true;
        });
        const scale = withPng.width / (boxes.width || withPng.width);
        const actors = boxes.actors.map((a) => ({
          ...a,
          x0: a.x0 * scale, y0: a.y0 * scale, x1: a.x1 * scale, y1: a.y1 * scale,
        }));
        const s = actorLegibility(withPng, withoutPng, actors);
        // Whole-frame blobs stay in the report as a cross-check on the boxes.
        const blobs = silhouetteMetrics(withPng, withoutPng);
        result.targets = { ...s, silhouettes: { count: blobs.count, movedPct: blobs.movedPct, largestPx: blobs.largestPx } };
        process.stderr.write(
          `  ${tier}/${TARGET_SHOT} actors ${s.visible}/${s.total} visible minWeber=${s.minWeber} minPx=${s.minPx}\n`
        );
      }
      if (PNG_DIR) {
        mkdirSync(PNG_DIR, { recursive: true });
        writeFileSync(`${PNG_DIR}/${tier}-${TARGET_SHOT}.png`, PNG.sync.write(withPng));
      }
    }
  } finally {
    await game.close();
  }
  result.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  return result;
}

/** Run tiers `JOBS` at a time; each job owns its own browser, all share one vite. */
async function runAll() {
  const queue = [...tiers];
  const done = [];
  const workers = Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    for (;;) {
      const tier = queue.shift();
      if (!tier) return;
      process.stderr.write(`[visibility] ${tier} ...\n`);
      done.push(await measureTier(tier));
    }
  });
  await Promise.all(workers);
  return TIERS.filter((t) => done.some((d) => d.tier === t)).map((t) => done.find((d) => d.tier === t));
}

const server = await ensureServer(PORT);
let report;
try {
  report = {
    kind: 'visibility',
    config: { width: W, height: H, settle: SETTLE, shots, targetShot: withTargets ? TARGET_SHOT : null },
    tiers: await runAll(),
  };
} finally {
  server?.kill();
}
report.renderer = report.tiers[0]?.renderer ?? 'unknown';

const ref = report.tiers.find((t) => t.tier === 'ultra');
const rows = report.tiers.flatMap((t) =>
  Object.entries(t.shots).map(([shot, m]) => ({
    tier: t.tier,
    shot,
    edge: m.edgeEnergy,
    vsUltra: ref?.shots?.[shot] ? (m.edgeEnergy / ref.shots[shot].edgeEnergy).toFixed(2) : '-',
    detailPct: m.detailPct,
    crushPct: m.crushPct,
    shadowDetail: m.shadowDetail,
    meanL: m.meanL,
  }))
);
console.log(
  table(rows, [
    { key: 'tier' }, { key: 'shot' }, { key: 'edge' }, { key: 'vsUltra' },
    { key: 'detailPct' }, { key: 'crushPct' }, { key: 'shadowDetail' }, { key: 'meanL' },
  ])
);
if (withTargets) {
  console.log();
  console.log(
    table(
      report.tiers.filter((t) => t.targets && !t.targets.error).map((t) => ({
        tier: t.tier,
        inFrame: t.targets.total,
        visible: t.targets.visible,
        minWeber: t.targets.minWeber,
        minPx: t.targets.minPx,
        pxPerActor: t.targets.actors.map((a) => a.px).join('/'),
      })),
      [{ key: 'tier' }, { key: 'inFrame' }, { key: 'visible' }, { key: 'minWeber' }, { key: 'minPx' }, { key: 'pxPerActor' }]
    )
  );
}

if (args.out) {
  const out = resolve(String(args.out));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out.replace(ROOT + '/', '')}`);
}
