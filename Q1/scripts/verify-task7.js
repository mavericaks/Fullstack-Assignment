const AntiCheatService = require('../server/antiCheat/index');
const ocrWorker = require('../server/antiCheat/ocrWorker');

// Mock GameEngine and IO
const io = { to: () => ({ emit: () => {} }) };
const gameEngine = {
  getStrokeBuffer: () => ({ addClear: () => {} }),
  roomManager: { getPlayerList: () => [] }
};

const ac = new AntiCheatService(io, gameEngine);

let cheated = false;
ac.handleCheatDetected = () => { cheated = true; };

const room = {
  currentWord: 'football',
  playerOrder: ['p1'],
  currentDrawerIndex: 0,
  players: new Map([['p1', { id: 'p1', score: 100, socketId: 'socket1', name: 'Player' }]])
};

async function runTest() {
  // Test 1: "oo" (like two circles) -> Should NOT be flagged (length < 3)
  ocrWorker.recognize = async () => [{ text: 'oo', confidence: 90 }];
  cheated = false;
  await ac.performOCRCheck('room1', room, []);
  if (cheated) {
    console.error('Task 7 Failed: "oo" was flagged as cheating');
    process.exit(1);
  }

  // Test 2: "football" -> Should be flagged
  ocrWorker.recognize = async () => [{ text: 'football', confidence: 90 }];
  cheated = false;
  await ac.performOCRCheck('room1', room, []);
  if (!cheated) {
    console.error('Task 7 Failed: "football" was NOT flagged');
    process.exit(1);
  }

  // Test 3: "foo" -> Should be flagged (length >= 3 and substring)
  ocrWorker.recognize = async () => [{ text: 'foo', confidence: 90 }];
  cheated = false;
  await ac.performOCRCheck('room1', room, []);
  if (!cheated) {
    console.error('Task 7 Failed: "foo" was NOT flagged');
    process.exit(1);
  }
  
  // Test 4: "foo" but low confidence -> Should NOT be flagged
  ocrWorker.recognize = async () => [{ text: 'foo', confidence: 10 }];
  cheated = false;
  await ac.performOCRCheck('room1', room, []);
  if (cheated) {
    console.error('Task 7 Failed: "foo" with low confidence was flagged');
    process.exit(1);
  }

  console.log('Task 7 verified successfully!');
  process.exit(0);
}

runTest();
