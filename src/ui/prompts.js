import { el, setText, setStyle, ease, clamp01, damp } from './util.js';

/** Interaction prompt: keycap + verb, with an optional hold-progress rule. */
export class Prompt {
  constructor(parent) {
    this.root = el('div', 'ow-prompt', parent);
    this.key = el('div', 'ow-key', this.root, 'F');
    const col = el('div', null, this.root);
    this.txt = el('div', 'ow-prompt-txt', col, 'INTERACT');
    this.sub = el('div', 'ow-prompt-sub', col, '');
    const bar = el('div', null, col);
    bar.style.cssText =
      'margin-top:calc(var(--u)*1);height:calc(1.5px * var(--k));background:rgba(255,255,255,.16);width:100%';
    this.fill = el('i', null, bar);
    this.fill.style.cssText =
      'display:block;height:100%;width:100%;background:var(--amber);transform-origin:left;transform:scaleX(0)';
    this.bar = bar;

    this.shown = 0;
    this.active = false;
    this.progress = 0;
    setStyle(this.root, 'display', 'none');
  }

  /** @param {object} p { key, text, sub, progress } */
  set(p) {
    this.active = true;
    setText(this.key, p.key ?? 'F');
    setText(this.txt, (p.text ?? 'INTERACT').toUpperCase());
    setText(this.sub, (p.sub ?? '').toUpperCase());
    setStyle(this.sub, 'display', p.sub ? '' : 'none');
    this.progress = p.progress ?? 0;
    setStyle(this.bar, 'display', p.progress !== undefined ? '' : 'none');
  }

  clear() {
    this.active = false;
  }

  update(dt) {
    this.shown = damp(this.shown, this.active ? 1 : 0, 18, dt);
    const vis = this.shown;
    setStyle(this.root, 'display', vis < 0.005 ? 'none' : '');
    if (vis < 0.005) return;
    setStyle(this.root, 'opacity', vis.toFixed(3));
    const y = (1 - ease.outCubic(vis)) * 7;
    setStyle(this.root, 'transform', `translate(-50%,calc(-50% + ${y.toFixed(2)}px))`);
    setStyle(this.fill, 'transform', `scaleX(${clamp01(this.progress).toFixed(3)})`);
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * A timed status chip above the reticle — "INVINCIBLE 4.2". One at a time;
 * `set(null)` hides it. Written only when the text changes, so a countdown
 * driven every frame costs one string compare.
 */
export class StatusChip {
  constructor(parent) {
    this.root = el('div', 'ow-status', parent);
    this.txt = el('span', 'ow-status-t', this.root, '');
    this.val = el('span', 'ow-status-v', this.root, '');
    this._on = false;
    setStyle(this.root, 'display', 'none');
  }

  /** @param {{ text: string, value?: string }|null} p */
  set(p) {
    if (!p) {
      if (this._on) setStyle(this.root, 'display', 'none');
      this._on = false;
      return;
    }
    if (!this._on) setStyle(this.root, 'display', '');
    this._on = true;
    setText(this.txt, p.text ?? '');
    setText(this.val, p.value ?? '');
  }

  dispose() {
    this.root.remove();
  }
}

/** Kill confirmation / objective banner. One at a time, newest wins. */
export class Banner {
  constructor(parent) {
    this.root = el('div', 'ow-banner', parent);
    this.title = el('div', 'ow-banner-t', this.root, '');
    this.sub = el('div', 'ow-banner-s', this.root, '');
    el('div', 'ow-banner-rule', this.root);
    this.t = 1;
    this.life = 2.1;
    setStyle(this.root, 'display', 'none');
  }

  show(title, sub, life = 2.1) {
    setText(this.title, (title ?? '').toUpperCase());
    setText(this.sub, (sub ?? '').toUpperCase());
    setStyle(this.sub, 'display', sub ? '' : 'none');
    this.life = life;
    this.t = 0;
  }

  update(dt) {
    if (this.t >= 1) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    this.t = Math.min(1, this.t + dt / this.life);
    const u = this.t;
    const inT = clamp01(u / (0.16 / this.life));
    const a = u > 0.78 ? 1 - ease.inQuad((u - 0.78) / 0.22) : ease.outQuad(inT);
    const s = 0.965 + 0.035 * ease.outBack(inT);
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'opacity', a.toFixed(3));
    setStyle(this.root, 'transform', `translate(-50%,-50%) scale(${s.toFixed(4)})`);
  }

  dispose() {
    this.root.remove();
  }
}
