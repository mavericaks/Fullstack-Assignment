const { io } = require('socket.io-client');
const PORT = Math.floor(Math.random() * 10000) + 10000;
process.env.PORT = PORT;
const server = require('../server/index');

setTimeout(() => {
  const hostSocket = io(`http://localhost:${PORT}`);
  let roomCode;

  hostSocket.on('connect', () => {
    hostSocket.emit('create-room', {
      playerName: 'Host',
      settings: {
        customWords: ['secret1', 'secret2']
      }
    });
  });

  hostSocket.on('room-created', (data) => {
    roomCode = data.roomCode;
    const guesserSocket = io(`http://localhost:${PORT}`);
    
    guesserSocket.on('connect', () => {
      guesserSocket.emit('join-room', { roomCode, playerName: 'Guesser' });
    });

    guesserSocket.on('room-joined', (gData) => {
      if (gData.settings.customWords) {
        console.error('Guesser received custom words on join!');
        process.exit(1);
      }
      
      // Now host updates settings
      hostSocket.emit('update-settings', { customWords: ['secret3'] });
    });

    guesserSocket.on('settings-updated', (gData) => {
      if (gData.settings.customWords) {
        console.error('Guesser received custom words on settings update!');
        process.exit(1);
      }
      
      console.log('Task 3 verified successfully!');
      process.exit(0);
    });
  });
}, 500);
