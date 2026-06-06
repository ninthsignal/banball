# TikTok Live Policy Dodgeball - Product Requirements Document

## 1. Product Summary

Build a browser-based Phaser JS dodgeball game designed for livestream play. The human player controls the left side of the court. AI opponents occupy the right side. TikTok Live viewers can join as AI players and trigger limited actions through chat commands, while the AI continues to handle autonomous movement.

The game uses color-coded dodgeballs associated with configurable policy categories. When the human player is hit by a policy ball, the game displays a themed restriction alert. Gifts from TikTok Live viewers contribute toward an appeal threshold. Appeals act as extra lives for the human player.

The app must support multiple independent game sessions at the same time.

## 2. Core Gameplay

### 2.1 Teams

- Human team:
  - One human-controlled player on the left side of the court.
  - Controlled with keyboard input.
  - Has lives and appeals.

- AI/viewer team:
  - Multiple AI players on the right side of the court.
  - Each AI player moves autonomously.
  - A TikTok viewer can claim an available AI player with `!play`.
  - Viewer commands trigger short actions but do not control movement.

### 2.2 Win and Loss Conditions

The human player loses when:

```js
human.lives <= 0 && human.appeals <= 0
```

The human player wins when:

```js
aiPlayers.every(player => player.eliminated)
```

### 2.3 Human Player Hit Logic

When the human player is hit:

```js
if (human.appeals > 0) {
  human.appeals -= 1;
} else {
  human.lives -= 1;
}

if (human.lives <= 0 && human.appeals <= 0) {
  gameOver("loss");
}
```

### 2.4 AI Player Hit Logic

When an AI player is hit by a valid human-thrown ball:

```js
aiPlayer.eliminated = true;
```

For the MVP, each AI player can be one-hit eliminated. Later versions may add AI lives, shields, or difficulty scaling.

## 3. TikTok Live Integration

### 3.1 Architecture Requirement

The Phaser game should be hosted on Vercel. The TikTok Live listener should run as a separate persistent Node service.

Recommended architecture:

```text
TikTok Live Chat + Gifts
        |
        v
Persistent Node TikTok Connector Service
        |
        v
WebSocket / Socket.IO
        |
        v
Phaser Game Client on Vercel
```

Do not rely on Vercel serverless functions for the TikTok Live listener, because the connector needs a persistent connection.

Recommended hosting:

- Vercel for the web app.
- Railway, Render, Fly.io, or a VPS for the realtime/TikTok connector server.

### 3.2 Supported Chat Commands

Supported viewer commands:

```text
!play
!dodge
!catch
!throw
```

Behavior:

- `!play`: assigns the viewer to an available AI player.
- `!dodge`: assigned AI ducks briefly.
- `!catch`: assigned AI enters a catch window.
- `!throw`: assigned AI throws if holding or near a ball.

Important rule: viewer commands are short action intents. They must not replace autonomous AI movement.

### 3.3 Command Cooldowns

Add per-viewer or per-player cooldowns:

```js
{
  dodgeCooldownMs: 3000,
  catchCooldownMs: 4000,
  throwCooldownMs: 2500
}
```

If a command is on cooldown, ignore it or display a lightweight status update in the command feed.

### 3.4 Gift Events

Gift values contribute to the human player's appeal meter.

Example normalized gift event:

```js
{
  type: "tiktok:gift",
  sessionId: "abc123",
  username: "viewer123",
  giftName: "Rose",
  diamondValue: 1,
  repeatCount: 10
}
```

Appeal logic:

```js
currentGiftProgress += giftDiamondValue * repeatCount;

while (currentGiftProgress >= appealGiftThreshold) {
  human.appeals += 1;
  currentGiftProgress -= appealGiftThreshold;
}
```

The appeal threshold must be configurable per session by the host/admin.

## 4. Multi-Session Support

### 4.1 Requirement

Multiple people on different machines must be able to use the site at the same time without changing each other's TikTok listener, game state, or settings.

There must be no single global TikTok username and no single global game session.

### 4.2 Session Model

Each game session should have:

```js
{
  sessionId: "abc123",
  hostToken: "private-admin-token",
  tiktokUsername: "someStreamer",
  appealGiftThreshold: 100,
  currentGiftProgress: 0,
  gameState: {},
  connectedClients: [],
  assignedViewers: {},
  tiktokConnectionStatus: "disconnected",
  createdAt: 0,
  lastActiveAt: 0
}
```

Each session gets its own WebSocket room:

```text
session:abc123
session:xyz789
```

Events for one room must never be broadcast to another room.

### 4.3 Session Creation Flow

1. Host opens the web app.
2. Host creates a new session.
3. Backend creates:
   - `sessionId`
   - `hostToken`
   - default config
4. Host receives:
   - public game link
   - private host/admin link
5. Host enters a TikTok username.
6. Backend starts a TikTok listener for that session only.
7. Game clients subscribe to that session's WebSocket room.

### 4.4 Routes

Recommended routes:

```text
/
/game/:sessionId
/host/:sessionId?token=...
/api/sessions
/api/sessions/:sessionId
/api/sessions/:sessionId/config
```

Page purposes:

- `/`: create or join a session.
- `/game/:sessionId`: public playable game view.
- `/host/:sessionId?token=...`: host/admin controls.
- `/api/sessions`: create session.
- `/api/sessions/:sessionId`: get public session metadata.
- `/api/sessions/:sessionId/config`: update host-only settings.

### 4.5 Host Controls

The host/admin page should control:

- TikTok username.
- Connect/disconnect TikTok listener.
- Appeal gift threshold.
- Reset game.
- Number of AI players.
- Policy ball configuration.
- Difficulty settings.

The public game page must not be able to change these settings.

### 4.6 Session Cleanup

Add cleanup for inactive sessions:

```text
If no clients are connected for 30 minutes:
- disconnect TikTok listener
- delete in-memory session state
- release resources
```

If Redis or a database is introduced later, session cleanup should also expire persisted session records.

## 5. Game Entities

### 5.1 Human Player

```js
{
  id: "human",
  team: "left",
  lives: 3,
  appeals: 0,
  holdingBallId: null,
  eliminated: false,
  x: 200,
  y: 360
}
```

### 5.2 AI Player

```js
{
  id: "ai_1",
  team: "right",
  assignedViewer: null,
  x: 900,
  y: 300,
  lives: 1,
  eliminated: false,
  holdingBallId: null,
  aiState: "wander",
  currentAction: null,
  actionExpiresAt: 0,
  cooldowns: {
    dodge: 0,
    catch: 0,
    throw: 0
  }
}
```

AI states:

```text
wander
seekBall
avoidBall
aim
throw
recover
eliminated
```

### 5.3 Policy Ball

```js
{
  id: "ball_1",
  policyId: "harassment",
  color: "#ff3b5f",
  label: "Harassment",
  hitMessage: "Restricted: Harassment Policy",
  x: 600,
  y: 340,
  vx: 0,
  vy: 0,
  heldBy: null,
  lastThrownBy: null
}
```

## 6. Policy Ball Configuration

Policy categories should be config-driven. Do not hard-code policy taxonomy into gameplay code.

Example starter config:

```js
[
  {
    id: "harassment",
    label: "Harassment",
    color: "#ff3b5f",
    hitMessage: "Restricted: Harassment Policy"
  },
  {
    id: "minor_safety",
    label: "Minor Safety",
    color: "#25f4ee",
    hitMessage: "Restricted: Minor Safety Policy"
  },
  {
    id: "dangerous_acts",
    label: "Dangerous Acts",
    color: "#ffd166",
    hitMessage: "Restricted: Dangerous Acts Policy"
  },
  {
    id: "integrity",
    label: "Integrity",
    color: "#9b5de5",
    hitMessage: "Restricted: Integrity Policy"
  },
  {
    id: "regulated_goods",
    label: "Regulated Goods",
    color: "#f9844a",
    hitMessage: "Restricted: Regulated Goods Policy"
  }
]
```

Before public release, verify the current TikTok policy taxonomy and adjust the config labels/messages. Keep the game framed as a simulation/parody mechanic, not actual moderation or enforcement.

## 7. Realtime Event Model

Use Socket.IO or native WebSockets. Socket.IO is recommended for faster MVP development.

### 7.1 Client to Server

Join session:

```js
{
  type: "session:join",
  sessionId: "abc123",
  role: "game"
}
```

Host updates config:

```js
{
  type: "host:updateConfig",
  sessionId: "abc123",
  hostToken: "private-admin-token",
  config: {
    tiktokUsername: "someStreamer",
    appealGiftThreshold: 100
  }
}
```

Host connects TikTok:

```js
{
  type: "host:connectTikTok",
  sessionId: "abc123",
  hostToken: "private-admin-token",
  username: "someStreamer"
}
```

Optional game state patch:

```js
{
  type: "game:statePatch",
  sessionId: "abc123",
  statePatch: {}
}
```

### 7.2 Server to Client

Chat command:

```js
{
  type: "tiktok:chatCommand",
  sessionId: "abc123",
  username: "viewer123",
  command: "dodge"
}
```

Gift:

```js
{
  type: "tiktok:gift",
  sessionId: "abc123",
  username: "viewer123",
  giftName: "Rose",
  diamondValue: 1,
  repeatCount: 10
}
```

Config updated:

```js
{
  type: "session:configUpdated",
  sessionId: "abc123",
  config: {}
}
```

TikTok connection status:

```js
{
  type: "tiktok:connectionStatus",
  sessionId: "abc123",
  status: "connected"
}
```

## 8. Recommended Phaser Structure

Scenes:

```text
BootScene
PreloadScene
MainMenuScene
GameScene
HostOverlayScene
GameOverScene
```

Systems:

```text
systems/InputSystem.ts
systems/AISystem.ts
systems/BallSystem.ts
systems/CollisionSystem.ts
systems/CommandSystem.ts
systems/GiftSystem.ts
systems/SessionSocket.ts
systems/PolicyAlertSystem.ts
systems/HudSystem.ts
```

Entities:

```text
entities/HumanPlayer.ts
entities/AIPlayer.ts
entities/PolicyBall.ts
```

Config:

```text
config/policies.ts
config/gameSettings.ts
```

## 9. Suggested Repo Structure

```text
/apps/web
  /src
    /game
      /scenes
      /systems
      /entities
      /config
    /components
    /lib
      socketClient.ts
      sessionApi.ts

/apps/realtime-server
  /src
    index.ts
    /sessions
    /tiktok
    /sockets
    /config
```

Recommended stack:

```text
Frontend:
- Vite or Next.js
- Phaser 3
- TypeScript
- Socket.IO client

Realtime server:
- Node.js
- TypeScript
- Express
- Socket.IO
- TikTok Live connector library
- Redis optional for scaling

Hosting:
- Vercel for web app
- Railway/Render/Fly.io/VPS for realtime server
```

## 10. Security Requirements

- Only the host token can change the TikTok username.
- Only the host token can change the gift threshold.
- Only the host token can reset the session.
- Only the host token can connect/disconnect the TikTok listener.
- Public clients can join/watch/play only.
- Validate all socket events.
- Rate-limit chat commands.
- Do not expose the host token on the public game route.
- Do not log sensitive host tokens in production.

## 11. MVP Build Order

1. Create Phaser arena with human movement.
2. Add AI players with random/autonomous movement.
3. Add policy balls, throwing, catching, dodging, and collisions.
4. Add policy-colored balls and hit alerts.
5. Add lives, appeals, gift progress, win/loss.
6. Add local mock chat command panel for testing.
7. Add session IDs and isolated local sessions.
8. Add WebSocket server.
9. Add host page for username, threshold, reset, and connection status.
10. Add TikTok connector service.
11. Route TikTok chat/gift events into session-specific WebSocket rooms.
12. Add multi-session cleanup and security checks.
13. Deploy web app to Vercel.
14. Deploy realtime server to persistent Node hosting.

## 12. Testing Checklist

- Two sessions can run at the same time with different TikTok usernames.
- Changing username in Session A does not affect Session B.
- Public game page cannot update host settings.
- Host page requires the correct host token.
- `!play` assigns viewers correctly.
- A viewer cannot control another viewer's AI player.
- AI movement continues after viewer commands.
- Command cooldowns work.
- Gift threshold grants appeals correctly.
- Gift overflow carries into the next appeal meter.
- Human loses at zero lives and zero appeals.
- Human wins when all AI players are eliminated.
- Policy hit alerts display the correct ball message.
- TikTok disconnect/reconnect does not crash the game.
- Session cleanup removes inactive TikTok listeners.

## 13. First Playable Acceptance Criteria

The MVP is complete when:

- A host can create a session.
- A host can configure a TikTok username and appeal threshold.
- A public game link opens the correct isolated session.
- The human player can move, dodge, catch, and throw.
- AI players move autonomously.
- Mock or real chat commands can assign viewers and trigger AI actions.
- Gift events increment the appeal meter.
- Policy balls display restriction alerts on hit.
- Win/loss states work.
- Two sessions can run independently at the same time.

