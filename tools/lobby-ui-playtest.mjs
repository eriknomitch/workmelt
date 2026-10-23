#!/usr/bin/env node
/**
 * Playtest for the lobby SURFACE — the DOM, not the flow.
 *
 * `tools/lobby-playtest.mjs` proves the join flow with two full engine boots,
 * which on a software rasteriser costs minutes each. Until `?renderGame=false`
 * existed there was no cheap check of the screen itself, so a broken map card or
 * a wrong primary label in solo mode had no test short of those boots. This one
 * loads the lobby UI-only (src/dev/uionly.js) —
 * seconds, even on SwiftShader, because no engine is fetched at all — and
 * checks everything about the surface that does not need a game behind it:
 *
 *   • UI-only mode holds its contract: no engine, and /src/boot.js is never
 *     even requested;
 *   • every enabled map in the registry gets a selector card, and clicking one
 *     repaints the selection and persists the preference (the solo path);
 *   • every garrison chip repaints the primary CTA with its real bot count;
 *   • the lobby ships one visual treatment and one layout — the brand system —
 *     with no style selector, no variant class and no layout picker anywhere;
 *   • the callsign: a random draw wears the Random flag and takes the first
 *     focus, the first press asks for a name instead of deploying, the second
 *     keeps (and saves) the draw, and typing a name + Enter deploys with it;
 *   • Enter reaches the (inert) primary and C flashes the copy button;
 *   • `?mp=0` collapses the room panel and the callsign field.
 *
 *   node tools/lobby-ui-playtest.mjs [screenshot.png]
 *
 * Expectations are imported from the same modules the page renders from
 * (`mapSummaries`, `BOT_PRESETS`), so a new map or garrison preset is covered
 * the day it lands rather than the day somebody edits this file.
 */

import { chromium } from 'playwright';
import { ensureServer } from './lib/harness.mjs';
import { launchOpts } from './lib/chromium.mjs';
import { mapSummaries } from '../src/world/maps.js';
import { BOT_PRESETS } from '../src/match/ui.js';

const PORT = Number(process.env.LOBBY_UI_PLAYTEST_PORT ?? process.env.OW_PORT ?? 5185);
const SHOT = process.argv[2] ?? null;
const url = (q) => `http://127.0.0.1:${PORT}/?renderGame=false${q}`;

const vite = await ensureServer(PORT);

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
}));

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !extra ? '' : ` — got ${extra}`}`);
const eq = (name, actual, expected) =>
  check(name, actual === expected, `${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

/** Open a lobby-only page and wait for the paint, tracking what was fetched. */
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const fetched = [];
  page.on('request', (r) => fetched.push(r.url()));
  // How many times the inert primary fired — i.e. how many presses got through.
  const plays = { n: 0 };
  page.on('console', (m) => {
    if (m.text().includes('[uionly] play ignored')) plays.n++;
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url(query), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  return { page, fetched, plays };
}

try {
  const maps = mapSummaries();

  /* ---- the default view ------------------------------------------------- */
  const { page, fetched, plays } = await open('');

  eq('no engine boots', await page.evaluate('!!window.__ENGINE__'), false);
  eq('the UI-only view is exposed', await page.evaluate('!!window.__UIONLY__'), true);
  check(
    'the game boot is never even requested',
    !fetched.some((u) => u.includes('/src/boot.js')),
    'boot.js was fetched'
  );
  eq('the lobby is visible', await page.evaluate(
    () => !!document.querySelector('.wm-lobby:not(.hidden)')
  ), true);
  eq('the room panel shows by default', await page.evaluate(
    () => !!document.querySelector('[data-room-panel]')
  ), true);

  /* ---- map cards: one per enabled map, click selects and persists ------- */
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mapcards] .mapcard .nm')].map((n) => n.textContent)
  );
  eq('one card per enabled map', cards.length, maps.length);
  for (const m of maps)
    check(`the ${m.id} card carries its menu name`, cards.includes(m.name), JSON.stringify(cards));

  const target = maps[maps.length - 1];
  await page.evaluate((id) => {
    for (const [mid, btn] of window.__UIONLY__.mapBtns) if (mid === id) btn.click();
  }, target.id);
  eq('clicking a card selects it', await page.evaluate('window.__UIONLY__.mapId'), target.id);
  eq(
    'and persists the choice for the next real boot',
    await page.evaluate(() => localStorage.getItem('workmelt.map')),
    target.id
  );

  /* ---- garrison chips: every preset repaints the CTA -------------------- */
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('[data-bots] .chip')].map((c) => c.textContent)
  );
  eq('one chip per garrison preset', chips.length, BOT_PRESETS.length);
  // Players-first: the lobby opens with no garrison, and the CTA says so.
  eq('the lobby opens with no bots selected', await page.evaluate(
    () => [...document.querySelectorAll('[data-bots] .chip')].find((c) => c.getAttribute('aria-pressed') === 'true')?.textContent
  ), BOT_PRESETS.find((p) => p.key === 'off').label);
  eq('so the CTA is a plain Play', await page.evaluate(() => document.querySelector('[data-primary]').textContent), 'Play');
  for (const p of BOT_PRESETS) {
    await page.evaluate((label) => {
      [...document.querySelectorAll('[data-bots] .chip')].find((c) => c.textContent === label)?.click();
    }, p.label);
    const want = p.squads ? `Play vs ${p.squads * p.perSquad} bots` : 'Play';
    eq(
      `the ${p.key} chip paints the CTA`,
      await page.evaluate(() => document.querySelector('[data-primary]').textContent),
      want
    );
  }

  /* ---- one style, and no way to leave it -------------------------------- */
  eq('no style selector is rendered', await page.evaluate(
    () => document.querySelectorAll('.wm-lobby .style-picker, .wm-lobby [data-style]').length
  ), 0);
  // The lab treatments are gone from the stylesheet, so a stale class would
  // only strip the brand rather than swap it. Nothing may put one back.
  eq('the lobby wears the brand system alone', await page.evaluate(
    () => /variant-/.test(document.querySelector('.wm-lobby').className)
  ), false);
  // The map-layout explorations are retired with the Console Black redesign:
  // the selector rail is the one layout, and nothing may put a picker back.
  eq('no layout picker is rendered', await page.evaluate(
    () => !!document.querySelector('[data-layout-picker]')
  ), false);

  /* ---- the callsign: optional, but asked for once ----------------------- */
  // A fresh browser profile has no saved name, so this is the random draw.
  const ident = () => page.evaluate(() => ({
    unset: document.querySelector('[data-ident]').classList.contains('unset'),
    flag: getComputedStyle(document.querySelector('[data-ident-flag]')).display !== 'none',
    note: !document.querySelector('[data-ident-note]').classList.contains('hide'),
    focused: document.activeElement?.id === 'wm-callsign',
    value: document.querySelector('[data-name]').value,
    saved: localStorage.getItem('cod_name'),
  }));
  let id = await ident();
  eq('a random callsign wears the Random flag', id.unset && id.flag, true);
  check('and the field holds the draw', /^[A-Za-z]+-\d{2}$/.test(id.value), JSON.stringify(id.value));
  eq('the draw is not saved until somebody keeps it', id.saved, null);
  eq('the lobby opens with focus on the callsign field', id.focused, true);
  const draw = id.value;

  await page.click('[data-primary]');
  await page.waitForTimeout(150);
  id = await ident();
  eq('the first press asks instead of deploying', plays.n, 0);
  eq('it says what happens next', id.note, true);
  eq('and hands the field the focus', id.focused, true);

  await page.click('[data-primary]');
  await page.waitForTimeout(150);
  id = await ident();
  eq('the second press deploys', plays.n, 1);
  eq('keeping the draw saves it', id.saved, draw);
  eq('and the flag and the prompt go away', id.unset || id.note, false);

  /* ---- keyboard: Enter is the primary, C is copy ------------------------- */
  await page.evaluate(() => document.querySelector('.wm-lobby').focus?.());
  const inertLogged = new Promise((res) => {
    page.on('console', (m) => {
      if (m.text().includes('[uionly] play ignored')) res(true);
    });
    setTimeout(() => res(false), 5000);
  });
  await page.focus('[data-primary]');
  await page.keyboard.press('Enter');
  check('Enter fires the primary (inert in UI-only)', await inertLogged);
  await page.keyboard.press('c');
  eq(
    'C flashes the copy confirmation',
    await page.evaluate(() => document.querySelector('[data-copy]').textContent),
    'Link copied'
  );

  if (SHOT) await page.screenshot({ path: SHOT, type: 'png' });
  await page.close();

  /* ---- type a name, press Enter, deploy --------------------------------- */
  const typed = await open('');
  await typed.page.waitForFunction(() => document.activeElement?.id === 'wm-callsign');
  await typed.page.keyboard.type('Mantis'); // the draw is selected, so this replaces it
  await typed.page.keyboard.press('Enter');
  await typed.page.waitForTimeout(150);
  eq('Enter in the callsign field deploys in one go', typed.plays.n, 1);
  eq('with the typed name saved', await typed.page.evaluate(() => localStorage.getItem('cod_name')), 'Mantis');
  eq('and no Random flag', await typed.page.evaluate(
    () => document.querySelector('[data-ident]').classList.contains('unset')
  ), false);
  await typed.page.close();

  /* ---- a name from the link is a chosen name ---------------------------- */
  const named = await open('&name=Rook');
  await named.page.waitForTimeout(150);
  eq('?name= skips the flag', await named.page.evaluate(
    () => document.querySelector('[data-ident]').classList.contains('unset')
  ), false);
  eq('and the focus goes to the primary', await named.page.evaluate(
    () => document.activeElement?.hasAttribute('data-primary') ?? false
  ), true);
  await named.page.click('[data-primary]');
  await named.page.waitForTimeout(150);
  eq('and the first press deploys', named.plays.n, 1);
  await named.page.close();

  /* ---- ?mp=0 collapses the room panel ------------------------------------ */
  const solo = await open('&mp=0');
  eq('?mp=0 removes the room panel', await solo.page.evaluate(
    () => !!document.querySelector('[data-room-panel]')
  ), false);
  eq('the garrison chips survive ?mp=0', await solo.page.evaluate(
    () => document.querySelectorAll('[data-bots] .chip').length > 0
  ), true);
  eq('?mp=0 removes the callsign field — nobody sees it', await solo.page.evaluate(
    () => !!document.querySelector('[data-ident]')
  ), false);
  await solo.page.close();
} finally {
  console.log(results.join('\n'));
  await browser.close();
  vite?.kill();
}

const failed = results.filter((r) => r.startsWith('  FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
