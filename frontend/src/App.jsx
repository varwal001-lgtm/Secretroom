import { useEffect, useMemo, useRef, useState } from "react";
import { RoomEntryGate } from "./components/RoomEntryGate";
import { ChatShell } from "./components/ChatShell";
import { useInstallPrompt } from "./hooks/useInstallPrompt";

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

function normalizeMessage(message) {
  return {
    ...message,
    messageType: "text",
    reactions: message.reactions || {},
    replyTo: message.replyTo || null,
  };
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

  const [accessKey, setAccessKey] = useState("");
  const [entering, setEntering] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  const [roomName, setRoomName] = useState("");
  const [messages, setMessages] = useState([]);
  const [pinnedMessageId, setPinnedMessageId] = useState(null);

  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const [typingByUser, setTypingByUser] = useState({});
  const [recentIds, setRecentIds] = useState([]);

  const wsRef = useRef(null);
  const feedRef = useRef(null);
  const typingStateRef = useRef({ sent: false, timer: null });

  const { showInstallOption, promptInstall } = useInstallPrompt();

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
        setRoomName(data.roomName || "Secret Room");
      })
      .catch(() => {
        localStorage.removeItem("chatpe_session_id");
      });
  }, [deviceId, session]);

  async function showMessageNotification(message) {
    if (!session) return;
    if (!document.hidden) return;
    if (message.anonName === session.anonName) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const body = `${message.anonName}: ${String(message.content || "").slice(0, 120)}`;
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      registration.showNotification("Secret Room", {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: `msg-${message.id}`,
      });
      return;
    }

    // Fallback if SW is unavailable.
    new Notification("Secret Room", { body });
  }

  useEffect(() => {
    if (!session) return;

    const ws = new WebSocket(`${wsUrl()}?sessionId=${session.sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join" }));
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      if (payload.type === "joined") {
        setRoomName(payload.room?.name || "Secret Room");
        setMessages((payload.messages || []).map(normalizeMessage));
        setPinnedMessageId(payload.pinnedMessageId || null);
        setTypingByUser({});
        return;
      }

      if (payload.type === "message") {
        const next = normalizeMessage(payload.message);
        setMessages((prev) => [...prev, next].sort((a, b) => a.ts - b.ts));
        setRecentIds((prev) => [...prev.slice(-20), next.id]);
        window.setTimeout(() => {
          setRecentIds((prev) => prev.filter((id) => id !== next.id));
        }, 500);
        showMessageNotification(next).catch(() => null);
        return;
      }

      if (payload.type === "message-pinned") {
        setPinnedMessageId(payload.messageId || null);
        return;
      }

      if (payload.type === "message-reaction") {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === payload.messageId ? { ...message, reactions: payload.reactions || {} } : message
          )
        );
        return;
      }

      if (payload.type === "typing") {
        setTypingByUser((prev) => ({ ...prev, [payload.anonName]: Boolean(payload.isTyping) }));
        return;
      }

      if (payload.type === "error") {
        setError(payload.message || "Something went wrong");
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [session]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (distanceFromBottom < 140) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (typingStateRef.current.timer) {
        clearTimeout(typingStateRef.current.timer);
      }
    };
  }, []);

  function emitTyping(isTyping) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "typing", isTyping }));
  }

  function handleTyping(typing) {
    const state = typingStateRef.current;

    if (typing && !state.sent) {
      state.sent = true;
      emitTyping(true);
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (!typing) {
      if (state.sent) {
        emitTyping(false);
        state.sent = false;
      }
      return;
    }

    state.timer = window.setTimeout(() => {
      emitTyping(false);
      state.sent = false;
      state.timer = null;
    }, 1000);
  }

  async function handleEnter(event) {
    event.preventDefault();
    setError("");
    setEntering(true);
    try {
      const res = await fetch(`${API_URL}/api/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey, deviceId }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Backend is not updated yet. Please deploy latest Render backend.");
        }
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not enter room");
      }
      const data = await res.json();
      await new Promise((resolve) => window.setTimeout(resolve, 760));
      localStorage.setItem("chatpe_session_id", data.sessionId);
      setSession(data);
      setRoomName(data.roomName || "Secret Room");
      setAccessKey("");

      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setEntering(false);
    }
  }

  async function handleLogout() {
    if (!session) return;
    await fetch(`${API_URL}/api/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId }),
    }).catch(() => null);

    wsRef.current?.close();
    localStorage.removeItem("chatpe_session_id");

    setSession(null);
    setMessages([]);
    setPinnedMessageId(null);
    setReplyTarget(null);
    setTypingByUser({});
    setError("");
  }

  function sendMessage() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const content = draft.trim();
    if (!content) return;

    wsRef.current.send(
      JSON.stringify({
        type: "message",
        content,
        replyTo: replyTarget ? { id: replyTarget.id } : null,
      })
    );

    setDraft("");
    setReplyTarget(null);
    setShowEmoji(false);
    handleTyping(false);
  }

  function handlePin(messageId) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "pin-message", messageId }));
  }

  function handleReact(messageId, emoji) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "react-message", messageId, emoji }));
  }

  const pinnedMessage = useMemo(
    () => messages.find((message) => message.id === pinnedMessageId) || null,
    [messages, pinnedMessageId]
  );

  const someoneTyping = useMemo(() => {
    if (!session) return false;
    return Object.entries(typingByUser).some(([name, typing]) => typing && name !== session.anonName);
  }, [typingByUser, session]);

  if (!session) {
    return (
      <RoomEntryGate
        accessKey={accessKey}
        onAccessKeyChange={setAccessKey}
        onEnter={handleEnter}
        entering={entering}
        error={error}
      />
    );
  }

  return (
    <main className="app-shell">
      <ChatShell
        roomName={roomName}
        pinnedMessage={pinnedMessage}
        pinnedMessageId={pinnedMessageId}
        messages={messages}
        feedRef={feedRef}
        onReply={setReplyTarget}
        onPin={handlePin}
        onReact={handleReact}
        recentIds={new Set(recentIds)}
        someoneTyping={someoneTyping}
        draft={draft}
        onDraftChange={setDraft}
        onSend={sendMessage}
        replyTarget={replyTarget}
        onClearReply={() => setReplyTarget(null)}
        showEmoji={showEmoji}
        onToggleEmoji={setShowEmoji}
        onAppendEmoji={(emoji) => setDraft((prev) => `${prev}${emoji}`)}
        onTyping={handleTyping}
        onInstall={promptInstall}
        showInstallOption={showInstallOption}
        onLogout={handleLogout}
        error={error}
      />
    </main>
  );
}
