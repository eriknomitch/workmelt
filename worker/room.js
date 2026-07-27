/**
 * Room — a Durable Object that is one multiplayer room.
 *
 * This is the Cloudflare-native port of the relay in `server/index.mjs`: the
 * Worker (worker/index.js) routes every `/ws?room=CODE` connection to the DO
 * whose name is CODE, so all players in a room share one instance and one bit of
 * state. The logic is identical — join / ready / deploy / state / fire / hit /
 * kill / chat, the match-start signal, and a ~20 Hz snapshot broadcast — it just
 * lives at the edge instead of on a Node box, and it holds no persistent storage
 * (a room is ephemeral by design).
 */

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.tickHz = Number(env.TICK_HZ ?? 20);
    this.maxRoom = Number(env.MAX_ROOM ?? 12);
    this.countdownMs = Number(env.COUNTDOWN_MS ?? 3000);

    /** ws -> peer */
    this.sessions = new Map();
    this.nextId = 1;
    /**
     * The room's level, as an opaque slug. The room does not know what maps
     * exist and must not: it stores whatever the clients agree on and hands it
     * back, and each client validates it against its own list. What it DOES own
     * is that there is one answer per room. Mirrors server/index.mjs.
     */
    this.map = null;
    this.tickHandle = null;
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const peer = {
      id: this.nextId++,
      ws: server,
      name: 'Operator',
      kills: 0,
      deaths: 0,
      /** Room-unique colour slot, assigned on join. See _takeSkin(). */
      skin: 0,
      pstate: null,
      alive: true,
      ready: false,
      deployed: false,
      lastSeen: Date.now(),
    };
    this.sessions.set(server, peer);

    server.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(typeof evt.data === 'string' ? evt.data : '');
      } catch {
        return;
      }
      peer.lastSeen = Date.now();
      this._handle(peer, msg);
    });
    const bye = () => this._leave(peer);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);

    this._send(peer, { t: 'hello', id: peer.id });
    this._ensureTick();

    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---- relay logic (mirrors server/index.mjs) ---- */

  _handle(peer, msg) {
    switch (msg.t) {
      case 'join': {
        peer.name = String(msg.name ?? 'Operator').slice(0, 20) || 'Operator';
        if (this.sessions.size > this.maxRoom) {
          this._send(peer, { t: 'full', max: this.maxRoom });
          try {
            peer.ws.close(1013, 'room full');
          } catch {}
          this.sessions.delete(peer.ws);
          return;
        }
        peer.skin = this._takeSkin(peer);
        peer.joined = true;
        // First one in picks the level; everybody after joins the one in progress.
        if (!this.map) this.map = sanitiseMap(msg.map);
        this._send(peer, {
          t: 'welcome',
          id: peer.id,
          room: msg.room ?? '',
          skin: peer.skin,
          tickHz: this.tickHz,
          live: this._isLive(),
          map: this.map,
          peers: this._roster().filter((p) => p.id !== peer.id),
        });
        this._broadcast({ t: 'peer_join', id: peer.id, name: peer.name, skin: peer.skin }, peer.id);
        this._sendLobby();
        break;
      }
      case 'map': {
        // Refused once anybody is deployed: swapping the map under a live match
        // would teleport everyone into a level that no longer exists. Ready
        // flags are cleared — you readied up for a level, and it is not that
        // level any more.
        if (this._isLive()) return;
        const next = sanitiseMap(msg.map);
        if (!next || next === this.map) return;
        this.map = next;
        for (const p of this.sessions.values()) p.ready = false;
        this._sendLobby();
        break;
      }
      case 'ready': {
        peer.ready = !!msg.ready;
        this._sendLobby();
        this._maybeStart();
        break;
      }
      case 'deploy': {
        peer.deployed = true;
        peer.ready = false;
        this._sendLobby();
        break;
      }
      case 'undeploy': {
        // "I went back to the lobby" — the pause menu's Leave match. Mirrors
        // the same case in server/index.mjs; without it a room stays LIVE
        // forever after the first person plays.
        peer.deployed = false;
        peer.ready = false;
        this._sendLobby();
        break;
      }
      case 'state': {
        peer.pstate = msg.s ?? null;
        if (peer.pstate && typeof peer.pstate.hp === 'number') peer.alive = peer.pstate.hp > 0;
        break;
      }
      case 'fire': {
        this._broadcast({ t: 'fire', id: peer.id, o: msg.o, d: msg.d, w: msg.w, seed: msg.seed }, peer.id);
        break;
      }
      case 'hit': {
        const victim = this._peerById(msg.target);
        if (!victim) return;
        this._send(victim, {
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
        peer.deaths++;
        const killer = this._peerById(msg.by);
        if (killer && killer.id !== peer.id) killer.kills++;
        this._broadcast({
          t: 'kill',
          by: msg.by,
          byName: killer?.name ?? '???',
          victim: peer.id,
          victimName: peer.name,
          headshot: !!msg.headshot,
        });
        this._broadcast({ t: 'score', roster: this._roster() });
        break;
      }
      case 'respawn':
        peer.alive = true;
        break;
      case 'spawn': {
        // Spawn claim — clients choose their own point (the relay has no map),
        // and this is what stops two simultaneous respawns landing on the same
        // ground. Advisory. Mirrors server/index.mjs.
        if (!Array.isArray(msg.p) || msg.p.length < 3) return;
        const p = msg.p.map(Number);
        if (!p.every(Number.isFinite)) return;
        this._broadcast({ t: 'spawn', id: peer.id, p }, peer.id);
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 200);
        if (text) this._broadcast({ t: 'chat', id: peer.id, name: peer.name, text });
        break;
      }
      case 'name': {
        peer.name = String(msg.name ?? peer.name).slice(0, 20) || peer.name;
        this._broadcast({ t: 'score', roster: this._roster() });
        break;
      }
      case 'ping':
        this._send(peer, { t: 'pong', ts: msg.ts });
        break;
    }
  }

  _leave(peer) {
    if (!this.sessions.has(peer.ws)) return;
    this.sessions.delete(peer.ws);
    try {
      peer.ws.close();
    } catch {}
    this._broadcast({ t: 'peer_leave', id: peer.id });
    this._broadcast({ t: 'score', roster: this._roster() });
    if (this.sessions.size === 0) {
      if (this.tickHandle) {
        clearInterval(this.tickHandle);
        this.tickHandle = null;
      }
      return;
    }
    // A departure can complete the ready set, or take the last deployed player
    // with it and drop the room back to a lobby.
    this._sendLobby();
    this._maybeStart();
  }

  /* ---- match-start lobby ----
   * Ready flags and the start signal are the only match state the room owns:
   * two clients cannot each decide when "everyone is ready" became true. A room
   * is live while any player is deployed, and a live room skips the ready flow
   * so a late joiner drops straight into the match. Mirrors server/index.mjs.
   */

  _isLive() {
    for (const p of this.sessions.values()) if (p.deployed) return true;
    return false;
  }

  _lobby() {
    const players = [];
    for (const p of this.sessions.values()) {
      players.push({ id: p.id, name: p.name, ready: !!p.ready, deployed: !!p.deployed });
    }
    return players;
  }

  _sendLobby() {
    this._broadcast({ t: 'lobby', live: this._isLive(), players: this._lobby(), map: this.map });
  }

  _maybeStart() {
    if (this._isLive()) return;
    const peers = [...this.sessions.values()];
    if (peers.length < 2 || !peers.every((p) => p.ready)) return;
    for (const p of peers) {
      p.deployed = true;
      p.ready = false;
    }
    this._broadcast({ t: 'match_start', in: this.countdownMs });
    this._sendLobby();
  }

  /* ---- snapshot tick ---- */

  _ensureTick() {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this._tick(), 1000 / this.tickHz);
  }

  _tick() {
    const states = [];
    for (const peer of this.sessions.values()) {
      if (!peer.pstate) continue;
      states.push({ id: peer.id, name: peer.name, s: peer.pstate });
    }
    if (states.length) this._broadcast({ t: 'snapshot', states });
  }

  /* ---- helpers ---- */

  _roster() {
    const out = [];
    for (const p of this.sessions.values()) {
      out.push({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        hp: p.pstate?.hp ?? 100,
        skin: p.skin,
      });
    }
    return out;
  }

  /**
   * The lowest colour slot nobody in this room is wearing. Mirrors `takeSkin`
   * in server/index.mjs — see the note there for why the relay owns this and a
   * client cannot.
   *
   * Only JOINED peers count: a socket that has connected but not sent `join`
   * has no colour yet, and letting its default block slot 0 would leave the
   * first real player in a fresh room wearing the second colour.
   */
  _takeSkin(self) {
    const used = new Set();
    for (const p of this.sessions.values()) if (p !== self && p.joined) used.add(p.skin);
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  _peerById(id) {
    for (const p of this.sessions.values()) if (p.id === id) return p;
    return null;
  }

  _send(peer, obj) {
    try {
      peer.ws.send(JSON.stringify(obj));
    } catch {}
  }

  _broadcast(obj, exceptId = null) {
    const msg = JSON.stringify(obj);
    for (const peer of this.sessions.values()) {
      if (peer.id === exceptId) continue;
      try {
        peer.ws.send(msg);
      } catch {}
    }
  }
}

/** Same slug filter as `sanitiseMap` in server/index.mjs — keep them identical. */
function sanitiseMap(v) {
  const s = String(v ?? '').slice(0, 24).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]*$/.test(s) ? s : null;
}
