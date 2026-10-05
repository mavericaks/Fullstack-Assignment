const config = require('../config');
const Heuristics = require('./heuristic');
const ocrWorker = require('./ocrWorker');
const GuessChecker = require('../guessChecker');

class AntiCheatService {
  constructor(io, gameEngine) {
    this.io = io;
    this.gameEngine = gameEngine;
    this.activeChecks = new Set(); // roomCodes currently being checked
    this.lastCheckedLengths = new Map(); // roomCode -> stroke count
    this.strikes = new Map(); // playerId -> strike count

    if (config.antiCheat.enabled) {
      setInterval(() => this.runChecks(), config.antiCheat.checkIntervalMs);
    }
  }

  async runChecks() {
    for (const [roomCode, game] of this.gameEngine.games.entries()) {
      const room = this.gameEngine.roomManager.getRoom(roomCode);
      if (!room || room.state !== 'DRAWING') {
        this.lastCheckedLengths.delete(roomCode);
        continue;
      }

      const strokes = game.strokeBuffer.getCurrentStrokes();
      const lastLen = this.lastCheckedLengths.get(roomCode) || 0;

      // Only check if new strokes were added
      if (strokes.length <= lastLen || strokes.length < config.antiCheat.minStrokesForCheck) {
        continue;
      }

      this.lastCheckedLengths.set(roomCode, strokes.length);

      // Avoid overlapping checks for the same room
      if (this.activeChecks.has(roomCode)) continue;

      if (Heuristics.isTextLike(strokes)) {
        this.activeChecks.add(roomCode);
        try {
          await this.performOCRCheck(roomCode, room, strokes);
        } catch (e) {
          console.error(`OCR Check failed for room ${roomCode}:`, e);
        } finally {
          this.activeChecks.delete(roomCode);
        }
      }
    }
  }

  async performOCRCheck(roomCode, room, strokes) {
    const text = await ocrWorker.recognize(strokes);
    if (!text) return;

    const secretWord = room.currentWord.toLowerCase();
    
    // We check if the OCR detected text is suspiciously close to the secret word.
    // If the secret word is short, we demand an exact match.
    // If it's longer, we allow some Levenshtein distance (e.g. 80% similarity).
    
    // Tesseract often returns extra garbage characters, so we split by word
    // and check if any word matches the secret word closely.
    const detectedWords = text.split(/\s+/).filter(w => w.length > 0);
    
    let isCheating = false;

    for (const detected of detectedWords) {
      // Check if it's an exact substring
      if (detected.includes(secretWord) || secretWord.includes(detected)) {
        isCheating = true;
        break;
      }

      if (secretWord.length >= config.antiCheat.exactMatchBelowLength) {
        const dist = GuessChecker.levenshtein(detected, secretWord);
        const maxLen = Math.max(detected.length, secretWord.length);
        const similarity = 1 - (dist / maxLen);

        if (similarity >= config.antiCheat.similarityThreshold) {
          isCheating = true;
          break;
        }
      }
    }

    if (isCheating) {
      this.handleCheatDetected(roomCode, room);
    }
  }

  handleCheatDetected(roomCode, room) {
    const drawerId = room.playerOrder[room.currentDrawerIndex];
    const drawer = room.players.get(drawerId);
    if (!drawer) return;

    let strikeCount = (this.strikes.get(drawerId) || 0) + 1;
    this.strikes.set(drawerId, strikeCount);

    if (strikeCount >= config.antiCheat.maxStrikes) {
      // Kick them off the turn
      this.io.to(roomCode).emit('error-msg', { message: `${drawer.name} was caught writing the word too many times! Turn skipped.` });
      this.gameEngine._endTurn(roomCode, false);
      this.strikes.set(drawerId, 0); // reset after skip
    } else {
      // Warn and penalize
      const penalty = config.antiCheat.penaltyPoints;
      drawer.score = Math.max(0, drawer.score - penalty);
      
      this.io.to(drawer.socketId).emit('error-msg', { message: `Warning: Do not write the word! (${strikeCount}/${config.antiCheat.maxStrikes} strikes). Penalty: -${penalty} pts.` });
      
      // Clear their canvas to stop them
      this.gameEngine.getStrokeBuffer(roomCode).addClear();
      this.io.to(roomCode).emit('clear-canvas');
      
      // Update scoreboard to reflect penalty
      this.io.to(roomCode).emit('player-joined', { players: this.gameEngine.roomManager.getPlayerList(roomCode), player: drawer });
    }
  }
}

module.exports = AntiCheatService;
