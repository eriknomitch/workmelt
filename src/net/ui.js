/**
 * Multiplayer overlay: invite bar, live roster/scoreboard, connection status,
 * join/leave + kill toasts, and a name field. Self-contained DOM + CSS so it
 * doesn't depend on the HUD subsystem's internals. Everything sits under the
 * game canvas' pointer-lock, so it only accepts clicks when the cursor is free.
 */

const CSS = `
.cod-mp { position: fixed; inset: 0; pointer-events: none; z-index: 40;
  font-family: "Inter","Helvetica Neue",Arial,sans-serif; color: #dfe7ee;
  -webkit-font-smoothing: antialiased; }
.cod-mp button { font-family: inherit; }

.cod-mp .bar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 7px 10px 7px 12px;
  background: rgba(10,14,18,0.72); border: 1px solid rgba(120,170,200,0.22);
  border-radius: 10px; backdrop-filter: blur(8px); pointer-events: auto;
  box-shadow: 0 6px 24px rgba(0,0,0,0.4); max-width: 92vw; }
.cod-mp .dot { width: 9px; height: 9px; border-radius: 50%; background: #d9534f;
  box-shadow: 0 0 8px currentColor; color: #d9534f; flex: none; transition: color .3s,background .3s; }
.cod-mp .dot.on { background: #57d97a; color: #57d97a; }
.cod-mp .dot.wait { background: #e6b34a; color: #e6b34a; }
.cod-mp .room { font-size: 12px; letter-spacing: .5px; white-space: nowrap; }
.cod-mp .room b { color: #7fd6ff; letter-spacing: 2px; font-weight: 700; text-transform: uppercase; }
.cod-mp .count { font-size: 11px; color: #9fb0bd; white-space: nowrap; }
.cod-mp .btn { pointer-events: auto; cursor: pointer; border: 1px solid rgba(120,170,200,0.3);
  background: rgba(30,40,50,0.6); color: #cfe6f4; font-size: 11px; font-weight: 600;
  letter-spacing: .4px; padding: 5px 9px; border-radius: 7px; white-space: nowrap;
  transition: background .15s, border-color .15s; }
.cod-mp .btn:hover { background: rgba(60,110,140,0.55); border-color: rgba(140,200,230,0.6); }
.cod-mp .btn.copied { background: rgba(60,150,90,0.6); border-color: #57d97a; color: #eafff0; }
.cod-mp .name-in { pointer-events: auto; width: 92px; background: rgba(20,26,32,0.85);
  border: 1px solid rgba(120,170,200,0.25); border-radius: 7px; color: #eaf2f8;
  font-size: 11px; padding: 5px 7px; }
.cod-mp .name-in:focus { outline: none; border-color: #7fd6ff; }

.cod-mp .toasts { position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 5px; width: max-content; }
.cod-mp .toast { font-size: 12px; padding: 5px 12px; border-radius: 8px;
  background: rgba(10,14,18,0.72); border: 1px solid rgba(120,170,200,0.18);
  animation: cod-fade 3.2s ease forwards; }
.cod-mp .toast b { color: #7fd6ff; }
.cod-mp .toast .k { color: #ff8f6b; }
@keyframes cod-fade { 0%{opacity:0;transform:translateY(-6px)} 8%{opacity:1;transform:none}
  80%{opacity:1} 100%{opacity:0} }

.cod-mp .board { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  min-width: 320px; max-width: 90vw; background: rgba(8,11,15,0.88);
  border: 1px solid rgba(120,170,200,0.25); border-radius: 12px; padding: 16px 18px;
  backdrop-filter: blur(10px); box-shadow: 0 20px 60px rgba(0,0,0,0.6); display: none; }
.cod-mp .board.show { display: block; }
.cod-mp .board h2 { font-size: 13px; letter-spacing: 3px; color: #7fd6ff; margin: 0 0 4px;
  text-transform: uppercase; font-weight: 700; }
.cod-mp .board .rm { font-size: 11px; color: #9fb0bd; margin-bottom: 12px; }
.cod-mp table { width: 100%; border-collapse: collapse; }
.cod-mp th { font-size: 10px; letter-spacing: 1px; color: #8ea0ad; text-transform: uppercase;
  text-align: right; padding: 4px 8px; border-bottom: 1px solid rgba(120,170,200,0.18); }
.cod-mp th.l { text-align: left; }
.cod-mp td { font-size: 13px; padding: 6px 8px; text-align: right; }
.cod-mp td.l { text-align: left; font-weight: 600; }
.cod-mp tr.me td { color: #7fd6ff; }
.cod-mp .hintkey { position: absolute; bottom: 12px; left: 12px; font-size: 10px;
  color: #7d8b96; letter-spacing: .5px; }
`;

export class NetUI {
  constructor() {
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
          <thead><tr><th class="l">Operator</th><th>Kills</th><th>Deaths</th><th>K/D</th></tr></thead>
          <tbody data-rows></tbody>
        </table>
      </div>
      <div class="hintkey">TAB scoreboard · ENTER chat</div>
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

  setRoom(code) {
    this.roomEl.textContent = code;
    this.boardRoom.textContent = `Room ${code.toUpperCase()} — free-for-all`;
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

  showBoard(show) {
    this.board.classList.toggle('show', show);
  }

  renderRoster(list, myId) {
    list = [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.rows.innerHTML = '';
    for (const p of list) {
      const tr = document.createElement('tr');
      if (p.id === myId) tr.className = 'me';
      const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
      tr.innerHTML = `<td class="l">${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</td>` +
        `<td>${p.kills}</td><td>${p.deaths}</td><td>${kd}</td>`;
      this.rows.appendChild(tr);
    }
  }

  dispose() {
    this.root.remove();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
