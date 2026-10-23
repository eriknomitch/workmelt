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

## whizz_0..3.mp3 — not generated yet

Near-miss crack for group `whizz`, key `pass` (a round passing the
listener's head; replaces the synthesized `bulletWhizz()` when present).
Four reworded prompts, because identical prompts converge on one take.
All `duration_seconds: 0.6` (the API minimum is 0.5),
`prompt_influence: 0.5`. None of them may contain the gunshot: the shooter's
report is a separate voice, played from the muzzle at the speed of sound.

- `whizz_0`: Supersonic rifle bullet passing inches from the listener's
  head: a sharp snapping crack followed by a fast descending whoosh, close
  perspective, completely dry recording, no reverb, no gunshot, no room tone
- `whizz_1`: Bullet near miss: a violent whip-crack of a supersonic round
  flying past the ear, a high hiss dropping steeply in pitch, very short,
  completely dry, no reverb, no gun firing
- `whizz_2`: Close bullet fly-by: a tearing zip of air and a hard snap as a
  rifle round whizzes past the ear, sharp Doppler pitch drop, dry close mic,
  no echo, no gunshot
- `whizz_3`: A high-velocity bullet cracking past overhead: a sharp
  supersonic snap and a brief buzzing whine fading fast, extremely short,
  completely dry, no reverb, no gunshot report
