#!/usr/bin/env node
/**
 * RELAY — player colour slots, checked against a real server on a real socket.
 *
 *   node server/skin.selftest.mjs
 *
 * Colour is how a player is identified in this game (`src/ai/livery.js`), so
 * "no two players in a room wear the same one" is a correctness property, not a
 * nicety — and the relay is the only party that can hold it, because it is the
 * only one that sees the whole room at once. The failure it exists to stop is
 * invisible in a room of one and obvious in a room of three, which is exactly
 * the case nobody tests by hand. Boots `server/index.mjs` on its own port,
 * joins several clients, and walks the assignment.
 *
 * `worker/room.js` mirrors this logic for the Cloudflare deploy; keep them in
 * step (see MULTIPLAYER.md).
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8801);
const srv = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stderr.on('data', (d) => process.stderr.write(d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(900);

function open(name, room = 'skintest') {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
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
      ws.send(JSON.stringify({ t: 'join', room, name }));
      res({ ws, log, send: (o) => ws.send(JSON.stringify(o)) });
    });
  });
}

const last = (log, t) => [...log].reverse().find((m) => m.t === t);
const all = (log, t) => log.filter((m) => m.t === t);
let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(
    `  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`
  );
  if (!cond) fails++;
};

try {
  const a = await open('A');
  await wait(300);
  const skinA = last(a.log, 'welcome')?.skin;
  ok(skinA === 0, 'the first player into a room gets slot 0', `got ${skinA}`);

  const b = await open('B');
  const c = await open('C');
  await wait(400);
  const skinB = last(b.log, 'welcome')?.skin;
  const skinC = last(c.log, 'welcome')?.skin;
  ok(
    new Set([skinA, skinB, skinC]).size === 3,
    'three players in a room get three different slots',
    `${skinA}/${skinB}/${skinC}`
  );

  ok(
    all(a.log, 'peer_join').every((m) => typeof m.skin === 'number'),
    'a join announcement carries the newcomer\'s slot'
  );
  const joinB = all(a.log, 'peer_join').find((m) => m.name === 'B');
  ok(joinB?.skin === skinB, 'and it is the same slot the newcomer was told', `${joinB?.skin} vs ${skinB}`);

  // Everyone else's colour has to be knowable from the roster alone, because a
  // late joiner never sees the `welcome` that assigned it.
  const peers = last(c.log, 'welcome')?.peers ?? [];
  ok(peers.length === 2, 'a late joiner is told about everybody already here', `${peers.length}`);
  ok(
    peers.every((p) => typeof p.skin === 'number') &&
      new Set(peers.map((p) => p.skin)).size === peers.length,
    'and the roster carries each of their slots, all distinct',
    peers.map((p) => p.skin).join(',')
  );
  ok(!peers.some((p) => p.skin === skinC), 'none of which is the late joiner\'s own');

  // Lowest-free, not a counter: B's colour has to come back when B leaves, or a
  // room that churns for an hour walks off the end of the twelve-hue palette.
  b.ws.close();
  await wait(400);
  const d = await open('D');
  await wait(300);
  ok(
    last(d.log, 'welcome')?.skin === skinB,
    'a leaver\'s slot is reused rather than the counter running on',
    `${last(d.log, 'welcome')?.skin} vs freed ${skinB}`
  );

  // A separate room is a separate palette — colours only have to be unique
  // among the people who can see each other.
  const e = await open('E', 'otherroom');
  await wait(300);
  ok(last(e.log, 'welcome')?.skin === 0, 'a different room starts again at slot 0');

  for (const p of [a, c, d, e]) p.ws.close();
} finally {
  srv.kill();
}

console.log(fails ? `\n\x1b[31m${fails} failed\x1b[0m\n` : '\n\x1b[32mrelay colour slots ok\x1b[0m\n');
process.exit(fails ? 1 : 0);
