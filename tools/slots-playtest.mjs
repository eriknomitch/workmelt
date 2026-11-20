#!/usr/bin/env node
/**
 * Playtest for the slot machines in Clifton Hill's midway.
 *
 * `src/world/slots.selftest.mjs` proves the odds and the clock in isolation.
 * This proves the WIRING on a real page: that standing at a machine in the
 * real (yawed) level lights the prompt, that a real F keydown takes a pull and
 * charges it to the real player, that the reels roll in the HUD and stop, and
 * that a jackpot makes real damage land on nothing — then wears off.
 *
 *   node tools/slots-playtest.mjs [screenshot.png]
 *
 * Boots with `?draw=0` unless a screenshot is asked for (see `stateQuery` in
 * tools/lib/harness.mjs). The outcome of each pull is forced by swapping the
 * bank's random source, so the run does not depend on luck.
 */

import { chromium } from 'playwright';
import { ensureServer, stateQuery, waitFrames, waitGameTime } from './lib/harness.mjs';
import { launchOpts } from './lib/chromium.mjs';

const PORT = Number(process.env.OW_PORT ?? 5273);
const SHOT = process.argv[2] ?? null;
const URL = `http://127.0.0.1:${PORT}/?map=clifton&match=0&mp=0&q=performance&${stateQuery({ draw: !!SHOT })}`;

const vite = await ensureServer(PORT);
const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--hide-scrollbars'],
}));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('[pageerror]', e.message);
});

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !extra ? '' : ` — got ${extra}`}`);

/** Stand the player at machine `i`, facing it, in the real level. */
const standAt = (i, back = 0.35) =>
  page.evaluate(({ i, back }) => {
    const ctx = window.__ENGINE__.ctx;
    const world = ctx.get('world');
    const p = ctx.get('player');
    const m = world.slots.bank.machines[i];
    const lx = m.x + m.fx * back;
    const lz = m.z + m.fz * back;
    const at = world.levelToWorld(lx, 0, lz);
    const ahead = world.levelToWorld(lx - m.fx, 0, lz - m.fz);
    // probe from just above the hall floor: the speedway roof is overhead
    const gy = ctx.get('physics').groundHeight(at.x, at.z, m.y + 1.5);
    p.movement.teleport(at.x, gy + 0.03, at.z);
    // forward is (-sin yaw, -cos yaw)
    p.movement.yaw = Math.atan2(-(ahead.x - at.x), -(ahead.z - at.z));
    p.movement.pitch = -0.12;
  }, { i, back });

const state = () =>
  page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const world = ctx.get('world');
    const p = ctx.get('player');
    const ui = ctx.peek('ui');
    const bank = world.slots?.bank;
    return {
      hasBank: !!bank,
      machines: bank?.machines.length ?? 0,
      health: p.health.value,
      inv: p.invulnerableLeft,
      spinning: !!bank?.spin,
      lockout: bank?.lockout ?? 0,
      prompt: ui.prompt.active,
      promptText: ui.prompt.txt.textContent,
      promptKey: ui.prompt.key.textContent,
      status: ui.status.root.style.display !== 'none' ? ui.status.root.textContent : '',
      banner: ui.banner.title.textContent,
      reserve: [...ctx.get('weapons').states.values()].map((s) => s.reserve),
      events: window.__SLOT_EVT__,
    };
  });

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 600000 });
  await waitFrames(page, 20);

  // Bots stand still for this: a stray round must not decide the run.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const ai = ctx.peek('ai');
    if (ai) ai.update = () => {};
    window.__SLOT_EVT__ = [];
    for (const t of ['slots:spin', 'slots:result']) {
      ctx.events.on(t, (e) => window.__SLOT_EVT__.push({ t, outcome: e.outcome ?? null }));
    }
  });

  const s0 = await state();
  check('Clifton builds its slot bank', s0.hasBank && s0.machines === 7, `${s0.machines} machines`);

  /* ------------------------------------------------- the prompt -- */
  await standAt(3);
  await waitFrames(page, 4);
  const at = await state();
  check('standing at a machine shows the spin prompt', at.prompt && /SPIN/.test(at.promptText), at.promptText);

  await page.evaluate(() => { window.__ENGINE__.ctx.get('player').movement.yaw += Math.PI; });
  await waitFrames(page, 4);
  const away = await state();
  check('turning your back clears it', !away.prompt, away.promptText);
  await standAt(3);
  // the speedway runs on the roof right over the bank
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const p = ctx.get('player');
    const f = p.feetPosition;
    p.movement.teleport(f.x, f.y + 8.4 + 0.4, f.z);
  });
  await waitFrames(page, 4);
  const roof = await state();
  check('standing on the roof above it does not', !roof.prompt, roof.promptText);

  await standAt(3);
  await waitFrames(page, 4);
  const floorY = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const world = ctx.get('world');
    const f = ctx.get('player').feetPosition;
    return world.worldToLevel(f.x, f.y, f.z).y - world.slots.bank.machines[3].y;
  });
  check('the player is on the hall floor, not the roof', Math.abs(floorY) < 0.3, floorY.toFixed(2));

  /* ------------------------------------------------- a losing pull -- */
  // drain some reserve first so a payout's restock is visible later
  await page.evaluate(() => {
    for (const s of window.__ENGINE__.ctx.get('weapons').states.values()) s.reserve = 1;
    window.__ENGINE__.ctx.get('world').slots._rand = () => 0.95;
  });
  const before = (await state()).health;
  await page.keyboard.press('f');
  await waitFrames(page, 3);
  const spun = await state();
  check('F takes a pull', spun.spinning, JSON.stringify(spun.events));
  check('and charges 20 health', Math.abs(before - spun.health - 20) < 0.5, `${before} -> ${spun.health}`);
  check('the reels roll in the prompt', spun.promptKey === '$' && /·/.test(spun.promptText), spun.promptText);
  await page.keyboard.press('f');
  await waitFrames(page, 3);
  check('a second F mid-spin is ignored', (await state()).events.filter((e) => e.t === 'slots:spin').length === 1);
  await waitGameTime(page, 1.7);
  const lost = await state();
  check('the spin resolves', !lost.spinning && lost.events.some((e) => e.outcome === 'lose'),
    JSON.stringify(lost.events));
  check('a loss pays nothing', lost.health <= spun.health + 0.5 && lost.inv === 0, `${lost.health}`);

  /* ------------------------------------------------- a payout -- */
  await page.evaluate(() => { window.__ENGINE__.ctx.get('world').slots._rand = () => 0.15; });
  await page.keyboard.press('f');
  await waitGameTime(page, 1.8);
  const paid = await state();
  check('a payout heals to full', paid.health > 99, `${paid.health}`);
  check('and restocks the reserve', paid.reserve.every((r) => r > 1), paid.reserve.join(','));
  check('with a banner', /PAYOUT/.test(paid.banner), paid.banner);

  /* ------------------------------------------------- the jackpot -- */
  await page.evaluate(() => { window.__ENGINE__.ctx.get('world').slots._rand = () => 0; });
  await page.keyboard.press('f');
  await waitGameTime(page, 1.8);
  const won = await state();
  check('a jackpot makes the player invincible', won.inv > 4, `${won.inv}`);
  check('the HUD counts it down', /INVINCIBLE/.test(won.status), won.status);
  check('JACKPOT on the banner', /JACKPOT/.test(won.banner), won.banner);
  const hit = await page.evaluate(() => {
    const p = window.__ENGINE__.ctx.get('player');
    const h = p.health.value;
    const dealt = p.applyDamage(500, null, { type: 'bullet' });
    return { dealt, after: p.health.value, before: h, dead: p.dead };
  });
  check('damage lands on nothing while invincible', hit.dealt === 0 && !hit.dead && hit.after === hit.before,
    JSON.stringify(hit));
  await waitFrames(page, 3);
  const locked = await state();
  check('the bank refuses another pull', locked.lockout > 20 && /COOLING/.test(locked.promptText), locked.promptText);

  if (SHOT) {
    await page.evaluate(() => { window.__ENGINE__.ctx.get('world').slots._rand = () => 0; });
    await page.screenshot({ path: SHOT });
  }

  await waitGameTime(page, 6.5);
  const worn = await state();
  check('invincibility wears off', worn.inv === 0 && worn.status === '', `${worn.inv} ${worn.status}`);
  const hurt = await page.evaluate(() => window.__ENGINE__.ctx.get('player').applyDamage(10, null, { type: 'bullet' }));
  check('and damage lands again', hurt > 9, `${hurt}`);

  /* ------------------------------------------------- never lethal -- */
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('world').slots.bank.lockout = 0;
    ctx.get('player').health.value = 20;
  });
  const n0 = (await state()).events.length;
  await page.keyboard.press('f');
  await waitFrames(page, 3);
  const poor = await state();
  check('at 20 health the pull is refused', !poor.spinning && poor.events.length === n0 && poor.health === 20,
    `${poor.health} ${poor.promptText}`);
  check('and the prompt says why', /NOT ENOUGH HEALTH/.test(poor.promptText), poor.promptText);

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  results.push(`  FAIL harness: ${e.message}`);
} finally {
  await browser.close();
  vite?.kill?.();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('  FAIL')).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} slot checks passed`);
process.exit(failed ? 1 : 0);
