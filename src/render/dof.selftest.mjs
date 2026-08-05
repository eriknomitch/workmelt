/**
 * ADS depth-of-field focus contract.
 *
 * The bug this exists to prevent is not a rendering artefact — it is a picture
 * that is *backwards*. `dofFocusMax` used to be 18 m, so the focal plane could
 * never reach past ~22 m; scoping a target at 60 m blurred the target and left
 * the crate at 8 m beside you pin sharp, which is the opposite of what an optic
 * does. Nothing in a still frame flags that: the frame looks like a frame with
 * depth of field in it. So the invariant has to be asserted arithmetically.
 *
 *   THE PIXEL UNDER THE RETICLE IS NEVER BLURRED, at any engagement range.
 *
 * Everything else here is the shape that falls out of that: what the near band
 * is allowed to reach, that the far band always lands behind the target, and
 * that the peripheral term stays outside the sight-picture disc.
 *
 * Runs against the CPU mirror in dof.js, which shares its constants with the
 * GLSL by interpolation rather than by transcription.
 *
 *   node src/render/dof.selftest.mjs
 */
import {
  dofBlend,
  dofCoC,
  dofFocusDistance,
  dofMaxCoc,
  dofPeripheralCoC,
  PERIPHERY_START,
} from './dof.js';

let failures = 0;
let checks = 0;

function ok(cond, what) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${what}`);
  }
}

/** The shipped tuning, mirrored from RenderSystem.settings. */
const S = {
  dofMaxCoc: 3.3,
  dofNearRatio: 0.38,
  dofFocusMin: 3.0,
  dofFocusMax: 1200.0,
  dofFarStart: 1.15,
  dofFarRange: 18.0,
  dofNearScale: 0.55,
  dofNearMax: 2.5,
  dofPeripheral: 0.85,
};

const H = 1080;
/** Full ADS. The pass does not run below 0.01 and scales linearly with this. */
const ADS = 1;
const MAX = dofMaxCoc(S, H, ADS);

/**
 * Blur at `depth` metres while the reticle sits on something `aim` metres away.
 * `r` is the distance from the reticle in half-frame-heights.
 */
function blurAt(aim, depth, r = 0, settings = S, maxCoc = MAX) {
  const focus = dofFocusDistance(settings, aim);
  const coc = Math.max(
    dofCoC(settings, depth, focus, maxCoc),
    dofPeripheralCoC(settings, maxCoc, r)
  );
  return dofBlend(coc);
}

/* -- 1. the sight picture is sharp at every range a map can present --------- */
// 3 m is inside the closest cover; 1200 m is the world camera's far plane, so
// nothing beyond the end of this list is drawable in the first place.
const CAMERA_FAR = 1200; // src/core/engine.js
const RANGES = [3, 5, 8, 12, 20, 35, 50, 80, 120, 180, 250, 400, 800, CAMERA_FAR];
for (const d of RANGES) {
  ok(blurAt(d, d) === 0, `target under the reticle at ${d} m is sharp (got ${blurAt(d, d)})`);
}

// The regression itself: the old ceiling, everything else held equal.
const OLD = { ...S, dofFocusMax: 18.0 };
ok(
  blurAt(60, 60, 0, OLD) > 0.9,
  'the 18 m focus ceiling did blur a 60 m target — the bug this test pins'
);
ok(blurAt(60, 8, 0, OLD) === 0, 'and left near cover at 8 m sharp, which is backwards');

/* -- 2. the target is sharper than what surrounds it ----------------------- */
// Scoping a target at 60 m: the ground under your own feet and the skyline
// behind the target both give way, and neither is ever sharper than the target.
{
  const aim = 60;
  ok(blurAt(aim, 1.0) > 0.5, 'the ledge at 1 m goes soft while scoped past it');
  ok(blurAt(aim, 6) === 0, 'the mid-ground at 6 m does NOT — the near band is capped');
  ok(blurAt(aim, 30) === 0, 'nor does anything between you and the target');
  ok(blurAt(aim, aim) === 0, 'the target is sharp');
  ok(blurAt(aim, 200) > 0.9, 'the skyline behind the target falls away');
  ok(
    blurAt(aim, 1.0) > blurAt(aim, aim) && blurAt(aim, 200) > blurAt(aim, aim),
    'the target is strictly the sharpest of the three'
  );
}

/* -- 3. the near band never eats the mid-ground ---------------------------- */
// Focus far enough out and `focus * dofNearScale` alone would call 60 m "near".
for (const aim of [40, 120, 250]) {
  ok(blurAt(aim, S.dofNearMax) === 0, `nothing at ${S.dofNearMax} m blurs when aimed at ${aim} m`);
  ok(blurAt(aim, 10) === 0, `nor at 10 m when aimed at ${aim} m`);
}
ok(blurAt(120, 0.5) > 0.5, 'something pressed against the lens still blurs');

/* -- 4. the far band always lands BEHIND the aim point --------------------- */
for (const aim of [5, 20, 60, 150]) {
  const focus = dofFocusDistance(S, aim);
  const farStart = focus * S.dofFarStart + 1;
  ok(farStart > aim + 0.5, `far blur starts past the target at ${aim} m (${farStart.toFixed(1)} m)`);
  // ...and its ramp widens with range instead of becoming a razor edge.
  let end = farStart;
  while (end < 1e5 && dofCoC(S, end, focus, MAX) < MAX * 0.999) end += 0.5;
  ok(end - farStart >= S.dofFarRange - 1e-6, `far ramp at ${aim} m is at least dofFarRange wide`);
}

/* -- 5. aiming at the sky focuses at infinity, not at the rail ------------- */
{
  // The prepass clears depth to zero, so 0 IS the sky.
  const focus = dofFocusDistance(S, 0);
  ok(focus === S.dofFocusMax, 'a sky reticle pins the focal plane at the far rail');
  ok(focus >= CAMERA_FAR, 'and the rail is at or past the camera far plane...');
  ok(focus * S.dofFarStart + 1 > CAMERA_FAR, '...so no drawable geometry is behind it');
  ok(blurAt(0, 300) === 0, 'a 300 m skyline stays sharp under a sky reticle');
  ok(blurAt(0, CAMERA_FAR) === 0, 'and so does the furthest thing that can be drawn');
  ok(blurAt(0, 1.0) > 0.5, 'while the near band still works');
}

/* -- 6. the peripheral term stays out of the sight picture ----------------- */
{
  // The longest optic's sight-picture disc reaches ~0.65 half-heights (the
  // sniper's 350 px in a 1080 p frame). The ramp must not start inside it.
  ok(PERIPHERY_START > 0.66, 'the peripheral ramp starts outside the widest sight picture');
  for (const r of [0, 0.25, 0.5, 0.65]) {
    ok(dofPeripheralCoC(S, MAX, r) === 0, `no peripheral blur at r=${r}, inside the glass`);
  }
  ok(dofPeripheralCoC(S, MAX, 1.0) > 0, 'the top and bottom edges soften');
  ok(
    dofPeripheralCoC(S, MAX, 1.86) > dofPeripheralCoC(S, MAX, 1.0),
    'and the 16:9 corners soften more than the edges'
  );
  // It can never outrun the gather spiral, which is sized to maxCoc.
  ok(dofPeripheralCoC(S, MAX, 4) <= MAX + 1e-6, 'peripheral CoC never exceeds the gather radius');
  ok(
    dofPeripheralCoC({ ...S, dofPeripheral: 0 }, MAX, 1.86) === 0,
    'and a player who sets it to 0 gets a flat frame'
  );
}

/* -- 7. it ramps with the ADS blend and costs nothing at the hip ----------- */
{
  ok(dofMaxCoc(S, H, 0) === 0, 'no blur at all at the hip');
  const half = dofMaxCoc(S, H, 0.5);
  ok(half > 0 && half < MAX, 'and half the CoC halfway into the raise');
  // Resolution independence: the same fraction of the frame at any render scale.
  ok(
    Math.abs(dofMaxCoc(S, 540, ADS) * 2 - dofMaxCoc(S, 1080, ADS)) < 1e-9,
    'CoC is a fixed fraction of the frame height'
  );
}

/* -- 8. mutation checks: each guard above can actually fail ---------------- */
{
  // Raise the ceiling back and the far band must catch the target again.
  ok(blurAt(60, 60, 0, { ...S, dofFocusMax: 18 }) > 0, 'ceiling mutation is caught');
  // Drop the near cap and the mid-ground must dissolve.
  ok(blurAt(120, 30, 0, { ...S, dofNearMax: 1e9 }) > 0, 'near-cap mutation is caught');
  // Move the far band onto the target and it must blur.
  ok(blurAt(60, 60, 0, { ...S, dofFarStart: 0.4 }) > 0, 'far-start mutation is caught');
  // Widen the periphery inward and it must reach the glass.
  ok(dofPeripheralCoC({ ...S, dofPeripheral: 1 }, MAX, 1.4) > 0, 'peripheral ramp is live');
}

const label = 'render/dof';
if (failures) {
  console.error(`[${label}] ${failures} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`[${label}] ${checks} checks passed`);
