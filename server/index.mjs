#!/usr/bin/env node
/**
 * Claude of Duty — multiplayer relay + static host.
 *
 * One process does two jobs so a deploy is a single service and the invite
 * link is same-origin:
 *
 *   1. Serves the built client from `dist/` (run `npm run build` first).
 *   2. Runs a WebSocket relay that groups players into rooms and forwards
 *      state / fire / hit / chat between everyone in the same room.
 *
 * It is a RELAY, not an authoritative simulation: each client owns its own
 * player and reports transform + events; the server fans them out. That keeps
 * the server cheap (a few KB/s per player) and is the right trade for a
 * friends-only free-for-all. Hit detection is trust-the-shooter — fine here,
 * and swappable later without touching the transport.
 *
 * Env:
 *   PORT        listen port (default 8787; hosts set this for you)
 *   TICK_HZ     snapshot broadcast rate (default 20)
 *   MAX_ROOM    max players per room (default 12)
 *
 * Run:  node server/index.mjs      (after `npm run build`)
 * Dev:  the vite client auto-connects to ws://<host>:8787 — just run this too.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_HZ = Number(process.env.TICK_HZ ?? 20);
const MAX_ROOM = Number(process.env.MAX_ROOM ?? 12);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

/* ────────────────────────────────────────────────────────────────────────
 * Static file server (serves the built game). Kept tiny and dependency-free.
 * ──────────────────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
};

async function sendFile(res, filePath) {
  const data = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    // Health check for hosting platforms.
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }

    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '') rel = '/index.html';
    let filePath = join(DIST, rel);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    let s = await stat(filePath).catch(() => null);
    if (s?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      s = await stat(filePath).catch(() => null);
    }
    if (s?.isFile()) {
      await sendFile(res, filePath);
      return;
    }

    // SPA fallback: unknown non-asset path -> index.html so ?room=… deep links work.
    if (!extname(rel)) {
      const idx = join(DIST, 'index.html');
      if (await stat(idx).catch(() => null)) {
        await sendFile(res, idx);
        return;
      }
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(
      'Not found. Did you run `npm run build`? The server hosts the built client from /dist.\n'
    );
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('server error: ' + (err?.message ?? err));
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * Room + relay layer.
 * ──────────────────────────────────────────────────────────────────────── */

/** roomCode -> Room */
const rooms = new Map();
let nextId = 1;

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { code, peers: new Map() /* id -> Peer */ };
    rooms.set(code, r);
  }
  return r;
}

function roster(room) {
  const out = [];
  for (const p of room.peers.values()) {
    out.push({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, hp: p.state?.hp ?? 100 });
  }
  return out;
}

function send(peer, obj) {
  if (peer.ws.readyState === peer.ws.OPEN) {
    peer.ws.send(JSON.stringify(obj));
  }
}

function broadcast(room, obj, exceptId = null) {
  const msg = JSON.stringify(obj);
  for (const p of room.peers.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const peer = {
    id: nextId++,
    ws,
    room: null,
    name: 'Operator',
    kills: 0,
    deaths: 0,
    state: null,
    alive: true,
    lastSeen: Date.now(),
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    peer.lastSeen = Date.now();
    handle(peer, msg);
  });

  ws.on('close', () => leave(peer));
  ws.on('error', () => leave(peer));

  // Nudge the client to identify itself.
  send(peer, { t: 'hello', id: peer.id });
});

function handle(peer, msg) {
  switch (msg.t) {
    case 'join': {
      const code = String(msg.room ?? 'lobby').slice(0, 24).toLowerCase();
      peer.name = String(msg.name ?? 'Operator').slice(0, 20) || 'Operator';
      const room = getRoom(code);
      if (room.peers.size >= MAX_ROOM) {
        send(peer, { t: 'full', room: code, max: MAX_ROOM });
        return;
      }
      peer.room = code;
      room.peers.set(peer.id, peer);
      // Tell the newcomer who they are + who's already here.
      send(peer, {
        t: 'welcome',
        id: peer.id,
        room: code,
        tickHz: TICK_HZ,
        peers: roster(room).filter((p) => p.id !== peer.id),
      });
      // Announce to everyone else.
      broadcast(room, { t: 'peer_join', id: peer.id, name: peer.name }, peer.id);
      break;
    }

    case 'state': {
      // Latest-wins transform snapshot; broadcast happens on the server tick.
      if (!peer.room) return;
      peer.state = msg.s ?? null;
      if (peer.state && typeof peer.state.hp === 'number') peer.alive = peer.state.hp > 0;
      break;
    }

    case 'fire': {
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      broadcast(room, { t: 'fire', id: peer.id, o: msg.o, d: msg.d, w: msg.w, seed: msg.seed }, peer.id);
      break;
    }

    case 'hit': {
      // Trust-the-shooter: forward the claim to the victim, who applies it.
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      const victim = room.peers.get(msg.target);
      if (!victim) return;
      send(victim, {
        t: 'hit',
        from: peer.id,
        fromName: peer.name,
        dmg: Math.max(0, Math.min(200, Number(msg.dmg) || 0)),
        part: msg.part ?? 'body',
        o: msg.o ?? null,
        w: msg.w ?? null,
      });
      break;
    }

    case 'kill': {
      // Victim confirms its own death and names the killer -> authoritative score.
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      peer.deaths++;
      const killer = room.peers.get(msg.by);
      if (killer && killer.id !== peer.id) killer.kills++;
      broadcast(room, {
        t: 'kill',
        by: msg.by,
        byName: killer?.name ?? '???',
        victim: peer.id,
        victimName: peer.name,
        headshot: !!msg.headshot,
      });
      broadcast(room, { t: 'score', roster: roster(room) });
      break;
    }

    case 'respawn': {
      peer.alive = true;
      break;
    }

    case 'chat': {
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      const text = String(msg.text ?? '').slice(0, 200);
      if (text) broadcast(room, { t: 'chat', id: peer.id, name: peer.name, text });
      break;
    }

    case 'name': {
      peer.name = String(msg.name ?? peer.name).slice(0, 20) || peer.name;
      const room = peer.room && rooms.get(peer.room);
      if (room) broadcast(room, { t: 'score', roster: roster(room) });
      break;
    }

    case 'ping':
      send(peer, { t: 'pong', ts: msg.ts });
      break;
  }
}

function leave(peer) {
  if (!peer.room) return;
  const room = rooms.get(peer.room);
  peer.room = null;
  if (!room) return;
  room.peers.delete(peer.id);
  broadcast(room, { t: 'peer_leave', id: peer.id });
  broadcast(room, { t: 'score', roster: roster(room) });
  if (room.peers.size === 0) rooms.delete(room.code);
}

/* ────────────────────────────────────────────────────────────────────────
 * Server tick: fan out each room's latest transforms as one snapshot.
 * ──────────────────────────────────────────────────────────────────────── */

setInterval(() => {
  for (const room of rooms.values()) {
    const states = [];
    for (const p of room.peers.values()) {
      if (!p.state) continue;
      states.push({ id: p.id, name: p.name, s: p.state });
    }
    if (states.length) broadcast(room, { t: 'snapshot', states });
  }
}, 1000 / TICK_HZ);

// Drop peers that have gone silent (dead sockets that never fired close).
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.peers.values()) {
      if (now - p.lastSeen > 30000) {
        try {
          p.ws.terminate();
        } catch {}
        leave(p);
      }
    }
  }
}, 10000);

server.listen(PORT, () => {
  console.log(`[cod-mp] relay + host listening on :${PORT}  (tick ${TICK_HZ}Hz, max ${MAX_ROOM}/room)`);
  console.log(`[cod-mp] serving built client from ${DIST}`);
});
