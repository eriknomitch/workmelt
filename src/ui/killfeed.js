import { el, svg, setText, setStyle, Pool, ease, clamp01 } from './util.js';
import { KILL_ICONS, killIcon } from './killicons.js';

const SIDES = ['me', 'ally', 'enemy'];
const sideOf = (s) => (SIDES.includes(s) ? s : 'enemy');

/**
 * Killfeed, CoD style: left edge, between the minimap and the vitals. Each row
 * is `Attacker  <weapon>  Victim` on its own dark bar, names coloured by side
 * (you and your side blue, the other side orange), the weapon drawn as a
 * side-profile silhouette and a headshot drawn as the reticle skull in its
 * place. Newest row at the bottom; older rows climb and expire from the top, so
 * an expiry never shoves the rows you are still reading. Six visible, 5.6 s.
 *
 * A row with no attacker (a fall, a stray blast, your own grenade) is just the
 * skull and the victim.
 */
export class Killfeed {
  constructor(parent) {
    this.root = el('div', 'ow-killfeed', parent);
    this.pool = new Pool(6, () => {
      const row = el('div', 'ow-kf-row');
      const a = el('span', 'ow-kf-name', row);
      const icon = svg('svg', { class: 'ow-kf-icon', 'aria-hidden': 'true' }, row);
      const path = svg('path', {}, icon);
      const v = el('span', 'ow-kf-name', row);
      row._a = a;
      row._v = v;
      row._icon = icon;
      row._path = path;
      row._key = '';
      return row;
    }, this.root);
    this.life = 5.6;
  }

  /**
   * @param {object} e
   *   attacker      display name, or null for an uncredited death
   *   attackerSide  'me' | 'ally' | 'enemy'
   *   victim        display name
   *   victimSide    'me' | 'ally' | 'enemy'
   *   weapon        weapon id ('rifle', 'melee', 'frag', ...) or def object
   *   headshot      draws the reticle skull in place of the weapon
   */
  push(e) {
    const it = this.pool.acquire();
    it.life = this.life;
    const n = it.node;
    this.root.appendChild(n); // newest at the bottom

    const hasAttacker = !!e.attacker;
    setText(n._a, hasAttacker ? e.attacker : '');
    setStyle(n._a, 'display', hasAttacker ? '' : 'none');
    setText(n._v, e.victim ?? 'Unknown');
    n._a.className = `ow-kf-name ${sideOf(e.attackerSide)}`;
    n._v.className = `ow-kf-name ${sideOf(e.victimSide)}`;
    n.className = e.attackerSide === 'me' || e.victimSide === 'me' ? 'ow-kf-row mine' : 'ow-kf-row';

    const key = killIcon(e.weapon, !!e.headshot, hasAttacker);
    if (key !== n._key) {
      n._key = key;
      const ic = KILL_ICONS[key];
      const [, , vw, vh] = ic.vb;
      n._icon.setAttribute('viewBox', ic.vb.join(' '));
      n._path.setAttribute('d', ic.d);
      // Height is per icon (the reticle sits a touch taller than a gun) and
      // the width follows the viewBox, so every silhouette keeps its proportions.
      setStyle(n._icon, 'height', `calc(${ic.h}px * var(--k))`);
      setStyle(n._icon, 'width', `calc(${((ic.h * vw) / vh).toFixed(2)}px * var(--k))`);
    }
    return it;
  }

  update(dt) {
    const items = this.pool.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) {
        this.pool.release(it);
        continue;
      }
      const inT = clamp01(it.t / 0.18);
      const outT = clamp01((it.t - (it.life - 0.45)) / 0.45);
      const x = (1 - ease.outQuint(inT)) * -22;
      const a = ease.outQuad(inT) * (1 - ease.inQuad(outT));
      setStyle(it.node, 'transform', `translateX(${x.toFixed(2)}px)`);
      setStyle(it.node, 'opacity', a.toFixed(3));
    }
  }

  clear() {
    this.pool.releaseAll();
  }

  dispose() {
    this.root.remove();
  }
}
