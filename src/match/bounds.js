/**
 * The bounded-match contract, client side.
 *
 * Every WORKMELT match is a bounded free-for-all: first to `SCORE_LIMIT` kills
 * wins outright, and `MATCH_MS` is the time cap — when it expires the leader
 * wins on time. The defaults are sized for a quick match during a work break:
 * fifteen kills is a few minutes of honest shooting in a small room, and five
 * minutes ends it even when everybody is hiding.
 *
 * Who enforces it depends on who owns the score:
 *
 *   ROOM MATCH   the relay counts the kills, so the relay ends the match —
 *                SCORE_LIMIT / MATCH_MS in server/index.mjs (mirrored in
 *                worker/room.js) are the authoritative copy of these numbers,
 *                and `match_end` arrives on the wire. These constants then only
 *                paint the HUD until the relay's own figures land.
 *   BOTS MATCH   nothing but this client can see it, so this module scores it:
 *                the player against the garrison as one opponent. Your kills
 *                against their kills (= your deaths), same limit both ways, so
 *                a bots match can be lost exactly as honestly as it is won.
 *
 * Pure and clock-free — every method takes `now` (ms, any monotonic clock) —
 * so the whole contract is checkable in Node: see ./bounds.selftest.mjs.
 */

export const SCORE_LIMIT = 15;
export const MATCH_MS = 5 * 60_000;

/**
 * Scorekeeper for a match against the garrison.
 *
 *   const tally = new BotMatchTally({ now: performance.now() });
 *   tally.noteKill(now)   -> 'score' when your kills reach the limit
 *   tally.noteDeath(now)  -> 'score' when the garrison's do
 *   tally.checkTime(now)  -> 'time' once the cap expires
 *
 * After any of those returns non-null the tally is OVER and refuses further
 * scoring — a ragdoll settling after the horn must not turn a win into a draw.
 */
export class BotMatchTally {
  constructor({ limit = SCORE_LIMIT, ms = MATCH_MS, now = 0 } = {}) {
    this.limit = Math.max(1, limit);
    this.ms = Math.max(1, ms);
    this.startedAt = now;
    this.endsAt = now + this.ms;
    this.kills = 0;
    this.deaths = 0;
    this.over = false;
  }

  /** ms left on the clock, never negative. */
  remaining(now) {
    return Math.max(0, this.endsAt - now);
  }

  noteKill() {
    if (this.over) return null;
    this.kills++;
    if (this.kills >= this.limit) {
      this.over = true;
      return 'score';
    }
    return null;
  }

  noteDeath() {
    if (this.over) return null;
    this.deaths++;
    if (this.deaths >= this.limit) {
      this.over = true;
      return 'score';
    }
    return null;
  }

  checkTime(now) {
    if (this.over || now < this.endsAt) return null;
    this.over = true;
    return 'time';
  }

  /**
   * The match's outcome, from the player's side of the scoreline.
   * 'you' | 'garrison' | null (a dead heat on time is a draw).
   */
  winner() {
    if (this.kills !== this.deaths) return this.kills > this.deaths ? 'you' : 'garrison';
    return null;
  }
}
