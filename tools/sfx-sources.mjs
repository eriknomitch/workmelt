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
/* Hit confirms are hand-split one-shots that already begin on their transient,
 * so `whole` keeps them end to end — a peak window would start the clip 40-90 ms
 * in and eat the attack. `audio`, not the `voip` that `whole` otherwise implies:
 * these are clicks, not speech. 72k because the bright ones carry real content
 * up past 6 kHz. */
const HIT = { whole: true, application: 'audio', bitrate: '72k' };
/* Announcer lines are already tight, so `whole` keeps the file end to end: a
 * peak window would start the clip at the loudest syllable and eat the first
 * word. 56k mono is transparent for speech. */
const VOX = { whole: true, bitrate: '56k' };

const fa = (dir, ...files) => files.map((f) => `firearms/${dir}/${f}.wav`);
const fs = (dir, n) => Array.from({ length: n }, (_, i) => `footsteps/${dir}/${i}.ogg`);
const kn = (pack, ...files) => files.map((f) => `kenney_${pack}/${f}.ogg`);

export const SOURCES = [
  /* ── weapon shots ──────────────────────────────────────────────────────
   * Mapped onto WEAPON_PROFILES by name. One real firearm per profile keeps
   * a weapon sounding like itself across its variants; mixing two guns into
   * one profile reads as an inconsistency, not as variety. */
  { group: 'shot', key: 'ak', ...SHOT,
    src: fa('AK-47', 'C_27P', 'C_28P', 'C_29P', 'C_31P', 'C_34P', 'C_36P') },
  { group: 'shot', key: 'rifle', ...SHOT,
    src: fa('AR-15', 'D_24P', 'D_32P') },
  { group: 'shot', key: 'smg', ...SHOT,
    src: fa('Carl Gustav M45', 'G_20P', 'G_22P', 'G_24P', 'G_31P', 'G_33P', 'G_35P') },
  { group: 'shot', key: 'pistol', ...SHOT,
    src: fa('Walther PPQ', 'X_31P', 'X_39P') },
  { group: 'shot', key: 'shotgun', ...SHOT_BIG,
    src: fa('Mossberg', 'N_26P', 'N_30P') },
  { group: 'shot', key: 'sniper', ...SHOT_BIG,
    src: fa('Mosin Nagant', 'M_21P', 'M_26P') },
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

  /* ── hit confirms ──────────────────────────────────────────────────────
   * The four kinds src/ui/index.js hitmarker() dispatches on, in ascending
   * order of how much the shot is worth. Single-variant on purpose: a
   * hitmarker that changes timbre shot to shot reads as a bug, so the variety
   * is across kinds, never within one. Masters are ours (assets-src/
   * hitmarkers/, committed) — hand-split from one take, which is why they
   * sound like a set. Length carries the reward: 84 ms for a body hit, 2.4 s
   * for a kill. */
  { group: 'ui', key: 'hitmarker', ...HIT, src: ['hitmarkers/hitmarker-1.wav'] },
  { group: 'ui', key: 'headshot', ...HIT, src: ['hitmarkers/hitmarker-6.wav'] },
  { group: 'ui', key: 'armour', ...HIT, src: ['hitmarkers/hitmarker-4.wav'] },
  { group: 'ui', key: 'kill', ...HIT, src: ['hitmarkers/hitmarker-8.wav'] },

  /* ── ui / indicators ───────────────────────────────────────────────────
   * Keys are the canonical names in UI_ALIAS / BUS_FOR. */
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

  /* ── announcer ─────────────────────────────────────────────────────────
   * Text-to-speech lines, one take each, kept as masters in assets-src/vox/
   * (committed — unlike the packs above, they are not fetchable). Keys are the
   * `line` names audio.announce() dispatches on. */
  { group: 'vox', key: 'match_begin', ...VOX, src: ['vox/match_begin.wav'] },
  { group: 'vox', key: 'start', ...VOX, src: ['vox/start.wav'] },
  { group: 'vox', key: 'headshot', ...VOX, src: ['vox/headshot.wav'] },
  { group: 'vox', key: 'killstreak', ...VOX, src: ['vox/killstreak.wav'] },
  { group: 'vox', key: 'game_over', ...VOX, src: ['vox/game_over.wav'] },
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
    used: 'all weapon shots',
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
    used: 'bullet impacts, sand/fabric footsteps, damage indicator',
  },
  {
    pack: 'Kenney — Interface Sounds',
    authors: 'Kenney (kenney.nl)',
    license: 'CC0 1.0 (public domain)',
    url: 'https://kenney.nl/assets/interface-sounds',
    used: 'UI and match-flow indicators',
  },
  {
    pack: 'Hit confirms',
    authors: 'ours',
    license: 'no third-party rights — masters in assets-src/hitmarkers/',
    url: 'assets-src/hitmarkers/',
    used: 'hit confirms: body, headshot, armour, kill',
  },
  {
    pack: 'Announcer lines (text-to-speech)',
    authors: 'generated for this project',
    license: 'no third-party rights — masters in assets-src/vox/',
    url: 'assets-src/vox/',
    used: 'announcer: match begin, start, headshot, killstreak, game over',
  },
];
