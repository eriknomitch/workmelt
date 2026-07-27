/**
 * ===========================================================================
 * WORKMELT brand tokens — the one source of truth for every menu surface
 * ===========================================================================
 *
 * Implements `DESIGN.md` (v0.1). Three surfaces consume this stylesheet and
 * nothing else defines a colour of its own:
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
 * WHY THE DERIVED COLOURS ARE HARD-CODED
 * ---------------------------------------------------------------------------
 * The design export writes them as `color-mix(in srgb, …)` / `oklch(from …)`.
 * Both are recent-Chromium-only, and this stylesheet has to render identically
 * in the capture harness, in Firefox and in whatever the person at work has
 * open. Every derived value below is therefore the resolved sRGB hex, with the
 * expression it came from kept in the comment so the derivation stays checkable.
 *
 * ---------------------------------------------------------------------------
 * THE RATIO RULE (DESIGN.md → Layout → Posture rules)
 * ---------------------------------------------------------------------------
 * 65% Dark Slate · 20% Gunmetal · 10% whites · 4% Melt Green · 1% accent.
 * Melt Green is never a background wash. In practice that means: exactly one
 * Melt Green element per screen (the wordmark drip), plus hover borders and
 * ready/online dots. Primary buttons are an Ice White fill with Graphite text —
 * green text on green fill measures 2.27:1 and fails AA.
 */

/** Registered palette. Hex values are copied from DESIGN.md's front matter. */
export const BRAND = {
  bg: '#28303d', // Dark Slate — the canvas
  surface: '#343a49', // Gunmetal — panels
  fg: '#f0f0f0', // Ice White — 11.66:1 on Dark Slate
  accent: '#42b66b', // Melt Green — capped at ~4% of a composition
  muted: '#888a92', // Steel — 3.86:1, so 16px+ and icons only
  border: '#3c434f', // Hairline — Ice White @10% resolved over Dark Slate
  ok: '#49c873', // Success — 6.20:1
  warn: '#f2b643', // Warning
  danger: '#d95c5c', // Danger — 3.57:1, large text and icons only
  info: '#4d8ef7', // Information
  // World palette (environment geometry, used here only for the void and paper)
  graphite: '#181c28',
  cloud: '#d0d2d7',
  concrete: '#656f72',
  storageOrange: '#c46d2e',
};

export const FONT_DISPLAY_BRAND =
  "'Bebas Neue',Oswald,Teko,'DIN Condensed',Haettenschweiler,Impact,sans-serif-condensed,sans-serif";
export const FONT_BODY_BRAND =
  "'Inter','IBM Plex Sans',Manrope,system-ui,-apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif";

const STYLE_ID = 'wm-brand-tokens';
const FONT_ID = 'wm-brand-font';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap';

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

  /* Channel forms of the four colours that ever appear at partial alpha. A
     surface scrim over the live scene needs the palette AND an opacity, and
     rgba() cannot take a hex custom property — so the channels are the token
     and rgb(var(--x) / a) is how every translucent WORKMELT surface is built. */
  --wm-bg-rgb: 40 48 61;
  --wm-surface-rgb: 52 58 73;
  --wm-void-rgb: 24 28 40;
  --wm-fg-rgb: 240 240 240;

  /* Panels are Gunmetal at 85-90% opacity OVER the canvas, so they stay
     translucent against the live scene instead of flattening it. */
  --wm-panel: rgb(var(--wm-surface-rgb) / .88);
  /* color-mix(in srgb, Gunmetal 60%, Dark Slate) — inset wells, chips, tracks */
  --wm-panel-2: #2f3644;
  /* color-mix(in srgb, Gunmetal 70%, Ice White 8%) — row hover */
  --wm-hover: #474d5a;
  /* color-mix(in srgb, Ice White 72%, Dark Slate) — body copy, 7.1:1 */
  --wm-fg-dim: #b8babe;
  /* color-mix(in srgb, Ice White 88%, Melt Green) — the hover state of a
     primary button. Warming the fill toward the accent is the only way to give
     the CTA a green hover: filling it WITH Melt Green would leave Ice White
     text at 2.27:1, which fails AA outright (DESIGN.md, Layout → Buttons). */
  --wm-fg-warm: #dbe9e0;
  /* color-mix(in srgb, Steel 58%, Ice White) — Steel measures 3.86:1 and is
     large-text-only, so every string under 16px uses this lift instead. */
  --wm-muted-fg: #b4b5ba;

  --wm-r: 8px;
  --wm-r-sm: 4px;
  --wm-display: ${FONT_DISPLAY_BRAND};
  --wm-body: ${FONT_BODY_BRAND};
  /* 120-180ms, swift out / linear in. Panels may overshoot subtly; nothing else. */
  --wm-t: 150ms cubic-bezier(.2,.85,.3,1);
  --wm-t-slow: 180ms cubic-bezier(.2,.85,.3,1);
  /* Very soft, large spread, no directional lighting. */
  --wm-shadow: 0 0 48px rgb(var(--wm-void-rgb) / .7);
  --wm-shadow-lift: 0 0 64px rgb(var(--wm-void-rgb) / .82);
}

/* ---------------------------------------------------------------- wordmark */
/* WORKMEL<T> with the Melt Green drip hanging off the T stem.
   The precise offsets are tuned to Bebas Neue's baseline sitting ~.31em above
   the line box bottom — they only make sense if Bebas actually rendered. Until
   .wm-display-ready says so (see _watchDisplayFont below) the mark falls
   back to a plain hanging bar centred on the glyph box, which reads correctly
   in Oswald / Impact / whatever the machine happens to have. The detached
   droplet is Bebas-only: in a wide fallback face it reads as an exclamation
   mark rather than a drip. */
.wm-mark {
  font-family: var(--wm-display);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: .06em;
  line-height: 1;
  color: var(--wm-fg);
  display: inline-block;
  position: relative;
  white-space: nowrap;
  max-width: 100%;
}
.wm-mark .t { position: relative; }
.wm-mark .t::after {
  content: ""; position: absolute; left: 50%; transform: translateX(-50%);
  bottom: -.02em; width: .075em; height: .2em;
  background: var(--wm-accent); border-radius: 0 0 .04em .04em;
}
.wm-display-ready .wm-mark .t::after {
  left: 46%; bottom: .06em; width: .085em; height: .28em;
}
.wm-display-ready .wm-mark .t::before {
  content: ""; position: absolute; left: 46%; transform: translateX(-50%);
  bottom: -.02em; width: .055em; height: .055em; background: var(--wm-accent);
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
  _watchDisplayFont();
}

/**
 * Request Bebas Neue + Inter, without ever blocking anything.
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
 * Flag the document once Bebas Neue has actually rendered.
 *
 * The webfont is a progressive enhancement — a blocked request, an offline
 * machine or a corporate proxy all land on the fallback stack, and the logo
 * drip's offsets are metric-tuned to Bebas specifically. Rather than ship a
 * drip that floats off a substitute glyph, the precise version is gated on this
 * class and the fallback keeps a simpler bar. No Font Loading API (or a failed
 * load) simply means the fallback stays.
 */
function _watchDisplayFont() {
  const settle = () => {
    if (_faceRenders('Bebas Neue')) document.documentElement.classList.add('wm-display-ready');
  };
  try {
    if (_faceRenders('Bebas Neue')) return settle();
    if (!document.fonts?.load) return;
    // `load()` both kicks the request off and tells us when it has resolved one
    // way or the other; `ready` covers the case where the sheet was still
    // parsing when we got here. Both end at the same width probe.
    document.fonts.load('400 16px "Bebas Neue"').then(settle, settle);
    document.fonts.ready?.then?.(settle, () => {});
  } catch {
    /* Font Loading API missing or throwing: the fallback drip stays */
  }
}

/**
 * Is `family` actually rendering, or is the browser silently substituting?
 *
 * `document.fonts.check()` is not the answer: it returns TRUE for a family the
 * document has never heard of, on the grounds that it might be installed
 * locally — so it says yes for "Bebas Neue" on a machine that has never seen
 * it. Measuring a string against two different generic fallbacks is the test
 * that actually distinguishes the two: if the family exists, at least one of
 * the measurements moves.
 */
function _faceRenders(family) {
  try {
    const cx = document.createElement('canvas').getContext('2d');
    if (!cx) return false;
    const text = 'WORKMELT 0123456789';
    for (const generic of ['monospace', 'serif']) {
      cx.font = `72px ${generic}`;
      const base = cx.measureText(text).width;
      cx.font = `72px "${family}", ${generic}`;
      if (Math.abs(cx.measureText(text).width - base) > 1) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * The wordmark as markup: `WORKMEL` + a wrapped `T` that carries the drip.
 * Static string, no interpolation — safe to assign through innerHTML.
 */
export const WORDMARK_HTML = 'WORKMEL<span class="t">T</span>';
