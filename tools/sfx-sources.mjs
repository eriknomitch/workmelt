/**
 * SFX CURATION — which source recording becomes which in-game voice.
 *
 * Consumed by tools/encode-sfx.mjs. Editing this file and re-running the
 * encoder is the whole authoring loop; nothing here ships to the browser.
 *
 * `group` matches the `kind` that AudioSystem._build() dispatches on, and
 * `key` is the variant within it (weapon profile, surface, ui name). Every
 * entry lists source files that become interchangeable random variants — more
 * files means less repetition, which matters most for shots and footsteps.
 *
 * A group/key absent from this table is not a bug: src/audio/samples.js falls
 * through to the procedural synthesis in weapons.js / foley.js for anything it
 * has no sample for. That is how `suppressed`, glass footsteps and the barks
 * stay synthesized.
 */

/* Window presets. `lead` is how much to keep before the detected transient,
 * `dur` the total clip length. Gunshots keep enough tail to sound like a gun
 * without fighting the mixer's own convolution reverb. */
const SHOT = { lead: 0.02, dur: 1.3, bitrate: '96k' };
const SHOT_BIG = { lead: 0.02, dur: 1.7, bitrate: '96k' };
const STEP = { lead: 0.01, dur: 0.5, bitrate: '64k' };
const IMPACT = { lead: 0.01, dur: 0.7, bitrate: '72k' };
const UI = { lead: 0.005, dur: 1.0, bitrate: '64k' };
/* Announcer lines are already tight, so `whole` keeps the file end to end: a
 * peak window would start the clip at the loudest syllable and eat the first
 * word. 56k mono is transparent for speech. */
const VOX = { whole: true, bitrate: '56k' };
/* Reload phases are authored one hit per file and are already tight, so
 * `whole` keeps them end to end rather than hunting a transient that is
 * already at the front. `app: 'audio'` because these are mechanical, not
 * spoken — voip would smear exactly the metallic attack that carries them —
 * and `fade` because a whole-file encode has no window to fade it out. */
const RELOAD = { whole: true, fade: true, app: 'audio', bitrate: '64k' };
/* World one-shots (blackouts and the like) are generated clips, already tight
 * end to end like the reload foley — so `whole` + `fade` rather than a peak
 * window, and a slightly higher bitrate because a descending transformer hum
 * is all low-frequency tonal content, which Opus spends bits on. */
const WORLD = { whole: true, fade: true, app: 'audio', bitrate: '72k' };

const fa = (dir, ...files) => files.map((f) => `firearms/${dir}/${f}.wav`);
const fs = (dir, n) => Array.from({ length: n }, (_, i) => `footsteps/${dir}/${i}.ogg`);
const kn = (pack, ...files) => files.map((f) => `kenney_${pack}/${f}.ogg`);
const gs = (stem, n) => Array.from({ length: n }, (_, i) => `shot/${stem}_${i}.wav`);

export const SOURCES = [
  /* ── weapon shots ──────────────────────────────────────────────────────
   * Mapped onto WEAPON_PROFILES by name. One firearm per profile keeps a
   * weapon sounding like itself across its variants; mixing two guns into one
   * profile reads as an inconsistency, not as variety — which is why the
   * variants below vary only in what the mechanism does after the round
   * leaves, never in which gun fired it.
   *
   * The four profiles a playable gun resolves to (rifle, smg, pistol, sniper)
   * are authored takes in assets-src/shot/, committed for the same reason
   * assets-src/vox/ is. The three that only the distant-gunfire ambience ever
   * reaches (ak, shotgun, lmg) stay on the CC0 pack: nothing draws them, so
   * they are never heard up close, which is the only place the difference
   * shows.
   *
   * Four variants each, not one. GROUP.shot in samples.js jitters playback
   * rate by only 0.02 — a detuned gunshot reads as a different, wrong gun —
   * so the variant pool is the only thing standing between a held trigger and
   * an audible loop.
   *
   * These are peak-normalized on the shared SHOT/SHOT_BIG windows, like every
   * other key. A generated shot does carry more tail than a real recording, so
   * it sits denser at the same peak — but the lever for that is the window,
   * not the gain. Trimming tail cannot cost a gunshot its crack; pulling the
   * level down does, and did: matching average level instead knocked up to
   * 14 dB off the transient and every weapon went quiet against the
   * footsteps. If these ever need taming, shorten `dur` here. */
  { group: 'shot', key: 'rifle', ...SHOT, src: gs('rifle', 4) },
  { group: 'shot', key: 'smg', ...SHOT, src: gs('smg', 4) },
  { group: 'shot', key: 'pistol', ...SHOT, src: gs('pistol', 4) },
  { group: 'shot', key: 'sniper', ...SHOT_BIG, src: gs('sniper', 4) },
  { group: 'shot', key: 'ak', ...SHOT,
    src: fa('AK-47', 'C_27P', 'C_28P', 'C_29P', 'C_31P', 'C_34P', 'C_36P') },
  { group: 'shot', key: 'shotgun', ...SHOT_BIG,
    src: fa('Mossberg', 'N_26P', 'N_30P') },
  { group: 'shot', key: 'lmg', ...SHOT,
    src: fa('SKS', 'U_14P', 'U_19P') },
  // `suppressed` stays procedural on purpose — no CC0 source exists, and a
  // filtered live round sounds like a filtered live round, not a can.

  /* ── footsteps ─────────────────────────────────────────────────────────
   * Keys are the surface names in foley.js STEP. The OGA pack is real boots
   * on real ground; Kenney fills the two surfaces it has no take for. */
  { group: 'step', key: 'concrete', ...STEP, src: fs('boots', 9) },
  { group: 'step', key: 'plaster', ...STEP, src: fs('tile', 9) },
  { group: 'step', key: 'metal', ...STEP, src: fs('metal', 8) },
  { group: 'step', key: 'wood', ...STEP, src: fs('wood', 9) },
  { group: 'step', key: 'dirt', ...STEP, src: fs('gravel', 10) },
  { group: 'step', key: 'foliage', ...STEP, src: fs('grass', 9) },
  { group: 'step', key: 'water', ...STEP, src: fs('water', 5) },
  { group: 'step', key: 'sand', ...STEP,
    src: kn('impact-sounds', ...range('footstep_snow', 5)) },
  { group: 'step', key: 'fabric', ...STEP,
    src: kn('impact-sounds', ...range('footstep_carpet', 5)) },
  // glass / flesh / rubber footsteps: no source, procedural handles them.

  /* ── bullet impacts ────────────────────────────────────────────────────
   * Keys are the surface names in foley.js IMPACT. */
  { group: 'impact', key: 'concrete', ...IMPACT,
    src: kn('impact-sounds', ...range('impactMining', 5)) },
  { group: 'impact', key: 'plaster', ...IMPACT,
    src: kn('impact-sounds', ...range('impactGeneric_light', 5)) },
  { group: 'impact', key: 'metal', ...IMPACT,
    src: kn('impact-sounds', ...range('impactMetal_medium', 5)) },
  { group: 'impact', key: 'wood', ...IMPACT,
    src: kn('impact-sounds', ...range('impactWood_medium', 5)) },
  { group: 'impact', key: 'glass', ...IMPACT,
    src: kn('impact-sounds', ...range('impactGlass_medium', 5)) },
  { group: 'impact', key: 'flesh', ...IMPACT,
    src: kn('impact-sounds', ...range('impactPunch_medium', 5)) },
  { group: 'impact', key: 'fabric', ...IMPACT,
    src: kn('impact-sounds', ...range('impactSoft_medium', 5)) },
  { group: 'impact', key: 'dirt', ...IMPACT,
    src: kn('impact-sounds', ...range('impactSoft_heavy', 5)) },

  /* ── ui / indicators ───────────────────────────────────────────────────
   * Keys are the canonical names in UI_ALIAS / BUS_FOR. Single-variant on
   * purpose: a hitmarker that changes timbre shot to shot reads as a bug. */
  { group: 'ui', key: 'hitmarker', ...UI, src: kn('interface-sounds', 'tick_002') },
  { group: 'ui', key: 'headshot', ...UI, src: kn('interface-sounds', 'confirmation_001') },
  { group: 'ui', key: 'kill', ...UI, src: kn('interface-sounds', 'confirmation_003') },
  { group: 'ui', key: 'armour', ...UI, src: kn('impact-sounds', 'impactMetal_light_000') },
  { group: 'ui', key: 'damage', ...UI, src: kn('impact-sounds', 'impactSoft_heavy_002') },
  { group: 'ui', key: 'grenade_warn', ...UI, src: kn('interface-sounds', 'error_003') },
  { group: 'ui', key: 'regen', ...UI, src: kn('interface-sounds', 'confirmation_004') },
  { group: 'ui', key: 'join', ...UI, src: kn('interface-sounds', 'confirmation_002') },
  { group: 'ui', key: 'leave', ...UI, src: kn('interface-sounds', 'back_002') },
  { group: 'ui', key: 'ready', ...UI, src: kn('interface-sounds', 'select_005') },
  { group: 'ui', key: 'unready', ...UI, src: kn('interface-sounds', 'back_001') },
  { group: 'ui', key: 'countdown', ...UI, src: kn('interface-sounds', 'tick_001') },
  { group: 'ui', key: 'matchstart', ...UI, src: kn('interface-sounds', 'bong_001') },
  // dryfire / lowhealth stay procedural: the synthesized versions are already
  // mechanically right and nothing in these packs beats them.

  /* ── world one-shots ───────────────────────────────────────────────────
   * Map-wide diegetic events. `powerdown` plays head-locked on `power:out`
   * (the Site Work generator blackout) — the event carries no position, a
   * blackout is everywhere. One take: like a hitmarker, a blackout that
   * changes timbre outage to outage reads as a bug, not variety. Master is
   * ElevenLabs-generated; prompt in assets-src/eleven/prompts.md. */
  { group: 'world', key: 'powerdown', ...WORLD, src: ['eleven/powerdown_0.mp3'] },
  // The mirror: `power:restored`, the hum spinning back up.
  { group: 'world', key: 'powerup', ...WORLD, src: ['eleven/powerup_0.mp3'] },

  /* ── announcer ─────────────────────────────────────────────────────────
   * Text-to-speech lines, one take each, kept as masters in assets-src/vox/
   * (committed — unlike the packs above, they are not fetchable). Keys are the
   * `line` names audio.announce() dispatches on. */
  { group: 'vox', key: 'match_begin', ...VOX, src: ['vox/match_begin.wav'] },
  { group: 'vox', key: 'start', ...VOX, src: ['vox/start.wav'] },
  { group: 'vox', key: 'headshot', ...VOX, src: ['vox/headshot.wav'] },
  { group: 'vox', key: 'killstreak', ...VOX, src: ['vox/killstreak.wav'] },
  { group: 'vox', key: 'game_over', ...VOX, src: ['vox/game_over.wav'] },
  /* The roo's idle chatter — eleven Australianisms he mutters when the player
   * wanders up to him on Shivam. One KEY with eleven takes, not eleven keys:
   * the bank's per-key variant pool already picks at random and refuses an
   * immediate repeat, so "say a random one" costs nothing here. */
  {
    group: 'vox',
    key: 'roo',
    ...VOX,
    src: Array.from({ length: 11 }, (_, i) => `vox/aussie-sayings/roo_${i}.mp3`),
  },

  /* ── reload foley ──────────────────────────────────────────────────────
   * One file per *phase*, not per reload. `weapon:reload` fires four times
   * (start / magout / magin / end) at cue points on the reload clip, and the
   * clip stretches to each weapon's reloadTac/reloadEmpty — so a single long
   * take would drift out of sync with the animation on every weapon but one.
   * See the note at the head of foley.js reloadPhase().
   *
   * Keys are `<weapon>[_<variant>]_<phase>`. samples.js tries the variant-
   * specific key first and falls back to the bare one, which is why `start`
   * and `magin` are authored once: pressing the catch and seating a fresh
   * magazine sound the same whether or not the gun ran dry. `magout` and
   * `end` are the two phases where it genuinely differs — a retained partial
   * magazine never hits the floor, and only an empty reload has a bolt or
   * slide to release. */
  ...['rifle', 'smg', 'pistol', 'sniper'].flatMap((w) => [
    'start', 'magin',
    'tac_magout', 'empty_magout',
    'tac_end', 'empty_end',
  ].map((p) => (
    { group: 'reload', key: `${w}_${p}`, ...RELOAD, src: [`reload/${w}_${p}.wav`] }
  ))),
];

/** kenney numbers variants _000.._00N. */
function range(stem, n) {
  return Array.from({ length: n }, (_, i) => `${stem}_${String(i).padStart(3, '0')}`);
}

/** Attribution, emitted into public/sfx/CREDITS.md by the encoder. */
export const CREDITS = [
  {
    pack: 'The Free Firearm Sound Library',
    authors: 'Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney',
    license: 'CC0 1.0 (public domain)',
    url: 'https://opengameart.org/content/the-free-firearm-sound-library',
    used: 'the ak, shotgun and lmg shot profiles (distant gunfire ambience)',
  },
  {
    pack: 'Footsteps on different surfaces',
    authors: 'congusbongus',
    license: 'CC BY 3.0',
    url: 'https://opengameart.org/content/footsteps-on-different-surfaces',
    used: 'footsteps: concrete, plaster, metal, wood, dirt, foliage, water',
    attributionRequired: true,
  },
  {
    pack: 'Kenney — Impact Sounds',
    authors: 'Kenney (kenney.nl)',
    license: 'CC0 1.0 (public domain)',
    url: 'https://kenney.nl/assets/impact-sounds',
    used: 'bullet impacts, sand/fabric footsteps, armour + damage indicators',
  },
  {
    pack: 'Kenney — Interface Sounds',
    authors: 'Kenney (kenney.nl)',
    license: 'CC0 1.0 (public domain)',
    url: 'https://kenney.nl/assets/interface-sounds',
    used: 'UI and match-flow indicators',
  },
  {
    pack: 'Announcer lines (text-to-speech)',
    authors: 'generated for this project',
    license: 'no third-party rights — masters in assets-src/vox/',
    url: 'assets-src/vox/',
    used: "announcer: match begin, start, headshot, killstreak, game over; the Shivam roo's idle sayings",
  },
  {
    pack: 'Reload foley (text-to-sound)',
    authors: 'generated for this project',
    license: 'no third-party rights — masters in assets-src/reload/',
    url: 'assets-src/reload/',
    used: 'reload phases for the M4A1, MPX-9, P-19 and AX-7',
  },
  {
    pack: 'Firing takes (text-to-sound)',
    authors: 'generated for this project',
    license: 'no third-party rights — masters in assets-src/shot/',
    url: 'assets-src/shot/',
    used: 'the rifle, smg, pistol and sniper shot profiles',
  },
  {
    pack: 'ElevenLabs generated SFX',
    authors: 'Generated with ElevenLabs sound-generation (prompts in assets-src/eleven/prompts.md)',
    license: 'ElevenLabs commercial licence (paid plan) — verify the account tier',
    url: 'https://elevenlabs.io/terms-of-use',
    used: 'the power-grid blackout and restore (world/powerdown, world/powerup)',
  },
];
