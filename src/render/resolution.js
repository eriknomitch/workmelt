/**
 * The one absolute ceiling on how many pixels this renderer will ever allocate.
 *
 * Everything else in the resolution chain is a RATIO — `renderScale` is a
 * fraction of the backbuffer, `pixelRatioCap` is a ceiling on devicePixelRatio.
 * Ratios cannot bound anything, because the thing they multiply (the window)
 * has no upper bound: the same settings that ask for 2.1 MP on a laptop ask for
 * 14.7 MP on a 5K panel and 33 MP on an 8K one, and the render-target set costs
 * roughly 160 MB per megapixel at `high`. That is 0.33 GB, 2.3 GB and 5.2 GB of
 * the same targets, from one unchanged profile.
 *
 * So the budget is expressed as an AREA, in pixels, and enforced here.
 *
 * Two rules make it safe to apply anywhere in the chain:
 *
 *   • **Area, not width x height.** A 32:9 ultrawide (7.4 MP) and a 16:9 4K
 *     panel (8.3 MP) are then treated on the same footing, and no aspect ratio
 *     is singled out for being unusual.
 *   • **One factor, both axes.** Clamping the axes independently would change
 *     the aspect ratio, and the aspect ratio is the field of view. Scaling both
 *     by the same number keeps the frame geometrically identical and merely
 *     softer, which is the trade every shipped resolution scaler makes.
 */

/** Below this the frame stops being a frame. Also the floor for a panic drop. */
export const MIN_PIXEL_BUDGET = 262144; // 512x512 worth of pixels

/** 3840x2160 worth of pixels. Not "4K" — a 21:9 window spends it differently. */
export const DEFAULT_PIXEL_BUDGET = 8294400;

/**
 * Shrink `width x height` until it fits both limits, preserving aspect exactly.
 *
 * @param {number} width
 * @param {number} height
 * @param {{ maxPixels?: number, maxDimension?: number }} limits
 *   `maxPixels` is the area budget. `maxDimension` is the device's hard
 *   per-axis limit (`MAX_TEXTURE_SIZE` / `MAX_RENDERBUFFER_SIZE`); exceeding it
 *   is not slow, it is an incomplete framebuffer and a black screen.
 * @returns {{ width: number, height: number, scale: number }} `scale` is 1 when
 *   nothing bound, so callers can report whether the budget is in play.
 */
export function fitToBudget(width, height, { maxPixels, maxDimension } = {}) {
  const w = Math.max(1, Math.floor(width) || 1);
  const h = Math.max(1, Math.floor(height) || 1);

  let k = 1;
  if (Number.isFinite(maxPixels) && maxPixels > 0 && w * h > maxPixels) {
    k = Math.sqrt(maxPixels / (w * h));
  }
  if (Number.isFinite(maxDimension) && maxDimension > 0) {
    k = Math.min(k, maxDimension / w, maxDimension / h);
  }
  if (k >= 1) return { width: w, height: h, scale: 1 };

  return {
    // Floor, never round: rounding up can put a dimension back over
    // `maxDimension`, which is the one limit that fails hard rather than slowly.
    width: Math.max(1, Math.floor(w * k)),
    height: Math.max(1, Math.floor(h * k)),
    scale: k,
  };
}

/** Clamp a requested budget into something this renderer will honour. */
export function sanitizePixelBudget(value, fallback = DEFAULT_PIXEL_BUDGET) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(MIN_PIXEL_BUDGET, Math.floor(n));
}
