/**
 * ===========================================================================
 * The room presence card — "somebody joined" / "somebody left"
 * ===========================================================================
 *
 * A player arriving or dropping out changes who you are about to fight, and it
 * is the one piece of room news that arrives unannounced: nobody clicked
 * anything, so if the screen does not say it loudly it is simply missed. It
 * used to be a 12px line in the same stack as the killfeed and the chat, which
 * is exactly where the eye stops looking during a firefight.
 *
 * So it gets a card of its own: a 3px state rule (Success for an arrival,
 * Danger for a departure), the callsign in the display face, the player's
 * livery swatch so the news and the body that just appeared in the level are
 * the same colour, and a five-second dwell instead of three.
 *
 * Two surfaces have to break this news and they must not disagree, which is
 * why the card lives here rather than in either of them:
 *
 *   src/net/ui.js     in a match — pushed into the overlay's toast column
 *   src/match/ui.js   in the lobby, where that overlay is deliberately hidden
 *
 * Every colour, font, radius and duration comes from the tokens in brand.js
 * (DESIGN.md); nothing here is a literal hex. Motion stays inside the 120-180ms
 * rule — the entrance is 150ms and the rest of the animation is dwell and fade.
 */

import { installBrand } from './brand.js';

/** How long a card stays on screen, entrance and fade included. */
export const PRESENCE_MS = 5000;
/** 150ms of it, per DESIGN.md's motion rule. */
const ENTER_MS = 150;
/** Fade-out, matching the tail of the ordinary toast. */
const EXIT_MS = 600;
/**
 * Cards kept at once. A relay hiccup can drop a whole room in one frame, and
 * six stacked cards would push the killfeed off the top of the screen.
 */
const PRESENCE_MAX = 3;

const STYLE_ID = 'wm-presence-style';

const pct = (ms) => `${((ms / PRESENCE_MS) * 100).toFixed(2)}%`;

const CSS = `
.wm-presence-stack {
  position: fixed; top: 74px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  width: max-content; max-width: 92vw; pointer-events: none; z-index: 70;
}
.wm-presence-stack.hidden { display: none; }
.wm-presence {
  display: flex; align-items: center; gap: 11px; max-width: 92vw;
  padding: 10px 16px 10px 13px; border-radius: var(--wm-r);
  background: var(--wm-panel); border: 1px solid var(--wm-border);
  border-left: 3px solid var(--wm-ok); box-shadow: var(--wm-shadow-lift);
  backdrop-filter: blur(8px);
  animation: wm-presence ${PRESENCE_MS}ms cubic-bezier(.2,.85,.3,1) forwards;
}
.wm-presence.out { border-left-color: var(--wm-danger); }
/* 1.5px stroke, sharp geometry: the log-in / log-out pair, not an arrow made of
   chevrons. Danger and Success both clear the icon contrast floor. */
.wm-presence .ico { flex: none; width: 18px; height: 18px; display: block; color: var(--wm-ok); }
.wm-presence.out .ico { color: var(--wm-danger); }
/* The livery swatch. Same datum as the scoreboard's: it is the only place you
   can learn which colour in the level just turned up. Set from the palette by
   the caller, never from a literal here. */
.wm-presence .lv {
  flex: none; width: 10px; height: 10px; border-radius: 2px;
  box-shadow: 0 0 0 1px var(--wm-border);
}
.wm-presence .who { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wm-presence .nm {
  font-family: var(--wm-display); font-weight: 400; font-size: 21px; line-height: 1;
  letter-spacing: .07em; text-transform: uppercase; color: var(--wm-fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42ch;
}
.wm-presence .sub {
  font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  color: var(--wm-muted-fg); white-space: nowrap;
}
@keyframes wm-presence {
  0% { opacity: 0; transform: translateY(-8px); }
  ${pct(ENTER_MS)} { opacity: 1; transform: none; }
  ${pct(PRESENCE_MS - EXIT_MS)} { opacity: 1; }
  100% { opacity: 0; }
}
/* The card still has to appear and still has to leave; it just does not slide. */
@media (prefers-reduced-motion: reduce) {
  .wm-presence { animation-name: wm-presence-still; }
}
@keyframes wm-presence-still {
  0% { opacity: 0; }
  ${pct(ENTER_MS)} { opacity: 1; }
  ${pct(PRESENCE_MS - EXIT_MS)} { opacity: 1; }
  100% { opacity: 0; }
}
`;

/**
 * Feather-style log-in / log-out: a door frame and an arrow crossing it. The
 * frame flips sides between the two so the pair reads as in and out even for a
 * player who cannot tell Success from Danger.
 */
const ICON = {
  join:
    '<svg class="ico" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' +
    '<path d="M2 9h8"/><path d="M7 5.5 10.5 9 7 12.5"/><path d="M14 3v12"/></svg>',
  leave:
    '<svg class="ico" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' +
    '<path d="M8 9h8"/><path d="M12.5 5.5 16 9l-3.5 3.5"/><path d="M4 3v12"/></svg>',
};

/** Inject the card stylesheet once. Safe to call from every surface. */
export function installPresence() {
  if (typeof document === 'undefined') return;
  installBrand();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * Build one card.
 *
 * @param {'join'|'leave'} kind
 * @param {string} name    the player's callsign — set as text, never as markup
 * @param {object} [o]     { colour: CSS colour of their livery or null,
 *                           count: how many are in the room now }
 * @returns {HTMLElement}
 */
export function presenceCard(kind, name, { colour = null, count = 0 } = {}) {
  const out = kind === 'leave';
  const el = document.createElement('div');
  el.className = `wm-presence${out ? ' out' : ''}`;
  // Announced to a screen reader as well: this is news, not decoration, and it
  // is the one notification that never follows an action the player took.
  el.setAttribute('role', 'status');
  // Static string, no interpolation — the only innerHTML in this module.
  el.innerHTML = out ? ICON.leave : ICON.join;
  if (colour) {
    const lv = document.createElement('span');
    lv.className = 'lv';
    lv.style.background = colour;
    el.appendChild(lv);
  }
  const who = document.createElement('span');
  who.className = 'who';
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = name || 'Operator';
  const sub = document.createElement('span');
  sub.className = 'sub';
  const tail = count > 0 ? ` · ${count} in room` : '';
  sub.textContent = (out ? 'Left the room' : 'Joined the room') + tail;
  who.append(nm, sub);
  el.appendChild(who);
  return el;
}

/**
 * Build a card, put it in `host`, and clean it up on its own schedule. Older
 * cards past PRESENCE_MAX go immediately so the stack never grows unbounded.
 *
 * @returns {HTMLElement|null} the card, or null with no DOM
 */
export function pushPresence(host, kind, name, opts) {
  if (!host) return null;
  installPresence();
  const el = presenceCard(kind, name, opts);
  host.appendChild(el);
  const live = host.querySelectorAll('.wm-presence');
  for (let i = 0; i < live.length - PRESENCE_MAX; i++) live[i].remove();
  setTimeout(() => el.remove(), PRESENCE_MS + 120);
  return el;
}
