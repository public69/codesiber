const socket = io();

let myName = "";
let currentRoomId = null;
let lastState = null;
let myPendingTeam = null, myPendingRole = null;
let selectedCategory = "beginner";
let selectedTimer = "none";
let timerInterval = null;

const $ = (id) => document.getElementById(id);

function show(sectionId) {
  ["landing", "lobby", "game", "ended"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.toggle("hidden", id !== sectionId);
  });
}

// ---------- استعادة الجلسة عبر localStorage ----------
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

// ---------- رابط مباشر Deep Link ----------
(function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  const rid = params.get("room");
  if (rid && $("roomInput")) $("roomInput").value = rid.toUpperCase();
})();

// ---------- محاولة إعادة الاتصال التلقائي ----------
(function tryAutoReconnect() {
  const session = loadSession();
  if (!session) return;
  myName = session.name;
  socket.emit("joinRoom", { roomId: session.roomId, playerName: session.name, name: session.name, token: session.token }, (res) => {
    if (res && res.error) { clearSession(); return; }
    currentRoomId = session.roomId;
    if (res && res.token) saveSession(session.roomId, res.token, session.name);
    if ($("landing")) $("landing").classList.add("hidden");
    if ($("roomBadge")) {
      $("roomBadge").classList.remove("hidden");
      $("roomBadge").textContent = currentRoomId;
    }
  });
})();

// ---------- شاشة الدخول ----------
if ($("createBtn")) {
  $("createBtn").onclick = () => {
    myName = ($("nameInput") ? $("nameInput").value.trim() : "") || "لاعب";
    socket.emit("createRoom", { playerName: myName, name: myName }, (res) => {
      if (res && res.error) {
        if ($("landingError")) $("landingError").textContent = res.error;
        return;
      }
      if (res && res.roomId) {
        currentRoomId = res.roomId;
        saveSession(res.roomId, res.token || "", myName);
        if ($("roomBadge")) {
          $("roomBadge").classList.remove("hidden");
          $("roomBadge").textContent = currentRoomId;
        }
      }
    });
  };
}

if ($("joinBtn")) {
  $("joinBtn").onclick = () => {
    myName = ($("nameInput") ? $("nameInput").value.trim() : "") || "لاعب";
    const roomId = $("roomInput") ? $("roomInput").value.trim().toUpperCase() : "";
    if (!roomId) {
      if ($("landingError")) $("landingError").textContent = "أدخل رمز الغرفة";
      return;
    }
    socket.emit("joinRoom", { roomId, playerName: myName, name: myName }, (res) => {
      if (res && res.error) {
        if ($("landingError")) $("landingError").textContent = res.error;
        return;
      }
      currentRoomId = roomId;
      if (res && res.token) saveSession(roomId, res.token, myName);
      if ($("roomBadge")) {
        $("roomBadge").classList.remove("hidden");
        $("roomBadge").textContent = currentRoomId;
      }
    });
  };
}

// ---------- استقبال أحداث الإنشاء والانضمام المباشرة ----------
socket.on("roomCreated", (data) => {
  if (data && data.roomId) {
    currentRoomId = data.roomId;
    if ($("roomBadge")) {
      $("roomBadge").classList.remove("hidden");
      $("roomBadge").textContent = currentRoomId;
    }
    show("lobby");
  }
});

socket.on("error", (msg) => {
  if ($("landingError")) $("landingError").textContent = msg;
  if ($("lobbyError")) $("lobbyError").textContent = msg;
});

// ---------- اختيار الفريق والدور ----------
document.querySelectorAll(".role-btn").forEach((btn) => {
  btn.onclick = () => {
    socket.emit("setTeamRole", { team: btn.dataset.team, role: btn.dataset.role }, (res) => {
      if (res && res.error && $("lobbyError")) $("lobbyError").textContent = res.error;
      else if ($("lobbyError")) $("lobbyError").textContent = "";
    });
  };
});

// ---------- إعدادات المضيف ----------
if ($("categorySelect")) {
  $("categorySelect").onchange = (e) => {
    selectedCategory = e.target.value;
    if ($("customWordsBox")) $("customWordsBox").classList.toggle("hidden", selectedCategory !== "custom");
    pushSettings();
  };
}
if ($("customWordsBox")) {
  $("customWordsBox").addEventListener("blur", () => pushSettings());
}
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
    customWords: $("customWordsBox") ? $("customWordsBox").value : "",
  }, () => {});
}

if ($("startBtn")) {
  $("startBtn").onclick = () => {
    socket.emit("startGame", {}, (res) => {
      if (res && res.error && $("lobbyError")) $("lobbyError").textContent = res.error;
    });
  };
}

// ---------- التلميح والكشف ----------
if ($("giveClueBtn")) {
  $("giveClueBtn").onclick = () => {
    const word = $("clueWord") ? $("clueWord").value.trim() : "";
    const count = parseInt($("clueCount") ? $("clueCount").value : "0", 10);
    if (!word || isNaN(count)) return;
    socket.emit("giveClue", { word, count }, (res) => {
      if (res && !res.error) { 
        if ($("clueWord")) $("clueWord").value = ""; 
        if ($("clueCount")) $("clueCount").value = ""; 
      }
    });
  };
}
if ($("endTurnBtn")) {
  $("endTurnBtn").onclick = () => socket.emit("endTurn", {});
}

// ---------- ردود الفعل العائمة ----------
document.querySelectorAll(".reaction-btn").forEach((btn) => {
  btn.onclick = () => socket.emit("reaction", { emoji: btn.dataset.emoji });
});
function spawnFloatingEmoji(emoji) {
  const layer = $("floatingLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "floating-emoji";
  el.textContent = emoji;
  el.style.right = (10 + Math.random() * 70) + "%";
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}
let lastReactionId = null;

// ---------- سجل الحركات ----------
if ($("historyBtn")) $("historyBtn").onclick = () => { if ($("historyPanel")) $("historyPanel").classList.remove("hidden"); };
if ($("closeHistory")) $("closeHistory").onclick = () => { if ($("historyPanel")) $("historyPanel").classList.add("hidden"); };

// ---------- إعادة اللعب ----------
if ($("rematchSameBtn")) $("rematchSameBtn").onclick = () => socket.emit("rematch", { mode: "same_teams" }, () => {});
if ($("rematchNewBtn")) $("rematchNewBtn").onclick = () => socket.emit("rematch", { mode: "new_teams" }, () => {});

// ---------- استقبال حالة الغرفة ----------
socket.on("roomState", (state) => {
  lastState = state;
  render(state);
});

socket.on("gameStateUpdate", (state) => {
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
  if (!state) return;
  if (state.phase === "lobby" || !state.phase) renderLobby(state);
  else if (state.phase === "playing") renderGame(state);
  else if (state.phase === "ended") renderEnded(state);

  if (state.reactions && state.reactions.length) {
    const last = state.reactions[state.reactions.length - 1];
    if (last.id !== lastReactionId) {
      lastReactionId = last.id;
      if ($("game") && !$("game").classList.contains("hidden")) {
        spawnFloatingEmoji(last.emoji);
      }
    }
  }
}

function renderLobby(state) {
  show("lobby");
  clearInterval(timerInterval);

  const redList = $("redPlayers"), blueList = $("bluePlayers");
  if (redList) redList.innerHTML = ""; 
  if (blueList) blueList.innerHTML = "";
  
  const players = state.players || {};
  Object.values(players).forEach((p) => {
    const label = `${p.name || p.playerName || "لاعب"} ${p.role === "spymaster" ? "🧠" : p.role === "operative" ? "🎯" : ""}${p.connected !== false ? "" : " (غير متصل)"}`;
    if (p.team === "red" && redList) redList.innerHTML += `<li>${label}</li>`;
    else if (p.team === "blue" && blueList) blueList.innerHTML += `<li>${label}</li>`;
  });

  document.querySelectorAll(".role-btn").forEach((btn) => {
    const you = state.you || {};
    const isMine = you.team === btn.dataset.team && you.role === btn.dataset.role;
    btn.classList.toggle("active-red", isMine && btn.dataset.team === "red");
    btn.classList.toggle("active-blue", isMine && btn.dataset.team === "blue");
  });

  const you = state.you || {};
  if ($("hostSettings")) $("hostSettings").classList.toggle("hidden", !you.isHost);
  if (you.isHost && state.settings) {
    if ($("categorySelect")) $("categorySelect").value = state.settings.category || "beginner";
    selectedCategory = state.settings.category || "beginner";
    if ($("customWordsBox")) $("customWordsBox").classList.toggle("hidden", selectedCategory !== "custom");
    document.querySelectorAll(".timer-btn").forEach((b) => b.classList.toggle("active", b.dataset.timer === (state.settings.timerMode || "none")));
    selectedTimer = state.settings.timerMode || "none";
  }

  const counts = { red: { spymaster: 0, operative: 0 }, blue: { spymaster: 0, operative: 0 } };
  Object.values(players).forEach((p) => { if (p.team && p.role && counts[p.team] && counts[p.team][p.role] !== undefined) counts[p.team][p.role]++; });
  const ready = counts.red.spymaster >= 1 && counts.blue.spymaster >= 1 && counts.red.operative >= 1 && counts.blue.operative >= 1;

  if ($("startBtn")) {
    $("startBtn").classList.toggle("hidden", !you.isHost);
    $("startBtn").disabled = !ready;
  }
  if ($("lobbyStatus")) {
    $("lobbyStatus").textContent = ready
      ? "الفرق جاهزة — يمكن للمضيف بدء اللعبة"
      : "يجب توفر مُلمّح واحد وعميل ميداني واحد على الأقل لكل فريق (4 لاعبين كحد أدنى)";
  }
}

function renderGame(state) {
  show("game");
  const me = state.you || {};
  const isSpymasterTurn = me.role === "spymaster" && me.team === state.turn && state.turnPhase === "clue";
  const isOperativeTurn = me.role === "operative" && me.team === state.turn && state.turnPhase === "guess";

  if ($("turnIndicator")) {
    $("turnIndicator").textContent = `دور فريق ${state.turn === "red" ? "الأحمر 🔴" : "الأزرق 🔵"} — ${state.turnPhase === "clue" ? "بانتظار التلميح" : "بانتظار الاختيار"}`;
  }
  if ($("scoreRed") && state.scores) $("scoreRed").textContent = state.scores.red || 0;
  if ($("scoreBlue") && state.scores) $("scoreBlue").textContent = state.scores.blue || 0;

  clearInterval(timerInterval);
  if (state.turnDeadline && $("timerPill")) {
    $("timerPill").classList.remove("hidden");
    const tick = () => {
      const remain = state.turnDeadline - Date.now();
      $("timerPill").textContent = fmtTime(remain);
      $("timerPill").classList.toggle("urgent", remain < 15000);
    };
    tick();
    timerInterval = setInterval(tick, 500);
  } else if ($("timerPill")) {
    $("timerPill").classList.add("hidden");
  }

  if (state.currentClue && $("clueBar")) {
    $("clueBar").classList.remove("hidden");
    const remaining = state.currentClue.count - (state.currentClue.revealedCount || 0);
    $("clueBar").textContent = `التلميح: "${state.currentClue.word}" (${state.currentClue.count}) — تبقّى ${remaining} للفريق`;
  } else if ($("clueBar")) {
    $("clueBar").classList.add("hidden");
  }

  if ($("clueForm")) $("clueForm").classList.toggle("hidden", !isSpymasterTurn);
  if ($("endTurnBtn")) $("endTurnBtn").classList.toggle("hidden", !isOperativeTurn);

  const board = $("board");
  if (board) {
    board.innerHTML = "";
    (state.board || []).forEach((cell, i) => {
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
  }

  if ($("log")) {
    $("log").innerHTML = (state.log || []).map((l) => `<div>${l.text || l}</div>`).join("");
  }
}

function renderEnded(state) {
  show("ended");
  clearInterval(timerInterval);
  if ($("winnerTeamText")) {
    $("winnerTeamText").textContent = `فاز فريق ${state.winner === "red" ? "الأحمر 🔴" : "الأزرق 🔵"}`;
  }
  if ($("winBadge")) {
    $("winBadge").style.setProperty("--w", state.winner === "red" ? "var(--red)" : "var(--blue)");
  }

  const board = $("finalBoard");
  if (board) {
    board.innerHTML = "";
    (state.board || []).forEach((cell) => {
      const div = document.createElement("div");
      div.className = `cell revealed color-${cell.color || "neutral"}`;
      div.textContent = cell.word;
      board.appendChild(div);
    });
  }

  const you = state.you || {};
  if ($("rematchButtons")) $("rematchButtons").classList.toggle("hidden", !you.isHost);
  if ($("waitHostText")) $("waitHostText").classList.toggle("hidden", !!you.isHost);
}
