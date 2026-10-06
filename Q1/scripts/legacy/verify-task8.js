const { io } = require('socket.io-client');
const PORT = Math.floor(Math.random() * 10000) + 10000;
process.env.PORT = PORT;
const server = require('../server/index');

setTimeout(() => {
  const host = io(`http://localhost:${PORT}`);
  const guesser1 = io(`http://localhost:${PORT}`);
  const guesser2 = io(`http://localhost:${PORT}`);
  let roomCode;
  
  host.on('connect', () => {
    host.emit('create-room', { playerName: 'Host', settings: { rounds: 1, drawTime: 30, customWords: ['football'] } });
  });

  host.on('room-created', (data) => {
    roomCode = data.roomCode;
    guesser1.emit('join-room', { roomCode, playerName: 'Guesser1' });
  });

  guesser1.on('room-joined', () => {
    guesser2.emit('join-room', { roomCode, playerName: 'Guesser2' });
  });

  guesser2.on('room-joined', () => {
    host.emit('start-game');
  });

  host.on('choose-word', (data) => {
    // There's only 'football' in customWords, so it must be football
    host.emit('word-chosen', { wordIndex: 0 }); 
  });

  let guesser2ReceivedNearMiss = false;

  guesser2.on('chat-message', (data) => {
    if (data.message === 'footbal') { // The near miss
      guesser2ReceivedNearMiss = true;
    }
  });

  guesser1.on('round-started', () => {
    // wait a bit and send a near miss
    setTimeout(() => {
      guesser1.emit('chat-message', { message: 'footbal' });
      
      setTimeout(() => {
        if (guesser2ReceivedNearMiss) {
          console.error('Task 8 Failed: Guesser2 received the near-miss chat message!');
          process.exit(1);
        }
        console.log('Task 8 verified successfully!');
        process.exit(0);
      }, 500);
    }, 500);
  });
}, 500);
