import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import "./style.css";
import { audio } from "./audio";
import logoUrl from "../../../assets/logo.png?url";
import arenaBackgroundUrl from "../../../assets/arena-background-static.png?url";
import gameplaySpritesUrl from "../../../assets/gameplay-sprites.png?url";
import gameplaySpritesAtlasUrl from "../../../assets/gameplay-sprites.json?url";

const WIDTH = 1600;
const HEIGHT = 900;
const COURT = { x: 150, y: 205, w: 1300, h: 535 };
const LEFT_LIMIT = COURT.x + COURT.w / 2 - 26;
const RIGHT_LIMIT = COURT.x + COURT.w / 2 + 26;
const REALTIME_URL = "http://127.0.0.1:8787";

type Mode = "menu" | "options" | "playing" | "gameover";
type ActionName = "idle" | "run" | "dodge" | "catch" | "throw" | "hit" | "eliminated";
type Team = "human" | "ai";

type Policy = {
  id: string;
  label: string;
  shortLabel: string;
  color: number;
  css: string;
  symbol: string;
  hitMessage: string;
};

type Player = {
  id: string;
  team: Team;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lives: number;
  eliminated: boolean;
  action: ActionName;
  actionUntil: number;
  dodgeUntil: number;
  catchUntil: number;
  throwCooldown: number;
  pickupLockedUntil: number;
  heldBallId: string | null;
  aiTargetX: number;
  aiTargetY: number;
  assignedViewer: string | null;
  tint: number;
};

type Ball = {
  id: string;
  policy: Policy;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heldBy: string | null;
  lastThrownBy: Team | null;
  hotUntil: number;
};

type FeedItem = {
  user: string;
  command: string;
  age: number;
  color: string;
};

type TikTokStatusEvent = {
  username: string;
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
};

type TikTokChatEvent = {
  username: string;
  comment: string;
};

type TikTokGiftEvent = {
  username: string;
  giftName: string;
  diamondValue: number;
  repeatCount: number;
};

type TikTokMemberEvent = {
  username: string;
};

type GameSnapshot = {
  mode: Mode;
  sessionId: string;
  coordinateSystem: string;
  human: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    lives: number;
    appeals: number;
    action: ActionName;
    holdingBallId: string | null;
  };
  ai: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    eliminated: boolean;
    action: ActionName;
    assignedViewer: string | null;
    holdingBallId: string | null;
  }>;
  balls: Array<{
    id: string;
    policy: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    heldBy: string | null;
    lastThrownBy: Team | null;
  }>;
  commandFeed: FeedItem[];
  settings: {
    difficulty: number;
    gameSpeed: number;
    tiktokUsername: string;
    streamConnected: boolean;
  };
  giftProgress: number;
  appealGiftThreshold: number;
  aiming: {
    active: boolean;
    power: number;
    angleDegrees: number | null;
  };
  alert: string | null;
  winner: "human" | "ai" | null;
};

const POLICIES: Policy[] = [
  { id: "harassment", label: "Harassment", shortLabel: "HAR", color: 0xff3b5f, css: "#ff3b5f", symbol: "!", hitMessage: "Restricted: Harassment Policy" },
  { id: "dangerous_acts", label: "Dangerous Acts", shortLabel: "DNG", color: 0x25f4ee, css: "#25f4ee", symbol: ">", hitMessage: "Restricted: Dangerous Acts Policy" },
  { id: "minor_safety", label: "Minor Safety", shortLabel: "MIN", color: 0xffd166, css: "#ffd166", symbol: "+", hitMessage: "Restricted: Minor Safety Policy" },
  { id: "integrity", label: "Integrity", shortLabel: "INT", color: 0x9b5de5, css: "#9b5de5", symbol: "?", hitMessage: "Restricted: Integrity Policy" },
  { id: "regulated_goods", label: "Regulated Goods", shortLabel: "REG", color: 0xf9844a, css: "#f9844a", symbol: "#", hitMessage: "Restricted: Regulated Goods Policy" },
];

const FEED_COLORS = ["#ff3b5f", "#25f4ee", "#ffd166", "#9b5de5", "#f9844a"];

type ThrowDrag = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  ballId: string | null;
  power: number;
};

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
    banball?: {
      start: () => void;
      options: () => void;
      reset: () => void;
      setDifficulty: (difficulty: number) => void;
      setUsername: (username: string) => void;
      refreshSession: () => void;
      resetAssignments: () => void;
      mockCommand: (username: string, command: string) => void;
      mockGift: (value?: number) => void;
    };
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function sessionIdFromPath() {
  const gameMatch = window.location.pathname.match(/\/game\/([^/?#]+)/);
  if (gameMatch?.[1]) return gameMatch[1];
  const stored = window.localStorage.getItem("banball-session-id");
  if (stored) return stored;
  const created = Math.random().toString(16).slice(2, 10);
  window.localStorage.setItem("banball-session-id", created);
  return created;
}

class BanballScene extends Phaser.Scene {
  private mode: Mode = "menu";
  private logo?: Phaser.GameObjects.Image;
  private titleGroup?: Phaser.GameObjects.Group;
  private uiLayer?: Phaser.GameObjects.Container;
  private courtLayer?: Phaser.GameObjects.Graphics;
  private environmentLayer?: Phaser.GameObjects.Container;
  private playersLayer?: Phaser.GameObjects.Container;
  private ballsLayer?: Phaser.GameObjects.Container;
  private effectsLayer?: Phaser.GameObjects.Container;
  private hudLayer?: Phaser.GameObjects.Graphics;
  private textLayer?: Phaser.GameObjects.Container;
  private menuButtons: Phaser.GameObjects.GameObject[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly heldKeys = new Set<string>();
  private throwDrag: ThrowDrag = {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    ballId: null,
    power: 0,
  };
  private human!: Player;
  private aiPlayers: Player[] = [];
  private balls: Ball[] = [];
  private playerSprites = new Map<string, Phaser.GameObjects.Container>();
  private ballSprites = new Map<string, Phaser.GameObjects.Container>();
  private socket?: Socket;
  private usernameInput?: HTMLInputElement;
  private sessionActionButton?: HTMLButtonElement;
  private appealButton?: HTMLButtonElement;
  private resetAssignmentsButton?: HTMLButtonElement;
  private elapsed = 0;
  private lives = 3;
  private appeals = 1;
  private giftProgress = 0;
  private appealGiftThreshold = 100;
  private feed: FeedItem[] = [];
  private alertText: string | null = "Restricted: Harassment Policy";
  private alertColor = 0xff3b5f;
  private alertUntil = 2600;
  private winner: "human" | "ai" | null = null;
  private tiktokUsername = "";
  private streamConnected = false;
  private readonly sessionId = sessionIdFromPath();
  private readonly options = { sfx: true, difficulty: 2 };

  preload() {
    this.load.image("logo", logoUrl);
    this.load.image("arenaBackground", arenaBackgroundUrl);
    this.load.atlas("gameplaySprites", gameplaySpritesUrl, gameplaySpritesAtlasUrl);
  }

  create() {
    this.scale.setGameSize(WIDTH, HEIGHT);
    this.cameras.main.setBackgroundColor("#000000");
    this.createTextures();
    this.setupLayers();
    this.setupInput();
    window.addEventListener("resize", () => {
      this.syncUsernameInputBounds();
      this.syncSessionActionButtonBounds();
      this.syncAppealButtonBounds();
      this.syncResetAssignmentsButtonBounds();
    });
    this.resetGameState();
    this.showMenu();
    this.installTestHooks();
  }

  update(_time: number, deltaMs: number) {
    if (this.mode === "playing") {
      this.step((deltaMs / 1000) * this.gameSpeed());
      this.redraw();
    }
  }

  private installTestHooks() {
    window.render_game_to_text = () => JSON.stringify(this.snapshot());
    window.advanceTime = (ms: number) => {
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let i = 0; i < steps; i += 1) {
        if (this.mode === "playing") this.step((1 / 60) * this.gameSpeed());
      }
      this.redraw();
    };
    window.banball = {
      start: () => this.startGame(),
      options: () => this.showOptions(),
      reset: () => this.startGame(),
      setDifficulty: (difficulty) => this.setDifficulty(difficulty),
      setUsername: (username) => this.setTikTokUsername(username),
      refreshSession: () => this.refreshLiveSession(),
      resetAssignments: () => this.resetAiAssignments(),
      mockCommand: (username, command) => this.applyCommand(username, command),
      mockGift: (value = 10) => this.applyGift(value),
    };
  }

  private gameSpeed() {
    return 0.78 + this.options.difficulty * 0.1;
  }

  private setupLayers() {
    const bg = this.add.image(0, 0, "arenaBackground");
    bg.setOrigin(0, 0);
    bg.setDisplaySize(WIDTH, HEIGHT);
    bg.setDepth(-100);
    this.courtLayer = this.add.graphics();
    this.courtLayer.setDepth(-10);
    this.environmentLayer = this.add.container(0, 0);
    this.environmentLayer.setDepth(-20);
    this.ballsLayer = this.add.container(0, 0);
    this.ballsLayer.setDepth(10);
    this.playersLayer = this.add.container(0, 0);
    this.playersLayer.setDepth(20);
    this.effectsLayer = this.add.container(0, 0);
    this.effectsLayer.setDepth(40);
    this.hudLayer = this.add.graphics();
    this.hudLayer.setDepth(100);
    this.textLayer = this.add.container(0, 0);
    this.textLayer.setDepth(110);
    this.uiLayer = this.add.container(0, 0);
    this.uiLayer.setDepth(120);
  }

  private setupInput() {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      arrowUp: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      arrowDown: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      arrowLeft: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      arrowRight: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      catch: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      catchAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      throw: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      throwAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      pause: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      fullscreen: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
      one: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      three: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      four: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      five: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
      gift: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G),
    };
    keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    ]);
    window.addEventListener("keydown", (event) => {
      audio.resume();
      this.heldKeys.add(event.code);
      this.heldKeys.add(event.key.toLowerCase());
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => {
      this.heldKeys.delete(event.code);
      this.heldKeys.delete(event.key.toLowerCase());
    });
    keyboard.on("keydown-F", () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });
    keyboard.on("keydown-ESC", () => {
      if (this.mode === "options") this.showMenu();
      else if (this.mode === "gameover") this.showMenu();
    });
    keyboard.on("keydown-ONE", () => this.mode === "options" ? this.setDifficulty(1) : this.applyCommand("pixelgoat", "!play"));
    keyboard.on("keydown-TWO", () => this.mode === "options" ? this.setDifficulty(2) : this.applyCommand("mochi_07", "!dodge"));
    keyboard.on("keydown-THREE", () => this.mode === "options" ? this.setDifficulty(3) : this.applyCommand("catnap99", "!catch"));
    keyboard.on("keydown-FOUR", () => this.mode === "options" ? this.setDifficulty(4) : this.applyCommand("goober42", "!throw"));
    keyboard.on("keydown-FIVE", () => {
      if (this.mode === "options") this.setDifficulty(5);
    });
    keyboard.on("keydown-R", () => {
      if (this.mode === "playing") this.refreshLiveSession();
    });
    keyboard.on("keydown-G", () => this.applyGift(20));
    keyboard.on("keydown-M", () => {
      const muted = audio.toggleMuted();
      this.addFeed("system", muted ? "sound off" : "sound on", "#25f4ee");
      if (this.mode === "playing") this.redraw();
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      audio.resume();
      this.beginThrowDrag(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => this.updateThrowDrag(pointer));
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => this.releaseThrowDrag(pointer));
    this.input.on("pointerupoutside", (pointer: Phaser.Input.Pointer) => this.releaseThrowDrag(pointer));
  }

  private createTextures() {
    this.createBenchSprite();
    this.createSpectatorTexture();
    this.createBallCartTexture();
  }

  private createPixelPlayerTexture(key: string, face: number, hair: number, accent: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const fill = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
    const hairHex = hex(hair);
    const faceHex = hex(face);
    const accentHex = hex(accent);
    const outline = "#05070a";
    const cloth = "#10131a";
    const apron = "#edfaff";
    const blush = "#ff9fb8";
    fill(18, 2, 12, 4, apron);
    fill(13, 5, 6, 5, apron);
    fill(29, 5, 6, 5, apron);
    fill(10, 9, 28, 5, hairHex);
    fill(7, 14, 34, 8, hairHex);
    fill(5, 22, 9, 18, hairHex);
    fill(34, 22, 9, 18, hairHex);
    fill(9, 38, 8, 10, hairHex);
    fill(31, 38, 8, 10, hairHex);
    fill(13, 17, 22, 5, faceHex);
    fill(11, 22, 26, 18, faceHex);
    fill(14, 40, 20, 4, faceHex);
    fill(17, 25, 4, 5, outline);
    fill(30, 25, 4, 5, accentHex);
    fill(18, 34, 3, 3, blush);
    fill(31, 34, 3, 3, blush);
    fill(23, 35, 7, 3, "#57333a");
    fill(14, 44, 20, 5, apron);
    fill(11, 48, 26, 6, cloth);
    fill(8, 52, 32, 6, cloth);
    fill(11, 55, 7, 5, apron);
    fill(22, 55, 5, 5, apron);
    fill(31, 55, 7, 5, apron);
    fill(5, 46, 7, 9, apron);
    fill(36, 46, 7, 9, apron);
    fill(15, 59, 8, 5, outline);
    fill(28, 59, 8, 5, outline);
    fill(7, 62, 14, 2, outline);
    fill(27, 62, 14, 2, outline);
    fill(12, 7, 3, 3, accentHex);
    fill(33, 7, 3, 3, accentHex);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.strokeRect(11, 22, 26, 18);
    ctx.strokeRect(11, 48, 26, 10);
    fill(8, 12, 32, 8, hairHex);
    fill(6, 20, 9, 24, hairHex);
    fill(33, 20, 9, 24, hairHex);
    fill(11, 37, 8, 10, hairHex);
    fill(29, 37, 8, 10, hairHex);
    fill(14, 18, 20, 4, faceHex);
    fill(13, 22, 22, 17, faceHex);
    fill(16, 8, 16, 5, apron);
    fill(11, 6, 6, 4, apron);
    fill(31, 6, 6, 4, apron);
    fill(17, 24, 4, 5, outline);
    fill(30, 24, 4, 5, accentHex);
    fill(18, 34, 3, 3, blush);
    fill(31, 34, 3, 3, blush);
    fill(23, 35, 7, 3, "#5e2f3a");
    fill(12, 43, 24, 5, apron);
    fill(10, 48, 28, 6, cloth);
    fill(7, 53, 34, 5, cloth);
    fill(12, 55, 7, 5, apron);
    fill(22, 55, 5, 5, apron);
    fill(32, 55, 7, 5, apron);
    fill(5, 46, 8, 9, apron);
    fill(36, 46, 8, 9, apron);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.strokeRect(13, 22, 22, 17);
    ctx.strokeRect(10, 48, 28, 10);
    this.textures.addCanvas(key, canvas);
  }

  private createBenchSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 92;
    canvas.height = 44;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 14, 92, 18);
    ctx.fillStyle = "#232a32";
    ctx.fillRect(4, 18, 84, 6);
    ctx.fillStyle = "#ff3b5f";
    ctx.fillRect(8, 11, 26, 4);
    ctx.fillRect(60, 11, 24, 4);
    ctx.fillStyle = "#050506";
    ctx.fillRect(8, 33, 8, 11);
    ctx.fillRect(76, 33, 8, 11);
    this.textures.addCanvas("bench", canvas);
  }

  private createSpectatorTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 34;
    canvas.height = 38;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(8, 6, 18, 20);
    ctx.fillStyle = "#dffbff";
    ctx.fillRect(11, 10, 12, 12);
    ctx.fillStyle = "#ff3b5f";
    ctx.fillRect(15, 14, 3, 4);
    ctx.fillStyle = "#edfaff";
    ctx.fillRect(9, 24, 16, 6);
    ctx.fillStyle = "#11141b";
    ctx.fillRect(7, 30, 20, 5);
    ctx.fillStyle = "#25f4ee";
    ctx.fillRect(4, 18, 4, 5);
    this.textures.addCanvas("spectator", canvas);
  }

  private createBallCartTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 76;
    canvas.height = 72;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0c1218";
    ctx.fillRect(8, 25, 60, 34);
    ctx.fillStyle = "#26313b";
    ctx.fillRect(13, 31, 50, 20);
    ctx.strokeStyle = "#5f7280";
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 25, 60, 34);
    const balls = [["#ff3b5f", 20, 19], ["#ff3b5f", 34, 13], ["#25f4ee", 48, 20], ["#ffd166", 28, 32], ["#9b5de5", 43, 33]];
    for (const [color, x, y] of balls) {
      ctx.fillStyle = "#05070a";
      ctx.beginPath();
      ctx.arc(Number(x) + 2, Number(y) + 3, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = String(color);
      ctx.beginPath();
      ctx.arc(Number(x), Number(y), 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff3f6";
      ctx.fillRect(Number(x) - 4, Number(y) - 5, 4, 3);
    }
    ctx.fillStyle = "#05070a";
    ctx.fillRect(12, 59, 10, 6);
    ctx.fillRect(54, 59, 10, 6);
    this.textures.addCanvas("ballCart", canvas);
  }

  private resetGameState() {
    this.elapsed = 0;
    this.lives = 3;
    this.appeals = 1;
    this.giftProgress = 0;
    this.winner = null;
    this.alertText = null;
    this.alertUntil = 0;
    this.human = {
      id: "human",
      team: "human",
      name: "YOU",
      x: 365,
      y: 455,
      vx: 0,
      vy: 0,
      lives: 3,
      eliminated: false,
      action: "idle",
      actionUntil: 0,
      dodgeUntil: 0,
      catchUntil: 0,
      throwCooldown: 0,
      pickupLockedUntil: 0,
      heldBallId: null,
      aiTargetX: 365,
      aiTargetY: 455,
      assignedViewer: null,
      tint: 0xffffff,
    };
    this.aiPlayers = [
      this.createAi("ai_1", "", 1010, 315, 0xff3b5f, null),
      this.createAi("ai_2", "", 1115, 395, 0x25f4ee, null),
      this.createAi("ai_3", "", 980, 535, 0xffd166, null),
      this.createAi("ai_4", "", 1250, 500, 0x9b5de5, null),
    ];
    this.balls = this.createInitialBalls();
  }

  // Split balls evenly between the two sides; the odd ball goes to a random team.
  private createInitialBalls(): Ball[] {
    const total = POLICIES.length;
    const perTeam = Math.floor(total / 2);
    const teams: Team[] = [];
    for (let i = 0; i < perTeam; i += 1) teams.push("human", "ai");
    if (total % 2 === 1) teams.push(Math.random() < 0.5 ? "human" : "ai");

    const placed: Record<Team, number> = { human: 0, ai: 0 };
    const laneCount: Record<Team, number> = {
      human: teams.filter((t) => t === "human").length,
      ai: teams.filter((t) => t === "ai").length,
    };
    const top = COURT.y + 70;
    const usableH = COURT.h - 140;

    return teams.map((team, index) => {
      const lane = placed[team];
      placed[team] += 1;
      const y = top + usableH * ((lane + 0.5) / laneCount[team]) + Phaser.Math.Between(-24, 24);
      const x = team === "human"
        ? Phaser.Math.Between(COURT.x + 90, LEFT_LIMIT - 70)
        : Phaser.Math.Between(RIGHT_LIMIT + 70, COURT.x + COURT.w - 90);
      return this.createBall(`ball_${index + 1}`, POLICIES[index], x, y, 0, 0);
    });
  }

  private createAi(id: string, name: string, x: number, y: number, tint: number, assignedViewer: string | null): Player {
    return {
      id,
      team: "ai",
      name,
      x,
      y,
      vx: 0,
      vy: 0,
      lives: 1,
      eliminated: false,
      action: "idle",
      actionUntil: 0,
      dodgeUntil: 0,
      catchUntil: 0,
      throwCooldown: 0,
      pickupLockedUntil: 0,
      heldBallId: null,
      aiTargetX: x,
      aiTargetY: y,
      assignedViewer,
      tint,
    };
  }

  private createBall(id: string, policy: Policy, x: number, y: number, vx: number, vy: number): Ball {
    return { id, policy, x, y, vx, vy, heldBy: null, lastThrownBy: vx < 0 ? "ai" : vx > 0 ? "human" : null, hotUntil: 0 };
  }

  private showMenu() {
    this.mode = "menu";
    this.hideUsernameInput();
    this.hideSessionActionButton();
    this.hideAppealButton();
    this.hideResetAssignmentsButton();
    this.clearMenu();
    this.textLayer?.removeAll(true);
    this.uiLayer?.removeAll(true);
    this.environmentLayer?.removeAll(true);
    this.redraw();
    this.addLogo(800, 238, 0.48);
    this.drawStartBackdrop();
    this.addMenuButton("START", 800, 568, 260, 62, 0xff3b5f, () => this.startGame());
    this.addMenuButton("OPTIONS", 800, 646, 260, 56, 0x25f4ee, () => this.showOptions());
    this.addMenuText("LIVE SESSION READY", 800, 465, 32, "#ffffff", "#ff3b5f");
    this.addMenuText(`SESSION ${this.sessionId.toUpperCase()}`, 800, 504, 18, "#a9a9b3");
  }

  private showOptions() {
    this.mode = "options";
    this.hideSessionActionButton();
    this.hideAppealButton();
    this.hideResetAssignmentsButton();
    this.clearMenu();
    this.environmentLayer?.removeAll(true);
    this.redraw();
    this.addLogo(800, 170, 0.3);
    this.drawOptionsBackdrop();
    this.addMenuText("OPTIONS", 800, 330, 44, "#25f4ee", "#000000");
    this.addMenuText("DIFFICULTY", 800, 392, 24, "#ffffff");
    this.addMenuText("AI SMARTNESS + GAME SPEED", 800, 424, 16, "#a9a9b3");
    for (let i = 1; i <= 5; i += 1) {
      const active = i === this.options.difficulty;
      this.addMenuButton(String(i), 650 + (i - 1) * 75, 472, 56, 50, active ? 0xff3b5f : 0x25f4ee, () => this.setDifficulty(i));
    }
    this.addMenuText(`SPEED x${this.gameSpeed().toFixed(2)}`, 800, 522, 18, "#25f4ee");
    this.addMenuText("TIKTOK USERNAME", 800, 552, 18, "#25f4ee");
    this.showUsernameInput();
    this.addMenuText("CONTROLS", 800, 656, 23, "#ffffff");
    this.addMenuText("WASD / ARROWS MOVE     SPACE DODGE     C CATCH", 800, 690, 17, "#a9a9b3");
    this.addMenuText("DRAG HELD BALL BACK TO AIM, RELEASE TO THROW", 800, 720, 17, "#a9a9b3");
    this.addMenuButton("BACK", 800, 790, 220, 52, 0xff3b5f, () => this.showMenu());
  }

  private setDifficulty(difficulty: number) {
    this.options.difficulty = clamp(Math.round(difficulty), 1, 5);
    if (this.mode === "options") this.showOptions();
  }

  private setTikTokUsername(username: string) {
    const clean = username.replace(/^@+/, "").replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 24);
    this.tiktokUsername = clean;
    this.streamConnected = false;
    if (this.usernameInput && this.usernameInput.value !== this.tiktokUsername) {
      this.usernameInput.value = this.tiktokUsername;
    }
    if (this.mode === "options") this.showOptions();
  }

  private showUsernameInput() {
    if (!this.usernameInput) {
      const input = document.createElement("input");
      input.className = "banball-username-input";
      input.type = "text";
      input.maxLength = 24;
      input.spellcheck = false;
      input.autocomplete = "off";
      input.placeholder = "streamer username";
      input.setAttribute("aria-label", "TikTok username");
      input.addEventListener("input", () => {
        const clean = input.value.replace(/^@+/, "").replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 24);
        if (input.value !== clean) input.value = clean;
        this.tiktokUsername = clean;
        this.streamConnected = false;
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") input.blur();
        if (event.key === "Escape") {
          input.value = this.tiktokUsername;
          input.blur();
        }
      });
      document.body.appendChild(input);
      this.usernameInput = input;
    }
    this.usernameInput.value = this.tiktokUsername;
    this.usernameInput.style.display = "block";
    this.syncUsernameInputBounds();
  }

  private hideUsernameInput() {
    if (this.usernameInput) this.usernameInput.style.display = "none";
  }

  private ensureSessionActionButton() {
    if (!this.sessionActionButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "banball-session-action-button";
      button.addEventListener("click", () => {
        if (!this.tiktokUsername) this.showMenu();
        else if (!this.streamConnected) this.refreshLiveSession();
      });
      document.body.appendChild(button);
      this.sessionActionButton = button;
    }
    this.syncSessionActionButtonBounds();
  }

  private hideSessionActionButton() {
    if (this.sessionActionButton) this.sessionActionButton.style.display = "none";
  }

  private syncSessionActionButtonBounds() {
    if (!this.sessionActionButton) return;
    if (this.mode !== "playing" || this.streamConnected) {
      this.sessionActionButton.style.display = "none";
      return;
    }
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / WIDTH;
    const scaleY = rect.height / HEIGHT;
    const x = this.tiktokUsername ? 975 : 955;
    const y = 74;
    const w = this.tiktokUsername ? 132 : 178;
    const h = 34;
    this.sessionActionButton.textContent = this.tiktokUsername ? "CONNECT" : "BACK TO START";
    this.sessionActionButton.style.display = "block";
    this.sessionActionButton.style.left = `${rect.left + x * scaleX}px`;
    this.sessionActionButton.style.top = `${rect.top + y * scaleY}px`;
    this.sessionActionButton.style.width = `${w * scaleX}px`;
    this.sessionActionButton.style.height = `${h * scaleY}px`;
    this.sessionActionButton.style.fontSize = `${Math.max(11, 17 * scaleY)}px`;
  }

  private ensureAppealButton() {
    if (!this.appealButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "banball-appeal-button";
      button.setAttribute("aria-label", "Add appeal");
      button.title = "Add appeal";
      button.addEventListener("click", () => this.grantAppeal());
      document.body.appendChild(button);
      this.appealButton = button;
    }
    this.syncAppealButtonBounds();
  }

  private hideAppealButton() {
    if (this.appealButton) this.appealButton.style.display = "none";
  }

  private syncAppealButtonBounds() {
    if (!this.appealButton) return;
    if (this.mode !== "playing") {
      this.appealButton.style.display = "none";
      return;
    }
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / WIDTH;
    const scaleY = rect.height / HEIGHT;
    const x = 218;
    const y = 74;
    const w = 34;
    const h = 34;
    this.appealButton.style.display = "block";
    this.appealButton.style.left = `${rect.left + x * scaleX}px`;
    this.appealButton.style.top = `${rect.top + y * scaleY}px`;
    this.appealButton.style.width = `${w * scaleX}px`;
    this.appealButton.style.height = `${h * scaleY}px`;
  }

  private ensureResetAssignmentsButton() {
    if (!this.resetAssignmentsButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "banball-reset-ai-button";
      button.textContent = "RESET AI";
      button.addEventListener("click", () => this.resetAiAssignments());
      document.body.appendChild(button);
      this.resetAssignmentsButton = button;
    }
    this.syncResetAssignmentsButtonBounds();
  }

  private hideResetAssignmentsButton() {
    if (this.resetAssignmentsButton) this.resetAssignmentsButton.style.display = "none";
  }

  private syncResetAssignmentsButtonBounds() {
    if (!this.resetAssignmentsButton) return;
    if (this.mode !== "playing" || !this.streamConnected) {
      this.resetAssignmentsButton.style.display = "none";
      return;
    }
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / WIDTH;
    const scaleY = rect.height / HEIGHT;
    const x = 955;
    const y = 74;
    const w = 144;
    const h = 34;
    this.resetAssignmentsButton.style.display = "block";
    this.resetAssignmentsButton.style.left = `${rect.left + x * scaleX}px`;
    this.resetAssignmentsButton.style.top = `${rect.top + y * scaleY}px`;
    this.resetAssignmentsButton.style.width = `${w * scaleX}px`;
    this.resetAssignmentsButton.style.height = `${h * scaleY}px`;
    this.resetAssignmentsButton.style.fontSize = `${Math.max(11, 17 * scaleY)}px`;
  }

  private syncUsernameInputBounds() {
    if (!this.usernameInput || this.mode !== "options") return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / WIDTH;
    const scaleY = rect.height / HEIGHT;
    const x = 540;
    const y = 574;
    const w = 520;
    const h = 54;
    this.usernameInput.style.left = `${rect.left + x * scaleX}px`;
    this.usernameInput.style.top = `${rect.top + y * scaleY}px`;
    this.usernameInput.style.width = `${w * scaleX}px`;
    this.usernameInput.style.height = `${h * scaleY}px`;
    this.usernameInput.style.fontSize = `${Math.max(12, 22 * scaleY)}px`;
  }

  private connectRealtime() {
    if (this.socket) return this.socket;
    this.socket = io(REALTIME_URL, {
      reconnection: true,
      transports: ["websocket", "polling"],
    });
    this.socket.on("connect", () => {
      this.socket?.emit("session:join", { sessionId: this.sessionId, role: "game" });
    });
    this.socket.on("connect_error", () => {
      this.streamConnected = false;
      this.addFeed("system", "server offline", "#ff3b5f");
      this.alertText = "Live server unavailable";
      this.alertColor = 0xff3b5f;
      this.alertUntil = this.elapsed + 2200;
      this.syncSessionActionButtonBounds();
      this.syncResetAssignmentsButtonBounds();
      if (this.mode === "playing") this.redraw();
    });
    this.socket.on("tiktok:status", (event: TikTokStatusEvent) => this.handleTikTokStatus(event));
    this.socket.on("tiktok:chat", (event: TikTokChatEvent) => this.applyLiveChat(event.username, event.comment));
    this.socket.on("tiktok:chatCommand", (event: { username: string; command: string }) => this.applyCommand(event.username, event.command));
    this.socket.on("tiktok:gift", (event: TikTokGiftEvent) => this.applyGift(event.diamondValue * event.repeatCount, event.username));
    this.socket.on("tiktok:member", (event: TikTokMemberEvent) => this.addFeed(event.username, "joined", "#a9b6bf"));
    return this.socket;
  }

  private handleTikTokStatus(event: TikTokStatusEvent) {
    const wasConnected = this.streamConnected;
    this.streamConnected = event.status === "connected";
    if (event.status === "connected" && !wasConnected) {
      this.addFeed(event.username || this.tiktokUsername, "connected", "#25f4ee");
      this.ensureResetAssignmentsButton();
      audio.play("stream_connect");
    }
    if (event.status === "error") {
      this.addFeed(event.username || this.tiktokUsername || "system", "live error", "#ff3b5f");
      this.alertText = "TikTok live connection failed";
      this.alertColor = 0xff3b5f;
      this.alertUntil = this.elapsed + 2200;
      audio.play("stream_disconnect");
    }
    if (event.status === "disconnected") {
      this.addFeed(event.username || this.tiktokUsername || "system", "disconnected", "#ff3b5f");
      if (wasConnected) audio.play("stream_disconnect");
    }
    this.syncSessionActionButtonBounds();
    this.syncResetAssignmentsButtonBounds();
    if (this.mode === "playing") this.redraw();
  }

  private refreshLiveSession() {
    if (!this.tiktokUsername) {
      this.streamConnected = false;
      this.showMenu();
      return;
    }
    this.streamConnected = false;
    this.addFeed(this.tiktokUsername, "connecting", "#25f4ee");
    this.connectRealtime().emit("tiktok:connect", { sessionId: this.sessionId, username: this.tiktokUsername });
    this.syncSessionActionButtonBounds();
    this.syncResetAssignmentsButtonBounds();
    if (this.mode === "playing") this.redraw();
  }

  private grantAppeal() {
    if (this.mode !== "playing") return;
    this.appeals = Math.min(9, this.appeals + 1);
    audio.play("appeal");
    this.alertText = "Appeal granted";
    this.alertColor = 0x25f4ee;
    this.alertUntil = this.elapsed + 1200;
    this.redraw();
  }

  private resetAiAssignments() {
    if (!this.streamConnected) return;
    for (const ai of this.aiPlayers) {
      ai.assignedViewer = null;
      ai.name = "";
    }
    this.addFeed(this.tiktokUsername || "host", "reset slots", "#25f4ee");
    this.rebuildSprites();
    if (this.mode === "playing") this.redraw();
  }

  private startGame() {
    audio.resume();
    audio.play("start");
    this.mode = "playing";
    this.hideUsernameInput();
    this.clearMenu();
    this.resetGameState();
    this.rebuildSprites();
    this.alertText = "Restricted: Harassment Policy";
    this.alertColor = 0xff3b5f;
    this.alertUntil = 2400;
    this.ensureSessionActionButton();
    this.ensureAppealButton();
    this.syncResetAssignmentsButtonBounds();
    this.redraw();
  }

  private showGameOver(winner: "human" | "ai") {
    this.mode = "gameover";
    audio.play(winner === "human" ? "win" : "lose");
    this.hideUsernameInput();
    this.hideSessionActionButton();
    this.hideAppealButton();
    this.hideResetAssignmentsButton();
    this.winner = winner;
    this.clearMenu();
    this.redraw();
    const label = winner === "human" ? "YOU WIN" : "STREAM RESTRICTED";
    this.addMenuText(label, 800, 408, 58, winner === "human" ? "#25f4ee" : "#ff3b5f", "#000000");
    this.addMenuText(winner === "human" ? "AI TEAM ELIMINATED" : "NO LIVES OR APPEALS LEFT", 800, 472, 24, "#ffffff");
    this.addMenuButton("RESTART", 800, 590, 250, 58, 0xff3b5f, () => this.startGame());
    this.addMenuButton("MENU", 800, 670, 220, 52, 0x25f4ee, () => this.showMenu());
  }

  private clearMenu() {
    if (this.mode !== "options") this.hideUsernameInput();
    this.logo?.destroy();
    this.logo = undefined;
    this.menuButtons.forEach((item) => item.destroy());
    this.menuButtons = [];
    this.titleGroup?.destroy();
    this.titleGroup = undefined;
  }

  private addLogo(x: number, y: number, scale: number) {
    this.logo = this.add.image(x, y, "logo");
    this.logo.setScale(scale);
    this.logo.setDepth(130);
  }

  private addMenuText(text: string, x: number, y: number, size: number, color: string, stroke = "#000000") {
    const obj = this.add.text(x, y, text, {
      fontFamily: '"Courier New", monospace',
      fontSize: `${size}px`,
      color,
      fontStyle: "bold",
      stroke,
      strokeThickness: 5,
      align: "center",
    });
    obj.setOrigin(0.5);
    obj.setDepth(135);
    this.menuButtons.push(obj);
    return obj;
  }

  private addMenuButton(text: string, x: number, y: number, w: number, h: number, accent: number, onClick: () => void, fontSize = 30) {
    const group = this.add.container(x, y).setDepth(135);
    const g = this.add.graphics();
    const bg = 0x050707;
    g.fillStyle(bg, 0.92);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    g.lineStyle(3, accent, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    g.fillStyle(accent, 1);
    g.fillRect(-w / 2, -h / 2, 8, h);
    const label = this.add.text(0, 0, text, {
      fontFamily: '"Courier New", monospace',
      fontSize: `${fontSize}px`,
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0.5);
    label.setPadding(2, 2, 2, 8);
    group.add([g, label]);
    group.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    group.on("pointerover", () => {
      group.setScale(1.035);
      audio.play("ui_hover");
    });
    group.on("pointerout", () => group.setScale(1));
    group.on("pointerdown", () => {
      audio.resume();
      audio.play("ui_click");
      onClick();
    });
    this.menuButtons.push(group);
    return group;
  }

  private drawStartBackdrop() {
    const g = this.hudLayer!;
    g.clear();
    g.fillStyle(0x000000, 0.58);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.lineStyle(2, 0xff3b5f, 0.8);
    g.strokeRoundedRect(520, 430, 560, 250, 10);
    g.lineStyle(2, 0x25f4ee, 0.85);
    g.strokeRoundedRect(540, 450, 520, 210, 10);
  }

  private drawOptionsBackdrop() {
    const g = this.hudLayer!;
    g.clear();
    g.fillStyle(0x000000, 0.6);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0x050707, 0.88);
    g.fillRoundedRect(500, 300, 600, 545, 10);
    g.lineStyle(3, 0xff3b5f, 0.95);
    g.strokeRoundedRect(500, 300, 600, 545, 10);
    g.lineStyle(2, 0x25f4ee, 0.9);
    g.strokeRoundedRect(520, 320, 560, 505, 8);
  }

  private rebuildSprites() {
    this.playersLayer?.removeAll(true);
    this.ballsLayer?.removeAll(true);
    this.effectsLayer?.removeAll(true);
    this.playerSprites.clear();
    this.ballSprites.clear();
    for (const ball of this.balls) {
      const sprite = this.createBallSprite(ball);
      this.ballsLayer?.add(sprite);
      this.ballSprites.set(ball.id, sprite);
    }
    const humanSprite = this.createPlayerSprite(this.human);
    this.playersLayer?.add(humanSprite);
    this.playerSprites.set(this.human.id, humanSprite);
    for (const ai of this.aiPlayers) {
      const sprite = this.createPlayerSprite(ai);
      this.playersLayer?.add(sprite);
      this.playerSprites.set(ai.id, sprite);
    }
  }

  private createPlayerSprite(player: Player) {
    const group = this.add.container(player.x, player.y);
    const shadow = this.add.ellipse(5, 34, player.team === "human" ? 78 : 60, 18, 0x05070a, 0.44);
    const ring = this.add.ellipse(0, 28, 90, 40).setStrokeStyle(4, player.team === "human" ? 0xeefbff : player.tint, player.team === "human" ? 1 : 0.5);
    const catchRing = this.add.ellipse(0, 16, player.team === "human" ? 112 : 88, player.team === "human" ? 66 : 52).setStrokeStyle(3, 0x25f4ee, 0);
    const body = this.add.image(0, 0, "gameplaySprites", "player_idle");
    this.setPlayerArt(body, player, "player_idle");
    const labelText = player.team === "human" ? player.name : player.assignedViewer ? player.name : "OPEN";
    const labelColor = player.team === "human"
      ? "#ff3b5f"
      : player.assignedViewer
        ? `#${player.tint.toString(16).padStart(6, "0")}`
        : "#a9b6bf";
    const labelBg = this.add.graphics();
    const markerY = player.team === "human" ? -132 : -112;
    const markerW = Math.max(player.team === "human" ? 66 : 62, labelText.length * (player.team === "human" ? 14 : 11) + 24);
    const markerH = player.team === "human" ? 34 : 28;
    const label = this.add.text(0, markerY, labelText, {
      fontFamily: '"Courier New", monospace',
      fontSize: player.team === "human" ? "22px" : "16px",
      color: labelColor,
      fontStyle: "bold",
      align: "center",
      fixedWidth: markerW,
    }).setOrigin(0.5);
    labelBg.fillStyle(0x050505, 0.96);
    labelBg.fillRoundedRect(-markerW / 2, markerY - markerH / 2, markerW, markerH, 5);
    const pointer = this.add.triangle(0, markerY + markerH / 2 + 8, -10, -7, 10, -7, 0, 8, player.team === "human" ? 0xff3b5f : player.tint, 1);
    group.add([shadow, ring, catchRing, body, labelBg, label, pointer]);
    group.setData("body", body);
    group.setData("ring", ring);
    group.setData("catchRing", catchRing);
    group.setData("label", label);
    return group;
  }

  private createBallSprite(ball: Ball) {
    const group = this.add.container(ball.x, ball.y);
    const shadow = this.add.ellipse(0, 22, 50, 14, 0x000000, 0.34);
    const art = this.add.image(0, 0, "gameplaySprites", this.ballFrame(ball, false));
    const label = this.add.text(0, -2, ball.policy.symbol, {
      fontFamily: '"Courier New", monospace',
      fontSize: "18px",
      color: "#111111",
      fontStyle: "bold",
    }).setOrigin(0.5);
    group.add([shadow, art, label]);
    group.setData("art", art);
    group.setData("label", label);
    this.paintBall(group, ball);
    return group;
  }

  private paintBall(group: Phaser.GameObjects.Container, ball: Ball) {
    const art = group.getData("art") as Phaser.GameObjects.Image;
    const label = group.getData("label") as Phaser.GameObjects.Text;
    const speed = Math.hypot(ball.vx, ball.vy);
    const trailing = speed > 80 && !ball.heldBy;
    art.setFrame(this.ballFrame(ball, trailing));
    art.setScale(1);
    art.setOrigin(trailing ? 26 / art.width : 0.5, 0.5);
    art.setRotation(0);
    label.setPosition(0, -2);
    if (trailing) {
      const angle = Math.atan2(ball.vy, ball.vx);
      art.setRotation(angle - Math.PI);
      label.setPosition(0, -1);
    }
  }

  private ballFrame(ball: Ball, trailing: boolean) {
    return `ball_${ball.policy.id}${trailing ? "_trail" : ""}`;
  }

  private playerBaseHeight(player: Player) {
    return player.team === "human" ? 112 : 92;
  }

  private setPlayerArt(body: Phaser.GameObjects.Image, player: Player, frame: string, xScale = 1, yScale = 1) {
    body.setFrame(frame);
    body.setOrigin(0.5, 0.78);
    body.setFlipX(player.team === "ai");
    body.setAlpha(1);
    body.clearTint();
    const targetHeight = frame === "player_dodge" ? this.playerBaseHeight(player) * 0.76 : this.playerBaseHeight(player);
    const scale = targetHeight / body.height;
    body.setScale(scale * xScale, scale * yScale);
  }

  private step(dt: number) {
    this.elapsed += dt * 1000;
    this.feed.forEach((item) => {
      item.age += dt;
    });
    this.handleHumanInput(dt);
    this.updateAi(dt);
    this.updateBallHolds();
    this.updateBalls(dt);
    this.handleCollisions();
    this.updateActions();
    if (this.alertText && this.elapsed > this.alertUntil) {
      this.alertText = null;
    }
    if (!this.winner && this.aiPlayers.every((ai) => ai.eliminated)) {
      this.showGameOver("human");
    }
    if (!this.winner && this.lives <= 0 && this.appeals <= 0) {
      this.showGameOver("ai");
    }
  }

  private handleHumanInput(dt: number) {
    const k = this.keys;
    const xAxis = Number(this.isHeld("d", "KeyD", k.right, k.arrowRight)) - Number(this.isHeld("a", "KeyA", k.left, k.arrowLeft));
    const yAxis = Number(this.isHeld("s", "KeyS", k.down, k.arrowDown)) - Number(this.isHeld("w", "KeyW", k.up, k.arrowUp));
    const len = Math.hypot(xAxis, yAxis) || 1;
    const speed = this.elapsed < this.human.dodgeUntil ? 118 : 245;
    this.human.vx = (xAxis / len) * speed;
    this.human.vy = (yAxis / len) * speed;
    this.human.x = clamp(this.human.x + this.human.vx * dt, COURT.x + 70, LEFT_LIMIT - 60);
    this.human.y = clamp(this.human.y + this.human.vy * dt, COURT.y + 80, COURT.y + COURT.h - 70);
    if (Phaser.Input.Keyboard.JustDown(k.dodge)) {
      this.human.dodgeUntil = this.elapsed + 520;
      this.human.action = "dodge";
      this.human.actionUntil = this.elapsed + 520;
      audio.play("dodge");
    }
    if (Phaser.Input.Keyboard.JustDown(k.catch) || Phaser.Input.Keyboard.JustDown(k.catchAlt)) {
      this.human.catchUntil = this.elapsed + 620;
      this.human.action = "catch";
      this.human.actionUntil = this.elapsed + 620;
      audio.play("dodge", { rate: 1.3, volume: 0.6 });
    }
    if (Math.abs(this.human.vx) + Math.abs(this.human.vy) > 120) {
      audio.play("step", { rate: 0.9 + Math.random() * 0.3, throttleMs: 260 });
    }
    if (!this.throwDrag.active && (Phaser.Input.Keyboard.JustDown(k.throw) || Phaser.Input.Keyboard.JustDown(k.throwAlt)) && this.elapsed > this.human.throwCooldown) {
      this.throwNearestBall(this.human, "human");
    }
    if (this.elapsed > this.human.actionUntil) {
      this.human.action = Math.abs(this.human.vx) + Math.abs(this.human.vy) > 8 ? "run" : "idle";
    }
  }

  private isHeld(primary: string, code: string, ...keys: Array<Phaser.Input.Keyboard.Key | undefined>) {
    return this.heldKeys.has(primary) || this.heldKeys.has(code) || keys.some((key) => key?.isDown);
  }

  private beginThrowDrag(pointer: Phaser.Input.Pointer) {
    if (this.mode !== "playing" || this.human.eliminated || this.elapsed < this.human.throwCooldown) return;
    const ball = this.getHumanThrowableBall(pointer.x, pointer.y);
    if (!ball) return;
    if (!this.human.heldBallId) {
      this.human.heldBallId = ball.id;
      ball.heldBy = this.human.id;
    }
    ball.vx = 0;
    ball.vy = 0;
    this.throwDrag = {
      active: true,
      startX: ball.x,
      startY: ball.y,
      currentX: pointer.x,
      currentY: pointer.y,
      ballId: ball.id,
      power: 0,
    };
    this.human.action = "throw";
    this.human.actionUntil = this.elapsed + 999999;
  }

  private updateThrowDrag(pointer: Phaser.Input.Pointer) {
    if (!this.throwDrag.active) return;
    this.throwDrag.currentX = pointer.x;
    this.throwDrag.currentY = pointer.y;
    this.throwDrag.power = clamp(
      Math.hypot(this.throwDrag.startX - pointer.x, this.throwDrag.startY - pointer.y),
      0,
      230,
    );
  }

  private releaseThrowDrag(pointer: Phaser.Input.Pointer) {
    if (!this.throwDrag.active) return;
    this.updateThrowDrag(pointer);
    const ball = this.balls.find((candidate) => candidate.id === this.throwDrag.ballId);
    const dx = this.throwDrag.startX - this.throwDrag.currentX;
    const dy = this.throwDrag.startY - this.throwDrag.currentY;
    const power = this.throwDrag.power;
    this.throwDrag = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, ballId: null, power: 0 };
    if (!ball || power < 18) {
      this.human.actionUntil = this.elapsed;
      return;
    }
    this.throwBallWithVector(this.human, ball, dx, dy, power, "human");
  }

  private getHumanThrowableBall(pointerX: number, pointerY: number) {
    const held = this.human.heldBallId ? this.balls.find((ball) => ball.id === this.human.heldBallId) : undefined;
    if (held && (distance(held, { x: pointerX, y: pointerY }) < 96 || distance(this.human, { x: pointerX, y: pointerY }) < 112)) {
      return held;
    }
    return this.balls
      .filter((ball) => !ball.heldBy && Math.abs(ball.vx) < 80 && distance(ball, this.human) < 96)
      .filter((ball) => distance(ball, { x: pointerX, y: pointerY }) < 112 || distance(this.human, { x: pointerX, y: pointerY }) < 112)
      .sort((a, b) => distance(a, this.human) - distance(b, this.human))[0];
  }

  private updateAi(dt: number) {
    for (const ai of this.aiPlayers) {
      if (ai.eliminated) continue;
      if (Math.abs(ai.x - ai.aiTargetX) < 18 || Math.abs(ai.y - ai.aiTargetY) < 12 || Math.random() < 0.006 * this.options.difficulty) {
        ai.aiTargetX = Phaser.Math.Between(RIGHT_LIMIT + 70, COURT.x + COURT.w - 95);
        ai.aiTargetY = Phaser.Math.Between(COURT.y + 95, COURT.y + COURT.h - 80);
      }
      const nearestThreat = this.balls.find((ball) => !ball.heldBy && ball.vx > 90 && ball.x > RIGHT_LIMIT - 80 && distance(ball, ai) < 220);
      const seekBall = this.getAiSeekBall(ai);
      let targetX = ai.aiTargetX;
      let targetY = ai.aiTargetY;
      if (ai.heldBallId) {
        targetX = clamp(RIGHT_LIMIT + 150 + Math.sin(this.elapsed / 500 + ai.x) * 85, RIGHT_LIMIT + 70, COURT.x + COURT.w - 95);
        targetY = clamp(this.human.y + Math.sin(this.elapsed / 650 + ai.y) * 85, COURT.y + 80, COURT.y + COURT.h - 72);
        if (!ai.assignedViewer && this.elapsed > ai.throwCooldown && Math.random() < 0.045 * this.options.difficulty) {
          this.throwNearestBall(ai, "ai");
        }
      } else if (nearestThreat) {
        targetY = nearestThreat.y > ai.y ? ai.y - 120 : ai.y + 120;
        targetX = clamp(ai.x + (nearestThreat.y > ai.y ? 34 : -34), RIGHT_LIMIT + 55, COURT.x + COURT.w - 72);
        ai.action = "dodge";
        ai.actionUntil = this.elapsed + 320;
      } else if (seekBall) {
        targetX = seekBall.x;
        targetY = seekBall.y;
        if (distance(ai, seekBall) < 70) {
          ai.action = "catch";
          ai.actionUntil = this.elapsed + 260;
        }
      }
      const dx = clamp(targetX, RIGHT_LIMIT + 55, COURT.x + COURT.w - 72) - ai.x;
      const dy = clamp(targetY, COURT.y + 80, COURT.y + COURT.h - 72) - ai.y;
      const len = Math.hypot(dx, dy) || 1;
      const speed = seekBall && !ai.heldBallId ? 185 + this.options.difficulty * 24 : ai.action === "catch" ? 115 : 130 + this.options.difficulty * 18;
      ai.vx = (dx / len) * speed;
      ai.vy = (dy / len) * speed;
      ai.x = clamp(ai.x + ai.vx * dt, RIGHT_LIMIT + 55, COURT.x + COURT.w - 72);
      ai.y = clamp(ai.y + ai.vy * dt, COURT.y + 80, COURT.y + COURT.h - 72);
      if (this.elapsed > ai.actionUntil) {
        ai.action = Math.abs(ai.vx) + Math.abs(ai.vy) > 8 ? "run" : "idle";
      }
    }
  }

  private getAiSeekBall(ai: Player) {
    const awareness = 190 + this.options.difficulty * 105;
    return this.balls
      .filter((ball) => {
        if (ball.heldBy || Math.hypot(ball.vx, ball.vy) > 150) return false;
        if (ball.lastThrownBy === "human" && this.elapsed < ball.hotUntil) return false;
        if (distance(ai, ball) > awareness) return false;
        return ball.x >= RIGHT_LIMIT - 45;
      })
      .sort((a, b) => {
        const aScore = distance(ai, a) + Math.abs(a.x - RIGHT_LIMIT) * 0.18;
        const bScore = distance(ai, b) + Math.abs(b.x - RIGHT_LIMIT) * 0.18;
        return aScore - bScore;
      })[0];
  }

  private updateBallHolds() {
    const players = [this.human, ...this.aiPlayers];
    for (const player of players) {
      if (player.eliminated) continue;
      if (!player.heldBallId && this.elapsed >= player.pickupLockedUntil) {
        const ball = this.balls.find((candidate) => !candidate.heldBy && Math.abs(candidate.vx) < 70 && distance(candidate, player) < 58);
        if (ball) {
          player.heldBallId = ball.id;
          ball.heldBy = player.id;
          ball.vx = 0;
          ball.vy = 0;
          ball.lastThrownBy = null;
          ball.hotUntil = 0;
          if (player.team === "ai") {
            player.action = "catch";
            player.actionUntil = this.elapsed + 320;
            player.throwCooldown = Math.max(player.throwCooldown, this.elapsed + 520);
          }
        }
      }
      if (player.heldBallId) {
        const ball = this.balls.find((candidate) => candidate.id === player.heldBallId);
        if (ball) {
          const dir = player.team === "human" ? 1 : -1;
          ball.x = player.x + dir * 36;
          ball.y = player.y - 28;
        }
      }
    }
  }

  private throwNearestBall(player: Player, team: Team) {
    if (player.eliminated) return;
    let ball = player.heldBallId ? this.balls.find((candidate) => candidate.id === player.heldBallId) : undefined;
    if (!ball) {
      ball = this.balls
        .filter((candidate) => !candidate.heldBy && distance(candidate, player) < 95)
        .sort((a, b) => distance(a, player) - distance(b, player))[0];
    }
    if (!ball) return;
    const target = team === "human"
      ? this.aiPlayers.filter((ai) => !ai.eliminated).sort((a, b) => distance(a, player) - distance(b, player))[0]
      : this.human;
    if (!target) return;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    this.throwBallWithVector(player, ball, dx, dy, 150, team);
  }

  private throwBallWithVector(player: Player, ball: Ball, dx: number, dy: number, power: number, team: Team) {
    const len = Math.hypot(dx, dy) || 1;
    const speed = team === "human" ? clamp(170 + power * 3.05, 230, 875) : 475;
    ball.heldBy = null;
    player.heldBallId = null;
    ball.x = player.x + (team === "human" ? 46 : -46);
    ball.y = player.y - 25;
    ball.vx = (dx / len) * speed;
    ball.vy = (dy / len) * speed;
    ball.lastThrownBy = team;
    ball.hotUntil = this.elapsed + 2600;
    audio.play("throw", { rate: 0.9 + Math.random() * 0.2, volume: team === "human" ? 1 : 0.8 });
    player.action = "throw";
    player.actionUntil = this.elapsed + 360;
    player.throwCooldown = this.elapsed + (team === "human" ? 450 : 1700);
    player.pickupLockedUntil = this.elapsed + (team === "human" ? 420 : 260);
  }

  private updateBalls(dt: number) {
    for (const ball of this.balls) {
      if (ball.heldBy) continue;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.vx *= 0.992;
      ball.vy *= 0.992;
      const speed = Math.abs(ball.vx) + Math.abs(ball.vy);
      if (ball.x < COURT.x + 28 || ball.x > COURT.x + COURT.w - 28) {
        ball.vx *= -0.74;
        ball.x = clamp(ball.x, COURT.x + 28, COURT.x + COURT.w - 28);
        if (speed > 120) audio.play("bounce", { rate: 0.85 + Math.random() * 0.3, volume: Math.min(1, speed / 500), throttleMs: 70 });
      }
      if (ball.y < COURT.y + 28 || ball.y > COURT.y + COURT.h - 28) {
        ball.vy *= -0.74;
        ball.y = clamp(ball.y, COURT.y + 28, COURT.y + COURT.h - 28);
        if (speed > 120) audio.play("bounce", { rate: 0.85 + Math.random() * 0.3, volume: Math.min(1, speed / 500), throttleMs: 70 });
      }
      if (Math.abs(ball.vx) + Math.abs(ball.vy) < 22) {
        ball.vx = 0;
        ball.vy = 0;
        ball.lastThrownBy = null;
      }
    }
  }

  private handleCollisions() {
    for (const ball of this.balls) {
      if (ball.heldBy || ball.lastThrownBy === null || this.elapsed > ball.hotUntil) continue;
      if (ball.lastThrownBy === "ai" && distance(ball, this.human) < 52) {
        if (this.elapsed < this.human.catchUntil) {
          this.human.heldBallId = ball.id;
          ball.heldBy = this.human.id;
          ball.vx = 0;
          ball.vy = 0;
          ball.lastThrownBy = null;
          audio.play("catch");
          this.human.action = "catch";
          this.human.actionUntil = this.elapsed + 500;
        } else if (this.elapsed > this.human.dodgeUntil) {
          this.hitHuman(ball);
        }
      }
      if (ball.lastThrownBy === "human") {
        for (const ai of this.aiPlayers) {
          if (ai.eliminated || distance(ball, ai) >= 46) continue;
          if (ai.action === "catch") {
            ai.heldBallId = ball.id;
            ball.heldBy = ai.id;
            ball.vx = 0;
            ball.vy = 0;
            ball.lastThrownBy = null;
            audio.play("catch", { volume: 0.7 });
          } else if (ai.action !== "dodge") {
            ai.eliminated = true;
            ai.action = "eliminated";
            ball.vx *= -0.35;
            ball.vy *= -0.35;
            ball.lastThrownBy = null;
            audio.play("elim");
            this.addFeed(ai.name, "ELIM", `#${ai.tint.toString(16).padStart(6, "0")}`);
          }
        }
      }
    }
  }

  private hitHuman(ball: Ball) {
    if (this.appeals > 0) this.appeals -= 1;
    else this.lives = Math.max(0, this.lives - 1);
    audio.play("hit");
    this.human.action = "hit";
    this.human.actionUntil = this.elapsed + 580;
    ball.vx *= -0.4;
    ball.vy *= -0.4;
    ball.lastThrownBy = null;
    this.alertText = ball.policy.hitMessage;
    this.alertColor = ball.policy.color;
    this.alertUntil = this.elapsed + 2200;
  }

  private updateActions() {
    const players = [this.human, ...this.aiPlayers];
    for (const player of players) {
      const sprite = this.playerSprites.get(player.id);
      if (!sprite) continue;
      sprite.setPosition(player.x, player.y);
      const body = sprite.getData("body") as Phaser.GameObjects.Image;
      const ring = sprite.getData("ring") as Phaser.GameObjects.Ellipse;
      const catchRing = sprite.getData("catchRing") as Phaser.GameObjects.Ellipse;
      const phase = Math.sin(this.elapsed / 100);
      catchRing.setAlpha(0);
      ring.setAlpha(1);
      body.x = 0;
      body.setRotation(0);
      ring.setStrokeStyle(player.team === "human" ? 4 : 3, player.team === "human" ? 0xffffff : player.tint, player.team === "human" ? 1 : 0.5);
      if (player.action === "run") {
        this.setPlayerArt(body, player, "player_idle", 1, 1 + Math.abs(phase) * 0.025);
        body.setRotation(phase * 0.06);
      } else if (player.action === "dodge") {
        this.setPlayerArt(body, player, "player_dodge", 1.02, 1);
        body.setRotation(player.team === "human" ? -0.04 : 0.04);
        ring.setStrokeStyle(5, 0x25f4ee, 1);
      } else if (player.action === "catch") {
        this.setPlayerArt(body, player, "player_catch", 1, 1);
        ring.setStrokeStyle(6, 0x25f4ee, 1);
        catchRing.setAlpha(0.85 + Math.sin(this.elapsed / 70) * 0.12);
        catchRing.setStrokeStyle(4, 0x25f4ee, catchRing.alpha);
      } else if (player.action === "throw") {
        this.setPlayerArt(body, player, "player_throw", 1, 1);
        body.setRotation(player.team === "human" ? -0.08 : 0.08);
        ring.setStrokeStyle(5, player.team === "human" ? 0xff3b5f : player.tint, 1);
      } else if (player.action === "hit") {
        this.setPlayerArt(body, player, "player_hit", 1, 1);
        body.setRotation(phase * 0.16);
        body.x = Math.sin(this.elapsed / 35) * 5;
        body.setTint(this.alertColor);
      } else if (player.action === "eliminated") {
        this.setPlayerArt(body, player, "player_hit", 1, 1);
        body.setRotation(Math.PI / 2);
        body.setAlpha(0.45);
        ring.setAlpha(0.25);
      } else {
        this.setPlayerArt(body, player, "player_idle", 1, 1);
      }
      if (player.action !== "hit") body.setTint(0xffffff);
    }
    for (const ball of this.balls) {
      const sprite = this.ballSprites.get(ball.id);
      if (!sprite) continue;
      sprite.setPosition(ball.x, ball.y);
      this.paintBall(sprite, ball);
    }
  }

  private applyCommand(username: string, command: string) {
    if (!this.streamConnected) return;
    const normalized = command.startsWith("!") ? command : `!${command}`;
    const assigned = this.aiPlayers.find((ai) => ai.assignedViewer === username);
    if (normalized === "!play") {
      const open = this.aiPlayers.find((ai) => !ai.assignedViewer);
      if (open) {
        open.assignedViewer = username;
        open.name = username;
        audio.play("command");
      }
    } else if (assigned && !assigned.eliminated) {
      if (normalized === "!dodge") {
        assigned.action = "dodge";
        assigned.actionUntil = this.elapsed + 650;
        assigned.dodgeUntil = this.elapsed + 650;
        audio.play("dodge", { volume: 0.8 });
      }
      if (normalized === "!catch") {
        assigned.action = "catch";
        assigned.actionUntil = this.elapsed + 760;
        assigned.catchUntil = this.elapsed + 760;
        audio.play("dodge", { rate: 1.3, volume: 0.5 });
      }
      if (normalized === "!throw") {
        this.throwNearestBall(assigned, "ai");
      }
    }
    this.addFeed(username, normalized, FEED_COLORS[this.feed.length % FEED_COLORS.length]);
    this.rebuildSprites();
  }

  private applyLiveChat(username: string, comment: string) {
    const clean = comment.trim();
    if (!clean) return;
    if (clean.startsWith("!")) {
      this.applyCommand(username, clean);
      return;
    }
    this.addFeed(username, clean.length > 14 ? `${clean.slice(0, 13)}...` : clean, FEED_COLORS[this.feed.length % FEED_COLORS.length]);
  }

  private applyGift(value: number, username = "giftbot") {
    if (!this.streamConnected) return;
    this.giftProgress += value;
    audio.play("gift", { throttleMs: 120 });
    while (this.giftProgress >= this.appealGiftThreshold) {
      this.appeals += 1;
      this.giftProgress -= this.appealGiftThreshold;
      this.alertText = "Appeal granted";
      this.alertColor = 0x25f4ee;
      this.alertUntil = this.elapsed + 1600;
      audio.play("appeal");
    }
    this.addFeed(username, `+${value} gift`, "#25f4ee");
  }

  private addFeed(user: string, command: string, color: string) {
    this.feed.unshift({ user: user.replace(/^@/, ""), command, age: 0, color });
    this.feed = this.feed.slice(0, 5);
  }

  private redraw() {
    this.courtLayer?.clear();
    this.hudLayer?.clear();
    this.textLayer?.removeAll(true);
    if (this.mode === "menu" || this.mode === "options") return;
    const court = this.courtLayer!;
    this.drawThrowPreview(court);
    this.drawHud();
    this.updateActions();
  }

  private drawBroadcastFrame(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(0x020406, 1);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0x080b0e, 1);
    g.fillRect(0, 0, WIDTH, 160);
    g.fillRect(0, 750, WIDTH, 150);
    g.fillRect(0, 0, 110, HEIGHT);
    g.fillRect(1490, 0, 110, HEIGHT);
    g.fillStyle(0x0d1117, 1);
    g.fillRect(68, 150, WIDTH - 136, 38);
    g.fillRect(68, 734, WIDTH - 136, 40);
    for (let x = 85; x < WIDTH - 80; x += 96) {
      g.fillStyle(0x141a20, 0.9);
      g.fillRect(x, 154, 58, 18);
      g.fillRect(x + 14, 750, 58, 18);
      g.fillStyle(0xff3b5f, 0.72);
      g.fillRect(x + 10, 171, 26, 4);
      g.fillStyle(0x25f4ee, 0.48);
      g.fillRect(x + 32, 768, 28, 4);
    }
    g.lineStyle(5, 0x25f4ee, 0.7);
    g.beginPath();
    g.moveTo(0, 890);
    g.lineTo(38, 890);
    g.lineTo(76, 845);
    g.lineTo(170, 845);
    g.strokePath();
    g.beginPath();
    g.moveTo(1600, 890);
    g.lineTo(1562, 890);
    g.lineTo(1524, 845);
    g.lineTo(1430, 845);
    g.strokePath();
  }

  private drawCourt(g: Phaser.GameObjects.Graphics, alpha: number) {
    g.fillStyle(0x11100f, alpha);
    g.fillRect(COURT.x - 85, COURT.y - 72, COURT.w + 170, COURT.h + 145);
    g.fillStyle(0x080a0c, 0.72 * alpha);
    g.fillRect(COURT.x - 110, COURT.y - 45, 70, COURT.h + 90);
    g.fillRect(COURT.x + COURT.w + 40, COURT.y - 45, 70, COURT.h + 90);
    for (let y = COURT.y - 50; y < COURT.y + COURT.h + 80; y += 42) {
      g.fillStyle(0x13171a, 0.78 * alpha);
      g.fillRect(COURT.x - 80, y, COURT.w + 160, 18);
    }
    g.fillStyle(0x59371f, alpha);
    g.fillRect(COURT.x - 8, COURT.y - 6, COURT.w + 16, COURT.h + 12);
    g.fillStyle(0x754827, alpha);
    g.fillRect(COURT.x, COURT.y, COURT.w, COURT.h);
    for (let row = 0; row < 15; row += 1) {
      const y = COURT.y + row * 36;
      g.fillStyle(row % 2 ? 0x6d4326 : 0x7d4f2e, 0.22 * alpha);
      g.fillRect(COURT.x, y, COURT.w, 18);
    }
    for (let x = COURT.x; x < COURT.x + COURT.w; x += 64) {
      g.lineStyle(2, 0x95613a, 0.45 * alpha);
      g.lineBetween(x, COURT.y, x, COURT.y + COURT.h);
      g.lineStyle(1, 0x422718, 0.28 * alpha);
      g.lineBetween(x + 31, COURT.y, x + 31, COURT.y + COURT.h);
    }
    for (let y = COURT.y; y < COURT.y + COURT.h; y += 34) {
      g.lineStyle(2, 0x5f3c25, 0.42 * alpha);
      g.lineBetween(COURT.x, y, COURT.x + COURT.w, y);
    }
    g.fillStyle(0x1a100b, 0.2 * alpha);
    g.fillRect(COURT.x, COURT.y, COURT.w, 44);
    g.fillRect(COURT.x, COURT.y + COURT.h - 52, COURT.w, 52);
    g.lineStyle(8, 0xff3b5f, 0.94 * alpha);
    g.strokeRect(COURT.x, COURT.y, COURT.w, COURT.h);
    g.lineStyle(7, 0xff3b5f, 0.88 * alpha);
    g.lineBetween(COURT.x + COURT.w / 2, COURT.y, COURT.x + COURT.w / 2, COURT.y + COURT.h);
    g.lineStyle(3, 0xff3b5f, 0.45 * alpha);
    g.strokeRect(COURT.x + 38, COURT.y + 38, COURT.w - 76, COURT.h - 76);
    g.fillStyle(0xff3b5f, 0.18 * alpha);
    g.fillRect(COURT.x, COURT.y, COURT.w, 11);
    g.fillRect(COURT.x, COURT.y + COURT.h - 11, COURT.w, 11);
    g.fillStyle(0x020406, 0.34 * alpha);
    g.fillRect(COURT.x - 85, COURT.y - 72, COURT.w + 170, 46);
    g.fillRect(COURT.x - 85, COURT.y + COURT.h + 32, COURT.w + 170, 42);
    g.fillRect(COURT.x - 85, COURT.y - 72, 72, COURT.h + 145);
    g.fillRect(COURT.x + COURT.w + 13, COURT.y - 72, 72, COURT.h + 145);
    this.drawPixelBursts(g, 365, 80, 0xff3b5f);
    this.drawPixelBursts(g, 1230, 78, 0xff3b5f);
  }

  private drawPixelBursts(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number) {
    g.fillStyle(color, 0.95);
    const blocks = [
      [0, 0], [24, 8], [-22, 20], [42, 28], [3, 42], [-35, 55], [24, 65], [58, 58], [-55, 72],
    ];
    for (const [dx, dy] of blocks) {
      g.fillRect(x + dx, y + dy, 9, 9);
    }
  }

  private drawThrowPreview(g: Phaser.GameObjects.Graphics) {
    if (!this.throwDrag.active || !this.throwDrag.ballId) return;
    const ball = this.balls.find((candidate) => candidate.id === this.throwDrag.ballId);
    if (!ball) return;
    const dx = this.throwDrag.startX - this.throwDrag.currentX;
    const dy = this.throwDrag.startY - this.throwDrag.currentY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const power = this.throwDrag.power;
    const endDistance = 150 + power * 2.25;
    const startX = ball.x;
    const startY = ball.y;
    g.lineStyle(3, 0x25f4ee, 0.9);
    g.lineBetween(startX, startY, this.throwDrag.currentX, this.throwDrag.currentY);
    g.fillStyle(0xff3b5f, 0.95);
    g.fillCircle(this.throwDrag.currentX, this.throwDrag.currentY, 9);
    for (let i = 1; i <= 13; i += 1) {
      const t = i / 13;
      const x = startX + nx * endDistance * t;
      const y = startY + ny * endDistance * t;
      const radius = 7 - t * 3;
      g.fillStyle(i % 2 === 0 ? 0x25f4ee : 0xffffff, 1 - t * 0.55);
      g.fillCircle(x, y, radius);
    }
    const arrowX = startX + nx * Math.min(endDistance, 245);
    const arrowY = startY + ny * Math.min(endDistance, 245);
    const angle = Math.atan2(ny, nx);
    g.fillStyle(0x25f4ee, 0.95);
    g.beginPath();
    g.moveTo(arrowX + Math.cos(angle) * 18, arrowY + Math.sin(angle) * 18);
    g.lineTo(arrowX - Math.cos(angle) * 10 + Math.cos(angle + Math.PI / 2) * 12, arrowY - Math.sin(angle) * 10 + Math.sin(angle + Math.PI / 2) * 12);
    g.lineTo(arrowX - Math.cos(angle) * 10 + Math.cos(angle - Math.PI / 2) * 12, arrowY - Math.sin(angle) * 10 + Math.sin(angle - Math.PI / 2) * 12);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x050505, 0.78);
    g.fillRoundedRect(startX - 54, startY - 72, 108, 32, 5);
    this.addHudText(`PWR ${Math.round(power)}`, startX - 42, startY - 68, 16, "#25f4ee");
  }

  private drawBenches() {
    const old = this.environmentLayer?.getByName("benches");
    if (old) old.destroy();
    const benchGroup = this.add.container(0, 0).setName("benches");
    const positions = [
      [360, 184], [455, 184], [550, 184], [1060, 184], [1155, 184], [1250, 184], [1345, 184],
      [455, 760], [550, 760], [645, 760], [1045, 760], [1140, 760], [1235, 760],
    ];
    for (const [x, y] of positions) {
      benchGroup.add(this.add.image(x, y, "bench").setScale(1.05));
    }
    const spectatorPositions = [
      [370, 158, 0xff3b5f], [435, 158, 0x25f4ee], [500, 158, 0xffd166],
      [1090, 158, 0xdffbff], [1160, 158, 0x9b5de5], [1232, 158, 0xf9844a], [1300, 158, 0xdffbff],
      [485, 742, 0xdffbff], [548, 742, 0xff3b5f], [606, 742, 0x25f4ee],
      [1066, 742, 0xffd166], [1130, 742, 0xdffbff], [1198, 742, 0x25f4ee],
    ];
    for (const [x, y, tint] of spectatorPositions) {
      const spectator = this.add.image(Number(x), Number(y), "spectator").setScale(1.1);
      spectator.setTint(Number(tint));
      benchGroup.add(spectator);
    }
    benchGroup.add(this.add.image(108, 370, "ballCart").setScale(1.18));
    benchGroup.add(this.add.image(1492, 375, "ballCart").setScale(1.18));
    benchGroup.add(this.add.image(135, 535, "bench").setScale(0.95).setRotation(Math.PI / 2));
    benchGroup.add(this.add.image(1468, 535, "bench").setScale(0.95).setRotation(Math.PI / 2));
    this.environmentLayer?.add(benchGroup);
  }

  private drawHud() {
    const g = this.hudLayer!;
    this.drawPanel(g, 12, 12, 282, 118, 0xff3b5f);
    this.addHudText("LIVES", 30, 33, 24, "#ffffff");
    for (let i = 0; i < 3; i += 1) {
      this.drawHeart(g, 116 + i * 42, 39, i < this.lives ? 0xff3b5f : 0x56585d);
    }
    this.addHudText("APPEALS", 30, 92, 24, "#ffffff");
    this.addHudText(String(this.appeals), 156, 86, 36, "#25f4ee");
    this.drawPlusBox(g, 218, 74);

    this.drawSessionBanner(g);
    if (this.streamConnected) this.drawCommandFeed(g);
    this.drawHostPanel(g);
    this.drawPolicyLegend(g);
    this.drawScorePlate(g);
    if (this.alertText) this.drawAlert(g);
  }

  private drawPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, accent: number) {
    g.fillStyle(0x020406, 0.95);
    g.fillRoundedRect(x, y, w, h, 7);
    g.lineStyle(4, 0x000000, 0.45);
    g.strokeRoundedRect(x + 2, y + 2, w, h, 7);
    g.lineStyle(1, 0xeefbff, 0.18);
    g.strokeRoundedRect(x, y, w, h, 7);
    g.lineStyle(2, accent, 0.88);
    g.lineBetween(x, y + h, x + w, y + h);
    g.lineStyle(1, accent, 0.28);
    g.strokeRoundedRect(x + 6, y + 6, w - 12, h - 12, 5);
  }

  private drawSessionBanner(g: Phaser.GameObjects.Graphics) {
    const x = 455;
    const y = 16;
    const w = 690;
    const h = 92;
    g.fillStyle(0x050606, 0.92);
    g.fillRect(x, y, w, h);
    g.lineStyle(4, 0xff3b5f, 1);
    g.lineBetween(x, y, x + 42, y);
    g.lineBetween(x, y, x, y + h);
    g.lineBetween(x, y + h, x + 42, y + h);
    g.lineStyle(4, 0x25f4ee, 1);
    g.lineBetween(x + w - 42, y, x + w, y);
    g.lineBetween(x + w, y, x + w, y + h);
    g.lineBetween(x + w - 42, y + h, x + w, y + h);
    if (!this.tiktokUsername) {
      g.fillStyle(0xffd166, 1);
      g.fillCircle(x + 88, y + 30, 11);
      this.addHudText("ADD USERNAME IN OPTIONS", x + 122, y + 18, 27, "#ffd166");
      return;
    }
    if (!this.streamConnected) {
      g.fillStyle(0xff3b5f, 1);
      g.fillCircle(x + 92, y + 30, 11);
      this.addHudText("REFRESH SESSION", x + 126, y + 17, 32, "#ff3b5f");
      this.addHudText(`@${this.tiktokUsername}`, x + 430, y + 20, 25, "#eefbff");
      return;
    }
    g.fillStyle(0x25f4ee, 1);
    g.fillCircle(x + 110, y + 30, 11);
    this.addHudText("LIVE SESSION", x + 138, y + 17, 34, "#25f4ee");
    const displayName = `@${this.tiktokUsername}`.slice(0, 18);
    this.addHudText(displayName, x + 410, y + 20, 22, "#eefbff");
    const seconds = Math.floor(this.elapsed / 1000);
    const timer = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    this.addHudText(`${timer}  |  CONNECTED`, x + 150, y + 66, 21, "#eefbff");
  }

  private drawCommandFeed(g: Phaser.GameObjects.Graphics) {
    this.drawPanel(g, 1268, 12, 320, 252, 0xff3b5f);
    g.fillStyle(0xff3b5f, 1);
    g.fillRoundedRect(1296, 26, 28, 22, 4);
    g.fillStyle(0x050505, 1);
    g.fillRect(1302, 36, 4, 4);
    g.fillRect(1312, 36, 4, 4);
    g.fillRect(1322, 36, 4, 4);
    this.addHudText("LIVE COMMANDS", 1334, 27, 22, "#ff3b5f");
    this.feed.slice(0, 5).forEach((item, index) => {
      const y = 80 + index * 38;
      const user = item.user.length > 12 ? `${item.user.slice(0, 10)}..` : item.user;
      const command = item.command.length > 13 ? `${item.command.slice(0, 11)}..` : item.command;
      g.fillStyle(index % 2 === 0 ? 0x111318 : 0x080a0d, 0.42);
      g.fillRect(1286, y - 8, 284, 29);
      this.addHudText(user, 1290, y, 16, item.color);
      this.addHudText(command, 1406, y, 16, "#eefbff");
      this.addHudText(`${Math.floor(item.age)}s`, 1530, y, 15, "#a9b6bf");
    });
  }

  private drawHostPanel(g: Phaser.GameObjects.Graphics) {
    this.drawPanel(g, 14, 652, 370, 214, 0x25f4ee);
    g.fillStyle(0x25f4ee, 1);
    g.fillCircle(38, 682, 12);
    g.fillStyle(0x050505, 1);
    g.fillRect(32, 679, 12, 4);
    g.fillRect(36, 673, 4, 16);
    this.addHudText("HOST SETTINGS", 64, 670, 22, "#25f4ee");
    this.addHudText("Appeal threshold:", 30, 718, 18, "#eefbff");
    this.addHudText(String(this.appealGiftThreshold), 252, 718, 20, "#25f4ee");
    this.addHudText("Gift progress", 30, 771, 18, "#eefbff");
    this.addHudText(`${Math.floor(this.giftProgress)} / ${this.appealGiftThreshold}`, 264, 771, 18, "#25f4ee");
    g.fillStyle(0x202124, 1);
    g.fillRoundedRect(105, 812, 248, 22, 5);
    g.fillStyle(0x25f4ee, 1);
    g.fillRoundedRect(105, 812, 248 * (this.giftProgress / this.appealGiftThreshold), 22, 5);
    this.drawGift(g, 37, 790);
    this.addHudText(`Next at ${this.appealGiftThreshold} gifts`, 105, 843, 16, "#a9b6bf");
  }

  private drawPolicyLegend(g: Phaser.GameObjects.Graphics) {
    this.drawPanel(g, 1310, 642, 278, 220, 0x25f4ee);
    this.addHudText("POLICY BALLS", 1328, 663, 23, "#25f4ee");
    POLICIES.forEach((policy, index) => {
      const y = 708 + index * 35;
      g.fillStyle(policy.color, 1);
      g.fillCircle(1340, y, 12);
      this.addHudText(policy.label, 1364, y - 10, 16, "#eefbff");
    });
  }

  private drawScorePlate(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(0x020406, 0.96);
    g.fillRoundedRect(460, 790, 320, 92, 9);
    g.fillRoundedRect(820, 790, 320, 92, 9);
    g.fillStyle(0x05070a, 1);
    g.fillRoundedRect(738, 776, 124, 112, 9);
    g.lineStyle(4, 0xff3b5f, 0.9);
    g.lineBetween(500, 795, 760, 795);
    g.lineStyle(4, 0x25f4ee, 0.9);
    g.lineBetween(840, 795, 1100, 795);
    g.lineStyle(1, 0xeefbff, 0.14);
    g.strokeRoundedRect(460, 790, 680, 92, 8);
    this.addHudText("YOU", 575, 810, 25, "#ff3b5f");
    this.addHudText("VS", 775, 808, 50, "#eefbff");
    this.addHudText("AI TEAM", 932, 810, 25, "#25f4ee");
    this.addHudText("1", 585, 852, 26, "#eefbff");
    this.addHudText(String(this.aiPlayers.filter((ai) => !ai.eliminated).length), 950, 852, 26, "#eefbff");
    this.addHudText("0", 680, 852, 26, "#eefbff");
    this.addHudText(String(this.aiPlayers.filter((ai) => ai.eliminated).length), 1042, 852, 26, "#eefbff");
  }

  private drawAlert(g: Phaser.GameObjects.Graphics) {
    const pulse = 0.62 + Math.sin(this.elapsed / 90) * 0.16;
    const x = 1176;
    const y = 526;
    const w = 374;
    const h = 104;
    g.lineStyle(8, this.alertColor, 0.14 + pulse * 0.1);
    g.strokeRoundedRect(x - 6, y - 6, w + 12, h + 12, 10);
    g.fillStyle(0x030607, 0.97);
    g.fillRoundedRect(x, y, w, h, 7);
    g.lineStyle(3, this.alertColor, 1);
    g.strokeRoundedRect(x, y, w, h, 7);
    g.fillStyle(this.alertColor, 1);
    g.fillRoundedRect(x + 22, y + 22, 58, 58, 6);
    this.addHudText("!", x + 42, y + 29, 46, "#eefbff");
    const [first, ...rest] = (this.alertText ?? "").split(": ");
    this.addHudText(`${first}:`, x + 100, y + 24, 24, `#${this.alertColor.toString(16).padStart(6, "0")}`);
    this.addHudText(rest.join(": ") || "", x + 100, y + 62, 20, "#eefbff");
  }

  private drawHeart(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number) {
    g.fillStyle(color, 1);
    g.fillRect(x + 6, y, 10, 10);
    g.fillRect(x + 22, y, 10, 10);
    g.fillRect(x, y + 8, 38, 14);
    g.fillRect(x + 6, y + 22, 26, 8);
    g.fillRect(x + 14, y + 30, 10, 7);
  }

  private drawControlHint(g: Phaser.GameObjects.Graphics) {
    const x = this.human.x - 42;
    const y = this.human.y + 66;
    const drawKey = (label: string, px: number, py: number, accent = false) => {
      g.fillStyle(accent ? 0xff3b5f : 0xf6f6f6, 1);
      g.fillRoundedRect(px, py, 30, 30, 4);
      g.lineStyle(2, 0x111111, 1);
      g.strokeRoundedRect(px, py, 30, 30, 4);
      this.addHudText(label, px + 9, py + 4, 17, accent ? "#ffffff" : "#111111");
    };
    g.fillStyle(0x050505, 0.62);
    g.fillRoundedRect(x - 12, y - 10, 104, 72, 8);
    drawKey("W", x + 34, y - 2, true);
    drawKey("A", x, y + 32);
    drawKey("S", x + 34, y + 32);
    drawKey("D", x + 68, y + 32);
  }

  private drawPlusBox(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.lineStyle(2, 0x25f4ee, 1);
    g.strokeRoundedRect(x, y, 34, 34, 4);
    g.fillStyle(0x25f4ee, 1);
    g.fillRect(x + 15, y + 8, 4, 18);
    g.fillRect(x + 8, y + 15, 18, 4);
  }

  private drawGift(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0xff3b5f, 1);
    g.fillRect(x, y + 18, 56, 44);
    g.fillStyle(0x25f4ee, 1);
    g.fillRect(x + 23, y + 18, 10, 44);
    g.fillRect(x - 4, y + 12, 64, 12);
    g.lineStyle(4, 0xff3b5f, 1);
    g.strokeCircle(x + 19, y + 9, 11);
    g.strokeCircle(x + 38, y + 9, 11);
  }

  private addHudText(text: string, x: number, y: number, size: number, color: string) {
    const obj = this.add.text(x, y, text, {
      fontFamily: '"Courier New", monospace',
      fontSize: `${size}px`,
      color,
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: Math.max(2, Math.floor(size / 9)),
    });
    obj.setDepth(20);
    this.textLayer?.add(obj);
    return obj;
  }

  private addHudButton(text: string, x: number, y: number, w: number, h: number, accent: number, onClick: () => void, fontSize = 16) {
    const group = this.add.container(x, y);
    const bg = this.add.graphics();
    bg.fillStyle(0x030607, 0.96);
    bg.fillRoundedRect(0, 0, w, h, 5);
    bg.lineStyle(2, accent, 1);
    bg.strokeRoundedRect(0, 0, w, h, 5);
    const label = this.add.text(w / 2, h / 2, text, {
      fontFamily: '"Courier New", monospace',
      fontSize: `${fontSize}px`,
      color: "#eefbff",
      fontStyle: "bold",
    }).setOrigin(0.5);
    group.add([bg, label]);
    group.setSize(w, h);
    group.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    group.on("pointerover", () => group.setScale(1.035));
    group.on("pointerout", () => group.setScale(1));
    group.on("pointerdown", onClick);
    this.textLayer?.add(group);
    return group;
  }

  private snapshot(): GameSnapshot {
    return {
      mode: this.mode,
      sessionId: this.sessionId,
      coordinateSystem: "origin top-left, x increases right, y increases down, canvas 1600x900",
      human: {
        x: round(this.human.x),
        y: round(this.human.y),
        vx: round(this.human.vx),
        vy: round(this.human.vy),
        lives: this.lives,
        appeals: this.appeals,
        action: this.human.action,
        holdingBallId: this.human.heldBallId,
      },
      ai: this.aiPlayers.map((ai) => ({
        id: ai.id,
        name: ai.name,
        x: round(ai.x),
        y: round(ai.y),
        eliminated: ai.eliminated,
        action: ai.action,
        assignedViewer: ai.assignedViewer,
        holdingBallId: ai.heldBallId,
      })),
      balls: this.balls.map((ball) => ({
        id: ball.id,
        policy: ball.policy.id,
        x: round(ball.x),
        y: round(ball.y),
        vx: round(ball.vx),
        vy: round(ball.vy),
        heldBy: ball.heldBy,
        lastThrownBy: ball.lastThrownBy,
      })),
      commandFeed: this.feed,
      settings: {
        difficulty: this.options.difficulty,
        gameSpeed: round(this.gameSpeed()),
        tiktokUsername: this.tiktokUsername,
        streamConnected: this.streamConnected,
      },
      giftProgress: round(this.giftProgress),
      appealGiftThreshold: this.appealGiftThreshold,
      aiming: {
        active: this.throwDrag.active,
        power: round(this.throwDrag.power),
        angleDegrees: this.throwDrag.active
          ? round((Math.atan2(this.throwDrag.startY - this.throwDrag.currentY, this.throwDrag.startX - this.throwDrag.currentX) * 180) / Math.PI)
          : null,
      },
      alert: this.alertText,
      winner: this.winner,
    };
  }
}

new Phaser.Game({
  type: Phaser.CANVAS,
  parent: "game-root",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#000000",
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH,
    height: HEIGHT,
  },
  scene: [BanballScene],
});
