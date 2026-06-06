# TikTok Live Policy Dodgeball - Design Specification

## 1. Design Goal

Create a readable, stream-friendly Phaser dodgeball game with a dark TikTok Live-inspired interface, bright neon accents, and simple block/pixel character sprites.

The game should feel like a livestream arcade overlay: energetic, easy to understand at a glance, and legible when compressed in a stream window.

## 2. Reference Mock-Up

Included asset:

```text
assets/game-mockup.png
```

Use this as a visual target, not a pixel-perfect requirement. The mock-up defines the intended court layout, HUD regions, policy ball colors, and character direction.

## 3. Visual Direction

### 3.1 Overall Style

- Top-down or slightly isometric dodgeball court.
- Pixel/block art characters.
- Dark broadcast-style UI panels.
- Bright hot pink and cyan accents.
- Minimal but readable game HUD.
- Stream overlay energy without becoming cluttered.

Avoid:

- Photorealistic art.
- Overly detailed sprites.
- Official TikTok logo usage.
- Dense paragraphs of in-game text.
- UI panels that cover gameplay.

## 4. Color Palette

Primary colors:

```text
Black: #000000
Charcoal panel: #141414
Panel border: #3a3a3a
Hot pink/red accent: #ff3b5f
Cyan accent: #25f4ee
White text: #ffffff
Muted text: #a9a9b3
Court floor: warm brown or dark desaturated wood
```

Policy ball starter colors:

```text
Harassment: #ff3b5f
Minor Safety: #25f4ee
Dangerous Acts: #ffd166
Integrity: #9b5de5
Regulated Goods: #f9844a
```

Do not let the whole game become only black/pink/cyan. The court floor and policy ball colors should add contrast.

## 5. Character Design

### 5.1 Human Player

The human player should be visually distinct:

- Larger or slightly brighter than AI players.
- White selection ring below sprite.
- Label such as `YOU`.
- Optional keyboard hint near HUD, not floating over the sprite during active play.

Suggested sprite traits:

- Blocky/pixel chibi proportions.
- Pale cyan skin.
- Brown pixel hair.
- Black-and-white outfit.
- One hot pink eye or visor accent.

The character should be original and simplified. Do not copy the reference image exactly.

### 5.2 AI / Viewer Players

AI players should match the same style family but be smaller or slightly less visually dominant.

Each AI player can show:

- Tiny username label above sprite.
- Assigned/unassigned status.
- Brief action indicator for `DODGE`, `CATCH`, or `THROW`.

Viewer assignment examples:

```text
@nova
@luna
@byte
OPEN
```

### 5.3 Animation States

Required animation states:

```text
idle
run
dodge
catch
throw
hit
eliminated
```

Keep animations short and readable. A few frames per action is enough for the MVP.

## 6. Court Layout

### 6.1 Arena

Use a landscape 16:9 layout.

Recommended regions:

```text
Left half: human player territory
Right half: AI/viewer territory
Center line: bright hot pink divider
Outer bounds: hot pink court line
Outer UI frame: black/charcoal
```

The game camera should keep all players visible. Avoid excessive zooming or camera shake.

### 6.2 Ball Placement

Policy balls should spawn near the center line or neutral zones.

Each ball should be:

- Brightly colored.
- Round and readable.
- Slightly outlined.
- Distinguishable from the court floor.

Moving balls should have a short motion streak or squash/stretch effect.

## 7. HUD Layout

### 7.1 Top Left

Lives and appeals:

```text
LIVES: 3
APPEALS: 1
```

Represent lives with heart icons if available. Appeals can use ticket, shield, or document icons.

### 7.2 Top Center

Session and stream status:

```text
LIVE SESSION
@streamer
Connected
```

Connection states:

```text
Disconnected
Connecting
Connected
Reconnecting
Error
```

### 7.3 Top Right

Viewer command feed:

```text
@viewer1 !play
@viewer2 !dodge
@viewer3 !catch
@viewer4 !throw
```

Keep only the latest 4 to 6 entries visible.

### 7.4 Bottom Left

Host/settings mini panel:

```text
Appeal threshold: 100
Gift progress: [------]
```

This can be visible in the mock/MVP build. In production, it may be hidden from public players and only shown on the host/admin page.

### 7.5 Policy Alert

When the human player is hit, show a short alert:

```text
Restricted: Harassment Policy
```

Alert behavior:

- Appears near center or upper-center.
- Uses the ball's policy color.
- Lasts 1.5 to 2.5 seconds.
- Does not block player input.

## 8. UI Components

### 8.1 Panels

Panel style:

```text
Background: rgba(20, 20, 20, 0.82)
Border: 1px solid rgba(255, 255, 255, 0.16)
Accent line: hot pink or cyan
Radius: 6px to 8px
```

### 8.2 Text

Use pixel or arcade-inspired typography for game labels, but keep body/HUD text legible.

Recommended text hierarchy:

```text
Large: win/loss and major alerts
Medium: panel titles and status
Small: command feed and username tags
```

Avoid tiny text below 12px equivalent for stream-facing UI.

### 8.3 Icons

Use simple icons where useful:

- Heart for lives.
- Ticket/shield/document for appeals.
- Signal dot for connection status.
- Small chat bubble for command feed.

If using a React UI layer, lucide icons are appropriate for host/admin controls.

## 9. Interaction Feedback

### 9.1 Dodge

Visual:

- Sprite crouches or flattens.
- Short cyan outline flash.
- Optional dust/pixel puff.

### 9.2 Catch

Visual:

- Arms open or catch pose.
- Circular timing window around sprite.
- Catch ring should be cyan or white.

### 9.3 Throw

Visual:

- Wind-up frame.
- Ball streak in throw direction.
- Short recoil on sprite.

### 9.4 Hit

Visual:

- Ball policy color flash.
- Small knockback.
- Restriction alert.
- Life or appeal count updates immediately.

### 9.5 Appeal Granted

Visual:

- Gift meter fills.
- Appeal count increments.
- Short celebratory pulse, not a full-screen interruption.

## 10. Accessibility and Readability

- Policy ball color should not be the only identifier. Include a small icon, label, or pattern in the ball legend.
- Alerts must be high contrast.
- UI should remain readable at 1280x720.
- Avoid overlapping HUD and gameplay-critical areas.
- Keep the command feed short.
- Do not rely on rapid flashing effects.

## 11. Responsive Targets

Primary target:

```text
16:9 desktop/browser/stream layout
```

Minimum supported size:

```text
1280x720
```

Optional later target:

```text
Portrait or square crop mode for TikTok Live Studio layouts
```

If portrait/square support is added, keep the court visible and move command/host panels into compact overlays.

## 12. Asset List for MVP

Required assets:

```text
Human player sprite sheet
AI player sprite sheet
Policy ball sprites, 5 colors
Court floor tile or background
Court boundary lines
Selection ring
Catch ring
Ball motion streak
Policy alert panel
HUD panel backgrounds
```

Optional assets:

```text
Gift meter sparkle
Elimination marker
Connection status indicator
Small command icons
Win/loss screen background
```

## 13. Phaser Implementation Notes

- Build sprites at low internal resolution and scale up for crisp pixel art.
- Use nearest-neighbor rendering.
- Keep physics shapes simple: circles for balls, rectangles/circles for players.
- Use layers:
  - court background
  - court lines
  - players
  - balls
  - effects
  - HUD
  - alerts
- Use config files for colors, policy labels, and UI text.

## 14. Design Acceptance Criteria

The visual MVP is acceptable when:

- The human player is instantly distinguishable from AI players.
- Policy balls are distinguishable by color and/or symbol.
- The current lives and appeals are always visible.
- The latest viewer commands are visible but not distracting.
- A policy hit produces a clear restriction alert.
- The game remains readable at 1280x720.
- The screen resembles the included mock-up in tone and layout.

