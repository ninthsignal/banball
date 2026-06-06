# Handoff Instructions

This bundle contains the product and design handoff for the TikTok Live Policy Dodgeball game.

## Files

```text
PRD.md
```

Product requirements, technical architecture, game rules, multi-session behavior, TikTok Live event handling, security requirements, and MVP build order.

```text
design.md
```

Visual design specification, HUD layout, character direction, color palette, animation states, accessibility notes, and Phaser implementation guidance.

```text
assets/game-mockup.png
```

Generated visual mock-up showing the intended game screen direction. Use it as a reference, not as a final production asset.

## Recommended Starting Point

Start with a monorepo containing two deployable apps:

```text
/apps/web
/apps/realtime-server
```

Use the following stack:

```text
Web app:
- Vite or Next.js
- TypeScript
- Phaser 3
- Socket.IO client

Realtime server:
- Node.js
- TypeScript
- Express
- Socket.IO
- TikTok Live connector library
```

Host the web app on Vercel. Host the realtime server on a persistent Node environment such as Railway, Render, Fly.io, or a VPS.

## Implementation Order

1. Build the Phaser game locally without TikTok integration.
2. Add human movement, AI movement, balls, collisions, throw/catch/dodge.
3. Add lives, appeals, policy ball alerts, and win/loss states.
4. Add a mock command panel so commands like `!play`, `!dodge`, `!catch`, and `!throw` can be tested locally.
5. Add session creation and session-specific game state.
6. Add the realtime server and WebSocket rooms.
7. Add host/admin controls for TikTok username, appeal threshold, reset, and connect/disconnect.
8. Add the TikTok Live connector.
9. Route TikTok chat and gift events into only the correct session room.
10. Test multiple sessions at once.
11. Deploy web and realtime server separately.

## Critical Architecture Rule

Do not use one global TikTok username or one global game state.

Every session must have its own:

```text
sessionId
hostToken
tiktokUsername
appealGiftThreshold
gameState
viewer assignments
WebSocket room
TikTok connection state
```

A change in Session A must never affect Session B.

## Local Development Suggestion

For fast iteration, begin with fake TikTok events:

```js
emitMockChat("@viewer1", "!play");
emitMockChat("@viewer1", "!dodge");
emitMockGift("@viewer2", { diamondValue: 10, repeatCount: 5 });
```

Only add the real TikTok connector after the local game loop is fun and the session model is working.

## Definition of Done for MVP

The first playable version is done when:

- The host can create a session.
- The host can configure a TikTok username and appeal gift threshold.
- A public game link opens the correct isolated session.
- Human player movement works.
- AI players move autonomously.
- Viewer commands can claim and trigger AI players.
- Gift events grant appeals.
- Policy-colored balls trigger restriction alerts.
- Win/loss states work.
- Two separate sessions can run at the same time without affecting each other.

## Notes

The policy categories should remain configurable. Before public release, verify the current TikTok policy taxonomy and update the labels/messages in the policy config.

The included mock-up uses a TikTok Live-inspired color palette, but the implementation should avoid using official logos or implying real moderation enforcement.

