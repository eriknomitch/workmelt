# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Coworkers on a short break. The primary user is someone at a company who has ten
or fifteen minutes mid-workday and wants to play a match with the people they
already work with. They arrive from a link a colleague pasted into a chat, on
whatever machine is in front of them, and they have to be shooting within
seconds — not installing, not registering, not waiting in a queue. The session
is short, social and bounded by the workday around it.

Secondary audiences (FPS players evaluating the technology, and readers of the
project as an engineering artifact) exist but do not drive product decisions.

## Product Purpose

WORKMELT is a competitive multiplayer first-person shooter that runs entirely in
the browser. It exists so that a group of coworkers can be in the same live
match together with one shared URL and no setup. Success is the time and
friction between "someone sends the link" and "everyone is playing" — and
whether the match that follows feels like a real shooter rather than a browser
demo.

## Positioning

No install, instant link-join. The current URL is always a valid invite: opening
the game generates a room code and writes it into the address bar, and anyone
who opens that URL is in the same room, up to 12 players. There are no accounts,
no matchmaking, no download and no client to update. Removing the friction
between deciding to play and playing is the mechanism — a native or storefront
shooter cannot truthfully claim it, and a browser game with accounts and lobbies
has given it away.

## Operating Context

- Played on work machines, on a work network, in short windows between other
  work. Hardware varies wildly and is not chosen for gaming.
- Distribution is a pasted link in a team chat. There is no store page, no
  launcher and no onboarding funnel before the game.
- A player who is alone can start immediately against a bot garrison as a
  private warm-up; that warm-up does not lock the room, and a friend arriving
  later is pulled into the countdown rather than having to wait for it to end.
- Trackpads are a real input device here, not an edge case: a two-finger click
  cannot be held while a one-finger click fires, so aiming has both a
  hold/toggle setting and a keyboard rebind.
- Settings, callsign and graphics profile persist per browser and are never
  synchronized across players.

## Capabilities and Constraints

Confirmed functionality:

- Room-based free-for-all, up to 12 players per room, over a WebSocket relay
  (`server/` for local/Node, `worker/` for the Cloudflare Worker + Durable
  Object deployment).
- Lobby with one primary button whose meaning follows room state (Play vs bots /
  Ready up / Cancel ready / Deploy now), a 3-2-1 synchronized start, map
  selection, bot garrison size, editable callsign and a copy-invite action.
- Multiple authored maps (Market, Rust, Wilmot, Fishers, Loop, Nuketown) with an
  enable flag and menu order in `src/world/maps.js`.
- Auto graphics: the client estimates display cadence at first launch,
  calibrates a Performance/Low/Medium/High/Ultra tier, then adapts internal
  resolution toward stable p95 frame pacing. Every renderer knob is also exposed
  manually, with boot-time knobs marked `RESTART`.
- Weapon balance is a contract, not a feel: shots-to-kill matrix, two-point
  damage falloff, deterministic recoil patterns, and quickscope invariants are
  all self-tested.
- Spawn on death restocks the entire loadout. There are no ammo pickups; this is
  the only refill path.

Technical constraints (recorded in `AGENTS.md`, treated as binding by the
codebase):

- Three.js r180 + WebGL2, `three` and `ws` as the only runtime dependencies. No
  new runtime dependencies.
- Every mesh, texture and animation is generated procedurally in code at load
  time. No model files, no HDRIs, no image assets. Audio is procedural synthesis
  plus a small sampled SFX layer.
- Subsystem boundaries are obtained through `ctx.get('<id>')`, never by
  importing another subsystem's module directly.
- Randomness uses the seeded `ctx.rng`, never `Math.random()`, so captures and
  image diffs stay meaningful.
- Per-frame allocations are avoided and GPU/audio resources are disposed;
  quality-tier and performance work is gated by `tools/goal.mjs`.

## Brand Commitments

- The name is WORKMELT, always uppercase in display use.
- The brand system in `DESIGN.md` is the visual authority; its tokens live in
  `src/ui/brand.js` and no literal hex belongs on a menu surface. The in-world
  HUD is the one deliberate exemption, because it is drawn over a live scene.
- Voice is Corporate Tactical, never parody. The office premise is played
  completely straight — the joke is the setting, never the writing.
- **No accounts and no monetization claims.** There is no login, no pay-to-win,
  and no pricing, subscription, player-count or revenue claim may appear in the
  UI or in copy. Future work must not invent one.
- Map fictions are authored and recorded in `BLUEPRINT.md`; the blueprint
  aesthetic is a rendering and markings grammar applied over them, not a
  re-setting of the levels.

## Evidence on Hand

- The running game itself is the demonstration: `npm run dev` (client) and
  `npm run dev:mp` (client + relay).
- `README.md`, `MULTIPLAYER.md`, `ARCHITECTURE.md`, `DESIGN.md`, `BLUEPRINT.md`,
  `TEXTURE-PERF.md`, `LIBRARIES.md`, `CLOUDFLARE.md` are current first-party
  documentation.
- Capture and playtest harnesses produce real screenshots on demand
  (`tools/capture.mjs`, `shots/`), and `tools/goal.mjs` produces real
  performance measurements.
- The project is forked from `mshumer/Claude-of-Duty` and was written by an
  orchestrated fleet of AI agents; this is a true and citable fact.
- **Not on hand, and must not be fabricated:** testimonials, named customers or
  companies, player counts, concurrency figures, press coverage, awards, pricing
  or availability commitments. Frame rate is only quotable from
  `tools/profile.mjs` on real hardware — never from a GPU-less machine, where
  only `costIndex` ratios are meaningful.

## Product Principles

1. **The link is the product.** Any step between receiving a URL and being in a
   match is a defect. Preserve the invariant that the current URL is always a
   valid invite.
2. **Nobody waits on anybody.** Alone, you play bots now; late, you join the
   countdown or drop into the live match. No state in the lobby is a dead end.
3. **Serious underneath the premise.** The setting is the joke; the ballistics,
   the map design and the time-to-kill are not. Never trade gameplay integrity
   for a gag.
4. **Degrade, never refuse.** The machine is a work laptop of unknown capability.
   Adapt quality automatically and keep the game playable rather than gating on
   hardware.
5. **Claim only what the repo can prove.** Every number, capability and citation
   traces to code, a self-test or a measurement on real hardware.

## Accessibility & Inclusion

- Trackpad and keyboard-only aiming are supported first-class (ADS hold/toggle,
  ADS key rebind), and control binds are user-remappable and persisted.
- Contrast floors on the brand canvas are measured and enforced per `DESIGN.md`;
  Steel, Info and Danger are large-text and icon only.
- Visibility settings (brightness, shadow lift, exposure key, sharpness) exist so
  players can make distant opponents readable on poor displays.
- No product-specific conformance standard has been established. This is an
  undecided fact, not an omission.
