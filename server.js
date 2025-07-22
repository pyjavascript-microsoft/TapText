const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcrypt");
const Datastore = require("nedb");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

const usersDB = new Datastore({ filename: path.join(__dirname, "db", "users.db"), autoload: true });
const messagesDB = new Datastore({ filename: path.join(__dirname, "db", "messages.db"), autoload: true });
const warningsDB = new Datastore({ filename: path.join(__dirname, "db", "warnings.db"), autoload: true });

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Simple session management (sessionId → username)
const sessions = {};

function generateSessionId() {
  return Math.random().toString(36).slice(2);
}

function authMiddleware(req, res, next) {
  const sessionId = req.cookies.sessionId;
  if (sessionId && sessions[sessionId]) {
    const username = sessions[sessionId];
    usersDB.findOne({ username }, (err, user) => {
      if (user) {
        req.user = user;
        next();
      } else {
        res.status(401).json({ error: "Invalid session" });
      }
    });
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === "admin") next();
  else res.status(403).json({ error: "Admin only" });
}

// Create default admin
const ADMIN_USERNAME = "AHDX";
const ADMIN_PASSWORD = "admin123";

usersDB.findOne({ username: ADMIN_USERNAME }, (err, user) => {
  if (!user) {
    bcrypt.hash(ADMIN_PASSWORD, 10, (err, hash) => {
      if (err) return console.error("Error creating admin:", err);
      usersDB.insert({
        username: ADMIN_USERNAME,
        password: hash,
        displayName: "AHDX (Admin)",
        role: "admin",
        followers: [],
        following: []
      });
      console.log("Default admin user created.");
    });
  }
});

// Registration route
app.post("/register", (req, res) => {
  const { username, displayName, birthdate, password, password2 } = req.body;

  if (!username || !displayName || !birthdate || !password || !password2) {
    return res.status(400).json({ error: "All fields are required." });
  }

  // Passwords match?
  if (password !== password2) {
    return res.status(400).json({ error: "Passwords do not match." });
  }

  // Age verification (13+)
  const birth = new Date(birthdate);
  if (isNaN(birth.getTime())) {
    return res.status(400).json({ error: "Invalid birthdate." });
  }
  const ageDifMs = Date.now() - birth.getTime();
  const ageDate = new Date(ageDifMs);
  const age = Math.abs(ageDate.getUTCFullYear() - 1970);
  if (age < 13) {
    return res.status(400).json({ error: "You must be at least 13 years old to register." });
  }

  usersDB.findOne({ username }, (err, existingUser) => {
    if (existingUser) return res.status(400).json({ error: "Username already taken." });

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return res.status(500).json({ error: "Server error hashing password." });

      usersDB.insert({
        username,
        displayName,
        password: hash,
        role: "user",
        followers: [],
        following: []
      }, (err, newUser) => {
        if (err) return res.status(500).json({ error: "Database error creating user." });
        res.json({ message: "Registration successful." });
      });
    });
  });
});

// Login route
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required." });

  usersDB.findOne({ username }, (err, user) => {
    if (!user) return res.status(400).json({ error: "User not found." });

    bcrypt.compare(password, user.password, (err, result) => {
      if (result) {
        const sessionId = generateSessionId();
        sessions[sessionId] = username;
        res.cookie("sessionId", sessionId, { httpOnly: true });
        res.json({ message: "Login successful.", displayName: user.displayName, role: user.role, username: user.username });
      } else {
        res.status(400).json({ error: "Incorrect password." });
      }
    });
  });
});

// Logout
app.post("/logout", authMiddleware, (req, res) => {
  const sessionId = req.cookies.sessionId;
  delete sessions[sessionId];
  res.clearCookie("sessionId");
  res.json({ message: "Logged out." });
});

// Get current user info
app.get("/me", authMiddleware, (req, res) => {
  const { username, displayName, role } = req.user;
  res.json({ username, displayName, role });
});

// Fetch messages (admin gets all, user only own DMs)
app.get("/messages", authMiddleware, (req, res) => {
  if (req.user.role === "admin") {
    messagesDB.find({}).sort({ timestamp: 1 }).exec((err, msgs) => {
      res.json(msgs);
    });
  } else {
    messagesDB.find({
      $or: [{ from: req.user.username }, { to: req.user.username }]
    }).sort({ timestamp: 1 }).exec((err, msgs) => {
      res.json(msgs);
    });
  }
});

// Send DM
app.post("/messages", authMiddleware, (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: "To and message required." });

  usersDB.findOne({ username: to }, (err, recipient) => {
    if (!recipient) return res.status(400).json({ error: "Recipient not found." });

    const dm = {
      from: req.user.username,
      to,
      message,
      timestamp: new Date()
    };
    messagesDB.insert(dm, (err, newMsg) => {
      io.emit("dm", newMsg); // send to all connected clients (could optimize to only relevant users)
      res.json(newMsg);
    });
  });
});

// Admin routes for warnings, promote/demote
app.post("/admin/warn", authMiddleware, adminMiddleware, (req, res) => {
  const { target, reason } = req.body;
  if (!target || !reason) return res.status(400).json({ error: "Target and reason required." });

  warningsDB.insert({ target, reason, by: req.user.username, timestamp: new Date() }, (err) => {
    if (err) return res.status(500).json({ error: "Error adding warning." });
    res.json({ message: "User warned." });
  });
});

app.post("/admin/promote", authMiddleware, adminMiddleware, (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error: "Target required." });

  usersDB.update({ username: target }, { $set: { role: "admin" } }, {}, (err, num) => {
    if (err || num === 0) return res.status(400).json({ error: "Promotion failed." });
    res.json({ message: `${target} promoted to admin.` });
  });
});

app.post("/admin/demote", authMiddleware, adminMiddleware, (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error: "Target required." });

  if (target === ADMIN_USERNAME) return res.status(400).json({ error: "Cannot demote default admin." });

  usersDB.update({ username: target }, { $set: { role: "user" } }, {}, (err, num) => {
    if (err || num === 0) return res.status(400).json({ error: "Demotion failed." });
    res.json({ message: `${target} demoted to user.` });
  });
});

// Get warnings for a user
app.get("/warnings/:username", authMiddleware, adminMiddleware, (req, res) => {
  warningsDB.find({ target: req.params.username }, (err, warnings) => {
    res.json(warnings);
  });
});

// Followers follow/unfollow (basic)
app.post("/follow", authMiddleware, (req, res) => {
  const { followee } = req.body;
  if (!followee) return res.status(400).json({ error: "Followee required." });
  if (followee === req.user.username) return res.status(400).json({ error: "Cannot follow yourself." });

  usersDB.update({ username: req.user.username }, { $addToSet: { following: followee } }, {}, () => {});
  usersDB.update({ username: followee }, { $addToSet: { followers: req.user.username } }, {}, (err) => {
    if (err) return res.status(500).json({ error: "Error following user." });
    res.json({ message: `You followed ${followee}.` });
  });
});

app.post("/unfollow", authMiddleware, (req, res) => {
  const { followee } = req.body;
  if (!followee) return res.status(400).json({ error: "Followee required." });

  usersDB.update({ username: req.user.username }, { $pull: { following: followee } }, {}, () => {});
  usersDB.update({ username: followee }, { $pull: { followers: req.user.username } }, {}, (err) => {
    if (err) return res.status(500).json({ error: "Error unfollowing user." });
    res.json({ message: `You unfollowed ${followee}.` });
  });
});

// Socket.IO real-time DM support
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("send_dm", (data) => {
    const { from, to, message } = data;
    if (!from || !to || !message) return;

    usersDB.findOne({ username: to }, (err, recipient) => {
      if (!recipient) return;

      const dm = {
        from,
        to,
        message,
        timestamp: new Date()
      };

      messagesDB.insert(dm, (err, newMsg) => {
        if (!err) {
          io.emit("dm", newMsg); // Broadcast to all (optimize later)
        }
      });
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`TapText backend running on port ${PORT}`);
});
