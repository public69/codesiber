const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// استدعاء محرك اللعبة بحماية
let GameEngine;
try {
  GameEngine = require('./gameEngine');
} catch (e) {
  console.error('Error loading gameEngine:', e.message);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// إعداد المنفذ والعنوان المباشر لبيئة Render
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

// تقديم الملفات الستاتيكية
app.use(express.static(__dirname));

// بنك الكلمات الاحتياطي
let wordBank = ["شمس", "قمر", "نجم", "بحر", "جبل", "شجرة", "نهر", "سماء", "أرض", "سحاب", "ورق", "قلم", "كتاب", "سيف", "درع", "تاج", "ملك", "قلعة", "ذهب", "فضة", "حديد", "نار", "ماء", "هواء", "تراب"];

try {
  const wordsPath = path.join(__dirname, 'words-bank.json');
  if (fs.existsSync(wordsPath)) {
    const wordsData = fs.readFileSync(wordsPath, 'utf8');
    wordBank = JSON.parse(wordsData);
    console.log(`[WordBank] Successfully loaded ${wordBank.length} words.`);
  }
} catch (error) {
  console.error('[WordBank Error] Fallback triggered:', error.message);
}

const rooms = {};

// مسار رئيسي لتأكيد عمل السيرفر
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('createRoom', (data, callback) => {
    const playerName = (data && (data.playerName || data.name)) || "لاعب";
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    if (GameEngine) {
      rooms[roomId] = new GameEngine(roomId, wordBank);
      rooms[roomId].addPlayer(socket.id, playerName);
    }
    
    socket.join(roomId);
    
    const response = { 
      roomId, 
      token: socket.id, 
      playerName, 
      gameState: rooms[roomId] ? rooms[roomId].getState() : {} 
    };
    
    if (typeof callback === 'function') callback(response);
    socket.emit('roomCreated', response);
    
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  socket.on('joinRoom', (data, callback) => {
    const roomId = data && data.roomId ? data.roomId.toUpperCase() : null;
    const playerName = (data && (data.playerName || data.name)) || "لاعب";
    
    const room = rooms[roomId];
    if (!room) {
      const err = { error: 'الغرفة غير موجودة' };
      if (typeof callback === 'function') callback(err);
      socket.emit('error', 'الغرفة غير موجودة');
      return;
    }
    
    socket.join(roomId);
    room.addPlayer(socket.id, playerName);
    
    const response = { roomId, token: socket.id, playerName };
    if (typeof callback === 'function') callback(response);
    
    io.to(roomId).emit('roomState', room.getState ? room.getState() : {});
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
