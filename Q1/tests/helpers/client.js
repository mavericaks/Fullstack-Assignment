const { io } = require('socket.io-client');

const clients = [];

function connect(url) {
  const socket = io(url, { reconnection: false, forceNew: true });
  const events = [];
  
  socket.onAny((name, ...args) => {
    events.push({ name, data: args[0], timestamp: Date.now() });
  });

  const client = {
    socket,
    events,
    all: (name) => events.filter(e => e.name === name),
    has: (name) => events.some(e => e.name === name),
    emit: (name, ...args) => socket.emit(name, ...args),
    close: () => {
      socket.close();
      const idx = clients.indexOf(client);
      if (idx > -1) clients.splice(idx, 1);
    },
    waitFor: (name, predicate = () => true, timeoutMs = 2000) => {
      return new Promise((resolve, reject) => {
        // Check existing
        const existing = events.find(e => e.name === name && predicate(e.data));
        if (existing) return resolve(existing.data);
        
        let timeout;
        const handler = (data) => {
          if (predicate(data)) {
            clearTimeout(timeout);
            socket.off(name, handler);
            resolve(data);
          }
        };
        socket.on(name, handler);
        timeout = setTimeout(() => {
          socket.off(name, handler);
          reject(new Error(`Timeout waiting for event ${name}`));
        }, timeoutMs);
      });
    },
    createRoom: async (name, settings = {}) => {
      socket.emit('create-room', { playerName: name, settings });
      const data = await client.waitFor('room-created', undefined, 2000).catch(e => {
        return client.waitFor('error-msg', undefined, 1000).then(err => { throw new Error(err.message) }).catch(() => { throw e });
      });
      return data;
    },
    joinRoom: async (code, name) => {
      socket.emit('join-room', { roomCode: code, playerName: name });
      return new Promise((resolve, reject) => {
        const joinHandler = (d) => { cleanup(); resolve(d); };
        const errorHandler = (d) => { cleanup(); reject(new Error(d.message)); };
        const cleanup = () => { socket.off('room-joined', joinHandler); socket.off('error-msg', errorHandler); };
        socket.once('room-joined', joinHandler);
        socket.once('error-msg', errorHandler);
        setTimeout(() => { cleanup(); reject(new Error('joinRoom timeout')); }, 2000);
      });
    },
    startGame: async (code) => {
      socket.emit('start-game', { code });
      return client.waitFor('game-started', undefined, 2000);
    },
    playTurn: async ({ drawer, guessers }) => {
      const pickWordData = await drawer.waitFor('choose-word', undefined, 8000);
      const secretWord = pickWordData.words[0];
      drawer.emit('word-chosen', { wordIndex: 0 });
      
      await drawer.waitFor('round-started', undefined, 5000);
      for (const g of guessers) {
        await g.waitFor('round-started', undefined, 5000);
      }
      return secretWord;
    }
  };
  clients.push(client);
  return client;
}

function closeAll() {
  for (const c of [...clients]) {
    c.close();
  }
}

module.exports = { connect, closeAll };
