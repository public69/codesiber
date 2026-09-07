const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const GameEngine = require('./gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// إعداد خادم الملفات الثابتة من مجلد public
app.use(express.static(__dirname));
// تحميل بنك الكلمات من ملف words-bank.json
let wordBank = [];
try {
  const wordsData = fs.readFileSync(path.join(__dirname, 'words-bank.json'), 'utf8');
  wordBank = JSON.parse(wordsData);
  console.log(`[WordBank] Successfully loaded ${wordBank.length} words.`);
} catch (error) {
  console.error('[WordBank Error] Failed to load words-bank.json:', error.message);
  wordBank = ["شمس", "قمر", "نجم", "بحر", "جبل", "شجرة", "نهر", "سماء", "أرض", "سحاب", "ورق", "قلم", "كتاب", "سيف", "درع", "تاج", "ملك", "قلعة", "ذهب", "فضة", "حديد", "نار", "ماء", "هواء", "تراب"];
}

// تخزين حالات الغرف النشطة
const rooms = {};

// إدارة اتصالات Socket.io
io.on('connection', (socket) => {
  console.log(`[Socket] New connection: ${socket.id}`);

  // إنشاء غرفة جديدة أو الانضمام لغرفة قائمة
  socket.on('joinRoom', ({ roomId, playerName, role, team }) => {
    if (!roomId || !playerName) {
      return socket.emit('errorMsg', 'يرجى تقديم اسم اللاعب ورمز الغرفة بشكل صحيح.');
    }

    const cleanRoomId = roomId.trim().toUpperCase();
    socket.join(cleanRoomId);

    // إذا لم تكن الغرفة موجودة، قم بإنشائها
    if (!rooms[cleanRoomId]) {
      rooms[cleanRoomId] = new GameEngine(cleanRoomId, wordBank);
      console.log(`[Room Created] Room ID: ${cleanRoomId}`);
    }

    const game = rooms[cleanRoomId];
    const player = game.addPlayer(socket.id, playerName, team || 'red', role || 'operative');

    socket.data.roomId = cleanRoomId;
    socket.data.playerId = socket.id;

    // إرسال حالة الغرفة المحدثة للجميع
    io.to(cleanRoomId).emit('roomState', game.getPublicState(socket.id));
    console.log(`[Player Joined] ${playerName} joined room ${cleanRoomId}`);
  });

  // تغيير فريق أو دور اللاعب
  socket.on('updateRole', ({ team, role }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const game = rooms[roomId];
    game.updatePlayerRole(socket.id, team, role);
    
    // إعادة إرسال الحالة المحدثة لجميع أفراد الغرفة
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets) {
      for (const sId of roomSockets) {
        const clientSocket = io.sockets.sockets.get(sId);
        if (clientSocket) {
          clientSocket.emit('roomState', game.getPublicState(sId));
        }
      }
    }
  });

  // تقديم تلميح من قبل رئيس الجواسيس
  socket.on('giveClue', ({ word, count }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const game = rooms[roomId];
    const result = game.submitClue(socket.id, word, count);

    if (result.error) {
      return socket.emit('errorMsg', result.error);
    }

    broadcastRoomState(roomId);
  });

  // كشف/تخمين كلمة
  socket.on('revealCard', ({ cardIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const game = rooms[roomId];
    const result = game.revealCard(socket.id, cardIndex);

    if (result.error) {
      return socket.emit('errorMsg', result.error);
    }

    // بث التفاعل الحي عند كشف الكلمة
    if (result.card) {
      io.to(roomId).emit('emojiReaction', {
        cardIndex,
        emoji: result.isCorrect ? '🔥' : (result.isAssassin ? '💀' : '🤦‍♂️')
      });
    }

    broadcastRoomState(roomId);
  });

  // إنهاء الدور اختيارياً
  socket.on('endTurn', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const game = rooms[roomId];
    game.endTurn(socket.id);
    broadcastRoomState(roomId);
  });

  // إرسال تفاعل إيموجي يدوي
  socket.on('sendReaction', ({ cardIndex, emoji }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    io.to(roomId).emit('emojiReaction', { cardIndex, emoji });
  });

  // إعادة بدء اللعبة
  socket.on('restartGame', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const game = rooms[roomId];
    game.restart(wordBank);
    broadcastRoomState(roomId);
  });

  // عند قطع الاتصال
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const game = rooms[roomId];
      game.removePlayer(socket.id);

      // إذا أصبحت الغرفة فارغة، قم بحذفها لتوفير الذاكرة
      if (Object.keys(game.players).length === 0) {
        delete rooms[roomId];
        console.log(`[Room Deleted] Room ID: ${roomId} is empty.`);
      } else {
        broadcastRoomState(roomId);
      }
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// دالة مسبورة لبث حالة الغرفة المخصصة لكل شخص حسب دوره
function broadcastRoomState(roomId) {
  const game = rooms[roomId];
  if (!game) return;

  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (roomSockets) {
    for (const sId of roomSockets) {
      const clientSocket = io.sockets.sockets.get(sId);
      if (clientSocket) {
        clientSocket.emit('roomState', game.getPublicState(sId));
      }
    }
  }
}

// تشغيل الخادم
server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`[Server Running] http://localhost:${PORT}`);
  console.log(`========================================`);
});
