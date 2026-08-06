/**
 * NET — web multiplayer. Turns the single-player sandbox into a room-based
 * free-for-all you can share with a link.
 *
 * Responsibilities:
 *   • Connect to the relay (src/net/config.js decides where), join a room read
 *     from the URL, and keep the address bar a valid invite link.
 *   • Broadcast the local player's transform ~20×/s and render every other
 *     player as a reused AI soldier body (ai.createPuppet), interpolated ~100 ms
 *     in the past so movement is smooth despite jitter.
 *   • Replicate shots as muzzle flash + tracers, and settle PvP hits with a
 *     trust-the-shooter model: the shooter ray-tests remote bodies locally and
 *     the victim applies the damage the shooter claims.
 *   • Spawn the local player through the world's spawn director, feeding it the
 *     room's live transforms so a respawn is scored against real opponents, and
 *     announcing each pick (`spawn`) so two clients cannot claim one point.
 *   • Drive the overlay: invite bar, scoreboard, kill toasts, status, and the
 *     join/leave presence card (src/ui/presence.js — deliberately louder than a
 *     toast, and shown in the lobby too while the overlay is hidden).
 *   • Carry the match-start lobby — who is here, who has readied up, whether the
 *     match is already live — and hand it to `match` as `net:lobby` /
 *     `net:countdown` / `net:join` / `net:leave` events. `net` renders none of
 *     that: it only knows the wire.
 *
 * It owns no gameplay rules of its own — it reads `player`/`weapons` state and
 * feeds `ai`/`fx`/`ui`, all via ctx, so nothing else in the engine needs to know
 * multiplayer exists.
 */
import * as THREE from 'three';
import { NetUI } from './ui.js';
import {
  arrivedByInvite,
  resolveRoom,
  resolveServerUrl,
  resolveName,
  saveName,
  inviteLink,
} from './config.js';

const SEND_HZ = 20; // local snapshot rate
const INTERP_MS = 110; // render remote players this far in the past
const RESPAWN_MS = 3200;

export class NetSystem {
  static id = 'net';
  static deps = ['player', 'weapons', 'ai', 'physics', 'world', 'ui', 'fx'];

  constructor() {
    this.enabled = true;
    this.connected = false;
    this.myId = null;
    this.room = null;
    this.name = null;
    this.variant = 0;

    /** id -> { name, kills, deaths, puppet, buf:[], last, hp, dead, variant, livery } */
    this.peers = new Map();
    this.roster = []; // last authoritative scoreboard from server

    /**
     * Match-start lobby, as last reported by the relay. `match` renders this and
     * decides when the local player deploys; `net` only carries it.
     *   live      the room's match is running (a warm-up does not count)
     *   players   [{ id, name, ready, deployed, warm }] including me
     */
    this.lobby = { live: false, players: [], map: null };
    this.ready = false;
    /**
     * The bounded-match contract as the relay states it: `limit` is the kill
     * target, `endsAt` (performance.now() ms) is when the leader wins on time,
     * 0 while no room match is running. `match` paints the HUD from this; the
     * relay's `match_end` is what actually ends anything.
     */
    this.matchLimit = 0;
    this.matchEndsAt = 0;
    /** Have we ever been welcomed? Separates "connecting" from "dropped out". */
    this.everConnected = false;
    /** `MAX_ROOM` when the relay turned us away for a full room, else 0. */
    this.roomFull = 0;
    /**
     * Are we out of the lobby, and is it a warm-up? Held locally because the
     * relay forgets it when the socket drops: on a reconnect we have to say so
     * again, or the room reads as empty of players and everybody still shooting
     * is invisible to the ready flow. See the `welcome` case.
     */
    this._deployed = false;
    this._warm = false;
    /** Who was ready last frame, so a rematch call is toasted once. */
    this._readyIds = new Set();

    this._sendAccum = 0;
    this._ws = null;
    this._reconnectT = 0;
    this._wantReconnect = true;
    this._lastAttacker = 0;
    this._lastAttackerName = '';
    this._deadSince = -1;
    this._boardHeld = false;

    // scratch
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    /** Where I died, and where the round that did it came from — spawn inputs. */
    this._deathSite = new THREE.Vector3();
    this._killerShot = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  async init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.weapons = ctx.peek('weapons');
    this.ai = ctx.get('ai');
    this.physics = ctx.get('physics');
    this.world = ctx.peek('world');
    this.uiSys = ctx.peek('ui');
    this.fx = ctx.peek('fx');

    this.room = resolveRoom();
    /** True when the URL already named a room — i.e. somebody invited us. */
    this.arrivedByInvite = arrivedByInvite;
    this.name = resolveName();
    this.serverUrl = resolveServerUrl();
    const variants = this.ai.variantNames ?? ['vanguard'];
    // ctx.rng, never Math.random (ARCHITECTURE.md rule 4). The relay hands out
    // the per-client variety that actually matters — see setSalt() on welcome.
    this._rng = ctx.rng.fork();
    this.variant = this._rng.int(0, variants.length - 1);
    this._variants = variants;
    /**
     * Our livery (colour) slot. Unlike the variant this is NOT a local choice:
     * the relay assigns it on `welcome` so no two players in a room can wear the
     * same colour. Until then we are slot 0, which nothing is looking at yet.
     */
    this.livery = 0;
    /**
     * The swatch on each scoreboard row. Bound once so `renderRoster` can be
     * handed a plain function and `net/ui.js` never has to know that `ai` owns
     * the palette. `skin < 0` means the slot has not arrived yet — no swatch is
     * better than the wrong one.
     */
    this._liveryCss = (row) =>
      typeof row.skin === 'number' && row.skin >= 0 ? this.ai.livery(row.skin).css : null;
    this._registerSpawnSource();

    // ---- overlay ----
    this.ui = new NetUI();
    this.ui.setRoom(this.room);
    this.ui.setName(this.name);
    this.ui.setStatus('wait');
    this.ui.onCopy = () => this._copyInvite();
    this.ui.onName = (n) => this.setName(n);

    // ---- input: Tab scoreboard, Enter chat ----
    this._onKey = (e) => this._handleKey(e);
    this._onKeyUp = (e) => {
      if (e.code === 'Tab' && this._boardHeld) {
        this._boardHeld = false;
        this.ui.showBoard(false);
      }
    };
    addEventListener('keydown', this._onKey, true);
    addEventListener('keyup', this._onKeyUp, true);

    // ---- gameplay hooks ----
    this._off = [];
    const on = (t, fn) => this._off.push(ctx.events.on(t, fn));
    on('weapon:fire', (e) => this._onLocalFire(e));
    on('damage:taken', (e) => this._onDamageTaken(e));
    on('player:death', () => this._onLocalDeath());

    this._connect();
    // Debug/test handle: lets the capture harness and console introspect the net
    // state (connected, myId, peers) without reaching into the private registry.
    if (typeof window !== 'undefined') window.__NET__ = this;
    console.info(`[net] room "${this.room}" as "${this.name}" -> ${this.serverUrl}`);
  }

  /* ==================================================================== */
  /* transport                                                            */
  /* ==================================================================== */

  _connect() {
    if (this._ws) return;
    let ws;
    try {
      // Put the room in the URL as well as the join message: on Cloudflare the
      // Worker routes the socket to the room's Durable Object by this query
      // param before any message is read. The Node relay ignores it and reads
      // the room from `join` instead, so one client works against both.
      const sep = this.serverUrl.includes('?') ? '&' : '?';
      ws = new WebSocket(`${this.serverUrl}${sep}room=${encodeURIComponent(this.room)}`);
    } catch (err) {
      console.warn('[net] connect failed', err);
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;
    ws.onopen = () => {
      this.ui.setStatus('wait');
      // The map goes out with the join: the first client into a room decides
      // which level the room is on, and everyone after joins the one in
      // progress. `match` applies whatever comes back on the lobby frame.
      this._send({ t: 'join', room: this.room, name: this.name, map: this.world?.mapId ?? null });
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this._onMessage(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this._ws = null;
      this.myId = null;
      this.ui.setStatus('off');
      this._clearPeers();
      this.lobby = { live: false, players: [], map: this.lobby?.map ?? null };
      this.ready = false;
      this.matchEndsAt = 0;
      this._readyIds.clear();
      this._emitLobby();
      if (this._wantReconnect) this._scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }

  _scheduleReconnect() {
    this._reconnectT = 1.5;
  }

  _send(obj) {
    const ws = this._ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  /* ==================================================================== */
  /* incoming                                                             */
  /* ==================================================================== */

  _onMessage(msg) {
    switch (msg.t) {
      case 'hello':
        // server assigned a socket id; join already sent on open
        break;
      case 'welcome': {
        this.myId = msg.id;
        this.connected = true;
        this.everConnected = true;
        this.roomFull = 0;
        // The spawn director is RNG-free by design, so ties are broken by a
        // salt. The relay-assigned id is the only value in the room that is
        // *guaranteed* distinct — better than trusting two clients' engine
        // seeds to differ — so two players cannot score their way onto the
        // same slab on the same tick.
        this.world?.spawns?.setSalt(this.myId);
        // Our colour, and the relay is the only party that could have picked
        // it: it is the one process that can see the whole room at once, so it
        // is the one place a slot can be guaranteed distinct from every other
        // player's. Falling back to the id keeps a pre-`skin` relay playable —
        // colours may then collide, but nothing breaks.
        this.livery = typeof msg.skin === 'number' ? msg.skin : (this.myId ?? 0);
        this.tickHz = msg.tickHz ?? SEND_HZ;
        this.lobby.live = !!msg.live;
        if (msg.map) this.lobby.map = msg.map;
        // Walking into a live match: the relay says how it is bounded, so the
        // scoreline and the clock are honest from the first frame.
        if (typeof msg.limit === 'number') this.matchLimit = msg.limit;
        this.matchEndsAt = Number(msg.matchLeft) > 0 ? performance.now() + Number(msg.matchLeft) : 0;
        for (const p of msg.peers ?? []) this._ensurePeer(p.id, p.name, p);
        // A reconnect lands here too, and the relay has no memory of the socket
        // it lost. Say where we are again, or a room whose players are all still
        // shooting reads as an empty lobby and the next arrival waits on a ready
        // flow nobody can see.
        if (this._deployed) this._send({ t: 'deploy', solo: this._warm });
        this._updateStatus();
        this._emitLobby();
        // Walked into a countdown that is already running. The relay adds a late
        // arrival to the start rather than letting them miss it.
        if (Number(msg.startIn) > 0) {
          this.ctx.events.emit('net:countdown', { ms: Number(msg.startIn) });
        }
        this.ui.toast(`Joined room <b>${this.room.toUpperCase()}</b> — share the link to invite friends`);
        break;
      }
      // A peer arriving or leaving is the one piece of room news nobody asked
      // for, and it changes who is in the level — so it is not a toast. Both
      // paths carry the same three facts to the card and to the event: who, in
      // which livery, and how many are in the room now.
      case 'peer_join': {
        const p = this._ensurePeer(msg.id, msg.name, msg);
        this._updateStatus();
        const colour = this._liveryCss({ skin: p.livery });
        const count = this._roomCount();
        this.ui.presence('join', msg.name, { colour, count });
        this.ctx.events.emit('net:join', { id: msg.id, name: msg.name, colour, count });
        break;
      }
      case 'peer_leave': {
        // Read the peer before removing it: the livery and the callsign are the
        // only things left to announce them by once the puppet is gone.
        const p = this.peers.get(msg.id);
        const name = p?.name ?? '';
        const colour = p ? this._liveryCss({ skin: p.livery }) : null;
        this._removePeer(msg.id);
        this._updateStatus();
        const count = this._roomCount();
        this.ui.presence('leave', name, { colour, count });
        this.ctx.events.emit('net:leave', { id: msg.id, name, colour, count });
        break;
      }
      case 'lobby': {
        this.lobby = { live: !!msg.live, players: msg.players ?? [], map: msg.map ?? null };
        // The relay clears ready flags when it fires the start signal; mirror
        // whatever it says about us rather than keeping a local opinion.
        this.ready = !!this.lobby.players.find((p) => p.id === this.myId)?.ready;
        this._noteRematchCalls();
        this._emitLobby();
        break;
      }
      case 'match_start': {
        // `ids` is the set the relay is deploying. An unready player in a forced
        // start is not one of them — the room simply goes live around them and
        // the lobby offers "deploy now". An older relay omits it: everybody goes.
        if (Array.isArray(msg.ids) && this.myId != null && !msg.ids.includes(this.myId)) break;
        const inMs = Math.max(0, Number(msg.in) || 0);
        if (typeof msg.limit === 'number') this.matchLimit = msg.limit;
        // The clock runs from the countdown's end. An older relay sends no
        // `ms`; the HUD then simply shows no time cap, and nothing else breaks.
        this.matchEndsAt = Number(msg.ms) > 0 ? performance.now() + inMs + Number(msg.ms) : 0;
        this.ctx.events.emit('net:countdown', { ms: inMs });
        break;
      }
      case 'match_end': {
        // The relay ended the room's match — score limit or full time — and has
        // already stepped everyone in it out (the lobby frame confirms). Hand
        // the result to `match`, which owns the ceremony; this system only
        // resets its own idea of being deployed so a reconnect does not
        // re-declare a match that is over.
        this._deployed = false;
        this._warm = false;
        this._deadSince = -1;
        this.matchEndsAt = 0;
        this.roster = msg.standings ?? this.roster;
        this.ctx.events.emit('net:matchend', {
          reason: msg.reason === 'time' ? 'time' : 'score',
          winner: msg.winner ?? null,
          limit: Number(msg.limit) || 0,
          standings: (msg.standings ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            kills: r.kills ?? 0,
            deaths: r.deaths ?? 0,
            colour: this._liveryCss(r),
            me: r.id === this.myId,
          })),
          mine: msg.winner === this.myId,
        });
        break;
      }
      case 'snapshot':
        this._onSnapshot(msg.states);
        break;
      case 'fire':
        this._onRemoteFire(msg);
        break;
      case 'hit':
        this._onIncomingHit(msg);
        break;
      case 'kill':
        this._onKill(msg);
        break;
      case 'spawn':
        // Somebody else is coming in here. Reserve the ground for a couple of
        // seconds so our own pick lands elsewhere.
        if (msg.id !== this.myId && Array.isArray(msg.p)) {
          this.world?.spawns?.noteClaim(msg.p[0], msg.p[1], msg.p[2]);
        }
        break;
      case 'score':
        this.roster = msg.roster ?? [];
        this._applyRoster();
        this.ui.renderRoster(this.roster, this.myId, this._liveryCss);
        break;
      case 'chat':
        this.ui.toast(`<b>${esc(msg.name)}:</b> ${esc(msg.text)}`);
        break;
      case 'full':
        // The overlay this toasts to is hidden while the lobby owns the screen,
        // which is exactly when this arrives — so the lobby has to carry it too,
        // or following a link to a full room is an indefinite "connecting…".
        this.roomFull = Number(msg.max) || 0;
        this.ui.toast(`Room is full (${msg.max}). Try a different link.`);
        this._emitLobby();
        break;
    }
  }

  _ensurePeer(id, name, extra) {
    if (id === this.myId) return null;
    let p = this.peers.get(id);
    if (!p) {
      p = {
        id,
        name: name ?? 'Operator',
        kills: extra?.kills ?? 0,
        deaths: extra?.deaths ?? 0,
        puppet: null,
        buf: [],
        last: this._now(),
        hp: extra?.hp ?? 100,
        dead: false,
        variant: 0,
        /**
         * The peer's colour slot. Seeded from the roster when we have it, and
         * corrected from the peer's own state blob if the snapshot got here
         * first. -1 until it is known, which never matches a real slot, so
         * `_advancePeer` recolours as soon as one arrives.
         */
        livery: typeof extra?.skin === 'number' ? extra.skin : -1,
      };
      this.peers.set(id, p);
    } else {
      if (name) p.name = name;
      if (typeof extra?.skin === 'number') p.livery = extra.skin;
    }
    return p;
  }

  _removePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.puppet?.dispose();
    this.peers.delete(id);
  }

  _clearPeers() {
    for (const p of this.peers.values()) p.puppet?.dispose();
    this.peers.clear();
  }

  _onSnapshot(states) {
    const now = this._now();
    for (const st of states) {
      if (st.id === this.myId) continue;
      const p = this._ensurePeer(st.id, st.name);
      if (!p) continue;
      const s = st.s;
      p.name = st.name ?? p.name;
      p.last = now;
      p.hp = s.hp ?? p.hp;
      p.dead = !!s.dead;
      if (typeof s.v === 'number') p.variant = s.v;
      if (typeof s.sk === 'number') p.livery = s.sk;
      p.buf.push({
        t: now,
        x: s.p[0], y: s.p[1], z: s.p[2],
        yaw: s.y ?? 0, pitch: s.pt ?? 0,
        speed: s.sp ?? 0, crouch: !!s.cr, aiming: !!s.ad, dead: !!s.dead,
      });
      // keep ~1s of history (plus a hard cap so a stalled clock can't grow it)
      while (p.buf.length > 2 && (now - p.buf[0].t > 1000 || p.buf.length > 40)) p.buf.shift();
    }
  }

  /* ==================================================================== */
  /* remote fire replication                                              */
  /* ==================================================================== */

  _onRemoteFire(msg) {
    const p = this.peers.get(msg.id);
    const o = msg.o, d = msg.d;
    if (!o || !d) return;
    this._origin.set(o[0], o[1], o[2]);
    this._dir.set(d[0], d[1], d[2]);
    if (this._dir.lengthSq() < 1e-6) return;
    this._dir.normalize();

    // Body recoil on the shooter's puppet.
    p?.puppet?.onFire();

    // Muzzle flash + light straight through fx (bypasses the local crosshair).
    this.fx?.onWeaponFire?.({
      origin: this._origin,
      dir: this._dir,
      weapon: 'rifle',
      intensity: 0.55,
      light: 0.03,
      flashScale: 1.0,
      fx: true,
    });

    // Tracer to the first world hit (or into the distance).
    this._from.copy(this._origin);
    const hit = this.physics.raycast(
      this._origin.x, this._origin.y, this._origin.z,
      this._dir.x, this._dir.y, this._dir.z, 260, this.physics.MASK.WORLD
    );
    if (hit.hit) {
      this._to.copy(hit.point);
      this.ctx.events.emit('bullet:impact', {
        point: hit.point, normal: hit.normal, surface: hit.surface,
        incident: this._dir, damage: 0,
      });
    } else {
      this._to.copy(this._origin).addScaledVector(this._dir, 120);
    }
    this.ctx.events.emit('bullet:tracer', { from: this._from, to: this._to, speed: 850 });
  }

  /* ==================================================================== */
  /* local fire -> PvP hit test (trust the shooter)                        */
  /* ==================================================================== */

  _onLocalFire(e) {
    if (!this.connected || !e || !e.origin || !e.dir) return;
    if (e.weapon === 'ai_rifle') return; // enemy shots aren't ours
    if (this.player.dead) return;
    this._origin.copy(e.origin);
    this._dir.copy(e.dir).normalize();

    let best = null;
    let bestT = Infinity;
    for (const p of this.peers.values()) {
      if (!p.puppet || p.dead || p.hp <= 0) continue;
      const feet = p.puppet.position;
      const crouch = p.puppet.crouch;
      // Everything below is in the puppet's own stature: the body it has to
      // agree with is the drawn one, and that is variant scale × STATURE tall.
      const s = p.puppet.scale ?? 1;
      const top = (crouch ? 1.2 : 1.75) * s;
      // capsule segment from ankles to the neck; head handled by the top slab
      const r = 0.34 * s;
      const res = rayCapsule(
        this._origin, this._dir,
        feet.x, feet.y + 0.2 * s, feet.z,
        feet.x, feet.y + top, feet.z,
        r + 0.06, 200
      );
      if (!res.hit || res.t >= bestT) continue;
      // occlusion by the world
      this._v.copy(this._origin).addScaledVector(this._dir, res.t);
      if (!this.physics.lineOfSight(this._origin, this._v, this.physics.MASK.SIGHT)) continue;
      /**
       * ZONE, not just head-or-not.
       *
       * A puppet carries no ACTOR colliders — `net` raycasts one capsule — so
       * the zone has to come out of where along the segment the round landed.
       * Three bands against the same multipliers every bot uses (see
       * `WeaponSystem.damageAt`): the top 180 mm (at the puppet's stature) is
       * the head, everything below 45 % of standing height is legs, and the
       * rest is torso.
       *
       * Before this there were two bands and a flat x2 head multiplier, so the
       * SAME weapon killed a bot in four torso hits and a player in four, but
       * one-tapped the bot on a headshot and needed two on the player — and a
       * shot through the ankle did full torso damage. A weapon set cannot be
       * balanced against two different damage models.
       */
      const headY = feet.y + top;
      const legY = feet.y + top * 0.45;
      const zone = res.py > headY - 0.18 * s ? 'head' : res.py < legY ? 'limb' : 'torso';
      bestT = res.t;
      best = { p, zone, dist: res.t };
    }
    if (!best) return;

    // The weapon's OWN falloff ramp and zone table, so PvP and PvE agree.
    const dmg = Math.round(this.weapons?.damageAt?.(best.dist, best.zone) ?? 30);
    const headshot = best.zone === 'head';
    this._send({
      t: 'hit',
      target: best.p.id,
      dmg,
      part: headshot ? 'head' : 'body',
      o: [this._origin.x, this._origin.y, this._origin.z],
      // The ID, not the def. `weapon:fire` carries the whole weapon definition
      // object, and this used to put all ~50 fields of it on the wire on every
      // connecting shot; the receiver only ever wanted a name for the killfeed.
      w: typeof e.weapon === 'string' ? e.weapon : e.weapon?.id ?? 'rifle',
    });
    // Immediate local feedback (server confirms the kill).
    this.uiSys?.hitmarker?.(headshot ? 'head' : 'hit');
  }

  /* ==================================================================== */
  /* incoming hit -> apply to me                                          */
  /* ==================================================================== */

  _onIncomingHit(msg) {
    if (this.player.dead) return;
    const from = msg.o ? this._v.set(msg.o[0], msg.o[1], msg.o[2]) : null;
    this._lastAttacker = msg.from ?? 0;
    this._lastAttackerName = msg.fromName ?? '';
    this._lastHeadshot = msg.part === 'head';
    // Where the round came from. If the shooter has left the room by the time
    // we respawn, this is still a good "do not put me back here" hint.
    if (from) {
      this._killerShot.copy(from);
      this._killerShotValid = true;
    }
    this.player.applyDamage(msg.dmg ?? 0, from, { type: 'bullet' });
    // player system draws the arc from the `damage:taken` it emits internally
  }

  _onDamageTaken() {
    // reserved: any extra reaction to taking damage goes here
  }

  _onLocalDeath() {
    if (this._deadSince >= 0) return; // already handling
    this._deadSince = this._now();
    this._deathSite.copy(this.player.feetPosition);
    const by = this._lastAttacker || 0;
    this._send({ t: 'kill', by, headshot: !!this._lastHeadshot });
    this.player.setControlEnabled(false);
    if (by) this.ui.toast(`You were eliminated by <b>${esc(this._lastAttackerName || '???')}</b>`);
    else this.ui.toast(`You were eliminated`);
  }

  _onKill(msg) {
    if (msg.victim === this.myId) return; // handled locally
    const mine = msg.by === this.myId;
    // Relay-confirmed PvP kill. `audio` scores the announcer off this; a bot
    // kill reaches it as `damage:dealt` instead.
    this.ctx.events.emit('net:kill', {
      by: msg.by, victim: msg.victim, headshot: !!msg.headshot, mine,
    });
    const hs = msg.headshot ? ' ⌖' : '';
    if (mine) {
      this.ui.toast(`You eliminated <b>${esc(msg.victimName)}</b>${hs}`);
      this.uiSys?.hitmarker?.('kill');
      this.uiSys?.banner?.show?.('ELIMINATED', msg.victimName, 1.6);
    } else {
      this.ui.toast(`<b>${esc(msg.byName)}</b> <span class="k">✕</span> <b>${esc(msg.victimName)}</b>${hs}`);
    }
  }

  /* ==================================================================== */
  /* per-frame                                                            */
  /* ==================================================================== */

  update(dt, ctx) {
    if (this._reconnectT > 0) {
      this._reconnectT -= dt;
      if (this._reconnectT <= 0 && !this._ws) this._connect();
    }

    // respawn timer
    if (this._deadSince >= 0 && this._now() - this._deadSince > RESPAWN_MS) {
      this._respawn();
    }

    // send local snapshot at a fixed rate
    if (this.connected) {
      this._sendAccum += dt;
      const interval = 1 / SEND_HZ;
      if (this._sendAccum >= interval) {
        this._sendAccum = 0;
        this._sendState();
      }
    }

    // advance + interpolate remote puppets
    const renderT = this._now() - INTERP_MS;
    for (const [id, p] of this.peers) {
      if (this._now() - p.last > 6000) {
        this._removePeer(id);
        continue;
      }
      this._advancePeer(p, renderT, dt);
    }
  }

  _sendState() {
    const pl = this.player;
    const feet = pl.feetPosition;
    const stance = pl.stance;
    this._send({
      t: 'state',
      s: {
        p: [round2(feet.x), round2(feet.y), round2(feet.z)],
        y: round3(pl.yaw),
        pt: round3(pl.pitch),
        sp: round2(pl.horizontalSpeed),
        cr: stance !== 'stand',
        ad: pl.adsProgress > 0.5,
        hp: Math.round(pl.health),
        dead: pl.dead,
        v: this.variant,
        // Our relay-assigned colour slot, echoed on every tick rather than
        // announced once: a peer that joined before us learns our colour from
        // the roster, but a peer whose roster message we raced learns it here.
        // It is one small integer at 20 Hz.
        sk: this.livery,
      },
    });
  }

  _advancePeer(p, renderT, dt) {
    const buf = p.buf;
    if (!buf.length) return;
    if (!p.puppet) {
      const vname = this._variants[p.variant % this._variants.length] ?? 'vanguard';
      const s0 = buf[buf.length - 1];
      p.puppet = this.ai.createPuppet(vname, this._v2.set(s0.x, s0.y, s0.z), s0.yaw, {
        livery: p.livery,
      });
    } else if (p.puppet.livery !== p.livery) {
      // The slot arrived after the body did.
      p.puppet.setLivery(p.livery);
    }

    // find two samples bracketing renderT
    let a = null, b = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= renderT) {
        a = buf[i];
        b = buf[i + 1] ?? buf[i];
        break;
      }
    }
    if (!a) {
      a = buf[0];
      b = buf[0];
    }
    let alpha = 0;
    if (b !== a && b.t > a.t) alpha = clamp01((renderT - a.t) / (b.t - a.t));

    const x = lerp(a.x, b.x, alpha);
    const y = lerp(a.y, b.y, alpha);
    const z = lerp(a.z, b.z, alpha);
    const yaw = lerpAngle(a.yaw, b.yaw, alpha);
    const pitch = lerp(a.pitch, b.pitch, alpha);
    const speed = lerp(a.speed, b.speed, alpha);

    // The wire carries a VIEW yaw (the camera's, forward = -sin/-cos). The
    // soldier rig is built facing +Z (see src/ai/rig.js) and the puppet derives
    // its aim vector with +sin/+cos, so both want the same value turned around.
    // Without the half turn a remote player's body — and the head and weapon IK
    // that hang off it — face exactly away from where he is actually looking.
    p.viewYaw = yaw;
    p.puppet.apply({
      position: this._v.set(x, y, z),
      yaw: yaw + Math.PI,
      pitch, speed,
      crouch: b.crouch, aiming: b.aiming, dead: p.dead,
    });
    p.puppet.update(dt);
  }

  /**
   * Come back into the match.
   *
   * The point is chosen by the world's spawn director, told two things only
   * this system knows: where the killer was standing and where I died. Because
   * every client feeds its own remote-player positions into the same director
   * (see `_registerSpawnSource`), a respawn here is scored against the actual
   * live room, not against a list of coordinates.
   *
   * The pick is then ANNOUNCED. Two players whose respawn timers expire on the
   * same tick would otherwise both score the same empty corner and land on top
   * of each other; a claim is a 2.5 s reservation that makes the second one
   * pick somewhere else. It is advisory, like every other rule on this relay.
   */
  _respawn() {
    this._deadSince = -1;
    const killer = this._killerPos();
    this._lastAttacker = 0;
    const point = this.player.respawn({
      team: this.spawnTeam,
      actorId: 'player',
      killer,
      from: this._deathSite,
    });
    this.player.setControlEnabled(true);
    this._send({ t: 'respawn' });
    this.announceSpawn(point);
    this.ui.toast('Respawned');
  }

  /**
   * My team, as the spawn director sees it. This is a free-for-all: every
   * player is his own team, so everybody else scores as an enemy.
   */
  get spawnTeam() {
    return this.myId != null ? `p${this.myId}` : 'player';
  }

  /** Tell the room where I am coming in. Advisory — see `_respawn`. */
  announceSpawn(point) {
    const p = point?.position ?? point;
    if (!p || !this.connected) return;
    this._send({ t: 'spawn', p: [round2(p.x), round2(p.y), round2(p.z)] });
  }

  /** Where the man who killed me was standing, if we still have him. */
  _killerPos() {
    const p = this.peers.get(this._lastAttacker);
    if (p?.puppet?.position) return p.puppet.position;
    return this._killerShotValid ? this._killerShot : null;
  }

  /**
   * Everyone else in the room, as the spawn director sees them: hostile (this
   * is a free-for-all, so every player is his own team) and at their last
   * interpolated position.
   */
  _registerSpawnSource() {
    const spawns = this.world?.spawns;
    if (!spawns) return;
    this._offSpawnSource = spawns.addSource((add) => {
      for (const p of this.peers.values()) {
        const pos = p.puppet?.position;
        if (!pos) continue;
        // View yaw, not the puppet's body yaw — the director's cone test is in
        // the camera convention. See _advancePeer.
        add(pos.x, pos.y, pos.z, p.viewYaw ?? 0, `p${p.id}`, `net:${p.id}`, p.dead || p.hp <= 0);
      }
    });
  }

  /* ==================================================================== */
  /* match-start lobby (driven by the `match` subsystem)                   */
  /* ==================================================================== */

  /**
   * Ask the room to change level.
   *
   * The relay owns the answer, exactly as it owns the ready flags: it stores
   * one map per room and broadcasts it, so two players cannot ready up on
   * different levels. Nothing is applied locally here — `match` waits for the
   * lobby frame to come back and switches on that, which is also what makes a
   * remote player's choice arrive the same way our own does.
   */
  setMap(id) {
    if (!id || id === this.lobby.map) return;
    this._send({ t: 'map', map: id });
  }

  /**
   * Toggle my ready flag.
   *
   * `force` asks the relay to start with the players who ARE ready rather than
   * waiting on the whole lobby — the way out of a room where somebody joined and
   * then wandered off. It only means anything alongside `on`.
   */
  setReady(on, force = false) {
    this.ready = !!on;
    this._send({ t: 'ready', ready: this.ready, force: !!force });
  }

  /**
   * "I am out of the lobby."
   *
   * `solo` marks a WARM-UP — the bots game you press Play for while waiting for
   * people to turn up. The relay keeps that private and, crucially, does not let
   * it make the room live: whoever follows your invite link still gets the ready
   * flow, and the start signal pulls you out of the bots and in with them.
   * Without the flag, one player pressing Play used to lock the whole room into
   * "match in progress" until every single person left it again.
   */
  deploy(solo = false) {
    this.ready = false;
    this._deployed = true;
    this._warm = !!solo;
    this._send({ t: 'deploy', solo: this._warm });
  }

  /**
   * "I went back to the lobby" — the pause menu's Leave match.
   *
   * The room is LIVE for as long as anybody in it is in the match, and a live
   * room skips the ready flow entirely. Without telling the relay we stepped
   * out, the first match anyone ever plays would leave the room live forever and
   * every return to the lobby would offer "deploy now" instead of a real setup.
   */
  undeploy() {
    this.ready = false;
    this._deployed = false;
    this._warm = false;
    this._send({ t: 'undeploy' });
  }

  /** The lobby list with myself filled in even before the first `lobby` frame. */
  lobbyPlayers() {
    const list = this.lobby.players;
    if (list.length || this.myId == null) return list;
    return [{ id: this.myId, name: this.name, ready: this.ready, deployed: false, warm: false }];
  }

  /** Copy the invite link; resolves through the same clipboard fallbacks as the bar. */
  copyInvite() {
    this._copyInvite();
  }

  /** The shareable link for this room — what `copyInvite` puts on the clipboard. */
  inviteUrl() {
    return inviteLink(this.room);
  }

  /**
   * Rename this operator. Public because the lobby owns a callsign field too,
   * and both fields have to agree — hence the `net:name` echo.
   */
  setName(n) {
    const before = this.name;
    this._setName(n);
    if (this.name !== before) this.ctx.events.emit('net:name', { name: this.name });
  }

  /** Hide the invite bar / toasts while another view (the lobby) owns the screen. */
  setOverlayVisible(on) {
    this.ui?.setHidden(!on);
  }

  /**
   * Somebody in the lobby has readied up for the next match — tell the players
   * who are still in this one.
   *
   * A ready flag on a live room cannot start anything: the relay only starts a
   * match a room is not already in. So it is a call, and the players it is
   * addressed to are the ones who cannot see the lobby it came from. Without
   * this the first player to want a rematch waits in an empty room while
   * everyone else wonders why nobody is talking.
   */
  _noteRematchCalls() {
    const now = new Set();
    for (const p of this.lobby.players) if (p.ready && p.id !== this.myId) now.add(p.id);
    if (this._deployed && !this._warm) {
      for (const id of now) {
        if (this._readyIds.has(id)) continue;
        const name = this.lobby.players.find((p) => p.id === id)?.name ?? '???';
        this.ui.toast(`<b>${esc(name)}</b> is up for another match — <b>Esc</b> → Leave match to join them`);
      }
    }
    this._readyIds = now;
  }

  _emitLobby() {
    this.ctx.events.emit('net:lobby', {
      connected: this.connected,
      everConnected: this.everConnected,
      full: this.roomFull,
      live: this.lobby.live,
      players: this.lobbyPlayers(),
      myId: this.myId,
      ready: this.ready,
      map: this.lobby.map,
    });
  }

  /* ==================================================================== */
  /* ui glue                                                              */
  /* ==================================================================== */

  _applyRoster() {
    for (const r of this.roster) {
      if (r.id === this.myId) continue;
      const p = this.peers.get(r.id);
      if (p) {
        p.kills = r.kills;
        p.deaths = r.deaths;
        p.name = r.name;
      }
    }
  }

  /** Bodies in the room, us included — the number every surface quotes. */
  _roomCount() {
    return this.peers.size + (this.connected ? 1 : 0);
  }

  _updateStatus() {
    this.ui.setStatus(this.connected ? 'on' : 'wait', this._roomCount());
  }

  _copyInvite() {
    const link = inviteLink(this.room);
    const done = () => this.ui.flashCopied();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done, () => this._fallbackCopy(link, done));
    } else {
      this._fallbackCopy(link, done);
    }
  }

  _fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {}
    ta.remove();
  }

  _setName(n) {
    if (!n) return;
    this.name = n.slice(0, 20);
    saveName(this.name);
    this._send({ t: 'name', name: this.name });
  }

  _handleKey(e) {
    if (e.code === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (!this._boardHeld) {
        this._boardHeld = true;
        this.ui.renderRoster(this._fullRoster(), this.myId, this._liveryCss);
        this.ui.showBoard(true);
      }
    }
  }

  _fullRoster() {
    const list = [];
    if (this.myId != null) {
      const me = this.roster.find((r) => r.id === this.myId);
      list.push({
        id: this.myId,
        name: this.name,
        kills: me?.kills ?? 0,
        deaths: me?.deaths ?? 0,
        skin: this.livery,
      });
    }
    for (const p of this.peers.values()) {
      list.push({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, skin: p.livery });
    }
    return list;
  }

  _now() {
    return this.ctx.time.raw * 1000;
  }

  dispose() {
    this._wantReconnect = false;
    this._offSpawnSource?.();
    this._offSpawnSource = null;
    for (const off of this._off ?? []) off();
    removeEventListener('keydown', this._onKey, true);
    removeEventListener('keyup', this._onKeyUp, true);
    this._clearPeers();
    try {
      this._ws?.close();
    } catch {}
    this.ui?.dispose();
  }
}

/* ── math helpers ───────────────────────────────────────────────────── */

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}
function round3(x) {
  return Math.round(x * 1000) / 1000;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Closest approach of a ray to a capsule (segment P0..P1, radius r).
 * Returns { hit, t (distance along ray), py (world y of closest ray point) }.
 */
const _u = new THREE.Vector3();
const _w0 = new THREE.Vector3();
const _seg = new THREE.Vector3();
function rayCapsule(ro, rd, x0, y0, z0, x1, y1, z1, r, maxT) {
  // ray: ro + t*rd  (t in [0,maxT]);  segment: S0 + s*(S1-S0)  (s in [0,1])
  _seg.set(x1 - x0, y1 - y0, z1 - z0);
  _w0.set(ro.x - x0, ro.y - y0, ro.z - z0);
  const a = rd.dot(rd); // = 1 if normalized
  const b = rd.dot(_seg);
  const c = _seg.dot(_seg);
  const d = rd.dot(_w0);
  const e = _seg.dot(_w0);
  const denom = a * c - b * b;
  let t, s;
  if (denom < 1e-8) {
    t = -d / a;
    s = 0;
  } else {
    t = (b * e - c * d) / denom;
    s = (a * e - b * d) / denom;
  }
  if (t < 0) t = 0;
  if (t > maxT) t = maxT;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  // closest points
  const rx = ro.x + rd.x * t, ry = ro.y + rd.y * t, rz = ro.z + rd.z * t;
  const sx = x0 + _seg.x * s, sy = y0 + _seg.y * s, sz = z0 + _seg.z * s;
  const dx = rx - sx, dy = ry - sy, dz = rz - sz;
  const dist2 = dx * dx + dy * dy + dz * dz;
  return { hit: dist2 <= r * r, t, py: ry };
}
