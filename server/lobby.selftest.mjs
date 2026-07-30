#!/usr/bin/env node
/**
 * RELAY — the match-start lobby, checked against a real server on a real socket.
 *
 *   node server/lobby.selftest.mjs
 *
 * The relay owns two pieces of match state, and this is the one that decides
 * whether a group of friends can actually get into a game together: who has
 * readied up, who is merely warming up against bots, and when one start signal
 * fires. Every rule in here is a rule that only bites in a room of three, which
 * is exactly the case nobody tests by hand.
 *
 * The bug it was written for: the first player pressing the lobby's own primary
 * button ("Play vs 6 bots") used to mark the room LIVE, which locked the map and
 * skipped the ready flow for everybody who followed the invite link — so the
 * only way to a shared start was for every player to leave their match first and
 * then all ready up. A warm-up is now private and does not make a room live.
 *
 * `worker/room.js` mirrors this logic for the Cloudflare deploy; keep them in
 * step (see MULTIPLAYER.md).
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8801);
/** Short countdown so the late-join window is testable without a slow harness. */
const COUNTDOWN_MS = 800;
/**
 * Point this at another relay to run the same checks against it — the Durable
 * Object port is the one that matters:
 *
 *   npm run cf:dev
 *   RELAY_URL=ws://127.0.0.1:8788/ws node server/lobby.selftest.mjs
 *
 * The countdown there is whatever the Worker's env says (3 s by default), so the
 * late-arrival window is wider, not narrower — the waits below still fit.
 */
const RELAY_URL = process.env.RELAY_URL ?? null;
const srv = RELAY_URL
  ? null
  : spawn(process.execPath, ['server/index.mjs'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        COUNTDOWN_MS: String(COUNTDOWN_MS),
        MAX_START_MS: String(COUNTDOWN_MS * 3),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
srv?.stderr.on('data', (d) => process.stderr.write(d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(900);

function open(room, name, map = 'market') {
  return new Promise((res, rej) => {
    // The room rides the URL as well as the join message: on Cloudflare the
    // Worker routes to the room's Durable Object by this query param before it
    // reads a message. The Node relay ignores it.
    const base = RELAY_URL ?? `ws://127.0.0.1:${PORT}/ws`;
    const ws = new WebSocket(`${base}${base.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`);
    const log = [];
    ws.on('error', rej);
    ws.on('message', (d) => {
      try {
        log.push(JSON.parse(d));
      } catch {
        /* the relay only ever sends JSON */
      }
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', room, name, map }));
      res({
        ws,
        log,
        name,
        send: (o) => ws.send(JSON.stringify(o)),
        /** id the relay assigned us; only valid once `welcome` has landed */
        get id() {
          return last(log, 'welcome')?.id ?? null;
        },
      });
    });
  });
}

const last = (log, t) => [...log].reverse().find((m) => m.t === t);
const all = (log, t) => log.filter((m) => m.t === t);
const who = (log, name) => (last(log, 'lobby')?.players ?? []).find((p) => p.name === name);

let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(`  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) fails++;
};

try {
  /* ── a warm-up is not a match ──────────────────────────────────────────── */
  console.log('warm-up vs the room’s match');
  {
    const a = await open('warm', 'A');
    await wait(200);
    a.send({ t: 'deploy', solo: true });
    await wait(200);
    ok(last(a.log, 'lobby')?.live === false, 'a solo warm-up does NOT make the room live');

    const b = await open('warm', 'B');
    await wait(250);
    ok(last(b.log, 'welcome')?.live === false, 'so whoever follows the link still gets the ready flow');
    ok(who(b.log, 'A')?.warm === true, 'and can see that A is warming up, not in a match');

    // The whole point: B readies alone and the match starts, taking A with it.
    b.send({ t: 'ready', ready: true });
    await wait(250);
    const start = last(b.log, 'match_start');
    ok(!!start, 'one ready player is enough — the warm-up does not gate the start');
    ok(
      !!start && start.ids.includes(a.id) && start.ids.includes(b.id),
      'and the start signal deploys BOTH of them',
      start ? `ids ${JSON.stringify(start.ids)}` : ''
    );
    ok(!!last(a.log, 'match_start'), 'the warming-up player is told to come in');
    ok(last(b.log, 'lobby')?.live === true, 'the room is live for the length of the countdown');
    a.ws.close();
    b.ws.close();
  }

  /* ── the same thing in the other order ─────────────────────────────────── */
  {
    // B is already ready and waiting when A decides to shoot bots. Stepping out
    // of the lobby is what completes B's ready set, so the start has to fire on
    // the deploy — otherwise B stands by for a start that can never come.
    const b = await open('warm2', 'B');
    const a = await open('warm2', 'A');
    await wait(300);
    b.send({ t: 'ready', ready: true });
    await wait(250);
    ok(!last(b.log, 'match_start'), 'B readying up with A idle in the lobby waits, correctly');
    a.send({ t: 'deploy', solo: true });
    await wait(250);
    ok(!!last(b.log, 'match_start'), 'and A warming up instead completes it rather than stalling it');
    a.ws.close();
    b.ws.close();
  }

  /* ── a real match does still lock the room ─────────────────────────────── */
  console.log('a real match');
  {
    const a = await open('real', 'A');
    await wait(200);
    a.send({ t: 'deploy' }); // no `solo` — this is the room's match
    await wait(200);
    const b = await open('real', 'B');
    await wait(250);
    ok(last(b.log, 'welcome')?.live === true, 'a player in the match DOES make the room live');
    b.send({ t: 'ready', ready: true });
    await wait(250);
    ok(!last(b.log, 'match_start'), 'and readying up cannot restart it under them');

    // …until the last player leaves, which is what the rematch call waits for.
    a.send({ t: 'undeploy' });
    await wait(250);
    ok(last(b.log, 'lobby')?.live === false, 'the last player out drops the room back to a lobby');
    ok(!last(b.log, 'match_start'), 'A is back in the lobby unready, so nothing starts yet');
    a.send({ t: 'ready', ready: true });
    await wait(250);
    ok(!!last(b.log, 'match_start'), 'B was still armed, so A readying starts the rematch');
    a.ws.close();
    b.ws.close();
  }

  /* ── one idle player must not block the room ───────────────────────────── */
  console.log('the forced start');
  {
    const a = await open('force', 'A');
    const b = await open('force', 'B');
    const c = await open('force', 'C');
    await wait(300);
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await wait(250);
    ok(!last(a.log, 'match_start'), 'two of three ready is not consensus');
    a.send({ t: 'ready', ready: true, force: true });
    await wait(250);
    const start = last(a.log, 'match_start');
    ok(!!start, 'a ready player can start without the one who wandered off');
    ok(
      !!start && start.ids.includes(a.id) && start.ids.includes(b.id) && !start.ids.includes(c.id),
      'and it deploys only the players who were ready',
      start ? `ids ${JSON.stringify(start.ids)}` : ''
    );
    ok(last(c.log, 'lobby')?.live === true, 'the idle player is left with a live room to drop into');
    a.ws.close();
    b.ws.close();
    c.ws.close();
  }

  /* ── "sure" / "yep" arrive seconds apart ───────────────────────────────── */
  console.log('the late arrival');
  {
    const a = await open('late', 'A');
    const b = await open('late', 'B');
    await wait(300);
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await wait(150);
    ok(!!last(a.log, 'match_start'), 'A and B start the countdown');

    const c = await open('late', 'C');
    await wait(250);
    ok(Number(last(c.log, 'welcome')?.startIn) > 0, 'C arrives mid-countdown and is told how long is left');
    const swept = last(c.log, 'match_start');
    ok(!!swept && swept.ids.includes(c.id), 'C is swept into the start rather than left in the lobby');
    ok(all(a.log, 'match_start').length === 2, 'and the room is re-issued the signal so everyone lands together');
    ok(Number(swept?.in) > 0, 'with a fresh countdown', `in ${swept?.in}ms`);
    a.ws.close();
    b.ws.close();
    c.ws.close();
  }

  /* ── the room's level ──────────────────────────────────────────────────── */
  console.log('the map, in a party');
  {
    const a = await open('maps', 'A', 'market');
    const b = await open('maps', 'B');
    await wait(300);
    a.send({ t: 'deploy', solo: true });
    await wait(200);
    b.send({ t: 'map', map: 'rust' });
    await wait(250);
    ok(last(b.log, 'lobby')?.map === 'rust', 'a warm-up does not freeze the map for everybody else');

    b.send({ t: 'ready', ready: true });
    await wait(200);
    // A is warm, so B readying starts a match. Use a fresh room for the rest.
    a.ws.close();
    b.ws.close();

    const c = await open('maps2', 'C', 'market');
    const d = await open('maps2', 'D');
    await wait(300);
    c.send({ t: 'ready', ready: true });
    await wait(150);
    c.send({ t: 'map', map: 'rust' });
    await wait(250);
    ok(who(d.log, 'C')?.ready === true, 'the player who changed the map keeps their own ready flag');
    ok(who(d.log, 'D')?.ready === false, 'and everybody else has to consent to the new level');
    ok(!last(d.log, 'match_start'), 'so a map change cannot sneak a match past them');
    c.ws.close();
    d.ws.close();
  }

  /* ── a warm-up is invisible to the match ───────────────────────────────── */
  console.log('warm-up isolation');
  {
    const a = await open('iso', 'A');
    const b = await open('iso', 'B');
    await wait(300);
    a.send({ t: 'deploy', solo: true });
    b.send({ t: 'deploy' });
    await wait(250);
    a.send({ t: 'state', s: { p: [1, 0, 1], hp: 100 } });
    b.send({ t: 'state', s: { p: [2, 0, 2], hp: 100 } });
    await wait(300);
    const seen = all(b.log, 'snapshot').at(-1)?.states ?? [];
    ok(
      seen.length > 0 && !seen.some((s) => s.id === a.id),
      'the match never sees the player warming up',
      `states ${JSON.stringify(seen.map((s) => s.id))}`
    );
    ok(all(a.log, 'snapshot').length === 0, 'and the warm-up never sees the match');

    a.send({ t: 'fire', o: [0, 0, 0], d: [0, 0, 1] });
    a.send({ t: 'hit', target: b.id, dmg: 90 });
    a.send({ t: 'kill', by: 0 });
    await wait(250);
    ok(all(b.log, 'fire').length === 0, 'a warm-up’s shots do not reach the match');
    ok(all(b.log, 'hit').length === 0, 'and cannot damage anybody in it');
    ok(all(b.log, 'kill').length === 0, 'a bot killing a warming-up player is not room news');
    ok(
      (last(b.log, 'score')?.roster ?? []).every((p) => p.deaths === 0),
      'and does not count against them on the scoreboard'
    );
    a.ws.close();
    b.ws.close();
  }

  await wait(150);
  console.log(fails ? `\n${fails} failure(s)` : '\nall lobby checks passed');
} finally {
  srv?.kill('SIGKILL');
}

process.exit(fails ? 1 : 0);
