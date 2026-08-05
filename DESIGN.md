---
name: "WORKMELT: Official Design & Brand Guidelines (v0.3)"
description: "Console Black — a browser FPS whose menus read like a terminal-grade operations console."
category: Brands
surface: web
colors:
  void: "#000000"
  console: "#0a0c11"
  ice-white: "#ededed"
  signal-blue: "#5f7cf9"
  steel: "#62666e"
  hairline: "#23262e"
  success: "#49c873"
  warning: "#f2b643"
  danger: "#d95c5c"
  info: "#5f7cf9"
  well: "#12141a"
  hover: "#191c23"
  ice-white-dim: "#b0b0b0"
  ice-white-warm: "#dce1fb"
  steel-lift: "#9ca0a8"
  graphite: "#05060a"
  cloud: "#d0d2d7"
  concrete: "#656f72"
  storage-orange: "#c46d2e"
typography:
  display:
    fontFamily: "Geist, Inter, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(38px, 4.6vw, 68px)"
    fontWeight: 300
    lineHeight: 1.05
    letterSpacing: "0.3em"
  headline:
    fontFamily: "Geist, Inter, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "0.28em"
  title:
    fontFamily: "Geist, Inter, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.24em"
  body:
    fontFamily: "Geist, Inter, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.04em"
  label:
    fontFamily: "'Geist Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.24em"
rounded:
  xs: "2px"
  sm: "2px"
  md: "2px"
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
    backgroundColor: "rgb(95 124 249 / 0.08)"
    borderColor: "{colors.signal-blue}"
    textColor: "{colors.ice-white}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "15px 18px"
  button-primary-hover:
    backgroundColor: "rgb(95 124 249 / 0.16)"
    borderColor: "{colors.signal-blue}"
    textColor: "{colors.ice-white}"
  button-ghost:
    backgroundColor: "transparent"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ice-white-dim}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "15px 18px"
  button-small:
    backgroundColor: "transparent"
    textColor: "{colors.ice-white-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  chip:
    backgroundColor: "transparent"
    borderColor: "{colors.hairline}"
    textColor: "{colors.steel-lift}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
  chip-selected:
    backgroundColor: "rgb(95 124 249 / 0.1)"
    borderColor: "{colors.signal-blue}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
  input-text:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  map-card:
    backgroundColor: "transparent"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ice-white-dim}"
    rounded: "{rounded.md}"
    padding: "10px"
  map-card-selected:
    backgroundColor: "transparent"
    borderColor: "{colors.signal-blue}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.md}"
    padding: "10px"
  panel:
    backgroundColor: "rgb(10 12 17 / 0.55)"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.md}"
    padding: "24px 22px"
  tab:
    backgroundColor: "{colors.well}"
    textColor: "{colors.steel-lift}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  tab-active:
    backgroundColor: "{colors.ice-white}"
    textColor: "{colors.void}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: WORKMELT

***WORKMELT** is a competitive multiplayer FPS that transforms the modern workplace into a fast-paced tactical arena.*

Workmelt: A web-based lowpoly FPS shooter that you can easily play with friends
at work. Similar to Call of Duty.

> **v0.3 — Console Black.** This revision replaces the v0.2 "Corporate
> Tactical" slate-and-green surface treatment (Dark Slate canvas, Melt Green
> accent, Bebas Neue display) with the Console Black system documented here:
> a true-black canvas, hairline-bordered rails, Geist + Geist Mono type, and
> a single Signal Blue accent. The tone, voice, imagery and the token-file
> discipline are unchanged; only the visual dress moved. The tokens live in
> `src/ui/brand.js`, as ever.

## Overview

**Creative North Star: "The Impressive Sleek and Lightweight Shooter"**

Everything here serves one impression: that something this fast and this
good-looking has no business running in a browser tab. *Sleek* is the surface —
a pure black field, 1px hairline rectangles, one tracked-out grotesk, monospace
micro-labels, nothing textured or glossy anywhere. *Lightweight* is the
substance — the UI is a thin, precise layer over a live scene, never a heavy
chrome shell in front of it. *Impressive* is what the two produce together: a
player who clicked a link thirty seconds ago is already looking at something
that reads as premium software rather than a web toy.

The tone underneath is Corporate Tactical, worn now as an operations console.
WORKMELT's menus behave like terminal-grade enterprise software that happens to
be running a firefight — precise, utilitarian, confident. The interface takes
its cues from Vercel, Linear and mission-control dashboards, not from
traditional military shooters: high contrast, immediately readable, free of
grim overlays, camo, or grunge. The office premise is played completely
straight. The joke is the setting; the interface never winks.

Restraint is the mechanism, not an absence of ambition. Signal Blue appears
only where a decision lives — the selected card, the live status lamp, the
border of the one button that matters — so when it appears it reads as a
decision rather than decoration. Panels are hairline rectangles a few points
above the void, so the composition stays black instead of boxed. Motion runs
120–180ms and gets out of the way. The system earns its impact by spending
almost nothing, almost everywhere.

**Key Characteristics:**

- Black-first by definition: the Void is the canvas and a white page is never
  the starting point.
- Exactly one accent — Signal Blue — used only for selection, live status and
  the primary action.
- Flat planes and 1px hairline rules; zero gloss, gradient, glassmorphism, or
  skeuomorphic texture. Depth is a hairline or it is nothing.
- A fixed two-register type system from one family pair: Geist tracked-out
  uppercase for display, Geist Mono for micro-labels, Geist for everything else.
- Near-square corners (2px) — the geometry of a console, not a card deck.
- Motion is functional and brief; only panels are allowed a subtle overshoot.
- Every menu colour comes from one token file; no literal hex on a menu surface.

## Colors

A true-black field with a small set of greys measured off it, one Signal Blue
accent that is rationed hard, plus state colours that never become decoration.

### Primary

- **Signal Blue** (`#5f7cf9`): The one accent. It appears on the selected map
  card's border and badge, the relay lamp while the connection settles, the
  primary button's border and wash, focus outlines, and essentially nowhere
  else. Measured 5.8:1 on the Void, so it clears small text — but it is never
  a background fill under light text, and never a wash across a surface.

### Secondary

- **Success** (`#49c873`): Ready and online states, confirmation, the relay
  lamp once it is online. 8.0:1 on the Void.
- **Warning** (`#f2b643`): Warm-up state, `RESTART`-gated settings, in-match
  keycap highlights.
- **Danger** (`#d95c5c`): Destructive actions and disconnected state. Large
  text and icons only — it may fill a button, but it never sets small copy.
- **Information** (`#5f7cf9`): The same value as Signal Blue — information IS
  the accent in this system; there is no second blue.

### Neutral

- **Void** (`#000000`): The canvas. True black, the dominant share of every
  composition, and the gaps between rails.
- **Console** (`#0a0c11`): Panel fill, composited at ~55% over the Void so a
  rail reads as a few points above the black rather than as a grey box.
- **Well** (`#12141a`): Inset fields — inputs, tracks, anything recessed.
- **Hover** (`#191c23`): Row hover only.
- **Ice White** (`#ededed`): Primary text, the wordmark, display type.
  18.1:1 on the Void.
- **Ice White Dim** (`#b0b0b0`): Body copy and resting labels, 10.0:1.
- **Ice White Warm** (`#dce1fb`): Exists for exactly one purpose: the hover
  state of a filled light button, warming toward the accent without ever
  putting light text on a blue fill.
- **Steel** (`#62666e`): Structural strokes and metadata at 16px+, and icons.
- **Steel Lift** (`#9ca0a8`): Every string under 16px that wants to read as
  secondary — the mono labels live here. 7.0:1.
- **Hairline** (`#23262e`): 1px rules, dividers, and resting borders — Ice
  White at ~14% resolved over the Void. The single most used colour in the
  system after the Void itself.

### Tertiary — world palette

These describe environment geometry, not UI tokens. Two of them (Graphite,
Cloud) are also bound as UI tokens, for the scrim behind panels and for paper.

- **Graphite** (`#05060a`): Deep shadows and the void behind panels.
- **Cloud** (`#d0d2d7`): Paper, whiteboards, and lit surfaces.
- **Concrete** (`#656f72`): Floors and exterior walls.
- **Storage Orange** (`#c46d2e`): The one-per-map logistics accent.

### Named Rules

**The Accent-Is-A-Decision Rule.** Signal Blue marks decisions and live state:
the selected card, the primary border, the settling relay lamp, focus. It is
never a wash, never a fill under light text, and never decoration. If a screen
shows more than a few square centimetres of blue, something is wrong.

**The Never-Text-On-Accent Rule.** Light text on a Signal Blue fill fails
contrast. A primary CTA is therefore a Signal Blue *border* over a faint blue
wash (8–16% alpha) with Ice White text on black. Where a solid light fill is
genuinely required (the active tab), its text is the Void.

**The 16px Floor Rule.** Steel and Danger are large-text and icon colours
only. Any string under 16px that wants to read as secondary uses Steel Lift or
Ice White Dim instead.

**The One Token File Rule.** Every colour, font, radius, and duration on a menu
surface comes from the custom properties in `src/ui/brand.js`. A literal hex in
`src/match/ui.js`, `src/ui/menu.js`, `src/ui/style.js`, or `src/net/ui.js` is a
defect. The in-world HUD is the one deliberate exemption.

## Typography

**Display & Body Font:** Geist (with Inter, system-ui fallbacks) — Vercel's
typeface, requested as a progressive enhancement.
**Label Font:** Geist Mono (with ui-monospace fallbacks).

**Character:** One family, three registers. Display is Geist at light weight,
uppercase, tracked way out (`.3em`) — a name written across a wall, not a
headline. Labels are Geist Mono, 9–11px, uppercase, tracked `.14–.3em` — the
register of a terminal prompt. Everything functional in between is plain Geist
at 11–13px. The hierarchy is carried by tracking and weight, never by a third
face.

### Hierarchy

- **Display** (300, `clamp(38px, 4.6vw, 68px)`, 1.05, `.3em`, uppercase): The
  current map's name on the lobby stage. One per screen.
- **Headline** (300, 30px, 1.0, `.28em`, uppercase): Room codes and modal
  titles — codes get the same wide tracking because they are read character by
  character.
- **Title** (500, 12px, `.24em`, uppercase): Button labels and section heads.
- **Body** (400, 11–13px, 1.55, `.04em`): Descriptions, row names, notes.
- **Label** (Geist Mono, 500, 9–11px, `.14–.3em`, uppercase): Eyebrows, field
  labels, status strings, key hints, map-card metadata. Weight and tracking
  carry the emphasis, not size.

### Named Rules

**The Two-Register Rule.** Tracked-out uppercase is for display and labels
only; body copy is never tracked past `.06em` and never uppercase. A paragraph
in the label register is a status readout, and it is kept to two sentences.

**The Progressive Webfont Rule.** The webfont is a progressive enhancement,
never a dependency. Geist is requested with `media="print"` so it can never
render-block, and it is not requested at all on a deterministic capture run,
because a pending webfont leaves `document.fonts.ready` unresolved and would
hang every screenshot in `tools/`. The fallback stack is legible before,
during and after.

**The Tabular Figure Rule.** Any number that changes in place — ammo, scores,
countdowns, slider values — is set with `font-variant-numeric: tabular-nums` so
it does not jitter as it counts.

## Layout

An 8px baseline grid with a 4px half-step. Radius is 2px, borders are 1px.

**Lobby.** A fixed full-viewport overlay above the live scene: three
hairline-bordered rails on the Void, `320px / minmax(0,1fr) / 372px` with 14px
gaps.

- **Left rail — the room.** The invite eyebrow, the active-room code with its
  copy control, the relay lamp and status readout, the roster; pinned to the
  bottom, this client's own setup (garrison chips, callsign, settings) and the
  wordmark.
- **Stage — the current map.** `CURRENT MAP` eyebrow, the map's name in
  display type, its description in the label register, then the hero viewport:
  the map's artwork (`public/maps/<id>.png`) when it ships, its blueprint
  floorplan on a faint graticule when it does not. The action dock floats at
  the bottom centre: primary, copy-invite, key hints, and the optional alt
  link.
- **Right rail — the map selector.** One card per enabled map in a two-column
  grid: floorplan thumbnail, name, description. The selected card wears the
  Signal Blue border and a small blue badge.

**Pause menu.** A centred modal over a Graphite scrim. Header, wrapping tab
row, scrolling body, footer. Settings rows are a 52px min-height flex with a
16px gap so a long label and its control never collide.

**Responsive behaviour.** Three thresholds, each solving a real failure:

- **1240px** — the selector rail drops under the stage and its cards flow
  into an auto-fill row.
- **860px** — one column, stage first: the map and the dock are the screen.
- **max-height 680px** — a *height* query, not a width one. Rail padding
  tightens, the display type shrinks, the dock loses its slack.

**HUD.** A separate spatial system. Every dimension is `calc(N * var(--k))`
where `--k` derives from viewport height (1080p = 1.0), so the HUD holds its
proportions from 720p to 4K without re-authoring. Its grid unit is 4px scaled;
screen margins are 6.5 units.

### Named Rules

**The Height-Query Rule.** Menu surfaces sit over a live scene on laptops. Test
`max-height`, not just `max-width` — a 1440×700 window is the common failure,
and it is invisible to a width breakpoint.

## Elevation & Depth

The system is flat and tonal, and flatter than v0.2: depth is a 1px Hairline
or it is nothing. Rails and cards are bordered rectangles whose fill sits a
few points above the Void; wells recess by tone alone. There is no directional
light anywhere in the UI. The two ambient-shadow tokens survive only as a
faint zero-offset seat for surfaces that float over the live scene (toasts,
the pause modal); nothing resting in the lobby's layout casts anything.

Because `rgba()` cannot take a hex custom property, the colours that ever
appear at partial alpha are also published as channel triplets (`--wm-bg-rgb`,
`--wm-surface-rgb`, `--wm-void-rgb`, `--wm-fg-rgb`, `--wm-accent-rgb`), and
`rgb(var(--x) / a)` is how every translucent WORKMELT surface is built.

### Named Rules

**The No-Direction Rule.** Every UI shadow has zero offset. A directional drop
shadow is a web-overlay tell and it fights whatever direction the scene's key
light happens to come from.

**The Hairline-First Rule.** Before reaching for a background change, a shadow,
or a second border weight, reach for one 1px Hairline. Separation, grouping,
selection and hover are all expressible as border colour.

**The HUD Outline Rule.** The in-world HUD does not use shadows for depth at
all. Text survives a blown-out sky *and* a black interior via a synthesized
outline: eight equal-radius hard shadows in a ring, paired with one tight soft
seat. Direction-free by construction, and it needs no scrim behind it.

## Shapes

Rectangular, near-square. The working radius is 2px everywhere — panels,
cards, buttons, chips, inputs, keycaps — with the 99px pill reserved for the
scrollbar thumb. Nothing else is ever a pill.

Borders are always exactly 1px. The resting border is Hairline; hover lifts it
to Steel Lift; selection and focus lift it to Signal Blue. Selection is
expressed by border colour plus one small accent badge, never by adding weight
or a second ring.

Status dots and lamps are small squares rather than circles — a choice that
keeps the roster reading as enterprise software rather than a chat app.

### Named Rules

**The Blue Border Rule.** Selection reaches for
`border-color: var(--wm-accent)` before it reaches for anything else. It is
the cheapest possible affordance, costs no layout, and is why Signal Blue
stays rationed while still appearing wherever a decision was made.

## Components

### Buttons

- **Shape:** 2px corners, 1px border, 12px Geist 500 tracked `.24em`
  uppercase, an optional 1.5px-stroke icon leading the label.
- **Primary:** Signal Blue border, Ice White text, a faint blue wash
  (`rgb(accent / .08)`) behind it. Hover deepens the wash to `.16`; active
  presses down `translateY(1px)` over 90ms linear. The leading icon is the
  accent.
- **Ghost:** Hairline border, Ice White Dim text. Hover lifts border to Steel
  Lift and text to Ice White. A completed action (`.done`) turns border and
  text to Success.
- **Icon:** 32px square, Hairline border, icon in Steel Lift; hover lifts the
  border to the accent.
- **Keycap:** Key hints are Geist Mono 9px in a Hairline-bordered 2px chip.
- **Disabled:** 42–45% opacity and `cursor: not-allowed`. No colour change.

### Chips

- **Style:** Transparent, Hairline border, 2px radius, Geist Mono 9.5px
  tracked uppercase, `8px 11px`. Used for bot-garrison counts and other small
  exclusive choices.
- **State:** Hover lifts text to Ice White and the border to Steel Lift.
  Selected takes the Signal Blue border over a 10% blue wash with Ice White
  text.

### Cards / Containers

- **Map card:** 2px radius, transparent over the rail, Hairline border,
  `10px`. A thumbnail well holds the floorplan canvas; name in 11px tracked
  Geist 500; description in 9px Geist Mono. Hover borders Steel Lift;
  `aria-pressed="true"` borders Signal Blue, brightens the plan, and drops a
  6px blue badge in the thumbnail's corner. Disabled drops to 45%.
- **Panel / rail:** Console at ~55% over the Void, 1px Hairline, 2px radius,
  no shadow. Inner structure is drawn with Hairline rules, not nested boxes.
- **Row:** `9px 2px` with a 10px gap, separated by 1px Hairline rules rather
  than gaps. Hover fills with Hover. A newly joined row plays a one-shot
  animation that fades from the Hover fill with an inset 3px Success bar on
  the leading edge — arrival is announced once, and then the row is ordinary.

### Inputs / Fields

- **Style:** Well background, 1px Hairline, 2px radius, `8px 10px`, Geist 500
  at 12px. The label above is a Geist Mono eyebrow.
- **Hover:** Border lifts to Steel Lift.
- **Focus:** `outline: none`, replaced by a Signal Blue border. The outline is
  suppressed only because the border itself becomes the focus indicator —
  never suppress one without providing the other.
- **Key bind:** While listening it inverts to a Signal Blue fill with Void
  text — the one place an accent fill is correct, because the text on it is
  the Void.

### Navigation

- **Pause-menu tabs:** A wrapping row of Well-backed Geist Mono chips. Hover
  fills with Hover; the active tab inverts to Ice White with Void text. A
  settings row that differs from its preset carries an inset 2px Signal Blue
  bar on its leading edge; a boot-time-only setting adds a Warning-coloured
  `RESTART` tag.
- **Focus:** Every menu surface declares
  `:focus-visible { outline: 1px solid var(--wm-accent); outline-offset: 2px }`.
  This is non-negotiable and is why keyboard traversal is legible on all four
  surfaces.

### The Wordmark

`WORKMEL` plus a wrapped `T` carrying a Signal Blue drip off the stem: a
`.22em` bar hanging from the glyph, centred on the T's stem. Set in Geist 500
tracked `.18em`, it reads correctly in every fallback grotesk — nothing about
it is metric-tuned to one face. It scales from 15px as the left rail's
sign-off to whatever a title screen asks of it.

## Do's and Don'ts

### Do:

- **Do** take every colour, font, radius, and duration on a menu surface from
  the custom properties in `src/ui/brand.js`.
- **Do** keep Signal Blue to decisions and live state: selection, the primary
  border, the settling relay lamp, focus.
- **Do** draw the primary CTA as a Signal Blue border and faint wash with Ice
  White text — never a solid blue fill under light text.
- **Do** use Ice White Dim for body copy and Steel Lift for secondary strings
  under 16px.
- **Do** build every translucent surface as `rgb(var(--wm-*-rgb) / a)`.
- **Do** separate, group and select with 1px Hairlines before anything else.
- **Do** keep UI transitions in the 120–180ms band with swift-out easing, and
  honour `prefers-reduced-motion` by collapsing both duration tokens to 1ms.
- **Do** test menu surfaces against a short viewport (`max-height: 680px`),
  not only a narrow one.
- **Do** set changing numbers with tabular figures.
- **Do** hard-code the resolved sRGB hex of any derived colour and keep the
  `color-mix()` expression it came from in the comment — `color-mix()` is
  recent-Chromium-only, and this UI has to render identically in the capture
  harness, in Firefox, and on whatever the person at work has open.

### Don't:

- **Don't** introduce a literal hex into `src/match/ui.js`, `src/ui/menu.js`,
  the menu block of `src/ui/style.js`, or `src/net/ui.js`.
- **Don't** put light text on a Signal Blue fill, or use the accent as a wash.
- **Don't** set Steel or Danger below 16px.
- **Don't** default any WORKMELT surface to a white page. The light theme is a
  derived inversion, not the source of truth.
- **Don't** add a glossy gradient, glassmorphism, or a skeuomorphic texture
  anywhere.
- **Don't** give a UI shadow a directional offset, or a resting surface any
  shadow at all.
- **Don't** make anything fully pill-shaped; 2px is the working radius and the
  scrollbar thumb is the only pill.
- **Don't** track body copy like a label, or set a paragraph in the mono
  register beyond a two-sentence status readout.
- **Don't** let a webfont block a render or a capture.
- **Don't** use skulls, crosshairs, blood spatter, or bullet vectors as icons.
  Icons read as enterprise-software logic — folders, boxes, network nodes,
  clipboards, terminal prompts — at a uniform 1.5px stroke.
- **Don't** put a backtick inside a CSS comment in these stylesheets. They are
  template literals, and it is a syntax error.

---

# Extended brand guidance

*The two sections below are WORKMELT brand guidance that falls outside the
spec's eight visual sections. They are preserved so there remains one file to
read.*

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
- **Map hero art:** The lobby stage shows one still per map from
  `public/maps/<id>.png` — an isometric or high-angle render of the whole
  level on a dark ground, lit by the map's own sun. Artwork is optional per
  map: a map without one shows its blueprint floorplan on a graticule, which
  is the same visual system the selector thumbnails use.
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

**The lobby theme labs and layout explorations are closed.** `src/match/ui.js`
used to carry six alternate lobby treatments (`variant-*`) and, later, five
alternate map-selection layouts behind a `?debug=true` picker. All of them,
their token sets and both pickers are gone: the Console Black system documented
here is the lobby's only treatment, its three-rail layout is the only layout,
and a browser holding either old preference key (`workmelt-lobby-style`,
`workmelt-map-layout`) has it cleared on the next lobby boot.

Nothing may reintroduce a `variant-*` block or a `--lab-*` / `--sheet-*` token.
A new direction is a change to `brand.js` and to this document, not a second
system living beside it.
