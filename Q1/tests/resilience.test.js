const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');

test('Resilience', async (t) => {
  let srv;
  t.before(async () => {
    srv = await startServer();
  });
  t.after(async () => {
    closeAll();
    if (srv) await srv.stop();
  });

  await t.test('malformed payloads leave process alive', async () => {
    const c = connect(srv.url);
    const events = ['create-room', 'join-room', 'update-settings', 'start-game', 'word-chosen', 'draw-stroke', 'undo', 'clear-canvas', 'fill', 'chat-message', 'reconnect-session'];
    const badPayloads = [null, 123, "string", { missing: true }, [1, 2]];

    for (const ev of events) {
      for (const payload of badPayloads) {
        c.emit(ev, payload);
      }
    }
    
    // Process still alive? (wait briefly to see if it crashed)
    await new Promise(r => setTimeout(r, 500));
    
    // Normal game still playable?
    const c2 = connect(srv.url);
    const data = await c2.createRoom('Host', { rounds: 1 });
    assert.ok(data.roomCode);
    c.close();
    c2.close();
  });

  await t.test('reconnect flows', async () => {
    const c1 = connect(srv.url);
    const d1 = await c1.createRoom('Host');
    const token = d1.sessionToken;
    const roomCode = d1.roomCode;
    c1.close(); // simulate drop

    // Reconnect within grace
    const c2 = connect(srv.url);
    c2.emit('reconnect-session', { sessionToken: token });
    const reconData = await c2.waitFor('reconnect-success');
    assert.strictEqual(reconData.roomCode, roomCode);
    
    // Invalid token
    const c3 = connect(srv.url);
    c3.emit('reconnect-session', { sessionToken: 'invalid-token' });
    const failed = await c3.waitFor('reconnect-failed');
    assert.ok(failed);

    c2.close();
    c3.close();
  });

  await t.test('drawer disconnect advances game exactly once', async () => {
    const h = connect(srv.url);
    const hostData = await h.createRoom('Host', { customWords: ['word1', 'word2'] });
    const roomCode = hostData.roomCode;

    const g1 = connect(srv.url);
    await g1.joinRoom(roomCode, 'G1');

    await h.startGame(roomCode);
    await h.playTurn({ drawer: h, guessers: [g1] });

    h.close(); // Drawer disconnects
    
    const leftMsg = await g1.waitFor('drawer-left', undefined, 2000);
    assert.ok(leftMsg);

    // Wait for the next turn to start
    const newTurn = await g1.waitFor('round-started', undefined, 10000); // 5s wait + buffer
    assert.ok(newTurn);
    
    g1.close();
  });

  await t.test('start-game mid-turn timer rate and mid-game joiner turn', async () => {
    const h = connect(srv.url);
    const hostData = await h.createRoom('Host', { rounds: 1, customWords: ['w1', 'w2', 'w3', 'w4'] });
    const roomCode = hostData.roomCode;

    const g1 = connect(srv.url);
    await g1.joinRoom(roomCode, 'G1');

    await h.startGame(roomCode);
    await h.playTurn({ drawer: h, guessers: [g1] });

    let ticks = 0;
    const tickCounter = () => { ticks++; };
    g1.socket.on('timer-update', tickCounter);

    // spam start-game mid turn
    h.emit('start-game', { code: roomCode });
    h.emit('start-game', { code: roomCode });

    await new Promise(r => setTimeout(r, 2000));
    g1.socket.off('timer-update', tickCounter);

    // A timer running normally over 2 seconds fires ~2 times. If it doubled, it would be ~4+.
    assert.ok(ticks <= 4, `Too many ticks: ${ticks}`);

    // Mid-game joiner
    const g2 = connect(srv.url);
    await g2.joinRoom(roomCode, 'G2');
    
    // Finish H's turn
    const secretH = h.events.find(e => e.name === 'choose-word').data.words[0];
    g1.emit('chat-message', { message: secretH });
    g2.emit('chat-message', { message: secretH });
    await h.waitFor('round-ended', undefined, 5000);
    
    // G1's turn
    const secretG1 = await g1.playTurn({ drawer: g1, guessers: [h, g2] });
    h.emit('chat-message', { message: secretG1 });
    g2.emit('chat-message', { message: secretG1 });
    await g1.waitFor('round-ended', undefined, 5000);

    // G2's turn (mid-game joiner gets to draw!)
    const g2Pick = await g2.waitFor('choose-word', undefined, 8000); // wait through the 5s delay
    assert.ok(g2Pick);

    h.close();
    g1.close();
    g2.close();
  });
});
