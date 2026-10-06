const { io } = require('socket.io-client');
const config = require('../server/config');
const PORT = Math.floor(Math.random() * 10000) + 10000;
process.env.PORT = PORT;
const server = require('../server/index');

setTimeout(() => {
  const socket = io(`http://localhost:${PORT}`);

  socket.on('connect', () => {
    socket.emit('create-room', {
      playerName: 'Host',
      settings: {
        rounds: 99999,
        drawTime: 1,
        customWords: ['A', 123, 'B'.repeat(100), 'C']
      }
    });
  });

  socket.on('room-created', (data) => {
    const s = data.settings;
    if (s.rounds !== config.settings.rounds.max) {
      console.error(`Rounds not clamped! Expected ${config.settings.rounds.max}, got ${s.rounds}`);
      process.exit(1);
    }
    if (s.drawTime !== config.settings.drawTime.min) {
      console.error(`DrawTime not clamped! Expected ${config.settings.drawTime.min}, got ${s.drawTime}`);
      process.exit(1);
    }
    if (s.customWords.length !== 2) {
      console.error(`customWords not validated properly! Expected length 2, got ${s.customWords.length}`);
      process.exit(1);
    }
    console.log('Task 2 verified successfully!');
    process.exit(0);
  });
}, 500);
