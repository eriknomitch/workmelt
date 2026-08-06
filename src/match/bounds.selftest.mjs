#!/usr/bin/env node
/**
 * MATCH BOUNDS — the client-side half of the bounded-match contract.
 *
 *   node src/match/bounds.selftest.mjs
 *
 * The relay's half (score reset, match_end, the room un-living) is walked by
 * server/bounds.selftest.mjs against a real socket. This checks the pure tally
 * a bots match is scored with — the one match nobody else can referee — and
 * that the two halves agree on the default numbers, because a lobby that says
 * "first to 15" while the relay ends the match at some other figure is a lie
 * on the screen that announces the rules.
 */
import { readFile } from 'node:fs/promises';
import { SCORE_LIMIT, MATCH_MS, BotMatchTally } from './bounds.js';

let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(`  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) fails++;
};

console.log('defaults');
{
  ok(SCORE_LIMIT === 15, 'score limit defaults to 15 — a work-break match, not a campaign');
  ok(MATCH_MS === 5 * 60_000, 'time cap defaults to five minutes');
  // The relay owns the authoritative copy; the client paints the HUD and the
  // lobby from this one. They are separate processes with no shared import, so
  // the only way to keep them honest is to read the other one's source.
  for (const rel of ['../../server/index.mjs', '../../worker/room.js']) {
    const src = await readFile(new URL(rel, import.meta.url), 'utf8');
    ok(/SCORE_LIMIT \?\? 15\)/.test(src), `${rel.split('/').pop()} defaults to the same score limit`);
    ok(/MATCH_MS \?\? 5 \* 60_000\)/.test(src), `${rel.split('/').pop()} defaults to the same time cap`);
  }
}

console.log('the score limit');
{
  const t = new BotMatchTally({ limit: 3, ms: 1000, now: 0 });
  ok(t.noteKill() === null && t.noteKill() === null, 'kills below the limit do not end anything');
  ok(t.noteKill() === 'score', 'the limit-th kill ends the match on score');
  ok(t.over && t.winner() === 'you', 'and you won it', `kills ${t.kills} deaths ${t.deaths}`);
  ok(t.noteKill() === null && t.kills === 3, 'a kill after the horn is refused, not counted');
}

console.log('losing to the garrison');
{
  const t = new BotMatchTally({ limit: 2, ms: 1000, now: 0 });
  t.noteKill();
  ok(t.noteDeath() === null, 'a death below the limit does not end anything');
  ok(t.noteDeath() === 'score', 'the garrison reaching the limit ends the match too');
  ok(t.winner() === 'garrison', 'and it is a defeat — a bots match can be lost');
}

console.log('the clock');
{
  const t = new BotMatchTally({ limit: 15, ms: 1000, now: 500 });
  ok(t.remaining(500) === 1000, 'the clock runs from the start time handed in');
  ok(t.checkTime(1499) === null, 'time inside the cap ends nothing');
  ok(t.checkTime(1500) === 'time', 'the cap expiring ends the match on time');
  ok(t.remaining(9999) === 0, 'remaining never goes negative');
}

console.log('time-expiry outcomes');
{
  const lead = new BotMatchTally({ limit: 15, ms: 100, now: 0 });
  lead.noteKill();
  lead.checkTime(100);
  ok(lead.winner() === 'you', 'the leader on kills wins on time');

  const trail = new BotMatchTally({ limit: 15, ms: 100, now: 0 });
  trail.noteDeath();
  trail.checkTime(100);
  ok(trail.winner() === 'garrison', 'trailing on time is a loss');

  const even = new BotMatchTally({ limit: 15, ms: 100, now: 0 });
  even.noteKill();
  even.noteDeath();
  even.checkTime(100);
  ok(even.winner() === null, 'a dead heat is a draw, not a coin flip');
}

console.log(fails ? `\n${fails} failure(s)` : '\nall match-bounds checks passed');
process.exit(fails ? 1 : 0);
