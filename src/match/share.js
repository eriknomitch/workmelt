/**
 * SHARE — the end-of-match result as a pasteable emoji card.
 *
 * The ceremony offers a "Share your result" block: a few lines of plain text
 * that survive any chat client — Slack, iMessage, Discord, a work Teams thread
 * — and open on the site's address, so the paste is also the invite:
 *
 *   workmelt.com
 *   🏆 1st · K/D 15-6
 *   🎯🎯💀🎯🎯🎯🎯💀🎯🎯
 *   🎯💀🎯🎯🎯🎯💀🎯🎯🎯
 *
 * Modelled on the daily-puzzle share (catfishing.net, Wordle): the address
 * first, because the first line is what a notification preview shows and it
 * says what the paste IS; one short result line; then the grid. The grid is
 * the match as it happened, one cell per event in order — a kill or a death.
 * Two marks only: the scoreline says who won, the strip says HOW (the early
 * collapse, the run of ten at the end), and two marks read without a legend.
 *
 * Pure and DOM-free — `MatchTimeline` records, `shareText` formats — so the
 * contract is checkable in Node: see ./share.selftest.mjs. The clipboard and
 * the Web Share sheet live with the ceremony in ./ui.js.
 */

/**
 * Printed bare, not as `https://…`: every chat client this is pasted into
 * auto-links a bare domain, and the bare form is the one people read.
 */
export const SHARE_URL = 'workmelt.com';

/** One cell per event. Picked to stay distinct at emoji size on every OS. */
export const MARKS = { kill: '🎯', death: '💀' };

/** Cells per line — about what a phone-width chat bubble fits without wrapping. */
export const ROW = 10;
/**
 * Past this the strip is cut and the remainder counted, so a paste stays a
 * paste. Unlike a daily puzzle the grid is not a fixed size: a clean 15-kill
 * win is ~20 cells, a rough match can run past 40.
 */
export const MAX_CELLS = 30;

/**
 * The badge in front of the result. 🫠 for everything below the podium is
 * the brand's own joke — you melted.
 */
const BADGES = { win: '🏆', draw: '🤝', 2: '🥈', 3: '🥉', loss: '🫠' };

/** Event codes in the timeline. Single characters keep a long match cheap. */
const KILL = 'k';
const DEATH = 'd';

/**
 * The local player's match, event by event. Bounded: nothing in a capped,
 * five-minute match comes near the limit, and a runaway source cannot grow it.
 */
export class MatchTimeline {
  constructor(limit = 256) {
    this.limit = limit;
    /** 'k' | 'd' in the order they happened. */
    this.events = [];
  }

  reset() {
    this.events.length = 0;
  }

  kill() {
    if (this.events.length < this.limit) this.events.push(KILL);
  }

  death() {
    if (this.events.length < this.limit) this.events.push(DEATH);
  }

  get kills() {
    let n = 0;
    for (const e of this.events) if (e === KILL) n++;
    return n;
  }

  get deaths() {
    let n = 0;
    for (const e of this.events) if (e === DEATH) n++;
    return n;
  }
}

/**
 * A room match's result from one player's seat, out of the relay's
 * `match_end`. The standings arrive sorted (kills, then fewer deaths), so the
 * placing is the row index. With no winner the match was a dead heat on time:
 * a player level with the top row drew it, everybody under them lost it.
 *
 * @param {object} m { standings: [{ id, kills, deaths }], winner, myId }
 * @returns {{ outcome, place, of, kills, deaths }} or null when we are not in
 *   the standings (we were never in that match)
 */
export function roomResult({ standings = [], winner = null, myId = null } = {}) {
  const i = standings.findIndex((r) => r.id === myId);
  if (i < 0) return null;
  const me = standings[i];
  const top = standings[0];
  let outcome = 'loss';
  if (winner != null && winner === myId) outcome = 'win';
  else if (winner == null && me.kills === top.kills && me.deaths === top.deaths) outcome = 'draw';
  // Level rows share a placing: two players tied for first are both 1st.
  let place = i + 1;
  while (place > 1) {
    const above = standings[place - 2];
    if (above.kills !== me.kills || above.deaths !== me.deaths) break;
    place--;
  }
  return { outcome, place, of: standings.length, kills: me.kills ?? 0, deaths: me.deaths ?? 0 };
}

/** 1 -> '1st', 2 -> '2nd', 11 -> '11th', 22 -> '22nd'. */
export function ordinal(n) {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suf}`;
}

/**
 * The emoji strip, `ROW` cells to a line. Over `MAX_CELLS` the last line
 * ends on a count of what was cut — an honest "+12" rather than a silent
 * truncation that makes a long match look short.
 *
 * Emoji are counted as cells, not UTF-16 units, so a line never splits one.
 *
 * @param {string[]} events 'k' | 'd'
 * @returns {string[]} one string per line; empty for an empty match
 */
export function timelineRows(events = []) {
  const cells = [];
  for (const e of events) cells.push(e === DEATH ? MARKS.death : MARKS.kill);
  let more = 0;
  if (cells.length > MAX_CELLS) {
    more = cells.length - MAX_CELLS;
    cells.length = MAX_CELLS;
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += ROW) rows.push(cells.slice(i, i + ROW).join(''));
  if (more) rows[rows.length - 1] += ` +${more}`;
  return rows;
}

/**
 * The shareable text.
 *
 * The result line is a badge and a placing in a room ('🏆 1st', '🥈 2nd',
 * '🫠 4th') — the people it is sent to were usually in that room, so "of N"
 * is noise. Against bots a placing means nothing, so it is the verdict
 * instead ('🏆 Victory', '🫠 Defeat'). A dead heat is '🤝 Draw' either way.
 *
 * @param {object} r
 *   outcome   'win' | 'loss' | 'draw' — from the local player's side
 *   place     1-based finishing position in a room match; null for bots
 *   kills     final kills (the referee's figure, not the timeline's)
 *   deaths    final deaths
 *   events    the timeline's events, oldest first
 *   url       what the first line links to (default `SHARE_URL`)
 * @returns {string} newline-joined, no trailing newline
 */
export function shareText({ outcome = 'draw', place = null, kills = 0, deaths = 0, events = [], url = SHARE_URL } = {}) {
  let result;
  if (outcome === 'draw') result = `${BADGES.draw} Draw`;
  else if (place != null) result = `${outcome === 'win' ? BADGES.win : BADGES[place] ?? BADGES.loss} ${ordinal(place)}`;
  else result = outcome === 'win' ? `${BADGES.win} Victory` : `${BADGES.loss} Defeat`;
  return [url, `${result} · K/D ${kills | 0}-${deaths | 0}`, ...timelineRows(events)].join('\n');
}
