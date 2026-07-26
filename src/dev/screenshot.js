/**
 * Screenshots from a browser that is already running.
 *
 * WHY THIS IS NOT tools/capture.mjs
 * ---------------------------------
 * `tools/capture.mjs` launches its own headless Chromium, boots the game, poses
 * a named shot and exits. That is the right tool for a reproducible frame and
 * the wrong tool for "I am playing right now and something looks wrong" — it
 * cannot see the session you are in, your camera, your weapon state, or the bug
 * you just triggered.
 *
 * This module captures the live session instead, and writes the PNG into
 * `artifacts/` next to a JSON sidecar describing the exact conditions.
 *
 * THE ONE HARD CONSTRAINT
 * -----------------------
 * The renderer is created with `preserveDrawingBuffer: false`
 * (src/render/index.js). A WebGL drawing buffer is cleared once the browser
 * composites it, so `canvas.toBlob()` from a `setTimeout`, a promise
 * continuation, or a devtools console line returns a **blank or torn image**.
 * The snapshot has to be taken in the same task as the draw.
 *
 * So a request is queued and drained by a hook that runs immediately after
 * `Engine.step()` returns — at which point the render subsystem has drawn and
 * the buffer is still intact. `toBlob()` takes its snapshot synchronously and
 * only the PNG *encode* is async, which is why this works and a naive
 * `await canvas.toBlob()` from the console does not.
 *
 * WHAT LANDS IN THE ARTIFACT
 * --------------------------
 * The canvas only — the DOM HUD (crosshair, ammo, minimap, perf readout) is not
 * part of the WebGL surface and cannot be composited in without a DOM
 * rasterizer, which would mean a new dependency (hard rule 3). When you need the
 * HUD in the frame, use `tools/attach-shot.mjs`, which drives the same running
 * browser over CDP and screenshots the composited page.
 *
 * USAGE
 * -----
 *   F2                       capture the current frame
 *   __SHOT__()               same, from the console — returns a Promise
 *   __SHOT__('reload-clip')  name it
 *   __SHOT__.burst(8, 250)   8 frames, 250 ms apart — for catching a transient
 *
 * In `npm run dev` the PNG is POSTed to the dev server and written to
 * `artifacts/shots/` (see the `ow-shot-sink` plugin in vite.config.js). In a
 * production build there is no sink, so it falls back to a browser download.
 */

/** Where the dev-server sink listens. Must match vite.config.js. */
const SINK = '/__shot';

export function installScreenshotApi(engine, { capture = false } = {}) {
  // Capture runs own the frame loop and already have a screenshot path; adding a
  // second step hook there would fight src/dev/shots.js's lockstep patch.
  if (capture) return { shot: async () => null, dispose: () => {} };

  const queue = [];
  let seq = 0;
  let sinkAvailable = true;

  /* ------------------------------------------------------------- metadata -- */

  function describe(name) {
    const cam = engine.camera;
    const renderSys = engine.ctx.peek('render');
    const gl = renderSys?.renderer?.getContext?.();
    const perf = engine.perf;
    const r3 = (v) => +v.toFixed(3);
    return {
      name,
      // Wall-clock date is fine here: this is out-of-band dev tooling and never
      // feeds simulation, which is what hard rule 4 and the capture harness care
      // about.
      at: new Date().toISOString(),
      url: location.href,
      frame: engine.time.frame,
      elapsed: r3(engine.time.elapsed),
      quality: engine.config.quality,
      renderScale: engine.config.q?.renderScale,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      drawingBuffer: gl ? { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight } : null,
      camera: {
        position: [r3(cam.position.x), r3(cam.position.y), r3(cam.position.z)],
        rotation: [r3(cam.rotation.x), r3(cam.rotation.y), r3(cam.rotation.z)],
        fov: r3(cam.fov),
      },
      // The perf snapshot is the reason a shot is worth keeping: it pins the
      // visual to the frame cost that produced it, so a before/after pair is
      // evidence rather than two pictures.
      perf: perf ? perf.stats() : null,
    };
  }

  /* -------------------------------------------------------------- capture -- */

  /**
   * Runs inside the post-step hook. Must call toBlob() before yielding.
   */
  function drain() {
    const pending = queue.splice(0, queue.length);
    if (!pending.length) return;
    const canvas = engine.canvas;
    for (const req of pending) {
      const meta = describe(req.name);
      // Snapshot is taken here, synchronously; the callback only receives the
      // finished PNG encode.
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            req.reject(new Error('canvas.toBlob returned null — is the context lost?'));
            return;
          }
          meta.bytes = blob.size;
          deliver(blob, meta).then(req.resolve, req.reject);
        },
        'image/png'
      );
    }
  }

  /** Try the dev-server sink first, fall back to a download. */
  async function deliver(blob, meta) {
    if (sinkAvailable) {
      try {
        const res = await fetch(`${SINK}?name=${encodeURIComponent(meta.name)}`, {
          method: 'POST',
          headers: {
            'content-type': 'image/png',
            // Metadata rides in a header so the body stays raw PNG — base64 in a
            // JSON body would inflate a 4 MB frame by a third for no reason.
            'x-shot-meta': encodeURIComponent(JSON.stringify(meta)),
          },
          body: blob,
        });
        if (res.ok) {
          const out = await res.json();
          console.info(`[shot] ${out.path} (${(meta.bytes / 1024).toFixed(0)} kB)`);
          return { ...meta, saved: true, path: out.path };
        }
        // 404 means this is a production build with no sink — stop retrying.
        if (res.status === 404) sinkAvailable = false;
      } catch {
        sinkAvailable = false;
      }
    }
    download(blob, `${meta.name}.png`);
    console.info(`[shot] no dev-server sink — downloaded ${meta.name}.png`);
    return { ...meta, saved: false, downloaded: true };
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoke on the next turn: doing it synchronously can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /* ------------------------------------------------------------- step hook -- */

  const originalStep = engine.step;
  engine.step = function (now) {
    const out = originalStep.call(this, now);
    // The render subsystem has drawn by the time step() returns, so the drawing
    // buffer is still valid on this line and invalid on the next task.
    if (queue.length) drain();
    return out;
  };

  /* ------------------------------------------------------------------ api -- */

  function shot(name) {
    return new Promise((resolve, reject) => {
      const auto = `shot-${String(++seq).padStart(3, '0')}-f${engine.time.frame}`;
      queue.push({ name: sanitize(name) || auto, resolve, reject });
    });
  }

  /**
   * N shots `everyMs` apart. Transients (muzzle flash, a reload pose, a hitch)
   * are gone by the time you can press a key twice.
   */
  shot.burst = async function burst(count = 6, everyMs = 200, prefix = 'burst') {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(await shot(`${prefix}-${String(i + 1).padStart(2, '0')}`));
      if (i < count - 1) await new Promise((r) => setTimeout(r, everyMs));
    }
    return out;
  };

  const onKey = (e) => {
    if (e.code !== 'F2' || e.repeat || e.metaKey || e.ctrlKey) return;
    // Don't steal the key from the multiplayer callsign field.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    shot().catch((err) => console.warn('[shot] failed', err));
  };
  addEventListener('keydown', onKey);

  window.__SHOT__ = shot;

  return {
    shot,
    dispose() {
      removeEventListener('keydown', onKey);
      engine.step = originalStep;
      if (window.__SHOT__ === shot) delete window.__SHOT__;
    },
  };
}

/** Keep names filesystem-safe — they become filenames on the sink side too. */
function sanitize(name) {
  if (typeof name !== 'string') return '';
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
