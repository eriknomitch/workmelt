# ElevenLabs generation prompts

Masters in this directory are generated with the ElevenLabs sound-generation
API (`/v1/sound-generation`, `mp3_44100_192`). Re-run the same prompt to
iterate on a take; identical prompts converge, so reword to get variants.

## powerdown_0.mp3

> Industrial power grid shutting down: a heavy electrical breaker clunk, then
> a deep transformer hum rapidly descending in pitch and dying away to
> silence, machinery spinning down, completely dry recording, no reverb, no
> room tone

`duration_seconds: 3.0`, `prompt_influence: 0.4`. Plays on `power:out`
(the Site Work generator blackout) as group `world`, key `powerdown`.

## powerup_0.mp3

> Industrial power grid coming back online: a heavy electrical breaker clunk,
> then a deep transformer hum rising in pitch and swelling to a steady drone,
> machinery spinning up, electricity surging back, completely dry recording,
> no reverb, no room tone

`duration_seconds: 3.0`, `prompt_influence: 0.4`. Plays on `power:restored`
as group `world`, key `powerup`.

## whizz_0.mp3, whizz_1.mp3

Group `whizz`, key `pass` — the near-miss fly-by (`_onTracer` /
`_onImpact` in `src/audio/index.js`). Both `duration_seconds: 0.6`,
`prompt_influence: 0.5`.

whizz_0:

> Sniper bullet flying by inches away: a whip-like sonic crack immediately
> followed by a brief descending whistle-whoosh, close perspective, dry studio
> recording, no reverb, no firing sound, no background

whizz_1:

> Sniper round passing just past the ear: a single bright crack like a
> cracking whip, then a short airy whoosh dropping in pitch as the bullet flies
> away, close perspective, completely dry, no reverb, no gunshot, no background

whizz_0 ships high-passed at 2.6 kHz (the `af` on its entry in
`tools/sfx-sources.mjs`): as generated it carries a pitched glide under the
whoosh that reads as a laser, not a bullet. Prompts that ask for a "whistle"
are the likely cause; leave that word out.

These are 2 keepers out of 17 generations. What the rejects did, so the next
pass does not repeat them:

- Prompts without "sniper"/"whip" (e.g. "supersonic rifle bullet passing
  inches from the listener's head: a sharp snapping crack followed by a fast
  descending whoosh") returned volleys of several cracks, a whoosh with the
  crack at the end, or a low whoomp.
- Most rejects were dark: more energy below 500 Hz than above 3 kHz, by
  9–23 dB. Both keepers are within ~2 dB of even. Adding "no bass" / "no low
  rumble" did not fix it.
- One take had 130 ms of silence before the crack — check onset, it delays
  the cue against the round's flight time.
- Six whistle-free rewordings of whizz_1's prompt ("rush of air like tearing
  cloth", "breathy hiss", "bullwhip snap", "real field recording", …) gave
  nothing usable: onsets 39–137 ms late, two volleys, mostly dark again.

Screen a take with a spectrogram and the <500 Hz vs >3 kHz band RMS before
encoding; the synthesized voice it overlays has almost nothing below 900 Hz.
