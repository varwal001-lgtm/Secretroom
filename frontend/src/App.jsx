import { useEffect, useMemo, useRef, useState } from "react";
import "emoji-picker-element";

const RAW_API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const API_URL = RAW_API_URL.replace(/\/$/, "");
const RAW_WS_URL = import.meta.env.VITE_WS_URL || "";
const WS_URL = RAW_WS_URL
  ? RAW_WS_URL.replace(/\/$/, "")
  : API_URL.replace(/^https?:/, API_URL.startsWith("https") ? "wss:" : "ws:");

function wsUrl() {
  try {
    return WS_URL;
  } catch {
    return "ws://localhost:3001";
  }
}

export default function App() {
  const [deviceId] = useState(() => {
    const key = "chatpe_device_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(key, next);
    return next;
  });
  const [rollNumber, setRollNumber] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [challengeCode, setChallengeCode] = useState("");
  const [challengeExpiresAt, setChallengeExpiresAt] = useState(0);
  const [challengeRemaining, setChallengeRemaining] = useState(0);
  const [authLoading, setAuthLoading] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const [roomName, setRoomName] = useState("");
  const [canRename, setCanRename] = useState(false);
  const [roster, setRoster] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [adminMapping, setAdminMapping] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [revealNames, setRevealNames] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);

  const wsRef = useRef(null);
  const feedRef = useRef(null);
  const lastAdminFetchRef = useRef(0);
  const recorderRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const emojiButtonRef = useRef(null);

  const chatStatus = useMemo(() => (session ? "chat" : "login"), [session]);

  useEffect(() => {
    if (session) return;
    const storedSessionId = localStorage.getItem("chatpe_session_id");
    if (!storedSessionId) return;
    fetch(`${API_URL}/api/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: storedSessionId, deviceId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Session expired");
        return res.json();
      })
      .then((data) => {
        setSession(data);
        setRoomName(data.roomName || data.department);
      })
      .catch(() => {
        localStorage.removeItem("chatpe_session_id");
      });
  }, [deviceId, session]);

  useEffect(() => {
    if (!challengeExpiresAt) {
      setChallengeRemaining(0);
      return;
    }
    const tick = () => {
      const remainingMs = Math.max(0, challengeExpiresAt - Date.now());
      setChallengeRemaining(Math.ceil(remainingMs / 1000));
      if (remainingMs <= 0) {
        setChallengeCode("");
        setChallengeExpiresAt(0);
      }
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [challengeExpiresAt]);

  useEffect(() => {
    if (chatStatus !== "chat") return;
    const ws = new WebSocket(`${wsUrl()}?sessionId=${session.sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join" }));
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "joined") {
        setRoomName(payload.room.name);
        setCanRename(payload.room.canRename);
        setRoster(payload.roster || []);
        const ordered = [...(payload.messages || [])].sort((a, b) => a.ts - b.ts);
        setMessages(ordered);
        return;
      }
      if (payload.type === "message") {
        setMessages((prev) =>
          [...prev, payload.message].sort((a, b) => a.ts - b.ts)
        );
        return;
      }
      if (payload.type === "room-renamed") {
        setRoomName(payload.name);
        return;
      }
      if (payload.type === "admin-mapping") {
        console.log("Admin mapping received:", payload.mapping);
        setAdminMapping(payload.mapping || []);
        setAdminLoading(false);
        return;
      }
      if (payload.type === "error") {
        setError(payload.message || "Something went wrong");
      }
    };

    return () => {
      ws.close();
    };
  }, [chatStatus, session]);

  useEffect(() => {
    if (!feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!showEmoji) return;
    const picker = emojiPickerRef.current;
    if (!picker) return;
    const handleEmojiClick = (event) => {
      const value = event?.detail?.unicode;
      if (!value) return;
      setDraft((prev) => `${prev}${value}`);
    };
    picker.addEventListener("emoji-click", handleEmojiClick);
    return () => picker.removeEventListener("emoji-click", handleEmojiClick);
  }, [showEmoji]);

  useEffect(() => {
    if (!showEmoji) return;
    const handleClick = (event) => {
      const picker = emojiPickerRef.current;
      const button = emojiButtonRef.current;
      if (!picker || !button) return;
      if (picker.contains(event.target) || button.contains(event.target)) return;
      setShowEmoji(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmoji]);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setConnecting(true);
    try {
      if (!challengeCode || challengeRemaining === 0) {
        throw new Error("Authentication code expired. Generate a new code.");
      }
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollNumber, code: authCode, deviceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Login failed");
      }
      const data = await res.json();
      setSession(data);
      localStorage.setItem("chatpe_session_id", data.sessionId);
      setRoomName(data.roomName || data.department);
      setCanRename(false);
      setRoster([]);
      setMessages([]);
      setAdminMapping([]);
      setRevealNames(false);
      setAdminLoading(false);
      setRollNumber("");
      setAuthCode("");
      setChallengeCode("");
      setChallengeExpiresAt(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  async function handleLogout() {
    if (!session) return;
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
    }
    await fetch(`${API_URL}/api/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId }),
    }).catch(() => null);
    wsRef.current?.close();
    setSession(null);
    localStorage.removeItem("chatpe_session_id");
    setMessages([]);
    setRoster([]);
    setAdminMapping([]);
    setRoomName("");
    setRevealNames(false);
    setAdminLoading(false);
  }

  async function requestAuthCode() {
    if (!rollNumber.trim()) {
      setError("Enter roll number first");
      return;
    }
    setError("");
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollNumber, deviceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate code");
      }
      const data = await res.json();
      setChallengeCode(data.code);
      setChallengeExpiresAt(data.expiresAt);
      setAuthCode("");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function sendMessage(type, content) {
    if (!content || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({
        type: "message",
        messageType: type,
        content,
      })
    );
  }

  function handleSend(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    sendMessage("text", draft.trim());
    setDraft("");
    setShowEmoji(false);
  }

  function handleImageUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result?.toString() || "";
      if (dataUrl.length > 1_000_000) {
        setError("Image too large (max ~1MB)");
        return;
      }
      sendMessage("image", dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    setRecordingError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Voice recording is not supported on this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result?.toString() || "";
          if (dataUrl.length > 2_000_000) {
            setError("Audio too large (max ~2MB)");
          } else {
            sendMessage("audio", dataUrl);
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setRecordingError("Microphone permission denied.");
    }
  }

  function requestAdminReveal() {
    if (!wsRef.current || !session?.isAdmin) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not ready");
      return;
    }
    const nowTs = Date.now();
    if (nowTs - lastAdminFetchRef.current < 2000) return;
    lastAdminFetchRef.current = nowTs;
    setAdminLoading(true);
    wsRef.current.send(JSON.stringify({ type: "admin-reveal" }));
  }

  function renameRoom() {
    const next = prompt("New room name", roomName);
    if (!next) return;
    wsRef.current?.send(JSON.stringify({ type: "rename-room", name: next }));
  }

  function toggleRevealNames() {
    if (!session?.isAdmin) return;
    const next = !revealNames;
    console.log("Toggle reveal names:", next);
    setRevealNames(next);
    if (next) {
      console.log("Requesting admin reveal...");
      setAdminMapping([]);
      requestAdminReveal();
    } else {
      setAdminLoading(false);
    }
  }

  const adminNameMap = useMemo(() => {
    if (!session?.isAdmin || adminMapping.length === 0) return new Map();
    return new Map(adminMapping.map((m) => [m.anonName, m.name]));
  }, [adminMapping, session?.isAdmin]);

  function displayNameFor(message) {
    return message.anonName;
  }

  function realNameFor(message) {
    if (!revealNames) return "";
    return adminNameMap.get(message.anonName) || "";
  }

  if (chatStatus === "login") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-lg bg-panel/90 backdrop-blur border border-white/5 rounded-2xl p-8 card-glow fade-in">
          <h1 className="text-3xl font-semibold text-center">ChatPe</h1>
          <p className="text-textDim mt-2 text-center">
            Please log in to access the Anonymous Chat Room.
          </p>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="text-sm text-textDim">Roll Number</label>
              <input
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                className="mt-2 w-full rounded-xl bg-panelSoft border border-white/5 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent/60"
                placeholder="Enter roll number"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={requestAuthCode}
                disabled={authLoading}
                className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm hover:bg-panelSoft"
              >
                {authLoading ? "Generating..." : "Generate 15-second code"}
              </button>
              {challengeCode && (
                <div className="flex items-center justify-between rounded-xl bg-panelSoft border border-white/10 px-4 py-3">
                  <div className="text-2xl font-mono tracking-[0.3em] flash-digit">
                    {challengeCode}
                  </div>
                  <div className="text-xs text-textDim">
                    {challengeRemaining}s
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm text-textDim">Authentication Code</label>
              <input
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                className="mt-2 w-full rounded-xl bg-panelSoft border border-white/5 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent/60"
                placeholder="Enter code"
                inputMode="numeric"
                maxLength={6}
                disabled={!challengeCode}
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={connecting || !challengeCode || challengeRemaining === 0}
              className="w-full rounded-xl bg-accent text-ink font-semibold py-3 hover:brightness-110 transition"
            >
              {connecting ? "Authenticating..." : "Enter Chat"}
            </button>
            <p className="text-xs text-textDim">
              Login is tied to this device until you log out.
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="w-full md:w-72 bg-panel/85 backdrop-blur border-b md:border-b-0 md:border-r border-white/10 p-5 flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-textDim">Rooms</p>
            <h2 className="text-lg font-semibold mt-1">ChatPe</h2>
          </div>
          <span className="text-xs text-textDim">{session.department}</span>
        </div>
        <button className="mt-5 px-4 py-3 rounded-2xl bg-gradient-to-br from-accent/20 to-accentSoft/20 border border-white/10 text-sm text-left">
          <div className="text-xs text-textDim">Active room</div>
          <div className="text-base font-semibold">{roomName || session.department}</div>
        </button>
        <div className="mt-6">
          <h3 className="text-[11px] uppercase tracking-[0.25em] text-textDim">Roster</h3>
          <div className="mt-4 space-y-2 text-sm text-textDim">
            {roster.length === 0 && <p>No one else yet</p>}
            {roster.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent/70" />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-auto pt-6">
          <button
            onClick={handleLogout}
            className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm hover:bg-panelSoft"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col">
        <header className="border-b border-white/10 flex flex-col gap-3 md:h-20 md:flex-row md:items-center md:justify-between px-4 md:px-8 py-4 md:py-0 bg-panel/70 backdrop-blur">
          <div>
            <h1 className="text-xl font-semibold">{roomName || session.department}</h1>
            <p className="text-xs text-textDim">Messages auto-delete after 1 hour</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {session.isAdmin && (
              <span className="text-xs px-2 py-1 rounded-full bg-accent/20 text-accent">
                Admin
              </span>
            )}
            {canRename && (
              <button
                onClick={renameRoom}
                className="px-3 py-2 rounded-lg bg-panelSoft text-sm hover:bg-panel"
              >
                Rename Room
              </button>
            )}
            {session.isAdmin && (
              <button
                onClick={toggleRevealNames}
                disabled={adminLoading}
                className="px-3 py-2 rounded-lg bg-accent text-ink text-sm font-semibold shadow-glow"
              >
                {adminLoading && revealNames
                  ? "Refreshing..."
                  : revealNames
                  ? "Hide Real Names"
                  : "Reveal Real Names"}
              </button>
            )}
          </div>
        </header>

        <section ref={feedRef} className="flex-1 overflow-y-auto px-5 md:px-8 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="text-textDim text-sm">No messages yet. Say hi.</div>
          )}
          {messages.map((m) => {
            const realName = realNameFor(m);
            if (revealNames && session?.isAdmin && !realName) {
              requestAdminReveal();
            }
            return (
              <div key={m.id} className="flex gap-4">
                <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-accent/20 to-accentSoft/30 border border-white/10 flex items-center justify-center text-xs font-semibold">
                  {displayNameFor(m).slice(0, 2)}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-semibold">{displayNameFor(m)}</span>
                    <span className="text-xs text-textDim">
                      {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="mt-2 rounded-2xl bg-panel/70 border border-white/10 p-3 shadow-[0_10px_30px_rgba(2,6,23,0.4)]">
                    {m.messageType === "image" ? (
                      <img
                        src={m.content}
                        alt="upload"
                        className="rounded-xl max-w-xs border border-white/10"
                      />
                    ) : m.messageType === "audio" ? (
                      <audio controls src={m.content} className="w-64" />
                    ) : (
                      <p className="text-sm text-textDim whitespace-pre-wrap">{m.content}</p>
                    )}
                  </div>
                  {realName && (
                    <p className="text-xs text-accent mt-2">Real: {realName}</p>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <footer className="border-t border-white/10 bg-panel/70 backdrop-blur px-4 md:px-8 py-4">
          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
          {recordingError && <p className="text-red-400 text-sm mb-2">{recordingError}</p>}
          <div className="relative">
            {showEmoji && (
              <div className="absolute bottom-full left-0 mb-3 z-50">
                <emoji-picker ref={emojiPickerRef} emoji-set="google" theme="dark"></emoji-picker>
              </div>
            )}
            <form
              onSubmit={handleSend}
              className="flex flex-col md:flex-row md:items-center gap-3 rounded-2xl bg-panel/80 border border-white/10 p-3"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 min-w-[180px] rounded-xl bg-panelSoft border border-white/5 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/60"
                placeholder="Type your message..."
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  ref={emojiButtonRef}
                  onClick={() => setShowEmoji((prev) => !prev)}
                  className="h-11 w-11 rounded-xl border border-white/10 bg-panelSoft hover:bg-panel flex items-center justify-center"
                  aria-label="Open emoji picker"
                >
                  <span className="text-lg">🙂</span>
                </button>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl border border-white/10 text-sm hover:bg-panelSoft">
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleImageUpload(e.target.files?.[0])}
                  />
                </label>
                <button
                  type="button"
                  onClick={toggleRecording}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border border-white/10 ${
                    recording ? "bg-red-500 text-white" : "bg-panelSoft text-textDim"
                  }`}
                >
                  {recording ? "Stop" : "Voice"}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-accent text-ink text-sm font-semibold"
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        </footer>
      </main>

      {session.isAdmin && (
        <aside className="w-full md:w-80 bg-panel/85 backdrop-blur border-t md:border-t-0 md:border-l border-white/10 p-5">
          <h3 className="text-sm font-semibold">Admin Mapping</h3>
          <p className="text-xs text-textDim">Visible only to admin</p>
          <button
            onClick={requestAdminReveal}
            disabled={adminLoading}
            className="mt-4 w-full px-4 py-3 rounded-xl bg-accent text-ink text-sm font-semibold"
          >
            {adminLoading ? "Refreshing..." : "Refresh Admin Mapping"}
          </button>
          <div className="mt-4 space-y-3 text-sm">
            {adminMapping.length === 0 && (
              <div className="text-xs text-textDim">
                Click the refresh button to load identities.
              </div>
            )}
            {adminMapping.map((m) => (
              <div key={m.registrationNo} className="rounded-xl bg-panelSoft/80 border border-white/5 p-3">
                <div className="text-textDim">{m.anonName}</div>
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-textDim font-mono">{m.registrationNo}</div>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

