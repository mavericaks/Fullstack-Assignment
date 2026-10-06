const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');

test('Guessing', async (t) => {
  let srv;
  t.before(async () => {
    srv = await startServer();
  });
  t.after(async () => {
    closeAll();
    if (srv) await srv.stop();
  });

  await t.test('guessing logic and points', async () => {
    const customWords = ['football', 'baseball', 'basketball'];
    const drawer = connect(srv.url);
    const roomData = await drawer.createRoom('Drawer', { customWords });
    const code = roomData.roomCode;

    const g1 = connect(srv.url);
    await g1.joinRoom(code, 'G1');
    const g2 = connect(srv.url);
    await g2.joinRoom(code, 'G2');

    await drawer.startGame(code);
    const secret = await drawer.playTurn({ drawer, guessers: [g1, g2] });

    // g1 sends near-miss
    const nearMiss = secret.slice(0, -1) + 'x';
    g1.emit('chat-message', { message: nearMiss });
    const close = await g1.waitFor('close-guess');
    assert.ok(close);
    // drawer and g2 should not receive near-miss
    await assert.rejects(g2.waitFor('chat-message', d => d.message === nearMiss, 300));

    // g1 sends message containing answer
    g1.emit('chat-message', { message: `i think it is ${secret}` });
    await assert.rejects(g2.waitFor('chat-message', d => d.message.includes(secret), 300));
    // wait, contains answer sends a private warning? actually guessChecker just returns containsAnswer and server emits nothing to others
    
    // g1 correct guess
    g1.emit('chat-message', { message: secret });
    const g1Correct = await g1.waitFor('correct-guess');
    assert.strictEqual(g1Correct.playerId, g1.events.find(e=>e.name==='room-joined').data.player.id);
    assert.ok(g1Correct.points > 0);
    
    const g2Heard = await g2.waitFor('correct-guess');
    assert.strictEqual(g2Heard.playerId, g1Correct.playerId);

    // Wait a bit to ensure g2 is slower
    await new Promise(r => setTimeout(r, 200));

    // g1 tries to reveal word
    g1.emit('chat-message', { message: secret });
    await assert.rejects(g2.waitFor('chat-message', d => d.message.includes(secret), 300));

    // g2 correct guess
    g2.emit('chat-message', { message: secret });
    const g2Correct = await g2.waitFor('correct-guess', d => d.playerId === g2.events.find(e=>e.name==='room-joined').data.player.id);
    assert.ok(g1Correct.points >= g2Correct.points);

    // Turn should end early since everyone guessed
    const endTurn = await drawer.waitFor('round-ended');
    assert.strictEqual(endTurn.word, secret);

    // Drawer should get points
    const pList = endTurn.scores;
    const dObj = pList.find(p => p.id === roomData.player.id);
    assert.ok(dObj.score > 0);

    drawer.close();
    g1.close();
    g2.close();
  });
});
