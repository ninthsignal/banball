import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { WebcastPushConnection } from "tiktok-live-connector";

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
const liveConnections = new Map<string, { username: string; connection: WebcastPushConnection }>();
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

function createSession(sessionId = token(4)) {
  const session: Session = {
    sessionId,
    hostToken: token(12),
    tiktokUsername: "",
    appealGiftThreshold: 100,
    currentGiftProgress: 0,
    assignedViewers: {},
    connectedClients: 0,
    tiktokConnectionStatus: "disconnected",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

function getOrCreateSession(sessionId: string) {
  return sessions.get(sessionId) ?? createSession(sessionId);
}

function cleanUsername(username: string) {
  return username.replace(/^@+/, "").replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 24);
}

function emitSessionStatus(session: Session) {
  io.to(`session:${session.sessionId}`).emit("session:configUpdated", publicSession(session));
  io.to(`session:${session.sessionId}`).emit("tiktok:status", {
    type: "tiktok:status",
    sessionId: session.sessionId,
    username: session.tiktokUsername,
    status: session.tiktokConnectionStatus,
  });
}

function disconnectTikTok(sessionId: string) {
  const active = liveConnections.get(sessionId);
  if (!active) return;
  try {
    active.connection.disconnect();
  } catch {
    // Connector cleanup can throw if the socket is already gone.
  }
  liveConnections.delete(sessionId);
}

async function connectTikTok(session: Session, username: string) {
  const tiktokUsername = cleanUsername(username);
  if (!tiktokUsername) {
    session.tiktokConnectionStatus = "error";
    emitSessionStatus(session);
    return;
  }

  // Ignore duplicate connect requests for the same stream while it is already
  // connecting or connected; otherwise a second WebcastPushConnection is built
  // and its chat/gift listeners fire alongside the first, duplicating events.
  const active = liveConnections.get(session.sessionId);
  if (
    active?.username === tiktokUsername &&
    (session.tiktokConnectionStatus === "connected" || session.tiktokConnectionStatus === "connecting")
  ) {
    emitSessionStatus(session);
    return;
  }

  disconnectTikTok(session.sessionId);
  session.tiktokUsername = tiktokUsername;
  session.tiktokConnectionStatus = "connecting";
  session.lastActiveAt = Date.now();
  emitSessionStatus(session);

  const connection = new WebcastPushConnection(tiktokUsername, {
    processInitialData: false,
    enableExtendedGiftInfo: false,
  });
  liveConnections.set(session.sessionId, { username: tiktokUsername, connection });

  connection.on("chat", (data) => {
    session.lastActiveAt = Date.now();
    const username = String(data.uniqueId ?? data.nickname ?? "viewer");
    const comment = String(data.comment ?? "").trim();
    if (!comment) return;
    io.to(`session:${session.sessionId}`).emit("tiktok:chat", {
      type: "tiktok:chat",
      sessionId: session.sessionId,
      username,
      comment,
    });
  });

  connection.on("gift", (data) => {
    session.lastActiveAt = Date.now();
    const diamondValue = Math.max(1, Math.round(Number(data.diamondCount ?? 1)));
    const repeatCount = Math.max(1, Math.round(Number(data.repeatCount ?? 1)));
    io.to(`session:${session.sessionId}`).emit("tiktok:gift", {
      type: "tiktok:gift",
      sessionId: session.sessionId,
      username: String(data.uniqueId ?? data.nickname ?? "viewer"),
      giftName: String(data.giftName ?? "Gift"),
      diamondValue,
      repeatCount,
    });
  });

  connection.on("member", (data) => {
    session.lastActiveAt = Date.now();
    io.to(`session:${session.sessionId}`).emit("tiktok:member", {
      type: "tiktok:member",
      sessionId: session.sessionId,
      username: String(data.uniqueId ?? data.nickname ?? "viewer"),
    });
  });

  connection.on("streamEnd", () => {
    session.tiktokConnectionStatus = "disconnected";
    disconnectTikTok(session.sessionId);
    emitSessionStatus(session);
  });

  connection.on("error", () => {
    session.tiktokConnectionStatus = "error";
    emitSessionStatus(session);
  });

  try {
    await connection.connect();
    // If a newer connection superseded this one while connecting, drop this one.
    if (liveConnections.get(session.sessionId)?.connection !== connection) {
      try {
        connection.disconnect();
      } catch {
        // Connector cleanup can throw if the socket is already gone.
      }
      return;
    }
    session.tiktokConnectionStatus = "connected";
    session.lastActiveAt = Date.now();
    emitSessionStatus(session);
  } catch {
    disconnectTikTok(session.sessionId);
    session.tiktokConnectionStatus = "error";
    emitSessionStatus(session);
  }
}

app.post("/api/sessions", (_req, res) => {
  const session = createSession();
  res.json({
    ...publicSession(session),
    hostToken: session.hostToken,
    gameUrl: `/game/${session.sessionId}`,
    hostUrl: `/host/${session.sessionId}?token=${session.hostToken}`,
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
    session.tiktokUsername = cleanUsername(req.body.tiktokUsername);
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
    const session = getOrCreateSession(sessionId);
    socket.join(`session:${sessionId}`);
    session.connectedClients += 1;
    session.lastActiveAt = Date.now();
    socket.emit("session:configUpdated", publicSession(session));
    socket.data.sessionId = sessionId;
    socket.data.role = role;
  });

  socket.on("tiktok:connect", ({ sessionId, username }: { sessionId: string; username: string }) => {
    const session = getOrCreateSession(sessionId);
    void connectTikTok(session, username);
  });

  socket.on("tiktok:disconnect", ({ sessionId }: { sessionId: string }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    disconnectTikTok(sessionId);
    session.tiktokConnectionStatus = "disconnected";
    emitSessionStatus(session);
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
