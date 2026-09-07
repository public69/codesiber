// server.js — كودسيبر
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const engine = require("./gameEngine");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};
const timers = {}; // roomId -> Timeout (لتشغيل نهاية الدور تلقائيًا عند انتهاء المؤقت)

function genRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do {
    id = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms[id]);
  return id;
}

function clearRoomTimer(roomId) {
  if (timers[roomId]) {
    clearTimeout(timers[roomId]);
    delete timers[roomId];
  }
}

function scheduleRoomTimer(roomId) {
  clearRoomTimer(roomId);
  const room = rooms[roomId];
  if (!room || !room.turnDeadline || room.phase !== "playing") return;
  const delay = Math.max(0, room.turnDeadline - Date.now());
  timers[roomId] = setTimeout(() => {
    const r = rooms[roomId];
    if (!r || r.phase !== "playing") return;
    engine.endTurn(r, null, true);
    broadcastRoom(roomId);
    scheduleRoomTimer(roomId); // يجدول مؤقت الدور التالي تلقائيًا
  }, delay);
}

function broadcastRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  for (const socketId of Object.keys(room.players)) {
    const sock = io.sockets.sockets.get(socketId);
    if (sock) sock.emit("roomState", engine.getViewForSocket(room, socketId));
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }, cb) => {
    const roomId = genRoomId();
    const room = engine.createRoom(roomId, socket.id, name || "لاعب");
    rooms[roomId] = room;
    socket.join(roomId);
    socket.data.roomId = roomId;
    cb && cb({ ok: true, roomId, token: room.hostToken });
    broadcastRoom(roomId);
  });

  socket.on("joinRoom", ({ roomId, name, token }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ error: "الغرفة غير موجودة" });
    const res = engine.joinRoom(room, socket.id, name, token);
    socket.join(roomId);
    socket.data.roomId = roomId;
    cb && cb({ ok: true, roomId, token: res.token, rejoined: !!res.rejoined });
    broadcastRoom(roomId);
    if (room.turnDeadline) scheduleRoomTimer(roomId); // لو المؤقت شغال، نتأكد الجدولة مستمرة
  });

  socket.on("setTeamRole", ({ team, role }, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.setTeamRole(room, socket.id, team, role);
    cb && cb(res);
    if (res.ok) broadcastRoom(room.id);
  });

  socket.on("updateSettings", (settings, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.updateSettings(room, socket.id, settings);
    cb && cb(res);
    if (res.ok) broadcastRoom(room.id);
  });

  socket.on("startGame", (_, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.startGame(room, socket.id);
    cb && cb(res);
    if (res.ok) {
      broadcastRoom(room.id);
      scheduleRoomTimer(room.id);
    }
  });

  socket.on("rematch", ({ mode }, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.rematch(room, socket.id, mode);
    cb && cb(res);
    if (res.ok) {
      broadcastRoom(room.id);
      if (room.phase === "playing") scheduleRoomTimer(room.id);
      else clearRoomTimer(room.id);
    }
  });

  socket.on("giveClue", ({ word, count }, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.giveClue(room, socket.id, word, count);
    cb && cb(res);
    if (res.ok) broadcastRoom(room.id);
    // ملاحظة: لا نعيد جدولة المؤقت هنا عمدًا - المؤقت يغطي التلميح
    // والتخمين معًا ضمن نفس الدور (كما طلب المستخدم)، فلا يُعاد تصفيره.
  });

  socket.on("revealWord", ({ index }, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.revealWord(room, socket.id, index);
    cb && cb(res);
    if (res.ok) {
      broadcastRoom(room.id);
      scheduleRoomTimer(room.id); // إن انتهى الدور ضمنيًا هنا، نعيد جدولة مؤقت الدور الجديد
    }
  });

  socket.on("endTurn", (_, cb) => {
    const room = rooms[socket.data.roomId];
    if (!room) return cb && cb({ error: "لست داخل غرفة" });
    const res = engine.endTurn(room, socket.id, false);
    cb && cb(res);
    if (res.ok) {
      broadcastRoom(room.id);
      scheduleRoomTimer(room.id);
    }
  });

  socket.on("reaction", ({ emoji }) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    engine.addReaction(room, socket.id, emoji);
    broadcastRoom(room.id);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[socket.id]) room.players[socket.id].connected = false;
    broadcastRoom(roomId);
    setTimeout(() => {
      const r = rooms[roomId];
      if (!r) return;
      const anyConnected = Object.values(r.players).some((p) => p.connected);
      if (!anyConnected) {
        clearRoomTimer(roomId);
        delete rooms[roomId];
      }
    }, 5 * 60 * 1000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`كودسيبر يعمل على http://localhost:${PORT}`);
});
