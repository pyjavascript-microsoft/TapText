const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const http = require('http');
const socketIo = require('socket.io');
const Datastore = require('nedb');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const MAX_WARNINGS = 3;

const usersDB = new Datastore({ filename: 'users.db', autoload: true });
const messagesDB = new Datastore({ filename: 'messages.db', autoload: true });

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'bloxstudios_secret_2025',
  resave: false,
  saveUninitialized: false,
}));

// Helpers
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  next();
}

// ---------- ROUTES ----------

// Home redirect
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/chat');
  res.redirect('/login');
});

// Register page
app.get('/register', (req, res) => {
  res.send(htmlPage('Register', `
    <form method="POST" action="/register" autocomplete="off">
      <input name="username" placeholder="Username" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Register</button>
    </form>
    <p>Already have an account? <a href="/login">Login here</a></p>
  `));
});

// Register handler
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send(htmlError('Username and password required', '/register'));
  usersDB.findOne({ username }, (err, user) => {
    if (user) return res.send(htmlError('Username already exists', '/register'));
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return res.send(htmlError('Server error hashing password', '/register'));
      usersDB.insert({
        username,
        displayName: username,
        password: hash,
        role: 'user',
        bio: '',
        warnings: 0,
        followers: [],
      }, () => res.redirect('/login'));
    });
  });
});

// Login page
app.get('/login', (req, res) => {
  res.send(htmlPage('Login', `
    <form method="POST" action="/login" autocomplete="off">
      <input name="username" placeholder="Username" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Login</button>
    </form>
    <p>Don't have an account? <a href="/register">Register here</a></p>
  `));
});

// Login handler
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  usersDB.findOne({ username }, (err, user) => {
    if (!user) return res.send(htmlError('Invalid username or password', '/login'));
    if (user.role === 'banned') return res.send(htmlError('You are banned', '/login'));
    bcrypt.compare(password, user.password, (err, same) => {
      if (!same) return res.send(htmlError('Invalid username or password', '/login'));
      req.session.user = { id: user._id, username: user.username, role: user.role };
      res.redirect('/chat');
    });
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Chat page + Profile edit + Followers + Admin link
app.get('/chat', requireLogin, (req, res) => {
  const sessionUser = req.session.user;
  usersDB.find({ role: { $ne: 'banned' } }, (err, users) => {
    if (err) return res.send(htmlError('Server error', '/login'));
    usersDB.findOne({ _id: sessionUser.id }, (err, fullUser) => {
      if (err || !fullUser) return res.send(htmlError('User not found', '/login'));
      // User dropdown for DM
      const userOptions = users
        .filter(u => u.username !== fullUser.username)
        .map(u => `<option value="${u.username}">${escapeHtml(u.displayName || u.username)} (${escapeHtml(u.username)})</option>`).join('');

      const adminPanelLink = (sessionUser.role === 'admin') ? `<a class="glow-button" href="/admin">Admin Panel</a>` : '';

      res.send(htmlPage('TapText Chat', `
        <div class="container">
          <h1 class="neon">Welcome, ${escapeHtml(fullUser.displayName || fullUser.username)}!</h1>
          <div class="flex-row">
            <section class="chat-section">
              <h2>Direct Messages</h2>
              <select id="dmUserSelect">
                <option value="" disabled selected>Select user to chat</option>
                ${userOptions}
              </select>
              <div id="chatWindow" class="chat-window"></div>
              <form id="chatForm">
                <input id="chatInput" autocomplete="off" placeholder="Type your message..." />
                <button type="submit">Send</button>
              </form>
            </section>
            <section class="profile-section">
              <h2>Edit Profile</h2>
              <form method="POST" action="/update-profile" autocomplete="off">
                <label>Username:<br/><input name="username" value="${escapeHtml(fullUser.username)}" required /></label><br/>
                <label>Display Name:<br/><input name="displayName" value="${escapeHtml(fullUser.displayName || '')}" /></label><br/>
                <label>Bio:<br/><textarea name="bio">${escapeHtml(fullUser.bio || '')}</textarea></label><br/>
                <label>New Password:<br/><input type="password" name="password" placeholder="Leave blank to keep" /></label><br/>
                <button type="submit" class="glow-button">Update Profile</button>
              </form>
              <h3>Followers (${fullUser.followers.length})</h3>
              <ul id="followersList" class="followers-list">
                ${fullUser.followers.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
              </ul>
              <div>
                <h3>Follow User</h3>
                <select id="followSelect">
                  <option value="" disabled selected>Select user to follow</option>
                  ${users.filter(u => u.username !== fullUser.username && !fullUser.followers.includes(u.username))
                    .map(u => `<option value="${u.username}">${escapeHtml(u.displayName || u.username)}</option>`).join('')}
                </select>
                <button id="followBtn" class="glow-button">Follow</button>
              </div>
              <div>
                <h3>Unfollow User</h3>
                <select id="unfollowSelect">
                  <option value="" disabled selected>Select user to unfollow</option>
                  ${fullUser.followers.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}
                </select>
                <button id="unfollowBtn" class="glow-button">Unfollow</button>
              </div>
              ${adminPanelLink}
              <p><a href="/logout" class="glow-button red">Logout</a></p>
            </section>
          </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
          const socket = io();
          const chatForm = document.getElementById('chatForm');
          const chatInput = document.getElementById('chatInput');
          const chatWindow = document.getElementById('chatWindow');
          const dmUserSelect = document.getElementById('dmUserSelect');

          let currentChatUser = null;

          dmUserSelect.addEventListener('change', () => {
            chatWindow.innerHTML = '';
            currentChatUser = dmUserSelect.value;
            socket.emit('joinRoom', currentChatUser);
            socket.emit('getHistory', currentChatUser);
          });

          socket.on('chatHistory', messages => {
            chatWindow.innerHTML = '';
            messages.forEach(msg => {
              const div = document.createElement('div');
              div.className = msg.from === "${escapeJs(sessionUser.username)}" ? 'msg sent' : 'msg received';
              div.textContent = \`\${msg.from}: \${msg.text}\`;
              chatWindow.appendChild(div);
            });
            chatWindow.scrollTop = chatWindow.scrollHeight;
          });

          socket.on('message', msg => {
            if (msg.from === currentChatUser || msg.to === currentChatUser) {
              const div = document.createElement('div');
              div.className = msg.from === "${escapeJs(sessionUser.username)}" ? 'msg sent' : 'msg received';
              div.textContent = \`\${msg.from}: \${msg.text}\`;
              chatWindow.appendChild(div);
              chatWindow.scrollTop = chatWindow.scrollHeight;
            }
          });

          chatForm.addEventListener('submit', e => {
            e.preventDefault();
            if (!currentChatUser) return alert('Select a user to chat with!');
            if (!chatInput.value.trim()) return;
            socket.emit('sendMessage', { to: currentChatUser, text: chatInput.value.trim() });
            chatInput.value = '';
          });

          // Follow/unfollow buttons
          document.getElementById('followBtn').onclick = () => {
            const userToFollow = document.getElementById('followSelect').value;
            if (!userToFollow) return alert('Select a user to follow');
            fetch('/follow', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ username: userToFollow })
            }).then(res => res.text()).then(msg => {
              alert(msg);
              location.reload();
            });
          };

          document.getElementById('unfollowBtn').onclick = () => {
            const userToUnfollow = document.getElementById('unfollowSelect').value;
            if (!userToUnfollow) return alert('Select a user to unfollow');
            fetch('/unfollow', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ username: userToUnfollow })
            }).then(res => res.text()).then(msg => {
              alert(msg);
              location.reload();
            });
          };
        </script>
      `));
    });
  });
});

// Profile update
app.post('/update-profile', requireLogin, (req, res) => {
  const { username, displayName, bio, password } = req.body;
  const userId = req.session.user.id;
  usersDB.findOne({ _id: userId }, (err, currentUser) => {
    if (err || !currentUser) return res.send(htmlError('User not found', '/chat'));

    // Validate username change uniqueness
    if (username !== currentUser.username) {
      usersDB.findOne({ username }, (err, exists) => {
        if (exists) return res.send(htmlError('Username already taken', '/chat'));
        saveUpdates();
      });
    } else {
      saveUpdates();
    }

    function saveUpdates() {
      const updates = {
        bio: bio || '',
        displayName: displayName || username,
      };
      if (username !== currentUser.username) {
        updates.username = username;
      }
      if (password) {
        bcrypt.hash(password, 10, (err, hash) => {
          if (err) return res.send(htmlError('Error updating password', '/chat'));
          updates.password = hash;
          finishUpdate();
        });
      } else {
        finishUpdate();
      }

      function finishUpdate() {
        usersDB.update({ _id: userId }, { $set: updates }, {}, (err) => {
          if (err) return res.send(htmlError('Update failed', '/chat'));
          // Update session username if changed
          if (updates.username) {
            req.session.user.username = updates.username;
          }
          res.redirect('/chat');
        });
      }
    }
  });
});

// Follow user
app.post('/follow', requireLogin, (req, res) => {
  const follower = req.session.user.username;
  const toFollow = req.body.username;
  if (follower === toFollow) return res.send('Cannot follow yourself.');
  usersDB.findOne({ username: toFollow }, (err, userToFollow) => {
    if (!userToFollow) return res.send('User to follow not found.');
    usersDB.findOne({ username: follower }, (err, currentUser) => {
      if (!currentUser) return res.send('Current user not found.');
      if (currentUser.followers.includes(toFollow)) return res.send('Already following.');
      usersDB.update({ _id: currentUser._id }, { $push: { followers: toFollow } }, {}, err => {
        if (err) return res.send('Failed to follow.');
        res.send('Followed successfully.');
      });
    });
  });
});

// Unfollow user
app.post('/unfollow', requireLogin, (req, res) => {
  const follower = req.session.user.username;
  const toUnfollow = req.body.username;
  usersDB.findOne({ username: follower }, (err, currentUser) => {
    if (!currentUser) return res.send('Current user not found.');
    usersDB.update({ _id: currentUser._id }, { $pull: { followers: toUnfollow } }, {}, err => {
      if (err) return res.send('Failed to unfollow.');
      res.send('Unfollowed successfully.');
    });
  });
});

// Admin Panel
app.get('/admin', requireAdmin, (req, res) => {
  usersDB.find({}, (err, users) => {
    if (err) return res.send(htmlError('Server error', '/chat'));
    let rows = users.map(u => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.displayName || '')}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>${escapeHtml(u.bio || '')}</td>
        <td>${u.warnings || 0}</td>
        <td>
          <form method="POST" action="/admin/action" class="admin-form">
            <input type="hidden" name="userId" value="${u._id}" />
            <select name="action" required>
              <option disabled selected>Action</option>
              <option value="ban">Ban</option>
              <option value="unban">Unban</option>
              <option value="promote">Promote to Admin</option>
              <option value="demote">Demote to User</option>
              <option value="warn">Warn</option>
              <option value="unwarn">Remove Warning</option>
            </select>
            <button type="submit" class="glow-button small">Apply</button>
          </form>
        </td>
      </tr>
    `).join('');
    res.send(htmlPage('Admin Panel', `
      <h1 class="neon">Admin Panel</h1>
      <a href="/chat" class="glow-button">Back to Chat</a>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Username</th><th>Display Name</th><th>Role</th><th>Bio</th><th>Warnings</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p><a href="/logout" class="glow-button red">Logout</a></p>
    `));
  });
});

// Admin actions
app.post('/admin/action', requireAdmin, (req, res) => {
  const { userId, action } = req.body;
  usersDB.findOne({ _id: userId }, (err, user) => {
    if (!user) return res.send(htmlError('User not found', '/admin'));
    switch (action) {
      case 'ban':
        usersDB.update({ _id: userId }, { $set: { role: 'banned' } }, {}, () => res.redirect('/admin'));
        break;
      case 'unban':
        usersDB.update({ _id: userId }, { $set: { role: 'user' } }, {}, () => res.redirect('/admin'));
        break;
      case 'promote':
        usersDB.update({ _id: userId }, { $set: { role: 'admin' } }, {}, () => res.redirect('/admin'));
        break;
      case 'demote':
        usersDB.update({ _id: userId }, { $set: { role: 'user' } }, {}, () => res.redirect('/admin'));
        break;
      case 'warn':
        let newWarnings = (user.warnings || 0) + 1;
        let updates = { warnings: newWarnings };
        if (newWarnings >= MAX_WARNINGS) {
          updates.role = 'banned';
        }
        usersDB.update({ _id: userId }, { $set: updates }, {}, () => res.redirect('/admin'));
        break;
      case 'unwarn':
        let unwarnCount = Math.max((user.warnings || 0) - 1, 0);
        usersDB.update({ _id: userId }, { $set: { warnings: unwarnCount } }, {}, () => res.redirect('/admin'));
        break;
      default:
        res.redirect('/admin');
    }
  });
});

// --- Socket.io real-time chat ---

io.use((socket, next) => {
  const sessionID = socket.handshake.headers.cookie
    ?.split('; ')
    .find(row => row.startsWith('connect.sid='));
  // No complex session sharing here; assume logged in
  next();
});

io.on('connection', socket => {
  let username = null;
  // To identify user by session (improve in prod)
  socket.on('init', data => {
    username







= data.username;
});

socket.on('joinRoom', user => {
socket.join(user);
});

socket.on('sendMessage', ({ to, text }) => {
const from = username;
const msg = { from, to, text, time: Date.now() };
messagesDB.insert(msg);
socket.to(to).emit('message', msg);
socket.emit('message', msg);
});

socket.on('getHistory', (withUser) => {
messagesDB.find({ $or: [
{ from: username, to: withUser },
{ from: withUser, to: username }
] }).sort({ time: 1 }).exec((err, messages) => {
socket.emit('chatHistory', messages);
});
});
});

// Auto-create admin on first run
usersDB.findOne({ username: 'admin' }, (err, admin) => {
if (!admin) {
bcrypt.hash('Admin@321', 10, (err, hash) => {
usersDB.insert({
username: 'admin',
displayName: 'Admin',
password: hash,
role: 'admin',
bio: 'Default admin account',
warnings: 0,
followers: [],
}, () => console.log('[+] Default admin account created: admin / Admin@321'));
});
}
});

server.listen(PORT, () => {
console.log(🌐 TapText running on http://localhost:${PORT});
});

// -------------- HTML/CSS UTILS ------------------

function htmlPage(title, body) {
return `

<!DOCTYPE html><html><head><meta charset="UTF-8"> <title>${title}</title> <style> body { font-family: 'Segoe UI', sans-serif; background: #000; color: #0ff; text-shadow: 0 0 5px #0ff; margin: 0; padding: 0; } a { color: #0ff; } .container { padding: 20px; max-width: 1000px; margin: auto; } .neon { font-size: 2em; color: #0ff; text-shadow: 0 0 10px #0ff, 0 0 20px #0ff; } input, textarea, select, button { background: #111; color: #0ff; border: 1px solid #0ff; padding: 10px; margin: 5px 0; width: 100%; } .chat-window { background: #111; height: 300px; overflow-y: scroll; border: 2px solid #0ff; padding: 10px; } .msg { margin-bottom: 10px; } .msg.sent { text-align: right; color: #0f0; } .msg.received { text-align: left; color: #f0f; } .glow-button { background: #111; color: #0ff; border: 2px solid #0ff; text-shadow: 0 0 10px #0ff; box-shadow: 0 0 10px #0ff, 0 0 20px #0ff; transition: all 0.2s; } .glow-button:hover { background: #0ff; color: #000; box-shadow: 0 0 20px #0ff, 0 0 40px #0ff; } .glow-button.red { color: #f00; border-color: #f00; box-shadow: 0 0 10px #f00; } .glow-button.red:hover { background: #f00; color: #000; } .flex-row { display: flex; gap: 40px; } .profile-section, .chat-section { flex: 1; } table.admin-table { width: 100%; border-collapse: collapse; } table.admin-table th, table.admin-table td { border: 1px solid #0ff; padding: 8px; } .followers-list li { padding: 4px 0; } </style> </head><body>${body}</body></html>`; }
function htmlError(msg, backLink) {
return htmlPage('Error', <h1>Error</h1> <p>${msg}</p> <a href="${backLink}" class="glow-button">Go back</a> );
}

function escapeHtml(str) {
return (str || '').replace(/</g, '<').replace(/>/g, '>');
}
function escapeJs(str) {
return (str || '').replace(/"/g, '\"');
}
