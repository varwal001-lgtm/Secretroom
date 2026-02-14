const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3001;
const ACCESS_KEY = process.env.ACCESS_KEY || "gjuaids";
const DEFAULT_ROOM = "Secret Room";
const MESSAGE_TTL_MS = 30 * 60 * 1000;
const MAX_TEXT_BYTES = 2_000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const sessions = new Map(); // sessionId -> { anonName, roomName, deviceId }
const wsToSession = new Map(); // ws -> sessionId
const roomClients = new Map(); // roomName -> Set(ws)
const activeSessionByDevice = new Map(); // deviceId -> sessionId

const STORE_PATH = path.join(__dirname, "data", "store.json");
let storeCache = { rooms: {} };
let storeDirty = false;

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    storeCache = JSON.parse(raw);
  } catch {
    storeCache = { rooms: {} };
  }
}

function markStoreDirty() {
  storeDirty = true;
}

function flushStore() {
  if (!storeDirty) return;
  storeDirty = false;
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(storeCache, null, 2), "utf8");
  } catch {
    storeDirty = true;
  }
}

loadStore();

function now() {
  return Date.now();
}

function getOrCreateRoom(roomName) {
  if (!storeCache.rooms[roomName]) {
    storeCache.rooms[roomName] = {
      name: roomName,
      messages: [],
      pinnedMessageId: null,
      typing: {},
    };
    markStoreDirty();
  }
  const room = storeCache.rooms[roomName];
  if (!room.typing || typeof room.typing !== "object") {
    room.typing = {};
  }
  return room;
}

function generateAnonName(roomName) {
  const room = getOrCreateRoom(roomName);
  const used = new Set(
    (room.messages || []).map((message) => message.anonName).filter(Boolean)
  );
  for (const session of sessions.values()) {
    if (session.roomName === roomName) {
      used.add(session.anonName);
    }
  }

  let name;
  do {
    name = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (used.has(name));
  return name;
}

function pruneMessages(room) {
  const cutoff = now() - MESSAGE_TTL_MS;
  const before = room.messages.length;
  room.messages = room.messages.filter((message) => message.ts >= cutoff);
  if (before !== room.messages.length) {
    if (room.pinnedMessageId && !room.messages.some((m) => m.id === room.pinnedMessageId)) {
      room.pinnedMessageId = null;
    }
    markStoreDirty();
  }
}

function persistRoom() {
  markStoreDirty();
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(roomName, payload) {
  const clients = roomClients.get(roomName);
  if (!clients) return;
  for (const ws of clients) {
    send(ws, payload);
  }
}

function toPublicMessage(entry) {
  return {
    id: entry.id,
    ts: entry.ts,
    anonName: entry.anonName,
    messageType: "text",
    content: entry.content,
    replyTo: entry.replyTo || null,
    reactions: entry.reactions || {},
  };
}

function buildSessionPayload(sessionId, session) {
  return {
    sessionId,
    anonName: session.anonName,
    roomName: session.roomName,
  };
}

app.post("/api/enter", (req, res) => {
  const { accessKey, deviceId } = req.body || {};

  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "Missing device ID" });
  }

  if (String(accessKey || "").trim() !== ACCESS_KEY) {
    return res.status(401).json({ error: "Invalid private key" });
  }

  const room = getOrCreateRoom(DEFAULT_ROOM);
  pruneMessages(room);

  const existingSessionId = activeSessionByDevice.get(deviceId);
  if (existingSessionId && sessions.has(existingSessionId)) {
    const existingSession = sessions.get(existingSessionId);
    return res.json(buildSessionPayload(existingSessionId, existingSession));
  }

  const sessionId = crypto.randomUUID();
  const session = {
    anonName: generateAnonName(DEFAULT_ROOM),
    roomName: DEFAULT_ROOM,
    deviceId,
  };

  sessions.set(sessionId, session);
  activeSessionByDevice.set(deviceId, sessionId);

  return res.json(buildSessionPayload(sessionId, session));
});

app.post("/api/resume", (req, res) => {
  const { sessionId, deviceId } = req.body || {};
  if (!sessionId || !deviceId) {
    return res.status(400).json({ error: "Missing session" });
  }

  const session = sessions.get(sessionId);
  if (!session || session.deviceId !== deviceId) {
    return res.status(401).json({ error: "Session expired" });
  }

  return res.json(buildSessionPayload(sessionId, session));
});

app.post("/api/logout", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session && activeSessionByDevice.get(session.deviceId) === sessionId) {
      activeSessionByDevice.delete(session.deviceId);
    }
    for (const [ws, sid] of wsToSession.entries()) {
      if (sid === sessionId) {
        ws.close(1000, "Logged out");
        wsToSession.delete(ws);
      }
    }
  }
  return res.json({ ok: true });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId || !sessions.has(sessionId)) {
    ws.close(1008, "Invalid session");
    return;
  }

  wsToSession.set(ws, sessionId);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) return;

    const roomName = session.roomName;
    const room = getOrCreateRoom(roomName);

    if (msg.type === "join") {
      if (!roomClients.has(roomName)) {
        roomClients.set(roomName, new Set());
      }
      roomClients.get(roomName).add(ws);

      pruneMessages(room);

      send(ws, {
        type: "joined",
        room: { name: room.name || roomName, canRename: false },
        messages: (room.messages || []).map(toPublicMessage),
        pinnedMessageId: room.pinnedMessageId || null,
        you: { anonName: session.anonName },
      });
      return;
    }

    if (msg.type === "message") {
      const { content, replyTo } = msg;
      if (!content || typeof content !== "string") return;
      if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) {
        send(ws, { type: "error", message: "Message too long" });
        return;
      }

      let normalizedReplyTo = null;
      if (replyTo && typeof replyTo.id === "string") {
        const source = room.messages.find((m) => m.id === replyTo.id);
        if (source) {
          normalizedReplyTo = {
            id: source.id,
            anonName: source.anonName,
            contentPreview: String(source.content || "").slice(0, 120),
          };
        }
      }

      const entry = {
        id: crypto.randomUUID(),
        ts: now(),
        anonName: session.anonName,
        messageType: "text",
        content: content.slice(0, 1200),
        replyTo: normalizedReplyTo,
        reactions: {},
      };

      room.messages.push(entry);
      pruneMessages(room);
      persistRoom();

      broadcastToRoom(roomName, { type: "message", message: toPublicMessage(entry) });
      room.typing[session.anonName] = false;
      broadcastToRoom(roomName, { type: "typing", anonName: session.anonName, isTyping: false });
      return;
    }

    if (msg.type === "typing") {
      const isTyping = Boolean(msg.isTyping);
      const previous = Boolean(room.typing[session.anonName]);
      if (previous === isTyping) return;
      room.typing[session.anonName] = isTyping;
      broadcastToRoom(roomName, { type: "typing", anonName: session.anonName, isTyping });
      return;
    }

    if (msg.type === "pin-message") {
      const { messageId } = msg;
      if (!messageId || typeof messageId !== "string") return;
      const exists = room.messages.some((m) => m.id === messageId);
      if (!exists) return;
      room.pinnedMessageId = room.pinnedMessageId === messageId ? null : messageId;
      persistRoom();
      broadcastToRoom(roomName, {
        type: "message-pinned",
        messageId: room.pinnedMessageId,
        pinnedBy: session.anonName,
      });
      return;
    }

    if (msg.type === "react-message") {
      const { messageId, emoji } = msg;
      if (!messageId || typeof messageId !== "string") return;
      if (!emoji || typeof emoji !== "string") return;
      const target = room.messages.find((m) => m.id === messageId);
      if (!target) return;
      if (!target.reactions || typeof target.reactions !== "object") {
        target.reactions = {};
      }
      const users = Array.isArray(target.reactions[emoji]) ? target.reactions[emoji] : [];
      const hasUser = users.includes(session.anonName);
      target.reactions[emoji] = hasUser
        ? users.filter((name) => name !== session.anonName)
        : [...users, session.anonName];
      if (target.reactions[emoji].length === 0) {
        delete target.reactions[emoji];
      }
      persistRoom();
      broadcastToRoom(roomName, {
        type: "message-reaction",
        messageId,
        reactions: target.reactions,
      });
    }
  });

  ws.on("close", () => {
    const session = sessions.get(sessionId);
    if (session) {
      const set = roomClients.get(session.roomName);
      if (set) set.delete(ws);
      const room = getOrCreateRoom(session.roomName);
      room.typing[session.anonName] = false;
      broadcastToRoom(session.roomName, { type: "typing", anonName: session.anonName, isTyping: false });
    }
    wsToSession.delete(ws);
  });
});

setInterval(() => {
  for (const room of Object.values(storeCache.rooms)) {
    pruneMessages(room);
  }
  flushStore();
}, 60 * 1000);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, rooms: Object.keys(storeCache.rooms).length, sessions: sessions.size });
});

server.listen(PORT, () => {
  console.log(`ChatPe server listening on http://localhost:${PORT}`);
});
