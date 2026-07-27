---
name: "WORKMELT: Official Design & Brand Guidelines (v0.1)"
category: Brands
surface: web
colors:
  dark-slate: "#28303d"
  gunmetal: "#343a49"
  ice-white: "#f0f0f0"
  melt-green: "#42b66b"
  steel: "#888a92"
  hairline: "#3c434f"
  success: "#49c873"
---

# WORKMELT: Official Design & Brand Guidelines (v0.1)

> Category: Brands

> Surface: web

***WORKMELT** is a competitive multiplayer FPS that transforms the modern workplace into a fast-paced tactical arena.*

Workmelt: A web-based lowpoly FPS shooter that you can easily play with friends at work. Similar to Call of Duty.

## Color Palette

| Role | Name | Hex | Usage |
| --- | --- | --- | --- |
| background | Dark Slate | `#28303d` | primary canvas for UI and dark environments — roughly 65% of any composition |
| surface | Gunmetal | `#343a49` | panel backgrounds and elevated UI at 85-90% opacity over the canvas — roughly 20% of a composition |
| foreground | Ice White | `#f0f0f0` | primary text, high-contrast lines and the wordmark — 11.66:1 on Dark Slate |
| accent | Melt Green | `#42b66b` | critical CTAs, active states and the logo drip — capped at ~4% of a composition so interactions read as intentional |
| muted | Steel | `#888a92` | secondary text and metadata, plus structural elements and weapon bodies — 3.86:1 on Dark Slate, so 16px+ only |
| border | Hairline | `#3c434f` | 1px rules and dividers — Ice White at 10% opacity resolved over Dark Slate |
| accent-secondary | Success | `#49c873` | ready/online states, links and confirmation — 6.20:1 on Dark Slate |

## Typography
- **Display:** Bebas Neue — weights 400 — fallbacks: Oswald, Teko, DIN Condensed, Haettenschweiler, Impact, sans-serif-condensed, sans-serif (Tall, condensed, uppercase, industrial, geometric with slightly rounded corners. Main menus, match start, victory/defeat screens and large environmental decals. Always set uppercase; the typeface has no lowercase to fall back on.)
- **Body:** Inter — weights 400, 500, 600, 700 — fallbacks: IBM Plex Sans, Manrope, system-ui, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif (Neutral grotesk. HUD elements, settings menus, chat and weapon stats — must stay legible at 10-14pt.)

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

## Layout

- **Radius:** 8px
- **Border weight:** 1px
- **Spacing:** 8px baseline grid (4px half-step)

### Posture rules
- Dark-first: Dark Slate (#28303d) is the canvas and Ice White (#f0f0f0) is the text. The light theme is a derived inversion, not the source of truth — never default a WORKMELT surface to a white page.
- The 65/20/10/4/1 ratio rule governs every composition, UI or environmental: 65% Dark Slate/Graphite, 20% Gunmetal, 10% whites and light gray, 4% Melt Green, 1% environmental accent. Melt Green is never a background wash — the restraint is what makes interactions read as intentional.
- Panels are Gunmetal at 85-90% opacity over the canvas, with a 1px Ice White @10% border (#3c434f resolved) and a 6-10px radius. Never fully pill-shaped, never completely sharp.
- Shadows are very soft with a large spread and no directional lighting. Strict rule: no glossy gradients, no glassmorphism, no skeuomorphic textures anywhere.
- Buttons: primary is an Ice White fill with Graphite text (14.91:1); secondary is transparent with a 1px Ice White outline that hovers to a Melt Green border; danger is a muted #d95c5c fill. Text on any Melt Green fill is Graphite (6.58:1), never Ice White (2.27:1 — fails AA).
- Icons read as enterprise software logic, not combat: folders, cardboard boxes, network nodes, office buildings, clipboards, terminal prompts. Uniform 1.5px stroke weight and sharp geometry. Never skulls, crosshairs, blood spatter or bullet vectors.
- Motion runs 120-180ms for all UI transitions with minimal easing (swift out, linear in). Panels may overshoot subtly on open; nothing else does. Clarity takes precedence over cinematic flair.
- Type pairing is fixed: Bebas Neue, uppercase and condensed, for display and environmental decals; Inter for every string at 10-14pt and below. Body copy is never set in the display face.
- Measured contrast floors on Dark Slate: Ice White 11.66:1 and Cloud 8.78:1 clear body text; Success 6.20:1 and Melt Green 5.15:1 clear UI text; Steel 3.86:1, Info 4.13:1 and Danger 3.57:1 are large-text and icon only.
- Interfaces mirror modern SaaS platforms like Linear or Notion rather than traditional military shooters — high-contrast, readable, and free of grim overlays.
- World palette (environment geometry, not UI tokens): Graphite #181c28 for deep shadows and the void behind panels, Cloud #d0d2d7 for paper, whiteboards and lit surfaces, Concrete #656f72 for floors and exterior walls, Storage Orange #c46d2e as the one-per-map logistics accent.
- UI state colors seeded into the token system: Success #49c873 (colorSuccess), Warning #f2b643 (colorWarning), Danger #d95c5c (colorError), Information #4d8ef7 (colorInfo). Danger at 3.57:1 and Info at 4.13:1 on Dark Slate are large-text and icon only.
- Consuming the tokens: load system/variables.css then system/brand-canvas.css. The generated ramp derives from antd's stock greys and drops colorBgBase/colorTextBase, so variables.css alone ships #141414/#ffffff neutrals rather than Dark Slate and Gunmetal. brand-canvas.css re-binds the neutral ramp to the registered palette; :root is the dark canvas and .brand-light is the opt-in inversion.
- On light surfaces Melt Green is a fill only — as text or a link it measures 2.27:1 on Ice White. Use Melt Green Deep #007f37 (same hue and chroma, lightness lowered to the lightest value clearing 4.50:1) for green text and links in the light inversion.
