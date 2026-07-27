#!/usr/bin/env node
/**
 * The scorecard for `goals/perf-visibility.md`. One command answers one
 * question: is the goal met yet, and if not, which criterion is failing.
 *
 *   node tools/goal.mjs                     # measure everything, score it
 *   node tools/goal.mjs --quick             # small buffer, fewer settle frames
 *   node tools/goal.mjs --tiers=performance # iterate on one tier
 *   node tools/goal.mjs --score-only        # re-score the last measurement
 *   node tools/goal.mjs --save-baseline     # freeze today's numbers to compare against
 *
 * Real frames per second cannot be measured on a GPU-less machine, so the H*
 * criteria stay UNVERIFIED until someone runs the game on real hardware and
 * feeds the result back in:
 *
 *   # on a machine with a GPU
 *   node tools/profile.mjs --frames=900 > run.json
 *   # anywhere
 *   node tools/goal.mjs --ingest=run.json --tier=low --target-fps=120 --machine="M3 Max"
 *
 * Exit code is 0 only when every criterion passes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs, table, ROOT } from './lib/harness.mjs';
import { evaluate } from './lib/criteria.mjs';

const args = parseArgs();
const OUT_DIR = resolve(String(args.dir ?? `${ROOT}/.goal`));
const REPORT = `${OUT_DIR}/report.json`;
const BASELINE = `${OUT_DIR}/baseline.json`;
const VIS = `${OUT_DIR}/visibility.json`;
const COST = `${OUT_DIR}/cost.json`;
mkdirSync(OUT_DIR, { recursive: true });

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

function run(script, extra) {
  const argv = [script, ...extra];
  process.stderr.write(`$ node ${argv.join(' ')}\n`);
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
}

/* ---------------------------------------------------------------- ingest -- */

if (args.ingest) {
  const raw = readJson(resolve(String(args.ingest)));
  if (!raw) throw new Error(`cannot read ${args.ingest}`);
  // Accept either tools/profile.mjs output or a raw __PERF__.stats() object.
  const fps = raw.fps ?? raw.enginePerf?.fps ?? null;
  const hitchPct = raw.hitchPctOfFrames ?? raw.enginePerf?.hitches?.pctOfFrames ?? raw.hitches?.pctOfFrames ?? null;
  if (!fps) throw new Error('ingested file has no fps block — expected tools/profile.mjs output or __PERF__.stats()');
  const report = readJson(REPORT) ?? {};
  report.hardware ??= { runs: [] };
  report.hardware.runs.push({
    machine: args.machine ? String(args.machine) : 'unnamed machine',
    tier: String(args.tier ?? 'unknown'),
    targetFps: Number(args['target-fps'] ?? 120),
    internal: raw.internal ?? null,
    fps: { p50: fps.p50, p95: fps.p95, p99: fps.p99 },
    hitches: { pctOfFrames: hitchPct },
    source: String(args.ingest),
  });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  process.stderr.write(`ingested into ${REPORT.replace(ROOT + '/', '')}\n`);
}

/* --------------------------------------------------------------- measure -- */

const quick = args.quick === true || args.quick === '1';
const dims = quick ? ['--w=640', '--h=360', '--settle=16'] : ['--w=960', '--h=540', '--settle=32'];
const tierArg = args.tiers ? [`--tiers=${args.tiers}`] : [];
const gpuArg = args.gpu ? [`--gpu=${args.gpu}`] : [];

if (!args['score-only'] && !args.ingest) {
  run('tools/visibility.mjs', [...dims, ...tierArg, ...gpuArg, `--out=${VIS}`, ...(args.png ? [`--png=${args.png}`] : [])]);
  run('tools/cost.mjs', [dims[0], dims[1], ...tierArg, ...gpuArg, `--out=${COST}`]);
}

/* ----------------------------------------------------------------- score -- */

const previous = readJson(REPORT) ?? {};
const report = {
  goal: 'goals/perf-visibility.md',
  measuredAt: new Date().toISOString(),
  visibility: readJson(VIS),
  cost: readJson(COST),
  baseline: readJson(BASELINE),
  hardware: previous.hardware ?? null,
};
const { criteria, summary } = evaluate(report);
report.criteria = criteria;
report.summary = summary;
writeFileSync(REPORT, JSON.stringify(report, null, 2));

if (args['save-baseline']) {
  writeFileSync(BASELINE, JSON.stringify({ savedAt: report.measuredAt, visibility: report.visibility, cost: report.cost }, null, 2));
  process.stderr.write(`baseline saved to ${BASELINE.replace(ROOT + '/', '')}\n`);
}

const mark = { pass: 'PASS', fail: 'FAIL', unverified: '????' };
console.log();
console.log(
  table(criteria, [
    { key: 'id', label: 'ID' },
    { key: 'status', label: 'STATUS', get: (c) => mark[c.status] },
    { key: 'label', label: 'CRITERION' },
    { key: 'actual', label: 'MEASURED' },
  ])
);
console.log();
for (const c of criteria.filter((x) => x.status !== 'pass'))
  console.log(`${mark[c.status]} ${c.id}: ${c.label}\n     target: ${c.target}\n     actual: ${c.actual}`);
console.log(
  `\n${summary.pass} pass · ${summary.fail} fail · ${summary.unverified} unverified — ` +
    (summary.met ? 'GOAL MET' : 'GOAL NOT MET')
);
console.log(`report: ${REPORT.replace(ROOT + '/', '')}`);

process.exit(summary.met ? 0 : 1);
