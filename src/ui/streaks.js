import { el, setText, setStyle, setClass } from './util.js';

/** Display names for the reward ids in `streak:*` payloads (match owns the ids). */
const LABELS = { uav: 'RECON SWEEP', mortar: 'MORTAR BARRAGE' };

/** Pip thresholds, mirroring STREAK_TIERS in src/match/streaks.js. */
const TIERS = [
  { kills: 3, reward: 'uav' },
  { kills: 5, reward: 'mortar' },
];
const MAX_PIPS = TIERS[TIERS.length - 1].kills;

/**
 * Killstreak meter, under the minimap: one pip per kill toward the next
 * reward, and a single line that is always the most actionable fact —
 * a banked reward and its key first, then a live sweep's countdown, then
 * progress. Hidden entirely at zero state so the corner stays clean.
 *
 * Driven by the `streak:*` events (see ARCHITECTURE.md); ui/index.js wires
 * them and calls `update(dt)` once a frame.
 */
export class StreakMeter {
  constructor(parent) {
    this.root = el('div', 'ow-streak', parent);
    this.pipRow = el('div', 'ow-streak-pips', this.root);
    this.pips = new Array(MAX_PIPS);
    for (let i = 0; i < MAX_PIPS; i++) {
      this.pips[i] = el('b', null, this.pipRow);
      // Tier boundaries read as gates: a wider gap before each threshold pip.
      if (TIERS.some((t) => t.kills === i + 1)) this.pips[i].className = 'gate';
    }
    this.line = el('div', 'ow-streak-line', this.root);
    this.key = el('span', 'ow-streak-key', this.line, '5');
    this.txt = el('span', null, this.line, '');

    this.kills = 0;
    /** Reward ids waiting on the key, oldest first. */
    this.banked = [];
    /** Seconds left on a live recon sweep. */
    this.uavT = 0;
    /** The mortar's green laser is up (streak:designate). */
    this.lasing = false;
    this._pulse = 0;
    this._lastPaint = null;
    setStyle(this.root, 'display', 'none');
  }

  setKills(n) {
    this.kills = Math.max(0, n | 0);
    for (let i = 0; i < MAX_PIPS; i++) setClass(this.pips[i], 'on', i < this.kills);
  }

  earned(reward) {
    if (!this.banked.includes(reward)) this.banked.push(reward);
  }

  activated(reward) {
    const i = this.banked.indexOf(reward);
    if (i >= 0) this.banked.splice(i, 1);
  }

  uavOnline(duration) {
    this.uavT = Math.max(this.uavT, duration ?? 0);
  }

  designating(on) {
    this.lasing = !!on;
  }

  reset() {
    this.setKills(0);
    this.banked.length = 0;
    this.uavT = 0;
    this.lasing = false;
  }

  update(dt) {
    if (this.uavT > 0) this.uavT = Math.max(0, this.uavT - dt);
    const ready = this.banked.length > 0;
    const show = ready || this.kills > 0 || this.uavT > 0 || this.lasing;
    setStyle(this.root, 'display', show ? '' : 'none');
    if (!show) return;

    let mode, text;
    if (this.lasing) {
      // The most actionable fact while the laser is up: the key now cancels.
      mode = 'lasing';
      text = 'LASING TARGET — 5 CANCELS';
    } else if (ready) {
      mode = 'ready';
      text = `${LABELS[this.banked[0]] ?? this.banked[0]} READY`;
    } else if (this.uavT > 0) {
      mode = 'online';
      text = `${LABELS.uav} · ${Math.ceil(this.uavT)}S`;
    } else {
      const next = TIERS.find((t) => t.kills > this.kills);
      mode = 'progress';
      text = next ? `${LABELS[next.reward]} IN ${next.kills - this.kills}` : 'LADDER COMPLETE';
    }
    const paint = mode + text;
    if (paint !== this._lastPaint) {
      this._lastPaint = paint;
      setStyle(this.key, 'display', mode === 'ready' ? '' : 'none');
      setText(this.txt, text);
      setClass(this.line, 'ready', mode === 'ready');
      setClass(this.line, 'online', mode === 'online');
      setClass(this.line, 'lasing', mode === 'lasing');
    }
    // A banked reward breathes so the key hint cannot be missed mid-fight.
    if (this.banked.length && !this.lasing) {
      this._pulse += dt * 3.4;
      setStyle(this.line, 'opacity', (0.72 + 0.28 * Math.abs(Math.sin(this._pulse))).toFixed(3));
    } else {
      setStyle(this.line, 'opacity', '1');
    }
  }

  dispose() {
    this.root.remove();
  }
}
