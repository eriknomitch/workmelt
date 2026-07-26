import * as THREE from 'three';

/**
 * Cascaded shadow maps, done properly.
 *
 *  - N cascades packed into ONE `sampler2DArray` (R32F, linear light-space
 *    depth). One texture unit total, so a material can still bind its own
 *    albedo/normal/roughness/AO maps without blowing the 16-unit limit.
 *  - Cascades are fitted to the *bounding sphere* of each sub-frustum, so the
 *    ortho extent is rotation-invariant, and the projection is then snapped to
 *    whole texels. Together that removes shadow swimming completely: the
 *    sampled texel grid is nailed to world space, not to the camera.
 *  - PCSS: blocker search -> penumbra estimate -> Vogel-disk PCF, giving
 *    contact-hardening (sharp where the caster touches the receiver, soft
 *    metres away) instead of a constant mush.
 *  - Normal-offset + slope-scaled depth bias, both expressed in *world* units
 *    derived from the cascade's texel size, which is what kills acne without
 *    peter-panning.
 *
 * The shadow term is injected into every lit material by materialpatch.js;
 * three's own shadow path is left alone for other lights (spot/point).
 */

const _v = new THREE.Vector3();
const _center = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(0, 0, 1);
const _origin = new THREE.Vector4();
const _mat = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _rel = new THREE.Vector3();

export class CascadedShadowMaps {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.cascades = Math.max(1, Math.min(4, opts.cascades | 0));
    // 4 x 4096 x R32F is a quarter of a gigabyte for shadows nobody can see.
    // 2048 with PCSS reads sharper than 4096 without it.
    this.mapSize = Math.min(opts.mapSize ?? 2048, 2048);
    this.maxDistance = opts.maxDistance ?? 140;
    this.lambda = 0.86;
    this.backDistance = 140;
    this.enabled = true;

    this.rt = new THREE.WebGLArrayRenderTarget(this.mapSize, this.mapSize, this.cascades, {
      type: THREE.FloatType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.rt.texture.name = 'csm';

    this.cameras = [];
    this.matrices = [];
    for (let i = 0; i < this.cascades; i++) {
      const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
      c.matrixAutoUpdate = false;
      this.cameras.push(c);
      this.matrices.push(new THREE.Matrix4());
    }

    this.uniforms = {
      owCsmMaps: { value: this.rt.texture },
      owCsmMatrix: { value: this.matrices },
      owCsmSplit: { value: new THREE.Vector4(1e9, 1e9, 1e9, 1e9) },
      owCsmSplitNear: { value: new THREE.Vector4(0, 0, 0, 0) },
      owCsmTexel: { value: new THREE.Vector4(0.01, 0.01, 0.01, 0.01) },
      owCsmRange: { value: new THREE.Vector4(1, 1, 1, 1) },
      owCsmMapSize: { value: new THREE.Vector2(this.mapSize, 1 / this.mapSize) },
      owSunDirView: { value: new THREE.Vector3(0, 1, 0) },
      owSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
      // x strength, y tan(sun angular radius), z max filter radius (texels), w temporal rotation
      owCsmParams: { value: new THREE.Vector4(1, 0.022, 9, 0) },
    };

    this.depthMaterial = new THREE.ShaderMaterial({
      name: 'csm-depth',
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        #include <common>
        #include <batching_pars_vertex>
        #include <skinning_pars_vertex>
        #include <morphtarget_pars_vertex>
        void main() {
          #include <batching_vertex>
          #include <beginnormal_vertex>
          #include <morphinstance_vertex>
          #include <morphnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <begin_vertex>
          #include <morphtarget_vertex>
          #include <skinning_vertex>
          #include <project_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        void main() { gl_FragColor = vec4( gl_FragCoord.z, 0.0, 0.0, 1.0 ); }
      `,
    });

    this._splits = new Float32Array(this.cascades + 1);
    this._prevClear = new THREE.Color();

    // ---- per-cascade caster culling ---------------------------------------
    // World-space fit of each cascade, kept so `render()` can reject casters
    // that cannot possibly darken a texel this cascade is ever sampled at.
    this._fitCenter = [];
    this._fitRadius = new Float32Array(this.cascades);
    this._fitBack = new Float32Array(this.cascades);
    for (let i = 0; i < this.cascades; i++) this._fitCenter.push(new THREE.Vector3());
    this._sunAxis = new THREE.Vector3(0, 1, 0);
    /** Objects this pass hid, so it can restore exactly those and no others. */
    this._culled = [];
    this._nCulled = 0;
    /** Diagnostics: casters submitted per cascade on the last frame. */
    this.casterCounts = new Int32Array(this.cascades);
    /** Diagnostics: cascades skipped entirely on the last frame. */
    this.emptyCascades = 0;
  }

  /** Recompute cascade fits. `sunDir` points FROM the scene TOWARD the sun. */
  update(camera, sunDir, softness = 0.022) {
    const n = camera.near;
    const f = Math.min(camera.far, this.maxDistance);
    const N = this.cascades;
    const s = this._splits;
    s[0] = n;
    for (let i = 1; i < N; i++) {
      const p = i / N;
      const logSplit = n * Math.pow(f / n, p);
      const uniSplit = n + (f - n) * p;
      s[i] = this.lambda * logSplit + (1 - this.lambda) * uniSplit;
    }
    s[N] = f;

    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const tanH = tanV * camera.aspect;
    const k2 = tanV * tanV + tanH * tanH;

    const split = this.uniforms.owCsmSplit.value;
    const splitNear = this.uniforms.owCsmSplitNear.value;
    const texel = this.uniforms.owCsmTexel.value;
    const range = this.uniforms.owCsmRange.value;
    const comp = ['x', 'y', 'z', 'w'];

    for (let i = 0; i < N; i++) {
      const cn = s[i];
      const cf = s[i + 1];

      // Bounding sphere of the sub-frustum, in view space, on the -z axis.
      let cz, r;
      if (k2 * k2 * (cf + cn) >= cf - cn) {
        cz = -cf;
        r = cf * Math.sqrt(k2);
      } else {
        cz = -0.5 * (cf + cn) * (1 + k2);
        r = 0.5 * Math.sqrt(
          (cf - cn) * (cf - cn) + 2 * (cf * cf + cn * cn) * k2 + (cf + cn) * (cf + cn) * k2 * k2
        );
      }
      r = Math.ceil(r * 16) / 16; // stabilise radius against float drift

      _center.set(0, 0, cz).applyMatrix4(camera.matrixWorld);

      const cam = this.cameras[i];
      const up = Math.abs(sunDir.y) > 0.98 ? _altUp : _up;
      _v.copy(_center).addScaledVector(sunDir, r + this.backDistance);
      cam.position.copy(_v);
      cam.up.copy(up);
      cam.lookAt(_center);
      cam.updateMatrix();
      cam.matrixWorld.copy(cam.matrix);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 0.0;
      cam.far = 2 * r + this.backDistance;
      cam.updateProjectionMatrix();

      // --- texel snap: quantise the light-space origin to the texel grid ---
      _mat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _origin.set(0, 0, 0, 1).applyMatrix4(_mat);
      const half = this.mapSize * 0.5;
      const sx = _origin.x * half;
      const sy = _origin.y * half;
      const dx = (Math.round(sx) - sx) / half;
      const dy = (Math.round(sy) - sy) / half;
      cam.projectionMatrix.elements[12] += dx;
      cam.projectionMatrix.elements[13] += dy;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

      this.matrices[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

      this._fitCenter[i].copy(_center);
      this._fitRadius[i] = r;
      this._fitBack[i] = this.backDistance;

      split[comp[i]] = cf;
      splitNear[comp[i]] = cn;
      texel[comp[i]] = (2 * r) / this.mapSize;
      range[comp[i]] = cam.far - cam.near;
    }
    for (let i = N; i < 4; i++) {
      split[comp[i]] = 1e9;
      splitNear[comp[i]] = 1e9;
      texel[comp[i]] = 0.01;
      range[comp[i]] = 1;
    }

    this._sunAxis.copy(sunDir);
    this.uniforms.owSunDirWorld.value.copy(sunDir);
    this.uniforms.owSunDirView.value
      .copy(sunDir)
      .transformDirection(camera.matrixWorldInverse)
      .normalize();
    this.uniforms.owCsmParams.value.y = softness;
  }

  /**
   * Reject every caster that cannot darken a texel this cascade is ever
   * *sampled* at, and hide it for the duration of this cascade's draw.
   *
   * Three's own frustum culling tests the caster's bounding sphere against the
   * cascade's ORTHO BOX, which is the axis-aligned bound of the cascade's fit
   * sphere extruded `backDistance` toward the sun. The shader only ever samples
   * cascade `c` for receivers inside that fit sphere (the cascade owns a view
   * depth slice, and the sphere is that slice's bound), so the box corners —
   * 1 - pi/4, a fifth of its cross-section — are sampled by nothing. Testing
   * against the extruded CYLINDER instead of the box is therefore strictly
   * tighter and strictly output-preserving.
   *
   * The margin has to cover everything that makes the shader sample OUTSIDE the
   * receiver's own projected point, or a caster whose only contribution is to a
   * filter tap gets culled and the penumbra changes:
   *   - the whole-texel snap `update()` applies after the fit  (1 texel)
   *   - the normal offset, up to 1.65 texels at grazing incidence
   *   - the PCSS blocker search, up to 10 texels
   *   - the PCF disc, up to `owCsmParams.z` texels (9 at ultra)
   * 32 texels is comfortably past the sum of those and still only 1.5% of a
   * cascade's extent, so it costs the cull almost nothing. Measured: at 2
   * texels this pass was NOT pixel-neutral (0.04% of pixels, up to 26/255).
   *
   * `frustumCulled === false` is an explicit opt-out (sky dome, GPU particle
   * meshes whose bounds are meaningless) and is honoured exactly as three does.
   *
   * @returns {number} casters left standing for this cascade.
   */
  _cullCascade(i, casters, nCasters) {
    const center = this._fitCenter[i];
    const r = this._fitRadius[i];
    const margin = (32 * (2 * r)) / this.mapSize; // 32 shadow texels, in metres
    const rSide = r + margin;
    const tFar = -r - margin; // far plane, measured along +sunDir from centre
    const tNear = r + this._fitBack[i] + margin; // the light's own position
    const axis = this._sunAxis;
    let kept = 0;

    for (let k = 0; k < nCasters; k++) {
      const o = casters[k];
      // Already hidden by the caller (owNoShadow, transparent): not a caster at
      // all, so it must not be counted and must not be restored either.
      if (o.visible === false) continue;
      if (o.frustumCulled === false) {
        kept++;
        continue;
      }
      // Same source of truth three uses, so a caster is never culled here that
      // three would have drawn for a *reason* (skinned bounds, custom bounds).
      let src = o.boundingSphere;
      if (src === undefined) {
        const g = o.geometry;
        if (g === undefined) {
          kept++;
          continue;
        }
        if (g.boundingSphere === null) g.computeBoundingSphere();
        src = g.boundingSphere;
      } else if (src === null) {
        o.computeBoundingSphere();
        src = o.boundingSphere;
      }
      if (src === null || src === undefined) {
        kept++;
        continue;
      }
      _sphere.copy(src).applyMatrix4(o.matrixWorld);

      _rel.subVectors(_sphere.center, center);
      const t = _rel.dot(axis);
      const rad = _sphere.radius;
      // Slab along the light axis...
      if (t + rad < tFar || t - rad > tNear) {
        o.visible = false;
        this._culled[this._nCulled++] = o;
        continue;
      }
      // ...and the cylinder around it.
      const perp2 = _rel.lengthSq() - t * t;
      const lim = rSide + rad;
      if (perp2 > lim * lim) {
        o.visible = false;
        this._culled[this._nCulled++] = o;
        continue;
      }
      kept++;
    }
    return kept;
  }

  _restoreCulled() {
    for (let i = 0; i < this._nCulled; i++) this._culled[i].visible = true;
    this._nCulled = 0;
  }

  /**
   * Render the cascades. Caller has already hidden non-casters.
   *
   * `casters` / `nCasters` is the flat opaque draw list. When supplied, each
   * cascade only submits the casters that can reach it, and a cascade nothing
   * reaches is cleared instead of drawn (see `_cullCascade`). The clear is not
   * optional even for an empty cascade: the array layer still holds last
   * frame's depths, and leaving them would shadow with stale blockers.
   */
  render(renderer, scene, casters = null, nCasters = 0) {
    const prevOverride = scene.overrideMaterial;
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this._prevClear);
    const prevAlpha = renderer.getClearAlpha();

    scene.overrideMaterial = this.depthMaterial;
    renderer.autoClear = false;
    renderer.setClearColor(0xffffff, 1);
    this.emptyCascades = 0;

    for (let i = 0; i < this.cascades; i++) {
      const kept = casters === null ? -1 : this._cullCascade(i, casters, nCasters);
      this.casterCounts[i] = kept;
      renderer.setRenderTarget(this.rt, i);
      renderer.clear(true, true, false);
      if (kept !== 0) renderer.render(scene, this.cameras[i]);
      else this.emptyCascades++;
      if (casters !== null) this._restoreCulled();
    }

    scene.overrideMaterial = prevOverride;
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this._prevClear, prevAlpha);
    renderer.setRenderTarget(null);
  }

  /**
   * Snapshot everything `update()` writes.
   *
   * Only used by RenderSystem.prewarmMaterials(), which has to fit the cascades
   * to compile their depth variants but must not leave a fit behind: MEASURED,
   * a single out-of-frame `update()` moved 1.3 M pixels by up to 26/255 on the
   * `interior` shot even though the next frame refits from scratch. Allocates,
   * so it is a loading-screen call and never a frame-loop one.
   */
  snapshotFit() {
    const u = this.uniforms;
    return {
      split: u.owCsmSplit.value.clone(),
      splitNear: u.owCsmSplitNear.value.clone(),
      texel: u.owCsmTexel.value.clone(),
      range: u.owCsmRange.value.clone(),
      sunView: u.owSunDirView.value.clone(),
      sunWorld: u.owSunDirWorld.value.clone(),
      params: u.owCsmParams.value.clone(),
      matrices: this.matrices.map((m) => m.clone()),
      splits: this._splits.slice(),
      sunAxis: this._sunAxis.clone(),
      fitCenter: this._fitCenter.map((v) => v.clone()),
      fitRadius: this._fitRadius.slice(),
      fitBack: this._fitBack.slice(),
      cameras: this.cameras.map((c) => ({
        position: c.position.clone(),
        quaternion: c.quaternion.clone(),
        up: c.up.clone(),
        left: c.left,
        right: c.right,
        top: c.top,
        bottom: c.bottom,
        near: c.near,
        far: c.far,
        matrix: c.matrix.clone(),
        matrixWorld: c.matrixWorld.clone(),
        matrixWorldInverse: c.matrixWorldInverse.clone(),
        projectionMatrix: c.projectionMatrix.clone(),
        projectionMatrixInverse: c.projectionMatrixInverse.clone(),
      })),
    };
  }

  /** Put back exactly what `snapshotFit()` captured. */
  restoreFit(s) {
    if (!s) return;
    const u = this.uniforms;
    u.owCsmSplit.value.copy(s.split);
    u.owCsmSplitNear.value.copy(s.splitNear);
    u.owCsmTexel.value.copy(s.texel);
    u.owCsmRange.value.copy(s.range);
    u.owSunDirView.value.copy(s.sunView);
    u.owSunDirWorld.value.copy(s.sunWorld);
    u.owCsmParams.value.copy(s.params);
    for (let i = 0; i < this.matrices.length; i++) this.matrices[i].copy(s.matrices[i]);
    this._splits.set(s.splits);
    this._sunAxis.copy(s.sunAxis);
    for (let i = 0; i < this._fitCenter.length; i++) this._fitCenter[i].copy(s.fitCenter[i]);
    this._fitRadius.set(s.fitRadius);
    this._fitBack.set(s.fitBack);
    for (let i = 0; i < this.cameras.length; i++) {
      const c = this.cameras[i];
      const t = s.cameras[i];
      c.position.copy(t.position);
      c.quaternion.copy(t.quaternion);
      c.up.copy(t.up);
      c.left = t.left;
      c.right = t.right;
      c.top = t.top;
      c.bottom = t.bottom;
      c.near = t.near;
      c.far = t.far;
      c.matrix.copy(t.matrix);
      c.matrixWorld.copy(t.matrixWorld);
      c.matrixWorldInverse.copy(t.matrixWorldInverse);
      c.projectionMatrix.copy(t.projectionMatrix);
      c.projectionMatrixInverse.copy(t.projectionMatrixInverse);
    }
  }

  setStrength(v) {
    this.uniforms.owCsmParams.value.x = v;
  }

  setJitter(v) {
    this.uniforms.owCsmParams.value.w = v;
  }

  dispose() {
    this.rt.dispose();
    this.depthMaterial.dispose();
  }
}

/**
 * GLSL injected into every lit material. Declares the CSM uniforms and the
 * `owSunShadow()` entry point used inside the directional-light loop.
 */
export function csmShaderChunk(cascades, quality) {
  const blockerTaps = quality >= 3 ? 16 : quality >= 2 ? 12 : quality >= 0 ? 8 : 1;
  const pcfTaps = quality >= 3 ? 20 : quality >= 2 ? 14 : quality >= 0 ? 8 : 1;
  const pcss = quality >= 2;

  // Sampler-array-free: one 2D array texture, so the layer index can be
  // dynamic. No unrolling needed.
  return /* glsl */ `
#define OW_CASCADES ${cascades}
#define OW_BLOCKER_TAPS ${blockerTaps}
#define OW_PCF_TAPS ${pcfTaps}
${pcss ? '#define OW_PCSS 1' : ''}

uniform highp sampler2DArray owCsmMaps;
uniform mat4 owCsmMatrix[ OW_CASCADES ];
uniform vec4 owCsmSplit;
uniform vec4 owCsmSplitNear;
uniform vec4 owCsmTexel;
uniform vec4 owCsmRange;
uniform vec2 owCsmMapSize;
uniform vec3 owSunDirView;
uniform vec3 owSunDirWorld;
uniform vec4 owCsmParams;

float owIGNoise( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}

vec2 owVogel( int i, int n, float phi ) {
  float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
  float theta = float( i ) * 2.39996323 + phi;
  return vec2( cos( theta ), sin( theta ) ) * r;
}

float owCsmTap( float layer, vec2 uv ) {
  return texture( owCsmMaps, vec3( uv, layer ) ).r;
}

float owCsmCascade( int c, vec3 wPos, vec3 wN, float NdL, float rot ) {
  float texelWorld = owCsmTexel[ c ];
  float range = owCsmRange[ c ];
  float layer = float( c );

  // normal offset — pushes the sample point off the surface by roughly one
  // shadow texel, scaled up at grazing angles where the texel projects wide.
  vec3 p = wPos + wN * ( texelWorld * ( 0.55 + 1.1 * ( 1.0 - NdL ) ) );
  vec4 sc = owCsmMatrix[ c ] * vec4( p, 1.0 );
  vec3 proj = sc.xyz / sc.w * 0.5 + 0.5;
  if ( proj.z >= 1.0 || proj.z <= 0.0 ) return 1.0;
  vec2 uv = proj.xy;
  vec2 edge = min( uv, 1.0 - uv );
  if ( min( edge.x, edge.y ) <= 0.0 ) return 1.0;

  float slope = clamp( sqrt( max( 0.0, 1.0 - NdL * NdL ) ) / max( NdL, 0.12 ), 0.0, 5.0 );
  float bias = ( texelWorld * ( 0.7 + 1.15 * slope ) ) / range;
  float recv = proj.z - bias;

  float invTex = owCsmMapSize.y;
  float extent = texelWorld * owCsmMapSize.x;   // cascade world extent
  float maxR = owCsmParams.z * invTex;
  float filterR = 1.4 * invTex;

  #ifdef OW_PCSS
    float searchR = min( maxR, 10.0 * invTex );
    float blocker = 0.0;
    float count = 0.0;
    for ( int i = 0; i < OW_BLOCKER_TAPS; i ++ ) {
      float d = owCsmTap( layer, uv + owVogel( i, OW_BLOCKER_TAPS, rot ) * searchR );
      if ( d < recv ) { blocker += d; count += 1.0; }
    }
    if ( count < 0.5 ) return 1.0;
    blocker /= count;
    float gap = max( 0.0, ( recv - blocker ) * range );
    float penumbra = gap * owCsmParams.y;         // metres of penumbra
    filterR = clamp( penumbra / extent, 1.0 * invTex, maxR );
  #endif

  float sum = 0.0;
  for ( int i = 0; i < OW_PCF_TAPS; i ++ ) {
    float d = owCsmTap( layer, uv + owVogel( i, OW_PCF_TAPS, rot ) * filterR );
    sum += step( recv, d );
  }
  return sum / float( OW_PCF_TAPS );
}

// posView / nrmView are three's view-space geometryPosition / geometryNormal.
float owSunShadow( vec3 lightDirView, vec3 posView, vec3 nrmView ) {
  if ( owCsmParams.x <= 0.0 ) return 1.0;
  if ( dot( lightDirView, owSunDirView ) < 0.999 ) return 1.0;

  float vd = -posView.z;
  if ( vd >= owCsmSplit[ OW_CASCADES - 1 ] ) return 1.0;

  vec3 wPos = cameraPosition + ( posView * mat3( viewMatrix ) );
  vec3 wN = normalize( nrmView * mat3( viewMatrix ) );
  float NdL = dot( wN, owSunDirWorld );
  if ( NdL <= 0.0 ) return 1.0;

  float rot = owIGNoise( gl_FragCoord.xy + owCsmParams.w ) * 6.2831853;

  int c = OW_CASCADES - 1;
  for ( int i = 0; i < OW_CASCADES; i ++ ) {
    if ( vd < owCsmSplit[ i ] ) { c = i; break; }
  }

  float s = owCsmCascade( c, wPos, wN, NdL, rot );

  // cross-fade the last 12% of a cascade into the next one
  if ( c < OW_CASCADES - 1 ) {
    float a = owCsmSplitNear[ c ];
    float b = owCsmSplit[ c ];
    float t = smoothstep( mix( a, b, 0.88 ), b, vd );
    if ( t > 0.001 ) s = mix( s, owCsmCascade( c + 1, wPos, wN, NdL, rot ), t );
  }

  // fade the whole thing out at the far edge so there is no hard terminator
  float fadeOut = smoothstep( owCsmSplit[ OW_CASCADES - 1 ],
                              owCsmSplit[ OW_CASCADES - 1 ] * 0.88, vd );
  s = mix( 1.0, s, fadeOut );

  return mix( 1.0, s, owCsmParams.x );
}
`;
}
