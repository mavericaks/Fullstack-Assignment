const { io } = require('socket.io-client');
const config = require('../server/config');
const PORT = Math.floor(Math.random() * 10000) + 10000;
process.env.PORT = PORT;
const server = require('../server/index');

setTimeout(() => {
  const socket = io(`http://localhost:${PORT}`);
  let roomsCreated = 0;

  socket.on('connect', () => {
    socket.on('room-created', () => {
      roomsCreated++;
    });

    for (let i = 0; i < 50; i++) {
      socket.emit('create-room', { playerName: `Host${i}`, settings: {} });
    }

    setTimeout(() => {
      if (roomsCreated > config.rateLimits.room.max) {
        console.error(`Rate limit failed! Created ${roomsCreated} rooms, expected max ${config.rateLimits.room.max}`);
        process.exit(1);
      }
      console.log(`Task 4 verified successfully! Created ${roomsCreated} rooms.`);
      process.exit(0);
    }, 1000);
  });
}, 500);
