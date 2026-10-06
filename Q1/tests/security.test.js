const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');

test('Security', async (t) => {
  let srv;
  t.before(async () => {
    srv = await startServer();
  });
  t.after(async () => {
    closeAll();
    if (srv) await srv.stop();
  });

  await t.test('settings clamped at creation and via update-settings', async () => {
    const c1 = connect(srv.url);
    const data = await c1.createRoom('Host', { rounds: 99999, drawTime: 1 });
    assert.strictEqual(data.settings.rounds, 10);
    assert.strictEqual(data.settings.drawTime, 30);

    c1.emit('update-settings', { rounds: -5, drawTime: 9999 });
    const update = await c1.waitFor('settings-updated');
    assert.strictEqual(update.settings.rounds, 1);
    assert.strictEqual(update.settings.drawTime, 180);

    c1.close();
  });

  await t.test('drawer permissions and info leakage', async () => {
    const customWords = ['secret1', 'secret2', 'secret3', 'secret4', 'secret5'];
    const h = connect(srv.url);
    const hostData = await h.createRoom('Host', { customWords });
    const roomCode = hostData.roomCode;
    
    const g = connect(srv.url);
    await g.joinRoom(roomCode, 'Guesser');

    // Start game
    await h.startGame(roomCode);
    const hChoose = await h.waitFor('choose-word');
    assert.ok(hChoose.words.length === 3);
    
    // Guesser should NOT get choose-word
    await assert.rejects(g.waitFor('choose-word', undefined, 500));
    
    // Guesser tries to forge word-chosen
    g.emit('word-chosen', { word: customWords[0] });
    
    // Host actually chooses
    const actualSecret = hChoose.words[0];
    h.emit('word-chosen', { wordIndex: 0 });
    
    await h.waitFor('round-started');
    const gTurn = await g.waitFor('round-started');
    
    // Validate guesser did not receive secret or custom words list
    const stringifiedGuesserEvents = JSON.stringify(g.events);
    for (const word of customWords) {
      assert.ok(!stringifiedGuesserEvents.includes(word), `Guesser received leaked word: ${word}`);
    }
    // Guesser receives only the hint (e.g. "_ _ _ _ _")
    
    // Guesser tries to draw
    g.emit('draw-stroke', { id: 'bad1', seq: 0, color: '#000000', size: 10, tool: 'pen', points: [{x:0, y:0}] });
    g.emit('fill', { x: 0, y: 0, color: '#000000' });
    g.emit('undo', { code: roomCode });
    g.emit('clear-canvas', { code: roomCode });

    // Host should not receive those forged drawing events
    await assert.rejects(h.waitFor('stroke-batch', undefined, 300));
    await assert.rejects(h.waitFor('fill', undefined, 300));
    await assert.rejects(h.waitFor('undo', undefined, 300));
    await assert.rejects(h.waitFor('clear-canvas', undefined, 300));

    // Forged score events
    g.emit('correct-guess', { score: 999 });
    g.emit('score', { score: 999 });

    // Guesser submits correct guess via chat to verify score wasn't hacked
    g.emit('chat-message', { message: actualSecret });
    const correctEvt = await g.waitFor('correct-guess');
    // Ensure the score awarded is computed by server, not 999
    assert.ok(correctEvt.points < 900);
    const guesserState = correctEvt.players.find(p => p.id === correctEvt.playerId);
    assert.ok(guesserState.score < 900);

    h.close();
    g.close();
  });
});
