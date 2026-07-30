#!/usr/bin/env node
/**
 * SPAWN probe — verifies the spawn system against the REAL level.
 *
 *   node src/world/spawns.probe.mjs
 *   node src/world/spawns.probe.mjs --port=5207 --json
 *
 * `spawns.selftest.mjs` checks the scoring; it runs headless against a stub
 * map, so it cannot see the two things that only exist once the level is
 * built: whether a point survives contact with procedurally-scattered props,
 * and whether real collision agrees that a spawn is out of sight. This boots
 * the game the way `tools/playtest.mjs` does — live on the first frame, with a
 * bot garrison — and asks the running engine.
 *
 * It checks, in the built level:
 *   • every surviving spawn point is clear, on the floor, and spaced
 *   • the bot garrison landed away from the player and out of his view
 *   • 30 consecutive respawns never appear inside an enemy's bubble or sight
 *   • reinforcements come back in without landing on the player
 *
 * Only ever run this on port 5207 — every other harness owns a different port.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { launchOpts } from '../../tools/lib/chromium.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const PORT = Number(args.port ?? 5207);
const TIMEOUT = Number(args.timeout ?? 240000);

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

let server = null;
if (!(await portOpen(PORT))) {
  const root = resolve(import.meta.dirname, '../..');
  server = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) break;
  }
}

const browser = await chromium.launch(launchOpts({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
}));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let report = null;
let error = null;
try {
  // ?match=0 boots straight into a live match with the default garrison and
  // ?mp=0 keeps the relay out of it, so this measures the offline path.
  // ?prewarm=0 is the difference between a 40 s boot and a 100 s one here; it
  // is proven pixel-neutral and this probe takes no pictures.
  // --map=<id> probes another level's spawn table; default is the boot map.
  const mapQ = args.map ? `&map=${encodeURIComponent(args.map)}` : '';
  await page.goto(`http://127.0.0.1:${PORT}/?match=0&mp=0&prewarm=0&q=low${mapQ}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });

  report = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const phys = e.ctx.peek('physics');
    const player = e.ctx.peek('player');
    const ai = e.ctx.peek('ai');
    const out = { checks: [], stats: {} };
    const check = (pass, label, detail = '') => out.checks.push({ pass: !!pass, label, detail });

    const V = (x, y, z) => ({ x, y, z });
    const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const eye = () => {
      const p = player.feetPosition;
      return V(p.x, p.y + 1.6, p.z);
    };
    const sees = (from, p) =>
      phys.lineOfSight(from, V(p.x, p.y + 1.2, p.z), phys.MASK.SIGHT);

    /* ---- 1. the point set, as built ---------------------------------- */
    const pts = world.spawnPoints;
    out.stats.points = pts.length;
    out.stats.zones = {};
    for (const p of pts) out.stats.zones[p.zone] = (out.stats.zones[p.zone] ?? 0) + 1;
    check(pts.length >= 28, `${pts.length} spawn points survived placement`);
    check(Object.keys(out.stats.zones).length >= 8, `${Object.keys(out.stats.zones).length} zones populated`);

    let blocked = 0;
    let floating = 0;
    let closest = Infinity;
    for (const p of pts) {
      const clear = phys.checkCapsule(
        V(p.position.x, p.position.y + 0.5, p.position.z),
        V(p.position.x, p.position.y + 1.72, p.position.z),
        0.34,
        phys.MASK.CHARACTER
      );
      if (!clear) blocked++;
      const gy = phys.groundHeight(p.position.x, p.position.z, p.position.y + 2.4);
      if (!Number.isFinite(gy) || Math.abs(gy - p.position.y) > 0.4) floating++;
      for (const q of pts) if (q !== p) closest = Math.min(closest, p.position.distanceTo(q.position));
    }
    check(blocked === 0, 'every shipped point fits a standing character', `${blocked} blocked`);
    check(floating === 0, 'every shipped point is on the floor', `${floating} off the floor`);
    check(closest > 3.0, 'points are spaced', `closest pair ${closest.toFixed(1)} m`);

    /* ---- 2. the garrison ---------------------------------------------- */
    const from = eye();
    const bots = ai.agents.filter((a) => a.alive);
    out.stats.bots = bots.length;
    let nearBot = Infinity;
    let visibleBots = 0;
    for (const a of bots) {
      nearBot = Math.min(nearBot, d2(a.position, player.feetPosition));
      if (sees(from, a.position)) visibleBots++;
    }
    check(bots.length > 0, `${bots.length} bots garrisoned`);
    check(nearBot > 12, 'no bot spawned in the player\'s lap', `nearest ${nearBot.toFixed(1)} m`);
    check(visibleBots === 0, 'no bot spawned in the player\'s line of sight', `${visibleBots} visible`);

    /* ---- 3. thirty respawns ------------------------------------------- */
    const T = world.spawns.tuning;
    let worstEnemy = Infinity;
    let seenSpawns = 0;
    let seenAt = 0;
    let repeats = 0;
    let prev = null;
    const zonesUsed = new Set();
    for (let i = 0; i < 30; i++) {
      const p = player.respawn({ team: 'player', actorId: 'player' });
      if (!p) break;
      zonesUsed.add(p.zone);
      if (p === prev) repeats++;
      prev = p;
      let seenHere = false;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        const d = d2(a.position, p.position);
        worstEnemy = Math.min(worstEnemy, d);
        if (sees(V(a.position.x, a.position.y + 1.5, a.position.z), p.position)) {
          seenHere = true;
          seenAt = Math.max(seenAt, d);
        }
      }
      if (seenHere) seenSpawns++;
      world.spawns.update(1.0); // let the cooldowns age between picks
    }
    out.stats.respawnZones = [...zonesUsed];
    check(
      worstEnemy >= T.hardMinEnemy,
      `30 respawns stayed outside the ${T.hardMinEnemy} m bubble`,
      `closest ${worstEnemy.toFixed(1)} m`
    );
    check(
      seenSpawns === 0,
      'no respawn landed in a bot\'s line of sight',
      `${seenSpawns}/30 seen, furthest watcher ${seenAt.toFixed(0)} m`
    );
    check(repeats === 0, 'no respawn reused the previous point');
    check(zonesUsed.size >= 4, `respawns spread over ${zonesUsed.size} zones`, [...zonesUsed].join(' '));

    /* ---- 4. reinforcement --------------------------------------------- */
    const before = ai.agents.length;
    const made = ai.reinforce(2);
    const fresh = ai.agents.slice(before).filter((a) => a.alive);
    let nearFresh = Infinity;
    for (const a of fresh) nearFresh = Math.min(nearFresh, d2(a.position, player.feetPosition));
    check(made > 0 && fresh.length > 0, `${made} reinforcements arrived`);
    check(
      fresh.length === 0 || nearFresh > 12,
      'reinforcements did not come in on top of the player',
      `nearest ${nearFresh.toFixed(1)} m`
    );

    out.stats.director = world.spawns.stats;
    return out;
  });
} catch (err) {
  error = err?.message ?? String(err);
}

await browser.close();
if (server) server.kill();

if (args.json) {
  console.log(JSON.stringify({ report, error, logs: logs.slice(-40) }, null, 2));
} else if (error) {
  console.log(`\x1b[31mprobe failed:\x1b[0m ${error}`);
  console.log(logs.slice(-25).join('\n'));
} else {
  let failed = 0;
  for (const c of report.checks) {
    if (!c.pass) failed++;
    const detail = c.detail ? `  ${c.pass ? '(' + c.detail + ')' : '— ' + c.detail}` : '';
    console.log(`  ${c.pass ? 'ok  ' : 'FAIL'}  ${c.label}${detail}`);
  }
  console.log(`\nzones: ${JSON.stringify(report.stats.zones)}`);
  console.log(`respawn zones: ${report.stats.respawnZones?.join(', ')}`);
  console.log(
    `\n${failed ? '\x1b[31m' : '\x1b[32m'}${report.checks.length - failed}/${report.checks.length} checks passed\x1b[0m`
  );
  process.exit(failed ? 1 : 0);
}
process.exit(error ? 1 : 0);
