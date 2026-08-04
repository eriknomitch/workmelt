import * as THREE from 'three';

/**
 * Named camera setups the screenshot harness can request. Each shot freezes
 * input, poses the camera, and optionally forces gameplay state so critics
 * always review the same framing across iterations.
 *
 * A shot is `{ pos:[x,y,z], look:[x,y,z], fov?, time?, apply?(engine) }`.
 * `time` is hour-of-day 0..24 handed to the sky system.
 */
export const SHOTS = {
  // ---- environment / lighting ----
  hero: {
    pos: [12, 1.75, 18],
    look: [-4, 2.2, -6],
    fov: 75,
    time: 16.5,
    doc: 'Wide establishing shot down the main street — reads overall art direction.',
  },
  interior: {
    pos: [-8.5, 1.7, 3.2],
    look: [2, 1.6, -2],
    fov: 70,
    time: 16.5,
    doc: 'Interior with light shafts through windows — bounce, AO, volumetrics.',
  },
  detail: {
    pos: [3.2, 1.35, 5.0],
    look: [1.4, 1.1, 2.2],
    fov: 45,
    time: 16.5,
    doc: 'Close-up on wall/prop materials — texel density, normal maps, grime.',
  },
  sunset: {
    pos: [16, 3.2, 22],
    look: [-10, 3.0, -14],
    fov: 65,
    time: 19.2,
    doc: 'Low sun — atmospheric scattering, long shadows, god rays, bloom.',
  },
  night: {
    pos: [12, 1.75, 18],
    look: [-4, 2.2, -6],
    fov: 75,
    time: 1.5,
    doc: 'Night — artificial lights, exposure adaptation, shadow quality in the dark.',
  },

  // ---- weapon / viewmodel ----
  weapon: {
    pos: [6, 1.7, 10],
    look: [-2, 1.8, -2],
    fov: 80,
    time: 16.5,
    apply: (e) => e.ctx.peek('weapons')?.debugPose?.('idle'),
    doc: 'Hip-fire viewmodel — weapon silhouette, materials, hand rig.',
  },
  ads: {
    pos: [6, 1.7, 10],
    look: [-2, 1.8, -2],
    fov: 58,
    time: 16.5,
    apply: (e) => e.ctx.peek('weapons')?.debugPose?.('ads'),
    doc: 'Aiming down sights — optic alignment, depth of field, reticle.',
  },
  scope: {
    pos: [6, 1.7, 10],
    look: [-2, 1.8, -2],
    fov: 58,
    time: 16.5,
    apply: (e) => e.ctx.peek('weapons')?.debugPose?.('ads', { weapon: 'sniper' }),
    doc: 'Scoped sniper — the eyepiece aperture mask, the bezel, the 3.3x picture.',
  },
  muzzle: {
    pos: [6, 1.7, 10],
    look: [-2, 1.8, -2],
    fov: 80,
    time: 16.5,
    apply: (e, o) => e.ctx.peek('weapons')?.debugPose?.('fire', o),
    doc: 'Mid-recoil with muzzle flash — flash shape, light spill, shell eject.',
  },

  // ---- combat / fx ----
  combat: {
    pos: [4, 1.7, 12],
    look: [-6, 1.7, -4],
    fov: 80,
    time: 16.5,
    apply: (e) => e.ctx.peek('ai')?.debugStage?.('firefight'),
    doc: 'Enemies mid-firefight — character quality, animation, impact FX.',
  },
  impacts: {
    pos: [2.5, 1.6, 6],
    // Squared up on the plaster wall 5.25 m away. The old aim looked down the
    // open market, so the burst was staged 20+ m out among the stalls and the
    // decals were never legible — the whole point of this shot.
    look: [-1.8, 1.5, 9.0],
    fov: 60,
    time: 16.5,
    apply: (e) => e.ctx.peek('fx')?.debugBurst?.('wall'),
    doc: 'Bullet impacts on a wall — decals, debris, dust puffs, sparks.',
  },
  hud: {
    pos: [12, 1.75, 18],
    look: [-4, 2.2, -6],
    fov: 80,
    time: 16.5,
    apply: (e) => e.ctx.peek('ui')?.debugState?.('combat'),
    doc: 'Full HUD in combat — layout, typography, readability, hit feedback.',
  },
};

export function installShotApi(engine, { capture, lockstep = false } = {}) {
  window.__SHOTS__ = SHOTS;

  /**
   * Screen-space boxes for every live enemy, in canvas pixels, plus their range
   * from the camera.
   *
   * `tools/visibility.mjs` uses this to score how legible each individual enemy
   * is at each quality tier. Doing it from the driver instead of from a
   * hand-maintained list of coordinates means the measurement follows whatever
   * the AI actually staged, and an actor that stopped resolving at a low
   * `renderScale` is caught by name rather than by eyeball.
   */
  window.__ACTOR_BOXES__ = () => {
    const ai = engine.ctx.peek('ai');
    const cam = engine.camera;
    const canvas = engine.ctx.canvas;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    cam.updateMatrixWorld();
    const out = [];
    for (const a of ai?.agents ?? []) {
      if (a.alive === false || !a.group?.visible) continue;
      a.group.updateMatrixWorld(true);
      box.setFromObject(a.group);
      if (box.isEmpty()) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = 0;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        v.applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -0.05) behind++;
        v.applyMatrix4(cam.projectionMatrix);
        const px = (v.x * 0.5 + 0.5) * w;
        const py = (-v.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      if (behind === 8) continue;
      if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) continue;
      out.push({
        id: a.id ?? out.length,
        variant: a.variantName ?? 'enemy',
        distance: cam.position.distanceTo(a.group.position),
        x0, y0, x1, y1,
      });
    }
    return { width: w, height: h, actors: out };
  };

  /**
   * `opts.grabFrame` is how many frames the harness will pump before it presses
   * the shutter. Shots whose subject is a transient (a muzzle flash lives ~52 ms)
   * need it so they can land the event on the captured frame instead of guessing.
   */
  window.__APPLY_SHOT__ = (name, opts = {}) => {
    const shot = SHOTS[name];
    if (!shot) return { error: `unknown shot "${name}"`, available: Object.keys(SHOTS) };

    // Freeze live input and hand the camera to the shot.
    engine.input.frozen = true;
    engine.input.enabled = false;
    const player = engine.ctx.peek('player');
    player?.setControlEnabled?.(false);

    const cam = engine.camera;
    cam.position.fromArray(shot.pos);
    const target = new THREE.Vector3().fromArray(shot.look);
    cam.lookAt(target);
    if (shot.fov) {
      cam.fov = shot.fov;
      cam.updateProjectionMatrix();
    }
    // Keep the player capsule under the camera so gameplay systems stay coherent.
    player?.teleport?.(cam.position, cam.rotation);

    // Shots are applied back to back in one browser session, so clear the
    // previous shot's *looping* debug state first. Without this the `muzzle`
    // shot's scripted burst is still emptying the magazine during `combat`, and
    // `impacts` keeps walking rounds across a wall behind the HUD shot.
    engine.ctx.peek('weapons')?.debugPose?.('idle');
    engine.ctx.peek('fx')?.debugBurst?.('none');
    engine.ctx.peek('ui')?.debugState?.('clean');

    if (shot.time !== undefined) engine.ctx.peek('sky')?.setTimeOfDay?.(shot.time);
    shot.apply?.(engine, opts);

    engine.events.emit('shot:applied', { name, shot });
    return { applied: name, pos: shot.pos, fov: shot.fov ?? engine.config.fov };
  };

  if (capture) {
    engine.input.frozen = true;
    // Fixed timestep in capture mode so temporal effects converge identically.
    //
    // `this._last = fake` before each step forces rawDt to be EXACTLY 1000/60 on
    // every frame including the first, whatever else touched `_last` (Engine.start
    // and prewarm both assign performance.now() to it). Without that, frame 1's dt
    // was 0 whenever `_last` had been stamped with a real clock and 1/60 when it
    // had not — a boot-path-dependent one-frame difference in every accumulator.
    let fake = 0;
    engine.step = ((orig) =>
      function () {
        this._last = fake;
        fake += 1000 / 60;
        return orig.call(this, fake);
      })(engine.step);
  }

  window.__RENDER_INFO__ = null;
  engine.events.on('resize', () => {});
  const snapInfo = () => {
    const r = engine.ctx.peek('render');
    window.__RENDER_INFO__ = {
      frame: engine.time.frame,
      calls: r?.renderer?.info.render.calls ?? 0,
      tris: r?.renderer?.info.render.triangles ?? 0,
      programs: r?.renderer?.info.programs?.length ?? 0,
      textures: r?.renderer?.info.memory.textures ?? 0,
      geometries: r?.renderer?.info.memory.geometries ?? 0,
      ms: engine.time.dt * 1000,
    };
  };

  /**
   * LOCKSTEP CAPTURE (`?capture=1&lockstep=1`) — the determinism fix.
   *
   * The problem it solves: the engine's own rAF loop keeps stepping while the
   * driver is doing round trips (waitForFunction on __READY__, the evaluate that
   * applies the shot, the screenshot RPC itself). The number of frames that fit
   * inside those round trips is wall-clock dependent, so `engine.time.frame` at
   * the moment the shutter fires drifted 10-20 frames run to run. Everything
   * phase-locked to the absolute frame index — TAA jitter (render/index.js:1067),
   * GTAO / SSR / contact-shadow noise rotation (`frame % 64`), exposure
   * adaptation, and the cadence of every scripted transient — therefore resolved
   * differently on every run. That, not any subsystem clock read, is what made
   * two identical runs differ and what made pre-warm (which burns ~1.4 s of wall
   * clock before the loop starts) look like a visual change.
   *
   * The fix: in lockstep mode the engine NEVER schedules its own frames. Frames
   * only happen inside __PUMP__(n), which advances exactly n of them. The frame
   * index at the shutter is then a constant, and nothing at all advances while
   * the screenshot is being taken.
   */
  if (lockstep) {
    engine.start = function () { this._running = true; };
    window.__LOCKSTEP__ = true;

    /** Advance exactly `n` engine frames, one per rAF so each is presented. */
    window.__PUMP__ = (n = 1) => new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        engine.step();
        snapInfo();
        if (++i >= n) resolve(engine.time.frame);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    /** Yield `n` rAFs WITHOUT stepping, so the compositor picks up the last
     *  rendered frame before the screenshot. Advances no simulation state. */
    window.__PRESENT__ = (n = 2) => new Promise((resolve) => {
      let i = 0;
      const tick = () => (++i >= n ? resolve(engine.time.frame) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  } else {
    window.__LOCKSTEP__ = false;
    // Free-running: the engine drives itself, __PUMP__ just waits out n frames.
    window.__PUMP__ = (n = 1) => new Promise((resolve) => {
      let i = 0;
      const tick = () => (++i >= n ? resolve(engine.time.frame) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
    window.__PRESENT__ = window.__PUMP__;
    const info = () => { snapInfo(); requestAnimationFrame(info); };
    requestAnimationFrame(info);
  }

  return { pump: window.__PUMP__, present: window.__PRESENT__, lockstep: !!lockstep };
}
