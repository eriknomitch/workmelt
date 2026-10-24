#!/usr/bin/env node
/**
 * MATCH SHARE — the pasteable end-of-match card.
 *
 *   node src/match/share.selftest.mjs
 *
 * Every failure here is silent in game: the card renders, Copy says "Copied",
 * and the thing that is wrong only shows up in somebody else's chat — a strip
 * that splits an emoji in half, a 2nd place that claims Victory, a paste that
 * does not lead with where to play. So the text itself is the contract.
 */
import {
  SHARE_URL,
  MARKS,
  ROW,
  MAX_CELLS,
  MatchTimeline,
  ordinal,
  timelineRows,
  roomResult,
  shareText,
} from './share.js';

let fails = 0;
const ok = (cond, name, detail = '') => {
  console.log(`  ${cond ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) fails++;
};
/** Emoji, not UTF-16 units — what a reader actually counts. */
const cells = (s) => [...s].length;

console.log('the timeline');
{
  const t = new MatchTimeline();
  t.kill();
  t.kill();
  t.death();
  t.kill();
  ok(t.events.join('') === 'kkdk', 'records events in the order they happened', t.events.join(''));
  ok(t.kills === 3 && t.deaths === 1, 'counts kills and deaths', `${t.kills}K/${t.deaths}D`);
  t.reset();
  ok(t.events.length === 0, 'reset empties it for the next match');

  const capped = new MatchTimeline(5);
  for (let i = 0; i < 50; i++) capped.death();
  ok(capped.events.length === 5, 'a runaway source cannot grow it past its limit');
}

console.log('the strip');
{
  ok(timelineRows([]).length === 0, 'an empty match prints no strip at all');

  const rows = timelineRows(['k', 'd', 'k']);
  ok(rows.length === 1 && rows[0] === MARKS.kill + MARKS.death + MARKS.kill, 'one mark per event, in order', rows[0]);
  ok(Object.keys(MARKS).length === 2 && MARKS.kill !== MARKS.death, 'two marks, and they differ — it reads without a legend');

  const full = timelineRows(Array(ROW * 2 + 3).fill('k'));
  ok(full.length === 3, `wraps every ${ROW} cells`, `${full.length} rows`);
  ok(full.every((r, i) => cells(r) === (i < 2 ? ROW : 3)), 'no line carries more or fewer cells than it should — an emoji is never split');

  const long = timelineRows(Array(MAX_CELLS + 12).fill('d'));
  ok(long.length === MAX_CELLS / ROW, 'a long match is cut at the cap, not printed whole', `${long.length} rows`);
  ok(MAX_CELLS / ROW <= 3, 'the cap keeps a paste to three lines of strip at most');
  ok(long[long.length - 1].endsWith(' +12'), 'and the cut is counted, not hidden', long[long.length - 1]);

  const exact = timelineRows(Array(MAX_CELLS).fill('k'));
  ok(!exact.some((r) => r.includes('+')), 'exactly at the cap nothing is counted as cut');
}

console.log('placings');
{
  ok(['1st', '2nd', '3rd', '4th'].every((s, i) => ordinal(i + 1) === s), '1st 2nd 3rd 4th');
  ok(ordinal(11) === '11th' && ordinal(12) === '12th' && ordinal(13) === '13th', 'the teens are all -th');
  ok(ordinal(21) === '21st' && ordinal(22) === '22nd', 'and the twenties are not');

  const standings = [
    { id: 3, kills: 15, deaths: 4 },
    { id: 1, kills: 9, deaths: 8 },
    { id: 2, kills: 9, deaths: 8 },
    { id: 4, kills: 2, deaths: 12 },
  ];
  const win = roomResult({ standings, winner: 3, myId: 3 });
  ok(win.outcome === 'win' && win.place === 1 && win.of === 4, 'the winner wins, 1st of 4');
  const tied = roomResult({ standings, winner: 3, myId: 2 });
  ok(tied.outcome === 'loss' && tied.place === 2, 'a level row shares the placing above it', `place ${tied.place}`);
  ok(roomResult({ standings, winner: 3, myId: 4 }).place === 4, 'last is last');
  ok(roomResult({ standings, winner: 3, myId: 99 }) === null, 'a player not in the standings has no result');

  const heat = [
    { id: 1, kills: 6, deaths: 3 },
    { id: 2, kills: 6, deaths: 3 },
    { id: 3, kills: 1, deaths: 9 },
  ];
  ok(roomResult({ standings: heat, winner: null, myId: 2 }).outcome === 'draw', 'level with the top in a dead heat is a draw');
  ok(roomResult({ standings: heat, winner: null, myId: 3 }).outcome === 'loss', 'under it in a dead heat is still a loss');
}

console.log('the card');
{
  const roomWin = shareText({ outcome: 'win', place: 1, kills: 15, deaths: 6, events: ['k', 'k', 'd', 'k'] });
  const lines = roomWin.split('\n');
  ok(lines[0] === SHARE_URL, 'it OPENS on the address — the first line is what a preview shows', lines[0]);
  ok(SHARE_URL === 'workmelt.com', 'the address is the bare domain every chat client auto-links');
  ok(lines[1] === '🏆 1st · K/D 15-6', 'then one result line: badge, placing, K/D', lines[1]);
  ok(lines[2] === '🎯🎯💀🎯', 'then the strip', lines[2]);
  ok(lines.length === 3, 'and nothing else');
  ok(!roomWin.endsWith('\n'), 'no trailing newline to leave a blank line in a chat bubble');

  const second = shareText({ outcome: 'loss', place: 2, kills: 9, deaths: 8 }).split('\n')[1];
  ok(second === '🥈 2nd · K/D 9-8', 'a room loss is only the placing — never Victory, never Defeat', second);
  ok(shareText({ outcome: 'loss', place: 3 }).includes('🥉 3rd'), 'third gets bronze');
  ok(shareText({ outcome: 'loss', place: 4 }).includes('🫠 4th'), 'off the podium you melted');
  ok(shareText({ outcome: 'draw', place: 1 }).includes('🤝 Draw'), 'a room tied at the top is a draw, not 1st');

  const bots = shareText({ outcome: 'win', kills: 15, deaths: 2 }).split('\n')[1];
  ok(bots === '🏆 Victory · K/D 15-2', 'a bots win is a verdict — a placing against a garrison means nothing', bots);
  ok(shareText({ outcome: 'loss' }).includes('🫠 Defeat'), 'a bots loss says Defeat');
  ok(shareText({ outcome: 'draw' }).includes('🤝 Draw'), 'a bots draw says Draw');

  const bare = shareText({ outcome: 'win', kills: 1, deaths: 0 }).split('\n');
  ok(bare.length === 2, 'no events still makes a clean card', bare.join(' / '));
}

console.log(fails ? `\n${fails} failure(s)` : '\nall match-share checks passed');
process.exit(fails ? 1 : 0);
