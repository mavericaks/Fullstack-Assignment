/**
 * Room Manager — handles room creation, joining, and player management
 * Each room has a unique 6-char code and tracks all player state
 */

const { v4: uuidv4 } = require('uuid');
const config = require('./config');

class RoomManager {
  constructor() {
    // roomCode -> Room object
    this.rooms = new Map();
    // sessionToken -> { roomCode, playerId }
    this.sessions = new Map();
    // socketId -> { roomCode, playerId, sessionToken }
    this.socketMap = new Map();
  }

  /**
   * Generate a unique 6-character room code
   */
  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Create a new room
   * @param {string} hostName - host player's name
   * @param {string} socketId - host's socket ID
   * @param {object} settings - { rounds, drawTime, customWords }
   * @returns {object} { roomCode, sessionToken, player }
   */
  createRoom(hostName, socketId, settings = {}) {
    const roomCode = this._generateCode();
    const sessionToken = uuidv4();
    const playerId = uuidv4();

    const player = {
      id: playerId,
      name: hostName,
      socketId: socketId,
      isHost: true,
      score: 0,
      connected: true,
      disconnectedAt: null
    };

    const sConf = config.settings;
    
    let rounds = parseInt(settings.rounds, 10);
    rounds = Number.isFinite(rounds) ? Math.min(sConf.rounds.max, Math.max(sConf.rounds.min, rounds)) : sConf.rounds.default;
    
    let drawTime = parseInt(settings.drawTime, 10);
    drawTime = Number.isFinite(drawTime) ? Math.min(sConf.drawTime.max, Math.max(sConf.drawTime.min, drawTime)) : sConf.drawTime.default;
    
    let customWords = [];
    if (Array.isArray(settings.customWords)) {
      customWords = settings.customWords
        .filter(w => typeof w === 'string' && w.trim().length > 0 && w.trim().length <= sConf.customWords.maxLength)
        .map(w => w.trim())
        .slice(0, sConf.customWords.maxCount);
    }

    const room = {
      code: roomCode,
      host: playerId,
      players: new Map([[playerId, player]]),
      playerOrder: [playerId],
      settings: {
        rounds: rounds,
        drawTime: drawTime,
        category: typeof settings.category === 'string' ? settings.category : 'general',
        customWords: customWords
      },
      state: 'LOBBY', // LOBBY, PICKING_WORD, DRAWING, ROUND_END, GAME_OVER
      currentRound: 0,
      currentDrawerIndex: 0,
      currentWord: null,
      currentHint: '',
      revealedIndices: [],
      guessedPlayers: new Set(),
      guesserPoints: [],
      turnStartTime: null,
      timer: null,
      hintTimer: null,
      createdAt: Date.now()
    };

    this.rooms.set(roomCode, room);
    this.sessions.set(sessionToken, { roomCode, playerId });
    this.socketMap.set(socketId, { roomCode, playerId, sessionToken });

    return { roomCode, sessionToken, player };
  }

  /**
   * Join an existing room
   * @param {string} roomCode
   * @param {string} playerName
   * @param {string} socketId
   * @returns {object|null} { sessionToken, player, room } or null if invalid
   */
  joinRoom(roomCode, playerName, socketId) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return null;

    // Check for duplicate names
    for (const [, p] of room.players) {
      if (p.name.toLowerCase() === playerName.toLowerCase() && p.connected) {
        return { error: 'Name already taken in this room' };
      }
    }

    const sessionToken = uuidv4();
    const playerId = uuidv4();

    const player = {
      id: playerId,
      name: playerName,
      socketId: socketId,
      isHost: false,
      score: 0,
      connected: true,
      disconnectedAt: null
    };

    room.players.set(playerId, player);

    // Add to player order only if game hasn't started or they're new
    if (room.state === 'LOBBY') {
      room.playerOrder.push(playerId);
    }

    this.sessions.set(sessionToken, { roomCode: room.code, playerId });
    this.socketMap.set(socketId, { roomCode: room.code, playerId, sessionToken });

    return { sessionToken, player, room };
  }

  /**
   * Reconnect a player using their session token
   * @param {string} sessionToken
   * @param {string} newSocketId
   * @returns {object|null} reconnection data or null
   */
  reconnect(sessionToken, newSocketId) {
    const session = this.sessions.get(sessionToken);
    if (!session) return null;

    const room = this.rooms.get(session.roomCode);
    if (!room) return null;

    const player = room.players.get(session.playerId);
    if (!player) return null;

    // Check 30-second grace period
    if (player.disconnectedAt) {
      const elapsed = Date.now() - player.disconnectedAt;
      if (elapsed > config.room.reconnectGraceMs) {
        // Grace period expired — remove old session
        this.sessions.delete(sessionToken);
        return null;
      }
    }

    // Update socket mapping
    const oldSocketId = player.socketId;
    if (this.socketMap.has(oldSocketId)) {
      this.socketMap.delete(oldSocketId);
    }

    player.socketId = newSocketId;
    player.connected = true;
    player.disconnectedAt = null;

    this.socketMap.set(newSocketId, {
      roomCode: session.roomCode,
      playerId: session.playerId,
      sessionToken
    });

    return { room, player };
  }

  /**
   * Handle player disconnection — always starts a 30-second grace period.
   * The caller (server) is responsible for calling expireIfStillDisconnected()
   * after the grace window; this keeps the reconnect path simple.
   * @param {string} socketId
   * @returns {object|null} { room, player, wasDrawer }
   */
  disconnect(socketId) {
    const mapping = this.socketMap.get(socketId);
    if (!mapping) return null;

    const room = this.rooms.get(mapping.roomCode);
    if (!room) return null;

    const player = room.players.get(mapping.playerId);
    if (!player) return null;

    player.connected = false;
    player.disconnectedAt = Date.now();
    // Stash sessionToken so expireIfStillDisconnected can clean it up
    player._sessionToken = mapping.sessionToken;

    this.socketMap.delete(socketId);

    // Check if this player is the current drawer
    const currentDrawerId = room.playerOrder[room.currentDrawerIndex];
    const wasDrawer = currentDrawerId === player.id &&
                      (room.state === 'DRAWING' || room.state === 'PICKING_WORD');

    // In LOBBY: give the host a chance to reconnect too (same 30s grace)
    if (room.state === 'LOBBY' && player.isHost && room.players.size > 1) {
      // If host disconnects in lobby, promote next player as interim host
      // (real host can take it back on reconnect)
      const nextPlayer = [...room.players.values()].find(
        p => p.id !== player.id && p.connected
      );
      if (nextPlayer) {
        nextPlayer.isHost = true;
        room.host = nextPlayer.id;
      }
    }

    // Clean up empty rooms (all players gone)
    const connectedCount = this.getConnectedPlayers(room.code).length;
    if (connectedCount === 0) {
      setTimeout(() => {
        const r = this.rooms.get(room.code);
        if (r && this.getConnectedPlayers(r.code).length === 0) {
          this.destroyRoom(r.code);
        }
      }, config.room.emptyRoomTtlMs);
    }

    return { room, player, wasDrawer };
  }

  /**
   * Called after the grace period expires. Removes the player permanently
   * if they still haven't reconnected.
   * @param {string} roomCode
   * @param {string} playerId
   * @param {number} graceMs  should match RECONNECT_GRACE_MS in server/index.js
   * @returns {boolean} true if the player was actually removed
   */
  expireIfStillDisconnected(roomCode, playerId, graceMs) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const player = room.players.get(playerId);
    if (!player) return false;
    if (player.connected) return false; // they reconnected — nothing to do

    const elapsed = player.disconnectedAt ? Date.now() - player.disconnectedAt : Infinity;
    if (elapsed < graceMs) return false; // reconnected and disconnected again quickly

    // Permanently remove the player
    room.players.delete(playerId);
    room.playerOrder = room.playerOrder.filter(id => id !== playerId);
    if (player._sessionToken) this.sessions.delete(player._sessionToken);

    // If they were the host and no one else is host, promote someone
    if (player.isHost && room.players.size > 0) {
      const next = [...room.players.values()].find(p => p.connected);
      if (next) {
        next.isHost = true;
        room.host = next.id;
      }
    }

    return true;
  }

  /**
   * Get connected players in a room
   */
  getConnectedPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return [...room.players.values()].filter(p => p.connected);
  }

  /**
   * Get all players in a room (connected and disconnected)
   */
  getAllPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return [...room.players.values()];
  }

  /**
   * Get room by code
   */
  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  /**
   * Get room and player by socket ID
   */
  getBySocket(socketId) {
    const mapping = this.socketMap.get(socketId);
    if (!mapping) return null;

    const room = this.rooms.get(mapping.roomCode);
    if (!room) return null;

    const player = room.players.get(mapping.playerId);
    return { room, player, sessionToken: mapping.sessionToken };
  }

  /**
   * Destroy a room and clean up all references
   */
  destroyRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    // Clear timers
    if (room.timer) clearInterval(room.timer);
    if (room.hintTimer) clearInterval(room.hintTimer);

    // Clean up session and socket mappings
    for (const [, player] of room.players) {
      for (const [token, session] of this.sessions) {
        if (session.roomCode === roomCode) {
          this.sessions.delete(token);
        }
      }
      if (this.socketMap.has(player.socketId)) {
        this.socketMap.delete(player.socketId);
      }
    }

    this.rooms.delete(roomCode);
  }

  /**
   * Get serialized player list (safe for client)
   */
  getPlayerList(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];

    return [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      score: p.score,
      connected: p.connected
    }));
  }
}

module.exports = RoomManager;
