import * as THREE from 'three';
import { el, clamp, clamp01, lerp } from './util.js';

const BAKE = 512; // one-time top-down render resolution
const CAM_Y = 26; // ortho camera height above y=0
const NEAR = 0.1;
const FAR = 34; // reaches 8m below y=0, so basements/slopes still register
const HEIGHT_RANGE = CAM_Y; // metres of vertical range mapped into the height ramp

/**
 * Tactical minimap, top left.
 *
 * The map itself is a genuine orthographic top-down render of the level: once
 * the world subsystem has built its geometry we render the scene from above
 * with MeshDepthMaterial into a 512² target, read it back once, and turn the
 * height field into a stylised map bitmap on an offscreen canvas — floor tone,
 * a height ramp for structures, and a Sobel pass for crisp roof outlines.
 * After that one bake, per-frame cost is a single drawImage plus blips.
 *
 * Player arrow stays centred and rotates (map is north-up, matching the
 * compass strip); enemy blips are drawn from whatever the ai subsystem
 * publishes via `getHudActors()`.
 */
export class Minimap {
  constructor(parent, rng) {
    this.root = el('div', 'ow-minimap', parent);
    this.canvas = el('canvas', null, this.root);
    this.g = this.canvas.getContext('2d');
    for (const c of ['tl', 'tr', 'bl', 'br']) el('div', 'ow-mm-corner ' + c, this.root);
    el('div', 'ow-mm-n', this.root, 'N');
    const tag = el('div', 'ow-mm-tag', this.root);
    el('span', null, tag, 'ZONE 07');
    this.scaleTag = el('span', null, tag, '60M');

    this.rng = rng;
    this.k = 1;
    this.cssSize = 178;
    this.span = 190; // metres covered by the bake
    this.viewSpan = 60; // metres visible in the widget
    this.centre = new THREE.Vector2(0, 0);

    this.baked = null;
    this.bakeTries = 0;
    this.bakeDone = false;

    this._rt = null;
    this._pixels = null;
    this._depthMat = null;
    this._cam = null;
    this._hidden = [];
    this._box = new THREE.Box3();
    this._sphere = new THREE.Sphere();
    this._probe = new THREE.Vector3();

    this.resize(1);
  }

  resize(k) {
    this.k = k;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(this.cssSize * k * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.px = px;
  }

  /* --------------------------------------------------------------- bake --- */

  /**
   * Throw the baked bitmap away so the next `tryBake` draws the new level.
   * Called when `world` reports a map change — the bake is a picture of a
   * specific set of footprints, and after a rebuild it is a picture of a level
   * that no longer exists.
   */
  invalidate() {
    this.baked = null;
    this.bakeDone = false;
    this.bakeTries = 0;
  }

  tryBake(ctx) {
    if (this.bakeDone || this.bakeTries > 6) return;
    this.bakeTries++;
    // The honest map first: real layout polygons. The depth bake below is the
    // fallback for a scene that has no world subsystem in it.
    if (this._buildVectorMap(ctx)) {
      this.bakeDone = true;
      this._releaseGpu();
      return;
    }
    const r = ctx.peek('render');
    const renderer = r?.renderer;
    if (!renderer) return;

    try {
      if (!this._rt) {
        this._rt = new THREE.WebGLRenderTarget(BAKE, BAKE, {
          depthBuffer: true,
          stencilBuffer: false,
          type: THREE.UnsignedByteType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        });
        this._pixels = new Uint8Array(BAKE * BAKE * 4);
        this._depthMat = new THREE.MeshDepthMaterial({
          depthPacking: THREE.BasicDepthPacking,
        });
        const h = this.span * 0.5;
        this._cam = new THREE.OrthographicCamera(-h, h, h, -h, NEAR, FAR);
        this._cam.up.set(0, 0, -1); // north (-Z) points up on the map
      }

      const scene = ctx.scene;
      const cam = this._cam;
      cam.position.set(this.centre.x, CAM_Y, this.centre.y);
      cam.lookAt(this.centre.x, 0, this.centre.y);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();

      // A sky dome or a 1km ground plane would swallow the whole map: hide
      // anything implausibly large, plus billboards and point clouds.
      const hidden = this._hidden;
      hidden.length = 0;
      scene.traverse((o) => {
        if (!o.visible) return;
        if (o.isSprite || o.isPoints || o.isLine) {
          hidden.push(o);
          return;
        }
        const geo = o.isMesh ? o.geometry : null;
        if (geo) {
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          const rad = (geo.boundingSphere?.radius ?? 0) * o.matrixWorld.getMaxScaleOnAxis();
          if (rad > 260) hidden.push(o);
        }
      });
      for (const o of hidden) o.visible = false;

      const prevFog = scene.fog;
      const prevOverride = scene.overrideMaterial;
      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      const prevShadowAuto = renderer.shadowMap.autoUpdate;
      scene.fog = null;
      scene.overrideMaterial = this._depthMat;
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(this._rt);
      // BasicDepthPacking writes (1 - fragCoordZ), so 0 is the far plane:
      // clearing to black makes "nothing here" read as ground level.
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(this._rt, 0, 0, BAKE, BAKE, this._pixels);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = prevAutoClear;
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      scene.fog = prevFog;
      scene.overrideMaterial = prevOverride;

      for (const o of hidden) o.visible = true;
      hidden.length = 0;

      if (this._buildBitmap()) {
        this.bakeDone = true;
        this._releaseGpu();
      }
    } catch (err) {
      console.warn('[ui] minimap bake failed', err);
      this._releaseGpu();
      this.bakeDone = true; // fall back to the procedural grid
    }
  }

  /**
   * Vector layout map.
   *
   * The depth bake renders whatever geometry is in the scene, which at this
   * scale means roof props, parapets, awnings, cables and debris: it produced a
   * field of overlapping rounded blobs with no streets in it, bearing no
   * relationship to the alley the player is standing in. The real map is two
   * dozen axis-aligned footprints in LEVEL space plus a walkable network, so ask
   * the world subsystem for them at runtime (`buildings[].spec`, `isOpen`) and
   * draw them as polygons — the street network as a LIGHTER fill so the road
   * reads as the negative space between the blocks, which is how you recognise
   * the alley you are standing in.
   *
   * The level-to-canvas affine is recovered from three probe points through
   * `levelToWorld`, so the map inherits the world's level yaw without this
   * module knowing anything about it.
   */
  _buildVectorMap(ctx) {
    const world = ctx.peek('world');
    const infos = world?.buildings;
    if (!Array.isArray(infos) || !infos.length) return false;
    if (typeof world.levelToWorld !== 'function' || typeof world.isOpen !== 'function')
      return false;

    const N = BAKE;
    const ppm = N / this.span;
    const p = this._probe;
    const o = world.levelToWorld(0, 0, 0, p);
    const ox = o.x;
    const oz = o.z;
    const ex = world.levelToWorld(1, 0, 0, p);
    const xx = ex.x - ox;
    const xz = ex.z - oz;
    const ez = world.levelToWorld(0, 0, 1, p);
    const zx = ez.x - ox;
    const zz = ez.z - oz;
    if (!Number.isFinite(xx) || !Number.isFinite(zz)) return false;

    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const g = cv.getContext('2d');

    // out-of-play ground: the darkest tone on the panel, but nowhere near black
    g.fillStyle = '#2b343d';
    g.fillRect(0, 0, N, N);

    // level -> canvas, so everything below is authored in metres of LEVEL space
    g.setTransform(
      xx * ppm,
      xz * ppm,
      zx * ppm,
      zz * ppm,
      (ox - this.centre.x) * ppm + N * 0.5,
      (oz - this.centre.y) * ppm + N * 0.5
    );

    // ---- street / alley network, as run-length rects in level space --------
    // isOpen() is authored in world space; the affine above converts, so the
    // runs come out exactly axis-aligned in the level frame they were authored
    // in and tile without seams.
    //
    // The window comes from the MAP'S OWN BOUNDS, clamped to what the bake can
    // hold. It used to be the market's extent as four literals, which drew no
    // floor at all past x = ±44 — invisible on every map until one shipped
    // wider than that (Blood Gulch is 104 m across), and then it is a minimap
    // that goes blank in the last 8 m at each end of the canyon.
    const HALF = this.span * 0.5;
    const bounds = world.map?.bounds;
    const bx0 = Math.max(-HALF, bounds ? bounds[0] : -44);
    const bx1 = Math.min(HALF, bounds ? bounds[3] : 44);
    const bz0 = Math.max(-HALF, bounds ? bounds[2] : -64);
    const bz1 = Math.min(HALF, bounds ? bounds[5] : 54);
    const STEP = 0.5;
    g.fillStyle = '#63717e';
    for (let lz = bz0; lz < bz1; lz += STEP) {
      let run = -1;
      for (let lx = bx0; lx <= bx1 + STEP; lx += STEP) {
        const cxw = ox + lx * xx + (lz + STEP * 0.5) * zx;
        const czw = oz + lx * xz + (lz + STEP * 0.5) * zz;
        const open = lx <= bx1 && world.isOpen(cxw, czw, 0);
        if (open && run < 0) run = lx;
        else if (!open && run >= 0) {
          g.fillRect(run, lz, lx - run, STEP * 1.16);
          run = -1;
        }
      }
    }

    // ---- building footprints ---------------------------------------------
    for (let i = 0; i < infos.length; i++) {
      const spec = infos[i]?.spec ?? infos[i];
      if (!spec || spec.w === undefined || spec.d === undefined) continue;
      const x0 = (spec.x ?? 0) - spec.w * 0.5;
      const z0 = (spec.z ?? 0) - spec.d * 0.5;
      // taller mass reads slightly lighter, so the skyline is legible on the map
      const t = clamp01(((spec.floors ?? 2) - 1) / 3);
      g.fillStyle = 'rgb(' + Math.round(lerp(50, 68, t)) + ',' +
        Math.round(lerp(59, 79, t)) + ',' + Math.round(lerp(68, 90, t)) + ')';
      g.fillRect(x0, z0, spec.w, spec.d);
      // a light return on the north and west edges: a cheap key-light cue that
      // separates two footprints sharing a wall
      g.fillStyle = 'rgba(206,228,244,.20)';
      g.fillRect(x0, z0, spec.w, 0.34);
      g.fillRect(x0, z0, 0.34, spec.d);
      g.fillStyle = 'rgba(3,7,10,.34)';
      g.fillRect(x0, z0 + spec.d - 0.34, spec.w, 0.34);
      g.fillRect(x0 + spec.w - 0.34, z0, 0.34, spec.d);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    // ---- grain: no HUD surface is a flat colour --------------------------
    const img = g.getImageData(0, 0, N, N);
    const d = img.data;
    const rng = this.rng;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng.float() - 0.5) * 5.5;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    this.baked = cv;
    return true;
  }

  _releaseGpu() {
    this._rt?.dispose();
    this._rt = null;
    this._depthMat?.dispose();
    this._depthMat = null;
    this._pixels = null;
  }

  /**
   * Height field -> stylised map bitmap.
   *
   * A binary occupancy mask drives the footprints, but nothing is composited at
   * mask resolution: occupancy and the (premultiplied) roof colour are both
   * blurred with a small separable tent kernel, so footprints resolve as
   * coverage in 0..1 and the map has soft, non-shimmering edges instead of the
   * aliased 1px outlines it used to draw. The fill is a height ramp with a fake
   * NW key light, held deliberately low in value — the map is a *background*
   * for the arrow, blips and objective pips, so it stays well under them. The
   * boundary rim is derived from the same coverage field (peaking at cov=0.5),
   * which keeps it low-contrast and inherently anti-aliased.
   *
   * Every pixel is written fully opaque: the widget must composite as one solid
   * layer so nothing in the frame can ever read *through* the map.
   */
  _buildBitmap() {
    const px = this._pixels;
    if (!px) return false;
    const N = BAKE;
    const hgt = new Float32Array(N * N);
    const occ = new Uint8Array(N * N);
    let occupied = 0;
    for (let i = 0; i < N * N; i++) {
      // MeshDepthMaterial + BasicDepthPacking stores (1 - fragCoordZ), and
      // fragCoordZ is linear for an ortho camera: recover world height.
      const d = px[i * 4] / 255;
      const h = clamp(CAM_Y - NEAR - (1 - d) * (FAR - NEAR), 0, HEIGHT_RANGE);
      hgt[i] = h;
      if (h > 1.35) {
        occ[i] = 1;
        occupied++;
      }
    }
    // Nothing built yet (or an empty scene) — try again in a few frames.
    if (occupied < N * N * 0.004) return false;

    // ---- roof colour, premultiplied by occupancy (bake space) -------------
    const cov = new Float32Array(N * N);
    const cr = new Float32Array(N * N);
    const cg = new Float32Array(N * N);
    const cb = new Float32Array(N * N);
    for (let by = 0; by < N; by++) {
      for (let bx = 0; bx < N; bx++) {
        const bi = by * N + bx;
        if (!occ[bi]) continue;
        const h = hgt[bi];
        const t = clamp01((h - 1.35) / 11);
        // fake key light from the north-west so blocks read as volumes
        const inX = bx > 0 ? hgt[bi - 1] : h;
        const inY = by < N - 1 ? hgt[bi + N] : h;
        const key = clamp(((h - inX) + (h - inY)) * 0.22, -0.25, 0.35);
        cov[bi] = 1;
        cr[bi] = lerp(18, 36, t) * (1 + key);
        cg[bi] = lerp(24, 47, t) * (1 + key);
        cb[bi] = lerp(30, 55, t) * (1 + key);
      }
    }

    // ---- separable radius-1 box blur (one pass = a 3x3 tent) --------------
    const tmp = new Float32Array(N * N);
    const blur = (buf, passes) => {
      for (let pass = 0; pass < passes; pass++) {
        for (let y = 0; y < N; y++) {
          const row = y * N;
          for (let x = 0; x < N; x++) {
            const a = buf[row + (x > 0 ? x - 1 : 0)];
            const b = buf[row + x];
            const c = buf[row + (x < N - 1 ? x + 1 : N - 1)];
            tmp[row + x] = (a + b + c) / 3;
          }
        }
        for (let x = 0; x < N; x++) {
          for (let y = 0; y < N; y++) {
            const a = tmp[(y > 0 ? y - 1 : 0) * N + x];
            const b = tmp[y * N + x];
            const c = tmp[(y < N - 1 ? y + 1 : N - 1) * N + x];
            buf[y * N + x] = (a + b + c) / 3;
          }
        }
      }
    };
    // One radius-1 pass is enough: the bake is resampled ~2x on the way to the
    // widget, so bilinear upscaling carries the rest of the softness. Two
    // passes turned the rim into a glow.
    blur(cov, 1);
    blur(cr, 1);
    blur(cg, 1);
    blur(cb, 1);

    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const g = cv.getContext('2d');
    const img = g.createImageData(N, N);
    const o = img.data;
    const rng = this.rng;

    // street tone — never pure black, always slightly blue
    const FR = 9;
    const FG = 13;
    const FB = 17;
    // boundary rim: a whisper above the fill, not a wireframe
    const RR = 62;
    const RG = 82;
    const RB = 97;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // readRenderTargetPixels is bottom-up; flip into image space
        const si = (N - 1 - y) * N + x;
        const grain = (rng.float() - 0.5) * 3.2;

        const w = cov[si];
        let R = FR;
        let G = FG;
        let B = FB;
        if (w > 0.002) {
          const iw = 1 / w;
          R = lerp(FR, cr[si] * iw, w);
          G = lerp(FG, cg[si] * iw, w);
          B = lerp(FB, cb[si] * iw, w);
        }

        // soft footprint rim, peaking on the coverage midline
        const rim = 4 * w * (1 - w);
        if (rim > 0.002) {
          const a = rim * rim * 0.66;
          R = lerp(R, RR, a);
          G = lerp(G, RG, a);
          B = lerp(B, RB, a);
        }

        const di = (y * N + x) * 4;
        o[di] = R + grain;
        o[di + 1] = G + grain;
        o[di + 2] = B + grain;
        o[di + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.baked = cv;
    return true;
  }

  /* --------------------------------------------------------------- draw --- */

  /**
   * @param {object} s { x, z, heading(deg), fov(deg), blips:[{x,z,kind,heading}],
   *                     objectives:[{x,z,label}] }
   */
  draw(s) {
    const g = this.g;
    const S = this.px;
    if (!S) return;
    const half = S * 0.5;
    const ppm = S / this.viewSpan; // canvas pixels per metre

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);

    // base plate — never pure black, always slightly blue. Opaque, and every
    // layer above it is opaque or drawn over it, so the widget composites as a
    // single solid tile: nothing in the scene can show through the map.
    g.fillStyle = '#2b343d';
    g.fillRect(0, 0, S, S);

    g.save();
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();

    const cx = s.x ?? 0;
    const cz = s.z ?? 0;

    if (this.baked) {
      const bppm = BAKE / this.span;
      const srcW = this.viewSpan * bppm;
      const sx = (cx - this.centre.x) * bppm + BAKE * 0.5 - srcW * 0.5;
      const sy = (cz - this.centre.y) * bppm + BAKE * 0.5 - srcW * 0.5;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.baked, sx, sy, srcW, srcW, 0, 0, S, S);
    } else {
      g.fillStyle = '#2b333b';
      g.fillRect(0, 0, S, S);
    }

    // 10m grid, phase-locked to world space so it scrolls with the player
    const u = S / this.cssSize; // canvas pixels per css reference pixel
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(10,17,23,.20)';
    g.beginPath();
    const n0x = Math.floor((cx - this.viewSpan * 0.5) / 10);
    const n1x = Math.ceil((cx + this.viewSpan * 0.5) / 10);
    for (let n = n0x; n <= n1x; n++) {
      const X = Math.round((n * 10 - cx) * ppm + half) + 0.5;
      g.moveTo(X, 0);
      g.lineTo(X, S);
    }
    const n0z = Math.floor((cz - this.viewSpan * 0.5) / 10);
    const n1z = Math.ceil((cz + this.viewSpan * 0.5) / 10);
    for (let n = n0z; n <= n1z; n++) {
      const Y = Math.round((n * 10 - cz) * ppm + half) + 0.5;
      g.moveTo(0, Y);
      g.lineTo(S, Y);
    }
    g.stroke();

    // view cone
    const heading = ((s.heading ?? 0) * Math.PI) / 180;
    const fov = (((s.fov ?? 80) * 0.5) * Math.PI) / 180;
    const coneR = S * 0.42;
    const grad = g.createRadialGradient(half, half, 2, half, half, coneR);
    grad.addColorStop(0, 'rgba(222,242,255,.26)');
    grad.addColorStop(0.7, 'rgba(222,242,255,.075)');
    grad.addColorStop(1, 'rgba(214,238,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(half, half);
    g.arc(half, half, coneR, -Math.PI / 2 + heading - fov, -Math.PI / 2 + heading + fov);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(226,244,255,.17)';
    g.lineWidth = 1;
    g.stroke();

    // objectives
    const objs = s.objectives;
    if (objs) {
      g.font = `700 ${(9.5 * u).toFixed(1)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const r = 6 * u;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        const dx = clamp((o.x - cx) * ppm + half, r + 1, S - r - 1);
        const dy = clamp((o.z - cz) * ppm + half, r + 1, S - r - 1);
        g.fillStyle = 'rgba(121,210,255,.94)';
        g.strokeStyle = 'rgba(4,14,20,.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.rect(dx - r, dy - r, r * 2, r * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#06171f';
        g.fillText(o.label ?? '', dx, dy + 0.5);
      }
    }

    // blips
    const blips = s.blips;
    if (blips) {
      for (let i = 0; i < blips.length; i++) {
        const b = blips[i];
        const dx = (b.x - cx) * ppm + half;
        const dy = (b.z - cz) * ppm + half;
        if (dx < -8 || dy < -8 || dx > S + 8 || dy > S + 8) continue;
        const enemy = b.kind !== 'friend';
        const r = 3.4 * u;
        g.save();
        g.translate(dx, dy);
        g.rotate(((b.heading ?? 0) * Math.PI) / 180);
        g.fillStyle = enemy ? 'rgba(255,74,58,.96)' : 'rgba(126,196,255,.95)';
        g.shadowColor = enemy ? 'rgba(255,60,40,.85)' : 'rgba(120,190,255,.7)';
        g.shadowBlur = 6 * u;
        g.beginPath();
        g.moveTo(0, -r * 1.5);
        g.lineTo(r * 1.15, r * 1.1);
        g.lineTo(-r * 1.15, r * 1.1);
        g.closePath();
        g.fill();
        g.restore();
      }
    }

    // player arrow
    g.save();
    g.translate(half, half);
    g.rotate(heading);
    const pr = 4.8 * u;
    g.beginPath();
    g.moveTo(0, -pr * 1.55);
    g.lineTo(pr * 1.15, pr * 1.3);
    g.lineTo(0, pr * 0.6);
    g.lineTo(-pr * 1.15, pr * 1.3);
    g.closePath();
    g.fillStyle = '#f6fcff';
    g.strokeStyle = 'rgba(2,6,10,.85)';
    g.lineWidth = 1.6 * u;
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(180,225,255,.85)';
    g.shadowBlur = 5 * u;
    g.stroke();
    g.fill();
    g.shadowBlur = 0;
    g.restore();

    // edge falloff so the map sinks into the frame instead of ending abruptly
    const vg = g.createRadialGradient(half, half, S * 0.28, half, half, S * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.17)');
    g.fillStyle = vg;
    g.fillRect(0, 0, S, S);

    g.restore();
  }

  dispose() {
    this._releaseGpu();
    this.baked = null;
    this.root.remove();
  }
}
