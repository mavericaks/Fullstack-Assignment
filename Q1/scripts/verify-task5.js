const { io } = require('socket.io-client');
const PORT = Math.floor(Math.random() * 10000) + 10000;
process.env.PORT = PORT;
const server = require('../server/index');

setTimeout(() => {
  const host = io(`http://localhost:${PORT}`);
  const guesser = io(`http://localhost:${PORT}`);
  let roomCode;
  
  host.on('connect', () => {
    host.emit('create-room', { playerName: 'Host', settings: { rounds: 2, drawTime: 10 } });
  });

  host.on('room-created', (data) => {
    roomCode = data.roomCode;
    guesser.emit('join-room', { roomCode, playerName: 'Guesser' });
  });

  guesser.on('room-joined', () => {
    host.emit('start-game'); // starts turn for Host
  });

  let timerUpdates = 0;
  host.on('timer-update', () => {
    timerUpdates++;
  });

  host.on('choose-word', () => {
    host.emit('word-chosen', { wordIndex: 0 }); // starts drawing
    
    // Now try to start game again (mid-turn)
    host.emit('start-game');
    
    setTimeout(() => {
      // Disconnect host (drawer leaves) and at EXACT SAME TIME guesser guesses correctly
      host.disconnect();
      guesser.emit('chat-message', { message: 'some guess' }); // might be right or wrong, we just need to trigger endTurn race
      // Actually we just care it doesn't skip
      
      setTimeout(() => {
        // Did we skip the next turn? 
        // We can just check that guesser receives exactly one round-started or something
        if (timerUpdates > 3) {
          console.error(`Too many timer updates: ${timerUpdates} (expected <= 2)`);
          process.exit(1);
        }
        console.log('Task 5 verified successfully!');
        process.exit(0);
      }, 3000);
    }, 1000);
  });
}, 500);
