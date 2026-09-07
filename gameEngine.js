// gameEngine.js — كودسيبر (CodeSiber)
// محرك حالة نقي، متزامن بالكامل (بدون await داخل أي عملية تعديل حالة)
// لضمان عدم تعارض الكشف المتزامن على مستوى العملية الواحدة.

const fs = require("fs");
const path = require("path");

const WORD_BANKS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "words-bank.json"), "utf8")
);

const BOARD_SIZE = 25;
const TEAMS = ["red", "blue"];

const TIMER_PRESETS = {
  none: null,
  fast: 90 * 1000,
  medium: 150 * 1000,
  normal: 240 * 1000,
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createRoom(id, hostSocketId, hostName) {
  const token = genToken();
  return {
    id,
    createdAt: Date.now(),
    phase: "lobby", // lobby | playing | ended
    players: {
      [hostSocketId]: {
        name: hostName,
        team: null,
        role: null,
        connected: true,
        token,
      },
    },
    hostId: hostSocketId,
    hostToken: token,
    settings: {
      timerMode: "none", // none | fast | medium | normal
      category: "beginner", // beginner | advanced | khaliji | custom
      customWords: [],
    },
    board: [],
    startingTeam: null,
    turn: null,
    turnPhase: null, // 'clue' | 'guess'
    currentClue: null, // { word, count, revealedCount }
    turnDeadline: null, // ms epoch, أو null إذا بلا مؤقت
    winner: null,
    log: [],
    scores: { red: 0, blue: 0 },
    reactions: [], // آخر التفاعلات العائمة المرسلة (للبث فقط، لا تُخزَّن طويلًا)
  };
}

function addLog(room, text) {
  room.log.push({ text, ts: Date.now() });
  if (room.log.length > 300) room.log.shift();
}

function playerCounts(room) {
  const counts = {
    red: { spymaster: 0, operative: 0 },
    blue: { spymaster: 0, operative: 0 },
  };
  for (const p of Object.values(room.players)) {
    if (p.team && p.role && p.connected) counts[p.team][p.role]++;
  }
  return counts;
}

function findPlayerByToken(room, token) {
  return Object.entries(room.players).find(([, p]) => p.token === token);
}

function joinRoom(room, socketId, name, rejoinToken) {
  // إعادة اتصال: نفس اللاعب يعود بنفس الرمز المخزّن في متصفحه
  if (rejoinToken) {
    const found = findPlayerByToken(room, rejoinToken);
    if (found) {
      const [oldSocketId, player] = found;
      if (oldSocketId !== socketId) {
        room.players[socketId] = { ...player, connected: true };
        delete room.players[oldSocketId];
        if (room.hostId === oldSocketId) room.hostId = socketId;
      } else {
        player.connected = true;
      }
      addLog(room, `${room.players[socketId].name} عاد للاتصال`);
      return { ok: true, token: room.players[socketId].token, rejoined: true };
    }
  }
  const token = genToken();
  room.players[socketId] = { name: name || "لاعب", team: null, role: null, connected: true, token };
  addLog(room, `${room.players[socketId].name} انضم إلى الغرفة`);
  return { ok: true, token };
}

function setTeamRole(room, socketId, team, role) {
  const player = room.players[socketId];
  if (!player) return { error: "لاعب غير موجود" };
  if (room.phase === "playing") return { error: "لا يمكن تغيير الفريق أثناء اللعب" };
  if (!TEAMS.includes(team)) return { error: "فريق غير صالح" };
  if (!["spymaster", "operative"].includes(role)) return { error: "دور غير صالح" };

  const counts = playerCounts(room);
  const alreadyThatSpymaster = player.team === team && player.role === "spymaster";
  if (role === "spymaster" && counts[team].spymaster >= 1 && !alreadyThatSpymaster) {
    return { error: "هذا الفريق لديه مُلمّح بالفعل" };
  }

  player.team = team;
  player.role = role;
  addLog(room, `${player.name} أصبح ${role === "spymaster" ? "مُلمّح" : "عميل ميداني"} - فريق ${team === "red" ? "الأحمر" : "الأزرق"}`);
  return { ok: true };
}

function canStart(room) {
  const counts = playerCounts(room);
  return (
    counts.red.spymaster === 1 &&
    counts.blue.spymaster === 1 &&
    counts.red.operative >= 1 &&
    counts.blue.operative >= 1
  );
}

function updateSettings(room, socketId, settings) {
  if (socketId !== room.hostId) return { error: "فقط منشئ الغرفة يتحكم بالإعدادات" };
  if (room.phase === "playing") return { error: "لا يمكن تغيير الإعدادات أثناء اللعب" };
  if (settings.timerMode && TIMER_PRESETS[settings.timerMode] !== undefined) {
    room.settings.timerMode = settings.timerMode;
  }
  if (settings.category && ["beginner", "advanced", "khaliji", "custom"].includes(settings.category)) {
    room.settings.category = settings.category;
  }
  if (typeof settings.customWords === "string") {
    const list = settings.customWords
      .split(/[\n,،]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    room.settings.customWords = list;
  }
  return { ok: true };
}

function pickWordPool(room) {
  const cat = room.settings.category;
  if (cat === "custom") {
    if (room.settings.customWords.length < WORD_BANKS.custom_min_words) {
      return { error: `القائمة المخصصة تحتاج ${WORD_BANKS.custom_min_words} كلمة على الأقل (المُدخل حاليًا: ${room.settings.customWords.length})` };
    }
    return { pool: room.settings.customWords };
  }
  const pool = WORD_BANKS[cat];
  if (!pool || pool.length < BOARD_SIZE) return { error: "فئة الكلمات غير صالحة" };
  return { pool };
}

function buildBoard(pool) {
  const words = shuffle(pool).slice(0, BOARD_SIZE);
  const startingTeam = Math.random() < 0.5 ? "red" : "blue";
  const otherTeam = startingTeam === "red" ? "blue" : "red";
  const colors = shuffle([
    ...Array(9).fill(startingTeam),
    ...Array(8).fill(otherTeam),
    ...Array(7).fill("neutral"),
    "assassin",
  ]);
  const board = words.map((word, i) => ({ word, color: colors[i], revealed: false }));
  return { board, startingTeam };
}

function startTurnTimer(room) {
  const ms = TIMER_PRESETS[room.settings.timerMode];
  room.turnDeadline = ms ? Date.now() + ms : null;
}

function startGame(room, socketId) {
  if (socketId !== room.hostId) return { error: "فقط منشئ الغرفة يبدأ اللعبة" };
  if (!canStart(room)) {
    return { error: "يجب توفر 4 لاعبين على الأقل: مُلمّح واحد وعميل ميداني واحد لكل فريق" };
  }
  const poolRes = pickWordPool(room);
  if (poolRes.error) return { error: poolRes.error };

  const { board, startingTeam } = buildBoard(poolRes.pool);
  room.board = board;
  room.startingTeam = startingTeam;
  room.turn = startingTeam;
  room.turnPhase = "clue";
  room.currentClue = null;
  room.winner = null;
  room.phase = "playing";
  room.scores = {
    red: board.filter((c) => c.color === "red").length,
    blue: board.filter((c) => c.color === "blue").length,
  };
  room.log = [];
  addLog(room, `بدأت اللعبة! فريق ${startingTeam === "red" ? "الأحمر" : "الأزرق"} يبدأ أولًا`);
  startTurnTimer(room);
  return { ok: true };
}

// إعادة اللعب: نفس الفرق (يعيد بناء لوحة جديدة فقط) أو فرق مختلفة (يرجع الجميع للردهة)
function rematch(room, socketId, mode) {
  if (socketId !== room.hostId) return { error: "فقط منشئ الغرفة يبدأ إعادة اللعب" };
  if (room.phase !== "ended") return { error: "لا يمكن إعادة اللعب الآن" };

  if (mode === "same_teams") {
    return startGame(room, socketId);
  }
  if (mode === "new_teams") {
    for (const p of Object.values(room.players)) {
      p.team = null;
      p.role = null;
    }
    room.phase = "lobby";
    room.board = [];
    room.turn = null;
    room.turnPhase = null;
    room.currentClue = null;
    room.turnDeadline = null;
    room.winner = null;
    room.log = [];
    addLog(room, "تمت إعادة الضبط - اختاروا فرقكم من جديد");
    return { ok: true };
  }
  return { error: "خيار إعادة لعب غير صالح" };
}

function giveClue(room, socketId, word, count) {
  const player = room.players[socketId];
  if (!player) return { error: "لاعب غير موجود" };
  if (room.phase !== "playing") return { error: "اللعبة لم تبدأ" };
  if (player.team !== room.turn || player.role !== "spymaster") {
    return { error: "ليس دورك لإعطاء تلميح" };
  }
  if (room.turnPhase !== "clue") return { error: "لا يمكن إعطاء تلميح الآن" };
  if (!word || typeof count !== "number" || count < 0 || count > 9) {
    return { error: "تلميح غير صالح" };
  }

  // مرجعية عدد الكلمات: المُلمّح هو من يقرر الحد الأقصى (بدون تخمين إضافي مجاني)
  room.currentClue = { word, count, revealedCount: 0 };
  room.turnPhase = "guess";
  addLog(room, `مُلمّح فريق ${room.turn === "red" ? "الأحمر" : "الأزرق"} أعطى تلميح: "${word}" (${count})`);
  return { ok: true };
}

function endTurn(room, socketId, isTimeout = false) {
  if (!isTimeout) {
    const player = room.players[socketId];
    if (!player) return { error: "لاعب غير موجود" };
    if (room.phase !== "playing") return { error: "اللعبة لم تبدأ" };
    if (player.team !== room.turn) return { error: "ليس دورك" };
  }

  room.turn = room.turn === "red" ? "blue" : "red";
  room.turnPhase = "clue";
  room.currentClue = null;
  addLog(room, isTimeout
    ? `انتهى الوقت! الدور الآن لفريق ${room.turn === "red" ? "الأحمر" : "الأزرق"}`
    : `انتهى الدور. الآن دور فريق ${room.turn === "red" ? "الأحمر" : "الأزرق"}`
  );
  startTurnTimer(room);
  return { ok: true };
}

function revealWord(room, socketId, index) {
  const player = room.players[socketId];
  if (!player) return { error: "لاعب غير موجود" };
  if (room.phase !== "playing") return { error: "اللعبة لم تبدأ" };
  if (player.team !== room.turn || player.role !== "operative") {
    return { error: "ليس دورك للكشف" };
  }
  if (room.turnPhase !== "guess") return { error: "لا يوجد تلميح حاليًا" };
  const cell = room.board[index];
  if (!cell) return { error: "خلية غير صالحة" };
  if (cell.revealed) return { error: "هذه الكلمة مكشوفة بالفعل" };
  // لا يجوز اختيار أكثر من العدد الذي حدده المُلمّح
  if (room.currentClue.revealedCount >= room.currentClue.count) {
    return { error: "وصلت للحد الأقصى من الكلمات المسموح بفتحها لهذا التلميح" };
  }

  cell.revealed = true;
  addLog(room, `${player.name} كشف كلمة "${cell.word}"`);

  if (cell.color === "assassin") {
    room.phase = "ended";
    room.winner = room.turn === "red" ? "blue" : "red";
    room.turnDeadline = null;
    addLog(room, `بطاقة القاتل! فريق ${room.turn === "red" ? "الأحمر" : "الأزرق"} خسر فورًا`);
    return { ok: true, revealedColor: cell.color };
  }

  if (cell.color === room.turn) {
    room.scores[room.turn]--;
    room.currentClue.revealedCount++;
    if (checkWin(room)) return { ok: true, revealedColor: cell.color };
    // بلغ الفريق العدد المطلوب بالضبط -> ينتقل الدور مباشرة تلقائيًا
    if (room.currentClue.revealedCount >= room.currentClue.count) {
      endTurn(room, socketId);
    }
    return { ok: true, revealedColor: cell.color };
  }

  // لون محايد أو لون الفريق الآخر -> ينهي الدور فورًا
  if (cell.color !== "neutral") {
    room.scores[cell.color]--;
    checkWin(room);
  }
  if (room.phase === "playing") endTurn(room, socketId);
  return { ok: true, revealedColor: cell.color };
}

function checkWin(room) {
  if (room.scores.red <= 0) {
    room.phase = "ended";
    room.winner = "red";
    room.turnDeadline = null;
    addLog(room, "فريق الأحمر كشف كل كلماته وفاز!");
    return true;
  }
  if (room.scores.blue <= 0) {
    room.phase = "ended";
    room.winner = "blue";
    room.turnDeadline = null;
    addLog(room, "فريق الأزرق كشف كل كلماته وفاز!");
    return true;
  }
  return false;
}

function addReaction(room, socketId, emoji) {
  const player = room.players[socketId];
  if (!player) return;
  const allowed = ["🔥", "🤦‍♂️", "🧠", "😱"];
  if (!allowed.includes(emoji)) return;
  room.reactions.push({ emoji, ts: Date.now(), id: genToken() });
  if (room.reactions.length > 20) room.reactions.shift();
}

// يبني نسخة من الحالة مخصّصة لكل لاعب حسب دوره - المرشد فقط يرى الألوان غير المكشوفة
function getViewForSocket(room, socketId) {
  const me = room.players[socketId] || {};
  const isSpymaster = me.role === "spymaster";

  const board = room.board.map((cell) => {
    if (cell.revealed || isSpymaster) {
      return { word: cell.word, color: cell.color, revealed: cell.revealed };
    }
    return { word: cell.word, color: null, revealed: false };
  });

  return {
    id: room.id,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [
        id,
        { name: p.name, team: p.team, role: p.role, connected: p.connected },
      ])
    ),
    board,
    turn: room.turn,
    turnPhase: room.turnPhase,
    currentClue: room.currentClue,
    turnDeadline: room.turnDeadline,
    winner: room.winner,
    scores: room.scores,
    log: room.log.slice(-60),
    reactions: room.reactions.slice(-10),
    you: { id: socketId, team: me.team, role: me.role, name: me.name, isHost: socketId === room.hostId },
  };
}

module.exports = {
  createRoom,
  joinRoom,
  setTeamRole,
  canStart,
  updateSettings,
  startGame,
  rematch,
  giveClue,
  endTurn,
  revealWord,
  addReaction,
  getViewForSocket,
  playerCounts,
  TIMER_PRESETS,
};
