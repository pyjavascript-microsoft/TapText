const socket = io();

const landingSection = document.getElementById("landing");
const loginSection = document.getElementById("login");
const registerSection = document.getElementById("register");
const chatSection = document.getElementById("chat");
const adminPanel = document.getElementById("adminPanel");

const btnLogin = document.getElementById("btnLogin");
const btnGetStarted = document.getElementById("btnGetStarted");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const sendMsgForm = document.getElementById("sendMsgForm");
const logoutBtn = document.getElementById("logoutBtn");

const loginError = document.getElementById("loginError");
const registerError = document.getElementById("registerError");

const chatDisplayName = document.getElementById("chatDisplayName");
const chatRole = document.getElementById("chatRole");

const userListUl = document.getElementById("userListUl");
const messagesUl = document.getElementById("messagesUl");
const selectUserTo = document.getElementById("selectUserTo");

const adminMessagesUl = document.getElementById("adminMessagesUl");
const adminMsgDiv = document.getElementById("adminMsg");

const adminPromoteForm = document.getElementById("adminPromoteForm");
const adminDemoteForm = document.getElementById("adminDemoteForm");
const adminWarnForm = document.getElementById("adminWarnForm");

const backToLandingFromLogin = document.getElementById("backToLandingFromLogin");
const backToLandingFromRegister = document.getElementById("backToLandingFromRegister");

const goToLogin = document.getElementById("goToLogin");
const goToRegister = document.getElementById("goToRegister");

let currentUser = null;
let users = []; // all users loaded on chat load

function showSection(section) {
  [landingSection, loginSection, registerSection, chatSection].forEach(s => s.classList.add("hidden"));
  section.classList.remove("hidden");
}

btnLogin.onclick = () => showSection(loginSection);
btnGetStarted.onclick = () => showSection(registerSection);

goToLogin.onclick = () => {
  registerError.textContent = "";
  showSection(loginSection);
};

goToRegister.onclick = () => {
  loginError.textContent = "";
  showSection(registerSection);
};

backToLandingFromLogin.onclick = () => {
  loginError.textContent = "";
  showSection(landingSection);
};

backToLandingFromRegister.onclick = () => {
  registerError.textContent = "";
  showSection(landingSection);
};

// Helper: fetch JSON with error handling
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

// Load current user info and initialize chat UI
async function loadCurrentUser() {
  try {
    const data = await fetchJSON("/me");
    currentUser = data;
    chatDisplayName.textContent = currentUser.displayName;
    chatRole.textContent = currentUser.role;
    if (currentUser.role === "admin") {
      adminPanel.classList.remove("hidden");
      loadAdminMessages();
    } else {
      adminPanel.classList.add("hidden");
    }
    await loadUsers();
    await loadMessages();
    showSection(chatSection);
  } catch {
    showSection(landingSection);
  }
}

// Load all users for user list and DM select dropdown
async function loadUsers() {
  // No endpoint yet for all users — quick hack: get users from messages DB
  // For simplicity, we'll load usernames from messages + current user + admin only
  // In real app you'd have a users API to fetch users list
  users = [currentUser.username];

  // Get all usernames from messages DB (hacky)
  const res = await fetch("/messages");
  const messages = await res.json();
  messages.forEach(m => {
    if (!users.includes(m.from)) users.push(m.from);
    if (!users.includes(m.to)) users.push(m.to);
  });

  // Add admin user if missing
  if (!users.includes("AHDX")) users.push("AHDX");

  // Populate user list UL
  userListUl.innerHTML = "";
  users.forEach(u => {
    if (u === currentUser.username) return;
    const li = document.createElement("li");
    li.textContent = u;
    li.onclick = () => {
      selectUserTo.value = u;
    };
    userListUl.appendChild(li);
  });

  // Populate DM select dropdown
  selectUserTo.innerHTML = '<option value="" disabled selected>Select User to DM</option>';
  users.forEach(u => {
    if (u !== currentUser.username) {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      selectUserTo.appendChild(opt);
    }
  });
}

// Load messages to chat window
async function loadMessages() {
  const res = await fetch("/messages");
  const messages = await res.json();
  messagesUl.innerHTML = "";
  messages.forEach(m => {
    addMessageToChat(m, false);
  });
  messagesUl.scrollTop = messagesUl.scrollHeight;
}

// Add a message to chat UL
function addMessageToChat(msg, scroll = true) {
  const li = document.createElement("li");
  const time = new Date(msg.timestamp).toLocaleTimeString();
  li.textContent = `[${time}] ${msg.from} → ${msg.to}: ${msg.message}`;
  messagesUl.appendChild(li);
  if (scroll) messagesUl.scrollTop = messagesUl.scrollHeight;
}

// Socket.IO realtime DM receive
socket.on("dm", (msg) => {
  // Show only if user involved or admin
  if (!currentUser) return;
  if (currentUser.role === "admin" || msg.from === currentUser.username || msg.to === currentUser.username) {
    addMessageToChat(msg);
    if (currentUser.role === "admin") addAdminMessage(msg);
  }
});

// Login form submit
loginForm.onsubmit = async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    await fetchJSON("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    loginForm.reset();
    await loadCurrentUser();
  } catch (err) {
    loginError.textContent = err.message;
  }
};

// Register form submit
registerForm.onsubmit = async (e) => {
  e.preventDefault();
  registerError.textContent = "";
  const username = document.getElementById("regUsername").value.trim();
  const displayName = document.getElementById("regDisplayName").value.trim();
  const birthdate = document.getElementById("regBirthdate").value;
  const password = document.getElementById("regPassword").value;
  const password2 = document.getElementById("regPassword2").value;

  if (password !== password2) {
    registerError.textContent = "Passwords do not match.";
    return;
  }

  try {
    await fetchJSON("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, displayName, birthdate, password, password2 }),
    });
    alert("Registration successful! Please login.");
    registerForm.reset();
    showSection(loginSection);
  } catch (err) {
    registerError.textContent = err.message;
  }
};

// Send DM form submit
sendMsgForm.onsubmit = async (e) => {
  e.preventDefault();
  const to = selectUserTo.value;
  const message = document.getElementById("msgInput").value.trim();
  if (!to || !message) return;

  try {
    await fetchJSON("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, message }),
    });
    document.getElementById("msgInput").value = "";
  } catch (err) {
    alert("Failed to send message: " + err.message);
  }
};

// Logout
logoutBtn.onclick = async () => {
  await fetchJSON("/logout", { method: "POST" });
  currentUser = null;
  messagesUl.innerHTML = "";
  userListUl.innerHTML = "";
  selectUserTo.innerHTML = "";
  showSection(landingSection);
  adminPanel.classList.add("hidden");
};

// Admin: Show all messages in admin panel
function addAdminMessage(msg) {
  const li = document.createElement("li");
  const time = new Date(msg.timestamp).toLocaleString();
  li.textContent = `[${time}] ${msg.from} → ${msg.to}: ${msg.message}`;
  adminMessagesUl.appendChild(li);
}

async function loadAdminMessages() {
  adminMessagesUl.innerHTML = "";
  try {
    const res = await fetch("/messages");
    const msgs = await res.json();
    msgs.forEach(addAdminMessage);
  } catch {
    adminMsgDiv.textContent = "Failed to load admin messages.";
  }
}

// Admin promote
adminPromoteForm.onsubmit = async (e) => {
  e.preventDefault();
  const target = document.getElementById("promoteUsername").value.trim();
  if (!target) return;
  try {
    const res = await fetchJSON("/admin/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    adminMsgDiv.textContent = res.message;
    document.getElementById("promoteUsername").value = "";
  } catch (err) {
    adminMsgDiv.textContent = err.message;
  }
};

// Admin demote
adminDemoteForm.onsubmit = async (e) => {
  e.preventDefault();
  const target = document.getElementById("demoteUsername").value.trim();
  if (!target) return;
  try {
    const res = await fetchJSON("/admin/demote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    adminMsgDiv.textContent = res.message;
    document.getElementById("demoteUsername").value = "";
  } catch (err) {
    adminMsgDiv.textContent = err.message;
  }
};

// Admin warn
adminWarnForm.onsubmit = async (e) => {
  e.preventDefault();
  const target = document.getElementById("warnUsername").value.trim();
  const reason = document.getElementById("warnReason").value.trim();
  if (!target || !reason) return;
  try {
    const res = await fetchJSON("/admin/warn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, reason }),
    });
    adminMsgDiv.textContent = res.message;
    document.getElementById("warnUsername").value = "";
    document.getElementById("warnReason").value = "";
  } catch (err) {
    adminMsgDiv.textContent = err.message;
  }
};

// On load: try to auto-login by checking session
loadCurrentUser();
