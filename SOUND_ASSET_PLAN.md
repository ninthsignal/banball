# Banball Sound Asset Plan

Last researched: 2026-06-06

## Source Shortlist

Use CC0 assets where possible so the game can ship, stream, and monetize without attribution requirements.

| Source | License | Use |
| --- | --- | --- |
| Kenney RPG Audio - https://kenney.nl/assets/rpg-audio | CC0 | Footsteps, cloth/arm movement, throw windups |
| Kenney Impact Sounds - https://kenney.nl/assets/impact-sounds | CC0 | Ball impacts, hits, soft body collisions, floor bounces |
| Kenney UI Audio - https://kenney.nl/assets/ui-audio | CC0 | Menu, options, pause, command feed, connection status |
| OpenGameArt GUI Sound Effects - https://opengameart.org/content/gui-sound-effects | CC0 | Alternative UI confirm/error tones |
| OpenGameArt Victory - https://opengameart.org/content/victory | CC0 | Human win fanfare |
| OpenGameArt Medieval: Defeat Theme - https://opengameart.org/content/medieval-defeat-theme | CC0 | Human loss/game-over sting |
| Freesound Dodgeball_Throw_Hit1 - https://freesound.org/people/burnsie289/sounds/152416/ | CC BY 3.0 | Optional dodgeball-specific backup; requires credit |

## Current Game States

The implemented Phaser game currently defines:

- Screen modes: `menu`, `options`, `playing`, `gameover`
- Player action states: `idle`, `run`, `dodge`, `catch`, `throw`, `hit`, `eliminated`
- Outcome states: `winner: "human"` and `winner: "ai"`
- Event states: command applied, gift/appeal progress, appeal granted, policy hit alert, livestream connected/disconnected

The PRD also names AI planning states:

- `wander`, `seekBall`, `avoidBall`, `aim`, `throw`, `recover`, `eliminated`

Most AI planning states should not get unique sounds every frame. They should reuse sparse movement, aim, throw, recover, and eliminated cues.

## Recommended Mapping

| State/event | Recommended asset candidates | Notes |
| --- | --- | --- |
| `menu` | `kenney_ui-audio/Audio/rollover1.ogg`, `click1.ogg`, `switch2.ogg` | Light arcade UI ticks for button hover/select. |
| `options` | `kenney_ui-audio/Audio/switch10.ogg`, `switch17.ogg`, `click3.ogg` | Use slightly brighter switch tones for settings changes. |
| `playing` start | `kenney_ui-audio/Audio/switch23.ogg` or GUI positive tone | One short start chirp; avoid a long announcer cue. |
| `gameover` human win | OpenGameArt `Victory.wav` or `Victory.mp3` | 8-bit fanfare fits the arcade overlay tone. |
| `gameover` AI win/loss | OpenGameArt `defeat.mp3` trimmed to 1.5-2.5s, or GUI negative tone | The full defeat theme is long; trim or fade it. |
| `idle` | none, or very low looped court ambience later | Silence is better than noisy idle audio. |
| `run` | `kenney_impact-sounds/Audio/footstep_wood_000-004.ogg` or `footstep_concrete_000-004.ogg` | Randomize pitch/variant; throttle to animation step timing. |
| `dodge` / `avoidBall` | `kenney_rpg-audio/Audio/cloth1.ogg`, `cloth2.ogg`, `clothBelt.ogg` | A quick cloth swish sells the duck/slide without sounding violent. |
| `catch` | `kenney_impact-sounds/Audio/impactSoft_medium_000-004.ogg` + optional `kenney_ui-audio/Audio/switch14.ogg` | Layer soft catch thump with a tiny success tick when the catch succeeds. |
| `throw` / `aim` | `kenney_rpg-audio/Audio/knifeSlice.ogg`, `knifeSlice2.ogg`, or `drawKnife1.ogg` | These read as quick whooshes when pitched down and shortened. |
| Ball wall/floor bounce | `kenney_impact-sounds/Audio/impactWood_light_000-004.ogg`, `impactGeneric_light_000-004.ogg` | Keep low volume; this can trigger often. |
| Human `hit` / policy hit alert | `kenney_impact-sounds/Audio/impactSoft_heavy_000-004.ogg` + `kenney_ui-audio/Audio/switch30.ogg` | Layer a soft body impact with a warning blip matching the restriction alert. |
| AI `eliminated` | `kenney_impact-sounds/Audio/impactSoft_medium_003.ogg` + GUI negative tone | Shorter than human loss; this may happen several times per match. |
| `recover` | `kenney_rpg-audio/Audio/cloth3.ogg` or no sound | Optional; only play if recover becomes visible to the player. |
| `wander` / `seekBall` | run footsteps only | Do not add extra planning-state sounds. |
| `!play` command assignment | `kenney_ui-audio/Audio/click5.ogg` or `switch5.ogg` | A small join/claim tick. |
| `!dodge`, `!catch`, `!throw` commands | Reuse the matching action sounds | The action sound should be enough feedback. |
| Gift progress | `kenney_ui-audio/Audio/click2.ogg` at low volume | Optional tick per gift batch, not per individual gift spam. |
| Appeal granted | `kenney_ui-audio/Audio/switch25.ogg` or OpenGameArt GUI positive tone | Bright, short success cue. |
| Stream connected | `kenney_ui-audio/Audio/switch13.ogg` | Positive but quieter than appeal granted. |
| Stream disconnected/error | OpenGameArt GUI negative tone or `kenney_ui-audio/Audio/switch32.ogg` | Keep non-alarming unless gameplay is blocked. |

## Implementation Notes

- Store final files under `apps/web/public/sounds/` so Vite serves them directly.
- Prefer `.ogg` for small browser-friendly effects, with `.mp3` only where the source has no clean `.ogg`.
- Normalize peaks before shipping; Kenney packs vary by perceived loudness.
- In Phaser, preload with stable keys such as `sfx_run_wood_0`, `sfx_throw_whoosh_0`, `sfx_policy_hit_0`, and `sfx_win`.
- Use randomized variants and pitch variation for repeated sounds like footsteps, ball bounces, and impacts.
- Avoid sounds for every AI planning transition; only player-visible state changes need audio.

