#!/usr/bin/env node
/**
 * RELAY — the bounded match, checked against a real server on a real socket.
 *
 *   node server/bounds.selftest.mjs
 *
 * Every room match is a bounded free-for-all: first to SCORE_LIMIT kills wins,
 * MATCH_MS is the cap after which the leader wins on time, and the relay is the
 * referee because the relay owns the score. This walks the whole life of that
 * rule — the fresh scoreline at the horn, the `match_end` on the winning kill,
 * the room un-living so the rematch flow works, and the clock — with limits
 * shrunk by env so the time cap is testable without a five-minute harness.
 *
 * `worker/room.js` mirrors this logic for the Cloudflare deploy; point
 * RELAY_URL at it to run the same checks there (see lobby.selftest.mjs — but
 * note the DO's limits are whatever its env says, so the time-cap section is
 * skipped there unless SCORE_LIMIT/MATCH_MS are shrunk to match).
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8802);
const COUNTDOWN_MS = 500;
const SCORE_LIMIT = 3;
const MATCH_MS = 10_000; // relay clamps anything under 10 s up to it
const RELAY_URL = process.env.RELAY_URL ?? null;
const srv = RELAY_URL
  ? null
  : spawn(process.execPath, ['server/index.mjs'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        COUNTDOWN_MS: String(COUNTDOWN_MS),
        MAX_START_MS: String(COUNTDOWN_MS * 3),
        SCORE_LIMIT: String(SCORE_LIMIT),
        MATCH_MS: String(MATCH_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
srv?.stderr.on('data', (d) => process.stderr.write(d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(900);

function open(room, name, map = 'market') {
  return new Promise((res, rej) => {
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
        get id() {
          return last(log, 'welcome')?.id ?? null;
        },
      });
    });
  });
}

const last = (log, t) => [...log].reverse().find((m) => m.t === t);
const all = (log, t) => log.filter((m) => m.t === t);

/** Ready both, ride out the countdown, deploy both — a room match, running. */
async function startMatch(a, b) {
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await wait(COUNTDOWN_MS + 300);
  a.send({ t: 'deploy' });
  b.send({ t: 'deploy' });
  await wait(200);
}

let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(`  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) fails++;
};

try {
  /* ── the score limit ends the match ────────────────────────────────────── */
  console.log('the score limit');
  {
    const a = await open('score', 'A');
    const b = await open('score', 'B');
    await wait(300);
    await startMatch(a, b);
    const started = last(a.log, 'match_start') ?? {};
    ok(started.limit === SCORE_LIMIT, 'the start signal states the kill target', `limit ${started.limit}`);
    ok(Number(started.ms) >= MATCH_MS, 'and the time cap', `ms ${started.ms}`);

    // B dies to A, SCORE_LIMIT times. The victim reports its own death.
    for (let i = 0; i < SCORE_LIMIT - 1; i++) b.send({ t: 'kill', by: a.id });
    await wait(250);
    ok(!last(a.log, 'match_end'), 'one kill short of the target ends nothing');
    b.send({ t: 'kill', by: a.id });
    await wait(250);
    const end = last(b.log, 'match_end');
    ok(!!end, 'the limit-th kill ends the match');
    ok(end?.reason === 'score' && end?.winner === a.id, 'on score, and the killer wins', `winner ${end?.winner}`);
    ok(
      Array.isArray(end?.standings) && end.standings[0]?.id === a.id && end.standings[0]?.kills === SCORE_LIMIT,
      'the standings lead with the winner at the target',
      JSON.stringify(end?.standings)
    );
    ok(last(b.log, 'lobby')?.live === false, 'and the room is no longer live — the rematch flow is open');

    // The rematch is a fresh scoreline, or the horn would end it instantly.
    await startMatch(a, b);
    const score = last(a.log, 'score');
    ok(
      (score?.roster ?? []).every((p) => p.kills === 0 && p.deaths === 0),
      'a rematch starts everyone back at zero',
      JSON.stringify(score?.roster?.map((p) => [p.kills, p.deaths]))
    );
    b.send({ t: 'kill', by: a.id });
    await wait(250);
    ok(!last(a.log, 'match_end')?.standings?.[0] || all(a.log, 'match_end').length === 1,
      'so one kill into the rematch ends nothing');
    a.ws.close();
    b.ws.close();
  }

  /* ── leaving mid-match must not strand the clock ───────────────────────── */
  console.log('the abandoned match');
  {
    const a = await open('leave', 'A');
    const b = await open('leave', 'B');
    await wait(300);
    await startMatch(a, b);
    a.send({ t: 'undeploy' });
    b.send({ t: 'undeploy' });
    await wait(250);
    ok(last(a.log, 'lobby')?.live === false, 'everyone walking out drops the room back to a lobby');
    ok(all(a.log, 'match_end').length === 0, 'without a ceremony nobody is there to see');
    a.ws.close();
    b.ws.close();
  }

  /* ── the time cap ends the match with a winner ─────────────────────────── */
  if (RELAY_URL) {
    console.log('the time cap — skipped (RELAY_URL set; the remote relay owns its own limits)');
  } else {
    console.log('the time cap');
    const a = await open('time', 'A');
    const b = await open('time', 'B');
    await wait(300);
    await startMatch(a, b);
    const welcomeMid = await open('time', 'C');
    await wait(250);
    ok(
      Number(last(welcomeMid.log, 'welcome')?.matchLeft) > 0,
      'a late arrival is told how much match is left',
      `matchLeft ${last(welcomeMid.log, 'welcome')?.matchLeft}`
    );
    welcomeMid.ws.close();
    b.send({ t: 'kill', by: a.id }); // A leads 1-0
    // MATCH_MS runs from the countdown's end; we are ~1 s into ~10.5 s.
    await wait(MATCH_MS + COUNTDOWN_MS);
    const end = last(a.log, 'match_end');
    ok(!!end, 'full time ends the match');
    ok(end?.reason === 'time', 'on time', `reason ${end?.reason}`);
    ok(end?.winner === a.id, 'and the leader on kills takes it', `winner ${end?.winner}`);
    a.ws.close();
    b.ws.close();
  }

  await wait(150);
  console.log(fails ? `\n${fails} failure(s)` : '\nall bounded-match checks passed');
} finally {
  srv?.kill('SIGKILL');
}

process.exit(fails ? 1 : 0);
