#!/usr/bin/env node
/**
 * GAME CONFIG — the per-deploy switch file and how a run resolves it.
 *
 *   node src/core/gameConfig.selftest.mjs
 *
 * `public/game.json` is the one place a deploy turns a feature on or off
 * without a rebuild. Every failure here is silent in game: a default that
 * drifted from the shipped file means a deploy that lost its game.json sounds
 * different from one that kept it; a capture that honoured the live switches
 * means flipping one on the site moves the pixel baselines; and a gate the
 * owning subsystem forgot to read means the switch does nothing at all while
 * the file says it is off. So each of those is asserted here, the last one by
 * driving the real `Ambience` against a stub audio graph.
 */
import { readFile } from 'node:fs/promises';
import { DEFAULT_GAME_CONFIG, gameConfigForRun, loadGameConfig } from './gameConfig.js';
import { createConfig } from './config.js';
import { Rng } from './rng.js';
import { Ambience } from '../audio/ambience.js';

let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(`  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) fails++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Swap globalThis.fetch for one call of loadGameConfig. */
async function loadWith(fetchImpl) {
  const real = globalThis.fetch;
  const info = console.info;
  globalThis.fetch = fetchImpl;
  console.info = () => {}; // the "no game.json" notice is expected noise here
  try {
    return await loadGameConfig('/');
  } finally {
    globalThis.fetch = real;
    console.info = info;
  }
}
const serve = (body) => async () => ({ ok: true, status: 200, json: async () => body });

console.log('defaults');
{
  const f = DEFAULT_GAME_CONFIG.features;
  ok(f.ambienceBeds === false, 'background beds ship off');
  ok(f.ambienceEvents === false, 'background events ship off');
  const shipped = JSON.parse(await readFile(new URL('../../public/game.json', import.meta.url), 'utf8'));
  // Not just the features: a deploy that fails to fetch the file must sound
  // exactly like one that loaded it, so the whole shipped file is the default.
  ok(same(shipped, DEFAULT_GAME_CONFIG), 'public/game.json is exactly the built-in defaults');
  ok(same(createConfig().game, DEFAULT_GAME_CONFIG), 'an engine config built without boot still carries them');
}

console.log('loading');
{
  const thrown = await loadWith(async () => { throw new Error('offline'); });
  ok(thrown === DEFAULT_GAME_CONFIG, 'a failed fetch is the defaults, not an error');
  const missing = await loadWith(async () => ({ ok: false, status: 404 }));
  ok(missing === DEFAULT_GAME_CONFIG, 'a 404 is the defaults');

  const partial = await loadWith(serve({ features: { ambienceEvents: true } }));
  ok(partial.features.ambienceEvents === true, 'a switch the file sets wins');
  ok(partial.features.ambienceBeds === false, 'a switch the file omits keeps its default');
  ok(same(partial.audio, DEFAULT_GAME_CONFIG.audio), 'a section the file omits is untouched');
  ok(DEFAULT_GAME_CONFIG.features.ambienceEvents === false, 'merging never writes through to the defaults');

  const arr = await loadWith(serve({ audio: { ambience: { timers: { boom: [1, 2] } } } }));
  ok(same(arr.audio.ambience.timers.boom, [1, 2]), 'a range in the file replaces the default range');
  ok(same(arr.audio.ambience.timers.volley, DEFAULT_GAME_CONFIG.audio.ambience.timers.volley),
    'and its siblings keep theirs');
}

console.log('capture runs');
{
  const live = { ...DEFAULT_GAME_CONFIG, features: { ambienceBeds: true, ambienceEvents: true } };
  const cap = gameConfigForRun(live, { capture: true });
  ok(same(cap.features, DEFAULT_GAME_CONFIG.features), 'a capture ignores the deploy\'s switches');
  ok(cap.audio === live.audio, 'but keeps its tuning');
  ok(live.features.ambienceBeds === true, 'without touching the loaded config');
  ok(gameConfigForRun(live) === live, 'a normal run uses the deploy\'s config as loaded');
  ok(createConfig({ game: cap }).game === cap, 'and boot hands it to the engine config as given');
}

/* ------------------------------------------------------------------ */
/* the switches actually reach the ambience                            */
/* ------------------------------------------------------------------ */

/** Just enough of a Web Audio graph for Ambience to build itself on. */
function stubGraph() {
  const param = () => ({ value: 0, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (extra = {}) => ({
    connect: (n) => n, disconnect() {}, start() {}, stop() {}, ...extra,
  });
  const actx = {
    sampleRate: 48000, currentTime: 0,
    createBiquadFilter: () => node({ frequency: param(), Q: param(), gain: param() }),
    createGain: () => node({ gain: param() }),
    createOscillator: () => node({ frequency: param(), detune: param() }),
    createStereoPanner: () => node({ pan: param() }),
  };
  const counts = { sources: 0 };
  const bank = { source: () => { counts.sources++; return node({ _offset: 0 }); } };
  const mixer = { bus: () => node(), reverbSend: node() };
  return { actx, bank, mixer, counts };
}

/** Build an Ambience with the given switches and run it for ten minutes. */
function run(layers) {
  const { actx, bank, mixer, counts } = stubGraph();
  const amb = new Ambience(actx, bank, mixer, null, new Rng(7), DEFAULT_GAME_CONFIG.audio.ambience, layers);
  amb.start();
  let calls = 0;
  const api = {
    distantVolley: () => calls++, distantBoom: () => calls++,
    oneShot: () => calls++, distantChatter: () => calls++,
  };
  for (let t = 0; t < 600; t += 0.1) amb.update(0.1, api);
  amb.setEnclosure(1); // must stay safe with no beds to duck
  amb.setWind(1);
  return { sources: counts.sources, calls };
}

console.log('the ambience honours both switches');
{
  const off = run({ beds: false, events: false });
  ok(off.sources === 0, 'beds off builds no noise beds', `${off.sources} sources`);
  ok(off.calls === 0, 'events off schedules nothing in ten minutes', `${off.calls} events`);

  const beds = run({ beds: true, events: false });
  ok(beds.sources > 0, 'beds on builds them', `${beds.sources} sources`);
  ok(beds.calls === 0, 'and does not drag the events along');

  const events = run({ beds: false, events: true });
  ok(events.calls > 0, 'events on schedules them', `${events.calls} events`);
  ok(events.sources === 0, 'and does not drag the beds along');

  const g = stubGraph();
  const shipped = new Ambience(g.actx, g.bank, g.mixer, null, new Rng(1));
  ok(!shipped.beds && !shipped.events, 'an Ambience built without switches takes the shipped defaults');
}

console.log(fails ? `\n${fails} failure(s)` : '\nall game-config checks passed');
process.exit(fails ? 1 : 0);
