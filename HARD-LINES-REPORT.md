# Hard Lines → WORKMELT: what's worth stealing

An exploration of [yegors/hard-lines](https://github.com/yegors/hard-lines) — a
browser FPS with an ink-sketch-on-paper aesthetic and CS-shaped gunplay
(three.js 0.185, TypeScript, ~167k LOC, Rapier for cosmetic props only, custom
deterministic sim) — against WORKMELT's current state, looking for concrete
improvements we can port. The two games have opposite art directions (their
whole renderer is a stylised sketch pipeline; ours is photoreal CoD), so
nothing visual transfers. What does transfer is **netcode architecture, match
structure, combat mechanics, and test discipline** — the places where Hard
Lines is simply further along.

Each item below says what they built, what we have today, and what porting it
would look like under our rules (no runtime dependencies, seeded RNG, `ctx`
subsystem boundaries, selftests beside the code).

---

## Tier 1 — highest impact

### 1. Netcode: stop trusting the shooter

**Them:** full server authority. The server imports the same sim code the
client runs (`server/room.ts` imports `SimWorld`), clients send only inputs at
64 Hz, the server simulates and fans out delta snapshots at 32 Hz. Clients
predict the local player and reconcile on ack (correction epsilon 0.02 m —
snap sim, smooth only the *render* over ~100 ms). The server keeps a 1-second
ring of per-tick hitbox positions and **rewinds** to the shooter's reported
view time for hit tests (rewind capped at 20 ticks / 312 ms). Commands are
quantised *before* prediction so both ends simulate bit-identical inputs. A
protocol version number is checked for equality at join.

**Us:** pure relay, trust-the-shooter (`MULTIPLAYER.md`; `src/net/index.js:431`).
The shooter ray-tests remote puppets at their ~110 ms-old interpolated
positions, sends a `hit` claim, the relay clamps damage to 0–200 and forwards
it, and **the victim applies it to itself**. No prediction (not needed — each
client owns itself), no lag compensation, no protocol version field at all
(verified: zero hits for `version` in `server/index.mjs` / `src/net/index.js`).

**Port — staged, because a full authoritative sim is a rewrite of
`MULTIPLAYER.md`'s core design and our physics won't run in a Durable Object
cheaply:**

1. **Protocol version pin** (small): one `v` field in `join`/`welcome`,
   equality check, reject with reason. Their `protocol.test.ts` also asserts
   *headroom* in enum-like fields, not just current values — same idea fits
   `server/map.selftest.mjs`.
2. **Replicate what's missing** (small/medium): the remote muzzle flash is
   hardcoded `weapon: 'rifle'` (`src/net/index.js:403`); reloads, weapon
   switches, thrown grenades/stuns, lean and slide are not on the wire at all.
   Add current weapon id + stance bits to the 20 Hz state blob and a `throw`
   event. Remote frag arcs and stun flashes matter in an FFA.
3. **Relay-side sanity** (small): the relay knows nothing about weapons. Give
   it the rpm table and reject `fire`/`hit` claims that exceed a weapon's
   cadence, and hit claims whose damage exceeds the weapon's max. Their
   posture is explicit — full authority, input rate limits, shot-timing
   sanity — we can take the cheap two-thirds of it without simulating.
4. **Victim-side rewind check** (medium): we already have the right victim —
   the victim applies its own damage. Include the shooter's interp timestamp
   in the `hit` claim; the victim keeps ~1 s of its own position history and
   validates the claim against where it actually was at that time (their
   `rewoundTargets` model, inverted to fit our relay). Rejects teleport-shot
   claims and makes "I was behind the wall" deaths honest, with no server sim.

### 2. Match structure: win conditions, and TDM

**Them:** FFA to 30 frags or 10 minutes; TDM to 75 team frags, 1v1–4v4 with a
manual White/Black team pick, warmup until both sides are full, no friendly
fire; 8 s end-of-round freeze, then a full world + score reset keyed by a
`roundSerial` so clients know to wipe cosmetic state. **Spawn protection: 1.5 s,
dropped the moment you fire.**

**Us:** kills/deaths on the Tab scoreboard and nothing else. No score limit, no
timer, no win condition, no end screen. The HUD match bar already renders
`scoreUs / scoreThem / timeLeft / mode` — but nothing real drives them
(`scoreThem`/`timeLeft` are only written by the screenshot demo, `ui/demo.js`;
`mode: 'TDM'` is a dead default string). No teams (`spawnTeam` returns
`p<id>` — every player is his own team, `net/index.js:698`). No spawn
protection (verified: zero hits for protect/invulnerable).

**Port:** the relay already owns per-room score state, so a frag cap + match
timer + `match_end` broadcast is small and mostly lands in `server/index.mjs`
and `worker/room.js` (same protocol, two implementations). The existing match
bar wires straight in. Spawn protection is a timestamp in the state blob the
shooter's hit test respects. TDM proper is a second stage: a team field in
`join`/`welcome`, the spawn director's friend-pull already exists
(`src/world/spawns.js` scores friends), and the 12-hue livery system can split
into two 6-hue families. Their **end-freeze + reset serial** pattern is worth
copying exactly — it's what makes "play again" work without a page reload.

### 3. Melee

**Them:** a complete, tested melee (`src/sim/melee.ts`, docs/08): separate key
(not a weapon slot), 2.1 m reach with a forgiving 0.58 m capsule traced at
three heights, **45 damage front/side, 100 from inside the victim's rear cone**
(`facing · toAttacker ≤ −0.45`), 656 ms recovery, static geometry gets a final
ray veto so you can't stab through cover, lag-compensated server-side.

**Us:** `melee: ['KeyV']` is declared in `src/core/input.js:20` and read by
nothing. The gap every FPS player feels at 2 m.

**Port:** direct. We have everything it needs — `physics.raycast` for the cover
veto, bot capsule colliders and the MP puppet capsule for targets,
`damage:dealt` for the feed. The front/backstab split and recovery numbers are
proven starting values; a `weapons/melee.selftest.mjs` pinning
reach/arc/backstab-cone/recovery matches our balance-contract style. Needs a
viewmodel strike animation via the existing procedural clip system
(`src/weapons/clips.js`).

### 4. Crosshair that shows real spread

**Them:** crosshair gap = live `inaccuracyDeg` mapped through the actual FOV to
pixels (`src/ui/hud.ts`) — bloom you can literally see: sprint tucks the ticks
into L-brackets and dims them (you can't fire while sprinting), weapon swap
kicks a wiggle. Drawn from a fixed seed so the aim point never dances.

**Us:** `ui/crosshair.js` is a fixed four-blade reticle with a **hardcoded**
spring — its gap has no relationship to the real spread model in
`src/weapons/index.js` (bloom, stance multipliers, the AX-7's 6.5° hip cone).

**Port:** small and high-feel. Publish current effective spread (base ×
`SPREAD_MODS` + bloom) on the existing `weapon:*` event stream or a getter,
convert degrees → screen px through the camera's real FOV + viewport, drive the
blade gap from it. Instantly teaches players why hip-firing the AX-7 misses and
makes sprint/air penalties legible. A natural follow-on is exposing crosshair
colour/size in settings, which we also lack.

---

## Tier 2 — strong, medium effort

### 5. Deterministic replay recorder

**Them:** `src/debug/replay.ts` records the complete per-tick command map for
every sim player, snapshots the whole world (including tuning config — sliders
moved mid-recording once falsified the check), then verifies by re-running a
ghost world over the same commands and comparing **full-world hashes**. It is
simultaneously their feel-tuning workhorse and their netcode regression suite.

**Us:** deeply deterministic culture (seeded `ctx.rng`, bit-identical
`baseline.mjs` captures, `imagediff.mjs`) — but no gameplay replay. Feel
regressions in movement/recoil are currently caught by hand.

**Port:** scope it to what's already tick-stepped: player commands into
`src/player/movement.js` + weapon events at the 120 Hz fixed step, plus a
world-state hash (player transform, ammo, spread, rigid body positions).
Record/verify from the perf HUD. This also becomes the harness that would gate
netcode item #1 stage 4.

### 6. A shotgun (multi-pellet fire support)

**Them:** the M4 fires **8 independent 18-damage pellets** with brutal falloff
(floor 0.12), and — the part worth copying — hitmarker/hit audio **coalesce
once per trigger pull**, so buckshot doesn't machine-gun the UI. Shell-loop
reload: partial magazines top up one shell at a time and the loop aborts on a
trigger pull.

**Us:** four hitscan-shaped projectile weapons, one round per trigger pull
(verified: zero hits for pellet/shotgun). Roster has rifle/SMG/pistol/sniper —
no CQB specialist.

**Port:** `pellets: N` in `src/weapons/defs.js`, loop N draws from the spread
cone in `ballistics.js` (each pellet is already just a pooled round), coalesce
`damage:dealt` UI feedback per shot id. The incremental shell reload maps onto
our procedural clip system. Extends the shots-to-kill matrix in
`balance.selftest.mjs` naturally.

### 7. Input hardening (quick wins)

**Them:** pointer lock with **`unadjustedMovement: true`** (no OS mouse
acceleration — table stakes for an FPS); immersive-play chain of JS fullscreen
→ pointer lock → **`navigator.keyboard.lock()`** on WASD/Ctrl/R so Ctrl+W /
Ctrl+Shift+W / Ctrl+R don't kill the tab mid-strafe (Chromium, needs the
fullscreen step); CS-compatible sensitivity (0.022°/count × sens) so players
port their sens 1:1.

**Us:** bare `this.canvas.requestPointerLock?.()` (`src/core/input.js:103`) —
no options, no keyboard lock, no fullscreen chain.

**Port:** an afternoon. `requestPointerLock({ unadjustedMovement: true })` with
a fallback for browsers that throw on the options bag, and an optional
fullscreen+keyboard-lock path behind a setting. Probably the best
effort-to-value ratio in this whole list.

### 8. Killfeed/scoreboard unification + spawn protection

Two small structural fixes their layout makes obvious:

- **Us:** MP kills bypass `ui/killfeed.js` and render as `net`'s own toasts
  (`net/index.js:543`); the Tab scoreboard is registered by `net`, so solo play
  (`?mp=0`) has **no scoreboard at all**. **Them:** one `matchUi` draws feed +
  scoreboard for netplay *and* sandbox (local K/D, scripted-figure obituaries).
- Route MP kills through the one killfeed, register the scoreboard
  unconditionally and feed it bot K/D in solo. Add spawn protection from
  item #2 while in the area.

### 9. Loadout selection

**Them:** "Tool Up" tray — two slots, instant apply, persisted to
`localStorage`, a hard gate before both sandbox and join, kit sticks across
death. Tray display order deliberately decoupled from wire order (append-only
wire ids so adding a gun can't corrupt old persisted loadouts).

**Us:** everyone always carries all four weapons (`LOADOUT` constant,
`src/weapons/index.js:27`). Fine for four guns; the moment the roster grows
(see #6) it stops scaling.

**Port:** primary+secondary pick in the pre-deploy lobby (`src/match/ui.js`,
styled from `src/ui/brand.js`), persisted per player, sent in `join` so
puppets can render the right silhouette. Their wire-order lesson applies
verbatim to our `defs.js` ids.

---

## Tier 3 — targeted ideas

### 10. A latency jig for the relay

Their killer testing idea: an **in-process virtual-clock client/server pair**
(`server/jig.ts`) with deterministic seeded loss modelled as TCP head-of-line
stalls — whole matches simulated in milliseconds, pinned in a vitest matrix at
30/80/150 ms RTT with 2 % loss ("zero mispredictions after lead settles",
"kills register on full-speed strafers at 150 ms"). Plus a protocol-level
scripted bot (`server/bot.ts --hunt`) as a live sparring partner.

We already selftest the relay on a real socket (`server/map.selftest.mjs`,
`skin.selftest.mjs`) but with no latency model. A `server/latency.selftest.mjs`
that wraps the socket in a delayed/lossy queue and asserts snapshot cadence,
hit-claim forwarding under delay, and respawn timing would pin the behaviours
item #1 changes — build it *before* touching the netcode.

### 11. Burst-tail audio grammar

Their guns schedule the long "natural return" tail ~90 ms after each report,
and every subsequent automatic round **replaces the pending tail timer** — so
only the last shot of a burst blooms, and the sim passes `mag === 0` so a final
round always gets the full tail. Cheap, and it's a large part of why bursts
read as one musical phrase instead of N overlapping samples. Our
`src/audio/weapons.js` layers per-shot; the replace-the-timer trick is directly
portable.

### 12. Random gamer tags

100 adjectives × 100 nouns, capped to the wire name length
(`src/ui/gamerNames.ts`). Trivial, and a better default than an empty name
field in the lobby. Ours would live in `src/match/ui.js`.

### 13. Doors and destructible glass (deterministic, sim-owned)

Their doors (`src/sim/doors.ts`) and glass (116 independently damageable window
lites, damage bytes owned by the sim, deterministic crack patterns,
pass-through hitscan, the pane's player-blocker released only when it falls
out) are both **integer-tick, replay-safe state machines** — presentation reads
state, never consumes events. Wilmot's manor and The Fisher's are full of
windows that today eat bullets. Their design note is the important part:
*anything solid a player can't destroy or open is an invisible wall waiting to
be reported.* Medium effort each; glass first (no new input path — we already
have per-surface `penDepth` for glass, it just never breaks).

### 14. Contract tests for the wire

Beyond the version pin: their `protocol.test.ts` asserts **headroom** (weapon
id fits u8 with 32 slots spare), and their balance tests pin *both halves* of
every trade-off (the HK416's TTK advantage AND its handling penalty), so a
buff can't silently delete a weakness. Our `balance.selftest.mjs` already pins
the shots-to-kill matrix; extending the same discipline to `server/` message
shapes (required fields, clamps, name truncation) is cheap insurance for
item #1's protocol changes.

### 15. An improvement backlog file

Their `docs/07-improvement-backlog.md` is a working document: every entry is
dated, states what was measured, what the proposed fix is, the risk, and —
when deferred — *why* ("a version bump buys half a feature"). Our closest
equivalent is scattered across README notes. A `BACKLOG.md` in that style
(this report's Tier 1 items are the seed content) would give future sessions
the same context their docs gave this one.

---

## What we deliberately should NOT port

- **The sketch renderer, page erasure, paper physics** — their entire visual
  identity. Ours is photoreal; nothing transfers, and their own docs warn the
  style inverts if pushed toward realism ("darkness is not available").
- **Rapier** — violates our no-runtime-dependency rule, and our from-scratch
  physics (BVH, swept capsule, CCD rigid bodies, PBD ragdolls) is *more*
  capable than their cosmetic-only Rapier island. They'd trade for ours.
- **BSP map porting** — brilliant tooling (SHA-256 hash gates on port outputs,
  probe-never-author dressing doctrine), but built for resurrecting GoldSrc
  maps under a sketch aesthetic. Our maps are authored in code and our
  descriptor contract + headless map selftests already cover the same ground.
- **TypeScript migration / vitest** — their stack, not a feature. Our
  hand-rolled selftest culture covers the same ground and AGENTS.md codifies
  the current conventions.
- **Movement presets (Quake "Hopper" mode etc.)** — cute, but our movement
  identity is MW-calibrated and singular; presets would fork feel-tuning.

And for balance, things **we** have that they list as debt or lack entirely:
projectile ballistics with drag/gravity (they're hitscan), wall penetration
(they have none), combat AI (they explicitly have none), audio propagation
delay + raycast occlusion + procedural IR reverb, adaptive quality tiers, the
spawn director, prone/lean/slide/mantle/tacsprint, and a capture/goal pipeline
they'd recognise as a sibling of their own.

## Suggested order

| # | Item | Size | Payoff |
|---|------|------|--------|
| 7 | Pointer-lock hardening (`unadjustedMovement`, keyboard lock) | S | every mouse user, immediately |
| 4 | Live-spread crosshair | S | gunplay legibility |
| 1.1–1.2 | Protocol version + replicate weapon/grenades/stance | S/M | MP correctness |
| 2 | Frag cap, timer, end screen, spawn protection | M | the game becomes winnable |
| 3 | Melee | M | closes the 2 m gap |
| 8 | Killfeed/scoreboard unification | S | UI coherence |
| 10 | Latency jig selftest | M | safety net for the rest |
| 1.3–1.4 | Relay sanity + victim-side rewind | M/L | anti-cheat floor |
| 6 | Shotgun + pellet support | M | roster depth |
| 2b | TDM | L | second mode |
| 9 | Loadout selection | M | scales the roster |
| 13 | Glass, then doors | L | world responsiveness |

Sources: full-codebase sweeps of both repos, 2026-07-28. Hard Lines explored at
its single squashed commit "Refine tonal ladder and enhance line hierarchy in
rendering"; WORKMELT at `763ac9d`.
