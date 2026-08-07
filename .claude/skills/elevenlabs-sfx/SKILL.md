---
name: elevenlabs-sfx
description: >-
  Generate a sound effect with ElevenLabs and ship it into the game through the
  existing SFX pipeline — masters in assets-src/eleven/, a curation entry in
  tools/sfx-sources.mjs, encoded Opus in public/sfx/, credits, and the wiring
  (if any) that makes the game actually play it. Use this skill whenever the
  user asks to create, generate or AI-generate a sound effect, replace or
  improve one of the game's sounds with a generated one, mentions ElevenLabs /
  /sound-effects / sound-generation for this game, or asks how a new sound
  gets into the audio system with the intent of adding one.
---

# ElevenLabs sound effect -> shipped Workmelt sound

This skill takes a text description and produces a sound the game actually
plays: generated masters in `assets-src/eleven/`, a curation entry in
`tools/sfx-sources.mjs`, committed 48 kHz mono Opus in `public/sfx/` with an
updated `manifest.json` and `CREDITS.md`, plus whatever engine wiring the
target needs — which is usually none.

## The premise: samples overlay synthesis, they never replace it

The runtime synthesises every voice it needs (`src/audio/weapons.js`,
`foley.js`, `vox.js`). `src/audio/samples.js` loads `public/sfx/manifest.json`
in the background and `AudioSystem._build()` *prefers* a sample per
`(group, key)`, falling back to synthesis on any miss — a missing or
undecodable file is silent degradation, never an error. So a generated sound
is an upgrade to an existing hook, and the pipeline is the same one the CC0
packs and the authored reload foley already ride:

```
ElevenLabs API ─▶ assets-src/eleven/<key>_<i>.wav   (master, committed)
                       │  entry in tools/sfx-sources.mjs
                       ▼
              node tools/encode-sfx.mjs <group>
                       ▼
       public/sfx/<group>/<key>_<i>.opus + manifest.json + CREDITS.md
                       ▼
     src/audio/samples.js picks it up — zero engine code for existing kinds
```

Rule 3 of `AGENTS.md` stays satisfied: ElevenLabs is called **offline, at
authoring time**. Nothing in the bundle fetches anything; the committed Opus is
what ships.

## Step 0 — route by target, and ask if it is ambiguous

Decide *where in the game* the sound plays before generating anything. Two
cases, very different in cost:

**Case A — the kind already exists (the goal; steer here).** The target is an
existing `(group, key)` that `_build()` dispatches on: a `shot` weapon profile,
a `step` surface, an `impact` surface, a `ui` cue, a `vox` announcer line, a
`reload` phase. Enumerate what exists from `public/sfx/manifest.json` and the
`GROUP` table in `src/audio/samples.js`. Everything is curation-table-only.

**Case B — a genuinely new sound.** Needs a new `kind`: an emitter somewhere
(`ctx` event → `audio.play(kind, position, opts)`), a `GROUP` entry in
`samples.js` (jitter/send), a synthesized fallback voice (or an explicit,
commented decision that this kind is sample-only and silent without assets),
and a bus/priority choice. Read `ARCHITECTURE.md` and the header of
`src/audio/index.js` first. This is real engine work — confirm scope with the
user before doing it.

If the user's request does not obviously map to a group/key ("make a cool
explosion sound" — grenade impact? new ambience?), **ask** rather than guess.

## Step 1 — API key

The generation call needs `ELEVENLABS_API_KEY`. If it is unset or rejected
(401), invoke the `setup-api-key` skill rather than improvising. The
`sound-effects` skill has the full API reference; the one call this pipeline
needs is below.

## Step 2 — generate the masters

Generate into `assets-src/eleven/` — these are *our* authored takes, committed
like `assets-src/vox|reload|shot` (see step 3 for the gitignore exception).
Request a high-quality format; everything is re-encoded to Opus anyway, so
`mp3_44100_192` is fine and `pcm_44100` (headerless — wrap or just use mp3) is
overkill:

```bash
curl -sf -X POST "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text": "<description>", "duration_seconds": 1.5, "prompt_influence": 0.4}' \
  --output assets-src/eleven/<key>_0.mp3
```

- **Variants matter.** `shot` jitters playback rate by only 0.02 and `step` /
  `impact` pools exist to defeat repetition — generate **4 variants** for those
  groups (re-run the call with reworded prompts; identical prompts converge).
  `ui` and `vox` take one.
- **Prompting:** be specific and physical ("dry supersonic rifle crack, close
  mic, no reverb tail" beats "gunshot"). Ask for **no reverb / dry** — the
  mixer runs its own convolution reverb, and a baked-in room double-verbs
  (encoder header, item 3). For `duration_seconds`, aim near the window preset
  the group uses (`SHOT` 1.3 s, `STEP` 0.5 s, `IMPACT` 0.7 s, `UI` 1.0 s).
- **Listen before wiring** (`afplay` on macOS). A generated take can be flatly
  wrong — burning an encode cycle on it wastes more than a regen costs.

## Step 3 — commit the masters

`assets-src/*` is gitignored with per-directory re-includes. Add one for
generated takes if it is not there yet, next to the existing exceptions:

```
!assets-src/eleven/
```

Then `git add assets-src/eleven/`. Committed masters are what make
`node tools/encode-sfx.mjs <group>` work on a fresh clone without the 338 MB
`fetch-sfx.sh` download — the encoder only needs `assets-src/` to exist and
warns `MISS` harmlessly on absent packs.

## Step 4 — curation entry + credits

In `tools/sfx-sources.mjs`, add an entry under the right group with the right
window preset. Read the presets at the top of the file; the choice that is not
obvious: **generated clips are usually already tight** — there is no long take
to hunt a transient inside — so `{ whole: true, fade: true, app: 'audio',
bitrate: '64k' }` (the `RELOAD` shape) is often righter than a peak window.
Use the windowed presets (`SHOT`, `STEP`, …) when the generation came back
with dead air or a long tail.

```js
{ group: 'ui', key: 'mycue', src: ['eleven/mycue_0.mp3'], ...UI },
```

Add a `CREDITS` entry in the same file — rule 4 of `AGENTS.md`: attribution
ships, and encoding an asset does not change its licence. Record it honestly:

```js
{
  pack: 'ElevenLabs generated SFX',
  authors: 'Generated with ElevenLabs sound-generation (prompts in assets-src/eleven/)',
  license: 'ElevenLabs commercial licence (paid plan) — verify the account tier',
  url: 'https://elevenlabs.io/terms-of-use',
  used: '<which in-game sounds>',
},
```

ElevenLabs' free tier requires attribution and its paid tiers grant commercial
use — **surface the terms to the user rather than deciding licensing on their
behalf.**

## Step 5 — encode, filtered, never --force

```bash
node tools/encode-sfx.mjs <group>
```

Always filtered to the group(s) you touched. A filtered run merges into the
existing `manifest.json` instead of dropping groups it skipped, and `MISS`
warnings for unfetched CC0 packs are expected, not failures. Two traps from
the encoder's own header, both real:

- **libopus is not byte-deterministic.** Never `--force`; commit only the
  files for the group you changed and `git checkout --` anything else that
  shows modified, or the diff claims edits nobody made.
- Needs `ffmpeg` on PATH (`brew install ffmpeg`).

## Step 6 — wire (Case B only)

For an existing kind, there is nothing to do — the manifest entry *is* the
wiring. For a new kind: emitter event per `ARCHITECTURE.md`, `GROUP` entry in
`src/audio/samples.js` with jitter/send matched to the nearest existing group,
bus choice in `src/audio/index.js`, and a synthesized fallback if the sound is
gameplay-relevant (the game must never be silent because an asset is late).
Use `ctx.rng`, never `Math.random()`.

## Step 7 — verify, including with your ears

```bash
node src/audio/attenuation.selftest.mjs   # routing: head-locked vs spatialised
node src/audio/reload.selftest.mjs        # if you touched reload foley
npm run build
```

Then **listen in context** — a clip nobody heard is the audio version of a
`.png` nobody read. `node src/audio/probe.mjs --port=<dev port>` offline-renders
every voice against the running dev server; or play the game to the moment the
sound fires. Check: does it cut through the mix, does the double-verb trap
show (tail too wet), does the variant pool loop audibly under repetition?

## Step 8 — report

Say what was generated (prompts included), which group/key it landed on, what
window preset and why, which checks ran, what you actually listened to, and
the licence status. If you could not listen (no audio device), say so
explicitly rather than implying a pass.

## Hard rules

- **No runtime fetch to ElevenLabs, ever.** Generation is authoring-time only.
- **Never `--force` the encoder**; never commit re-encodes of groups you did
  not change.
- **Masters are committed in `assets-src/eleven/`; prompts are recorded**
  (a `prompts.md` beside them, or in the curation entry's comment) so a take
  can be regenerated or iterated.
- **Credits ship.** Update `CREDITS` in `tools/sfx-sources.mjs`; the encoder
  writes `public/sfx/CREDITS.md` from it.
- **Dry generations.** The mixer owns the room; ask the model for no reverb.
- `assets-src/*` is gitignored with narrow re-includes — a new master
  directory silently stays untracked until its `!assets-src/eleven/` exception
  exists. Verify with `git check-ignore -v <path>` before assuming a file will
  be committed.
