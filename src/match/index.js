/**
 * MATCH — the pre-match state machine and the Match Start view.
 *
 * The game used to be live on the first frame: the AI garrison was spawned
 * during boot and the player had control the moment pointer lock was granted.
 * Now every normal load opens on a menu and the match starts when somebody asks
 * for it, one of two ways:
 *
 *   BOTS         pick a garrison size, press play, deploy immediately.
 *   MULTIPLAYER  share the room link; once a second player is in the room both
 *                press READY, the relay fires one start signal (see
 *                `maybeStart()` in server/index.mjs) and both clients run the
 *                same countdown. No bots in this mode — it is players only.
 *
 * The two are not exclusive, and that is the point: a bots match started while
 * you are alone in a room is a WARM-UP. The relay keeps it private and does not
 * let it make the room live, so the friends arriving on your link still get the
 * ready flow — and when the start signal fires this system pulls you out of the
 * bots and into the match with them (`_onCountdown`). Nobody has to leave
 * anything first.
 *
 * The lobby collapses both into ONE primary button whose meaning follows the
 * room (see the header of ./ui.js); this system resolves a click on it against
 * the live lobby state in `_primary()`.
 *
 * WHAT IT OWNS
 *   • `state`: 'setup' -> 'countdown' -> 'live', and the gating that goes with
 *     it — input, player control, HUD visibility, pointer lock.
 *   • WHICH MAP is loaded. `world` owns the map list and the rebuild; this
 *     system owns the moment it is allowed to happen — on the lobby and
 *     nowhere else — and, in a room, defers the choice to the relay so
 *     everybody switches together (see `_chooseMap` / `_applyMap`).
 *   • WHERE the player deploys — a spawn scored by `world.spawns` rather than
 *     the menu backdrop everyone was standing on — and, when there is no `net`
 *     to own it, the respawn cycle after a bot kills you.
 *   • WHEN the garrison spawns. `config.deferGarrison` (set in src/boot.js) tells
 *     `ai` not to populate during boot; this system calls `ai.populate()` with
 *     the chosen size at the moment the match starts, so a players-only match
 *     really has no bots in it.
 *   • The lobby sounds: join, ready, countdown ticks, deployment horn.
 *   • Breaking room news while the lobby is up. `net`'s overlay — and with it
 *     its join/leave card — is hidden behind this screen, so `_onPresence`
 *     re-raises the same card here and flashes the roster row that changed.
 *
 * WHAT IT DOES NOT OWN
 *   The wire. `net` carries the lobby and reports it as `net:lobby`,
 *   `net:countdown`, `net:join` and `net:leave`; this system reads those events
 *   and calls `net.setReady()` / `net.deploy()`. With `?mp=0` there is no `net`
 *   at all and only the bots path is offered.
 *
 * WHEN A MATCH ENDS. Every match is a bounded free-for-all — first to the
 *   kill target, or the leader at full time (see ./bounds.js). The relay
 *   referees a room match, because the relay owns the score; this system
 *   referees a bots match, because nobody else can see it. Either way the end
 *   lands here, in the CEREMONY: the winner's name in their livery, the final
 *   standings, and a timed walk back to the lobby — which is where the
 *   existing rematch flow was already waiting.
 *
 * EVENTS EMITTED
 *   match:start { bots, squads, perSquad, mode }   the match is live
 *   match:countdown { seconds }                    a countdown tick landed
 *   match:end { reason }                           back out to the lobby
 *                                                  ('complete' = it was won)
 */

import * as THREE from 'three';
import { MatchStartUI, BOT_PRESETS } from './ui.js';
import { SCORE_LIMIT, MATCH_MS, BotMatchTally } from './bounds.js';

const DEFAULT_BOTS = 'standard';
/** Time on your back before you are put back in. Matches `net`'s own timer. */
const RESPAWN_MS = 3200;
/** How long the ceremony holds the screen before walking back to the lobby. */
const CEREMONY_MS = 10_000;

export class MatchSystem {
  static id = 'match';
  static deps = ['player', 'ui', 'ai', 'world'];

  constructor(opts = {}) {
    /** 'setup' | 'countdown' | 'live' | 'ceremony' */
    this.state = 'setup';
    /**
     * How we went live: 'bots' is a warm-up (private, interruptible, and the
     * relay does not count it as the room's match), 'versus' came out of a
     * countdown, 'join' dropped into a running match. Null in the lobby.
     */
    this.mode = null;
    this.bots = opts.bots ?? DEFAULT_BOTS;
    /** Copy for the countdown screen — a pull-in from a warm-up says so. */
    this._countCopy = { label: 'Match starting', sub: 'Deploying to the floor' };
    this._countdownEnd = 0;
    this._lastTick = -1;
    this._off = [];
    /** Bots-only respawn cycle — see `_onPlayerDeath`. 0 when not waiting. */
    this._respawnAt = 0;
    this._deathSite = new THREE.Vector3();
    this._lastAttack = new THREE.Vector3();
    this._lastAttackValid = false;
    /** A level rebuild is in flight; nothing may start until it lands. */
    this._mapBusy = false;
    /** Scorekeeper for a bots match (see ./bounds.js). Null in a room match. */
    this._tally = null;
    /** When the ceremony walks itself back to the lobby. 0 outside it. */
    this._ceremonyUntil = 0;
  }

  async init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.uiSys = ctx.get('ui');
    this.ai = ctx.get('ai');
    // `net` is optional: absent under ?mp=0, and registered before this system
    // when present. Everything it reports arrives as an event, so a late lookup
    // is only ever used for sending.
    this.net = ctx.peek('net');

    this.world = ctx.get('world');

    this.ui = new MatchStartUI({
      multiplayer: !!this.net,
      invited: !!this.net?.arrivedByInvite,
    });
    this.ui.setMaps(this.world.maps ?? []);
    this.ui.setMap(this.world.mapId);
    this.ui.setMapNote(this.net ? 'Shared with everyone in your room' : '');
    this.ui.onMap = (id) => this._chooseMap(id);
    this.ui.onBots = (key) => this._setBots(key);
    this.ui.onPrimary = () => this._primary();
    this.ui.onAlt = () => this._alt();
    this.ui.onCopyInvite = () => this._copyInvite();
    this.ui.onName = (n) => this.net?.setName(n);
    // The settings menu is the same panel Escape opens in a match — one surface,
    // reachable from both places, so nothing has to be learned twice.
    this.ui.onSettings = () => this.uiSys.menu.show();
    this._setBots(this.bots);
    if (this.net) {
      this.ui.setRoom(this.net.room);
      this.ui.setName(this.net.name);
    }

    const on = (t, fn) => this._off.push(ctx.events.on(t, fn));
    on('player:death', () => {
      this._onPlayerDeath();
      this._onTallyDeath();
    });
    on('damage:taken', (e) => {
      if (e?.from) this._lastAttack.copy(e.from);
      this._lastAttackValid = !!e?.from;
    });
    on('damage:dealt', (e) => this._onDamageDealt(e));
    on('net:lobby', (e) => this._onLobby(e));
    on('net:name', (e) => this.ui.setName(e?.name ?? ''));
    on('net:countdown', (e) => this._onCountdown(e));
    on('net:matchend', (e) => this._onNetMatchEnd(e));
    on('net:join', (e) => this._onPresence('join', e));
    on('net:leave', (e) => this._onPresence('leave', e));
    this.ui.onCeremonyDone = () => this._ceremonyDone();

    this._enterSetup();
    if (typeof window !== 'undefined') window.__MATCH__ = this;
  }

  /* ==================================================================== */
  /* setup                                                                */
  /* ==================================================================== */

  _enterSetup() {
    this.state = 'setup';
    this.mode = null;
    this._tally = null;
    this._ceremonyUntil = 0;
    this.ui.showCeremony(false);
    // Gameplay input off: the mousedown handler in core/input.js grabs pointer
    // lock on any click, which would swallow the cursor the menu needs.
    this.ctx.input.enabled = false;
    document.exitPointerLock?.();
    this.player.setControlEnabled(false);
    this.uiSys.setHudVisible(false);
    // The invite bar duplicates what this view already shows, and it would ghost
    // through the scrim.
    this.net?.setOverlayVisible(false);
    this.ui.showCountdown(false);
    this.ui.setVisible(true);
    if (this.net) this._onLobby(null);
    else this.ui.render({});
    // Enter is the whole screen: land the focus ring on the one button that
    // matters so a keyboard player never has to hunt for it.
    requestAnimationFrame(() => this.ui.focusPrimary());
  }

  /* ==================================================================== */
  /* map                                                                  */
  /* ==================================================================== */

  /**
   * The player clicked a map card.
   *
   * In a room the map belongs to the ROOM, not to this client: ask the relay
   * and wait for the lobby frame to come back. That is deliberately the same
   * path a remote player's choice arrives on, so there is one code path and no
   * way for two clients to end up on different levels.
   *
   * Solo (or while the relay is unreachable) it is applied straight away, and
   * the id goes out with the next `join` — so a player who picks Rust offline
   * and then connects brings that choice into an empty room with them.
   */
  _chooseMap(id) {
    if (this.state !== 'setup' || this._mapBusy) return;
    if (!this._knownMap(id) || id === this.world.mapId) return;
    this._sfx('ready', 0.7);
    if (this.net?.connected) this.net.setMap(id);
    else this._applyMap(id);
  }

  _knownMap(id) {
    return !!id && (this.world.maps ?? []).some((m) => m.id === id);
  }

  /**
   * Rebuild the level. Everything that cached the old one — the physics BVH,
   * `ai`'s nav grid, the minimap bake — is refreshed off `world:rebuilt`; all
   * this system has to do is hold the menu shut while it happens and then put
   * the player back on the ground, because the spawn they were standing on
   * belonged to a level that no longer exists.
   */
  async _applyMap(id) {
    if (this._mapBusy || !this.world || this.world.mapId === id) return;
    this._mapBusy = true;
    this.ui.setMapBusy(true);
    if (this.net) this._onLobby(null);
    try {
      await this.world.setMap(id);
      this.player.respawn(0);
    } catch (err) {
      console.warn('[match] map change failed', err);
    } finally {
      this._mapBusy = false;
      this.ui.setMapBusy(false);
      this.ui.setMap(this.world.mapId);
      this.ui.setMapNote(this.net ? 'Shared with everyone in your room' : '');
      this.ui.setBots(this.bots);
      if (this.net) this._onLobby(null);
      else this.ui.render({});
    }
  }

  _setBots(key) {
    this.bots = BOT_PRESETS.some((p) => p.key === key) ? key : DEFAULT_BOTS;
    this.ui.setBots(this.bots);
  }

  /**
   * The single primary button. Its meaning is whatever the room currently
   * makes it — the lobby paints the label from the same four cases.
   */
  _primary() {
    switch (this.ui.mode) {
      case 'deploy':
        return this.start({ bots: 'off', mode: 'join' });
      case 'ready':
        return this._setReady(true);
      case 'unready':
        return this._setReady(false);
      default:
        return this.start({ bots: this.bots, mode: 'bots' });
    }
  }

  /**
   * The secondary link under the primary. Same idea as the primary — one
   * control whose meaning is whatever the room makes it — but it is always the
   * *other* reasonable move, never a required one. See `_paintAlt` in ./ui.js.
   */
  _alt() {
    switch (this.ui.altMode) {
      // Somebody joined and wandered off. Start with the players who are ready
      // rather than waiting on them; they keep the lobby's "deploy now".
      case 'force':
        return this._setReady(true, true);
      // The room's match is running and we are back in the lobby: arm a rematch.
      // It cannot start until the current match empties, and the players still in
      // it are told somebody is waiting (see `_noteRematchCalls` in src/net).
      case 'next':
        return this._setReady(true);
      case 'cancel':
        return this._setReady(false);
      default:
        return this.start({ bots: this.bots, mode: 'bots' });
    }
  }

  _setReady(on, force = false) {
    if (!this.net) return;
    this.net.setReady(on, force);
    this._sfx(on ? 'ready' : 'unready');
    // Optimistic paint; the relay's `lobby` frame confirms it a moment later.
    this._onLobby(null);
  }

  /** Copy the invite link to the clipboard, one click. */
  _copyInvite() {
    if (!this.net) return;
    this.net.copyInvite();
    this.ui.flashCopied();
  }

  /** Repaint from whatever `net` currently holds (the event payload is a hint). */
  _onLobby(e) {
    if (!this.net) return;
    // The room's map is authoritative over this client's: whoever was in the
    // room first set it, and a change anybody makes arrives here.
    const roomMap = e?.map ?? this.net.lobby.map;
    if (this.state !== 'setup') {
      // A warm-up holds nothing up, so the relay lets the room change level
      // underneath it. Step back to the lobby and rebuild rather than keep
      // shooting bots on a level the room has moved off — the alternative is a
      // player who readies up and then deploys onto the wrong map.
      if (this.mode === 'bots' && this._knownMap(roomMap) && roomMap !== this.world.mapId) {
        this.returnToSetup();
      }
      return;
    }
    if (this._knownMap(roomMap) && roomMap !== this.world.mapId) this._applyMap(roomMap);
    this.ui.setRoom(this.net.room);
    this.ui.render(
      e ?? {
        connected: this.net.connected,
        everConnected: this.net.everConnected,
        full: this.net.roomFull,
        live: this.net.lobby.live,
        players: this.net.lobbyPlayers(),
        myId: this.net.myId,
        ready: this.net.ready,
        map: this.net.lobby.map,
      }
    );
  }

  /* ==================================================================== */
  /* countdown                                                            */
  /* ==================================================================== */

  _onCountdown({ ms }) {
    let pulled = false;
    if (this.state === 'live') {
      // Already in the room's match — a stale signal, nothing to do.
      if (this.mode !== 'bots') return;
      // A warm-up, though, is exactly what this signal is for: you pressed Play
      // to pass the time in a room you were inviting people to, and they have now
      // turned up and readied. Drop the bots and come with them. This is what
      // used to require every player to leave their match by hand first.
      this._leaveWarmup();
      pulled = true;
    } else if (this.state === 'ceremony') {
      // The room is starting while the result is still on screen — a bounded
      // warm-up that ended while friends readied up. The match outranks the
      // ceremony; the countdown takes the screen (showCountdown hides it).
      this._ceremonyUntil = 0;
      this._respawnAt = 0;
      pulled = this.mode === 'bots';
    }
    this.state = 'countdown';
    this._countCopy = pulled
      ? { label: 'Match starting', sub: 'Your room is playing — leaving the bots behind' }
      : { label: 'Match starting', sub: 'Deploying to the floor' };
    // Wall clock, not frame time: both clients were handed the same duration by
    // the relay, and a dropped frame must not stretch one player's countdown.
    this._countdownEnd = performance.now() + Math.max(400, ms || 0);
    this._lastTick = -1;
    this.ui.setVisible(true);
    this.ui.showCountdown(true);
    this._paintCountdown(Math.ceil((this._countdownEnd - performance.now()) / 1000));
  }

  /**
   * Tear a warm-up down without telling the relay we left.
   *
   * `returnToSetup` would send `undeploy`, and the relay has already put us in
   * the cohort it is starting — saying we stepped out would drop us from the very
   * match we are counting down to. So this is the same teardown minus the wire.
   */
  _leaveWarmup() {
    this._respawnAt = 0;
    try {
      this.ai.clearGarrison?.();
    } catch (err) {
      console.warn('[match] warm-up teardown failed', err);
    }
    this._enterSetup();
    this.ctx.events.emit('match:end', { reason: 'pulled-in' });
    console.info('[match] pulled out of the warm-up — the room is starting');
  }

  _paintCountdown(n) {
    this.ui.setCountdown(n, this._countCopy.label, this._countCopy.sub);
  }

  update() {
    this._updateRespawn();
    this._updateBounds();
    if (this.state !== 'countdown') return;
    const left = this._countdownEnd - performance.now();
    const n = Math.max(0, Math.ceil(left / 1000));
    if (n !== this._lastTick) {
      this._lastTick = n;
      this._paintCountdown(n);
      if (n > 0) {
        this._sfx('countdown', 0.9);
        this.ctx.events.emit('match:countdown', { seconds: n });
      }
    }
    if (left <= 0) this.start({ bots: 'off', mode: 'versus' });
  }

  /* ==================================================================== */
  /* start                                                                */
  /* ==================================================================== */

  /**
   * Go live: spawn the chosen garrison, hand control back, hide the view.
   * Idempotent — a second call once the match is running does nothing.
   */
  start({ bots = 'off', mode = 'bots' } = {}) {
    if (this.state === 'live') return;
    // A half-built level is not a match. The countdown path can land here too,
    // so this is a guard rather than a UI concern.
    if (this._mapBusy) return;
    this.state = 'live';
    this.mode = mode;
    // A bots match is scored here — nobody else can see it. A room match is
    // scored by the relay, whose `match_end` arrives as `net:matchend`.
    this._tally = mode === 'bots' ? new BotMatchTally({ now: performance.now() }) : null;
    const preset = BOT_PRESETS.find((p) => p.key === bots) ?? BOT_PRESETS[0];

    // Deploy the player FIRST, then the garrison: the bots' anchors are scored
    // against wherever everybody actually is, and "everybody" now includes a
    // player who just moved off the menu backdrop.
    this._deploy();

    // `clearGarrison` makes this idempotent across a leave-and-restart: without
    // it, going back to the lobby and pressing play again would stack a second
    // garrison on top of the first.
    try {
      this.ai.clearGarrison?.();
      if (preset.squads > 0) this.ai.populate({ squads: preset.squads, perSquad: preset.perSquad });
    } catch (err) {
      // A missing nav grid is not a reason to keep the player in a menu.
      console.warn('[match] garrison spawn failed', err);
    }

    this.ui.showCountdown(false);
    this.ui.setVisible(false);
    this.uiSys.setHudVisible(true);
    this.net?.setOverlayVisible(true);
    this.ctx.input.enabled = true;
    this.player.setControlEnabled(true);
    // Requested from the click that started the match (or ~3 s after it, at the
    // end of a countdown) — if the browser refuses, the next click still locks.
    this.ctx.input.requestPointerLock?.();
    // 'bots' is a warm-up: private, and it must not put the room in "match in
    // progress" — see `deploy()` in src/net/index.js.
    this.net?.deploy(mode === 'bots');
    this._sfx('matchstart');
    this.ctx.events.emit('match:start', {
      bots: preset.key,
      squads: preset.squads,
      perSquad: preset.perSquad,
      mode,
      map: this.world?.mapId ?? null,
    });
    console.info(`[match] start mode=${mode} bots=${preset.key} map=${this.world?.mapId}`);
  }

  /**
   * Back out of a live match to the lobby — what "Leave match" in the pause
   * menu does. The room survives it (the relay only ever hears that we stopped
   * being ready), so leaving and playing again keeps the same invite link.
   */
  returnToSetup() {
    if (this.state === 'setup') return;
    this._respawnAt = 0;
    try {
      this.ai.clearGarrison?.();
    } catch (err) {
      console.warn('[match] garrison teardown failed', err);
    }
    // Tell the room we stepped out, or it stays LIVE and everyone who comes
    // back here — including us — is offered "deploy now" instead of a setup.
    this.net?.undeploy();
    this._enterSetup();
    this.ctx.events.emit('match:end', { reason: 'left' });
    console.info('[match] returned to the lobby');
  }

  /* ==================================================================== */
  /* respawn (bots-only matches)                                          */
  /* ==================================================================== */

  /**
   * A bots-only match has to put the player back in too.
   *
   * `net` owns the respawn cycle whenever there is a room, because it also has
   * to tell the relay. With `?mp=0` there is no `net` at all, and until now
   * nothing brought the player back from a bot's bullet — you simply lay there
   * at zero health for the rest of the session. Same 3.2 s, same director, and
   * the bot that killed you is passed in so you do not come back in its lap.
   */
  _onPlayerDeath() {
    if (this.net || this.state !== 'live' || this._respawnAt) return;
    this._deathSite.copy(this.player.feetPosition);
    this._respawnAt = performance.now() + RESPAWN_MS;
    this.player.setControlEnabled(false);
    this._sfx('leave', 0.8);
  }

  _updateRespawn() {
    if (!this._respawnAt || performance.now() < this._respawnAt) return;
    this._respawnAt = 0;
    this.player.respawn({
      team: 'player',
      actorId: 'player',
      from: this._deathSite,
      killer: this._lastAttackValid ? this._lastAttack : null,
    });
    this.player.setControlEnabled(true);
    this._lastAttackValid = false;
  }

  /* ==================================================================== */
  /* bounded match + ceremony                                             */
  /* ==================================================================== */

  /**
   * A body dropped and it was our round that did it. `damage:dealt` means
   * damage TO `target`, so the local player must be filtered out — an enemy
   * round connecting with us arrives on this event too (same rule the HUD's
   * hitmarker applies).
   */
  _onDamageDealt(e) {
    if (!e?.killed || !this._tally || this.state !== 'live') return;
    const t = e.target;
    if (t === 'player' || t === this.player || t?.isPlayer === true) return;
    if (this._tally.noteKill() === 'score') this._endBots('score');
  }

  /** The garrison scored on us. Only a bots match counts it here. */
  _onTallyDeath() {
    if (!this._tally || this.state !== 'live') return;
    if (this._tally.noteDeath() === 'score') this._endBots('score');
  }

  /**
   * Per-frame half of the contract: the bots clock, the ceremony's walk back
   * to the lobby, and the HUD scoreline (kills toward the target, the leader,
   * time remaining) whichever referee owns the match.
   */
  _updateBounds() {
    const now = performance.now();
    if (this.state === 'ceremony') {
      if (this._ceremonyUntil) {
        this.ui.setCeremonyReturn((this._ceremonyUntil - now) / 1000);
        if (now >= this._ceremonyUntil) this._ceremonyDone();
      }
      return;
    }
    if (this.state !== 'live') return;

    if (this._tally) {
      if (this._tally.checkTime(now) === 'time') {
        this._endBots('time');
        return;
      }
      this.uiSys.setMatch?.({
        scoreUs: this._tally.kills,
        scoreThem: this._tally.deaths,
        timeLeft: this._tally.remaining(now) / 1000,
        mode: 'FFA',
      });
    } else if (this.net) {
      // The relay referees; this is only the scoreboard. My row and the best
      // other row come from the roster the relay already broadcasts per kill.
      let mine = 0;
      let best = 0;
      for (const r of this.net.roster ?? []) {
        if (r.id === this.net.myId) mine = r.kills ?? 0;
        else best = Math.max(best, r.kills ?? 0);
      }
      this.uiSys.setMatch?.({
        scoreUs: mine,
        scoreThem: best,
        timeLeft: this.net.matchEndsAt ? Math.max(0, this.net.matchEndsAt - now) / 1000 : 0,
        mode: 'FFA',
      });
    }
  }

  /** '5:00' from ms — the ceremony's reason line. */
  _fmtClock(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** A bots match ended — this client is the referee, so it calls it here. */
  _endBots(reason) {
    const t = this._tally;
    if (!t || this.state !== 'live') return;
    const winner = t.winner();
    const myName = this.net?.name ?? 'You';
    const myColour = this._liveryCss(this.net?.livery ?? 0);
    this._enterCeremony({
      eyebrow: this.mode === 'bots' && this.net?.connected ? 'Warm-up complete' : 'Match complete',
      verdict: winner === 'you' ? 'Victory' : winner === 'garrison' ? 'Defeat' : 'Draw',
      colour: winner === 'you' ? 'var(--wm-ok)' : winner === 'garrison' ? 'var(--wm-danger)' : null,
      how:
        reason === 'score'
          ? `First to ${t.limit}`
          : `Full time — ${this._fmtClock(t.ms)} played`,
      rows: [
        { name: myName, kills: t.kills, deaths: t.deaths, colour: myColour, me: true, win: winner === 'you' },
        { name: 'Garrison', kills: t.deaths, deaths: t.kills, colour: null, me: false, win: winner === 'garrison' },
      ].sort((a, b) => b.kills - a.kills),
    });
  }

  /**
   * The relay ended the room's match. It has already stepped everyone out
   * (the room is no longer live), so all that is left is to say who won.
   * A player who was not in that match — warming up, or sitting in the
   * lobby — has nothing to be shown; the lobby frame already told them.
   */
  _onNetMatchEnd(e) {
    if (this.state !== 'live' || this.mode === 'bots') return;
    const rows = e?.standings ?? [];
    const winner = rows.find((r) => r.id === e?.winner) ?? null;
    for (const r of rows) r.win = !!winner && r.id === winner.id;
    this._enterCeremony({
      eyebrow: 'Match complete',
      verdict: e?.mine ? 'Victory' : winner ? `${winner.name} wins` : 'Draw',
      colour: winner?.colour ?? null,
      how: e?.reason === 'time' ? 'Full time — the leader takes it' : `First to ${e?.limit || SCORE_LIMIT}`,
      rows,
    });
  }

  /**
   * Hold the result on screen: control off, HUD down, the standings up, and a
   * timed walk back to the lobby (or one click / Enter). The garrison goes now
   * rather than at the lobby — bots hunting a player who cannot move are not a
   * backdrop, they are a soft-lock.
   */
  _enterCeremony(view) {
    if (this.state === 'ceremony') return;
    this.state = 'ceremony';
    this._respawnAt = 0;
    this._tally = null;
    try {
      this.ai.clearGarrison?.();
    } catch (err) {
      console.warn('[match] garrison teardown failed', err);
    }
    this.ctx.input.enabled = false;
    document.exitPointerLock?.();
    this.player.setControlEnabled(false);
    this.uiSys.setHudVisible(false);
    this.net?.setOverlayVisible(false);
    this.ui.setCeremony(view);
    this.ui.setVisible(true);
    this.ui.showCeremony(true);
    this._ceremonyUntil = performance.now() + CEREMONY_MS;
    this.ui.setCeremonyReturn(CEREMONY_MS / 1000);
    this._sfx('matchstart', 0.9);
    this.ctx.events.emit('match:end', { reason: 'complete' });
    console.info(`[match] ceremony: ${view.verdict}`);
  }

  /** Leave the ceremony for the lobby — the button, Enter, or the timer. */
  _ceremonyDone() {
    if (this.state !== 'ceremony') return;
    // Say we are out even though the relay already undeployed us: it clears
    // this client's own deployed/warm flags for the next reconnect, and for a
    // bounded warm-up it is the message the relay is still waiting on.
    this.net?.undeploy();
    this._enterSetup();
  }

  /** The livery palette lives with `ai`; the ceremony only needs a CSS colour. */
  _liveryCss(slot) {
    try {
      return this.ai?.livery?.(slot)?.css ?? null;
    } catch {
      return null;
    }
  }

  /* ==================================================================== */
  /* helpers                                                              */
  /* ==================================================================== */

  /**
   * Put the player on a deployment spawn.
   *
   * Until now everyone sat on spawn point 0 while the menu was up — which in a
   * room of four means four players materialising on the same slab the instant
   * the countdown ends. The director scores the point against every other
   * player it can see (each client feeds it the room's live transforms through
   * `net`), and the pick is announced so a client whose countdown finished a
   * frame earlier has already reserved its ground.
   *
   * Bots-only and late "deploy now" joins take the same path — a live match is
   * exactly the case where a fixed spawn is most likely to be somebody's
   * killing ground.
   */
  _deploy() {
    const world = this.ctx.peek('world');
    if (!world?.spawns) return;
    try {
      const point = this.player.respawn({
        team: this.net?.spawnTeam ?? 'player',
        actorId: 'player',
      });
      this.net?.announceSpawn?.(point);
      if (point) console.info(`[match] deploy at ${point.zone ?? point.tag}`);
    } catch (err) {
      // A spawn we could not resolve is not a reason to keep the player in a
      // menu: he simply deploys where he already stands.
      console.warn('[match] deploy spawn failed', err);
    }
  }

  /**
   * Somebody else entered or left the room.
   *
   * The cue is the same wherever we are, but the card is not: in a match the
   * overlay in `src/net/ui.js` has already shown one, and this screen is not on
   * top of anything. Everywhere else the overlay is hidden behind this screen
   * (`_enterSetup`), so the lobby is the only surface left that can say it.
   */
  _onPresence(kind, e) {
    this._sfx(kind, kind === 'leave' ? 0.7 : 1);
    if (this.state === 'live') return;
    this.ui.presence(kind, {
      id: e?.id ?? null,
      name: e?.name ?? '',
      colour: e?.colour ?? null,
      count: e?.count ?? 0,
    });
  }

  _sfx(kind, level = 1) {
    // Audio needs a user gesture, so the very first cue in a session can land
    // before the graph exists. It is a no-op then, never a throw.
    try {
      this.ctx.peek('audio')?.ui(kind, level);
    } catch {
      /* feedback is optional */
    }
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.ui?.dispose();
  }
}
