import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

type Session = {
  sessionId: string;
  hostToken: string;
  tiktokUsername: string;
  appealGiftThreshold: number;
  currentGiftProgress: number;
  assignedViewers: Record<string, string>;
  connectedClients: number;
  tiktokConnectionStatus: ConnectionStatus;
  createdAt: number;
  lastActiveAt: number;
};

const sessions = new Map<string, Session>();
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

function token(length = 16) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function publicSession(session: Session) {
  return {
    sessionId: session.sessionId,
    tiktokUsername: session.tiktokUsername,
    appealGiftThreshold: session.appealGiftThreshold,
    currentGiftProgress: session.currentGiftProgress,
    tiktokConnectionStatus: session.tiktokConnectionStatus,
  };
}

app.post("/api/sessions", (_req, res) => {
  const sessionId = token(4);
  const hostToken = token(12);
  const session: Session = {
    sessionId,
    hostToken,
    tiktokUsername: "streamer",
    appealGiftThreshold: 100,
    currentGiftProgress: 0,
    assignedViewers: {},
    connectedClients: 0,
    tiktokConnectionStatus: "disconnected",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  sessions.set(sessionId, session);
  res.json({
    ...publicSession(session),
    hostToken,
    gameUrl: `/game/${sessionId}`,
    hostUrl: `/host/${sessionId}?token=${hostToken}`,
  });
});

app.get("/api/sessions/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  res.json(publicSession(session));
});

app.patch("/api/sessions/:sessionId/config", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  if (req.body.hostToken !== session.hostToken) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (typeof req.body.tiktokUsername === "string") {
    session.tiktokUsername = req.body.tiktokUsername.replace(/^@/, "").slice(0, 24) || "streamer";
  }
  if (Number.isFinite(req.body.appealGiftThreshold)) {
    session.appealGiftThreshold = Math.max(10, Math.min(10000, Math.round(req.body.appealGiftThreshold)));
  }
  session.lastActiveAt = Date.now();
  io.to(`session:${session.sessionId}`).emit("session:configUpdated", publicSession(session));
  res.json(publicSession(session));
});

io.on("connection", (socket) => {
  socket.on("session:join", ({ sessionId, role }: { sessionId: string; role: "game" | "host" }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    socket.join(`session:${sessionId}`);
    session.connectedClients += 1;
    session.lastActiveAt = Date.now();
    socket.emit("session:configUpdated", publicSession(session));
    socket.data.sessionId = sessionId;
    socket.data.role = role;
  });

  socket.on("mock:chatCommand", (payload: { sessionId: string; username: string; command: string }) => {
    const session = sessions.get(payload.sessionId);
    if (!session) return;
    session.lastActiveAt = Date.now();
    io.to(`session:${payload.sessionId}`).emit("tiktok:chatCommand", {
      type: "tiktok:chatCommand",
      sessionId: payload.sessionId,
      username: payload.username,
      command: payload.command.replace(/^!/, ""),
    });
  });

  socket.on("mock:gift", (payload: { sessionId: string; username: string; giftName?: string; diamondValue: number; repeatCount: number }) => {
    const session = sessions.get(payload.sessionId);
    if (!session) return;
    session.lastActiveAt = Date.now();
    io.to(`session:${payload.sessionId}`).emit("tiktok:gift", {
      type: "tiktok:gift",
      sessionId: payload.sessionId,
      username: payload.username,
      giftName: payload.giftName ?? "Rose",
      diamondValue: Math.max(1, Math.round(payload.diamondValue || 1)),
      repeatCount: Math.max(1, Math.round(payload.repeatCount || 1)),
    });
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (session) {
      session.connectedClients = Math.max(0, session.connectedClients - 1);
      session.lastActiveAt = Date.now();
    }
  });
});

setInterval(() => {
  const expiry = Date.now() - 30 * 60 * 1000;
  for (const [sessionId, session] of sessions) {
    if (session.connectedClients === 0 && session.lastActiveAt < expiry) {
      sessions.delete(sessionId);
    }
  }
}, 60_000).unref();

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Banball realtime server listening on http://127.0.0.1:${port}`);
});
