# Plexa Alexa Skill Files

This directory contains the interaction model, manifest template, and icons for the Plexa Alexa skill.

**For the full setup walkthrough**, see **[docs/setup-alexa.md](../docs/setup-alexa.md)** — it covers HTTPS exposure, Developer Console configuration, Plexa Settings, testing, and troubleshooting.

## Files in this directory

| File | Purpose |
|------|---------|
| [`interaction-model.json`](interaction-model.json) | Import into Developer Console JSON Editor |
| [`manifest.example.json`](manifest.example.json) | Reference manifest (endpoint, Audio Player) |
| [`icons/`](icons/) | Skill icons for the console — see [`icons/README.md`](icons/README.md) |

You can also download a pre-filled interaction model from the **Alexa setup checklist** in Plexa Settings (invocation name and locale are filled in automatically).

## Interaction model notes

- **Invocation name:** Default is `plexa`. If you change it, update Plexa Settings and rebuild the model in the Developer Console.
- **Audio Player:** Required. Plexa sends `AudioPlayer.Play` directives for music playback. Enable it under **Build → Interfaces** in the Developer Console.
- **No dual SearchQuery slots:** Utterances like `play {track} by {artist}` with two `AMAZON.SearchQuery` slots fail model build. Use one track slot for the full phrase instead (e.g. *"Summer Nights by Sample Artist"*).
- **Built-in intents:** Pause, resume, next, previous, stop, loop on/off, and start over are provided when Audio Player is enabled.
- **Custom seek intents:** `SeekForwardIntent`, `SeekBackwardIntent`, and `SeekToIntent` require the invocation name (e.g. *ask plexa to skip forward 30 seconds* or *ask plexa to skip to 2 minutes*). After changing these intents, import or download the current interaction model and rebuild it in the Developer Console.
- **Collision-safe verbs:** Prefer **start** over *play* and **mix** over *shuffle* for playlists and artists to avoid Amazon Music intercepting the utterance.

## Security

- `/alexa` is not protected by admin login. Amazon request signature and timestamp verification are used, plus optional skill application ID enforcement when `ALEXA_SKILL_ID` is set.
- Media URLs are short-lived signed tokens and do not expose Plex tokens.
