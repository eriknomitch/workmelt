/**
 * AUDIO / SELF TEST
 *
 * Renders every voice through the real mixer graph in an OfflineAudioContext
 * and measures what came out. This is how the audio subsystem is verified:
 * screenshots prove nothing about sound, and OfflineAudioContext needs no user
 * gesture, so the whole synthesis path can be exercised headlessly.
 *
 * For each case we report:
 *   peak     absolute sample peak — >= 1.0 means the limiter failed
 *   rms      loudness; 0 means the voice is silent (a bug)
 *   dc       mean sample value; a large offset means an envelope never closed
 *   nan      any non-finite samples (bad exponentialRamp targets, /0, ...)
 *   centroid rough spectral centre of mass in Hz (via zero-crossing rate),
 *            enough to prove a "distant" shot is darker than a near one
 *
 * Usage from a page (see probe.mjs):
 *   const { runAudioSelfTest } = await import('/src/audio/selftest.js');
 *   const report = await runAudioSelfTest();
 */

import { Rng } from '../core/rng.js';
import { NoiseBank } from './dsp.js';
import { Mixer } from './mixer.js';
import { WEAPON_PROFILES, weaponShot, bulletWhizz, dryFire } from './weapons.js';
import {
  surfaceImpact, footstep, shellCasing, reloadPhase, explosion, bodyFall, uiSound,
  heartbeat, cloth,
} from './foley.js';
import { bark, BARKS } from './vox.js';
import { ambientOneShot, ONE_SHOTS } from './ambience.js';
import { IR_SPECS, generateIR, classifySpace } from './ir.js';

const SR = 48000;

function measure(buf) {
  const n = buf.length;
  let peak = 0, sum = 0, sumSq = 0, nan = 0, crossings = 0;
  let prev = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v;
      sumSq += v * v;
      if (ch === 0) {
        if ((v > 0 && prev <= 0) || (v < 0 && prev >= 0)) crossings++;
        prev = v;
      }
    }
  }
  const total = n * buf.numberOfChannels;
  const rms = Math.sqrt(sumSq / total);
  // Zero crossing rate -> a crude but stable spectral centre indicator.
  const centroid = (crossings / (n / SR)) * 0.5;
  return {
    peak: +peak.toFixed(4),
    rms: +rms.toFixed(5),
    dc: +(sum / total).toFixed(5),
    nan,
    centroid: Math.round(centroid),
  };
}

/** One offline render: build a fresh mixer, run `fn`, measure the master out. */
async function renderCase(seconds, seed, fn, opts = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const rng = new Rng(seed);
  const bank = new NoiseBank(ctx, rng.fork(), 1.2);
  const mixer = new Mixer(ctx, rng.fork(), {});
  if (opts.reverb !== false) mixer.buildReverbs();
  if (opts.space) mixer.setSpace(opts.space, 0.001);
  fn({ ctx, rng, bank, mixer, t: 0.02 });
  const buf = await ctx.startRendering();
  return measure(buf);
}

/** Connect a voice to a bus and its reverb send, the way the live system does. */
function route(mixer, voice, busName = 'weapons', sendScale = 1) {
  voice.node.connect(mixer.bus(busName));
  if ((voice.send ?? 0) > 0) {
    const g = mixer.actx.createGain();
    g.gain.value = voice.send * sendScale;
    voice.node.connect(g);
    g.connect(mixer.reverbSend);
  }
  return voice;
}

export async function runAudioSelfTest(opts = {}) {
  const results = [];
  const push = async (name, seconds, fn, o) => {
    const t0 = performance.now();
    try {
      const m = await renderCase(seconds, 0xA0D10 + results.length * 7919, fn, o);
      results.push({ name, ms: Math.round(performance.now() - t0), ...m });
    } catch (err) {
      results.push({ name, error: String(err?.message ?? err) });
    }
  };

  /* ---- impulse responses ---------------------------------------- */
  for (const key of Object.keys(IR_SPECS)) {
    const t0 = performance.now();
    try {
      const ctx = new OfflineAudioContext(2, SR * 0.05, SR);
      const buf = generateIR(ctx, new Rng(0x1234 + key.length), IR_SPECS[key]);
      const m = measure(buf);
      results.push({ name: `ir:${key}`, ms: Math.round(performance.now() - t0), seconds: +buf.duration.toFixed(2), ...m });
    } catch (err) {
      results.push({ name: `ir:${key}`, error: String(err?.message ?? err) });
    }
  }

  /* ---- weapons, near and far ------------------------------------ */
  for (const key of Object.keys(WEAPON_PROFILES)) {
    await push(`shot:${key}@2m`, 3.5, ({ bank, rng, mixer, t }) => {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES[key], { when: t, distance: 2, firstPerson: true }));
    });
  }
  await push('shot:rifle@120m', 4.5, ({ bank, rng, mixer, t }) => {
    route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, { when: t, distance: 120 }));
  });
  await push('shot:rifle@300m', 5.5, ({ bank, rng, mixer, t }) => {
    route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, { when: t, distance: 300 }));
  });

  /* round-robin variation: 8 rounds of automatic fire must not be identical */
  await push('auto:8rounds', 2.5, ({ bank, rng, mixer, t }) => {
    for (let i = 0; i < 8; i++) {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
        when: t + i * 0.085, distance: 2, firstPerson: true,
      }));
    }
  });

  /* ---- foley ----------------------------------------------------- */
  const surfaces = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'glass', 'water', 'foliage', 'fabric', 'flesh', 'rubber', 'plaster'];
  for (const s of surfaces) {
    await push(`impact:${s}`, 2.2, ({ bank, rng, mixer, t }) => {
      route(mixer, surfaceImpact(mixer.actx, bank, rng, { when: t, surface: s, energy: 1 }), 'foley');
    });
    await push(`step:${s}`, 2.2, ({ bank, rng, mixer, t }) => {
      route(mixer, footstep(mixer.actx, bank, rng, { when: t, surface: s, gait: 'run' }), 'foley');
    });
  }
  for (const gait of ['walk', 'run', 'sprint', 'crouch', 'land']) {
    await push(`step:concrete:${gait}`, 2.2, ({ bank, rng, mixer, t }) => {
      route(mixer, footstep(mixer.actx, bank, rng, { when: t, surface: 'concrete', gait }), 'foley');
    });
  }
  await push('shell:concrete', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, shellCasing(mixer.actx, bank, rng, { when: t, surface: 'concrete' }), 'foley');
  });
  await push('shell:dirt', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, shellCasing(mixer.actx, bank, rng, { when: t, surface: 'dirt' }), 'foley');
  });
  for (const phase of ['start', 'magout', 'magin', 'end']) {
    await push(`reload:${phase}`, 2.5, ({ bank, rng, mixer, t }) => {
      route(mixer, reloadPhase(mixer.actx, bank, rng, phase, { when: t }), 'foley');
    });
  }
  await push('explosion@5m', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 5, radius: 8 }));
  });
  await push('explosion@180m', 7, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 180, radius: 12 }));
  });
  await push('bodyfall', 2, ({ bank, rng, mixer, t }) => {
    route(mixer, bodyFall(mixer.actx, bank, rng, { when: t }), 'foley');
  });
  await push('cloth', 1.5, ({ bank, rng, mixer, t }) => {
    route(mixer, cloth(mixer.actx, bank, rng, { when: t }), 'foley');
  });
  await push('whizz', 1.2, ({ bank, rng, mixer, t }) => {
    route(mixer, bulletWhizz(mixer.actx, bank, rng, { when: t, miss: 1.2 }), 'foley');
  });
  await push('dryfire', 1, ({ bank, rng, mixer, t }) => {
    route(mixer, dryFire(mixer.actx, bank, rng, { when: t }), 'weapons');
  });
  await push('heartbeat', 1.5, ({ bank, rng, mixer, t }) => {
    route(mixer, heartbeat(mixer.actx, bank, rng, { when: t }), 'foley');
  });
  for (const k of [
    'hitmarker', 'headshot', 'kill', 'damage', 'lowhealth',
    'join', 'leave', 'ready', 'unready', 'countdown',
  ]) {
    await push(`ui:${k}`, 1.5, ({ bank, rng, mixer, t }) => {
      route(mixer, uiSound(mixer.actx, bank, rng, k, { when: t }), 'ui');
    }, { reverb: false });
  }
  // The deployment horn swells for ~1.1 s — rendered long enough that its tail
  // lands inside the window being measured.
  await push('ui:matchstart', 2.5, ({ bank, rng, mixer, t }) => {
    route(mixer, uiSound(mixer.actx, bank, rng, 'matchstart', { when: t }), 'ui');
  }, { reverb: false });

  /* ---- voice ----------------------------------------------------- */
  for (const key of Object.keys(BARKS)) {
    await push(`bark:${key}`, 3, ({ bank, rng, mixer, t }) => {
      route(mixer, bark(mixer.actx, bank, rng, { when: t, bark: key }), 'voice');
    });
  }
  await push('bark:radio', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, bark(mixer.actx, bank, rng, { when: t, bark: 'contact', radio: true }), 'voice');
  });

  /* ---- ambient one-shots ---------------------------------------- */
  for (const k of ONE_SHOTS) {
    await push(`ambient:${k}`, 14, ({ bank, rng, mixer, t }) => {
      route(mixer, ambientOneShot(mixer.actx, bank, rng, k, { when: t }), 'ambience');
    });
  }

  /* ---- reverb space comparison ---------------------------------- */
  for (const space of ['tight', 'street', 'open', 'tunnel']) {
    const w = { tight: 0, room: 0, street: 0, tunnel: 0, open: 0 };
    w[space] = 1;
    await push(`tail:${space}`, 5, ({ bank, rng, mixer, t }) => {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
        when: t, distance: 2, firstPerson: true, echoBoost: 2,
      }), 'weapons', 1.4);
    }, { space: w });
  }

  /* ---- limiter stress: everything at once ----------------------- */
  await push('stress:limiter', 4, ({ bank, rng, mixer, t }) => {
    for (let i = 0; i < 14; i++) {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.sniper, {
        when: t + i * 0.004, distance: 1, firstPerson: true,
      }));
    }
    for (let i = 0; i < 6; i++) {
      route(mixer, explosion(mixer.actx, bank, rng, { when: t + i * 0.01, distance: 1, radius: 14 }));
    }
  });

  /* ---- space classifier (pure function, no audio) ---------------- */
  const spaces = {};
  const box = new Array(9).fill(3.5); box[8] = 2.6;
  spaces.smallRoom = classifySpace(box, 40, null);
  const street = [4, 30, 40, 30, 4, 30, 40, 30, 40];
  spaces.street = classifySpace(street, 40, null);
  const field = new Array(9).fill(40);
  spaces.open = classifySpace(field, 40, null);
  const corridor = [1.8, 12, 38, 12, 1.8, 12, 38, 12, 2.4];
  spaces.corridor = classifySpace(corridor, 40, null);

  const failures = results.filter((r) =>
    r.error || r.nan > 0 || r.peak >= 1.0 || (r.rms ?? 0) <= 0.00002 || Math.abs(r.dc ?? 0) > 0.02
  );

  return {
    ok: failures.length === 0,
    cases: results.length,
    failures,
    results: opts.verbose === false ? undefined : results,
    spaces,
  };
}

if (typeof window !== 'undefined') window.__AUDIO_SELFTEST__ = runAudioSelfTest;
