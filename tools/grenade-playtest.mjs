#!/usr/bin/env node
/**
 * Playtest for the lethal / tactical equipment binds (G and H).
 *
 * `src/weapons/throwables.selftest.mjs` proves the inventory and fuse rules in
 * isolation with a stub ctx. This one proves the WIRING: that a real keydown on
 * a real page reaches `_runThrowables`, that the round becomes a real rigid body
 * in the real physics world, that the detonation reaches `ui` and `ai`, and that
 * the HUD pips move. Every one of those is a seam the unit test cannot see.
 *
 *   node tools/grenade-playtest.mjs [screenshot.png]
 *
 * Boot is slow on a software rasteriser (minutes, not seconds).
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = Number(process.env.NADE_PLAYTEST_PORT ?? 5183);
const URL = `http://127.0.0.1:${PORT}/?match=0&mp=0&q=performance`;
const SHOT = process.argv[2] ?? null;

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => (s.end(), res(true)));
    s.on('error', () => res(false));
  });

// `node_modules/.bin/vite` is a SHELL wrapper, so `node` cannot run it — it dies
// with a SyntaxError on the shebang script and the harness then fails with a
// bare ERR_CONNECTION_REFUSED that says nothing about why. Point at the real
// entry point instead. (tools/ads-playtest.mjs still has the .bin form.)
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
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

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 600000 });
  await page.waitForTimeout(1500);

  // Record every detonation event, and take bot damage out of the picture so a
  // stray round cannot end the run mid-throw.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const p = ctx.get('player');
    if (p?.health) p.health.damage = () => {};
    window.__EVT__ = [];
    for (const type of ['explosion', 'equipment:flash']) {
      ctx.events.on(type, (e) => {
        window.__EVT__.push({ type, radius: e.radius, duration: e.duration });
      });
    }
  });

  const state = () =>
    page.evaluate(() => {
      const ctx = window.__ENGINE__.ctx;
      const w = ctx.get('weapons');
      const t = w.throwables;
      const ui = ctx.peek('ui');
      return {
        cooking: t.cooking,
        live: t.live.length,
        counts: { ...t.counts },
        arcVisible: t._arc?.visible ?? false,
        arcPoints: t._arc?.geometry?.drawRange?.count ?? 0,
        hudLethal: ui?.state.lethalCount,
        hudTactical: ui?.state.tacticalCount,
        flashLevel: ui?.flash?.level ?? 0,
        events: window.__EVT__.length,
        blinded: (ctx.peek('ai')?.agents ?? []).filter((a) => a.alive && a.blindness > 0.1).length,
      };
    });

  const start = await state();
  check('boots with a full loadout', start.counts.lethal === 2 && start.counts.tactical === 2,
    JSON.stringify(start.counts));
  check('HUD mirrors the real inventory', start.hudLethal === 2 && start.hudTactical === 2,
    `${start.hudLethal}/${start.hudTactical}`);
  check('nothing cooking at rest', !start.cooking && !start.arcVisible);

  /* ---------------------------------------------------------- cook a frag -- */
  await page.keyboard.down('g');
  await page.waitForTimeout(350);
  const cooking = await state();
  check('G starts a cook', cooking.cooking);
  check('arc preview appears while cooking', cooking.arcVisible, `visible=${cooking.arcVisible}`);
  check('arc preview has real geometry', cooking.arcPoints > 3, `${cooking.arcPoints} points`);
  check('cooking has not spent the round yet', cooking.counts.lethal === 2);

  /* ------------------------------------------------------------- throw it -- */
  await page.keyboard.up('g');
  await page.waitForTimeout(250);
  const thrown = await state();
  check('releasing G throws', thrown.live === 1, `${thrown.live} live`);
  check('throw spends one frag', thrown.counts.lethal === 1, `${thrown.counts.lethal}`);
  check('arc preview goes away', !thrown.arcVisible);
  check('HUD pip decrements', thrown.hudLethal === 1, `${thrown.hudLethal}`);

  /* ------------------------------------------------------------ detonation -- */
  await page.waitForTimeout(3600);
  const boom = await state();
  check('frag detonates and clears', boom.live === 0, `${boom.live} still live`);
  const evts = await page.evaluate(() => window.__EVT__);
  check('frag emitted an explosion', evts.some((e) => e.type === 'explosion'),
    JSON.stringify(evts));

  /* ------------------------------------------------------------------ stun -- */
  // Throw the stun straight down so it lands on the player and definitely
  // flashes them — the point is to prove the ui/ai path, not the arc.
  await page.evaluate(() => {
    const cam = window.__ENGINE__.ctx.camera;
    cam.rotation.x = -1.35;
    cam.updateMatrixWorld(true);
  });
  await page.keyboard.down('h');
  await page.waitForTimeout(120);
  const cookingStun = await state();
  check('H starts a tactical cook', cookingStun.cooking);
  await page.keyboard.up('h');
  await page.waitForTimeout(2600);

  const flashed = await state();
  const evts2 = await page.evaluate(() => window.__EVT__);
  check('stun emitted equipment:flash', evts2.some((e) => e.type === 'equipment:flash'),
    JSON.stringify(evts2));
  check('stun spends a tactical', flashed.counts.tactical === 1, `${flashed.counts.tactical}`);
  check('screen flash fired', flashed.flashLevel > 0.05, `level ${flashed.flashLevel}`);

  if (SHOT) await page.screenshot({ path: SHOT });

  /* ------------------------------------------------- one throwable at a time */
  const exclusive = await page.evaluate(async () => {
    const t = window.__ENGINE__.ctx.get('weapons').throwables;
    const a = t.beginCook('lethal');
    const b = t.beginCook('tactical');
    t.cancelCook();
    return { a, b };
  });
  check('a second cook is refused while one is out', exclusive.a === true && exclusive.b === false,
    JSON.stringify(exclusive));

  /* ------------------------------------- the cook releases on ITS OWN key -- */
  // Cook a frag on G, then tap H. The frag must stay cooking (H is not what is
  // holding it) and must leave the hand the moment G comes up — not when H does.
  await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').throwables.refill());
  // The exclusivity check above ends in cancelCook(), which by contract THROWS
  // the round rather than refunding it — so there is already a live grenade in
  // the air. Measure against that baseline, not against zero.
  const base = (await state()).live;
  await page.keyboard.down('g');
  await page.waitForTimeout(200);
  await page.keyboard.down('h');
  await page.waitForTimeout(120);
  const bothDown = await state();
  check('tapping the other bind does not drop the cook', bothDown.cooking);
  await page.keyboard.up('h');
  await page.waitForTimeout(120);
  const otherUp = await state();
  check('releasing the OTHER bind does not throw', otherUp.cooking && otherUp.live === base,
    `cooking=${otherUp.cooking} live=${otherUp.live} base=${base}`);
  await page.keyboard.up('g');
  await page.waitForTimeout(150);
  const ownUp = await state();
  check('releasing the cook bind throws', !ownUp.cooking && ownUp.live === base + 1,
    `cooking=${ownUp.cooking} live=${ownUp.live} base=${base}`);
} catch (e) {
  check(`harness error: ${e.message}`, false);
} finally {
  console.log('grenade playtest');
  for (const r of results) console.log(r);
  const failed = results.filter((r) => r.startsWith('  FAIL')).length;
  console.log(failed ? `\n${failed} FAILED` : `\n${results.length} checks passed`);
  await browser.close();
  vite.kill();
  process.exit(failed ? 1 : 0);
}
