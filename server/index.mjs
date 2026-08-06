#!/usr/bin/env node
/**
 * Workmelt — multiplayer relay + static host.
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
 * The one exception to "pure relay" is the match-start lobby: ready flags and
 * the start signal live here, because two clients cannot each decide on their
 * own when "everyone is ready" became true. See maybeStart().
 *
 * Env:
 *   PORT          listen port (default 8787; hosts set this for you)
 *   TICK_HZ       snapshot broadcast rate (default 20)
 *   MAX_ROOM      max players per room (default 12)
 *   COUNTDOWN_MS  pre-match countdown once everyone is ready (default 3000)
 *   MAX_START_MS  how long a start signal may be pushed back to sweep in late
 *                 arrivals (default 3× COUNTDOWN_MS)
 *   SCORE_LIMIT   kills that win a match outright (default 15)
 *   MATCH_MS      match length before the leader wins on time (default 5 min)
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
/** Pre-match countdown, in ms. Broadcast once, counted down by every client. */
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS ?? 3000);
/**
 * The outer edge of a start. A player who arrives while the countdown is
 * running is swept into it and the clock is pushed back to a full countdown so
 * everybody lands together — but never past this much after the first signal,
 * or a room where somebody keeps reloading the page never starts at all.
 */
const MAX_START_MS = Number(process.env.MAX_START_MS ?? COUNTDOWN_MS * 3);
/**
 * Every match is a bounded free-for-all: first to SCORE_LIMIT kills wins, and
 * MATCH_MS is the outer edge — when it expires the leader wins on time. The
 * defaults are sized for a quick match during a work break: 15 kills is a few
 * minutes of honest shooting in a small room, and five minutes caps it even
 * when everybody is hiding.
 */
const SCORE_LIMIT = Math.max(1, Number(process.env.SCORE_LIMIT ?? 15));
const MATCH_MS = Math.max(10_000, Number(process.env.MATCH_MS ?? 5 * 60_000));
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
    r = {
      code,
      peers: new Map() /* id -> Peer */,
      map: null,
      /** When the in-flight countdown ends (ms epoch). 0 when not starting. */
      startAt: 0,
      /** The latest `startAt` this start may be pushed back to. See MAX_START_MS. */
      startCap: 0,
      /** Peer ids this start deploys — everyone else stays in the lobby. */
      starting: new Set(),
      /** When the running match ends on time (ms epoch). 0 while no match. */
      matchUntil: 0,
    };
    rooms.set(code, r);
  }
  return r;
}

function roster(room) {
  const out = [];
  for (const p of room.peers.values()) {
    out.push({
      id: p.id,
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      hp: p.state?.hp ?? 100,
      skin: p.skin,
    });
  }
  return out;
}

/**
 * The lowest colour slot nobody in this room is wearing.
 *
 * Colour is how a player is identified in this game, so two players in one room
 * may not share one — and the relay is the only party that can guarantee that,
 * because it is the only one that sees the whole room at once. Clients cannot:
 * two of them picking "the lowest slot I have not seen" race on a simultaneous
 * join and both pick the same.
 *
 * Lowest-free rather than a counter, so the slot a leaver frees is reused and a
 * long-lived room never walks off the end of the client's curated palette.
 * `MAX_ROOM` is 12 and so is that palette, so a full room is always covered.
 */
function takeSkin(room) {
  const used = new Set();
  for (const p of room.peers.values()) used.add(p.skin);
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

/* ── lobby / match start ──────────────────────────────────────────────────
 * The relay owns exactly one piece of match state: who has readied up, and
 * whether anyone is in the match. It stays a relay — it does not simulate — but
 * the start signal has to come from one place or two clients would each count
 * down from their own idea of "everyone is ready".
 *
 * WARM-UP IS NOT A MATCH. There are two ways to be deployed, and telling them
 * apart is what makes the invite flow work:
 *
 *   WARM  you pressed Play while waiting for people — a private bot game. It is
 *         invisible to the room (no snapshots either way, no hits, no score) and
 *         it does NOT make the room live. Whoever arrives on your link still
 *         gets the ready flow, and when the countdown fires you are pulled out
 *         of it and into the match with them.
 *   MATCH you are in the room's match. THIS is what makes a room live.
 *
 * Before that distinction existed, the first player pressing the lobby's own
 * primary button locked the room into "match in progress" for good: everybody
 * who followed the link was offered "deploy now" against a garrison only the
 * first player could see, the map was frozen, and the only way back to a real
 * shared start was for every single player to leave the match first. That is
 * the bug this split fixes.
 *
 * A room is LIVE while anybody is in the match, and also for the length of a
 * start signal, so a player who arrives during the 3-2-1 is swept into the same
 * countdown rather than dropped into a match that is one second old.
 */

function lobby(room) {
  const players = [];
  for (const p of room.peers.values()) {
    players.push({
      id: p.id,
      name: p.name,
      ready: !!p.ready,
      deployed: !!p.deployed,
      warm: !!p.warm,
    });
  }
  return players;
}

/** In the room's match — as opposed to a private warm-up against bots. */
function inMatch(p) {
  return !!p.deployed && !p.warm;
}

/** ms left on the in-flight start signal, 0 when there is none. */
function startRemaining(room) {
  return Math.max(0, room.startAt - Date.now());
}

function isLive(room) {
  if (startRemaining(room) > 0) return true;
  for (const p of room.peers.values()) if (inMatch(p)) return true;
  return false;
}

function sendLobby(room) {
  broadcast(room, { t: 'lobby', live: isLive(room), players: lobby(room), map: room.map });
}

/**
 * The room's map.
 *
 * The relay does not know what maps exist and must not: it stores whatever slug
 * the clients agree on and hands it back, and each client validates the id
 * against its own list. What the relay DOES own is that there is one answer per
 * room — two players cannot ready up on different levels.
 *
 * The first player into a room sets it; after that a change is an explicit
 * request, and only while the match has not started.
 */
function sanitiseMap(v) {
  const s = String(v ?? '').slice(0, 24).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]*$/.test(s) ? s : null;
}

/**
 * Start the match if the room is ready for one.
 *
 * The condition is "everybody who is looking at the lobby has readied up",
 * which is not the same as "everybody has readied up": a player warming up
 * against bots cannot see the lobby to press the button, and pressing Play was
 * never a request to be left out of the match. So warm-ups do not gate the
 * start — they are pulled into it.
 *
 * `force` is the escape hatch for the other failure the old rule had: one player
 * who joins and wanders off used to block a room full of ready players forever.
 * Any ready player may then start with the ready set, and the rest keep the
 * lobby's "deploy now".
 */
function maybeStart(room, force = false) {
  if (isLive(room)) return;
  const peers = [...room.peers.values()];
  if (peers.length < 2) return;
  // Those who can actually see the lobby, and so can actually consent.
  const inLobby = peers.filter((p) => !p.deployed);
  const ready = peers.filter((p) => p.ready);
  const consensus = inLobby.length > 0 && inLobby.every((p) => p.ready);
  if (!consensus && !(force && ready.length >= 2)) return;
  // Warm-ups come along; unready lobby players only when there is consensus,
  // which by definition means there are none.
  const cohort = peers.filter((p) => p.ready || p.warm);
  if (cohort.length < 2) return;
  startMatch(room, cohort);
}

/**
 * Fire one start signal.
 *
 * The peers are NOT marked deployed here — `room.startAt` is what makes the room
 * live for the length of the countdown, and each client confirms with `deploy`
 * when its own 3-2-1 reaches zero. That is what lets `join` add a late arrival
 * to a start that is already in flight.
 */
function startMatch(room, cohort) {
  const now = Date.now();
  room.startAt = now + COUNTDOWN_MS;
  room.startCap = now + MAX_START_MS;
  room.starting = new Set(cohort.map((p) => p.id));
  // A match is a fresh scoreline for everyone in it — the last match's kills
  // must not put anybody one shot from the score limit at the horn.
  for (const p of cohort) {
    p.ready = false;
    p.kills = 0;
    p.deaths = 0;
  }
  // The clock runs from the moment players are actually on the floor.
  room.matchUntil = room.startAt + MATCH_MS;
  broadcast(room, {
    t: 'match_start',
    in: COUNTDOWN_MS,
    ids: [...room.starting],
    limit: SCORE_LIMIT,
    ms: MATCH_MS,
  });
  broadcast(room, { t: 'score', roster: roster(room) });
  sendLobby(room);
}

/**
 * The match's final order: kills decide, fewer deaths breaks a tie, and the
 * relay id (join order) keeps the sort stable. Time-expiry declares the top
 * row the winner only when it actually beats the second — otherwise the match
 * is a draw and says so, rather than crowning whoever joined first.
 */
function standings(room) {
  return [...room.peers.values()]
    .filter((p) => inMatch(p))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
    .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, skin: p.skin }));
}

/**
 * End the room's match: one authoritative signal, like the start.
 *
 * Everybody in the match is undeployed here rather than waiting on each
 * client's `undeploy` — the room must stop being LIVE the moment the match
 * ends, or a player closing the tab during the ceremony would hold the map
 * locked and the ready flow shut for everyone else. Clients treat `match_end`
 * as the relay having already stepped them out.
 */
function endMatch(room, reason, winnerId) {
  const rows = standings(room);
  if (!rows.length) return;
  broadcast(room, {
    t: 'match_end',
    reason,
    winner: winnerId ?? null,
    limit: SCORE_LIMIT,
    ms: MATCH_MS,
    standings: rows,
  });
  room.matchUntil = 0;
  for (const p of room.peers.values()) {
    if (!inMatch(p)) continue;
    p.deployed = false;
    p.warm = false;
    p.ready = false;
  }
  sendLobby(room);
  // A ready set may already be armed for the rematch (players who left early
  // and pressed "ready up for the next match") — the end is what unblocks it.
  maybeStart(room);
}

/** Kill-target check, called on every confirmed kill. */
function maybeEndOnScore(room, killer) {
  if (killer && inMatch(killer) && killer.kills >= SCORE_LIMIT) {
    endMatch(room, 'score', killer.id);
  }
}

/** Time check, called from the tick. The leader wins; a dead heat is a draw. */
function maybeEndOnTime(room) {
  if (!room.matchUntil || Date.now() < room.matchUntil) return;
  if (startRemaining(room) > 0) return; // still counting down — clock not live
  const rows = standings(room);
  if (!rows.length) {
    room.matchUntil = 0;
    return;
  }
  const [a, b] = rows;
  const winner = !b || a.kills > b.kills || (a.kills === b.kills && a.deaths < b.deaths) ? a.id : null;
  endMatch(room, 'time', winner);
}

/**
 * Somebody arrived mid-countdown. Sweep them in and give the room a full
 * countdown again so the party lands together — bounded by `startCap`, so this
 * cannot be pushed back forever.
 */
function extendStart(room) {
  const now = Date.now();
  room.startAt = Math.max(room.startAt, Math.min(now + COUNTDOWN_MS, room.startCap));
  return startRemaining(room);
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

/**
 * Broadcast to the room's MATCH — everyone except the players warming up.
 *
 * Every gameplay message goes out this way, which is what makes a warm-up
 * private in both directions: a player shooting bots while waiting for friends
 * is not a target, does not appear in anybody's world, and cannot see the match
 * that is running around him. Room-level traffic (lobby, chat, roster, joins)
 * still reaches everybody — he is in the room, just not in the fight.
 */
function broadcastMatch(room, obj, exceptId = null) {
  const msg = JSON.stringify(obj);
  for (const p of room.peers.values()) {
    if (p.id === exceptId || p.warm) continue;
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
    /** Room-unique colour slot, assigned on join. See takeSkin(). */
    skin: 0,
    state: null,
    alive: true,
    /** readied up in the match-start lobby */
    ready: false,
    /** out of the lobby: in the room's match, or warming up against bots */
    deployed: false,
    /**
     * Deployed into a PRIVATE bot game rather than the room's match. Invisible
     * to the room in both directions, and does not make the room live — see the
     * lobby section above.
     */
    warm: false,
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
      // Before the insert: `takeSkin` reads the room, and this peer is not one
      // of the players it has to avoid.
      peer.skin = takeSkin(room);
      room.peers.set(peer.id, peer);
      // First one in picks the level; everybody after joins the one in progress.
      if (!room.map) room.map = sanitiseMap(msg.map);
      // Tell the newcomer who they are + who's already here.
      send(peer, {
        t: 'welcome',
        id: peer.id,
        room: code,
        skin: peer.skin,
        tickHz: TICK_HZ,
        live: isLive(room),
        map: room.map,
        // Non-zero when a countdown is already running: this player is joining
        // it, not the match it is about to become.
        startIn: startRemaining(room),
        // The bounded-match contract, so a client walking into a live match
        // can paint the score target and the clock without waiting for a kill.
        limit: SCORE_LIMIT,
        matchLeft: room.matchUntil ? Math.max(0, room.matchUntil - Date.now()) : 0,
        peers: roster(room).filter((p) => p.id !== peer.id),
      });
      // Announce to everyone else.
      broadcast(room, { t: 'peer_join', id: peer.id, name: peer.name, skin: peer.skin }, peer.id);
      // "Sure" — "yep" — "gimme a sec": arrivals in a party are seconds apart,
      // so a start that is still counting down takes the new one with it.
      if (startRemaining(room) > 0) {
        room.starting.add(peer.id);
        broadcast(room, { t: 'match_start', in: extendStart(room), ids: [...room.starting] });
      }
      sendLobby(room);
      break;
    }

    case 'map': {
      // Change the room's level. Refused once the room is live — swapping the
      // map under a match would teleport everyone into a level that no longer
      // exists. A warm-up does NOT block it: it is one player's private bot
      // game, and that client steps back to the lobby and rebuilds.
      //
      // Ready flags are cleared, because you readied up for a level and it is
      // not that level any more — but not the chooser's. They are the one player
      // in the room who has just said what they want to play.
      const room = peer.room && rooms.get(peer.room);
      if (!room || isLive(room)) return;
      const next = sanitiseMap(msg.map);
      if (!next || next === room.map) return;
      room.map = next;
      for (const p of room.peers.values()) if (p.id !== peer.id) p.ready = false;
      sendLobby(room);
      break;
    }

    case 'ready': {
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      peer.ready = !!msg.ready;
      sendLobby(room);
      maybeStart(room, !!msg.force && peer.ready);
      break;
    }

    case 'deploy': {
      // "I am in the match now" — a client's pre-match countdown reached zero,
      // or it pressed deploy-now on a live room. `solo` marks the other case:
      // a private warm-up against bots, which is not the room's match.
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      peer.deployed = true;
      peer.warm = !!msg.solo;
      peer.ready = false;
      room.starting.delete(peer.id);
      if (inMatch(peer)) {
        // Entering the match is entering its scoreline at zero — this is the
        // late "deploy now" joiner, whose last match must not follow them in.
        peer.kills = 0;
        peer.deaths = 0;
        // The first body on the floor is what starts the clock when a match
        // forms without a start signal (a lone player deploying into a live-
        // from-elsewhere room, or an old client). A running clock is kept.
        if (!room.matchUntil) room.matchUntil = Date.now() + MATCH_MS;
        broadcast(room, { t: 'score', roster: roster(room) });
      }
      sendLobby(room);
      // Stepping out of the lobby can complete the ready set: the players left in
      // it were waiting on everybody in the lobby, and there is now one fewer.
      // Without this, somebody starting a warm-up next to a player who is already
      // ready leaves that player standing by for a start that has to happen.
      maybeStart(room);
      break;
    }

    case 'undeploy': {
      // "I went back to the lobby" — the pause menu's Leave match. Without it a
      // room stays LIVE forever after the first person plays, and everyone who
      // came back would be offered "deploy now" instead of a fresh setup.
      const room = peer.room && rooms.get(peer.room);
      if (!room) return;
      peer.deployed = false;
      peer.warm = false;
      peer.ready = false;
      room.starting.delete(peer.id);
      // The last player out takes the match with them — the clock must not
      // keep running against an empty floor and end a match nobody is in.
      if (!isLive(room)) room.matchUntil = 0;
      sendLobby(room);
      // The last player out of a match un-lives the room, which can complete a
      // ready set that has been waiting for exactly that.
      maybeStart(room);
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
      if (!room || peer.warm) return;
      broadcastMatch(room, { t: 'fire', id: peer.id, o: msg.o, d: msg.d, w: msg.w, seed: msg.seed }, peer.id);
      break;
    }

    case 'hit': {
      // Trust-the-shooter: forward the claim to the victim, who applies it.
      const room = peer.room && rooms.get(peer.room);
      if (!room || peer.warm) return;
      const victim = room.peers.get(msg.target);
      // Nobody may shoot a warm-up and a warm-up may not shoot anybody: the two
      // are not in the same match. Neither side can even see the other, so this
      // only ever catches a claim that crossed a deploy.
      if (!victim || victim.warm) return;
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
      // A warm-up death is a bot's work in a game nobody else is in; it must not
      // reach the room's killfeed or inflate the reporter's death count.
      const room = peer.room && rooms.get(peer.room);
      if (!room || peer.warm) return;
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
      maybeEndOnScore(room, killer);
      break;
    }

    case 'respawn': {
      peer.alive = true;
      break;
    }

    case 'spawn': {
      // "I am coming in here." Clients pick their own spawn points (the relay
      // has no map), so the announcement is what stops two respawns that land
      // on the same tick choosing the same ground. Advisory, like every other
      // gameplay claim on this relay — see src/world/spawns.js.
      const room = peer.room && rooms.get(peer.room);
      if (!room || peer.warm || !Array.isArray(msg.p) || msg.p.length < 3) return;
      const p = msg.p.map(Number);
      if (!p.every(Number.isFinite)) return;
      broadcastMatch(room, { t: 'spawn', id: peer.id, p }, peer.id);
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
  room.starting.delete(peer.id);
  broadcast(room, { t: 'peer_leave', id: peer.id });
  broadcast(room, { t: 'score', roster: roster(room) });
  if (room.peers.size === 0) {
    rooms.delete(room.code);
    return;
  }
  // Someone leaving can complete the ready set — or empty out the last deployed
  // player, which drops the room back to a lobby for whoever is still here.
  if (!isLive(room)) room.matchUntil = 0;
  sendLobby(room);
  maybeStart(room);
}

/* ────────────────────────────────────────────────────────────────────────
 * Server tick: fan out each room's latest transforms as one snapshot.
 * ──────────────────────────────────────────────────────────────────────── */

setInterval(() => {
  for (const room of rooms.values()) {
    maybeEndOnTime(room);
    const states = [];
    for (const p of room.peers.values()) {
      // A warm-up is private: its transform never enters the match, and the
      // match's transforms never reach it. See broadcastMatch().
      if (!p.state || p.warm) continue;
      states.push({ id: p.id, name: p.name, s: p.state });
    }
    if (states.length) broadcastMatch(room, { t: 'snapshot', states });
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
