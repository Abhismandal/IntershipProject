const http = require("http");
const express = require("express");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index1.html"));
});

// --- MongoDB setup ---
mongoose
  .connect('mongodb://127.0.0.1:27017/mydb')
  .then(() => {
    console.log("✅ MongoDB connected successfully!");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

const messageSchema = new mongoose.Schema({
  from: String,
  to: String, // null or empty for group message
  message: String,
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// Users management
const users = new Map(); // username -> socket.id
const socketToUser = new Map(); // socket.id -> username

io.on("connection", async (socket) => {
  console.log("A user connected");

  // Send last 20 messages on connect (both group and private involving this user)
  // For private messages, we send only those that involve this user (as from or to)
  const username = socketToUser.get(socket.id);

  const recentMessages = await Message.find({})
    .sort({ timestamp: 1 })
    .limit(50)
    .exec();

  // We'll send only group messages and private messages involving this socket user once username is set

  // But since username might not be set yet, just send group messages first
  recentMessages.forEach((msg) => {
    if (!msg.to) {
      socket.emit("group message", {
        from: msg.from,
        message: msg.message,
      });
    }
  });

  socket.on("set username", (username) => {
    users.set(username, socket.id);
    socketToUser.set(socket.id, username);
    console.log(`User set: ${username} with socket id ${socket.id}`);

    // Now send private messages involving this user
    Message.find({
      $or: [{ from: username }, { to: username }],
    })
      .sort({ timestamp: 1 })
      .limit(50)
      .exec()
      .then((msgs) => {
        msgs.forEach((msg) => {
          socket.emit("private message", {
            from: msg.from,
            to: msg.to,
            message: msg.message,
          });
        });
      });

    io.emit("online status", { user: username, status: "online" });
    io.emit("update online users", [...users.keys()]);
  });

  socket.on("group message", async ({ from, message }) => {
    const msgDoc = new Message({ from, to: null, message });
    await msgDoc.save();

    io.emit("group message", { from, message });
  });

  socket.on("private message", async ({ from, to, message }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      const msgDoc = new Message({ from, to, message });
      await msgDoc.save();

      io.to(targetSocketId).emit("private message", { from, to, message });
      socket.emit("private message", { from, to, message });
    } else {
      socket.emit("user not found", to);
    }
  });

  socket.on("read receipt", ({ from, to }) => {
    const senderSocketId = users.get(to);
    if (senderSocketId) {
      io.to(senderSocketId).emit("read receipt", { from, to: from });
    }
  });

  socket.on("disconnect", () => {
    const username = socketToUser.get(socket.id);
    if (username) {
      users.delete(username);
      socketToUser.delete(socket.id);
      console.log(`User disconnected: ${username}`);
      io.emit("online status", { user: username, status: "offline" });
      io.emit("update online users", [...users.keys()]);
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

