# Screens

Every non-gameplay screen WORKMELT requires: what each one needs, what it shows,
and the states it can be in. The in-world HUD (crosshair, ammo, health,
killfeed, minimap, compass, damage, hitmarkers, prompts) is out of scope.

| Screen | Module | Present when |
| --- | --- | --- |
| Start screen (lobby) | `src/match/ui.js` | before deploy, and after leaving a match |
| Countdown | `src/match/ui.js` | the room's match is starting |
| Pause / settings | `src/ui/menu.js` | `Esc`, the lobby gear, or lost pointer lock |
| Multiplayer overlay | `src/net/ui.js` | during a live match |

---

## 1. Start screen (lobby)

The screen the game opens on. The contract is one click in, one click to share:
exactly one primary action, exactly one secondary action, and at most one
optional alternative. Nothing else on the screen is a required step — every
selector has a working default.

### Requires

- The map list (id, name, description, blurb, size, floorplan) published by the
  world subsystem.
- The room code and the relay's connection state.
- The room roster: for each player an id, name, and their ready / deployed /
  warming-up flags, plus which id is this client.
- The player's own callsign, persisted between sessions.
- The garrison presets.

### Elements

- **Callsign** — editable, 20 characters, committed when the player leaves the
  field or presses `Enter`.
- **Settings** — opens the pause/settings screen over the top.
- **Map selector** — one selectable entry per map, showing its name,
  description, blurb and size. Hidden when fewer than two maps exist.
- **Garrison selector** — four options, each with a note explaining it:
  `No bots` (players only), `Light` (one patrol of 3), `Standard` (two squads
  of 3), `Heavy` (three squads of 4).
- **Primary action** — see the state table below.
- **Secondary action** — `Copy invite link`, available in every state, with a
  confirmation that it copied.
- **Alternative action** — a single optional link under the primary, shown only
  when there is another reasonable move.
- **Room panel** — the room code, a second copy control, and the roster.
- **Status line** — one sentence saying what the buttons mean right now.
- **Presence announcements** — somebody joined or left the room.
- **Key hints** — `Enter` primary, `C` copy invite, `Esc` settings.

### The map is a room-level choice

Selecting a map is a request to the relay, not a local decision. While the
relay answers and the level rebuilds, the selector and the primary action are
unavailable (`Loading…` / `Loading map`). Once anybody in the room is deployed
the relay refuses a change, and the selector says so (`Locked — the match is
already running`) rather than offering a control that does nothing.

### Primary action states

| Condition | Primary | Alternative |
| --- | --- | --- |
| level rebuilding | `Loading map` (unavailable) | — |
| relay unreachable, or alone in the room | `Play` / `Play vs N bots` | — |
| alone but already readied up | `Cancel ready` | `Warm up against N bots while you wait` |
| others present, not ready | `Ready up` | `Warm up against N bots while you wait` |
| others present, you are ready | `Cancel ready` | `Start now with the N who are ready`, when ≥2 are ready and someone is not |
| the match is already running | `Deploy now` | `Ready up for the next match` / `Cancel ready` |

The relay is never a gate on playing: a cold start, a dropped connection and a
first-ever load all still reach a match in one click.

### Roster states

Each player is in exactly one of four states: `Not ready`, `Ready`,
`Warming up` (out of the lobby against bots, but still pulled into the room's
countdown), and `In match`. A player who just arrived is highlighted briefly.

Empty roster is the normal state, not a failure — it says the invite link is
what fills it, or, when offline, that the garrison is playable right now and
co-workers can still join later.

### Status line states

- Connecting to the relay / reconnecting after a drop.
- The room is full — the count, and that a new link is needed; playing is still
  possible.
- Alone in the room: play now, or send the link and wait.
- Standing by — readied up alone; the match starts when someone joins and
  readies up.
- `x/y ready`, counting only players in the lobby. Warm-up players are excluded
  from the denominator (they have no ready flag to give) but are called out
  separately, because the countdown pulls them in.
- The match is already running: drop in, or ready up for the next one.
- Readied up for the next match: it starts when this one empties out.

---

## 2. Countdown

Replaces the lobby's body while the room's match starts.

### Requires

The seconds remaining, and the reason for the countdown.

### Elements

The remaining count (`GO` at zero), a label (`Match starting`) and a sub-line
(`Deploying to the floor`).

A late arrival joins the countdown rather than the match in progress.

---

## 3. Pause / settings

Opened with `Esc`, the lobby's settings control, or by clicking the scrim's
dismiss target. While it is open it owns the mouse outright; closing hands
gameplay input back only if the game had it on arrival, so opening settings
from the lobby does not start capturing input.

### Requires

- The quality preset and every advanced graphics option, with its current value
  and whether it can be applied without a restart.
- Mouse sensitivity, field of view, invert-Y, ADS mode and the ADS key bind.
- Whether a room exists, and whether a match is live.

### Elements

- **General** — quality preset, mouse sensitivity, field of view, invert-Y,
  ADS mode (hold vs toggle — the trackpad escape hatch) and the ADS key rebind.
- **Advanced graphics** — one section per group: `Display`,
  `Textures & Detail`, `Shading & Lighting`, `Post-Processing`, `Visibility`.
  These are generated from the option table in `src/core/graphics.js`, so a new
  setting is a row in that table and no change to the screen.
- **Resume** — reads `Back to lobby` when there is no live match.
- **Apply** — present only while a restart-only setting is waiting.
- **Reset** — clears every override and reloads.
- **Copy link** — present only when a room exists.
- **Leave match** — present only in a live match.

### Setting states

A setting the renderer can take mid-frame applies immediately; a slider is
previewed live and persisted when released. A setting that cannot be applied
mid-frame is persisted immediately, marked `RESTART` on its own row, and takes
effect when the player chooses `Apply`. The page is never reloaded under a
player who is still reading the screen.

### Click-to-resume

A separate prompt, shown only while the menu is closed and the browser has not
yet returned pointer lock: `Click to resume`, plus the `Esc` hint. It exists
because browsers refuse a lock request for about a second after a user-initiated
`Escape`, and re-opening the menu unasked is worse than a prompt.

---

## 4. Multiplayer overlay (in match, non-HUD)

Accepts input only when the cursor is free.

### Requires

The room code, the relay's connection state, the player count, the callsign, and
the scoreboard rows (name, kills, deaths, and each player's livery colour).

### Elements

- **Invite bar** — connection state (offline / connecting / online), the room
  code, the player count, the callsign field, and copy invite link.
- **Notifications** — connection and kill events, transient.
- **Presence announcements** — joins and leaves, the same treatment the lobby
  uses, so the news does not move when the player crosses between screens.
- **Scoreboard** (`Tab`) — the room code, that the mode is free-for-all, and a
  row per player: operative, kills, deaths, K/D. Each row carries that player's
  livery colour; the relay guarantees no two players in a room share one.
- **Key hints** — `Tab` scoreboard, `Enter` chat, `Esc` menu.

---

## Modes that remove screens

- `?mp=0` — no relay: the room panel, the copy-link control and the room status
  entry are absent.
- `?renderGame=false` — the lobby alone, with no engine boot. This is what
  `npm run playtest:lobby-ui` drives.
- `?debug=true` — adds a developer-only map-layout picker to the lobby, offering
  five alternative presentations of the same map list. Only the shipped one is
  reachable without the flag, and a stored preference is ignored without it.
