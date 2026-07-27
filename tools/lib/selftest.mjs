#!/usr/bin/env node
/**
 * Self-test for the goal measurement primitives. No browser, no GPU, instant.
 *
 *   node tools/lib/selftest.mjs
 *
 * Synthetic images with known answers, so a change to a metric that flips a
 * goal criterion shows up here first.
 */
import { actorLegibility, imageMetrics, silhouetteMetrics, lumaPlane, gradientPlane } from './metrics.mjs';
import { costIndex } from './costmodel.mjs';
import { evaluate } from './criteria.mjs';
import { QUALITY_PRESETS } from '../../src/core/config.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function blank(w, h, fill = 0) {
  const data = Buffer.alloc(w * h * 4, 0);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = fill;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
const put = (img, x, y, v) => {
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
};
const get = (img, x, y) => img.data[(y * img.width + x) * 4];

/** Checkerboard at `cell` px. Small cells = high frequency detail. */
function checker(w, h, cell, lo = 40, hi = 200) {
  const img = blank(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      put(img, x, y, ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2 ? hi : lo);
  return img;
}

/** Nearest-neighbour downscale then bilinear upscale — what a low renderScale does. */
function resampleThroughLowRes(img, factor) {
  const { width: w, height: h } = img;
  const lw = Math.max(1, Math.round(w / factor));
  const lh = Math.max(1, Math.round(h / factor));
  const small = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++)
    for (let x = 0; x < lw; x++) {
      let s = 0, n = 0;
      for (let yy = Math.floor(y * factor); yy < Math.min(h, Math.floor((y + 1) * factor)); yy++)
        for (let xx = Math.floor(x * factor); xx < Math.min(w, Math.floor((x + 1) * factor)); xx++) {
          s += get(img, xx, yy); n++;
        }
      small[y * lw + x] = n ? s / n : 0;
    }
  const out = blank(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = Math.min(lw - 1, (x / factor));
      const fy = Math.min(lh - 1, (y / factor));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(lw - 1, x0 + 1), y1 = Math.min(lh - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const v =
        small[y0 * lw + x0] * (1 - tx) * (1 - ty) +
        small[y0 * lw + x1] * tx * (1 - ty) +
        small[y1 * lw + x0] * (1 - tx) * ty +
        small[y1 * lw + x1] * tx * ty;
      put(out, x, y, Math.round(v));
    }
  return out;
}

/* ------------------------------------------------------------- primitives */

{
  const img = blank(4, 3, 128);
  const L = lumaPlane(img);
  ok('lumaPlane is one entry per pixel', L.length === 12);
  ok('grey 128 reads as luma 128', Math.abs(L[0] - 128) < 0.01);

  const edge = blank(8, 8, 0);
  for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) put(edge, x, y, 200);
  const g = gradientPlane(lumaPlane(edge), 8, 8);
  ok('gradient fires on the step and nowhere else', g[3 * 8 + 3] > 100 && g[3 * 8 + 1] === 0, `edge=${g[3 * 8 + 3].toFixed(0)}`);
}

/* ------------------------------------------------- edgeEnergy vs upscaling */

{
  const sharp = checker(128, 128, 2);
  const upscaled = resampleThroughLowRes(sharp, 3.33); // ~ renderScale 0.3
  const a = imageMetrics(sharp);
  const b = imageMetrics(upscaled);
  ok('upscaling from a low internal buffer collapses edgeEnergy',
    b.edgeEnergy < a.edgeEnergy * 0.5, `${a.edgeEnergy} -> ${b.edgeEnergy}`);
  ok('upscaling collapses detailPct', b.detailPct < a.detailPct * 0.5, `${a.detailPct}% -> ${b.detailPct}%`);
  ok('mean luma survives upscaling', Math.abs(a.meanL - b.meanL) < 4, `${a.meanL} vs ${b.meanL}`);

  const mild = imageMetrics(resampleThroughLowRes(sharp, 1.4)); // ~ renderScale 0.72
  ok('a mild downscale scores between sharp and heavy',
    mild.edgeEnergy < a.edgeEnergy && mild.edgeEnergy > b.edgeEnergy, `${mild.edgeEnergy}`);
}

/* ------------------------------------------------------ crush and contrast */

{
  const lit = blank(64, 64, 0);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) put(lit, x, y, 30 + ((x * 7 + y * 3) % 24));
  const crushed = blank(64, 64, 0);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) put(crushed, x, y, Math.max(0, 2 + ((x * 7 + y * 3) % 24) - 22));
  const a = imageMetrics(lit);
  const b = imageMetrics(crushed);
  ok('a lifted shadow reports no crush', a.crushPct < 1, `${a.crushPct}%`);
  ok('a crushed shadow reports crush', b.crushPct > 50, `${b.crushPct}%`);
  ok('crushing destroys shadow detail', b.shadowDetail < a.shadowDetail, `${a.shadowDetail} -> ${b.shadowDetail}`);
}

/* -------------------------------------------------------------- silhouette */

{
  const bg = blank(96, 96, 100);
  const withEnemy = blank(96, 96, 100);
  for (let y = 30; y < 60; y++) for (let x = 40; x < 50; x++) put(withEnemy, x, y, 160);
  const s = silhouetteMetrics(withEnemy, bg);
  ok('finds exactly one silhouette', s.count === 1, `count=${s.count}`);
  ok('silhouette area is right', s.largestPx === 300, `px=${s.largestPx}`);
  ok('weber contrast is |160-100|/100', Math.abs(s.minWeber - 0.6) < 0.05, `weber=${s.minWeber}`);

  const camo = blank(96, 96, 100);
  for (let y = 30; y < 60; y++) for (let x = 40; x < 50; x++) put(camo, x, y, 110);
  const c = silhouetteMetrics(camo, bg);
  ok('a low-contrast target scores as barely visible', c.minWeber < 0.15, `weber=${c.minWeber}`);

  const two = blank(96, 96, 100);
  for (let y = 30; y < 60; y++) for (let x = 10; x < 20; x++) put(two, x, y, 160);
  for (let y = 30; y < 40; y++) for (let x = 70; x < 80; x++) put(two, x, y, 40);
  const t = silhouetteMetrics(two, bg);
  ok('separate targets stay separate blobs', t.count === 2, `count=${t.count}`);
  ok('smallestPx tracks the smaller target', t.smallestPx === 100, `smallest=${t.smallestPx}`);

  const none = silhouetteMetrics(bg, bg);
  ok('identical frames report no targets', none.count === 0 && none.minWeber === 0);
}

/* ------------------------------------------------------- actor legibility */

{
  const bg = blank(120, 120, 100);
  const frame = blank(120, 120, 100);
  // A near soldier with strong contrast, and a far one that barely differs.
  for (let y = 20; y < 50; y++) for (let x = 20; x < 32; x++) put(frame, x, y, 170);
  for (let y = 60; y < 68; y++) for (let x = 90; x < 94; x++) put(frame, x, y, 112);
  const actors = [
    { id: 1, distance: 12, x0: 20, y0: 20, x1: 31, y1: 49 },
    { id: 2, distance: 70, x0: 90, y0: 60, x1: 93, y1: 67 },
  ];
  const r = actorLegibility(frame, bg, actors);
  ok('scores one entry per actor', r.total === 2 && r.visible === 2, `visible=${r.visible}`);
  ok('near actor area matches its silhouette', r.actors[0].px === 360, `px=${r.actors[0].px}`);
  ok('near actor is high contrast', r.actors[0].weber > 0.5, `weber=${r.actors[0].weber}`);
  ok('far low-contrast actor scores below the legibility floor', r.actors[1].weber < 0.15, `weber=${r.actors[1].weber}`);

  const occluded = actorLegibility(bg, bg, actors);
  ok('an actor with no visible pixels reports px 0', occluded.visible === 0 && occluded.actors[0].px === 0);

  // A blurrier tier: the far actor dissolves into the background entirely.
  const soft = blank(120, 120, 100);
  for (let y = 20; y < 50; y++) for (let x = 20; x < 32; x++) put(soft, x, y, 170);
  const lost = actorLegibility(soft, bg, actors);
  ok('an actor that stopped resolving is caught', lost.visible === 1, `visible=${lost.visible}`);
}

/* -------------------------------------------------------------- cost model */

{
  // Internal buffer at a nominal 1920x1080 output, scaled per preset.
  const outMP = (1920 * 1080) / 1e6;
  const idx = Object.fromEntries(
    Object.entries(QUALITY_PRESETS).map(([tier, q]) => [
      tier,
      costIndex({ internalMP: outMP * q.renderScale * q.renderScale, q, calls: 1100, tris: 8.3e6 }).costIndex,
    ])
  );
  ok('cost is monotonic across the shipped presets',
    idx.performance < idx.low && idx.low < idx.medium && idx.medium < idx.high && idx.high <= idx.ultra,
    Object.entries(idx).map(([k, v]) => `${k}=${v}`).join(' '));
  ok('the performance tier is far cheaper than ultra', idx.performance / idx.ultra < 0.35, `${(idx.performance / idx.ultra).toFixed(3)}`);
  ok('cost scales with pixels',
    costIndex({ internalMP: 2, q: QUALITY_PRESETS.high, calls: 0, tris: 0 }).pixelCost ===
      2 * costIndex({ internalMP: 1, q: QUALITY_PRESETS.high, calls: 0, tris: 0 }).pixelCost);
}

/* ------------------------------------------------------------- evaluation */

{
  const shot = (edge, crush = 0.2, shadowDetail = 3, meanL = 90) => ({ edgeEnergy: edge, crushPct: crush, shadowDetail, meanL });
  const tier = (name, edge, targets) => ({
    tier: name,
    shots: { hero: shot(edge), interior: shot(edge), night: shot(edge) },
    targets,
  });
  const good = {
    total: 2,
    visible: 2,
    minWeber: 0.3,
    minPx: 120,
    actors: [
      { id: 1, distance: 14, px: 900, weber: 0.5 },
      { id: 2, distance: 55, px: 120, weber: 0.3 },
    ],
  };
  const report = {
    visibility: { tiers: [tier('performance', 9.5), tier('ultra', 10, good)].map((t) => ({ ...t, targets: t.targets ?? structuredClone(good) })) },
    cost: { tiers: [{ tier: 'performance', costIndex: 2.4, cpuSimMs: 1 }, { tier: 'ultra', costIndex: 10, cpuSimMs: 1 }] },
  };
  const clean = evaluate(report);
  ok('a healthy report passes every headless criterion',
    clean.criteria.filter((c) => c.id.startsWith('H')).every((c) => c.status === 'unverified') &&
      clean.criteria.filter((c) => !c.id.startsWith('H') && c.id !== 'P3').every((c) => c.status === 'pass'),
    clean.criteria.map((c) => `${c.id}:${c.status}`).join(' '));
  ok('hardware criteria are unverified, and unverified is not met', clean.summary.met === false);

  const blurry = structuredClone(report);
  for (const s of Object.values(blurry.visibility.tiers[0].shots)) s.edgeEnergy = 4;
  ok('a blurry performance tier fails V1', evaluate(blurry).criteria.find((c) => c.id === 'V1').status === 'fail');

  const invisible = structuredClone(report);
  invisible.visibility.tiers[0].targets.actors[0].weber = 0.05;
  ok('a near enemy that lost its contrast fails V3', evaluate(invisible).criteria.find((c) => c.id === 'V3').status === 'fail');

  const dissolved = structuredClone(report);
  dissolved.visibility.tiers[0].targets.actors[1].px = 40;
  ok('an enemy that lost half its pixels fails V3', evaluate(dissolved).criteria.find((c) => c.id === 'V3').status === 'fail');

  const gone = structuredClone(report);
  gone.visibility.tiers[0].targets = { total: 2, visible: 1, minWeber: 0.5, minPx: 900, actors: [{ id: 1, distance: 14, px: 900, weber: 0.5 }, { id: 2, distance: 55, px: 0, weber: 0 }] };
  ok('an enemy that vanished entirely fails V3', evaluate(gone).criteria.find((c) => c.id === 'V3').status === 'fail');

  const pricey = structuredClone(report);
  pricey.cost.tiers[0].costIndex = 9;
  const p = evaluate(pricey);
  ok('an expensive performance tier fails P1', p.criteria.find((c) => c.id === 'P1').status === 'fail');
  ok('a flat tier ladder fails P2', p.criteria.find((c) => c.id === 'P2').status === 'fail');

  const shipped = structuredClone(report);
  shipped.hardware = { runs: [{ machine: 'test', tier: 'low', targetFps: 120, fps: { p50: 124, p99: 96 }, hitches: { pctOfFrames: 0.1 } }] };
  shipped.baseline = { cost: { tiers: [{ tier: 'performance', cpuSimMs: 1 }, { tier: 'ultra', cpuSimMs: 1 }] } };
  ok('a full report with hardware evidence can be met', evaluate(shipped).summary.met === true,
    evaluate(shipped).criteria.filter((c) => c.status !== 'pass').map((c) => `${c.id}:${c.status}`).join(' ') || 'all pass');

  const slow = structuredClone(shipped);
  slow.hardware.runs[0].fps = { p50: 88, p99: 61 };
  ok('missing the FPS target fails H1', evaluate(slow).criteria.find((c) => c.id === 'H1').status === 'fail');
}

console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
