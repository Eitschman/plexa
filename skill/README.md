# Plexa Alexa Skill Files

This directory contains the interaction model, manifest template, and icons for the Plexa Alexa skill.

**For the full setup walkthrough**, see **[docs/setup-alexa.md](../docs/setup-alexa.md)** — it covers HTTPS exposure, Developer Console configuration, Plexa Settings, testing, and troubleshooting.

## Files in this directory

| File | Purpose |
|------|---------|
| [`interaction-model.json`](interaction-model.json) | English interaction model (`en-US`, `en-GB`, `en-CA`, `en-AU`, `en-IN`) |
| [`interaction-model.fr-FR.json`](interaction-model.fr-FR.json) | French interaction model (`fr-FR`) |
| [`interaction-model.de-DE.json`](interaction-model.de-DE.json) | German interaction model (`de-DE`) |
| [`manifest.example.json`](manifest.example.json) | Reference manifest (endpoint, Audio Player) |
| [`icons/`](icons/) | Skill icons for the console — see [`icons/README.md`](icons/README.md) |

You can also download a pre-filled interaction model from the **Alexa setup checklist** in Plexa Settings. **Alexa skill locale** selects the model, and the download writes your invocation name into it (`interaction-model-<locale>.json`). Regional English locales share the English model. Import that file into the same locale in the Developer Console, and set the Echo or Alexa app to that language. Sample phrases are in the [Languages](../docs/setup-alexa.md#languages) section of the setup guide.

## Interaction model notes

- **Invocation name:** Default is `plexa`. If you change it, update Plexa Settings and rebuild the model in the Developer Console. The Settings download patches the name into the model for the selected locale.
- **Languages:** English, French, and German each have their own sample utterances. Device language, console locale, and the imported model must match. See [Languages](../docs/setup-alexa.md#languages).
- **Audio Player:** Required. Plexa sends `AudioPlayer.Play` directives for music playback. Enable it under **Build → Interfaces** in the Developer Console.
- **No dual SearchQuery slots:** Utterances like `play {track} by {artist}` with two `AMAZON.SearchQuery` slots fail model build. Use one track slot for the full phrase instead (e.g. *"Summer Nights by Sample Artist"*).
- **Built-in intents:** Pause, resume, next, previous, stop, loop on/off, and start over are provided when Audio Player is enabled.
- **Custom seek intents:** `SeekForwardIntent`, `SeekBackwardIntent`, and `SeekToIntent` require the invocation name (e.g. *ask plexa to skip forward 30 seconds* or *ask plexa to skip to 2 minutes*). After changing these intents, import or download the current interaction model and rebuild it in the Developer Console.
- **Collision-safe verbs:** Prefer **start** / **mix** in English, **lance** / **mélange** in French, and **starte** / **mische** in German so Amazon Music does not intercept the utterance. Sample phrases are in the [Languages](../docs/setup-alexa.md#languages) section of the setup guide.

## Security

- `/alexa` is not protected by admin login. Amazon request signature and timestamp verification are used, plus optional skill application ID enforcement when `ALEXA_SKILL_ID` is set.
- Media URLs are short-lived signed tokens and do not expose Plex tokens.
