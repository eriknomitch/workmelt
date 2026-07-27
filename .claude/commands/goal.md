---
description: Score the performance + visibility goal and advance it by one iteration
argument-hint: "[status | loop | ingest <run.json> --tier=<t> --target-fps=<n>]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Task
---

# /goal — work `goals/perf-visibility.md` until it is met

Arguments: `$ARGUMENTS` (empty = one full iteration).

- `status` — score only, change nothing.
- `loop` — keep iterating until the scorecard says GOAL MET or you are blocked.
- `ingest <file> ...` — record a real-hardware run, then re-score.

The goal is defined in `goals/perf-visibility.md`. The criteria that actually
decide it are in `tools/lib/criteria.mjs`. **Read both before your first edit of
a session.** Also read `ARCHITECTURE.md` — subsystem ownership is not optional.

## The loop

1. **Score.**
   ```bash
   node tools/goal.mjs --quick          # 640x360, ~15 min, use this while iterating
   node tools/goal.mjs                  # 960x540, the real gate, before you claim done
   ```
   Exit code 0 means met. Anything else prints exactly which criteria failed and
   by how much. `--score-only` re-scores the last measurement without re-running it.

2. **Pick ONE failing criterion — the worst one — and state a hypothesis.**
   Not "make it faster". Something like: "V1 fails at `performance` because
   `renderScale` is 0.3; raising it to 0.6 costs +0.09 of ultra's `costIndex`,
   which keeps P1 under its 0.25 ceiling." If you cannot predict the effect on
   the other criteria, you do not understand the change yet.

3. **Make the smallest change that tests the hypothesis.** One concern per
   iteration. Respect the ownership map: `src/core/config.js` and
   `src/core/quality.js` are lead-owned; a render change belongs in `src/render/`
   and must go through `ctx`, never a cross-subsystem import.

4. **Re-measure the tiers you touched, then everything.**
   ```bash
   node tools/goal.mjs --quick --tiers=performance,low
   node tools/goal.mjs --quick          # ratios are relative to ultra, so ultra must be in the run
   ```
   Note the trap: V1/V2/V3 are all measured *relative to `ultra`*. A run that
   omits `ultra` cannot score them. Iterate narrow, gate wide.

5. **Verify you did not break the game**, every iteration, no exceptions:
   ```bash
   node tools/lib/selftest.mjs      # the metrics themselves
   node src/physics/selftest.js && node src/ai/selftest.mjs
   npm run build
   ```

6. **Commit the iteration** if it moved a criterion forward — `perf:` for cost,
   `fix:` for a visibility regression, one concern per commit, with the before
   and after numbers for the criterion in the body. Revert it if it did not:
   a change that improves nothing measurable is not neutral, it is noise.

7. **Repeat.** Stop when the scorecard says GOAL MET, when only H1/H2 remain
   (see below), or when the same criterion has resisted three different
   hypotheses — at that point say so and bring the numbers, do not keep grinding.

## What you cannot do here, and must not fake

This machine has **no GPU**. Frame rate is not measurable on it. SwiftShader
renders the right pixels at ~2 s/frame, so every visibility criterion is real;
`costIndex` is an ordinal model of GPU load, and `swMsPerFrame` is a noisy
second witness. None of the three is frames per second.

Therefore:

- Never report an fps number you did not get from real hardware.
- Never say "this should hit 120 fps". Say "this cuts modelled GPU load at the
  `performance` tier from 0.11 to 0.09 of `ultra`, sharpness from 0.31x to 0.78x
  of `ultra`."
- When only H1/H2 are left, stop and ask the user to run the hardware step. That
  is a finished iteration, not a failure:
  ```bash
  node tools/profile.mjs --frames=900 > run.json      # on the 120 Hz machine
  node tools/goal.mjs --ingest=run.json --tier=<tier> --target-fps=120 --machine="..."
  ```
  Ingest after every change to `QUALITY_PRESETS` or to the calibration policy —
  those are exactly the changes a headless run cannot validate.

## Unattended running

`node tools/goal.mjs --quick` takes ~15 minutes, so a hands-off session looks
like `/loop 30m /goal`. Each firing must end in one of three states, and must
say which: a committed iteration, a reverted hypothesis with the numbers that
killed it, or blocked-on-hardware.
