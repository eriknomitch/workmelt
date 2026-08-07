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
