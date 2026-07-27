#!/usr/bin/env node
/**
 * Playtest for the advanced graphics settings (see `src/core/graphics.js`).
 *
 * `src/core/graphics.selftest.mjs` proves the schema and `src/core/selftest.mjs`
 * proves the quality system's half of the contract, both headlessly. This one
 * proves the WIRING: it boots the real game in Chromium, opens the real pause
 * menu, clicks the real controls, and checks that a live option moves the real
 * renderer and that a restart-only option survives an actual page reload into
 * `config.q`. That is the layer where a wrong option index, a listener on the
 * wrong element or a preset key nobody reads actually bites.
 *
 *   node tools/graphics-playtest.mjs [screenshot.png]
 *
 * Boot is slow on a software rasteriser (minutes, not seconds); the ready waits
 * are sized for that, and pre-warm is off because this harness measures
 * settings plumbing, not shader compilation.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = Number(process.env.GFX_PLAYTEST_PORT ?? 5183);
const URL = `http://127.0.0.1:${PORT}/?match=0&mp=0&prewarm=0`;
const SHOT = process.argv[2] ?? null;
const READY_MS = 900000;

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => (s.end(), res(true)));
    s.on('error', () => res(false));
  });

const vite = spawn('node', ['node_modules/.bin/vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  env: { ...process.env, OW_NO_HMR: '1' },
});
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (await portOpen(PORT)) break;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !extra ? '' : ` — got ${extra}`}`);
const eq = (name, actual, expected) =>
  check(name, actual === expected, `${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

/**
 * Seed a MANUAL graphics mode before the bundle runs. Booting on Auto would
 * spend the run calibrating against a software rasteriser and then reload the
 * page out from under the test; `?q=` would be worse, because it disables the
 * whole settings layer by design (capture determinism) and every setOption
 * would correctly refuse.
 */
const seed = (overrides = {}) =>
  page.addInitScript(
    ([o]) =>
      localStorage.setItem(
        'cod_graphics_v1',
        JSON.stringify({
          version: 3,
          mode: 'high',
          targetFps: 60,
          tier: 'high',
          renderScale: 1,
          refreshHz: 60,
          signature: null,
          calibrated: true,
          overrides: o,
        })
      ),
    [overrides]
  );

const settle = () => page.waitForTimeout(500);
const ready = () => page.waitForFunction('window.__READY__ === true', null, { timeout: READY_MS });
/** Advanced rows are keyed by their uppercased label. */
const rowHandle = (label) =>
  page.evaluateHandle((l) => {
    for (const r of document.querySelectorAll('.ow-row'))
      if (r.querySelector('.name')?.firstChild?.textContent?.trim() === l) return r;
    return null;
  }, label);

try {
  await seed();
  // `domcontentloaded`, like every other harness here: waiting for `load` also
  // waits on the brand webfont, which is deliberately non-blocking and may never
  // resolve on a machine that cannot reach fonts.googleapis.com. The real gate
  // is `__READY__`.
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await ready();
  await settle();

  const q = () => page.evaluate('({...window.__ENGINE__.config.q})');
  const overrides = () =>
    page.evaluate('JSON.parse(localStorage.getItem("cod_graphics_v1")).overrides');
  const renderState = () =>
    page.evaluate(() => {
      const r = window.__ENGINE__.ctx.get('render');
      return {
        renderScale: r.renderScale,
        pixelRatio: r.renderer.getPixelRatio(),
        width: r.screenSize.width,
        grain: r.settings.grain,
        exposureBias: r.settings.exposureBias,
        skyFill: r.settings.skyFill,
      };
    });

  /* ---- the menu is actually generated from the schema ------------------- */
  await page.evaluate('window.__ENGINE__.ctx.get("ui").menu.show()');
  await settle();

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.ow-tab')].map((t) => t.textContent)
  );
  check(
    'every graphics group has a tab',
    ['General', 'Display', 'Textures & Detail', 'Shading & Lighting', 'Post-Processing', 'Visibility'].every(
      (t) => tabs.includes(t)
    ),
    tabs.join('|')
  );

  const schemaSize = await page.evaluate(
    () => window.__ENGINE__.ctx.get('ui').menu._optionRows.size
  );
  check('every schema option built a row', schemaSize >= 30, String(schemaSize));

  const tabRows = async (label) => {
    await page.evaluate((l) => {
      [...document.querySelectorAll('.ow-tab')].find((t) => t.textContent === l).click();
    }, label);
    await settle();
    return page.evaluate(() =>
      [...document.querySelectorAll('.ow-panel')]
        .filter((p) => p.style.display !== 'none')
        .flatMap((p) => [...p.querySelectorAll('.ow-row > .name')])
        .map((n) => n.firstChild.textContent.trim())
    );
  };

  const displayRows = await tabRows('Display');
  check(
    'the Display tab shows the resolution controls',
    displayRows.includes('RESOLUTION SCALE') &&
      displayRows.includes('DISPLAY SHARPNESS') &&
      displayRows.includes('ANTI-ALIASING'),
    displayRows.join('|')
  );
  const textureRows = await tabRows('Textures & Detail');
  check(
    'the Textures tab shows the bake controls',
    textureRows.includes('TEXTURE QUALITY') && textureRows.includes('CHARACTER TEXTURES'),
    textureRows.join('|')
  );
  eq(
    'only one tab panel is visible at a time',
    await page.evaluate(
      () => [...document.querySelectorAll('.ow-panel')].filter((p) => p.style.display !== 'none').length
    ),
    1
  );
  if (SHOT) await page.screenshot({ path: SHOT });

  /* ---- a live option moves the renderer, with no reload ----------------- */
  await tabRows('Display');
  const before = await renderState();
  const pickEnum = async (label, optionLabel) => {
    const row = await rowHandle(label);
    return row.evaluate((r, want) => {
      const select = r.querySelector('select');
      const idx = [...select.options].findIndex((o) => o.textContent === want);
      if (idx < 0) return false;
      select.value = String(idx);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, optionLabel);
  };

  check('resolution scale offers 70%', await pickEnum('RESOLUTION SCALE', '70%'));
  await settle();
  const scaled = await renderState();
  check(
    'picking a resolution scale resizes the render target live',
    Math.abs(scaled.renderScale - 0.7) < 0.001 && scaled.width < before.width,
    JSON.stringify(scaled)
  );
  eq('...and is persisted', (await overrides()).renderScale, 0.7);
  eq('...and pins the adaptive scaler', await page.evaluate('window.__ENGINE__.ctx.get("quality").scaleLocked'), true);
  eq(
    '...without reloading the page',
    await page.evaluate('window.__ENGINE__.ctx.get("quality").pendingRestart'),
    false
  );

  check('display sharpness offers 1.0x', await pickEnum('DISPLAY SHARPNESS', '1.0x'));
  await settle();
  const dpr = await renderState();
  eq('picking a DPR cap re-sizes the backbuffer live', dpr.pixelRatio, 1);

  /* ---- live sliders ----------------------------------------------------- */
  await tabRows('Visibility');
  const dragSlider = async (label, value) => {
    const row = await rowHandle(label);
    return row.evaluate((r, v) => {
      const input = r.querySelector('input[type=range]');
      if (!input) return false;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, value);
  };

  check('brightness is a slider', await dragSlider('BRIGHTNESS', 0.5));
  await settle();
  const bright = await renderState();
  // The renderer stores EV where POSITIVE is darker; the slider must invert.
  eq('brightness reaches exposureBias inverted', bright.exposureBias, -0.5);
  eq('...and is persisted', (await overrides()).brightness, 0.5);

  check('shadow lift is a slider', await dragSlider('SHADOW LIFT', 2));
  await settle();
  const lifted = await renderState();
  check(
    'shadow lift scales the indirect terms',
    Math.abs(lifted.skyFill - before.skyFill * 2) < 1e-6,
    `${lifted.skyFill} want ${before.skyFill * 2}`
  );
  // Applied to the values authored in init(), never compounded: setting it
  // again must land on the same number, not on twice the number.
  await dragSlider('SHADOW LIFT', 2);
  await settle();
  check(
    '...idempotently',
    Math.abs((await renderState()).skyFill - before.skyFill * 2) < 1e-6,
    String((await renderState()).skyFill)
  );

  /* ---- a restart-only option waits, rather than reloading under you ----- */
  await tabRows('Textures & Detail');
  check('texture quality offers Low', await pickEnum('TEXTURE QUALITY', 'Low (512)'));
  await settle();
  eq(
    'a restart-only option raises the pending flag',
    await page.evaluate('window.__ENGINE__.ctx.get("quality").pendingRestart'),
    true
  );
  eq('...and shows the Apply button', await page.evaluate(
    () => document.querySelector('.ow-btn.warn')?.style.display !== 'none'
  ), true);
  eq('...and is persisted immediately', (await overrides()).textureScale, 0.5);
  eq('...and does NOT reload on its own', await page.evaluate('window.__READY__'), true);
  check(
    'restart-only rows are tagged in the UI',
    await page.evaluate(() =>
      [...document.querySelectorAll('.ow-row')].some(
        (r) =>
          r.querySelector('.name')?.firstChild?.textContent?.trim() === 'TEXTURE QUALITY' &&
          r.querySelector('.ow-tag')?.textContent === 'RESTART'
      )
    )
  );

  /* ---- and the reload actually carries it into config.q ----------------- */
  const stored = await page.evaluate('localStorage.getItem("cod_graphics_v1")');
  await page.addInitScript((s) => localStorage.setItem('cod_graphics_v1', s), stored);
  // `commit`, not `load`: the default wait is for the load event, which on a
  // software rasteriser is minutes away. `ready()` is the real gate.
  await page.reload({ waitUntil: 'commit', timeout: READY_MS });
  await ready();
  await settle();

  const q2 = await q();
  eq('texture scale survives the reload into config.q', q2.textureScale, 0.5);
  eq('resolution scale survives too', q2.renderScale, 0.7);
  eq('...with the ceiling widened for it', q2.maxRenderScale >= 0.7, true);
  eq('pixel ratio cap survives', q2.pixelRatioCap, 1);
  const live = await renderState();
  eq('the renderer boots at the stored DPR cap', live.pixelRatio, 1);
  eq('the renderer boots at the stored scale', Math.abs(live.renderScale - 0.7) < 0.001, true);
  const bakes = await page.evaluate(() =>
    [...window.__ENGINE__.ctx.get('materials')._sets.values()].map((s) => s.size)
  );
  check(
    'the world textures were actually baked smaller',
    bakes.length > 0 && Math.max(...bakes) <= 512,
    `sizes ${[...new Set(bakes)].join(',')}`
  );
  const exposure = await page.evaluate(
    () => window.__ENGINE__.ctx.get('render').settings.exposureBias
  );
  eq('the brightness slider survives the reload', exposure, -0.5);

  /* ---- clearing everything gets the shipped preset back ----------------- */
  await page.evaluate('window.__ENGINE__.ctx.get("quality").resetOptions()');
  await settle();
  eq('resetOptions clears storage', JSON.stringify(await overrides()), '{}');
} catch (err) {
  check(`harness error: ${err?.message ?? err}`, false);
  console.error(err);
} finally {
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('  FAIL')).length;
  console.log(
    failed ? `\n${failed} of ${results.length} checks FAILED` : `\n${results.length} checks passed`
  );
  await browser.close();
  vite.kill();
  process.exit(failed ? 1 : 0);
}
