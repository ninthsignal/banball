# Banball sound overrides

The game ships with **procedural** sound effects synthesized at runtime
(`apps/web/src/audio.ts`) so there are no required audio files. To swap in real
samples (e.g. the Freesound / Kenney candidates in `SOUND_ASSET_PLAN.md`):

1. Drop the file in this folder, e.g. `throw_whoosh.ogg`.
2. Register it in `manifest.json`, mapping the **cue key** to the filename:

   ```json
   {
     "throw": "throw_whoosh.ogg",
     "win": "victory.ogg"
   }
   ```

Any cue not listed keeps its synthesized fallback. Prefer `.ogg`, normalize
peaks, and keep one-shots short. Files here are served at `/sounds/<file>` by
Vite.

## Cue keys and Freesound candidates

| Cue key | Fires on | Freesound candidate |
| --- | --- | --- |
| `throw` | any throw (human/AI/`!throw`) | https://freesound.org/people/qubodup/sounds/60013/ (CC0) |
| `catch` | ball caught | https://freesound.org/people/doudar41/sounds/728515/ |
| `dodge` | dodge / catch windup, `!dodge` `!catch` | https://freesound.org/people/newlocknew/packs/36237/ |
| `hit` | human hit (life/appeal lost) | https://freesound.org/people/JakLocke/packs/16039/ |
| `elim` | AI eliminated | https://freesound.org/people/Timbre/packs/6409/ |
| `bounce` | ball hits wall/floor fast | https://freesound.org/people/juskiddink/sounds/152763/ |
| `step` | human running | https://freesound.org/people/AlexMurphy53/sounds/580432/ |
| `win` | human wins | https://freesound.org/people/LittleRobotSoundFactory/sounds/270333/ |
| `lose` | stream restricted (loss) | https://freesound.org/people/SilverIllusionist/sounds/840820/ |
| `start` | match start | — |
| `ui_hover` / `ui_click` / `ui_back` | menu buttons | https://freesound.org/people/Breviceps/packs/25371/ (CC0) |
| `command` | `!play` slot claimed | Breviceps UI pack (CC0) |
| `gift` | gift received | Breviceps UI pack (CC0) |
| `appeal` | appeal granted | https://freesound.org/people/RescopicSound/sounds/750435/ |
| `stream_connect` / `stream_disconnect` | TikTok live status | RescopicSound UI beeps |

> Check each Freesound page's license before shipping. CC0 needs no
> attribution; CC-BY requires crediting the author.
