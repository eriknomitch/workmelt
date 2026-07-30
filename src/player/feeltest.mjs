#!/usr/bin/env node
/**
 * Player feel bench — the only honest way to review a movement controller.
 *
 * Boots the real game in Chromium, disables the renderer, and drives the engine
 * one deterministic 1/60 step at a time while faking keyboard input. Then it
 * measures what actually happened: top speeds, time-to-speed, jump apex, slide
 * decay curve, stance heights, mantle/vault success, footstep cadence, FOV
 * blends, health regen.
 *
 *   node src/player/feeltest.mjs --port=5209
 *   node src/player/feeltest.mjs --port=5209 --json
 *
 * Nothing in the game depends on this file; it is a review tool.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const PORT = Number(args.port ?? 5209);

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

async function ensureServer() {
  if (await portOpen(PORT)) return null;
  const root = resolve(import.meta.dirname, '../..');
  const p = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) return p;
  }
  p.kill();
  throw new Error('vite failed to start');
}

const server = await ensureServer();
const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
}));
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let result = null;
let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  result = await page.evaluate(runBench);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
  if (server) server.kill();
}

if (failed) {
  console.error(logs.slice(-30).join('\n'));
  console.error(String(failed.message ?? failed));
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  report(result);
}

/* ===================================================================== */

function report(r) {
  const rows = [];
  const row = (name, got, want, ok, unit = '') =>
    rows.push({ test: name, measured: fmt(got) + unit, expected: want, ok: ok ? 'PASS' : 'FAIL' });
  const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) < 100 ? v.toFixed(3) : v.toFixed(1)) : String(v));
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  row('walk top speed', r.walk.speed, '4.57 m/s', near(r.walk.speed, 4.57, 0.12));
  row('walk time to 90%', r.walk.t90, '< 0.09 s', r.walk.t90 <= 0.09);
  row('stop time', r.walk.stopTime, '0.08-0.30 s', r.walk.stopTime > 0.08 && r.walk.stopTime < 0.3);
  row('strafe speed', r.strafe.speed, '~4.2 m/s', near(r.strafe.speed, 4.2, 0.25));
  row('back speed', r.back.speed, '~3.66 m/s', near(r.back.speed, 3.66, 0.25));
  row('sprint top speed', r.sprint.speed, '7.01 m/s', near(r.sprint.speed, 7.01, 0.15));
  row('tac sprint speed', r.tacSprint.speed, '8.38 m/s', near(r.tacSprint.speed, 8.38, 0.2));
  row('crouch speed', r.crouch.speed, '2.44 m/s', near(r.crouch.speed, 2.44, 0.15));
  row('crouch eye height', r.crouch.eye, '1.02 m', near(r.crouch.eye, 1.02, 0.03));
  row('prone eye height', r.prone.eye, '0.40 m', near(r.prone.eye, 0.4, 0.03));
  row('ads speed', r.ads.speed, '~2.29 m/s', near(r.ads.speed, 2.29, 0.2));
  row('ads fov', r.ads.fov, '57.6 deg', near(r.ads.fov, 57.6, 0.6));
  row('sprint fov', r.sprint.fov, '> 82 deg', r.sprint.fov > 82);
  row('jump apex', r.jump.apex, '0.60 m', near(r.jump.apex, 0.6, 0.06));
  row('air time', r.jump.airTime, '~0.48 s', near(r.jump.airTime, 0.48, 0.08));
  row('air control ratio', r.air.controlRatio, '0.15-0.40', r.air.controlRatio > 0.15 && r.air.controlRatio < 0.4);
  row('slide entry speed', r.slide.entry, '~7.0 m/s', near(r.slide.entry, 7.01, 0.2));
  row('slide peak speed', r.slide.peak, '8.4-8.9 m/s', r.slide.peak > 8.4 && r.slide.peak < 8.95);
  row('slide blocked?', r.slide.blocked ? 'yes' : 'no', 'no', !r.slide.blocked);
  row('slide duration', r.slide.duration, '0.75-0.95 s', r.slide.duration > 0.7 && r.slide.duration <= 0.95);
  row('slide exit stance', r.slide.exitStance, 'crouch', r.slide.exitStance === 'crouch');
  row('slide camera dip', r.slide.dip, '< -0.05 m', r.slide.dip < -0.05);
  row('slide cancel airborne', r.slideCancel.airborne, 'true', r.slideCancel.airborne === true);
  row('slide cancel speed kept', r.slideCancel.speed, '> 5.5 m/s', r.slideCancel.speed > 5.5);
  row('landing dip', r.land.dip, '< -0.04 m', r.land.dip < -0.04);
  row('landing dip recovers', r.land.recovered, '< 0.01 m', Math.abs(r.land.recovered) < 0.01);
  row('land event speed', r.land.eventSpeed, '> 4 m/s', r.land.eventSpeed > 4);
  row('footsteps / 10 m walk', r.steps.count, '6-8', r.steps.count >= 6 && r.steps.count <= 8);
  row('footstep surfaces', r.steps.surfaces, 'non-empty', r.steps.surfaces.length > 0);
  row('bob amplitude (walk)', r.bob.amp, '0.005-0.03 m', r.bob.amp > 0.005 && r.bob.amp < 0.03);
  row('bob is figure-eight', r.bob.ratio, 'y period = x/2', r.bob.ratio > 1.6 && r.bob.ratio < 2.4);
  row('lean camera offset', r.lean.offset, '> 0.25 m', r.lean.offset > 0.25);
  row('lean roll', r.lean.roll, '> 8 deg', r.lean.roll > 8);
  row('auto-vault (0.55 m)', r.vault.ok, 'cleared', r.vault.ok);
  row('auto-vault fired', r.vault.kinds.join(',') || 'none', 'vault', r.vault.kinds.includes('vault'));
  row('mantle (1.15 m)', r.mantle.ok, 'on top', r.mantle.ok);
  row('mantle duration', r.mantle.duration, '0.5-0.9 s', r.mantle.duration > 0.45 && r.mantle.duration < 0.95);
  row('high wall rejected', r.tooHigh.rejected, 'true', r.tooHigh.rejected === true);
  row('stairs climbed', r.stairs.climbed, '> 0.5 m', r.stairs.climbed > 0.5);
  row('stairs not vaulted', r.stairs.ledgeEvents.join(',') || 'none', 'none', r.stairs.ledgeEvents.length === 0);
  row('health regen delay', r.health.regenStart, '4.4-5.2 s', r.health.regenStart > 4.4 && r.health.regenStart < 5.2);
  row('health refill time', r.health.refill, '< 4 s', r.health.refill < 4);
  row('damage direction', r.health.direction, '~1.57 rad', near(Math.abs(r.health.direction), 1.5708, 0.2));
  row('low-health pass on', r.health.passEnabled, 'true', r.health.passEnabled === true);
  row('recoil returns', r.recoil.residual, '< 0.05 deg', r.recoil.residual < 0.05);
  row('recoil peak', r.recoil.peak, '> 1.0 deg', r.recoil.peak > 1.0);
  row('no per-frame alloc', r.alloc.note, 'n/a', true);

  const pad = (s, n) => String(s).padEnd(n);
  console.log('');
  console.log(pad('TEST', 28) + pad('MEASURED', 14) + pad('EXPECTED', 18) + 'RESULT');
  console.log('-'.repeat(72));
  for (const x of rows) {
    console.log(pad(x.test, 28) + pad(x.measured, 14) + pad(x.expected, 18) + x.ok);
  }
  const fails = rows.filter((x) => x.ok === 'FAIL');
  console.log('-'.repeat(72));
  console.log(`${rows.length - fails.length}/${rows.length} pass`);
  if (r.notes?.length) console.log('\nnotes:\n  ' + r.notes.join('\n  '));
  if (fails.length) process.exitCode = 1;
}

/* ===================================================================== */
/* everything below runs inside the page                                 */
/* ===================================================================== */

function runBench() {
  const eng = window.__ENGINE__;
  const p = eng.ctx.get('player');
  const phys = eng.ctx.get('physics');
  const notes = [];
  eng.stop();

  // Renderer off: this bench steps thousands of frames and does not look at one.
  const render = eng.ctx.peek('render');
  const realRender = render.render;
  render.render = () => {};

  const input = eng.input;
  const DT = 1 / 60;
  const dn = (c) => input._pendingDown.add(c);
  const up = (c) => input._pendingUp.add(c);
  const release = () => {
    for (const c of [...input.down]) input._pendingUp.add(c);
    input._pendingDown.clear();
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) eng.step();
  };
  const settle = (n = 40) => {
    release();
    step(n);
  };

  // A flat, open piece of the level to test on.
  const world = eng.ctx.peek('world');
  const base = { x: 0, y: 0, z: 0, yaw: 0, fx: 0, fz: -1 };
  const place = (lane = 0, index = 0, pitchYaw = null) => {
    const sp = world?.spawn?.(index);
    // Face the way the spawn faces: that is the one direction with a long clear
    // runway. Walking on a world axis from here goes straight into a facade.
    const yaw = pitchYaw ?? (sp?.yaw ?? 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const gx = (sp ? sp.position.x : 0) + rx * lane;
    const gz = (sp ? sp.position.z : 0) + rz * lane;
    const gy = phys.groundHeight(gx, gz, (sp ? sp.position.y : 0) + 8);
    const feet = Number.isFinite(gy) ? gy : 0;
    base.x = gx; base.y = feet; base.z = gz;
    base.yaw = yaw; base.fx = fx; base.fz = fz;
    p.teleport({ x: gx, y: feet + 1.66, z: gz }, yaw);
    p.health.reset(true);
    p.health.effect = 0;
    step(4);
  };
  /** Point `d` metres in front of the placed player. */
  const ahead = (d) => ({ x: base.x + base.fx * d, z: base.z + base.fz * d });

  /** Is there `d` metres of empty corridor in front of us? */
  const clearAhead = (d) => {
    const c = p.character;
    const a = { x: c.position.x, y: c.position.y + 0.36, z: c.position.z };
    const b = { x: c.position.x, y: c.position.y + 1.62, z: c.position.z };
    const hit = phys.capsuleCast(a, b, 0.3, { x: base.fx, y: 0, z: base.fz }, d, phys.MASK.CHARACTER);
    return !hit.hit;
  };

  /**
   * Obstacle tests need a genuinely empty runway — the level is dense with
   * stalls and barriers, and a leftover prop in the path is indistinguishable
   * from a controller bug. Hunt for one instead of assuming it.
   */
  const placeClear = (runway = 6, label = '', yaws = null) => {
    for (let idx = 0; idx < 8; idx++) {
      const sp = world?.spawn?.(idx);
      const candidates = yaws ?? [sp?.yaw ?? 0];
      for (const yaw of candidates) {
        for (const lane of [0, 2, -2, 4, -4]) {
          place(lane, idx, yaw);
          if (clearAhead(runway)) return true;
        }
      }
    }
    notes.push(`${label}: no clear ${runway} m runway found; result unreliable`);
    return false;
  };
  /** Headings where an axis-aligned test slab is hit square-on. */
  const AXIS_YAWS = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

  const events = { steps: [], lands: [], states: [], mantles: [] };
  eng.events.on('player:footstep', (e) => events.steps.push({ surface: e.surface, running: e.running, x: e.position.x, z: e.position.z }));
  eng.events.on('player:land', (e) => events.lands.push({ v: e.velocity, surface: e.surface }));
  eng.events.on('player:state', (e) => events.states.push(e.state));
  eng.events.on('player:mantle', (e) => events.mantles.push(e.kind));

  /* ---- helpers -------------------------------------------------------- */

  /** Hold keys for `frames` steps, sampling horizontal speed. */
  function drive(keys, frames, sample) {
    for (const k of keys) dn(k);
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      step(1);
      peak = Math.max(peak, p.horizontalSpeed);
      if (sample) sample(i);
    }
    return peak;
  }

  function tail(keys, frames) {
    const speeds = [];
    for (const k of keys) dn(k);
    for (let i = 0; i < frames; i++) {
      step(1);
      speeds.push(p.horizontalSpeed);
    }
    return speeds;
  }

  /** Axis-aligned box registered straight into the collision world. */
  function addBox(cx, cy, cz, hx, hy, hz, name) {
    const v = [
      [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
      [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
    ];
    const q = [
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
      [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0],
    ];
    const tris = new Float32Array(q.length * 2 * 9);
    let o = 0;
    for (const [a, b, c, d] of q) {
      for (const idx of [a, b, c, a, c, d]) {
        tris[o++] = v[idx][0]; tris[o++] = v[idx][1]; tris[o++] = v[idx][2];
      }
    }
    const id = phys.staticWorld.addTriangles(tris, q.length * 2, 'concrete', phys.LAYER.STATIC, name);
    phys.rebuildStatic();
    return id;
  }

  const out = { notes };

  /* ---- walk ----------------------------------------------------------- */
  place(0);
  {
    let t90 = -1;
    const target = 4.57 * 0.9;
    const start = eng.time.elapsed;
    const speed = drive(['KeyW'], 90, () => {
      if (t90 < 0 && p.horizontalSpeed >= target) t90 = eng.time.elapsed - start;
    });
    // deceleration tail
    release();
    let stopTime = 0;
    const t0 = eng.time.elapsed;
    for (let i = 0; i < 60; i++) {
      step(1);
      if (p.horizontalSpeed < 0.15) { stopTime = eng.time.elapsed - t0; break; }
    }
    out.walk = { speed, t90, stopTime: stopTime || 1 };
  }

  /* ---- strafe / back --------------------------------------------------- */
  settle();
  place(0);
  out.strafe = { speed: drive(['KeyD'], 70) };
  settle();
  place(0);
  out.back = { speed: drive(['KeyS'], 70) };

  /* ---- sprint ---------------------------------------------------------- */
  settle();
  place(0);
  {
    const speed = drive(['KeyW', 'ShiftLeft'], 110);
    out.sprint = { speed, fov: p.cameraRig.fov, state: p.state };
  }

  /* ---- tactical sprint (double tap) ------------------------------------ */
  settle();
  place(0);
  {
    dn('KeyW'); dn('ShiftLeft');
    step(6);
    up('ShiftLeft'); step(2);
    dn('ShiftLeft'); step(2); // second tap inside the 0.32 s window
    let peak = 0;
    for (let i = 0; i < 130; i++) { step(1); peak = Math.max(peak, p.horizontalSpeed); }
    out.tacSprint = { speed: peak, state: p.state, tac: p.tacticalSprint };
  }

  /* ---- crouch / prone -------------------------------------------------- */
  settle();
  place(0);
  {
    dn('ControlLeft'); step(2); up('ControlLeft'); step(30);
    const eye = p.eyeHeight;
    const speed = drive(['KeyW'], 70);
    out.crouch = { eye, speed, stance: p.stance };
    settle();
    dn('KeyZ'); step(2); up('KeyZ'); step(60);
    out.prone = { eye: p.eyeHeight, stance: p.stance };
    // back to standing
    dn('KeyZ'); step(2); up('KeyZ'); step(20);
    dn('ControlLeft'); step(2); up('ControlLeft'); step(30);
  }

  /* ---- ADS ------------------------------------------------------------- */
  settle();
  place(0);
  {
    p.setAdsProgress(1);
    const speed = drive(['KeyW'], 70, () => p.setAdsProgress(1));
    out.ads = { speed, fov: p.cameraRig.fov };
    p.setAdsProgress(0);
    step(20);
  }

  /* ---- jump ------------------------------------------------------------ */
  settle();
  place(0);
  {
    const y0 = p.feetPosition.y;
    dn('Space'); step(2); up('Space');
    let apex = 0;
    let air = 0;
    for (let i = 0; i < 90; i++) {
      step(1);
      apex = Math.max(apex, p.feetPosition.y - y0);
      if (!p.grounded) air += DT;
      else if (i > 4) break;
    }
    out.jump = { apex, airTime: air };
  }

  /* ---- air control ----------------------------------------------------- */
  settle();
  place(0);
  {
    // Two frames only — long enough to measure accel, short enough that
    // neither case saturates at its top speed.
    dn('KeyD');
    step(2);
    const groundGain = p.horizontalSpeed;
    release(); step(30);
    // Air: same input, same window, from a standstill so `along` starts at 0.
    dn('Space'); step(2); up('Space'); step(6);
    const before = p.horizontalSpeed;
    dn('KeyD'); step(2);
    const airGain = p.horizontalSpeed - before;
    out.air = { controlRatio: groundGain > 0 ? airGain / groundGain : 0 };
    settle(60);
  }

  /* ---- slide ----------------------------------------------------------- */
  settle();
  place(0);
  {
    dn('KeyW'); dn('ShiftLeft');
    step(70);
    const entry = p.horizontalSpeed;
    dn('ControlLeft');
    step(1);
    up('ControlLeft');
    up('ShiftLeft');
    up('KeyW');
    let peak = 0;
    let dip = 0;
    let duration = 0;
    for (let i = 0; i < 120; i++) {
      step(1);
      peak = Math.max(peak, p.horizontalSpeed);
      dip = Math.min(dip, p.cameraRig.dip.value + p.cameraRig.eye - 1.66);
      if (p.sliding) duration += DT;
      else if (i > 3) break;
    }
    out.slide = { entry, peak, duration, exitStance: p.stance, dip, blocked: p.movement.blocked };
  }

  /* ---- slide cancel ---------------------------------------------------- */
  settle(60);
  place(0);
  {
    dn('KeyW'); dn('ShiftLeft');
    step(70);
    dn('ControlLeft'); step(1); up('ControlLeft');
    step(18);
    dn('Space'); step(3); up('Space');
    step(6);
    out.slideCancel = { airborne: !p.grounded, speed: p.horizontalSpeed, state: p.state };
    settle(70);
  }

  /* ---- landing --------------------------------------------------------- */
  place(0);
  {
    const y = base.y;
    p.teleport({ x: base.x, y: y + 1.66 + 3.2, z: base.z }, base.yaw);
    events.lands.length = 0;
    let dip = 0;
    for (let i = 0; i < 90; i++) {
      step(1);
      dip = Math.min(dip, p.cameraRig.dip.value);
      if (events.lands.length && i > 40) break;
    }
    const recovered = p.cameraRig.dip.value;
    out.land = {
      dip,
      recovered,
      eventSpeed: events.lands.length ? events.lands[0].v : 0,
      surface: events.lands.length ? events.lands[0].surface : 'none',
    };
  }

  /* ---- footsteps / bob -------------------------------------------------- */
  settle();
  place(0);
  {
    events.steps.length = 0;
    const x0 = p.feetPosition.x, z0 = p.feetPosition.z;
    let bobMinX = 1e9, bobMaxX = -1e9, bobMinY = 1e9, bobMaxY = -1e9;
    const xs = [];
    const ys = [];
    dn('KeyW');
    let dist = 0;
    for (let i = 0; i < 200; i++) {
      step(1);
      const rig = p.cameraRig;
      bobMinX = Math.min(bobMinX, rig.bobOffset.x); bobMaxX = Math.max(bobMaxX, rig.bobOffset.x);
      bobMinY = Math.min(bobMinY, rig.bobOffset.y); bobMaxY = Math.max(bobMaxY, rig.bobOffset.y);
      xs.push(rig.bobOffset.x); ys.push(rig.bobOffset.y);
      dist = Math.hypot(p.feetPosition.x - x0, p.feetPosition.z - z0);
      if (dist > 10) break;
    }
    release();
    const zeroCross = (a) => {
      let n = 0;
      for (let i = 30; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++;
      return n;
    };
    const cx = zeroCross(xs), cy = zeroCross(ys);
    out.steps = {
      count: events.steps.length,
      dist,
      surfaces: [...new Set(events.steps.map((s) => s.surface))],
      running: events.steps.filter((s) => s.running).length,
    };
    out.bob = {
      amp: Math.max(bobMaxX - bobMinX, bobMaxY - bobMinY) * 0.5,
      ratio: cx > 0 ? cy / cx : 0,
    };
  }

  /* ---- lean ------------------------------------------------------------ */
  settle();
  place(0);
  {
    const x0 = p.eyePosition.x, z0 = p.eyePosition.z;
    dn('KeyE');
    step(40);
    const off = Math.hypot(p.eyePosition.x - x0, p.eyePosition.z - z0);
    const roll = Math.abs(p.cameraRig.rotation.z) * 180 / Math.PI;
    out.lean = { offset: off, roll, amount: p.leanAmount };
    up('KeyE'); step(30);
  }

  /* ---- auto vault (0.55 m) --------------------------------------------- */
  settle();
  placeClear(8, 'auto-vault', AXIS_YAWS);
  {
    const at = ahead(4.6);
    const tri0 = phys.stats.triangles;
    // A thin 0.55 m slab: low enough to clear without a key press, thin enough
    // that the far side is standable, so this must resolve as a VAULT (over and
    // beyond) rather than a mantle onto a top face.
    const alongZ = Math.abs(base.fz) > 0.5;
    const id = addBox(
      at.x, base.y + 0.275, at.z,
      alongZ ? 1.6 : 0.22, 0.275, alongZ ? 0.22 : 1.6,
      'feeltest:vault'
    );
    events.mantles.length = 0;
    dn('KeyW'); dn('ShiftLeft');
    let cleared = false;
    for (let i = 0; i < 200; i++) {
      step(1);
      const d = (p.feetPosition.x - base.x) * base.fx + (p.feetPosition.z - base.z) * base.fz;
      if (d > 5.4) { cleared = true; break; }
    }
    out.vault = { ok: cleared, kinds: [...events.mantles] };
    notes.push(`auto-vault: kinds=${out.vault.kinds.join(',') || 'none'} cleared=${cleared}`);
    release();
    phys.removeStatic(id);
    phys.rebuildStatic();
    if (phys.stats.triangles !== tri0) notes.push(`vault box not removed (${tri0} -> ${phys.stats.triangles})`);
    step(4);
  }

  /* ---- mantle (1.15 m) ------------------------------------------------- */
  settle();
  placeClear(6, 'mantle');
  {
    const at = ahead(2.6);
    const top = base.y + 1.15;
    const id = addBox(at.x, base.y + 0.575, at.z, 1.6, 0.575, 1.6, 'feeltest:mantle');
    events.mantles.length = 0;
    dn('KeyW'); dn('Space');
    let dur = 0;
    let ok = false;
    for (let i = 0; i < 240; i++) {
      step(1);
      if (p.mantling) dur += DT;
      if (!p.mantling && dur > 0) {
        ok = p.feetPosition.y > top - 0.2 && p.grounded;
        break;
      }
    }
    out.mantle = { ok, duration: dur, kinds: [...events.mantles], y: p.feetPosition.y - base.y };
    notes.push(`mantle: kinds=${out.mantle.kinds.join(',') || 'none'} rise above local ground=${(p.feetPosition.y - base.y).toFixed(2)}m (box top 1.15m)`);
    release();
    phys.removeStatic(id);
    phys.rebuildStatic();
    step(4);
  }

  /* ---- a wall that must NOT be climbable ------------------------------- */
  settle();
  placeClear(6, 'high wall');
  {
    const at = ahead(2.6);
    const id = addBox(at.x, base.y + 1.6, at.z, 1.6, 1.6, 0.8, 'feeltest:wall');
    events.mantles.length = 0;
    dn('KeyW'); dn('Space');
    let climbed = false;
    for (let i = 0; i < 180; i++) {
      step(1);
      if (p.feetPosition.y > base.y + 0.9) { climbed = true; break; }
    }
    out.tooHigh = { rejected: !climbed && events.mantles.length === 0 };
    release();
    phys.removeStatic(id);
    phys.rebuildStatic();
    step(4);
  }

  /* ---- stairs ---------------------------------------------------------- */
  settle();
  placeClear(7, 'stairs');
  {
    const ids = [];
    // Riser 0.18 m, tread 0.30 m — a real staircase. Each step is a solid block
    // from the ground up, which is how level geometry actually authors them.
    for (let i = 0; i < 6; i++) {
      const top = 0.18 * (i + 1);
      const at = ahead(2.2 + i * 0.3);
      ids.push(addBox(at.x, base.y + top * 0.5, at.z, 1.5, top * 0.5, 0.16, `feeltest:stair${i}`));
    }
    const y0 = p.feetPosition.y;
    const x0 = p.feetPosition.x, z0 = p.feetPosition.z;
    events.mantles.length = 0;
    dn('KeyW');
    // Peak height, not final: a 6-step flight is 1.8 m deep, so walking on for
    // three seconds takes you over the top and back down the far side.
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      step(1);
      peak = Math.max(peak, p.feetPosition.y - y0);
    }
    const fwdTravel = (p.feetPosition.x - x0) * base.fx + (p.feetPosition.z - z0) * base.fz;
    out.stairs = { climbed: peak, travel: fwdTravel, ledgeEvents: [...events.mantles] };
    notes.push(`stairs: climbed ${out.stairs.climbed.toFixed(2)}m of 1.08m, travelled ${fwdTravel.toFixed(2)}m`);
    release();
    for (const id of ids) phys.removeStatic(id);
    phys.rebuildStatic();
    step(4);
  }

  /* ---- health ---------------------------------------------------------- */
  settle();
  place(0);
  {
    p.health.reset(true);
    // 4 m to the player's right, so the indicator angle must come out at +pi/2.
    const from = {
      x: base.x + Math.cos(base.yaw) * 4,
      y: base.y + 1.6,
      z: base.z - Math.sin(base.yaw) * 4,
    };
    p.applyDamage(45, from);
    const dir = p.health.indicators.find((i) => i.active)?.angle ?? 0;
    const passEnabled = (() => {
      p.health.value = 20;
      p.health.effect = 0.9;
      p.lowHealthPass?.sync(p.health);
      const on = !!p.lowHealthPass?.enabled;
      p.health.value = 55;
      p.health.effect = 0;
      return on;
    })();
    const t0 = eng.time.elapsed;
    let regenStart = -1;
    let refill = -1;
    for (let i = 0; i < 900; i++) {
      step(1);
      if (regenStart < 0 && p.health.value > 55.5) regenStart = eng.time.elapsed - t0;
      if (p.health.value >= 99.9) { refill = eng.time.elapsed - t0 - Math.max(0, regenStart); break; }
    }
    out.health = { regenStart, refill, direction: dir, passEnabled };
  }

  /* ---- recoil ---------------------------------------------------------- */
  settle();
  {
    const rig = p.cameraRig;
    rig.recoilPitch.reset();
    p.addRecoil(2.4 * Math.PI / 180, 0.6 * Math.PI / 180, 0.4 * Math.PI / 180, 0.01);
    let peak = 0;
    for (let i = 0; i < 8; i++) { step(1); peak = Math.max(peak, rig.recoilPitch.value); }
    for (let i = 0; i < 60; i++) step(1);
    out.recoil = {
      peak: peak * 180 / Math.PI,
      residual: Math.abs(rig.recoilPitch.value) * 180 / Math.PI,
    };
  }

  out.alloc = { note: 'see code review' };
  out.states = [...new Set(events.states)];

  render.render = realRender;
  eng.start();
  return out;
}
