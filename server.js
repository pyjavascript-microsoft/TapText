
// TapText DM App - Extended Version
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

const PORT = 3000;
const SESSION_SECRET = "bloxstudios_secure";

mongoose.connect('mongodb://127.0.0.1:27017/taptext_full', {
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
      ${u.username} (${u.role}) - ${u.banned ? 'Banned' : 'Active'}
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
  res.send(`<h2>Admin Panel</h2><ul>${userList}</ul><a href="/">Back</a>`);
});

app.post('/admin/action', async (req, res) => {
  const admin = await User.findOne({ username: req.session.user });
  if (!admin || admin.role !== 'admin') return res.send("Access denied.");
  const { target, action } = req.body;
  if (target === admin.username) return res.send("You can't change yourself.");
  const updates = {
    ban: { banned: true },
    unban: { banned: false },
    promote: { role: "admin" },
    demote: { role: "user" },
    warn: {}, // warning logic not stored in DB
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
  <h2>TapText - Login/Register</h2>
  <form method="POST" action="/login">Login:<br/><input name="username"/><input type="password" name="password"/><button>Login</button></form>
  <form method="POST" action="/register">Register:<br/><input name="username"/><input type="password" name="password"/><button>Register</button></form>`;
}

function chatPage(username, role, options) {
  return `
  <h2>Welcome ${username} (${role}) <a href="/logout">Logout</a></h2>
  ${role === 'admin' ? '<a href="/admin">Admin Panel</a><br/>' : ''}
  <form method="POST" action="/update-profile">
    <input name="bio" placeholder="Update Bio"/>
    <input name="password" placeholder="New Password"/>
    <button>Update Profile</button>
  </form>
  <select id="receiver">${options}</select>
  <input id="content"/><button onclick="send()">Send</button>
  <div id="messages"></div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io(); const user = "${username}";
    socket.emit("join", user);
    socket.on("messageHistory", msgs => {
      const box = document.getElementById("messages");
      box.innerHTML = msgs.map(m => "<p><b>"+m.sender+":</b> "+m.content+"</p>").join('');
    });
    socket.on("newMessage", msg => {
      const box = document.getElementById("messages");
      box.innerHTML += "<p><b>"+msg.sender+":</b> "+msg.content+"</p>";
    });
    function send() {
      const to = document.getElementById("receiver").value;
      const content = document.getElementById("content").value;
      socket.emit("sendMessage", { sender: user, receiver: to, content });
      document.getElementById("content").value = "";
    }
  </script>`;
}

server.listen(PORT, () => console.log("TapText running on http://localhost:" + PORT));
