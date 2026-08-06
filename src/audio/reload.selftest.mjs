#!/usr/bin/env node
/**
 * RELOAD FOLEY — the sample lookup behind `weapon:reload`.
 *
 * Reload is the only sample group keyed on three things at once (weapon,
 * tac/empty variant, animation phase), so it is the only one that resolves
 * through a fallback chain rather than a single key. Every rung of that chain
 * fails *silently* — a miss is not an error, it is the cue to synthesize — so
 * a typo in a filename, a weapon added to defs.js with no foley, or a variant
 * key that never matches all present as "the reload sounds slightly cheaper
 * than it used to" and nothing else. That is not something a capture can show
 * and not something anyone will report, which is why it is asserted here.
 *
 * Everything below is pure: SampleBank._lookupReload() reads `this.sets` and
 * nothing else, so the bank is built with a null AudioContext and hand-loaded
 * sets. No browser, no WebAudio, no decode.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SampleBank } from './samples.js';
import { WEAPON_DEFS } from '../weapons/defs.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'sfx', 'manifest.json'), 'utf8'));

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/** A bank whose 'reload' group holds exactly `keys`, and nothing else. */
function bankWith(keys) {
  const bank = new SampleBank(null);
  bank.sets.set('reload', new Map(keys.map((k) => [k, { buffers: ['<buf>'], last: -1 }])));
  bank.ready = true;
  return bank;
}

const hit = (bank, o) => bank._lookupReload(o);

/* ── the fallback chain ──────────────────────────────────────────────────── */
console.log('\n=== the variant-specific take wins when it exists ===');
{
  const bank = bankWith(['rifle_magout', 'rifle_empty_magout', 'rifle_tac_magout']);
  const empty = hit(bank, { weapon: 'rifle', phase: 'magout', empty: true });
  const tac = hit(bank, { weapon: 'rifle', phase: 'magout', empty: false });
  check('empty and tac resolve at all', !!empty && !!tac);
  check('...and they are different takes', empty?.set !== tac?.set,
    'a dry reload and a tactical one resolved to the same sample');
  check('group is reload', empty?.group === 'reload');
}

console.log('\n=== a phase with no variant take falls back to the shared one ===');
{
  // `start` and `magin` are authored once: pressing the catch and seating a
  // fresh magazine sound the same whether or not the gun ran dry.
  const bank = bankWith(['rifle_start']);
  const a = hit(bank, { weapon: 'rifle', phase: 'start', empty: true });
  const b = hit(bank, { weapon: 'rifle', phase: 'start', empty: false });
  check('empty falls back to the shared take', !!a);
  check('tac falls back to the shared take', !!b);
  check('...to the same one', a?.set === b?.set);
}

console.log('\n=== a miss is a fallback to synthesis, never a throw ===');
{
  const bank = bankWith(['rifle_start']);
  check('unknown weapon misses', hit(bank, { weapon: 'railgun', phase: 'start' }) === null);
  check('unknown phase misses', hit(bank, { weapon: 'rifle', phase: 'chamber' }) === null);
  check('absent phase misses', hit(bank, { weapon: 'rifle' }) === null);
  check('absent weapon misses', hit(bank, { phase: 'start' }) === null);
  check('empty bank misses', bankWith([])._lookupReload({ weapon: 'rifle', phase: 'start' }) === null);
}

console.log('\n=== a bot reloads the same hardware a player does ===');
{
  // ai/index.js emits `weapon: 'ai_rifle'`. The prefix names the actor, not the
  // gun, so it must not cost the bot its foley.
  const bank = bankWith(['rifle_start']);
  check("'ai_rifle' resolves to the rifle", !!hit(bank, { weapon: 'ai_rifle', phase: 'start' }));
  check('case is not load-bearing', !!hit(bank, { weapon: 'AI_Rifle', phase: 'start' }));
}

/* ── the shipped assets actually cover the shipped guns ──────────────────── */
console.log('\n=== every weapon in defs.js has every phase, both variants ===');
{
  const keys = Object.keys(manifest.reload ?? {});
  check('the manifest has a reload group', keys.length > 0,
    'run `node tools/encode-sfx.mjs reload`');
  const bank = bankWith(keys);
  for (const id of Object.keys(WEAPON_DEFS)) {
    for (const phase of ['start', 'magout', 'magin', 'end']) {
      for (const empty of [false, true]) {
        const got = hit(bank, { weapon: id, phase, empty });
        check(`${id} ${empty ? 'empty' : 'tac  '} ${phase}`, !!got,
          'no sample resolves — this phase would fall back to synthesis');
      }
    }
  }
}

console.log('\n=== every authored file is reachable ===');
{
  // The mirror of the check above: a key nothing can ever ask for is dead
  // weight in the bundle and, more likely, a typo in sfx-sources.mjs.
  const bank = bankWith(Object.keys(manifest.reload ?? {}));
  const reachable = new Set();
  for (const id of Object.keys(WEAPON_DEFS)) {
    for (const phase of ['start', 'magout', 'magin', 'end']) {
      for (const empty of [false, true]) {
        const got = hit(bank, { weapon: id, phase, empty });
        if (got) reachable.add(got.set);
      }
    }
  }
  const sets = bank.sets.get('reload');
  for (const [key, set] of sets) {
    check(`${key} is reachable`, reachable.has(set),
      'no weapon/phase/variant combination resolves to it');
  }
}

/* ── the two paths have to be interchangeable ────────────────────────────── */
console.log('\n=== the sampled voice sits where the synthesized one sits ===');
{
  // samples.js hands back GROUP.reload.send; foley.js reloadPhase() hands back
  // its own. If they disagree, a reload audibly moves in the room on the frame
  // the bank finishes decoding — which is a real, shipped-once bug, not theory.
  const src = readFileSync(join(ROOT, 'src', 'audio', 'samples.js'), 'utf8');
  const foley = readFileSync(join(ROOT, 'src', 'audio', 'foley.js'), 'utf8');
  const sampled = /reload:\s*\{[^}]*send:\s*([\d.]+)/.exec(src)?.[1];
  // The last `return { ... send: N }` inside reloadPhase().
  const body = foley.slice(foley.indexOf('export function reloadPhase'));
  const synth = /return \{[^}]*send:\s*([\d.]+)/.exec(body)?.[1];
  check('both sends were found', !!sampled && !!synth, `sampled=${sampled} synth=${synth}`);
  check('sampled send matches synthesized', sampled === synth,
    `samples.js says ${sampled}, foley.js reloadPhase() says ${synth}`);
}

/* ── the event payload survives the trip to the lookup ───────────────────── */
console.log('\n=== _onReload forwards what the lookup keys on ===');
{
  // reloadPhase() synthesizes from `phase` and `heavy` alone, so `weapon` and
  // `empty` can be dropped on the floor here and every synthesized reload still
  // sounds exactly right. The only symptom is that the samples never play. That
  // is a silent failure with no visible and no audible tell against a baseline
  // nobody has heard yet, which is the whole reason for this block.
  const { AudioSystem } = await import('./index.js');
  const a = new AudioSystem();
  a.running = true;
  a.calls = [];
  a.field = { listenerPos: { x: 0, y: 1.6, z: 0 }, distanceTo: () => 10 };
  a.ctx = { peek: () => null };
  a._playAt = (kind, x, y, z, o = {}) => { a.calls.push({ path: 'spatial', kind, o }); return true; };
  a._playDry = (kind, o = {}) => { a.calls.push({ path: 'dry', kind, o }); return true; };

  a.calls.length = 0;
  a._onReload({ weapon: 'sniper', phase: 'magout', empty: true });
  const o = a.calls[0]?.o;
  check('weapon reaches the voice', o?.weapon === 'sniper', `got ${JSON.stringify(o?.weapon)}`);
  check('empty reaches the voice', o?.empty === true, `got ${JSON.stringify(o?.empty)}`);
  check('phase still reaches it', o?.phase === 'magout', `got ${JSON.stringify(o?.phase)}`);

  a.calls.length = 0;
  a._onReload({ weapon: 'rifle', phase: 'magout' });
  check('absent empty is false, not undefined', a.calls[0]?.o?.empty === false,
    `got ${JSON.stringify(a.calls[0]?.o?.empty)} — the lookup would key on 'undefined'`);

  // The pair above has to actually select different samples end to end.
  const bank = bankWith(Object.keys(manifest.reload ?? {}));
  const pick = (p) => { a.calls.length = 0; a._onReload(p); return bank._lookupReload(a.calls[0].o); };
  const dry = pick({ weapon: 'rifle', phase: 'magout', empty: true });
  const tac = pick({ weapon: 'rifle', phase: 'magout', empty: false });
  check('the two variants resolve differently through the real payload',
    !!dry && !!tac && dry.set !== tac.set,
    'a dry magazine drop and a retained partial resolved to the same take');
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall reload foley checks passed\n');
process.exit(failures ? 1 : 0);
