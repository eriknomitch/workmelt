---
name: "WORKMELT: Official Design & Brand Guidelines (v0.2)"
description: "Corporate Tactical — a browser FPS whose menus read like enterprise software running a firefight."
category: Brands
surface: web
colors:
  dark-slate: "#28303d"
  gunmetal: "#343a49"
  ice-white: "#f0f0f0"
  melt-green: "#42b66b"
  melt-green-deep: "#007f37"
  steel: "#888a92"
  hairline: "#3c434f"
  success: "#49c873"
  warning: "#f2b643"
  danger: "#d95c5c"
  info: "#4d8ef7"
  well: "#2f3644"
  hover: "#474d5a"
  ice-white-dim: "#b8babe"
  ice-white-warm: "#dbe9e0"
  steel-lift: "#b4b5ba"
  graphite: "#181c28"
  cloud: "#d0d2d7"
  concrete: "#656f72"
  storage-orange: "#c46d2e"
typography:
  display:
    fontFamily: "'Bebas Neue', Oswald, Teko, 'DIN Condensed', Haettenschweiler, Impact, sans-serif-condensed, sans-serif"
    fontSize: "clamp(56px, 8.4vw, 126px)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.055em"
  headline:
    fontFamily: "'Bebas Neue', Oswald, Teko, 'DIN Condensed', Haettenschweiler, Impact, sans-serif-condensed, sans-serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.1em"
  title:
    fontFamily: "'Bebas Neue', Oswald, Teko, 'DIN Condensed', Haettenschweiler, Impact, sans-serif-condensed, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.08em"
  body:
    fontFamily: "Inter, 'IBM Plex Sans', Manrope, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.01em"
  label:
    fontFamily: "Inter, 'IBM Plex Sans', Manrope, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.1em"
rounded:
  xs: "3px"
  sm: "4px"
  md: "8px"
  pill: "99px"
spacing:
  half: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ice-white}"
    textColor: "{colors.dark-slate}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "16px 28px 13px"
  button-primary-hover:
    backgroundColor: "{colors.ice-white-warm}"
    textColor: "{colors.dark-slate}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ice-white}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "12px 22px 10px"
  button-small:
    backgroundColor: "transparent"
    textColor: "{colors.ice-white-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  button-danger-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.dark-slate}"
    rounded: "{rounded.md}"
    padding: "11px 20px 8px"
  chip:
    backgroundColor: "{colors.well}"
    textColor: "{colors.steel-lift}"
    rounded: "{rounded.sm}"
    padding: "7px 13px"
  chip-selected:
    backgroundColor: "{colors.ice-white}"
    textColor: "{colors.dark-slate}"
    rounded: "{rounded.sm}"
    padding: "7px 13px"
  input-text:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.sm}"
    padding: "7px 9px"
    width: "148px"
  map-card:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ice-white-dim}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  map-card-selected:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  panel:
    backgroundColor: "{colors.gunmetal}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.md}"
    padding: "14px 18px"
  tab:
    backgroundColor: "{colors.well}"
    textColor: "{colors.steel-lift}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  tab-active:
    backgroundColor: "{colors.ice-white}"
    textColor: "{colors.dark-slate}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: WORKMELT

***WORKMELT** is a competitive multiplayer FPS that transforms the modern workplace into a fast-paced tactical arena.*

Workmelt: A web-based lowpoly FPS shooter that you can easily play with friends
at work. Similar to Call of Duty.

## Overview

**Creative North Star: "The Impressive Sleek and Lightweight Shooter"**

Everything here serves one impression: that something this fast and this
good-looking has no business running in a browser tab. *Sleek* is the surface —
flat planes, hairline rules, one condensed display face, generous dark negative
space, nothing textured or glossy anywhere. *Lightweight* is the substance — the
UI is a thin, precise layer over a live scene, never a heavy chrome shell in
front of it. *Impressive* is what the two produce together: a player who clicked
a link thirty seconds ago is already looking at something that reads as premium
software rather than a web toy.

The tone underneath is Corporate Tactical. WORKMELT's menus behave like
enterprise software that happens to be running a firefight — precise,
utilitarian, confident. The interface takes its cues from Linear and Notion, not
from traditional military shooters: high contrast, immediately readable, free of
grim overlays, camo, or grunge. The office premise is played completely
straight. The joke is the setting; the interface never winks.

Restraint is the mechanism, not an absence of ambition. The 65/20/10/4/1 ratio
means Melt Green appears roughly once per screen, so when it does appear it
reads as a decision rather than decoration. Panels are translucent Gunmetal so
the live scene stays visible behind them instead of being boxed out. Motion runs
120–180ms and gets out of the way. The system earns its impact by spending
almost nothing, almost everywhere.

**Key Characteristics:**

- Dark-first by definition: Dark Slate is the canvas and a white page is never
  the starting point.
- Exactly one accent, used roughly once per screen.
- Flat planes and hairline rules; zero gloss, gradient, glassmorphism, or
  skeuomorphic texture.
- A fixed two-face type pairing: Bebas Neue uppercase for display, Inter for
  every string at 14px and below.
- Translucent panels over a live scene, never opaque boxes in front of it.
- Motion is functional and brief; only panels are allowed a subtle overshoot.
- Every menu colour comes from one token file; no literal hex on a menu surface.

## Colors

A cool, desaturated slate-and-steel field with a single warm-leaning green that
is rationed hard, plus a small set of state colours that never become decoration.

### Primary

- **Melt Green** (`#42b66b`): The one accent. It appears on the wordmark drip,
  hover borders, focus outlines, and the active state of a key bind — and
  essentially nowhere else. Measured 5.15:1 on Dark Slate, so it clears UI text,
  but it is capped at roughly 4% of any composition. It is never a background
  wash and never fills a primary button.
- **Melt Green Deep** (`#007f37`): The light-inversion substitute. Same hue and
  chroma, lightness lowered to the lightest value clearing 4.50:1. Used for green
  text and links on light surfaces, where Melt Green itself measures 2.27:1.

### Secondary

- **Success** (`#49c873`): Ready and online states, confirmation, links. Measured
  6.20:1 on Dark Slate. This is the green that is allowed to be text.
- **Warning** (`#f2b643`): Warm-up state, `RESTART`-gated settings, in-match
  keycap highlights.
- **Danger** (`#d95c5c`): Destructive actions and disconnected state. Measured
  3.57:1, so large text and icons only — it may fill a button, but it never sets
  small body copy.
- **Information** (`#4d8ef7`): Informational emphasis. Measured 4.13:1, large
  text and icons only.

### Neutral

- **Dark Slate** (`#28303d`): The canvas. Roughly 65% of any composition, and the
  background of every UI and dark environment.
- **Gunmetal** (`#343a49`): Panel and elevated-surface background, composited at
  88% opacity over the canvas. Roughly 20% of a composition.
- **Well** (`#2f3644`): Gunmetal 60% over Dark Slate. Inset wells, chips, tabs,
  input fields, slider tracks — anything that should read as recessed.
- **Hover** (`#474d5a`): Gunmetal 70% with Ice White 8%. Row hover and the
  selected map card only.
- **Ice White** (`#f0f0f0`): Primary text, high-contrast rules, the wordmark, and
  the fill of the primary button. Measured 11.66:1 on Dark Slate.
- **Ice White Dim** (`#b8babe`): Ice White 72% over Dark Slate. Body copy at
  7.1:1 — the default for anything longer than a label.
- **Ice White Warm** (`#dbe9e0`): Ice White 88% with Melt Green. Exists for
  exactly one purpose: the hover state of a primary button, warming the fill
  toward the accent without ever putting text on green.
- **Steel** (`#888a92`): Structural elements, metadata, and weapon bodies.
  Measured 3.86:1, so 16px and above only.
- **Steel Lift** (`#b4b5ba`): Steel 58% with Ice White. Every string under 16px
  that wants to read as secondary uses this instead of Steel.
- **Hairline** (`#3c434f`): 1px rules, dividers, and resting borders. This is Ice
  White at 10% resolved over Dark Slate.

### Tertiary — world palette

These describe environment geometry, not UI tokens. Two of them (Graphite,
Cloud) are also bound as UI tokens, for the scrim behind panels and for paper.

- **Graphite** (`#181c28`): Deep shadows and the void behind panels. Every menu
  scrim and every soft shadow is this colour at partial alpha.
- **Cloud** (`#d0d2d7`): Paper, whiteboards, and lit surfaces. Clears body text
  at 8.78:1.
- **Concrete** (`#656f72`): Floors and exterior walls.
- **Storage Orange** (`#c46d2e`): The one-per-map logistics accent.

### Named Rules

**The 65/20/10/4/1 Rule.** Every composition, UI or environmental, is 65% Dark
Slate, 20% Gunmetal, 10% whites and light gray, 4% Melt Green, 1% environmental
accent. In practice that means exactly one Melt Green element per screen — the
wordmark drip — plus hover borders and ready dots. Melt Green is never a
background wash. The restraint is what makes interactions read as intentional.

**The Never-Text-On-Green Rule.** Ice White on Melt Green measures 2.27:1 and
fails AA outright. A primary CTA is therefore an Ice White fill with Dark Slate
text (14.91:1), and its hover warms the fill toward green rather than becoming
green. Where a green fill is genuinely required, its text is Graphite (6.58:1).

**The 16px Floor Rule.** Steel (3.86:1), Information (4.13:1), and Danger
(3.57:1) are large-text and icon colours only. Any string under 16px that wants
to read as secondary uses Steel Lift or Ice White Dim instead.

**The One Token File Rule.** Every colour, font, radius, and duration on a menu
surface comes from the custom properties in `src/ui/brand.js`. A literal hex in
`src/match/ui.js`, `src/ui/menu.js`, `src/ui/style.js`, or `src/net/ui.js` is a
defect. The in-world HUD is the one deliberate exemption.

## Typography

**Display Font:** Bebas Neue (with Oswald, Teko, DIN Condensed, Haettenschweiler,
Impact, sans-serif-condensed)
**Body Font:** Inter (with IBM Plex Sans, Manrope, system-ui, -apple-system,
Segoe UI, Helvetica Neue, Arial)

**Character:** Tall condensed industrial uppercase against a neutral grotesk.
Bebas gives the display register height and compression with slightly rounded
corners; Inter gives every functional string the boring legibility it needs at
10–14px. The contrast between the two registers is the entire hierarchy — there
is no third face and no weight ladder inside the display face.

### Hierarchy

- **Display** (400, `clamp(56px, 8.4vw, 126px)`, 1.0, `.055em`, uppercase): The
  lobby wordmark and large environmental decals. One per screen.
- **Headline** (400, 34px, 1.0, `.1em`, uppercase): The pause-menu title — the
  top of a modal surface.
- **Title** (400, 19–26px, 1.0, `.08em`, uppercase): Section heads, panel
  headers, button labels, and room codes (`.14em` — codes get extra tracking
  because they are read character by character).
- **Body** (400, 13–16px, 1.55, `.01em`): Lede copy, row names, descriptions.
  Constrained to 56ch in the lobby lede.
- **Label** (600, 10–11px, `.1em`, uppercase): Eyebrows, field labels, status
  strings, table headers, tags. Weight and tracking carry the emphasis, not size.

### Named Rules

**The Two-Register Rule.** Bebas is uppercase display only; Inter is every string
at 14px and below. Body copy is never set in the display face, and the display
face is never asked for lowercase — it has none to fall back on.

**The Progressive Wordmark Rule.** The webfont is a progressive enhancement,
never a dependency. Bebas is requested with `media="print"` so it can never
render-block, and it is not requested at all on a deterministic capture run,
because a pending webfont leaves `document.fonts.ready` unresolved and would hang
every screenshot in `tools/`. The wordmark's detached drip is gated behind a real
render test (`.wm-display-ready`) — measured, not `document.fonts.check()`, which
returns true for families the machine has never seen. Without Bebas the mark
falls back to a plain hanging bar, because a detached droplet on a wide fallback
face reads as an exclamation mark.

**The Tabular Figure Rule.** Any number that changes in place — ammo, scores,
countdowns, slider values — is set with `font-variant-numeric: tabular-nums` so
it does not jitter as it counts.

## Layout

An 8px baseline grid with a 4px half-step. Radius is 8px, borders are 1px.

**Lobby.** A fixed full-viewport overlay above the live scene, laid out as a top
bar (60px min-height, 24px horizontal padding), a two-column body
(`minmax(0,1fr)` hero plus a fixed-width roster panel, 28px/24px padding, capped
at 1500px), and a bottom status strip. The hero stacks eyebrow → wordmark → lede
→ map cards → option chips → CTA row, and the CTA row is `minmax(0,1fr) 260px`
so the primary action always dominates its companion.

**Pause menu.** A centred modal, `min(560px, 100%)` wide and `min(760px, 100%)`
tall, over a Graphite scrim at 82% with a 10px blur. Header, wrapping tab row,
scrolling body, footer. Settings rows are a 52px min-height flex with a 16px gap
so a long label and its control never collide.

**Responsive behaviour.** Four thresholds, each solving a real failure:

- **1080px** — the lobby collapses to a single column and the roster panel drops
  its height cap.
- **720px** — the top bar wraps, the wordmark drops to 24px, the callsign field
  narrows to 116px, and the CTA row becomes one column.
- **560px** (menu) — settings rows wrap so the control moves under its label.
- **max-height 680px** (lobby) / **620px** (menu) — a *height* query, not a width
  one. The wordmark shrinks to `clamp(44px, 6vw, 68px)`, map-card blurbs hide
  entirely, and button padding tightens.

**HUD.** A separate spatial system. Every dimension is `calc(N * var(--k))` where
`--k` derives from viewport height (1080p = 1.0), so the HUD holds its
proportions from 720p to 4K without re-authoring. Its grid unit is 4px scaled;
screen margins are 6.5 units.

### Named Rules

**The Height-Query Rule.** Menu surfaces sit over a live scene on laptops. Test
`max-height`, not just `max-width` — a 1440×700 window is the common failure, and
it is invisible to a width breakpoint.

## Elevation & Depth

The system is flat and tonal. Depth comes from three stacked values (Dark Slate
canvas → Gunmetal panel → Well inset) and from 1px Hairline rules, not from
lighting. There is no directional light anywhere in the UI: shadows exist only as
very soft, large-spread, zero-offset ambient pools of Graphite that seat a
floating surface against the scene behind it.

Panels are translucent by design — Gunmetal at 88% over the canvas — so the live
scene stays legible behind them instead of being flattened. Because `rgba()`
cannot take a hex custom property, the four colours that ever appear at partial
alpha are also published as channel triplets (`--wm-bg-rgb`, `--wm-surface-rgb`,
`--wm-void-rgb`, `--wm-fg-rgb`), and `rgb(var(--x) / a)` is how every translucent
WORKMELT surface is built.

### Shadow Vocabulary

- **Ambient** (`box-shadow: 0 0 48px rgb(24 28 40 / .7)`): Panels resting in the
  layout — the lobby roster, toasts, the invite bar.
- **Ambient lift** (`box-shadow: 0 0 64px rgb(24 28 40 / .82)`): Modal surfaces
  that float above everything — the pause menu, the scoreboard.
- **Scrim** (`rgb(24 28 40 / .82)` with `blur(10px) saturate(.85)`): Behind a
  modal. Desaturating the blur slightly is what keeps the scene from bleeding
  colour through the panel.

### Named Rules

**The No-Direction Rule.** Every UI shadow has zero offset. A directional drop
shadow is a web-overlay tell and it fights whatever direction the scene's key
light happens to come from. Depth is ambient or it is tonal; it is never lit.

**The HUD Outline Rule.** The in-world HUD does not use shadows for depth at all.
Text survives a blown-out sky *and* a black interior via a synthesized outline:
eight equal-radius hard shadows in a ring, paired with one tight soft seat.
Direction-free by construction, and it needs no scrim behind it.

## Shapes

Rectangular with softened corners. The radius scale is deliberately short: 8px
for panels, cards, and large buttons; 4px for chips, tabs, inputs, icon buttons,
and small buttons; 3px for keycaps and inline tags; 2px for status dots; and a
99px pill reserved for the scrollbar thumb. Nothing else is ever a pill, and
nothing is ever fully square.

Borders are always exactly 1px. The resting border is Hairline; the hover border
is Melt Green on nearly every interactive element, which is the single most
repeated gesture in the system. Selection is expressed by inverting to an Ice
White fill or an Ice White border, never by adding weight or a second ring.

Status dots are 8px squares with a 2px radius rather than circles — a small
choice that keeps the roster reading as enterprise software rather than a chat
app. Segmented controls join their children by collapsing inner borders and
rounding only the outer two corners.

### Named Rules

**The Green Border Rule.** Hover reaches for `border-color: var(--wm-accent)`
before it reaches for a background change. It is the cheapest possible
affordance, it costs no layout, and it is why Melt Green stays under its 4%
budget while still appearing everywhere the pointer goes.

## Components

### Buttons

- **Shape:** Softened corners (8px), 1px border, uppercase display type. Bottom
  padding is always ~3px less than top padding, because Bebas sits high in its
  line box and equal padding reads as bottom-heavy.
- **Primary:** Ice White fill, Dark Slate text (14.91:1), 26px display,
  `16px 28px 13px`. Hover warms the fill to Ice White Warm. Active presses down
  `translateY(2px)` over 90ms linear.
- **Ghost:** Transparent with a 1px Ice White border, 19px display,
  `12px 22px 10px`. Hover shifts the border to Melt Green. A completed action
  (`.done`) turns border and text to Success.
- **Small:** Inter 600 at 12px, Hairline border, 4px radius, `5px 10px`. Hover
  adds a Well background alongside the green border. This is the register for
  secondary in-bar actions like *Copy invite link*.
- **Danger:** Rests as a muted Hairline-bordered Steel Lift button and only
  becomes a Danger fill with Dark Slate text on hover — destructive intent is
  revealed on approach, not advertised at rest.
- **Keycap:** Buttons may carry an inline `1px currentColor` chip at 3px radius,
  10px Inter 600, 55% opacity, showing the keyboard shortcut.
- **Disabled:** 42–45% opacity and `cursor: not-allowed`. No colour change.

### Chips

- **Style:** Well background, Hairline border, 4px radius, Inter 500 at 12px,
  `7px 13px`. Used for bot-garrison counts and other small exclusive choices.
- **State:** Hover lifts text to Ice White and the border to Melt Green. Selected
  inverts completely — Ice White background, Dark Slate text, Ice White border,
  weight 600.

### Cards / Containers

- **Map card:** 8px radius, Well background, Hairline border, `12px 14px`, left
  aligned. Name in 20px display; mode in an 11px uppercase label; blurb and size
  in Steel Lift. Hover borders green; `aria-pressed="true"` borders Ice White,
  fills Hover, and lifts the name to full Ice White. Disabled drops to 45%. The
  blurb hides entirely below 680px viewport height.
- **Panel:** Gunmetal at 88% over the canvas, 1px Hairline, 8px radius, ambient
  shadow. Structured as header (`14px 18px`, bottom rule) / scrolling body
  (`8px 0`, 96px min-height) / footer (`12px 18px`, top rule).
- **Row:** `10px 18px` with a 12px gap, separated by 1px Hairline rules rather
  than gaps. Hover fills with Hover. A newly joined row plays a one-shot
  animation that fades from the Hover fill with an inset 3px Success bar on the
  leading edge — arrival is announced once, and then the row is ordinary.

### Inputs / Fields

- **Style:** Well background, 1px Hairline, 4px radius, `7px 9px`, Inter 600 at
  13px. The label above is an 11px uppercase Steel Lift eyebrow.
- **Hover:** Border lifts to Steel Lift.
- **Focus:** `outline: none`, replaced by a Melt Green border. The outline is
  suppressed only because the border itself becomes the focus indicator — never
  suppress one without providing the other.
- **Slider:** A 4px track at Ice White 14%, an Ice White fill, and a 12px knob at
  3px radius that turns Melt Green on hover of the whole row.
- **Segmented control:** Well-backed uppercase 10px Inter 600 buttons with
  collapsed inner borders; the active segment inverts to an Ice White fill with
  Dark Slate text.
- **Key bind:** The same shell as a select. While listening it inverts to a Melt
  Green fill with Dark Slate text — the one place a green fill is correct,
  because the text on it is Dark Slate.

### Navigation

- **Pause-menu tabs:** A wrapping row of Well-backed chips, 10px uppercase Inter
  600, `6px 10px`, 4px radius. Hover fills with Hover; the active tab inverts to
  Ice White. A settings row that differs from its preset carries an inset 2px
  Melt Green bar on its leading edge and lifts its name to full Ice White; a
  boot-time-only setting adds a Warning-coloured `RESTART` tag.
- **Focus:** Every menu surface declares
  `:focus-visible { outline: 2px solid var(--wm-accent); outline-offset: 2px }`.
  This is non-negotiable and is why keyboard traversal is legible on all four
  surfaces.

### The Wordmark

`WORKMEL` plus a wrapped `T` carrying a Melt Green drip off the stem: a `.2em`
tapered bar hanging from the glyph, plus — once Bebas has verifiably rendered — a
detached `.055em` droplet below it and a repositioned bar at `left: 46%`,
metric-tuned to Bebas's baseline sitting ~.31em above the line box bottom. This
is the single Melt Green element on most screens and the entire 4% accent budget
of the composition. It scales from 24px in a narrow top bar to 126px as the lobby
hero.

## Do's and Don'ts

### Do:

- **Do** take every colour, font, radius, and duration on a menu surface from the
  custom properties in `src/ui/brand.js`.
- **Do** keep Melt Green to roughly one element per screen, plus hover borders
  and ready dots.
- **Do** fill a primary CTA with Ice White and set its text in Dark Slate
  (14.91:1); warm the fill to `#dbe9e0` on hover rather than turning it green.
- **Do** use Ice White Dim (`#b8babe`) for body copy and Steel Lift (`#b4b5ba`)
  for secondary strings under 16px.
- **Do** build every translucent surface as `rgb(var(--wm-*-rgb) / a)`.
- **Do** give panels a soft, large-spread, zero-offset ambient shadow.
- **Do** keep UI transitions in the 120–180ms band with swift-out easing, and
  honour `prefers-reduced-motion` by collapsing both duration tokens to 1ms.
- **Do** test menu surfaces against a short viewport (`max-height: 680px`), not
  only a narrow one.
- **Do** set changing numbers with tabular figures.
- **Do** hard-code the resolved sRGB hex of any derived colour and keep the
  `color-mix()` expression it came from in the comment — `color-mix()` and
  relative `oklch()` are recent-Chromium-only, and this UI has to render
  identically in the capture harness, in Firefox, and on whatever the person at
  work has open.

### Don't:

- **Don't** introduce a literal hex into `src/match/ui.js`, `src/ui/menu.js`, the
  menu block of `src/ui/style.js`, or `src/net/ui.js`.
- **Don't** put Ice White text on a Melt Green fill (2.27:1 — fails AA), or use
  Melt Green as text or a link on a light surface (2.27:1 — use Melt Green Deep
  `#007f37`).
- **Don't** set Steel, Information, or Danger below 16px.
- **Don't** use Melt Green as a background wash.
- **Don't** default any WORKMELT surface to a white page. The light theme is a
  derived inversion, not the source of truth.
- **Don't** add a glossy gradient, glassmorphism, or a skeuomorphic texture
  anywhere.
- **Don't** give a UI shadow a directional offset.
- **Don't** make anything fully pill-shaped or completely sharp; 8px and 4px are
  the working radii.
- **Don't** set body copy in Bebas Neue, or ask the display face for lowercase.
- **Don't** let a webfont block a render or a capture, and don't gate the drip's
  precise geometry on `document.fonts.check()` — it returns true for families the
  machine has never seen.
- **Don't** use skulls, crosshairs, blood spatter, or bullet vectors as icons.
  Icons read as enterprise-software logic — folders, boxes, network nodes,
  clipboards, terminal prompts — at a uniform 1.5px stroke.
- **Don't** put a backtick inside a CSS comment in these stylesheets. They are
  template literals, and it is a syntax error.

---

# Extended brand guidance

*The two sections below are WORKMELT brand guidance that falls outside the
DESIGN.md spec's eight visual sections. They are preserved here so there remains
one file to read.*

## Voice & Tone

- **Adjectives:** clean, tactical, fast, approachable, low-poly, premium
- **Tone:** Corporate Tactical, never parody. WORKMELT writes like enterprise software that happens to be running a firefight — precise, utilitarian and confident. Headers are short and uppercase; detail copy is sentence case and plain. The office premise is played completely straight: the joke is the setting, never the writing. No Excel memes, no slapstick, and equally no grimdark military posturing.

### Messaging pillars

- A competitive multiplayer FPS that transforms the modern workplace into a fast-paced tactical arena.
- Call of Duty × Corporate Startup × IKEA × Linear × Notion — Corporate Tactical, not parody.
- Browser-first and instantly playable: highly optimized geometry, baked lighting, no install, high FPS.
- Serious gameplay underneath the premise — high TTK precision, strategic map design, realistic ballistics.
- Easy to play with the people you already work with.

### Vocabulary

- **Use:** Corporate Tactical, tactical arena, browser-first, low poly, high TTK, quick match, private lobby, co-worker list, squad, loadout, objective, map
- **Avoid:** Excel memes, office humor, slapstick, grimdark, gritty, blood, gore, skulls, camo, neon skins, pay-to-win, hardcore milsim

## Imagery

- **Style:** Low-poly, flat-shaded 3D with baked ambient occlusion. The visual language is borrowed from modern office architecture, brutalist concrete, industrial logistics facilities, enterprise software UI and high-end product packaging — read as a tactical arena rather than a battlefield.
- **Subjects:** modular office interiors — boardrooms, server farms, stockrooms, parking garages, rooftops, plastic crates, cardboard boxes, office dividers, rolling mesh chairs, filing cabinets, rack-mounted servers, office employees in muted business attire integrated with plate carriers, holsters and tactical rigs, injection-molded polymer weapons with matte finishes, isometric map cards and enterprise-style UI panels
- **Treatment:** Flat colors with baked ambient occlusion — avoid heavy normal mapping and hyper-realistic grunge. Characters run 2,000-5,000 triangles with simplified, distance-readable silhouettes and minimal facial detail, usually obscured by visors. Weapons are 70% charcoal, 20% light gray, 10% accent, detailed only with functional marks: green magazine releases, orange safety tape, white inventory/QR markings. Each map carries exactly one dominant environmental accent colour — warm teak in the Boardroom, green LEDs and deep blues in the Server Farm, Storage Orange shelving in the Stockroom, sky blue on the Rooftop, yellow safety paint in the Parking Garage, corporate teal partitions in the Office Maze.
- **Avoid:** photorealism or hyper-realistic grunge, heavy normal mapping, chrome, gold, excessive rust or military camouflage, elaborate dragon or neon weapon skins, skulls, crosshairs, blood spatter, bullet vectors, glossy gradients, glassmorphism, skeuomorphic texture, exaggerated particle blooms and overkill screen shake, grim or gritty overlays that hurt readability

## Implementation notes

**Where the system lives.** `src/ui/brand.js` is the single source of truth and
publishes every token as a CSS custom property on `:root`. Four surfaces consume
it and define no colour of their own:

| Surface | File |
|---|---|
| Lobby / Match Start | `src/match/ui.js` |
| Pause & settings menu | `src/ui/menu.js`, menu block of `src/ui/style.js` |
| Multiplayer invite bar, toasts, scoreboard | `src/net/ui.js` |

**The HUD exemption.** The in-world HUD (crosshair, ammo, minimap, killfeed,
hitmarkers) deliberately does not use these tokens. It is drawn over a live scene
and runs its own system: viewport-scaled `calc(N * var(--k))` dimensions, three
ink levels (94% / 58% / 30%), one accent per semantic (amber = caution, red =
threat, cyan = friendly/objective), and synthesized eight-way outlines instead of
shadows. It is condensed, uppercase, and tabular throughout. This is a
deliberate, load-bearing divergence, not drift.

**Consuming the exported tokens.** If loading the design export rather than
`brand.js`: load `system/variables.css` then `system/brand-canvas.css`. The
generated ramp derives from antd's stock greys and drops
`colorBgBase`/`colorTextBase`, so `variables.css` alone ships `#141414`/`#ffffff`
neutrals rather than Dark Slate and Gunmetal. `brand-canvas.css` re-binds the
neutral ramp to the registered palette; `:root` is the dark canvas and
`.brand-light` is the opt-in inversion.

**Open exploration — the lobby theme labs.** `src/match/ui.js` currently ships
six alternate lobby treatments (`variant-signal`, `variant-terminal`,
`variant-field`, `variant-spreadsheet`, `variant-linear`, `variant-ledger`), each
with its own `--lab-*` / `--sheet-*` token set, switchable at runtime and
persisted to `localStorage` under `workmelt-lobby-style`. The lobby boots into
`variant-signal`, which overrides this system on that surface: a `#ff6b35`
accent, Inter 800 at `-.075em` for the wordmark, `border-radius: 0`, and a hard
`16px 16px 0` offset shadow.

**These labs are an exploration, not the design system.** This document remains
canon. Nothing outside the lobby's `variant-*` blocks may adopt a lab token, and
if a direction is eventually chosen it gets promoted into `brand.js` and this
file gets rewritten. The labs are not a second, parallel system to design against
in the meantime.
