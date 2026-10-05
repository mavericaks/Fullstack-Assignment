const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:4000'; // Make sure this matches your running server port

console.log(`Connecting to ${SERVER_URL}...`);
const socket = io(SERVER_URL, { transports: ['websocket'] });

socket.on('connect', () => {
  console.log('✅ Connected to server!');
  
  // 1. Create a room
  console.log('Creating a room to test chat rate limits...');
  socket.emit('create-room', {
    playerName: 'SpammerBot',
    settings: { rounds: 3, drawTime: 80 }
  });
});

socket.on('room-created', ({ roomCode }) => {
  console.log(`✅ Room created: ${roomCode}`);
  
  // 2. Blast 10 chat messages instantly
  console.log('\n🚀 Blasting 10 chat messages in 100ms... (Limit is 3 per 2 seconds)');
  
  for (let i = 1; i <= 10; i++) {
    socket.emit('chat-message', { message: `Spam message #${i}` });
  }

  // Close after a short delay so we can see the errors
  setTimeout(() => {
    console.log('\nTest complete! Exiting...');
    process.exit(0);
  }, 2000);
});

// 3. Listen for rate limit errors
socket.on('error-msg', (data) => {
  console.log(`🛑 SERVER BLOCKED ACTION: ${data.message}`);
});

socket.on('chat-message', (data) => {
  console.log(`💬 Message accepted: ${data.message}`);
});

socket.on('connect_error', (err) => {
  console.error(`❌ Connection failed: ${err.message}. Is the server running?`);
  process.exit(1);
});
