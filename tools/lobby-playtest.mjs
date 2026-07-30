#!/usr/bin/env node
/**
 * Playtest for the join flow — two real browsers, one real relay.
 *
 *   node tools/lobby-playtest.mjs [screenshot.png]
 *
 * `server/lobby.selftest.mjs` proves the relay's rules on a socket. This one
 * proves the part the relay cannot: that the two clients actually do the right
 * thing with those rules, which is where the reported bug lived.
 *
 * The scenario is the message that started it:
 *
 *   "Hey guys, up for a game? <link>"     A opens the game and, while waiting,
 *                                         presses the lobby's own primary button
 *   "Sure"                          <B joins on the link>
 *                                         B must get the READY flow — not
 *                                         "match in progress" — and readying up
 *                                         must pull A out of the bots and start
 *                                         one match for both of them.
 *
 * Before the warm-up split, step two offered B "Deploy now" into a match only A
 * could see the bots in, froze the map for the room, and left "everybody leave
 * and then all ready up" as the only way to a shared start.
 *
 * It also checks the ammunition reset end to end: A empties a magazine during
 * the warm-up and must deploy into the match with a full one.
 *
 * Boot is slow on a software rasteriser (minutes, not seconds) and this boots
 * twice; the waits are sized for that.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { ROOT, browserArgs, ensureServer, resolveChromium, resolveGpuMode } from './lib/harness.mjs';

const PORT = Number(process.env.OW_PORT ?? 5191);
const RELAY = Number(process.env.OW_RELAY_PORT ?? 8791);
const ROOM = 'playtest';
const SHOT = process.argv[2] ?? null;
const url = (name) =>
  `http://127.0.0.1:${PORT}/?room=${ROOM}&name=${name}&server=ws://127.0.0.1:${RELAY}/ws&q=performance`;

const vite = await ensureServer(PORT);
// A short countdown: this harness cares that the countdown happens and who it
// takes with it, not that it lasts three seconds.
const relay = spawn(process.execPath, ['server/index.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(RELAY), COUNTDOWN_MS: '900' },
  stdio: 'ignore',
});

// `resolveChromium` is why this runs in a sandbox that pre-installs one chromium
// build and pins another — see the note on it in tools/lib/harness.mjs.
const executablePath = resolveChromium();
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: browserArgs(resolveGpuMode()),
});

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !extra ? '' : ` — got ${extra}`}`);
const eq = (name, actual, expected) =>
  check(name, actual === expected, `${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

/** A fresh context per player: the callsign is remembered per browser profile. */
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${name}]`, e.message));
  // `domcontentloaded`, like every other harness here: `load` also waits on the
  // brand webfont, which is deliberately non-blocking. `__READY__` is the gate.
  //
  // The long timeout is not paranoia: by the time the second player loads, the
  // first one is rendering a live match on a software rasteriser in the same
  // container, and even serving the document has to queue behind that.
  await page.goto(url(name), { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 600000 });
  await page.waitForFunction('window.__NET__?.connected === true', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  return page;
}

/** Press a lobby control. See the note at the first call site. */
const press = (page, sel) => page.$eval(`.wm-lobby ${sel}`, (el) => el.click());

/** The lobby model as the two systems see it, in one round trip. */
const snapshot = (page) =>
  page.evaluate(() => {
    const m = window.__MATCH__;
    const n = window.__NET__;
    return {
      state: m.state,
      mode: m.mode,
      uiMode: m.ui.mode,
      altMode: m.ui.altMode,
      primary: document.querySelector('.wm-lobby [data-primary]')?.textContent ?? '',
      alt: document.querySelector('.wm-lobby [data-alt]')?.textContent ?? '',
      altHidden: !!document.querySelector('.wm-lobby [data-alt]')?.classList.contains('hide'),
      roster: [...document.querySelectorAll('.wm-lobby .row')].map((r) => r.className + '|' + r.textContent),
      mapsLocked: [...document.querySelectorAll('.wm-lobby .mapcard')].every((b) => b.disabled),
      live: n.lobby.live,
      warm: n._warm,
      deployed: n._deployed,
      players: n.lobby.players.map((p) => `${p.name}:${p.warm ? 'warm' : p.deployed ? 'match' : p.ready ? 'ready' : '-'}`),
      bots: window.__ENGINE__.ctx.get('ai').stats.alive,
      ammo: window.__ENGINE__.ctx.get('weapons').ammo,
    };
  });

try {
  /* ── "Hey guys, up for a game?" ─────────────────────────────────────────── */
  const a = await player('Alpha');
  let sa = await snapshot(a);
  eq('A opens on the lobby', sa.state, 'setup');
  eq('alone in the room, the primary is the bots match', sa.uiMode, 'solo');
  check('labelled with the garrison size', /Play vs \d+ bots/.test(sa.primary), sa.primary);

  // A presses it rather than sitting on an empty screen — the whole reason the
  // bug was easy to hit.
  // `page.click` hangs here: the handler asks for pointer lock and playwright sits
  // waiting on a navigation that never comes. A dispatched click is the same code
  // path for everything this harness is testing.
  await press(a, '[data-primary]');
  await a.waitForTimeout(2500);
  sa = await snapshot(a);
  eq('pressing it deploys A', sa.state, 'live');
  eq('as a warm-up, not the room’s match', sa.mode, 'bots');
  eq('and the relay is told so', sa.warm, true);
  check('with a garrison to shoot', sa.bots > 0, String(sa.bots));

  // Burn a magazine so the deploy into the real match has something to restore.
  await a.evaluate(() => {
    const w = window.__ENGINE__.ctx.get('weapons');
    const s = w.states.get(w.activeId);
    s.mag = 1;
    s.chambered = false;
    s.reserve = 3;
  });

  /* ── "Sure" ─────────────────────────────────────────────────────────────── */
  const b = await player('Bravo');
  let sb = await snapshot(b);
  eq('B follows the link into the lobby', sb.state, 'setup');
  eq('and the room does NOT read as a match in progress', sb.live, false);
  eq('so B is offered the ready flow, not "deploy now"', sb.uiMode, 'ready');
  check(
    'with A shown as warming up rather than in a match',
    sb.players.includes('Alpha:warm'),
    JSON.stringify(sb.players)
  );
  check(
    'the roster row says so in as many words',
    sb.roster.some((r) => r.includes('warm') && /Warming up/.test(r)),
    JSON.stringify(sb.roster)
  );
  eq('the map is still the room’s to choose', sb.mapsLocked, false);
  check('and the link under the primary offers a warm-up too', !sb.altHidden && /Warm up/.test(sb.alt), sb.alt);

  /* ── B readies up: one match, both players ──────────────────────────────── */
  await press(b, '[data-primary]');
  await b.waitForTimeout(600);
  sb = await snapshot(b);
  check('B readying up starts a countdown on its own', sb.state === 'countdown', sb.state);
  sa = await snapshot(a);
  check('and pulls A out of the bots into the same one', sa.state === 'countdown', `${sa.state}/${sa.mode}`);

  await a.waitForTimeout(2500);
  await b.waitForTimeout(500);
  sa = await snapshot(a);
  sb = await snapshot(b);
  eq('A lands in the room’s match', sa.state, 'live');
  eq('by the versus path', sa.mode, 'versus');
  eq('B lands in it too', sb.state, 'live');
  eq('with no bots on either side — players only', sa.bots + sb.bots, 0);
  eq('and the relay now calls the room live', sa.live, true);
  eq('A is no longer flagged as warming up', sa.warm, false);

  // The ammunition reset, end to end: A deployed with 1 round and a 3-round
  // reserve and must be holding a full loadout.
  check(
    'a new match hands A a fresh magazine',
    sa.ammo.mag === sa.ammo.magSize + 1 && sa.ammo.reserve > 3,
    `${sa.ammo.mag}/${sa.ammo.magSize} + ${sa.ammo.reserve}`
  );

  // They can see each other, which the warm-up deliberately prevented.
  const peers = await a.evaluate(() => window.__NET__.peers.size);
  check('and they can finally see each other', peers === 1, `${peers} peer(s)`);

  if (SHOT) {
    await b.screenshot({ path: SHOT });
    console.log(`screenshot -> ${SHOT}`);
  }
} finally {
  console.log(results.join('\n'));
  await browser.close();
  relay.kill('SIGKILL');
  vite?.kill('SIGKILL');
}

const failed = results.filter((r) => r.startsWith('  FAIL')).length;
console.log(failed ? `\n${failed} failure(s)` : '\njoin flow ok');
process.exit(failed ? 1 : 0);
