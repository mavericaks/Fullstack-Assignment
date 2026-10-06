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

    // Check words returned by OCR (with confidence)
    const secretWord = room.currentWord.toLowerCase();
    let isCheating = false;

    for (const detectedWord of text) {
      const detected = detectedWord.text.trim().toLowerCase();
      const confidence = detectedWord.confidence;
      if (detected.length === 0) continue;

      if (secretWord.length < config.antiCheat.exactMatchBelowLength) {
        // Exact match required
        if (detected === secretWord && confidence >= config.antiCheat.ocr.minConfidence) {
          isCheating = true;
          break;
        }
      } else {
        // Longer secret word: substring or levenshtein allowed
        if ((detected.includes(secretWord) || secretWord.includes(detected)) && detected.length >= 3 && confidence >= config.antiCheat.ocr.minConfidence) {
          isCheating = true;
          break;
        }

        const dist = GuessChecker.levenshtein(detected, secretWord);
        const maxLen = Math.max(detected.length, secretWord.length);
        const similarity = 1 - (dist / maxLen);

        if (similarity >= config.antiCheat.similarityThreshold && confidence >= config.antiCheat.ocr.minConfidence) {
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
      // Warn and penalize (penalty from 2nd strike onwards)
      const penalty = strikeCount >= 2 ? config.antiCheat.penaltyPoints : 0;
      if (penalty > 0) {
        drawer.score = Math.max(0, drawer.score - penalty);
      }
      
      const penaltyMsg = penalty > 0 ? ` Penalty: -${penalty} pts.` : '';
      this.io.to(drawer.socketId).emit('error-msg', { message: `Warning: Do not write the word! (${strikeCount}/${config.antiCheat.maxStrikes} strikes).${penaltyMsg}` });
      
      // Clear their canvas to stop them
      this.gameEngine.getStrokeBuffer(roomCode).addClear();
      this.io.to(roomCode).emit('clear-canvas');
      
      // Update scoreboard to reflect penalty if applied
      if (penalty > 0) {
        this.io.to(roomCode).emit('player-joined', { players: this.gameEngine.roomManager.getPlayerList(roomCode), player: drawer });
      }
    }
  }
}

module.exports = AntiCheatService;
