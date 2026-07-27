/**
 * Objective visibility metrics. Pure functions over decoded PNG pixels — no
 * browser, no GPU, no wall clock. `tools/lib/selftest.mjs` drives them with
 * synthetic images.
 *
 * Everything is measured in DISPLAY space (post-tonemap, sRGB-encoded 0..255),
 * on purpose: "can the player see it" is a question about the pixels that reach
 * the monitor, not about scene radiance. `tools/probe.mjs` covers the HDR side.
 */

export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** RGBA buffer -> Float32Array of luma, one entry per pixel. */
export function lumaPlane({ width, height, data }) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; p++, i += 4)
    out[p] = luma(data[i], data[i + 1], data[i + 2]);
  return out;
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/** Sobel magnitude per pixel; a 1px border is left at 0. */
export function gradientPlane(L, width, height) {
  const g = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = L[i - width - 1], b = L[i - width], c = L[i - width + 1];
      const d = L[i - 1], f = L[i + 1];
      const h = L[i + width - 1], k = L[i + width], l = L[i + width + 1];
      const gx = a + 2 * d + h - (c + 2 * f + l);
      const gy = a + 2 * b + c - (h + 2 * k + l);
      g[i] = Math.hypot(gx, gy) * 0.25;
    }
  }
  return g;
}

/** Separable 1-4-1 gaussian, `passes` times. Radius grows ~1px per pass. */
export function blurPlane(L, width, height, passes = 1) {
  let a = Float32Array.from(L);
  const b = new Float32Array(L.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        b[i] = 0.25 * (x > 0 ? a[i - 1] : a[i]) + 0.5 * a[i] + 0.25 * (x < width - 1 ? a[i + 1] : a[i]);
      }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        a[i] = 0.25 * (y > 0 ? b[i - width] : b[i]) + 0.5 * b[i] + 0.25 * (y < height - 1 ? b[i + width] : b[i]);
      }
  }
  return a;
}

/** 3x3 box mean, clamped at the edges. */
function boxMean(L, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1);
      let s = 0, n = 0;
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) { s += L[yy * width + xx]; n++; }
      out[y * width + x] = s / n;
    }
  }
  return out;
}

/**
 * The per-image scorecard.
 *
 * - `microDetail`  energy in the finest spatial band, |L - gaussian(1px)|. This
 *                  is the resolution-legibility number: an upscaled buffer
 *                  cannot invent 1px features, so the band collapses. Measured
 *                  against the shipped presets it separates them cleanly
 *                  (0.53-0.65x of ultra at `performance`, 0.99x at `high`)
 *                  where `edgeEnergy` does not.
 * - `edgeEnergy`   mean Sobel magnitude. Kept as a secondary reading, NOT as a
 *                  gate: a tier with TAA off scores high on aliased edges, so
 *                  it rated `performance` at 0.72x of ultra while the image was
 *                  a 192x108 buffer stretched to 640x360.
 * - `detailPct`    share of pixels carrying a real edge. Same caveat.
 * - `crushPct`     share of pixels at or near black. Detail lost to the shadows.
 * - `clipPct`      share of pixels at or near white. Detail lost to the sky/sun.
 * - `shadowDetail` local contrast inside the darkest quartile, in 8-bit levels.
 *                  "Is there anything visible in the dark parts", numerically.
 * - `contrast`     p95 - p05 of luma: how much of the range the frame uses.
 */
export function imageMetrics(png) {
  const { width, height } = png;
  const L = lumaPlane(png);
  const G = gradientPlane(L, width, height);
  const M = boxMean(L, width, height);
  const B1 = blurPlane(L, width, height, 1);
  const n = L.length;

  let sum = 0, crush = 0, clip = 0, edgeSum = 0, detail = 0, micro = 0;
  for (let i = 0; i < n; i++) {
    const v = L[i];
    sum += v;
    if (v < 6) crush++;
    if (v > 250) clip++;
    edgeSum += G[i];
    if (G[i] > 12) detail++;
    micro += Math.abs(v - B1[i]);
  }
  const sorted = Float32Array.from(L).sort();
  const p25 = percentile(sorted, 0.25);

  let darkSum = 0, darkN = 0;
  for (let i = 0; i < n; i++)
    if (L[i] <= p25) { darkSum += Math.abs(L[i] - M[i]); darkN++; }

  const r2 = (v) => +v.toFixed(2);
  return {
    width,
    height,
    meanL: r2(sum / n),
    p05: r2(percentile(sorted, 0.05)),
    p50: r2(percentile(sorted, 0.5)),
    p95: r2(percentile(sorted, 0.95)),
    contrast: r2(percentile(sorted, 0.95) - percentile(sorted, 0.05)),
    crushPct: r2((100 * crush) / n),
    clipPct: r2((100 * clip) / n),
    microDetail: +(micro / n).toFixed(3),
    edgeEnergy: r2(edgeSum / n),
    detailPct: r2((100 * detail) / n),
    shadowDetail: r2(darkN ? darkSum / darkN : 0),
  };
}

/**
 * Enemy legibility, measured by difference rather than by guesswork.
 *
 * Capture the same frame twice — once normally, once with the AI root hidden —
 * and every pixel that moved IS an enemy. No bounding boxes to maintain, no
 * assumption about where the bots stand. For each silhouette we then compare it
 * against the ring of background just outside it, which is the contrast the
 * player's eye actually has to work with.
 *
 * `weber` = |Lblob - Lring| / Lring. Below ~0.1 a target reads as camouflage.
 */
export function diffMask(withPng, withoutPng, delta = 8) {
  const { width, height } = withPng;
  if (withoutPng.width !== width || withoutPng.height !== height)
    throw new Error('diffMask: image size mismatch');
  const a = withPng.data, b = withoutPng.data;
  const n = width * height;
  const mask = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4)
    if (
      Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2])
      ) > delta
    )
      mask[p] = 1;
  return { mask, width, height };
}

/**
 * Per-enemy legibility, scored inside the screen-space box the engine reports
 * for each actor.
 *
 * Blob labelling alone is not enough: an enemy fragments into a dozen pieces
 * behind a railing, and their own cast shadow is a separate blob with almost no
 * contrast. Asking the engine where each actor actually is removes both
 * problems, and lets a tier be compared against `ultra` ACTOR BY ACTOR — which
 * is the only way to catch "the guy at 60 m stopped resolving at this tier".
 *
 * `actors` come from the page: `{ id, distance, x0, y0, x1, y1 }` in pixels.
 */
export function actorLegibility(withPng, withoutPng, actors, { delta = 8, pad = 8, ring = 10 } = {}) {
  const { mask, width, height } = diffMask(withPng, withoutPng, delta);
  const L = lumaPlane(withPng);
  const out = [];
  for (const a of actors) {
    const x0 = Math.max(0, Math.floor(a.x0) - pad);
    const y0 = Math.max(0, Math.floor(a.y0) - pad);
    const x1 = Math.min(width - 1, Math.ceil(a.x1) + pad);
    const y1 = Math.min(height - 1, Math.ceil(a.y1) + pad);
    if (x1 <= x0 || y1 <= y0) {
      out.push({ id: a.id, distance: a.distance, px: 0, weber: 0, offscreen: true });
      continue;
    }
    let bodySum = 0, bodyN = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = y * width + x;
        if (mask[p]) { bodySum += L[p]; bodyN++; }
      }
    // Background ring just outside the actor box, ignoring any other silhouette.
    const rx0 = Math.max(0, x0 - ring), ry0 = Math.max(0, y0 - ring);
    const rx1 = Math.min(width - 1, x1 + ring), ry1 = Math.min(height - 1, y1 + ring);
    let ringSum = 0, ringN = 0;
    for (let y = ry0; y <= ry1; y++)
      for (let x = rx0; x <= rx1; x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        const p = y * width + x;
        if (!mask[p]) { ringSum += L[p]; ringN++; }
      }
    const bodyL = bodyN ? bodySum / bodyN : 0;
    const ringL = ringN ? ringSum / ringN : 0;
    out.push({
      id: a.id,
      distance: +(a.distance ?? 0).toFixed(1),
      boxPx: (x1 - x0 + 1) * (y1 - y0 + 1),
      px: bodyN,
      bodyL: +bodyL.toFixed(1),
      ringL: +ringL.toFixed(1),
      weber: bodyN ? +(Math.abs(bodyL - ringL) / Math.max(ringL, 1)).toFixed(3) : 0,
    });
  }
  const visible = out.filter((a) => a.px > 0);
  return {
    actors: out,
    total: out.length,
    visible: visible.length,
    minWeber: visible.length ? Math.min(...visible.map((a) => a.weber)) : 0,
    minPx: visible.length ? Math.min(...visible.map((a) => a.px)) : 0,
  };
}

export function silhouetteMetrics(withPng, withoutPng, { minBlobPx = 24, delta = 8, ring = 6 } = {}) {
  const { width, height } = withPng;
  if (withoutPng.width !== width || withoutPng.height !== height)
    throw new Error('silhouetteMetrics: image size mismatch');
  const a = withPng.data, b = withoutPng.data;
  const n = width * height;
  const mask = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const d = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2])
    );
    if (d > delta) mask[p] = 1;
  }

  const La = lumaPlane(withPng);
  const seen = new Uint8Array(n);
  const blobs = [];
  const stack = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const px = [];
    while (stack.length) {
      const p = stack.pop();
      px.push(p);
      const x = p % width, y = (p / width) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < width - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - width] && !seen[p - width]) { seen[p - width] = 1; stack.push(p - width); }
      if (y < height - 1 && mask[p + width] && !seen[p + width]) { seen[p + width] = 1; stack.push(p + width); }
    }
    if (px.length < minBlobPx) continue;

    let blobSum = 0, cx = 0, cy = 0;
    for (const p of px) { blobSum += La[p]; cx += p % width; cy += (p / width) | 0; }

    // Background ring: everything within `ring` px of the blob that is not
    // itself part of any silhouette.
    const ringSet = new Set();
    for (const p of px) {
      const x = p % width, y = (p / width) | 0;
      for (let dy = -ring; dy <= ring; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -ring; dx <= ring; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (!mask[q]) ringSet.add(q);
        }
      }
    }
    let ringSum = 0;
    for (const q of ringSet) ringSum += La[q];
    const blobL = blobSum / px.length;
    const ringL = ringSet.size ? ringSum / ringSet.size : 0;
    const r2 = (v) => +v.toFixed(3);
    blobs.push({
      px: px.length,
      x: Math.round(cx / px.length),
      y: Math.round(cy / px.length),
      blobL: +blobL.toFixed(1),
      ringL: +ringL.toFixed(1),
      weber: r2(Math.abs(blobL - ringL) / Math.max(ringL, 1)),
      michelson: r2(Math.abs(blobL - ringL) / Math.max(blobL + ringL, 1)),
    });
  }

  blobs.sort((x, y) => y.px - x.px);
  const webers = blobs.map((x) => x.weber).sort((p, q) => p - q);
  return {
    count: blobs.length,
    movedPct: +((100 * mask.reduce((s, v) => s + v, 0)) / n).toFixed(3),
    minWeber: webers.length ? webers[0] : 0,
    medianWeber: webers.length ? webers[(webers.length / 2) | 0] : 0,
    smallestPx: blobs.length ? blobs[blobs.length - 1].px : 0,
    largestPx: blobs.length ? blobs[0].px : 0,
    blobs,
  };
}
