@AGENTS.md

## Claude Code

Deep-dive docs — read on demand, not loaded at session start:

- `DESIGN.md` — the WORKMELT brand and design system: palette, type pairing, the
  65/20/10/4/1 ratio rule, contrast floors and motion timing. Read it before
  touching the lobby, the pause/settings menu or the multiplayer overlay. The
  tokens themselves live in `src/ui/brand.js`; never hard-code a hex outside it.
- `ARCHITECTURE.md` — the engine contract. Read it in full before changing subsystem behavior, `ctx` wiring, or cross-system events.
- `MULTIPLAYER.md` — room-based FFA model, `server/` relay, and the net protocol.
- `CLOUDFLARE.md` — Worker + Durable Object deploy path for `worker/`.
- `TEXTURE-PERF.md` — where texture memory, per-pixel fetches and character draw
  calls actually go, and why a shipped texture pack is the wrong tool for it.
- `LIBRARIES.md` — what `three@0.180` already ships that we don't use, which
  platform APIs replace a dependency, and the one third-party runtime library
  worth a rule change. Read before proposing any new dependency.
