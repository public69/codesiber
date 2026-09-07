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

// خدمة الملفات من المجلد الحالي مباشرة
app.use(express.static(__dirname));

// تحميل بنك الكلمات بأمان مع خيار احتياطي
let wordBank = ["شمس", "قمر", "نجم", "بحر", "جبل", "شجرة", "نهر", "سماء", "أرض", "سحاب", "ورق", "قلم", "كتاب", "سيف", "درع", "تاج", "ملك", "قلعة", "ذهب", "فضة", "حديد", "نار", "ماء", "هواء", "تراب"];

try {
  const wordsPath = path.join(__dirname, 'words-bank.json');
  if (fs.existsSync(wordsPath)) {
    const wordsData = fs.readFileSync(wordsPath, 'utf8');
    wordBank = JSON.parse(wordsData);
    console.log(`[WordBank] Successfully loaded ${wordBank.length} words.`);
  }
} catch (error) {
  console.error('[WordBank Error] Failed to load JSON, using fallback:', error.message);
}

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('createRoom', ({ playerName }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = new GameEngine(roomId, wordBank);
    
    socket.join(roomId);
    const player = rooms[roomId].addPlayer(socket.id, playerName);
    
    socket.emit('roomCreated', { roomId, gameState: rooms[roomId].getState(), playerId: socket.id });
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', 'الغرفة غير موجودة');
      return;
    }
    socket.join(roomId);
    const player = room.addPlayer(socket.id, playerName);
    io.to(roomId).emit('gameStateUpdate', room.getState());
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
