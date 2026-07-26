# Host Claude of Duty on Cloudflare

Everything you need is already in the repo. Cloudflare runs the whole game —
static client **and** multiplayer relay — from one Worker, on the **free plan**,
with a public URL you can share immediately.

## What gets deployed

| piece | file | role |
|---|---|---|
| Worker | `worker/index.js` | serves the built client and routes `/ws` to rooms |
| Room (Durable Object) | `worker/room.js` | one instance per room; holds the players' sockets and relays state |
| config | `wrangler.toml` | assets binding + Durable Object migration + vars |
| client | `dist/` | produced by `npm run build` |

Each room is a Durable Object addressed by its code, so everyone who opens the
same invite link lands on the same instance. Nothing is stored — a room is
ephemeral. The DO is declared as a **SQLite class**, which is what makes it
eligible for the free Workers plan.

## Deploy (about 3 minutes)

Prerequisites: a free [Cloudflare account](https://dash.cloudflare.com/sign-up)
and Node 18+.

```bash
npm install
npx wrangler login          # opens a browser to authorize (one time)
npm run cf:deploy           # builds the client, then `wrangler deploy`
```

Wrangler prints a URL like:

```
https://claude-of-duty.<your-subdomain>.workers.dev
```

Open it — a `?room=CODE` is added automatically. Click **Copy invite link** and
send it to a friend. That's it; they join your match.

> First deploy on a brand-new account: if you haven't enabled your
> `workers.dev` subdomain yet, the dashboard prompts you once — accept it and
> re-run `npm run cf:deploy`.

## Test it at the edge first (optional)

```bash
npm run cf:dev              # runs the Worker + Durable Object locally (workerd) on :8788
```

Open <http://127.0.0.1:8788>, copy the invite link, open it in a second tab.
This is the same runtime Cloudflare uses, so if it works here it works deployed.

## Custom domain

In the Cloudflare dashboard: **Workers & Pages → claude-of-duty → Settings →
Domains & Routes → Add** your domain (it must be on Cloudflare). The client is
origin-relative, so the invite links switch to your domain automatically — no
code change.

## Tuning

`wrangler.toml` `[vars]`:

- `TICK_HZ` — snapshot broadcast rate (default `20`).
- `MAX_ROOM` — players per room (default `12`).

Change and re-run `npm run cf:deploy`.

## Notes / limits

- **WebSockets + Durable Objects** are included on the free plan (with generous
  limits — plenty for friends). Heavy sustained use may need the paid Workers
  plan; the dashboard will tell you.
- The client connects to `wss://<same-host>/ws?room=CODE`. Because the Worker
  serves the client too, that's always the right origin — nothing to configure.
- Prefer a Node host instead? `server/index.mjs` + `render.yaml` / `fly.toml` /
  `Dockerfile` are all still here. See [MULTIPLAYER.md](MULTIPLAYER.md).
