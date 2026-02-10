const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { STUDENTS, DEFAULT_DEPARTMENT } = require("./data/students");

const PORT = process.env.PORT || 3001;
const ADMIN_ROLL_NUMBER = "250252780057";
const MAX_IMAGE_BYTES = 1_000_000; // ~1MB base64 payload size limit
const MAX_AUDIO_BYTES = 2_000_000; // ~2MB base64 payload size limit
const AUTH_WINDOW_MS = 15_000;
const MESSAGE_TTL_MS = 60 * 60 * 1000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const studentsByReg = new Map(
  STUDENTS.map((s) => [s.registrationNo, s])
);

const sessions = new Map(); // sessionId -> { registrationNo, name, department, anonName, isAdmin, deviceId }
const wsToSession = new Map(); // ws -> sessionId
const roomClients = new Map(); // department -> Set(ws)
const rooms = new Map(); // department -> { name, ownerSessionId, ownerRegistrationNo, messages: [] }
const authChallenges = new Map(); // registrationNo -> { code, expiresAt } (5-second window)
const activeSessions = new Map(); // registrationNo -> { sessionId, deviceId, lastSeen, activeWs }

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

function getOrCreateRoom(department) {
  if (!rooms.has(department)) {
    const persisted = storeCache.rooms[department];
    rooms.set(department, {
      name: persisted?.name || department || DEFAULT_DEPARTMENT,
      ownerSessionId: null,
      ownerRegistrationNo: persisted?.ownerRegistrationNo || null,
      messages: persisted?.messages || [],
      anonRegistry: persisted?.anonRegistry || {},
    });
  }
  return rooms.get(department);
}

function generateAnonName(department) {
  const room = getOrCreateRoom(department);
  const reserved = new Set(Object.keys(room.anonRegistry || {}));
  const label = Math.random() > 0.5 ? "User" : "Ghost";
  let name;
  do {
    name = `${label}-${Math.floor(10 + Math.random() * 90)}`;
  } while (
    [...sessions.values()].some((s) => s.anonName === name) ||
    reserved.has(name)
  );
  return name;
}

function now() {
  return Date.now();
}

function generateAuthCode() {
  const value = crypto.randomInt(0, 1_000_000);
  return String(value).padStart(6, "0");
}

function pruneMessages(room) {
  const cutoff = now() - MESSAGE_TTL_MS;
  if (!room.messages.length) return;
  room.messages = room.messages.filter((m) => m.ts >= cutoff);
}

function canUseRollNumber(registrationNo, deviceId) {
  const active = activeSessions.get(registrationNo);
  if (!active) return { ok: true };
  if (active.deviceId === deviceId) return { ok: true };
  if (active.activeWs > 0) {
    return { ok: false, error: "Account already logged in on another device" };
  }
  return { ok: false, error: "Account already logged in on another device" };
}

function persistRoom(department, room) {
  storeCache.rooms[department] = {
    name: room.name,
    ownerRegistrationNo: room.ownerRegistrationNo,
    messages: room.messages,
    anonRegistry: room.anonRegistry || {},
  };
  markStoreDirty();
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(department, payload) {
  const clients = roomClients.get(department);
  if (!clients) return;
  for (const ws of clients) {
    send(ws, payload);
  }
}

function getRoster(department) {
  const roster = [];
  for (const session of sessions.values()) {
    if (session.department === department) {
      roster.push(session.anonName);
    }
  }
  return roster.sort();
}

app.post("/api/login", (req, res) => {
  const { rollNumber, code, deviceId } = req.body || {};
  const normalizedRoll = String(rollNumber || "").trim();
  const student = studentsByReg.get(normalizedRoll);

  if (!student) {
    return res.status(401).json({ error: "Invalid roll number or code" });
  }

  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "Missing device ID" });
  }

  const challenge = authChallenges.get(student.registrationNo);
  if (!challenge || challenge.expiresAt < now()) {
    return res.status(401).json({ error: "Authentication code expired" });
  }
  if (String(code || "").trim() !== challenge.code) {
    return res.status(401).json({ error: "Invalid roll number or code" });
  }

  const lockCheck = canUseRollNumber(student.registrationNo, deviceId);
  if (!lockCheck.ok) {
    return res.status(403).json({ error: lockCheck.error });
  }

  const sessionId = crypto.randomUUID();
  let isAdmin = false;
  if (student.registrationNo === ADMIN_ROLL_NUMBER) {
    isAdmin = true;
  }

  const anonName = generateAnonName(student.department || DEFAULT_DEPARTMENT);

  const session = {
    registrationNo: student.registrationNo,
    name: student.name,
    department: student.department || DEFAULT_DEPARTMENT,
    anonName,
    isAdmin: Boolean(isAdmin),
    deviceId,
  };

  sessions.set(sessionId, session);
  authChallenges.delete(student.registrationNo);
  const existingActive = activeSessions.get(student.registrationNo);
  if (existingActive && existingActive.sessionId !== sessionId) {
    for (const [ws, sid] of wsToSession.entries()) {
      if (sid === existingActive.sessionId) {
        ws.close(1000, "Logged out");
        wsToSession.delete(ws);
      }
    }
  }
  activeSessions.set(student.registrationNo, {
    sessionId,
    deviceId,
    lastSeen: now(),
    activeWs: 0,
  });
  const room = getOrCreateRoom(session.department);
  room.anonRegistry[anonName] = {
    registrationNo: session.registrationNo,
    name: session.name,
  };
  persistRoom(session.department, room);

  return res.json({
    sessionId,
    anonName,
    department: session.department,
    roomName: rooms.get(session.department).name,
    isAdmin: session.isAdmin,
  });
});

app.post("/api/logout", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session) {
      const active = activeSessions.get(session.registrationNo);
      if (active && active.sessionId === sessionId) {
        activeSessions.delete(session.registrationNo);
      }
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

app.post("/api/auth/challenge", (req, res) => {
  const { rollNumber, deviceId } = req.body || {};
  const normalizedRoll = String(rollNumber || "").trim();
  const student = studentsByReg.get(normalizedRoll);

  if (!student) {
    return res.status(401).json({ error: "Invalid roll number" });
  }
  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "Missing device ID" });
  }

  const lockCheck = canUseRollNumber(student.registrationNo, deviceId);
  if (!lockCheck.ok) {
    return res.status(403).json({ error: lockCheck.error });
  }

  const code = generateAuthCode();
  const expiresAt = now() + AUTH_WINDOW_MS;
  authChallenges.set(student.registrationNo, { code, expiresAt });

  return res.json({ code, expiresAt });
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

  const active = activeSessions.get(session.registrationNo);
  if (active) {
    active.lastSeen = now();
  }

  return res.json({
    sessionId,
    anonName: session.anonName,
    department: session.department,
    roomName: rooms.get(session.department).name,
    isAdmin: session.isAdmin,
  });
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

    const active = activeSessions.get(session.registrationNo);
    if (active) {
      active.lastSeen = now();
    }

    const department = session.department;
    const room = getOrCreateRoom(department);

    if (msg.type === "join") {
      if (!roomClients.has(department)) {
        roomClients.set(department, new Set());
      }
      roomClients.get(department).add(ws);

      const active = activeSessions.get(session.registrationNo);
      if (active) {
        active.activeWs += 1;
        active.lastSeen = now();
      }

      if (!room.ownerSessionId) {
        room.ownerSessionId = sessionId;
        if (!room.ownerRegistrationNo) {
          room.ownerRegistrationNo = session.registrationNo;
          persistRoom(department, room);
        }
      }

      pruneMessages(room);

      const publicMessages = room.messages.map((m) => ({
        id: m.id,
        ts: m.ts,
        anonName: m.anonName,
        messageType: m.messageType,
        content: m.content,
      }));

      send(ws, {
        type: "joined",
        room: {
          name: room.name,
          canRename:
            room.ownerSessionId === sessionId ||
            room.ownerRegistrationNo === session.registrationNo,
        },
        roster: getRoster(department),
        messages: publicMessages,
        you: {
          anonName: session.anonName,
          department: session.department,
          isAdmin: session.isAdmin,
        },
      });
      return;
    }

    if (msg.type === "message") {
      const { messageType, content } = msg;
      if (!content || typeof content !== "string") return;

      if (messageType === "image" && Buffer.byteLength(content, "utf8") > MAX_IMAGE_BYTES) {
        send(ws, { type: "error", message: "Image too large (max ~1MB)" });
        return;
      }
      if (messageType === "audio" && Buffer.byteLength(content, "utf8") > MAX_AUDIO_BYTES) {
        send(ws, { type: "error", message: "Audio too large (max ~2MB)" });
        return;
      }

      const normalizedType =
        messageType === "image" ? "image" : messageType === "audio" ? "audio" : "text";

      const entry = {
        id: crypto.randomUUID(),
        ts: now(),
        anonName: session.anonName,
        senderRegistrationNo: session.registrationNo,
        senderName: session.name,
        messageType: normalizedType,
        content,
      };

      room.messages.push(entry);
      pruneMessages(room);
      persistRoom(department, room);

      const publicMessage = {
        id: entry.id,
        ts: entry.ts,
        anonName: entry.anonName,
        messageType: entry.messageType,
        content: entry.content,
      };

      broadcastToRoom(department, { type: "message", message: publicMessage });
      return;
    }

    if (msg.type === "rename-room") {
      const { name } = msg;
      if (!name || typeof name !== "string") return;
      if (
        room.ownerSessionId !== sessionId &&
        room.ownerRegistrationNo !== session.registrationNo
      ) {
        return;
      }

      room.name = name.slice(0, 40);
      persistRoom(department, room);
      broadcastToRoom(department, {
        type: "room-renamed",
        name: room.name,
        by: session.anonName,
      });
      return;
    }

    if (msg.type === "admin-reveal") {
      console.log("Admin reveal requested by", session.anonName, "in department", department);
      if (!session.isAdmin) {
        console.log("User is not admin");
        return;
      }

      const roomRegistry = room.anonRegistry || {};
      const mappingByAnon = new Map(
        Object.entries(roomRegistry).map(([anonName, info]) => [
          anonName,
          { anonName, registrationNo: info.registrationNo, name: info.name },
        ])
      );

      for (const m of room.messages || []) {
        if (!m.anonName || mappingByAnon.has(m.anonName)) continue;
        if (m.senderRegistrationNo && m.senderName) {
          mappingByAnon.set(m.anonName, {
            anonName: m.anonName,
            registrationNo: m.senderRegistrationNo,
            name: m.senderName,
          });
        }
      }

      const mapping = Array.from(mappingByAnon.values());

      console.log("Sending mapping with", mapping.length, "users");
      send(ws, { type: "admin-mapping", mapping });
      return;
    }
  });

  ws.on("close", () => {
    const session = sessions.get(sessionId);
    if (session) {
      const department = session.department;
      const set = roomClients.get(department);
      if (set) set.delete(ws);
      const active = activeSessions.get(session.registrationNo);
      if (active) {
        active.activeWs = Math.max(0, active.activeWs - 1);
        active.lastSeen = now();
      }
    }
    wsToSession.delete(ws);
  });
});

setInterval(() => {
  const cutoff = now();
  for (const [reg, challenge] of authChallenges.entries()) {
    if (challenge.expiresAt < cutoff) {
      authChallenges.delete(reg);
    }
  }
  for (const room of rooms.values()) {
    pruneMessages(room);
  }
  flushStore();
}, 60 * 1000);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, rooms: rooms.size, sessions: sessions.size });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ChatPe server listening on http://localhost:${PORT}`);
});
