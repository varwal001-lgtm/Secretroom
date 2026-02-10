const ADMIN_KEY = "CHANGE_ME";
const MESSAGE_TTL_MS = 60 * 60 * 1000;
const EMOJIS = ["😀", "😅", "😎", "🤖", "🔥", "✨", "🎯", "💡", "🧠", "✅"];

const app = document.getElementById("app");

let session = null;
let room = { name: "MSc", ownerSet: false };
let messages = [];
let roster = [];
let adminMapping = [];

function generateAnonName() {
  const label = Math.random() > 0.5 ? "User" : "Ghost";
  let name;
  do {
    name = `${label}-${Math.floor(10 + Math.random() * 90)}`;
  } while (roster.includes(name));
  return name;
}

function pruneMessages() {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  messages = messages.filter((m) => m.ts >= cutoff);
}

function login(rollNumber, adminKey) {
  const student = STUDENTS.find((s) => s.registrationNo === rollNumber.trim());
  if (!student) throw new Error("Roll number not found");

  const anonName = generateAnonName();
  session = {
    registrationNo: student.registrationNo,
    name: student.name,
    department: student.department,
    anonName,
    isAdmin: Boolean(adminKey && adminKey === ADMIN_KEY),
  };

  if (!room.ownerSet) {
    room.ownerSet = true;
    room.owner = session.anonName;
    room.canRename = true;
  } else {
    room.canRename = session.anonName === room.owner;
  }

  roster = [session.anonName];
  adminMapping = [];
  renderChat();
}

function logout() {
  session = null;
  messages = [];
  roster = [];
  adminMapping = [];
  renderLogin();
}

function sendMessage(messageType, content) {
  if (!content) return;
  const entry = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    anonName: session.anonName,
    messageType,
    content,
  };
  messages.push(entry);
  pruneMessages();
  renderChat();
  const body = document.querySelector(".chat-body");
  if (body) body.scrollTop = body.scrollHeight;
}

function handleImageUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result || "";
    if (dataUrl.length > 1_000_000) {
      alert("Image too large (max ~1MB)");
      return;
    }
    sendMessage("image", dataUrl);
  };
  reader.readAsDataURL(file);
}

function revealAdmin() {
  if (!session?.isAdmin) return;
  adminMapping = [
    {
      anonName: session.anonName,
      registrationNo: session.registrationNo,
      name: session.name,
    },
  ];
  renderChat();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <h1>ChatPe (Static)</h1>
        <p class="notice">Anonymous department chat demo. No server required.</p>
        <form id="loginForm" style="margin-top: 20px; display: grid; gap: 16px;">
          <div>
            <div class="label">Roll Number</div>
            <input class="input" name="roll" placeholder="Scan or enter roll number" required />
          </div>
          <div>
            <div class="label">Admin Key (optional)</div>
            <input class="input" name="admin" placeholder="Only for admin access" />
          </div>
          <button class="btn btn-primary" type="submit">Enter Chat</button>
          <div class="notice">No sessions are stored. Logout requires re-scan.</div>
        </form>
      </div>
    </div>
  `;

  document.getElementById("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const roll = e.target.roll.value;
    const adminKey = e.target.admin.value;
    try {
      login(roll, adminKey);
    } catch (err) {
      alert(err.message);
    }
  });
}

function renderMessages() {
  if (!messages.length) {
    return `<div class="notice">No messages yet. Say hi.</div>`;
  }

  return messages
    .map((m) => {
      const time = new Date(m.ts).toLocaleTimeString();
      const content =
        m.messageType === "image"
          ? `<img src="${m.content}" alt="upload" style="margin-top:8px; border-radius:12px; max-width: 240px; border: 1px solid rgba(255,255,255,0.1);" />`
          : `<div class="message-text">${escapeHtml(m.content)}</div>`;
      return `
        <div class="message">
          <div class="avatar">${m.anonName.slice(0, 2)}</div>
          <div>
            <div class="message-meta"><strong>${m.anonName}</strong> · ${time}</div>
            ${content}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAdminPanel() {
  if (!session?.isAdmin || adminMapping.length === 0) return "";
  return `
    <aside class="admin-panel">
      <h3>Admin Mapping</h3>
      <div class="notice">Visible only to admin</div>
      ${adminMapping
        .map(
          (m) => `
          <div class="mapping-card">
            <div>${m.anonName}</div>
            <div><strong>${m.name}</strong></div>
            <div class="mono">${m.registrationNo}</div>
          </div>
        `
        )
        .join("")}
    </aside>
  `;
}

function renderChat() {
  app.innerHTML = `
    <div class="container">
      <aside class="sidebar">
        <div style="display:flex; align-items:center; justify-content: space-between;">
          <h2>Rooms</h2>
          <span class="badge">${session.department}</span>
        </div>
        <div class="room-pill">#${room.name}</div>

        <div>
          <div class="label">Roster</div>
          <div class="roster" style="margin-top: 12px;">
            ${roster
              .map(
                (name) => `
                <div class="roster-item">
                  <span class="dot"></span>
                  <span>${name}</span>
                </div>
              `
              )
              .join("")}
          </div>
        </div>

        <div style="margin-top: auto;">
          <button class="btn btn-ghost" id="logoutBtn" style="width:100%;">Logout</button>
        </div>
      </aside>

      <main class="chat">
        <header class="chat-header">
          <div>
            <h3>#${room.name}</h3>
            <div class="notice">Messages auto-delete after 1 hour</div>
          </div>
          <div style="display:flex; gap: 8px;">
            ${room.canRename ? `<button class="btn btn-soft" id="renameBtn">Rename Room</button>` : ""}
            ${session.isAdmin ? `<button class="btn btn-primary" id="revealBtn">Reveal Identities</button>` : ""}
          </div>
        </header>

        <section class="chat-body">
          ${renderMessages()}
        </section>

        <footer class="chat-footer">
          <form id="messageForm" class="input-row">
            <div class="emoji-row">
              ${EMOJIS.map((emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join("")}
            </div>
            <input class="input" name="message" placeholder="Type your message..." autocomplete="off" />
            <label class="btn btn-ghost">
              Upload
              <input type="file" accept="image/*" id="imageInput" style="display:none;" />
            </label>
            <button class="btn btn-primary" type="submit">Send</button>
          </form>
        </footer>
      </main>

      ${renderAdminPanel()}
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", logout);
  const renameBtn = document.getElementById("renameBtn");
  if (renameBtn) {
    renameBtn.addEventListener("click", () => {
      const next = prompt("New room name", room.name);
      if (next) {
        room.name = next.slice(0, 40);
        renderChat();
      }
    });
  }

  const revealBtn = document.getElementById("revealBtn");
  if (revealBtn) {
    revealBtn.addEventListener("click", revealAdmin);
  }

  document.querySelectorAll("[data-emoji]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.querySelector("input[name='message']");
      input.value += btn.dataset.emoji;
      input.focus();
    });
  });

  document.getElementById("messageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = e.target.message.value.trim();
    if (!msg) return;
    sendMessage("text", msg);
    e.target.message.value = "";
  });

  document.getElementById("imageInput").addEventListener("change", (e) => {
    handleImageUpload(e.target.files[0]);
    e.target.value = "";
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

setInterval(() => {
  if (!session) return;
  pruneMessages();
  renderChat();
}, 60 * 1000);

renderLogin();
