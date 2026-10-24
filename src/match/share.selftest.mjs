#!/usr/bin/env node
/**
 * MATCH SHARE — the pasteable end-of-match card.
 *
 *   node src/match/share.selftest.mjs
 *
 * Every failure here is silent in game: the card renders, Copy says "Copied",
 * and the thing that is wrong only shows up in somebody else's chat — a strip
 * that splits an emoji in half, a 2nd place that claims Victory, a paste that
 * forgot to say where to play. So the text itself is the contract.
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
  t.kill(true);
  t.death();
  t.kill();
  ok(t.events.join('') === 'khdk', 'records events in the order they happened', t.events.join(''));
  ok(t.kills === 3 && t.deaths === 1, 'a headshot is still a kill', `${t.kills}K/${t.deaths}D`);
  t.reset();
  ok(t.events.length === 0, 'reset empties it for the next match');

  const capped = new MatchTimeline(5);
  for (let i = 0; i < 50; i++) capped.death();
  ok(capped.events.length === 5, 'a runaway source cannot grow it past its limit');
}

console.log('the strip');
{
  ok(timelineRows([]).length === 0, 'an empty match prints no strip at all');

  const rows = timelineRows(['k', 'h', 'd']);
  ok(rows.length === 1 && rows[0] === MARKS.kill + MARKS.headshot + MARKS.death, 'one mark per event, in order', rows[0]);
  const marks = new Set(Object.values(MARKS));
  ok(marks.size === 3, 'kill, headshot and death are three different marks');

  const full = timelineRows(Array(ROW * 2 + 3).fill('k'));
  ok(full.length === 3, `wraps every ${ROW} cells`, `${full.length} rows`);
  ok(full.every((r, i) => cells(r) === (i < 2 ? ROW : 3)), 'no line carries more or fewer cells than it should — an emoji is never split');

  const long = timelineRows(Array(MAX_CELLS + 12).fill('d'));
  ok(long.length === MAX_CELLS / ROW, 'a long match is cut at the cap, not printed whole', `${long.length} rows`);
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
  const roomWin = shareText({
    outcome: 'win', place: 1, of: 4, map: 'Site Work', kills: 15, deaths: 6,
    events: ['k', 'h', 'd', 'k'],
  });
  const lines = roomWin.split('\n');
  ok(lines[0] === 'WORKMELT 🏆 Victory · 1st of 4', 'a room win says Victory and the placing', lines[0]);
  ok(lines[1] === 'Site Work · FFA · 15K/6D', 'the detail line is map, mode and the referee\'s K/D', lines[1]);
  ok(lines[2] === '🎯💥💀🎯', 'then the strip', lines[2]);
  ok(lines[lines.length - 1] === SHARE_URL, 'and it ENDS on the address — the paste is the invite');
  ok(SHARE_URL === 'workmelt.com', 'the address is the bare domain every chat client auto-links');
  ok(!roomWin.endsWith('\n'), 'no trailing newline to leave a blank line in a chat bubble');

  const second = shareText({ outcome: 'loss', place: 2, of: 4, kills: 9, deaths: 8 });
  ok(second.startsWith('WORKMELT 🥈 2nd of 4\n'), 'a room loss is only the placing — never Victory, never Defeat', second.split('\n')[0]);
  ok(shareText({ outcome: 'loss', place: 3, of: 4 }).includes('🥉'), 'third gets bronze');
  ok(shareText({ outcome: 'loss', place: 4, of: 4 }).includes('🫠'), 'off the podium you melted');

  const bots = shareText({ outcome: 'win', map: 'Rust', kills: 15, deaths: 2 });
  ok(bots.startsWith('WORKMELT 🏆 Victory\nRust · vs bots · 15K/2D'), 'a bots win names the opponent and no placing', bots.split('\n').slice(0, 2).join(' / '));
  ok(shareText({ outcome: 'loss' }).startsWith('WORKMELT 🫠 Defeat'), 'a bots loss says Defeat');
  ok(shareText({ outcome: 'draw' }).startsWith('WORKMELT 🤝 Draw'), 'a draw says Draw');

  const bare = shareText({ outcome: 'win', kills: 1, deaths: 0 }).split('\n');
  ok(bare.length === 3 && bare[1] === 'vs bots · 1K/0D', 'no map and no events still makes a clean card', bare.join(' / '));
}

console.log(fails ? `\n${fails} failure(s)` : '\nall match-share checks passed');
process.exit(fails ? 1 : 0);
