/**
 * IN-PAGE DEMO DRIVER — injected by tools/demo.mjs as a single expression.
 *
 * This is not a canned camera path. It is a bot that plays the game through the
 * real input layer: it writes into `input.down` / `input._rawLook` exactly like
 * a keyboard and a mouse would, then advances one engine frame. Everything
 * downstream (movement state machine, recoil, ballistics, AI perception) runs
 * untouched, so what the video shows is the game actually being played.
 *
 * Why input injection instead of `__APPLY_SHOT__`: shots freeze input and pose
 * the camera, which produces stills. A demo reel needs weapon sway, recoil
 * recovery, footstep bob and AI reacting to noise — all of which only exist if
 * the input layer is the thing being driven.
 *
 * Runs under `?capture=1&lockstep=1`, so `engine.step()` is called by hand with
 * a fixed 1/60 dt. One call to `step()` == one frame of output video. Slow
 * motion is `time.scale`, which shrinks the simulation delta while the video
 * still gets its frame — real slow motion, not frame duplication.
 */
(() => {
  const E = window.__ENGINE__;
  if (!E) return { error: 'no engine on window' };

  const ctx = E.ctx;
  const cfg = ctx.config;
  const sys = (id) => ctx.peek(id);
  /** Three is never imported here — the ARCHITECTURE forbids tools reaching into
   *  subsystem modules, and the constructor is reachable from any live vector. */
  const V3 = E.camera.position.constructor;

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  const _f = new V3();
  const _r = new V3();
  const _p = new V3();
  const _q = new V3();

  /* ==================================================================== */
  /* event log — consumed offline by tools/demo-audio.mjs                 */
  /* ==================================================================== */

  const rec = [];
  const camDist = (v) => (v ? E.camera.position.distanceTo(v) : 0);
  const mark = (name, extra) => rec.push({ f: E.time.frame, name, ...extra });

  E.events.on('weapon:fire', (p) => {
    if (p?.weapon === 'ai_rifle') mark('ai:fire', { d: +camDist(p.origin).toFixed(2) });
    else mark('fire', { d: 0 });
  });
  E.events.on('weapon:reload', (p) => mark('reload', { phase: p?.phase ?? 'end' }));
  E.events.on('weapon:shell', (p) => mark('shell', { d: +camDist(p?.position).toFixed(2) }));
  E.events.on('bullet:impact', (p) =>
    mark('impact', { surface: p?.surface ?? 'concrete', d: +camDist(p?.point).toFixed(2) })
  );
  E.events.on('damage:dealt', (p) => {
    // `target` is the local player when an enemy round connects — see the
    // ARCHITECTURE note on this event. Those are hurt cues, not hitmarkers.
    const t = p?.target;
    const onPlayer = t === 'player' || t?.isPlayer === true || t === sys('player');
    mark(onPlayer ? 'hurt' : 'hit', { hs: !!p?.headshot });
  });
  E.events.on('actor:death', (p) => mark('kill', { d: +camDist(p?.point).toFixed(2) }));
  E.events.on('explosion', (p) => mark('boom', { d: +camDist(p?.position).toFixed(2), r: p?.radius ?? 6 }));
  E.events.on('player:footstep', (p) => mark('step', { run: !!p?.running }));
  E.events.on('player:land', (p) => mark('land', {}));

  /* ==================================================================== */
  /* aiming — a feedback loop on the real camera basis                    */
  /* ==================================================================== */

  /**
   * Mouse counts that would rotate the view `gain` of the way onto `target`.
   *
   * The error is measured against the CAMERA, not against movement.yaw/pitch, so
   * the loop also fights recoil and weapon sway the way a player does. Feeding it
   * back through `_rawLook` (rather than writing yaw directly) is what keeps the
   * camera rig, the viewmodel sway springs and the spread model in the loop.
   */
  function aimCounts(target, gain, maxCounts) {
    const cam = E.camera;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const curYaw = Math.atan2(-_f.x, -_f.z);
    const curPitch = Math.asin(clamp(_f.y, -1, 1));

    let dx = target.x - cam.position.x;
    let dy = target.y - cam.position.y;
    let dz = target.z - cam.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(clamp(dy / len, -1, 1));

    const dYaw = wrap(wantYaw - curYaw) * gain;
    const dPitch = (wantPitch - curPitch) * gain;

    // player._consumeLook: dYaw = -look.x * sens, look.x = raw * cfg.sensitivity
    const sens = lerp(1, cfg.adsSensScale ?? 0.62, clamp(sys('player')?.adsAmount ?? 0, 0, 1));
    const k = 1 / ((cfg.sensitivity || 0.0022) * sens);
    return {
      mx: clamp(-dYaw * k, -maxCounts, maxCounts),
      my: clamp(-dPitch * k, -maxCounts, maxCounts),
      err: Math.hypot(wrap(wantYaw - curYaw), wantPitch - curPitch),
      dist: len,
    };
  }

  /** Current camera pitch in radians, +up. */
  function camPitch() {
    _f.set(0, 0, -1).applyQuaternion(E.camera.quaternion);
    return Math.asin(clamp(_f.y, -1, 1));
  }

  /**
   * Mouse counts that pull the pitch back toward `bias`. Without this the free
   * look beats drift: the sway springs and the recoil recentre are not symmetric,
   * so an open-loop sine on `my` walks the horizon out of frame over a few
   * hundred frames and the reel ends up staring at the sky.
   */
  function levelPitch(bias, gain) {
    const sens = lerp(1, cfg.adsSensScale ?? 0.62, clamp(sys('player')?.adsAmount ?? 0, 0, 1));
    const k = 1 / ((cfg.sensitivity || 0.0022) * sens);
    return clamp(-(bias - camPitch()) * gain * k, -70, 70);
  }

  /* ==================================================================== */
  /* level knowledge                                                      */
  /* ==================================================================== */

  /** Snap (x,z) onto the AI walkability grid so spawns never land inside a wall. */
  function placeOn(x, z, fromY) {
    const ai = sys('ai');
    if (!ai) return null;
    const g = ai.grid;
    if (g) {
      const ci = g.nearest(x, z, fromY, 8, 2.0);
      if (ci >= 0) {
        return new V3(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
      }
    }
    const y = ai.groundAt(x, z, fromY + 5);
    return Number.isFinite(y) ? new V3(x, y, z) : null;
  }

  const world = sys('world');
  const spawns = world?.spawnPoints ?? [];
  // Patrol route through the level, by spawn-point tag order: market -> east
  // alley -> mid street -> west alley -> south street -> gate, then back north.
  const ROUTE_ORDER = [2, 6, 3, 7, 4, 5, 3, 2, 0];
  const route = ROUTE_ORDER.map((i) => spawns[i]?.position).filter(Boolean);

  /* ==================================================================== */
  /* bot state                                                            */
  /* ==================================================================== */

  const bot = {
    frame: 0,
    routeIdx: 0,
    target: null,
    lockFrames: 0,
    burstPhase: 0,
    reloadHold: 0,
    modeHold: 0,
    strafeSign: 1,
    strafeSwap: 0,
    shimmy: 0,
    stuckRef: new V3(),
    stuckCheck: 0,
    slowFrames: 0,
    slowDepth: 1,
    kills: 0,
    waveNo: 0,
    waveCooldown: 40,
    grenadeAt: -1,
    grenadePos: null,
    lastHeal: 0,
  };

  const held = new Set();

  function setHeld(codes) {
    const inp = E.input;
    for (const c of codes) if (!held.has(c) && !inp.down.has(c)) inp._pendingDown.add(c);
    for (const c of held) if (!codes.has(c)) inp._pendingUp.add(c);
    held.clear();
    for (const c of codes) held.add(c);
  }

  /* ==================================================================== */
  /* enemies                                                              */
  /* ==================================================================== */

  const VARIANTS = ['vanguard', 'breacher', 'irregular'];

  /** Drop `n` enemies in front of the camera between `minD` and `maxD` metres. */
  function spawnWave(n, minD, maxD) {
    const ai = sys('ai');
    if (!ai) return 0;
    const cam = E.camera;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) return 0;
    _f.normalize();
    _r.set(_f.z, 0, -_f.x);

    const squad = ai.createSquad();
    let made = 0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const d = lerp(minD, maxD, t);
      // Fan them out and alternate sides so they never spawn in a line.
      const lat = (i % 2 === 0 ? 1 : -1) * (2.5 + 2.4 * ((i * 7) % 3));
      const p = placeOn(cam.position.x + _f.x * d + _r.x * lat, cam.position.z + _f.z * d + _r.z * lat, cam.position.y);
      if (!p) continue;
      const yaw = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
      const a = ai.spawn(VARIANTS[(bot.waveNo + i) % 3], p, yaw);
      squad.add(a);
      a.aimTarget?.copy?.(cam.position);
      made++;
    }
    bot.waveNo++;
    return made;
  }

  function livingEnemies() {
    const ai = sys('ai');
    if (!ai) return [];
    return ai.agents.filter((a) => a.alive);
  }

  /** Nearest living enemy the muzzle can actually reach, biased toward centre. */
  function pickTarget() {
    const cam = E.camera;
    const phys = sys('physics');
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null;
    let bestScore = -1e9;
    for (const a of livingEnemies()) {
      _p.set(a.position.x, a.position.y + 1.28, a.position.z);
      const d = cam.position.distanceTo(_p);
      if (d > 48) continue;
      _q.copy(_p).sub(cam.position).normalize();
      const facing = _q.dot(_f);
      if (facing < -0.25) continue; // behind us — do not spin for it every frame
      if (phys && !phys.lineOfSight(cam.position, _p, phys.MASK.SIGHT)) continue;
      // Prefer what is already near the crosshair, then what is close.
      let score = facing * 3.2 - d * 0.045;
      if (a === bot.target) score += 1.1; // hysteresis: finish what you started
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /* ==================================================================== */
  /* title cards                                                          */
  /* ==================================================================== */

  /**
   * Titles are DOM, not ffmpeg: this ffmpeg build has no libfreetype, so
   * `drawtext` does not exist. Compositing them in the page instead is not a
   * workaround so much as the better option — `page.screenshot` already has to
   * composite the DOM because the HUD is DOM (see index.html), the typography
   * matches the HUD's, and the cards sit over live gameplay rather than cutting
   * away from it.
   */
  const cards = (() => {
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:9000;' +
      'font-family:"Inter","Helvetica Neue",Arial,sans-serif;color:#fff;';
    host.innerHTML = `
      <div id="dc-open" style="position:absolute;left:6.5%;bottom:17%;opacity:0;
           text-shadow:0 2px 22px rgba(0,0,0,.85);">
        <div style="font-size:5.4vh;font-weight:200;letter-spacing:.42em;line-height:1;">WORKMELT</div>
        <div style="height:1px;background:linear-gradient(90deg,#fff,rgba(255,255,255,0));
                    margin:2.1vh 0 1.5vh;width:33vw;"></div>
        <div style="font-size:1.32vh;font-weight:500;letter-spacing:.34em;color:#c9d2d8;">
          WEBGL2 &nbsp;·&nbsp; EVERY TEXTURE, MESH AND SOUND GENERATED AT LOAD
        </div>
      </div>
      <div id="dc-end" style="position:absolute;inset:0;display:flex;align-items:center;
           justify-content:center;opacity:0;">
        <div style="text-align:center;text-shadow:0 2px 26px rgba(0,0,0,.9);">
          <div id="dc-end-k" style="font-size:8.6vh;font-weight:200;letter-spacing:.16em;line-height:1;"></div>
          <div style="height:1px;background:rgba(255,255,255,.55);margin:2.4vh auto 1.8vh;width:19vw;"></div>
          <div id="dc-end-s" style="font-size:1.42vh;font-weight:500;letter-spacing:.3em;color:#cfd7dc;"></div>
        </div>
      </div>`;
    document.body.appendChild(host);
    return {
      open: host.querySelector('#dc-open'),
      end: host.querySelector('#dc-end'),
      endK: host.querySelector('#dc-end-k'),
      endS: host.querySelector('#dc-end-s'),
    };
  })();

  /** Trapezoid fade: 0 outside, ramps over `ramp` frames at each edge. */
  function envelope(f, from, to, ramp) {
    if (f < from || f > to) return 0;
    return Math.min(1, Math.min((f - from) / ramp, (to - f) / ramp));
  }

  /* ==================================================================== */
  /* one frame                                                            */
  /* ==================================================================== */

  const state = {};

  function drive(script) {
    const f = bot.frame;
    const player = sys('player');
    const weapons = sys('weapons');
    const cam = E.camera;
    const codes = new Set();
    let mx = 0;
    let my = 0;

    const hud = weapons?.getHudState?.() ?? {};
    const ammo = hud.ammo ?? 30;
    const reserve = hud.reserve ?? 90;
    const reloading = !!hud.reloading;

    /* ---- scripted beats ------------------------------------------------ */
    const phase = script.phaseAt(f);
    if (phase !== bot.phase) {
      // Entering the finale: put targets close in so the slow-motion beat has
      // something in it, and clear any slow-motion already running so the ramp
      // is not fighting a kill-cam that started a few frames earlier.
      if (phase === 'outro') {
        spawnWave(3, 9, 17);
        bot.slowFrames = 0;
      }
      bot.phase = phase;
    }

    /* ---- keep the fight alive ----------------------------------------- */
    const alive = livingEnemies();
    if (phase !== 'intro') {
      bot.waveCooldown--;
      // Keep pressure on. The garrison alone thins out to nothing about a third
      // of the way in and the reel goes quiet, so top it back up — close enough
      // that the enemies read as figures rather than dots down the street.
      if (alive.length <= 4 && bot.waveCooldown <= 0) {
        spawnWave(3, 13, 24);
        bot.waveCooldown = 85;
      }
    }

    /* ---- target ------------------------------------------------------- */
    // The finale keeps fighting — it is just slowed down. An outro that dropped
    // the target and panned around for two seconds ended the reel on the bot
    // standing in an empty market with the rifle at rest.
    const t = phase === 'intro' ? null : pickTarget();
    if (t !== bot.target) bot.lockFrames = 0;
    bot.target = t && t.alive ? t : null;
    if (bot.target) bot.lockFrames++;

    /* ---- where to look ------------------------------------------------ */
    if (bot.target) {
      const a = bot.target;
      const d = cam.position.distanceTo(a.position);
      // Go for the head once the track has settled and the shot is worth it.
      const headshot = bot.lockFrames > 22 && d < 26 && (bot.kills % 2 === 0);
      _p.set(a.position.x, a.position.y + (headshot ? a.eyeHeight ?? 1.6 : 1.24), a.position.z);
      // Lead the target: they are moving, and a perfect track looks robotic.
      if (a.velocity) _p.addScaledVector(a.velocity, 0.055);
      const gain = bot.lockFrames < 6 ? 0.34 : 0.19; // fast snap, then settle
      const s = aimCounts(_p, gain, 260);
      mx = s.mx;
      my = s.my;
      state.err = s.err;
      state.tdist = s.dist;
    } else if (phase === 'intro') {
      // Slow establishing pan: sweep the view across the street, no input.
      mx = Math.sin(f * 0.021) * 9.5;
      my = levelPitch(-0.045 + Math.sin(f * 0.013) * 0.03, 0.12);
      state.err = 9;
    } else if (phase === 'outro') {
      const last = script.outroLook(cam);
      const s = aimCounts(last, 0.055, 90);
      mx = s.mx;
      my = s.my;
      state.err = 9;
    } else {
      // Travelling: look where we are going, with a human amount of drift.
      const wp = route[bot.routeIdx % route.length];
      if (wp) {
        // Aim the yaw at the waypoint but keep the pitch on its own controller —
        // waypoints sit on the floor, and seeking them in 3D walks the view down.
        _p.set(wp.x, cam.position.y, wp.z);
        const s = aimCounts(_p, 0.075, 60);
        mx = s.mx;
      }
      mx += Math.sin(f * 0.037) * 5.5;
      my = levelPitch(-0.03 + Math.sin(f * 0.019 + 1.1) * 0.05, 0.14);
      state.err = 9;
    }

    // Hand tremor. Deterministic (no Math.random anywhere in this file) but
    // incommensurate frequencies, so it never reads as a repeating wobble.
    mx += Math.sin(f * 0.41) * 1.5 + Math.sin(f * 0.157 + 2.2) * 1.1;
    my += Math.cos(f * 0.33 + 0.7) * 1.2 + Math.sin(f * 0.091) * 0.8;

    /* ---- movement ----------------------------------------------------- */
    if (phase !== 'intro') {
      const wp = route[bot.routeIdx % route.length];
      if (wp) {
        // Arrival radius is generous and there is a timeout, because combat
        // footwork drags the bot off the direct line: with a 3 m radius and no
        // timeout it walked straight past the market waypoint and then spent the
        // whole reel trying to get back to it.
        const flat = Math.hypot(wp.x - cam.position.x, wp.z - cam.position.z);
        bot.wpFrames = (bot.wpFrames ?? 0) + 1;
        if (flat < 5.0 || bot.wpFrames > 420) {
          bot.routeIdx++;
          bot.wpFrames = 0;
        }
      }

      let wantX = 0; // + right
      let wantZ = 0; // + forward
      if (bot.target && state.tdist < 30) {
        // Combat footwork: strafe across them, close if far, back off if close.
        bot.strafeSwap--;
        if (bot.strafeSwap <= 0) {
          bot.strafeSign = -bot.strafeSign;
          bot.strafeSwap = 44 + ((f * 13) % 37);
        }
        wantX = bot.strafeSign * 0.9;
        wantZ = state.tdist > 17 ? 0.85 : state.tdist < 7 ? -0.8 : 0;
      } else if (wp) {
        // Travel toward the waypoint in view space.
        _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
        _f.y = 0;
        _f.normalize();
        _r.set(_f.z, 0, -_f.x);
        _q.set(wp.x - cam.position.x, 0, wp.z - cam.position.z).normalize();
        wantZ = _q.dot(_f);
        wantX = _q.dot(_r);
      }

      // Unstick: if we asked to move and did not, angle off for a moment. Real
      // levels have door frames and crate corners that a naive seek walks into.
      if (++bot.stuckCheck >= 40) {
        bot.stuckCheck = 0;
        if (bot.stuckRef.lengthSq() > 0 && cam.position.distanceTo(bot.stuckRef) < 0.75) bot.shimmy = 45;
        bot.stuckRef.copy(cam.position);
      }
      if (bot.shimmy > 0) {
        bot.shimmy--;
        const c = Math.cos(0.95);
        const s2 = Math.sin(0.95) * (bot.shimmy > 22 ? 1 : -1);
        const nx = wantX * c - wantZ * s2;
        const nz = wantX * s2 + wantZ * c;
        wantX = nx;
        wantZ = nz;
      }

      if (wantZ > 0.32) codes.add('KeyW');
      else if (wantZ < -0.32) codes.add('KeyS');
      if (wantX > 0.32) codes.add('KeyD');
      else if (wantX < -0.32) codes.add('KeyA');

      // Sprint only when travelling with nothing to shoot — sprint blocks ADS.
      const sprinting =
        !bot.target && !reloading && wantZ > 0.7 && phase === 'travel' && f % 240 < 190;
      if (sprinting) codes.add('ShiftLeft');

      // Combat slide: sprint into crouch. Scripted so it lands on camera.
      if (script.slideAt(f) && phase === 'travel') {
        codes.add('ShiftLeft');
        codes.add('KeyW');
        if (script.slideAt(f) === 'crouch') codes.add('ControlLeft');
      }
      if (script.jumpAt(f)) codes.add('Space');
      if (script.crouchAt(f) && !bot.target) codes.add('ControlLeft');
    }

    /* ---- reload ------------------------------------------------------- */
    if (bot.reloadHold > 0) {
      bot.reloadHold--;
      codes.add('KeyR');
    } else if (!reloading && reserve > 0) {
      // Reload eagerly. The reload animation is one of the best things the
      // viewmodel does and it never got to play when the threshold was 7 rounds.
      const safe = !bot.target || state.tdist > 20;
      if (ammo === 0 || (ammo <= 13 && safe)) bot.reloadHold = 3;
    }

    /* ---- trigger ------------------------------------------------------ */
    let firing = false;
    if (bot.target && !reloading && ammo > 0 && phase !== 'intro') {
      const d = state.tdist;
      // A shoulder-width target subtends ~0.02 rad at 30 m, so these gates are
      // deliberately looser than "guaranteed hit": some rounds are supposed to
      // miss and chew up the wall behind, which is where the impact FX come from.
      const gate = d > 24 ? 0.03 : d > 12 ? 0.055 : 0.1;
      if (state.err < gate && bot.lockFrames > 3) {
        // Burst cadence, so it reads as controlled fire rather than a held
        // trigger — but weighted toward ON, because this is a highlight reel.
        const cycle = d > 18 ? 22 : 16;
        const on = d > 18 ? 13 : 12;
        firing = bot.burstPhase % cycle < on;
        bot.burstPhase++;
      } else {
        bot.burstPhase = 0;
      }
      // ADS unless it is close-quarters or we are sprinting — hip-fire spray up
      // close is more dynamic than snapping to the optic for everything.
      if (d > 11 && !codes.has('ShiftLeft')) codes.add('Mouse2');
    }
    if (firing) codes.add('Mouse0');

    /* ---- scripted grenade --------------------------------------------- */
    if (script.grenadeAt(f) && bot.grenadeAt < 0) {
      const cluster = alive.filter((a) => cam.position.distanceTo(a.position) < 30);
      const src = cluster[0] ?? alive[0];
      if (src) {
        bot.grenadePos = new V3(src.position.x, src.position.y + 0.35, src.position.z);
        bot.grenadeAt = f + 46;
        sys('ui')?.spawnGrenade?.(bot.grenadePos, 46 / 60);
      }
    }
    if (bot.grenadeAt >= 0 && f >= bot.grenadeAt) {
      E.events.emit('explosion', { position: bot.grenadePos, radius: 8.5, damage: 240 });
      bot.grenadeAt = -1;
      bot.grenadePos = null;
      bot.slowFrames = 26;
      bot.slowDepth = 0.42;
    }

    /* ---- do not let the demo end in a respawn ------------------------- */
    const hp = player?.health?.health ?? player?.getHudState?.()?.health ?? 100;
    if (hp < 42 && f - bot.lastHeal > 90) {
      player?.heal?.(55);
      bot.lastHeal = f;
    }

    /* ---- time scale --------------------------------------------------- */
    let scale = 1;
    if (bot.slowFrames > 0) {
      // Ease in and out of slow motion instead of stepping it — a hard cut in
      // dt makes every spring in the camera rig ring.
      const k = bot.slowFrames / 26;
      const bell = Math.sin(clamp(k, 0, 1) * Math.PI);
      scale = lerp(1, bot.slowDepth, bell);
      bot.slowFrames--;
    }
    if (phase === 'outro') scale = script.outroScale(f);
    E.time.scale = scale;

    /* ---- title cards --------------------------------------------------- */
    cards.open.style.opacity = script.openCard(f).toFixed(3);
    const endA = script.endCard(f);
    cards.end.style.opacity = endA.toFixed(3);
    if (endA > 0) {
      cards.endK.textContent = `${bot.kills} ELIMINATED`;
      cards.endS.textContent =
        `${bot.waveNo} WAVES  ·  ${sys('weapons')?.stats?.fired ?? 0} ROUNDS  ·  ` +
        `${Math.round(hp)} HEALTH REMAINING`;
    }

    /* ---- commit input, advance one frame ------------------------------ */
    setHeld(codes);
    E.input._rawLook.x = mx;
    E.input._rawLook.y = my;
    E.input.frozen = false;
    E.input.enabled = true;
    E.input.pointerLocked = true;

    E.step();
    bot.frame++;

    return {
      f,
      phase,
      scale: +scale.toFixed(3),
      keys: [...codes].join('+'),
      pos: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)],
      alive: alive.length,
      kills: bot.kills,
      ammo,
      pitch: +((camPitch() * 180) / Math.PI).toFixed(1),
      wp: bot.routeIdx,
      err: +(state.err ?? 9).toFixed(4),
      dist: bot.target ? +state.tdist.toFixed(1) : null,
    };
  }

  /* ==================================================================== */
  /* public API                                                           */
  /* ==================================================================== */

  E.events.on('actor:death', () => {
    bot.kills++;
    // Slow motion on every second kill, and never on top of an existing one.
    if (bot.kills % 2 === 0 && bot.slowFrames <= 0) {
      bot.slowFrames = 26;
      bot.slowDepth = 0.4;
    }
  });

  let SCRIPT = null;

  window.__DEMO__ = {
    /** Hand the camera back to the player and open the level up. */
    begin(opts) {
      SCRIPT = makeScript(opts);
      const player = sys('player');
      const ai = sys('ai');
      const weapons = sys('weapons');

      E.input.frozen = false; // capture mode freezes it — see installShotApi
      E.input.enabled = true;
      E.input.pointerLocked = true;
      player?.setControlEnabled?.(true);

      // Leave DEBUG MODE. `weapons.update` gates all live input on
      // `this.debugMode === null`, and both `prewarm()` and `__APPLY_SHOT__`
      // leave the weapon posed in 'idle' debug — which silently swallows the
      // trigger. Held Mouse0 fired nothing at all until this was cleared.
      if (weapons) {
        weapons.debugMode = null;
        weapons._scriptFrames = null;
        if (weapons.viewmodel) weapons.viewmodel.debugFrozen = false;
        weapons.setWeaponImmediate?.('rifle');
      }
      sys('ui')?.debugState?.('clean'); // drop any scripted HUD, keep the real one
      sys('ui')?.setHudVisible?.(true);
      if (opts?.time !== undefined) sys('sky')?.setTimeOfDay?.(opts.time);

      let purged = 0;
      if (ai) {
        // `prewarm()` runs `ai.debugStage('firefight')` to compile the character
        // shaders and never tears it down, so the level opens with six posed
        // mannequins that have `staged.noDamage` and never run the behaviour
        // tree. Clear the board before garrisoning it with real enemies.
        for (const a of ai.agents.slice()) {
          try {
            a.dispose?.();
          } catch (err) {
            /* already detached */
          }
          purged++;
        }
        ai.agents.length = 0;
        ai.squads.length = 0;
        ai._stagedAgents = [];
        ai.forcePopulate = true; // deterministic mode skips the garrison otherwise
        ai.populate({ squads: 2, perSquad: 3 });
        // `populate` deliberately garrisons the FAR half of the level (>18 m, so
        // the player finds enemies rather than spawning on them). Good for play,
        // wrong for a reel: it opened with three seconds of walking down an empty
        // street. Stage a contact just past the intro pan as well.
        spawnWave(3, 14, 22);
      }

      return {
        ok: true,
        purged,
        garrison: livingEnemies().length,
        waypoints: route.map((p) => [+p.x.toFixed(1), +p.z.toFixed(1)]),
        pos: E.camera.position.toArray().map((v) => +v.toFixed(2)),
      };
    },

    /** Advance exactly one frame of output video. */
    frame() {
      return drive(SCRIPT);
    },

    /** Fire an opening wave in front of wherever the camera ended up. */
    wave(n, minD, maxD) {
      return spawnWave(n ?? 3, minD ?? 16, maxD ?? 26);
    },

    events: () => rec,
    stats: () => ({ frames: bot.frame, kills: bot.kills, waves: bot.waveNo, alive: livingEnemies().length }),
  };

  /* ==================================================================== */
  /* the reel's beat sheet                                                */
  /* ==================================================================== */

  /**
   * Frame-indexed direction. Everything here is a *suggestion* layered on top of
   * the bot: if a beat says "slide now" but there is an enemy at 4 m, the combat
   * footwork wins. Beats are placed as fractions of the run so the same sheet
   * works for a 10 s test and a 30 s final.
   */
  function makeScript(opts) {
    const total = opts?.frames ?? 1200;
    const intro = Math.min(58, Math.round(total * 0.04));
    const outro = Math.max(70, Math.round(total * 0.06));
    const at = (frac) => Math.round(total * frac);

    const slides = [at(0.3), at(0.62), at(0.84)];
    const jumps = [at(0.44), at(0.71)];
    const grenades = [at(0.36), at(0.68)];
    // NOTE: no KeyB beat. Cycling the fire mode looked like good flair but it
    // lands the rifle in BURST, where `_runTrigger` needs a fresh trigger press
    // per burst — fire volume across the reel dropped by about two thirds.

    return {
      total,
      phaseAt(f) {
        if (f < intro) return 'intro';
        if (f >= total - outro) return 'outro';
        return 'travel';
      },
      slideAt(f) {
        for (const s of slides) {
          if (f >= s && f < s + 30) return f < s + 16 ? 'sprint' : 'crouch';
        }
        return null;
      },
      jumpAt: (f) => jumps.some((j) => f >= j && f < j + 3),
      crouchAt: (f) => false,
      grenadeAt: (f) => grenades.some((g) => f === g),
      /** Outro: settle onto the nearest body, or straight down the street. */
      outroLook(cam) {
        const ai = sys('ai');
        let best = null;
        let bd = 1e9;
        for (const a of ai?.agents ?? []) {
          if (a.alive) continue;
          const d = cam.position.distanceTo(a.position);
          if (d < bd && d > 2) {
            bd = d;
            best = a;
          }
        }
        if (best) return _p.set(best.position.x, best.position.y + 0.7, best.position.z);
        _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
        return _p.copy(cam.position).addScaledVector(_f, 22).setY(cam.position.y - 0.6);
      },
      /** Opening title: up over the intro pan, gone before the first contact. */
      openCard: (f) => envelope(f, 14, Math.max(intro + 78, 150), 26),
      /** Closing card, held over the slow-motion finale. */
      endCard: (f) => envelope(f, total - outro + 26, total + 40, 22),
      /** Ramp into slow motion for the last beat and hold it. */
      outroScale(f) {
        const k = clamp((f - (total - outro)) / (outro * 0.45), 0, 1);
        return lerp(1, 0.28, k);
      },
    };
  }

  return { installed: true, route: route.length, spawns: spawns.length };
})();
