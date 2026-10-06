const { io } = require('socket.io-client');

const PORT = Math.floor(Math.random() * 10000) + 10000;
process.env.PORT = PORT;
const server = require('../server/index');

setTimeout(() => {
  const socket = io(`http://localhost:${PORT}`);

  socket.on('connect', () => {
    console.log('Connected');
    socket.emit('create-room', null);
    socket.emit('create-room', { playerName: 123, settings: null });
    socket.emit('join-room', null);
    socket.emit('update-settings', null);
    socket.emit('word-chosen', null);
    socket.emit('chat-message', null);

    setTimeout(() => {
      console.log('Still running!');
      process.exit(0);
    }, 1000);
  });
}, 500);
