import { Engine } from './core/engine.js';
import { createConfig } from './core/config.js';
import {
  AdaptiveQualitySystem,
  detectDeviceSignature,
  estimateRefreshRate,
  loadGraphicsSettings,
  prepareAutoSettings,
  resolveGraphicsBoot,
  saveGraphicsSettings,
} from './core/quality.js';

import { RenderSystem } from './render/index.js';
import { MaterialSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { FxSystem } from './fx/index.js';
import { AiSystem } from './ai/index.js';
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';
import { NetSystem } from './net/index.js';
import { MatchSystem } from './match/index.js';

import { installShotApi } from './dev/shots.js';
import { prewarm } from './core/prewarm.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because tools that measure real frame pacing (tools/perf.mjs) need the loop to
// free-run. See the long comment in src/dev/shots.js.
const lockstep = capture && params.get('lockstep') === '1';

// The Match Start view: every normal load opens on a menu rather than mid-match,
// so a player can pick a bot garrison and go, or wait for a friend to join the
// room and ready up together. Off for capture runs (a menu is not a screenshot)
// and with `?match=0`, which restores the old "live on the first frame" boot for
// benchmarks and playtest harnesses.
const matchFlow = !capture && params.get('match') !== '0';

const explicitQuality = params.get('q');
let graphics = loadGraphicsSettings();
const initialBoot = resolveGraphicsBoot({ capture, explicitQuality, settings: graphics });
if (initialBoot.enabled && graphics.mode === 'auto') {
  const signature = detectDeviceSignature();
  const refreshHz =
    graphics.targetFps === 'display'
      ? document.hidden
        ? graphics.refreshHz ?? 120
        : await estimateRefreshRate()
      : graphics.refreshHz;
  graphics = saveGraphicsSettings(prepareAutoSettings(graphics, { signature, refreshHz }));
}

const { enabled: adaptiveEnabled, quality: bootQuality } = resolveGraphicsBoot({
  capture,
  explicitQuality,
  settings: graphics,
});
const config = createConfig({
  quality: bootQuality,
  graphicsMode: graphics.mode,
  targetFps: graphics.targetFps,
  displayRefreshHz: graphics.refreshHz ?? 120,
  adaptiveQuality: adaptiveEnabled,
  deterministic: capture,
  // `ai` skips its boot-time garrison; `match` spawns it when a match starts.
  deferGarrison: matchFlow,
});
if (adaptiveEnabled && graphics.mode === 'auto' && graphics.calibrated)
  config.q.renderScale = graphics.renderScale;

const canvas = document.getElementById('game');

const engine = new Engine({ canvas, config });

// Registration order is irrelevant — Registry topo-sorts on static deps.
engine
  .add(RenderSystem)
  .add(AdaptiveQualitySystem, { settings: graphics, enabled: adaptiveEnabled })
  .add(MaterialSystem)
  .add(SkySystem)
  .add(WorldSystem)
  .add(PhysicsSystem)
  .add(PlayerSystem)
  .add(WeaponSystem)
  .add(FxSystem)
  .add(AiSystem)
  .add(UiSystem)
  .add(AudioSystem);

// Web multiplayer: on by default, off for capture/deterministic runs or with
// ?mp=0. Every normal load joins (and, if needed, mints) a room, so the URL in
// the address bar is always a shareable invite link.
const multiplayer = !capture && params.get('mp') !== '0';
if (multiplayer) engine.add(NetSystem);

// Registered after `net` so the match view can read the room it joined; the
// lobby itself arrives on the event bus, so the order is a convenience, not a
// requirement. Without this system the game is live on the first frame.
if (matchFlow) engine.add(MatchSystem);

try {
  await engine.init();
} catch (err) {
  console.error('[boot] init failed', err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
       font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap">
BOOT FAILURE\n\n${err.stack ?? err.message}</pre>`
  );
  throw err;
}

const shotApi = installShotApi(engine, { capture, lockstep });

// Compile every shader permutation before the frame loop starts. Measured: without
// this, 86 programs compile lazily during play, up to 30 on one frame, producing
// 3.1-3.9 SECOND stalls. See src/core/prewarm.js.
//
// ON BY DEFAULT since the capture path was made frame-deterministic; opt out with
// `?prewarm=0`. It is now PROVEN pixel-neutral: `tools/baseline.mjs` with
// `--query=prewarm=0` vs `--query=prewarm=1` reports identical:true on all 11
// shots (0 changed pixels, maxDelta 0). The two things that previously made the
// ~1.4 s pre-warm spend look like a visual change were both boot-duration
// couplings OUTSIDE the subsystems: (1) the shutter frame index was latency-bound
// because the engine kept stepping through the driver's round trips — fixed by
// lockstep in src/dev/shots.js; (2) `will-change: transform` on the compass strip
// cached a composited-layer raster taken at a wall-clock-dependent moment — fixed
// in src/ui/style.js.
const warmup = params.get('prewarm') === '0' ? { ok: false, reason: 'disabled by ?prewarm=0' } : await prewarm(engine);
console.info('[boot] prewarm', warmup);
window.__PREWARM__ = warmup;

engine.start();

// Capture harness handshake: only flag ready once a frame has actually landed.
//
// BOOT_FRAMES is deliberately a frame COUNT, not a rAF race. In lockstep mode the
// engine has no loop of its own, so we hand-pump exactly this many frames and only
// then raise __READY__; the shot is therefore always applied at engine frame 3, no
// matter how long boot (or pre-warm) took in wall-clock terms.
const BOOT_FRAMES = 3;
if (lockstep) {
  await shotApi.pump(BOOT_FRAMES);
  window.__READY__ = true;
} else {
  let warm = 0;
  const readyProbe = () => {
    if (++warm >= BOOT_FRAMES) {
      window.__READY__ = true;
      return;
    }
    requestAnimationFrame(readyProbe);
  };
  requestAnimationFrame(readyProbe);
}

window.__ENGINE__ = engine;

// Frame instrumentation, exposed for tooling (tools/fpslog.mjs) and for reading
// straight out of the devtools console:
//
//   __PERF__.stats()                      percentiles, phase breakdown, bound
//   __PERF__.log()                        one-line summary + the object
//   __PERF__.startRecording({frames:600}) begin a benchmark capture
//   __PERF__.stopRecording()              -> { label, frames, stats, rows }
//   __PERF__.csv()                        last recording as CSV
//
// `?perflog=N` prints a summary every N frames, which is how a headless run
// leaves a performance trail in the console log without any driver code.
window.__PERF__ = engine.perf;
const perflog = Number(params.get('perflog'));
if (Number.isFinite(perflog) && perflog > 0) engine.perf.autoLog(perflog);

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
