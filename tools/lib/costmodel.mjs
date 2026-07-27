/**
 * The GPU-workload model used by tools/cost.mjs.
 *
 * It answers "how much work does this tier ask the GPU for, relative to another
 * tier", from quantities that can be read out of the engine on a machine with no
 * GPU at all. It does NOT predict frames per second and must never be used as
 * though it does — every criterion built on it is a ratio between tiers.
 *
 * Weights are relative to one cheap full-screen pass over the internal buffer.
 * `main` is heavy because it is the lit geometry pass, not a blit.
 */
export const PASS_WEIGHT = {
  main: 3.0,
  prepass: 1.0,
  taa: 1.0,
  gtao: 1.5,
  ssr: 2.0,
  volumetrics: 1.5,
  motionBlur: 0.8,
  bloom: 1.2,
  composite: 0.6,
};
export const SHADOW_TEXEL_WEIGHT = 0.45; // per megatexel, depth-only
export const TRI_WEIGHT = 0.6; // per million triangles
export const CALL_WEIGHT = 1.0; // per thousand draw calls

export function costIndex({ internalMP, q, calls, tris }) {
  let passes = PASS_WEIGHT.main + PASS_WEIGHT.composite;
  if (q.prepass) passes += PASS_WEIGHT.prepass;
  if (q.taa) passes += PASS_WEIGHT.taa;
  if (q.gtao) passes += PASS_WEIGHT.gtao;
  if (q.ssr) passes += PASS_WEIGHT.ssr;
  if (q.volumetrics) passes += PASS_WEIGHT.volumetrics;
  if (q.motionBlur) passes += PASS_WEIGHT.motionBlur;
  if (q.bloom) passes += PASS_WEIGHT.bloom;
  const shadowMTexels = q.shadows ? (q.cascades * q.shadowMapSize * q.shadowMapSize) / 1e6 : 0;
  const pixelCost = internalMP * passes;
  const shadowCost = shadowMTexels * SHADOW_TEXEL_WEIGHT;
  const geomCost = (tris / 1e6) * TRI_WEIGHT + (calls / 1000) * CALL_WEIGHT;
  const r3 = (v) => +v.toFixed(3);
  return {
    passWeight: +passes.toFixed(2),
    shadowMTexels: +shadowMTexels.toFixed(2),
    pixelCost: r3(pixelCost),
    shadowCost: r3(shadowCost),
    geomCost: r3(geomCost),
    costIndex: r3(pixelCost + shadowCost + geomCost),
  };
}
