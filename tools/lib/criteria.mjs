/**
 * The goal, as code. `goals/perf-visibility.md` is the prose version of this
 * file; this one is what actually decides whether the loop is finished.
 *
 * Two classes of criterion:
 *   - headless (V*, P*) — decided from `tools/visibility.mjs` + `tools/cost.mjs`
 *     output. No GPU needed, so the loop can gate on them every iteration.
 *   - hardware (H*)     — decided from a real-machine run ingested with
 *     `node tools/goal.mjs --ingest=run.json`. Reported UNVERIFIED until then,
 *     and UNVERIFIED is not a pass.
 */

export const TIERS = ['performance', 'low', 'medium', 'high', 'ultra'];
export const REFERENCE_TIER = 'ultra';

/** Shots the visibility gate measures. Keep it small — each one is ~1 min headless. */
export const VIS_SHOTS = ['hero', 'interior', 'night'];
/** Shot used for enemy-legibility: it is the one that stages bots in frame. */
export const TARGET_SHOT = 'combat';

/**
 * Per-tier floors, expressed as a fraction of the same measurement at `ultra`.
 * A tier is allowed to be cheaper. It is not allowed to stop being readable.
 */
export const SHARPNESS_FLOOR = { performance: 0.6, low: 0.8, medium: 0.92, high: 0.98, ultra: 1 };
/**
 * costIndex ceiling as a fraction of `ultra`. This is where the FPS comes from.
 * Note that at the cheap tiers the model is dominated by geometry, not pixels —
 * so a tier cannot buy headroom by shrinking the render buffer alone, which is
 * precisely the failure mode this goal exists to correct.
 */
export const COST_CEILING = { performance: 0.25, low: 0.45, medium: 0.7, high: 0.9, ultra: 1 };

/** An enemy inside this range must stand out from its background at every tier. */
export const NEAR_ENEMY_M = 30;
export const ENEMY_MIN_WEBER = 0.15;
/** Fraction of ultra's per-actor silhouette area / contrast a cheaper tier must keep. */
export const ENEMY_PX_RETENTION = 0.5;
export const ENEMY_WEBER_RETENTION = 0.8;
export const CRUSH_MARGIN_PCT = 1.0;
export const SHADOW_DETAIL_FLOOR = 0.75;
export const TONE_DRIFT_MAX = 8;
export const TIER_SEPARATION = 0.85;
export const HW_P50_RATIO = 1.0;
export const HW_P99_RATIO = 0.75;
export const HW_HITCH_PCT_MAX = 0.5;

const r3 = (v) => (Number.isFinite(v) ? +v.toFixed(3) : v);
const pass = (id, label, target, actual, ok, note = '') => ({
  id,
  label,
  target,
  actual,
  status: ok === null ? 'unverified' : ok ? 'pass' : 'fail',
  note,
});

const worst = (entries) => entries.reduce((a, b) => (b.value < a.value ? b : a));

/**
 * @param {object} report `{ visibility, cost, hardware }` as written by tools/goal.mjs
 * @returns {{criteria: object[], summary: object}}
 */
export function evaluate(report) {
  const out = [];
  const vis = report.visibility ?? null;
  const cost = report.cost ?? null;
  const hw = report.hardware ?? null;
  const tiers = (vis?.tiers ?? []).map((t) => t.tier);
  const ref = vis?.tiers?.find((t) => t.tier === REFERENCE_TIER) ?? null;
  const measured = (t) => vis?.tiers?.find((x) => x.tier === t) ?? null;

  /* ---------------------------------------------------------- visibility -- */

  if (!ref) {
    out.push(pass('V1', 'Sharpness floor per tier', `>= floor x ${REFERENCE_TIER}`, 'no reference tier measured', null));
    out.push(pass('V2', 'Shadow legibility', 'no lost shadow detail', 'not measured', null));
    out.push(pass('V4', 'Tone consistency', `within ${TONE_DRIFT_MAX} levels of ${REFERENCE_TIER}`, 'not measured', null));
  } else {
    const sharp = [];
    const crush = [];
    const shadow = [];
    const tone = [];
    for (const tier of tiers) {
      const m = measured(tier);
      for (const shot of VIS_SHOTS) {
        const a = m?.shots?.[shot];
        const b = ref.shots?.[shot];
        if (!a || !b) continue;
        sharp.push({ key: `${tier}/${shot}`, value: r3(a.edgeEnergy / (b.edgeEnergy || 1)), floor: SHARPNESS_FLOOR[tier] ?? 1 });
        crush.push({ key: `${tier}/${shot}`, value: r3(b.crushPct + CRUSH_MARGIN_PCT - a.crushPct), actual: a.crushPct, cap: r3(b.crushPct + CRUSH_MARGIN_PCT) });
        shadow.push({ key: `${tier}/${shot}`, value: r3(a.shadowDetail / (b.shadowDetail || 1)) });
        tone.push({ key: `${tier}/${shot}`, value: r3(TONE_DRIFT_MAX - Math.abs(a.meanL - b.meanL)), drift: r3(Math.abs(a.meanL - b.meanL)) });
      }
    }
    const sharpFails = sharp.filter((s) => s.value < s.floor);
    out.push(
      pass(
        'V1',
        'Sharpness floor per tier',
        'edgeEnergy >= floor x ultra (perf .60 / low .80 / med .92 / high .98)',
        sharpFails.length
          ? sharpFails.map((s) => `${s.key} ${s.value} < ${s.floor}`).join(', ')
          : `worst ${worst(sharp.map((s) => ({ ...s, value: r3(s.value / s.floor) }))).key} at ${r3(Math.min(...sharp.map((s) => s.value / s.floor)))}x its floor`,
        sharp.length ? sharpFails.length === 0 : null
      )
    );
    const crushFails = crush.filter((c) => c.value < 0);
    const shadowFails = shadow.filter((s) => s.value < SHADOW_DETAIL_FLOOR);
    out.push(
      pass(
        'V2',
        'Shadow legibility',
        `crushPct <= ultra+${CRUSH_MARGIN_PCT}pp and shadowDetail >= ${SHADOW_DETAIL_FLOOR}x ultra`,
        [...crushFails.map((c) => `${c.key} crush ${c.actual}% > ${c.cap}%`), ...shadowFails.map((s) => `${s.key} shadowDetail ${s.value}x`)].join(', ') ||
          `worst shadowDetail ${worst(shadow).key} ${worst(shadow).value}x`,
        crush.length ? crushFails.length === 0 && shadowFails.length === 0 : null
      )
    );
    const toneFails = tone.filter((t) => t.value < 0);
    out.push(
      pass(
        'V4',
        'Tone consistency',
        `mean luma within ${TONE_DRIFT_MAX} levels of ultra`,
        toneFails.length ? toneFails.map((t) => `${t.key} drift ${t.drift}`).join(', ') : `max drift ${Math.max(...tone.map((t) => t.drift ?? 0))}`,
        tone.length ? toneFails.length === 0 : null
      )
    );
  }

  // Enemy legibility is scored actor by actor against `ultra`: a tier may draw
  // a soldier with fewer pixels, but it may not make one stop resolving.
  const targets = (vis?.tiers ?? [])
    .map((t) => ({ tier: t.tier, s: t.targets }))
    .filter((t) => t.s && !t.s.error && Array.isArray(t.s.actors));
  const refActors = targets.find((t) => t.tier === REFERENCE_TIER)?.s.actors ?? null;
  const legibilityFails = [];
  for (const t of targets) {
    for (const a of t.s.actors) {
      if (a.distance <= NEAR_ENEMY_M && a.px > 0 && a.weber < ENEMY_MIN_WEBER)
        legibilityFails.push(`${t.tier} #${a.id} at ${a.distance}m weber ${a.weber}`);
      const ref = refActors?.find((r) => r.id === a.id);
      if (!ref || ref.px <= 0) continue;
      if (a.px < ref.px * ENEMY_PX_RETENTION)
        legibilityFails.push(`${t.tier} #${a.id} ${a.px}px vs ultra ${ref.px}px`);
      if (a.weber < ref.weber * ENEMY_WEBER_RETENTION)
        legibilityFails.push(`${t.tier} #${a.id} weber ${a.weber} vs ultra ${ref.weber}`);
    }
    if (refActors && t.s.visible < refActors.filter((r) => r.px > 0).length)
      legibilityFails.push(`${t.tier} resolves ${t.s.visible} of ${refActors.filter((r) => r.px > 0).length} enemies`);
  }
  out.push(
    pass(
      'V3',
      'Enemy legibility',
      `weber >= ${ENEMY_MIN_WEBER} inside ${NEAR_ENEMY_M}m; vs ultra keep ${ENEMY_PX_RETENTION}x pixels and ${ENEMY_WEBER_RETENTION}x contrast per actor`,
      targets.length
        ? legibilityFails.length
          ? legibilityFails.slice(0, 6).join(', ') + (legibilityFails.length > 6 ? ` (+${legibilityFails.length - 6} more)` : '')
          : targets.map((t) => `${t.tier} ${t.s.visible}/${t.s.total} w>=${t.s.minWeber}`).join(', ')
        : 'not measured',
      targets.length ? legibilityFails.length === 0 : null
    )
  );

  /* --------------------------------------------------------- performance -- */

  const costs = cost?.tiers ?? [];
  const refCost = costs.find((c) => c.tier === REFERENCE_TIER)?.costIndex ?? null;
  const ceilFails = refCost
    ? costs.filter((c) => c.costIndex / refCost > (COST_CEILING[c.tier] ?? 1) + 1e-9)
    : [];
  out.push(
    pass(
      'P1',
      'Cost ceiling per tier',
      'costIndex/ultra <= perf .25 / low .45 / med .70 / high .90',
      refCost
        ? ceilFails.length
          ? ceilFails.map((c) => `${c.tier} ${r3(c.costIndex / refCost)} > ${COST_CEILING[c.tier]}`).join(', ')
          : costs.map((c) => `${c.tier} ${r3(c.costIndex / refCost)}`).join(', ')
        : 'not measured',
      refCost ? ceilFails.length === 0 : null
    )
  );

  const ladder = TIERS.filter((t) => costs.some((c) => c.tier === t));
  const stepFails = [];
  for (let i = 1; i < ladder.length; i++) {
    const lo = costs.find((c) => c.tier === ladder[i - 1]).costIndex;
    const hi = costs.find((c) => c.tier === ladder[i]).costIndex;
    if (!(lo <= hi * TIER_SEPARATION)) stepFails.push(`${ladder[i - 1]}/${ladder[i]} = ${r3(lo / hi)}`);
  }
  out.push(
    pass(
      'P2',
      'Tier ladder is monotonic and separated',
      `each tier <= ${TIER_SEPARATION}x the tier above`,
      ladder.length > 1 ? (stepFails.length ? stepFails.join(', ') : 'ok') : 'not measured',
      ladder.length > 1 ? stepFails.length === 0 : null
    )
  );

  const base = report.baseline?.cost?.tiers ?? null;
  if (base) {
    const regressions = costs
      .map((c) => ({ tier: c.tier, now: c.cpuSimMs, was: base.find((b) => b.tier === c.tier)?.cpuSimMs }))
      .filter((c) => Number.isFinite(c.was) && c.now > c.was * 1.1);
    out.push(
      pass(
        'P3',
        'CPU simulation cost does not regress',
        'fixed+update+late mean within 110% of baseline',
        regressions.length ? regressions.map((c) => `${c.tier} ${c.now}ms vs ${c.was}ms`).join(', ') : 'ok',
        regressions.length === 0
      )
    );
  } else {
    out.push(pass('P3', 'CPU simulation cost does not regress', 'within 110% of baseline', 'no baseline recorded (--save-baseline)', null));
  }

  /* ------------------------------------------------------------ hardware -- */

  if (!hw?.runs?.length) {
    out.push(pass('H1', 'Target FPS on real hardware', 'p50 >= target, p99 >= 0.75x target', 'no hardware run ingested', null));
    out.push(pass('H2', 'No hitching on real hardware', `hitches <= ${HW_HITCH_PCT_MAX}% of frames`, 'no hardware run ingested', null));
  } else {
    const bad = hw.runs.filter(
      (r) => !(r.fps?.p50 >= r.targetFps * HW_P50_RATIO) || !(r.fps?.p99 >= r.targetFps * HW_P99_RATIO)
    );
    out.push(
      pass(
        'H1',
        'Target FPS on real hardware',
        `p50 >= target and p99 >= ${HW_P99_RATIO}x target`,
        hw.runs.map((r) => `${r.machine ?? 'run'} ${r.tier}@${r.targetFps}: p50 ${r.fps?.p50} p99 ${r.fps?.p99}`).join(' | '),
        bad.length === 0
      )
    );
    const hitchy = hw.runs.filter((r) => (r.hitches?.pctOfFrames ?? 0) > HW_HITCH_PCT_MAX);
    out.push(
      pass(
        'H2',
        'No hitching on real hardware',
        `hitches <= ${HW_HITCH_PCT_MAX}% of frames`,
        hw.runs.map((r) => `${r.machine ?? 'run'} ${r.hitches?.pctOfFrames ?? '?'}%`).join(' | '),
        hitchy.length === 0
      )
    );
  }

  const summary = {
    pass: out.filter((c) => c.status === 'pass').length,
    fail: out.filter((c) => c.status === 'fail').length,
    unverified: out.filter((c) => c.status === 'unverified').length,
    met: out.every((c) => c.status === 'pass'),
  };
  return { criteria: out, summary };
}
