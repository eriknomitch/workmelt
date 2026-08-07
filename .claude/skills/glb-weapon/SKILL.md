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

## The premise: bake, never load

**Nothing is loaded from disk at runtime, ever.** `AGENTS.md` forbids runtime
dependencies and CDN fetches — "every asset the game needs ships in the
bundle, so it runs fully offline" — and `assets-src/*` is gitignored precisely
because nothing in it is shippable. There is no `GLTFLoader` in the client and
there must not be one.

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

Also read `src/weapons/models/pistol.js` end to end — it is the shortest
complete example of the contract, and a downloaded handgun maps onto it almost
line for line. `src/weapons/models/baked.js` documents the runtime API
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
- **Part names and centres.** Exports name everything `Object_12`, so the
  centre and extent columns are the only way to tell the slide from the
  trigger. Match them against the shape you can see in the model.

If you cannot tell the parts apart from the table alone, bake once with
everything in one material and look at it (step 4) before committing to a
split.

### 2. Decide placement, then the material map

**Placement.** Compose `--rot`, `--scale` and `--origin` until the model sits
in engine space: muzzle down −Z, bore axis on +Y up, origin at roughly the web
of the firing hand (`pistol.js` puts the bore 36 mm above origin). `--origin`
is applied *after* `--rot`/`--scale`, so read the printed bounds, then
subtract. Iterate on the inspect command — it is instant and writes nothing.

**Materials.** Save the printed scaffold next to the baked output as
`src/weapons/models/<id>.materials.json` and map every glTF material name to
an engine key. Committing it keeps the re-bake command in the generated file's
header reproducible. The valid keys are printed by the tool and enumerated in
`references/weapon-contract.md`.

Do not leave everything on one key. A gun that is uniformly `steel` reads as a
toy; the polymer/alloy/rubber split across frame, receiver and grip is most of
what sells it as a real object.

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
   pipeline's signature silent failure.
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

### 6. Verify

```
node src/weapons/models/baked.selftest.mjs
node src/weapons/balance.selftest.mjs
node src/weapons/loadout.selftest.mjs
node src/weapons/autoreload.selftest.mjs
npm run build
```

Then **look at it**, which for a weapon is not optional — every remaining
failure mode in this pipeline is visual. Use the `visual-check` skill, and the
weapons preview harness, which exists for exactly this:

```
/src/weapons/preview.html?w=<id>&view=hero    # also: side, muzzle, optic, grip, hands, ads, reload
```

Write captures to `.shots/<id>-<view>.png`, read them back with the Read tool,
and say what you saw. Check in this order: silhouette and scale against the
existing guns, then the material split, then the hands, then the animations.

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
- **Check the licence.** `assets-src/models/*/license.txt` — a CC-BY model
  needs attribution before it ships. Surface the terms to the user; do not
  decide licensing on their behalf.
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
