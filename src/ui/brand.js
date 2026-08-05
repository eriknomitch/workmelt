/**
 * ===========================================================================
 * WORKMELT brand tokens — the one source of truth for every menu surface
 * ===========================================================================
 *
 * Implements `DESIGN.md` (v0.3 — Console Black). Three surfaces consume this
 * stylesheet and nothing else defines a colour of its own:
 *
 *   src/match/ui.js   the lobby / Match Start screen
 *   src/ui/menu.js    the Escape → settings menu (styled in src/ui/style.js)
 *   src/net/ui.js     the in-match invite bar, toasts and scoreboard
 *
 * The in-world HUD (crosshair, ammo, minimap, killfeed) deliberately does NOT
 * use these tokens: it is drawn over a live scene and needs its own outlined,
 * high-contrast treatment. See the header of src/ui/style.js.
 *
 * ---------------------------------------------------------------------------
 * THE v0.3 DIRECTION — CONSOLE BLACK
 * ---------------------------------------------------------------------------
 * True black canvas, hairline-bordered panels a few points above it, Ice White
 * type, and a single Signal Blue accent for selection, live status and the
 * primary action's border. Type is Geist (Vercel's face) everywhere, with
 * Geist Mono carrying the small tracked-out uppercase labels. Corners are
 * near-square, shadows are gone — depth is a 1px hairline or it is nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DERIVED COLOURS ARE HARD-CODED
 * ---------------------------------------------------------------------------
 * The design source writes them as `color-mix(in srgb, …)`. That is
 * recent-Chromium-only, and this stylesheet has to render identically in the
 * capture harness, in Firefox and in whatever the person at work has open.
 * Every derived value below is therefore the resolved sRGB hex, with the
 * expression it came from kept in the comment so the derivation stays checkable.
 */

/** Registered palette. Hex values are copied from DESIGN.md's front matter. */
export const BRAND = {
  bg: '#000000', // Void — the canvas is true black
  surface: '#0a0c11', // Console — panels, a few points above the void
  fg: '#ededed', // Ice White — 18.1:1 on the void
  accent: '#5f7cf9', // Signal Blue — selection, live status, the primary border
  muted: '#62666e', // Steel — large text and icons only
  border: '#23262e', // Hairline — Ice White @14% resolved over the void
  ok: '#49c873', // Success
  warn: '#f2b643', // Warning
  danger: '#d95c5c', // Danger — large text and icons only
  info: '#5f7cf9', // Information — same signal as the accent
  // World palette (environment geometry, used here only for the void and paper)
  graphite: '#05060a',
  cloud: '#d0d2d7',
  concrete: '#656f72',
  storageOrange: '#c46d2e',
};

export const FONT_DISPLAY_BRAND =
  "'Geist','Inter',system-ui,-apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif";
export const FONT_BODY_BRAND =
  "'Geist','Inter',system-ui,-apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif";
export const FONT_MONO_BRAND =
  "'Geist Mono',ui-monospace,'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

const STYLE_ID = 'wm-brand-tokens';
const FONT_ID = 'wm-brand-font';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap';

const CSS = `
:root {
  --wm-bg: ${BRAND.bg};
  --wm-surface: ${BRAND.surface};
  --wm-fg: ${BRAND.fg};
  --wm-accent: ${BRAND.accent};
  --wm-muted: ${BRAND.muted};
  --wm-border: ${BRAND.border};
  --wm-ok: ${BRAND.ok};
  --wm-warn: ${BRAND.warn};
  --wm-danger: ${BRAND.danger};
  --wm-info: ${BRAND.info};

  /* Graphite: deep shadow and the void behind panels. */
  --wm-void: ${BRAND.graphite};
  --wm-cloud: ${BRAND.cloud};

  /* Channel forms of the colours that ever appear at partial alpha. A surface
     scrim over the live scene needs the palette AND an opacity, and rgba()
     cannot take a hex custom property — so the channels are the token and
     rgb(var(--x) / a) is how every translucent WORKMELT surface is built. */
  --wm-bg-rgb: 0 0 0;
  --wm-surface-rgb: 10 12 17;
  --wm-void-rgb: 5 6 10;
  --wm-fg-rgb: 237 237 237;
  --wm-accent-rgb: 95 124 249;

  /* Panels sit on the void at near-full opacity — Console Black is a console,
     not a window; the live scene shows only where a surface chooses to open. */
  --wm-panel: rgb(var(--wm-surface-rgb) / .92);
  /* color-mix(in srgb, Console 55%, Ice White 4%) — inset wells, chips, tracks */
  --wm-panel-2: #12141a;
  /* color-mix(in srgb, Console 80%, Ice White 8%) — row hover */
  --wm-hover: #191c23;
  /* color-mix(in srgb, Ice White 74%, Void) — body copy, 10.0:1 */
  --wm-fg-dim: #b0b0b0;
  /* color-mix(in srgb, Ice White 88%, Signal Blue) — the hover state of a
     filled primary button, warming the fill toward the accent without ever
     putting light text on a blue fill. */
  --wm-fg-warm: #dce1fb;
  /* color-mix(in srgb, Steel 55%, Ice White) — every string under 16px that
     wants to read as secondary uses this lift instead of Steel. 7.0:1. */
  --wm-muted-fg: #9ca0a8;

  /* Console Black is near-square: hairline rectangles, softened one step. */
  --wm-r: 2px;
  --wm-r-sm: 2px;
  --wm-display: ${FONT_DISPLAY_BRAND};
  --wm-body: ${FONT_BODY_BRAND};
  --wm-mono: ${FONT_MONO_BRAND};
  /* 120-180ms, swift out / linear in. Panels may overshoot subtly; nothing else. */
  --wm-t: 150ms cubic-bezier(.2,.85,.3,1);
  --wm-t-slow: 180ms cubic-bezier(.2,.85,.3,1);
  /* Depth is a hairline, not a shadow — kept only as a faint seat for the one
     or two surfaces that float over a live scene. Zero offset, always. */
  --wm-shadow: 0 0 48px rgb(var(--wm-void-rgb) / .6);
  --wm-shadow-lift: 0 0 64px rgb(var(--wm-void-rgb) / .75);
}

/* ---------------------------------------------------------------- wordmark */
/* WORKMEL<T> with the Signal Blue drip hanging off the T stem. Geist renders
   the mark tracked out and medium-weight; the drip is a plain hanging bar
   centred on the T's stem, which reads correctly in Geist and in every
   fallback grotesk — nothing here is metric-tuned to one face. */
.wm-mark {
  font-family: var(--wm-display);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .18em;
  line-height: 1;
  color: var(--wm-fg);
  display: inline-block;
  position: relative;
  white-space: nowrap;
  max-width: 100%;
}
.wm-mark .t { position: relative; }
.wm-mark .t::after {
  content: ""; position: absolute; left: 38%; transform: translateX(-50%);
  bottom: -.14em; width: .09em; height: .22em;
  background: var(--wm-accent); border-radius: 0 0 .04em .04em;
}

/* ------------------------------------------------------------ scroll gutter */
.wm-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.wm-scroll::-webkit-scrollbar-thumb { background: var(--wm-border); border-radius: 99px; }
.wm-scroll::-webkit-scrollbar-track { background: transparent; }

/* --------------------------------------------------------------- reduced motion */
@media (prefers-reduced-motion: reduce) {
  :root { --wm-t: 1ms linear; --wm-t-slow: 1ms linear; }
}
`;

/**
 * Inject the token sheet once. Safe to call from every surface's constructor —
 * whoever gets there first wins and the rest are no-ops.
 */
export function installBrand({ webfont = true } = {}) {
  if (typeof document === 'undefined') return;
  if (webfont) installBrandFont();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  // Prepended so a surface stylesheet loaded later always wins on ties.
  document.head.prepend(s);
}

/**
 * Request Geist + Geist Mono (Vercel's typeface pair, served from Google
 * Fonts), without ever blocking anything.
 *
 * `media="print"` keeps the stylesheet out of the render-blocking set; the
 * onload handler promotes it to `all` the moment it arrives. The whole UI is
 * legible in the fallback stacks before, during and after.
 *
 * NOT called on a deterministic run. A pending webfont leaves
 * `document.fonts.ready` unresolved, and Playwright's `page.screenshot()` waits
 * on exactly that promise — so on any machine that cannot reach
 * fonts.googleapis.com quickly, loading it would hang every capture in
 * `tools/`. A font that may or may not arrive has no business in a pixel gate
 * anyway.
 */
export function installBrandFont() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FONT_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_ID;
  link.rel = 'stylesheet';
  link.media = 'print';
  link.href = FONT_HREF;
  link.addEventListener('load', () => {
    link.media = 'all';
  });
  document.head.appendChild(link);
}

/**
 * The wordmark as markup: `WORKMEL` + a wrapped `T` that carries the drip.
 * Static string, no interpolation — safe to assign through innerHTML.
 */
export const WORDMARK_HTML = 'WORKMEL<span class="t">T</span>';
