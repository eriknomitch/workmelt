# Multiplayer

Claude of Duty now has web multiplayer: a room-based free-for-all you invite
friends to with a link. No accounts, no matchmaking — open the game, copy the
URL, send it to a friend, and you're in the same match.

```bash
npm install
npm run dev:mp        # runs the client (:5173) + relay (:8787) together
# open http://localhost:5173 — a ?room=CODE is added to the URL automatically
# copy the invite link (top bar) and open it in another tab or send it to a friend
```

## How to play together

- Every load joins a room and opens on the **Match Start** screen — the game no
  longer drops you into a live firefight on the first frame. If the URL has no
  `?room=`, one is generated and written into the address bar, so **the current
  URL is always a valid invite link**.
- The **Copy invite link** button copies that URL.
- Anyone who opens the link joins the same room. Up to 12 players per room.
- **Tab** shows the scoreboard (kills / deaths / K-D). Edit your callsign in the
  top-bar field; it's remembered per browser.

Controls are the same as single-player (WASD, mouse, LMB fire, RMB ADS, R reload,
Shift sprint, Ctrl crouch, Space jump).

### Starting a match

Two ways in, side by side on the Match Start screen:

| | what happens |
|---|---|
| **Bots** | Pick a garrison size — none / light (3) / standard (6) / heavy (12) — and press start. You deploy immediately; no waiting on anyone. |
| **Multiplayer** | Share the room link. When a second player is in the room, both press **Ready**; the relay fires one start signal, both clients count 3–2–1, and the match begins for both at once. **This mode spawns no bots — it is players only.** |

The garrison is per-client, spawned at the moment you deploy, so a players-only
match really is empty of AI. A player who arrives after the match has started
sees "match in progress" and a **Deploy now** button instead of the ready flow —
nobody already shooting has to wait for them.

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
`COUNTDOWN_MS` (3000, the pre-match countdown once everyone is ready).

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
| C→S | `ready {ready}` | toggle my match-start ready flag |
| C→S | `deploy` | I am in the match now (bots start, or countdown finished) |
| C→S | `state {s:{p,y,pt,sp,cr,ad,hp,dead,v}}` | transform snapshot (20 Hz) |
| C→S | `fire {o,d,w,seed}` | a shot (origin, dir) |
| C→S | `hit {target,dmg,part,o,w}` | shooter's damage claim |
| C→S | `kill {by,headshot}` | victim confirms its own death |
| C→S | `name` / `chat` / `respawn` / `ping` | misc |
| S→C | `welcome {id,room,live,peers}` | you joined; who's here; is the match already live |
| S→C | `peer_join` / `peer_leave` | roster changes |
| S→C | `lobby {live,players}` | match-start lobby: `[{id,name,ready,deployed}]` |
| S→C | `match_start {in}` | everyone readied up — count down `in` ms and deploy |
| S→C | `snapshot {states:[…]}` | everyone's latest transform |
| S→C | `fire` / `hit` / `kill` / `score` / `chat` | relayed events + scoreboard |

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
| `?mp=0` | disable multiplayer (pure single-player; the Match Start screen keeps the bots panel only) |
| `?match=0` | skip the Match Start screen — boot straight into a live match with the default garrison, as the game used to. Used by `tools/playtest.mjs` and the benchmark harnesses |
| `?q=low\|medium\|high\|ultra` | graphics preset |
