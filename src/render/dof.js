import * as THREE from 'three';
import { COMMON } from './glsl.js';
import { Pass, hdrTarget } from './pass.js';

/**
 * Gather depth of field, engaged only while the sights are up.
 *
 * ADS in a modern shooter is not "hipfire with the gun raised": the frame has to
 * tell you your eye is behind a tube. But the one thing that must never go soft
 * is THE SIGHT PICTURE ITSELF. The optic is where the eye is looking; the world
 * inside it is the target. Softening that and leaving the near surroundings
 * sharp is exactly backwards, and it is what a hard ceiling on the focal
 * distance used to produce here: `dofFocusMax` was 18 m, so aiming at anything
 * past ~22 m — which is the entire reason a magnified optic exists — pinned the
 * focal plane short of the target and blurred it while the crate at 8 m beside
 * you stayed pin sharp. The sight picture was the softest thing on screen.
 *
 * So the focal plane now follows the aim point all the way out (`dofFocusMax` is
 * a sanity rail, not a working range), and the two blur bands are shaped so that
 * a distant focus cannot drag the whole frame with it:
 *
 *   FAR   begins `dofFarStart x focus` behind the focal plane. Proportional, so
 *         it is always *behind the target*, never on it. Its width grows with
 *         range too (`max(dofFarRange, focus x FAR_WIDEN)`) — a fixed 18 m ramp
 *         at 200 m is a razor edge across a hillside.
 *   NEAR  ends at `min(dofNearScale x focus, dofNearMax)`. The ABSOLUTE cap is
 *         the important half: without it, focusing at 120 m makes "near" mean
 *         everything inside 66 m and the mid-ground dissolves. Near blur is for
 *         the ledge you are leaning over, and nothing else.
 *
 * What is left is the peripheral term, which is what actually sells the tube:
 * a radial CoC that ramps in OUTSIDE the sight-picture disc (`dofPeripheral`,
 * as a fraction of the max). Centre sharp, edges soft — the opposite of what the
 * depth bands were doing on their own, and the same story the ADS vignette tells
 * with brightness.
 *
 * Three passes, the blur at half resolution:
 *
 *   1  PREFILTER  full -> half. 4-tap box of the colour, plus the circle of
 *      confusion in FULL-RES PIXELS packed into alpha. The focal distance is
 *      read from the depth buffer at the screen centre — literally the reticle
 *      plane — so it tracks whatever the player is actually aiming at.
 *   2  GATHER     half res, 32 taps on a golden-angle spiral over the MAXIMUM
 *      CoC, weighted `clamp(tapCoC - dist + 1)`. That is scatter-as-gather: a
 *      blurred foreground fragment spreads onto its neighbours instead of being
 *      sampled only by pixels that are themselves blurred, so there is no hard
 *      edge where a near object meets a far one.
 *   3  COMBINE    full res. Blends the sharp image toward the gathered one by
 *      the full-res CoC, dilated by the half-res neighbourhood so the
 *      transition never shows the half-res grid.
 *
 * The viewmodel is composited AFTER this pass, so the optic, the reticle and the
 * hands are untouched and stay pin sharp for free.
 */

/**
 * Shape constants shared by the shader and its CPU mirror below. They are
 * interpolated into the GLSL rather than typed twice, so the numbers cannot
 * drift apart; `dof.selftest.mjs` checks the mirror, and the mirror is the
 * shader's own arithmetic.
 */
/** Far band widening per metre of focal distance. See the class note. */
export const FAR_WIDEN = 0.35;
/** Near band toe: blur is total below this fraction of the near band's end. */
export const NEAR_TOE = 0.35;
/** Peripheral ramp, in half-frame-heights from the centre. */
export const PERIPHERY_START = 0.78;
export const PERIPHERY_END = 1.5;
/** CoC (px) that maps to a fully blurred pixel in COMBINE. */
export const BLEND_LO = 0.35;
export const BLEND_HI = 1.45;

const f = (n) => n.toFixed(4);

// Shared CoC evaluation. Depth is POSITIVE linear metres; the prepass clears to
// zero, so 0 means "sky" and focuses at infinity — which is to say, at the far
// rail, past any geometry a map contains.
const COC = /* glsl */ `
uniform sampler2D tDepth;
// x maxCoC(px)  y nearRatio  z focusMin  w focusMax
uniform vec4 uFocus;
// x farStartScale  y farRangeMin  z nearScale  w nearMax(m)
uniform vec4 uRange;
// x peripheralCoC(px)  y aspect (w/h)  z unused  w unused
uniform vec4 uRadial;

float owFocusDistance() {
  float c = texture2D( tDepth, vec2( 0.5 ) ).r;
  if ( c <= 0.0 ) c = 1e4;                       // aiming at the sky
  return clamp( c, uFocus.z, uFocus.w );
}

float owCoC( float depth, float focus ) {
  float d = depth <= 0.0 ? 1e4 : depth;
  float farStart = focus * uRange.x + 1.0;
  float farEnd = farStart + max( uRange.y, focus * ${f(FAR_WIDEN)} );
  float far = smoothstep( farStart, farEnd, d );
  float nearEnd = min( focus * uRange.z, uRange.w );
  float near = 1.0 - smoothstep( nearEnd * ${f(NEAR_TOE)}, nearEnd, d );
  return uFocus.x * max( far, near * uFocus.y );
}

// Radius in half-frame-heights: 0 at the reticle, 1 at the top and bottom edge,
// ~1.86 in the corners of a 16:9 frame. The sight-picture disc of the longest
// optic reaches ~0.65, so the ramp starts outside it by construction.
float owPeripheralCoC( vec2 uv ) {
  vec2 p = ( uv - 0.5 ) * vec2( uRadial.y, 1.0 );
  return uRadial.x * smoothstep( ${f(PERIPHERY_START)}, ${f(PERIPHERY_END)}, length( p ) * 2.0 );
}
`;

const PREFILTER = /* glsl */ `
precision highp float;
${COMMON}
${COC}
uniform sampler2D tColor;
uniform vec2 uSrcTexel;
varying vec2 vUv;

void main() {
  float focus = owFocusDistance();
  float rim = owPeripheralCoC( vUv );

  vec2 o = uSrcTexel * 0.5;
  vec3 c0 = max( texture2D( tColor, vUv + vec2( -o.x, -o.y ) ).rgb, vec3( 0.0 ) );
  vec3 c1 = max( texture2D( tColor, vUv + vec2(  o.x, -o.y ) ).rgb, vec3( 0.0 ) );
  vec3 c2 = max( texture2D( tColor, vUv + vec2( -o.x,  o.y ) ).rgb, vec3( 0.0 ) );
  vec3 c3 = max( texture2D( tColor, vUv + vec2(  o.x,  o.y ) ).rgb, vec3( 0.0 ) );

  float d0 = texture2D( tDepth, vUv + vec2( -o.x, -o.y ) ).r;
  float d1 = texture2D( tDepth, vUv + vec2(  o.x, -o.y ) ).r;
  float d2 = texture2D( tDepth, vUv + vec2( -o.x,  o.y ) ).r;
  float d3 = texture2D( tDepth, vUv + vec2(  o.x,  o.y ) ).r;

  // Weight the colour toward the MORE blurred taps: averaging a sharp
  // background into a blurred foreground is what makes cheap DOF look like a
  // halo around every silhouette.
  float k0 = max( owCoC( d0, focus ), rim ), k1 = max( owCoC( d1, focus ), rim );
  float k2 = max( owCoC( d2, focus ), rim ), k3 = max( owCoC( d3, focus ), rim );
  float w0 = k0 + 0.05, w1 = k1 + 0.05, w2 = k2 + 0.05, w3 = k3 + 0.05;
  vec3 col = ( c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 ) / ( w0 + w1 + w2 + w3 );

  gl_FragColor = vec4( col, max( max( k0, k1 ), max( k2, k3 ) ) );
}
`;

const GATHER = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tSrc;
uniform vec2 uTexel;       // HALF-res texel
uniform vec2 uParams;      // x maxCoC(px, full res), y frame
varying vec2 vUv;

#define OW_DOF_TAPS 32

void main() {
  vec4 centre = texture2D( tSrc, vUv );
  // Radius in half-res pixels. Always the maximum: in-focus taps contribute a
  // weight of zero, so a fixed loop is both correct and branch free.
  float radius = max( uParams.x * 0.5, 1.0 );

  float rot = owIGN( gl_FragCoord.xy + uParams.y * 5.371 ) * 6.2831853;
  float cr = cos( rot );
  float sr = sin( rot );

  vec3 sum = centre.rgb;
  float wsum = 1.0;
  float maxCoc = centre.a;

  for ( int i = 0; i < OW_DOF_TAPS; i ++ ) {
    float t = ( float( i ) + 0.5 ) / float( OW_DOF_TAPS );
    float ang = float( i ) * 2.39996323 + rot;
    vec2 dir = vec2( cos( ang ), sin( ang ) );
    vec2 off = dir * sqrt( t ) * radius;
    vec4 s = texture2D( tSrc, vUv + off * uTexel );
    float dist = length( off );
    // scatter-as-gather: this tap only reaches us if its own CoC is wide enough
    float w = clamp( s.a * 0.5 - dist + 1.0, 0.0, 1.0 );
    sum += s.rgb * w;
    wsum += w;
    maxCoc = max( maxCoc, s.a );
  }

  gl_FragColor = vec4( sum / max( wsum, 1e-4 ), maxCoc );
}
`;

const COMBINE = /* glsl */ `
precision highp float;
${COMMON}
${COC}
uniform sampler2D tColor;
uniform sampler2D tBlur;
varying vec2 vUv;

void main() {
  vec3 sharp = max( texture2D( tColor, vUv ).rgb, vec3( 0.0 ) );
  vec4 blur = texture2D( tBlur, vUv );
  float focus = owFocusDistance();
  float coc = max( owCoC( texture2D( tDepth, vUv ).r, focus ), owPeripheralCoC( vUv ) );
  // Dilate with the gathered neighbourhood maximum so a blurred foreground
  // actually bleeds over the sharp thing behind it.
  coc = max( coc, blur.a * 0.85 );
  float m = smoothstep( ${f(BLEND_LO)}, ${f(BLEND_HI)}, coc );
  gl_FragColor = vec4( mix( sharp, max( blur.rgb, vec3( 0.0 ) ), m ), 1.0 );
}
`;

/* -------------------------------------------------------------------------- */
/* CPU mirror of the two CoC functions above.                                  */
/*                                                                             */
/* Same arithmetic, same constants (they are interpolated into the GLSL from    */
/* the exports at the top of this file), so `dof.selftest.mjs` can pin the      */
/* focus behaviour headlessly. A still frame cannot tell you whether the thing  */
/* under the reticle is the sharpest pixel on screen; this can.                 */
/* -------------------------------------------------------------------------- */

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
};

/** Peak CoC in pixels for a frame `height` px tall at ADS engagement `amount`. */
export function dofMaxCoc(settings, height, amount) {
  return settings.dofMaxCoc * (height / 1080) * amount;
}

/** Focal distance in metres, from the linear depth under the reticle. */
export function dofFocusDistance(settings, centreDepth) {
  const c = centreDepth <= 0 ? 1e4 : centreDepth;
  return Math.min(settings.dofFocusMax, Math.max(settings.dofFocusMin, c));
}

/** Depth-driven CoC in pixels at `depth` metres, for a given focal distance. */
export function dofCoC(settings, depth, focus, maxCoc) {
  const d = depth <= 0 ? 1e4 : depth;
  const farStart = focus * settings.dofFarStart + 1;
  const farEnd = farStart + Math.max(settings.dofFarRange, focus * FAR_WIDEN);
  const far = smoothstep(farStart, farEnd, d);
  const nearEnd = Math.min(focus * settings.dofNearScale, settings.dofNearMax);
  const near = 1 - smoothstep(nearEnd * NEAR_TOE, nearEnd, d);
  return maxCoc * Math.max(far, near * settings.dofNearRatio);
}

/** Peripheral CoC in pixels at `r` half-frame-heights from the reticle. */
export function dofPeripheralCoC(settings, maxCoc, r) {
  return maxCoc * settings.dofPeripheral * smoothstep(PERIPHERY_START, PERIPHERY_END, r);
}

/** 0 = the sharp image survives untouched, 1 = fully replaced by the blur. */
export function dofBlend(coc) {
  return smoothstep(BLEND_LO, BLEND_HI, coc);
}

export class DepthOfField {
  constructor() {
    const focus = new THREE.Vector4(5.0, 0.6, 3.0, 1200.0);
    const range = new THREE.Vector4(1.2, 20.0, 0.55, 2.5);
    const radial = new THREE.Vector4(0, 16 / 9, 0, 0);

    this.pre = new Pass('ow-dof-pre', PREFILTER, {
      tColor: { value: null },
      tDepth: { value: null },
      uSrcTexel: { value: new THREE.Vector2() },
      uFocus: { value: focus },
      uRange: { value: range },
      uRadial: { value: radial },
    });
    this.gather = new Pass('ow-dof-gather', GATHER, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uParams: { value: new THREE.Vector2(5.0, 0) },
    });
    this.combine = new Pass('ow-dof-combine', COMBINE, {
      tColor: { value: null },
      tBlur: { value: null },
      tDepth: { value: null },
      uFocus: { value: focus },
      uRange: { value: range },
      uRadial: { value: radial },
    });

    // One Vector4 apiece, shared by prefilter and combine, so the focal plane
    // and the peripheral ramp can never disagree between the two.
    this._focus = focus;
    this._range = range;
    this._radial = radial;
    this.rtA = null;
    this.rtB = null;
    this.width = 1;
    this.height = 1;
  }

  setSize(w, h) {
    this.rtA?.dispose();
    this.rtB?.dispose();
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    this.rtA = hdrTarget(hw, hh, { name: 'dof-a' });
    this.rtB = hdrTarget(hw, hh, { name: 'dof-b' });
    this.width = w;
    this.height = h;
    this.pre.uniforms.uSrcTexel.value.set(1 / w, 1 / h);
    this.gather.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }

  /**
   * @param amount 0..1 ADS engagement; the CoC scales with it so the blur ramps
   *               in with the sight picture instead of popping.
   * @param out    full-res target to write the recombined image into
   * @returns the resolved texture
   */
  render(renderer, colorTexture, gbuffer, out, amount, settings, frame) {
    // 1080p-referred CoC, scaled to the internal resolution so the blur is the
    // same fraction of the frame at every render scale.
    const maxCoc = dofMaxCoc(settings, this.height, amount);
    this._focus.set(maxCoc, settings.dofNearRatio, settings.dofFocusMin, settings.dofFocusMax);
    this._range.set(settings.dofFarStart, settings.dofFarRange, settings.dofNearScale, settings.dofNearMax);
    // Never wider than the gather radius, or the periphery would ask for a blur
    // the spiral was not sized to deliver and band instead.
    this._radial.set(maxCoc * Math.min(1, settings.dofPeripheral), this.width / this.height, 0, 0);

    const pu = this.pre.uniforms;
    pu.tColor.value = colorTexture;
    pu.tDepth.value = gbuffer.depthTexture;
    this.pre.render(renderer, this.rtA);

    const gu = this.gather.uniforms;
    gu.tSrc.value = this.rtA.texture;
    gu.uParams.value.set(maxCoc, frame % 64);
    this.gather.render(renderer, this.rtB);

    const cu = this.combine.uniforms;
    cu.tColor.value = colorTexture;
    cu.tBlur.value = this.rtB.texture;
    cu.tDepth.value = gbuffer.depthTexture;
    this.combine.render(renderer, out);
    return out.texture;
  }

  dispose() {
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.pre.dispose();
    this.gather.dispose();
    this.combine.dispose();
  }
}
