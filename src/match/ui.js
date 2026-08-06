/**
 * ===========================================================================
 * The lobby — the screen WORKMELT opens on
 * ===========================================================================
 *
 * Styled from `DESIGN.md` (v0.3 — Console Black) through the tokens in
 * `src/ui/brand.js`: a true-black canvas, three hairline-bordered rails, Geist
 * for every string with Geist Mono carrying the tracked-out labels, and Signal
 * Blue kept to selection, live status and the primary action's border.
 *
 * ---------------------------------------------------------------------------
 * THE LAYOUT: THREE RAILS
 * ---------------------------------------------------------------------------
 *
 *   left rail    the ROOM — the invite eyebrow, the active room code, the
 *                relay status and the roster; below them, this client's own
 *                setup (garrison, callsign, settings)
 *   stage        the CURRENT MAP — its name written large, its artwork (or
 *                its blueprint floorplan when no artwork ships), and the
 *                action dock: primary, copy-invite, key hints
 *   right rail   the MAP SELECTOR — one card per enabled map, thumbnail
 *                floorplan plus name and description; the selected card is
 *                the one wearing the Signal Blue border
 *
 * The stage's hero artwork is progressive: `public/maps/<id>.png` is probed
 * per map and shown when it exists; a map without one keeps the floorplan
 * stage, so shipping artwork is dropping a file, not touching this view.
 *
 * ---------------------------------------------------------------------------
 * THE UX CONTRACT: ONE CLICK IN, ONE CLICK TO SHARE
 * ---------------------------------------------------------------------------
 * There is exactly one primary button and it is always the best next move:
 *
 *   alone in the room        PLAY VS N BOTS  deploy immediately vs the garrison
 *   somebody else is here    READY UP        the relay starts when everyone is
 *   already readied up       CANCEL READY    the only thing left to undo
 *   the match is running     DEPLOY NOW      drop into it
 *
 * and exactly one secondary button, live in every one of those states:
 *
 *   COPY INVITE LINK  one click, whatever else is on screen
 *
 * Under the primary sits one optional link, which follows the same rule — it is
 * always the *other* reasonable move, and never a required one (`_paintAlt`).
 *
 * Nothing else on the screen is a required step. The map cards and the garrison
 * chips both have working defaults, the callsign is an inline field, and
 * settings open over the top. `Enter` fires the primary button and `C` copies
 * the link, so the whole screen is also two keystrokes.
 *
 * The map is the one choice that is not this client's alone: in a room it
 * belongs to the ROOM, so a card click is a request the relay answers and the
 * cards lock while the level rebuilds. `src/match/index.js` owns that dance —
 * this view only renders `setMap` / `setMapBusy` / `setMapLocked`.
 *
 * Self-contained DOM + CSS (same pattern as src/net/ui.js) so it does not reach
 * into the HUD subsystem's stylesheet. It renders a model and reports clicks —
 * every decision belongs to src/match/index.js.
 */

import { installBrand, WORDMARK_HTML } from '../ui/brand.js';
import { pushPresence } from '../ui/presence.js';

/** How long a newly-arrived roster row stays highlighted. */
const ROW_FLASH_MS = 1600;

const CSS = `
.wm-lobby {
  position: fixed; inset: 0; z-index: 60; overflow-y: auto; cursor: default;
  font-family: var(--wm-body); color: var(--wm-fg); -webkit-font-smoothing: antialiased;
  /* Console Black: the canvas is the void, at near-full opacity — the live
     scene reads through only where a surface chooses to open a window. */
  background: rgb(var(--wm-bg-rgb) / .97);
  opacity: 0; transition: opacity var(--wm-t-slow);
}
.wm-lobby.show { opacity: 1; }
.wm-lobby.hidden { display: none; }
.wm-lobby *, .wm-lobby *::before, .wm-lobby *::after { box-sizing: border-box; margin: 0; padding: 0; }
.wm-lobby button, .wm-lobby input { font-family: inherit; color: inherit; }
.wm-lobby :focus-visible { outline: 1px solid var(--wm-accent); outline-offset: 2px; }
.wm-lobby .hide { display: none !important; }

/* Three hairline-bordered rails on the void. min-height:100% rather than
   height, so a short window scrolls to the dock instead of clipping it. */
.wm-lobby .shell {
  display: grid; grid-template-columns: 320px minmax(0, 1fr) 372px;
  grid-template-areas: 'left stage right';
  gap: 14px; padding: 14px; min-height: 100%; align-items: stretch;
}
.wm-lobby .col {
  border: 1px solid var(--wm-border); background: rgb(var(--wm-surface-rgb) / .55);
  min-width: 0; min-height: 0;
}

/* The two label registers of Console Black: a tracked-out mono eyebrow with a
   leading tick, and the same mono without one for field labels. */
.wm-lobby .eyebrow {
  font-family: var(--wm-mono); font-size: 10px; font-weight: 500; line-height: 1.6;
  letter-spacing: .24em; text-transform: uppercase; color: var(--wm-muted-fg);
  padding-left: 10px; border-left: 1px solid var(--wm-fg-dim);
}
.wm-lobby .lbl {
  display: block; font-family: var(--wm-mono); font-size: 9.5px; font-weight: 500;
  letter-spacing: .22em; text-transform: uppercase; color: var(--wm-muted-fg);
}

/* ── left rail: the room, then this client's setup ───────────────────────── */
.wm-lobby .rail-left {
  grid-area: left; display: flex; flex-direction: column; gap: 22px; padding: 24px 22px;
}
.wm-lobby .roomzone { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.wm-lobby .roombox { border: 1px solid var(--wm-border); padding: 16px; }
.wm-lobby .roombox-hd { display: flex; align-items: flex-start; gap: 10px; }
.wm-lobby .roombox-hd .lbl { margin-bottom: 10px; }
.wm-lobby .roombox-hd .grow { flex: 1 1 auto; min-width: 0; }
.wm-lobby .code {
  font-family: var(--wm-display); font-size: 30px; font-weight: 300; line-height: 1;
  letter-spacing: .28em; text-transform: uppercase; color: var(--wm-fg);
}
.wm-lobby .icon-btn {
  width: 32px; height: 32px; border-radius: var(--wm-r-sm); background: none;
  border: 1px solid var(--wm-border); color: var(--wm-muted-fg); display: grid;
  place-items: center; cursor: pointer; flex: none;
  transition: color var(--wm-t), border-color var(--wm-t);
}
.wm-lobby .icon-btn:hover { color: var(--wm-fg); border-color: var(--wm-accent); }
.wm-lobby .icon-btn.done { color: var(--wm-ok); border-color: var(--wm-ok); }

/* The relay line: a small square lamp plus a tracked mono status. The lamp is
   the accent while the relay is settling and Success once it is online. */
.wm-lobby .netline {
  display: flex; align-items: center; gap: 9px; margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--wm-border);
  font-family: var(--wm-mono); font-size: 10px; font-weight: 500; letter-spacing: .18em;
  text-transform: uppercase; color: var(--wm-accent);
}
.wm-lobby .netline .sq { width: 7px; height: 7px; background: var(--wm-accent); flex: none; }
.wm-lobby .netline.on { color: var(--wm-ok); }
.wm-lobby .netline.on .sq { background: var(--wm-ok); }
.wm-lobby .netline b { font-weight: 500; }
.wm-lobby .status {
  margin-top: 10px; font-family: var(--wm-mono); font-size: 10px; font-weight: 400;
  line-height: 1.9; letter-spacing: .14em; text-transform: uppercase; color: var(--wm-muted-fg);
}
.wm-lobby .status b { color: var(--wm-fg-dim); font-weight: 500; }

/* roster */
.wm-lobby .roster { overflow-y: auto; min-height: 0; }
.wm-lobby .row {
  display: flex; align-items: center; gap: 10px; padding: 9px 2px;
  transition: background var(--wm-t);
}
.wm-lobby .row + .row { border-top: 1px solid var(--wm-border); }
.wm-lobby .row:hover { background: var(--wm-hover); }
/* Square dots, not circles: the icon language is enterprise-software geometry. */
.wm-lobby .dot { width: 7px; height: 7px; flex: none; background: var(--wm-muted); }
.wm-lobby .row.ready .dot { background: var(--wm-ok); }
.wm-lobby .row.deployed .dot { background: var(--wm-fg); }
/* Warming up: out of the lobby but not in a match — the same amber the relay
   status uses for "not settled yet". */
.wm-lobby .row.warm .dot { background: var(--wm-warn); }
.wm-lobby .row .who {
  flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 500; letter-spacing: .04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--wm-fg-dim);
}
.wm-lobby .row.me .who { color: var(--wm-fg); }
.wm-lobby .row .st {
  font-family: var(--wm-mono); font-size: 9px; font-weight: 500; letter-spacing: .16em;
  text-transform: uppercase; color: var(--wm-muted-fg); flex: none;
}
.wm-lobby .row.ready .st { color: var(--wm-ok); }
.wm-lobby .row.deployed .st { color: var(--wm-fg-dim); }
.wm-lobby .row.warm .st { color: var(--wm-warn); }
/* A row that just appeared. Rebuilt on every lobby frame, so render() carries
   the elapsed time in as a negative delay and the flash keeps running instead
   of restarting. Colour only, no transform — nothing here for
   prefers-reduced-motion to undo. */
.wm-lobby .row.fresh { animation: wm-row-in ${ROW_FLASH_MS}ms cubic-bezier(.2,.85,.3,1) both; }
@keyframes wm-row-in {
  0% { background: var(--wm-hover); box-shadow: inset 3px 0 0 var(--wm-ok); }
  100% { background: transparent; box-shadow: inset 3px 0 0 transparent; }
}
.wm-lobby .empty {
  padding: 4px 2px; font-family: var(--wm-mono); font-size: 10px; line-height: 1.9;
  letter-spacing: .14em; text-transform: uppercase; color: var(--wm-muted-fg);
}

/* this client's setup — pinned under the room, above the sign-off mark */
.wm-lobby .setup {
  margin-top: auto; display: flex; flex-direction: column; gap: 18px;
  padding-top: 18px; border-top: 1px solid var(--wm-border);
}
.wm-lobby .opts .lbl { margin-bottom: 9px; }
.wm-lobby .chips { display: flex; gap: 6px; flex-wrap: wrap; }
.wm-lobby .chip {
  font-family: var(--wm-mono); font-size: 9.5px; font-weight: 500; letter-spacing: .14em;
  text-transform: uppercase; padding: 8px 11px;
  border-radius: var(--wm-r-sm); border: 1px solid var(--wm-border);
  background: transparent; color: var(--wm-muted-fg); cursor: pointer;
  transition: color var(--wm-t), border-color var(--wm-t), background var(--wm-t);
}
.wm-lobby .chip:hover { color: var(--wm-fg); border-color: var(--wm-muted-fg); }
.wm-lobby .chip[aria-pressed="true"] {
  color: var(--wm-fg); border-color: var(--wm-accent); background: rgb(var(--wm-accent-rgb) / .1);
}
.wm-lobby .note {
  font-size: 11px; line-height: 1.55; color: var(--wm-muted-fg); margin-top: 9px; min-height: 17px;
}
.wm-lobby .callsign .lbl { margin-bottom: 9px; }
.wm-lobby .cs-row { display: flex; gap: 8px; align-items: center; }
.wm-lobby .callsign input {
  flex: 1 1 auto; min-width: 0; background: var(--wm-panel-2); border: 1px solid var(--wm-border);
  border-radius: var(--wm-r-sm); padding: 8px 10px; font-size: 12px; font-weight: 500;
  letter-spacing: .04em; transition: border-color var(--wm-t);
}
.wm-lobby .callsign input:hover { border-color: var(--wm-muted-fg); }
.wm-lobby .callsign input:focus { outline: none; border-color: var(--wm-accent); }
.wm-lobby .rail-mark { font-size: 15px; margin-top: 20px; color: var(--wm-fg-dim); }

/* ── stage: the current map, written large ───────────────────────────────── */
.wm-lobby .stage {
  grid-area: stage; position: relative; display: flex; flex-direction: column; overflow: hidden;
}
.wm-lobby .stage-hd { position: relative; z-index: 2; padding: 24px 30px 0; }
.wm-lobby .curmap {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--wm-mono); font-size: 10px; font-weight: 500; letter-spacing: .24em;
  text-transform: uppercase; color: var(--wm-muted-fg);
}
.wm-lobby .curmap svg { flex: none; }
.wm-lobby .hero-name {
  margin: 18px 0 8px; font-family: var(--wm-display); font-weight: 300;
  font-size: clamp(38px, 4.6vw, 68px); line-height: 1.05; letter-spacing: .3em;
  text-transform: uppercase; color: var(--wm-fg); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.wm-lobby .hero-sub {
  font-family: var(--wm-mono); font-size: 10.5px; font-weight: 400; letter-spacing: .3em;
  text-transform: uppercase; color: var(--wm-muted-fg);
}

/* The hero viewport. Artwork when public/maps/<id>.png exists; otherwise the
   map's own floorplan on a faint graticule — the blueprint, not a blank. */
.wm-lobby .hero-view { position: relative; flex: 1 1 auto; min-height: 240px; margin-top: 22px; }
.wm-lobby .hero-img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  object-position: center; display: none;
}
.wm-lobby .stage.has-art .hero-img { display: block; }
.wm-lobby .hero-plan { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px 40px 150px; }
.wm-lobby .hero-plan::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(to right, rgb(var(--wm-fg-rgb) / .03) 1px, transparent 1px) 0 0 / 32px 32px,
    linear-gradient(to bottom, rgb(var(--wm-fg-rgb) / .03) 1px, transparent 1px) 0 0 / 32px 32px;
}
.wm-lobby .stage.has-art .hero-plan { display: none; }
/* The plan is drawn one cell per couple of device pixels; "pixelated" keeps the
   blocks square instead of smearing them at 6x. */
.wm-lobby .hero-plan canvas {
  max-width: 100%; max-height: 100%; width: auto; height: auto;
  image-rendering: pixelated; opacity: .35;
}

/* the action dock — primary, copy, key hints, and the optional alt link */
.wm-lobby .dock {
  position: absolute; z-index: 3; left: 50%; bottom: 22px; transform: translateX(-50%);
  width: min(440px, calc(100% - 44px));
  background: rgb(var(--wm-bg-rgb) / .92); border: 1px solid var(--wm-border);
  padding: 20px 20px 14px; display: flex; flex-direction: column; gap: 10px;
}
.wm-lobby .btn {
  font-family: var(--wm-body); font-size: 12px; font-weight: 500; letter-spacing: .24em;
  text-transform: uppercase; cursor: pointer; border-radius: var(--wm-r);
  border: 1px solid var(--wm-border); background: transparent; color: var(--wm-fg-dim);
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 15px 18px; width: 100%;
  transition: background var(--wm-t), border-color var(--wm-t), color var(--wm-t), transform 90ms linear;
}
.wm-lobby .btn .ic { flex: none; }
/* Primary: a Signal Blue border over a faint blue wash — never a blue fill
   under light text. Hover deepens the wash; active presses down 1px. */
.wm-lobby .btn-primary {
  border-color: var(--wm-accent); color: var(--wm-fg);
  background: rgb(var(--wm-accent-rgb) / .08);
}
.wm-lobby .btn-primary .ic { color: var(--wm-accent); }
.wm-lobby .btn-primary:hover:not(:disabled) { background: rgb(var(--wm-accent-rgb) / .16); }
.wm-lobby .btn-primary:active:not(:disabled) { transform: translateY(1px); }
.wm-lobby .btn-ghost:hover:not(:disabled) { border-color: var(--wm-muted-fg); color: var(--wm-fg); }
.wm-lobby .btn-ghost:active:not(:disabled) { transform: translateY(1px); }
.wm-lobby .btn-ghost.done, .wm-lobby .btn.done { border-color: var(--wm-ok); color: var(--wm-ok); }
.wm-lobby .btn:disabled { opacity: .42; cursor: not-allowed; }
.wm-lobby .keys {
  display: flex; align-items: center; justify-content: center; gap: 20px; padding-top: 4px;
  font-family: var(--wm-mono); font-size: 9px; font-weight: 500; letter-spacing: .18em;
  text-transform: uppercase; color: var(--wm-muted-fg);
}
.wm-lobby .keys b { font-weight: 500; color: var(--wm-muted-fg); }
.wm-lobby .key {
  border: 1px solid var(--wm-border); border-radius: var(--wm-r-sm); padding: 3px 6px;
  margin-right: 7px; color: var(--wm-fg-dim);
}
/* The escape hatch under the primary button, only shown when the primary is
   waiting on somebody else. A link, not a third button — it must not compete. */
.wm-lobby .alt {
  align-self: center; margin-top: 2px; font-size: 11px; letter-spacing: .04em;
  color: var(--wm-muted-fg); background: none; border: 0; padding: 0 0 1px; cursor: pointer;
  border-bottom: 1px solid var(--wm-border); transition: color var(--wm-t), border-color var(--wm-t);
}
.wm-lobby .alt:hover { color: var(--wm-fg); border-color: var(--wm-accent); }

/* ── right rail: the map selector ────────────────────────────────────────── */
.wm-lobby .rail-right {
  grid-area: right; display: flex; flex-direction: column; gap: 16px; padding: 24px 22px;
}
.wm-lobby .rail-hd { display: flex; flex-direction: column; gap: 8px; }
.wm-lobby .rail-hd .note { margin: 0; font-size: 10.5px; }
.wm-lobby .mapcards {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
  align-content: start; overflow-y: auto; min-height: 0;
}
.wm-lobby .mapcard {
  display: flex; flex-direction: column; gap: 10px; padding: 10px; text-align: left;
  cursor: pointer; background: transparent; border: 1px solid var(--wm-border);
  border-radius: var(--wm-r); min-width: 0;
  transition: border-color var(--wm-t), background var(--wm-t), opacity var(--wm-t);
}
.wm-lobby .mapcard:hover:not(:disabled) { border-color: var(--wm-muted-fg); }
.wm-lobby .mapcard[aria-pressed="true"] { border-color: var(--wm-accent); }
.wm-lobby .mapcard:disabled { opacity: .45; cursor: not-allowed; }
.wm-lobby .mapcard .thumb {
  position: relative; height: 96px; display: grid; place-items: center;
  background: rgb(var(--wm-void-rgb) / .7); border: 1px solid var(--wm-border);
}
/* The selected card's badge: one small Signal Blue square in the artwork's
   corner — selection is a mark, not a wash. */
.wm-lobby .mapcard[aria-pressed="true"] .thumb::after {
  content: ''; position: absolute; top: 7px; right: 7px; width: 6px; height: 6px;
  background: var(--wm-accent);
}
.wm-lobby .mapcard canvas {
  max-width: 82%; max-height: 78px; width: auto; height: auto;
  image-rendering: pixelated; opacity: .4; transition: opacity var(--wm-t);
}
.wm-lobby .mapcard:hover:not(:disabled) canvas { opacity: .6; }
.wm-lobby .mapcard[aria-pressed="true"] canvas { opacity: .85; }
.wm-lobby .mapcard .nm {
  font-size: 11px; font-weight: 500; letter-spacing: .2em; text-transform: uppercase;
  color: var(--wm-fg-dim);
}
.wm-lobby .mapcard[aria-pressed="true"] .nm { color: var(--wm-fg); }
.wm-lobby .mapcard .sub {
  font-family: var(--wm-mono); font-size: 9px; font-weight: 400; letter-spacing: .1em;
  text-transform: uppercase; color: var(--wm-muted-fg); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── countdown ───────────────────────────────────────────────────────────── */
.wm-lobby .count {
  position: fixed; inset: 0; z-index: 4; display: grid; place-items: center;
  text-align: center; padding: 40px 24px; background: rgb(var(--wm-bg-rgb) / .97);
}
.wm-lobby .count .n {
  font-family: var(--wm-display); font-weight: 300; font-size: clamp(96px, 17vh, 190px);
  line-height: 1; letter-spacing: .08em; color: var(--wm-fg); font-variant-numeric: tabular-nums;
}
/* The one place motion overshoots — a panel-open beat, per DESIGN.md. */
.wm-lobby .count .n.beat { animation: wm-beat 180ms cubic-bezier(.2,.85,.3,1); }
@keyframes wm-beat { from { transform: scale(1.12); opacity: .35 } to { transform: none; opacity: 1 } }
.wm-lobby .count .lbl2 {
  margin-top: 22px; font-family: var(--wm-mono); font-size: 13px; font-weight: 500;
  letter-spacing: .34em; text-transform: uppercase; color: var(--wm-fg-dim);
}
.wm-lobby .count .sub { margin-top: 12px; font-family: var(--wm-mono); font-size: 10px;
  letter-spacing: .18em; text-transform: uppercase; color: var(--wm-muted-fg); }

/* ── touch ───────────────────────────────────────────────────────────────── */
/* A touch session (body.wm-touch, set at boot) has no keyboard: the keycap
   hint row is noise there, and safe-area padding keeps the rails off notches. */
body.wm-touch .wm-lobby .keys { display: none; }
body.wm-touch .wm-lobby {
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

/* ── responsive ──────────────────────────────────────────────────────────── */
/* Semantic thresholds, not device names: the selector drops under the stage as
   soon as three rails would squeeze the display type. */
@media (max-width: 1240px) {
  .wm-lobby .shell {
    grid-template-columns: 280px minmax(0, 1fr);
    grid-template-areas: 'left stage' 'right right';
  }
  .wm-lobby .mapcards { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
}
@media (max-width: 860px) {
  .wm-lobby .shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'stage' 'left' 'right';
  }
  .wm-lobby .stage { min-height: 74vh; }
  .wm-lobby .hero-name { letter-spacing: .18em; }
}
/* Short windows: the display type yields to the dock, never the other way. */
@media (max-height: 680px) {
  .wm-lobby .rail-left, .wm-lobby .rail-right { padding: 16px; }
  .wm-lobby .stage-hd { padding: 16px 22px 0; }
  .wm-lobby .hero-name { font-size: clamp(30px, 4vw, 44px); margin: 10px 0 6px; }
  .wm-lobby .hero-view { margin-top: 12px; min-height: 170px; }
  .wm-lobby .dock { padding: 12px 14px 10px; gap: 7px; bottom: 14px; }
  .wm-lobby .btn { padding: 11px 16px; }
  .wm-lobby .mapcard .thumb { height: 64px; }
  .wm-lobby .mapcard canvas { max-height: 52px; }
}
`;

/** Sizes offered for the bot garrison; `squads` × `perSquad` hostiles. */
export const BOT_PRESETS = [
  { key: 'off', label: 'No bots', squads: 0, perSquad: 0, note: 'Players only — nobody but whoever joins your room.' },
  { key: 'light', label: 'Light', squads: 1, perSquad: 3, note: 'One patrol of 3. A quiet floor with something to shoot.' },
  { key: 'standard', label: 'Standard', squads: 2, perSquad: 3, note: 'Two squads of 3 on patrol routes — the default garrison.' },
  { key: 'heavy', label: 'Heavy', squads: 3, perSquad: 4, note: 'Three squads of 4. Contact almost everywhere.' },
];

/* Icons read as enterprise-software logic, at a uniform 1.5px stroke. Written
   without whitespace between tags: an icon shares its button with a label that
   tests compare by textContent, and a newline inside the markup would be a
   text node the comparison sees. */
const GEAR_SVG = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/><circle cx="7" cy="6" r="1.8"/><circle cx="13" cy="10" r="1.8"/><circle cx="8" cy="14" r="1.8"/></svg>`;
const COPY_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="9" height="9"/><path d="M11 5V2H2v9h3"/></svg>`;
const LINK_SVG = `<svg class="ic" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.5 9.5l3-3"/><path d="M7.5 4.5l1.2-1.2a2.5 2.5 0 013.5 3.5L11 8"/><path d="M8.5 11.5l-1.2 1.2a2.5 2.5 0 01-3.5-3.5L5 8"/></svg>`;
const PLAY_SVG = `<svg class="ic" width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg>`;
const TARGET_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 2v3M8 11v3M2 8h3M11 8h3"/></svg>`;

/**
 * Draw a `mapPlan` floorplan into a fresh canvas.
 *
 * One cell is one filled rect, at 2x so the blocks stay crisp on a HiDPI panel
 * without the browser resampling a bitmap. The fill is read off the live
 * computed style rather than written literally, so the plan re-colours with the
 * lobby's own tokens rather than pinning a hex the brand does not own.
 *
 * Called once per map when the list arrives, never per frame.
 */
function paintPlan(plan, { scale = 2, colorVar = '--wm-fg-dim' } = {}) {
  const c = document.createElement('canvas');
  if (!plan || !plan.cols) return c;
  const { cols, rows, cells } = plan;
  c.width = cols * scale;
  c.height = rows * scale;
  c.style.aspectRatio = `${cols} / ${rows}`;
  const g = c.getContext('2d');
  if (!g) return c;
  // `installBrand()` has run by construction, so the token resolves. If it ever
  // does not, leave the canvas empty rather than inventing a colour here — a
  // literal hex on a menu surface is exactly what DESIGN.md forbids.
  const probe = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
  if (!probe) return c;
  g.fillStyle = probe;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (cells[j * cols + i]) g.fillRect(i * scale, j * scale, scale, scale);
    }
  }
  return c;
}

export class MatchStartUI {
  constructor({ multiplayer = true, invited = false } = {}) {
    installBrand();
    if (!document.getElementById('wm-lobby-style')) {
      const s = document.createElement('style');
      s.id = 'wm-lobby-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const host = document.getElementById('ui') ?? document.body;
    this.root = document.createElement('div');
    this.root.className = 'wm-lobby wm-scroll hidden';
    host.appendChild(this.root);

    /**
     * Room presence cards — under the top edge and centred, i.e. exactly where
     * the in-match overlay puts them, because the player crosses between the
     * two screens and the news must not move.
     *
     * A sibling of the lobby rather than a child of it: `.wm-lobby *` resets
     * every margin and padding at the same specificity the card's own rules
     * carry, so nesting it would make the card's padding depend on which
     * stylesheet happened to be injected last.
     */
    this.presenceEl = document.createElement('div');
    this.presenceEl.className = 'wm-presence-stack hidden';
    host.appendChild(this.presenceEl);

    /** Player ids that arrived recently, id -> timestamp, for the row flash. */
    this._fresh = new Map();

    this.multiplayer = multiplayer;
    this.invited = invited;

    /** Callbacks — every one of them is owned by src/match/index.js. */
    this.onMap = null; // a map card was clicked — a request, not a decision
    this.onPrimary = null; // the single dominant CTA, whatever it means now
    this.onAlt = null; // the link under it — resolve against `altMode`
    this.onCopyInvite = null;
    this.onBots = null;
    this.onName = null;
    this.onSettings = null;

    this.root.innerHTML = `
      <div class="shell" data-body>
        <aside class="col rail-left">
          <span class="eyebrow" data-eyebrow></span>

          <div class="roomzone" data-room-panel>
            <div class="roombox">
              <div class="roombox-hd">
                <span class="grow">
                  <span class="lbl">Active room</span>
                  <span class="code" data-room>------</span>
                </span>
                <button type="button" class="icon-btn" data-copy-2
                  title="Copy invite link (C)" aria-label="Copy invite link">${COPY_SVG}</button>
              </div>
              <div class="netline" data-netline>
                <span class="sq"></span><span data-strip-net>Relay connecting...</span>
              </div>
              <p class="status" data-status>Connecting to the relay…</p>
            </div>
            <div class="roster wm-scroll" data-roster></div>
          </div>

          <div class="setup">
            <div class="opts">
              <span class="lbl">Garrison</span>
              <div class="chips" data-bots role="group" aria-label="Garrison size"></div>
              <p class="note" data-bot-note></p>
            </div>
            <div class="callsign">
              <label class="lbl" for="wm-callsign">Callsign</label>
              <span class="cs-row">
                <input id="wm-callsign" data-name maxlength="20" spellcheck="false" autocomplete="off" />
                <button type="button" class="icon-btn" data-settings title="Settings (Esc)"
                  aria-label="Settings">${GEAR_SVG}</button>
              </span>
            </div>
            <span class="wm-mark rail-mark">${WORDMARK_HTML}</span>
          </div>
        </aside>

        <section class="col stage" data-stage>
          <div class="stage-hd">
            <span class="curmap">${TARGET_SVG}<span>Current map</span></span>
            <h1 class="hero-name" data-hero-name></h1>
            <span class="hero-sub" data-hero-sub></span>
          </div>
          <div class="hero-view">
            <img class="hero-img" data-hero alt="" aria-hidden="true" />
            <div class="hero-plan" data-hero-plan></div>
            <div class="dock">
              <button type="button" class="btn btn-primary" data-primary>${PLAY_SVG}<span data-primary-lbl>Play</span></button>
              <button type="button" class="btn btn-ghost" data-copy>${LINK_SVG}<span data-copy-lbl>Copy invite link</span></button>
              <div class="keys">
                <span><span class="key">Enter</span><b data-strip-primary>Play</b></span>
                <span><span class="key">C</span>Copy</span>
                <span><span class="key">Esc</span>Settings</span>
              </div>
              <button type="button" class="alt hide" data-alt>Warm up against bots while you wait</button>
            </div>
          </div>
        </section>

        <aside class="col rail-right" data-maps>
          <div class="rail-hd">
            <span class="eyebrow">Map selector</span>
            <span class="note" data-map-note></span>
          </div>
          <div class="mapcards wm-scroll" data-mapcards role="group" aria-label="Map"></div>
        </aside>
      </div>

      <div class="count hide" data-count>
        <div>
          <div class="n" data-count-n>3</div>
          <div class="lbl2" data-count-lbl>Match starting</div>
          <div class="sub" data-count-sub>Deploying to the floor</div>
        </div>
      </div>
    `;

    const q = (sel) => this.root.querySelector(sel);
    this.bodyEl = q('[data-body]');
    this.mapsEl = q('[data-maps]');
    this.mapCardsEl = q('[data-mapcards]');
    this.mapNoteEl = q('[data-map-note]');
    this.eyebrowEl = q('[data-eyebrow]');
    this.stageEl = q('[data-stage]');
    this.heroName = q('[data-hero-name]');
    this.heroSub = q('[data-hero-sub]');
    this.heroImg = q('[data-hero]');
    this.heroPlanEl = q('[data-hero-plan]');
    this.botChips = q('[data-bots]');
    this.botNote = q('[data-bot-note]');
    this.primaryBtn = q('[data-primary]');
    this.primaryLbl = q('[data-primary-lbl]');
    this.altBtn = q('[data-alt]');
    this.copyBtn = q('[data-copy]');
    this.copyLbl = q('[data-copy-lbl]');
    this.copyBtn2 = q('[data-copy-2]');
    this.nameIn = q('[data-name]');
    this.roomEl = q('[data-room]');
    this.roomPanel = q('[data-room-panel]');
    this.rosterEl = q('[data-roster]');
    this.statusEl = q('[data-status]');
    this.netlineEl = q('[data-netline]');
    this.countEl = q('[data-count]');
    this.countN = q('[data-count-n]');
    this.countLbl = q('[data-count-lbl]');
    this.countSub = q('[data-count-sub]');
    this.stripNet = q('[data-strip-net]');
    this.stripPrimary = q('[data-strip-primary]');

    // The lobby has exactly one visual treatment: the WORKMELT brand system as
    // documented in DESIGN.md. A browser still carrying a preference from the
    // retired theme labs or layout explorations has it cleared, not honoured.
    try {
      localStorage.removeItem('workmelt-lobby-style');
      localStorage.removeItem('workmelt-map-layout');
    } catch {}

    /* The hero artwork is a probe: the img element asks for the file and the
       stage only wears it once it has actually decoded. A missing file is the
       normal case, and it must leave the blueprint stage untouched. */
    this.heroImg.addEventListener('load', () => this.stageEl.classList.add('has-art'));
    this.heroImg.addEventListener('error', () => this.stageEl.classList.remove('has-art'));

    this.chipEls = new Map();
    for (const p of BOT_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = p.label;
      b.addEventListener('click', () => this.onBots?.(p.key));
      this.botChips.appendChild(b);
      this.chipEls.set(p.key, b);
    }

    this.primaryBtn.addEventListener('click', () => this.onPrimary?.());
    this.altBtn.addEventListener('click', () => this.onAlt?.());
    this.copyBtn.addEventListener('click', () => this.onCopyInvite?.());
    this.copyBtn2.addEventListener('click', () => this.onCopyInvite?.());
    q('[data-settings]').addEventListener('click', () => this.onSettings?.());
    this.nameIn.addEventListener('change', () => this.onName?.(this.nameIn.value.trim()));
    this.nameIn.addEventListener('blur', () => this.onName?.(this.nameIn.value.trim()));

    // Keys typed at this screen are menu input, never gameplay input. The
    // shortcuts live here rather than on window so they die with the view.
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const typing = e.target === this.nameIn;
      if (e.key === 'Enter') {
        if (typing) {
          this.nameIn.blur();
          return;
        }
        if (!this.primaryBtn.disabled) {
          e.preventDefault();
          this.onPrimary?.();
        }
        return;
      }
      if (typing) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.onCopyInvite?.();
      }
    });

    if (!multiplayer) {
      this.roomPanel.remove();
      this.copyBtn.remove();
    }
    this._setEyebrow();

    /** id -> card element and id -> summary, filled by setMaps(). */
    this.mapBtns = new Map();
    this.mapById = new Map();
    this.mapOrder = [];
    this.mapId = null;
    /** A level rebuild is in flight — nothing may be started against half a map. */
    this.mapBusy = false;
    /** The room is already playing, so its level is no longer up for a vote. */
    this.mapLocked = false;
    this.mapNoteIdle = '';

    /** What the primary button currently does; render() keeps it honest. */
    this._mode = 'solo';
    /** What the link under it does. Null hides it. */
    this._altMode = null;
    /** How many are ready, for the "start now with the N who are ready" label. */
    this._altForce = 0;
  }

  /** 'solo' | 'ready' | 'unready' | 'deploy' — what a primary click means now. */
  get mode() {
    return this._mode;
  }

  /** 'solo' | 'force' | 'next' | 'cancel' | null — what an alt click means now. */
  get altMode() {
    return this._altMode;
  }

  _setEyebrow(text) {
    if (text) {
      this.eyebrowEl.innerHTML = text;
      return;
    }
    this.eyebrowEl.textContent = this.invited
      ? 'You were invited — join below'
      : 'Season 1 — Live operations';
  }

  /**
   * Build the map cards from the list `world` publishes. This view never
   * imports the world subsystem — it renders what it is handed.
   */
  setMaps(list = []) {
    this.mapCardsEl.textContent = '';
    this.mapBtns.clear();
    this.mapById = new Map(list.map((m) => [m.id, m]));
    this.mapOrder = list.map((m) => m.id);
    for (const m of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mapcard';
      b.setAttribute('aria-pressed', 'false');
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      thumb.appendChild(paintPlan(m.plan));
      b.appendChild(thumb);
      for (const [cls, text] of [['nm', m.name], ['sub', m.description]]) {
        if (!text) continue;
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        b.appendChild(span);
      }
      b.addEventListener('click', () => this.onMap?.(m.id));
      this.mapCardsEl.appendChild(b);
      this.mapBtns.set(m.id, b);
    }
    // One map is not a choice — do not make the player look at a picker with a
    // single option in it.
    this.mapsEl.classList.toggle('hide', list.length < 2);
    this.setMap(this.mapId);
  }

  setMap(id) {
    this.mapId = id;
    for (const [k, b] of this.mapBtns) b.setAttribute('aria-pressed', String(k === id));
    this._paintHero(this.mapById.get(id) ?? this.mapById.get(this.mapOrder[0]));
    this._syncMap();
  }

  /**
   * The stage: the selected map's name written large, and its artwork when
   * `public/maps/<id>.png` exists — the floorplan blueprint otherwise.
   */
  _paintHero(m) {
    this.heroName.textContent = m?.name ?? '';
    this.heroSub.textContent = m?.description ?? '';
    this.heroPlanEl.textContent = '';
    if (!m) {
      this.stageEl.classList.remove('has-art');
      this.heroImg.removeAttribute('src');
      return;
    }
    this.heroPlanEl.appendChild(paintPlan(m.plan, { scale: 4 }));
    const want = `/maps/${encodeURIComponent(m.id)}.png`;
    if (this.heroImg.getAttribute('src') !== want) {
      this.stageEl.classList.remove('has-art');
      this.heroImg.src = want;
    } else if (this.heroImg.complete && this.heroImg.naturalWidth > 0) {
      this.stageEl.classList.add('has-art');
    }
  }

  /**
   * Building a level takes a beat and re-runs the shader pre-warm. Lock the
   * cards and the primary while it happens.
   */
  setMapBusy(on) {
    this.mapBusy = !!on;
    this._syncMap();
    this._paintPrimary();
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

  /** The caller's line — what the note says when nothing is overriding it. */
  setMapNote(text) {
    this.mapNoteIdle = text ?? '';
    this._syncMap();
  }

  _syncMap() {
    const off = this.mapBusy || this.mapLocked;
    for (const b of this.mapBtns.values()) b.disabled = off;
    this.mapNoteEl.textContent = this.mapBusy
      ? 'Loading…'
      : this.mapLocked
        ? 'Locked — the match is already running'
        : this.mapNoteIdle;
  }

  setBots(key) {
    for (const [k, b] of this.chipEls) b.setAttribute('aria-pressed', String(k === key));
    this.botNote.textContent = BOT_PRESETS.find((p) => p.key === key)?.note ?? '';
    this._botKey = key;
    // Both controls can carry the garrison size — the primary as "Play vs 6
    // bots", the link as "Warm up against 6 bots while you wait".
    if (this._mode === 'solo' || this._altMode === 'solo') this._paintPrimary();
  }

  setRoom(code) {
    this.roomEl.textContent = (code ?? '------').toUpperCase();
  }

  setName(name) {
    if (document.activeElement !== this.nameIn) this.nameIn.value = name ?? '';
  }

  /** Both copy buttons confirm together — they are the same action. */
  flashCopied(label = 'Link copied') {
    clearTimeout(this._copyT);
    if (this.copyBtn.isConnected) {
      this.copyLbl.textContent = label;
      this.copyBtn.classList.add('done');
    }
    this.copyBtn2.classList.add('done');
    this._copyT = setTimeout(() => {
      if (this.copyBtn.isConnected) {
        this.copyLbl.textContent = 'Copy invite link';
        this.copyBtn.classList.remove('done');
      }
      this.copyBtn2.classList.remove('done');
    }, 1600);
  }

  /**
   * Repaint from the lobby model.
   *
   * @param {object} m { connected, everConnected, full, live, players:[{id,name,
   *                     ready,deployed,warm}], myId, ready }
   */
  render(m) {
    if (!this.multiplayer) {
      this._mode = 'solo';
      this._altMode = null;
      this._paintPrimary();
      return;
    }
    // A live room's level is settled; the relay refuses a change once anybody
    // is deployed. Painted before the roster so the cards never disagree with
    // the status line under them.
    this.setMapLocked(!!m.live);
    const players = m.players ?? [];
    const others = players.filter((p) => p.id !== m.myId);

    this.rosterEl.textContent = '';
    // Empty and disconnected says nothing here — the status line under the
    // relay lamp already carries the "waiting on the relay" paragraph, and the
    // same copy twice in one rail reads as a stutter.
    if (!players.length && m.connected) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Nobody here yet. Send the invite link and they land in this room.';
      this.rosterEl.appendChild(d);
    }
    const now = this._now();
    for (const p of players) {
      // Four states, and "warming up" is the one that carries the news: that
      // player is out of the lobby but NOT in a match, so readying up still
      // starts one and it takes them with it.
      const state = p.warm ? 'warm' : p.deployed ? 'deployed' : p.ready ? 'ready' : 'waiting';
      const row = document.createElement('div');
      row.className = `row ${state}${p.id === m.myId ? ' me' : ''}`;
      // Somebody who just arrived. The roster is rebuilt from scratch on every
      // lobby frame, and those arrive for reasons of their own (a ready flag, a
      // map change) — so the flash is resumed at the point it had reached
      // rather than restarted, or an unrelated frame would loop it forever.
      const since = this._fresh.get(p.id);
      if (since != null) {
        const elapsed = now - since;
        if (elapsed < ROW_FLASH_MS) {
          row.classList.add('fresh');
          row.style.animationDelay = `-${Math.max(0, Math.round(elapsed))}ms`;
        } else {
          this._fresh.delete(p.id);
        }
      }
      const dot = document.createElement('span');
      dot.className = 'dot';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = p.name + (p.id === m.myId ? ' (you)' : '');
      const st = document.createElement('span');
      st.className = 'st';
      st.textContent = { warm: 'Warming up', deployed: 'In match', ready: 'Ready' }[state] ?? 'Not ready';
      row.append(dot, who, st);
      this.rosterEl.appendChild(row);
    }

    this.netlineEl.classList.toggle('on', !!m.connected);
    this.stripNet.innerHTML = m.connected
      ? `Relay online — <b>${players.length}</b> in room`
      : `Relay ${m.everConnected ? 'reconnecting' : 'connecting'}...`;

    // ---- what is the single best next move? -------------------------------
    if (this.mapBusy) {
      // Nothing is the best next move until the level exists.
      this._mode = 'solo';
      this._altMode = null;
      this.statusEl.textContent = 'Loading the map…';
      this._paintPrimary();
      return;
    }
    // Everyone who is looking at this screen — the players whose ready flags the
    // relay actually waits on. A warm-up is not one of them.
    const inLobby = players.filter((p) => !p.deployed);
    const warm = others.filter((p) => p.warm);
    const readyCount = players.filter((p) => p.ready).length;
    if (m.live) {
      this._mode = 'deploy';
      // The rematch call. It cannot start anything while the match is running,
      // which is exactly why it is worth arming now: the relay starts one the
      // moment the last player leaves, and everybody still in there is told.
      this._altMode = m.ready ? 'cancel' : 'next';
      this.statusEl.innerHTML = m.ready
        ? 'Ready for the next match — it starts when this one empties out.'
        : 'Match already running — drop in, or ready up for the next one.';
    } else if (!m.connected) {
      // The relay is not a gate on playing. Falling back to the solo CTA is why
      // a cold start, a dropped connection and a first-ever load all still get
      // the player into a match with one click.
      this._mode = 'solo';
      this._altMode = null;
      // A full room is the one connection failure that will not fix itself, and
      // it lands precisely when this screen is up — so it has to be said here.
      // The primary still works: you can play, just not in that room.
      this.statusEl.textContent = m.full
        ? `That room is full (${m.full} players). Ask for a new link — you can still play right now.`
        : m.everConnected
          ? 'Offline — reconnecting to the relay.'
          : 'Waiting on the relay. You can play the garrison right now — co-workers can still join later.';
    } else if (!others.length) {
      this._mode = m.ready ? 'unready' : 'solo';
      this._altMode = m.ready ? 'solo' : null;
      this.statusEl.innerHTML = m.ready
        ? 'Standing by — the match starts the moment someone joins and readies up.'
        : 'Alone in this room. Play now, or send the link and wait for company.';
    } else {
      this._mode = m.ready ? 'unready' : 'ready';
      // Two ready players are enough to start without a third who joined and
      // wandered off. Below that there is nobody to start without.
      const stalled = readyCount >= 2 && readyCount < inLobby.length;
      this._altMode = m.ready && stalled ? 'force' : 'solo';
      this._altForce = readyCount;
      const warmNote = warm.length
        ? ` <b>${warm.length}</b> warming up against bots — the countdown pulls them in.`
        : '';
      // Out of the LOBBY, not out of the room: a warm-up player has no ready flag
      // to give, so counting them in the denominator would show a fraction that
      // can never complete.
      this.statusEl.innerHTML =
        (m.ready
          ? `You are ready — <b>${readyCount}/${inLobby.length}</b> standing by.`
          : `<b>${readyCount}/${inLobby.length}</b> ready. Ready up to start the countdown.`) + warmNote;
    }
    this._paintPrimary();
  }

  /** One button, four labels. `_mode` is the only thing that decides. */
  _paintPrimary() {
    const label = {
      deploy: 'Deploy now',
      ready: 'Ready up',
      unready: 'Cancel ready',
      solo: this._botCount ? `Play vs ${this._botCount} bots` : 'Play',
    }[this._mode];

    this.primaryLbl.textContent = this.mapBusy ? 'Loading map' : label;
    this.primaryBtn.disabled = this.mapBusy;
    this.primaryBtn.className = this._mode === 'unready' ? 'btn btn-ghost' : 'btn btn-primary';
    this.stripPrimary.textContent = this.mapBusy ? 'Loading map' : label;
    this._paintAlt();
  }

  /**
   * The link under the primary. Same rule: whatever the other reasonable move
   * is, and nothing when there isn't one.
   */
  _paintAlt() {
    const bots = this._botCount;
    const label = {
      solo: bots ? `Warm up against ${bots} bots while you wait` : 'Deploy on your own while you wait',
      force: `Start now with the ${this._altForce ?? 2} who are ready`,
      next: 'Ready up for the next match',
      cancel: 'Cancel ready',
    }[this._altMode];
    this.altBtn.classList.toggle('hide', !label || this.mapBusy);
    if (label) this.altBtn.textContent = label;
  }

  /** Hostiles in the selected garrison — 0 when it is off. */
  get _botCount() {
    const preset = BOT_PRESETS.find((p) => p.key === this._botKey);
    return preset && preset.squads ? preset.squads * preset.perSquad : 0;
  }

  setVisible(on) {
    this.root.classList.toggle('hidden', !on);
    // Let the display change land before the opacity transition starts.
    if (on) requestAnimationFrame(() => this.root.classList.add('show'));
    else this.root.classList.remove('show');
    // The cards go with the screen they belong to: deploying hands the room
    // news back to the in-match overlay, and a card still dwelling from the
    // lobby would otherwise hang over the HUD for the rest of its five seconds.
    this.presenceEl.classList.toggle('hidden', !on);
    if (!on) this.presenceEl.textContent = '';
  }

  /**
   * Somebody else entered or left the room, announced on the same card the
   * in-match overlay uses. `src/net/ui.js` owns the equivalent while a match is
   * running — this one exists because that overlay is deliberately hidden
   * behind the lobby, so without it a player sitting on this screen watches the
   * roster grow with no idea that it did.
   *
   * The arrival also flashes the roster row, so the card and the list are one
   * gesture. `render` reads `_fresh`; nothing else has to be told.
   *
   * @param {'join'|'leave'} kind
   * @param {object} [o] { id, name, colour, count }
   */
  presence(kind, { id = null, name = '', colour = null, count = 0 } = {}) {
    pushPresence(this.presenceEl, kind, name, { colour, count });
    if (kind === 'join' && id != null) this._fresh.set(id, this._now());
    else if (id != null) this._fresh.delete(id);
  }

  /** Wall clock for the row flash. Nothing deterministic depends on it. */
  _now() {
    return typeof performance !== 'undefined' ? performance.now() : 0;
  }

  /** Swap the lobby body for the countdown. */
  showCountdown(on) {
    this.bodyEl.classList.toggle('hide', on);
    this.countEl.classList.toggle('hide', !on);
  }

  setCountdown(n, label = 'Match starting', sub = 'Deploying to the floor') {
    const text = n > 0 ? String(n) : 'GO';
    if (this.countN.textContent !== text) {
      this.countN.textContent = text;
      // Restart the beat: the class has to leave the element for one frame.
      this.countN.classList.remove('beat');
      void this.countN.offsetWidth;
      this.countN.classList.add('beat');
    }
    this.countLbl.textContent = label;
    this.countSub.textContent = sub;
  }

  /** Move keyboard focus onto the primary button so Enter/Tab work immediately. */
  focusPrimary() {
    try {
      this.primaryBtn.focus({ preventScroll: true });
    } catch {
      /* focus is a nicety, never a requirement */
    }
  }

  dispose() {
    clearTimeout(this._copyT);
    this.presenceEl.remove();
    this.root.remove();
  }
}
