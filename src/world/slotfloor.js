import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { SlotBank, SYMBOLS } from './slots.js';

/**
 * WORLD — the slot floor: `slots.js` wired to the running game.
 *
 * `slots.js` owns the odds and the clock and touches nothing. This owns the
 * rest: which machine the local player is standing at (in LEVEL space — the
 * bank is authored there and Clifton is yawed), the use key, charging the
 * pull to `player`, paying the result, and the HUD and sound for all of it.
 * Built by `WorldSystem` for a map whose descriptor carries `slots`, and torn
 * down with the level.
 *
 * Feedback is deliberately all HUD: the reels roll in the interaction prompt
 * under the reticle, the outcome lands on the banner, and invincibility gets
 * a countdown chip. The machines themselves are instanced props and stay
 * still; a reel readout you can read beats a reel texture you cannot.
 *
 * EVENTS EMITTED (see ARCHITECTURE.md)
 *   slots:spin    { machine, cost }               a pull was taken
 *   slots:result  { outcome, reels, symbols }     the last reel stopped
 */
export class SlotFloor {
  constructor(ctx, world, spec, seed) {
    this.ctx = ctx;
    this.world = world;
    this.bank = new SlotBank(spec);
    // Its own stream: a pull must not perturb the level's or anyone else's.
    this.rng = new Rng((seed ^ 0x5107) >>> 0);
    this._rand = () => this.rng.float();
    this._roll = 0;
    this._face = [0, 0, 0];
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._prompting = false;
    this._spinEvent = { machine: 0, cost: 0 };
    this._resultEvent = { outcome: 'lose', reels: null, symbols: null };

    const ev = ctx.events;
    this._off = [
      ev.on('player:death', () => this.bank.cancel()),
      ev.on('player:spawn', () => this.bank.cancel()),
      ev.on('match:start', () => this.bank.reset()),
    ];
  }

  update(dt) {
    const ctx = this.ctx;
    const player = ctx.peek('player');
    const ui = ctx.peek('ui');
    if (!player) return;

    // ---- the clock: reels stopping and the payout -------------------------
    const e = this.bank.update(dt);
    if (e?.type === 'reel') this._sfx('countdown', 0.7);
    else if (e?.type === 'result') this._pay(e, player);

    // ---- invincibility chip ----------------------------------------------
    const inv = player.invulnerableLeft ?? 0;
    ui?.setStatus?.(inv > 0 ? { text: 'INVINCIBLE', value: inv.toFixed(1) } : null);

    // ---- which machine are we at? ----------------------------------------
    const usable = !player.dead && ctx.input.enabled && !ctx.input.frozen && player.controlEnabled !== false;
    let m = null;
    if (usable) {
      const f = player.feetPosition;
      const q = this.world.worldToLevel(f.x, f.y, f.z, this._q);
      // the look direction, carried into level space as a second point
      const fw = player.forward ?? this._fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const a = this.world.worldToLevel(f.x + fw.x, f.y, f.z + fw.z, this._p);
      m = this.bank.machineAt(q.x, q.y, q.z, a.x - q.x, a.z - q.z);
    }

    const spin = this.bank.spin;
    if (spin) this._roll += dt;
    if (!m && !spin) {
      if (this._prompting) ui?.clearPrompt?.();
      this._prompting = false;
      return;
    }

    // ---- the pull --------------------------------------------------------
    const health = player.health?.value ?? 100;
    if (m && !spin && ctx.input.actionPressed('use')) {
      const s = this.bank.pull(m, health, this._rand);
      if (s) {
        const cost = this.bank.cfg.cost;
        player.payHealth(cost);
        this._roll = 0;
        this._sfx('ready', 0.6);
        this._spinEvent.machine = m.id;
        this._spinEvent.cost = cost;
        ctx.events.emit('slots:spin', this._spinEvent);
      } else {
        this._sfx('unready', 0.6);
      }
    }

    // ---- the prompt: the reels while spinning, else the offer -------------
    this._prompting = true;
    if (this.bank.spin) {
      const f = this.bank.face(this._roll, this._face);
      ui?.setPrompt?.({
        key: '$',
        text: `${SYMBOLS[f[0]]}  ·  ${SYMBOLS[f[1]]}  ·  ${SYMBOLS[f[2]]}`,
        sub: '777 = invincible',
        progress: Math.min(1, this.bank.spin.t / this.bank.cfg.spinTime),
      });
      return;
    }
    const why = this.bank.refusal(health);
    const cost = this.bank.cfg.cost;
    ui?.setPrompt?.({
      key: 'F',
      text: why === 'lockout' ? `Machine cooling · ${Math.ceil(this.bank.lockout)}s`
        : why === 'health' ? 'Not enough health'
        : `Spin · ${cost} HP`,
      sub: why ? '' : `777 invincible ${this.bank.cfg.invuln}s · triple heals + ammo`,
    });
  }

  _pay(e, player) {
    const ctx = this.ctx;
    const ui = ctx.peek('ui');
    const cfg = this.bank.cfg;
    const shown = e.reels.map((i) => SYMBOLS[i]).join(' · ');
    if (e.outcome === 'jackpot') {
      player.setInvulnerable(cfg.invuln);
      player.heal(player.maxHealth ?? 100);
      ui?.banner?.show?.('Jackpot', `${shown} — invincible ${cfg.invuln}s`, 2.6);
      this._sfx('matchstart', 1);
    } else if (e.outcome === 'payout') {
      player.heal(player.maxHealth ?? 100);
      ctx.peek('weapons')?.restock?.();
      ui?.banner?.show?.('Payout', `${shown} — health and ammo`, 2.2);
      this._sfx('ready', 1);
    } else {
      this._sfx('unready', 0.5);
    }
    const r = this._resultEvent;
    r.outcome = e.outcome;
    r.reels = e.reels;
    r.symbols = shown;
    ctx.events.emit('slots:result', r);
  }

  _sfx(kind, level) {
    try {
      this.ctx.peek('audio')?.ui?.(kind, level);
    } catch {
      /* feedback is optional */
    }
  }

  dispose() {
    for (const off of this._off) off?.();
    this._off = [];
    if (this._prompting) this.ctx.peek('ui')?.clearPrompt?.();
    this.ctx.peek('ui')?.setStatus?.(null);
  }
}
