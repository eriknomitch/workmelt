# Multiplayer

Workmelt now has web multiplayer: a room-based free-for-all you invite
friends to with a link. No accounts, no matchmaking — open the game, copy the
URL, send it to a friend, and you're in the same match.

```bash
npm install
npm run dev:mp        # runs the client (:5273) + relay (:8787) together
# open http://localhost:5273 — a ?room=CODE is added to the URL automatically
# copy the invite link (top bar) and open it in another tab or send it to a friend
```

## How to play together

- Every load joins a room and opens on the **lobby** — the game no longer drops
  you into a live firefight on the first frame. If the URL has no `?room=`, one
  is generated and written into the address bar, so **the current URL is always
  a valid invite link**.
- The **Copy invite link** button copies that URL (on platforms with a native
  share sheet it opens that instead). One click, from any lobby state.
- Anyone who opens the link joins the same room. Up to 12 players per room.
- **Tab** shows the scoreboard (kills / deaths / K-D). Edit your callsign in the
  lobby's top-bar field or the in-match bar; it's remembered per browser.

Controls are the same as single-player (WASD, mouse, LMB fire, RMB or X ADS, R
reload, Shift sprint, Ctrl crouch, Space jump), including the trackpad-friendly
**Aim (ADS)** and **ADS Key** settings in the pause menu.

### Starting a match

The lobby has **one primary button**, and its meaning follows the room — so
getting in is always a single click and never a choice between two panels:

| room state | the button says | what happens |
|---|---|---|
| you are alone | **Play** (vs N bots) | you deploy immediately against the garrison size selected above it; no waiting on anyone. This is a **warm-up** — see below |
| somebody else is here | **Ready up** | when everyone in the lobby is ready the relay fires one start signal, every client counts 3–2–1, and the match begins for all of them at once. **No bots in this mode — it is players only.** |
| you are already ready | **Cancel ready** | the only thing left to undo |
| the match is running | **Deploy now** | drop into it; nobody already shooting has to wait for you |

`Enter` presses that button and `C` copies the invite link, so the lobby is also
two keystrokes. Under it sits one optional link, which follows the same rule — it
is always the *other* reasonable move, and never a required one:

| when | the link says | what it does |
|---|---|---|
| you are waiting on people | **Warm up against N bots while you wait** | starts a warm-up; the room's countdown pulls you out of it |
| you are ready and somebody who joined has wandered off | **Start now with the N who are ready** | starts without them; they keep "deploy now" |
| the room's match is running and you have stepped back to the lobby | **Ready up for the next match** | arms a rematch, and the players still in the match are told somebody is waiting |

Above the buttons sit the two choices that both have working defaults, so
changing either is optional and neither is ever a step:

- **Map** — in a room the map belongs to the *room*: the choice goes to the relay
  and everybody switches together, and the cards lock while the level rebuilds.
  Once the room's match is running the level is settled and the cards say so.
- **Garrison** — none / light (3) / standard (6) / heavy (12).

The garrison is per-client, spawned at the moment you deploy, so a players-only
match really is empty of AI. A player who arrives after the match has started
sees "match in progress" and a **Deploy now** button instead of the ready flow —
nobody already shooting has to wait for them.

### A warm-up is not a match

Pressing **Play** while you are alone in a room is not a commitment to a match
that everybody else then has to join. It is a **warm-up**: a private bot game to
pass the time in a room you have just sent a link for.

- The relay keeps it **private in both directions**. A warm-up player is in
  nobody's world and nobody is in theirs: no snapshots, no tracers, no hits, and
  a bot killing them does not touch the room's killfeed or scoreboard. Room
  traffic — the lobby, chat, the roster, join toasts — still reaches them.
- It does **not make the room live**, so whoever follows the invite link still
  gets the ready flow, and the map is still the room's to choose.
- When the start signal fires, **the warm-up players are pulled into it**. They
  get the same 3–2–1, their garrison is torn down, and they deploy with everyone
  else. Their ready flag was never needed: they cannot see the lobby to press the
  button, and pressing Play was never a request to be left out.

That last point is the shape of the whole fix. Before it, one player pressing the
lobby's own primary button locked the room into "match in progress" for good —
everyone who followed the link was offered a **Deploy now** into a match whose
bots only the first player could see, the map was frozen, and the only route back
to a real shared start was for **every single player to leave their match by hand
and then all ready up**.

### Getting three people into one match

The ready condition is "everybody **who can see the lobby** has readied up",
which is not the same as "everybody has readied up". Three consequences, each of
them the party flow working:

- **Warm-ups do not gate the start.** One ready player plus one player shooting
  bots is enough — see above.
- **A late arrival joins the countdown, not the match.** "Sure" and "yep" land
  seconds apart, so a player who joins while the 3–2–1 is running is swept into
  it and the clock is reset to a full countdown so the party lands together.
  Bounded by `MAX_START_MS` (3× the countdown by default), or somebody
  reload-looping the page could hold a start open forever.
- **One idle player cannot block the room.** Somebody who joins and wanders off
  used to stall a room of ready players indefinitely. Any ready player can now
  **start now with the N who are ready**; the rest are left with a live room and
  the lobby's "deploy now".

### Between matches

A match has no scripted end — it runs until people leave it (pause menu → **Leave
match**), and the room survives that, so the invite link never changes.

Coming back to the lobby while others were still playing used to be a dead end:
the room was live, so the map was frozen and there was nothing to press but
**Deploy now**. Now the link under it is **Ready up for the next match**, which

- arms your ready flag. It cannot start anything while the room is live, so
  nothing is ever yanked out from under the players still in the firefight; and
- tells them: every client still in the match toasts *"Alpha is up for another
  match — Esc → Leave match to join them"*.

As the last of them leaves, the room stops being live, the map unlocks, and the
relay starts the rematch as soon as the ready set completes.

**Every deploy is a fresh loadout.** Health already reset on spawn and equipment
was already restocked; ammunition was not, and there are no ammo pickups in this
game by design — so magazines and reserves were handed out once at boot and
depleted for the rest of the session. Two matches in, the AX-7's 25-round reserve
was gone for good. `weapons.resetLoadout()` now runs on every `player:spawn`,
which covers a respawn, a deploy and a new match alike
(`src/weapons/loadout.selftest.mjs`).

### The room's map

The relay stores one map slug per room and hands it back on `welcome` and every
`lobby` frame. It does not know what maps exist — clients validate the slug
against their own list and ignore one they do not recognise — but it does own
that there is a single answer, so two players cannot ready up on different
levels. The first player into a room sets it; after that any player can change
it while the room's match has not started, and doing so clears the *other*
players' ready flags (you readied up for a level, and it is not that level any
more). The chooser keeps theirs — they are the one player in the room who has
just said what they want to play, and making them press the button they only just
pressed is the kind of round trip that turns a party into a negotiation.

A change is refused once the room is live. A warm-up does not make it live, so
the map can still move under one: that client steps back to the lobby and
rebuilds rather than keep shooting bots on a level the room has left.

Ready state, the "is this room live" flag and the start signal live on the relay
(`maybeStart()` in `server/index.mjs`, mirrored in `worker/room.js`), because two
clients cannot each decide on their own when "everyone is ready" became true.

The lobby has its own synthesized cues, like everything else in the game: a
rising two-note chirp when somebody joins, a mechanical click on ready, a tick
per countdown second, and a low horn on deployment (`uiSound()` in
`src/audio/foley.js`).

## Architecture

Two pieces, one process in production.

### Relay + host — `server/index.mjs`

A small Node server (`http` + [`ws`](https://github.com/websockets/ws)) that:

- **serves the built client** from `dist/`, so the game and the netcode share an
  origin and the invite link "just works"; and
- **relays** messages between players grouped into rooms.

It is a *relay*, not an authoritative simulation. Each client owns its own
player and reports transform + events at 20 Hz; the server fans the latest state
of every player out to the room as one snapshot per tick. That keeps it cheap
(a few KB/s per player) — the right trade for a friends-only game — and the
transport is agnostic to how hits are decided, so a server-authoritative model
could be dropped in later without touching the client protocol.

Environment: `PORT` (default 8787), `TICK_HZ` (20), `MAX_ROOM` (12),
`COUNTDOWN_MS` (3000, the pre-match countdown once everyone is ready),
`MAX_START_MS` (3× the countdown, the outer edge of a start that keeps being
pushed back for late arrivals).

`server/lobby.selftest.mjs` walks all of the lobby rules above against a real
server on a real socket; `RELAY_URL=ws://127.0.0.1:8788/ws` points the same checks
at the Durable Object under `npm run cf:dev`, which is how the two stay in step.
`tools/lobby-playtest.mjs` drives the whole flow in two real browsers.

Gameplay traffic goes out through `broadcastMatch()` rather than `broadcast()`,
which is the one line that makes a warm-up private: everybody in the room hears
the lobby, the roster and chat, but only the players in the match see each
other's snapshots, tracers, hits and spawn claims.

### Client subsystem — `src/net/`

A normal engine subsystem (`id: 'net'`), added in `src/main.js` for every
non-capture run (disable with `?mp=0`). It:

- resolves the room / server / name from the URL (`src/net/config.js`);
- broadcasts the local player's transform each tick and renders every other
  player as a **reused AI soldier body** — `ai.createPuppet()` (`src/ai/puppet.js`)
  builds the exact skinned soldier the AI ships, minus the brain and physics, and
  the `net` system drives it with transforms **interpolated ~110 ms in the past**
  so movement stays smooth under jitter;
- replicates shots as muzzle flash + tracers through `fx`, and settles PvP hits
  with a **trust-the-shooter** model: the shooter ray-tests remote bodies locally
  and the victim applies the damage the shooter claims (headshots included);
- drives the overlay (`src/net/ui.js`): invite bar, live scoreboard, kill / join
  toasts, connection status; and
- carries the match-start lobby, reporting it as `net:lobby` / `net:countdown` /
  `net:join` / `net:leave` events. The screen that renders it, the bot choice and
  the countdown belong to the separate `match` subsystem (`src/match/`), which
  also decides when `ai.populate()` runs.

`net` reads `player`/`weapons` state and feeds `ai`/`fx`/`ui` entirely through
`ctx`, so nothing else in the engine needs to know multiplayer exists.

### Protocol (JSON over WebSocket)

| dir | message | meaning |
|---|---|---|
| C→S | `join {room, name}` | enter a room |
| C→S | `map {map}` | change the room's level (refused once the room is live; clears everybody else's ready flag) |
| C→S | `ready {ready, force}` | toggle my match-start ready flag. `force` starts with the ready set instead of waiting on the whole lobby |
| C→S | `deploy {solo}` | I am out of the lobby. `solo` marks a **warm-up** — a private bot game that does not make the room live |
| C→S | `undeploy` | I went back to the lobby (pause menu → Leave match); clears my `deployed` flag so the room stops being LIVE |
| C→S | `state {s:{p,y,pt,sp,cr,ad,hp,dead,v,sk}}` | transform snapshot (20 Hz). `v` is my body variant, `sk` my relay-assigned colour slot echoed back |
| C→S | `fire {o,d,w,seed}` | a shot (origin, dir) |
| C→S | `hit {target,dmg,part,o,w}` | shooter's damage claim |
| C→S | `kill {by,headshot}` | victim confirms its own death |
| C→S | `spawn {p}` | "I am coming in here" — a spawn claim, relayed to the room |
| C→S | `name` / `chat` / `respawn` / `ping` | misc |
| S→C | `welcome {id,room,skin,live,map,startIn,peers}` | you joined; who's here; which level; is the match already live. `startIn` is non-zero when you walked into a countdown. `skin` is your colour slot — see below |
| S→C | `peer_join {id,name,skin}` / `peer_leave {id}` | roster changes |
| S→C | `lobby {live,players,map}` | match-start lobby: `[{id,name,ready,deployed,warm}]`, plus the room's level |
| S→C | `match_start {in,ids}` | count down `in` ms and deploy — if you are in `ids`. Absent `ids` (an older relay) means everybody |
| S→C | `snapshot {states:[…]}` | everyone's latest transform |
| S→C | `spawn {id,p}` | somebody else claimed that ground to spawn on |
| S→C | `fire` / `hit` / `kill` / `score` / `chat` | relayed events + scoreboard |

### Colour is assigned by the relay

Every player wears a **livery** — one saturated hue that is how you tell who is
who at 30 m (`src/ai/livery.js`). Two players in one room may never share one,
and that is a property no client can guarantee on its own: two clients each
picking "the lowest slot I have not seen" race on a simultaneous join and pick
the same. So the relay owns it, because it is the one process that sees the
whole room at once.

- On `join` the relay assigns the **lowest colour slot nobody in the room is
  wearing** (`takeSkin` in `server/index.mjs`, `_takeSkin` in `worker/room.js`)
  and returns it as `welcome.skin`. Lowest-free rather than a counter, so a
  leaver's colour is reused and a long-lived room never walks off the end of the
  palette. `MAX_ROOM` is 12 and so is the curated palette, so a full room is
  always covered.
- The slot rides `peer_join.skin` and each `roster` entry's `skin`, and each
  client also echoes its own back in every state blob as `sk`. The echo is the
  belt-and-braces path: a puppet is built from the first snapshot that carries a
  peer, and a snapshot can beat the roster in.
- `net` hands the slot to `ai.createPuppet(..., { livery })`, and
  `puppet.setLivery()` recolours a body already in the scene if the slot lands
  late. Recolouring swaps a material array — same geometry, same compiled
  program — so it cannot stall.
- Bots never draw from the player range: `ai.takeLivery()` allocates from
  `BOT_SLOT` upward. A garrison can therefore not wear a colour a player is
  identified by.

An older relay that does not send `skin` still works: the client falls back to
its socket id, so colours may collide but nothing breaks.

## Spawning

Nobody in a Workmelt match — player, remote player or bot — gets a random
spawn point. `src/world/spawns.js` holds ~45 authored points grouped into
zones and scores every one of them against the live state of the room before
handing one out: a hard no-spawn bubble around every enemy, no line of sight,
a penalty for standing in somebody's view cone, and a memory of recent deaths,
recently-used points and the man who just killed you. Read the header of that
file for the full model.

Two parts of it exist only because this is multiplayer:

- **Per-client tie-breaking.** The director draws no random numbers at all (a
  spawn must not perturb any other subsystem's stream), so ties are broken by a
  salt. `net` sets it to the peer id the relay assigned — the only value
  guaranteed distinct inside a room — so two clients scoring the same map
  cannot arrive at the same answer.
- **Spawn claims.** Each client scores against the peer positions it already
  receives at 20 Hz, but two respawn timers can expire on the same tick, before
  either player exists at his new position. So a client announces its pick
  (`spawn {p}`) and the relay fans it out; everyone else treats that ground as
  reserved for 2.5 s. Advisory, like every other gameplay claim on this relay.

Bots go through the same director: a garrison's squad anchors are scored
against the player exactly as a respawn is (so a squad can never appear inside
the player's bubble or in his line of sight), anchors repel each other, and
reinforcements come back in near their surviving squadmates. `ai.populate({…,
respawn: true})` — the default — keeps the garrison at strength as it is
killed, retiring each body once its ragdoll has settled.

## Deploying so friends can join over the internet

### Cloudflare (recommended — one command, free plan) ⭐

Cloudflare hosts the whole thing at the edge: the static client on Workers'
Static Assets, and the relay as a **Durable Object per room** (`worker/`). Same
origin, global, free `*.workers.dev` URL (or your own domain), no servers to keep
alive. See [CLOUDFLARE.md](CLOUDFLARE.md) for the 3-minute version.

```bash
npm install
npx wrangler login          # once
npm run cf:deploy           # = npm run build && wrangler deploy
```

That prints a URL like `https://workmelt.<you>.workers.dev`. Open it, copy
the invite link, done. Local edge test: `npm run cf:dev` (runs the Worker + DO in
workerd on :8788).

How it works: `worker/index.js` routes `/ws?room=CODE` to the Room Durable Object
named `CODE` (so everyone in a room shares one instance) and serves everything
else from `./dist`. `worker/room.js` is the same relay as the Node server, ported
to a DO. `wrangler.toml` wires the assets binding and the DO migration
(`new_sqlite_classes`, which is what makes it free-plan eligible).

### Node hosts (Render / Fly / Railway / a box)

The Node server (`server/index.mjs`) hosts the client and the WebSocket on **one
port**, so anything that runs Node + WebSockets works. Build first
(`npm run build`), then `node server/index.mjs`. `npm run serve` does both.

- **Render** — `render.yaml` blueprint included. New + → Blueprint → point at the
  repo. WebSockets work on the same port; free tier is fine for a few friends.
- **Fly.io** — `fly.toml` + `Dockerfile` included. `fly launch --copy-config --now`.
- **Railway / any Docker host** — the `Dockerfile` builds and runs everything;
  set nothing but let the platform inject `PORT`.
- **A single box** — `npm run serve` and share `http://<your-ip>:8787`.

The client picks its server automatically: same-origin `wss://…/ws` in a
production build (works for both Cloudflare and Node hosts), `ws://<host>:8787/ws`
in dev. Override with `?server=wss://…` if you host the relay separately from the
static client. The room is also sent as `?room=CODE` on the socket URL so
Cloudflare can route to the right Durable Object before the first message.

## Tuning / flags

| URL param | effect |
|---|---|
| `?room=CODE` | join a specific room (auto-generated if absent) |
| `?name=NAME` | set your callsign |
| `?server=wss://…` | point at a specific relay |
| `?mp=0` | disable multiplayer (pure single-player; the lobby drops the room panel and the invite button) |
| `?match=0` | skip the lobby — boot straight into a live match with the default garrison, as the game used to. Used by `tools/playtest.mjs` and the benchmark harnesses |
| `?q=low\|medium\|high\|ultra` | graphics preset |
