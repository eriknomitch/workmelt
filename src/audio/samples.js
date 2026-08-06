/**
 * SAMPLES — sampled voices, behind the same contract as the synthesized ones.
 *
 * Every voice factory in weapons.js / foley.js / vox.js returns
 * `{ node, end, send }`: a node already scheduled to sound at `when`, the
 * context time it finishes, and how much reverb it wants. This module returns
 * exactly that, built from a decoded AudioBuffer instead of an oscillator
 * stack, so AudioSystem._build() can prefer a sample and fall through to
 * synthesis without either side knowing about the other.
 *
 * Everything here degrades to "no sample" rather than throwing: a missing
 * manifest, a 404, a codec the browser will not decode, or a buffer that has
 * not finished loading all mean the procedural voice plays instead. The game
 * is never silent because an asset is late or absent.
 *
 * Assets are produced by tools/encode-sfx.mjs — mono 48 kHz Opus, trimmed to
 * the transient, peak-normalized. See public/sfx/CREDITS.md.
 */

import { gain as mkGain } from './dsp.js';

/** Parallel fetches. Enough to fill a connection, few enough to stay polite. */
const FETCH_CONCURRENCY = 8;

/**
 * Per-group playback character.
 *
 *   jitter  ± playback-rate variation, the cheapest way to stop a small pool
 *           of variants reading as a loop. Shots stay tight because a
 *           detuned gunshot sounds like a different (wrong) gun; footsteps
 *           and impacts take a lot before anyone notices.
 *   send    default reverb send when the caller does not override it, matched
 *           to what the synthesized equivalents ask for.
 */
const GROUP = {
  shot: { jitter: 0.02, send: 0.5 },
  step: { jitter: 0.09, send: 0.18 },
  impact: { jitter: 0.08, send: 0.3 },
  ui: { jitter: 0, send: 0 },
  // Announcer: one take per line, so no jitter (a detuned voice reads as a
  // different, wrong announcer) and a touch of room so it is not glued to the
  // inside of the player's head.
  vox: { jitter: 0, send: 0.1 },
  // Reload phases: one take per phase, so jitter is the only thing keeping four
  // reloads in a row from being bit-identical. It stays low — these are small
  // mechanical hits and detuning them audibly changes the size of the hardware.
  // `send` matches what foley.js reloadPhase() asks for, so swapping a sampled
  // phase for a synthesized one does not move it in the room.
  reload: { jitter: 0.03, send: 0.3 },
};

export class SampleBank {
  constructor(actx) {
    this.actx = actx;
    this.ready = false;
    this.failed = false;
    /** group -> key -> { buffers: AudioBuffer[], last: number } */
    this.sets = new Map();
    this.stats = { requested: 0, decoded: 0, failed: 0, hits: 0, misses: 0 };
    this._aborted = false;
  }

  /**
   * Fetch and decode everything in the manifest. Resolves when the bank is as
   * loaded as it is going to get; individual failures are logged once and
   * leave that key falling back to synthesis.
   *
   * Keys become playable as they decode, so an early shot can already be
   * sampled while footsteps are still in flight.
   */
  async load(baseUrl) {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    let manifest;
    try {
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      manifest = await res.json();
    } catch (err) {
      // Not an error worth shouting about: a build without encoded assets is
      // a supported configuration, it just sounds fully synthesized.
      console.info('[audio] no sample manifest — synthesized voices only');
      this.failed = true;
      return false;
    }

    const jobs = [];
    for (const [group, keys] of Object.entries(manifest)) {
      for (const [key, urls] of Object.entries(keys)) {
        if (!Array.isArray(urls) || !urls.length) continue;
        jobs.push({ group, key, urls });
      }
    }
    this.stats.requested = jobs.reduce((n, j) => n + j.urls.length, 0);

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length && !this._aborted) {
        const job = jobs[cursor++];
        const buffers = [];
        for (const url of job.urls) {
          const buf = await this._decode(`${base}${url}`);
          if (buf) buffers.push(buf);
        }
        if (buffers.length && !this._aborted) {
          let set = this.sets.get(job.group);
          if (!set) { set = new Map(); this.sets.set(job.group, set); }
          set.set(job.key, { buffers, last: -1 });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, jobs.length) }, worker)
    );

    this.ready = this.sets.size > 0;
    if (this.ready) {
      console.info(`[audio] ${this.stats.decoded}/${this.stats.requested} samples loaded`);
    }
    return this.ready;
  }

  async _decode(url) {
    if (this._aborted) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const bytes = await res.arrayBuffer();
      // decodeAudioData is the only place a bad codec surfaces, and Safari
      // rejects rather than throws — await catches both shapes.
      const buf = await this.actx.decodeAudioData(bytes);
      this.stats.decoded++;
      return buf;
    } catch (err) {
      this.stats.failed++;
      if (this.stats.failed < 4) console.warn(`[audio] sample failed: ${url}`, err?.message ?? err);
      return null;
    }
  }

  /**
   * Resolve a `_build()` call onto a sample set. Returns null whenever this
   * bank has nothing for it, which is the caller's cue to synthesize.
   */
  _lookup(kind, o) {
    let group, key;
    if (kind === 'shot') { group = 'shot'; key = o.profile?.name; }
    else if (kind === 'step') { group = 'step'; key = o.surface ?? 'concrete'; }
    else if (kind === 'impact') { group = 'impact'; key = o.surface ?? 'concrete'; }
    // 'announce' has no synthesized counterpart: it is a recorded line or it is
    // nothing, which is why AudioSystem.announce() checks has() before playing.
    else if (kind === 'announce') { group = 'vox'; key = o.line; }
    else if (kind === 'reload') return this._lookupReload(o);
    else { group = 'ui'; key = kind; }
    if (!key) return null;
    const set = this.sets.get(group)?.get(key);
    return set ? { set, group } : null;
  }

  /**
   * Reload is the one group keyed on three things at once — weapon, tac/empty
   * variant, and animation phase — so it resolves through a fallback chain
   * instead of a single key:
   *
   *   rifle_empty_magout   the specific take
   *   rifle_magout         the weapon's shared take, for the phases where a
   *                        dry reload and a tactical one sound the same
   *   null                 nothing for this weapon; foley.js synthesizes it
   *
   * That last rung is why an unrecognised weapon is not a bug. A new gun with
   * no recorded foley simply keeps the procedural voice until someone authors
   * one, and a weapon with only half its phases recorded is a valid state too.
   */
  _lookupReload(o) {
    const phase = o.phase;
    if (!phase) return null;
    // Bots carry their own ids ('ai_rifle'); the hardware is the same hardware.
    const weapon = String(o.weapon ?? '').toLowerCase().replace(/^ai_/, '');
    if (!weapon) return null;
    const set = this.sets.get('reload');
    if (!set) return null;
    const variant = o.empty ? 'empty' : 'tac';
    const found = set.get(`${weapon}_${variant}_${phase}`) ?? set.get(`${weapon}_${phase}`);
    return found ? { set: found, group: 'reload' } : null;
  }

  /** Is there a decoded sample for this group/key yet? */
  has(group, key) {
    return !!this.sets.get(group)?.get(key);
  }

  /** Length of the first variant, in seconds; 0 when there is no sample. */
  duration(group, key) {
    return this.sets.get(group)?.get(key)?.buffers[0]?.duration ?? 0;
  }

  /**
   * Build a sampled voice, or null to fall back.
   *
   * `rng` is the AudioSystem's seeded stream — never Math.random(), so a
   * captured run stays reproducible.
   */
  voice(kind, when, dist, o, rng) {
    if (!this.ready) return null;
    const found = this._lookup(kind, o);
    if (!found) { this.stats.misses++; return null; }
    const { set, group } = found;

    try {
      const { actx } = this;
      const cfg = GROUP[group];

      // Pick a variant, avoiding an immediate repeat — back-to-back identical
      // footsteps are the single most obvious sampled-audio tell.
      const n = set.buffers.length;
      let i = n === 1 ? 0 : (rng.u32() % n);
      if (n > 1 && i === set.last) i = (i + 1) % n;
      set.last = i;
      const buffer = set.buffers[i];

      const src = actx.createBufferSource();
      src.buffer = buffer;
      const rate = cfg.jitter ? 1 + (rng.float() * 2 - 1) * cfg.jitter : 1;
      src.playbackRate.value = rate;

      // `level` is what foley voices call it, `energy` what impacts use, and
      // both are optional — match the synthesized voices' conventions so
      // callers never have to special-case a sampled kind.
      const level = (o.level ?? 1) * (o.energy ?? 1);
      const g = mkGain(actx, level);
      src.connect(g);
      src.start(when);

      // `send` is the voice's own appetite for reverb, exactly as the
      // synthesized factories report it. Deliberately not `o.send ?? cfg.send`:
      // _playDry multiplies the caller's send by this one, so honouring o.send
      // here would square it.
      const dur = buffer.duration / rate;
      this.stats.hits++;
      return { node: g, end: when + dur + 0.05, send: cfg.send };
    } catch (err) {
      this.stats.failed++;
      return null;
    }
  }

  dispose() {
    this._aborted = true;
    this.sets.clear();
    this.ready = false;
  }
}
