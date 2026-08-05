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
 *   • every enabled map in the registry gets a card, and clicking one repaints
 *     the selection and persists the preference (the solo path);
 *   • every garrison chip repaints the primary CTA with its real bot count;
 *   • the lobby ships one visual treatment — the brand system — with no
 *     selector and no variant class on the root;
 *   • the `?debug=true` layout picker exists exactly when asked for;
 *   • Enter reaches the (inert) primary and C flashes the copy button;
 *   • `?mp=0` collapses the room panel.
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
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url(query), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  return { page, fetched };
}

try {
  const maps = mapSummaries();

  /* ---- the default view, with the debug layout picker ------------------- */
  const { page, fetched } = await open('&debug=true');

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

  /* ---- debug layout picker ---------------------------------------------- */
  eq('?debug=true shows the layout picker', await page.evaluate(
    () => !!document.querySelector('[data-layout-picker]')
  ), true);

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

  /* ---- ?mp=0 collapses the room panel; no picker without ?debug ---------- */
  const solo = await open('&mp=0');
  eq('?mp=0 removes the room panel', await solo.page.evaluate(
    () => !!document.querySelector('[data-room-panel]')
  ), false);
  eq('no layout picker without ?debug=true', await solo.page.evaluate(
    () => !!document.querySelector('[data-layout-picker]')
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
