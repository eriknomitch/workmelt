/**
 * The Match Start view: the screen the game now opens on instead of dropping
 * straight into a firefight.
 *
 * A map picker on top, then two ways in side by side, because they answer
 * different questions:
 *   • MAP — which level to fight on. In a room this is the ROOM's map, so
 *     picking one here asks the relay and everybody switches together.
 *   • BOTS — pick a garrison size and go. No waiting, no second player.
 *   • MULTIPLAYER — share the room link, and when someone joins, both players
 *     press READY; the relay starts the countdown once everyone has.
 *
 * Self-contained DOM + CSS (same pattern as src/net/ui.js) so it does not reach
 * into the HUD subsystem's stylesheet. It renders a model and reports clicks —
 * every decision belongs to src/match/index.js.
 */

const CSS = `
.cod-ms { position: fixed; inset: 0; z-index: 60; overflow-y: auto; cursor: default;
  font-family: "Inter","Helvetica Neue",Arial,sans-serif; color: #e6eef4;
  -webkit-font-smoothing: antialiased; letter-spacing: .04em;
  background: radial-gradient(120% 100% at 50% 0%, rgba(6,10,14,0.72), rgba(3,5,8,0.93));
  backdrop-filter: blur(3px); opacity: 0; transition: opacity .22s ease; }
/* The panels centre in the viewport when they fit and scroll when they don't —
   a laptop in a short window must still be able to reach the start button. */
.cod-ms .wrap { min-height: 100%; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 22px; padding: 24px; }
.cod-ms.show { opacity: 1; }
.cod-ms.hide { display: none; }
.cod-ms * { box-sizing: border-box; }
.cod-ms button { font-family: inherit; letter-spacing: .08em; }

.cod-ms .head { text-align: center; }
.cod-ms .head .game { font-size: 11px; color: #7d8b96; text-transform: uppercase;
  letter-spacing: .34em; }
.cod-ms .head h1 { font-size: 30px; font-weight: 800; text-transform: uppercase;
  letter-spacing: .22em; margin: 6px 0 0; color: #f2f7fa;
  text-shadow: 0 2px 18px rgba(0,0,0,.7); }
.cod-ms .head .rule { width: 210px; height: 1px; margin: 12px auto 0;
  background: linear-gradient(90deg, transparent, rgba(255,176,42,.75), transparent); }

/* ---- map picker ---------------------------------------------------------
   A row of cards above the two start panels, because the map is the first
   decision a player makes and the one that changes what the other two mean. */
.cod-ms .maps { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 8px; }
.cod-ms .maps .lbl { display: flex; align-items: baseline; gap: 10px; font-size: 11px;
  font-weight: 700; text-transform: uppercase; letter-spacing: .24em; color: #ffb02a; }
.cod-ms .maps .lbl em { font-style: normal; font-size: 10px; letter-spacing: .14em;
  color: #7d8b96; text-transform: none; }
.cod-ms .cards { display: flex; gap: 12px; flex-wrap: wrap; }
.cod-ms .mapcard { flex: 1 1 240px; max-width: 440px; display: flex; flex-direction: column;
  gap: 3px; padding: 12px 13px; text-align: left; cursor: pointer; color: #b9c8d4;
  background: rgba(9,13,18,0.82); border: 1px solid rgba(120,170,200,0.2);
  border-radius: 10px; transition: background .15s, border-color .15s, color .15s; }
.cod-ms .mapcard:hover:not(:disabled) { background: rgba(60,96,122,0.5); border-color: rgba(150,205,235,0.6); }
.cod-ms .mapcard.on { background: rgba(255,176,42,0.13); border-color: #ffb02a; }
.cod-ms .mapcard:disabled { opacity: .5; cursor: not-allowed; }
.cod-ms .mapcard .nm { font-size: 15px; font-weight: 800; letter-spacing: .14em;
  text-transform: uppercase; color: #dfeaf2; }
.cod-ms .mapcard.on .nm { color: #ffd48a; }
.cod-ms .mapcard .sub { font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
  color: #7d8b96; }
.cod-ms .mapcard .bl { margin-top: 4px; font-size: 11px; line-height: 1.45; color: #93a4b1;
  letter-spacing: .01em; }
.cod-ms .mapcard .sz { margin-top: 4px; font-size: 10px; letter-spacing: .16em; color: #62707c; }

.cod-ms .panels { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center;
  width: 100%; max-width: 900px; }
.cod-ms .panel { flex: 1 1 320px; max-width: 430px; min-height: 268px; display: flex;
  flex-direction: column; gap: 12px; padding: 18px 18px 16px;
  background: rgba(9,13,18,0.82); border: 1px solid rgba(120,170,200,0.2);
  border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.5); }
.cod-ms .panel h2 { font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .24em; color: #ffb02a; margin: 0; }
.cod-ms .panel.mp h2 { color: #7fd6ff; }
.cod-ms .panel p { font-size: 12px; line-height: 1.5; color: #93a4b1; margin: 0; }
.cod-ms .grow { flex: 1 1 auto; }

.cod-ms .seg { display: flex; gap: 6px; }
.cod-ms .seg button { flex: 1 1 0; padding: 8px 4px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; cursor: pointer; color: #b9c8d4;
  background: rgba(26,34,42,0.7); border: 1px solid rgba(120,170,200,0.22);
  border-radius: 7px; transition: background .15s, border-color .15s, color .15s; }
.cod-ms .seg button:hover { background: rgba(60,96,122,0.6); color: #eaf4fa; }
.cod-ms .seg button.on { background: rgba(255,176,42,0.16); border-color: #ffb02a; color: #ffd48a; }

.cod-ms .btn { width: 100%; padding: 11px 12px; font-size: 12px; font-weight: 800;
  text-transform: uppercase; cursor: pointer; color: #dfeaf2;
  background: rgba(30,42,52,0.8); border: 1px solid rgba(120,170,200,0.3);
  border-radius: 8px; transition: background .15s, border-color .15s, color .15s; }
.cod-ms .btn:hover:not(:disabled) { background: rgba(60,110,140,0.6); border-color: rgba(150,205,235,0.7); }
.cod-ms .btn:disabled { opacity: .42; cursor: not-allowed; }
.cod-ms .btn.amber { background: rgba(255,176,42,0.18); border-color: rgba(255,176,42,.75); color: #ffd48a; }
.cod-ms .btn.amber:hover:not(:disabled) { background: rgba(255,176,42,0.3); }
.cod-ms .btn.go { background: rgba(87,217,122,0.18); border-color: rgba(87,217,122,.7); color: #c9f7d7; }
.cod-ms .btn.go:hover:not(:disabled) { background: rgba(87,217,122,0.3); }
.cod-ms .btn.small { width: auto; padding: 7px 10px; font-size: 10px; font-weight: 700; }

.cod-ms .room { display: flex; align-items: center; gap: 10px; padding: 9px 11px;
  background: rgba(4,8,12,0.7); border: 1px solid rgba(120,170,200,0.18); border-radius: 8px; }
.cod-ms .room .lbl { font-size: 10px; color: #7d8b96; text-transform: uppercase; letter-spacing: .2em; }
.cod-ms .room .code { font-size: 17px; font-weight: 800; color: #7fd6ff; letter-spacing: .18em;
  text-transform: uppercase; }
.cod-ms .room .grow { text-align: right; }

.cod-ms .roster { display: flex; flex-direction: column; gap: 4px; min-height: 74px; }
.cod-ms .row { display: flex; align-items: center; gap: 9px; padding: 6px 9px; font-size: 12px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 7px; }
.cod-ms .row .dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: #6c7a86; box-shadow: 0 0 7px currentColor; color: transparent; }
.cod-ms .row.ready .dot { background: #57d97a; color: #57d97a; }
.cod-ms .row.deployed .dot { background: #ffb02a; color: #ffb02a; }
.cod-ms .row .who { flex: 1 1 auto; font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.cod-ms .row.me .who { color: #7fd6ff; }
.cod-ms .row .st { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; color: #7d8b96; }
.cod-ms .row.ready .st { color: #57d97a; }
.cod-ms .row.deployed .st { color: #ffb02a; }
.cod-ms .empty { font-size: 12px; color: #7d8b96; padding: 6px 9px; }

.cod-ms .status { font-size: 11px; color: #9fb0bd; min-height: 15px; }
.cod-ms .status b { color: #7fd6ff; }
.cod-ms .hint { font-size: 10px; color: #6f7d88; letter-spacing: .14em; text-transform: uppercase; }

.cod-ms .count { text-align: center; }
.cod-ms .count .n { font-size: 92px; font-weight: 800; line-height: 1; color: #ffb02a;
  text-shadow: 0 6px 40px rgba(255,150,20,.35); font-variant-numeric: tabular-nums; }
.cod-ms .count .n.beat { animation: cod-ms-beat .55s ease-out; }
.cod-ms .count .lbl { margin-top: 14px; font-size: 12px; letter-spacing: .34em;
  text-transform: uppercase; color: #cfe0ec; }
@keyframes cod-ms-beat { 0% { transform: scale(1.5); opacity: .25 } 40% { transform: none; opacity: 1 }
  100% { transform: none; opacity: 1 } }

/* Utility, last and !important on purpose: it has to beat the display value of
   whatever it is put on (.panels is a flex row of equal specificity). */
.cod-ms .hide { display: none !important; }

/* Short windows: trade the display type and the panel floor for the buttons. */
@media (max-height: 620px) {
  .cod-ms .wrap { gap: 14px; padding: 16px; }
  .cod-ms .head h1 { font-size: 22px; }
  .cod-ms .head .rule { margin-top: 8px; }
  .cod-ms .panel { min-height: 0; padding: 14px; gap: 9px; }
  .cod-ms .count .n { font-size: 68px; }
  .cod-ms .mapcard { padding: 9px 11px; }
  .cod-ms .mapcard .bl { display: none; }
}
`;

/** Sizes offered for the bot garrison; `squads` × `perSquad` hostiles. */
export const BOT_PRESETS = [
  { key: 'off', label: 'None', squads: 0, perSquad: 0, note: 'Players only — nobody but whoever joins your room.' },
  { key: 'light', label: 'Light', squads: 1, perSquad: 3, note: 'One patrol of 3. A quiet map with something to shoot.' },
  { key: 'standard', label: 'Standard', squads: 2, perSquad: 3, note: 'Two squads of 3 on patrol routes — the default garrison.' },
  { key: 'heavy', label: 'Heavy', squads: 3, perSquad: 4, note: 'Three squads of 4. Contact almost everywhere.' },
];

export class MatchStartUI {
  constructor({ multiplayer = true } = {}) {
    if (!document.getElementById('cod-ms-style')) {
      const s = document.createElement('style');
      s.id = 'cod-ms-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const host = document.getElementById('ui') ?? document.body;
    this.root = document.createElement('div');
    this.root.className = 'cod-ms hide';
    host.appendChild(this.root);

    this.multiplayer = multiplayer;
    this.onMap = null;
    this.onStartBots = null;
    this.onToggleReady = null;
    this.onDeploy = null;
    this.onCopyInvite = null;
    this.onBots = null;

    this.root.innerHTML = `
     <div class="wrap">
      <div class="head">
        <div class="game">Workmelt</div>
        <h1>Match Start</h1>
        <div class="rule"></div>
      </div>
      <div class="maps" data-maps>
        <div class="lbl">Map <em data-map-note></em></div>
        <div class="cards" data-cards></div>
      </div>
      <div class="panels" data-panels>
        <div class="panel">
          <h2>Bots</h2>
          <p>Deploy on your own against the garrison AI. Starts the moment you press it.</p>
          <div class="seg" data-bots></div>
          <p data-bot-note></p>
          <div class="grow"></div>
          <button type="button" class="btn amber" data-start>Start match</button>
        </div>
        <div class="panel mp">
          <h2>Multiplayer</h2>
          <div class="room">
            <span class="lbl">Room</span>
            <span class="code" data-room>------</span>
            <span class="grow"><button type="button" class="btn small" data-copy>Copy invite link</button></span>
          </div>
          <div class="roster" data-roster></div>
          <div class="grow"></div>
          <div class="status" data-status>Connecting…</div>
          <button type="button" class="btn" data-ready disabled>Ready</button>
        </div>
      </div>
      <div class="count hide" data-count>
        <div class="n" data-count-n>3</div>
        <div class="lbl" data-count-lbl>Match starting</div>
      </div>
      <div class="hint" data-hint>Bots start instantly · Multiplayer waits for both players to ready up</div>
     </div>
    `;

    this.mapsEl = this.root.querySelector('[data-maps]');
    this.cardsEl = this.root.querySelector('[data-cards]');
    this.mapNote = this.root.querySelector('[data-map-note]');
    this.panels = this.root.querySelector('[data-panels]');
    this.botSeg = this.root.querySelector('[data-bots]');
    this.botNote = this.root.querySelector('[data-bot-note]');
    this.startBtn = this.root.querySelector('[data-start]');
    this.roomEl = this.root.querySelector('[data-room]');
    this.copyBtn = this.root.querySelector('[data-copy]');
    this.rosterEl = this.root.querySelector('[data-roster]');
    this.statusEl = this.root.querySelector('[data-status]');
    this.readyBtn = this.root.querySelector('[data-ready]');
    this.countEl = this.root.querySelector('[data-count]');
    this.countN = this.root.querySelector('[data-count-n]');
    this.countLbl = this.root.querySelector('[data-count-lbl]');
    this.hintEl = this.root.querySelector('[data-hint]');
    this.mpPanel = this.root.querySelector('.panel.mp');

    /** id -> card element, filled by setMaps(). */
    this.mapBtns = new Map();
    this.mapId = null;
    this.mapBusy = false;
    /** The room is already playing, so its level is no longer up for a vote. */
    this.mapLocked = false;
    this.mapNoteIdle = '';

    this.botBtns = new Map();
    for (const p of BOT_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      b.addEventListener('click', () => this.onBots?.(p.key));
      this.botSeg.appendChild(b);
      this.botBtns.set(p.key, b);
    }

    this.startBtn.addEventListener('click', () => this.onStartBots?.());
    this.readyBtn.addEventListener('click', () => this._readyClick());
    this.copyBtn.addEventListener('click', () => this.onCopyInvite?.());
    // Keys typed at this screen are menu input, not gameplay input.
    this.root.addEventListener('keydown', (e) => e.stopPropagation());

    if (!multiplayer) {
      this.mpPanel.remove();
      this.hintEl.textContent = 'Multiplayer disabled by ?mp=0';
    }
    /** What the ready button currently does; render() keeps it honest. */
    this._mode = 'none';
  }

  /**
   * Build the map cards. Called once, from the list `world` publishes — this
   * view never imports the world subsystem, it just renders what it is given.
   */
  setMaps(list = []) {
    this.cardsEl.innerHTML = '';
    this.mapBtns.clear();
    for (const m of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mapcard';
      b.innerHTML =
        `<span class="nm">${escapeHtml(m.name)}</span>` +
        `<span class="sub">${escapeHtml(m.subtitle ?? '')}</span>` +
        `<span class="bl">${escapeHtml(m.blurb ?? '')}</span>` +
        `<span class="sz">${escapeHtml(m.size ?? '')}</span>`;
      b.addEventListener('click', () => this.onMap?.(m.id));
      this.cardsEl.appendChild(b);
      this.mapBtns.set(m.id, b);
    }
    this.mapsEl.classList.toggle('hide', list.length < 2);
    this.setMap(this.mapId);
  }

  setMap(id) {
    this.mapId = id;
    for (const [k, b] of this.mapBtns) b.classList.toggle('on', k === id);
  }

  /**
   * Building a level takes a beat and re-runs the shader pre-warm. Lock the
   * cards and the start buttons while it happens, so nobody can start a match
   * against half a map.
   */
  setMapBusy(on) {
    this.mapBusy = !!on;
    this.startBtn.disabled = !!on;
    this._syncMap();
  }

  /**
   * A live room's level is settled: the relay refuses a change once anybody is
   * deployed, so offering the cards would be offering a button that does
   * nothing. Say so rather than failing silently.
   */
  setMapLocked(on) {
    this.mapLocked = !!on;
    this._syncMap();
  }

  /** The caller's line — what the strip says when nothing is overriding it. */
  setMapNote(text) {
    this.mapNoteIdle = text ?? '';
    this._syncMap();
  }

  _syncMap() {
    const off = this.mapBusy || this.mapLocked;
    for (const b of this.mapBtns.values()) b.disabled = off;
    this.mapNote.textContent = this.mapBusy
      ? 'Loading…'
      : this.mapLocked
        ? 'Locked — the match is already running'
        : this.mapNoteIdle ?? '';
  }

  setBots(key) {
    for (const [k, b] of this.botBtns) b.classList.toggle('on', k === key);
    const p = BOT_PRESETS.find((x) => x.key === key);
    this.botNote.textContent = p?.note ?? '';
    this.startBtn.textContent = p && p.squads ? `Start match vs ${p.squads * p.perSquad} bots` : 'Start match';
    this.startBtn.disabled = this.mapBusy;
  }

  setRoom(code) {
    this.roomEl.textContent = code ?? '------';
  }

  flashCopied() {
    this.copyBtn.textContent = 'Copied!';
    clearTimeout(this._copyT);
    this._copyT = setTimeout(() => {
      this.copyBtn.textContent = 'Copy invite link';
    }, 1400);
  }

  /**
   * @param {object} m { connected, live, players:[{id,name,ready,deployed}],
   *                     myId, ready }
   */
  render(m) {
    if (!this.multiplayer) return;
    const players = m.players ?? [];
    const others = players.filter((p) => p.id !== m.myId);

    this.rosterEl.innerHTML = '';
    if (!players.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = m.connected ? 'Nobody here yet.' : 'Not connected.';
      this.rosterEl.appendChild(d);
    }
    for (const p of players) {
      const row = document.createElement('div');
      const state = p.deployed ? 'deployed' : p.ready ? 'ready' : 'waiting';
      row.className = `row ${state}${p.id === m.myId ? ' me' : ''}`;
      row.innerHTML =
        `<span class="dot"></span>` +
        `<span class="who">${escapeHtml(p.name)}${p.id === m.myId ? ' (you)' : ''}</span>` +
        `<span class="st">${state === 'deployed' ? 'in match' : state === 'ready' ? 'ready' : 'not ready'}</span>`;
      this.rosterEl.appendChild(row);
    }

    if (this.mapBusy) {
      this._mode = 'none';
      this.statusEl.textContent = 'Loading the map…';
      this.readyBtn.textContent = 'Ready';
      this.readyBtn.disabled = true;
      this.readyBtn.className = 'btn';
      return;
    }
    this.setMapLocked(!!m.live);
    if (!m.connected) {
      this._mode = 'none';
      this.statusEl.textContent = m.everConnected
        ? 'Offline — reconnecting to the relay…'
        : 'Connecting to the relay…';
      this.readyBtn.textContent = 'Ready';
      this.readyBtn.disabled = true;
      this.readyBtn.className = 'btn';
      return;
    }
    if (m.live) {
      this._mode = 'deploy';
      this.statusEl.innerHTML = 'Match already in progress — drop in whenever you like.';
      this.readyBtn.textContent = 'Deploy now';
      this.readyBtn.disabled = false;
      this.readyBtn.className = 'btn go';
      return;
    }
    if (!others.length) {
      // Alone in the room. Readying up early is allowed and sticks — the match
      // then starts as soon as whoever joins presses ready — so the button stays
      // live when it is the way to undo that.
      this._mode = m.ready ? 'ready' : 'wait';
      this.statusEl.innerHTML = m.ready
        ? 'You are ready — the match starts when someone joins and readies up.'
        : 'Waiting for another player — send them the invite link.';
      this.readyBtn.textContent = m.ready ? 'Cancel ready' : 'Ready';
      this.readyBtn.disabled = !m.ready;
      this.readyBtn.className = 'btn';
      return;
    }
    this._mode = 'ready';
    const readyCount = players.filter((p) => p.ready).length;
    this.statusEl.innerHTML = m.ready
      ? `You are ready — <b>${readyCount}/${players.length}</b> standing by.`
      : `<b>${readyCount}/${players.length}</b> ready. Press ready to start the countdown.`;
    this.readyBtn.textContent = m.ready ? 'Cancel ready' : 'Ready';
    this.readyBtn.disabled = false;
    this.readyBtn.className = m.ready ? 'btn' : 'btn go';
  }

  _readyClick() {
    if (this._mode === 'deploy') this.onDeploy?.();
    else if (this._mode === 'ready') this.onToggleReady?.();
  }

  setVisible(on) {
    this.root.classList.toggle('hide', !on);
    // Let the display change land before the opacity transition starts.
    if (on) requestAnimationFrame(() => this.root.classList.add('show'));
    else this.root.classList.remove('show');
  }

  /** Swap the map row and the two panels for the big countdown number. */
  showCountdown(on) {
    this.mapsEl.classList.toggle('hide', on || this.mapBtns.size < 2);
    this.panels.classList.toggle('hide', on);
    this.countEl.classList.toggle('hide', !on);
    this.hintEl.classList.toggle('hide', on);
  }

  setCountdown(n, label = 'Match starting') {
    const text = n > 0 ? String(n) : 'GO';
    if (this.countN.textContent !== text) {
      this.countN.textContent = text;
      // Restart the pulse: the class has to leave the element for one frame.
      this.countN.classList.remove('beat');
      void this.countN.offsetWidth;
      this.countN.classList.add('beat');
    }
    this.countLbl.textContent = label;
  }

  dispose() {
    clearTimeout(this._copyT);
    this.root.remove();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
