/**
 * Headless checks for the resolution budget.
 *
 *   node src/render/resolution.selftest.mjs
 *
 * The load-bearing ones: a window inside the budget must come back BIT-IDENTICAL
 * (or every existing baseline moves), and a window over it must keep its aspect
 * ratio to within a pixel (or the clamp silently changes the field of view).
 */

import {
  DEFAULT_PIXEL_BUDGET,
  MIN_PIXEL_BUDGET,
  fitToBudget,
  sanitizePixelBudget,
} from './resolution.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) return;
  failures++;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const section = (name) => console.log(`\n${name}`);

const BUDGET = { maxPixels: DEFAULT_PIXEL_BUDGET, maxDimension: 16384 };

/* ------------------------------------------- 1. under budget is a no-op -- */
section('inside the budget nothing moves');
for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3440, 1440],
  [3840, 2160], // exactly the default budget
]) {
  const fit = fitToBudget(w, h, BUDGET);
  check(`${w}x${h} unchanged`, fit.width === w && fit.height === h, `${fit.width}x${fit.height}`);
  check(`${w}x${h} scale 1`, fit.scale === 1, String(fit.scale));
}

/* ------------------------------------------------ 2. over budget clamps -- */
section('over the budget, area is respected');
for (const [w, h, label] of [
  [5120, 2880, '5K'],
  [4512, 2538, '6K XDR at a 1.5 cap'],
  [7680, 4320, '8K'],
  [5120, 1440, '32:9 dual-QHD (under: must not clamp)'],
  [10240, 5760, '5K at 200% SSAA'],
  [11520, 4860, 'absurd ultrawide SSAA'],
]) {
  const fit = fitToBudget(w, h, BUDGET);
  const area = fit.width * fit.height;
  check(`${label} within budget`, area <= BUDGET.maxPixels, `${area} > ${BUDGET.maxPixels}`);
  check(
    `${label} within device limit`,
    fit.width <= BUDGET.maxDimension && fit.height <= BUDGET.maxDimension,
    `${fit.width}x${fit.height}`
  );
  // Not merely under budget — CLOSE to it. A clamp that overshoots downward is
  // throwing away sharpness the machine had already paid for.
  if (w * h > BUDGET.maxPixels)
    check(`${label} uses the budget`, area >= BUDGET.maxPixels * 0.995, `${area}`);
}

/* ------------------------------------------------- 3. aspect is exact --- */
section('aspect ratio survives the clamp');
for (const [w, h] of [
  [5120, 2880],
  [5120, 1440],
  [7680, 4320],
  [10240, 5760],
  [3440, 2400],
  [1080, 5120], // portrait, because a phone in portrait is still a window
]) {
  const fit = fitToBudget(w, h, BUDGET);
  const before = w / h;
  const after = fit.width / fit.height;
  // One pixel of floor() on the short axis is the whole error budget.
  const tol = before / Math.min(fit.width, fit.height);
  check(
    `${w}x${h} aspect held`,
    Math.abs(after - before) <= tol,
    `${before.toFixed(5)} -> ${after.toFixed(5)}`
  );
}

/* ------------------------------------- 4. the device limit binds hardest -- */
section('MAX_TEXTURE_SIZE is not negotiable');
{
  // A machine with a generous area budget and a small per-axis limit: the axis
  // limit has to win, because exceeding it is a black screen rather than a slow
  // frame. 8192 is a real, shipping limit (this repo's own SwiftShader harness
  // reports exactly that).
  const small = { maxPixels: 64e6, maxDimension: 8192 };
  const fit = fitToBudget(10240, 5760, small);
  check('axis clamped', fit.width <= 8192 && fit.height <= 8192, `${fit.width}x${fit.height}`);
  check('aspect still held', Math.abs(fit.width / fit.height - 10240 / 5760) < 0.001);

  // An ultrawide can breach one axis while sitting well under the area budget.
  const wide = fitToBudget(17000, 2000, { maxPixels: 64e6, maxDimension: 8192 });
  check('wide axis clamped', wide.width <= 8192, String(wide.width));
  check('wide short axis follows', wide.height < 2000, String(wide.height));
}

/* --------------------------------------------------- 5. degenerate input -- */
section('degenerate input never produces a zero-size target');
{
  for (const [w, h] of [
    [0, 0],
    [-5, 10],
    [NaN, 100],
    [1, 1],
  ]) {
    const fit = fitToBudget(w, h, BUDGET);
    check(`${w}x${h} stays positive`, fit.width >= 1 && fit.height >= 1, `${fit.width}x${fit.height}`);
  }
  // A budget smaller than one pixel must not floor a dimension to zero.
  const tiny = fitToBudget(1920, 1080, { maxPixels: 1, maxDimension: 16384 });
  check('tiny budget stays positive', tiny.width >= 1 && tiny.height >= 1);
  // No limits at all means no clamp — used by the harnesses and the
  // "no limit" menu entry.
  const free = fitToBudget(20000, 20000, {});
  check('no limits, no clamp', free.width === 20000 && free.height === 20000);
}

/* ------------------------------------------------ 6. budget sanitising --- */
section('sanitizePixelBudget');
{
  check('default for junk', sanitizePixelBudget('x') === DEFAULT_PIXEL_BUDGET);
  check('default for null', sanitizePixelBudget(null) === DEFAULT_PIXEL_BUDGET);
  check('default for zero', sanitizePixelBudget(0) === DEFAULT_PIXEL_BUDGET);
  check('default for negative', sanitizePixelBudget(-1) === DEFAULT_PIXEL_BUDGET);
  // Infinity is what JSON.stringify turns into null, so it must not be a
  // legal budget: a round-trip through localStorage would silently reset it.
  check('default for Infinity', sanitizePixelBudget(Infinity) === DEFAULT_PIXEL_BUDGET);
  check('floor enforced', sanitizePixelBudget(1) === MIN_PIXEL_BUDGET);
  check('honest value kept', sanitizePixelBudget(3686400) === 3686400);
  check('string coerced', sanitizePixelBudget('3686400') === 3686400);
  check('explicit fallback', sanitizePixelBudget(undefined, 100000) === 100000);
}

/* ------------------------------------- 7. monotonic in the window size --- */
section('a bigger window never yields a meaningfully smaller target');
{
  // Once the budget binds, the realised area saturates and then wobbles by a
  // few thousand pixels as floor() lands differently on each axis. That is
  // inherent to integer dimensions, so the property under test is "never drops
  // back below what a smaller window already got, beyond floor() jitter".
  const TOL = 1.001;
  let best = 0;
  for (let w = 1280; w <= 12000; w += 137) {
    const fit = fitToBudget(w, Math.round(w * 0.5625), BUDGET);
    const area = fit.width * fit.height;
    check(`monotonic at ${w}`, area * TOL >= best, `${area} vs best ${best}`);
    check(`budget held at ${w}`, area <= BUDGET.maxPixels, `${area}`);
    best = Math.max(best, area);
  }
  check('saturates at the budget', best >= BUDGET.maxPixels * 0.999, String(best));
}

console.log(failures === 0 ? '\nOK — resolution budget' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
