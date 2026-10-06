/**
 * Pictionary Multiplayer — Main Server
 * Express + Socket.IO server, serves static files and handles all game logic
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

const RoomManager = require('./roomManager');
const GameEngine = require('./gameEngine');
const RateLimiter = require('./rateLimiter');
const AntiCheatService = require('./antiCheat');

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const RECONNECT_GRACE_MS = 30000;
const CANVAS_W = 800;
const CANVAS_H = 560;
const MAX_POINTS_PER_SEGMENT = 64;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e3, // 5KB max payload
  // Detect a silently dropped client within ~15s (drives drawer-left recovery)
  pingTimeout: 10000,
  pingInterval: 5000
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Shareable room link: /?room=XXXXXX
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Initialize managers
const roomManager = new RoomManager();
const gameEngine = new GameEngine(io, roomManager);
const rateLimiter = new RateLimiter();
const antiCheat = new AntiCheatService(io, gameEngine);

// ─── Metrics (used by scripts/loadtest.js to measure capacity) ──────────────

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
let strokeEventsIn = 0;

app.get('/metrics', (req, res) => {
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(lastCpu);
  const elapsedUs = Number(now - lastCpuAt) / 1000;
  lastCpu = process.cpuUsage();
  lastCpuAt = now;

  const mem = process.memoryUsage();
  const body = {
    rooms: roomManager.rooms.size,
    sockets: io.engine.clientsCount,
    cpuPercent: +(((cpu.user + cpu.system) / elapsedUs) * 100).toFixed(1),
    rssMB: +(mem.rss / 1048576).toFixed(1),
    heapUsedMB: +(mem.heapUsed / 1048576).toFixed(1),
    eventLoopLagMs: {
      p50: +(loopDelay.percentile(50) / 1e6).toFixed(2),
      p99: +(loopDelay.percentile(99) / 1e6).toFixed(2),
      max: +(loopDelay.max / 1e6).toFixed(2)
    },
    strokeEventsIn
  };
  if (req.query.reset === '1') {
    loopDelay.reset();
    strokeEventsIn = 0;
  }
  res.json(body);
});

// ─── Validation helpers (never trust the client) ────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Validate + normalise a live stroke batch. Returns null if malformed.
 * Only whitelisted fields are kept, so clients can't smuggle data to others.
 */
function sanitizeSegment(seg) {
  if (!seg || typeof seg !== 'object') return null;
  if (typeof seg.id !== 'string' || seg.id.length === 0 || seg.id.length > 40) return null;
  if (!Array.isArray(seg.points) || seg.points.length > MAX_POINTS_PER_SEGMENT) return null;
  if (!HEX_COLOR.test(seg.color)) return null;

  const points = [];
  for (const p of seg.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    points.push({ x: clamp(Math.round(p.x), 0, CANVAS_W), y: clamp(Math.round(p.y), 0, CANVAS_H) });
  }
  if (points.length === 0 && !seg.end) return null;

  return {
    id: seg.id,
    seq: Number.isInteger(seg.seq) ? seg.seq : 0,
    color: seg.color,
    size: clamp(Number(seg.size) || 5, 1, 50),
    tool: seg.tool === 'eraser' ? 'eraser' : 'pen',
    points,
    end: !!seg.end
  };
}

function sanitizeFill(f) {
  if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y) || !HEX_COLOR.test(f.color)) return null;
  return { x: clamp(Math.round(f.x), 0, CANVAS_W - 1), y: clamp(Math.round(f.y), 0, CANVAS_H - 1), color: f.color };
}

function getPublicSettings(settings) {
  return {
    rounds: settings.rounds,
    drawTime: settings.drawTime,
    category: settings.category,
    customWordCount: settings.customWords ? settings.customWords.length : 0
  };
}

/**
 * Bring a (late-joining or reconnecting) socket up to date with the live turn.
 * The word is only included if this player is the drawer.
 */
function sendCurrentRoundState(socket, room, playerId) {
  const drawerId = room.playerOrder[room.currentDrawerIndex];
  const drawer = room.players.get(drawerId);
  if (!drawer) return;

  if (room.state === 'PICKING_WORD') {
    socket.emit('turn-starting', {
      drawer: { id: drawer.id, name: drawer.name },
      round: room.currentRound,
      totalRounds: room.settings.rounds
    });
    return;
  }

  if (room.state !== 'DRAWING') return;

  const isDrawer = playerId === drawerId;
  const elapsed = Math.floor((Date.now() - room.turnStartTime) / 1000);

  socket.emit('round-started', {
    drawer: { id: drawer.id, name: drawer.name },
    word: isDrawer ? room.currentWord : null, // never leak the word to guessers
    hint: room.currentHint,
    wordLength: room.currentWord.length,
    drawTime: room.settings.drawTime,
    timeLeft: Math.max(0, room.settings.drawTime - elapsed),
    round: room.currentRound,
    totalRounds: room.settings.rounds,
    alreadyGuessed: room.guessedPlayers.has(playerId),
    guessedIds: [...room.guessedPlayers],
    isDrawer
  });

  const strokeBuffer = gameEngine.getStrokeBuffer(room.code);
  if (strokeBuffer) {
    socket.emit('stroke-history', { strokes: strokeBuffer.getCurrentStrokes() });
  }
}

// ─── Socket.IO Connection Handler ────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  const safeHandler = (fn) => (...args) => {
    try {
      let payload = args[0];
      if (payload === null || (typeof payload !== 'object' && typeof payload !== 'undefined')) {
        payload = {};
      }
      args[0] = payload || {};
      fn(...args);
    } catch (err) {
      console.error(`[SOCKET ERROR] Socket ${socket.id}:`, err);
    }
  };

  // ── ROOM MANAGEMENT ──────────────────────────────────────────────────────

  /**
   * Create a new room
   */
  socket.on('create-room', safeHandler(({ playerName, settings }) => {
    if (!playerName || playerName.trim().length === 0) {
      socket.emit('error-msg', { message: 'Name is required' });
      return;
    }
    if (playerName.length > 20) {
      socket.emit('error-msg', { message: 'Name must be under 20 characters' });
      return;
    }

    const result = roomManager.createRoom(playerName.trim(), socket.id, settings);
    socket.join(result.roomCode);

    socket.emit('room-created', {
      roomCode: result.roomCode,
      sessionToken: result.sessionToken,
      player: {
        id: result.player.id,
        name: result.player.name,
        isHost: true,
        score: 0
      },
      players: roomManager.getPlayerList(result.roomCode),
      settings: roomManager.getRoom(result.roomCode).settings
    });

    console.log(`[ROOM CREATED] ${result.roomCode} by ${playerName}`);
  }));

  /**
   * Join an existing room
   */
  socket.on('join-room', safeHandler(({ roomCode, playerName }) => {
    if (!playerName || playerName.trim().length === 0) {
      socket.emit('error-msg', { message: 'Name is required' });
      return;
    }
    if (!roomCode || roomCode.trim().length === 0) {
      socket.emit('error-msg', { message: 'Room code is required' });
      return;
    }

    const result = roomManager.joinRoom(roomCode.trim().toUpperCase(), playerName.trim(), socket.id);

    if (!result) {
      socket.emit('error-msg', { message: 'Room not found' });
      return;
    }
    if (result.error) {
      socket.emit('error-msg', { message: result.error });
      return;
    }

    socket.join(result.room.code);

    // Send room state to the joining player
    socket.emit('room-joined', {
      roomCode: result.room.code,
      sessionToken: result.sessionToken,
      player: {
        id: result.player.id,
        name: result.player.name,
        isHost: false,
        score: 0
      },
      players: roomManager.getPlayerList(result.room.code),
      settings: getPublicSettings(result.room.settings),
      gameState: result.room.state
    });

    // If game is in progress, send current state to late joiner
    sendCurrentRoundState(socket, result.room, result.player.id);

    // Notify everyone in the room
    io.to(result.room.code).emit('player-joined', {
      player: { id: result.player.id, name: result.player.name, score: 0 },
      players: roomManager.getPlayerList(result.room.code)
    });

    console.log(`[JOIN] ${playerName} joined ${result.room.code}`);
  }));

  /**
   * Reconnect using session token
   */
  socket.on('reconnect-session', safeHandler(({ sessionToken } = {}) => {
    if (typeof sessionToken !== 'string') {
      socket.emit('reconnect-failed', {});
      return;
    }

    const result = roomManager.reconnect(sessionToken, socket.id, RECONNECT_GRACE_MS);

    if (!result) {
      socket.emit('reconnect-failed', {});
      return;
    }

    socket.join(result.room.code);

    // Send full state to reconnected player
    socket.emit('reconnect-success', {
      roomCode: result.room.code,
      player: {
        id: result.player.id,
        name: result.player.name,
        isHost: result.player.isHost,
        score: result.player.score
      },
      players: roomManager.getPlayerList(result.room.code),
      gameState: result.room.state,
      settings: result.player.isHost ? result.room.settings : getPublicSettings(result.room.settings),
      round: result.room.currentRound,
      totalRounds: result.room.settings.rounds,
      drawerId: result.room.playerOrder[result.room.currentDrawerIndex] || null
    });

    // If game is in progress, send current round state + canvas
    sendCurrentRoundState(socket, result.room, result.player.id);

    // Notify others
    socket.to(result.room.code).emit('player-reconnected', {
      player: { id: result.player.id, name: result.player.name },
      players: roomManager.getPlayerList(result.room.code)
    });

    console.log(`[RECONNECT] ${result.player.name} back in ${result.room.code} (score ${result.player.score})`);
  }));

  // ── GAME MANAGEMENT ──────────────────────────────────────────────────────

  /**
   * Host starts the game
   */
  socket.on('start-game', safeHandler(() => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;

    if (!player.isHost) {
      socket.emit('error-msg', { message: 'Only the host can start the game' });
      return;
    }

    if (room.players.size < 2) {
      socket.emit('error-msg', { message: 'Need at least 2 players to start' });
      return;
    }

    gameEngine.startGame(room.code);
    console.log(`[GAME START] ${room.code}`);
  }));

  /**
   * Host updates game settings
   */
  socket.on('update-settings', safeHandler(({ rounds, drawTime, customWords }) => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;
    if (!player.isHost || room.state !== 'LOBBY') return;

    if (rounds) room.settings.rounds = Math.min(10, Math.max(1, rounds));
    if (drawTime) room.settings.drawTime = Math.min(180, Math.max(30, drawTime));
    if (customWords !== undefined) {
      room.settings.customWords = Array.isArray(customWords)
        ? customWords.filter(w => w && typeof w === 'string' && w.length > 0 && w.length <= 30).slice(0, 500)
        : [];
    }

    for (const [pid, p] of room.players) {
      if (!p.connected) continue;
      const s = p.isHost ? room.settings : getPublicSettings(room.settings);
      io.to(p.socketId).emit('settings-updated', { settings: s });
    }
  }));

  /**
   * Drawer picks a word
   */
  socket.on('word-chosen', safeHandler(({ wordIndex }) => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;
    if (room.state !== 'PICKING_WORD') return;

    const drawerId = room.playerOrder[room.currentDrawerIndex];
    if (player.id !== drawerId) return;

    if (wordIndex < 0 || wordIndex > 2) return;

    gameEngine.wordChosen(room.code, player.id, wordIndex);
  }));

  // ── DRAWING ──────────────────────────────────────────────────────────────

  /**
   * Stream a live stroke batch (sent every ~25ms while the drawer draws)
   */
  socket.on('draw-stroke', safeHandler((raw) => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;

    // Only the drawer can draw
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    if (player.id !== drawerId || room.state !== 'DRAWING') return;

    // Rate limit + size limit
    if (!rateLimiter.check(player.id, 'stroke')) return;
    if (!rateLimiter.checkSize(raw, 'stroke')) return;

    const seg = sanitizeSegment(raw);
    if (!seg) return;
    strokeEventsIn++;

    // Store in buffer (merged per stroke id); drop if per-turn cap reached
    const strokeBuffer = gameEngine.getStrokeBuffer(room.code);
    if (strokeBuffer && !strokeBuffer.addSegment(seg)) return;

    // Relay to everyone else. One WebSocket per client => in-order delivery.
    socket.to(room.code).emit('draw-stroke', seg);
  }));

  /**
   * Undo last stroke
   */
  socket.on('undo', safeHandler(() => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    if (player.id !== drawerId || room.state !== 'DRAWING') return;

    const strokeBuffer = gameEngine.getStrokeBuffer(room.code);
    if (strokeBuffer) strokeBuffer.addUndo();

    socket.to(room.code).emit('undo');
  }));

  /**
   * Clear the canvas
   */
  socket.on('clear-canvas', safeHandler(() => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    if (player.id !== drawerId || room.state !== 'DRAWING') return;

    const strokeBuffer = gameEngine.getStrokeBuffer(room.code);
    if (strokeBuffer) strokeBuffer.addClear();

    socket.to(room.code).emit('clear-canvas');
  }));

  /**
   * Fill an area with color
   */
  socket.on('fill', safeHandler((raw) => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;

    const { room, player } = data;
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    if (player.id !== drawerId || room.state !== 'DRAWING') return;

    if (!rateLimiter.check(player.id, 'stroke')) return;
    const fillData = sanitizeFill(raw);
    if (!fillData) return;

    const strokeBuffer = gameEngine.getStrokeBuffer(room.code);
    if (strokeBuffer) strokeBuffer.addFill(fillData);

    socket.to(room.code).emit('fill', fillData);
  }));

  // ── CHAT / GUESSING ──────────────────────────────────────────────────────

  /**
   * Handle a chat message / guess
   */
  socket.on('chat-message', safeHandler(({ message } = {}) => {
    const data = roomManager.getBySocket(socket.id);
    if (!data) return;
    if (typeof message !== 'string') return;

    const { room, player } = data;

    // Rate limit
    if (!rateLimiter.check(player.id, 'chat')) {
      socket.emit('error-msg', { message: 'Slow down! Too many messages.' });
      return;
    }
    if (!rateLimiter.checkSize({ message }, 'chat')) {
      socket.emit('error-msg', { message: 'Message too long' });
      return;
    }

    // Sanitize message
    const sanitized = message.trim().substring(0, 200);
    if (sanitized.length === 0) return;

    // If game isn't in drawing state, just broadcast as chat
    if (room.state !== 'DRAWING') {
      io.to(room.code).emit('chat-message', {
        player: player.name,
        playerId: player.id,
        message: sanitized,
        type: 'chat'
      });
      return;
    }

    // Process as guess
    const result = gameEngine.handleGuess(room.code, player.id, sanitized);
    if (!result) return;

    switch (result.type) {
      case 'correct':
        // Notify everyone about the correct guess
        io.to(room.code).emit('correct-guess', {
          player: result.player,
          playerId: result.playerId,
          points: result.points,
          players: roomManager.getPlayerList(room.code)
        });

        // Check if all have guessed
        if (result.allGuessed) {
          gameEngine.checkAllGuessed(room.code);
        }
        break;

      case 'close':
        // Send regular message to everyone
        io.to(room.code).emit('chat-message', {
          player: result.player,
          playerId: result.playerId,
          message: result.message,
          type: 'chat'
        });
        // Send "close!" only to the guesser
        socket.emit('close-guess', {});
        break;

      case 'filtered':
        // Don't broadcast — contains the answer
        socket.emit('error-msg', { message: 'Your message was filtered' });
        break;

      case 'guessed-chat':
        // Already guessed — only show to other guessed players and drawer
        const drawerId = room.playerOrder[room.currentDrawerIndex];
        const drawer = room.players.get(drawerId);

        // Send to players who already guessed + drawer
        for (const pid of room.guessedPlayers) {
          const p = room.players.get(pid);
          if (p && p.connected) {
            io.to(p.socketId).emit('chat-message', {
              player: result.player,
              playerId: player.id,
              message: sanitized,
              type: 'guessed-chat'
            });
          }
        }
        if (drawer && drawer.connected) {
          io.to(drawer.socketId).emit('chat-message', {
            player: result.player,
            playerId: player.id,
            message: sanitized,
            type: 'guessed-chat'
          });
        }
        break;

      case 'drawer-chat':
        // Drawer's messages go to everyone
        io.to(room.code).emit('chat-message', {
          player: result.player,
          playerId: player.id,
          message: result.message,
          type: 'drawer-chat'
        });
        break;

      default:
        // Normal chat
        io.to(room.code).emit('chat-message', {
          player: result.player,
          playerId: player.id,
          message: result.message,
          type: 'chat'
        });
    }
  }));

  // ── DISCONNECTION ────────────────────────────────────────────────────────

  socket.on('disconnect', safeHandler(() => {
    const result = roomManager.disconnect(socket.id);
    if (!result) return;

    const { room, player, wasDrawer } = result;

    // Notify room (player stays listed as "disconnected" during the grace period)
    io.to(room.code).emit('player-left', {
      player: { id: player.id, name: player.name },
      players: roomManager.getPlayerList(room.code)
    });

    // If the drawer left during their turn, handle it
    if (wasDrawer) {
      gameEngine.handleDrawerLeft(room.code);
    } else if (room.state === 'DRAWING') {
      // The only guesser still missing may have been this player
      gameEngine.checkAllGuessed(room.code);
    }

    // After the grace period, drop players who never came back
    setTimeout(() => {
      const removed = roomManager.expireIfStillDisconnected(room.code, player.id, RECONNECT_GRACE_MS);
      if (removed) {
        rateLimiter.remove(player.id);
        io.to(room.code).emit('player-left', {
          player: { id: player.id, name: player.name },
          players: roomManager.getPlayerList(room.code)
        });
        console.log(`[EXPIRED] ${player.name} from ${room.code}`);
      }
    }, RECONNECT_GRACE_MS + 500);

    console.log(`[DISCONNECT] ${player.name} from ${room.code} (30s grace)`);
  }));
});

// ─── Start Server ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use (another server is probably still running).`);
    console.error(`   Stop it, or run on another port:  $env:PORT=4000; npm start   (PowerShell)\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => {
  console.log(`\n🎨 Pictionary Server running on http://localhost:${PORT}\n`);
});
