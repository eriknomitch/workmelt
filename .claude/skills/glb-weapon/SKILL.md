---
name: glb-weapon
description: >-
  Turn a premade 3D model (.glb / .gltf, typically a downloaded gun) into a
  playable Workmelt weapon. Use this skill whenever the user drops a .glb or
  .gltf into the repo and wants it in the game, asks to add a gun, rifle,
  pistol, SMG or sniper from a downloaded or purchased model, asks how to
  load or import a 3D model as an asset, mentions Sketchfab / CGTrader /
  assets-src/models, or wants to swap or replace one of the four existing
  weapons with a model-derived one. Also use it for questions about how
  premade meshes get into this engine if the intent is to ship one.
---

# Premade model -> Workmelt weapon

This skill takes a `.glb` and produces a weapon the player can select, fire,
reload and kill with: a committed geometry module, a builder in
`src/weapons/models/`, a balanced entry in `defs.js`, and a green set of
self-tests.

## The premise: bake, because a weapon is static geometry

**For a weapon, nothing is loaded from disk at runtime.** That is a decision
about weapons, not a blanket ban — see "Importing a 3D model" in `AGENTS.md`.
A rigged, animated character is the other case and takes the `GLTFLoader` +
`MeshoptDecoder` path, because the bake discards skins and clips by design.

A weapon is static single-material geometry whose animation comes from
`clips.js` driving named attachment nodes, so it loses nothing to the bake and
gains everything below. If you are here for a gun, bake it.

`AGENTS.md` forbids runtime
dependencies and CDN fetches — "every asset the game needs ships in the
bundle, so it runs fully offline" — and `assets-src/*` is gitignored because
the master is never the shipped artefact. Baking satisfies that with no loader
in the bundle at all, which is strictly cheaper than the alternative for
geometry that carries nothing a loader would preserve.

Instead, `tools/glb-bake.mjs` converts the model **offline** into a plain ES
module of quantised typed arrays that `src/weapons/models/` imports like any
other source file. This is the SFX pipeline applied to geometry: the untracked
master lives in `assets-src/`, a tool converts it, and the *output* is what
gets committed.

What that buys, concretely: no loader in the bundle, no fetch, no parse cost
on a boot `TEXTURE-PERF.md` already measures at 3.27 s of blocking work,
determinism for `tools/baseline.mjs`, and a diff that shows part names,
materials and triangle counts as plain text.

The model is geometry and nothing else. Its materials, UVs, tangents, skins
and animations are all discarded — the engine's look comes from the procedural
material library plus the curvature-mask bake, and its animation comes from
`clips.js` driving named attachment nodes. **Supplying those nodes is the real
work of this skill, not the mesh.**

## Reference files — read before writing code

- `references/weapon-contract.md` — the model return shape, the complete node
  table (required vs per-mechanism), the material keys, the `defs.js` balance
  contract, the LOADOUT decision, and every verification command. Read it in
  full before authoring the builder.

**`src/weapons/models/g31.js` is the worked example** — the first weapon built
this way, end to end: the bake command in its header, the assembly split, nodes
derived from `bakedBounds`, a generated magazine standing in for one the source
lacked, and honest UNVERIFIED notes where a static capture could not prove a
number. Read it alongside `src/weapons/models/g31.materials.json`. Start there.

Also read `src/weapons/models/pistol.js` end to end — it is the shortest fully
procedural example of the contract, and it is what `g31.js` was derived from. `src/weapons/models/baked.js` documents the runtime API
(`addBaked`, `requireBaked`, `bakedBounds`). `ARCHITECTURE.md` covers the
engine contract if you need to touch anything outside `src/weapons/`.

## Workflow

### 1. Inspect the model before touching anything

```
node tools/glb-bake.mjs assets-src/models/<file>.glb --id=<id>
```

The tool reads the binary container only. **A `.gltf` + `.bin` pair must be
converted first** — `gltf-transform copy in.gltf out.glb`, or re-export as
glTF Binary from Blender. Downloads arrive in both shapes, so check before
assuming.

With no `--out` this writes nothing and prints a part table plus a
material-map scaffold. Read it carefully — everything in step 2 comes from it:

- **Triangle count.** Budget: the four shipped weapons are 8k–24k triangles.
  Past ~30k, say so and propose decimating in the source tool first.
- **Extent.** The engine works in metres. A real handgun is ~0.20–0.26 m long,
  a carbine ~0.75–0.90 m. If the extent is 100× or 0.01× that, the export is
  in centimetres and needs `--scale`.
- **Which axis is long.** The engine points weapons down **−Z**. Sketchfab
  exports routinely point down +X or +Y.
- **Groups before part names.** Exports name every leaf `Object_12`, but the
  PARENT nodes are usually named by whoever built the model — `RMR_0`, `G31_1`,
  `RMR CUT_2` — and that is exactly the split a weapon wants. The `group`
  column carries it, and selectors match either name, so prefer
  `include: /RMR/` over enumerating leaves that a re-bake could renumber.
- **Centres and extents** disambiguate the rest: a 0.223 m part at slide height
  is the slide, a 0.002 m-thick blade inside the trigger guard is the trigger.

If the table alone is not enough, do not bake blind and squint at a render —
project the geometry. A ~60-line throwaway in `scratch/` that scanline-fills
each part's triangles into an ASCII side elevation (across = Z, up = Y) makes
the slide, grip, trigger guard and optic instantly obvious, costs one round
trip, and needs no browser. That is how the G31 was identified.

### 2. Decide placement, then the material map

**Placement.** Compose `--rot`, `--scale` and `--origin` until the model sits
in engine space: muzzle down −Z, bore axis on +Y up, origin at roughly the web
of the firing hand (`pistol.js` puts the bore 36 mm above origin). `--origin`
is applied *after* `--rot`/`--scale`, so read the printed bounds, then
subtract. Iterate on the inspect command — it is instant and writes nothing.

**Aim the placement at the weapon you are replacing.** Landing the bore height
and the slide/receiver rear on the same numbers as the existing weapon is worth
real effort, because it makes that weapon's *solved* hand targets a legitimate
starting point instead of a guess. The G31 bake picks `--origin=0,0.303,0.0316`
for exactly this: bore at y 0.036 and slide rear at z 0.052, both the P-19's.
Everything downstream of §4.3 gets cheaper.

**Materials.** Save the printed scaffold next to the baked output as
`src/weapons/models/<id>.materials.json` and map every part to an engine key.
Committing it keeps the re-bake command in the generated file's header
reproducible. Keys resolve **most specific first** — `"<group>/<node>"`,
`"<node>"`, `"<group>"`, then the glTF material name — because a modeller
reuses a material for whatever was the same colour in the viewport. On the G31
one `Material.001` covers both the red-dot housing and the polymer grip, so
material-name keys alone cannot express it. Keys starting with `_` are notes.

Three things that are not guesses (all detailed in the contract doc §5):

- **The optic lens is `glass`.** Any other key gives you a sight that looks
  perfect from outside and is opaque the instant you aim through it. Nothing
  warns you; only `?view=ads` shows it.
- **Prefer `steel_soot` over `steel_black` for an imported slide.**
  `steel_black` has the library's highest wear amplitude (0.24) and the wear
  mask is per-vertex, so on faceted geometry it bleaches whole panels white.
- Do not leave everything on one key. The polymer/alloy/rubber split across
  frame, receiver and grip is most of what sells it as a real object.

### 3. Bake

```
node tools/glb-bake.mjs assets-src/models/<file>.glb \
  --id=<id> --out=src/weapons/models/<id>.data.js \
  --map=src/weapons/models/<id>.materials.json \
  --rot=0,90,0 --origin=0,0.303,0
```

Commit the `.data.js` and the `.materials.json`. Never edit the `.data.js` by
hand — it is generated, and its header carries the exact command to reproduce
it.

### 4. Author the builder

Create `src/weapons/models/<id>.js` returning the model contract (the full
shape is in `references/weapon-contract.md`). The order that works:

1. **Split the assemblies.** Body first, then one `Assembly` per moving part
   using `requireBaked` with a selector over the part node names. A slide,
   magazine and trigger that stay in the body can never animate. Use
   `requireBaked`, not `addBaked` — a selector that matches nothing is this
   pipeline's signature silent failure. Author the BODY as an *exclusion*, so a
   part added by a future re-bake lands on the frame — visible and wrong —
   rather than silently vanishing.

   Two things to check in the source before splitting, both common:

   - **Is the optic slide-mounted?** If the optic sits directly on the slide's
     top face it recoils with it and belongs in the slide assembly. Left on the
     frame it hangs in the air while the slide cycles underneath.
   - **Is there a magazine at all?** Often not — the grip and magwell are one
     solid part with nothing below the grip floor. Check whether any part's
     min-Y reaches past the grip. If none does, generate one with
     `buildMagazine` from `parts.js`, exactly as `pistol.js` does.
2. **Derive nodes from geometry, not guesses.** `bakedBounds(PARTS, /slide/)`
   gives you the real numbers for muzzle, ejection port, sight and magazine
   seat. Write the derivation down in a comment.
3. **Hand targets last, and expect to iterate.** `gripR`/`gripL` are **wrist**
   targets, not palms, derived as `knuckle − 0.098 × finger`. They are the one
   thing that cannot be got right from numbers alone — see the contract doc and
   the long derivation comments in `rifle.js`.

### 5. Wire it into the game

A mesh that renders is not a weapon. Read the LOADOUT section of
`references/weapon-contract.md` and decide, **with the user**, whether this
replaces one of the four slots or extends the loadout — the two paths differ
in what else has to change. Then add the `defs.js` entry against the balance
contract (a shots-to-kill number, not a feel number) and register the builder.

**The weapon id is a key into other subsystems, and all of them fail quietly.**
Contract doc §7 has the table; the ones that bite are `FOLEY_ALIASES` in
`src/audio/samples.js` (reload foley, else all four phases drop to synthesis)
and the `resolveProfile` regex in `src/audio/weapons.js` (else the gun fires
with the wrong shot profile). Both are keyed on the *hardware*, so a new gun
that is mechanically an existing one should alias to it rather than get its own.

If you are replacing a slot, keep the terminal ballistics of the weapon you
replaced unless the user asks otherwise. The slot's damage and rpm ARE the
balance contract; a new model is a reason to change how a gun handles, not how
hard it hits. Spend the character on recoil, bloom and handling instead.

### 6. Verify

Run the **whole free sweep**, not just the weapon suites — a new weapon id
reaches into audio, and `src/audio/reload.selftest.mjs` is what catches it:

```
for f in $(find src server \( -name 'selftest.*' -o -name '*.selftest.*' \) \
    | grep -v '^server/' | grep -v 'src/audio/selftest.js' | sort); do
  node "$f" >/dev/null 2>&1 || echo "FAIL $f"
done
npm run build
```

Then **look at it**, which for a weapon is not optional — every remaining
failure mode in this pipeline is visual. Use the `visual-check` skill, and the
weapons preview harness, which exists for exactly this:

```
/src/weapons/preview.html?w=<id>&view=hero    # also: side, muzzle, optic, grip, hands, ads, reload
```

`tools/capture.mjs` cannot shoot this page (it is `--shot=` registry-driven), so
drive it with a small playwright script in `scratch/` — one page per view,
~4.5 s settle for the material bake, screenshot to `.shots/<id>-<view>.png`.
Listen for `pageerror` while you are there; a builder that throws still leaves
you a plausible-looking sky.

**`?view=ads` is mandatory, not optional.** It is the only view that shows
whether the optic is transparent, and an opaque lens looks perfect in every
other view. Check in this order:

1. `side` — silhouette, scale and material split against the existing guns
2. `ads` — **can you see through the sight?** plus the reticle
3. `hero` — how it reads in the round
4. `grip` / `hands` — hand placement, expect to iterate

**Know what a static view cannot prove.** A seated magazine is entirely inside
the grip, and `?view=reload` samples the clip at `t=0` before anything moves,
so `magSeat` is *not* verifiable from these captures — say it is underived
rather than implying it passed. Use `&t=<seconds>` to sample mid-clip if you
need it.

### 7. Report

Say what the source model was, its triangle count, which parts moved into
which assembly, how the hand targets were derived, which checks ran, and which
views you actually looked at. If you skipped a render because the environment
had no GPU, say that explicitly rather than implying a pass.

## Hard rules (the ones that are easy to break silently)

- **Never add a runtime loader or fetch a model file.** The bake is the only
  path. No `GLTFLoader` import in `src/`.
- **Never hand-edit a `.data.js`.** Re-bake instead; the header has the command.
- **Never commit the source `.glb` outside `assets-src/`** — it stays
  untracked, like the SFX masters.
- **`requireBaked`, not `addBaked`, for every moving part.** An empty assembly
  renders perfectly and silently stops the gun cycling.
- **Check the licence FIRST**, before any other work — it can invalidate the
  whole task. `assets-src/models/*/license.txt`. Baking geometry into source
  does not dissolve a CC-BY obligation: the credit ships. Add it to
  `public/models/CREDITS.md` (the established location, mirroring
  `public/sfx/CREDITS.md`) and surface the terms to the user rather than
  deciding licensing on their behalf.
- **The optic lens is material key `glass`.** Not `alu_fine`, not
  `steel_bright`. Anything else is opaque under ADS and silent everywhere else.
- **The weld keys on position *and* normal.** If you ever touch it: a
  position-only weld smooths every hard edge on a low-poly gun and looks like a
  material bug. `baked.selftest.mjs` guards this.
- Do not hard-code a hex colour or a material anywhere; surfaces come from the
  keys in `src/weapons/materials.js`.
- Use the seeded rng the subsystem hands you, never `Math.random()` — captures
  must reproduce.

## New files this skill adds to the repo

`.claude/*` is gitignored with narrow re-includes, so **new skill files need
`git add -f`**. Existing tracked ones keep tracking. Verify with
`git check-ignore -v <path>` before assuming a file will be committed.
