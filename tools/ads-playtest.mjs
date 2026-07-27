#!/usr/bin/env node
/**
 * Playtest for the ADS control settings (see src/core/controls.js).
 *
 * `src/core/input.selftest.mjs` proves the resolution rules in isolation; this
 * one proves the wiring by booting the real game in Chromium and driving real
 * DOM events through the real pause menu — the layer where a bad class name or
 * a listener on the wrong phase actually bites.
 *
 *   node tools/ads-playtest.mjs [screenshot.png]
 *
 * Boot is slow on a software rasteriser (minutes, not seconds); the ready wait
 * is sized for that.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = Number(process.env.ADS_PLAYTEST_PORT ?? 5181);
const URL = `http://127.0.0.1:${PORT}/?match=0&mp=0&q=performance`;
const SHOT = process.argv[2] ?? null;

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => (s.end(), res(true)));
    s.on('error', () => res(false));
  });

const vite = spawn('node', ['node_modules/.bin/vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (await portOpen(PORT)) break;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !extra ? '' : ` — got ${extra}`}`);
const eq = (name, actual, expected) =>
  check(name, actual === expected, `${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

try {
  await page.goto(URL);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 600000 });
  await page.waitForTimeout(1500);

  // This boot garrisons the level, and a respawn deliberately drops a toggle
  // latch — so a bot landing a kill mid-run would read as a latch bug. Take
  // damage out of the picture, and record every clear so if one does happen
  // the failure says who called it instead of just "false".
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('player').health.damage = () => {};
    const input = window.__ENGINE__.input;
    const clear = input.clearAdsToggle.bind(input);
    window.__ADS_CLEARS__ = [];
    input.clearAdsToggle = () => {
      window.__ADS_CLEARS__.push(new Error().stack ?? '?');
      clear();
    };
  });
  const clears = () => page.evaluate('window.__ADS_CLEARS__.length');

  // Frames are slow under a software rasteriser; give beginFrame room to run.
  const settle = () => page.waitForTimeout(400);
  const key = (type, code) =>
    page.evaluate(
      ([t, c]) => dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true })),
      [type, code]
    );
  const tap = async (code) => {
    await key('keydown', code);
    await key('keyup', code);
  };
  const ads = () => page.evaluate('window.__ENGINE__.input.ads');
  const cfg = () => page.evaluate('({...window.__ENGINE__.config})');
  const stored = () => page.evaluate('localStorage.getItem("cod_controls_v1")');
  const bindLabel = () =>
    page.evaluate(() => document.querySelector('.ow-bind')?.textContent ?? null);

  /* ---- defaults: X aims, and you can fire while aiming ------------------ */
  eq('boots in hold mode', (await cfg()).adsMode, 'hold');
  eq('boots with X bound', (await cfg()).adsKey, 'KeyX');

  await key('keydown', 'KeyX');
  await settle();
  eq('holding X aims', await ads(), true);

  await page.evaluate(() =>
    dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
  );
  await settle();
  const both = await page.evaluate(
    '({ads: window.__ENGINE__.input.ads, fire: window.__ENGINE__.input.fire})'
  );
  // The whole point: on a trackpad this pair was previously impossible.
  check('can fire while aiming from the keyboard', both.ads && both.fire, JSON.stringify(both));
  await page.evaluate(() => dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })));
  await key('keyup', 'KeyX');
  await settle();
  eq('releasing X drops the optic', await ads(), false);

  /* ---- the settings rows ------------------------------------------------ */
  await page.evaluate('window.__ENGINE__.ctx.get("ui").menu.show()');
  await settle();
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.ow-row > .name')].map((n) => n.textContent)
  );
  check(
    'pause menu lists both ADS rows',
    rows.includes('AIM (ADS)') && rows.includes('ADS KEY'),
    rows.join('|')
  );
  // `.ow-bind` must not collide with `.ow-key`, which is the in-world prompt cap.
  eq('exactly one rebind button in the DOM', await page.evaluate('document.querySelectorAll(".ow-bind").length'), 1);
  eq('rebind button shows the current cap', await bindLabel(), 'X');

  if (SHOT) await page.screenshot({ path: SHOT });

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ow-row')].find(
      (r) => r.querySelector('.name')?.textContent === 'AIM (ADS)'
    );
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'toggle').click();
  });
  await settle();
  eq('clicking toggle updates config', (await cfg()).adsMode, 'toggle');
  eq('the choice is persisted', JSON.parse(await stored()).adsMode, 'toggle');

  /* ---- rebinding -------------------------------------------------------- */
  await page.evaluate(() => document.querySelector('.ow-bind').click());
  await settle();
  eq('rebind button prompts', await bindLabel(), 'PRESS A KEY');

  await key('keydown', 'KeyW'); // reserved: movement
  await settle();
  eq('refuses a key the game already owns', await bindLabel(), 'IN USE');
  eq('a refused key does not rebind', (await cfg()).adsKey, 'KeyX');

  await page.waitForTimeout(1600); // let the IN USE flash expire
  await page.evaluate(() => document.querySelector('.ow-bind').click());
  await settle();
  await key('keydown', 'KeyB');
  await settle();
  eq('binds a free key', (await cfg()).adsKey, 'KeyB');
  eq('the cap label follows the bind', await bindLabel(), 'B');
  eq('the bind is persisted', JSON.parse(await stored()).adsKey, 'KeyB');

  /* ---- toggle mode in play ---------------------------------------------- */
  await page.evaluate('window.__ENGINE__.ctx.get("ui").menu.close()');
  await settle();
  const clearsBefore = await clears();
  await tap('KeyB');
  await settle();
  check(
    'tapping the bind latches ADS',
    (await ads()) === true,
    `ads=${await ads()} after ${(await clears()) - clearsBefore} clear(s)`
  );
  await settle();
  eq('the latch survives the release', await ads(), true);

  // `adsRequested` is gated on more than the button, so report the whole gate
  // — a dead or mantling player failing here is not an input bug.
  const seen = await page.evaluate(() => {
    const p = window.__ENGINE__.ctx.get('player');
    return {
      adsRequested: p.adsRequested,
      adsAmount: Number(p.adsAmount?.toFixed(2)),
      hud: window.__ENGINE__.ctx.get('ui').state.ads,
      controlEnabled: p.controlEnabled,
      dead: p.dead,
      mantling: p.movement.mantleMotion.active,
      sliding: p.movement.sliding,
    };
  });
  check('player and HUD follow the latch', seen.adsRequested && seen.hud, JSON.stringify(seen));

  await tap('KeyB');
  await settle();
  eq('a second tap unlatches', await ads(), false);

  await tap('KeyB');
  await settle();
  await key('keydown', 'ShiftLeft');
  await settle();
  eq('sprint breaks the latch', await ads(), false);
  await key('keyup', 'ShiftLeft');

  if (results.some((r) => r.startsWith('  FAIL')))
    console.log('\nclearAdsToggle callers:\n' + (await page.evaluate('window.__ADS_CLEARS__')).join('\n'));
} finally {
  console.log(results.join('\n'));
  await browser.close();
  vite.kill();
}

const failed = results.filter((r) => r.startsWith('  FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
