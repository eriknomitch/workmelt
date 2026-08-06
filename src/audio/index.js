/**
 * AUDIO — synthesized weapon/foley audio, spatialisation, reverb, occlusion, mix
 *
 * Voices are either synthesized with the Web Audio API or played back from
 * sampled sources, behind one API — callers never know which.
 *
 * samples.js loads public/sfx/ (built by tools/encode-sfx.mjs) in the
 * background and _build() prefers it per kind; anything it has no sample for —
 * suppressed weapons, enemy barks, glass/flesh/rubber footsteps, dry-fire —
 * synthesizes exactly as before. A build with no encoded assets is a supported
 * configuration and sounds fully procedural.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const audio = ctx.get('audio')
 * ───────────────────────────────────────────────────────────────────────────
 *   audio.running                      graph is live (needs a user gesture)
 *   audio.start()                      force-start (returns Promise<boolean>)
 *   audio.deafness                     0..1 concussion; UI/post may read this
 *   audio.play(kind, position, opts)   one-shot; position null = head-locked
 *   audio.bark(kind, position, opts)   enemy voice: 'spot' | 'reload' |
 *                                      'grenade' | 'flank' | 'suppress' |
 *                                      'advance' | 'hurt' | 'death' | 'copy'
 *   audio.ui(kind)                     'hitmarker'|'headshot'|'kill'|'damage'
 *   audio.announce(line)               announcer: 'match_begin' | 'start' |
 *                                      'headshot' | 'killstreak' | 'game_over'
 *   audio.setMasterVolume(v)  audio.setBusVolume(bus, v)
 *   audio.setAmbienceIntensity(v)      scales the distant-battle scheduler
 *   audio.setAmbienceWind(v)           wind bed level 0..1 (ships at 0)
 *   audio.report()                     diagnostics snapshot
 *
 * All of it is a no-op — never a throw — before the graph exists, so callers
 * never have to check whether audio started.
 *
 * Driven off the canonical events in ARCHITECTURE.md: weapon:fire,
 * weapon:reload, weapon:shell, bullet:impact, bullet:tracer, damage:dealt,
 * damage:taken, actor:death, player:land, player:footstep, actor:footstep,
 * player:state,
 * explosion. If `ai` emits the optional `ai:bark {kind, position, voice}` it is
 * picked up as well.
 */

import { NoiseBank, SPEED_OF_SOUND, clamp, gain as mkGain } from './dsp.js';
import { Mixer } from './mixer.js';
import { SpatialField } from './spatial.js';
import { Ambience, ambientOneShot, ONE_SHOTS } from './ambience.js';
import { DEFAULT_GAME_CONFIG, loadGameConfig } from '../core/gameConfig.js';
import { WEAPON_PROFILES, resolveProfile, weaponShot, bulletWhizz, dryFire } from './weapons.js';
import {
  surfaceImpact, footstep, shellCasing, reloadPhase, explosion, bodyFall, uiSound,
  heartbeat, cloth,
} from './foley.js';
import { bark as voxBark, barkFor } from './vox.js';
import { classifySpace } from './ir.js';
import { SampleBank } from './samples.js';

/**
 * ANNOUNCER — spoken match callouts (public/sfx/vox/, recorded not synthesized).
 *
 * Lines queue instead of overlapping: two voices on top of each other is mush,
 * and a headshot that also completes a streak fires both in the same frame.
 * A line that would have to wait longer than QUEUE_MAX is dropped instead —
 * by the time it played, it would be describing something that already scrolled
 * off the killfeed.
 */
const ANNOUNCE_GAP = 0.12;      // seconds of air between queued lines
const ANNOUNCE_QUEUE_MAX = 1.2; // drop a line rather than say it this late
/** Kills without dying that earn a "killstreak" callout, and every N after. */
const KILLSTREAK_EVERY = 3;

const PROBE_RAYS = 9;
const PROBE_DIST = 40;
const DRY_SLOTS = 48;
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel'];

/** Where tools/encode-sfx.mjs puts its output, honouring a deployed subpath. */
const SAMPLE_BASE = `${import.meta.env?.BASE_URL ?? '/'}sfx/`.replace(/\/{2,}/g, '/');

/** Base the public-root `game.json` is fetched from, honouring a deployed subpath. */
const CONFIG_BASE = `${import.meta.env?.BASE_URL ?? '/'}`.replace(/\/{2,}/g, '/');

/**
 * Your own boots, played dry. Was an effective 0.72 through a 3D emitter parked
 * in the no-attenuation zone, which is why it drowned everything.
 */
const SELF_STEP_LEVEL = 0.34;

/**
 * Your own landing, at the top of its velocity ramp. Also dry — see _onLand.
 *
 * Derived rather than dialled: exactly twice a walking step, which reads as the
 * bigger event it is while still sitting under the 0.72 that drowned the mix.
 * A landing is punctuational where a step repeats twice a second, so it can
 * afford the headroom a step could not.
 */
const SELF_LAND_LEVEL = SELF_STEP_LEVEL * 2;

/**
 * Footstep distance law, deliberately shallower than `spatial.attenuation()`.
 *
 * The physical curve rolls off at 0.85 and was tuned when the only footstep in
 * the game was your own — it put an enemy at 10 m a full 10 dB under your feet,
 * which is inaudible under fire. Footsteps are a gameplay signal before they are
 * a physical event, so they get 0.38 and a nearer hard cutoff: clearly readable
 * out to ~25 m, then gone, rather than a faint wash of the whole map. Gunfire
 * and impacts keep the physical curve.
 */
const STEP_REF = 2.0;
const STEP_ROLLOFF = 0.38;
const STEP_CUTOFF = 32;
function stepAttenuation(dist) {
  return STEP_REF / (STEP_REF + STEP_ROLLOFF * Math.max(0, dist - STEP_REF));
}

/** Names other subsystems already use, mapped onto our voices. */
const UI_ALIAS = {
  hit_flesh: 'hitmarker', hit: 'hitmarker', hit_head: 'headshot', headshot: 'headshot',
  hit_kill: 'kill', hit_armour: 'armour', player_hurt: 'damage', hurt: 'damage',
  weapon_fire_dry: 'dryfire', dry: 'dryfire', low_health: 'lowhealth',
};

/** Default bus per voice kind, so callers do not have to know the mix layout. */
const BUS_FOR = {
  shot: 'weapons', explosion: 'weapons', dryfire: 'weapons',
  hitmarker: 'ui', headshot: 'ui', kill: 'ui', armour: 'ui', damage: 'ui',
  grenade_warn: 'ui', regen: 'ui', lowhealth: 'ui',
  join: 'ui', leave: 'ui', ready: 'ui', unready: 'ui', countdown: 'ui', matchstart: 'ui',
  bark: 'voice', ambient: 'ambience',
};

/** Finite Vector3-ish check — one NaN from any subsystem must not throw. */
function isVec(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

export class AudioSystem {
  static id = 'audio';
  static deps = [];

  constructor() {
    this.running = false;
    this.failed = false;
    this.actx = null;
    this.mixer = null;
    this.field = null;
    this.ambience = null;
    this.bank = null;
    this.samples = null;
    this.deafness = 0;
    /** `game.json`'s audio.ambience section; DEFAULT_GAME_CONFIG until init() resolves the fetch. */
    this.ambienceCfg = DEFAULT_GAME_CONFIG.audio.ambience;

    /* preallocated scratch — update() allocates nothing */
    this._probeDirs = [];
    for (let i = 0; i < PROBE_RAYS - 1; i++) {
      const a = (i / (PROBE_RAYS - 1)) * Math.PI * 2;
      this._probeDirs.push({ x: Math.cos(a), y: 0.06, z: Math.sin(a) });
    }
    this._probeDirs.push({ x: 0, y: 1, z: 0 });
    this._probeHits = new Float64Array(PROBE_RAYS);
    this._space = {
      tight: 0, room: 0, street: 0.35, tunnel: 0, open: 0.65,
      enclosure: 0, meanFree: PROBE_DIST, ceiling: PROBE_DIST,
    };
    this._probeTimer = 0;
    this._lastProbe = { x: 1e9, y: 0, z: 0 };
    this._origin = { x: 0, y: 0, z: 0 };

    /* dry (head-locked) voice bookkeeping */
    this._dry = [];
    for (let i = 0; i < DRY_SLOTS; i++) this._dry.push({ node: null, send: null, end: 0 });
    this._dryCursor = 0;

    /* per-frame rate limits */
    // `selfStep` is separate from `step` on purpose: a garrison moving nearby
    // would otherwise spend the shared budget and drop the player's own boots,
    // which is the one footstep that must never stutter.
    this._budget = { impact: 0, step: 0, shell: 0, whizz: 0, selfStep: 0 };
    this._lastBarkTime = -99;
    this._lastEnemyFire = -99;

    this._health = 100;
    this._heartTimer = 0;
    /** Announcer: kills since the last death, and when the queue frees up. */
    this._streak = 0;
    this._announceFreeAt = 0;
    this._stance = null;
    this._ads = false;

    this.stats = {
      voices: 0, dropped: 0, stolen: 0, rays: 0, deafness: 0,
      space: 'open', started: false, contextState: 'none', events: 0, errors: 0,
    };

    this._offs = [];
    this._gestureHandler = null;
    this._ambienceApi = null;
  }

  /* ================================================================ */
  /* lifecycle                                                        */
  /* ================================================================ */

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this._wireEvents(ctx);

    // Not awaited: the graph must still come up on the first user gesture
    // even if game.json is slow or missing, falling back to DEFAULT_GAME_CONFIG.
    loadGameConfig(CONFIG_BASE).then((cfg) => { this.ambienceCfg = cfg.audio.ambience; });

    // Web Audio needs a user gesture. Arm every plausible one; the first to
    // land builds the graph. Capture mode never gestures, so shots render in
    // silence and stay byte-identical.
    const kick = () => {
      this._disarmGesture();
      this.start().catch(() => {});
    };
    this._gestureHandler = kick;
    if (typeof addEventListener === 'function') {
      for (const ev of GESTURES) addEventListener(ev, kick, { passive: true });
    }
    if (typeof window !== 'undefined') window.__AUDIO__ = this;
  }

  _disarmGesture() {
    if (!this._gestureHandler) return;
    for (const ev of GESTURES) removeEventListener(ev, this._gestureHandler);
    this._gestureHandler = null;
  }

  /**
   * Build the graph. Safe to call repeatedly; resolves false when audio is
   * unavailable (no AudioContext, blocked autoplay, headless renderer, ...).
   */
  async start() {
    if (this.running) return true;
    if (this.failed) return false;
    try {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) throw new Error('no AudioContext');
      const actx = new AC({ latencyHint: 'interactive' });
      this.actx = actx;

      this.bank = new NoiseBank(actx, this.rng.fork(), 2.4);
      this.mixer = new Mixer(actx, this.rng.fork(), {});
      this.mixer.buildReverbs();
      this.field = new SpatialField(actx, this.mixer, this.ctx);
      this.ambience = new Ambience(actx, this.bank, this.mixer, this.field, this.rng.fork(), this.ambienceCfg);
      this.ambience.start();
      this.mixer.setSpace(this._space, 0.001);

      if (actx.state === 'suspended') await actx.resume();
      this.running = true;
      this.stats.started = true;
      this.stats.contextState = actx.state;
      console.info(`[audio] online @ ${actx.sampleRate} Hz`);

      // Sampled voices load in the background — deliberately not awaited. The
      // graph is live now, and every kind falls back to synthesis until its
      // buffers land, so the first shot of a match is never delayed by a fetch.
      this.samples = new SampleBank(actx);
      this.samples.load(SAMPLE_BASE).catch(() => { /* stays synthesized */ });

      return true;
    } catch (err) {
      console.warn('[audio] disabled:', err?.message ?? err);
      this.failed = true;
      this._teardown();
      return false;
    }
  }

  _teardown() {
    try {
      this.samples?.dispose();
      this.ambience?.dispose();
      this.field?.dispose();
      this.mixer?.dispose();
      this.bank?.dispose();
      if (this.actx && this.actx.state !== 'closed') this.actx.close();
    } catch { /* nothing useful to do */ }
    this.ambience = this.field = this.mixer = this.bank = this.samples = null;
    this.actx = null;
    this.running = false;
  }

  dispose() {
    this._disarmGesture();
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._teardown();
    if (typeof window !== 'undefined' && window.__AUDIO__ === this) delete window.__AUDIO__;
  }

  /* ================================================================ */
  /* frame                                                            */
  /* ================================================================ */

  update(dt, ctx) {
    if (!this.running) return;
    try {
      const actx = this.actx;
      if (actx.state === 'suspended') return; // tab hidden, or resume pending

      /* ---- listener from the render camera ----------------------- */
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      this.field.setListener(
        e[12], e[13], e[14],
        -e[8], -e[9], -e[10],
        e[4], e[5], e[6]
      );

      /* ---- space probe ------------------------------------------- */
      this._probeTimer -= dt;
      const moved = Math.abs(e[12] - this._lastProbe.x) + Math.abs(e[13] - this._lastProbe.y) +
        Math.abs(e[14] - this._lastProbe.z);
      if (this._probeTimer <= 0 || moved > 1.6) {
        this._probeTimer = 0.45;
        this._lastProbe.x = e[12]; this._lastProbe.y = e[13]; this._lastProbe.z = e[14];
        this._probeSpace(ctx, e[12], e[13], e[14]);
      }

      /* ---- subsystems -------------------------------------------- */
      this.mixer.update(dt);
      this.field.update(dt);
      this.deafness = this.mixer.deafness;
      if (!this._ambienceApi) {
        this._ambienceApi = {
          distantVolley: () => this._distantVolley(),
          distantBoom: () => this._distantBoom(),
          oneShot: () => this._ambientOneShot(),
          distantChatter: () => this._distantChatter(),
        };
      }
      this.ambience.update(dt, this._ambienceApi);

      /* ---- head-locked voice teardown ---------------------------- */
      const now = actx.currentTime;
      for (let i = 0; i < this._dry.length; i++) {
        const d = this._dry[i];
        if (!d.node || now < d.end) continue;
        try { d.node.disconnect(); } catch { /* already gone */ }
        try { d.send?.disconnect(); } catch { /* already gone */ }
        d.node = null; d.send = null;
      }

      /* ---- low-health heartbeat ---------------------------------- */
      if (this._health < 34) {
        this._heartTimer -= dt;
        if (this._heartTimer <= 0) {
          this._heartTimer = 0.62 + (this._health / 34) * 0.45;
          this._playDry('heartbeat', { level: clamp(1 - this._health / 34, 0.2, 1) }, 'foley', 0.1);
        }
      }

      /* ---- reset per-frame budgets ------------------------------- */
      const b = this._budget;
      b.impact = 0; b.step = 0; b.shell = 0; b.whizz = 0; b.selfStep = 0;

      const s = this.stats;
      s.voices = this.field.stats.active;
      s.dropped = this.field.stats.dropped;
      s.stolen = this.field.stats.stolen;
      s.rays = this.field.stats.occlusionRays;
      s.deafness = this.deafness;
      s.contextState = actx.state;
    } catch (err) {
      this._error(err);
    }
  }

  _error(err) {
    this.stats.errors++;
    if (this.stats.errors < 6) console.error('[audio]', err);
    if (this.stats.errors === 40) {
      console.error('[audio] too many errors — disabling audio');
      this.failed = true;
      this._teardown();
    }
  }

  /* ================================================================ */
  /* environment probe                                                */
  /* ================================================================ */

  _probeSpace(ctx, x, y, z) {
    const phys = ctx.peek('physics');
    const hits = this._probeHits;
    if (phys?.raycast) {
      const mask = phys.MASK?.WORLD;
      const o = this._origin;
      o.x = x; o.y = y; o.z = z;
      for (let i = 0; i < PROBE_RAYS; i++) {
        const h = phys.raycast(o, this._probeDirs[i], PROBE_DIST, mask);
        hits[i] = h?.hit ? h.distance : PROBE_DIST;
      }
    } else {
      for (let i = 0; i < PROBE_RAYS; i++) hits[i] = PROBE_DIST;
    }
    classifySpace(hits, PROBE_DIST, this._space);
    this.mixer.setSpace(this._space, 0.4);
    this.ambience.setEnclosure(this._space.enclosure);

    let best = 'open', bv = -1;
    for (const k of ['tight', 'room', 'street', 'tunnel', 'open']) {
      if (this._space[k] > bv) { bv = this._space[k]; best = k; }
    }
    this.stats.space = best;
  }

  /* ================================================================ */
  /* voice plumbing                                                   */
  /* ================================================================ */

  /**
   * Build a voice by name. `when` is absolute context time, `dist` is metres
   * from the listener — voices use it to rebalance their own layers.
   */
  _build(kind, when, dist, o) {
    const { actx, bank } = this;
    const rng = this.rng;

    // Sampled first when the bank has this kind; synthesis is the fallback,
    // not the exception. Both return the same { node, end, send } voice, so
    // nothing downstream — spatialisation, sends, voice stealing — can tell.
    if (this.samples?.ready) {
      const s = this.samples.voice(kind, when, dist, o, rng);
      if (s) return s;
    }

    switch (kind) {
      case 'shot':
        return weaponShot(actx, bank, rng, o.profile ?? WEAPON_PROFILES.rifle, {
          when, distance: dist, firstPerson: o.firstPerson,
          echoBoost: 0.75 + this._space.street * 0.7 + this._space.tight * 0.35 +
            this._space.tunnel * 0.8 + this._space.open * 0.2,
        });
      case 'whizz': return bulletWhizz(actx, bank, rng, { when, miss: o.miss, gain: o.gain });
      case 'dryfire': return dryFire(actx, bank, rng, { when });
      case 'impact': return surfaceImpact(actx, bank, rng, { when, surface: o.surface, energy: o.energy });
      case 'step': return footstep(actx, bank, rng, { when, surface: o.surface, gait: o.gait, level: o.level, gear: o.gear });
      case 'shell': return shellCasing(actx, bank, rng, { when, surface: o.surface, level: o.level, flight: o.flight });
      case 'reload': return reloadPhase(actx, bank, rng, o.phase, { when, heavy: o.heavy });
      case 'explosion': return explosion(actx, bank, rng, { when, distance: dist, radius: o.radius, level: o.level });
      case 'bodyfall': return bodyFall(actx, bank, rng, { when, level: o.level });
      case 'cloth': return cloth(actx, bank, rng, { when, level: o.level });
      case 'heartbeat': return heartbeat(actx, bank, rng, { when, level: o.level });
      case 'bark': return voxBark(actx, bank, rng, { when, bark: o.bark, f0: o.f0, tract: o.tract, level: o.level, radio: o.radio });
      case 'ambient': return ambientOneShot(actx, bank, rng, o.which, { when, level: o.level });
      default: return uiSound(actx, bank, rng, kind, { when, level: o.level });
    }
  }

  /**
   * Spatialised one-shot: propagation delay, occlusion, air absorption and the
   * reverb send. Returns false when the voice budget refused it.
   */
  _playAt(kind, x, y, z, o = {}, bus = 'foley', priority = 0.5) {
    if (!this.running || this.actx.state === 'suspended') return false;
    if (!Number.isFinite(x + y + z)) return this._playDry(kind, o, bus, o.send ?? 0.15);
    try {
      const field = this.field;
      const dist = field.distanceTo(x, y, z);
      if (dist > (o.maxDist ?? 320)) return false;
      const delay = o.noDelay ? 0 : dist / SPEED_OF_SOUND;
      const when = this.actx.currentTime + delay + (o.extraDelay ?? 0);
      const voice = this._build(kind, when, dist, o);
      const em = field.acquire({
        x, y, z, when, dist, bus, priority,
        send: o.send ?? voice.send ?? 0.3,
        gain: o.gain ?? 1,
        endTime: voice.end,
        occlusion: o.occlusion,
        tracked: o.tracked,
        // Opt out of the physical distance law; acquire() still folds occlusion
        // in on top. Only footsteps use this — see stepAttenuation().
        atten: o.atten,
      });
      if (!em) {
        try { voice.node.disconnect(); } catch { /* noop */ }
        return false;
      }
      field.hold(em, voice.node, voice.end);
      this.stats.events++;
      return true;
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  /** Head-locked one-shot: own weapon, UI, player grunts, heartbeat. */
  _playDry(kind, o = {}, bus = 'foley', send = 0.15) {
    if (!this.running || this.actx.state === 'suspended') return false;
    try {
      const when = this.actx.currentTime + (o.extraDelay ?? 0);
      const voice = this._build(kind, when, o.dist ?? 0, o);
      const g = mkGain(this.actx, o.gain ?? 1);
      voice.node.connect(g);
      g.connect(this.mixer.bus(bus));
      let sendNode = null;
      const sendLevel = (o.send ?? send) * (voice.send ?? 1);
      if (sendLevel > 0.001) {
        sendNode = mkGain(this.actx, sendLevel);
        g.connect(sendNode);
        sendNode.connect(this.mixer.reverbSend);
      }
      // Claim a bookkeeping slot; steal the oldest if all are busy.
      let slot = null;
      for (let i = 0; i < this._dry.length; i++) {
        const idx = (this._dryCursor + i) % this._dry.length;
        if (!this._dry[idx].node) {
          slot = this._dry[idx];
          this._dryCursor = (idx + 1) % this._dry.length;
          break;
        }
      }
      if (!slot) {
        slot = this._dry[this._dryCursor];
        try { slot.node.disconnect(); slot.send?.disconnect(); } catch { /* noop */ }
        this._dryCursor = (this._dryCursor + 1) % this._dry.length;
      }
      slot.node = g;
      slot.send = sendNode;
      slot.end = voice.end + 0.05;
      this.stats.events++;
      return true;
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  /* ================================================================ */
  /* public helpers                                                   */
  /* ================================================================ */

  /**
   * Fire a one-shot. Tolerant on purpose: other subsystems call this with
   * several different conventions and audio must never be the thing that throws.
   *   play('impact', vec3, { surface })   play('hit_flesh', { gain: 0.7 })
   *   play('shell', vec3, 0.8)
   */
  play(kind, position, opts) {
    if (typeof opts === 'number') opts = { gain: opts };
    if (typeof position === 'number') { opts = { gain: position }; position = null; }
    // A caller may have passed an options bag where a position goes.
    if (position && !isVec(position)) {
      opts = opts ?? position;
      position = null;
    }
    opts = opts ?? {};
    const k = UI_ALIAS[kind] ?? kind;
    if (position) {
      return this._playAt(k, position.x, position.y, position.z, opts,
        opts.bus ?? BUS_FOR[k] ?? 'foley', opts.priority ?? 0.5);
    }
    return this._playDry(k, opts, opts.bus ?? BUS_FOR[k] ?? 'foley', opts.send ?? 0.15);
  }

  ui(kind, level = 1) {
    const k = UI_ALIAS[kind] ?? kind;
    return this._playDry(k, { level }, BUS_FOR[k] ?? 'ui', k === 'heartbeat' ? 0.1 : 0);
  }

  /**
   * Speak an announcer line. Recorded only — there is no synthesized fallback,
   * so a build without `public/sfx/vox/` simply says nothing.
   *
   * @param {string} line   key in the manifest's `vox` group
   * @param {object} [opts] { level, delay } — `delay` seconds before it starts,
   *                        used to let a stinger land before the voice does.
   * @returns {boolean} whether a line was scheduled
   */
  announce(line, opts = {}) {
    if (!this.running || !this.samples?.has('vox', line)) return false;
    const now = this.actx.currentTime;
    const at = Math.max(now + (opts.delay ?? 0), this._announceFreeAt);
    if (at - now > ANNOUNCE_QUEUE_MAX) return false;
    this._announceFreeAt = at + this.samples.duration('vox', line) + ANNOUNCE_GAP;
    // `send: 1` hands the reverb decision to the voice itself (GROUP.vox), the
    // same convention every sampled voice uses.
    return this._playDry('announce', { line, level: opts.level ?? 0.85, extraDelay: at - now }, 'ui', 1);
  }

  /** Adapter the `ui` subsystem probes for: playUi(id, gain). */
  playUi(id, gain = 1) {
    return this.ui(id, gain);
  }

  /** Adapter the `fx` subsystem probes for: playShell(position, gain). */
  playShell(position, gain = 1) {
    if (!isVec(position)) return false;
    return this._playAt('shell', position.x, position.y, position.z,
      { level: gain, surface: 'concrete', flight: 0.02 }, 'foley', 0.25);
  }

  /** Adapter for impact FX that would rather call directly than emit. */
  playImpact(position, surface = 'concrete', energy = 1) {
    if (!isVec(position)) return false;
    return this._playAt('impact', position.x, position.y, position.z, { surface, energy }, 'foley', 0.55);
  }

  /** Enemy vocalisation. `kind` is semantic — see barkFor() in vox.js. */
  bark(kind, position, opts = {}) {
    if (!this.running) return false;
    const now = this.actx.currentTime;
    if (now - this._lastBarkTime < 0.42 && !opts.force) return false; // no mush
    this._lastBarkTime = now;
    const seed = (opts.voice ?? 0) | 0;
    const o = {
      bark: barkFor(kind, this.rng),
      f0: 96 + ((seed * 37) % 41),
      tract: 0.95 + ((seed * 13) % 11) / 100,
      level: opts.level ?? 1,
      radio: opts.radio ?? false,
      send: opts.send,
    };
    if (position) return this._playAt('bark', position.x, position.y, position.z, o, 'voice', 0.85);
    return this._playDry('bark', o, 'voice', 0.25);
  }

  setMasterVolume(v) { this.mixer?.setMasterVolume(v); }
  setBusVolume(bus, v) { this.mixer?.setBusVolume(bus, v); }
  setAmbienceIntensity(v) { if (this.ambience) this.ambience.intensity = clamp(v, 0, 3); }
  /** Wind bed level, 0..1. Ships at 0 — see WIND_LEVEL in ambience.js. */
  setAmbienceWind(v) { this.ambience?.setWind(clamp(v, 0, 1)); }
  setOcclusionEnabled(v) { if (this.field) this.field.occlusionEnabled = !!v; }

  /* ================================================================ */
  /* events                                                           */
  /* ================================================================ */

  _wireEvents(ctx) {
    const ev = ctx.events;
    const on = (name, fn) => this._offs.push(ev.on(name, fn));

    on('weapon:fire', (p) => this._onFire(p));
    on('weapon:reload', (p) => this._onReload(p));
    on('weapon:shell', (p) => this._onShell(p));
    on('bullet:impact', (p) => this._onImpact(p));
    on('bullet:tracer', (p) => this._onTracer(p));
    on('explosion', (p) => this._onExplosion(p));
    on('player:footstep', (p) => this._onFootstep(p));
    // Bots and remote players — `ai` owns both bodies, so both arrive here.
    on('actor:footstep', (p) => this._onActorFootstep(p));
    on('player:land', (p) => this._onLand(p));
    on('player:state', (p) => this._onPlayerState(p));
    on('damage:dealt', (p) => this._onDamageDealt(p));
    on('damage:taken', (p) => this._onDamageTaken(p));
    on('actor:death', (p) => this._onDeath(p));
    // Optional: emitted by `ai` if it wants scripted chatter.
    on('ai:bark', (p) => this.bark(p?.kind ?? 'spot', p?.position, { voice: p?.voice ?? 0 }));

    /* ---- announcer ------------------------------------------------ */
    // The relay's pre-match signal, so the line runs under the countdown.
    on('net:countdown', () => this.announce('match_begin'));
    // Deployment: let the horn land first, then the voice.
    on('match:start', () => {
      this._streak = 0;
      this.announce('start', { delay: 0.28 });
    });
    // PvP kills the relay confirmed. Local deaths are NOT read from here: the
    // player system emits player:death for every death, PvP or bot.
    on('net:kill', (p) => { if (p?.mine) this._onScored(!!p.headshot); });
    on('player:death', () => this._onEliminated());
  }

  /** A kill the local player earned: headshot callout, then streak milestones. */
  _onScored(headshot) {
    this._streak++;
    if (headshot) this.announce('headshot');
    if (this._streak >= KILLSTREAK_EVERY && this._streak % KILLSTREAK_EVERY === 0) {
      this.announce('killstreak');
    }
  }

  _onEliminated() {
    this._streak = 0;
    this.announce('game_over');
  }

  _onFire(p) {
    if (!this.running || !p) return;
    const w = p.weapon;
    const name = typeof w === 'string' ? w : (w?.audio ?? w?.id ?? w?.name ?? w?.kind);
    let profile = resolveProfile(name);
    if (w && typeof w === 'object' && w.suppressed) profile = WEAPON_PROFILES.suppressed;

    if (p.empty) {
      this._playDry('dryfire', {}, 'weapons', 0.15);
      return;
    }

    const o = p.origin;
    const lp = this.field.listenerPos;
    const x = o?.x ?? lp.x, y = o?.y ?? lp.y, z = o?.z ?? lp.z;
    const dist = this.field.distanceTo(x, y, z);
    const firstPerson = p.firstPerson ?? dist < 2.6;

    if (firstPerson) {
      // Own weapon: no propagation delay, mostly dry, and the send level is
      // driven by the space probe so the *room* answers the shot — a tight slap
      // indoors, a long crack down the street.
      const echo = 0.35 + this._space.tight * 0.5 + this._space.street * 0.9 +
        this._space.tunnel * 1.0 + this._space.room * 0.75;
      this._playDry('shot', { profile, firstPerson: true }, 'weapons', echo * 0.6);
      this.mixer.duck(0.55, 0.1);
    } else {
      this._playAt('shot', x, y, z, { profile, firstPerson: false }, 'weapons', 0.95);
      this.mixer.duck(clamp(0.5 - dist * 0.004, 0.12, 0.5), 0.08);
      // Enemies opening fire get occasional chatter, so firefights feel alive
      // even before `ai` grows its own bark logic.
      const now = this.actx.currentTime;
      if (now - this._lastEnemyFire > 4.5 && this.rng.float() < 0.45) {
        this._lastEnemyFire = now;
        this.bark(this.rng.float() < 0.6 ? 'spot' : 'suppress', p.origin, { level: 0.9 });
      }
    }
  }

  _onReload(p) {
    if (!this.running) return;
    const w = p?.weapon;
    const name = typeof w === 'string' ? w : (w?.audio ?? w?.id ?? w?.name);
    const heavy = /lmg|shot|snip|m249|pkm/i.test(String(name ?? '')) ? 1.35 : 1;
    const phase = p?.phase ?? 'end';
    // `weapon` and `empty` are only read by the sample bank — reloadPhase()
    // synthesizes from `phase` and `heavy` alone — but they have to travel with
    // every reload voice, because which of the two paths serves it is decided
    // later, in _build(), and depends on what has finished decoding.
    const empty = !!p?.empty;
    const o = { phase, heavy, weapon: name, empty };
    if (p?.position) {
      this._playAt('reload', p.position.x, p.position.y, p.position.z, o, 'foley', 0.6);
    } else {
      this._playDry('reload', o, 'foley', 0.22);
    }
  }

  _onShell(p) {
    if (!this.running || !p) return;
    if (this._budget.shell++ > 2) return;
    // No fallback to the listener: brass placed at the head would sit in
    // attenuation()'s flat near field and ring at full gain. Both emitters
    // (weapons, ai) always send a position, so a payload without one is
    // malformed and silence is the honest answer.
    const pos = p.position;
    if (!isVec(pos)) return;
    const x = pos.x, y = pos.y, z = pos.z;
    const dist = this.field.distanceTo(x, y, z);
    if (dist > 22) return;
    // Find what it will land on, so brass on sand does not ring like concrete.
    let surface = 'concrete';
    const phys = this.ctx.peek('physics');
    if (phys?.raycast) {
      const h = phys.raycast(x, y + 0.2, z, 0, -1, 0, 6, phys.MASK?.WORLD);
      if (h?.hit) surface = h.surface;
    }
    this._playAt('shell', x, y - 0.6, z, {
      surface,
      level: clamp(1 - dist * 0.02, 0.3, 1),
      flight: 0.25 + this.rng.range(0, 0.3),
    }, 'foley', 0.25);
  }

  _onImpact(p) {
    if (!this.running || !p) return;
    if (p.exit) return;                       // only the entry side gets a sound
    if (this._budget.impact++ > 4) return;
    const pt = p.point;
    if (!pt) return;
    const dist = this.field.distanceTo(pt.x, pt.y, pt.z);
    if (dist > 90) return;
    this._playAt('impact', pt.x, pt.y, pt.z, {
      surface: p.surface ?? 'concrete',
      energy: clamp((p.damage ?? 30) / 34, 0.35, 1.5),
    }, 'foley', 0.55);
    // The round cracking past you is a separate sound from the impact itself.
    if (dist < 6) {
      this._playAt('whizz', pt.x, pt.y, pt.z, { miss: dist, noDelay: true }, 'foley', 0.7);
    }
  }

  _onTracer(p) {
    if (!this.running || !p?.from || !p?.to) return;
    if (this._budget.whizz++ > 2) return;
    // Closest approach of the trajectory to the listener.
    const lp = this.field.listenerPos;
    const ax = p.from.x, ay = p.from.y, az = p.from.z;
    const dx = p.to.x - ax, dy = p.to.y - ay, dz = p.to.z - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) return;
    const t = clamp(((lp.x - ax) * dx + (lp.y - ay) * dy + (lp.z - az) * dz) / len2, 0, 1);
    const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
    const miss = Math.hypot(lp.x - cx, lp.y - cy, lp.z - cz);
    if (miss > 5) return;
    if (Math.hypot(lp.x - ax, lp.y - ay, lp.z - az) < 3) return; // our own muzzle
    const flight = (Math.sqrt(len2) * t) / (p.speed ?? 850);
    this._playAt('whizz', cx, cy, cz, { miss, noDelay: true, extraDelay: flight }, 'foley', 0.75);
  }

  _onExplosion(p) {
    if (!this.running || !p?.position) return;
    const pos = p.position;
    const dist = this.field.distanceTo(pos.x, pos.y, pos.z);
    this._playAt('explosion', pos.x, pos.y, pos.z, {
      radius: p.radius ?? 6, level: 1, send: 1.0,
    }, 'weapons', 1);
    this.mixer.duck(0.85, 0.35);
    // Concussion: total inside ~4 m, nothing past ~22 m.
    const near = clamp(1 - dist / 22, 0, 1);
    if (near > 0.1) this.mixer.concuss(Math.pow(near, 1.4));
  }

  /**
   * The local player's own step. Deliberately NOT spatialised.
   *
   * Panning a source that is rigidly attached to the listener's head conveys
   * nothing, and the position it would get — the feet, ~1.6 m down — sits inside
   * `attenuation()`'s flat near field, so a 3D emitter gives it full gain and
   * makes your own boots the loudest footstep the game can produce. A dry voice
   * at a fixed level is both more honest and immune to emitter stealing, so your
   * own movement never drops out in a firefight.
   *
   * SELF_STEP_LEVEL is the knob if this wants rebalancing against enemy steps.
   */
  _onFootstep(p) {
    if (!this.running) return;
    if (this._budget.selfStep++ > 1) return;
    const gait = p?.gait ?? (p?.running ? 'run' : p?.crouched ? 'crouch' : 'walk');
    this._playDry('step', {
      surface: p?.surface ?? 'concrete', gait,
      level: p?.level ?? SELF_STEP_LEVEL,
    }, 'foley', 0.12);
  }

  /**
   * A bot or remote player's step, from `ai`. Spatialised, but on a gentler
   * curve than the physical one — see STEP_ROLLOFF.
   */
  _onActorFootstep(p) {
    if (!this.running) return;
    if (this._budget.step++ > 3) return;
    const pos = p?.position;
    if (!pos) return;
    const dist = this.field.distanceTo(pos.x, pos.y, pos.z);
    if (dist > STEP_CUTOFF) return;
    const gait = p?.gait ?? (p?.running ? 'run' : p?.crouched ? 'crouch' : 'walk');
    this._playAt('step', pos.x, pos.y, pos.z, {
      surface: p?.surface ?? 'concrete', gait,
      level: p?.level ?? 1,
      atten: stepAttenuation(dist),
    }, 'foley', 0.4);
  }

  /**
   * The local player's own landing. Dry, for the same reasons as _onFootstep.
   *
   * This used to play through a 3D emitter parked at `listenerPos.y - 1.6` —
   * always directly under your own head, so the panning carried no information,
   * and 1.6 m sits inside `attenuation()`'s flat near field, which returns
   * exactly 1.0. With a level that reached 1.7 that made a hard landing the
   * loudest foley the game could produce: more than twice the 0.72 that was
   * already judged to drown everything when your own boots played that way.
   *
   * Levels are calibrated against SELF_STEP_LEVEL rather than by ear — a soft
   * landing sits just above a walking step, a hard one at exactly twice it.
   */
  _onLand(p) {
    if (!this.running) return;
    const v = Math.abs(typeof p?.velocity === 'number' ? p.velocity : (p?.velocity?.y ?? 4));
    this._playDry('step', {
      surface: p?.surface ?? 'concrete', gait: 'land',
      level: clamp((v / 7) * SELF_LAND_LEVEL, SELF_STEP_LEVEL + 0.02, SELF_LAND_LEVEL),
      gear: 1,
    }, 'foley', 0.18);
    if (v > 8.5) this._playDry('cloth', { level: 0.8 }, 'foley', 0.15);
  }

  _onPlayerState(p) {
    if (!this.running || !p) return;
    if (p.stance !== undefined && p.stance !== this._stance) {
      this._stance = p.stance;
      this._playDry('cloth', { level: 0.9 }, 'foley', 0.12);
    }
    if (p.ads !== undefined && p.ads !== this._ads) {
      this._ads = p.ads;
      this._playDry('cloth', { level: 0.45 }, 'foley', 0.1);
    }
  }

  _onDamageDealt(p) {
    if (!this.running || !p) return;
    // "Damage dealt TO p.target" — `ai` also uses this for rounds that hit the
    // player, and a hitmarker tick for being shot at is backwards. Incoming
    // damage is handled by _onDamageTaken.
    const t = p.target;
    if (t === 'player' || t?.isPlayer === true || t === this.ctx.peek('player')) return;
    this.ui(p.headshot ? 'headshot' : 'hitmarker', 1);
    if (p.killed) {
      this.ui('kill', 1);
      // Bots count toward the streak exactly as players do; PvP kills arrive
      // separately as `net:kill`, since the relay is what confirms them.
      this._onScored(!!p.headshot);
    }
    else if (p.point && p.target && this.rng.float() < 0.3) {
      this.bark('hurt', p.point, { level: 0.85 });
    }
  }

  _onDamageTaken(p) {
    if (!this.running || !p) return;
    if (typeof p.health === 'number') this._health = p.health;
    this.ui('damage', clamp((p.amount ?? 20) / 25, 0.4, 1.4));
    if ((p.amount ?? 0) > 12 && this.rng.float() < 0.5) {
      this._playDry('bark', { bark: 'hit', level: 0.5, f0: 108 }, 'voice', 0.1);
    }
  }

  _onDeath(p) {
    if (!this.running) return;
    const pt = p?.point;
    if (!pt) return;
    this.bark('death', pt, { level: 1, force: true, voice: (p?.actor?.id ?? 0) | 0 });
    this._playAt('bodyfall', pt.x, pt.y, pt.z, {
      level: 1, extraDelay: 0.45 + this.rng.range(0, 0.4),
    }, 'foley', 0.6);
  }

  /* ================================================================ */
  /* ambience callbacks                                               */
  /* ================================================================ */

  /** A burst of gunfire a long way off, with correct propagation delay. */
  _distantVolley() {
    if (!this.running) return;
    const c = this.ambienceCfg.distantVolley;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(...c.distance);
    const x = lp.x + Math.cos(a) * d;
    const z = lp.z + Math.sin(a) * d;
    const y = lp.y + rng.range(...c.heightJitter);
    const profile = rng.pick([WEAPON_PROFILES.ak, WEAPON_PROFILES.rifle, WEAPON_PROFILES.lmg, WEAPON_PROFILES.sniper]);
    const rounds = 1 + ((rng.u32() % c.maxRounds) | 0);
    const rate = rng.range(...c.rateRange);
    for (let i = 0; i < rounds; i++) {
      this._playAt('shot', x, y, z, {
        profile, extraDelay: i * rate * rng.range(0.9, 1.1), maxDist: c.maxDist,
        gain: c.gain,
        occlusion: 0, // it is over the rooftops, not through them
      }, 'weapons', 0.2);
    }
  }

  _distantBoom() {
    if (!this.running) return;
    const c = this.ambienceCfg.distantBoom;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(...c.distance);
    this._playAt('explosion', lp.x + Math.cos(a) * d, lp.y + rng.range(...c.heightJitter), lp.z + Math.sin(a) * d, {
      radius: rng.range(...c.radius), level: 1, maxDist: c.maxDist, occlusion: 0, gain: c.gain,
    }, 'weapons', 0.25);
  }

  _ambientOneShot() {
    if (!this.running) return;
    const c = this.ambienceCfg.oneShot;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const which = rng.pick(ONE_SHOTS);
    const far = which === 'heli' || which === 'siren';
    const d = far ? rng.range(...c.farDistance) : rng.range(...c.nearDistance);
    const a = rng.range(0, Math.PI * 2);
    this._playAt('ambient',
      lp.x + Math.cos(a) * d,
      lp.y + rng.range(-1, which === 'heli' ? 28 : 5),
      lp.z + Math.sin(a) * d,
      {
        which, level: rng.range(...c.levelRange), maxDist: c.maxDist,
        occlusion: far ? 0 : undefined,
        gain: far ? c.farGain : c.nearGain,
      }, 'ambience', 0.15);
  }

  _distantChatter() {
    if (!this.running) return;
    const c = this.ambienceCfg.distantChatter;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(...c.distance);
    this.bark(rng.pick(['advance', 'flank', 'copy', 'spot']), {
      x: lp.x + Math.cos(a) * d, y: lp.y, z: lp.z + Math.sin(a) * d,
    }, { level: c.level, voice: rng.int(0, 9) });
  }

  /* ================================================================ */
  /* debug                                                            */
  /* ================================================================ */

  /**
   * Fire one of everything, through the real event bus. Used by
   * src/audio/probe.mjs to prove the live graph runs without throwing; also
   * handy from the browser console.
   */
  debugStorm() {
    if (!this.running) return { error: 'audio not running' };
    const lp = this.field.listenerPos;
    const at = (dx, dy, dz) => ({ x: lp.x + dx, y: lp.y + dy, z: lp.z + dz });
    const ev = this.ctx.events;
    ev.emit('weapon:fire', { weapon: 'rifle', origin: at(0.2, -0.1, -0.3), dir: { x: 0, y: 0, z: -1 }, seed: 1 });
    ev.emit('weapon:fire', { weapon: 'ak', origin: at(14, 0, -22), dir: { x: 0, y: 0, z: 1 }, seed: 2 });
    ev.emit('weapon:fire', { weapon: 'sniper', origin: at(-70, 3, 90), dir: { x: 1, y: 0, z: 0 }, seed: 3 });
    ev.emit('weapon:fire', { weapon: 'shotgun', origin: at(3, 0, -4), dir: { x: 0, y: 0, z: -1 }, seed: 4 });
    ev.emit('weapon:fire', { weapon: { id: 'mp5', suppressed: true }, origin: at(-2, 0, -3), dir: { x: 0, y: 0, z: -1 }, seed: 5 });
    ev.emit('weapon:fire', { weapon: 'rifle', origin: at(0.2, -0.1, -0.3), empty: true });
    const surfaces = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'glass', 'water', 'foliage', 'fabric', 'flesh', 'rubber', 'plaster'];
    for (const s of surfaces) {
      ev.emit('bullet:impact', {
        point: at(this.rng.range(-6, 6), this.rng.range(0, 2), this.rng.range(-8, -2)),
        normal: { x: 0, y: 1, z: 0 }, incident: { x: 0, y: 0, z: -1 },
        surface: s, damage: 32, exit: false,
      });
      ev.emit('player:footstep', { position: at(0, -1.6, 0), surface: s, running: true });
    }
    // Enemy steps at a spread of ranges: exercises stepAttenuation() and the
    // cutoff, which the local player's dry step never touches.
    for (const d of [1.5, 6, 14, 26, 40]) {
      ev.emit('actor:footstep', {
        actor: { id: 9 }, position: at(d * 0.7, -1.6, -d * 0.7),
        surface: 'concrete', speed: 4.2, running: true, crouched: false, left: d < 20,
      });
    }
    ev.emit('weapon:shell', { position: at(0.3, -0.2, -0.2), velocity: { x: 1, y: 1, z: 0 } });
    // A malformed shell must be dropped, not parked on the listener at full gain.
    ev.emit('weapon:shell', { velocity: { x: 1, y: 1, z: 0 } });
    // Both variants: `empty` selects a different take for magout and end, so a
    // tac-only storm would leave half the reload foley never once decoded.
    for (const empty of [false, true]) {
      for (const ph of ['start', 'magout', 'magin', 'end']) {
        ev.emit('weapon:reload', { weapon: 'rifle', phase: ph, empty });
      }
    }
    // A reload with no weapon at all still has to make a sound — it falls
    // through to synthesis rather than going silent.
    ev.emit('weapon:reload', { phase: 'magin' });
    // A bot's reload carries a position, so it attenuates instead of playing dry.
    for (const d of [4, 18, 45]) {
      ev.emit('weapon:reload', { weapon: 'ai_rifle', phase: 'start', position: at(d * 0.7, -0.5, -d * 0.7) });
    }
    ev.emit('bullet:tracer', { from: at(-30, 0, -30), to: at(2, 0, 2), speed: 880 });
    // Both ends of the landing ramp: a step off a kerb and a fall that hurts.
    for (const v of [2.5, 9, 14]) ev.emit('player:land', { velocity: v, surface: 'concrete' });
    ev.emit('player:state', { stance: 'crouch', sprinting: false, sliding: false, ads: true });
    ev.emit('damage:dealt', { target: { id: 3 }, amount: 34, headshot: true, killed: false, point: at(4, 0, -9) });
    ev.emit('damage:taken', { amount: 28, from: at(4, 0, -9), health: 24 });
    ev.emit('actor:death', { actor: { id: 3 }, point: at(4, -1.2, -9), impulse: { x: 0, y: 0, z: 0 } });
    for (const k of ['spot', 'reload', 'grenade', 'flank', 'suppress', 'advance', 'hurt', 'copy']) {
      this.bark(k, at(this.rng.range(-9, 9), 0, this.rng.range(-9, 9)), { force: true, voice: this.rng.int(0, 9) });
    }
    for (const w of ONE_SHOTS) {
      this._playAt('ambient', lp.x + 20, lp.y + 2, lp.z - 20, { which: w, level: 0.6 }, 'ambience', 0.1);
    }
    this._distantVolley();
    this._distantBoom();
    this._distantChatter();
    ev.emit('explosion', { position: at(6, 0, -7), radius: 8, damage: 120 });
    return { ok: true, voices: this.field.stats.active, errors: this.stats.errors };
  }

  /** Snapshot for the dev overlay and the probe script. */
  report() {
    return {
      running: this.running,
      failed: this.failed,
      state: this.actx?.state ?? 'none',
      sampleRate: this.actx?.sampleRate ?? 0,
      voices: this.field?.stats.active ?? 0,
      dropped: this.field?.stats.dropped ?? 0,
      stolen: this.field?.stats.stolen ?? 0,
      occlusionRays: this.field?.stats.occlusionRays ?? 0,
      space: this.stats.space,
      spaceWeights: this.mixer ? { ...this.mixer.spaceWeights } : null,
      enclosure: this._space.enclosure,
      meanFree: this._space.meanFree,
      deafness: this.deafness,
      limiterReduction: this.mixer?.reduction ?? 0,
      events: this.stats.events,
      errors: this.stats.errors,
      samples: this.samples
        ? { ready: this.samples.ready, ...this.samples.stats }
        : null,
    };
  }
}
