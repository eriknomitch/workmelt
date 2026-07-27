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
 * The lobby collapses both into ONE primary button whose meaning follows the
 * room (see the header of ./ui.js); this system resolves a click on it against
 * the live lobby state in `_primary()`.
 *
 * WHAT IT OWNS
 *   • `state`: 'setup' -> 'countdown' -> 'live', and the gating that goes with
 *     it — input, player control, HUD visibility, pointer lock.
 *   • WHERE the player deploys — a spawn scored by `world.spawns` rather than
 *     the menu backdrop everyone was standing on — and, when there is no `net`
 *     to own it, the respawn cycle after a bot kills you.
 *   • WHEN the garrison spawns. `config.deferGarrison` (set in src/main.js) tells
 *     `ai` not to populate during boot; this system calls `ai.populate()` with
 *     the chosen size at the moment the match starts, so a players-only match
 *     really has no bots in it.
 *   • The lobby sounds: join, ready, countdown ticks, deployment horn.
 *
 * WHAT IT DOES NOT OWN
 *   The wire. `net` carries the lobby and reports it as `net:lobby`,
 *   `net:countdown`, `net:join` and `net:leave`; this system reads those events
 *   and calls `net.setReady()` / `net.deploy()`. With `?mp=0` there is no `net`
 *   at all and only the bots path is offered.
 *
 * EVENTS EMITTED
 *   match:start { bots, squads, perSquad, mode }   the match is live
 *   match:countdown { seconds }                    a countdown tick landed
 *   match:end { reason }                           back out to the lobby
 */

import * as THREE from 'three';
import { MatchStartUI, BOT_PRESETS } from './ui.js';

const DEFAULT_BOTS = 'standard';
/** Time on your back before you are put back in. Matches `net`'s own timer. */
const RESPAWN_MS = 3200;

export class MatchSystem {
  static id = 'match';
  static deps = ['player', 'ui', 'ai', 'world'];

  constructor(opts = {}) {
    /** 'setup' | 'countdown' | 'live' */
    this.state = 'setup';
    this.bots = opts.bots ?? DEFAULT_BOTS;
    this._countdownEnd = 0;
    this._lastTick = -1;
    this._off = [];
    /** Bots-only respawn cycle — see `_onPlayerDeath`. 0 when not waiting. */
    this._respawnAt = 0;
    this._deathSite = new THREE.Vector3();
    this._lastAttack = new THREE.Vector3();
    this._lastAttackValid = false;
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

    this.ui = new MatchStartUI({
      multiplayer: !!this.net,
      invited: !!this.net?.arrivedByInvite,
    });
    this.ui.onBots = (key) => this._setBots(key);
    this.ui.onPrimary = () => this._primary();
    this.ui.onStartSolo = () => this.start({ bots: this.bots, mode: 'bots' });
    this.ui.onCopyInvite = () => this._share();
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
    on('player:death', () => this._onPlayerDeath());
    on('damage:taken', (e) => {
      if (e?.from) this._lastAttack.copy(e.from);
      this._lastAttackValid = !!e?.from;
    });
    on('net:lobby', (e) => this._onLobby(e));
    on('net:name', (e) => this.ui.setName(e?.name ?? ''));
    on('net:countdown', (e) => this._onCountdown(e));
    on('net:join', () => this._sfx('join'));
    on('net:leave', () => this._sfx('leave', 0.7));

    this._enterSetup();
    if (typeof window !== 'undefined') window.__MATCH__ = this;
  }

  /* ==================================================================== */
  /* setup                                                                */
  /* ==================================================================== */

  _enterSetup() {
    this.state = 'setup';
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

  _setReady(on) {
    if (!this.net) return;
    this.net.setReady(on);
    this._sfx(on ? 'ready' : 'unready');
    // Optimistic paint; the relay's `lobby` frame confirms it a moment later.
    this._onLobby(null);
  }

  /**
   * Share in one click. Native share where the platform has it (phones, and
   * Safari on the desktop), clipboard everywhere else — either way the player
   * pressed one button and the link is on its way.
   */
  _share() {
    if (!this.net) return;
    const url = this.net.inviteUrl();
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.share && nav.canShare?.({ url })) {
      nav
        .share({ title: 'WORKMELT', text: 'Match starting — jump in.', url })
        .then(() => this.ui.flashCopied('Link sent'))
        .catch(() => {
          /* the sheet was dismissed; nothing to report */
        });
      return;
    }
    this.net.copyInvite();
    this.ui.flashCopied();
  }

  /** Repaint from whatever `net` currently holds (the event payload is a hint). */
  _onLobby(e) {
    if (!this.net || this.state !== 'setup') return;
    this.ui.setRoom(this.net.room);
    this.ui.render(
      e ?? {
        connected: this.net.connected,
        everConnected: this.net.everConnected,
        live: this.net.lobby.live,
        players: this.net.lobbyPlayers(),
        myId: this.net.myId,
        ready: this.net.ready,
      }
    );
  }

  /* ==================================================================== */
  /* countdown                                                            */
  /* ==================================================================== */

  _onCountdown({ ms }) {
    if (this.state === 'live') return; // already deployed; ignore a stale signal
    this.state = 'countdown';
    // Wall clock, not frame time: both clients were handed the same duration by
    // the relay, and a dropped frame must not stretch one player's countdown.
    this._countdownEnd = performance.now() + Math.max(400, ms || 0);
    this._lastTick = -1;
    this.ui.setVisible(true);
    this.ui.showCountdown(true);
    this.ui.setCountdown(Math.ceil((this._countdownEnd - performance.now()) / 1000));
  }

  update() {
    this._updateRespawn();
    if (this.state !== 'countdown') return;
    const left = this._countdownEnd - performance.now();
    const n = Math.max(0, Math.ceil(left / 1000));
    if (n !== this._lastTick) {
      this._lastTick = n;
      this.ui.setCountdown(n);
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
    this.state = 'live';
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
    this.net?.deploy();
    this._sfx('matchstart');
    this.ctx.events.emit('match:start', {
      bots: preset.key,
      squads: preset.squads,
      perSquad: preset.perSquad,
      mode,
    });
    console.info(`[match] start mode=${mode} bots=${preset.key}`);
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
