/**
 * Architectural surfaces: concrete, brick, plaster, stucco, ceramic tile.
 *
 * Every surface implements:
 *   void owSurface(vec2 uv, out vec3 alb, out float h, out float rough,
 *                  out float metal, out float ao)
 * 'uv' is [0,1) across the tile, 'h' is 0..1 (0.5 ≈ the nominal surface plane),
 * 'alb' is LINEAR albedo (authored via owSRGB() so the numbers read like paint
 * swatches), and 'ao' is a baked cavity term, not a lighting term.
 *
 * uSeed shifts the noise lattice so two variants of the same surface never
 * line up. Shifting the argument of a periodic function keeps it periodic.
 */

export const CONCRETE = /* glsl */ `
void owSurface(vec2 uv, out vec3 alb, out float h, out float rough, out float metal, out float ao){
  const vec2 P = vec2(8.0);
  vec2 p = uv * P + uSeed * 13.7;

  // ---- base tone: pour variation, wet/dry patches, cement bloom ----
  float macro = owFbm01(p * 0.5, P * 0.5, 4, 0.58);
  float mid   = owFbm01(owWarp(p * 2.0, P * 2.0, 0.7, 3), P * 2.0, 5, 0.5);
  float fine  = owFbm01(p * 18.0, P * 18.0, 4, 0.5);
  float micro = owFbm01(p * 26.0, P * 26.0, 3, 0.5);

  vec3 cLight = owSRGB(vec3(0.520, 0.512, 0.492));
  vec3 cMid   = owSRGB(vec3(0.395, 0.392, 0.385));
  vec3 cDark  = owSRGB(vec3(0.255, 0.253, 0.258));
  vec3 c = mix(cMid, cLight, smoothstep(0.35, 0.85, macro));
  c = mix(c, cDark, smoothstep(0.55, 0.95, mid) * 0.55);
  c *= 0.93 + 0.14 * fine;
  // The 0.1-1 m band — see the long note in PLASTER. Pour blotching and the
  // wash of dirt that runs over any concrete left outdoors.
  // contrast-expanded: see the note in PLASTER
  float pourB = owFbm01(owWarp(p * 1.5 + 8.3, P * 1.5, 0.6, 3), P * 1.5, 4, 0.58);
  pourB = clamp((pourB - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  c *= 0.82 + 0.38 * pourB;
  float wash = owFbm01(p * 7.0 + 2.0, P * 7.0, 4, 0.5);
  wash = clamp((wash - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  c *= 0.925 + 0.155 * wash;

  h = 0.62 + (fine - 0.5) * 0.035 + (mid - 0.5) * 0.05;
  rough = 0.70 + (mid - 0.5) * 0.16 + (micro - 0.5) * 0.07;
  ao = 1.0;
  metal = 0.0;

  // ---- exposed aggregate: stone chips sitting just under the skin ----
  vec4 agg = owWorley(p * 13.0, P * 13.0, 0.95);
  float aggShape = smoothstep(0.46, 0.10, agg.x);
  float aggRnd = agg.z;
  // Only some chips break the surface.
  float aggExposed = aggShape * step(0.74, owFbm01(p * 3.0 + 5.0, P * 3.0, 3, 0.5) + aggRnd * 0.35);
  h += aggExposed * 0.022 * (0.5 + aggRnd);
  c = mix(c, mix(owSRGB(vec3(0.335, 0.320, 0.300)), owSRGB(vec3(0.560, 0.545, 0.505)), aggRnd), aggExposed * 0.7);
  rough += aggExposed * 0.07 * (aggRnd - 0.5);

  // ---- coarse sand fraction: the 5-8 mm grit of the cement skin ----
  // The 0.5-2 mm tooth is NOT authored here. At 2.5 m over a 1024 bake one
  // texel is 2.4 mm, so a 1 mm grain is a sub-texel hash: it bakes as white
  // noise, dithers at mip 0 and is gone by mip 1. That band belongs to the
  // shared detail map, which is tiled ten times finer. What lives here is the
  // grit you can actually resolve, at real amplitude.
  vec4 sand = owWorley(p * 20.0, P * 20.0, 1.0);
  float sandM = smoothstep(0.44, 0.05, sand.x);
  float sandSel = 0.40 + 0.60 * step(0.30, sand.z);
  h += sandM * sandSel * 0.028;
  c *= 1.0 + (sandM * sandSel - 0.20) * 0.15;
  rough += (sand.z - 0.5) * 0.11 + sandM * 0.04;
  ao -= sandM * 0.06;
  float sandTrough = smoothstep(0.52, 0.88, sand.x);
  c = mix(c, c * 0.86, sandTrough * 0.34);

  // ---- air pockets / bug holes from the pour ----
  vec4 pores = owWorley(p * 22.0, P * 22.0, 1.0);
  float pore = smoothstep(0.26, 0.0, pores.x) * step(0.84, pores.w);
  h -= pore * 0.055;
  ao -= pore * 0.55;
  rough += pore * 0.10;

  // uParam.x = board-formed wall (1) vs poured slab (0)
  // uParam.y = saw-cut control joints, for floors
  float formAmt = uParam.x;
  float jointAmt = uParam.y;

  // ---- formwork: horizontal board lines + tie-rod holes ----
  float boards = uv.y * 4.0;
  float bi = floor(boards);
  float bf = fract(boards);
  float seam = (1.0 - smoothstep(0.0, 0.030, bf)) + (1.0 - smoothstep(0.0, 0.030, 1.0 - bf));
  seam = clamp(seam, 0.0, 1.0);
  // Boards are never perfectly aligned: each course steps a fraction of a mm.
  float boardStep = (owHash11(bi + uSeed) - 0.5) * 0.028 * formAmt;
  h += boardStep;
  h -= seam * 0.055 * formAmt;
  ao -= seam * 0.40 * formAmt;
  c *= 1.0 - seam * 0.16 * formAmt;
  // cement bled along the seam and set lighter
  float bleed = (1.0 - smoothstep(0.0, 0.10, abs(bf - 0.02))) * 0.5 * formAmt;
  c = mix(c, cLight * 1.05, bleed * 0.35 * owFbm01(p * 8.0, P * 8.0, 3, 0.5));

  // tie holes, plugged, one every other board
  vec2 tf = fract(vec2(uv.x * 3.0, boards * 0.5)) - 0.5;
  float tieRnd = owHash12(floor(vec2(uv.x * 3.0, boards * 0.5)) + uSeed);
  float tie = smoothstep(0.085, 0.05, length(tf * vec2(1.0, 2.0))) * step(0.45, tieRnd) * formAmt;
  h -= tie * 0.10;
  ao -= tie * 0.5;
  c = mix(c, cDark * 0.85, tie * 0.6);

  // ---- saw-cut control joints (slabs) + power-float polish ----
  vec2 jd = abs(fract(uv + 0.5) - 0.5);
  float joint = max(1.0 - smoothstep(0.0035, 0.010, jd.x), 1.0 - smoothstep(0.0035, 0.010, jd.y));
  joint *= jointAmt;
  h -= joint * 0.10;
  ao -= joint * 0.55;
  c = mix(c, cDark * 0.62, joint * 0.65);
  // trowel arcs left by the power float
  float swirl = owFbm01(owWarp(p * 1.1 + 3.0, P * 1.1, 1.4, 3), P * 1.1, 3, 0.6);
  rough -= jointAmt * smoothstep(0.35, 0.85, swirl) * 0.10;
  c *= 1.0 - jointAmt * smoothstep(0.4, 0.9, swirl) * 0.07;

  // ---- structural cracks: branch from the seams and corners ----
  float crk = owCracks(p * 2.6, P * 2.6, 0.85, 0.028, 0.50);
  float crkFine = owCracks(p * 7.0 + 31.0, P * 7.0, 0.9, 0.020, 0.60) * 0.55;
  float crack = clamp(crk + crkFine, 0.0, 1.0);
  h -= crack * 0.12;
  ao -= crack * 0.45;
  c = mix(c, cDark * 0.80, crack * 0.42);
  rough += crack * 0.12;

  // ---- spalling: a chunk of the skin has broken off, aggregate showing ----
  vec4 sp = owWorley(p * 1.1 + 7.3, P * 1.1, 0.9);
  float spallCell = step(0.90, sp.w);
  float spall = spallCell * smoothstep(0.44, 0.16, sp.x) *
                smoothstep(0.42, 0.62, owFbm01(p * 4.0 + 2.0, P * 4.0, 4, 0.5));
  h -= spall * 0.13;
  ao -= spall * 0.35;
  c = mix(c, mix(cDark, cMid, aggRnd) * 0.88, spall * 0.8);
  rough += spall * 0.10;
  // rim of the spall catches light
  float spallRim = spall * (1.0 - spall) * 4.0;
  c *= 1.0 + spallRim * 0.10;

  // ---- small chips: 2-5 cm bites out of the skin showing darker, wetter
  //      concrete plus the sand fraction underneath (~3% of the surface) ----
  vec4 ck = owWorley(owWarp(p * 5.6 + 19.0, P * 5.6, 0.6, 3), P * 5.6, 0.95);
  float ckSel = step(0.90, ck.w);
  float ckSize = 0.20 + 0.16 * ck.z;
  float ckShape = smoothstep(ckSize, ckSize * 0.3,
                             ck.x * (0.72 + 0.56 * owFbm01(p * 16.0, P * 16.0, 3, 0.5)));
  float chip = ckSel * ckShape;
  c = mix(c, mix(c * 0.74, mix(cDark, cMid, sand.z), 0.5), chip * 0.85);
  h -= chip * 0.045;
  ao -= chip * 0.24;
  rough += chip * 0.08;
  float ckLip = max(ckSel * (smoothstep(ckSize * 1.25, ckSize, ck.x) - ckShape), 0.0);
  c *= 1.0 + ckLip * 0.10;

  // ---- staining: rain runoff, soot, rust bleed from rebar ----
  // Only ~3:1 stretched and shallow: the long runs come from the runtime
  // weather layer, which knows where the sills and ledges are. A 10:1 stretch
  // baked into the tile at full strength just reads as wood veneer.
  float streak = owFbm01(vec2(p.x * 6.0, p.y * 2.0), vec2(P.x * 6.0, P.y * 2.0), 5, 0.55);
  float runoff = smoothstep(0.58, 0.95, streak) * (0.35 + 0.65 * smoothstep(0.2, 0.8, macro));
  c *= 1.0 - runoff * 0.14;
  rough += runoff * 0.05;

  float rustBleed = smoothstep(0.72, 0.98, streak * (0.6 + 0.5 * tieRnd)) * step(0.80, tieRnd);
  c = mix(c, owSRGB(vec3(0.42, 0.24, 0.12)), rustBleed * 0.45);

  // dirt collects in every recess
  float cavity = 1.0 - smoothstep(0.42, 0.66, h);
  c = mix(c, owSRGB(vec3(0.20, 0.19, 0.17)), cavity * 0.35);

  alb = clamp(c, vec3(0.02), vec3(0.85));
  rough = clamp(rough, 0.48, 0.98);
  ao = clamp(ao, 0.15, 1.0);
  h = clamp(h, 0.0, 1.0);
}
`;

export const BRICK = /* glsl */ `
void owSurface(vec2 uv, out vec3 alb, out float h, out float rough, out float metal, out float ao){
  const vec2 P = vec2(8.0);
  const float COLS = 6.0;     // bricks across the tile
  const float ROWS = 18.0;    // courses up the tile
  vec2 p = uv * P + uSeed * 9.1;

  // ---------------- brick lattice, running bond ----------------
  float rowF = uv.y * ROWS;
  float row = floor(rowF);
  float colF = uv.x * COLS + mod(row, 2.0) * 0.5;
  float col = floor(colF);
  vec2 id = vec2(mod(col, COLS), row);
  vec2 f = vec2(fract(colF), fract(rowF));

  vec4 rnd = owHash42(id + uSeed * 3.0);
  vec4 rnd2 = owHash42(id * 1.37 + 21.0 + uSeed);
  vec4 rnd3 = owHash42(id * 0.73 + 7.7 + uSeed * 1.9);

  // Bricks are laid by hand: each one is a hair off square.
  vec2 jitter = (rnd.xy - 0.5) * vec2(0.012, 0.030);
  vec2 fj = f + jitter;

  // joint thickness (10mm of a 225mm x 75mm course). The joint is *raked*: a
  // flat mortar bed with a hard arris at the brick edge. Ramping across the
  // whole joint width is what makes mortar read as a painted line.
  const float JX = 0.048, JY = 0.135;
  float dxj = min(fj.x, 1.0 - fj.x);
  float dyj = min(fj.y, 1.0 - fj.y);
  float shoulder = 0.74 + 0.16 * rnd3.w;    // some joints struck flush, some sharp
  float ex = smoothstep(JX * shoulder, JX * 1.02, dxj);
  float ey = smoothstep(JY * shoulder, JY * 1.02, dyj);
  float face = min(ex, ey);                 // 1 = brick face, 0 = mortar

  // per-brick surface coords so the face texture never repeats
  vec2 bp = vec2(fj.x, fj.y) * vec2(3.0, 1.0) + rnd.zw * 17.0;
  vec2 BP = vec2(24.0);

  // ---------------- mortar ----------------
  float mSand = owFbm01(p * 20.0, P * 20.0, 4, 0.5);
  vec4 mGrain = owWorley(p * 24.0, P * 24.0, 1.0);
  float mortarRough = owFbm01(p * 20.0, P * 20.0, 4, 0.55);
  vec3 mortarCol = mix(owSRGB(vec3(0.400, 0.388, 0.362)), owSRGB(vec3(0.278, 0.272, 0.260)),
                       smoothstep(0.3, 0.8, mortarRough));
  mortarCol *= 0.84 + 0.32 * mSand;
  mortarCol *= 0.88 + 0.24 * owFbm01(p * 6.0, P * 6.0, 4, 0.6);
  mortarCol = mix(mortarCol, owSRGB(vec3(0.235, 0.228, 0.215)), smoothstep(0.5, 0.06, mGrain.x) * 0.40);
  mortarCol = mix(mortarCol, owSRGB(vec3(0.520, 0.505, 0.470)), smoothstep(0.30, 0.02, owWorley(p * 25.0 + 4.0, P * 25.0, 1.0).x) * 0.35);

  // some joints are struck flush, some are raked deep, some crumbled out.
  // 0.10-0.15 of a 0.055 m relief = 5-8 mm of real recess.
  float jointDepth = 0.10 + 0.05 * owFbm01(p * 1.2, P * 1.2, 3, 0.5);
  float crumble = smoothstep(0.62, 0.86, owFbm01(p * 9.0 + 4.0, P * 9.0, 4, 0.5));
  jointDepth += crumble * 0.09;
  // the mortar bed itself is not flat — it holds the trowel's sand texture
  float mortarH = -(mSand - 0.5) * 0.018 - smoothstep(0.5, 0.0, mGrain.x) * 0.012;

  // ---------------- brick face ----------------
  float faceN = owFbm01(bp * 2.2, BP, 5, 0.5);
  float faceFine = owFbm01(bp * 5.0, BP * 2.0, 4, 0.5);
  vec4 facePore = owWorley(bp * 7.0, BP * 3.5, 1.0);
  // Pits cluster instead of forming an even dot grid, and their size varies.
  float poreCluster = smoothstep(0.42, 0.78, owFbm01(bp * 3.0 + 8.0, BP * 1.5, 4, 0.55));
  float pore = smoothstep(0.26 + 0.16 * facePore.z, 0.0, facePore.x) * step(0.55, facePore.w) * poreCluster;

  // Colour families: red stock, dark burnt header, pale sand-lime, brown.
  vec3 cA = owSRGB(vec3(0.430, 0.238, 0.183));   // red stock
  vec3 cB = owSRGB(vec3(0.318, 0.183, 0.150));   // deep red
  vec3 cC = owSRGB(vec3(0.196, 0.132, 0.120));   // burnt header
  vec3 cD = owSRGB(vec3(0.492, 0.392, 0.300));   // sandy
  vec3 cE = owSRGB(vec3(0.372, 0.288, 0.218));   // brown

  vec3 brick = mix(cA, cB, rnd.z);
  brick = mix(brick, cC, step(0.90, rnd.w) * 0.70);
  brick = mix(brick, cD, step(0.94, rnd2.x) * 0.62);
  brick = mix(brick, cE, step(0.55, rnd2.y) * 0.50);
  // every brick came out of the kiln a different shade: +/-12% per brick
  brick *= 0.88 + 0.24 * rnd3.x;
  // within-brick banding from the extrusion
  brick *= 0.86 + 0.28 * faceN;
  // fine sand grain across the face — this is what reads at 0.5 m
  // bp is per-brick, and a brick is only ~170 texels wide, so bp*26 was 78
  // cycles across it — 2.2 texels a cycle. This is the band that has to still
  // be there at 0.5 m, so it is authored at 7 texels and given more contrast.
  float faceGrain = owFbm01(bp * 8.0, BP * 4.0, 4, 0.55);
  brick *= 0.87 + 0.26 * faceGrain;
  brick = mix(brick, brick * 1.22, smoothstep(0.55, 0.9, faceFine) * 0.5);
  // dark iron spots and sand inclusions
  brick = mix(brick, brick * 0.62, pore * 0.85);
  brick = mix(brick, brick * 0.72, smoothstep(0.34, 0.0, facePore.x) * step(0.86, facePore.z));
  brick = mix(brick, owSRGB(vec3(0.62, 0.58, 0.50)), smoothstep(0.86, 0.98, faceFine) * 0.35);

  float faceH = 0.72 + (faceN - 0.5) * 0.05 + (faceFine - 0.5) * 0.025
              + (rnd2.z - 0.5) * 0.05;               // each brick sits proud/shy
  faceH -= pore * 0.075;

  // Broken arrises: ~5% of the edge length is knocked off, deep enough to
  // catch a shadow, showing pale raw clay under the fired skin.
  float edgeD = min(dxj / JX, dyj / JY);
  float chipNoise = owFbm01(bp * 6.0 + 3.0, BP * 3.0, 4, 0.5);
  float chip = smoothstep(1.7, 0.30, edgeD) * smoothstep(0.60, 0.80, chipNoise) * step(0.66, rnd3.z);
  faceH -= chip * 0.17;
  brick = mix(brick, brick * 0.72 + owSRGB(vec3(0.20, 0.13, 0.09)), chip * 0.65);

  // ---------------- combine face + mortar ----------------
  // face is already a shaped profile, so no second smoothstep here: that is
  // what used to smear the arris across the full joint width.
  float m = face;
  h = mix(0.72 - jointDepth + mortarH, faceH, m);
  vec3 c = mix(mortarCol, brick, m);
  // every brick came out of the kiln with a slightly different skin
  float brickRough = 0.58 + 0.32 * rnd2.z + (rnd3.y - 0.5) * 0.20;
  rough = mix(0.88 + 0.10 * mSand + 0.06 * (mortarRough - 0.5),
              brickRough + 0.14 * faceN + 0.10 * (faceGrain - 0.5) + chip * 0.14, m);
  ao = mix(0.34, 1.0, smoothstep(0.0, 0.75, face));
  ao -= chip * 0.30;
  metal = 0.0;

  // mortar smeared over the brick edge by the trowel
  float smear = smoothstep(0.5, 1.0, 1.0 - face) * smoothstep(0.55, 0.9, owFbm01(p * 14.0, P * 14.0, 4, 0.5));
  c = mix(c, mortarCol * 1.05, smear * 0.5);

  // ---------------- weathering over the whole wall ----------------
  // The 0.1-1 m band — see the long note in PLASTER.
  float soilB = owFbm01(owWarp(p * 1.8 + 27.0, P * 1.8, 0.6, 3), P * 1.8, 4, 0.58);
  soilB = clamp((soilB - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  c *= 0.845 + 0.33 * soilB;

  // efflorescence: salt bloom, strongest around joints
  float efflo = smoothstep(0.62, 0.96, owFbm01(owWarp(p * 2.6, P * 2.6, 0.8, 3), P * 2.6, 4, 0.5));
  efflo *= mix(1.0, 0.35, m);
  c = mix(c, owSRGB(vec3(0.66, 0.652, 0.632)), efflo * 0.5);
  rough += efflo * 0.10;

  // soot / rain runoff — short, shallow and only ~3:1 stretched; the long runs
  // are added at runtime where a real ledge sheds water.
  float streak = owFbm01(vec2(p.x * 7.0, p.y * 2.3), vec2(P.x * 7.0, P.y * 2.0), 5, 0.55);
  float runoff = smoothstep(0.50, 0.92, streak);
  c *= 1.0 - runoff * 0.16;

  // hairline cracks stepping through the joints
  float crack = owCracks(p * 2.2, P * 2.2, 0.85, 0.038, 0.58);
  h -= crack * 0.10;
  ao -= crack * 0.45;
  c = mix(c, c * 0.35, crack * 0.7);

  // dirt in every crevice
  float cavity = 1.0 - smoothstep(0.50, 0.74, h);
  c = mix(c, owSRGB(vec3(0.16, 0.15, 0.14)), cavity * 0.32);

  // ---------------- limewash (uParam.x = coat opacity) ----------------
  // A LIMEWASHED WALL IS NOT A WHITE-CLAY WALL. The coat is a thin mineral
  // slurry brushed onto a finished wall, so it belongs HERE — over the brick,
  // the mortar, the efflorescence and the runoff — rather than in the kiln
  // colours above. Everything underneath survives in the relief and in what
  // shows through, which is precisely what a photograph of one looks like:
  // white, and unmistakably still brick.
  //
  // Three things stop it reading as flat paint, and all three are visible on
  // the real house:
  //   brushed   the coat is thin where the brush dragged, so the wall is
  //             blotchy at ~1 m rather than uniform
  //   wear      it wears off what stands proud first, so arrises and chipped
  //             corners go pink where the clay comes back through
  //   joints    it pools in the recessed joints and holds there, which keeps
  //             the coursing legible instead of burying it
  if (uParam.x > 0.001) {
    float brushed = owFbm01(owWarp(p * 3.4 + 12.0, P * 3.4, 0.6, 3), P * 3.4, 4, 0.55);
    float thin = smoothstep(0.24, 0.90, brushed);
    float worn = clamp(smoothstep(0.63, 0.92, h) * 0.5 + chip * 0.85, 0.0, 0.8);
    // 0.48, not the 0.32 this started at: at a third the coat never dropped
    // below ~0.68 anywhere, so the densest passages went fully opaque and the
    // wall came back an even, synthetic white. The house is visibly blotchy —
    // the brush leaves the clay showing through in patches, and that mottle is
    // most of what says "limewash" rather than "painted render" at 3 m.
    float coat = uParam.x * (1.0 - thin * 0.48) * (1.0 - worn);
    // the wash sits a shade cooler and denser down in the joints than on the
    // brick faces, which is the whole reason the coursing survives the coat
    vec3 washCol = owSRGB(vec3(0.895, 0.880, 0.836));
    washCol = mix(washCol * 0.93, washCol, m);
    c = mix(c, washCol, clamp(coat, 0.0, 1.0));
    // limewash is chalk: flat matte, and flatter than the brick it covers
    rough = mix(rough, 0.95, uParam.x * 0.75);
  }

  alb = clamp(c, vec3(0.02), vec3(0.85));
  rough = clamp(rough, 0.35, 0.99);
  ao = clamp(ao, 0.12, 1.0);
  h = clamp(h, 0.0, 1.0);
}
`;

export const PLASTER = /* glsl */ `
void owSurface(vec2 uv, out vec3 alb, out float h, out float rough, out float metal, out float ao){
  const vec2 P = vec2(8.0);
  vec2 p = uv * P + uSeed * 5.3;

  // trowel: broad sweeps, anisotropic, with a fine skim on top
  vec2 sw = owShear(p * 1.5, 1.0, 3.0);
  float trowel = owFbm01(sw, owShearPer(P * 1.5, 3.0), 5, 0.55);
  float skim   = owFbm01(p * 12.0, P * 12.0, 5, 0.5);
  float micro  = owFbm01(p * 24.0, P * 24.0, 3, 0.5);
  float macro  = owFbm01(p * 0.6, P * 0.6, 3, 0.6);

  vec3 cBase = owSRGB(vec3(0.598, 0.578, 0.538));
  vec3 cWarm = owSRGB(vec3(0.512, 0.462, 0.395));
  vec3 cGrey = owSRGB(vec3(0.382, 0.378, 0.372));
  vec3 c = mix(cBase, cWarm, smoothstep(0.3, 0.8, macro));
  c *= 0.94 + 0.12 * skim;
  c = mix(c, cGrey, smoothstep(0.45, 0.95, trowel) * 0.42);
  c = mix(c, cBase * 1.10, smoothstep(0.55, 0.15, trowel) * 0.30);

  h = 0.70 + (trowel - 0.5) * 0.10 + (skim - 0.5) * 0.030 + (micro - 0.5) * 0.012;
  rough = 0.80 + (skim - 0.5) * 0.12 - smoothstep(0.5, 0.9, trowel) * 0.10;
  ao = 1.0;
  metal = 0.0;

  // ---- skim-coat laps ------------------------------------------------------
  // A plasterer works the wall in ~40 cm passes, and every pass sets a hair
  // lighter or darker than the one before with a faint arris where the trowel
  // lifted off. This is the mid-frequency signal that separates plaster from
  // paint at 2-5 m — without it the wall is one value plus a sprinkle of specks.
  vec2 lapUv = owShear(p * 0.7, 1.0, 1.0);
  float lapF = lapUv.y + owFbm01(p * 1.1, P * 1.1, 3, 0.6) * 1.4;
  float lapI = floor(lapF);
  float lapT = fract(lapF);
  float lapR = owHash11(lapI * 1.71 + uSeed * 2.3);
  c *= 0.885 + 0.240 * lapR;
  rough += (lapR - 0.5) * 0.10;

  /**
   * THE 0.1-1 m BAND. A wall seen from 2-3 m fills the frame with about half a
   * metre of itself, which is a hole in the frequency budget: the macro layer
   * varies over 4-12 m and the detail map over 10 mm, so between them the
   * surface has nothing and measures a standard deviation of 5 over a
   * 260x240 patch — a flat colour with a sprinkle of specks. These three
   * bands (damp bloom, hand-height soiling, and a soft dirt wash) sit at
   * 15-90 cm and are what actually makes a plastered wall read as plaster.
   */
  // NB the contrast expansion. A 4-octave fbm01 spans about 0.3-0.7, never
  // 0-1, so writing 0.86 + 0.30 * n gives a +/-6% wash and not the +/-20%
  // the numbers suggest — the same trap the macro layer documents. Every band
  // here is re-centred and expanded before it is used.
  float dampB = owFbm01(owWarp(p * 1.6 + 3.7, P * 1.6, 0.7, 3), P * 1.6, 4, 0.58);
  dampB = clamp((dampB - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  c *= 0.80 + 0.42 * dampB;
  rough += (dampB - 0.5) * 0.12;
  float soil2 = owFbm01(owWarp(p * 3.4 + 21.0, P * 3.4, 0.55, 3), P * 3.4, 4, 0.55);
  soil2 = clamp((soil2 - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  c *= 0.875 + 0.26 * soil2;
  float wash = owFbm01(p * 8.0 + 6.0, P * 8.0, 4, 0.5);
  wash = clamp((wash - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  c *= 0.925 + 0.155 * wash;
  float lapEdge = (1.0 - smoothstep(0.0, 0.05, lapT)) * (0.35 + 0.65 * lapR);
  h += lapEdge * 0.022 - (lapR - 0.5) * 0.014;
  c *= 1.0 + lapEdge * 0.07;

  // ---- sand tooth: the 0.5-2 mm grain of the finish coat, with a matching
  //      height channel. Without this the wall is paint, not plaster.
  // 6-9 mm float grain. The finer 1-2 mm tooth is the shared detail map's
  // job: at 2.2 m over 1024 texels one texel is 2.1 mm, so anything past
  // K = 22 here is a sub-texel hash that bakes as dither and mips to grey.
  vec4 tooth = owWorley(p * 20.0, P * 20.0, 1.0);
  float grain = smoothstep(0.46, 0.06, tooth.x);
  float grainSel = 0.40 + 0.60 * step(0.32, tooth.z);
  h += grain * grainSel * 0.030;
  ao -= grain * 0.07;
  c *= 1.0 + (grain * grainSel - 0.20) * 0.16;
  rough += (tooth.z - 0.5) * 0.11 + grain * 0.05;
  // dust and shadow sit in the troughs between grains
  float trough = smoothstep(0.52, 0.86, tooth.x);
  c = mix(c, c * 0.84, trough * 0.40);

  // pinholes from the float
  vec4 ph = owWorley(p * 22.0, P * 22.0, 1.0);
  float hole = smoothstep(0.24, 0.0, ph.x) * step(0.80, ph.w);
  h -= hole * 0.06;
  ao -= hole * 0.4;

  // hairline crazing — a fine, wide-spread net
  float hair = owCracks(p * 9.0, P * 9.0, 0.9, 0.016, 0.52);
  hair += owCracks(p * 16.0 + 6.0, P * 16.0, 0.95, 0.015, 0.62) * 0.5;
  hair = clamp(hair, 0.0, 1.0);
  h -= hair * 0.030;
  ao -= hair * 0.18;
  c = mix(c, c * 0.80, hair * 0.45);

  // structural cracks — few, wide, branching
  float crack = owCracks(p * 4.5 + 17.0, P * 4.5, 0.8, 0.018, 0.62);
  h -= crack * 0.16;
  ao -= crack * 0.6;
  c = mix(c, owSRGB(vec3(0.300, 0.278, 0.250)), crack * 0.8);

  // blown plaster: patches spalled off, revealing render/brick beneath
  float blowMask = owFbm01(owWarp(p * 1.05 + 9.0, P * 1.05, 1.1, 3), P * 1.05, 4, 0.55);
  float blow = smoothstep(0.775, 0.845, blowMask);
  float blowEdge = smoothstep(0.745, 0.790, blowMask) - blow;
  vec3 substrate = mix(owSRGB(vec3(0.360, 0.245, 0.195)), owSRGB(vec3(0.430, 0.400, 0.360)),
                       owFbm01(p * 9.0, P * 9.0, 4, 0.5));
  substrate *= 0.85 + 0.3 * owFbm01(p * 20.0, P * 20.0, 3, 0.5);
  c = mix(c, substrate, blow * 0.85);
  h -= blow * 0.13;
  ao -= blow * 0.26;
  rough += blow * 0.10;
  // the lip of the blown patch is bright and sharp
  c += blowEdge * 0.06;
  h += blowEdge * 0.02;

  // ---- chipped patches: 6-9 cm flakes knocked off the skim, showing the darker
  //      browncoat. Deliberately FEWER and LARGER than a fine speckle: a dense
  //      sprinkle of 3 cm dark dots on a facade reads as fly dirt, not as damage,
  //      and it is the one thing that survives at every distance and so gives the
  //      whole wall a screen-space texture.
  vec4 ck = owWorley(owWarp(p * 4.2 + 13.0, P * 4.2, 0.6, 3), P * 4.2, 0.95);
  float ckSel = step(0.930, ck.w);
  float ckSize = 0.22 + 0.20 * ck.z;
  float ckShape = smoothstep(ckSize, ckSize * 0.3,
                             ck.x * (0.70 + 0.60 * owFbm01(p * 16.0, P * 16.0, 3, 0.5)));
  float chip = ckSel * ckShape;
  // The browncoat is the same family as the finish, just darker and coarser —
  // a chip is a shallow flake, not a hole punched in the wall.
  vec3 coat = mix(c, owSRGB(vec3(0.392, 0.336, 0.284)), 0.52);
  coat *= 0.90 + 0.20 * owFbm01(p * 18.0, P * 18.0, 3, 0.5);
  c = mix(c, coat, chip * 0.58);
  h -= chip * 0.05;
  ao -= chip * 0.26;
  rough += chip * 0.09;
  float ckLip = max(ckSel * (smoothstep(ckSize * 1.25, ckSize, ck.x) - ckShape), 0.0);
  c *= 1.0 + ckLip * 0.10;
  h += ckLip * 0.010;

  // water staining: tide marks and slow brown bleed
  float stain = owFbm01(vec2(p.x * 1.6, p.y * 3.2), vec2(P.x * 1.6, P.y * 3.0), 5, 0.6);
  float tide = smoothstep(0.60, 0.78, stain) * (1.0 - smoothstep(0.78, 0.94, stain));
  c = mix(c, owSRGB(vec3(0.400, 0.330, 0.245)), tide * 0.45);
  c *= 1.0 - smoothstep(0.50, 0.95, stain) * 0.34;
  rough += tide * 0.05;

  // black mould in the damp corners
  float mould = smoothstep(0.72, 0.95, owFbm01(p * 4.0 + 25.0, P * 4.0, 5, 0.6)) *
                smoothstep(0.45, 0.8, stain);
  c = mix(c, owSRGB(vec3(0.085, 0.090, 0.080)), mould * 0.7);
  rough += mould * 0.08;

  // grime in recesses
  float cavity = 1.0 - smoothstep(0.48, 0.72, h);
  c = mix(c, owSRGB(vec3(0.22, 0.21, 0.19)), cavity * 0.30);

  alb = clamp(c, vec3(0.02), vec3(0.88));
  rough = clamp(rough, 0.35, 0.99);
  ao = clamp(ao, 0.15, 1.0);
  h = clamp(h, 0.0, 1.0);
}
`;

export const TILE = /* glsl */ `
void owSurface(vec2 uv, out vec3 alb, out float h, out float rough, out float metal, out float ao){
  const vec2 P = vec2(8.0);
  const float N = 6.0;
  vec2 p = uv * P + uSeed * 4.4;

  vec2 tp = uv * N;
  vec2 id = floor(tp);
  vec2 f = fract(tp);
  vec4 rnd = owHash42(id + uSeed);

  // Flat grout bed with a hard arris at the tile edge: a full-width ramp is
  // what makes a joint read as a drawn line instead of a recess.
  const float J = 0.045;
  float dxj = min(f.x, 1.0 - f.x);
  float dyj = min(f.y, 1.0 - f.y);
  float ex = smoothstep(J * 0.70, J * 1.02, dxj);
  float ey = smoothstep(J * 0.70, J * 1.02, dyj);
  float face = min(ex, ey);

  float glaze = owFbm01(f * 6.0 + rnd.xy * 21.0, vec2(48.0), 4, 0.5);
  vec3 cTile = mix(owSRGB(vec3(0.700, 0.690, 0.660)), owSRGB(vec3(0.470, 0.500, 0.505)), rnd.z * 0.7);
  cTile *= 0.93 + 0.13 * glaze;
  cTile *= 0.92 + 0.16 * rnd.y;                                 // per-tile batch shade

  float grout = owFbm01(p * 20.0, P * 20.0, 4, 0.5);
  vec3 cGrout = owSRGB(vec3(0.400, 0.385, 0.360)) * (0.85 + 0.3 * grout);
  cGrout = mix(cGrout, owSRGB(vec3(0.13, 0.13, 0.12)), 0.45);   // grout is always filthy

  float m = face;
  // 0.06 of a 0.03 m relief = 1.8 mm of grout recess.
  h = mix(0.76 - (grout - 0.5) * 0.02, 0.82 + (rnd.w - 0.5) * 0.04, m);
  vec3 c = mix(cGrout, cTile, m);
  // glazed tile has to stay glossy enough to actually catch a highlight
  rough = mix(0.92, 0.20 + 0.22 * glaze + (rnd.z - 0.5) * 0.14, m);
  ao = mix(0.40, 1.0, smoothstep(0.0, 0.8, face));
  metal = 0.0;

  // chipped / cracked / missing tiles
  float broken = step(0.90, rnd.x);
  float crack = owCracks(f * 3.0 + rnd.yz * 9.0, vec2(24.0), 0.85, 0.04, 0.45) * m;
  c = mix(c, c * 0.3, crack * 0.8);
  h -= crack * 0.08;
  ao -= crack * 0.5;
  vec3 sub = owSRGB(vec3(0.330, 0.300, 0.270));
  c = mix(c, sub, broken * m * 0.9);
  h -= broken * m * 0.14;
  rough = mix(rough, 0.95, broken * m);

  // scuffs and traffic wear
  float wear = smoothstep(0.45, 0.95, owFbm01(p * 2.0, P * 2.0, 4, 0.55));
  rough += wear * 0.20 * m;
  c *= 1.0 - wear * 0.12;

  float cavity = 1.0 - smoothstep(0.68, 0.80, h);
  c = mix(c, owSRGB(vec3(0.14, 0.13, 0.12)), cavity * 0.35);

  alb = clamp(c, vec3(0.02), vec3(0.85));
  rough = clamp(rough, 0.12, 0.95);
  ao = clamp(ao, 0.15, 1.0);
  h = clamp(h, 0.0, 1.0);
}
`;

/**
 * GRID — the blockout deck.
 *
 * A flat coloured plane ruled with lines, and deliberately nothing else. It is
 * TILE (above) with every realism pass removed: no per-cell colour jitter, no
 * grout filth, no cracks, no broken units, no traffic wear. That absence IS the
 * surface — a blockout reads as a blockout because every square is identical,
 * so anything that makes two cells differ is a bug here rather than a feature.
 *
 * `uParam.x` is the number of cells across one bake tile. The library entry
 * sets it beside `bake.worldSize`, and `worldSize / cells` is the size of one
 * square in metres — the two numbers are checked against each other in
 * `maps.selftest.mjs`, because a grid that is silently 1.3 m still looks like a
 * grid.
 */
export const GRID = /* glsl */ `
void owSurface(vec2 uv, out vec3 alb, out float h, out float rough, out float metal, out float ao){
  float N = max(1.0, uParam.x);
  vec2 f = fract(uv * N);

  // Distance to the nearest ruling, in cell units, on each axis.
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));

  /**
   * A WIDE smoothstep band, not a hard step.
   *
   * At 512 px over 4 cells one texel is ~0.008 of a cell, so a "1 texel" line
   * survives exactly one mip level. Two mips down — which is most of a 42 m
   * street — it is averaged into the base colour and the grid quietly stops
   * existing at precisely the distances it was drawn to describe.
   */
  const float W = 0.020;
  float line = 1.0 - smoothstep(W * 0.40, W, d);

  vec3 base = owSRGB(vec3(0.470, 0.585, 0.755));
  vec3 ink  = owSRGB(vec3(0.905, 0.920, 0.940));
  vec3 c = mix(base, ink, line);

  // The ruling is painted on, not cut in: a scratch of height so grazing light
  // finds an edge, far too little for the normal map to read as a groove.
  h = 0.5 + line * 0.02;
  rough = 0.86 - line * 0.04;
  metal = 0.0;
  ao = 1.0;

  alb = clamp(c, vec3(0.02), vec3(0.85));
}
`;

/**
 * FLAT — a constant colour, and nothing whatsoever else.
 *
 * This exists because zeroing the shader's `weather`/`macro`/`patch`/`detail`
 * parameters is NOT enough to get a flat surface. Those control what the shader
 * modulates at runtime; the mottling, tonal drift and cracks of PLASTER or
 * CONCRETE are baked into the albedo texture before the shader ever sees it,
 * and `tint` is a multiply — it can darken that variation but never remove it.
 * A near-white tint over the plaster bake gives a tan mottled wall, not a white
 * one.
 *
 * So the blockout's masses get a surface with no variation to begin with. All
 * of `gb_white`, `gb_grey`, `gb_dark` and `gb_accent` name this one entry and
 * differ only by `tint`, which is a shader uniform rather than a bake input —
 * four flat colours out of a SINGLE texture set.
 *
 * Baked at 256 and with no relief. There is no detail here for resolution to
 * carry: every texel is the same texel, and a normal map of a flat plane is a
 * megabyte of the vector (0,0,1).
 *
 * `uParam.x` is roughness.
 */
export const FLAT = /* glsl */ `
void owSurface(vec2 uv, out vec3 alb, out float h, out float rough, out float metal, out float ao){
  alb = vec3(0.9);
  h = 0.5;
  rough = clamp(uParam.x, 0.04, 1.0);
  metal = 0.0;
  ao = 1.0;
}
`;
