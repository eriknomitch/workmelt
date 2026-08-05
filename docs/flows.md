# Flows

How a player gets from opening the URL into a shared match. Companion to
[`screens.md`](./screens.md), which describes what each screen requires and
shows; this file describes the transitions between them.

There is no host. Every load joins a room — if the URL carries no `?room=`, one
is generated and written into the address bar, so **the current URL is always a
valid invite link**. "Hosting" is just being the first player in a room; the
only asymmetry is that whoever arrives first sets the room's map.

---

## 1. Entry — hosting and joining are the same path

```mermaid
flowchart TD
  open([Open the game URL]) --> hasRoom{URL carries<br/>a room code?}

  hasRoom -->|no| gen[Generate a room code<br/>and write it into the URL]
  hasRoom -->|yes| use[Use that room code]

  gen --> connect
  use --> connect

  connect[Connect to the relay] --> outcome{Connection<br/>outcome}

  outcome -->|connected| lobby[Lobby]
  outcome -->|room is full| fullMsg[Lobby: room is full,<br/>ask for a new link]
  outcome -->|relay unreachable| offline[Lobby: connecting / reconnecting]

  fullMsg --> lobby
  offline --> lobby

  lobby --> alone{Anyone else<br/>in the room?}
  alone -->|no| solo[Primary action is Play]
  alone -->|yes| ready[Primary action is Ready up]

  solo --> share[Copy invite link and send it]
  share --> ready
```

The relay is never a gate on playing: a room-full result, a dropped connection
and a first-ever cold load all still reach the lobby with a working primary
action.

---

## 2. The lobby's primary action

One button. Its meaning is whatever the room currently makes it, so getting in
is always a single click.

```mermaid
stateDiagram-v2
  [*] --> Loading

  Loading: Level rebuilding
  Loading --> Solo: level ready

  state "Alone in the room" as Solo
  state "Alone, readied up" as SoloReady
  state "Others present, not ready" as Waiting
  state "Others present, you are ready" as Ready
  state "Room's match is live" as Live

  Solo --> Warmup: Play (vs N bots)
  Solo --> Waiting: somebody joins
  Solo --> SoloReady: readied up via the alt link

  SoloReady --> Solo: Cancel ready
  SoloReady --> Waiting: somebody joins

  Waiting --> Ready: Ready up
  Waiting --> Warmup: alt — warm up while you wait
  Waiting --> Solo: everyone else leaves

  Ready --> Waiting: Cancel ready
  Ready --> Countdown: everyone in the lobby is ready
  Ready --> Countdown: alt — start now with the N who are ready

  Live --> Match: Deploy now
  Live --> LiveReady: alt — ready up for the next match
  LiveReady --> Live: Cancel ready

  Countdown --> Match: countdown reaches zero
  Warmup --> Countdown: the room's start signal pulls you in
  Warmup --> Solo: leave the warm-up

  Match --> Live: leave match (others still playing)
  Match --> Solo: leave match (room now empty)

  note right of Live
    A late arrival lands here and is
    offered Deploy now instead of
    the ready flow.
  end note
```

The ready condition is "everybody **who can see the lobby** has readied up" —
which is not the same as "everybody has readied up". Warm-up players have no
ready flag to give and are excluded from the count; they are pulled into the
countdown instead.

---

## 3. Warm-up vs. the room's match

Pressing **Play** while alone is a warm-up, not a commitment that everyone else
must then join. The relay keeps it private in both directions and does not let
it make the room live.

```mermaid
sequenceDiagram
  participant A as First player
  participant R as Relay
  participant B as Player who follows the link

  A->>R: join room (code from the URL)
  R-->>A: alone in the room
  Note over A: Primary action is Play

  A->>R: start warm-up (private, vs bots)
  R-->>A: warm-up acknowledged — room stays not-live
  Note over A: In a private bot game.<br/>No snapshots, hits or scoreboard<br/>exchanged with the room.

  B->>R: join room (same code)
  R-->>B: room is not live — ready flow, not Deploy now
  R-->>A: roster update (still reaches a warm-up player)

  B->>R: ready up
  R-->>R: everyone who can see the lobby is ready

  R-->>B: start signal
  R-->>A: start signal — pulled out of the warm-up
  Note over A,B: Both count down together.<br/>A's garrison is torn down.

  A->>R: deployed
  B->>R: deployed
  Note over A,B: One shared match.
```

Without the pull-out, one player pressing Play would lock the room into "match
in progress", and everyone following the invite link would be offered a deploy
into a match whose bots only the first player could see.

---

## 4. Choosing the map

The map is the one lobby choice that is not this client's alone. In a room it
belongs to the room, so a selection is a request the relay answers.

```mermaid
sequenceDiagram
  participant P as Player
  participant R as Relay
  participant O as Everyone else in the room

  P->>P: select a map
  alt no relay connection
    P->>P: apply locally — the choice travels with the next join
  else room's match is already live
    Note over P: Selector unavailable —<br/>the level is settled
  else in a room, not yet live
    P->>R: request this map
    R-->>P: room map changed
    R-->>O: room map changed
    Note over P,O: Selector and primary action<br/>unavailable while the level rebuilds
  end
```

A remote player's choice arrives on the same path as the answer to this
client's own request, so there is one code path and no special case for "my"
change.

---

## 5. Between matches

A match has no scripted end. It runs until people leave it, and the room
survives that — so the invite link never changes.

```mermaid
flowchart TD
  match[In the match] -->|pause menu → Leave match| back[Back in the lobby]

  back --> stillLive{Others still<br/>in the match?}

  stillLive -->|yes| live[Room is live]
  stillLive -->|no| idle[Room is idle again]

  live --> deploy[Deploy now — rejoin the running match]
  live --> arm[Ready up for the next match]

  arm --> armed[Ready flag armed.<br/>Cannot start while the room is live.]
  armed --> notify[Players still in the match are told<br/>somebody is waiting for another]
  notify --> empties{Match empties out}
  empties -->|yes| countdown[Countdown for the next match]

  idle --> lobbyFlow[Ordinary lobby flow:<br/>Play, or Ready up]

  deploy --> match
  countdown --> match
  lobbyFlow --> match
```

Arming a rematch never yanks anything out from under the players still in the
firefight — the flag simply cannot start a match while the room is live.
