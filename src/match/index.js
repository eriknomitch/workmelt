/**
 * MATCH — the pre-match state machine and the Match Start view.
 *
 * The game used to be live on the first frame: the AI garrison was spawned
 * during boot and the player had control the moment pointer lock was granted.
 * Now every normal load opens on a menu and the match starts when somebody asks
 * for it, one of two ways:
 *
 *   BOTS         pick a garrison size, press start, deploy immediately.
 *   MULTIPLAYER  share the room link; once a second player is in the room both
 *                press READY, the relay fires one start signal (see
 *                `maybeStart()` in server/index.mjs) and both clients run the
 *                same countdown. No bots in this mode — it is players only.
 *
 * WHAT IT OWNS
 *   • `state`: 'setup' -> 'countdown' -> 'live', and the gating that goes with
 *     it — input, player control, HUD visibility, pointer lock.
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
 */

import { MatchStartUI, BOT_PRESETS } from './ui.js';

const DEFAULT_BOTS = 'standard';

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

    this.ui = new MatchStartUI({ multiplayer: !!this.net });
    this.ui.onBots = (key) => this._setBots(key);
    this.ui.onStartBots = () => this.start({ bots: this.bots, mode: 'bots' });
    this.ui.onToggleReady = () => this._toggleReady();
    this.ui.onDeploy = () => this.start({ bots: 'off', mode: 'join' });
    this.ui.onCopyInvite = () => {
      this.net?.copyInvite();
      this.ui.flashCopied();
    };
    this._setBots(this.bots);
    if (this.net) this.ui.setRoom(this.net.room);

    const on = (t, fn) => this._off.push(ctx.events.on(t, fn));
    on('net:lobby', (e) => this._onLobby(e));
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
  }

  _setBots(key) {
    this.bots = BOT_PRESETS.some((p) => p.key === key) ? key : DEFAULT_BOTS;
    this.ui.setBots(this.bots);
  }

  _toggleReady() {
    if (!this.net) return;
    const next = !this.net.ready;
    this.net.setReady(next);
    this._sfx(next ? 'ready' : 'unready');
    // Optimistic paint; the relay's `lobby` frame confirms it a moment later.
    this._onLobby(null);
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

    if (preset.squads > 0) {
      try {
        this.ai.populate({ squads: preset.squads, perSquad: preset.perSquad });
      } catch (err) {
        // A missing nav grid is not a reason to keep the player in a menu.
        console.warn('[match] garrison spawn failed', err);
      }
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

  /* ==================================================================== */
  /* helpers                                                              */
  /* ==================================================================== */

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
