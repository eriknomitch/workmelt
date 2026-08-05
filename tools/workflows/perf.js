export const meta = {
  name: 'fps-perf',
  description: 'Make the FPS fast with zero visual change: fix wall-clock determinism, then optimize behind a pixel gate',
  phases: [
    { title: 'Determinism' },
    { title: 'Verify gate' },
    { title: 'Optimize' },
    { title: 'Measure' },
  ],
};

// Repo root. Set via `args` when invoking the workflow, e.g. {root: "/path/to/repo"}.
const ROOT = (typeof args !== 'undefined' && args?.root) || '.';

// Ports are assigned per agent; concurrent vite instances collide on strictPort.
const PORT = (n) => 5300 + n;

const GATE = `
THE PIXEL GATE — this is the hard constraint on all of this work. The user's
requirement is literally "1:1 100% exact": no change to visuals, no change to UX.
An optimization that is 20% faster and changes one pixel is a FAILED optimization
and must be reverted.

How to check, every single time, before you claim anything:

  cd ${ROOT}
  OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/<you>-before --port=<YOUR_PORT>
  # ... make your change ...
  OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/<you>-after  --port=<YOUR_PORT>
  node tools/imagediff.mjs --a=/tmp/<you>-before --b=/tmp/<you>-after

It must report "identical: true". Not "close". Not "withinEpsilon". IDENTICAL.
tools/baseline.mjs isolates each shot in its own page, which is what makes the
comparison bit-reproducible — do NOT substitute tools/shotset.mjs, which shares one
page across shots and drifts.

If your change fails the gate, you have two options and no others:
  1. Find the reason it changed pixels and eliminate it, then re-verify.
  2. Revert the change and report it as not-viable with the reason.
Never rationalize a diff as "imperceptible". Report it.
`;

const PERF = `
HOW TO MEASURE — a median frame time is worthless here; the complaint is stalls.

  node tools/profile.mjs --port=<YOUR_PORT> --dpr=2 --frames=900

This drives real gameplay (moving camera, firing, AI active) at Retina device pixel
ratio, and reports the frame-time distribution plus every hitch with the per-frame
WebGL program-count delta that caused it.

Established baseline on an Apple silicon laptop at 1512x982 DPR 2 (internal 2268x1473 = 3.34 MP):
  fps p50 52-58, p95 37-51, p99 33-46  (measured BEFORE the visual repair passes)
  NOTE: triangle count has since roughly DOUBLED, 5.9M -> 11.2M, and draw calls rose
  to ~1583, because the surface/dressing pass added geometry. Re-measure the baseline
  yourself before optimizing; the numbers above are a floor, not current truth.
  worst frame ~300 ms with a warm shader cache, 3.1-3.9 SECONDS with a cold one
  86-146 WebGL programs compiled during play, up to 30 on a single frame
  heap growth 0 MB (not a leak), geometry/texture counts flat (not streaming)

TARGET: p99 >= 60 fps and no frame above 30 ms, at that resolution, with the pixel
gate passing. Run the profiler at least 3 times and report the spread — single runs
of this profiler vary a lot and have already produced one misleading conclusion.
`;

// ------------------------------------------------------------ Phase 1
phase('Determinism');
log('Phase 1: route wall-clock animation through ctx.time');

const DIRS_WITH_CLOCK = ['materials', 'fx', 'weapons', 'ai', 'world', 'physics'];

const determinism = await parallel(
  DIRS_WITH_CLOCK.map((dir, i) => () =>
    agent(
      `You are fixing a determinism bug in src/${dir}/ of the FPS at ${ROOT}.

THE BUG — visual output depends on wall-clock time. Subsystems call
performance.now() (or otherwise read real time) to drive animation, instead of using
the engine clock in ctx.time. Consequence, measured: any change to boot duration or
frame pacing shifts rendered output. When a 1.4 s shader pre-warm was added, the
pixel gate reported mean channel deltas of ~1/255 on static shots and 2.6-3.9 on the
transient-heavy 'impacts' and 'muzzle' shots. That makes it IMPOSSIBLE to prove any
performance optimization is visually neutral, which blocks all the perf work behind
this phase.

YOUR JOB — in src/${dir}/ ONLY:
1. Find every read of wall-clock time used for anything that affects rendering,
   simulation or animation: performance.now(), Date.now(), new Date(), implicit
   timing from setTimeout/setInterval driving visual state, and any accumulator
   seeded from real time.
2. Route each one through the engine clock instead: ctx.time.elapsed (scaled
   seconds), ctx.time.raw, ctx.time.frame, or the dt/h handed to update/fixedUpdate.
   Read ${ROOT}/src/core/engine.js and ${ROOT}/src/core/config.js first.
3. LEAVE ALONE genuine instrumentation — a performance.now() pair used only to log
   how long an init step took does not affect output. Do not churn those. Report
   which ones you deliberately left and why.
4. Any randomness must come from ctx.rng, never Math.random(). Fix violations.

CONSTRAINT: this must not change the rendered image. It changes WHERE time comes
from, not what is drawn. Same frame index must produce the same pixels.

${GATE}

Your port is ${PORT(i)}. Read ${ROOT}/ARCHITECTURE.md first. Do not edit outside
src/${dir}/.`,
      {
        label: `determinism:${dir}`,
        phase: 'Determinism',
        agentType: 'general-purpose',
        schema: {
          type: 'object',
          required: ['dir', 'sitesFixed', 'gatePasses'],
          properties: {
            dir: { type: 'string' },
            sitesFixed: { type: 'array', items: { type: 'string' } },
            sitesLeftAlone: { type: 'array', items: { type: 'string' } },
            gatePasses: { type: 'boolean' },
            notes: { type: 'string' },
          },
        },
      }
    )
  )
);

// ------------------------------------------------------------ Phase 2
phase('Verify gate');
const gateCheck = await agent(
  `Verify the determinism fix actually landed, for the FPS at ${ROOT}.

Agents just edited ${DIRS_WITH_CLOCK.join(', ')} concurrently:
${JSON.stringify(determinism.filter(Boolean), null, 2)}

You may edit any file. Do this:
1. npx vite build — fix until clean.
2. Confirm the harness is still self-consistent (this must hold or nothing else
   is measurable):
     OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/v-a --port=5320
     OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/v-b --port=5320
     node tools/imagediff.mjs --a=/tmp/v-a --b=/tmp/v-b       # must be identical
3. THE REAL TEST — pre-warm burns ~1.4 s of wall clock before the frame loop. If
   the determinism fix worked, enabling it can no longer shift a single pixel:
     OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/v-off --port=5320 --query=prewarm=0
     OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/v-on  --port=5320 --query=prewarm=1
     node tools/imagediff.mjs --a=/tmp/v-off --b=/tmp/v-on
   Before the fix this reported ~78-88% of pixels changed, mean delta up to 3.9.
   It must now report identical: true.
4. If step 3 still fails, hunt the remaining wall-clock dependency yourself and fix
   it. Report exactly which file and line was responsible — that is the single most
   valuable output of this phase.
5. CAPTURE THE CANONICAL BASELINE that every optimization will be judged against:
     rm -rf ${ROOT}/shots/perf-base
     OW_NO_HMR=1 node tools/baseline.mjs --out=${ROOT}/shots/perf-base --port=5320
   This is the reference image set. Everything after this must match it exactly.
6. Once step 3 passes, flip pre-warm ON by default in src/boot.js (it is currently
   gated behind ?prewarm=1) and re-run step 3's comparison inverted to confirm the
   default path is the verified one.

Report honestly. If the gate cannot be made to pass, say so plainly — a false pass
here invalidates every optimization in the next phase.`,
  {
    label: 'verify:gate',
    phase: 'Verify gate',
    agentType: 'general-purpose',
    schema: {
      type: 'object',
      required: ['harnessDeterministic', 'prewarmPixelNeutral', 'buildPasses'],
      properties: {
        buildPasses: { type: 'boolean' },
        harnessDeterministic: { type: 'boolean' },
        prewarmPixelNeutral: { type: 'boolean' },
        culpritFiles: { type: 'array', items: { type: 'string' } },
        prewarmEnabledByDefault: { type: 'boolean' },
        notes: { type: 'string' },
      },
    },
  }
);

if (!gateCheck?.prewarmPixelNeutral) {
  log('WARNING: pixel gate still not neutral — optimizations below are unverifiable');
}

// ------------------------------------------------------------ Phase 3
phase('Optimize');
log('Phase 3: optimization fleet, every change gated on pixel identity');

const TASKS = [
  {
    dir: 'render',
    title: 'shadow caster culling + pass efficiency',
    brief: `The renderer submits EVERY opaque mesh to ALL cascades — the render author
flagged this themselves as the bulk of ~1350 draw calls. Fix:
- Cull casters per cascade by testing caster world-bounds against each cascade's
  frustum/sphere. A mesh 200 m away must not be drawn into the 5 m cascade.
- Skip cascades that contain nothing this frame.
- Reuse the depth prepass to avoid redundant vertex work where possible.
- Audit the post chain for redundant full-screen passes and render-target
  ping-pongs that can be merged into one shader without changing output.
- Cut shader PERMUTATION count: fewer unique programs means less compile stall.
  Look for onBeforeCompile injections that create near-duplicate programs which
  could share one program with a uniform branch — but only where the compiler
  cannot already fold it, and only if output is bit-identical.
- Add a prewarmMaterials() method so src/core/prewarm.js can compile your pass
  chain and shadow variants WITHOUT drawing gameplay frames.`,
  },
  {
    dir: 'world',
    title: 'draw call reduction and culling',
    brief: `~1350 draw calls and 5.9M triangles per frame. Reduce without changing
what is on screen:
- Merge static geometry that shares a material into fewer draws.
- Verify InstancedMesh is actually used for every repeated prop, with correct
  instance bounds so frustum culling works per-instance-batch.
- Add LOD for distant props and buildings, tuned so no popping is visible from any
  of the 11 shot cameras — the pixel gate will catch it if it is.
- Occlusion: the level is a street between solid buildings. Interiors should not be
  drawn when you are outside and vice versa. Portal or sector visibility.
- Add prewarmMaterials().`,
  },
  {
    dir: 'fx',
    title: 'particle and decal cost',
    brief: `Reduce per-frame cost of particles, decals and tracers with identical
output: ensure the particle sim is genuinely GPU-side rather than per-particle CPU
updates, that decals are batched into one draw per atlas rather than one per decal,
that dead particles cost nothing, and that nothing allocates at spawn. Add
prewarmMaterials() that builds and compiles every particle/decal/flash material
without spawning anything into the world.`,
  },
  {
    dir: 'ai',
    title: 'skinned mesh and pathfinding cost',
    brief: `Skinned meshes and per-frame AI logic are expensive. With identical
output: share skeletons/geometry across enemy instances, drop animation update rate
and IK for distant or offscreen actors (only where it cannot change a rendered
pixel in any shot), budget pathfinding across frames rather than solving many paths
in one frame, and ensure ragdoll solving sleeps once settled. Add
prewarmMaterials().`,
  },
  {
    dir: 'materials',
    title: 'texture memory and program count',
    brief: `~150 MB of VRAM in textures at ultra and a large program count. With
identical output: cut redundant texture sets, ensure every generated texture is
cached and shared rather than regenerated per caller, verify mips and anisotropy are
set once, and reduce the number of distinct material variants that produce distinct
shader programs. Also move texture generation off the boot critical path if it can be
done without changing first-frame output — boot is currently 2.2-3.9 s and was 29 s
on a cold remote load.`,
  },
];

const optimized = await pipeline(
  TASKS,
  (t, _orig, i) =>
    agent(
      `You are optimizing src/${t.dir}/ of the FPS at ${ROOT}. Task: ${t.title}

${t.brief}

${PERF}

${GATE}

Your port is ${PORT(30 + i)}. You own src/${t.dir}/ ONLY — other optimization agents
are editing the other subsystems right now. If your change requires something
outside your directory (for example a hook in src/core/prewarm.js), describe it in
needsElsewhere instead of editing it.

Read ${ROOT}/ARCHITECTURE.md first, then read your subsystem's code properly before
changing anything. Report measured numbers, not impressions: profiler output before
and after, at least 3 runs each, plus the imagediff verdict.`,
      {
        label: `opt:${t.dir}`,
        phase: 'Optimize',
        agentType: 'general-purpose',
        schema: {
          type: 'object',
          required: ['dir', 'changes', 'gatePasses', 'before', 'after'],
          properties: {
            dir: { type: 'string' },
            changes: { type: 'array', items: { type: 'string' } },
            reverted: { type: 'array', items: { type: 'string' }, description: 'Optimizations abandoned because they failed the pixel gate' },
            gatePasses: { type: 'boolean' },
            before: { type: 'string', description: 'profiler numbers before' },
            after: { type: 'string', description: 'profiler numbers after' },
            needsElsewhere: { type: 'string' },
          },
        },
      }
    ),
  // Each subsystem's result is independently verified as soon as it lands, rather
  // than waiting for the slowest agent.
  (res, t) =>
    res && res.gatePasses === false
      ? agent(
          `The optimization of src/${t.dir}/ at ${ROOT} reported FAILING the pixel gate:
${JSON.stringify(res, null, 2)}

Either make it pixel-identical or revert it. A faster build that changes the image is
not acceptable — the user's requirement is exact visual parity. Verify with
tools/baseline.mjs + tools/imagediff.mjs on port ${PORT(40)} and report which
optimizations survived.`,
          { label: `repair:${t.dir}`, phase: 'Optimize', agentType: 'general-purpose', schema: { type: 'object', properties: { dir: { type: 'string' }, survived: { type: 'array', items: { type: 'string' } }, reverted: { type: 'array', items: { type: 'string' } }, gatePasses: { type: 'boolean' } }, required: ['gatePasses'] } }
        ).then((r) => ({ ...res, repair: r }))
      : res
);

// ------------------------------------------------------------ Phase 4
phase('Measure');
const final = await agent(
  `Final integration and measurement for the FPS at ${ROOT}.

The optimization fleet edited render, world, fx, ai, materials concurrently:
${JSON.stringify(optimized.filter(Boolean).map((o) => ({ dir: o.dir, changes: o.changes, gate: o.gatePasses, needs: o.needsElsewhere, reverted: o.reverted })), null, 2)}

You may edit any file. Apply any sound cross-cutting changes the agents requested
(needsElsewhere), especially prewarmMaterials() hooks into src/core/prewarm.js so
pre-warm no longer needs to draw gameplay frames.

Then produce the definitive verdict:
1. npx vite build — clean.
2. THE GATE, over all 11 shots, against the pre-optimization baseline at
   ${ROOT}/shots/perf-base, which the 'Verify gate' phase captured AFTER the
   determinism fix and BEFORE any optimization (do NOT use shots/pw3-off — it
   predates the visual repair passes, so it would flag intended art changes as
   regressions):
     OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/final --port=5360
     node tools/imagediff.mjs --a=${ROOT}/shots/perf-base --b=/tmp/final
   Report the verdict honestly. If ANY shot changed, identify which optimization did
   it and revert that one.
3. Profile 3+ times: node tools/profile.mjs --port=5360 --dpr=2 --frames=900
   Report p50/p95/p99 fps, worst frame, hitch count, and programs compiled during
   play — with the spread across runs.
4. Also measure a COLD shader cache run if you can, since that is the first-load
   experience and where the 3.1-3.9 s stalls appeared.
5. Confirm the game still plays: node tools/playtest.mjs

Report real numbers and an honest assessment of whether the target (p99 >= 60 fps,
no frame > 30 ms, zero pixel change) was met, partially met, or missed.`,
  {
    label: 'final:measure',
    phase: 'Measure',
    agentType: 'general-purpose',
    schema: {
      type: 'object',
      required: ['pixelIdentical', 'fps', 'targetMet'],
      properties: {
        buildPasses: { type: 'boolean' },
        pixelIdentical: { type: 'boolean' },
        changedShots: { type: 'array', items: { type: 'string' } },
        fps: { type: 'string' },
        worstFrameMs: { type: 'number' },
        hitchCount: { type: 'number' },
        programsDuringPlay: { type: 'number' },
        coldCacheNotes: { type: 'string' },
        targetMet: { type: 'string', enum: ['met', 'partial', 'missed'] },
        honestAssessment: { type: 'string' },
        stillPlayable: { type: 'boolean' },
      },
    },
  }
);

return { determinism: determinism.filter(Boolean), gateCheck, optimized: optimized.filter(Boolean), final };
