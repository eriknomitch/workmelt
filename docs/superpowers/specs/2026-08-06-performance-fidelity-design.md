# Performance + Fidelity Design

Date: 2026-08-06
Status: approved

## Goal
Improve main-scene gameplay performance for Chrome on a MacBook Pro targeting stable 60 fps, while preserving as much of the current high-end look as possible and improving visibility/readability.

## Product intent
- Protect spatial resolution more strongly than the current presets do.
- Make adaptive quality prefer trimming disproportionately expensive features before collapsing render scale.
- Reduce high/ultra overspend where the cost is least visible, especially in shadow configuration.
- Make performance/low/medium tiers sharper and more readable, especially in combat and night scenes.
- Allow visual changes when they improve enemy readability, shadow legibility, and scene clarity.

## Technical plan
### 1. Rebalance preset budgets
Adjust `QUALITY_PRESETS` so cheaper tiers stop throwing away resolution while expensive tiers stop overspending on shadows.

Likely directions:
- raise `performance` render scale materially above 0.3 while keeping costly effects off
- keep `low` distinctly cheaper than `medium`, but sharper than today
- move `medium` toward a better 60 fps default balance
- trim high/ultra shadow-map/cascade/distance combinations that cost much more than they visibly return

### 2. Change adaptive-quality policy
Adjust calibration and runtime adaptation so perf is not solved primarily by blur.

Likely directions:
- calibrate 60 Hz-class hardware to a sharper starting point
- preserve a higher minimum render scale
- walk down tier features before spending too much time at blurry scales
- keep UX simple: better decisions rather than major new UI

### 3. Improve shadow/night legibility
Tune shadow darkness, low-end tone handling, and/or ambient floor so dark scenes keep structure without washing the image out.

### 4. Verification
Run relevant headless self-tests, `npm run build`, and `node tools/goal.mjs --quick`, then use real hardware profiling for Chrome on MacBook Pro targeting 60 fps.

## Scope
In scope:
- `QUALITY_PRESETS` rebalance
- adaptive-quality calibration/policy adjustments
- targeted shadow/night visibility tuning
- verification against the perf/visibility goal

Out of scope:
- large engine architecture changes
- new runtime dependencies
- major settings-menu redesign
- unrelated gameplay tuning

## Risks
- sharper low tiers becoming too expensive
- improving night visibility by flattening the image
- surprising auto-quality behavior changes

## Risk controls
- keep changes concentrated in preset/policy/tone-shadow tuning
- validate against the existing goal harness after each iteration
- preserve tier separation
- prefer cuts in hard-to-notice cost over cuts in player-facing clarity
