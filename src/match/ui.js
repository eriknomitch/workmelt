/**
 * ===========================================================================
 * The lobby — the screen WORKMELT opens on
 * ===========================================================================
 *
 * Styled from `DESIGN.md` through the tokens in `src/ui/brand.js`: Dark Slate
 * canvas, one Gunmetal panel, Bebas Neue for display and Inter for every
 * string, and Melt Green kept to the wordmark drip plus the ready/online dots.
 *
 * ---------------------------------------------------------------------------
 * THE UX CONTRACT: ONE CLICK IN, ONE CLICK TO SHARE
 * ---------------------------------------------------------------------------
 * The screen this replaced asked the player to choose between a BOTS panel and
 * a MULTIPLAYER panel before anything happened, which meant reading two blocks
 * of copy to answer a question ("can I just play?") that has one right answer.
 *
 * Now there is exactly one primary button and it is always the best next move:
 *
 *   alone in the room        PLAY          deploy immediately vs the garrison
 *   somebody else is here    READY UP      the relay starts when everyone is
 *   already readied up       CANCEL READY  the only thing left to undo
 *   the match is running     DEPLOY NOW    drop into it
 *
 * and exactly one secondary button, live in every one of those states:
 *
 *   COPY INVITE LINK  one click, whatever else is on screen
 *
 * Under the primary sits one optional link, which follows the same rule — it is
 * always the *other* reasonable move, and never a required one (`_paintAlt`):
 *
 *   waiting on people        WARM UP AGAINST BOTS   private, and the room's
 *                                                   countdown pulls you out of it
 *   you are ready, they are  START NOW WITH THE N   somebody joined and wandered
 *   not                      WHO ARE READY          off; do not wait on them
 *   the match is running     READY FOR THE NEXT     arms a rematch and tells the
 *                            MATCH                  players still in this one
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
  /* 65% of the composition is the canvas. The scrim is Dark Slate over the live
     scene, densest at the top where the display type sits. */
  background: linear-gradient(180deg,
    rgb(var(--wm-bg-rgb) / .97) 0%, rgb(var(--wm-bg-rgb) / .93) 46%, rgb(var(--wm-void-rgb) / .96) 100%);
  opacity: 0; transition: opacity var(--wm-t-slow);
}
.wm-lobby.show { opacity: 1; }
.wm-lobby.hidden { display: none; }
.wm-lobby *, .wm-lobby *::before, .wm-lobby *::after { box-sizing: border-box; margin: 0; padding: 0; }
.wm-lobby button, .wm-lobby input { font-family: inherit; color: inherit; }
.wm-lobby :focus-visible { outline: 2px solid var(--wm-accent); outline-offset: 2px; }
.wm-lobby .hide { display: none !important; }

/* The document is a 3-row grid: bar / body / status strip, exactly as the
   design export lays it out. min-height:100% rather than height, so a short
   window scrolls to the buttons instead of clipping them. */
.wm-lobby .shell {
  min-height: 100%; display: grid; grid-template-rows: auto 1fr auto;
}

/* ── top bar ─────────────────────────────────────────────────────────────── */
.wm-lobby .bar {
  display: flex; align-items: center; gap: 16px; padding: 0 24px; min-height: 60px;
  background: var(--wm-panel); border-bottom: 1px solid var(--wm-border);
}
.wm-lobby .bar .wm-mark { font-size: 30px; }
.wm-lobby .spacer { flex: 1 1 auto; }
.wm-lobby .callsign {
  display: flex; align-items: center; gap: 9px;
}
.wm-lobby .callsign label {
  font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  color: var(--wm-muted-fg);
}
.wm-lobby .callsign input {
  width: 148px; background: var(--wm-panel-2); border: 1px solid var(--wm-border);
  border-radius: var(--wm-r-sm); padding: 7px 9px; font-size: 13px; font-weight: 600;
  letter-spacing: .01em; transition: border-color var(--wm-t);
}
.wm-lobby .callsign input:hover { border-color: var(--wm-muted-fg); }
.wm-lobby .callsign input:focus { outline: none; border-color: var(--wm-accent); }
.wm-lobby .icon-btn {
  width: 34px; height: 34px; border-radius: var(--wm-r-sm); background: none;
  border: 1px solid var(--wm-border); color: var(--wm-muted-fg); display: grid;
  place-items: center; cursor: pointer; flex: none;
  transition: color var(--wm-t), border-color var(--wm-t);
}
.wm-lobby .icon-btn:hover { color: var(--wm-fg); border-color: var(--wm-accent); }

/* ── body ────────────────────────────────────────────────────────────────── */
.wm-lobby .body {
  display: grid; grid-template-columns: minmax(0, 1fr) 372px; gap: 24px;
  align-items: center; padding: 28px 24px; max-width: 1500px; width: 100%;
  margin: 0 auto;
}
.wm-lobby .hero { display: flex; flex-direction: column; min-width: 0; padding: 0 4px; }

.wm-lobby .eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  color: var(--wm-muted-fg);
}
.wm-lobby .eyebrow .on { color: var(--wm-ok); }
.wm-lobby .hero .eyebrow { margin-bottom: 18px; }
.wm-lobby .hero .wm-mark {
  font-size: clamp(56px, 8.4vw, 126px); letter-spacing: .055em; margin-bottom: 26px;
}
.wm-lobby .lede {
  font-size: 16px; line-height: 1.55; color: var(--wm-fg-dim); max-width: 56ch;
  margin-bottom: 30px; text-wrap: balance;
}
.wm-lobby .lede b { color: var(--wm-fg); font-weight: 600; }

/* map picker — the first decision, and the one that changes what the rest
   mean. Cards rather than chips because each carries three lines of read. */
.wm-lobby .maps { margin-bottom: 20px; }
.wm-lobby .maps .hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px; }
.wm-lobby .maps .hd .note { font-size: 11px; letter-spacing: .015em; color: var(--wm-muted-fg);
  text-transform: none; font-weight: 400; }
.wm-lobby .mapcards { display: flex; gap: 10px; flex-wrap: wrap; }
.wm-lobby .mapcard {
  flex: 1 1 250px; max-width: 400px; display: flex; flex-direction: column; gap: 3px;
  padding: 12px 14px; text-align: left; cursor: pointer;
  background: var(--wm-panel-2); border: 1px solid var(--wm-border); border-radius: var(--wm-r);
  transition: border-color var(--wm-t), background var(--wm-t);
}
.wm-lobby .mapcard:hover:not(:disabled) { border-color: var(--wm-accent); }
.wm-lobby .mapcard[aria-pressed="true"] { border-color: var(--wm-fg); background: var(--wm-hover); }
.wm-lobby .mapcard:disabled { opacity: .45; cursor: not-allowed; }
.wm-lobby .mapcard .nm {
  font-family: var(--wm-display); font-size: 20px; letter-spacing: .07em;
  text-transform: uppercase; line-height: 1; color: var(--wm-fg-dim);
}
.wm-lobby .mapcard[aria-pressed="true"] .nm { color: var(--wm-fg); }
.wm-lobby .mapcard .sub {
  font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--wm-muted-fg);
}
.wm-lobby .mapcard .bl { margin-top: 4px; font-size: 12px; line-height: 1.45; color: var(--wm-muted-fg); }
.wm-lobby .mapcard .sz { margin-top: 3px; font-size: 11px; color: var(--wm-muted-fg);
  font-variant-numeric: tabular-nums; }

/* garrison picker — 4 chips, one click, no drilling */
.wm-lobby .opts { margin-bottom: 22px; }
.wm-lobby .opts .eyebrow { display: block; margin-bottom: 9px; }
.wm-lobby .chips { display: flex; gap: 8px; flex-wrap: wrap; }
.wm-lobby .chip {
  font-size: 12px; font-weight: 500; letter-spacing: .015em; padding: 7px 13px;
  border-radius: var(--wm-r-sm); border: 1px solid var(--wm-border);
  background: var(--wm-panel-2); color: var(--wm-muted-fg); cursor: pointer;
  transition: color var(--wm-t), border-color var(--wm-t), background var(--wm-t);
}
.wm-lobby .chip:hover { color: var(--wm-fg); border-color: var(--wm-accent); }
.wm-lobby .chip[aria-pressed="true"] {
  color: var(--wm-bg); background: var(--wm-fg); border-color: var(--wm-fg); font-weight: 600;
}
.wm-lobby .note {
  font-size: 12px; line-height: 1.5; color: var(--wm-muted-fg); margin-top: 10px; min-height: 18px;
}

/* ── buttons ─────────────────────────────────────────────────────────────── */
.wm-lobby .cta { display: grid; grid-template-columns: minmax(0,1fr) 260px; gap: 12px; max-width: 820px; }
.wm-lobby .btn {
  font-family: var(--wm-display); text-transform: uppercase; letter-spacing: .08em;
  cursor: pointer; border-radius: var(--wm-r); border: 1px solid transparent;
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  transition: background var(--wm-t), border-color var(--wm-t), color var(--wm-t), transform 90ms linear;
}
/* Primary: Ice White fill, Graphite text — 14.91:1. Hovering warms it toward
   Melt Green rather than filling with it (green fill + white text fails AA). */
.wm-lobby .btn-primary {
  background: var(--wm-fg); color: var(--wm-bg); font-size: 26px; padding: 16px 28px 13px; width: 100%;
}
.wm-lobby .btn-primary:hover:not(:disabled) { background: var(--wm-fg-warm); }
.wm-lobby .btn-primary:active:not(:disabled) { transform: translateY(2px); }
.wm-lobby .btn-ghost {
  background: transparent; color: var(--wm-fg); border-color: var(--wm-fg);
  font-size: 19px; padding: 12px 22px 10px; width: 100%;
}
.wm-lobby .btn-ghost:hover:not(:disabled) { border-color: var(--wm-accent); }
.wm-lobby .btn-ghost:active:not(:disabled) { transform: translateY(2px); }
.wm-lobby .btn-ghost.done { border-color: var(--wm-ok); color: var(--wm-ok); }
.wm-lobby .btn:disabled { opacity: .42; cursor: not-allowed; }
.wm-lobby .btn .k {
  font-family: var(--wm-body); font-size: 10px; font-weight: 600; letter-spacing: .08em;
  border: 1px solid currentColor; border-radius: 3px; padding: 1px 4px; opacity: .55;
  position: relative; top: -1px;
}
.wm-lobby .btn-sm {
  font-family: var(--wm-body); font-size: 12px; font-weight: 600; letter-spacing: .02em;
  background: transparent; color: var(--wm-fg-dim); border: 1px solid var(--wm-border);
  border-radius: var(--wm-r-sm); padding: 5px 10px; cursor: pointer;
  transition: color var(--wm-t), border-color var(--wm-t), background var(--wm-t);
}
.wm-lobby .btn-sm:hover { color: var(--wm-fg); border-color: var(--wm-accent); background: var(--wm-panel-2); }
.wm-lobby .btn-sm.done { color: var(--wm-ok); border-color: var(--wm-ok); }

/* The escape hatch under the primary button, only shown when the primary is
   waiting on somebody else. A link, not a third button — it must not compete. */
.wm-lobby .alt {
  /* flex-start, or the rule under it stretches the whole hero column wide and
     stops reading as a link. */
  align-self: flex-start;
  margin-top: 13px; font-size: 13px; color: var(--wm-muted-fg); background: none;
  border: 0; padding: 0; cursor: pointer; text-align: left;
  border-bottom: 1px solid var(--wm-border); transition: color var(--wm-t), border-color var(--wm-t);
}
.wm-lobby .alt:hover { color: var(--wm-fg); border-color: var(--wm-accent); }

/* ── room panel ──────────────────────────────────────────────────────────── */
.wm-lobby .panel {
  background: var(--wm-panel); border: 1px solid var(--wm-border); border-radius: var(--wm-r);
  box-shadow: var(--wm-shadow); display: flex; flex-direction: column; min-width: 0;
  max-height: min(560px, 78vh);
}
.wm-lobby .panel-hd {
  display: flex; align-items: center; gap: 12px; padding: 14px 18px;
  border-bottom: 1px solid var(--wm-border); flex: none;
}
.wm-lobby .h-sec {
  font-family: var(--wm-display); font-size: 22px; letter-spacing: .08em;
  text-transform: uppercase; line-height: 1; white-space: nowrap;
}
.wm-lobby .code {
  font-family: var(--wm-display); font-size: 24px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--wm-fg); line-height: 1;
}
.wm-lobby .panel-bd { padding: 8px 0; overflow-y: auto; min-height: 96px; flex: 1 1 auto; }
.wm-lobby .panel-ft {
  padding: 12px 18px; border-top: 1px solid var(--wm-border); flex: none;
  display: flex; align-items: center; gap: 10px;
}

.wm-lobby .row {
  display: flex; align-items: center; gap: 12px; padding: 10px 18px;
  transition: background var(--wm-t);
}
.wm-lobby .row + .row { border-top: 1px solid var(--wm-border); }
.wm-lobby .row:hover { background: var(--wm-hover); }
/* Square dots, not circles: the icon language is enterprise-software geometry. */
.wm-lobby .dot { width: 8px; height: 8px; border-radius: 2px; flex: none; background: var(--wm-muted); }
.wm-lobby .row.ready .dot { background: var(--wm-ok); }
.wm-lobby .row.deployed .dot { background: var(--wm-fg); }
/* Warming up: out of the lobby but not in a match — the same amber the relay
   status uses for "not settled yet". */
.wm-lobby .row.warm .dot { background: var(--wm-warn); }
.wm-lobby .row .who {
  flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600; letter-spacing: .01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wm-lobby .row.me .who { color: var(--wm-fg); }
.wm-lobby .row .st {
  font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--wm-muted-fg); flex: none;
}
.wm-lobby .row.ready .st { color: var(--wm-ok); }
.wm-lobby .row.deployed .st { color: var(--wm-fg-dim); }
.wm-lobby .row.warm .st { color: var(--wm-warn); }
/* A row that just appeared. The presence card says who arrived; this is what
   points at WHERE they landed, so the two are one gesture rather than a card
   the player has to reconcile with a list that silently grew. Rebuilt on every
   lobby frame, so render() carries the elapsed time in as a negative delay and
   the flash keeps running instead of restarting. */
.wm-lobby .row.fresh { animation: wm-row-in ${ROW_FLASH_MS}ms cubic-bezier(.2,.85,.3,1) both; }
/* Colour only, no transform — nothing here for prefers-reduced-motion to undo. */
@keyframes wm-row-in {
  0% { background: var(--wm-hover); box-shadow: inset 3px 0 0 var(--wm-ok); }
  100% { background: transparent; box-shadow: inset 3px 0 0 transparent; }
}
.wm-lobby .empty {
  padding: 18px; font-size: 13px; line-height: 1.55; color: var(--wm-muted-fg);
}
.wm-lobby .status { font-size: 12px; line-height: 1.45; color: var(--wm-muted-fg); flex: 1 1 auto; }
.wm-lobby .status b { color: var(--wm-fg); font-weight: 600; }

/* ── status strip ────────────────────────────────────────────────────────── */
.wm-lobby .strip {
  display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 10px 24px;
  min-height: 36px; background: var(--wm-panel); border-top: 1px solid var(--wm-border);
  font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase;
  color: var(--wm-muted-fg);
}
.wm-lobby .strip b { color: var(--wm-fg-dim); font-weight: 600; }
.wm-lobby .strip .key {
  border: 1px solid var(--wm-border); border-radius: 3px; padding: 1px 5px;
  margin-right: 5px; color: var(--wm-fg-dim);
}

/* ── countdown ───────────────────────────────────────────────────────────── */
/* Shares .body for its padding and grid row, so it has to reset the two-column
   template or the number lands in the hero column instead of the middle. */
.wm-lobby .count {
  display: grid; grid-template-columns: minmax(0, 1fr); place-items: center;
  text-align: center; padding: 40px 24px;
}
.wm-lobby .count .n {
  font-family: var(--wm-display); font-size: clamp(96px, 17vh, 190px); line-height: 1;
  letter-spacing: .04em; color: var(--wm-fg); font-variant-numeric: tabular-nums;
}
/* The one place motion overshoots — a panel-open beat, per DESIGN.md. */
.wm-lobby .count .n.beat { animation: wm-beat 180ms cubic-bezier(.2,.85,.3,1); }
@keyframes wm-beat { from { transform: scale(1.12); opacity: .35 } to { transform: none; opacity: 1 } }
.wm-lobby .count .lbl {
  margin-top: 18px; font-family: var(--wm-display); font-size: 26px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--wm-fg-dim);
}
.wm-lobby .count .sub { margin-top: 10px; font-size: 13px; color: var(--wm-muted-fg); }

/* ── responsive ──────────────────────────────────────────────────────────── */
/* Semantic thresholds, not device names: the room panel drops under the hero as
   soon as a 372px rail would squeeze the display type. */
@media (max-width: 1080px) {
  /* align-content, not just align-items: two auto rows in a taller grid stretch
     by default, which opens a dead gap between the CTA and the room panel on a
     portrait tablet. Centre the pair as one block instead. */
  .wm-lobby .body {
    grid-template-columns: minmax(0, 1fr); align-items: start; align-content: center; gap: 20px;
  }
  .wm-lobby .panel { max-height: none; }
}
@media (max-width: 720px) {
  .wm-lobby .bar { gap: 10px; padding: 10px 16px; flex-wrap: wrap; }
  .wm-lobby .bar .wm-mark { font-size: 24px; }
  .wm-lobby .callsign input { width: 116px; }
  .wm-lobby .body { padding: 20px 16px; }
  .wm-lobby .cta { grid-template-columns: minmax(0, 1fr); }
  .wm-lobby .lede { font-size: 14px; margin-bottom: 22px; }
  .wm-lobby .strip { gap: 12px; padding: 9px 16px; }
}
/* Short windows: the display type yields to the buttons, never the other way. */
@media (max-height: 680px) {
  .wm-lobby .body { padding: 16px 24px; gap: 16px; }
  .wm-lobby .hero .wm-mark { font-size: clamp(44px, 6vw, 68px); margin-bottom: 16px; }
  .wm-lobby .hero .eyebrow { margin-bottom: 10px; }
  .wm-lobby .lede { font-size: 14px; margin-bottom: 18px; }
  .wm-lobby .opts { margin-bottom: 16px; }
  .wm-lobby .maps { margin-bottom: 14px; }
  .wm-lobby .mapcard { padding: 9px 11px; }
  .wm-lobby .mapcard .bl { display: none; }
  .wm-lobby .btn-primary { font-size: 22px; padding: 12px 24px 10px; }
  .wm-lobby .btn-ghost { font-size: 17px; padding: 10px 18px 8px; }
}

/* ── visual explorations ──────────────────────────────────────────────────
   These are intentionally independent of the production brand tokens above.
   The selector is a design-lab affordance: it keeps the interaction model
   identical while making the visual posture easy to compare in a real room. */
.wm-lobby.variant-signal {
  --lab-ink: #f7f4ed; --lab-soft: #c0c4cc; --lab-dim: #858b98;
  --lab-accent: #ff6b35; --lab-blue: #75a7ff; --lab-line: rgba(247,244,237,.17);
  --lab-panel: rgba(18, 24, 38, .74); --lab-panel-2: rgba(28, 36, 55, .8);
  background: radial-gradient(circle at 78% 16%, rgba(48,94,170,.32), transparent 32%),
    linear-gradient(115deg, rgba(10,15,26,.94) 0%, rgba(17,24,40,.82) 55%, rgba(10,15,26,.95) 100%);
  color: var(--lab-ink); font-family: Inter, system-ui, sans-serif;
}
.wm-lobby.variant-signal .bar { min-height: 72px; padding: 0 34px; background: rgba(9,14,24,.46); border-color: var(--lab-line); }
.wm-lobby.variant-signal .bar .wm-mark { font-size: 32px; }
.wm-lobby.variant-signal .body { grid-template-columns: minmax(0, 1fr) 330px; gap: 56px; max-width: 1380px; padding: 70px 42px 58px; align-items: start; }
.wm-lobby.variant-signal .hero { padding-top: 18px; }
.wm-lobby.variant-signal .eyebrow { color: var(--lab-accent); letter-spacing: .2em; }
.wm-lobby.variant-signal .hero .wm-mark { font-family: Inter, system-ui, sans-serif; font-size: clamp(64px, 10vw, 148px); font-weight: 800; letter-spacing: -.075em; line-height: .84; margin: 20px 0 30px; }
.wm-lobby.variant-signal .wm-mark .t::after, .wm-lobby.variant-signal .wm-mark .t::before { background: var(--lab-accent); }
.wm-lobby.variant-signal .lede { max-width: 38ch; color: var(--lab-soft); font-size: 18px; line-height: 1.45; }
.wm-lobby.variant-signal .lede b { color: var(--lab-ink); }
.wm-lobby.variant-signal .maps, .wm-lobby.variant-signal .opts { margin-bottom: 27px; }
.wm-lobby.variant-signal .mapcards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.wm-lobby.variant-signal .mapcard { min-height: 122px; max-width: none; padding: 17px; border: 1px solid var(--lab-line); border-radius: 0; background: var(--lab-panel-2); }
.wm-lobby.variant-signal .mapcard:hover:not(:disabled) { border-color: var(--lab-blue); transform: translateY(-2px); }
.wm-lobby.variant-signal .mapcard[aria-pressed="true"] { border-color: var(--lab-accent); background: linear-gradient(135deg, rgba(255,107,53,.2), var(--lab-panel-2)); box-shadow: inset 4px 0 var(--lab-accent); }
.wm-lobby.variant-signal .mapcard .nm { font-family: Inter, system-ui, sans-serif; font-size: 17px; font-weight: 800; letter-spacing: .02em; }
.wm-lobby.variant-signal .mapcard .sub { color: var(--lab-blue); }
.wm-lobby.variant-signal .mapcard .bl, .wm-lobby.variant-signal .mapcard .sz, .wm-lobby.variant-signal .note { color: var(--lab-dim); }
.wm-lobby.variant-signal .chip { border-radius: 999px; background: transparent; border-color: var(--lab-line); }
.wm-lobby.variant-signal .chip[aria-pressed="true"] { background: var(--lab-accent); border-color: var(--lab-accent); color: #17121a; }
.wm-lobby.variant-signal .cta { max-width: none; }
.wm-lobby.variant-signal .btn { border-radius: 0; }
.wm-lobby.variant-signal .btn-primary { background: var(--lab-accent); color: #17121a; font-family: Inter, system-ui, sans-serif; font-size: 17px; font-weight: 800; padding: 18px 26px; }
.wm-lobby.variant-signal .btn-primary:hover:not(:disabled) { background: #ff8c61; }
.wm-lobby.variant-signal .btn-ghost { border-color: var(--lab-line); color: var(--lab-ink); font-family: Inter, system-ui, sans-serif; font-size: 15px; }
.wm-lobby.variant-signal .panel { border-radius: 0; border-color: var(--lab-line); background: var(--lab-panel); box-shadow: 16px 16px 0 rgba(0,0,0,.16); }
.wm-lobby.variant-signal .panel-hd { padding: 20px; border-color: var(--lab-line); }
.wm-lobby.variant-signal .h-sec, .wm-lobby.variant-signal .code { font-family: Inter, system-ui, sans-serif; font-weight: 800; letter-spacing: .02em; }
.wm-lobby.variant-signal .row + .row, .wm-lobby.variant-signal .panel-ft { border-color: var(--lab-line); }
.wm-lobby.variant-signal .strip { padding: 13px 34px; background: rgba(9,14,24,.72); border-color: var(--lab-line); color: var(--lab-dim); }

.wm-lobby.variant-terminal {
  --lab-ink: #d7f9df; --lab-soft: #91b99c; --lab-dim: #5e8769; --lab-accent: #9cff57;
  background: #07110c; color: var(--lab-ink); font-family: 'SFMono-Regular', Consolas, monospace;
  background-image: linear-gradient(rgba(156,255,87,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(156,255,87,.025) 1px, transparent 1px);
  background-size: 32px 32px;
}
.wm-lobby.variant-terminal::before { content: 'WORKMELT // SECURE SESSION'; position: fixed; top: 92px; right: 34px; color: var(--lab-dim); font-size: 10px; letter-spacing: .16em; writing-mode: vertical-rl; }
.wm-lobby.variant-terminal .bar { min-height: 58px; padding: 0 28px; background: #0a1810; border-bottom: 1px solid rgba(156,255,87,.24); }
.wm-lobby.variant-terminal .bar .wm-mark { font-family: inherit; font-size: 18px; letter-spacing: .18em; }
.wm-lobby.variant-terminal .callsign label, .wm-lobby.variant-terminal .eyebrow, .wm-lobby.variant-terminal .strip { color: var(--lab-dim); }
.wm-lobby.variant-terminal .callsign input { width: 160px; border: 0; border-bottom: 1px solid var(--lab-dim); border-radius: 0; background: transparent; padding: 6px 2px; color: var(--lab-ink); }
.wm-lobby.variant-terminal .callsign input:focus { border-color: var(--lab-accent); }
.wm-lobby.variant-terminal .body { grid-template-columns: minmax(0, 1fr) 360px; max-width: 1240px; padding: 64px 28px 46px; gap: 44px; align-items: start; }
.wm-lobby.variant-terminal .hero .wm-mark { font-family: inherit; font-size: clamp(42px, 7vw, 88px); letter-spacing: -.08em; color: var(--lab-accent); margin: 18px 0 26px; text-shadow: 0 0 24px rgba(156,255,87,.26); }
.wm-lobby.variant-terminal .wm-mark .t::after, .wm-lobby.variant-terminal .wm-mark .t::before { background: var(--lab-accent); }
.wm-lobby.variant-terminal .lede { color: var(--lab-soft); font-size: 14px; max-width: 55ch; }
.wm-lobby.variant-terminal .lede b, .wm-lobby.variant-terminal .mapcard .nm { color: var(--lab-ink); }
.wm-lobby.variant-terminal .mapcards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: rgba(156,255,87,.23); border: 1px solid rgba(156,255,87,.23); }
.wm-lobby.variant-terminal .mapcard { max-width: none; min-height: 112px; border: 0; border-radius: 0; background: #0a1810; padding: 14px; }
.wm-lobby.variant-terminal .mapcard:hover:not(:disabled), .wm-lobby.variant-terminal .mapcard[aria-pressed="true"] { background: #112619; }
.wm-lobby.variant-terminal .mapcard[aria-pressed="true"] { box-shadow: inset 3px 0 var(--lab-accent); }
.wm-lobby.variant-terminal .mapcard .nm { font-family: inherit; font-size: 15px; letter-spacing: .02em; }
.wm-lobby.variant-terminal .mapcard .sub { color: var(--lab-accent); font-size: 10px; }
.wm-lobby.variant-terminal .mapcard .bl, .wm-lobby.variant-terminal .mapcard .sz, .wm-lobby.variant-terminal .note { color: var(--lab-soft); }
.wm-lobby.variant-terminal .chip { border-radius: 0; border-color: rgba(156,255,87,.22); background: transparent; color: var(--lab-soft); }
.wm-lobby.variant-terminal .chip[aria-pressed="true"] { color: #07110c; background: var(--lab-accent); border-color: var(--lab-accent); }
.wm-lobby.variant-terminal .btn { border-radius: 0; font-family: inherit; }
.wm-lobby.variant-terminal .btn-primary { background: var(--lab-accent); color: #07110c; font-size: 15px; padding: 16px; }
.wm-lobby.variant-terminal .btn-ghost { border-color: rgba(156,255,87,.38); color: var(--lab-ink); font-size: 14px; }
.wm-lobby.variant-terminal .panel { border-radius: 0; border-color: rgba(156,255,87,.28); background: rgba(7,17,12,.8); box-shadow: none; }
.wm-lobby.variant-terminal .panel-hd, .wm-lobby.variant-terminal .row + .row, .wm-lobby.variant-terminal .panel-ft { border-color: rgba(156,255,87,.18); }
.wm-lobby.variant-terminal .h-sec, .wm-lobby.variant-terminal .code { font-family: inherit; font-size: 15px; color: var(--lab-accent); }
.wm-lobby.variant-terminal .strip { background: #0a1810; border-color: rgba(156,255,87,.24); }

.wm-lobby.variant-field {
  --lab-ink: #17211e; --lab-soft: #4c5a53; --lab-dim: #768078; --lab-accent: #cb4e2c;
  color: var(--lab-ink); font-family: Georgia, 'Times New Roman', serif;
  background: linear-gradient(115deg, rgba(239,231,211,.96), rgba(214,218,200,.9));
}
.wm-lobby.variant-field .bar { min-height: 78px; padding: 0 42px; background: rgba(245,239,224,.78); border-color: rgba(23,33,30,.18); }
.wm-lobby.variant-field .bar .wm-mark { color: var(--lab-ink); font-family: Georgia, serif; font-size: 24px; letter-spacing: .12em; }
.wm-lobby.variant-field .callsign label, .wm-lobby.variant-field .eyebrow { color: var(--lab-accent); font-family: Inter, system-ui, sans-serif; }
.wm-lobby.variant-field .callsign input { width: 150px; color: var(--lab-ink); background: transparent; border: 0; border-bottom: 1px solid rgba(23,33,30,.4); border-radius: 0; }
.wm-lobby.variant-field .body { grid-template-columns: minmax(0, 1fr) 350px; max-width: 1280px; padding: 72px 42px 54px; gap: 52px; align-items: start; }
.wm-lobby.variant-field .hero .wm-mark { color: var(--lab-ink); font-family: Georgia, serif; font-size: clamp(62px, 9vw, 132px); font-weight: 700; letter-spacing: -.1em; line-height: .8; margin: 18px 0 30px; }
.wm-lobby.variant-field .wm-mark .t::after, .wm-lobby.variant-field .wm-mark .t::before { background: var(--lab-accent); }
.wm-lobby.variant-field .lede { color: var(--lab-soft); font-size: 18px; line-height: 1.5; max-width: 35ch; }
.wm-lobby.variant-field .lede b { color: var(--lab-ink); }
.wm-lobby.variant-field .mapcards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.wm-lobby.variant-field .mapcard { max-width: none; min-height: 136px; padding: 16px; border: 1px solid rgba(23,33,30,.24); border-radius: 2px; background: rgba(250,246,235,.46); }
.wm-lobby.variant-field .mapcard:hover:not(:disabled) { border-color: var(--lab-accent); }
.wm-lobby.variant-field .mapcard[aria-pressed="true"] { border: 2px solid var(--lab-accent); background: rgba(250,246,235,.8); }
.wm-lobby.variant-field .mapcard .nm { color: var(--lab-ink); font-family: Georgia, serif; font-size: 21px; font-weight: 700; letter-spacing: 0; }
.wm-lobby.variant-field .mapcard .sub { color: var(--lab-accent); font-family: Inter, system-ui, sans-serif; font-size: 10px; }
.wm-lobby.variant-field .mapcard .bl, .wm-lobby.variant-field .mapcard .sz, .wm-lobby.variant-field .note { color: var(--lab-soft); }
.wm-lobby.variant-field .chip { border-radius: 2px; border-color: rgba(23,33,30,.28); background: transparent; color: var(--lab-soft); }
.wm-lobby.variant-field .chip[aria-pressed="true"] { color: #fff7e7; background: var(--lab-accent); border-color: var(--lab-accent); }
.wm-lobby.variant-field .btn { border-radius: 2px; font-family: Inter, system-ui, sans-serif; }
.wm-lobby.variant-field .btn-primary { background: var(--lab-ink); color: #fff7e7; font-size: 15px; padding: 17px; }
.wm-lobby.variant-field .btn-primary:hover:not(:disabled) { background: var(--lab-accent); }
.wm-lobby.variant-field .btn-ghost { color: var(--lab-ink); border-color: rgba(23,33,30,.55); font-size: 14px; }
.wm-lobby.variant-field .panel { border-radius: 2px; border-color: rgba(23,33,30,.28); background: rgba(250,246,235,.62); box-shadow: 8px 8px 0 rgba(23,33,30,.1); }
.wm-lobby.variant-field .panel-hd, .wm-lobby.variant-field .row + .row, .wm-lobby.variant-field .panel-ft { border-color: rgba(23,33,30,.16); }
.wm-lobby.variant-field .h-sec, .wm-lobby.variant-field .code { color: var(--lab-ink); font-family: Georgia, serif; }
.wm-lobby.variant-field .strip { background: rgba(245,239,224,.8); border-color: rgba(23,33,30,.18); color: var(--lab-soft); }

.wm-lobby.variant-spreadsheet {
  --sheet-ink: #f3f6f3; --sheet-soft: #c1f0c8; --sheet-muted: #9ca89f;
  --sheet-lime: #83e28e; --sheet-green: #47d359; --sheet-mid: #12501a;
  --sheet-deep: #0d3512; --sheet-line: rgba(193,240,200,.2);
  color: var(--sheet-ink); font-family: Inter, system-ui, sans-serif;
  background: var(--sheet-deep);
  background-image: linear-gradient(rgba(193,240,200,.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(193,240,200,.055) 1px, transparent 1px),
    linear-gradient(120deg, rgba(71,211,89,.14), transparent 38%);
  background-size: 28px 28px, 28px 28px, auto;
}
.wm-lobby.variant-spreadsheet .bar { min-height: 64px; padding: 0 30px; background: rgba(13,53,18,.95); border-color: var(--sheet-line); }
.wm-lobby.variant-spreadsheet .bar .wm-mark { color: var(--sheet-ink); font-family: Inter, system-ui, sans-serif; font-size: 22px; font-weight: 800; letter-spacing: .08em; }
.wm-lobby.variant-spreadsheet .wm-mark .t::after, .wm-lobby.variant-spreadsheet .wm-mark .t::before { background: var(--sheet-green); }
.wm-lobby.variant-spreadsheet .callsign label, .wm-lobby.variant-spreadsheet .eyebrow { color: var(--sheet-muted); font-family: Inter, system-ui, sans-serif; }
.wm-lobby.variant-spreadsheet .callsign input { width: 154px; color: var(--sheet-ink); background: rgba(7,27,11,.62); border-color: var(--sheet-line); border-radius: 2px; }
.wm-lobby.variant-spreadsheet .callsign input:focus { border-color: var(--sheet-green); }
.wm-lobby.variant-spreadsheet .body { grid-template-columns: minmax(0, 1fr) 338px; max-width: 1260px; padding: 60px 30px 46px; gap: 42px; align-items: start; }
.wm-lobby.variant-spreadsheet .hero .eyebrow { letter-spacing: .16em; }
.wm-lobby.variant-spreadsheet .hero .wm-mark { color: var(--sheet-ink); font-family: Inter, system-ui, sans-serif; font-size: clamp(54px, 8vw, 116px); font-weight: 800; letter-spacing: -.09em; line-height: .84; margin: 18px 0 26px; }
.wm-lobby.variant-spreadsheet .lede { color: var(--sheet-soft); max-width: 48ch; font-size: 16px; line-height: 1.5; }
.wm-lobby.variant-spreadsheet .lede b { color: var(--sheet-ink); }
.wm-lobby.variant-spreadsheet .maps, .wm-lobby.variant-spreadsheet .opts { margin-bottom: 24px; }
.wm-lobby.variant-spreadsheet .maps .hd { border-bottom: 1px solid var(--sheet-line); padding-bottom: 8px; }
.wm-lobby.variant-spreadsheet .maps .hd .note { color: var(--sheet-muted); }
.wm-lobby.variant-spreadsheet .mapcards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--sheet-line); border: 1px solid var(--sheet-line); }
.wm-lobby.variant-spreadsheet .mapcard { max-width: none; min-height: 126px; padding: 15px; border: 0; border-radius: 0; background: rgba(13,53,18,.88); }
.wm-lobby.variant-spreadsheet .mapcard:hover:not(:disabled) { background: rgba(18,80,26,.92); }
.wm-lobby.variant-spreadsheet .mapcard[aria-pressed="true"] { background: var(--sheet-mid); box-shadow: inset 4px 0 var(--sheet-green); }
.wm-lobby.variant-spreadsheet .mapcard .nm { color: var(--sheet-ink); font-family: Inter, system-ui, sans-serif; font-size: 17px; font-weight: 700; letter-spacing: .02em; }
.wm-lobby.variant-spreadsheet .mapcard .sub { color: var(--sheet-lime); font-family: Inter, system-ui, sans-serif; font-size: 10px; }
.wm-lobby.variant-spreadsheet .mapcard .bl, .wm-lobby.variant-spreadsheet .mapcard .sz, .wm-lobby.variant-spreadsheet .note { color: var(--sheet-muted); }
.wm-lobby.variant-spreadsheet .opts .eyebrow { color: var(--sheet-muted); }
.wm-lobby.variant-spreadsheet .chip { border-radius: 2px; border-color: var(--sheet-line); background: rgba(7,27,11,.55); color: var(--sheet-soft); }
.wm-lobby.variant-spreadsheet .chip:hover { border-color: var(--sheet-lime); }
.wm-lobby.variant-spreadsheet .chip[aria-pressed="true"] { color: #071b0b; background: var(--sheet-lime); border-color: var(--sheet-lime); }
.wm-lobby.variant-spreadsheet .cta { max-width: none; }
.wm-lobby.variant-spreadsheet .btn { border-radius: 2px; font-family: Inter, system-ui, sans-serif; }
.wm-lobby.variant-spreadsheet .btn-primary { background: var(--sheet-green); color: #071b0b; font-size: 16px; font-weight: 800; padding: 17px 24px; }
.wm-lobby.variant-spreadsheet .btn-primary:hover:not(:disabled) { background: var(--sheet-lime); }
.wm-lobby.variant-spreadsheet .btn-ghost { border-color: var(--sheet-line); color: var(--sheet-ink); font-size: 14px; }
.wm-lobby.variant-spreadsheet .btn-ghost:hover:not(:disabled) { border-color: var(--sheet-green); color: var(--sheet-soft); }
.wm-lobby.variant-spreadsheet .panel { border-radius: 2px; border-color: var(--sheet-line); background: rgba(7,27,11,.84); box-shadow: 0 14px 35px rgba(0,0,0,.22); }
.wm-lobby.variant-spreadsheet .panel-hd { padding: 17px 18px; border-color: var(--sheet-line); }
.wm-lobby.variant-spreadsheet .h-sec, .wm-lobby.variant-spreadsheet .code { color: var(--sheet-ink); font-family: Inter, system-ui, sans-serif; font-weight: 800; letter-spacing: .02em; }
.wm-lobby.variant-spreadsheet .row + .row, .wm-lobby.variant-spreadsheet .panel-ft { border-color: rgba(193,240,200,.14); }
.wm-lobby.variant-spreadsheet .row.ready .dot { background: var(--sheet-green); }
.wm-lobby.variant-spreadsheet .row.ready .st { color: var(--sheet-lime); }
.wm-lobby.variant-spreadsheet .strip { padding: 12px 30px; background: rgba(13,53,18,.96); border-color: var(--sheet-line); color: var(--sheet-muted); }
.wm-lobby.variant-spreadsheet .strip b { color: var(--sheet-soft); }

/* ── linear canvas exploration ────────────────────────────────────────────
   Deep canvas, a stepped charcoal surface ladder, one lavender-blue accent,
   and product-like tiles carrying the information density. No shadows or
   atmospheric treatment: hierarchy comes from surfaces and hairlines. */
.wm-lobby.variant-linear {
  --linear-canvas: #010102; --linear-surface-1: #0b0c0f; --linear-surface-2: #111318;
  --linear-surface-3: #181a20; --linear-surface-4: #20232a;
  --linear-ink: #f7f8f8; --linear-muted: #d0d6e0; --linear-subtle: #8a8f98;
  --linear-tertiary: #62666d; --linear-hairline: #23252a; --linear-strong: #353943;
  --linear-primary: #5e6ad2; --linear-hover: #828fff; --linear-focus: #5e69d1;
  color: var(--linear-ink); font-family: Inter, -apple-system, system-ui, sans-serif;
  background: var(--linear-canvas);
}
.wm-lobby.variant-linear .bar { min-height: 56px; padding: 0 30px; background: var(--linear-canvas); border-color: var(--linear-hairline); }
.wm-lobby.variant-linear .bar .wm-mark { color: var(--linear-ink); font-family: Inter, -apple-system, system-ui, sans-serif; font-size: 19px; font-weight: 700; letter-spacing: -.04em; }
.wm-lobby.variant-linear .wm-mark .t::after, .wm-lobby.variant-linear .wm-mark .t::before { background: var(--linear-primary); }
.wm-lobby.variant-linear .callsign label, .wm-lobby.variant-linear .eyebrow { color: var(--linear-subtle); font-family: Inter, -apple-system, system-ui, sans-serif; }
.wm-lobby.variant-linear .callsign input { width: 150px; color: var(--linear-ink); background: var(--linear-surface-1); border-color: var(--linear-hairline); border-radius: 8px; }
.wm-lobby.variant-linear .callsign input:focus { border-color: var(--linear-strong); outline: 2px solid rgba(94,105,209,.5); outline-offset: 1px; }
.wm-lobby.variant-linear .icon-btn { border-color: var(--linear-hairline); border-radius: 8px; color: var(--linear-subtle); }
.wm-lobby.variant-linear .icon-btn:hover { color: var(--linear-ink); border-color: var(--linear-strong); }
.wm-lobby.variant-linear .body { grid-template-columns: minmax(0, 1fr) 352px; max-width: 1280px; padding: 78px 30px 64px; gap: 32px; align-items: start; }
.wm-lobby.variant-linear .hero { padding-top: 8px; }
.wm-lobby.variant-linear .hero .eyebrow { color: var(--linear-primary); letter-spacing: .03em; text-transform: none; }
.wm-lobby.variant-linear .hero .wm-mark { color: var(--linear-ink); font-family: Inter, -apple-system, system-ui, sans-serif; font-size: clamp(62px, 8vw, 112px); font-weight: 600; letter-spacing: -.075em; line-height: 1.02; margin: 20px 0 24px; }
.wm-lobby.variant-linear .lede { color: var(--linear-muted); max-width: 48ch; font-size: 18px; line-height: 1.5; letter-spacing: -.01em; }
.wm-lobby.variant-linear .lede b { color: var(--linear-ink); font-weight: 500; }
.wm-lobby.variant-linear .maps, .wm-lobby.variant-linear .opts { margin-bottom: 32px; }
.wm-lobby.variant-linear .maps .hd { margin-bottom: 12px; }
.wm-lobby.variant-linear .maps .hd .note, .wm-lobby.variant-linear .note { color: var(--linear-subtle); }
.wm-lobby.variant-linear .mapcards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.wm-lobby.variant-linear .mapcard { max-width: none; min-height: 142px; padding: 20px; border: 1px solid var(--linear-hairline); border-radius: 12px; background: var(--linear-surface-1); }
.wm-lobby.variant-linear .mapcard::before { content: ''; display: block; height: 1px; margin: -20px -20px 18px; background: rgba(247,248,248,.08); }
.wm-lobby.variant-linear .mapcard:hover:not(:disabled) { border-color: var(--linear-strong); background: var(--linear-surface-2); }
.wm-lobby.variant-linear .mapcard[aria-pressed="true"] { border-color: var(--linear-primary); background: var(--linear-surface-2); box-shadow: 0 0 0 1px rgba(94,106,210,.16); }
.wm-lobby.variant-linear .mapcard .nm { color: var(--linear-ink); font-family: Inter, -apple-system, system-ui, sans-serif; font-size: 18px; font-weight: 500; letter-spacing: -.03em; }
.wm-lobby.variant-linear .mapcard .sub { color: var(--linear-muted); font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none; }
.wm-lobby.variant-linear .mapcard .bl, .wm-lobby.variant-linear .mapcard .sz { color: var(--linear-subtle); }
.wm-lobby.variant-linear .chip { border-color: var(--linear-hairline); border-radius: 999px; background: var(--linear-canvas); color: var(--linear-subtle); }
.wm-lobby.variant-linear .chip:hover { border-color: var(--linear-strong); color: var(--linear-muted); }
.wm-lobby.variant-linear .chip[aria-pressed="true"] { color: var(--linear-ink); background: var(--linear-surface-2); border-color: var(--linear-strong); }
.wm-lobby.variant-linear .cta { max-width: none; gap: 8px; }
.wm-lobby.variant-linear .btn { border-radius: 8px; font-family: Inter, -apple-system, system-ui, sans-serif; font-size: 14px; font-weight: 500; letter-spacing: 0; }
.wm-lobby.variant-linear .btn-primary { background: var(--linear-primary); color: #fff; padding: 12px 18px; }
.wm-lobby.variant-linear .btn-primary:hover:not(:disabled) { background: var(--linear-hover); }
.wm-lobby.variant-linear .btn-primary:focus-visible, .wm-lobby.variant-linear .btn-ghost:focus-visible { outline: 2px solid rgba(94,105,209,.5); outline-offset: 2px; }
.wm-lobby.variant-linear .btn-ghost { background: var(--linear-surface-1); color: var(--linear-ink); border-color: var(--linear-hairline); padding: 12px 18px; }
.wm-lobby.variant-linear .btn-ghost:hover:not(:disabled) { background: var(--linear-surface-2); border-color: var(--linear-strong); }
.wm-lobby.variant-linear .panel { border-radius: 16px; border-color: var(--linear-hairline); background: var(--linear-surface-1); box-shadow: none; }
.wm-lobby.variant-linear .panel-hd { padding: 20px 22px; border-color: var(--linear-hairline); }
.wm-lobby.variant-linear .h-sec, .wm-lobby.variant-linear .code { color: var(--linear-ink); font-family: Inter, -apple-system, system-ui, sans-serif; font-weight: 600; letter-spacing: -.03em; }
.wm-lobby.variant-linear .code { color: var(--linear-muted); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 17px; letter-spacing: .08em; }
.wm-lobby.variant-linear .btn-sm { border-color: var(--linear-hairline); border-radius: 6px; background: var(--linear-surface-2); color: var(--linear-muted); }
.wm-lobby.variant-linear .row + .row, .wm-lobby.variant-linear .panel-ft { border-color: var(--linear-hairline); }
.wm-lobby.variant-linear .row:hover { background: var(--linear-surface-2); }
.wm-lobby.variant-linear .row.ready .dot { background: var(--linear-primary); }
.wm-lobby.variant-linear .row.ready .st { color: var(--linear-muted); }
.wm-lobby.variant-linear .strip { padding: 12px 30px; background: var(--linear-canvas); border-color: var(--linear-hairline); color: var(--linear-subtle); }
.wm-lobby.variant-linear .strip b { color: var(--linear-muted); }
.wm-lobby.variant-linear .style-picker .label, .wm-lobby.variant-linear .style-picker button { color: var(--linear-subtle); border-color: var(--linear-hairline); }
.wm-lobby.variant-linear .style-picker button[aria-pressed="true"] { color: var(--linear-primary); }

/* style picker shared by all directions */
.wm-lobby .style-picker { display: flex; align-items: center; gap: 5px; margin-right: 8px; }
.wm-lobby .style-picker .label { margin-right: 3px; color: var(--wm-muted-fg); font: 600 10px/1 Inter, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.wm-lobby .style-picker button { border: 1px solid var(--wm-border); border-radius: 999px; background: transparent; color: var(--wm-muted-fg); padding: 6px 9px; cursor: pointer; font: 600 10px/1 Inter, system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
.wm-lobby .style-picker button:hover, .wm-lobby .style-picker button[aria-pressed="true"] { color: var(--wm-fg); border-color: currentColor; }
.wm-lobby.variant-signal .style-picker .label, .wm-lobby.variant-signal .style-picker button { color: var(--lab-soft); border-color: var(--lab-line); }
.wm-lobby.variant-signal .style-picker button[aria-pressed="true"] { color: var(--lab-accent); }
.wm-lobby.variant-terminal .style-picker .label, .wm-lobby.variant-terminal .style-picker button { color: var(--lab-dim); border-color: rgba(156,255,87,.24); }
.wm-lobby.variant-terminal .style-picker button[aria-pressed="true"] { color: var(--lab-accent); }
.wm-lobby.variant-field .style-picker .label, .wm-lobby.variant-field .style-picker button { color: var(--lab-soft); border-color: rgba(23,33,30,.25); }
.wm-lobby.variant-field .style-picker button[aria-pressed="true"] { color: var(--lab-accent); }
.wm-lobby.variant-spreadsheet .style-picker .label, .wm-lobby.variant-spreadsheet .style-picker button { color: var(--sheet-muted); border-color: var(--sheet-line); }
.wm-lobby.variant-spreadsheet .style-picker button[aria-pressed="true"] { color: var(--sheet-lime); }
@media (max-width: 1080px) {
  .wm-lobby.variant-signal .body, .wm-lobby.variant-terminal .body, .wm-lobby.variant-field .body, .wm-lobby.variant-spreadsheet .body, .wm-lobby.variant-linear .body { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 720px) {
  .wm-lobby .style-picker { order: 3; width: 100%; margin: 3px 0 0; }
  .wm-lobby.variant-signal .bar, .wm-lobby.variant-field .bar { padding: 12px 16px; }
  .wm-lobby.variant-signal .body, .wm-lobby.variant-terminal .body, .wm-lobby.variant-field .body, .wm-lobby.variant-linear .body { padding: 38px 16px; }
  .wm-lobby.variant-signal .mapcards, .wm-lobby.variant-terminal .mapcards, .wm-lobby.variant-field .mapcards, .wm-lobby.variant-spreadsheet .mapcards, .wm-lobby.variant-linear .mapcards { grid-template-columns: minmax(0, 1fr); }
}
`;

/** Sizes offered for the bot garrison; `squads` × `perSquad` hostiles. */
export const BOT_PRESETS = [
  { key: 'off', label: 'No bots', squads: 0, perSquad: 0, note: 'Players only — nobody but whoever joins your room.' },
  { key: 'light', label: 'Light', squads: 1, perSquad: 3, note: 'One patrol of 3. A quiet floor with something to shoot.' },
  { key: 'standard', label: 'Standard', squads: 2, perSquad: 3, note: 'Two squads of 3 on patrol routes — the default garrison.' },
  { key: 'heavy', label: 'Heavy', squads: 3, perSquad: 4, note: 'Three squads of 4. Contact almost everywhere.' },
];

const GEAR_SVG = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor"
  stroke-width="1.5" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/>
  <circle cx="7" cy="6" r="1.8"/><circle cx="13" cy="10" r="1.8"/><circle cx="8" cy="14" r="1.8"/></svg>`;

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
     * Room presence cards — under the bar and centred, i.e. exactly where the
     * in-match overlay puts them, because the player crosses between the two
     * screens and the news must not move.
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
      <div class="shell">
        <header class="bar">
          <span class="wm-mark">${WORDMARK_HTML}</span>
          <span class="spacer"></span>
          <div class="style-picker" role="group" aria-label="Visual style">
            <span class="label">Style</span>
            <button type="button" data-style="signal" aria-pressed="true">Signal</button>
            <button type="button" data-style="terminal" aria-pressed="false">Terminal</button>
            <button type="button" data-style="field" aria-pressed="false">Field notes</button>
            <button type="button" data-style="spreadsheet" aria-pressed="false">Spreadsheet</button>
            <button type="button" data-style="linear" aria-pressed="false">Linear</button>
          </div>
          <span class="callsign">
            <label for="wm-callsign">Callsign</label>
            <input id="wm-callsign" data-name maxlength="20" spellcheck="false" autocomplete="off" />
          </span>
          <button type="button" class="icon-btn" data-settings title="Settings (Esc)"
            aria-label="Settings">${GEAR_SVG}</button>
        </header>

        <div class="body" data-body>
          <section class="hero">
            <span class="eyebrow" data-eyebrow></span>
            <span class="wm-mark">${WORDMARK_HTML}</span>
            <p class="lede">A tactical arena built out of the floor you already work on.
              <b>Browser-first</b>, no install — send a link and your co-workers are in.</p>
            <div class="maps" data-maps>
              <div class="hd">
                <span class="eyebrow">Map</span>
                <span class="note" data-map-note></span>
              </div>
              <div class="mapcards" data-mapcards role="group" aria-label="Map"></div>
            </div>
            <div class="opts">
              <span class="eyebrow">Garrison</span>
              <div class="chips" data-bots role="group" aria-label="Garrison size"></div>
              <p class="note" data-bot-note></p>
            </div>
            <div class="cta">
              <button type="button" class="btn btn-primary" data-primary>Play</button>
              <button type="button" class="btn btn-ghost" data-copy>Copy invite link</button>
            </div>
            <button type="button" class="alt hide" data-alt>Warm up against bots while you wait</button>
          </section>

          <aside class="panel" data-room-panel>
            <div class="panel-hd">
              <span class="h-sec">Room</span>
              <span class="spacer"></span>
              <span class="code" data-room>------</span>
              <button type="button" class="btn-sm" data-copy-2>Copy</button>
            </div>
            <div class="panel-bd wm-scroll" data-roster></div>
            <div class="panel-ft"><span class="status" data-status>Connecting to the relay…</span></div>
          </aside>
        </div>

        <div class="body count hide" data-count>
          <div>
            <div class="n" data-count-n>3</div>
            <div class="lbl" data-count-lbl>Match starting</div>
            <div class="sub" data-count-sub>Deploying to the floor</div>
          </div>
        </div>

        <footer class="strip">
          <span data-strip-room>Room <b>------</b></span>
          <span data-strip-net>Relay <b>connecting</b></span>
          <span class="spacer"></span>
          <span><span class="key">Enter</span><b data-strip-primary>Play</b></span>
          <span><span class="key">C</span>Copy invite</span>
          <span><span class="key">Esc</span>Settings</span>
        </footer>
      </div>
    `;

    const q = (sel) => this.root.querySelector(sel);
    this.bodyEl = q('[data-body]');
    this.mapsEl = q('[data-maps]');
    this.mapCardsEl = q('[data-mapcards]');
    this.mapNoteEl = q('[data-map-note]');
    this.eyebrowEl = q('[data-eyebrow]');
    this.botChips = q('[data-bots]');
    this.botNote = q('[data-bot-note]');
    this.primaryBtn = q('[data-primary]');
    this.altBtn = q('[data-alt]');
    this.copyBtn = q('[data-copy]');
    this.copyBtn2 = q('[data-copy-2]');
    this.nameIn = q('[data-name]');
    this.roomEl = q('[data-room]');
    this.roomPanel = q('[data-room-panel]');
    this.rosterEl = q('[data-roster]');
    this.statusEl = q('[data-status]');
    this.countEl = q('[data-count]');
    this.countN = q('[data-count-n]');
    this.countLbl = q('[data-count-lbl]');
    this.countSub = q('[data-count-sub]');
    this.stripRoom = q('[data-strip-room]');
    this.stripNet = q('[data-strip-net]');
    this.stripPrimary = q('[data-strip-primary]');
    this.styleButtons = [...this.root.querySelectorAll('[data-style]')];
    let savedStyle = 'signal';
    try { savedStyle = localStorage.getItem('workmelt-lobby-style') || savedStyle; } catch {}
    this.style = 'signal';
    this.styleButtons.forEach((b) => b.addEventListener('click', () => this.setStyle(b.dataset.style)));
    this.setStyle(savedStyle);

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
      this.stripRoom.remove();
      this.stripNet.textContent = 'Offline — multiplayer disabled by ?mp=0';
      this.bodyEl.style.gridTemplateColumns = 'minmax(0, 1fr)';
      this.bodyEl.style.maxWidth = '980px';
    }
    this._setEyebrow();

    /** id -> card element, filled by setMaps(). */
    this.mapBtns = new Map();
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
    /** How many are ready, for the "start now with the N who are" label. */
    this._altForce = 0;
  }

  /** Switch the visual exploration without replacing the lobby model or callbacks. */
  setStyle(style = 'signal') {
    const next = ['signal', 'terminal', 'field', 'spreadsheet', 'linear'].includes(style) ? style : 'signal';
    this.style = next;
    this.root.classList.remove('variant-signal', 'variant-terminal', 'variant-field', 'variant-spreadsheet', 'variant-linear');
    this.root.classList.add(`variant-${next}`);
    for (const b of this.styleButtons) b.setAttribute('aria-pressed', String(b.dataset.style === next));
    try { localStorage.setItem('workmelt-lobby-style', next); } catch {}
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
      ? 'You were invited — join the room below'
      : 'Season 1 · Live operations';
  }

  /**
   * Build the map cards from the list `world` publishes. This view never
   * imports the world subsystem — it renders what it is handed.
   */
  setMaps(list = []) {
    this.mapCardsEl.textContent = '';
    this.mapBtns.clear();
    for (const m of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mapcard';
      b.setAttribute('aria-pressed', 'false');
      for (const [cls, text] of [
        ['nm', m.name],
        ['sub', m.subtitle],
        ['bl', m.blurb],
        ['sz', m.size],
      ]) {
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
    const shown = (code ?? '------').toUpperCase();
    this.roomEl.textContent = shown;
    if (this.stripRoom.isConnected) this.stripRoom.innerHTML = `Room <b>${escapeHtml(shown)}</b>`;
  }

  setName(name) {
    if (document.activeElement !== this.nameIn) this.nameIn.value = name ?? '';
  }

  /** Both copy buttons confirm together — they are the same action. */
  flashCopied(label = 'Link copied') {
    clearTimeout(this._copyT);
    if (this.copyBtn.isConnected) {
      this.copyBtn.textContent = label;
      this.copyBtn.classList.add('done');
    }
    this.copyBtn2.textContent = 'Copied';
    this.copyBtn2.classList.add('done');
    this._copyT = setTimeout(() => {
      if (this.copyBtn.isConnected) {
        this.copyBtn.textContent = 'Copy invite link';
        this.copyBtn.classList.remove('done');
      }
      this.copyBtn2.textContent = 'Copy';
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
    if (!players.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = m.connected
        ? 'Nobody here yet. Send the invite link and they land in this room.'
        : 'Waiting on the relay. You can play the garrison right now — co-workers can still join later.';
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

    this.stripNet.innerHTML = m.connected
      ? `Relay <b>online</b> · <b>${players.length}</b> in room`
      : `Relay <b>${m.everConnected ? 'reconnecting' : 'connecting'}</b>`;

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
          : 'Connecting to the relay…';
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

    this.primaryBtn.textContent = this.mapBusy ? 'Loading map' : label;
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
