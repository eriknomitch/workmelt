/**
 * Multiplayer overlay: invite bar, live roster/scoreboard, connection status,
 * join/leave + kill toasts, and a name field. Self-contained DOM + CSS so it
 * doesn't depend on the HUD subsystem's internals. Everything sits under the
 * game canvas' pointer-lock, so it only accepts clicks when the cursor is free.
 *
 * Styled from the brand tokens in `src/ui/brand.js` (DESIGN.md), so the bar the
 * player sees in a match is the same material as the lobby they came from —
 * Gunmetal panel, 1px Hairline, 8px radius, Melt Green kept to the online dot.
 *
 * Room presence — somebody joined, somebody left — is the one notification that
 * does NOT go through `toast()`. It is news the player never asked for and it
 * changes who they are fighting, so it gets the card in `src/ui/presence.js`,
 * shared with the lobby. See `presence()` below.
 */

import { installBrand } from '../ui/brand.js';
import { pushPresence } from '../ui/presence.js';

const CSS = `
.cod-mp { position: fixed; inset: 0; pointer-events: none; z-index: 40;
  font-family: var(--wm-body); color: var(--wm-fg); -webkit-font-smoothing: antialiased; }
.cod-mp *, .cod-mp *::before, .cod-mp *::after { box-sizing: border-box; }
.cod-mp button, .cod-mp input { font-family: inherit; }
.cod-mp :focus-visible { outline: 2px solid var(--wm-accent); outline-offset: 2px; }

.cod-mp .bar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 7px 10px 7px 12px;
  background: var(--wm-panel); border: 1px solid var(--wm-border);
  border-radius: var(--wm-r); backdrop-filter: blur(8px); pointer-events: auto;
  box-shadow: var(--wm-shadow); max-width: 92vw; }
/* Square dots: enterprise-software geometry, never a glowing orb. */
.cod-mp .dot { width: 8px; height: 8px; border-radius: 2px; background: var(--wm-danger);
  flex: none; transition: background var(--wm-t); }
.cod-mp .dot.on { background: var(--wm-ok); }
.cod-mp .dot.wait { background: var(--wm-warn); }
.cod-mp .room { font-size: 12px; letter-spacing: .015em; white-space: nowrap;
  color: var(--wm-muted-fg); }
.cod-mp .room b { font-family: var(--wm-display); font-size: 17px; letter-spacing: .12em;
  font-weight: 400; color: var(--wm-fg); text-transform: uppercase; }
.cod-mp .count { font-size: 11px; color: var(--wm-muted-fg); white-space: nowrap; }
.cod-mp .btn { pointer-events: auto; cursor: pointer; border: 1px solid var(--wm-border);
  background: transparent; color: var(--wm-fg-dim); font-size: 12px; font-weight: 600;
  letter-spacing: .02em; padding: 5px 10px; border-radius: var(--wm-r-sm); white-space: nowrap;
  transition: color var(--wm-t), border-color var(--wm-t), background var(--wm-t); }
.cod-mp .btn:hover { color: var(--wm-fg); border-color: var(--wm-accent); background: var(--wm-panel-2); }
.cod-mp .btn.copied { color: var(--wm-ok); border-color: var(--wm-ok); background: transparent; }
.cod-mp .name-in { pointer-events: auto; width: 104px; background: var(--wm-panel-2);
  border: 1px solid var(--wm-border); border-radius: var(--wm-r-sm); color: var(--wm-fg);
  font-size: 12px; font-weight: 600; padding: 5px 8px; transition: border-color var(--wm-t); }
.cod-mp .name-in:hover { border-color: var(--wm-muted-fg); }
.cod-mp .name-in:focus { outline: none; border-color: var(--wm-accent); }

.cod-mp .toasts { position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 6px; width: max-content; }
.cod-mp .toast { font-size: 12px; padding: 6px 12px; border-radius: var(--wm-r-sm);
  background: var(--wm-panel); border: 1px solid var(--wm-border); color: var(--wm-fg-dim);
  animation: cod-fade 3.2s ease forwards; }
.cod-mp .toast b { color: var(--wm-fg); font-weight: 600; }
.cod-mp .toast .k { color: var(--wm-warn); font-weight: 600; }
@keyframes cod-fade { 0%{opacity:0;transform:translateY(-6px)} 8%{opacity:1;transform:none}
  80%{opacity:1} 100%{opacity:0} }

.cod-mp .board { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  min-width: 360px; max-width: 90vw; background: var(--wm-panel);
  border: 1px solid var(--wm-border); border-radius: var(--wm-r); padding: 18px 20px;
  backdrop-filter: blur(10px); box-shadow: var(--wm-shadow-lift); display: none; }
.cod-mp .board.show { display: block; }
.cod-mp .board h2 { font-family: var(--wm-display); font-weight: 400; font-size: 22px;
  letter-spacing: .08em; color: var(--wm-fg); margin: 0; text-transform: uppercase; }
.cod-mp .board .rm { font-size: 11px; font-weight: 600; letter-spacing: .1em;
  text-transform: uppercase; color: var(--wm-muted-fg); margin: 5px 0 14px; }
.cod-mp table { width: 100%; border-collapse: collapse; }
.cod-mp th { font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--wm-muted-fg);
  text-transform: uppercase; text-align: right; padding: 0 8px 9px; }
.cod-mp th.l { text-align: left; }
.cod-mp td { font-size: 13px; padding: 8px; text-align: right; color: var(--wm-fg-dim);
  border-top: 1px solid var(--wm-border); font-variant-numeric: tabular-nums; }
.cod-mp td.l { text-align: left; font-weight: 500; color: var(--wm-fg); }
.cod-mp tr.me td { background: var(--wm-panel-2); color: var(--wm-fg); }
/* Livery swatch. The only colour in this overlay that is not a brand token,
   because it is not decoration: it is the datum that says which body in the
   level is this row. It comes from ai's palette via net, never from a literal
   here — see renderRoster. */
.cod-mp td.l .lv { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
  margin-right: 8px; vertical-align: baseline; box-shadow: 0 0 0 1px var(--wm-border); }
.cod-mp .hintkey { position: absolute; bottom: 12px; left: 12px; font-size: 11px;
  font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--wm-muted-fg); }
.cod-mp .hintkey .k { border: 1px solid var(--wm-border); border-radius: 3px;
  padding: 1px 5px; margin-right: 4px; color: var(--wm-fg-dim); }
`;

export class NetUI {
  constructor() {
    installBrand();
    if (!document.getElementById('cod-mp-style')) {
      const s = document.createElement('style');
      s.id = 'cod-mp-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const host = document.getElementById('ui') ?? document.body;
    this.root = document.createElement('div');
    this.root.className = 'cod-mp';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <div class="bar">
        <span class="dot wait" data-dot></span>
        <span class="room">ROOM <b data-room>------</b></span>
        <span class="count" data-count>connecting…</span>
        <input class="name-in" data-name maxlength="20" spellcheck="false" title="Your callsign" />
        <button class="btn" data-copy>Copy invite link</button>
      </div>
      <div class="toasts" data-toasts></div>
      <div class="board" data-board>
        <h2>Scoreboard</h2>
        <div class="rm" data-board-room></div>
        <table>
          <thead><tr><th class="l">Operative</th><th>Kills</th><th>Deaths</th><th>K/D</th></tr></thead>
          <tbody data-rows></tbody>
        </table>
      </div>
      <div class="hintkey"><span class="k">Tab</span>Scoreboard
        <span class="k" style="margin-left:10px">Enter</span>Chat
        <span class="k" style="margin-left:10px">Esc</span>Menu</div>
    `;

    this.dot = this.root.querySelector('[data-dot]');
    this.roomEl = this.root.querySelector('[data-room]');
    this.countEl = this.root.querySelector('[data-count]');
    this.nameIn = this.root.querySelector('[data-name]');
    this.copyBtn = this.root.querySelector('[data-copy]');
    this.toasts = this.root.querySelector('[data-toasts]');
    this.board = this.root.querySelector('[data-board]');
    this.boardRoom = this.root.querySelector('[data-board-room]');
    this.rows = this.root.querySelector('[data-rows]');

    this.onCopy = null;
    this.onName = null;
    this.copyBtn.addEventListener('click', () => this.onCopy?.());
    this.nameIn.addEventListener('change', () => this.onName?.(this.nameIn.value.trim()));
    this.nameIn.addEventListener('keydown', (e) => e.stopPropagation());
  }

  /**
   * Hide the whole overlay. The Match Start view shows the room code and the
   * invite button itself, and this bar would otherwise ghost through its scrim.
   */
  setHidden(hidden) {
    this.root.style.display = hidden ? 'none' : '';
  }

  setRoom(code) {
    this.roomEl.textContent = code.toUpperCase();
    this.boardRoom.textContent = `Room ${code.toUpperCase()} · free-for-all`;
  }
  setName(name) {
    this.nameIn.value = name;
  }
  setStatus(state, count) {
    this.dot.className = 'dot ' + (state === 'on' ? 'on' : state === 'wait' ? 'wait' : '');
    if (state === 'on') this.countEl.textContent = count <= 1 ? 'waiting for players…' : `${count} in match`;
    else if (state === 'wait') this.countEl.textContent = 'connecting…';
    else this.countEl.textContent = 'offline — reconnecting…';
  }
  flashCopied() {
    this.copyBtn.classList.add('copied');
    this.copyBtn.textContent = 'Link copied!';
    setTimeout(() => {
      this.copyBtn.classList.remove('copied');
      this.copyBtn.textContent = 'Copy invite link';
    }, 1400);
  }

  toast(html) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3300);
  }

  /**
   * Somebody else entered or left the room.
   *
   * Pushed into the same column as the toasts — one stack, so a card can never
   * land on top of the killfeed — but as the full presence card rather than a
   * 12px line. `name` is set as text by the card, so no escaping here.
   *
   * @param {'join'|'leave'} kind
   * @param {string} name
   * @param {object} [o] { colour: their livery as CSS or null, count: in room }
   */
  presence(kind, name, o) {
    pushPresence(this.toasts, kind, name, o);
  }

  showBoard(show) {
    this.board.classList.toggle('show', show);
  }

  /**
   * The scoreboard. `colourOf(row)` returns a CSS colour for a player's livery,
   * or null; `net` supplies it out of `ai`'s palette, because a free-for-all
   * with no name tags over heads leaves the swatch as the only place you can
   * learn which colour in the level is you.
   */
  renderRoster(list, myId, colourOf = null) {
    list = [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.rows.innerHTML = '';
    for (const p of list) {
      const tr = document.createElement('tr');
      if (p.id === myId) tr.className = 'me';
      const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
      const c = colourOf?.(p) ?? null;
      // Attribute, not innerHTML: the colour is generated but it still goes
      // through the DOM rather than through a string, so nothing in this row
      // can ever be a markup injection point.
      const dot = document.createElement('span');
      dot.className = 'lv';
      if (c) dot.style.background = c;
      const name = document.createElement('td');
      name.className = 'l';
      if (c) name.appendChild(dot);
      name.appendChild(
        document.createTextNode(`${p.name}${p.id === myId ? ' (you)' : ''}`)
      );
      tr.appendChild(name);
      tr.insertAdjacentHTML('beforeend', `<td>${p.kills}</td><td>${p.deaths}</td><td>${kd}</td>`);
      this.rows.appendChild(tr);
    }
  }

  dispose() {
    this.root.remove();
  }
}
