#!/usr/bin/env node
/**
 * Texture cost report for the procedural material stack.
 *
 * Two numbers per surface, both hardware-independent, both derived from the same
 * source of truth the engine uses (src/materials/library.js + the feature gates
 * in src/materials/shader.js -> extendMaterial):
 *
 *   FETCHES  texture samples the fragment shader issues per pixel, split into
 *            the near case (parallax marching, detail layer at full strength)
 *            and the far case (past parallaxFade[1] and the detail fade).
 *   VRAM     bytes the baked set occupies, per quality preset. Every map is
 *            RGBA8 with a full mip chain, so a set is 3 * s*s*4 * 4/3.
 *
 * Usage: node tools/texcost.mjs [--quality=low|medium|high]
 */
import { LIBRARY } from '../src/materials/library.js';
import { DEFAULT_PARAMS } from '../src/materials/shader.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

/** Mirrors MaterialSystem._quality. */
const QSCALE = { performance: 0.5, low: 0.5, medium: 0.75, high: 1, ultra: 1 };
/** Mirrors MaterialSystem._size(). */
const sizeFor = (base, q) => {
  const s = Math.max(128, Math.round((base * q) / 128) * 128);
  return 1 << Math.round(Math.log2(s));
};
const setBytes = (size, maps = 3) => maps * size * size * 4 * (4 / 3);
const MB = (b) => b / 1048576;

/**
 * Texture fetches per fragment, following MAIN_FRAGMENT in shader.js branch for
 * branch. `near` assumes the parallax march runs and the detail layer is inside
 * its fade; `far` assumes both have faded out.
 */
function fetches(p) {
  const tri = p.uvMode === 'triplanar';
  const parallax = p.parallax > 0 && !tri;
  const detile = p.detile > 0 && !tri;
  const weather = p.weather[0] > 0 || p.weather[1] > 0 || p.weather[2] > 0;
  const macroBig = (p.macroBig?.[1] ?? 0) > 0;
  const macroRelief = (p.macroRelief ?? 0) > 0;
  const cloth = (p.cloth?.[0] ?? 0) > 0 || (p.cloth?.[1] ?? 1) < 1;

  let near = 0;
  let far = 0;
  const parts = [];

  if (tri) {
    // 3 axes x (map, roughnessMap, normalMap)
    near += 9; far += 9; parts.push('triplanar x3 = 9');
    // detail projected on the dominant plane only: normal + albedo
    near += 2; parts.push('detail 2');
  } else {
    if (parallax) {
      // owPOM: one fetch before the loop, up to `nl` in it, one for `prev`.
      // nl = mix(parallaxLayers, 8, |vt.z|) — 8 head-on, parallaxLayers grazing.
      // Take the midpoint as the average over a surface.
      const nl = (p.parallaxLayers + 8) / 2;
      near += 2 + nl;
      parts.push(`POM ~${(2 + nl).toFixed(0)}`);
    }
    near += 3; far += 3; parts.push('base 3');
    if (detile) { near += 4; far += 4; parts.push('detile 4'); }
    near += 2; parts.push('detail 2');
  }

  near += 2; far += 2; parts.push('macro 2');
  if (macroBig) { near += 2; far += 2; parts.push('macroBig 2'); }
  if (macroRelief) { near += 2; far += 2; parts.push('macroRelief 2'); }
  if (weather) { near += 2; far += 2; parts.push('weather 2'); }
  if (cloth) { near += 3; far += 3; parts.push('cloth 3'); }

  return { near: Math.round(near), far: Math.round(far), parts };
}

const quality = args.quality ?? 'high';
const q = QSCALE[quality] ?? 1;

const rows = [];
for (const [name, def] of Object.entries(LIBRARY)) {
  const p = { ...DEFAULT_PARAMS, ...def.mat };
  const size = sizeFor(def.bake.size, q);
  const f = fetches(p);
  rows.push({ name, mode: p.uvMode, size, mb: MB(setBytes(size)), ...f });
}
rows.sort((a, b) => b.near - a.near);

const pad = (s, n) => String(s).padEnd(n);
console.log(`quality=${quality}  (texture scale ${q})\n`);
console.log(pad('surface', 17) + pad('mode', 11) + pad('bake', 7) + pad('VRAM', 9) + pad('near', 6) + pad('far', 6) + 'breakdown');
console.log('-'.repeat(110));
for (const r of rows) {
  console.log(
    pad(r.name, 17) + pad(r.mode, 11) + pad(`${r.size}px`, 7) +
    pad(`${r.mb.toFixed(1)} MB`, 9) + pad(r.near, 6) + pad(r.far, 6) + r.parts.join(' + ')
  );
}

const total = rows.reduce((s, r) => s + r.mb, 0);
// shared maps: detail is albedo+normal at 1024*q, macro is albedo only at 256
const detailMB = MB(setBytes(sizeFor(1024, q), 2));
const macroMB = MB(setBytes(256, 1));
console.log('-'.repeat(110));
console.log(`library sets      ${total.toFixed(1)} MB  (${rows.length} surfaces, one bake each)`);
console.log(`shared detail     ${detailMB.toFixed(1)} MB`);
console.log(`shared macro      ${macroMB.toFixed(1)} MB`);
console.log(`TOTAL (baseline)  ${(total + detailMB + macroMB).toFixed(1)} MB`);
console.log(
  '\nNote: subsystems that pass a `bake` override (src/weapons/materials.js does, 12 times)\n' +
  'get an ADDITIONAL set each, so the live figure is higher — see tools/_probe3.mjs.'
);
