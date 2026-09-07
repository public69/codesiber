const socket = io();

let myName = "";
let currentRoomId = null;
let lastState = null;
let myPendingTeam = null, myPendingRole = null; // آخر اختيار محلي (لتلوين الأزرار قبل وصول التحديث)
let selectedCategory = "beginner";
let selectedTimer = "none";
let timerInterval = null;

const $ = (id) => document.getElementById(id);

function show(sectionId) {
  ["landing", "lobby", "game", "ended"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== sectionId);
  });
}

// ---------- استعادة الجلسة عبر localStorage (إعادة الاتصال التلقائي) ----------
function saveSession(roomId, token, name) {
  try {
    localStorage.setItem("codesiber_session", JSON.stringify({ roomId, token, name }));
  } catch (e) {}
}
function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("codesiber_session") || "null");
  } catch (e) {
    return null;
  }
}
function clearSession() {
  try { localStorage.removeItem("codesiber_session"); } catch (e) {}
}

// ---------- رابط مباشر Deep Link: ?room=XXXXX ----------
(function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  const rid = params.get("room");
  if (rid) $("roomInput").value = rid.toUpperCase();
})();

// ---------- محاولة إعادة الاتصال التلقائي عند التحميل ----------
(function tryAutoReconnect() {
  const session = loadSession();
  if (!session) return;
  myName = session.name;
  socket.emit("joinRoom", { roomId: session.roomId, name: session.name, token: session.token }, (res) => {
    if (res.error) { clearSession(); return; }
    currentRoomId = session.roomId;
    saveSession(session.roomId, res.token, session.name);
    $("landing").classList.add("hidden");
    $("roomBadge").classList.remove("hidden");
    $("roomBadge").textContent = currentRoomId;
  });
})();

// ---------- شاشة الدخول ----------
$("createBtn").onclick = () => {
  myName = $("nameInput").value.trim() || "لاعب";
  socket.emit("createRoom", { name: myName }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    currentRoomId = res.roomId;
    saveSession(res.roomId, res.token, myName);
    $("roomBadge").classList.remove("hidden");
    $("roomBadge").textContent = currentRoomId;
  });
};

$("joinBtn").onclick = () => {
  myName = $("nameInput").value.trim() || "لاعب";
  const roomId = $("roomInput").value.trim().toUpperCase();
  if (!roomId) return ($("landingError").textContent = "أدخل رمز الغرفة");
  socket.emit("joinRoom", { roomId, name: myName }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    currentRoomId = res.roomId;
    saveSession(res.roomId, res.token, myName);
    $("roomBadge").classList.remove("hidden");
    $("roomBadge").textContent = currentRoomId;
  });
};

// ---------- اختيار الفريق والدور ----------
document.querySelectorAll(".role-btn").forEach((btn) => {
  btn.onclick = () => {
    socket.emit("setTeamRole", { team: btn.dataset.team, role: btn.dataset.role }, (res) => {
      if (res.error) $("lobbyError").textContent = res.error;
      else $("lobbyError").textContent = "";
    });
  };
});

// ---------- إعدادات المضيف ----------
$("categorySelect").onchange = (e) => {
  selectedCategory = e.target.value;
  $("customWordsBox").classList.toggle("hidden", selectedCategory !== "custom");
  pushSettings();
};
$("customWordsBox").addEventListener("blur", () => pushSettings());
document.querySelectorAll(".timer-btn").forEach((btn) => {
  btn.onclick = () => {
    selectedTimer = btn.dataset.timer;
    document.querySelectorAll(".timer-btn").forEach((b) => b.classList.toggle("active", b === btn));
    pushSettings();
  };
});
function pushSettings() {
  socket.emit("updateSettings", {
    category: selectedCategory,
    timerMode: selectedTimer,
    customWords: $("customWordsBox").value,
  }, () => {});
}

$("startBtn").onclick = () => {
  socket.emit("startGame", {}, (res) => {
    if (res.error) $("lobbyError").textContent = res.error;
  });
};

// ---------- التلميح والكشف ----------
$("giveClueBtn").onclick = () => {
  const word = $("clueWord").value.trim();
  const count = parseInt($("clueCount").value, 10);
  if (!word || isNaN(count)) return;
  socket.emit("giveClue", { word, count }, (res) => {
    if (!res.error) { $("clueWord").value = ""; $("clueCount").value = ""; }
  });
};
$("endTurnBtn").onclick = () => socket.emit("endTurn", {});

// ---------- ردود الفعل العائمة ----------
document.querySelectorAll(".reaction-btn").forEach((btn) => {
  btn.onclick = () => socket.emit("reaction", { emoji: btn.dataset.emoji });
});
function spawnFloatingEmoji(emoji) {
  const layer = $("floatingLayer");
  const el = document.createElement("div");
  el.className = "floating-emoji";
  el.textContent = emoji;
  el.style.right = (10 + Math.random() * 70) + "%";
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}
let lastReactionId = null;

// ---------- سجل الحركات ----------
$("historyBtn").onclick = () => $("historyPanel").classList.remove("hidden");
$("closeHistory").onclick = () => $("historyPanel").classList.add("hidden");

// ---------- إعادة اللعب ----------
$("rematchSameBtn").onclick = () => socket.emit("rematch", { mode: "same_teams" }, () => {});
$("rematchNewBtn").onclick = () => socket.emit("rematch", { mode: "new_teams" }, () => {});

// ---------- استقبال حالة الغرفة ----------
socket.on("roomState", (state) => {
  lastState = state;
  render(state);
});

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function render(state) {
  if (state.phase === "lobby") renderLobby(state);
  else if (state.phase === "playing") renderGame(state);
  else if (state.phase === "ended") renderEnded(state);

  // ردود الفعل العائمة الجديدة
  if (state.reactions && state.reactions.length) {
    const last = state.reactions[state.reactions.length - 1];
    if (last.id !== lastReactionId) {
      lastReactionId = last.id;
      if (document.getElementById("game").classList.contains("hidden") === false) {
        spawnFloatingEmoji(last.emoji);
      }
    }
  }
}

function renderLobby(state) {
  show("lobby");
  clearInterval(timerInterval);

  const redList = $("redPlayers"), blueList = $("bluePlayers");
  redList.innerHTML = ""; blueList.innerHTML = "";
  Object.values(state.players).forEach((p) => {
    const label = `${p.name} ${p.role === "spymaster" ? "🧠" : p.role === "operative" ? "🎯" : ""}${p.connected ? "" : " (غير متصل)"}`;
    if (p.team === "red") redList.innerHTML += `<li>${label}</li>`;
    else if (p.team === "blue") blueList.innerHTML += `<li>${label}</li>`;
  });

  document.querySelectorAll(".role-btn").forEach((btn) => {
    const isMine = state.you.team === btn.dataset.team && state.you.role === btn.dataset.role;
    btn.classList.toggle("active-red", isMine && btn.dataset.team === "red");
    btn.classList.toggle("active-blue", isMine && btn.dataset.team === "blue");
  });

  $("hostSettings").classList.toggle("hidden", !state.you.isHost);
  if (state.you.isHost) {
    $("categorySelect").value = state.settings.category;
    selectedCategory = state.settings.category;
    $("customWordsBox").classList.toggle("hidden", selectedCategory !== "custom");
    document.querySelectorAll(".timer-btn").forEach((b) => b.classList.toggle("active", b.dataset.timer === state.settings.timerMode));
    selectedTimer = state.settings.timerMode;
  }

  const counts = { red: { spymaster: 0, operative: 0 }, blue: { spymaster: 0, operative: 0 } };
  Object.values(state.players).forEach((p) => { if (p.team && p.role) counts[p.team][p.role]++; });
  const ready = counts.red.spymaster === 1 && counts.blue.spymaster === 1 && counts.red.operative >= 1 && counts.blue.operative >= 1;

  $("startBtn").classList.toggle("hidden", !state.you.isHost);
  $("startBtn").disabled = !ready;
  $("lobbyStatus").textContent = ready
    ? "الفرق جاهزة — يمكن للمضيف بدء اللعبة"
    : "يجب توفر مُلمّح واحد وعميل ميداني واحد على الأقل لكل فريق (4 لاعبين كحد أدنى)";
}

function renderGame(state) {
  show("game");
  const me = state.you;
  const isSpymasterTurn = me.role === "spymaster" && me.team === state.turn && state.turnPhase === "clue";
  const isOperativeTurn = me.role === "operative" && me.team === state.turn && state.turnPhase === "guess";

  $("turnIndicator").textContent = `دور فريق ${state.turn === "red" ? "الأحمر 🔴" : "الأزرق 🔵"} — ${state.turnPhase === "clue" ? "بانتظار التلميح" : "بانتظار الاختيار"}`;
  $("scoreRed").textContent = state.scores.red;
  $("scoreBlue").textContent = state.scores.blue;

  clearInterval(timerInterval);
  if (state.turnDeadline) {
    $("timerPill").classList.remove("hidden");
    const tick = () => {
      const remain = state.turnDeadline - Date.now();
      $("timerPill").textContent = fmtTime(remain);
      $("timerPill").classList.toggle("urgent", remain < 15000);
    };
    tick();
    timerInterval = setInterval(tick, 500);
  } else {
    $("timerPill").classList.add("hidden");
  }

  if (state.currentClue) {
    $("clueBar").classList.remove("hidden");
    const remaining = state.currentClue.count - state.currentClue.revealedCount;
    $("clueBar").textContent = `التلميح: "${state.currentClue.word}" (${state.currentClue.count}) — تبقّى ${remaining} للفريق`;
  } else {
    $("clueBar").classList.add("hidden");
  }

  $("clueForm").classList.toggle("hidden", !isSpymasterTurn);
  $("endTurnBtn").classList.toggle("hidden", !isOperativeTurn);
  $("reactionsRow").querySelectorAll(".reaction-btn").forEach(b => b.classList.remove("hidden"));

  const board = $("board");
  board.innerHTML = "";
  state.board.forEach((cell, i) => {
    const div = document.createElement("div");
    div.className = "cell";
    div.textContent = cell.word;
    if (cell.revealed) {
      div.classList.add("revealed", `color-${cell.color}`);
    } else if (me.role === "spymaster" && cell.color) {
      if (cell.color !== "neutral") div.classList.add(`spy-hint-${cell.color}`);
    }
    if (!cell.revealed && isOperativeTurn) {
      div.onclick = () => socket.emit("revealWord", { index: i }, () => {});
    }
    board.appendChild(div);
  });

  $("log").innerHTML = state.log.map((l) => `<div>${l.text}</div>`).join("");
}

function renderEnded(state) {
  show("ended");
  clearInterval(timerInterval);
  $("winnerTeamText").textContent = `فاز فريق ${state.winner === "red" ? "الأحمر 🔴" : "الأزرق 🔵"}`;
  $("winBadge").style.setProperty("--w", state.winner === "red" ? "var(--red)" : "var(--blue)");

  const board = $("finalBoard");
  board.innerHTML = "";
  state.board.forEach((cell) => {
    const div = document.createElement("div");
    div.className = `cell revealed color-${cell.color || "neutral"}`;
    div.textContent = cell.word;
    board.appendChild(div);
  });

  $("rematchButtons").classList.toggle("hidden", !state.you.isHost);
  $("waitHostText").classList.toggle("hidden", !!state.you.isHost);
}
