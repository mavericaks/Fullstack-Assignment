/**
 * Game Engine — manages the complete game lifecycle
 * State machine: LOBBY → PICKING_WORD → DRAWING → ROUND_END → GAME_OVER
 * Server-authoritative: all scoring, timing, and validation happens here
 */

const WordManager = require('./wordManager');
const GuessChecker = require('./guessChecker');
const StrokeBuffer = require('./strokeBuffer');
const config = require('./config');

class GameEngine {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
    // roomCode -> { wordManager, strokeBuffer }
    this.games = new Map();
  }

  /**
   * Start a new game in a room
   */
  startGame(roomCode) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return false;
    if (room.players.size < 2) return false;
    if (room.state !== 'LOBBY' && room.state !== 'GAME_OVER') return false;

    // Clear any existing timers before restarting
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
    if (room.hintTimer) { clearInterval(room.hintTimer); room.hintTimer = null; }
    if (room.pickTimer) { clearTimeout(room.pickTimer); room.pickTimer = null; }

    const customWords = room.settings.customWords.length > 0
      ? room.settings.customWords
      : null;

    const wordManager = new WordManager(customWords, room.settings.category);
    const strokeBuffer = new StrokeBuffer();

    this.games.set(roomCode, { wordManager, strokeBuffer });

    room.state = 'PICKING_WORD';
    room.currentRound = 1;
    room.currentDrawerIndex = 0;

    // Reset all scores
    for (const [, player] of room.players) {
      player.score = 0;
    }

    // Notify all players
    this.io.to(roomCode).emit('game-started', {
      round: 1,
      totalRounds: room.settings.rounds,
      players: this.roomManager.getPlayerList(roomCode)
    });

    // Start first turn
    this._startTurn(roomCode);
    return true;
  }

  /**
   * Start a new turn — send word choices to the drawer
   */
  _startTurn(roomCode) {
    const room = this.roomManager.getRoom(roomCode);
    const game = this.games.get(roomCode);
    if (!room || !game) return;

    room.state = 'PICKING_WORD';
    room.currentWord = null;
    room.guessedPlayers = new Set();
    room.guesserPoints = [];

    // Find the current drawer
    let drawerId = room.playerOrder[room.currentDrawerIndex];
    let drawer = room.players.get(drawerId);

    // Skip disconnected players
    let attempts = 0;
    while (drawer && !drawer.connected && attempts < room.playerOrder.length) {
      room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.playerOrder.length;
      drawerId = room.playerOrder[room.currentDrawerIndex];
      drawer = room.players.get(drawerId);
      attempts++;
    }

    if (!drawer || !drawer.connected) {
      // No connected players can draw — end game
      this._endGame(roomCode);
      return;
    }

    // Get 3 word choices and store them server-side for validation
    const words = game.wordManager.getWordChoices();
    room._wordChoices = words;

    // Start stroke buffer for this turn
    const turnIndex = (room.currentRound - 1) * room.playerOrder.length + room.currentDrawerIndex;
    game.strokeBuffer.startRound(turnIndex);

    // Notify drawer to pick a word (ONLY the drawer sees the words)
    this.io.to(drawer.socketId).emit('choose-word', { words });

    // Notify everyone else who the drawer is
    this.io.to(roomCode).emit('turn-starting', {
      drawer: { id: drawer.id, name: drawer.name },
      round: room.currentRound,
      totalRounds: room.settings.rounds
    });

    // Auto-pick timeout: if drawer doesn't pick in 15s, auto-select
    room.pickTimer = setTimeout(() => {
      if (room.state === 'PICKING_WORD') {
        this.wordChosen(roomCode, drawerId, 0, words);
      }
    }, config.game.pickTimeoutMs);
  }

  /**
   * Drawer has chosen a word
   */
  wordChosen(roomCode, playerId, wordIndex, wordsOverride = null) {
    const room = this.roomManager.getRoom(roomCode);
    const game = this.games.get(roomCode);
    if (!room || !game) return;

    // Validate it's the drawer choosing
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    if (playerId !== drawerId && !wordsOverride) return;

    // Clear pick timer
    if (room.pickTimer) {
      clearTimeout(room.pickTimer);
      room.pickTimer = null;
    }

    // Get the word (either from override for auto-pick, or generate fresh)
    let word;
    if (wordsOverride) {
      word = wordsOverride[wordIndex];
    } else {
      // The word choices were sent only to the client,
      // so we need to regenerate or we can trust the index
      // For security: server picks the words and sends them, client sends back index
      // We store the choices temporarily
      word = room._wordChoices ? room._wordChoices[wordIndex] : null;
      if (!word) return;
    }

    game.wordManager.markUsed(word);
    room.currentWord = word;
    room.state = 'DRAWING';
    room.turnStartTime = Date.now();

    // Store round metadata for replay
    const drawer = room.players.get(drawerId);
    const turnIndex = (room.currentRound - 1) * room.playerOrder.length + room.currentDrawerIndex;
    game.strokeBuffer.setRoundMeta(turnIndex, word, drawer.name);

    // Generate initial hint (all underscores)
    const letterCount = word.replace(/ /g, '').length;
    const initialHint = word.split('').map(ch => ch === ' ' ? '  ' : '_').join(' ');
    room.currentHint = initialHint;
    room.revealedIndices = [];

    // Tell each player about the round starting
    // Drawer sees the word; guessers see only the hint
    for (const [, p] of room.players) {
      if (!p.connected) continue;
      const pIsDrawer = p.id === drawerId;
      this.io.to(p.socketId).emit('round-started', {
        drawer: { id: drawer.id, name: drawer.name },
        word: pIsDrawer ? word : null,   // Never send the word to guessers!
        hint: initialHint,
        wordLength: word.length,
        drawTime: room.settings.drawTime,
        isDrawer: pIsDrawer
      });
    }

    // Start the countdown timer
    let timeLeft = room.settings.drawTime;
    room.timer = setInterval(() => {
      timeLeft--;

      // Update hint based on time
      const elapsed = room.settings.drawTime - timeLeft;
      const revealCount = WordManager.getRevealCount(elapsed, room.settings.drawTime, letterCount);

      if (revealCount > room.revealedIndices.length) {
        const { hint, revealedIndices } = WordManager.generateHint(word, revealCount);
        room.currentHint = hint;
        room.revealedIndices = revealedIndices;

        // Send hint only to guessers (drawer already knows)
        for (const [, p] of room.players) {
          if (!p.connected || p.id === drawerId) continue;
          this.io.to(p.socketId).emit('hint-update', { hint });
        }
      }

      this.io.to(roomCode).emit('timer-update', { timeLeft });

      if (timeLeft <= 0) {
        this._endTurn(roomCode, false);
      }
    }, 1000);
  }

  /**
   * Handle word choices — store them server-side for validation
   */
  storeWordChoices(roomCode, words) {
    const room = this.roomManager.getRoom(roomCode);
    if (room) {
      room._wordChoices = words;
    }
  }

  /**
   * Process a chat message / guess
   */
  handleGuess(roomCode, playerId, message) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.state !== 'DRAWING') return null;

    const player = room.players.get(playerId);
    if (!player) return null;

    const drawerId = room.playerOrder[room.currentDrawerIndex];

    // Drawer can't guess
    if (playerId === drawerId) {
      return { type: 'drawer-chat', player: player.name, message };
    }

    // Already guessed correctly — can't send messages (prevents revealing)
    if (room.guessedPlayers.has(playerId)) {
      return { type: 'guessed-chat', player: player.name, message: '(already guessed)' };
    }

    const result = GuessChecker.check(message, room.currentWord);

    if (result.correct) {
      // Calculate points
      const elapsed = (Date.now() - room.turnStartTime) / 1000;
      const guessOrder = room.guessedPlayers.size + 1;
      const points = GuessChecker.calculatePoints(
        elapsed, room.settings.drawTime, guessOrder
      );

      player.score += points;
      room.guessedPlayers.add(playerId);
      room.guesserPoints.push(points);

      // Check if everyone has guessed
      const connectedGuessers = this.roomManager.getConnectedPlayers(roomCode)
        .filter(p => p.id !== drawerId);
      const allGuessed = connectedGuessers.every(p => room.guessedPlayers.has(p.id));

      return {
        type: 'correct',
        player: player.name,
        playerId: player.id,
        points,
        totalScore: player.score,
        allGuessed
      };
    }

    if (result.containsAnswer) {
      // Filter message — don't broadcast, it contains the answer
      return { type: 'filtered', player: player.name };
    }

    if (result.close) {
      return { type: 'close', player: player.name, playerId: player.id, message };
    }

    // Normal chat message
    return { type: 'chat', player: player.name, message };
  }

  /**
   * End the current turn
   */
  _endTurn(roomCode, allGuessed = false) {
    const room = this.roomManager.getRoom(roomCode);
    const game = this.games.get(roomCode);
    if (!room || !game) return;

    // Clear timers
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    if (room.hintTimer) {
      clearInterval(room.hintTimer);
      room.hintTimer = null;
    }
    if (room.pickTimer) {
      clearTimeout(room.pickTimer);
      room.pickTimer = null;
    }

    // Award drawer points
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    const drawer = room.players.get(drawerId);
    if (drawer && room.guesserPoints.length > 0) {
      const drawerPoints = GuessChecker.calculateDrawerPoints(room.guesserPoints);
      drawer.score += drawerPoints;
    }

    room.state = 'ROUND_END';

    // Broadcast round end
    this.io.to(roomCode).emit('round-ended', {
      word: room.currentWord,
      scores: this.roomManager.getPlayerList(roomCode),
      allGuessed
    });

    // After 5 seconds, move to next turn
    const expectedTurnId = `${room.currentRound}-${room.currentDrawerIndex}`;
    setTimeout(() => {
      this._nextTurn(roomCode, expectedTurnId);
    }, config.game.roundEndDelayMs);
  }

  /**
   * Advance to the next turn or round
   */
  _nextTurn(roomCode, expectedTurnId) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    if (expectedTurnId) {
      const currentTurnId = `${room.currentRound}-${room.currentDrawerIndex}`;
      if (currentTurnId !== expectedTurnId) return;
    }

    // Move to next drawer
    room.currentDrawerIndex++;

    // If we've gone through all players, advance the round
    if (room.currentDrawerIndex >= room.playerOrder.length) {
      room.currentDrawerIndex = 0;
      room.currentRound++;

      // Check if game is over
      if (room.currentRound > room.settings.rounds) {
        this._endGame(roomCode);
        return;
      }
    }

    // Start the next turn
    this._startTurn(roomCode);
  }

  /**
   * End the entire game
   */
  _endGame(roomCode) {
    const room = this.roomManager.getRoom(roomCode);
    const game = this.games.get(roomCode);
    if (!room) return;

    // Clear all timers
    if (room.timer) clearInterval(room.timer);
    if (room.hintTimer) clearInterval(room.hintTimer);
    if (room.pickTimer) clearTimeout(room.pickTimer);

    room.state = 'GAME_OVER';

    // Get replay data
    const replays = game ? game.strokeBuffer.getAllRounds() : [];

    // Sort players by score
    const finalScores = this.roomManager.getPlayerList(roomCode)
      .sort((a, b) => b.score - a.score);

    this.io.to(roomCode).emit('game-over', {
      finalScores,
      replays
    });

    // Clean up game data (keep room alive for lobby)
    if (game) {
      // Don't delete immediately — client needs replays
      setTimeout(() => {
        this.games.delete(roomCode);
      }, 60000);
    }
  }

  /**
   * Handle drawer leaving mid-turn
   */
  handleDrawerLeft(roomCode) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    if (room.state === 'DRAWING' || room.state === 'PICKING_WORD') {
      room.state = 'TURN_SKIPPING';

      this.io.to(roomCode).emit('drawer-left', {
        message: 'The drawer left! Skipping to next turn...'
      });

      // Clear timers and advance
      if (room.timer) { clearInterval(room.timer); room.timer = null; }
      if (room.hintTimer) { clearInterval(room.hintTimer); room.hintTimer = null; }
      if (room.pickTimer) { clearTimeout(room.pickTimer); room.pickTimer = null; }

      const expectedTurnId = `${room.currentRound}-${room.currentDrawerIndex}`;
      setTimeout(() => {
        this._nextTurn(roomCode, expectedTurnId);
      }, 2000);
    }
  }

  /**
   * Handle all guessed — end turn early
   */
  checkAllGuessed(roomCode) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.state !== 'DRAWING') return;

    const drawerId = room.playerOrder[room.currentDrawerIndex];
    const connectedGuessers = this.roomManager.getConnectedPlayers(roomCode)
      .filter(p => p.id !== drawerId);

    if (connectedGuessers.length > 0 &&
        connectedGuessers.every(p => room.guessedPlayers.has(p.id))) {
      this._endTurn(roomCode, true);
    }
  }

  /**
   * Get stroke buffer for a room (for mid-round joiners)
   */
  getStrokeBuffer(roomCode) {
    const game = this.games.get(roomCode);
    return game ? game.strokeBuffer : null;
  }
}

module.exports = GameEngine;
