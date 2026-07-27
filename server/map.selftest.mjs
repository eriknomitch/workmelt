#!/usr/bin/env node
/**
 * RELAY — the room's map, checked against a real server on a real socket.
 *
 *   node server/map.selftest.mjs
 *
 * The relay owns exactly two pieces of match state, and this is the newer one:
 * which level the room is on. The rules are small and all of them are the kind
 * that only bite in a room of two, which is precisely the case nobody tests by
 * hand — so it is worth a harness. Boots `server/index.mjs` on its own port,
 * joins two clients, and walks the protocol.
 *
 * `worker/room.js` mirrors this logic for the Cloudflare deploy; keep them in
 * step (see MULTIPLAYER.md).
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8799);
const srv = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stderr.on('data', (d) => process.stderr.write(d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(900);

function open(name, map) {
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
      ws.send(JSON.stringify({ t: 'join', room: 'selftest', name, map }));
      res({ ws, log, send: (o) => ws.send(JSON.stringify(o)) });
    });
  });
}

const last = (log, t) => [...log].reverse().find((m) => m.t === t);
let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(`  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) fails++;
};

try {
  const a = await open('A', 'rust');
  await wait(300);
  ok(last(a.log, 'welcome')?.map === 'rust', 'the first joiner sets the room map');

  const b = await open('B', 'market');
  await wait(300);
  ok(last(b.log, 'welcome')?.map === 'rust', 'a later joiner is told the ROOM map, not their own');
  ok(last(b.log, 'lobby')?.map === 'rust', 'and every lobby frame carries it');

  b.send({ t: 'ready', ready: true });
  await wait(200);
  b.send({ t: 'map', map: 'market' });
  await wait(300);
  ok(last(a.log, 'lobby')?.map === 'market', 'anybody can change it, and everybody hears about it');
  ok(
    (last(a.log, 'lobby')?.players ?? []).every((p) => !p.ready),
    'a change clears every ready flag — you readied up for a different level'
  );

  b.send({ t: 'map', map: '../../etc/passwd' });
  await wait(250);
  ok(last(a.log, 'lobby')?.map === 'market', 'a slug that is not a slug is ignored');

  a.send({ t: 'deploy' });
  await wait(250);
  b.send({ t: 'map', map: 'rust' });
  await wait(300);
  ok(last(a.log, 'lobby')?.map === 'market', 'and a change is refused once the match is live');

  a.ws.close();
  b.ws.close();
} finally {
  srv.kill();
}

console.log(fails ? `\n\x1b[31m${fails} failed\x1b[0m\n` : '\n\x1b[32mrelay map protocol ok\x1b[0m\n');
process.exit(fails ? 1 : 0);
