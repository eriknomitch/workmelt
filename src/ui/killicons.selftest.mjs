#!/usr/bin/env node
/**
 * KILLFEED ICONS — every weapon the game can kill with draws its own icon.
 *
 * `killIcon()` falls back to the rifle for an id it does not know, which is the
 * right thing at runtime (a row with SOME gun beats a row with a hole in it)
 * and exactly why a miss here is silent: a gun added to defs.js, a bot variant
 * handed a new rifle, or a typo in an emitter's `weapon: '...'` just shows an
 * M4 in the feed. Nobody files that. So the mapping is asserted here instead,
 * including a sweep of every `weapon: '<id>'` literal emitted under src/.
 *
 * The geometry checks are cheap sanity on hand-written path data: a part with a
 * transposed coordinate lands outside the viewBox and gets clipped off, which a
 * capture shows as a gun with no barrel and no error anywhere.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KILL_ICONS, WEAPON_ICON, FALLBACK_ICON, killIcon } from './killicons.js';
import { WEAPON_DEFS } from '../weapons/defs.js';
import { THROWABLE_DEFS } from '../weapons/throwables.js';
import { VARIANTS } from '../ai/soldier.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('killicons: mapping');
for (const id of Object.keys(WEAPON_DEFS)) {
  check(`gun '${id}' has its own icon`, id in WEAPON_ICON, 'add it to WEAPON_ICON');
}
for (const [id, def] of Object.entries(THROWABLE_DEFS)) {
  if (!(def.damage > 0)) continue; // a stun cannot kill, so it never reaches the feed
  check(`throwable '${id}' has its own icon`, id in WEAPON_ICON);
}
for (const [name, v] of Object.entries(VARIANTS)) {
  check(`bot variant '${name}' gun '${v.weapon}' has its own icon`, v.weapon in WEAPON_ICON);
}
for (const id of ['melee', 'mortar', 'ai_rifle']) {
  check(`'${id}' has its own icon`, id in WEAPON_ICON);
}
for (const [id, key] of Object.entries(WEAPON_ICON)) {
  check(`'${id}' -> '${key}' is a drawn icon`, key in KILL_ICONS);
}
check('fallback is a drawn icon', FALLBACK_ICON in KILL_ICONS);

// Every literal weapon id an emitter writes must resolve. Only event payload
// shapes are swept (`weapon: '<id>'`); the audio probe's synthetic fire events
// name guns that exist only as sound fixtures, so it is skipped.
function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.m?js$/.test(f) && !/selftest|probe/.test(f)) yield p;
  }
}
const literals = new Set();
for (const file of walk(SRC)) {
  if (file.endsWith(join('audio', 'index.js'))) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(/weapon: '([a-z0-9_]+)'/g)) literals.add(m[1]);
}
check('the sweep found emitted weapon ids', literals.size >= 5, `${literals.size}`);
for (const id of literals) check(`emitted id '${id}' has its own icon`, id in WEAPON_ICON);

console.log('killicons: selection');
check('headshot replaces the weapon', killIcon('sniper', true) === 'headshot');
check('no attacker draws the skull', killIcon('frag', false, false) === 'skull');
check('a def object resolves by id', killIcon(WEAPON_DEFS.g31) === 'pistol');
check('melee is the knife', killIcon('melee') === 'knife');
check('an unknown id falls back', killIcon('railgun') === FALLBACK_ICON);
check('a missing id falls back', killIcon(null) === FALLBACK_ICON);

console.log('killicons: geometry');
for (const [key, ic] of Object.entries(KILL_ICONS)) {
  const [x0, y0, w, h] = ic.vb;
  check(`'${key}' viewBox is sane`, ic.vb.length === 4 && w > 0 && h > 0 && ic.h > 0);
  check(`'${key}' path uses only M L H V C a Z`, /^[MLHVCaZ0-9.\s-]+$/.test(ic.d));
  // Absolute coordinates must sit inside the viewBox (half a unit of slack for
  // the outline the drop shadow adds). Relative arcs are bounded by their M.
  const out = [];
  const tokens = ic.d.match(/[A-Za-z]|-?\d*\.?\d+/g);
  let cmd = '';
  let args = [];
  const flush = () => {
    const inX = (x) => x >= x0 - 0.5 && x <= x0 + w + 0.5;
    const inY = (y) => y >= y0 - 0.5 && y <= y0 + h + 0.5;
    if (cmd === 'M' || cmd === 'L' || cmd === 'C') {
      for (let i = 0; i + 1 < args.length; i += 2) if (!inX(args[i]) || !inY(args[i + 1])) out.push(`${cmd}${args[i]},${args[i + 1]}`);
    } else if (cmd === 'H') {
      for (const x of args) if (!inX(x)) out.push(`H${x}`);
    } else if (cmd === 'V') {
      for (const y of args) if (!inY(y)) out.push(`V${y}`);
    }
    args = [];
  };
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) { flush(); cmd = t; } else args.push(Number(t));
  }
  flush();
  check(`'${key}' stays inside its viewBox`, out.length === 0, out.slice(0, 4).join(' '));
}

if (failures) {
  console.log(`\nkillicons: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nkillicons: all checks passed');
