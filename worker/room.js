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
    /** How far a start may be pushed back to sweep in late arrivals. */
    this.maxStartMs = Number(env.MAX_START_MS ?? this.countdownMs * 3);
    /**
     * Bounded free-for-all: first to `scoreLimit` kills wins, `matchMs` is the
     * time cap after which the leader wins. Sized for a quick work-break match.
     * Mirrors SCORE_LIMIT / MATCH_MS in server/index.mjs.
     */
    this.scoreLimit = Math.max(1, Number(env.SCORE_LIMIT ?? 15));
    this.matchMs = Math.max(10_000, Number(env.MATCH_MS ?? 5 * 60_000));

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
    /** When the in-flight countdown ends (ms epoch); 0 when not starting. */
    this.startAt = 0;
    /** The latest `startAt` this start may be pushed back to. */
    this.startCap = 0;
    /** Peer ids this start deploys — everyone else stays in the lobby. */
    this.starting = new Set();
    /** When the running match ends on time (ms epoch). 0 while no match. */
    this.matchUntil = 0;
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
      /** Deployed into a private bot game, not the room's match. See _isLive(). */
      warm: false,
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
          startIn: this._startRemaining(),
          // The bounded-match contract, for a client joining a live match.
          limit: this.scoreLimit,
          matchLeft: this.matchUntil ? Math.max(0, this.matchUntil - Date.now()) : 0,
          peers: this._roster().filter((p) => p.id !== peer.id),
        });
        this._broadcast({ t: 'peer_join', id: peer.id, name: peer.name, skin: peer.skin }, peer.id);
        // A start already counting down takes the new arrival with it.
        if (this._startRemaining() > 0) {
          this.starting.add(peer.id);
          this._broadcast({ t: 'match_start', in: this._extendStart(), ids: [...this.starting] });
        }
        this._sendLobby();
        break;
      }
      case 'map': {
        // Refused once the room is live: swapping the map under a match would
        // teleport everyone into a level that no longer exists. A warm-up does
        // not block it — that client steps back to the lobby and rebuilds.
        // Ready flags are cleared, except the chooser's: they have just said
        // what they want to play. Mirrors server/index.mjs.
        if (this._isLive()) return;
        const next = sanitiseMap(msg.map);
        if (!next || next === this.map) return;
        this.map = next;
        for (const p of this.sessions.values()) if (p.id !== peer.id) p.ready = false;
        this._sendLobby();
        break;
      }
      case 'ready': {
        peer.ready = !!msg.ready;
        this._sendLobby();
        this._maybeStart(!!msg.force && peer.ready);
        break;
      }
      case 'deploy': {
        // `solo` = a private warm-up against bots rather than the room's match.
        peer.deployed = true;
        peer.warm = !!msg.solo;
        peer.ready = false;
        this.starting.delete(peer.id);
        if (peer.deployed && !peer.warm) {
          // A late joiner enters the match's scoreline at zero, and the first
          // body on the floor starts the clock when no start signal set one.
          peer.kills = 0;
          peer.deaths = 0;
          if (!this.matchUntil) this.matchUntil = Date.now() + this.matchMs;
          this._broadcast({ t: 'score', roster: this._roster() });
        }
        this._sendLobby();
        // Stepping out of the lobby can complete the ready set — see the note on
        // the same call in server/index.mjs.
        this._maybeStart();
        break;
      }
      case 'undeploy': {
        // "I went back to the lobby" — the pause menu's Leave match. Mirrors
        // the same case in server/index.mjs; without it a room stays LIVE
        // forever after the first person plays.
        peer.deployed = false;
        peer.warm = false;
        peer.ready = false;
        this.starting.delete(peer.id);
        // The clock must not keep running against an empty floor.
        if (!this._isLive()) this.matchUntil = 0;
        this._sendLobby();
        // The last player out of a match can complete a waiting ready set.
        this._maybeStart();
        break;
      }
      case 'state': {
        peer.pstate = msg.s ?? null;
        if (peer.pstate && typeof peer.pstate.hp === 'number') peer.alive = peer.pstate.hp > 0;
        break;
      }
      case 'fire': {
        if (peer.warm) return;
        this._broadcastMatch({ t: 'fire', id: peer.id, o: msg.o, d: msg.d, w: msg.w, seed: msg.seed }, peer.id);
        break;
      }
      case 'hit': {
        if (peer.warm) return;
        const victim = this._peerById(msg.target);
        // A warm-up is in nobody's match: it can neither shoot nor be shot.
        if (!victim || victim.warm) return;
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
        // A warm-up death is a bot's work in a game nobody else is in.
        if (peer.warm) return;
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
        if (killer && killer.deployed && !killer.warm && killer.kills >= this.scoreLimit) {
          this._endMatch('score', killer.id);
        }
        break;
      }
      case 'respawn':
        peer.alive = true;
        break;
      case 'spawn': {
        // Spawn claim — clients choose their own point (the relay has no map),
        // and this is what stops two simultaneous respawns landing on the same
        // ground. Advisory. Mirrors server/index.mjs.
        if (peer.warm || !Array.isArray(msg.p) || msg.p.length < 3) return;
        const p = msg.p.map(Number);
        if (!p.every(Number.isFinite)) return;
        this._broadcastMatch({ t: 'spawn', id: peer.id, p }, peer.id);
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
    this.starting.delete(peer.id);
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
    if (!this._isLive()) this.matchUntil = 0;
    this._sendLobby();
    this._maybeStart();
  }

  /* ---- match-start lobby ----
   * Ready flags and the start signal are the only match state the room owns:
   * two clients cannot each decide when "everyone is ready" became true.
   *
   * A room is live while any player is IN THE MATCH — which a warm-up against
   * bots is not: that is a private game, invisible to the room, and it leaves
   * the ready flow open for whoever follows the invite link. It is also live for
   * the length of a start signal, so an arrival mid-countdown joins the
   * countdown. Mirrors server/index.mjs — read the long note there.
   */

  _startRemaining() {
    return Math.max(0, this.startAt - Date.now());
  }

  _isLive() {
    if (this._startRemaining() > 0) return true;
    for (const p of this.sessions.values()) if (p.deployed && !p.warm) return true;
    return false;
  }

  _lobby() {
    const players = [];
    for (const p of this.sessions.values()) {
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

  _sendLobby() {
    this._broadcast({ t: 'lobby', live: this._isLive(), players: this._lobby(), map: this.map });
  }

  /**
   * Start when everybody who can SEE the lobby has readied up. A warm-up player
   * cannot, and pressing Play was never a request to be left out — so warm-ups
   * do not gate the start, they are pulled into it. `force` starts with the ready
   * set instead, so one player who wanders off cannot block the room.
   */
  _maybeStart(force = false) {
    if (this._isLive()) return;
    const peers = [...this.sessions.values()];
    if (peers.length < 2) return;
    const inLobby = peers.filter((p) => !p.deployed);
    const ready = peers.filter((p) => p.ready);
    const consensus = inLobby.length > 0 && inLobby.every((p) => p.ready);
    if (!consensus && !(force && ready.length >= 2)) return;
    const cohort = peers.filter((p) => p.ready || p.warm);
    if (cohort.length < 2) return;
    const now = Date.now();
    this.startAt = now + this.countdownMs;
    this.startCap = now + this.maxStartMs;
    this.starting = new Set(cohort.map((p) => p.id));
    // A match is a fresh scoreline; the clock runs from the countdown's end.
    for (const p of cohort) {
      p.ready = false;
      p.kills = 0;
      p.deaths = 0;
    }
    this.matchUntil = this.startAt + this.matchMs;
    this._broadcast({
      t: 'match_start',
      in: this.countdownMs,
      ids: [...this.starting],
      limit: this.scoreLimit,
      ms: this.matchMs,
    });
    this._broadcast({ t: 'score', roster: this._roster() });
    this._sendLobby();
  }

  /* ---- bounded match ----
   * First to `scoreLimit` kills, or the leader when `matchMs` runs out. One
   * authoritative end signal, like the start. Mirrors endMatch()/standings()
   * in server/index.mjs — read the notes there.
   */

  _standings() {
    return [...this.sessions.values()]
      .filter((p) => p.deployed && !p.warm)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
      .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, skin: p.skin }));
  }

  _endMatch(reason, winnerId) {
    const rows = this._standings();
    if (!rows.length) return;
    this._broadcast({
      t: 'match_end',
      reason,
      winner: winnerId ?? null,
      limit: this.scoreLimit,
      ms: this.matchMs,
      standings: rows,
    });
    this.matchUntil = 0;
    for (const p of this.sessions.values()) {
      if (!p.deployed || p.warm) continue;
      p.deployed = false;
      p.warm = false;
      p.ready = false;
    }
    this._sendLobby();
    this._maybeStart();
  }

  _maybeEndOnTime() {
    if (!this.matchUntil || Date.now() < this.matchUntil) return;
    if (this._startRemaining() > 0) return;
    const rows = this._standings();
    if (!rows.length) {
      this.matchUntil = 0;
      return;
    }
    const [a, b] = rows;
    const winner =
      !b || a.kills > b.kills || (a.kills === b.kills && a.deaths < b.deaths) ? a.id : null;
    this._endMatch('time', winner);
  }

  /** Push a running countdown back to a full one for a late arrival, up to the cap. */
  _extendStart() {
    const now = Date.now();
    this.startAt = Math.max(this.startAt, Math.min(now + this.countdownMs, this.startCap));
    return this._startRemaining();
  }

  /* ---- snapshot tick ---- */

  _ensureTick() {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this._tick(), 1000 / this.tickHz);
  }

  _tick() {
    this._maybeEndOnTime();
    const states = [];
    for (const peer of this.sessions.values()) {
      // Warm-ups are private in both directions — see _broadcastMatch().
      if (!peer.pstate || peer.warm) continue;
      states.push({ id: peer.id, name: peer.name, s: peer.pstate });
    }
    if (states.length) this._broadcastMatch({ t: 'snapshot', states });
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

  /**
   * Broadcast to the room's MATCH — everyone except the players warming up
   * against bots. Every gameplay message goes out this way, which is what makes
   * a warm-up private: not a target, not in anybody's world, and blind to the
   * match running around it. Room traffic (lobby, chat, roster) still reaches
   * everybody. Mirrors `broadcastMatch` in server/index.mjs.
   */
  _broadcastMatch(obj, exceptId = null) {
    const msg = JSON.stringify(obj);
    for (const peer of this.sessions.values()) {
      if (peer.id === exceptId || peer.warm) continue;
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
