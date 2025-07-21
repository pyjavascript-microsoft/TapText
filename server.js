// TapText DM App - CSS Overload Edition
// © 2025 BloxStudios. All Rights Reserved.

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "bloxstudios_secure";

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/taptext_full', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, default: "user" },
  banned: { type: Boolean, default: false },
  bio: { type: String, default: "" },
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  sender: String,
  receiver: String,
  content: String,
  timestamp: { type: Date, default: Date.now },
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

async function createAdminIfNotExists() {
  const adminExists = await User.findOne({ role: 'admin' });
  if (!adminExists) {
    const hashed = await bcrypt.hash('Admin@321', 10);
    await new User({ username: 'admin', password: hashed, role: 'admin' }).save();
    console.log('Admin account created: username=admin, password=Admin@321');
  }
}
createAdminIfNotExists();

app.get('/', async (req, res) => {
  if (!req.session.user) return res.send(loginPage());
  const user = await User.findOne({ username: req.session.user });
  if (!user || user.banned) return res.send("You are banned.");
  const users = await User.find({ username: { $ne: user.username } });
  const options = users.map(u => `<option value="${u.username}">${u.username}</option>`).join('');
  res.send(chatPage(user.username, user.role, options));
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const exists = await User.findOne({ username });
  if (exists) return res.send("User already exists.");
  const hashed = await bcrypt.hash(password, 10);
  await new User({ username, password: hashed }).save();
  req.session.user = username;
  res.redirect('/');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || user.banned) return res.send("Access denied.");
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Incorrect password.");
  req.session.user = username;
  res.redirect('/');
});

app.post('/update-profile', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { bio, password } = req.body;
  const updates = {};
  if (bio) updates.bio = bio;
  if (password) updates.password = await bcrypt.hash(password, 10);
  await User.updateOne({ username: req.session.user }, { $set: updates });
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/admin', async (req, res) => {
  const currentUser = await User.findOne({ username: req.session.user });
  if (!currentUser || currentUser.role !== 'admin') return res.send("Admins only.");
  const users = await User.find({});
  const userList = users.map(u => `
    <li>
      <b>${u.username}</b> (${u.role}) - ${u.banned ? '<span style="color:red">Banned</span>' : 'Active'}
      <form style="display:inline" method="POST" action="/admin/action">
        <input type="hidden" name="target" value="${u.username}" />
        <select name="action">
          <option>ban</option>
          <option>unban</option>
          <option>promote</option>
          <option>demote</option>
          <option>warn</option>
        </select>
        <button>Go</button>
      </form>
    </li>
  `).join('');
  res.send(`
    <h2>Admin Panel</h2>
    <ul>${userList}</ul>
    <a href="/">Back</a>
  `);
});

app.post('/admin/action', async (req, res) => {
  const admin = await User.findOne({ username: req.session.user });
  if (!admin || admin.role !== 'admin') return res.send("Access denied.");
  const { target, action } = req.body;
  if (target === admin.username) return res.send("You can't modify yourself.");
  const updates = {
    ban: { banned: true },
    unban: { banned: false },
    promote: { role: "admin" },
    demote: { role: "user" },
    warn: {},
  };
  if (updates[action]) await User.updateOne({ username: target }, { $set: updates[action] });
  res.redirect('/admin');
});

io.on('connection', socket => {
  socket.on('join', async username => {
    socket.username = username;
    const messages = await Message.find({
      $or: [{ sender: username }, { receiver: username }]
    }).sort({ timestamp: 1 });
    socket.emit('messageHistory', messages);
  });

  socket.on('sendMessage', async data => {
    const { sender, receiver, content } = data;
    const toUser = await User.findOne({ username: receiver });
    if (toUser?.banned) return;
    const msg = await new Message({ sender, receiver, content }).save();
    io.emit('newMessage', msg);
  });
});

function loginPage() {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <title>TapText - Login/Register</title>
  <style>
    /* CSS OVERLOAD START */
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600&display=swap');
    body {
      margin: 0; padding: 0;
      background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
      font-family: 'Poppins', sans-serif;
      color: white;
      text-align: center;
      height: 100vh;
      overflow: hidden;
    }
    h2 {
      font-size: 3rem;
      margin-top: 3rem;
      text-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff;
      animation: glow 2s ease-in-out infinite alternate;
    }
    form {
      background: rgba(255, 255, 255, 0.1);
      margin: 2rem auto;
      padding: 2rem;
      border-radius: 20px;
      max-width: 400px;
      box-shadow: 0 0 30px #00ffff;
      backdrop-filter: blur(10px);
      transition: box-shadow 0.3s ease;
    }
    form:hover {
      box-shadow: 0 0 40px #0ff, 0 0 60px #0ff;
    }
    input {
      width: 80%;
      padding: 15px;
      margin: 10px 0;
      border: none;
      border-radius: 30px;
      font-size: 1.2rem;
      text-align: center;
      transition: background 0.3s ease;
      background: rgba(255, 255, 255, 0.3);
      color: #000;
      font-weight: 600;
      box-shadow: inset 0 0 5px #0ff;
    }
    input:focus {
      outline: none;
      background: #0ff;
      color: #000;
      box-shadow: 0 0 15px #0ff;
    }
    button {
      background: #00ffff;
      border: none;
      padding: 15px 40px;
      margin-top: 15px;
      font-size: 1.4rem;
      font-weight: 700;
      color: #000;
      border-radius: 50px;
      cursor: pointer;
      box-shadow: 0 0 20px #00ffff;
      transition: background 0.3s ease;
    }
    button:hover {
      background: #00cccc;
      box-shadow: 0 0 30px #00cccc;
    }
    @keyframes glow {
      from { text-shadow: 0 0 5px #00ffff, 0 0 10px #00ffff; }
      to { text-shadow: 0 0 20px #00ffff, 0 0 40px #00ffff; }
    }
    /* CSS OVERLOAD END */
  </style>
  </head>
  <body>
    <h2>TapText - Login/Register</h2>
    <form method="POST" action="/login" autocomplete="off">
      <input name="username" required placeholder="Username" autocomplete="off"/>
      <input type="password" name="password" required placeholder="Password" autocomplete="off"/>
      <button>Login</button>
    </form>
    <form method="POST" action="/register" autocomplete="off">
      <input name="username" required placeholder="Username" autocomplete="off"/>
      <input type="password" name="password" required placeholder="Password" autocomplete="off"/>
      <button>Register</button>
    </form>
  </body>
  </html>
  `;
}

function chatPage(username, role, options) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <title>TapText - Chat</title>
  <style>
    /* CSS OVERLOAD START */
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600&display=swap');
    body {
      margin: 0; padding: 0;
      background: linear-gradient(120deg, #2980b9, #6dd5fa, #ffffff);
      font-family: 'Poppins', sans-serif;
      color: #222;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      user-select: none;
    }
    header {
      background: #0f2027;
      color: #0ff;
      padding: 20px 40px;
      font-size: 1.8rem;
      font-weight: 700;
      box-shadow: 0 0 15px #00ffff;
      text-shadow: 0 0 10px #00ffff;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header a {
      color: #0ff;
      text-decoration: none;
      font-weight: 600;
      padding: 8px 15px;
      border-radius: 30px;
      background: #222;
      box-shadow: 0 0 10px #00ffff;
      transition: background 0.3s ease;
    }
    header a:hover {
      background: #0ff;
      color: #000;
      box-shadow: 0 0 20px #00ffff;
    }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 20px 40px;
      gap: 15px;
      background: #ffffffdd;
      box-shadow: inset 0 0 40px #00ffff88;
      border-radius: 40px 40px 0 0;
    }
    form#profileForm {
      background: #0ff4;
      padding: 15px 20px;
      border-radius: 25px;
      display: flex;
      gap: 10px;
      box-shadow: 0 0 20px #0ff;
      font-weight: 600;
    }
    form#profileForm input {
      flex: 1;
      border: none;
      border-radius: 30px;
      padding: 12px 15px;
      font-size: 1rem;
      transition: box-shadow 0.3s ease;
      outline: none;
      box-shadow: inset 0 0 10px #0ff;
    }
    form#profileForm input:focus {
      box-shadow: 0 0 15px #0ff;
    }
    form#profileForm button {
      padding: 12px 25px;
      border: none;
      border-radius: 50px;
      background: #00ffff;
      color: #000;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 0 25px #00ffff;
      transition: background 0.3s ease;
    }
    form#profileForm button:hover {
      background: #00cccc;
      box-shadow: 0 0 30px #00cccc;
    }
    select, input#content {
      padding: 12px 20px;
      font-size: 1.1rem;
      border-radius: 30px;
      border: none;
      outline: none;
      box-shadow: inset 0 0 15px #0ff;
      transition: box-shadow 0.3s ease;
      margin-right: 10px;
      width: 250px;
      max-width: 80vw;
    }
    select:focus, input#content:focus {
      box-shadow: 0 0 25px #0ff;
    }
    button#sendBtn {
      padding: 12px 40px;
      background: #00ffff;
      border: none;
      border-radius: 50px;
      font-weight: 700;
      color: #000;
      cursor: pointer;
      box-shadow: 0 0 25px #00ffff;
      transition: background 0.3s ease;
    }
    button#sendBtn:hover {
      background: #00cccc;
      box-shadow: 0 0 30px #00cccc;
    }
    #messages {
      flex: 1;
      background: #000;
      border-radius: 30px;
      padding: 15px 20px;
      color: #0ff;
      font-family: monospace;
      font-size: 1rem;
      overflow-y: auto;
      box-shadow: inset 0 0 40px #00ffff;
      user-select: text;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    #messages p {
      margin: 5px 0;
      padding: 5px 10px;
      border-radius: 15px;
      background: linear-gradient(45deg, #00ffff88, #009999cc);
      box-shadow: 0 0 10px #00ffffaa;
      display: inline-block;
      max-width: 80%;
    }
    #messages p.self {
      background: linear-gradient(45deg, #ff6b6bcc, #ff0000cc);
      text-align: right;
      float: right;
      clear: both;
    }
    a.admin-link {
      margin-left: 20px;
      color: #00ffff;
      font-weight: 700;
      text-decoration: underline;
      cursor: pointer;
      transition: color 0.3s ease;
    }
    a.admin-link:hover {
      color: #009999;
    }
  </style>
  </head>
  <body>
    <header>
      TapText — Welcome <b>${username}</b> (${role})
      <span>
        <a href="/logout">Logout</a>
        ${role === 'admin' ? '<a href="/admin" class="admin-link">Admin Panel</a>' : ''}
      </span>
    </header>
    <main>
      <form id="profileForm" method="POST" action="/update-profile" autocomplete="off">
        <input name="bio" placeholder="Update Bio (Optional)" />
        <input name="password" type="password" placeholder="New Password (Optional)" />
        <button type="submit">Update Profile</button>
      </form>
      <div style="display:flex; align-items:center; margin-bottom:15px;">
        <select id="receiver" title="Select user to message">${options}</select>
        <input id="content" autocomplete="off" placeholder="Type your message here..." />
        <button id="sendBtn">Send</button>
      </div>
      <div id="messages" tabindex="0" aria-live="polite" aria-label="Chat messages"></div>
    </main>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      const socket = io();
      const user = "${username}";
      socket.emit("join", user);
      const messagesBox = document.getElementById("messages");

      socket.on("messageHistory", msgs => {
        messagesBox.innerHTML = '';
        msgs.forEach(m => {
          const p = document.createElement("p");
          p.textContent = m.sender + ": " + m.content;
          if(m.sender === user) p.classList.add("self");
          messagesBox.appendChild(p);
        });
        messagesBox.scrollTop = messagesBox.scrollHeight;
      });

      socket.on("newMessage", msg => {
        if(msg.sender === user || msg.receiver === user) {
          const p = document.createElement("p");
          p.textContent = msg.sender + ": " + msg.content;
          if(msg.sender === user) p.classList.add("self");
          messagesBox.appendChild(p);
          messagesBox.scrollTop = messagesBox.scrollHeight;
        }
      });

      document.getElementById("sendBtn").addEventListener("click", () => {
        const to = document.getElementById("receiver").value;
        const content = document.getElementById("content").value.trim();
        if(!to || !content) {
          alert("Select user and enter message.");
          return;
        }
        socket.emit("sendMessage", { sender: user, receiver: to, content });
        document.getElementById("content").value = "";
      });

      // Allow pressing Enter to send message
      document.getElementById("content").addEventListener("keypress", e => {
        if(e.key === "Enter") {
          e.preventDefault();
          document.getElementById("sendBtn").click();
        }
      });
    </script>
  </body>
  </html>
  `;
}

server.listen(PORT, () => console.log(`TapText running on http://localhost:${PORT}`));
