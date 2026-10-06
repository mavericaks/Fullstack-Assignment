/**
 * App — Main client-side orchestrator
 * Connects all modules (Canvas, Chat, Game, Lobby, Replay) via Socket.IO
 */

// ── Global Utility: Toast Notifications ─────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Screen Management ────────────────────────────────────────────────────────
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ── Initialize Modules ───────────────────────────────────────────────────────
const socket = io();

const canvas = new CanvasManager('draw-canvas');
const chat = new ChatManager();
const gameUI = new GameUI();
const lobby = new LobbyManager();
const replay = new ReplayPlayer();

// ── State ────────────────────────────────────────────────────────────────────
let myPlayer = null;
let currentRoom = null;
let sessionToken = null;
let isDrawer = false;
let drawTime = 80;
let guessedPlayerIds = new Set();
let gameReplays = null;

// ── Session Persistence (for reconnection) ───────────────────────────────────
function saveSession(token, roomCode) {
  try {
    sessionStorage.setItem('drawly_session', JSON.stringify({ token, roomCode }));
  } catch (e) { /* ignore */ }
}

function loadSession() {
  try {
    const data = sessionStorage.getItem('drawly_session');
    return data ? JSON.parse(data) : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { sessionStorage.removeItem('drawly_session'); } catch (e) { /* ignore */ }
}

// Reconnection on load is handled in the 'connect' socket event below.

// ══════════════════════════════════════════════════════════════════════════════
//  LOBBY EVENTS
// ══════════════════════════════════════════════════════════════════════════════

lobby.onCreate = ({ playerName, settings }) => {
  socket.emit('create-room', { playerName, settings });
};

lobby.onJoin = ({ playerName, roomCode }) => {
  socket.emit('join-room', { roomCode, playerName });
};

lobby.onStart = () => {
  socket.emit('start-game');
};

// ══════════════════════════════════════════════════════════════════════════════
//  SOCKET EVENTS — ROOM
// ══════════════════════════════════════════════════════════════════════════════

socket.on('room-created', (data) => {
  myPlayer = data.player;
  currentRoom = data.roomCode;
  sessionToken = data.sessionToken;
  saveSession(sessionToken, currentRoom);

  lobby.showWaitingRoom(data.roomCode, data.settings, true);
  lobby.updatePlayerList(data.players);
  showScreen('waiting-screen');

  showToast('Room created!', 'success');
});

socket.on('room-joined', (data) => {
  myPlayer = data.player;
  currentRoom = data.roomCode;
  sessionToken = data.sessionToken;
  saveSession(sessionToken, currentRoom);

  lobby.showWaitingRoom(data.roomCode, data.settings, false);
  lobby.updatePlayerList(data.players);

  if (data.gameState === 'DRAWING' || data.gameState === 'PICKING_WORD') {
    showScreen('game-screen');
  } else {
    showScreen('waiting-screen');
  }

  showToast('Joined the room!', 'success');
});

socket.on('player-joined', (data) => {
  lobby.updatePlayerList(data.players);
  gameUI.updateScoreboard(data.players, gameUI.currentDrawerId, guessedPlayerIds);
  chat.addMessage(null, `${data.player.name} joined the game`, 'system');
});

socket.on('player-left', (data) => {
  lobby.updatePlayerList(data.players);
  gameUI.updateScoreboard(data.players, gameUI.currentDrawerId, guessedPlayerIds);
  chat.addMessage(null, `${data.player.name} left the game`, 'system');
});

socket.on('player-reconnected', (data) => {
  lobby.updatePlayerList(data.players);
  gameUI.updateScoreboard(data.players, gameUI.currentDrawerId, guessedPlayerIds);
  chat.addMessage(null, `${data.player.name} reconnected`, 'system');
});

socket.on('settings-updated', (data) => {
  lobby.updateSettings(data.settings);
});

// ══════════════════════════════════════════════════════════════════════════════
//  SOCKET EVENTS — RECONNECTION
// ══════════════════════════════════════════════════════════════════════════════

socket.on('reconnect-success', (data) => {
  myPlayer = data.player;
  currentRoom = data.roomCode;
  sessionToken = loadSession()?.token;

  if (data.gameState === 'LOBBY') {
    lobby.showWaitingRoom(data.roomCode, data.settings, data.player.isHost);
    lobby.updatePlayerList(data.players);
    showScreen('waiting-screen');
  } else if (data.gameState === 'GAME_OVER') {
    showScreen('waiting-screen');
  } else {
    gameUI.updateScoreboard(data.players, null, guessedPlayerIds);
    showScreen('game-screen');
  }

  showToast('Reconnected!', 'success');
});

socket.on('reconnect-failed', () => {
  clearSession();
  myPlayer = null;
  currentRoom = null;
  isDrawer = false;
  showScreen('lobby-screen');
  showToast('Connection lost or server restarted', 'error');
});

// ══════════════════════════════════════════════════════════════════════════════
//  SOCKET EVENTS — GAME
// ══════════════════════════════════════════════════════════════════════════════

socket.on('game-started', (data) => {
  showScreen('game-screen');
  gameUI.setRound(data.round, data.totalRounds);
  gameUI.updateScoreboard(data.players, null);
  chat.clear();
  chat.addMessage(null, '🎮 Game started!', 'system');
  guessedPlayerIds = new Set();
});

socket.on('turn-starting', (data) => {
  gameUI.setRound(data.round, data.totalRounds);
  gameUI.hideRoundEnd();
  gameUI.resetWordDisplay();
  canvas.clear();
  guessedPlayerIds = new Set();

  chat.addMessage(null, `🎨 ${data.drawer.name} is choosing a word...`, 'system');
});

socket.on('choose-word', (data) => {
  // This only comes to the drawer
  isDrawer = true;
  gameUI.showWordSelection(data.words);
  // Server stores word choices server-side already; no need to echo them back
});

gameUI.onWordChosen = (index) => {
  socket.emit('word-chosen', { wordIndex: index });
};

socket.on('round-started', (data) => {
  drawTime = data.drawTime;
  gameUI.totalTime = data.drawTime;
  gameUI.hideWordSelection();
  gameUI.hideRoundEnd();

  // If round/totalRounds are provided (reconnect path), refresh the counter
  if (data.round) gameUI.setRound(data.round, data.totalRounds);

  isDrawer = data.isDrawer;

  // Restore guessed-player set (provided on reconnect, empty on fresh turn-start)
  guessedPlayerIds = data.guessedIds ? new Set(data.guessedIds) : new Set();

  if (isDrawer) {
    gameUI.setWord(data.word);
    canvas.setEnabled(true);
    gameUI.showDrawingTools(true);
    chat.setEnabled(false);
    chat.addMessage(null, `✏️ You are drawing: ${data.word}`, 'system');
  } else {
    gameUI.setHint(data.hint);
    canvas.setEnabled(false);
    gameUI.showDrawingTools(false);
    // Keep chat off if we already guessed
    const alreadyGuessed = data.alreadyGuessed || guessedPlayerIds.has(myPlayer?.id);
    chat.setEnabled(!alreadyGuessed);
    chat.addMessage(null, `🎨 ${data.drawer.name} is drawing!`, 'system');
  }

  // Use timeLeft if provided (reconnect mid-round), otherwise full drawTime
  const timerVal = (data.timeLeft !== undefined) ? data.timeLeft : data.drawTime;
  gameUI.updateTimer(timerVal, data.drawTime);
  canvas.clear();
});

socket.on('timer-update', (data) => {
  gameUI.updateTimer(data.timeLeft, drawTime);
});

socket.on('hint-update', (data) => {
  if (!isDrawer) {
    gameUI.setHint(data.hint);
  }
});

socket.on('round-ended', (data) => {
  isDrawer = false;
  canvas.setEnabled(false);
  gameUI.showDrawingTools(false);
  chat.setEnabled(true);
  gameUI.resetWordDisplay();
  gameUI.showRoundEnd(data.word, data.allGuessed);
  gameUI.updateScoreboard(data.scores, null, new Set());
  guessedPlayerIds = new Set();

  chat.addMessage(null, `✅ The word was: ${data.word}`, 'system');
});

socket.on('drawer-left', (data) => {
  isDrawer = false;
  canvas.setEnabled(false);
  gameUI.showDrawingTools(false);
  chat.addMessage(null, data.message, 'system');
  showToast(data.message, 'warning');
});

socket.on('game-over', (data) => {
  isDrawer = false;
  canvas.setEnabled(false);
  gameUI.showDrawingTools(false);
  gameReplays = data.replays;

  // Show game over screen
  _renderGameOver(data.finalScores);
  showScreen('gameover-screen');
  clearSession();
});

// ══════════════════════════════════════════════════════════════════════════════
//  SOCKET EVENTS — DRAWING
// ══════════════════════════════════════════════════════════════════════════════

// Send live stroke batches to server as the drawer draws (~every 25ms)
canvas.onStrokeSegment = (seg) => {
  socket.emit('draw-stroke', seg);
};

canvas.onUndo = () => {
  socket.emit('undo');
};

canvas.onFill = (fillData) => {
  socket.emit('fill', fillData);
};

// Receive live stroke batches from server and render incrementally
socket.on('draw-stroke', (seg) => {
  // Segments have an `id` field; render incrementally using renderRemoteSegment
  canvas.renderRemoteSegment(seg);
});

socket.on('undo', () => {
  canvas.remoteUndo();
});

socket.on('clear-canvas', () => {
  canvas.clear();
});

socket.on('fill', (fillData) => {
  canvas.renderRemoteStroke({ type: 'fill', ...fillData });
});

socket.on('stroke-history', (data) => {
  canvas.replayHistory(data.strokes);
});

// ══════════════════════════════════════════════════════════════════════════════
//  SOCKET EVENTS — CHAT
// ══════════════════════════════════════════════════════════════════════════════

chat.onSend = (message) => {
  socket.emit('chat-message', { message });
};

socket.on('chat-message', (data) => {
  chat.addMessage(data.player, data.message, data.type);
});

socket.on('correct-guess', (data) => {
  guessedPlayerIds.add(data.playerId);
  chat.addMessage(null, `🎉 ${data.player} guessed the word! (+${data.points} pts)`, 'correct');
  gameUI.updateScoreboard(data.players, gameUI.currentDrawerId, guessedPlayerIds);

  if (data.playerId === myPlayer?.id) {
    showToast('🎉 You got it!', 'success');
    chat.setEnabled(false);
  }
});

socket.on('close-guess', () => {
  showToast("That's close! 🔥", 'warning', 2000);
});

socket.on('error-msg', (data) => {
  showToast(data.message, 'error');
});

// ══════════════════════════════════════════════════════════════════════════════
//  DRAWING TOOL CONTROLS
// ══════════════════════════════════════════════════════════════════════════════

// Tool buttons
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    canvas.setTool(btn.dataset.tool);
  });
});

// Color buttons
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    canvas.setColor(btn.dataset.color);
  });
});

// Brush size slider
document.getElementById('brush-size').addEventListener('input', (e) => {
  const size = parseInt(e.target.value);
  canvas.setSize(size);
  document.getElementById('brush-size-label').textContent = size;
});

// Undo button
document.getElementById('btn-undo').addEventListener('click', () => {
  canvas.undo();
});

// Clear button
document.getElementById('btn-clear').addEventListener('click', () => {
  canvas.clear();
  socket.emit('clear-canvas');
});

// ══════════════════════════════════════════════════════════════════════════════
//  GAME OVER & REPLAY
// ══════════════════════════════════════════════════════════════════════════════

function _renderGameOver(scores) {
  // Podium (top 3)
  const podium = document.getElementById('final-podium');
  podium.innerHTML = '';

  const positions = [
    { index: 1, class: 'second', label: '2nd' },
    { index: 0, class: 'first', label: '1st' },
    { index: 2, class: 'third', label: '3rd' }
  ];

  for (const pos of positions) {
    if (scores[pos.index]) {
      const item = document.createElement('div');
      item.className = 'podium-item';

      const bar = document.createElement('div');
      bar.className = `podium-bar ${pos.class}`;
      bar.textContent = pos.label === '1st' ? '🥇' : pos.label === '2nd' ? '🥈' : '🥉';

      const name = document.createElement('div');
      name.className = 'podium-name';
      name.textContent = scores[pos.index].name;

      const score = document.createElement('div');
      score.className = 'podium-score';
      score.textContent = `${scores[pos.index].score} pts`;

      item.appendChild(name);
      item.appendChild(bar);
      item.appendChild(score);
      podium.appendChild(item);
    }
  }

  // Full score list
  const scoreList = document.getElementById('final-scores');
  scoreList.innerHTML = '';

  scores.forEach((player, i) => {
    const item = document.createElement('div');
    item.className = 'final-score-item';

    const rank = document.createElement('span');
    rank.className = 'final-score-rank';
    rank.textContent = `#${i + 1}`;

    const name = document.createElement('span');
    name.className = 'final-score-name';
    name.textContent = player.name;

    const pts = document.createElement('span');
    pts.className = 'final-score-pts';
    pts.textContent = `${player.score} pts`;

    item.appendChild(rank);
    item.appendChild(name);
    item.appendChild(pts);
    scoreList.appendChild(item);
  });
}

// Replay button
document.getElementById('btn-replay-drawings').addEventListener('click', () => {
  if (gameReplays && gameReplays.length > 0) {
    const validReplays = gameReplays.filter(r => r.strokes && r.strokes.length > 0);
    if (validReplays.length > 0) {
      replay.loadReplays(validReplays);
      showScreen('replay-screen');
    } else {
      showToast('No drawings to replay', 'info');
    }
  } else {
    showToast('No drawings to replay', 'info');
  }
});

replay.onClose = () => {
  showScreen('gameover-screen');
};

// Play Again button
document.getElementById('btn-play-again').addEventListener('click', () => {
  clearSession();
  gameUI.reset();
  chat.clear();
  canvas.clear();
  myPlayer = null;
  currentRoom = null;
  isDrawer = false;
  guessedPlayerIds = new Set();
  gameReplays = null;
  showScreen('lobby-screen');

  // Clean URL
  const url = new URL(window.location);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url);
});

// ══════════════════════════════════════════════════════════════════════════════
//  CONNECTION STATUS
// ══════════════════════════════════════════════════════════════════════════════

// Socket.IO v4: 'connect' fires on every (re-)connection, including transport-level reconnects.
// We attempt to rejoin only when we don't already have a live session (myPlayer is null).
socket.on('connect', () => {
  console.log('Connected to server');
  const saved = loadSession();
  if (saved && saved.token) {
    socket.emit('reconnect-session', { sessionToken: saved.token });
  }
});

socket.on('disconnect', () => {
  showToast('Disconnected from server...', 'error');
});

// ── Initialize ───────────────────────────────────────────────────────────────
canvas.clear();
console.log('🎨 Drawly loaded');
