# Texture packs and texture cost — investigation

**Question asked:** would a texture-pack system (or some other change to how textures
work) buy us performance, for the world and for the player models?

**Short answer.** A *shipped* texture pack — offline-authored KTX2/Basis assets
downloaded and transcoded at runtime — is the wrong tool here, and it is the one
thing this repo is explicitly built not to do. But the question underneath it is
the right one: textures **are** the most expensive thing in the frame, and there is
a "pack"-shaped answer that fits the engine's rules. Today a surface is baked as
three uncompressed RGBA8 maps and read by a shader that issues 26–32 texture
fetches per pixel; the library alone holds **288 MB** of texture memory at `high`.
The wins are in *how the maps are packed and sampled*, not in where they come from.

For the player models the answer is different and much simpler: characters are not
texture-bound at all, they are **draw-call** bound. Each soldier costs **51.7 draw
calls per frame**, and about three quarters of those are pure waste.

Everything below was measured on this branch. Reproduce with `node tools/texcost.mjs`
and `node tools/drawcalls.mjs` (both added here).

---

## 1. What the engine does today

There are two independent texture systems, and they do not resemble each other.

| | `src/materials/` (world, props, weapons) | `src/ai/textures.js` (characters) |
|---|---|---|
| baked on | GPU, one fragment program per surface | **CPU, per-texel JavaScript loops** |
| output | 3 × RGBA8 render targets (albedo+height / ORM / normal) | 3 × RGBA8 `DataTexture` + a detail tile |
| resolution | scales with the quality preset (×0.5 / ×0.75 / ×1) | **fixed 512 px at every preset** |
| bake cost | ~10–50 ms total on real hardware | **3.27 s, blocking the main thread** |
| consumed by | one heavily extended `MeshStandardMaterial` (`shader.js`) | plain `MeshStandardMaterial` + a small `onBeforeCompile` |

`src/materials/generator.js` is genuinely good: four full-screen draws per surface,
nothing read back to the CPU, the render targets *are* the textures. The character
baker is the same idea written the slow way.

## 2. Measurements

### Texture memory

`node tools/drawcalls.mjs --shot=combat --quality=high` — 6 characters in frame:

```
texture memory    326.7 MB (RGBA8 + mips)
  materials:library     288 MB
  ai:characters         38.7 MB
27 baked texture sets, 58 material instances
```

`node tools/texcost.mjs --quality=high` breaks the library down. Nineteen surfaces,
thirteen of them baked at 1024 px:

```
library sets      232.0 MB  (19 surfaces, one bake each)
shared detail      10.7 MB
shared macro        0.3 MB
TOTAL (baseline)  243.0 MB
```

The gap between the 243 MB baseline and the 288 MB observed is the **twelve extra
sets `src/weapons/materials.js` requests via `bake:` overrides** — most of them
differ from a library entry only by a seed or a tint, and each one costs a full
three-map set. At `low` the same scene is 118 MB.

Every map is RGBA8 with a full mip chain. Nothing is compressed, because nothing
can be: these textures do not exist until the GPU draws them at boot.

### Fetches per pixel

Counted straight out of `MAIN_FRAGMENT` in `src/materials/shader.js`, following
the same feature gates `extendMaterial` compiles in:

```
surface          mode       near  far   breakdown
concrete         planar     32    13    POM ~17 + base 3 + detile 4 + detail 2 + macro 2 + macroBig 2 + weather 2
plaster          planar     32    13    POM ~17 + base 3 + detile 4 + detail 2 + macro 2 + macroBig 2 + weather 2
asphalt          planar     32    13    POM ~17 + base 3 + detile 4 + detail 2 + macro 2 + macroRelief 2 + weather 2
brick            planar     29     9    POM ~18 + base 3 + detail 2 + macro 2 + macroBig 2 + weather 2
sand/dirt/gravel triplanar  17    15    triplanar x3 = 9 + detail 2 + macro 2 + macroRelief 2 + weather 2
glass            planar      9     7    base 3 + detail 2 + macro 2 + weather 2
```

Concrete and plaster are most of every frame's screen area, and near the camera
they cost **32 texture fetches per pixel**. The surface shader runs exactly once
per visible fragment — the prepass and the four shadow cascades both use
`scene.overrideMaterial`, so they are cheap. That is already the right design; the
cost is concentrated in one place, which also makes it the one place worth
attacking.

Two things stand out:

- **The parallax march is over half the near-field budget.** `owPOM` issues
  ~17 taps, and every tap is a full RGBA8 anisotropic sample of the sRGB albedo
  texture — to read **one channel**, `albedo.a`. At `high` the anisotropy is 16.
- **The detail layer is sampled even when it contributes nothing.** Lines 375 and
  385 fetch `owDetailNrm` and `owDetailTex` unconditionally, then multiply the
  result by `detFade`, which is 0 past `detail[3]` metres (16–26 m for most
  surfaces). Every distant pixel in the frame pays two fetches for zero.

### Draw calls — the characters

`node tools/drawcalls.mjs --shot=combat --quality=high`:

```
frame total       1724 draw calls, 11.35M triangles

system      draw calls  share   triangles
ai          310         18.0%   820,342
world       1266        73.4%   10,419,174

6 characters, 9 material groups each (25,698 tris of geometry).
  51.7 draw calls per character = 9 groups x ~5.7 passes.
```

Six bots — a *small* garrison; the match view lets a player ask for far more —
already account for **18% of the frame's draw calls**. The arithmetic is exact:
nine material groups (`MATERIAL_SLOTS` in `src/ai/soldier.js`) × the forward pass +
the prepass + four shadow cascades.

The prepass and the cascades draw with `scene.overrideMaterial`. Three still emits
one draw call **per geometry group** in those passes, so a soldier is drawn nine
times into each cascade with the identical depth-only material. And the prepass's
only per-object input is `object.userData.owMatId` — per *object*, not per group
(`src/render/prepass.js:129`). Those 5 override passes × 9 groups = **45 of the
51.7 calls, producing bit-identical output to 5 calls.**

### Boot

```
[ai] materials 3269ms (3267ms texture bake)
```

3.27 seconds of blocking main-thread JavaScript, at every quality preset, before
the first frame. It does not scale with the preset because `src/ai/index.js:63`
hardcodes `size: 512`. For comparison, the whole GPU-baked world library is
~10–50 ms on real hardware.

## 3. Would a shipped texture pack (KTX2 / Basis) help?

It would help *memory*, not fill rate — and it collides with three hard rules in
`AGENTS.md` and `ARCHITECTURE.md`.

**What it would buy.** GPU-compressed formats stay compressed in VRAM and are
decompressed by fixed-function hardware at sample time, so BC7/ASTC at 8 bpp would
cut that 288 MB to roughly 72 MB, and ETC1S/BC1 at 4 bpp to ~36 MB. It also
removes the bake entirely. On an integrated or mobile GPU that memory reduction is
worth real frames, because texture *bandwidth* is what a 32-fetch shader is
actually limited by.

**Why it does not fit.**

- The rules are explicit: no new npm dependencies, no CDN fetches, and "textures,
  meshes and animation are generated procedurally at load time". A pack is
  authored assets by definition.
- Download size goes the wrong way. The whole point of generating this content is
  that the bundle stays tiny; 19 surfaces × 3 maps × 1 K of BC7 is ~70 MB to ship
  and re-download per release.
- **You cannot compress at runtime.** WebGL2 can *sample* compressed textures but
  cannot render into them; there is no compute shader. Producing BC7 from a
  GPU-baked texture would mean a full readback and a CPU encode — orders of
  magnitude worse than the bake it replaces. GPU BCn compressors exist, but in
  compute-shader APIs (D3D/Vulkan/Metal), not WebGL2. Real-time DXT was designed
  for exactly this "textures created procedurally at run time" case, but it needs
  a compute path WebGL2 does not have.
- `KTX2Loader` also needs the Basis transcoder wasm shipped alongside it.

If the project ever moves to `WebGPURenderer`, this changes: compute shaders make
runtime BCn/ASTC compression of a procedurally baked texture practical, and it
becomes the single biggest available win. Worth revisiting then, not now.

## 4. What a "texture pack" should mean here

A pack in this engine is not a folder of PNGs. It is **a per-surface descriptor of
how the maps are packed, at what resolution, and which shader layers get compiled
in** — chosen by the quality preset and by distance. `src/materials/library.js` is
already 90% of that descriptor. Ranked by payoff over effort:

### A. Give characters a group-less geometry for the override passes
**~51.7 → ~14 draw calls per character. Pixel-neutral by construction.**

A second `BufferGeometry` sharing the *same* `BufferAttribute` objects (so no extra
GPU memory) with no `groups`, swapped in around the prepass and the cascades. The
render system already walks the scene and toggles per-object state around those
passes (`_collect`, and `csm.js` flipping `visible`), and already has the
`userData.owNoPrepass` / `owNoShadow` convention to extend. Because both passes use
`overrideMaterial` and the prepass's `owMatId` is per-object, the output is
identical. This is the single best change in this document.

### B. Sample the parallax march from a dedicated R8 height map
**Removes ~17 RGBA8 aniso-16 fetches per near pixel on every architectural surface.**

The march needs one channel. Bake a fourth output — an R8 (or LuminanceFormat)
height map, `anisotropy = 1` — and point `owPOM` at it. Costs +1.3 MB per 1 K
surface against 5.33 MB for an RGBA8; the final `alb.a` read stays as it is, so the
shading is unchanged. Pair it with dropping anisotropy on the ORM and normal maps,
which do not need 16× either.

### C. Fold the ORM and normal maps into one RGBA8
**3 maps → 2: −33% library VRAM (≈ −96 MB at `high`) and one fewer fetch per tap.**

Pack `(normal.x, normal.y, roughness, ao)` and reconstruct `normal.z`. Metalness is
constant per surface for 16 of the 19 library entries — `ARCHITECTURE.md` requires
metals to be 0 or 1 — so it becomes a uniform, and only `metal_rust`,
`metal_painted` and `corrugated` keep a third map. On triplanar surfaces this saves
three fetches, not one.

### D. Guard the detail fetches
**−2 fetches on every pixel past ~16–26 m. Two lines.**

`if (detFade > 0.0) { … }` around the `owDetailNrm` / `owDetailTex` samples. The
sampling is already `textureGrad` with explicit gradients, so non-uniform control
flow is legal and the mip selection does not change.

### E. Deduplicate the weapon bake overrides
**≈ −45 MB at `high`.**

Twelve of the 27 live sets come from `src/weapons/materials.js` passing `bake:`
overrides that differ only by seed or tint. `shader.js` already has an `owTintCol`
uniform; a tint variant does not need its own bake.

### F. Half-resolution ORM
**Another ~25% off what survives C.** Standard practice; roughness and AO carry no
high-frequency detail the normal map does not already carry.

## 5. The player models specifically

Beyond (A), which is the big one:

1. **The character bake belongs on the GPU.** `src/ai/textures.js` reimplements, in
   scalar JavaScript, exactly what `TextureForge` does in a fragment shader —
   value noise, fbm, ridged noise, a Sobel pass. Porting the seven surface
   functions to GLSL would take that 3.27 s to tens of milliseconds and make the
   resolution preset-scalable for free. It is the largest single item in boot.
2. **Failing that, scale the size by preset.** One line at `src/ai/index.js:63`.
   Measured: 512 px → 2793 ms, 256 px → 766 ms, 128 px → 212 ms. At `low` /
   `performance` a 256 px character set is 3.6× faster to bake and drops character
   VRAM from 38.7 MB to 9.7 MB.
3. **Then atlas the nine slots.** A `DataArrayTexture` (WebGL2 `sampler2DArray`,
   which this project can already assume) with a per-vertex layer index collapses
   the forward pass to one or two draw calls as well, taking a character from 51.7
   to ~6. This is more invasive than (A) — the long comment on `MATERIAL_SLOTS`
   warns that material creation order is load-bearing for coplanar sorting, and
   merging the slots changes exactly that — so it wants its own pass through the
   pixel gate. Do (A) first and measure whether (3) is still worth it.
4. **The characters have no geometry LOD.** 25,698 triangles each at every
   distance, drawn into four cascades. `_updateRelevance` culls off-screen actors
   from the cascades, but an on-screen soldier at 60 m still draws full detail six
   times. That is a bigger number than anything textures can give back, and it is
   the obvious next investigation.

## 6. What this does not cover

The container this ran in has no GPU — Chromium fell back to SwiftShader — so
**every number here is a count, not a time**: draw calls, texture fetches, bytes
and CPU-side milliseconds, all of which are hardware-independent. I deliberately
did not report frame times or predict an FPS delta, and an A/B of the shader
layers through `material.defines` was inconclusive for the same reason (the
software rasteriser's own overhead swamped a 5% signal).

The estimates in section 4 are therefore stated as *fetch counts and bytes
removed*, not as frames. Before landing any of them, run `tools/profile.mjs` on
real hardware for the baseline, and `tools/baseline.mjs` for the pixel gate — (A)
and (E) should be pixel-exact, (B) and (D) should be within rounding, and (C) and
(F) will move pixels and need a look.
